# ADR 002 — Android field-capture app (Capacitor + Rust/WASM) in a new `mobile/` folder

> ADR-001 is cited by `planning/architecture.md` (section 8) but was never written, so numbering starts at 002 rather than fabricating it. Template: `ai-rules/decisions/001-architecture.md`.

## Status

Accepted — 2026-10-18 (user approved the plan after analysis; see "Decision" for scope).

---

## Context

- PD readings only enter the system through the API. No live UI creates surveys: the web PD form (`apps/components/forms/LinePdSurveyForm.tsx`) has been dead code since commit `6895714`, and the seed already names the survey device `Cantol-Mobile V1` (`backend/scripts/seed.ts`).
- The user wants the field half of that device as an Android app. Flow: open the app, grant permissions, bring up the phone hotspot with a hardcoded SSID/password so a Red Pitaya (RP) can join as a Wi-Fi client, confirm the link, get GPS, receive PD data from the RP, and turn it into a PD survey for the existing API.
- This overrides recorded scope: `planning/PROJECT_BRIEF.md` section 4 lists "Native mobile app", "Real-time/live telemetry" and "Offline data capture" as non-goals, and `planning/CLAUDE.md` says "Monolith, don't split". Those files are immutable for AI and are left as historical intent. The backend split (see `dev-docs/CHANGELOG.md`) is the precedent; this ADR and the CHANGELOG entry supersede the planning docs for the mobile scope.
- The user already ships Capacitor + Rust/WASM apps (`siklOS`, `qist-kiosk-mobile`). `siklOS` retired its WASM on 2026-10-16 because the two screens that used it did nothing the server did not already do.
- Constraints: must work across Android versions and OEMs (global use); RP-side software and protocol are undecided ("to be discussed later"); the repo is on GitHub, so nothing secret may be committed.

---

## Decision

1. Add a third code folder, `mobile/`, next to `apps/` and `backend/`. It is a Vite 8 + React 19 + TypeScript + Tailwind 4 app packaged with Capacitor 8 (minSdk 24, target 36).
2. v1 scope is field capture only: setup wizard (permissions, hotspot, RP discovery and handshake, GPS), live PD view, point selection, save and upload of a PD survey. The Next.js dashboard is not touched and the app does not port the map or the trend views.
3. Rust compiled to WASM runs in a Web Worker and does real on-device work: frame decode, CRC and resync, loss accounting, pulse detection, calibration, PRPD binning, per-window summary and severity classification. Crates live under `mobile/rust` (`cantol-proto`, `cantol-dsp`, `cantol-wasm`, plus a native `rp-mock`). One set of golden test vectors is the cross-target contract (native, Node, Worker in the Capacitor WebView).
4. Kotlin Capacitor plugins only move bytes and talk to the OS (hotspot state and settings intents, sockets, location-services dialog). They do no parsing.
5. TypeScript owns the UI, the wizard state machine, the Dexie store, the API client and the upload queue. Persistence stays in TypeScript; WASM is a pure calculator.
6. A `ManualAdapter` (operator types magnitude, unit, temperature) is a permanent fallback so a field round never stops when the link fails; it works without WASM.
7. Decision gate before Phase 3: where PD detection runs. If the RP only sends final numbers, WASM has no job and is dropped (the `siklOS` lesson).

Alternatives considered and rejected:

| Alternative | Why rejected |
|---|---|
| Static-export the Next.js app as the Capacitor bundle | Four `force-dynamic` server pages break `output: 'export'`; the dashboard is desktop-first with no mobile layout; Next 16 documents no WASM or Worker guide. A capture flow is a different surface anyway. |
| Point Capacitor `server.url` at the Vercel site | The app would need internet to open; a public origin fetching a private-network device runs into local-network-access limits and mixed content. |
| DSP in Kotlin instead of WASM | The user chose Rust/WASM, and shared vectors across native, Node and the WebView are a stronger correctness guarantee than a Kotlin reimplementation. |
| React Native or Flutter | Outside the user's existing stack and tooling. |

---

## Consequences

### Positive

- Reuses a stack and build scripts the user already operates; Mac-only work (Rust, TypeScript, mock RP) can proceed before any RP hardware exists.
- The mock RP and shared vectors make the whole pipeline testable without the real device.
- The dashboard and Vercel deployment are unaffected.

### Trade-offs

- A third code folder contradicts the Monolith wording in `dev-docs/AGENTS.md` and `planning/CLAUDE.md`; the docs are left as written and this ADR is the override.
- Types, severity zones and the API client are copied from `apps/` rather than shared (the repo has no workspaces). The severity zones now exist in three places (`backend/scripts/seed.ts`, `apps/lib/severity.ts`, the Rust crate); recorded in `dev-docs/ai/TECHNICAL_DEBT.md`.
- Offline capture is pulled forward from "phase 2" in the brief.

### Risks

- WASM may be unnecessary if the RP does all detection. Mitigation: the decision gate in item 7.
- The WebView floor (Capacitor minimum Chrome 60, Tailwind 4 needs Chrome 111, WASM from current rustc needs roughly Chrome 96) limits very old or non-Google WebViews. Mitigation: the floor is pinned in Phase 0 from real phones.
- Backend gaps (no idempotency, no transaction, all errors are HTTP 500, shared API key extractable from an APK) must be closed before offline retry is trusted. See ADR-004 (to be written with the backend work).
