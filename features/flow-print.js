// ================================================================================================
// FILE: features/flow-print.js
//
// WHAT IT DOES:   Two things for the Steps (diagram) view of the flow map:
//
//   1. RESPONSIVE ARRANGEMENT   chooseCols() turns the width of the window into "how many card columns fit". The diagram
//                               then wraps: Zaps in a workflow and paths inside a Zap flow onto new rows instead of
//                               running off the side, so a narrow window gives a taller, narrower diagram and a wide one
//                               stays horizontal. (The map applies it; see fix-responsive-layout-and-print.patch.)
//
//   2. PRINT THE REAL DIAGRAM   printFlowDiagram() prints what the Steps view actually draws (the step cards, the lanes and
//                               the arrows), not a list. It re-arranges the diagram to fit the paper (portrait = tall,
//                               landscape = wider), cuts pages in the gaps between rows so no card is sliced in half,
//                               prints in the light theme, then puts the screen back as it was.
//
// PURE HELPERS:   chooseCols, pageBox, fitScale, planPageBreaks, collectIntervals, buildPrintHtml take their inputs
//                 as arguments, so they are tested on their own (tests/flow-print.test.mjs).
// ================================================================================================

export const CARD = { cardW: 180, colGap: 52, padX: 48 };           // the Steps view's own measurements
export const PAGE_PX = { portrait: { w: 794, h: 1123 }, landscape: { w: 1123, h: 794 } };   // A4 at 96 dpi
export const PRINT_MARGIN = 38;                                       // about 10 mm
export const PRINT_HEADER = 40;                                       // room for the title line on every page
export const PRINT_TARGET_SCALE = 0.85;                               // how big the diagram should be on paper

// How many card columns fit in `widthPx`. shape: 'auto' | 'wide' | 'tall' | a number (used when printing).
//   wide  -> no limit (everything side by side, as before)      tall -> a single column
//   auto  -> as many as fit the window
export function chooseCols(shape, widthPx, c = CARD) {
  if (typeof shape === 'number' && shape >= 1) return Math.floor(shape);
  if (shape === 'wide') return Infinity;
  if (shape === 'tall') return 1;
  const w = Number(widthPx) || 0;
  if (w <= 0) return Infinity;
  return Math.max(1, Math.floor((w - 2 * c.padX + c.colGap) / (c.cardW + c.colGap)));
}

// The printable area of a page (CSS pixels)
export function pageBox(orientation, margin = PRINT_MARGIN, header = PRINT_HEADER) {
  const p = PAGE_PX[orientation === 'landscape' ? 'landscape' : 'portrait'];
  return { w: p.w - 2 * margin, h: p.h - 2 * margin - header };
}

export const fitScale = (boxW, contentW, max = 1) => (contentW > 0 ? Math.min(max, boxW / contentW) : max);

// Where to cut the diagram into pages. intervals: [{ top, bottom }] for everything that must not be sliced (cards, labels).
// Cuts fall in the gaps between them. Returns [{ y0, y1 }] covering 0..totalH.
export function planPageBreaks(intervals, totalH, pageH, minFill = 0.3) {
  const sorted = (intervals || []).filter((i) => i && i.bottom > i.top).map((i) => ({ top: i.top, bottom: i.bottom })).sort((a, b) => a.top - b.top);
  const merged = [];
  for (const it of sorted) {
    const last = merged[merged.length - 1];
    if (last && it.top <= last.bottom + 1) last.bottom = Math.max(last.bottom, it.bottom); else merged.push({ ...it });
  }
  const gaps = [];                                                     // places where a cut is safe: the middle of each gap
  for (let i = 0; i + 1 < merged.length; i++) {
    const a = merged[i].bottom; const b = merged[i + 1].top;
    if (b - a >= 2) gaps.push((a + b) / 2);
  }
  const pages = [];
  let cur = 0;
  let guard = 0;
  while (cur < totalH - 0.5 && guard++ < 10000) {
    const limit = cur + pageH;
    if (limit >= totalH) { pages.push({ y0: cur, y1: totalH }); break; }
    let cut = null;
    for (const g of gaps) if (g > cur + pageH * minFill && g <= limit) cut = g;     // the lowest safe cut that still fits
    if (cut === null) cut = limit;                                                   // a card spans the whole page: cut anyway
    pages.push({ y0: cur, y1: cut });
    cur = cut;
  }
  if (!pages.length) pages.push({ y0: 0, y1: Math.max(totalH, 1) });
  return pages;
}

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const isBackground = (el) => el.style && el.style.pointerEvents === 'none' && /border-radius/.test(el.style.cssText || '') && !el.classList.contains('fv-step-card');

// Boxes of everything in the diagram that must not be cut: cards, labels, headers (not the big zone backgrounds)
export function collectIntervals(contentEl, heightOf = (el) => el.offsetHeight) {
  const out = [];
  Array.from(contentEl.children).forEach((el) => {
    if (isBackground(el)) return;
    const top = num(el.style.top); const h = heightOf(el);
    if (h > 0) out.push({ top, bottom: top + h });
  });
  return out;
}

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// The HTML of the print window. `contentEl` / `svgEl` are the live diagram elements; they are copied, never moved.
//   headHtml  the app's own <link>/<style> tags, so the cards look the same on paper
export function buildPrintHtml({ contentEl, svgEl, width, height, pages, scale, orientation, title, subtitle, date, headHtml = '', heightOf }) {
  const hOf = heightOf || ((el) => el.offsetHeight);
  const kids = Array.from(contentEl.children).map((el) => ({ el, top: num(el.style.top), h: hOf(el), bg: isBackground(el) }));
  const svgHtml = svgEl ? svgEl.outerHTML : '';
  const sheets = pages.map((pg, i) => {
    const inPage = kids.filter((k) => k.bg || (k.top + k.h > pg.y0 && k.top < pg.y1)).map((k) => k.el.outerHTML).join('');
    const clipH = Math.max(1, (pg.y1 - pg.y0) * scale);
    return `<section class="pg">
  <div class="pg-head"><span class="pg-title">${esc(title)}</span><span class="pg-sub">${esc(subtitle)}</span><span class="pg-meta">${esc(date)} &middot; page ${i + 1} of ${pages.length}</span></div>
  <div class="pg-clip" style="width:${Math.ceil(width * scale)}px;height:${Math.ceil(clipH)}px;">
    <div class="pg-inner" style="width:${width}px;height:${height}px;transform:translateY(${-pg.y0 * scale}px) scale(${scale});">
      <div id="fv-content" style="position:relative;width:${width}px;height:${height}px;">${inPage}</div>
      ${svgHtml}
    </div>
  </div>
</section>`;
  }).join('\n');
  const size = orientation === 'landscape' ? 'A4 landscape' : 'A4 portrait';
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${esc(title)} - ${esc(subtitle)}</title>
${headHtml}
<style>
@page { size: ${size}; margin: ${Math.round(PRINT_MARGIN * 0.2646)}mm; }
html, body { background: #fff !important; margin: 0; padding: 0; }
body { font-family: 'Inter', -apple-system, 'Segoe UI', sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.pg { page-break-after: always; break-after: page; padding: 0; }
.pg:last-child { page-break-after: auto; break-after: auto; }
.pg-head { display: flex; gap: 12px; align-items: baseline; height: ${PRINT_HEADER - 8}px; border-bottom: 1.5px solid #0f172a; margin-bottom: 8px; color: #0f172a; }
.pg-title { font-size: 14px; font-weight: 800; }
.pg-sub { font-size: 10px; color: #64748b; }
.pg-meta { margin-left: auto; font-size: 9px; color: #94a3b8; }
.pg-clip { position: relative; overflow: hidden; }
.pg-inner { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
.pg-inner #fv-svg-layer { position: absolute; left: 0; top: 0; pointer-events: none; }
.fv-pin-btn, button { display: none !important; }
.fv-step-card { box-shadow: none !important; }
</style></head>
<body class="light-mode">
${sheets}
</body></html>`;
}

// Collect the app's own stylesheets so the printed cards look like the screen
export function collectHeadHtml(doc) {
  const parts = [];
  doc.querySelectorAll('link[rel="stylesheet"]').forEach((l) => { if (l.href) parts.push(`<link rel="stylesheet" href="${esc(l.href)}">`); });
  doc.querySelectorAll('style').forEach((s) => parts.push(`<style>${s.textContent}</style>`));
  return parts.join('\n');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Waits until the Steps view has drawn and measured its cards
async function waitForDiagram(doc, tries = 40) {
  for (let i = 0; i < tries; i++) {
    const content = doc.getElementById('fv-content');
    const cards = content ? content.querySelectorAll('.fv-step-card') : [];
    if (content && cards.length && num(content.style.height) > 0) { await sleep(250); return true; }   // one more beat: heights settle a frame later
    await sleep(100);
  }
  return false;
}

// Prints the real diagram. deps: { OL, document, window }.  opts: { orientation, title }
export async function printFlowDiagram(deps, opts = {}) {
  const { OL, document: doc, window: win } = deps;
  const orientation = opts.orientation === 'landscape' ? 'landscape' : 'portrait';
  const box = pageBox(orientation);
  const prev = { layout: OL._fv.layout, override: OL._fv._colsOverride };
  const popup = win.open('', '_blank', 'width=1000,height=800');
  if (!popup) { win.alert('Your browser blocked the print window. Allow pop-ups for this site and try again.'); return false; }
  popup.document.write('<p style="font-family:sans-serif;padding:24px;color:#475569;">Preparing the diagram&hellip;</p>');
  try {
    OL._fv.layout = 'steps';
    OL._fv._colsOverride = chooseCols(null, box.w / PRINT_TARGET_SCALE);          // re-arrange to fit the paper
    OL.renderVisualizer();
    const ready = await waitForDiagram(doc);
    const contentEl = doc.getElementById('fv-content');
    if (!ready || !contentEl) throw new Error('The diagram did not finish drawing. Switch to Steps view and try again.');
    const svgEl = doc.getElementById('fv-svg-layer');
    const width = num(contentEl.style.width) || contentEl.scrollWidth;
    const height = num(contentEl.style.height) || contentEl.scrollHeight;
    const scale = fitScale(box.w, width, 1);
    const pages = planPageBreaks(collectIntervals(contentEl), height, box.h / scale);
    const client = opts.title || 'Flow map';
    const html = buildPrintHtml({
      contentEl, svgEl, width, height, pages, scale, orientation,
      title: client, subtitle: `Flow diagram (${orientation})`, date: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
      headHtml: collectHeadHtml(doc),
    });
    popup.document.open(); popup.document.write(html); popup.document.close();
    popup.focus();
    setTimeout(() => popup.print(), 900);
    return true;
  } catch (e) {
    try { popup.close(); } catch (_) { /* ignore */ }
    win.alert(String((e && e.message) || e));
    return false;
  } finally {
    OL._fv.layout = prev.layout; OL._fv._colsOverride = prev.override;            // put the screen back
    OL.renderVisualizer();
  }
}
