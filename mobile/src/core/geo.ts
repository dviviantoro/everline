/**
 * Small geographic helpers: distances, projecting a GPS fix onto a line's route, and siting points
 * along a route. Spans are tens of metres, so a local flat-earth projection is exact enough.
 */
import type { LatLng, LngLat } from './types';

const EARTH_RADIUS_M = 6_371_008.8;
const METRES_PER_DEGREE = (Math.PI / 180) * EARTH_RADIUS_M;

/** Standard spacing for the three measurement points along a span (`backend/src/geo.ts`). */
export const MEASUREMENT_FRACTIONS: readonly number[] = [0.25, 0.5, 0.75];

interface Xy {
  x: number;
  y: number;
}

/** Local east/north metres of `p` relative to `origin`. */
function toLocal(origin: LatLng, p: LatLng): Xy {
  const cosLat = Math.cos((origin.latitude * Math.PI) / 180);
  return {
    x: (p.longitude - origin.longitude) * cosLat * METRES_PER_DEGREE,
    y: (p.latitude - origin.latitude) * METRES_PER_DEGREE,
  };
}

export function lngLatToLatLng([lng, lat]: LngLat): LatLng {
  return { latitude: lat, longitude: lng };
}

/** The point `eastM` metres east and `northM` metres north of `origin`. */
export function offsetLatLng(origin: LatLng, eastM: number, northM: number): LatLng {
  const cosLat = Math.cos((origin.latitude * Math.PI) / 180);
  return {
    latitude: origin.latitude + northM / METRES_PER_DEGREE,
    longitude: origin.longitude + eastM / (METRES_PER_DEGREE * cosLat),
  };
}

/** Great-circle distance in metres. */
export function haversineM(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLng = (b.longitude - a.longitude) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

function segmentsOf(route: readonly LngLat[]): { from: LatLng; to: LatLng; lengthM: number }[] {
  const out: { from: LatLng; to: LatLng; lengthM: number }[] = [];
  for (let i = 0; i < route.length - 1; i++) {
    const a = route[i];
    const b = route[i + 1];
    if (!a || !b) continue;
    const from = lngLatToLatLng(a);
    const to = lngLatToLatLng(b);
    const local = toLocal(from, to);
    out.push({ from, to, lengthM: Math.hypot(local.x, local.y) });
  }
  return out;
}

/** Length of the route in metres. */
export function routeLengthM(route: readonly LngLat[]): number {
  return segmentsOf(route).reduce((sum, s) => sum + s.lengthM, 0);
}

export interface RouteProjection {
  /** Metres along the route from its first vertex to the closest point. */
  chainageM: number;
  /** Distance from the fix to that closest point. */
  offsetM: number;
  /** `chainageM` divided by the route length (0 to 1). */
  fraction: number;
}

/** Project a point onto the route: where along it, and how far off it, the point is. */
export function projectOntoRoute(route: readonly LngLat[], p: LatLng): RouteProjection {
  const segments = segmentsOf(route);
  const total = segments.reduce((sum, s) => sum + s.lengthM, 0);
  let best: RouteProjection = { chainageM: 0, offsetM: Number.POSITIVE_INFINITY, fraction: 0 };
  let before = 0;
  for (const s of segments) {
    const end = toLocal(s.from, s.to);
    const q = toLocal(s.from, p);
    const len2 = end.x * end.x + end.y * end.y;
    const t = len2 > 0 ? Math.max(0, Math.min(1, (q.x * end.x + q.y * end.y) / len2)) : 0;
    const offsetM = Math.hypot(q.x - end.x * t, q.y - end.y * t);
    if (offsetM < best.offsetM) {
      const chainageM = before + t * s.lengthM;
      best = { chainageM, offsetM, fraction: total > 0 ? chainageM / total : 0 };
    }
    before += s.lengthM;
  }
  return best;
}

/** The point `chainageM` metres along the route (clamped to its ends). */
export function pointAtChainage(route: readonly LngLat[], chainageM: number): LatLng {
  const segments = segmentsOf(route);
  const first = segments[0];
  if (!first) {
    const only = route[0];
    return only ? lngLatToLatLng(only) : { latitude: 0, longitude: 0 };
  }
  let remaining = Math.max(0, chainageM);
  for (const s of segments) {
    if (remaining <= s.lengthM) {
      const t = s.lengthM > 0 ? remaining / s.lengthM : 0;
      return {
        latitude: s.from.latitude + (s.to.latitude - s.from.latitude) * t,
        longitude: s.from.longitude + (s.to.longitude - s.from.longitude) * t,
      };
    }
    remaining -= s.lengthM;
  }
  const last = segments[segments.length - 1] ?? first;
  return last.to;
}

/**
 * Points between the two ends of a route at the given fractions of its length, in [lng, lat]
 * order. This is a copy of `interpolateAlongRoute` in `backend/src/geo.ts` (same arithmetic, in
 * degrees), because that is how the backend sites the three measurement points of a new line.
 */
export function interpolateAlongRoute(route: readonly LngLat[], fractions: readonly number[]): LngLat[] {
  const first = route[0];
  if (route.length < 2) return first ? fractions.map((): LngLat => [first[0], first[1]]) : [];

  const segmentLengths: number[] = [];
  let total = 0;
  for (let i = 0; i < route.length - 1; i++) {
    const a = route[i];
    const b = route[i + 1];
    const d = a && b ? Math.hypot(b[0] - a[0], b[1] - a[1]) : 0;
    segmentLengths.push(d);
    total += d;
  }

  return fractions.map((f): LngLat => {
    let remaining = f * total;
    for (let i = 0; i < segmentLengths.length; i++) {
      const length = segmentLengths[i] ?? 0;
      const isLast = i === segmentLengths.length - 1;
      if (remaining <= length || isLast) {
        const t = length > 0 ? remaining / length : 0;
        const a = route[i];
        const b = route[i + 1];
        if (!a || !b) break;
        return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      }
      remaining -= length;
    }
    const last = route[route.length - 1];
    return last ? [last[0], last[1]] : [0, 0];
  });
}
