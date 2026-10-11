// ================================================================================================
// FILE: features/flow-visualizer/duplicate.js
//
// WHAT IT DOES:   Duplicate a step, and copy steps from one resource to another.
//                 - OL.duplicateStep(resId, stepId)            a copy right under the original, in the same resource
//                 - OL.openCopyStepsDialog(resId, stepId?)     pick steps (or all) and a target resource
//                 - OL.copySteps(fromResId, stepIds, toResId)  the copy itself
//                 - OL.fvRewriteResourceRefs(clone, oldId)     points a duplicated resource's own links at itself
//
// LINKS:          A link target is "<resourceId>-<stepId>". When steps are copied, links BETWEEN the copied steps are
//                 kept (and point at the copies). Links that leave the copied set are cleared, because the copy
//                 would otherwise jump into the original's flow. A cleared outcome keeps its row, with no target,
//                 so the rule text is not lost. "In" links are rebuilt by syncLogicPorts from the "out" links.
// ================================================================================================

import { esc, uid, state, getActiveClient } from '../../core/data.js';

const OL = () => window.OL;
const pool = () => {
  const pd = OL().getCurrentProjectData();
  return (pd && (pd.resources || pd.localResources)) || [];
};
const resById = (id) => pool().find((r) => String(r.id) === String(id));
const newStepId = () => `step_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
const clone = (o) => JSON.parse(JSON.stringify(o));

// copy a list of steps (in their current order) into targetRes; returns the new steps
function cloneSteps(srcRes, steps, targetRes) {
  const idMap = new Map();
  steps.forEach((s) => idMap.set(String(s.id), newStepId()));
  const srcPrefix = `${srcRes.id}-`;
  const copies = steps.map((s) => {
    const c = clone(s);
    c.id = idMap.get(String(s.id));
    delete c.coords; delete c.pinned; delete c.updatedAt; delete c.updatedBy; delete c.masterRefId;
    if (Array.isArray(c.callouts)) c.callouts = c.callouts.map((x) => ({ ...x, id: `sco-${uid()}` }));
    const remap = (row) => {
      if (!row) return row;
      const t = row.targetId == null ? '' : String(row.targetId);
      if (t.startsWith(srcPrefix)) {
        const oldStep = t.slice(srcPrefix.length);
        if (idMap.has(oldStep)) return { ...row, targetId: `${targetRes.id}-${idMap.get(oldStep)}` };
      }
      return { ...row, targetId: null };   // leaves the copied set: clear it, keep the rule text
    };
    if (c.logic) {
      c.logic = { ...c.logic, out: (c.logic.out || []).map(remap), in: [] };
    }
    return c;
  });
  return copies;
}

function afterChange(resId) {
  const O = OL();
  try { if (typeof O.syncLogicPorts === 'function') O.syncLogicPorts(); } catch (e) { console.warn('syncLogicPorts failed', e); }
  O.persist();
  const hash = window.location.hash || '';
  if (hash.includes('visualizer')) {
    O.renderVisualizer();
    const panel = document.getElementById('v2-inspector-panel');
    if (panel && panel.classList.contains('open') && typeof O._fvOpenStepsList === 'function') {
      try { O._fvOpenStepsList(String(resId)); } catch (e) { /* inspector refresh is best effort */ }
    }
  } else if (document.getElementById('active-modal-box') && typeof O.openResourceModal === 'function') {
    O.openResourceModal(resId);
  }
}

export function duplicateStep(resId, stepId) {
  const res = resById(resId); if (!res) return;
  const i = (res.steps || []).findIndex((s) => String(s.id) === String(stepId)); if (i < 0) return;
  const [copy] = cloneSteps(res, [res.steps[i]], res);
  copy.name = `${res.steps[i].name || 'Untitled Step'} (Copy)`;
  res.steps.splice(i + 1, 0, copy);
  afterChange(resId);
  return copy;
}

export function copySteps(fromResId, stepIds, toResId) {
  const from = resById(fromResId), to = resById(toResId); if (!from || !to) return [];
  const want = new Set((stepIds || []).map(String));
  const picked = (from.steps || []).filter((s) => want.has(String(s.id)));   // keeps the original order
  if (!picked.length) return [];
  const copies = cloneSteps(from, picked, to);
  if (!to.steps) to.steps = [];
  to.steps.push(...copies);
  to.isExpanded = true;
  afterChange(toResId);
  return copies;
}

// ---- dialog ----------------------------------------------------------------------------------------------------
export function openCopyStepsDialog(resId, stepId) {
  const res = resById(resId); if (!res) return;
  const steps = res.steps || [];
  if (!steps.length) { alert('This resource has no steps to copy.'); return; }
  const others = pool().filter((r) => String(r.id) !== String(resId) && !r.isDeleted && !r.isArchived)
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  const lbl = 'class="tiny muted" style="display:block;font-weight:600;margin:0 0 4px;"';
  const rows = steps.map((s, i) => `<label style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-bottom:1px solid var(--panel-border);cursor:pointer;">
      <input type="checkbox" class="cps-step" value="${esc(s.id)}" ${stepId && String(s.id) === String(stepId) ? 'checked' : ''}>
      <span class="tiny muted" style="width:22px;">${i + 1}</span><span style="flex:1;min-width:0;">${esc(s.name || 'Untitled Step')}</span></label>`).join('');
  window.openModal(`
    <div class="modal-head"><div class="modal-title-text">Copy steps to another resource</div><button class="btn small soft" style="margin-left:auto;" onclick="OL.closeModal()">Close</button></div>
    <div class="modal-body" style="width:100%;box-sizing:border-box;">
      <p class="tiny muted" style="margin-top:0;">Copies steps from <strong>${esc(res.name || 'this resource')}</strong>. Links between the copied steps are kept; links to steps you did not copy are cleared so the copy does not jump back into the original.</p>
      <div style="display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);gap:28px;align-items:start;">
        <div>
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;"><label ${lbl}>Steps to copy</label>
            <a href="#" class="tiny" style="margin-left:auto;" onclick="document.querySelectorAll('.cps-step').forEach(c=>c.checked=true);return false;">All</a>
            <a href="#" class="tiny" onclick="document.querySelectorAll('.cps-step').forEach(c=>c.checked=false);return false;">None</a></div>
          <div style="max-height:min(480px,52vh);overflow-y:auto;border:1px solid var(--panel-border);border-radius:8px;">${rows}</div>
        </div>
        <div>
          <label ${lbl}>Copy into</label>
          <select id="cps-target" class="modal-input"><option value="">Choose a resource...</option>
            ${others.map((r) => `<option value="${esc(r.id)}">${esc(r.name || 'Untitled')}</option>`).join('')}</select>
          <div id="cps-err" class="tiny" style="color:#dc2626;min-height:16px;margin-top:10px;"></div>
          <button class="btn primary" style="margin-top:6px;" onclick="OL.fvRunCopySteps('${esc(resId)}')">Copy</button>
        </div>
      </div>
    </div>`);
}

function runCopy(resId) {
  const ids = [...document.querySelectorAll('.cps-step:checked')].map((c) => c.value);
  const target = (document.getElementById('cps-target') || {}).value;
  const err = document.getElementById('cps-err');
  if (!ids.length) { if (err) err.textContent = 'Tick at least one step.'; return; }
  if (!target) { if (err) err.textContent = 'Choose the resource to copy into.'; return; }
  const made = copySteps(resId, ids, target);
  OL().closeModal();
  console.log(`📋 Copied ${made.length} step(s) from ${resId} to ${target}`);
}

// A duplicated resource still carries links like "<originalId>-<stepId>". Point the ones that stay inside the resource
// at the copy (its step ids are unchanged), so the copy has its own flow. Links to OTHER resources are left alone.
export function rewriteResourceRefs(copy, oldId) {
  const from = `${oldId}-`;
  const fix = (row) => {
    const t = row && row.targetId != null ? String(row.targetId) : '';
    return t.startsWith(from) ? { ...row, targetId: `${copy.id}-${t.slice(from.length)}` } : row;
  };
  (copy.steps || []).forEach((s) => {
    if (s.logic) {
      s.logic.out = (s.logic.out || []).map(fix);
      s.logic.in = (s.logic.in || []).map((row) => {
        const t = row && row.targetId != null ? String(row.targetId) : '';
        return t.startsWith(from) ? { ...row, targetId: `${copy.id}-${t.slice(from.length)}` } : row;
      });
    }
  });
  return copy;
}

// put a duplicated resource in the same workflow(s) as the original, right after it
export function placeLikeOriginal(copy, originalId) {
  const pd = OL().getCurrentProjectData();
  (pd.workflows || []).forEach((w) => {
    const ids = (w.resourceIds || []).map(String);
    const at = ids.indexOf(String(originalId));
    if (at >= 0 && !ids.includes(String(copy.id))) { ids.splice(at + 1, 0, String(copy.id)); w.resourceIds = ids; }
  });
}

window.OL = window.OL || {};
Object.assign(window.OL, {
  duplicateStep, copySteps, openCopyStepsDialog, fvRunCopySteps: runCopy,
  fvRewriteResourceRefs: rewriteResourceRefs, fvPlaceLikeOriginal: placeLikeOriginal,
});
