import express from "express";
import cors from "cors";
import swaggerUi from "swagger-ui-express";
import { swaggerSpec } from "./swagger";
import { requireApiKey } from "./middleware/apiKey";
import { assetsRouter } from "./routes/assets";
import { surveysRouter } from "./routes/surveys";
import { telemetryRouter } from "./routes/telemetry";
import { polesRouter } from "./routes/poles";
import { measurementPointsRouter } from "./routes/measurementPoints";
import { importsRouter } from "./routes/imports";
import { uploadsRouter } from "./routes/uploads";

const allowedOrigins = (process.env.CORS_ORIGIN ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

export const app = express();

app.use(
  cors({
    origin(origin, callback) {
      // No Origin header (curl, server-to-server, same-machine health checks) — allow.
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error(`Origin ${origin} is not allowed by CORS_ORIGIN`));
    },
  })
);
app.use(express.json({ limit: "2mb" }));

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.get("/docs.json", (_req, res) => res.json(swaggerSpec));

app.use(requireApiKey);

app.use(assetsRouter);
app.use(surveysRouter);
app.use(telemetryRouter);
app.use(polesRouter);
app.use(measurementPointsRouter);
app.use(importsRouter);
app.use(uploadsRouter);

// Matches every Next.js route's `{message}`/`{message, errors}` envelope —
// asyncRoute() already turns thrown errors into this shape per-route; this
// is the final fallback for anything Express itself throws (bad JSON body,
// multer errors, etc.) before it ever reaches a route handler.
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = err instanceof Error ? err.message : "Internal server error.";
  res.status(500).json({ message });
});
