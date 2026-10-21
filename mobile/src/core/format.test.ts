import { describe, expect, it } from 'vitest';

import { formatClock, formatDb, formatDbmV, formatDistance, formatWhen } from './format';

describe('formatters', () => {
  it('shows levels with one decimal', () => {
    expect(formatDbmV(33.449)).toBe('33.4');
    expect(formatDbmV(33.45)).toBe('33.5');
    expect(formatDbmV(46)).toBe('46.0');
    expect(formatDbmV(-2.04)).toBe('-2.0');
  });

  it('shows differences in dB with a sign', () => {
    expect(formatDb(22)).toBe('+22.0');
    expect(formatDb(-8.54)).toBe('−8.5');
    expect(formatDb(0)).toBe('0.0');
    expect(formatDb(0.04)).toBe('0.0');
  });

  it('shows distances in m, then km', () => {
    expect(formatDistance(0.4)).toBe('<1 m');
    expect(formatDistance(41.6)).toBe('42 m');
    expect(formatDistance(999.4)).toBe('999 m');
    expect(formatDistance(1500)).toBe('1.5 km');
  });

  it('says today, yesterday, or the date', () => {
    const now = new Date(2026, 9, 21, 20, 30).getTime();
    expect(formatWhen(new Date(2026, 9, 21, 8, 5).getTime(), now)).toBe('Today 08:05');
    expect(formatWhen(new Date(2026, 9, 20, 23, 59).getTime(), now)).toBe('Yesterday 23:59');
    expect(formatWhen(new Date(2026, 9, 19, 8, 5).getTime(), now)).toBe('19 Oct 08:05');
    expect(formatWhen(new Date(2026, 0, 2, 14, 0).getTime(), now)).toBe('2 Jan 14:00');
  });

  it('counts down as mm:ss, rounding a partial second up', () => {
    expect(formatClock(60)).toBe('01:00');
    expect(formatClock(9.2)).toBe('00:10');
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(-3)).toBe('00:00');
  });
});
