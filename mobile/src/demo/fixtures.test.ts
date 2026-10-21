import { describe, expect, it } from 'vitest';

import { haversineM, projectOntoRoute } from '../core/geo';
import { nodeDsp } from '../test/dspNode';
import { buildDemoLines, DEMO_CENTER, DEFAULT_SPOT_CODE } from './fixtures';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const lines = buildDemoLines();

describe('demo line fixtures', () => {
  it('has at least 3 SUTM and 2 SKTM spans, coded like the seed', () => {
    const sutm = lines.filter((l) => l.line_type === 'SUTM');
    const sktm = lines.filter((l) => l.line_type === 'SKTM');
    expect(sutm.length).toBeGreaterThanOrEqual(3);
    expect(sktm.length).toBeGreaterThanOrEqual(2);
    for (const line of lines) {
      expect(line.code).toMatch(/^(SUTM|SKTM)-PKL-\d{2}-\d+$/);
      expect(line.code.startsWith(line.line_type)).toBe(true);
      expect(line.type).toBe('line');
      expect(line.name).toBe(`${line.pole_a.label ?? ''} – ${line.pole_b.label ?? ''}`);
    }
    expect(new Set(lines.map((l) => l.code)).size).toBe(lines.length);
  });

  it('uses UUID ids everywhere and links poles to the asset', () => {
    const ids = new Set<string>();
    for (const line of lines) {
      for (const id of [line.id, line.pole_a_id, line.pole_b_id, ...line.points.map((p) => p.id)]) {
        expect(id).toMatch(UUID);
      }
      expect(line.pole_a.id).toBe(line.pole_a_id);
      expect(line.pole_b.id).toBe(line.pole_b_id);
      ids.add(line.id);
      for (const p of line.points) ids.add(p.id);
    }
    expect(ids.size).toBe(lines.length * 4);
  });

  it('shares a pole between two spans of one corridor, as the seed does', () => {
    const first = lines.find((l) => l.code === 'SUTM-PKL-01-1');
    const second = lines.find((l) => l.code === 'SUTM-PKL-01-2');
    expect(first?.pole_b_id).toBe(second?.pole_a_id);
  });

  it('is one span: two endpoints, 40 to 80 m, near the seed centre in Pekalongan', () => {
    for (const line of lines) {
      expect(line.route_geometry).toHaveLength(2);
      expect(line.route_geometry[0]).toEqual([line.pole_a.longitude, line.pole_a.latitude]);
      expect(line.route_geometry[1]).toEqual([line.pole_b.longitude, line.pole_b.latitude]);
      expect(line.lengthM).toBeGreaterThanOrEqual(40);
      expect(line.lengthM).toBeLessThanOrEqual(80);
      expect(haversineM(DEMO_CENTER, line.pole_a)).toBeLessThan(1000);
      expect(haversineM(DEMO_CENTER, line.pole_b)).toBeLessThan(1000);
    }
  });

  it('has three measurement points per span at 0.25, 0.5 and 0.75 of the route', () => {
    for (const line of lines) {
      expect(line.points).toHaveLength(3);
      expect(line.points.map((p) => p.sequence_no)).toEqual([1, 2, 3]);
      const fractions = line.points.map((p) => projectOntoRoute(line.route_geometry, p).fraction);
      expect(fractions[0]).toBeCloseTo(0.25, 2);
      expect(fractions[1]).toBeCloseTo(0.5, 2);
      expect(fractions[2]).toBeCloseTo(0.75, 2);
      for (const p of line.points) {
        expect(p.asset_id).toBe(line.id);
        // Coordinates are rounded to 6 decimals, which is about 11 cm.
        expect(projectOntoRoute(line.route_geometry, p).offsetM).toBeLessThan(0.15);
      }
    }
  });

  it('labels points like the seed: "PW-1–PW-2 P1"', () => {
    const line = lines.find((l) => l.code === 'SUTM-PKL-01-1');
    expect(line?.points.map((p) => p.label)).toEqual(['PW-1–PW-2 P1', 'PW-1–PW-2 P2', 'PW-1–PW-2 P3']);
  });

  it('covers normal, warning and critical as the WASM classifies them', () => {
    const dsp = nodeDsp();
    const classes = new Set(lines.map((l) => dsp.classify(l.spotDbmV)));
    expect(classes).toEqual(new Set(['normal', 'warning', 'critical']));
    // The demo starts next to a warning case so the classified default is not trivial.
    const start = lines.find((l) => l.code === DEFAULT_SPOT_CODE);
    expect(start && dsp.classify(start.spotDbmV)).toBe('warning');
  });

  it('is deterministic: building twice gives equal data', () => {
    expect(buildDemoLines()).toEqual(buildDemoLines());
  });
});
