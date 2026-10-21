//! Tracking-mode signal rules (`dev-docs/architecture/mobile-tracking-mode.md` section 3).
//!
//! Everything here is pure arithmetic on a series of per-second levels in dBmV, so the phone, the
//! tests and (one day) the dashboard can agree on the same words. The TypeScript side only
//! renders what these functions return and holds no threshold of its own.
//!
//! Every number marked "Assumption" in the design is a named constant below. Differences are in
//! dB (the difference of two dBmV values), not dBmV.

/// Samples averaged for the live level.
pub const LEVEL_SAMPLES: usize = 3;
/// Live trend: the live level against the mean of the three samples before it. ASSUMPTION.
pub const LIVE_TREND_DB: f64 = 1.5;
/// Segment trend: the value at one mark against the previous mark. ASSUMPTION.
pub const SEGMENT_TREND_DB: f64 = 3.0;
/// Guidance: more than this far below the peak means "go back". ASSUMPTION.
pub const GO_BACK_DB: f64 = 6.0;
/// Guidance: within this of the peak means "at the strongest reading". ASSUMPTION.
pub const AT_PEAK_DB: f64 = 3.0;
/// A mark's value is the window peak of this many of the latest samples (the dwell, one per second). ASSUMPTION.
pub const DWELL_SAMPLES: usize = 5;

/// Which way the level is going.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum Trend {
    Steady = 0,
    Rising = 1,
    Falling = 2,
}

impl Trend {
    pub fn as_str(self) -> &'static str {
        match self {
            Trend::Steady => "steady",
            Trend::Rising => "rising",
            Trend::Falling => "falling",
        }
    }
}

/// What the guidance card should say.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum Guidance {
    /// Neither near the peak nor far below it: show the trend text only.
    TrendOnly = 0,
    /// Within `AT_PEAK_DB` of the peak: "At the strongest reading".
    AtPeak = 1,
    /// More than `GO_BACK_DB` below the peak: "go back to the peak station".
    GoBack = 2,
}

impl Guidance {
    pub fn as_str(self) -> &'static str {
        match self {
            Guidance::TrendOnly => "trend_only",
            Guidance::AtPeak => "at_peak",
            Guidance::GoBack => "go_back",
        }
    }
}

/// The highest finite value, or `None` when there is none. Non-finite values are skipped: a
/// reading that cannot be compared must not become the maximum. The window statistic is the peak
/// (ASSUMPTION: open question 1 in `mobile-ui-spec.md` may change it).
pub fn window_peak(values: &[f64]) -> Option<f64> {
    values
        .iter()
        .copied()
        .filter(|v| v.is_finite())
        .fold(None, |best, v| match best {
            Some(b) if b >= v => Some(b),
            _ => Some(v),
        })
}

fn mean(values: &[f64]) -> Option<f64> {
    if values.is_empty() || values.iter().any(|v| !v.is_finite()) {
        return None;
    }
    Some(values.iter().sum::<f64>() / values.len() as f64)
}

/// The live level: the mean of the last `LEVEL_SAMPLES` samples (fewer, if that is all there is).
/// `None` for no samples or a non-finite sample among them.
pub fn live_level(samples: &[f64]) -> Option<f64> {
    let from = samples.len().saturating_sub(LEVEL_SAMPLES);
    mean(&samples[from..])
}

/// The live trend: the live level against the mean of the three samples before it. Needs
/// `2 * LEVEL_SAMPLES` samples. A difference of exactly `LIVE_TREND_DB` counts as rising or falling.
pub fn live_trend(samples: &[f64]) -> Option<Trend> {
    if samples.len() < 2 * LEVEL_SAMPLES {
        return None;
    }
    let split = samples.len() - LEVEL_SAMPLES;
    let now = mean(&samples[split..])?;
    let before = mean(&samples[split - LEVEL_SAMPLES..split])?;
    Some(classify_difference(now - before, LIVE_TREND_DB))
}

/// The trend between two consecutive marks. A difference of exactly `SEGMENT_TREND_DB` counts as
/// rising or falling.
pub fn segment_trend(from: f64, to: f64) -> Option<Trend> {
    if !from.is_finite() || !to.is_finite() {
        return None;
    }
    Some(classify_difference(to - from, SEGMENT_TREND_DB))
}

fn classify_difference(difference: f64, threshold: f64) -> Trend {
    if difference >= threshold {
        Trend::Rising
    } else if difference <= -threshold {
        Trend::Falling
    } else {
        Trend::Steady
    }
}

/// The value of a mark: the window peak of the last `DWELL_SAMPLES` samples (all of them, if fewer).
pub fn mark_value(samples: &[f64]) -> Option<f64> {
    let from = samples.len().saturating_sub(DWELL_SAMPLES);
    window_peak(&samples[from..])
}

/// Index of the highest finite value (the first one, on a tie), or `None` when there is none.
pub fn peak_index(values: &[f64]) -> Option<usize> {
    let mut best: Option<(usize, f64)> = None;
    for (index, value) in values.iter().copied().enumerate() {
        if !value.is_finite() {
            continue;
        }
        if best.is_none_or(|(_, b)| value > b) {
            best = Some((index, value));
        }
    }
    best.map(|(index, _)| index)
}

/// What to tell the operator, from the live level and the highest mark so far (both dBmV).
/// Exactly `GO_BACK_DB` below the peak is not "more than", so it is not `GoBack`; exactly
/// `AT_PEAK_DB` below counts as at the peak.
pub fn guidance(live: f64, peak: f64) -> Option<Guidance> {
    if !live.is_finite() || !peak.is_finite() {
        return None;
    }
    let below = peak - live;
    Some(if below > GO_BACK_DB {
        Guidance::GoBack
    } else if below <= AT_PEAK_DB {
        Guidance::AtPeak
    } else {
        Guidance::TrendOnly
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    #[test]
    fn window_peak_ignores_non_finite_values() {
        assert_eq!(window_peak(&[3.0, 9.5, 7.0]), Some(9.5));
        assert_eq!(window_peak(&[-4.0, -2.0, -9.0]), Some(-2.0));
        assert_eq!(window_peak(&[f64::NAN, 5.0]), Some(5.0));
        assert_eq!(window_peak(&[f64::NAN, f64::INFINITY]), None);
        assert_eq!(window_peak(&[]), None);
    }

    #[test]
    fn live_level_is_the_mean_of_the_last_three() {
        assert_eq!(live_level(&[10.0]), Some(10.0));
        assert_eq!(live_level(&[10.0, 20.0]), Some(15.0));
        assert_eq!(live_level(&[1.0, 2.0, 3.0, 4.0]), Some(3.0));
        assert_eq!(live_level(&[]), None);
        assert_eq!(live_level(&[1.0, f64::NAN, 3.0]), None);
    }

    #[test]
    fn live_trend_boundaries_belong_to_the_stronger_word() {
        let up = |d: f64| [10.0, 10.0, 10.0, 10.0 + d, 10.0 + d, 10.0 + d];
        assert_eq!(live_trend(&up(1.5)), Some(Trend::Rising));
        assert_eq!(live_trend(&up(1.25)), Some(Trend::Steady));
        assert_eq!(live_trend(&up(-1.5)), Some(Trend::Falling));
        assert_eq!(live_trend(&up(-1.25)), Some(Trend::Steady));
        assert_eq!(live_trend(&up(0.0)), Some(Trend::Steady));
    }

    #[test]
    fn live_trend_needs_six_samples() {
        assert_eq!(live_trend(&[1.0, 2.0, 3.0, 4.0, 5.0]), None);
        assert!(live_trend(&[1.0, 2.0, 3.0, 4.0, 5.0, 6.0]).is_some());
    }

    #[test]
    fn segment_trend_boundaries() {
        assert_eq!(segment_trend(10.0, 13.0), Some(Trend::Rising));
        assert_eq!(segment_trend(10.0, 12.75), Some(Trend::Steady));
        assert_eq!(segment_trend(13.0, 10.0), Some(Trend::Falling));
        assert_eq!(segment_trend(12.75, 10.0), Some(Trend::Steady));
        assert_eq!(segment_trend(f64::NAN, 10.0), None);
    }

    #[test]
    fn mark_value_looks_only_at_the_dwell() {
        assert_eq!(mark_value(&[1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0]), Some(7.0));
        // The 9 is older than the last five samples, so it does not count.
        assert_eq!(mark_value(&[9.0, 1.0, 2.0, 3.0, 4.0, 5.0]), Some(5.0));
        assert_eq!(mark_value(&[2.0, 8.0]), Some(8.0));
        assert_eq!(mark_value(&[]), None);
    }

    #[test]
    fn peak_index_takes_the_first_of_equal_peaks() {
        assert_eq!(peak_index(&[4.0, 9.0, 9.0, 2.0]), Some(1));
        assert_eq!(peak_index(&[5.0]), Some(0));
        assert_eq!(peak_index(&[-3.0, -1.0, -2.0]), Some(1));
        assert_eq!(peak_index(&[f64::NAN, 2.0]), Some(1));
        assert_eq!(peak_index(&[]), None);
    }

    #[test]
    fn guidance_boundaries() {
        // Exactly 6 below the peak is not "more than 6 below".
        assert_eq!(guidance(40.0, 46.0), Some(Guidance::TrendOnly));
        assert_eq!(guidance(39.999, 46.0), Some(Guidance::GoBack));
        // Exactly 3 below counts as at the peak.
        assert_eq!(guidance(43.0, 46.0), Some(Guidance::AtPeak));
        assert_eq!(guidance(42.999, 46.0), Some(Guidance::TrendOnly));
        assert_eq!(guidance(46.0, 46.0), Some(Guidance::AtPeak));
        assert_eq!(guidance(50.0, 46.0), Some(Guidance::AtPeak));
        assert_eq!(guidance(f64::NAN, 46.0), None);
    }

    fn numbers(tokens: &[&str]) -> Vec<f64> {
        tokens
            .iter()
            .map(|t| t.parse().expect("a number or nan/inf"))
            .collect()
    }

    fn show(value: Option<f64>) -> String {
        value.map_or_else(|| "none".to_string(), |v| v.to_string())
    }

    fn evaluate(rule: &str, args: &[f64]) -> String {
        match rule {
            "window_peak" => show(window_peak(args)),
            "level" => show(live_level(args)),
            "mark" => show(mark_value(args)),
            "peak" => peak_index(args).map_or_else(|| "none".to_string(), |i| i.to_string()),
            "live_trend" => live_trend(args)
                .map_or("unknown", Trend::as_str)
                .to_string(),
            "segment" => {
                let [from, to] = args else {
                    panic!("segment takes two numbers")
                };
                segment_trend(*from, *to)
                    .map_or("unknown", Trend::as_str)
                    .to_string()
            }
            "guide" => {
                let [live, peak] = args else {
                    panic!("guide takes two numbers")
                };
                guidance(*live, *peak)
                    .map_or("unknown", Guidance::as_str)
                    .to_string()
            }
            other => panic!("unknown rule {other}"),
        }
    }

    /// The same file is replayed in Node and inside the Capacitor WebView by the self-test.
    #[test]
    fn matches_the_shared_vector_file() {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../vectors/trend/cases.txt");
        let text = fs::read_to_string(path).expect("vectors/trend/cases.txt");
        let mut checked = 0;
        for line in text
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty() && !l.starts_with('#'))
        {
            let (left, want) = line
                .split_once('=')
                .expect("'<rule> <numbers> = <expected>'");
            let tokens: Vec<&str> = left.split_whitespace().collect();
            let (rule, rest) = tokens.split_first().expect("a rule name");
            let got = evaluate(rule, &numbers(rest));
            assert_eq!(got, want.trim(), "{line}");
            checked += 1;
        }
        assert!(
            checked >= 40,
            "vector file looks truncated ({checked} cases)"
        );
    }
}
