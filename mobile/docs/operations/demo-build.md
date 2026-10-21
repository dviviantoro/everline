# Build and install the demo APK

## What

How to build the Cantol Mobile **demo** APK, install it on a phone, and click through the whole field flow with no Cantol, no hotspot, no GPS and no backend. Every screen of the design mock is built, with the behaviour of `dev-docs/architecture/mobile-ui-spec.md`, fed by simulated sources. Nothing leaves the phone: the demo build makes no network request and contains no API key.

## Why

The field flow (sign in, hotspot, Cantol, GPS, live PD, tracking, tagging, surveys) can be judged on a phone now, before the Kotlin plugins, the live pipeline and the upload exist. The screens, the wizard, the local store, the survey payload and the tracking rules are the real ones; only what sits behind four interfaces (`CantolLink`, `Gnss`, `HotspotAssistant`, `SurveyApi`) is simulated. Decision record: ADR-007.

## Prerequisites

The same as `build-apk.md` (JDK 21, Android SDK with platform 36, the pinned Rust toolchain and the `wasm-bindgen` CLI, Node 22.12 or newer). Python 3 with Pillow is needed only to regenerate the launcher icon (`scripts/generate-icons.py`), and a Chromium (for example the one Playwright downloads) only for `npm run verify:demo`.

## Step-by-step

1. From the repository root: `cd mobile && npm ci`.
2. `source scripts/env.sh` in every new shell. On a machine that is not the Mac, set `CANTOL_JAVA_HOME` and `CANTOL_ANDROID_HOME` first.
3. `scripts/android-build.sh demo` builds the WASM module if it is stale, the demo web bundle (`npm run build:demo`), runs `cap sync`, then `gradlew assembleDebug`. The result is `android/app/build/outputs/apk/debug/app-demo-debug.apk` (a copy of `app-debug.apk` under a name that cannot be confused with the normal build).
4. Install: with a phone connected, `scripts/android-build.sh demo install`, or `adb install -r android/app/build/outputs/apk/debug/app-demo-debug.apk`. Without a cable, copy the file to the phone and open it (allow installs from that app when Android asks).
5. Open "Cantol Mobile". The sign-in screen says it is a demo build. "Skip sign-in" signs in as a placeholder address; any email and password also work.
6. To preview in a desktop browser instead: `npm run build:demo && npm run preview`, then open the printed address (a narrow window or the browser's phone mode looks right).

A normal `scripts/android-build.sh` (no argument) builds the APK that has only the self-test screen, exactly as before. The self-test is also reachable in the demo at the foot of the Demo controls screen (`/selftest`).

### A suggested click-through

1. Skip sign-in; watch the welcome animation; the Hotspot screen opens.
2. Tap "Open hotspot settings". The simulated hotspot turns on after a moment and the app moves on by itself.
3. "Waiting for Cantol" finds the simulated device after about 4 seconds. Continue.
4. "Enable GPS" asks for the (simulated) permission; a fix of about 4 m arrives. Continue to "Ready to measure".
5. Start measurement. Live PD shows the plot, the Ref locked chip and the Peak, Rate and Noise tiles. Record 10 s (Fast recording is on by default).
6. Tag survey starts on the nearest line and its nearest point, with the condition suggested from the reading. Save survey. Surveys shows it as Uploaded (demo).
7. Live, then "Tracking mode". Choose GPS distance, Start tracking, and follow the simulated walker (about 100 seconds). Watch the trend words, the chart and the guidance. Finish, tag and save.
8. Try the failures from "Demo controls" (the link on the Ready screen): lose the link, hide Cantol (the help card appears after 60 s), deny location, force an upload to fail.

## What is real and what is simulated

| Part | In the demo | Real in the finished app |
|---|---|---|
| Screens, copy, themes, fonts, logo | Real: all eleven mock screens plus the manual address and diagnostics screens | The same code |
| Sign-in | A UI-only gate; the email is stored on the phone and used as `surveyor` | The same (no auth backend until later) |
| Wizard states, guards, Android Back, 30 s recovery | Real (pure reducer and guard functions, tested) | The same code |
| Severity (Normal, Warning, Critical) | Real: the WASM `classify` | The same |
| Tracking rules (trend, mark value, peak, guidance) | Real: Rust in `cantol-dsp` through the WASM, with golden vectors | The same; thresholds are assumptions until field tests |
| Local store (operator, saved surveys, tracking drafts) | Real: IndexedDB through Dexie, survives restarts | The same |
| Survey body | Real: built exactly as in `mobile-ui-spec.md` section 5 and tested against a copy of the backend schema | The same |
| Hotspot | Simulated: off, then on 2.5 s after "Open hotspot settings"; placeholder name and password | Kotlin plugin and the gitignored device profile (TASK-005) |
| Cantol: discovery, handshake, status, pulses | Simulated: found after about 4 s at a placeholder address (192.0.2.10), RTT 4 ms; pulses with the fields of the real protocol messages, not run through the decoder | Kotlin plugin over raw sockets, protocol ADR-005 (TASK-005, TASK-006) |
| GPS | Simulated: a fix of about 4 m next to the chosen line; a walker for tracking | `@capacitor/geolocation` and a Kotlin helper (TASK-005) |
| Assets and measurement points | Simulated: 7 fixture spans (4 Line, 3 Cable) with 3 points each | `GET /api/assets?type=line` and `GET /api/assets/{id}/measurement-points` |
| Upload | Simulated: never sent anywhere; the reply is made up | `POST /api/assets/{id}/pd-surveys` with CORS for `https://localhost` (TASK-007, TASK-008) |
| Photo | Not in the demo (a `TODO(TASK-007)` marks the place) | Optional photo upload |
| Sound cue | Real (Web Audio, no permission); no vibration or haptics | Same |

## Demo controls

Reached from the Ready screen footer (demo build only). Small and plain:

| Control | Effect |
|---|---|
| Strongest reading is at P1, P2, P3 or None | Where the simulated peak sits on a span |
| Spot readings are taken next to | Which line the simulated phone stands next to |
| Fast recording | Record 10 s instead of 60 s (on by default) |
| Link lost | Drops the Cantol link and keeps it down |
| Cantol not found | Discovery never answers; the help card appears after 60 s |
| Next upload fails | The next Upload or Retry fails once |
| Mains reference locked | Off hides the phase plot ("Ref not locked") |
| Location permission and services | Allowed, denied, blocked; services on or off |
| Open self-test | The Phase 0 self-test |
| Reset all demo data | Signs out and erases saved surveys, drafts and settings |

## Reset

"Reset all demo data" in Demo controls, or Android Settings, Apps, Cantol Mobile, Storage, Clear storage. The theme choice lives in the WebView's local storage and goes with it.

## Verification

- The script ends with `BUILD SUCCESSFUL` and prints the APK path.
- `$ANDROID_HOME/build-tools/36.0.0/aapt2 dump badging <apk>` shows package `id.cantol.mobile`, target SDK 36 and only the INTERNET permission.
- `cd mobile && npm run typecheck && npm run lint && npm test` and `cd rust && cargo fmt --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace` pass.
- `npm run build:demo && npm run verify:demo` walks the whole flow in headless Chromium on a fake clock, screenshots every screen in dark and light at 390 by 844 and at 360 by 640 with a larger font, and checks that no text runs off the screen or is clipped, every touch target is at least 44 by 44 px, no request leaves the local origin, and reduced motion is honoured. Screenshots go to the folder named by `--out` (default: a temporary folder); they are not committed.
- The normal build still opens on the self-test with digest `f7f47846`; the demo code and fixtures are absent from its bundle.

## What the demo cannot tell us

- Whether the hotspot flow works on real phones and OEM settings, or how long a real Cantol takes to join.
- The real pulse stream: noise, rate and phase on real lines, and where detection runs (the open decision before TASK-006).
- GPS under a line or in a trench, and real accuracy.
- The backend: CORS for `https://localhost`, idempotency, status codes (TASK-008), and the photo upload.
- The tracking thresholds (1.5, 3 and 6 dB, the 5 s dwell, the 5 m station band) and the light palette: they are assumptions until field testing and approval.
- Layout on every phone: it was checked in a desktop browser at two sizes, not on a range of devices.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| The app opens on the self-test screen only | It is the normal build. Build with `scripts/android-build.sh demo` and install `app-demo-debug.apk`. |
| "The demo could not start" | The WASM module failed to load; the text shows why. Update the Android System WebView. |
| The Cantol screen keeps saying "Looking only at ..." | A manual address was entered. Tap "Search automatically instead". |
| Everything looks stuck at Waiting for Cantol | Demo controls: "Cantol not found" or "Link lost" is on. |
| Start tracking stays disabled | It needs the Cantol stream and a GPS fix; check the status strip and Demo controls. |
| Android blocks the install | Allow installs from the app you used to open the file, or use `adb install -r`. |
| `env.sh: JDK 21 not found` on a Linux machine | Set `CANTOL_JAVA_HOME` and `CANTOL_ANDROID_HOME` before `scripts/android-build.sh`. |
| `verify:demo` finds no Chromium | Set `CHROMIUM_PATH` to a Chromium or headless shell binary. |

## Maintenance

- Fixtures mirror `backend/scripts/seed.ts` and `backend/src/geo.ts` (`mobile/src/demo/fixtures.ts`). When the seed's code style or the point fractions change, change them there too; `fixtures.test.ts` pins the shape.
- The survey schema in `payload.test.ts` is a hand copy of `pdSurveySchema` in `backend/src/validation.ts`. Keep it in step.
- The tracking rules are in `mobile/rust/cantol-dsp/src/trend.rs` with vectors in `rust/vectors/trend/cases.txt`. Regenerate nothing by hand: change a rule, change its vector in the same commit, and say so in the CHANGELOG.
- Regenerate the launcher icon with `python3 scripts/generate-icons.py` after changing `src/assets/logo.png`.
- Never commit the hotspot name or password, the API key, or a signing keystore. The demo contains placeholders only.
