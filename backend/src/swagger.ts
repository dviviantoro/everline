import swaggerJsdoc from "swagger-jsdoc";
import path from "path";

export const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: "3.0.3",
    info: {
      title: "EverLine API",
      version: "0.1.0",
      description:
        "PLN 20kV asset-monitoring backend — self-hosted on a VPS, called by the EverLine frontend on Vercel. " +
        "Every write is insert-only (surveys, *_readings, telemetry are never updated/deleted). " +
        "All routes except /health and /docs* require an `X-API-Key` header.",
    },
    components: {
      securitySchemes: {
        ApiKeyAuth: { type: "apiKey", in: "header", name: "X-API-Key" },
      },
    },
    security: [{ ApiKeyAuth: [] }],
  },
  // globbed relative to process.cwd() at runtime (ts-node/dist both run from backend/)
  apis: [path.join(__dirname, "routes/*.{ts,js}")],
});
