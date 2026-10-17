//! PD analysis for the Cantol mobile app.
//!
//! Phase 0 holds only severity classification. Pulse detection, calibration and PRPD binning
//! (Phase 3) wait on the decision of where detection runs: on the Red Pitaya or on the phone.
//! If the Red Pitaya sends only final numbers, this crate stays this small.

pub mod severity;

pub use severity::{DBMV_ZONES, Severity, Zones, classify};
