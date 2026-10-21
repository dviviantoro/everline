/**
 * One simulated world shared by the simulated Cantol and the simulated GPS: where the phone is,
 * what the sensor reads there, and a walker that follows a span for tracking mode.
 *
 * Level model (all dBmV, deterministic given the seed and the clock):
 *   level(x) = noise + (peak - noise) * exp(-0.5 * ((x - centre) / 0.18)^2)
 * where x is the position along the span as a fraction (0 pole A, 1 pole B), `peak` is the
 * line's `spotDbmV` and `centre` is the chosen scenario station (P1 0.25, P2 0.5, P3 0.75).
 * With the scenario "none" the level is flat just above the noise. A slow drift is added on top.
 *
 * Time is driven by `advance(dtMs)`, so tests step it by hand and the app calls `run()`.
 */
import { pointAtChainage, projectOntoRoute } from '../core/geo';
import type { LatLng } from '../core/types';
import type { ControlsStore, PeakStation } from './controls';
import type { DemoLine } from './fixtures';
import { createRng, type Rng } from './prng';

export const NOISE_DBMV = 6;
/** Width of the simulated peak as a fraction of the span. */
export const PEAK_WIDTH = 0.18;
/** Beyond this distance from a span's route the sensor sees no source. */
export const SOURCE_RANGE_M = 25;
export const WALK_SPEED_MPS = 1.2;

const STATION_FRACTION: Readonly<Record<Exclude<PeakStation, 'none'>, number>> = { P1: 0.25, P2: 0.5, P3: 0.75 };

/** Level along a span for a scenario, before drift. */
export function levelAlongSpan(peakDbmV: number, fraction: number, station: PeakStation, noise = NOISE_DBMV): number {
  if (station === 'none') return noise + 6;
  const centre = STATION_FRACTION[station];
  const g = Math.exp(-0.5 * ((fraction - centre) / PEAK_WIDTH) ** 2);
  return noise + (peakDbmV - noise) * g;
}

/** Slow wander of the whole reading, a fraction of a dB. */
export function driftDb(timeMs: number): number {
  return 0.4 * Math.sin((2 * Math.PI * timeMs) / 40_000) + 0.2 * Math.sin((2 * Math.PI * timeMs) / 13_000);
}

export type WalkDirection = 'AB' | 'BA';

type WalkPhase = 'dwell-start' | 'walking' | 'dwell-station' | 'done';

interface Walk {
  line: DemoLine;
  direction: WalkDirection;
  /** Metres walked from the starting pole. */
  walkedM: number;
  phase: WalkPhase;
  phaseMs: number;
  /** Walk-order chainages (from the start pole) of the three measurement points. */
  stationsM: number[];
  nextStation: number;
}

/** The dwell the simulated operator makes at the start pole and at each measurement point. */
const START_DWELL_MS = 10_000;
const STATION_DWELL_MS = 10_000;

export class DemoWorld {
  timeMs = 0;
  position: LatLng;
  private walk: Walk | null = null;
  private readonly listeners = new Set<(dtMs: number) => void>();
  private readonly rng: Rng;

  constructor(
    private readonly lines: readonly DemoLine[],
    private readonly controls: ControlsStore,
    seed = 1,
  ) {
    this.rng = createRng(seed);
    this.position = this.spotPosition();
  }

  /** Where the phone stands for a spot reading: the middle measurement point of the chosen line, a few metres off. */
  private spotPosition(): LatLng {
    const code = this.controls.get().spotAssetCode;
    const line = this.lines.find((l) => l.code === code) ?? this.lines[0];
    const p2 = line?.points[1];
    if (!p2) return { latitude: 0, longitude: 0 };
    return { latitude: p2.latitude + 0.00002, longitude: p2.longitude + 0.00002 };
  }

  /** Moves the phone next to the chosen line again (after a walk, or when the control changes). */
  placeAtSpot(): void {
    this.walk = null;
    this.position = this.spotPosition();
  }

  get walking(): boolean {
    return this.walk !== null;
  }

  /** Begins a walk along a span from pole A (`AB`) or pole B (`BA`). */
  startWalk(assetId: string, direction: WalkDirection): boolean {
    const line = this.lines.find((l) => l.id === assetId);
    if (!line) return false;
    const stations = line.points.map((p) => projectOntoRoute(line.route_geometry, p).chainageM);
    const stationsM = direction === 'AB' ? stations : stations.map((s) => line.lengthM - s).reverse();
    this.walk = { line, direction, walkedM: 0, phase: 'dwell-start', phaseMs: 0, stationsM, nextStation: 0 };
    this.position = this.walkPosition(this.walk);
    return true;
  }

  stopWalk(): void {
    if (this.walk) this.placeAtSpot();
  }

  private walkPosition(walk: Walk): LatLng {
    const along = walk.direction === 'AB' ? walk.walkedM : walk.line.lengthM - walk.walkedM;
    return pointAtChainage(walk.line.route_geometry, along);
  }

  private stepWalk(walk: Walk, dtMs: number): void {
    walk.phaseMs += dtMs;
    if (walk.phase === 'dwell-start') {
      if (walk.phaseMs >= START_DWELL_MS) {
        walk.phase = 'walking';
        walk.phaseMs = 0;
      }
    } else if (walk.phase === 'dwell-station') {
      if (walk.phaseMs >= STATION_DWELL_MS) {
        walk.phase = 'walking';
        walk.phaseMs = 0;
      }
    } else if (walk.phase === 'walking') {
      const speed = Math.max(0.6, WALK_SPEED_MPS * (1 + 0.06 * this.rng.normal()));
      walk.walkedM = Math.min(walk.line.lengthM, walk.walkedM + (speed * dtMs) / 1000);
      const target = walk.stationsM[walk.nextStation];
      if (target !== undefined && walk.walkedM >= target) {
        walk.walkedM = target;
        walk.nextStation += 1;
        walk.phase = 'dwell-station';
        walk.phaseMs = 0;
      } else if (walk.walkedM >= walk.line.lengthM) {
        walk.phase = 'done';
      }
    }
    this.position = this.walkPosition(walk);
  }

  /** The sensor reading, in dBmV, at `position` (or the phone's own position). */
  levelAt(position: LatLng = this.position): number {
    const { peakStation } = this.controls.get();
    let best: { line: DemoLine; fraction: number; offsetM: number } | null = null;
    for (const line of this.lines) {
      const projection = projectOntoRoute(line.route_geometry, position);
      if (!best || projection.offsetM < best.offsetM) {
        best = { line, fraction: projection.fraction, offsetM: projection.offsetM };
      }
    }
    const base =
      best && best.offsetM <= SOURCE_RANGE_M
        ? levelAlongSpan(best.line.spotDbmV, best.fraction, peakStation)
        : NOISE_DBMV + 3;
    return base + driftDb(this.timeMs);
  }

  noiseFloor(): number {
    return NOISE_DBMV + 0.15 * Math.sin((2 * Math.PI * this.timeMs) / 9_000);
  }

  advance(dtMs: number): void {
    this.timeMs += dtMs;
    if (this.walk) this.stepWalk(this.walk, dtMs);
    for (const listener of this.listeners) listener(dtMs);
  }

  /** Called with the elapsed milliseconds after every `advance`. */
  onTick(listener: (dtMs: number) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Drives the world from the wall clock. Returns the stop function. */
  run(intervalMs = 100): () => void {
    let last = performance.now();
    const id = window.setInterval(() => {
      const now = performance.now();
      const dt = Math.min(500, Math.max(0, now - last));
      last = now;
      this.advance(dt);
    }, intervalMs);
    return () => {
      window.clearInterval(id);
    };
  }
}
