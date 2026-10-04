// ================================================================================================
// FILE: features/flow-visualizer/callouts.js
//
// WHAT IT DOES:   "Callouts" on the flow map: small reference chips on a card for things that are not part of the
//                 flow itself - an email template, a form template, a spreadsheet, a document, a folder. Click a
//                 chip and a mini card opens right on the flow card (name, type, link, note, which steps use it).
//
// WHERE THEY COME FROM:
//                 1. Linked resources: any resource of one of the reference types below that a step links to
//                    (the Zap import already links the folders and spreadsheets a Zap uses, so those appear by
//                    themselves). They open the same way and can also be opened in the library.
//                 2. Added by hand: "+" on a card. Stored on the card itself as card.callouts = [{id, kind, name,
//                    url, note}] - no library resource needed, so an outside form or sheet only needs a name and a link.
//
// USED BY:        _fvBuildCard (features/flow-visualizer/core.js) calls OL.fvCalloutStrip(card).
// ================================================================================================

import { esc, uid } from '../../core/data.js';

export const CALLOUT_KINDS = [
  { key: 'email',       label: 'Email template', icon: 'mail' },
  { key: 'form',        label: 'Form template',  icon: 'file-text' },
  { key: 'spreadsheet', label: 'Spreadsheet',    icon: 'table' },
  { key: 'document',    label: 'Document',       icon: 'file' },
  { key: 'folder',      label: 'Folder',         icon: 'folder' },
  { key: 'other',       label: 'Other',          icon: 'paperclip' },
];
const KIND = Object.fromEntries(CALLOUT_KINDS.map((k) => [k.key, k]));

// Library resource types that are references rather than flow steps, mapped to a callout kind.
const TYPE_TO_KIND = {
  'folder': 'folder', 'spreadsheet': 'spreadsheet', 'document': 'document', 'doc': 'document',
  'email template': 'email', 'email': 'email', 'signature': 'email', 'form template': 'form', 'template': 'other',
};
export const calloutKindForType = (type) => TYPE_TO_KIND[String(type || '').trim().toLowerCase()] || null;

const safeUrl = (u) => { const v = String(u || '').trim(); return /^https?:\/\//i.test(v) ? v : ''; };
const clip = (s, n) => { const t = String(s || ''); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
const icon = (name, size = 12) => `<i data-lucide="${name}" style="width:${size}px;height:${size}px;display:inline-block;vertical-align:middle;"></i>`;

const projectData = () => (window.OL?.getCurrentProjectData ? window.OL.getCurrentProjectData() : { resources: [] });
const findCard = (id) => (projectData().resources || []).find((r) => String(r.id) === String(id));

// ---- what a card shows ----------------------------------------------------------------------------------
export function calloutsFor(res, lookup = (id) => (window.OL?.getResourceById ? window.OL.getResourceById(id) : null)) {
  const out = [];
  const seen = new Set();

  (res.steps || []).forEach((step) => {
    (step.links || []).forEach((l) => {
      const kind = calloutKindForType(l.type);
      if (!kind || seen.has(l.id)) return;
      seen.add(l.id);
      let lib = null; try { lib = lookup(l.id); } catch { /* the linked resource may have been deleted */ }
      const usedIn = (res.steps || []).filter((s) => (s.links || []).some((x) => x.id === l.id)).map((s) => s.name || 'Step');
      out.push({
        key: `l:${l.id}`, source: 'link', kind, linkId: l.id, name: (lib && lib.name) || l.name || 'Untitled',
        url: safeUrl(lib && (lib.externalUrl || lib.url)), note: String((lib && (lib.description || lib.notes)) || ''), usedIn,
        missing: !lib,
      });
    });
  });

  // A pulled Jotform form: its conditional logic (loaded on request, features/jotform-logic.js).
  if (res.source === 'jotform' && res.externalId != null) {
    const fl = res.formLogic;
    out.push({
      key: 'logic', source: 'logic', kind: 'form', name: fl ? `Form logic (${(fl.rules || []).length})` : 'Form logic',
      url: '', usedIn: [], loaded: !!fl, loadedAt: fl && fl.at,
      note: fl ? ((fl.rules || []).length ? `Show or hide questions, page skips and emails in this form. Loaded ${typeof OL.logicAgo === 'function' ? OL.logicAgo(fl.at) : ''}.` : 'This form has no conditional logic.')
               : 'Which questions show or hide, where it skips to, and which emails it sends. Load it to see it as a map.',
    });
  }

  (res.callouts || []).forEach((c) => {
    if (!c || !c.id) return;
    out.push({ key: `m:${c.id}`, source: 'manual', kind: KIND[c.kind] ? c.kind : 'other', id: c.id, name: c.name || 'Untitled', url: safeUrl(c.url), note: c.note || '', usedIn: [] });
  });
  return out;
}

// Linked asset ids the strip already shows, so the card does not draw them twice.
export const calloutLinkIds = (res) => new Set(calloutsFor(res).filter((c) => c.source === 'link').map((c) => String(c.linkId)));

// ---- drawing --------------------------------------------------------------------------------------------
const openSet = () => { window.OL._fv = window.OL._fv || {}; return (window.OL._fv._openCallouts = window.OL._fv._openCallouts || new Set()); };

function panelHtml(res, c) {
  const k = KIND[c.kind] || KIND.other;
  const rid = esc(res.id), ck = esc(c.key);
  return `
    <div class="fv-callout-panel" onclick="event.stopPropagation()">
      <div class="fv-callout-panel-head">
        <span class="fv-callout-kind">${icon(k.icon, 11)} ${esc(k.label)}</span>
        <button type="button" class="fv-callout-x" title="Close" onclick="event.stopPropagation(); OL.fvToggleCallout('${rid}','${ck}')">${icon('x', 11)}</button>
      </div>
      <div class="fv-callout-title">${esc(c.name)}</div>
      ${c.note ? `<div class="fv-callout-note">${esc(clip(c.note, 400))}</div>` : ''}
      ${c.usedIn && c.usedIn.length ? `<div class="fv-callout-meta">Used in: ${esc(c.usedIn.slice(0, 4).join(', '))}${c.usedIn.length > 4 ? ` +${c.usedIn.length - 4} more` : ''}</div>` : ''}
      ${c.missing ? `<div class="fv-callout-meta">The linked library item is no longer there.</div>` : ''}
      <div class="fv-callout-actions">
        ${c.url ? `<a class="btn tiny primary" href="${esc(c.url)}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">Open ${icon('external-link', 11)}</a>` : ''}
        ${c.source === 'logic' ? `
          ${c.loaded ? `<button type="button" class="btn tiny primary" onclick="event.stopPropagation(); OL.openJotformLogicMap('${rid}')">Open logic map</button>` : ''}
          <button type="button" class="btn tiny ${c.loaded ? 'soft' : 'primary'}" onclick="event.stopPropagation(); OL.loadJotformLogic('${rid}', { open: ${c.loaded ? 'false' : 'true'} })">${c.loaded ? 'Refresh' : 'Load form logic'}</button>` : ''}
        ${c.source === 'link' && !c.missing ? `<button type="button" class="btn tiny soft" onclick="event.stopPropagation(); OL.openInspector('${esc(c.linkId)}', null, 'cards')">In library</button>` : ''}
        ${c.source === 'manual' ? `<button type="button" class="btn tiny soft" onclick="event.stopPropagation(); OL.fvEditCallout('${rid}','${esc(c.id)}')">Edit</button>
          <button type="button" class="btn tiny soft" onclick="event.stopPropagation(); OL.fvRemoveCallout('${rid}','${esc(c.id)}')">Remove</button>` : ''}
      </div>
    </div>`;
}

export function calloutStripInner(res) {
  const list = calloutsFor(res);
  const open = openSet();
  const chips = list.map((c) => {
    const k = KIND[c.kind] || KIND.other;
    const on = open.has(`${res.id}|${c.key}`);
    return `<button type="button" class="fv-callout-chip${on ? ' is-open' : ''}" data-co-key="${esc(c.key)}" title="${esc(k.label)}: ${esc(c.name)}"
              onclick="event.stopPropagation(); OL.fvToggleCallout('${esc(res.id)}','${esc(c.key)}')">${icon(k.icon, 11)}<span>${esc(clip(c.name, 18))}</span></button>`;
  }).join('');
  const panels = list.filter((c) => open.has(`${res.id}|${c.key}`)).map((c) => panelHtml(res, c)).join('');
  const add = `<button type="button" class="fv-callout-add" title="Add a callout (template, sheet, doc, folder)" onclick="event.stopPropagation(); OL.fvEditCallout('${esc(res.id)}')">${icon('plus', 11)}</button>`;
  return `<div class="fv-callout-row">${chips}${add}</div>${panels}`;
}

export function calloutStrip(res) {
  return `<div class="fv-callouts${calloutsFor(res).length ? ' has-items' : ''}" data-callouts-for="${esc(res.id)}">${calloutStripInner(res)}</div>`;
}

function refresh(resId) {
  const res = findCard(resId); if (!res) return;
  document.querySelectorAll(`[data-callouts-for="${CSS.escape(String(resId))}"]`).forEach((el) => {
    el.innerHTML = calloutStripInner(res);
    el.classList.toggle('has-items', calloutsFor(res).length > 0);
  });
  if (window.lucide) window.lucide.createIcons();
}

// ---- actions --------------------------------------------------------------------------------------------
function toggle(resId, key) {
  const set = openSet(); const k = `${resId}|${key}`;
  if (set.has(k)) set.delete(k); else set.add(k);
  refresh(resId);
}

function editCallout(resId, calloutId) {
  const res = findCard(resId); if (!res) return;
  const cur = calloutId ? (res.callouts || []).find((c) => c.id === calloutId) : null;
  const html = `
    <div class="modal-head"><div class="modal-title-text">${cur ? 'Edit callout' : 'Add a callout'}</div>
      <button class="btn small soft" onclick="OL.closeModal()">Close</button></div>
    <div class="modal-body" style="max-width:460px;">
      <p class="tiny muted" style="margin-top:0;">A reference that sits on <strong>${esc(res.name)}</strong> but is not a step in the flow. Outside forms and sheets only need a name and a link.</p>
      <label class="tiny muted" style="display:block;font-weight:600;margin:10px 0 3px;">Type</label>
      <select id="fvco-kind" class="modal-input">${CALLOUT_KINDS.map((k) => `<option value="${k.key}" ${cur && cur.kind === k.key ? 'selected' : ''}>${esc(k.label)}</option>`).join('')}</select>
      <label class="tiny muted" style="display:block;font-weight:600;margin:10px 0 3px;">Name</label>
      <input id="fvco-name" class="modal-input" type="text" value="${esc(cur ? cur.name : '')}" placeholder="e.g. Welcome email template">
      <label class="tiny muted" style="display:block;font-weight:600;margin:10px 0 3px;">Link (optional)</label>
      <input id="fvco-url" class="modal-input" type="text" value="${esc(cur ? cur.url || '' : '')}" placeholder="https://">
      <label class="tiny muted" style="display:block;font-weight:600;margin:10px 0 3px;">Note (optional)</label>
      <textarea id="fvco-note" class="modal-input" rows="3" placeholder="What it is, when it is used, anything to watch for">${esc(cur ? cur.note || '' : '')}</textarea>
      <div id="fvco-err" class="tiny" style="color:#dc2626;min-height:16px;margin-top:6px;"></div>
      <div style="display:flex;gap:8px;margin-top:6px;"><button class="btn primary" onclick="OL.fvSaveCallout('${esc(resId)}','${esc(calloutId || '')}')">Save</button></div>
    </div>`;
  window.openModal(html);
}

function saveCallout(resId, calloutId) {
  const res = findCard(resId); if (!res) return;
  const v = (id) => (document.getElementById(id)?.value || '').trim();
  const name = v('fvco-name'); const url = v('fvco-url');
  const err = document.getElementById('fvco-err');
  if (!name) { if (err) err.textContent = 'Give it a name.'; return; }
  if (url && !safeUrl(url)) { if (err) err.textContent = 'The link needs to start with http:// or https://'; return; }
  const next = (res.callouts || []).map((c) => ({ ...c }));
  const entry = { id: calloutId || `co-${uid()}`, kind: v('fvco-kind') || 'other', name, url, note: v('fvco-note') };
  const i = next.findIndex((c) => c.id === entry.id);
  if (i >= 0) next[i] = entry; else next.push(entry);
  window.OL.closeModal();
  window.OL.handleResourceSave(resId, 'callouts', next);
  openSet().add(`${resId}|m:${entry.id}`);
  refresh(resId);
}

function removeCallout(resId, calloutId) {
  const res = findCard(resId); if (!res) return;
  if (!confirm('Remove this callout from the card?')) return;
  openSet().delete(`${resId}|m:${calloutId}`);
  window.OL.handleResourceSave(resId, 'callouts', (res.callouts || []).filter((c) => c.id !== calloutId));
  refresh(resId);
}

window.OL = window.OL || {};
Object.assign(window.OL, {
  fvCalloutStrip: calloutStrip, fvCalloutsFor: calloutsFor, fvCalloutLinkIds: calloutLinkIds, fvCalloutKinds: CALLOUT_KINDS,
  fvRefreshCallouts: refresh, fvToggleCallout: toggle, fvEditCallout: editCallout, fvSaveCallout: saveCallout, fvRemoveCallout: removeCallout,
});
