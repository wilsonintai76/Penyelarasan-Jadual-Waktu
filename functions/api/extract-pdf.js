/**
 * Cloudflare Function: POST /api/extract-pdf
 *
 * Extracts structured JKM timetable slots from a rendered PDF page image
 * using Cloudflare Workers AI (env.AI binding).
 */
const EXTRACTION_PROMPT = `You are a precision timetable extractor for Jabatan Kejuruteraan Mekanikal (JKM), Politeknik Kuching Sarawak (aSc Timetables / PLSP-02(1a) grid).
Extract ALL scheduled class slots visible on this timetable page into a JSON array.
Rules:
1. Cohort / Section format: uppercase like "DAD1-S1", "DAD2-S2", "DKM1-S1", "DPU3-S1", "DTP1-S1" (fix OCR typos like -51 -> -S1, DKM1S1 -> DKM1-S1).
2. Course_Code: uppercase alphanumeric code like "DJJ10243", "DBM10163", "DBS10042", "DUE10062", "MPU21072", "DJA20132", "DJU20102", "DJF52103". Fix OCR digit/letter confusion (0 vs O, 1 vs I, 8 vs B) where obvious.
3. Credit: integer inferred from the last digit of Course_Code (e.g. DJJ10243 -> 3, DUE10062 -> 2, MPU22071 -> 1), default 3 if unclear.
4. Day: MUST be Malay day name: "Isnin", "Selasa", "Rabu", "Khamis", or "Jumaat".
5. Start_Time and End_Time: MUST be 24-hour HH:MM format (e.g. "08:00", "10:00", "13:00", "14:00", "17:00"). Remember afternoon slots 1.00-5.00 are 13:00-17:00! Read the horizontal span carefully for merged 2-hour or 3-hour blocks.
6. Venue: room/lab code (e.g. "BK 21", "M14AT", "M13CAD", "BENGKEL", "BK TUANGAN").
7. Lecturer: lecturer code(s) separated by "/" if multiple (e.g. "JANN", "JFOZ/JMNH").
8. Status: "D".
Return ONLY a valid JSON object with shape { "entries": [...] }.`;

const PIN_CONFIG_KEY = 'admin_pin_config';
const INITIAL_DEFAULT_PIN = '2026';

async function checkAdminPin(request, env) {
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
      // ignore
    }
  }
  return provided === INITIAL_DEFAULT_PIN;
}

export async function onRequestPost(context) {
  const { env, request } = context;

  try {
    if (!(await checkAdminPin(request, env))) {
      return new Response(
        JSON.stringify({
          error: 'UNAUTHORIZED',
          message: 'PIN Admin tidak sah atau tidak dibekalkan.'
        }),
        { status: 401, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
      );
    }

    const body = await request.json();
    const imageBase64 = String(body.imageBase64 || '').replace(/^data:[^;]+;base64,/, '');
    const mimeType = String(body.mimeType || 'image/jpeg');
    const pageNumber = Number(body.pageNumber || 1);

    if (!imageBase64) {
      return new Response(
        JSON.stringify({ error: 'NO_IMAGE', message: 'Imej halaman PDF tidak diterima.' }),
        { status: 400, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
      );
    }

    // Cloudflare Workers AI vision extraction
    if (env && env.AI) {
      const aiRes = await env.AI.run('@cf/meta/llama-4-scout-17b-16e-instruct', {
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: `${EXTRACTION_PROMPT}\nReturn ONLY raw JSON.` },
              { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } }
            ]
          }
        ],
        max_tokens: 4096
      });
      const text = String((aiRes && (aiRes.response || aiRes.text)) || '{}');
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { entries: [] };
      return new Response(
        JSON.stringify({
          ok: true,
          engine: 'Cloudflare Workers AI',
          entries: Array.isArray(parsed.entries) ? parsed.entries : []
        }),
        { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
      );
    }

    return new Response(
      JSON.stringify({
        error: 'AI_NOT_CONFIGURED',
        message: 'Binding Cloudflare Workers AI (AI) belum dikonfigurasi.'
      }),
      { status: 503, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'PDF_EXTRACT_ERROR', message: String(err) }),
      { status: 500, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
    );
  }
}
