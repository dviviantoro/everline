//! PD analysis for the Cantol mobile app.
//!
//! Holds severity classification and the tracking-mode trend rules. Pulse detection, calibration
//! and PRPD binning (Phase 3) wait on the decision of where detection runs: on Cantol or on the
//! phone. If Cantol sends only final numbers, this crate stays this small.

pub mod severity;
pub mod trend;

pub use severity::{DBMV_ZONES, Severity, Zones, classify};
pub use trend::{
    Guidance, Trend, guidance, live_level, live_trend, mark_value, peak_index, segment_trend,
    window_peak,
};
