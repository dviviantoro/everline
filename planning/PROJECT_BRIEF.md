# PROJECT BRIEF — PLN 20kV Asset Monitoring (POC)

> **Planning blueprint — treat as reference, not something to edit ad hoc.** Filled from a prior design conversation; sections marked *(assume — confirm)* are reasonable defaults, not confirmed decisions, and should be reviewed before development starts.
>
> **Filled via Mode A.** Ready for Claude Code to read and generate `planning/` + `dev-docs/` from, per `ai-rules/README.md`.
>
> **Sections marked with a star (⭐) are the required minimum.** The rest are optional.

---

## 1. Vision ⭐

### Elevator Pitch

A map-based web app for PLN's 20kV distribution network in Central Java that shows every transformer and power line, and tracks their condition over time through field surveys — electrical readings on transformers, partial discharge and temperature readings along lines — so degradation is visible before it causes an outage.

### Problem Statement ⭐

*(assume — confirm against the actual field process)*

- Field survey data (electrical readings, partial discharge/temperature checks) isn't tied to a specific mapped location, making it hard to see which parts of the network need attention
- No single view of an asset's condition *over time* — a snapshot on paper or in a spreadsheet doesn't show a trend
- Early predictive-maintenance signals (rising PD activity, hotspots) are hard to catch without historical, location-anchored data

### Target Users ⭐

| Role | Description | Key Needs |
|------|----------|----------------|
| Field Operator / Surveyor | Visits transformers and walks/drives line routes to take readings | Fast, mobile-friendly form; GPS-assisted location capture; minimal typing in the field |
| Asset Engineer / Manager | Reviews network condition, prioritizes maintenance | Map overview, per-asset history/trend, visual severity indicators |

---

## 2. Project Type & Tech Stack ⭐

| Item | Choice |
|------|-------|
| Project Type | Fullstack (single Next.js app — API routes double as the backend) |
| Backend | Next.js API Routes |
| Framework Version | Next.js, latest stable (App Router) |
| Frontend | Next.js (React) |
| Database | PostgreSQL (via Supabase) |
| Vector Search | none |
| Cache | none |
| Queue / Message Broker | none |
| Object Storage | none for POC — *(open question: survey photos/thermal images? see §16)* |
| Monitoring | none (POC) |
| Logging | Vercel's built-in function logs only |
| CI/CD | Vercel Git integration (auto-deploy on push) |
| Deployment | Vercel |
| Architecture | Simple layered — kept deliberately unfancy for POC scope |

---

## 2b. UI/UX Template & Design System ⭐

**IMPORTANT: This section determines how AI builds the frontend UI.**

### Is an HTML template provided?

| Option | Description | Consequence |
|------|-----------|-------------|
| **YES** | User provides a ready-made HTML template | AI **MUST** use the template, **MUST NOT** build UI from scratch |
| **NO** | No HTML template | AI **MAY** build UI, but **MUST** use an established UI framework, **MUST NOT** build custom CSS from scratch |

**Answer:** NO

### UI Framework to Use

| Item | Value |
|------|-------|
| UI Framework | Tailwind CSS *(assume — confirm)* |
| Version | latest stable |
| Theme/Style Guide | Clean, map-first dashboard — the map is the primary surface, forms/panels are secondary |
| Custom Components | Map view (transformer markers + line polylines), survey entry forms (transformer / PD), asset detail panel with history timeline |

**Rules for AI:**
- **MUST** use the chosen UI framework
- **MUST** follow framework best practices (Tailwind utility classes, no custom CSS framework)
- **MUST NOT** build a custom CSS framework from scratch
- **MAY** write custom CSS only for components not available in the framework
- **MAY** use pre-built components from the framework

### Additional Notes

Map library: Leaflet + react-leaflet with OpenStreetMap tiles (no API key, free). PD points along a line should be color-coded by `severity` (normal/warning/critical) so problem spots are visible at a glance. Note: GeoJSON-style `[lng, lat]` order is used in storage — Leaflet wants `(lat, lng)`, so the mapping layer must swap order when rendering.

---

## 3. Core Features (MVP) ⭐

- Interactive map of Central Java showing 20kV transformers (point markers) and 20kV lines (polylines)
- Click a transformer → view its latest electrical reading + full survey history
- Click a line → view its latest partial-discharge/temperature readings per point + full survey history
- Survey form: transformer electrical readings (voltage, current per phase R/S/T, load %, oil temp, condition)
- Survey form: line PD readings — multiple points per visit (label, PD magnitude + unit, temperature)
- Asset registry — add a new transformer or line (code, name, location/route, nameplate specs)
- Historical timeline per asset — chronological list of past surveys, each viewable individually
- Map layer toggle — show/hide transformers vs. lines
- Severity-based visual indicators (normal/warning/critical) on PD points and transformer condition
- Seed/dummy data covering one plausible Central Java service area (clustered, not scattered province-wide)

---

## 4. Non-Goals / Out of Scope ⭐

- Real-time/live telemetry (SCADA, IoT sensors) — this is survey-based, not continuous monitoring
- Any connection to PLN's real production systems or real asset data — dummy data only in this phase
- Authentication / role-based access control — deferred; POC routes are open
- Offline data capture for low-connectivity field survey — phase 2
- Native mobile app — responsive web only
- Lab-based transformer testing (e.g. dissolved gas analysis) — out of scope for a routine field survey
- Automatic PD/anomaly classification via ML — severity is operator-assessed for now, not model-driven

---

## 5. User Roles & Permissions ⭐

*(Not enforced in the POC — documented here for the production version)*

| Role | Description | Access Level | Module Scope |
|------|----------|------------|-------------|
| Field Operator | Submits new surveys | Write | Surveys / readings only |
| Asset Engineer | Reviews condition, history | Read | All modules |
| Admin | Manages the asset registry itself | Full | All modules |

---

## 6. Core Business Logic & Rules ⭐

- IF an operator submits a new survey THEN a new row is inserted into `surveys` (+ its readings) — existing rows are never updated, so history is preserved
- IF an asset has never been surveyed THEN it still appears on the map from its registered location, marked "no data yet"
- IF a transformer's `load_percent` approaches/exceeds 100% of `rated_capacity_kva` THEN flag it as needing attention
- IF a PD/temperature reading exceeds the threshold THEN that point's `severity` is marked `critical` — *(threshold not yet defined, see §16)*

---

## 7. Key Workflows

### Workflow: Transformer Survey

```text
Operator opens transformer → enters electrical readings (voltage, current R/S/T, load %, oil temp) → confirms location → submits → new survey + transformer_reading row created → detail view shows new reading, prior readings kept in history
```

**Rule:** Sequential; all fields optional except survey timestamp/surveyor, so a partial reading can still be logged.

### Workflow: Line PD Survey

```text
Operator opens a line → adds one entry per point checked along the route (label, PD magnitude+unit, temperature, GPS) → repeats per point → submits whole visit as one survey → new survey row + multiple pd_reading rows created
```

**Rule:** Points can be added in any order; `sequence_no` just reflects entry order, not a strict requirement.

### Workflow: Reviewing Asset History

```text
User clicks an asset on the map → detail panel opens with latest reading + timeline of past surveys → selecting a past survey shows exactly what was recorded that visit
```

---

## 8. Architecture Philosophy

**Keep it boring.** This is a POC — one Next.js app, one Postgres database, no microservices, no premature abstraction. Optimize for "can be understood and rebuilt in an afternoon," not for scale that doesn't exist yet.

---

## 9. Core Engine / System Design

### Historical Data Model (append-only)

**Responsibilities:**
- Preserve every field survey as an immutable record so an asset's condition can be viewed at any point in its history, not just "now"
- Support two different reading shapes (one-per-survey vs. many-per-survey) without forcing them into one generic table

**Input:** a survey event — `asset_id`, `surveyed_at`, `surveyor`, plus type-specific readings

**Output:**
```yaml
assets: static identity + nameplate specs (id, type, code, name, rated_capacity_kva, latitude/longitude, line_type, conductor_type, route_geometry)
surveys: one row per field visit (id, asset_id, surveyed_at, surveyor, notes)
transformer_readings: one row per transformer survey (voltage_primary_kv, voltage_secondary_v, current_r_a/s_a/t_a, load_percent, oil_temp_c, condition)
pd_readings: many rows per line survey, one per point (sequence_no, point_label, latitude/longitude, pd_magnitude, pd_unit, temperature_c, severity)
```

Full DDL already drafted in `schema.sql` (bring this file into the project — it's the reference for `dev-docs/architecture/database.md` once generated).

---

## 10. Integration Points

None. Everything is self-contained for this POC — no external services, no connection to any PLN system.

---

## 11. Key Architecture Decisions

- Append-only history: `surveys` and its child reading tables are insert-only, never updated
- Two separate reading tables (`transformer_readings`, `pd_readings`) rather than one generic table, since the two measurement domains have fixed, different shapes
- Plain `latitude`/`longitude` (no PostGIS) to start; add PostGIS later only if proximity-style spatial queries are actually needed
- `pd_magnitude` stored as value + unit (not a fixed unit) since portable PD detectors report differently by method
- Supabase Row Level Security left off while data is dummy; must be enabled with real policies before any real asset data goes in

---

## 12. Success Criteria ⭐

| Metric | Target | How to Measure |
|--------|--------|----------|
| Map renders seeded assets | All dummy transformers + lines visible, correctly placed | Visual check against seed data |
| Historical write path works | A submitted survey appears immediately; older data still visible in history | Submit a survey, then check the timeline |
| PD points show severity | Color-coded points along a line reflect their `severity` field | Visual check on map |
| Deploys cleanly | App runs on Vercel free tier with Supabase free tier | Successful deployment + smoke test |

---

## 13. Data & References

No real PLN data or documents for this phase — all seed data is dummy/synthetic. `schema.sql` (drafted prior to this brief) is the reference for database structure.

---

## 14. Timeline & Constraints

| Item | Value |
|------|-------|
| Target MVP release date | *(not yet set)* |
| Estimated user count | Internal demo only for POC |
| Budget constraints | *(not yet set)* |
| Time constraints | *(not yet set)* |
| Team constraints | *(not yet set)* |
| Infrastructure constraints | Vercel free/Hobby tier + Supabase free tier |

---

## 15. Final Goal / North Star ⭐

Prove that a map built on historical field-survey data — transformer electrical condition and partial-discharge activity along lines — gives clear, at-a-glance visibility into 20kV asset health, before extending this to real PLN data and production integration.

---

## 16. Additional Notes / Brain Dump

- Threshold values for "warning"/"critical" severity (PD magnitude, transformer load/temperature) aren't defined yet — likely need to reference PLN's own maintenance/SPLN standards rather than invent numbers
- Whether surveys should support photo/thermal-image attachments is open — would need object storage (e.g. Supabase Storage) if yes
- PD unit standardization depends on which instrument the field team actually uses (dB, pC, mV all appear in practice) — kept as a free-text unit field rather than assuming one
- Confirm the POC should be read+write (operators actually submit surveys), not read-only — this brief assumes read+write, since that's the part that needs a real backend
