import { describe, expect, it } from 'vitest';

import type { SavedSurvey, SpotMeasurement, TrackingDraft } from './model';
import { createMemoryStore } from './store';

const survey = (id: string, createdAt: number): SavedSurvey => ({
  id,
  createdAt,
  mode: 'spot',
  assetId: 'a1',
  assetCode: 'SUTM-PKL-02-1',
  lineType: 'SUTM',
  severity: 'warning',
  peakDbmV: 26.7,
  peakLabel: null,
  payload: {
    surveyor: 'operator@example.com',
    points: [{ latitude: -6.8886, longitude: 109.6753, pd_magnitude: 26.7, pd_unit: 'dBmV', severity: 'warning' }],
  },
  upload: { state: 'saved', surveyId: null, message: null, attempts: 0 },
});

const measurement: SpotMeasurement = {
  kind: 'spot',
  id: 'm1',
  recordedAt: 1,
  durationS: 10,
  peakDbmV: 26.7,
  rateHz: 248,
  noiseDbmV: 5.9,
  fix: null,
};

describe('the local store', () => {
  it('keeps the operator until sign-out', async () => {
    const store = createMemoryStore();
    expect(await store.getOperator()).toBeNull();
    await store.setOperator('operator@example.com');
    expect(await store.getOperator()).toBe('operator@example.com');
    await store.clearOperator();
    expect(await store.getOperator()).toBeNull();
  });

  it('keeps the values from the Cantol label, through sign-out, until everything is erased', async () => {
    const store = createMemoryStore();
    const label = { ssid: 'CANTOL-1234', password: 'secret-pass-1', mac: '00:26:32:F0:1A:BC' };
    expect(await store.getCantolSetup()).toBeNull();
    await store.saveCantolSetup(label);
    await store.setOperator('operator@example.com');
    await store.clearOperator();
    expect(await store.getCantolSetup()).toEqual(label);
    // What is read back is a copy: changing it does not change what is stored.
    const copy = await store.getCantolSetup();
    if (copy) copy.ssid = 'changed';
    expect((await store.getCantolSetup())?.ssid).toBe('CANTOL-1234');
    await store.resetAll();
    expect(await store.getCantolSetup()).toBeNull();
  });

  it('lists surveys newest first', async () => {
    const store = createMemoryStore();
    await store.saveSurvey(survey('old', 100));
    await store.saveSurvey(survey('new', 300));
    await store.saveSurvey(survey('mid', 200));
    expect((await store.listSurveys()).map((s) => s.id)).toEqual(['new', 'mid', 'old']);
  });

  it('changes only the upload status of a saved survey, never its content', async () => {
    const store = createMemoryStore();
    const original = survey('s1', 100);
    await store.saveSurvey(original);
    await store.recordUpload('s1', { state: 'failed', surveyId: null, message: 'HTTP 500', attempts: 1 });
    await store.recordUpload('s1', { state: 'uploaded', surveyId: 'srv-1', message: null, attempts: 2 });
    const [stored] = await store.listSurveys();
    expect(stored?.upload).toEqual({ state: 'uploaded', surveyId: 'srv-1', message: null, attempts: 2 });
    expect({ ...stored, upload: original.upload }).toEqual(original);
  });

  it('ignores an upload result for a survey it does not have', async () => {
    const store = createMemoryStore();
    await store.recordUpload('missing', { state: 'uploaded', surveyId: 'x', message: null, attempts: 1 });
    expect(await store.listSurveys()).toEqual([]);
  });

  it('stages a recording and removes it once it has become a survey', async () => {
    const store = createMemoryStore();
    await store.saveMeasurement(measurement);
    expect(await store.getMeasurement('m1')).toEqual(measurement);
    await store.deleteMeasurement('m1');
    expect(await store.getMeasurement('m1')).toBeNull();
  });

  it('does not let a later change to an object alter what was stored', async () => {
    const store = createMemoryStore();
    const s = survey('s1', 1);
    await store.saveSurvey(s);
    s.payload.surveyor = 'someone else';
    expect((await store.listSurveys())[0]?.payload.surveyor).toBe('operator@example.com');
  });

  it('keeps one tracking draft and clears it', async () => {
    const store = createMemoryStore();
    const draft: TrackingDraft = {
      id: 'current',
      assetId: 'a1',
      direction: 'AB',
      source: 'marks',
      warningLevelDbmV: 30,
      startedAt: 1,
      updatedAt: 2,
      marks: [],
    };
    expect(await store.getDraft()).toBeNull();
    await store.saveDraft(draft);
    expect(await store.getDraft()).toEqual(draft);
    await store.clearDraft();
    expect(await store.getDraft()).toBeNull();
  });

  it('erases everything on reset', async () => {
    const store = createMemoryStore();
    await store.setOperator('operator@example.com');
    await store.saveSurvey(survey('s1', 1));
    await store.saveMeasurement(measurement);
    await store.resetAll();
    expect(await store.getOperator()).toBeNull();
    expect(await store.listSurveys()).toEqual([]);
    expect(await store.getMeasurement('m1')).toBeNull();
  });
});
