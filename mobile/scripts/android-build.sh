#!/usr/bin/env bash
# Build the debug APK: WASM, web bundle, Capacitor sync, then Gradle.
#
#   scripts/android-build.sh          build the debug APK
#   scripts/android-build.sh install  build, then `adb install -r` on the connected phone
#
# --no-daemon keeps Gradle's memory in check on an 8 GB Mac.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=env.sh
source "$root/scripts/env.sh"
cd "$root"

[ -d node_modules ] || npm ci
npm run build
npx cap sync android

(cd android && ./gradlew --no-daemon assembleDebug)

apk="$root/android/app/build/outputs/apk/debug/app-debug.apk"
echo "APK: $apk ($(wc -c < "$apk" | tr -d ' ') bytes)"

if [ "${1:-}" = "install" ]; then
  adb devices | sed -n '2,$p' | grep -q 'device$' || { echo "android-build: no phone connected (adb devices)" >&2; exit 1; }
  adb install -r "$apk"
fi
