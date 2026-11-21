import { crc32 } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { nodeCodec } from '../test/dspNode';
import { CRC_LEN, frameOf, HEADER_LEN, KIND, pdEventsPayload, pongPayload, statusPayload } from '../test/frames';
import { LinkProtocolError } from './linkCodec';

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

  it('start and stop are empty control frames of their own kinds, with the sequence number given', () => {
    for (const [bytes, kind, seq] of [
      [codec.start(7), KIND.start, 7],
      [codec.stop(8), KIND.stop, 8],
    ] as const) {
      expect(bytes).toHaveLength(HEADER_LEN + CRC_LEN);
      expect(bytes[3]).toBe(kind);
      const view = new DataView(bytes.buffer, bytes.byteOffset);
      expect(view.getUint32(5, true)).toBe(seq);
      expect(view.getUint32(bytes.length - CRC_LEN, true)).toBe(crc32(bytes.subarray(0, bytes.length - CRC_LEN)));
    }
  });

  describe('stream frames built independently of the Rust encoder', () => {
    it('a status, in engineering units, with its two flags', () => {
      const frame = frameOf(
        KIND.status,
        statusPayload({ tempCx10: 412, clipPctX10: 3, noiseFloorCounts: 100, triggerRateHz: 300, queue: 4, flags: 0b11 }),
      );
      expect(codec.stream(frame)).toEqual({
        kind: 'status',
        status: { tempC: 41.2, adcClipPct: 0.3, noiseFloorDbmV: 20, triggerRateHz: 300, queue: 4, mainsLock: true, synthetic: true, sensors: [] },
      });
    });

    it('a batch of pulses, with the amplitude calibrated and the sign dropped', () => {
      const frame = frameOf(
        KIND.pdEvent,
        pdEventsPayload([
          { tUs: 5, ampCounts: 1000, phase: 65535, widthNs: 40, polarity: 0 },
          { tUs: 9, ampCounts: -1000, phase: 0, widthNs: 600, polarity: 1 },
        ]),
      );
      expect(codec.stream(frame)).toEqual({
        kind: 'events',
        droppedBefore: false,
        events: [
          { tUs: 5, ampDbmV: 40, phase: 65535, widthNs: 40, polarity: 0, sensor: 0 },
          { tUs: 9, ampDbmV: 40, phase: 0, widthNs: 600, polarity: 1, sensor: 0 },
        ],
      });
    });

    it('a status with per-sensor figures, and pulses that say which sensor saw them', () => {
      const status = codec.stream(
        frameOf(
          KIND.status,
          statusPayload({
            tempCx10: 410,
            clipPctX10: 0,
            noiseFloorCounts: 20,
            triggerRateHz: 300,
            queue: 0,
            flags: 0b01,
            sensors: [
              { noiseFloorCounts: 20, triggerRateHz: 200 },
              { noiseFloorCounts: 100, triggerRateHz: 100 },
            ],
          }),
        ),
      );
      expect(status).toMatchObject({
        kind: 'status',
        status: { sensors: [{ noiseFloorDbmV: 6.02, rateHz: 200 }, { noiseFloorDbmV: 20, rateHz: 100 }] },
      });
      const pulses = codec.stream(
        frameOf(
          KIND.pdEvent,
          pdEventsPayload([
            { tUs: 1, ampCounts: 100, phase: 1, widthNs: 1, polarity: 0, channel: 2 },
            { tUs: 2, ampCounts: 100, phase: 1, widthNs: 1, polarity: 0 },
          ]),
        ),
      );
      expect(pulses.kind === 'events' ? pulses.events.map((e) => e.sensor) : []).toEqual([2, 0]);
    });

    it('a frame that is damaged or does not fit its layout is an error, not a guess', () => {
      const good = frameOf(KIND.status, new Uint8Array(11));
      const damaged = good.slice();
      damaged[HEADER_LEN] = (damaged[HEADER_LEN] ?? 0) ^ 1;
      expect(() => codec.stream(damaged)).toThrow(LinkProtocolError);
      expect(() => codec.stream(good.subarray(0, good.length - 1))).toThrow('no_frame');
      expect(() => codec.stream(frameOf(KIND.status, new Uint8Array(3)))).toThrow('bad_status');
      expect(() => codec.stream(frameOf(KIND.pdEvent, new Uint8Array([2, 0, 1])))).toThrow('bad_events');
    });

    it('an error frame from the device and a frame of another kind', () => {
      expect(codec.stream(frameOf(KIND.error, new Uint8Array([3])))).toEqual({ kind: 'device_error', code: 3 });
      expect(codec.stream(frameOf(KIND.pong, pongPayload('X', 1)))).toEqual({ kind: 'other', frameKind: KIND.pong });
      expect(codec.stream(frameOf(0x55, new Uint8Array()))).toEqual({ kind: 'other', frameKind: 0x55 });
    });
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
      mac: null,
    });
  });

  it('pong carries the MAC address of the unit, in upper case with colons', () => {
    const pong = codec.pong(frameOf(0x02, pongPayload('RP-MOCK', 7, [0x00, 0x26, 0x32, 0xf0, 0x1a, 0xbc])));
    expect(pong.mac).toBe('00:26:32:F0:1A:BC');
    // The all-zero address means "none", and a partial field is not a MAC address either.
    expect(codec.pong(frameOf(0x02, pongPayload('RP-MOCK', 7, [0, 0, 0, 0, 0, 0]))).mac).toBeNull();
    const partial = pongPayload('RP-MOCK', 7, [1, 2, 3, 4, 5, 6]).subarray(0, 29);
    expect(codec.pong(frameOf(0x02, partial)).mac).toBeNull();
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
    expect(codec.beacon(datagram)).toEqual({ protocol: 1, deviceId: 'RP-MOCK', tcpPort: 47000, firmware: '0.1.0', mac: null });
    const withMac = new Uint8Array(24);
    withMac.set(datagram, 0);
    withMac.set([0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f], 18);
    expect(codec.beacon(withMac)?.mac).toBe('0A:0B:0C:0D:0E:0F');
    expect(codec.beacon(new TextEncoder().encode('M-SEARCH * HTTP/1.1'))).toBeNull();
    expect(codec.beacon(new Uint8Array())).toBeNull();
  });
});
