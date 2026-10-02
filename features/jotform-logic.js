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
import { normalizeJotformLogic, logicFingerprint, summarizeLogic } from '../core/jotform-logic.js';

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
const KIND_LABEL = { field: 'Show or hide questions', page: 'Skip to a page', email: 'Send an email', url: 'Change the thank-you address', message: 'Change the thank-you message', other: 'Other rule' };
const VERB_CLASS = { show: 'show', hide: 'hide', require: 'show', 'make optional': 'hide', enable: 'show', disable: 'hide', skip: 'skip', email: 'email', url: 'msg', message: 'msg', other: 'other' };
const ARROW = '<svg class="jl-arrow-svg" viewBox="0 0 28 12" width="28" height="12" aria-hidden="true"><path d="M1 6h24M20 1.5 26 6l-6 4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function ruleHtml(r) {
  const ifChips = r.when.length
    ? r.when.map((w, i) => `${i ? `<div class="jl-join">${r.link === 'any' ? 'OR' : 'AND'}</div>` : ''}
        <div class="jl-chip jl-chip-if"><strong>${esc(w.fieldLabel)}</strong> ${esc(w.op)}${w.value ? ` <span class="jl-val">${esc(w.value)}</span>` : ''}</div>`).join('')
    : '<div class="jl-chip jl-chip-if">Always</div>';
  const thenChips = r.then.map((t) => `<div class="jl-chip jl-chip-then jl-v-${VERB_CLASS[t.verb] || 'other'}">${esc(t.text)}</div>`).join('');
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

function openJotformLogicMap(resId) {
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
      ${fl.rules.length ? fl.rules.map(ruleHtml).join('') : '<div class="jl-empty">This form has no conditional logic. Everyone sees every question and the same thank-you step.</div>'}
      <div class="tiny muted" style="margin-top:12px;">Read-only. The rules are edited in Jotform; this map is a reading of them, refreshed whenever Jotform is pulled.</div>
    </div>`;
  window.openModal(html);
  if (window.lucide) window.lucide.createIcons();
}

window.OL = window.OL || {};
Object.assign(window.OL, { loadJotformLogic, openJotformLogicMap, refreshLoadedFormLogic, logicAgo: ago });
export { loadJotformLogic, openJotformLogicMap, refreshLoadedFormLogic, ago as logicAgo };
