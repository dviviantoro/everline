# LAPORAN TASK MOBILE

Tanggal: 2026-10-21
Task: TASK-004 (part 2) - Phase 0 self-test on a real phone
Repo: everline (single repository, project root)
Branch: docs/task-004-phone-selftest (stacked on feat/task-010-cantol-rename)
Commit: the commit that adds this report (see commit-logs/2026-10-21.md)

1) Deskripsi Perubahan

Records the first run of the Phase 0 self-test inside a real Android WebView. The APK was built from `feat/task-010-cantol-rename` at `626ab97` and sideloaded by the user; the user sent a screenshot of the result. Documentation only: no code changed.

2) Tujuan dan Manfaat

- Close the first half of the remaining TASK-004 work ("install the APK on a phone and read the self-test").
- Replace "not yet run on a phone" in the living docs with what was actually observed, and say what was not.

3) Daftar File yang Diubah

- dev-docs/CHANGELOG.md, dev-docs/ai/TASKS.md, dev-docs/ai/CURRENT_STATE.md, dev-docs/ai/START_HERE.md, dev-docs/ai/FINAL_SYSTEM_HANDOVER.md, dev-docs/architecture/mobile-app.md
- reports/task/mobile/2026-10-21-task-004-phone-selftest.md (this file)
- dev-docs/ai/COMMIT_LOG.md and commit-logs/2026-10-21.md (log entry)

4) Snapshot (Before -> After)

4.1 What the docs said about the phone

Before: `Not yet run on a phone.` (CURRENT_STATE, `mobile-app.md`, handover), `Nothing has run on a phone` (handover known issues).
After: `Self-test passed on one phone on 2026-10-21 (Samsung SM-A127F, Android 13, WebView Chrome 155); hotspot and Cantol-reachability spike not done.`

4.2 Observed result (from the screenshot)

```
Phone         Samsung SM-A127F, Android 13 (build TP1A.220624.014)
WebView       Chrome 155.0.8059.43 ("wv" in the user agent)
Origin        https://localhost
Self-test     PASS  cantol-wasm 0.1.0 (protocol v1)
              9 decode vectors: "11 chunkings match the committed report" each
              classify/cases: 10 magnitudes classified as committed
Digest        f7f47846  (equal to the Node run)
Throughput    0.839 ms per 64 KiB, 74 MiB/s, "within budget" (budget 2 ms)
WASM          26849 bytes, served as application/wasm; total 113 ms
Capabilities  webAssembly true, sharedArrayBuffer false, crossOriginIsolated false,
              cores 8, secureContext true, cssColorMix true, cssAtProperty true,
              cssCascadeLayers true
```

For comparison: 0.32 ms per 64 KiB in headless Chromium 153 on the Mac (2026-10-18). The phone is about 2.6 times slower and uses 42 percent of the budget.

5) Verifikasi UAT (User Acceptance Test)

| # | Tes | Hasil | Detail |
|---|-----|-------|--------|
| 1 | Self-test in an Android WebView on a phone | PASS | See 4.2. All 9 decode vectors and the classify cases pass. |
| 2 | Digest equals the Node run | PASS | `f7f47846` on the phone; `f7f47846` in Vitest on 2026-10-21 and in the 2026-10-18 CHANGELOG. |
| 3 | `.wasm` served with the right MIME type | PASS | The screen reports `application/wasm`. |
| 4 | Decoder speed within the plan's budget | PASS | 0.839 ms against 2 ms per 64 KiB. One mid-range phone. |
| 5 | The installed build is the renamed one | PASS | The screen text reads "the same way the app will decode Cantol frames" (the 2026-10-18 build said Red Pitaya). |
| 6 | The Web Worker rows and everything below `cssCascadeLayers` | NOT SEEN | The screenshot ends inside the "Main thread" card. The Worker's own capability rows, if any, were not checked. |
| 7 | Other phones, older Android or WebView versions | NOT RUN | One device only. ADR-002 names Chrome 111 (Tailwind 4) as the floor; this phone is on 155. |
| 8 | Hotspot and Cantol-reachability spike on 2 to 3 phones | NOT RUN | Still open under TASK-004. |
| 9 | `https://localhost` added to the VPS `CORS_ORIGIN` | NOT RUN | The phone confirms that is the origin string the app sends. The VPS change is the user's action. |
| 10 | A new survey never mutates an old one (standing UAT) | n/a | No upload path exists yet. |
