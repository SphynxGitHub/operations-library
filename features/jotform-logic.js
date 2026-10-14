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
  card.formLogic = { at: new Date().toISOString(), fp, rules: norm.rules.slice(0, 200), pages: norm.pages.slice(0, 60), fieldCount: norm.fieldCount, questions: (norm.questions || []).slice(0, 300) };
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


// Jotform labels can be raw HTML (a text element holding a table, say); show only the words
const plain = (v) => { const t = String(v == null ? '' : v).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim(); return t.length > 80 ? t.slice(0, 79) + '…' : t; };
// rules loaded before the wording was improved may still hold raw JSON as their text; read it as a sentence
const tidy = (t) => {
  const x = String((t && t.text) || '');
  if (x.charAt(0) !== '{') return x.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  try { return describeRawAction(JSON.parse(x)); } catch (e) { return x.length > 100 ? x.slice(0, 99) + '…' : x; }
};
const condText = (r) => (r.when.length ? r.when.map((w) => `${plain(w.fieldLabel)} ${w.op}${w.value ? ' ' + w.value : ''}`).join(r.link === 'any' ? ' or ' : ' and ') : 'Always');
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


// ---- by question: click a question, see what its answers lead to and what sets it ----------------------------------------
//   [ what controls it ] -> [ the question ] -> [ each answer -> what happens next: another question, a page, a calculation, an email ]
let jlSel = '';
const verbWord = { show: 'Shown', hide: 'Hidden', require: 'Required', 'make optional': 'Optional', enable: 'Enabled', disable: 'Disabled', calculate: 'Calculated' };

function qIndex(fl) {
  const qs = (fl.questions || []).map((q) => ({ ...q, label: plain(q.label) }));
  const byId = new Map(qs.map((q) => [String(q.id), q]));
  const byLabel = new Map(qs.map((q) => [String(q.label || '').toLowerCase(), q]));
  const trig = {}; const tgt = {};
  (fl.rules || []).forEach((r) => {
    (r.when || []).forEach((w) => { if (w.field) (trig[w.field] = trig[w.field] || []).push({ r, w }); });
    (r.then || []).forEach((t) => {
      let ids = (t.targetIds || []).map(String);
      if (!ids.length && (t.targets || []).length) ids = t.targets.map((l) => { const q = byLabel.get(String(l).toLowerCase()); return q ? String(q.id) : ''; }).filter(Boolean);   // older loads: match by name
      ids.forEach((id) => (tgt[id] = tgt[id] || []).push({ r, t }));
    });
  });
  return { qs, byId, trig, tgt };
}
const qBtn = (cardId, q, fallback) => q ? `<a href="#" class="jl-qlink" style="color:var(--accent);text-decoration:underline;" onclick="event.preventDefault();OL.jlPickQ('${esc(cardId)}','${esc(q.id)}')">${esc(q.label)}</a>` : esc(fallback || 'a question');

function outcomeHtml(cardId, ix, t) {
  if (t.verb === 'skip') return `<div class="jl-chip jl-chip-then jl-v-skip" style="margin-top:4px;">${esc(t.text)}</div>`;
  if (t.verb === 'calculate') {
    const tgts = (t.targetIds || []).map((id) => qBtn(cardId, ix.byId.get(String(id)), `Question ${id}`)).join(', ') || esc((t.targets || [])[0] || 'a value');
    const src = (t.sources || []).map((id) => qBtn(cardId, ix.byId.get(String(id)), `Question ${id}`)).join(', ');
    const eq = String(t.text || '').split(' = ')[1];
    return `<div class="jl-chip jl-chip-then jl-v-msg" style="margin-top:4px;">Calculate ${tgts}${eq ? ` = ${esc(eq)}` : ''}${src ? `<div class="muted" style="font-size:10px;margin-top:2px;">from ${src}</div>` : ''}</div>`;
  }
  if (t.targets && t.targets.length) {
    const ids = (t.targetIds && t.targetIds.length) ? t.targetIds : t.targets.map((l) => { const q = (ix.qs || []).find((x) => String(x.label).toLowerCase() === String(l).toLowerCase()); return q ? q.id : ''; });
    const links = t.targets.map((l, i) => qBtn(cardId, ix.byId.get(String(ids[i])), plain(l))).join(', ');
    return `<div class="jl-chip jl-chip-then jl-v-${VERB_CLASS[t.verb] || 'other'}" style="margin-top:4px;">${esc(t.verb)} ${links}</div>`;
  }
  return `<div class="jl-chip jl-chip-then jl-v-${VERB_CLASS[t.verb] || 'other'}" style="margin-top:4px;">${esc(tidy(t))}</div>`;
}

function questionPanelHtml(card, qid) {
  const fl = card.formLogic; const ix = qIndex(fl); const q = ix.byId.get(String(qid));
  if (!q) return '<div class="tiny muted" style="padding:12px;">Pick a question on the left.</div>';
  const cid = card.id;
  // leads to: group by the answer being tested
  const groups = new Map();
  (ix.trig[q.id] || []).forEach(({ r, w }) => {
    const key = `${w.op}${w.value ? ' ' + w.value : ''}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  });
  const right = groups.size ? [...groups.entries()].map(([ans, rs]) => `<div style="border:1px solid var(--line);border-radius:10px;padding:10px;margin-bottom:10px;">
      <div style="font-size:12px;font-weight:600;">If the answer ${esc(ans)}</div>
      ${rs.map((r) => {
        const others = (r.when || []).filter((x) => x.field !== q.id);
        return `<div style="margin-top:6px;display:flex;gap:8px;align-items:flex-start;${r.disabled ? 'opacity:.5;' : ''}"><span style="flex:0 0 auto;margin-top:6px;">${ARROW}</span><div style="min-width:0;">
          ${others.length ? `<div class="muted" style="font-size:10px;margin-top:4px;">${r.link === 'any' ? 'or' : 'and'} ${others.map((x) => `${qBtn(cid, ix.byId.get(String(x.field)), x.fieldLabel)} ${esc(x.op)}${x.value ? ' ' + esc(x.value) : ''}`).join(r.link === 'any' ? ' or ' : ' and ')}</div>` : ''}
          ${r.then.map((t) => outcomeHtml(cid, ix, t)).join('')}${r.disabled ? '<div class="muted" style="font-size:10px;">Turned off in Jotform</div>' : ''}</div></div>`;
      }).join('')}</div>`).join('') : '<div class="tiny muted" style="padding:6px 0;">Nothing happens based on how this question is answered.</div>';
  // set by: rules that show, hide or calculate this question
  const left = (ix.tgt[q.id] || []).length ? ix.tgt[q.id].map(({ r, t }) => `<div style="border:1px solid var(--line);border-radius:10px;padding:10px;margin-bottom:10px;${r.disabled ? 'opacity:.5;' : ''}">
      <div style="font-size:12px;font-weight:600;">${esc(verbWord[t.verb] || t.verb)}${t.verb === 'calculate' ? '' : ' when'}</div>
      ${t.verb === 'calculate' ? `<div style="font-size:12px;margin-top:4px;">${esc(String(t.text || '').split(' = ')[1] || '')}${(t.sources || []).length ? `<div class="muted" style="font-size:10px;margin-top:2px;">from ${t.sources.map((id) => qBtn(cid, ix.byId.get(String(id)), `Question ${id}`)).join(', ')}</div>` : ''}</div>` : ''}
      ${(r.when || []).length ? `<div style="font-size:12px;margin-top:4px;">${r.when.map((x) => `${qBtn(cid, ix.byId.get(String(x.field)), x.fieldLabel)} ${esc(x.op)}${x.value ? ' <span class="jl-val">' + esc(x.value) + '</span>' : ''}`).join(r.link === 'any' ? ' <b>or</b> ' : ' <b>and</b> ')}</div>` : '<div class="muted" style="font-size:11px;margin-top:4px;">Always</div>'}
      </div>`).join('') : '<div class="tiny muted" style="padding:6px 0;">Nothing changes this question. It is always shown as it is.</div>';
  const opts = String(q.options || '').split('|').map((x) => x.trim()).filter(Boolean).slice(0, 12);
  return `<div style="display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap;width:100%;">
      <div style="flex:1 1 260px;min-width:0;"><div class="jl-lbl" style="margin-bottom:6px;">SET BY</div>${left}</div>
      <div style="flex:0 0 auto;align-self:flex-start;margin-top:26px;">${ARROW}</div>
      <div style="flex:0 1 280px;min-width:0;"><div class="jl-lbl" style="margin-bottom:6px;">QUESTION</div>
        <div style="border:2px solid var(--accent);border-radius:12px;padding:12px;background:var(--panel-soft);">
          <div style="font-weight:700;font-size:13px;">${esc(q.label)}</div>
          <div class="muted" style="font-size:11px;margin-top:2px;">${esc(q.type || 'question')}${q.page ? ` · page ${esc(q.page)}` : ''}</div>
          ${opts.length ? `<div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:4px;">${opts.map((o) => `<span class="pill tiny soft">${esc(o)}</span>`).join('')}</div>` : ''}</div></div>
      <div style="flex:0 0 auto;align-self:flex-start;margin-top:26px;">${ARROW}</div>
      <div style="flex:2 1 420px;min-width:0;"><div class="jl-lbl" style="margin-bottom:6px;">THEN, DEPENDING ON THE ANSWER</div>${right}</div></div>`;
}

function questionsViewHtml(card) {
  const fl = card.formLogic; const ix = qIndex(fl);
  if (!ix.qs.length) return '<div class="jl-empty">This form was loaded before its questions were kept. Press Refresh from Jotform to see them here.</div>';
  if (!jlSel || !ix.byId.has(String(jlSel))) { const first = ix.qs.find((q) => (ix.trig[q.id] || []).length || (ix.tgt[q.id] || []).length) || ix.qs[0]; jlSel = String(first.id); }
  let lastPage = null;
  const list = ix.qs.map((q) => {
    const n = (ix.trig[q.id] || []).length + (ix.tgt[q.id] || []).length;
    const head = q.page !== lastPage ? `<div class="tiny muted" style="margin:10px 0 4px;font-weight:700;">${q.page ? `PAGE ${esc(q.page)}` : 'QUESTIONS'}</div>` : ''; lastPage = q.page;
    return `${head}<div class="jl-qrow" data-q="${esc(q.id)}" onclick="OL.jlPickQ('${esc(card.id)}','${esc(q.id)}')" style="display:flex;gap:8px;align-items:center;padding:6px 10px;border:1px solid ${String(q.id) === String(jlSel) ? 'var(--accent)' : 'transparent'};border-radius:8px;cursor:pointer;${n ? '' : 'opacity:.55;'}background:${String(q.id) === String(jlSel) ? 'var(--panel-soft)' : 'transparent'};">
      <span style="flex:1;min-width:0;font-size:12px;">${esc(q.label)}</span>${n ? `<span class="pill tiny soft">${n}</span>` : ''}</div>`;
  }).join('');
  return `<div style="display:grid;grid-template-columns:minmax(240px,320px) minmax(0,1fr);gap:24px;align-items:start;">
      <div id="jl-qlist" style="max-height:calc(100vh - 300px);min-height:300px;overflow:auto;padding-right:6px;">${list}</div>
      <div id="jl-qpanel" style="min-width:0;">${questionPanelHtml(card, jlSel)}</div></div>`;
}

function jlPickQ(cardId, qid, view) {
  const card = findCard(cardId); if (!card || !card.formLogic) return;
  jlSel = String(qid);
  if (view && view !== jlView) { openJotformLogicMap(cardId, view); return; }
  const panel = document.getElementById('jl-qpanel'); const listEl = document.getElementById('jl-qlist');
  if (!panel || !listEl) { openJotformLogicMap(cardId, 'questions'); return; }
  panel.innerHTML = questionPanelHtml(card, jlSel);
  listEl.querySelectorAll('.jl-qrow').forEach((row) => { const on = row.getAttribute('data-q') === jlSel; row.style.borderColor = on ? 'var(--accent)' : 'transparent'; row.style.background = on ? 'var(--panel-soft)' : 'transparent'; if (on) row.scrollIntoView({ block: 'nearest' }); });
}

// ---- the flow map, question by question ---------------------------------------------------------------------------------
// The form top to bottom: each page, its questions in order, then Submitted and the Thank-you step. Where the form branches it shows
// right at that question: a page skip is an arc down the right edge to the page it jumps to; a calculation sits under the question it
// fills in, one line per condition; show/hide and the rest are small lines under the question whose answer triggers them.
function flowListHtml(card) {
  const fl = card.formLogic; const ix = qIndex(fl); const rules = fl.rules || [];
  const arcs = []; const skipsFrom = {}; const calcOn = {}; const condOn = {}; const sideFrom = {}; const submitRules = []; const thanksRules = [];
  const firstQ = (r) => { const w = (r.when || []).find((x) => x.field && ix.byId.has(String(x.field))); return w ? String(w.field) : ''; };
  rules.forEach((r, ri) => {
    const trig = firstQ(r);
    if (r.kind === 'page') {
      const to = targetOf(r);
      if (to !== null && trig) { (skipsFrom[trig] = skipsFrom[trig] || []).push(r); arcs.push({ from: `jlv-q-${trig}`, to: to === 'end' ? 'jlv-end' : `jlv-pg-${to}`, label: condText(r), off: !!r.disabled, i: arcs.length }); return; }
    }
    if (r.kind === 'email') { submitRules.push(r); return; }
    if (r.kind === 'url' || r.kind === 'message') { thanksRules.push(r); return; }
    (r.then || []).forEach((t) => {
      let ids = (t.targetIds || []).map(String);
      if (!ids.length) ids = (t.targets || []).map((l) => { const q = ix.qs.find((x) => String(x.label).toLowerCase() === String(l).toLowerCase()); return q ? String(q.id) : ''; }).filter(Boolean);
      if (t.verb === 'calculate') ids.forEach((id) => (calcOn[id] = calcOn[id] || []).push({ r, t }));
      else if (t.verb !== 'skip') ids.forEach((id) => (condOn[id] = condOn[id] || []).push({ r, t }));
    });
    if (trig) (sideFrom[trig] = sideFrom[trig] || []).push(r);
  });
  const small = 'font-size:11px;line-height:1.45;margin-top:5px;';
  const qRow = (q) => {
    const parts = [];
    (calcOn[q.id] || []).forEach(({ r, t }) => {
      const eq = String(t.text || '').split(' = ')[1] || '';
      parts.push(`<div style="${small}padding:5px 8px;border:1px dashed var(--accent);border-radius:8px;"><span class="jl-lbl">CALCULATED</span> ${eq ? esc(eq) : ''}
        <span class="muted">${(r.when || []).length ? 'when ' + esc(clipT(condText(r), 110)) : 'always'}</span></div>`);
    });
    (skipsFrom[q.id] || []).forEach((r) => { const to = targetOf(r); parts.push(`<div style="${small}"><a href="#" style="color:var(--accent);" onclick="event.preventDefault();OL.jlGoto('${to === 'end' ? 'jlv-end' : 'jlv-pg-' + to}')"><b>Skips ahead</b>: ${esc(clipT(condText(r), 80))} → ${esc(r.then[0] ? tidy(r.then[0]).replace(/^Go to /, '') : 'a later page')}</a></div>`); });
    (sideFrom[q.id] || []).forEach((r) => { parts.push(`<div class="muted" style="${small}">If ${esc(clipT(condText(r), 80))} → ${esc(clipT(r.then.map(tidy).join('; '), 140))}</div>`); });
    const cond = condOn[q.id] || [];
    const tag = cond.length ? `<span class="pill tiny soft" title="${esc(cond.map(({ r, t }) => `${verbWord[t.verb] || t.verb} when ${condText(r)}`).join('\n'))}">Conditional</span>` : '';
    return `<div id="jlv-q-${esc(q.id)}" class="jl-vq" style="position:relative;margin:10px 0 0 0;padding:8px 12px;border:1px solid var(--line);border-radius:10px;background:var(--panel-soft);">
      <span style="position:absolute;left:-23px;top:14px;width:10px;height:10px;border-radius:50%;background:var(--accent);"></span>
      <div style="display:flex;gap:8px;align-items:center;"><span style="flex:1;min-width:0;font-size:13px;font-weight:600;cursor:pointer;" onclick="OL.jlPickQ('${esc(card.id)}','${esc(q.id)}','questions')">${esc(q.label)}</span>${tag}<span class="muted" style="font-size:10px;">${esc(q.type || '')}</span></div>
      ${parts.join('')}</div>`;
  };
  const node = (id, title, sub, extra) => `<div id="${id}" class="jl-vn" style="position:relative;margin:14px 0 0 0;padding:8px 12px;border:1px solid var(--line);border-radius:10px;font-size:12px;font-weight:700;">
      <span style="position:absolute;left:-24px;top:12px;width:12px;height:12px;border-radius:50%;border:2px solid var(--accent);background:var(--panel);"></span>${esc(title)}${sub ? ` <span class="muted" style="font-weight:400;">${esc(sub)}</span>` : ''}${extra || ''}</div>`;
  const ruleChips = (list) => list.map((r) => `<div style="${small}font-weight:400;${r.disabled ? 'opacity:.5;' : ''}">If ${esc(clipT(condText(r), 90))} → ${esc(clipT(r.then.map(tidy).join('; '), 140))}</div>`).join('');
  const pages = fl.pages && fl.pages.length ? fl.pages : [{ n: 1, label: 'Page 1' }];
  let body = node('jlv-start', 'Form opened', '');
  const used = new Set();
  pages.forEach((pg) => {
    body += node(`jlv-pg-${pg.n}`, pg.label || `Page ${pg.n}`, '');
    ix.qs.filter((q) => (q.page || 1) === pg.n).forEach((q) => { used.add(q.id); body += qRow(q); });
  });
  ix.qs.filter((q) => !used.has(q.id)).forEach((q) => { body += qRow(q); });
  body += node('jlv-submit', 'Submitted', submitRules.length ? 'Emails sent' : '', ruleChips(submitRules));
  body += node('jlv-end', 'Thank-you', '', ruleChips(thanksRules));
  return `<div class="jl-vflow" data-arcs='${esc(JSON.stringify(arcs))}' style="position:relative;padding:4px ${arcs.length ? 320 : 20}px 16px 30px;width:100%;box-sizing:border-box;">
      <svg class="jl-varcs" style="position:absolute;left:0;top:0;pointer-events:none;overflow:visible;" width="0" height="0"></svg>
      <div style="position:relative;border-left:2px solid var(--line);margin-left:6px;padding-left:18px;">${body}</div>
      ${arcs.length ? '' : '<div class="tiny muted" style="margin-top:12px;">No page skips in this form, so the pages run in order.</div>'}</div>`;
}

function drawVArcs() {
  const root = document.querySelector('.jl-vflow'); if (!root) return;
  const svg = root.querySelector('.jl-varcs'); if (!svg) return;
  let arcs = []; try { arcs = JSON.parse(root.getAttribute('data-arcs') || '[]'); } catch (e) { arcs = []; }
  const rb = root.getBoundingClientRect();
  const edge = (id) => { const el = document.getElementById(id); if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.right - rb.left, y: b.top - rb.top + Math.min(b.height / 2, 22) }; };
  svg.setAttribute('width', root.scrollWidth); svg.setAttribute('height', root.scrollHeight);
  let out = '<defs><marker id="jlv-ah" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="currentColor"/></marker></defs>';
  arcs.forEach((a) => {
    const p0 = edge(a.from), p1 = edge(a.to); if (!p0 || !p1) return;
    const L = 40 + (a.i % 4) * 46; const mx = Math.max(p0.x, p1.x) + L;
    out += `<g style="color:var(--accent);${a.off ? 'opacity:.4;' : ''}"><path d="M${p0.x},${p0.y} C${mx},${p0.y} ${mx},${p1.y} ${p1.x + 2},${p1.y}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="${a.off ? '4 3' : '0'}" marker-end="url(#jlv-ah)"/>`;
    const t = clipT(a.label, 34); const ly = (p0.y + p1.y) / 2; const lx = mx - 4;
    out += `<rect x="${lx - 2}" y="${ly - 9}" width="${t.length * 5.8 + 14}" height="17" rx="8" fill="var(--panel)" stroke="currentColor" stroke-width=".8"/><text x="${lx + 5}" y="${ly + 3}" font-size="10" style="fill:var(--text-main,currentColor)">${esc(t)}</text></g>`;
  });
  svg.innerHTML = out;
}
function jlGoto(id) {
  const el = document.getElementById(id); if (!el) return;
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.style.outline = '2px solid var(--accent)'; setTimeout(() => { el.style.outline = ''; }, 1400);
}

let jlView = 'questions';
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
    <div class="modal-body jl-body" style="max-width:none;width:100%;">
      <div class="jl-summary">
        <strong>${fl.rules.length} rule${fl.rules.length === 1 ? '' : 's'}</strong>${fl.rules.length ? ` · ${esc(summarizeLogic(norm))}` : ''}
        · ${fl.fieldCount || 0} questions${(fl.pages || []).length > 1 ? ` · ${(fl.pages || []).length} pages` : ''} · loaded ${esc(ago(fl.at))}
      </div>
      ${fl.rules.length ? `<div style="display:flex;gap:6px;margin:10px 0;">
        <button class="btn tiny ${jlView === 'questions' ? 'primary' : 'soft'}" onclick="OL.openJotformLogicMap('${esc(card.id)}','questions')">By question</button>
        <button class="btn tiny ${jlView === 'flow' ? 'primary' : 'soft'}" onclick="OL.openJotformLogicMap('${esc(card.id)}','flow')">Flow map</button>
        <button class="btn tiny ${jlView === 'list' ? 'primary' : 'soft'}" onclick="OL.openJotformLogicMap('${esc(card.id)}','list')">Rule list</button></div>` : ''}
      ${!fl.rules.length ? '<div class="jl-empty">This form has no conditional logic. Everyone sees every question and the same thank-you step.</div>'
        : (jlView === 'questions' ? questionsViewHtml(card) : (jlView === 'flow' ? (fl.questions && fl.questions.length ? flowListHtml(card) : flowHtml(fl)) : fl.rules.map(ruleHtml).join('')))}
      <div class="tiny muted" style="margin-top:12px;">Read-only. The rules are edited in Jotform; this map is a reading of them, refreshed whenever Jotform is pulled.</div>
    </div>`;
  if (typeof OL.showOverlayModal === 'function') OL.showOverlayModal(`<div style="width:100%;">${html}</div>`, { wide: true }); else window.openModal(html);
  if (window.lucide) window.lucide.createIcons();
  if (jlView === 'flow') requestAnimationFrame(() => requestAnimationFrame(() => { drawFlowArcs(); drawVArcs(); }));
}

window.OL = window.OL || {};
Object.assign(window.OL, { jlGoto, jlPickQ, loadJotformLogic, openJotformLogicMap, refreshLoadedFormLogic, logicAgo: ago });
export { loadJotformLogic, openJotformLogicMap, refreshLoadedFormLogic, ago as logicAgo };
