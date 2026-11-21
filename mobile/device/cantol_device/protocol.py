"""The Cantol link protocol, device side (placeholder; ADR-005 is not written).

Frame layout (little-endian), as in mobile/rust/cantol-proto/src/frame.rs:
    magic u16 0xCA57 | ver u8 | kind u8 | flags u8 | seq u32 | ts_us u64 | len u32 | payload | crc32 u32
The layouts of the messages are those of mobile/rust/cantol-proto/src/msg.rs.
mobile/rust/cantol-mock/tests/device_program.rs runs this program against the Rust code, so a
difference in a single byte fails there.
"""
import struct
import time
import zlib

MAGIC_BYTES = b"\x57\xca"
VER = 1
HEADER = struct.Struct("<HBBBIQI")
MAX_PAYLOAD = 64 * 1024

K_HELLO, K_PONG, K_STATUS, K_PD_EVENT = 0x01, 0x02, 0x03, 0x10
K_START, K_STOP, K_PING, K_ERROR = 0x20, 0x21, 0x30, 0x7F
FLAG_MORE = 0b01
FLAG_DROPPED_BEFORE = 0b10
ERR_UNSUPPORTED_VERSION = 1

STATUS_MAINS_LOCK = 0b01
STATUS_SYNTHETIC = 0b10
MAX_SENSORS = 8
MAX_EVENTS_PER_FRAME = 1000  # 2 + 1000 * 12 bytes, well under MAX_PAYLOAD

# The app turns counts into dBmV with 0.1 mV per count (mobile/rust/cantol-dsp/src/calibration.rs).
# The device converts from what the ADC reads, so the calibration of this unit lives here.
PROTOCOL_MV_PER_COUNT = 0.1


def frame(kind, seq, payload, ts_us=0, flags=0):
    body = HEADER.pack(0xCA57, VER, kind, flags, seq & 0xFFFFFFFF, ts_us, len(payload)) + payload
    return body + struct.pack("<I", zlib.crc32(body) & 0xFFFFFFFF)


def extract_frames(buf):
    """Whole valid frames at the start of buf as (kind, seq, payload), and the bytes left over."""
    frames = []
    while True:
        at = buf.find(MAGIC_BYTES)
        if at < 0:
            return frames, (buf[-1:] if buf[-1:] == MAGIC_BYTES[:1] else b"")
        if at > 0:
            buf = buf[at:]
        if len(buf) < HEADER.size:
            return frames, buf
        _magic, ver, kind, _flags, seq, _ts, length = HEADER.unpack_from(buf)
        if length > MAX_PAYLOAD:
            buf = buf[1:]
            continue
        total = HEADER.size + length + 4
        if len(buf) < total:
            return frames, buf
        body = buf[: HEADER.size + length]
        (crc,) = struct.unpack_from("<I", buf, HEADER.size + length)
        if zlib.crc32(body) & 0xFFFFFFFF != crc:
            buf = buf[1:]
            continue
        if ver == VER:
            frames.append((kind, seq, buf[HEADER.size : HEADER.size + length]))
        buf = buf[total:]


def pong_payload(nonce, mac, device_id, fw=(0, 1, 0), caps=0):
    return struct.pack("<BH3s8sQI6s", VER, caps, bytes(fw), device_id, int(time.time() * 1000), nonce, mac)


def beacon_datagram(tcp_port, mac, device_id, fw=(0, 1, 0)):
    return b"CNTL" + bytes([VER]) + device_id + struct.pack("<H", tcp_port) + bytes(fw) + mac


def u16(value):
    return max(0, min(65535, int(round(value))))


def status_payload(temp_c, clip_pct, noise_counts, rate_hz, queue, flags, sensors):
    """The status, with a trailer of per-sensor figures: [(noise_floor_counts, rate_hz), ...]."""
    base = struct.pack(
        "<hHHHHB",
        max(-32768, min(32767, int(round(temp_c * 10)))),
        u16(clip_pct * 10),
        u16(noise_counts),
        u16(rate_hz),
        u16(queue),
        flags,
    )
    sensors = sensors[:MAX_SENSORS]
    trailer = bytes([len(sensors)]) + b"".join(struct.pack("<HH", u16(n), u16(r)) for n, r in sensors)
    return base + trailer


def pd_events_payload(events):
    """events: [(t_us, amp_counts, phase16, width_ns, polarity, channel), ...]."""
    out = [struct.pack("<H", len(events))]
    for t_us, amp, phase, width, polarity, channel in events:
        out.append(
            struct.pack(
                "<IhHHBB",
                max(0, min(0xFFFFFFFF, int(t_us))),
                max(-32768, min(32767, int(amp))),
                phase & 0xFFFF,
                u16(width),
                1 if polarity else 0,
                channel & 0xFF,
            )
        )
    return b"".join(out)
