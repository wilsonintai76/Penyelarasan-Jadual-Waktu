/**
 * Cloudflare Function: GET /api/version
 *
 * Reports the app version deployed to this Worker. The values are injected at
 * deploy time by scripts/deploy.mjs (--var APP_VERSION / APP_BUILT_AT) using the
 * version in package.json.
 */
export async function onRequestGet(context) {
  const { env } = context;

  return new Response(
    JSON.stringify({
      ok: true,
      version: (env && env.APP_VERSION) || 'dev',
      builtAt: (env && env.APP_BUILT_AT) || null,
      runtime: 'cloudflare-workers'
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Access-Control-Allow-Origin': '*'
      }
    }
  );
}
