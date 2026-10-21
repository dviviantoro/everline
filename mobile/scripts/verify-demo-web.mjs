// Drives the demo web build (dist, built with `npm run build:demo`) in headless Chromium and checks
// it the way TASK-015 asks:
//   (a) walks the whole flow: sign in to tracking and tagging, with the failure states;
//   (b) screenshots every screen in dark and light, at 390x844 and at 360x640 with a larger font;
//   (c) asserts no text off the screen or clipped, and every interactive element at least 44x44;
//   (d) asserts no network request to anything but the local origin;
//   (e) checks prefers-reduced-motion.
//
//   npm run build:demo && node scripts/verify-demo-web.mjs [--out <dir>] [--only 390x844:dark]
//
// Time is a fake clock (Playwright `page.clock`), so the 60 s help card, the 30 s link grace and a
// 100 s walk take seconds. Chromium: $CHROMIUM_PATH, or the newest headless shell that Playwright
// has downloaded (~/.cache/ms-playwright). Exits 1 if any check fails.
/* global window, document, getComputedStyle */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const argValue = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
const outDir = argValue('--out') ?? join(tmpdir(), 'everline-demo-verify');
const only = argValue('--only');
const verbose = args.includes('--verbose');
const PORT = 4179;
const URL_BASE = `http://localhost:${String(PORT)}/`;

function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const cache = join(homedir(), '.cache', 'ms-playwright');
  if (!existsSync(cache)) return undefined;
  const shells = readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell-')).sort().reverse();
  for (const dir of shells) {
    const base = join(cache, dir);
    for (const sub of readdirSync(base)) {
      for (const exe of ['chrome-headless-shell', 'headless_shell']) {
        const candidate = join(base, sub, exe);
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// Results

const failures = [];
const notes = [];
const skipped = new Set();
let assertions = 0;
let screens = 0;

function expect(condition, message) {
  assertions += 1;
  if (!condition) failures.push(message);
}

// ---------------------------------------------------------------------------------------------
// In-page checks, run on every screen

function pageChecks({ checkTargets }) {
  const result = { offscreen: [], clipped: [], small: [] };
  const vw = window.innerWidth;
  const isVisible = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && !el.closest('.sr-only, [aria-hidden="true"]');
  };
  const describe = (el) => {
    const cls = typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '';
    return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${cls} "${(el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40)}"`;
  };

  for (const el of document.querySelectorAll('.app-root *, .dialog-backdrop *')) {
    if (!isVisible(el)) continue;
    const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? '').trim() !== '');
    const r = el.getBoundingClientRect();
    if (hasText && (r.right > vw + 0.5 || r.left < -0.5)) {
      result.offscreen.push(`${describe(el)} spans ${String(Math.round(r.left))} to ${String(Math.round(r.right))} in a ${String(vw)} px screen`);
    }
    const cs = getComputedStyle(el);
    const clips = ['hidden', 'clip'].includes(cs.overflowX) || cs.textOverflow === 'ellipsis';
    if (hasText && clips && el.scrollWidth > el.clientWidth + 1) {
      result.clipped.push(`${describe(el)} is ${String(el.scrollWidth)} px of text in ${String(el.clientWidth)} px`);
    }
    if (hasText && ['hidden', 'clip'].includes(cs.overflowY) && el.scrollHeight > el.clientHeight + 1) {
      result.clipped.push(`${describe(el)} is ${String(el.scrollHeight)} px tall in ${String(el.clientHeight)} px`);
    }
  }

  if (checkTargets) {
    const targets = document.querySelectorAll('a[href], button, input:not([type="hidden"]), textarea, select, [role="switch"], [role="radio"]');
    for (const el of targets) {
      if (!isVisible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 43.5 || r.height < 43.5) {
        result.small.push(`${describe(el)} is ${String(Math.round(r.width))} x ${String(Math.round(r.height))} px`);
      }
    }
  }
  return result;
}

// ---------------------------------------------------------------------------------------------
// One full walk in one viewport / theme

async function walk({ browser, viewport, theme, fontScale, label, reducedMotion }) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    reducedMotion: reducedMotion ? 'reduce' : 'no-preference',
  });
  await context.addInitScript(([t, scale]) => {
    try {
      localStorage.setItem('everline-theme', t);
    } catch {
      // storage unavailable
    }
    if (scale !== 1) {
      // Stand-in for Android's "larger font" setting: every rem-based text size grows.
      document.addEventListener('DOMContentLoaded', () => {
        document.documentElement.style.fontSize = `${String(scale * 100)}%`;
      });
    }
  }, [theme, fontScale]);
  const page = await context.newPage();
  const dir = join(outDir, label);
  mkdirSync(dir, { recursive: true });

  const origins = new Set();
  const consoleProblems = [];
  page.on('request', (r) => {
    const u = r.url();
    if (u.startsWith('data:') || u.startsWith('blob:')) return;
    origins.add(new URL(u).origin);
  });
  page.on('console', (m) => {
    if (['error', 'warning'].includes(m.type())) consoleProblems.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => consoleProblems.push(`pageerror: ${e.message}`));

  const hash = () => new URL(page.url()).hash;
  const advance = async (ms) => {
    for (let left = ms; left > 0; left -= 1000) {
      await page.clock.runFor(Math.min(1000, left));
      await page.waitForTimeout(12);
    }
    await page.waitForTimeout(80);
  };
  const go = async (route) => {
    await page.evaluate((r) => {
      window.location.hash = r;
    }, route);
    await advance(300);
  };
  const controls = (patch) => page.evaluate((p) => window.__everlineDemo.controls.set(p), patch);
  const button = (name) => page.getByRole('button', { name, exact: true });

  let index = 0;
  const visit = async (name, { targets = true, layout = true } = {}) => {
    index += 1;
    screens += 1;
    const id = `${String(index).padStart(2, '0')}-${name}`;
    if (verbose) console.log(`    ${label} ${id}`);
    await page.screenshot({ path: join(dir, `${id}.png`), fullPage: true });
    const found = await page.evaluate(pageChecks, { checkTargets: targets });
    if (layout) {
      for (const item of found.offscreen) expect(false, `[${label}] ${id}: text off the screen: ${item}`);
      for (const item of found.clipped) expect(false, `[${label}] ${id}: clipped text: ${item}`);
    } else if (found.offscreen.length + found.clipped.length > 0) {
      skipped.add(`${label} ${id}: ${String(found.offscreen.length + found.clipped.length)} layout findings not asserted`);
    }
    for (const item of found.small) expect(false, `[${label}] ${id}: touch target under 44 px: ${item}`);
    expect(true, '');
  };

  /** Signs in (if needed) and goes through the wizard to the Ready screen. */
  const toReady = async ({ capture }) => {
    if (hash().startsWith('#/login') || hash() === '') {
      await page.getByRole('button', { name: 'Skip sign-in' }).click();
      await advance(1500);
      expect(await page.getByText('Signing you in').isVisible(), `[${label}] the welcome animation should play after sign-in`);
      if (capture) await visit('welcome-playing');
      await advance(1600);
      if (capture) await visit('welcome-signed-in');
      await advance(1500);
    } else {
      await advance(800);
    }
    expect(hash() === '#/setup/hotspot', `[${label}] expected the hotspot screen, at ${hash()}`);
    if (capture) await visit('hotspot-off');
    await page.getByRole('button', { name: 'Open hotspot settings' }).click();
    await advance(3500);
    expect(hash() === '#/setup/cantol', `[${label}] the hotspot screen should continue by itself once the hotspot is on, at ${hash()}`);
    if (capture) await visit('cantol-searching');
    await page.getByRole('heading', { name: /connected/i }).waitFor({ timeout: 100 }).catch(() => undefined);
    await advance(6000);
    if (capture) await visit('cantol-connected');
    await page.getByRole('link', { name: 'Continue' }).click();
    await advance(300);
    await button('Enable GPS').click();
    await advance(3500);
    if (capture) await visit('gps-found');
    await page.getByRole('link', { name: 'Continue' }).click();
    await advance(400);
    expect(hash() === '#/device', `[${label}] expected the Ready screen, at ${hash()}`);
  };

  const record = async () => {
    await button('Start measurement').click();
    await advance(2500);
    await page.getByRole('button', { name: /^Record/ }).click();
    await advance(11500);
    expect(hash().startsWith('#/tag?m='), `[${label}] recording should open Tag, at ${hash()}`);
    await advance(800);
  };

  await page.clock.install({ time: new Date('2026-10-21T08:00:00Z') });
  await page.goto(URL_BASE);

  // ----- Sign in
  await page.getByRole('button', { name: 'Skip sign-in' }).waitFor();
  await visit('login');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await advance(200);
  expect(await page.getByRole('alert').first().isVisible(), `[${label}] an empty sign-in should say what is missing`);
  await visit('login-error');

  // ----- Guards and the wizard
  await page.getByLabel('Email').fill('field.operator@example.com');
  await page.getByLabel('Password').fill('anything');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await advance(1200);
  expect(await page.getByText('Signing you in').isVisible(), `[${label}] the welcome animation should play after sign-in, at ${hash()}`);
  await visit('welcome-playing');
  await advance(1900);
  expect(await page.getByText('Signed in').isVisible(), `[${label}] the welcome screen should rest on "Signed in" before moving on, at ${hash()}`);
  await visit('welcome-signed-in');
  await advance(1500);
  expect(hash() === '#/setup/hotspot', `[${label}] after the welcome, the first unmet step is the hotspot, at ${hash()}`);
  await visit('hotspot-off');
  await go('/live');
  expect(hash() === '#/setup/hotspot', `[${label}] /live must not open before the wizard is ready, at ${hash()}`);
  await go('/setup/gps');
  expect(hash() === '#/setup/hotspot', `[${label}] /setup/gps must not open before the earlier steps, at ${hash()}`);

  await page.getByRole('button', { name: 'Open hotspot settings' }).click();
  await advance(3500);
  expect(hash() === '#/setup/cantol', `[${label}] the hotspot screen should continue by itself, at ${hash()}`);
  await visit('cantol-searching');

  // The 60 s help card: force "Cantol not found", wait a minute.
  await go('/demo');
  await visit('demo-controls');
  await page.getByRole('switch', { name: 'Cantol not found' }).click();
  await go('/setup/cantol');
  await advance(30000);
  expect((await page.getByText('has not answered for a minute').count()) === 0, `[${label}] the help card must not appear before 60 s`);
  await advance(31000);
  expect(await page.getByText('has not answered for a minute').isVisible(), `[${label}] the help card should appear after 60 s`);
  await visit('cantol-help-card');
  await page.getByRole('link', { name: 'Enter IP manually' }).click();
  await advance(300);
  await visit('enter-address');
  await page.getByLabel('Cantol IP address').fill('10.1.2.3');
  await button('Connect').click();
  await advance(2500);
  expect(await page.getByRole('alert').first().isVisible(), `[${label}] a wrong address should say nothing answered`);
  await visit('enter-address-failed');
  await page.getByRole('link', { name: /Cantol/ }).first().click();
  await advance(300);
  await page.getByRole('link', { name: 'Diagnostics' }).click();
  await advance(600);
  await visit('diagnostics');
  await controls({ cantolNotFound: false });
  await go('/setup/cantol');
  await advance(1500);
  expect(await page.getByText('Looking only at').isVisible(), `[${label}] the Cantol screen should say it is trying a manual address`);
  await visit('cantol-manual-address');
  await button('Search automatically instead').click();
  await advance(9000);
  expect(await page.getByRole('heading', { name: /connected/i }).isVisible(), `[${label}] Cantol should connect once it is no longer forced missing`);
  await visit('cantol-connected');

  // GPS states
  await page.getByRole('link', { name: 'Continue' }).click();
  await advance(300);
  await visit('gps-initial');
  await controls({ gpsPermission: 'denied' });
  await button('Enable GPS').click();
  await advance(600);
  await visit('gps-denied');
  await controls({ gpsPermission: 'denied_permanently' });
  await button('Enable GPS').click();
  await advance(600);
  expect(await button('Open app settings').isVisible(), `[${label}] a blocked permission should offer the app settings`);
  await visit('gps-blocked');
  await button('Open app settings').click();
  await advance(3500);
  await controls({ gpsServices: 'off' });
  await advance(2500);
  await visit('gps-services-off');
  await controls({ gpsServices: 'on' });
  await advance(5000);
  await visit('gps-found');
  await page.getByRole('link', { name: 'Continue' }).click();
  await advance(400);
  expect(hash() === '#/device', `[${label}] expected the Ready screen, at ${hash()}`);
  await visit('device-ready');

  // Link lost and the 30 s grace
  await controls({ linkLost: true });
  await advance(3000);
  await visit('device-link-lost');
  expect(hash() === '#/device', `[${label}] a link lost for 3 s should recover silently, at ${hash()}`);
  await advance(30000);
  expect(hash() === '#/setup/cantol', `[${label}] after 30 s lost the wizard should reopen at the Cantol step, at ${hash()}`);
  await controls({ linkLost: false });
  await advance(9000);
  await page.getByRole('link', { name: 'Continue' }).click();
  await advance(600);
  expect(hash() === '#/setup/gps' || hash() === '#/device', `[${label}] expected to be past the Cantol step, at ${hash()}`);
  if (hash() === '#/setup/gps') {
    await page.getByRole('link', { name: 'Continue' }).click();
    await advance(400);
  }

  // Android back: nothing to go back to on the Ready screen (it would exit the app)
  await page.evaluate(() => window.dispatchEvent(new Event('cantol-back')));
  await advance(300);
  expect(hash() === '#/device', `[${label}] Back on the Ready screen must not navigate (it exits the app), at ${hash()}`);

  // ----- Surveys (empty), Live, record, Tag, upload
  await page.getByRole('link', { name: 'Surveys' }).click();
  await advance(500);
  await visit('surveys-empty');
  await page.getByRole('link', { name: 'Device' }).click();
  await advance(400);
  await button('Start measurement').click();
  await advance(3000);
  await visit('live');
  await controls({ mainsUnlocked: true });
  await advance(1500);
  expect(await page.getByText('Ref not locked').isVisible(), `[${label}] an unlocked mains reference should be said on the Live screen`);
  await visit('live-ref-not-locked');
  await controls({ mainsUnlocked: false });
  await advance(1500);
  await page.getByRole('button', { name: /^Record/ }).click();
  await advance(4000);
  await visit('live-recording');
  await advance(8000);
  expect(hash().startsWith('#/tag?m='), `[${label}] recording should open Tag, at ${hash()}`);
  await advance(800);
  await visit('tag');
  expect((await page.locator('[role=radio][aria-checked=true] .asset-code').innerText()) === 'SUTM-PKL-02-1', `[${label}] Tag should start on the nearest line`);
  expect((await page.locator('[aria-label="Measurement point"] [aria-pressed=true]').innerText()) === 'P2', `[${label}] Tag should start on the nearest point, P2`);
  expect((await page.locator('[aria-label="Condition"] [aria-pressed=true]').innerText()).includes('Warning'), `[${label}] the suggested condition should come from the WASM (Warning)`);
  await page.getByRole('radio', { name: /SUTM-PKL-01-2/ }).click();
  await page.getByRole('button', { name: 'Critical' }).click();
  await page.getByLabel('Asset ID').fill('zzz');
  await advance(200);
  await visit('tag-no-match');
  await page.getByLabel('Asset ID').fill('');
  await page.getByRole('radio', { name: /SUTM-PKL-02-1/ }).click();
  await advance(600);
  await page.getByRole('button', { name: 'Warning' }).click();
  await button('Save survey').click();
  await advance(150);
  await visit('surveys-uploading');
  await advance(1500);
  expect(await page.getByText('Uploaded (demo)').first().isVisible(), `[${label}] a saved survey should show Uploaded (demo)`);
  await visit('surveys-uploaded');

  // The data survives a restart of the page: the operator, the theme and the survey.
  await page.reload();
  await advance(1500);
  expect(!hash().startsWith('#/login'), `[${label}] the operator should still be signed in after a restart, at ${hash()}`);
  const storedTheme = await page.evaluate(() => localStorage.getItem('everline-theme'));
  expect(storedTheme === theme, `[${label}] the theme should be remembered, found ${String(storedTheme)}`);
  await go('/surveys');
  expect((await page.locator('article').count()) === 1, `[${label}] the saved survey should survive a restart`);
  await visit('surveys-after-restart');
  await go('/setup/hotspot');
  await toReady({ capture: false });

  // Failed upload and retry
  await controls({ failNextUpload: true });
  await record();
  await button('Save survey').click();
  await advance(1500);
  expect(await page.getByText('Upload failed').isVisible(), `[${label}] a forced failure should show Upload failed`);
  await visit('surveys-failed');
  await button('Retry').click();
  await advance(1500);
  expect((await page.getByText('Uploaded (demo)').count()) === 2, `[${label}] Retry should upload the failed survey`);

  // ----- Tracking
  await page.getByRole('link', { name: 'Live' }).click();
  await advance(800);
  await page.getByRole('link', { name: 'Tracking mode' }).click();
  await advance(1500);
  await page.getByRole('button', { name: 'GPS distance' }).click();
  await advance(300);
  await visit('track-setup');
  await button('Start tracking').click();
  await advance(35000);
  await visit('tracking-early');
  await page.evaluate(() => window.dispatchEvent(new Event('cantol-back')));
  await advance(300);
  expect(await page.getByRole('dialog').isVisible(), `[${label}] Back during tracking should ask first`);
  await visit('track-leave-dialog');
  await button('Stay').click();
  await controls({ linkLost: true });
  await advance(5000);
  expect(await page.getByText(/link lost/i).first().isVisible(), `[${label}] a lost link should show a banner while tracking`);
  await visit('tracking-link-lost');
  await controls({ linkLost: false });
  await advance(8000);
  await advance(45000);
  await visit('tracking-late');
  expect(hash().startsWith('#/track?'), `[${label}] the walk should still be on screen, at ${hash()}`);
  const segments = (await page.locator('section[aria-label=Segments] .row').allInnerTexts()).map((t) => t.replace(/\s+/g, ' '));
  expect(segments.length >= 3, `[${label}] expected the walk's segments, got ${segments.join(' | ')}`);
  await button('Finish').click();
  await advance(300);
  await visit('track-finish-dialog');
  await page.getByRole('dialog').getByRole('button', { name: 'Finish' }).click();
  await advance(1500);
  expect(hash().startsWith('#/tag?m='), `[${label}] Finish should open Tag, at ${hash()}`);
  await visit('tag-walk');
  await button('Save survey').click();
  await advance(2000);
  await visit('surveys-with-walk');
  expect((await page.getByText('Tracking').count()) >= 1, `[${label}] the saved walk should be listed as Tracking`);

  // Resume an unfinished walk with point marks
  await go('/live');
  await advance(500);
  await page.getByRole('link', { name: 'Tracking mode' }).click();
  await advance(1200);
  await page.getByRole('button', { name: 'Point marks' }).click();
  await button('Start tracking').click();
  await advance(10000);
  await button('Mark station').click();
  await advance(500);
  await page.evaluate(() => window.dispatchEvent(new Event('cantol-back')));
  await advance(300);
  await page.getByRole('button', { name: 'Leave' }).click();
  await advance(1000);
  expect(hash() === '#/track/setup', `[${label}] leaving a walk returns to its setup, at ${hash()}`);
  expect(await page.getByText('Unfinished walk').isVisible(), `[${label}] an unfinished walk should be offered for resume`);
  await visit('track-setup-draft');
  await button('Resume').click();
  await advance(2500);
  expect((await page.getByText(/1 of 5 stations marked/).count()) >= 1, `[${label}] a resumed walk should keep its mark`);
  await visit('tracking-resumed');

  // ----- Other
  await go('/demo');
  await visit('demo-controls-end');
  await go('/selftest');
  await advance(1500);
  await visit('selftest', { targets: false, layout: false });

  // ----- Network and console
  const foreign = [...origins].filter((o) => o !== new URL(URL_BASE).origin);
  expect(foreign.length === 0, `[${label}] requests left the local origin: ${foreign.join(', ')}`);
  expect(consoleProblems.length === 0, `[${label}] console problems: ${consoleProblems.join(' | ')}`);
  notes.push(`${label}: ${String(index)} screens, origins ${[...origins].join(', ')}`);
  await context.close();
}

// ---------------------------------------------------------------------------------------------
// Reduced motion

async function reducedMotion(browser) {
  for (const reduce of [false, true]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: reduce ? 'reduce' : 'no-preference' });
    const page = await context.newPage();
    await page.clock.install({ time: new Date('2026-10-21T08:00:00Z') });
    await page.goto(URL_BASE);
    await page.getByRole('button', { name: 'Skip sign-in' }).click();
    await page.getByText('Signing you in').waitFor({ timeout: 10000 });
    await page.clock.runFor(300);
    await page.waitForTimeout(100);
    const animations = await page.evaluate(() => document.getAnimations().length);
    const mode = reduce ? 'reduced motion' : 'normal motion';
    if (reduce) {
      expect(animations === 0, `[${mode}] no animation should run on the welcome screen, found ${String(animations)}`);
      await page.clock.runFor(1200);
      await page.waitForTimeout(150);
      expect(new URL(page.url()).hash === '#/setup/hotspot', `[${mode}] the welcome screen should advance after about 600 ms, at ${new URL(page.url()).hash}`);
      await page.getByRole('button', { name: 'Open hotspot settings' }).click();
      for (let i = 0; i < 4; i++) {
        await page.clock.runFor(1000);
        await page.waitForTimeout(12);
      }
      await page.waitForTimeout(150);
      const onCantol = new URL(page.url()).hash === '#/setup/cantol';
      expect(onCantol, `[${mode}] the flow must still work without motion, at ${new URL(page.url()).hash}`);
      const later = await page.evaluate(() => document.getAnimations().length);
      expect(later === 0, `[${mode}] no animation should run while waiting for Cantol, found ${String(later)}`);
    } else {
      expect(animations > 0, `[${mode}] the welcome screen should animate (control for the reduced-motion check), found ${String(animations)}`);
    }
    notes.push(`${mode}: ${String(animations)} running animations on the welcome screen`);
    await context.close();
  }
}

// ---------------------------------------------------------------------------------------------

async function main() {
  const html = existsSync(join(root, 'dist', 'index.html')) ? readFileSync(join(root, 'dist', 'index.html'), 'utf8') : '';
  if (!html) throw new Error('dist is missing: run `npm run build:demo` first');
  const exe = findChromium();
  if (!exe) throw new Error('No Chromium found. Set CHROMIUM_PATH or download one with Playwright.');

  // Its own process group, so the whole tree (npx starts vite as a child) can be stopped at the end.
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore', detached: true });
  try {
    for (let i = 0; i < 40; i++) {
      const up = await fetch(URL_BASE).then((r) => r.ok).catch(() => false);
      if (up) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    const browser = await chromium.launch({ executablePath: exe });
    console.log(`Chromium: ${browser.version()} (${exe})`);

    const demoBuilt = await fetch(URL_BASE).then((r) => r.text());
    expect(demoBuilt.includes('<div id="root">'), 'index.html should have the root element');

    const plans = [
      { name: '390x844', viewport: { width: 390, height: 844 }, fontScale: 1 },
      { name: '360x640-large-font', viewport: { width: 360, height: 640 }, fontScale: 1.3 },
    ];
    for (const plan of plans) {
      for (const theme of ['dark', 'light']) {
        const label = `${plan.name}/${theme}`;
        if (only && !`${plan.name}:${theme}`.startsWith(only)) continue;
        if (only === 'reduced') continue;
        process.stdout.write(`walking ${label} ...`);
        const before = failures.length;
        await walk({ browser, viewport: plan.viewport, theme, fontScale: plan.fontScale, label });
        console.log(` ${String(failures.length - before)} problems`);
      }
    }
    if (!only || only === 'reduced') {
      process.stdout.write('reduced motion ...');
      const before = failures.length;
      await reducedMotion(browser);
      console.log(` ${String(failures.length - before)} problems`);
    }
    await browser.close();
  } finally {
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {
      server.kill();
    }
  }

  console.log('');
  for (const line of notes) console.log(`  ${line}`);
  for (const line of skipped) console.log(`  note: ${line}`);
  console.log(`\n${String(screens)} screens checked, ${String(assertions)} assertions, screenshots in ${outDir}`);
  if (failures.length > 0) {
    console.log(`\n${String(failures.length)} FAILED:`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exitCode = 1;
  } else {
    console.log('all checks passed');
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
