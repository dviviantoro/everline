import { describe, expect, it } from 'vitest';

import type { CantolStatus, PdEventSample } from '../core/links';
import { createControls, type DemoControlsState } from './controls';
import { buildDemoLines } from './fixtures';
import { degreesToPhase16, pulseRateHz, SimulatedCantol } from './simulatedCantol';
import { DemoWorld, driftDb, levelAlongSpan, NOISE_DBMV } from './world';

interface Capture {
  events: PdEventSample[];
  /** One entry per `onEvents` call: events in a batch share the same instantaneous level. */
  batches: PdEventSample[][];
  statuses: CantolStatus[];
}

/** Runs a streaming simulated Cantol for `seconds` of simulated time and collects what it emits. */
async function capture(seconds: number, control: Partial<DemoControlsState> = {}): Promise<Capture> {
  const controls = createControls();
  controls.set(control);
  const world = new DemoWorld(buildDemoLines(), controls);
  const cantol = new SimulatedCantol(world, controls);
  const out: Capture = { events: [], batches: [], statuses: [] };
  cantol.subscribe({
    onEvents: (e) => {
      out.events.push(...e);
      out.batches.push([...e]);
    },
    onStatus: (s) => out.statuses.push(s),
    onLinkState: () => undefined,
  });
  await cantol.connect();
  await cantol.startStream();
  for (let i = 0; i < seconds * 10; i++) world.advance(100);
  cantol.dispose();
  return out;
}

describe('level model', () => {
  it('peaks at the chosen station and falls away on either side', () => {
    const peak = 46;
    expect(levelAlongSpan(peak, 0.5, 'P2')).toBeCloseTo(peak, 6);
    expect(levelAlongSpan(peak, 0.25, 'P1')).toBeCloseTo(peak, 6);
    expect(levelAlongSpan(peak, 0.75, 'P3')).toBeCloseTo(peak, 6);
    expect(levelAlongSpan(peak, 0.25, 'P2')).toBeLessThan(levelAlongSpan(peak, 0.5, 'P2'));
    expect(levelAlongSpan(peak, 0, 'P2')).toBeLessThan(NOISE_DBMV + 2);
    expect(levelAlongSpan(peak, 0.5, 'none')).toBeCloseTo(NOISE_DBMV + 6, 6);
  });

  it('drifts slowly, well under a decibel', () => {
    for (let t = 0; t < 120_000; t += 1000) expect(Math.abs(driftDb(t))).toBeLessThan(0.7);
  });

  it('scales the pulse rate with the level above the noise', () => {
    expect(pulseRateHz(NOISE_DBMV, NOISE_DBMV)).toBe(40);
    expect(pulseRateHz(46, NOISE_DBMV)).toBeGreaterThan(pulseRateHz(20, NOISE_DBMV));
    expect(pulseRateHz(1000, NOISE_DBMV)).toBe(600);
  });
});

describe('simulated Cantol generator', () => {
  it('is deterministic: two runs with the same seeds emit identical data', async () => {
    const a = await capture(5);
    const b = await capture(5);
    expect(b).toEqual(a);
    expect(a.events.length).toBeGreaterThan(100);
  });

  it('emits Status about once a second with the real protocol fields', async () => {
    const { statuses } = await capture(6);
    expect(statuses.length).toBeGreaterThanOrEqual(5);
    expect(statuses.length).toBeLessThanOrEqual(7);
    for (const s of statuses) {
      expect(Object.keys(s).sort()).toEqual(
        ['adcClipPct', 'mainsLock', 'noiseFloorDbmV', 'queue', 'tempC', 'triggerRateHz'].sort(),
      );
      expect(s.noiseFloorDbmV).toBeGreaterThan(5.5);
      expect(s.noiseFloorDbmV).toBeLessThan(6.5);
      expect(s.mainsLock).toBe(true);
    }
  });

  it('clusters phase in two lobes, 70 to 110 and 250 to 290 degrees', async () => {
    const { events } = await capture(8);
    const degrees = events.map((e) => (e.phase / 65536) * 360);
    const inLobe = degrees.filter((d) => (d >= 70 && d <= 110) || (d >= 250 && d <= 290));
    expect(inLobe.length / degrees.length).toBeGreaterThan(0.94);
    expect(degrees.some((d) => d >= 70 && d <= 110)).toBe(true);
    expect(degrees.some((d) => d >= 250 && d <= 290)).toBe(true);
    for (const e of events) {
      expect(e.phase).toBeGreaterThanOrEqual(0);
      expect(e.phase).toBeLessThan(65536);
      expect([0, 1]).toContain(e.polarity);
    }
  });

  it('keeps pulse amplitude within about 3 dB below the level', async () => {
    // Next to the critical span's middle point with the peak on P2: level is about 46 dBmV.
    const { events, batches } = await capture(6, { spotAssetCode: 'SUTM-PKL-01-2' });
    const strong = events.filter((e) => e.ampDbmV > 20);
    expect(strong.length).toBeGreaterThan(events.length * 0.9);
    const max = Math.max(...strong.map((e) => e.ampDbmV));
    expect(max).toBeLessThan(47);
    expect(max).toBeGreaterThan(44);
    // Within one batch the level is the same, so the spread is the generator's own: at most 3 dB.
    for (const batch of batches) {
      const amps = batch.filter((e) => e.ampDbmV > 20).map((e) => e.ampDbmV);
      if (amps.length > 1) expect(Math.max(...amps) - Math.min(...amps)).toBeLessThanOrEqual(3.0001);
    }
  });

  it('pulses faster at a stronger source', async () => {
    const weak = await capture(6, { spotAssetCode: 'SUTM-PKL-01-1' });
    const strong = await capture(6, { spotAssetCode: 'SUTM-PKL-01-2' });
    expect(strong.events.length).toBeGreaterThan(weak.events.length * 2);
  });

  it('reports the mains reference as unlocked on demand', async () => {
    const { statuses } = await capture(3, { mainsUnlocked: true });
    expect(statuses.every((s) => !s.mainsLock)).toBe(true);
  });

  it('maps degrees to the 16-bit phase', () => {
    expect(degreesToPhase16(0)).toBe(0);
    expect(degreesToPhase16(90)).toBe(16384);
    expect(degreesToPhase16(180)).toBe(32768);
    expect(degreesToPhase16(360)).toBe(0);
    expect(degreesToPhase16(-90)).toBe(49152);
  });
});
