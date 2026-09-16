import { Router } from "express";
import { query, queryOne } from "../db";
import { getAssetList } from "../data/assets";
import { createAssetSchema, updateAssetSchema } from "../validation";
import { interpolateAlongRoute, DEFAULT_MEASUREMENT_FRACTIONS } from "../geo";
import { asyncRoute, validationErrorBody } from "../middleware/errors";
import type { Asset, AssetType, Pole, TransformerReading } from "../types";

export const assetsRouter = Router();

/**
 * @openapi
 * /api/assets:
 *   get:
 *     tags: [Assets]
 *     summary: List assets (transformers + lines), each with its latest survey rollup
 *     parameters:
 *       - in: query
 *         name: type
 *         schema: { type: string, enum: [transformer, line] }
 *     responses:
 *       200:
 *         description: OK
 */
assetsRouter.get(
  "/api/assets",
  asyncRoute(async (req, res) => {
    const type = (req.query.type as AssetType | undefined) ?? null;
    const data = await getAssetList(type);
    res.json({ data });
  })
);

/**
 * @openapi
 * /api/assets:
 *   post:
 *     tags: [Assets]
 *     summary: Register a new transformer, or a new line segment between 2 existing poles
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               type: { type: string, enum: [transformer, line] }
 *               code: { type: string }
 *               name: { type: string }
 *               latitude: { type: number }
 *               longitude: { type: number }
 *               rated_capacity_kva: { type: number }
 *               line_type: { type: string, enum: [SUTM, SKTM] }
 *               conductor_type: { type: string }
 *               pole_a_id: { type: string, format: uuid }
 *               pole_b_id: { type: string, format: uuid }
 *     responses:
 *       201: { description: Created }
 *       400: { description: Validation failed }
 */
assetsRouter.post(
  "/api/assets",
  asyncRoute(async (req, res) => {
    const parsed = createAssetSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json(validationErrorBody(parsed.error.flatten().fieldErrors));
      return;
    }

    const { pole_a_id, pole_b_id, ...assetFields } = parsed.data;

    let lineFields: { route_geometry: [number, number][]; pole_a_id: string; pole_b_id: string; name?: string } | null =
      null;

    if (assetFields.type === "line") {
      const poles = await query<Pole>("select * from poles where id = any($1)", [[pole_a_id, pole_b_id]]);
      const poleA = poles.find((p) => p.id === pole_a_id);
      const poleB = poles.find((p) => p.id === pole_b_id);
      if (!poleA || !poleB) {
        res.status(400).json({ message: "pole_a_id and/or pole_b_id do not exist." });
        return;
      }
      lineFields = {
        route_geometry: [
          [poleA.longitude, poleA.latitude],
          [poleB.longitude, poleB.latitude],
        ],
        pole_a_id: poleA.id,
        pole_b_id: poleB.id,
        name: assetFields.name ?? `${poleA.label ?? "Pole"} – ${poleB.label ?? "Pole"}`,
      };
    }

    const fields: Record<string, unknown> = { ...assetFields, ...lineFields };
    const columns = Object.keys(fields);
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
    const asset = await queryOne<{ id: string; code: string }>(
      `insert into assets (${columns.join(", ")}) values (${placeholders}) returning id, code`,
      columns.map((c) => (c === "route_geometry" ? JSON.stringify(fields[c]) : fields[c]))
    );

    if (!asset) {
      res.status(500).json({ message: "Failed to create asset." });
      return;
    }

    if (lineFields) {
      const points = interpolateAlongRoute(lineFields.route_geometry, DEFAULT_MEASUREMENT_FRACTIONS);
      for (const [i, [lng, lat]] of points.entries()) {
        await query(
          `insert into measurement_points (asset_id, sequence_no, label, latitude, longitude)
           values ($1, $2, $3, $4, $5)`,
          [asset.id, i + 1, `Point ${i + 1}`, lat, lng]
        );
      }
    }

    res.status(201).json({ data: asset, message: "Created successfully" });
  })
);

/**
 * @openapi
 * /api/assets/{id}:
 *   get:
 *     tags: [Assets]
 *     summary: Full survey history for one asset
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: OK }
 *       404: { description: Not found }
 */
assetsRouter.get(
  "/api/assets/:id",
  asyncRoute(async (req, res) => {
    const { id } = req.params;
    const asset = await queryOne<Asset>("select * from assets where id = $1", [id]);
    if (!asset) {
      res.status(404).json({ message: "Resource not found." });
      return;
    }

    if (asset.type === "transformer") {
      const surveys = await query<{
        id: string;
        asset_id: string;
        surveyed_at: string;
        surveyor: string | null;
        notes: string | null;
        created_at: string;
      }>("select id, asset_id, surveyed_at, surveyor, notes, created_at from surveys where asset_id = $1 order by surveyed_at desc", [id]);

      const surveyIds = surveys.map((s) => s.id);
      const readings = surveyIds.length
        ? await query<TransformerReading>("select * from transformer_readings where survey_id = any($1)", [surveyIds])
        : [];
      const readingBySurvey = new Map(readings.map((r) => [r.survey_id, r]));

      const shaped = surveys.map((survey) => {
        const r = readingBySurvey.get(survey.id);
        return {
          ...survey,
          reading: r
            ? {
                voltage_primary_kv: r.voltage_primary_kv,
                voltage_secondary_v: r.voltage_secondary_v,
                current_r_a: r.current_r_a,
                current_s_a: r.current_s_a,
                current_t_a: r.current_t_a,
                load_percent: r.load_percent,
                oil_temp_c: r.oil_temp_c,
                ambient_temp_c: r.ambient_temp_c,
                condition: r.condition,
              }
            : null,
        };
      });
      res.json({ data: { ...asset, surveys: shaped } });
      return;
    }

    const surveys = await query<{
      id: string;
      asset_id: string;
      surveyed_at: string;
      surveyor: string | null;
      notes: string | null;
      created_at: string;
    }>("select id, asset_id, surveyed_at, surveyor, notes, created_at from surveys where asset_id = $1 order by surveyed_at desc", [id]);

    const surveyIds = surveys.map((s) => s.id);
    const points = surveyIds.length
      ? await query<Record<string, unknown> & { survey_id: string }>(
          "select * from pd_readings where survey_id = any($1) order by sequence_no asc",
          [surveyIds]
        )
      : [];
    const pointsBySurvey = new Map<string, typeof points>();
    for (const p of points) {
      const list = pointsBySurvey.get(p.survey_id) ?? [];
      list.push(p);
      pointsBySurvey.set(p.survey_id, list);
    }

    const shaped = surveys.map((survey) => ({
      ...survey,
      points: (pointsBySurvey.get(survey.id) ?? []).map((p) => ({
        id: p.id,
        measurement_point_id: p.measurement_point_id,
        sequence_no: p.sequence_no,
        point_label: p.point_label,
        latitude: p.latitude,
        longitude: p.longitude,
        pd_magnitude: p.pd_magnitude,
        pd_unit: p.pd_unit,
        temperature_c: p.temperature_c,
        ambient_temp_c: p.ambient_temp_c,
        severity: p.severity,
        pd_device: p.pd_device,
        photo_url: p.photo_url,
      })),
    }));
    res.json({ data: { ...asset, surveys: shaped } });
  })
);

/**
 * @openapi
 * /api/assets/{id}:
 *   put:
 *     tags: [Assets]
 *     summary: Update registry metadata only (never touches surveys/readings)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Updated }
 *       400: { description: Validation failed }
 *       404: { description: Not found }
 */
assetsRouter.put(
  "/api/assets/:id",
  asyncRoute(async (req, res) => {
    const { id } = req.params;
    const parsed = updateAssetSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json(validationErrorBody(parsed.error.flatten().fieldErrors));
      return;
    }
    const fields = parsed.data as Record<string, unknown>;
    const columns = Object.keys(fields);
    if (columns.length === 0) {
      res.status(400).json({ message: "No fields to update." });
      return;
    }

    const setClause = columns.map((c, i) => `${c} = $${i + 1}`).join(", ");
    const asset = await queryOne<Asset>(
      `update assets set ${setClause} where id = $${columns.length + 1} returning *`,
      [...columns.map((c) => fields[c]), id]
    );

    if (!asset) {
      res.status(404).json({ message: "Resource not found." });
      return;
    }
    res.json({ data: asset, message: "Updated successfully" });
  })
);
