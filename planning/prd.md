# Product Requirements Document — PLN 20kV Asset Monitoring (POC)

> **IMMUTABLE -- AI MUST NOT modify this file. Read it as guidance. For output, see the mapping in ai-rules/README.md.**

> **Status:** PLANNING — Created before development begins. Do not change without discussion.
> **Purpose:** Single source of truth for product vision, user stories, and features to be built.

---

## 1. Product Vision

### Elevator Pitch

A map-based web app for PLN's 20kV distribution network in Central Java that shows every transformer and power line, and tracks their condition over time through field surveys — electrical readings on transformers, partial discharge and temperature readings along lines.

### Problem Statement

Field survey data (electrical readings, partial discharge/temperature checks) isn't tied to a specific mapped location today, and there's no single view of an asset's condition *over time* — so early signs of degradation (rising PD activity, hotspots, overloading) are hard to catch before they cause an outage.

### Target Users

| Role | Description | Key Needs |
|------|----------|----------------|
| Field Operator / Surveyor | Visits transformers and walks/drives line routes to take readings | Fast, mobile-friendly form; GPS-assisted location capture |
| Asset Engineer / Manager | Reviews network condition, prioritizes maintenance | Map overview, per-asset history/trend, visual severity indicators |

---

## 2. User Stories / Use Cases

### Epic 1: Asset Map Visualization

| ID | User Story | Priority | Acceptance Criteria |
|----|-----------|----------|-------------------|
| US-001 | As an Asset Engineer, I want to see all 20kV transformers and lines on a map so I have an overall picture of network condition | P0 | Map loads and renders all seeded transformer markers + line polylines |
| US-002 | As an Asset Engineer, I want to toggle transformer/line layers so I can focus on one asset type | P1 | Toggle controls show/hide each layer independently |
| US-003 | As an Asset Engineer, I want PD points and transformer conditions color-coded by severity so I can spot problems at a glance | P0 | Points/markers render in distinct colors for normal/warning/critical |

### Epic 2: Transformer Survey & History

| ID | User Story | Priority | Acceptance Criteria |
|----|-----------|----------|-------------------|
| US-004 | As a Field Operator, I want to submit a transformer's electrical readings from the field so the data is saved | P0 | Submitting the form creates a new survey + reading, visible immediately on the map/detail view |
| US-005 | As an Asset Engineer, I want to see a transformer's complete survey history so I know how it has changed over time | P0 | Clicking a transformer shows a chronological list of all past surveys; selecting one shows its exact readings |

### Epic 3: Line PD Survey & History

| ID | User Story | Priority | Acceptance Criteria |
|----|-----------|----------|-------------------|
| US-006 | As a Field Operator, I want to log PD and temperature readings at multiple points along a line in one visit so a whole patrol is recorded as a single unit | P0 | One survey submission can include multiple point readings, each with its own location/label |
| US-007 | As an Asset Engineer, I want to see a line's PD survey history so I can monitor discharge-activity trends | P1 | Line detail view lists past surveys chronologically |

### Epic 4: Asset Registry

| ID | User Story | Priority | Acceptance Criteria |
|----|-----------|----------|-------------------|
| US-008 | As an Admin, I want to register a new transformer or line so it appears on the map before any survey happens | P1 | New asset appears on the map immediately, marked "no data yet" until its first survey |

---

## 3. Feature List

### MVP (Minimum Viable Product)

| # | Feature | Description | Epic |
|---|-------|----------|------|
| 1 | Interactive map | Map of Central Java showing 20kV transformers (markers) and lines (polylines) | Epic 1 |
| 2 | Layer toggle | Show/hide transformer vs. line | Epic 1 |
| 3 | Severity indicators | Normal/warning/critical colors on PD points and transformer condition | Epic 1 |
| 4 | Transformer survey form | Input voltage, current R/S/T, load %, oil temp, condition | Epic 2 |
| 5 | Transformer history timeline | Chronological list of surveys + detail per survey | Epic 2 |
| 6 | Line PD survey form | Multi-point input per visit: label, PD magnitude+unit, temperature | Epic 3 |
| 7 | Line history timeline | Chronological list of PD surveys per line | Epic 3 |
| 8 | Asset registry | Add new transformer/line (code, name, location/route, nameplate spec) | Epic 4 |
| 9 | Dummy seed data | Synthetic data for one representative Central Java service area | — |

### Post-MVP / Future

| # | Feature | Description | Priority |
|---|-------|----------|----------|
| 1 | Authentication & roles | Login + RBAC for Field Operator/Engineer/Admin | Medium |
| 2 | Offline survey capture | PWA + sync for areas with weak signal | Medium |
| 3 | Photo/thermal image attachment | Photo attachment on surveys (needs object storage) | Low |
| 4 | Threshold-based auto severity | Automatic severity classification based on thresholds, not manual | Low |
| 5 | Real PLN data integration | Connection to PLN's real production systems, not dummy data | High (next phase) |

---

## 4. Constraints & Assumptions

### Constraints
- Must run on Vercel free/Hobby tier + Supabase free tier
- Dummy/synthetic data only — no connection to real PLN systems in this phase
- Timeline and team not yet determined (see `PROJECT_BRIEF.md` §14)

### Assumptions
- Field Operator has a smartphone with GPS and browser access in the field
- One representative service area in Central Java is enough to prove the concept (not full network coverage)
- PD/electrical severity thresholds will be defined later with the PLN team (see `PROJECT_BRIEF.md` §16)

---

## 5. Success Metrics

| Metric | Target | How to Measure |
|--------|--------|----------|
| Map renders seeded assets | All dummy transformers + lines appear, correctly placed | Visual check against seed data |
| Historical write path works | New survey appears immediately; old data still in history | Submit a survey, check the timeline |
| PD points show severity | Points along the line colored per `severity` | Visual check on map |
| Deploys cleanly | App runs on Vercel free tier + Supabase free tier | Successful deployment + smoke test |

---

## 6. Out of Scope

**What will NOT be built in this version:**
- Real-time/live telemetry (SCADA, IoT sensors) — this system is survey-based, not continuous monitoring
- Native mobile app — responsive web only
- Dissolved gas analysis (DGA) / lab-based oil testing
- ML-based anomaly classification
