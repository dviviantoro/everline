import { query } from "../db";
import type {
  MeasurementPoint,
  MeasurementPointListItem,
  MeasurementPointWithReadings,
  MeasurementReadingEntry,
  Severity,
} from "../types";

interface LatestReadingRow {
  measurement_point_id: string;
  severity: Severity | null;
  pd_magnitude: number | null;
  pd_unit: string | null;
  temperature_c: number | null;
  pd_device: string | null;
  surveyor: string | null;
  surveyed_at: string;
}

async function attachLatestReading(points: MeasurementPoint[]): Promise<MeasurementPointListItem[]> {
  const pointIds = points.map((p) => p.id);
  const latestByPoint = new Map<string, LatestReadingRow>();
  const historyByPoint = new Map<string, { surveyed_at: string; pd_magnitude: number | null }[]>();

  if (pointIds.length > 0) {
    const rows = await query<LatestReadingRow>(
      `select r.measurement_point_id, r.severity, r.pd_magnitude, r.pd_unit,
              r.temperature_c, r.pd_device, s.surveyor, s.surveyed_at
       from pd_readings r
       join surveys s on s.id = r.survey_id
       where r.measurement_point_id = any($1)
       order by s.surveyed_at desc`,
      [pointIds]
    );

    for (const r of rows) {
      if (!latestByPoint.has(r.measurement_point_id)) {
        latestByPoint.set(r.measurement_point_id, r);
      }
      const list = historyByPoint.get(r.measurement_point_id) ?? [];
      list.push({ surveyed_at: r.surveyed_at, pd_magnitude: r.pd_magnitude });
      historyByPoint.set(r.measurement_point_id, list);
    }
  }

  return points.map((p) => {
    const latest = latestByPoint.get(p.id);
    return {
      ...p,
      // rows arrive newest-first; the graph wants oldest-first
      history: (historyByPoint.get(p.id) ?? []).slice().reverse(),
      latest_severity: latest?.severity ?? null,
      latest_pd_magnitude: latest?.pd_magnitude ?? null,
      latest_pd_unit: latest?.pd_unit ?? null,
      latest_temperature_c: latest?.temperature_c ?? null,
      latest_pd_device: latest?.pd_device ?? null,
      latest_surveyor: latest?.surveyor ?? null,
      latest_surveyed_at: latest?.surveyed_at ?? null,
    };
  });
}

/** All measurement points across every line — used by the map. */
export async function getAllMeasurementPoints(): Promise<MeasurementPointListItem[]> {
  const points = await query<MeasurementPoint>("select * from measurement_points order by sequence_no asc");
  return attachLatestReading(points);
}

/** Measurement points on one line — used by the PD survey form's point picker. */
export async function getMeasurementPointsForAsset(assetId: string): Promise<MeasurementPointListItem[]> {
  const points = await query<MeasurementPoint>(
    "select * from measurement_points where asset_id = $1 order by sequence_no asc",
    [assetId]
  );
  return attachLatestReading(points);
}

/**
 * Measurement points on one line, each carrying its own full PD reading
 * history — used to render the "point measurements" section (last value +
 * history graph per point) on a line's detail panel.
 */
export async function getMeasurementPointDetailsForAsset(assetId: string): Promise<MeasurementPointWithReadings[]> {
  const points = await query<MeasurementPoint>(
    "select * from measurement_points where asset_id = $1 order by sequence_no asc",
    [assetId]
  );

  const pointIds = points.map((p) => p.id);
  const readingsByPoint = new Map<string, MeasurementReadingEntry[]>();

  if (pointIds.length > 0) {
    const rows = await query<
      MeasurementReadingEntry & { measurement_point_id: string }
    >(
      `select r.id, r.measurement_point_id, r.pd_magnitude, r.pd_unit, r.temperature_c, r.severity,
              r.pd_device, r.photo_url, s.surveyed_at, s.surveyor
       from pd_readings r
       join surveys s on s.id = r.survey_id
       where r.measurement_point_id = any($1)
       order by s.surveyed_at desc`,
      [pointIds]
    );

    for (const r of rows) {
      const { measurement_point_id, ...entry } = r;
      const list = readingsByPoint.get(measurement_point_id) ?? [];
      list.push(entry);
      readingsByPoint.set(measurement_point_id, list);
    }
  }

  return points.map((p) => ({ ...p, readings: readingsByPoint.get(p.id) ?? [] }));
}
