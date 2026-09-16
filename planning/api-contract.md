# API Contract — PLN 20kV Asset Monitoring (POC)

> **IMMUTABLE -- AI MUST NOT modify this file. Read it as guidance. For output, see the mapping in ai-rules/README.md.**

> **Status:** PLANNING — Created before development begins. Note: this project is a Monolith (Next.js API routes bundled with the frontend), not a decoupled fullstack — this contract exists anyway to keep the client/server boundary explicit and testable.
> **Purpose:** Contract between the UI (React components) and API routes (`app/api/`). API routes must comply with this contract.

---

## 1. API Conventions

| Item | Convention |
|------|-----------|
| Base URL | `/api` (Next.js Route Handlers under `app/api/`) |
| Content Type | `application/json` |
| Auth Header | none in POC — every route is open |
| Date Format | ISO 8601 (`YYYY-MM-DDTHH:mm:ssZ`) |
| Pagination | not implemented in POC — dataset is small (dummy data, one service area) |
| Response Envelope | `{ "data": ..., "message"?: ... }` |

---

## 2. Standard Response Formats

### Success (200 / 201)
```json
{
    "data": { ... },
    "message": "Success message"
}
```

### Error
```json
{
    "message": "Error description",
    "errors": {
        "field_name": ["Validation error 1"]
    }
}
```

### Not Found (404)
```json
{
    "message": "Resource not found."
}
```

### Server Error (500)
```json
{
    "message": "Internal server error."
}
```

*(401/403 are not applicable yet — no auth in POC. Add when roles from `PROJECT_BRIEF.md` §5 are implemented.)*

---

## 3. Endpoints

### Module: Assets

**List**
```
GET /api/assets
Query: ?type=transformer|line   (optional filter)
Auth: none (POC)

Response 200:
{
    "data": [
        {
            "id": "uuid",
            "type": "transformer",
            "code": "GD-SMG-0142",
            "name": "Gardu Simpang Lima",
            "latitude": -6.9847,
            "longitude": 110.4234,
            "latest_condition": "warning",
            "last_surveyed_at": "2026-08-20T09:00:00Z"
        }
    ]
}
```
Note: for `type=line`, each item includes `route_geometry` and a `latest_severity` rollup (worst severity among its most recent survey's points) instead of `latest_condition`.

**Show**
```
GET /api/assets/{id}
Auth: none (POC)

Response 200:
{
    "data": {
        "id": "uuid",
        "type": "transformer",
        "code": "GD-SMG-0142",
        "name": "Gardu Simpang Lima",
        "rated_capacity_kva": 100,
        "latitude": -6.9847,
        "longitude": 110.4234,
        "surveys": [
            {
                "id": "uuid",
                "surveyed_at": "2026-08-20T09:00:00Z",
                "surveyor": "Budi",
                "reading": {
                    "voltage_primary_kv": 20.1,
                    "voltage_secondary_v": 398,
                    "current_r_a": 120, "current_s_a": 118, "current_t_a": 125,
                    "load_percent": 68,
                    "oil_temp_c": 54,
                    "condition": "warning"
                }
            }
        ]
    }
}
```
Note: for a `line` asset, each survey's `reading` is replaced by a `points` array (the `pd_readings` for that survey).

**Create**
```
POST /api/assets
Auth: none (POC)
Body:
{
    "type": "transformer",
    "code": "GD-SMG-0143",
    "name": "Gardu Baru",
    "rated_capacity_kva": 160,
    "latitude": -6.99,
    "longitude": 110.41
}

Response 201:
{
    "data": { "id": "uuid", "code": "GD-SMG-0143" },
    "message": "Created successfully"
}
```

**Update** *(registry corrections only — e.g. fixing a typo'd code/name/nameplate spec; never for readings)*
```
PUT /api/assets/{id}
Auth: none (POC)
Body: { "name": "Corrected Name" }

Response 200:
{ "data": { "id": "uuid", "name": "Corrected Name" }, "message": "Updated successfully" }
```

*(No Delete for assets in POC scope — out of caution around losing survey history via cascade.)*

---

### Module: Transformer Surveys

**Create** — the only write path for transformer readings. There is no Update/Delete: submitting a new survey is how a "correction" happens.
```
POST /api/assets/{id}/transformer-surveys
Auth: none (POC)
Body:
{
    "surveyor": "Budi",
    "voltage_primary_kv": 20.1,
    "voltage_secondary_v": 398,
    "current_r_a": 120, "current_s_a": 118, "current_t_a": 125,
    "load_percent": 68,
    "oil_temp_c": 54,
    "ambient_temp_c": 31,
    "condition": "warning",
    "notes": "Slight hum from tap changer"
}

Response 201:
{
    "data": { "survey_id": "uuid" },
    "message": "Survey recorded"
}
```

---

### Module: Line PD Surveys

**Create** — submits a whole patrol (multiple points) as one survey in a single call.
```
POST /api/assets/{id}/pd-surveys
Auth: none (POC)
Body:
{
    "surveyor": "Budi",
    "notes": "Routine monthly patrol",
    "points": [
        { "sequence_no": 1, "point_label": "Tiang 12", "latitude": -6.98, "longitude": 110.42, "pd_magnitude": 18, "pd_unit": "dBmV", "temperature_c": 33, "severity": "normal" },
        { "sequence_no": 2, "point_label": "Joint A-B", "latitude": -6.981, "longitude": 110.423, "pd_magnitude": 42, "pd_unit": "dBmV", "temperature_c": 58, "severity": "critical" }
    ]
}

Response 201:
{
    "data": { "survey_id": "uuid", "points_recorded": 2 },
    "message": "Survey recorded"
}
```

---

## 4. Notes for Implementers

- No DataTables/server-side-processing endpoint — the frontend is a map, not an admin table grid, so this template section doesn't apply here.
- Every write endpoint above is additive (INSERT only) except `PUT /api/assets/{id}`, which only touches registry metadata — never survey/reading rows. If an implementation ever adds an UPDATE against `surveys`, `transformer_readings`, or `pd_readings`, that's a bug against the core architecture decision in `planning/architecture.md` §8.
