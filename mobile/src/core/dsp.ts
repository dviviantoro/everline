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
}

export interface Dsp {
  version(): string;
  /** Severity of a magnitude in dBmV, or null when it cannot be classified (NaN, infinity). */
  classify(dbmv: number): Severity | null;
}

const SEVERITY_BY_CODE: Readonly<Record<number, Severity>> = {
  0: 'normal',
  1: 'warning',
  2: 'critical',
};

export function makeDsp(api: WasmDspApi): Dsp {
  return {
    version: () => api.version(),
    classify: (dbmv) => SEVERITY_BY_CODE[api.classify_dbmv(dbmv)] ?? null,
  };
}
