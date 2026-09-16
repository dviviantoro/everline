-- ============================================================
-- PLN 20kV Asset Monitoring — Postgres schema
--
-- Mounted into docker-entrypoint-initdb.d so a fresh `postgres`
-- container volume runs this automatically on first boot. Mirrors
-- planning/schema.sql at the project root — keep both in sync if
-- either changes.
--
-- Pattern: assets (static identity/nameplate specs) + surveys
-- (one row per field visit) + two reading tables, one per
-- measurement domain. Rows in surveys/*_readings are never
-- UPDATEd after insert — that's what makes them historical.
-- ============================================================

create extension if not exists "pgcrypto";

-- ------------------------------------------------------------
-- poles
-- One row per physical pole/tiang. Standalone network node with
-- no owning line — any number of line segments can reference the
-- same pole as an endpoint (defined before `assets` since lines
-- reference poles, not the other way around). Not itself a
-- reading — registered once (manually or via CSV import), append-
-- only in spirit like everything else here.
-- ------------------------------------------------------------
create table poles (
  id uuid primary key default gen_random_uuid(),
  label text,                        -- e.g. 'Tiang 12'
  latitude double precision not null,
  longitude double precision not null,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- assets
-- One row per physical transformer or line. Location and
-- nameplate specs live here since they rarely change; measured
-- / observed data lives in the tables below instead.
--
-- A line asset is exactly one span between 2 poles (pole_a/
-- pole_b) — never a multi-point route. A feeder with several
-- poles is several line assets chained end to end.
-- ------------------------------------------------------------
create table assets (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('transformer', 'line')),
  code text not null unique,                 -- e.g. 'GD-SMG-0142'
  name text,

  -- transformer only
  rated_capacity_kva numeric,
  latitude double precision,
  longitude double precision,

  -- transformer only — nameplate (static spec, rarely changes)
  manufacturer text,
  serial_number text,
  manufacture_year integer,
  phase_configuration text,                  -- e.g. '3-phase', '1-phase'
  rated_primary_voltage_kv numeric,
  rated_secondary_voltage_v numeric,
  rated_frequency_hz numeric,
  impedance_percent numeric,
  cooling_type text,                          -- e.g. 'ONAN', 'ONAF'

  -- line only
  line_type text check (line_type in ('SUTM', 'SKTM')),  -- overhead / underground
  conductor_type text,
  route_geometry jsonb,                       -- [[lng,lat], [lng,lat]] — always the pole_a/pole_b endpoints
  pole_a_id uuid references poles(id) on delete set null,
  pole_b_id uuid references poles(id) on delete set null,

  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- surveys
-- One row per field visit. Insert-only — never updated.
-- ------------------------------------------------------------
create table surveys (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references assets(id) on delete cascade,
  surveyed_at timestamptz not null default now(),  -- when the visit happened
  surveyor text,
  notes text,
  created_at timestamptz not null default now()    -- when the row hit the db
);

create index idx_surveys_asset on surveys (asset_id, surveyed_at desc);

-- ------------------------------------------------------------
-- measurement_points
-- One row per PD measurement location along a line's length, sited
-- BETWEEN its 2 poles (not at them — a pole is just a support
-- structure, it carries no reading). Gives each location a stable
-- identity across surveys so its history can be graphed over time.
-- Not itself a reading — registered once (at line-creation time),
-- append-only in spirit like everything else here.
-- ------------------------------------------------------------
create table measurement_points (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references assets(id) on delete cascade,  -- the line it belongs to
  sequence_no integer,
  label text,                        -- e.g. 'Point 2'
  latitude double precision not null,
  longitude double precision not null,
  created_at timestamptz not null default now()
);

create index idx_measurement_points_asset on measurement_points (asset_id, sequence_no);

-- ------------------------------------------------------------
-- transformer_readings
-- Electrical properties. One row per transformer survey.
-- ------------------------------------------------------------
create table transformer_readings (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null unique references surveys(id) on delete cascade,

  voltage_primary_kv numeric,
  voltage_secondary_v numeric,
  current_r_a numeric,
  current_s_a numeric,
  current_t_a numeric,
  load_percent numeric,
  oil_temp_c numeric,
  ambient_temp_c numeric,
  condition text check (condition in ('good', 'warning', 'critical'))
);

-- ------------------------------------------------------------
-- pd_readings
-- Partial discharge + temperature. MANY rows per line survey —
-- one per point measured along the line's length.
-- ------------------------------------------------------------
create table pd_readings (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references surveys(id) on delete cascade,
  measurement_point_id uuid references measurement_points(id) on delete set null,  -- links readings at the same point across surveys

  sequence_no integer,               -- order along the line
  point_label text,                  -- e.g. 'Point 2', 'Joint A-B'
  latitude double precision not null,
  longitude double precision not null,

  pd_magnitude numeric,
  pd_unit text,                      -- e.g. 'dBmV', 'pC' — instrument-dependent
  temperature_c numeric,
  ambient_temp_c numeric,
  severity text check (severity in ('normal', 'warning', 'critical')),
  pd_device text,                    -- instrument model/serial used for this reading
  photo_url text                     -- MinIO public URL, photo evidence from the field
);

create index idx_pd_readings_survey on pd_readings (survey_id, sequence_no);
create index idx_pd_readings_measurement_point on pd_readings (measurement_point_id, id);

-- ------------------------------------------------------------
-- transformer_telemetry
-- Electrical measurements pushed by an IoT device roughly every
-- 5 minutes. Different actor and cadence than surveys (device vs.
-- human, minutes vs. months), so it's its own table rather than a
-- bolt-on to transformer_readings. Insert-only by the same
-- convention as surveys/*_readings — devices only ever append.
-- ------------------------------------------------------------
create table transformer_telemetry (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references assets(id) on delete cascade,
  recorded_at timestamptz not null,

  number_of_phase integer,
  kwh numeric,
  kvarh numeric,
  kw numeric,
  kvar numeric,
  kva numeric,
  power_factor numeric,
  frequency_hz numeric,
  voltage_v numeric,
  current_a numeric,
  demand_kva numeric,                 -- assumption: "dmd" = demand in kVA
  thd_percent numeric,

  created_at timestamptz not null default now()
);

create index idx_telemetry_asset on transformer_telemetry (asset_id, recorded_at desc);
