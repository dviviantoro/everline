/**
 * Screen 6c: tracking live (`mobile-tracking-mode.md` section 4). The big number is the live
 * level, coloured by the WASM `classify`, with a trend chip (arrow, word and colour together).
 * All rules (trend, mark value, peak, guidance) come from the WASM through `core/tracking.ts`.
 * Marks are kept as a draft in the local store, so they survive a dropped link or a closed app.
 * Back asks before leaving; Finish saves the walk as one survey and goes to Tag.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';

import { useBackInterceptor } from '../app/back';
import { useServices } from '../app/services';
import { useLineAssets } from '../app/useLineAssets';
import { useGpsFix, useWizard } from '../app/wizard';
import { createCue, type SoundCue } from '../core/audio';
import type { Dsp } from '../core/dsp';
import { formatDb, formatDbmV } from '../core/format';
import { projectOntoRoute } from '../core/geo';
import type { PositionSource, TrackMark, TrackingDraft, TrackingMeasurement, WalkDirection } from '../core/model';
import { STATION_LABELS } from '../core/payload';
import {
  createSession,
  GPS_MAX_ACCURACY_M,
  stationChainages,
  stationWalkedM,
  viewOf,
  walkOrder,
  withFix,
  withMark,
  withSample,
  type TrackingSession,
} from '../core/tracking';
import type { GpsFix, LineAssetWithPoles, MeasurementPoint, Severity } from '../core/types';
import { SEVERITY_LABEL } from '../core/types';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { AlertIcon, ArrowDownIcon, ArrowUpIcon, SteadyIcon } from '../ui/icons';
import { Pill, TopBar, BackButton } from '../ui/primitives';
import { TrackChart, type ChartMark } from '../ui/TrackChart';

type Action =
  | { type: 'sample'; value: number }
  | { type: 'fix'; chainageM: number; fix: GpsFix }
  | { type: 'mark'; at: number; fix: GpsFix | null; chainageM: number | null };

function makeReducer(dsp: Dsp) {
  return (session: TrackingSession, action: Action): TrackingSession => {
    switch (action.type) {
      case 'sample':
        return withSample(session, action.value, dsp);
      case 'fix': {
        const step = withFix(session, action.chainageM);
        if (!step.autoMark) return step.session;
        return withMark(step.session, { at: action.fix.at, fix: action.fix }, dsp) ?? step.session;
      }
      case 'mark':
        return withMark({ ...session, chainageM: action.chainageM ?? session.chainageM }, { at: action.at, fix: action.fix }, dsp) ?? session;
    }
  };
}

const SEVERITY_COLOUR: Record<Severity, string> = { normal: 'var(--text)', warning: 'var(--warn-text)', critical: 'var(--crit-text)' };

function TrendChip({ trend }: { trend: 'rising' | 'falling' | 'steady' | null }) {
  if (trend === null) return <span className="helper">Measuring</span>;
  const word = trend === 'rising' ? 'Rising' : trend === 'falling' ? 'Falling' : 'Steady';
  const icon = trend === 'rising' ? <ArrowUpIcon size={16} /> : trend === 'falling' ? <ArrowDownIcon size={16} /> : <SteadyIcon size={16} />;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 12px',
        borderRadius: 999,
        background: 'var(--surface2)',
        border: '1px solid var(--border2)',
        color: trend === 'rising' ? 'var(--accent-text)' : 'var(--cyan-text)',
        fontSize: '0.9375rem',
        fontWeight: 600,
      }}
    >
      {icon}
      {word}
    </span>
  );
}

function chartLabel(asset: LineAssetWithPoles, marks: readonly TrackMark[], peak: ChartMark | null): string {
  if (marks.length === 0) return `Level along ${asset.code}. No station has been marked yet.`;
  const list = marks.map((m) => `${m.label} ${formatDbmV(m.valueDbmV)} dBmV`).join(', ');
  return `Level along ${asset.code}. ${list}.${peak ? ` The strongest mark is ${peak.label}.` : ''}`;
}

// ---------------------------------------------------------------------------------------------

function Walk({
  asset,
  points,
  direction,
  source,
  warning,
  sound,
  initialMarks,
  startedAt,
}: {
  asset: LineAssetWithPoles;
  points: readonly MeasurementPoint[];
  direction: WalkDirection;
  source: PositionSource;
  warning: number;
  sound: boolean;
  initialMarks: readonly TrackMark[];
  startedAt: number;
}) {
  const { link, dsp, store, now } = useServices();
  const wizard = useWizard();
  const fix = useGpsFix();
  const navigate = useNavigate();
  const { fixStore } = wizard;

  const config = useMemo(
    () => ({ direction, source, warningLevelDbmV: warning, stationsM: stationChainages(asset, points) }),
    [asset, points, direction, source, warning],
  );
  const reducer = useMemo(() => makeReducer(dsp), [dsp]);
  const [session, dispatch] = useReducer(reducer, undefined, () => createSession(config, initialMarks));
  const view = useMemo(() => viewOf(session, dsp), [session, dsp]);

  const [leaving, setLeaving] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [alertDismissed, setAlertDismissed] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useBackInterceptor(
    useCallback(() => {
      setLeaving(true);
      return true;
    }, []),
  );

  // The stream runs while this screen is open.
  const { streaming } = wizard.state;
  const { startMeasurement } = wizard;
  useEffect(() => {
    if (!streaming) void startMeasurement();
  }, [streaming, startMeasurement]);

  // One sample per second: the window peak of the pulses that arrived in it.
  const amps = useRef<number[]>([]);
  useEffect(
    () =>
      link.subscribe({
        onEvents: (events) => {
          for (const e of events) amps.current.push(e.ampDbmV);
        },
        onStatus: () => undefined,
        onLinkState: () => undefined,
      }),
    [link],
  );
  useEffect(() => {
    const id = window.setInterval(() => {
      const value = dsp.windowPeak(amps.current);
      amps.current = [];
      if (value !== null) dispatch({ type: 'sample', value });
    }, 1000);
    return () => {
      window.clearInterval(id);
    };
  }, [dsp]);

  // GPS distance: project every fix onto the route.
  useEffect(() => {
    if (source !== 'gps') return undefined;
    return fixStore.subscribe(() => {
      const latest = fixStore.get();
      if (latest) dispatch({ type: 'fix', chainageM: projectOntoRoute(asset.route_geometry, latest).chainageM, fix: latest });
    });
  }, [source, fixStore, asset]);

  // Marks survive a dropped link and a closed app.
  useEffect(() => {
    if (session.marks.length === 0) return;
    const draft: TrackingDraft = {
      id: 'current',
      assetId: asset.id,
      direction,
      source,
      warningLevelDbmV: warning,
      startedAt,
      updatedAt: now(),
      marks: session.marks,
    };
    void store.saveDraft(draft);
  }, [session.marks, asset.id, direction, source, warning, startedAt, store, now]);

  // Sound cue: a tone that rises with the level, and a double beep when the warning level is first reached.
  const cue = useRef<SoundCue | null>(null);
  useEffect(() => {
    if (!sound) return undefined;
    cue.current = createCue();
    return () => {
      cue.current?.stop();
      cue.current = null;
    };
  }, [sound]);
  useEffect(() => {
    if (view.live !== null) cue.current?.setLevel(view.live);
  }, [view.live]);
  const beeped = useRef(false);
  useEffect(() => {
    if (session.alertFired && !beeped.current) {
      beeped.current = true;
      cue.current?.beep();
    }
  }, [session.alertFired]);

  const mark = () => {
    const latest = fixStore.get();
    const chainageM = latest ? projectOntoRoute(asset.route_geometry, latest).chainageM : null;
    dispatch({ type: 'mark', at: now(), fix: latest, chainageM });
  };

  const finish = () => {
    setFinishing(false);
    const measurement: TrackingMeasurement = {
      kind: 'tracking',
      id: crypto.randomUUID(),
      assetId: asset.id,
      direction,
      source,
      recordedAt: now(),
      marks: session.marks,
    };
    void store
      .saveMeasurement(measurement)
      .then(() => store.clearDraft())
      .then(() => navigate(`/tag?m=${measurement.id}`, { replace: true }))
      .catch(() => {
        setSaveError('The walk could not be saved on this phone. Try again.');
      });
  };

  const leave = () => {
    setLeaving(false);
    void navigate('/track/setup', { replace: true });
  };

  const lost = wizard.state.cantol === 'lost';
  const graceLeft = lost && wizard.state.cantolLostAt !== null ? Math.max(0, 30 - (wizard.state.nowMs - wizard.state.cantolLostAt) / 1000) : 0;

  const stations = walkOrder(direction).map((st) => ({ walkedM: stationWalkedM(config, st), label: STATION_LABELS[st] ?? 'P1' }));
  const chartMarks: ChartMark[] = session.marks.map((m) => ({ walkedM: stationWalkedM(config, m.station), value: m.valueDbmV, label: m.label }));
  const peakMark: ChartMark | null = view.peak ? { walkedM: view.peak.walkedM, value: view.peak.value, label: view.peak.label } : null;
  const lastMark = chartMarks[chartMarks.length - 1];
  const current =
    source === 'gps' && view.walkedM !== null && view.live !== null
      ? { walkedM: view.walkedM, level: view.live }
      : lastMark
        ? { walkedM: lastMark.walkedM, level: lastMark.value }
        : null;

  const subtitle =
    source === 'gps' && view.walkedM !== null
      ? `${asset.code} · ${String(Math.round(view.walkedM))} m walked`
      : `${asset.code} · ${String(session.marks.length)} of 5 stations marked`;
  const gpsRough = source === 'gps' && fix !== null && fix.accuracyM > GPS_MAX_ACCURACY_M;
  const showAlert = session.alertFired && !alertDismissed;

  return (
    <div className="screen">
      <TopBar start={<BackButton label="Setup" />} />

      <div style={{ paddingTop: 6, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <h1 className="title title-md" style={{ margin: 0 }}>
            Tracking
          </h1>
          <div className="mono" style={{ marginTop: 6, fontSize: '0.75rem', color: 'var(--muted)', overflowWrap: 'anywhere' }}>
            {subtitle}
          </div>
        </div>
        {lost ? <Pill tone="warn">Reconnecting</Pill> : <Pill tone="ok">Recording</Pill>}
      </div>

      <div className="screen-body" style={{ paddingTop: 14, gap: 12 }}>
        {lost ? (
          <div className="banner" role="alert">
            <AlertIcon size={20} />
            <span style={{ flex: 1 }}>
              Cantol link lost. Your {String(session.marks.length)} marks are kept. Setup reopens in {String(Math.ceil(graceLeft))} s if it does not
              come back; the walk stays as a draft.
            </span>
          </div>
        ) : null}

        {showAlert ? (
          <div className="banner" role="alert">
            <AlertIcon size={20} />
            <span style={{ flex: 1 }}>The level reached the warning level of {String(warning)} dBmV.</span>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              style={{ minHeight: 44 }}
              onClick={() => {
                setAlertDismissed(true);
              }}
            >
              OK
            </button>
          </div>
        ) : null}

        {gpsRough ? (
          <div className="helper" role="status" style={{ color: 'var(--warn-text)' }}>
            GPS accuracy is about {String(Math.round(fix.accuracyM))} m. Tap Mark station at each station instead of waiting for it to be marked.
          </div>
        ) : null}

        <section className="card stack" style={{ gap: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <div className="label-mono">Level now &middot; {view.where}</div>
              <div
                className="display-num"
                style={{ marginTop: 4, fontSize: '3.5rem', lineHeight: 0.9, color: view.severity ? SEVERITY_COLOUR[view.severity] : undefined }}
                aria-live="off"
              >
                {view.live === null ? '—' : formatDbmV(view.live)}
                <span className="unit" style={{ fontSize: '1.125rem' }}> dBmV</span>
              </div>
              {view.severity ? <div className="helper" style={{ marginTop: 4 }}>{SEVERITY_LABEL[view.severity]}</div> : null}
            </div>
            <div style={{ textAlign: 'right' }}>
              <TrendChip trend={view.trend} />
              {view.delta !== null ? (
                <div className="helper" style={{ marginTop: 6 }}>
                  {formatDb(view.delta)} dB over the last 3 s
                </div>
              ) : null}
            </div>
          </div>
          <div style={{ background: 'var(--surface2)', borderRadius: 6, padding: 12, fontSize: '0.875rem', lineHeight: 1.5 }} role="status">
            {view.guidanceText}
          </div>
        </section>

        <section className="card" style={{ padding: '14px 12px 8px' }}>
          <div className="label-mono" style={{ padding: '0 4px 6px', letterSpacing: '0.14em' }}>
            Level along the span &middot; dBmV
          </div>
          <TrackChart
            lengthM={stations[4]?.walkedM ?? 0}
            stations={stations}
            marks={chartMarks}
            trace={session.trace}
            warning={warning}
            peak={peakMark}
            current={current}
            label={chartLabel(asset, session.marks, peakMark)}
          />
        </section>

        {view.segments.length > 0 ? (
          <section className="card card-flush" style={{ padding: '0 16px' }} aria-label="Segments">
            {view.segments.map((s) => (
              <div key={`${s.from}-${s.to}`} className="row" style={{ minHeight: 44 }}>
                <span style={{ color: s.trend === 'rising' ? 'var(--accent-text)' : 'var(--cyan-text)', display: 'inline-flex' }}>
                  {s.trend === 'rising' ? <ArrowUpIcon size={18} /> : s.trend === 'falling' ? <ArrowDownIcon size={18} /> : <SteadyIcon size={18} />}
                </span>
                <span className="row-title mono" style={{ fontSize: '0.8125rem' }}>
                  {s.from} &rarr; {s.to}
                </span>
                <span style={{ fontSize: '0.875rem', fontWeight: 600, color: s.trend === 'rising' ? 'var(--accent-text)' : 'var(--cyan-text)' }}>
                  {s.trend === 'rising' ? 'Rising' : s.trend === 'falling' ? 'Falling' : 'Steady'} {formatDb(s.delta)} dB
                </span>
              </div>
            ))}
          </section>
        ) : null}

        {saveError ? (
          <p role="alert" style={{ margin: 0, fontSize: '0.875rem', color: 'var(--crit-text)' }}>
            {saveError}
          </p>
        ) : null}
      </div>

      <div style={{ padding: '14px 0 8px' }}>
        {view.done ? (
          <p className="helper" style={{ margin: '0 0 8px', textAlign: 'center' }} role="status">
            All five stations are marked. Finish to save the walk.
          </p>
        ) : view.next ? (
          <p className="helper" style={{ margin: '0 0 8px', textAlign: 'center' }}>
            Next station: {view.next}
          </p>
        ) : null}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
          <button type="button" className="btn btn-secondary" style={{ minHeight: 52 }} disabled={view.done || session.samples.length === 0} onClick={mark}>
            Mark station
          </button>
          <button
            type="button"
            className="btn btn-primary"
            style={{ minHeight: 52 }}
            disabled={session.marks.length === 0}
            onClick={() => {
              setFinishing(true);
            }}
          >
            Finish
          </button>
        </div>
      </div>

      {finishing ? (
        <ConfirmDialog
          title="Finish and save this walk?"
          confirmLabel="Finish"
          cancelLabel="Keep walking"
          onConfirm={finish}
          onCancel={() => {
            setFinishing(false);
          }}
        >
          {String(session.marks.length)} of 5 stations are marked. The walk is saved as one survey; a station you skipped is simply left out.
        </ConfirmDialog>
      ) : null}

      {leaving ? (
        <ConfirmDialog
          title="Leave tracking?"
          confirmLabel="Leave"
          cancelLabel="Stay"
          onConfirm={leave}
          onCancel={() => {
            setLeaving(false);
          }}
        >
          Your {String(session.marks.length)} marks stay on this phone as a draft you can resume from the setup screen.
        </ConfirmDialog>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

export function TrackingScreen() {
  const { api, store, now } = useServices();
  const [params] = useSearchParams();
  const assetId = params.get('asset');
  const direction: WalkDirection = params.get('dir') === 'BA' ? 'BA' : 'AB';
  const source: PositionSource = params.get('src') === 'gps' ? 'gps' : 'marks';
  const warning = Number(params.get('warn') ?? '30');
  const sound = params.get('sound') === '1';
  const resume = params.get('resume') === '1';

  const { assets, reload } = useLineAssets();
  const asset = assets.status === 'ready' ? (assets.value.find((a) => a.id === assetId) ?? null) : null;

  const [prepared, setPrepared] = useState<{ points: MeasurementPoint[]; marks: TrackMark[]; startedAt: number } | null>(null);
  useEffect(() => {
    if (assetId === null) return undefined;
    let alive = true;
    // Read through a function: TypeScript would otherwise assume `alive` cannot change across an await.
    const isAlive = () => alive;
    void (async () => {
      const [points, draft] = await Promise.all([api.listMeasurementPoints(assetId), store.getDraft()]);
      const usable = resume && draft?.assetId === assetId ? draft : null;
      if (!usable) await store.clearDraft();
      if (isAlive()) setPrepared({ points, marks: usable?.marks ?? [], startedAt: usable?.startedAt ?? now() });
    })().catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [api, store, now, assetId, resume]);

  if (assetId === null) {
    return (
      <div className="screen">
        <TopBar start={<BackButton label="Setup" />} />
        <p className="lead">No line was chosen. Go back and pick one.</p>
      </div>
    );
  }
  if (assets.status === 'error') {
    return (
      <div className="screen">
        <TopBar start={<BackButton label="Setup" />} />
        <p role="alert" className="lead">
          {assets.message}
        </p>
        <button type="button" className="btn btn-secondary btn-sm" onClick={reload}>
          Retry
        </button>
      </div>
    );
  }
  if (asset === null || prepared === null) {
    return (
      <div className="screen" role="status" aria-busy="true">
        <span className="sr-only">Loading</span>
      </div>
    );
  }
  return (
    <Walk
      asset={asset}
      points={prepared.points}
      direction={direction}
      source={source}
      warning={warning}
      sound={sound}
      initialMarks={prepared.marks}
      startedAt={prepared.startedAt}
    />
  );
}
