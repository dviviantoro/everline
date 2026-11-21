//! `device/cantol_device` (the Cantol measurement software for the Red Pitaya) against the app's own
//! protocol code, with its simulated source standing in for the ADC.
//!
//! The program is Python with numpy. The test starts it as the board would, talks to it with the
//! functions the app runs as WASM (`cantol_proto`, `cantol_dsp::counts_to_dbmv`) and checks what comes
//! back: the handshake, the per-sensor status, pulses with a sensor, a calibrated amplitude and the
//! phase of the simulated mains, Stop, and a missing mains reference. It also runs the program's own
//! unit tests. Where python3 or numpy is missing it says so and passes, because there is nothing to run.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpStream, UdpSocket};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, MutexGuard, mpsc};
use std::thread;
use std::time::{Duration, Instant};

use cantol_dsp::counts_to_dbmv;
use cantol_proto::FrameDecoder;
use cantol_proto::frame::Kind;
use cantol_proto::handshake::{
    beacon_report, hello_frame, ping_frame, pong_report, start_frame, stop_frame,
};
use cantol_proto::msg::{
    Beacon, PdEvent, STATUS_MAINS_LOCK, STATUS_SYNTHETIC, SensorStat, Status, decode_pd_events,
};

/// The tests measure against the clock (pulses a second, how soon the reference locks), so they run one at a
/// time: four simulated boards and a unit-test run sharing the CPU would starve each other.
static ONE_AT_A_TIME: Mutex<()> = Mutex::new(());

fn alone() -> MutexGuard<'static, ()> {
    ONE_AT_A_TIME
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

const NONCE: u32 = 0x1357_9BDF;
const MAC: &str = "00:26:32:AB:CD:EF";

fn device_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../device")
}

fn python_with_numpy() -> bool {
    Command::new("python3")
        .args(["-c", "import numpy"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

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
    let mut child = Command::new("python3")
        .current_dir(device_dir())
        .args([
            "-m",
            "cantol_device",
            "run",
            "--source",
            "simulated",
            "--port",
            "0",
            "--beacon-port",
        ])
        .arg(beacon_port.to_string())
        .args([
            "--beacon-target",
            "127.0.0.1",
            "--mac",
            MAC,
            "--device-id",
            "RP-TEST",
            "--duration",
            "90",
        ])
        .args(extra)
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .expect("python3 starts");
    let stdout = child.stdout.take().expect("piped");
    let (tx, lines) = mpsc::channel();
    thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if tx.send(line).is_err() {
                break;
            }
        }
    });
    let port = loop {
        let line = lines
            .recv_timeout(Duration::from_secs(20))
            .expect("the program says where it listens");
        if let Some(rest) = line.split("listening on TCP ").nth(1) {
            let port = rest.split(':').nth(1).and_then(|p| p.split(',').next());
            break port.expect("a port").parse().expect("a number");
        }
    };
    Device { child, port, lines }
}

fn handshake(device: &Device) -> TcpStream {
    let mut stream = TcpStream::connect(("127.0.0.1", device.port)).unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .unwrap();
    stream
        .write_all(&hello_frame(NONCE, 1_760_000_000_000))
        .unwrap();
    let mut buf = [0u8; 512];
    let n = stream.read(&mut buf).unwrap();
    let report = pong_report(&buf[..n]);
    assert!(report.contains("\"device_id\":\"RP-TEST\""), "{report}");
    assert!(report.contains(&format!("\"nonce\":{NONCE}")), "{report}");
    assert!(report.contains(&format!("\"mac\":\"{MAC}\"")), "{report}");
    stream
}

struct Seen {
    kind: u8,
    flags: u8,
    seq: u32,
    ts_us: u64,
    payload: Vec<u8>,
}

fn read_for(stream: &mut TcpStream, span: Duration) -> Vec<Seen> {
    let mut decoder = FrameDecoder::new();
    let mut seen = Vec::new();
    let mut buf = [0u8; 8192];
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
                    flags: f.flags,
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
        "every frame is whole and in sequence: {stats:?}"
    );
    seen
}

fn pulses_of(seen: &[Seen]) -> Vec<PdEvent> {
    seen.iter()
        .filter(|f| f.kind == Kind::PdEvent as u8)
        .flat_map(|f| decode_pd_events(&f.payload).expect("a PdEvent payload that fits its layout"))
        .collect()
}

fn statuses_of(seen: &[Seen]) -> Vec<(Status, Option<Vec<SensorStat>>)> {
    seen.iter()
        .filter(|f| f.kind == Kind::Status as u8)
        .map(|f| {
            (
                Status::decode(&f.payload).expect("a Status"),
                Status::sensors_of(&f.payload),
            )
        })
        .collect()
}

fn degrees(e: &PdEvent) -> f64 {
    f64::from(e.phase) / 65536.0 * 360.0
}

#[test]
fn it_measures_three_sensors_with_phase_and_streams_them_between_start_and_stop() {
    let _alone = alone();
    if !python_with_numpy() {
        eprintln!("python3 with numpy is not installed: skipping the device program test");
        return;
    }
    let beacon = UdpSocket::bind("127.0.0.1:0").unwrap();
    beacon
        .set_read_timeout(Some(Duration::from_secs(10)))
        .unwrap();
    let device = start(&["--level", "40"], beacon.local_addr().unwrap().port());
    let mut stream = handshake(&device);

    // Before Start it only answers: a status with the three sensors, flagged as made-up data, no lock yet
    // (nothing has measured the reference), and no pulses.
    stream.write_all(&ping_frame(1)).unwrap();
    let quiet = read_for(&mut stream, Duration::from_millis(600));
    assert!(pulses_of(&quiet).is_empty(), "no pulses before Start");
    let status = &statuses_of(&quiet)[0];
    assert_ne!(
        status.0.flags & STATUS_SYNTHETIC,
        0,
        "the simulated source says its data is made up"
    );
    assert_eq!(
        status.1.as_ref().map(Vec::len),
        Some(3),
        "three sensors are reported"
    );

    stream.write_all(&start_frame(2)).unwrap();
    let seen = read_for(&mut stream, Duration::from_millis(3500));
    let pulses = pulses_of(&seen);
    assert!(
        pulses.len() > 150,
        "pulses flow after Start: {}",
        pulses.len()
    );

    // Every sensor sees pulses; the amplitudes read back through the app's calibration are near the
    // 40 dBmV the simulation was asked for (sensor 1 at its level, the others 3 and 6 dB lower).
    for sensor in 0..3u8 {
        let n = pulses.iter().filter(|e| e.channel == sensor).count();
        assert!(n > 20, "sensor {sensor} saw {n} pulses");
    }
    assert!(pulses.iter().all(|e| e.channel < 3));
    let loudest = pulses
        .iter()
        .map(|e| counts_to_dbmv(f64::from(e.amp_counts)))
        .fold(f64::MIN, f64::max);
    assert!(
        (38.0..=46.0).contains(&loudest),
        "the loudest pulse is near the level, not {loudest:.1} dBmV"
    );
    let loudest_of = |sensor: u8| {
        pulses
            .iter()
            .filter(|e| e.channel == sensor)
            .map(|e| counts_to_dbmv(f64::from(e.amp_counts)))
            .fold(f64::MIN, f64::max)
    };
    assert!(
        loudest_of(0) > loudest_of(2) + 2.0,
        "sensor 3 is less sensitive than sensor 1"
    );
    // The weakest are just over the detection threshold (6 times the noise): 21 dBmV and up.
    assert!(
        pulses
            .iter()
            .all(|e| counts_to_dbmv(f64::from(e.amp_counts)) > 18.0)
    );

    // Phase: the simulated discharges fire around 90 and 270 degrees, and polarity says which half-cycle.
    let in_lobes = pulses
        .iter()
        .filter(|e| (70.0..=110.0).contains(&degrees(e)) || (250.0..=290.0).contains(&degrees(e)))
        .count();
    assert!(
        in_lobes as f64 >= 0.9 * pulses.len() as f64,
        "{in_lobes} of {} in the lobes",
        pulses.len()
    );
    for e in &pulses {
        assert_eq!(e.polarity, u8::from(degrees(e) >= 180.0), "{e:?}");
        assert!(e.width_ns > 0, "{e:?}");
    }
    assert!(
        pulses.iter().all(|e| e.t_us < 100_000),
        "offsets are inside a batch"
    );

    // The status: the reference locked once the program had measured it, per-sensor noise near 6 dBmV, and
    // the rates of the sensors add up to the total.
    let statuses = statuses_of(&seen);
    assert!(statuses.len() >= 2);
    let (last, sensors) = statuses.last().unwrap();
    assert_ne!(
        last.flags & STATUS_MAINS_LOCK,
        0,
        "the mains reference is locked"
    );
    assert_ne!(last.flags & STATUS_SYNTHETIC, 0);
    let sensors = sensors.as_ref().expect("per-sensor figures");
    for s in sensors {
        let noise = counts_to_dbmv(f64::from(s.noise_floor_counts));
        assert!((4.5..=7.5).contains(&noise), "noise {noise:.1} dBmV");
    }
    let sum: u32 = sensors.iter().map(|s| u32::from(s.trigger_rate_hz)).sum();
    assert!(
        u32::from(last.trigger_rate_hz).abs_diff(sum) <= 3,
        "the total is the sum: {} vs {sum}",
        last.trigger_rate_hz
    );
    assert!(last.trigger_rate_hz > 20);
    assert_eq!(last.adc_clip_pct_x10, 0);
    // Clocks and sequence numbers.
    assert!(
        seen.windows(2)
            .all(|w| w[1].seq == w[0].seq.wrapping_add(1))
    );
    assert!(
        seen.iter().all(|f| f.flags & 0b10 == 0),
        "nothing was dropped"
    );
    assert!(
        seen.iter()
            .filter(|f| f.kind == Kind::PdEvent as u8)
            .all(|f| f.ts_us > 0)
    );

    // Stop ends it and the link still answers; a second Start streams again.
    stream.write_all(&stop_frame(3)).unwrap();
    let _ = read_for(&mut stream, Duration::from_millis(400));
    let after = read_for(&mut stream, Duration::from_millis(800));
    assert!(pulses_of(&after).is_empty(), "no pulses after Stop");
    stream.write_all(&ping_frame(4)).unwrap();
    assert_eq!(
        statuses_of(&read_for(&mut stream, Duration::from_millis(400))).len(),
        1
    );
    stream.write_all(&start_frame(5)).unwrap();
    assert!(
        !pulses_of(&read_for(&mut stream, Duration::from_millis(1500))).is_empty(),
        "a second Start streams again"
    );
    drop(stream);

    // The beacon, with the unit's MAC address.
    let mut datagram = [0u8; 64];
    let (n, _) = beacon
        .recv_from(&mut datagram)
        .expect("a beacon within 10 s");
    let report = beacon_report(&datagram[..n]);
    assert!(
        report.contains("\"device_id\":\"RP-TEST\"")
            && report.contains(&format!("\"tcp_port\":{}", device.port)),
        "{report}"
    );
    assert!(Beacon::mac_of(&datagram[..n]).is_some());

    let mut log = String::new();
    while let Ok(line) = device.lines.recv_timeout(Duration::from_millis(500)) {
        log.push_str(&line);
        log.push('\n');
    }
    assert!(
        log.contains("START from 127.0.0.1")
            && log.contains("STOP from 127.0.0.1")
            && log.contains("MADE-UP data"),
        "{log}"
    );
}

#[test]
fn without_a_mains_reference_pulses_flow_but_the_status_says_the_phase_means_nothing() {
    let _alone = alone();
    if !python_with_numpy() {
        eprintln!("python3 with numpy is not installed: skipping the device program test");
        return;
    }
    let beacon = UdpSocket::bind("127.0.0.1:0").unwrap();
    let device = start(
        &["--no-ref", "--sensors", "2"],
        beacon.local_addr().unwrap().port(),
    );
    let mut stream = handshake(&device);
    stream.write_all(&start_frame(2)).unwrap();
    let seen = read_for(&mut stream, Duration::from_millis(3000));
    let pulses = pulses_of(&seen);
    assert!(
        pulses.len() > 50,
        "activity is still measured: {}",
        pulses.len()
    );
    assert!(
        pulses.iter().all(|e| e.channel < 2),
        "two sensors were asked for"
    );
    assert!(
        pulses.iter().all(|e| e.phase == 0 && e.polarity == 0),
        "no phase without a reference"
    );
    let statuses = statuses_of(&seen);
    assert!(
        statuses
            .iter()
            .all(|(s, _)| s.flags & STATUS_MAINS_LOCK == 0),
        "the status never claims a lock"
    );
    assert_eq!(statuses.last().unwrap().1.as_ref().map(Vec::len), Some(2));
}

#[test]
fn it_rejects_bad_options_before_it_starts() {
    let _alone = alone();
    if !python_with_numpy() {
        return;
    }
    for args in [
        &["--mac", "00:26:32:F0:C5"][..],
        &["--mac", "00:00:00:00:00:00"][..],
        &["--port", "70000"][..],
        &["--beacon-port", "0"][..],
        &["--sensors", "4"][..],
        &["--level", "95"][..],
        &["--device-id", "far-too-long-id"][..],
        &["--sensor-gain-db", "a,b"][..],
        &["--bogus"][..],
    ] {
        let status = Command::new("python3")
            .current_dir(device_dir())
            .args(["-m", "cantol_device", "run", "--source", "redpitaya"])
            .args(args)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .unwrap();
        assert_eq!(status.code(), Some(2), "{args:?}");
    }
}

#[test]
fn the_programs_own_unit_tests_pass() {
    let _alone = alone();
    if !python_with_numpy() {
        eprintln!("python3 with numpy is not installed: skipping the device program test");
        return;
    }
    let output = Command::new("python3")
        .current_dir(device_dir())
        .args(["-m", "unittest", "discover", "-s", "tests"])
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}
