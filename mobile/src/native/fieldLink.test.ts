import { describe, expect, it } from 'vitest';

import { nodeCodec } from '../test/dspNode';
import { base64ToBytes, bytesToBase64, frameOf, helloNonce, KIND, pongPayload } from '../test/frames';
import { createFieldLink, describeLinkError, fromBase64, HEARTBEAT_MS, toBase64 } from './fieldLink';
import type { CantolLinkNative, LinkStateEvent, LinkStatus } from './plugins';

type Behaviour = 'cantol' | 'refuse' | 'timeout' | 'http' | 'wrong-nonce' | 'refusal';

interface Exchange {
  host: string;
  port: number;
  frame: Uint8Array;
}

/**
 * A scriptable phone network. `devices` says what answers at each address; the replies are real
 * frames, so they go through the real WASM codec on the way back.
 */
type Device = Behaviour | { behaviour: Behaviour; rttMs: number; deviceId?: string };
type ExchangeOptions = Parameters<CantolLinkNative['exchange']>[0];
type ExchangeResult = Awaited<ReturnType<CantolLinkNative['exchange']>>;
interface ConnectCall {
  host: string;
  port: number;
  heartbeatB64: string;
  intervalMs?: number;
}

function world(devices: Record<string, Device> = {}) {
  const exchanges: Exchange[] = [];
  const linkListeners: ((event: LinkStateEvent) => void)[] = [];
  const scanHosts: string[][] = [];
  const calls = { scan: 0, listenBeacon: 0, connect: [] as ConnectCall[], disconnect: 0, addListener: 0 };
  const state = {
    lastKnown: undefined as string | undefined,
    beacon: null as { from: string; dataB64: string } | null,
    scanRounds: 0,
    status: { connected: false } as LinkStatus,
    /** Replaces the scripted devices for one test. */
    exchange: null as ((options: ExchangeOptions) => Promise<ExchangeResult>) | null,
    diagnosticsError: null as Error | null,
  };
  const native: CantolLinkNative = {
    scan: () => {
      calls.scan += 1;
      const hosts = scanHosts[Math.min(state.scanRounds, scanHosts.length - 1)] ?? [];
      state.scanRounds += 1;
      return Promise.resolve({ subnet: '192.168.43.1/24', scanned: 253, hosts });
    },
    listenBeacon: () => {
      calls.listenBeacon += 1;
      return Promise.resolve(state.beacon ?? { timedOut: true });
    },
    exchange: (options) => {
      if (state.exchange !== null) {
        exchanges.push({ host: options.host, port: options.port, frame: base64ToBytes(options.dataB64) });
        return state.exchange(options);
      }
      const frame = base64ToBytes(options.dataB64);
      exchanges.push({ host: options.host, port: options.port, frame });
      const entry = devices[options.host];
      const spec = typeof entry === 'string' ? { behaviour: entry, rttMs: 4 } : entry;
      if (spec === undefined || spec.behaviour === 'refuse') return Promise.reject(Object.assign(new Error('Connection refused'), { code: 'refused' }));
      if (spec.behaviour === 'timeout') return Promise.reject(Object.assign(new Error('Read timed out'), { code: 'timeout' }));
      const nonce = helloNonce(frame);
      const reply =
        spec.behaviour === 'http'
          ? new TextEncoder().encode('HTTP/1.1 400 Bad Request\r\n\r\n')
          : spec.behaviour === 'refusal'
            ? frameOf(KIND.error, new Uint8Array([2]))
            : frameOf(KIND.pong, pongPayload(spec.deviceId ?? 'CANTOL-1', spec.behaviour === 'wrong-nonce' ? nonce ^ 1 : nonce));
      return Promise.resolve({ replyB64: bytesToBase64(reply), rttMs: spec.rttMs });
    },
    connect: (options) => {
      calls.connect.push(options);
      return Promise.resolve({ rttMs: 3.2 });
    },
    disconnect: () => {
      calls.disconnect += 1;
      return Promise.resolve();
    },
    linkStatus: () => Promise.resolve(state.status),
    getLastKnown: () => Promise.resolve(state.lastKnown === undefined ? {} : { address: state.lastKnown }),
    setLastKnown: () => Promise.resolve(),
    diagnostics: () =>
      state.diagnosticsError === null
        ? Promise.resolve({ rows: [{ label: 'Hotspot interface', value: 'ap0 192.168.43.1/24' }] })
        : Promise.reject(state.diagnosticsError),
    addListener: (_event, listener) => {
      calls.addListener += 1;
      linkListeners.push(listener);
      return Promise.resolve({ remove: () => Promise.resolve() });
    },
  };
  return {
    native,
    exchanges,
    calls,
    state,
    scanHosts,
    emit: (event: LinkStateEvent) => {
      for (const l of linkListeners) l(event);
    },
  };
}

const beaconFrom = (from: string) => {
  const datagram = new Uint8Array(18);
  datagram.set(new TextEncoder().encode('CNTL'), 0);
  datagram[4] = 1;
  datagram.set(new TextEncoder().encode('CANTOL-1'), 5);
  new DataView(datagram.buffer).setUint16(13, 47000, true);
  return { from, dataB64: bytesToBase64(datagram) };
};

function link(w: ReturnType<typeof world>, extra: { random?: () => number } = {}) {
  return createFieldLink({
    native: w.native,
    codec: nodeCodec(),
    tcpPort: 47000,
    beaconPort: 47001,
    now: () => 1_760_000_000_000,
    roundPauseMs: 5,
    ...extra,
  });
}

const never = () => new AbortController().signal;

/** The item at `index`, or a failure that says so (no non-null assertions in this project). */
function at<T>(items: readonly T[], index = 0): T {
  const item = items[index];
  if (item === undefined) throw new Error(`expected an item at ${String(index)}, there are ${String(items.length)}`);
  return item;
}

/** A PONG for whatever HELLO arrives, with the round trip given. */
function pongFor(rttMs: number, deviceId = 'CANTOL-1') {
  return (options: ExchangeOptions): Promise<ExchangeResult> => {
    const nonce = helloNonce(base64ToBytes(options.dataB64));
    return Promise.resolve({ replyB64: bytesToBase64(frameOf(KIND.pong, pongPayload(deviceId, nonce))), rttMs });
  };
}

describe('discovery', () => {
  it('finds Cantol on the scanned subnet and skips hosts that are not it', async () => {
    const w = world({ '192.168.43.2': 'refuse', '192.168.43.3': 'http', '192.168.43.4': 'wrong-nonce', '192.168.43.5': { behaviour: 'cantol', rttMs: 4, deviceId: 'CANTOL-7' } });
    w.scanHosts.push(['192.168.43.2', '192.168.43.3', '192.168.43.4', '192.168.43.5']);
    const found = await link(w).discover({ signal: never() });
    expect(found).toEqual({ address: '192.168.43.5', deviceId: 'CANTOL-7' });
    expect(w.exchanges.map((e) => e.host)).toEqual(['192.168.43.2', '192.168.43.3', '192.168.43.4', '192.168.43.5']);
    expect(w.exchanges.every((e) => e.port === 47000)).toBe(true);
  });

  it('tries the last address that worked first, and then does not scan at all', async () => {
    const w = world({ '192.168.43.9': 'cantol' });
    w.state.lastKnown = '192.168.43.9';
    const found = await link(w).discover({ signal: never() });
    expect(found.address).toBe('192.168.43.9');
    expect(w.calls.scan).toBe(0);
    expect(w.calls.listenBeacon).toBe(0);
  });

  it('tries the host that sent a beacon before the scanned ones', async () => {
    const w = world({ '192.168.43.2': 'cantol', '192.168.43.8': 'cantol' });
    w.state.beacon = beaconFrom('192.168.43.8');
    w.scanHosts.push(['192.168.43.2']);
    const found = await link(w).discover({ signal: never() });
    expect(found.address).toBe('192.168.43.8');
    expect(w.exchanges.map((e) => e.host)).toEqual(['192.168.43.8']);
  });

  it('ignores a datagram on the beacon port that is not a Cantol beacon', async () => {
    const w = world({ '192.168.43.2': 'cantol' });
    w.state.beacon = { from: '192.168.43.77', dataB64: bytesToBase64(new TextEncoder().encode('M-SEARCH * HTTP/1.1')) };
    w.scanHosts.push(['192.168.43.2']);
    expect((await link(w).discover({ signal: never() })).address).toBe('192.168.43.2');
    expect(w.exchanges.map((e) => e.host)).toEqual(['192.168.43.2']);
  });

  it('keeps searching, round after round, until Cantol appears', async () => {
    const w = world({ '192.168.43.6': 'cantol' });
    w.scanHosts.push([], [], ['192.168.43.6']);
    const found = await link(w).discover({ signal: never() });
    expect(found.address).toBe('192.168.43.6');
    expect(w.state.scanRounds).toBe(3);
  });

  it('with a manual address, looks only there', async () => {
    const w = world({ '10.9.9.9': 'cantol', '192.168.43.2': 'cantol' });
    w.scanHosts.push(['192.168.43.2']);
    const found = await link(w).discover({ manualAddress: '10.9.9.9', signal: never() });
    expect(found.address).toBe('10.9.9.9');
    expect(w.calls.scan).toBe(0);
  });

  it('stops with an AbortError when told to, even while it is waiting', async () => {
    const w = world({});
    const controller = new AbortController();
    const search = link(w).discover({ manualAddress: '10.1.1.1', signal: controller.signal });
    setTimeout(() => {
      controller.abort();
    }, 30);
    await expect(search).rejects.toMatchObject({ name: 'AbortError' });
    const calls = w.exchanges.length;
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(w.exchanges.length, 'no attempts after the abort').toBe(calls);
  });

  it('does not start if the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const w = world({ '1.1.1.1': 'cantol' });
    await expect(link(w).discover({ manualAddress: '1.1.1.1', signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(w.exchanges).toHaveLength(0);
  });
});

describe('ping', () => {
  it('reports the median round trip of three HELLOs, to one decimal', async () => {
    const w = world();
    const rtts = [9, 2.04, 4.26];
    let i = 0;
    w.state.exchange = (options) => pongFor(rtts[i++] ?? 0)(options);
    const result = await link(w).ping({ address: '192.168.43.5', deviceId: '' }, never());
    expect(result).toEqual({ rttMs: 4.3, deviceId: 'CANTOL-1', protocol: 1 });
    expect(i).toBe(3);
  });

  it('each HELLO carries a fresh nonce and the phone clock', async () => {
    const w = world({ '10.0.0.2': 'cantol' });
    let n = 0;
    await link(w, { random: () => (++n * 0.1) % 1 }).ping({ address: '10.0.0.2', deviceId: '' }, never());
    const nonces = w.exchanges.map((e) => helloNonce(e.frame));
    expect(new Set(nonces).size).toBe(3);
    const first = at(w.exchanges).frame;
    const clock = new DataView(first.buffer, first.byteOffset).getBigUint64(21 + 6, true);
    expect(clock).toBe(1_760_000_000_000n);
  });

  it('still answers when one of the three fails, using the ones that worked', async () => {
    const w = world();
    let i = 0;
    w.state.exchange = (options) => (i++ === 1 ? Promise.reject(Object.assign(new Error('x'), { code: 'timeout' })) : pongFor(6)(options));
    expect((await link(w).ping({ address: '10.0.0.2', deviceId: '' }, never())).rttMs).toBe(6);
  });

  it.each([
    ['timeout', 'Cantol did not answer in time.'],
    ['refuse', 'Nothing is listening on the Cantol port at that address.'],
    ['http', 'The device answered, but not as a Cantol does.'],
  ] as const)('says something a person can act on when the device is %s', async (behaviour, text) => {
    const w = world({ '10.0.0.2': behaviour });
    await expect(link(w).ping({ address: '10.0.0.2', deviceId: '' }, never())).rejects.toThrow(text);
  });

  it('reports a refusal from Cantol itself', async () => {
    const w = world({ '10.0.0.2': 'refusal' });
    await expect(link(w).ping({ address: '10.0.0.2', deviceId: '' }, never())).rejects.toThrow(/device_error/);
  });

  it('leaves the held connection alone while its heartbeat is fresh', async () => {
    const w = world({ '10.0.0.2': { behaviour: 'cantol', rttMs: 4, deviceId: 'CANTOL-9' } });
    const l = link(w);
    await l.connect({ address: '10.0.0.2', deviceId: 'CANTOL-9' });
    w.state.status = { connected: true, host: '10.0.0.2', lastRxAgeMs: 500, rttMs: 3.2 };
    const before = w.exchanges.length;
    expect(await l.ping({ address: '10.0.0.2', deviceId: '' }, never())).toEqual({ rttMs: 3.2, deviceId: 'CANTOL-9', protocol: 1 });
    expect(w.exchanges.length, 'no second connection to a device that may take only one').toBe(before);
  });

  it('does a real HELLO when the held link has gone quiet or is lost', async () => {
    const w = world({ '10.0.0.2': 'cantol' });
    const l = link(w);
    await l.connect({ address: '10.0.0.2', deviceId: 'CANTOL-1' });
    w.state.status = { connected: true, host: '10.0.0.2', lastRxAgeMs: 2 * HEARTBEAT_MS + 1, rttMs: 3.2 };
    await l.ping({ address: '10.0.0.2', deviceId: '' }, never());
    expect(w.exchanges).toHaveLength(3);
    w.exchanges.length = 0;
    w.state.status = { connected: false };
    await l.ping({ address: '10.0.0.2', deviceId: '' }, never());
    expect(w.exchanges).toHaveLength(3);
  });

  it('stops between HELLOs when aborted', async () => {
    const w = world({ '10.0.0.2': 'cantol' });
    const controller = new AbortController();
    const done = link(w).ping({ address: '10.0.0.2', deviceId: '' }, controller.signal);
    controller.abort();
    await expect(done).rejects.toMatchObject({ name: 'AbortError' });
    expect(w.exchanges.length).toBeLessThan(3);
  });
});

describe('the held link', () => {
  it('connects with a keep-alive frame built by the codec', async () => {
    const w = world();
    await link(w).connect({ address: '10.0.0.2', deviceId: 'CANTOL-1' });
    expect(w.calls.connect).toHaveLength(1);
    const call = at(w.calls.connect);
    expect([call.host, call.port, call.intervalMs]).toEqual(['10.0.0.2', 47000, HEARTBEAT_MS]);
    const heartbeat = base64ToBytes(call.heartbeatB64);
    expect(heartbeat[3]).toBe(KIND.ping);
    expect(heartbeat).toHaveLength(25);
  });

  it('passes the native lost and up events to whoever subscribed, until they stop', async () => {
    const w = world();
    const l = link(w);
    const seen: string[] = [];
    const stop = l.subscribe({ onEvents: () => undefined, onStatus: () => undefined, onLinkState: (s) => seen.push(s) });
    await Promise.resolve();
    w.emit({ state: 'lost', detail: 'no answer within 2000 ms' });
    w.emit({ state: 'up' });
    stop();
    w.emit({ state: 'lost' });
    expect(seen).toEqual(['lost', 'up']);
    expect(w.calls.addListener).toBe(1);
  });

  it('disconnect tells the plugin and forgets the held link', async () => {
    const w = world({ '10.0.0.2': 'cantol' });
    const l = link(w);
    await l.connect({ address: '10.0.0.2', deviceId: 'CANTOL-1' });
    await l.disconnect();
    expect(w.calls.disconnect).toBe(1);
    w.state.status = { connected: true, host: '10.0.0.2', lastRxAgeMs: 10 };
    await l.ping({ address: '10.0.0.2', deviceId: '' }, never());
    expect(w.exchanges, 'a real HELLO, not the forgotten held link').toHaveLength(3);
  });

  it('does not stream in this release', async () => {
    const l = link(world());
    await expect(l.startStream()).rejects.toThrow('not part of this release');
    await expect(l.stopStream()).resolves.toBeUndefined();
  });
});

describe('diagnostics', () => {
  it('adds the app side to what the phone reports', async () => {
    const w = world({ '10.0.0.2': 'refuse' });
    const l = link(w);
    await l.ping({ address: '10.0.0.2', deviceId: '' }, never()).catch(() => undefined);
    const rows = await l.diagnostics();
    expect(rows.map((r) => r.label)).toEqual(['Cantol ports', 'Last attempt', 'Hotspot interface']);
    expect(rows[0]?.value).toBe('TCP 47000, beacon UDP 47001');
  });

  it('still answers when the plugin cannot', async () => {
    const w = world();
    w.state.diagnosticsError = new Error('plugin missing');
    const rows = await link(w).diagnostics();
    expect(rows.at(-1)).toEqual({ label: 'Phone details', value: 'plugin missing' });
  });
});

describe('helpers', () => {
  it('base64 round-trips bytes, including large ones', () => {
    const big = Uint8Array.from({ length: 70_000 }, (_, i) => i % 256);
    expect(fromBase64(toBase64(big))).toEqual(big);
    expect(toBase64(new Uint8Array())).toBe('');
  });

  it('describeLinkError never returns an empty string', () => {
    expect(describeLinkError(null)).toBe('The attempt failed.');
    expect(describeLinkError(new Error(''))).toBe('The attempt failed.');
    expect(describeLinkError(new Error('boom'))).toBe('boom');
    expect(describeLinkError(Object.assign(new Error('x'), { code: 'timeout' }))).toBe('Cantol did not answer in time.');
  });
});
