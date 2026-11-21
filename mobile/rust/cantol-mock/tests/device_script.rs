//! `device/cantol-pingpong.sh` against the app's own protocol code.
//!
//! The script runs on the Cantol (a Red Pitaya) and plays its side of the handshake with a copy of
//! the frame layout written in python. This test starts the real script and talks to it with the
//! functions the app itself uses (`cantol_proto::handshake`, the code the WASM module exports), so
//! if the two ever disagree about a byte this fails. It needs `sh` and `python3`, as the device
//! does; where `python3` is missing the test says so and passes, because there is nothing to run.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpStream, UdpSocket};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

use cantol_dsp::counts_to_dbmv;
use cantol_proto::frame::{Kind, encode_frame};
use cantol_proto::handshake::{
    beacon_report, hello_frame, ping_frame, pong_report, start_frame, stop_frame,
};
use cantol_proto::msg::{
    Beacon, Hello, STATUS_MAINS_LOCK, STATUS_SYNTHETIC, Status, decode_pd_events,
};
use cantol_proto::{FrameDecoder, PROTO_VERSION};

const NONCE: u32 = 0x0BAD_CAFE;
const MAC: &str = "00:26:32:F0:1A:BC";

fn script() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../device/cantol-pingpong.sh")
}

fn python_available() -> bool {
    Command::new("python3")
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// The running script. Dropping it stops it the way Ctrl-C does, so no responder outlives a test.
struct Device {
    child: Child,
    port: u16,
    lines: mpsc::Receiver<String>,
}

impl Drop for Device {
    fn drop(&mut self) {
        let _ = Command::new("kill")
            .args(["-TERM", &self.child.id().to_string()])
            .status();
        let _ = self.child.wait();
    }
}

fn start(extra: &[&str], beacon_port: u16) -> Device {
    let mut child = Command::new("sh")
        .arg(script())
        .args(["run", "--no-search", "--port", "0", "--beacon-port"])
        .arg(beacon_port.to_string())
        .args(["--beacon-target", "127.0.0.1", "--mac", MAC])
        .args(["--device-id", "RP-TEST", "--duration", "60"])
        .args(extra)
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .expect("sh starts");
    let stdout = child.stdout.take().expect("piped");
    let (tx, lines) = mpsc::channel();
    thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if tx.send(line).is_err() {
                break;
            }
        }
    });
    // "<time> listening on TCP 0.0.0.0:41234, device id RP-TEST, MAC ..."
    let port = loop {
        let line = lines
            .recv_timeout(Duration::from_secs(15))
            .expect("the script says where it listens");
        if let Some(rest) = line.split("listening on TCP ").nth(1) {
            let port = rest.split(':').nth(1).and_then(|p| p.split(',').next());
            break port.expect("a port").parse().expect("a number");
        }
    };
    Device { child, port, lines }
}

fn connect(device: &Device) -> TcpStream {
    let stream = TcpStream::connect(("127.0.0.1", device.port)).unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .unwrap();
    stream
}

fn read_frames(stream: &mut TcpStream, want: usize) -> Vec<(u8, Vec<u8>)> {
    let mut decoder = FrameDecoder::new();
    let mut frames = Vec::new();
    let mut buf = [0u8; 512];
    while frames.len() < want {
        let n = stream.read(&mut buf).expect("an answer within 5 s");
        assert!(n > 0, "the device closed the connection");
        decoder.push(&buf[..n], |f| frames.push((f.kind, f.payload.to_vec())));
    }
    frames
}

#[test]
fn the_script_answers_the_phones_handshake_and_keep_alives() {
    if !python_available() {
        eprintln!("python3 is not installed: skipping the device script test");
        return;
    }
    let beacon_socket = UdpSocket::bind("127.0.0.1:0").unwrap();
    beacon_socket
        .set_read_timeout(Some(Duration::from_secs(10)))
        .unwrap();
    let beacon_port = beacon_socket.local_addr().unwrap().port();
    let device = start(&[], beacon_port);

    // HELLO -> PONG: read with the app's own report. The nonce comes back, and so do the device id
    // and the MAC address the operator typed from the label.
    let mut stream = connect(&device);
    stream
        .write_all(&hello_frame(NONCE, 1_760_000_000_000))
        .unwrap();
    let mut buf = [0u8; 512];
    let n = stream.read(&mut buf).unwrap();
    let report = pong_report(&buf[..n]);
    assert!(report.contains("\"device_id\":\"RP-TEST\""), "{report}");
    assert!(report.contains(&format!("\"nonce\":{NONCE}")), "{report}");
    assert!(report.contains(&format!("\"mac\":\"{MAC}\"")), "{report}");
    assert!(
        report.contains(&format!("\"proto\":{PROTO_VERSION}")),
        "{report}"
    );

    // PING -> a frame back (any frame proves the link is alive; the device sends STATUS).
    for seq in 1..=3 {
        stream.write_all(&ping_frame(seq)).unwrap();
    }
    let answers = read_frames(&mut stream, 3);
    assert!(answers.iter().all(|(kind, _)| *kind == Kind::Status as u8));

    // A phone that speaks only a future protocol is refused, not answered.
    let mut other = connect(&device);
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

    // Noise, a corrupted frame and then a good one: the device finds its place again.
    let mut damaged = ping_frame(5);
    let last = damaged.len() - 1;
    damaged[last] ^= 0xFF;
    stream.write_all(b"\x00\x01noise").unwrap();
    stream.write_all(&damaged).unwrap();
    stream.write_all(&ping_frame(6)).unwrap();
    let answers = read_frames(&mut stream, 1);
    assert_eq!(answers[0].0, Kind::Status as u8);

    // The beacon, read with the app's beacon report: the real TCP port and the MAC address.
    let mut datagram = [0u8; 64];
    let (n, _) = beacon_socket
        .recv_from(&mut datagram)
        .expect("a beacon within 10 s");
    let report = beacon_report(&datagram[..n]);
    assert!(report.contains("\"device_id\":\"RP-TEST\""), "{report}");
    assert!(
        report.contains(&format!("\"tcp_port\":{}", device.port)),
        "{report}"
    );
    assert!(report.contains(&format!("\"mac\":\"{MAC}\"")), "{report}");
    assert_eq!(Beacon::decode(&datagram[..n]).unwrap().proto, PROTO_VERSION);

    // The log shows the ping-pong, for whoever is watching the device.
    drop(stream);
    drop(other);
    let mut log = String::new();
    while let Ok(line) = device.lines.recv_timeout(Duration::from_millis(500)) {
        log.push_str(&line);
        log.push('\n');
    }
    assert!(log.contains("HELLO from 127.0.0.1"), "{log}");
    assert!(log.contains("-> PONG sent"), "{log}");
    assert!(log.contains("-> STATUS sent"), "{log}");
    assert!(log.contains("refused"), "{log}");
}

/// A frame as the app's decoder saw it.
struct Seen {
    kind: u8,
    seq: u32,
    ts_us: u64,
    payload: Vec<u8>,
}

/// Everything that arrives in the next `span`, decoded with the app's own decoder.
fn read_for(stream: &mut TcpStream, span: Duration) -> (Vec<Seen>, f64) {
    let mut decoder = FrameDecoder::new();
    let mut seen = Vec::new();
    let mut buf = [0u8; 4096];
    let begun = Instant::now();
    stream
        .set_read_timeout(Some(Duration::from_millis(50)))
        .unwrap();
    while begun.elapsed() < span {
        match stream.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => decoder.push(&buf[..n], |f| {
                seen.push(Seen {
                    kind: f.kind,
                    seq: f.seq,
                    ts_us: f.ts_us,
                    payload: f.payload.to_vec(),
                })
            }),
            Err(e)
                if matches!(
                    e.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) => {}
            Err(e) => panic!("read failed: {e}"),
        }
    }
    let stats = decoder.stats();
    assert_eq!(
        (stats.crc_errors, stats.resyncs, stats.lost_frames),
        (0, 0, 0),
        "every frame the script sends is whole and in sequence: {stats:?}"
    );
    (seen, begun.elapsed().as_secs_f64())
}

fn pulses_of(seen: &[Seen]) -> Vec<cantol_proto::msg::PdEvent> {
    seen.iter()
        .filter(|f| f.kind == Kind::PdEvent as u8)
        .flat_map(|f| decode_pd_events(&f.payload).expect("a PdEvent payload that fits its layout"))
        .collect()
}

fn statuses_of(seen: &[Seen]) -> Vec<Status> {
    seen.iter()
        .filter(|f| f.kind == Kind::Status as u8)
        .map(|f| Status::decode(&f.payload).expect("a Status payload"))
        .collect()
}

fn handshake(device: &Device) -> TcpStream {
    let mut stream = connect(device);
    stream
        .write_all(&hello_frame(NONCE, 1_760_000_000_000))
        .unwrap();
    let mut buf = [0u8; 512];
    let n = stream.read(&mut buf).unwrap();
    assert!(pong_report(&buf[..n]).contains("\"device_id\":\"RP-TEST\""));
    stream
}

#[test]
fn the_script_streams_made_up_pulses_between_start_and_stop() {
    if !python_available() {
        eprintln!("python3 is not installed: skipping the device script test");
        return;
    }
    let beacon_socket = UdpSocket::bind("127.0.0.1:0").unwrap();
    let device = start(
        &["--level", "40", "--seed", "3"],
        beacon_socket.local_addr().unwrap().port(),
    );
    let mut stream = handshake(&device);

    // Nothing but answers until the app asks.
    stream.write_all(&ping_frame(1)).unwrap();
    let (quiet, _) = read_for(&mut stream, Duration::from_millis(600));
    assert!(pulses_of(&quiet).is_empty(), "no pulses before Start");

    stream.write_all(&start_frame(2)).unwrap();
    let (seen, elapsed) = read_for(&mut stream, Duration::from_millis(2500));
    let pulses = pulses_of(&seen);
    let batches = seen
        .iter()
        .filter(|f| f.kind == Kind::PdEvent as u8)
        .count();
    assert!(batches >= 30, "about one batch every 50 ms, got {batches}");

    // The rate follows the level (40 plus 10 per dB above the 6 dBmV noise floor, at most 600).
    let rate = pulses.len() as f64 / elapsed;
    assert!(
        (200.0..=620.0).contains(&rate),
        "{rate:.0} pulses a second at about 40 dBmV"
    );

    // The pulses, read back through the app's own calibration: 40 dBmV drifting by 4 dB, each up to
    // 3 dB below the level, with a few strays down at the noise floor.
    let levels: Vec<f64> = pulses
        .iter()
        .map(|e| counts_to_dbmv(f64::from(e.amp_counts)))
        .collect();
    let strong = levels.iter().filter(|l| **l > 12.0).count();
    assert!(
        strong as f64 >= 0.9 * levels.len() as f64,
        "strays are the exception: {strong} of {}",
        levels.len()
    );
    let loudest = levels.iter().cloned().fold(f64::MIN, f64::max);
    assert!(
        (36.0..=44.5).contains(&loudest),
        "the loudest pulse is near the level, not {loudest:.1} dBmV"
    );
    // The phase sits in the two lobes around 90 and 270 degrees, and the polarity says which.
    let degrees = |e: &cantol_proto::msg::PdEvent| f64::from(e.phase) / 65536.0 * 360.0;
    let in_lobes = pulses
        .iter()
        .filter(|e| {
            let d = degrees(e);
            (70.0..=110.0).contains(&d) || (250.0..=290.0).contains(&d)
        })
        .count();
    assert!(
        in_lobes as f64 >= 0.9 * pulses.len() as f64,
        "{in_lobes} of {} in the lobes",
        pulses.len()
    );
    for e in pulses
        .iter()
        .filter(|e| counts_to_dbmv(f64::from(e.amp_counts)) > 12.0)
    {
        assert_eq!(e.polarity, u8::from(degrees(e) >= 180.0), "{e:?}");
        assert_eq!(
            e.amp_counts < 0,
            e.polarity == 1,
            "sign follows polarity: {e:?}"
        );
        assert!((40..=600).contains(&e.width_ns), "{e:?}");
    }
    // Offsets are inside the 50 ms of a batch.
    assert!(pulses.iter().all(|e| e.t_us <= 500_000));

    // Every status says the data is generated, and reports the mains lock and a noise floor near 6 dBmV.
    let statuses = statuses_of(&seen);
    assert!(
        statuses.len() >= 2,
        "a status about once a second, got {}",
        statuses.len()
    );
    for s in &statuses {
        assert_ne!(s.flags & STATUS_SYNTHETIC, 0, "{s:?}");
        assert_ne!(s.flags & STATUS_MAINS_LOCK, 0, "{s:?}");
        let noise = counts_to_dbmv(f64::from(s.noise_floor_counts));
        assert!((5.0..=7.0).contains(&noise), "noise floor {noise:.1} dBmV");
        assert!((200..=600).contains(&s.trigger_rate_hz), "{s:?}");
        assert_eq!(s.queue, 0);
    }
    // The device's own timestamps never go backwards.
    assert!(seen.windows(2).all(|w| w[1].ts_us >= w[0].ts_us));
    assert!(
        seen.windows(2)
            .all(|w| w[1].seq == w[0].seq.wrapping_add(1))
    );

    // Stop ends it, and the link still answers.
    stream.write_all(&stop_frame(3)).unwrap();
    let _ = read_for(&mut stream, Duration::from_millis(300));
    let (after, _) = read_for(&mut stream, Duration::from_millis(700));
    assert!(pulses_of(&after).is_empty(), "no pulses after Stop");
    stream.write_all(&ping_frame(4)).unwrap();
    let (answer, _) = read_for(&mut stream, Duration::from_millis(400));
    assert_eq!(statuses_of(&answer).len(), 1, "a ping is still answered");

    // And it starts again.
    stream.write_all(&start_frame(5)).unwrap();
    let (again, _) = read_for(&mut stream, Duration::from_millis(600));
    assert!(
        !pulses_of(&again).is_empty(),
        "a second Start streams again"
    );

    // Closing the connection ends the stream: a new one gets nothing until it asks.
    drop(stream);
    let mut next = handshake(&device);
    let (idle, _) = read_for(&mut next, Duration::from_millis(500));
    assert!(pulses_of(&idle).is_empty());
    drop(next);

    let mut log = String::new();
    while let Ok(line) = device.lines.recv_timeout(Duration::from_millis(500)) {
        log.push_str(&line);
        log.push('\n');
    }
    assert!(log.contains("START from 127.0.0.1"), "{log}");
    assert!(log.contains("MADE-UP pulses"), "{log}");
    assert!(log.contains("STOP from 127.0.0.1"), "{log}");
}

#[test]
fn the_level_option_moves_the_pulses() {
    if !python_available() {
        eprintln!("python3 is not installed: skipping the device script test");
        return;
    }
    let beacon_socket = UdpSocket::bind("127.0.0.1:0").unwrap();
    let port = beacon_socket.local_addr().unwrap().port();
    let mut loudest = Vec::new();
    for level in ["25", "55"] {
        let device = start(&["--level", level, "--seed", "1"], port);
        let mut stream = handshake(&device);
        stream.write_all(&start_frame(2)).unwrap();
        let (seen, _) = read_for(&mut stream, Duration::from_millis(1200));
        let top = pulses_of(&seen)
            .iter()
            .map(|e| counts_to_dbmv(f64::from(e.amp_counts)))
            .fold(f64::MIN, f64::max);
        loudest.push(top);
    }
    assert!((21.0..=29.5).contains(&loudest[0]), "{loudest:?}");
    assert!((51.0..=59.5).contains(&loudest[1]), "{loudest:?}");
}

#[test]
fn no_stream_ignores_start_and_no_mains_lock_is_reported() {
    if !python_available() {
        eprintln!("python3 is not installed: skipping the device script test");
        return;
    }
    let beacon_socket = UdpSocket::bind("127.0.0.1:0").unwrap();
    let port = beacon_socket.local_addr().unwrap().port();

    let device = start(&["--no-stream"], port);
    let mut stream = handshake(&device);
    stream.write_all(&start_frame(2)).unwrap();
    stream.write_all(&ping_frame(3)).unwrap();
    let (seen, _) = read_for(&mut stream, Duration::from_millis(800));
    assert!(pulses_of(&seen).is_empty(), "--no-stream sends no pulses");
    assert_eq!(statuses_of(&seen).len(), 1, "the ping is still answered");
    drop(stream);
    drop(device);

    let device = start(&["--no-mains-lock"], port);
    let mut stream = handshake(&device);
    stream.write_all(&ping_frame(2)).unwrap();
    let (seen, _) = read_for(&mut stream, Duration::from_millis(500));
    let status = &statuses_of(&seen)[0];
    assert_eq!(status.flags & STATUS_MAINS_LOCK, 0);
    assert_ne!(
        status.flags & STATUS_SYNTHETIC,
        0,
        "still says the data is generated"
    );
}

#[test]
fn the_script_rejects_a_bad_mac_address_and_a_bad_port_before_it_starts() {
    for args in [
        &["--mac", "00:26:32:F0:1A"][..],
        &["--mac", "00:00:00:00:00:00"][..],
        &["--port", "70000"][..],
        &["--beacon-port", "0"][..],
        &["--device-id", "far-too-long-id"][..],
        &["--level", "95"][..],
        &["--level", "loud"][..],
        &["--level", "38.5x"][..],
        &["--seed", "x"][..],
        &["--bogus"][..],
    ] {
        let status = Command::new("sh")
            .arg(script())
            .arg("run")
            .args(args)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .unwrap();
        assert_eq!(status.code(), Some(2), "{args:?}");
    }
}

#[test]
fn the_script_syntax_is_plain_posix_sh() {
    // The device may have dash or busybox ash as `sh`; bash would accept more than they do.
    let status = Command::new("sh").arg("-n").arg(script()).status().unwrap();
    assert!(status.success());
}
