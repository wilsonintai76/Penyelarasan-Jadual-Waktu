/**
 * Safe print helper for A4 documents (Borang PK01 & Jadual Kuliah)
 * Operates cleanly whether embedded in Google Sites iframe or hosted directly on Cloudflare Pages.
 */

const MM_TO_PX = 96 / 25.4;

/**
 * Shrinks the printable sheet when its content is taller than one A4 page, so Borang PK01
 * always prints on a single page (a repeat course adds a Bahagian B row and would otherwise
 * spill onto page 2). The whole form is scaled uniformly — the official layout is preserved,
 * just slightly smaller.
 *
 * The scale is applied inline so the iframe print window (which copies `outerHTML`) gets it too.
 */
export function fitSheetToOnePage(
  sheet: HTMLElement | null,
  pageHeightMm = 297,
  minimumScale = 0.6
): number {
  if (!sheet) return 1;
  const frame = sheet.firstElementChild;
  if (!(frame instanceof HTMLElement)) return 1;

  // Reset a previous fit before measuring.
  frame.style.transform = '';
  frame.style.width = '';
  sheet.classList.remove('sheet-scaled');

  const previous = {
    sheetWidth: sheet.style.width,
    sheetMaxWidth: sheet.style.maxWidth,
    sheetPadding: sheet.style.padding
  };
  const hiddenAncestors: { node: HTMLElement; display: string }[] = [];
  let node: HTMLElement | null = sheet;
  while (node && node !== document.body) {
    if (window.getComputedStyle(node).display === 'none') {
      hiddenAncestors.push({ node, display: node.style.display });
      node.style.display = 'block';
    }
    node = node.parentElement;
  }

  // Measure with the exact geometry used by the print stylesheet.
  sheet.style.width = '210mm';
  sheet.style.maxWidth = 'none';
  sheet.style.padding = '6mm 10mm';
  const neededPx = frame.getBoundingClientRect().height;
  const availablePx = (pageHeightMm - 12) * MM_TO_PX;

  sheet.style.width = previous.sheetWidth;
  sheet.style.maxWidth = previous.sheetMaxWidth;
  sheet.style.padding = previous.sheetPadding;
  hiddenAncestors.forEach(({ node: element, display }) => {
    element.style.display = display;
  });

  if (!neededPx || neededPx <= availablePx) return 1;

  const scale = Math.max(minimumScale, Math.min(1, availablePx / neededPx));
  frame.style.transform = `scale(${scale})`;
  frame.style.transformOrigin = 'top left';
  frame.style.width = `${Number((100 / scale).toFixed(2))}%`;
  sheet.classList.add('sheet-scaled');
  return scale;
}

export function triggerPrintDocument(target: 'pk01' | 'jadual' | 'all'): void {
  // Guarantee one page per document before the browser paginates it.
  if (target !== 'jadual') {
    fitSheetToOnePage(document.getElementById('printable-sheet-pk01'));
  }

  const isTopLevel = (() => {
    try {
      return window.self === window.top;
    } catch {
      return false;
    }
  })();

  if (isTopLevel) {
    document.body.classList.remove('print-target-pk01', 'print-target-jadual', 'print-target-all');
    document.body.classList.add(`print-target-${target}`);
    setTimeout(() => {
      window.print();
    }, 150);
    return;
  }

  // Fallback for sandboxed iframes (e.g. Google Sites embed box)
  const pkEl = document.getElementById('printable-sheet-pk01');
  const jwEl = document.getElementById('printable-sheet-jadual');

  let contentHtml = '';
  let docTitle = 'Dokumen Rasmi JKM PKS';

  if (target === 'pk01' && pkEl) {
    contentHtml = pkEl.outerHTML;
    docTitle = 'Borang PK01 - JKM Politeknik Kuching Sarawak';
  } else if (target === 'jadual' && jwEl) {
    contentHtml = jwEl.outerHTML;
    docTitle = 'Jadual Waktu Kuliah - JKM Politeknik Kuching Sarawak';
  } else if (target === 'all' && pkEl && jwEl) {
    contentHtml = `${pkEl.outerHTML}<div style="page-break-after:always;break-after:page;"></div>${jwEl.outerHTML}`;
    docTitle = 'Borang PK01 & Jadual Kuliah - JKM PKS';
  }

  const printWin = window.open('', '_blank');
  if (printWin) {
    printWin.document.open();
    printWin.document.write(`
      <!DOCTYPE html>
      <html lang="ms">
      <head>
        <meta charset="UTF-8">
        <title>${docTitle}</title>
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&family=Tinos:ital,wght@0,400;0,700;1,400&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
        <script src="https://cdn.tailwindcss.com"></script>
        <style>
          /* Named pages keep Borang PK01 portrait and Jadual Waktu Kuliah landscape,
             exactly like the official JKM templates. */
          @page { size: A4 portrait; margin: 0; }
          @page pk01sheet { size: A4 portrait; margin: 0; }
          @page jadualsheet { size: A4 landscape; margin: 0; }
          #printable-sheet-pk01 { page: pk01sheet; min-width: 0 !important; width: 100% !important; margin: 0 !important; }
          #printable-sheet-jadual { page: jadualsheet; min-width: 0 !important; width: 100% !important; margin: 0 !important; max-width: none !important; }
          body { font-family: 'Plus Jakarta Sans', sans-serif; background: #f1f5f9; margin: 0; padding: 16px; }
          .font-official { font-family: 'Tinos', 'Times New Roman', serif; }
          .font-mono-tabular { font-family: 'JetBrains Mono', monospace; font-variant-numeric: tabular-nums; }
          .print-sheet {
            background: #ffffff;
            max-width: 210mm;
            margin: 0 auto 20px auto;
            padding: 8mm 10mm;
            border: 1px solid #000000;
            box-sizing: border-box;
          }
          /* Auto-fitted to a single A4 page (see fitSheetToOnePage). */
          .print-sheet.sheet-scaled {
            height: 297mm;
            overflow: hidden;
          }
          .diagonal-stamp {
            position: absolute;
            top: 18px;
            right: 20px;
            transform: rotate(14deg);
            border: 2px dashed #dc2626;
            color: #dc2626;
            padding: 4px 10px;
            font-weight: 800;
            text-align: center;
            text-transform: uppercase;
            font-size: 9.5px;
            line-height: 1.25;
            background: rgba(254, 242, 242, 0.96);
            z-index: 10;
          }
          table { border-collapse: collapse !important; width: 100% !important; page-break-inside: avoid; }
          th, td { border-color: #000000 !important; }
          .page-break { page-break-after: always; break-after: page; }
          @media print {
            body { background: #ffffff !important; padding: 0 !important; }
            .no-print-bar { display: none !important; }
            .print-sheet { box-shadow: none !important; border: 1px solid #000 !important; margin: 0 auto !important; width: 100% !important; padding: 6mm 10mm !important; }
            .diagonal-stamp { border-color: #000 !important; color: #000 !important; background: transparent !important; }
          }
        </style>
      </head>
      <body>
        <div class="no-print-bar max-w-[210mm] mx-auto mb-4 bg-slate-900 text-white p-3 rounded-xl flex items-center justify-between gap-2 shadow">
          <span class="text-xs font-semibold">Pratonton Cetakan Rasmi A4 (JKM Politeknik Kuching Sarawak)</span>
          <div class="flex items-center gap-2">
            <button onclick="window.print()" class="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-lg cursor-pointer">
              🖨️ Cetak / Simpan PDF
            </button>
            <button onclick="window.close()" class="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white font-semibold text-xs rounded-lg cursor-pointer">
              Tutup
            </button>
          </div>
        </div>
        ${contentHtml}
        <script>
          window.onload = function() {
            setTimeout(function() { window.print(); }, 600);
          };
        </script>
      </body>
      </html>
    `);
    printWin.document.close();
  } else {
    // If popup blocked, still try direct print
    document.body.classList.remove('print-target-pk01', 'print-target-jadual', 'print-target-all');
    document.body.classList.add(`print-target-${target}`);
    window.print();
  }
}
