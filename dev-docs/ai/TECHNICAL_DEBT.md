# TECHNICAL_DEBT

> Living documentation — see `ai-rules/dev-docs-ai-templates/TECHNICAL_DEBT-template.md` for the template this was generated from. This is an inventory to stay aware of, not a to-do list to clear unprompted.

---

## Priority Debt List

| Priority | Repo | Debt | Evidence | Suggested Direction |
|----------|------|------|----------|---------------------|
| P2 | apps | API route handlers call Supabase directly — no Controller → Service → Repository split | `app/api/**/route.ts` | Acceptable at POC scale per `planning/architecture.md` §2 ("kept deliberately simple"). If this grows past POC, extract a service layer per `ai-rules/coding-standards/04-separation-of-concerns.md`. |
| P2 | apps | Survey + reading insert is two sequential, non-transactional writes | `app/api/assets/[id]/transformer-surveys/route.ts`, `.../pd-surveys/route.ts` | A reading/points insert failure leaves an orphaned `surveys` row with no reading. Acceptable — a survey without a reading is still a valid partial record per `planning/PROJECT_BRIEF.md` §7 — but a Postgres RPC could make this atomic if it ever becomes a problem in practice. |
| P3 | apps | No automated test suite | No test runner in `package.json`; verification this session was manual + ad hoc Playwright scripts (not committed) | Add Vitest coverage for `lib/` (especially `worstSeverity`, the severity/condition rollup) and Playwright coverage for the 5 core UI flows before this leaves POC stage. |
| P3 | apps | `AddAssetForm` doesn't require ≥1 route point for a line | `components/forms/AddAssetForm.tsx`, `lib/validation.ts` | Mirrors the ≥1-point requirement already enforced (both client and server) for PD surveys, but not for asset registration. Low risk — Add Asset is P1 and effectively admin-only in this POC. |
| P3 | apps | `leaflet` is patched via `patch-package` (`patches/leaflet+1.9.4.patch`) | Upstream fix (Leaflet/Leaflet#8749/#9527) exists in source but was never released to npm — 1.9.4 is still `latest` as of 2026-09-05 | Check `npm view leaflet dist-tags` periodically; drop the patch and this entry once a release newer than 1.9.4 ships with the fix. |
| P2 | apps + backend + mobile | The provisional PD severity zones (warning from 20, critical from 40 dBmV) exist in three places | `apps/lib/severity.ts` (`PD_ZONES`), `backend/scripts/seed.ts`, `mobile/rust/cantol-dsp/src/severity.rs` (`DBMV_ZONES`) | Change all three together until the API exposes the zones. A golden vector (`mobile/rust/vectors/classify/cases.txt`) pins the Rust boundaries to the dashboard's. The numbers are an assumption: PLN's real thresholds are undefined (`planning/PROJECT_BRIEF.md` §16). |
| P3 | mobile | 3 moderate `npm audit` advisories, dev tooling only: `@capacitor/cli` -> `xcode` -> `uuid` below 11.1.1 (missing buffer bounds check in v3/v5/v6 when a caller-provided buffer is used) | `npm audit` in `mobile/`; `npm audit --omit=dev` reports 0 | `npm audit fix --force` would downgrade `@capacitor/cli` to 8.4.3 (a breaking change), and the path only touches iOS project tooling. Do not force; re-check on each Capacitor release. |
| P3 | mobile | The Cantol link protocol is a placeholder, and a corrupted but plausible `len` field stalls the decoder until up to 64 KiB more bytes arrive (then the CRC fails and it resyncs) | `mobile/rust/cantol-proto/src/frame.rs` | When the protocol is agreed (ADR-005), add a header checksum or lower `MAX_PAYLOAD`. No data is lost meanwhile, only delayed. |
| P3 | mobile | Capacitor's template example tests use the package `com.getcapacitor.myapp`, not the app id | `mobile/android/app/src/test`, `.../androidTest` | Harmless. Rename or delete when real Android tests are added. |
| P2 | backend | No security headers, no rate limiting, no upload MIME allow-list (see KNOWN_ISSUES 5) | `backend/src/app.ts`, `routes/uploads.ts`, `storage.ts` | TASK-013. |
| P3 | repo | No root `.gitignore`; each code folder has its own, so a secret file created at the project root is not ignored | `ls -a` at the root | Add a root `.gitignore` covering `.env*`, `*.local.json`, keystores and OS files. Needs a normal small batch. |
| P3 | mobile | The mobile design tokens are copied from `apps/app/globals.css` (no shared package, per ADR-002) | `mobile/src/index.css` once it exists, `mobile-design-system.md` | When the web palette changes, update both and the table in `mobile-design-system.md`. |
| P3 | mobile | Control borders (`--border2`) are about 1.7:1 (dark) and 1.9:1 (light) against the page, under the 3:1 guideline for non-text boundaries; inputs have a filled background that carries most of the affordance | `mobile-design-system.md` section 2 | Check in sunlight on a phone during TASK-005; raise the token if needed. |
| P3 | mobile | The Phase 0 self-test screen overflows by up to 12 px at 360 px wide with a 130 percent font ("11 chunkings match the committed report" runs past the edge). Left as it is so the normal build does not change; found by `npm run verify:demo` | `mobile/src/selftest/SelfTestScreen.tsx` | Let the result rows wrap when the self-test is next touched. |
| P3 | mobile | The layout was verified in a desktop browser at 390x844 and 360x640, with the larger font emulated by the root font size, not on phones or with Android's own font scale | `mobile/scripts/verify-demo-web.mjs` | Repeat on two or three real phones, including the system font scale. |
| P3 | mobile | The tracking thresholds and the auto-mark dwell (1.5, 3, 6 and 3 dB; 3 and 5 samples; a 5 m band; seven still fixes within 3 m) are assumptions with golden vectors, but nobody has walked a real line with them | `mobile/rust/cantol-dsp/src/trend.rs` | Field test (TASK-011); change a rule and its vector in the same commit. |
| P3 | mobile | Two spec lines disagree about the word "pole". `mobile-tracking-mode.md` (stations table, setup screen) names the end stations "Pole A" and "Pole B", sent as `point_label`; `mobile-ui-spec.md` section 8 says no string in the mobile UI may contain "pole". The demo follows the tracking-mode doc: Tracking shows "Pole A", "Pole B", "LEVEL NOW · POLE B" and the setup hint "at each pole"; the asset picker and direction chips show pole labels from the data | `mobile/src/core/payload.ts` (`STATION_LABELS`), `mobile/src/screens/TrackingScreen.tsx`, `TrackSetupScreen.tsx` | The user decides: relax the `mobile-ui-spec.md` line for the tracking stations, or show "Start" and "End" on screen and keep "Pole A" and "Pole B" only in the payload. Found while looking at the screenshots in the second TASK-015 session; not decided there. |
| P3 | repo | Tracking walks are indistinguishable from spot surveys on the dashboard (only free text in `notes`) | `mobile-tracking-mode.md` section 5 | A `mode` field needs a schema change and explicit approval; decide only if the product wants to filter by it. |

---

## Risky Areas to Modify

| Area | Repo | Risk | Reason |
|------|------|------|--------|
| `lib/data/assets.ts`, `app/api/assets/[id]/route.ts` | apps | MEDIUM | Both rely on the `transformer_readings`-is-a-single-object PostgREST quirk (documented in-code). A query rewrite that re-embeds `transformer_readings` without accounting for that shape will silently reintroduce the "every transformer shows no data yet" bug this session found and fixed. |
| `app/api/assets/[id]/transformer-surveys/route.ts`, `.../pd-surveys/route.ts` | apps | MEDIUM | These are the only write paths against insert-only tables. Any change here must preserve the no-UPDATE/no-DELETE guarantee (`planning/architecture.md` §8) — this is the project's one non-negotiable rule. |
| `components/map/MapView.tsx` | apps | LOW | Render order matters — `Polyline`s must stay before `AssetMarker`s in JSX, or overlapping lines will intercept clicks meant for nearby transformer markers again. |
| `mobile/rust/vectors/**` | mobile | MEDIUM | The golden vectors are the cross-target contract (native, Node, Worker, WebView). Regenerate only deliberately with `UPDATE_VECTORS=1 cargo test -p cantol-proto --test vectors` and review the diff: a decoder change that alters a report is a protocol change and must bump the protocol version. |
| `package.json` (`leaflet` version) | apps | LOW | If `leaflet` is ever bumped, `patch-package` will fail loudly at `npm install` if the patch no longer applies cleanly (a safe failure, not a silent one) — check whether the new version still needs the patch before just re-generating it. |

---

## Debt Acceptance Notes

- Assumption based on repository analysis: given `planning/PROJECT_BRIEF.md` §8 ("keep it boring") and the explicit POC scope, all debt listed above is accepted as-is for now. Revisit before any phase that introduces real (non-dummy) PLN data.
