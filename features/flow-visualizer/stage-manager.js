// ================================================================================================
// FILE: features/flow-visualizer/stage-manager.js
//
// WHAT IT DOES:   One place to manage the flow map's stages and the workflows (sub-stages) under them.
//                 OL.openStageManager() opens a full-width dialog where you can
//                   - rename a stage or workflow (type in its box; saves when you leave it or press Enter)
//                   - add a stage, or a workflow under a stage
//                   - re-arrange: drag a stage to reorder stages; drag a workflow to reorder it, or onto another
//                     stage to move it there (the up / down arrows do the same without dragging)
//                   - delete with the trash icon (asks first)
//
// DATA:           data.stages = [{ id, name }] (array order = order on the map)
//                 data.workflows = [{ id, name, stageId, resourceIds }] (array order = order inside its stage)
// ================================================================================================

import { esc } from '../../core/data.js';

const OL = () => window.OL;
const pd = () => OL().getCurrentProjectData();
const ICON = (n, s = 14) => `<i data-lucide="${n}" style="width:${s}px;height:${s}px;pointer-events:none;"></i>`;
const BTN = 'display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:6px;border:1px solid var(--panel-border);background:var(--panel-soft);color:var(--text-dim);cursor:pointer;padding:0;flex-shrink:0;';
const INPUT = 'flex:1;min-width:0;background:transparent;border:1px solid transparent;border-radius:6px;padding:5px 8px;color:var(--text-main);font:inherit;';

let drag = null;   // { kind: 'stage' | 'wf', id }

function save(opts = {}) {
  OL().persist();
  if ((window.location.hash || '').includes('visualizer') && typeof OL().renderVisualizer === 'function') OL().renderVisualizer();
  if (!opts.keepOpen) render();
}

function stageIds() { return new Set((pd().stages || []).map((s) => String(s.id))); }
function wfCount(w) { return (w.resourceIds || []).length; }

function wfRow(w, i, n, stageId) {
  return `<div class="ssm-wf" draggable="true" data-wf="${esc(w.id)}"
      style="display:flex;align-items:center;gap:8px;padding:6px 8px;margin-left:34px;border:1px solid var(--panel-border);border-radius:8px;background:var(--panel);"
      ondragstart="OL.ssmDragStart(event,'wf','${esc(w.id)}')" ondragend="OL.ssmDragEnd()"
      ondragover="OL.ssmDragOver(event,'wf')" ondragleave="OL.ssmDragLeave(event)" ondrop="OL.ssmDrop(event,'wf','${esc(w.id)}')">
      <span style="cursor:grab;color:var(--text-muted);">${ICON('grip-vertical')}</span>
      <input style="${INPUT}" value="${esc(w.name || '')}" placeholder="Workflow name" onchange="OL.ssmRenameWf('${esc(w.id)}', this.value)" onkeydown="if(event.key==='Enter')this.blur()">
      <span class="tiny muted" style="white-space:nowrap;">${wfCount(w)} resource${wfCount(w) === 1 ? '' : 's'}</span>
      <button type="button" style="${BTN}" title="Move up" ${i === 0 ? 'disabled' : ''} onclick="OL.ssmMoveWf('${esc(w.id)}',-1)">${ICON('chevron-up')}</button>
      <button type="button" style="${BTN}" title="Move down" ${i === n - 1 ? 'disabled' : ''} onclick="OL.ssmMoveWf('${esc(w.id)}',1)">${ICON('chevron-down')}</button>
      <button type="button" style="${BTN}color:#ef4444;" title="Delete workflow" onclick="OL.ssmDeleteWf('${esc(w.id)}')">${ICON('trash-2')}</button>
    </div>`;
}

function addWfRow(stageId) {
  const sid = esc(stageId);
  return `<div style="display:flex;align-items:center;gap:8px;margin-left:34px;">
      <input id="ssm-newwf-${sid}" style="${INPUT}border-color:var(--panel-border);" placeholder="Add a workflow to this stage, then press Enter" onkeydown="if(event.key==='Enter')OL.ssmAddWf('${sid}')">
      <button type="button" style="${BTN}" title="Add workflow" onclick="OL.ssmAddWf('${sid}')">${ICON('plus')}</button></div>`;
}

function stageBlock(s, si, n, wfs) {
  const sid = esc(s.id);
  return `<div class="ssm-stage" data-stage="${sid}" style="border:1px solid var(--panel-border);border-radius:12px;padding:10px;background:var(--panel-soft);display:flex;flex-direction:column;gap:6px;"
      ondragover="OL.ssmDragOver(event,'stage')" ondragleave="OL.ssmDragLeave(event)" ondrop="OL.ssmDrop(event,'stage','${sid}')">
      <div class="ssm-stage-head" draggable="true" style="display:flex;align-items:center;gap:8px;"
           ondragstart="OL.ssmDragStart(event,'stage','${sid}')" ondragend="OL.ssmDragEnd()">
        <span style="cursor:grab;color:var(--text-muted);">${ICON('grip-vertical')}</span>
        <span style="width:22px;height:22px;border-radius:6px;background:#3dd9c5;color:#06201c;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;">${si + 1}</span>
        <input style="${INPUT}font-weight:700;" value="${esc(s.name || '')}" placeholder="Stage name" onchange="OL.ssmRenameStage('${sid}', this.value)" onkeydown="if(event.key==='Enter')this.blur()">
        <span class="tiny muted" style="white-space:nowrap;">${wfs.length} workflow${wfs.length === 1 ? '' : 's'}</span>
        <button type="button" style="${BTN}" title="Move up" ${si === 0 ? 'disabled' : ''} onclick="OL.ssmMoveStage('${sid}',-1)">${ICON('chevron-up')}</button>
        <button type="button" style="${BTN}" title="Move down" ${si === n - 1 ? 'disabled' : ''} onclick="OL.ssmMoveStage('${sid}',1)">${ICON('chevron-down')}</button>
        <button type="button" style="${BTN}color:#ef4444;" title="Delete stage" onclick="OL.ssmDeleteStage('${sid}')">${ICON('trash-2')}</button>
      </div>
      ${wfs.map((w, i) => wfRow(w, i, wfs.length, s.id)).join('')}
      ${addWfRow(s.id)}
    </div>`;
}

function body() {
  const data = pd();
  const stages = data.stages || [];
  const wfs = data.workflows || [];
  const ids = stageIds();
  const orphans = wfs.filter((w) => !ids.has(String(w.stageId)));
  return `
    <p class="tiny muted" style="margin-top:0;">Drag the handle to re-arrange. Drop a workflow on another stage to move it there. The map follows this order.</p>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(420px,1fr));gap:14px;align-items:start;">
      ${stages.map((s, si) => stageBlock(s, si, stages.length, wfs.filter((w) => String(w.stageId) === String(s.id)))).join('')}
      ${orphans.length ? `<div class="ssm-stage" data-stage="" style="border:1px dashed var(--panel-border);border-radius:12px;padding:10px;display:flex;flex-direction:column;gap:6px;"
          ondragover="OL.ssmDragOver(event,'stage')" ondragleave="OL.ssmDragLeave(event)" ondrop="OL.ssmDrop(event,'stage','')">
          <div class="tiny muted" style="font-weight:700;">WORKFLOWS WITHOUT A STAGE: drag one onto a stage</div>
          ${orphans.map((w, i) => wfRow(w, i, orphans.length, '')).join('')}</div>` : ''}
    </div>
    <div style="display:flex;align-items:center;gap:8px;margin-top:14px;">
      <input id="ssm-newstage" style="${INPUT}border-color:var(--panel-border);max-width:420px;" placeholder="Add a stage at the end, then press Enter" onkeydown="if(event.key==='Enter')OL.ssmAddStage()">
      <button type="button" class="btn small primary" onclick="OL.ssmAddStage()">${ICON('plus', 12)} Add stage</button>
    </div>`;
}

function render() {
  const host = document.getElementById('ssm-body');
  if (host) { host.innerHTML = body(); if (window.lucide) window.lucide.createIcons(); }
}

export function openStageManager() {
  window.openModal(`
    <div class="modal-head"><div class="modal-title-text">Stages and workflows</div><button class="btn small soft" style="margin-left:auto;" onclick="OL.closeModal()">Close</button></div>
    <div class="modal-body" style="width:100%;box-sizing:border-box;"><div id="ssm-body"></div></div>`);
  render();
}

// ---- edits -----------------------------------------------------------------------------------------------------
function renameStage(id, name) {
  const s = (pd().stages || []).find((x) => String(x.id) === String(id)); const v = String(name || '').trim();
  if (!s || !v) { render(); return; }
  s.name = v; save({ keepOpen: true });
}
function renameWf(id, name) {
  const w = (pd().workflows || []).find((x) => String(x.id) === String(id)); const v = String(name || '').trim();
  if (!w || !v) { render(); return; }
  w.name = v; save({ keepOpen: true });
}
function addStage() {
  const el = document.getElementById('ssm-newstage'); const name = el && el.value.trim(); if (!name) return;
  const d = pd(); if (!d.stages) d.stages = [];
  d.stages.push({ id: `stage-${Date.now()}`, name, width: 400 });
  save();
}
function addWf(stageId) {
  const el = document.getElementById(`ssm-newwf-${stageId}`); const name = el && el.value.trim(); if (!name) return;
  const d = pd(); if (!d.workflows) d.workflows = [];
  d.workflows.push({ id: `wf-${Date.now()}`, name, stageId, color: '#3dd9c5', resourceIds: [], description: '' });
  save();
}
function moveStage(id, delta) {
  const st = pd().stages || []; const i = st.findIndex((s) => String(s.id) === String(id)); const j = i + delta;
  if (i < 0 || j < 0 || j >= st.length) return;
  const [m] = st.splice(i, 1); st.splice(j, 0, m); save();
}

// move workflow `id` into stage `stageId`, before workflow `beforeId` (or last in that stage)
function placeWf(id, stageId, beforeId) {
  const d = pd(); const all = d.workflows || [];
  const w = all.find((x) => String(x.id) === String(id)); if (!w) return;
  if (beforeId && String(beforeId) === String(id)) return;
  all.splice(all.indexOf(w), 1);
  const changedStage = String(w.stageId || '') !== String(stageId || '');
  w.stageId = stageId || '';
  let at = beforeId ? all.findIndex((x) => String(x.id) === String(beforeId)) : -1;
  if (at < 0) {
    // after the last workflow of that stage, else at the end
    let last = -1; all.forEach((x, k) => { if (String(x.stageId) === String(stageId)) last = k; });
    at = last >= 0 ? last + 1 : all.length;
  }
  all.splice(at, 0, w);
  if (changedStage && stageId) {   // ordinary resources in it follow it to the new stage
    (w.resourceIds || []).forEach((rid) => {
      const r = (d.resources || []).find((x) => String(x.id) === String(rid));
      if (r && !r.isGlobal) { r.stageId = stageId; r.workflowId = w.id; }
    });
  }
  save();
}
function moveWf(id, delta) {
  const d = pd(); const w = (d.workflows || []).find((x) => String(x.id) === String(id)); if (!w) return;
  const sibs = d.workflows.filter((x) => String(x.stageId) === String(w.stageId));
  const i = sibs.indexOf(w); const j = i + delta; if (j < 0 || j >= sibs.length) return;
  if (delta < 0) placeWf(id, w.stageId, sibs[j].id);
  else { const after = sibs[j + 1]; placeWf(id, w.stageId, after ? after.id : null); }
}
function delStage(id) { OL()._fvDeleteStage(id); setTimeout(render, 0); }
function delWf(id) { OL().deleteWorkflow(id); setTimeout(render, 0); }

// ---- drag and drop ---------------------------------------------------------------------------------------------
function dragStart(e, kind, id) { drag = { kind, id }; try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id); } catch (x) { /* ok */ } e.stopPropagation(); }
function dragEnd() { drag = null; document.querySelectorAll('.ssm-over').forEach((el) => { el.classList.remove('ssm-over'); el.style.outline = ''; }); }
function dragOver(e, kind) {
  if (!drag) return;
  if (drag.kind === 'stage' && kind !== 'stage') return;   // a stage only drops on stages
  e.preventDefault(); e.stopPropagation();
  const el = e.currentTarget; el.classList.add('ssm-over'); el.style.outline = '2px solid #3dd9c5';
}
function dragLeave(e) { const el = e.currentTarget; el.classList.remove('ssm-over'); el.style.outline = ''; }
function drop(e, kind, id) {
  if (!drag) return;
  e.preventDefault(); e.stopPropagation();
  const d = drag; dragEnd();
  if (d.kind === 'stage' && kind === 'stage') {
    const st = pd().stages || []; const from = st.findIndex((s) => String(s.id) === String(d.id)); const to = st.findIndex((s) => String(s.id) === String(id));
    if (from < 0 || to < 0 || from === to) return;
    const [m] = st.splice(from, 1); st.splice(to, 0, m); save(); return;
  }
  if (d.kind === 'wf') {
    if (kind === 'wf') {
      const target = (pd().workflows || []).find((w) => String(w.id) === String(id));
      if (target) placeWf(d.id, target.stageId, target.id);
    } else {
      placeWf(d.id, id, null);   // dropped on a stage: becomes its last workflow
    }
  }
}

window.OL = window.OL || {};
Object.assign(window.OL, {
  openStageManager, ssmRenameStage: renameStage, ssmRenameWf: renameWf, ssmAddStage: addStage, ssmAddWf: addWf,
  ssmMoveStage: moveStage, ssmMoveWf: moveWf, ssmDeleteStage: delStage, ssmDeleteWf: delWf,
  ssmDragStart: dragStart, ssmDragEnd: dragEnd, ssmDragOver: dragOver, ssmDragLeave: dragLeave, ssmDrop: drop,
});
