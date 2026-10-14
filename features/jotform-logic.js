// ================================================================================================
// FILE: features/jotform-logic.js
//
// WHAT IT DOES:   A form's conditional logic as a small map. A Jotform card on the flow map gets a "Form logic" callout; it loads
//                 the form's rules from Jotform (show or hide questions, skip to a page, send an email, change the thank-you
//                 step) and draws them as IF -> THEN rows. Forms themselves are not rebuilt here, only their logic is shown.
//
// LOADED ON REQUEST, NOT WITH EVERY PULL: reading one form's logic is two more calls to Jotform, so it is fetched when someone asks
//                 and kept on the card (card.formLogic). After that, every pull of Jotform refreshes the logic of the forms that
//                 have it (up to a few at a time) and reports a form whose rules changed.
//
// USED BY:        features/flow-visualizer/callouts.js (the chip and its buttons), features/integrations.js (the refresh on a pull).
// NEEDS:          the integration-import function with the formId option (supabase/functions/_shared/integrations.ts), core/jotform-logic.js.
// ================================================================================================

import { esc, getActiveClient, persist, markClientDirty } from '../core/data.js';
import { importFrom } from '../core/secrets.js';
import { normalizeJotformLogic, logicFingerprint, summarizeLogic, describeRawAction } from '../core/jotform-logic.js';

const projectCards = () => (window.OL?.getCurrentProjectData ? window.OL.getCurrentProjectData().resources || [] : []);
const findCard = (id) => projectCards().find((r) => String(r.id) === String(id));
const ago = (iso) => {
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (!Number.isFinite(mins)) return '';
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  return h < 36 ? `${h} hr ago` : `${Math.round(h / 24)} days ago`;
};
const toast = (t) => { if (typeof OL.showToast === 'function') OL.showToast(t); else console.info(t); };

async function fetchLogic(client, card) {
  const creds = OL.getCredsForApp ? OL.getCredsForApp(client, 'jotform') : null;
  if (!creds || !(creds.secretSet || String(creds.secret || '').trim())) throw new Error('Add the Jotform API key in Credentials first.');
  const raw = await importFrom('jotform', client.id, creds.id, { formId: String(card.externalId) });
  const norm = normalizeJotformLogic({ conditions: raw.conditions, questions: raw.questions });
  return { norm, fp: logicFingerprint(norm) };
}

function store(card, norm, fp) {
  card.formLogic = { at: new Date().toISOString(), fp, rules: norm.rules.slice(0, 200), pages: norm.pages.slice(0, 60), fieldCount: norm.fieldCount };
}

// ---- load one form's logic (the "Load form logic" button) ---------------------------------------------------
async function loadJotformLogic(resId, opts = {}) {
  const client = getActiveClient();
  const card = findCard(resId);
  if (!client || !card || card.source !== 'jotform' || card.externalId == null) { toast('Open a project with a pulled Jotform form first.'); return; }
  toast(`Loading the logic of “${card.name}”...`);
  try {
    const { norm, fp } = await fetchLogic(client, card);
    store(card, norm, fp);
    markClientDirty(client.id);
    await persist();
  } catch (e) {
    console.warn('Loading form logic failed:', e);
    toast(`Could not load that form's logic: ${e.message || e}`);
    return;
  }
  // loaded and saved; drawing it is separate, so a screen problem is never reported as a loading problem
  try {
    if (typeof OL.fvRefreshCallouts === 'function') OL.fvRefreshCallouts(resId);
    if (opts.open !== false) openJotformLogicMap(resId);
  } catch (e) { console.warn('Could not draw the form logic:', e); }
}

// Called by a Jotform pull: re-reads the logic of the forms that already have it. Returns the names of forms whose rules changed.
async function refreshLoadedFormLogic(client, cap = 10) {
  const changed = [];
  const cards = (client.projectData?.localResources || []).filter((r) => r && r.source === 'jotform' && r.formLogic && r.externalId != null && !r.missingUpstream).slice(0, cap);
  for (const card of cards) {
    try {
      const { norm, fp } = await fetchLogic(client, card);
      if (card.formLogic.fp !== fp) { store(card, norm, fp); changed.push(card.name); } else card.formLogic.at = new Date().toISOString();
    } catch (e) { console.warn(`Could not refresh the logic of ${card.name}:`, e); }
  }
  return changed;
}

// ---- the map -------------------------------------------------------------------------------------------------
const KIND_LABEL = { calculation: 'Calculate a value', field: 'Show or hide questions', page: 'Skip to a page', email: 'Send an email', url: 'Change the thank-you address', message: 'Change the thank-you message', other: 'Other rule' };
const VERB_CLASS = { calculate: 'msg', show: 'show', hide: 'hide', require: 'show', 'make optional': 'hide', enable: 'show', disable: 'hide', skip: 'skip', email: 'email', url: 'msg', message: 'msg', other: 'other' };
const ARROW = '<svg class="jl-arrow-svg" viewBox="0 0 28 12" width="28" height="12" aria-hidden="true"><path d="M1 6h24M20 1.5 26 6l-6 4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function ruleHtml(r) {
  const ifChips = r.when.length
    ? r.when.map((w, i) => `${i ? `<div class="jl-join">${r.link === 'any' ? 'OR' : 'AND'}</div>` : ''}
        <div class="jl-chip jl-chip-if"><strong>${esc(w.fieldLabel)}</strong> ${esc(w.op)}${w.value ? ` <span class="jl-val">${esc(w.value)}</span>` : ''}</div>`).join('')
    : '<div class="jl-chip jl-chip-if">Always</div>';
  const thenChips = r.then.map((t) => `<div class="jl-chip jl-chip-then jl-v-${VERB_CLASS[t.verb] || 'other'}">${esc(tidy(t))}</div>`).join('');
  return `
    <div class="jl-rule jl-k-${r.kind}${r.disabled ? ' is-off' : ''}">
      <div class="jl-rule-head"><span class="jl-n">Rule ${esc(r.index)}</span><span class="jl-kind">${esc(KIND_LABEL[r.kind] || KIND_LABEL.other)}</span>${r.disabled ? '<span class="jl-off">Turned off in Jotform</span>' : ''}</div>
      <div class="jl-flow">
        <div class="jl-col"><div class="jl-lbl">IF ${r.when.length > 1 ? (r.link === 'any' ? 'any of' : 'all of') : ''}</div>${ifChips}</div>
        <div class="jl-arrow">${ARROW}</div>
        <div class="jl-col"><div class="jl-lbl">THEN</div>${thenChips}</div>
      </div>
    </div>`;
}


// ---- the flow map: the form's pages as a line, with each rule hung where it happens ---------------------------------
// Start -> Page 1 -> Page 2 ... -> Submit -> Thank-you. A "skip to a page" rule is an arc from the page its question is on to the page
// it jumps to; show/hide rules sit under the page of the question they watch; emails hang off Submit; thank-you changes hang off the
// Thank-you step. Rules read from an older load carry no page numbers, so they sit under Start ("Any page") until Refresh from Jotform.

// rules loaded before the wording was improved may still hold raw JSON as their text; read it as a sentence
const tidy = (t) => {
  const x = String((t && t.text) || '');
  if (x.charAt(0) !== '{') return x;
  try { return describeRawAction(JSON.parse(x)); } catch (e) { return x.length > 100 ? x.slice(0, 99) + '…' : x; }
};
const condText = (r) => (r.when.length ? r.when.map((w) => `${w.fieldLabel} ${w.op}${w.value ? ' ' + w.value : ''}`).join(r.link === 'any' ? ' or ' : ' and ') : 'Always');
const clipT = (t, n) => { const x = String(t || ''); return x.length > n ? x.slice(0, n - 1) + '…' : x; };
const targetOf = (r) => {
  const t = (r.then || []).find((x) => x.verb === 'skip'); if (!t) return null;
  if (t.targetPage !== undefined && t.targetPage !== null) return t.targetPage;
  if (/end of the form/i.test(t.text || '')) return 'end';
  const m = String(t.text || '').match(/Page (\d+)/i); return m ? Number(m[1]) : null;
};
const srcPage = (r) => { const w = r.when.find((x) => x.page); return w ? w.page : null; };

function flowHtml(fl) {
  const rules = fl.rules || [];
  const pageCount = Math.max(1, (fl.pages || []).length);
  const nodeStyle = 'min-width:130px;max-width:190px;padding:8px 12px;border:1px solid var(--line);border-radius:10px;background:var(--panel-soft);font-size:12px;font-weight:600;text-align:center;';
  const chip = (r) => `<div class="jl-fchip${r.disabled ? ' is-off' : ''}" style="margin-top:8px;padding:6px 8px;border:1px solid var(--line);border-radius:8px;font-size:11px;line-height:1.4;max-width:190px;${r.disabled ? 'opacity:.5;' : ''}">
      <div class="muted" style="font-size:10px;">IF ${esc(clipT(condText(r), 90))}</div>
      ${r.then.map((t) => `<div class="jl-chip-then jl-v-${VERB_CLASS[t.verb] || 'other'}" style="margin-top:3px;">${esc(clipT(tidy(t), 90))}</div>`).join('')}
      ${r.disabled ? '<div class="muted" style="font-size:10px;">Turned off in Jotform</div>' : ''}</div>`;
  const under = { start: [], submit: [], thanks: [] }; const pageRules = {};
  const arcs = [];
  rules.forEach((r) => {
    if (r.kind === 'page') {
      const to = targetOf(r); const from = srcPage(r);
      if (to !== null && from) { arcs.push({ from, to, label: condText(r), off: r.disabled }); return; }
      (from ? (pageRules[from] = pageRules[from] || []) : under.start).push(r); return;
    }
    if (r.kind === 'email') { under.submit.push(r); return; }
    if (r.kind === 'url' || r.kind === 'message') { under.thanks.push(r); return; }
    const pg = srcPage(r);
    if (pg) (pageRules[pg] = pageRules[pg] || []).push(r); else under.start.push(r);
  });
  const col = (id, title, items, sub) => `<div class="jl-fcol" style="display:flex;flex-direction:column;align-items:center;flex:0 0 auto;">
      <div id="${id}" class="jl-fnode" style="${nodeStyle}">${esc(title)}${sub ? `<div class="muted" style="font-weight:400;font-size:10px;margin-top:2px;">${esc(sub)}</div>` : ''}</div>
      ${items.map(chip).join('')}</div>`;
  const arrow = '<div style="flex:0 0 auto;align-self:flex-start;margin-top:11px;opacity:.6;">' + ARROW + '</div>';
  const cols = [col('jlf-start', 'Form opened', under.start, under.start.length ? 'Any page' : '')];
  for (let n = 1; n <= pageCount; n++) cols.push(col(`jlf-p${n}`, ((fl.pages || [])[n - 1] || {}).label || `Page ${n}`, pageRules[n] || []));
  cols.push(col('jlf-submit', 'Submitted', under.submit, under.submit.length ? 'Emails sent' : ''));
  cols.push(col('jlf-end', 'Thank-you', under.thanks));
  const space = 34 + arcs.length * 0 + Math.min(arcs.length, 6) * 24;
  return `<div class="jl-flowmap" data-arcs='${esc(JSON.stringify(arcs))}' style="position:relative;overflow:auto;padding:${space}px 8px 12px;">
      <svg class="jl-farcs" style="position:absolute;left:0;top:0;pointer-events:none;overflow:visible;" width="0" height="0"></svg>
      <div style="display:flex;gap:14px;align-items:flex-start;width:max-content;">${cols.join(arrow)}</div>
      ${arcs.length ? '' : '<div class="tiny muted" style="margin-top:12px;">No page skips in this form, so the pages run in order.</div>'}
    </div>`;
}

function drawFlowArcs() {
  const root = document.querySelector('.jl-flowmap'); if (!root) return;
  const svg = root.querySelector('.jl-farcs'); if (!svg) return;
  let arcs = []; try { arcs = JSON.parse(root.getAttribute('data-arcs') || '[]'); } catch (e) { arcs = []; }
  const rb = root.getBoundingClientRect();
  const topOf = (id) => { const el = document.getElementById(id); if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.left - rb.left + root.scrollLeft + b.width / 2, y: b.top - rb.top + root.scrollTop }; };
  const w = root.scrollWidth, h = root.scrollHeight;
  svg.setAttribute('width', w); svg.setAttribute('height', h);
  let out = '<defs><marker id="jlf-ah" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="currentColor"/></marker></defs>';
  arcs.forEach((a, i) => {
    const p0 = topOf(`jlf-p${a.from}`); const p1 = topOf(a.to === 'end' ? 'jlf-end' : `jlf-p${a.to}`);
    if (!p0 || !p1) return;
    const lift = 26 + (i % 6) * 22;
    const mx = (p0.x + p1.x) / 2; const cy = Math.min(p0.y, p1.y) - lift * 2;
    out += `<g style="color:var(--accent);${a.off ? 'opacity:.4;' : ''}"><path d="M${p0.x},${p0.y} Q${mx},${cy} ${p1.x},${p1.y}" fill="none" stroke="currentColor" stroke-width="1.6" marker-end="url(#jlf-ah)"/>`;
    const ly = (p0.y + 2 * cy + p1.y) / 4; const t = clipT(a.label, 46);
    out += `<rect x="${mx - t.length * 3.1 - 6}" y="${ly - 9}" width="${t.length * 6.2 + 12}" height="16" rx="8" fill="var(--panel)" stroke="currentColor" stroke-width=".8"/><text x="${mx}" y="${ly + 3}" text-anchor="middle" font-size="10" fill="currentColor" style="fill:var(--text-main,currentColor)">${esc(t)}</text></g>`;
  });
  svg.innerHTML = out;
}

let jlView = 'flow';
function openJotformLogicMap(resId, view) {
  if (view) jlView = view;
  const card = findCard(resId);
  if (!card || !card.formLogic) { loadJotformLogic(resId); return; }
  const fl = card.formLogic;
  const norm = { rules: fl.rules || [] };
  const html = `
    <div class="modal-head">
      <div class="modal-title-text">Form logic: ${esc(card.name)}</div>
      <div class="spacer"></div>
      <button class="btn small soft" onclick="OL.loadJotformLogic('${esc(card.id)}')">Refresh from Jotform</button>
      ${card.externalUrl ? `<a class="btn small soft" href="${esc(card.externalUrl)}" target="_blank" rel="noopener noreferrer">Open the form</a>` : ''}
      <button class="btn small soft" onclick="OL.closeModal()">Close</button>
    </div>
    <div class="modal-body jl-body">
      <div class="jl-summary">
        <strong>${fl.rules.length} rule${fl.rules.length === 1 ? '' : 's'}</strong>${fl.rules.length ? ` · ${esc(summarizeLogic(norm))}` : ''}
        · ${fl.fieldCount || 0} questions${(fl.pages || []).length > 1 ? ` · ${(fl.pages || []).length} pages` : ''} · loaded ${esc(ago(fl.at))}
      </div>
      ${fl.rules.length ? `<div style="display:flex;gap:6px;margin:10px 0;">
        <button class="btn tiny ${jlView === 'flow' ? 'primary' : 'soft'}" onclick="OL.openJotformLogicMap('${esc(card.id)}','flow')">Flow map</button>
        <button class="btn tiny ${jlView === 'list' ? 'primary' : 'soft'}" onclick="OL.openJotformLogicMap('${esc(card.id)}','list')">Rule list</button></div>` : ''}
      ${!fl.rules.length ? '<div class="jl-empty">This form has no conditional logic. Everyone sees every question and the same thank-you step.</div>'
        : (jlView === 'flow' ? flowHtml(fl) : fl.rules.map(ruleHtml).join(''))}
      <div class="tiny muted" style="margin-top:12px;">Read-only. The rules are edited in Jotform; this map is a reading of them, refreshed whenever Jotform is pulled.</div>
    </div>`;
  if (typeof OL.showOverlayModal === 'function') OL.showOverlayModal(`<div style="width:100%;">${html}</div>`, { wide: true }); else window.openModal(html);
  if (window.lucide) window.lucide.createIcons();
  if (jlView === 'flow') requestAnimationFrame(() => requestAnimationFrame(drawFlowArcs));
}

window.OL = window.OL || {};
Object.assign(window.OL, { loadJotformLogic, openJotformLogicMap, refreshLoadedFormLogic, logicAgo: ago });
export { loadJotformLogic, openJotformLogicMap, refreshLoadedFormLogic, ago as logicAgo };
