import { Router } from "express";
import { query, queryOne } from "../db";
import { pdSurveySchema, transformerSurveySchema } from "../validation";
import { asyncRoute, validationErrorBody } from "../middleware/errors";

export const surveysRouter = Router();

/**
 * @openapi
 * /api/assets/{id}/transformer-surveys:
 *   post:
 *     tags: [Surveys]
 *     summary: Record a transformer field survey (insert-only — a new survey + reading row, nothing ever updated)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       201: { description: Survey recorded }
 *       400: { description: Validation failed }
 */
surveysRouter.post(
  "/api/assets/:id/transformer-surveys",
  asyncRoute(async (req, res) => {
    const asset_id = req.params.id;
    const parsed = transformerSurveySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json(validationErrorBody(parsed.error.flatten().fieldErrors));
      return;
    }
    const { surveyor, surveyed_at, notes, ...reading } = parsed.data;

    const survey = await queryOne<{ id: string }>(
      `insert into surveys (asset_id, surveyor, surveyed_at, notes)
       values ($1, $2, coalesce($3, now()), $4) returning id`,
      [asset_id, surveyor, surveyed_at ?? null, notes ?? null]
    );
    if (!survey) {
      res.status(404).json({ message: "Resource not found." });
      return;
    }

    const readingColumns = Object.keys(reading);
    if (readingColumns.length > 0) {
      const columns = ["survey_id", ...readingColumns];
      const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
      await query(
        `insert into transformer_readings (${columns.join(", ")}) values (${placeholders})`,
        [survey.id, ...readingColumns.map((c) => (reading as Record<string, unknown>)[c])]
      );
    } else {
      await query("insert into transformer_readings (survey_id) values ($1)", [survey.id]);
    }

    res.status(201).json({ data: { survey_id: survey.id }, message: "Survey recorded" });
  })
);

/**
 * @openapi
 * /api/assets/{id}/pd-surveys:
 *   post:
 *     tags: [Surveys]
 *     summary: Submit a whole PD patrol (multiple points) as one survey (insert-only)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       201: { description: Survey recorded }
 *       400: { description: Validation failed }
 */
surveysRouter.post(
  "/api/assets/:id/pd-surveys",
  asyncRoute(async (req, res) => {
    const asset_id = req.params.id;
    const parsed = pdSurveySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json(validationErrorBody(parsed.error.flatten().fieldErrors));
      return;
    }
    const { surveyor, surveyed_at, notes, points } = parsed.data;

    const survey = await queryOne<{ id: string }>(
      `insert into surveys (asset_id, surveyor, surveyed_at, notes)
       values ($1, $2, coalesce($3, now()), $4) returning id`,
      [asset_id, surveyor, surveyed_at ?? null, notes ?? null]
    );
    if (!survey) {
      res.status(404).json({ message: "Resource not found." });
      return;
    }

    for (const p of points) {
      const fields = { survey_id: survey.id, ...p } as Record<string, unknown>;
      const columns = Object.keys(fields);
      const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
      await query(`insert into pd_readings (${columns.join(", ")}) values (${placeholders})`, columns.map((c) => fields[c]));
    }

    res.status(201).json({
      data: { survey_id: survey.id, points_recorded: points.length },
      message: "Survey recorded",
    });
  })
);
