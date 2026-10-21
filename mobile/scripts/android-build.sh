#!/usr/bin/env bash
# Build the debug APK: WASM, web bundle, Capacitor sync, then Gradle.
#
#   scripts/android-build.sh                 build the debug APK (the self-test screen only)
#   scripts/android-build.sh demo            build the demo APK: every screen, simulated data, no network
#   scripts/android-build.sh install         build, then `adb install -r` on the connected phone
#   scripts/android-build.sh demo install    both
#
# --no-daemon keeps Gradle's memory in check on an 8 GB Mac.
set -euo pipefail

demo=0
install=0
for arg in "$@"; do
  case "$arg" in
    demo) demo=1 ;;
    install) install=1 ;;
    *) echo "android-build: unknown argument '$arg' (use: demo, install)" >&2; exit 2 ;;
  esac
done

root="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=env.sh
source "$root/scripts/env.sh"
cd "$root"

[ -d node_modules ] || npm ci
if [ "$demo" = 1 ]; then
  npm run build:demo
else
  npm run build
fi
npx cap sync android

(cd android && ./gradlew --no-daemon assembleDebug)

apk="$root/android/app/build/outputs/apk/debug/app-debug.apk"
if [ "$demo" = 1 ]; then
  # A separate name, so a demo build is never mistaken for the normal one.
  cp "$apk" "$root/android/app/build/outputs/apk/debug/app-demo-debug.apk"
  apk="$root/android/app/build/outputs/apk/debug/app-demo-debug.apk"
fi
echo "APK: $apk ($(wc -c < "$apk" | tr -d ' ') bytes)"

if [ "$install" = 1 ]; then
  adb devices | sed -n '2,$p' | grep -q 'device$' || { echo "android-build: no phone connected (adb devices)" >&2; exit 1; }
  adb install -r "$apk"
fi
