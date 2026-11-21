/**
 * The app's view of the protocol helpers in `cantol-wasm`: the frames the phone sends and the
 * decoded answers. The Android plugin only moves bytes; every byte it sends comes from here and
 * every byte it returns is read here, so framing, CRC and message meaning stay in Rust.
 */

import type { CantolStatus, PdEventSample } from './links';

/** The slice of the generated wasm-bindgen module that the link uses. */
export interface WasmLinkApi {
  encode_hello(nonce: number, phoneEpochMs: number): Uint8Array;
  encode_ping(seq: number): Uint8Array;
  encode_start(seq: number): Uint8Array;
  encode_stop(seq: number): Uint8Array;
  decode_pong(bytes: Uint8Array): string;
  decode_beacon(datagram: Uint8Array): string;
  decode_stream_frame(bytes: Uint8Array): string;
}

/** Cantol's answer to a HELLO. */
export interface PongInfo {
  protocol: number;
  deviceId: string;
  firmware: string;
  caps: number;
  nonce: number;
  cantolEpochMs: number;
  /** The unit's MAC address (`00:26:32:F0:1A:BC`), or null when it did not report one. */
  mac: string | null;
}

/** One UDP discovery beacon. */
export interface BeaconInfo {
  protocol: number;
  deviceId: string;
  tcpPort: number;
  firmware: string;
  /** The unit's MAC address, or null when the beacon carries none. */
  mac: string | null;
}

/**
 * Why an answer could not be used. `no_frame` means nothing complete and valid arrived (a
 * truncated or corrupted answer, or something that is not Cantol); `device_error` means Cantol
 * answered and refused (for example a protocol version it does not speak).
 */
export class LinkProtocolError extends Error {
  readonly code: string;

  constructor(code: string, detail?: string) {
    super(detail === undefined ? `Cantol link: ${code}` : `Cantol link: ${code} (${detail})`);
    this.name = 'LinkProtocolError';
    this.code = code;
  }
}

/** What one frame that arrives on the held link means to the live screens, amplitudes already in dBmV. */
export type StreamFrame =
  | { kind: 'status'; status: CantolStatus }
  | { kind: 'events'; events: PdEventSample[]; droppedBefore: boolean }
  /** Cantol answered with an Error frame. */
  | { kind: 'device_error'; code: number }
  /** A frame the stream does not need: a pong, a waveform, a kind from a newer protocol. */
  | { kind: 'other'; frameKind: number };

export interface LinkCodec {
  /** The first frame on a connection, and what a ping sends. */
  hello(nonce: number, phoneEpochMs: number): Uint8Array;
  /** The keep-alive repeated while linked; any frame back proves the link is alive. */
  ping(seq: number): Uint8Array;
  /** Asks Cantol to start sending pulses. */
  start(seq: number): Uint8Array;
  /** Asks Cantol to stop sending pulses; the link stays up. */
  stop(seq: number): Uint8Array;
  /** Decodes one frame of the stream, or throws `LinkProtocolError` (`no_frame`: damaged or incomplete). */
  stream(bytes: Uint8Array): StreamFrame;
  /** Decodes the answer to a HELLO, or throws `LinkProtocolError`. */
  pong(bytes: Uint8Array): PongInfo;
  /** Decodes a UDP datagram, or null when it is not a Cantol beacon. */
  beacon(datagram: Uint8Array): BeaconInfo | null;
}

interface PongJson {
  error?: string;
  code?: number;
  proto: number;
  caps: number;
  fw: string;
  device_id: string;
  cantol_epoch_ms: number;
  nonce: number;
  mac: string | null;
}

interface BeaconJson {
  error?: string;
  proto: number;
  device_id: string;
  tcp_port: number;
  fw: string;
  mac: string | null;
}

interface StreamJson {
  error?: string;
  kind?: 'status' | 'events' | 'device_error' | 'other';
  // status
  temp_c?: number;
  adc_clip_pct?: number;
  noise_floor_dbmv?: number;
  trigger_rate_hz?: number;
  queue?: number;
  mains_lock?: boolean;
  synthetic?: boolean;
  sensors?: { noise_floor_dbmv: number; trigger_rate_hz: number }[];
  // events
  dropped_before?: boolean;
  events?: { t_us: number; amp_dbmv: number; phase: number; width_ns: number; polarity: 0 | 1; ch: number }[];
  // device_error, other
  code?: number;
  frame_kind?: number;
}

function streamFrame(report: StreamJson): StreamFrame {
  if (report.error !== undefined) throw new LinkProtocolError(report.error);
  switch (report.kind) {
    case 'status':
      return {
        kind: 'status',
        status: {
          tempC: report.temp_c ?? 0,
          adcClipPct: report.adc_clip_pct ?? 0,
          noiseFloorDbmV: report.noise_floor_dbmv ?? 0,
          triggerRateHz: report.trigger_rate_hz ?? 0,
          queue: report.queue ?? 0,
          mainsLock: report.mains_lock ?? false,
          synthetic: report.synthetic ?? false,
          sensors: (report.sensors ?? []).map((s) => ({ noiseFloorDbmV: s.noise_floor_dbmv, rateHz: s.trigger_rate_hz })),
        },
      };
    case 'events':
      return {
        kind: 'events',
        droppedBefore: report.dropped_before ?? false,
        events: (report.events ?? []).map((e) => ({
          tUs: e.t_us,
          ampDbmV: e.amp_dbmv,
          phase: e.phase,
          widthNs: e.width_ns,
          polarity: e.polarity,
          sensor: e.ch,
        })),
      };
    case 'device_error':
      return { kind: 'device_error', code: report.code ?? 0 };
    default:
      return { kind: 'other', frameKind: report.frame_kind ?? 0 };
  }
}

export function makeLinkCodec(api: WasmLinkApi): LinkCodec {
  return {
    hello: (nonce, phoneEpochMs) => api.encode_hello(nonce, phoneEpochMs),
    ping: (seq) => api.encode_ping(seq),
    start: (seq) => api.encode_start(seq),
    stop: (seq) => api.encode_stop(seq),
    stream: (bytes) => streamFrame(JSON.parse(api.decode_stream_frame(bytes)) as StreamJson),
    pong: (bytes) => {
      const report = JSON.parse(api.decode_pong(bytes)) as PongJson;
      if (report.error !== undefined) {
        throw new LinkProtocolError(report.error, report.code === undefined ? undefined : `code ${String(report.code)}`);
      }
      return {
        protocol: report.proto,
        deviceId: report.device_id,
        firmware: report.fw,
        caps: report.caps,
        nonce: report.nonce,
        cantolEpochMs: report.cantol_epoch_ms,
        mac: report.mac,
      };
    },
    beacon: (datagram) => {
      const report = JSON.parse(api.decode_beacon(datagram)) as BeaconJson;
      if (report.error !== undefined) return null;
      return { protocol: report.proto, deviceId: report.device_id, tcpPort: report.tcp_port, firmware: report.fw, mac: report.mac };
    },
  };
}
