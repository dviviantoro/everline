//! A deterministic text report of decoding a byte stream.
//!
//! The same function backs the native tests, the WASM export and the in-app self-test, so the
//! golden vectors prove that every target produces byte-identical results. Counters are plain
//! integers; `ts_us` can exceed 2^53, so compare reports as strings, never through `JSON.parse`.

use std::fmt::Write as _;

use crate::crc32::crc32;
use crate::decoder::FrameDecoder;

/// Decode `stream` pushed in pieces of `chunk` bytes (clamped to at least 1) and describe the
/// frames and statistics as one line of JSON.
pub fn decode_report(stream: &[u8], chunk: usize) -> String {
    let mut decoder = FrameDecoder::new();
    let mut out = String::from("{\"frames\":[");
    let mut first = true;
    for part in stream.chunks(chunk.max(1)) {
        decoder.push(part, |f| {
            if !first {
                out.push(',');
            }
            first = false;
            let _ = write!(
                out,
                "{{\"kind\":{},\"flags\":{},\"seq\":{},\"ts_us\":{},\"len\":{},\"payload_crc32\":{}}}",
                f.kind,
                f.flags,
                f.seq,
                f.ts_us,
                f.payload.len(),
                crc32(f.payload)
            );
        });
    }
    let s = decoder.stats();
    let _ = write!(
        out,
        "],\"stats\":{{\"bytes_in\":{},\"frames_ok\":{},\"crc_errors\":{},\"bad_headers\":{},\"resyncs\":{},\"dropped_bytes\":{},\"lost_frames\":{},\"out_of_order\":{},\"pending\":{}}}}}",
        s.bytes_in,
        s.frames_ok,
        s.crc_errors,
        s.bad_headers,
        s.resyncs,
        s.dropped_bytes,
        s.lost_frames,
        s.out_of_order,
        decoder.pending()
    );
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::frame::encode_frame;

    #[test]
    fn report_is_independent_of_chunking() {
        let mut stream = Vec::new();
        for seq in 0..4u32 {
            encode_frame(
                &mut stream,
                3,
                0,
                seq,
                1_000 * u64::from(seq),
                &[seq as u8; 9],
            )
            .unwrap();
        }
        let whole = decode_report(&stream, usize::MAX);
        assert!(whole.starts_with("{\"frames\":[{\"kind\":3"));
        assert!(whole.contains("\"frames_ok\":4"));
        for chunk in [1, 2, 3, 7, 25, 100] {
            assert_eq!(decode_report(&stream, chunk), whole, "chunk {chunk}");
        }
    }

    #[test]
    fn empty_stream_has_empty_report() {
        assert_eq!(
            decode_report(&[], 8),
            "{\"frames\":[],\"stats\":{\"bytes_in\":0,\"frames_ok\":0,\"crc_errors\":0,\"bad_headers\":0,\"resyncs\":0,\"dropped_bytes\":0,\"lost_frames\":0,\"out_of_order\":0,\"pending\":0}}"
        );
    }
}
