/**
 * Screen 7: tag the survey (`mobile-ui-spec.md` section 3.8, `mobile-tracking-mode.md` section 5).
 * A spot reading needs more than the mock shows because the form is the API's survey: a Line or
 * Cable filter (`line_type`), a searchable asset list sorted by distance from the GPS fix, a
 * measurement-point picker with the nearest point preselected, a condition suggested by the WASM
 * `classify`, and an optional temperature. A tracking walk arrives with its asset already chosen.
 * Saving writes to the local store first, then makes one upload attempt.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';

import { useServices } from '../app/services';
import { useSession } from '../app/session';
import { useSurveys } from '../app/surveys';
import { useLineAssets, type Loaded } from '../app/useLineAssets';
import { nearestAsset, nearestPoint } from '../core/assets';
import { formatDbmV } from '../core/format';
import type { Measurement, SavedSurvey, SpotMeasurement, TrackingMeasurement } from '../core/model';
import { buildSpotPayload, buildTrackingPayload, directionText, NOTE_INPUT_MAX, trackingPeak } from '../core/payload';
import type { LineAssetWithPoles, LineType, MeasurementPoint, Severity } from '../core/types';
import { AssetPicker } from '../ui/AssetPicker';
import { CheckIcon } from '../ui/icons';
import { BackButton, Segmented, TopBar } from '../ui/primitives';
import { ConditionSection, SummaryCard } from './tagParts';

const NO_ASSETS: readonly LineAssetWithPoles[] = [];

function NoteField({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  return (
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
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
    </section>
  );
}

function SaveBar({ error, saving, disabled, onSave }: { error: string | null; saving: boolean; disabled: boolean; onSave: () => void }) {
  return (
    <div className="pinned">
      {error ? (
        <p role="alert" style={{ margin: 0, fontSize: '0.875rem', color: 'var(--crit-text)', textAlign: 'center' }}>
          {error}
        </p>
      ) : null}
      <button type="button" className="btn btn-primary" disabled={disabled || saving} onClick={onSave}>
        {saving ? 'Saving…' : 'Save survey'}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

function SpotTag({ measurement }: { measurement: SpotMeasurement }) {
  const { api, dsp, config, now } = useServices();
  const { operator } = useSession();
  const surveys = useSurveys();
  const navigate = useNavigate();
  const { fix } = measurement;
  const { assets, reload } = useLineAssets();
  const list = assets.status === 'ready' ? assets.value : NO_ASSETS;
  const nearest = useMemo(() => nearestAsset(list, fix), [list, fix]);

  // The nearest line is the starting choice; anything the operator picks wins.
  const [chosenKind, setChosenKind] = useState<LineType | null>(null);
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const kind = chosenKind ?? nearest?.line_type ?? 'SUTM';
  const picked = list.find((a) => a.id === (chosenId ?? nearest?.id));
  const asset = picked && picked.line_type === kind ? picked : null;
  const assetId = asset?.id ?? null;

  const [pointsFor, setPointsFor] = useState<{ assetId: string; points: MeasurementPoint[] } | null>(null);
  const [chosenPoint, setChosenPoint] = useState<{ assetId: string; pointId: string } | null>(null);
  useEffect(() => {
    if (assetId === null) return undefined;
    let alive = true;
    void api
      .listMeasurementPoints(assetId)
      .then((points) => {
        if (alive) setPointsFor({ assetId, points });
      })
      .catch(() => {
        if (alive) setPointsFor({ assetId, points: [] });
      });
    return () => {
      alive = false;
    };
  }, [api, assetId]);
  const points = pointsFor && pointsFor.assetId === assetId ? pointsFor.points : null;
  const pointId = chosenPoint && chosenPoint.assetId === assetId ? chosenPoint.pointId : (points ? nearestPoint(points, fix)?.id : null) ?? null;
  const point = points?.find((p) => p.id === pointId) ?? null;

  const [severityEdit, setSeverityEdit] = useState<Severity | null>(null);
  const classified = dsp.classify(measurement.peakDbmV);
  const severity = severityEdit ?? classified ?? 'normal';
  const [temperature, setTemperature] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const temperatureValue = temperature.trim() === '' ? null : Number(temperature);
  const temperatureInvalid = temperatureValue !== null && !Number.isFinite(temperatureValue);
  const canSave = operator !== null && fix !== null && asset !== null && point !== null && !temperatureInvalid;

  const save = () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
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
      payload: buildSpotPayload({
        operator,
        measurement,
        point,
        severity,
        note,
        temperatureC: temperatureValue,
        pdDevice: config.pdDevice,
      }),
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
        <SummaryCard
          items={[
            { label: 'Recorded', value: `${String(measurement.durationS)} s` },
            { label: 'Peak', value: formatDbmV(measurement.peakDbmV), unit: 'dBmV' },
            { label: 'Rate', value: String(Math.round(measurement.rateHz)), unit: '/s' },
          ]}
        />

        <section className="stack" style={{ gap: 10 }} aria-labelledby="asset-heading">
          <h2 id="asset-heading" style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 600 }}>
            Asset
          </h2>
          <AssetPicker
            assets={assets}
            onRetry={reload}
            fix={fix}
            kind={kind}
            onKind={(next) => {
              setChosenKind(next);
              setChosenId(null);
            }}
            query={query}
            onQuery={setQuery}
            selectedId={assetId}
            onSelect={setChosenId}
          />
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
                  onChange={(next) => {
                    setChosenPoint({ assetId: asset.id, pointId: next });
                  }}
                />
                <p className="helper" style={{ margin: 0 }}>
                  {point ? `${point.label}. The nearest point to you is chosen first.` : 'Choose the point you measured at.'}
                </p>
              </>
            )}
          </section>
        ) : null}

        <ConditionSection value={severity} suggested={classified} edited={severityEdit !== null} onChange={setSeverityEdit} />

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

        <NoteField value={note} onChange={setNote} />
      </div>

      <SaveBar error={error} saving={saving} disabled={!canSave} onSave={save} />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

function TrackingTag({ measurement }: { measurement: TrackingMeasurement }) {
  const { api, dsp, config, now } = useServices();
  const { operator } = useSession();
  const surveys = useSurveys();
  const navigate = useNavigate();
  const { assets, reload } = useLineAssets();
  const asset = assets.status === 'ready' ? (assets.value.find((a) => a.id === measurement.assetId) ?? null) : null;

  const [pointsFor, setPointsFor] = useState<{ assetId: string; points: MeasurementPoint[] } | null>(null);
  useEffect(() => {
    let alive = true;
    void api
      .listMeasurementPoints(measurement.assetId)
      .then((points) => {
        if (alive) setPointsFor({ assetId: measurement.assetId, points });
      })
      .catch(() => {
        if (alive) setPointsFor({ assetId: measurement.assetId, points: [] });
      });
    return () => {
      alive = false;
    };
  }, [api, measurement.assetId]);
  const points = pointsFor?.points ?? null;

  const peak = trackingPeak(measurement.marks, dsp);
  const classified = peak ? dsp.classify(peak.mark.valueDbmV) : null;
  const [severityEdit, setSeverityEdit] = useState<Severity | null>(null);
  const severity = severityEdit ?? classified ?? 'normal';
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canSave = operator !== null && asset !== null && points !== null && points.length === 3 && peak !== null;

  const save = () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    const survey: SavedSurvey = {
      id: crypto.randomUUID(),
      createdAt: now(),
      mode: 'tracking',
      assetId: asset.id,
      assetCode: asset.code,
      lineType: asset.line_type,
      severity,
      peakDbmV: peak.mark.valueDbmV,
      peakLabel: peak.mark.label,
      payload: buildTrackingPayload({
        operator,
        measurement,
        asset,
        points,
        dsp,
        peakSeverity: severity,
        note,
        pdDevice: config.pdDevice,
      }),
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
      <TopBar start={<BackButton label="Setup" />} />
      <h1 className="title title-md">
        Tag <span className="accent">walk</span>
      </h1>

      <div className="screen-body" style={{ marginTop: 16, gap: 16 }}>
        <SummaryCard
          items={[
            { label: 'Stations', value: `${String(measurement.marks.length)} of 5` },
            { label: 'Peak', value: peak ? formatDbmV(peak.mark.valueDbmV) : '—', unit: 'dBmV' },
            { label: 'At', value: peak ? peak.mark.label : '—' },
          ]}
        />

        <section className="card stack" style={{ gap: 6 }} aria-label="Walk">
          {assets.status === 'error' ? (
            <div className="banner banner-crit" role="alert">
              <span style={{ flex: 1 }}>{assets.message}</span>
              <button type="button" className="btn btn-secondary btn-sm" style={{ minHeight: 44 }} onClick={reload}>
                Retry
              </button>
            </div>
          ) : (
            <>
              <div className="mono" style={{ fontSize: '1rem', fontWeight: 500 }}>
                {asset?.code ?? 'Loading…'}
              </div>
              <div className="helper">
                Walked {directionText(measurement.direction)} &middot;{' '}
                {measurement.source === 'gps' ? 'GPS distance' : 'point marks'}. The asset was chosen on the setup screen.
              </div>
            </>
          )}
        </section>

        <ConditionSection
          value={severity}
          suggested={classified}
          edited={severityEdit !== null}
          onChange={setSeverityEdit}
          hint="This is the condition of the strongest mark. The other marks are classified from their own value."
        />
        <NoteField value={note} onChange={setNote} />
      </div>

      <SaveBar error={error} saving={saving} disabled={!canSave} onSave={save} />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

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
  return measurement.value.kind === 'tracking' ? (
    <TrackingTag measurement={measurement.value} />
  ) : (
    <SpotTag measurement={measurement.value} />
  );
}
