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
// STORED AS:      step.refResId (a process id). Nothing else changes: lines, owners and the rest of the step are untouched.
// ================================================================================================

import { esc } from '../../core/data.js';

const OL = () => window.OL;
const project = () => (OL().getCurrentProjectData ? OL().getCurrentProjectData() : { resources: [] }) || { resources: [] };
const allRes = () => (project().resources || project().localResources || []).filter((r) => r && !r.isDeleted);
const resById = (id) => allRes().find((r) => String(r.id) === String(id));
const stepOf = (res, id) => ((res && res.steps) || []).find((s) => String(s.id) === String(id));
const workflowName = (res) => { const w = (project().workflows || []).find((x) => (x.resourceIds || []).map(String).includes(String(res.id))); return w ? w.name : ''; };

// ---- who refers to what ----------------------------------------------------------------------------------------
export function usersOf(resId) {
  const out = [];
  allRes().forEach((r) => (r.steps || []).forEach((s) => { if (s.refResId && String(s.refResId) === String(resId) && !s.isArchived) out.push({ res: r, step: s }); }));
  return out;
}

// the processes a step may point at: every other process that has steps, grouped by workflow
export function targetsFor(resId) {
  return allRes().filter((r) => String(r.id) !== String(resId) && (r.steps || []).length && !r.isArchived)
    .map((r) => ({ id: String(r.id), name: r.name || 'Untitled', workflow: workflowName(r) }))
    .sort((a, b) => (a.workflow || '').localeCompare(b.workflow || '') || a.name.localeCompare(b.name));
}

export function setStepRef(resId, stepId, targetId) {
  const res = resById(resId); const step = stepOf(res, stepId); if (!step) return;
  if (targetId && String(targetId) !== String(resId)) step.refResId = String(targetId); else delete step.refResId;
  OL().persist();
  const editorOpen = !!document.querySelector('.inspector-scroll-content');
  if (document.getElementById('fv-content') || document.getElementById('fv-canvas-wrap')) OL().renderVisualizer();
  // the redraw re-opens the step list a frame later; bring the step editor back after that
  if (editorOpen && typeof OL()._fvRefreshInspector === 'function') requestAnimationFrame(() => requestAnimationFrame(() => OL()._fvRefreshInspector(resId, stepId)));
}

// ---- what is drawn -----------------------------------------------------------------------------------------------
// The chip on a step. onclick jumps; .fv-ref-pg is where the printout writes the page number.
export function refChip(step, res) {
  if (!step || !step.refResId) return '';
  const t = resById(step.refResId);
  const name = t ? t.name : 'a process that was removed';
  const go = `event.stopPropagation(); OL.fvJumpToRef('${esc(res.id)}','${esc(step.id)}')`;
  return `<span class="fv-ref-chip${t ? '' : ' is-missing'}" role="button" tabindex="0" data-ref-res="${esc(step.refResId)}" title="${t ? `Jump to ${esc(name)}` : 'The process this step pointed at was removed'}" onclick="${go}" onkeydown="if(event.key==='Enter'){${go}}"><span class="fv-ref-arrow" aria-hidden="true">&#8599;</span><span class="fv-ref-text"><span class="fv-ref-name">See ${esc(name)}</span><span class="fv-ref-pg"></span></span></span>`;
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

// Jump from a step to the process it refers to
export function jumpToRef(fromResId, fromStepId) {
  const from = resById(fromResId); const step = stepOf(from, fromStepId);
  if (!step || !step.refResId) return;
  const t = resById(step.refResId);
  if (!t) { toast('That process was removed.'); return; }
  const go = () => {
    stack().push({ resId: String(fromResId), stepId: String(fromStepId), label: step.name || 'the step', layout: OL()._fv.layout });
    if (!reveal(t.id)) { stack().pop(); toast(`"${t.name}" is not showing. Clear the stage filter, or check that it has steps.`); return; }
    showBackPill();
  };
  // a stage filter can hide the process: clear it, redraw, then jump
  if (!headEl(t.id) && OL()._fv.stageFilter) { OL()._fv.stageFilter = ''; OL().renderVisualizer(); setTimeout(go, 350); return; }
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
export function showRefUsers(resId, ev) {
  document.getElementById('fv-used-pop')?.remove();
  const users = usersOf(resId); if (!users.length) return;
  const pop = document.createElement('div');
  pop.id = 'fv-used-pop'; pop.className = 'fv-used-pop';
  pop.innerHTML = `<div class="fv-used-title">Used in ${users.length} place${users.length === 1 ? '' : 's'}</div>${users.map((u) => `<button type="button" class="fv-used-item" onclick="OL.fvCloseUsedPop(); OL.fvJumpToStep('${esc(u.res.id)}','${esc(u.step.id)}','${esc(resId)}')"><b>${esc(u.step.name || 'Step')}</b><span>${esc(u.res.name)}${workflowName(u.res) ? ' &middot; ' + esc(workflowName(u.res)) : ''}</span></button>`).join('')}`;
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
  fvSetStepRef: setStepRef, fvJumpToRef: jumpToRef, fvJumpToStep: jumpToStep, fvBack: back, fvClearBack: clearBack,
  fvShowBackPill: showBackPill, fvShowRefUsers: showRefUsers, fvCloseUsedPop: closeUsedPop,
});
