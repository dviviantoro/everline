// Drives the field build (VITE_FIELD=1) in headless Chromium, end to end except for Java:
//
//   - the real field bundle, the real Capacitor JavaScript bridge (native-bridge.js from
//     @capacitor/android, the file the APK injects) and the real WASM codec run unchanged;
//   - the Android side is a scripted stand-in behind `window.androidBridge`: it answers the three
//     app plugins and @capacitor/geolocation the way the phone would, and forwards `exchange` and
//     `connect` over real TCP to the real `cantol-mock`;
//   - the Java plugins themselves are checked separately (scripts/verify-link-jvm.sh).
//
// It walks sign in, hotspot off then on, finding and linking Cantol, the location permission being
// refused twice and then allowed, location services off then on, the Ready screen, a lost and a
// restored link, and a restart; it asserts what the field build must NOT offer (measurement), that
// only the local origin is requested, and that the console stays quiet. It does not replace a
// phone: nothing here runs the Android WebView, the real hotspot, Wi-Fi or GPS.
//
//   cargo build -p cantol-mock   (in mobile/rust)  &&  node scripts/verify-field-web.mjs [--out <dir>]
//
// Chromium: $CHROMIUM_PATH, or the newest headless shell Playwright has downloaded.
/* global window, document */
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import net from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const outDir = args.includes('--out') ? args[args.indexOf('--out') + 1] : join(tmpdir(), 'everline-field-verify');
const verbose = args.includes('--verbose');
const PREVIEW_PORT = 4181;
const URL_BASE = `http://localhost:${String(PREVIEW_PORT)}/`;
const MOCK = join(root, 'rust', 'target', 'debug', 'cantol-mock');
// The port in config/device-profile.example.json, which the build uses when no local profile exists.
const MOCK_PORT = 47000;
const BRIDGE = join(root, 'node_modules', '@capacitor', 'android', 'capacitor', 'src', 'main', 'assets', 'native-bridge.js');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const cache = join(homedir(), '.cache', 'ms-playwright');
  if (!existsSync(cache)) return undefined;
  for (const dir of readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell-')).sort().reverse()) {
    const base = join(cache, dir);
    for (const sub of readdirSync(base)) {
      for (const exe of ['chrome-headless-shell', 'headless_shell']) {
        if (existsSync(join(base, sub, exe))) return join(base, sub, exe);
      }
    }
  }
  return undefined;
}

const failures = [];
const notes = [];
let assertions = 0;
function expect(condition, message) {
  assertions += 1;
  if (!condition) failures.push(message);
}

// ---------------------------------------------------------------------------------------------
// The stand-in for the Android side

/** What Capacitor's Android side injects so `registerPlugin` knows each plugin's methods. */
const promise = (...names) => names.map((name) => ({ name, rtype: 'promise' }));
const events = [{ name: 'addListener', rtype: 'none' }, { name: 'removeListener', rtype: 'none' }];
const HEADERS = [
  { name: 'HotspotAssistant', methods: promise('isOn', 'openSettings') },
  {
    name: 'CantolLink',
    methods: [...promise('scan', 'listenBeacon', 'exchange', 'connect', 'disconnect', 'linkStatus', 'getLastKnown', 'setLastKnown', 'diagnostics'), ...events],
  },
  { name: 'GnssHelper', methods: promise('servicesEnabled', 'openLocationSettings', 'openAppSettings') },
  {
    name: 'Geolocation',
    methods: [...promise('checkPermissions', 'requestPermissions', 'getCurrentPosition', 'clearWatch'), { name: 'watchPosition', rtype: 'callback' }],
  },
  { name: 'App', methods: [...promise('exitApp', 'getInfo', 'getState'), ...events] },
  { name: 'StatusBar', methods: promise('setStyle', 'setBackgroundColor', 'setOverlaysWebView', 'show', 'hide', 'getInfo') },
];

const HEADER_LEN = 21;
const CRC_LEN = 4;

/** One whole frame from a socket, by the length prefix (a test double of what FrameIo does in Java). */
function readFrame(socket, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0);
    const timer = setTimeout(() => finish(new Error('Read timed out'), 'timeout'), timeoutMs);
    const finish = (error, code, frame) => {
      clearTimeout(timer);
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('close', onClose);
      if (error) reject(Object.assign(error, { code }));
      else resolve(frame);
    };
    const onData = (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (buf.length >= HEADER_LEN) {
        if (buf[0] !== 0x57 || buf[1] !== 0xca) return finish(new Error('not a Cantol frame (bad magic)'), 'io');
        const total = HEADER_LEN + buf.readUInt32LE(17) + CRC_LEN;
        if (buf.length >= total) finish(null, null, buf.subarray(0, total));
      }
    };
    const onError = (error) => finish(error, 'io');
    const onClose = () => finish(new Error('the link was closed'), 'io');
    socket.on('data', onData);
    socket.once('error', onError);
    socket.once('close', onClose);
  });
}

function connectSocket(host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(Object.assign(new Error('Connect timed out'), { code: 'timeout' }));
    }, timeoutMs);
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.setNoDelay(true);
      resolve(socket);
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      reject(Object.assign(error, { code: error.code === 'ECONNREFUSED' ? 'refused' : 'io' }));
    });
  });
}

/** Every GPS watch timer, so the process can end. */
const watchTimers = new Set();

function createPhone(respond) {
  const phone = {
    hotspotOn: false,
    locationOn: true,
    permission: 'prompt',
    permissionRequests: 0,
    blockExchange: false,
    lastKnown: undefined,
    held: null,
    heldHost: null,
    lastRx: 0,
    heldRtt: NaN,
    heartbeat: null,
    heldPort: MOCK_PORT,
    calls: [],
    exchanged: [],
    connects: [],
    scans: [],
    listeners: [],
    watchers: new Map(),
  };

  const emit = (pluginId, eventName, data) => {
    for (const l of phone.listeners) {
      if (l.pluginId === pluginId && l.eventName === eventName) {
        respond({ callbackId: l.callbackId, pluginId, methodName: eventName, success: true, data, save: true });
      }
    }
  };

  async function hold(host, port, heartbeat) {
    const socket = await connectSocket(host, port, 1500);
    const started = Date.now();
    socket.write(heartbeat);
    await readFrame(socket, 2000);
    phone.heldRtt = Date.now() - started;
    phone.lastRx = Date.now();
    // Whatever the mock sends from now on (its periodic status) proves the link is alive.
    socket.on('data', () => {
      phone.lastRx = Date.now();
    });
    socket.on('error', () => undefined);
    phone.held = socket;
    phone.heldHost = host;
    phone.heldPort = port;
    phone.heartbeat = heartbeat;
    return phone.heldRtt;
  }

  phone.loseLink = () => {
    phone.blockExchange = true;
    phone.held?.destroy();
    phone.held = null;
    emit('CantolLink', 'linkState', { state: 'lost', detail: 'no answer within 2000 ms' });
  };
  phone.restoreLink = async () => {
    phone.blockExchange = false;
    if (phone.heldHost !== null) await hold(phone.heldHost, phone.heldPort, phone.heartbeat);
    emit('CantolLink', 'linkState', { state: 'up', detail: 'reconnected' });
  };

  phone.handle = async ({ pluginId, methodName, options, callbackId }) => {
    phone.calls.push(`${pluginId}.${methodName}`);
    if (methodName === 'addListener') {
      phone.listeners.push({ pluginId, eventName: options.eventName, callbackId });
      return undefined; // kept alive; events arrive later
    }
    if (methodName === 'removeListener') {
      // Capacitor passes the original listener as this call's own callback, so a reply here would
      // fire it (a "backButton" listener would navigate back). The real Android side stays silent.
      phone.listeners = phone.listeners.filter((l) => l.callbackId !== options.callbackId);
      return undefined;
    }
    const key = `${pluginId}.${methodName}`;
    switch (key) {
      case 'HotspotAssistant.isOn':
        return phone.hotspotOn ? { on: true, iface: 'ap0', address: '127.0.0.1', prefix: 24 } : { on: false };
      case 'HotspotAssistant.openSettings':
        setTimeout(() => {
          phone.hotspotOn = true;
        }, 1500);
        return { index: 0, label: 'Tethering settings', exact: true };
      case 'CantolLink.scan':
        phone.scans.push(options);
        await sleep(300);
        return phone.hotspotOn ? { subnet: '127.0.0.1/24', scanned: 253, hosts: ['127.0.0.1'] } : { scanned: 0, hosts: [] };
      case 'CantolLink.listenBeacon':
        await sleep(options.timeoutMs ?? 1500);
        return { timedOut: true };
      case 'CantolLink.exchange': {
        phone.exchanged.push({ host: options.host, port: options.port, frame: Buffer.from(options.dataB64, 'base64') });
        if (phone.blockExchange) throw Object.assign(new Error('Read timed out'), { code: 'timeout' });
        const socket = await connectSocket(options.host, options.port, options.connectTimeoutMs ?? 800);
        try {
          const started = process.hrtime.bigint();
          socket.write(Buffer.from(options.dataB64, 'base64'));
          const frame = await readFrame(socket, options.readTimeoutMs ?? 1500);
          return { replyB64: frame.toString('base64'), rttMs: Number(process.hrtime.bigint() - started) / 1e6 };
        } finally {
          socket.destroy();
        }
      }
      case 'CantolLink.connect': {
        const heartbeat = Buffer.from(options.heartbeatB64, 'base64');
        phone.connects.push({ host: options.host, port: options.port, heartbeat, intervalMs: options.intervalMs });
        const rttMs = await hold(options.host, options.port, heartbeat);
        phone.lastKnown = options.host;
        return { rttMs };
      }
      case 'CantolLink.disconnect':
        phone.held?.destroy();
        phone.held = null;
        phone.heldHost = null;
        return {};
      case 'CantolLink.linkStatus':
        return phone.held === null
          ? { connected: false }
          : { connected: true, host: phone.heldHost, lastRxAgeMs: Date.now() - phone.lastRx, rttMs: phone.heldRtt };
      case 'CantolLink.getLastKnown':
        return phone.lastKnown === undefined ? {} : { address: phone.lastKnown };
      case 'CantolLink.setLastKnown':
        phone.lastKnown = options.address;
        return {};
      case 'CantolLink.diagnostics':
        return { rows: [{ label: 'Hotspot interface', value: phone.hotspotOn ? 'ap0 127.0.0.1/24' : 'none found' }] };
      case 'GnssHelper.servicesEnabled':
        return { enabled: phone.locationOn };
      case 'GnssHelper.openLocationSettings':
        setTimeout(() => {
          phone.locationOn = true;
        }, 1000);
        return {};
      case 'GnssHelper.openAppSettings':
        // The operator allows location in the app's settings and comes back.
        setTimeout(() => {
          phone.permission = 'granted';
        }, 800);
        return {};
      case 'Geolocation.checkPermissions':
        return { location: phone.permission, coarseLocation: phone.permission };
      case 'Geolocation.requestPermissions':
        phone.permissionRequests += 1;
        // Android: "prompt" -> refused once -> "prompt-with-rationale" -> refused again -> "denied" (blocked).
        if (phone.permission !== 'granted') phone.permission = phone.permissionRequests === 1 ? 'prompt-with-rationale' : 'denied';
        return { location: phone.permission, coarseLocation: phone.permission };
      case 'Geolocation.watchPosition': {
        const timer = setInterval(() => {
          if (!phone.locationOn || phone.permission !== 'granted') return;
          respond({
            callbackId,
            pluginId,
            methodName,
            success: true,
            save: true,
            data: { timestamp: Date.now(), coords: { latitude: -6.8897, longitude: 109.6753, accuracy: 6.2 } },
          });
        }, 600);
        phone.watchers.set(callbackId, timer);
        watchTimers.add(timer);
        return undefined;
      }
      case 'Geolocation.clearWatch':
        clearInterval(phone.watchers.get(options.id));
        phone.watchers.delete(options.id);
        return {};
      default:
        return {}; // App, StatusBar and anything else the shell calls: accepted, nothing to do
    }
  };
  return phone;
}

// ---------------------------------------------------------------------------------------------

async function main() {
  const exe = findChromium();
  if (!exe) throw new Error('No Chromium found. Set CHROMIUM_PATH or download one with Playwright.');
  if (!existsSync(MOCK)) throw new Error('cantol-mock is not built: run `cargo build -p cantol-mock` in mobile/rust');
  if (existsSync(join(root, 'config', 'device-profile.local.json'))) {
    notes.push('config/device-profile.local.json exists: the build below embeds it, and the screenshots show its network name');
  }

  const distDir = join(tmpdir(), 'everline-field-dist');
  rmSync(distDir, { recursive: true, force: true });
  execFileSync('npx', ['vite', 'build', '--outDir', distDir, '--emptyOutDir'], {
    cwd: root,
    stdio: 'ignore',
    env: { ...process.env, VITE_FIELD: '1' },
  });
  mkdirSync(outDir, { recursive: true });

  const mock = spawn(MOCK, ['--bind', '127.0.0.1', '--port', String(MOCK_PORT), '--no-beacon'], { stdio: 'ignore' });
  const server = spawn('npx', ['vite', 'preview', '--outDir', distDir, '--port', String(PREVIEW_PORT), '--strictPort'], {
    cwd: root,
    stdio: 'ignore',
    detached: true,
  });
  let browser;
  try {
    for (let i = 0; i < 40; i++) {
      if (await fetch(URL_BASE).then((r) => r.ok).catch(() => false)) break;
      await sleep(250);
    }
    await sleep(300);
    browser = await chromium.launch({ executablePath: exe });
    console.log(`Chromium: ${browser.version()} (${exe})`);
    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' })).newPage();

    const origins = new Set();
    const consoleProblems = [];
    page.on('request', (r) => {
      const u = r.url();
      if (!u.startsWith('data:') && !u.startsWith('blob:')) origins.add(new URL(u).origin);
    });
    page.on('console', (m) => {
      if (verbose) console.log(`  [console.${m.type()}] ${m.text()}`);
      if (['error', 'warning'].includes(m.type())) consoleProblems.push(`${m.type()}: ${m.text()}`);
    });
    page.on('pageerror', (e) => {
      if (verbose) console.log(`  [pageerror] ${e.message}`);
      consoleProblems.push(`pageerror: ${e.message}`);
    });

    const respond = (result) =>
      page
        .evaluate((r) => window.androidBridge.onmessage({ data: JSON.stringify(r) }), result)
        .catch(() => undefined);
    const phone = createPhone(respond);
    await page.exposeFunction('__toNative', async (raw) => {
      const call = JSON.parse(raw);
      if (verbose) console.log(`  [native] ${call.pluginId}.${call.methodName} ${JSON.stringify(call.options).slice(0, 120)}`);
      try {
        const data = await phone.handle(call);
        if (data !== undefined) await respond({ callbackId: call.callbackId, pluginId: call.pluginId, methodName: call.methodName, success: true, data });
      } catch (error) {
        await respond({
          callbackId: call.callbackId,
          pluginId: call.pluginId,
          methodName: call.methodName,
          success: false,
          error: { message: error.message, code: error.code },
        });
      }
    });
    await page.addInitScript({
      content: `window.androidBridge = { postMessage: (m) => { window.__toNative(m); } }; window.Capacitor = { PluginHeaders: ${JSON.stringify(HEADERS)} };`,
    });
    await page.addInitScript({ content: readFileSync(BRIDGE, 'utf8') });

    const hash = () => new URL(page.url()).hash;
    let shot = 0;
    const snap = async (name) => {
      shot += 1;
      await page.screenshot({ path: join(outDir, `${String(shot).padStart(2, '0')}-${name}.png`), fullPage: true });
    };
    const until = async (what, test, ms = 15000) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        if (await test()) return true;
        await sleep(100);
      }
      expect(false, `timed out after ${String(ms)} ms waiting for ${what} (at ${hash()})`);
      return false;
    };
    const visible = (locator) => locator.isVisible().catch(() => false);
    const body = () => page.locator('body').innerText();

    // ----- Sign in
    await page.goto(URL_BASE);
    await page.getByLabel('Email').waitFor({ timeout: 15000 });
    expect(!(await body()).includes('Demo'), 'the field build must not say it is a demo');
    expect(!(await visible(page.getByRole('button', { name: 'Skip sign-in' }))), 'the field build has no "Skip sign-in"');
    await snap('login');
    await page.getByLabel('Email').fill('field.operator@example.com');
    await page.getByLabel('Password').fill('anything');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();

    // ----- Hotspot: off, then on
    await until('the hotspot screen', () => hash() === '#/setup/hotspot', 15000);
    await until('the open-settings button', () => visible(page.getByRole('button', { name: 'Open hotspot settings' })));
    expect((await body()).includes('CANTOL-EXAMPLE'), 'the setup card should show the profile network name');
    await snap('hotspot-off');
    await page.getByRole('button', { name: 'Open hotspot settings' }).click();
    await until('the settings intent', () => phone.calls.includes('HotspotAssistant.openSettings'), 3000);
    await until('the wizard to move on once the hotspot is on', () => hash() === '#/setup/cantol', 12000);

    // ----- Cantol: found by the scan, verified by a real HELLO and PONG, linked
    await snap('cantol-searching');
    await until('Cantol to connect', () => visible(page.getByRole('heading', { name: /connected/i })), 25000);
    await snap('cantol-connected');
    expect(phone.scans.length > 0 && phone.scans[0].port === MOCK_PORT, `the scan should use the profile port, got ${JSON.stringify(phone.scans[0])}`);
    expect(phone.exchanged.length >= 4, `expected a HELLO to verify and three to ping, saw ${String(phone.exchanged.length)}`);
    expect(phone.exchanged.every((e) => e.frame[3] === 0x01), 'every exchange should be a HELLO frame');
    expect(phone.connects.length === 1 && phone.connects[0].heartbeat[3] === 0x30, 'the held link should open once, with a PING frame as its heartbeat');
    expect(phone.lastKnown === '127.0.0.1', 'the address that worked should be remembered');
    expect((await body()).includes('127.0.0.1'), 'the Cantol screen should show the address found');

    // ----- GPS: refused, refused again (blocked), allowed in app settings; services off, then on
    await page.getByRole('link', { name: 'Continue' }).click();
    await until('the GPS screen', () => hash() === '#/setup/gps');
    await snap('gps-initial');
    await page.getByRole('button', { name: 'Enable GPS' }).click();
    await until('"not allowed" after the first refusal', async () => (await body()).includes('Location access was not allowed'));
    await snap('gps-denied');
    await page.getByRole('button', { name: 'Enable GPS' }).click();
    await until('the blocked state', () => visible(page.getByRole('button', { name: 'Open app settings' })));
    await snap('gps-blocked');
    phone.locationOn = false;
    await page.getByRole('button', { name: 'Open app settings' }).click();
    await until('"turn on location" once the permission is allowed', () => visible(page.getByRole('button', { name: 'Turn on location' })), 12000);
    await snap('gps-services-off');
    await page.getByRole('button', { name: 'Turn on location' }).click();
    await until('a good fix', () => visible(page.getByRole('heading', { name: /found/i })), 20000);
    await snap('gps-found');
    // Two refusals, then asked again when "Turn on location" is tapped (granted by then).
    expect(phone.permissionRequests >= 2, `the permission should have been asked at least twice, was ${String(phone.permissionRequests)}`);
    expect(phone.calls.includes('GnssHelper.openLocationSettings') && phone.calls.includes('GnssHelper.openAppSettings'), 'both settings screens should have been opened');
    await page.getByRole('link', { name: 'Continue' }).click();

    // ----- Ready
    await until('the Ready screen', () => hash() === '#/device');
    await snap('ready');
    const ready = await body();
    expect(ready.includes('CANTOL-EXAMPLE') && ready.includes('127.0.0.1') && /±6 m/.test(ready), 'the Ready screen should show the hotspot, the Cantol address and the GPS accuracy');
    expect((ready.match(/Connected/g) ?? []).length >= 1 && !ready.includes('Reconnecting'), 'the Cantol row should say Connected');
    const start = page.getByRole('button', { name: 'Start measurement' });
    expect(await start.isDisabled(), '"Start measurement" must be disabled in the field build');
    expect(ready.includes('Live measurement and upload come in a later release'), 'the Ready screen should say measurement is not in this release');
    expect(!(await visible(page.locator('nav[aria-label="Main"]'))), 'the tab bar must not be offered');
    for (const route of ['/live', '/surveys', '/tag', '/track/setup', '/track']) {
      await page.evaluate((r) => {
        window.location.hash = r;
      }, route);
      await sleep(400);
      expect(hash() === '#/device', `${route} must lead back to the Ready screen, was ${hash()}`);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'the Ready screen must not scroll sideways');

    // ----- Link lost and restored
    await phone.loseLink();
    await until('"Reconnecting"', async () => (await body()).includes('Reconnecting'), 6000);
    await snap('ready-link-lost');
    expect(hash() === '#/device', 'a lost link recovers silently: the Ready screen stays');
    await phone.restoreLink();
    await until('Connected again', async () => !(await body()).includes('Reconnecting'), 10000);
    await snap('ready-link-restored');

    // ----- Restart: the operator, and the address that worked, are remembered. The wizard stops on
    // the first step that was not met when it looked (here usually Cantol, still linking), and the
    // operator taps Continue through the steps that are met by then; that is the specified flow.
    const exchangesBefore = phone.exchanged.length;
    await page.reload();
    let taps = 0;
    await until(
      'the Ready screen after a restart',
      async () => {
        // The hash still says #/device for a moment after a reload, so look for the screen itself.
        if (hash() === '#/device' && (await visible(page.getByRole('button', { name: 'Start measurement' })))) return true;
        const next = page.getByRole('link', { name: 'Continue' });
        if (await visible(next)) {
          taps += 1;
          await next.click().catch(() => undefined);
        }
        return false;
      },
      40000,
    );
    await until('Connected after a restart', async () => (await body()).includes('Connected'), 15000);
    await snap('ready-after-restart');
    notes.push(`after a restart the operator tapped Continue ${String(taps)} time(s) to reach Ready`);
    expect(phone.exchanged.length > exchangesBefore, 'a restart should verify Cantol again with a HELLO');
    expect(phone.scans.length === 1, `the remembered address should be tried first, so no second scan: ${String(phone.scans.length)} scans`);

    // ----- A small phone with larger text: the Ready screen has a note the demo never showed
    await page.setViewportSize({ width: 360, height: 640 });
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '130%';
    });
    await sleep(300);
    await snap('ready-small-large-text');
    const fit = await page.evaluate(() => {
      const wide = document.documentElement.scrollWidth > window.innerWidth;
      const small = [...document.querySelectorAll('button, a')]
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && (r.width < 44 || r.height < 44);
        })
        .map((el) => (el.textContent ?? '').trim().slice(0, 30));
      return { wide, small };
    });
    expect(!fit.wide, 'the Ready screen must not scroll sideways at 360 px with 130 percent text');
    expect(fit.small.length === 0, `touch targets under 44 px on the Ready screen: ${fit.small.join(', ')}`);

    // ----- The whole run
    expect([...origins].every((o) => o === `http://localhost:${String(PREVIEW_PORT)}`), `only the local origin may be requested, saw ${[...origins].join(', ')}`);
    expect(consoleProblems.length === 0, `the console should stay quiet, saw ${consoleProblems.join(' | ')}`);
    notes.push(`bridge calls: ${phone.calls.length}; HELLO exchanges: ${String(phone.exchanged.length)}; origins: ${[...origins].join(', ')}`);
    await snap('end');
  } finally {
    await browser?.close();
    mock.kill();
    for (const timer of watchTimers) clearInterval(timer);
    try {
      process.kill(-server.pid);
    } catch {
      server.kill();
    }
  }

  for (const note of notes) console.log(`  note: ${note}`);
  console.log(`\n${String(assertions)} assertions, screenshots in ${outDir}`);
  if (failures.length > 0) {
    console.log(`\n${String(failures.length)} FAILED:`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exitCode = 1;
  } else {
    console.log('all checks passed');
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    process.exit(process.exitCode ?? 0);
  });
