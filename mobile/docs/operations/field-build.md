# Build and install the field APK

## What

How to build the Cantol Mobile **field** APK: the build whose hotspot check, Cantol link and GPS are real. It signs in, helps the operator turn on the phone's hotspot, waits for the Cantol device to join it and links to it, then asks for location and waits for a good fix, and ends on a "Ready to measure" screen with the three connections shown live. It cannot measure yet: "Start measurement" is disabled and says so (live measurement is TASK-006, upload TASK-007).

## Why

This is the connection half of the field flow (TASK-005), on real sources. The demo build (`demo-build.md`) shows the whole flow on simulated ones. Decision record: ADR-008 (Proposed).

## What the app can and cannot do about the hotspot

Android has no public API to switch the phone's hotspot on, or to set its name and password. So the app **cannot force** them. What it does (ADR-003):

1. Shows the network name, band and password the Cantol is set to join, with a Copy button.
2. Opens the phone's hotspot settings (the system screen where the operator types them once and switches the hotspot on). On some phones it can open the exact screen; on others only the general network settings, one level above.
3. Watches for the hotspot to come on and moves to the next step by itself.

After the first setup the phone remembers the hotspot, so each later session is one toggle.

## Prerequisites

The same as `build-apk.md` (JDK 21, Android SDK with platform 36, the pinned Rust toolchain and the `wasm-bindgen` CLI, Node 22.12 or newer). Both ends must agree on the hotspot: the name and password in the device profile (below) must be what the Cantol is configured to join.

## Step-by-step

1. From the repository root: `cd mobile && npm ci`.
2. Create your device profile: `cp config/device-profile.example.json config/device-profile.local.json`, then edit the network name, password (8 to 63 characters), band and the two ports. The local file is gitignored. Without it the build uses the example and **says so**: the hotspot name and password the app then shows will not match your Cantol.
3. `source scripts/env.sh` in every new shell. On a machine that is not the Mac, set `CANTOL_JAVA_HOME` and `CANTOL_ANDROID_HOME` first.
4. `scripts/android-build.sh field` builds the WASM module if it is stale, the field web bundle (`npm run build:field`), runs `cap sync`, then `gradlew assembleDebug`. The result is `android/app/build/outputs/apk/debug/app-field-debug.apk`.
5. Install: with a phone connected, `scripts/android-build.sh field install`, or `adb install -r <that path>`. Without a cable, copy the file to the phone and open it.
6. Run `scripts/check-no-secrets.sh` before any push. **An APK built with a real profile contains the hotspot password. Do not share it or commit it.**

### What to expect on the phone

1. Sign in with any email (the sign-in is a gate, not an account; the email is stored as the surveyor).
2. "Turn on your hotspot": set the name and password shown, then tap "Open hotspot settings". Turn the hotspot on. The app notices and moves on.
3. "Waiting for Cantol": power the Cantol on. It is found by its beacon or by a scan of the hotspot's network, then checked with a HELLO. A search that finds nothing for a minute offers "Enter IP manually" and "Diagnostics".
4. "Enable location": allow location, switch location on if it is off, wait for a fix of 25 m or better. A phone usually has location off to begin with: the first tap on "Enable GPS" then opens the system location settings (the permission cannot be asked for until location is on); switch it on, come back, and tap "Enable GPS" again for the permission dialog.
5. "Ready to measure": hotspot, Cantol (address and round trip) and location, each live. If one drops, the row says "Reconnecting" or "No fix" and the app recovers silently for 30 seconds before reopening the setup.

### Trying it without a Cantol

`cantol-mock` speaks the same placeholder protocol. On a laptop that has joined the phone's hotspot: `cd mobile/rust && cargo run -p cantol-mock` (it listens on 47000 and broadcasts its beacon on 47001, which are the example profile's ports). The phone should find it. This path has not been run on a phone.

## Verification

- `cd mobile/rust && cargo fmt --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace` (63 tests, including the handshake helpers against the live mock).
- `cd mobile && npm run typecheck && npm run lint && npm test` (194 tests: the adapters against a scripted phone network and the real WASM codec; two of them run the codec against the real `cantol-mock` when its binary is built).
- `scripts/verify-link-jvm.sh` runs the Java link tests (37), including one against the real `cantol-mock` with frames built by the real WASM codec.
- `cargo build -p cantol-mock` (in `mobile/rust`), then `node scripts/verify-field-web.mjs [--out <dir>]` runs the **field bundle with the real Capacitor bridge script and the real WASM** in headless Chromium, with a scripted stand-in for the Android side that forwards the link to the real mock over TCP. It walks every step above, the location permission refused twice and then allowed, a lost and a restored link, and a restart; and asserts that measurement is not offered, only the local origin is requested and the console stays quiet.
- `aapt2 dump badging <apk>`: package `id.cantol.mobile`, target SDK 36, permissions INTERNET, ACCESS_COARSE_LOCATION, ACCESS_FINE_LOCATION and ACCESS_NETWORK_STATE (the last from a plugin dependency), `allowBackup` false, no cleartext flag.
- The normal build still opens on the self-test only, digest `f7f47846`, and its bundle contains no field or demo code.

## What is NOT verified

None of this has run on a phone.

- The Java plugins on Android: the access-point interface names `HotspotProbe` looks for, whether Android 11 and later let an app list that interface, the OEM settings screens in `SettingsTargets`, UDP broadcast reception while the phone is the access point, and the held connection through Doze and a backgrounded app.
- `@capacitor/geolocation` on real phones, including one without Google Play Services, and Android's own permission dialogs.
- A real Cantol: the protocol and ports are a placeholder (ADR-005 is not written); only `cantol-mock` has answered.
- The WebView itself, other phones, Android's text size setting.

The first run on a phone is the spike ADR-003 asks for. Record what happens in `dev-docs/decisions/003-hotspot-topology-and-native-rp-transport.md` and feed the settings table and the interface names from the result.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Stuck on the welcome screen, "Still checking this phone" | A check of the phone failed or never answered; the line under it says which and why. After about 4 seconds the app goes on anyway and keeps re-checking. If you see this, report the line. (An earlier build got stuck here for good when location was off; fixed 2026-10-26.) |
| The hotspot screen shows "CANTOL-EXAMPLE" and "change-me-example" | The build used the example profile. Create `config/device-profile.local.json` and rebuild. |
| "The app could not start: device profile ..." | The profile is invalid; the message names the field (never its value). Network name 1 to 32 characters, password 8 to 63, two different ports from 1 to 65535. |
| The hotspot is on but the app still says Off | The interface name or address was not recognised (see `Hotspot interface` under Diagnostics). Tap "Continue anyway"; the next screen proves reachability. Report the interface name so it can be added. |
| "Open hotspot settings" lands on the general network settings | No exact hotspot screen was found for this phone; the hotspot is one level down. Report the phone model. |
| Waiting for Cantol never ends | The Cantol has not joined, or does not speak the placeholder protocol, or the profile's ports differ from its. Diagnostics shows the last attempt and why it failed. Try "Enter IP manually". |
| "Location is switched off on this phone" | Tap "Turn on location" and switch it on in the system screen; the app continues by itself. |
| "Open app settings" | Android will not ask again. Allow location for the app there and come back. |
| "Reconnecting" for more than 30 seconds | The app reopens the setup. Check the Cantol's power and that the hotspot is still on (some phones switch it off after a few idle minutes: turn off its automatic turn-off). |
| `env.sh: JDK 21 not found` on a Linux machine | Set `CANTOL_JAVA_HOME` and `CANTOL_ANDROID_HOME` first. |
| `verify-field-web.mjs`: "cantol-mock is not built" | `cargo build -p cantol-mock` in `mobile/rust`. |
| An APK is far larger than its contents | Gradle updates the APK in place across builds and leaves dead space. Delete `android/app/build` and build again for a true size. |

## Maintenance

- The settings screens are the data table in `android/app/src/main/java/id/cantol/mobile/link/SettingsTargets.java`; add what field results show, with the public fallbacks last (a test checks the order).
- The access-point interface names are one pattern in `HotspotProbe.java`; its test lists what must and must not match.
- The protocol lives in `mobile/rust/cantol-proto` (`handshake.rs` for the phone's side). Java only reads the length prefix in `FrameIo.java`; if the frame header changes, that constant and its test change with it.
- `src/field/deviceProfile.ts` repeats two paths as string literals (Vite requires it); its test fails if they drift from the constants.
- Never commit the local device profile, the hotspot password, the API key or a signing keystore.
