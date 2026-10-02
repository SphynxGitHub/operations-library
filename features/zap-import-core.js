// ================================================================================================
// FILE: features/zap-import-core.js
//
// WHAT IT DOES:   The engine behind the Zap import. No screens, no database, no browser calls, so it can be
//                 tested on its own. It takes the JSON written by the Zapier export script and:
//                   1. planImport()       compares an export with what was saved last time: new / changed /
//                                         unchanged Zaps, plus Zaps that have gone missing.
//                   2. diffZaps()         lists exactly what changed in one Zap (step, field, old -> new).
//                   3. zapToResource()    builds an OL Zap card: real steps, real branches (paths, error handlers),
//                                         the Zapier link, and a plain-English line for every step.
//                   4. mergeIntoExisting() updates an existing card without losing positions, hand-drawn links,
//                                         data tags or assignees.
//                   5. discoverResources() finds folders and spreadsheets a Zap uses (exact field names, per app).
//
// USED BY:        The import screen (next step). Nothing calls this file yet.
//
// KEY IDEAS:      - A step is identified by Zapier's own step id (kept as step.zap.stepId), never by its name,
//                   so renaming a step in Zapier no longer breaks anything.
//                 - Links this file draws are marked _auto: true. Links you draw by hand have no _auto and are
//                   kept on every re-import.
//                 - Field values are NOT stored on the OL card (they would bloat the project). They live in the
//                   zap_snapshots table and are searched there.
// ================================================================================================

// ---------- small helpers ----------------------------------------------------------------------

import { extractExternalRefs, tieExternalToZaps } from '../core/external-sync.js';
export { tieExternalToZaps };

const firstDefined = (...v) => v.find((x) => x !== undefined && x !== null && x !== '');

// A fast, non-cryptographic fingerprint (cyrb53) of any JSON-able value, to tell "changed" from "unchanged".
export function fingerprint(value) {
  const str = stableStringify(value);
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

function stableStringify(v) {
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
  }
  return JSON.stringify(v);
}

const baseApp = (app) => String(app || '').split('@')[0];

function cleanAppName(app) {
  const b = baseApp(app).replace(/CLIAPI|API$/g, '').replace(/V\d+$/, '');
  return b ? b.replace(/([A-Z])/g, ' $1').trim() : 'System';
}

const mapping = (step, field) => (step.mappings || []).find((m) => m.field === field);
const mappingValue = (step, field) => { const m = mapping(step, field); return m ? String(m.value) : undefined; };

// ---------- plain English ----------------------------------------------------------------------

const OPERATORS = {
  iexist: 'exists', exist: 'exists', nexist: 'does not exist', inexist: 'does not exist',
  icontains: 'contains', contains: 'contains', nicontains: 'does not contain', ncontains: 'does not contain',
  iexact: 'is exactly', exact: 'is exactly', niexact: 'is not', nexact: 'is not',
  idategreater: 'is after', dategreater: 'is after', idateless: 'is before', dateless: 'is before',
  igreater: 'is greater than', greater: 'is greater than', iless: 'is less than', less: 'is less than',
  istartswith: 'starts with', startswith: 'starts with', iendswith: 'ends with', endswith: 'ends with',
  boolean: 'is',
};

const stepLabel = (byId, id) => {
  const s = byId && byId.get(String(id));
  return s ? `"${s.title}"` : `step ${id}`;
};

// {{=gives["123"]["a"]["b"]}}, {{=output['123']["a"]}}, {{123__a__b}}  ->  "<step title>" a › b
export function explainText(text, byId) {
  let out = String(text == null ? '' : text);
  out = out.replace(/\{\{=\s*(?:gives|output)\[\s*\\*["'](\d+)\\*["']\s*\]((?:\s*\[\s*\\*["'](?:[^"'\\\]\[]|\[\])+\\*["']\s*\])*)\s*\}\}/g,
    (m, id, rest) => {
      const parts = [...rest.matchAll(/\[\s*\\*["']((?:[^"'\\\]\[]|\[\])+)\\*["']\s*\]/g)].map((x) => x[1]);
      return `${stepLabel(byId, id)}${parts.length ? ' ' + parts.join(' › ') : ''}`;
    });
  out = out.replace(/\{\{\s*(\d+)__([^}\s]+?)\s*\}\}/g, (m, id, p) => `${stepLabel(byId, id)} ${p.split('__').join(' › ')}`);
  out = out.replace(/^(\d+)__(.+)$/, (m, id, p) => `${stepLabel(byId, id)} ${p.split('__').join(' › ')}`);  // a bare key
  return out.trim();
}

// Zapier stores a filter / path condition as a list of rules. Rules that share a "group" are ANDed, groups are ORed.
// Each rule says whether to "continue" or "stop" when it matches.
export function describeCriteria(json, byId) {
  let rules;
  try { rules = typeof json === 'string' ? JSON.parse(json) : json; } catch { return ''; }
  if (!Array.isArray(rules) || !rules.length) return '';
  const groups = new Map();
  for (const r of rules) {
    if (!r || typeof r !== 'object') continue;
    const g = String(r.group ?? 'g');
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(r);
  }
  const INVERSE = {
    iexist: 'does not exist', exist: 'does not exist', icontains: 'does not contain', contains: 'does not contain',
    iexact: 'is not', exact: 'is not', istartswith: 'does not start with', startswith: 'does not start with',
    iendswith: 'does not end with', endswith: 'does not end with', idategreater: 'is not after', idateless: 'is not before',
    igreater: 'is not greater than', iless: 'is not less than',
  };
  const phrase = (r, negate = false) => {
    const subject = explainText(r.key, byId) || '(blank)';
    if (r.match === 'boolean') {                           // an empty value means "is true"
      const isTrue = ['', 'true'].includes(String(r.value ?? '').toLowerCase());
      return `${subject} ${isTrue !== negate ? 'is true' : 'is false'}`;
    }
    const noValue = ['iexist', 'exist', 'nexist', 'inexist'].includes(r.match);
    const op = negate ? (INVERSE[r.match] || `is not (${OPERATORS[r.match] || r.match})`) : (OPERATORS[r.match] || (r.match ? String(r.match).replace(/^i/, '') : 'is'));
    const val = noValue ? '' : ` ${explainText(r.value, byId) || '(blank)'}`;
    return `${subject} ${op}${val}`;
  };
  const parts = [...groups.values()].map((list) => {
    const stop = list.every((r) => r.action === 'stop');
    if (stop && list.length === 1) return phrase(list[0], true);          // "stop if X exists" reads as "X does not exist"
    const text = list.map((r) => phrase(r)).join(' AND ');
    return stop ? `NOT (${text})` : text;
  });
  return parts.length > 1 ? parts.map((p) => `(${p})`).join(' OR ') : parts[0];
}

// One plain-English line per step, worded the same way for every Zap.
export function summarizeStep(step, byId) {
  const app = step.appName || cleanAppName(step.app);
  const name = step.title || step.actionLabel || step.action || 'step';
  switch (step.role) {
    case 'trigger': {
      const hook = step.hookKey ? ` (catch hook ${step.hookKey})` : '';
      return `When: ${name} [${app}]${hook}`;
    }
    case 'search': {
      const miss = String(mappingValue(step, '_zap_search_success_on_miss') || '').toLowerCase();
      const orCreate = step.stepType === 'search_or_write';
      const missText = orCreate ? ' If nothing is found, it creates it.'
        : miss === 'true' ? ' If nothing is found, it carries on.'
        : miss === 'false' ? ' If nothing is found, it stops.' : '';
      return `${orCreate ? 'Find or create' : 'Find'}: ${name} [${app}].${missText}`;
    }
    case 'filter': {
      const c = describeCriteria(mappingValue(step, 'filter_criteria'), byId);
      const stop = /"action":"stop"/.test(mappingValue(step, 'filter_criteria') || '');
      return c ? `${stop ? 'Stop unless' : 'Only continue if'} ${c}` : `Filter: ${name}`;
    }
    case 'paths': return 'Split into paths';
    case 'path': {
      const c = describeCriteria(mappingValue(step, 'filter_criteria'), byId);
      return `Path "${name}"${c ? ` runs when ${c}` : ''}`;
    }
    case 'error-wrapper': return 'Error handling: protects the step below';
    case 'error-handler': return 'If the step above fails, it does this instead';
    case 'loop': return `Loop: ${name}`;
    case 'delay': return `Wait: ${name}`;
    case 'code': return `Runs code: ${name}`;
    case 'formatter': return `Formats data: ${name} [${app}]`;
    default: return `${name} [${app}]`;
  }
}

// ---------- flow (links between steps) ---------------------------------------------------------

const linkTo = (resId, stepId, type, rule) => ({
  type, types: [type], targetId: `${resId}-z${stepId}`, rule: rule || '',
  loopLimit: '', delayValue: '', delayUnit: 'days', _auto: true,
});

// Builds { stepId: [links] } from the parent structure Zapier exported.
export function buildFlow(zap, resId, byId) {
  const steps = zap.steps || [];
  const kids = new Map();
  const top = [];
  for (const s of steps) {
    if (s.parentStepId && byId.has(String(s.parentStepId))) {
      const k = kids.get(String(s.parentStepId)) || [];
      k.push(s); kids.set(String(s.parentStepId), k);
    } else top.push(s);
  }
  const out = new Map(steps.map((s) => [String(s.stepId), []]));
  const add = (from, to, type, rule) => { if (from && to) out.get(String(from.stepId)).push(linkTo(resId, to.stepId, type, rule)); };

  // list = sibling steps in order; after = the step the flow continues to after the last one (or null)
  const walk = (list, after) => {
    list.forEach((st, i) => {
      const next = list[i + 1] || after || null;
      const children = kids.get(String(st.stepId)) || [];
      if (st.role === 'paths') {
        children.forEach((p) => add(st, p, 'condition', describeCriteria(mappingValue(p, 'filter_criteria'), byId)));
        children.forEach((p) => walk([p], null));
      } else if (st.role === 'path') {
        if (children.length) { add(st, children[0], 'next', ''); walk(children, null); }
      } else if (st.role === 'error-wrapper') {
        const guarded = children.filter((c) => c.role !== 'error-handler');
        const handler = children.find((c) => c.role === 'error-handler');
        if (guarded.length) {
          add(st, guarded[0], 'next', '');
          walk(guarded, next);
          if (handler) add(guarded[guarded.length - 1], handler, 'condition', 'If this step fails');
        } else {
          add(st, next, 'next', '');
          if (handler) add(st, handler, 'condition', 'If the protected step fails');
        }
        if (handler) {
          const hk = kids.get(String(handler.stepId)) || [];
          if (hk.length) { add(handler, hk[0], 'next', ''); walk(hk, next); }
        }
      } else if (st.role === 'error-handler') {
        // drawn by its error-wrapper above
      } else if (next) {
        const rule = st.role === 'filter' ? describeCriteria(mappingValue(st, 'filter_criteria'), byId) : '';
        add(st, next, 'next', rule);
      }
    });
  };
  walk(top, null);
  return out;
}

// ---------- building an OL card ----------------------------------------------------------------

export function zapEditorUrl(zapId) { return `https://zapier.com/editor/${zapId}`; }

export function zapToResource(zap, opts = {}) {
  const resId = opts.resourceId || `zap-${zap.zapId}`;
  const byId = new Map((zap.steps || []).map((s) => [String(s.stepId), s]));
  const flow = buildFlow(zap, resId, byId);

  const steps = (zap.steps || []).map((s) => ({
    id: `z${s.stepId}`,
    name: s.title || s.actionLabel || s.action || 'Untitled Step',
    appName: s.appName || cleanAppName(s.app),
    assignees: s.role === 'trigger' ? [{ id: 'role-client', name: 'Any Client', type: 'role' }] : [{ id: 'zap-auto', name: 'Zapier', type: 'app' }],
    logic: { in: [], out: flow.get(String(s.stepId)) || [] },
    links: [],
    datapoints: [],
    zap: {
      stepId: String(s.stepId),
      parentStepId: s.parentStepId ? String(s.parentStepId) : undefined,
      role: s.role, action: s.action, actionLabel: s.actionLabel, stepType: s.stepType,
      app: s.app, hasCustomTitle: s.hasCustomTitle,
      connectionId: s.connectionId, connectionLabel: s.connectionLabel,
      hookKey: s.hookKey, hasAutomaticIssues: s.hasAutomaticIssues || undefined,
      summary: summarizeStep(s, byId),
      refs: (() => { const r = extractExternalRefs(s); return r.length ? r : undefined; })(),   // forms, event types, templates this step uses (core/external-sync.js)
    },
  }));

  return {
    id: resId,
    type: 'Zap',
    archetype: 'Multi-Step',
    name: String(zap.zapName || `Zap ${zap.zapId}`).replace(/^⚡\s*/, '').trim(),
    source: 'zapier',
    originalZapId: String(zap.zapId),
    externalUrl: zapEditorUrl(zap.zapId),
    isExpanded: true,
    steps,
    zapMeta: {
      editorState: zap.editorState || undefined,
      accountId: zap.zapierAccountId, accountName: zap.zapierAccountName,
      timezone: zap.timezone, contentHash: fingerprint(zap.steps || []),
      trigger: triggerInfo(zap).label || undefined,
    },
  };
}

// Keeps everything a person did by hand on an existing card (status, description, notes, owner, position, tags...).
// Only the fields the import itself owns are replaced.
const IMPORT_OWNED = ['type', 'archetype', 'name', 'source', 'originalZapId', 'externalUrl', 'steps', 'zapMeta'];
export function mergeIntoExisting(oldRes, newRes) {
  const merged = { ...oldRes };
  for (const k of IMPORT_OWNED) if (newRes[k] !== undefined) merged[k] = newRes[k];
  if (merged.isExpanded === undefined) merged.isExpanded = newRes.isExpanded;
  const oldByZapId = new Map();
  const oldByName = new Map();
  (oldRes.steps || []).forEach((s) => { if (s.zap && s.zap.stepId) oldByZapId.set(String(s.zap.stepId), s); else oldByName.set(s.name, s); });

  const newIdFor = new Map();
  merged.steps = newRes.steps.map((ns) => {
    const os = oldByZapId.get(String(ns.zap.stepId)) || oldByName.get(ns.name);
    if (!os) return ns;
    newIdFor.set(ns.id, os.id);
    const hand = (os.logic && os.logic.out ? os.logic.out : []).filter((l) => l.targetId && !l._auto);
    return {
      ...ns,
      id: os.id,                                           // the old id keeps links from other cards working
      assignees: os.assignees && os.assignees.length ? os.assignees : ns.assignees,
      links: os.links || [],
      datapoints: os.datapoints || [],
      logic: { in: [], out: [...ns.logic.out, ...hand] },
    };
  });
  // the auto links were written with the new card's id and new step ids; point them at the kept ones
  const newPrefix = `${newRes.id}-`;
  const prefix = `${merged.id}-`;
  merged.steps.forEach((s) => s.logic.out.forEach((l) => {
    if (!l._auto) return;
    const t = String(l.targetId);
    const tail = t.startsWith(newPrefix) ? t.slice(newPrefix.length) : t.slice(t.lastIndexOf('-') + 1);
    l.targetId = `${prefix}${newIdFor.get(tail) || tail}`;
  }));
  return merged;
}

// ---------- comparing two versions of a Zap ----------------------------------------------------

export function diffZaps(oldZap, newZap) {
  const changes = [];
  const base = { zap_id: String((newZap || oldZap).zapId), zap_name: (newZap || oldZap).zapName };
  const push = (c) => changes.push({ ...base, step_id: null, step_title: null, field: null, old_value: null, new_value: null, old_hash: null, new_hash: null, ...c });

  if (!oldZap) { push({ change_type: 'zap_added', new_value: newZap.zapName }); return changes; }
  if (!newZap) { push({ change_type: 'zap_removed', old_value: oldZap.zapName }); return changes; }
  if (oldZap.zapName !== newZap.zapName) push({ change_type: 'zap_renamed', old_value: oldZap.zapName, new_value: newZap.zapName });
  if ((oldZap.editorState || '') !== (newZap.editorState || '')) push({ change_type: 'state_changed', old_value: oldZap.editorState || null, new_value: newZap.editorState || null });

  const oldSteps = new Map((oldZap.steps || []).map((s) => [String(s.stepId), s]));
  const newSteps = new Map((newZap.steps || []).map((s) => [String(s.stepId), s]));
  for (const [id, s] of newSteps) if (!oldSteps.has(id)) push({ change_type: 'step_added', step_id: id, step_title: s.title, new_value: `${s.appName || baseApp(s.app)}: ${s.title}` });
  for (const [id, s] of oldSteps) if (!newSteps.has(id)) push({ change_type: 'step_removed', step_id: id, step_title: s.title, old_value: `${s.appName || baseApp(s.app)}: ${s.title}` });

  for (const [id, n] of newSteps) {
    const o = oldSteps.get(id);
    if (!o) continue;
    const at = { step_id: id, step_title: n.title };
    if (o.title !== n.title) push({ ...at, change_type: 'step_renamed', old_value: o.title, new_value: n.title });
    if (baseApp(o.app) !== baseApp(n.app)) push({ ...at, change_type: 'app_changed', old_value: o.appName || baseApp(o.app), new_value: n.appName || baseApp(n.app) });
    else if (o.app !== n.app) push({ ...at, change_type: 'app_version_changed', old_value: o.app, new_value: n.app });
    if ((o.action || '') !== (n.action || '')) push({ ...at, change_type: 'action_changed', old_value: o.actionLabel || o.action || null, new_value: n.actionLabel || n.action || null });
    if ((o.connectionId || '') !== (n.connectionId || '')) push({ ...at, change_type: 'connection_changed', old_value: o.connectionLabel || o.connectionId || null, new_value: n.connectionLabel || n.connectionId || null });
    if ((o.parentStepId || '') !== (n.parentStepId || '')) push({ ...at, change_type: 'step_moved', old_value: o.parentStepId || null, new_value: n.parentStepId || null });

    const of = new Map((o.mappings || []).map((m) => [m.field, m]));
    const nf = new Map((n.mappings || []).map((m) => [m.field, m]));
    for (const [f, m] of nf) {
      const om = of.get(f);
      if (!om) push({ ...at, change_type: 'field_added', field: f, new_value: m.value, new_hash: m.hash || null });
      else if ((om.hash && m.hash ? om.hash !== m.hash : om.value !== m.value)) {
        push({ ...at, change_type: 'field_changed', field: f, old_value: om.value, new_value: m.value, old_hash: om.hash || null, new_hash: m.hash || null });
      }
    }
    for (const [f, m] of of) if (!nf.has(f)) push({ ...at, change_type: 'field_removed', field: f, old_value: m.value, old_hash: m.hash || null });
  }
  return changes;
}

// previous: Map of zapId -> the last saved Zap (or null/undefined if none). exportJson: the array from the export file.
export function planImport(previous, exportJson) {
  const prev = previous instanceof Map ? previous : new Map(Object.entries(previous || {}));
  const items = [];
  const seen = new Set();
  for (const zap of Array.isArray(exportJson) ? exportJson : []) {
    const id = String(zap.zapId);
    seen.add(id);
    const old = prev.get(id);
    const hash = fingerprint(zap.steps || []);
    const named = { zapId: id, name: zap.zapName, editorState: zap.editorState, zap, hash };
    if (!old) { items.push({ ...named, status: 'new', changes: [{ change_type: 'zap_added', zap_id: id, zap_name: zap.zapName }] }); continue; }
    const changes = diffZaps(old, zap);
    items.push({ ...named, status: changes.length ? 'changed' : 'unchanged', changes });
  }
  const missing = [...prev.entries()].filter(([id]) => !seen.has(id)).map(([id, z]) => ({ zapId: id, name: z.zapName }));
  const count = (s) => items.filter((i) => i.status === s).length;
  return { items, missing, counts: { new: count('new'), changed: count('changed'), unchanged: count('unchanged'), missing: missing.length } };
}

// ---------- folders and spreadsheets a Zap uses ------------------------------------------------

// Exact field names only ("folder", "folder_id", "spreadsheet_id"...), never "transform" or "bodyFormat".
const FOLDER_FIELDS = /^(folder|folder_id|folderid|parent_folder|parentfolder|drive_folder|folder_path)$/i;
const SHEET_FIELDS = /^(spreadsheet|spreadsheet_id|spreadsheetid|worksheet|file_id|fileid|workbook|workbook_id)$/i;
const JUNK_VALUES = /^(shared|root|me|none|null|true|false|default|all|any|\d{1,3})$/i;
const looksLikeId = (v) => /^[A-Za-z0-9_-]{15,}$/.test(v);

// Returns [{ kind: 'Folder'|'Spreadsheet', app, appName, field, value, label, url|null, stepIds: [...] }] for one Zap.
export function discoverResources(zap) {
  const byKey = new Map();
  for (const s of zap.steps || []) {
    const app = baseApp(s.app);
    for (const m of s.mappings || []) {
      const v = String(m.value == null ? '' : m.value).trim();
      if (!v || v.includes('{{') || v === '[redacted]') continue;
      const kind = FOLDER_FIELDS.test(m.field) ? 'Folder' : SHEET_FIELDS.test(m.field) ? 'Spreadsheet' : null;
      if (!kind) continue;
      // a file or spreadsheet must look like a link, an id or a path; a folder just must not be a placeholder word
      if (JUNK_VALUES.test(v)) continue;
      if (kind === 'Spreadsheet' && !(/^https?:\/\//.test(v) || looksLikeId(v) || v.includes('/'))) continue;
      let url = null;
      if (/^https?:\/\//.test(v)) url = v;
      else if (/^Google(Drive|Sheets)/.test(app) && looksLikeId(v)) url = kind === 'Folder' ? `https://drive.google.com/drive/folders/${v}` : `https://docs.google.com/spreadsheets/d/${v}`;
      // SharePoint / Outlook / Excel values are paths or internal ids: kept as labels, never turned into Google links
      const key = `${kind}|${app}|${v}`;
      const entry = byKey.get(key) || { kind, app, appName: s.appName || cleanAppName(s.app), field: m.field, value: v, label: m.display || v, url, stepIds: [] };
      if (!entry.stepIds.includes(String(s.stepId))) entry.stepIds.push(String(s.stepId));
      byKey.set(key, entry);
    }
  }
  return [...byKey.values()];
}

// ---------- connections between Zaps (catch hooks) ---------------------------------------------

const HOOK_URL = /hooks\.zapier\.com\/hooks\/catch\/\d+\/(\w+)/g;

// A step that POSTs to a Zapier catch-hook address starts the Zap whose trigger owns that hook. The hook is
// identified by the last part of the address (the number before it can differ), which the export records as hookKey.
export function findHookLinks(zaps) {
  const receivers = new Map();
  for (const z of zaps || []) {
    for (const s of z.steps || []) {
      if (s.hookKey && s.role === 'trigger') receivers.set(String(s.hookKey), { zapId: String(z.zapId), stepId: String(s.stepId), name: z.zapName });
    }
  }
  const links = [];
  const unmatched = [];
  const seen = new Set();
  for (const z of zaps || []) {
    for (const s of z.steps || []) {
      if (s.role === 'trigger') continue;
      for (const m of s.mappings || []) {
        for (const mm of String(m.value == null ? '' : m.value).matchAll(HOOK_URL)) {
          const key = mm[1];
          const to = receivers.get(key);
          const id = `${z.zapId}|${s.stepId}|${key}`;
          if (seen.has(id)) continue;
          seen.add(id);
          if (!to) { unmatched.push({ fromZapId: String(z.zapId), fromStepId: String(s.stepId), hookKey: key, fromName: z.zapName }); continue; }
          if (to.zapId === String(z.zapId)) continue;
          links.push({ fromZapId: String(z.zapId), fromStepId: String(s.stepId), toZapId: to.zapId, toStepId: to.stepId, hookKey: key, toName: to.name, fromName: z.zapName });
        }
      }
    }
  }
  return { links, unmatched };
}

// Draws the connections on the cards themselves. Old automatic hook links are removed first so a re-import never
// doubles them up. Only links whose two cards both exist (and both have the steps) are added.
export function applyHookLinks(library, links) {
  const cards = (library || []).filter((r) => r && r.type === 'Zap');
  cards.forEach((c) => (c.steps || []).forEach((s) => { if (s.logic && Array.isArray(s.logic.out)) s.logic.out = s.logic.out.filter((l) => !l._hook); }));
  const cardOf = (zapId) => cards.find((r) => String(r.originalZapId) === String(zapId));
  const stepOf = (card, stepId) => card && (card.steps || []).find((s) => s.zap && String(s.zap.stepId) === String(stepId));
  let added = 0;
  for (const l of links || []) {
    const src = cardOf(l.fromZapId); const dst = cardOf(l.toZapId);
    const from = stepOf(src, l.fromStepId); const to = stepOf(dst, l.toStepId);
    if (!from || !to) continue;
    from.logic = from.logic || { in: [], out: [] };
    from.logic.out.push({ type: 'next', types: ['next'], targetId: `${dst.id}-${to.id}`, rule: `Starts “${l.toName}” (catch hook)`,
      loopLimit: '', delayValue: '', delayUnit: 'days', _auto: true, _hook: l.hookKey });
    added++;
  }
  return added;
}

// ---------- putting cards on the flow map ------------------------------------------------------

// Zaps that are switched off, retired, a copy, a draft, or a test: kept off the map unless asked.
export function isInactiveZap(zap) {
  const n = String((zap && zap.zapName) || '');
  return (zap && zap.editorState === 'draft') || /^\s*(?:off\b|\(old\)|\(copy\)|draft\b|testing\b)/i.test(n) || /\bretired\b/i.test(n);
}

// "Email Move Money Request Task - JS" -> "Email Move Money Request Task"; "Meetings Part 2: Draft Email" -> "Meetings"
export function nameStem(name) {
  let n = String(name == null ? '' : name).trim();
  n = n.replace(/^\s*(?:⚡\s*)?(?:off\b|\(old\)|\(new\)|\(copy\)|draft\b|testing\b)[\s:\-–]*/i, '');
  n = n.replace(/^\d+\.\s*/, '');
  n = n.replace(/\s+[-–]\s+[A-Z]{1,3}$/, '');
  const part = n.match(/^(.*?)\s*\bPart\s*\d+/i);
  if (part && part[1].trim().length >= 4) n = part[1].trim();
  return n.replace(/[\s:\-–]+$/, '').trim();
}

const norm = (s) => String(s).toLowerCase().replace(/\s+/g, ' ').trim();

function candidateKeys(name) {
  const stem = nameStem(name);
  const keys = [stem];
  const bits = stem.split(/\s+[-–]\s+/);
  if (bits.length === 2) keys.push(bits[0], bits[1]);
  return keys.filter((k) => k && k.length >= 4);
}

// ---------- what Zaps have in common: same flow (versions), same trigger -----------------------

// The SHAPE of a Zap's flow, ignoring names, settings and accounts: which kinds of step, from which apps and actions,
// at what depth. Two Zaps with the same shape are "versions" of one flow (for example one per advisor or per account).
export function shapeSignature(zap) {
  const steps = zap.steps || [];
  const by = new Map(steps.map((s) => [String(s.stepId), s]));
  const depth = (s) => { let d = 0; let p = s.parentStepId; const seen = new Set(); while (p && by.has(String(p)) && !seen.has(p)) { seen.add(p); d++; p = by.get(String(p)).parentStepId; } return d; };
  return steps.map((s) => `${depth(s)}:${s.role || ''}:${baseApp(s.app)}:${s.action || ''}`).join('>');
}

// What starts the Zap: the first step's app and action
export function triggerInfo(zap) {
  const t = (zap.steps || [])[0];
  if (!t) return { key: '', label: '' };
  const app = t.appName || cleanAppName(t.app);
  const what = t.actionLabel || t.action || t.title || '';
  return { key: `${baseApp(t.app)}|${t.action || ''}`, label: `${app} · ${what}`.trim() };
}

const modeOf = (arr) => { const c = new Map(); arr.forEach((x) => c.set(x, (c.get(x) || 0) + 1)); return [...c].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))[0]?.[0]; };
const shortAccount = (label) => String(label || '').replace(/\s+-\s+\S+@\S+$/, '').trim();

// How the Zaps in one group differ: which accounts they use, and which settings differ from one to the next
export function describeVersions(zaps) {
  const labels = new Set();
  for (const z of zaps) for (const s of z.steps || []) if (s.connectionId) labels.add(s.connectionLabel || `connection ${s.connectionId}`);
  const fields = new Map();
  const n = Math.max(...zaps.map((z) => (z.steps || []).length), 0);
  for (let i = 0; i < n; i++) {
    const here = zaps.map((z) => (z.steps || [])[i]).filter(Boolean);
    if (here.length < 2) continue;
    const names = new Set(here.flatMap((s) => (s.mappings || []).map((m) => m.field)));
    for (const f of names) {
      if (f.startsWith('_')) continue;
      const vals = here.map((s) => { const m = (s.mappings || []).find((x) => x.field === f); return m ? (m.hash || m.value) : ''; });
      const distinct = new Set(vals).size;
      if (distinct > 1) { const key = `${here[0].title}: ${f}`; fields.set(key, Math.max(fields.get(key) || 0, distinct)); }
    }
  }
  return { accounts: [...labels].map(shortAccount).filter(Boolean), differs: [...fields].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k]) => k) };
}

// A short label that says which version a Zap is: its account, else the initials / word after " - " in its name
export function versionLabel(zap, siblings) {
  const mine = new Set((zap.steps || []).filter((s) => s.connectionId).map((s) => s.connectionLabel || s.connectionId));
  const all = new Set((siblings || []).flatMap((z) => (z.steps || []).filter((s) => s.connectionId).map((s) => s.connectionLabel || s.connectionId)));
  if (all.size > 1 && mine.size) return [...mine].map(shortAccount).filter(Boolean).slice(0, 2).join(', ');
  const tail = String(zap.zapName || '').match(/\s[-–]\s+([^-–]{1,40})$/);
  if (tail) return tail[1].trim();
  return '';
}

// The name most of the group shares ("Generate Paperwork Step Complete" for DocuSign / Transfer / MISC / New Account ...)
function sharedName(group) {
  const count = new Map(); const display = new Map();
  for (const z of group) {
    for (const k of new Set(candidateKeys(z.zapName))) { const key = norm(k); count.set(key, (count.get(key) || 0) + 1); if (!display.has(key)) display.set(key, k); }
  }
  const best = [...count].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0];
  return (best && best[1] >= 2 ? display.get(best[0]) : '') || modeOf(group.map((z) => nameStem(z.zapName))) || nameStem(group[0].zapName) || group[0].zapName;
}

// Groups Zaps into workflows, strongest evidence first:
//   1. chains     Zaps that start each other through a catch hook, in the order they run
//   2. versions   Zaps with the SAME FLOW (same steps, apps and actions) and the same trigger: one per account / person / type
//                 (opts.groupBy === 'trigger' groups by what starts them instead)
//   3. families   Zaps that share a name stem, apart from trailing initials, "Part N", or the part before/after " - "
// Returns { workflows: [{ name, kind, zapIds, ... }], other: [zapId] }, every given Zap exactly once.
export function planGroups(zaps, links, opts = {}) {
  const byId = new Map(zaps.map((z) => [String(z.zapId), z]));
  const used = new Set();
  const workflows = [];
  const zapName = (id) => byId.get(id).zapName;

  // 1) chains
  const adj = new Map(); const indeg = new Map();
  for (const l of links || []) {
    if (!byId.has(l.fromZapId) || !byId.has(l.toZapId)) continue;
    (adj.get(l.fromZapId) || adj.set(l.fromZapId, new Set()).get(l.fromZapId)).add(l.toZapId);
    indeg.set(l.toZapId, (indeg.get(l.toZapId) || 0) + 1);
  }
  const und = new Map();
  const touch = (a, b) => { (und.get(a) || und.set(a, new Set()).get(a)).add(b); (und.get(b) || und.set(b, new Set()).get(b)).add(a); };
  for (const [a, set] of adj) for (const b of set) touch(a, b);
  const seen = new Set();
  for (const start of und.keys()) {
    if (seen.has(start)) continue;
    const comp = []; const stack = [start];
    while (stack.length) { const x = stack.pop(); if (seen.has(x)) continue; seen.add(x); comp.push(x); (und.get(x) || []).forEach((y) => stack.push(y)); }
    const roots = comp.filter((x) => !indeg.get(x)).sort((a, b) => String(zapName(a)).localeCompare(String(zapName(b))));
    const ordered = []; const q = roots.length ? [...roots] : [comp[0]];
    while (q.length) { const x = q.shift(); if (ordered.includes(x)) continue; ordered.push(x); [...(adj.get(x) || [])].sort().forEach((y) => q.push(y)); }
    comp.forEach((x) => { if (!ordered.includes(x)) ordered.push(x); });
    ordered.forEach((x) => used.add(x));
    workflows.push({ name: nameStem(zapName(ordered[0])) || zapName(ordered[0]), kind: 'chain', zapIds: ordered });
  }

  const rest = () => zaps.filter((z) => !used.has(String(z.zapId)));

  // 2) versions (same flow) or, if asked, same trigger
  if (opts.groupBy === 'trigger') {
    const byTrig = new Map();
    for (const z of rest()) { const t = triggerInfo(z); if (!t.key) continue; (byTrig.get(t.key) || byTrig.set(t.key, { label: t.label, ids: [] }).get(t.key)).ids.push(String(z.zapId)); }
    for (const g of byTrig.values()) {
      if (g.ids.length < 2) continue;
      g.ids.sort((a, b) => String(zapName(a)).localeCompare(String(zapName(b))));
      g.ids.forEach((x) => used.add(x));
      workflows.push({ name: `Starts when: ${g.label}`, kind: 'trigger', zapIds: g.ids });
    }
  } else {
    const bySig = new Map();
    for (const z of rest()) { if (!(z.steps || []).length) continue; const k = `${triggerInfo(z).key}#${shapeSignature(z)}`; (bySig.get(k) || bySig.set(k, []).get(k)).push(z); }
    for (const members of bySig.values()) {
      if (members.length < 2) continue;
      let group = members;
      if ((members[0].steps || []).length <= 2) {          // a very short flow is only a "version" if the names also match
        const keyCount = new Map();
        members.forEach((z) => new Set(candidateKeys(z.zapName).map(norm)).forEach((k) => keyCount.set(k, (keyCount.get(k) || 0) + 1)));
        group = members.filter((z) => candidateKeys(z.zapName).map(norm).some((k) => keyCount.get(k) >= 2));
        if (group.length < 2) continue;
      }
      const ids = group.map((z) => String(z.zapId)).sort((a, b) => String(zapName(a)).localeCompare(String(zapName(b))));
      ids.forEach((x) => used.add(x));
      workflows.push({ name: sharedName(group), kind: 'versions', zapIds: ids });
    }
  }

  // 3) families by name
  const left = rest();
  const members = new Map(); const display = new Map();
  for (const z of left) for (const k of candidateKeys(z.zapName)) {
    const key = norm(k);
    (members.get(key) || members.set(key, new Set()).get(key)).add(String(z.zapId));
    if (!display.has(key)) display.set(key, k);
  }
  const choice = new Map();
  for (const z of left) {
    const options = candidateKeys(z.zapName).map(norm).filter((k) => (members.get(k) || []).size >= 2);
    options.sort((a, b) => members.get(b).size - members.get(a).size || b.length - a.length);
    if (options.length) choice.set(String(z.zapId), options[0]);
  }
  const fam = new Map();
  for (const [id, key] of choice) (fam.get(key) || fam.set(key, []).get(key)).push(id);
  for (const [key, ids] of fam) {
    if (ids.length < 2) continue;
    ids.sort((a, b) => String(zapName(a)).localeCompare(String(zapName(b))));
    ids.forEach((x) => used.add(x));
    workflows.push({ name: display.get(key), kind: 'family', zapIds: ids });
  }

  // describe what differs inside each group of look-alikes
  workflows.forEach((w) => {
    if (w.kind === 'versions' || w.kind === 'family' || w.kind === 'trigger') {
      const zs = w.zapIds.map((id) => byId.get(id));
      w.differences = describeVersions(zs);
    }
  });

  const other = left.map((z) => String(z.zapId)).filter((id) => !used.has(id));
  const rank = { chain: 0, versions: 1, trigger: 1, family: 2 };
  workflows.sort((a, b) => ((rank[a.kind] ?? 3) - (rank[b.kind] ?? 3)) || a.name.localeCompare(b.name));
  return { workflows, other };
}

// A sentence saying why these Zaps were put together and how they differ
export function workflowNote(g) {
  const d = g.differences;
  const diff = d ? [d.accounts && d.accounts.length > 1 ? `different accounts (${d.accounts.slice(0, 4).join(', ')})` : '', d.differs && d.differs.length ? `settings that differ: ${d.differs.join('; ')}` : ''].filter(Boolean).join(' | ') : '';
  if (g.kind === 'chain') return 'Zaps that start each other (a step calls the next Zap\'s catch hook), in the order they run. Grouped automatically by the Zap import.';
  if (g.kind === 'versions') return `${g.zapIds.length} copies of the same flow (same steps, apps and actions).${diff ? ' They differ by ' + diff + '.' : ''} Grouped automatically by the Zap import.`;
  if (g.kind === 'trigger') return `${g.zapIds.length} Zaps that all start from the same trigger and run side by side.${diff ? ' ' + diff + '.' : ''} Grouped automatically by the Zap import.`;
  if (g.kind === 'family') return `Zaps with the same name apart from initials or part numbers.${diff ? ' ' + diff + '.' : ''} Grouped automatically by the Zap import.`;
  return 'Grouped automatically by the Zap import';
}

const WF_COLORS = ['#3dd9c5', '#7c3aed', '#f97316', '#38bdf8', '#a78bfa', '#fb923c', '#10b981', '#f43f5e'];

// Creates (or reuses) the stage and workflows and puts the cards in them. Cards that are already on the map are
// left exactly where they are. pd = the project data (stages, workflows, localResources).
export function placeZapCards(pd, plan, opts = {}) {
  const makeId = opts.makeId || (() => Math.random().toString(36).slice(2, 9));
  pd.stages = pd.stages || []; pd.workflows = pd.workflows || [];
  const library = pd.localResources || [];
  let stage = opts.stageId ? pd.stages.find((s) => s.id === opts.stageId) : null;
  if (!stage) {
    const name = opts.stageName || 'Zapier Automations';
    stage = pd.stages.find((s) => s.name === name);
    if (!stage) { stage = { id: `stage-${makeId()}`, name, width: 400 }; pd.stages.push(stage); }
  }
  const out = { stageId: stage.id, stageName: stage.name, placed: 0, kept: 0, workflowsUsed: 0 };
  const cardOf = (zapId) => library.find((r) => r.type === 'Zap' && String(r.originalZapId) === String(zapId));
  const groups = [...plan.workflows.map((w) => ({ ...w })), ...(plan.other.length ? [{ name: 'Other Zaps', kind: 'other', zapIds: plan.other }] : [])];
  groups.forEach((g, i) => {
    let wf = pd.workflows.find((w) => w.stageId === stage.id && w.name === g.name);
    const cards = g.zapIds.map(cardOf).filter(Boolean);
    if (!cards.length) return;
    if (!wf) {
      wf = { id: `wf-${makeId()}`, name: g.name, stageId: stage.id, color: WF_COLORS[i % WF_COLORS.length], resourceIds: [], description: workflowNote(g), zapAuto: true };
      pd.workflows.push(wf);
    }
    out.workflowsUsed++;
    if (opts.zapsById && (g.kind === 'versions' || g.kind === 'family' || g.kind === 'trigger')) {
      const sibs = g.zapIds.map((id) => opts.zapsById.get(String(id))).filter(Boolean);
      g.zapIds.forEach((id) => {
        const card = cardOf(id); const zap = opts.zapsById.get(String(id));
        if (card && zap) card.zapMeta = Object.assign({}, card.zapMeta, { group: { name: g.name, kind: g.kind, size: g.zapIds.length, label: versionLabel(zap, sibs) || undefined } });
      });
    }
    cards.forEach((c) => {
      if (c.stageId) { out.kept++; return; }                  // already placed: never moved
      c.stageId = stage.id; c.workflowId = wf.id; c.isGlobal = false;
      if (!wf.resourceIds.includes(String(c.id))) wf.resourceIds.push(String(c.id));
      out.placed++;
    });
  });
  return out;
}
