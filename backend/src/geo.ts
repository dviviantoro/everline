// Storage uses GeoJSON-style [lng, lat] order (planning/database.md, assets.route_geometry).
// Leaflet wants [lat, lng]. This is the one place that swap happens — nothing else
// in the mapping layer should do it ad hoc (planning/PROJECT_BRIEF.md §2b).
export function toLatLng([lng, lat]: [number, number]): [number, number] {
  return [lat, lng];
}

export function routeToLatLngs(route: [number, number][] | null | undefined): [number, number][] {
  return (route ?? []).map(toLatLng);
}

// Central Java service area — reasonable default map center (Pekalongan).
export const DEFAULT_CENTER: [number, number] = [-6.8886, 109.6753];
export const DEFAULT_ZOOM = 13;

/**
 * Points strictly between the two ends of a polyline route (also [lng, lat]
 * order), at given fractions of its total length (e.g. 0.25/0.5/0.75 for 3
 * evenly spaced points). Used to site PD measurement points between poles
 * along a line, rather than at the poles themselves.
 */
export function interpolateAlongRoute(route: [number, number][], fractions: number[]): [number, number][] {
  if (route.length < 2) return fractions.map(() => route[0]).filter(Boolean);

  const segmentLengths: number[] = [];
  let total = 0;
  for (let i = 0; i < route.length - 1; i++) {
    const [lng1, lat1] = route[i];
    const [lng2, lat2] = route[i + 1];
    const d = Math.hypot(lng2 - lng1, lat2 - lat1);
    segmentLengths.push(d);
    total += d;
  }

  return fractions.map((f) => {
    let remaining = f * total;
    for (let i = 0; i < segmentLengths.length; i++) {
      const isLast = i === segmentLengths.length - 1;
      if (remaining <= segmentLengths[i] || isLast) {
        const t = segmentLengths[i] > 0 ? remaining / segmentLengths[i] : 0;
        const [lng1, lat1] = route[i];
        const [lng2, lat2] = route[i + 1];
        return [lng1 + (lng2 - lng1) * t, lat1 + (lat2 - lat1) * t] as [number, number];
      }
      remaining -= segmentLengths[i];
    }
    return route[route.length - 1];
  });
}

/** Standard spacing for auto-sited measurement points along a new line. */
export const DEFAULT_MEASUREMENT_FRACTIONS = [0.25, 0.5, 0.75];
