import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { buildDemoLines } from '../demo/fixtures';
import { nodeDsp } from '../test/dspNode';
import type { SpotMeasurement, TrackMark, TrackingMeasurement } from './model';
import { buildSpotPayload, buildTrackingPayload, NOTES_MAX, trackingPeak } from './payload';

/**
 * Hand copy of `pdSurveySchema` in `backend/src/validation.ts` (zod 4), the contract the API
 * enforces. Keep it in step with that file. The backend writes `z.string().datetime()`, `.uuid()`
 * and `.url()`; the deprecated aliases are spelled `z.iso.datetime()`, `z.uuid()` and `z.url()`
 * here, with the same meaning. `.strict()` is added so an unknown field fails the test, which the
 * backend would silently strip.
 */
const pdSurveySchema = z
  .object({
    surveyor: z.string().min(1, 'surveyor is required').max(120),
    surveyed_at: z.iso.datetime().optional(),
    notes: z.string().max(2000).optional(),
    points: z
      .array(
        z
          .object({
            measurement_point_id: z.uuid().optional(),
            sequence_no: z.number().int().optional(),
            point_label: z.string().max(120).optional(),
            latitude: z.number().min(-90).max(90),
            longitude: z.number().min(-180).max(180),
            pd_magnitude: z.number().optional(),
            pd_unit: z.string().max(20).optional(),
            temperature_c: z.number().optional(),
            ambient_temp_c: z.number().optional(),
            severity: z.enum(['normal', 'warning', 'critical']).optional(),
            pd_device: z.string().max(120).optional(),
            photo_url: z.url().max(2000).optional(),
          })
          .strict(),
      )
      .min(1, 'at least one point is required'),
  })
  .strict();

const dsp = nodeDsp();
const lines = buildDemoLines();
const asset = lines.find((l) => l.code === 'SUTM-PKL-02-1') ?? (() => { throw new Error('fixture missing'); })();
const p2 = asset.points[1] ?? (() => { throw new Error('fixture missing'); })();

const RECORDED = Date.UTC(2026, 9, 21, 4, 12, 9);
const fix = { latitude: -6.8891, longitude: 109.6759, accuracyM: 4, at: RECORDED };

const spot: SpotMeasurement = {
  kind: 'spot',
  id: 'm1',
  recordedAt: RECORDED,
  durationS: 60,
  peakDbmV: 33.4,
  rateHz: 312,
  noiseDbmV: 6.1,
  fix,
};

function hasNull(value: unknown): boolean {
  if (value === null) return true;
  if (Array.isArray(value)) return value.some(hasNull);
  if (typeof value === 'object') return Object.values(value as Record<string, unknown>).some(hasNull);
  return false;
}

describe('spot survey payload', () => {
  const base = { operator: 'operator@example.com', measurement: spot, point: p2, severity: 'warning' as const, note: '', temperatureC: null, pdDevice: 'Cantol-Mobile V1' };

  it('matches the example in mobile-ui-spec.md section 5 and the backend schema', () => {
    const body = buildSpotPayload(base);
    expect(pdSurveySchema.safeParse(body).success).toBe(true);
    expect(body).toEqual({
      surveyor: 'operator@example.com',
      surveyed_at: '2026-10-21T04:12:09.000Z',
      notes: 'Spot reading, 60 s window.',
      points: [
        {
          measurement_point_id: p2.id,
          sequence_no: 2,
          point_label: p2.label,
          latitude: -6.8891,
          longitude: 109.6759,
          pd_magnitude: 33.4,
          pd_unit: 'dBmV',
          severity: 'warning',
          pd_device: 'Cantol-Mobile V1',
        },
      ],
    });
  });

  it('omits optional fields instead of sending null, and survives a JSON round trip', () => {
    const body = buildSpotPayload(base);
    expect(hasNull(body)).toBe(false);
    expect('temperature_c' in (body.points[0] ?? {})).toBe(false);
    expect('photo_url' in (body.points[0] ?? {})).toBe(false);
    expect(pdSurveySchema.safeParse(JSON.parse(JSON.stringify(body))).success).toBe(true);
  });

  it('includes the temperature when the operator entered one, and the operator note', () => {
    const body = buildSpotPayload({ ...base, temperatureC: 31.5, note: ' Hot day, dry. ' });
    expect(pdSurveySchema.safeParse(body).success).toBe(true);
    expect(body.points[0]?.temperature_c).toBe(31.5);
    expect(body.notes).toBe('Spot reading, 60 s window. Hot day, dry.');
  });

  it('states the real window length, so a short demo recording is not called 60 s', () => {
    expect(buildSpotPayload({ ...base, measurement: { ...spot, durationS: 10 } }).notes).toBe('Spot reading, 10 s window.');
  });

  it('keeps notes within the 2000 character limit', () => {
    const body = buildSpotPayload({ ...base, note: 'x'.repeat(5000) });
    expect(body.notes?.length).toBe(NOTES_MAX);
    expect(pdSurveySchema.safeParse(body).success).toBe(true);
  });

  it('rounds the magnitude to two decimals and refuses to save without a fix', () => {
    expect(buildSpotPayload({ ...base, measurement: { ...spot, peakDbmV: 33.456789 } }).points[0]?.pd_magnitude).toBe(33.46);
    expect(() => buildSpotPayload({ ...base, measurement: { ...spot, fix: null } })).toThrow(/location fix/);
  });

  it('rejects an empty surveyor, as the API would', () => {
    expect(pdSurveySchema.safeParse(buildSpotPayload({ ...base, operator: '' })).success).toBe(false);
  });
});

function mark(station: number, label: TrackMark['label'], value: number, at: number): TrackMark {
  return { station, label, valueDbmV: value, chainageM: null, at, fix: { ...fix, at } };
}

const walk: TrackingMeasurement = {
  kind: 'tracking',
  id: 'w1',
  assetId: asset.id,
  direction: 'AB',
  source: 'marks',
  recordedAt: RECORDED,
  marks: [mark(0, 'Pole A', 7, 1), mark(1, 'P1', 14, 2), mark(2, 'P2', 27, 3), mark(3, 'P3', 14.2, 4), mark(4, 'Pole B', 7.1, 5)],
};

describe('tracking survey payload', () => {
  const base = { operator: 'operator@example.com', asset, points: asset.points, dsp, note: '', pdDevice: 'Cantol-Mobile V1' };

  it('is one ordinary survey with a point per mark, in walk order', () => {
    const body = buildTrackingPayload({ ...base, measurement: walk });
    expect(pdSurveySchema.safeParse(body).success).toBe(true);
    expect(hasNull(body)).toBe(false);
    expect(body.points.map((p) => p.sequence_no)).toEqual([1, 2, 3, 4, 5]);
    expect(body.points.map((p) => p.point_label)).toEqual(['Pole A', asset.points[0]?.label, asset.points[1]?.label, asset.points[2]?.label, 'Pole B']);
    expect(body.notes).toBe('Tracking mode, A to B, peak P2 27 dBmV.');
  });

  it('ties only P1 to P3 to measurement points; the poles carry no id', () => {
    const body = buildTrackingPayload({ ...base, measurement: walk });
    expect(body.points.map((p) => p.measurement_point_id)).toEqual([undefined, asset.points[0]?.id, asset.points[1]?.id, asset.points[2]?.id, undefined]);
    expect('measurement_point_id' in (body.points[0] ?? {})).toBe(false);
  });

  it('classifies every mark with the WASM, and lets the operator override the peak only', () => {
    const body = buildTrackingPayload({ ...base, measurement: walk });
    expect(body.points.map((p) => p.severity)).toEqual(['normal', 'normal', 'warning', 'normal', 'normal']);
    const edited = buildTrackingPayload({ ...base, measurement: walk, peakSeverity: 'critical' });
    expect(edited.points.map((p) => p.severity)).toEqual(['normal', 'normal', 'critical', 'normal', 'normal']);
  });

  it('reverses the order for B to A while labels and ids stay on their stations', () => {
    const reversed: TrackingMeasurement = { ...walk, direction: 'BA', marks: [...walk.marks].reverse() };
    const body = buildTrackingPayload({ ...base, measurement: reversed });
    expect(body.points.map((p) => p.point_label)).toEqual(['Pole B', asset.points[2]?.label, asset.points[1]?.label, asset.points[0]?.label, 'Pole A']);
    expect(body.points[1]?.measurement_point_id).toBe(asset.points[2]?.id);
    expect(body.notes?.startsWith('Tracking mode, B to A')).toBe(true);
  });

  it('allows a walk that skipped a station, and refuses one with no marks', () => {
    const skipped: TrackingMeasurement = { ...walk, marks: [walk.marks[0], walk.marks[2], walk.marks[4]].filter((m): m is TrackMark => m !== undefined) };
    const body = buildTrackingPayload({ ...base, measurement: skipped });
    expect(body.points).toHaveLength(3);
    expect(pdSurveySchema.safeParse(body).success).toBe(true);
    expect(() => buildTrackingPayload({ ...base, measurement: { ...walk, marks: [] } })).toThrow(/no marks/);
  });

  it('falls back to the station coordinates when a mark has no GPS fix', () => {
    const noFix: TrackingMeasurement = { ...walk, marks: walk.marks.map((m) => ({ ...m, fix: null })) };
    const body = buildTrackingPayload({ ...base, measurement: noFix });
    expect(body.points[0]?.latitude).toBe(asset.pole_a.latitude);
    expect(body.points[1]?.latitude).toBe(asset.points[0]?.latitude);
    expect(body.points[4]?.longitude).toBe(asset.pole_b.longitude);
    expect(pdSurveySchema.safeParse(body).success).toBe(true);
  });

  it('finds the strongest mark through the WASM', () => {
    const peak = trackingPeak(walk.marks, dsp);
    expect(peak?.mark.label).toBe('P2');
    expect(peak?.index).toBe(2);
    expect(trackingPeak([], dsp)).toBeNull();
  });
});
