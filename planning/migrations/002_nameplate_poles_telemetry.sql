-- ============================================================
-- Migration 002 — nameplate fields, poles, transformer_telemetry
--
-- One-time migration for a Supabase project that already has the
-- original schema.sql applied. schema.sql itself has been updated
-- to include these changes for any FRESH install; this file is
-- for bringing an EXISTING database up to date (no migration
-- runner in this POC — planning/database.md §6 — run by hand in
-- the Supabase SQL Editor, same as schema.sql was).
--
-- Safe to run more than once — every statement is guarded.
-- ============================================================

-- --- assets: nameplate columns (transformer only, nullable) ---
alter table assets add column if not exists manufacturer text;
alter table assets add column if not exists serial_number text;
alter table assets add column if not exists manufacture_year integer;
alter table assets add column if not exists phase_configuration text;
alter table assets add column if not exists rated_primary_voltage_kv numeric;
alter table assets add column if not exists rated_secondary_voltage_v numeric;
alter table assets add column if not exists rated_frequency_hz numeric;
alter table assets add column if not exists impedance_percent numeric;
alter table assets add column if not exists cooling_type text;

-- --- poles: new table ---
create table if not exists poles (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references assets(id) on delete cascade,
  sequence_no integer,
  label text,
  latitude double precision not null,
  longitude double precision not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_poles_asset on poles (asset_id, sequence_no);

-- --- pd_readings: link to poles ---
alter table pd_readings add column if not exists pole_id uuid references poles(id) on delete set null;
create index if not exists idx_pd_readings_pole on pd_readings (pole_id, id);

-- --- transformer_telemetry: new table ---
create table if not exists transformer_telemetry (
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
  demand_kva numeric,
  thd_percent numeric,

  created_at timestamptz not null default now()
);

create index if not exists idx_telemetry_asset on transformer_telemetry (asset_id, recorded_at desc);
