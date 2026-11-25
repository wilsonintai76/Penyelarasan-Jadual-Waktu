/**
 * Canonical course names, merged from every programme curriculum.
 *
 * The master timetable is uploaded from PDFs or JSON files whose course-name
 * column can be stale, truncated or shifted by one row. Names are therefore
 * re-derived from the curriculum (KV override first, bundled asset second)
 * whenever a slot is published, so `jadual_induk_jkm` never stores a name from
 * an old catalogue while the curriculum has the current one.
 */
const CURRICULUM_PREFIX = 'curriculum_';
const DEFAULT_PROGRAMMES = ['DKM', 'DAD', 'DPU', 'DTP'];

export function normalizeCourseCode(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/\s+/g, '');
}

function isValidCurriculum(value) {
  return Boolean(
    value && typeof value === 'object' && value.courses && typeof value.courses === 'object'
  );
}

async function listKvProgrammes(env) {
  if (!env || !env.JADUAL_KV || typeof env.JADUAL_KV.list !== 'function') return [];
  const codes = new Set();
  let cursor;
  for (let page = 0; page < 10; page += 1) {
    const result = await env.JADUAL_KV.list({ prefix: CURRICULUM_PREFIX, cursor });
    (result.keys || []).forEach(key => {
      const code = String(key.name || '').slice(CURRICULUM_PREFIX.length).trim().toUpperCase();
      if (/^[A-Z]{2,5}$/.test(code)) codes.add(code);
    });
    if (result.list_complete) break;
    cursor = result.cursor;
    if (!cursor) break;
  }
  return Array.from(codes);
}

async function readCurriculum(env, request, programme) {
  let document = null;
  if (env && env.JADUAL_KV) {
    try {
      const raw = await env.JADUAL_KV.get(`${CURRICULUM_PREFIX}${programme}`, { type: 'text' });
      if (raw) {
        const parsed = JSON.parse(raw);
        const curriculum = parsed && parsed.curriculum ? parsed.curriculum : parsed;
        if (isValidCurriculum(curriculum)) document = curriculum;
      }
    } catch {
      // fall through to the bundled asset
    }
  }
  let asset = null;
  if (env && env.ASSETS && request) {
    try {
      const assetUrl = new URL(`/assets/curriculum/${programme.toLowerCase()}.json`, request.url);
      const res = await env.ASSETS.fetch(new Request(assetUrl.toString()));
      if (res.ok) {
        const parsed = await res.json();
        if (isValidCurriculum(parsed)) asset = parsed;
      }
    } catch {
      // no bundled document for this programme
    }
  }
  const source = document || asset;
  if (!source) return null;

  // Code aliases are curated in the bundled asset, so a KV override published before
  // the mapping existed must not lose it.
  const assetAliases = (asset && asset.meta && asset.meta.codeAliases) || {};
  const ownAliases = (source.meta && source.meta.codeAliases) || {};
  if (Object.keys(ownAliases).length === 0 && Object.keys(assetAliases).length > 0) {
    return { ...source, meta: { ...source.meta, codeAliases: { ...assetAliases } } };
  }
  return source;
}

/**
 * @returns {Promise<Record<string, { name: string, credit: number|null }>>}
 */
export async function loadCanonicalCourses(env, request) {
  const programmes = Array.from(new Set([...DEFAULT_PROGRAMMES, ...(await listKvProgrammes(env))]));
  const map = {};

  for (const programme of programmes) {
    const curriculum = await readCurriculum(env, request, programme);
    const courses = (curriculum && curriculum.courses) || {};
    Object.entries(courses).forEach(([code, course]) => {
      const key = normalizeCourseCode(code);
      if (!key || map[key]) return;
      const name = String((course && course.name) || '').trim();
      if (!name) return;
      const credit = Number(course && course.credit);
      map[key] = { name, credit: Number.isFinite(credit) && credit > 0 ? credit : null };
    });

    // Codes printed on a timetable that belong to a curriculum course under another
    // code (e.g. DBS10082 on the sheet vs DBS10042 in the Programme Information).
    Object.entries((curriculum && curriculum.meta && curriculum.meta.codeAliases) || {}).forEach(
      ([alias, official]) => {
        const aliasKey = normalizeCourseCode(alias);
        const officialKey = normalizeCourseCode(official);
        if (!aliasKey || !officialKey || aliasKey === officialKey || map[aliasKey]) return;
        const target = map[officialKey];
        if (target) map[aliasKey] = { ...target };
      }
    );
  }

  // Codes outside every curriculum (co-curriculum MPU24xxx, programme-specific electives)
  // still have an official name in the shared catalogue asset.
  if (env && env.ASSETS && request) {
    try {
      const assetUrl = new URL('/assets/course_catalog.json', request.url);
      const res = await env.ASSETS.fetch(new Request(assetUrl.toString()));
      if (res.ok) {
        const catalog = await res.json();
        Object.entries(catalog || {}).forEach(([code, name]) => {
          const key = normalizeCourseCode(code);
          const value = String(name || '').trim();
          if (key && value && !map[key]) map[key] = { name: value, credit: null };
        });
      }
    } catch {
      // catalogue is optional
    }
  }

  return map;
}

/**
 * Rewrites `Course_Name` (and a missing/invalid `Credit`) from the curriculum and the
 * catalogue. Slots whose code is unknown keep the uploaded values.
 */
export function applyCanonicalCourseNames(entries, canonical) {
  let namesCorrected = 0;
  let creditsCorrected = 0;
  const unknownCodes = new Set();

  const normalized = entries.map(entry => {
    const code = normalizeCourseCode(entry && entry.Course_Code);
    const match = code && canonical ? canonical[code] : null;
    if (!code) return entry;

    const next = { ...entry, Course_Code: code };

    if (!match) {
      unknownCodes.add(code);
      return next;
    }

    const uploadedName = String(entry.Course_Name || '').trim();
    if (match.name && uploadedName !== match.name) {
      next.Course_Name = match.name;
      namesCorrected += 1;
    }

    const credit = Number(entry.Credit);
    if (match.credit && (!Number.isFinite(credit) || credit < 1 || credit > 8)) {
      next.Credit = match.credit;
      creditsCorrected += 1;
    }

    return next;
  });

  return {
    entries: normalized,
    namesCorrected,
    creditsCorrected,
    unknownCodes: Array.from(unknownCodes).sort()
  };
}
