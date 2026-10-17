/**
 * Replays the golden vectors (rust/vectors) through the WASM module.
 *
 * Environment agnostic on purpose: the same function runs under Node (Vitest) and inside a Web
 * Worker in the Capacitor WebView. Matching reports on every target is what proves the module
 * behaves identically everywhere; this file contains no I/O of its own.
 */

export interface SessionLike {
  push(chunk: Uint8Array): number;
  frames_ok(): number;
  crc_errors(): number;
  lost_frames(): number;
  pending(): number;
  free(): void;
}

/** The slice of the generated wasm-bindgen module that the self-test uses. */
export interface WasmApi {
  version(): string;
  decode_vector_report(stream: Uint8Array, chunk: number): string;
  classify_dbmv(magnitude: number): number;
  make_bench_stream(frames: number, payloadLen: number): Uint8Array;
  Session: new () => SessionLike;
}

/** Chunk sizes replayed for every stream; the last means "everything at once" (u32 max). */
export const CHUNKS: readonly number[] = [1, 2, 3, 5, 7, 13, 21, 22, 64, 333, 0xffff_ffff];

const SEVERITY_NAMES: Readonly<Record<number, string>> = {
  0: 'normal',
  1: 'warning',
  2: 'critical',
  255: 'unknown',
};

export interface DecodeCase {
  name: string;
  stream: Uint8Array;
  /** The committed report text for this stream. */
  expected: string;
}

export interface VectorInput {
  decode: readonly DecodeCase[];
  /** Contents of vectors/classify/cases.txt. */
  classifyText: string;
}

export interface CaseResult {
  name: string;
  ok: boolean;
  detail: string;
}

export interface VectorRun {
  wasmVersion: string;
  results: CaseResult[];
  failed: number;
  /** Fingerprint of all reports, so two machines can be compared at a glance. */
  digest: string;
}

/** 32-bit FNV-1a over UTF-16 code units, as 8 hex digits. */
export function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function checkDecodeCase(api: WasmApi, vector: DecodeCase): { result: CaseResult; report: string } {
  const expected = vector.expected.trim();
  const differing = CHUNKS.filter((chunk) => api.decode_vector_report(vector.stream, chunk) !== expected);
  const report = api.decode_vector_report(vector.stream, CHUNKS[CHUNKS.length - 1] ?? 1);
  const ok = differing.length === 0;
  return {
    report,
    result: {
      name: `decode/${vector.name}`,
      ok,
      detail: ok
        ? `${CHUNKS.length} chunkings match the committed report`
        : `differs from the committed report at chunk size ${differing.join(', ')}`,
    },
  };
}

function parseMagnitude(token: string): number {
  switch (token.toLowerCase()) {
    case 'nan':
      return Number.NaN;
    case 'inf':
      return Number.POSITIVE_INFINITY;
    case '-inf':
      return Number.NEGATIVE_INFINITY;
    default:
      return Number(token);
  }
}

function checkClassify(api: WasmApi, text: string): CaseResult {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
  const wrong: string[] = [];
  for (const line of lines) {
    const [token = '', want = ''] = line.split(/\s+/);
    const got = SEVERITY_NAMES[api.classify_dbmv(parseMagnitude(token))] ?? 'invalid';
    if (got !== want) wrong.push(`${token} -> ${got}, expected ${want}`);
  }
  const ok = wrong.length === 0 && lines.length > 0;
  return {
    name: 'classify/cases',
    ok,
    detail: ok ? `${lines.length} magnitudes classified as committed` : wrong.join('; ') || 'no cases found',
  };
}

export function runVectors(api: WasmApi, input: VectorInput): VectorRun {
  const results: CaseResult[] = [];
  const reports: string[] = [];
  for (const vector of input.decode) {
    const checked = checkDecodeCase(api, vector);
    results.push(checked.result);
    reports.push(checked.report);
  }
  results.push(checkClassify(api, input.classifyText));
  return {
    wasmVersion: api.version(),
    results,
    failed: results.filter((r) => !r.ok).length,
    digest: fnv1a(reports.join('\n')),
  };
}

export interface BenchResult {
  streamBytes: number;
  iterations: number;
  msPer64KiB: number;
  mebibytesPerSecond: number;
  /** Every frame in every iteration was delivered. */
  decodedAll: boolean;
}

/** Throughput of the decoder fed in 64 KiB chunks, like the planned bridge batches. */
export function benchDecode(api: WasmApi, now: () => number = () => performance.now()): BenchResult {
  const frames = 64;
  const iterations = 50;
  const chunk = 64 * 1024;
  const stream = api.make_bench_stream(frames, 1000);
  const session = new api.Session();
  try {
    let delivered = 0;
    const start = now();
    for (let i = 0; i < iterations; i++) {
      for (let offset = 0; offset < stream.length; offset += chunk) {
        delivered += session.push(stream.subarray(offset, offset + chunk));
      }
    }
    const seconds = Math.max(now() - start, 0.001) / 1000;
    const totalBytes = stream.length * iterations;
    return {
      streamBytes: stream.length,
      iterations,
      msPer64KiB: (seconds * 1000) / (totalBytes / chunk),
      mebibytesPerSecond: totalBytes / (1024 * 1024) / seconds,
      decodedAll: delivered === frames * iterations,
    };
  } finally {
    session.free();
  }
}
