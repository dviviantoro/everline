import { describe, expect, it } from 'vitest';

import { buildDemoLines, type DemoLine } from '../demo/fixtures';
import { createControls, type DemoControlsState, type PeakStation } from '../demo/controls';
import { SimulatedCantol } from '../demo/simulatedCantol';
import { SimulatedGnss } from '../demo/simulatedGnss';
import { DemoWorld, levelAlongSpan } from '../demo/world';
import { nodeDsp } from '../test/dspNode';
import { projectOntoRoute } from './geo';
import type { TrackMark, WalkDirection } from './model';
import {
  AUTO_MARK_BAND_M,
  AUTO_MARK_FIXES,
  createSession,
  DWELL_SPREAD_M,
  guidanceSentence,
  nextStation,
  stationChainages,
  stationWalkedM,
  viewOf,
  walkOrder,
  withFix,
  withMark,
  withSample,
  type TrackingSession,
} from './tracking';
import type { PositionSource } from './model';

const dsp = nodeDsp();
const EPOCH = 1_760_000_000_000;

interface Run {
  session: TrackingSession;
  line: DemoLine;
}

/** Walks a simulated operator along a span with the real WASM rules and returns the finished session. */
async function simulateWalk(options: {
  code: string;
  station: PeakStation;
  direction: WalkDirection;
  source: PositionSource;
  warning?: number;
  seconds?: number;
}): Promise<Run> {
  const controls = createControls();
  const patch: Partial<DemoControlsState> = { peakStation: options.station, spotAssetCode: options.code };
  controls.set(patch);
  const lines = buildDemoLines();
  const line = lines.find((l) => l.code === options.code);
  if (!line) throw new Error(`no fixture ${options.code}`);
  const world = new DemoWorld(lines, controls);
  const cantol = new SimulatedCantol(world, controls);
  const gnss = new SimulatedGnss(world, controls, () => EPOCH + world.timeMs);

  let session = createSession({
    direction: options.direction,
    source: options.source,
    warningLevelDbmV: options.warning ?? 30,
    stationsM: stationChainages(line, line.points),
  });
  let amps: number[] = [];
  cantol.subscribe({
    onEvents: (events) => amps.push(...events.map((e) => e.ampDbmV)),
    onStatus: () => undefined,
    onLinkState: () => undefined,
  });
  await cantol.connect();
  await cantol.startStream();
  await gnss.requestPermission();

  gnss.watch((fix) => {
    const chainage = projectOntoRoute(line.route_geometry, fix).chainageM;
    const step = withFix(session, chainage);
    session = step.session;
    if (step.autoMark) {
      const marked = withMark(session, { at: fix.at, fix }, dsp);
      if (marked) session = marked;
    }
  });

  world.startWalk(line.id, options.direction);
  let previous = world.position;
  let stillSeconds = 0;
  for (let tick = 1; tick <= (options.seconds ?? 110) * 10; tick++) {
    world.advance(100);
    if (tick % 10 !== 0) continue;
    const value = dsp.windowPeak(amps);
    amps = [];
    if (value !== null) session = withSample(session, value, dsp);
    // In point-marks mode the operator taps when standing still at the next station.
    if (options.source === 'marks') {
      const station = nextStation(session);
      const here = projectOntoRoute(line.route_geometry, world.position).chainageM;
      const moved = Math.hypot(world.position.latitude - previous.latitude, world.position.longitude - previous.longitude);
      stillSeconds = moved < 1e-9 ? stillSeconds + 1 : 0;
      // The operator holds the sensor at the station for the five-second dwell, then taps.
      if (station !== null && stillSeconds >= 5 && Math.abs(here - (session.config.stationsM[station] ?? 0)) < 1) {
        const fix = { latitude: world.position.latitude, longitude: world.position.longitude, accuracyM: 4, at: EPOCH + world.timeMs };
        const marked = withMark({ ...session, chainageM: here }, { at: fix.at, fix }, dsp);
        if (marked) session = marked;
      }
    }
    previous = world.position;
  }
  cantol.dispose();
  return { session, line };
}

const labels = (marks: readonly TrackMark[]) => marks.map((m) => m.label);

describe('a walk along a span with the peak at P2 (scenario)', () => {
  for (const source of ['gps', 'marks'] as const) {
    it(`gives Rising, Rising, Falling, Falling and the peak at P2 with ${source === 'gps' ? 'GPS distance' : 'point marks'}`, async () => {
      const { session } = await simulateWalk({ code: 'SUTM-PKL-02-1', station: 'P2', direction: 'AB', source });
      expect(labels(session.marks)).toEqual(['Pole A', 'P1', 'P2', 'P3', 'Pole B']);
      const view = viewOf(session, dsp);
      expect(view.segments.map((s) => s.trend)).toEqual(['rising', 'rising', 'falling', 'falling']);
      expect(view.segments.map((s) => `${s.from}>${s.to}`)).toEqual(['Pole A>P1', 'P1>P2', 'P2>P3', 'P3>Pole B']);
      expect(view.peak?.label).toBe('P2');
      expect(view.peak?.value).toBeGreaterThan(25);
      expect(view.peak?.value).toBeLessThan(29);
      expect(view.done).toBe(true);
      expect(view.next).toBeNull();
    });

    it(`takes each mark's value from the time at the station, not from the approach (${source})`, async () => {
      const { session, line } = await simulateWalk({ code: 'SUTM-PKL-02-1', station: 'P2', direction: 'AB', source });
      const fractions = [0, 0.25, 0.5, 0.75, 1];
      for (const mark of session.marks) {
        const expected = levelAlongSpan(line.spotDbmV, fractions[mark.station] ?? 0, 'P2');
        // The generator drifts by about half a dB and a fix is a metre off. Taking the mark during
        // the walk-up instead, as an earlier version did, was 5 to 6 dB out at P3.
        expect(Math.abs(mark.valueDbmV - expected)).toBeLessThan(1.6);
      }
    });
  }

  it('walked from B to A, reverses the order and the labels stay on their stations', async () => {
    const { session, line } = await simulateWalk({ code: 'SUTM-PKL-02-1', station: 'P2', direction: 'BA', source: 'gps' });
    expect(labels(session.marks)).toEqual(['Pole B', 'P3', 'P2', 'P1', 'Pole A']);
    expect(session.marks.map((m) => m.station)).toEqual([4, 3, 2, 1, 0]);
    expect(viewOf(session, dsp).segments.map((s) => s.trend)).toEqual(['rising', 'rising', 'falling', 'falling']);
    expect(viewOf(session, dsp).peak?.label).toBe('P2');
    expect(line.points).toHaveLength(3);
  });

  it('at the end of the walk, far below the peak, says to go back to P2 with a distance', async () => {
    const { session } = await simulateWalk({ code: 'SUTM-PKL-02-1', station: 'P2', direction: 'AB', source: 'gps' });
    const view = viewOf(session, dsp);
    expect(view.guidance).toBe('go_back');
    expect(view.guidanceText).toMatch(/^Moving away from the strongest reading\. Go back 3\d m to P2 \(2[5-9]\.\d dBmV\)\.$/);
  });
});

describe('other scenarios', () => {
  it('puts the peak at P1 and shows a steady last segment where the signal is gone', async () => {
    const { session } = await simulateWalk({ code: 'SUTM-PKL-02-1', station: 'P1', direction: 'AB', source: 'gps' });
    const view = viewOf(session, dsp);
    expect(view.peak?.label).toBe('P1');
    expect(view.segments.map((s) => s.trend)).toEqual(['rising', 'falling', 'falling', 'steady']);
  });

  it('puts the peak at P3', async () => {
    const { session } = await simulateWalk({ code: 'SUTM-PKL-02-1', station: 'P3', direction: 'AB', source: 'gps' });
    expect(viewOf(session, dsp).peak?.label).toBe('P3');
  });

  it('with no source on the span every segment is steady', async () => {
    const { session } = await simulateWalk({ code: 'SUTM-PKL-02-1', station: 'none', direction: 'AB', source: 'gps' });
    const view = viewOf(session, dsp);
    expect(view.segments.map((s) => s.trend)).toEqual(['steady', 'steady', 'steady', 'steady']);
  });

  it('classifies the live level with the WASM: a critical span ends the walk critical at its peak', async () => {
    const { session } = await simulateWalk({ code: 'SUTM-PKL-01-2', station: 'P2', direction: 'AB', source: 'gps' });
    const view = viewOf(session, dsp);
    expect(dsp.classify(view.peak?.value ?? 0)).toBe('critical');
    expect(session.alertFired).toBe(true);
  });

  it('fires the one-time alert only when the live level reaches the chosen warning level', async () => {
    const low = await simulateWalk({ code: 'SUTM-PKL-02-1', station: 'P2', direction: 'AB', source: 'gps', warning: 40 });
    expect(low.session.alertFired).toBe(false);
    const reached = await simulateWalk({ code: 'SUTM-PKL-02-1', station: 'P2', direction: 'AB', source: 'gps', warning: 20 });
    expect(reached.session.alertFired).toBe(true);
  });

  it('is reproducible: the same walk gives the same marks', async () => {
    const a = await simulateWalk({ code: 'SUTM-PKL-02-1', station: 'P2', direction: 'AB', source: 'gps' });
    const b = await simulateWalk({ code: 'SUTM-PKL-02-1', station: 'P2', direction: 'AB', source: 'gps' });
    expect(b.session.marks).toEqual(a.session.marks);
  });
});

describe('tracking bookkeeping', () => {
  const stationsM = [0, 16, 32, 49, 65];
  const config = { direction: 'AB' as const, source: 'gps' as const, warningLevelDbmV: 30, stationsM };

  it('walks the stations in order for each direction', () => {
    expect(walkOrder('AB')).toEqual([0, 1, 2, 3, 4]);
    expect(walkOrder('BA')).toEqual([4, 3, 2, 1, 0]);
    expect(nextStation(createSession(config))).toBe(0);
    expect(nextStation(createSession({ ...config, direction: 'BA' }))).toBe(4);
  });

  it('measures the walked distance of a station from the starting pole', () => {
    expect(stationWalkedM(config, 1)).toBe(16);
    expect(stationWalkedM({ ...config, direction: 'BA' }, 1)).toBe(49);
    expect(stationWalkedM({ ...config, direction: 'BA' }, 4)).toBe(0);
  });

  it('cannot mark without a sample, and cannot mark more than five stations', () => {
    let s = createSession(config);
    expect(withMark(s, { at: 1, fix: null }, dsp)).toBeNull();
    for (let i = 0; i < 5; i++) {
      s = withSample(s, 10 + i, dsp);
      const marked = withMark(s, { at: i, fix: null }, dsp);
      if (!marked) throw new Error('expected a mark');
      s = marked;
    }
    expect(s.marks).toHaveLength(5);
    expect(nextStation(s)).toBeNull();
    expect(withMark(s, { at: 9, fix: null }, dsp)).toBeNull();
  });

  it('takes the mark value from the last five samples only', () => {
    let s = createSession(config);
    for (const v of [40, 8, 9, 10, 11, 12]) s = withSample(s, v, dsp);
    const marked = withMark(s, { at: 1, fix: null }, dsp);
    expect(marked?.marks[0]?.valueDbmV).toBe(12);
  });

  it('marks automatically after a dwell: seven fixes inside the 5 m band, no more than 3 m apart', () => {
    expect(AUTO_MARK_BAND_M).toBe(5);
    expect(AUTO_MARK_FIXES).toBe(7);
    expect(DWELL_SPREAD_M).toBe(3);
    let s = createSession(config);
    const flags: boolean[] = [];
    for (const chainage of [9, 4.5, 4.7, 4.4, 4.6, 4.5, 4.4, 4.6]) {
      const step = withFix(s, chainage);
      s = step.session;
      flags.push(step.autoMark);
    }
    // 9 m is outside the band of the first station (0 m); the next seven fixes stand still inside it.
    expect(flags).toEqual([false, false, false, false, false, false, false, true]);
  });

  it('does not mark while still walking up to a station, but marks when walking through it and out', () => {
    // The first station is already marked; the next one is at 16 m.
    let s = createSession(config);
    s = withSample(s, 10, dsp);
    s = withMark(s, { at: 1, fix: null }, dsp) ?? s;
    expect(nextStation(s)).toBe(1);
    const flags: boolean[] = [];
    for (const chainage of [10, 12, 14, 16, 18, 20, 22]) {
      const step = withFix(s, chainage);
      s = step.session;
      flags.push(step.autoMark);
    }
    // 12 to 20 m are inside the band but spread over 8 m, so there is no dwell; leaving at 22 m marks it.
    expect(flags).toEqual([false, false, false, false, false, false, true]);
  });

  it('a fix outside the band resets the dwell, a retreat does not mark, and point marks never mark by themselves', () => {
    let s = createSession(config);
    s = withFix(s, 1).session;
    s = withFix(s, 2).session;
    expect(s.bandWalked).toHaveLength(2);
    s = withFix(s, 9).session;
    expect(s.bandWalked).toHaveLength(0);
    // Backing away on the near side of the station is not passing it.
    let retreat = createSession(config);
    retreat = withSample(retreat, 10, dsp);
    retreat = withMark(retreat, { at: 1, fix: null }, dsp) ?? retreat;
    retreat = withFix(retreat, 13).session;
    expect(withFix(retreat, 8).autoMark).toBe(false);
    const marksMode = createSession({ ...config, source: 'marks' });
    let step = withFix(marksMode, 1);
    for (let i = 0; i < 8; i++) step = withFix(step.session, 1);
    expect(step.autoMark).toBe(false);
  });

  it('puts the guidance into plain words', () => {
    const peak = { label: 'P2' as const, value: 46.1 };
    expect(guidanceSentence('go_back', 'falling', peak, 45.4)).toBe('Moving away from the strongest reading. Go back 45 m to P2 (46.1 dBmV).');
    expect(guidanceSentence('at_peak', 'steady', peak, 0)).toBe('At the strongest reading.');
    expect(guidanceSentence('trend_only', 'rising', peak, 12)).toBe('Getting closer: the level is rising.');
    expect(guidanceSentence('trend_only', 'falling', peak, 12)).toBe('The level is falling. Keep going to find the peak.');
    expect(guidanceSentence('trend_only', 'steady', null, null)).toBe('The level is steady.');
    expect(guidanceSentence(null, null, null, null)).toBe('Measuring the level.');
  });
});
