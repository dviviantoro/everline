import { Capacitor } from '@capacitor/core';
import { useEffect, useState } from 'react';

import { describeEnvironment, type EnvironmentReport } from './environment';
import type { SelfTestMessage } from './messages';

/** Proposed budget from the plan: decode at most 2 ms per 64 KiB chunk on a mid phone. */
const BUDGET_MS_PER_64KIB = 2;

type State =
  | { phase: 'running' }
  | { phase: 'failed'; error: string }
  | { phase: 'done'; message: SelfTestMessage };

function platformFacts(): EnvironmentReport {
  return {
    ...describeEnvironment('main'),
    capacitorPlatform: Capacitor.getPlatform(),
    nativeShell: Capacitor.isNativePlatform(),
  };
}

function Facts({ title, facts }: { title: string; facts: EnvironmentReport }) {
  return (
    <section className="rounded-lg border border-neutral-300 p-3 dark:border-neutral-700">
      <h2 className="mb-2 text-sm font-semibold">{title}</h2>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs">
        {Object.entries(facts).map(([key, value]) => (
          <div key={key} className="contents">
            <dt className="text-neutral-500">{key}</dt>
            <dd className="break-all font-mono">{String(value)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Badge({ ok, label }: { ok: boolean; label: string }) {
  const tone = ok ? 'bg-emerald-600' : 'bg-red-600';
  return <span className={`rounded px-2 py-0.5 text-xs font-bold text-white ${tone}`}>{label}</span>;
}

function Results({ message }: { message: Extract<SelfTestMessage, { ok: true }> }) {
  const { run, bench } = message;
  const fast = bench.msPer64KiB <= BUDGET_MS_PER_64KIB;
  return (
    <>
      <section className="rounded-lg border border-neutral-300 p-3 dark:border-neutral-700">
        <div className="mb-2 flex items-center gap-2">
          <Badge ok={run.failed === 0} label={run.failed === 0 ? 'PASS' : `FAIL ${String(run.failed)}`} />
          <span className="text-xs">{run.wasmVersion}</span>
        </div>
        <ul className="space-y-1 text-xs">
          {run.results.map((r) => (
            <li key={r.name} className="flex gap-2">
              <Badge ok={r.ok} label={r.ok ? 'ok' : 'FAIL'} />
              <span className="font-mono">{r.name}</span>
              <span className="text-neutral-500">{r.detail}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs">
          digest <span className="font-mono">{run.digest}</span> (must equal the Node run)
        </p>
      </section>
      <section className="rounded-lg border border-neutral-300 p-3 text-xs dark:border-neutral-700">
        <h2 className="mb-1 text-sm font-semibold">Decoder throughput in this WebView</h2>
        <p>
          {bench.msPer64KiB.toFixed(3)} ms per 64 KiB, {bench.mebibytesPerSecond.toFixed(0)} MiB/s{' '}
          <Badge ok={fast && bench.decodedAll} label={fast ? 'within budget' : `over ${String(BUDGET_MS_PER_64KIB)} ms`} />
        </p>
        <p className="mt-1 text-neutral-500">
          wasm {String(message.wasmBytes)} bytes, served as {message.wasmContentType ?? 'unknown'}; total{' '}
          {message.elapsedMs.toFixed(0)} ms
        </p>
      </section>
    </>
  );
}

export function SelfTestScreen() {
  const [state, setState] = useState<State>({ phase: 'running' });
  const [runId, setRunId] = useState(0);
  const [main] = useState(platformFacts);

  useEffect(() => {
    const worker = new Worker(new URL('./selftest.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<SelfTestMessage>) => {
      setState({ phase: 'done', message: event.data });
      // Read from the phone with: adb logcat | grep cantol-selftest
      console.info('cantol-selftest', JSON.stringify({ main, result: event.data }));
    };
    worker.onerror = (event) => {
      setState({ phase: 'failed', error: event.message || 'the worker failed to load' });
    };
    worker.postMessage('run');
    return () => {
      worker.terminate();
    };
  }, [runId, main]);

  const rerun = () => {
    setState({ phase: 'running' });
    setRunId((id) => id + 1);
  };

  return (
    <main className="mx-auto max-w-xl space-y-3 p-4 pt-[max(1rem,env(safe-area-inset-top))] text-neutral-900 dark:text-neutral-100">
      <h1 className="text-lg font-bold">Cantol Mobile: Phase 0 self-test</h1>
      <p className="text-xs text-neutral-500">
        Replays the Rust golden vectors through the WASM module inside a Web Worker, the same way
        the app will decode Red Pitaya frames.
      </p>
      {state.phase === 'running' && <p className="text-sm">Running...</p>}
      {state.phase === 'failed' && <Badge ok={false} label={state.error} />}
      {state.phase === 'done' && state.message.ok && <Results message={state.message} />}
      {state.phase === 'done' && !state.message.ok && (
        <section className="rounded-lg border border-red-500 p-3 text-xs">
          <Badge ok={false} label="WASM could not run" />
          <p className="mt-2 break-all font-mono">{state.message.error}</p>
        </section>
      )}
      <Facts title="Main thread" facts={main} />
      {state.phase === 'done' && <Facts title="Worker" facts={state.message.worker} />}
      <button
        type="button"
        onClick={rerun}
        className="rounded bg-neutral-900 px-3 py-2 text-sm font-semibold text-white dark:bg-neutral-100 dark:text-neutral-900"
      >
        Run again
      </button>
    </main>
  );
}
