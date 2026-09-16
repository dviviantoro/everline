import { Router } from "express";
import { query, queryOne } from "../db";
import { telemetrySchema } from "../validation";
import { asyncRoute, validationErrorBody } from "../middleware/errors";

export const telemetryRouter = Router();

/**
 * @openapi
 * /api/assets/{id}/telemetry:
 *   get:
 *     tags: [Telemetry]
 *     summary: Time-series telemetry slice for the chart
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: hours
 *         schema: { type: integer, default: 24 }
 *     responses:
 *       200: { description: OK }
 */
telemetryRouter.get(
  "/api/assets/:id/telemetry",
  asyncRoute(async (req, res) => {
    const { id } = req.params;
    const hours = Number(req.query.hours ?? "24");
    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

    const data = await query(
      "select * from transformer_telemetry where asset_id = $1 and recorded_at >= $2 order by recorded_at asc",
      [id, since]
    );
    res.json({ data });
  })
);

/**
 * @openapi
 * /api/assets/{id}/telemetry:
 *   post:
 *     tags: [Telemetry]
 *     summary: IoT ingestion — one push roughly every 5 minutes, insert-only
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       201: { description: Telemetry recorded }
 *       400: { description: Validation failed }
 */
telemetryRouter.post(
  "/api/assets/:id/telemetry",
  asyncRoute(async (req, res) => {
    const asset_id = req.params.id;
    const parsed = telemetrySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json(validationErrorBody(parsed.error.flatten().fieldErrors));
      return;
    }
    const { recorded_at, ...reading } = parsed.data;
    const fields = { asset_id, recorded_at: recorded_at ?? new Date().toISOString(), ...reading } as Record<
      string,
      unknown
    >;
    const columns = Object.keys(fields);
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");

    const row = await queryOne<{ id: string }>(
      `insert into transformer_telemetry (${columns.join(", ")}) values (${placeholders}) returning id`,
      columns.map((c) => fields[c])
    );

    res.status(201).json({ data: { telemetry_id: row?.id }, message: "Telemetry recorded" });
  })
);
