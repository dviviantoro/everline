/**
 * Loads the WASM module in the WebView. Kept apart from `dsp.ts` so tests never touch the
 * `?url` import. The glue is initialised explicitly from a fetched response (there is no
 * `vite-plugin-wasm`), as in the self-test Worker.
 */
import init, * as wasm from '../wasm-pkg/cantol_wasm.js';
import wasmUrl from '../wasm-pkg/cantol_wasm_bg.wasm?url';
import { makeDsp, type Dsp } from './dsp';

export async function loadDsp(): Promise<Dsp> {
  const response = await fetch(wasmUrl);
  if (!response.ok) throw new Error(`cannot fetch the wasm module: HTTP ${String(response.status)}`);
  await init({ module_or_path: response });
  return makeDsp(wasm);
}
