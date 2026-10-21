/**
 * Saving and uploading surveys (`mobile-ui-spec.md` section 5). A survey is written to the
 * local store first and is never edited afterwards; only its upload status changes. The upload
 * is one manual attempt after Save, and a manual Retry on failure. There is no automatic retry:
 * until TASK-008 every server error is HTTP 500 and a retry could create a duplicate survey.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import type { SavedSurvey } from '../core/model';
import { useServices } from './services';

interface SurveysValue {
  /** Bumped after every change, so lists know to reload. */
  version: number;
  /** Ids of surveys being uploaded right now. */
  uploading: ReadonlySet<string>;
  /** Stores the survey, removes the staged recording, then makes one upload attempt (not awaited). */
  saveAndUpload: (survey: SavedSurvey, stagedMeasurementId: string) => Promise<void>;
  retry: (survey: SavedSurvey) => void;
}

const SurveysContext = createContext<SurveysValue | null>(null);

export function SurveysProvider({ children }: { children: ReactNode }) {
  const { store, api } = useServices();
  const [version, setVersion] = useState(0);
  const [uploading, setUploading] = useState<ReadonlySet<string>>(new Set());

  const bump = useCallback(() => {
    setVersion((v) => v + 1);
  }, []);

  const upload = useCallback(
    async (survey: SavedSurvey) => {
      setUploading((current) => new Set(current).add(survey.id));
      const attempts = survey.upload.attempts + 1;
      let next: SavedSurvey['upload'];
      try {
        const result = await api.uploadSurvey(survey.assetId, survey.payload);
        next =
          result.status === 201
            ? { state: 'uploaded', surveyId: result.surveyId, message: null, attempts }
            : {
                state: 'failed',
                surveyId: null,
                message: result.message ?? `The server answered ${String(result.status)}.`,
                attempts,
              };
      } catch {
        next = {
          state: 'failed',
          surveyId: null,
          message: 'No answer from the server. Check the connection, then retry.',
          attempts,
        };
      }
      await store.recordUpload(survey.id, next);
      setUploading((current) => {
        const copy = new Set(current);
        copy.delete(survey.id);
        return copy;
      });
      bump();
    },
    [api, store, bump],
  );

  const saveAndUpload = useCallback(
    async (survey: SavedSurvey, stagedMeasurementId: string) => {
      await store.saveSurvey(survey);
      await store.deleteMeasurement(stagedMeasurementId);
      bump();
      void upload(survey);
    },
    [store, upload, bump],
  );

  const retry = useCallback(
    (survey: SavedSurvey) => {
      void upload(survey);
    },
    [upload],
  );

  const value = useMemo(() => ({ version, uploading, saveAndUpload, retry }), [version, uploading, saveAndUpload, retry]);
  return <SurveysContext.Provider value={value}>{children}</SurveysContext.Provider>;
}

export function useSurveys(): SurveysValue {
  const value = useContext(SurveysContext);
  if (!value) throw new Error('useSurveys must be used inside SurveysProvider');
  return value;
}
