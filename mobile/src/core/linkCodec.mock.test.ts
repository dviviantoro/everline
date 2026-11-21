import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createConnection, type Socket } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { nodeCodec } from '../test/dspNode';
import { splitFrames } from '../test/frames';

/**
 * The codec against the real `cantol-mock` over a real socket: the bytes the phone will send and
 * the answers it will read. Runs only when the mock binary has been built (`cargo build -p
 * cantol-mock` or any `cargo test` in `mobile/rust`); otherwise it is skipped, not faked.
 */
const MOCK = new URL('../../rust/target/debug/cantol-mock', import.meta.url).pathname;
const PORT = 47310;

function readFrame(socket: Socket, timeoutMs: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('no answer'));
    }, timeoutMs);
    socket.once('data', (data) => {
      clearTimeout(timer);
      resolve(new Uint8Array(data));
    });
  });
}

describe.skipIf(!existsSync(MOCK))('link codec against cantol-mock', () => {
  let mock: ChildProcess;
  const codec = nodeCodec();

  beforeAll(async () => {
    mock = spawn(MOCK, ['--bind', '127.0.0.1', '--port', String(PORT), '--no-beacon'], { stdio: 'ignore' });
    await new Promise((resolve) => setTimeout(resolve, 400));
  });
  afterAll(() => {
    mock.kill();
  });

  const open = (): Promise<Socket> =>
    new Promise((resolve, reject) => {
      const socket = createConnection({ host: '127.0.0.1', port: PORT }, () => {
        resolve(socket);
      });
      socket.once('error', reject);
    });

  it('answers the HELLO the codec builds, echoing its nonce', async () => {
    const socket = await open();
    socket.write(codec.hello(0x1234abcd, Date.now()));
    const pong = codec.pong(await readFrame(socket, 3000));
    socket.destroy();
    expect(pong.deviceId).toBe('RP-MOCK');
    expect(pong.nonce).toBe(0x1234abcd);
    expect(pong.protocol).toBe(1);
  });

  it('answers the keep-alive with a frame, so the link-lost timer sees traffic', async () => {
    const socket = await open();
    socket.write(codec.ping(1));
    const answer = await readFrame(socket, 3000);
    socket.destroy();
    expect(answer.length).toBeGreaterThan(0);
    expect(answer[3]).toBe(0x03); // a status frame
  });

  it('streams pulses after the Start the codec builds, in dBmV, and stops after its Stop', async () => {
    const socket = await open();
    const collected: Uint8Array[] = [];
    socket.on('data', (data) => collected.push(new Uint8Array(data)));
    const everything = (): Uint8Array => {
      const all = new Uint8Array(collected.reduce((n, c) => n + c.length, 0));
      let at = 0;
      for (const c of collected) {
        all.set(c, at);
        at += c.length;
      }
      return all;
    };
    const pulseFrames = (): number => splitFrames(everything()).frames.filter((f) => f[3] === 0x10).length;

    socket.write(codec.hello(1, Date.now()));
    socket.write(codec.start(2));
    await new Promise((resolve) => setTimeout(resolve, 1300));
    socket.write(codec.stop(3));
    await new Promise((resolve) => setTimeout(resolve, 300));
    const pulseFramesAtStop = pulseFrames();
    await new Promise((resolve) => setTimeout(resolve, 700));
    const { frames, rest } = splitFrames(everything());
    const pulseFramesLater = pulseFrames();
    socket.destroy();

    expect(rest, 'every byte belongs to a whole frame').toHaveLength(0);
    const decoded = frames.filter((f) => f[3] !== 0x02).map((f) => codec.stream(f));
    const batches = decoded.flatMap((f) => (f.kind === 'events' ? [f.events] : []));
    const statuses = decoded.flatMap((f) => (f.kind === 'status' ? [f.status] : []));
    expect(batches.length).toBeGreaterThanOrEqual(10);
    const pulses = batches.flat();
    // The mock's pulses are 50 to 4000 counts: 5 mV to 400 mV, 14 to 52 dBmV with the placeholder calibration.
    expect(pulses.every((p) => p.ampDbmV >= 13.9 && p.ampDbmV <= 52.1)).toBe(true);
    expect(pulses.every((p) => p.phase >= 0 && p.phase <= 65535)).toBe(true);
    expect(new Set(pulses.map((p) => p.polarity))).toEqual(new Set([0, 1]));
    expect(statuses.length).toBeGreaterThanOrEqual(1);
    for (const s of statuses) {
      expect(s.mainsLock).toBe(true);
      expect(s.synthetic, 'the mock says its data is generated').toBe(true);
      expect(s.noiseFloorDbmV).toBeGreaterThan(15);
      expect(s.noiseFloorDbmV).toBeLessThan(19);
    }
    expect(pulseFramesLater, 'no pulses once Stop has been sent').toBe(pulseFramesAtStop);
  });
});
