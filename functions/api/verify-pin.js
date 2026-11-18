/**
 * Cloudflare Function: POST /api/verify-pin
 *
 * Verifies the Coordinator/Admin PIN without exposing the secret PIN to the browser.
 * Priority: env.ADMIN_PIN / env.ADMIN_PASSCODE -> KV key 'admin_pin_config' -> initial default PIN.
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
      // ignore malformed KV entry
    }
  }

  return { pin: INITIAL_DEFAULT_PIN, source: 'default' };
}

export async function onRequestPost(context) {
  const { env, request } = context;

  try {
    const body = await request.json().catch(() => ({}));
    const provided = String(
      body.pin ||
        request.headers.get('X-Admin-Passcode') ||
        request.headers.get('X-Admin-Pin') ||
        ''
    ).trim();

    if (!provided) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'PIN_REQUIRED',
          message: 'Sila masukkan PIN Admin.'
        }),
        { status: 400, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
      );
    }

    const expected = await resolveExpectedPin(env);
    if (provided !== expected.pin) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'INVALID_PIN',
          message: 'PIN Admin tidak sah. Sila cuba lagi.'
        }),
        { status: 401, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        pinSource: expected.source
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
      JSON.stringify({ ok: false, error: 'VERIFY_ERROR', message: String(err) }),
      { status: 500, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
    );
  }
}
