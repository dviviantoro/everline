//! Frame layout (all integers little-endian):
//!
//! ```text
//! magic u16 (0xCA57) | ver u8 | kind u8 | flags u8 | seq u32 | ts_us u64 | len u32 | payload | crc32 u32
//! ```
//!
//! The CRC covers everything before it (header and payload). `len` is capped at [`MAX_PAYLOAD`];
//! a larger value is treated as a false magic. A corrupted but plausible `len` can stall the
//! decoder until that many more bytes arrive (then the CRC fails and it resyncs): flagged for the
//! protocol review.

use crate::crc32::crc32;

pub const MAGIC: u16 = 0xCA57;
pub const MAGIC_BYTES: [u8; 2] = MAGIC.to_le_bytes();
pub const PROTO_VERSION: u8 = 1;
pub const HEADER_LEN: usize = 21;
pub const CRC_LEN: usize = 4;
pub const MAX_PAYLOAD: usize = 64 * 1024;

/// More frames follow that belong to the same message.
pub const FLAG_MORE: u8 = 0b01;
/// The sender dropped data before this frame (its queue overflowed).
pub const FLAG_DROPPED_BEFORE: u8 = 0b10;

/// Known frame kinds. Unknown kinds are not an error: the decoder passes the raw `u8` through so
/// a newer sender does not break an older receiver.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum Kind {
    Hello = 0x01,
    Pong = 0x02,
    Status = 0x03,
    PdEvent = 0x10,
    Waveform = 0x11,
    Summary = 0x12,
    Start = 0x20,
    Stop = 0x21,
    Config = 0x22,
    Ping = 0x30,
    Error = 0x7F,
}

impl Kind {
    pub fn from_u8(value: u8) -> Option<Kind> {
        Some(match value {
            0x01 => Kind::Hello,
            0x02 => Kind::Pong,
            0x03 => Kind::Status,
            0x10 => Kind::PdEvent,
            0x11 => Kind::Waveform,
            0x12 => Kind::Summary,
            0x20 => Kind::Start,
            0x21 => Kind::Stop,
            0x22 => Kind::Config,
            0x30 => Kind::Ping,
            0x7F => Kind::Error,
            _ => return None,
        })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FrameError {
    PayloadTooLarge,
}

/// A decoded frame borrowing its payload from the decoder's buffer. Valid only inside the
/// `on_frame` callback.
#[derive(Clone, Copy, Debug)]
pub struct FrameRef<'a> {
    pub ver: u8,
    pub kind: u8,
    pub flags: u8,
    pub seq: u32,
    pub ts_us: u64,
    pub payload: &'a [u8],
}

/// Append one encoded frame to `out`.
pub fn encode_frame(
    out: &mut Vec<u8>,
    kind: u8,
    flags: u8,
    seq: u32,
    ts_us: u64,
    payload: &[u8],
) -> Result<(), FrameError> {
    if payload.len() > MAX_PAYLOAD {
        return Err(FrameError::PayloadTooLarge);
    }
    let start = out.len();
    out.extend_from_slice(&MAGIC_BYTES);
    out.push(PROTO_VERSION);
    out.push(kind);
    out.push(flags);
    out.extend_from_slice(&seq.to_le_bytes());
    out.extend_from_slice(&ts_us.to_le_bytes());
    out.extend_from_slice(&(payload.len() as u32).to_le_bytes());
    out.extend_from_slice(payload);
    let crc = crc32(&out[start..]);
    out.extend_from_slice(&crc.to_le_bytes());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn magic_bytes_are_little_endian() {
        assert_eq!(MAGIC_BYTES, [0x57, 0xCA]);
    }

    #[test]
    fn encoded_length_is_header_payload_crc() {
        let mut out = Vec::new();
        encode_frame(&mut out, Kind::Status as u8, 0, 7, 99, &[1, 2, 3]).unwrap();
        assert_eq!(out.len(), HEADER_LEN + 3 + CRC_LEN);
        assert_eq!(&out[..2], &MAGIC_BYTES);
        assert_eq!(out[2], PROTO_VERSION);
        assert_eq!(out[3], Kind::Status as u8);
    }

    #[test]
    fn rejects_oversized_payload() {
        let mut out = Vec::new();
        let big = vec![0u8; MAX_PAYLOAD + 1];
        assert_eq!(
            encode_frame(&mut out, 1, 0, 0, 0, &big),
            Err(FrameError::PayloadTooLarge)
        );
        assert!(out.is_empty());
    }

    #[test]
    fn kind_round_trips() {
        for k in [
            Kind::Hello,
            Kind::Pong,
            Kind::Status,
            Kind::PdEvent,
            Kind::Error,
        ] {
            assert_eq!(Kind::from_u8(k as u8), Some(k));
        }
        assert_eq!(Kind::from_u8(0xEE), None);
    }
}
