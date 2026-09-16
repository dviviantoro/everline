# Wireframe / UI Plan — PLN 20kV Asset Monitoring (POC)

> **IMMUTABLE -- AI MUST NOT modify this file. Read it as guidance. For output, see the mapping in ai-rules/README.md.**

> **Status:** PLANNING — Created before development begins. Do not change without discussion.
> **Purpose:** UI/UX plan: page layout, navigation structure, user flow.

---

## 1. Visual Identity

| Item | Detail |
|------|--------|
| Font | System font stack / Inter *(assume — confirm)* |
| Primary Color | Blue-gray, utility-dashboard tone *(placeholder — not PLN's official brand palette; confirm before any public-facing use)* |
| Secondary Color | Amber/red reserved for `warning`/`critical` severity indicators only |
| Logo | none for POC |
| Favicon | default |

---

## 2. Navigation Structure

```text
├── Map (home — the whole app is essentially this one screen)
│   ├── Layer toggle (Transformers / Lines)
│   ├── Asset Detail Panel (opens on click, over the map — not a separate route)
│   │   └── Survey History Timeline
│   ├── Add Transformer Survey (form, opened from a transformer's detail panel)
│   └── Add Line PD Survey (form, opened from a line's detail panel)
└── Add Asset (form — register a new transformer or line)
```

---

## 3. Page Layouts

### Map Layout (the only layout — no admin sidebar needed for POC)
```
┌─────────────────────────────────────┐
│  [App name]      [Layer toggle]     │ ← Top bar
├─────────────────────────────────────┤
│                                     │
│                                     │
│              Map (full width)       │
│                                     │
│                                     │
└─────────────────────────────────────┘

On asset click, a panel slides in from the side (desktop) or bottom
sheet (mobile) — it does not navigate away from the map.
```

---

## 4. Key Page Designs

### Screen: Map (home)

**URL:** `/`

**Components:**
- `MapView` — Leaflet map, centered on the chosen Central Java service area
- `LayerToggle` — show/hide transformers vs. lines
- `AssetMarker` / `PDPointMarker` — colored by `condition`/`severity`

**Interactions:**
- Click a transformer marker → Asset Detail Panel opens with the latest reading
- Click a line → Asset Detail Panel opens with its most recent PD points highlighted on the line
- Click "Add Survey" in the panel → opens the matching form (transformer or PD)

**States to handle:**
- Loading: skeleton map / spinner while seed data fetches
- Empty: asset registered but no survey yet → "No data yet" badge instead of a condition color
- Error: toast/alert if the assets API call fails
- Success: toast confirming a survey was recorded

### Screen: Asset Detail Panel

**Components:**
- Header (code, name, type)
- Latest reading summary (transformer: key electrical values; line: severity breakdown of its points)
- `SurveyHistoryTimeline` — chronological list, each entry expandable to show exact readings from that visit
- "Add Survey" button

### Screen: Transformer Survey Form

**Components:**
- Fields: surveyor, voltage (primary/secondary), current R/S/T, load %, oil/ambient temp, condition, notes
- GPS-capture button (pulls device location instead of manual lat/lng entry)

**Interactions:**
- Submit → POST to `transformer-surveys` endpoint → panel refreshes with new reading + updated history

### Screen: Line PD Survey Form

**Components:**
- Repeatable row: point label, PD magnitude + unit, temperature, severity, GPS-capture per point
- "Add point" button to append another row
- Single "Submit patrol" button sends all points as one survey

**States to handle:**
- Empty: at least one point required before submit is enabled
- In-progress: rows can be added/removed freely before submission; nothing is saved until "Submit patrol"

### Screen: Add Asset

**Components:**
- Type selector (transformer / line)
- Transformer: code, name, rated capacity, lat/lng (GPS-capture)
- Line: code, name, line_type (SUTM/SKTM), conductor_type, route (drawn on map or entered as a list of points)

---

## 5. Common Components

| Component | Description | Used In |
|----------|----------|---------------|
| `SeverityBadge` | Colored badge for normal/warning/critical | Map markers, detail panel, history timeline |
| `SurveyHistoryTimeline` | Chronological, expandable list of past surveys | Asset Detail Panel |
| `GpsCaptureButton` | Pulls device geolocation into a lat/lng field | Both survey forms, Add Asset |
| `LayerToggle` | Show/hide transformers vs. lines | Map top bar |
| `PointRowInput` | One repeatable PD-point row (label, magnitude, unit, temp, severity) | Line PD Survey Form |

---

## 6. Responsive Breakpoints

| Breakpoint | Width | Target |
|-----------|-------|--------|
| Mobile | `< 768px` | Field operators — this is the priority target, not an afterthought |
| Tablet | `768px - 1024px` | Field operators with tablets |
| Desktop | `> 1024px` | Asset engineers reviewing the map in an office |

**Responsive strategy:**
- Detail panel: side drawer on desktop, full-height bottom sheet on mobile
- Survey forms: single-column, large touch targets, GPS-capture prioritized over manual coordinate entry on mobile
