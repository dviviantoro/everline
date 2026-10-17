#!/usr/bin/env bash
# Source this file, do not run it:   source mobile/scripts/env.sh
#
# Pins the Android toolchain for this Mac. Gradle 8.14 fails on the default JDK 26 with
# "Unsupported class file major version 70", so JAVA_HOME must point at JDK 21; the Android SDK
# is the Homebrew cask install. Override with CANTOL_JAVA_HOME / CANTOL_ANDROID_HOME.

if ! (return 0 2>/dev/null); then
  echo "env.sh: source this file instead of running it:  source mobile/scripts/env.sh" >&2
  exit 1
fi

_cantol_jdk="${CANTOL_JAVA_HOME:-/usr/local/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home}"
_cantol_sdk="${CANTOL_ANDROID_HOME:-/usr/local/share/android-commandlinetools}"

if [ ! -x "$_cantol_jdk/bin/java" ]; then
  echo "env.sh: JDK 21 not found at $_cantol_jdk (brew install openjdk@21, or set CANTOL_JAVA_HOME)" >&2
  return 1
fi
if [ ! -d "$_cantol_sdk/platform-tools" ]; then
  echo "env.sh: Android SDK not found at $_cantol_sdk (or set CANTOL_ANDROID_HOME)" >&2
  return 1
fi

export JAVA_HOME="$_cantol_jdk"
export ANDROID_HOME="$_cantol_sdk"
export ANDROID_SDK_ROOT="$_cantol_sdk"

# Prepend once, so sourcing twice does not grow PATH.
for _cantol_dir in "$ANDROID_HOME/platform-tools" "$JAVA_HOME/bin"; do
  case ":$PATH:" in
    *":$_cantol_dir:"*) ;;
    *) PATH="$_cantol_dir:$PATH" ;;
  esac
done
export PATH

unset _cantol_jdk _cantol_sdk _cantol_dir
