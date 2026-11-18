/**
 * Cloudflare Function: GET /api/jadual-fallback
 *
 * Serves the timetable used when Cloudflare KV cannot answer. The R2 mirror is
 * rewritten on every publish (and restore) by /api/jadual, so this fallback
 * always reflects the latest upload. If the mirror has not been seeded yet, the
 * bundled /data/jadual.json snapshot is served instead.
 */
import { getFallbackMirror } from './_backup.js';

const DEFAULT_KEY = 'jadual_induk_jkm';

function respond(body, source) {
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'X-Fallback-Source': source,
      'Access-Control-Allow-Origin': '*'
    }
  });
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const kvKey = url.searchParams.get('key') || DEFAULT_KEY;

  let mirror = null;
  try {
    mirror = await getFallbackMirror(env, kvKey);
  } catch {
    mirror = null;
  }

  if (mirror) {
    return respond(mirror, 'r2-mirror');
  }

  try {
    const assetUrl = new URL('/data/jadual.json', url);
    const asset = await env.ASSETS.fetch(new Request(assetUrl.toString()));
    if (asset.ok) {
      return respond(await asset.text(), 'bundled-snapshot');
    }
  } catch {
    // fall through to the error below
  }

  return new Response(
    JSON.stringify({
      error: 'FALLBACK_NOT_AVAILABLE',
      message: 'Tiada sandaran jadual tersedia (R2 mirror dan snapshot binaan kosong).'
    }),
    { status: 404, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } }
  );
}
