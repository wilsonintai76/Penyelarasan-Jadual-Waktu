import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';

const PORT = 3000;
const SIM_DIR = path.resolve(process.cwd(), '.local-cf-sim');
const KV_JADUAL_FILE = path.join(SIM_DIR, 'kv-jadual.json');
const KV_HISTORY_FILE = path.join(SIM_DIR, 'kv-history.json');
const KV_SETTINGS_FILE = path.join(SIM_DIR, 'kv-settings.json');
const KV_PIN_FILE = path.join(SIM_DIR, 'kv-pin.json');
const KV_CURRICULUM_FILE = path.join(SIM_DIR, 'kv-curriculum.json');
const CURRICULUM_ASSET_DIR = path.resolve(process.cwd(), 'public/assets/curriculum');
const INITIAL_DEFAULT_PIN = '2026';
const R2_DIR = path.join(SIM_DIR, 'r2');
const R2_LOGO_BIN = path.join(R2_DIR, 'logo-politeknik.bin');
const R2_LOGO_META = path.join(R2_DIR, 'logo-politeknik.meta.json');

const DEFAULT_SETTINGS = {
  session: 'Sesi II: 2026/2027',
  deadline: '04 DIS 2026 (JUMAAT)',
  department: 'JABATAN KEJURUTERAAN MEKANIKAL',
  institutionName: 'POLITEKNIK KUCHING SARAWAK',
  logoUrl: '',
  logoFilename: '',
  logoStorage: 'default' as 'r2' | 'default',
  updatedAt: ''
};

function ensureSimDirs() {
  if (!fs.existsSync(SIM_DIR)) fs.mkdirSync(SIM_DIR, { recursive: true });
  if (!fs.existsSync(R2_DIR)) fs.mkdirSync(R2_DIR, { recursive: true });
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(raw) as T;
    }
  } catch {
    // ignore corrupt local sim file
  }
  return fallback;
}

function writeJsonFile(filePath: string, data: unknown) {
  ensureSimDirs();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function resolvePinMeta(): { pin: string; source: 'env' | 'kv' | 'default' } {
  const envPin = (process.env.ADMIN_PIN || process.env.ADMIN_PASSCODE || '').trim();
  if (envPin) return { pin: envPin, source: 'env' };

  const stored = readJsonFile<{ pin?: string }>(KV_PIN_FILE, {});
  const kvPin = String(stored?.pin || '').trim();
  if (kvPin) return { pin: kvPin, source: 'kv' };

  return { pin: INITIAL_DEFAULT_PIN, source: 'default' };
}

function checkPasscode(req: express.Request): boolean {
  const provided = String(
    req.header('X-Admin-Passcode') || req.header('X-Admin-Pin') || ''
  ).trim();
  if (!provided) return false;
  return provided === resolvePinMeta().pin;
}

function computeVersionTag(rawData: string): string {
  let hash = 2166136261;
  for (let i = 0; i < rawData.length; i++) {
    hash ^= rawData.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `"kv-${rawData.length}-${(hash >>> 0).toString(16)}"`;
}

const EXTRACTION_PROMPT = `You are a precision timetable extractor for Jabatan Kejuruteraan Mekanikal (JKM), Politeknik Kuching Sarawak (aSc Timetables / PLSP-02(1a) grid).
Extract ALL scheduled class slots visible on this timetable page into a JSON object { "entries": [...] }.
Rules:
1. Cohort / Section format: uppercase like "DAD1-S1", "DAD2-S2", "DKM1-S1", "DPU3-S1", "DTP1-S1" (fix OCR typos like -51 -> -S1, DKM1S1 -> DKM1-S1).
2. Course_Code: uppercase alphanumeric code like "DJJ10243", "DBM10163", "DBS10042", "DUE10062", "MPU21072", "DJA20132", "DJU20102", "DJF52103". Fix OCR digit/letter confusion (0 vs O, 1 vs I, 8 vs B) where obvious.
3. Credit: integer inferred from the last digit of Course_Code (e.g. DJJ10243 -> 3, DUE10062 -> 2, MPU22071 -> 1), default 3 if unclear.
4. Day: MUST be Malay day name: "Isnin", "Selasa", "Rabu", "Khamis", or "Jumaat".
5. Start_Time and End_Time: MUST be 24-hour HH:MM format (e.g. "08:00", "10:00", "13:00", "14:00", "17:00"). Remember afternoon slots 1.00-5.00 are 13:00-17:00! Read the horizontal span carefully for merged 2-hour or 3-hour blocks.
6. Venue: room/lab code (e.g. "BK 21", "M14AT", "M13CAD", "BENGKEL", "BK TUANGAN").
7. Lecturer: lecturer code(s) separated by "/" if multiple (e.g. "JANN", "JFOZ/JMNH").
8. Status: "D".`;

async function startServer() {
  ensureSimDirs();

  const app = express();
  app.use(express.json({ limit: '30mb' }));

  // GET /api/jadual (Cloudflare KV read)
  app.get('/api/jadual', (_req, res) => {
    if (!fs.existsSync(KV_JADUAL_FILE)) {
      res.status(404).json({
        error: 'KEY_NOT_FOUND',
        message: 'Belum ada data jadual diterbitkan ke KV.'
      });
      return;
    }
    const rawData = fs.readFileSync(KV_JADUAL_FILE, 'utf-8');
    const versionTag = computeVersionTag(rawData);
    res
      .status(200)
      .set({
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        Pragma: 'no-cache',
        ETag: versionTag,
        'X-Timetable-Version': versionTag
      })
      .send(rawData);
  });

  // POST /api/jadual (Cloudflare KV write)
  app.post('/api/jadual', (req, res) => {
    if (!checkPasscode(req)) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'Kod akses penyelaras tidak sah.' });
      return;
    }

    const body = req.body;
    const rawEntries = Array.isArray(body)
      ? body
      : body && Array.isArray(body.entries)
        ? body.entries
        : null;

    if (!rawEntries || rawEntries.length === 0) {
      res.status(400).json({ error: 'INVALID_PAYLOAD', message: 'Senarai slot jadual tidak boleh kosong.' });
      return;
    }

    const existing = readJsonFile<unknown[]>(KV_JADUAL_FILE, []);
    const previousSlots = Array.isArray(existing) ? existing.length : 0;

    writeJsonFile(KV_JADUAL_FILE, rawEntries);

    const cohortsCount = new Set(
      rawEntries.map((r: any) => String(r?.Cohort || '').trim()).filter(Boolean)
    ).size;

    const latestEntry = {
      id: `cf_${Date.now()}`,
      timestamp: new Date().toISOString(),
      source: body?.source || 'web_pdf_upload',
      filename: body?.filename || 'jadual_induk_jkm.pdf',
      previousSlots,
      newSlots: rawEntries.length,
      deltaSlots: rawEntries.length - previousSlots,
      cohortsCount,
      engineLabel: body?.engineLabel || 'Cloudflare Web Upload'
    };

    writeJsonFile(KV_HISTORY_FILE, [latestEntry]);

    res.status(200).json({
      ok: true,
      kvKey: 'jadual_induk_jkm',
      slotsCount: rawEntries.length,
      cohortsCount,
      latestLog: latestEntry
    });
  });

  // GET /api/jadual-history (Latest update log only)
  app.get('/api/jadual-history', (_req, res) => {
    const logs = readJsonFile<unknown[]>(KV_HISTORY_FILE, []);
    res
      .status(200)
      .set({ 'Cache-Control': 'no-store, no-cache, must-revalidate' })
      .json({
        kvBound: true,
        key: 'jadual_induk_jkm_history',
        logs: Array.isArray(logs) ? logs.slice(0, 1) : []
      });
  });

  // POST /api/verify-pin (Verify Coordinator PIN without exposing secret to browser)
  app.post('/api/verify-pin', (req, res) => {
    const provided = String(
      req.body?.pin ||
        req.header('X-Admin-Passcode') ||
        req.header('X-Admin-Pin') ||
        ''
    ).trim();

    if (!provided) {
      res.status(400).json({ ok: false, error: 'PIN_REQUIRED', message: 'Sila masukkan PIN Admin.' });
      return;
    }

    const expected = resolvePinMeta();
    if (provided !== expected.pin) {
      res.status(401).json({
        ok: false,
        error: 'INVALID_PIN',
        message: 'PIN Admin tidak sah. Sila cuba lagi.'
      });
      return;
    }

    res.status(200).set({ 'Cache-Control': 'no-store' }).json({ ok: true, pinSource: expected.source });
  });

  // POST /api/admin-pin (Change Admin PIN stored in KV/local sim when not locked by env)
  app.post('/api/admin-pin', (req, res) => {
    const expected = resolvePinMeta();
    if (expected.source === 'env') {
      res.status(409).json({
        error: 'ENV_PIN_LOCKED',
        message:
          'PIN dikawal oleh Environment Secret (ADMIN_PIN / ADMIN_PASSCODE). Sila ubah melalui tetapan persekitaran pelayan.'
      });
      return;
    }

    const currentPin = String(
      req.body?.currentPin ||
        req.header('X-Admin-Passcode') ||
        req.header('X-Admin-Pin') ||
        ''
    ).trim();
    const newPin = String(req.body?.newPin || '').trim();

    if (currentPin !== expected.pin) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'PIN Admin semasa tidak sah.' });
      return;
    }

    if (newPin.length < 4 || newPin.length > 12) {
      res.status(400).json({
        error: 'INVALID_NEW_PIN',
        message: 'PIN baharu mestilah antara 4 hingga 12 aksara/digit.'
      });
      return;
    }

    writeJsonFile(KV_PIN_FILE, { pin: newPin, updatedAt: new Date().toISOString() });
    res
      .status(200)
      .set({ 'Cache-Control': 'no-store' })
      .json({ ok: true, message: 'PIN Admin baharu berjaya disimpan.' });
  });

  // GET /api/settings (System settings: session, deadline, department, R2 logo)
  app.get('/api/settings', (_req, res) => {
    const saved = readJsonFile(KV_SETTINGS_FILE, DEFAULT_SETTINGS);
    const settings = { ...DEFAULT_SETTINGS, ...saved };
    const pinMeta = resolvePinMeta();
    res
      .status(200)
      .set({ 'Cache-Control': 'no-store, no-cache, must-revalidate' })
      .json({
        kvBound: true,
        r2Bound: true,
        aiBound: Boolean(
          (process.env.CLOUDFLARE_ACCOUNT_ID || '').trim() && (process.env.CLOUDFLARE_API_TOKEN || '').trim()
        ),
        passcodeRequired: true,
        pinSource: pinMeta.source,
        settings
      });
  });

  // POST /api/settings
  app.post('/api/settings', (req, res) => {
    if (!checkPasscode(req)) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'Kod akses penyelaras tidak sah.' });
      return;
    }

    const existing = { ...DEFAULT_SETTINGS, ...readJsonFile(KV_SETTINGS_FILE, DEFAULT_SETTINGS) };
    const body = req.body || {};
    const updated = {
      ...existing,
      session: String(body.session ?? existing.session).trim() || DEFAULT_SETTINGS.session,
      deadline: String(body.deadline ?? existing.deadline).trim() || DEFAULT_SETTINGS.deadline,
      department: String(body.department ?? existing.department).trim() || DEFAULT_SETTINGS.department,
      institutionName:
        String(body.institutionName ?? existing.institutionName).trim() || DEFAULT_SETTINGS.institutionName,
      updatedAt: new Date().toISOString()
    };

    writeJsonFile(KV_SETTINGS_FILE, updated);
    res.status(200).json({ ok: true, settings: updated });
  });

  // GET /api/curriculum (KV override, falls back to the bundled asset)
  app.get('/api/curriculum', (req, res) => {
    const store = readJsonFile<Record<string, any>>(KV_CURRICULUM_FILE, {});
    const requested = String(req.query.programme || '').trim().toUpperCase();

    if (requested) {
      const kv = store[requested];
      if (kv && kv.curriculum && kv.curriculum.courses) {
        res.status(200).set({ 'Cache-Control': 'no-store' }).json({
          programme: requested,
          source: 'kv',
          updatedAt: kv.updatedAt || '',
          filename: kv.filename || '',
          curriculum: kv.curriculum
        });
        return;
      }
      const asset = readJsonFile<any>(path.join(CURRICULUM_ASSET_DIR, `${requested.toLowerCase()}.json`), null);
      if (asset && asset.courses && Object.keys(asset.courses).length > 0) {
        res.status(200).set({ 'Cache-Control': 'no-store' }).json({
          programme: requested,
          source: 'asset',
          curriculum: asset
        });
        return;
      }
      res.status(200).set({ 'Cache-Control': 'no-store' }).json({
        programme: requested,
        source: 'none',
        curriculum: null
      });
      return;
    }

    const summarize = (programme: string, source: string, curriculum: any, extra: any = {}) => {
      const courses = (curriculum && curriculum.courses) || {};
      return {
        programme,
        source,
        coursesCount: Object.keys(courses).length,
        prerequisitesCount: Object.values<any>(courses).reduce(
          (total, course) => total + ((course && course.prerequisites) || []).length,
          0
        ),
        version: (curriculum && curriculum.meta && curriculum.meta.version) || '',
        effective: (curriculum && curriculum.meta && curriculum.meta.effective) || '',
        updatedAt: extra.updatedAt || '',
        filename: extra.filename || ''
      };
    };

    const programmes = Array.from(
      new Set(['DKM', 'DAD', 'DPU', 'DTP', ...Object.keys(store)])
    )
      .sort()
      .map(code => {
        const kv = store[code];
        if (kv && kv.curriculum && kv.curriculum.courses) return summarize(code, 'kv', kv.curriculum, kv);
        const asset = readJsonFile<any>(path.join(CURRICULUM_ASSET_DIR, `${code.toLowerCase()}.json`), null);
        return asset && asset.courses ? summarize(code, 'asset', asset) : summarize(code, 'none', null);
      });

    res.status(200).set({ 'Cache-Control': 'no-store' }).json({ programmes });
  });

  // POST /api/curriculum (Publish a per-programme KV override without redeploying)
  app.post('/api/curriculum', (req, res) => {
    if (!checkPasscode(req)) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'Kod akses penyelaras tidak sah.' });
      return;
    }
    const body = req.body || {};
    const curriculum = body.curriculum ?? body;
    const programme = String(body.programme || curriculum?.meta?.programme || '')
      .trim()
      .toUpperCase();

    if (!/^[A-Z]{2,5}$/.test(programme)) {
      res.status(400).json({
        error: 'INVALID_PROGRAMME',
        message: 'Kod program tidak sah. Sertakan "programme" (cth. DKM) atau meta.programme.'
      });
      return;
    }
    if (!curriculum || !curriculum.courses || Object.keys(curriculum.courses).length === 0) {
      res.status(400).json({
        error: 'INVALID_CURRICULUM',
        message: 'Struktur kurikulum tidak sah. Medan "courses" diperlukan.'
      });
      return;
    }

    const store = readJsonFile<Record<string, any>>(KV_CURRICULUM_FILE, {});
    const existing = store[programme];
    if (existing && body.overwrite !== true) {
      res.status(409).json({
        error: 'ALREADY_EXISTS',
        message: `Kurikulum ${programme} sudah wujud di KV. Sahkan tindihan (overwrite: true) untuk menggantikannya.`,
        existing: {
          programme,
          source: 'kv',
          coursesCount: Object.keys(existing.curriculum?.courses || {}).length,
          updatedAt: existing.updatedAt || '',
          filename: existing.filename || ''
        }
      });
      return;
    }

    store[programme] = {
      curriculum,
      filename: String(body.filename || ''),
      updatedAt: new Date().toISOString()
    };
    writeJsonFile(KV_CURRICULUM_FILE, store);
    res.status(200).json({ ok: true, key: `curriculum_${programme}`, programme });
  });

  // DELETE /api/curriculum?programme=DKM (Drop the override so the bundled asset is served again)
  app.delete('/api/curriculum', (req, res) => {
    if (!checkPasscode(req)) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'Kod akses penyelaras tidak sah.' });
      return;
    }
    const programme = String(req.query.programme || '').trim().toUpperCase();
    if (!programme) {
      res.status(400).json({ error: 'PROGRAMME_REQUIRED', message: 'Sertakan ?programme=DKM.' });
      return;
    }
    const store = readJsonFile<Record<string, any>>(KV_CURRICULUM_FILE, {});
    delete store[programme];
    writeJsonFile(KV_CURRICULUM_FILE, store);
    res.status(200).json({ ok: true, message: `Override KV ${programme} dibuang.` });
  });

  // GET /api/logo (Serve logo stored in R2)
  app.get('/api/logo', (_req, res) => {
    if (!fs.existsSync(R2_LOGO_BIN)) {
      res.status(404).json({ error: 'LOGO_NOT_FOUND', message: 'Tiada logo kustom dimuat naik ke R2.' });
      return;
    }
    const meta = readJsonFile<{ contentType?: string }>(R2_LOGO_META, { contentType: 'image/png' });
    const bin = fs.readFileSync(R2_LOGO_BIN);
    res
      .status(200)
      .set({
        'Content-Type': meta.contentType || 'image/png',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        Pragma: 'no-cache'
      })
      .send(bin);
  });

  // POST /api/logo (Upload logo to R2)
  app.post('/api/logo', (req, res) => {
    if (!checkPasscode(req)) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'Kod akses penyelaras tidak sah.' });
      return;
    }

    try {
      const { dataUrl, filename, contentType } = req.body || {};
      const match = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/);
      if (!match) {
        res.status(400).json({ error: 'INVALID_IMAGE', message: 'Format imej tidak sah.' });
        return;
      }

      const detectedType = String(contentType || match[1] || 'image/png').toLowerCase();
      const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/svg+xml', 'image/webp'];
      if (!allowedTypes.includes(detectedType)) {
        res.status(400).json({ error: 'UNSUPPORTED_TYPE', message: 'Hanya fail PNG, JPG, SVG, atau WEBP dibenarkan.' });
        return;
      }

      const buffer = Buffer.from(match[2], 'base64');
      if (buffer.byteLength > 5 * 1024 * 1024) {
        res.status(400).json({ error: 'FILE_TOO_LARGE', message: 'Saiz fail logo melebihi had 5MB.' });
        return;
      }

      ensureSimDirs();
      fs.writeFileSync(R2_LOGO_BIN, buffer);
      writeJsonFile(R2_LOGO_META, {
        contentType: detectedType,
        filename: String(filename || 'logo-politeknik.png')
      });

      const version = Date.now();
      const logoUrl = `/api/logo?v=${version}`;
      const existing = { ...DEFAULT_SETTINGS, ...readJsonFile(KV_SETTINGS_FILE, DEFAULT_SETTINGS) };
      const updated = {
        ...existing,
        logoUrl,
        logoFilename: String(filename || 'logo-politeknik.png'),
        logoStorage: 'r2' as const,
        updatedAt: new Date(version).toISOString()
      };
      writeJsonFile(KV_SETTINGS_FILE, updated);

      res.status(200).json({ ok: true, logoUrl, settings: updated });
    } catch (err) {
      res.status(500).json({ error: 'R2_UPLOAD_ERROR', message: String(err) });
    }
  });

  // DELETE /api/logo (Reset logo to default)
  app.delete('/api/logo', (req, res) => {
    if (!checkPasscode(req)) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'Kod akses penyelaras tidak sah.' });
      return;
    }

    try {
      if (fs.existsSync(R2_LOGO_BIN)) fs.unlinkSync(R2_LOGO_BIN);
      if (fs.existsSync(R2_LOGO_META)) fs.unlinkSync(R2_LOGO_META);

      const existing = { ...DEFAULT_SETTINGS, ...readJsonFile(KV_SETTINGS_FILE, DEFAULT_SETTINGS) };
      const updated = {
        ...existing,
        logoUrl: '',
        logoFilename: '',
        logoStorage: 'default' as const,
        updatedAt: new Date().toISOString()
      };
      writeJsonFile(KV_SETTINGS_FILE, updated);

      res.status(200).json({ ok: true, settings: updated });
    } catch (err) {
      res.status(500).json({ error: 'R2_DELETE_ERROR', message: String(err) });
    }
  });

  // POST /api/extract-pdf (Cloudflare Workers AI vision PDF page extractor)
  app.post('/api/extract-pdf', async (req, res) => {
    if (!checkPasscode(req)) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'PIN Admin tidak sah atau tidak dibekalkan.' });
      return;
    }
    try {
      const accountId = (process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
      const apiToken = (process.env.CLOUDFLARE_API_TOKEN || '').trim();
      const model = (process.env.CF_VISION_MODEL || '@cf/meta/llama-4-scout-17b-16e-instruct').trim();

      if (!accountId || !apiToken) {
        res.status(503).json({
          error: 'WORKERS_AI_NOT_CONFIGURED',
          message:
            'CLOUDFLARE_ACCOUNT_ID dan CLOUDFLARE_API_TOKEN belum ditetapkan. Pengekstrakan PDF menggunakan Cloudflare Workers AI.'
        });
        return;
      }

      const body = req.body || {};
      const imageBase64 = String(body.imageBase64 || '').replace(/^data:[^;]+;base64,/, '');
      const mimeType = String(body.mimeType || 'image/jpeg');
      const pageNumber = Number(body.pageNumber || 1);

      if (!imageBase64) {
        res.status(400).json({ error: 'NO_IMAGE', message: 'Imej halaman PDF tidak diterima.' });
        return;
      }

      const aiRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: `${EXTRACTION_PROMPT}\nPage ${pageNumber}. Return ONLY raw JSON.` },
                { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } }
              ]
            }
          ],
          max_tokens: 4096
        })
      });

      const payload: any = await aiRes.json();
      if (!aiRes.ok || payload?.success === false) {
        res.status(aiRes.ok ? 502 : aiRes.status).json({
          error: 'WORKERS_AI_UPSTREAM_ERROR',
          message: `Ralat Workers AI (${aiRes.status}): ${JSON.stringify(payload?.errors || payload).slice(0, 220)}`
        });
        return;
      }

      const rawText = String(payload?.result?.response ?? payload?.result?.text ?? '{}');
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { entries: [] };

      res.status(200).json({
        ok: true,
        engine: `Cloudflare Workers AI (${model})`,
        entries: Array.isArray(parsed.entries) ? parsed.entries : []
      });
    } catch (err: any) {
      res.status(500).json({
        error: 'PDF_EXTRACT_ERROR',
        message: err?.message || String(err)
      });
    }
  });

  // Vite middleware in development, static dist in production
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`JKM Timetable & PK01 server listening on http://localhost:${PORT}`);
  });
}

startServer();
