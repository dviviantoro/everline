/**
 * Screen 8: surveys saved on this phone (`mobile-ui-spec.md` section 3.9). Each survey is Saved,
 * Uploaded or Failed; a failed (or still unsent) one has a manual Retry. There is no "waiting to
 * sync" banner or "Sync now": that is the offline queue of a later phase (TASK-009). History of
 * surveys on the server is not shown here; that is the dashboard's job.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router';

import { useServices } from '../app/services';
import { useSurveys } from '../app/surveys';
import { formatDbmV, formatWhen } from '../core/format';
import type { SavedSurvey } from '../core/model';
import { LINE_KIND_LABEL, SEVERITY_LABEL, type Severity } from '../core/types';
import { AlertIcon, CheckIcon, ClockIcon } from '../ui/icons';
import { BottomNav } from '../ui/BottomNav';
import { Pill, TopBar, type PillTone } from '../ui/primitives';

const TONE: Record<Severity, PillTone> = { normal: 'ok', warning: 'warn', critical: 'crit' };

function Status({ survey, uploading, uploadedLabel }: { survey: SavedSurvey; uploading: boolean; uploadedLabel: string }) {
  const row = { display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8125rem', fontWeight: 600 } as const;
  if (uploading) {
    return (
      <div style={{ ...row, color: 'var(--cyan-text)' }} role="status">
        <ClockIcon size={16} />
        Uploading&hellip;
      </div>
    );
  }
  switch (survey.upload.state) {
    case 'uploaded':
      return (
        <div style={{ ...row, color: 'var(--ok-text)' }}>
          <CheckIcon size={16} />
          {uploadedLabel}
        </div>
      );
    case 'failed':
      return (
        <div style={{ ...row, color: 'var(--crit-text)' }}>
          <AlertIcon size={16} />
          Upload failed
        </div>
      );
    case 'saved':
      return (
        <div style={{ ...row, color: 'var(--warn-text)' }}>
          <ClockIcon size={16} />
          Saved on this phone
        </div>
      );
  }
}

export function SurveysScreen() {
  const { store, config, now } = useServices();
  const { version, uploading, retry } = useSurveys();
  const [surveys, setSurveys] = useState<SavedSurvey[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    void store
      .listSurveys()
      .then((list) => {
        if (!alive) return;
        setSurveys(list);
        setFailed(false);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [store, version]);

  const t = now();

  return (
    <div className="screen screen-tabbed">
      <TopBar />
      <h1 className="title title-md" style={{ marginTop: 14 }}>
        Every reading, <span className="accent">on record.</span>
      </h1>

      <div className="screen-body" style={{ paddingTop: 16, gap: 12 }}>
        {failed ? (
          <p role="alert" style={{ margin: 0, color: 'var(--crit-text)' }}>
            The surveys could not be read from this phone.
          </p>
        ) : surveys === null ? (
          <p className="helper" role="status">
            Loading&hellip;
          </p>
        ) : surveys.length === 0 ? (
          <section className="card">
            <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>No surveys yet</h2>
            <p className="helper" style={{ margin: '6px 0 14px', fontSize: '0.875rem', lineHeight: 1.5 }}>
              A survey you save appears here, with whether it has been uploaded.
            </p>
            <Link to="/live" className="btn btn-secondary btn-sm">
              Take a reading
            </Link>
          </section>
        ) : (
          surveys.map((survey) => (
            <article key={survey.id} className="card stack" style={{ gap: 8, padding: '14px 16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <div className="mono" style={{ fontSize: '1rem', fontWeight: 500, overflowWrap: 'anywhere' }}>
                  {survey.assetCode}
                </div>
                <Pill tone={TONE[survey.severity]}>{SEVERITY_LABEL[survey.severity]}</Pill>
              </div>
              <div style={{ fontSize: '0.875rem', color: 'var(--muted)' }}>
                {LINE_KIND_LABEL[survey.lineType]} &middot; {survey.mode === 'tracking' ? 'Tracking' : 'Spot'} &middot;{' '}
                {formatWhen(survey.createdAt, t)} &middot; peak {formatDbmV(survey.peakDbmV)} dBmV
                {survey.peakLabel ? ` at ${survey.peakLabel}` : ''}
              </div>
              <Status survey={survey} uploading={uploading.has(survey.id)} uploadedLabel={config.uploadedLabel} />
              {survey.upload.state === 'failed' && survey.upload.message ? (
                <p style={{ margin: 0, fontSize: '0.8125rem', lineHeight: 1.5, color: 'var(--muted)' }}>{survey.upload.message}</p>
              ) : null}
              {survey.upload.state !== 'uploaded' && !uploading.has(survey.id) ? (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  style={{ minHeight: 44, alignSelf: 'flex-start' }}
                  onClick={() => {
                    retry(survey);
                  }}
                >
                  {survey.upload.state === 'failed' ? 'Retry' : 'Upload'}
                </button>
              ) : null}
            </article>
          ))
        )}
      </div>

      <BottomNav />
    </div>
  );
}
