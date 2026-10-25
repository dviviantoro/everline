#!/usr/bin/env bash
# Runs the Java link tests, including the one that talks to the real cantol-mock with frames
# built by the real WASM codec. Needs the toolchain of build-apk.md (source scripts/env.sh first,
# or set CANTOL_JAVA_HOME and CANTOL_ANDROID_HOME) and a built WASM module (npm run wasm).
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=env.sh
source "$root/scripts/env.sh"
cd "$root"

port=47311
(cd rust && cargo build -q -p cantol-mock)
rust/target/debug/cantol-mock --bind 127.0.0.1 --port "$port" --no-beacon 2>/dev/null &
mock=$!
trap 'kill "$mock" 2>/dev/null || true' EXIT
sleep 1

# `export` of the two lines the helper prints: CANTOL_HELLO_HEX and CANTOL_PING_HEX.
while IFS= read -r line; do export "$line"; done < <(node scripts/link-frames-hex.mjs)
export CANTOL_MOCK_PORT="$port"

(cd android && ./gradlew --no-daemon testDebugUnitTest --tests 'id.cantol.mobile.link.*' --rerun-tasks)
