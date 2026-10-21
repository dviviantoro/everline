import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import * as wasm from '../wasm-pkg/cantol_wasm.js';
import {
  benchDecode,
  CHUNKS,
  fnv1a,
  runVectors,
  type DecodeCase,
  type VectorInput,
} from './runVectors';

const vectors = new URL('../../rust/vectors/', import.meta.url);

wasm.initSync({ module: readFileSync(new URL('../wasm-pkg/cantol_wasm_bg.wasm', import.meta.url)) });

function loadInput(): VectorInput {
  const dir = new URL('decode/', vectors);
  const names = readdirSync(dir)
    .filter((f) => f.endsWith('.bin'))
    .map((f) => f.slice(0, -'.bin'.length))
    .sort();
  const decode: DecodeCase[] = names.map((name) => ({
    name,
    stream: new Uint8Array(readFileSync(new URL(`${name}.bin`, dir))),
    expected: readFileSync(new URL(`${name}.json`, dir), 'utf8'),
  }));
  return {
    decode,
    classifyText: readFileSync(new URL('classify/cases.txt', vectors), 'utf8'),
    trendText: readFileSync(new URL('trend/cases.txt', vectors), 'utf8'),
  };
}

describe('golden vectors through the WASM module', () => {
  it('every committed vector passes with every chunking', () => {
    const input = loadInput();
    const run = runVectors(wasm, input);
    const failures = run.results.filter((r) => !r.ok);
    expect(failures).toEqual([]);
    // One row per decode stream, plus classify and trend.
    expect(run.results).toHaveLength(input.decode.length + 2);
    expect(input.decode.length).toBeGreaterThanOrEqual(9);
    // Printed so it can be compared with the digest the self-test shows on a phone.
    console.info(`vector digest ${run.digest} (${run.wasmVersion})`);
    expect(run.digest).toMatch(/^[0-9a-f]{8}$/);
  });

  it('keeps the digest of the decode vectors: adding the trend vectors did not change it', () => {
    // The digest hashes the decode reports only (like the classify cases, the trend cases are
    // checked but not hashed). It was f7f47846 before the trend vectors existed.
    const run = runVectors(wasm, loadInput());
    expect(run.digest).toBe('f7f47846');
  });

  it('detects a wrong trend expectation (negative control)', () => {
    const run = runVectors(wasm, { decode: [], classifyText: '20 warning\n', trendText: 'segment 10 13 = steady\n' });
    expect(run.failed).toBe(1);
    expect(run.results.find((r) => r.name === 'trend/cases')?.ok).toBe(false);
  });

  it('accepts a trend file whose numbers are spelled differently', () => {
    const run = runVectors(wasm, { decode: [], classifyText: '20 warning\n', trendText: 'window_peak 3 9.50 7 = 9.5\nlevel 10 20 = 15.0\n' });
    expect(run.failed).toBe(0);
  });

  it('detects a wrong expectation (negative control)', () => {
    const input = loadInput();
    const first = input.decode[0];
    if (!first) throw new Error('no vectors found');
    const tampered = {
      ...input,
      decode: [{ ...first, expected: first.expected.replace('"frames_ok":', '"frames_ok":9') }],
    };
    const run = runVectors(wasm, tampered);
    expect(run.failed).toBeGreaterThanOrEqual(1);
    expect(run.results[0]?.ok).toBe(false);
  });

  it('detects a wrong severity expectation (negative control)', () => {
    const run = runVectors(wasm, { decode: [], classifyText: '20 normal\n' });
    expect(run.failed).toBe(1);
  });

  it('replays more than one chunking, including one byte at a time', () => {
    expect(CHUNKS).toContain(1);
    expect(CHUNKS.length).toBeGreaterThan(5);
  });
});

describe('decoder throughput', () => {
  it('delivers every frame of the benchmark stream', () => {
    const bench = benchDecode(wasm);
    expect(bench.decodedAll).toBe(true);
    expect(bench.streamBytes).toBeGreaterThan(64 * 1024);
    console.info(`bench: ${bench.msPer64KiB.toFixed(3)} ms per 64 KiB, ${bench.mebibytesPerSecond.toFixed(0)} MiB/s`);
  });
});

describe('fnv1a', () => {
  it('matches known FNV-1a 32-bit values', () => {
    expect(fnv1a('')).toBe('811c9dc5');
    expect(fnv1a('a')).toBe('e40c292c');
    expect(fnv1a('foobar')).toBe('bf9cf968');
  });
});
