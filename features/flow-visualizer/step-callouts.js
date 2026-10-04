// ================================================================================================
// FILE: features/flow-visualizer/step-callouts.js
//
// WHAT IT DOES:   Collateral callouts on a STEP: the form, email template, spreadsheet, document or folder someone
//                 needs to complete that step. Each shows as a small chip under the step (Steps view and List view);
//                 click it for a mini card with the note and an Open link. "+" on a step adds one; the step editor
//                 has a "Collateral" section too.
//
// TWO WAYS TO ADD ONE
//                 1. From the library: pick an existing email template, form, sheet, doc or folder. The name and link
//                    stay in step with the library item, so editing the template there updates every step that uses it.
//                 2. By hand: a name and a link (an outside form or sheet does not need a library item).
//
// STORED AS:      step.callouts = [{ id, kind, name, url, note, libId? }]   (libId = the library resource, if picked)
// SAME LOOK AS:   the card-level callouts (features/flow-visualizer/callouts.js); the chip and panel styles are shared.
// ================================================================================================

import { esc, uid, getActiveClient, persist, markClientDirty } from '../../core/data.js';
import { CALLOUT_KINDS, calloutKindForType } from './callouts.js';

const KIND = Object.fromEntries(CALLOUT_KINDS.map((k) => [k.key, k]));
const OL = () => window.OL;
const project = () => (OL().getCurrentProjectData ? OL().getCurrentProjectData() : { resources: [] }) || { resources: [] };
const allRes = () => (project().resources || []).filter((r) => r && !r.isDeleted);
const resById = (id) => allRes().find((r) => String(r.id) === String(id));
const stepOf = (res, id) => ((res && res.steps) || []).find((s) => String(s.id) === String(id));

const safeUrl = (u) => { const v = String(u || '').trim(); return /^https?:\/\//i.test(v) ? v : ''; };
const clip = (s, n) => { const t = String(s || ''); return t.length > n ? t.slice(0, n - 1) + '\u2026' : t; };
const icon = (name, size = 12) => `<i data-lucide="${name}" style="width:${size}px;height:${size}px;display:inline-block;vertical-align:middle;"></i>`;

// a library resource type -> callout kind (the card-level mapping first, then a looser read of the type name)
function kindForType(type) {
  const k = calloutKindForType(type); if (k) return k;
  const t = String(type || '').toLowerCase();
  if (/form|questionnaire/.test(t)) return 'form';
  if (/email|signature|letter/.test(t)) return 'email';
  if (/sheet/.test(t)) return 'spreadsheet';
  if (/doc|pdf|agreement|contract/.test(t)) return 'document';
  if (/folder/.test(t)) return 'folder';
  return null;
}

// ---- reading -----------------------------------------------------------------------------------------------
export function calloutsOf(step) {
  return (step && Array.isArray(step.callouts) ? step.callouts : []).filter((c) => c && c.id).map((c) => {
    const lib = c.libId ? resById(c.libId) : null;
    return {
      id: c.id, libId: c.libId || '', kind: KIND[c.kind] ? c.kind : (lib && kindForType(lib.type)) || 'other',
      name: (lib && lib.name) || c.name || 'Untitled',
      url: safeUrl((lib && (lib.externalUrl || lib.url)) || c.url),
      note: c.note || (lib && String(lib.description || lib.notes || '')) || '',
      missing: !!(c.libId && !lib),
    };
  });
}

// library items a step could point at, grouped by kind
function libraryChoices() {
  return allRes().map((r) => ({ r, kind: kindForType(r.type) })).filter((x) => x.kind && !x.r.isArchived)
    .sort((a, b) => a.kind.localeCompare(b.kind) || String(a.r.name || '').localeCompare(String(b.r.name || '')));
}

// ---- drawing -----------------------------------------------------------------------------------------------
const openSet = () => { OL()._fv = OL()._fv || {}; return (OL()._fv._openStepCallouts = OL()._fv._openStepCallouts || new Set()); };
const keyOf = (resId, stepId) => `${resId}|${stepId}`;

function panelHtml(resId, stepId, c) {
  const k = KIND[c.kind] || KIND.other; const r = esc(resId), s = esc(stepId);
  return `<div class="fv-callout-panel" onclick="event.stopPropagation()" onmousedown="event.stopPropagation()">
    <div class="fv-callout-panel-head"><span class="fv-callout-kind">${icon(k.icon, 11)} ${esc(k.label)}</span>
      <button type="button" class="fv-callout-x" title="Close" onclick="event.stopPropagation(); OL.fvToggleStepCallout('${r}','${s}','${esc(c.id)}')">${icon('x', 11)}</button></div>
    <div class="fv-callout-title">${esc(c.name)}</div>
    ${c.note ? `<div class="fv-callout-note">${esc(clip(c.note, 400))}</div>` : ''}
    ${c.missing ? '<div class="fv-callout-meta">The linked library item is no longer there.</div>' : ''}
    <div class="fv-callout-actions">
      ${c.url ? `<a class="btn tiny primary" href="${esc(c.url)}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">Open ${icon('external-link', 11)}</a>` : ''}
      ${c.libId && !c.missing ? `<button type="button" class="btn tiny soft" onclick="event.stopPropagation(); OL.openInspector('${esc(c.libId)}', null, 'cards')">In library</button>` : ''}
      <button type="button" class="btn tiny soft" onclick="event.stopPropagation(); OL.fvEditStepCallout('${r}','${s}','${esc(c.id)}')">Edit</button>
      <button type="button" class="btn tiny soft" onclick="event.stopPropagation(); OL.fvRemoveStepCallout('${r}','${s}','${esc(c.id)}')">Remove</button>
    </div></div>`;
}

function innerHtml(step, res) {
  const list = calloutsOf(step); const open = openSet(); const r = esc(res.id), s = esc(step.id);
  const chips = list.map((c) => {
    const k = KIND[c.kind] || KIND.other; const on = open.has(`${keyOf(res.id, step.id)}|${c.id}`);
    return `<button type="button" class="fv-callout-chip${on ? ' is-open' : ''}" title="${esc(k.label)}: ${esc(c.name)}"
      onclick="event.stopPropagation(); OL.fvToggleStepCallout('${r}','${s}','${esc(c.id)}')">${icon(k.icon, 11)}<span>${esc(clip(c.name, 16))}</span></button>`;
  }).join('');
  const panels = list.filter((c) => open.has(`${keyOf(res.id, step.id)}|${c.id}`)).map((c) => panelHtml(res.id, step.id, c)).join('');
  const add = `<button type="button" class="fv-callout-add" title="Add a form, email template or other collateral for this step" aria-label="Add collateral to this step"
    onclick="event.stopPropagation(); OL.fvEditStepCallout('${r}','${s}')">${icon('plus', 11)}</button>`;
  return `<div class="fv-callout-row">${chips}${add}</div>${panels}`;
}

// mode: 'card' (Steps view) or 'row' (List view)
export function stepCalloutStrip(step, res, mode = 'card') {
  if (!step || !res || step.kind === 'decision') return '';
  const n = calloutsOf(step).length;
  return `<div class="fv-callouts fv-step-callouts fv-sco-${mode}${n ? ' has-items' : ''}" data-step-callouts-for="${esc(keyOf(res.id, step.id))}" data-mode="${mode}" onclick="event.stopPropagation()" onmousedown="event.stopPropagation()">${innerHtml(step, res)}</div>`;
}

function refresh(resId, stepId) {
  const res = resById(resId); const step = stepOf(res, stepId); if (!step) return;
  const sel = `[data-step-callouts-for="${CSS.escape(keyOf(resId, stepId))}"]`;
  document.querySelectorAll(sel).forEach((el) => {
    el.innerHTML = innerHtml(step, res);
    el.classList.toggle('has-items', calloutsOf(step).length > 0);
  });
  if (window.lucide) window.lucide.createIcons();
}

// the step editor's section (inspector)
export function stepCalloutInspector(resId, step) {
  const list = calloutsOf(step); const r = esc(resId), s = esc(step.id);
  const rows = list.length ? list.map((c) => {
    const k = KIND[c.kind] || KIND.other;
    return `<div style="display:flex;align-items:center;gap:6px;margin:4px 0;">
      <span class="tiny" style="color:var(--accent);">${icon(k.icon, 11)}</span>
      <span style="flex:1;min-width:0;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(c.name)}">${esc(c.name)}${c.missing ? ' (removed from library)' : ''}</span>
      ${c.url ? `<a class="btn tiny soft" href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">Open</a>` : ''}
      <button type="button" class="btn tiny soft" onclick="OL.fvEditStepCallout('${r}','${s}','${esc(c.id)}')">Edit</button>
      <button type="button" class="btn tiny soft" onclick="OL.fvRemoveStepCallout('${r}','${s}','${esc(c.id)}')">Remove</button></div>`;
  }).join('') : '<div class="tiny muted">Nothing attached yet.</div>';
  return `<div class="inspector-section">
    <label class="section-label">${icon('paperclip', 11)} COLLATERAL FOR THIS STEP</label>
    ${rows}
    <button type="button" class="btn tiny primary" style="margin-top:6px;" onclick="OL.fvEditStepCallout('${r}','${s}')">Add form, email template or other</button>
    <div class="tiny muted" style="margin-top:4px;">The forms, templates, sheets and documents someone uses to complete this step.</div>
  </div>`;
}

// ---- actions -----------------------------------------------------------------------------------------------
function toggle(resId, stepId, id) {
  const set = openSet(); const k = `${keyOf(resId, stepId)}|${id}`;
  if (set.has(k)) set.delete(k); else set.add(k);
  refresh(resId, stepId);
}

function afterChange(resId, stepId) {
  const client = getActiveClient && getActiveClient(); if (client) markClientDirty(client.id);
  persist();
  // a chip row adds height to a step card, so the map is laid out again (as the "See another process" link does)
  const onMap = document.getElementById('fv-content') || document.getElementById('fv-canvas-wrap') || document.getElementById('fv-body');
  if (onMap && typeof OL().renderVisualizer === 'function') {
    const editorOpen = !!document.querySelector('.inspector-scroll-content');
    OL().renderVisualizer();
    if (editorOpen && typeof OL()._fvRefreshInspector === 'function') requestAnimationFrame(() => requestAnimationFrame(() => OL()._fvRefreshInspector(resId, stepId)));
  } else refresh(resId, stepId);
}

function edit(resId, stepId, calloutId) {
  const res = resById(resId); const step = stepOf(res, stepId); if (!step) return;
  const cur = calloutId ? (step.callouts || []).find((c) => c.id === calloutId) : null;
  const choices = libraryChoices();
  const libOpts = choices.map(({ r, kind }) => `<option value="${esc(r.id)}" data-kind="${kind}" ${cur && String(cur.libId) === String(r.id) ? 'selected' : ''}>${esc((KIND[kind] || KIND.other).label)}: ${esc(r.name || 'Untitled')}</option>`).join('');
  const lbl = 'class="tiny muted" style="display:block;font-weight:600;margin:10px 0 3px;"';
  window.openModal(`
    <div class="modal-head"><div class="modal-title-text">${cur ? 'Edit collateral' : 'Add collateral'}</div><button class="btn small soft" onclick="OL.closeModal()">Close</button></div>
    <div class="modal-body" style="max-width:460px;">
      <p class="tiny muted" style="margin-top:0;">Something someone uses to complete <strong>${esc(step.name || 'this step')}</strong>: a form, an email template, a sheet, a document.</p>
      ${choices.length ? `<label ${lbl}>From the library</label>
      <select id="fvsc-lib" class="modal-input" onchange="OL.fvStepCalloutPick()"><option value="">Not from the library (enter it below)</option>${libOpts}</select>` : ''}
      <label ${lbl}>Type</label>
      <select id="fvsc-kind" class="modal-input">${CALLOUT_KINDS.map((k) => `<option value="${k.key}" ${cur && cur.kind === k.key ? 'selected' : ''}>${esc(k.label)}</option>`).join('')}</select>
      <label ${lbl}>Name</label>
      <input id="fvsc-name" class="modal-input" type="text" value="${esc(cur ? cur.name : '')}" placeholder="e.g. Welcome email, Onboarding questionnaire">
      <label ${lbl}>Link (optional)</label>
      <input id="fvsc-url" class="modal-input" type="text" value="${esc(cur ? cur.url || '' : '')}" placeholder="https://">
      <label ${lbl}>Note (optional)</label>
      <textarea id="fvsc-note" class="modal-input" rows="3" placeholder="When it is used, who sends it, anything to watch for">${esc(cur ? cur.note || '' : '')}</textarea>
      <div id="fvsc-err" class="tiny" style="color:#dc2626;min-height:16px;margin-top:6px;"></div>
      <div style="display:flex;gap:8px;margin-top:6px;"><button class="btn primary" onclick="OL.fvSaveStepCallout('${esc(resId)}','${esc(stepId)}','${esc(calloutId || '')}')">Save</button></div>
    </div>`);
}

// choosing a library item fills in its type and name; the link and note come from the library item itself
function pick() {
  const sel = document.getElementById('fvsc-lib'); if (!sel) return;
  const opt = sel.selectedOptions[0]; const lib = sel.value ? resById(sel.value) : null;
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  if (lib) {
    set('fvsc-kind', opt.dataset.kind || 'other'); set('fvsc-name', lib.name || '');
    set('fvsc-url', safeUrl(lib.externalUrl || lib.url));
  }
}

function save(resId, stepId, calloutId) {
  const res = resById(resId); const step = stepOf(res, stepId); if (!step) return;
  const v = (id) => (document.getElementById(id)?.value || '').trim();
  const err = document.getElementById('fvsc-err');
  const libId = v('fvsc-lib'); const name = v('fvsc-name'); const url = v('fvsc-url');
  if (!name) { if (err) err.textContent = 'Give it a name.'; return; }
  if (url && !safeUrl(url)) { if (err) err.textContent = 'The link needs to start with http:// or https://'; return; }
  const entry = { id: calloutId || `sco-${uid()}`, kind: v('fvsc-kind') || 'other', name, url, note: v('fvsc-note') };
  if (libId) entry.libId = libId;
  const next = (step.callouts || []).map((c) => ({ ...c }));
  const i = next.findIndex((c) => c.id === entry.id);
  if (i >= 0) next[i] = entry; else next.push(entry);
  step.callouts = next;
  OL().closeModal();
  openSet().add(`${keyOf(resId, stepId)}|${entry.id}`);
  afterChange(resId, stepId);
}

function remove(resId, stepId, calloutId) {
  const res = resById(resId); const step = stepOf(res, stepId); if (!step) return;
  if (!confirm('Remove this collateral from the step?')) return;
  openSet().delete(`${keyOf(resId, stepId)}|${calloutId}`);
  step.callouts = (step.callouts || []).filter((c) => c.id !== calloutId);
  if (!step.callouts.length) delete step.callouts;
  afterChange(resId, stepId);
}

window.OL = window.OL || {};
Object.assign(window.OL, {
  fvStepCalloutStrip: stepCalloutStrip, fvStepCalloutInspector: stepCalloutInspector, fvStepCalloutsOf: calloutsOf,
  fvToggleStepCallout: toggle, fvEditStepCallout: edit, fvStepCalloutPick: pick, fvSaveStepCallout: save, fvRemoveStepCallout: remove,
});
