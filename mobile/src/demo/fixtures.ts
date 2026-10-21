/**
 * Demo line assets, shaped like the API and following the seed's conventions
 * (`backend/scripts/seed.ts`, `backend/src/geo.ts`, `backend/src/types.ts`):
 *
 * - a corridor of N poles produces N-1 line assets, each exactly one span between two poles,
 *   coded `<corridor>-<n>` (for example `SUTM-PKL-01-1`) and named `Tiang PW-1 – Tiang PW-2`;
 * - `route_geometry` is [[lng, lat]] with the two pole endpoints only;
 * - three measurement points per span at fractions 0.25, 0.5 and 0.75 of the route, labelled
 *   `PW-1–PW-2 P1`, with `sequence_no` 1 to 3.
 *
 * Unlike the seed (poles about a kilometre apart), the demo spans are 40 to 80 m so a walk along
 * one fits in about a minute. Poles sit around the seed's centre in Pekalongan, hundreds of
 * metres from each other, so the nearest line to a GPS fix is unambiguous. Ids are deterministic
 * UUIDs; nothing here is real asset data.
 */
import { interpolateAlongRoute, MEASUREMENT_FRACTIONS, offsetLatLng, routeLengthM } from '../core/geo';
import type { LatLng, LineAssetWithPoles, LineType, LngLat, MeasurementPoint, Pole } from '../core/types';
import { uuidFromLabel } from './prng';

/** `DEFAULT_CENTER` in `backend/src/geo.ts` (Pekalongan). */
export const DEMO_CENTER: LatLng = { latitude: -6.8886, longitude: 109.6753 };

/** What the simulated Cantol reads at the strongest spot of a span, in dBmV (classified by the WASM). */
export interface DemoLine extends LineAssetWithPoles {
  spotDbmV: number;
  lengthM: number;
  points: MeasurementPoint[];
}

interface PoleSpec {
  label: string;
  /** Metres east and north of `DEMO_CENTER`. */
  east: number;
  north: number;
}

interface CorridorSpec {
  code: string;
  lineType: LineType;
  conductor: string;
  poles: PoleSpec[];
  /** One value per span: normal below 20, warning from 20, critical from 40. */
  spotDbmV: number[];
}

const CORRIDORS: CorridorSpec[] = [
  {
    code: 'SUTM-PKL-01',
    lineType: 'SUTM',
    conductor: 'AAAC 150mm2',
    poles: [
      { label: 'Tiang PW-1', east: -300, north: 200 },
      { label: 'Tiang PW-2', east: -250, north: 242 },
      { label: 'Tiang PW-3', east: -190, north: 270 },
    ],
    spotDbmV: [17, 46],
  },
  {
    code: 'SUTM-PKL-02',
    lineType: 'SUTM',
    conductor: 'AAAC 150mm2',
    poles: [
      { label: 'Tiang KR-1', east: 150, north: 250 },
      { label: 'Tiang KR-2', east: 205, north: 285 },
    ],
    spotDbmV: [27],
  },
  {
    code: 'SKTM-PKL-03',
    lineType: 'SKTM',
    conductor: 'NA2XSEYBY 3x150mm2',
    poles: [
      { label: 'Tiang MT-1', east: -100, north: -250 },
      { label: 'Tiang MT-2', east: -45, north: -215 },
    ],
    spotDbmV: [19],
  },
  {
    code: 'SUTM-PKL-04',
    lineType: 'SUTM',
    conductor: 'AAAC 95mm2',
    poles: [
      { label: 'Tiang BF-1', east: 350, north: -100 },
      { label: 'Tiang BF-2', east: 390, north: -140 },
    ],
    spotDbmV: [18],
  },
  {
    code: 'SKTM-PKL-05',
    lineType: 'SKTM',
    conductor: 'NA2XSEYBY 3x150mm2',
    poles: [
      { label: 'Tiang BK-1', east: 100, north: -320 },
      { label: 'Tiang BK-2', east: 150, north: -350 },
      { label: 'Tiang BK-3', east: 210, north: -380 },
    ],
    spotDbmV: [31, 43],
  },
];

const round6 = (value: number): number => Math.round(value * 1e6) / 1e6;

/** "Tiang PW-1" becomes "PW-1", as the seed names a span's measurement points. */
const shortPole = (label: string): string => label.replace(/^Tiang\s+/i, '');

function makePole(spec: PoleSpec): Pole {
  const at = offsetLatLng(DEMO_CENTER, spec.east, spec.north);
  return {
    id: uuidFromLabel(`pole:${spec.label}`),
    label: spec.label,
    latitude: round6(at.latitude),
    longitude: round6(at.longitude),
  };
}

/** Builds the fixtures. Pure and deterministic: the same call always returns equal data. */
export function buildDemoLines(): DemoLine[] {
  const lines: DemoLine[] = [];
  for (const corridor of CORRIDORS) {
    const poles = corridor.poles.map(makePole);
    for (let seg = 0; seg < poles.length - 1; seg++) {
      const poleA = poles[seg];
      const poleB = poles[seg + 1];
      const spot = corridor.spotDbmV[seg];
      if (!poleA || !poleB || spot === undefined) throw new Error(`fixture ${corridor.code} is inconsistent`);

      const code = `${corridor.code}-${String(seg + 1)}`;
      const assetId = uuidFromLabel(`asset:${code}`);
      const route: LngLat[] = [
        [poleA.longitude, poleA.latitude],
        [poleB.longitude, poleB.latitude],
      ];
      const spanName = `${shortPole(poleA.label ?? '')}–${shortPole(poleB.label ?? '')}`;
      const points: MeasurementPoint[] = interpolateAlongRoute(route, MEASUREMENT_FRACTIONS).map(
        ([lng, lat], index) => ({
          id: uuidFromLabel(`mp:${code}:${String(index + 1)}`),
          asset_id: assetId,
          sequence_no: index + 1,
          label: `${spanName} P${String(index + 1)}`,
          latitude: round6(lat),
          longitude: round6(lng),
        }),
      );

      lines.push({
        id: assetId,
        type: 'line',
        code,
        name: `${poleA.label ?? ''} – ${poleB.label ?? ''}`,
        line_type: corridor.lineType,
        conductor_type: corridor.conductor,
        route_geometry: route,
        pole_a_id: poleA.id,
        pole_b_id: poleB.id,
        pole_a: poleA,
        pole_b: poleB,
        spotDbmV: spot,
        lengthM: routeLengthM(route),
        points,
      });
    }
  }
  return lines.sort((a, b) => a.code.localeCompare(b.code));
}

/** The line a demo session starts near: a warning case, so the classified default is not trivial. */
export const DEFAULT_SPOT_CODE = 'SUTM-PKL-02-1';
