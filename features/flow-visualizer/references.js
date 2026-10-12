// ================================================================================================
// FILE: features/flow-visualizer/references.js
//
// WHAT IT DOES:   Lets a step point at ANOTHER process, so a shared process ("Completed Form") is drawn once and
//                 referred to from every place that uses it, instead of being copied.
//
//   On the step      a step can carry step.refResId = the id of the process it refers to. Its card (Steps view) and its
//                    row (List view) show a small "See Completed Form" chip.
//   Click the chip   the map scrolls down to that process and flashes it; a "Back to <step>" pill stays on screen, so one
//                    click takes you back to where you were. Jumps stack, so Back can be pressed more than once.
//   On the process   a process that other steps refer to shows "Used in N places"; click it for the list, and click an
//                    entry to jump to that step.
//   On paper         the printout shows the same chips as callouts with the page number of the process they point at
//                    ("See Completed Form, page 4") and the process itself says which pages refer to it. The page
//                    numbers are filled in by features/flow-print.js; this file only marks the places (.fv-ref-pg, .fv-used-pg).
//
// SETTING IT:     the step editor on the flow map ("See another process"), the Frame-out step panel, or typing
//                 "-> Process name" at the end of a step in Frame-out.
//
// STORED AS:      step.jumps = [{ id, resId, stepId, label }], one entry per jump, so a step can carry several (an email with a
//                 booking link AND an unsubscribe link). resId = the process jumped to, stepId = a step of that process
//                 (optional; may be this same process: "20 minute call scheduled" further down), label = what triggers it
//                 (optional: "Clicks the link and books a call"). The chip then reads "Clicks the link and books a call: 20 minute
//                 call scheduled", and the target step shows an "Entered from" badge. Both are drawn as full-width rows on the step's
//                 card, not as pills under its name: the ways out along the bottom (jumpRowsOut), and the way in across the top
//                 of the card they land on, with a down arrow (jumpRowsIn).
//                 The first jump is also mirrored into step.refResId / refStepId / refLabel, which is what the older single
//                 "See another process" link (and Frame-out) used. A step that only has those fields is read as one jump.
// ================================================================================================

import { esc } from '../../core/data.js';

const OL = () => window.OL;
const project = () => (OL().getCurrentProjectData ? OL().getCurrentProjectData() : { resources: [] }) || { resources: [] };
const allRes = () => (project().resources || project().localResources || []).filter((r) => r && !r.isDeleted);
const resById = (id) => allRes().find((r) => String(r.id) === String(id));
const stepOf = (res, id) => ((res && res.steps) || []).find((s) => String(s.id) === String(id));
const workflowName = (res) => { const w = (project().workflows || []).find((x) => (x.resourceIds || []).map(String).includes(String(res.id))); return w ? w.name : ''; };

// ---- the jumps on a step -----------------------------------------------------------------------------------------
const newId = () => `j${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;

// every jump on a step, newest storage first; a step that only has the old single link reads as one jump
export function jumpsOf(step) {
  if (!step) return [];
  if (Array.isArray(step.jumps)) return step.jumps.filter((j) => j && j.id);
  if (step.refResId) return [{ id: 'legacy', resId: String(step.refResId), stepId: step.refStepId ? String(step.refStepId) : '', label: step.refLabel || '' }];
  return [];
}
// a jump with no target yet, or one that points at its own process with no step, is just the editor half-filled in: it goes nowhere
const isDangling = (resId, j) => !j || !j.resId || (String(j.resId) === String(resId) && !j.stepId);

// the list stored on the step, created from the old single link the first time one is edited
function ensureJumps(step) {
  if (!Array.isArray(step.jumps)) step.jumps = jumpsOf(step).map((j) => ({ ...j, id: newId() }));
  return step.jumps;
}
const findJump = (step, jumpId) => { const l = ensureJumps(step); return l.find((j) => j.id === jumpId) || (jumpId === 'legacy' ? l[0] : null) || null; };

// keep the old single fields equal to the first jump, for the readers that still use them (Frame-out, print)
function syncLegacy(step) {
  const first = Array.isArray(step.jumps) ? step.jumps[0] : null;
  if (Array.isArray(step.jumps) && !step.jumps.length) delete step.jumps;
  if (first && first.resId) {
    step.refResId = String(first.resId);
    if (first.stepId) step.refStepId = String(first.stepId); else delete step.refStepId;
    if (first.label) step.refLabel = first.label; else delete step.refLabel;
  } else { delete step.refResId; delete step.refStepId; delete step.refLabel; }
}

// ---- who refers to what ----------------------------------------------------------------------------------------
export function usersOf(resId, stepId) {
  const out = [];
  // a jump to the top of a process (no particular step) arrives at that process's first step
  const firstStep = stepId != null ? ((resById(resId) || {}).steps || []).find((x) => x && !x.isArchived) : null;
  const arrivesAtFirst = !!(firstStep && String(firstStep.id) === String(stepId));
  allRes().forEach((r) => (r.steps || []).forEach((s) => {
    if (s.isArchived) return;
    jumpsOf(s).forEach((j) => {
      if (isDangling(r.id, j) || String(j.resId) !== String(resId)) return;
      if (stepId != null && String(j.stepId || '') !== String(stepId) && !(arrivesAtFirst && !j.stepId)) return;
      out.push({ res: r, step: s, jump: j });
    });
  }));
  return out;
}

// the processes a step may point at: every process that has steps, grouped by workflow
export function targetsFor(resId) {
  // this process is a valid target too, because a jump can land on another step of the same process
  return allRes().filter((r) => (r.steps || []).length && !r.isArchived)
    .map((r) => ({ id: String(r.id), name: String(r.id) === String(resId) ? `${r.name || 'Untitled'} (this process)` : (r.name || 'Untitled'), workflow: workflowName(r) }))
    .sort((a, b) => (a.workflow || '').localeCompare(b.workflow || '') || a.name.localeCompare(b.name));
}

function redrawAfterRefEdit(resId, stepId) {
  OL().persist();
  const editorOpen = !!document.querySelector('.inspector-scroll-content');
  if (document.getElementById('fv-content') || document.getElementById('fv-canvas-wrap')) OL().renderVisualizer();
  // the redraw re-opens the step list a frame later; bring the step editor back after that
  if (editorOpen && typeof OL()._fvRefreshInspector === 'function') requestAnimationFrame(() => requestAnimationFrame(() => OL()._fvRefreshInspector(resId, stepId)));
}

export function addJump(resId, stepId) {
  const step = stepOf(resById(resId), stepId); if (!step) return;
  ensureJumps(step).push({ id: newId(), resId: '', stepId: '', label: '' });
  syncLegacy(step); redrawAfterRefEdit(resId, stepId);
}

// field: 'res' (the process), 'step' (the step of it to land on, '' = the top of the process) or 'label' (what triggers it)
export function setJump(resId, stepId, jumpId, field, value) {
  const step = stepOf(resById(resId), stepId); if (!step) return;
  const j = findJump(step, jumpId); if (!j) return;
  if (field === 'res') {
    const next = value ? String(value) : '';
    if (next !== String(j.resId || '')) j.stepId = '';        // the old target step belongs to the old process
    j.resId = next;
  } else if (field === 'step') {
    const ok = value && j.resId && stepOf(resById(j.resId), value) && !(String(j.resId) === String(resId) && String(value) === String(stepId));
    j.stepId = ok ? String(value) : '';
  } else if (field === 'label') {
    j.label = String(value || '').trim().slice(0, 120);
  }
  syncLegacy(step); redrawAfterRefEdit(resId, stepId);
}

export function removeJump(resId, stepId, jumpId) {
  const step = stepOf(resById(resId), stepId); if (!step) return;
  const j = findJump(step, jumpId); if (!j) return;
  step.jumps = step.jumps.filter((x) => x !== j);
  syncLegacy(step); redrawAfterRefEdit(resId, stepId);
}

// ---- what is drawn -----------------------------------------------------------------------------------------------
// A jump is drawn as a full-width ROW along the bottom of the step's card, not a pill under its name. The row keeps the
// fv-ref-chip class and data-ref-res, which is what the printout looks for to write the page number.
function oneRow(step, res, j) {
  const t = resById(j.resId);
  const tStep = t && j.stepId ? stepOf(t, j.stepId) : null;
  const name = t ? (tStep ? (tStep.name || 'a step') : t.name) : 'a process that was removed';
  const go = `event.stopPropagation(); OL.fvJumpToRef('${esc(res.id)}','${esc(step.id)}','${esc(j.id)}')`;
  const head = j.label ? `<span class="fv-jump-when">${esc(j.label)}</span>` : '';
  const to = `<span class="fv-jump-to">${j.label ? '' : 'See '}${esc(name)}</span>`;
  return `<div class="fv-jump-row fv-ref-chip${t ? '' : ' is-missing'}" role="button" tabindex="0" data-ref-res="${esc(j.resId)}" title="${t ? `Jump to ${esc(name)}` : 'The process this step pointed at was removed'}" onclick="${go}" onkeydown="if(event.key==='Enter'){${go}}"><span class="fv-ref-arrow" aria-hidden="true">&#8599;</span><span class="fv-ref-text"><span class="fv-ref-name">${head}${to}</span><span class="fv-ref-pg"></span></span></div>`;
}
// The rows for a step's jumps (without the wrapper; see jumpRows).
export function refChip(step, res) {
  if (!step || !res) return '';
  return jumpsOf(step).filter((j) => !isDangling(res.id, j)).map((j) => oneRow(step, res, j)).join('');
}

// On the TARGET step of a jump: where people come from. One source jumps straight back to it; several open a list.
export function incomingChip(step, res) {
  if (!step || !res) return '';
  const from = usersOf(res.id, step.id).filter((u) => !(String(u.res.id) === String(res.id) && String(u.step.id) === String(step.id)));
  if (!from.length) return '';
  const one = from.length === 1 ? from[0] : null;
  const text = one ? `Entered from &ldquo;${esc(one.step.name || 'a step')}&rdquo;${one.jump && one.jump.label ? `<span class="fv-jump-to">${esc(one.jump.label)}</span>` : ''}` : `Entered from ${from.length} places`;
  const act = one ? `OL.fvJumpToStep('${esc(one.res.id)}','${esc(one.step.id)}','${esc(res.id)}','${esc(step.id)}')` : `OL.fvShowRefUsers('${esc(res.id)}', event, '${esc(step.id)}')`;
  return `<div class="fv-jump-row fv-jump-in" role="button" tabindex="0" title="Where people come from to reach this step" onclick="event.stopPropagation(); ${act}" onkeydown="if(event.key==='Enter'){event.stopPropagation(); ${act}}"><span class="fv-ref-arrow" aria-hidden="true">&#8595;</span><span class="fv-ref-text"><span class="fv-ref-name">${text}</span></span></div>`;
}

// The ways OUT of a step, as rows along the bottom of its card (or list row).
export function jumpRowsOut(step, res) {
  const html = refChip(step, res);
  return html ? `<div class="fv-jump-rows" onclick="event.stopPropagation()" onmousedown="event.stopPropagation()">${html}</div>` : '';
}
// The way IN: where people come from, as a row across the top of the card of the step they land on.
export function jumpRowsIn(step, res) {
  const html = incomingChip(step, res);
  return html ? `<div class="fv-jump-rows fv-jump-rows-in" onclick="event.stopPropagation()" onmousedown="event.stopPropagation()">${html}</div>` : '';
}

// "Used in N places" on the process that others refer to
export function usedChip(res) {
  const n = usersOf(res.id).length;
  if (!n) return '';
  return `<span class="fv-used-wrap" data-used-res="${esc(res.id)}"><span class="fv-used-chip" role="button" tabindex="0" title="Where this process is used" onclick="event.stopPropagation(); OL.fvShowRefUsers('${esc(res.id)}', event)" onkeydown="if(event.key==='Enter'){event.stopPropagation(); OL.fvShowRefUsers('${esc(res.id)}', event)}">Used in ${n} place${n === 1 ? '' : 's'}</span><span class="fv-used-pg"></span></span>`;
}

// The picker for the step editors
export function refPicker(resId, step, onChange) {
  const opts = targetsFor(resId);
  const groups = {};
  opts.forEach((o) => { (groups[o.workflow || 'Other'] = groups[o.workflow || 'Other'] || []).push(o); });
  const body = Object.keys(groups).map((g) => `<optgroup label="${esc(g)}">${groups[g].map((o) => `<option value="${esc(o.id)}" ${String(step.refResId) === o.id ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</optgroup>`).join('');
  const missing = step.refResId && !opts.some((o) => o.id === String(step.refResId)) ? `<option value="${esc(step.refResId)}" selected>(process no longer available)</option>` : '';
  return `<select class="fvi-select fo-field" onchange="${onChange}"><option value="">None</option>${missing}${body}</select>`;
}

// The second picker: which step of the chosen process a jump lands on
export function refStepPicker(resId, step, j, onChange) {
  const t = j && j.resId ? resById(j.resId) : null;
  if (!t) return '';
  const opts = (t.steps || []).filter((x) => x && !x.isArchived && !(String(t.id) === String(resId) && String(x.id) === String(step.id)))
    .map((x, i) => `<option value="${esc(x.id)}" ${String(j.stepId) === String(x.id) ? 'selected' : ''}>${i + 1}. ${esc(x.name || 'Unnamed step')}</option>`).join('');
  return `<select class="fvi-select fo-field" onchange="${onChange}"><option value="">Top of the process</option>${opts}</select>`;
}

// The step editor's section: every jump on the step, each with its target, landing step and trigger, plus a button to add another
export function jumpEditor(resId, step) {
  const r = esc(resId), s = esc(step.id);
  const rows = jumpsOf(step).map((j, i) => {
    const h = (field) => `OL.fvSetJump('${r}','${s}','${esc(j.id)}','${field}', this.value)`;
    const landing = refStepPicker(resId, step, j, h('step'));
    return `<div style="border:1px solid var(--panel-border);border-radius:8px;padding:8px 10px;margin:0 0 8px;">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;"><span class="tiny muted" style="font-weight:600;flex:1;">Jump ${i + 1}</span>
        <button type="button" class="btn tiny soft" onclick="OL.fvRemoveJump('${r}','${s}','${esc(j.id)}')">Remove</button></div>
      ${refPicker(resId, { refResId: j.resId }, h('res'))}
      ${landing ? `<div class="tiny muted" style="margin:8px 0 3px;">Land on</div>${landing}` : ''}
      <div class="tiny muted" style="margin:8px 0 3px;">What triggers it (optional)</div>
      <input type="text" class="fvi-select fo-field" maxlength="120" value="${esc(j.label || '')}" placeholder="e.g. Clicks the link and books a call" onchange="${h('label')}">
    </div>`;
  }).join('');
  return `${rows}<button type="button" class="btn tiny primary" onclick="OL.fvAddJump('${r}','${s}')">${jumpsOf(step).length ? 'Add another jump' : 'Add a jump'}</button>`;
}

// ---- jumping ---------------------------------------------------------------------------------------------------
const stack = () => (OL()._fvJump = OL()._fvJump || []);
const inList = () => OL()._fv && OL()._fv.layout === 'list';

const headEl = (resId) => document.getElementById(inList() ? `fv-list-res-${resId}` : `fv-reshead-${resId}`);
const stepEl = (resId, stepId) => (inList()
  ? (document.getElementById(`fv-list-step-${stepId}`) || document.querySelector(`.fv-list-item[data-step-id="${stepId}"]`))
  : document.getElementById(`fv-step-${resId}-${stepId}`));

function flash(el) {
  if (!el) return;
  el.classList.remove('fv-ref-flash'); void el.offsetWidth; el.classList.add('fv-ref-flash');
  setTimeout(() => el.classList.remove('fv-ref-flash'), 2200);
}

function reveal(resId, stepId) {
  const fv = OL()._fv;
  const target = stepId ? stepEl(resId, stepId) : headEl(resId);
  if (target) { target.scrollIntoView({ behavior: 'smooth', block: stepId ? 'center' : 'start', inline: 'nearest' }); flash(target); if (!stepId) { const first = (resById(resId)?.steps || [])[0]; if (first) flash(stepEl(resId, first.id)); } return true; }
  return false;
}

// Jump from a step to where one of its jumps points (the first one when no jump is named)
export function jumpToRef(fromResId, fromStepId, jumpId) {
  const from = resById(fromResId); const step = stepOf(from, fromStepId);
  const valid = jumpsOf(step).filter((x) => !isDangling(fromResId, x));
  const j = (jumpId && valid.find((x) => x.id === jumpId)) || valid[0];
  if (!step || !j) return;
  const t = resById(j.resId);
  if (!t) { toast('That process was removed.'); return; }
  const landStep = j.stepId && stepOf(t, j.stepId) ? j.stepId : null;
  const go = () => {
    stack().push({ resId: String(fromResId), stepId: String(fromStepId), label: step.name || 'the step', layout: OL()._fv.layout });
    if (!reveal(t.id, landStep)) { stack().pop(); toast(`"${t.name}" is not showing. Clear the stage filter, or check that it has steps.`); return; }
    showBackPill();
  };
  // a stage filter can hide the process: clear it, redraw, then jump
  if (!(landStep ? stepEl(t.id, landStep) : headEl(t.id)) && OL()._fv.stageFilter) { OL()._fv.stageFilter = ''; OL().renderVisualizer(); setTimeout(go, 350); return; }
  go();
}

// Jump to a process, from the "Used in" list or anywhere else
export function jumpToStep(resId, stepId, fromResId, fromStepId) {
  if (fromResId) stack().push({ resId: String(fromResId), stepId: String(fromStepId || ''), label: (stepOf(resById(fromResId), fromStepId) || {}).name || (resById(fromResId) || {}).name || 'where you were', layout: OL()._fv.layout });
  if (!reveal(resId, stepId)) { if (fromResId) stack().pop(); toast('That step is not showing right now.'); return; }
  if (fromResId) showBackPill();
}

export function back() {
  const e = stack().pop();
  if (!e) { hideBackPill(); return; }
  if (e.layout && e.layout !== OL()._fv.layout) { OL()._fv.layout = e.layout; sessionStorage.setItem('fv_layout', e.layout); OL().renderVisualizer(); setTimeout(() => { reveal(e.resId, e.stepId || null); showBackPill(); }, 350); return; }
  if (!reveal(e.resId, e.stepId || null)) toast('That place is not showing right now.');
  showBackPill();
}

export function clearBack() { OL()._fvJump = []; hideBackPill(); }

function hideBackPill() { const p = document.getElementById('fv-back-pill'); if (p) p.remove(); }
export function showBackPill() {
  hideBackPill();
  const s = stack(); if (!s.length) return;
  const host = document.getElementById('fv-shell') || document.getElementById('mainContent'); if (!host) return;
  const top = s[s.length - 1];
  const p = document.createElement('div');
  p.id = 'fv-back-pill'; p.className = 'fv-back-pill'; p.setAttribute('role', 'group');
  p.innerHTML = `<button type="button" class="fv-back-btn" onclick="OL.fvBack()" title="Go back to where you were">&#8592; Back to &ldquo;${esc(String(top.label))}&rdquo;${s.length > 1 ? ` <span class="fv-back-count">${s.length}</span>` : ''}</button><button type="button" class="fv-back-x" aria-label="Dismiss" title="Dismiss" onclick="OL.fvClearBack()">&#10005;</button>`;
  host.appendChild(p);
}

// The "Used in N places" list
export function showRefUsers(resId, ev, stepId) {
  document.getElementById('fv-used-pop')?.remove();
  const users = usersOf(resId, stepId).filter((u) => !(stepId && String(u.res.id) === String(resId) && String(u.step.id) === String(stepId))); if (!users.length) return;
  const pop = document.createElement('div');
  pop.id = 'fv-used-pop'; pop.className = 'fv-used-pop';
  pop.innerHTML = `<div class="fv-used-title">${stepId ? 'Entered from' : 'Used in'} ${users.length} place${users.length === 1 ? '' : 's'}</div>${users.map((u) => `<button type="button" class="fv-used-item" onclick="OL.fvCloseUsedPop(); OL.fvJumpToStep('${esc(u.res.id)}','${esc(u.step.id)}','${esc(resId)}'${stepId ? `,'${esc(stepId)}'` : ''})"><b>${esc(u.step.name || 'Step')}</b><span>${u.jump && u.jump.label ? esc(u.jump.label) + ' &middot; ' : ''}${esc(u.res.name)}${workflowName(u.res) ? ' &middot; ' + esc(workflowName(u.res)) : ''}</span></button>`).join('')}`;
  document.body.appendChild(pop);
  const r = (ev && ev.target && ev.target.getBoundingClientRect) ? ev.target.getBoundingClientRect() : { left: 80, bottom: 80 };
  pop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 300))}px`;
  pop.style.top = `${Math.min(r.bottom + 6, window.innerHeight - 40 - Math.min(users.length, 6) * 48)}px`;
  setTimeout(() => document.addEventListener('click', function close(e) { if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener('click', close); } }), 0);
}
export const closeUsedPop = () => document.getElementById('fv-used-pop')?.remove();

function toast(t) { if (typeof OL().showToast === 'function') OL().showToast(t); else console.info(t); }

window.OL = window.OL || {};
Object.assign(window.OL, {
  fvRefChip: refChip, fvUsedChip: usedChip, fvRefPicker: refPicker, fvRefUsers: usersOf, fvRefTargets: targetsFor,
  fvAddJump: addJump, fvSetJump: setJump, fvRemoveJump: removeJump, fvJumpEditor: jumpEditor, fvJumpsOf: jumpsOf, fvRefStepPicker: refStepPicker, fvIncomingChip: incomingChip, fvJumpRowsOut: jumpRowsOut, fvJumpRowsIn: jumpRowsIn, fvJumpToRef: jumpToRef, fvJumpToStep: jumpToStep, fvBack: back, fvClearBack: clearBack,
  fvShowBackPill: showBackPill, fvShowRefUsers: showRefUsers, fvCloseUsedPop: closeUsedPop,
});
