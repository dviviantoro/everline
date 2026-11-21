/**
 * Frames built by hand with Node's own CRC32, not by the Rust encoder, so a test that reads them
 * through the WASM codec also proves the two implementations agree. The layout is repeated here
 * on purpose (`cantol-proto/src/frame.rs`): magic u16, ver, kind, flags, seq u32, ts_us u64,
 * len u32, payload, crc32 u32.
 */
import { crc32 } from 'node:zlib';

export const HEADER_LEN = 21;
export const CRC_LEN = 4;
export const KIND = {
  hello: 0x01,
  pong: 0x02,
  status: 0x03,
  pdEvent: 0x10,
  start: 0x20,
  stop: 0x21,
  error: 0x7f,
  ping: 0x30,
} as const;

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

/** A PONG payload; with `mac` (six bytes) it is the 32-byte layout that reports the unit's MAC address. */
export function pongPayload(deviceId: string, nonce: number, mac?: readonly number[]): Uint8Array {
  const p = new Uint8Array(mac === undefined ? 26 : 32);
  const view = new DataView(p.buffer);
  p[0] = 1; // proto
  view.setUint16(1, 0b11, true); // caps
  p.set([0, 1, 0], 3); // fw
  p.set(new TextEncoder().encode(deviceId).subarray(0, 8), 6);
  view.setBigUint64(14, 1_760_000_000_000n, true);
  view.setUint32(22, nonce, true);
  if (mac !== undefined) p.set(mac, 26);
  return p;
}

export interface StatusFields {
  tempCx10: number;
  clipPctX10: number;
  noiseFloorCounts: number;
  triggerRateHz: number;
  queue: number;
  flags: number;
  /** Per-sensor figures: the 11-byte layout then carries a trailer with one entry each. */
  sensors?: readonly { noiseFloorCounts: number; triggerRateHz: number }[];
}

/** A STATUS payload (11 bytes, or more with per-sensor figures); flags bit 0 is the mains lock, bit 1 says the data is generated. */
export function statusPayload(f: StatusFields): Uint8Array {
  const sensors = f.sensors;
  const p = new Uint8Array(sensors === undefined ? 11 : 12 + 4 * sensors.length);
  const view = new DataView(p.buffer);
  view.setInt16(0, f.tempCx10, true);
  view.setUint16(2, f.clipPctX10, true);
  view.setUint16(4, f.noiseFloorCounts, true);
  view.setUint16(6, f.triggerRateHz, true);
  view.setUint16(8, f.queue, true);
  p[10] = f.flags;
  if (sensors !== undefined) {
    p[11] = sensors.length;
    sensors.forEach((sensor, i) => {
      view.setUint16(12 + 4 * i, sensor.noiseFloorCounts, true);
      view.setUint16(14 + 4 * i, sensor.triggerRateHz, true);
    });
  }
  return p;
}

export interface PulseFields {
  tUs: number;
  ampCounts: number;
  phase: number;
  widthNs: number;
  polarity: number;
  /** The sensor that saw it (the last byte of the event); 0 when left out. */
  channel?: number;
}

/** A PD event batch payload: a u16 count and 12 bytes per pulse. */
export function pdEventsPayload(events: readonly PulseFields[]): Uint8Array {
  const p = new Uint8Array(2 + events.length * 12);
  const view = new DataView(p.buffer);
  view.setUint16(0, events.length, true);
  events.forEach((e, i) => {
    const at = 2 + i * 12;
    view.setUint32(at, e.tUs, true);
    view.setInt16(at + 4, e.ampCounts, true);
    view.setUint16(at + 6, e.phase, true);
    view.setUint16(at + 8, e.widthNs, true);
    p[at + 10] = e.polarity;
    p[at + 11] = e.channel ?? 0;
  });
  return p;
}

/** Cuts bytes into whole frames by their length field, as the Android plugin does; the rest is a frame not yet complete. */
export function splitFrames(bytes: Uint8Array): { frames: Uint8Array[]; rest: Uint8Array } {
  const frames: Uint8Array[] = [];
  let at = 0;
  while (bytes.length - at >= HEADER_LEN) {
    const length = new DataView(bytes.buffer, bytes.byteOffset + at, HEADER_LEN).getUint32(17, true);
    const total = HEADER_LEN + length + CRC_LEN;
    if (bytes.length - at < total) break;
    frames.push(bytes.slice(at, at + total));
    at += total;
  }
  return { frames, rest: bytes.slice(at) };
}

/** The nonce inside a HELLO frame the app built (payload: proto_min, proto_max, nonce u32, clock u64). */
export function helloNonce(frame: Uint8Array): number {
  return new DataView(frame.buffer, frame.byteOffset, frame.byteLength).getUint32(HEADER_LEN + 2, true);
}

export const bytesToBase64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');
export const base64ToBytes = (text: string): Uint8Array => new Uint8Array(Buffer.from(text, 'base64'));
