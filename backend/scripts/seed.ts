import { config } from "dotenv";
config();

import { pool, query, queryOne } from "../src/db";
import { interpolateAlongRoute, DEFAULT_MEASUREMENT_FRACTIONS } from "../src/geo";

// One representative Central Java service area — Pekalongan (planning/database.md §7).
const CENTER = { lat: -6.8886, lng: 109.6753 };
const SURVEYORS = ["Budi", "Sari", "Agus", "Wati"];
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

function jitter(base: number, spread: number) {
  // Rounded to 1 decimal — real field instruments don't report 12 digits.
  return Math.round((base + (Math.random() - 0.5) * spread) * 10) / 10;
}

async function insertOne<T = Record<string, unknown>>(table: string, fields: Record<string, unknown>): Promise<T> {
  const columns = Object.keys(fields);
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
  const row = await queryOne<T>(
    `insert into ${table} (${columns.join(", ")}) values (${placeholders}) returning *`,
    columns.map((c) => (c === "route_geometry" ? JSON.stringify(fields[c]) : fields[c]))
  );
  if (!row) throw new Error(`insert into ${table} returned no row`);
  return row;
}

async function insertMany(table: string, rows: Record<string, unknown>[]): Promise<void> {
  for (const row of rows) {
    await insertOne(table, row);
  }
}

interface TransformerSeed {
  code: string;
  name: string;
  rated_capacity_kva: number;
  lat: number;
  lng: number;
  // load_percent trend across surveys, oldest first — drives condition + oil temp too
  loadTrend: number[];
  manufacturer: string;
  serial_number: string;
  manufacture_year: number;
}

// Nameplate constants shared by every seeded transformer — real values would
// vary, but these are reasonable defaults for a 20kV distribution transformer
// and keep the seed data focused on what actually varies (load, condition).
const NAMEPLATE_DEFAULTS = {
  phase_configuration: "3-phase",
  rated_primary_voltage_kv: 20,
  rated_secondary_voltage_v: 400,
  rated_frequency_hz: 50,
  impedance_percent: 4,
  cooling_type: "ONAN",
};

// A corridor is a named string of poles. Each adjacent PAIR of poles becomes
// its own line-segment asset (a "power line" is exactly one span between 2
// poles — never a multi-pole route), so a corridor with N poles produces
// N-1 line assets, each with its own 3 measurement points and PD history.
interface CorridorSeed {
  code: string; // prefix for generated segment codes, e.g. "SUTM-PKL-01"
  line_type: "SUTM" | "SKTM";
  conductor_type: string;
  poles: { label: string; lat: number; lng: number }[]; // ordered, >= 2
  // segmentMagnitudes[segmentIndex][surveyIndex] = 3 pd_magnitude (dBmV)
  // values (oldest survey first) for that segment's 3 measurement points.
  segmentMagnitudes: number[][][];
}

const PD_DEVICES = ["Doble PDS-100", "Techimp PDCheck", "Omicron MPD 600"];

const transformers: TransformerSeed[] = [
  { code: "GD-PKL-0001", name: "Gardu Panjang Wetan", rated_capacity_kva: 250, lat: CENTER.lat + 0.004, lng: CENTER.lng + 0.006, loadTrend: [55, 68, 82], manufacturer: "Trafindo", serial_number: "TRF-2019-0142", manufacture_year: 2019 },
  { code: "GD-PKL-0002", name: "Gardu Poncol", rated_capacity_kva: 160, lat: CENTER.lat - 0.008, lng: CENTER.lng + 0.011, loadTrend: [40, 47, 51], manufacturer: "Bambang Djaja", serial_number: "BDJ-2020-0087", manufacture_year: 2020 },
  { code: "GD-PKL-0003", name: "Gardu Medono", rated_capacity_kva: 100, lat: CENTER.lat + 0.012, lng: CENTER.lng - 0.007, loadTrend: [60, 59, 63], manufacturer: "Starlite", serial_number: "STL-2017-0356", manufacture_year: 2017 },
  { code: "GD-PKL-0004", name: "Gardu Noyontaan", rated_capacity_kva: 200, lat: CENTER.lat - 0.02, lng: CENTER.lng - 0.015, loadTrend: [72, 88, 97], manufacturer: "Trafindo", serial_number: "TRF-2015-0093", manufacture_year: 2015 },
  { code: "GD-PKL-0005", name: "Gardu Kraton Kidul", rated_capacity_kva: 100, lat: CENTER.lat - 0.028, lng: CENTER.lng - 0.02, loadTrend: [30, 33, 35], manufacturer: "Morgan Schaffer", serial_number: "MGS-2021-0211", manufacture_year: 2021 },
  { code: "GD-PKL-0006", name: "Gardu Bendan", rated_capacity_kva: 160, lat: CENTER.lat + 0.001, lng: CENTER.lng - 0.018, loadTrend: [50, 54, 58], manufacturer: "Bambang Djaja", serial_number: "BDJ-2018-0164", manufacture_year: 2018 },
  { code: "GD-PKL-0007", name: "Gardu Tirto", rated_capacity_kva: 50, lat: CENTER.lat + 0.018, lng: CENTER.lng + 0.002, loadTrend: [65, 70, 90], manufacturer: "Starlite", serial_number: "STL-2014-0028", manufacture_year: 2014 },
  { code: "GD-PKL-0008", name: "Gardu Buaran", rated_capacity_kva: 250, lat: CENTER.lat + 0.03, lng: CENTER.lng + 0.02, loadTrend: [45, 46, 44], manufacturer: "Trafindo", serial_number: "TRF-2022-0305", manufacture_year: 2022 },
];

const corridors: CorridorSeed[] = [
  {
    code: "SUTM-PKL-01",
    line_type: "SUTM",
    conductor_type: "AAAC 150mm2",
    poles: [
      { label: "Tiang PW-1", lat: CENTER.lat + 0.004, lng: CENTER.lng + 0.006 },
      { label: "Tiang PW-2", lat: CENTER.lat - 0.001, lng: CENTER.lng + 0.009 },
      { label: "Tiang PW-3", lat: CENTER.lat - 0.008, lng: CENTER.lng + 0.011 },
    ],
    segmentMagnitudes: [
      [
        [10, 11, 9],
        [13, 14, 12],
        [15, 16, 14],
      ],
      // Rising discharge activity on this span is the whole point of this demo.
      [
        [12, 15, 10],
        [18, 22, 14],
        [28, 41, 19],
      ],
    ],
  },
  {
    code: "SUTM-PKL-02",
    line_type: "SUTM",
    conductor_type: "AAAC 150mm2",
    poles: [
      { label: "Tiang NK-1", lat: CENTER.lat - 0.02, lng: CENTER.lng - 0.015 },
      { label: "Tiang NK-2", lat: CENTER.lat - 0.024, lng: CENTER.lng - 0.018 },
      { label: "Tiang NK-3", lat: CENTER.lat - 0.028, lng: CENTER.lng - 0.02 },
    ],
    segmentMagnitudes: [
      [
        [15, 14, 13],
        [20, 19, 18],
        [28, 27, 25],
      ],
      [
        [20, 18, 16],
        [33, 30, 26],
        [52, 47, 40],
      ],
    ],
  },
  {
    code: "SKTM-PKL-03",
    line_type: "SKTM",
    conductor_type: "NA2XSEYBY 3x150mm2",
    poles: [
      { label: "Tiang MT-1", lat: CENTER.lat + 0.012, lng: CENTER.lng - 0.007 },
      { label: "Tiang MT-2", lat: CENTER.lat + 0.015, lng: CENTER.lng - 0.002 },
      { label: "Tiang MT-3", lat: CENTER.lat + 0.018, lng: CENTER.lng + 0.002 },
    ],
    segmentMagnitudes: [
      [
        [6, 7, 5],
        [8, 7, 6],
        [9, 8, 7],
      ],
      [
        [8, 9, 7],
        [10, 11, 9],
        [13, 12, 11],
      ],
    ],
  },
  {
    code: "SUTM-PKL-04",
    line_type: "SUTM",
    conductor_type: "AAAC 95mm2",
    poles: [
      { label: "Tiang BF-1", lat: CENTER.lat + 0.03, lng: CENTER.lng + 0.02 },
      { label: "Tiang BF-2", lat: CENTER.lat + 0.034, lng: CENTER.lng + 0.026 },
    ],
    segmentMagnitudes: [[[16, 14, 15]]],
  },
  {
    code: "SKTM-PKL-05",
    line_type: "SKTM",
    conductor_type: "NA2XSEYBY 3x150mm2",
    poles: [
      { label: "Tiang BK-1", lat: CENTER.lat - 0.001, lng: CENTER.lng - 0.017 },
      { label: "Tiang BK-2", lat: CENTER.lat - 0.009, lng: CENTER.lng - 0.021 },
      { label: "Tiang BK-3", lat: CENTER.lat - 0.017, lng: CENTER.lng - 0.024 },
      { label: "Tiang BK-4", lat: CENTER.lat - 0.025, lng: CENTER.lng - 0.022 },
    ],
    segmentMagnitudes: [
      [
        [9, 8, 10],
        [11, 10, 9],
        [14, 13, 12],
      ],
      [
        [10, 9, 11],
        [13, 11, 10],
        [17, 15, 14],
      ],
      [
        [11, 9, 13],
        [15, 12, 19],
        [24, 17, 31],
      ],
    ],
  },
];

// Assumption based on repository analysis: PLN's real load/PD thresholds aren't
// defined yet (planning/PROJECT_BRIEF.md §16). These numbers only pick a
// plausible-looking severity for synthetic seed rows — they are not a
// production classification rule, and the app never computes severity from a
// threshold at runtime (severity/condition are operator-entered fields).
function conditionFor(loadPercent: number): "good" | "warning" | "critical" {
  if (loadPercent >= 90) return "critical";
  if (loadPercent >= 75) return "warning";
  return "good";
}

function severityFor(magnitude: number): "normal" | "warning" | "critical" {
  if (magnitude >= 40) return "critical";
  if (magnitude >= 20) return "warning";
  return "normal";
}

async function seedTransformers(): Promise<Map<string, string>> {
  const assetIdByCode = new Map<string, string>();
  for (const t of transformers) {
    const asset = await insertOne<{ id: string }>("assets", {
      type: "transformer",
      code: t.code,
      name: t.name,
      rated_capacity_kva: t.rated_capacity_kva,
      latitude: t.lat,
      longitude: t.lng,
      manufacturer: t.manufacturer,
      serial_number: t.serial_number,
      manufacture_year: t.manufacture_year,
      ...NAMEPLATE_DEFAULTS,
    });
    assetIdByCode.set(t.code, asset.id);

    for (const [i, loadPercent] of t.loadTrend.entries()) {
      const surveyedAt = daysAgo((t.loadTrend.length - 1 - i) * 30);
      const survey = await insertOne<{ id: string }>("surveys", {
        asset_id: asset.id,
        surveyed_at: surveyedAt,
        surveyor: SURVEYORS[i % SURVEYORS.length],
        notes: i === t.loadTrend.length - 1 ? "Routine monthly patrol" : null,
      });

      await insertOne("transformer_readings", {
        survey_id: survey.id,
        voltage_primary_kv: jitter(20, 0.4),
        voltage_secondary_v: jitter(400, 6),
        current_r_a: jitter(120, 15),
        current_s_a: jitter(118, 15),
        current_t_a: jitter(122, 15),
        load_percent: loadPercent,
        oil_temp_c: jitter(45 + loadPercent * 0.3, 3),
        ambient_temp_c: jitter(30, 2),
        condition: conditionFor(loadPercent),
      });
    }
  }
  return assetIdByCode;
}

// Simulated IoT telemetry: one reading every 5 minutes for the last 3 days
// per transformer (~864 rows each). Load follows a day/night curve around
// each transformer's latest field-survey load%, since a real smart meter's
// output tracks actual demand, not the monthly manual reading. This is
// synthetic data for the POC — see the threshold-assumption note above.
const TELEMETRY_INTERVAL_MIN = 5;
const TELEMETRY_WINDOW_HOURS = 72;

async function seedTelemetry(assetIdByCode: Map<string, string>) {
  const steps = (TELEMETRY_WINDOW_HOURS * 60) / TELEMETRY_INTERVAL_MIN; // 864
  const now = Date.now();

  for (const t of transformers) {
    const assetId = assetIdByCode.get(t.code);
    if (!assetId) continue;

    const latestLoad = t.loadTrend[t.loadTrend.length - 1];
    const baseKva = t.rated_capacity_kva * (latestLoad / 100);
    let kwhTotal = Math.random() * 5000;
    let kvarhTotal = Math.random() * 2000;

    const rows: Record<string, unknown>[] = [];
    for (let step = 0; step < steps; step++) {
      const recordedAt = new Date(now - (steps - 1 - step) * TELEMETRY_INTERVAL_MIN * 60_000);
      const hour = recordedAt.getHours() + recordedAt.getMinutes() / 60;
      // Day/night curve: trough around 03:00, peak around 19:00.
      const dayNight = 0.75 + 0.3 * Math.sin(((hour - 9) / 24) * 2 * Math.PI);

      const kva = Math.max(baseKva * dayNight * (1 + (Math.random() - 0.5) * 0.06), 0);
      const powerFactor = jitter(0.9, 0.06);
      const kw = kva * powerFactor;
      const kvar = Math.sqrt(Math.max(kva * kva - kw * kw, 0));
      const voltage = jitter(400, 8);
      const current = (kva * 1000) / (Math.sqrt(3) * voltage);

      kwhTotal += kw * (TELEMETRY_INTERVAL_MIN / 60);
      kvarhTotal += kvar * (TELEMETRY_INTERVAL_MIN / 60);

      rows.push({
        asset_id: assetId,
        recorded_at: recordedAt.toISOString(),
        number_of_phase: 3,
        kwh: Math.round(kwhTotal * 10) / 10,
        kvarh: Math.round(kvarhTotal * 10) / 10,
        kw: Math.round(kw * 10) / 10,
        kvar: Math.round(kvar * 10) / 10,
        kva: Math.round(kva * 10) / 10,
        power_factor: Math.round(powerFactor * 100) / 100,
        frequency_hz: jitter(50, 0.1),
        voltage_v: voltage,
        current_a: Math.round(current * 10) / 10,
        demand_kva: Math.round(kva * jitter(1, 0.05) * 10) / 10,
        thd_percent: Math.max(0, jitter(3, 2)),
      });
    }

    // Insert in batches inside one transaction per chunk — much faster than
    // one round trip per row for ~864 rows/transformer, and still simple.
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      const client = await pool.connect();
      try {
        await client.query("begin");
        for (const row of chunk) {
          const columns = Object.keys(row);
          const placeholders = columns.map((_, idx) => `$${idx + 1}`).join(", ");
          await client.query(
            `insert into transformer_telemetry (${columns.join(", ")}) values (${placeholders})`,
            columns.map((c) => row[c])
          );
        }
        await client.query("commit");
      } catch (err) {
        await client.query("rollback");
        throw new Error(`telemetry ${t.code} chunk ${i}: ${(err as Error).message}`);
      } finally {
        client.release();
      }
    }
  }
}

async function seedNetwork() {
  for (const corridor of corridors) {
    // Poles are registered once, up front, independent of any line — a
    // physical support structure carries no reading of its own, and any
    // number of line segments can use it as an endpoint.
    const poleIdByLabel = new Map<string, string>();
    for (const p of corridor.poles) {
      const row = await insertOne<{ id: string; label: string }>("poles", {
        label: p.label,
        latitude: p.lat,
        longitude: p.lng,
      });
      poleIdByLabel.set(row.label, row.id);
    }

    // A line is exactly one span between 2 poles — a corridor with N poles
    // produces N-1 line-segment assets, chained end to end.
    for (let seg = 0; seg < corridor.poles.length - 1; seg++) {
      const poleA = corridor.poles[seg];
      const poleB = corridor.poles[seg + 1];
      const route: [number, number][] = [
        [poleA.lng, poleA.lat],
        [poleB.lng, poleB.lat],
      ];
      const code = `${corridor.code}-${seg + 1}`;
      const name = `${poleA.label} – ${poleB.label}`;

      const asset = await insertOne<{ id: string }>("assets", {
        type: "line",
        code,
        name,
        line_type: corridor.line_type,
        conductor_type: corridor.conductor_type,
        route_geometry: route,
        pole_a_id: poleIdByLabel.get(poleA.label),
        pole_b_id: poleIdByLabel.get(poleB.label),
      });

      // PD measurement points are sited BETWEEN the 2 poles (not at them),
      // evenly spaced, giving each location a stable identity so readings
      // taken at it across surveys can be graphed over time.
      const measurementCoords = interpolateAlongRoute(route, DEFAULT_MEASUREMENT_FRACTIONS);
      const pointIdBySeq = new Map<number, string>();
      for (const [seq, [lng, lat]] of measurementCoords.entries()) {
        const row = await insertOne<{ id: string; sequence_no: number }>("measurement_points", {
          asset_id: asset.id,
          sequence_no: seq + 1,
          label: `Point ${seq + 1}`,
          latitude: lat,
          longitude: lng,
        });
        pointIdBySeq.set(row.sequence_no, row.id);
      }

      const surveys = corridor.segmentMagnitudes[seg];
      for (const [i, magnitudes] of surveys.entries()) {
        const surveyedAt = daysAgo((surveys.length - 1 - i) * 30);
        const survey = await insertOne<{ id: string }>("surveys", {
          asset_id: asset.id,
          surveyed_at: surveyedAt,
          surveyor: SURVEYORS[i % SURVEYORS.length],
          notes: i === surveys.length - 1 ? "Routine monthly patrol" : null,
        });

        const device = PD_DEVICES[i % PD_DEVICES.length];
        const points = magnitudes.map((magnitude, seq) => {
          const [lng, lat] = measurementCoords[seq] ?? measurementCoords[measurementCoords.length - 1];
          return {
            survey_id: survey.id,
            measurement_point_id: pointIdBySeq.get(seq + 1) ?? null,
            sequence_no: seq + 1,
            point_label: `Point ${seq + 1}`,
            latitude: lat,
            longitude: lng,
            pd_magnitude: magnitude,
            pd_unit: "dBmV",
            temperature_c: jitter(32 + magnitude * 0.3, 3),
            ambient_temp_c: jitter(30, 2),
            severity: severityFor(magnitude),
            pd_device: device,
          };
        });

        await insertMany("pd_readings", points);
      }
    }
  }
}

// Dev convenience only — makes this script safe to re-run. Deletes just the
// assets this script seeds (matched by code), which cascades to their
// surveys/readings/measurement_points/telemetry (all `on delete cascade`).
// Poles are no longer owned by a line (any number of segments can share
// one), so they're wiped separately and unconditionally — safe here since
// this project only ever holds this script's own dummy data. This is NOT
// the insert-only rule being bent: that rule covers surveys/
// transformer_readings/pd_readings, never assets/poles, and this only ever
// runs against dummy data with nothing real recorded yet.
async function clearExistingSeedData() {
  const segmentCodes = corridors.flatMap((c) => c.poles.slice(1).map((_, i) => `${c.code}-${i + 1}`));
  const codes = [...transformers.map((t) => t.code), ...segmentCodes];
  await query("delete from assets where code = any($1)", [codes]);
  await query("delete from poles");

  // One-time cleanup: this seed area moved from Semarang (-SMG- codes) to
  // Pekalongan (-PKL- codes). Remove any leftover Semarang dummy data so the
  // two don't both show up on the map.
  await query("delete from assets where code like $1", ["%-SMG-%"]);
}

async function main() {
  console.log("Clearing any previous seed data...");
  await clearExistingSeedData();
  console.log("Seeding transformers...");
  const assetIdByCode = await seedTransformers();
  console.log("Seeding telemetry (this inserts ~7,000 rows, may take a moment)...");
  await seedTelemetry(assetIdByCode);
  console.log("Seeding poles + line segments + PD measurement points...");
  await seedNetwork();
  const segmentCount = corridors.reduce((sum, c) => sum + (c.poles.length - 1), 0);
  const poleCount = corridors.reduce((sum, c) => sum + c.poles.length, 0);
  console.log(
    `Done — ${transformers.length} transformers, ${poleCount} poles, ${segmentCount} line segments seeded.`
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
