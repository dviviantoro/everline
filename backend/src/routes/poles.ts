import { Router } from "express";
import { query, queryOne } from "../db";
import { getAllPoles } from "../data/poles";
import { createPoleSchema } from "../validation";
import { asyncRoute, validationErrorBody } from "../middleware/errors";
import type { ConnectedLine, Pole, PoleDetail } from "../types";

export const polesRouter = Router();

/**
 * @openapi
 * /api/poles:
 *   get:
 *     tags: [Poles]
 *     summary: Every pole (standalone network node), for the map's poles layer
 *     responses:
 *       200: { description: OK }
 */
polesRouter.get(
  "/api/poles",
  asyncRoute(async (_req, res) => {
    const data = await getAllPoles();
    res.json({ data });
  })
);

/**
 * @openapi
 * /api/poles:
 *   post:
 *     tags: [Poles]
 *     summary: Register a single pole manually
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [latitude, longitude]
 *             properties:
 *               label: { type: string }
 *               latitude: { type: number }
 *               longitude: { type: number }
 *     responses:
 *       201: { description: Created }
 *       400: { description: Validation failed }
 */
polesRouter.post(
  "/api/poles",
  asyncRoute(async (req, res) => {
    const parsed = createPoleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json(validationErrorBody(parsed.error.flatten().fieldErrors));
      return;
    }
    const { label, latitude, longitude } = parsed.data;
    const pole = await queryOne<Pole>(
      "insert into poles (label, latitude, longitude) values ($1, $2, $3) returning *",
      [label ?? null, latitude, longitude]
    );
    res.status(201).json({ data: pole, message: "Created successfully" });
  })
);

/**
 * @openapi
 * /api/poles/{id}:
 *   get:
 *     tags: [Poles]
 *     summary: A pole's identity/location info, plus every line segment using it as an endpoint
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: OK }
 *       404: { description: Not found }
 */
polesRouter.get(
  "/api/poles/:id",
  asyncRoute(async (req, res) => {
    const { id } = req.params;
    const pole = await queryOne<Pole>("select * from poles where id = $1", [id]);
    if (!pole) {
      res.status(404).json({ message: "Resource not found." });
      return;
    }
    const lines = await query<ConnectedLine>(
      "select id, code, name from assets where pole_a_id = $1 or pole_b_id = $1",
      [id]
    );
    const data: PoleDetail = { ...pole, connectedLines: lines };
    res.json({ data });
  })
);
