// ================================================================================================
// FILE: features/zap-reorganize.js
//
// WHAT IT DOES:   Brings the Zap cards that are ALREADY in a project up to the current organizing rules, without
//                 re-importing anything. It uses the same grouping engine as the import (call chains, versions of the same
//                 flow / same trigger, name families), rebuilt from what the cards themselves carry (each step keeps its
//                 role, app, action and catch-hook key; the connections between Zaps are already drawn on the cards).
//
//                 planReorganize()   looks only; changes nothing. Gives the plan and a preview of every move.
//                 applyReorganize()  carries the plan out and returns a backup.
//                 restoreBackup()    puts everything back exactly as it was before applyReorganize().
//
// WHAT IT NEVER TOUCHES:
//   - cards a person placed by hand (a workflow without the "grouped automatically" mark, or a card on a stage with no
//     workflow) unless asked (includeHandPlaced);
//   - Zaps that are off / old / retired / a copy / a test / draft-only (same as the import) unless asked (includeInactive);
//   - global cards, cards that are not Zap imports, positions, statuses, notes, owners, links, tags (it only changes which
//     stage / workflow a card sits in, the workflow list, and the card's "group" label);
//   - workflows a person made (they are only ever added to, and only when a group has exactly their name on that stage).
//
// Running it twice changes nothing the second time.
//
// This file has no DOM and no database access, so it can be tested on its own.
// ================================================================================================

import { planGroups, workflowNote, describeVersions, versionLabel, isInactiveZap, applyHookLinks } from './zap-import-core.js';

export const AUTO_MARK = 'Grouped automatically by the Zap import';
const WF_COLORS = ['#3dd9c5', '#7c3aed', '#f97316', '#38bdf8', '#a78bfa', '#fb923c', '#10b981', '#f43f5e'];

// A workflow the import made (as opposed to one a person made)
export const isAutoWorkflow = (wf) => !!wf && (wf.zapAuto === true || String(wf.description || '').includes(AUTO_MARK));

// A Zap card that came from the import (it carries the Zap's id and per-step Zap details)
export const isImportedZapCard = (r) => !!r && r.type === 'Zap' && !!r.originalZapId && Array.isArray(r.steps) && r.steps.some((s) => s && s.zap && s.zap.stepId);

// The Zap, as the grouping engine wants it, rebuilt from a card. Field values are not kept on cards (they live in the history
// tables), so `mappings` is empty: grouping does not need them, only the "which settings differ" sentence does.
export function cardToZap(card) {
  const steps = (card.steps || []).filter((s) => s && s.zap && s.zap.stepId).map((s) => ({
    stepId: String(s.zap.stepId),
    parentStepId: s.zap.parentStepId ? String(s.zap.parentStepId) : undefined,
    role: s.zap.role, app: s.zap.app, appName: s.appName, action: s.zap.action, actionLabel: s.zap.actionLabel, stepType: s.zap.stepType,
    title: s.name, connectionId: s.zap.connectionId, connectionLabel: s.zap.connectionLabel, hookKey: s.zap.hookKey, mappings: [],
  }));
  const meta = card.zapMeta || {};
  return {
    zapId: String(card.originalZapId),
    zapName: String(card.name || '').replace(/^⚡\s*/, '').trim(),
    editorState: meta.editorState, zapierAccountId: meta.accountId, zapierAccountName: meta.accountName,
    steps,
  };
}

// The connections between Zaps ("a step calls another Zap's catch hook"), read back from the lines the import drew on the cards.
export function linksFromCards(cards) {
  const byId = new Map((cards || []).map((c) => [String(c.id), c]));
  const links = [];
  const seen = new Set();
  for (const c of cards || []) {
    for (const s of c.steps || []) {
      for (const l of (s.logic && s.logic.out) || []) {
        if (!l || !l._hook || !l.targetId) continue;
        const t = String(l.targetId); const i = t.lastIndexOf('-');
        if (i < 0) continue;
        const dst = byId.get(t.slice(0, i)); if (!dst) continue;
        const to = (dst.steps || []).find((x) => String(x.id) === t.slice(i + 1));
        if (!to || !to.zap || !s.zap) continue;
        const key = `${c.originalZapId}|${s.zap.stepId}|${dst.originalZapId}|${to.zap.stepId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        links.push({ fromZapId: String(c.originalZapId), fromStepId: String(s.zap.stepId), toZapId: String(dst.originalZapId), toStepId: String(to.zap.stepId),
          hookKey: l._hook, toName: String(dst.name || '').replace(/^⚡\s*/, '').trim(), fromName: String(c.name || '').replace(/^⚡\s*/, '').trim() });
      }
    }
  }
  return links;
}

const mostCommon = (arr) => { const c = new Map(); arr.forEach((x) => c.set(x, (c.get(x) || 0) + 1)); return [...c].sort((a, b) => b[1] - a[1])[0]?.[0]; };

// ---------- 1. the plan (changes nothing) ---------------------------------------------------------
// opts: groupZaps (default true) | groupBy 'trigger' | stageId (where cards not yet on a stage go) | includeInactive
//       includeHandPlaced | placeUnplaced (default true) | links (from the export, instead of the ones on the cards)
export function planReorganize(pd, opts = {}) {
  const stages = (pd && pd.stages) || [];
  const workflows = (pd && pd.workflows) || [];
  const library = (pd && pd.localResources) || [];
  const wfById = new Map(workflows.map((w) => [String(w.id), w]));
  const cards = library.filter(isImportedZapCard);

  const kept = []; const movable = [];
  for (const c of cards) {
    const zap = cardToZap(c);
    if (c.isGlobal) { kept.push({ cardId: c.id, name: c.name, reason: 'global' }); continue; }
    if (!opts.includeInactive && isInactiveZap(zap)) { kept.push({ cardId: c.id, name: c.name, reason: 'inactive' }); continue; }
    if (!c.stageId) { if (opts.placeUnplaced === false) kept.push({ cardId: c.id, name: c.name, reason: 'not on the map' }); else movable.push(c); continue; }
    const wf = wfById.get(String(c.workflowId));
    if ((wf && isAutoWorkflow(wf)) || opts.includeHandPlaced) movable.push(c);
    else kept.push({ cardId: c.id, name: c.name, reason: 'placed by hand' });
  }

  const zaps = movable.map(cardToZap);
  const links = opts.links || linksFromCards(cards);
  const grouping = opts.groupZaps === false
    ? { workflows: [], other: zaps.map((z) => z.zapId) }
    : planGroups(zaps, links, { groupBy: opts.groupBy === 'trigger' ? 'trigger' : undefined });
  const groups = [...grouping.workflows.map((w) => ({ ...w })), ...(grouping.other.length ? [{ name: 'Other Zaps', kind: 'other', zapIds: grouping.other }] : [])];

  const cardOf = new Map(cards.map((c) => [String(c.originalZapId), c]));
  const defaultStage = (opts.stageId && stages.find((s) => s.id === opts.stageId)) || stages.find((s) => s.name === 'Zapier Automations') || null;

  const planned = new Map();                 // `${stageKey}|${name}` -> planned workflow (several groups can share a name)
  const out = { groups: [], moves: [], kept, removeWorkflows: [], createStage: null, counts: {} };
  const counts = { considered: cards.length, kept: kept.length, moved: 0, placed: 0, unchanged: 0, workflowsCreated: 0, workflowsReused: 0, workflowsRemoved: 0, reordered: 0 };

  const incoming = new Map();                // workflowId -> set of card ids arriving
  const leaving = new Map();                 // workflowId -> set of card ids leaving

  groups.forEach((g, gi) => {
    const gcards = g.zapIds.map((id) => cardOf.get(String(id))).filter(Boolean);
    if (!gcards.length) return;
    const here = mostCommon(gcards.map((c) => c.stageId).filter(Boolean));
    const stage = (here && stages.find((s) => s.id === here)) || defaultStage;
    const stageKey = stage ? stage.id : '__new__';
    if (!stage) out.createStage = out.createStage || { name: opts.stageName || 'Zapier Automations' };
    const key = `${stageKey}|${g.name}`;
    let target = planned.get(key);
    if (!target) {
      const existing = stage ? workflows.find((w) => w.stageId === stage.id && w.name === g.name) : null;
      target = { key, name: g.name, kind: g.kind, stageId: stage ? stage.id : null, stageName: stage ? stage.name : (opts.stageName || 'Zapier Automations'), workflowId: existing ? existing.id : null,
        isNew: !existing, auto: existing ? isAutoWorkflow(existing) : true, zapIds: [], note: g, index: gi, differences: g.differences };
      planned.set(key, target); out.groups.push(target);
      if (existing) counts.workflowsReused++; else counts.workflowsCreated++;
    }
    g.zapIds.forEach((id) => { if (!target.zapIds.includes(String(id))) target.zapIds.push(String(id)); });

    for (const c of gcards) {
      const from = wfById.get(String(c.workflowId));
      const sameSpot = target.workflowId && String(c.workflowId) === String(target.workflowId) && c.stageId === target.stageId;
      const kind = !c.stageId ? 'placed' : sameSpot ? 'same' : 'moved';
      if (kind === 'placed') counts.placed++; else if (kind === 'moved') counts.moved++; else counts.unchanged++;
      out.moves.push({ cardId: c.id, zapId: String(c.originalZapId), name: c.name, kind, fromWorkflow: from ? from.name : null, toWorkflow: g.name, toStage: target.stageName, workflowKind: g.kind });
      if (kind === 'moved' && from) (leaving.get(String(from.id)) || leaving.set(String(from.id), new Set()).get(String(from.id))).add(String(c.id));
      if (kind !== 'same' && target.workflowId) (incoming.get(String(target.workflowId)) || incoming.set(String(target.workflowId), new Set()).get(String(target.workflowId))).add(String(c.id));
    }
  });

  // an automatic workflow that ends up with nobody in it goes away; one that still has someone stays
  for (const wf of workflows) {
    if (!isAutoWorkflow(wf)) continue;
    const ids = new Set((wf.resourceIds || []).map(String));
    for (const id of leaving.get(String(wf.id)) || []) ids.delete(id);
    for (const id of incoming.get(String(wf.id)) || []) ids.add(id);
    // a workflow that is a target of any group is not removed
    const isTarget = out.groups.some((t) => String(t.workflowId) === String(wf.id));
    if (!ids.size && !isTarget && (leaving.get(String(wf.id)) || []).size) { out.removeWorkflows.push({ id: wf.id, name: wf.name }); counts.workflowsRemoved++; }
  }

  // order inside an automatic workflow follows the plan (for a chain: the order the Zaps run)
  for (const t of out.groups) {
    if (!t.workflowId || !t.auto) continue;
    const wf = wfById.get(String(t.workflowId));
    const current = (wf.resourceIds || []).map(String);
    const wanted = t.zapIds.map((zid) => cardOf.get(String(zid))).filter(Boolean).map((c) => String(c.id));
    const currentOfGroup = current.filter((id) => wanted.includes(id));
    if (currentOfGroup.length === wanted.length && currentOfGroup.some((id, i) => id !== wanted[i])) { t.reorder = true; counts.reordered++; }
    t.sameMembers = current.length === wanted.length && current.every((id) => wanted.includes(id));     // the same Zaps as before
  }

  out.counts = counts;
  return out;
}

// ---------- 2. backup / undo ----------------------------------------------------------------------
// Small: the workflow list as it was, and for each Zap card only which stage / workflow it was in and its group label.
const CARD_FIELDS = ['stageId', 'workflowId', 'isGlobal'];
export function makeBackup(pd, now = () => new Date()) {
  return {
    kind: 'zap-reorganize-backup', version: 1, at: now().toISOString(),
    stageIds: (pd.stages || []).map((s) => s.id),
    workflows: JSON.parse(JSON.stringify(pd.workflows || [])),
    cards: (pd.localResources || []).filter(isImportedZapCard).map((c) => ({
      id: c.id,
      fields: CARD_FIELDS.map((k) => ({ k, has: Object.prototype.hasOwnProperty.call(c, k), v: c[k] === undefined ? null : c[k] })),
      hadGroup: !!(c.zapMeta && c.zapMeta.group), group: c.zapMeta && c.zapMeta.group ? JSON.parse(JSON.stringify(c.zapMeta.group)) : null,
    })),
  };
}

export function restoreBackup(pd, backup) {
  if (!backup || backup.kind !== 'zap-reorganize-backup') throw new Error('That is not a Zap reorganize backup.');
  pd.workflows = JSON.parse(JSON.stringify(backup.workflows));
  const byId = new Map((pd.localResources || []).map((r) => [String(r.id), r]));
  let restored = 0;
  for (const b of backup.cards) {
    const c = byId.get(String(b.id)); if (!c) continue;
    for (const f of b.fields) { if (f.has) c[f.k] = f.v; else delete c[f.k]; }
    if (c.zapMeta) {
      c.zapMeta = Object.assign({}, c.zapMeta);
      if (b.hadGroup) c.zapMeta.group = JSON.parse(JSON.stringify(b.group)); else delete c.zapMeta.group;
    } else if (b.hadGroup) c.zapMeta = { group: JSON.parse(JSON.stringify(b.group)) };
    restored++;
  }
  // a stage this run created, if nothing uses it any more
  const keep = new Set(backup.stageIds);
  pd.stages = (pd.stages || []).filter((s) => keep.has(s.id) || (pd.workflows || []).some((w) => w.stageId === s.id) || (pd.localResources || []).some((r) => r.stageId === s.id));
  return { restored };
}

// ---------- 3. carrying it out --------------------------------------------------------------------
// opts: makeId, zapsById (the export, for the "which settings differ" sentence), links (from the export: redraws the
// connections between Zaps), now. Returns the counts and a backup.
export function applyReorganize(pd, plan, opts = {}) {
  const makeId = opts.makeId || (() => Math.random().toString(36).slice(2, 9));
  const backup = makeBackup(pd, opts.now);
  pd.stages = pd.stages || []; pd.workflows = pd.workflows || [];
  const library = pd.localResources || [];
  const cardOf = (zapId) => library.find((r) => isImportedZapCard(r) && String(r.originalZapId) === String(zapId));

  let newStage = null;
  if (plan.createStage) {
    newStage = pd.stages.find((s) => s.name === plan.createStage.name) || null;
    if (!newStage) { newStage = { id: `stage-${makeId()}`, name: plan.createStage.name, width: 400 }; pd.stages.push(newStage); }
  }
  const removed = new Set(plan.removeWorkflows.map((w) => String(w.id)));

  for (const t of plan.groups) {
    const stageId = t.stageId || (newStage && newStage.id);
    let wf = t.workflowId ? pd.workflows.find((w) => String(w.id) === String(t.workflowId)) : pd.workflows.find((w) => w.stageId === stageId && w.name === t.name);
    if (!wf) {
      wf = { id: `wf-${makeId()}`, name: t.name, stageId, color: WF_COLORS[t.index % WF_COLORS.length], resourceIds: [], description: workflowNote(t.note || t), zapAuto: true };
      pd.workflows.push(wf);
    }
    // The note says why these Zaps are together. An automatic workflow gets the current wording. With the export in hand it also
    // says which settings differ; without it (cards do not keep field values), a note that already says so is kept when the
    // Zaps in the workflow are the same as before, rather than being replaced by a shorter one.
    if (isAutoWorkflow(wf) && !t.isNew) {
      const note = { ...(t.note || t), kind: t.kind, zapIds: t.zapIds };
      const sibs = opts.zapsById ? t.zapIds.map((id) => opts.zapsById.get(String(id))).filter(Boolean) : [];
      if (sibs.length && ['versions', 'family', 'trigger'].includes(t.kind)) wf.description = workflowNote({ ...note, differences: describeVersions(sibs) });
      else if (!(t.sameMembers && /settings that differ/.test(String(wf.description || '')))) wf.description = workflowNote(note);
    }
    const siblingsZaps = t.zapIds.map((id) => { const c = cardOf(id); return c ? cardToZap(c) : null; }).filter(Boolean);
    for (const zid of t.zapIds) {
      const c = cardOf(zid); if (!c) continue;
      const old = c.workflowId ? pd.workflows.find((w) => String(w.id) === String(c.workflowId)) : null;
      if (old && String(old.id) !== String(wf.id)) old.resourceIds = (old.resourceIds || []).filter((id) => String(id) !== String(c.id));
      c.stageId = stageId; c.workflowId = wf.id; c.isGlobal = false;
      if (!(wf.resourceIds || []).map(String).includes(String(c.id))) { wf.resourceIds = wf.resourceIds || []; wf.resourceIds.push(String(c.id)); }
      const meta = Object.assign({}, c.zapMeta);
      if (['versions', 'family', 'trigger'].includes(t.kind)) meta.group = { name: t.name, kind: t.kind, size: t.zapIds.length, label: versionLabel(cardToZap(c), siblingsZaps) || undefined };
      else delete meta.group;
      c.zapMeta = meta;
    }
    if (t.auto) {                                            // an automatic workflow follows the plan's order (a chain: the order the Zaps run)
      const wanted = t.zapIds.map((id) => cardOf(id)).filter(Boolean).map((c) => String(c.id));
      const rest = (wf.resourceIds || []).map(String).filter((id) => !wanted.includes(id));
      wf.resourceIds = [...wanted, ...rest];
    }
  }
  pd.workflows = pd.workflows.filter((w) => !(removed.has(String(w.id)) && !(w.resourceIds || []).length));

  let connections = 0;
  if (opts.links) connections = applyHookLinks(library, opts.links);
  return { ...plan.counts, connections, backup };
}
