// Drives the field build (VITE_FIELD=1) in headless Chromium, end to end except for Java:
//
//   - the real field bundle, the real Capacitor JavaScript bridge (native-bridge.js from
//     @capacitor/android, the file the APK injects) and the real WASM codec run unchanged;
//   - the Android side is a scripted stand-in behind `window.androidBridge`: it answers the three
//     app plugins and @capacitor/geolocation the way the phone would, and forwards `exchange` and
//     `connect` over real TCP to the real `cantol-mock`;
//   - the Java plugins themselves are checked separately (scripts/verify-link-jvm.sh).
//
// It walks sign in, the label screen (hotspot name, password and MAC address typed from the Cantol's
// label: validation, a wrong MAC address being refused and then corrected, edits and a restart),
// hotspot off then on, finding and linking Cantol, the location permission being
// refused twice and then allowed, location services off then on, the Ready screen, a lost and a
// restored link, and a restart. It then opens the Live screen: Start goes to the mock, the mock's
// pulses come back through the stand-in as `frame` events and are read by the Rust codec, the plot
// and tiles fill, the "Test data" banner shows (the mock says its data is generated), leaving the
// screen sends Stop, a lost and restored link asks for the stream again, and a Start that cannot be
// sent or a silent device is shown. It asserts what the field build must NOT offer (Record, Tracking,
// Surveys), that only the local origin is requested, and that the console stays quiet. It does not
// replace a phone: nothing here runs the Android WebView, the real hotspot, Wi-Fi or GPS.
//
//   cargo build -p cantol-mock   (in mobile/rust)  &&  node scripts/verify-field-web.mjs [--out <dir>]
//
// Chromium: $CHROMIUM_PATH, or the newest headless shell Playwright has downloaded.
/* global window, document */
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright-core';

import { CRC_LEN, createPhone, HEADER_LEN, HEADERS, watchTimers } from './lib/phone-standin.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const outDir = args.includes('--out') ? args[args.indexOf('--out') + 1] : join(tmpdir(), 'everline-field-verify');
const verbose = args.includes('--verbose');
const PREVIEW_PORT = 4181;
const URL_BASE = `http://localhost:${String(PREVIEW_PORT)}/`;
const MOCK = join(root, 'rust', 'target', 'debug', 'cantol-mock');
// The port in config/device-profile.example.json, which the build uses when no local profile exists.
const MOCK_PORT = 47000;
// What cantol-mock reports as its MAC address by default, and what the walk types from the "label".
const MOCK_MAC = '02:CA:57:00:00:01';
const WRONG_MAC = '02:CA:57:00:00:99';
const LABEL_SSID = 'CANTOL-1234';
const LABEL_PASSWORD = 'hotspot-pass-1';
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

// The stand-in for the Android side lives in lib/phone-standin.mjs.

// ---------------------------------------------------------------------------------------------

async function main() {
  const exe = findChromium();
  if (!exe) throw new Error('No Chromium found. Set CHROMIUM_PATH or download one with Playwright.');
  if (!existsSync(MOCK)) throw new Error('cantol-mock is not built: run `cargo build -p cantol-mock` in mobile/rust');

  const distDir = join(tmpdir(), 'everline-field-dist');
  rmSync(distDir, { recursive: true, force: true });
  execFileSync('npx', ['vite', 'build', '--outDir', distDir, '--emptyOutDir'], {
    cwd: root,
    stdio: 'ignore',
    env: { ...process.env, VITE_FIELD: '1' },
  });
  mkdirSync(outDir, { recursive: true });

  const mock = spawn(MOCK, ['--bind', '127.0.0.1', '--port', String(MOCK_PORT), '--no-beacon', '--sensors', '3'], { stdio: 'ignore' });
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

    // ----- The welcome screen, with a phone whose first checks fail (a broken plugin, location off).
    // The app must say it is still checking and why, and must not stay there.
    await until('the welcome screen to say it is still checking', async () => (await body()).includes('Still checking this phone'), 8000);
    expect((await body()).includes('Location check: simulated plugin failure'), 'the welcome screen should say which check failed and why');
    await snap('welcome-still-checking');
    phone.gnssBroken = false;

    // ----- The label screen: asked first, because nothing is saved on this phone yet.
    await until('the label screen', () => hash() === '#/setup/device', 15000);
    await page.getByRole('heading', { name: /Enter the Cantol label/ }).waitFor({ timeout: 5000 });
    expect(!(await visible(page.getByRole('link', { name: /Hotspot/ }))), 'the first run has nowhere to go back to');
    await snap('label-empty');
    await page.getByRole('button', { name: 'Save and continue' }).click();
    for (const message of [
      'Enter the network name from the Cantol label.',
      'Enter the password from the Cantol label.',
      'Enter the MAC address from the Cantol label.',
    ]) {
      expect((await body()).includes(message), `an empty form should say: ${message}`);
    }
    expect(hash() === '#/setup/device', 'an empty form must not be saved');
    await page.getByLabel('Network name (SSID)').fill(`  ${LABEL_SSID}  `);
    await page.getByLabel('Hotspot password').fill('short');
    await page.getByLabel('Cantol MAC address').fill('02:CA:57');
    await page.getByRole('button', { name: 'Save and continue' }).click();
    expect((await body()).includes('A hotspot password is 8 to 63 characters.'), 'a short password should be explained');
    expect((await body()).includes('A MAC address is twelve digits or letters A to F'), 'a short MAC address should be explained');
    expect(!(await body()).includes('short'), 'a message must not repeat the password');
    await snap('label-errors');
    // The password is hidden until asked for.
    const passwordField = page.getByLabel('Hotspot password');
    await passwordField.fill(LABEL_PASSWORD);
    expect((await passwordField.getAttribute('type')) === 'password', 'the password is hidden by default');
    await page.getByRole('button', { name: 'Show' }).click();
    expect((await passwordField.getAttribute('type')) === 'text', 'Show reveals the password');
    await page.getByRole('button', { name: 'Hide' }).click();
    // A wrong MAC address first, typed the way a label is often read: lower case with dashes.
    await page.getByLabel('Cantol MAC address').fill(WRONG_MAC.toLowerCase().replaceAll(':', '-'));
    await page.getByLabel('Cantol MAC address').blur();
    expect((await page.getByLabel('Cantol MAC address').inputValue()) === WRONG_MAC, 'the MAC address is tidied when the field is left');
    await snap('label-filled');
    await page.getByRole('button', { name: 'Save and continue' }).click();

    // ----- Hotspot: off, then on
    await until('the hotspot screen', () => hash() === '#/setup/hotspot', 15000);
    await until('the open-settings button', () => visible(page.getByRole('button', { name: 'Open hotspot settings' })));
    let hotspotText = await body();
    expect(hotspotText.includes(LABEL_SSID) && hotspotText.includes(WRONG_MAC), 'the hotspot screen should show what was typed from the label');
    expect(!hotspotText.includes(LABEL_PASSWORD), 'the password is shown as dots, never in full');
    expect(!hotspotText.includes('CANTOL-EXAMPLE'), 'no example values may be shown');
    await snap('hotspot-off');
    await page.getByRole('button', { name: 'Open hotspot settings' }).click();
    await until('the settings intent', () => phone.calls.includes('HotspotAssistant.openSettings'), 3000);
    await until('the wizard to move on once the hotspot is on', () => hash() === '#/setup/cantol', 12000);

    // ----- A different Cantol answers: the typed MAC address is wrong, so it is refused and the
    // operator is sent to the label values. Nothing is connected.
    await until('the wrong-device message', async () => (await body()).includes(`not the ${WRONG_MAC} you entered`), 25000);
    await snap('cantol-wrong-mac');
    const wrongText = await body();
    expect(wrongText.includes(`MAC address ${MOCK_MAC}`), 'the message should say which address the device reported');
    expect(wrongText.includes(`Looking for the Cantol with MAC address ${WRONG_MAC}`), 'the Cantol screen should say which MAC address it looks for');
    expect(phone.connects.length === 0, 'a refused device must not be connected');
    expect(!(await visible(page.getByRole('heading', { name: /connected/i }))), 'a refused device must not look connected');
    expect(!wrongText.includes('has not answered for a minute'), 'the "not answered" help would mislead: something did answer');
    await page.getByRole('link', { name: 'Check the label values' }).click();
    await until('the label screen again', () => hash() === '#/setup/device');
    expect((await page.getByLabel('Network name (SSID)').inputValue()) === LABEL_SSID, 'the saved name should be filled in');
    expect((await page.getByLabel('Cantol MAC address').inputValue()) === WRONG_MAC, 'the saved MAC address should be filled in');
    expect(await visible(page.getByRole('link', { name: /Hotspot/ })), 'editing can go back');
    await snap('label-edit');
    await page.getByLabel('Cantol MAC address').fill(MOCK_MAC.replaceAll(':', '').toLowerCase());
    await page.getByRole('button', { name: 'Save' }).click();
    await until('the Cantol screen after the correction', () => hash() === '#/setup/cantol', 8000);

    // ----- Cantol: found by the scan, verified by a real HELLO and PONG, linked
    await snap('cantol-searching');
    await until('Cantol to connect', () => visible(page.getByRole('heading', { name: /connected/i })), 25000);
    await snap('cantol-connected');
    expect(phone.scans.length > 0 && phone.scans[0].port === MOCK_PORT, `the scan should use the profile port, got ${JSON.stringify(phone.scans[0])}`);
    expect(phone.exchanged.length >= 5, `expected HELLOs to the wrong unit, to verify and three to ping, saw ${String(phone.exchanged.length)}`);
    expect(phone.exchanged.every((e) => e.frame[3] === 0x01), 'every exchange should be a HELLO frame');
    expect(phone.connects.length === 1 && phone.connects[0].heartbeat[3] === 0x30, 'the held link should open once, with a PING frame as its heartbeat');
    expect(phone.lastKnown === '127.0.0.1', 'the address that worked should be remembered');
    expect((await body()).includes('127.0.0.1'), 'the Cantol screen should show the address found');
    expect(!(await body()).includes('you entered'), 'the wrong-device message must go once the right MAC address is saved');

    // ----- GPS, from a phone with location OFF: Enable GPS first sends the operator to turn it on (the
    // geolocation plugin cannot ask for the permission until then); then the permission is refused,
    // refused again (blocked) and allowed in app settings; then location is off again and turned on.
    await page.getByRole('link', { name: 'Continue' }).click();
    await until('the GPS screen', () => hash() === '#/setup/gps');
    await snap('gps-initial');
    expect(!(await body()).includes('Location check:'), 'with location off the screen is not an error: no failure text');
    await page.getByRole('button', { name: 'Enable GPS' }).click();
    await until('the location settings to open', () => phone.calls.includes('GnssHelper.openLocationSettings'), 4000);
    await until('location to be on', () => phone.locationOn, 4000);
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
    // Asked and refused twice while location was on; the asks made with location off were rejected by the plugin.
    expect(phone.permissionRequests >= 2, `the permission should have been asked at least twice, was ${String(phone.permissionRequests)}`);
    expect(phone.calls.includes('GnssHelper.openLocationSettings') && phone.calls.includes('GnssHelper.openAppSettings'), 'both settings screens should have been opened');
    await page.getByRole('link', { name: 'Continue' }).click();

    // ----- Ready
    await until('the Ready screen', () => hash() === '#/device');
    await snap('ready');
    const ready = await body();
    expect(ready.includes(LABEL_SSID) && ready.includes('127.0.0.1') && /±6 m/.test(ready), 'the Ready screen should show the hotspot, the Cantol address and the GPS accuracy');
    expect((ready.match(/Connected/g) ?? []).length >= 1 && !ready.includes('Reconnecting'), 'the Cantol row should say Connected');
    const start = page.getByRole('button', { name: 'Start measurement' });
    expect(!(await start.isDisabled()), '"Start measurement" must be enabled once the hotspot, Cantol and location are all up');
    expect(/ready to measure/i.test(ready), 'the Ready screen should say "Ready to measure"');
    expect(!ready.includes('Measurement is not in this version') && !ready.includes('Setup complete'), 'the old "not in this version" wording must be gone');
    // The location row must stay "On" while fixes keep coming: the app was asking the plugin for a fix every 10 s
    // while it calls 5 s of silence "no fix", so the row flickered on a phone with a good signal.
    const watch = phone.watchOptions.at(-1);
    expect(watch !== undefined && watch.interval <= 2000 && watch.minimumUpdateInterval <= 2000, `the watch must ask for a fix at least every 2 s, asked ${JSON.stringify(watch)}`);
    let flickers = 0;
    for (let i = 0; i < 48; i += 1) {
      if ((await body()).includes('No fix')) flickers += 1;
      await sleep(250);
    }
    expect(flickers === 0, `the Location row said "No fix" in ${String(flickers)} of 48 checks over 12 s while fixes were arriving`);
    // No survey server in this build: two tabs, and the screens that record against it lead back here
    // (Tracking is not one of them: it walks free, below).
    const tabs = await page.locator('nav[aria-label="Main"] a').allInnerTexts();
    expect(tabs.join('|') === 'Device|Live', `the tab bar should offer Device and Live only, offered: ${tabs.join(', ')}`);
    for (const route of ['/surveys', '/tag']) {
      await page.evaluate((r) => {
        window.location.hash = r;
      }, route);
      await sleep(400);
      expect(hash() === '#/device', `${route} must lead back to the Ready screen, was ${hash()}`);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'the Ready screen must not scroll sideways');

    // ----- Live: Start goes to the mock, its pulses come back as frames, read by the Rust codec
    const startsSent = () => phone.sent.filter((f) => f[3] === 0x20).length;
    const stopsSent = () => phone.sent.filter((f) => f[3] === 0x21).length;
    await start.click();
    await until('the Live screen', () => hash() === '#/live');
    await until('a Start frame to reach the Cantol', () => startsSent() === 1, 5000);
    expect(phone.sent[0].length === HEADER_LEN + CRC_LEN, 'the Start frame is an empty control frame');
    await until('the "Test data" banner (the mock says its data is generated)', async () => (await body()).includes('Test data.'), 8000);
    await until('pulses on the plot', async () => (await page.locator('svg.chart circle').count()) > 10, 8000);
    await sleep(1500);
    await snap('live');
    const liveText = await body();
    const tile = async (label) => {
      const text = await page.locator('.tile', { hasText: label }).first().innerText();
      return Number.parseFloat(text.replace(new RegExp(label, 'i'), '').replace(/[^\d.-]+/g, ' ').trim().split(' ')[0]);
    };
    const peak = await tile('Peak');
    const rate = await tile('Rate');
    const noise = await tile('Noise');
    // The mock's pulses are 50 to 4000 counts; with the placeholder calibration the loudest in 10 s is near 52 dBmV,
    // its rate is 200 a second and its noise floor 60 to 80 counts (15.6 to 18.1 dBmV).
    expect(peak >= 40 && peak <= 52.1, `the Peak tile should read the loudest pulse in dBmV, read ${String(peak)}`);
    expect(rate === 200, `the Rate tile should read the mock's 200 a second, read ${String(rate)}`);
    expect(noise >= 15 && noise <= 19, `the Noise tile should read the mock's noise floor in dBmV, read ${String(noise)}`);
    expect(liveText.includes('Ref locked'), 'the mock locks to the mains: "Ref locked"');
    expect(liveText.includes('Test data.') && liveText.includes('generated, not measured'), 'the banner says the numbers are generated, not measured');
    expect(!/^\s*Record\b/m.test(liveText) && (await page.getByRole('button', { name: /Record/ }).count()) === 0, 'there is nothing to record against: no Record button');
    expect((await page.getByRole('link', { name: 'Tracking mode' }).count()) === 1, 'Tracking mode is offered: it walks free, without a line');
    expect(liveText.includes('need the survey server'), 'the Live screen says why recording is missing');
    expect(liveText.includes('Connected') && !liveText.includes('Waiting for data'), 'the link is up and data is flowing');
    expect(phone.pulseFrames > 10, `pulse frames should have reached the phone, saw ${String(phone.pulseFrames)}`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'the Live screen must not scroll sideways');
    expect(
      phone.calls.filter((c) => c === 'CantolLink.addListener').length >= 2 && phone.listeners.some((l) => l.eventName === 'frame'),
      'the app listens for frames while the Live screen is open',
    );

    // The mock pretends to have three sensors: a selector appears, and each sensor has its own figures
    await until('the sensor selector', async () => (await page.getByRole('group', { name: 'Sensor' }).count()) === 1, 6000);
    const sensorButtons = await page.getByRole('group', { name: 'Sensor' }).getByRole('button').allInnerTexts();
    expect(sensorButtons.join('|') === 'All|1|2|3', `the selector should offer All, 1, 2 and 3, offered: ${sensorButtons.join(', ')}`);
    await page.getByRole('group', { name: 'Sensor' }).getByRole('button', { name: 'Sensor 2' }).click();
    await until('the Rate tile to show sensor 2 alone', async () => (await tile('Rate')) === 66, 4000);
    const onePoints = await page.locator('svg.chart circle').count();
    expect(onePoints > 0 && onePoints < 200, `the plot should still show pulses, but only the one sensor's, saw ${String(onePoints)}`);
    expect(((await page.locator('svg.chart').first().getAttribute('aria-label')) ?? '').includes('sensor 2'), 'the plot says which sensor it shows');
    await snap('live-sensor-2');
    await page.getByRole('group', { name: 'Sensor' }).getByRole('button', { name: 'All' }).click();
    await until('the Rate tile to show all sensors again', async () => (await tile('Rate')) === 200, 4000);

    // ----- Tracking without a line: a free walk with marks M1, M2, ...
    await page.evaluate(() => {
      window.location.hash = '#/track/setup';
    });
    await until('the setup route to lead to the free walk', () => hash() === '#/track', 4000);
    await page.evaluate(() => {
      window.location.hash = '#/live';
    });
    await until('Live', () => hash() === '#/live');
    await page.getByRole('link', { name: 'Tracking mode' }).click();
    await until('the free walk', () => hash() === '#/track');
    await until('the level to appear', async () => /level now[\s\S]*\d+\.\d\s*dBmV/i.test(await body()), 8000);
    await snap('free-walk');
    const walkText = await body();
    expect(/Free walk/.test(walkText) && walkText.includes('0 stations marked'), 'the free walk says it is a free walk with nothing marked yet');
    expect(walkText.includes('Test data.'), 'the walk shows the test-data banner too');
    expect(walkText.includes('Strongest of 3 sensors'), 'the walk says it reads the strongest of the three sensors');
    expect(startsSent() === 1, `moving from Live to the walk must not start the stream again, ${String(startsSent())} Start frames`);
    const markButton = page.getByRole('button', { name: 'Mark station' });
    await sleep(5500);
    expect(!(await markButton.isDisabled()), 'Mark station is enabled once samples are in');
    await markButton.click();
    await until('M1', async () => (await body()).includes('M1 ·') && (await body()).includes('1 station marked'), 4000);
    await sleep(5500);
    await markButton.click();
    await until('M2', async () => (await body()).includes('M2 ·') && (await body()).includes('2 stations marked'), 4000);
    await snap('free-walk-marks');
    const marked = await body();
    const rows = await page.locator('section[aria-label="Stations"] .row').allInnerTexts();
    expect(rows.length === 2 && rows[0].includes('first') && /Rising|Falling|Steady/.test(rows[1]), `two station rows, the second compared with the first: ${rows.join(' | ')}`);
    expect(/strongest/.test(marked), 'one of the marks is called the strongest');
    expect(/Level at each station\. M1 [\d.]+ dBmV, M2 [\d.]+ dBmV/.test((await page.locator('svg.chart').getAttribute('aria-label')) ?? ''), 'the chart says what it shows');
    expect(await page.locator('svg.chart circle').count() >= 2, 'the chart has a point per mark');
    await page.getByRole('button', { name: '20 dBmV' }).click();
    expect((await page.getByRole('button', { name: '20 dBmV' }).getAttribute('aria-pressed')) === 'true', 'the warning level can be changed');
    await until('the warning banner (the mock is far above 20 dBmV)', async () => (await body()).includes('reached the warning level of 20 dBmV'), 8000);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'the free walk must not scroll sideways');
    expect(startsSent() === 1 && stopsSent() === 0, 'the whole walk used the one stream');
    // Leaving with marks asks first, and keeps them if told to
    await page.getByRole('button', { name: 'End walk' }).click();
    await until('the confirmation', async () => (await body()).includes('are not saved'), 3000);
    await page.getByRole('button', { name: 'Keep walking' }).click();
    await sleep(300);
    expect(hash() === '#/track' && (await body()).includes('M2 ·'), 'Keep walking keeps the marks');
    await page.getByRole('button', { name: 'End walk' }).click();
    await page.getByRole('button', { name: 'End walk' }).last().click();
    await until('Live after ending the walk', () => hash() === '#/live', 4000);

    // Leaving the screen sends Stop, stops the pulses and stops listening
    await page.getByRole('link', { name: 'Device', exact: true }).click();
    await until('the Ready screen', () => hash() === '#/device');
    await until('a Stop frame to reach the Cantol', () => stopsSent() === 1, 5000);
    await sleep(500);
    const pulsesAtStop = phone.pulseFrames;
    await sleep(1000);
    expect(phone.pulseFrames - pulsesAtStop <= 1, `the pulses should stop after Stop, ${String(phone.pulseFrames - pulsesAtStop)} more arrived in 1 s`);
    expect(!phone.listeners.some((l) => l.eventName === 'frame'), 'the app stops listening for frames after Stop');

    // A Start that cannot be sent is said, with a way to try again
    phone.failSend = true;
    await start.click();
    await until('the Live screen', () => hash() === '#/live');
    await until('the message that the Cantol did not start', async () => (await body()).includes('The Cantol did not start sending'), 5000);
    await snap('live-start-failed');
    expect((await body()).includes('reconnects by itself'), 'the message says what to do');
    phone.failSend = false;
    await page.getByRole('button', { name: 'Try again' }).click({ timeout: 5000 });
    await until('pulses after trying again', async () => (await body()).includes('Test data.') && !(await body()).includes('did not start'), 8000);
    expect(startsSent() === 2, `the retry sends one more Start, ${String(startsSent())} in all`);

    // A silent device is not a quiet line: the screen says it is waiting
    phone.muteFrames = true;
    await until('the waiting message', async () => (await body()).includes('Waiting for data from the Cantol'), 12000);
    await snap('live-waiting');
    phone.muteFrames = false;
    await until('the message to go once data arrives', async () => !(await body()).includes('Waiting for data'), 8000);

    // The link drops while measuring: it recovers by itself and asks for the stream again
    const startsBeforeLoss = startsSent();
    await phone.loseLink();
    await until('"Reconnecting" on the Live screen', async () => (await body()).includes('Reconnecting'), 6000);
    await snap('live-link-lost');
    expect(hash() === '#/live', 'a lost link recovers silently: the Live screen stays');
    await phone.restoreLink();
    await until('a new Start after the reconnect', () => startsSent() === startsBeforeLoss + 1, 8000);
    const pulsesAfterReconnect = phone.pulseFrames;
    await sleep(1200);
    expect(phone.pulseFrames > pulsesAfterReconnect + 5, 'pulses flow again after the reconnect');
    await until('Connected again', async () => !(await body()).includes('Reconnecting'), 10000);
    await page.getByRole('link', { name: 'Device', exact: true }).click();
    await until('the Ready screen', () => hash() === '#/device');
    await until('a second Stop frame', () => stopsSent() === 2, 5000);

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
    const scansBefore = phone.scans.length;
    await page.reload();
    let taps = 0;
    let askedAgain = false;
    await until(
      'the Ready screen after a restart',
      async () => {
        if (hash() === '#/setup/device') askedAgain = true;
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
    expect(!askedAgain, 'the label values are remembered: a restart must not ask for them again');
    expect(phone.exchanged.length > exchangesBefore, 'a restart should verify Cantol again with a HELLO');
    expect(phone.scans.length === scansBefore, `the remembered address should be tried first, so no scan after a restart: ${String(phone.scans.length - scansBefore)} new scans`);

    // ----- Correcting the name later: it applies at once, and the link to the same Cantol is kept
    const disconnectsBefore = phone.calls.filter((c) => c === 'CantolLink.disconnect').length;
    await page.evaluate(() => {
      window.location.hash = '#/setup/hotspot';
    });
    await page.getByRole('link', { name: /Change/ }).click();
    await until('the label screen for an edit', () => hash() === '#/setup/device');
    await page.getByLabel('Network name (SSID)').fill('CANTOL-5678');
    await page.getByRole('button', { name: 'Save' }).click();
    await until('the Ready screen after a name change', () => hash() === '#/device', 10000);
    const afterEdit = await body();
    expect(afterEdit.includes('CANTOL-5678') && !afterEdit.includes('Reconnecting'), 'the new name is shown and the link is kept');
    expect(
      phone.calls.filter((c) => c === 'CantolLink.disconnect').length === disconnectsBefore,
      'changing only the name must not drop the link',
    );

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
