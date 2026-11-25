# Sistem Penyelarasan Jadual & Borang PK01 (JKM)

Aplikasi web untuk penyelarasan jadual kuliah dan penjanaan Borang PK01, Jabatan Kejuruteraan Mekanikal, Politeknik Kuching Sarawak.

- Live: <https://jkm-penyelarasan-jadual.wilsonintai76.workers.dev>
- Data jadual induk dibaca terus daripada Cloudflare KV (`/api/jadual`), dengan sandaran Google Sheets CSV atau `/data/jadual.json`.

## Run Locally

**Prerequisites:** Node.js

1. `npm install`
2. Optional: copy [.env.example](.env.example) to `.env.local` and set `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` to enable PDF extraction locally (the deployed Worker uses its `AI` binding instead)
3. `npm run dev` — Express server in [server.ts](server.ts)

## Deploy to Cloudflare

The app is deployed as a **Worker with static assets** ([wrangler.jsonc](wrangler.jsonc)):

- `dist/` (built by `vite build`) is served through the `ASSETS` binding with SPA fallback.
- `/api/*` is handled first by [worker/index.js](worker/index.js), which dispatches to the request handlers in [functions/api/](functions/api) — the same handler code the local Express server uses.
- R2, KV, and Workers AI bindings are declared in [wrangler.jsonc](wrangler.jsonc).

### 1. Authenticate

```bash
npx wrangler login
```

### 2. Provision storage

```bash
# KV namespace for the live timetable
npx wrangler kv namespace create jkm-timetable-kv

# R2 bucket for the custom logo binary
npx wrangler r2 bucket create jkm-timetable-r2
```

Seed or back up the live timetable JSON:

```bash
npx wrangler kv key put --namespace-id <KV_NAMESPACE_ID> jadual_induk_jkm --path sample/jadual_induk_jkm.json --remote
npx wrangler kv key get --namespace-id <KV_NAMESPACE_ID> jadual_induk_jkm --remote > backup.json
```

### 3. Deploy

```bash
npm run deploy        # vite build + wrangler deploy (stamps the app version)
npm run cf:dev        # build + local Worker runtime (http://localhost:8787)
```

Source precedence in [externalTimetableLoader.ts](src/utils/externalTimetableLoader.ts): **1) Cloudflare KV** → 2) Google Sheets CSV (if configured) → 3) `/api/jadual-fallback`.

`/api/jadual-fallback` serves an R2 mirror (`fallback/jadual_induk_jkm.json`) that is rewritten on every
publish and restore, so the fallback tracks the latest upload instead of a build-time snapshot. If the
mirror is missing it serves the bundled `/data/jadual.json`.

## Master timetable data quality

Course names in the master timetable are **derived from the curriculum, never from the uploaded file**:
`POST /api/jadual` rewrites `Course_Name` (and a missing `Credit`) per course code using the programme
curriculum (KV override, then `/assets/curriculum/<programme>.json`) before storing, and the PDF/JSON
extractor resolves names in the order curriculum -> text read from the document -> `course_catalog.json`.
The publish response reports `namesCorrected` / `unknownCourseCodes`, and the upload review panel blocks a
publish with structural errors (missing cohort/course, invalid day or time, duplicate or overlapping slots)
while warning about implausible loads and names that disagree with the curriculum.

Courses of one section that occupy the exact same slot are **alternatives** (the `MPU24XX1`
co-curriculum block: Sukan 2 / Kelab-Persatuan 2 / Unit Beruniform 2). The planner groups them as
"Pilih satu", keeps only the chosen option in Bahagian A, and the choice drives credits, the timetable grid
and Borang PK01; the other options stay visible as "Pilihan Lain (Tidak Diambil)". The same-slot detection
is code-agnostic, so a future elective block needs no change.

## Curriculum prerequisites (per programme)

Prerequisites are curriculum rules, not schedule data, so each programme has its own document and they
never live in the master timetable (which is replaced on every upload):

- [public/assets/curriculum/dkm.json](public/assets/curriculum/dkm.json) — canonical, git-versioned rules
  extracted from *PROGRAMME INFORMATION DKM v3* (§11, pages 7–9): course name, semesters, credits and
  normalized `prerequisites[]` per course code. `dad.json`, `dpu.json`, `dtp.json` are added the same way
  once those programme structures are available.
- `GET /api/curriculum` returns a status summary for DKM/DAD/DPU/DTP; `GET /api/curriculum?programme=DKM`
  serves the KV override `curriculum_DKM` when present, otherwise the bundled asset.
- `POST /api/curriculum` (`{ programme, curriculum, overwrite? }`, admin PIN) publishes an override without
  redeploying. Publishing over an existing KV document is refused with `409 ALREADY_EXISTS` unless
  `overwrite: true` is sent, and the UI always asks for confirmation first (showing the existing version,
  course/prereq counts and timestamp next to the incoming ones). `DELETE /api/curriculum?programme=DKM`
  drops the override (also confirmed in the UI) so the bundled asset is served again.
- Upload/download is done in the app: **Tetapan → Kurikulum & Prasyarat** (per-programme JSON, validated
  before publishing). A programme with no document simply contributes no rules.

Registration rule enforced by [prerequisiteEngine.ts](src/utils/prerequisiteEngine.ts): **rules are keyed by
course code and merged across every programme document**, because codes are shared between programmes (a
DAD student taking `DBM20173` is still bound by the `DBM10163` prerequisite). When a student repeats a
course (C1/C2/D), every course that requires it — directly or through the prerequisite chain — is
automatically dropped from the default (Bahagian A) timetable and reported to the advisor. For example,
repeating `DBM10163` drops `DBM20173` (and `DBM30183` when it is in the cohort's timetable). Dropped codes
are derived on every run, never persisted, so removing the repeat restores the course.

## Printable documents (Borang PK01 & Jadual Waktu Kuliah)

Both printouts reproduce the official JKM templates supplied in `sample/` (`01_BORANG PK01 Sesi II
2026_2027.pdf`, `JADUAL WAKTU KULIAH KOSONG.pdf`):

- [BorangPK01View.tsx](src/components/BorangPK01View.tsx) — A4 **portrait**: page frame, Politeknik logo
  centred at the top (53 × 20 mm), `Borang PK01` tag box at the top right, underlined/boxed student fields,
  tables (A) and (B) with the shaded `JUMLAH JAM KREDIT` row, the right-aligned `JUMLAH JAM KREDIT
  KESELURUHAN` box, signature lines, the official **NOTA** wording and the centred `Status : D / MK1 / MK2`
  legend.
- [JadualKuliahView.tsx](src/components/JadualKuliahView.tsx) — A4 **landscape**: frame, centred logo
  (56 × 20 mm), underlined title, `JABATAN`/`SESI` and `Nama`/`Program`/`Penasihat Akademik` lines, and the
  9-column `8.00 – 9.00am … 4.00 – 5.00pm` grid.
- Paper orientation comes from named pages in [index.css](src/index.css) (`@page pk01sheet`,
  `@page jadualsheet`) plus the same rules in the popup path of
  [printHelper.ts](src/utils/printHelper.ts), so `window.print()` and the Google Sites iframe fallback
  produce identical paper. The credit-load rule follows the official form: 12–20 jam kredit.
- The logo can be pinned to an exact print footprint with `PKSLogo boxClassName="w-[..] h-[..]"`; the image
  comes from `/api/logo` (R2), then the local override, then `/assets/logo_pks.svg`.

## Versioning

The version lives in [package.json](./package.json) `version` — a single source of truth.

- `vite.config.ts` injects it into the client at build time (`__APP_VERSION__`, `__APP_BUILT_AT__`), surfaced as a badge in the app footer and the Tetapan modal.
- `scripts/deploy.mjs` passes it to the Worker as the `APP_VERSION` / `APP_BUILT_AT` runtime vars, so `GET /api/version` reports exactly what is deployed.

Check the live version:

```bash
curl https://jkm-penyelarasan-jadual.wilsonintai76.workers.dev/api/version
```

Release checklist:

1. Bump `version` in [package.json](./package.json) (`npm version patch|minor|major --no-git-tag-version`).
2. Add an entry to [CHANGELOG.md](./CHANGELOG.md).
3. `npm run deploy`, then confirm `/api/version` matches.
4. Commit and tag (`git tag v<version>`) and push.

### Bindings

| Binding | Type | Resource | Used by |
| --- | --- | --- | --- |
| `JADUAL_KV` | KV namespace | `jkm-timetable-kv` | `/api/jadual`, `/api/jadual-history`, `/api/settings`, `/api/admin-pin`, `/api/verify-pin`, `/api/logo`, `/api/extract-pdf`, `/api/curriculum` |
| `JADUAL_R2` | R2 bucket | `jkm-timetable-r2` | `/api/logo` (custom logo upload) |
| `AI` | Workers AI | — | `/api/extract-pdf` |
| `ASSETS` | Static assets | `dist/` | SPA |

`/api/logo` also accepts the legacy binding names `R2_BUCKET`, `LOGO_BUCKET`, and `ASSETS_BUCKET`.

Runtime vars `APP_VERSION` and `APP_BUILT_AT` are injected by `npm run deploy` (not by `wrangler deploy` directly) and exposed by `GET /api/version`.

### Timetable backups (R2)

Every publish snapshots the previous master timetable to R2 before replacing it
(`backups/jadual_induk_jkm-<timestamp>.json`, newest 20 kept).

```bash
# list snapshots
curl -H "X-Admin-Pin: <PIN>" https://jkm-penyelarasan-jadual.wilsonintai76.workers.dev/api/jadual-backups

# restore one (also snapshots the current master first, so it is reversible)
curl -X POST -H "X-Admin-Pin: <PIN>" -H "Content-Type: application/json" \
  -d '{"backupKey":"backups/jadual_induk_jkm-2026-11-18T00-54-40-480Z.json"}' \
  https://jkm-penyelarasan-jadual.wilsonintai76.workers.dev/api/jadual-backups
```

### Secrets

Set these with `npx wrangler secret put <NAME>` (never commit them):

| Secret | Purpose |
| --- | --- |
| `ADMIN_PIN` / `ADMIN_PASSCODE` | Admin PIN for upload/settings endpoints. When unset, the PIN stored in KV (`admin_pin_config`) is used, falling back to the built-in default `2026`. Set this in production. |

## Security notes

- `cf_timetable_config*.json`, `cloudflare_config*.json`, `.dev.vars`, and `local-secrets/` are git-ignored and must never be committed or placed under `public/` (Vite copies `public/` into the deployed bundle).
- Credentials previously stored in a downloaded AI Studio config file were rejected by GitHub push protection and have been removed from the repository; rotate any key that was in that file.
