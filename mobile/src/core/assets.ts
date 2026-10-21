/** Picking the line a reading belongs to: nearest first, by distance from a GPS fix to each route. */
import { haversineM, projectOntoRoute } from './geo';
import type { LatLng, LineAssetWithPoles, LineType, MeasurementPoint } from './types';

export interface AssetDistance {
  asset: LineAssetWithPoles;
  /** Metres from the fix to the nearest point of the route, or null without a fix. */
  offsetM: number | null;
}

/** Assets of one kind whose code contains `query`, nearest first (list order when there is no fix). */
export function listAssets(
  assets: readonly LineAssetWithPoles[],
  fix: LatLng | null,
  kind: LineType,
  query: string,
): AssetDistance[] {
  const needle = query.trim().toLowerCase();
  return assets
    .filter((a) => a.line_type === kind && a.code.toLowerCase().includes(needle))
    .map((asset) => ({ asset, offsetM: fix ? projectOntoRoute(asset.route_geometry, fix).offsetM : null }))
    .sort((a, b) => (a.offsetM ?? 0) - (b.offsetM ?? 0));
}

/** The line closest to the fix, of any kind, or null without a fix or assets. */
export function nearestAsset(assets: readonly LineAssetWithPoles[], fix: LatLng | null): LineAssetWithPoles | null {
  if (!fix) return null;
  let best: { asset: LineAssetWithPoles; offsetM: number } | null = null;
  for (const asset of assets) {
    const offsetM = projectOntoRoute(asset.route_geometry, fix).offsetM;
    if (!best || offsetM < best.offsetM) best = { asset, offsetM };
  }
  return best?.asset ?? null;
}

/** The measurement point closest to the fix (the first one without a fix). */
export function nearestPoint(points: readonly MeasurementPoint[], fix: LatLng | null): MeasurementPoint | null {
  let best: { point: MeasurementPoint; d: number } | null = null;
  for (const point of points) {
    const d = fix ? haversineM(fix, point) : 0;
    if (!best || d < best.d) best = { point, d };
  }
  return best?.point ?? null;
}
