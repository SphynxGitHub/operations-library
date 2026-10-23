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

import { esc, uid, getActiveClient, persist, markClientDirty, state } from '../../core/data.js';
import { CALLOUT_KINDS, calloutKindForType, calloutsFor, isFlowType } from './callouts.js';
import { orderedResources } from './step-items.js';

const KIND = Object.fromEntries(CALLOUT_KINDS.map((k) => [k.key, k]));
const OL = () => window.OL;
const project = () => (OL().getCurrentProjectData ? OL().getCurrentProjectData() : { resources: [] }) || { resources: [] };
const allRes = () => (project().resources || []).filter((r) => r && !r.isDeleted);
const resById = (id) => allRes().find((r) => String(r.id) === String(id));
// how-to guides (library + this client's own) are collateral too
const guideList = () => { const O = OL(); const client = getActiveClient && getActiveClient();
  return [...(O.masterGuidesFor ? O.masterGuidesFor(client) : ((state.master && state.master.howToLibrary) || [])), ...((client && client.projectData && client.projectData.localHowTo) || [])].filter((g) => g && g.id && !g.isDeleted); };
const guideById = (id) => { const g = guideList().find((x) => String(x.id) === String(id)); return g ? { ...g, type: 'Guide', _guide: true } : null; };
const libById = (id) => resById(id) || guideById(id);
const stepOf = (res, id) => ((res && res.steps) || []).find((s) => String(s.id) === String(id));

const safeUrl = (u) => { const v = String(u || '').trim(); return /^https?:\/\//i.test(v) ? v : ''; };
const clip = (s, n) => { const t = String(s || ''); return t.length > n ? t.slice(0, n - 1) + '\u2026' : t; };
const icon = (name, size = 12) => `<i data-lucide="${name}" style="width:${size}px;height:${size}px;display:inline-block;vertical-align:middle;"></i>`;

// a library resource type -> callout kind (the card-level mapping first, then a looser read of the type name)
function kindForType(type) {
  const k = calloutKindForType(type); if (k) return k;
  const t = String(type || '').toLowerCase();
  if (t === 'guide' || t === 'sop') return 'guide';
  if (/form|questionnaire/.test(t)) return 'form';
  if (/email|signature|letter/.test(t)) return 'email';
  if (/sheet/.test(t)) return 'spreadsheet';
  if (/doc|pdf|agreement|contract/.test(t)) return 'document';
  if (/folder/.test(t)) return 'folder';
  if (/event|calendar|schedul|booking|appointment/.test(t)) return 'event';
  // any other type that is not a flow (a custom reference type, say) can still be attached, as "Other"
  if (t && !isFlowType(t)) return 'other';
  return null;
}

// ---- reading -----------------------------------------------------------------------------------------------
export function calloutsOf(step) {
  // links attached the old way (step.links: guides and project assets) show as collateral too, so nothing is lost
  const own = new Set((step && step.callouts || []).map((c) => String(c.libId || '')));
  const old = ((step && step.links) || []).filter((l) => l && l.id && !own.has(String(l.id)) && (/^(sop|guide)$/i.test(l.type) || !calloutKindForType(l.type)))
    .map((l, i) => ({ id: `lnk:${l.id}`, libId: String(l.id), kind: /^(sop|guide)$/i.test(l.type) ? 'guide' : 'other', name: l.name || 'Untitled', note: '', url: '', derived: true, _link: l }));
  return (step && Array.isArray(step.callouts) ? step.callouts : []).filter((c) => c && c.id).map((c) => {
    const lib = c.libId ? libById(c.libId) : null;
    return {
      id: c.id, libId: c.libId || '', kind: KIND[c.kind] ? c.kind : (lib && kindForType(lib.type)) || 'other',
      typeLabel: (lib && (lib._guide ? 'How-to guide' : lib.type)) || c.typeLabel || '',
      name: (lib && lib.name) || c.name || 'Untitled',
      url: safeUrl((lib && (lib.externalUrl || lib.url)) || c.url),
      note: c.note || (lib && String(lib.description || lib.notes || '')) || '',
      missing: !!(c.libId && !lib),
    };
  }).concat(old.map((o) => { const lib = libById(o.libId); return lib ? { ...o, name: lib.name || o.name, kind: lib._guide ? 'guide' : o.kind, typeLabel: lib._guide ? 'How-to guide' : (lib.type || ''), url: safeUrl(lib.externalUrl || lib.url) } : { ...o, missing: true }; }));
}

// library items a step could point at, grouped by kind
function libraryChoices() {
  const guides = guideList().map((g) => ({ r: { ...g, type: 'Guide', _guide: true }, kind: 'guide' }));
  return allRes().map((r) => ({ r, kind: kindForType(r.type) })).concat(guides).filter((x) => x.kind && !x.r.isArchived && !x.r.archived)
    .sort((a, b) => a.kind.localeCompare(b.kind) || String(a.r.name || '').localeCompare(String(b.r.name || '')));
}

// The type shown for an item is the one it has in the Resources manager, not the broader group it is filed under.
const typeOf = (c) => String((c && c.typeLabel) || (KIND[c && c.kind] || KIND.other).label);
// every type to offer: the Resources manager's own list, any type in use on a library item, and guides (flow types are not collateral)
function typeOptions(extra = []) {
  const seen = new Map();
  const add = (t) => { const v = String(t || '').trim(); if (v && !isFlowType(v) && !seen.has(v.toLowerCase())) seen.set(v.toLowerCase(), v); };
  (((state.master && state.master.resourceTypes) || []).map((t) => t && t.type)).forEach(add);
  allRes().forEach((r) => add(r.type));
  add('How-to guide'); extra.forEach(add);
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}
const kindOfTypeName = (t) => (String(t).toLowerCase() === 'how-to guide' ? 'guide' : (kindForType(t) || 'other'));

// ---- drawing -----------------------------------------------------------------------------------------------
const openSet = () => { OL()._fv = OL()._fv || {}; return (OL()._fv._openStepCallouts = OL()._fv._openStepCallouts || new Set()); };
const keyOf = (resId, stepId) => `${resId}|${stepId}`;

// a read-only preview of the linked library item (email body in a sandboxed frame; other kinds show their details)
function previewHtml(c, h = 240) {
  const lib = c.libId ? libById(c.libId) : null; if (!lib) return '';
  if (c.kind === 'email' || lib.emailBody != null) {
    const body = String(lib.emailBody || '').trim();
    const doc = `<!doctype html><meta charset="utf-8"><base target="_blank"><style>body{margin:0;padding:10px;font:13px/1.5 Helvetica,Arial,sans-serif;color:#222;background:#fff;word-wrap:break-word}img,table{max-width:100%;height:auto}</style>${body || '<p style="color:#999">No body yet.</p>'}`;
    return `<div class="fv-callout-preview" style="margin:6px 0;border:1px solid var(--line,#444);border-radius:6px;overflow:hidden;background:#fff;">
      ${lib.emailSubject ? `<div style="padding:5px 10px;font-size:11px;color:#555;background:#f4f4f4;border-bottom:1px solid #e3e3e3;"><b>Subject:</b> ${esc(lib.emailSubject)}</div>` : ''}
      <iframe sandbox="" referrerpolicy="no-referrer" style="display:block;width:100%;height:${h}px;border:0;background:#fff;" srcdoc="${esc(doc)}"></iframe></div>`;
  }
  // anything with a web link: try to show the live page. Forms from Jotform / Google Forms and Google Docs-type
  // files can usually be framed; sites that forbid it show blank, so the Open button and a note sit above the frame.
  const raw = safeUrl(lib.externalUrl || lib.url);
  // a scheduling page is a booking screen, not something to show in a frame: show where it goes and let people open it
  if (c.kind === 'event') {
    const bits = [lib.type && `Type: ${lib.type}`, lib.description || lib.notes].filter(Boolean).map((t) => `<div class="fv-callout-meta">${esc(clip(t, 300))}</div>`).join('');
    return bits + (raw ? `<div class="fv-callout-meta" style="word-break:break-all;">${esc(raw)}</div>` : '');
  }
  if (raw) {
    let src = raw;
    if (/docs\.google\.com\/forms\//.test(src)) src = src.replace(/\/(edit|viewform)?(\?.*)?$/, '/viewform?embedded=true');
    else if (/docs\.google\.com\/(document|spreadsheets|presentation)\//.test(src)) src = src.replace(/\/(edit|view)(\?.*|#.*)?$/, '/preview');
    const info = [lib.type, lib.description || lib.notes].filter(Boolean).map((t) => esc(clip(t, 160))).join(' \u2022 ');
    return `<div class="fv-callout-preview" style="margin:6px 0;border:1px solid var(--line,#444);border-radius:6px;overflow:hidden;background:#fff;">
      <div style="display:flex;align-items:center;gap:8px;padding:5px 10px;font-size:11px;color:#555;background:#f4f4f4;border-bottom:1px solid #e3e3e3;">
        <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${info || esc(raw)}</span>
        <a href="${esc(raw)}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()" style="white-space:nowrap;">Open in new tab</a></div>
      <iframe src="${esc(src)}" loading="lazy" referrerpolicy="no-referrer" sandbox="allow-scripts allow-forms allow-same-origin allow-popups" style="display:block;width:100%;height:${h}px;border:0;background:#fff;"></iframe>
      <div style="padding:4px 10px;font-size:10px;color:#777;background:#f4f4f4;border-top:1px solid #e3e3e3;">Blank? That site does not allow previews: use Open in new tab.</div></div>`;
  }
  const bits = [lib.type && `Type: ${lib.type}`, lib.description || lib.notes].filter(Boolean).map((t) => `<div class="fv-callout-meta">${esc(clip(t, 300))}</div>`).join('');
  return bits;
}

function panelHtml(resId, stepId, c) {
  const k = KIND[c.kind] || KIND.other; const r = esc(resId), s = esc(stepId);
  const wide = c.kind === 'email' && c.libId && !c.missing;
  return `<div class="fv-callout-panel" ${wide ? 'style="width:420px;max-width:80vw;"' : ''} onclick="event.stopPropagation()" onmousedown="event.stopPropagation()">
    <div class="fv-callout-panel-head"><span class="fv-callout-kind">${icon(k.icon, 11)} ${esc(typeOf(c))}</span>
      <button type="button" class="fv-callout-x" title="Close" onclick="event.stopPropagation(); OL.fvToggleStepCallout('${r}','${s}','${esc(c.id)}')">${icon('x', 11)}</button></div>
    <div class="fv-callout-title">${esc(c.name)}</div>
    ${c.note ? `<div class="fv-callout-note">${esc(clip(c.note, 400))}</div>` : ''}
    ${c.missing ? '' : previewHtml(c)}
    ${c.missing ? '<div class="fv-callout-meta">The linked library item is no longer there.</div>' : (!c.url ? '<div class="fv-callout-meta">No link yet. Use Edit to add one.</div>' : '')}
    <div class="fv-callout-actions">
      ${c.url ? `<a class="btn tiny primary" href="${esc(c.url)}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">${c.kind === 'event' ? 'Open scheduling page' : 'Open'} ${icon('external-link', 11)}</a>` : ''}
      ${c.kind === 'email' && c.libId && !c.missing ? `<button type="button" class="btn tiny soft" onclick="event.stopPropagation(); OL.previewEmailTemplate('${esc(c.libId)}')">Full preview</button>` : ''}
      ${c.kind === 'guide' && !c.missing ? `<button type="button" class="btn tiny primary" onclick="event.stopPropagation(); OL.openGuideEditor('${esc(c.libId)}')">Open guide</button>` : (c.libId && !c.missing ? `<button type="button" class="btn tiny soft" onclick="event.stopPropagation(); OL.openInspector('${esc(c.libId)}', null, 'cards')">In library</button>` : '')}
      ${c.libId && !c.missing && c.kind !== 'guide' ? `<button type="button" class="btn tiny primary" onclick="event.stopPropagation(); OL.fvEditLibItem('${esc(c.libId)}')">${icon('pencil', 11)} Edit</button>` : ''}
      ${c.derived ? '' : `<button type="button" class="btn tiny soft" onclick="event.stopPropagation(); OL.fvEditStepCallout('${r}','${s}','${esc(c.id)}')">${c.libId && !c.missing ? 'Step note' : 'Edit'}</button>`}
      <button type="button" class="btn tiny soft" onclick="event.stopPropagation(); OL.fvRemoveStepCallout('${r}','${s}','${esc(c.id)}')">Remove</button>
    </div></div>`;
}

function innerHtml(step, res) {
  const list = calloutsOf(step); const open = openSet(); const r = esc(res.id), s = esc(step.id);
  const chips = list.map((c) => {
    const k = KIND[c.kind] || KIND.other; const on = open.has(`${keyOf(res.id, step.id)}|${c.id}`);
    return `<button type="button" class="fv-callout-chip${on ? ' is-open' : ''}" data-co-key="${esc(c.id)}" title="${esc(typeOf(c))}: ${esc(c.name)}"
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
      ${c.kind === 'guide' && !c.missing ? `<button type="button" class="btn tiny soft" onclick="OL.openGuideEditor('${esc(c.libId)}')">Open</button>` : ''}
      ${c.libId && !c.missing && c.kind !== 'guide' ? `<button type="button" class="btn tiny primary" onclick="OL.fvEditLibItem('${esc(c.libId)}')">Edit</button>` : ''}
      ${c.derived ? '' : `<button type="button" class="btn tiny soft" onclick="OL.fvEditStepCallout('${r}','${s}','${esc(c.id)}')">${c.libId && !c.missing ? 'Step note' : 'Edit'}</button>`}
      <button type="button" class="btn tiny soft" onclick="OL.fvRemoveStepCallout('${r}','${s}','${esc(c.id)}')">Remove</button></div>`;
  }).join('') : '<div class="tiny muted">Nothing attached yet.</div>';
  return `<div class="inspector-section">
    <label class="section-label">${icon('paperclip', 11)} COLLATERAL FOR THIS STEP</label>
    ${rows}
    <button type="button" class="btn tiny primary" style="margin-top:6px;" onclick="OL.fvEditStepCallout('${r}','${s}')">Add form, template, guide or other</button>
    <div class="tiny muted" style="margin-top:4px;">The forms, templates, guides, sheets and documents someone uses to complete this step.</div>
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

// The library type a new item of each kind is filed under (an existing type of that kind is preferred).
const KIND_TYPE = { email: 'Email Template', form: 'Form Template', spreadsheet: 'Spreadsheet', document: 'Document', folder: 'Folder', event: 'Event', other: 'Reference', guide: 'Reference' };
function typeNameForKind(kind) {
  const types = ((state.master && state.master.resourceTypes) || []).map((t) => t.type).filter(Boolean);
  const want = String(KIND_TYPE[kind] || 'Reference').toLowerCase();
  return types.find((t) => t.toLowerCase() === want) || (kind !== 'other' && types.find((t) => kindForType(t) === kind)) || KIND_TYPE[kind] || 'Reference';
}

// "Create new": adds the item to the library right here, so nobody has to leave the flow map to make it first.
function createLibraryItem({ kind, type: chosenType, name, url, note }) {
  const pd = project();
  const list = pd.localResources || pd.resources;
  if (!Array.isArray(list)) return null;
  const isVault = (window.location.hash || '').startsWith('#/vault');
  const type = chosenType || typeNameForKind(kind);
  const info = ((state.master && state.master.resourceTypes) || []).find((t) => t.type === type);
  const res = {
    id: `${isVault ? 'res-vlt' : 'local-prj'}-${Date.now()}`, name, type, archetype: (info && info.archetype) || 'Base',
    steps: [], triggers: [], data: {}, description: note || '', createdDate: new Date().toISOString(),
  };
  if (url) res.externalUrl = url;
  list.push(res);
  return res;
}

const elv = (id) => document.getElementById(id);
const fieldValue = (id) => ((elv(id) && elv(id).value) || '').trim();

// the searchable library list on the left of the dialog
function renderPickList() {
  const box = elv('fvsc-list'); if (!box) return;
  const q = fieldValue('fvsc-search').toLowerCase();
  const kindFilter = (elv('fvsc-filter') && elv('fvsc-filter').value) || '';
  const picked = (elv('fvsc-lib') && elv('fvsc-lib').value) || '';
  const rows = libraryChoices().filter(({ r }) => (!kindFilter || String(r._guide ? 'How-to guide' : r.type).toLowerCase() === kindFilter.toLowerCase()) && (!q || String(r.name || '').toLowerCase().includes(q)));
  const exact = rows.some(({ r }) => String(r.name || '').trim().toLowerCase() === q);
  const rowCss = 'display:flex;align-items:center;gap:8px;padding:9px 12px;cursor:pointer;border-bottom:1px solid var(--panel-border);';
  const createRow = q && !exact
    ? `<div onclick="OL.fvStepCalloutCreateNew()" style="${rowCss}color:var(--accent);font-weight:600;">${icon('plus', 13)}<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">Create new &ldquo;${esc(fieldValue('fvsc-search'))}&rdquo;</span></div>` : '';
  box.innerHTML = createRow + (rows.length ? rows.map(({ r, kind }) => {
    const k = KIND[kind] || KIND.other; const on = String(picked) === String(r.id);
    return `<div data-id="${esc(r.id)}" onclick="OL.fvStepCalloutPick('${esc(r.id)}')" style="${rowCss}${on ? 'background:var(--accent-glow);' : ''}">
      <span style="color:var(--accent);">${icon(k.icon, 13)}</span>
      <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:${on ? 700 : 500};" title="${esc(r.name || 'Untitled')}">${esc(r.name || 'Untitled')}</span>
      <span class="tiny muted" style="white-space:nowrap;">${esc(r._guide ? 'How-to guide' : (r.type || k.label))}</span></div>`;
  }).join('') : `<div class="tiny muted" style="padding:14px;">Nothing in the library matches${q ? ` &ldquo;${esc(fieldValue('fvsc-search'))}&rdquo;` : ''}. Use Create new to add it.</div>`);
  if (window.lucide) window.lucide.createIcons();
}

// what the right-hand side will do when saved, and whether the name / link / type are locked to a library item
function renderPickStatus() {
  const st = elv('fvsc-status'); if (!st) return;
  const libId = (elv('fvsc-lib') && elv('fvsc-lib').value) || '';
  const isNew = ((elv('fvsc-new') && elv('fvsc-new').value) || '') === '1';
  const lib = libId ? libById(libId) : null;
  const locked = !!lib;
  ['fvsc-name', 'fvsc-url'].forEach((id) => { const e = elv(id); if (e) { e.readOnly = locked; e.style.opacity = locked ? '.65' : ''; } });
  const kindEl = elv('fvsc-kind'); if (kindEl) { kindEl.disabled = locked; kindEl.style.opacity = locked ? '.65' : ''; }
  const fieldsEl = document.getElementById('fvsc-fields'); if (fieldsEl) fieldsEl.style.display = lib ? 'none' : '';
  const prevEl = document.getElementById('fvsc-preview');
  if (prevEl) prevEl.innerHTML = lib ? (previewHtml({ kind: lib._guide ? 'guide' : (kindForType(lib.type) || 'other'), libId: lib.id }, 480) || '<div class="tiny muted">Nothing to preview for this item yet.</div>') : '';
  const box = 'padding:9px 12px;border-radius:8px;font-size:12px;line-height:1.4;border:1px solid var(--panel-border);';
  if (lib) {
    st.innerHTML = `<div style="${box}background:var(--accent-glow);">${icon('link', 12)} Linked to the library item <strong>${esc(lib.name || 'Untitled')}</strong>. Its name and link stay in step with the library.
      <button type="button" class="btn tiny soft" style="margin-left:6px;" onclick="OL.fvStepCalloutUnlink()">Unlink</button></div>`;
  } else if (isNew) {
    const newType = (kindEl && kindEl.value) || 'Reference';
    st.innerHTML = `<div style="${box}background:var(--accent-glow);">${icon('plus', 12)} Saving will add this to the library as a new <strong>${esc(newType)}</strong> and link it to this step.
      <button type="button" class="btn tiny soft" style="margin-left:6px;" onclick="OL.fvStepCalloutUnlink()">Cancel</button></div>`;
  } else {
    st.innerHTML = `<div style="${box}">Not in the library: just a name and a link. Pick an item on the left, or <a href="#" onclick="OL.fvStepCalloutCreateNew(); return false;">create a new one</a>.</div>`;
  }
  if (window.lucide) window.lucide.createIcons();
}

function edit(resId, stepId, calloutId) {
  const res = resById(resId); const step = stepOf(res, stepId); if (!step) return;
  const cur = calloutId ? (step.callouts || []).find((c) => c.id === calloutId) : null;
  const curLib = cur && cur.libId ? libById(cur.libId) : null;
  const lbl = 'class="tiny muted" style="display:block;font-weight:600;margin:12px 0 4px;"';
  const curType = cur ? (cur.typeLabel || (curLib && (curLib._guide ? 'How-to guide' : curLib.type)) || typeNameForKind(cur.kind)) : '';
  const types = typeOptions(curType ? [curType] : []);
  const kindOpts = types.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
  // The dialog box is already wide (90% of the window, up to 900px); the form used to be squeezed into 460px of it.
  window.openModal(`
    <div class="modal-head"><div class="modal-title-text">${cur ? 'Edit collateral' : 'Add collateral'}</div><button class="btn small soft" style="margin-left:auto;" onclick="OL.closeModal()">Close</button></div>
    <div class="modal-body" style="width:100%;box-sizing:border-box;">
      <p class="tiny muted" style="margin-top:0;">Something someone uses to complete <strong>${esc(step.name || 'this step')}</strong>: a form, an email template, a sheet, a document, an event&rsquo;s scheduling page, or any other non-flow item. Pick it from the library, or create it here without leaving the map.</p>
      <input type="hidden" id="fvsc-lib" value="${curLib ? esc(cur.libId) : ''}">
      <input type="hidden" id="fvsc-new" value="">
      <div style="display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:28px;align-items:start;">
        <div>
          <label class="tiny muted" style="display:block;font-weight:600;margin:0 0 4px;">Find in the library</label>
          <div style="display:flex;gap:8px;align-items:center;">
            <input id="fvsc-search" class="modal-input" type="text" autocomplete="off" placeholder="Search the library: forms, templates, sheets, events..." style="flex:1;min-width:0;margin:0;" oninput="OL.fvStepCalloutFilter()">
            <select id="fvsc-filter" class="modal-input" style="width:auto;margin:0;" onchange="OL.fvStepCalloutFilter()"><option value="">All types</option>${kindOpts}</select>
          </div>
          <div id="fvsc-list" style="margin-top:8px;height:min(520px,52vh);overflow-y:auto;border:1px solid var(--panel-border);border-radius:8px;"></div>
          <button type="button" class="btn small primary" style="margin-top:10px;" onclick="OL.fvStepCalloutCreateNew()">${icon('plus', 12)} Create new</button>
        </div>
        <div>
          <div id="fvsc-status"></div>
          <div id="fvsc-preview"></div>
          <div id="fvsc-fields">
          <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,2fr);gap:12px;">
            <div><label ${lbl}>Type</label>
              <select id="fvsc-kind" class="modal-input" onchange="OL.fvStepCalloutKindChanged()">${types.map((t) => `<option value="${esc(t)}" ${curType && curType.toLowerCase() === t.toLowerCase() ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></div>
            <div><label ${lbl}>Name</label>
              <input id="fvsc-name" class="modal-input" type="text" value="${esc(cur ? cur.name : '')}" placeholder="e.g. Welcome email, 20 minute call scheduling page"></div>
          </div>
          <label ${lbl}>Link (optional)</label>
          <input id="fvsc-url" class="modal-input" type="text" value="${esc(cur ? cur.url || '' : '')}" placeholder="https://">
          <label ${lbl}>Note (optional)</label>
          <textarea id="fvsc-note" class="modal-input" rows="8" placeholder="When it is used, who sends it, anything to watch for" style="min-height:200px;resize:vertical;">${esc(cur ? cur.note || '' : '')}</textarea>
          </div>
        </div>
      </div>
      <div id="fvsc-err" class="tiny" style="color:#dc2626;min-height:16px;margin-top:10px;"></div>
      <div style="display:flex;gap:8px;margin-top:6px;"><button class="btn primary" onclick="OL.fvSaveStepCallout('${esc(resId)}','${esc(stepId)}','${esc(calloutId || '')}')">Save</button></div>
    </div>`);
  renderPickList(); renderPickStatus();
  const on = document.querySelector('#fvsc-list [data-id][style*="accent-glow"]');
  if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest' });
}

// choosing a library item fills in its type, name and link; they then stay in step with the library item itself
function pick(id) {
  const lib = id ? libById(id) : null; if (!lib) return;
  const set = (eid, v) => { const el = elv(eid); if (el) el.value = v; };
  set('fvsc-lib', String(lib.id)); set('fvsc-new', '');
  set('fvsc-kind', lib._guide ? 'How-to guide' : (lib.type || 'Reference')); set('fvsc-name', lib.name || '');
  set('fvsc-url', safeUrl(lib.externalUrl || lib.url));
  renderPickList(); renderPickStatus();
}

// "Create new": the typed search words become the name; saving adds it to the library and links it
function createNew() {
  const set = (eid, v) => { const el = elv(eid); if (el) el.value = v; };
  if (fieldValue('fvsc-lib')) { set('fvsc-name', ''); set('fvsc-url', ''); }   // don't carry a picked item's name / link into a new one
  set('fvsc-lib', ''); set('fvsc-new', '1');
  const typed = fieldValue('fvsc-search');
  if (typed && !fieldValue('fvsc-name')) set('fvsc-name', typed);
  const f = elv('fvsc-filter'); const k = elv('fvsc-kind');
  if (f && f.value && k) k.value = f.value;
  renderPickList(); renderPickStatus();
  const nm = elv('fvsc-name'); if (nm) nm.focus();
}

function unlink() {
  const set = (eid, v) => { const el = elv(eid); if (el) el.value = v; };
  set('fvsc-lib', ''); set('fvsc-new', '');
  renderPickList(); renderPickStatus();
}

function save(resId, stepId, calloutId) {
  const res = resById(resId); const step = stepOf(res, stepId); if (!step) return;
  const v = (id) => (document.getElementById(id)?.value || '').trim();
  const err = document.getElementById('fvsc-err');
  let libId = v('fvsc-lib'); const name = v('fvsc-name'); const url = v('fvsc-url');
  if (!name) { if (err) err.textContent = 'Give it a name.'; return; }
  if (url && !safeUrl(url)) { if (err) err.textContent = 'The link needs to start with http:// or https://'; return; }
  if (!libId && v('fvsc-new') === '1') {
    // "Create new": make the library item here, then link the step to it
    const made = createLibraryItem({ kind: kindOfTypeName(v('fvsc-kind')), type: v('fvsc-kind') === 'How-to guide' ? '' : v('fvsc-kind'), name, url, note: v('fvsc-note') });
    if (!made) { if (err) err.textContent = 'Could not add it to the library here.'; return; }
    libId = made.id;
  }
  const entry = { id: calloutId || `sco-${uid()}`, kind: kindOfTypeName(v('fvsc-kind') || 'Reference'), typeLabel: v('fvsc-kind') || '', name, url, note: v('fvsc-note') };
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
  if (String(calloutId).startsWith('lnk:')) {
    const lid = String(calloutId).slice(4);
    step.links = (step.links || []).filter((l) => String(l.id) !== lid); if (!step.links.length) delete step.links;
    openSet().delete(`${keyOf(resId, stepId)}|${calloutId}`);
    return afterChange(resId, stepId);
  }
  openSet().delete(`${keyOf(resId, stepId)}|${calloutId}`);
  step.callouts = (step.callouts || []).filter((c) => c.id !== calloutId);
  if (!step.callouts.length) delete step.callouts;
  afterChange(resId, stepId);
}

// ---- the printout --------------------------------------------------------------------------------------------
// Every piece of collateral in map order, numbered C1, C2 ...: those on a step, and those on a process card.
// [{ no, label, kind, name, url, note, resId, stepId, key, where }]   (key matches the chip's data-co-key)
export function collectCollateral(pd = project()) {
  const out = [];
  const wfOf = (res) => (pd.workflows || []).find((w) => (w.resourceIds || []).map(String).includes(String(res.id)));
  orderedResources(pd).forEach((res) => {
    if (res.isArchived) return;
    const wf = wfOf(res); const base = [wf && wf.name, res.name].filter(Boolean).join(' \u203a ');
    calloutsFor(res).filter((c) => c.source !== 'logic').forEach((c) => {
      out.push({ kind: c.kind, typeLabel: c.typeLabel || '', name: c.name, url: c.url, note: c.note, libId: c.linkId || '', resId: String(res.id), stepId: '', key: c.key, where: `${base} (whole process)` });
    });
    (res.steps || []).forEach((step, idx) => {
      if (step.isArchived) return;
      calloutsOf(step).forEach((c) => {
        out.push({ kind: c.kind, typeLabel: c.typeLabel || '', name: c.name, url: c.url, note: c.note, libId: c.libId || '', resId: String(res.id), stepId: String(step.id), key: c.id, where: `${base} \u203a Step ${idx + 1}: ${step.name || 'Unnamed step'}` });
      });
    });
  });
  out.forEach((e, i) => { e.no = i + 1; e.label = `C${i + 1}`; });
  return out;
}
export const collateralNumbers = (entries) => { const m = {}; entries.forEach((e) => { m[`${e.resId}|${e.stepId}|${e.key}`] = e.label; }); return m; };

// On the printed copy of a card: chips become numbered tags (buttons are hidden on paper), and the add / mini-card bits go
export function annotateCollateral(el, numbers) {
  if (!el || typeof el.querySelectorAll !== 'function' || !numbers) return;
  el.querySelectorAll('.fv-callout-panel, .fv-callout-add').forEach((n) => n.remove());
  el.querySelectorAll('[data-step-callouts-for], [data-callouts-for]').forEach((strip) => {
    let resId = ''; let stepId = '';
    if (strip.hasAttribute('data-step-callouts-for')) [resId, stepId] = strip.getAttribute('data-step-callouts-for').split('|');
    else resId = strip.getAttribute('data-callouts-for');
    let kept = 0;
    strip.querySelectorAll('.fv-callout-chip').forEach((chip) => {
      const label = numbers[`${resId}|${stepId}|${chip.getAttribute('data-co-key')}`];
      if (!label) { chip.remove(); return; }
      const tag = chip.ownerDocument.createElement('span');
      tag.className = chip.className.replace('is-open', '').trim() + ' fv-co-print';
      // the screen chip cuts a long name short; the printed tag carries all of it (the title is "Type: Full name")
      const full = String(chip.getAttribute('title') || '').replace(/^[^:]*:\s*/, '');
      const inner = chip.ownerDocument.createElement('div'); inner.innerHTML = chip.innerHTML;
      const sp = inner.querySelector('span'); if (sp && full) sp.textContent = full;
      tag.innerHTML = `<b class="fv-co-no">${label}</b>${inner.innerHTML}`;
      chip.replaceWith(tag); kept++;
    });
    if (!kept) strip.remove();
  });
}

export function collateralAppendixHtml(entries, { title = 'Collateral and Templates', sub = '' } = {}) {
  if (!entries || !entries.length) return '';
  const e2 = (s) => esc(s);
  const plain = (h) => String(h || '').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d)>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
  // what the library item itself says: type, description, and for an email its subject and the start of its text
  const detail = (e) => {
    const lib = e.libId ? libById(e.libId) : null; if (!lib) return '';
    const bits = [];
    if (lib.type && lib.type !== 'Guide') bits.push(`<div class="apx-where">Type: ${e2(lib.type)}</div>`);
    const d = lib.description || lib.notes; if (d) bits.push(`<div class="apx-where">${e2(clip(plain(d), 300))}</div>`);
    if (lib.emailSubject) bits.push(`<div class="apx-where"><b>Subject:</b> ${e2(lib.emailSubject)}</div>`);
    // the email as written, with its formatting (cleaned the same way the app cleans other pasted HTML)
    if (lib.emailBody) {
      const clean = typeof OL().sanitizeCommentHtml === 'function' ? OL().sanitizeCommentHtml(String(lib.emailBody), { images: true }) : esc(plain(lib.emailBody)).replace(/\n/g, '<br>');
      bits.push(`<div class="apx-email">${clean}</div>`);
    }
    return bits.join('');
  };
  const rows = entries.map((e) => {
    const k = KIND[e.kind] || KIND.other;
    return `<tr class="apx-row${e.libId && (libById(e.libId) || {}).emailBody ? ' apx-row-long' : ''}">
      <td class="apx-no">${e2(e.label)}</td>
      <td class="apx-ctype">${e2(typeOf(e))}</td>
      <td><div><b>${e2(e.name)}</b></div>${e.note ? `<div class="apx-where">${e2(clip(e.note, 300))}</div>` : ''}${detail(e)}<div class="apx-where">${e2(e.where)}</div></td>
      <td class="apx-link">${e.url ? e2(e.url) : '<span class="apx-none">No link</span>'}</td></tr>`;
  }).join('');
  return `<section class="apx apx-collateral">
    <div class="apx-head"><span class="apx-title">${e2(title)}</span><span class="apx-sub">${e2(sub)}</span></div>
    <div class="apx-group"><table class="apx-table">
      <tr class="apx-th"><th>No.</th><th>Type</th><th>Name and where it is used</th><th>Link</th></tr>
      ${rows}</table></div></section>`;
}

window.OL = window.OL || {};
Object.assign(window.OL, {
  fvCollectCollateral: collectCollateral, fvCollateralNumbers: collateralNumbers, fvAnnotateCollateral: annotateCollateral, fvCollateralAppendixHtml: collateralAppendixHtml,
  fvStepCalloutStrip: stepCalloutStrip, fvStepCalloutInspector: stepCalloutInspector, fvStepCalloutsOf: calloutsOf,
  fvEditLibItem: (id) => { const O = OL(); if (!id) return; if (guideById(id) && !resById(id) && O.openGuideEditor) return O.openGuideEditor(id); O.openResourceModal(id); },
  fvToggleStepCallout: toggle, fvEditStepCallout: edit, fvStepCalloutPick: pick, fvSaveStepCallout: save, fvRemoveStepCallout: remove,
  fvStepCalloutFilter: renderPickList, fvStepCalloutCreateNew: createNew, fvStepCalloutUnlink: unlink, fvStepCalloutKindChanged: renderPickStatus,
});
