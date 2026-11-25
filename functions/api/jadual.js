/**
 * Cloudflare Function: GET & POST /api/jadual
 *
 * Reads and publishes the live master timetable JSON directly to/from Cloudflare KV.
 * Bindings (wrangler.jsonc / Cloudflare dashboard):
 *   KV Namespace Binding: JADUAL_KV
 *   R2 Bucket Binding:    JADUAL_R2 (versioned snapshots of the previous master)
 *   Optional Env Secret:  ADMIN_PASSCODE (if set, POST requires matching X-Admin-Passcode)
 */
import { snapshotBeforeOverwrite, putFallbackMirror } from './_backup.js';
import { loadCanonicalCourses, applyCanonicalCourseNames } from './_courseNames.js';

const DEFAULT_KEY = 'jadual_induk_jkm';
const PIN_CONFIG_KEY = 'admin_pin_config';
const INITIAL_DEFAULT_PIN = '2026';

export async function checkAdminPin(request, env) {
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
      // ignore malformed KV entry
    }
  }

  return provided === INITIAL_DEFAULT_PIN;
}

function computeVersionTag(rawData) {
  let hash = 2166136261;
  for (let i = 0; i < rawData.length; i++) {
    hash ^= rawData.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `"kv-${rawData.length}-${(hash >>> 0).toString(16)}"`;
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const kvKey = url.searchParams.get('key') || DEFAULT_KEY;

  try {
    if (!env || !env.JADUAL_KV) {
      return new Response(
        JSON.stringify({
          error: 'KV_NOT_BOUND',
          message: 'Cloudflare KV binding JADUAL_KV is not configured on Pages.'
        }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        }
      );
    }

    const rawData = await env.JADUAL_KV.get(kvKey, { type: 'text' });
    if (!rawData) {
      return new Response(
        JSON.stringify({
          error: 'KEY_NOT_FOUND',
          message: `No timetable data found in KV for key '${kvKey}'.`
        }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        }
      );
    }

    const versionTag = computeVersionTag(rawData);

    return new Response(rawData, {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        Pragma: 'no-cache',
        ETag: versionTag,
        'X-Timetable-Version': versionTag,
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers': 'ETag, X-Timetable-Version'
      }
    });
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: 'KV_READ_ERROR',
        message: String(err)
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      }
    );
  }
}

export async function onRequestPost(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const kvKey = url.searchParams.get('key') || DEFAULT_KEY;
  const historyKey = `${kvKey}_history`;

  try {
    if (!env || !env.JADUAL_KV) {
      return new Response(
        JSON.stringify({
          error: 'KV_NOT_BOUND',
          message: 'Binding Cloudflare KV (JADUAL_KV) belum dikonfigurasi pada Cloudflare Pages.'
        }),
        {
          status: 503,
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        }
      );
    }

    if (!(await checkAdminPin(request, env))) {
      return new Response(
        JSON.stringify({
          error: 'UNAUTHORIZED',
          message: 'PIN Admin tidak sah atau tidak dibekalkan.'
        }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        }
      );
    }

    const body = await request.json();
    const rawEntries = Array.isArray(body) ? body : body && Array.isArray(body.entries) ? body.entries : null;

    if (!rawEntries || rawEntries.length === 0) {
      return new Response(
        JSON.stringify({
          error: 'INVALID_PAYLOAD',
          message: 'Senarai slot jadual tidak boleh kosong.'
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        }
      );
    }

    // Course names/credits are re-derived from the curriculum so a stale catalogue
    // or a shifted OCR/JSON column can never publish wrong names to the master.
    let canonical = {};
    try {
      canonical = await loadCanonicalCourses(env, request);
    } catch {
      canonical = {};
    }
    const named = applyCanonicalCourseNames(rawEntries, canonical);
    const entries = named.entries;

    let previousSlots = 0;
    let existingRaw = null;
    try {
      existingRaw = await env.JADUAL_KV.get(kvKey, { type: 'text' });
      if (existingRaw) {
        const parsedExisting = JSON.parse(existingRaw);
        if (Array.isArray(parsedExisting)) {
          previousSlots = parsedExisting.length;
        }
      }
    } catch {
      previousSlots = 0;
    }

    // Keep a restorable copy of the current master before replacing it.
    let backupKey = null;
    if (existingRaw) {
      try {
        backupKey = await snapshotBeforeOverwrite(env, kvKey, existingRaw);
      } catch {
        backupKey = null;
      }
    }

    const serialized = JSON.stringify(entries);
    await env.JADUAL_KV.put(kvKey, serialized);

    // Refresh the R2 fallback mirror so /api/jadual-fallback tracks KV.
    try {
      await putFallbackMirror(env, kvKey, serialized);
    } catch {
      // mirror refresh is best-effort; publishing must still succeed
    }

    const cohortsCount = new Set(entries.map((r) => String(r.Cohort || '').trim()).filter(Boolean)).size;
    const timestamp = new Date().toISOString();
    const source = (body && body.source) || 'web_pdf_upload';
    const filename = (body && body.filename) || 'jadual_induk_jkm.pdf';
    const engineLabel = (body && body.engineLabel) || 'Cloudflare Web Upload';

    // Store only the latest change log record
    const latestEntry = {
      id: `cf_${Date.now()}`,
      timestamp,
      source,
      filename,
      previousSlots,
      newSlots: entries.length,
      deltaSlots: entries.length - previousSlots,
      cohortsCount,
      namesCorrected: named.namesCorrected,
      creditsCorrected: named.creditsCorrected,
      unknownCourseCodes: named.unknownCodes.slice(0, 20),
      engineLabel,
      backupKey
    };

    await env.JADUAL_KV.put(historyKey, JSON.stringify([latestEntry]));

    return new Response(
      JSON.stringify({
        ok: true,
        kvKey,
        slotsCount: entries.length,
        cohortsCount,
        namesCorrected: named.namesCorrected,
        creditsCorrected: named.creditsCorrected,
        unknownCourseCodes: named.unknownCodes.slice(0, 20),
        backupKey,
        latestLog: latestEntry
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
        error: 'KV_WRITE_ERROR',
        message: String(err)
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      }
    );
  }
}
