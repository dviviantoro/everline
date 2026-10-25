// Prints the HELLO and PING frames the app sends, as hex, built by the real WASM codec.
// Used by scripts/verify-link-jvm.sh to feed the Java link tests; nothing else needs it.
//   node scripts/link-frames-hex.mjs     ->  CANTOL_HELLO_HEX=...  CANTOL_PING_HEX=...
import { readFileSync } from 'node:fs';

import * as wasm from '../src/wasm-pkg/cantol_wasm.js';

wasm.initSync({ module: readFileSync(new URL('../src/wasm-pkg/cantol_wasm_bg.wasm', import.meta.url)) });
const hex = (bytes) => Buffer.from(bytes).toString('hex');
console.log(`CANTOL_HELLO_HEX=${hex(wasm.encode_hello(0x1234abcd, Date.now()))}`);
console.log(`CANTOL_PING_HEX=${hex(wasm.encode_ping(1))}`);
