/**
 * Screen 6: live PD (`mobile-ui-spec.md` section 3.6). Phase-resolved plot, the Ref locked chip
 * (no phase plot without the mains reference), Peak, Rate and Noise tiles, and a Record button
 * that captures a window and goes to Tag. There is no waveform button: the API has nowhere to
 * put a waveform.
 *
 * Two things the real link adds: a banner while the device says its numbers are generated test
 * data (they must never pass for a reading), and a message with a retry when the Cantol could not
 * be told to start. A build without the survey server (`surveysNote`) has neither Record nor
 * Tracking: it shows the live numbers and says why recording is missing.
 *
 * Pulses are kept in a rolling buffer outside React state and the view is redrawn four times a
 * second, so a few hundred pulses a second do not render the screen hundreds of times.
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';

import { useServices } from '../app/services';
import { useStream } from '../app/useStream';
import { useGpsFix, useWizard } from '../app/wizard';
import { formatClock, formatDbmV } from '../core/format';
import type { SensorStatus } from '../core/links';
import type { SpotMeasurement } from '../core/model';
import { AlertIcon, CheckIcon } from '../ui/icons';
import { BottomNav } from '../ui/BottomNav';
import { PrpdPlot, plotScaleMax, type PlotPoint } from '../ui/PrpdPlot';
import { Pill, TopBar } from '../ui/primitives';
import { StreamNotices } from '../ui/StreamNotices';

/** Without any status or pulses for this long, the screen says it is waiting for the Cantol. */
const NO_DATA_AFTER_MS = 5000;
/** How long a pulse stays on the plot. */
const PLOT_WINDOW_MS = 3000;
/** The Peak tile is the highest level of this many recent milliseconds (an assumption). */
const PEAK_WINDOW_MS = 10_000;
const MAX_PLOTTED = 350;
const REDRAW_MS = 250;

interface TimedPulse {
  at: number;
  amp: number;
  phase: number;
  /** The sensor that saw it, counted from 0. */
  sensor: number;
}

interface View {
  points: PlotPoint[];
  peak: number | null;
  rate: number | null;
  noise: number | null;
  mainsLock: boolean;
  /** The device says what it sends is generated test data. */
  synthetic: boolean;
  /** How many sensors the device reports on (0 or 1: no selector). */
  sensors: number;
  /** No data has arrived for a while although the link is up. */
  waiting: boolean;
  recording: { remainingS: number; fraction: number } | null;
}

const EMPTY_VIEW: View = {
  points: [],
  peak: null,
  rate: null,
  noise: null,
  mainsLock: true,
  synthetic: false,
  sensors: 0,
  waiting: false,
  recording: null,
};

interface Recording {
  startedAt: number;
  seconds: number;
  amps: number[];
}

export function LiveScreen() {
  const { link, dsp, store, config, now } = useServices();
  const wizard = useWizard();
  const fix = useGpsFix();
  const navigate = useNavigate();
  const { state } = wizard;

  const pulses = useRef<TimedPulse[]>([]);
  const status = useRef<{ rate: number; noise: number; mainsLock: boolean; synthetic: boolean; sensors: readonly SensorStatus[] } | null>(null);
  /** When this screen opened, then when pulses or a status last arrived. */
  const dataAt = useRef(now());
  const recording = useRef<Recording | null>(null);
  const linked = useRef(false);
  const fixRef = useRef(fix);
  const [view, setView] = useState<View>(EMPTY_VIEW);
  const [message, setMessage] = useState<string | null>(null);
  // Which sensor the plot and tiles show: null is all of them. The redraw reads it through a ref.
  const [sensor, setSensor] = useState<number | null>(null);
  const sensorRef = useRef<number | null>(null);

  useEffect(() => {
    linked.current = state.cantol === 'linked';
    fixRef.current = fix;
  }, [state.cantol, fix]);
  useEffect(() => {
    sensorRef.current = sensor;
  }, [sensor]);

  // The stream runs while this screen is open; a Start that fails is shown with a retry.
  const { startError, begin } = useStream();
  const isLinked = state.cantol === 'linked';

  useEffect(
    () =>
      link.subscribe({
        onEvents: (events) => {
          const at = now();
          dataAt.current = at;
          for (const e of events) {
            pulses.current.push({ at, amp: e.ampDbmV, phase: e.phase, sensor: e.sensor });
            recording.current?.amps.push(e.ampDbmV);
          }
        },
        onStatus: (s) => {
          dataAt.current = now();
          status.current = {
            rate: s.triggerRateHz,
            noise: s.noiseFloorDbmV,
            mainsLock: s.mainsLock,
            synthetic: s.synthetic,
            sensors: s.sensors,
          };
        },
        onLinkState: () => undefined,
      }),
    [link, now],
  );

  useEffect(() => {
    const finish = (rec: Recording) => {
      recording.current = null;
      const peak = dsp.windowPeak(rec.amps);
      if (peak === null) {
        setMessage('No pulses arrived during the recording. Check the link and record again.');
        return;
      }
      const measurement: SpotMeasurement = {
        kind: 'spot',
        id: crypto.randomUUID(),
        recordedAt: now(),
        durationS: rec.seconds,
        peakDbmV: peak,
        rateHz: status.current?.rate ?? 0,
        noiseDbmV: status.current?.noise ?? 0,
        fix: fixRef.current,
      };
      void store
        .saveMeasurement(measurement)
        .then(() => navigate(`/tag?m=${measurement.id}`, { replace: true }))
        .catch(() => {
          setMessage('The recording could not be saved on this phone. Try again.');
        });
    };

    const id = window.setInterval(() => {
      const t = now();
      pulses.current = pulses.current.filter((p) => t - p.at <= PEAK_WINDOW_MS);
      const sensors = status.current?.sensors ?? [];
      const picked = sensorRef.current !== null && sensorRef.current < sensors.length ? sensorRef.current : null;
      const shown = picked === null ? pulses.current : pulses.current.filter((p) => p.sensor === picked);
      const recent = shown.filter((p) => t - p.at <= PLOT_WINDOW_MS);
      const figures = picked === null ? null : sensors[picked];

      const rec = recording.current;
      if (rec && !linked.current) {
        recording.current = null;
        setMessage('The Cantol link dropped during the recording. Record again once it is back.');
      } else if (rec && t - rec.startedAt >= rec.seconds * 1000) {
        finish(rec);
      }

      const active = recording.current;
      setView({
        points: recent.slice(-MAX_PLOTTED).map((p) => ({ phase: p.phase, ampDbmV: p.amp })),
        peak: dsp.windowPeak(shown.map((p) => p.amp)),
        rate: figures ? figures.rateHz : (status.current?.rate ?? null),
        noise: figures ? figures.noiseFloorDbmV : (status.current?.noise ?? null),
        mainsLock: status.current?.mainsLock ?? true,
        synthetic: status.current?.synthetic ?? false,
        sensors: sensors.length,
        waiting: linked.current && t - dataAt.current > NO_DATA_AFTER_MS,
        recording: active
          ? {
              remainingS: Math.max(0, active.seconds - (t - active.startedAt) / 1000),
              fraction: Math.min(1, (t - active.startedAt) / (active.seconds * 1000)),
            }
          : null,
      });
    }, REDRAW_MS);
    return () => {
      window.clearInterval(id);
    };
  }, [dsp, store, now, navigate]);

  const seconds = config.recordSeconds();
  const surveysNote = config.surveysNote ?? null;
  const lost = state.cantol === 'lost';
  const graceLeft = lost && state.cantolLostAt !== null ? Math.max(0, 30 - (state.nowMs - state.cantolLostAt) / 1000) : 0;

  const startRecording = () => {
    setMessage(null);
    recording.current = { startedAt: now(), seconds, amps: [] };
  };
  const cancelRecording = () => {
    recording.current = null;
  };

  const yMax = plotScaleMax(view.peak);
  const picked = sensor !== null && sensor < view.sensors ? sensor : null;
  const plotLabel = `Phase-resolved partial discharge plot${picked === null ? '' : `, sensor ${String(picked + 1)}`}. ${String(view.points.length)} pulses in the last ${String(PLOT_WINDOW_MS / 1000)} seconds${
    view.peak === null ? '' : `, peak ${formatDbmV(view.peak)} dBmV`
  }.`;

  return (
    <div className="screen screen-tabbed">
      <TopBar />

      <div style={{ paddingTop: 14, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <h1 className="title title-md" style={{ margin: 0 }}>
            Live PD
          </h1>
          <div className="mono" style={{ marginTop: 6, fontSize: '0.75rem', color: 'var(--muted)', overflowWrap: 'anywhere' }}>
            Cantol {state.cantolDeviceId ?? '--'} &middot; {String(state.rttMs ?? 0)} ms
          </div>
        </div>
        {isLinked ? <Pill tone="ok">Connected</Pill> : <Pill tone="warn">Reconnecting</Pill>}
      </div>

      <div className="screen-body" style={{ paddingTop: 16, gap: 12 }}>
        <StreamNotices synthetic={view.synthetic} startError={startError} onRetry={begin} />

        <div className="seg" role="group" aria-label="Measurement mode">
          <button type="button" aria-pressed="true">
            Spot reading
          </button>
          <Link to={surveysNote === null ? '/track/setup' : '/track'}>Tracking mode</Link>
        </div>

        {lost ? (
          <div className="banner" role="alert">
            <AlertIcon size={20} />
            <span style={{ flex: 1 }}>
              Cantol link lost. Trying to reconnect; setup reopens in {String(Math.ceil(graceLeft))} s if it does not come back.
            </span>
          </div>
        ) : null}

        {view.sensors > 1 ? (
          <div className="stack" style={{ gap: 6 }}>
            <div className="label-mono" style={{ letterSpacing: '0.14em' }}>
              Sensor
            </div>
            <div className="seg" role="group" aria-label="Sensor">
              <button
                type="button"
                aria-pressed={picked === null}
                onClick={() => {
                  setSensor(null);
                }}
              >
                All
              </button>
              {Array.from({ length: view.sensors }, (_unused, i) => (
                <button
                  key={i}
                  type="button"
                  aria-pressed={picked === i}
                  aria-label={`Sensor ${String(i + 1)}`}
                  onClick={() => {
                    setSensor(i);
                  }}
                >
                  {String(i + 1)}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <section className="card" style={{ padding: '14px 12px 8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '0 4px 8px' }}>
            <span className="label-mono" style={{ letterSpacing: '0.14em' }}>
              Phase-resolved &middot; 50 Hz
            </span>
            {view.mainsLock ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', fontWeight: 600, color: 'var(--ok-text)' }}>
                <CheckIcon size={14} />
                Ref locked
              </span>
            ) : (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', fontWeight: 600, color: 'var(--warn-text)' }}>
                <AlertIcon size={14} />
                Ref not locked
              </span>
            )}
          </div>
          {view.mainsLock ? (
            <PrpdPlot points={view.points} yMax={yMax} noiseDbmV={view.noise ?? 6} label={plotLabel} />
          ) : (
            <p className="helper" style={{ margin: '8px 4px 16px', fontSize: '0.875rem', lineHeight: 1.5 }}>
              The mains reference is not locked, so the phase of a pulse means nothing and the plot is hidden. Peak, rate and noise
              below still update.
            </p>
          )}
        </section>

        <div className="tiles">
          <div className="tile">
            <div className="label-mono">Peak</div>
            <div className="tile-value">
              {view.peak === null ? '—' : formatDbmV(view.peak)}
              <span className="unit"> dBmV</span>
            </div>
          </div>
          <div className="tile">
            <div className="label-mono">Rate</div>
            <div className="tile-value">
              {view.rate === null ? '—' : String(Math.round(view.rate))}
              <span className="unit"> /s</span>
            </div>
          </div>
          <div className="tile">
            <div className="label-mono">Noise</div>
            <div className="tile-value">
              {view.noise === null ? '—' : formatDbmV(view.noise)}
              <span className="unit"> dBmV</span>
            </div>
          </div>
        </div>

        {view.waiting && startError === null ? (
          <p role="status" className="helper" style={{ margin: 0, fontSize: '0.875rem', lineHeight: 1.5 }}>
            Waiting for data from the Cantol. The link is up, but nothing has arrived for a few seconds.
          </p>
        ) : null}

        {message ? (
          <p role="alert" style={{ margin: 0, fontSize: '0.875rem', color: 'var(--crit-text)' }}>
            {message}
          </p>
        ) : null}
      </div>

      <div className="stack" style={{ gap: 10, padding: '16px 0' }}>
        {surveysNote !== null ? (
          <p className="helper" style={{ margin: 0, textAlign: 'center', fontSize: '0.875rem', lineHeight: 1.5 }}>
            {surveysNote}
          </p>
        ) : view.recording ? (
          <>
            <div role="status" aria-live="polite" className="mono" style={{ textAlign: 'center', fontSize: '0.875rem' }}>
              Recording &middot; {formatClock(view.recording.remainingS)}
            </div>
            <div className="splash-bar" aria-hidden="true">
              <span style={{ transform: `scaleX(${String(view.recording.fraction)})`, animation: 'none' }} />
            </div>
            <button type="button" className="btn btn-secondary btn-sm" onClick={cancelRecording}>
              Cancel
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-primary" disabled={!isLinked} onClick={startRecording}>
            Record {String(seconds)} s
          </button>
        )}
      </div>

      <BottomNav />
    </div>
  );
}
