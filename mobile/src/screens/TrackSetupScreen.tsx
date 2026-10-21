/**
 * Screen 6b: tracking setup (`mobile-tracking-mode.md` section 4). Pick the line, the direction,
 * where the position comes from, the warning level and whether to play a sound cue. Start is
 * disabled until Cantol is streaming and there is a GPS fix. An unfinished walk can be resumed.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';

import { useServices } from '../app/services';
import { useGpsFix, useWizard } from '../app/wizard';
import { useLineAssets } from '../app/useLineAssets';
import { nearestAsset } from '../core/assets';
import { unlockAudio } from '../core/audio';
import { formatDbmV } from '../core/format';
import type { PositionSource, TrackingDraft, WalkDirection } from '../core/model';
import { GPS_MAX_ACCURACY_M, WARNING_PRESETS_DBMV } from '../core/tracking';
import type { LineAssetWithPoles, LineType } from '../core/types';
import { AssetPicker } from '../ui/AssetPicker';
import { CheckIcon } from '../ui/icons';
import { BackButton, Segmented, Switch, TopBar } from '../ui/primitives';

const NO_ASSETS: readonly LineAssetWithPoles[] = [];
const shortPole = (label: string | null): string => (label ?? '').replace(/^Tiang\s+/i, '');

export function TrackSetupScreen() {
  const { link, store } = useServices();
  const wizard = useWizard();
  const fix = useGpsFix();
  const navigate = useNavigate();
  const { assets, reload } = useLineAssets();
  const list = assets.status === 'ready' ? assets.value : NO_ASSETS;
  const nearest = useMemo(() => nearestAsset(list, fix), [list, fix]);

  const [chosenKind, setChosenKind] = useState<LineType | null>(null);
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const kind = chosenKind ?? nearest?.line_type ?? 'SUTM';
  const picked = list.find((a) => a.id === (chosenId ?? nearest?.id));
  const asset = picked && picked.line_type === kind ? picked : null;

  const [direction, setDirection] = useState<WalkDirection>('AB');
  const [source, setSource] = useState<PositionSource>('marks');
  const [warning, setWarning] = useState<number>(30);
  const [sound, setSound] = useState(false);
  const [noise, setNoise] = useState<number | null>(null);
  const [draft, setDraft] = useState<TrackingDraft | null>(null);

  // The stream runs on this screen so the status strip is real.
  const { streaming } = wizard.state;
  const { startMeasurement } = wizard;
  useEffect(() => {
    if (!streaming) void startMeasurement();
  }, [streaming, startMeasurement]);

  useEffect(
    () =>
      link.subscribe({
        onEvents: () => undefined,
        onStatus: (status) => {
          setNoise(status.noiseFloorDbmV);
        },
        onLinkState: () => undefined,
      }),
    [link],
  );

  useEffect(() => {
    let alive = true;
    void store
      .getDraft()
      .then((found) => {
        if (alive) setDraft(found);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [store]);

  const ready = wizard.state.cantol === 'linked' && streaming && fix !== null && asset !== null;
  const gpsTooRough = source === 'gps' && fix !== null && fix.accuracyM > GPS_MAX_ACCURACY_M;
  const effectiveSource: PositionSource = gpsTooRough ? 'marks' : source;

  const open = (found: LineAssetWithPoles | { id: string }, options: { dir: WalkDirection; src: PositionSource; warn: number; sound: boolean; resume: boolean }) => {
    const query = new URLSearchParams({
      asset: found.id,
      dir: options.dir,
      src: options.src,
      warn: String(options.warn),
      sound: options.sound ? '1' : '0',
    });
    if (options.resume) query.set('resume', '1');
    void navigate(`/track?${query.toString()}`);
  };

  const start = () => {
    if (!asset || !ready) return;
    if (sound) unlockAudio();
    open(asset, { dir: direction, src: effectiveSource, warn: warning, sound, resume: false });
  };

  const resume = () => {
    if (!draft) return;
    open({ id: draft.assetId }, { dir: draft.direction, src: draft.source, warn: draft.warningLevelDbmV, sound: false, resume: true });
  };

  const directionOptions: { value: WalkDirection; label: string }[] = asset
    ? [
        { value: 'AB', label: `${shortPole(asset.pole_a.label)} to ${shortPole(asset.pole_b.label)}` },
        { value: 'BA', label: `${shortPole(asset.pole_b.label)} to ${shortPole(asset.pole_a.label)}` },
      ]
    : [
        { value: 'AB', label: 'A to B' },
        { value: 'BA', label: 'B to A' },
      ];

  const draftAsset = draft ? list.find((a) => a.id === draft.assetId) : undefined;

  return (
    <div className="screen">
      <TopBar start={<BackButton label="Live" />} />
      <h1 className="title title-md">
        Tracking <span className="accent">mode</span>
      </h1>
      <p className="lead" style={{ marginTop: 10, fontSize: '0.875rem', lineHeight: 1.55 }}>
        Walk the sensor along the line or cable. EverLine logs the level at each station and shows whether it is rising or falling.
      </p>

      {draft && draft.marks.length > 0 ? (
        <section className="banner" style={{ marginTop: 16 }} aria-label="Unfinished walk">
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600 }}>Unfinished walk</div>
            <div style={{ fontSize: '0.8125rem' }}>
              {draftAsset?.code ?? 'A line'} &middot; {String(draft.marks.length)} of 5 stations marked
            </div>
          </div>
          <div className="stack" style={{ gap: 6 }}>
            <button type="button" className="btn btn-primary btn-sm" style={{ minHeight: 44 }} onClick={resume}>
              Resume
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              style={{ minHeight: 44 }}
              onClick={() => {
                void store.clearDraft().then(() => {
                  setDraft(null);
                });
              }}
            >
              Discard
            </button>
          </div>
        </section>
      ) : null}

      <section className="card stack" style={{ marginTop: 18, gap: 16 }}>
        <div className="stack" style={{ gap: 8 }}>
          <div className="field-label">Asset</div>
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
            selectedId={asset?.id ?? null}
            onSelect={setChosenId}
          />
        </div>

        <div className="stack" style={{ gap: 6 }}>
          <div className="field-label">Direction</div>
          <Segmented label="Direction" options={directionOptions} value={direction} onChange={setDirection} />
        </div>

        <div className="stack" style={{ gap: 6 }}>
          <div className="field-label">Position</div>
          <Segmented
            label="Position"
            options={[
              { value: 'marks' as const, label: 'Point marks' },
              { value: 'gps' as const, label: 'GPS distance' },
            ]}
            value={source}
            onChange={setSource}
          />
          <div className="helper">
            {source === 'marks'
              ? 'Tap Mark station at each pole and measurement point you pass.'
              : 'Stations are marked for you when you stay within 5 m of one for a few seconds. You can still tap Mark station.'}
          </div>
          {gpsTooRough ? (
            <div className="helper" role="status" style={{ color: 'var(--warn-text)' }}>
              GPS accuracy is about {String(Math.round(fix.accuracyM))} m, worse than the {String(GPS_MAX_ACCURACY_M)} m this needs, so this walk uses point
              marks.
            </div>
          ) : null}
        </div>

        <div className="stack" style={{ gap: 6 }}>
          <div className="field-label">Warning level</div>
          <div className="opt-grid" role="group" aria-label="Warning level">
            {WARNING_PRESETS_DBMV.map((level) => (
              <button
                key={level}
                type="button"
                className="opt mono"
                aria-pressed={level === warning}
                onClick={() => {
                  setWarning(level);
                }}
              >
                {String(level)} dBmV
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ fontSize: '0.9375rem', fontWeight: 500 }}>Sound cue</div>
            <div className="helper" style={{ marginTop: 2 }}>
              Pitch rises with the level
            </div>
          </div>
          <Switch checked={sound} onChange={setSound} label="Sound cue" />
        </div>
      </section>

      <section className="card" style={{ marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 16px' }}>
        <span
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: '0.875rem', fontWeight: 500, color: streaming ? 'var(--ok-text)' : 'var(--warn-text)' }}
          role="status"
        >
          {streaming ? <CheckIcon size={16} /> : null}
          {streaming ? 'Cantol streaming' : 'Starting the stream'}
        </span>
        <span className="mono helper" style={{ fontSize: '0.75rem' }}>
          Noise {noise === null ? '—' : `${formatDbmV(noise)} dBmV`}
        </span>
      </section>

      <div className="pinned">
        <button type="button" className="btn btn-primary" disabled={!ready} onClick={start}>
          Start tracking
        </button>
        {!ready ? (
          <div className="helper" style={{ textAlign: 'center' }}>
            {asset === null ? 'Choose a line to start.' : fix === null ? 'Waiting for a GPS fix.' : 'Waiting for the Cantol stream.'}
          </div>
        ) : null}
      </div>
    </div>
  );
}
