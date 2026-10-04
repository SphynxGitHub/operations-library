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
export const PRINT_SLACK = 16;                                        // spare room under each page's slice, in case a printed card comes out a little taller
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
  return { w: p.w - 2 * margin, h: p.h - 2 * margin - header - 4 };
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

// The font settings the cards INHERIT on screen. The printed page must use the same ones, or text comes out a different
// width, badges wrap onto a second row and cards print taller than they were measured.
export function readInheritedText(el, win) {
  const cs = (win || (typeof window !== 'undefined' ? window : null)).getComputedStyle(el);
  return { fontFamily: cs.fontFamily, fontSize: cs.fontSize, fontWeight: cs.fontWeight, lineHeight: cs.lineHeight, letterSpacing: cs.letterSpacing, color: cs.color };
}
const textStyle = (t) => (t ? Object.entries({ 'font-family': t.fontFamily, 'font-size': t.fontSize, 'font-weight': t.fontWeight, 'line-height': t.lineHeight, 'letter-spacing': t.letterSpacing, color: t.color }).filter(([, v]) => v && v !== 'normal').map(([k, v]) => `${k}:${String(v).replace(/"/g, "'")}`).join(';') : '');

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

// Page numbers for the "See another process" callouts (features/flow-visualizer/references.js).
//   items  [{ top, headOf?: resId, refsTo?: [resId, ...] }]: a process's heading, and the steps that point at a process
//   pages  [{ y0, y1 }] from planPageBreaks
// Returns { headPage: { resId: pageNumber }, usedPages: { resId: [pageNumber, ...] } }; page numbers start at 1.
export function planRefPages(items, pages) {
  const pageOf = (y) => { for (let i = 0; i < (pages || []).length; i++) if (y >= pages[i].y0 - 1 && y < pages[i].y1) return i + 1; return null; };
  const headPage = {}; const used = {};
  (items || []).forEach((it) => {
    const pg = pageOf(it.top);
    if (!pg) return;
    if (it.headOf != null && headPage[it.headOf] == null) headPage[it.headOf] = pg;
    (it.refsTo || []).forEach((r) => { (used[r] = used[r] || new Set()).add(pg); });
  });
  const usedPages = {}; Object.keys(used).forEach((r) => { usedPages[r] = Array.from(used[r]).sort((a, b) => a - b); });
  return { headPage, usedPages };
}

// Writes the page numbers into the copy of an element that goes on page `pageNo`.
export function annotateRefs(el, pageNo, plan) {
  if (!el || typeof el.querySelectorAll !== 'function' || !plan) return;
  el.querySelectorAll('.fv-ref-chip[data-ref-res]').forEach((chip) => {
    const pg = plan.headPage[chip.getAttribute('data-ref-res')];
    const slot = chip.querySelector('.fv-ref-pg');
    if (pg && slot) slot.textContent = pg === pageNo ? ' \u00b7 this page' : ` \u00b7 p. ${pg}`;
  });
  // the flag on a card prints the numbers the list at the end uses: Q1 Q2 A1 N1
  if (plan.itemNo) el.querySelectorAll('.fv-flag[data-item-ids]').forEach((flag) => {
    const key = `${flag.closest('.fv-step-card')?.dataset.resId || ''}|${flag.closest('.fv-step-card')?.dataset.stepId || ''}`;
    const labels = (plan.itemNo.byStep[key] || []);
    if (!labels.length) return;
    flag.innerHTML = labels.map((l) => `<span class="fv-flag-chip fv-flag-no k-${l[0]}">${l}</span>`).join('');
  });
  el.querySelectorAll('.fv-used-wrap[data-used-res]').forEach((w) => {
    const pgs = plan.usedPages[w.getAttribute('data-used-res')] || [];
    const slot = w.querySelector('.fv-used-pg');
    if (pgs.length && slot) slot.textContent = `${pgs.length === 1 ? 'p.' : 'pp.'} ${pgs.join(', ')}`;
  });
}

// The HTML of the print window. `contentEl` / `svgEl` are the live diagram elements; they are copied, never moved.
//   headHtml  the app's own <link>/<style> tags, so the cards look the same on paper
//
// Each page holds ONLY its own slice of the diagram: cards are copied with their tops moved up by the page's start, the
// arrows are a window (viewBox) onto the full drawing, and the whole page is shrunk with CSS `zoom` so that its LAYOUT
// height is no taller than the paper. (An earlier version placed the full-height diagram inside a clipping box and moved
// it with a transform; the browser still laid out the tall box and split it at its own page boundaries when printing,
// which cut cards in half, scattered arrows and added extra pages.)
export function buildPrintHtml({ contentEl, svgEl, width, height, pages, scale, orientation, title, subtitle, date, headHtml = '', heightOf, inherit, itemNo = null, collateralNo = null, appendixHtml = '' }) {
  const hOf = heightOf || ((el) => el.offsetHeight);
  const kids = Array.from(contentEl.children).map((el) => {
    const bg = isBackground(el);
    return { el, top: num(el.style.top), h: bg ? num(el.style.height) : hOf(el), bg };
  });
  const svgInner = svgEl ? svgEl.innerHTML : '';
  // where each shared process and each "See ..." step ended up, so the callouts can name the page
  const refPlan = planRefPages(kids.filter((k) => !k.bg).map((k) => {
    const cls = (k.el.className || '').toString();
    const chips = typeof k.el.querySelectorAll === 'function' ? Array.from(k.el.querySelectorAll('.fv-ref-chip[data-ref-res]')).map((c) => c.getAttribute('data-ref-res')) : [];
    return { top: k.top, headOf: /fv-steps-res-head/.test(cls) && k.el.dataset ? k.el.dataset.resId : undefined, refsTo: chips };
  }), pages);
  refPlan.itemNo = itemNo;
  refPlan.collateral = collateralNo;
  const paper = PAGE_PX[orientation === 'landscape' ? 'landscape' : 'portrait'];
  const pageContentH = paper.h - 2 * PRINT_MARGIN;
  const sheets = pages.map((pg, i) => {
    const winH = Math.max(1, Math.ceil(pg.y1 - pg.y0));
    const parts = [];
    for (const k of kids) {
      const bottom = k.top + k.h;
      if (!(bottom > pg.y0 && k.top < pg.y1)) continue;                       // not on this page
      const c = k.el.cloneNode(true);
      if (k.bg) {                                                              // a zone background is cropped to the page
        const t = Math.max(k.top, pg.y0); const bt = Math.min(bottom, pg.y1);
        c.style.top = `${t - pg.y0}px`; c.style.height = `${Math.max(1, bt - t)}px`;
      } else {
        c.style.top = `${k.top - pg.y0}px`;
      }
      annotateRefs(c, i + 1, refPlan);
      if (collateralNo && typeof window !== 'undefined' && window.OL && window.OL.fvAnnotateCollateral) window.OL.fvAnnotateCollateral(c, collateralNo);
      parts.push(c.outerHTML);
    }
    const svg = svgEl
      ? `<svg id="fv-svg-layer" xmlns="http://www.w3.org/2000/svg" viewBox="0 ${pg.y0} ${width} ${winH}" width="${width}" height="${winH}" style="position:absolute;left:0;top:0;width:${width}px;height:${winH}px;overflow:hidden;">${svgInner}</svg>`
      : '';
    return `<section class="pg">
  <div class="pg-head"><span class="pg-title">${esc(title)}</span><span class="pg-sub">${esc(subtitle)}</span><span class="pg-meta">${esc(date)} &middot; page ${i + 1} of ${pages.length}</span></div>
  <div class="pg-clip" style="width:${Math.ceil(width * scale)}px;height:${Math.ceil(winH * scale) + PRINT_SLACK}px;">
    <div class="pg-inner" style="zoom:${scale};--s:${scale};width:${width}px;height:${winH + Math.ceil(PRINT_SLACK / scale)}px;${textStyle(inherit)}">
      <div id="fv-content" style="position:relative;width:${width}px;height:${winH + Math.ceil(PRINT_SLACK / scale)}px;">${parts.join('')}</div>
      ${svg}
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
html, body { background: #fff !important; margin: 0; padding: 0; height: auto !important; overflow: visible !important; }
body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
/* one section per sheet of paper, never taller than the printable area, so the browser never has to split it */
.pg { height: ${pageContentH - 3}px; overflow: hidden !important; break-inside: avoid; page-break-after: always; break-after: page; padding: 0; box-sizing: border-box; }
.pg:last-child { page-break-after: auto; break-after: auto; }
.pg-head { font-family: 'Inter', -apple-system, 'Segoe UI', sans-serif; display: flex; gap: 12px; align-items: baseline; height: ${PRINT_HEADER - 8}px; border-bottom: 1.5px solid #0f172a; margin-bottom: 8px; color: #0f172a; }
.pg-title { font-size: 14px; font-weight: 800; }
.pg-sub { font-size: 10px; color: #64748b; }
.pg-meta { margin-left: auto; font-size: 9px; color: #94a3b8; }
.pg-clip { position: relative; overflow: hidden !important; break-inside: avoid; }
.pg-inner { position: relative; transform-origin: 0 0; }
.pg-inner #fv-content { z-index: 1; }
.pg-inner #fv-svg-layer { pointer-events: none; z-index: 2; overflow: hidden !important; }
@supports not (zoom: 1) { .pg-inner { zoom: normal !important; transform: scale(var(--s)); position: absolute; left: 0; top: 0; } }
.fv-pin-btn, button { display: none !important; }
.fv-back-pill, .fv-used-pop, .fv-items-pop, .fv-items-drawer { display: none !important; }
/* flags on the cards print as the numbers of the list at the end */
/* the flag is a <button>, and every other button is hidden for print, so it has to be switched back on */
.fv-flag { display: inline-flex !important; background: #fff !important; border: 1.2px solid #334155 !important; box-shadow: none !important; padding: 1px 5px !important; }
.fv-flag-add { display: none !important; }
.fv-flag-no { font-size: 10px; font-weight: 800; color: #0f172a !important; }
.fv-flag-no.k-Q { color: #1e3a8a !important; } .fv-flag-no.k-A { color: #0f766e !important; } .fv-flag-no.k-N { color: #475569 !important; }
/* the list that ends the printout: normal flow, so it can run onto as many pages as it needs */
.apx { font-family: 'Inter', -apple-system, 'Segoe UI', sans-serif; color: #0f172a; page-break-before: always; break-before: page; padding: 0 2px; }
.apx-head { display: flex; gap: 12px; align-items: baseline; border-bottom: 1.5px solid #0f172a; padding-bottom: 6px; margin-bottom: 14px; }
.apx-title { font-size: 18px; font-weight: 800; } .apx-sub { font-size: 10px; color: #64748b; margin-left: auto; }
.apx-group { margin-bottom: 18px; }
.apx-h2 { font-size: 12px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; margin: 0 0 6px; padding-bottom: 3px; border-bottom: 2.5px solid #0f172a; break-after: avoid; }
.apx-h2 span { color: #64748b; font-weight: 600; margin-left: 4px; } .apx-h2.muted { color: #64748b; }
.apx-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.apx-th th { text-align: left; font-size: 9.5px; text-transform: uppercase; letter-spacing: .05em; color: #64748b; padding: 2px 6px 4px; font-weight: 700; }
.apx-row { break-inside: avoid; page-break-inside: avoid; }
.apx-row td { padding: 6px 6px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
.apx-no { width: 34px; font-weight: 800; white-space: nowrap; }
.apx-where { font-size: 10px; color: #64748b; margin-top: 2px; }
.apx-ans { height: 26px; border-bottom: 1px dotted #94a3b8; margin-top: 4px; }
.apx-who { width: 120px; font-size: 11px; } .apx-due { width: 56px; font-size: 11px; white-space: nowrap; }
.apx-box { width: 40px; text-align: center; } .apx-box span { display: inline-block; width: 13px; height: 13px; border: 1.4px solid #334155; border-radius: 3px; }
.apx-row.done td { color: #64748b; text-decoration: line-through; }
.apx-lines i { display: block; height: 26px; border-bottom: 1px solid #cbd5e1; }
/* the "See another process" callouts print in colour-safe teal with the page number */
.fv-ref-chip { color: #0f766e !important; border: 1.2px solid #0f766e !important; background: #f0fdfa !important; }
.fv-used-chip { color: #0f766e !important; border: 1.2px dashed #0f766e !important; background: #fff !important; }
.fv-used-pg { color: #0f766e !important; font-weight: 700; }
.fv-step-card { box-shadow: none !important; break-inside: avoid; }
/* the Frame-out draft chip and the add-a-step row are for the screen only */
.fo-draft-chip, .fo-draft-chip-link, .fo-draft, .fo-inline, .fo-open-btn { display: none !important; }
/* amber text is hard to read on white paper */
.fv-flag-chip[style*="--c:#F5B800"] { --c: #1e3a8a !important; }
.fv-steps-res-head [style*="#e8a83a"], .fv-step-card [style*="color:#e8a83a"] { color: #1e3a8a !important; }
.fv-steps-res-head [style*="background:#e8a83a"] { background: #1e3a8a !important; }
/* collateral chips print as numbered tags; the list at the end carries the names and links */
.fv-co-print { display: inline-flex !important; align-items: center; gap: 4px; padding: 1px 6px; border: 1.2px solid #334155; border-radius: 6px; background: #fff !important; color: #0f172a !important; font-size: 10px; font-weight: 600; max-width: 100%; }
.fv-co-no { font-weight: 800; color: #0f766e; }
.apx-ctype { width: 96px; font-size: 11px; color: #475569; }
.apx-link { width: 34%; font-size: 10.5px; word-break: break-all; color: #0f766e; }
.apx-none { color: #94a3b8; }
</style></head>
<body class="light-mode">
${sheets}
${appendixHtml}
</body></html>`;
}

// The app's own on-screen rules, as <style> tags, so the printed cards look like the screen.
// The app's @media print rules and @page rules are LEFT OUT: they are written for its other pages (for example
// `* { overflow: visible !important }`, which switches off the clipping boxes each printed page depends on, and an
// @page of its own that overrides this window's paper size).
export function keepScreenRules(rules) {
  const out = [];
  for (const r of Array.from(rules || [])) {
    if (r.type === 6) continue;                                                    // @page
    if (r.type === 4 && /print/i.test((r.media && r.media.mediaText) || r.conditionText || '')) continue;   // @media print
    out.push(r.cssText);
  }
  return out.join('\n');
}

export function collectHeadHtml(doc) {
  const parts = [];
  if (doc.baseURI) parts.push(`<base href="${esc(doc.baseURI)}">`);                // relative urls (fonts, images) still resolve
  Array.from(doc.styleSheets || []).forEach((sheet) => {
    let rules = null;
    try { rules = sheet.cssRules; } catch (e) { rules = null; }                    // cross-origin sheets cannot be read
    if (rules) parts.push(`<style>${keepScreenRules(rules)}</style>`);
    else if (sheet.href) parts.push(`<link rel="stylesheet" href="${esc(sheet.href)}">`);
  });
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
  const prev = { layout: OL._fv.layout, override: OL._fv._colsOverride, laneCols: OL._fv._laneCols, renderedCols: OL._fv._renderedCols };
  const popup = win.open('', '_blank', 'width=1000,height=800');
  if (!popup) { win.alert('Your browser blocked the print window. Allow pop-ups for this site and try again.'); return false; }
  popup.document.write('<p style="font-family:sans-serif;padding:24px;color:#475569;">Preparing the diagram&hellip;</p>');
  try {
    OL._fv.layout = 'steps';
    const fitCols = chooseCols(null, box.w / PRINT_TARGET_SCALE);                 // as many columns as fit the paper ...
    const capCols = typeof OL._fv.flowShape === 'number' ? OL._fv.flowShape : Infinity;   // ... but never more than the "Up to N columns" choice
    OL._fv._colsOverride = Math.min(fitCols, capCols);                            // re-arrange to fit the paper
    OL.renderVisualizer();
    const ready = await waitForDiagram(doc);
    const contentEl = doc.getElementById('fv-content');
    if (!ready || !contentEl) throw new Error('The diagram did not finish drawing. Switch to Steps view and try again.');
    const svgEl = doc.getElementById('fv-svg-layer');
    const width = num(contentEl.style.width) || contentEl.scrollWidth;
    const height = num(contentEl.style.height) || contentEl.scrollHeight;
    const scale = fitScale(box.w, width, 1);
    const pages = planPageBreaks(collectIntervals(contentEl), height, (box.h - PRINT_SLACK) / scale);
    const client = opts.title || 'Flow map';
    const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    // questions, action items and notes: numbered flags on the cards and the list at the end
    const entries = typeof OL.fvCollectItems === 'function' ? OL.fvCollectItems() : [];
    const itemNo = { byStep: {}, byId: {} };
    entries.filter((e) => !e.item.done).forEach((e) => { const k = `${e.res.id}|${e.step.id}`; (itemNo.byStep[k] = itemNo.byStep[k] || []).push(e.label); });
    const appendixHtml = entries.length && typeof OL.fvItemsAppendixHtml === 'function' ? OL.fvItemsAppendixHtml(entries, { title: 'Questions and Action Items', sub: `${client}  \u00b7  ${today}` }) : '';
    // collateral (forms, email templates, sheets, docs): numbered tags on the cards and a list with the links at the end
    const coEntries = typeof OL.fvCollectCollateral === 'function' ? OL.fvCollectCollateral() : [];
    const collateralNo = typeof OL.fvCollateralNumbers === 'function' ? OL.fvCollateralNumbers(coEntries) : null;
    const collateralHtml = coEntries.length && typeof OL.fvCollateralAppendixHtml === 'function' ? OL.fvCollateralAppendixHtml(coEntries, { title: 'Collateral and Templates', sub: `${client}  \u00b7  ${today}` }) : '';
    const html = buildPrintHtml({
      itemNo, collateralNo, appendixHtml: appendixHtml + collateralHtml,
      contentEl, svgEl, width, height, pages, scale, orientation,
      title: client, subtitle: `Flow diagram (${orientation})`, date: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
      headHtml: collectHeadHtml(doc), inherit: readInheritedText(contentEl, win),
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
    // the print render set how many columns fit the PAPER; if the screen is not in Steps view that value would linger
    if (prev.layout !== 'steps') { OL._fv._laneCols = prev.laneCols; OL._fv._renderedCols = prev.renderedCols; }
  }
}
