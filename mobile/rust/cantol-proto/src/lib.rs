//! Cantol link protocol, version 1.
//!
//! PLACEHOLDER: the frame layout and the message payloads in this crate are a proposal, not an
//! agreed contract. The Cantol side is undecided; see ADR-003 and, once agreed, ADR-005.
//!
//! Everything here is pure Rust with no I/O, so the same code runs natively (`cantol-mock`, tests)
//! and as WASM inside the app. Kotlin only moves bytes; framing, CRC and resync live here.

pub mod crc32;
pub mod decoder;
pub mod frame;
pub mod msg;
pub mod report;

pub use decoder::{FrameDecoder, Stats};
pub use frame::{FrameError, FrameRef, Kind, PROTO_VERSION, encode_frame};
