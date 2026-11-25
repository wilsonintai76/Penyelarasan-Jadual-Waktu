/**
 * Cloudflare Function: GET / POST / DELETE /api/curriculum
 *
 * Curriculum prerequisite rules are stored per programme, mirroring how the master
 * timetable works: a JSON document per programme can be uploaded without redeploying.
 *
 *   KV key  : curriculum_<PROGRAMME>   (value: { curriculum, filename, updatedAt })
 *   Asset   : /assets/curriculum/<programme>.json  (bundled default, lower case)
 *
 *   GET  /api/curriculum                     -> status summary of every known programme
 *   GET  /api/curriculum?programme=DKM       -> { source, programme, curriculum }
 *   POST /api/curriculum  { programme, curriculum, filename }
 *   DELETE /api/curriculum?programme=DKM     -> drop the KV override
 *
 * Prerequisites are kept out of the master timetable on purpose: the timetable is
 * replaced on every upload, while curriculum rules only change with a programme version.
 */
// Programmes that ship a bundled asset. Any other code discovered in KV is merged in,
// so a new programme (e.g. DJK) works without a code change.
const DEFAULT_PROGRAMMES = ['DKM', 'DAD', 'DPU', 'DTP'];
const CURRICULUM_PREFIX = 'curriculum_';
const PIN_CONFIG_KEY = 'admin_pin_config';
const INITIAL_DEFAULT_PIN = '2026';

const curriculumKey = programme => `curriculum_${programme}`;
const assetPath = programme => `/assets/curriculum/${programme.toLowerCase()}.json`;

/** Programme codes that already have a KV override, discovered by key prefix. */
async function listKvProgrammes(env) {
  if (!env || !env.JADUAL_KV || typeof env.JADUAL_KV.list !== 'function') return [];
  const codes = new Set();
  let cursor;
  for (let page = 0; page < 10; page += 1) {
    const result = await env.JADUAL_KV.list({ prefix: CURRICULUM_PREFIX, cursor });
    (result.keys || []).forEach(key => {
      const code = normalizeProgramme(String(key.name || '').slice(CURRICULUM_PREFIX.length));
      if (code) codes.add(code);
    });
    if (result.list_complete) break;
    cursor = result.cursor;
    if (!cursor) break;
  }
  return Array.from(codes);
}

async function resolvePinMeta(env) {
  const envPin = String((env && (env.ADMIN_PIN || env.ADMIN_PASSCODE)) || '').trim();
  if (envPin) return { pin: envPin, source: 'env' };

  if (env && env.JADUAL_KV) {
    try {
      const raw = await env.JADUAL_KV.get(PIN_CONFIG_KEY, { type: 'text' });
      if (raw) {
        const parsed = JSON.parse(raw);
        const kvPin = String((parsed && parsed.pin) || '').trim();
        if (kvPin) return { pin: kvPin, source: 'kv' };
      }
    } catch {
      // ignore malformed KV entry
    }
  }
  return { pin: INITIAL_DEFAULT_PIN, source: 'default' };
}

async function checkAdminPin(request, env) {
  const provided = (
    request.headers.get('X-Admin-Passcode') ||
    request.headers.get('X-Admin-Pin') ||
    ''
  ).trim();
  if (!provided) return false;
  const expected = await resolvePinMeta(env);
  return provided === expected.pin;
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      Pragma: 'no-cache',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

function normalizeProgramme(value) {
  return String(value || '').trim().toUpperCase();
}

function isValidCurriculum(value) {
  return Boolean(
    value &&
      typeof value === 'object' &&
      value.courses &&
      typeof value.courses === 'object' &&
      Object.keys(value.courses).length > 0
  );
}

async function readKvCurriculum(env, programme) {
  if (!env || !env.JADUAL_KV) return null;
  try {
    const raw = await env.JADUAL_KV.get(curriculumKey(programme), { type: 'text' });
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const curriculum = parsed && parsed.curriculum ? parsed.curriculum : parsed;
    if (!isValidCurriculum(curriculum)) return null;
    return {
      curriculum,
      filename: (parsed && parsed.filename) || '',
      updatedAt: (parsed && parsed.updatedAt) || ''
    };
  } catch {
    return null;
  }
}

async function readAssetCurriculum(env, request, programme) {
  if (!env || !env.ASSETS) return null;
  try {
    const assetUrl = new URL(assetPath(programme), request.url);
    const assetRes = await env.ASSETS.fetch(new Request(assetUrl.toString()));
    if (!assetRes.ok) return null;
    const parsed = await assetRes.json();
    return isValidCurriculum(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function summarize(programme, source, curriculum, extra = {}) {
  const courses = (curriculum && curriculum.courses) || {};
  const prerequisitesCount = Object.values(courses).reduce(
    (total, course) => total + ((course && course.prerequisites) || []).length,
    0
  );
  return {
    programme,
    source,
    coursesCount: Object.keys(courses).length,
    prerequisitesCount,
    version: (curriculum && curriculum.meta && curriculum.meta.version) || '',
    effective: (curriculum && curriculum.meta && curriculum.meta.effective) || '',
    updatedAt: extra.updatedAt || '',
    filename: extra.filename || ''
  };
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const requested = normalizeProgramme(url.searchParams.get('programme'));

  if (requested) {
    const kv = await readKvCurriculum(env, requested);
    if (kv) {
      return jsonResponse({
        programme: requested,
        source: 'kv',
        updatedAt: kv.updatedAt,
        filename: kv.filename,
        curriculum: kv.curriculum
      });
    }

    const asset = await readAssetCurriculum(env, request, requested);
    if (asset) {
      return jsonResponse({ programme: requested, source: 'asset', curriculum: asset });
    }

    return jsonResponse({ programme: requested, source: 'none', curriculum: null });
  }

  // Status summary for the upload UI (bundled programmes + anything published to KV)
  const kvProgrammes = await listKvProgrammes(env);
  const programmeCodes = Array.from(new Set([...DEFAULT_PROGRAMMES, ...kvProgrammes])).sort();

  const programmes = [];
  for (const code of programmeCodes) {
    const kv = await readKvCurriculum(env, code);
    if (kv) {
      programmes.push(summarize(code, 'kv', kv.curriculum, kv));
      continue;
    }
    const asset = await readAssetCurriculum(env, request, code);
    programmes.push(asset ? summarize(code, 'asset', asset) : summarize(code, 'none', null));
  }

  return jsonResponse({ programmes });
}

export async function onRequestPost(context) {
  const { env, request } = context;

  if (!env || !env.JADUAL_KV) {
    return jsonResponse(
      {
        error: 'KV_NOT_BOUND',
        message: 'Binding Cloudflare KV (JADUAL_KV) belum dikonfigurasi pada Cloudflare Pages.'
      },
      503
    );
  }

  if (!(await checkAdminPin(request, env))) {
    return jsonResponse(
      { error: 'UNAUTHORIZED', message: 'PIN Admin tidak sah atau tidak dibekalkan.' },
      401
    );
  }

  try {
    const body = await request.json();
    const curriculum = body && body.curriculum ? body.curriculum : body;
    const programme = normalizeProgramme(
      (body && body.programme) || (curriculum && curriculum.meta && curriculum.meta.programme)
    );

    if (!/^[A-Z]{2,5}$/.test(programme)) {
      return jsonResponse(
        {
          error: 'INVALID_PROGRAMME',
          message: 'Kod program tidak sah. Sertakan "programme" (cth. DKM) atau meta.programme.'
        },
        400
      );
    }

    if (!isValidCurriculum(curriculum)) {
      return jsonResponse(
        {
          error: 'INVALID_CURRICULUM',
          message: 'Struktur kurikulum tidak sah. Medan "courses" diperlukan.'
        },
        400
      );
    }

    // Never replace an existing document without an explicit overwrite acknowledgement.
    const existingRaw = await env.JADUAL_KV.get(curriculumKey(programme), { type: 'text' });
    if (existingRaw && (body && body.overwrite) !== true) {
      let existing = null;
      try {
        const parsed = JSON.parse(existingRaw);
        existing = summarize(programme, 'kv', parsed.curriculum || parsed, parsed);
      } catch {
        existing = null;
      }
      return jsonResponse(
        {
          error: 'ALREADY_EXISTS',
          message: `Kurikulum ${programme} sudah wujud di KV. Sahkan tindihan (overwrite: true) untuk menggantikannya.`,
          existing
        },
        409
      );
    }

    const record = {
      curriculum,
      filename: String((body && body.filename) || ''),
      updatedAt: new Date().toISOString()
    };

    await env.JADUAL_KV.put(curriculumKey(programme), JSON.stringify(record));

    return jsonResponse({
      ok: true,
      key: curriculumKey(programme),
      summary: summarize(programme, 'kv', curriculum, record)
    });
  } catch (err) {
    return jsonResponse({ error: 'CURRICULUM_SAVE_ERROR', message: String(err) }, 500);
  }
}

/** Removes the KV override so the bundled asset is served again. */
export async function onRequestDelete(context) {
  const { env, request } = context;

  if (!env || !env.JADUAL_KV) {
    return jsonResponse(
      {
        error: 'KV_NOT_BOUND',
        message: 'Binding Cloudflare KV (JADUAL_KV) belum dikonfigurasi pada Cloudflare Pages.'
      },
      503
    );
  }

  if (!(await checkAdminPin(request, env))) {
    return jsonResponse(
      { error: 'UNAUTHORIZED', message: 'PIN Admin tidak sah atau tidak dibekalkan.' },
      401
    );
  }

  const programme = normalizeProgramme(new URL(request.url).searchParams.get('programme'));
  if (!programme) {
    return jsonResponse({ error: 'PROGRAMME_REQUIRED', message: 'Sertakan ?programme=DKM.' }, 400);
  }

  await env.JADUAL_KV.delete(curriculumKey(programme));
  return jsonResponse({ ok: true, message: `Override KV ${programme} dibuang.` });
}
