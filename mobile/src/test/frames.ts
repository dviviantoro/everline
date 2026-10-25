/**
 * Frames built by hand with Node's own CRC32, not by the Rust encoder, so a test that reads them
 * through the WASM codec also proves the two implementations agree. The layout is repeated here
 * on purpose (`cantol-proto/src/frame.rs`): magic u16, ver, kind, flags, seq u32, ts_us u64,
 * len u32, payload, crc32 u32.
 */
import { crc32 } from 'node:zlib';

export const HEADER_LEN = 21;
export const CRC_LEN = 4;
export const KIND = { hello: 0x01, pong: 0x02, status: 0x03, error: 0x7f, ping: 0x30 } as const;

export function frameOf(kind: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(HEADER_LEN + payload.length + CRC_LEN);
  const view = new DataView(out.buffer);
  view.setUint16(0, 0xca57, true);
  out[2] = 1;
  out[3] = kind;
  view.setUint32(17, payload.length, true);
  out.set(payload, HEADER_LEN);
  view.setUint32(HEADER_LEN + payload.length, crc32(out.subarray(0, HEADER_LEN + payload.length)), true);
  return out;
}

export function pongPayload(deviceId: string, nonce: number): Uint8Array {
  const p = new Uint8Array(26);
  const view = new DataView(p.buffer);
  p[0] = 1; // proto
  view.setUint16(1, 0b11, true); // caps
  p.set([0, 1, 0], 3); // fw
  p.set(new TextEncoder().encode(deviceId).subarray(0, 8), 6);
  view.setBigUint64(14, 1_760_000_000_000n, true);
  view.setUint32(22, nonce, true);
  return p;
}

/** The nonce inside a HELLO frame the app built (payload: proto_min, proto_max, nonce u32, clock u64). */
export function helloNonce(frame: Uint8Array): number {
  return new DataView(frame.buffer, frame.byteOffset, frame.byteLength).getUint32(HEADER_LEN + 2, true);
}

export const bytesToBase64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');
export const base64ToBytes = (text: string): Uint8Array => new Uint8Array(Buffer.from(text, 'base64'));
