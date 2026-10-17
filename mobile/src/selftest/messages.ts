import type { EnvironmentReport } from './environment';
import type { BenchResult, VectorRun } from './runVectors';

/** What the self-test worker sends back to the screen. */
export type SelfTestMessage =
  | {
      ok: true;
      run: VectorRun;
      bench: BenchResult;
      /** Content-Type the web server gave the .wasm file; `application/wasm` enables streaming. */
      wasmContentType: string | null;
      wasmBytes: number;
      worker: EnvironmentReport;
      elapsedMs: number;
    }
  | { ok: false; error: string; worker: EnvironmentReport };
