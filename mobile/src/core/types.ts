/**
 * Domain types shared by the screens, the services behind them and the survey payload.
 *
 * Asset, pole and measurement-point shapes mirror `backend/src/types.ts` (the API contract in
 * `planning/api-contract.md`). Only the fields the app reads are listed.
 */

/** `line_type`: SUTM is an overhead line (shown as "Line"), SKTM an underground cable ("Cable"). */
export type LineType = 'SUTM' | 'SKTM';

/** The API's `severity` enum. */
export type Severity = 'normal' | 'warning' | 'critical';

/** GeoJSON order, as stored in `assets.route_geometry`. */
export type LngLat = [number, number];

export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface Pole {
  id: string;
  label: string | null;
  latitude: number;
  longitude: number;
}

/** A line asset: exactly one span between two poles. */
export interface LineAsset {
  id: string;
  type: 'line';
  code: string;
  name: string | null;
  line_type: LineType;
  conductor_type: string | null;
  /** [[lng, lat]] and always the two pole endpoints. */
  route_geometry: LngLat[];
  pole_a_id: string;
  pole_b_id: string;
}

/** What the asset pickers show: the asset plus its two poles (code and pole labels). */
export interface LineAssetWithPoles extends LineAsset {
  pole_a: Pole;
  pole_b: Pole;
}

/** One of the three points sited at 25, 50 and 75 percent of the route. */
export interface MeasurementPoint {
  id: string;
  asset_id: string;
  sequence_no: number;
  label: string;
  latitude: number;
  longitude: number;
}

export interface GpsFix extends LatLng {
  /** Horizontal accuracy radius in metres. */
  accuracyM: number;
  /** Epoch milliseconds on the phone's clock. */
  at: number;
}

/** UI wording for `line_type`. */
export const LINE_KIND_LABEL: Readonly<Record<LineType, string>> = {
  SUTM: 'Line',
  SKTM: 'Cable',
};

export const SEVERITY_LABEL: Readonly<Record<Severity, string>> = {
  normal: 'Normal',
  warning: 'Warning',
  critical: 'Critical',
};
