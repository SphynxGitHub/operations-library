// ================================================================================================
// FILE: features/frameout.js
//
// WHAT IT DOES:   Frame-out: a full-screen way to frame a process out quickly, live on a call or afterwards from notes. One
//                 line to type in; each Enter adds a step to a chain that draws itself. Who does a step (@client, @us...),
//                 a question to confirm (a ? after the step) and a yes / no decision (/if) are typed in the same line. The
//                 steps are saved as a draft Process card on the flow map as they are added, so nothing is lost if the call
//                 ends or the tab closes. "By who" lays the same steps out in a lane for each person, which shows the handoffs.
//                 The same one-line add is available inside a draft card on the map and in the list view (foInlineAdd).
//
// WHERE THE DATA GOES:  a resource { type: 'Process', isDraft: true, steps: [...] } in the project's library. Its steps are
//                 ordinary steps (core/frameout.js has the exact shape), so the map, the list and every other tool already read them.
//
// LOGIC: core/frameout.js (parsing, branching, links, layout). This file is the screen only.
// USED BY: the "Frame out" button on the flow map (features/flow-visualizer/core.js).
// ================================================================================================

import { esc, getActiveClient, persist, markClientDirty } from '../core/data.js';
import {
  OWNERS, OWNER_ORDER, parseFrameLine, applyFrameLine, deriveLinks, layoutChain, questionsOf, handoffsOf, unassignedCount,
  followUpText, repairBranches, placeProcessCard, assigneesFor, contextOf,
} from '../core/frameout.js';

const OVERLAY_ID = 'frameout-overlay';
const rand = () => Math.random().toString(36).slice(2, 10);
const PANEL_W = 360;

const PROMPTS = ['What kicks this off?', 'What happens next?', 'Who does that?', 'Any exceptions?', 'Who needs to be told?', 'What is the end result?'];

const pd = () => (OL.getCurrentProjectData ? OL.getCurrentProjectData() : null);
const library = () => { const d = pd(); return d ? (d.localResources = d.localResources || []) : []; };
const cardOf = (id) => library().find((r) => String(r.id) === String(id));
const toast = (t) => { if (typeof OL.showToast === 'function') OL.showToast(t); else console.info(t); };

OL._foSessions = OL._foSessions || {};         // { cardId: { ctx } }: where the next step goes (a decision's Yes / No path, or the main line)
const sessionOf = (resId) => (OL._foSessions[resId] = OL._foSessions[resId] || {});

// ---- saving: every change is written to the card, derived lines included, then saved ----------------------------
function commit(card, { redraw = true } = {}) {
  repairBranches(card.steps);
  deriveLinks(card.steps, card.id);
  const client = getActiveClient();
  if (client) markClientDirty(client.id);
  persist();
  if (redraw) render();
}

function createCard(name) {
  const d = pd();
  const card = {
    id: `local-prj-proc-${rand()}`, type: 'Process', archetype: 'Multi-Step', name: name || 'New process', source: 'frameout',
    isDraft: true, status: 'Pending', isExpanded: true, visible: true, steps: [], createdDate: new Date().toISOString(),
  };
  library().push(card);
  placeProcessCard(d, card, { makeId: rand });
  return card;
}

// ---- open / close ----------------------------------------------------------------------------------------------
function openFrameOut(resId) {
  if (window.location.hash.includes('vault')) { alert('Frame-out works inside a client project. Open a project first.'); return; }
  const client = getActiveClient();
  if (!client) { alert('Open a project first.'); return; }
  let card = resId ? cardOf(resId) : null;
  const created = !card;
  if (!card) { card = createCard('New process'); if (client) markClientDirty(client.id); }
  OL._fo = { resId: card.id, mode: 'chain', selectedId: null, msg: '', prompt: '', created, input: '' };
  OL._foSessions[card.id] = {};                 // reopening starts from where the last step left off
  document.getElementById(OVERLAY_ID)?.remove();
  const el = document.createElement('div');
  el.id = OVERLAY_ID; el.className = 'fo-overlay';
  document.body.appendChild(el);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', onResize);
  render({ focus: true });
}

function closeFrameOut({ keep = true } = {}) {
  const fo = OL._fo; if (!fo) return;
  const card = cardOf(fo.resId);
  // a process that was opened and never given a step leaves nothing behind
  if (card && fo.created && !card.steps.length && keep) { removeCard(card); }
  document.getElementById(OVERLAY_ID)?.remove();
  document.removeEventListener('keydown', onKey, true);
  window.removeEventListener('resize', onResize);
  OL._fo = null;
  if (window.location.hash.includes('visualizer') && typeof OL.renderVisualizer === 'function') OL.renderVisualizer(false);
}

function removeCard(card) {
  const d = pd();
  const i = library().indexOf(card); if (i >= 0) library().splice(i, 1);
  (d.workflows || []).forEach((w) => { w.resourceIds = (w.resourceIds || []).filter((x) => String(x) !== String(card.id)); });
  const client = getActiveClient(); if (client) markClientDirty(client.id);
  persist();
}

async function saveAndShow() {
  const fo = OL._fo; const card = fo && cardOf(fo.resId); if (!card) return;
  if (!card.steps.length) { toast('Add at least one step first.'); return; }
  commit(card, { redraw: false });
  OL._fv = OL._fv || {};
  (OL._fv._expandedCards = OL._fv._expandedCards instanceof Set ? OL._fv._expandedCards : new Set()).add(card.id);
  const wasOnMap = window.location.hash.includes('visualizer');
  closeFrameOut({ keep: false });
  toast(`“${card.name}” is on the flow map as a draft.`);
  if (!wasOnMap) window.location.hash = '#/visualizer';
  else if (typeof OL.renderVisualizer === 'function') OL.renderVisualizer();
}

function onKey(e) {
  if (e.key === 'Escape' && OL._fo) {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) { t.blur(); e.stopPropagation(); }
    else if (OL._fo.selectedId) { OL._fo.selectedId = null; render(); }
  }
}
let resizeTimer = null;
function onResize() { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => OL._fo && render(), 150); }

// ---- the line you type ------------------------------------------------------------------------------------------
function submit() {
  const fo = OL._fo; const card = cardOf(fo.resId); if (!card) return;
  const input = document.getElementById('fo-input');
  const text = input ? input.value : '';
  const res = applyFrameLine(card.steps, parseFrameLine(text), rand, sessionOf(card.id));
  fo.msg = res.message || '';
  if (!res.ok) { fo.input = text; render({ focus: true }); return; }
  fo.input = ''; fo.prompt = '';
  commit(card, { redraw: false });
  render({ focus: true, scrollToEnd: !!res.step });
}

function setPrompt(text) { if (!OL._fo) return; OL._fo.prompt = text; const i = document.getElementById('fo-input'); if (i) { i.placeholder = text; i.focus(); } }
function setMode(mode) { if (!OL._fo) return; OL._fo.mode = mode; OL._fo.selectedId = null; render({ focus: true }); }
function select(id) { if (!OL._fo) return; OL._fo.selectedId = OL._fo.selectedId === id ? null : id; render({ keepInput: true }); }
function rename(value) { const card = cardOf(OL._fo?.resId); if (!card) return; card.name = String(value || '').trim() || 'New process'; commit(card, { redraw: false }); }

// ---- editing the selected step ------------------------------------------------------------------------------------
const selectedStep = () => { const fo = OL._fo; const card = fo && cardOf(fo.resId); return card ? card.steps.find((s) => s.id === fo.selectedId) : null; };
function editStep(field, value) {
  const card = cardOf(OL._fo?.resId); const s = selectedStep(); if (!card || !s) return;
  if (field === 'name') { const v = String(value || '').trim(); if (v) s.name = v; }
  else if (field === 'owner') { s.owner = value || ''; s.assignees = value ? assigneesFor(value) : []; }
  else if (field === 'tool') { s.appName = String(value || '').trim(); }
  else if (field === 'question') {
    const v = String(value || '').trim();
    if (v) s.question = { text: v, done: false }; else delete s.question;
  } else if (field === 'toggleQuestion') { if (s.question) delete s.question; else s.question = { text: `Confirm: ${s.name}`, done: false }; }
  commit(card, { redraw: true });
}
function markAnswered(id) { const card = cardOf(OL._fo?.resId); const s = card && card.steps.find((x) => x.id === id); if (!s || !s.question) return; s.question.done = true; commit(card); }

function moveStep(dir) {
  const card = cardOf(OL._fo?.resId); const s = selectedStep(); if (!card || !s) return;
  const i = card.steps.indexOf(s); const j = i + dir;
  if (j < 0 || j >= card.steps.length) return;
  const before = card.steps.map((x) => `${x.id}:${x.branchOf || ''}:${x.path || ''}`).join('|');
  const next = card.steps.slice(); [next[i], next[j]] = [next[j], next[i]];
  const probe = next.map((x) => ({ ...x }));
  repairBranches(probe);
  const changed = probe.some((x, k) => (x.branchOf || '') !== (next[k].branchOf || ''));
  if (changed) { OL._fo.msg = 'That step belongs to the decision above it, so it cannot move above it.'; render({ keepInput: true }); return; }
  card.steps = next;
  void before;
  commit(card);
}

function deleteStep() {
  const card = cardOf(OL._fo?.resId); const s = selectedStep(); if (!card || !s) return;
  const wasDecision = s.kind === 'decision';
  card.steps = card.steps.filter((x) => x.id !== s.id);
  OL._fo.selectedId = null;
  if (wasDecision) OL._fo.msg = 'Decision removed. Its steps are now on the main line.';
  sessionOf(card.id).ctx = undefined;
  commit(card);
}

function deleteProcess() {
  const card = cardOf(OL._fo?.resId); if (!card) return;
  if (!confirm(`Delete “${card.name}” and its ${card.steps.length} draft step${card.steps.length === 1 ? '' : 's'}?`)) return;
  removeCard(card); OL._fo.created = false; closeFrameOut({ keep: false });
}

async function copyFollowUp() {
  const card = cardOf(OL._fo?.resId); if (!card) return;
  const client = getActiveClient();
  const text = followUpText(card.name, card.steps, '');
  if (!text) { toast('No open questions.'); return; }
  try { await navigator.clipboard.writeText(text); toast('Questions copied. Paste them into an email.'); }
  catch (e) { window.prompt('Copy these questions:', text); }
  void client;
}

// ---- drawing -------------------------------------------------------------------------------------------------------
const ownerTag = (o) => (o && OWNERS[o] ? `<b class="fo-owner" style="color:${OWNERS[o].color}">${OWNERS[o].short}</b>` : '<b class="fo-owner fo-owner-none">NO OWNER YET</b>');

function nodeHtml(n, s, sel) {
  const q = s.question && !s.question.done ? '<span class="fo-qbadge" title="To confirm">?</span>' : '';
  const tool = s.appName ? `<span class="fo-tool">${esc(s.appName)}</span>` : '';
  const cls = ['fo-node', s.kind === 'decision' ? 'is-decision' : '', sel ? 'is-sel' : '', s.question && !s.question.done ? 'has-q' : ''].filter(Boolean).join(' ');
  const inner = s.kind === 'decision' ? `<span class="fo-text">${esc(s.name)}</span>` : `<span class="fo-text">${ownerTag(s.owner)}<br>${esc(s.name)}</span>${tool}`;
  return `<div class="${cls}" data-id="${esc(s.id)}" style="left:${n.x}px;top:${n.y}px;width:${n.w}px;height:${n.h}px;" onclick="OL.foSelect('${esc(s.id)}')" tabindex="0" role="button" aria-label="${esc(s.name)}" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();OL.foSelect('${esc(s.id)}')}">${inner}${q}</div>`;
}

function pathD(points, r = 10) {
  // a polyline with softly rounded corners
  if (points.length < 2) return '';
  let d = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [x0, y0] = points[i - 1]; const [x1, y1] = points[i]; const [x2, y2] = points[i + 1];
    const l1 = Math.hypot(x1 - x0, y1 - y0); const l2 = Math.hypot(x2 - x1, y2 - y1);
    const rr = Math.min(r, l1 / 2, l2 / 2);
    const ax = x1 - ((x1 - x0) / l1) * rr, ay = y1 - ((y1 - y0) / l1) * rr;
    const bx = x1 + ((x2 - x1) / l2) * rr, by = y1 + ((y2 - y1) / l2) * rr;
    d += ` L ${ax} ${ay} Q ${x1} ${y1} ${bx} ${by}`;
  }
  const last = points[points.length - 1]; d += ` L ${last[0]} ${last[1]}`;
  return d;
}

function canvasHtml(card, fo, availW) {
  const steps = card.steps;
  if (!steps.length) {
    return `<div class="fo-empty"><div class="fo-empty-title">Start with what kicks this process off</div><div class="fo-empty-sub">Type a step below and press Enter. Add <code>@client</code> or <code>@us</code> to say who does it, a <code>?</code> to flag something to confirm, and <code>/if</code> for a decision.</div></div>`;
  }
  const colW = 216 + 56;
  const maxCols = Math.max(2, Math.min(6, Math.floor((availW - 80 + 56) / colW)));
  const L = layoutChain(steps, fo.mode, { maxCols });
  const scale = fo.mode === 'who' ? Math.max(0.62, Math.min(1, availW / L.width)) : Math.min(1, availW / L.width);
  const byId = new Map(steps.map((s) => [s.id, s]));
  const lanesHtml = fo.mode === 'who' ? L.lanes.map((lane, i) => {
    const o = OWNERS[lane]; const label = o ? o.short : 'NO OWNER YET'; const col = o ? o.color : '#9fb0c4';
    return `<div class="fo-lane ${i % 2 ? 'odd' : ''}" style="top:${L.laneTop(i)}px;height:${L.laneH}px;width:${L.width}px"><span class="fo-lane-label" style="color:${col}">${label}</span></div>`;
  }).join('') : '';
  const lines = L.lines.map((l) => `<path d="${pathD(l.points)}" class="fo-line ${l.crossLane ? 'handoff' : ''}" marker-end="url(#fo-arrow)"></path>`).join('');
  const labels = L.lines.filter((l) => l.rule).map((l) => {
    const [x, y] = l.points[0]; const [x1, y1] = l.points[1];
    const vertical = Math.abs(x1 - x) < 1;
    const lx = vertical ? x + 10 : x + 8; const ly = vertical ? y + 6 : y - 22;
    return `<span class="fo-rule" style="left:${lx}px;top:${ly}px">${esc(l.rule)}</span>`;
  }).join('');
  const nodes = L.nodes.map((n) => nodeHtml(n, byId.get(n.id), fo.selectedId === n.id)).join('');
  return `<div class="fo-canvas-sizer" style="width:${L.width * scale}px;height:${L.height * scale}px"><div class="fo-canvas" style="width:${L.width}px;height:${L.height}px;transform:scale(${scale});transform-origin:0 0">
    ${lanesHtml}
    <svg class="fo-lines" width="${L.width}" height="${L.height}" viewBox="0 0 ${L.width} ${L.height}" aria-hidden="true"><defs><marker id="fo-arrow" orient="auto" markerWidth="6" markerHeight="6" refX="4" refY="2.5" overflow="visible"><path d="M0 0 L5 2.5 L0 5 Z" fill="context-stroke"/></marker></defs>${lines}</svg>
    ${labels}${nodes}</div></div>`;
}

function panelHtml(card, fo) {
  const qs = questionsOf(card.steps);
  const s = selectedStep();
  let editor = '';
  if (s) {
    const ownerBtns = OWNER_ORDER.map((o) => `<button type="button" class="fo-pill ${s.owner === o ? 'on' : ''}" style="--c:${OWNERS[o].color}" onclick="OL.foEdit('owner','${o}')">${OWNERS[o].label}</button>`).join('')
      + `<button type="button" class="fo-pill ${!s.owner ? 'on' : ''}" onclick="OL.foEdit('owner','')">None</button>`;
    editor = `<div class="fo-panel-card">
      <div class="fo-panel-head"><span>${s.kind === 'decision' ? 'Decision' : 'Step'}</span><button type="button" class="fo-x" aria-label="Close" onclick="OL.foSelect('${esc(s.id)}')">Close</button></div>
      <label class="fo-lbl" for="fo-edit-name">What happens</label>
      <input id="fo-edit-name" class="fo-field" type="text" value="${esc(s.name)}" onchange="OL.foEdit('name', this.value)">
      ${s.kind === 'decision' ? '' : `<div class="fo-lbl">Who does it</div><div class="fo-pills">${ownerBtns}</div>
      <label class="fo-lbl" for="fo-edit-tool">Tool (a guess is fine)</label>
      <input id="fo-edit-tool" class="fo-field" type="text" value="${esc(s.appName || '')}" placeholder="e.g. Redtail, Jotform" onchange="OL.foEdit('tool', this.value)">`}
      <label class="fo-lbl" for="fo-edit-q">To confirm with the client</label>
      <input id="fo-edit-q" class="fo-field" type="text" value="${esc(s.question ? s.question.text : '')}" placeholder="Leave empty if there is nothing to confirm" onchange="OL.foEdit('question', this.value)">
      <div class="fo-row"><button type="button" class="fo-btn" onclick="OL.foMove(-1)">Move earlier</button><button type="button" class="fo-btn" onclick="OL.foMove(1)">Move later</button><button type="button" class="fo-btn danger" onclick="OL.foDeleteStep()">Delete</button></div>
    </div>`;
  }
  const items = qs.length ? qs.map((q) => `<div class="fo-q"><button type="button" class="fo-q-dot" title="Mark as answered" aria-label="Mark as answered" onclick="OL.foAnswered('${esc(q.id)}')"></button>
      <div><div class="fo-q-text">${esc(q.text)}</div><div class="fo-q-from">From: ${esc(q.step)}</div></div></div>`).join('') : '<div class="fo-muted">Nothing to confirm yet. Put a <b>?</b> after a step, like <code>Prepares the packet ? who signs off</code>.</div>';
  const none = unassignedCount(card.steps);
  const hand = handoffsOf(card.steps);
  const stats = `<div class="fo-stats">${hand ? `<span class="fo-chip">${hand} handoff${hand === 1 ? '' : 's'}</span>` : ''}${none ? `<span class="fo-chip warn">${none} step${none === 1 ? '' : 's'} with no owner</span>` : ''}</div>`;
  return `<aside class="fo-panel" aria-label="Details">
    ${editor}
    <div class="fo-panel-card">
      <div class="fo-panel-head"><span>To confirm</span><span class="fo-count">${qs.length}</span></div>
      ${items}
      ${qs.length ? '<button type="button" class="fo-btn wide" onclick="OL.foCopyFollowUp()">Copy as a follow-up email</button>' : ''}
    </div>
    ${stats}
    <div class="fo-panel-foot"><button type="button" class="fo-link" onclick="OL.foDeleteProcess()">Delete this process</button></div>
  </aside>`;
}

function render(opts = {}) {
  const el = document.getElementById(OVERLAY_ID); const fo = OL._fo;
  if (!el || !fo) return;
  const card = cardOf(fo.resId); if (!card) { closeFrameOut({ keep: false }); return; }
  const prevInput = document.getElementById('fo-input');
  const typed = opts.keepInput && prevInput ? prevInput.value : fo.input;
  const availW = Math.max(480, window.innerWidth - PANEL_W - 64);
  const qs = questionsOf(card.steps);
  const ctx = (OL._foSessions[card.id] || {}).ctx !== undefined ? OL._foSessions[card.id].ctx : contextOf(card.steps);
  const openDecision = ctx ? card.steps.find((x) => x.id === ctx.decisionId) : null;
  const seg = (t, m) => `<button type="button" class="fo-seg ${fo.mode === m ? 'on' : ''}" onclick="OL.foSetMode('${m}')" aria-pressed="${fo.mode === m}">${t}</button>`;
  const banner = fo.msg ? `<div class="fo-msg" role="status">${esc(fo.msg)}</div>` : '';
  const pathBar = openDecision ? `<div class="fo-pathbar">Adding the <b>${ctx.path === 'no' ? 'No' : 'Yes'}</b> path of “${esc(openDecision.name)}”
      ${ctx.path === 'yes' ? '<button type="button" class="fo-btn small" onclick="OL.foCommand(\'/no\')">Switch to No</button>' : ''}<button type="button" class="fo-btn small" onclick="OL.foCommand(\'/join\')">Back to the main line</button></div>` : '';
  el.innerHTML = `
    <div class="fo-top">
      <div class="fo-top-l"><button type="button" class="fo-btn" onclick="OL.foClose()">Exit</button>
        <input class="fo-title" type="text" value="${esc(card.name)}" aria-label="Process name" onchange="OL.foRename(this.value)">
        <span class="fo-draft">DRAFT</span></div>
      <div class="fo-segs" role="group" aria-label="Layout">${seg('Chain', 'chain')}${seg('By who', 'who')}</div>
      <div class="fo-top-r"><span class="fo-note">${qs.length ? `${qs.length} to confirm` : `${card.steps.length} step${card.steps.length === 1 ? '' : 's'}`}</span>
        <button type="button" class="fo-btn primary" onclick="OL.foSave()">Save to flow map</button></div>
    </div>
    <div class="fo-main">
      <div class="fo-stage" id="fo-stage">${canvasHtml(card, fo, availW)}</div>
      ${panelHtml(card, fo)}
    </div>
    <div class="fo-bottom">
      ${banner}${pathBar}
      <div class="fo-prompts"><span class="fo-ask">ASK NEXT</span>${PROMPTS.map((p) => `<button type="button" class="fo-prompt" onclick="OL.foPrompt(${JSON.stringify(p).replace(/"/g, '&quot;')})">${esc(p)}</button>`).join('')}</div>
      <div class="fo-inputrow">
        <label for="fo-input" class="fo-sr">Add a step</label>
        <input id="fo-input" class="fo-input" type="text" autocomplete="off" placeholder="${esc(fo.prompt || (card.steps.length ? 'What happens next?' : 'What kicks this process off?'))}" value="${esc(typed)}" onkeydown="if(event.key==='Enter'){event.preventDefault();OL.foSubmit()}">
        <button type="button" class="fo-btn primary big" onclick="OL.foSubmit()">Add step</button>
      </div>
      <div class="fo-keys"><span><kbd>@client</kbd> <kbd>@us</kbd> <kbd>@system</kbd> who does it</span><span><kbd>?</kbd> flag a question</span><span><kbd>/if</kbd> yes / no decision</span><span><kbd>/no</kbd> <kbd>/join</kbd> switch path</span><span><kbd>Esc</kbd> stop typing</span></div>
    </div>`;
  if (window.lucide) window.lucide.createIcons();
  const input = document.getElementById('fo-input');
  if (opts.focus && input) { input.focus(); const n = input.value.length; try { input.setSelectionRange(n, n); } catch (e) { /* not all inputs */ } }
  if (opts.scrollToEnd) { const stage = document.getElementById('fo-stage'); if (stage) stage.scrollTo({ top: stage.scrollHeight, left: stage.scrollWidth, behavior: 'smooth' }); }
}

// ---- adding a step from inside a draft card on the map or in the list view --------------------------------------------
function inlineAddRowHtml(resId) {
  const id = `fo-inline-${resId}`;
  return `<div class="fo-inline" onclick="event.stopPropagation()">
    <input id="${esc(id)}" class="fo-inline-input" type="text" autocomplete="off" aria-label="Add a draft step" placeholder="Add a step. Enter adds, @client sets who, ? flags a question"
           onclick="event.stopPropagation()" onkeydown="event.stopPropagation(); if(event.key==='Enter'){event.preventDefault();OL.foInlineAdd('${esc(resId)}', this.value)}">
    <button type="button" class="fo-open-btn" onclick="event.stopPropagation(); OL.openFrameOut('${esc(resId)}')">Open in Frame-out</button>
  </div>`;
}

function inlineAdd(resId, text) {
  const card = cardOf(resId); if (!card) return;
  const res = applyFrameLine(card.steps, parseFrameLine(text), rand, sessionOf(card.id));
  if (!res.ok) { if (res.message) toast(res.message); return; }
  if (res.message) toast(res.message);
  repairBranches(card.steps); deriveLinks(card.steps, card.id);
  const client = getActiveClient(); if (client) markClientDirty(client.id);
  persist();
  OL._fv = OL._fv || {};
  (OL._fv._expandedCards = OL._fv._expandedCards instanceof Set ? OL._fv._expandedCards : new Set()).add(card.id);
  if (typeof OL.renderVisualizer === 'function') OL.renderVisualizer(false);
  requestAnimationFrame(() => { const i = document.getElementById(`fo-inline-${resId}`); if (i) i.focus(); });
}

// A step of a draft card, as one row inside the card on the map.
function draftStepBadges(s) {
  const o = s.owner && OWNERS[s.owner] ? `<span class="fo-mini-owner" style="color:${OWNERS[s.owner].color}">${OWNERS[s.owner].short}</span>` : '';
  const q = s.question && !s.question.done ? '<span class="fo-mini-q" title="To confirm">?</span>' : '';
  const d = s.kind === 'decision' ? '<span class="fo-mini-dec">DECISION</span>' : '';
  return d + o + q;
}

window.OL = window.OL || {};
Object.assign(window.OL, {
  openFrameOut, foClose: () => closeFrameOut(), foSave: saveAndShow, foSubmit: submit, foSetMode: setMode, foSelect: select, foRename: rename,
  foEdit: editStep, foMove: moveStep, foDeleteStep: deleteStep, foDeleteProcess: deleteProcess, foAnswered: markAnswered, foCopyFollowUp: copyFollowUp,
  foPrompt: setPrompt, foCommand: (c) => { const i = document.getElementById('fo-input'); if (i) i.value = c; submit(); },
  foInlineAddRow: inlineAddRowHtml, foInlineAdd: inlineAdd, foDraftStepBadges: draftStepBadges,
});
export { openFrameOut };
