/**
 * Worker entry point for the Cloudflare deployment.
 *
 * Serves the built SPA from the ASSETS binding and routes /api/* to the
 * Pages-style request handlers in functions/api, so the same handler code
 * runs locally (Express in server.ts) and on Cloudflare.
 */
import * as jadual from '../functions/api/jadual.js';
import * as jadualHistory from '../functions/api/jadual-history.js';
import * as settings from '../functions/api/settings.js';
import * as logo from '../functions/api/logo.js';
import * as verifyPin from '../functions/api/verify-pin.js';
import * as adminPin from '../functions/api/admin-pin.js';
import * as extractPdf from '../functions/api/extract-pdf.js';

const ROUTES = {
  '/api/jadual': jadual,
  '/api/jadual-history': jadualHistory,
  '/api/settings': settings,
  '/api/logo': logo,
  '/api/verify-pin': verifyPin,
  '/api/admin-pin': adminPin,
  '/api/extract-pdf': extractPdf,
};

const METHOD_HANDLERS = {
  GET: 'onRequestGet',
  POST: 'onRequestPost',
  PUT: 'onRequestPut',
  PATCH: 'onRequestPatch',
  DELETE: 'onRequestDelete',
};

function jsonError(status, error, message) {
  return new Response(JSON.stringify({ error, message }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname;
    const handlers = ROUTES[path];

    if (!handlers) {
      if (path.startsWith('/api/')) {
        return jsonError(404, 'NOT_FOUND', `Tiada endpoint API untuk ${path}.`);
      }
      return env.ASSETS.fetch(request);
    }

    const handler = handlers[METHOD_HANDLERS[request.method]] || handlers.onRequest;
    if (!handler) {
      return jsonError(405, 'METHOD_NOT_ALLOWED', `Kaedah ${request.method} tidak disokong untuk ${path}.`);
    }

    return handler({
      request,
      env,
      params: {},
      data: {},
      functionPath: path,
      next: () => env.ASSETS.fetch(request),
      waitUntil: (promise) => ctx.waitUntil(promise),
    });
  },
};
