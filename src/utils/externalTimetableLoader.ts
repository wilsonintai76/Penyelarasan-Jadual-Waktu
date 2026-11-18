import {
  MasterTimetableEntry,
  SystemSettings,
  TimetableChangeLogEntry,
  TimetableChangeSource
} from '../types';

export type ExternalSourceType =
  | 'cloudflare_kv'
  | 'google_sheets_csv'
  | 'external_json'
  | 'none';

export interface ExternalSourceManifest {
  googleSheetsCsvUrl?: string;
  jsonFallbackUrl?: string;
  cloudflareKvEndpoint?: string;
  notes?: string;
}

export interface ExternalTimetableFetchResult {
  entries: MasterTimetableEntry[];
  activeSource: ExternalSourceType;
  sourceLabel: string;
  sourceUrl: string;
  kvBound: boolean;
  latestRemoteLog: TimetableChangeLogEntry | null;
  errorMessage?: string;
}

export const TIMETABLE_CSV_HEADER =
  'Cohort,Course_Code,Course_Name,Credit,Day,Start_Time,End_Time,Venue,Lecturer';

export const TIMETABLE_CSV_TEMPLATE = [
  TIMETABLE_CSV_HEADER,
  'DKM1-S1,DJJ10243,Workshop Technology,3,Isnin,08:00,11:00,BENGKEL,JANN',
  'DKM1-S1,DJJ10223,Engineering Drawing,3,Isnin,14:00,17:00,M11COM,JLOY',
  'DKM2-S1,DJJ20263,Thermodynamics,3,Isnin,08:00,10:00,BK21 (J),JAAR',
  'DKM3-S1,DJJ30323,"Strength of Materials, Lab & Tutorial",3,Khamis,10:00,12:00,BK40 (J),JNZL'
].join('\n');

const DAY_MAP: Record<string, MasterTimetableEntry['Day']> = {
  isnin: 'Isnin',
  isn: 'Isnin',
  mon: 'Isnin',
  monday: 'Isnin',
  selasa: 'Selasa',
  sel: 'Selasa',
  tue: 'Selasa',
  tues: 'Selasa',
  tuesday: 'Selasa',
  rabu: 'Rabu',
  rab: 'Rabu',
  wed: 'Rabu',
  wednesday: 'Rabu',
  khamis: 'Khamis',
  kha: 'Khamis',
  thu: 'Khamis',
  thur: 'Khamis',
  thurs: 'Khamis',
  thursday: 'Khamis',
  jumaat: 'Jumaat',
  jum: 'Jumaat',
  fri: 'Jumaat',
  friday: 'Jumaat'
};

export function normalizeDayName(raw: unknown): string {
  const cleaned = String(raw ?? '').trim();
  if (!cleaned) return '';
  const mapped = DAY_MAP[cleaned.toLowerCase()];
  return mapped || cleaned;
}

export function normalizeTimeHHMM(raw: unknown): string {
  const s = String(raw ?? '').trim().toUpperCase();
  if (!s) return '';

  // Match HH:MM or H:MM or H.MM with optional AM/PM
  const match = s.match(/^(\d{1,2})[:.](\d{2})(?::\d{2})?\s*(AM|PM)?$/);
  if (!match) return s;

  let hour = parseInt(match[1], 10);
  const minute = parseInt(match[2], 10);
  const meridiem = match[3];

  if (Number.isNaN(hour) || Number.isNaN(minute) || minute < 0 || minute > 59) {
    return s;
  }

  if (meridiem === 'PM' && hour < 12) {
    hour += 12;
  } else if (meridiem === 'AM' && hour === 12) {
    hour = 0;
  }

  if (hour < 0 || hour > 23) return s;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function normalizeGoogleSheetsCsvUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';

  // Already a published CSV or gviz CSV endpoint
  if (
    trimmed.includes('output=csv') ||
    trimmed.includes('format=csv') ||
    trimmed.includes('tqx=out:csv')
  ) {
    return trimmed;
  }

  // Published web HTML link (/d/e/<pubId>/pubhtml -> /d/e/<pubId>/pub?output=csv)
  if (trimmed.includes('/pubhtml')) {
    return trimmed.replace(/\/pubhtml(\?.*)?$/, (_m, qs) => {
      if (!qs) return '/pub?output=csv';
      return `/pub${qs}&output=csv`;
    });
  }

  // Standard Google Sheets share/edit URL (/spreadsheets/d/<id>/...)
  const idMatch = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (idMatch && idMatch[1]) {
    const gidMatch = trimmed.match(/[?&#]gid=(\d+)/);
    const gidParam = gidMatch ? `&gid=${gidMatch[1]}` : '';
    return `https://docs.google.com/spreadsheets/d/${idMatch[1]}/export?format=csv${gidParam}`;
  }

  return trimmed;
}

function appendCacheBuster(url: string, ts: number): string {
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}t=${ts}`;
}

/**
 * RFC-4180 compliant CSV parser supporting quoted fields, embedded commas,
 * escaped quotes (""), and LF/CRLF line endings.
 */
function parseCsvRows(csvText: string): string[][] {
  const text = csvText.replace(/^\uFEFF/, ''); // Strip UTF-8 BOM if present
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          currentField += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        currentField += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      currentRow.push(currentField.trim());
      currentField = '';
    } else if (ch === '\r') {
      if (text[i + 1] === '\n') {
        i++;
      }
      currentRow.push(currentField.trim());
      if (currentRow.some(cell => cell !== '')) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentField = '';
    } else if (ch === '\n') {
      currentRow.push(currentField.trim());
      if (currentRow.some(cell => cell !== '')) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentField = '';
    } else {
      currentField += ch;
    }
  }

  currentRow.push(currentField.trim());
  if (currentRow.some(cell => cell !== '')) {
    rows.push(currentRow);
  }

  return rows;
}

function normalizeHeaderKey(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const HEADER_ALIASES: Record<string, keyof MasterTimetableEntry> = {
  cohort: 'Cohort',
  seksyen: 'Cohort',
  section: 'Cohort',
  kelas: 'Cohort',
  class: 'Cohort',
  coursecode: 'Course_Code',
  kod: 'Course_Code',
  kodkursus: 'Course_Code',
  code: 'Course_Code',
  coursename: 'Course_Name',
  namakursus: 'Course_Name',
  nama: 'Course_Name',
  kursus: 'Course_Name',
  subject: 'Course_Name',
  credit: 'Credit',
  kredit: 'Credit',
  jamkredit: 'Credit',
  credithour: 'Credit',
  day: 'Day',
  hari: 'Day',
  starttime: 'Start_Time',
  mula: 'Start_Time',
  masamula: 'Start_Time',
  start: 'Start_Time',
  endtime: 'End_Time',
  tamat: 'End_Time',
  masatamat: 'End_Time',
  end: 'End_Time',
  venue: 'Venue',
  bilik: 'Venue',
  lokasi: 'Venue',
  makmal: 'Venue',
  room: 'Venue',
  lecturer: 'Lecturer',
  pensyarah: 'Lecturer',
  pengajar: 'Lecturer',
  status: 'Status'
};

export function normalizeExternalEntries(raw: unknown): MasterTimetableEntry[] {
  let list: unknown[] = [];

  if (Array.isArray(raw)) {
    list = raw;
  } else if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.entries)) list = obj.entries;
    else if (Array.isArray(obj.data)) list = obj.data;
    else if (Array.isArray(obj.timetable)) list = obj.timetable;
  }

  const normalized: MasterTimetableEntry[] = [];

  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;

    const cohort = String(
      rec.Cohort ?? rec.cohort ?? rec.Seksyen ?? rec.seksyen ?? rec.Kelas ?? ''
    ).trim();
    const courseCode = String(
      rec.Course_Code ?? rec.course_code ?? rec.CourseCode ?? rec.Kod ?? rec.Code ?? ''
    )
      .trim()
      .toUpperCase();
    const courseName =
      String(
        rec.Course_Name ?? rec.course_name ?? rec.CourseName ?? rec.Nama ?? rec.Kursus ?? ''
      ).trim() || (courseCode ? `Course ${courseCode}` : '');
    const creditNum = Number(rec.Credit ?? rec.credit ?? rec.Kredit ?? 3);
    const day = normalizeDayName(rec.Day ?? rec.day ?? rec.Hari ?? '');
    const startTime = normalizeTimeHHMM(
      rec.Start_Time ?? rec.start_time ?? rec.StartTime ?? rec.Mula ?? ''
    );
    const endTime = normalizeTimeHHMM(
      rec.End_Time ?? rec.end_time ?? rec.EndTime ?? rec.Tamat ?? ''
    );
    const venue = String(rec.Venue ?? rec.venue ?? rec.Bilik ?? rec.Lokasi ?? '-').trim() || '-';
    const lecturer =
      String(rec.Lecturer ?? rec.lecturer ?? rec.Pensyarah ?? '-').trim() || '-';
    const status = String(rec.Status ?? rec.status ?? 'D').trim() || 'D';

    if (!cohort || !courseCode || !day || !startTime || !endTime) {
      continue;
    }

    normalized.push({
      Cohort: cohort,
      Course_Code: courseCode,
      Course_Name: courseName,
      Credit: Number.isFinite(creditNum) && creditNum > 0 ? creditNum : 3,
      Day: day,
      Start_Time: startTime,
      End_Time: endTime,
      Venue: venue,
      Lecturer: lecturer,
      Status: status
    });
  }

  return normalized;
}

export function parseTimetableCSV(csvText: string): MasterTimetableEntry[] {
  const rows = parseCsvRows(csvText);
  if (rows.length < 2) return [];

  const headerRow = rows[0];
  const columnMap: Array<keyof MasterTimetableEntry | null> = headerRow.map(h => {
    const key = normalizeHeaderKey(h);
    return HEADER_ALIASES[key] || null;
  });

  // Require at least Cohort, Course_Code, Day, Start_Time, End_Time columns
  const hasCoreColumns =
    columnMap.includes('Cohort') &&
    columnMap.includes('Course_Code') &&
    columnMap.includes('Day') &&
    columnMap.includes('Start_Time') &&
    columnMap.includes('End_Time');

  if (!hasCoreColumns) return [];

  const objects: Record<string, string>[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every(c => !c)) continue;
    const obj: Record<string, string> = {};
    columnMap.forEach((field, idx) => {
      if (field && row[idx] !== undefined) {
        obj[field] = row[idx];
      }
    });
    objects.push(obj);
  }

  return normalizeExternalEntries(objects);
}

async function readExternalSourceManifest(now: number): Promise<ExternalSourceManifest> {
  try {
    const res = await fetch(`/timetable-source.json?t=${now}`, { cache: 'no-store' });
    const ct = res.headers.get('content-type') || '';
    if (res.ok && ct.includes('application/json')) {
      const json = (await res.json()) as ExternalSourceManifest;
      return json || {};
    }
  } catch {
    // Ignore missing manifest and rely on defaults / env vars
  }
  return {};
}

export async function fetchLatestExternalTimetable(): Promise<ExternalTimetableFetchResult> {
  const now = Date.now();
  const manifest = await readExternalSourceManifest(now);

  const kvEndpoint = (manifest.cloudflareKvEndpoint || '/api/jadual').trim() || '/api/jadual';
  const envCsvUrl = (import.meta.env.VITE_TIMETABLE_CSV_URL || '').trim();
  const rawCsvUrl = envCsvUrl || (manifest.googleSheetsCsvUrl || '').trim();
  const googleCsvUrl = rawCsvUrl ? normalizeGoogleSheetsCsvUrl(rawCsvUrl) : '';

  const envJsonUrl = (import.meta.env.VITE_TIMETABLE_JSON_URL || '').trim();
  const jsonFallbackUrl =
    envJsonUrl || (manifest.jsonFallbackUrl || '').trim() || '/api/jadual-fallback';

  let kvBound = false;
  let latestRemoteLog: TimetableChangeLogEntry | null = null;

  // 1. Primary: Cloudflare KV (/api/jadual + /api/jadual-history)
  try {
    const [kvRes, histRes] = await Promise.all([
      fetch(appendCacheBuster(kvEndpoint, now), { cache: 'no-store' }),
      fetch(`/api/jadual-history?t=${now}`, { cache: 'no-store' }).catch(() => null)
    ]);

    if (histRes && histRes.ok) {
      const histCt = histRes.headers.get('content-type') || '';
      if (histCt.includes('application/json')) {
        const histJson = await histRes.json();
        if (histJson && histJson.kvBound) {
          kvBound = true;
        }
        if (histJson && Array.isArray(histJson.logs) && histJson.logs.length > 0) {
          const top = histJson.logs[0];
          const prevSlots = Number(top.previousSlots ?? 0);
          const newSlots = Number(top.newSlots ?? 0);
          const remoteSource = String(top.source || 'desktop_kv') as TimetableChangeSource;
          latestRemoteLog = {
            id: String(top.id || `kv_${top.timestamp || now}`),
            timestamp: String(top.timestamp || new Date().toISOString()),
            source: remoteSource,
            filename: top.filename ? String(top.filename) : 'Muat Naik Web / KV',
            previousSlots: prevSlots,
            newSlots,
            deltaSlots: top.deltaSlots !== undefined ? Number(top.deltaSlots) : newSlots - prevSlots,
            cohortsCount: Number(top.cohortsCount ?? 0),
            engineLabel: top.engineLabel ? String(top.engineLabel) : undefined
          };
        }
      }
    }

    const kvCt = kvRes.headers.get('content-type') || '';
    if (kvRes.ok && kvCt.includes('application/json')) {
      kvBound = true;
      const kvRaw = await kvRes.json();
      const entries = normalizeExternalEntries(kvRaw);
      if (entries.length > 0) {
        return {
          entries,
          activeSource: 'cloudflare_kv',
          sourceLabel: 'Cloudflare KV (jadual_induk_jkm)',
          sourceUrl: kvEndpoint,
          kvBound: true,
          latestRemoteLog
        };
      }
    }
  } catch {
    // Fall through cleanly to Google Sheets CSV or external JSON
  }

  // 2. Secondary: Published Google Sheet (CSV)
  if (googleCsvUrl) {
    try {
      const csvRes = await fetch(appendCacheBuster(googleCsvUrl, now), { cache: 'no-store' });
      if (csvRes.ok) {
        const csvText = await csvRes.text();
        const entries = parseTimetableCSV(csvText);
        if (entries.length > 0) {
          return {
            entries,
            activeSource: 'google_sheets_csv',
            sourceLabel: 'Google Sheets (CSV Live)',
            sourceUrl: googleCsvUrl,
            kvBound,
            latestRemoteLog
          };
        }
      }
    } catch {
      // Fall through cleanly to external JSON
    }
  }

  // 3. Fallback: R2 mirror endpoint (default /api/jadual-fallback)
  if (jsonFallbackUrl) {
    try {
      const jsonRes = await fetch(appendCacheBuster(jsonFallbackUrl, now), { cache: 'no-store' });
      const jsonCt = jsonRes.headers.get('content-type') || '';
      if (jsonRes.ok && (jsonCt.includes('application/json') || jsonCt.includes('text/plain'))) {
        const rawJson = await jsonRes.json();
        const entries = normalizeExternalEntries(rawJson);
        if (entries.length > 0) {
          return {
            entries,
            activeSource: 'external_json',
            sourceLabel: `Fail Luaran (${jsonFallbackUrl})`,
            sourceUrl: jsonFallbackUrl,
            kvBound,
            latestRemoteLog
          };
        }
      }
    } catch {
      // No external source reachable
    }
  }

  return {
    entries: [],
    activeSource: 'none',
    sourceLabel: 'Tiada Sumber Aktif',
    sourceUrl: jsonFallbackUrl || kvEndpoint,
    kvBound,
    latestRemoteLog,
    errorMessage:
      'Gagal memuatkan data daripada Cloudflare KV, Google Sheets CSV, atau sandaran /api/jadual-fallback.'
  };
}

export const DEFAULT_SYSTEM_SETTINGS: SystemSettings = {
  session: 'Sesi II: 2026/2027',
  deadline: '04 DIS 2026 (JUMAAT)',
  department: 'JABATAN KEJURUTERAAN MEKANIKAL',
  institutionName: 'POLITEKNIK KUCHING SARAWAK',
  logoUrl: '',
  logoFilename: '',
  logoStorage: 'default',
  updatedAt: ''
};

export interface SystemSettingsFetchResult {
  settings: SystemSettings;
  kvBound: boolean;
  r2Bound: boolean;
  aiBound: boolean;
  passcodeRequired: boolean;
  pinSource: 'env' | 'kv' | 'default';
}

export async function fetchSystemSettings(): Promise<SystemSettingsFetchResult> {
  const now = Date.now();
  try {
    const res = await fetch(`/api/settings?t=${now}`, { cache: 'no-store' });
    const ct = res.headers.get('content-type') || '';
    if (res.ok && ct.includes('application/json')) {
      const json = await res.json();
      const s = json?.settings || {};
      const pinSource =
        json?.pinSource === 'env' || json?.pinSource === 'kv' ? json.pinSource : 'default';
      return {
        settings: {
          ...DEFAULT_SYSTEM_SETTINGS,
          ...s,
          logoStorage: s.logoStorage === 'r2' ? 'r2' : 'default'
        },
        kvBound: Boolean(json?.kvBound),
        r2Bound: Boolean(json?.r2Bound),
        aiBound: Boolean(json?.aiBound),
        passcodeRequired: json?.passcodeRequired !== false,
        pinSource
      };
    }
  } catch {
    // fallback to defaults
  }

  return {
    settings: { ...DEFAULT_SYSTEM_SETTINGS },
    kvBound: false,
    r2Bound: false,
    aiBound: false,
    passcodeRequired: true,
    pinSource: 'default'
  };
}

