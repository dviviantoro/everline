# Build and install the Android debug APK

## What

How to build the Cantol Mobile debug APK on the development Mac, install it on a phone, and read the self-test result.

## Why

The app is a Capacitor shell around a Vite web bundle and a Rust WASM module. The Android build depends on a specific toolchain (JDK 21, a matching `wasm-bindgen` CLI, the Android SDK), and the wrong JDK fails in a confusing way. This page is the single place that records the working setup.

## Prerequisites

- macOS with Homebrew. Node 22.12 or newer.
- JDK 21: `brew install openjdk@21` (the default JDK 26 breaks Gradle 8.14).
- Android SDK command-line tools with platform 36, build-tools 35 or 36, and platform-tools, in the Homebrew cask location. Override the locations with `CANTOL_JAVA_HOME` and `CANTOL_ANDROID_HOME` if yours differ.
- Rust through rustup. The toolchain is pinned in `mobile/rust/rust-toolchain.toml` and installs itself on first use, with the `wasm32-unknown-unknown` target.
- The `wasm-bindgen` CLI at exactly the version in `mobile/rust/Cargo.lock` (`cargo install wasm-bindgen-cli --version <version> --locked`).
- Optional: `wasm-opt` (binaryen) on PATH, or the copy that `wasm-pack` caches. Without it the module is a few KB larger.
- For installing: a phone with Developer options and USB debugging on, connected by cable.

## Step-by-step

1. From the repository root: `cd mobile && npm ci`.
2. `source scripts/env.sh` (pins `JAVA_HOME`, `ANDROID_HOME` and puts `adb` on PATH). Run it in every new shell.
3. `scripts/android-build.sh` builds the WASM module if it is stale, the web bundle, runs `cap sync`, then `gradlew assembleDebug`.
4. To install on the connected phone: `scripts/android-build.sh install`, or `adb install -r android/app/build/outputs/apk/debug/app-debug.apk`.
5. Open "Cantol Mobile" on the phone. The self-test runs on start.
6. To read the result from the computer: `adb logcat | grep cantol-selftest` (the app logs one JSON line with that tag; not yet confirmed on a device, so if nothing appears use Chrome's `chrome://inspect` remote debugging).

## Verification

- The script ends with `BUILD SUCCESSFUL` and prints the APK path (about 4.2 MB).
- `$ANDROID_HOME/build-tools/36.0.0/aapt2 dump badging <apk>` shows package `id.cantol.mobile`, target SDK 36 and only the INTERNET permission.
- On the phone the self-test shows PASS and the digest `f7f47846`, the same as `npm test` prints on the Mac.
- Before building, `cd mobile && npm run typecheck && npm run lint && npm test` and `cd rust && cargo test --workspace` should all pass.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `Unsupported class file major version 70` | Gradle ran on JDK 26. Run `source scripts/env.sh` in this shell. |
| `build-wasm: the wasm-bindgen crate is X but the CLI is Y` | Install the CLI version the script names, or change the pinned crate version in `rust/Cargo.toml`. |
| `adb: command not found` | `source scripts/env.sh`. |
| `adb devices` lists nothing | Check the cable and USB debugging; accept the RSA prompt on the phone. |
| Self-test says "WASM could not run" | Copy the error text. Most likely the Android System WebView is too old for the WASM features; update it from the Play Store and record the version shown on the screen. |
| UI looks unstyled or broken | The WebView is older than Chrome 111, which Tailwind 4 needs (see ADR-002). |
| Digest differs from `f7f47846` | The vectors or decoder changed, or a real defect. Run `cargo test` and `npm test` first. |
| Gradle runs out of memory | Close other apps; the script already uses `--no-daemon` and `android/gradle.properties` sets `-Xmx1536m`. |

## Maintenance

- Capacitor: bump with `npm install @capacitor/core@latest @capacitor/android@latest @capacitor/cli@latest`, then `npx cap migrate` and rebuild. Check `npm audit` afterwards; do not use `--force`.
- Rust toolchain: edit `rust/rust-toolchain.toml`, then re-run `cargo test --workspace` and `scripts/build-wasm.sh`.
- Golden vectors: regenerate only after a deliberate protocol change with `UPDATE_VECTORS=1 cargo test -p cantol-proto --test vectors`, and review the diff.
- Never commit the hotspot name or password, the API key, or a signing keystore; they live in gitignored local files.
