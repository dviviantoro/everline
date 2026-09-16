import { query } from "../db";
import type {
  MeasurementPoint,
  MeasurementPointListItem,
  MeasurementPointWithReadings,
  MeasurementReadingEntry,
  Severity,
} from "../types";

async function attachLatestSeverity(points: MeasurementPoint[]): Promise<MeasurementPointListItem[]> {
  const pointIds = points.map((p) => p.id);
  const latestByPoint = new Map<string, Severity | null>();

  if (pointIds.length > 0) {
    const rows = await query<{ measurement_point_id: string; severity: Severity | null; surveyed_at: string }>(
      `select r.measurement_point_id, r.severity, s.surveyed_at
       from pd_readings r
       join surveys s on s.id = r.survey_id
       where r.measurement_point_id = any($1)
       order by s.surveyed_at desc`,
      [pointIds]
    );

    for (const r of rows) {
      if (!latestByPoint.has(r.measurement_point_id)) {
        latestByPoint.set(r.measurement_point_id, r.severity);
      }
    }
  }

  return points.map((p) => ({ ...p, latest_severity: latestByPoint.get(p.id) ?? null }));
}

/** All measurement points across every line — used by the map. */
export async function getAllMeasurementPoints(): Promise<MeasurementPointListItem[]> {
  const points = await query<MeasurementPoint>("select * from measurement_points order by sequence_no asc");
  return attachLatestSeverity(points);
}

/** Measurement points on one line — used by the PD survey form's point picker. */
export async function getMeasurementPointsForAsset(assetId: string): Promise<MeasurementPointListItem[]> {
  const points = await query<MeasurementPoint>(
    "select * from measurement_points where asset_id = $1 order by sequence_no asc",
    [assetId]
  );
  return attachLatestSeverity(points);
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
