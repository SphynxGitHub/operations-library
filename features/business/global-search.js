//======================= FEATURES / BUSINESS / GLOBAL SEARCH =======================//
// One search box for the whole workspace, on the Daily Command Dashboard. Type a few words and get matches grouped by
// what they are — projects, tasks, requests, resources, applications, functions, emails, meetings and errors — and click
// one to open it.
//
//   Projects, tasks, requests, resources, applications and functions are searched in memory, as you type. That covers
//   every project the app has loaded (a project that has not been opened yet has no tasks or resources loaded, and the
//   panel says so).
//   Emails, meetings and errors are searched on the server (a short pause after typing), so they cover everything and
//   not only what is showing on the dashboard.
//
// Every word typed has to match (name, type, description, assignee, project name...), so "zap intake acme" narrows down
// rather than widens. Names that start with what you typed come first.

import { state, esc, db, getBusinessScopedClients, scopeQueryToBusinessClients, loadFullClient } from '../../core/data.js';
import { matchesQuery } from '../../core/resource-groups.js';

const PER_GROUP = 6;
const isBlank = (v) => v === undefined || v === null || String(v).trim() === '';
const plain = (html) => String(html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ');
const low = (v) => String(v ?? '').toLowerCase();

OL._globalSearch = OL._globalSearch || { query: '', token: 0, remote: null, timer: null, expanded: {} };

// ---- what is searched --------------------------------------------------------------------------------------------
// Each entry: { group, title, sub, text (what is searched), open: () => opens it }. Built fresh per search: cheap, and
// always current with edits.
function localEntries() {
    const out = [];
    const clients = getBusinessScopedClients() || [];
    clients.forEach((c) => {
        const cName = c.meta?.name || 'Unnamed';
        const pd = c.projectData || {};
        const contacts = (pd.teamMembers || []).map((m) => `${m.name || ''} ${m.email || ''}`).join(' ');
        out.push({ group: 'Projects', title: cName, sub: c.meta?.status || '', text: `${cName} ${c.meta?.status || ''} ${contacts}`, open: () => OL.switchClient(c.id) });

        (pd.clientTasks || []).forEach((t) => {
            if (!t) return;
            const title = t.title || t.name || 'Task';
            out.push({ group: 'Tasks', title, sub: `${cName} · ${t.assignee || 'Unassigned'}${t.status ? ' · ' + t.status : ''}`,
                text: `${title} ${t.assignee || ''} ${t.status || ''} ${plain(t.description)} ${cName}`, open: () => OL.openTaskInContext(c.id, String(t.id)) });
        });

        (pd.scopingSheets || []).flatMap((sh) => sh?.lineItems || []).forEach((it) => {
            if (!it || isBlank(it.id)) return;
            const res = (pd.localResources || []).find((r) => String(r.id) === String(it.resourceId));
            const title = (it.name && String(it.name).trim()) || res?.name || '';
            if (!title) return;
            out.push({ group: 'Requests', title, sub: `${cName} · ${it.status === 'Backlog' ? 'Pending' : (it.status || '')}`,
                text: `${title} ${it.status || ''} ${it.requestType || ''} ${plain(it.notes)} ${cName}`, open: () => OL.openRequestFromTask(c.id, String(it.id)) });
        });

        (pd.localResources || []).forEach((r) => {
            if (!r || r.systemPinned || r.adminPinned || r.isArchived || r.archived || String(r.id).startsWith('step-')) return;
            out.push({ group: 'Resources', title: r.name || 'Untitled', sub: `${cName}${r.type ? ' · ' + r.type : ''}`,
                text: `${r.name || ''} ${r.type || ''} ${plain(r.description)} ${cName}`, open: () => OL.openResourceInContext(c.id, String(r.id)) });
        });

        (pd.localApps || []).forEach((a) => {
            if (!a || a.isHidden) return;
            out.push({ group: 'Applications', title: a.name || 'Unnamed', sub: `${cName} · project app`, text: `${a.name || ''} ${a.notes || ''} ${cName}`, open: () => OL.openAppInContext(c.id, String(a.id)) });
        });
    });
    (state.master?.apps || []).forEach((a) => out.push({ group: 'Applications', title: a.name || 'Unnamed', sub: 'Master Library', text: `${a.name || ''} ${a.notes || ''}`, open: () => OL.openAppModal(String(a.id)) }));
    (state.master?.functions || []).forEach((f) => out.push({ group: 'Functions', title: f.name || 'Unnamed', sub: 'Master Library', text: `${f.name || ''} ${plain(f.description)}`, open: () => OL.openFunctionModal(String(f.id)) }));
    return out;
}

const GROUP_ORDER = ['Projects', 'Tasks', 'Requests', 'Resources', 'Applications', 'Functions', 'Emails', 'Meetings', 'Errors'];

// Best matches first: a title that starts with the query, then one that contains it, then matches elsewhere.
export function rankEntries(entries, query) {
    const q = low(query).trim();
    const score = (e) => (low(e.title).startsWith(q) ? 0 : low(e.title).includes(q) ? 1 : 2);
    return entries.filter((e) => matchesQuery(low(e.text), query)).sort((a, b) => score(a) - score(b) || String(a.title).localeCompare(String(b.title)));
}

// ---- server-side groups ------------------------------------------------------------------------------------------
// PostgREST's or() filter breaks on commas, parentheses and wildcards, so those are removed from what is sent.
const safe = (q) => String(q || '').replace(/[,()%*_\\]/g, ' ').trim();

async function remoteEntries(query) {
    const q = safe(query);
    if (q.length < 2) return [];
    const like = `%${q}%`;
    const out = [];
    const run = async (label, build) => { try { out.push(...await build()); } catch (e) { console.warn(`Search: ${label} unavailable:`, e?.message || e); } };
    await Promise.all([
        run('emails', async () => {
            const { data } = await scopeQueryToBusinessClients(db.from('gmail_messages').select('id, subject, sender, snippet, date, linked_client_id')
                .or(`subject.ilike.${like},sender.ilike.${like},snippet.ilike.${like}`), 'linked_client_id').order('date', { ascending: false }).limit(20);
            return (data || []).map((m) => ({ group: 'Emails', title: m.subject || '(no subject)', sub: `${String(m.sender || '').replace(/<.*>/, '').trim()}${m.date ? ' · ' + String(m.date).slice(0, 10) : ''}`,
                text: `${m.subject} ${m.sender} ${m.snippet}`, open: () => OL.openGmailMessageModal(String(m.id)) }));
        }),
        run('meetings', async () => {
            const { data } = await scopeQueryToBusinessClients(db.from('calendar_events').select('id, title, start, linked_client_id')
                .or(`title.ilike.${like},description.ilike.${like}`), 'linked_client_id').order('start', { ascending: false }).limit(20);
            return (data || []).map((e) => ({ group: 'Meetings', title: e.title || 'Meeting', sub: e.start ? String(e.start).slice(0, 10) : '', text: e.title || '', open: () => OL.openCalendarEventModal(String(e.id)) }));
        }),
        run('errors', async () => {
            const { data } = await scopeQueryToBusinessClients(db.from('error_log').select('id, title, message, service, occurred_at, client_id')
                .or(`title.ilike.${like},message.ilike.${like},service.ilike.${like}`), 'client_id').order('occurred_at', { ascending: false }).limit(20);
            return (data || []).map((r) => ({ group: 'Errors', title: r.title || r.message || 'Error', sub: `${r.service || ''}${r.occurred_at ? ' · ' + String(r.occurred_at).slice(0, 10) : ''}`, text: `${r.title} ${r.message}`, open: () => { window.location.hash = '#/business/errors'; } }));
        }),
    ]);
    return out;
}

// ---- drawing -----------------------------------------------------------------------------------------------------
function panelHtml(query, local, remote, searching) {
    const clients = Object.values(state.clients || {});
    const notLoaded = clients.filter((c) => c._metaOnly).length;
    const groups = {};
    [...rankEntries(local, query), ...(remote || [])].forEach((e) => { (groups[e.group] = groups[e.group] || []).push(e); });
    const st = OL._globalSearch;
    st.shown = [];                                    // what is on screen, in order: a click or Enter opens by position
    const body = GROUP_ORDER.filter((g) => groups[g]).map((g) => {
        const list = groups[g];
        const shown = st.expanded[g] ? list : list.slice(0, PER_GROUP);
        return `<div class="search-category-label">${g} <span class="muted" style="font-weight:400;">(${list.length})</span></div>`
            + shown.map((e) => {
                st.shown.push(e);
                return `<div class="search-result-item" data-gs="${st.shown.length - 1}" style="display:flex; justify-content:space-between; gap:10px; cursor:pointer;" onmousedown="event.preventDefault(); OL.globalSearchOpen(${st.shown.length - 1})">
                    <span style="min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(e.title)}</span>
                    <span class="tiny muted" style="flex-shrink:0; max-width:55%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(e.sub)}</span></div>`;
            }).join('')
            + (list.length > shown.length ? `<div class="search-result-item muted tiny" style="cursor:pointer;" onmousedown="event.preventDefault(); OL.globalSearchExpand('${g}')">Show ${list.length - shown.length} more ${g.toLowerCase()}</div>` : '');
    }).join('');
    return (body || `<div class="search-result-item muted">${searching ? 'Searching…' : `No results for "${esc(query)}"`}</div>`)
        + (searching && body ? '<div class="search-result-item muted tiny">Searching emails, meetings and errors…</div>' : '')
        + (notLoaded ? `<div class="search-result-item muted tiny">${notLoaded} project${notLoaded === 1 ? ' has' : 's have'} not been opened yet, so ${notLoaded === 1 ? 'its' : 'their'} tasks and resources are not searched.</div>` : '');
}

function draw(searching) {
    const box = document.getElementById('global-search-panel');
    if (!box) return;
    const st = OL._globalSearch;
    if (isBlank(st.query)) { box.innerHTML = ''; return; }
    box.innerHTML = panelHtml(st.query, localEntries(), st.remote, searching);
}

OL.globalSearchInput = function(value) {
    const st = OL._globalSearch;
    st.query = value; st.remote = null; st.expanded = {};
    clearTimeout(st.timer);
    const token = ++st.token;
    draw(!isBlank(value) && safe(value).length >= 2);
    if (safe(value).length < 2) return;
    st.timer = setTimeout(async () => {
        const remote = await remoteEntries(value);
        if (token !== st.token) return;               // typed something newer meanwhile
        st.remote = remote; draw(false);
    }, 280);
};
OL.globalSearchExpand = function(group) { OL._globalSearch.expanded[group] = true; draw(false); };
OL.globalSearchOpen = function(index) {
    const e = (OL._globalSearch.shown || [])[index];
    const box = document.getElementById('global-search-panel'); if (box) box.innerHTML = '';
    if (!e) return;
    try { e.open(); } catch (err) { console.error('Search: could not open result:', err); }
};
OL.globalSearchKey = function(ev) {
    if (ev.key === 'Escape') { ev.target.value = ''; OL.globalSearchInput(''); ev.target.blur(); }
    else if (ev.key === 'Enter') { ev.preventDefault(); OL.globalSearchOpen(0); }   // the best match
};

// The search box; put it at the top of a page. Keeps what was typed when the page redraws.
OL.globalSearchHtml = function() {
    return `
        <div class="search-map-container search-map-container--full" style="margin-bottom:18px; position:relative;">
            <input type="text" id="global-search-input" class="modal-input" autocomplete="off"
                   placeholder="Search everything — projects, tasks, requests, resources, apps, emails, meetings…   ( / )"
                   value="${esc(OL._globalSearch.query || '')}"
                   oninput="OL.globalSearchInput(this.value)" onfocus="OL.globalSearchRestore()" onkeydown="OL.globalSearchKey(event)">
            <div id="global-search-panel" class="search-results-overlay" style="max-height:60vh; overflow:auto;"></div>
        </div>`;
};
// After the dashboard redraws (its data loads in stages), bring the results back for whatever was typed.
OL.globalSearchRestore = function() { if (!isBlank(OL._globalSearch.query)) draw(false); };

// ---- opening things that live inside a project ------------------------------------------------------------------
async function enterProject(clientId) {
    try { await loadFullClient(clientId); } catch (e) { /* opens what it can */ }
    if (typeof OL.navigateToClientProject === 'function') OL.navigateToClientProject(clientId);
    await new Promise((r) => setTimeout(r, 350));   // let the project view draw before its window opens
}
OL.openResourceInContext = async function(clientId, id) { await enterProject(clientId); if (typeof OL.openResourceModal === 'function') OL.openResourceModal(id); };
OL.openAppInContext = async function(clientId, id) { await enterProject(clientId); if (typeof OL.openAppModal === 'function') OL.openAppModal(id); };

// "/" jumps to the search box on the dashboard (not while typing somewhere else).
document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    const input = document.getElementById('global-search-input');
    if (input) { e.preventDefault(); input.focus(); input.select(); }
});
