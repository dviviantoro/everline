# EverLine Backend

Self-hosted API + database + object storage for EverLine (PLN 20kV asset monitoring POC), designed to run on your own VPS via Docker Compose while the Next.js frontend stays on Vercel.

Replaces Supabase entirely: Postgres runs in a container you control, PD-measurement photo evidence goes to a self-hosted MinIO bucket instead of Supabase Storage, and every API route that used to be a Next.js route handler is now an Express route here.

## Stack

| Piece | What | Why |
|---|---|---|
| `api` | Express + TypeScript, raw `pg` (no ORM) | Mechanical port of the original Next.js route handlers — same paths, same request/response shapes |
| `postgres` | `postgres:16-alpine` | Schema auto-applied from `db/init.sql` on first boot (no more "paste into Supabase SQL Editor") |
| `minio` | `quay.io/minio/minio` (S3-compatible) | PD photo evidence uploads — credentials never reach the browser; the frontend uploads to `POST /api/uploads`, this backend talks to MinIO directly |
| `caddy` | `caddy:2-alpine` | Reverse proxy + **automatic HTTPS** (Let's Encrypt) — required because Vercel serves the frontend over HTTPS, so this API must be HTTPS too or browsers block it as mixed content |

Every route requires an `X-API-Key` header (except `/health` and `/docs*`) — a shared secret, not real auth (this POC has never had real auth; see `dev-docs/ai/CURRENT_STATE.md` at the project root). It just stops randos who don't have the key from writing data now that this is a directly-exposed public endpoint instead of sitting behind Supabase's infrastructure.

Interactive API docs (Swagger UI): `https://<your-domain>/docs`. Raw OpenAPI spec: `https://<your-domain>/docs.json`.

## Prerequisites on the VPS

- A domain (or subdomain, e.g. `api.yourdomain.com`) with a DNS **A record** pointing at the VPS's public IP — required before first boot, or Let's Encrypt certificate issuance will fail. **No domain yet?** See "Don't have a domain yet?" below — don't skip straight to plain HTTP, it won't work with a Vercel-hosted frontend (see why in the Stack table above).
- Ports **80** and **443** open (Caddy needs 80 for the ACME HTTP challenge, 443 to serve).
- Docker + Docker Compose installed. On a fresh Ubuntu 22.04/24.04 VPS:

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker
docker compose version   # confirm the compose plugin is present
```

## Install

```bash
git clone <this-repo-url> everline-backend
cd everline-backend

cp .env.example .env
# Edit .env: set POSTGRES_PASSWORD, MINIO_ROOT_PASSWORD/S3_SECRET_KEY, API_KEY
# (openssl rand -hex 32 for each secret), API_DOMAIN to your real domain,
# S3_PUBLIC_BASE_URL to https://<API_DOMAIN>/storage, and CORS_ORIGIN to
# your Vercel frontend's URL(s).

docker compose up -d --build
```

First boot: Postgres creates the schema from `db/init.sql` automatically, MinIO starts empty, and the `api` container creates its `pd-photos` bucket (public-read policy) on startup. Caddy requests a Let's Encrypt certificate for `API_DOMAIN` the first time it sees a request — this needs DNS already pointing at the VPS.

Seed dummy data (same demo dataset as the original Supabase seed — 8 transformers, 15 poles, 10 line segments):

```bash
docker compose exec api npm run seed
```

Safe to re-run — it clears its own previously-seeded rows first (matched by asset code) and re-inserts. It does **not** touch anything you've added by hand or through the app.

Verify:

```bash
curl https://api.yourdomain.com/health
# {"status":"ok"}
curl -H "X-API-Key: <your API_KEY>" https://api.yourdomain.com/api/assets
# {"data": [...]}
```

## Don't have a domain yet?

If you're only using the VPS's raw public IP for now, you have two options. **Plain HTTP is not one of them** — Vercel serves the frontend over HTTPS, and browsers block an HTTPS page from calling a plain-HTTP API as mixed content, so the API needs to be HTTPS regardless of whether you have a real domain.

### Option A — sslip.io (recommended)

[sslip.io](https://sslip.io) is a free public DNS service that resolves hostnames like `203-0-113-5.sslip.io` straight back to the IP address embedded in the name — no signup, no config, nothing to own. Caddy can request a **real, trusted Let's Encrypt certificate** for that hostname exactly as if it were your own domain, because it genuinely is a publicly-resolvable DNS name pointing at your VPS.

```bash
# In .env — replace with your VPS's actual public IP, dashes instead of dots:
API_DOMAIN=203-0-113-5.sslip.io
S3_PUBLIC_BASE_URL=https://203-0-113-5.sslip.io/storage
```

Nothing else changes — same `docker compose up -d --build`, same default `Caddyfile`, real trusted HTTPS, works for every visitor with no browser warnings. This is the whole fix; skip Option B unless you have a specific reason outbound ACME validation won't work for you (e.g. the VPS can't be reached on port 80 from the internet for the HTTP-01 challenge).

### Option B — self-signed (raw IP, no external hostname at all)

Uses Caddy's own internal CA instead of Let's Encrypt. Works anywhere, but the certificate isn't trusted by anyone's browser by default — each visitor (including you) has to manually click through a "connection is not private" warning once per browser, by visiting `https://<VPS_IP>` directly, before `fetch()` calls from the Vercel frontend to this API will succeed. **Not viable for real end users** — fine only for solo testing while you sort out a domain or sslip.io.

```bash
# In .env:
API_DOMAIN=203.0.113.5              # your VPS's public IP
S3_PUBLIC_BASE_URL=https://203.0.113.5/storage
CADDYFILE_PATH=./caddy/Caddyfile.no-domain
```

```bash
docker compose up -d --build
curl -k https://203.0.113.5/health   # -k: skip the self-signed cert check
```

Switching later to a real domain or sslip.io: update `API_DOMAIN`/`S3_PUBLIC_BASE_URL`, remove the `CADDYFILE_PATH` line (or comment it out) so Caddy falls back to the default domain-based `Caddyfile`, then `docker compose up -d --build`.

## Point the frontend at this backend

In the Vercel project's environment variables (or `apps/.env.local` for local frontend dev):

```
NEXT_PUBLIC_API_BASE_URL=https://api.yourdomain.com
NEXT_PUBLIC_API_KEY=<the same API_KEY value from .env>
```

See `apps/README.md` for the full frontend setup.

## Updating

```bash
git pull
docker compose up -d --build
```

Postgres/MinIO data persists in named Docker volumes (`postgres_data`, `minio_data`) — rebuilding the `api`/`caddy` images doesn't touch them.

## Backups

The only state that matters is the `postgres_data` and `minio_data` volumes.

```bash
# Postgres — a plain SQL dump, portable and easy to restore
docker compose exec -T postgres pg_dump -U everline everline > backup-$(date +%F).sql

# MinIO — copy the volume's contents (or use `mc mirror` for incremental backups)
docker run --rm -v everline-backend_minio_data:/data -v "$PWD":/backup alpine \
  tar czf /backup/minio-backup-$(date +%F).tar.gz -C /data .
```

Restore the SQL dump with `docker compose exec -T postgres psql -U everline everline < backup-file.sql` (only makes sense against an otherwise-empty database — this schema doesn't have upsert-safe restores built in, being a POC).

## Local development (without a VPS)

```bash
cp .env.example .env
# Set API_DOMAIN=localhost — Caddy auto-detects this and serves a
# self-signed certificate instead of attempting real Let's Encrypt issuance.
docker compose up -d --build
docker compose exec api npm run seed
curl -k https://localhost/health
```

`-k` is needed because `localhost`'s certificate is self-signed (Caddy's internal CA), not trusted by curl by default. A real browser hitting `https://localhost` will show a certificate warning too — click through it, or trust Caddy's local CA (`docker compose exec caddy caddy trust`, then restart your browser).

Running the API outside Docker for faster iteration: `npm install && npm run dev` (needs `DATABASE_URL`/`S3_*`/`API_KEY` pointed at services you're running some other way — e.g. `docker compose up postgres minio` and just run `api` on the host).

## Project structure

```
backend/
├── src/
│   ├── index.ts          # entrypoint — starts Express, ensures the MinIO bucket exists
│   ├── app.ts             # Express app: CORS, API-key middleware, route mounting, /docs
│   ├── db.ts               # pg Pool + query helpers
│   ├── storage.ts          # MinIO (S3-compatible) client — upload, bucket policy
│   ├── swagger.ts          # OpenAPI spec, built from @openapi JSDoc blocks in routes/*.ts
│   ├── types.ts, validation.ts, geo.ts, severity.ts   # ported from apps/lib/* — same shapes
│   ├── middleware/         # apiKey.ts, errors.ts (async-route wrapper + error envelope)
│   ├── data/                # port of apps/lib/data/*.ts — same function names, pg instead of supabase-js
│   └── routes/               # one file per resource group — assets, surveys, telemetry, poles,
│                              # measurementPoints, imports, uploads
├── db/init.sql              # full schema, auto-applied on first Postgres boot
├── scripts/seed.ts           # dummy data, port of the original apps/scripts/seed.ts
├── Dockerfile                 # multi-stage build → slim node:20-alpine runtime image
├── docker-compose.yml          # postgres + minio + api + caddy
└── caddy/
    ├── Caddyfile                # default: domain (or sslip.io) + automatic HTTPS + /storage/* → MinIO
    └── Caddyfile.no-domain       # fallback: self-signed, for a raw IP with no hostname at all
```

Every route keeps the exact same URL path, method, and `{data}`/`{message, errors}` response shape as the original Next.js route handlers — this was a mechanical port, not a redesign.
