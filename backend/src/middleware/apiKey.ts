import type { NextFunction, Request, Response } from "express";

const API_KEY = process.env.API_KEY;
if (!API_KEY) {
  throw new Error("Missing API_KEY — set it in backend/.env");
}

/**
 * Minimal safeguard, not real auth: rejects any request missing the shared
 * X-API-Key header. This project has never had real auth (POC, dummy data
 * only) — this just stops randos who don't have the key from writing data
 * now that the API is a directly-exposed public endpoint instead of sitting
 * behind Supabase's infrastructure. /health and /docs* stay open so the API
 * is at least inspectable without the key in hand.
 */
export function requireApiKey(req: Request, res: Response, next: NextFunction) {
  if (req.path === "/health" || req.path.startsWith("/docs")) return next();

  const provided = req.header("X-API-Key");
  if (provided !== API_KEY) {
    res.status(401).json({ message: "Missing or invalid X-API-Key header." });
    return;
  }
  next();
}
