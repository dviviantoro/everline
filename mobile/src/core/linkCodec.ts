/**
 * The app's view of the protocol helpers in `cantol-wasm`: the frames the phone sends and the
 * decoded answers. The Android plugin only moves bytes; every byte it sends comes from here and
 * every byte it returns is read here, so framing, CRC and message meaning stay in Rust.
 */

/** The slice of the generated wasm-bindgen module that the link uses. */
export interface WasmLinkApi {
  encode_hello(nonce: number, phoneEpochMs: number): Uint8Array;
  encode_ping(seq: number): Uint8Array;
  decode_pong(bytes: Uint8Array): string;
  decode_beacon(datagram: Uint8Array): string;
}

/** Cantol's answer to a HELLO. */
export interface PongInfo {
  protocol: number;
  deviceId: string;
  firmware: string;
  caps: number;
  nonce: number;
  cantolEpochMs: number;
}

/** One UDP discovery beacon. */
export interface BeaconInfo {
  protocol: number;
  deviceId: string;
  tcpPort: number;
  firmware: string;
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

export interface LinkCodec {
  /** The first frame on a connection, and what a ping sends. */
  hello(nonce: number, phoneEpochMs: number): Uint8Array;
  /** The keep-alive repeated while linked; any frame back proves the link is alive. */
  ping(seq: number): Uint8Array;
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
}

interface BeaconJson {
  error?: string;
  proto: number;
  device_id: string;
  tcp_port: number;
  fw: string;
}

export function makeLinkCodec(api: WasmLinkApi): LinkCodec {
  return {
    hello: (nonce, phoneEpochMs) => api.encode_hello(nonce, phoneEpochMs),
    ping: (seq) => api.encode_ping(seq),
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
      };
    },
    beacon: (datagram) => {
      const report = JSON.parse(api.decode_beacon(datagram)) as BeaconJson;
      if (report.error !== undefined) return null;
      return { protocol: report.proto, deviceId: report.device_id, tcpPort: report.tcp_port, firmware: report.fw };
    },
  };
}
