/**
 * Local data model: what the app keeps in Dexie, and the body it sends to the survey API.
 * See `mobile-ui-spec.md` sections 3.6 to 3.9 and 5, and `mobile-tracking-mode.md` section 5.
 */
import type { GpsFix, LineType, Severity } from './types';

/** `pdSurveySchema` in `backend/src/validation.ts`: one point of a survey. Optional means omitted, never null. */
export interface SurveyPointPayload {
  measurement_point_id?: string;
  sequence_no?: number;
  point_label?: string;
  latitude: number;
  longitude: number;
  pd_magnitude?: number;
  pd_unit?: string;
  temperature_c?: number;
  severity?: Severity;
  pd_device?: string;
  // TODO(TASK-007): photo_url, after POST /api/uploads returns the stored URL.
  photo_url?: string;
}

/** Body of `POST /api/assets/{id}/pd-surveys`. */
export interface SurveyPayload {
  surveyor: string;
  surveyed_at?: string;
  notes?: string;
  points: SurveyPointPayload[];
}

/** A 60 s spot recording that has not been tagged yet. */
export interface SpotMeasurement {
  kind: 'spot';
  id: string;
  recordedAt: number;
  durationS: number;
  /** Window peak in dBmV: the statistic written to `pd_magnitude` (an assumption, see the report). */
  peakDbmV: number;
  rateHz: number;
  noiseDbmV: number;
  fix: GpsFix | null;
}

export type StationLabel = 'Pole A' | 'P1' | 'P2' | 'P3' | 'Pole B';

/** One mark of a tracking walk. `station` is the index in A to B order (0 to 4), whatever the walk direction. */
export interface TrackMark {
  station: number;
  label: StationLabel;
  valueDbmV: number;
  chainageM: number | null;
  at: number;
  fix: GpsFix | null;
}

export type WalkDirection = 'AB' | 'BA';
export type PositionSource = 'marks' | 'gps';

/** A finished tracking walk, ready to tag and save as one survey. */
export interface TrackingMeasurement {
  kind: 'tracking';
  id: string;
  assetId: string;
  direction: WalkDirection;
  source: PositionSource;
  recordedAt: number;
  /** Marks in walk order. */
  marks: TrackMark[];
}

export type Measurement = SpotMeasurement | TrackingMeasurement;

export type UploadState = 'saved' | 'uploaded' | 'failed';

/** A survey saved on the phone. `payload` is exactly what is (or was) sent. */
export interface SavedSurvey {
  id: string;
  createdAt: number;
  mode: 'spot' | 'tracking';
  assetId: string;
  assetCode: string;
  lineType: LineType;
  severity: Severity;
  peakDbmV: number;
  /** Where the peak was, for tracking walks ("P2"). */
  peakLabel: string | null;
  payload: SurveyPayload;
  upload: { state: UploadState; surveyId: string | null; message: string | null; attempts: number };
}

/** A tracking walk in progress, kept so it survives the app being closed or the link dropping. */
export interface TrackingDraft {
  id: string;
  assetId: string;
  direction: WalkDirection;
  source: PositionSource;
  warningLevelDbmV: number;
  startedAt: number;
  updatedAt: number;
  marks: TrackMark[];
}
