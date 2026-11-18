# Changelog

All notable changes to the Sistem Penyelarasan Jadual (JKM) web app are recorded here.
The version is defined in [package.json](./package.json) and is surfaced in the app
footer, the Tetapan modal, and `GET /api/version` on the deployed Worker.

## [1.2.0] - 2026-11-18

### Added

- `GET /api/jadual-fallback`: serves the timetable from an R2 mirror that is rewritten on every
  publish and restore, so the fallback path always reflects the latest upload. Falls back to the
  bundled `/data/jadual.json` snapshot when the mirror has not been seeded yet.

### Changed

- The client fallback source is now `/api/jadual-fallback` (previously the static `/data/jadual.json`),
  declared in `public/timetable-source.json` and `VITE_TIMETABLE_JSON_URL`.

## [1.1.0] - 2026-11-18

### Added

- Version tracking: badge in the app footer and Tetapan modal, and `GET /api/version` on the Worker.
  `npm run deploy` stamps `APP_VERSION` / `APP_BUILT_AT` from `package.json`.
- Automatic R2 snapshots of the master timetable before every publish (`backups/jadual_induk_jkm-<timestamp>.json`),
  keeping the newest 20.
- `GET /api/jadual-backups` lists snapshots and `POST /api/jadual-backups` restores one into KV
  (both require the admin PIN; a restore snapshots the current master first, so it is reversible).

### Changed

- Tailwind utilities normalised to canonical v4 classes (`bg-linear-to-*`, `max-w-50`, `min-h-35`).

## [1.0.0] - 2026-11-18

First release, deployed to Cloudflare Workers.

### Added

- Cloudflare Worker deployment with static assets (`wrangler.jsonc`, `worker/index.js`) reusing the `functions/api` handlers.
- Cloudflare KV binding `JADUAL_KV` for the live timetable, history, settings and admin PIN.
- Cloudflare R2 binding `JADUAL_R2` for the custom institution logo.
- Workers AI binding `AI` for PDF timetable extraction.
- `npm run deploy` / `npm run cf:dev` scripts and deployment documentation.

### Changed

- PDF extraction now runs exclusively on Cloudflare Workers AI; the Gemini API path and `@google/genai` dependency were removed.
- Local `server.ts` extraction uses the Workers AI REST API (`CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN`).

### Removed

- Legacy NiceGUI desktop uploader (`ppkj_timetable_uploader_en.py`), its embedded TypeScript copy, and the AI Studio asset snapshots under `public/assets/aistudio/`.
- Stale `bun.lock`; `package-lock.json` is the single lockfile.
