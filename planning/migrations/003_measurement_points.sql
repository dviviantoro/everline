-- 003_measurement_points.sql
-- One-time migration: introduces `measurement_points` as its own entity,
-- separate from `poles`. A pole/tiang is just a support structure (no
-- reading); a measurement point is a PD survey location sited BETWEEN
-- poles along a line's length. `pd_readings` previously linked to `poles`
-- for this — that was wrong, so this migration repoints it.
--
-- Run once by hand in the Supabase SQL Editor (no migration runner in this
-- POC — see planning/database.md §6). Idempotent — safe to re-run.

create table if not exists measurement_points (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references assets(id) on delete cascade,
  sequence_no integer,
  label text,
  latitude double precision not null,
  longitude double precision not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_measurement_points_asset on measurement_points (asset_id, sequence_no);

alter table pd_readings drop column if exists pole_id;
alter table pd_readings add column if not exists measurement_point_id uuid references measurement_points(id) on delete set null;

create index if not exists idx_pd_readings_measurement_point on pd_readings (measurement_point_id, id);
drop index if exists idx_pd_readings_pole;
