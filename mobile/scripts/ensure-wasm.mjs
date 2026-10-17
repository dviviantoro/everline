// Rebuild src/wasm-pkg when it is missing or older than any Rust source, so typecheck, lint,
// test and build never run against a stale or absent WASM module. A no-op when up to date.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const wasmFile = join(root, 'src', 'wasm-pkg', 'cantol_wasm_bg.wasm');
const rustRoot = join(root, 'rust');

/** Newest modification time of the Rust inputs (sources, manifests, lockfile). */
function newestRustInput(dir) {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'target' || entry.name === 'vectors') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      newest = Math.max(newest, newestRustInput(path));
    } else if (/\.rs$|Cargo\.(toml|lock)$|rust-toolchain\.toml$/.test(entry.name)) {
      newest = Math.max(newest, statSync(path).mtimeMs);
    }
  }
  return newest;
}

const stale = !existsSync(wasmFile) || statSync(wasmFile).mtimeMs < newestRustInput(rustRoot);
if (stale) {
  console.log('ensure-wasm: building the WASM module');
  execFileSync('bash', [join(root, 'scripts', 'build-wasm.sh')], { stdio: 'inherit' });
} else {
  console.log('ensure-wasm: up to date');
}
