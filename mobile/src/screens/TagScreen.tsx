/**
 * Screen 7: tag the survey (`mobile-ui-spec.md` section 3.8). The form is the API's survey, so it
 * needs more than the mock shows: a Line or Cable filter (`line_type`), a searchable list of line
 * assets sorted by distance from the GPS fix, a measurement-point picker that preselects the
 * nearest point, a condition defaulted by the WASM `classify`, and an optional temperature.
 * Saving writes to the local store first, then makes one upload attempt.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';

import { useServices } from '../app/services';
import { useSession } from '../app/session';
import { useSurveys } from '../app/surveys';
import { formatDbmV, formatDistance } from '../core/format';
import { haversineM, projectOntoRoute } from '../core/geo';
import type { Measurement, SavedSurvey, SpotMeasurement } from '../core/model';
import { buildSpotPayload, NOTE_INPUT_MAX } from '../core/payload';
import { LINE_KIND_LABEL, SEVERITY_LABEL, type LineAssetWithPoles, type LineType, type MeasurementPoint, type Severity } from '../core/types';
import { CheckIcon } from '../ui/icons';
import { BackButton, Segmented, TopBar } from '../ui/primitives';

const SEVERITIES: readonly Severity[] = ['normal', 'warning', 'critical'];
const KIND_OPTIONS = [
  { value: 'SUTM' as const, label: LINE_KIND_LABEL.SUTM },
  { value: 'SKTM' as const, label: LINE_KIND_LABEL.SKTM },
];

type Loaded<T> = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; value: T };

function SeverityButtons({ value, onChange }: { value: Severity; onChange: (next: Severity) => void }) {
  const dot: Record<Severity, string> = { normal: 'var(--ok)', warning: 'var(--accent)', critical: 'var(--crit)' };
  return (
    <div className="opt-grid" role="group" aria-label="Condition">
      {SEVERITIES.map((severity) => (
        <button
          key={severity}
          type="button"
          className="opt"
          aria-pressed={severity === value}
          onClick={() => {
            onChange(severity);
          }}
        >
          <span className="dot" style={{ background: dot[severity] }} aria-hidden="true" />
          {SEVERITY_LABEL[severity]}
        </button>
      ))}
    </div>
  );
}

function SpotTag({ measurement }: { measurement: SpotMeasurement }) {
  const { api, dsp, config, now } = useServices();
  const { operator } = useSession();
  const surveys = useSurveys();
  const navigate = useNavigate();
  const { fix } = measurement;

  const [assets, setAssets] = useState<Loaded<LineAssetWithPoles[]>>({ status: 'loading' });
  const [reload, setReload] = useState(0);
  const [kind, setKind] = useState<LineType>('SUTM');
  const [query, setQuery] = useState('');
  const [assetId, setAssetId] = useState<string | null>(null);
  const [pointsFor, setPointsFor] = useState<{ assetId: string; points: MeasurementPoint[] } | null>(null);
  const [pointId, setPointId] = useState<string | null>(null);
  const [severityEdit, setSeverityEdit] = useState<Severity | null>(null);
  const [temperature, setTemperature] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const classified = dsp.classify(measurement.peakDbmV);
  const severity = severityEdit ?? classified ?? 'normal';

  // Load the line assets, then start on the nearest one.
  useEffect(() => {
    let alive = true;
    void api
      .listLineAssets()
      .then((list) => {
        if (!alive) return;
        setAssets({ status: 'ready', value: list });
        if (!fix) return;
        let nearest: { asset: LineAssetWithPoles; offsetM: number } | null = null;
        for (const asset of list) {
          const offsetM = projectOntoRoute(asset.route_geometry, fix).offsetM;
          if (!nearest || offsetM < nearest.offsetM) nearest = { asset, offsetM };
        }
        if (nearest) {
          setKind(nearest.asset.line_type);
          setAssetId(nearest.asset.id);
        }
      })
      .catch(() => {
        if (alive) setAssets({ status: 'error', message: 'The list of lines could not be loaded.' });
      });
    return () => {
      alive = false;
    };
  }, [api, fix, reload]);

  // Load the chosen line's measurement points, then preselect the nearest to the fix.
  useEffect(() => {
    if (assetId === null) return undefined;
    let alive = true;
    void api
      .listMeasurementPoints(assetId)
      .then((points) => {
        if (!alive) return;
        setPointsFor({ assetId, points });
        let nearest: { id: string; d: number } | null = null;
        for (const p of points) {
          const d = fix ? haversineM(fix, p) : 0;
          if (!nearest || d < nearest.d) nearest = { id: p.id, d };
        }
        setPointId(nearest?.id ?? null);
      })
      .catch(() => {
        if (alive) setPointsFor({ assetId, points: [] });
      });
    return () => {
      alive = false;
    };
  }, [api, assetId, fix]);

  const list = useMemo(() => {
    if (assets.status !== 'ready') return [];
    const needle = query.trim().toLowerCase();
    return assets.value
      .filter((a) => a.line_type === kind && a.code.toLowerCase().includes(needle))
      .map((a) => ({ asset: a, offsetM: fix ? projectOntoRoute(a.route_geometry, fix).offsetM : null }))
      .sort((a, b) => (a.offsetM ?? 0) - (b.offsetM ?? 0));
  }, [assets, kind, query, fix]);

  const asset = assets.status === 'ready' ? (assets.value.find((a) => a.id === assetId) ?? null) : null;
  const points = pointsFor && pointsFor.assetId === assetId ? pointsFor.points : null;
  const point = points?.find((p) => p.id === pointId) ?? null;
  const canSave = !saving && operator !== null && fix !== null && asset !== null && point !== null;

  const temperatureValue = temperature.trim() === '' ? null : Number(temperature);
  const temperatureInvalid = temperatureValue !== null && !Number.isFinite(temperatureValue);

  const save = () => {
    if (!canSave || temperatureInvalid) return;
    setSaving(true);
    setError(null);
    const payload = buildSpotPayload({
      operator,
      measurement,
      point,
      severity,
      note,
      temperatureC: temperatureValue,
      pdDevice: config.pdDevice,
    });
    const survey: SavedSurvey = {
      id: crypto.randomUUID(),
      createdAt: now(),
      mode: 'spot',
      assetId: asset.id,
      assetCode: asset.code,
      lineType: asset.line_type,
      severity,
      peakDbmV: measurement.peakDbmV,
      peakLabel: null,
      payload,
      upload: { state: 'saved', surveyId: null, message: null, attempts: 0 },
    };
    void surveys
      .saveAndUpload(survey, measurement.id)
      .then(() => navigate('/surveys', { replace: true }))
      .catch(() => {
        setSaving(false);
        setError('The survey could not be saved on this phone. Try again.');
      });
  };

  return (
    <div className="screen">
      <TopBar start={<BackButton label="Live" />} />
      <h1 className="title title-md">
        Tag <span className="accent">survey</span>
      </h1>

      <div className="screen-body" style={{ marginTop: 16, gap: 16 }}>
        <section className="card" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10, padding: '14px 16px' }}>
          <div>
            <div className="label-mono">Recorded</div>
            <div className="display-num" style={{ marginTop: 2, fontSize: '1.625rem', lineHeight: 1.05 }}>
              {String(measurement.durationS)} s
            </div>
          </div>
          <div>
            <div className="label-mono">Peak</div>
            <div className="display-num" style={{ marginTop: 2, fontSize: '1.625rem', lineHeight: 1.05 }}>
              {formatDbmV(measurement.peakDbmV)}
              <span className="unit" style={{ fontSize: '0.75rem' }}> dBmV</span>
            </div>
          </div>
          <div>
            <div className="label-mono">Rate</div>
            <div className="display-num" style={{ marginTop: 2, fontSize: '1.625rem', lineHeight: 1.05 }}>
              {String(Math.round(measurement.rateHz))}
              <span className="unit" style={{ fontSize: '0.75rem' }}> /s</span>
            </div>
          </div>
        </section>

        <section className="stack" style={{ gap: 10 }} aria-labelledby="asset-heading">
          <h2 id="asset-heading" style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 600 }}>
            Asset
          </h2>
          <Segmented label="Line or cable" options={KIND_OPTIONS} value={kind} onChange={setKind} />
          <div className="field">
            <label htmlFor="asset-search">Asset ID</label>
            <input
              id="asset-search"
              className="input input-mono"
              type="search"
              autoComplete="off"
              placeholder="Search, for example SUTM-PKL-02"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
              }}
            />
          </div>
          {assets.status === 'loading' ? (
            <p className="helper" role="status" style={{ margin: 0 }}>
              Loading lines&hellip;
            </p>
          ) : assets.status === 'error' ? (
            <div className="banner banner-crit" role="alert">
              <span style={{ flex: 1 }}>{assets.message}</span>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                style={{ minHeight: 44 }}
                onClick={() => {
                  setAssets({ status: 'loading' });
                  setReload((n) => n + 1);
                }}
              >
                Retry
              </button>
            </div>
          ) : list.length === 0 ? (
            <p className="helper" role="status" style={{ margin: 0 }}>
              {query.trim() === ''
                ? `There are no ${LINE_KIND_LABEL[kind].toLowerCase()} assets.`
                : `No ${LINE_KIND_LABEL[kind].toLowerCase()} matches “${query.trim()}”.`}
            </p>
          ) : (
            <div className="asset-list" role="radiogroup" aria-label="Line assets, nearest first">
              {list.map(({ asset: a, offsetM }) => (
                <button
                  key={a.id}
                  type="button"
                  role="radio"
                  aria-checked={a.id === assetId}
                  className="asset-item"
                  onClick={() => {
                    setAssetId(a.id);
                    setPointId(null);
                  }}
                >
                  <span className="mono asset-code">{a.code}</span>
                  <span className="helper asset-poles">
                    {(a.pole_a.label ?? '').replace(/^Tiang\s+/i, '')} &ndash; {(a.pole_b.label ?? '').replace(/^Tiang\s+/i, '')}
                    {offsetM === null ? '' : ` · ${formatDistance(offsetM)} away`}
                  </span>
                </button>
              ))}
            </div>
          )}
          {fix ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.875rem', color: 'var(--ok-text)', fontWeight: 500 }}>
              <CheckIcon size={16} />
              Location captured &middot; &plusmn;{String(Math.round(fix.accuracyM))} m
            </div>
          ) : (
            <p role="alert" style={{ margin: 0, fontSize: '0.875rem', color: 'var(--crit-text)' }}>
              No location was captured with this recording, so it cannot be saved. Record again with GPS on.
            </p>
          )}
        </section>

        {asset ? (
          <section className="stack" style={{ gap: 10 }} aria-labelledby="point-heading">
            <h2 id="point-heading" style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 600 }}>
              Measurement point
            </h2>
            {points === null ? (
              <p className="helper" role="status" style={{ margin: 0 }}>
                Loading the points of {asset.code}&hellip;
              </p>
            ) : points.length === 0 ? (
              <p role="alert" style={{ margin: 0, fontSize: '0.875rem', color: 'var(--crit-text)' }}>
                This line has no measurement points, so a reading cannot be tied to its history.
              </p>
            ) : (
              <>
                <Segmented
                  label="Measurement point"
                  options={points.map((p) => ({ value: p.id, label: `P${String(p.sequence_no)}` }))}
                  value={pointId ?? ''}
                  onChange={setPointId}
                />
                <p className="helper" style={{ margin: 0 }}>
                  {point ? `${point.label}. The nearest point to you is chosen first.` : 'Choose the point you measured at.'}
                </p>
              </>
            )}
          </section>
        ) : null}

        <section className="stack" style={{ gap: 10 }}>
          <h2 style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 600 }}>Condition</h2>
          <SeverityButtons value={severity} onChange={setSeverityEdit} />
          <p className="helper" style={{ margin: 0 }}>
            {severityEdit !== null && classified !== null && severityEdit !== classified
              ? `You changed it. The reading suggests ${SEVERITY_LABEL[classified].toLowerCase()}.`
              : classified === null
                ? 'The reading could not be classified. Choose the condition.'
                : `Suggested from the reading: ${SEVERITY_LABEL[classified].toLowerCase()}.`}
          </p>
        </section>

        <section className="field">
          <label htmlFor="temperature">Asset temperature, &deg;C (optional)</label>
          <input
            id="temperature"
            className="input"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            placeholder="For example 31.5"
            aria-invalid={temperatureInvalid}
            value={temperature}
            onChange={(event) => {
              setTemperature(event.target.value);
            }}
          />
          {temperatureInvalid ? (
            <span role="alert" style={{ fontSize: '0.8125rem', color: 'var(--crit-text)' }}>
              Enter a number, or leave it empty.
            </span>
          ) : null}
          {/* TODO(TASK-007): optional photo row; upload with POST /api/uploads first, then send the returned URL as photo_url. */}
        </section>

        <section className="field">
          <label htmlFor="note" style={{ fontSize: '0.9375rem', fontWeight: 600 }}>
            Note
          </label>
          <textarea
            id="note"
            className="input"
            rows={3}
            maxLength={NOTE_INPUT_MAX}
            placeholder="Add a note for the engineer (optional)"
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
            }}
          />
        </section>
      </div>

      <div className="pinned">
        {error ? (
          <p role="alert" style={{ margin: 0, fontSize: '0.875rem', color: 'var(--crit-text)', textAlign: 'center' }}>
            {error}
          </p>
        ) : null}
        <button type="button" className="btn btn-primary" disabled={!canSave || temperatureInvalid} onClick={save}>
          {saving ? 'Saving…' : 'Save survey'}
        </button>
      </div>
    </div>
  );
}

export function TagScreen() {
  const { store } = useServices();
  const [params] = useSearchParams();
  const id = params.get('m');
  const [measurement, setMeasurement] = useState<Loaded<Measurement | null>>({ status: 'loading' });

  useEffect(() => {
    if (id === null) return undefined;
    let alive = true;
    void store
      .getMeasurement(id)
      .then((m) => {
        if (alive) setMeasurement({ status: 'ready', value: m });
      })
      .catch(() => {
        if (alive) setMeasurement({ status: 'error', message: 'The recording could not be read from this phone.' });
      });
    return () => {
      alive = false;
    };
  }, [store, id]);

  if (id === null || (measurement.status === 'ready' && measurement.value === null)) {
    return (
      <div className="screen">
        <TopBar start={<BackButton label="Live" />} />
        <h1 className="title title-md">
          Nothing to <span className="accent">tag</span>
        </h1>
        <p className="lead" style={{ marginTop: 10 }}>
          There is no unsaved recording. Record a reading on the Live screen first.
        </p>
        <div className="pinned">
          <Link to="/live" className="btn btn-primary">
            Go to Live
          </Link>
        </div>
      </div>
    );
  }
  if (measurement.status === 'loading') {
    return (
      <div className="screen" role="status" aria-busy="true">
        <span className="sr-only">Loading</span>
      </div>
    );
  }
  if (measurement.status === 'error' || measurement.value === null) {
    return (
      <div className="screen">
        <TopBar start={<BackButton label="Live" />} />
        <p role="alert" className="lead">
          {measurement.status === 'error' ? measurement.message : 'Nothing to tag.'}
        </p>
      </div>
    );
  }
  if (measurement.value.kind === 'tracking') {
    return (
      <div className="screen">
        <TopBar start={<BackButton label="Setup" />} />
        <p className="lead">Tracking walks are tagged in the next milestone.</p>
      </div>
    );
  }
  return <SpotTag measurement={measurement.value} />;
}
