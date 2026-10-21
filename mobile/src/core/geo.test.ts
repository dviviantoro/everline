import { describe, expect, it } from 'vitest';

import {
  haversineM,
  interpolateAlongRoute,
  offsetLatLng,
  pointAtChainage,
  projectOntoRoute,
  routeLengthM,
} from './geo';
import type { LatLng, LngLat } from './types';

const origin: LatLng = { latitude: -6.8886, longitude: 109.6753 };

describe('geo helpers', () => {
  it('offsets by metres and measures them back', () => {
    const p = offsetLatLng(origin, 30, 40);
    expect(haversineM(origin, p)).toBeCloseTo(50, 0);
  });

  it('projects a point onto a route and recovers its chainage', () => {
    const a = offsetLatLng(origin, 0, 0);
    const b = offsetLatLng(origin, 60, 0);
    const route: LngLat[] = [
      [a.longitude, a.latitude],
      [b.longitude, b.latitude],
    ];
    expect(routeLengthM(route)).toBeCloseTo(60, 1);
    const p = offsetLatLng(origin, 15, 3);
    const projection = projectOntoRoute(route, p);
    expect(projection.chainageM).toBeCloseTo(15, 1);
    expect(projection.offsetM).toBeCloseTo(3, 1);
    expect(projection.fraction).toBeCloseTo(0.25, 2);
  });

  it('clamps beyond the ends and finds points at a chainage', () => {
    const a = offsetLatLng(origin, 0, 0);
    const b = offsetLatLng(origin, 0, 40);
    const route: LngLat[] = [
      [a.longitude, a.latitude],
      [b.longitude, b.latitude],
    ];
    expect(projectOntoRoute(route, offsetLatLng(origin, 0, -10)).chainageM).toBe(0);
    expect(projectOntoRoute(route, offsetLatLng(origin, 0, 90)).fraction).toBe(1);
    const mid = pointAtChainage(route, 20);
    expect(haversineM(mid, offsetLatLng(origin, 0, 20))).toBeLessThan(0.05);
  });

  it('sites points along a route the way backend/src/geo.ts does', () => {
    const route: LngLat[] = [
      [0, 0],
      [4, 0],
    ];
    expect(interpolateAlongRoute(route, [0.25, 0.5, 0.75])).toEqual([
      [1, 0],
      [2, 0],
      [3, 0],
    ]);
  });
});
