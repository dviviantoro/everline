import { describe, expect, it } from 'vitest';

import { createCue, pitchFor } from './audio';

describe('sound cue', () => {
  it('rises in pitch with the level, within a comfortable range', () => {
    expect(pitchFor(6)).toBeLessThan(pitchFor(27));
    expect(pitchFor(27)).toBeLessThan(pitchFor(46));
    expect(pitchFor(-200)).toBe(250);
    expect(pitchFor(500)).toBe(1400);
  });

  it('does nothing when audio was never unlocked from a tap', () => {
    expect(createCue()).toBeNull();
  });
});
