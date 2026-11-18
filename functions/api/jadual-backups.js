/**
 * Cloudflare Function: GET & POST /api/jadual-backups
 *
 * GET  ?key=jadual_induk_jkm        -> list R2 snapshots (newest first)
 * POST { key } or ?backup=<r2_key>  -> restore a snapshot back into KV
 *
 * Both require the admin PIN (X-Admin-Pin / X-Admin-Passcode).
 * Snapshots are written by POST /api/jadual before each publish.
 */
import { checkAdminPin } from './jadual.js';
import { getBackupBucket, listBackups, snapshotBeforeOverwrite, putFallbackMirror, BACKUP_PREFIX } from './_backup.js';

const DEFAULT_KEY = 'jadual_induk_jkm';
const HISTORY_SUFFIX = '_history';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const kvKey = url.searchParams.get('key') || DEFAULT_KEY;

  if (!(await checkAdminPin(request, env))) {
    return jsonResponse({ error: 'UNAUTHORIZED', message: 'PIN Admin tidak sah atau tidak dibekalkan.' }, 401);
  }

  try {
    const backups = await listBackups(env, kvKey);
    if (backups === null) {
      return jsonResponse(
        {
          error: 'R2_NOT_BOUND',
          message: 'Binding Cloudflare R2 (JADUAL_R2) belum dikonfigurasi, jadi tiada sandaran tersimpan.'
        },
        503
      );
    }
    return jsonResponse({ ok: true, kvKey, count: backups.length, backups });
  } catch (err) {
    return jsonResponse({ error: 'R2_LIST_ERROR', message: String(err) }, 500);
  }
}

export async function onRequestPost(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const kvKey = url.searchParams.get('key') || DEFAULT_KEY;

  if (!(await checkAdminPin(request, env))) {
    return jsonResponse({ error: 'UNAUTHORIZED', message: 'PIN Admin tidak sah atau tidak dibekalkan.' }, 401);
  }

  const bucket = getBackupBucket(env);
  if (!bucket) {
    return jsonResponse(
      { error: 'R2_NOT_BOUND', message: 'Binding Cloudflare R2 (JADUAL_R2) belum dikonfigurasi.' },
      503
    );
  }

  try {
    const body = await request.json().catch(() => ({}));
    const backupKey = String(url.searchParams.get('backup') || (body && body.backupKey) || '').trim();

    if (!backupKey.startsWith(BACKUP_PREFIX) || !backupKey.includes(`${kvKey}-`)) {
      return jsonResponse(
        { error: 'INVALID_BACKUP_KEY', message: 'Kunci sandaran tidak sah untuk jadual ini.' },
        400
      );
    }

    const object = await bucket.get(backupKey);
    if (!object) {
      return jsonResponse({ error: 'BACKUP_NOT_FOUND', message: `Tiada sandaran ${backupKey}.` }, 404);
    }

    const rawData = await object.text();
    const parsed = JSON.parse(rawData);
    const restoredEntries = Array.isArray(parsed) ? parsed : Array.isArray(parsed && parsed.entries) ? parsed.entries : null;

    if (!restoredEntries || restoredEntries.length === 0) {
      return jsonResponse({ error: 'INVALID_BACKUP_PAYLOAD', message: 'Sandaran tidak mengandungi slot jadual.' }, 400);
    }

    if (!env || !env.JADUAL_KV) {
      return jsonResponse({ error: 'KV_NOT_BOUND', message: 'Binding Cloudflare KV (JADUAL_KV) belum dikonfigurasi.' }, 503);
    }

    // Snapshot the current master first so the restore itself is reversible.
    let rollbackKey = null;
    try {
      const currentRaw = await env.JADUAL_KV.get(kvKey, { type: 'text' });
      if (currentRaw) rollbackKey = await snapshotBeforeOverwrite(env, kvKey, currentRaw);
    } catch {
      rollbackKey = null;
    }

    const serialized = JSON.stringify(restoredEntries);
    await env.JADUAL_KV.put(kvKey, serialized);

    try {
      await putFallbackMirror(env, kvKey, serialized);
    } catch {
      // mirror refresh is best-effort; the restore must still succeed
    }

    const cohortsCount = new Set(
      restoredEntries.map((row) => String((row && row.Cohort) || '').trim()).filter(Boolean)
    ).size;
    const timestamp = new Date().toISOString();
    const latestEntry = {
      id: `cf_restore_${Date.now()}`,
      timestamp,
      source: 'r2_restore',
      filename: backupKey,
      previousSlots: restoredEntries.length,
      newSlots: restoredEntries.length,
      deltaSlots: 0,
      cohortsCount,
      engineLabel: 'Pemulihan Sandaran R2',
      backupKey: rollbackKey
    };

    await env.JADUAL_KV.put(`${kvKey}${HISTORY_SUFFIX}`, JSON.stringify([latestEntry]));

    return jsonResponse({
      ok: true,
      kvKey,
      restoredFrom: backupKey,
      slotsCount: restoredEntries.length,
      cohortsCount,
      rollbackKey,
      latestLog: latestEntry
    });
  } catch (err) {
    return jsonResponse({ error: 'R2_RESTORE_ERROR', message: String(err) }, 500);
  }
}
