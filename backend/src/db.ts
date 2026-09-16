import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("Missing DATABASE_URL — set it in backend/.env");
}

// Single shared pool. No RLS/anon-key concept here — the API layer itself
// (the Express app + its API-key middleware) is the only access boundary,
// since this connects with a real Postgres role, not Supabase's anon key.
export const pool = new Pool({ connectionString });

export async function query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]> {
  const result = await pool.query(text, params);
  return result.rows as T[];
}

export async function queryOne<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}
