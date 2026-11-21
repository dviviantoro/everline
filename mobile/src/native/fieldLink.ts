/**
 * The real `CantolLink` (ADR-003). The Android plugin moves bytes; this decides what to send and
 * what the answers mean, with every frame built and read by the Rust codec (WASM).
 *
 * Discovery order, as in the ADR: the last address that worked, then the UDP beacon and a scan of
 * the hotspot subnet together, then a manual address. Whatever is found is only a candidate until
 * it answers a HELLO with a PONG that echoes our nonce.
 *
 * Streaming: `startStream` sends a Start frame on the held link and listens for the plugin's `frame`
 * events; each is decoded by the Rust codec into a status or a batch of pulses (amplitudes already in
 * dBmV) and handed to the subscribers. A stream that was wanted is asked for again when the plugin
 * reconnects, because the device streams per connection.
 */
import { sameMac } from '../core/cantolSetup';
import { LinkProtocolError, type LinkCodec } from '../core/linkCodec';
import {
  WrongDeviceError,
  type CantolCandidate,
  type CantolHandlers,
  type CantolLink,
  type DiagnosticRow,
  type LinkState,
  type PingResult,
  type Unsubscribe,
} from '../core/links';
import type { CantolLinkNative, FrameEvent, LinkStatus } from './plugins';

export interface FieldLinkOptions {
  native: CantolLinkNative;
  codec: LinkCodec;
  tcpPort: number;
  beaconPort: number;
  /**
   * The MAC address typed from the Cantol's label, read at the moment of each handshake so an
   * edit applies at once. Only a device that reports exactly this address is accepted.
   */
  expectedMac: () => string | null;
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
  if (code === 'not_connected') return 'The Cantol link is down. It reconnects by itself; try again in a moment.';
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
  const { native, codec, tcpPort, beaconPort, expectedMac, now } = options;
  const random = options.random ?? Math.random;
  const roundPauseMs = options.roundPauseMs ?? 500;

  const handlers = new Set<CantolHandlers>();
  let nativeListener: Promise<{ remove: () => Promise<void> }> | null = null;
  let held: Held | null = null;
  let lastProtocol = 1;
  let lastAttempt = 'none yet';
  /** The first device this search round turned away for its MAC address, so `discover` can say so. */
  let turnedAway: WrongDeviceError | null = null;
  // Read through a function: TypeScript would otherwise assume the value cannot change across an await.
  const turnedAwayNow = (): WrongDeviceError | null => turnedAway;

  const emit = (state: LinkState): void => {
    for (const handler of handlers) handler.onLinkState(state);
  };

  // The stream. The device streams per connection, so `wantStream` is what a reconnect must restore.
  let wantStream = false;
  let frameListener: Promise<{ remove: () => Promise<void> }> | null = null;
  let controlSeq = 1;
  const streamStats = { frames: 0, unreadable: 0, pulses: 0, lastProblem: '', synthetic: null as boolean | null };

  const sendControl = async (frame: Uint8Array): Promise<void> => {
    controlSeq += 1;
    await native.send({ dataB64: toBase64(frame) });
  };

  const onFrame = (event: FrameEvent): void => {
    let decoded;
    try {
      decoded = codec.stream(fromBase64(event.dataB64));
    } catch (error) {
      // A damaged frame is one lost moment of data, not a reason to stop: count it for Diagnostics.
      streamStats.unreadable += 1;
      streamStats.lastProblem = describeLinkError(error);
      return;
    }
    streamStats.frames += 1;
    if (decoded.kind === 'status') {
      streamStats.synthetic = decoded.status.synthetic;
      for (const handler of handlers) handler.onStatus(decoded.status);
    } else if (decoded.kind === 'events') {
      streamStats.pulses += decoded.events.length;
      if (decoded.events.length > 0) for (const handler of handlers) handler.onEvents(decoded.events);
    } else if (decoded.kind === 'device_error') {
      streamStats.lastProblem = `Cantol reported error ${String(decoded.code)}`;
    }
  };

  const stopListeningForFrames = (): void => {
    const listener = frameListener;
    frameListener = null;
    if (listener !== null) void listener.then((handle) => handle.remove()).catch(() => undefined);
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
    // Only the unit the operator set up is accepted: whatever else answers the handshake is turned away.
    const expected = expectedMac();
    if (expected === null) throw new Error('Enter the Cantol label values before searching.');
    if (pong.mac === null || !sameMac(pong.mac, expected)) {
      throw new WrongDeviceError({
        reason: pong.mac === null ? 'mac_missing' : 'mac_mismatch',
        address,
        deviceId: pong.deviceId,
        reportedMac: pong.mac,
        expectedMac: expected,
      });
    }
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
        if (error instanceof WrongDeviceError) turnedAway ??= error;
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
      // The plugin reconnected on its own and the new connection streams nothing until asked again.
      if (event.state === 'up' && wantStream) {
        sendControl(codec.start(controlSeq)).catch((error: unknown) => {
          streamStats.lastProblem = `Start after reconnect: ${describeLinkError(error)}`;
        });
      }
      emit(event.state);
    });
  };

  return {
    async discover({ manualAddress, signal }) {
      for (;;) {
        throwIfAborted(signal);
        turnedAway = null;
        const candidate =
          manualAddress === undefined ? await automaticRound(signal) : await firstThatAnswers([manualAddress], signal);
        if (candidate !== null) return candidate;
        // A device answered but is not the one set up: say so, rather than searching in silence.
        // The caller waits a moment and calls again, so a corrected MAC address is picked up.
        const refusal = turnedAwayNow();
        if (refusal !== null) throw refusal;
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
      if (lastError instanceof WrongDeviceError) throw lastError;
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
      wantStream = false;
      stopListeningForFrames();
      await native.disconnect();
    },

    async startStream() {
      if (held === null) throw new Error('The Cantol is not connected yet.');
      // Listen first, so the first frames after Start are not missed.
      if (frameListener === null) {
        frameListener = native.addListener('frame', onFrame);
        try {
          await frameListener;
        } catch (error) {
          frameListener = null;
          throw new Error(describeLinkError(error), { cause: error });
        }
      }
      wantStream = true;
      try {
        await sendControl(codec.start(controlSeq));
      } catch (error) {
        // Not streaming after all: a later reconnect must not start something nobody is waiting for.
        wantStream = false;
        stopListeningForFrames();
        throw new Error(describeLinkError(error), { cause: error });
      }
    },

    async stopStream() {
      const wasStreaming = wantStream;
      wantStream = false;
      if (wasStreaming && held !== null) {
        // Best effort: if the link is down the device is not streaming to us anyway.
        await sendControl(codec.stop(controlSeq)).catch(() => undefined);
      }
      stopListeningForFrames();
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
        { label: 'Expected MAC', value: expectedMac() ?? 'not entered' },
        { label: 'Last attempt', value: lastAttempt },
        { label: 'Stream', value: wantStream ? 'requested' : 'off' },
        {
          label: 'Frames',
          value: `${String(streamStats.frames)} read, ${String(streamStats.unreadable)} unreadable, ${String(streamStats.pulses)} pulses${streamStats.lastProblem === '' ? '' : `; last problem: ${streamStats.lastProblem}`}`,
        },
        {
          label: 'Data',
          value:
            streamStats.synthetic === null
              ? 'none yet'
              : streamStats.synthetic
                ? 'test data, generated by the device'
                : 'from the device',
        },
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
