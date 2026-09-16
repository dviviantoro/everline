# Database Plan — PLN 20kV Asset Monitoring (POC)

> **IMMUTABLE -- AI MUST NOT modify this file. Read it as guidance. For output, see the mapping in ai-rules/README.md.**

> **Status:** PLANNING — Created before development begins. Do not change without discussion.
> **Purpose:** Database blueprint: ERD, schema, relationships, indexing strategy.
>
> **Reference implementation:** `schema.sql` at the project root is the executable DDL for everything below — run it directly in Supabase's SQL Editor.

---

## 1. Database Topology

| Connection | DB Engine | Database Name | Purpose |
|-----------|----------|--------------|---------|
| default | PostgreSQL (Supabase) | postgres (Supabase project default) | Primary data — assets, surveys, readings |

---

## 2. Entity Relationship Diagram

```text
┌───────────────┐        ┌───────────────┐        ┌───────────────────────┐
│    assets     │──1:N──<│    surveys    │──1:1──<│ transformer_readings  │
├───────────────┤        ├───────────────┤        ├───────────────────────┤
│ id (PK)       │        │ id (PK)       │        │ id (PK)               │
│ type          │        │ asset_id (FK) │        │ survey_id (FK, unique)│
│ code          │        │ surveyed_at   │        │ voltage_primary_kv    │
│ name          │        │ surveyor      │        │ voltage_secondary_v   │
│ rated_capacity│        │ notes         │        │ current_r_a/s_a/t_a   │
│ latitude/long │        └───────┬───────┘        │ load_percent          │
│ line_type     │                │                │ oil_temp_c            │
│ conductor_type│                │1:N             │ condition             │
│ route_geometry│                ▼                └───────────────────────┘
└───────────────┘        ┌───────────────┐
                          │  pd_readings  │  (many rows per line survey —
                          ├───────────────┤   one per point along the line)
                          │ id (PK)       │
                          │ survey_id (FK)│
                          │ sequence_no   │
                          │ point_label   │
                          │ latitude/long │
                          │ pd_magnitude  │
                          │ pd_unit       │
                          │ temperature_c │
                          │ severity      │
                          └───────────────┘
```

---

## 3. Table Schemas

### `assets`

| Column | Type | Constraints | Index | Notes |
|--------|------|------------|-------|-------|
| `id` | `uuid` | PK, default `gen_random_uuid()` | PRIMARY | |
| `type` | `text` | NOT NULL, CHECK IN ('transformer','line') | | |
| `code` | `text` | NOT NULL | UNIQUE | e.g. `GD-SMG-0142` |
| `name` | `text` | nullable | | |
| `rated_capacity_kva` | `numeric` | nullable | | transformer only |
| `latitude` / `longitude` | `double precision` | nullable | | transformer only |
| `line_type` | `text` | CHECK IN ('SUTM','SKTM') | | line only |
| `conductor_type` | `text` | nullable | | line only |
| `route_geometry` | `jsonb` | nullable | | line only — `[[lng,lat], ...]` |
| `created_at` | `timestamptz` | NOT NULL, default `now()` | | |

### `surveys`

| Column | Type | Constraints | Index | Notes |
|--------|------|------------|-------|-------|
| `id` | `uuid` | PK, default `gen_random_uuid()` | PRIMARY | |
| `asset_id` | `uuid` | NOT NULL, FK → `assets.id`, ON DELETE CASCADE | INDEX (`idx_surveys_asset`) | |
| `surveyed_at` | `timestamptz` | NOT NULL, default `now()` | INDEX (part of `idx_surveys_asset`, desc) | when the field visit happened |
| `surveyor` | `text` | nullable | | |
| `notes` | `text` | nullable | | |
| `created_at` | `timestamptz` | NOT NULL, default `now()` | | when the row hit the db (may lag `surveyed_at` if submitted later) |

### `transformer_readings`

| Column | Type | Constraints | Index | Notes |
|--------|------|------------|-------|-------|
| `id` | `uuid` | PK, default `gen_random_uuid()` | PRIMARY | |
| `survey_id` | `uuid` | NOT NULL, UNIQUE, FK → `surveys.id`, ON DELETE CASCADE | UNIQUE | enforces 1:1 with a survey |
| `voltage_primary_kv` | `numeric` | nullable | | |
| `voltage_secondary_v` | `numeric` | nullable | | |
| `current_r_a` / `current_s_a` / `current_t_a` | `numeric` | nullable | | 3-phase current, R/S/T convention |
| `load_percent` | `numeric` | nullable | | against `assets.rated_capacity_kva` |
| `oil_temp_c` | `numeric` | nullable | | |
| `ambient_temp_c` | `numeric` | nullable | | |
| `condition` | `text` | CHECK IN ('good','warning','critical') | | overall operator judgment |

### `pd_readings`

| Column | Type | Constraints | Index | Notes |
|--------|------|------------|-------|-------|
| `id` | `uuid` | PK, default `gen_random_uuid()` | PRIMARY | |
| `survey_id` | `uuid` | NOT NULL, FK → `surveys.id`, ON DELETE CASCADE | INDEX (`idx_pd_readings_survey`) | many rows per survey |
| `sequence_no` | `integer` | nullable | INDEX (part of `idx_pd_readings_survey`) | order along the line |
| `point_label` | `text` | nullable | | e.g. `Tiang 12`, `Joint A-B` |
| `latitude` / `longitude` | `double precision` | NOT NULL | | specific point along the line |
| `pd_magnitude` | `numeric` | nullable | | |
| `pd_unit` | `text` | nullable | | e.g. `dBmV`, `pC` — instrument-dependent |
| `temperature_c` | `numeric` | nullable | | |
| `ambient_temp_c` | `numeric` | nullable | | |
| `severity` | `text` | CHECK IN ('normal','warning','critical') | | |

---

## 4. Relationships Summary

| Table A | Relation | Table B | Foreign Key |
|---------|----------|---------|-------------|
| `assets` | `hasMany` | `surveys` | `surveys.asset_id` |
| `surveys` | `belongsTo` | `assets` | `surveys.asset_id` |
| `surveys` | `hasOne` | `transformer_readings` | `transformer_readings.survey_id` |
| `surveys` | `hasMany` | `pd_readings` | `pd_readings.survey_id` |

---

## 5. Indexing Strategy

| Table | Index | Columns | Type | Reason |
|-------|-------|---------|------|--------|
| `surveys` | `idx_surveys_asset` | `asset_id, surveyed_at desc` | BTREE | Fast "latest survey per asset" and full history lookups |
| `pd_readings` | `idx_pd_readings_survey` | `survey_id, sequence_no` | BTREE | Fast "all points for this survey, in order" |

---

## 6. Migration Plan

| # | Migration | Table | Domain | Notes |
|---|----------|-------|--------|-------|
| 1 | `schema.sql` (full DDL) | `assets`, `surveys`, `transformer_readings`, `pd_readings` | Core | Run once via Supabase SQL Editor; no incremental migration tooling for POC scope |

---

## 7. Seed Data

| Seeder | Purpose | Data Source |
|--------|---------|------------|
| Asset seeder | ~10–20 dummy transformers + lines clustered in one Central Java service area | Synthetic, hand-authored or generated |
| Survey seeder | 2–3 historical surveys per asset, with plausible trending readings (e.g. slowly rising PD) | Synthetic, hand-authored or generated |
