//! Streaming frame decoder with resync.
//!
//! Feed it bytes in any chunking: the frames it emits and its [`Stats`] are identical however the
//! stream is split (the vectors in `rust/vectors` check this for many chunk sizes). Garbage and
//! corrupted frames are skipped by dropping one byte at a time until the next magic.

use crate::crc32::crc32;
use crate::frame::{CRC_LEN, FrameRef, HEADER_LEN, MAGIC_BYTES, MAX_PAYLOAD, PROTO_VERSION};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Stats {
    /// Bytes ever pushed.
    pub bytes_in: u64,
    /// Valid frames delivered.
    pub frames_ok: u64,
    /// A candidate frame whose CRC did not match.
    pub crc_errors: u64,
    /// A candidate header with an unsupported version or an impossible length.
    pub bad_headers: u64,
    /// Contiguous runs of discarded bytes between valid frames (one per run, not per byte).
    pub resyncs: u64,
    /// Bytes discarded without belonging to a valid frame.
    pub dropped_bytes: u64,
    /// Frames missing according to sequence numbers (includes frames lost to CRC errors).
    pub lost_frames: u64,
    /// Frames whose sequence number was behind the expected one (duplicate or reordered).
    pub out_of_order: u64,
}

#[derive(Debug, Default)]
pub struct FrameDecoder {
    buf: Vec<u8>,
    pos: usize,
    expected_seq: Option<u32>,
    in_garbage: bool,
    stats: Stats,
}

impl FrameDecoder {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn stats(&self) -> &Stats {
        &self.stats
    }

    /// Bytes buffered but not yet part of a complete frame.
    pub fn pending(&self) -> usize {
        self.buf.len() - self.pos
    }

    /// Forget buffered bytes and sequence state (call after a reconnect); statistics are kept.
    pub fn reset_stream(&mut self) {
        self.buf.clear();
        self.pos = 0;
        self.expected_seq = None;
        self.in_garbage = false;
    }

    /// Append `chunk` and deliver every complete valid frame to `on_frame`.
    pub fn push<F: FnMut(&FrameRef<'_>)>(&mut self, chunk: &[u8], mut on_frame: F) {
        self.stats.bytes_in += chunk.len() as u64;
        self.buf.extend_from_slice(chunk);
        while self.step(&mut on_frame) {}
        self.compact();
    }

    /// Try to make progress; returns false when more bytes are needed.
    fn step<F: FnMut(&FrameRef<'_>)>(&mut self, on_frame: &mut F) -> bool {
        let avail = self.buf.len() - self.pos;
        match find_magic(&self.buf[self.pos..]) {
            None => {
                // A lone first magic byte at the very end may be the start of a split magic: keep it.
                let keep = usize::from(avail > 0 && self.buf[self.buf.len() - 1] == MAGIC_BYTES[0]);
                self.drop_bytes(avail - keep);
                return false;
            }
            Some(offset) if offset > 0 => self.drop_bytes(offset),
            Some(_) => {}
        }

        let avail = self.buf.len() - self.pos;
        if avail < HEADER_LEN {
            return false;
        }
        let h = &self.buf[self.pos..self.pos + HEADER_LEN];
        let ver = h[2];
        let len = u32::from_le_bytes([h[17], h[18], h[19], h[20]]) as usize;
        if ver != PROTO_VERSION || len > MAX_PAYLOAD {
            self.stats.bad_headers += 1;
            self.drop_bytes(1);
            return true;
        }
        let total = HEADER_LEN + len + CRC_LEN;
        if avail < total {
            return false;
        }

        // Copy the header fields out so no borrow of `self.buf` outlives the checks below.
        let frame = &self.buf[self.pos..self.pos + total];
        let crc_at = total - CRC_LEN;
        let want = u32::from_le_bytes([
            frame[crc_at],
            frame[crc_at + 1],
            frame[crc_at + 2],
            frame[crc_at + 3],
        ]);
        let crc_ok = want == crc32(&frame[..crc_at]);
        let kind = frame[3];
        let flags = frame[4];
        let seq = u32::from_le_bytes([frame[5], frame[6], frame[7], frame[8]]);
        let mut ts = [0u8; 8];
        ts.copy_from_slice(&frame[9..17]);
        let ts_us = u64::from_le_bytes(ts);

        if !crc_ok {
            self.stats.crc_errors += 1;
            self.drop_bytes(1);
            return true;
        }
        self.track_sequence(seq);
        let payload = &self.buf[self.pos + HEADER_LEN..self.pos + crc_at];
        on_frame(&FrameRef {
            ver,
            kind,
            flags,
            seq,
            ts_us,
            payload,
        });
        self.pos += total;
        self.stats.frames_ok += 1;
        self.in_garbage = false;
        true
    }

    fn track_sequence(&mut self, seq: u32) {
        match self.expected_seq {
            None => self.expected_seq = Some(seq.wrapping_add(1)),
            Some(expected) => {
                let ahead = seq.wrapping_sub(expected);
                if ahead == 0 {
                    self.expected_seq = Some(seq.wrapping_add(1));
                } else if ahead < 0x8000_0000 {
                    self.stats.lost_frames += u64::from(ahead);
                    self.expected_seq = Some(seq.wrapping_add(1));
                } else {
                    self.stats.out_of_order += 1;
                }
            }
        }
    }

    fn drop_bytes(&mut self, n: usize) {
        if n == 0 {
            return;
        }
        if !self.in_garbage {
            self.stats.resyncs += 1;
            self.in_garbage = true;
        }
        self.stats.dropped_bytes += n as u64;
        self.pos += n;
    }

    fn compact(&mut self) {
        if self.pos > 0 {
            self.buf.drain(..self.pos);
            self.pos = 0;
        }
    }
}

fn find_magic(buf: &[u8]) -> Option<usize> {
    buf.windows(2).position(|w| w == MAGIC_BYTES)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::frame::{Kind, encode_frame};

    fn frame(seq: u32, payload: &[u8]) -> Vec<u8> {
        let mut out = Vec::new();
        encode_frame(
            &mut out,
            Kind::Status as u8,
            0,
            seq,
            u64::from(seq) * 10,
            payload,
        )
        .unwrap();
        out
    }

    fn decode(stream: &[u8], chunk: usize) -> (Vec<(u32, Vec<u8>)>, Stats, usize) {
        let mut dec = FrameDecoder::new();
        let mut frames = Vec::new();
        for part in stream.chunks(chunk) {
            dec.push(part, |f| frames.push((f.seq, f.payload.to_vec())));
        }
        (frames, *dec.stats(), dec.pending())
    }

    #[test]
    fn decodes_back_to_back_frames_in_any_chunking() {
        let mut stream = Vec::new();
        for i in 0..5u32 {
            stream.extend(frame(i, &vec![i as u8; (i as usize) * 3]));
        }
        for chunk in [1, 2, 5, 21, 64, stream.len()] {
            let (frames, stats, pending) = decode(&stream, chunk);
            assert_eq!(frames.len(), 5, "chunk {chunk}");
            assert_eq!(stats.frames_ok, 5);
            assert_eq!(
                stats.crc_errors + stats.bad_headers + stats.resyncs + stats.lost_frames,
                0
            );
            assert_eq!(pending, 0);
        }
    }

    #[test]
    fn skips_garbage_and_counts_one_resync_per_run() {
        let mut stream = vec![1, 2, 3, 4, 5];
        stream.extend(frame(0, b"a"));
        stream.extend([9, 9, 9]);
        stream.extend(frame(1, b"b"));
        for chunk in [1, 3, stream.len()] {
            let (frames, stats, _) = decode(&stream, chunk);
            assert_eq!(frames.len(), 2, "chunk {chunk}");
            assert_eq!(stats.resyncs, 2);
            assert_eq!(stats.dropped_bytes, 8);
        }
    }

    #[test]
    fn corrupted_frame_is_dropped_and_the_next_one_survives() {
        let mut stream = frame(0, b"first");
        let mut bad = frame(1, b"second-payload");
        bad[HEADER_LEN + 2] ^= 0x10;
        stream.extend(bad.clone());
        stream.extend(frame(2, b"third"));
        for chunk in [1, 7, stream.len()] {
            let (frames, stats, _) = decode(&stream, chunk);
            assert_eq!(
                frames.iter().map(|f| f.0).collect::<Vec<_>>(),
                vec![0, 2],
                "chunk {chunk}"
            );
            assert_eq!(stats.crc_errors, 1);
            assert_eq!(stats.lost_frames, 1);
            assert_eq!(stats.dropped_bytes, bad.len() as u64);
        }
    }

    #[test]
    fn magic_bytes_inside_a_valid_payload_do_not_break_framing() {
        let mut stream = frame(0, &[0x57, 0xCA, 0x57, 0xCA, 1, 1, 2]);
        stream.extend(frame(1, b"after"));
        let (frames, stats, _) = decode(&stream, 3);
        assert_eq!(frames.len(), 2);
        assert_eq!(stats.resyncs, 0);
    }

    #[test]
    fn wrong_version_and_oversized_length_are_bad_headers() {
        let mut v2 = frame(0, b"x");
        v2[2] = 2;
        let mut huge = frame(1, b"y");
        huge[17..21].copy_from_slice(&((MAX_PAYLOAD as u32) + 1).to_le_bytes());
        let mut stream = v2;
        stream.extend(huge);
        stream.extend(frame(2, b"ok"));
        let (frames, stats, _) = decode(&stream, 4);
        assert_eq!(frames.len(), 1);
        assert_eq!(stats.bad_headers, 2);
    }

    #[test]
    fn sequence_gaps_duplicates_and_wraparound() {
        let mut stream = Vec::new();
        for seq in [0u32, 1, 2, 5, 6, 3, 7] {
            stream.extend(frame(seq, b"s"));
        }
        let (_, stats, _) = decode(&stream, 100);
        assert_eq!(stats.lost_frames, 2);
        assert_eq!(stats.out_of_order, 1);

        let mut wrap = Vec::new();
        for seq in [u32::MAX - 1, u32::MAX, 0, 1] {
            wrap.extend(frame(seq, b"w"));
        }
        let (_, stats, _) = decode(&wrap, 100);
        assert_eq!(stats.lost_frames + stats.out_of_order, 0);
    }

    #[test]
    fn truncated_tail_stays_pending_and_completes_later() {
        let full = frame(0, b"complete me");
        let mut dec = FrameDecoder::new();
        let mut seen = 0;
        dec.push(&full[..10], |_| seen += 1);
        assert_eq!((seen, dec.pending()), (0, 10));
        dec.push(&full[10..], |_| seen += 1);
        assert_eq!((seen, dec.pending()), (1, 0));
    }

    #[test]
    fn lone_first_magic_byte_at_the_end_is_kept_for_the_next_chunk() {
        let f = frame(0, b"split");
        let mut dec = FrameDecoder::new();
        let mut seen = 0;
        dec.push(&f[..1], |_| seen += 1);
        assert_eq!(dec.pending(), 1);
        dec.push(&f[1..], |_| seen += 1);
        assert_eq!(seen, 1);
        assert_eq!(dec.stats().dropped_bytes, 0);
    }
}
