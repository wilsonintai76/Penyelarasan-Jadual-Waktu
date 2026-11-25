# Changelog

All notable changes to the Sistem Penyelarasan Jadual (JKM) web app are recorded here.
The version is defined in [package.json](./package.json) and is surfaced in the app
footer, the Tetapan modal, and `GET /api/version` on the deployed Worker.

## [1.3.3] - 2026-11-25

### Changed

- Master timetable republished from the 508-slot programme extraction
  (`sample/jadual_waktu_program_jkm.json`): 421 -> 508 slots, 38 sections, 73 course codes. Added the
  Semester 2 co-curriculum block (`MPU24051` Sukan 2, `MPU24061` Kelab/Persatuan 2, `MPU24071`, `MPU24081`)
  and `DJF42062`; dropped `DJU50192`. The previous 421-slot master is kept in R2
  (`backups/jadual_induk_jkm-2026-11-25T04-02-40-000Z.json`) and referenced by the change log.
- Course names of the new master are resolved from the curriculum (365 rows), the previous master
  (127 rows) and the catalogue; `MPU24071`, `MPU24081` and `DJF42062` have no official name yet and are
  displayed as their code until the catalogue/curriculum is updated.

## [1.3.2] - 2026-11-25

### Fixed

- The upload validation added in 1.3.1 no longer treats legitimate timetable structures as errors:
  parallel workshop groups (same course and slot in several workshops with different venues and
  instructors) and co-curriculum / MPU alternatives sharing one slot (Sukan 2, Kelab 2, Unit Beruniform 2,
  Pengajian Islam vs Moral) are recognised, contact hours are counted per distinct time block instead of per
  row, and cross-course overlaps are reported as warnings rather than blocking the publish button.

## [1.3.1] - 2026-11-25

### Fixed

- Master timetable (jadual induk) course names: the extraction pipeline used
  [course_catalog.json](public/assets/course_catalog.json) **before** the name read from the uploaded
  document, and that catalogue still carried pre-v3 titles. Publishing therefore replaced correct names
  with stale ones (`DJJ30313` became "Mechanics of Machines" instead of "Engineering Mechanics",
  `DJJ30293` "Pneumatics & Hydraulics" instead of "Thermodynamics", ...). Names are now resolved in the
  order **curriculum -> name read from the document -> catalogue**.
- `POST /api/jadual` re-derives `Course_Name` (and a missing/invalid `Credit`) from the programme
  curriculum for every published slot, so a shifted name column can never reach `jadual_induk_jkm` again.
  The response reports `namesCorrected`, `creditsCorrected` and `unknownCourseCodes`.
- [public/assets/course_catalog.json](public/assets/course_catalog.json) refreshed against DKM v3
  (19 names corrected, 31 codes added).
- The bundled offline snapshot [public/data/jadual.json](public/data/jadual.json) was an old 290-slot
  extraction with wrong cohorts, rooms and course codes; it now mirrors the published 421-slot master.
  The live `jadual_induk_jkm` was corrected in place (same 421 slots, 200 course names realigned with the
  curriculum, previous copy kept in R2 `backups/`).

### Added

- Upload review now validates the staged timetable before publishing: structural errors (missing
  cohort/course, invalid day or time, duplicate or overlapping slots) disable the publish button, and
  warnings flag implausible cohort loads, course codes missing from the curriculum, and names that
  disagree with it.

## [1.3.0] - 2026-11-25

### Added

- Curriculum prerequisites per programme: [public/assets/curriculum/dkm.json](public/assets/curriculum/dkm.json)
  holds the 62 DKM courses with normalized prerequisite chains, and `GET/POST/DELETE /api/curriculum`
  serves or overrides each programme's document through the `curriculum_<PROGRAMME>` KV key.
- **Tetapan → Kurikulum & Prasyarat** tab: upload/download/validate a programme's curriculum JSON without
  redeploying (same workflow as the master timetable upload), with DKM/DAD/DPU/DTP status per programme.
- Overwrite protection: publishing over an existing curriculum asks for confirmation in the UI and is
  refused server-side (`409 ALREADY_EXISTS`) unless `overwrite: true` is sent; deleting an override is
  confirmed too.
- Prerequisite enforcement in the planner: repeating a course (C1/C2/D) automatically drops every dependent
  course from the Bahagian A timetable with a notice, cascading through the full prerequisite chain
  (e.g. repeat `DBM10163` → `DBM20173` dropped, and `DBM30183` too when applicable). Rules are keyed by
  course code and merged across all programme documents, so shared codes apply to every programme.
- Repaired Windows-1252 mojibake in [PlannerView.tsx](src/components/PlannerView.tsx) (emoji and dashes
  rendered as `ðŸ“` / `â€“`).
- Advisor warning when a repeat list combines a course with its own prerequisite.

- Borang PK01 and Jadual Waktu Kuliah printouts now reproduce the official templates:
  centred Politeknik logo (53x20 mm on PK01, 56x20 mm on the jadual), page frame, `Borang PK01`
  tag box, underlined/boxed student fields, the 6/7-column course tables with the shaded
  `JUMLAH JAM KREDIT` row, the right-aligned `JUMLAH JAM KREDIT KESELURUHAN` box, signature
  lines, the official **NOTA** wording and the centred `Status : D / MK1 / MK2` legend.
- The Jadual Waktu Kuliah sheet prints on **A4 landscape** (named `@page` rules), matching the
  supplied `JADUAL WAKTU KULIAH KOSONG` template; Borang PK01 keeps A4 portrait. The on-screen
  print preview mirrors both paper sizes.
- `PKSLogo` gained a `boxClassName` prop so print documents can pin the logo to an exact
  millimetre footprint.

### Changed

- The credit-load rule printed on Borang PK01 now follows the official form (12-20 jam kredit,
  previously 18), so the warning banner and the printed NOTA agree.

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
