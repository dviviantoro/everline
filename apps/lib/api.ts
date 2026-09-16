// Every API call goes to the self-hosted backend (see /backend at the repo
// root) instead of same-origin Next.js route handlers — this app has no
// server-side DB access at all anymore, only this fetch client.

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL;
const API_KEY = process.env.NEXT_PUBLIC_API_KEY;

if (!API_BASE_URL || !API_KEY) {
  throw new Error(
    "Missing NEXT_PUBLIC_API_BASE_URL or NEXT_PUBLIC_API_KEY — set them in apps/.env.local (see apps/README.md)"
  );
}

/**
 * Thin wrapper around fetch() that points at the external backend and
 * attaches the shared X-API-Key header. Adds a JSON Content-Type
 * automatically unless the body is FormData (file uploads), which needs
 * the browser to set its own multipart boundary.
 */
export function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const isFormData = typeof FormData !== "undefined" && init.body instanceof FormData;
  return fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
      "X-API-Key": API_KEY!,
      ...init.headers,
    },
  });
}
