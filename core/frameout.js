//======================= CORE / FRAME-OUT =======================//
// The logic behind Frame-out: framing a process out quickly, in plain language, before anything is built. A process is a
// "Process" card on the flow map whose steps are DRAFT steps: just a sentence, plus (all optional) who does it, a flag for
// "to confirm with the client", and a yes / no decision. Pure functions on the card's steps: no database, no page.
//
//   parseFrameLine()   one typed line -> a step, a decision, or a command (/no, /join).
//   applyFrameLine()   adds it to the steps, keeping track of which decision path a step belongs to.
//   deriveLinks()      draws the lines between steps. Written in the same shape the map and the list view already read
//                      (step.logic.out, "Yes" and "No" as conditions), so a draft process shows up everywhere a built one does.
//   layoutChain()      puts the steps on a canvas by themselves (left to right, or in a lane for each person).
//   questionsOf(), handoffsOf(), followUpText()   what is left to ask the client.
//
// The steps array is the single source of truth: its ORDER is the order the steps were framed, and each step says which
// decision path (if any) it sits on. Links are derived from that, never hand-kept, so reordering or deleting a step cannot
// leave a broken line behind. Only links marked _draft are ever rewritten; anything drawn by hand stays.
//
// Used by features/frameout.js (the screen) and features/flow-visualizer/core.js (how a draft card is drawn).

export const OWNERS = {
  client:  { label: 'Client',      short: 'CLIENT',      color: '#F5B800', words: ['client', 'them', 'customer'] },
  sphynx:  { label: 'Sphynx',      short: 'SPHYNX',      color: '#3DD9C5', words: ['us', 'sphynx', 'we', 'team'] },
  system:  { label: 'System',      short: 'SYSTEM',      color: '#9fb0c4', words: ['system', 'auto', 'automation', 'zap', 'zapier'] },
  third:   { label: 'Third party', short: 'THIRD PARTY', color: '#a78bfa', words: ['3p', 'third', 'vendor', 'custodian'] },
};
export const OWNER_ORDER = ['client', 'sphynx', 'system', 'third'];

const OWNER_ASSIGNEE = {
  client: { id: 'all-client', name: 'Any Client', type: 'role' },
  sphynx: { id: 'role-sphynx', name: 'Sphynx', type: 'role' },
  system: { id: 'frameout-system', name: 'System', type: 'app' },
  third:  { id: 'frameout-third', name: 'Third party', type: 'role' },
};
export const assigneesFor = (owner) => (OWNER_ASSIGNEE[owner] ? [{ ...OWNER_ASSIGNEE[owner] }] : []);

const ownerFromWord = (w) => {
  const k = String(w || '').toLowerCase();
  return OWNER_ORDER.find((o) => OWNERS[o].words.includes(k) || o === k) || null;
};

const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const clip = (s, n) => { const t = clean(s); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

// ---- one typed line ----------------------------------------------------------------------------------------
//   "Advisor reviews the packet @client"          a step, done by the client
//   "Prepares the packet @us ? who signs off"     a step to confirm, with the question to ask
//   "/if Joint account?"                          a decision (the next steps are on its Yes path)
//   "/no"   "/join"                               switch to the No path / back to the main line
// Returns { kind: 'step'|'decision'|'command'|'empty', ... }.
export function parseFrameLine(input) {
  let text = clean(input);
  if (!text) return { kind: 'empty' };

  const cmd = text.match(/^\/(\w+)\s*(.*)$/);
  if (cmd) {
    const c = cmd[1].toLowerCase();
    if (c === 'no' || c === 'else' || c === 'otherwise') return { kind: 'command', command: 'no' };
    if (c === 'join' || c === 'end' || c === 'then' || c === 'merge') return { kind: 'command', command: 'join' };
    if (c === 'if' || c === 'decision' || c === 'when') { text = cmd[2]; if (!clean(text)) return { kind: 'empty', hint: 'Type the question after /if, like /if Joint account?' }; return { ...parseBody(text), kind: 'decision' }; }
    return { kind: 'empty', hint: `Not a command I know: /${c}. Try /if, /no or /join.` };
  }
  return { ...parseBody(text), kind: 'step' };
}

function parseBody(text) {
  text = clean(text);
  // "name ? question": a question mark followed by text is the thing to confirm; "??" at the end flags it with no text
  let question = null;
  const q = text.match(/^(.*?)\s*\?\s+(\S.*)$/);
  if (q && q[1]) { text = q[1]; question = q[2]; }
  else if (/\?\?$/.test(text)) { text = text.replace(/\?\?$/, ''); question = ''; }

  let owner = null;
  // in the name: at the start or the end of the line it is a tag and goes; in the middle ("Email the @client a copy") it stays as the word
  text = text.replace(/(^|\s)@(\w+)(?=\s|$)/g, (m, sp, w, off, whole) => {
    const o = ownerFromWord(w); if (!o) return m;
    owner = o;
    const atEdge = !clean(whole.slice(0, off)) || !clean(whole.slice(off + m.length));
    return atEdge ? sp : `${sp}${w}`;
  });
  // an owner typed after the question ("x ? who signs off @us") counts and is not part of the question
  if (question) question = question.replace(/(^|\s)@(\w+)(?=\s|$)/g, (m, sp, w) => { const o = ownerFromWord(w); if (!o) return m; if (!owner) owner = o; return sp; });
  return { name: clean(text), owner, question: question === null ? null : clean(question) };
}

const stepId = (rand) => `id_${rand()}`;

export function newDraftStep(parsed, rand = () => Math.random().toString(36).slice(2, 10)) {
  const isDecision = parsed.kind === 'decision';
  let name = parsed.name;
  if (isDecision && !/\?$/.test(name)) name = `${name}?`;
  const step = {
    id: stepId(rand), name, appName: '', draft: true, kind: isDecision ? 'decision' : 'step',
    owner: parsed.owner || '', assignees: parsed.owner ? assigneesFor(parsed.owner) : [],
    logic: { in: [], out: [] }, links: [], datapoints: [],
  };
  if (parsed.question !== null && parsed.question !== undefined) step.question = { text: parsed.question || `Confirm: ${parsed.name}`, done: false };
  return step;
}

// Where the next step goes, from the steps so far: on a decision's Yes or No path, or on the main line.
export function contextOf(steps) {
  const last = (steps || [])[(steps || []).length - 1];
  if (!last) return null;
  if (last.kind === 'decision') return { decisionId: last.id, path: 'yes' };
  if (last.branchOf) return { decisionId: last.branchOf, path: last.path || 'yes' };
  return null;
}

// Adds a parsed line. `state` is the open session ({ ctx }): /no and /join change where the NEXT step goes, so they live
// there, not in the steps. Returns { ok, step?, message? }. `steps` is changed in place.
export function applyFrameLine(steps, parsed, rand, state = {}) {
  const ctx = state.ctx !== undefined ? state.ctx : contextOf(steps);
  if (parsed.kind === 'empty') return { ok: false, message: parsed.hint || '' };

  if (parsed.kind === 'command') {
    if (parsed.command === 'no') {
      if (!ctx) return { ok: false, message: 'There is no decision open. Start one with /if.' };
      if (ctx.path === 'no') return { ok: false, message: 'You are already on the No path. /join goes back to the main line.' };
      state.ctx = { decisionId: ctx.decisionId, path: 'no' };
      return { ok: true, message: 'Now adding the No path. /join goes back to the main line.' };
    }
    if (!ctx) return { ok: false, message: 'There is no decision open.' };
    state.ctx = null;
    return { ok: true, message: 'Back on the main line.' };
  }

  if (parsed.kind === 'decision' && ctx) return { ok: false, message: 'Finish the open decision first: /join gets you back to the main line.' };

  const step = newDraftStep(parsed, rand);
  if (parsed.kind === 'step' && ctx) { step.branchOf = ctx.decisionId; step.path = ctx.path; }
  steps.push(step);
  state.ctx = contextOf(steps);
  return { ok: true, step, message: parsed.kind === 'decision' ? 'Decision added. The next steps go on its Yes path. /no switches to No, /join goes back.' : '' };
}

// ---- the lines between steps -------------------------------------------------------------------------------
const mkLink = (resId, to, rule) => ({
  type: rule ? 'condition' : 'next', types: [rule ? 'condition' : 'next'], targetId: `${resId}-${to.id}`, rule: rule || '',
  loopLimit: '', delayValue: '', delayUnit: 'days', _auto: true, _draft: true,
});

// Edges as a plain list, in the order of the steps: [{from, to, rule}]
export function edgesOf(steps) {
  const edges = [];
  let tails = [];                 // steps whose line continues to the next step: [{id, rule}]
  let open = null;                // the decision being built: { d, phase: null|'yes'|'no', yesEnd }
  const link = (to) => tails.forEach((t) => edges.push({ from: t.id, to: to.id, rule: t.rule || '' }));

  (steps || []).forEach((s) => {
    if (!s) return;
    const onBranch = !!(open && s.branchOf && s.branchOf === open.d.id);
    if (onBranch) {
      if (s.path === 'no' && open.phase !== 'no') {
        // the No path starts: whatever the Yes path ended on is remembered (a Yes path with no steps just goes straight on)
        open.yesEnd = open.phase === 'yes' ? tails : [{ id: open.d.id, rule: 'Yes' }];
        open.phase = 'no'; tails = [{ id: open.d.id, rule: 'No' }];
      } else if (s.path !== 'no' && open.phase === null) {
        open.phase = 'yes'; tails = [{ id: open.d.id, rule: 'Yes' }];
      }
      link(s);
      tails = [{ id: s.id, rule: '' }];
      return;
    }
    // back on the main line: close an open decision, joining whatever its paths ended on
    if (open) {
      if (open.phase === 'yes') tails = [...tails, { id: open.d.id, rule: 'No' }];             // only a Yes path: No goes straight on
      else if (open.phase === 'no') tails = [...(open.yesEnd || []), ...tails];                 // both paths join here
      open = null;
    }
    link(s);
    tails = [{ id: s.id, rule: '' }];
    if (s.kind === 'decision') open = { d: s, phase: null, yesEnd: null };
  });
  return edges;
}

// Writes the lines into the steps (logic.out), leaving anything drawn by hand alone. resId = the card's id.
export function deriveLinks(steps, resId) {
  (steps || []).forEach((s) => { if (s.logic && Array.isArray(s.logic.out)) s.logic.out = s.logic.out.filter((l) => !l._draft); else s.logic = { in: [], out: [] }; });
  const byId = new Map((steps || []).map((s) => [s.id, s]));
  edgesOf(steps).forEach((e) => {
    const from = byId.get(e.from); const to = byId.get(e.to);
    if (from && to) from.logic.out.push(mkLink(resId, to, e.rule));
  });
  return steps;
}

// ---- layout ------------------------------------------------------------------------------------------------
const BOX = { step: { w: 192, h: 84 }, decision: { w: 216, h: 120 } };
const GAP_X = 56, GAP_Y = 44, PAD = 40, LANE_PAD = 18;

// mode: 'chain' (the No path on its own row) | 'who' (a lane for each person).
// opts.maxCols: how many columns fit across before the chain wraps onto a new band (default 5; 'who' never wraps, a lane
// has to read straight across). Returns the nodes, the lines and the canvas size.
export function layoutChain(allSteps, mode = 'chain', opts = {}) {
  const steps = (allSteps || []).filter(Boolean);
  const edges = edgesOf(allSteps);
  const preds = new Map(steps.map((s) => [s.id, []]));
  edges.forEach((e) => { if (preds.has(e.to)) preds.get(e.to).push(e.from); });

  const rank = new Map();
  steps.forEach((s) => { const p = preds.get(s.id) || []; rank.set(s.id, p.length ? Math.max(...p.map((x) => rank.get(x) ?? 0)) + 1 : 0); });
  const maxRank = steps.length ? Math.max(...steps.map((s) => rank.get(s.id))) : 0;

  const maxCols = mode === 'who' ? Infinity : Math.max(2, Math.floor(opts.maxCols || 5));
  const bandOf = (r) => (Number.isFinite(maxCols) ? Math.floor(r / maxCols) : 0);
  const colOf = (r) => (Number.isFinite(maxCols) ? r % maxCols : r);
  const bands = bandOf(maxRank) + 1;

  let rowOf; let lanes = null; let rowsPer;
  if (mode === 'who') {
    // a decision sits in the lane of whoever asks the question: the step before it
    const byId = new Map(steps.map((s) => [s.id, s]));
    const laneOwner = (s, depth = 0) => {
      if (s.owner) return s.owner;
      if (s.kind !== 'decision' || depth > 8) return '';
      const p = (preds.get(s.id) || []).map((id) => byId.get(id)).find(Boolean);
      return p ? laneOwner(p, depth + 1) : '';
    };
    const owners = new Map(steps.map((s) => [s.id, laneOwner(s)]));
    const present = OWNER_ORDER.filter((o) => steps.some((s) => owners.get(s.id) === o));
    lanes = [...present, ...(steps.some((s) => !owners.get(s.id)) ? ['none'] : [])];
    if (!lanes.length) lanes = ['none'];
    rowOf = (s) => lanes.indexOf(owners.get(s.id) || 'none'); rowsPer = lanes.length;
  } else {
    rowOf = (s) => (s.path === 'no' ? 1 : 0); rowsPer = steps.some((s) => s.path === 'no') ? 2 : 1;
  }

  const colW = Math.max(BOX.step.w, BOX.decision.w);
  const laneH = Math.max(BOX.decision.h, BOX.step.h) + LANE_PAD * 2;
  const BAND_GAP = 64;
  // each band is only as tall as its rows: a No path only costs room in the band it is in
  const rowsIn = Array.from({ length: bands }, () => 1);
  if (mode === 'who') rowsIn.fill(rowsPer);
  else steps.forEach((s) => { if (rowOf(s) === 1) rowsIn[bandOf(rank.get(s.id))] = 2; });
  const bandHs = rowsIn.map((r) => (mode === 'who' ? r * laneH : r * BOX.decision.h + (r - 1) * GAP_Y));
  const bandTops = []; bandHs.reduce((y, h, i) => { bandTops[i] = y; return y + h + BAND_GAP; }, PAD);
  const colsUsed = Number.isFinite(maxCols) ? Math.min(maxCols, maxRank + 1) : maxRank + 1;
  const left = (c) => PAD + c * (colW + GAP_X);
  const bandTop = (b) => bandTops[b];
  const bandH = Math.max(...bandHs);
  const centerY = (b, row) => bandTop(b) + (mode === 'who' ? row * laneH + laneH / 2 : row * (BOX.decision.h + GAP_Y) + BOX.decision.h / 2);

  const nodes = steps.map((s) => {
    const bx = BOX[s.kind === 'decision' ? 'decision' : 'step'];
    const r = rank.get(s.id); const row = rowOf(s); const band = bandOf(r); const col = colOf(r);
    return { id: s.id, kind: s.kind, rank: r, band, col, row, w: bx.w, h: bx.h, x: left(col) + (colW - bx.w) / 2, y: centerY(band, row) - bx.h / 2 };
  });
  const node = new Map(nodes.map((n) => [n.id, n]));

  const width = PAD * 2 + colsUsed * colW + (colsUsed - 1) * GAP_X;
  const height = bandTop(bands - 1) + bandHs[bands - 1] + PAD;

  const lines = edges.map((e) => {
    const a = node.get(e.from); const b = node.get(e.to);
    if (!a || !b) return null;
    const x1 = a.x + a.w; const y1 = a.y + a.h / 2; const x2 = b.x; const y2 = b.y + b.h / 2;
    let pts;
    if (b.band > a.band) {
      // onto the next band: out of the source's bottom, along the gap between the bands, down the left of the target
      const gapY = bandTop(a.band) + bandHs[a.band] + BAND_GAP / 2;
      const cx = x2 - GAP_X / 2;
      pts = [[a.x + a.w / 2, a.y + a.h], [a.x + a.w / 2, gapY], [cx, gapY], [cx, y2], [x2, y2]];
    } else if (b.rank - a.rank > 1 && nodes.some((n) => n.band === a.band && n.rank > a.rank && n.rank < b.rank && n.row === a.row)) {
      // jumps over cards in its own row: goes under them
      const underY = bandTop(a.band) + bandHs[a.band] + 14;
      const bx2 = a.x + a.w / 2;
      pts = [[bx2, a.y + a.h], [bx2, underY], [x2 - GAP_X / 2, underY], [x2 - GAP_X / 2, y2], [x2, y2]];
    } else if (Math.abs(y1 - y2) < 1) {
      pts = [[x1, y1], [x2, y2]];
    } else {
      const mx = x2 - GAP_X / 2;
      pts = [[x1, y1], [mx, y1], [mx, y2], [x2, y2]];
    }
    return { from: e.from, to: e.to, rule: e.rule, points: pts, crossLane: mode === 'who' && a.row !== b.row };
  }).filter(Boolean);

  return { nodes, lines, width: Math.max(width, 2 * PAD + colW), height: Math.max(height, bandHs[0] + 2 * PAD), lanes, laneH, bandH, bandHs, laneTop: (row) => PAD + row * laneH, mode, bands, maxCols };
}

// ---- what is left to ask ---------------------------------------------------------------------------------
export const questionsOf = (steps) => (steps || []).filter((s) => s.question && !s.question.done).map((s) => ({ id: s.id, step: s.name, text: s.question.text }));

// A line between two steps with different owners (both set) is a handoff.
export function handoffsOf(steps) {
  const byId = new Map((steps || []).map((s) => [s.id, s]));
  return edgesOf(steps).filter((e) => { const a = byId.get(e.from); const b = byId.get(e.to); return a && b && a.owner && b.owner && a.owner !== b.owner; }).length;
}

export const unassignedCount = (steps) => (steps || []).filter((s) => !s.owner && s.kind !== 'decision').length;

export function followUpText(processName, steps, clientName = '') {
  const qs = questionsOf(steps);
  if (!qs.length) return '';
  const cap = (t) => (t ? t[0].toUpperCase() + t.slice(1) : t);
  const lines = qs.map((q, i) => `${i + 1}. ${cap(q.text)}${/[?.]$/.test(q.text) ? '' : '?'}  (about: ${clip(q.step, 60)})`);
  return `${clientName ? `Hi ${clientName},\n\n` : ''}A few things to confirm about "${processName}":\n\n${lines.join('\n')}\n`;
}

// ---- keeping the order tidy after an edit ------------------------------------------------------------------
// A step cannot stay on a decision path if its decision is gone or no longer sits before it.
export function repairBranches(steps) {
  const seen = new Set();
  (steps || []).forEach((s) => {
    if (s.kind === 'decision') seen.add(s.id);
    if (s.branchOf && !seen.has(s.branchOf)) { delete s.branchOf; delete s.path; }
  });
  return steps;
}

// ---- placing the card on the map -------------------------------------------------------------------------
export function placeProcessCard(pd, card, opts = {}) {
  const makeId = opts.makeId || (() => Math.random().toString(36).slice(2, 9));
  pd.stages = pd.stages || []; pd.workflows = pd.workflows || [];
  if (card.stageId) return { placed: false, stageId: card.stageId };
  let stage = opts.stageId ? pd.stages.find((s) => s.id === opts.stageId) : null;
  if (!stage) {
    const name = opts.stageName || 'Process mapping';
    stage = pd.stages.find((s) => s.name === name);
    if (!stage) { stage = { id: `stage-${makeId()}`, name, width: 400 }; pd.stages.push(stage); }
  }
  let wf = pd.workflows.find((w) => w.stageId === stage.id && w.name === (opts.workflowName || 'Draft processes'));
  if (!wf) { wf = { id: `wf-${makeId()}`, name: opts.workflowName || 'Draft processes', stageId: stage.id, color: '#e8a83a', resourceIds: [] }; pd.workflows.push(wf); }
  card.stageId = stage.id; card.workflowId = wf.id; card.isGlobal = false;
  if (!wf.resourceIds.includes(String(card.id))) wf.resourceIds.push(String(card.id));
  return { placed: true, stageId: stage.id, workflowId: wf.id };
}
