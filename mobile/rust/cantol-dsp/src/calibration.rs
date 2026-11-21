//! Counts to dBmV.
//!
//! PLACEHOLDER: the real factor depends on the Red Pitaya's ADC range and the front end in front of
//! it, and nobody has measured it yet. `MV_PER_COUNT` is chosen so that the numbers land where the
//! demo's do (a noise floor of a few dBmV, a strong discharge at 40 dBmV and above), which makes
//! every level the app shows from a real device provisional until it is replaced. It is one
//! constant, here, so the day it is measured is a one-line change plus the vectors below.
//!
//! `device/cantol-pingpong.sh` repeats the constant to make test data of a chosen level; its test
//! (`cantol-mock/tests/device_script.rs`) reads that data back through [`counts_to_dbmv`], so the
//! two cannot drift apart unnoticed.

/// Millivolts at the input for one ADC count. PLACEHOLDER (see the module text).
pub const MV_PER_COUNT: f64 = 0.1;

/// Level in dBmV (decibels above one millivolt) of a signal of `counts` ADC counts, positive or
/// negative. Zero counts count as one, the smallest step the ADC can show, so the result is always
/// finite.
pub fn counts_to_dbmv(counts: f64) -> f64 {
    20.0 * (counts.abs().max(1.0) * MV_PER_COUNT).log10()
}

/// The inverse of [`counts_to_dbmv`] for levels from the smallest step upwards: how many counts a
/// signal of `dbmv` is. Used by tests and by the simulated sources, never by the app.
pub fn dbmv_to_counts(dbmv: f64) -> f64 {
    10f64.powf(dbmv / 20.0) / MV_PER_COUNT
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_decade_of_counts_is_twenty_decibels() {
        assert!((counts_to_dbmv(10.0) - 0.0).abs() < 1e-9);
        assert!((counts_to_dbmv(100.0) - 20.0).abs() < 1e-9);
        assert!((counts_to_dbmv(1000.0) - 40.0).abs() < 1e-9);
        assert!((counts_to_dbmv(10_000.0) - 60.0).abs() < 1e-9);
    }

    #[test]
    fn the_sign_does_not_matter_and_zero_is_the_smallest_step() {
        assert_eq!(counts_to_dbmv(-250.0), counts_to_dbmv(250.0));
        assert_eq!(counts_to_dbmv(0.0), counts_to_dbmv(1.0));
        assert!(counts_to_dbmv(0.0).is_finite());
        assert!(counts_to_dbmv(f64::MAX).is_finite());
    }

    #[test]
    fn the_two_directions_agree() {
        for dbmv in [0.0, 6.0, 25.5, 40.0, 62.0] {
            assert!(
                (counts_to_dbmv(dbmv_to_counts(dbmv)) - dbmv).abs() < 1e-9,
                "{dbmv}"
            );
        }
    }
}
