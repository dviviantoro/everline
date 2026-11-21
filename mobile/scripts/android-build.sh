#!/usr/bin/env bash
# Build the debug APK: WASM, web bundle, Capacitor sync, then Gradle.
#
#   scripts/android-build.sh                 build the debug APK (the self-test screen only)
#   scripts/android-build.sh demo            build the demo APK: every screen, simulated data, no network
#   scripts/android-build.sh field           build the field APK: the real hotspot, Cantol link and GPS
#   scripts/android-build.sh install         build, then `adb install -r` on the connected phone
#   scripts/android-build.sh field install   both (demo or field, with install)
#
# --no-daemon keeps Gradle's memory in check on an 8 GB Mac.
set -euo pipefail

demo=0
field=0
install=0
for arg in "$@"; do
  case "$arg" in
    demo) demo=1 ;;
    field) field=1 ;;
    install) install=1 ;;
    *) echo "android-build: unknown argument '$arg' (use: demo, field, install)" >&2; exit 2 ;;
  esac
done
if [ "$demo" = 1 ] && [ "$field" = 1 ]; then
  echo "android-build: choose demo or field, not both" >&2
  exit 2
fi

root="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=env.sh
source "$root/scripts/env.sh"
cd "$root"

[ -d node_modules ] || npm ci
if [ "$demo" = 1 ]; then
  npm run build:demo
elif [ "$field" = 1 ]; then
  # The profile holds only the band and the two ports (the example is right for a stock unit). The
  # hotspot name, password and MAC address are typed on the phone from the Cantol's label.
  if [ -f config/device-profile.local.json ] && grep -Eq '"(ssid|password)"' config/device-profile.local.json; then
    echo "android-build: config/device-profile.local.json has an ssid or password. They are no longer read:" >&2
    echo "  the operator types them from the Cantol's label on the phone. Remove them from the file." >&2
  fi
  npm run build:field
else
  npm run build
fi
npx cap sync android

(cd android && ./gradlew --no-daemon assembleDebug)

apk="$root/android/app/build/outputs/apk/debug/app-debug.apk"
for variant in demo field; do
  if [ "${!variant}" = 1 ]; then
    # A separate name, so a demo or field build is never mistaken for the normal one.
    cp "$apk" "$root/android/app/build/outputs/apk/debug/app-$variant-debug.apk"
    apk="$root/android/app/build/outputs/apk/debug/app-$variant-debug.apk"
  fi
done
echo "APK: $apk ($(wc -c < "$apk" | tr -d ' ') bytes)"

if [ "$install" = 1 ]; then
  adb devices | sed -n '2,$p' | grep -q 'device$' || { echo "android-build: no phone connected (adb devices)" >&2; exit 1; }
  adb install -r "$apk"
fi
