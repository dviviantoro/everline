/// Runs the WASM self-test in a Web Worker, which is where the decoder will run in the app.

import init, * as wasm from '../wasm-pkg/cantol_wasm.js';
import wasmUrl from '../wasm-pkg/cantol_wasm_bg.wasm?url';
import { describeEnvironment } from './environment';
import type { SelfTestMessage } from './messages';
import { benchDecode, runVectors, type DecodeCase } from './runVectors';

interface WorkerScope {
  onmessage: (() => void) | null;
  postMessage(message: SelfTestMessage): void;
}

const scope = self as unknown as WorkerScope;

// The golden vectors are bundled as assets so the same files are replayed inside the app.
const streamUrls = import.meta.glob<string>('../../rust/vectors/decode/*.bin', {
  query: '?url',
  import: 'default',
  eager: true,
});
const reports = import.meta.glob<string>('../../rust/vectors/decode/*.json', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const classifyFiles = import.meta.glob<string>('../../rust/vectors/classify/cases.txt', {
  query: '?raw',
  import: 'default',
  eager: true,
});

async function loadDecodeCases(): Promise<DecodeCase[]> {
  const entries = Object.entries(streamUrls).sort(([a], [b]) => a.localeCompare(b));
  return Promise.all(
    entries.map(async ([path, url]) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`cannot fetch ${path}: HTTP ${String(response.status)}`);
      const expected = reports[path.replace(/\.bin$/, '.json')];
      if (expected === undefined) throw new Error(`no committed report for ${path}`);
      const file = path.split('/').pop() ?? path;
      return {
        name: file.replace(/\.bin$/, ''),
        stream: new Uint8Array(await response.arrayBuffer()),
        expected,
      };
    }),
  );
}

async function runSelfTest(): Promise<SelfTestMessage> {
  const started = performance.now();
  const worker = describeEnvironment('worker');
  try {
    const response = await fetch(wasmUrl);
    if (!response.ok) throw new Error(`cannot fetch the wasm module: HTTP ${String(response.status)}`);
    const wasmContentType = response.headers.get('content-type');
    const wasmBytes = (await response.clone().arrayBuffer()).byteLength;
    await init({ module_or_path: response });

    const decode = await loadDecodeCases();
    const classifyText = Object.values(classifyFiles)[0] ?? '';
    const run = runVectors(wasm, { decode, classifyText });
    const bench = benchDecode(wasm);
    return { ok: true, run, bench, wasmContentType, wasmBytes, worker, elapsedMs: performance.now() - started };
  } catch (error) {
    const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return { ok: false, error: text, worker };
  }
}

scope.onmessage = () => {
  void runSelfTest().then((message) => {
    scope.postMessage(message);
  });
};
