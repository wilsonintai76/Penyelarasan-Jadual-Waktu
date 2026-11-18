import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { MasterTimetableEntry } from '../types';
import {
  normalizeDayName,
  normalizeExternalEntries,
  normalizeTimeHHMM
} from './externalTimetableLoader';

// Configure pdf.js worker cleanly for Vite & Cloudflare Pages static builds
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface PdfPagePreview {
  pageNumber: number;
  width: number;
  height: number;
  thumbnailDataUrl: string;
  rotation: number;
}

function inferCreditsFromCode(courseCode: string): number {
  const cleaned = courseCode.replace(/[^A-Z0-9]/gi, '').toUpperCase();
  const lastChar = cleaned.slice(-1);
  const num = parseInt(lastChar, 10);
  if (!Number.isNaN(num) && num >= 1 && num <= 8) return num;
  return 3;
}

function normalizeCohortCode(raw: string): string {
  let s = String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
  s = s.replace(/-5(\d)$/, '-S$1');
  s = s.replace(/^([A-Z]{2,4}\d)S(\d)$/, '$1-S$2');
  return s;
}

function cleanCourseCode(raw: string): string {
  let c = String(raw || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  c = c.replace(/^01[1I/]/, 'DJJ');
  c = c.replace(/^08M/, 'DBM');
  c = c.replace(/^851/, 'DBS1');
  c = c.replace(/^0UE/, 'DUE');
  return c;
}

export async function loadCourseCatalogMap(): Promise<Record<string, string>> {
  try {
    const res = await fetch('/assets/course_catalog.json', { cache: 'no-store' });
    if (res.ok) {
      const json = (await res.json()) as Record<string, string>;
      const map: Record<string, string> = {};
      Object.entries(json || {}).forEach(([k, v]) => {
        const key = String(k).trim().toUpperCase();
        const val = String(v).trim();
        if (key && val && !val.startsWith('Course ')) {
          map[key] = val;
        }
      });
      return map;
    }
  } catch {
    // ignore missing catalog
  }
  return {};
}

export function enrichTimetableEntries(
  rawEntries: unknown[],
  catalog: Record<string, string>
): MasterTimetableEntry[] {
  const preNormalized = normalizeExternalEntries(rawEntries);
  const dedup = new Map<string, MasterTimetableEntry>();

  for (const item of preNormalized) {
    const cohort = normalizeCohortCode(item.Cohort);
    const code = cleanCourseCode(item.Course_Code);
    if (!cohort || !code || code.includes('TUANGAN')) continue;

    const catalogName = catalog[code];
    const courseName =
      catalogName ||
      (item.Course_Name && !item.Course_Name.startsWith('Course ')
        ? item.Course_Name
        : `Course ${code}`);

    const credit =
      Number.isFinite(item.Credit) && item.Credit >= 1 && item.Credit <= 8
        ? item.Credit
        : inferCreditsFromCode(code);

    const day = normalizeDayName(item.Day);
    const startTime = normalizeTimeHHMM(item.Start_Time);
    const endTime = normalizeTimeHHMM(item.End_Time);
    if (!day || !startTime || !endTime) continue;

    const venue = String(item.Venue || '-').trim().toUpperCase() || '-';
    const lecturer = String(item.Lecturer || '-').trim().toUpperCase() || '-';

    const entry: MasterTimetableEntry = {
      Cohort: cohort,
      Course_Code: code,
      Course_Name: courseName,
      Credit: credit,
      Day: day,
      Start_Time: startTime,
      End_Time: endTime,
      Venue: venue,
      Lecturer: lecturer,
      Status: item.Status || 'D'
    };

    const sig = `${entry.Cohort}|${entry.Course_Code}|${entry.Day}|${entry.Start_Time}|${entry.End_Time}|${entry.Venue}`;
    if (!dedup.has(sig)) {
      dedup.set(sig, entry);
    }
  }

  return Array.from(dedup.values()).sort((a, b) => {
    const cohortCmp = a.Cohort.localeCompare(b.Cohort);
    if (cohortCmp !== 0) return cohortCmp;
    const dayOrder = ['Isnin', 'Selasa', 'Rabu', 'Khamis', 'Jumaat'];
    const dayCmp = dayOrder.indexOf(a.Day) - dayOrder.indexOf(b.Day);
    if (dayCmp !== 0) return dayCmp;
    return a.Start_Time.localeCompare(b.Start_Time);
  });
}

async function renderPageToCanvas(
  pdfDoc: pdfjsLib.PDFDocumentProxy,
  pageNumber: number,
  targetScale: number,
  extraRotation = 0
): Promise<{ dataUrl: string; width: number; height: number }> {
  const page = await pdfDoc.getPage(pageNumber);
  const baseViewport = page.getViewport({ scale: 1 });
  const totalRotation = (page.rotate + extraRotation) % 360;
  const maxDim = Math.max(baseViewport.width, baseViewport.height);
  const clampedScale = maxDim * targetScale > 2400 ? 2400 / maxDim : targetScale;
  const viewport = page.getViewport({ scale: clampedScale, rotation: totalRotation });

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Kanvas 2D tidak disokong oleh pelayar.');
  }

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({
    canvasContext: ctx,
    canvas,
    viewport
  }).promise;

  const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
  canvas.width = 0;
  canvas.height = 0;

  return {
    dataUrl,
    width: Math.round(viewport.width),
    height: Math.round(viewport.height)
  };
}

export async function inspectPdfPages(file: File): Promise<{
  pageCount: number;
  previews: PdfPagePreview[];
}> {
  const arrayBuffer = await file.arrayBuffer();
  const pdfDoc = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
  const previews: PdfPagePreview[] = [];

  for (let p = 1; p <= pdfDoc.numPages; p++) {
    const rendered = await renderPageToCanvas(pdfDoc, p, 0.45, 0);
    previews.push({
      pageNumber: p,
      width: rendered.width,
      height: rendered.height,
      thumbnailDataUrl: rendered.dataUrl,
      rotation: 0
    });
  }

  await (pdfDoc as unknown as { destroy?: () => Promise<void> }).destroy?.();
  return { pageCount: previews.length, previews };
}

export async function extractTimetableFromPdf(
  file: File,
  pageRotations: Record<number, number>,
  onProgress?: (completed: number, total: number, message: string) => void,
  adminPin?: string
): Promise<{ entries: MasterTimetableEntry[]; engineLabel: string }> {
  const arrayBuffer = await file.arrayBuffer();
  const pdfDoc = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
  const catalog = await loadCourseCatalogMap();

  const totalPages = pdfDoc.numPages;
  const collectedRaw: unknown[] = [];
  let lastEngine = 'Gemini Vision (Web Upload)';

  try {
    for (let pageNumber = 1; pageNumber <= totalPages; pageNumber++) {
      onProgress?.(
        pageNumber - 1,
        totalPages,
        `Merender & mengekstrak halaman ${pageNumber} daripada ${totalPages}...`
      );

      const rot = pageRotations[pageNumber] || 0;
      const rendered = await renderPageToCanvas(pdfDoc, pageNumber, 2.0, rot);

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (adminPin && adminPin.trim()) {
        headers['X-Admin-Passcode'] = adminPin.trim();
      }

      const res = await fetch('/api/extract-pdf', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          imageBase64: rendered.dataUrl,
          mimeType: 'image/jpeg',
          pageNumber,
          totalPages
        })
      });

      const payload = await res.json();
      if (!res.ok) {
        throw new Error(
          payload?.message || `Pengekstrakan gagal pada halaman ${pageNumber} (HTTP ${res.status}).`
        );
      }

      if (payload?.engine) {
        lastEngine = String(payload.engine);
      }

      if (Array.isArray(payload?.entries)) {
        collectedRaw.push(...payload.entries);
      }

      onProgress?.(
        pageNumber,
        totalPages,
        `Halaman ${pageNumber}/${totalPages} selesai (${collectedRaw.length} slot dikumpul)`
      );
    }
  } finally {
    await (pdfDoc as unknown as { destroy?: () => Promise<void> }).destroy?.();
  }

  const enriched = enrichTimetableEntries(collectedRaw, catalog);
  return {
    entries: enriched,
    engineLabel: lastEngine
  };
}

export async function parseUploadedJsonTimetable(file: File): Promise<MasterTimetableEntry[]> {
  const text = await file.text();
  const parsed = JSON.parse(text);
  const catalog = await loadCourseCatalogMap();
  const rawList = Array.isArray(parsed)
    ? parsed
    : parsed && Array.isArray(parsed.entries)
      ? parsed.entries
      : parsed && Array.isArray(parsed.data)
        ? parsed.data
        : [];
  return enrichTimetableEntries(rawList, catalog);
}
