//======================= FEATURES / INTEL LIBRARY =======================//
// What Sphynx has learned about apps, common requests and common errors. When a prospect comes in with specific applications,
// the Prospect Report turns their apps into recommendations and a list of "gotchas" to avoid.
//
// One entry shape (table intel_entries, migration 2026_11i), made from several places and shown in several places:
//   - the Intel Library page (Vault)                -> add, edit, search, filter, Prospect Report
//   - an app's page (Master Apps)                   -> that app's intel, with an Add button
//   - an error in Error Tracking                    -> "Save as intel", prefilled from the error
// Every failed database call is shown to the person; nothing reports success it did not get.

import { db, state, esc } from '../core/data.js';

const KINDS = [
    { key: 'gotcha',         label: 'Gotcha',         icon: 'alert-triangle', color: '#f59e0b' },
    { key: 'recommendation', label: 'Recommendation', icon: 'badge-check',    color: '#22c55e' },
    { key: 'common_request', label: 'Common request', icon: 'message-square', color: '#38bdf8' },
    { key: 'common_error',   label: 'Common error',   icon: 'bug',            color: '#ef4444' },
    { key: 'note',           label: 'Note',           icon: 'sticky-note',    color: '#94a3b8' },
];
const kindOf = (k) => KINDS.find((x) => x.key === k) || KINDS[KINDS.length - 1];
const ic = (name, size = 12) => `<i data-lucide="${name}" style="width:${size}px;height:${size}px;vertical-align:-2px;"></i>`;

OL.intelState = { rows: [], loaded: false, error: '', kind: '', app: '', q: '', returnTo: null };

const masterApps = () => (state.master?.apps || []).filter((a) => a && a.name).slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
const entryApps = (r) => (Array.isArray(r.apps) ? r.apps : []);
const appKey = (a) => (a.id ? `id:${a.id}` : `name:${String(a.name || '').trim().toLowerCase()}`);
const entryHasApp = (r, app) => entryApps(r).some((a) => (app.id && String(a.id) === String(app.id)) || String(a.name || '').trim().toLowerCase() === String(app.name || '').trim().toLowerCase());
const whoAmI = () => (typeof OL.getCurrentUserName === 'function' ? OL.getCurrentUserName() : '') || state.currentUser?.name || 'Sphynx Team';
const canUseIntel = () => !window.IS_GUEST && (state.adminMode === true || state.teamMemberMode === true);

OL.loadIntel = async function() {
    const { data, error } = await db.from('intel_entries').select('*').order('created_at', { ascending: false }).limit(5000);
    if (error) {
        OL.intelState.error = `Could not load the Intel Library (${error.message}). If this is the first time, run migration 2026_11i_intel_entries.sql in Supabase.`;
        OL.intelState.rows = [];
        OL.intelState.loaded = true;
        throw new Error(OL.intelState.error);
    }
    OL.intelState.error = '';
    OL.intelState.rows = data || [];
    OL.intelState.loaded = true;
    return OL.intelState.rows;
};

// ---------- library page ----------
OL.renderIntelLibrary = async function() {
    const main = document.getElementById('mainContent');
    if (!main) return;
    main.style.cssText = '';
    document.body.classList.remove('is-visualizer');
    if (!OL.intelState.loaded) {
        main.innerHTML = `<div class="section-header"><h2 style="margin:0;">Intel Library</h2></div><div class="muted" style="padding:20px;">Loading...</div>`;
        try { await OL.loadIntel(); } catch (e) { console.error(e); }
    }
    OL._paintIntelLibrary();
};

OL._paintIntelLibrary = function() {
    const main = document.getElementById('mainContent');
    if (!main) return;
    const st = OL.intelState;
    const q = st.q.trim().toLowerCase();
    const rows = st.rows.filter((r) => {
        if (st.kind && r.kind !== st.kind) return false;
        if (st.app && !entryApps(r).some((a) => appKey(a) === st.app)) return false;
        if (q && ![r.title, r.details, r.how_to_avoid, ...entryApps(r).map((a) => a.name)].some((t) => String(t || '').toLowerCase().includes(q))) return false;
        return true;
    });
    const appOptions = new Map();
    st.rows.forEach((r) => entryApps(r).forEach((a) => { if (a.name) appOptions.set(appKey(a), a.name); }));
    const sortedApps = [...appOptions.entries()].sort((a, b) => a[1].localeCompare(b[1]));
    const counts = Object.fromEntries(KINDS.map((k) => [k.key, st.rows.filter((r) => r.kind === k.key).length]));

    main.innerHTML = `
        <div class="section-header" style="display:flex; align-items:center; gap:12px;">
            ${ic('lightbulb', 24)}
            <div style="flex:1;">
                <h2 style="margin:0;">Intel Library</h2>
                <div class="small muted subheader">Gotchas, recommendations, common requests and common errors by app. ${st.rows.length} entr${st.rows.length === 1 ? 'y' : 'ies'}.</div>
            </div>
            <div class="header-actions" style="display:flex; gap:8px;">
                <button class="btn soft" onclick="OL.openIntelReport()">${ic('file-text')} Prospect report</button>
                <button class="btn primary" onclick="OL.openIntelModal()">${ic('plus')} Add intel</button>
            </div>
        </div>
        ${st.error ? `<div class="card" style="padding:12px 14px; margin:10px 0; border-color:#ef4444; color:#ef4444;">${esc(st.error)}</div>` : ''}
        <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin:12px 0;">
            <input type="text" id="intel-search" class="modal-input tiny" style="flex:1; min-width:200px; max-width:360px;" placeholder="Search intel..." value="${esc(st.q)}" oninput="OL.setIntelFilter('q', this.value)">
            <select class="modal-input tiny" style="width:auto;" onchange="OL.setIntelFilter('kind', this.value)">
                <option value="">All types</option>
                ${KINDS.map((k) => `<option value="${k.key}" ${st.kind === k.key ? 'selected' : ''}>${k.label} (${counts[k.key]})</option>`).join('')}
            </select>
            <select class="modal-input tiny" style="width:auto;" onchange="OL.setIntelFilter('app', this.value)">
                <option value="">All apps</option>
                ${sortedApps.map(([k, n]) => `<option value="${esc(k)}" ${st.app === k ? 'selected' : ''}>${esc(n)}</option>`).join('')}
            </select>
        </div>
        <div id="intel-list" style="display:grid; gap:10px; grid-template-columns:minmax(0,1fr);">
            ${rows.length ? rows.map((r) => OL.renderIntelCard(r)).join('') : `<div class="muted" style="padding:24px; text-align:center;">${st.rows.length ? 'Nothing matches these filters.' : 'No intel yet. Add the first entry, or use "Save as intel" on an error or an app.'}</div>`}
        </div>`;
    if (window.lucide) lucide.createIcons();
};

OL.setIntelFilter = function(key, value) {
    OL.intelState[key] = value;
    if (key === 'q') {
        // repaint only the list so the search box keeps focus while typing
        const list = document.getElementById('intel-list');
        if (list) { OL._paintIntelLibrary(); const el = document.getElementById('intel-search'); if (el) { el.focus(); el.setSelectionRange(value.length, value.length); } return; }
    }
    OL._paintIntelLibrary();
};

OL.renderIntelCard = function(r, opts = {}) {
    const k = kindOf(r.kind);
    const apps = entryApps(r);
    const source = r.source_type === 'error' && r.source_id
        ? `<a href="javascript:void(0)" class="tiny" style="color:var(--accent);" onclick="OL.openErrorDetailModal('${esc(r.source_id)}')">${ic('bug', 11)} From an error</a>`
        : r.source_type === 'app' ? `<span class="tiny muted">From an app page</span>` : '';
    return `
        <div class="card" style="padding:12px 14px;">
            <div style="display:flex; align-items:flex-start; gap:10px;">
                <div style="color:${k.color}; margin-top:2px;">${ic(k.icon, 16)}</div>
                <div style="flex:1; min-width:0;">
                    <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                        <span style="font-weight:700; font-size:14px;">${esc(r.title)}</span>
                        <span class="tiny" style="color:${k.color}; font-weight:600;">${k.label}</span>
                        ${apps.map((a) => `<span class="tiny" style="padding:1px 7px; border-radius:999px; border:1px solid var(--line);">${esc(a.name)}</span>`).join('')}
                    </div>
                    ${r.details ? `<div style="margin-top:6px; font-size:13px; white-space:pre-wrap; line-height:1.45;">${esc(r.details)}</div>` : ''}
                    ${r.how_to_avoid ? `<div style="margin-top:6px; font-size:13px; white-space:pre-wrap; line-height:1.45;"><span class="tiny muted bold">How to avoid or fix: </span>${esc(r.how_to_avoid)}</div>` : ''}
                    <div style="margin-top:6px; display:flex; gap:12px; align-items:center;">
                        ${source}
                        <span class="tiny muted">${esc(r.created_by || '')}${r.created_at ? ` · ${esc(new Date(r.created_at).toLocaleDateString([], { dateStyle: 'medium' }))}` : ''}</span>
                    </div>
                </div>
                ${opts.readOnly ? '' : `<div style="display:flex; gap:6px;">
                    <button class="btn tiny soft" onclick="OL.openIntelModal('${esc(r.id)}')">Edit</button>
                    <button class="btn tiny soft" onclick="OL.deleteIntel('${esc(r.id)}')">Delete</button>
                </div>`}
            </div>
        </div>`;
};

// ---------- add / edit ----------
// prefill: { kind, title, details, how_to_avoid, apps, source_type, source_id }. returnTo: function called after the modal closes
// (save or cancel), so a modal opened from an app page or an error goes back to where it came from.
OL.openIntelModal = async function(idOrNull, prefill = null, returnTo = null) {
    if (!canUseIntel()) { alert('Only Sphynx team members can use the Intel Library.'); return; }
    if (!OL.intelState.loaded) { try { await OL.loadIntel(); } catch (e) { alert(e.message); return; } }
    const existing = idOrNull ? OL.intelState.rows.find((r) => String(r.id) === String(idOrNull)) : null;
    if (idOrNull && !existing) { alert('That intel entry could not be found. Reload the page and try again.'); return; }
    const e = existing || prefill || {};
    OL.intelState.returnTo = returnTo;
    OL._intelEditId = existing ? existing.id : null;
    OL._intelSource = existing ? { source_type: existing.source_type, source_id: existing.source_id } : { source_type: e.source_type || 'manual', source_id: e.source_id || null };
    const picked = entryApps(e);
    const pickedKeys = new Set(picked.map(appKey));
    const library = masterApps();
    const libKeys = new Set(library.map((a) => `id:${a.id}`));
    const others = picked.filter((a) => !a.id || !libKeys.has(`id:${a.id}`)).map((a) => a.name).filter(Boolean);

    const html = `
        <div class="modal-head">
            <div class="modal-title-text">${ic('lightbulb', 16)} ${existing ? 'Edit intel' : 'Add intel'}</div>
            <button class="btn small soft" onclick="OL.closeIntelModal()">Close</button>
        </div>
        <div class="modal-body" style="width:100%; max-width:none; box-sizing:border-box;">
            <div style="display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:18px; align-items:start;">
                <div style="display:flex; flex-direction:column; gap:10px;">
                    <div>
                        <label class="tiny muted bold">Type</label>
                        <select id="intel-kind" class="modal-input tiny" style="width:100%;">${KINDS.map((k) => `<option value="${k.key}" ${(e.kind || 'gotcha') === k.key ? 'selected' : ''}>${k.label}</option>`).join('')}</select>
                    </div>
                    <div>
                        <label class="tiny muted bold">Title *</label>
                        <input type="text" id="intel-title" class="modal-input tiny" style="width:100%; box-sizing:border-box;" placeholder="Short, e.g. Wealthbox workflows can't be triggered by API" value="${esc(e.title || '')}">
                    </div>
                    <div>
                        <label class="tiny muted bold">What to know</label>
                        <textarea id="intel-details" class="modal-input tiny" rows="6" style="width:100%; box-sizing:border-box;" placeholder="What happens, when it comes up, why it matters.">${esc(e.details || '')}</textarea>
                    </div>
                    <div>
                        <label class="tiny muted bold">How to avoid or fix it</label>
                        <textarea id="intel-avoid" class="modal-input tiny" rows="4" style="width:100%; box-sizing:border-box;" placeholder="What to do, or what to recommend instead.">${esc(e.how_to_avoid || '')}</textarea>
                    </div>
                </div>
                <div>
                    <label class="tiny muted bold">Apps this applies to</label>
                    <div class="tiny muted" style="margin-bottom:4px;">Tick more than one for something that only matters when apps are used together.</div>
                    <input type="text" class="modal-input tiny" style="width:100%; box-sizing:border-box; margin-bottom:6px;" placeholder="Filter apps..." oninput="OL.filterIntelApps(this.value)">
                    <div id="intel-app-list" style="max-height:260px; overflow-y:auto; border:1px solid var(--line); border-radius:6px; padding:6px;">
                        ${library.length ? library.map((a) => `
                            <label data-name="${esc(String(a.name).toLowerCase())}" style="display:flex !important; align-items:center; gap:8px; padding:3px 4px; margin:0 !important; cursor:pointer; font-size:12px;">
                                <input type="checkbox" class="intel-app-box" data-id="${esc(a.id)}" data-name="${esc(a.name)}" ${pickedKeys.has(`id:${a.id}`) || pickedKeys.has(`name:${String(a.name).trim().toLowerCase()}`) ? 'checked' : ''}>
                                ${esc(a.name)}
                            </label>`).join('') : `<div class="tiny muted">No apps in the Master Apps library yet.</div>`}
                    </div>
                    <div style="margin-top:8px;">
                        <label class="tiny muted bold">Other apps (not in the library), comma separated</label>
                        <input type="text" id="intel-other-apps" class="modal-input tiny" style="width:100%; box-sizing:border-box;" value="${esc(others.join(', '))}" placeholder="e.g. Orion, Practifi">
                    </div>
                </div>
            </div>
            <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:16px;">
                <button class="btn small soft" onclick="OL.closeIntelModal()">Cancel</button>
                <button class="btn small primary" style="font-weight:bold;" onclick="OL.saveIntel()">${existing ? 'Save changes' : 'Add intel'}</button>
            </div>
        </div>`;
    window.openModal(html);
    if (window.lucide) lucide.createIcons();
};

OL.filterIntelApps = function(q) {
    const t = String(q || '').trim().toLowerCase();
    document.querySelectorAll('#intel-app-list label').forEach((l) => { l.style.display = !t || (l.dataset.name || '').includes(t) ? 'flex' : 'none'; });
};

OL.closeIntelModal = function() {
    const back = OL.intelState.returnTo;
    OL.intelState.returnTo = null;
    OL.closeModal();
    if (typeof back === 'function') back();
};

OL.saveIntel = async function() {
    const title = document.getElementById('intel-title')?.value.trim();
    if (!title) { alert('A title is required.'); return; }
    const apps = [...document.querySelectorAll('.intel-app-box:checked')].map((b) => ({ id: b.dataset.id, name: b.dataset.name }));
    String(document.getElementById('intel-other-apps')?.value || '').split(',').map((s) => s.trim()).filter(Boolean).forEach((name) => {
        if (!apps.some((a) => a.name.toLowerCase() === name.toLowerCase())) apps.push({ id: null, name });
    });
    const row = {
        kind: document.getElementById('intel-kind')?.value || 'gotcha',
        title,
        details: document.getElementById('intel-details')?.value.trim() || null,
        how_to_avoid: document.getElementById('intel-avoid')?.value.trim() || null,
        apps,
    };
    let saved, error;
    if (OL._intelEditId) {
        ({ data: saved, error } = await db.from('intel_entries').update(row).eq('id', OL._intelEditId).select('*'));
        if (!error && (!saved || !saved.length)) error = new Error('The entry was not updated (it may have been deleted, or you do not have permission).');
    } else {
        ({ data: saved, error } = await db.from('intel_entries').insert({ ...row, ...OL._intelSource, created_by: whoAmI() }).select('*'));
        if (!error && (!saved || !saved.length)) error = new Error('The entry was not saved (you may not have permission).');
    }
    if (error) { console.error('Intel save failed:', error); alert(`Could not save the intel: ${error.message}`); return; }
    const row2 = saved[0];
    const rows = OL.intelState.rows;
    const i = rows.findIndex((r) => String(r.id) === String(row2.id));
    if (i >= 0) rows[i] = row2; else rows.unshift(row2);
    if (typeof OL.showToast === 'function') OL.showToast(OL._intelEditId ? 'Intel updated' : 'Intel added');
    OL.closeIntelModal();
    if (location.hash.startsWith('#/business/intel')) OL._paintIntelLibrary();
};

OL.deleteIntel = async function(id) {
    const r = OL.intelState.rows.find((x) => String(x.id) === String(id));
    if (!r || !confirm(`Delete "${r.title}"?`)) return;
    const { data, error } = await db.from('intel_entries').delete().eq('id', id).select('id');
    if (error || !data || !data.length) { alert(`Could not delete the intel${error ? `: ${error.message}` : ' (you may not have permission).'}`); return; }
    OL.intelState.rows = OL.intelState.rows.filter((x) => String(x.id) !== String(id));
    if (location.hash.startsWith('#/business/intel')) OL._paintIntelLibrary();
};

// ---------- an app's page ----------
// Fills the empty #app-intel-section in the app modal with that app's intel. Only for apps in the Master library (or linked to one).
OL.fillAppIntelSection = async function(app) {
    const el = document.getElementById('app-intel-section');
    if (!el) return;
    if (!canUseIntel() || !app) { el.innerHTML = ''; return; }
    const masterId = app.masterRefId || (state.master?.apps || []).find((a) => String(a.id) === String(app.id))?.id || null;
    const target = { id: masterId, name: app.name };
    OL._intelAppCtx = { appId: app.id, masterId, name: app.name };
    try { if (!OL.intelState.loaded) await OL.loadIntel(); }
    catch (e) { el.innerHTML = `<div class="tiny" style="color:#ef4444;">${esc(e.message)}</div>`; return; }
    const rows = OL.intelState.rows.filter((r) => entryHasApp(r, target));
    const appId = app.id;
    el.innerHTML = `
        <div style="margin-top:18px; border-top:1px solid var(--line); padding-top:12px;">
            <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
                ${ic('lightbulb', 14)}<span style="font-weight:700; font-size:13px; flex:1;">Intel (${rows.length})</span>
                <button class="btn tiny soft" onclick="OL.addIntelForApp('${esc(appId)}')">${ic('plus', 11)} Add intel</button>
            </div>
            <div style="display:grid; gap:8px; grid-template-columns:minmax(0,1fr);">
                ${rows.length ? rows.map((r) => OL.renderIntelCard(r, { readOnly: true })).join('') : `<div class="tiny muted">Nothing logged for this app yet.</div>`}
            </div>
        </div>`;
    if (window.lucide) lucide.createIcons();
};

OL.addIntelForApp = function(appId) {
    const ctx = OL._intelAppCtx;
    if (!ctx || String(ctx.appId) !== String(appId)) { alert('Could not tell which app this is for. Close and reopen the app and try again.'); return; }
    OL.openIntelModal(null, { kind: 'gotcha', apps: [{ id: ctx.masterId, name: ctx.name }], source_type: 'app', source_id: String(appId) }, () => OL.openAppModal(appId));
};

// ---------- from an error ----------
OL.saveErrorAsIntel = function(errorId) {
    const r = (OL.errorLogState?.rows || []).find((x) => String(x.id) === String(errorId));
    if (!r) { alert('Could not find that error. Reload the page and try again.'); return; }
    const svc = String(r.service || '').trim();
    const match = svc ? masterApps().find((a) => String(a.name).trim().toLowerCase() === svc.toLowerCase()) : null;
    const apps = svc ? [{ id: match ? match.id : null, name: match ? match.name : svc }] : [];
    const details = [r.message, r.cause ? `Cause: ${r.cause}` : ''].filter(Boolean).join('\n\n');
    OL.openIntelModal(null, {
        kind: 'common_error', title: r.title || (r.message || '').split('\n')[0].slice(0, 120), details, how_to_avoid: r.resolution || '',
        apps, source_type: 'error', source_id: String(r.id),
    }, () => OL.openErrorDetailModal(errorId));
};

// ---------- prospect report ----------
OL.openIntelReport = async function() {
    if (!canUseIntel()) { alert('Only Sphynx team members can use the Intel Library.'); return; }
    if (!OL.intelState.loaded) { try { await OL.loadIntel(); } catch (e) { alert(e.message); return; } }
    const library = masterApps();
    // apps that have intel but are not in the library still need to be pickable
    const extra = new Map();
    OL.intelState.rows.forEach((r) => entryApps(r).forEach((a) => { if (!a.id && a.name) extra.set(a.name.trim().toLowerCase(), a.name); }));
    const choices = [...library.map((a) => ({ id: a.id, name: a.name })), ...[...extra.values()].filter((n) => !library.some((a) => String(a.name).trim().toLowerCase() === n.trim().toLowerCase())).map((n) => ({ id: null, name: n }))]
        .sort((a, b) => a.name.localeCompare(b.name));
    const withIntel = new Set();
    OL.intelState.rows.forEach((r) => entryApps(r).forEach((a) => withIntel.add(appKey(a))));
    OL._intelReportChoices = choices;
    const html = `
        <div class="modal-head">
            <div class="modal-title-text">${ic('file-text', 16)} Prospect report</div>
            <button class="btn small soft" onclick="OL.closeModal()">Close</button>
        </div>
        <div class="modal-body" style="width:100%; max-width:none; box-sizing:border-box;">
            <div style="display:grid; grid-template-columns:minmax(0,320px) minmax(0,1fr); gap:18px; align-items:start;">
                <div>
                    <label class="tiny muted bold">Apps the prospect uses</label>
                    <input type="text" class="modal-input tiny" style="width:100%; box-sizing:border-box; margin:4px 0 6px;" placeholder="Filter apps..." oninput="OL.filterIntelReportApps(this.value)">
                    <div id="intel-report-apps" style="max-height:420px; overflow-y:auto; border:1px solid var(--line); border-radius:6px; padding:6px;">
                        ${choices.map((a, i) => `
                            <label data-name="${esc(a.name.toLowerCase())}" style="display:flex !important; align-items:center; gap:8px; padding:3px 4px; margin:0 !important; cursor:pointer; font-size:12px;">
                                <input type="checkbox" class="intel-report-box" data-i="${i}" onchange="OL.buildIntelReport()">
                                <span style="flex:1;">${esc(a.name)}</span>
                                ${withIntel.has(appKey(a)) || [...withIntel].some((k) => k === `name:${a.name.trim().toLowerCase()}`) ? `<span class="tiny muted">intel</span>` : ''}
                            </label>`).join('') || '<div class="tiny muted">No apps yet.</div>'}
                    </div>
                </div>
                <div>
                    <div style="display:flex; gap:8px; margin-bottom:8px;">
                        <button class="btn tiny soft" onclick="OL.copyIntelReport()">${ic('copy', 11)} Copy text</button>
                        <button class="btn tiny soft" onclick="OL.printIntelReport()">${ic('printer', 11)} Print</button>
                    </div>
                    <div id="intel-report-out" style="border:1px solid var(--line); border-radius:6px; padding:12px 14px; min-height:200px; font-size:13px; line-height:1.5;"><span class="muted">Tick the apps the prospect uses to see recommendations and gotchas.</span></div>
                </div>
            </div>
        </div>`;
    window.openModal(html);
    if (window.lucide) lucide.createIcons();
};

OL.filterIntelReportApps = function(q) {
    const t = String(q || '').trim().toLowerCase();
    document.querySelectorAll('#intel-report-apps label').forEach((l) => { l.style.display = !t || (l.dataset.name || '').includes(t) ? 'flex' : 'none'; });
};

// Sections: one per selected app (recommendations first, then gotchas, common requests, common errors, notes), then a section for
// entries that tie two or more of the selected apps together. An entry tied to several selected apps appears only in that last section.
OL._intelReportModel = function() {
    const chosen = [...document.querySelectorAll('.intel-report-box:checked')].map((b) => OL._intelReportChoices[Number(b.dataset.i)]).filter(Boolean);
    const rows = OL.intelState.rows;
    const order = ['recommendation', 'gotcha', 'common_request', 'common_error', 'note'];
    const byKind = (list) => order.flatMap((k) => list.filter((r) => r.kind === k));
    const matchedApps = (r) => chosen.filter((c) => entryHasApp(r, c));
    const combos = rows.filter((r) => matchedApps(r).length >= 2);
    const comboIds = new Set(combos.map((r) => r.id));
    const sections = chosen.map((c) => ({ app: c.name, rows: byKind(rows.filter((r) => entryHasApp(r, c) && !comboIds.has(r.id))) }));
    return { chosen, sections, combos: byKind(combos).map((r) => ({ r, apps: matchedApps(r).map((a) => a.name) })) };
};

OL.buildIntelReport = function() {
    const out = document.getElementById('intel-report-out');
    if (!out) return;
    const m = OL._intelReportModel();
    if (!m.chosen.length) { out.innerHTML = `<span class="muted">Tick the apps the prospect uses to see recommendations and gotchas.</span>`; return; }
    const item = (r, tag) => {
        const k = kindOf(r.kind);
        return `<div style="margin:0 0 10px; padding-left:10px; border-left:3px solid ${k.color};">
            <div><span style="font-weight:700;">${esc(r.title)}</span> <span class="tiny" style="color:${k.color}; font-weight:600;">${k.label}</span>${tag ? ` <span class="tiny muted">${esc(tag)}</span>` : ''}</div>
            ${r.details ? `<div style="white-space:pre-wrap;">${esc(r.details)}</div>` : ''}
            ${r.how_to_avoid ? `<div style="white-space:pre-wrap;"><span class="tiny muted bold">How to avoid or fix: </span>${esc(r.how_to_avoid)}</div>` : ''}
        </div>`;
    };
    out.innerHTML = `
        ${m.combos.length ? `<h3 style="margin:0 0 8px; font-size:15px;">Using these apps together</h3>${m.combos.map((c) => item(c.r, c.apps.join(' + '))).join('')}` : ''}
        ${m.sections.map((s) => `<h3 style="margin:14px 0 8px; font-size:15px;">${esc(s.app)}</h3>${s.rows.length ? s.rows.map((r) => item(r)).join('') : `<div class="tiny muted" style="margin-bottom:8px;">No intel logged for this app yet.</div>`}`).join('')}`;
};

OL._intelReportText = function() {
    const m = OL._intelReportModel();
    const line = (r, tag) => [`- ${r.title} (${kindOf(r.kind).label}${tag ? `; ${tag}` : ''})`, r.details ? `  ${String(r.details).replace(/\n/g, '\n  ')}` : '', r.how_to_avoid ? `  How to avoid or fix: ${String(r.how_to_avoid).replace(/\n/g, '\n  ')}` : ''].filter(Boolean).join('\n');
    return [
        m.combos.length ? `USING THESE APPS TOGETHER\n${m.combos.map((c) => line(c.r, c.apps.join(' + '))).join('\n')}` : '',
        ...m.sections.map((s) => `${s.app.toUpperCase()}\n${s.rows.length ? s.rows.map((r) => line(r)).join('\n') : '- No intel logged for this app yet.'}`),
    ].filter(Boolean).join('\n\n');
};

OL.copyIntelReport = async function() {
    const text = OL._intelReportText();
    if (!text) { alert('Tick at least one app first.'); return; }
    try { await navigator.clipboard.writeText(text); } catch (e) { alert(`Could not copy to the clipboard: ${e.message}`); return; }
    if (typeof OL.showToast === 'function') OL.showToast('Report copied');
};

OL.printIntelReport = function() {
    const out = document.getElementById('intel-report-out');
    if (!out || !document.querySelector('.intel-report-box:checked')) { alert('Tick at least one app first.'); return; }
    const w = window.open('', '_blank');
    if (!w) { alert('The print window was blocked. Allow pop-ups for this site and try again.'); return; }
    w.document.write(`<!doctype html><title>Prospect report</title><body style="font-family:system-ui,sans-serif; max-width:760px; margin:24px auto; line-height:1.5; font-size:14px;"><h1 style="font-size:20px;">Prospect report</h1>${out.innerHTML}</body>`);
    w.document.close();
    w.focus();
    w.print();
};
