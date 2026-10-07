// ================================================================================================
// FILE: features/flow-visualizer/step-items.js
//
// WHAT IT DOES:   Questions, action items and notes on the steps of the flow map, for guided sessions with a client: ask
//                 a question on a step, assign an action item, jot a note, and walk away with one list of every gap and
//                 follow-up from the review.
//
//   On a step      step.items = [{ id, kind: 'question' | 'action' | 'note', text, done, owner, who, due, createdAt, doneAt,
//                  taskId? }]. A question typed in Frame-out ("Prepares the packet ? who signs off") is step.question; it
//                  is read as a question item too, so nothing has to be entered twice.
//   On the card    a small flag shows what is open on the step (? questions, a box for actions, a pencil for notes). Click
//                  it for the step's list and a quick-add (type, press Enter). On a step with nothing yet the flag shows as a
//                  "+" when you hover the card.
//   Everywhere     "Questions & actions" on the toolbar opens one list of everything, grouped by type, with a tick box,
//                  who owns it, when it's due, a jump to the step, and buttons to copy the list as text, turn actions into
//                  real tasks, and add a "Who completes this step" question to every step that has no owner.
//   On paper       the printout puts a numbered flag (Q1, A2, N3) on each card and ends with "Questions and Action
//                  Items": the same numbers, with room to write the answers (features/flow-print.js calls
//                  itemsAppendixHtml / numberItems below).
// ================================================================================================

import { esc, uid, getActiveClient, persist, markClientDirty } from '../../core/data.js';
import { OWNERS, OWNER_ORDER } from '../../core/frameout.js';

const OL = () => window.OL;
export const KINDS = [
  { key: 'question', label: 'Question', plural: 'Questions', sym: '?', prefix: 'Q', color: '#F5B800' },
  { key: 'action',   label: 'Action',   plural: 'Action items', sym: '\u2610', prefix: 'A', color: '#3DD9C5' },
  { key: 'note',     label: 'Note',     plural: 'Notes', sym: '\u270E', prefix: 'N', color: '#9fb0c4' },
];
const KIND = Object.fromEntries(KINDS.map((k) => [k.key, k]));

// Prompts that make a gap easy to spot in a session. {step} becomes the step's name.
export const QUESTION_STARTERS = [
  'Who completes this step: {step}?',
  'What tool is used for: {step}?',
  'What triggers: {step}?',
  'How often does this happen: {step}?',
  'What does done look like for: {step}?',
];

// ---- reading ---------------------------------------------------------------------------------------------------
const project = () => (OL().getCurrentProjectData ? OL().getCurrentProjectData() : { resources: [] }) || { resources: [] };
const allRes = () => (project().resources || []).filter((r) => r && !r.isDeleted);
const resById = (id) => allRes().find((r) => String(r.id) === String(id));
const stepOf = (res, id) => ((res && res.steps) || []).find((s) => String(s.id) === String(id));

// the items on a step, with a Frame-out question counted as one
export function itemsOf(step) {
  if (!step) return [];
  const own = Array.isArray(step.items) ? step.items.filter(Boolean) : [];
  const legacy = step.question && step.question.text ? [{ id: 'legacy', kind: 'question', text: step.question.text, done: !!step.question.done, legacy: true }] : [];
  return legacy.concat(own);
}
export function countsOf(step) {
  const c = { question: 0, action: 0, note: 0, done: 0, total: 0 };
  itemsOf(step).forEach((i) => { c.total++; if (i.done) c.done++; else c[i.kind] = (c[i.kind] || 0) + 1; });
  c.open = c.question + c.action + c.note;
  return c;
}

// Every resource in the order the map reads: stages, then workflows, then the processes in each workflow
export function orderedResources(pd) {
  const res = (pd.resources || []).filter((r) => r && !r.isDeleted);
  const seen = new Set(); const out = [];
  const take = (r) => { if (r && !seen.has(String(r.id))) { seen.add(String(r.id)); out.push(r); } };
  (pd.stages || []).forEach((st) => (pd.workflows || []).filter((w) => w.stageId === st.id).forEach((w) => (w.resourceIds || []).forEach((id) => take(res.find((r) => String(r.id) === String(id))))));
  (pd.workflows || []).forEach((w) => (w.resourceIds || []).forEach((id) => take(res.find((r) => String(r.id) === String(id)))));
  res.forEach(take);
  return out;
}
const workflowOf = (pd, res) => (pd.workflows || []).find((w) => (w.resourceIds || []).map(String).includes(String(res.id)));

// Every item, in map order, numbered Q1.. A1.. N1.. : [{ no, label, kind, item, res, step, stepNo, workflow }]
export function collectItems(pd = project(), { includeArchived = false } = {}) {
  const entries = [];
  orderedResources(pd).forEach((res) => {
    const wf = workflowOf(pd, res);
    (res.steps || []).forEach((step, idx) => {
      if (step.isArchived && !includeArchived) return;
      itemsOf(step).forEach((item) => entries.push({ kind: item.kind, item, res, step, stepNo: idx + 1, workflow: wf ? wf.name : '' }));
    });
  });
  const n = { question: 0, action: 0, note: 0 };
  entries.forEach((e) => { e.no = ++n[e.kind]; e.label = `${(KIND[e.kind] || KIND.note).prefix}${e.no}`; });
  return entries;
}
export const numberItems = (entries) => { const m = {}; entries.forEach((e) => { m[`${e.res.id}|${e.step.id}|${e.item.id}`] = e.label; }); return m; };

// ---- writing ---------------------------------------------------------------------------------------------------
function save(resId, stepId, fn) {
  const res = resById(resId); const step = stepOf(res, stepId); if (!step) return null;
  const out = fn(step, res);
  const client = getActiveClient && getActiveClient(); if (client && markClientDirty) markClientDirty(client.id);
  OL().persist();
  refreshFlags(resId, stepId);
  return out;
}
const today = () => new Date().toISOString().slice(0, 10);

// ---- @tagging: type "@" in the box to pick a Sphynx team member (same roster and storage shape as task comments:
// mentions = [{id, name}], see OL.extractMentions in features/business/tasks.js). Tagged people get a notification.
const mentionsIn = (text) => (OL().extractMentions ? OL().extractMentions(String(text || '')) : []);
function mentionRoster() { return OL().getMentionRoster ? OL().getMentionRoster() : []; }
export function mentionInput(input) {
  const box = document.getElementById('fv-items-mention'); if (!box || !input) return;
  const q = OL()._findMentionQuery ? OL()._findMentionQuery(input.value, input.selectionStart || 0) : null;
  const list = q ? mentionRoster().filter((m) => m.name.toLowerCase().includes(q.query)) : [];
  if (!list.length) { box.innerHTML = ''; box.style.display = 'none'; return; }
  box.style.display = 'block';
  box.innerHTML = list.slice(0, 6).map((m, i) => `<div class="fv-mention-opt${i === 0 ? ' on' : ''}" data-name="${esc(m.name)}" data-start="${q.start}" onmousedown="event.preventDefault();OL.fvItemMentionPick(this)">${esc(m.name)}</div>`).join('');
}
export function mentionPick(el) {
  const input = document.getElementById('fv-items-text'); const box = document.getElementById('fv-items-mention');
  if (!input || !el) return;
  const start = Number(el.dataset.start); const caret = input.selectionStart || input.value.length;
  input.value = `${input.value.slice(0, start)}@${el.dataset.name} ${input.value.slice(caret)}`;
  const pos = start + el.dataset.name.length + 2; input.focus(); input.setSelectionRange(pos, pos);
  if (box) { box.innerHTML = ''; box.style.display = 'none'; }
}
// Returns true when the key was used by the open dropdown (so Enter picks the name instead of adding the item).
export function mentionKey(ev) {
  const box = document.getElementById('fv-items-mention'); if (!box || box.style.display === 'none' || !box.innerHTML.trim()) return false;
  if (ev.key === 'Escape') { box.innerHTML = ''; box.style.display = 'none'; return true; }
  if (ev.key === 'Enter' || ev.key === 'Tab') { const first = box.querySelector('.fv-mention-opt'); if (first) { mentionPick(first); return true; } }
  return false;
}
function notifyTagged(res, step, it) {
  if (!it.mentions || !it.mentions.length || !OL().notifyEvent) return;
  const by = it.author || 'Someone';
  it.mentions.forEach((m) => OL().notifyEvent('newComment', m.name, { subject: `${by} mentioned you on "${step.name || 'a step'}" in ${res.name || 'the flow map'}`, body: it.text }));
}

export function addItem(resId, stepId, { kind = 'question', text = '', owner = '', who = '', due = '' } = {}) {
  const t = String(text).trim(); if (!t) return null;
  return save(resId, stepId, (step) => {
    if (!Array.isArray(step.items)) step.items = [];
    const it = { id: uid(), kind: KIND[kind] ? kind : 'note', text: t, done: false, createdAt: today() };
    const tagged = mentionsIn(t); if (tagged.length) it.mentions = tagged;
    const by = OL().getCurrentUserName ? OL().getCurrentUserName() : ''; if (by) it.author = by;
    if (it.kind === 'action') { if (owner) it.owner = owner; if (String(who).trim()) it.who = String(who).trim(); if (due) it.due = due; }
    step.items.push(it);
    notifyTagged(res, step, it);
    return it;
  });
}
export function updateItem(resId, stepId, itemId, patch) {
  return save(resId, stepId, (step) => {
    if (itemId === 'legacy') {
      if (!step.question) return;
      if ('done' in patch) step.question.done = !!patch.done;
      if ('text' in patch && String(patch.text).trim()) step.question.text = String(patch.text).trim();
      return;
    }
    const it = (step.items || []).find((i) => i.id === itemId); if (!it) return;
    Object.keys(patch).forEach((k) => {
      if (k === 'text') { const v = String(patch.text).trim(); if (v) { it.text = v; const m = mentionsIn(v); if (m.length) it.mentions = m; else delete it.mentions; } }
      else if (k === 'done') { it.done = !!patch.done; if (it.done) it.doneAt = today(); else delete it.doneAt; }
      else if (patch[k] === '' || patch[k] == null) delete it[k];
      else it[k] = patch[k];
    });
  });
}
export function removeItem(resId, stepId, itemId) {
  return save(resId, stepId, (step) => {
    if (itemId === 'legacy') { delete step.question; return; }
    step.items = (step.items || []).filter((i) => i.id !== itemId);
    if (!step.items.length) delete step.items;
  });
}

// An action item as a real task in the project's task list
export function makeTask(resId, stepId, itemId) {
  const res = resById(resId); const step = stepOf(res, stepId); const it = (step?.items || []).find((i) => i.id === itemId);
  const client = getActiveClient && getActiveClient();
  if (!it || it.kind !== 'action' || !client || !client.projectData) return false;
  if (it.taskId) return false;
  if (!Array.isArray(client.projectData.clientTasks)) client.projectData.clientTasks = [];
  const isClient = it.owner === 'client';
  const task = {
    id: uid(), title: it.text, name: it.text, status: 'Pending Sphynx Action',
    assignee: isClient ? 'Client Task' : (it.who || 'Sphynx Task'), isClientTask: isClient,
    dueDate: it.due || '', loggedHours: 0, parentTaskId: null, createdBy: 'flow-map', createdAt: new Date().toISOString(),
    description: `From the flow map: ${res.name} \u203A ${step.name || 'step'}`, source: 'flow-map-action',
  };
  client.projectData.clientTasks.unshift(task);
  it.taskId = task.id;
  markClientDirty(client.id); OL().persist();
  refreshFlags(resId, stepId);
  return true;
}

// "Who completes this step: X?" on every step with no owner. Returns how many were added.
export function stepsWithNoOwner(pd = project()) {
  const out = [];
  orderedResources(pd).forEach((res) => (res.steps || []).forEach((step) => {
    if (step.isArchived) return;
    const hasOwner = !!step.owner || (Array.isArray(step.assignees) && step.assignees.length > 0);
    const asked = itemsOf(step).some((i) => /^who completes this step/i.test(i.text));
    if (!hasOwner && !asked) out.push({ res, step });
  }));
  return out;
}
export function addWhoQuestions() {
  const list = stepsWithNoOwner(); if (!list.length) { toast('Every step already has an owner or a "Who completes" question.'); return 0; }
  if (!confirm(`Add "Who completes this step: ...?" to ${list.length} step${list.length === 1 ? '' : 's'} that have no owner?`)) return 0;
  list.forEach(({ res, step }) => addItem(res.id, step.id, { kind: 'question', text: `Who completes this step: ${step.name || 'this step'}?` }));
  renderDrawer(); toast(`Added ${list.length} question${list.length === 1 ? '' : 's'}.`);
  return list.length;
}

// ---- the flag on a card ----------------------------------------------------------------------------------------
export function flagHtml(step, res) {
  const c = countsOf(step);
  const key = `${res.id}|${step.id}`;
  const open = `event.stopPropagation(); OL.fvOpenStepItems('${esc(res.id)}','${esc(step.id)}', event)`;
  if (!c.total) return `<button type="button" class="fv-flag fv-flag-add" data-flag-for="${esc(key)}" title="Add a question, action item or note" aria-label="Add a question, action item or note" onclick="${open}">+</button>`;
  const ids = itemsOf(step).filter((i) => !i.done).map((i) => `${i.kind}:${i.id}`).join(',');
  const chips = KINDS.filter((k) => c[k.key]).map((k) => `<span class="fv-flag-chip" style="--c:${k.color}" title="${c[k.key]} open ${c[k.key] === 1 ? k.label.toLowerCase() : k.plural.toLowerCase()}"><b>${k.sym}</b><i class="fv-flag-n">${c[k.key]}</i></span>`).join('');
  return `<button type="button" class="fv-flag${c.open ? '' : ' is-done'}" data-flag-for="${esc(key)}" data-item-ids="${esc(ids)}" title="Questions, actions and notes on this step" aria-label="Questions, actions and notes on this step" onclick="${open}">${c.open ? chips : '<span class="fv-flag-chip" style="--c:#4ade80"><b>\u2713</b></span>'}</button>`;
}
// redraw one step's flag (the map isn't redrawn, so nothing jumps)
export function refreshFlags(resId, stepId) {
  const res = resById(resId); const step = stepOf(res, stepId); if (!step) return;
  document.querySelectorAll(`[data-flag-for="${CSS && CSS.escape ? CSS.escape(`${resId}|${stepId}`) : `${resId}|${stepId}`}"]`).forEach((el) => {
    const tmp = document.createElement('div'); tmp.innerHTML = flagHtml(step, res);
    if (tmp.firstElementChild) el.replaceWith(tmp.firstElementChild);
  });
  updateToolbarCount();
}
function updateToolbarCount() {
  const b = document.getElementById('fv-items-count'); if (!b) return;
  const open = collectItems().filter((e) => !e.item.done).length;
  b.textContent = open; b.style.display = open ? 'inline-block' : 'none';
}
export const openCount = () => collectItems().filter((e) => !e.item.done).length;

// ---- the step popover --------------------------------------------------------------------------------------------
let popState = { kind: 'question' };
const ownerSelect = (cur, cls = '', id = '') => `<select ${id ? `id="${id}"` : ''} class="fv-items-sel ${cls}"><option value="">Owner</option>${OWNER_ORDER.map((o) => `<option value="${o}" ${cur === o ? 'selected' : ''}>${esc(OWNERS[o].label)}</option>`).join('')}</select>`;

function itemRowHtml(resId, stepId, i) {
  const k = KIND[i.kind] || KIND.note;
  const meta = i.kind === 'action' ? `<div class="fv-item-meta">${i.owner ? `<span class="fv-item-owner" style="--c:${OWNERS[i.owner]?.color || '#9fb0c4'}">${esc(OWNERS[i.owner]?.label || i.owner)}</span>` : ''}${i.who ? `<span>${esc(i.who)}</span>` : ''}${i.due ? `<span>Due ${esc(i.due)}</span>` : ''}${i.taskId ? '<span class="fv-item-task">Task created</span>' : `<button type="button" class="fv-item-link" onclick="OL.fvItemMakeTask('${esc(resId)}','${esc(stepId)}','${esc(i.id)}')">Create task</button>`}</div>` : '';
  const tags = (i.mentions && i.mentions.length) ? `<div class="fv-item-meta">${i.mentions.map((m) => `<span class="fv-item-tag">@${esc(m.name)}</span>`).join('')}</div>` : '';
  return `<div class="fv-item ${i.done ? 'is-done' : ''}" data-item="${esc(i.id)}">
    <input type="checkbox" ${i.done ? 'checked' : ''} aria-label="Done" onchange="OL.fvItemSet('${esc(resId)}','${esc(stepId)}','${esc(i.id)}','done',this.checked)">
    <div class="fv-item-body"><span class="fv-item-kind" style="--c:${k.color}">${esc(k.label)}</span>
      <div class="fv-item-text" contenteditable="plaintext-only" spellcheck="true" onblur="OL.fvItemSet('${esc(resId)}','${esc(stepId)}','${esc(i.id)}','text',this.textContent)" onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur()}">${esc(i.text)}</div>${tags}${meta}</div>
    <button type="button" class="fv-item-x" title="Delete" aria-label="Delete" onclick="OL.fvItemRemove('${esc(resId)}','${esc(stepId)}','${esc(i.id)}')">&#10005;</button></div>`;
}

function popHtml(res, step) {
  const items = itemsOf(step);
  const kindPills = KINDS.map((k) => `<button type="button" class="fv-items-pill ${popState.kind === k.key ? 'on' : ''}" style="--c:${k.color}" onclick="OL.fvItemKind('${esc(res.id)}','${esc(step.id)}','${k.key}')">${esc(k.label)}</button>`).join('');
  const starters = popState.kind === 'question' ? `<div class="fv-items-starters">${QUESTION_STARTERS.map((q, n) => `<button type="button" class="fv-items-starter" onclick="OL.fvItemStarter('${esc(res.id)}','${esc(step.id)}',${n})">${esc(q.replace('{step}', '\u2026').replace(/\u2026\?$/, '?'))}</button>`).join('')}</div>` : '';
  const actionRow = popState.kind === 'action' ? `<div class="fv-items-row">${ownerSelect('', '', 'fv-items-owner')}<input id="fv-items-who" class="fv-items-in" type="text" placeholder="Who (name)" aria-label="Who"><input id="fv-items-due" class="fv-items-in" type="date" aria-label="Due"></div>` : '';
  return `<div class="fv-items-head"><div><div class="fv-items-title">${esc(step.name || 'Step')}</div><div class="fv-items-sub">${esc(res.name)}</div></div><button type="button" class="fv-item-x" aria-label="Close" onclick="OL.fvCloseStepItems()">&#10005;</button></div>
    <div class="fv-items-list">${items.length ? items.map((i) => itemRowHtml(res.id, step.id, i)).join('') : '<div class="fv-items-empty">Nothing yet. Add a question to ask, an action to assign, or a note.</div>'}</div>
    <div class="fv-items-add"><div class="fv-items-pills">${kindPills}</div>${starters}
      <div class="fv-items-row" style="position:relative;"><div id="fv-items-mention" class="fv-mention-list" style="display:none;"></div><input id="fv-items-text" class="fv-items-in grow" type="text" autocomplete="off" placeholder="${popState.kind === 'question' ? 'Ask it the way you would in the session' : popState.kind === 'action' ? 'What needs to happen' : 'Jot a note'} (@ to tag someone)" oninput="OL.fvItemMentionInput(this)" onkeydown="if(OL.fvItemMentionKey(event)){event.preventDefault();return;} if(event.key==='Enter'){event.preventDefault();OL.fvItemAdd('${esc(res.id)}','${esc(step.id)}')}"><button type="button" class="fv-items-go" onclick="OL.fvItemAdd('${esc(res.id)}','${esc(step.id)}')">Add</button></div>${actionRow}</div>`;
}

export function openStepItems(resId, stepId, ev) {
  const res = resById(resId); const step = stepOf(res, stepId); if (!step) return;
  closeStepItems();
  const pop = document.createElement('div');
  pop.id = 'fv-items-pop'; pop.className = 'fv-items-pop'; pop.dataset.res = resId; pop.dataset.step = stepId;
  pop.innerHTML = popHtml(res, step);
  document.body.appendChild(pop);
  const anchor = ev && ev.target && ev.target.closest ? (ev.target.closest('.fv-step-card, .fv-list-item, .fv-flag') || ev.target) : null;
  const r = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: 120, right: 420, top: 120, bottom: 160 };
  const w = 340; const left = r.right + 10 + w > window.innerWidth ? Math.max(8, r.left - w - 10) : r.right + 10;
  pop.style.left = `${Math.max(8, left)}px`; pop.style.top = `${Math.max(8, Math.min(r.top, window.innerHeight - 420))}px`;
  setTimeout(() => { document.getElementById('fv-items-text')?.focus(); }, 0);
  setTimeout(() => document.addEventListener('mousedown', outside, true), 0);
}
function outside(e) {
  const pop = document.getElementById('fv-items-pop');
  if (!pop) { document.removeEventListener('mousedown', outside, true); return; }
  if (pop.contains(e.target) || (e.target.closest && e.target.closest('.fv-flag'))) return;
  closeStepItems();
}
export function closeStepItems() { document.getElementById('fv-items-pop')?.remove(); document.removeEventListener('mousedown', outside, true); }
function rePop() {
  const pop = document.getElementById('fv-items-pop'); if (!pop) return;
  const res = resById(pop.dataset.res); const step = stepOf(res, pop.dataset.step); if (!step) { closeStepItems(); return; }
  const keep = { text: document.getElementById('fv-items-text')?.value || '', who: document.getElementById('fv-items-who')?.value || '', due: document.getElementById('fv-items-due')?.value || '', owner: document.getElementById('fv-items-owner')?.value || '' };
  pop.innerHTML = popHtml(res, step);
  const set = (id, v) => { const e = document.getElementById(id); if (e && v) e.value = v; };
  set('fv-items-text', keep.text); set('fv-items-who', keep.who); set('fv-items-due', keep.due); set('fv-items-owner', keep.owner);
}
export function itemKind(resId, stepId, kind) { popState.kind = KIND[kind] ? kind : 'question'; rePop(); document.getElementById('fv-items-text')?.focus(); }
export function itemStarter(resId, stepId, n) {
  const step = stepOf(resById(resId), stepId); if (!step) return;
  const input = document.getElementById('fv-items-text'); if (!input) return;
  input.value = QUESTION_STARTERS[n].replace('{step}', step.name || 'this step'); input.focus();
}
export function itemAdd(resId, stepId) {
  const text = document.getElementById('fv-items-text')?.value || '';
  if (!String(text).trim()) { document.getElementById('fv-items-text')?.focus(); return; }
  addItem(resId, stepId, { kind: popState.kind, text, owner: document.getElementById('fv-items-owner')?.value || '', who: document.getElementById('fv-items-who')?.value || '', due: document.getElementById('fv-items-due')?.value || '' });
  const pop = document.getElementById('fv-items-pop'); if (pop) { pop.innerHTML = popHtml(resById(resId), stepOf(resById(resId), stepId)); document.getElementById('fv-items-text')?.focus(); }
  renderDrawer();
}
export function itemSet(resId, stepId, itemId, field, value) {
  updateItem(resId, stepId, itemId, { [field]: value });
  if (field === 'done') { rePop(); renderDrawer(); }
}
export function itemRemove(resId, stepId, itemId) { removeItem(resId, stepId, itemId); rePop(); renderDrawer(); }
export function itemMakeTask(resId, stepId, itemId) { if (makeTask(resId, stepId, itemId)) { toast('Task created in the task list.'); rePop(); renderDrawer(); } }

// ---- the list of everything --------------------------------------------------------------------------------------
let drawerState = { show: 'open', kind: 'all' };
const fmtDue = (d) => { if (!d) return ''; const x = new Date(`${d}T00:00:00`); return Number.isNaN(x.getTime()) ? d : x.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); };

export function itemsText(entries, { title = 'Questions and Action Items', sub = '' } = {}) {
  const lines = [title]; if (sub) lines.push(sub); lines.push('');
  KINDS.forEach((k) => {
    const group = entries.filter((e) => e.kind === k.key); if (!group.length) return;
    lines.push(k.plural);
    group.forEach((e) => {
      const who = e.kind === 'action' ? [e.item.owner ? (OWNERS[e.item.owner]?.label || e.item.owner) : '', e.item.who || '', e.item.due ? `due ${fmtDue(e.item.due)}` : ''].filter(Boolean).join(', ') : '';
      lines.push(`${e.label}. ${e.item.text}${who ? ` (${who})` : ''}  [${e.res.name} > ${e.step.name || 'step'}]`);
    });
    lines.push('');
  });
  return lines.join('\n').trim();
}

function drawerEntries() {
  let list = collectItems();
  if (drawerState.show === 'open') list = list.filter((e) => !e.item.done);
  else if (drawerState.show === 'done') list = list.filter((e) => e.item.done);
  if (drawerState.kind !== 'all') list = list.filter((e) => e.kind === drawerState.kind);
  return list;
}
function drawerHtml() {
  const all = collectItems(); const open = all.filter((e) => !e.item.done);
  const shown = drawerEntries();
  const pill = (group, key, label) => `<button type="button" class="fv-items-pill ${drawerState[group] === key ? 'on' : ''}" onclick="OL.fvItemsFilter('${group}','${key}')">${esc(label)}</button>`;
  const groups = KINDS.map((k) => {
    const g = shown.filter((e) => e.kind === k.key); if (!g.length) return '';
    return `<div class="fv-drawer-group"><div class="fv-drawer-gtitle" style="--c:${k.color}">${esc(k.plural)} <span>${g.length}</span></div>${g.map((e) => `<div class="fv-drawer-row ${e.item.done ? 'is-done' : ''}">
        <input type="checkbox" ${e.item.done ? 'checked' : ''} aria-label="Done" onchange="OL.fvItemSet('${esc(e.res.id)}','${esc(e.step.id)}','${esc(e.item.id)}','done',this.checked)">
        <div class="fv-drawer-body"><div><b class="fv-drawer-no" style="--c:${k.color}">${esc(e.label)}</b> ${esc(e.item.text)}</div>
          <div class="fv-drawer-meta"><button type="button" class="fv-item-link" onclick="OL.fvJumpToStep('${esc(e.res.id)}','${esc(e.step.id)}')">${esc(e.res.name)} &rsaquo; ${esc(e.step.name || 'step')}</button>${e.kind === 'action' ? `${e.item.owner ? `<span class="fv-item-owner" style="--c:${OWNERS[e.item.owner]?.color || '#9fb0c4'}">${esc(OWNERS[e.item.owner]?.label || e.item.owner)}</span>` : ''}${e.item.who ? `<span>${esc(e.item.who)}</span>` : ''}${e.item.due ? `<span>Due ${esc(fmtDue(e.item.due))}</span>` : ''}${e.item.taskId ? '<span class="fv-item-task">Task created</span>' : (e.item.id !== 'legacy' ? `<button type="button" class="fv-item-link" onclick="OL.fvItemMakeTask('${esc(e.res.id)}','${esc(e.step.id)}','${esc(e.item.id)}')">Create task</button>` : '')}` : ''}</div></div>
        <button type="button" class="fv-item-x" title="Open the step's list" aria-label="Edit" onclick="OL.fvOpenStepItems('${esc(e.res.id)}','${esc(e.step.id)}', event)">&#9998;</button></div>`).join('')}</div>`;
  }).join('');
  const noOwner = stepsWithNoOwner().length;
  const untasked = open.filter((e) => e.kind === 'action' && !e.item.taskId && e.item.id !== 'legacy').length;
  return `<div class="fv-drawer-head"><div><div class="fv-items-title">Questions &amp; action items</div><div class="fv-items-sub">${open.length} open &middot; ${all.length - open.length} done</div></div><button type="button" class="fv-item-x" aria-label="Close" onclick="OL.fvCloseItemsDrawer()">&#10005;</button></div>
    <div class="fv-drawer-filters">${pill('show', 'open', 'Open')}${pill('show', 'all', 'All')}${pill('show', 'done', 'Done')}<span class="fv-drawer-sep"></span>${pill('kind', 'all', 'Everything')}${KINDS.map((k) => pill('kind', k.key, k.plural)).join('')}</div>
    <div class="fv-drawer-list">${groups || `<div class="fv-items-empty">${all.length ? 'Nothing matches this filter.' : 'No questions or action items yet. Click the + on any step, or add a "Who completes this step" question to every step with no owner.'}</div>`}</div>
    <div class="fv-drawer-foot">
      <button type="button" class="fv-items-go" onclick="OL.fvCopyItems()">Copy as text</button>
      <button type="button" class="fv-items-go alt" ${noOwner ? '' : 'disabled'} onclick="OL.fvAddWhoQuestions()" title="Adds \u201cWho completes this step: \u2026?\u201d to every step that has no owner">Ask who completes ${noOwner ? `(${noOwner} steps)` : ''}</button>
      <button type="button" class="fv-items-go alt" ${untasked ? '' : 'disabled'} onclick="OL.fvMakeAllTasks()">Create tasks ${untasked ? `(${untasked})` : ''}</button></div>`;
}
export function renderDrawer() { const d = document.getElementById('fv-items-drawer'); if (d) { const keep = d.querySelector('.fv-drawer-list')?.scrollTop || 0; d.innerHTML = drawerHtml(); const l = d.querySelector('.fv-drawer-list'); if (l) l.scrollTop = keep; } updateToolbarCount(); }
// The step editor docks on the right of the flow map. The list sits to the left of it while it is open, so clicking a
// card shows the editor instead of opening it behind the list.
export function positionDrawer() {
  const d = document.getElementById('fv-items-drawer'); if (!d) return;
  const insp = document.getElementById('v2-inspector-panel') || document.getElementById('inspector-panel');
  const w = insp && insp.classList.contains('open') ? Math.max(insp.offsetWidth || 0, 380) : 0;
  d.style.right = `${w}px`; d.style.maxWidth = `calc(100vw - ${w}px)`;
}
export function toggleDrawer() {
  const d = document.getElementById('fv-items-drawer');
  if (d) { d.remove(); return; }
  const el = document.createElement('div'); el.id = 'fv-items-drawer'; el.className = 'fv-items-drawer'; el.innerHTML = drawerHtml();
  document.body.appendChild(el);
  positionDrawer();
}
export const closeDrawer = () => document.getElementById('fv-items-drawer')?.remove();
export function itemsFilter(group, key) { drawerState[group] = key; renderDrawer(); }
export async function copyItems() {
  const client = getActiveClient && getActiveClient();
  const text = itemsText(collectItems().filter((e) => !e.item.done), { sub: `${client?.meta?.name || 'Flow map'}  |  ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}` });
  try { await navigator.clipboard.writeText(text); toast('Copied. Paste it into an email or your notes.'); }
  catch (e) { window.prompt('Copy this list:', text); }
}
export function makeAllTasks() {
  const list = collectItems().filter((e) => !e.item.done && e.kind === 'action' && !e.item.taskId && e.item.id !== 'legacy');
  if (!list.length) return;
  if (!confirm(`Create ${list.length} task${list.length === 1 ? '' : 's'} in the task list from the open action items?`)) return;
  list.forEach((e) => makeTask(e.res.id, e.step.id, e.item.id));
  renderDrawer(); toast(`Created ${list.length} task${list.length === 1 ? '' : 's'}.`);
}

// ---- the printed list --------------------------------------------------------------------------------------------
// The pages that end the printout. entries: collectItems() (open items only are printed; done ones are listed last).
export function itemsAppendixHtml(entries, { title = 'Questions and Action Items', sub = '' } = {}) {
  const open = entries.filter((e) => !e.item.done); const done = entries.filter((e) => e.item.done);
  if (!entries.length) return '';
  const row = (e) => {
    const k = KIND[e.kind] || KIND.note;
    const who = e.kind === 'action' ? [e.item.owner ? (OWNERS[e.item.owner]?.label || e.item.owner) : '', e.item.who || ''].filter(Boolean).join(', ') : '';
    return `<tr class="apx-row"><td class="apx-no">${esc(e.label)}</td><td class="apx-text">${esc(e.item.text)}<div class="apx-where">${esc(e.res.name)} &rsaquo; ${esc(e.step.name || 'step')}${e.workflow && e.workflow !== e.res.name ? ` &middot; ${esc(e.workflow)}` : ''}</div>${e.kind === 'question' ? '<div class="apx-ans"></div>' : ''}</td>${e.kind === 'action' ? `<td class="apx-who">${esc(who) || '&nbsp;'}</td><td class="apx-due">${e.item.due ? esc(fmtDue(e.item.due)) : '&nbsp;'}</td><td class="apx-box"><span></span></td>` : ''}</tr>`;
  };
  const section = (k) => {
    const g = open.filter((e) => e.kind === k.key); if (!g.length) return '';
    const head = k.key === 'action' ? '<tr class="apx-th"><th></th><th>Action item</th><th>Owner</th><th>Due</th><th>Done</th></tr>' : `<tr class="apx-th"><th></th><th>${k.key === 'question' ? 'Question' : 'Note'}</th></tr>`;
    return `<div class="apx-group"><h2 class="apx-h2" style="border-color:${k.color}">${esc(k.plural)} <span>${g.length}</span></h2><table class="apx-table">${head}${g.map(row).join('')}</table></div>`;
  };
  const doneHtml = done.length ? `<div class="apx-group"><h2 class="apx-h2 muted">Closed since the last review <span>${done.length}</span></h2><table class="apx-table">${done.map((e) => `<tr class="apx-row done"><td class="apx-no">${esc(e.label)}</td><td class="apx-text">${esc(e.item.text)}<div class="apx-where">${esc(e.res.name)} &rsaquo; ${esc(e.step.name || 'step')}</div></td></tr>`).join('')}</table></div>` : '';
  return `<section class="apx"><div class="apx-head"><span class="apx-title">${esc(title)}</span><span class="apx-sub">${esc(sub)}</span></div>
    ${KINDS.map(section).join('')}${doneHtml}
    <div class="apx-group"><h2 class="apx-h2" style="border-color:#94a3b8">Notes from the session</h2><div class="apx-lines"><i></i><i></i><i></i><i></i><i></i><i></i></div></div></section>`;
}

function toast(t) { if (typeof OL().showToast === 'function') OL().showToast(t); else console.info(t); }

window.OL = window.OL || {};
Object.assign(window.OL, {
  fvFlagHtml: flagHtml, fvItemsOf: itemsOf, fvCollectItems: collectItems, fvNumberItems: numberItems, fvItemsAppendixHtml: itemsAppendixHtml, fvItemsText: itemsText,
  fvOpenStepItems: openStepItems, fvCloseStepItems: closeStepItems, fvItemKind: itemKind, fvItemStarter: itemStarter, fvItemAdd: itemAdd, fvItemMentionInput: mentionInput, fvItemMentionPick: mentionPick, fvItemMentionKey: mentionKey, fvItemSet: itemSet,
  fvItemRemove: itemRemove, fvItemMakeTask: itemMakeTask, fvToggleItemsDrawer: toggleDrawer, fvCloseItemsDrawer: closeDrawer, fvItemsFilter: itemsFilter,
  fvCopyItems: copyItems, fvAddWhoQuestions: addWhoQuestions, fvMakeAllTasks: makeAllTasks, fvItemsOpenCount: openCount, fvRefreshItemFlags: updateToolbarCount, fvPositionItemsDrawer: positionDrawer,
});
