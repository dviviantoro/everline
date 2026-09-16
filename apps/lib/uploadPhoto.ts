"use client";

import { apiFetch } from "@/lib/api";

/**
 * Uploads a PD measurement photo to the backend, which forwards it to its
 * MinIO bucket and returns the public URL. Storage credentials never reach
 * the browser this way (unlike the old Supabase Storage setup, where the
 * anon key itself had storage-write access from the client bundle).
 */
export async function uploadPdPhoto(file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);

  const res = await apiFetch("/api/uploads", { method: "POST", body: form });
  const payload = await res.json();
  if (!res.ok) throw new Error(payload?.message ?? "Failed to upload photo.");
  return payload.data.url as string;
}
