#!/usr/bin/env bash
# Build the Rust WASM module and its JavaScript glue into mobile/src/wasm-pkg.
#
#   cargo builds the wasm32 module with the size-optimised `wasm-release` profile,
#   wasm-bindgen generates the ES-module glue (--target web),
#   wasm-opt shrinks the module when it is available (skipped with a notice otherwise).
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root/rust"

# The wasm-bindgen CLI and the wasm-bindgen crate must be the exact same version.
crate_version="$(awk '/^name = "wasm-bindgen"$/ { getline; gsub(/"/, "", $3); print $3; exit }' Cargo.lock)"
cli_version="$(wasm-bindgen --version | awk '{ print $2 }')"
if [ "$crate_version" != "$cli_version" ]; then
  echo "build-wasm: the wasm-bindgen crate is $crate_version but the CLI is $cli_version; they must match." >&2
  echo "            install the matching CLI:  cargo install wasm-bindgen-cli --version $crate_version --locked" >&2
  exit 1
fi

cargo build -p cantol-wasm --target wasm32-unknown-unknown --profile wasm-release --locked

out="$root/src/wasm-pkg"
rm -rf "$out"
mkdir -p "$out"
wasm-bindgen --target web --out-dir "$out" --out-name cantol_wasm \
  target/wasm32-unknown-unknown/wasm-release/cantol_wasm.wasm

wasm_file="$out/cantol_wasm_bg.wasm"
before="$(wc -c < "$wasm_file" | tr -d ' ')"

# wasm-pack keeps a downloaded copy of wasm-opt in its cache; use PATH first, then that.
wasm_opt="$(command -v wasm-opt || true)"
if [ -z "$wasm_opt" ]; then
  wasm_opt="$(find "$HOME/Library/Caches/.wasm-pack" "$HOME/.cache/.wasm-pack" -path '*/bin/wasm-opt' 2>/dev/null | head -n 1 || true)"
fi

if [ -n "$wasm_opt" ]; then
  # Enable exactly the post-MVP features rustc emits, or wasm-opt rejects the module.
  if "$wasm_opt" -Oz \
      --enable-bulk-memory --enable-sign-ext --enable-nontrapping-float-to-int \
      --enable-mutable-globals --enable-multivalue --enable-reference-types \
      "$wasm_file" -o "$wasm_file.opt"; then
    mv "$wasm_file.opt" "$wasm_file"
  else
    rm -f "$wasm_file.opt"
    echo "build-wasm: wasm-opt failed; keeping the unoptimised module" >&2
  fi
else
  echo "build-wasm: wasm-opt not found; keeping the module as cargo built it" >&2
fi

after="$(wc -c < "$wasm_file" | tr -d ' ')"
echo "build-wasm: cantol_wasm_bg.wasm ${before} -> ${after} bytes (budget 250000)"
