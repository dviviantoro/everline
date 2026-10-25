import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createConnection, type Socket } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { nodeCodec } from '../test/dspNode';

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
});
