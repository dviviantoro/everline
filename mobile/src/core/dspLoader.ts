/**
 * Loads the WASM module in the WebView. Kept apart from `dsp.ts` so tests never touch the
 * `?url` import. The glue is initialised explicitly from a fetched response (there is no
 * `vite-plugin-wasm`), as in the self-test Worker.
 */
import init, * as wasm from '../wasm-pkg/cantol_wasm.js';
import wasmUrl from '../wasm-pkg/cantol_wasm_bg.wasm?url';
import { makeDsp, type Dsp } from './dsp';
import { makeLinkCodec, type LinkCodec } from './linkCodec';

export interface LoadedWasm {
  dsp: Dsp;
  codec: LinkCodec;
}

/** One initialisation of the module, shared by the calculator and the link codec. */
export async function loadWasm(): Promise<LoadedWasm> {
  const response = await fetch(wasmUrl);
  if (!response.ok) throw new Error(`cannot fetch the wasm module: HTTP ${String(response.status)}`);
  await init({ module_or_path: response });
  return { dsp: makeDsp(wasm), codec: makeLinkCodec(wasm) };
}

export async function loadDsp(): Promise<Dsp> {
  return (await loadWasm()).dsp;
}
