/**
 * R2 snapshot helpers shared by /api/jadual and /api/jadual-backups.
 *
 * Every publish of the master timetable snapshots the previous KV value to R2
 * before overwriting it, keeping the newest BACKUP_RETENTION snapshots.
 */
export const BACKUP_PREFIX = 'backups/';
export const BACKUP_RETENTION = 20;
export const FALLBACK_PREFIX = 'fallback/';

export function getBackupBucket(env) {
  return (env && (env.JADUAL_R2 || env.R2_BUCKET)) || null;
}

export function backupObjectKey(kvKey, stamp) {
  return `${BACKUP_PREFIX}${kvKey}-${String(stamp).replace(/[:.]/g, '-')}.json`;
}

export async function pruneBackups(bucket, kvKey, retention = BACKUP_RETENTION) {
  const prefix = `${BACKUP_PREFIX}${kvKey}-`;
  const listed = await bucket.list({ prefix });
  const keys = (listed.objects || []).map((object) => object.key).sort();
  const excess = keys.length - retention;
  if (excess > 0) {
    await Promise.all(keys.slice(0, excess).map((key) => bucket.delete(key)));
  }
}

export async function snapshotBeforeOverwrite(env, kvKey, rawData) {
  const bucket = getBackupBucket(env);
  if (!bucket || !rawData) return null;

  const key = backupObjectKey(kvKey, new Date().toISOString());
  await bucket.put(key, rawData, {
    httpMetadata: { contentType: 'application/json; charset=utf-8' }
  });
  await pruneBackups(bucket, kvKey);
  return key;
}

export async function listBackups(env, kvKey) {
  const bucket = getBackupBucket(env);
  if (!bucket) return null;

  const listed = await bucket.list({ prefix: `${BACKUP_PREFIX}${kvKey}-` });
  return (listed.objects || [])
    .map((object) => ({ key: object.key, size: object.size, uploaded: object.uploaded }))
    .sort((a, b) => (a.key < b.key ? 1 : -1));
}

/**
 * Live mirror of the current master, served by /api/jadual-fallback when KV is
 * unavailable. Rewritten on every publish so the fallback never goes stale.
 */
export async function putFallbackMirror(env, kvKey, rawData) {
  const bucket = getBackupBucket(env);
  if (!bucket || !rawData) return null;

  const key = `${FALLBACK_PREFIX}${kvKey}.json`;
  await bucket.put(key, rawData, {
    httpMetadata: { contentType: 'application/json; charset=utf-8' }
  });
  return key;
}

export async function getFallbackMirror(env, kvKey) {
  const bucket = getBackupBucket(env);
  if (!bucket) return null;

  const object = await bucket.get(`${FALLBACK_PREFIX}${kvKey}.json`);
  return object ? object.text() : null;
}
