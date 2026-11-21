// Drives the web version of the field app (scripts/serve-field-web.mjs) the way an operator would, against a
// real Cantol that is replaying pd-simulator (cantol_device --source pdsim on the Red Pitaya):
//
//   1. signs in, types the Cantol's label (name, password, MAC address) and reaches the Live screen;
//   2. Live: looks at the phase pattern, the sensors, "Ref locked", Peak, Rate and Noise;
//   3. Tracking: walks a cable of seven stops. At each stop it sets the strength of the simulated defect
//      in pd-simulator's settings on the board (the way turning W2 up and down would), waits the five
//      seconds the screen asks for, and taps Mark station.
//
// It asserts what the screens show against what pd-simulator was set to (see the comment at the marks for what a
// "level" can be), and saves a screenshot of every step.
//
//   node scripts/demo-pdsim-web.mjs --url http://localhost:4190/ --out <dir> [--peaks-mv 10,30,100,300,100,30,10]
//
// The Cantol must already be running:  python3 -m cantol_device run --source pdsim --pdsim-config /cantol/pdsim.json
// Chromium: $CHROMIUM_PATH, or the newest headless shell Playwright has downloaded.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const option = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
const url = option('--url', 'http://localhost:4190/');
const outDir = option('--out', join(root, 'demo-pdsim-out'));
const peaksMv = option('--peaks-mv', '10,30,100,300,100,30,10').split(',').map(Number);
const verbose = argv.includes('--verbose');
const rp = join(root, 'scripts', 'rp.sh');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const failures = [];
let assertions = 0;
const expect = (condition, message) => {
  assertions += 1;
  if (!condition) failures.push(message);
};

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

/** pd-simulator's settings on the board: a small defect, a quiet W2, the sine at 0.8 V (the LV input is +-1 V). pd-simulator
 *  refuses a PD peak outside 10 mV to 5 V, and the Cantol then keeps the old settings (and logs it), so stay inside. */
function setDefect(peakMv) {
  if (peakMv < 10 || peakMv > 5000) throw new Error(`pd-simulator accepts a PD peak of 10 mV to 5 V, not ${String(peakMv)} mV`);
  const settings = {
    ch1_amplitude_v: 0.8,
    ch2_bg_amplitude_v: 0.0005,
    pos_pd_max_amplitude_v: peakMv / 1000,
    neg_pd_max_amplitude_v: peakMv / 1000,
  };
  execFileSync(rp, ['ssh', 'cat > /cantol/pdsim.json'], { input: JSON.stringify(settings) });
}

const exe = findChromium();
if (!exe) throw new Error('No Chromium found. Set CHROMIUM_PATH or download one with Playwright.');
mkdirSync(outDir, { recursive: true });
const mac = execFileSync(rp, ['ssh', 'cat /sys/class/net/eth0/address']).toString().trim().toUpperCase();
console.log(`Cantol MAC (the "label"): ${mac}`);

setDefect(peaksMv[0]);
const browser = await chromium.launch({ executablePath: exe });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' })).newPage();
const problems = [];
page.on('console', (m) => {
  if (verbose) console.log(`  [console.${m.type()}] ${m.text()}`);
  if (['error'].includes(m.type())) problems.push(m.text());
});
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

let shot = 0;
const snap = async (name) => {
  shot += 1;
  await page.screenshot({ path: join(outDir, `${String(shot).padStart(2, '0')}-${name}.png`), fullPage: true });
};
const body = () => page.locator('body').innerText();
const hash = () => new URL(page.url()).hash;
const until = async (what, test, ms = 20000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await test()) return true;
    await sleep(150);
  }
  expect(false, `timed out after ${String(ms)} ms waiting for ${what} (at ${hash()})`);
  await snap(`timeout-${what.replace(/\W+/g, '-').slice(0, 30)}`).catch(() => undefined);
  console.log(`  [timeout] ${what}; the screen says: ${(await body().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300)}`);
  return false;
};

try {
  // ----- first run: sign in, the label, the Cantol
  await page.goto(url);
  await page.getByLabel('Email').waitFor({ timeout: 15000 });
  await page.getByLabel('Email').fill('field.operator@example.com');
  await page.getByLabel('Password').fill('anything');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await until('the label screen', () => hash() === '#/setup/device', 20000);
  await page.getByLabel('Network name (SSID)').fill('CANTOL-DEMO');
  await page.getByLabel('Hotspot password').fill('demo-pass-1');
  await page.getByLabel('Cantol MAC address').fill(mac);
  await snap('label');
  await page.getByRole('button', { name: 'Save and continue' }).click();

  // The wizard's steps (hotspot, Cantol, location) each end in a Continue button once they pass; the last is Start measurement.
  let snappedLinked = false;
  const ready = await until('Start measurement to be ready', async () => {
    const start = page.getByRole('button', { name: 'Start measurement' });
    if ((await start.isVisible().catch(() => false)) && (await start.isEnabled().catch(() => false))) return true;
    // Continue is a button on some steps and a link on others.
    const next = page.getByRole('link', { name: 'Continue', exact: true }).or(page.getByRole('button', { name: 'Continue', exact: true })).first();
    if (await next.isVisible().catch(() => false)) {
      if (!snappedLinked && (await body()).includes('Cantol joined')) {
        snappedLinked = true;
        await snap('cantol-connected');
      }
      await next.click();
    }
    return false;
  }, 60000);
  await snap('ready');
  expect(ready, 'the app should link to the Cantol and say it is ready');
  if (ready) await page.getByRole('button', { name: 'Start measurement' }).click();

  // ----- Live: the phase pattern
  await until('the Live screen', () => hash() === '#/live', 10000);
  await until('"Ref locked"', async () => (await body()).includes('Ref locked'), 40000);
  await sleep(8000); // let the plot fill
  let text = await body();
  await snap('live-first-defect');
  expect(text.includes('Ref locked') && !text.includes('Ref not locked'), 'the mains reference (pd-simulator W1) should lock');
  expect(text.includes('Test data'), 'the Cantol says its data is generated, so the banner should show');
  const sensorGroup = page.getByRole('group', { name: 'Sensor' });
  const hasSensors = await sensorGroup.isVisible().catch(() => false);
  console.log(`Sensors offered: ${hasSensors ? 'yes' : 'no'}`);
  if (hasSensors) {
    await page.getByRole('button', { name: 'Sensor 2' }).click();
    await sleep(4000);
    await snap('live-sensor-2');
    await page.getByRole('button', { name: 'All' }).click();
  }

  // ----- Tracking: a walk along the cable
  await page.getByRole('link', { name: 'Tracking mode' }).click();
  await until('the free walk', () => hash() === '#/track', 10000);
  await until('a level to be read', async () => /Level now/i.test(await body()) && /dBmV/.test(await body()), 20000);
  const marks = [];
  for (let stop = 0; stop < peaksMv.length; stop++) {
    setDefect(peaksMv[stop]);
    await sleep(7000); // the new setting reaches the Cantol within a second; the screen asks for five seconds of standing still
    await snap(`stop-${stop + 1}-before-mark`);
    await page.getByRole('button', { name: 'Mark station' }).click();
    await sleep(500);
    const stations = await page.getByLabel('Stations').innerText();
    const rows = stations.split('\n').filter((l) => /^M\d+/.test(l.trim()));
    marks.push(rows.at(-1) ?? '');
    console.log(`  stop ${stop + 1}: defect ${String(peaksMv[stop])} mV peak -> ${rows.at(-1) ?? '(no row)'}`);
  }
  await snap('walk-done');
  text = await body();
  const stationsText = await page.getByLabel('Stations').innerText();
  const levels = [...stationsText.matchAll(/(\d+(?:\.\d+)?)\s*dBmV/g)].map((m) => Number(m[1]));
  console.log(`Levels read at the marks (dBmV): ${levels.join(', ')}`);
  // What the marks may be. pd-simulator draws each pulse at 40 to 100 percent of its peak setting, so no pulse reads
  // below -8 dB of the setting; two pulses that land within about 15 microseconds of each other add, so none reads more
  // than +6 dB above it. The Cantol sees only a sample of the pulses (a capture at a time), so a mark is the biggest
  // it saw in five seconds: usually a little over the setting. The order is what Tracking is for: the marks must rise and
  // fall as the settings do.
  const want = peaksMv.map((mv) => 20 * Math.log10(mv));
  expect(levels.length === peaksMv.length, `expected ${String(peaksMv.length)} marks, read ${String(levels.length)}`);
  levels.forEach((level, i) => {
    const over = level - want[i];
    expect(over >= -8 && over <= 6.5, `stop ${String(i + 1)}: a ${String(peaksMv[i])} mV peak is ${want[i].toFixed(1)} dBmV; the app says ${String(level)} (${over.toFixed(1)} dB over, allowed -8 to +6.5)`);
    if (i > 0) {
      expect(Math.sign(level - levels[i - 1]) === Math.sign(want[i] - want[i - 1]), `stop ${String(i + 1)}: the level should ${want[i] > want[i - 1] ? 'rise' : 'fall'} from stop ${String(i)}, ${String(levels[i - 1])} to ${String(level)}`);
    }
  });
  const strongest = peaksMv.indexOf(Math.max(...peaksMv));
  expect(text.includes(`M${String(strongest + 1)}`), 'the strongest stop should be named');
  expect(/strongest/i.test(text), 'the screen should say which stop is strongest');
} catch (error) {
  failures.push(`the walk stopped: ${error.message}`);
  await snap('error').catch(() => undefined);
} finally {
  await browser.close();
}

expect(problems.length === 0, `the console should stay quiet: ${problems.slice(0, 3).join(' | ')}`);
console.log(`\n${String(assertions)} assertions, screenshots in ${outDir}`);
if (failures.length > 0) {
  console.log('FAILED:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log('all checks passed');
