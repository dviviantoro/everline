/**
 * Tracking without a line (ADR-011): the field build has no survey server, so no line asset to walk
 * along. The operator carries the sensor along the cable and taps "Mark station" at each stop; the app
 * shows the level now, whether it is rising or falling, the level at each stop and where the strongest
 * one was (`mobile-tracking-mode.md` sections 1 and 3, with free marks M1, M2, ... in place of the
 * five stations of a span). Nothing is saved: the walk lives on this screen.
 *
 * One value a second feeds it: the window peak of the pulses of that second (all sensors together),
 * or the noise floor when none arrived, so that moving away from a source shows as falling instead of
 * freezing on the last pulse.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useNavigate } from 'react-router';

import { useBackInterceptor } from '../app/back';
import { useServices } from '../app/services';
import { useStream } from '../app/useStream';
import { useWizard } from '../app/wizard';
import type { Dsp } from '../core/dsp';
import { formatDb, formatDbmV } from '../core/format';
import { createFreeWalk, freeViewOf, MAX_FREE_MARKS, withMark, withSample, type FreeWalk } from '../core/freeWalk';
import { WARNING_PRESETS_DBMV } from '../core/tracking';
import type { GpsFix } from '../core/types';
import { SEVERITY_LABEL } from '../core/types';
import { BackButton, Pill, TopBar } from '../ui/primitives';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { AlertIcon, ArrowDownIcon, ArrowUpIcon, SteadyIcon } from '../ui/icons';
import { MarkChart } from '../ui/MarkChart';
import { StreamNotices } from '../ui/StreamNotices';
import { SEVERITY_COLOUR, TrendChip } from './TrackingScreen';

/** Without a pulse or a status for this long, the screen says it is waiting for the Cantol. */
const NO_DATA_AFTER_MS = 5000;
const DEFAULT_WARNING_DBMV = 30;

type Action =
  | { type: 'sample'; value: number }
  | { type: 'mark'; at: number; fix: GpsFix | null }
  | { type: 'warning'; level: number };

function makeReducer(dsp: Dsp) {
  return (walk: FreeWalk, action: Action): FreeWalk => {
    switch (action.type) {
      case 'sample':
        return withSample(walk, action.value, dsp);
      case 'mark':
        return withMark(walk, { at: action.at, fix: action.fix }, dsp) ?? walk;
      case 'warning':
        return { ...walk, warningLevelDbmV: action.level };
    }
  };
}

function trendWord(trend: 'rising' | 'falling' | 'steady'): string {
  return trend === 'rising' ? 'Rising' : trend === 'falling' ? 'Falling' : 'Steady';
}

export function FreeWalkScreen() {
  const { link, dsp, now } = useServices();
  const wizard = useWizard();
  const navigate = useNavigate();
  const { fixStore } = wizard;
  const { startError, begin } = useStream();

  const reducer = useMemo(() => makeReducer(dsp), [dsp]);
  const [walk, dispatch] = useReducer(reducer, DEFAULT_WARNING_DBMV, createFreeWalk);
  const view = useMemo(() => freeViewOf(walk, dsp), [walk, dsp]);

  const [ending, setEnding] = useState(false);
  const [alertDismissed, setAlertDismissed] = useState(false);
  const [synthetic, setSynthetic] = useState(false);
  const [sensorCount, setSensorCount] = useState(0);
  const [waiting, setWaiting] = useState(false);

  const markCount = walk.marks.length;
  const leave = useCallback(() => {
    void navigate('/live', { replace: true });
  }, [navigate]);
  useBackInterceptor(
    useCallback(() => {
      // Back from here is Live, never the setup screen a span walk has and this one does not.
      if (markCount === 0) leave();
      else setEnding(true);
      return true;
    }, [markCount, leave]),
  );

  // One sample a second: the window peak of the pulses that arrived in it, or the noise floor when there were none.
  const amps = useRef<number[]>([]);
  const noise = useRef<number | null>(null);
  const dataAt = useRef(now());
  useEffect(
    () =>
      link.subscribe({
        onEvents: (events) => {
          dataAt.current = now();
          for (const e of events) amps.current.push(e.ampDbmV);
        },
        onStatus: (s) => {
          dataAt.current = now();
          noise.current = s.noiseFloorDbmV;
          setSynthetic(s.synthetic);
          setSensorCount(s.sensors.length);
        },
        onLinkState: () => undefined,
      }),
    [link, now],
  );
  const linked = wizard.state.cantol === 'linked';
  useEffect(() => {
    const id = window.setInterval(() => {
      const value = dsp.windowPeak(amps.current) ?? noise.current;
      amps.current = [];
      if (value !== null) dispatch({ type: 'sample', value });
      setWaiting(linked && now() - dataAt.current > NO_DATA_AFTER_MS);
    }, 1000);
    return () => {
      window.clearInterval(id);
    };
  }, [dsp, now, linked]);

  const mark = () => {
    dispatch({ type: 'mark', at: now(), fix: fixStore.get() });
  };

  const lost = wizard.state.cantol === 'lost';
  const graceLeft = lost && wizard.state.cantolLostAt !== null ? Math.max(0, 30 - (wizard.state.nowMs - wizard.state.cantolLostAt) / 1000) : 0;
  const showAlert = walk.alertFired && !alertDismissed;
  const chartLabel =
    markCount === 0
      ? 'Level at each station. No station has been marked yet.'
      : `Level at each station. ${walk.marks.map((m) => `${m.label} ${formatDbmV(m.valueDbmV)} dBmV`).join(', ')}.${view.peak ? ` The strongest is ${view.peak.label}.` : ''}`;

  return (
    <div className="screen">
      <TopBar start={<BackButton label="Live" />} />

      <div style={{ paddingTop: 6, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <h1 className="title title-md" style={{ margin: 0 }}>
            Tracking
          </h1>
          <div className="mono" style={{ marginTop: 6, fontSize: '0.75rem', color: 'var(--muted)', overflowWrap: 'anywhere' }}>
            Free walk &middot; {String(markCount)} {markCount === 1 ? 'station' : 'stations'} marked
          </div>
        </div>
        {lost ? <Pill tone="warn">Reconnecting</Pill> : <Pill tone="ok">Recording</Pill>}
      </div>

      <div className="screen-body" style={{ paddingTop: 14, gap: 12 }}>
        <StreamNotices synthetic={synthetic} startError={startError} onRetry={begin} />

        {lost ? (
          <div className="banner" role="alert">
            <AlertIcon size={20} />
            <span style={{ flex: 1 }}>
              Cantol link lost. Your {String(markCount)} marks are kept. Setup reopens in {String(Math.ceil(graceLeft))} s if it does not come back.
            </span>
          </div>
        ) : null}

        {showAlert ? (
          <div className="banner" role="alert">
            <AlertIcon size={20} />
            <span style={{ flex: 1 }}>The level reached the warning level of {String(walk.warningLevelDbmV)} dBmV.</span>
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
              {sensorCount > 1 ? (
                <div className="helper" style={{ marginTop: 4 }}>
                  Strongest of {String(sensorCount)} sensors
                </div>
              ) : null}
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

        {waiting && startError === null ? (
          <p role="status" className="helper" style={{ margin: 0, fontSize: '0.875rem', lineHeight: 1.5 }}>
            Waiting for data from the Cantol. The link is up, but nothing has arrived for a few seconds.
          </p>
        ) : null}

        <section className="card" style={{ padding: '14px 12px 8px' }}>
          <div className="label-mono" style={{ padding: '0 4px 6px', letterSpacing: '0.14em' }}>
            Level at each station &middot; dBmV
          </div>
          <MarkChart
            marks={walk.marks.map((m) => ({ label: m.label, value: m.valueDbmV }))}
            warning={walk.warningLevelDbmV}
            peakIndex={view.peak?.index ?? null}
            live={view.live}
            label={chartLabel}
          />
        </section>

        {markCount > 0 ? (
          <section className="card card-flush" style={{ padding: '0 16px' }} aria-label="Stations">
            {walk.marks.map((m, i) => {
              const segment = i > 0 ? view.segments[i - 1] : undefined;
              const strongest = view.peak?.index === i;
              return (
                <div key={m.label} className="row" style={{ minHeight: 44 }}>
                  <span style={{ color: segment?.trend === 'rising' ? 'var(--accent-text)' : 'var(--cyan-text)', display: 'inline-flex', width: 18 }}>
                    {segment === undefined ? null : segment.trend === 'rising' ? (
                      <ArrowUpIcon size={18} />
                    ) : segment.trend === 'falling' ? (
                      <ArrowDownIcon size={18} />
                    ) : (
                      <SteadyIcon size={18} />
                    )}
                  </span>
                  <span className="row-title mono" style={{ fontSize: '0.8125rem' }}>
                    {m.label} &middot; {formatDbmV(m.valueDbmV)} dBmV{strongest ? ' · strongest' : ''}
                  </span>
                  <span style={{ fontSize: '0.8125rem', color: 'var(--muted)', textAlign: 'right' }}>
                    {segment === undefined
                      ? 'first'
                      : `${trendWord(segment.trend)} ${formatDb(segment.delta)} dB${segment.distanceM === null ? '' : ` · ${String(Math.round(segment.distanceM))} m`}`}
                  </span>
                </div>
              );
            })}
          </section>
        ) : null}

        <section className="card stack" style={{ gap: 8 }}>
          <div className="label-mono">Warn me at</div>
          <div className="seg" role="group" aria-label="Warning level">
            {WARNING_PRESETS_DBMV.map((level) => (
              <button
                key={level}
                type="button"
                aria-pressed={walk.warningLevelDbmV === level}
                onClick={() => {
                  dispatch({ type: 'warning', level });
                  setAlertDismissed(false);
                }}
              >
                {String(level)} dBmV
              </button>
            ))}
          </div>
        </section>
      </div>

      <div style={{ padding: '14px 0 8px' }}>
        <p className="helper" style={{ margin: '0 0 8px', textAlign: 'center' }} role="status">
          {view.next === null
            ? `All ${String(MAX_FREE_MARKS)} stations are marked. End the walk to start another.`
            : `Stand still at a station for five seconds, then tap Mark station (next: ${view.next}).`}
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
          <button type="button" className="btn btn-secondary" style={{ minHeight: 52 }} disabled={view.next === null || walk.samples.length === 0} onClick={mark}>
            Mark station
          </button>
          <button
            type="button"
            className="btn btn-primary"
            style={{ minHeight: 52 }}
            onClick={() => {
              if (markCount === 0) leave();
              else setEnding(true);
            }}
          >
            End walk
          </button>
        </div>
      </div>

      {ending ? (
        <ConfirmDialog
          title="End this walk?"
          confirmLabel="End walk"
          cancelLabel="Keep walking"
          onConfirm={leave}
          onCancel={() => {
            setEnding(false);
          }}
        >
          The {String(markCount)} marks are not saved: this version has no survey server to save a walk to. Write them down first if you need them.
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
