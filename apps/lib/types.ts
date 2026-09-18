// Shared types matching planning/database.md table shapes.

export type AssetType = "transformer" | "line";
export type LineType = "SUTM" | "SKTM";
export type Condition = "good" | "warning" | "critical";
export type Severity = "normal" | "warning" | "critical";

export interface Asset {
  id: string;
  type: AssetType;
  code: string;
  name: string | null;
  rated_capacity_kva: number | null;
  latitude: number | null;
  longitude: number | null;

  // transformer only — nameplate (static spec)
  manufacturer: string | null;
  serial_number: string | null;
  manufacture_year: number | null;
  phase_configuration: string | null;
  rated_primary_voltage_kv: number | null;
  rated_secondary_voltage_v: number | null;
  rated_frequency_hz: number | null;
  impedance_percent: number | null;
  cooling_type: string | null;

  line_type: LineType | null;
  conductor_type: string | null;
  route_geometry: [number, number][] | null; // [[lng, lat]] — always the pole_a/pole_b endpoints
  pole_a_id: string | null;
  pole_b_id: string | null;
  created_at: string;
}

export interface Survey {
  id: string;
  asset_id: string;
  surveyed_at: string;
  surveyor: string | null;
  notes: string | null;
  created_at: string;
}

export interface TransformerReading {
  id: string;
  survey_id: string;
  voltage_primary_kv: number | null;
  voltage_secondary_v: number | null;
  current_r_a: number | null;
  current_s_a: number | null;
  current_t_a: number | null;
  load_percent: number | null;
  oil_temp_c: number | null;
  ambient_temp_c: number | null;
  condition: Condition | null;
}

export interface PdReading {
  id: string;
  survey_id: string;
  measurement_point_id: string | null;
  sequence_no: number | null;
  point_label: string | null;
  latitude: number;
  longitude: number;
  pd_magnitude: number | null;
  pd_unit: string | null;
  temperature_c: number | null;
  ambient_temp_c: number | null;
  severity: Severity | null;
  pd_device: string | null; // instrument model/serial used for this reading
  photo_url: string | null; // Supabase Storage public URL, photo evidence
}

// One row per physical pole/tiang — a standalone network node with no
// owning line; any number of line segments can use it as an endpoint.
// Carries no measurement itself.
export interface Pole {
  id: string;
  label: string | null;
  latitude: number;
  longitude: number;
  created_at: string;
}

export interface ConnectedLine {
  id: string;
  code: string;
  name: string | null;
}

export interface PoleDetail extends Pole {
  connectedLines: ConnectedLine[]; // line segments using this pole as an endpoint
}

// One row per PD measurement location along a line, sited BETWEEN poles
// (not at them) — stable identity across surveys so readings taken at the
// same spot can be graphed over time.
export interface MeasurementPoint {
  id: string;
  asset_id: string;
  sequence_no: number | null;
  label: string | null;
  latitude: number;
  longitude: number;
  created_at: string;
}

export interface MeasurementPointListItem extends MeasurementPoint {
  latest_severity: Severity | null; // null = no reading recorded yet
  // Latest reading's values, flattened onto the list row so map markers can
  // show measurements on hover without one request per point.
  latest_pd_magnitude: number | null;
  latest_pd_unit: string | null;
  latest_temperature_c: number | null;
  latest_pd_device: string | null;
  latest_surveyed_at: string | null;
}

export interface MeasurementReadingEntry {
  id: string;
  surveyed_at: string;
  surveyor: string | null;
  pd_magnitude: number | null;
  pd_unit: string | null;
  temperature_c: number | null;
  severity: Severity | null;
  pd_device: string | null;
  photo_url: string | null;
}

export interface MeasurementPointDetail extends MeasurementPoint {
  asset_code: string;
  asset_name: string | null;
  readings: MeasurementReadingEntry[]; // chronological, newest first
}

// A measurement point plus its own PD reading history — used to render
// per-point measurement history along a line's detail panel.
export interface MeasurementPointWithReadings extends MeasurementPoint {
  readings: MeasurementReadingEntry[]; // chronological, newest first
}

// IoT telemetry — one row per ~5-minute device push.
export interface TelemetryPoint {
  id: string;
  asset_id: string;
  recorded_at: string;
  number_of_phase: number | null;
  kwh: number | null;
  kvarh: number | null;
  kw: number | null;
  kvar: number | null;
  kva: number | null;
  power_factor: number | null;
  frequency_hz: number | null;
  voltage_v: number | null;
  current_a: number | null;
  demand_kva: number | null;
  thd_percent: number | null;
}

// Composed shapes returned by app/api/ routes — see planning/api-contract.md

export interface AssetListItem extends Asset {
  latest_condition?: Condition | null; // transformer only
  latest_severity?: Severity | null; // line only — worst severity among latest survey's points
  last_surveyed_at: string | null;
  // Latest transformer reading, flattened for marker hover (transformer only).
  latest_load_percent?: number | null;
  latest_oil_temp_c?: number | null;
  latest_voltage_secondary_v?: number | null;
}

export interface TransformerSurveyEntry extends Survey {
  reading: Omit<TransformerReading, "id" | "survey_id"> | null;
}

export interface LineSurveyEntry extends Survey {
  points: Omit<PdReading, "survey_id">[];
}

export type AssetDetail =
  | (Asset & { type: "transformer"; surveys: TransformerSurveyEntry[] })
  | (Asset & { type: "line"; surveys: LineSurveyEntry[] });

// Standard API envelope — see planning/api-contract.md

export interface ApiSuccess<T> {
  data: T;
  message?: string;
}

export interface ApiError {
  message: string;
  errors?: Record<string, string[]>;
}
