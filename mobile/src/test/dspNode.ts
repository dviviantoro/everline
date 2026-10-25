/** Test helper: the real WASM module, initialised under Node, wrapped like the app wraps it. */
import { readFileSync } from 'node:fs';

import * as wasm from '../wasm-pkg/cantol_wasm.js';
import { makeDsp, type Dsp } from '../core/dsp';
import { makeLinkCodec, type LinkCodec } from '../core/linkCodec';

let cached: Dsp | null = null;
let cachedCodec: LinkCodec | null = null;

function initNode(): void {
  wasm.initSync({ module: readFileSync(new URL('../wasm-pkg/cantol_wasm_bg.wasm', import.meta.url)) });
}

export function nodeDsp(): Dsp {
  if (!cached) {
    initNode();
    cached = makeDsp(wasm);
  }
  return cached;
}

/** The real link codec under Node. The module is initialised once, whichever helper runs first. */
export function nodeCodec(): LinkCodec {
  if (!cachedCodec) {
    nodeDsp();
    cachedCodec = makeLinkCodec(wasm);
  }
  return cachedCodec;
}
