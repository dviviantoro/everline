/**
 * Tracking mode as pure state and derived views (`mobile-tracking-mode.md`). A walk has five
 * stations along one span in A to B order (Pole A, P1, P2, P3, Pole B); the operator walks them in
 * either direction. The session keeps per-second samples and the marks taken so far. Every rule
 * that turns numbers into words (live level, trend, segment trend, mark value, peak, guidance)
 * comes from the WASM through `Dsp`; this file only arranges them. It holds no threshold except
 * where the design names a distance (the auto-mark band), flagged as an assumption.
 */
import type { Dsp, GuidanceKind, Trend } from './dsp';
import { formatDbmV } from './format';
import { projectOntoRoute, routeLengthM } from './geo';
import type { GpsFix, LineAssetWithPoles, MeasurementPoint, Severity } from './types';
import type { PositionSource, StationLabel, TrackMark, WalkDirection } from './model';
import { STATION_LABELS } from './payload';

export const STATION_COUNT = 5;
/** Assumption (`mobile-tracking-mode.md` section 2): a station counts as reached within this many metres. */
export const AUTO_MARK_BAND_M = 5;
/**
 * Assumption: how many consecutive fixes inside the band, all within `DWELL_SPREAD_M` of each
 * other, mark a station automatically. It is two more than the five-sample dwell that sets the
 * value of a mark, so that whole value window lies in the time spent standing at the station and
 * not in the walk up to it: the value is the window peak of the last five seconds, which on a
 * falling flank would otherwise pick up the stronger approach.
 */
export const AUTO_MARK_FIXES = 7;
/**
 * Assumption: the fixes of a dwell lie within this many metres of each other (jitter included).
 * Walking at 1.2 m/s spreads seven fixes over about 7 m, and at most two of the seven can be the
 * last of the walk-up (three would already span 3.6 m), so the five that set the value are still.
 */
export const DWELL_SPREAD_M = 3;
/** Assumption: GPS distance needs a fix at least this good; otherwise use station marks. */
export const GPS_MAX_ACCURACY_M = 10;
/** Samples kept: ten minutes at one per second. */
const MAX_SAMPLES = 600;

export const WARNING_PRESETS_DBMV: readonly number[] = [20, 30, 40];

/** Station indexes (0 to 4, A to B order) in the order they are walked. */
export function walkOrder(direction: WalkDirection): number[] {
  return direction === 'AB' ? [0, 1, 2, 3, 4] : [4, 3, 2, 1, 0];
}

/** Chainages of the five stations along the route, A to B, in metres. */
export function stationChainages(asset: LineAssetWithPoles, points: readonly MeasurementPoint[]): number[] {
  const length = routeLengthM(asset.route_geometry);
  const mid = [0, 1, 2].map((i) => {
    const p = points[i];
    return p ? projectOntoRoute(asset.route_geometry, p).chainageM : (length * (i + 1)) / 4;
  });
  return [0, ...mid, length];
}

/** Distance walked from the starting pole for a chainage measured from pole A. */
export function walkedFromChainage(chainageM: number, lengthM: number, direction: WalkDirection): number {
  return direction === 'AB' ? chainageM : lengthM - chainageM;
}

export interface TrackingConfig {
  direction: WalkDirection;
  source: PositionSource;
  warningLevelDbmV: number;
  /** Chainages A to B of the five stations; the last is the route length. */
  stationsM: readonly number[];
}

export interface TracePoint {
  walkedM: number;
  level: number;
}

export interface TrackingSession {
  config: TrackingConfig;
  /** One value per second: the window peak of that second, in dBmV. */
  samples: number[];
  /** Marks in walk order. */
  marks: TrackMark[];
  /** Latest GPS position along the route (chainage from pole A), or null. */
  chainageM: number | null;
  /** Walked distances of the latest consecutive fixes inside the band of the next station. */
  bandWalked: number[];
  /** The continuous line in GPS distance mode. */
  trace: TracePoint[];
  /** True once the live level has reached the warning level (the one-time alert). */
  alertFired: boolean;
}

export function createSession(config: TrackingConfig, marks: readonly TrackMark[] = []): TrackingSession {
  return { config, samples: [], marks: [...marks], chainageM: null, bandWalked: [], trace: [], alertFired: false };
}

/** The station to mark next, or null when all five are marked. */
export function nextStation(session: TrackingSession): number | null {
  return walkOrder(session.config.direction)[session.marks.length] ?? null;
}

/** Adds one per-second sample and tells whether this one crossed the warning level for the first time. */
export function withSample(session: TrackingSession, value: number, dsp: Dsp): TrackingSession {
  const samples = [...session.samples, value].slice(-MAX_SAMPLES);
  const live = dsp.liveLevel(samples);
  const crossed = !session.alertFired && live !== null && live >= session.config.warningLevelDbmV;
  const walked =
    session.chainageM === null
      ? null
      : walkedFromChainage(session.chainageM, lengthOf(session.config), session.config.direction);
  const trace =
    session.config.source === 'gps' && walked !== null && live !== null
      ? [...session.trace, { walkedM: walked, level: live }].slice(-MAX_SAMPLES)
      : session.trace;
  return { ...session, samples, trace, alertFired: session.alertFired || crossed };
}

function lengthOf(config: TrackingConfig): number {
  return config.stationsM[STATION_COUNT - 1] ?? 0;
}

/** Walked distance of a station for this walk. */
export function stationWalkedM(config: TrackingConfig, station: number): number {
  return walkedFromChainage(config.stationsM[station] ?? 0, lengthOf(config), config.direction);
}

/**
 * Records a GPS fix. In GPS distance mode the next station is marked automatically when the
 * operator has dwelled at it (the last `AUTO_MARK_FIXES` fixes inside the band and no more than
 * `DWELL_SPREAD_M` apart), or when they walk through it and out of the other side of the band
 * without stopping. The caller supplies the mark through `withMark`.
 */
export function withFix(session: TrackingSession, chainageM: number): { session: TrackingSession; autoMark: boolean } {
  const next = nextStation(session);
  if (next === null) return { session: { ...session, chainageM, bandWalked: [] }, autoMark: false };

  const walked = walkedFromChainage(chainageM, lengthOf(session.config), session.config.direction);
  const at = stationWalkedM(session.config, next);
  const inBand = Math.abs(walked - at) <= AUTO_MARK_BAND_M;
  const band = inBand ? [...session.bandWalked, walked].slice(-AUTO_MARK_FIXES) : [];
  const dwelled = band.length >= AUTO_MARK_FIXES && Math.max(...band) - Math.min(...band) <= DWELL_SPREAD_M;
  const passed = !inBand && session.bandWalked.length > 0 && walked > at;
  const trigger = session.config.source === 'gps' && (dwelled || passed);
  return { session: { ...session, chainageM, bandWalked: trigger ? [] : band }, autoMark: trigger };
}

export interface MarkInput {
  at: number;
  fix: GpsFix | null;
}

/**
 * Marks the next station with the value of the latest dwell (the window peak of the last five
 * samples). Returns null when there is nothing to mark: all stations done, or no sample yet.
 */
export function withMark(session: TrackingSession, input: MarkInput, dsp: Dsp): TrackingSession | null {
  const station = nextStation(session);
  const value = dsp.markValue(session.samples);
  if (station === null || value === null) return null;
  const mark: TrackMark = {
    station,
    label: STATION_LABELS[station] ?? 'P1',
    valueDbmV: value,
    chainageM: session.chainageM,
    at: input.at,
    fix: input.fix,
  };
  return { ...session, marks: [...session.marks, mark], bandWalked: [] };
}

export interface SegmentView {
  from: StationLabel;
  to: StationLabel;
  delta: number;
  trend: Trend;
}

export interface TrackingView {
  live: number | null;
  /** Live level minus the three samples before it, in dB, or null. */
  delta: number | null;
  trend: Trend | null;
  severity: Severity | null;
  segments: SegmentView[];
  peak: { index: number; label: StationLabel; value: number; walkedM: number } | null;
  guidance: GuidanceKind | null;
  guidanceText: string;
  /** Where the operator is, in words ("P2", "between P1 and P2"). */
  where: string;
  walkedM: number | null;
  next: StationLabel | null;
  done: boolean;
}

function labelOf(station: number): StationLabel {
  return STATION_LABELS[station] ?? 'P1';
}

function whereText(session: TrackingSession): string {
  const { config } = session;
  const order = walkOrder(config.direction);
  if (config.source === 'gps' && session.chainageM !== null) {
    const walked = walkedFromChainage(session.chainageM, lengthOf(config), config.direction);
    let before: number | null = null;
    for (const st of order) {
      const at = stationWalkedM(config, st);
      if (Math.abs(walked - at) <= AUTO_MARK_BAND_M) return labelOf(st);
      if (at <= walked) before = st;
    }
    const nextSt = order.find((st) => stationWalkedM(config, st) > walked);
    if (before !== null && nextSt !== undefined) return `between ${labelOf(before)} and ${labelOf(nextSt)}`;
    return before === null ? 'before the start' : 'past the end';
  }
  const last = session.marks[session.marks.length - 1];
  return last ? last.label : 'at the start';
}

export function guidanceSentence(
  kind: GuidanceKind | null,
  trend: Trend | null,
  peak: { label: StationLabel; value: number } | null,
  distanceToPeakM: number | null,
): string {
  if (kind === 'go_back' && peak) {
    const where = distanceToPeakM === null ? '' : ` ${String(Math.round(distanceToPeakM))} m`;
    return `Moving away from the strongest reading. Go back${where} to ${peak.label} (${formatDbmV(peak.value)} dBmV).`;
  }
  if (kind === 'at_peak') return 'At the strongest reading.';
  switch (trend) {
    case 'rising':
      return 'Getting closer: the level is rising.';
    case 'falling':
      return 'The level is falling. Keep going to find the peak.';
    case 'steady':
      return 'The level is steady.';
    default:
      return 'Measuring the level.';
  }
}

export function viewOf(session: TrackingSession, dsp: Dsp): TrackingView {
  const { config, samples, marks } = session;
  const live = dsp.liveLevel(samples);
  const before = samples.length >= 6 ? dsp.liveLevel(samples.slice(0, -3)) : null;
  const delta = live !== null && before !== null ? live - before : null;
  const trend = dsp.liveTrend(samples);

  const segments: SegmentView[] = [];
  for (let i = 1; i < marks.length; i++) {
    const from = marks[i - 1];
    const to = marks[i];
    if (!from || !to) continue;
    const t = dsp.segmentTrend(from.valueDbmV, to.valueDbmV);
    if (t) segments.push({ from: from.label, to: to.label, delta: to.valueDbmV - from.valueDbmV, trend: t });
  }

  const peakIndex = dsp.peakIndex(marks.map((m) => m.valueDbmV));
  const peakMark = peakIndex === null ? undefined : marks[peakIndex];
  const peak =
    peakIndex !== null && peakMark
      ? { index: peakIndex, label: peakMark.label, value: peakMark.valueDbmV, walkedM: stationWalkedM(config, peakMark.station) }
      : null;

  const walkedM =
    config.source === 'gps' && session.chainageM !== null
      ? walkedFromChainage(session.chainageM, lengthOf(config), config.direction)
      : marks.length > 0 && marks[marks.length - 1]
        ? stationWalkedM(config, marks[marks.length - 1]?.station ?? 0)
        : null;

  const guidance = live !== null && peak ? dsp.guidance(live, peak.value) : null;
  const distanceToPeakM = peak && walkedM !== null ? Math.abs(walkedM - peak.walkedM) : null;
  const nextSt = nextStation(session);

  return {
    live,
    delta,
    trend,
    severity: live === null ? null : dsp.classify(live),
    segments,
    peak,
    guidance,
    guidanceText: guidanceSentence(guidance, trend, peak, distanceToPeakM),
    where: whereText(session),
    walkedM,
    next: nextSt === null ? null : labelOf(nextSt),
    done: nextSt === null,
  };
}

/** The finished walk, ready to store and tag. `marks` are already in walk order. */
export function summarise(marks: readonly TrackMark[], dsp: Dsp): { peakLabel: StationLabel; peakValue: number } | null {
  const index = dsp.peakIndex(marks.map((m) => m.valueDbmV));
  const mark = index === null ? undefined : marks[index];
  return mark ? { peakLabel: mark.label, peakValue: mark.valueDbmV } : null;
}
