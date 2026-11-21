/**
 * A free walk: tracking without a line (ADR-011). The operator carries the sensor along a cable and
 * taps "Mark station" at each stop; the marks are M1, M2 and so on, not the five fixed stations of a
 * span. The trend rules are the same ones the asset walk uses (live level, live trend, mark value,
 * segment trend, peak, guidance) and come from the WASM through `Dsp`; this file only arranges them.
 *
 * Nothing here is saved or uploaded: a walk with no line has no asset to be a survey of.
 */
import type { Dsp, GuidanceKind, Trend } from './dsp';
import { haversineM } from './geo';
import { guidanceSentence } from './tracking';
import type { GpsFix, Severity } from './types';

/** Enough for a long cable; the "Mark station" button stops here. */
export const MAX_FREE_MARKS = 12;
/** Samples kept: ten minutes at one per second. */
const MAX_SAMPLES = 600;

export interface FreeMark {
  /** `M1`, `M2`, ... in the order they were taken. */
  label: string;
  valueDbmV: number;
  at: number;
  fix: GpsFix | null;
}

export interface FreeWalk {
  warningLevelDbmV: number;
  /** One value per second: the window peak of that second, in dBmV. */
  samples: number[];
  marks: FreeMark[];
  /** True once the live level has reached the warning level (the one-time alert). */
  alertFired: boolean;
}

export function createFreeWalk(warningLevelDbmV: number): FreeWalk {
  return { warningLevelDbmV, samples: [], marks: [], alertFired: false };
}

export function withSample(walk: FreeWalk, value: number, dsp: Dsp): FreeWalk {
  const samples = [...walk.samples, value].slice(-MAX_SAMPLES);
  const live = dsp.liveLevel(samples);
  const crossed = !walk.alertFired && live !== null && live >= walk.warningLevelDbmV;
  return { ...walk, samples, alertFired: walk.alertFired || crossed };
}

/** Marks the next station with the value of the latest dwell, or returns null when there is nothing to mark (no sample yet, or `MAX_FREE_MARKS` taken). */
export function withMark(walk: FreeWalk, input: { at: number; fix: GpsFix | null }, dsp: Dsp): FreeWalk | null {
  const value = dsp.markValue(walk.samples);
  if (value === null || walk.marks.length >= MAX_FREE_MARKS) return null;
  const mark: FreeMark = { label: `M${String(walk.marks.length + 1)}`, valueDbmV: value, at: input.at, fix: input.fix };
  return { ...walk, marks: [...walk.marks, mark] };
}

export interface FreeSegment {
  from: string;
  to: string;
  /** Difference of the two mark values, in dB. */
  delta: number;
  trend: Trend;
  /** Straight-line distance between the two marks when both had a GPS fix, in metres. */
  distanceM: number | null;
}

export interface FreeView {
  live: number | null;
  /** Live level minus the three samples before it, in dB, or null. */
  delta: number | null;
  trend: Trend | null;
  severity: Severity | null;
  segments: FreeSegment[];
  peak: { index: number; label: string; value: number } | null;
  guidance: GuidanceKind | null;
  guidanceText: string;
  /** Where the operator is, in words: the last mark, or "at the start". */
  where: string;
  next: string | null;
}

export function freeViewOf(walk: FreeWalk, dsp: Dsp): FreeView {
  const { samples, marks } = walk;
  const live = dsp.liveLevel(samples);
  const before = samples.length >= 6 ? dsp.liveLevel(samples.slice(0, -3)) : null;
  const trend = dsp.liveTrend(samples);

  const segments: FreeSegment[] = [];
  for (let i = 1; i < marks.length; i++) {
    const from = marks[i - 1];
    const to = marks[i];
    if (!from || !to) continue;
    const t = dsp.segmentTrend(from.valueDbmV, to.valueDbmV);
    if (t === null) continue;
    segments.push({
      from: from.label,
      to: to.label,
      delta: to.valueDbmV - from.valueDbmV,
      trend: t,
      distanceM: from.fix && to.fix ? haversineM(from.fix, to.fix) : null,
    });
  }

  const peakIndex = dsp.peakIndex(marks.map((m) => m.valueDbmV));
  const peakMark = peakIndex === null ? undefined : marks[peakIndex];
  const peak = peakIndex !== null && peakMark ? { index: peakIndex, label: peakMark.label, value: peakMark.valueDbmV } : null;
  const guidance = live !== null && peak ? dsp.guidance(live, peak.value) : null;
  const last = marks[marks.length - 1];

  return {
    live,
    delta: live !== null && before !== null ? live - before : null,
    trend,
    severity: live === null ? null : dsp.classify(live),
    segments,
    peak,
    guidance,
    guidanceText: guidanceSentence(guidance, trend, peak, null),
    where: last ? last.label : 'at the start',
    next: marks.length >= MAX_FREE_MARKS ? null : `M${String(marks.length + 1)}`,
  };
}
