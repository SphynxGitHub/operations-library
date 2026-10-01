// ================================================================================================
// FILE: features/zap-import-ui.js
//
// WHAT IT DOES:   The "Import Zaps" window. You drop in the file written by the Zapier export script, see what is
//                 new / changed / unchanged / gone since last time, add a note saying why things changed, and apply.
//                 It updates the Zap cards in the open project, and saves a history (snapshots + a list of changes)
//                 to the database.
//
// HOW IT IS WIRED: integrations.js calls createZapImport({...}) once and puts the returned functions on OL.*.
//                 This file imports nothing from the app itself (everything arrives through `deps`), so it can be
//                 tested on its own.
//
// SAFETY:         - The export carries the Zapier account it came from. The first import for a project asks you to
//                   confirm the account belongs to that client; later imports from a DIFFERENT account are stopped
//                   unless you explicitly override (this is what prevents one client's Zaps landing in another's).
//                 - If the history tables are missing (SQL migration not run yet) the import still works; only the
//                   history is skipped, and the window says so.
// ================================================================================================

import { planReorganize, applyReorganize, restoreBackup } from './zap-reorganize.js';
import { planImport, zapToResource, mergeIntoExisting, discoverResources, fingerprint, findHookLinks, applyHookLinks, isInactiveZap, planGroups, placeZapCards } from './zap-import-core.js';

const STATUS_LABEL = { new: 'New', changed: 'Changed', unchanged: 'Unchanged', baseline: 'Already here' };
const STATUS_COLOR = { new: '#16a34a', changed: '#d97706', unchanged: '#6b7280', baseline: '#2563eb' };

const isPendingStatus = (v) => { const t = String(v == null ? '' : v).trim(); return t === '' || /^pending/i.test(t); };
const clip = (s, n = 110) => { const t = String(s == null ? '' : s).replace(/\s+/g, ' '); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

// One readable line per detected change
export function changeText(c) {
  const at = c.step_title ? `“${c.step_title}”: ` : '';
  const arrow = (a, b) => `${clip(a, 60) || '(none)'} → ${clip(b, 60) || '(none)'}`;
  switch (c.change_type) {
    case 'zap_added': return 'New Zap';
    case 'zap_removed': return 'No longer in Zapier';
    case 'zap_renamed': return `Zap renamed: ${arrow(c.old_value, c.new_value)}`;
    case 'state_changed': return `Version: ${arrow(c.old_value, c.new_value)}`;
    case 'step_added': return `Step added: ${clip(c.new_value)}`;
    case 'step_removed': return `Step removed: ${clip(c.old_value)}`;
    case 'step_renamed': return `Step renamed: ${arrow(c.old_value, c.new_value)}`;
    case 'step_moved': return `${at}moved to a different place in the flow`;
    case 'app_changed': return `${at}app changed ${arrow(c.old_value, c.new_value)}`;
    case 'app_version_changed': return `${at}app version ${arrow(c.old_value, c.new_value)}`;
    case 'action_changed': return `${at}action changed ${arrow(c.old_value, c.new_value)}`;
    case 'connection_changed': return `${at}connection changed ${arrow(c.old_value, c.new_value)}`;
    case 'field_added': return `${at}field “${c.field}” added: ${clip(c.new_value, 70)}`;
    case 'field_removed': return `${at}field “${c.field}” removed (was ${clip(c.old_value, 70)})`;
    case 'field_changed': return `${at}field “${c.field}”: ${arrow(c.old_value, c.new_value)}`;
    default: return `${c.change_type}`;
  }
}

export function createZapImport(deps) {
  const { state, esc, uid, persist, markClientDirty, db, getUserName, openModal, closeModal, afterApply, now = () => new Date() } = deps;
  const session = { reorg: null, step: 'pick', model: null, error: '', note: '', author: '', newStatus: 'Built', markExistingBuilt: false, draftsPending: true, stageChoice: 'new', groupZaps: true, groupBy: 'flow', skipInactive: true, connectZaps: true, leaveUnexplained: false, confirmAccount: false, overrideMismatch: false, showUnchanged: false, result: null, busy: false };

  const active = () => { const id = state.activeClientId; return { id, client: state.clients && state.clients[id] }; };
  const libraryOf = (client) => { client.projectData = client.projectData || {}; client.projectData.localResources = client.projectData.localResources || []; return client.projectData.localResources; };
  const findCard = (library, zap) => library.find((r) => r.type === 'Zap' && (String(r.originalZapId) === String(zap.zapId)
    || String(r.name || '').toLowerCase() === `⚡ ${String(zap.zapName || '').replace(/^⚡\s*/, '').trim()}`.toLowerCase()));

  // ---------- reading the file and working out what is different ----------

  async function loadPrevious(clientId) {
    try {
      const { data, error } = await db.from('zap_latest').select('id, zap_id, data').eq('client_id', clientId);
      if (error) throw error;
      const map = new Map();
      (data || []).forEach((r) => map.set(String(r.zap_id), Object.assign({}, r.data, { _snapshotId: r.id })));
      return { map, available: true };
    } catch (e) {
      return { map: new Map(), available: false, error: String((e && e.message) || e) };
    }
  }

  function validate(json) {
    if (!Array.isArray(json)) return 'This is not a Zap export: expected a list of Zaps.';
    if (!json.length) return 'The file has no Zaps in it.';
    const bad = json.findIndex((z) => !z || !z.zapId || !Array.isArray(z.steps));
    if (bad !== -1) return `Item ${bad + 1} is missing a Zap id or its steps. Was the file edited?`;
    return '';
  }

  function accountCheck(client, json) {
    const seen = new Map();
    json.forEach((z) => { if (z.zapierAccountId) seen.set(String(z.zapierAccountId), z.zapierAccountName || ''); });
    const exportAccounts = [...seen].map(([id, name]) => ({ id, name }));
    const stored = (client.projectData && client.projectData.zapierAccount) || null;
    let stateName = 'unknown';
    if (exportAccounts.length > 1) stateName = 'multiple';
    else if (!exportAccounts.length) stateName = 'unknown';
    else if (!stored) stateName = 'first';
    else stateName = String(stored.id) === exportAccounts[0].id ? 'match' : 'mismatch';
    return { state: stateName, exportAccounts, stored };
  }

  async function buildModel(json) {
    const { id, client } = active();
    const library = libraryOf(client);
    const previous = await loadPrevious(id);
    const plan = planImport(previous.map, json);
    const items = plan.items.map((it) => {
      const card = findCard(library, it.zap);
      let status = it.status;
      let changes = it.changes;
      if (status === 'new' && card) { status = 'baseline'; changes = []; }   // a card exists, but there is no saved history yet
      const empty = !it.zap.steps.length;
      return { ...it, status, changes, card, prev: previous.map.get(it.zapId) || null, empty,
        isDraft: it.zap.editorState === 'draft', selected: !empty && status !== 'unchanged' };
    });
    return { zaps: json, items, missing: plan.missing.map((m) => ({ ...m, selected: false })), counts: {
      new: items.filter((i) => i.status === 'new').length, changed: items.filter((i) => i.status === 'changed').length,
      baseline: items.filter((i) => i.status === 'baseline').length, unchanged: items.filter((i) => i.status === 'unchanged').length,
      missing: plan.missing.length },
      account: accountCheck(client, json), historyAvailable: previous.available, historyError: previous.error || '', clientName: (client.meta && client.meta.name) || id };
  }

  // What the flow-map options would do with the current selection (shown in the review window)
  function flowPreview(m) {
    const selected = m.items.filter((i) => i.selected && !i.empty);
    const { links } = findHookLinks(m.zaps || []);
    const unplaced = selected.filter((i) => !(i.card && i.card.stageId));
    const off = session.skipInactive ? unplaced.filter((i) => isInactiveZap(i.zap)) : [];
    const cand = unplaced.filter((i) => !off.includes(i)).map((i) => i.zap);
    const plan = session.groupZaps ? planGroups(cand, links, { groupBy: session.groupBy === 'trigger' ? 'trigger' : undefined }) : { workflows: [], other: cand.map((z) => String(z.zapId)) };
    return { placeable: cand.length, chains: plan.workflows.filter((w) => w.kind === 'chain').length, versions: plan.workflows.filter((w) => w.kind === 'versions' || w.kind === 'trigger').length, families: plan.workflows.filter((w) => w.kind === 'family').length,
      other: plan.other.length, off: off.length, links: links.length };
  }

  // ---------- applying ----------

  async function saveHistory(model, chosen, removed, opts, clientId) {
    const nowIso = now().toISOString();
    const out = { saved: false, changes: 0, unexplained: 0, error: '' };
    if (!model.historyAvailable) { out.error = 'History tables not found (run the SQL migration to keep a change history).'; return out; }
    try {
      const snaps = chosen.map((it) => ({ client_id: clientId, zap_id: it.zapId, zap_name: it.name, zapier_account_id: it.zap.zapierAccountId || null,
        zapier_account_name: it.zap.zapierAccountName || null, editor_state: it.zap.editorState || null, content_hash: it.hash, data: it.zap,
        exported_at: nowIso, imported_by: opts.author || null }));
      const idByZap = new Map();
      for (let i = 0; i < snaps.length; i += 10) {
        const { data, error } = await db.from('zap_snapshots').insert(snaps.slice(i, i + 10)).select('id, zap_id');
        if (error) throw error;
        (data || []).forEach((r) => idByZap.set(String(r.zap_id), r.id));
      }
      const explained = !!(opts.note && !opts.leaveUnexplained);
      const rows = [];
      chosen.forEach((it) => it.changes.forEach((c) => rows.push({
        client_id: clientId, zap_id: c.zap_id || it.zapId, zap_name: c.zap_name || it.name, step_id: c.step_id || null, step_title: c.step_title || null,
        change_type: c.change_type, field: c.field || null, old_value: c.old_value, new_value: c.new_value, old_hash: c.old_hash || null, new_hash: c.new_hash || null,
        from_snapshot_id: (it.prev && it.prev._snapshotId) || null, to_snapshot_id: idByZap.get(it.zapId) || null, detected_at: nowIso, source: 'detected',
        note: explained ? opts.note : null, author: explained ? (opts.author || null) : null, noted_at: explained ? nowIso : null })));
      removed.forEach((m) => rows.push({ client_id: clientId, zap_id: m.zapId, zap_name: m.name, change_type: 'zap_removed', old_value: m.name, detected_at: nowIso,
        source: 'detected', note: explained ? opts.note : null, author: explained ? (opts.author || null) : null, noted_at: explained ? nowIso : null }));
      for (let i = 0; i < rows.length; i += 200) {
        const { error } = await db.from('zap_changes').insert(rows.slice(i, i + 200));
        if (error) throw error;
      }
      out.saved = true; out.changes = rows.length; out.unexplained = explained ? 0 : rows.length;
    } catch (e) { out.error = String((e && e.message) || e); }
    return out;
  }

  async function applyImport(model, opts) {
    const { id, client } = active();
    const library = libraryOf(client);
    const chosen = model.items.filter((i) => i.selected && !i.empty);
    const removed = model.missing.filter((m) => m.selected);
    const summary = { created: 0, updated: 0, discovered: 0, removedFlagged: 0, markedBuilt: 0, connections: 0, placed: 0, workflows: 0, stageName: '', history: null };
    const startStatus = opts.newStatus === 'Pending' ? 'Pending' : 'Built';
    const draftsPending = opts.draftsPending !== false;       // a Zap with no published version is not Built yet
    summary.draftsPending = 0;

    chosen.forEach((it) => {
      const existing = findCard(library, it.zap);
      const fresh = zapToResource(it.zap, { resourceId: existing ? existing.id : `local-prj-zap-${it.zapId}` });
      const res = existing ? mergeIntoExisting(existing, fresh) : fresh;
      const holdBack = it.isDraft && draftsPending;
      if (existing) {
        library[library.indexOf(existing)] = res; summary.updated++;
        // a status someone set stays; a card still at Pending can be moved to Built if asked (never a draft-only Zap)
        if (opts.markExistingBuilt && !holdBack && isPendingStatus(existing.status)) { res.status = 'Built'; summary.markedBuilt++; }
      } else {
        res.status = holdBack ? 'Pending' : startStatus;  // a card made by the import starts as Built (the Zap already exists in Zapier)
        library.unshift(res); summary.created++;
        if (res.status === 'Built') summary.markedBuilt++;
        if (holdBack) summary.draftsPending++;
      }
      res.zapMeta = Object.assign({}, res.zapMeta, { lastImportedAt: now().toISOString(), missingFromZapier: false });

      // folders and spreadsheets the Zap uses: make a card once, and link it from every step that uses it
      discoverResources(it.zap).forEach((d) => {
        const key = `${d.kind}|${d.app}|${d.value}`;
        let r = library.find((x) => x.discoveredKey === key || (d.url && x.externalUrl === d.url));
        if (!r) {
          r = { id: 'local-prj-' + uid(), name: `[Discovered] ${clip(d.label, 60)}`, type: d.kind, externalUrl: d.url || '', discoveredKey: key,
            discoveredFrom: d.appName, isGlobal: true, coords: null, stageId: null };
          library.push(r); summary.discovered++;
        }
        d.stepIds.forEach((sid) => {
          const step = res.steps.find((s) => s.zap && String(s.zap.stepId) === String(sid));
          if (step) { step.links = step.links || []; if (!step.links.some((l) => l.id === r.id)) step.links.push({ id: r.id, name: r.name, type: r.type }); }
        });
      });
    });

    removed.forEach((m) => {
      const card = library.find((r) => r.type === 'Zap' && String(r.originalZapId) === String(m.zapId));
      if (card) { card.zapMeta = Object.assign({}, card.zapMeta, { missingFromZapier: true, missingSince: now().toISOString() }); summary.removedFlagged++; }
    });

    // connections between Zaps (a step that calls a catch hook -> the Zap that hook starts)
    const hookLinks = findHookLinks(model.zaps || []).links;
    if (opts.connectZaps !== false) summary.connections = applyHookLinks(library, hookLinks);

    // put the cards on the flow map: one stage, workflows for call chains and same-name families
    if (opts.stageChoice !== 'none') {
      const cand = chosen.map((i) => i.zap).filter((z) => {
        const card = library.find((r) => r.type === 'Zap' && String(r.originalZapId) === String(z.zapId));
        return card && !card.stageId && !(opts.skipInactive !== false && isInactiveZap(z));
      });
      const plan = opts.groupZaps === false ? { workflows: [], other: cand.map((z) => String(z.zapId)) } : planGroups(cand, hookLinks, { groupBy: opts.groupBy === 'trigger' ? 'trigger' : undefined });
      const placed = placeZapCards(client.projectData, plan, { stageId: opts.stageChoice && opts.stageChoice !== 'new' ? opts.stageChoice : undefined, stageName: 'Zapier Automations', makeId: uid, zapsById: new Map((model.zaps || []).map((z) => [String(z.zapId), z])) });
      summary.placed = placed.placed; summary.workflows = placed.workflowsUsed; summary.stageName = placed.stageName;
    }

    const acct = model.account;
    if (acct.exportAccounts.length === 1 && (acct.state === 'first' || acct.state === 'mismatch')) {
      client.projectData.zapierAccount = { id: acct.exportAccounts[0].id, name: acct.exportAccounts[0].name, confirmedBy: opts.author || '', confirmedAt: now().toISOString() };
    }
    markClientDirty(id);
    await persist();
    summary.history = await saveHistory(model, chosen, removed, opts, id);
    if (typeof afterApply === 'function') afterApply();
    return summary;
  }

  // ---------- drawing ----------

  const head = (title) => `<div class="modal-head"><div class="modal-title-text">${esc(title)}</div><div class="spacer"></div>
    <button class="btn small soft" onclick="OL.zapImportClose()">Close</button></div>`;

  function renderPick() {
    const { client } = active();
    return `${head('Import Zaps from Zapier')}<div class="modal-body" style="max-width:760px;">
      <p class="tiny muted" style="margin-top:0;">Importing into <strong>${esc((client && client.meta && client.meta.name) || 'this project')}</strong>. Choose the .json file written by the Zapier export script.</p>
      <div style="border:2px dashed var(--line,#d1d5db); border-radius:10px; padding:26px; text-align:center;" ondragover="event.preventDefault()" ondrop="event.preventDefault(); OL.zapImportDrop(event)">
        <input type="file" accept=".json,application/json" onchange="OL.zapImportFile(this)">
        <div class="tiny muted" style="margin-top:8px;">or drag the file here</div>
      </div>
      <details style="margin-top:12px;"><summary class="tiny muted" style="cursor:pointer;">Paste the JSON instead</summary>
        <textarea id="zap-import-paste" class="modal-input" style="width:100%; min-height:110px; margin-top:8px;" placeholder="[ { &quot;zapName&quot;: ..."></textarea>
        <button class="btn small primary" style="margin-top:6px;" onclick="OL.zapImportPaste()">Read pasted JSON</button></details>
      ${session.busy ? '<p class="tiny muted">Reading…</p>' : ''}
      ${session.error ? `<p class="tiny" style="color:#dc2626;">${esc(session.error)}</p>` : ''}
      <div style="margin-top:18px; padding-top:12px; border-top:1px solid var(--line,#e5e7eb);">
        <div class="tiny" style="font-weight:600;">Zaps already on the flow map?</div>
        <div class="tiny muted" style="margin:4px 0 8px;">Re-sort the Zap cards that are already in this project with the current grouping rules (call chains, versions of the same flow, name families). No file needed; you see everything first, a backup is saved, and you can undo.</div>
        <button class="btn small soft" onclick="OL.zapReorgOpen()">Reorganize Zaps already on the map…</button>
      </div></div>`;
  }

  function accountBanner(m) {
    const a = m.account; const first = a.exportAccounts[0];
    const who = first ? `${esc(first.name || '(no name)')} <span class="muted">[id ${esc(first.id)}]</span>` : '';
    if (a.state === 'match') return `<div class="tiny" style="margin:8px 0; color:#166534;">✔ Zapier account ${who} is the one used for this project before.</div>`;
    if (a.state === 'first') return `<div class="card" style="padding:10px; margin:8px 0; border-left:4px solid #d97706;"><div class="tiny"><strong>First import for this project.</strong> These Zaps come from Zapier account ${who}.</div>
      <label class="tiny" style="display:flex; gap:6px; margin-top:6px;"><input type="checkbox" ${session.confirmAccount ? 'checked' : ''} onchange="OL.zapImportSet('confirmAccount', this.checked)"> This account belongs to <strong>${esc(m.clientName)}</strong>.</label></div>`;
    if (a.state === 'mismatch') return `<div class="card" style="padding:10px; margin:8px 0; border-left:4px solid #dc2626;"><div class="tiny" style="color:#dc2626;"><strong>Different Zapier account.</strong> This project's Zaps came from ${esc((a.stored && a.stored.name) || '')} [id ${esc(a.stored && a.stored.id)}], but this file is from ${who}. Importing it could mix another client's Zaps into this project.</div>
      <label class="tiny" style="display:flex; gap:6px; margin-top:6px;"><input type="checkbox" ${session.overrideMismatch ? 'checked' : ''} onchange="OL.zapImportSet('overrideMismatch', this.checked)"> I checked: this file really belongs to <strong>${esc(m.clientName)}</strong>.</label></div>`;
    if (a.state === 'multiple') return '<div class="card" style="padding:10px; margin:8px 0; border-left:4px solid #dc2626;"><div class="tiny" style="color:#dc2626;"><strong>This file mixes several Zapier accounts.</strong> Export one client at a time.</div></div>';
    return '<div class="tiny muted" style="margin:8px 0;">This file does not say which Zapier account it came from (older export). Check the Zap names before importing.</div>';
  }

  const stagesNow = () => { const { client } = active(); return (client && client.projectData && client.projectData.stages) || []; };
  const flowText = (f) => session.stageChoice === 'none' ? 'The cards will be added to the workbench only.'
    : `${f.placeable} Zap${f.placeable === 1 ? '' : 's'} would go on the map: ${f.chains} chain workflow${f.chains === 1 ? '' : 's'}, ${f.versions} ${session.groupBy === 'trigger' ? 'same-trigger' : 'same-flow'} workflow${f.versions === 1 ? '' : 's'}, ${f.families} same-name workflow${f.families === 1 ? '' : 's'}, ${f.other} in “Other Zaps”${f.off ? `; ${f.off} left off (OFF / old / draft)` : ''}. ${session.connectZaps ? `${f.links} connection${f.links === 1 ? '' : 's'} between Zaps.` : ''}`;

  function canApply(m) {
    const a = m.account;
    if (a.state === 'multiple') return false;
    if (a.state === 'first' && !session.confirmAccount) return false;
    if (a.state === 'mismatch' && !session.overrideMismatch) return false;
    return m.items.some((i) => i.selected) || m.missing.some((x) => x.selected);
  }

  function renderReview() {
    const m = session.model; const c = m.counts;
    const chip = (label, n, color) => `<span style="display:inline-block; padding:2px 9px; border-radius:99px; background:${color}22; color:${color}; font-size:12px; margin-right:6px;">${n} ${label}</span>`;
    const rows = m.items.filter((i) => session.showUnchanged || i.status !== 'unchanged').map((it) => {
      const detail = it.changes.length ? `<details style="margin:4px 0 0 24px;"><summary class="tiny muted" style="cursor:pointer;">${it.changes.length} change${it.changes.length === 1 ? '' : 's'}</summary>
        <ul class="tiny" style="margin:4px 0 0 16px; padding:0;">${it.changes.slice(0, 40).map((x) => `<li>${esc(changeText(x))}</li>`).join('')}${it.changes.length > 40 ? `<li class="muted">…and ${it.changes.length - 40} more</li>` : ''}</ul></details>` : '';
      const flags = [it.isDraft ? '<span class="tiny" style="color:#d97706;">Draft only: no published version found, so it may not be live</span>' : '', it.empty ? '<span class="tiny" style="color:#dc2626;">No steps found: skipped</span>' : ''].filter(Boolean).join(' · ');
      return `<div style="padding:7px 0; border-bottom:1px solid var(--line,#e5e7eb);">
        <label style="display:flex; gap:8px; align-items:center;"><input type="checkbox" ${it.selected ? 'checked' : ''} ${it.empty ? 'disabled' : ''} onchange="OL.zapImportToggle('${esc(it.zapId)}', this.checked)">
          <span style="font-size:11px; padding:1px 7px; border-radius:99px; background:${STATUS_COLOR[it.status]}22; color:${STATUS_COLOR[it.status]};">${STATUS_LABEL[it.status]}</span>
          <span style="flex:1;">${esc(it.name)}</span></label>${flags ? `<div style="margin-left:24px;">${flags}</div>` : ''}${detail}</div>`;
    }).join('');
    const missing = m.missing.length ? `<div style="margin-top:14px;"><div class="tiny" style="font-weight:600;">No longer in this export (${m.missing.length})</div>
      <div class="tiny muted">Not deleted. Tick to mark the card as “missing from Zapier”.</div>${m.missing.map((x) => `<label class="tiny" style="display:flex; gap:8px; padding:3px 0;">
      <input type="checkbox" ${x.selected ? 'checked' : ''} onchange="OL.zapImportToggleMissing('${esc(x.zapId)}', this.checked)"> ${esc(x.name)}</label>`).join('')}</div>` : '';
    const n = m.items.filter((i) => i.selected).length;
    const flow = flowPreview(m);
    const newDrafts = m.items.filter((i) => i.selected && !i.card && i.isDraft).length;
    const pendingExisting = m.items.filter((i) => i.selected && i.card && isPendingStatus(i.card.status) && !(i.isDraft && session.draftsPending)).length;
    return `${head('Review Zap import')}<div class="modal-body" style="max-width:880px;">
      ${accountBanner(m)}
      <div style="margin:8px 0;">${chip('new', c.new, STATUS_COLOR.new)}${chip('changed', c.changed, STATUS_COLOR.changed)}${c.baseline ? chip('already here', c.baseline, STATUS_COLOR.baseline) : ''}${chip('unchanged', c.unchanged, STATUS_COLOR.unchanged)}${c.missing ? chip('missing', c.missing, '#dc2626') : ''}</div>
      ${m.historyAvailable ? '' : `<div class="tiny" style="color:#d97706; margin-bottom:6px;">Change history is not set up yet, so this import will update the cards but will not save a history. (Run the SQL migration to turn it on.)</div>`}
      <label class="tiny" style="display:flex; gap:6px; margin:6px 0;"><input type="checkbox" ${session.showUnchanged ? 'checked' : ''} onchange="OL.zapImportSet('showUnchanged', this.checked)"> Show unchanged Zaps</label>
      <div style="max-height:320px; overflow:auto; border:1px solid var(--line,#e5e7eb); border-radius:8px; padding:0 10px;">${rows || '<div class="tiny muted" style="padding:12px;">Nothing new or changed.</div>'}</div>
      ${missing}
      <div class="card" style="padding:12px; margin-top:14px;">
        <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;"><span class="tiny" style="font-weight:600;">Show on the flow map in</span>
          <select class="modal-input tiny" style="width:auto;" onchange="OL.zapImportSet('stageChoice', this.value)">
            <option value="new" ${session.stageChoice === 'new' ? 'selected' : ''}>Stage “Zapier Automations”${stagesNow().some((x) => x.name === 'Zapier Automations') ? '' : ' (new)'}</option>
            ${stagesNow().filter((x) => x.name !== 'Zapier Automations').map((x) => `<option value="${esc(x.id)}" ${session.stageChoice === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}
            <option value="none" ${session.stageChoice === 'none' ? 'selected' : ''}>Don't place them yet</option></select></div>
        ${session.stageChoice === 'none' ? '' : `
        <label class="tiny" style="display:flex; gap:6px; margin-top:6px; align-items:center; flex-wrap:wrap;"><input type="checkbox" ${session.groupZaps ? 'checked' : ''} onchange="OL.zapImportSet('groupZaps', this.checked)"> Group related Zaps into workflows by
          <select class="modal-input tiny" style="width:auto;" ${session.groupZaps ? '' : 'disabled'} onchange="OL.zapImportSet('groupBy', this.value)">
            <option value="flow" ${session.groupBy !== 'trigger' ? 'selected' : ''}>how they work (chains, copies of the same flow, same name)</option>
            <option value="trigger" ${session.groupBy === 'trigger' ? 'selected' : ''}>what starts them (same trigger)</option></select></label>
        <label class="tiny" style="display:flex; gap:6px; margin-top:4px;"><input type="checkbox" ${session.skipInactive ? 'checked' : ''} onchange="OL.zapImportSet('skipInactive', this.checked)"> Keep OFF, old, retired, copy, test and draft-only Zaps off the map (they stay in the workbench)</label>`}
        <label class="tiny" style="display:flex; gap:6px; margin-top:4px;"><input type="checkbox" ${session.connectZaps ? 'checked' : ''} onchange="OL.zapImportSet('connectZaps', this.checked)"> Draw connections between Zaps that start each other (catch hooks)</label>
        <div class="tiny muted" style="margin-top:6px;">${flowText(flow)}</div>
      </div>
      <div class="card" style="padding:12px; margin-top:10px;">
        <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;"><span class="tiny" style="font-weight:600;">New Zap cards start as</span>
          <select class="modal-input tiny" style="width:auto;" onchange="OL.zapImportSet('newStatus', this.value)">
            <option value="Built" ${session.newStatus === 'Built' ? 'selected' : ''}>Built</option>
            <option value="Pending" ${session.newStatus === 'Pending' ? 'selected' : ''}>Pending</option></select>
          <span class="tiny muted">(${m.items.filter((i) => i.selected && !i.card).length} new)</span></div>
        ${newDrafts ? `<label class="tiny" style="display:flex; gap:6px; margin-top:6px;"><input type="checkbox" ${session.draftsPending ? 'checked' : ''} onchange="OL.zapImportSet('draftsPending', this.checked)"> ${newDrafts} Zap${newDrafts === 1 ? ' is' : 's are'} a draft with no published version: start ${newDrafts === 1 ? 'it' : 'them'} as Pending, not Built</label>` : ''}
        ${pendingExisting ? `<label class="tiny" style="display:flex; gap:6px; margin-top:6px;"><input type="checkbox" ${session.markExistingBuilt ? 'checked' : ''} onchange="OL.zapImportSet('markExistingBuilt', this.checked)"> Also mark the ${pendingExisting} existing Zap card${pendingExisting === 1 ? '' : 's'} that ${pendingExisting === 1 ? 'is' : 'are'} still Pending as Built</label>` : ''}
      </div>
      <div class="card" style="padding:12px; margin-top:10px;">
        <div class="tiny" style="font-weight:600;">Why were these changes made?</div>
        <div class="tiny muted" style="margin-bottom:6px;">Zapier cannot tell you who made an edit (your team shares the logins). This note is saved with every change in this import.</div>
        <textarea class="modal-input" style="width:100%; min-height:64px;" placeholder="e.g. Switched Wealthbox steps to Slant per client request" oninput="OL.zapImportSet('note', this.value, true)">${esc(session.note)}</textarea>
        <div style="display:flex; gap:10px; align-items:center; margin-top:6px;"><span class="tiny">Made by</span>
          <input class="modal-input tiny" style="width:200px;" value="${esc(session.author)}" oninput="OL.zapImportSet('author', this.value, true)">
          <label class="tiny" style="display:flex; gap:6px;"><input type="checkbox" ${session.leaveUnexplained ? 'checked' : ''} onchange="OL.zapImportSet('leaveUnexplained', this.checked)"> Leave unexplained for now</label></div>
      </div>
      <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:14px;">
        <button class="btn small soft" onclick="OL.zapImportBack()">Back</button>
        <button class="btn small primary" ${canApply(m) && !session.busy ? '' : 'disabled'} onclick="OL.zapImportApply()">${session.busy ? 'Importing…' : `Import ${n} Zap${n === 1 ? '' : 's'}`}</button></div>
      ${session.error ? `<p class="tiny" style="color:#dc2626;">${esc(session.error)}</p>` : ''}</div>`;
  }

  function renderDone() {
    const r = session.result; const h = r.history;
    const hist = !h ? '' : h.saved ? `<li>History saved: ${h.changes} change${h.changes === 1 ? '' : 's'}${h.unexplained ? ` (${h.unexplained} still need a note)` : ''}.</li>`
      : `<li style="color:#d97706;">History was not saved: ${esc(h.error)}</li>`;
    return `${head('Import finished')}<div class="modal-body" style="max-width:640px;"><ul class="tiny">
      <li>${r.created} Zap card${r.created === 1 ? '' : 's'} added, ${r.updated} updated.</li>
      ${r.placed ? `<li>${r.placed} card${r.placed === 1 ? '' : 's'} placed on the flow map in “${esc(r.stageName)}” (${r.workflows} workflow${r.workflows === 1 ? '' : 's'}).</li>` : ''}
      ${r.connections ? `<li>${r.connections} connection${r.connections === 1 ? '' : 's'} drawn between Zaps.</li>` : ''}
      ${r.markedBuilt ? `<li>${r.markedBuilt} card${r.markedBuilt === 1 ? '' : 's'} set to Built.</li>` : ''}
      ${r.draftsPending ? `<li>${r.draftsPending} draft-only Zap${r.draftsPending === 1 ? '' : 's'} left as Pending (never published).</li>` : ''}
      ${r.discovered ? `<li>${r.discovered} folder/spreadsheet resource${r.discovered === 1 ? '' : 's'} found and linked.</li>` : ''}
      ${r.removedFlagged ? `<li>${r.removedFlagged} card${r.removedFlagged === 1 ? '' : 's'} marked “missing from Zapier”.</li>` : ''}${hist}</ul>
      <div style="text-align:right;"><button class="btn small primary" onclick="OL.zapImportClose()">Done</button></div></div>`;
  }

  // ---------- reorganize Zaps that are already on the map ----------

  const saveFile = deps.saveFile || ((name, text) => {
    try { const blob = new Blob([text], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); return true; } catch { return false; }
  });
  const reorgOpts = () => { const o = (session.reorg && session.reorg.opts) || {}; return { groupBy: o.groupBy === 'trigger' ? 'trigger' : undefined, includeInactive: !!o.includeInactive, includeHandPlaced: !!o.includeHandPlaced, placeUnplaced: o.placeUnplaced !== false, groupZaps: o.groupZaps !== false }; };
  const replan = () => { const { client } = active(); session.reorg.plan = planReorganize(client.projectData || {}, reorgOpts()); };
  const KIND_LABEL = { chain: 'Call chain', versions: 'Versions of one flow', trigger: 'Same trigger', family: 'Name family', other: 'Other' };
  const KEPT_LABEL = { inactive: 'off / old / copy / test / draft-only', 'placed by hand': 'placed by hand', global: 'global', 'not on the map': 'not on the map' };

  function renderReorg() {
    const r = session.reorg; const p = r.plan; const c = p.counts;
    const todo = c.moved + c.placed + c.workflowsRemoved + c.reordered + c.workflowsCreated;
    const opt = (key, label, hint) => `<label class="tiny" style="display:block; margin:5px 0;"><input type="checkbox" ${(key === 'placeUnplaced' || key === 'groupZaps' ? r.opts[key] !== false : r.opts[key]) ? 'checked' : ''} onchange="OL.zapReorgSet('${key}', this.checked)"> ${label}${hint ? ` <span class="tiny muted">${hint}</span>` : ''}</label>`;
    const groups = p.groups.map((g) => `<tr><td><span style="font-size:10px; padding:1px 6px; border-radius:99px; background:rgba(61,217,197,0.15);">${esc(KIND_LABEL[g.kind] || g.kind)}</span></td><td>${esc(g.name)}</td><td>${g.zapIds.length}</td><td class="tiny muted">${g.isNew ? 'new workflow' : 'uses the existing workflow'}${g.reorder ? ', reordered' : ''}</td></tr>`).join('');
    const moves = p.moves.filter((m) => m.kind !== 'same');
    const moveRows = moves.slice(0, 60).map((m) => `<tr><td class="tiny">${esc(String(m.name).replace(/^⚡\s*/, ''))}</td><td class="tiny muted">${m.fromWorkflow ? esc(m.fromWorkflow) : '(not on the map)'}</td><td class="tiny">→ ${esc(m.toWorkflow)}</td></tr>`).join('');
    const keptBy = {}; p.kept.forEach((k) => { keptBy[k.reason] = (keptBy[k.reason] || 0) + 1; });
    const keptText = Object.entries(keptBy).map(([k, n]) => `${n} ${KEPT_LABEL[k] || k}`).join(', ');
    return `${head('Reorganize Zaps already on the map')}<div class="modal-body" style="max-width:860px;">
      <p class="tiny muted" style="margin-top:0;">Re-sorts the Zap cards in <strong>${esc(((active().client || {}).meta || {}).name || 'this project')}</strong> with the current rules. Nothing changes until you press Apply.</p>
      <div style="display:flex; gap:22px; flex-wrap:wrap;">
        <div style="flex:1; min-width:250px;">${opt('groupZaps', 'Group Zaps into workflows')}
          <label class="tiny" style="display:block; margin:5px 0;">Group by <select class="modal-input tiny" onchange="OL.zapReorgSet('groupBy', this.value)"><option value="flow" ${r.opts.groupBy !== 'trigger' ? 'selected' : ''}>how they work</option><option value="trigger" ${r.opts.groupBy === 'trigger' ? 'selected' : ''}>what starts them</option></select></label>
          ${opt('placeUnplaced', 'Put Zaps that are not on the map yet onto it')}
          ${opt('includeInactive', 'Include off / old / copy / test / draft-only Zaps')}
          ${opt('includeHandPlaced', 'Also move Zaps I placed by hand', '(normally left exactly where you put them)')}</div>
        <div class="tiny" style="flex:1; min-width:250px; line-height:1.6;">
          <div><strong>${c.considered}</strong> Zap card${c.considered === 1 ? '' : 's'} in this project</div>
          <div>${c.moved} will move to a different workflow, ${c.placed} will be placed, ${c.unchanged} are already right</div>
          <div>${c.workflowsCreated} workflow${c.workflowsCreated === 1 ? '' : 's'} created, ${c.workflowsReused} reused, ${c.workflowsRemoved} empty old one${c.workflowsRemoved === 1 ? '' : 's'} removed${c.reordered ? `, ${c.reordered} reordered` : ''}</div>
          ${keptText ? `<div class="muted">Left alone: ${esc(keptText)}</div>` : ''}</div></div>
      ${todo ? '' : '<p class="tiny" style="color:#166534; margin-top:10px;">✔ Everything is already organized by the current rules.</p>'}
      ${groups ? `<div class="tiny" style="font-weight:600; margin-top:12px;">Workflows after this</div><div style="max-height:200px; overflow:auto;"><table class="tiny" style="width:100%;"><tbody>${groups}</tbody></table></div>` : ''}
      ${moveRows ? `<div class="tiny" style="font-weight:600; margin-top:12px;">What moves${moves.length > 60 ? ` (first 60 of ${moves.length})` : ''}</div><div style="max-height:220px; overflow:auto;"><table class="tiny" style="width:100%;"><tbody>${moveRows}</tbody></table></div>` : ''}
      <p class="tiny muted" style="margin-top:12px;">Only the stage / workflow a card sits in, the workflow list and each card's group label change. Statuses, notes, owners, links, positions and steps are not touched. A backup file is saved first.</p>
      <details style="margin-top:6px;"><summary class="tiny muted" style="cursor:pointer;">Restore from a backup file instead</summary><input type="file" accept=".json,application/json" style="margin-top:6px;" onchange="OL.zapReorgRestoreFile(this)"></details>
      ${session.busy ? '<p class="tiny muted">Working…</p>' : ''}${session.error ? `<p class="tiny" style="color:#dc2626;">${esc(session.error)}</p>` : ''}
      <div style="text-align:right; margin-top:12px;"><button class="btn small soft" onclick="OL.zapImportBack()">Back</button> <button class="btn small primary" ${todo && !session.busy ? '' : 'disabled'} onclick="OL.zapReorgApply()">Apply</button></div></div>`;
  }

  function renderReorgDone() {
    const r = session.reorg.result;
    const li = (n, one, many) => (n ? `<li>${n} ${n === 1 ? one : many}</li>` : '');
    return `${head(r.undone ? 'Reorganize undone' : 'Reorganize finished')}<div class="modal-body" style="max-width:640px;">
      ${r.undone ? `<p class="tiny">Everything was put back as it was (${r.restored} card${r.restored === 1 ? '' : 's'}).</p>` : `<ul class="tiny">
        ${li(r.moved, 'card moved to a different workflow.', 'cards moved to a different workflow.')}${li(r.placed, 'card placed on the flow map.', 'cards placed on the flow map.')}
        ${li(r.workflowsCreated, 'workflow created.', 'workflows created.')}${li(r.workflowsRemoved, 'empty old workflow removed.', 'empty old workflows removed.')}${li(r.reordered, 'workflow reordered.', 'workflows reordered.')}
        <li>${r.unchanged} card${r.unchanged === 1 ? ' was' : 's were'} already in the right place.</li>
        <li>${r.backupSaved ? `A backup file was saved (${esc(r.backupName)}).` : 'The backup file could not be saved by the browser, but Undo below still works until you close this window.'}</li></ul>`}
      ${session.error ? `<p class="tiny" style="color:#dc2626;">${esc(session.error)}</p>` : ''}
      <div style="text-align:right;">${r.undone ? '' : '<button class="btn small soft" onclick="OL.zapReorgUndo()">Undo</button> '}<button class="btn small primary" onclick="OL.zapImportClose()">Done</button></div></div>`;
  }

  const render = () => (session.step === 'pick' ? renderPick() : session.step === 'review' ? renderReview() : session.step === 'reorg' ? renderReorg() : session.step === 'reorgDone' ? renderReorgDone() : renderDone());
  const show = () => openModal(render());

  // ---------- what the buttons call ----------

  async function loadText(text) {
    session.error = ''; session.busy = true; show();
    try {
      const json = JSON.parse(text);
      const bad = validate(json);
      if (bad) throw new Error(bad);
      session.model = await buildModel(json);
      session.step = 'review';
      session.author = session.author || getUserName() || '';
      session.confirmAccount = false; session.overrideMismatch = false;
    } catch (e) { session.error = e instanceof SyntaxError ? 'That file is not valid JSON.' : String((e && e.message) || e); }
    session.busy = false; show();
  }

  const api = {
    openZapImport() {
      const { client } = active();
      if (!client) return alert('No active project. Open a client project first.');
      Object.assign(session, { step: 'pick', model: null, error: '', note: '', newStatus: 'Built', markExistingBuilt: false, draftsPending: true, stageChoice: 'new', groupZaps: true, groupBy: 'flow', skipInactive: true, connectZaps: true, leaveUnexplained: false, result: null, busy: false });
      show();
    },
    zapReorgOpen() {
      const { client } = active();
      if (!client) return alert('No active project. Open a client project first.');
      session.reorg = { opts: { groupBy: 'flow', includeInactive: false, includeHandPlaced: false, placeUnplaced: true, groupZaps: true }, plan: null, result: null, backup: null };
      session.error = ''; session.busy = false; replan(); session.step = 'reorg'; show();
    },
    zapReorgSet(key, value) { session.reorg.opts[key] = value; replan(); show(); },
    async zapReorgApply() {
      if (session.busy) return;
      const { id, client } = active();
      session.busy = true; session.error = ''; show();
      try {
        const plan = planReorganize(client.projectData || {}, reorgOpts());
        const done = applyReorganize(client.projectData, plan, { makeId: uid, now });
        session.reorg.backup = done.backup;
        const name = `zap-reorganize-backup_${String(((client.meta || {}).name) || 'project').replace(/[^A-Za-z0-9]+/g, '-')}_${now().toISOString().slice(0, 10)}.json`;
        const saved = !!saveFile(name, JSON.stringify(done.backup));
        markClientDirty(id); await persist();
        if (typeof afterApply === 'function') afterApply();
        session.reorg.result = { ...done, backup: undefined, backupSaved: saved, backupName: name };
        session.step = 'reorgDone';
      } catch (e) { session.error = `Reorganize stopped: ${String((e && e.message) || e)}`; }
      session.busy = false; show();
    },
    async zapReorgUndo() {
      const { id, client } = active();
      try {
        const out = restoreBackup(client.projectData, session.reorg.backup);
        markClientDirty(id); await persist();
        if (typeof afterApply === 'function') afterApply();
        session.reorg.result = { undone: true, restored: out.restored }; session.error = '';
      } catch (e) { session.error = `Undo failed: ${String((e && e.message) || e)}`; }
      show();
    },
    async zapReorgRestoreFile(input) {
      const f = input && input.files && input.files[0]; if (!f) return;
      const { id, client } = active();
      try {
        const out = restoreBackup(client.projectData, JSON.parse(await f.text()));
        markClientDirty(id); await persist();
        if (typeof afterApply === 'function') afterApply();
        session.reorg.result = { undone: true, restored: out.restored }; session.error = ''; session.step = 'reorgDone';
      } catch (e) { session.error = e instanceof SyntaxError ? 'That file is not valid JSON.' : `Restore failed: ${String((e && e.message) || e)}`; }
      show();
    },
    async zapImportFile(input) { const f = input && input.files && input.files[0]; if (f) await loadText(await f.text()); },
    async zapImportDrop(ev) { const f = ev && ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0]; if (f) await loadText(await f.text()); },
    async zapImportPaste() { const el = document.getElementById('zap-import-paste'); if (el && el.value.trim()) await loadText(el.value); },
    zapImportSet(key, value, quiet) { session[key] = value; if (!quiet) show(); },
    zapImportToggle(zapId, on) { const it = session.model.items.find((i) => i.zapId === String(zapId)); if (it) it.selected = !!on; show(); },
    zapImportToggleMissing(zapId, on) { const it = session.model.missing.find((i) => i.zapId === String(zapId)); if (it) it.selected = !!on; show(); },
    zapImportBack() { session.step = 'pick'; session.error = ''; show(); },
    zapImportClose() { if (typeof closeModal === 'function') closeModal(); },
    async zapImportApply() {
      if (!canApply(session.model) || session.busy) return;
      session.busy = true; session.error = ''; show();
      try {
        session.result = await applyImport(session.model, { note: session.note.trim(), author: session.author.trim(), leaveUnexplained: session.leaveUnexplained, newStatus: session.newStatus, markExistingBuilt: session.markExistingBuilt, draftsPending: session.draftsPending, stageChoice: session.stageChoice, groupZaps: session.groupZaps, groupBy: session.groupBy, skipInactive: session.skipInactive, connectZaps: session.connectZaps });
        session.step = 'done';
      } catch (e) { session.error = `Import stopped: ${String((e && e.message) || e)}`; }
      session.busy = false; show();
    },
  };

  return { api, session, validate, buildModel, applyImport, renderReview, renderPick, renderDone, renderReorg, renderReorgDone, canApply, loadPrevious, fingerprint };
}
