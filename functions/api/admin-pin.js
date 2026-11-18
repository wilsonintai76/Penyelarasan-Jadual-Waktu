/**
 * Cloudflare Pages Function: POST /api/admin-pin
 *
 * Allows an authenticated coordinator to update the Admin PIN stored in Cloudflare KV.
 * If ADMIN_PIN or ADMIN_PASSCODE is locked via Cloudflare Environment Secrets,
 * returns 409 so environment-level secrets take precedence.
 */
const PIN_CONFIG_KEY = 'admin_pin_config';
const INITIAL_DEFAULT_PIN = '2026';

async function resolveExpectedPin(env) {
  const envPin = String((env && (env.ADMIN_PIN || env.ADMIN_PASSCODE)) || '').trim();
  if (envPin) {
    return { pin: envPin, source: 'env' };
  }

  if (env && env.JADUAL_KV) {
    try {
      const raw = await env.JADUAL_KV.get(PIN_CONFIG_KEY, { type: 'text' });
      if (raw) {
        const parsed = JSON.parse(raw);
        const kvPin = String((parsed && parsed.pin) || '').trim();
        if (kvPin) {
          return { pin: kvPin, source: 'kv' };
        }
      }
    } catch {
      // ignore
    }
  }

  return { pin: INITIAL_DEFAULT_PIN, source: 'default' };
}

export async function onRequestPost(context) {
  const { env, request } = context;

  try {
    if (!env || !env.JADUAL_KV) {
      return new Response(
        JSON.stringify({
          error: 'KV_NOT_BOUND',
          message: 'Binding Cloudflare KV (JADUAL_KV) diperlukan untuk menyimpan PIN baharu.'
        }),
        { status: 503, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
      );
    }

    const expected = await resolveExpectedPin(env);
    if (expected.source === 'env') {
      return new Response(
        JSON.stringify({
          error: 'ENV_PIN_LOCKED',
          message: 'PIN dikawal oleh Cloudflare Environment Secret (ADMIN_PIN / ADMIN_PASSCODE). Sila ubah melalui papan pemuka Cloudflare.'
        }),
        { status: 409, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
      );
    }

    const body = await request.json().catch(() => ({}));
    const currentPin = String(
      body.currentPin ||
        request.headers.get('X-Admin-Passcode') ||
        request.headers.get('X-Admin-Pin') ||
        ''
    ).trim();
    const newPin = String(body.newPin || '').trim();

    if (currentPin !== expected.pin) {
      return new Response(
        JSON.stringify({ error: 'UNAUTHORIZED', message: 'PIN Admin semasa tidak sah.' }),
        { status: 401, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
      );
    }

    if (newPin.length < 4 || newPin.length > 12) {
      return new Response(
        JSON.stringify({
          error: 'INVALID_NEW_PIN',
          message: 'PIN baharu mestilah antara 4 hingga 12 aksara/digit.'
        }),
        { status: 400, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
      );
    }

    await env.JADUAL_KV.put(
      PIN_CONFIG_KEY,
      JSON.stringify({ pin: newPin, updatedAt: new Date().toISOString() })
    );

    return new Response(
      JSON.stringify({
        ok: true,
        message: 'PIN Admin baharu berjaya dikemas kini di Cloudflare KV.'
      }),
      { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'PIN_UPDATE_ERROR', message: String(err) }),
      { status: 500, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
    );
  }
}
