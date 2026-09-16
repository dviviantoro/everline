import { z } from "zod";

// Input validation schemas — every POST/PUT route validates against one of
// these before touching the database (ai-rules/security/part-d).

// Standard nameplate fields — all optional; a transformer can be
// registered before its nameplate is transcribed and filled in later
// via PUT /api/assets/{id}.
const nameplateFields = {
  manufacturer: z.string().max(120).optional(),
  serial_number: z.string().max(120).optional(),
  manufacture_year: z.number().int().min(1950).max(2100).optional(),
  phase_configuration: z.string().max(40).optional(),
  rated_primary_voltage_kv: z.number().positive().optional(),
  rated_secondary_voltage_v: z.number().positive().optional(),
  rated_frequency_hz: z.number().positive().optional(),
  impedance_percent: z.number().positive().optional(),
  cooling_type: z.string().max(40).optional(),
};

export const createAssetSchema = z
  .object({
    type: z.enum(["transformer", "line"]),
    code: z.string().min(1).max(64),
    name: z.string().max(200).optional(),
    rated_capacity_kva: z.number().positive().optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    ...nameplateFields,
    line_type: z.enum(["SUTM", "SKTM"]).optional(),
    conductor_type: z.string().max(100).optional(),
    // A line is exactly one span between 2 existing poles — the server
    // derives route_geometry and a default name from them.
    pole_a_id: z.string().uuid().optional(),
    pole_b_id: z.string().uuid().optional(),
  })
  .refine(
    (v) => v.type !== "transformer" || (v.latitude !== undefined && v.longitude !== undefined),
    { message: "latitude and longitude are required for a transformer", path: ["latitude"] }
  )
  .refine((v) => v.type !== "line" || (v.pole_a_id !== undefined && v.pole_b_id !== undefined), {
    message: "pole_a_id and pole_b_id are required for a line",
    path: ["pole_a_id"],
  })
  .refine((v) => v.type !== "line" || v.pole_a_id !== v.pole_b_id, {
    message: "pole_a_id and pole_b_id must be different poles",
    path: ["pole_b_id"],
  });

export const createPoleSchema = z.object({
  label: z.string().max(120).optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

// CSV import — client parses the file, server validates + bulk-inserts.
export const importPolesSchema = z.array(createPoleSchema).min(1, "at least one row is required");

export const importTransformersSchema = z
  .array(
    z.object({
      code: z.string().min(1).max(64),
      name: z.string().max(200).optional(),
      rated_capacity_kva: z.number().positive().optional(),
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
      ...nameplateFields,
    })
  )
  .min(1, "at least one row is required");

export const importLinesSchema = z
  .array(
    z.object({
      code: z.string().min(1).max(64),
      name: z.string().max(200).optional(),
      line_type: z.enum(["SUTM", "SKTM"]).optional(),
      conductor_type: z.string().max(100).optional(),
      // Resolved against existing pole labels server-side (case-insensitive) —
      // friendlier for a hand-filled spreadsheet than requiring raw UUIDs.
      pole_a_label: z.string().min(1).max(120),
      pole_b_label: z.string().min(1).max(120),
    })
  )
  .min(1, "at least one row is required");

export const updateAssetSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  code: z.string().min(1).max(64).optional(),
  rated_capacity_kva: z.number().positive().optional(),
  conductor_type: z.string().max(100).optional(),
  ...nameplateFields,
});

export const transformerSurveySchema = z.object({
  surveyor: z.string().min(1, "surveyor is required").max(120),
  surveyed_at: z.string().datetime().optional(),
  notes: z.string().max(2000).optional(),
  voltage_primary_kv: z.number().optional(),
  voltage_secondary_v: z.number().optional(),
  current_r_a: z.number().optional(),
  current_s_a: z.number().optional(),
  current_t_a: z.number().optional(),
  load_percent: z.number().min(0).optional(),
  oil_temp_c: z.number().optional(),
  ambient_temp_c: z.number().optional(),
  condition: z.enum(["good", "warning", "critical"]).optional(),
});

export const pdSurveySchema = z.object({
  surveyor: z.string().min(1, "surveyor is required").max(120),
  surveyed_at: z.string().datetime().optional(),
  notes: z.string().max(2000).optional(),
  points: z
    .array(
      z.object({
        measurement_point_id: z.string().uuid().optional(),
        sequence_no: z.number().int().optional(),
        point_label: z.string().max(120).optional(),
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        pd_magnitude: z.number().optional(),
        pd_unit: z.string().max(20).optional(),
        temperature_c: z.number().optional(),
        ambient_temp_c: z.number().optional(),
        severity: z.enum(["normal", "warning", "critical"]).optional(),
        pd_device: z.string().max(120).optional(),
        photo_url: z.string().url().max(2000).optional(),
      })
    )
    .min(1, "at least one point is required"),
});

// IoT telemetry ingestion — POST /api/assets/{id}/telemetry. No auth in
// this POC (matches every other route); a real deployment would need to
// authenticate the device before this endpoint goes near real data.
export const telemetrySchema = z.object({
  recorded_at: z.string().datetime().optional(), // defaults to now() server-side
  number_of_phase: z.number().int().min(1).max(3).optional(),
  kwh: z.number().optional(),
  kvarh: z.number().optional(),
  kw: z.number().optional(),
  kvar: z.number().optional(),
  kva: z.number().optional(),
  power_factor: z.number().min(-1).max(1).optional(),
  frequency_hz: z.number().optional(),
  voltage_v: z.number().optional(),
  current_a: z.number().optional(),
  demand_kva: z.number().optional(),
  thd_percent: z.number().min(0).optional(),
});
