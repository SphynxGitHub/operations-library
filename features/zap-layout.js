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

export const isLaneResource = (res) => !!(res && (res.zapMeta || res.originalZapId));
export const isLaneLayout = (layout) => { const first = layout && Object.values(layout)[0]; return !!(first && first.laneMode); };

// Returns { [stepId]: { colOffset, row, parentId, laneMode: true, after? } }.
//   colOffset  which column (0 = the main column, 1 = the next one to the right ...)
//   row        a grid row (steps in one lane are on consecutive rows; sibling lanes start on the SAME row)
//   parentId   for the first step of a lane: the step it branches from (null for every other step)
//   after      for a lane that WRAPPED onto a new band below its siblings: the steps it must clear
// opts.maxCols  the most columns that fit the window (default: no limit). Lanes that would not fit wrap onto a new band
//               below instead of running off the side, so a narrow window gives a taller, narrower diagram.
export function layoutLanes(res, opts = {}) {
  const maxCols = Math.max(1, Math.floor(opts.maxCols || Infinity) || Infinity);
  const steps = res.steps || [];
  const byId = new Map(steps.map((s) => [String(s.id), s]));
  const nextOf = new Map();       // step -> the step that follows it in the same lane
  const branchesOf = new Map();   // step -> the first steps of the lanes that branch from it, in order
  const heads = new Set();        // steps that start a lane

  steps.forEach((s) => {
    const sid = String(s.id);
    (s.logic && s.logic.out ? s.logic.out : []).forEach((l) => {
      if (!l || !l.targetId) return;
      const t = String(l.targetId);
      const i = t.lastIndexOf('-');
      if (i === -1 || t.slice(0, i) !== String(res.id)) return;           // links to other cards are not part of this layout
      const tid = t.slice(i + 1);
      if (!byId.has(tid) || tid === sid) return;
      const types = l.types || [l.type || 'next'];
      if (types.some((x) => BRANCH_TYPES.has(x))) {
        const list = branchesOf.get(sid) || [];
        if (!list.includes(tid)) list.push(tid);
        branchesOf.set(sid, list);
        heads.add(tid);
      } else if (!nextOf.has(sid)) {
        nextOf.set(sid, tid);
      }
    });
  });

  const chainOf = (head) => {
    const out = [head]; const seen = new Set(out);
    let cur = head;
    while (nextOf.has(cur)) {
      const n = nextOf.get(cur);
      if (seen.has(n) || heads.has(n)) break;
      out.push(n); seen.add(n); cur = n;
    }
    return out;
  };

  // steps that sit in a lane (a head, or reached from a head by following "next")
  const inLane = new Set();
  heads.forEach((h) => chainOf(String(h)).forEach((m) => inLane.add(m)));
  const main = steps.map((s) => String(s.id)).filter((id) => !inLane.has(id));

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
      w = Math.max(w, nextOf.has(m) ? 1 + sum : Math.max(1, sum));
    }
    w = Math.min(w, maxCols);
    widthMemo.set(head, w);
    return w;
  };

  const layout = {};
  // Places one lane and everything that branches off it. Returns { bottom: last row used, ids: every step placed }.
  const placeLane = (head, col, row, parentId, after) => {
    const members = chainOf(head);
    if (layout[head]) return { bottom: row - 1, ids: [] };
    const ids = [];
    members.forEach((m, i) => {
      layout[m] = { colOffset: col, row: row + i, parentId: i === 0 ? parentId : null, laneMode: true };
      if (i === 0 && after && after.length) layout[m].after = after.slice();
      ids.push(m);
    });
    let bottom = row + members.length - 1;
    members.forEach((m, i) => {
      let c0 = col + (nextOf.has(m) ? 1 : 0);                            // a step that carries on leaves its own column to the main flow
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
      if (c + w > maxCols && c > c0) {                                   // wrap onto a new band
        bandRow = bandBottom + 1; c = c0; bandBottom = bandRow - 1;
        after = baseAfter.concat(placedIds);
      }
      const got = placeLane(k, c, bandRow, m, after);
      got.ids.forEach((x) => placedIds.push(x));
      bandBottom = Math.max(bandBottom, got.bottom); bottom = Math.max(bottom, got.bottom);
      c += w;
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

  // anything left (for example a lane whose parent is missing) goes at the bottom of the main column
  let extra = Math.max(-1, ...Object.values(layout).map((l) => l.row)) + 1;
  steps.forEach((s) => {
    const id = String(s.id);
    if (!layout[id]) { layout[id] = { colOffset: 0, row: extra, parentId: null, laneMode: true }; extra++; }
  });
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
  cards.forEach(({ step, el }) => {
    const li = layout[String(step.id)] || { colOffset: 0, parentId: null };
    let top = colY.has(li.colOffset) ? colY.get(li.colOffset) : startY;
    if (li.parentId && placed.has(String(li.parentId))) top = Math.max(top, placed.get(String(li.parentId)).bottom + gap);
    (li.after || []).forEach((id) => { if (placed.has(String(id))) top = Math.max(top, placed.get(String(id)).bottom + gap); });
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
