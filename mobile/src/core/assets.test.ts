import { describe, expect, it } from 'vitest';

import { buildDemoLines } from '../demo/fixtures';
import { listAssets, nearestAsset, nearestPoint } from './assets';
import { offsetLatLng } from './geo';

const lines = buildDemoLines();
const kr = lines.find((l) => l.code === 'SUTM-PKL-02-1');
if (!kr) throw new Error('fixture missing');
const p2 = kr.points[1];
if (!p2) throw new Error('fixture missing');

describe('choosing a line', () => {
  it('finds the line a fix is standing next to, and the point nearest to it', () => {
    const fix = offsetLatLng(p2, 3, 2);
    expect(nearestAsset(lines, fix)?.code).toBe('SUTM-PKL-02-1');
    expect(nearestPoint(kr.points, fix)?.sequence_no).toBe(2);
    const nearP1 = offsetLatLng(kr.points[0] ?? p2, 1, 1);
    expect(nearestPoint(kr.points, nearP1)?.sequence_no).toBe(1);
  });

  it('has no nearest line without a fix', () => {
    expect(nearestAsset(lines, null)).toBeNull();
    expect(nearestPoint(kr.points, null)?.sequence_no).toBe(1);
  });

  it('lists one kind at a time, nearest first, filtered by the typed code', () => {
    const fix = offsetLatLng(p2, 3, 2);
    const sutm = listAssets(lines, fix, 'SUTM', '');
    expect(sutm.every((x) => x.asset.line_type === 'SUTM')).toBe(true);
    expect(sutm[0]?.asset.code).toBe('SUTM-PKL-02-1');
    const offsets = sutm.map((x) => x.offsetM ?? 0);
    expect([...offsets].sort((a, b) => a - b)).toEqual(offsets);
    expect(listAssets(lines, fix, 'SKTM', '').length).toBe(lines.filter((l) => l.line_type === 'SKTM').length);
    expect(listAssets(lines, fix, 'SUTM', ' pkl-01 ').map((x) => x.asset.code).sort()).toEqual(['SUTM-PKL-01-1', 'SUTM-PKL-01-2']);
    expect(listAssets(lines, fix, 'SUTM', 'nothing like this')).toEqual([]);
  });
});
