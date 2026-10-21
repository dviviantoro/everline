# ADR 007 — Mobile demo build: a build flag, simulated sources behind interfaces, never uploads

> Template: `ai-rules/decisions/001-architecture.md`. Related: ADR-002, ADR-003, ADR-006.

## Status

Accepted — 2026-10-21 (requested by the user as TASK-015).

---

## Context

- The Phase 0 app has one screen, the WASM self-test. ADR-006 and the design mock describe the whole field flow (sign in, hotspot, Cantol, GPS, live PD, tracking, tag, surveys), but the pieces that feed it do not exist yet: the Kotlin plugins (TASK-005), the live pipeline (TASK-006), the upload (TASK-007) and the backend hardening (TASK-008).
- The user wants to install an APK on a phone and click through the whole flow with no Cantol, no hotspot, no GPS and no backend, to judge the design and the behaviour before the native work starts.
- A demo that is a separate prototype app would be thrown away. A demo that shares the real screens, state machine and data model is the first half of TASK-005 to TASK-007 and TASK-011.

---

## Decision

1. **Build flag.** `VITE_DEMO=1` (script `npm run build:demo`, and `scripts/android-build.sh demo`) selects the demo. `main.tsx` imports the demo entry through a dynamic `import()` behind `import.meta.env.VITE_DEMO === '1'`, which Vite replaces with a constant, so a normal build contains none of the demo code and still opens on the self-test screen only.
2. **Interfaces first.** Everything outside the WebView is an interface in `mobile/src/core/links.ts`: `CantolLink`, `Gnss`, `HotspotAssistant` and `SurveyApi`, plus the local `AppStore` (Dexie). Screens depend only on those, through a `Services` context, and carry no demo-specific code. Environment differences (a badge text, the sign-in note, extra routes, the length of the record window) come from a small `AppConfig`.
3. **Simulated implementations live in `mobile/src/demo/`.** They are deterministic (seeded generator, injectable clock) and driven by one shared world model: where the phone is, what the sensor reads there, and a walker for tracking mode. TASK-005 to TASK-007 add the real implementations behind the same interfaces.
4. **Never uploads, never networks.** The simulated `SurveyApi` answers from fixtures. The demo build makes no request to anything but its own origin, contains no API key, and shows a persistent "Demo data" chip on every screen after sign-in. The hotspot name, password and device address are visibly placeholders.
5. **No new native surface.** No Kotlin change, no new Android permission (the manifest still declares only INTERNET and `allowBackup=false`), and no Capacitor plugin beyond `@capacitor/app` (back button) and `@capacitor/status-bar`. No haptics, camera or location plugin. Sound uses Web Audio, which needs no permission.
6. **Rules stay in Rust.** Severity comes from the WASM `classify`. The tracking-mode trend rules (`mobile-tracking-mode.md` section 3) are added to `cantol-dsp`, exported through `cantol-wasm`, and covered by golden vectors with exact boundary cases, following the `classify` vector pattern. TypeScript contains no threshold.
7. **A demo controls screen** (demo build only, from the Ready screen footer) changes the scenario, forces failures (link lost, Cantol not found, failed upload, GPS permission or services off) and resets all demo data.
8. **The self-test stays reachable** at `/selftest` in both builds.

Alternatives considered:

| Alternative | Outcome |
|---|---|
| A separate throw-away prototype app | Rejected: the screens, wizard, store and payload builder would be written twice. |
| Runtime switch (a hidden menu in the normal app) | Rejected: demo code would ship in the real APK, and "never uploads" could not be guaranteed by construction. |
| Mock `fetch` with a service worker or a local server | Rejected: it hides the seams. Interfaces make the later native work a drop-in replacement. |
| Feed the simulated events through the real WASM decoder | Not done: `Session` only counts frames today and the demo must not widen the WASM API. Simulated events carry the same fields as `PdEvent` and `Status`. |

---

## Consequences

### Positive

- The operator flow can be judged on a phone now, in both themes, before any native code exists.
- The state machine, the payload builder, the store and the tracking rules are real and tested; TASK-005 to TASK-007 and TASK-011 mostly add native implementations.
- The normal build is byte-for-byte unaffected in behaviour; the demo is excluded by the compiler.

### Trade-offs

- The demo cannot say anything about hotspot behaviour on real phones, Cantol discovery, GPS under a line or the backend. Those stay open under TASK-004, TASK-005 and TASK-008.
- The simulated sensor encodes assumptions (noise about 6 dBmV, a gaussian peak 0.18 of the span wide, two phase lobes). They are listed in the task report and are not measurements.
- Two extra Capacitor plugins ship in every APK, normal or demo, because the Android project is shared. They add no permission.

### Risks

- A demo that looks finished can be mistaken for a working product. The badge, the placeholder values and `demo-build.md` say what is simulated.
- If the simulated flows are smoother than reality (hotspot on in 2.5 s, Cantol found in 4 s), the real wizard will feel worse. The failure paths (not found, link lost, GPS denied, upload failed) are in the demo controls for that reason.
