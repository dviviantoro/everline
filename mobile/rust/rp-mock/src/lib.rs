//! Simulated Red Pitaya: a TCP data link plus a UDP discovery beacon, with fault injection, so
//! the app can be built and tested without the real device. It speaks the PLACEHOLDER protocol
//! in `cantol-proto`; when the real protocol is agreed, update `cantol-proto` and this follows.
//!
//! A phone-side test needs no hardware: join the Mac to the phone's hotspot, run `rp-mock`, and
//! the app discovers and talks to it exactly as it would to the real board.

mod config;
mod link;
mod rng;
mod server;

pub use config::Config;
pub use server::{Handle, spawn};
