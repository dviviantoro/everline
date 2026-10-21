/**
 * Builds the body of `POST /api/assets/{id}/pd-surveys` (`mobile-ui-spec.md` section 5 and
 * `mobile-tracking-mode.md` section 5). Optional fields are omitted, never null. The shape is
 * checked against a copy of the backend schema in `payload.test.ts`.
 */
import type { Dsp } from './dsp';
import type {
  SpotMeasurement,
  StationLabel,
  SurveyPayload,
  SurveyPointPayload,
  TrackMark,
  TrackingMeasurement,
} from './model';
import type { LineAssetWithPoles, MeasurementPoint, Severity } from './types';

/** `pd_unit`: the unit the API, the seed data and the dashboard use. */
export const PD_UNIT = 'dBmV';
/** `notes` is at most 2000 characters in `pdSurveySchema`. */
export const NOTES_MAX = 2000;
/** What the Tag screen lets the operator type, leaving room for the generated prefix. */
export const NOTE_INPUT_MAX = 1500;

const round2 = (value: number): number => Math.round(value * 100) / 100;

function joinNotes(prefix: string, note: string): string {
  const extra = note.trim();
  return (extra === '' ? prefix : `${prefix} ${extra}`).slice(0, NOTES_MAX);
}

export interface SpotPayloadInput {
  /** The sign-in email: sent as `surveyor`. */
  operator: string;
  measurement: SpotMeasurement;
  /** The measurement point the reading belongs to: only a point with an id feeds its history. */
  point: MeasurementPoint;
  severity: Severity;
  note: string;
  /** Operator-entered asset temperature, not Cantol's board temperature. */
  temperatureC: number | null;
  pdDevice: string;
}

export function buildSpotPayload(input: SpotPayloadInput): SurveyPayload {
  const { measurement, point } = input;
  if (measurement.fix === null) throw new Error('A survey needs a location fix.');
  const body: SurveyPointPayload = {
    measurement_point_id: point.id,
    sequence_no: point.sequence_no,
    point_label: point.label,
    latitude: measurement.fix.latitude,
    longitude: measurement.fix.longitude,
    pd_magnitude: round2(measurement.peakDbmV),
    pd_unit: PD_UNIT,
    severity: input.severity,
    pd_device: input.pdDevice,
  };
  if (input.temperatureC !== null) body.temperature_c = input.temperatureC;
  return {
    surveyor: input.operator,
    surveyed_at: new Date(measurement.recordedAt).toISOString(),
    notes: joinNotes(`Spot reading, ${String(measurement.durationS)} s window.`, input.note),
    points: [body],
  };
}

/** Labels of the five stations in A to B order. */
export const STATION_LABELS: readonly StationLabel[] = ['Pole A', 'P1', 'P2', 'P3', 'Pole B'];

export function directionText(direction: 'AB' | 'BA'): string {
  return direction === 'AB' ? 'A to B' : 'B to A';
}

export interface TrackingPayloadInput {
  operator: string;
  measurement: TrackingMeasurement;
  asset: LineAssetWithPoles;
  /** The span's three measurement points, in sequence order. */
  points: readonly MeasurementPoint[];
  dsp: Dsp;
  /** Overrides the classified severity of the highest mark only (the operator's edit). */
  peakSeverity?: Severity;
  note: string;
  pdDevice: string;
}

/** The mark with the highest value and its index, or null for a walk with no usable mark. */
export function trackingPeak(marks: readonly TrackMark[], dsp: Dsp): { index: number; mark: TrackMark } | null {
  const index = dsp.peakIndex(marks.map((m) => m.valueDbmV));
  const mark = index === null ? undefined : marks[index];
  return index === null || mark === undefined ? null : { index, mark };
}

export function buildTrackingPayload(input: TrackingPayloadInput): SurveyPayload {
  const { measurement, asset, dsp } = input;
  if (measurement.marks.length === 0) throw new Error('A walk with no marks cannot be saved.');
  const peak = trackingPeak(measurement.marks, dsp);

  const points = measurement.marks.map((mark, order): SurveyPointPayload => {
    const station = mark.station;
    const isPole = station === 0 || station === 4;
    const mp = isPole ? undefined : input.points[station - 1];
    const pole = station === 0 ? asset.pole_a : asset.pole_b;
    const classified = dsp.classify(mark.valueDbmV);
    const severity = peak && peak.index === order && input.peakSeverity ? input.peakSeverity : classified;
    const point: SurveyPointPayload = {
      sequence_no: order + 1,
      point_label: isPole ? (station === 0 ? 'Pole A' : 'Pole B') : (mp?.label ?? mark.label),
      latitude: mark.fix?.latitude ?? (isPole ? pole.latitude : (mp?.latitude ?? 0)),
      longitude: mark.fix?.longitude ?? (isPole ? pole.longitude : (mp?.longitude ?? 0)),
      pd_magnitude: round2(mark.valueDbmV),
      pd_unit: PD_UNIT,
      pd_device: input.pdDevice,
    };
    if (mp) point.measurement_point_id = mp.id;
    if (severity) point.severity = severity;
    return point;
  });

  const peakText = peak ? `, peak ${peak.mark.label} ${String(round2(peak.mark.valueDbmV))} dBmV` : '';
  return {
    surveyor: input.operator,
    surveyed_at: new Date(measurement.recordedAt).toISOString(),
    notes: joinNotes(`Tracking mode, ${directionText(measurement.direction)}${peakText}.`, input.note),
    points,
  };
}
