import { Router } from "express";
import { query } from "../db";
import { importLinesSchema, importPolesSchema, importTransformersSchema } from "../validation";
import { interpolateAlongRoute, DEFAULT_MEASUREMENT_FRACTIONS } from "../geo";
import { asyncRoute, validationErrorBody } from "../middleware/errors";
import type { Pole } from "../types";

export const importsRouter = Router();

/**
 * @openapi
 * /api/import/poles:
 *   post:
 *     tags: [Import]
 *     summary: Bulk pole registration from a parsed CSV (client parses, this validates + inserts)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               rows:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     label: { type: string }
 *                     latitude: { type: number }
 *                     longitude: { type: number }
 *     responses:
 *       201: { description: Imported }
 *       400: { description: Validation failed }
 */
importsRouter.post(
  "/api/import/poles",
  asyncRoute(async (req, res) => {
    const parsed = importPolesSchema.safeParse(req.body?.rows);
    if (!parsed.success) {
      res.status(400).json(validationErrorBody(parsed.error.flatten().fieldErrors));
      return;
    }

    const inserted: { id: string }[] = [];
    for (const row of parsed.data) {
      const result = await query<{ id: string }>(
        "insert into poles (label, latitude, longitude) values ($1, $2, $3) returning id",
        [row.label ?? null, row.latitude, row.longitude]
      );
      inserted.push(...result);
    }

    res.status(201).json({ data: inserted, message: `Imported ${inserted.length} pole(s)` });
  })
);

/**
 * @openapi
 * /api/import/transformers:
 *   post:
 *     tags: [Import]
 *     summary: Bulk transformer registration from a parsed CSV
 *     responses:
 *       201: { description: Imported }
 *       400: { description: Validation failed }
 */
importsRouter.post(
  "/api/import/transformers",
  asyncRoute(async (req, res) => {
    const parsed = importTransformersSchema.safeParse(req.body?.rows);
    if (!parsed.success) {
      res.status(400).json(validationErrorBody(parsed.error.flatten().fieldErrors));
      return;
    }

    const inserted: { id: string }[] = [];
    for (const row of parsed.data) {
      const fields = { ...row, type: "transformer" } as Record<string, unknown>;
      const columns = Object.keys(fields);
      const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
      const result = await query<{ id: string }>(
        `insert into assets (${columns.join(", ")}) values (${placeholders}) returning id`,
        columns.map((c) => fields[c])
      );
      inserted.push(...result);
    }

    res.status(201).json({ data: inserted, message: `Imported ${inserted.length} transformer(s)` });
  })
);

/**
 * @openapi
 * /api/import/lines:
 *   post:
 *     tags: [Import]
 *     summary: Bulk line-segment registration — each row names its 2 endpoint poles by label (resolved case-insensitively). All rows must resolve or nothing is inserted.
 *     responses:
 *       201: { description: Imported }
 *       400: { description: Validation failed, or a row's pole label could not be resolved }
 */
importsRouter.post(
  "/api/import/lines",
  asyncRoute(async (req, res) => {
    const parsed = importLinesSchema.safeParse(req.body?.rows);
    if (!parsed.success) {
      res.status(400).json(validationErrorBody(parsed.error.flatten().fieldErrors));
      return;
    }

    const poles = await query<Pole>("select * from poles");
    const byLabel = new Map<string, Pole>();
    for (const p of poles) {
      if (p.label) byLabel.set(p.label.trim().toLowerCase(), p);
    }

    const rowErrors: string[] = [];
    const toInsert: { code: string; name?: string; line_type?: string; conductor_type?: string; pole_a_id: string; pole_b_id: string; route_geometry: [number, number][] }[] = [];

    parsed.data.forEach((row, i) => {
      const poleA = byLabel.get(row.pole_a_label.trim().toLowerCase());
      const poleB = byLabel.get(row.pole_b_label.trim().toLowerCase());
      if (!poleA) rowErrors.push(`Row ${i + 1}: pole "${row.pole_a_label}" not found — add it first.`);
      if (!poleB) rowErrors.push(`Row ${i + 1}: pole "${row.pole_b_label}" not found — add it first.`);
      if (poleA && poleB && poleA.id === poleB.id) rowErrors.push(`Row ${i + 1}: pole_a and pole_b must be different.`);
      if (!poleA || !poleB || poleA.id === poleB.id) return;

      toInsert.push({
        code: row.code,
        name: row.name ?? `${poleA.label ?? "Pole"} – ${poleB.label ?? "Pole"}`,
        line_type: row.line_type,
        conductor_type: row.conductor_type,
        pole_a_id: poleA.id,
        pole_b_id: poleB.id,
        route_geometry: [
          [poleA.longitude, poleA.latitude],
          [poleB.longitude, poleB.latitude],
        ],
      });
    });

    if (rowErrors.length > 0) {
      res.status(400).json({ message: "Some rows could not be resolved.", errors: { rows: rowErrors } });
      return;
    }

    const inserted: { id: string; route_geometry: [number, number][] }[] = [];
    for (const line of toInsert) {
      const fields = { type: "line", ...line } as Record<string, unknown>;
      const columns = Object.keys(fields);
      const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
      const rows = await query<{ id: string; route_geometry: unknown }>(
        `insert into assets (${columns.join(", ")}) values (${placeholders}) returning id, route_geometry`,
        columns.map((c) => (c === "route_geometry" ? JSON.stringify(fields[c]) : fields[c]))
      );
      inserted.push(...(rows as { id: string; route_geometry: [number, number][] }[]));
    }

    for (const asset of inserted) {
      const points = interpolateAlongRoute(asset.route_geometry, DEFAULT_MEASUREMENT_FRACTIONS);
      for (const [i, [lng, lat]] of points.entries()) {
        await query(
          "insert into measurement_points (asset_id, sequence_no, label, latitude, longitude) values ($1, $2, $3, $4, $5)",
          [asset.id, i + 1, `Point ${i + 1}`, lat, lng]
        );
      }
    }

    res.status(201).json({ data: inserted, message: `Imported ${inserted.length} line(s)` });
  })
);
