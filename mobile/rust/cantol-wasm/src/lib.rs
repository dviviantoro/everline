//! WebAssembly facade over `cantol-proto` and `cantol-dsp`, run inside the app's Web Worker.
//!
//! Keep this a thin surface: all logic lives in the pure crates, which are tested natively.
//! The WASM module is a calculator. It does no I/O and holds no persistent state beyond the
//! decoder's buffer, because the Kotlin plugin moves the bytes and TypeScript owns storage.

use cantol_dsp::{DBMV_ZONES, classify};
use cantol_proto::frame::{Kind, encode_frame};
use cantol_proto::report::decode_report;
use cantol_proto::{FrameDecoder, PROTO_VERSION};
use wasm_bindgen::prelude::*;

/// Build identity shown on the self-test screen.
#[wasm_bindgen]
pub fn version() -> String {
    format!(
        "cantol-wasm {} (protocol v{PROTO_VERSION})",
        env!("CARGO_PKG_VERSION")
    )
}

/// One-line JSON report of decoding `stream` in pieces of `chunk` bytes. The self-test replays
/// the golden vectors through this and compares the text to the committed expectation.
#[wasm_bindgen]
pub fn decode_vector_report(stream: &[u8], chunk: u32) -> String {
    decode_report(stream, chunk as usize)
}

/// Severity code for a dBmV magnitude: 0 normal, 1 warning, 2 critical, 255 not classifiable.
#[wasm_bindgen]
pub fn classify_dbmv(magnitude: f64) -> u8 {
    classify(magnitude, &DBMV_ZONES).map_or(255, |s| s as u8)
}

/// A valid stream of `frames` frames with `payload_len`-byte payloads, for throughput tests.
/// Returns an empty stream if `payload_len` exceeds the protocol maximum.
#[wasm_bindgen]
pub fn make_bench_stream(frames: u32, payload_len: u32) -> Vec<u8> {
    let payload: Vec<u8> = (0..payload_len).map(|i| (i % 251) as u8).collect();
    let mut out = Vec::with_capacity(frames as usize * (payload.len() + 25));
    for seq in 0..frames {
        if encode_frame(
            &mut out,
            Kind::Waveform as u8,
            0,
            seq,
            u64::from(seq) * 100,
            &payload,
        )
        .is_err()
        {
            return Vec::new();
        }
    }
    out
}

/// A frame decoder session for one RP connection.
#[wasm_bindgen]
pub struct Session {
    decoder: FrameDecoder,
}

impl Default for Session {
    fn default() -> Self {
        Self::new()
    }
}

#[wasm_bindgen]
impl Session {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Session {
        Session {
            decoder: FrameDecoder::new(),
        }
    }

    /// Feed bytes from the link; returns how many valid frames this chunk completed.
    pub fn push(&mut self, chunk: &[u8]) -> u32 {
        let mut completed = 0u32;
        self.decoder.push(chunk, |_| completed += 1);
        completed
    }

    /// Forget buffered bytes and sequence state after a reconnect; counters are kept.
    pub fn reset_stream(&mut self) {
        self.decoder.reset_stream();
    }

    // Counters are f64 so JavaScript gets plain numbers instead of BigInt (safe up to 2^53).
    pub fn frames_ok(&self) -> f64 {
        self.decoder.stats().frames_ok as f64
    }

    pub fn crc_errors(&self) -> f64 {
        self.decoder.stats().crc_errors as f64
    }

    pub fn lost_frames(&self) -> f64 {
        self.decoder.stats().lost_frames as f64
    }

    pub fn resyncs(&self) -> f64 {
        self.decoder.stats().resyncs as f64
    }

    pub fn dropped_bytes(&self) -> f64 {
        self.decoder.stats().dropped_bytes as f64
    }

    pub fn pending(&self) -> u32 {
        self.decoder.pending() as u32
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bench_stream_decodes_completely_in_any_chunking() {
        let stream = make_bench_stream(40, 1500);
        for chunk in [1usize, 7, 1024, stream.len()] {
            let mut session = Session::new();
            let total: u32 = stream.chunks(chunk).map(|c| session.push(c)).sum();
            assert_eq!(total, 40, "chunk {chunk}");
            assert_eq!(
                (
                    session.frames_ok(),
                    session.crc_errors(),
                    session.lost_frames()
                ),
                (40.0, 0.0, 0.0)
            );
            assert_eq!(session.pending(), 0);
        }
    }

    #[test]
    fn oversized_bench_payload_yields_empty_stream() {
        assert!(make_bench_stream(2, 70_000).is_empty());
    }

    #[test]
    fn severity_codes() {
        assert_eq!(classify_dbmv(5.0), 0);
        assert_eq!(classify_dbmv(20.0), 1);
        assert_eq!(classify_dbmv(40.0), 2);
        assert_eq!(classify_dbmv(f64::NAN), 255);
    }

    #[test]
    fn version_names_the_protocol() {
        assert!(version().contains("protocol v1"));
    }
}
