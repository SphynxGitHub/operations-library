// ============================================================
// TIMELINE and SWIMLANES views of the flow map.
//   Timeline:  how many days pass between milestones. Days come from the wait set on each line between steps
//              (logic.out[].delayValue / delayUnit); a step with no wait counts as the same day. A milestone is a step marked
//              by hand (step.milestone = true, optional step.milestoneName).
//   Swimlanes: who holds each step, and where responsibility moves from one lane to another (a handoff).
//              Lanes come from the step's assignees; "Default four" folds everything into Client, Advisor, Operations, Automation.
// Both draw one stage or workflow at a time (the Stage overview is shown until one is picked), so they stay fast on a big project.
// ============================================================
import { esc } from '../../core/data.js';

const OL = window.OL || (window.OL = {});

const UNIT_DAYS = { minutes: 1 / 1440, hours: 1 / 24, days: 1, weeks: 7, months: 30 };
const waitDays = (v, u) => { const n = Number(v); return n > 0 ? n * (UNIT_DAYS[String(u || 'days').toLowerCase()] || 1) : 0; };
const waitWords = (v, u) => { const n = Number(v); if (!(n > 0)) return ''; const unit = String(u || 'days'); return `${n} ${n === 1 ? unit.replace(/s$/, '') : unit}`; };
const fmtDays = (d) => { const r = Math.round(d * 10) / 10; return Number.isInteger(r) ? String(r) : r.toFixed(1); };

// ---------- what is in view ----------
// The stage or workflow the map is filtered to: { stage, workflows } or null when nothing is picked yet.
function scopeOf(data) {
    const raw = String((OL._fv && OL._fv.stageFilter) || '');
    if (!raw || raw === '__overview') return null;
    const stages = data.stages || []; const wfs = data.workflows || [];
    const wf = wfs.find((w) => String(w.id) === raw);
    if (wf) return { label: wf.name, workflows: [wf] };
    const st = stages.find((s) => String(s.id) === raw) || stages.find((s) => `stage-${s.id}` === raw);
    if (st) return { label: st.name, workflows: wfs.filter((w) => String(w.stageId) === String(st.id)) };
    return null;
}

// Steps in view as nodes, and the lines between them as edges, with each node's day and column.
function graphOf(data, scope) {
    const resById = new Map((data.resources || []).map((r) => [String(r.id), r]));
    const nodes = []; const byKey = new Map();
    scope.workflows.forEach((wf) => {
        (wf.resourceIds || []).forEach((id) => {
            const res = resById.get(String(id));
            if (!res || res.isArchived || res.isDeleted) return;
            (res.steps || []).forEach((step, i) => {
                const key = `${res.id}-${step.id}`;
                if (byKey.has(key)) return;
                const n = { key, res, step, wf, order: nodes.length, idx: i, preds: [], succs: [], day: 0, layer: 0 };
                nodes.push(n); byKey.set(key, n);
            });
        });
    });
    const edges = [];
    const add = (a, b, v, u) => { if (!a || !b || a === b) return; const e = { a, b, wait: waitDays(v, u), words: waitWords(v, u) }; edges.push(e); a.succs.push(e); b.preds.push(e); };
    nodes.forEach((n) => {
        const outs = ((n.step.logic && n.step.logic.out) || []).filter((l) => l && l.targetId);
        outs.forEach((l) => {
            const t = String(l.targetId); const k = typeof OL._refSplitIdx === 'function' ? OL._refSplitIdx(t) : t.lastIndexOf('-');
            const target = byKey.get(k > 0 ? `${t.slice(0, k)}-${t.slice(k + 1)}` : t);
            add(n, target, l.delayValue, l.delayUnit);
        });
        // a step with no line of its own runs into the next step of the same resource (the map draws that line itself)
        if (!outs.length && !n.step.noAutoNext) { const next = byKey.get(`${n.res.id}-${(n.res.steps || [])[n.idx + 1] && n.res.steps[n.idx + 1].id}`); add(n, next, 0, 'days'); }
    });
    // Kahn's order gives each node its day (longest wait path from a start) and its column (longest step count).
    const indeg = new Map(nodes.map((n) => [n, n.preds.length]));
    const queue = nodes.filter((n) => !n.preds.length); const done = new Set();
    while (queue.length) {
        const n = queue.shift(); done.add(n);
        n.succs.forEach((e) => {
            if (e.b.day < n.day + e.wait) e.b.day = n.day + e.wait;
            if (e.b.layer < n.layer + 1) e.b.layer = n.layer + 1;
            indeg.set(e.b, indeg.get(e.b) - 1);
            if (indeg.get(e.b) === 0) queue.push(e.b);
        });
    }
    const looped = nodes.length - done.size;   // steps inside a loop keep day 0 / their best layer so far
    return { nodes, edges, byKey, looped };
}

// ---------- lanes ----------
const DEFAULT_LANES = ['Client', 'Advisor', 'Operations', 'Automation'];
function laneOf(n, mode) {
    const a = ((n.step.assignees || [])[0]) || ((n.res.type !== 'Zap' && (n.res.assignees || [])[0]) || null);
    const nm = a ? String(a.name || '') : '';
    const isClient = a && (a.type === 'role' && /client/i.test(a.id + ' ' + nm));
    const isAuto = a ? (a.type === 'app' || /zapier|automation|workflow/i.test(nm)) : (n.res.type === 'Zap' || /^(zapier|automation)/i.test(n.step.appName || ''));
    if (isClient) return 'Client';
    if (isAuto) return 'Automation';
    if (!a) return (n.res.type === 'Event' || n.res.type === 'Form' || /^(lead|client)/i.test(n.step.name || '')) ? 'Client' : 'Advisor';
    if (mode === 'default') return /operations|office|admin|ops/i.test(nm) ? 'Operations' : 'Advisor';
    return nm || 'Advisor';
}
const LANE_COLORS = [['#e0eefa', '#1f6fb5'], ['#fdf0e3', '#b45309'], ['#e3f4f1', '#0f766e'], ['#eceff3', '#475569'], ['#ede9fe', '#6d4fc2'], ['#fce7f3', '#9d2a6a']];

const STYLE_ID = 'fv2-style';
function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style'); s.id = STYLE_ID;
    s.textContent = `
      .fv2-wrap{position:relative;font-family:inherit;color:var(--text,inherit)}
      .fv2-bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:12px 16px;border-bottom:1px solid var(--line,rgba(127,127,127,.25))}
      .fv2-bar label{font-size:12px;color:var(--text-muted)}
      .fv2-seg{display:inline-flex;border:1px solid var(--line,rgba(127,127,127,.3));border-radius:8px;overflow:hidden}
      .fv2-seg button{border:0;background:transparent;color:inherit;font:600 12px inherit;padding:6px 12px;cursor:pointer}
      .fv2-seg button[aria-pressed="true"]{background:var(--accent);color:var(--on-accent,#fff)}
      .fv2-note{font-size:12px;color:var(--text-muted)}
      .fv2-pill{position:absolute;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;border-radius:11px;border:1px solid var(--line,rgba(127,127,127,.3));background:var(--bg-card,#fff);color:inherit}
      .fv2-card{position:absolute;box-sizing:border-box;border:1px solid var(--line,rgba(127,127,127,.4));border-radius:10px;background:var(--bg-card,#fff);padding:8px 10px;font-size:12px;line-height:16px;cursor:pointer;overflow:hidden;color:inherit;text-align:left}
      .fv2-card:hover{outline:2px solid var(--accent)}
      .fv2-card small{display:block;color:var(--text-muted);font-size:11px;margin-top:2px}
    `;
    document.head.appendChild(s);
}

const emptyNote = (canvas, svg, html) => {
    svg.innerHTML = ''; svg.style.width = '0px'; svg.style.height = '0px';
    canvas.style.width = 'auto'; canvas.style.height = 'auto';
    canvas.innerHTML = `<div style="padding:32px;max-width:640px;font-size:13px;line-height:20px;">${html}</div>`;
};

// ============================================================
// TIMELINE
// ============================================================
export function fvRenderTimeline(resources) {
    const canvas = document.getElementById('fv-content'); const svg = document.getElementById('fv-svg-layer');
    if (!canvas || !svg) return;
    ensureStyle();
    const data = OL.getCurrentProjectData();
    const scope = scopeOf(data);
    if (!scope) { OL._fvRenderOverview(canvas, svg, resources, 'Pick a stage or workflow to see its timeline.'); return; }
    const g = graphOf(data, scope);
    if (!g.nodes.length) { emptyNote(canvas, svg, `Nothing with steps in <b>${esc(scope.label)}</b> yet.`); return; }

    const ms = g.nodes.filter((n) => n.step.milestone).sort((a, b) => a.day - b.day || a.order - b.order);
    const from = ms.find((n) => n.key === OL._fv.tlFrom) || ms[0] || null;
    const off = from ? from.day : 0;
    const unitWeeks = OL._fv.tlScale !== 'days';

    // one bar per workflow: first to last step
    const rows = scope.workflows.map((wf) => {
        const ns = g.nodes.filter((n) => n.wf === wf); if (!ns.length) return null;
        return { wf, ns, s: Math.min(...ns.map((n) => n.day)), e: Math.max(...ns.map((n) => n.day)), ms: ns.filter((n) => n.step.milestone) };
    }).filter(Boolean).sort((a, b) => a.s - b.s || a.e - b.e);

    const minD = Math.min(...rows.map((r) => r.s), ...ms.map((n) => n.day)) - off;
    const maxD = Math.max(...rows.map((r) => r.e), ...ms.map((n) => n.day)) - off;
    const span = Math.max(maxD - minD, 7);
    const PX = Math.max(6, Math.min(40, Math.floor(1000 / span)));
    const L = 280, T = 110, ROW = 64, PADR = 120;
    const X = (d) => L + (d - off - minD) * PX;
    const plotW = Math.ceil(span * PX);
    const tickEvery = unitWeeks ? 7 : (span > 60 ? 7 : 1);
    const lab = (d) => (d === 0 ? '0' : d < 0 ? `−${fmtDays(-d)}` : fmtDays(d));

    const out = [];
    // ruler
    const first = Math.ceil((minD) / tickEvery) * tickEvery;
    out.push(`<div style="position:absolute;left:24px;top:${T - 24}px;font-size:12px;color:var(--text-muted)">Days${from ? ' from ' + esc(from.step.milestoneName || from.step.name) : ''}</div>`);
    for (let d = first; d <= maxD; d += tickEvery) {
        out.push(`<div aria-hidden="true" style="position:absolute;left:${X(d + off)}px;top:${T}px;width:1px;height:${rows.length * ROW + 130}px;background:var(--line,rgba(127,127,127,.25))"></div>`);
        out.push(`<div style="position:absolute;left:${X(d + off) - 24}px;top:${T - 24}px;width:48px;text-align:center;font-size:12px;font-weight:500;color:var(--text-muted)">${lab(d)}</div>`);
    }
    // milestone rail
    const RY = T + 64;
    out.push(`<div style="position:absolute;left:24px;top:${RY - 9}px;font-size:13px;font-weight:700">Milestones</div>`);
    if (!ms.length) {
        out.push(`<div style="position:absolute;left:${L}px;top:${RY - 10}px;font-size:12px;color:var(--text-muted)">None marked yet. Open a step and turn on Milestone to mark one.</div>`);
    } else {
        out.push(`<div aria-hidden="true" style="position:absolute;left:${X(ms[0].day)}px;top:${RY}px;width:${Math.max(0, X(ms[ms.length - 1].day) - X(ms[0].day))}px;height:2px;background:var(--text-muted);opacity:.6"></div>`);
        ms.slice(1).forEach((b, i) => {
            const a = ms[i]; const days = b.day - a.day; const mid = (X(a.day) + X(b.day)) / 2;
            if (X(b.day) - X(a.day) >= 70) out.push(`<div class="fv2-pill" style="left:${mid - 34}px;top:${RY - 11}px;width:68px;height:22px">${fmtDays(days)} day${days === 1 ? '' : 's'}</div>`);
        });
        ms.forEach((n) => {
            const d = n.day - off;
            out.push(`<div aria-hidden="true" style="position:absolute;left:${X(n.day)}px;top:${RY + 20}px;width:0;height:${rows.length * ROW + 40}px;border-left:1px dashed var(--text-muted);opacity:.5"></div>`);
            out.push(`<button type="button" title="${esc(n.step.milestoneName || n.step.name)} (day ${lab(d)}). Click to measure from here." onclick="OL._fv.tlFrom='${esc(n.key)}';OL.renderVisualizer()" style="position:absolute;left:${X(n.day) - 9}px;top:${RY - 8}px;width:18px;height:18px;padding:0;border-radius:4px;border:2px solid var(--bg-card,#fff);background:var(--accent);box-shadow:0 0 0 1px var(--accent);cursor:pointer;${n === from ? 'outline:2px solid var(--text);outline-offset:2px;' : ''}"></button>`);
            out.push(`<div style="position:absolute;left:${X(n.day) - 64}px;top:${RY - 46}px;width:128px;text-align:center;font-size:12px;font-weight:600;line-height:15px">${esc(n.step.milestoneName || n.step.name)}</div>`);
            out.push(`<div style="position:absolute;left:${X(n.day) - 64}px;top:${RY + 12}px;width:128px;text-align:center;font-size:11px;color:var(--text-muted)">Day ${lab(d)}</div>`);
        });
    }
    // rows
    const palette = LANE_COLORS;
    rows.forEach((r, i) => {
        const y = RY + 56 + i * ROW; const [bg, bd] = palette[i % palette.length];
        out.push(`<div style="position:absolute;left:24px;top:${y + 4}px;width:240px;font-size:13px;font-weight:700;line-height:17px">${esc(r.wf.name)}<br><span style="font-size:11px;font-weight:400;color:var(--text-muted)">${r.ns.length} step${r.ns.length === 1 ? '' : 's'}${r.ms.length ? `, ${r.ms.length} milestone${r.ms.length === 1 ? '' : 's'}` : ''}</span></div>`);
        const x1 = X(r.s), w = Math.max(10, X(r.e) - X(r.s));
        const days = r.e - r.s;
        out.push(`<button type="button" title="Open ${esc(r.wf.name)} on the Steps map" onclick="OL.fvOpenInSteps('${esc(r.wf.id)}')" style="position:absolute;left:${x1}px;top:${y + 8}px;width:${w}px;height:30px;padding:0;border:1.5px solid ${bd};border-radius:8px;background:${bg};cursor:pointer"></button>`);
        out.push(`<div style="position:absolute;left:${x1 + w + 10}px;top:${y + 12}px;white-space:nowrap;font-size:12px;color:var(--text-muted)">${days > 0 ? `<b style="color:var(--text)">${fmtDays(days)} day${days === 1 ? '' : 's'}</b>` : 'Same day'}</div>`);
    });
    const totalH = RY + 56 + rows.length * ROW + 40;
    const hasWait = g.edges.some((e) => e.wait > 0);
    const bar = `
      <div class="fv2-bar" style="position:absolute;left:0;top:0;right:0;">
        <strong style="font-size:13px">${esc(scope.label)}</strong>
        <label>Scale</label>
        <span class="fv2-seg" role="group" aria-label="Scale"><button type="button" aria-pressed="${unitWeeks}" onclick="OL._fv.tlScale='weeks';OL.renderVisualizer()">Weeks</button><button type="button" aria-pressed="${!unitWeeks}" onclick="OL._fv.tlScale='days';OL.renderVisualizer()">Days</button></span>
        ${ms.length > 1 ? `<label for="fv2-from">Measure from</label><select id="fv2-from" class="fv-select" onchange="OL._fv.tlFrom=this.value;OL.renderVisualizer()">${ms.map((n) => `<option value="${esc(n.key)}" ${n === from ? 'selected' : ''}>${esc(n.step.milestoneName || n.step.name)}</option>`).join('')}</select>` : ''}
        <span class="fv2-note">${hasWait ? 'Days come from the wait set on each line between steps.' : 'No waits are set on the lines yet, so every step counts as the same day. Add a wait to a line to see days.'}${g.looped ? ` ${g.looped} step${g.looped === 1 ? ' is' : 's are'} inside a loop and not counted.` : ''}</span>
      </div>`;
    svg.innerHTML = ''; svg.style.width = '0px'; svg.style.height = '0px';
    canvas.style.width = `${L + plotW + PADR + 220}px`; canvas.style.height = `${totalH}px`;
    canvas.innerHTML = `<div class="fv2-wrap" style="width:${L + plotW + PADR + 220}px;height:${totalH}px">${bar}${out.join('')}</div>`;
}

// ============================================================
// SWIMLANES
// ============================================================
export function fvRenderSwimlanes(resources) {
    const canvas = document.getElementById('fv-content'); const svg = document.getElementById('fv-svg-layer');
    if (!canvas || !svg) return;
    ensureStyle();
    const data = OL.getCurrentProjectData();
    const scope = scopeOf(data);
    if (!scope) { OL._fvRenderOverview(canvas, svg, resources, 'Pick a stage or workflow to see who holds each step.'); return; }
    const g = graphOf(data, scope);
    if (!g.nodes.length) { emptyNote(canvas, svg, `Nothing with steps in <b>${esc(scope.label)}</b> yet.`); return; }
    const MAX = 60;
    if (g.nodes.length > MAX) { emptyNote(canvas, svg, `<b>${esc(scope.label)}</b> has ${g.nodes.length} steps, too many to read as lanes. Pick one workflow from the filter at the top.`); return; }

    const anyAssigned = g.nodes.some((n) => (n.step.assignees || []).length);
    const mode = OL._fv.laneMode || (anyAssigned ? 'assignees' : 'default');
    g.nodes.forEach((n) => { n.lane = laneOf(n, mode); });
    let laneNames = [];
    if (mode === 'default') laneNames = DEFAULT_LANES.slice();
    else {
        const seen = []; g.nodes.forEach((n) => { if (!seen.includes(n.lane)) seen.push(n.lane); });
        laneNames = [...seen.filter((x) => x === 'Client'), ...seen.filter((x) => !['Client', 'Operations', 'Automation'].includes(x)), ...seen.filter((x) => x === 'Operations'), ...seen.filter((x) => x === 'Automation')];
    }
    const laneIdx = new Map(laneNames.map((l, i) => [l, i]));

    // cell = (lane, column); several steps in one cell stack
    const CW = 150, CH = 64, GAPX = 64, GAPY = 12, L = 190, T = 96, PADY = 22;
    const cell = new Map();
    g.nodes.slice().sort((a, b) => a.layer - b.layer || a.order - b.order).forEach((n) => {
        const k = `${laneIdx.get(n.lane)}|${n.layer}`; n.stack = cell.get(k) || 0; cell.set(k, n.stack + 1);
    });
    const laneStack = laneNames.map((_, i) => Math.max(1, ...g.nodes.filter((n) => laneIdx.get(n.lane) === i).map((n) => n.stack + 1)));
    const laneH = laneStack.map((s) => s * (CH + GAPY) + PADY * 2 - GAPY);
    const laneTop = []; laneH.reduce((y, h, i) => { laneTop[i] = y; return y + h + 6; }, T);
    const cols = Math.max(...g.nodes.map((n) => n.layer)) + 1;
    const colX = (c) => L + c * (CW + GAPX);
    const nx = (n) => colX(n.layer), ny = (n) => laneTop[laneIdx.get(n.lane)] + PADY + n.stack * (CH + GAPY);
    const W = colX(cols - 1) + CW + 60; const lanesBottom = laneTop[laneTop.length - 1] + laneH[laneH.length - 1];

    const out = []; const paths = []; const badges = []; const hand = [];
    laneNames.forEach((nm, i) => {
        const [bg, bd] = LANE_COLORS[i % LANE_COLORS.length]; const count = g.nodes.filter((n) => n.lane === nm).length;
        out.push(`<div aria-hidden="true" style="position:absolute;left:24px;top:${laneTop[i]}px;width:${W - 48}px;height:${laneH[i]}px;background:${bg};opacity:.55;border-radius:10px"></div>`);
        out.push(`<div style="position:absolute;left:36px;top:${laneTop[i] + 14}px;width:140px;font-size:13px;font-weight:700;line-height:17px;color:${bd}">${esc(nm)}<br><span style="font-size:11px;font-weight:400;color:var(--text-muted)">${count} step${count === 1 ? '' : 's'}</span></div>`);
    });
    // arrows (SVG layer) and handoffs
    g.edges.slice().sort((a, b) => a.b.layer - b.b.layer || a.b.order - b.b.order).forEach((e) => {
        const x1 = nx(e.a) + CW, y1 = ny(e.a) + CH / 2, x2 = nx(e.b), y2 = ny(e.b) + CH / 2;
        const xm = x2 - GAPX / 2;
        paths.push(`<path d="M ${x1} ${y1} H ${xm} V ${y2} H ${x2 - 1}" fill="none" stroke="var(--text-muted)" stroke-width="1.6" stroke-linejoin="round" marker-end="url(#fv2-head)"/>`);
        if (e.a.lane !== e.b.lane) {
            hand.push({ n: hand.length + 1, from: e.a.lane, to: e.b.lane, words: e.words, a: e.a, b: e.b });
            const h = hand[hand.length - 1];
            badges.push(`<div style="position:absolute;left:${xm + 6}px;top:${(y1 + y2) / 2 - 11}px;width:22px;height:22px;border-radius:11px;background:var(--text,#1b2430);color:var(--bg-card,#fff);font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center" title="Handoff ${h.n}: ${esc(h.from)} to ${esc(h.to)}">${h.n}</div>`);
        }
    });
    g.nodes.forEach((n) => {
        out.push(`<button type="button" class="fv2-card" style="left:${nx(n)}px;top:${ny(n)}px;width:${CW}px;height:${CH}px" title="${esc(n.res.name)}: ${esc(n.step.name)}" onclick="OL._fvOpenStepsList('${esc(n.res.id)}')"><b>${esc(n.step.name)}</b><small>${esc(n.res.name)}</small></button>`);
    });
    // handoff list under the lanes
    const LY = lanesBottom + 20;
    out.push(`<div style="position:absolute;left:24px;top:${LY}px;font-size:14px;font-weight:700">Handoffs (${hand.length})</div>`);
    out.push(`<div style="position:absolute;left:150px;top:${LY + 2}px;font-size:12px;color:var(--text-muted)">Where responsibility moves from one lane to another, and how long the line waits</div>`);
    const per = Math.max(1, Math.floor((W - 48) / 252));
    hand.forEach((h, i) => {
        const x = 24 + (i % per) * 252, y = LY + 32 + Math.floor(i / per) * 62;
        out.push(`<div style="position:absolute;left:${x}px;top:${y}px;width:240px;height:52px;box-sizing:border-box;border:1px solid var(--line,rgba(127,127,127,.3));border-radius:10px;background:var(--bg-card,#fff);padding:8px 10px 8px 40px;font-size:12px;line-height:17px"><b>${esc(h.from)} to ${esc(h.to)}</b><br><span style="color:var(--text-muted)">${h.words ? 'Waits ' + esc(h.words) : 'No wait set'}</span></div>`);
        out.push(`<div style="position:absolute;left:${x + 10}px;top:${y + 15}px;width:22px;height:22px;border-radius:11px;background:var(--text,#1b2430);color:var(--bg-card,#fff);font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center">${h.n}</div>`);
    });
    if (!hand.length) out.push(`<div style="position:absolute;left:24px;top:${LY + 32}px;font-size:12px;color:var(--text-muted)">No handoffs here: every step is in one lane.</div>`);
    const H = LY + 32 + Math.ceil(Math.max(1, hand.length) / per) * 62 + 40;
    const bar = `
      <div class="fv2-bar" style="position:absolute;left:0;top:0;right:0;">
        <strong style="font-size:13px">${esc(scope.label)}</strong>
        <label for="fv2-lanes">Lanes</label>
        <select id="fv2-lanes" class="fv-select" onchange="OL._fv.laneMode=this.value;OL.renderVisualizer()">
          <option value="assignees" ${mode === 'assignees' ? 'selected' : ''}>From step assignees</option>
          <option value="default" ${mode === 'default' ? 'selected' : ''}>Default four</option>
        </select>
        <span class="fv2-note">${hand.length} handoff${hand.length === 1 ? '' : 's'} across ${laneNames.length} lane${laneNames.length === 1 ? '' : 's'}${mode === 'default' && !anyAssigned ? '. No steps have assignees yet, so lanes are guessed from the kind of step.' : ''}${g.looped ? ` ${g.looped} step${g.looped === 1 ? ' is' : 's are'} inside a loop.` : ''}</span>
      </div>`;
    svg.setAttribute('width', W); svg.setAttribute('height', H);
    svg.style.width = `${W}px`; svg.style.height = `${H}px`;
    svg.innerHTML = `<defs><marker id="fv2-head" orient="auto" markerWidth="6" markerHeight="6" refX="2" refY="2" overflow="visible"><path d="M0 0 L4 2 L0 4 Z" fill="var(--text-muted)" stroke="none"/></marker></defs>${paths.join('')}`;
    canvas.style.width = `${W}px`; canvas.style.height = `${H}px`;
    canvas.innerHTML = `<div class="fv2-wrap" style="width:${W}px;height:${H}px">${bar}${out.join('')}${badges.join('')}</div>`;
}

// open one workflow on the Steps map
export function fvOpenInSteps(wfId) {
    OL._fv.layout = 'steps'; try { sessionStorage.setItem('fv_layout', 'steps'); } catch (e) { /* not remembered */ }
    OL._fv.stageFilter = String(wfId);
    OL.renderVisualizer();
}

Object.assign(OL, { fvRenderTimeline, fvRenderSwimlanes, fvOpenInSteps });
