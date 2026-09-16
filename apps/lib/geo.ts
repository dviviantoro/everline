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

// interpolateAlongRoute()/DEFAULT_MEASUREMENT_FRACTIONS (siting PD measurement
// points between poles at line-creation time) moved to backend/src/geo.ts —
// that only ever happened server-side (API routes, the seed script), and
// this app has no server-side backend logic left at all now.
