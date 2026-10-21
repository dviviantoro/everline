# ADR 006 — Mobile UX contract: Cantol naming, wizard order, line/cable scope, tracking mode and design tokens

> Template: `ai-rules/decisions/001-architecture.md`. Related: ADR-002, ADR-003. ADR-004 (backend ingest) and ADR-005 (device protocol) are still to be written under TASK-008 and TASK-006.

## Status

Proposed — 2026-10-21. To be Accepted by the user after reviewing `dev-docs/design/mobile/mock/` and the open questions listed in `dev-docs/architecture/mobile-ui-spec.md` section 7. Nothing in `mobile/` depends on it until TASK-005 starts.

---

## Context

- A clickable design mock of the field app was produced outside the repository (11 screens, dark and light). It was checked against the real code on 2026-10-21 and its tokens, fonts and naming were aligned to the repo. The mock is the visual reference; the contract for what each screen means is `dev-docs/architecture/mobile-ui-spec.md`.
- ADR-002 and ADR-003 call the device "Red Pitaya" and use the abbreviations RP, `RpLink`, `rp-mock`, `rpFound` and `RP_*` wizard states. The product calls the device **Cantol**. (The repository directory was already named `cantol` in the earlier docs.)
- ADR-003 and `mobile-app.md` define the wizard as hotspot, then device, then permissions, then GPS. The requested operator flow after sign-in is: enable the hotspot, wait until Cantol connects, enable GPS.
- The data model (`planning/schema.sql`, `backend/src/types.ts`) has asset types `transformer` and `line`; a line is exactly one span between two poles with three measurement points; `line_type` is `SUTM` (overhead) or `SKTM` (cable). Magnitude unit is `dBmV`. The mock showed "Line | Cable" as two kinds of asset and magnitudes in mV.
- A "tracking mode" (walk the sensor along a span and watch the level rise or fall) was requested and is not in ADR-002.
- The web app uses Big Shoulders, IBM Plex Sans and IBM Plex Mono, a fixed dark palette, and a CSS-masked logo. The web has no mobile-specific light palette.

---

## Decision

1. **Naming.** The device is "Cantol" in all UI copy now. Code and living docs are renamed by TASK-010: `rp-mock` to `cantol-mock`, `RpLink` to `CantolLink`, `rpFound` to `cantolFound`, wizard states `RP_*` to `CANTOL_*`, and "Red Pitaya" or "RP" to "Cantol" in `mobile-app.md`, `build-apk.md`, `CURRENT_STATE.md` and the Rust crate docs. Protocol constants that mean the hardware itself may keep "Red Pitaya" in a comment. ADR-002 and ADR-003 are not edited (ADRs are history); this ADR is their terminology note.
2. **Wizard order.** Sign in, then hotspot, then Cantol, then GPS, then Ready. The separate `PERMS` state in `mobile-app.md` is folded into `LOCATION`: the location permission is requested on the GPS screen. Every step stays idempotent and re-checked on resume, as already specified.
3. **Scope of assets.** The app surveys line assets only. "Line | Cable" is the asset's `line_type` (`SUTM` or `SKTM`), not a new asset kind. Transformer and pole surveys stay on the web dashboard. Poles appear in the app only as the end stations of a tracking walk.
4. **Units and thresholds.** `dBmV`, with the existing provisional zones. The app calls the WASM `classify`; no fourth copy of the thresholds is created. Differences are shown in dB.
5. **Tracking mode.** Specified in `mobile-tracking-mode.md`: five stations per span (pole A, the three measurement points, pole B), trend rules in pure Rust/WASM with golden vectors, saved as one ordinary survey. It adds no API field and no schema change.
6. **Design tokens.** Fonts and the dark palette are copied from the web app into `mobile/src/index.css` with the same values (`mobile-design-system.md`). The font files are bundled. The logo is `apps/public/logo.png` through a CSS mask. The light palette is new and proposed here.
7. **Sign in.** A UI-only gate like the web `/login`, with the email stored locally and sent as `surveyor`. No auth backend, token or endpoint is added.
8. **Deferred.** Waveform capture (no API field), offline sync UI (Phase 5), a settings screen, history of server surveys in the app.
9. **Mock status.** The mock lives in `dev-docs/design/mobile/mock/` as a visual reference only. Where it conflicts with the contract (units, free-text asset id, missing pickers) the contract wins. A second mock pass is TASK-014.

Alternatives considered:

| Alternative | Outcome |
|---|---|
| Keep "Red Pitaya" in code and only rename the UI | Rejected: two names for one thing in a small codebase guarantees confusion; the rename is cheap now and costly after TASK-005 to TASK-007 add code. |
| Edit ADR-002 and ADR-003 in place | Rejected: ADRs record decisions as made. A terminology ADR keeps history intact. |
| Treat Cable as a separate asset type | Rejected: it would need a schema change (`planning/schema.sql` is immutable) and double the API surface; `line_type` already carries it. |
| Build tracking mode on free-form GPS distance only | Rejected as the only mode: a bad GPS fix under a line or in a trench makes it useless. Station marks work without GPS, so they are the default and GPS distance is an option. |
| Share design tokens with `apps/` through a workspace package | Rejected by ADR-002 (no shared workspaces). Duplicate once, record the mapping, and re-check on a web palette change. |
| Fetch fonts from Google Fonts at runtime | Rejected: a field app cannot depend on the network for first paint. |
| Real authentication now | Out of scope: the web app has none (`planning/PROJECT_BRIEF.md` section 5). Revisit with the per-device key in TASK-009. |

---

## Consequences

### Positive

- One name, one flow and one set of numbers across the mock, the docs and the code before the first screen is written.
- Tracking mode lands without any backend or schema work, and its logic is testable offline with golden vectors.
- The mobile app is recognisably the same product as the web dashboard.

### Trade-offs

- TASK-010 touches many files (mechanical, no design content). Do it as its own small batch before TASK-005 so later diffs stay clean.
- The light palette and some tracking thresholds (1.5 dB, 3 dB, 6 dB, 5 s dwell) are assumptions until the user and field testing confirm them.
- Tracking walks are indistinguishable from spot surveys on the dashboard (only the free-text `notes` differ) until a schema change is approved.

### Risks

- If pulse detection ends up on Cantol and only final numbers arrive (decision gate before TASK-006), the live phase plot disappears and the Live screen reduces to numeric tiles. The wizard, tracking and tagging screens are unaffected.
- If the product decides `pd_magnitude` is a different statistic from the one the seed data assumes, the aging-rate regression on the dashboard would mix incomparable numbers. Resolve open question 1 before TASK-007.
- Android back-button behaviour and the 44 px targets were designed on a canvas and not tried on a phone.
