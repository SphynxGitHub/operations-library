// ================================================================================================
// FILE: features/flow-visualizer/trace.js
//
// WHAT IT DOES:   The "Questions" panel on the flow map. It answers, in plain steps, what a client (or the team) most
//                 often asks of a process, without reading the whole map:
//
//   When this happens   pick a trigger ("Introductory Meeting Booked") and see, in order, every automation it starts,
//                       each step with the system it touches, and the automations those hand off to. Ends with the
//                       list of systems touched.
//   Where is this used  pick a form, sheet, signature template or other resource and see every step it is linked to,
//                       in journey order (stage, workflow, automation). Steps whose name mentions it but that are not
//                       linked yet are listed apart, each with a Link button.
//   Where does data go  pick a data tag and see every step that carries it. Shows steps only once they are tagged.
//
//   A stage rail along the top lights the stages the answer touches. Every row has "Open in map", which closes the panel and
//   jumps to that step on the map (with the usual Back pill).
//
// READS:          the project's stages, workflows, resources and steps (OL.getCurrentProjectData()). Nothing is stored
//                 for the panel itself, except the Link button, which adds one entry to step.links (the same shape the
//                 step editor writes): { id, name, type }.
// ================================================================================================

const OL = () => window.OL;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = (s) => String(s || '').toLowerCase().replace(/^\[discovered\]\s*/, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const MAX_BLOCKS = 12, MAX_DEPTH = 4;
const RESOURCE_TYPES = ['Form', 'Signature Template', 'Spreadsheet', 'Scheduler', 'Reference', 'Folder'];

// ---- the project, in journey order ------------------------------------------------------------------------------------
function model() {
  const d = OL().getCurrentProjectData() || {};
  const stages = d.stages || [], wfs = d.workflows || [];
  const res = (d.resources || []).filter((r) => r && !r.isDeleted && !r.isLocked);
  const byId = new Map(res.map((r) => [String(r.id), r]));
  const stageIdx = new Map(stages.map((s, i) => [String(s.id), i]));
  const home = new Map();
  wfs.forEach((w, wi) => (w.resourceIds || []).forEach((id, ri) => { if (!home.has(String(id))) home.set(String(id), { w, wi, ri }); }));
  const stageOf = (r) => { const h = home.get(String(r.id)); const sid = (h && h.w.stageId) || r.stageId; return stages.find((s) => String(s.id) === String(sid)) || null; };
  const order = (r) => { const h = home.get(String(r.id)); const st = stageOf(r); return (st ? stageIdx.get(String(st.id)) : 99) * 1e6 + (h ? h.wi : 999) * 1e3 + (h ? h.ri : 999); };
  const wfName = (r) => (home.get(String(r.id)) || { w: { name: '' } }).w.name || '';
  const idsByLength = [...byId.keys()].sort((a, b) => b.length - a.length);
  return { d, stages, res, byId, stageOf, order, wfName, idsByLength };
}

const stepApp = (s) => String(s.appName || (s.zap && s.zap.app) || '').replace(/@.*$/, '').replace(/CLIAPI$/i, '') || '';
const isTrigger = (s, i) => (s.zap && s.zap.role === 'trigger') || i === 0;

// ---- when this happens: triggers, and what each one leads to ------------------------------------------------------------
function eventsOf(m) {
  const groups = new Map();
  m.res.filter((r) => r.type === 'Zap' && (r.steps || []).length && (!r.steps[0].zap || r.steps[0].zap.role === 'trigger')).forEach((r) => {      // only an automation whose first step really is a trigger
    const s0 = r.steps[0], app = stepApp(s0), label = String(s0.name || r.name || '').trim();
    const key = `${norm(label)}|${norm(app)}`;
    if (!groups.has(key)) groups.set(key, { key, label, app, zaps: [] });
    groups.get(key).zaps.push(r);
  });
  const list = [...groups.values()];
  list.forEach((g) => { g.zaps.sort((a, b) => m.order(a) - m.order(b)); g.order = m.order(g.zaps[0]); g.stage = m.stageOf(g.zaps[0]); });
  return list.sort((a, b) => a.order - b.order);
}

// Automations this one hands off to: connections to another automation, and "See another process" jumps.
function handoffs(m, res) {
  const out = new Map();
  const add = (rid, via) => { if (rid && rid !== String(res.id) && m.byId.has(rid) && !out.has(rid)) out.set(rid, via); };
  (res.steps || []).forEach((s) => {
    ((s.logic && s.logic.out) || []).forEach((l) => {
      const t = String(l.targetId || ''); if (!t || t.startsWith(`${res.id}-`)) return;
      add(m.idsByLength.find((k) => t.startsWith(`${k}-`)), l.rule || l.label || s.name || '');
    });
    (s.jumps || []).forEach((j) => add(String(j.resId || ''), j.label || s.name || ''));
    if (s.refResId) add(String(s.refResId), s.refLabel || s.name || '');
  });
  return [...out.entries()];
}

function chainOf(m, roots) {
  const seen = new Set(roots.map((r) => String(r.id)));
  const blocks = roots.map((r) => ({ res: r, via: '', from: null, depth: 0 }));
  const queue = blocks.slice();
  while (queue.length && blocks.length < MAX_BLOCKS) {
    const b = queue.shift();
    if (b.depth >= MAX_DEPTH) continue;
    for (const [rid, via] of handoffs(m, b.res)) {
      if (seen.has(rid) || blocks.length >= MAX_BLOCKS) continue;
      seen.add(rid);
      const nb = { res: m.byId.get(rid), via, from: b.res, depth: b.depth + 1 };
      blocks.push(nb); queue.push(nb);
    }
  }
  return blocks;
}

// ---- where is this used --------------------------------------------------------------------------------------------------
function usageOf(m, target) {
  const nm = norm(target.name), linked = [], mentioned = [];
  m.res.forEach((r) => {
    if (String(r.id) === String(target.id)) return;
    (r.steps || []).forEach((s, i) => {
      const entry = { res: r, step: s, n: i };
      if ((s.links || []).some((l) => String(l.id) === String(target.id))) linked.push(entry);
      else if (nm.length > 5 && norm(`${s.name || ''} ${s.notes || ''}`).includes(nm)) mentioned.push(entry);
    });
  });
  const by = (a, b) => m.order(a.res) - m.order(b.res) || a.n - b.n;
  return { linked: linked.sort(by), mentioned: mentioned.sort(by) };
}

// ---- where does data go --------------------------------------------------------------------------------------------------
function dataTagsOf(m) {
  const tags = new Map();
  m.res.forEach((r) => (r.steps || []).forEach((s, i) => (s.datapoints || []).forEach((dp) => {
    const name = String(dp.name || dp.label || '').trim(); if (!name) return;
    const k = norm(name);
    if (!tags.has(k)) tags.set(k, { key: k, name, entries: [] });
    tags.get(k).entries.push({ res: r, step: s, n: i });
  })));
  return [...tags.values()].sort((a, b) => b.entries.length - a.entries.length || a.name.localeCompare(b.name));
}

// ---- drawing -------------------------------------------------------------------------------------------------------------
const S = () => (OL()._fv._trace = OL()._fv._trace || { view: 'event', sel: '', q: '' });
const stageTag = (m, r) => { const st = m.stageOf(r); return st ? `<span class="fvq-tag">${esc(st.name)}</span>` : ''; };
const jumpBtn = (r, s) => `<button type="button" class="fvq-open" onclick="OL.fvTraceJump('${esc(r.id)}','${esc(s ? s.id : '')}')">Open in map</button>`;

function rail(m, hotStageIds) {
  const hot = new Set([...hotStageIds].map(String));
  const stages = m.stages.filter((s) => !/automation/i.test(s.name || '') || hot.has(String(s.id)));
  return `<div class="fvq-rail">${stages.map((s) => `<div class="fvq-st${hot.has(String(s.id)) ? ' hot' : ''}">${esc(s.name)}</div>`).join('')}</div>`;
}

function stepRows(r) {
  return (r.steps || []).map((s, i) => {
    const sub = String((s.zap && (s.zap.actionLabel || s.zap.summary)) || '').slice(0, 140);
    return `<div class="fvq-row"><div class="fvq-n">${i + 1}</div><div><div><b>${isTrigger(s, i) ? 'Trigger' : 'Step'}</b> &middot; ${esc(s.name || 'Untitled step')}${stepApp(s) ? `<span class="fvq-tag">${esc(stepApp(s))}</span>` : ''}</div>${sub ? `<div class="fvq-sub">${esc(sub)}</div>` : ''}</div>${jumpBtn(r, s)}</div>`;
  }).join('');
}

function eventResult(m, ev) {
  const blocks = chainOf(m, ev.zaps);
  const hot = new Set(blocks.map((b) => m.stageOf(b.res)).filter(Boolean).map((s) => s.id));
  const apps = [...new Set(blocks.flatMap((b) => (b.res.steps || []).filter((s, i) => !isTrigger(s, i)).map(stepApp)).filter(Boolean))];
  const body = blocks.map((b) => `<div class="fvq-block">
      <div class="fvq-bh"><b>${esc(b.res.name)}</b>${m.wfName(b.res) ? `<span class="fvq-tag">${esc(m.wfName(b.res))}</span>` : ''}${stageTag(m, b.res)}</div>
      ${b.from ? `<div class="fvq-sub">Handed off from ${esc(b.from.name)}${b.via ? `: ${esc(b.via)}` : ''}</div>` : ''}
      ${stepRows(b.res)}</div>`).join('');
  return `${rail(m, hot)}
    <div class="fvq-h">${esc(ev.label)}${ev.app ? `<span class="fvq-tag">${esc(ev.app)}</span>` : ''}</div>
    <div class="fvq-sub" style="margin-bottom:10px">${ev.zaps.length} automation${ev.zaps.length === 1 ? '' : 's'} start${ev.zaps.length === 1 ? 's' : ''} here${blocks.length > ev.zaps.length ? `, handing off to ${blocks.length - ev.zaps.length} more` : ''}.${apps.length ? ` Systems touched: ${apps.map(esc).join(', ')}.` : ''}</div>${body}`;
}

function usedResult(m, target) {
  const u = usageOf(m, target);
  const hot = new Set(u.linked.map((e) => m.stageOf(e.res)).filter(Boolean).map((s) => s.id));
  const row = (e, link) => `<div class="fvq-row"><div class="fvq-n">${e.n + 1}</div><div><div>${esc(e.step.name || 'Untitled step')}${stepApp(e.step) ? `<span class="fvq-tag">${esc(stepApp(e.step))}</span>` : ''}</div><div class="fvq-sub">${esc(e.res.name)}${m.wfName(e.res) ? ` &middot; ${esc(m.wfName(e.res))}` : ''} ${stageTag(m, e.res)}</div></div><div style="display:flex;gap:6px">${link ? `<button type="button" class="fvq-open" onclick="OL.fvTraceLink('${esc(target.id)}','${esc(e.res.id)}','${esc(e.step.id)}')">Link</button>` : ''}${jumpBtn(e.res, e.step)}</div></div>`;
  return `${rail(m, hot)}
    <div class="fvq-h">${esc(target.name.replace(/^\[Discovered\]\s*/, ''))}<span class="fvq-tag">${esc(target.type)}</span></div>
    <div class="fvq-sub" style="margin-bottom:10px">Linked to ${u.linked.length} step${u.linked.length === 1 ? '' : 's'}, in journey order.</div>
    ${u.linked.map((e) => row(e, false)).join('') || '<div class="fvq-sub">No step is linked to this yet.</div>'}
    ${u.mentioned.length ? `<div class="fvq-h" style="margin-top:18px;font-size:13px">Mentioned by name, not linked (${u.mentioned.length})</div><div class="fvq-sub" style="margin-bottom:6px">Check each one, then Link it so it shows above.</div>${u.mentioned.map((e) => row(e, true)).join('')}` : ''}`;
}

function dataResult(m, tag) {
  const hot = new Set(tag.entries.map((e) => m.stageOf(e.res)).filter(Boolean).map((s) => s.id));
  const sorted = tag.entries.slice().sort((a, b) => m.order(a.res) - m.order(b.res) || a.n - b.n);
  return `${rail(m, hot)}<div class="fvq-h">${esc(tag.name)}</div>
    <div class="fvq-sub" style="margin-bottom:10px">On ${sorted.length} step${sorted.length === 1 ? '' : 's'}.</div>
    ${sorted.map((e) => `<div class="fvq-row"><div class="fvq-n">${e.n + 1}</div><div><div>${esc(e.step.name || 'Untitled step')}${stepApp(e.step) ? `<span class="fvq-tag">${esc(stepApp(e.step))}</span>` : ''}</div><div class="fvq-sub">${esc(e.res.name)} ${stageTag(m, e.res)}</div></div>${jumpBtn(e.res, e.step)}</div>`).join('')}`;
}

const CSS = `#fv-trace .fvq-tabs{display:flex;gap:6px;flex-wrap:wrap}
#fv-trace .fvq-tab{border:1px solid var(--line);background:transparent;color:var(--text);border-radius:8px;padding:6px 14px;font-size:12px;cursor:pointer}
#fv-trace .fvq-tab.on{background:var(--accent);color:#04121c;border-color:var(--accent);font-weight:600}
#fv-trace .fvq-grid{display:grid;grid-template-columns:320px 1fr;gap:20px;margin-top:14px}
#fv-trace .fvq-list{border:1px solid var(--line);border-radius:10px;overflow:auto;max-height:calc(100vh - 230px)}
#fv-trace .fvq-item{display:block;width:100%;text-align:left;background:transparent;color:var(--text);border:0;border-bottom:1px solid var(--line);padding:8px 12px;font-size:12px;cursor:pointer}
#fv-trace .fvq-item.on{background:var(--accent-glow);font-weight:600}
#fv-trace .fvq-grp{padding:6px 12px;font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:var(--text-muted);background:var(--panel-soft)}
#fv-trace .fvq-rail{display:flex;gap:4px;margin:0 0 14px}
#fv-trace .fvq-st{flex:1;text-align:center;font-size:11px;padding:6px 2px;border-radius:6px;background:var(--panel-soft);color:var(--text-muted)}
#fv-trace .fvq-st.hot{background:var(--accent);color:#04121c;font-weight:600}
#fv-trace .fvq-h{font-size:16px;font-weight:700;margin-bottom:4px}
#fv-trace .fvq-block{border:1px solid var(--line);border-radius:10px;padding:10px 14px;margin-bottom:12px}
#fv-trace .fvq-bh{margin-bottom:4px}
#fv-trace .fvq-row{display:grid;grid-template-columns:26px 1fr auto;gap:10px;padding:9px 0;border-top:1px solid var(--line);align-items:start;font-size:12px}
#fv-trace .fvq-n{width:22px;height:22px;border-radius:50%;background:var(--panel-soft);display:flex;align-items:center;justify-content:center;font-size:11px}
#fv-trace .fvq-sub{font-size:11px;color:var(--text-muted);margin-top:2px}
#fv-trace .fvq-tag{display:inline-block;font-size:10px;padding:1px 8px;border-radius:999px;background:var(--panel-soft);color:var(--text-dim);margin-left:6px}
#fv-trace .fvq-open{border:1px solid var(--line);background:transparent;color:var(--accent);border-radius:6px;padding:3px 10px;font-size:11px;cursor:pointer;white-space:nowrap}
#fv-trace input.fvq-q{width:100%;box-sizing:border-box;margin-bottom:8px;padding:7px 10px;border-radius:8px;border:1px solid var(--line);background:var(--panel-soft);color:var(--text);font-size:12px}`;

function render() {
  const host = document.getElementById('fv-trace'); if (!host) return;
  const m = model(), st = S();
  const q = norm(st.q);
  let list = '', result = '';
  if (st.view === 'event') {
    const evs = eventsOf(m).filter((e) => !q || norm(`${e.label} ${e.app}`).includes(q));
    if (!evs.some((e) => e.key === st.sel)) st.sel = evs[0] ? evs[0].key : '';
    let last = null;
    list = evs.map((e) => { const g = e.stage ? e.stage.name : 'Not placed'; const h = g !== last ? `<div class="fvq-grp">${esc(g)}</div>` : ''; last = g; return `${h}<button type="button" class="fvq-item${e.key === st.sel ? ' on' : ''}" onclick="OL.fvTraceSelect(${JSON.stringify(e.key).replace(/"/g, '&quot;')})">${esc(e.label)}${e.app ? `<span class="fvq-tag">${esc(e.app)}</span>` : ''}${e.zaps.length > 1 ? `<span class="fvq-tag">${e.zaps.length}</span>` : ''}</button>`; }).join('');
    const ev = evs.find((e) => e.key === st.sel);
    result = ev ? eventResult(m, ev) : '<div class="fvq-sub">No trigger matches.</div>';
  } else if (st.view === 'used') {
    const items = m.res.filter((r) => RESOURCE_TYPES.includes(r.type) && (!q || norm(r.name).includes(q))).sort((a, b) => RESOURCE_TYPES.indexOf(a.type) - RESOURCE_TYPES.indexOf(b.type) || norm(a.name).localeCompare(norm(b.name)));
    if (!items.some((r) => String(r.id) === st.sel)) st.sel = items[0] ? String(items[0].id) : '';
    let last = null;
    list = items.map((r) => { const h = r.type !== last ? `<div class="fvq-grp">${esc(r.type)}</div>` : ''; last = r.type; return `${h}<button type="button" class="fvq-item${String(r.id) === st.sel ? ' on' : ''}" onclick="OL.fvTraceSelect('${esc(r.id)}')">${esc(r.name.replace(/^\[Discovered\]\s*/, ''))}</button>`; }).join('');
    const t = m.byId.get(st.sel);
    result = t ? usedResult(m, t) : '<div class="fvq-sub">No resource matches.</div>';
  } else {
    const tags = dataTagsOf(m).filter((t) => !q || t.key.includes(q));
    if (!tags.some((t) => t.key === st.sel)) st.sel = tags[0] ? tags[0].key : '';
    list = tags.map((t) => `<button type="button" class="fvq-item${t.key === st.sel ? ' on' : ''}" onclick="OL.fvTraceSelect(${JSON.stringify(t.key).replace(/"/g, '&quot;')})">${esc(t.name)}<span class="fvq-tag">${t.entries.length}</span></button>`).join('');
    const t = tags.find((x) => x.key === st.sel);
    result = t ? dataResult(m, t) : '<div class="fvq-sub" style="max-width:520px">No steps have data tags yet, so there is nothing to trace. Once a step is tagged with a piece of data (first name, email, phone), this view lists every step that carries it and the system it is in.</div>';
  }
  const tab = (k, label) => `<button type="button" class="fvq-tab${st.view === k ? ' on' : ''}" onclick="OL.fvTraceView('${k}')">${label}</button>`;
  host.innerHTML = `<style>${CSS}</style>
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
      <div class="fvq-tabs">${tab('event', 'When this happens')}${tab('used', 'Where is this used')}${tab('data', 'Where does data go')}</div>
      <button type="button" class="fvq-open" onclick="OL.fvTraceClose()">Back to the map</button>
    </div>
    <div class="fvq-grid"><div><input class="fvq-q" id="fvq-q" placeholder="Search" value="${esc(st.q)}" oninput="OL.fvTraceSearch(this.value)" autocomplete="off"><div class="fvq-list">${list || '<div class="fvq-sub" style="padding:10px 12px">Nothing to show.</div>'}</div></div><div>${result}</div></div>`;
}

function mount() {
  const shell = document.getElementById('fv-shell'); if (!shell) throw new Error('Flow map Questions: the map is not on screen.');
  let p = document.getElementById('fv-trace');
  if (!p) {
    p = document.createElement('div'); p.id = 'fv-trace';
    const tb = document.getElementById('fv-topbar');
    shell.style.position = 'relative';
    p.style.cssText = `position:absolute;left:0;right:0;bottom:0;top:${tb ? tb.offsetHeight : 48}px;z-index:60;background:var(--bg);overflow:auto;padding:18px 24px;color:var(--text);`;
    shell.appendChild(p);
  }
  return p;
}

function open() { OL()._fv._traceOpen = true; mount(); render(); }
function close() { OL()._fv._traceOpen = false; const p = document.getElementById('fv-trace'); if (p) p.remove(); }
function toggle() { if (OL()._fv._traceOpen && document.getElementById('fv-trace')) close(); else open(); const b = document.getElementById('fv-questions-btn'); if (b) b.classList.toggle('on', !!OL()._fv._traceOpen); }
function redraw() { if (OL()._fv._traceOpen && document.getElementById('fv-shell')) { mount(); render(); } }

function setView(v) { const s = S(); s.view = v; s.sel = ''; s.q = ''; render(); }
function select(k) { S().sel = k; render(); }
function search(q) { S().q = q; render(); const i = document.getElementById('fvq-q'); if (i) { i.focus(); i.setSelectionRange(q.length, q.length); } }
function jump(resId, stepId) { close(); const b = document.getElementById('fv-questions-btn'); if (b) b.classList.remove('on'); if (typeof OL().fvJumpToStep === 'function') OL().fvJumpToStep(resId, stepId || undefined); }

// Adds one link to a step: the same { id, name, type } entry the step editor writes. Throws if the save fails.
async function link(targetId, resId, stepId) {
  const { updateAndSync } = await import('../../core/data.js');
  const m = model();
  const target = m.byId.get(String(targetId)), res = m.byId.get(String(resId));
  const step = res && (res.steps || []).find((s) => String(s.id) === String(stepId));
  if (!target || !step) throw new Error('Could not find that step or resource to link.');
  await updateAndSync(() => {
    step.links = step.links || [];
    if (!step.links.some((l) => String(l.id) === String(target.id))) step.links.push({ id: target.id, name: target.name, type: target.type });
  });
  render();
}

window.OL = window.OL || {};
Object.assign(window.OL, { fvTraceToggle: toggle, fvTraceRender: redraw, fvTraceClose: () => { close(); const b = document.getElementById('fv-questions-btn'); if (b) b.classList.remove('on'); }, fvTraceView: setView, fvTraceSelect: select, fvTraceSearch: search, fvTraceJump: jump, fvTraceLink: link });

export { model, eventsOf, chainOf, usageOf, dataTagsOf };
