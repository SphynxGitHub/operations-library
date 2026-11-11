// ================================================================================================
// FILE: features/zap-layout.js
//
// WHAT IT DOES:   Lays out the steps of an imported Zap so that parallel paths read naturally: the steps before a
//                 "paths" step run down the left, then each path becomes its own lane SIDE BY SIDE directly below it,
//                 and every lane's steps stack down under their path. Error-handling lanes sit to the right of the step
//                 they protect. (Before, steps were stacked in file order, so a path's steps landed back in the main
//                 column and the paths were staggered down the page.)
//
// USED BY:        features/flow-visualizer/core.js (see fix-parallel-path-layout.patch): _fvLayoutResource asks this
//                 file for the grid position of each step, and the map's measuring pass uses stackColumns() to turn
//                 those grid positions into real positions once card heights are known.
//
// ONLY FOR ZAPS: Applies to cards made by the Zap import (they carry zapMeta / originalZapId). Every other card keeps
//                 its existing layout exactly as before.
//
// PURE:           No page, no database: it can be tested on its own (tests/zap-layout.test.mjs).
// ================================================================================================

const BRANCH_TYPES = new Set(['condition', 'loop', 'delay']);

// The step a link points at, when it is a step of this same card ("<card id>-<step id>"). Step ids made by hand contain dashes
// themselves ("step-1699..."), so the id is cut off after the card's own id, not at the last dash: cutting at the last dash
// read such a step as a different id and dropped every link to it out of the layout.
const stepIdOf = (res, targetId) => {
  const t = String(targetId || ''); const pre = `${res.id}-`;
  return t.startsWith(pre) ? t.slice(pre.length) : null;
};

export const isLaneResource = (res) => !!(res && (res.zapMeta || res.originalZapId));
export const isLaneLayout = (layout) => { const first = layout && Object.values(layout)[0]; return !!(first && first.laneMode); };

// A copy of the card in which every group named in `names` is one step (the group's first member), with the links of all its members:
// links into any member now point at that step, and the links out of the members are gathered on it. Returns { virtual, anchorOf }
// (anchorOf: member id -> the id of the step standing for its group).
export function collapseGroups(res, names) {
  const steps = res.steps || [];
  const byGroup = new Map();
  steps.forEach((s) => { const g = s.stepGroup; if (g && names.has(g)) { if (!byGroup.has(g)) byGroup.set(g, []); byGroup.get(g).push(String(s.id)); } });
  const anchorOf = new Map();
  byGroup.forEach((ids) => { if (ids.length > 1) ids.forEach((id) => anchorOf.set(id, ids[0])); });
  const remap = (l) => {
    const tid = stepIdOf(res, l.targetId);
    if (tid === null || !anchorOf.has(tid)) return l;
    return { ...l, targetId: `${res.id}-${anchorOf.get(tid)}` };
  };
  const outsOf = new Map();   // anchor id -> links gathered from every member
  steps.forEach((s) => {
    const id = String(s.id); const a = anchorOf.get(id) || id;
    const list = outsOf.get(a) || [];
    ((s.logic && s.logic.out) || []).forEach((l) => {
      if (!l || !l.targetId) return;
      const r = remap(l);
      if (stepIdOf(res, r.targetId) === a) return;                       // a link between two members of one card is no link at all
      const k = `${r.targetId}|${(r.types || [r.type || 'next']).join(',')}`;
      if (!list.some((x) => `${x.targetId}|${(x.types || [x.type || 'next']).join(',')}` === k)) list.push(r);
    });
    outsOf.set(a, list);
  });
  const out = [];
  steps.forEach((s) => {
    const id = String(s.id);
    if (anchorOf.has(id) && anchorOf.get(id) !== id) return;            // another member: stands in the first one
    out.push({ id, logic: { out: outsOf.get(id) || [] } });
  });
  return { virtual: { id: res.id, zapMeta: res.zapMeta, originalZapId: res.originalZapId, steps: out }, anchorOf };
}

// Returns { [stepId]: { colOffset, row, parentId, laneMode: true, after? } }.
//   colOffset  which column (0 = the main column, 1 = the next one to the right ...)
//   row        a grid row (steps in one lane are on consecutive rows; sibling lanes start on the SAME row)
//   parentId   for the first step of a lane: the step it branches from (null for every other step)
//   after      for a lane that WRAPPED onto a new band below its siblings: the steps it must clear
// opts.maxCols  the most columns that fit the window (default: no limit). Lanes that would not fit wrap onto a new band
//               below instead of running off the side, so a narrow window gives a taller, narrower diagram.
export function layoutLanes(res, opts = {}) {
  // Steps that share a group name are drawn as ONE combined card (the Steps view). The lanes are laid out as if each group were a
  // single step, standing where its first member stands, so the lanes keep their own columns side by side instead of being
  // pulled apart and stacked one after another around the cards. A member's position is its card's position.
  if (opts.collapse && opts.collapse.size) {
    const { virtual, anchorOf } = collapseGroups(res, opts.collapse);
    const lay = layoutLanes(virtual, { ...opts, collapse: null });
    anchorOf.forEach((a, m) => { if (m !== a && lay[a]) lay[m] = { ...lay[a], parentId: null }; });
    return lay;
  }
  const maxCols = Math.max(1, Math.floor(opts.maxCols || Infinity) || Infinity);
  const steps = res.steps || [];
  const byId = new Map(steps.map((s) => [String(s.id), s]));
  const nextOf = new Map();       // step -> the step that follows it in the same lane
  const branchesOf = new Map();   // step -> the first steps of the lanes that branch from it, in order
  const heads = new Set();        // steps that start a lane

  // how many links in this card point at each step (a step nothing else leads to has none)
  const incoming = new Map();
  steps.forEach((s) => (s.logic && s.logic.out ? s.logic.out : []).forEach((l) => {
    if (!l || !l.targetId) return;
    const tid = stepIdOf(res, l.targetId);
    if (tid === null) return;
    if (tid !== String(s.id)) incoming.set(tid, (incoming.get(tid) || 0) + 1);
  }));

  steps.forEach((s) => {
    const sid = String(s.id);
    (s.logic && s.logic.out ? s.logic.out : []).forEach((l) => {
      if (!l || !l.targetId) return;
      const tid = stepIdOf(res, l.targetId);
      if (tid === null) return;                                           // links to other cards are not part of this layout
      if (!byId.has(tid) || tid === sid) return;
      const types = l.types || [l.type || 'next'];
      if (types.some((x) => BRANCH_TYPES.has(x))) {
        const list = branchesOf.get(sid) || [];
        if (!list.includes(tid)) list.push(tid);
        branchesOf.set(sid, list);
        heads.add(tid);
      } else if (!nextOf.has(sid)) {
        nextOf.set(sid, tid);
      } else if (nextOf.get(sid) !== tid && incoming.get(tid) === 1) {
        // A second "next" line out of a step (say "Contact NOT Found") to a step that nothing else leads to: it is a path of
        // its own, so it runs down a lane beside its step. Without this it was left out of every lane and dropped to the bottom
        // of the main column, with a long line running all the way down to it.
        const list = branchesOf.get(sid) || [];
        if (!list.includes(tid)) list.push(tid);
        branchesOf.set(sid, list);
        heads.add(tid);
      }
    });
  });

  // The steps of a lane, from its first step down. A step that several lanes lead into (a combined card that two paths share) belongs
  // to the first lane that reaches it; the other lanes stop short of it and just point at it.
  const chainMemo = new Map(); const claimed = new Set();
  const chainOf = (head) => {
    if (chainMemo.has(head)) return chainMemo.get(head);
    const out = [head]; const seen = new Set(out);
    let cur = head;
    while (nextOf.has(cur)) {
      const n = nextOf.get(cur);
      if (seen.has(n) || heads.has(n) || claimed.has(n)) break;
      out.push(n); seen.add(n); cur = n;
    }
    out.forEach((x) => claimed.add(x));
    chainMemo.set(head, out);
    return out;
  };
  const claimAll = () => { chainMemo.clear(); claimed.clear(); heads.forEach((h) => chainOf(String(h))); };   // claim in file order
  claimAll();

  // Follow the flow, not the file order. A step that the flow reaches from some other step, but that is not on the main line nor in
  // a lane yet (for instance "Launch Opportunities", which both Track 2 and Track 3 lead into), becomes a lane beside the first step
  // that leads to it. Left alone it was listed in the main column with the steps of no path at all, far from every line into it.
  const sourcesOf = new Map();
  steps.forEach((s) => (s.logic && s.logic.out ? s.logic.out : []).forEach((l) => {
    if (!l || !l.targetId) return;
    const tid = stepIdOf(res, l.targetId);
    if (tid === null || !byId.has(tid) || tid === String(s.id)) return;
    const list = sourcesOf.get(tid) || [];
    if (!list.includes(String(s.id))) list.push(String(s.id));
    sourcesOf.set(tid, list);
  }));
  const mainLine = new Set();
  for (let cur = steps.length ? String(steps[0].id) : null; cur && !mainLine.has(cur) && !heads.has(cur); cur = nextOf.get(cur)) mainLine.add(cur);
  for (let guard = 0; guard <= steps.length; guard++) {
    const placed = new Set(mainLine);
    heads.forEach((h) => chainOf(String(h)).forEach((m) => placed.add(m)));
    let attached = false;
    for (const st of steps) {
      const id = String(st.id);
      if (placed.has(id)) continue;
      const src = (sourcesOf.get(id) || []).find((x) => placed.has(x));
      if (src === undefined) continue;
      const list = branchesOf.get(src) || [];
      list.push(id); branchesOf.set(src, list); heads.add(id);
      attached = true; break;
    }
    if (!attached) break;
    claimAll();
  }

  // steps that sit in a lane (a head, or reached from a head by following "next")
  const inLane = new Set();
  heads.forEach((h) => chainOf(String(h)).forEach((m) => inLane.add(m)));
  // The main column is the line from the first step. A step nothing leads to (and that leads nowhere the flow reaches) is not part of
  // it: left in the main column it made the steps above it "carry on" and moved every path a column to the right. They are set
  // apart, in columns of their own after everything else, below.
  const main = steps.map((s) => String(s.id)).filter((id) => !inLane.has(id) && mainLine.has(id));

  // A step carries on in its own lane when the step after it is in that lane. One whose next line goes to a step of another lane
  // (two paths that join the same steps) does not: what branches off it goes straight below it, not in a column of its own.
  const carriesOn = (head, m) => nextOf.has(m) && chainOf(head).includes(nextOf.get(m));

  // how many columns a lane needs (its own, plus those of any lanes that branch off it), never more than fit
  const widthMemo = new Map();
  const width = (head) => {
    if (widthMemo.has(head)) return widthMemo.get(head);
    widthMemo.set(head, 1);                                              // guards against loops
    let w = 1;
    for (const m of chainOf(head)) {
      const kids = branchesOf.get(m) || [];
      if (!kids.length) continue;
      const sum = kids.reduce((a, k) => a + width(k), 0);
      w = Math.max(w, carriesOn(head, m) ? 1 + sum : Math.max(1, sum));
    }
    w = Math.min(w, maxCols);
    widthMemo.set(head, w);
    return w;
  };

  const layout = {};
  // Places one lane and everything that branches off it. Returns { bottom: last row used, ids: every step placed }.
  const placeLane = (head, col, row, parentId, after, pgap) => {
    const members = chainOf(head);
    if (layout[head]) return { bottom: row - 1, ids: [] };
    const ids = [];
    members.forEach((m, i) => {
      layout[m] = { colOffset: col, row: row + i, parentId: i === 0 ? parentId : null, laneMode: true };
      if (i === 0 && after && after.length) layout[m].after = after.slice();
      if (i === 0 && pgap) layout[m].parentGap = pgap;               // room for the lines of several paths to run across under their step
      ids.push(m);
    });
    let bottom = row + members.length - 1;
    members.forEach((m, i) => {
      let c0 = col + (carriesOn(head, m) ? 1 : 0);                       // a step that carries on leaves its own column to the main flow
      let r0 = row + i + 1; let hold = [];
      if (c0 >= maxCols) { c0 = col; r0 = row + members.length; hold = members.slice(); }   // no room to the right: go below this lane
      const got = placeBranches(m, c0, r0, hold);
      bottom = Math.max(bottom, got.bottom); got.ids.forEach((x) => ids.push(x));
    });
    return { bottom, ids };
  };

  // The lanes that branch from one step, left to right; when the next one would not fit, a new band starts below.
  const placeBranches = (m, c0, startRow, baseAfter) => {
    const kids = branchesOf.get(m) || [];
    const placedIds = []; let bottom = startRow - 1;
    let c = c0; let bandRow = startRow; let bandBottom = startRow - 1; let after = baseAfter.slice();
    kids.forEach((k) => {
      const w = Math.min(width(k), maxCols - c0 > 0 ? maxCols - c0 : maxCols);
      if (c + w > maxCols && c > c0) {                                   // no room across: wrap
        // Into the emptiest stretch of columns (the one whose lanes end highest), not under everything in the first
        // column. A new band below the whole row put the lane at the far end of a long line that ran down through the
        // cards of the first lane, while columns further along stood empty.
        let bestC = c0; let bestBottom = Infinity; let early = false;
        // First choice: the nearest column to the parent that is free for this lane's whole height, right beside the parent.
        // Only for a plain lane (one column, nothing branching off it), so nothing of its own needs room further down.
        const mem = chainOf(k);
        if (w === 1 && mem.every((x) => !(branchesOf.get(x) || []).length)) {
          for (let cc = c0; cc < maxCols && !early; cc++) {
            const busy = Object.values(layout).some((li) => li.colOffset === cc && li.row >= startRow && li.row < startRow + mem.length);
            if (!busy) { bestC = cc; bestBottom = startRow - 1; early = true; }
          }
        }
        for (let cc = c0; !early && cc + w <= maxCols; cc++) {
          let b = startRow - 1;
          Object.values(layout).forEach((li) => { if (li.colOffset >= cc && li.colOffset < cc + w && li.row > b) b = li.row; });
          if (b < bestBottom) { bestBottom = b; bestC = cc; }
        }
        c = bestC; bandRow = Math.max(startRow, bestBottom + 1); bandBottom = bandRow - 1;
        after = baseAfter.slice();
      }
      // A plain lane (one column, nothing branching off it) takes the nearest column to its step that is free for its whole
      // height, rather than waiting until the columns of the lanes before it are used up: it can sit right beside its step
      // instead of far off at the end of the row.
      let nextC = c + w;                                                 // the next lane starts after this lane's own place in the row
      const kmem = chainOf(k);
      if (w === 1 && kmem.every((x) => !(branchesOf.get(x) || []).length)) {
        for (let cc = c0; cc < c; cc++) {
          const busy = Object.values(layout).some((li) => li.colOffset === cc && li.row >= bandRow && li.row < bandRow + kmem.length);
          if (!busy) { nextC = c; c = cc; break; }                       // tucked into a column already passed: it uses no new column
        }
      }
      // A lane takes the leftmost column (nearest its step) where it fits: its cards on cells nobody else uses, and none of them on the
      // lines that run from a step across to the first step of its other paths.
      const busCount = () => {
        const ents = Object.entries(layout); let n = 0;
        ents.forEach(([id, X]) => {
          const P = X.parentId ? layout[X.parentId] : null;
          if (!P || P.colOffset === X.colOffset || X.beside) return;
          const lo = Math.min(P.colOffset, X.colOffset), hi = Math.max(P.colOffset, X.colOffset);
          ents.forEach(([oid, o]) => { if (oid !== id && o.colOffset > lo && o.colOffset < hi && o.row > P.row && o.row < X.row) n++; });
        });
        return n;
      };
      const attempt = (cc) => {
        // A lane that has gone two or more columns away from its step, with that stretch of the step's own row empty, starts level
        // with the step (beside it, a short line straight across) rather than a row lower, so it sits high instead of low.
        let rowK = bandRow; let pg = Math.max(0, kids.length - 1) * 13; let beside = false;
        const pc = layout[m] ? layout[m].colOffset : c0;
        if (!baseAfter.length && bandRow === startRow && startRow >= 1 && cc - pc >= 2 && !(opts.noBeside && opts.noBeside.has(k)) && layout[m] && layout[m].row === startRow - 1) {
          const clear = Object.values(layout).every((li) => !(li.row === startRow - 1 && li.colOffset > pc && li.colOffset < cc + w));
          if (clear) { rowK = startRow - 1; pg = 0; beside = true; }
        }
        const got = placeLane(k, cc, rowK, m, after, pg);
        if (beside && layout[k]) layout[k].beside = true;
        return got;
      };
      const cands = [];
      if (!baseAfter.length && bandRow === startRow) for (let cc = c0; cc < c; cc++) if (cc + w <= maxCols) cands.push(cc);
      cands.push(c);
      let got = null; let at = c;
      for (let n = 0; n < cands.length && !got; n++) {
        const cc = cands[n]; const last = n === cands.length - 1;
        const before = new Set(Object.keys(layout)); const bc0 = last ? 0 : busCount();
        const g = attempt(cc);
        if (!last) {
          const seen = new Set(); let clash = false;
          Object.values(layout).forEach((li) => { const key = `${li.colOffset},${li.row}`; if (seen.has(key)) clash = true; seen.add(key); });
          if (clash || busCount() > bc0) { Object.keys(layout).forEach((id) => { if (!before.has(id)) delete layout[id]; }); continue; }
        }
        got = g; at = cc;
      }
      if (at < c) nextC = Math.max(c, at + w);                           // tucked into columns already passed: no new column unless it is wider
      got.ids.forEach((x) => placedIds.push(x));
      bandBottom = Math.max(bandBottom, got.bottom); bottom = Math.max(bottom, got.bottom);
      c = nextC;
    });
    return { bottom, ids: placedIds };
  };

  main.forEach((m, i) => { layout[m] = { colOffset: 0, row: i, parentId: null, laneMode: true }; });
  main.forEach((m, i) => {
    const carriesOn = nextOf.has(m) || i < main.length - 1;
    let c0 = carriesOn ? 1 : 0; let r0 = i + 1; let hold = [];
    if (c0 >= maxCols) { c0 = 0; r0 = main.length; hold = main.slice(); }   // narrow window: below the whole main flow
    placeBranches(m, c0, r0, hold);
  });

  // the steps nothing leads to: each loose run of them in a column of its own, to the right of everything
  {
    let oc = Math.max(-1, ...Object.values(layout).map((l) => l.colOffset)) + 1;
    const seenO = new Set();
    steps.forEach((st) => {
      const id = String(st.id);
      if (layout[id] || seenO.has(id)) return;
      const chain = []; let cur = id;
      while (cur && !layout[cur] && !seenO.has(cur)) { chain.push(cur); seenO.add(cur); cur = nextOf.get(cur); }
      chain.forEach((x, i) => { layout[x] = { colOffset: oc, row: i, parentId: null, laneMode: true }; });
      oc++;
    });
  }

  // anything left (for example a lane whose parent is missing) goes at the bottom of the main column
  let extra = Math.max(-1, ...Object.values(layout).map((l) => l.row)) + 1;
  steps.forEach((s) => {
    const id = String(s.id);
    if (!layout[id]) { layout[id] = { colOffset: 0, row: extra, parentId: null, laneMode: true }; extra++; }
  });
  // A stack that two or more lanes lead into (the combined steps that paths share, which Zapier cannot merge back into one) sits
  // halfway between those lanes, not under the first of them where it reads as that lane's own. Halfway can be half a column when
  // nothing else is in the way; if cards of another lane are, the stack gets a column of its own and the columns from there on move one
  // to the right. The right-hand stacks go first, so the ones to their left can still find room.
  {
    const colsAfter = () => Math.max(...Object.values(layout).map((l) => l.colOffset)) + 1;
    const joins = steps.map((s) => String(s.id)).filter((id) => layout[id] && (sourcesOf.get(id) || []).length > 1).reverse();
    joins.forEach((x) => {
      const X = layout[x]; if (!X) return;
      const srcs = (sourcesOf.get(x) || []).filter((y) => layout[y]);
      const cols = srcs.map((y) => layout[y].colOffset);
      const lo = Math.min(...cols), hi = Math.max(...cols);
      if (lo === hi || (X.colOffset > lo && X.colOffset < hi)) return;
      if (srcs.some((y) => layout[y].row >= X.row)) return;                // a line back up, not a lane joining
      // the stack: this step and the ones that follow it down the same column
      const stack = [x]; let cur = x;
      while (nextOf.has(cur)) {
        const n = nextOf.get(cur); const N = layout[n];
        if (!N || N.colOffset !== X.colOffset || N.row !== layout[cur].row + 1 || (N.parentId && !stack.includes(N.parentId)) || stack.includes(n)) break;
        stack.push(n); cur = n;
      }
      const rows = stack.map((m) => layout[m].row); const r0 = Math.min(...rows), r1 = Math.max(...rows);
      const ideal = (lo + hi) / 2;
      const free = !Object.entries(layout).some(([id, l]) => !stack.includes(id) && l.row >= r0 && l.row <= r1 && Math.abs(l.colOffset - ideal) < 1);
      let at = ideal;
      if (!free) {
        if (colsAfter() + 1 > maxCols) return;
        at = Math.floor(ideal) + 1;
        Object.values(layout).forEach((l) => { if (l.colOffset >= at) l.colOffset += 1; });
      }
      stack.forEach((m) => { layout[m].colOffset = at; });
      const low = srcs.slice().sort((a, b) => layout[a].row - layout[b].row).pop();
      X.parentId = low; X.parentGap = 26; X.after = srcs.slice(); delete X.beside;
    });
  }

  // A lane beside its step (a short line straight across) comes as far back toward the step as its cards, and those of the lanes
  // branching off it, fit: the stacks moved above can leave room nearer than where it was first put.
  Object.keys(layout).forEach((id) => {
    const L = layout[id]; if (!L || !L.beside || !L.parentId || !layout[L.parentId]) return;
    const pc = layout[L.parentId].colOffset;
    const family = new Set([id]);
    for (let grew = true; grew;) {
      grew = false;
      Object.entries(layout).forEach(([oid, o]) => {
        if (family.has(oid)) return;
        if ((o.parentId && family.has(o.parentId)) || (!o.parentId && o.colOffset === L.colOffset && o.row > L.row && nextOf.has([...family].pop()) && false)) { family.add(oid); grew = true; }
      });
      // the plain steps that follow in the same column belong to the lane
      Object.entries(layout).forEach(([oid, o]) => {
        if (family.has(oid) || o.parentId) return;
        const prev = Object.entries(layout).find(([qid, q]) => family.has(qid) && nextOf.get(qid) === oid && q.colOffset === o.colOffset && q.row + 1 === o.row);
        if (prev) { family.add(oid); grew = true; }
      });
    }
    const fam = [...family];
    for (let cc = pc + 1; cc < L.colOffset; cc++) {
      const d = L.colOffset - cc;
      const ok = fam.every((m) => {
        const nc = layout[m].colOffset - d;
        return !Object.entries(layout).some(([oid, o]) => !family.has(oid) && o.row === layout[m].row && Math.abs(o.colOffset - nc) < 1);
      }) && !Object.entries(layout).some(([oid, o]) => !family.has(oid) && o.row === L.row && o.colOffset > pc && o.colOffset < cc);
      if (ok) { fam.forEach((m) => { layout[m].colOffset -= d; }); break; }
    }
  });

  // A lane put beside its step must have nothing between them on that row. Lanes placed after it can end up there (the lane of another
  // step, say), so check once everything is placed, and lay the card out again without "beside" for any lane that has a card in the way.
  const bad = [];
  Object.entries(layout).forEach(([id, li]) => {
    if (!li.beside) return;
    const par = layout[li.parentId]; if (!par) return;
    if (Object.entries(layout).some(([oid, o]) => oid !== id && o.row === li.row && o.colOffset > par.colOffset && o.colOffset < li.colOffset)) bad.push(id);
  });
  if (bad.length) return layoutLanes(res, { ...opts, noBeside: new Set([...(opts.noBeside || []), ...bad]) });
  return layout;
}

// Turns grid positions into real positions once each card's height is known.
//   cards   [{ step, el }] in file order     layout  from layoutLanes()     startY  top of the first row
//   gap     space between cards              hOf(el) card height            minYOf(el)  optional: a card may not start above this
// Every column is stacked on its own, so sibling lanes start level with each other, and the first step of a lane
// is never above the bottom of the step it branches from. Returns { tops: Map(el -> top), bottom }.
export function stackColumns(cards, layout, startY, gap, hOf, minYOf) {
  const colY = new Map();
  const placed = new Map();
  const tops = new Map();
  let bottom = startY;
  // by grid row (file order within a row): a lane placed up beside its parent is stacked before the lanes further down its
  // column, not after them
  const order = cards.map((c, i) => ({ c, i, row: ((layout[String(c.step.id)] || {}).row) || 0 })).sort((a, b) => a.row - b.row || a.i - b.i).map((x) => x.c);
  order.forEach(({ step, el }) => {
    const li = layout[String(step.id)] || { colOffset: 0, parentId: null };
    let top = colY.has(li.colOffset) ? colY.get(li.colOffset) : startY;
    if (li.parentId && placed.has(String(li.parentId))) {
      const pp = placed.get(String(li.parentId));
      top = li.beside ? Math.max(top, pp.top) : Math.max(top, pp.bottom + gap + (li.parentGap || 0));   // beside: level with its step
    }
    (li.after || []).forEach((id) => { if (placed.has(String(id))) top = Math.max(top, placed.get(String(id)).bottom + gap + (li.extraGap || 0)); });   // extraGap: room for a line to run across
    const floor = minYOf ? minYOf(el) : undefined;
    if (floor !== undefined && floor > top) top = floor;
    const h = hOf(el);
    placed.set(String(step.id), { top, bottom: top + h });
    colY.set(li.colOffset, top + h + gap);
    tops.set(el, top);
    bottom = Math.max(bottom, top + h);
  });
  return { tops, bottom };
}
