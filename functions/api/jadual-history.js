/**
 * Cloudflare Pages Function: GET /api/jadual-history
 *
 * Reads the upload history log (`<kv_key>_history`) pushed by the NiceGUI
 * desktop admin uploader (`ppkj_timetable_uploader_en.py`) from Cloudflare KV.
 */
export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const kvKey = url.searchParams.get('key') || 'jadual_induk_jkm';
  const historyKey = `${kvKey}_history`;

  try {
    if (!env || !env.JADUAL_KV) {
      return new Response(
        JSON.stringify({
          kvBound: false,
          error: 'KV_NOT_BOUND',
          message: 'Cloudflare KV binding JADUAL_KV is not configured on Pages.',
          logs: []
        }),
        {
          status: 404,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store'
          }
        }
      );
    }

    const rawHistory = await env.JADUAL_KV.get(historyKey, { type: 'text' });
    let logs = [];
    if (rawHistory) {
      try {
        const parsed = JSON.parse(rawHistory);
        if (Array.isArray(parsed)) {
          logs = parsed;
        }
      } catch {
        logs = [];
      }
    }

    return new Response(
      JSON.stringify({
        kvBound: true,
        key: historyKey,
        logs
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          'Pragma': 'no-cache',
          'Access-Control-Allow-Origin': '*'
        }
      }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({
        kvBound: Boolean(env && env.JADUAL_KV),
        error: 'KV_HISTORY_ERROR',
        message: String(err),
        logs: []
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store'
        }
      }
    );
  }
}
