//======================= CORE / EXTERNAL SYNC =======================//
// What happens to the things pulled from outside services (Calendly event types, Wealthbox and Redtail workflow
// templates, Jotform forms, ActiveCampaign and MailerLite automations, YouCanBook.me profiles, Process Street checklists)
// after the service has answered. Pure functions on the project's card library: no database, no page.
//
//   1. reconcileExternal()   merges one service's pull into the cards already on the map. A card is matched by the
//                            service's own id, so a rename upstream is a rename, not a new card. Anything a person did by
//                            hand (position on the map, lane, notes, links, logic) stays. A card the service no longer
//                            returns is flagged "removed upstream", never deleted. Returns what changed.
//   2. extractExternalRefs() what one Zap step points at (a form, an event type, a workflow template), taken from the
//                            Zapier export while the raw step is available, and kept on the step.
//   3. tieExternalToZaps()   draws a line from each Zap step to the card it uses, and lists the Zaps that point at
//                            something that is missing or was removed upstream.
//
// Used by features/integrations.js (the importers), features/zap-import-ui.js and zap-import-core.js (the Zap import).

export const EXTERNAL_SOURCES = {
  wealthbox:      { label: 'Wealthbox',      idPrefix: 'wb',   legacyPrefixes: ['wb-'],             stepName: 'Workflow Template',   global: true },
  redtail:        { label: 'Redtail',        idPrefix: 'rt',   legacyPrefixes: ['rt-'],             stepName: 'Workflow Template',   global: false },
  calendly:       { label: 'Calendly',       idPrefix: 'cal',  legacyPrefixes: ['cal-'],            stepName: 'Client Schedules Appointment', global: true },
  ycbm:           { label: 'YouCanBook.me',  idPrefix: 'ycbm', legacyPrefixes: [],                  stepName: 'Customer Schedules via YCBM', global: true },
  jotform:        { label: 'Jotform',        idPrefix: 'jf',   legacyPrefixes: ['jf-'],             stepName: 'User Submits Form',   global: true },
  activecampaign: { label: 'ActiveCampaign', idPrefix: 'ac',   legacyPrefixes: ['ac-'],             stepName: 'Automation Flow',     global: true },
  mailerlite:     { label: 'MailerLite',     idPrefix: 'ml',   legacyPrefixes: [],                  stepName: 'Automation Flow',     global: true },
  processstreet:  { label: 'Process Street', idPrefix: 'ps',   legacyPrefixes: ['ps-'],             stepName: 'Checklist Template',  global: false },
};

const norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim();
const idKey = (v) => String(v == null ? '' : v).trim();
const clip = (s, n) => { const t = String(s == null ? '' : s); return t.length > n ? t.slice(0, n) : t; };

// A short stable fingerprint of what the service told us about an item (so "changed upstream" is knowable).
export function fingerprintItem(item) {
  const basis = JSON.stringify([
    item.name || '', item.externalUrl || '', item.description || '',
    (item.steps || []).map((s) => [s.name || '', s.description || '', s.appName || '']),
  ]);
  let h = 5381;
  for (let i = 0; i < basis.length; i++) h = ((h << 5) + h + basis.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

const hasHandLogic = (step) => !!step && (((step.logic && step.logic.out) || []).some((l) => l && !l._auto) || ((step.logic && step.logic.in) || []).length > 0 || (step.links || []).length > 0);

// Carries what a person did on an existing step onto the matching new one. Matching: same id (ids are stable per item),
// else same name.
function mergeSteps(oldSteps, newSteps) {
  const olds = oldSteps || [];
  const used = new Set();
  const merged = (newSteps || []).map((ns) => {
    const os = olds.find((o) => o && o.id === ns.id) || olds.find((o) => o && !used.has(o.id) && o.name === ns.name);
    if (!os) return ns;
    used.add(os.id);
    return { ...os, name: ns.name, appName: ns.appName || os.appName, description: os.description || ns.description, id: os.id };
  });
  // a step the service no longer has: dropped, unless someone connected it to something by hand
  olds.forEach((o) => { if (o && !used.has(o.id) && hasHandLogic(o)) merged.push({ ...o, removedUpstream: true }); });
  return merged;
}

const IMPORT_OWNED = ['name', 'type', 'source', 'externalId', 'externalUrl', 'archetype'];

// library = the project's localResources array (changed in place). items = what the service returned, each already shaped as a
// card: { externalId, name, type, externalUrl?, description?, steps: [{id, name, appName}], ...extra new-card fields }.
export function reconcileExternal(library, source, items, opts = {}) {
  const cfg = EXTERNAL_SOURCES[source] || { idPrefix: 'ext', legacyPrefixes: [], global: true };
  const now = opts.now || new Date().toISOString();
  const summary = { source, total: (items || []).length, added: [], renamed: [], changed: [], missing: [], restored: [], emptyPull: false };

  const isOurs = (r) => r && (r.source === source || (!r.source && cfg.legacyPrefixes.some((p) => String(r.id || '').startsWith(p))));
  const ours = library.filter(isOurs);
  const claimed = new Set();

  (items || []).forEach((item) => {
    if (!item || item.externalId == null || !String(item.name || '').trim()) return;
    const ext = idKey(item.externalId);
    const hash = fingerprintItem(item);
    let old = ours.find((r) => !claimed.has(r) && r.externalId != null && idKey(r.externalId) === ext);
    // A card made before ids were kept: match by name, once, and only a card that has no id of its own yet.
    if (!old) old = ours.find((r) => !claimed.has(r) && (r.externalId == null || r.externalId === '') && r.type === item.type && norm(r.name) === norm(item.name));

    if (old) {
      claimed.add(old);
      const was = { name: old.name, hash: old.extHash };
      const next = { ...old };
      IMPORT_OWNED.forEach((k) => { if (item[k] !== undefined) next[k] = item[k]; });
      if (item.description !== undefined && (!old.description || old.description === old._importDescription)) { next.description = item.description; next._importDescription = item.description; }
      next.steps = mergeSteps(old.steps, item.steps);
      next.extHash = hash;
      next.lastPulledAt = now;
      next.source = source;
      const wasMissing = !!old.missingUpstream;
      delete next.missingUpstream;
      if (wasMissing) summary.restored.push(next.name);
      Object.keys(old).forEach((k) => { if (!(k in next)) delete old[k]; });   // a flag removed from `next` must leave the card too
      Object.assign(old, next);
      if (norm(was.name) !== norm(next.name)) summary.renamed.push({ from: was.name, to: next.name });
      else if (was.hash && was.hash !== hash) summary.changed.push(next.name);
      return;
    }

    // new card
    let id = `${cfg.idPrefix}-${ext}`;
    if (library.some((r) => r && r.id === id)) id = `${id}-${Math.random().toString(36).slice(2, 6)}`;
    const card = {
      visible: true, isExpanded: true, ...(cfg.global ? { isGlobal: true } : {}),
      ...item, id, source, extHash: hash, firstPulledAt: now, lastPulledAt: now,
    };
    if (item.description !== undefined) card._importDescription = item.description;
    library.push(card);
    claimed.add(card);
    summary.added.push(card.name);
  });

  // What the service no longer returns. An empty answer is treated as a hiccup, not as "everything was deleted".
  if (!(items || []).length && ours.some((r) => r.externalId != null)) {
    summary.emptyPull = true;
  } else {
    ours.forEach((r) => {
      if (claimed.has(r) || r.externalId == null || r.externalId === '') return;
      if (!r.missingUpstream) { r.missingUpstream = { since: now }; summary.missing.push(r.name); }
    });
  }
  return summary;
}

// One line per pull in the project's change history (kept to the latest 60).
export function logExternalPull(pd, summary, now = new Date().toISOString()) {
  if (!pd || !summary) return;
  pd.integrationSync = pd.integrationSync || {};
  const prev = pd.integrationSync[summary.source] || {};
  pd.integrationSync[summary.source] = { ...prev, at: now, count: summary.total, error: undefined, errorAt: undefined,
    added: summary.added.length, changed: summary.changed.length + summary.renamed.length, missing: summary.missing.length };
  const quiet = !summary.added.length && !summary.renamed.length && !summary.changed.length && !summary.missing.length && !summary.restored.length;
  if (quiet) return;
  pd.integrationLog = pd.integrationLog || [];
  pd.integrationLog.unshift({ at: now, source: summary.source, added: summary.added.slice(0, 30), renamed: summary.renamed.slice(0, 30), changed: summary.changed.slice(0, 30), missing: summary.missing.slice(0, 30), restored: summary.restored.slice(0, 30) });
  if (pd.integrationLog.length > 60) pd.integrationLog.length = 60;
}

// ---------- what a Zap step points at ----------------------------------------------------------------

const APP_SOURCE = [
  [/jotform/i, 'jotform'], [/calendly/i, 'calendly'], [/wealthbox/i, 'wealthbox'], [/redtail/i, 'redtail'],
  [/active\s*campaign/i, 'activecampaign'], [/mailerlite/i, 'mailerlite'], [/youcanbook|ycbm/i, 'ycbm'], [/process\s*street/i, 'processstreet'],
];
const URL_SOURCE = [
  [/jotform\.com/i, 'jotform'], [/calendly\.com/i, 'calendly'], [/youcanbook\.me/i, 'ycbm'],
  [/activehosted\.com|activecampaign\.com/i, 'activecampaign'], [/processstreet\.com/i, 'processstreet'],
  [/wealthbox\.com/i, 'wealthbox'], [/redtail(technology|crm)?\.com/i, 'redtail'],
];
// Field names that name a form, template, workflow, event type, automation... (not "email", "name of the contact", "note")
const KIND_FIELD = /(^|[_\s.-])(form|template|workflow|automation|event[_\s-]?type|booking|profile|checklist|sequence|flow)([_\s-]?(id|uuid|name|url|link))?$/i;

export const sourceOfApp = (step) => {
  const hay = `${step?.app || ''} ${step?.appName || ''}`;
  const hit = APP_SOURCE.find(([re]) => re.test(hay));
  return hit ? hit[1] : null;
};
const sourceOfUrl = (v) => { const hit = URL_SOURCE.find(([re]) => re.test(v)); return hit ? hit[1] : null; };
const URL_RE = /https?:\/\/[^\s"'<>)]+/g;

// From a raw Zapier step (with its mappings). Only fixed values count: a value taken from an earlier step ({{...}}) can't be
// matched to anything. Kept small: field, the value (clipped) and the label Zapier shows for it.
export function extractExternalRefs(step) {
  const out = [];
  const appSource = sourceOfApp(step);
  (step?.mappings || []).forEach((m) => {
    const v = String(m.value == null ? '' : m.value).trim();
    const disp = String(m.display == null ? '' : m.display).trim();
    if (!v || v === '[redacted]' || v.includes('{{')) return;
    const urlSource = sourceOfUrl(v);
    const fieldOk = KIND_FIELD.test(String(m.field || ''));
    const source = urlSource || (appSource && fieldOk ? appSource : null);
    if (!source) return;
    out.push({ source, field: clip(m.field, 60), value: clip(v, 300), display: clip(disp, 120) });
  });
  return out;
}

// ---------- tying cards to the Zap steps that use them -----------------------------------------------

const normUrl = (u) => String(u || '').trim().toLowerCase().replace(/[?#].*$/, '').replace(/^http:/, 'https:').replace(/\/+$/, '');
const urlIds = (u) => {
  const ids = [];
  const jf = String(u).match(/jotform\.com\/(?:form\/|edit\/|build\/|myforms\/)?(\d{8,})/i); if (jf) ids.push(jf[1]);
  const cal = String(u).match(/event_types\/([A-Za-z0-9-]+)/i); if (cal) ids.push(cal[1]);
  return ids;
};

const linkTo = (card, rule, source) => ({
  type: 'next', types: ['next'], targetId: `${card.id}-${card.steps[0].id}`, rule,
  loopLimit: '', delayValue: '', delayUnit: 'days', _auto: true, _ext: source,
});

export function tieExternalToZaps(library) {
  const zaps = (library || []).filter((r) => r && r.type === 'Zap');
  const cards = (library || []).filter((r) => r && EXTERNAL_SOURCES[r.source] && r.externalId != null && r.externalId !== '' && Array.isArray(r.steps) && r.steps.length);

  // clear what an earlier pass drew
  zaps.forEach((z) => {
    (z.steps || []).forEach((s) => { if (s.logic && Array.isArray(s.logic.out)) s.logic.out = s.logic.out.filter((l) => !l._ext); });
    if (z.zapMeta) delete z.zapMeta.externalIssues;
  });

  const index = {};
  cards.forEach((c) => {
    const ix = (index[c.source] = index[c.source] || { byId: new Map(), byName: new Map(), byUrl: new Map() });
    ix.byId.set(idKey(c.externalId), c);
    const n = norm(c.name); ix.byName.set(n, ix.byName.has(n) ? null : c);   // two cards with one name: ambiguous, never guessed
    if (c.externalUrl) ix.byUrl.set(normUrl(c.externalUrl), c);
  });

  let tied = 0; let issues = 0;
  zaps.forEach((z) => {
    const seen = new Set();
    const found = [];
    (z.steps || []).forEach((s) => {
      ((s.zap && s.zap.refs) || []).forEach((ref) => {
        const ix = index[ref.source] || { byId: new Map(), byName: new Map(), byUrl: new Map() };
        let card = null;
        const v = idKey(ref.value);
        card = ix.byId.get(v) || null;
        if (!card) {
          for (const u of (v.match(URL_RE) || [])) {
            card = ix.byUrl.get(normUrl(u)) || urlIds(u).map((i) => ix.byId.get(i)).find(Boolean) || null;
            if (card) break;
          }
        }
        if (!card) { const byDisp = ix.byName.get(norm(ref.display)); if (byDisp) card = byDisp; }
        if (!card && !/^https?:/i.test(v)) { const byVal = ix.byName.get(norm(v)); if (byVal) card = byVal; }

        if (card) {
          const key = `${s.id}|${card.id}`;
          if (!seen.has(key)) {
            seen.add(key);
            s.logic = s.logic || { in: [], out: [] };
            s.logic.out = s.logic.out || [];
            s.logic.out.push(linkTo(card, `Uses ${EXTERNAL_SOURCES[ref.source].label}: “${card.name}”`, ref.source));
            tied++;
          }
          if (card.missingUpstream) found.push({ step: s.name || 'Step', source: ref.source, label: card.name, state: 'removed_upstream' });
        } else if (ref.display || /^\d{5,}$/.test(v) || /^[0-9a-f-]{20,}$/i.test(v)) {
          // it names a specific thing of that service, and nothing pulled matches it
          found.push({ step: s.name || 'Step', source: ref.source, label: ref.display || v, state: index[ref.source] ? 'not_found' : 'not_pulled' });
        }
      });
    });
    if (found.length) { z.zapMeta = z.zapMeta || {}; z.zapMeta.externalIssues = found; issues += found.length; }
  });
  return { tied, issues };
}
