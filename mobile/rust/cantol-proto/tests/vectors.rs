//! Golden vectors: the cross-target contract for the frame decoder.
//!
//! Streams are built deterministically here, with the expected counters derived from how each
//! stream was constructed (not from what the decoder happens to output). A normal run checks the
//! committed files in `rust/vectors/decode`; the same files are replayed in Node and inside the
//! Capacitor WebView by the self-test, and must give byte-identical reports.
//!
//! Regenerate after a deliberate protocol change with:
//! `UPDATE_VECTORS=1 cargo test -p cantol-proto --test vectors`

use std::collections::BTreeSet;
use std::path::PathBuf;
use std::{env, fs};

use cantol_proto::frame::{HEADER_LEN, Kind, MAGIC_BYTES, encode_frame};
use cantol_proto::msg::{Hello, PdEvent, Pong, STATUS_MAINS_LOCK, Status, encode_pd_events};
use cantol_proto::report::decode_report;
use cantol_proto::{FrameDecoder, Stats};

const CHUNKS: [usize; 11] = [1, 2, 3, 5, 7, 13, 21, 22, 64, 333, usize::MAX];

struct Rng(u64);

impl Rng {
    fn next_u64(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }

    fn range(&mut self, lo: usize, hi: usize) -> usize {
        lo + (self.next_u64() % (hi - lo + 1) as u64) as usize
    }

    /// Random bytes that never contain the magic pair, so they cannot fake a frame start.
    fn clean_bytes(&mut self, n: usize) -> Vec<u8> {
        let mut v: Vec<u8> = Vec::with_capacity(n);
        while v.len() < n {
            let b = (self.next_u64() >> 32) as u8;
            if b == MAGIC_BYTES[1] && v.last() == Some(&MAGIC_BYTES[0]) {
                continue;
            }
            v.push(b);
        }
        v
    }

    fn clean_payload(&mut self, min: usize, max: usize) -> Vec<u8> {
        let n = self.range(min, max);
        self.clean_bytes(n)
    }
}

fn contains_magic(bytes: &[u8]) -> bool {
    bytes.windows(2).any(|w| w == MAGIC_BYTES)
}

fn enc(kind: Kind, seq: u32, payload: &[u8]) -> Vec<u8> {
    let mut v = Vec::new();
    encode_frame(&mut v, kind as u8, 0, seq, u64::from(seq) * 1_000, payload).unwrap();
    v
}

/// A realistic message for slot `i`: hello, pong, then a mix of status and PD event batches.
fn typical(i: u32, rng: &mut Rng) -> (Kind, Vec<u8>) {
    match i {
        0 => {
            let h = Hello {
                proto_min: 1,
                proto_max: 1,
                nonce: 0xC0DE_0001,
                phone_epoch_ms: 1_760_000_000_000,
            };
            (Kind::Hello, h.encode().to_vec())
        }
        1 => {
            let p = Pong {
                proto: 1,
                caps: 0b11,
                fw: [0, 1, 0],
                // These bytes are inside the committed clean_10.bin vector. Renaming them
                // changes the payload CRC and the self-test digest; keep them until the vectors
                // are deliberately regenerated.
                device_id: *b"RP-00A1\0",
                cantol_epoch_ms: 5_000,
                nonce: 0xC0DE_0001,
            };
            (Kind::Pong, p.encode().to_vec())
        }
        _ if i % 4 == 3 => {
            let s = Status {
                temp_c_x10: 412,
                adc_clip_pct_x10: 3,
                noise_floor_counts: 70 + i as u16,
                trigger_rate_hz: 250,
                queue: 0,
                flags: STATUS_MAINS_LOCK,
            };
            (Kind::Status, s.encode().to_vec())
        }
        _ => {
            let n = rng.range(1, 8);
            let events: Vec<PdEvent> = (0..n)
                .map(|k| PdEvent {
                    t_us: (k * 500) as u32,
                    amp_counts: (rng.range(50, 4000) as i16) * if k % 2 == 0 { 1 } else { -1 },
                    phase: rng.range(0, 65_535) as u16,
                    width_ns: rng.range(40, 600) as u16,
                    polarity: (k % 2) as u8,
                })
                .collect();
            let mut payload = Vec::new();
            encode_pd_events(&events, &mut payload);
            (Kind::PdEvent, payload)
        }
    }
}

#[derive(Clone, Copy, Default)]
struct Expect {
    frames_ok: u64,
    crc_errors: u64,
    bad_headers: u64,
    resyncs: u64,
    dropped_bytes: u64,
    lost_frames: u64,
    out_of_order: u64,
    pending: usize,
}

impl Expect {
    fn check(&self, name: &str, s: &Stats, pending: usize) {
        let got = (
            s.frames_ok,
            s.crc_errors,
            s.bad_headers,
            s.resyncs,
            s.dropped_bytes,
            s.lost_frames,
            s.out_of_order,
            pending,
        );
        let want = (
            self.frames_ok,
            self.crc_errors,
            self.bad_headers,
            self.resyncs,
            self.dropped_bytes,
            self.lost_frames,
            self.out_of_order,
            self.pending,
        );
        assert_eq!(
            got, want,
            "{name}: (frames_ok, crc_errors, bad_headers, resyncs, dropped_bytes, lost_frames, out_of_order, pending)"
        );
    }
}

struct Case {
    name: &'static str,
    stream: Vec<u8>,
    expect: Expect,
}

fn frames_with_payloads(seqs: &[u32], rng: &mut Rng) -> Vec<Vec<u8>> {
    seqs.iter()
        .map(|&seq| enc(Kind::Status, seq, &rng.clean_payload(8, 80)))
        .collect()
}

/// A frame whose bytes after the first contain no magic pair, damaged by `damage`, so a decoder
/// that drops it must resync exactly at the next frame.
fn damaged_frame(seq: u32, rng: &mut Rng, damage: impl Fn(&mut Vec<u8>)) -> Vec<u8> {
    loop {
        let mut frame = enc(Kind::PdEvent, seq, &rng.clean_payload(8, 80));
        damage(&mut frame);
        if !contains_magic(&frame[1..]) {
            return frame;
        }
    }
}

fn cases() -> Vec<Case> {
    let mut rng = Rng(0x00C0_FFEE);
    let mut cases = Vec::new();
    let ok = |n: u64| Expect {
        frames_ok: n,
        ..Expect::default()
    };

    // 1. Ten valid frames of realistic messages, back to back.
    let mut clean = Vec::new();
    for i in 0..10 {
        let (kind, payload) = typical(i, &mut rng);
        clean.extend(enc(kind, i, &payload));
    }
    cases.push(Case {
        name: "clean_10",
        stream: clean,
        expect: ok(10),
    });

    // 2. Garbage runs between frames: two runs, 18 bytes in total.
    let f = frames_with_payloads(&[0, 1, 2, 3, 4, 5], &mut rng);
    let (g1, g2) = (rng.clean_bytes(13), rng.clean_bytes(5));
    let mut s = Vec::new();
    for part in [&f[0], &f[1], &g1, &f[2], &f[3], &g2, &f[4], &f[5]] {
        s.extend(part);
    }
    cases.push(Case {
        name: "garbage_between",
        stream: s,
        expect: Expect {
            frames_ok: 6,
            resyncs: 2,
            dropped_bytes: 18,
            ..Expect::default()
        },
    });

    // 3. One frame with a flipped payload bit: dropped whole, its neighbours survive.
    let f = frames_with_payloads(&[0, 1, 2, 4, 5, 6, 7], &mut rng);
    let bad = damaged_frame(3, &mut rng, |fr| fr[HEADER_LEN + 2] ^= 0x01);
    let mut s = Vec::new();
    for part in [&f[0], &f[1], &f[2], &bad, &f[3], &f[4], &f[5], &f[6]] {
        s.extend(part);
    }
    cases.push(Case {
        name: "crc_flip",
        stream: s,
        expect: Expect {
            frames_ok: 7,
            crc_errors: 1,
            resyncs: 1,
            dropped_bytes: bad.len() as u64,
            lost_frames: 1,
            ..Expect::default()
        },
    });

    // 4. Frames 3 and 4 never arrive.
    let f = frames_with_payloads(&[0, 1, 2, 5, 6, 7], &mut rng);
    cases.push(Case {
        name: "seq_gap",
        stream: f.concat(),
        expect: Expect {
            frames_ok: 6,
            lost_frames: 2,
            ..Expect::default()
        },
    });

    // 5. A complete valid frame carried inside another frame's payload is not scanned.
    let inner = enc(Kind::Waveform, 100, &rng.clean_payload(8, 30));
    let outer = enc(Kind::Waveform, 1, &inner);
    let mut s = enc(Kind::Status, 0, &[0x57, 0xCA, 0x57, 0xCA, 1, 0]);
    s.extend(outer);
    s.extend(enc(Kind::Status, 2, b"after"));
    cases.push(Case {
        name: "magic_in_payload",
        stream: s,
        expect: ok(3),
    });

    // 6. The stream ends in the middle of the sixth frame.
    let f = frames_with_payloads(&[0, 1, 2, 3, 4, 5], &mut rng);
    let mut s = f[..5].concat();
    s.extend(&f[5][..10]);
    cases.push(Case {
        name: "truncated_tail",
        stream: s,
        expect: Expect {
            frames_ok: 5,
            pending: 10,
            ..Expect::default()
        },
    });

    // 7. A duplicate (sequence number behind the expected one) is counted, not lost.
    let f = frames_with_payloads(&[0, 1, 2, 1, 3], &mut rng);
    cases.push(Case {
        name: "out_of_order",
        stream: f.concat(),
        expect: Expect {
            frames_ok: 5,
            out_of_order: 1,
            ..Expect::default()
        },
    });

    // 8. Sequence numbers wrap past u32::MAX without counting a loss.
    let f = frames_with_payloads(&[u32::MAX - 1, u32::MAX, 0, 1], &mut rng);
    cases.push(Case {
        name: "seq_wrap",
        stream: f.concat(),
        expect: ok(4),
    });

    // 9. A frame with an unsupported protocol version is a bad header and is skipped whole.
    let f = frames_with_payloads(&[0, 1, 3, 4], &mut rng);
    let bad = damaged_frame(2, &mut rng, |fr| fr[2] = 2);
    let mut s = Vec::new();
    for part in [&f[0], &f[1], &bad, &f[2], &f[3]] {
        s.extend(part);
    }
    cases.push(Case {
        name: "bad_version",
        stream: s,
        expect: Expect {
            frames_ok: 4,
            bad_headers: 1,
            resyncs: 1,
            dropped_bytes: bad.len() as u64,
            lost_frames: 1,
            ..Expect::default()
        },
    });

    cases
}

fn decode(stream: &[u8]) -> (Stats, usize) {
    let mut decoder = FrameDecoder::new();
    decoder.push(stream, |_| {});
    (*decoder.stats(), decoder.pending())
}

fn vectors_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../vectors/decode")
}

#[test]
fn expectations_follow_from_construction() {
    for case in cases() {
        let (stats, pending) = decode(&case.stream);
        case.expect.check(case.name, &stats, pending);
    }
}

#[test]
fn reports_do_not_depend_on_chunking() {
    for case in cases() {
        let whole = decode_report(&case.stream, usize::MAX);
        for chunk in CHUNKS {
            assert_eq!(
                decode_report(&case.stream, chunk),
                whole,
                "{} with chunk {chunk}",
                case.name
            );
        }
    }
}

#[test]
fn committed_files_match_the_generator() {
    let bless = env::var_os("UPDATE_VECTORS").is_some();
    let dir = vectors_dir();
    let mut names = BTreeSet::new();
    if bless {
        fs::create_dir_all(&dir).unwrap();
    }
    for case in cases() {
        names.insert(case.name.to_string());
        let report = decode_report(&case.stream, usize::MAX);
        let bin = dir.join(format!("{}.bin", case.name));
        let json = dir.join(format!("{}.json", case.name));
        if bless {
            fs::write(&bin, &case.stream).unwrap();
            fs::write(&json, &report).unwrap();
            continue;
        }
        let hint = "run UPDATE_VECTORS=1 cargo test -p cantol-proto --test vectors";
        assert_eq!(
            fs::read(&bin).unwrap_or_default(),
            case.stream,
            "{}.bin differs ({hint})",
            case.name
        );
        let committed = fs::read_to_string(&json).unwrap_or_default();
        assert_eq!(
            committed.trim(),
            report,
            "{}.json differs ({hint})",
            case.name
        );
    }
    if !bless {
        let on_disk: BTreeSet<String> = fs::read_dir(&dir)
            .expect("vectors/decode exists")
            .filter_map(|e| e.ok()?.path().file_stem()?.to_str().map(String::from))
            .collect();
        assert_eq!(on_disk, names, "stale or missing vector files");
    }
}
