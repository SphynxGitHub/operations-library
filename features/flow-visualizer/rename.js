// ================================================================================================
// FILE: features/flow-visualizer/rename.js
//
// WHAT IT DOES:   Rename a stage, a workflow ("process" on the map) or a process card straight from the flow map:
//                 double-click its name, type, press Enter (Esc cancels). Nothing else has to be opened.
//
//   Works on     the Steps view headings (stage label, workflow label, process heading) and the List view headings.
//                 Any element that carries  data-fv-rename="stage|workflow|resource"  and  data-id="<id>"  can be renamed.
//   Saves via    stage     -> stage.name              (this file)
//                workflow  -> OL.renameWorkflow       (features/flow-visualizer/workflows.js)
//                process   -> OL.handleResourceSave   (features/resources-modal.js, so the edit history is kept)
//
// USED BY:        features/flow-visualizer/core.js adds the data attributes where the headings are drawn.
// ================================================================================================

import { markClientDirty, getActiveClient } from '../../core/data.js';

const OL = () => window.OL;
const project = () => (OL().getCurrentProjectData ? OL().getCurrentProjectData() : {}) || {};
let editing = null;

function readName(kind, id) {
  const d = project();
  if (kind === 'stage') return ((d.stages || []).find((s) => String(s.id) === String(id)) || {}).name || '';
  if (kind === 'workflow') return ((d.workflows || []).find((w) => String(w.id) === String(id)) || {}).name || '';
  const r = (d.resources || d.localResources || []).find((x) => String(x.id) === String(id));
  return (r && r.name) || '';
}

function writeName(kind, id, name) {
  const d = project();
  const client = getActiveClient && getActiveClient();
  if (kind === 'stage') {
    const s = (d.stages || []).find((x) => String(x.id) === String(id)); if (!s) return;
    s.name = name; if (client) markClientDirty(client.id); OL().persist();
  } else if (kind === 'workflow') {
    OL().renameWorkflow(id, name); if (client) markClientDirty(client.id);
  } else {
    const inResources = (d.resources || []).some((x) => String(x.id) === String(id));
    if (inResources && typeof OL().handleResourceSave === 'function') OL().handleResourceSave(id, 'name', name);
    else {
      const r = (d.localResources || []).find((x) => String(x.id) === String(id)); if (!r) return;
      r.name = name; if (client) markClientDirty(client.id); OL().persist();
    }
  }
}

export function startRename(el) {
  if (!el || editing) return;
  const kind = el.dataset.fvRename; const id = el.dataset.id; if (!kind || !id) return;
  const original = readName(kind, id) || el.textContent.trim();
  const keep = { overflow: el.style.overflow, textOverflow: el.style.textOverflow, maxWidth: el.style.maxWidth, opacity: el.style.opacity, whiteSpace: el.style.whiteSpace };
  editing = el;
  el.textContent = original;
  el.contentEditable = 'true';
  el.classList.add('fv-renaming');
  Object.assign(el.style, { overflow: 'visible', textOverflow: 'clip', maxWidth: 'none', opacity: '1', whiteSpace: 'nowrap' });
  el.focus();
  const range = document.createRange(); range.selectNodeContents(el);
  const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);

  let done = false;
  const finish = (save) => {
    if (done) return; done = true;
    el.removeEventListener('keydown', onKey); el.removeEventListener('blur', onBlur);
    el.removeEventListener('mousedown', stop); el.removeEventListener('pointerdown', stop); el.removeEventListener('click', stop);
    const next = el.innerText.replace(/\s+/g, ' ').trim();
    el.contentEditable = 'false'; el.classList.remove('fv-renaming');
    Object.assign(el.style, keep);
    editing = null;
    if (save && next && next !== original) { el.textContent = next; el.title = next; writeName(kind, id, next); }
    else el.textContent = original;
  };
  const onKey = (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); finish(true); el.blur(); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); el.blur(); }
  };
  const onBlur = () => finish(true);
  const stop = (e) => e.stopPropagation();       // keeps the map from starting a pan or a drag while you type
  el.addEventListener('keydown', onKey); el.addEventListener('blur', onBlur);
  el.addEventListener('mousedown', stop); el.addEventListener('pointerdown', stop); el.addEventListener('click', stop);
}

document.addEventListener('dblclick', (e) => {
  const el = e.target.closest && e.target.closest('[data-fv-rename]');
  if (!el) return;
  e.preventDefault(); e.stopPropagation();
  startRename(el);
});

window.OL = window.OL || {};
Object.assign(window.OL, { fvStartRename: startRename });
