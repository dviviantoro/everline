-- 004_pole_network_model.sql
-- One-time migration: poles become standalone network nodes (no longer
-- owned by a single line — any number of line segments can reference the
-- same pole as an endpoint). A "line" asset now represents exactly one span
-- between 2 poles, never a multi-point route. Also adds PD device + photo
-- evidence fields to pd_readings.
--
-- Run once by hand in the Supabase SQL Editor (no migration runner in this
-- POC — see planning/database.md §6). Idempotent — safe to re-run.
--
-- IMPORTANT: after running this, re-run `npm run seed` — existing poles/
-- lines/measurement_points/surveys get wiped and reseeded under the new
-- model (the seed script's normal idempotent re-run behavior).

alter table poles drop column if exists asset_id;
alter table poles drop column if exists sequence_no;
drop index if exists idx_poles_asset;

alter table assets add column if not exists pole_a_id uuid references poles(id) on delete set null;
alter table assets add column if not exists pole_b_id uuid references poles(id) on delete set null;

alter table pd_readings add column if not exists pd_device text;
alter table pd_readings add column if not exists photo_url text;

-- Also create a public Storage bucket by hand once, in the Supabase
-- dashboard (SQL can't do this): Storage -> New bucket -> name it
-- exactly "pd-photos" -> toggle "Public bucket" on -> Create.
