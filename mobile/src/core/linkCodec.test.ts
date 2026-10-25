import { crc32 } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { nodeCodec } from '../test/dspNode';
import { LinkProtocolError } from './linkCodec';

/** Layout from `cantol-proto/src/frame.rs`: magic u16, ver, kind, flags, seq u32, ts_us u64, len u32, payload, crc32 u32. */
const HEADER_LEN = 21;
const CRC_LEN = 4;

/**
 * A frame built here with Node's own CRC32, not by the Rust encoder, so the test also proves the
 * two CRC implementations agree. The layout is repeated by hand on purpose.
 */
function frameOf(kind: number, payload: Uint8Array): Uint8Array {
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

function pongPayload(deviceId: string, nonce: number): Uint8Array {
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

describe('link codec', () => {
  const codec = nodeCodec();

  it('hello is a valid HELLO frame carrying the nonce and the phone clock', () => {
    const bytes = codec.hello(0xdeadbeef, 1_760_000_000_123);
    expect(bytes).toHaveLength(HEADER_LEN + 14 + CRC_LEN);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect([view.getUint16(0, true), bytes[2], bytes[3]]).toEqual([0xca57, 1, 0x01]);
    expect(view.getUint32(17, true)).toBe(14);
    expect(view.getUint32(HEADER_LEN + 2, true)).toBe(0xdeadbeef); // payload: proto_min, proto_max, nonce
    expect(view.getBigUint64(HEADER_LEN + 6, true)).toBe(1_760_000_000_123n);
    expect(view.getUint32(bytes.length - CRC_LEN, true)).toBe(crc32(bytes.subarray(0, bytes.length - CRC_LEN)));
  });

  it('ping is an empty keep-alive frame', () => {
    const bytes = codec.ping(5);
    expect(bytes).toHaveLength(HEADER_LEN + CRC_LEN);
    expect(bytes[3]).toBe(0x30);
    expect(new DataView(bytes.buffer, bytes.byteOffset).getUint32(5, true)).toBe(5);
  });

  it('pong reads an answer built independently of the Rust encoder', () => {
    const pong = codec.pong(frameOf(0x02, pongPayload('RP-MOCK', 7)));
    expect(pong).toEqual({
      protocol: 1,
      deviceId: 'RP-MOCK',
      firmware: '0.1.0',
      caps: 3,
      nonce: 7,
      cantolEpochMs: 1_760_000_000_000,
    });
  });

  it('pong tells the caller why an answer is unusable', () => {
    const code = (bytes: Uint8Array): string => {
      try {
        codec.pong(bytes);
      } catch (error) {
        if (error instanceof LinkProtocolError) return error.code;
        throw error;
      }
      return 'no error';
    };
    expect(code(new Uint8Array())).toBe('no_frame');
    expect(code(new TextEncoder().encode('HTTP/1.1 400 Bad Request\r\n\r\n'))).toBe('no_frame');
    const whole = frameOf(0x02, pongPayload('RP-MOCK', 7));
    expect(code(whole.subarray(0, whole.length - 1))).toBe('no_frame');
    const corrupt = whole.slice();
    corrupt[HEADER_LEN + 3] = (corrupt[HEADER_LEN + 3] ?? 0) ^ 1;
    expect(code(corrupt)).toBe('no_frame');
    expect(code(frameOf(0x7f, new Uint8Array([2])))).toBe('device_error');
    expect(code(frameOf(0x03, new Uint8Array(20)))).toBe('unexpected_frame');
  });

  it('a device error carries Cantol\'s code in the message', () => {
    expect(() => codec.pong(frameOf(0x7f, new Uint8Array([2])))).toThrow(/device_error.*code 2/);
  });

  it('beacon reads a datagram, and returns null for anything else on the port', () => {
    const datagram = new Uint8Array(18);
    datagram.set(new TextEncoder().encode('CNTL'), 0);
    datagram[4] = 1;
    datagram.set(new TextEncoder().encode('RP-MOCK'), 5);
    new DataView(datagram.buffer).setUint16(13, 47000, true);
    datagram.set([0, 1, 0], 15);
    expect(codec.beacon(datagram)).toEqual({ protocol: 1, deviceId: 'RP-MOCK', tcpPort: 47000, firmware: '0.1.0' });
    expect(codec.beacon(new TextEncoder().encode('M-SEARCH * HTTP/1.1'))).toBeNull();
    expect(codec.beacon(new Uint8Array())).toBeNull();
  });
});
