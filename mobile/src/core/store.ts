/**
 * What the app keeps on the phone, behind an interface so the screens and the tests do not care
 * whether it is IndexedDB (Dexie) or memory.
 *
 * Insert-only in spirit (`mobile-ui-spec.md` section 1): a saved survey's content is never
 * edited or deleted by the app. Only its local upload status changes after a try.
 */
import type { Measurement, SavedSurvey, TrackingDraft } from './model';

export interface AppStore {
  /** The sign-in email, sent as `surveyor` on every survey. */
  getOperator(): Promise<string | null>;
  setOperator(email: string): Promise<void>;
  clearOperator(): Promise<void>;

  /** A recording waiting to be tagged. */
  saveMeasurement(measurement: Measurement): Promise<void>;
  getMeasurement(id: string): Promise<Measurement | null>;
  /** Removes the staged recording once it has become a saved survey. */
  deleteMeasurement(id: string): Promise<void>;

  saveSurvey(survey: SavedSurvey): Promise<void>;
  /** Records the outcome of an upload attempt. The survey's content is untouched. */
  recordUpload(id: string, upload: SavedSurvey['upload']): Promise<void>;
  /** Newest first. */
  listSurveys(): Promise<SavedSurvey[]>;

  getDraft(): Promise<TrackingDraft | null>;
  saveDraft(draft: TrackingDraft): Promise<void>;
  clearDraft(): Promise<void>;

  /** Erases everything (demo "reset all data"). */
  resetAll(): Promise<void>;
}

/** In-memory store for unit tests. */
export function createMemoryStore(): AppStore {
  let operator: string | null = null;
  let measurements = new Map<string, Measurement>();
  let surveys = new Map<string, SavedSurvey>();
  let draft: TrackingDraft | null = null;

  return {
    getOperator: () => Promise.resolve(operator),
    setOperator: (email) => {
      operator = email;
      return Promise.resolve();
    },
    clearOperator: () => {
      operator = null;
      return Promise.resolve();
    },
    saveMeasurement: (m) => {
      measurements.set(m.id, structuredClone(m));
      return Promise.resolve();
    },
    getMeasurement: (id) => Promise.resolve(structuredClone(measurements.get(id) ?? null)),
    deleteMeasurement: (id) => {
      measurements.delete(id);
      return Promise.resolve();
    },
    saveSurvey: (s) => {
      surveys.set(s.id, structuredClone(s));
      return Promise.resolve();
    },
    recordUpload: (id, upload) => {
      const existing = surveys.get(id);
      if (existing) surveys.set(id, { ...existing, upload: { ...upload } });
      return Promise.resolve();
    },
    listSurveys: () =>
      Promise.resolve([...surveys.values()].sort((a, b) => b.createdAt - a.createdAt).map((s) => structuredClone(s))),
    getDraft: () => Promise.resolve(structuredClone(draft)),
    saveDraft: (d) => {
      draft = structuredClone(d);
      return Promise.resolve();
    },
    clearDraft: () => {
      draft = null;
      return Promise.resolve();
    },
    resetAll: () => {
      operator = null;
      measurements = new Map();
      surveys = new Map();
      draft = null;
      return Promise.resolve();
    },
  };
}
