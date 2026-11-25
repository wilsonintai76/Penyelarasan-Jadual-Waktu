# Changelog

All notable changes to the Sistem Penyelarasan Jadual (JKM) web app are recorded here.
The version is defined in [package.json](./package.json) and is surfaced in the app
footer, the Tetapan modal, and `GET /api/version` on the deployed Worker.

## [1.3.9] - 2026-11-25

### Fixed

- DKM co-curriculum codes now follow the session rule **Semester 1 = new codes, Semester 2 and above = old
  codes** in [dkm.json](public/assets/curriculum/dkm.json):
  `MPU24031/MPU24041` (Sukan 1 / Kelab-Persatuan 1) became `MPU24071`/`MPU24081`, while `MPU24051`/`MPU24061`
  (Sukan 2 / Kelab-Persatuan 2) keep the old codes and now require the new Semester 1 codes.
- The unresolved `MPU24XX1` placeholder is replaced by the real uniformed-body codes:
  Semester 1 `MPU24331` Askar Wataniah 1, `MPU24341` PLAS TLDM 1, `MPU24351` PLAS TUDM 1, `MPU24371` PISPA 1,
  `MPU24411` Relasis 1; Semester 2 `MPU24221`, `MPU24231`, `MPU24461`, `MPU24261`, `MPU24301`
  (each requires its Semester 1 counterpart). The curriculum is now 71 courses / 15 prerequisite links with no
  unresolved entries.
- `buildCanonicalNameMap` read the curriculum library with the wrong shape (it expected a `documents` wrapper
  while `CurriculumLibrary` is a `programme -> document` map), so the upload review never compared course
  names against the curriculum. It now uses the same document splitter as the prerequisite engine.

## [1.3.8] - 2026-11-25

### Changed

- Master timetable republished from the NiceGUI extraction (`desktop/jadual_waktu_program_jkm.json`,
  439 rows) plus the 18 co-curriculum rows the extractor had collapsed, so the planner keeps its
  "Pilih satu" choice: **457 rows**, 38 sections, 73 course codes. The extractor merges parallel workshop
  rows (`M4W, M2M, M1F`) and consecutive blocks of the same course into one session, removing the 40
  redundant rows the previous master carried. The 508-row master is kept in R2
  (`backups/jadual_induk_jkm-2026-11-25T04-25-00-000Z.json`).

### Fixed

- Course names now fall back to [course_catalog.json](public/assets/course_catalog.json) when a code is not
  covered by any programme curriculum (co-curriculum `MPU24xxx`, programme-specific electives), so an upload
  can no longer publish a placeholder such as `MPU24071` as the course name.

## [1.3.7] - 2026-11-25

### Changed

- Four non-canonical utility classes replaced with their Tailwind v4 equivalents (identical CSS output):
  `min-w-[794px]` -> `min-w-198.5`, `min-w-[1123px]` -> `min-w-280.75`,
  `-rotate-[30deg]` -> `rotate-[-30deg]`, `underline-offset-[2px]` -> `underline-offset-2`.
  The workspace Problems panel is now clean.

## [1.3.6] - 2026-11-25

### Fixed

- The cache signature for the master timetable now includes `Course_Name` and `Credit`, so a
  name-only correction (like the `MPU24xxx` co-curriculum rename) reaches browsers that still hold
  the previous master in `localStorage`. Previously only slot fields were compared, so the old names
  stayed on screen until the cache was cleared.
- The "Pilih satu" choice is now written by both auto-save effects (the periodic 15-second timer also
  carries `electiveSelections` in its dependencies), so a chosen co-curriculum option survives a reload
  instead of being overwritten by a stale closure.

## [1.3.5] - 2026-11-25

### Fixed

- Co-curriculum codes now resolve to their official names, so the "Pilih satu" chooser and Borang PK01 show
  real course names instead of raw codes. [course_catalog.json](public/assets/course_catalog.json) gained the
  28 `MPU24xxx` entries for both cohorts: **Sesi II 2026/2027** (`MPU24071` Sukan 1, `MPU24091` Sukan 2,
  `MPU24081` Kelab/Persatuan 1, `MPU24101` Kelab/Persatuan 2, `MPU24331/24441` Askar Wataniah 1/2,
  `MPU24341/24451` PLAS TLDM 1/2, `MPU24351/24461` PLAS TUDM 1/2, `MPU24371/24481` PISPA 1/2,
  `MPU24411/24521` Relasis 1/2) and **Sesi I 2026/2027** (`MPU24031/24051` Sukan 1/2,
  `MPU24041/24061` Kelab/Persatuan 1/2, `MPU24111/24221` Askar Wataniah 1/2, `MPU24121/24231` PLAS TLDM 1/2,
  `MPU24351/24461` PLAS TUDM 1/2, `MPU24151/24261` PISPA 1/2, `MPU24191/24301` Relasis 1/2).
- The live master keeps the same 508 slots; 28 rows were renamed from the raw code to the official name.

## [1.3.4] - 2026-11-25

### Added

- "Pilih satu" groups in the planner: courses of one section that share the exact same slot are treated as
  alternatives (Sukan 2 / Kelab-Persatuan 2 / Unit Beruniform 2 - `MPU24XX1`). The planner shows a chooser
  for each group, keeps only the selected option in Bahagian A, and that single choice drives the credit
  total, the timetable grid and Borang PK01. The unselected alternatives are listed as
  "Pilihan Lain (Tidak Diambil)" instead of being counted or reported as a clash.
- The choice is remembered per section and slot in `localStorage` (`pks_elective_choices`).

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
