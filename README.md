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
| `JADUAL_KV` | KV namespace | `jkm-timetable-kv` | `/api/jadual`, `/api/jadual-history`, `/api/settings`, `/api/admin-pin`, `/api/verify-pin`, `/api/logo`, `/api/extract-pdf` |
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
