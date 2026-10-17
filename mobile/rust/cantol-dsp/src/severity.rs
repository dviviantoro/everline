//! Severity zones for a PD magnitude.

/// Matches the API's `severity` enum (`normal`, `warning`, `critical`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum Severity {
    Normal = 0,
    Warning = 1,
    Critical = 2,
}

impl Severity {
    pub fn as_str(self) -> &'static str {
        match self {
            Severity::Normal => "normal",
            Severity::Warning => "warning",
            Severity::Critical => "critical",
        }
    }
}

/// Lower bounds of the warning and critical zones, in the magnitude's own unit.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Zones {
    pub caution_from: f64,
    pub danger_from: f64,
}

/// ASSUMPTION, PROVISIONAL: PLN's real PD thresholds are not defined (`planning/PROJECT_BRIEF.md`
/// section 16). These are the same numbers as `PD_ZONES` in `apps/lib/severity.ts` and the
/// severity cut-offs in `backend/scripts/seed.ts`; change all three together.
pub const DBMV_ZONES: Zones = Zones {
    caution_from: 20.0,
    danger_from: 40.0,
};

/// Classify a magnitude. `None` for NaN or infinite input (a reading that cannot be classified is
/// not silently called normal).
pub fn classify(magnitude: f64, zones: &Zones) -> Option<Severity> {
    if !magnitude.is_finite() {
        return None;
    }
    Some(if magnitude >= zones.danger_from {
        Severity::Critical
    } else if magnitude >= zones.caution_from {
        Severity::Warning
    } else {
        Severity::Normal
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    #[test]
    fn boundaries_belong_to_the_higher_zone() {
        assert_eq!(classify(19.999, &DBMV_ZONES), Some(Severity::Normal));
        assert_eq!(classify(20.0, &DBMV_ZONES), Some(Severity::Warning));
        assert_eq!(classify(39.999, &DBMV_ZONES), Some(Severity::Warning));
        assert_eq!(classify(40.0, &DBMV_ZONES), Some(Severity::Critical));
    }

    #[test]
    fn weak_signals_and_non_finite_input() {
        assert_eq!(classify(-60.0, &DBMV_ZONES), Some(Severity::Normal));
        assert_eq!(classify(f64::NAN, &DBMV_ZONES), None);
        assert_eq!(classify(f64::INFINITY, &DBMV_ZONES), None);
    }

    #[test]
    fn matches_the_shared_vector_file() {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../vectors/classify/cases.txt");
        let text = fs::read_to_string(path).expect("vectors/classify/cases.txt");
        let mut checked = 0;
        for line in text
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty() && !l.starts_with('#'))
        {
            let (value, want) = line.split_once(' ').expect("'<magnitude> <severity>'");
            let magnitude: f64 = value.parse().expect("magnitude");
            let got = classify(magnitude, &DBMV_ZONES).map_or("unknown", Severity::as_str);
            assert_eq!(got, want.trim(), "classify({value})");
            checked += 1;
        }
        assert!(checked >= 8, "vector file looks truncated");
    }
}
