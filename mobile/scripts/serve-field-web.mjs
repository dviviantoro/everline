// A web version of the field app, for trying the Cantol from a computer when no phone is at hand.
//
//   node scripts/serve-field-web.mjs --cantol rp-XXXXXX.local [--port 4190] [--no-build] [--verbose]
//
// It serves the real field bundle (VITE_FIELD=1), the real Capacitor bridge script and the real WASM codec.
// What a phone's Java and Kotlin would do is done here by scripts/lib/phone-standin.mjs: the hotspot is "on",
// location is allowed, a scan finds the Cantol you name, and the held link, the frames and the heartbeat go
// over real TCP to it. The GPS is simulated (a walk along a line), because a computer has none worth walking.
//
// It is not the phone: nothing here is Android, a hotspot, Wi-Fi or real GPS. Use it to see the Live and
// Tracking screens work against a real Cantol, not to judge field behaviour.
//
// Safety: it listens on 127.0.0.1 only unless --bind says otherwise, only accepts requests that carry its own
// Host and Origin, and lets the page open connections to the one Cantol you named and nothing else.
import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createPhone, HEADERS, watchTimers } from './lib/phone-standin.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const option = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
const flag = (name) => argv.includes(name);

if (flag('--help') || !flag('--cantol')) {
  console.log(
    'usage: node scripts/serve-field-web.mjs --cantol <host[:port]> [--port 4190] [--bind 127.0.0.1] [--dist <dir>] [--no-build]\n' +
      '                                       [--walk-mps 1.2] [--verbose]\n' +
      '  --cantol    the Cantol to link to (its address or name; port 47000 unless given)\n' +
      '  --dist      serve an already built field bundle instead of building one\n' +
      '  --walk-mps  speed of the simulated GPS along a line, metres a second (0 stands still; default 1.2)',
  );
  process.exit(flag('--help') ? 0 : 2);
}

const [cantolHost, cantolPortText] = option('--cantol').split(':');
const cantolPort = Number(cantolPortText ?? 47000);
const listenPort = Number(option('--port', 4190));
const bindAddress = option('--bind', '127.0.0.1');
const walkMps = Number(option('--walk-mps', 1.2));
const verbose = flag('--verbose');
const BRIDGE = join(root, 'node_modules', '@capacitor', 'android', 'capacitor', 'src', 'main', 'assets', 'native-bridge.js');

if (!Number.isInteger(cantolPort) || cantolPort < 1 || cantolPort > 65535) throw new Error(`bad port in --cantol: ${cantolPortText}`);
if (!existsSync(BRIDGE)) throw new Error('node_modules is missing the Capacitor bridge: run npm ci in mobile/');

// ----- the bundle
let dist = option('--dist');
if (dist === undefined) {
  dist = mkdtempSync(join(tmpdir(), 'everline-field-web-'));
  if (!flag('--no-build')) {
    console.log('Building the field bundle ...');
    execFileSync('npx', ['vite', 'build', '--outDir', dist, '--emptyOutDir'], {
      cwd: root,
      stdio: verbose ? 'inherit' : 'ignore',
      env: { ...process.env, VITE_FIELD: '1' },
    });
  }
}
if (!existsSync(join(dist, 'index.html'))) throw new Error(`no index.html in ${dist}: build the field bundle first (or drop --no-build)`);

// ----- the phone
const clients = new Set();
const backlog = [];
const respond = (result) => {
  const line = `data: ${JSON.stringify(result)}\n\n`;
  if (clients.size === 0) backlog.push(line);
  for (const client of clients) client.write(line);
};

// A walk along a line (east), from a fixed start: what the free walk's "distance between stops" reads.
const walkStart = { latitude: -6.8897, longitude: 109.6753 };
const walkBegan = Date.now();
const METRES_PER_DEGREE_LONGITUDE = 111_320 * Math.cos((walkStart.latitude * Math.PI) / 180);
const position = () => ({
  latitude: walkStart.latitude,
  longitude: walkStart.longitude + (walkMps * ((Date.now() - walkBegan) / 1000)) / METRES_PER_DEGREE_LONGITUDE,
  accuracy: 4.0,
});

const phone = createPhone(respond, {
  port: cantolPort,
  scanHosts: [cantolHost],
  allow: (host, port) => host === cantolHost && port === cantolPort,
  position,
  keepAlive: true,
});
// A phone with everything on, so the first-run checks pass and the label screen is the first thing asked.
Object.assign(phone, { hotspotOn: true, locationOn: true, gnssBroken: false, permission: 'granted' });

/** The page reloaded: it is a new app run, so what the old run held is dropped. */
function resetRun() {
  phone.held?.destroy();
  Object.assign(phone, { held: null, heldHost: null, listeners: [] });
  for (const timer of phone.watchers.values()) clearInterval(timer);
  phone.watchers.clear();
}

// ----- the page
const initScript = `<script>
window.androidBridge = { postMessage: function (m) { fetch('/__phone/call', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: m }).catch(function () {}); } };
window.Capacitor = { PluginHeaders: ${JSON.stringify(HEADERS)} };
</script>
<script src="/__phone/native-bridge.js"></script>
<script>
(function () {
  var source = new EventSource('/__phone/events');
  source.onmessage = function (e) { window.androidBridge.onmessage({ data: e.data }); };
})();
</script>`;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

const localNames = new Set(['localhost', '127.0.0.1', '[::1]']);
const hostOk = (req) => {
  if (bindAddress !== '127.0.0.1' && bindAddress !== 'localhost') return true; // the person chose to share it
  const name = (req.headers.host ?? '').replace(/:\d+$/, '');
  return localNames.has(name);
};
const originOk = (req) => {
  const origin = req.headers.origin;
  return origin === undefined || origin === `http://${req.headers.host}`;
};

const server = http.createServer((req, res) => {
  if (!hostOk(req) || !originOk(req)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  const url = new URL(req.url ?? '/', 'http://local');

  if (url.pathname === '/__phone/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write(': connected\n\n');
    resetRun();
    clients.add(res);
    for (const line of backlog.splice(0)) res.write(line);
    req.on('close', () => clients.delete(res));
    return;
  }

  if (url.pathname === '/__phone/call' && req.method === 'POST') {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) req.destroy();
    });
    req.on('end', async () => {
      res.writeHead(204).end();
      let call;
      try {
        call = JSON.parse(raw);
      } catch {
        return;
      }
      if (verbose) console.log(`  [native] ${call.pluginId}.${call.methodName} ${JSON.stringify(call.options ?? {}).slice(0, 120)}`);
      try {
        const data = await phone.handle(call);
        if (data !== undefined) respond({ callbackId: call.callbackId, pluginId: call.pluginId, methodName: call.methodName, success: true, data });
      } catch (error) {
        if (verbose) console.log(`  [native] ${call.pluginId}.${call.methodName} failed: ${error.message}`);
        respond({
          callbackId: call.callbackId,
          pluginId: call.pluginId,
          methodName: call.methodName,
          success: false,
          error: { message: error.message, code: error.code },
        });
      }
    });
    return;
  }

  if (url.pathname === '/__phone/native-bridge.js') {
    res.writeHead(200, { 'Content-Type': TYPES['.js'], 'Cache-Control': 'no-store' }).end(readFileSync(BRIDGE));
    return;
  }

  // The bundle. A path that leaves the folder is refused.
  let relative = decodeURIComponent(url.pathname);
  if (relative === '/' || relative === '') relative = '/index.html';
  const file = normalize(join(dist, relative));
  if (!file.startsWith(dist + sep) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404).end('not found');
    return;
  }
  if (relative === '/index.html') {
    const html = readFileSync(file, 'utf8').replace('<head>', `<head>\n${initScript}`);
    res.writeHead(200, { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-store' }).end(html);
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});

server.listen(listenPort, bindAddress, () => {
  console.log(`Field app (web version) at http://${bindAddress === '0.0.0.0' ? 'localhost' : bindAddress}:${String(listenPort)}/`);
  console.log(`Linked Cantol: ${cantolHost}:${String(cantolPort)}   simulated GPS: ${String(walkMps)} m/s east`);
  if (bindAddress !== '127.0.0.1' && bindAddress !== 'localhost') console.log('WARNING: anyone who can reach this port can use the app and its link to the Cantol.');
  console.log('Sign in with any email and password. Enter the SSID and password of the label (anything of the right length) and the Cantol\'s MAC address.');
});

const stop = () => {
  for (const timer of watchTimers) clearInterval(timer);
  phone.held?.destroy();
  server.close();
  setTimeout(() => process.exit(0), 200).unref();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
