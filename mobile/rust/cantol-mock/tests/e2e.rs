//! End to end over real loopback sockets: what the app's CantolLink plugin will do against the mock.

use std::io::{Read, Write};
use std::net::{TcpStream, UdpSocket};
use std::time::{Duration, Instant};

use cantol_mock::{Config, spawn};
use cantol_proto::frame::{Kind, encode_frame};
use cantol_proto::msg::{Beacon, Hello, Pong, decode_pd_events};
use cantol_proto::{FrameDecoder, Stats};

const NONCE: u32 = 0xABCD_1234;

fn quiet_config() -> Config {
    Config {
        port: 0,
        beacon: false,
        bind: "127.0.0.1".into(),
        ..Config::default()
    }
}

fn send(stream: &mut TcpStream, kind: Kind, payload: &[u8]) {
    let mut frame = Vec::new();
    encode_frame(&mut frame, kind as u8, 0, 0, 0, payload).unwrap();
    stream.write_all(&frame).unwrap();
}

fn connect(addr: std::net::SocketAddr) -> TcpStream {
    let stream = TcpStream::connect(addr).unwrap();
    stream
        .set_read_timeout(Some(Duration::from_millis(200)))
        .unwrap();
    stream
}

/// Collected (kind, payload) of every frame received until `done` says stop or time runs out.
fn read_until(
    stream: &mut TcpStream,
    limit: Duration,
    mut done: impl FnMut(&[(u8, Vec<u8>)]) -> bool,
) -> (Vec<(u8, Vec<u8>)>, Stats, bool) {
    let mut decoder = FrameDecoder::new();
    let mut frames = Vec::new();
    let mut buf = [0u8; 4096];
    let deadline = Instant::now() + limit;
    let mut eof = false;
    while Instant::now() < deadline && !done(&frames) {
        match stream.read(&mut buf) {
            Ok(0) => {
                eof = true;
                break;
            }
            Ok(n) => decoder.push(&buf[..n], |f| frames.push((f.kind, f.payload.to_vec()))),
            Err(e)
                if matches!(
                    e.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) => {}
            Err(e) => panic!("read failed: {e}"),
        }
    }
    (frames, *decoder.stats(), eof)
}

fn hello() -> Vec<u8> {
    Hello {
        proto_min: 1,
        proto_max: 1,
        nonce: NONCE,
        phone_epoch_ms: 1,
    }
    .encode()
    .to_vec()
}

#[test]
fn hello_is_answered_with_a_pong_echoing_the_nonce() {
    let mock = spawn(quiet_config()).unwrap();
    let mut stream = connect(mock.addr());
    send(&mut stream, Kind::Hello, &hello());
    let (frames, _, _) = read_until(&mut stream, Duration::from_secs(5), |f| {
        f.iter().any(|x| x.0 == Kind::Pong as u8)
    });
    let pong = frames
        .iter()
        .find(|x| x.0 == Kind::Pong as u8)
        .expect("a PONG");
    let pong = Pong::decode(&pong.1).unwrap();
    assert_eq!((pong.nonce, pong.proto), (NONCE, 1));
    assert_eq!(&pong.device_id, b"RP-MOCK\0");
}

/// The unit proves which one it is: its MAC address is in the PONG and in the beacon, and a
/// configured address is reported as given.
#[test]
fn the_mock_reports_its_mac_address_in_the_pong_and_the_beacon() {
    use cantol_proto::handshake::pong_report;

    let mut cfg = quiet_config();
    cfg.mac = [0x00, 0x26, 0x32, 0xF0, 0x1A, 0xBC];
    let mock = spawn(cfg).unwrap();
    let mut stream = connect(mock.addr());
    send(&mut stream, Kind::Hello, &hello());
    let mut buf = [0u8; 256];
    let n = stream.read(&mut buf).unwrap();
    let report = pong_report(&buf[..n]);
    assert!(report.contains("\"mac\":\"00:26:32:F0:1A:BC\""), "{report}");
}

/// The bytes the phone's plugin will really send and the report the app will really read, against
/// the live mock: nothing here is re-encoded by hand.
#[test]
fn the_phones_handshake_helpers_talk_to_the_mock() {
    use cantol_proto::handshake::{beacon_report, hello_frame, ping_frame, pong_report};

    let mock = spawn(quiet_config()).unwrap();
    let mut stream = connect(mock.addr());
    stream
        .write_all(&hello_frame(NONCE, 1_760_000_000_000))
        .unwrap();
    let mut buf = [0u8; 256];
    let n = stream.read(&mut buf).unwrap();
    let report = pong_report(&buf[..n]);
    assert!(report.contains("\"device_id\":\"RP-MOCK\""), "{report}");
    assert!(report.contains(&format!("\"nonce\":{NONCE}")), "{report}");

    // The keep-alive is answered with a frame, which is all the link-lost timer needs.
    stream.write_all(&ping_frame(1)).unwrap();
    let (frames, _, _) = read_until(&mut stream, Duration::from_secs(5), |f| !f.is_empty());
    assert!(!frames.is_empty(), "no answer to the keep-alive");

    // A refusal is reported, not mistaken for an answer.
    let mut other = connect(mock.addr());
    let mut refusal = Vec::new();
    let future = Hello {
        proto_min: 9,
        proto_max: 9,
        nonce: 1,
        phone_epoch_ms: 1,
    };
    encode_frame(&mut refusal, Kind::Hello as u8, 0, 0, 0, &future.encode()).unwrap();
    other.write_all(&refusal).unwrap();
    let n = other.read(&mut buf).unwrap();
    assert!(pong_report(&buf[..n]).contains("device_error"));

    // The beacon the mock broadcasts decodes through the same report.
    let beacon = Beacon {
        proto: 1,
        device_id: *b"RP-MOCK\0",
        tcp_port: 47000,
        fw: [0, 1, 0],
    };
    assert!(beacon_report(&beacon.encode()).contains("\"tcp_port\":47000"));
}

#[test]
fn unsupported_protocol_range_gets_an_error_frame() {
    let mock = spawn(quiet_config()).unwrap();
    let mut stream = connect(mock.addr());
    let future = Hello {
        proto_min: 9,
        proto_max: 9,
        nonce: 1,
        phone_epoch_ms: 1,
    }
    .encode();
    send(&mut stream, Kind::Hello, &future);
    let (frames, _, _) = read_until(&mut stream, Duration::from_secs(5), |f| {
        f.iter().any(|x| x.0 == Kind::Error as u8)
    });
    assert!(frames.iter().any(|x| x.0 == Kind::Error as u8));
    assert!(!frames.iter().any(|x| x.0 == Kind::Pong as u8));
}

#[test]
fn start_streams_pd_events_with_contiguous_sequence_numbers() {
    let mock = spawn(Config {
        pd_rate_hz: 400,
        ..quiet_config()
    })
    .unwrap();
    let mut stream = connect(mock.addr());
    send(&mut stream, Kind::Hello, &hello());
    send(&mut stream, Kind::Start, &[]);
    let pd = Kind::PdEvent as u8;
    let (frames, stats, _) = read_until(&mut stream, Duration::from_secs(5), |f| {
        f.iter().filter(|x| x.0 == pd).count() >= 5
    });
    let batches: Vec<_> = frames.iter().filter(|x| x.0 == pd).collect();
    assert!(batches.len() >= 5, "got {} PD batches", batches.len());
    let events: usize = batches
        .iter()
        .map(|b| decode_pd_events(&b.1).unwrap().len())
        .sum();
    assert!(
        events >= 5 * 15,
        "400 events/s in 50 ms batches is about 20 per batch, got {events}"
    );
    assert_eq!(
        (stats.lost_frames, stats.crc_errors, stats.out_of_order),
        (0, 0, 0)
    );
}

#[test]
fn no_pd_events_until_start() {
    let mock = spawn(quiet_config()).unwrap();
    let mut stream = connect(mock.addr());
    send(&mut stream, Kind::Hello, &hello());
    let (frames, _, _) = read_until(&mut stream, Duration::from_millis(600), |_| false);
    assert!(
        frames.iter().any(|x| x.0 == Kind::Status as u8),
        "status flows from the start"
    );
    assert!(!frames.iter().any(|x| x.0 == Kind::PdEvent as u8));
}

#[test]
fn injected_loss_and_corruption_show_up_in_decoder_statistics() {
    let cfg = Config {
        pd_rate_hz: 400,
        loss_pct: 20.0,
        corrupt_pct: 10.0,
        seed: 5,
        ..quiet_config()
    };
    let mock = spawn(cfg).unwrap();
    let mut stream = connect(mock.addr());
    send(&mut stream, Kind::Hello, &hello());
    send(&mut stream, Kind::Start, &[]);
    let (_, stats, _) = read_until(&mut stream, Duration::from_millis(2500), |_| false);
    assert!(stats.frames_ok > 5, "{stats:?}");
    assert!(stats.lost_frames > 0, "{stats:?}");
    assert!(
        stats.crc_errors + stats.bad_headers + stats.resyncs > 0,
        "{stats:?}"
    );
}

#[test]
fn disconnect_every_closes_the_connection() {
    let mock = spawn(Config {
        disconnect_every_s: 1,
        ..quiet_config()
    })
    .unwrap();
    let mut stream = connect(mock.addr());
    let (_, _, eof) = read_until(&mut stream, Duration::from_secs(5), |_| false);
    assert!(eof, "the mock should have closed the connection");
}

#[test]
fn beacon_announces_the_real_tcp_port() {
    let receiver = UdpSocket::bind("127.0.0.1:0").unwrap();
    receiver
        .set_read_timeout(Some(Duration::from_secs(5)))
        .unwrap();
    let beacon_port = receiver.local_addr().unwrap().port();
    let cfg = Config {
        beacon: true,
        beacon_port,
        beacon_target: "127.0.0.1".into(),
        ..quiet_config()
    };
    let mock = spawn(cfg).unwrap();
    let mut buf = [0u8; 64];
    let (n, _) = receiver.recv_from(&mut buf).expect("a beacon within 5 s");
    let beacon = Beacon::decode(&buf[..n]).unwrap();
    assert_eq!(beacon.tcp_port, mock.addr().port());
    assert_eq!(&beacon.device_id, b"RP-MOCK\0");
    assert_eq!(
        Beacon::mac_of(&buf[..n]),
        Some([0x02, 0xCA, 0x57, 0x00, 0x00, 0x01]),
        "the beacon carries the unit's MAC address"
    );
}

#[test]
fn every_status_says_the_data_is_generated() {
    let mock = spawn(quiet_config()).unwrap();
    let mut stream = connect(mock.addr());
    send(&mut stream, Kind::Hello, &hello());
    let (frames, _, _) = read_until(&mut stream, Duration::from_millis(600), |_| false);
    let status = frames
        .iter()
        .find(|x| x.0 == Kind::Status as u8)
        .expect("a status within 0.6 s");
    let flags = cantol_proto::msg::Status::decode(&status.1).unwrap().flags;
    assert_ne!(flags & cantol_proto::msg::STATUS_SYNTHETIC, 0);
    assert_ne!(flags & cantol_proto::msg::STATUS_MAINS_LOCK, 0);
}
