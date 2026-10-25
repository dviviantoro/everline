/**
 * The real `CantolLink` (ADR-003). The Android plugin moves bytes; this decides what to send and
 * what the answers mean, with every frame built and read by the Rust codec (WASM).
 *
 * Discovery order, as in the ADR: the last address that worked, then the UDP beacon and a scan of
 * the hotspot subnet together, then a manual address. Whatever is found is only a candidate until
 * it answers a HELLO with a PONG that echoes our nonce.
 */
import { LinkProtocolError, type LinkCodec } from '../core/linkCodec';
import type {
  CantolCandidate,
  CantolHandlers,
  CantolLink,
  DiagnosticRow,
  LinkState,
  PingResult,
  Unsubscribe,
} from '../core/links';
import type { CantolLinkNative, LinkStatus } from './plugins';

export interface FieldLinkOptions {
  native: CantolLinkNative;
  codec: LinkCodec;
  tcpPort: number;
  beaconPort: number;
  /** The phone's clock in epoch milliseconds (Cantol has no clock of its own). */
  now: () => number;
  /** A number in [0, 1); only the HELLO nonce comes from it. */
  random?: () => number;
  /** Pause between search rounds. */
  roundPauseMs?: number;
}

/** Heartbeat period of the held link; a Cantol that stays silent for one period is lost. */
export const HEARTBEAT_MS = 2000;
const BEACON_LISTEN_MS = 1500;
const PINGS = 3;

export function abortError(): Error {
  return Object.assign(new Error('The search was stopped.'), { name: 'AbortError' });
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

export function toBase64(bytes: Uint8Array): string {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

export function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[middle] ?? 0) : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/** One decimal, because the Ready screen prints it as it is. */
const oneDecimal = (value: number): number => Math.round(value * 10) / 10;

/** What a person can act on, from whatever the plugin or the codec threw. */
export function describeLinkError(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'timeout') return 'Cantol did not answer in time.';
  if (code === 'refused') return 'Nothing is listening on the Cantol port at that address.';
  if (error instanceof LinkProtocolError) {
    return error.code === 'no_frame' ? 'The device answered, but not as a Cantol does.' : error.message;
  }
  return error instanceof Error && error.message !== '' ? error.message : 'The attempt failed.';
}

interface Held {
  address: string;
  deviceId: string;
  protocol: number;
  rttMs: number;
}

export function createFieldLink(options: FieldLinkOptions): CantolLink {
  const { native, codec, tcpPort, beaconPort, now } = options;
  const random = options.random ?? Math.random;
  const roundPauseMs = options.roundPauseMs ?? 500;

  const handlers = new Set<CantolHandlers>();
  let nativeListener: Promise<{ remove: () => Promise<void> }> | null = null;
  let held: Held | null = null;
  let lastProtocol = 1;
  let lastAttempt = 'none yet';

  const emit = (state: LinkState): void => {
    for (const handler of handlers) handler.onLinkState(state);
  };

  /** HELLO to one address; resolves only for a PONG that echoes our nonce. */
  const handshake = async (address: string) => {
    const nonce = Math.floor(random() * 0x1_0000_0000) >>> 0;
    const reply = await native.exchange({
      host: address,
      port: tcpPort,
      dataB64: toBase64(codec.hello(nonce, now())),
    });
    const pong = codec.pong(fromBase64(reply.replyB64));
    if (pong.nonce !== nonce) throw new LinkProtocolError('nonce_mismatch');
    lastProtocol = pong.protocol;
    return { pong, rttMs: reply.rttMs };
  };

  /** The first address that answers properly, or null; a failure is noted, not thrown. */
  const firstThatAnswers = async (addresses: readonly string[], signal: AbortSignal): Promise<CantolCandidate | null> => {
    for (const address of addresses) {
      throwIfAborted(signal);
      try {
        const { pong } = await handshake(address);
        lastAttempt = `${address}: answered as ${pong.deviceId}`;
        return { address, deviceId: pong.deviceId };
      } catch (error) {
        lastAttempt = `${address}: ${describeLinkError(error)}`;
      }
    }
    return null;
  };

  const beaconHost = async (): Promise<string | null> => {
    try {
      const heard = await native.listenBeacon({ port: beaconPort, timeoutMs: BEACON_LISTEN_MS });
      if (heard.from === undefined || heard.dataB64 === undefined) return null;
      return codec.beacon(fromBase64(heard.dataB64)) === null ? null : heard.from;
    } catch {
      return null;
    }
  };

  const automaticRound = async (signal: AbortSignal): Promise<CantolCandidate | null> => {
    const lastKnown = await native.getLastKnown().then(
      (known) => known.address,
      () => undefined,
    );
    if (lastKnown !== undefined) {
      const candidate = await firstThatAnswers([lastKnown], signal);
      if (candidate !== null) return candidate;
    }
    throwIfAborted(signal);
    const [beacon, scanned] = await Promise.all([
      beaconHost(),
      native.scan({ port: tcpPort }).catch(() => ({ scanned: 0, hosts: [] as string[] })),
    ]);
    const addresses = [...new Set([...(beacon === null ? [] : [beacon]), ...scanned.hosts])].filter((a) => a !== lastKnown);
    if (addresses.length === 0 && scanned.scanned === 0) lastAttempt = 'no hotspot interface found to search';
    return firstThatAnswers(addresses, signal);
  };

  const ensureNativeListener = (): void => {
    nativeListener ??= native.addListener('linkState', (event) => {
      emit(event.state);
    });
  };

  return {
    async discover({ manualAddress, signal }) {
      for (;;) {
        throwIfAborted(signal);
        const candidate =
          manualAddress === undefined ? await automaticRound(signal) : await firstThatAnswers([manualAddress], signal);
        if (candidate !== null) return candidate;
        await sleep(roundPauseMs, signal);
      }
    },

    async ping(candidate, signal) {
      // While the held link is healthy, its own heartbeat already is the answer: opening a second
      // connection to a device that may accept only one would risk the link we have.
      const status = await native.linkStatus().catch((): LinkStatus => ({ connected: false }));
      if (
        held !== null &&
        status.connected &&
        status.host === candidate.address &&
        held.address === candidate.address &&
        (status.lastRxAgeMs ?? -1) >= 0 &&
        (status.lastRxAgeMs ?? Infinity) <= 2 * HEARTBEAT_MS
      ) {
        return { rttMs: oneDecimal(held.rttMs), deviceId: held.deviceId, protocol: held.protocol };
      }
      const samples: number[] = [];
      let answer: PingResult | null = null;
      let lastError: unknown = null;
      for (let i = 0; i < PINGS; i += 1) {
        throwIfAborted(signal);
        try {
          const { pong, rttMs } = await handshake(candidate.address);
          samples.push(rttMs);
          answer = { rttMs: 0, deviceId: pong.deviceId, protocol: pong.protocol };
        } catch (error) {
          if (isAbort(error)) throw error;
          lastError = error;
        }
      }
      throwIfAborted(signal);
      if (answer === null) throw new Error(describeLinkError(lastError));
      return { ...answer, rttMs: oneDecimal(median(samples)) };
    },

    async connect(candidate) {
      ensureNativeListener();
      const result = await native.connect({
        host: candidate.address,
        port: tcpPort,
        heartbeatB64: toBase64(codec.ping(1)),
        intervalMs: HEARTBEAT_MS,
      });
      held = { address: candidate.address, deviceId: candidate.deviceId, protocol: lastProtocol, rttMs: result.rttMs };
    },

    async disconnect() {
      held = null;
      await native.disconnect();
    },

    startStream() {
      // TASK-006: the live pipeline. The app does not offer measurement in this build.
      return Promise.reject(new Error('Live measurement is not part of this release.'));
    },

    stopStream() {
      return Promise.resolve();
    },

    subscribe(next): Unsubscribe {
      handlers.add(next);
      ensureNativeListener();
      return () => {
        handlers.delete(next);
      };
    },

    async diagnostics(): Promise<DiagnosticRow[]> {
      const rows: DiagnosticRow[] = [
        { label: 'Cantol ports', value: `TCP ${String(tcpPort)}, beacon UDP ${String(beaconPort)}` },
        { label: 'Last attempt', value: lastAttempt },
      ];
      try {
        rows.push(...(await native.diagnostics()).rows);
      } catch (error) {
        rows.push({ label: 'Phone details', value: describeLinkError(error) });
      }
      return rows;
    },
  };
}
