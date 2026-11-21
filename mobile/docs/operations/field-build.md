# Build and install the field APK

## What

How to build the Cantol Mobile **field** APK: the build whose hotspot check, Cantol link and GPS are real. It signs in, asks the operator for the values on the Cantol's label (hotspot name, password, MAC address), helps them turn on the phone's hotspot, waits for that Cantol to join it and links to it (refusing any device whose MAC address differs), then asks for location and waits for a good fix, and ends on a "Ready to measure" screen with the three connections shown live. "Start measurement" opens the **Live screen**, which asks the Cantol to stream and shows what arrives: the phase plot, Peak, Rate and Noise (ADR-010). The Cantol-side program is `mobile/device/cantol_device` (`cantol-device.md`, ADR-011): three PD sensors on the Red Pitaya's channels 2 to 4, the mains reference on channel 1. It has not run on a board yet; with its simulated source, with `cantol-pingpong.sh` or with `cantol-mock` the screen says "Test data" while the device says its numbers are generated. **Tracking** is there too, as a free walk with no line (ADR-011): mark stations M1, M2, ... along a cable and see the level at each. It cannot record, tag a point on a line, upload, or save a walk: those need the survey server, which this build is not connected to (TASK-007).

## Why

This is the connection half of the field flow (TASK-005), on real sources. The demo build (`demo-build.md`) shows the whole flow on simulated ones. Decision records: ADR-008 and ADR-009 (both Proposed). The device side of the same link, for trying it on a Red Pitaya, is `cantol-pingpong.md`.

## What the app can and cannot do about the hotspot

Android has no public API to switch the phone's hotspot on, or to set its name and password. So the app **cannot force** them. What it does (ADR-003):

1. Shows the network name and password the operator typed from the Cantol's label (and the band, and the MAC address it will accept), with a Copy button for the password.
2. Opens the phone's hotspot settings (the system screen where the operator types them once and switches the hotspot on). On some phones it can open the exact screen; on others only the general network settings, one level above.
3. Watches for the hotspot to come on and moves to the next step by itself.

After the first setup the phone remembers the hotspot, so each later session is one toggle.

## Prerequisites

The same as `build-apk.md` (JDK 21, Android SDK with platform 36, the pinned Rust toolchain and the `wasm-bindgen` CLI, Node 22.12 or newer). Both ends must agree on the hotspot: the phone's hotspot must use the name and password printed on the Cantol's label, which is what the Cantol is set to join.

## Step-by-step

1. From the repository root: `cd mobile && npm ci`.
2. Optional: the device profile. `config/device-profile.example.json` holds the band and the two ports (47000 and 47001), which are right for a stock unit. To change them, `cp config/device-profile.example.json config/device-profile.local.json` and edit it (gitignored). **The profile no longer holds the hotspot name or password**: the operator types them from the label on the phone (ADR-009), so the APK carries no network secret. A `ssid` or `password` left in an older local profile is ignored, and the build warns about it.
3. `source scripts/env.sh` in every new shell. On a machine that is not the Mac, set `CANTOL_JAVA_HOME` and `CANTOL_ANDROID_HOME` first.
4. `scripts/android-build.sh field` builds the WASM module if it is stale, the field web bundle (`npm run build:field`), runs `cap sync`, then `gradlew assembleDebug`. The result is `android/app/build/outputs/apk/debug/app-field-debug.apk`.
5. Install: with a phone connected, `scripts/android-build.sh field install`, or `adb install -r <that path>`. Without a cable, copy the file to the phone and open it.
6. Run `scripts/check-no-secrets.sh` before any push. The APK contains no hotspot password; the phone keeps what the operator typed in the app's own storage (not backed up).

### What to expect on the phone

1. Sign in with any email (the sign-in is a gate, not an account; the email is stored as the surveyor).
2. "Enter the Cantol label" (the first time only): type the hotspot name, the password and the MAC address printed on the Cantol device. The name is at most 32 characters, the password 8 to 63 plain characters (hidden; Show reveals it), the MAC address twelve hex digits in any notation (it is shown as `00:26:32:F0:1A:BC`). A message says what is wrong, never repeating the password. The values are kept on the phone, survive a restart, and can be changed from the hotspot screen ("Not what the Cantol label says? Change").
3. "Turn on your hotspot": set the name and password shown (they are what you typed), then tap "Open hotspot settings". Turn the hotspot on. The app notices and moves on.
4. "Waiting for Cantol": power the Cantol on. It is found by its beacon or by a scan of the hotspot's network, then checked with a HELLO. The device must report the MAC address you typed; **any other device that answers is refused** and the screen says which address it reported ("A device answered at ... with MAC address ..., not the ... you entered") with a "Check the label values" button. A search that finds nothing for a minute offers "Enter IP manually" and "Diagnostics".
5. "Enable location": allow location, switch location on if it is off, wait for a fix of 25 m or better. A phone usually has location off to begin with: the first tap on "Enable GPS" then opens the system location settings (the permission cannot be asked for until location is on); switch it on, come back, and tap "Enable GPS" again for the permission dialog.
6. "Ready to measure": hotspot, Cantol (address and round trip) and location, each live. If one drops, the row says "Reconnecting" or "No fix" and the app recovers silently for 30 seconds before reopening the setup. The tab bar has two tabs, Device and Live.
7. "Start measurement" opens **Live PD** and the app sends Start to the Cantol. With the test stream running on the Red Pitaya you should see, within a second or two: a **"Test data" banner** ("The Cantol says these numbers are generated, not measured"), pulses on the phase plot in two lobes around 90° and 270°, "Ref locked", Peak near the level the script was given (default 38 dBmV, drifting by 4 dB), Rate a few hundred a second and Noise near 15 to 16 dBmV. When the device reports more than one sensor a **Sensor** selector (All, 1, 2, 3) appears above the plot: the plot, Peak, Rate and Noise follow it. There is no Record button: a note says why. **Tracking mode** (the second half of the switch at the top) opens the free walk: stand still at a stop for five seconds and tap **Mark station**; each mark (M1, M2, ... up to 12) shows its level, whether it rose or fell from the last, the strongest is called out, the distance between two stops is shown when the phone had a GPS fix at both, and a warning level (20, 30 or 40 dBmV) raises a banner. The level is the strongest of the sensors, or the noise floor in a second with no pulses. **End walk** discards the marks (after asking): nothing is saved. Tapping the Device tab sends Stop and the pulses stop. If the Cantol cannot be told to start the screen says so and offers "Try again"; if the link is up but silent for 5 seconds it says "Waiting for data from the Cantol"; if the link drops it shows "Reconnecting" and asks for the stream again when the link is back.

### Trying it without a Cantol

`cantol-mock` speaks the same placeholder protocol. On a laptop that has joined the phone's hotspot: `cd mobile/rust && cargo run -p cantol-mock` (it listens on 47000 and broadcasts its beacon on 47001, which are the example profile's ports). It reports the MAC address `02:CA:57:00:00:01`; type that in the app, or start it with `--mac 00:26:32:F0:1A:BC` to report another. The phone should find it. This path has not been run on a phone.

The mock streams too: it sends pulses after Start (a level of 14 to 52 dBmV, random phase) and sets the "test data" flag in every status, so the Live screen can be tried on a laptop. `--sensors 3` makes it pretend to have three sensors (pulses cycle through them and every status carries per-sensor figures), which shows the sensor selector.

On the real Cantol (a Red Pitaya), run `mobile/device/cantol_device` (`cantol-device.md`): the measurement program, with a simulated source for trying the phone chain (`--source simulated`). `mobile/device/cantol-pingpong.sh` remains the network bring-up tool and a simpler made-up stream (`cantol-pingpong.md`).

### The web version (no phone needed)

`node scripts/serve-field-web.mjs --cantol <host>` serves the same field bundle, the real Capacitor bridge script and the real WASM codec in a browser at `http://localhost:4190/`, and links to the Cantol you name over real TCP (`--cantol rp-XXXXXX.local`, or an address; port 47000 unless given). What a phone's Java does is done by the Node script `scripts/lib/phone-standin.mjs` (the same stand-in `verify-field-web.mjs` uses): the hotspot is "on", location is allowed, a scan finds the Cantol, the held link, the frames and the heartbeat go to it. The GPS is simulated as a walk east at 1.2 m/s (`--walk-mps`), so the free walk can show a distance between stops. Sign in with any email and password, type the label values (any name and an 8-character password; the **MAC address must be the Cantol's**, e.g. `00:26:32:AB:CD:EF` for the Red Pitaya `rp-XXXXXX`).

It is for trying the Live and Tracking screens against a real Cantol, not for judging the app in the field: nothing in it is Android, a hotspot, Wi-Fi or real GPS. It listens on 127.0.0.1 only unless `--bind` says otherwise (it then warns), accepts only requests that carry its own `Host` and `Origin`, and lets the page open connections to the one Cantol you named and nothing else. `node scripts/demo-pdsim-web.mjs` drives it end to end against a Cantol replaying pd-simulator (`cantol-device.md`, "Trying it with pd-simulator") and saves a screenshot of each step.

## Verification

- `cd mobile/rust && cargo fmt --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace` (92 tests: the handshake helpers, the MAC field, the stream reader and the calibration, the mock streaming, and `device/cantol-pingpong.sh` against the real codec and calibration).
- `cd mobile && npm run typecheck && npm run lint && npm test` (275 tests: the adapters against a scripted phone network and the real WASM codec, the label values, the wizard step, the stream; three of them run the codec against the real `cantol-mock` when its binary is built, one of them streaming and stopping).
- `scripts/verify-link-jvm.sh` runs the Java link tests (43), including two against the real `cantol-mock` with frames built by the real WASM codec (the second sends Start and Stop and counts the pulses that come back).
- `cargo build -p cantol-mock` (in `mobile/rust`), then `node scripts/verify-field-web.mjs [--out <dir>]` runs the **field bundle with the real Capacitor bridge script and the real WASM** in headless Chromium, with a scripted stand-in for the Android side that forwards the link to the real mock over TCP. It walks every step above: the label screen (empty and invalid input, the password hidden, a MAC address tidied), a **wrong MAC address refused with a message and then corrected**, a later edit that keeps the link, the location permission refused twice and then allowed, the Location row staying "On" for 12 s while fixes arrive at the rate the real plugin would deliver them, a lost and a restored link, and a restart that does not ask for the label values again; then the **Live screen** (91 assertions in all): Start reaching the mock, the "Test data" banner, pulses on the plot, Peak, Rate and Noise in dBmV, no Record or Tracking, Stop on leaving, a Start that cannot be sent (message and retry), a silent device ("Waiting for data"), and a lost and restored link that asks for the stream again; the **sensor selector** against a mock with three sensors, and a **free walk** (two marks, the segment between them, the strongest, the warning banner, ending with confirmation); and asserts that only the local origin is requested and the console stays quiet.
- `aapt2 dump badging <apk>`: package `id.cantol.mobile`, target SDK 36, permissions INTERNET, ACCESS_COARSE_LOCATION, ACCESS_FINE_LOCATION and ACCESS_NETWORK_STATE (the last from a plugin dependency), `allowBackup` false, no cleartext flag. The web assets inside contain no example name or password.
- The normal build still opens on the self-test only, digest `f7f47846`, and its bundle contains no field or demo code.

## What is NOT verified

None of this has run on a phone.

- The Java plugins on Android: the access-point interface names `HotspotProbe` looks for, whether Android 11 and later let an app list that interface, the OEM settings screens in `SettingsTargets`, UDP broadcast reception while the phone is the access point, and the held connection through Doze and a backgrounded app.
- `@capacitor/geolocation` on real phones, including one without Google Play Services, and Android's own permission dialogs.
- A real Cantol: the protocol and ports are a placeholder (ADR-005 is not written); only `cantol-mock` and, for the handshake, the Red Pitaya running `cantol-pingpong.sh` have answered.
- The live stream on a phone: the bridge at one `frame` event every 50 ms (screen on and off), and the Red Pitaya's stream from `cantol-pingpong.sh` v0.2.0 (ADR-010).
- The WebView itself, other phones, Android's text size setting.

The first run on a phone is the spike ADR-003 asks for. Record what happens in `dev-docs/decisions/003-hotspot-topology-and-native-rp-transport.md` and feed the settings table and the interface names from the result.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Stuck on the welcome screen, "Still checking this phone" | A check of the phone failed or never answered; the line under it says which and why. After about 4 seconds the app goes on anyway and keeps re-checking. If you see this, report the line. (An earlier build got stuck here for good when location was off; fixed 2026-10-26.) |
| "A device answered at ... with MAC address ..., not the ... you entered" | Something answered the HELLO but its MAC address is not the one typed. Compare with the label: tap "Check the label values". If the device is right and the label was mistyped, correct it and the search restarts. If there is a second Cantol on the hotspot, this is the check working. |
| "... did not report a MAC address" | The device speaks the protocol but sends no MAC address (older firmware or software). The field build refuses it; the Cantol software must send the MAC (ADR-009). `cantol-pingpong.sh` and `cantol-mock` do. |
| "The app could not start: device profile ..." | The profile is invalid; the message names the field (never its value). The band is text of 1 to 20 characters; the two ports are different numbers from 1 to 65535. |
| The hotspot screen shows the wrong name or password | They are what was typed on the label screen. Tap "Not what the Cantol label says? Change". |
| The hotspot is on but the app still says Off | The interface name or address was not recognised (see `Hotspot interface` under Diagnostics). Tap "Continue anyway"; the next screen proves reachability. Report the interface name so it can be added. |
| "Open hotspot settings" lands on the general network settings | No exact hotspot screen was found for this phone; the hotspot is one level down. Report the phone model. |
| Waiting for Cantol never ends | The Cantol has not joined, or does not speak the placeholder protocol, or the profile's ports differ from its. Diagnostics shows the last attempt and why it failed. Try "Enter IP manually". |
| "Location is switched off on this phone" | Tap "Turn on location" and switch it on in the system screen; the app continues by itself. |
| "Start measurement" is greyed out | By design in this version (see step 6): the app sets up and checks the connection but cannot measure yet. Not a fault of the phone, the hotspot or the Cantol. |
| The Location row alternates between "On" and "No fix" while location is on | Fixed 2026-11-04. The app asked the geolocation plugin for a position only every 10 s (its default: the interval follows the `timeout`, and the fastest rate is 5 s) but calls 5 s without a fix "no fix". It now asks every second (`GPS_WATCH_INTERVAL_MS`). If it still happens, the phone really is not getting a fix: go outdoors or near a window. |
| "Open app settings" | Android will not ask again. Allow location for the app there and come back. |
| "Reconnecting" for more than 30 seconds | The app reopens the setup. Check the Cantol's power and that the hotspot is still on (some phones switch it off after a few idle minutes: turn off its automatic turn-off). |
| `env.sh: JDK 21 not found` on a Linux machine | Set `CANTOL_JAVA_HOME` and `CANTOL_ANDROID_HOME` first. |
| `verify-field-web.mjs`: "cantol-mock is not built" | `cargo build -p cantol-mock` in `mobile/rust`. |
| An APK is far larger than its contents | Gradle updates the APK in place across builds and leaves dead space. Delete `android/app/build` and build again for a true size. |

## Maintenance

- The settings screens are the data table in `android/app/src/main/java/id/cantol/mobile/link/SettingsTargets.java`; add what field results show, with the public fallbacks last (a test checks the order).
- The access-point interface names are one pattern in `HotspotProbe.java`; its test lists what must and must not match.
- The label values: validation is `src/core/cantolSetup.ts` (name 32 bytes, password 8 to 63 plain characters, MAC twelve hex digits); the check against the device is in `src/native/fieldLink.ts` (`handshake`); the screen is `src/screens/CantolSetupScreen.tsx`.
- The protocol lives in `mobile/rust/cantol-proto` (`handshake.rs` for the phone's side). Java only reads the length prefix in `FrameIo.java`; if the frame header changes, that constant and its test change with it.
- `src/field/deviceProfile.ts` repeats two paths as string literals (Vite requires it); its test fails if they drift from the constants.
- Never commit the local device profile, a hotspot password, the API key or a signing keystore.
