import type { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * Wraps an async Express handler so a thrown/rejected error becomes a
 * `{message}` 500 response instead of an unhandled rejection — mirrors the
 * try/catch-per-route pattern the original Next.js route handlers used.
 */
export function asyncRoute(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<void>
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch((err: unknown) => {
      res.status(500).json({ message: err instanceof Error ? err.message : "Internal server error." });
    });
  };
}

// Zod's .flatten().fieldErrors shape, reused for every validation failure —
// same {message, errors} envelope every route in this API returns on 400.
// Object-rooted schemas flatten to a string-keyed record; array-rooted ones
// (the CSV import schemas) flatten to an index-keyed array — both are valid.
export function validationErrorBody(fieldErrors: Record<string, string[] | undefined> | (string[] | undefined)[]) {
  return { message: "Validation failed", errors: fieldErrors };
}
