/**
 * Cloudflare Pages Function: GET, POST & DELETE /api/logo
 *
 * Stores and serves the official Politeknik logo binary from Cloudflare R2,
 * and keeps system_settings in Cloudflare KV synchronized.
 *
 * R2 Binding checked in order: JADUAL_R2 -> R2_BUCKET -> LOGO_BUCKET -> ASSETS_BUCKET
 */
const SETTINGS_KEY = 'system_settings';
const PIN_CONFIG_KEY = 'admin_pin_config';
const INITIAL_DEFAULT_PIN = '2026';
const DEFAULT_LOGO_OBJECT_KEY = 'logos/logo-politeknik';

function getR2Bucket(env) {
  if (!env) return null;
  return env.JADUAL_R2 || env.R2_BUCKET || env.LOGO_BUCKET || env.ASSETS_BUCKET || null;
}

async function checkAdminPin(request, env) {
  const provided = (
    request.headers.get('X-Admin-Passcode') ||
    request.headers.get('X-Admin-Pin') ||
    ''
  ).trim();
  if (!provided) return false;

  const envPin = String((env && (env.ADMIN_PIN || env.ADMIN_PASSCODE)) || '').trim();
  if (envPin) return provided === envPin;

  if (env && env.JADUAL_KV) {
    try {
      const raw = await env.JADUAL_KV.get(PIN_CONFIG_KEY, { type: 'text' });
      if (raw) {
        const parsed = JSON.parse(raw);
        const kvPin = String((parsed && parsed.pin) || '').trim();
        if (kvPin) return provided === kvPin;
      }
    } catch {
      // ignore
    }
  }
  return provided === INITIAL_DEFAULT_PIN;
}

function decodeBase64DataUrl(dataUrl) {
  const match = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  const contentType = match[1];
  const base64 = match[2];
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return { contentType, bytes };
}

export async function onRequestGet(context) {
  const { env } = context;
  const bucket = getR2Bucket(env);

  if (!bucket) {
    return new Response(
      JSON.stringify({ error: 'R2_NOT_BOUND', message: 'Binding Cloudflare R2 (JADUAL_R2) belum dikonfigurasi.' }),
      { status: 404, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } }
    );
  }

  let objectKey = DEFAULT_LOGO_OBJECT_KEY;
  if (env && env.JADUAL_KV) {
    try {
      const raw = await env.JADUAL_KV.get(SETTINGS_KEY, { type: 'text' });
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.logoObjectKey) {
          objectKey = String(parsed.logoObjectKey);
        }
      }
    } catch {
      // ignore
    }
  }

  const obj = await bucket.get(objectKey);
  if (!obj) {
    return new Response(
      JSON.stringify({ error: 'LOGO_NOT_FOUND', message: 'Tiada logo kustom dimuat naik ke R2.' }),
      { status: 404, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } }
    );
  }

  const contentType =
    (obj.httpMetadata && obj.httpMetadata.contentType) || 'image/png';

  return new Response(obj.body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      Pragma: 'no-cache',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

export async function onRequestPost(context) {
  const { env, request } = context;
  const bucket = getR2Bucket(env);

  if (!bucket) {
    return new Response(
      JSON.stringify({
        error: 'R2_NOT_BOUND',
        message: 'Binding Cloudflare R2 (JADUAL_R2) belum dikonfigurasi pada Cloudflare Pages.'
      }),
      { status: 503, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
    );
  }

  if (!(await checkAdminPin(request, env))) {
    return new Response(
      JSON.stringify({ error: 'UNAUTHORIZED', message: 'PIN Admin tidak sah atau tidak dibekalkan.' }),
      { status: 401, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
    );
  }

  try {
    let bytes = null;
    let contentType = 'image/png';
    let filename = 'logo-politeknik.png';

    const reqCt = (request.headers.get('content-type') || '').toLowerCase();
    if (reqCt.includes('multipart/form-data')) {
      const formData = await request.formData();
      const file = formData.get('file');
      if (!file || typeof file === 'string') {
        return new Response(
          JSON.stringify({ error: 'NO_FILE', message: 'Tiada fail logo dipilih.' }),
          { status: 400, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
        );
      }
      contentType = file.type || 'image/png';
      filename = file.name || filename;
      bytes = new Uint8Array(await file.arrayBuffer());
    } else {
      const body = await request.json();
      const decoded = decodeBase64DataUrl(body.dataUrl);
      if (!decoded) {
        return new Response(
          JSON.stringify({ error: 'INVALID_IMAGE', message: 'Format imej tidak sah.' }),
          { status: 400, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
        );
      }
      contentType = body.contentType || decoded.contentType;
      filename = body.filename || filename;
      bytes = decoded.bytes;
    }

    const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/svg+xml', 'image/webp'];
    if (!allowedTypes.includes(contentType.toLowerCase())) {
      return new Response(
        JSON.stringify({ error: 'UNSUPPORTED_TYPE', message: 'Hanya fail PNG, JPG, SVG, atau WEBP dibenarkan.' }),
        { status: 400, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
      );
    }

    if (bytes.byteLength > 5 * 1024 * 1024) {
      return new Response(
        JSON.stringify({ error: 'FILE_TOO_LARGE', message: 'Saiz fail logo melebihi had 5MB.' }),
        { status: 400, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
      );
    }

    const objectKey = DEFAULT_LOGO_OBJECT_KEY;
    await bucket.put(objectKey, bytes, {
      httpMetadata: { contentType }
    });

    const version = Date.now();
    const logoUrl = `/api/logo?v=${version}`;

    let updatedSettings = {
      session: 'Sesi II: 2026/2027',
      deadline: '04 DIS 2026 (JUMAAT)',
      department: 'JABATAN KEJURUTERAAN MEKANIKAL',
      institutionName: 'POLITEKNIK KUCHING SARAWAK',
      logoUrl,
      logoFilename: filename,
      logoStorage: 'r2',
      logoObjectKey: objectKey,
      updatedAt: new Date(version).toISOString()
    };

    if (env && env.JADUAL_KV) {
      try {
        const raw = await env.JADUAL_KV.get(SETTINGS_KEY, { type: 'text' });
        if (raw) {
          updatedSettings = {
            ...JSON.parse(raw),
            logoUrl,
            logoFilename: filename,
            logoStorage: 'r2',
            logoObjectKey: objectKey,
            updatedAt: new Date(version).toISOString()
          };
        }
      } catch {
        // ignore
      }
      await env.JADUAL_KV.put(SETTINGS_KEY, JSON.stringify(updatedSettings));
    }

    return new Response(
      JSON.stringify({
        ok: true,
        logoUrl,
        settings: updatedSettings
      }),
      { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'R2_UPLOAD_ERROR', message: String(err) }),
      { status: 500, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
    );
  }
}

export async function onRequestDelete(context) {
  const { env, request } = context;
  const bucket = getR2Bucket(env);

  if (!(await checkAdminPin(request, env))) {
    return new Response(
      JSON.stringify({ error: 'UNAUTHORIZED', message: 'PIN Admin tidak sah atau tidak dibekalkan.' }),
      { status: 401, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
    );
  }

  try {
    if (bucket) {
      await bucket.delete(DEFAULT_LOGO_OBJECT_KEY);
    }

    let updatedSettings = {
      session: 'Sesi II: 2026/2027',
      deadline: '04 DIS 2026 (JUMAAT)',
      department: 'JABATAN KEJURUTERAAN MEKANIKAL',
      institutionName: 'POLITEKNIK KUCHING SARAWAK',
      logoUrl: '',
      logoFilename: '',
      logoStorage: 'default',
      logoObjectKey: '',
      updatedAt: new Date().toISOString()
    };

    if (env && env.JADUAL_KV) {
      try {
        const raw = await env.JADUAL_KV.get(SETTINGS_KEY, { type: 'text' });
        if (raw) {
          updatedSettings = {
            ...JSON.parse(raw),
            logoUrl: '',
            logoFilename: '',
            logoStorage: 'default',
            logoObjectKey: '',
            updatedAt: new Date().toISOString()
          };
        }
      } catch {
        // ignore
      }
      await env.JADUAL_KV.put(SETTINGS_KEY, JSON.stringify(updatedSettings));
    }

    return new Response(
      JSON.stringify({ ok: true, settings: updatedSettings }),
      { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'R2_DELETE_ERROR', message: String(err) }),
      { status: 500, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
    );
  }
}
