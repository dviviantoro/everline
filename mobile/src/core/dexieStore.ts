/** The real store: IndexedDB through Dexie. It survives the app being closed and reopened. */
import Dexie, { type EntityTable } from 'dexie';

import type { Measurement, SavedSurvey, TrackingDraft } from './model';
import type { AppStore } from './store';

interface SettingRow {
  key: string;
  value: string;
}

const OPERATOR_KEY = 'operator';
const DRAFT_ID = 'current';

type AppDb = Dexie & {
  settings: EntityTable<SettingRow, 'key'>;
  measurements: EntityTable<Measurement, 'id'>;
  surveys: EntityTable<SavedSurvey, 'id'>;
  drafts: EntityTable<TrackingDraft, 'id'>;
};

export function createDexieStore(databaseName = 'everline-mobile'): AppStore {
  const db = new Dexie(databaseName) as AppDb;
  db.version(1).stores({
    settings: 'key',
    measurements: 'id',
    surveys: 'id, createdAt',
    drafts: 'id',
  });

  return {
    getOperator: async () => (await db.settings.get(OPERATOR_KEY))?.value ?? null,
    setOperator: async (email) => {
      await db.settings.put({ key: OPERATOR_KEY, value: email });
    },
    clearOperator: async () => {
      await db.settings.delete(OPERATOR_KEY);
    },
    saveMeasurement: async (m) => {
      await db.measurements.put(m);
    },
    getMeasurement: async (id) => (await db.measurements.get(id)) ?? null,
    deleteMeasurement: async (id) => {
      await db.measurements.delete(id);
    },
    saveSurvey: async (s) => {
      await db.surveys.add(s);
    },
    recordUpload: async (id, upload) => {
      await db.surveys.update(id, { upload });
    },
    listSurveys: async () => db.surveys.orderBy('createdAt').reverse().toArray(),
    getDraft: async () => (await db.drafts.get(DRAFT_ID)) ?? null,
    saveDraft: async (d) => {
      await db.drafts.put({ ...d, id: DRAFT_ID });
    },
    clearDraft: async () => {
      await db.drafts.delete(DRAFT_ID);
    },
    resetAll: async () => {
      await Promise.all([db.settings.clear(), db.measurements.clear(), db.surveys.clear(), db.drafts.clear()]);
    },
  };
}
