import { query } from "../db";
import type { Pole } from "../types";

/** Every pole — a standalone network node, not scoped to any one line. */
export async function getAllPoles(): Promise<Pole[]> {
  return query<Pole>("select * from poles order by created_at asc");
}
