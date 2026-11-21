import { describe, expect, it } from 'vitest';

import { nodeDsp } from '../test/dspNode';
import { createFreeWalk, freeViewOf, MAX_FREE_MARKS, withMark, withSample, type FreeWalk } from './freeWalk';
import type { GpsFix } from './types';

const dsp = nodeDsp();
const fix = (latitude: number, longitude: number): GpsFix => ({ latitude, longitude, accuracyM: 5, at: 0 });

/** Feeds one sample a second at each level, as the screen does. */
function feed(walk: FreeWalk, levels: readonly number[]): FreeWalk {
  return levels.reduce((w, v) => withSample(w, v, dsp), walk);
}

/** Holds still at a level for five seconds and marks. */
function stopAndMark(walk: FreeWalk, level: number, at = 0, position: GpsFix | null = null): FreeWalk {
  const marked = withMark(feed(walk, [level, level, level, level, level]), { at, fix: position }, dsp);
  if (marked === null) throw new Error('expected a mark');
  return marked;
}

describe('free walk', () => {
  it('has nothing to say until there are samples, and cannot mark before one', () => {
    const walk = createFreeWalk(30);
    const view = freeViewOf(walk, dsp);
    expect([view.live, view.trend, view.peak, view.guidance, view.severity]).toEqual([null, null, null, null, null]);
    expect(view.guidanceText).toBe('Measuring the level.');
    expect(view.where).toBe('at the start');
    expect(view.next).toBe('M1');
    expect(withMark(walk, { at: 0, fix: null }, dsp)).toBeNull();
  });

  it('reads the level and its trend with the same rules as the asset walk', () => {
    const rising = freeViewOf(feed(createFreeWalk(40), [10, 10, 10, 12, 12, 12]), dsp);
    expect(rising.trend).toBe('rising');
    expect(rising.live).toBe(12);
    expect(rising.delta).toBe(2);
    expect(rising.guidanceText).toBe('Getting closer: the level is rising.');
    expect(freeViewOf(feed(createFreeWalk(40), [12, 12, 12, 10, 10, 10]), dsp).trend).toBe('falling');
    expect(freeViewOf(feed(createFreeWalk(40), [10, 10, 10, 10.5, 10.5, 10.5]), dsp).trend).toBe('steady');
    expect(freeViewOf(feed(createFreeWalk(40), [10, 20, 40, 42, 41, 43]), dsp).severity).toBe('critical');
  });

  it('marks M1, M2, ... with the window peak of the last five seconds, and the walk goes on', () => {
    let walk = createFreeWalk(40);
    walk = stopAndMark(walk, 20, 1);
    walk = stopAndMark(walk, 28, 2);
    walk = stopAndMark(walk, 35, 3);
    expect(walk.marks.map((m) => [m.label, m.valueDbmV])).toEqual([
      ['M1', 20],
      ['M2', 28],
      ['M3', 35],
    ]);
    const view = freeViewOf(walk, dsp);
    expect(view.where).toBe('M3');
    expect(view.next).toBe('M4');
    expect(view.segments.map((s) => [s.from, s.to, s.trend, s.delta])).toEqual([
      ['M1', 'M2', 'rising', 8],
      ['M2', 'M3', 'rising', 7],
    ]);
    expect(view.peak).toEqual({ index: 2, label: 'M3', value: 35 });
  });

  it('segment trends use the 3 dB boundary exactly (the same vectors as the span walk)', () => {
    const seg = (a: number, b: number) => freeViewOf(stopAndMark(stopAndMark(createFreeWalk(99), a), b), dsp).segments[0]?.trend;
    expect(seg(10, 13)).toBe('rising');
    expect(seg(13, 10)).toBe('falling');
    expect(seg(10, 12.9)).toBe('steady');
    expect(seg(10, 7.1)).toBe('steady');
  });

  it('tells the operator to go back when the level falls more than 6 dB below the strongest mark, and that they are at the peak within 3 dB', () => {
    let walk = stopAndMark(createFreeWalk(99), 20);
    walk = stopAndMark(walk, 40);
    walk = stopAndMark(walk, 30);
    const away = freeViewOf(feed(walk, [30, 30, 30]), dsp);
    expect(away.guidance).toBe('go_back');
    expect(away.guidanceText).toBe('Moving away from the strongest reading. Go back to M2 (40.0 dBmV).');
    const near = freeViewOf(feed(walk, [38, 38, 38]), dsp);
    expect(near.guidance).toBe('at_peak');
    expect(near.guidanceText).toBe('At the strongest reading.');
  });

  it('finds the strongest mark of a walk toward a source and away from it', () => {
    // The level climbs to a source and then falls: 12, 18, 31, 44, 30, 19 dBmV at six stops.
    let walk = createFreeWalk(99);
    for (const level of [12, 18, 31, 44, 30, 19]) walk = stopAndMark(walk, level);
    const view = freeViewOf(walk, dsp);
    expect(view.peak).toMatchObject({ label: 'M4', value: 44 });
    expect(view.segments.map((s) => s.trend)).toEqual(['rising', 'rising', 'rising', 'falling', 'falling']);
  });

  it('measures the distance between two marks that both had a position, and says nothing when one did not', () => {
    let walk = stopAndMark(createFreeWalk(99), 20, 0, fix(-6.8897, 109.6753));
    walk = stopAndMark(walk, 30, 0, fix(-6.8897 + 0.0009, 109.6753)); // 0.0009 degrees of latitude: about 100 m
    walk = stopAndMark(walk, 35, 0, null);
    const segments = freeViewOf(walk, dsp).segments;
    expect(segments[0]?.distanceM).toBeGreaterThan(95);
    expect(segments[0]?.distanceM).toBeLessThan(105);
    expect(segments[1]?.distanceM).toBeNull();
  });

  it('fires the warning level once, when the live level first reaches it', () => {
    let walk = createFreeWalk(30);
    walk = feed(walk, [10, 10, 10, 10]);
    expect(walk.alertFired).toBe(false);
    walk = feed(walk, [60, 60, 60, 60]);
    expect(walk.alertFired).toBe(true);
    walk = feed(walk, [5, 5, 5, 5, 5, 5]);
    expect(walk.alertFired, 'it stays fired').toBe(true);
  });

  it('stops marking at the limit and says there is no next station', () => {
    let walk = createFreeWalk(99);
    for (let i = 0; i < MAX_FREE_MARKS; i++) walk = stopAndMark(walk, 10 + i);
    expect(walk.marks).toHaveLength(MAX_FREE_MARKS);
    expect(freeViewOf(walk, dsp).next).toBeNull();
    expect(withMark(feed(walk, [50]), { at: 0, fix: null }, dsp)).toBeNull();
  });

  it('keeps the latest ten minutes of samples only', () => {
    const walk = feed(createFreeWalk(99), Array.from({ length: 700 }, (_, i) => i));
    expect(walk.samples).toHaveLength(600);
    expect(walk.samples[0]).toBe(100);
  });
});
