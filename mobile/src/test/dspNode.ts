/** Test helper: the real WASM module, initialised under Node, wrapped like the app wraps it. */
import { readFileSync } from 'node:fs';

import * as wasm from '../wasm-pkg/cantol_wasm.js';
import { makeDsp, type Dsp } from '../core/dsp';

let cached: Dsp | null = null;

export function nodeDsp(): Dsp {
  if (!cached) {
    wasm.initSync({ module: readFileSync(new URL('../wasm-pkg/cantol_wasm_bg.wasm', import.meta.url)) });
    cached = makeDsp(wasm);
  }
  return cached;
}
