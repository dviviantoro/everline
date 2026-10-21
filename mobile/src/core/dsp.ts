/**
 * The app's view of the Rust/WASM calculator (`cantol-wasm`).
 *
 * This file holds no thresholds: severity zones and trend rules live in `cantol-dsp` and the app
 * only calls them (`mobile-ui-spec.md` section 1, `mobile-tracking-mode.md` section 3). The
 * adapter takes the generated module as an argument so Vitest can pass the Node-initialised one
 * and the app can pass the one it loaded in the WebView.
 */
import type { Severity } from './types';

/** The slice of the generated wasm-bindgen module that the app uses. */
export interface WasmDspApi {
  version(): string;
  classify_dbmv(magnitude: number): number;
  window_peak_dbmv(values: Float64Array): number;
  live_level_dbmv(samples: Float64Array): number;
  live_trend_code(samples: Float64Array): number;
  segment_trend_code(from: number, to: number): number;
  mark_value_dbmv(samples: Float64Array): number;
  peak_index(values: Float64Array): number;
  guidance_code(live: number, peak: number): number;
}

export type Trend = 'steady' | 'rising' | 'falling';
export type GuidanceKind = 'trend_only' | 'at_peak' | 'go_back';

export interface Dsp {
  version: () => string;
  /** Severity of a magnitude in dBmV, or null when it cannot be classified (NaN, infinity). */
  classify: (dbmv: number) => Severity | null;
  /** Highest finite value in dBmV (the window statistic), or null. */
  windowPeak: (values: ArrayLike<number>) => number | null;
  /** Mean of the last three per-second samples, or null. */
  liveLevel: (samples: ArrayLike<number>) => number | null;
  /** Live level against the three samples before it; null until six samples exist. */
  liveTrend: (samples: ArrayLike<number>) => Trend | null;
  /** Trend between two consecutive marks. */
  segmentTrend: (from: number, to: number) => Trend | null;
  /** Window peak of the last five samples: the value of a mark. */
  markValue: (samples: ArrayLike<number>) => number | null;
  /** Index of the highest mark, or null. */
  peakIndex: (values: ArrayLike<number>) => number | null;
  /** What the guidance card says, from the live level and the highest mark. */
  guidance: (live: number, peak: number) => GuidanceKind | null;
}

const SEVERITY_BY_CODE: Readonly<Record<number, Severity>> = {
  0: 'normal',
  1: 'warning',
  2: 'critical',
};

const TREND_BY_CODE: Readonly<Record<number, Trend>> = { 0: 'steady', 1: 'rising', 2: 'falling' };
const GUIDANCE_BY_CODE: Readonly<Record<number, GuidanceKind>> = { 0: 'trend_only', 1: 'at_peak', 2: 'go_back' };

const orNull = (value: number): number | null => (Number.isNaN(value) ? null : value);

export function makeDsp(api: WasmDspApi): Dsp {
  const floats = (values: ArrayLike<number>): Float64Array => Float64Array.from(values);
  return {
    version: () => api.version(),
    classify: (dbmv) => SEVERITY_BY_CODE[api.classify_dbmv(dbmv)] ?? null,
    windowPeak: (values) => orNull(api.window_peak_dbmv(floats(values))),
    liveLevel: (samples) => orNull(api.live_level_dbmv(floats(samples))),
    liveTrend: (samples) => TREND_BY_CODE[api.live_trend_code(floats(samples))] ?? null,
    segmentTrend: (from, to) => TREND_BY_CODE[api.segment_trend_code(from, to)] ?? null,
    markValue: (samples) => orNull(api.mark_value_dbmv(floats(samples))),
    peakIndex: (values) => {
      const index = api.peak_index(floats(values));
      return index < 0 ? null : index;
    },
    guidance: (live, peak) => GUIDANCE_BY_CODE[api.guidance_code(live, peak)] ?? null,
  };
}
