// ================================================================================================
// FILE: features/form-builder.js
//
// WHAT IT DOES:   Designs a form from data tags. Opened from a Form card's DATA TAGS section ("Form builder"). You pick tags from
//                 the project's tag list (or make a new one), and each becomes a question: label, type, required, answer options,
//                 help text. Questions sit on pages (sections) with a title and short instructions. A Preview tab shows the form
//                 as a respondent would see it, and Print makes a clean paper copy for client review sessions, ending with a
//                 data map (question -> data tag -> where else the tag is used).
//
// STORED WHERE:   card.formDesign = { pages: [{ id, title, intro, fields: [{ id, tagId, label, type, required, help, options }] }] }
//                 A question is always tied to one data tag, and a tag appears once per form.
//
// STAYS IN STEP:  Every change also updates the card the way the Data Tags list does: the tags are kept on the form's first step
//                 (what the flow map shows), and for a form built here (no import source) card.formFields is rewritten in question
//                 order so the flow map's form-answer paths see the same questions. A form pulled from a service (Jotform,
//                 Calendly) keeps its own formFields, which every pull refreshes; the design is a separate draft beside it.
//
// DOES NOT:       Publish anything. This is the design of the form, not a live form that collects answers.
//
// USED BY:        features/resources-modal.js (the Form builder button). Loaded from app.js.
// NEEDS:          Nothing new in the database; the design is saved with the project like any other card field.
// ================================================================================================

import { state, esc, uid, getActiveClient } from '../core/data.js';

const TYPES = {
  text: 'Short text', textarea: 'Long text', email: 'Email', phone: 'Phone', number: 'Number',
  date: 'Date', dropdown: 'Dropdown', radio: 'Single choice', checkbox: 'Multiple choice'
};
const HAS_OPTIONS = new Set(['dropdown', 'radio', 'checkbox']);
const ui = { resId: null, view: 'build', pageId: null };

const toast = (t) => { if (typeof OL.showToast === 'function') OL.showToast(t); else console.info(t); };
const getRes = () => OL.getResourceById(ui.resId);
const newId = (p) => p + '-' + uid().replace(/^id_/, '');

// ---- data tags ----------------------------------------------------------------------------------------------
// Same pool the Data Tags dropdown uses: the project's own list when it has one, else the master list.
function tagPool() {
  const c = getActiveClient();
  const local = c?.projectData?.localDatapoints || [];
  return local.length ? local : (state.master?.datapoints || []);
}
const allTags = () => [...(getActiveClient()?.projectData?.localDatapoints || []), ...(state.master?.datapoints || [])];
const findTag = (id) => allTags().find((d) => d && String(d.id) === String(id));

function inferType(tag) {
  if (TYPES[tag.fieldType]) return tag.fieldType;
  const n = `${tag.name || ''} ${tag.key || ''}`.toLowerCase();
  if ((tag.options || []).length) return 'dropdown';
  if (/e-?mail/.test(n)) return 'email';
  if (/phone|mobile|cell/.test(n)) return 'phone';
  if (/\bdate\b|birth|\bdob\b/.test(n)) return 'date';
  return 'text';
}
function fieldFromTag(tag) {
  const type = inferType(tag);
  return { id: newId('fld'), tagId: tag.id, label: tag.name || 'Question', type, required: false, help: '', options: HAS_OPTIONS.has(type) ? [...(tag.options || [])] : [] };
}
function makeTag(name) {
  const clean = String(name || '').trim().slice(0, 80);
  if (!clean) return null;
  const hit = allTags().find((d) => d && !d.isBundle && String(d.name || '').toLowerCase().trim() === clean.toLowerCase());
  if (hit) return hit;
  const camel = clean.replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).filter(Boolean).map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w[0].toLowerCase() + w.slice(1))).join('');
  const tag = { id: 'dp-' + Date.now() + Math.random().toString(36).slice(2, 5), name: clean, key: '{' + (camel || 'field') + '}', category: 'Form Fields', isBundle: false, childIds: null };
  const c = getActiveClient();
  if (c) { if (!c.projectData) c.projectData = {}; if (!Array.isArray(c.projectData.localDatapoints)) c.projectData.localDatapoints = []; c.projectData.localDatapoints.push(tag); }
  else { if (!state.master.datapoints) state.master.datapoints = []; state.master.datapoints.push(tag); }
  return tag;
}

// ---- the design ---------------------------------------------------------------------------------------------
function normType(t, options) {
  const s = String(t || 'text').toLowerCase().replace(/[\s-]+/g, '_');
  if (TYPES[s]) return s;
  if (/select|dropdown/.test(s)) return 'dropdown';
  if (/radio|single/.test(s)) return 'radio';
  if (/check|multi/.test(s)) return 'checkbox';
  if (/long|area|paragraph/.test(s)) return 'textarea';
  if (/mail/.test(s)) return 'email';
  if (/phone/.test(s)) return 'phone';
  if (/date/.test(s)) return 'date';
  if (/num|number/.test(s)) return 'number';
  return (options || []).length ? 'dropdown' : 'text';
}

// First open: start from what the card already knows (its formFields, else the tags on its steps).
function ensureDesign(res) {
  if (res.formDesign && Array.isArray(res.formDesign.pages) && res.formDesign.pages.length) return res.formDesign;
  let fields = [];
  if ((res.formFields || []).length) {
    fields = res.formFields.filter((f) => f && f.tagId != null).map((f) => {
      const tag = findTag(f.tagId);
      const type = normType(f.type, f.options);
      return { id: newId('fld'), tagId: f.tagId, label: f.label || tag?.name || 'Question', type, required: !!f.required, help: '', options: HAS_OPTIONS.has(type) ? [...(f.options || [])] : [] };
    });
  } else {
    const seen = new Set();
    (res.steps || []).forEach((st) => (st.datapoints || []).forEach((d) => { if (d && !seen.has(String(d.id)) && !d.isBundle) { seen.add(String(d.id)); fields.push(fieldFromTag(d)); } }));
  }
  res.formDesign = { pages: [{ id: newId('pg'), title: 'Page 1', intro: '', fields }] };
  return res.formDesign;
}
const allFields = (d) => d.pages.flatMap((p) => p.fields);
function locate(d, fid) {
  for (const page of d.pages) { const idx = page.fields.findIndex((f) => f.id === fid); if (idx >= 0) return { page, idx, field: page.fields[idx] }; }
  return null;
}
const activePage = (d) => d.pages.find((p) => p.id === ui.pageId) || d.pages[0];

// Keep the card's own data in step with the design (see STAYS IN STEP above).
function syncToCard(res) {
  const d = res.formDesign;
  const fields = allFields(d);
  if (!Array.isArray(res.steps)) res.steps = [];
  if (!res.steps.length) res.steps.push({ id: 'step_' + Date.now(), name: 'Form completed', appName: res.appName || '', datapoints: [] });
  const step = res.steps[0];
  if (!Array.isArray(step.datapoints)) step.datapoints = [];
  const present = new Set();
  res.steps.forEach((st) => (st.datapoints || []).forEach((x) => present.add(String(x.id))));
  fields.forEach((f) => {
    if (present.has(String(f.tagId))) return;
    const tag = findTag(f.tagId);
    if (tag) { step.datapoints.push(tag); present.add(String(f.tagId)); }
  });
  if (!res.source) res.formFields = fields.map((f) => ({ tagId: f.tagId, label: f.label, type: f.type, required: !!f.required, options: HAS_OPTIONS.has(f.type) ? [...(f.options || [])] : [] }));
  d.updatedAt = new Date().toISOString();
}
async function save(fn) {
  const res = getRes();
  if (!res) return;
  await OL.updateAndSync(() => { const d = ensureDesign(res); fn(d, res); syncToCard(res); }, getActiveClient()?.id);
}

// Where else each tag is used in this project (other cards' steps), for the mapping view.
function usageMap() {
  const map = {};
  const cards = (typeof OL.getCurrentProjectData === 'function' ? OL.getCurrentProjectData()?.resources : null) || [];
  cards.forEach((r) => {
    if (!r || String(r.id) === String(ui.resId)) return;
    const seen = new Set();
    (r.steps || []).forEach((st) => (st.datapoints || []).forEach((x) => {
      const k = String(x.id);
      if (seen.has(k)) return;
      seen.add(k);
      (map[k] = map[k] || []).push(r.name || 'Untitled');
    }));
  });
  return map;
}

// ---- drawing ------------------------------------------------------------------------------------------------
function libraryHtml(d) {
  const used = new Set(allFields(d).map((f) => String(f.tagId)));
  const choices = tagPool().filter((t) => t && !used.has(String(t.id)));
  const groups = choices.reduce((g, t) => { const c = t.category || 'Other'; (g[c] = g[c] || []).push(t); return g; }, {});
  const page = activePage(d);
  return `
    <div style="display:flex;flex-direction:column;gap:10px;min-width:0;">
      <div>
        <label class="tiny muted" style="display:block;margin-bottom:4px;">Add questions to</label>
        <select class="modal-input tiny" style="width:100%;" onchange="OL.fbSetPage(this.value)">
          ${d.pages.map((p, i) => `<option value="${esc(p.id)}" ${p.id === page.id ? 'selected' : ''}>${esc(p.title || 'Page ' + (i + 1))}</option>`).join('')}
        </select>
      </div>
      <input type="text" class="modal-input tiny" placeholder="Search data tags..." oninput="OL.fbFilter(this.value)">
      <div style="display:flex;gap:6px;">
        <input type="text" id="fb-newtag" class="modal-input tiny" style="flex:1;min-width:0;" placeholder="New data tag name"
               onkeydown="if(event.key==='Enter'){event.preventDefault();OL.fbNewTag();}">
        <button class="btn tiny primary" onclick="OL.fbNewTag()">Create</button>
      </div>
      <div id="fb-library" style="max-height:52vh;overflow-y:auto;display:flex;flex-direction:column;gap:2px;padding-right:2px;">
        ${Object.keys(groups).sort().map((c) => `
          <div class="fb-group tiny muted" style="margin:8px 0 2px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;font-size:9px;">${esc(c)}</div>
          ${groups[c].map((t) => `
            <div class="fb-tagrow is-clickable" data-name="${esc(String(t.name || '').toLowerCase())}" onclick="OL.fbAddTag('${esc(t.id)}')"
                 style="display:flex;align-items:center;gap:6px;padding:6px 8px;border:1px solid var(--line);border-radius:6px;background:var(--panel-soft);">
              <i data-lucide="${t.isBundle ? 'package' : 'tag'}" style="width:11px;height:11px;color:#a78bfa;flex:0 0 auto;"></i>
              <span style="font-size:11px;flex:1;min-width:0;overflow-wrap:anywhere;">${esc(t.name)}${t.isBundle ? ' <span class="tiny muted">(bundle)</span>' : ''}</span>
              <i data-lucide="plus" style="width:12px;height:12px;opacity:0.6;flex:0 0 auto;"></i>
            </div>`).join('')}`).join('') || '<span class="tiny muted">Every data tag is already on this form.</span>'}
      </div>
    </div>`;
}

function fieldHtml(d, page, f, idx, usage) {
  const tag = findTag(f.tagId);
  const elsewhere = usage[String(f.tagId)] || [];
  const opts = HAS_OPTIONS.has(f.type);
  return `
    <div style="border:1px solid var(--line);border-radius:8px;padding:10px 12px;background:rgba(255,255,255,0.02);">
      <div style="display:grid;grid-template-columns:minmax(0,1fr) 160px auto auto;gap:8px;align-items:center;">
        <input type="text" class="modal-input tiny" value="${esc(f.label)}" placeholder="Question"
               onchange="OL.fbFieldProp('${esc(f.id)}','label',this.value)">
        <select class="modal-input tiny" onchange="OL.fbFieldType('${esc(f.id)}',this.value)">
          ${Object.entries(TYPES).map(([k, v]) => `<option value="${k}" ${f.type === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}
        </select>
        <label class="tiny" style="display:flex;align-items:center;gap:4px;white-space:nowrap;">
          <input type="checkbox" ${f.required ? 'checked' : ''} onchange="OL.fbFieldProp('${esc(f.id)}','required',this.checked)"> Required
        </label>
        <div style="display:flex;gap:2px;">
          <button class="btn tiny soft" title="Move up" ${idx === 0 ? 'disabled' : ''} onclick="OL.fbShift('${esc(f.id)}',-1)"><i data-lucide="chevron-up" style="width:11px;height:11px;pointer-events:none;"></i></button>
          <button class="btn tiny soft" title="Move down" ${idx === page.fields.length - 1 ? 'disabled' : ''} onclick="OL.fbShift('${esc(f.id)}',1)"><i data-lucide="chevron-down" style="width:11px;height:11px;pointer-events:none;"></i></button>
          <button class="btn tiny soft" title="Remove from the form" onclick="OL.fbRemoveField('${esc(f.id)}')"><i data-lucide="x" style="width:11px;height:11px;pointer-events:none;"></i></button>
        </div>
      </div>
      ${opts ? `<textarea class="modal-input tiny" rows="3" style="width:100%;box-sizing:border-box;margin-top:8px;" placeholder="Answer choices, one per line"
               onchange="OL.fbFieldOptions('${esc(f.id)}',this.value)">${esc((f.options || []).join('\n'))}</textarea>` : ''}
      ${opts ? `<div style="margin-top:4px;"><button class="btn tiny soft" title="Make these choices and this answer type the default whenever this data tag is used" onclick="OL.fbSaveToTag('${esc(f.id)}')">Save choices to the data tag</button></div>` : ''}
      <input type="text" class="modal-input tiny" style="width:100%;box-sizing:border-box;margin-top:8px;" value="${esc(f.help || '')}" placeholder="Help text shown under the question (optional)"
             onchange="OL.fbFieldProp('${esc(f.id)}','help',this.value)">
      <div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:8px;">
        <span class="pill tiny soft" title="The data tag this answer fills"><i data-lucide="tag" style="width:10px;height:10px;margin-right:4px;"></i>${esc(tag ? tag.name : 'Missing tag')}${tag && tag.key ? ` <span style="font-family:monospace;opacity:0.7;">${esc(tag.key)}</span>` : ''}</span>
        ${elsewhere.length ? `<span class="tiny muted" title="${esc(elsewhere.join(', '))}">Also used in ${elsewhere.length} other card${elsewhere.length === 1 ? '' : 's'}: ${esc(elsewhere.slice(0, 3).join(', '))}${elsewhere.length > 3 ? ', ...' : ''}</span>` : '<span class="tiny muted">Not used by any other card yet</span>'}
        ${d.pages.length > 1 ? `<span style="flex:1;"></span><select class="modal-input tiny" style="width:auto;" onchange="OL.fbMoveField('${esc(f.id)}',this.value)">
          <option value="">Move to page...</option>
          ${d.pages.filter((p) => p.id !== page.id).map((p) => `<option value="${esc(p.id)}">${esc(p.title || 'Untitled page')}</option>`).join('')}
        </select>` : ''}
      </div>
    </div>`;
}

function pagesHtml(d) {
  const usage = usageMap();
  return `
    <div style="display:flex;flex-direction:column;gap:16px;min-width:0;">
      ${d.pages.map((p, pi) => `
        <div style="border:1px solid var(--line);border-radius:10px;padding:14px;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
            <span class="pill tiny soft">Page ${pi + 1}</span>
            <input type="text" class="modal-input" style="flex:1;font-weight:600;" value="${esc(p.title)}" placeholder="Page title"
                   onchange="OL.fbPageProp('${esc(p.id)}','title',this.value)">
            <button class="btn tiny soft" title="Move page up" ${pi === 0 ? 'disabled' : ''} onclick="OL.fbShiftPage('${esc(p.id)}',-1)"><i data-lucide="chevron-up" style="width:11px;height:11px;pointer-events:none;"></i></button>
            <button class="btn tiny soft" title="Move page down" ${pi === d.pages.length - 1 ? 'disabled' : ''} onclick="OL.fbShiftPage('${esc(p.id)}',1)"><i data-lucide="chevron-down" style="width:11px;height:11px;pointer-events:none;"></i></button>
            <button class="btn tiny soft" title="${p.fields.length ? 'Move or remove its questions first' : 'Delete this page'}" ${p.fields.length || d.pages.length === 1 ? 'disabled' : ''} onclick="OL.fbDelPage('${esc(p.id)}')"><i data-lucide="x" style="width:11px;height:11px;pointer-events:none;"></i></button>
          </div>
          <textarea class="modal-input tiny" rows="2" style="width:100%;box-sizing:border-box;margin-bottom:10px;" placeholder="Instructions shown at the top of this page (optional)"
                    onchange="OL.fbPageProp('${esc(p.id)}','intro',this.value)">${esc(p.intro || '')}</textarea>
          <div style="display:flex;flex-direction:column;gap:8px;">
            ${p.fields.length ? p.fields.map((f, i) => fieldHtml(d, p, f, i, usage)).join('') : '<div class="tiny muted" style="padding:14px;text-align:center;border:1px dashed var(--line);border-radius:6px;">No questions on this page. Click a data tag on the left to add one.</div>'}
          </div>
        </div>`).join('')}
      <div><button class="btn small soft" onclick="OL.fbAddPage()"><i data-lucide="plus" style="width:12px;height:12px;"></i> Add page</button></div>
    </div>`;
}

function previewFieldHtml(f) {
  const star = f.required ? '<span style="color:#ef4444;"> *</span>' : '';
  const label = `<label style="display:block;font-weight:600;font-size:13px;margin-bottom:4px;">${esc(f.label)}${star}</label>`;
  const help = f.help ? `<div class="tiny muted" style="margin:-2px 0 6px;">${esc(f.help)}</div>` : '';
  let input;
  if (f.type === 'textarea') input = '<textarea class="modal-input" rows="3" disabled style="width:100%;box-sizing:border-box;"></textarea>';
  else if (f.type === 'dropdown') input = `<select class="modal-input" disabled style="width:100%;"><option>Select...</option>${(f.options || []).map((o) => `<option>${esc(o)}</option>`).join('')}</select>`;
  else if (f.type === 'radio' || f.type === 'checkbox') input = `<div style="display:flex;flex-direction:column;gap:4px;">${(f.options || []).map((o) => `<label style="font-size:13px;display:flex;gap:6px;align-items:center;"><input type="${f.type}" disabled> ${esc(o)}</label>`).join('') || '<span class="tiny muted">No answer choices yet</span>'}</div>`;
  else input = `<input class="modal-input" disabled style="width:100%;box-sizing:border-box;" type="${f.type === 'email' ? 'email' : f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}">`;
  return `<div style="margin-bottom:14px;">${label}${help}${input}</div>`;
}
function previewHtml(d) {
  return `<div style="max-width:720px;margin:0 auto;display:flex;flex-direction:column;gap:18px;">
    ${d.pages.map((p, i) => `<div style="border:1px solid var(--line);border-radius:10px;padding:18px 20px;">
      ${d.pages.length > 1 ? `<div class="tiny muted" style="margin-bottom:4px;">Page ${i + 1} of ${d.pages.length}</div>` : ''}
      <div style="font-size:17px;font-weight:700;margin-bottom:4px;">${esc(p.title || 'Untitled page')}</div>
      ${p.intro ? `<div class="small muted" style="margin-bottom:14px;white-space:pre-wrap;">${esc(p.intro)}</div>` : '<div style="height:10px;"></div>'}
      ${p.fields.map(previewFieldHtml).join('') || '<div class="tiny muted">No questions on this page.</div>'}
    </div>`).join('')}
    <div class="tiny muted" style="text-align:center;">Preview only. Nothing here collects answers.</div>
  </div>`;
}

function render() {
  const res = getRes();
  if (!res) return;
  const d = ensureDesign(res);
  if (!d.pages.some((p) => p.id === ui.pageId)) ui.pageId = d.pages[0].id;
  const prevScroll = document.getElementById('fb-body')?.scrollTop || 0;
  const count = allFields(d).length;
  const imported = !!res.source;
  const html = `
    <div class="modal-head">
      <div class="modal-title-text"><i data-lucide="file-text" style="width:16px;height:16px;vertical-align:-3px;margin-right:6px;"></i>Form builder: ${esc(res.name || 'Form')}</div>
      <div class="spacer"></div>
      <button class="btn small ${ui.view === 'build' ? 'primary' : 'soft'}" onclick="OL.fbView('build')">Build</button>
      <button class="btn small ${ui.view === 'preview' ? 'primary' : 'soft'}" onclick="OL.fbView('preview')"><i data-lucide="eye" style="width:12px;height:12px;"></i> Preview</button>
      <button class="btn small soft" onclick="OL.fbPrint()"><i data-lucide="printer" style="width:12px;height:12px;"></i> Print</button>
      <button class="btn small soft" onclick="OL.fbClose()">Close</button>
    </div>
    <div class="modal-body" id="fb-body" style="max-width:none;width:100%;box-sizing:border-box;">
      <div class="tiny muted" style="margin-bottom:12px;">${count} question${count === 1 ? '' : 's'} on ${d.pages.length} page${d.pages.length === 1 ? '' : 's'}. Each question is a data tag, so the form, the flow map and the Data Tags list always agree.${imported ? ` This form is read from ${esc(res.source)}; what you design here is a separate draft and is not sent back.` : ''}</div>
      ${ui.view === 'preview' ? previewHtml(d) : `<div style="display:grid;grid-template-columns:280px minmax(0,1fr);gap:20px;align-items:start;">${libraryHtml(d)}${pagesHtml(d)}</div>`}
    </div>`;
  OL.showOverlayModal(`<div style="width:100%;">${html}</div>`, { wide: true });
  if (window.lucide) window.lucide.createIcons();
  const body = document.getElementById('fb-body');
  if (body) body.scrollTop = prevScroll;
}

// ---- actions ------------------------------------------------------------------------------------------------
function openFormBuilder(resId) {
  if (!OL.getResourceById(resId)) { toast('Open a form card first.'); return; }
  ui.resId = resId; ui.view = 'build'; ui.pageId = null;
  render();
}
function fbClose() {
  const id = ui.resId;
  OL.closeModal();
  if (id && typeof OL.openResourceModal === 'function') OL.openResourceModal(id);
}
const fbView = (v) => { ui.view = v === 'preview' ? 'preview' : 'build'; render(); };
const fbSetPage = (id) => { ui.pageId = id; };
function fbFilter(q) {
  const s = String(q || '').toLowerCase().trim();
  document.querySelectorAll('#fb-library .fb-tagrow').forEach((el) => { el.style.display = !s || (el.dataset.name || '').includes(s) ? '' : 'none'; });
}

async function addTagsToPage(tag) {
  const pool = allTags();
  const adds = tag.isBundle ? (tag.childIds || []).map((id) => pool.find((x) => x && String(x.id) === String(id))).filter(Boolean) : [tag];
  await save((d) => {
    const page = activePage(d);
    adds.forEach((t) => { if (!allFields(d).some((f) => String(f.tagId) === String(t.id))) page.fields.push(fieldFromTag(t)); });
  });
}
async function fbAddTag(tagId) { const tag = findTag(tagId); if (!tag) return; await addTagsToPage(tag); render(); }
async function fbNewTag() {
  const input = document.getElementById('fb-newtag');
  const tag = makeTag(input ? input.value : '');
  if (!tag) return;
  const used = allFields(ensureDesign(getRes())).some((f) => String(f.tagId) === String(tag.id));
  if (used) { toast(`“${tag.name}” is already on this form.`); return; }
  await addTagsToPage(tag);
  render();
}
async function fbFieldProp(fid, prop, value) {
  if (!['label', 'required', 'help'].includes(prop)) return;
  await save((d) => { const hit = locate(d, fid); if (!hit) return; hit.field[prop] = prop === 'required' ? !!value : String(value).slice(0, prop === 'help' ? 300 : 200); });
}
async function fbFieldType(fid, type) {
  if (!TYPES[type]) return;
  await save((d) => {
    const hit = locate(d, fid); if (!hit) return;
    hit.field.type = type;
    if (HAS_OPTIONS.has(type) && !(hit.field.options || []).length) hit.field.options = [...(findTag(hit.field.tagId)?.options || [])];
  });
  render();
}
async function fbFieldOptions(fid, text) {
  const list = [...new Set(String(text || '').split('\n').map((s) => s.trim()).filter(Boolean))].slice(0, 100);
  await save((d) => { const hit = locate(d, fid); if (hit) hit.field.options = list; });
}
async function fbSaveToTag(fid) {
  await save((d) => {
    const hit = locate(d, fid); const tag = hit && findTag(hit.field.tagId);
    if (!tag) return;
    tag.options = [...(hit.field.options || [])];
    tag.fieldType = hit.field.type;
  });
  toast('Saved. New forms that use this tag will start with these choices.');
}
async function fbShift(fid, dir) {
  await save((d) => {
    const hit = locate(d, fid); if (!hit) return;
    const j = hit.idx + (dir < 0 ? -1 : 1);
    if (j < 0 || j >= hit.page.fields.length) return;
    [hit.page.fields[hit.idx], hit.page.fields[j]] = [hit.page.fields[j], hit.page.fields[hit.idx]];
  });
  render();
}
async function fbMoveField(fid, pageId) {
  if (!pageId) return;
  await save((d) => {
    const hit = locate(d, fid); const to = d.pages.find((p) => p.id === pageId);
    if (!hit || !to) return;
    hit.page.fields.splice(hit.idx, 1);
    to.fields.push(hit.field);
  });
  render();
}
async function fbRemoveField(fid) {
  await save((d, res) => {
    const hit = locate(d, fid); if (!hit) return;
    hit.page.fields.splice(hit.idx, 1);
    const tagId = String(hit.field.tagId);
    // the tag leaves the card's steps too, as the Data Tags list's × does
    (res.steps || []).forEach((st) => { if (Array.isArray(st.datapoints)) st.datapoints = st.datapoints.filter((x) => String(x.id) !== tagId); });
  });
  render();
}
async function fbAddPage() {
  await save((d) => { const p = { id: newId('pg'), title: `Page ${d.pages.length + 1}`, intro: '', fields: [] }; d.pages.push(p); ui.pageId = p.id; });
  render();
}
async function fbPageProp(pid, prop, value) {
  if (!['title', 'intro'].includes(prop)) return;
  await save((d) => { const p = d.pages.find((x) => x.id === pid); if (p) p[prop] = String(value).slice(0, prop === 'title' ? 120 : 1000); });
}
async function fbShiftPage(pid, dir) {
  await save((d) => {
    const i = d.pages.findIndex((x) => x.id === pid); const j = i + (dir < 0 ? -1 : 1);
    if (i < 0 || j < 0 || j >= d.pages.length) return;
    [d.pages[i], d.pages[j]] = [d.pages[j], d.pages[i]];
  });
  render();
}
async function fbDelPage(pid) {
  await save((d) => {
    const p = d.pages.find((x) => x.id === pid);
    if (!p || p.fields.length || d.pages.length === 1) return;
    d.pages = d.pages.filter((x) => x.id !== pid);
  });
  render();
}

// ---- print --------------------------------------------------------------------------------------------------
function printFieldHtml(f, n) {
  const mark = f.required ? '<span class="req"> *</span>' : '';
  let body;
  if (f.type === 'textarea') body = '<div class="box tall"></div><div class="box"></div>';
  else if (f.type === 'radio' || f.type === 'dropdown') body = `<div class="opts">${(f.options || []).map((o) => `<div class="opt radio">${esc(o)}</div>`).join('') || '<div class="line"></div>'}</div>${f.type === 'dropdown' ? '<div class="note">Choose one</div>' : ''}`;
  else if (f.type === 'checkbox') body = `<div class="opts">${(f.options || []).map((o) => `<div class="opt check">${esc(o)}</div>`).join('') || '<div class="line"></div>'}</div><div class="note">Choose all that apply</div>`;
  else body = `<div class="line">${f.type === 'date' ? '<span class="hint">MM / DD / YYYY</span>' : ''}</div>`;
  return `<div class="q"><div class="ql"><span class="n">${n}.</span> ${esc(f.label)}${mark}</div>${f.help ? `<div class="help">${esc(f.help)}</div>` : ''}${body}</div>`;
}
function fbPrint() {
  const res = getRes(); if (!res) return;
  const d = ensureDesign(res);
  const usage = usageMap();
  const client = getActiveClient();
  let n = 0;
  const pages = d.pages.map((p, i) => `<section class="${i ? 'brk' : ''}"><h2>${esc(p.title || 'Untitled page')}</h2>${p.intro ? `<p class="intro">${esc(p.intro)}</p>` : ''}${p.fields.map((f) => printFieldHtml(f, ++n)).join('') || '<p class="note">No questions on this page.</p>'}</section>`).join('');
  let m = 0;
  const rows = allFields(d).map((f) => {
    const tag = findTag(f.tagId); const el = usage[String(f.tagId)] || [];
    return `<tr><td>${++m}</td><td>${esc(f.label)}</td><td>${esc(TYPES[f.type] || f.type)}${f.required ? ', required' : ''}</td><td>${esc(tag ? tag.name : 'Missing tag')}${tag && tag.key ? ` <code>${esc(tag.key)}</code>` : ''}</td><td>${esc(el.join(', ') || 'None yet')}</td></tr>`;
  }).join('');
  const doc = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(res.name || 'Form')}</title><style>
    body{font:13px/1.45 -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#111;margin:0;padding:28px 36px;}
    h1{font-size:22px;margin:0 0 2px;} .sub{color:#555;margin:0 0 22px;} h2{font-size:16px;margin:0 0 4px;border-bottom:2px solid #111;padding-bottom:4px;}
    .intro{margin:6px 0 12px;color:#333;white-space:pre-wrap;} .brk{page-break-before:always;margin-top:0;}
    .q{margin:14px 0;break-inside:avoid;} .ql{font-weight:600;} .n{color:#666;margin-right:2px;} .req{color:#b91c1c;} .help{color:#555;font-size:12px;margin:1px 0 4px;}
    .line{border-bottom:1px solid #444;height:22px;margin-top:6px;} .hint{color:#999;font-size:11px;} .box{border:1px solid #444;height:24px;margin-top:6px;} .box.tall{height:56px;}
    .opts{margin-top:5px;} .opt{padding:2px 0 2px 22px;position:relative;} .opt::before{content:"";position:absolute;left:0;top:4px;width:11px;height:11px;border:1.5px solid #444;}
    .opt.radio::before{border-radius:50%;} .note{color:#777;font-size:11px;margin-top:3px;}
    .map{page-break-before:always;} table{border-collapse:collapse;width:100%;font-size:11.5px;} th,td{border:1px solid #bbb;padding:5px 7px;text-align:left;vertical-align:top;} th{background:#f1f1f1;}
    code{background:#f1f1f1;padding:0 3px;border-radius:3px;font-size:11px;}
    @media print{body{padding:0;} @page{margin:16mm;}}
  </style></head><body>
    <h1>${esc(res.name || 'Form')}</h1><p class="sub">${esc(client?.name || '')}${client?.name ? ' · ' : ''}${d.pages.length} page${d.pages.length === 1 ? '' : 's'}, ${n} question${n === 1 ? '' : 's'}</p>
    ${pages}
    <section class="map"><h2>Data map</h2><p class="intro">Which data tag each question fills, and where else that tag is used in this project.</p>
      <table><thead><tr><th>#</th><th>Question</th><th>Type</th><th>Data tag</th><th>Also used in</th></tr></thead><tbody>${rows}</tbody></table></section>
  </body></html>`;
  const win = window.open('', '_blank', 'width=900,height=850');
  if (!win) { toast('Allow pop-ups to print the form.'); return; }
  win.document.write(doc);
  win.document.close();
  setTimeout(() => { try { win.focus(); win.print(); } catch (e) { /* the window is still open to print by hand */ } }, 350);
}

window.OL = window.OL || {};
Object.assign(window.OL, {
  openFormBuilder, fbClose, fbView, fbSetPage, fbFilter, fbAddTag, fbNewTag, fbFieldProp, fbFieldType, fbFieldOptions,
  fbShift, fbSaveToTag, fbMoveField, fbRemoveField, fbAddPage, fbPageProp, fbShiftPage, fbDelPage, fbPrint
});
export { openFormBuilder };
