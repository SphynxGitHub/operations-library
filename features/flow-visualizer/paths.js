// ================================================================================================
// FILE: features/flow-visualizer/paths.js
//
// WHAT IT DOES:   The "Paths" section of the step editor: ONE list for everything that can happen after a step.
//                 Each path reads as a sentence:   WHEN [trigger]  ->  THEN go to [destination]  AFTER [wait]
//
//   Trigger       Always (when the step is done) | Meeting booked | Form completed | Email link clicked | Email opened |
//                 Document signed | Payment received | No response | Segment | Custom condition.
//                 The "something they do" triggers can point at a piece of this step's Collateral (a scheduling page,
//                 a form, an email template, a document), so the path knows which asset it is about.
//   Destination   a step of this process (a line on the map), "this step again" (a loop), or a step / the top of
//                 ANOTHER process (a row on the card, with the Back button and the "entered from" row).
//   Wait          a number and minutes / hours / days / weeks / months, on any path.
//
// STORED AS:      Nothing new is needed to keep the map working. A path to a step of this process stays a logic.out entry
//                 (what draws the lines and the layout); a path to another process stays a jump (step.jumps, see
//                 references.js). Both carry two extra fields: trig = { kind, assetId, libId, segmentId, text } and the
//                 existing delayValue / delayUnit. The older "rule" text and "types" are kept in step, so the map, the
//                 steps list and the printout read them as before. Picking a destination on the other side converts the
//                 path (a logic.out entry <-> a jump) and keeps its trigger and wait.
//
// SEGMENTS:       project-level named conditions in projectData.segments = [{ id, name, description }]; a path can use
//                 one as its trigger, and "Segments" (a button in the section) lists, renames and deletes them.
//
// ALSO:           OL.fvPathSummary(res, step) = the read-only lines under each step in the resource's Steps list.
// ================================================================================================

import { esc, uid } from '../../core/data.js';
import { jumpsOf, targetsFor, redrawAfterRefEdit, rawAddJump, rawRemoveJump, rawFindJump } from './references.js';

const OL = () => window.OL;
const project = () => (OL().getCurrentProjectData ? OL().getCurrentProjectData() : { resources: [] }) || { resources: [] };
const allRes = () => (project().resources || []).filter((r) => r && !r.isDeleted);
const resById = (id) => allRes().find((r) => String(r.id) === String(id));
const stepOf = (res, id) => ((res && res.steps) || []).find((s) => String(s.id) === String(id));
const icon = (name, size = 12) => `<i data-lucide="${name}" style="width:${size}px;height:${size}px;"></i>`;
const split = (full) => { const s = String(full || ''); const i = OL()._refSplitIdx ? OL()._refSplitIdx(s) : s.lastIndexOf('-'); return i < 0 ? ['', ''] : [s.slice(0, i), s.slice(i + 1)]; };

// ---- the vocabulary ---------------------------------------------------------------------------------------------
const TRIGGERS = [
  { key: 'always',     label: 'Always (when this step is done)', short: 'Always', icon: 'check',                group: 'Always' },
  { key: 'meeting',    label: 'Meeting booked',         icon: 'calendar',            group: 'Something they do', asset: 'event',    assetLabel: 'scheduling page' },
  { key: 'form',       label: 'Form completed',         icon: 'file-text',           group: 'Something they do', asset: 'form',     assetLabel: 'form' },
  { key: 'link',       label: 'Email link clicked',     icon: 'mouse-pointer-click', group: 'Something they do', asset: 'email',    assetLabel: 'email template' },
  { key: 'open',       label: 'Email opened',           icon: 'mail-open',           group: 'Something they do', asset: 'email',    assetLabel: 'email template' },
  { key: 'signed',     label: 'Document signed',        icon: 'pen-line',            group: 'Something they do', asset: 'document', assetLabel: 'document' },
  { key: 'payment',    label: 'Payment received',       icon: 'credit-card',         group: 'Something they do' },
  { key: 'noresponse', label: 'No response',            icon: 'clock',               group: 'Time' },
  { key: 'segment',    label: 'Segment',                icon: 'users',               group: 'Who they are' },
  { key: 'custom',     label: 'Custom condition',       icon: 'text-cursor-input',   group: 'Other' },
];
const TRIG = Object.fromEntries(TRIGGERS.map((t) => [t.key, t]));
const UNITS = ['minutes', 'hours', 'days', 'weeks', 'months'];

// ---- segments ---------------------------------------------------------------------------------------------------
const segList = () => { const pd = project(); return Array.isArray(pd.segments) ? pd.segments.filter((x) => x && x.id) : []; };
const segById = (id) => segList().find((x) => String(x.id) === String(id));
function segAdd(name) {
  const pd = project(); const n = String(name || '').trim().slice(0, 80); if (!n) return null;
  if (!Array.isArray(pd.segments)) pd.segments = [];
  const hit = pd.segments.find((x) => String(x.name).toLowerCase() === n.toLowerCase()); if (hit) return hit;
  const seg = { id: `seg-${uid()}`, name: n, description: '' }; pd.segments.push(seg); return seg;
}

// ---- reading the paths on a step --------------------------------------------------------------------------------
function calloutsOnStep(step) { try { return (OL().fvStepCalloutsOf ? OL().fvStepCalloutsOf(step) : []) || []; } catch { return []; } }

// the words for a trigger ("Meeting booked: 20 minute call page")
function trigText(trig, step) {
  const t = trig || { kind: 'always' };
  if (t.kind === 'always') return '';
  if (t.kind === 'custom') return String(t.text || '').trim();
  if (t.kind === 'segment') { const s = segById(t.segmentId); return s ? `Segment: ${s.name}` : 'Segment'; }
  const base = (TRIG[t.kind] || {}).label || '';
  const a = t.assetId ? calloutsOnStep(step).find((c) => String(c.id) === String(t.assetId)) : null;
  return a ? `${base}: ${a.name}` : base;
}
const waitText = (v, u) => (Number(v) > 0 ? `after ${Number(v)} ${Number(v) === 1 ? String(u || 'days').replace(/s$/, '') : (u || 'days')}` : '');

// a step's paths as one list: logic.out entries first (lines on the map), then jumps (rows on the card)
function pathsOf(resId, step) {
  const out = [];
  const own = `${resId}-${step.id}`;
  ((step.logic && step.logic.out) || []).forEach((l, idx) => {
    if (!l) return;
    const types = l.types || [l.type || 'next'];
    const trig = l.trig && l.trig.kind ? l.trig : (types.includes('condition') ? { kind: 'custom', text: l.rule || '' } : { kind: 'always' });
    const [dr, ds] = l.targetId ? split(l.targetId) : ['', ''];
    const loop = !!l.targetId && String(l.targetId) === own;
    out.push({ key: `o:${idx}`, src: 'out', ref: l, trig, wait: { v: l.delayValue, u: l.delayUnit || 'days' }, destRes: dr, destStep: ds, loop, limit: l.loopLimit || '' });
  });
  jumpsOf(step).forEach((j) => {
    const trig = j.trig && j.trig.kind ? j.trig : (j.label ? { kind: 'custom', text: j.label } : { kind: 'always' });
    out.push({ key: `j:${j.id}`, src: 'jump', ref: j, trig, wait: { v: j.delayValue, u: j.delayUnit || 'days' }, destRes: j.resId || '', destStep: j.stepId || '', loop: false, limit: '' });
  });
  return out;
}
// for edits: a jump that only exists as the older single link is stored as a real jump first, so the change is kept
const pathByKey = (resId, step, key) => {
  const p = pathsOf(resId, step).find((x) => x.key === key) || null;
  if (p && p.src === 'jump') { const real = rawFindJump(step, p.ref.id); if (real) p.ref = real; }
  if (p && !p.ref.trig) p.ref.trig = p.trig;   // an older path: keep what it says (its condition text) when anything else is edited
  return p;
};

// what a path points at, in words
function destText(resId, stepId, p) {
  if (p.loop) return 'This step again (loop)';
  if (!p.destRes) return '';
  const r = resById(p.destRes); if (!r) return 'A process that was removed';
  const s = p.destStep ? stepOf(r, p.destStep) : null;
  if (String(p.destRes) === String(resId)) return s ? `Step ${((r.steps || []).indexOf(s)) + 1}: ${s.name || 'Unnamed step'}` : 'Choose where';
  return s ? `${r.name || 'Process'} › ${s.name || 'a step'}` : `${r.name || 'Process'} (top)`;
}

// ---- writing -----------------------------------------------------------------------------------------------------
function ctx(resId, stepId) { const res = resById(resId); const step = stepOf(res, stepId); return step ? { res, step } : null; }

// keep the older fields (types, type, rule) equal to what the path now says, so the map and printout read it as before
function syncOut(l, resId, step) {
  const t = l.trig || { kind: 'always' };
  const loop = !!l.targetId && String(l.targetId) === `${resId}-${step.id}`;
  const types = [];
  if (t.kind !== 'always') types.push('condition');
  if (loop) types.push('loop');
  if (Number(l.delayValue) > 0) types.push('delay');
  if (!types.length) types.push('next');
  l.types = types; l.type = types[0];
  l.rule = trigText(t, step);
}
// a jump has one line of text for the row on the card: its trigger and its wait
function syncJump(j, step) {
  const t = j.trig || { kind: 'always' };
  j.label = [trigText(t, step), waitText(j.delayValue, j.delayUnit)].filter(Boolean).join(', ').slice(0, 120);
}

function commit(resId, stepId) {
  if (OL().syncLogicPorts) OL().syncLogicPorts();
  redrawAfterRefEdit(resId, stepId);
}

function edit(resId, stepId, key, fn) {
  const c = ctx(resId, stepId); if (!c) return;
  const p = pathByKey(resId, c.step, key); if (!p) return;
  fn(p, c.step, c.res);
  if (p.src === 'out') syncOut(p.ref, resId, c.step); else syncJump(p.ref, c.step);
  commit(resId, stepId);
}

function addPath(resId, stepId) {
  const c = ctx(resId, stepId); if (!c) return;
  if (!c.step.logic) c.step.logic = { in: [], out: [] };
  if (!Array.isArray(c.step.logic.out)) c.step.logic.out = [];
  c.step.logic.out.push({ type: 'next', types: ['next'], rule: '', targetId: null, trig: { kind: 'always' }, loopLimit: '', delayValue: '', delayUnit: 'days' });
  c.step.noAutoNext = true;
  commit(resId, stepId);
}

function removePath(resId, stepId, key) {
  const c = ctx(resId, stepId); if (!c) return;
  const p = pathByKey(resId, c.step, key); if (!p) return;
  if (!confirm('Remove this path?')) return;
  if (p.src === 'out') { c.step.logic.out.splice(Number(key.slice(2)), 1); c.step.noAutoNext = true; }
  else rawRemoveJump(c.step, p.ref.id);
  commit(resId, stepId);
}

function setTrigger(resId, stepId, key, kind) {
  edit(resId, stepId, key, (p, step) => {
    const prev = p.trig || {};
    const next = { kind };
    if (kind === 'custom') next.text = prev.text || (prev.kind && prev.kind !== 'always' ? trigText(prev, step) : '');
    const def = TRIG[kind] || {};
    if (def.asset) {
      const fit = calloutsOnStep(step).filter((c) => c.kind === def.asset);
      if (fit.length === 1) { next.assetId = fit[0].id; if (fit[0].libId) next.libId = fit[0].libId; }
    }
    p.ref.trig = next; p.trig = next;
  });
}
const setAsset = (resId, stepId, key, calloutId) => edit(resId, stepId, key, (p, step) => {
  const a = calloutsOnStep(step).find((c) => String(c.id) === String(calloutId));
  p.ref.trig = { ...p.trig, assetId: a ? a.id : '', libId: a && a.libId ? a.libId : '' };
});
const setSegment = (resId, stepId, key, segId) => edit(resId, stepId, key, (p) => { p.ref.trig = { kind: 'segment', segmentId: segId }; });
const setCustom = (resId, stepId, key, text) => edit(resId, stepId, key, (p) => { p.ref.trig = { kind: 'custom', text: String(text || '').trim().slice(0, 120) }; });
function setWait(resId, stepId, key, v, u) {
  edit(resId, stepId, key, (p) => {
    const n = Math.max(0, Math.floor(Number(v) || 0));
    p.ref.delayValue = n ? String(n) : ''; p.ref.delayUnit = UNITS.includes(u) ? u : (p.wait.u || 'days');
  });
}
const setLimit = (resId, stepId, key, v) => edit(resId, stepId, key, (p) => { if (p.src === 'out') p.ref.loopLimit = String(v || '').trim(); });

// the destination: a step of this process stays a line (logic.out), another process is a row (jump); crossing over converts the path
function setDest(resId, stepId, key, destRes, destStep) {
  const c = ctx(resId, stepId); if (!c) return;
  const p = pathByKey(resId, c.step, key); if (!p) return;
  const sameProc = String(destRes) === String(resId);
  const extras = { trig: p.trig, delayValue: p.ref.delayValue || '', delayUnit: p.ref.delayUnit || 'days' };
  if (p.src === 'out' && sameProc) {
    p.ref.targetId = destStep === '__self__' ? `${resId}-${stepId}` : `${resId}-${destStep}`;
    c.step.noAutoNext = true;
    syncOut(p.ref, resId, c.step);
  } else if (p.src === 'out') {
    c.step.logic.out.splice(Number(key.slice(2)), 1); c.step.noAutoNext = true;
    const j = rawAddJump(c.step, { resId: String(destRes), stepId: destStep || '', ...extras });
    syncJump(j, c.step);
  } else if (sameProc) {
    rawRemoveJump(c.step, p.ref.id);
    if (!c.step.logic) c.step.logic = { in: [], out: [] };
    if (!Array.isArray(c.step.logic.out)) c.step.logic.out = [];
    const l = { type: 'next', types: ['next'], rule: '', targetId: destStep === '__self__' ? `${resId}-${stepId}` : `${resId}-${destStep}`, loopLimit: '', ...extras };
    syncOut(l, resId, c.step); c.step.logic.out.push(l); c.step.noAutoNext = true;
  } else {
    p.ref.resId = String(destRes); p.ref.stepId = destStep || '';
    syncJump(p.ref, c.step);
  }
  commit(resId, stepId);
}

// ---- segments: create / manage ----------------------------------------------------------------------------------
function newSegmentFor(resId, stepId, key) {
  const name = window.prompt('Name this segment (for example: Prospect, no meeting yet)');
  const seg = segAdd(name); if (!seg) return;
  setSegment(resId, stepId, key, seg.id);
}
function segUsage(segId) {
  const uses = [];
  allRes().forEach((r) => (r.steps || []).forEach((s) => {
    pathsOf(r.id, s).forEach((p) => { if (p.trig && p.trig.kind === 'segment' && String(p.trig.segmentId) === String(segId)) uses.push({ res: r, step: s, p }); });
  }));
  return uses;
}
function retextSegment(segId) {
  allRes().forEach((r) => (r.steps || []).forEach((s) => pathsOf(r.id, s).forEach((p) => {
    if (p.trig && p.trig.kind === 'segment' && String(p.trig.segmentId) === String(segId)) { if (p.src === 'out') syncOut(p.ref, r.id, s); else syncJump(p.ref, s); }
  })));
}
function segmentsModal() {
  const rows = segList().map((g) => {
    const uses = segUsage(g.id);
    const where = uses.length ? uses.map((u) => `<div class="fvp-use">${esc(u.res.name || 'Process')} &rsaquo; ${esc(u.step.name || 'Step')}</div>`).join('') : '<div class="tiny muted">Not used yet.</div>';
    return `<div class="fvp-seg-row">
      <div style="display:flex;align-items:center;gap:8px;"><span style="color:var(--accent);">${icon('users', 13)}</span><b style="flex:1;min-width:0;">${esc(g.name)}</b>
        <span class="tiny muted">${uses.length} path${uses.length === 1 ? '' : 's'}</span>
        <button type="button" class="btn tiny soft" onclick="OL.fvSegRename('${esc(g.id)}')">Rename</button>
        <button type="button" class="btn tiny soft" onclick="OL.fvSegDelete('${esc(g.id)}')">Delete</button></div>
      <input class="modal-input tiny" style="margin-top:6px;" placeholder="What it means (optional), e.g. Tagged Prospect in the CRM and no booking" value="${esc(g.description || '')}" onchange="OL.fvSegDescribe('${esc(g.id)}', this.value)">
      <div style="margin-top:6px;">${where}</div></div>`;
  }).join('') || '<div class="tiny muted" style="padding:10px 0;">No segments yet. A segment is a named group of people, such as &ldquo;Client over $1M&rdquo;, that a path can use as its trigger.</div>';
  window.openModal(`
    <div class="modal-head"><div class="modal-title-text">Segments</div><button class="btn small soft" style="margin-left:auto;" onclick="OL.closeModal()">Close</button></div>
    <div class="modal-body" style="width:100%;box-sizing:border-box;">
      <p class="tiny muted" style="margin-top:0;">Named conditions that are not tied to an asset. Use one as the trigger of a path; renaming it here updates every path that uses it.</p>
      <div style="display:flex;gap:8px;margin-bottom:12px;"><input id="fvp-seg-new" class="modal-input" style="flex:1;margin:0;" placeholder="New segment name" onkeydown="if(event.key==='Enter'){OL.fvSegCreate();}"><button class="btn primary" onclick="OL.fvSegCreate()">Add</button></div>
      ${rows}
    </div>`);
  if (window.lucide) window.lucide.createIcons();
}
function segSave() { OL().persist(); segmentsModal(); }
function segCreate() { const el = document.getElementById('fvp-seg-new'); const seg = segAdd(el && el.value); if (seg) segSave(); }
function segRename(id) {
  const g = segById(id); if (!g) return;
  const name = window.prompt('Rename segment', g.name); if (name == null || !name.trim()) return;
  g.name = name.trim().slice(0, 80); retextSegment(id); segSave();
}
function segDescribe(id, text) { const g = segById(id); if (!g) return; g.description = String(text || '').trim().slice(0, 300); OL().persist(); }
function segDelete(id) {
  const g = segById(id); if (!g) return;
  const uses = segUsage(id);
  if (!confirm(uses.length ? `Delete "${g.name}"? ${uses.length} path${uses.length === 1 ? '' : 's'} use it and will be left with a blank Segment trigger.` : `Delete "${g.name}"?`)) return;
  const pd = project(); pd.segments = (pd.segments || []).filter((x) => x !== g);
  retextSegment(id); segSave();
  if (document.querySelector('.inspector-scroll-content') && OL()._fvRefreshInspector) { /* the editor behind the dialog is redrawn when it closes */ }
}

// ---- menus -------------------------------------------------------------------------------------------------------
const group = (label) => `<div class="fvp-group">${esc(label)}</div>`;
const item = (ic, text, click, { on = false, right = '', q = text, cls = '' } = {}) =>
  `<div class="fvp-item${on ? ' on' : ''} ${cls}" data-q="${esc(String(q).toLowerCase())}" onclick="event.stopPropagation(); ${click}">${ic ? icon(ic, 12) : ''}<span class="fvp-item-t">${esc(text)}</span>${right ? `<span class="fvp-item-r">${esc(right)}</span>` : ''}</div>`;
function menu(id, labelHtml, items, { search = false, placeholder = '' } = {}) {
  return `<div class="fvp-wrap"><button type="button" class="fvp-btn${placeholder ? ' is-empty' : ''}" onclick="OL.fvpToggle('${id}', event)"><span class="fvp-btn-t">${labelHtml}</span>${icon('chevron-down', 12)}</button>
    <div class="fvp-menu" id="${id}" onclick="event.stopPropagation()">${search ? '<input type="text" class="fvp-search" placeholder="Search..." oninput="OL.fvpFilter(this)" onclick="event.stopPropagation()">' : ''}<div class="fvp-list">${items}</div></div></div>`;
}
function toggleMenu(id, ev) {
  if (ev) ev.stopPropagation();
  const el = document.getElementById(id); if (!el) return;
  const was = el.classList.contains('open');
  document.querySelectorAll('.fvp-menu.open').forEach((m) => m.classList.remove('open'));
  if (was) return;
  el.classList.add('open');
  // The menu is drawn fixed to the window (not inside the scrolling side panel), so it is never cut off at the bottom:
  // it opens below the button when there is room, otherwise above it, and the list scrolls within the space available.
  const wrap = el.parentElement; const rect = wrap.getBoundingClientRect();
  const below = window.innerHeight - rect.bottom - 12, above = rect.top - 12;
  const up = below < 240 && above > below;
  const room = Math.max(140, (up ? above : below));
  const list = el.querySelector('.fvp-list');
  const searchH = el.querySelector('.fvp-search') ? 44 : 0;
  if (list) list.style.maxHeight = Math.min(320, room - searchH - 8) + 'px';
  el.style.left = rect.left + 'px'; el.style.width = rect.width + 'px';
  if (up) { el.style.top = ''; el.style.bottom = (window.innerHeight - rect.top + 4) + 'px'; }
  else { el.style.bottom = ''; el.style.top = (rect.bottom + 4) + 'px'; }
  const s = el.querySelector('.fvp-search'); if (s) setTimeout(() => s.focus({ preventScroll: true }), 30);
}
function filterMenu(input) {
  const q = String(input.value || '').toLowerCase().trim();
  const list = input.parentElement.querySelector('.fvp-list'); if (!list) return;
  let lastGroup = null; let any = false;
  Array.from(list.children).forEach((el) => {
    if (el.classList.contains('fvp-group')) { lastGroup = el; el.style.display = q ? 'none' : ''; return; }
    const hit = !q || (el.getAttribute('data-q') || '').includes(q) || (el.classList.contains('fvp-always') );
    el.style.display = hit ? '' : 'none';
    if (hit && q && lastGroup) lastGroup.style.display = '';
    if (hit) any = true;
  });
  let none = list.querySelector('.fvp-none');
  if (!any && q) { if (!none) { none = document.createElement('div'); none.className = 'fvp-none'; none.textContent = 'Nothing matches.'; list.appendChild(none); } none.style.display = ''; }
  else if (none) none.style.display = 'none';
}
if (!window.__fvpDocClose) { window.__fvpDocClose = true; window.addEventListener('scroll', (e) => { if (e.target && e.target.closest && e.target.closest('.fvp-menu')) return; document.querySelectorAll('.fvp-menu.open').forEach((m) => m.classList.remove('open')); }, true); window.addEventListener('resize', () => document.querySelectorAll('.fvp-menu.open').forEach((m) => m.classList.remove('open'))); document.addEventListener('click', (e) => { if (!e.target.closest || !e.target.closest('.fvp-wrap')) document.querySelectorAll('.fvp-menu.open').forEach((m) => m.classList.remove('open')); }); }

// ---- the editor --------------------------------------------------------------------------------------------------
function destMenu(resId, step, p, mid) {
  const r = esc(resId), s = esc(step.id), k = esc(p.key);
  const label = destText(resId, step.id, p);
  let body = '';
  const procs = targetsFor(resId);
  const ordered = procs.filter((x) => x.id === String(resId)).concat(procs.filter((x) => x.id !== String(resId)));
  ordered.forEach((pr) => {
    const res = resById(pr.id); if (!res) return;
    const mine = pr.id === String(resId);
    body += group(mine ? `${res.name || 'This process'} (this process)` : `${res.name || 'Process'}${pr.workflow ? '  ·  ' + pr.workflow : ''}`);
    if (mine) body += item('repeat', 'This step again (loop)', `OL.fvPathDest('${r}','${s}','${k}','${esc(pr.id)}','__self__')`, { on: p.loop, q: 'this step again loop repeat' });
    else body += item('corner-up-right', 'Top of the process', `OL.fvPathDest('${r}','${s}','${k}','${esc(pr.id)}','')`, { on: String(p.destRes) === pr.id && !p.destStep, q: `${res.name} top of the process` });
    (res.steps || []).forEach((x, i) => {
      if (!x || x.isArchived || (mine && String(x.id) === String(step.id))) return;
      body += item(mine ? 'corner-down-right' : 'arrow-right', `${i + 1}. ${x.name || 'Unnamed step'}`, `OL.fvPathDest('${r}','${s}','${k}','${esc(pr.id)}','${esc(x.id)}')`,
        { on: !p.loop && String(p.destRes) === pr.id && String(p.destStep) === String(x.id), q: `${res.name} ${x.name || ''} ${i + 1}` });
    });
  });
  return menu(mid, label ? esc(label) : 'Choose where...', body, { search: true, placeholder: label ? '' : 'x' });
}

function pathRow(resId, step, p, n) {
  const r = esc(resId), s = esc(step.id), k = esc(p.key);
  const id = (slot) => `fvpm-${step.id}-${p.key.replace(/[^a-z0-9]/gi, '')}-${slot}`;
  const t = TRIG[p.trig.kind] || TRIG.always;
  // trigger menu
  let tb = ''; let lastG = '';
  TRIGGERS.forEach((x) => { if (x.group !== lastG) { tb += group(x.group); lastG = x.group; } tb += item(x.icon, x.label, `OL.fvPathTrigger('${r}','${s}','${k}','${x.key}')`, { on: x.key === t.key }); });
  const trigMenu = menu(id('t'), `${icon(t.icon, 12)} ${esc(t.label)}`, tb);
  // second control for the trigger: asset, segment or custom text
  let extra = '';
  if (t.asset) {
    const fit = calloutsOnStep(step).filter((c) => c.kind === t.asset);
    const cur = fit.find((c) => String(c.id) === String(p.trig.assetId));
    let ab = group(`${t.assetLabel}s on this step`);
    ab += fit.length ? fit.map((c) => item(c.kind === 'event' ? 'calendar' : (c.kind === 'form' ? 'file-text' : (c.kind === 'email' ? 'mail' : 'file')), c.name, `OL.fvPathAsset('${r}','${s}','${k}','${esc(c.id)}')`, { on: cur && cur.id === c.id })).join('') : `<div class="fvp-none">None on this step yet.</div>`;
    ab += `<div class="fvp-item fvp-add fvp-always" onclick="event.stopPropagation(); OL.fvEditStepCallout('${r}','${s}')">${icon('plus', 12)}<span class="fvp-item-t">Add a ${esc(t.assetLabel)} to this step</span></div>`;
    extra = menu(id('a'), cur ? esc(cur.name) : `Which ${esc(t.assetLabel)}?`, ab, { placeholder: cur ? '' : 'x' });
  } else if (t.key === 'segment') {
    const cur = segById(p.trig.segmentId);
    let sb = group('Segments') + (segList().length ? segList().map((g) => item('users', g.name, `OL.fvPathSegment('${r}','${s}','${k}','${esc(g.id)}')`, { on: cur && cur.id === g.id, right: `${segUsage(g.id).length} paths` })).join('') : '<div class="fvp-none">No segments yet.</div>');
    sb += `<div class="fvp-item fvp-add fvp-always" onclick="event.stopPropagation(); OL.fvPathNewSegment('${r}','${s}','${k}')">${icon('plus', 12)}<span class="fvp-item-t">Create a new segment</span></div>`;
    extra = menu(id('g'), cur ? esc(cur.name) : 'Choose a segment', sb, { search: true, placeholder: cur ? '' : 'x' });
  } else if (t.key === 'custom') {
    extra = `<input type="text" class="modal-input tiny fvp-text" maxlength="120" placeholder="e.g. If the client asks to pause" value="${esc(p.trig.text || '')}" onchange="OL.fvPathCustom('${r}','${s}','${k}', this.value)">`;
  }
  const wait = `<div class="fvp-wait"><span class="fvp-lab">after</span>
    <input type="number" min="0" class="modal-input tiny fvp-num" placeholder="0" value="${esc(String(p.wait.v || ''))}" onchange="OL.fvPathWait('${r}','${s}','${k}', this.value, document.getElementById('${id('u')}').value)">
    <select id="${id('u')}" class="modal-input tiny fvp-unit" onchange="OL.fvPathWait('${r}','${s}','${k}', this.previousElementSibling.value, this.value)">${UNITS.map((u) => `<option value="${u}" ${String(p.wait.u || 'days') === u ? 'selected' : ''}>${u}</option>`).join('')}</select></div>`;
  const loopBox = p.loop ? `<div class="fvp-wait"><span class="fvp-lab">limit</span><input type="text" class="modal-input tiny" maxlength="40" placeholder="e.g. 3 times, or blank for no limit" value="${esc(p.limit)}" onchange="OL.fvPathLimit('${r}','${s}','${k}', this.value)"></div>` : '';
  const kindChip = p.loop ? `${icon('repeat', 11)} repeats` : (p.src === 'jump' ? `${icon('corner-up-right', 11)} row on the card` : (p.destRes && String(p.destRes) === String(resId) ? `${icon('git-commit-horizontal', 11)} line on the map` : ''));
  return `<div class="fvp-row">
    <div class="fvp-head"><span class="fvp-n">Path ${n}</span>${kindChip ? `<span class="fvp-kind">${kindChip}</span>` : ''}<button type="button" class="fvp-x" title="Remove this path" onclick="OL.fvPathRemove('${r}','${s}','${k}')">${icon('x', 12)}</button></div>
    <div class="fvp-line"><span class="fvp-lab">when</span><div class="fvp-ctl">${trigMenu}${extra}</div></div>
    <div class="fvp-line"><span class="fvp-lab fvp-arrowlab">${icon('arrow-right', 13)}</span><div class="fvp-ctl">${destMenu(resId, step, p, id('d'))}</div></div>
    ${wait}${loopBox}
  </div>`;
}

export function pathsEditor(resId, step) {
  const list = pathsOf(resId, step);
  const r = esc(resId), s = esc(step.id);
  const rows = list.map((p, i) => pathRow(resId, step, p, i + 1)).join('')
    || '<div class="tiny muted" style="margin-bottom:8px;">No paths yet. A step with none continues to the next step in its process.</div>';
  return `${rows}<div style="display:flex;gap:8px;align-items:center;">
    <button type="button" class="btn tiny primary" onclick="OL.fvPathAdd('${r}','${s}')">${icon('plus', 11)} Add path</button>
    <button type="button" class="btn tiny soft" onclick="OL.fvSegmentsManage()">${icon('users', 11)} Segments</button></div>
    <div class="tiny muted" style="margin-top:6px;">A path to a step of this process is a line on the map. A path to another process is a row on the card, with a Back button and an &ldquo;entered from&rdquo; row on the other side.</div>`;
}

// ---- the lines under each step in the resource's Steps list -------------------------------------------------------
export function pathSummary(res, step) {
  if (!res || !step) return '';
  const list = pathsOf(res.id, step).filter((p) => p.destRes || p.loop || p.trig.kind !== 'always');
  let lines = list.map((p) => {
    const ic = p.loop ? 'repeat' : (p.src === 'jump' || (p.destRes && String(p.destRes) !== String(res.id)) ? 'corner-up-right' : 'arrow-right');
    const when = trigText(p.trig, step) || 'Always';
    const to = destText(res.id, step.id, p) || 'no destination yet';
    const w = waitText(p.wait.v, p.wait.u);
    return `<div class="fvp-sum">${icon(ic, 11)}<span class="fvp-sum-when">${esc(when)}</span><span class="fvp-sum-to">${esc(to)}</span>${w ? `<span class="fvp-sum-w">${esc(w)}</span>` : ''}</div>`;
  });
  if (!lines.length && !step.noAutoNext) {
    const steps = (res.steps || []).filter((x) => x && !x.isArchived); const i = steps.indexOf(step);
    if (i > -1 && i < steps.length - 1) lines = [`<div class="fvp-sum fvp-sum-auto">${icon('arrow-right', 11)}<span class="fvp-sum-when">Always</span><span class="fvp-sum-to">Next step</span></div>`];
  }
  return lines.length ? `<div class="fvp-sums">${lines.join('')}</div>` : '';
}


// ---- consolidation groups: pick an existing group, or start a new one ---------------------------------------------
function groupsInUse() {
  const m = new Map();
  allRes().forEach((r) => (r.steps || []).forEach((st) => {
    const g = st && !st.isArchived && st.stepGroup && String(st.stepGroup).trim(); if (!g) return;
    const e = m.get(g) || { name: g, count: 0, procs: new Set() }; e.count += 1; e.procs.add(r.name || 'Process'); m.set(g, e);
  }));
  return Array.from(m.values()).sort((a, b) => a.name.localeCompare(b.name));
}
function setGroup(resId, stepId, name) {
  const c = ctx(resId, stepId); if (!c) return;
  const n = String(name || '').trim().slice(0, 80);
  if (n) c.step.stepGroup = n; else delete c.step.stepGroup;
  redrawAfterRefEdit(resId, stepId);
}
function renameGroup(resId, stepId) {
  const c = ctx(resId, stepId); if (!c || !c.step.stepGroup) return;
  const old = c.step.stepGroup; const hits = [];
  allRes().forEach((r) => (r.steps || []).forEach((st) => { if (st && st.stepGroup === old) hits.push(st); }));
  const name = window.prompt(`Rename "${old}" (changes all ${hits.length} step${hits.length === 1 ? '' : 's'} in this group)`, old);
  if (name == null || !name.trim()) return;
  hits.forEach((st) => { st.stepGroup = name.trim().slice(0, 80); });
  redrawAfterRefEdit(resId, stepId);
}
export function groupEditor(resId, step) {
  const r = esc(resId), s = esc(step.id);
  const groups = groupsInUse(); const cur = step.stepGroup ? String(step.stepGroup) : '';
  const curInfo = groups.find((g) => g.name === cur);
  let body = groups.length ? group('Existing groups') + groups.map((g) => item('git-merge', g.name, `OL.fvGroupSet('${r}','${s}','${esc(g.name).replace(/'/g, '&#39;')}')`, { on: g.name === cur, right: `${g.count} step${g.count === 1 ? '' : 's'}`, q: g.name })).join('') : '<div class="fvp-none">No groups yet. Type a name below to start one.</div>';
  body += `<div class="fvp-newgroup fvp-always" onclick="event.stopPropagation()">${group('Start a new group')}<div style="padding:6px;"><input type="text" class="modal-input tiny" maxlength="80" placeholder="New group name, then Enter" onkeydown="if(event.key==='Enter'){event.preventDefault(); OL.fvGroupSet('${r}','${s}', this.value);}"></div></div>`;
  const pick = menu(`fvpm-grp-${step.id}`, cur ? `${icon('git-merge', 12)} Move to another group` : `${icon('git-merge', 12)} Add to a group`, body, { search: true });
  const chip = cur ? `<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap;">
      <span class="chip-grp">${icon('git-merge', 11)} ${esc(cur)}${curInfo ? ` <span class="tiny muted">(${curInfo.count} step${curInfo.count === 1 ? '' : 's'})</span>` : ''}</span>
      <button type="button" class="btn tiny soft" onclick="OL.fvGroupRename('${r}','${s}')">Rename group</button>
      <button type="button" class="btn tiny soft" onclick="OL.fvGroupSet('${r}','${s}','')">Remove from group</button></div>`
    : '<div class="tiny muted" style="margin-bottom:6px;">Not grouped</div>';
  return `${chip}${pick}<div class="tiny muted" style="margin-top:6px;">Steps with the same group name, in any process, are shown as one card on the map.</div>`;
}

Object.assign(window.OL = window.OL || {}, {
  fvGroupEditor: groupEditor, fvGroupSet: setGroup, fvGroupRename: renameGroup,
  fvPathsEditor: pathsEditor, fvPathSummary: pathSummary,
  fvPathAdd: addPath, fvPathRemove: removePath, fvPathTrigger: setTrigger, fvPathAsset: setAsset, fvPathSegment: setSegment,
  fvPathCustom: setCustom, fvPathWait: setWait, fvPathLimit: setLimit, fvPathDest: setDest, fvPathNewSegment: newSegmentFor,
  fvpToggle: toggleMenu, fvpFilter: filterMenu,
  fvSegmentsManage: segmentsModal, fvSegCreate: segCreate, fvSegRename: segRename, fvSegDelete: segDelete, fvSegDescribe: segDescribe,
  fvSegmentsOf: segList, fvSegmentUsage: segUsage,
});
