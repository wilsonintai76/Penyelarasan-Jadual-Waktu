/**
 * Cloudflare Function: GET & POST /api/settings
 *
 * Stores coordinator-configured session, PK01 submission deadline, department,
 * institution name, and active R2 logo pointer inside Cloudflare KV (system_settings).
 */
const SETTINGS_KEY = 'system_settings';
const PIN_CONFIG_KEY = 'admin_pin_config';
const INITIAL_DEFAULT_PIN = '2026';

const DEFAULT_SETTINGS = {
  session: 'Sesi II: 2026/2027',
  deadline: '04 DIS 2026 (JUMAAT)',
  department: 'JABATAN KEJURUTERAAN MEKANIKAL',
  institutionName: 'POLITEKNIK KUCHING SARAWAK',
  logoUrl: '',
  logoFilename: '',
  logoStorage: 'default',
  updatedAt: ''
};

function getR2Bucket(env) {
  if (!env) return null;
  return env.JADUAL_R2 || env.R2_BUCKET || env.LOGO_BUCKET || env.ASSETS_BUCKET || null;
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
      // ignore
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

export async function onRequestGet(context) {
  const { env } = context;
  const kvBound = Boolean(env && env.JADUAL_KV);
  const r2Bound = Boolean(getR2Bucket(env));
  const aiBound = Boolean(env && env.AI);
  const pinMeta = await resolvePinMeta(env);

  let settings = { ...DEFAULT_SETTINGS };

  if (kvBound) {
    try {
      const raw = await env.JADUAL_KV.get(SETTINGS_KEY, { type: 'text' });
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          settings = {
            ...DEFAULT_SETTINGS,
            ...parsed
          };
        }
      }
    } catch {
      // keep defaults
    }
  }

  return new Response(
    JSON.stringify({
      kvBound,
      r2Bound,
      aiBound,
      passcodeRequired: true,
      pinSource: pinMeta.source,
      settings
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        Pragma: 'no-cache',
        'Access-Control-Allow-Origin': '*'
      }
    }
  );
}

export async function onRequestPost(context) {
  const { env, request } = context;

  try {
    if (!env || !env.JADUAL_KV) {
      return new Response(
        JSON.stringify({
          error: 'KV_NOT_BOUND',
          message: 'Binding Cloudflare KV (JADUAL_KV) belum dikonfigurasi pada Cloudflare Pages.'
        }),
        { status: 503, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
      );
    }

    if (!(await checkAdminPin(request, env))) {
      return new Response(
        JSON.stringify({
          error: 'UNAUTHORIZED',
          message: 'PIN Admin tidak sah atau tidak dibekalkan.'
        }),
        { status: 401, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
      );
    }

    const body = await request.json();
    let existing = { ...DEFAULT_SETTINGS };
    try {
      const raw = await env.JADUAL_KV.get(SETTINGS_KEY, { type: 'text' });
      if (raw) {
        existing = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
      }
    } catch {
      // ignore
    }

    const updated = {
      ...existing,
      session: String(body.session ?? existing.session).trim() || DEFAULT_SETTINGS.session,
      deadline: String(body.deadline ?? existing.deadline).trim() || DEFAULT_SETTINGS.deadline,
      department: String(body.department ?? existing.department).trim() || DEFAULT_SETTINGS.department,
      institutionName:
        String(body.institutionName ?? existing.institutionName).trim() || DEFAULT_SETTINGS.institutionName,
      updatedAt: new Date().toISOString()
    };

    await env.JADUAL_KV.put(SETTINGS_KEY, JSON.stringify(updated));

    return new Response(
      JSON.stringify({
        ok: true,
        settings: updated
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store'
        }
      }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: 'SETTINGS_SAVE_ERROR',
        message: String(err)
      }),
      { status: 500, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
    );
  }
}
