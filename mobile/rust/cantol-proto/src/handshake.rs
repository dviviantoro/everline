//! The phone's side of connecting: the frames it sends (HELLO, keep-alive, Start, Stop), and plain-text
//! reports of what comes back to a HELLO.
//!
//! The Android plugin only moves bytes, so it needs ready-made frames to send and the answers
//! decoded for it. This is that part: pure Rust, tested natively, exported through the WASM
//! module. Reports are one line of JSON, like `report.rs`; a failure is `{"error":"<code>"}`.

use std::fmt::Write as _;

use crate::decoder::FrameDecoder;
use crate::frame::{Kind, PROTO_VERSION, encode_frame};
use crate::msg::{Beacon, Hello, MAC_LEN, Pong};

fn frame(kind: Kind, seq: u32, payload: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    // Every payload built here is far below MAX_PAYLOAD, so encoding cannot fail; an empty
    // frame (which the Cantol would ignore) is the safe answer if that ever changed.
    if encode_frame(&mut out, kind as u8, 0, seq, 0, payload).is_err() {
        out.clear();
    }
    out
}

/// The first frame on a connection, and what a "ping" sends: the protocol versions the phone
/// speaks, a nonce the answer must echo, and the phone's clock (Cantol has no RTC).
pub fn hello_frame(nonce: u32, phone_epoch_ms: u64) -> Vec<u8> {
    let hello = Hello {
        proto_min: PROTO_VERSION,
        proto_max: PROTO_VERSION,
        nonce,
        phone_epoch_ms,
    };
    frame(Kind::Hello, 0, &hello.encode())
}

/// The keep-alive the phone repeats while linked. Cantol answers it at once with a status frame,
/// so any frame coming back proves the link is alive.
pub fn ping_frame(seq: u32) -> Vec<u8> {
    frame(Kind::Ping, seq, &[])
}

/// Asks Cantol to start sending `PdEvent` batches (and a `Status` about once a second). The
/// payload is empty in this placeholder protocol: there is nothing to configure yet.
pub fn start_frame(seq: u32) -> Vec<u8> {
    frame(Kind::Start, seq, &[])
}

/// Asks Cantol to stop sending `PdEvent` batches. The link stays up and keeps answering pings.
pub fn stop_frame(seq: u32) -> Vec<u8> {
    frame(Kind::Stop, seq, &[])
}

/// Printable ASCII up to the first NUL; anything else (and the two characters JSON would need
/// to escape) becomes `?`. A device id is shown to the operator, so it must not break the report.
fn text(bytes: &[u8]) -> String {
    bytes
        .iter()
        .take_while(|&&b| b != 0)
        .map(|&b| {
            if b.is_ascii_graphic() && b != b'"' && b != b'\\' {
                char::from(b)
            } else {
                '?'
            }
        })
        .collect()
}

/// `"AA:BB:CC:DD:EE:FF"` in quotes, or `null` when the device did not report one.
fn mac_json(mac: Option<[u8; MAC_LEN]>) -> String {
    match mac {
        Some(m) => format!(
            "\"{:02X}:{:02X}:{:02X}:{:02X}:{:02X}:{:02X}\"",
            m[0], m[1], m[2], m[3], m[4], m[5]
        ),
        None => "null".to_string(),
    }
}

fn error(code: &str) -> String {
    format!("{{\"error\":\"{code}\"}}")
}

/// Decode the answer to a HELLO: the first valid frame in `bytes`.
///
/// `{"proto":1,"caps":3,"fw":"0.1.0","device_id":"RP-MOCK","cantol_epoch_ms":1,"nonce":7,"mac":"00:26:32:F0:1A:BC"}`
/// (`"mac":null` when the device did not report its MAC address), or an error: `no_frame` (nothing complete and valid), `device_error` (Cantol refused, with its
/// `code`), `bad_pong`, or `unexpected_frame`.
pub fn pong_report(bytes: &[u8]) -> String {
    let mut decoder = FrameDecoder::new();
    let mut report: Option<String> = None;
    decoder.push(bytes, |f| {
        if report.is_some() {
            return;
        }
        report = Some(match Kind::from_u8(f.kind) {
            Some(Kind::Pong) => match Pong::decode(f.payload) {
                Ok(p) => {
                    let mut out = String::new();
                    let _ = write!(
                        out,
                        "{{\"proto\":{},\"caps\":{},\"fw\":\"{}.{}.{}\",\"device_id\":\"{}\",\"cantol_epoch_ms\":{},\"nonce\":{},\"mac\":{}}}",
                        p.proto,
                        p.caps,
                        p.fw[0],
                        p.fw[1],
                        p.fw[2],
                        text(&p.device_id),
                        p.cantol_epoch_ms,
                        p.nonce,
                        mac_json(Pong::mac_of(f.payload))
                    );
                    out
                }
                Err(_) => error("bad_pong"),
            },
            Some(Kind::Error) => format!(
                "{{\"error\":\"device_error\",\"code\":{}}}",
                f.payload.first().copied().unwrap_or(0)
            ),
            _ => error("unexpected_frame"),
        });
    });
    report.unwrap_or_else(|| error("no_frame"))
}

/// Decode one UDP discovery beacon:
/// `{"proto":1,"device_id":"RP-MOCK","tcp_port":47000,"fw":"0.1.0","mac":"00:26:32:F0:1A:BC"}`
/// (`"mac":null` when it carries none), or `{"error":"not_a_beacon"}` for anything else that
/// arrives on the port.
pub fn beacon_report(datagram: &[u8]) -> String {
    match Beacon::decode(datagram) {
        Ok(b) => format!(
            "{{\"proto\":{},\"device_id\":\"{}\",\"tcp_port\":{},\"fw\":\"{}.{}.{}\",\"mac\":{}}}",
            b.proto,
            text(&b.device_id),
            b.tcp_port,
            b.fw[0],
            b.fw[1],
            b.fw[2],
            mac_json(Beacon::mac_of(datagram))
        ),
        Err(_) => error("not_a_beacon"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::frame::{CRC_LEN, HEADER_LEN};

    fn decode_one(bytes: &[u8]) -> (u8, Vec<u8>) {
        let mut decoder = FrameDecoder::new();
        let mut got = None;
        decoder.push(bytes, |f| got = Some((f.kind, f.payload.to_vec())));
        got.expect("one valid frame")
    }

    fn pong_frame(device_id: [u8; 8], nonce: u32) -> Vec<u8> {
        let pong = Pong {
            proto: 1,
            caps: 0b11,
            fw: [0, 1, 0],
            device_id,
            cantol_epoch_ms: 1_760_000_000_000,
            nonce,
        };
        frame(Kind::Pong, 0, &pong.encode())
    }

    #[test]
    fn hello_frame_carries_the_versions_nonce_and_clock() {
        let bytes = hello_frame(0xDEAD_BEEF, 1_760_000_000_123);
        assert_eq!(bytes.len(), HEADER_LEN + Hello::LEN + CRC_LEN);
        let (kind, payload) = decode_one(&bytes);
        assert_eq!(kind, Kind::Hello as u8);
        assert_eq!(
            Hello::decode(&payload),
            Ok(Hello {
                proto_min: PROTO_VERSION,
                proto_max: PROTO_VERSION,
                nonce: 0xDEAD_BEEF,
                phone_epoch_ms: 1_760_000_000_123,
            })
        );
    }

    #[test]
    fn ping_frame_is_an_empty_ping() {
        let bytes = ping_frame(9);
        assert_eq!(bytes.len(), HEADER_LEN + CRC_LEN);
        let (kind, payload) = decode_one(&bytes);
        assert_eq!(kind, Kind::Ping as u8);
        assert!(payload.is_empty());
    }

    #[test]
    fn start_and_stop_are_empty_control_frames_of_their_own_kind() {
        for (bytes, kind) in [(start_frame(4), Kind::Start), (stop_frame(5), Kind::Stop)] {
            assert_eq!(bytes.len(), HEADER_LEN + CRC_LEN, "{kind:?}");
            let (got, payload) = decode_one(&bytes);
            assert_eq!(got, kind as u8);
            assert!(payload.is_empty());
        }
    }

    #[test]
    fn pong_report_describes_the_answer_exactly() {
        let report = pong_report(&pong_frame(*b"RP-MOCK\0", 7));
        assert_eq!(
            report,
            "{\"proto\":1,\"caps\":3,\"fw\":\"0.1.0\",\"device_id\":\"RP-MOCK\",\"cantol_epoch_ms\":1760000000000,\"nonce\":7,\"mac\":null}"
        );
    }

    #[test]
    fn pong_report_uses_the_first_frame_and_ignores_what_follows() {
        let mut bytes = pong_frame(*b"FIRST\0\0\0", 1);
        bytes.extend(pong_frame(*b"SECOND\0\0", 2));
        assert!(pong_report(&bytes).contains("\"device_id\":\"FIRST\""));
    }

    #[test]
    fn a_device_id_cannot_break_the_report() {
        let report = pong_report(&pong_frame(*b"A\"B\\C\x01D\x7f", 0));
        assert!(report.contains("\"device_id\":\"A?B?C?D?\""), "{report}");
    }

    #[test]
    fn pong_report_says_so_when_cantol_refuses() {
        let refusal = frame(Kind::Error, 0, &[3]);
        assert_eq!(
            pong_report(&refusal),
            "{\"error\":\"device_error\",\"code\":3}"
        );
    }

    #[test]
    fn pong_report_rejects_a_short_pong_and_other_frames() {
        assert_eq!(
            pong_report(&frame(Kind::Pong, 0, &[1, 2, 3])),
            error("bad_pong")
        );
        assert_eq!(
            pong_report(&frame(Kind::Status, 0, &[0; 20])),
            error("unexpected_frame")
        );
    }

    #[test]
    fn pong_report_wants_a_complete_valid_frame() {
        assert_eq!(pong_report(&[]), error("no_frame"));
        assert_eq!(pong_report(b"HTTP/1.1 200 OK\r\n"), error("no_frame"));
        let whole = pong_frame(*b"RP-MOCK\0", 7);
        assert_eq!(
            pong_report(&whole[..whole.len() - 1]),
            error("no_frame"),
            "truncated"
        );
        let mut corrupt = whole.clone();
        corrupt[HEADER_LEN + 2] ^= 0x01;
        assert_eq!(pong_report(&corrupt), error("no_frame"), "bad CRC");
    }

    #[test]
    fn beacon_report_describes_a_beacon_and_rejects_the_rest() {
        let beacon = Beacon {
            proto: 1,
            device_id: *b"RP-MOCK\0",
            tcp_port: 47000,
            fw: [0, 1, 0],
        };
        assert_eq!(
            beacon_report(&beacon.encode()),
            "{\"proto\":1,\"device_id\":\"RP-MOCK\",\"tcp_port\":47000,\"fw\":\"0.1.0\",\"mac\":null}"
        );
        assert_eq!(beacon_report(b"hello"), error("not_a_beacon"));
        assert_eq!(
            beacon_report(&[0u8; Beacon::LEN]),
            error("not_a_beacon"),
            "right size, wrong magic"
        );
        assert_eq!(beacon_report(&[]), error("not_a_beacon"));
    }

    #[test]
    fn pong_and_beacon_reports_carry_the_mac_address_when_there_is_one() {
        let pong = Pong {
            proto: 1,
            caps: 0b11,
            fw: [0, 1, 0],
            device_id: *b"RP-MOCK\0",
            cantol_epoch_ms: 1,
            nonce: 7,
        };
        let bytes = frame(
            Kind::Pong,
            0,
            &pong.encode_with_mac([0x00, 0x26, 0x32, 0xF0, 0x1A, 0xBC]),
        );
        let report = pong_report(&bytes);
        assert!(
            report.ends_with(",\"nonce\":7,\"mac\":\"00:26:32:F0:1A:BC\"}"),
            "{report}"
        );

        let beacon = Beacon {
            proto: 1,
            device_id: *b"RP-MOCK\0",
            tcp_port: 47000,
            fw: [0, 1, 0],
        };
        let report = beacon_report(&beacon.encode_with_mac([0x0A, 0x0B, 0x0C, 0x0D, 0x0E, 0x0F]));
        assert!(
            report.ends_with(",\"mac\":\"0A:0B:0C:0D:0E:0F\"}"),
            "{report}"
        );
    }

    #[test]
    fn an_all_zero_mac_is_reported_as_no_mac() {
        let pong = Pong {
            proto: 1,
            caps: 0,
            fw: [0, 1, 0],
            device_id: *b"X\0\0\0\0\0\0\0",
            cantol_epoch_ms: 1,
            nonce: 1,
        };
        let report = pong_report(&frame(Kind::Pong, 0, &pong.encode_with_mac([0; MAC_LEN])));
        assert!(report.ends_with("\"mac\":null}"), "{report}");
    }
}
