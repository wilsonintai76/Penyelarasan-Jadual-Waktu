# Sistem Penyelarasan Jadual & Borang PK01 (JKM)

Aplikasi web untuk penyelarasan jadual kuliah dan penjanaan Borang PK01, Jabatan Kejuruteraan Mekanikal, Politeknik Kuching Sarawak.

- Live: https://jkm-penyelarasan-jadual.wilsonintai76.workers.dev
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
npm run deploy        # vite build + wrangler deploy
npm run cf:dev        # build + local Worker runtime (http://localhost:8787)
```

### Bindings

| Binding | Type | Resource | Used by |
| --- | --- | --- | --- |
| `JADUAL_KV` | KV namespace | `jkm-timetable-kv` | `/api/jadual`, `/api/jadual-history`, `/api/settings`, `/api/admin-pin`, `/api/verify-pin`, `/api/logo`, `/api/extract-pdf` |
| `JADUAL_R2` | R2 bucket | `jkm-timetable-r2` | `/api/logo` (custom logo upload) |
| `AI` | Workers AI | — | `/api/extract-pdf` |
| `ASSETS` | Static assets | `dist/` | SPA |

`/api/logo` also accepts the legacy binding names `R2_BUCKET`, `LOGO_BUCKET`, and `ASSETS_BUCKET`.

### Secrets

Set these with `npx wrangler secret put <NAME>` (never commit them):

| Secret | Purpose |
| --- | --- |
| `ADMIN_PIN` / `ADMIN_PASSCODE` | Admin PIN for upload/settings endpoints. When unset, the PIN stored in KV (`admin_pin_config`) is used, falling back to the built-in default `2026`. Set this in production. |

## Security notes

- `cf_timetable_config*.json`, `cloudflare_config*.json`, `.dev.vars`, and `local-secrets/` are git-ignored and must never be committed or placed under `public/` (Vite copies `public/` into the deployed bundle).
- Credentials previously stored in a downloaded AI Studio config file were rejected by GitHub push protection and have been removed from the repository; rotate any key that was in that file.
