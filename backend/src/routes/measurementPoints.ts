import { Router } from "express";
import { query, queryOne } from "../db";
import {
  getAllMeasurementPoints,
  getMeasurementPointDetailsForAsset,
  getMeasurementPointsForAsset,
} from "../data/measurementPoints";
import { asyncRoute } from "../middleware/errors";
import type { MeasurementPoint, MeasurementPointDetail, MeasurementReadingEntry } from "../types";

export const measurementPointsRouter = Router();

/**
 * @openapi
 * /api/measurement-points:
 *   get:
 *     tags: [MeasurementPoints]
 *     summary: Every PD measurement point across every line, with latest severity rolled up. Used by the map.
 *     responses:
 *       200: { description: OK }
 */
measurementPointsRouter.get(
  "/api/measurement-points",
  asyncRoute(async (_req, res) => {
    const data = await getAllMeasurementPoints();
    res.json({ data });
  })
);

/**
 * @openapi
 * /api/measurement-points/{id}:
 *   get:
 *     tags: [MeasurementPoints]
 *     summary: A measurement point's info plus its full PD reading history
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: OK }
 *       404: { description: Not found }
 */
measurementPointsRouter.get(
  "/api/measurement-points/:id",
  asyncRoute(async (req, res) => {
    const { id } = req.params;
    const point = await queryOne<MeasurementPoint>("select * from measurement_points where id = $1", [id]);
    if (!point) {
      res.status(404).json({ message: "Resource not found." });
      return;
    }
    const asset = await queryOne<{ code: string; name: string | null }>(
      "select code, name from assets where id = $1",
      [point.asset_id]
    );
    if (!asset) {
      res.status(404).json({ message: "Resource not found." });
      return;
    }

    const entries = await query<MeasurementReadingEntry>(
      `select r.id, r.pd_magnitude, r.pd_unit, r.temperature_c, r.severity, r.pd_device, r.photo_url,
              s.surveyed_at, s.surveyor
       from pd_readings r
       join surveys s on s.id = r.survey_id
       where r.measurement_point_id = $1
       order by s.surveyed_at desc`,
      [id]
    );

    const data: MeasurementPointDetail = { ...point, asset_code: asset.code, asset_name: asset.name, readings: entries };
    res.json({ data });
  })
);

/**
 * @openapi
 * /api/assets/{id}/measurement-points:
 *   get:
 *     tags: [MeasurementPoints]
 *     summary: PD measurement points registered on one line, latest severity rolled up. Used by the PD survey form's point picker.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: OK }
 */
measurementPointsRouter.get(
  "/api/assets/:id/measurement-points",
  asyncRoute(async (req, res) => {
    const data = await getMeasurementPointsForAsset(req.params.id);
    res.json({ data });
  })
);

/**
 * @openapi
 * /api/assets/{id}/points:
 *   get:
 *     tags: [MeasurementPoints]
 *     summary: Every PD measurement point along a line, each with its full reading history. Powers the line detail panel's per-point view.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: OK }
 */
measurementPointsRouter.get(
  "/api/assets/:id/points",
  asyncRoute(async (req, res) => {
    const data = await getMeasurementPointDetailsForAsset(req.params.id);
    res.json({ data });
  })
);
