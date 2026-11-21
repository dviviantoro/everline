# Mobile app architecture (`mobile/`)

> Status: design, Phase 0 in progress (Mac side done 2026-10-18; self-test passed on one phone 2026-10-21; hotspot and Cantol-reachability spike pending). Decisions: ADR-002 (scope and stack), ADR-003 (hotspot and transport). This file is the repo-resident design; update it when the design changes.
>
> Amended by ADR-006 (Accepted, 2026-10-21): the device is called **Cantol**. TASK-010 renamed the code and this file to match (`cantol-mock`, `CantolLink`, `cantolFound`, `CANTOL_*`); ADR-002 and ADR-003 keep the older names "Red Pitaya", "RP", `RpLink`, `rp-mock` and `RP_*` as history. The wizard order is hotspot, Cantol, GPS with the location permission requested on the GPS step (the separate `PERMS` state is folded into `LOCATION` when TASK-005 builds the wizard; the state list below still shows it). What each screen shows and sends is in `mobile-ui-spec.md`; tracking mode is `mobile-tracking-mode.md`; fonts and colours are `mobile-design-system.md`.

## Built so far

| Piece | State |
|---|---|
| `mobile/rust` workspace (`cantol-proto`, `cantol-dsp`, `cantol-wasm`, `cantol-mock`) and golden vectors | Done, 42 tests |
| `mobile/` shell with the WASM self-test, debug APK | Done; self-test passes in Chromium and on one phone (Samsung SM-A127F, Android 13, WebView Chrome 155) |
| Screens, wizard reducer, guards, local store (Dexie), survey payload, tracking rules (WASM) | Done on simulated sources: the demo build (TASK-015, ADR-007; `mobile/src/core` holds the interfaces, `mobile/src/demo` the simulations) |
| Native plugins `HotspotAssistant`, `CantolLink`, `GnssHelper` (in Java), TypeScript adapters, device profile, field build | Built on branch `feat/task-005-field-wizard` (ADR-008, Proposed); run against `cantol-mock` and a scripted phone, **not on a phone** |
| First-run "Cantol label" screen (hotspot name, password, MAC address typed on the phone), MAC check of the connected device, and `mobile/device/cantol-pingpong.sh` for the Cantol side | Built 2026-11-04 (ADR-009, Proposed); the script is tested against the app's own Rust protocol code; **not run on a Red Pitaya or a phone** |
| Live stream on the field build: Start/Stop on the held link, frames forwarded by the Java plugin, decoded to dBmV in Rust, the Live screen with a "Test data" banner, and a synthetic stream from `cantol-pingpong.sh` | Built 2026-11-04 (ADR-010, Proposed); tested against the app's Rust code, the real mock and a browser stand-in; **not run on a phone or the Red Pitaya**. It does not settle the decision gate of TASK-006 (where detection runs) or ADR-005; the calibration is a placeholder |
| The Cantol measurement software for the four-input Red Pitaya (`mobile/device/cantol_device`: pulse detection on three sensors, phase from a mains reference on channel 1, a simulated source, a SCPI source), sensors in the protocol and on the Live screen, and Tracking as a free walk | Built 2026-11-06 (ADR-011, Proposed); tested against the simulator's ground truth and the app's own protocol code; **the SCPI source and the program have not run on a board** |
| Real upload and photo; Record, Tag and Surveys in the field build | Not started (TASK-007); the field build withholds them (`surveysNote`) |

## How the WASM module is loaded

`scripts/build-wasm.sh` builds with cargo (`wasm-release` profile) and the `wasm-bindgen` CLI (`--target web`), then shrinks with `wasm-opt` when present. The glue is initialised explicitly with `init({ module_or_path: response })` from a Worker, using a `?url` import of the `.wasm`; there is no `vite-plugin-wasm`. The `wasm-bindgen` crate is pinned (`=0.2.128`) to the installed CLI, and the build script fails with instructions if they differ. Under Node (Vitest) the module is loaded with `initSync({ module })`.

## Purpose

Android field-capture app for the Cantol PD measuring unit: bring up a link to Cantol over the phone's hotspot, receive PD data, tag it with GPS, and upload a PD survey to the existing API. Capture only: no map, no dashboard, no trend view.

## Layers

| Layer | Owns | Does not own |
|---|---|---|
| Kotlin (Capacitor plugins) | OS work: hotspot state and settings intents, location-services dialog, UDP/TCP sockets, heartbeat and reconnect timers | Parsing, CRC, protocol meaning |
| Rust compiled to WASM (in a Worker) | Frame decode, CRC, resync, loss accounting, pulse detection, calibration, PRPD binning, window summary, severity classification, control-frame encode | I/O, persistence |
| TypeScript / React | Wizard state machine, UI, Dexie store, API client and upload queue, payload builder, GPS sorting | Signal processing |

## Layout

```
mobile/
  package.json  vite.config.ts  capacitor.config.ts  .env.example  .gitignore
  config/device-profile.example.json      (band and ports; device-profile.local.json is gitignored)
  device/       cantol-pingpong.sh        (runs ON the Cantol: network search and the device side of the link; see docs/operations/cantol-pingpong.md)
                cantol_device/            (runs ON the Cantol: the measurement program, Python + numpy; see docs/operations/cantol-device.md, ADR-011)
  scripts/      env.sh  build-wasm.sh  android-build.sh  check-no-secrets.sh
  rust/         Cargo.toml  rust-toolchain.toml
    cantol-proto/   frames, CRC32, FrameDecoder (resync), loss tracker; shared with cantol-mock
    cantol-dsp/     noise floor, pulse detection, calibration, PRPD, summary, classify
    cantol-wasm/    wasm-bindgen facade
    cantol-mock/    native simulated Cantol device
    vectors/        golden .bin + expected.json, the cross-target contract
  src/          app/ adapters/ native/ worker/ db/ api/ wasm-pkg/ (generated)
  android/      generated by `cap add android`, committed; build outputs ignored
```

## Data flow

```
Cantol --TCP frames / UDP beacon--> Kotlin CantolLink (own reader thread, raw bytes, heartbeat, reconnect)
  --notifyListeners('rx', {seq, dataB64})--> main thread (the Capacitor bridge is window-only)
  --postMessage(ArrayBuffer, transfer)--> dsp.worker: WASM Session.push(bytes)
  --typed arrays + summary, 10 Hz or less--> store / UI
  Accept --> Measurement {summary, severity, GPS snapshot} --> Dexie
  Finish --> POST /api/uploads (photos) --> POST /api/assets/:id/pd-surveys
```

Capacitor facts that shape this (read in 8.3.4 source): plugin methods share one `CapacitorPlugins` thread, so plugins must not block in a `@PluginMethod`; native-to-JS events are JSON strings, so binary is base64 (batched, at most 20 Hz and 64 KB per event).

## Native plugins

| Plugin | Responsibility |
|---|---|
| `HotspotAssistant` | Hotspot-on detection (S0) and opening the system hotspot settings from an ordered table (S3). The flag-gated custom local-only hotspot spike (S1) and the capabilities probe are not built |
| `CantolLink` | Transport primitives: `scan` (the hotspot /24 on the data port), `listenBeacon`, `exchange` (send one frame, read one), `connect` and `disconnect` (a held socket with a heartbeat and its own reconnect), `linkStatus`, the last known address, `diagnostics`; `send` (write one frame the app built, Start or Stop, on the held link); events `linkState` (`up`, `lost`) and `frame` (one whole frame as base64, emitted only while the app listens for it; ADR-010). The discovery order, the HELLO/PONG check and the stream (Start/Stop, decoding, asking again after a reconnect) are in `src/native/fieldLink.ts`, not in the plugin |
| `GnssHelper` | Whether location services are on, and the location and app settings screens (no Play Services dialog); GPS fixes and the permission come from `@capacitor/geolocation` |

Built in **Java** (`mobile/android/app/src/main/java/id/cantol/mobile`), not Kotlin as ADR-002 and ADR-003 say: the project has no Kotlin Gradle plugin. A pure-Java core in `link/` (no Android classes, tested under JUnit) does the transport; the three Capacitor plugin classes in `plugins/` are thin. The phone's side of the protocol (HELLO, PING, Start, Stop, decoding PONG and the beacon) is `cantol-proto/src/handshake.rs`, and the reading of status and pulse frames with the calibration to dBmV is `cantol-wasm/src/stream.rs` over `cantol-dsp::calibration`, all exported through the WASM, so Java never reads a message. See ADR-008 and `mobile/docs/operations/field-build.md`.

## Connection wizard

States: `PERMS` -> `HOTSPOT_CHECK` -> `HOTSPOT_GUIDE` -> `CANTOL_DISCOVER` -> `CANTOL_PING` -> `LOCATION` -> `STREAMING` -> `READY`. Every step is idempotent: on start all checks run in parallel and the wizard jumps to the first unmet one. In-run `hotspot_lost` and `link_lost` recover silently for 30 s before returning to the wizard.

## Device profile and secrets

Band and ports come from `config/device-profile.local.json` (gitignored) or, failing that, the committed `device-profile.example.json`, loaded at build time through one function. **The hotspot name, password and the Cantol's MAC address are not in the build**: the operator types them from the Cantol's label on the phone the first time (ADR-009) and the app keeps them in its own storage. The API key lives in the gitignored `.env.local`. The repo is on GitHub: treat every committed file as public.

## Upload contract

`POST /api/assets/:id/pd-surveys` (`backend/src/validation.ts`, `pdSurveySchema`). A point only feeds a measurement point's history and aging rate if it carries `measurement_point_id`. Severity is supplied by the client. Optional fields are omitted, never `null`. Backend gaps that must be closed before offline retry is trusted (idempotency, transaction, status codes, `https://localhost` in `CORS_ORIGIN`) are tracked in TASK-008.

## Cantol link protocol

Placeholder, to be agreed with the Cantol side (ADR-005 when decided). Versioned, length-prefixed little-endian frames with CRC32; UDP discovery beacon on a placeholder port. Cantol has no RTC, so the phone stamps all survey times.
