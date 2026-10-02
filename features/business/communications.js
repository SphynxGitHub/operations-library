import { groupResources, groupsHtml, flattenGroups } from '../../core/resource-groups.js';
import { esc, decodeEntities, uid, state, db, updateAndSync, getBusinessScopedClients, isInBusinessScope, scopeQueryToBusinessClients } from '../../core/data.js';
import { getRequestTypes, nextOpenRound } from '../../core/requests.js';
import { isMaintenanceClient, ensureMaintenanceSheet, buildMaintenanceRequest } from '../../core/maintenance.js';
import { getOlSettings } from '../../core/ol-settings.js';

const GMAIL_FEED_LIMIT = 150;

OL.commTabState = {
    activeTab: 'feed', // 'feed' | 'gmail' | 'quo'
    query: '',
    loading: false,
    backfilling: false,
    showArchived: false,
    feedLoadedOnce: false,
    // Per-link-type filter, each 'any' | 'has' | 'not' — lets you combine
    // conditions across project/resource/task/event (e.g. "has a project,
    // no task yet") instead of one blanket labeled/unlabeled toggle.
    linkFilters: { project: 'any', resource: 'any', task: 'any', event: 'any' },
    projectFilter: '',    // clientId, or '' for all
    dateFilter: 'all',    // 'all' | 'today' | 'week' | 'month'
    groupBy: 'none',      // 'none' | 'project' | 'date'
    subGroupBy: 'none'    // 'none' | 'linkType' — task / event / resource / project-only / unlinked
};

// -------------------------------------------------------------
// After an action on an email (archive/unarchive/delete/link), refresh
// whatever the user is actually looking at. The email modal can be opened
// from the Dashboard, a Task's "Linked Emails" list, or a Resource — not
// just the Communications feed — so blindly calling
// renderBusinessCommunications() here was yanking people back to the
// Communications page mid-task. Only repaint Communications if that's
// really the active route; otherwise let the router redraw the current
// page from its own hash.
// -------------------------------------------------------------
OL._refreshAfterGmailAction = function() {
    // The dashboard keeps its own cached copy of the unarchived emails. Without this, archiving, restoring or
    // deleting an email left it showing on the dashboard (or missing from it) until a full reload.
    OL._dashboardEmailsCache = null;
    const hash = window.location.hash || '';
    if (hash.includes('/business/communications')) {
        OL.renderBusinessCommunications();
    } else if (typeof window.handleRoute === 'function') {
        window.handleRoute();
    }
};

OL.renderBusinessCommunications = function() {
    const main = document.getElementById("mainContent");
    if (!main) return;

    // Check URL parameters for OAuth return
    OL.checkGoogleAuthReturn();

    const clients = getBusinessScopedClients();
    const commsData = state.master?.communications || {
        gmail: { connected: false, email: '' },
        quo: { endpointSecret: 'whsec_' + Math.random().toString(36).slice(2, 10) },
        threads: []
    };

    const endpointUrl = `https://kexnnpwjerrnsmifauuo.supabase.co/functions/v1/quo-webhook`;

    // Auto-load the feed from Supabase once per session if connected and not yet loaded
    const isConnected = commsData.gmail?.connected || state.master?.googleConnected || false;
    if (isConnected && !OL.commTabState.feedLoadedOnce && !OL.commTabState.loading) {
        OL.commTabState.feedLoadedOnce = true;
        OL.loadGmailFeed().then(() => OL.renderBusinessCommunications());
    }

    main.innerHTML = `
        <div class="section-header">
            <div>
                <h2><i data-lucide="mail" style="width:24px;height:24px;vertical-align:sub;margin-right:8px;color:var(--accent);"></i>Communications Center</h2>
                <div class="small muted">Unified client inbox, Gmail OAuth sync, and Quo webhook integration</div>
            </div>
            <div class="header-actions" style="display:flex; gap:10px; align-items:center;">
                <button class="btn small ${OL.commTabState.activeTab === 'feed' ? 'primary' : 'soft'}" onclick="OL.switchCommTab('feed')">
                    <i data-lucide="inbox" style="width:14px;height:14px;"></i> Client Feed
                </button>
                <button class="btn small ${OL.commTabState.activeTab === 'gmail' ? 'primary' : 'soft'}" onclick="OL.switchCommTab('gmail')">
                    <i data-lucide="mail" style="width:14px;height:14px;"></i> Gmail Settings
                </button>
                <button class="btn small ${OL.commTabState.activeTab === 'quo' ? 'primary' : 'soft'}" onclick="OL.switchCommTab('quo')">
                    <i data-lucide="webhook" style="width:14px;height:14px;"></i> Quo Webhooks
                </button>
            </div>
        </div>

        ${OL.commTabState.activeTab === 'feed' ? OL.renderCommFeedView(commsData, clients) : ''}
        ${OL.commTabState.activeTab === 'gmail' ? OL.renderGmailConfigView(commsData) : ''}
        ${OL.commTabState.activeTab === 'quo' ? OL.renderQuoWebhookView(commsData, endpointUrl) : ''}
    `;

    if (window.lucide) lucide.createIcons();
};

OL.switchCommTab = function(tabName) {
    OL.commTabState.activeTab = tabName;
    OL.renderBusinessCommunications();
};

// -------------------------------------------------------------
// FOCUS-PRESERVING RE-RENDER — several search boxes here re-render their
// whole container on every keystroke (oninput), which was wiping the
// input's focus and cursor position after each letter typed. This
// remembers which element (by id) had focus and where the cursor was,
// runs the render, then restores both — so typing feels normal again.
// -------------------------------------------------------------
OL.reRenderPreservingFocus = function(renderFn) {
    const active = document.activeElement;
    const id = active && active.id;
    const start = active && typeof active.selectionStart === 'number' ? active.selectionStart : null;
    const end = active && typeof active.selectionEnd === 'number' ? active.selectionEnd : null;

    renderFn();

    if (!id) return;
    const el = document.getElementById(id);
    if (!el) return;
    el.focus();
    if (start !== null && typeof el.setSelectionRange === 'function') {
        try { el.setSelectionRange(start, end); } catch (e) { /* not a text-selectable input, ignore */ }
    }
};

// -------------------------------------------------------------
// 1. UNIFIED CLIENT FEED VIEW (GMAIL MESSAGES SYNCED INTO SUPABASE)
// -------------------------------------------------------------
// Collapses a list of messages down to the most recent one per thread (thread_id — a message with no
// thread_id is its own thread). The representative carries the rest as olThreadOlder, oldest first, so a row
// can expand in place instead of the whole thread re-rendering as separate list rows every time.
OL._expandedThreads = OL._expandedThreads || {};
function collapseToLatestPerThread(list) {
    const byThread = new Map();
    (list || []).forEach((m) => {
        const key = m.thread_id || ('_solo_' + m.id);
        if (!byThread.has(key)) byThread.set(key, []);
        byThread.get(key).push(m);
    });
    const out = [];
    byThread.forEach((msgs) => {
        const sorted = msgs.slice().sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
        const latest = sorted[0];
        latest.olThreadOlder = sorted.slice(1).reverse();   // oldest first, for reading order when expanded
        out.push(latest);
    });
    return out.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
}

OL.toggleThreadExpanded = function(threadKey) {
    OL._expandedThreads[threadKey] = !OL._expandedThreads[threadKey];
    OL.renderBusinessCommunications();
};

OL.renderCommFeedView = function(commsData, clients) {
    const isConnected = commsData.gmail?.connected || state.master?.googleConnected || false;
    const allThreads = commsData.threads || [];
    const q = OL.commTabState.query.trim().toLowerCase();

    const { linkFilters, projectFilter, dateFilter, groupBy, subGroupBy } = OL.commTabState;
    const now = new Date();
    const dateThreshold = (() => {
        if (dateFilter === 'today') { const d = new Date(now); d.setHours(0, 0, 0, 0); return d; }
        if (dateFilter === 'week') { const d = new Date(now); d.setDate(d.getDate() - 7); return d; }
        if (dateFilter === 'month') { const d = new Date(now); d.setMonth(d.getMonth() - 1); return d; }
        return null;
    })();

    // 'any' skips the check; 'has' requires the field to be set; 'not' requires it to be empty
    const matchesLinkFilter = (mode, fieldVal) => mode === 'any' || (mode === 'has' ? !!fieldVal : !fieldVal);

    const threads = allThreads.filter(m => {
        const matchesQuery = !q ||
            (m.sender || '').toLowerCase().includes(q) ||
            (m.subject || '').toLowerCase().includes(q) ||
            (m.snippet || '').toLowerCase().includes(q);

        const matchesLinks = matchesLinkFilter(linkFilters.project, m.linked_client_id)
            && matchesLinkFilter(linkFilters.resource, m.linked_resource_id)
            && matchesLinkFilter(linkFilters.task, m.linked_task_id)
            && matchesLinkFilter(linkFilters.event, m.linked_event_id);
        const matchesProject = !projectFilter || m.linked_client_id === projectFilter;
        const matchesDate = !dateThreshold || (m.date && new Date(m.date) >= dateThreshold);

        return matchesQuery && matchesLinks && matchesProject && matchesDate;
    });
    const collapsedThreads = collapseToLatestPerThread(threads);

    return `
        <div class="card" style="padding: 20px;">
            <div style="display:flex; flex-wrap:wrap; gap:10px; align-items:center; margin-bottom: 18px; border-bottom: 1px solid var(--line); padding-bottom: 15px;">
                <div style="display:flex; gap:10px; flex:2; min-width:220px;">
                    <i data-lucide="search" style="width:16px;height:16px;color:var(--muted); margin-top:6px;"></i>
                    <input type="text" id="comm-search-input" class="modal-input tiny" style="flex:1; width:100%;" placeholder="Search communications..." value="${esc(OL.commTabState.query)}" oninput="const v=this.value; OL.reRenderPreservingFocus(() => { OL.commTabState.query = v; OL.renderBusinessCommunications(); });">
                </div>

                <div class="link-filter-group" style="display:flex; gap:4px; align-items:center; padding:3px; border:1px solid var(--line); border-radius:6px;">
                    ${OL.renderLinkFilterButton('project', 'folder', 'Project')}
                    ${OL.renderLinkFilterButton('resource', 'box', 'Resource')}
                    ${OL.renderLinkFilterButton('task', 'check-square', 'Task')}
                    ${OL.renderLinkFilterButton('event', 'calendar', 'Event')}
                </div>

                ${OL.renderSearchableProjectPicker({
                    idPrefix: 'comm-project-filter',
                    clients: clients,
                    selectedId: projectFilter || '',
                    selectedLabel: projectFilter ? (clients.find(c => c.id === projectFilter)?.meta?.name || '') : '',
                    allOptionLabel: 'All Projects',
                    onSelect: 'setCommProjectFilter',
                    placeholder: 'All Projects'
                })}

                <select class="modal-input tiny" style="width:auto;" onchange="OL.setCommFilter('dateFilter', this.value)">
                    <option value="all" ${dateFilter === 'all' ? 'selected' : ''}>Any Date</option>
                    <option value="today" ${dateFilter === 'today' ? 'selected' : ''}>Today</option>
                    <option value="week" ${dateFilter === 'week' ? 'selected' : ''}>Past Week</option>
                    <option value="month" ${dateFilter === 'month' ? 'selected' : ''}>Past Month</option>
                </select>

                <select class="modal-input tiny" style="width:auto;" onchange="OL.setCommFilter('groupBy', this.value)">
                    <option value="none" ${groupBy === 'none' ? 'selected' : ''}>No Grouping</option>
                    <option value="project" ${groupBy === 'project' ? 'selected' : ''}>Group: Project</option>
                    <option value="date" ${groupBy === 'date' ? 'selected' : ''}>Group: Date</option>
                </select>

                ${groupBy !== 'none' ? `
                    <select class="modal-input tiny" style="width:auto;" onchange="OL.setCommFilter('subGroupBy', this.value)">
                        <option value="none" ${subGroupBy === 'none' ? 'selected' : ''}>No Sub-Group</option>
                        <option value="linkType" ${subGroupBy === 'linkType' ? 'selected' : ''}>Sub-Group: Task/Event/Resource</option>
                    </select>
                ` : ''}

                <div style="flex:1;"></div>

                ${isConnected ? `
                    <button class="btn tiny primary" onclick="OL.openComposeEmailModal({ onSent: () => { if (typeof OL.fetchLiveGmailMessages === 'function') OL.fetchLiveGmailMessages(); } })">
                        <i data-lucide="pencil" style="width:12px;height:12px;"></i> Compose New
                    </button>
                    <button class="btn tiny ${OL.commTabState.showArchived ? 'primary' : 'soft'}" onclick="OL.toggleShowArchivedGmail()">
                        <i data-lucide="archive" style="width:12px;height:12px;"></i> ${OL.commTabState.showArchived ? 'Showing Archived' : 'Archived'}
                    </button>
                    <button class="btn tiny soft" onclick="OL.fetchLiveGmailMessages()" ${OL.commTabState.loading ? 'disabled' : ''}>
                        <i data-lucide="refresh-cw" style="width:12px;height:12px;${OL.commTabState.loading ? 'animation: spin 1s linear infinite;' : ''}"></i>
                        ${OL.commTabState.loading ? 'Syncing...' : 'Sync Gmail'}
                    </button>
                    <button class="btn tiny soft" onclick="OL.backfillGmailProjectLinks()" ${OL.commTabState.backfilling ? 'disabled' : ''} title="Re-check every already-imported, unlinked email against each project's current Team tab — catches emails imported before a sender was added to a project.">
                        <i data-lucide="link-2" style="width:12px;height:12px;${OL.commTabState.backfilling ? 'animation: spin 1s linear infinite;' : ''}"></i>
                        ${OL.commTabState.backfilling ? 'Backfilling...' : 'Backfill Project Links'}
                    </button>
                ` : ''}
                <div class="tiny muted">Channels: <strong style="color:${isConnected ? '#22c55e' : 'var(--muted)'};">${isConnected ? '● Gmail Active' : '○ Gmail Offline'}</strong></div>
            </div>

            ${collapsedThreads.length === 0 ? `
                <div style="text-align:center; padding: 40px; color: var(--muted);">
                    <i data-lucide="inbox" style="width:36px;height:32px;margin-bottom:8px;opacity:0.5;"></i>
                    <div>${isConnected ? (OL.commTabState.showArchived ? 'No archived emails.' : 'No emails match these filters.') : 'Connect your Google account under Gmail Settings to stream real emails.'}</div>
                </div>
            ` : (groupBy === 'none' ? OL.renderCommThreadRows(collapsedThreads) : OL.renderGroupedCommThreads(collapsedThreads, groupBy, subGroupBy))}
        </div>
    `;
};

OL.setCommFilter = function(key, value) {
    OL.commTabState[key] = value;
    OL.renderBusinessCommunications();
};

// Tri-state chip: 'any' (neutral) -> 'has' (must be linked) -> 'not' (must NOT be linked) -> 'any'.
// Each of the 4 link types (project/resource/task/event) toggles independently, so they combine —
// e.g. project=has + task=not shows emails linked to a project but with no task yet.
OL.renderLinkFilterButton = function(type, icon, label) {
    const mode = OL.commTabState.linkFilters[type] || 'any';
    const styles = {
        any: { cls: 'soft', prefix: '' },
        has: { cls: 'primary', prefix: '✓ ' },
        not: { cls: 'soft', prefix: '✕ ' }
    }[mode];
    return `
        <button class="btn tiny ${styles.cls}" style="${mode === 'not' ? 'color:#ef4444; border-color:#ef4444;' : ''}"
                onclick="OL.cycleLinkFilter('${type}')" title="Click to cycle: any → has ${esc(label)} → no ${esc(label)}">
            <i data-lucide="${icon}" style="width:11px;height:11px;"></i> ${styles.prefix}${esc(label)}
        </button>
    `;
};

OL.cycleLinkFilter = function(type) {
    const order = ['any', 'has', 'not'];
    const current = OL.commTabState.linkFilters[type] || 'any';
    OL.commTabState.linkFilters[type] = order[(order.indexOf(current) + 1) % order.length];
    OL.renderBusinessCommunications();
};

OL.setCommProjectFilter = function(clientId) {
    OL.commTabState.projectFilter = clientId || '';
    OL.renderBusinessCommunications();
};

OL.renderCommThreadRows = function(threads) {
    return `
        ${threads.length > 1 && OL.renderEmailGroupSelectCheckbox ? `<label class="tiny muted" style="display:flex; align-items:center; gap:6px; margin:0 0 6px 12px; cursor:pointer;">${OL.renderEmailGroupSelectCheckbox(threads)} Select all ${threads.length}</label>` : ''}
        <div style="display:grid; gap:10px;">
            ${threads.map(m => OL.renderCommThreadRow(m)).join('')}
        </div>
    `;
};

OL.renderCommThreadRow = function(m) {
    const parsedSender = OL._parseSenderHeader(m.sender);
    const senderName = parsedSender?.name || m.sender || 'Unknown';
    const senderEmail = parsedSender?.email || '';
    const older = m.olThreadOlder || [];
    const threadKey = m.thread_id || m.id;
    const expanded = !!OL._expandedThreads[threadKey];

    if (older.length) {
        // Show the latest message's own row, then — only if expanded — the rest of the thread as smaller,
        // read-only rows right beneath it. Collapsed, it's one row with a toggle, not the whole chain.
        return `
            ${OL.renderCommThreadRow.single(m)}
            <div style="margin: -4px 0 2px 48px;">
                <button class="btn tiny soft" style="font-size:10px;" onclick="OL.toggleThreadExpanded('${esc(threadKey)}')">
                    <i data-lucide="${expanded ? 'chevron-up' : 'chevron-down'}" style="width:10px;height:10px;"></i>
                    ${expanded ? 'Hide' : 'Show'} ${older.length} earlier email${older.length === 1 ? '' : 's'} in this thread
                </button>
                ${expanded ? `<div style="display:grid; gap:6px; margin-top:6px;">${older.map((o) => OL.renderCommThreadRow.single(o, true)).join('')}</div>` : ''}
            </div>
        `;
    }
    return OL.renderCommThreadRow.single(m);
};

OL.renderCommThreadRow.single = function(m, muted = false) {
    const parsedSender = OL._parseSenderHeader(m.sender);
    const senderName = parsedSender?.name || m.sender || 'Unknown';
    const senderEmail = parsedSender?.email || '';

    return `
        <div style="display:grid; grid-template-columns: 38px 76px 160px minmax(0,1fr) 118px; gap: 10px; padding: ${muted ? '8px 12px' : '12px'}; background: ${OL.bulkEmailSelection?.[m.id] ? 'rgba(168,85,247,0.08)' : (muted ? 'transparent' : 'rgba(255,255,255,0.02)')}; border: 1px solid var(--line); border-radius: 6px; align-items:center; ${muted ? 'opacity:0.75; font-size:11px;' : ''}">
            <div style="display:flex; align-items:center; justify-content:center; gap:6px;" title="Select">
                ${OL.renderEmailSelectCheckbox ? OL.renderEmailSelectCheckbox(m) : ''}
                <i data-lucide="mail" style="width:14px;height:14px; color:var(--accent);"></i>
            </div>
            <div class="tiny muted monospace" style="white-space:nowrap;">${m.date ? new Date(m.date).toLocaleDateString() : ''}</div>
            <div style="min-width:0; cursor:pointer;" onclick="OL.openGmailMessageModal('${m.id}')">
                <div style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:bold; font-size:12px;">${esc(senderName)}</div>
                ${senderEmail ? `<div class="tiny muted" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(senderEmail)}</div>` : ''}
            </div>
            <div style="min-width:0; cursor:pointer;" onclick="OL.openGmailMessageModal('${m.id}')">
                <div style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(m.subject)}</div>
                ${m.snippet ? `<div class="tiny muted" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(decodeEntities(m.snippet))}</div>` : ''}
                ${m.linked_task_id ? `
                    <span class="pill tiny soft" style="font-size:9px; margin-top:4px; display:inline-flex; align-items:center; gap:3px; white-space:normal; max-width:100%;"><i data-lucide="link" style="width:9px;height:9px; flex-shrink:0;"></i> ${esc(OL.getLinkedTaskLabel(m))}</span>
                ` : (m.linked_resource_id ? `
                    <span class="pill tiny soft" style="font-size:9px; margin-top:4px; display:inline-flex; align-items:center; gap:3px; white-space:normal; max-width:100%;"><i data-lucide="database" style="width:9px;height:9px; flex-shrink:0;"></i> ${esc(OL.getLinkedResourceLabel(m))}</span>
                ` : (m.linked_event_id ? `
                    <span class="pill tiny soft" style="font-size:9px; margin-top:4px; display:inline-flex; align-items:center; gap:3px; white-space:normal; max-width:100%;"><i data-lucide="calendar" style="width:9px;height:9px; flex-shrink:0;"></i> Linked event</span>
                ` : (m.linked_client_id ? `
                    <span style="display:inline-block; margin-top:4px; max-width:100%;">${OL.renderProjectPill(m.linked_client_id, state.clients[m.linked_client_id]?.meta?.name)}</span>
                ` : '')))}
            </div>
            <div style="display:flex; gap:6px; justify-content:flex-end;">
                ${m.archived ? `
                    <button class="btn tiny soft" title="Move back to inbox" onclick="event.stopPropagation(); OL.unarchiveGmailMessage('${m.id}')"><i data-lucide="inbox" style="width:11px;height:11px;"></i></button>
                ` : `
                    <button class="btn tiny soft" title="Archive" onclick="event.stopPropagation(); OL.archiveGmailMessage('${m.id}')"><i data-lucide="archive" style="width:11px;height:11px;"></i></button>
                `}
                <button class="btn tiny soft" title="Link to project/resource/task" onclick="event.stopPropagation(); OL.openGmailMessageModal('${m.id}')"><i data-lucide="link" style="width:11px;height:11px;"></i></button>
                <button class="btn tiny soft" title="Delete" style="color:#ef4444;" onclick="event.stopPropagation(); OL.deleteGmailMessage('${m.id}')"><i data-lucide="trash-2" style="width:11px;height:11px;"></i></button>
            </div>
        </div>
    `;
};

// -------------------------------------------------------------
// GROUPING — top-level by project or date, optional sub-group by which
// kind of thing each thread links to (task / event / resource / project
// only / unlinked). Same pattern as the Error Log's grouping.
// -------------------------------------------------------------
OL._commLinkTypeLabel = function(m) {
    if (m.linked_task_id) return 'Tasks';
    if (m.linked_event_id) return 'Events';
    if (m.linked_resource_id) return 'Resources';
    if (m.linked_client_id) return 'Project Only (no specific link)';
    return 'Unlinked';
};

OL.renderGroupedCommThreads = function(threads, groupBy, subGroupBy) {
    const groups = new Map();
    threads.forEach(m => {
        let key, label;
        if (groupBy === 'project') {
            key = m.linked_client_id || '__unlabeled';
            label = m.linked_client_id ? (state.clients[m.linked_client_id]?.meta?.name || 'Unknown Project') : 'Unlabeled';
        } else { // 'date'
            key = m.date ? new Date(m.date).toDateString() : '__unknown';
            label = m.date ? new Date(m.date).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : 'Unknown Date';
        }
        if (!groups.has(key)) groups.set(key, { label, rows: [] });
        groups.get(key).rows.push(m);
    });

    const sortedGroups = [...groups.values()].sort((a, b) => b.rows.length - a.rows.length || a.label.localeCompare(b.label));

    return `
        <div style="display:grid; gap:20px;">
            ${sortedGroups.map(g => `
                <div>
                    <div class="tiny bold uppercase muted" style="margin-bottom:8px; padding-bottom:4px; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; align-items:center; gap:8px;">
                        <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(g.label)}</span>
                        <span class="pill tiny soft" style="flex-shrink:0;">${g.rows.length}</span>
                    </div>
                    ${subGroupBy === 'linkType' ? OL.renderCommSubGroups(g.rows) : OL.renderCommThreadRows(g.rows)}
                </div>
            `).join('')}
        </div>
    `;
};

OL.renderCommSubGroups = function(rows) {
    const subGroups = new Map();
    rows.forEach(m => {
        const label = OL._commLinkTypeLabel(m);
        if (!subGroups.has(label)) subGroups.set(label, []);
        subGroups.get(label).push(m);
    });

    return `
        <div style="display:grid; gap:14px; padding-left:12px;">
            ${[...subGroups.entries()].map(([label, subRows]) => `
                <div>
                    <div class="tiny muted" style="margin-bottom:6px; display:flex; align-items:center; gap:6px;">
                        <span>${esc(label)}</span>
                        <span class="pill tiny soft" style="font-size:9px;">${subRows.length}</span>
                    </div>
                    ${OL.renderCommThreadRows(subRows)}
                </div>
            `).join('')}
        </div>
    `;
};

OL.getLinkedTaskLabel = function(m) {
    const client = m.linked_client_id ? state.clients[m.linked_client_id] : null;
    const task = client?.projectData?.clientTasks?.find(t => t.id === m.linked_task_id);
    return task ? (task.title || task.name) : 'Linked task';
};

OL.getLinkedResourceLabel = function(m) {
    const client = m.linked_client_id ? state.clients[m.linked_client_id] : null;
    const resource = client?.projectData?.localResources?.find(r => r.id === m.linked_resource_id);
    return resource ? resource.name : 'Linked resource';
};

OL.toggleShowArchivedGmail = function() {
    OL.commTabState.showArchived = !OL.commTabState.showArchived;
    OL.loadGmailFeed().then(() => OL.renderBusinessCommunications());
};

// -------------------------------------------------------------
// 2. GMAIL OAUTH SETTINGS VIEW (NO EXTRA INPUT FIELDS)
// -------------------------------------------------------------
OL.renderGmailConfigView = function(commsData) {
    const isConnected = commsData.gmail?.connected;

    return `
        <div class="card" style="padding: 24px; max-width: 650px; margin: 0 auto;">
            <div style="display:flex; align-items:center; gap:12px; margin-bottom: 20px;">
                <i data-lucide="mail" style="width:32px;height:32px;color:var(--accent);"></i>
                <div>
                    <h3 style="margin:0;">Gmail Integration</h3>
                    <div class="tiny muted">OAuth 2.0 direct connection</div>
                </div>
            </div>

            <div style="padding: 20px; background: rgba(255,255,255,0.02); border: 1px solid var(--line); border-radius: 8px;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <strong style="font-size:14px;">Status:</strong>
                        <span style="color:${isConnected ? '#22c55e' : '#ef4444'}; font-weight:bold; margin-left:8px;">
                            ${isConnected ? '● Connected' : '○ Disconnected'}
                        </span>
                        ${commsData.gmail?.email ? `<div class="tiny muted" style="margin-top:4px;">Account: <strong>${esc(commsData.gmail.email)}</strong></div>` : ''}
                    </div>
                    ${isConnected ? `
                        <button class="btn tiny danger" onclick="OL.disconnectGmailAccount()">Disconnect</button>
                    ` : `
                        <button class="btn small primary" onclick="OL.initiateGoogleAuth()" style="display:flex; align-items:center; gap:8px;">
                            <i data-lucide="log-in" style="width:14px;height:14px;"></i> Connect Google Account
                        </button>
                    `}
                </div>
            </div>
        </div>
    `;
};

// -------------------------------------------------------------
// 3. QUO WEBHOOK INTEGRATION VIEW
// -------------------------------------------------------------
OL.renderQuoWebhookView = function(commsData, endpointUrl) {
    return `
        <div class="card" style="padding: 24px; max-width: 800px; margin: 0 auto;">
            <div style="display:flex; align-items:center; gap:12px; margin-bottom: 20px;">
                <i data-lucide="webhook" style="width:32px;height:32px;color:#38bdf8;"></i>
                <div>
                    <h3 style="margin:0;">Quo Webhook Listener</h3>
                    <div class="tiny muted">Receive real-time lead intake and form events</div>
                </div>
            </div>

            <div style="margin-bottom: 20px;">
                <label class="bold tiny uppercase muted">Webhook Endpoint URL (POST):</label>
                <div style="display:flex; gap:8px; margin-top:5px;">
                    <input type="text" class="modal-input monospace tiny" value="${endpointUrl}" readonly style="flex:1;">
                    <button class="btn tiny soft" onclick="navigator.clipboard.writeText('${endpointUrl}'); alert('Webhook URL Copied!');">Copy URL</button>
                </div>
            </div>
        </div>
    `;
};

// -------------------------------------------------------------
// LIVE GMAIL FETCH & ACTIONS
// -------------------------------------------------------------
// Connect Google Account. The start function needs a signed-in admin: the app asks it for the Google
// address (which carries a signed "state" that the callback checks), then goes there.
OL.initiateGoogleAuth = async function() {
    try {
        const response = await fetch("https://kexnnpwjerrnsmifauuo.supabase.co/functions/v1/google-auth-login", {
            headers: await OL.getAuthHeaders()
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.url) {
            alert(result.error === 'unauthorized' || result.error === 'forbidden'
                ? OL.sendAuthErrorMessage(result)
                : (result.message || 'Could not start the Google connection.'));
            return;
        }
        window.location.href = result.url;
    } catch (err) {
        console.error('Could not start the Google connection:', err);
        alert('Could not start the Google connection — see console for details.');
    }
};

OL.checkGoogleAuthReturn = function() {
    // Guard against re-processing: renderBusinessCommunications calls this on
    // every render, and fetchLiveGmailMessages/fetchLiveGoogleCalendar both
    // re-render when they finish — so without a one-time guard, and combined
    // with the hash-cleanup bug below, this was firing an infinite sync loop.
    if (OL._googleAuthReturnHandled) return;

    const urlParams = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.split('?')[1] || '');

    const isConnected = urlParams.get('connected') === 'true' || hashParams.get('connected') === 'true';

    if (isConnected) {
        OL._googleAuthReturnHandled = true;

        updateAndSync(() => {
            if (!state.master) state.master = {};
            if (!state.master.communications) state.master.communications = {};
            if (!state.master.communications.gmail) state.master.communications.gmail = {};
            if (!state.master.communications.drive) state.master.communications.drive = {};

            state.master.communications.gmail.connected = true;
            state.master.communications.drive.connected = true;
            state.master.googleConnected = true;
            state.master.googleDriveConnected = true;
        });

        // Clean the address bar without reloading. The redirect puts
        // "connected=true" INSIDE the hash (e.g. "#/business/communications
        // ?connected=true"), not in the page's real query string — stripping
        // only window.location.search (the old behavior) left it sitting in
        // the hash forever, which is what caused the loop above.
        const hashPath = window.location.hash.split('?')[0];
        window.history.replaceState({}, document.title, window.location.pathname + hashPath);

        // Auto-fetch Live Feeds including Drive sync
        if (typeof OL.fetchLiveGmailMessages === 'function') OL.fetchLiveGmailMessages();
        if (typeof OL.fetchLiveGoogleCalendar === 'function') OL.fetchLiveGoogleCalendar();
        
        // Trigger Drive workspace folder sync for active project if set
        if (state.activeClientId && typeof OL.resolveClientDriveFolder === 'function') {
            OL.resolveClientDriveFolder(state.activeClientId);
        }
    }
};

// Loads the feed straight from the gmail_messages table (this is the
// durable store now — nothing Gmail-related lives in the big JSON state
// blob anymore, so this doesn't bloat every save).
OL.loadGmailFeed = async function() {
    const { data, error } = await scopeQueryToBusinessClients(db
        .from('gmail_messages')
        .select('id, thread_id, sender, subject, snippet, date, linked_client_id, linked_task_id, linked_resource_id, linked_request_id, linked_event_id, link_locked, archived, participants')
        .eq('archived', OL.commTabState.showArchived), 'linked_client_id')
        .order('date', { ascending: false })
        .limit(GMAIL_FEED_LIMIT);

    if (error) {
        console.error('Failed to load Gmail feed:', error.message);
        return;
    }

    if (!state.master) state.master = {};
    if (!state.master.communications) state.master.communications = {};
    state.master.communications.threads = (data || []).filter(m => isInBusinessScope(m.linked_client_id));

    await OL.autoLinkGmailMessagesToTasks();
};

// True when an email subject is clearly about a task: the whole task title
// appears in it, or at least 2 (and at least 60%) of the title's meaningful
// words do. Short/generic words ("call", "the", "update") don't count.
OL._subjectMatchesTaskTitle = function(subjectLower, title) {
    const STOP = new Set(['the','a','an','and','or','for','to','of','in','on','with','re','fw','fwd','call','meeting','update','follow','up','task','email','new','review','check','zoom','sphynx']);
    const clean = (str) => String(str || '').toLowerCase().replace(/^(re|fw|fwd):\s*/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
    const subj = clean(subjectLower);
    const t = clean(title);
    if (!subj || !t) return false;
    if (t.length >= 8 && subj.includes(t)) return true;
    const words = [...new Set(t.split(' ').filter(w => w.length > 2 && !STOP.has(w)))];
    if (words.length < 2) return false;
    const subjWords = new Set(subj.split(' '));
    const hits = words.filter(w => subjWords.has(w)).length;
    return hits >= 2 && hits / words.length >= 0.6;
};

// -------------------------------------------------------------
// AUTO-LINK TO TASK — an email is already matched to a client at import
// time (server-side, via that project's Team tab emails — see
// supabase/functions/get-gmail-messages). This goes one step further: if
// exactly one OPEN task in that client is assigned to someone whose email
// appears among the message's participants (From/To/Cc), link the email
// to that task automatically. Zero or multiple candidate tasks are left
// alone for manual linking via the existing "Link to Task" button —
// ambiguous matches never get guessed.
// -------------------------------------------------------------
OL.autoLinkGmailMessagesToTasks = async function() {
    const threads = state.master?.communications?.threads || [];
    // link_locked = a person has set or cleared this email's links by hand.
    // Auto-linking never touches those again — this is what used to undo a
    // manual de-link on the very next feed load.
    const candidates = threads.filter(m => m.linked_client_id && !m.linked_task_id && !m.link_locked && !m.archived && (m.participants || []).length);
    if (!candidates.length) return;

    const updates = [];
    for (const m of candidates) {
        const client = state.clients?.[m.linked_client_id];
        if (!client) continue;

        const emailByAssignee = OL.buildAssigneeEmailMap(client);
        const participants = (m.participants || []).map(p => p.toLowerCase());
        const subjectText = `${m.subject || ''}`.toLowerCase();

        const openTasks = (client.projectData?.clientTasks || []).filter(t => t.status !== 'Done');
        // Two independent signals are required now. Assignee-in-participants
        // alone matched every email from a client contact who happened to
        // own exactly one open task (the Wealth IG problem: every email from
        // them landed on that one task). The subject also has to actually
        // be about the task.
        const matches = openTasks.filter(t => {
            const assigneeEmail = emailByAssignee[(t.assignee || '').toLowerCase()];
            if (!assigneeEmail || !participants.includes(assigneeEmail)) return false;
            return OL._subjectMatchesTaskTitle(subjectText, t.title || t.name || '');
        });

        if (matches.length === 1) {
            const matchedResource = OL._findResourceForTask(m.linked_client_id, matches[0]);
            updates.push({ id: m.id, taskId: matches[0].id, resourceId: matchedResource ? matchedResource.id : null });
        }
    }

    if (!updates.length) return;

    await Promise.all(updates.map(u =>
        db.from('gmail_messages').update({ linked_task_id: u.taskId, linked_resource_id: u.resourceId }).eq('id', u.id)
    ));

    // Reflect immediately so the caller's next render shows the link
    // without needing a second round-trip.
    updates.forEach(u => {
        const m = threads.find(t => t.id === u.id);
        if (m) { m.linked_task_id = u.taskId; m.linked_resource_id = u.resourceId; }
    });
};

// Lowercased assignee-name -> email, drawn from the same two rosters the
// assignee picker itself uses (OL.openEditTaskAssigneeDropdown): the
// internal Sphynx team, and this client's own Team tab.
OL.buildAssigneeEmailMap = function(client) {
    const map = {};
    (state.master?.sphynxTeam || []).forEach(m => {
        if (m.name && m.email) map[m.name.toLowerCase()] = m.email.toLowerCase();
    });
    const clientTeam = client?.projectData?.team || client?.projectData?.teamMembers || [];
    clientTeam.forEach(m => {
        if (typeof m === 'string' || !m.name || !m.email) return;
        map[m.name.toLowerCase()] = m.email.toLowerCase();
    });
    return map;
};

// One-off catch-up pass: re-checks every already-imported email that's
// still unlinked against each project's *current* Team tab emails.
// get-gmail-messages only ever matches at import time, so an email that
// predates a sender being added to a project's Team tab — or that was
// imported before the project had any Team tab emails at all — stays
// unlinked forever unless something goes back and re-checks it. Safe to
// click more than once; it only ever touches rows still unlinked.
OL.backfillGmailProjectLinks = async function() {
    if (OL.commTabState.backfilling) return;
    OL.commTabState.backfilling = true;
    OL.renderBusinessCommunications();

    try {
        const response = await fetch("https://kexnnpwjerrnsmifauuo.supabase.co/functions/v1/backfill-gmail-links", {
            method: 'POST',
            headers: await OL.getAuthHeaders()
        });

        const refusal = await OL.functionRefusal(response);
        if (refusal) { alert(OL.sendAuthErrorMessage(refusal)); return; }

        if (!response.ok) {
            alert('Backfill failed (HTTP ' + response.status + ').');
            return;
        }

        const result = await response.json();
        if (result.error) {
            alert('Backfill failed: ' + result.error);
            return;
        }

        await OL.loadGmailFeed();
        alert(`Backfill complete — scanned ${result.scannedCount ?? 0} unlinked email(s), linked ${result.matchedCount ?? 0} to a project.`);
    } catch (err) {
        console.error('Error backfilling Gmail project links:', err);
        alert('Backfill failed — see console for details.');
    } finally {
        OL.commTabState.backfilling = false;
        OL.renderBusinessCommunications();
    }
};

// Triggers an actual sync (imports anything new from the inbox into
// gmail_messages), then reloads the feed from the table.
OL.fetchLiveGmailMessages = async function() {
    if (OL.commTabState.loading) return; // Prevent concurrent loops
    OL.commTabState.loading = true;
    OL.renderBusinessCommunications();

    try {
        const response = await fetch("https://kexnnpwjerrnsmifauuo.supabase.co/functions/v1/get-gmail-messages", {
            headers: await OL.getAuthHeaders()
        });

        // Refused because this person is not signed in (or not allowed): that says nothing about the
        // Google connection, so leave the "connected" state alone.
        const refusal = await OL.functionRefusal(response);
        if (refusal) {
            console.warn("Gmail sync refused: " + OL.sendAuthErrorMessage(refusal));
            return;
        }

        if (response.status === 401) {
            // Token expired and refresh failed — flip back to "disconnected" so
            // the Connect button reappears instead of silently doing nothing.
            updateAndSync(() => {
                if (state.master?.communications?.gmail) state.master.communications.gmail.connected = false;
                if (state.master) state.master.googleConnected = false;
            });
            return;
        }

        if (!response.ok) {
            console.warn("Gmail sync failed (HTTP " + response.status + ")");
            return;
        }

        const syncResult = await response.json();
        console.log(`Gmail sync: ${syncResult.importedCount ?? 0} new of ${syncResult.scannedCount ?? 0} scanned, ${syncResult.labeledCount ?? 0} labeled`);

        await OL.loadGmailFeed();
    } catch (err) {
        console.error("Error syncing Gmail:", err);
    } finally {
        OL.commTabState.loading = false;
        OL.renderBusinessCommunications();
    }
};

// -------------------------------------------------------------
// AUTO-SYNC — periodically re-runs the same sync fetchLiveGmailMessages()
// does, so the feed updates without a manual "Sync Gmail" click while a
// tab is open. Only fires while Gmail is connected, and skips a tick if a
// sync (manual or auto) is already in flight. Complements the server-side
// pg_cron job (see supabase/migrations/auto_sync_cron.sql), which keeps
// gmail_messages fresh even when no tab is open at all.
// -------------------------------------------------------------
OL._gmailAutoSyncTimer = null;
OL.startGmailAutoSync = function(intervalMs = 5 * 60 * 1000) {
    if (OL._gmailAutoSyncTimer) return; // already running, don't stack timers
    OL._gmailAutoSyncTimer = setInterval(() => {
        const isConnected = state.master?.communications?.gmail?.connected || state.master?.googleConnected || false;
        if (!isConnected || OL.commTabState.loading) return;
        OL.fetchLiveGmailMessages();
    }, intervalMs);
};

OL.stopGmailAutoSync = function() {
    if (OL._gmailAutoSyncTimer) clearInterval(OL._gmailAutoSyncTimer);
    OL._gmailAutoSyncTimer = null;
};

OL.disconnectGmailAccount = function() {
    if (!confirm("Disconnect Google Account?")) return;
    updateAndSync(() => {
        if (state.master?.communications?.gmail) {
            state.master.communications.gmail.connected = false;
            state.master.communications.threads = [];
        }
    });
    OL.commTabState.feedLoadedOnce = false;
    OL.renderBusinessCommunications();
};

// -------------------------------------------------------------
// ARCHIVE / UNARCHIVE — app-side by default (hides from the feed here).
// Archiving also best-effort removes it from your real Gmail inbox, since
// you said that's fine once you're done with something.
// -------------------------------------------------------------
// Gmail's inbox works per conversation, so archive / restore / delete act
// on the whole thread (here and in Gmail) whenever the thread is known.
OL._gmailThreadIdFor = async function(id) {
    const cached = (state.master?.communications?.threads || []).find(m => m.id === id);
    if (cached && cached.thread_id !== undefined) return cached.thread_id || null;
    const { data } = await db.from('gmail_messages').select('thread_id').eq('id', id).maybeSingle();
    return data?.thread_id || null;
};

// opts.wholeThread (default true, the Archive button): the whole
// conversation. Linking passes false so ONLY the linked email is archived —
// other messages in the thread are never touched automatically; you get a
// suggestion instead (OL.promptThreadFollowUp).
// Archive / restore / delete act on THIS message only — never the rest of
// its conversation (here or in Gmail). Other messages in the thread are
// only ever suggested, never changed.
OL.archiveGmailMessage = async function(id, alsoInGmail = true, opts = {}) {
    const threadId = null; // message-level only
    const { error } = await db.from('gmail_messages').update({ archived: true }).eq('id', id);
    if (error) { alert('Failed to archive: ' + error.message); return; }

    if (alsoInGmail) {
        // Best-effort: the in-app archive stands either way, but a refusal is shown, because it means
        // the email is archived here and still in the Gmail inbox.
        const authHeaders = await OL.getAuthHeaders();
        fetch("https://kexnnpwjerrnsmifauuo.supabase.co/functions/v1/archive-gmail-message", {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders },
            body: JSON.stringify({ id, threadId })
        }).then(res => OL.handleGmailActionResponse(res, 'Archived'))
          .catch(err => console.warn('Could not archive in Gmail (still archived in-app):', err));
    }

    OL._dashboardEmailsCache = null;
    if (opts.skipClose) return;
    OL.closeModal();
    await OL.loadGmailFeed();
    OL._refreshAfterGmailAction();
};

OL.unarchiveGmailMessage = async function(id, alsoInGmail = true) {
    const threadId = null; // message-level only
    const { error } = await db.from('gmail_messages').update({ archived: false }).eq('id', id);
    if (error) { alert('Failed to move back to inbox: ' + error.message); return; }

    // 🚀 THE FIX: this used to be app-side only — archive removed the
    // message from real Gmail too, but unarchive never put it back,
    // so the two stopped being mirror images of each other. Matches
    // OL.archiveGmailMessage's pattern: best-effort, never blocks on it.
    if (alsoInGmail) {
        const authHeaders = await OL.getAuthHeaders();
        fetch("https://kexnnpwjerrnsmifauuo.supabase.co/functions/v1/unarchive-gmail-message", {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders },
            body: JSON.stringify({ id, threadId })
        }).then(res => OL.handleGmailActionResponse(res, 'Restored'))
          .catch(err => console.warn('Could not restore in Gmail (still restored in-app):', err));
    }

    OL.closeModal();
    await OL.loadGmailFeed();
    OL._refreshAfterGmailAction();
};

// -------------------------------------------------------------
// DELETE — bi-directional like archive: removes the row here AND
// best-effort moves the message to Trash in real Gmail. Confirms first
// since this isn't reversible from this app once the row is gone.
// -------------------------------------------------------------
OL.deleteGmailMessage = async function(id, alsoInGmail = true) {
    if (!confirm('Delete this email? This removes it from Operations Library' + (alsoInGmail ? ' and moves it to Trash in Gmail.' : '.') + ' Other messages in the conversation are not affected.')) return;
    const threadId = null; // message-level only

    if (alsoInGmail) {
        // The delete function only accepts signed-in Sphynx admins and team members. This is still
        // best-effort: the in-app delete goes ahead either way, but a refusal is shown, because it
        // means the email is gone here and still in Gmail.
        const authHeaders = await OL.getAuthHeaders();
        fetch("https://kexnnpwjerrnsmifauuo.supabase.co/functions/v1/delete-gmail-message", {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders },
            body: JSON.stringify({ id, threadId })
        }).then(res => OL.handleGmailActionResponse(res, 'Deleted'))
          .catch(err => console.warn('Could not delete in Gmail (still deleted in-app):', err));
    }

    const { error } = await db.from('gmail_messages').delete().eq('id', id);
    if (error) { alert('Failed to delete: ' + error.message); return; }

    OL.closeModal();
    await OL.loadGmailFeed();
    OL._refreshAfterGmailAction();
};

// -------------------------------------------------------------
// READ AN EMAIL — always pulled fresh from Supabase (works from the
// feed list or from a task's "Linked Emails" section either way).
// -------------------------------------------------------------
// Defensive cleanup for already-imported rows: extractPlainTextBody() in
// get-gmail-messages used to let raw HTML source through for single-part
// text/html messages (Calendly notifications and similar). That's fixed
// server-side for anything synced going forward, but emails already sitting
// in the table still have raw HTML baked into their stored body — this
// strips tags/entities client-side as a fallback so old rows render
// correctly too, without needing a full resync.
OL._looksLikeHtml = function(text) {
    return /<[a-z][\s\S]*>/i.test(text || '');
};

OL._stripHtmlForPreview = function(text) {
    if (!OL._looksLikeHtml(text)) return text || '';
    const tmp = document.createElement('div');
    tmp.innerHTML = text;
    return (tmp.textContent || tmp.innerText || '').replace(/\s+/g, ' ').trim();
};

// Formats email header strings (e.g., "From: John <john@example.com>")
// into contact pills or interactive '+' prompt buttons.
OL.formatEmailHeaderAddresses = function(headerVal, clientId) {
    if (!headerVal) return '';
    const emails = headerVal.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) || [];
    if (!emails.length) return esc(headerVal);
    return emails.map(e => OL.renderContactPillOrPrompt(e, { clientId })).join(' ');
};

// Wraps every <img src="..."> in a sent/received email's HTML with a
// checkbox-toggle lightbox (CSS-only, no JS — the rendering iframe is
// deliberately sandboxed without allow-scripts for untrusted external
// content). Click an image -> overlay shows it larger; click the overlay
// -> closes it.
//
// Uses a hidden checkbox + <label>, NOT an <a>. Many real emails already
// wrap their images in the sender's own <a href="...">, and nesting a
// second <a> inside an open one is invalid HTML — browsers don't just
// harmlessly auto-close it; the parser's adoption-agency algorithm can
// reorder or orphan the inner content, especially inside table-heavy
// signature blocks. That reliably breaks the lightbox for every image in
// an email that happens to be link-wrapped, which matches "every image
// does the same thing (black box)". <label> and <input> aren't subject to
// that reparenting, so they nest safely inside an existing <a>.
//
// The overlay's <img> is still built fresh with only a src attribute (see
// the CSS specificity note below the wrap function).
OL._wrapEmailImagesForLightbox = function(html) {
    let i = 0;
    return html.replace(/<img\b[^>]*\ssrc=(["'])(.*?)\1[^>]*>/gi, (fullMatch, quote, src) => {
        const id = `ols-cb-${i++}`;
        const safeSrc = src.replace(/"/g, '&quot;');
        return (
            `<label class="ol-img-zoom">` +
                `<input type="checkbox" class="ol-lightbox-toggle" id="${id}">` +
                fullMatch +
            `</label>` +
            `<div class="ol-lightbox">` +
                `<label class="ol-lightbox-backdrop" for="${id}">` +
                    `<img class="ol-lightbox-img" src="${safeSrc}">` +
                `</label>` +
            `</div>`
        );
    });
};

// ---- latest-message-only view: split a message into what's new vs. the quoted earlier emails it carries ----
// Replies quote the whole chain below the new text. The read modal shows only the new part (with a toggle for the
// rest); the earlier emails themselves are listed separately under "Earlier in this thread".
OL._splitQuotedText = function(text) {
    const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
    let cut = -1;
    for (let i = 0; i < lines.length; i++) {
        const l = lines[i], next = (lines[i + 1] || '').trim();
        const isWrote = /^\s*On\s.{5,300}$/i.test(l) && (/wrote:\s*$/i.test(l) || /^wrote:\s*$/i.test(next));
        const isOrig = /^\s*-{2,}\s*(Original|Forwarded) Message\s*-{2,}/i.test(l) || /^\s*_{8,}\s*$/.test(l);
        const isFromBlock = /^\s*From:\s.+/i.test(l) && lines.slice(i + 1, i + 5).some((x) => /^\s*(Sent|Date):\s/i.test(x));
        if (isWrote || isOrig || isFromBlock || /^\s*>/.test(l)) { cut = i; break; }
    }
    if (cut <= 0) return { latest: lines.join('\n').trim(), quoted: '', hasQuoted: false };
    const latest = lines.slice(0, cut).join('\n').trim();
    if (!latest) return { latest: lines.join('\n').trim(), quoted: '', hasQuoted: false };
    return { latest, quoted: lines.slice(cut).join('\n'), hasQuoted: true };
};

OL._splitQuotedHtml = function(html) {
    try {
        const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
        let removed = 0;
        // Outlook: everything from the reply marker on is the quoted chain.
        doc.querySelectorAll('#appendonsend, #divRplyFwdMsg').forEach((el) => {
            if (!el.isConnected) return;
            const prev = el.previousElementSibling;
            while (el.nextSibling) { el.nextSibling.remove(); }
            if (prev && prev.tagName === 'HR') prev.remove();
            el.remove(); removed++;
        });
        doc.querySelectorAll('.gmail_quote, .gmail_extra, blockquote[type="cite"], .yahoo_quoted, #mail-app-auto-quote, .moz-cite-prefix').forEach((el) => {
            if (!el.isConnected) return;
            el.remove(); removed++;
        });
        if (!removed || !(doc.body?.textContent || '').trim()) return { latest: html, hasQuoted: false };
        return { latest: doc.documentElement.outerHTML, hasQuoted: true };
    } catch (e) { return { latest: html, hasQuoted: false }; }
};

// Plain-text version of just the new part of a message (or all of it when showQuoted).
OL._latestPlain = function(m, showQuoted) {
    const body = m.body || '';
    if (OL._looksLikeHtml(body)) {
        const sp = OL._splitQuotedHtml(body);
        return { text: OL._stripHtmlForPreview(showQuoted ? body : sp.latest) || m.snippet || '', hasQuoted: sp.hasQuoted };
    }
    const sp = OL._splitQuotedText(body);
    return { text: (showQuoted ? String(body).trim() : sp.latest) || m.snippet || '', hasQuoted: sp.hasQuoted };
};

OL.toggleGmailQuoted = function() {
    OL._gmailShowQuoted = !OL._gmailShowQuoted;
    const id = OL._gmailLinkState?.emailId;
    if (id) OL.openGmailMessageModal(id, { keepQuoted: true });
};

// The stylesheet every email preview frame gets: images scale, a readable body font, and the click-to-enlarge
// lightbox (pure CSS, because the frame is sandboxed without scripts).
OL._emailFrameStyle = function() {
    return `
                <style>
                    img { max-width: 100% !important; height: auto !important; display: inline-block; }
                    body { font-family: system-ui, -apple-system, sans-serif; padding: 12px; color: #334155; }

                    .ol-img-zoom { display: inline-block; cursor: zoom-in; }
                    .ol-lightbox-toggle {
                        position: absolute;
                        opacity: 0;
                        width: 0;
                        height: 0;
                        pointer-events: none;
                    }
                    .ol-lightbox {
                        display: none;
                        position: fixed;
                        inset: 0;
                        background: rgba(0,0,0,0.85);
                        z-index: 99999;
                        padding: 24px;
                        box-sizing: border-box;
                    }
                    /* The checkbox lives inside the trigger <label>, not as
                       a sibling of .ol-lightbox, so a plain ~/+ sibling
                       selector on the checkbox itself can't reach it.
                       :has() on the preceding label (which does sit
                       immediately before .ol-lightbox) reaches into it to
                       check the box's state instead. */
                    .ol-img-zoom:has(.ol-lightbox-toggle:checked) + .ol-lightbox {
                        display: flex;
                    }
                    .ol-lightbox-backdrop {
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        width: 100%;
                        height: 100%;
                        cursor: zoom-out;
                    }
                    /* Class selector (not bare "img") + !important on every
                       sizing property so nothing the source email's own
                       stylesheet declares — including its own !important
                       rules loaded after ours — can still shrink this back
                       down. See _wrapEmailImagesForLightbox above for why
                       this <img> is built fresh with no other attributes. */
                    img.ol-lightbox-img {
                        display: block !important;
                        width: auto !important;
                        height: auto !important;
                        max-width: 100% !important;
                        max-height: 100% !important;
                        box-shadow: 0 4px 24px rgba(0,0,0,0.5);
                    }
                </style>
            `;
};

// Sizes a preview frame to its content, up to a maximum height (then it scrolls inside). Re-measures as images load,
// because an email's height changes when its pictures arrive.
OL._fitEmailFrame = function(frame, maxVh = 70) {
    if (!frame) return;
    const fit = () => {
        try {
            const doc = frame.contentDocument; if (!doc || !doc.documentElement) return;
            const h = Math.max(doc.documentElement.scrollHeight, doc.body ? doc.body.scrollHeight : 0);
            frame.style.height = Math.max(80, Math.min(h + 2, Math.round(window.innerHeight * maxVh / 100))) + 'px';
        } catch (e) { /* cross-origin or removed: leave as is */ }
    };
    fit();
    try { frame.contentDocument.querySelectorAll('img').forEach((img) => { if (!img.complete) { img.addEventListener('load', fit, { once: true }); img.addEventListener('error', fit, { once: true }); } }); } catch (e) { /* ignore */ }
    [150, 600, 1500].forEach((ms) => setTimeout(fit, ms));
};

// Same preparation for every email shown in a frame (the open one and earlier ones in the thread).
OL._prepareEmailHtml = function(html) {
    let out = String(html || '').replace(/src=["']\/\//gi, 'src="https://');
    return OL._emailFrameStyle() + OL._wrapEmailImagesForLightbox(out);
};

// ---- the thread list: every email in the conversation, each with ITS OWN links ----
// Linking one email never changes another; a row's chips show what that email alone is linked to. Clicking a row
// opens that email in the same window.
const LINK_ICON = { project: 'folder', task: 'check-square', request: 'clipboard-list', resource: 'database', event: 'calendar' };
const shortLabel = (t, n = 38) => (String(t).length > n ? String(t).slice(0, n - 1) + '…' : String(t));

OL._gmailLinkLabels = function(msg) {
    const out = [];
    const client = msg.linked_client_id ? state.clients?.[msg.linked_client_id] : null;
    const pd = client?.projectData;
    if (msg.linked_client_id) out.push({ type: 'project', label: `Project: ${client?.meta?.name || 'Project'}` });
    if (msg.linked_request_id) {
        const r = (pd?.scopingSheets || []).flatMap((sh) => sh?.lineItems || []).find((i) => String(i?.id) === String(msg.linked_request_id));
        out.push({ type: 'request', label: r ? `Request: ${r.name || r.title}` : 'Request' });
    }
    if (msg.linked_task_id) {
        const t = (pd?.clientTasks || []).find((x) => String(x.id) === String(msg.linked_task_id));
        out.push({ type: 'task', label: t ? `Task: ${t.title || t.name}` : 'Task' });
    }
    if (msg.linked_resource_id) {
        const r = (pd?.localResources || []).find((x) => String(x.id) === String(msg.linked_resource_id));
        out.push({ type: 'resource', label: r ? `Resource: ${r.name}` : 'Resource' });
    }
    if (msg.linked_event_id) out.push({ type: 'event', label: 'Event' });
    return out;
};

OL.toggleGmailThread = function() {
    if (!OL._gmailThread) return;
    OL._gmailThread.expanded = !OL._gmailThread.expanded;
    OL.renderGmailThread();
};

OL.renderGmailThread = function() {
    const box = document.getElementById('gmail-thread-box');
    const th = OL._gmailThread;
    if (!box) return;
    if (!th || th.msgs.length < 2) { box.innerHTML = ''; return; }
    const msgs = th.msgs.slice().sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));   // newest first
    const header = `
        <div style="display:flex; align-items:center; gap:10px; margin-bottom:${th.expanded ? '10px' : '0'};">
            <button type="button" style="background:transparent; border:0; color:inherit; font:inherit; font-weight:600; display:inline-flex; align-items:center; gap:8px; padding:0; cursor:pointer;" onclick="OL.toggleGmailThread()" aria-expanded="${th.expanded ? 'true' : 'false'}">
                <i data-lucide="${th.expanded ? 'chevron-down' : 'chevron-right'}" style="width:14px;height:14px;"></i> Thread <span class="pill tiny soft">${msgs.length} emails</span>
            </button>
            <span style="flex:1;"></span>
            ${th.expanded ? '<span class="tiny muted">Each email keeps its own links. Linking one never changes the others.</span>' : ''}
        </div>`;
    const rows = !th.expanded ? '' : `<div style="display:grid; gap:8px;">${msgs.map((o) => {
        const current = String(o.id) === String(th.currentId);
        const who = OL._parseSenderHeader(o.sender)?.name || o.sender || 'Unknown';
        const labels = OL._gmailLinkLabels(o);
        const parts = Array.isArray(o.piece_links) ? o.piece_links.filter((l) => l.kind !== 'attachment').length : 0;
        const chips = labels.map((l) => `<span class="pill tiny soft" title="${esc(l.label)}"><i data-lucide="${LINK_ICON[l.type]}" style="width:10px;height:10px;vertical-align:sub;"></i> ${esc(shortLabel(l.label))}</span>`).join('')
            + (parts ? `<span class="pill tiny soft" style="color:#2dd4bf; border-color:rgba(45,212,191,0.45);"><i data-lucide="link" style="width:10px;height:10px;vertical-align:sub;"></i> ${parts} part${parts === 1 ? '' : 's'} linked</span>` : '');
        const snippet = decodeEntities(o.snippet || '');
        return `
            <div ${current ? '' : `role="button" tabindex="0" onclick="OL.openGmailMessageModal('${esc(String(o.id))}', { keepQuoted: true })" onkeydown="if(event.key==='Enter') OL.openGmailMessageModal('${esc(String(o.id))}', { keepQuoted: true })"`}
                 style="padding:9px 14px; border:1px solid ${current ? 'var(--accent)' : 'var(--line)'}; border-radius:8px; ${current ? 'background:rgba(var(--accent-rgb),0.10);' : 'cursor:pointer;'} min-width:0;">
                <div style="display:flex; align-items:center; gap:14px; min-width:0;">
                    <span class="tiny bold" style="width:150px; flex-shrink:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(who)}</span>
                    <span class="tiny muted" style="width:150px; flex-shrink:0;">${o.date ? esc(new Date(o.date).toLocaleString()) : 'Unknown date'}</span>
                    <span class="tiny muted" style="flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(snippet)}</span>
                    ${current ? '<span class="pill tiny soft" style="color:var(--accent); border-color:var(--accent);">Viewing</span>' : ''}
                </div>
                <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap; padding-left:164px; margin-top:6px;">
                    ${chips || '<span class="tiny muted" style="font-style:italic;">Not linked yet</span>'}
                    ${!chips && !current ? `<button class="btn tiny soft" onclick="event.stopPropagation(); OL.openGmailThreadMessageLink('${esc(String(o.id))}')">+ Link</button>` : ''}
                </div>
            </div>`;
    }).join('')}</div>`;
    box.innerHTML = `<div style="margin-top:18px; border-top:1px solid var(--line); padding-top:12px;">${header}${rows}</div>`;
    if (window.lucide) lucide.createIcons();
};

// "+ Link" on a thread row: open that email and go straight to its link editor.
OL.openGmailThreadMessageLink = async function(id) {
    await OL.openGmailMessageModal(id, { keepQuoted: true });
    OL.openGmailLinkModal();
};

OL.openGmailMessageModal = async function(id, opts = {}) {
    if (!opts.keepQuoted) OL._gmailShowQuoted = false;
    const { data: m, error } = await db.from('gmail_messages').select('*').eq('id', id).single();
    if (error || !m) { alert('Could not load that email.'); return; }

    // Opens exactly the email that was clicked. An earlier email in a thread is shown as itself, with a banner
    // pointing to the newest reply; the thread list below switches between them. Every email keeps its own links.
    let threadMsgs = [];
    if (m.thread_id) {
        const { data: tm } = await db.from('gmail_messages')
            .select('id, sender, date, snippet, linked_client_id, linked_resource_id, linked_task_id, linked_request_id, linked_event_id, piece_links')
            .eq('thread_id', m.thread_id).order('date', { ascending: true }).limit(50);
        threadMsgs = tm || [];
    }
    const idx = threadMsgs.findIndex((x) => String(x.id) === String(id));
    const total = Math.max(threadMsgs.length, 1);
    const position = idx >= 0 ? idx + 1 : total;
    const newest = threadMsgs[threadMsgs.length - 1];
    const isLatest = !newest || String(newest.id) === String(id);
    const newerCount = idx >= 0 ? threadMsgs.length - idx - 1 : 0;
    OL._gmailThread = { msgs: threadMsgs, currentId: id, newestId: newest ? newest.id : id, expanded: !isLatest };
    // The newest reply is often not linked to a client yet while another message in the thread is, so the
    // open-tasks menu falls back to the client the thread is linked to.
    const askClientId = m.linked_client_id || ([...threadMsgs].reverse().find((x) => x.linked_client_id) || {}).linked_client_id || '';
    const showQuoted = !!OL._gmailShowQuoted;
    const latestHtml = m.body_html ? (showQuoted ? { latest: m.body_html, hasQuoted: OL._splitQuotedHtml(m.body_html).hasQuoted } : OL._splitQuotedHtml(m.body_html)) : null;
    const latestPlain = OL._latestPlain(m, showQuoted);
    const hasQuoted = latestHtml ? latestHtml.hasQuoted : latestPlain.hasQuoted;

    OL._gmailLinkState = {
        emailId: id,
        sender: m.sender || '', // kept for the "add sender as team member?" prompt on manual link
        emailBody: OL._latestPlain(m, false).text, // latest email only; copied into a new task's description below, still editable there
        clientId: m.linked_client_id || '',
        resourceId: m.linked_resource_id || '',
        taskId: m.linked_task_id || '',
        requestId: m.linked_request_id || '',
        eventId: m.linked_event_id || '',
        threadId: m.thread_id || '',
        hadLinks: !!(m.linked_client_id || m.linked_resource_id || m.linked_task_id || m.linked_request_id || m.linked_event_id),
        clientQuery: '',
        resourceQuery: '',
        taskQuery: '',
        eventQuery: '',
        // 🚀 THE FIX: lists stay hidden until the search box is actually
        // focused, instead of dumping every project/resource/task/event on
        // screen immediately.
        clientFocused: false,
        resourceFocused: false,
        taskFocused: false,
        eventFocused: false,
        eventResults: [], // live Supabase search results (events aren't all loaded client-side)
        creatingTask: false,
        newTaskTitle: ''
    };

    const html = `
        <div class="modal-head">
            <div class="modal-title-text"><i data-lucide="mail" style="width:18px;height:18px;vertical-align:sub;margin-right:8px;"></i>${esc(m.subject || 'No Subject')}</div>
            ${total > 1 ? `<span class="pill tiny soft">Email ${position} of ${total}</span>` : ''}
            <button class="btn small soft" onclick="OL.closeModal()">Close</button>
        </div>
        <!-- Link bar: what THIS email is linked to (click a pill to change it) and the client's open tasks. -->
        <div class="gmail-link-bar" style="position:relative; display:flex; align-items:center; gap:10px; padding:10px 24px; border-bottom:1px solid var(--line); background:rgba(255,255,255,0.02);">
            <div id="gmail-link-summary" style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; min-width:0;"></div>
            <span style="flex:1;"></span>
            <div id="gmail-open-client-asks"></div>
        </div>
        <div class="modal-body" style="max-width:1000px; width:100%;">
            <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:24px; margin-bottom:14px;">
            <div class="tiny muted" style="display:flex; flex-direction:column; gap:6px; min-width:0;">
                <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                    <strong>From:</strong> ${OL.formatEmailHeaderAddresses(m.sender, m.linked_client_id)}
                </div>
                ${m.recipient_to ? `<div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;"><strong>To:</strong> ${OL.formatEmailHeaderAddresses(m.recipient_to, m.linked_client_id)}</div>` : ''}
                ${m.recipient_cc ? `<div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;"><strong>Cc:</strong> ${OL.formatEmailHeaderAddresses(m.recipient_cc, m.linked_client_id)}</div>` : ''}
                ${m.recipient_bcc ? `<div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;"><strong>Bcc:</strong> ${OL.formatEmailHeaderAddresses(m.recipient_bcc, m.linked_client_id)}</div>` : ''}
                <div style="display:flex; align-items:center; gap:10px;"><span><strong>Date:</strong> ${m.date ? new Date(m.date).toLocaleString() : 'Unknown'}</span>${total > 1 ? (isLatest ? '<span class="pill tiny soft" style="color:#2dd4bf; border-color:rgba(45,212,191,0.45);">Latest in thread</span>' : '<span class="pill tiny soft" style="color:#f59e0b; border-color:rgba(245,158,11,0.45);">Earlier email</span>') : ''}</div>
            </div>
            <div style="display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end;">
                ${m.archived ? `
                    <button class="btn tiny soft" onclick="OL.unarchiveGmailMessage('${m.id}')">Move Back to Inbox</button>
                ` : `
                    <button class="btn tiny soft" onclick="OL.archiveGmailMessage('${m.id}')">Archive</button>
                `}
                <button class="btn tiny primary" onclick="OL.openReplyToGmailMessage('${m.id}')"><i data-lucide="reply" style="width:11px;height:11px;"></i> Reply</button>
                ${(() => {
                    // Only worth offering "Reply All" when there's actually
                    // someone else besides the sender to CC — otherwise it's
                    // identical to plain Reply and just clutters the row.
                    const myEmail = (state.master?.communications?.gmail?.email || '').toLowerCase();
                    const senderEmail = (OL._parseSenderHeader(m.sender)?.email || '').toLowerCase();
                    const extractEmails = (header) => (header || '').match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) || [];
                    const otherRecipients = [...extractEmails(m.recipient_to), ...extractEmails(m.recipient_cc)]
                        .map(e => e.toLowerCase())
                        .filter((e, i, arr) => arr.indexOf(e) === i)
                        .filter(e => e !== senderEmail && e !== myEmail);
                    return otherRecipients.length > 0
                        ? `<button class="btn tiny primary" onclick="OL.openReplyToGmailMessage('${m.id}', true)"><i data-lucide="reply-all" style="width:11px;height:11px;"></i> Reply All</button>`
                        : '';
                })()}
                <button class="btn tiny soft" style="color:#ef4444;" onclick="OL.deleteGmailMessage('${m.id}')"><i data-lucide="trash-2" style="width:11px;height:11px;"></i> Delete</button>
            </div>
            </div>
            <div id="gmail-thread-link-suggestion"></div>
            ${newerCount ? `
                <div style="display:flex; align-items:center; gap:12px; padding:9px 14px; margin-bottom:12px; background:rgba(245,158,11,0.08); border:1px solid rgba(245,158,11,0.4); border-radius:8px;">
                    <i data-lucide="messages-square" style="width:14px;height:14px;color:#f59e0b;flex-shrink:0;"></i>
                    <span class="tiny" style="flex:1;">You are viewing an <strong>earlier email</strong> from ${m.date ? esc(new Date(m.date).toLocaleString()) : 'an earlier date'}. There ${newerCount === 1 ? 'is <strong>1 newer reply</strong>' : `are <strong>${newerCount} newer replies</strong>`} in this thread.</span>
                    <button class="btn tiny soft" onclick="OL.openGmailMessageModal('${esc(String(OL._gmailThread.newestId))}')">Open latest reply <i data-lucide="arrow-right" style="width:11px;height:11px;"></i></button>
                </div>` : ''}
            <div style="display:flex; align-items:center; justify-content:space-between; gap:16px; flex-wrap:wrap; margin-bottom:12px;">
                <div id="gmail-attachments" style="min-width:0;"></div>
                ${hasQuoted ? `<button class="btn tiny soft" style="flex-shrink:0;" onclick="OL.toggleGmailQuoted()"><i data-lucide="messages-square" style="width:11px;height:11px;"></i> ${showQuoted ? 'Hide quoted earlier messages' : 'Show quoted earlier messages'}</button>` : ''}
            </div>

            <div style="display:block; min-width:0;">
                ${m.body_html ? `
                    <!-- Rendered in a fully sandboxed iframe (sandbox="" — no
                         scripts, no forms, no same-origin access) so the
                         email's own HTML/CSS displays with real formatting
                         without ever being able to run anything, regardless
                         of what an external sender's email contains. Content
                         is set via .srcdoc right after the modal opens (see
                         below) rather than inlined here, since embedding
                         arbitrary email HTML into this template string would
                         be extremely fragile to escape correctly. -->
                    <iframe id="gmail-body-html-frame" sandbox="allow-same-origin allow-popups" style="width:100%; height:120px; max-height:70vh; border:1px solid var(--line); border-radius:6px; background:#fff;"></iframe>
                ` : `
                    <div id="gmail-body-plain" style="position:relative; white-space:pre-wrap; line-height:1.6; font-size:13px; max-height:70vh; overflow:auto; overflow-wrap:anywhere; border-top:1px solid var(--line); padding-top:14px; min-width:0;">
                        ${esc(latestPlain.text || 'No preview available for this message.')}
                    </div>
                `}
            </div>
            <div id="gmail-piece-links"></div>
            <div id="gmail-thread-box"></div>
        </div>
    `;
    OL._gmailLinkSelectedEvent = null; // resolved just below if this email already has a linked event

    openModal(html);
    OL.renderGmailLinkSummary();
    OL.renderGmailThread();
    OL.renderGmailOpenClientAsks({ ...m, linked_client_id: askClientId });
    OL.renderGmailPieceLinks(m);
    OL.renderGmailAttachments(m);
    OL.attachExcerptSelectionHandler(m.id);
    OL.loadThreadLinkSuggestion(m);
    // No auto-extracted suggestions: linking is done by highlighting text in the email (latest message only).

    if (m.body_html) {
        const frame = document.getElementById('gmail-body-html-frame');
        if (frame) {
            // Ensure image URLs with leading // get explicit https:
            let processedHtml = latestHtml.latest.replace(/src=["']\/\//gi, 'src="https://');

            // Click-to-expand images: the iframe is intentionally sandboxed
            // without allow-scripts (this is untrusted external HTML), so a
            // JS lightbox isn't an option. Instead wrap each <img> in an
            // anchor to a full-size overlay shown via the CSS :target
            // trick — no scripting needed, works purely off anchor
            // fragment navigation, which sandboxed iframes still allow.
            processedHtml = OL._wrapEmailImagesForLightbox(processedHtml);

            // Add a base style tag so images scale properly and don't overflow
            const styleHeader = OL._emailFrameStyle();
    
            frame.srcdoc = styleHeader + processedHtml;
            // allow-same-origin (already on this sandbox) lets our own
            // parent-page script reach into the iframe's DOM once it loads —
            // this is the parent's trusted code, not anything from the
            // email's own HTML (which still can't execute, no allow-scripts).
            // That's what makes excerpt selection possible here at all.
            frame.addEventListener('load', () => { OL._fitEmailFrame(frame, 70); OL.attachExcerptSelectionHandler(id, frame); }, { once: true });
        }
    }

    if (m.linked_event_id) {
        const { data: evt } = await db.from('calendar_events').select('id, title, start, description').eq('id', m.linked_event_id).maybeSingle();
        if (evt && OL._gmailLinkState?.emailId === id) {
            OL._gmailLinkSelectedEvent = evt;
            OL.renderGmailLinkStep();
        }
    }
};
window.OL.openGmailMessageModal = OL.openGmailMessageModal;

// -------------------------------------------------------------
// EMAIL PIECE-LINKING: open client asks first, excerpt links
// -------------------------------------------------------------
// A second linking mechanism alongside the whole-email link fields above
// (linked_task_id etc.) — lets ONE email answer several different things at
// once. Stored in gmail_messages.piece_links (piece_links.sql), an array of
// { id, kind: 'excerpt', text, note, targetType, targetId, targetLabel,
// createdAt }, or kind 'attachment' with the stored file's path. Attachments are synced by get-gmail-messages
// (collectAttachmentParts / fetchAndStoreAttachments, kept in the private gmail-attachments storage bucket, listed
// on gmail_messages.attachments) and shown on the email with a "Link this attachment" button — see
// gmail_attachments.sql for the column and bucket they need.
//
// This never auto-closes a task — linking is the only action here. Closing
// the task it answered is always a separate, deliberate step from the task
// itself (see "jump to task" below).

// The client's open client-facing asks, shown above the general link
// picker since most replies are answering something already waited on —
// picking one links the WHOLE email to that task (reuses the existing
// single-task link field; it's the fast path for the common case of "this
// email is entirely about one open ask"). For an email answering more than
// one thing at once, or answering only part of its body, use excerpt
// linking below instead.
OL.renderGmailOpenClientAsks = async function(m) {
    const container = document.getElementById('gmail-open-client-asks');
    if (!container) return;
    const clientId = m.linked_client_id;
    if (!clientId) { container.innerHTML = ''; return; }
    // The client's tasks live in its project data, which isn't loaded until the client is opened — an email
    // opened from the inbox can find it still metadata-only, so load it first.
    const loaded = state.clients?.[clientId];
    if ((!loaded || loaded._metaOnly || !loaded.projectData) && typeof OL.loadFullClient === 'function') {
        try { await OL.loadFullClient(clientId); } catch (e) { console.warn('Could not load client for open asks:', e); }
    }
    if (!document.getElementById('gmail-open-client-asks')) return;   // modal was closed meanwhile
    const client = state.clients?.[clientId];
    // Every open task on the project, grouped by who it's waiting on: the client, a 3rd party, or Sphynx.
    const closed = (typeof OL.getSystemStatuses === 'function' ? OL.getSystemStatuses() : []).filter((s) => s.isClosed).map((s) => s.name).concat('Done');
    const groupOf = (t) => {
        if (typeof OL.taskIsClientOwned === 'function' && OL.taskIsClientOwned({ ...t, clientId }, client)) return 'client';
        const key = typeof OL.classifyTask === 'function' ? OL.classifyTask({ assignee: t.assignee, clientId }, client)?.key : 'sphynx';
        return key === 'client' ? 'client' : (key === 'thirdparty' || key === 'partner') ? 'thirdparty' : 'sphynx';
    };
    const open = (client?.projectData?.clientTasks || [])
        .filter((t) => t && !t.consolidatedFollowUp && t.askKind !== 'follow_up' && !closed.includes(t.status))
        .sort((a, b) => String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999')));
    if (!open.length) { container.innerHTML = ''; return; }
    const GROUPS = [
        { key: 'client', label: 'Waiting on the client' },
        { key: 'thirdparty', label: 'Waiting on a 3rd party' },
        { key: 'sphynx', label: 'Sphynx tasks' },
    ];
    const buckets = { client: [], thirdparty: [], sphynx: [] };
    open.forEach((t) => buckets[groupOf(t)].push(t));

    const row = (t) => {
        const linked = String(m.linked_task_id) === String(t.id);
        return `
            <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; padding:6px 8px; border:1px solid var(--line); border-radius:6px; ${linked ? 'border-color:var(--accent); background:rgba(var(--accent-rgb),0.08);' : ''}">
                <span class="tiny" style="min-width:0; overflow-wrap:anywhere;">${esc(t.title || t.name)}</span>
                ${linked
                    ? `<span class="tiny" style="color:var(--accent); flex-shrink:0;">Linked</span>`
                    : `<button class="btn tiny soft" style="flex-shrink:0;" onclick="OL.setGmailLinkTask('${esc(String(t.id))}', '${esc(clientId)}'); OL.saveGmailLink({ skipArchive: true }).then(() => OL.openGmailMessageModal('${esc(String(m.id))}'));">Addresses this</button>`}
            </div>`;
    };

    const waitingOnClient = buckets.client.length;
    // A button in the link bar that opens a menu, instead of a panel that takes up space on the page. The menu hangs
    // from the link bar (the container is deliberately not positioned, so the bar is what it anchors to).
    container.innerHTML = `
        <button type="button" id="gmail-open-tasks-btn" class="btn tiny soft" style="display:inline-flex; align-items:center; gap:8px;" aria-expanded="false" onclick="OL.toggleGmailOpenTasks()">
            <i data-lucide="list-checks" style="width:13px;height:13px;color:var(--accent);"></i> Open tasks <span class="pill tiny soft">${open.length}</span>
            ${waitingOnClient ? `<span style="display:inline-flex; align-items:center; gap:5px; color:#f59e0b;"><span style="width:7px; height:7px; border-radius:50%; background:#f59e0b; display:inline-block;"></span>${waitingOnClient} waiting on client</span>` : ''}
            <i data-lucide="chevron-down" style="width:13px;height:13px;opacity:0.7;"></i>
        </button>
        <div id="gmail-open-tasks-panel" style="display:none; position:absolute; right:24px; top:calc(100% + 6px); width:min(580px, 92vw); max-height:60vh; overflow:auto; z-index:20; padding:14px; background:var(--bg-card, #1c2839); border:1px solid var(--line); border-radius:12px; box-shadow:0 18px 40px rgba(0,0,0,0.55);">
            <div style="display:flex; align-items:center; gap:10px; margin-bottom:12px;">
                <span class="small bold">Open tasks for this client</span>
                <span style="flex:1;"></span>
                <button type="button" class="btn tiny ghost" onclick="document.querySelectorAll('#gmail-open-tasks-panel details').forEach((d) => { d.open = false; })"><i data-lucide="chevrons-up" style="width:11px;height:11px;"></i> Collapse all</button>
            </div>
            <div style="display:grid; gap:12px;">
                ${GROUPS.filter((g) => buckets[g.key].length).map((g) => `
                    <details open>
                        <summary class="tiny bold muted" style="cursor:pointer; margin-bottom:6px;">${g.label} (${buckets[g.key].length})</summary>
                        <div style="display:grid; gap:6px; margin-top:6px;">${buckets[g.key].map(row).join('')}</div>
                    </details>`).join('')}
            </div>
            <div class="tiny muted" style="border-top:1px solid var(--line); margin-top:12px; padding-top:10px;">Addressing a task links this email to it. Nothing is closed or changed on the task.</div>
        </div>
    `;
    if (window.lucide) lucide.createIcons();
    // The thread list's chips can now name tasks and requests, since the project's data is loaded.
    if (typeof OL.renderGmailThread === 'function') OL.renderGmailThread();
};

OL.toggleGmailOpenTasks = function() {
    const panel = document.getElementById('gmail-open-tasks-panel');
    const btn = document.getElementById('gmail-open-tasks-btn');
    if (!panel) return;
    const open = panel.style.display === 'none';
    panel.style.display = open ? 'block' : 'none';
    if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (!open) return;
    // Click anywhere else closes it.
    const away = (e) => {
        const p = document.getElementById('gmail-open-tasks-panel');
        if (!p) { document.removeEventListener('mousedown', away); return; }
        if (p.contains(e.target) || (btn && btn.contains(e.target))) return;
        p.style.display = 'none';
        document.getElementById('gmail-open-tasks-btn')?.setAttribute('aria-expanded', 'false');
        document.removeEventListener('mousedown', away);
    };
    document.addEventListener('mousedown', away);
};

// ---- excerpt selection: highlight text -> a small floating "Link this" button ----
// Two bodies to support: the plain-text render (in the parent document) and
// the HTML render (in the sandboxed-but-same-origin iframe, wired up once
// its srcdoc content loads — see the frame.addEventListener('load', ...)
// call above). `frame` is omitted for the plain-text case.
OL.attachExcerptSelectionHandler = function(messageId, frame) {
    const doc = frame ? frame.contentDocument : document;
    const win = frame ? frame.contentWindow : window;
    const body = frame ? doc.body : document.getElementById('gmail-body-plain');
    if (!doc || !win || !body) return;

    doc.getElementById('gmail-excerpt-link-btn')?.remove();

    body.addEventListener('mouseup', (e) => {
        // A click on the "Link this" button itself also bubbles a mouseup
        // up to body — without this guard, that re-runs the selection
        // logic below, which deletes the button and appends a fresh one in
        // the same spot right as the button's own click is about to fire,
        // so the click lands on a button that's already been swapped out.
        if (e.target && e.target.id === 'gmail-excerpt-link-btn') return;

        const sel = win.getSelection();
        const text = (sel?.toString() || '').trim();
        doc.getElementById('gmail-excerpt-link-btn')?.remove();
        if (!text || sel.rangeCount === 0) return;

        const range = sel.getRangeAt(0);
        if (!body.contains(range.commonAncestorContainer)) return;   // selection made outside this body
        const rect = range.getBoundingClientRect();
        // In the iframe case this button is appended into the iframe's own
        // document, so its coordinates are relative to that document —
        // scrollX/Y there, not the parent page's.
        const scrollX = frame ? (win.scrollX || doc.documentElement.scrollLeft || 0) : 0;
        const scrollY = frame ? (win.scrollY || doc.documentElement.scrollTop || 0) : (body.scrollTop || 0);
        const bodyRect = frame ? { top: 0, left: 0 } : body.getBoundingClientRect();

        // Placing the button 32px above the selection, unconditionally, is what was cutting it off: with
        // nothing above (selection near the top of the visible area) that put it outside the scrollable area
        // entirely, and near the bottom there wasn't always room for it below either. Now it only goes above
        // the selection when there's actually room; otherwise it drops below the selection instead, and if
        // there's no room there either it's clamped to the bottom of the visible area.
        const BTN_H = 28;
        const viewportTop = frame ? 0 : bodyRect.top;
        const viewportBottom = frame ? (win.innerHeight || 0) : bodyRect.bottom;
        let topPx;
        if ((rect.top - viewportTop) >= (BTN_H + 6)) {
            topPx = rect.top - bodyRect.top + scrollY - BTN_H - 4;               // room above: put it there, as before
        } else if ((viewportBottom - rect.bottom) >= (BTN_H + 6)) {
            topPx = rect.bottom - bodyRect.top + scrollY + 6;                    // no room above: put it below instead
        } else {
            topPx = Math.max(0, viewportBottom - bodyRect.top + scrollY - BTN_H - 4);   // no room either way: clamp to the bottom edge
        }

        const btn = doc.createElement('button');
        btn.id = 'gmail-excerpt-link-btn';
        btn.textContent = 'Link this';
        btn.style.cssText = `position:absolute; z-index:2147483647; top:${topPx}px; left:${Math.max(0, rect.left - bodyRect.left + scrollX)}px; padding:4px 10px; font-size:11px; font-weight:600; border-radius:6px; border:none; cursor:pointer; background:var(--accent, #64c6a2); color:#fff;`;
        btn.onmousedown = (e) => e.preventDefault();   // don't clear the selection before onclick fires
        // This closure is defined here, in the parent script, even though
        // the button element itself gets appended into the iframe's
        // document — a function's scope follows where it was DEFINED, not
        // which document its DOM node lives in, so plain `OL` below still
        // correctly refers to the parent page's OL.
        btn.onclick = () => OL.openExcerptLinkPicker(messageId, text);
        (doc.body || doc.documentElement).appendChild(btn);
    });
};

// ---- the picker for one excerpt (or, once attachments are synced, one attachment) ----
OL.openExcerptLinkPicker = function(messageId, excerptText, kind = 'excerpt', attachmentPath = null) {
    OL._excerptLinkState = { messageId, excerptText, kind, attachmentPath, targetType: '', targetId: '', targetLabel: '', note: '', query: '', creatingNewTask: false, newTaskTitle: '', creatingNewRequest: false, newRequestTitle: '', newRequestType: 'build' };
    OL.renderExcerptLinkPicker();
};

OL.renderExcerptLinkPicker = function() {
    const st = OL._excerptLinkState;
    if (!st) return;
    const m = OL._gmailLinkState;   // the open email's link state carries clientId already, if set
    const clientId = m?.clientId || '';
    const client = clientId ? state.clients?.[clientId] : null;

    const query = (st.query || '').trim().toLowerCase();
    const taskPool = client ? (client.projectData?.clientTasks || []) : (OL._allClientTasksFlat ? OL._allClientTasksFlat() : []);
    const requestPool = client ? OL.listProjectRequests(client) : (OL._allClientRequestsFlat ? OL._allClientRequestsFlat() : []);
    const resourcePool = client ? (client.projectData?.localResources || []) : (OL._allClientResourcesFlat ? OL._allClientResourcesFlat() : []);

    const matchTitle = (v) => String(v || '').toLowerCase().includes(query);
    const tasks = taskPool.filter((t) => matchTitle(t.title || t.name)).slice(0, 30);
    const requests = requestPool.filter((r) => matchTitle(OL.requestItemTitle ? OL.requestItemTitle(client, r) : (r.name || r.title))).slice(0, 30);
    const resourceGroups = groupResources(resourcePool, st.query || '', { extra: (r) => r._clientName });
    const resources = flattenGroups(resourceGroups).slice(0, 60);

    // Picks are looked up by position rather than written into the onclick text, so a title containing an
    // apostrophe or quote (e.g. "Review Anthony's email") can't break the handler.
    const titleOfRequest = (r) => (OL.requestItemTitle ? OL.requestItemTitle(client, r) : (r.name || r.title));
    OL._excerptPickLists = {
        task: tasks.map((t) => ({ id: t.id, label: t.title || t.name })),
        request: requests.map((r) => ({ id: r.id, label: titleOfRequest(r) })),
        resource: resources.map((r) => ({ id: r.id, label: r.name })),
    };
    const pick = (type, id, label) => { OL._excerptLinkState.targetType = type; OL._excerptLinkState.targetId = id; OL._excerptLinkState.targetLabel = label; OL.renderExcerptLinkPicker(); };

    const content = `
        <div style="padding:24px 36px 24px 24px; box-sizing:border-box; max-width:900px; width:90vw;" onclick="event.stopPropagation()">
            <div class="modal-header" style="display:flex; justify-content:space-between; align-items:flex-start; border-bottom:1px solid var(--line); padding-bottom:10px; margin-bottom:14px;">
                <div>
                    <h3 style="margin:0; font-size:15px;">Link this ${st.kind}</h3>
                    <div class="tiny muted" style="margin-top:4px; max-width:520px;">"${esc(st.excerptText.length > 140 ? st.excerptText.slice(0, 140) + '…' : st.excerptText)}"</div>
                </div>
                <button class="btn tiny soft" onclick="OL._excerptLinkState=null; OL.closeModal(); OL.openGmailMessageModal('${st.messageId}')">✕</button>
            </div>

            ${st.targetId ? `
                <div style="display:flex; align-items:center; justify-content:space-between; padding:8px 10px; background:rgba(var(--accent-rgb), 0.06); border:1px solid var(--accent); border-radius:6px; margin-bottom:12px;">
                    <span class="tiny bold">${esc(st.targetLabel)} <span class="pill tiny soft" style="font-size:9px;">${esc(st.targetType)}</span></span>
                    <button class="btn tiny soft" onclick="OL._excerptLinkState.targetType=''; OL._excerptLinkState.targetId=''; OL.renderExcerptLinkPicker();">Change</button>
                </div>
            ` : st.creatingNewTask ? `
                <div style="padding:10px; border:1px solid var(--line); border-radius:6px; margin-bottom:12px;">
                    <label class="tiny muted bold" style="display:block; margin-bottom:4px;">New task title</label>
                    <input type="text" id="excerpt-new-task-title" class="modal-input tiny" style="width:100%; margin-bottom:8px;" value="${esc(st.newTaskTitle || '')}"
                           oninput="OL._excerptLinkState.newTaskTitle=this.value">
                    ${!clientId ? `<div class="tiny" style="color:#ef4444; margin-bottom:8px;">Link this email to a project first (below) before creating a task.</div>` : ''}
                </div>
            ` : st.creatingNewRequest ? `
                <div style="padding:10px; border:1px solid var(--line); border-radius:6px; margin-bottom:12px;">
                    <label class="tiny muted bold" style="display:block; margin-bottom:4px;">New request title</label>
                    <input type="text" id="excerpt-new-request-title" class="modal-input tiny" style="width:100%; margin-bottom:8px;" value="${esc(st.newRequestTitle || '')}"
                           oninput="OL._excerptLinkState.newRequestTitle=this.value">
                    <label class="tiny muted bold" style="display:block; margin-bottom:4px;">Type</label>
                    <select class="modal-input tiny" style="width:100%; margin-bottom:8px;" onchange="OL._excerptLinkState.newRequestType=this.value">
                        ${(typeof getRequestTypes === 'function' ? getRequestTypes() : [{key:'build',label:'Build'},{key:'revision',label:'Revision'}]).map((t) => `<option value="${esc(t.key)}" ${st.newRequestType === t.key ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}
                    </select>
                    ${!clientId ? `<div class="tiny" style="color:#ef4444; margin-bottom:8px;">Link this email to a project first (below) before creating a request.</div>` : ''}
                    ${state.adminMode === true ? `
                        <label class="tiny" style="display:flex; align-items:center; gap:6px; margin-bottom:4px; cursor:pointer;">
                            <input type="checkbox" ${st.activateNow ? 'checked' : ''} ${clientId ? '' : 'disabled'} onchange="OL._excerptLinkState.activateNow=this.checked; OL.renderExcerptLinkPicker();">
                            <strong>Activate it now</strong> (set up its tasks without going to the Scoping sheet)
                        </label>` : ''}
                    <div class="tiny muted" style="margin-bottom:8px;">${state.adminMode === true && st.activateNow
                        ? (clientId && isMaintenanceClient(state.clients?.[clientId])
                            ? 'Goes into the Maintenance queue as Do Now, and the activation review opens as soon as it is linked.'
                            : 'Goes into the next open round as Do Now. It activates when that round is approved, and the review opens then.')
                        : 'Created in the Backlog (round 0): it waits on the scoping sheet until someone gives it a round.'}</div>
                </div>
            ` : `
                <input type="text" class="modal-input tiny" placeholder="Search tasks, requests, resources..." value="${esc(st.query)}" style="width:100%; margin-bottom:10px;"
                       oninput="OL._excerptLinkState.query=this.value; OL.reRenderPreservingFocus(() => OL.renderExcerptLinkPicker());">
                <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:14px; margin-bottom:8px;">
                    <div>
                        <div class="tiny bold uppercase muted" style="margin-bottom:4px;">Tasks</div>
                        <div style="display:grid; gap:4px; max-height:200px; overflow:auto;">
                            ${tasks.length ? tasks.map((t, i) => `<div class="tiny" style="padding:6px 8px; border:1px solid var(--line); border-radius:6px; cursor:pointer;" onclick="OL.__excerptPickIdx('task', ${i})">${esc(t.title || t.name)}</div>`).join('') : `<div class="tiny muted">None</div>`}
                        </div>
                    </div>
                    <div>
                        <div class="tiny bold uppercase muted" style="margin-bottom:4px;">Requests</div>
                        <div style="display:grid; gap:4px; max-height:200px; overflow:auto;">
                            ${requests.length ? requests.map((r, i) => `<div class="tiny" style="padding:6px 8px; border:1px solid var(--line); border-radius:6px; cursor:pointer;" onclick="OL.__excerptPickIdx('request', ${i})">${esc(OL.requestItemTitle ? OL.requestItemTitle(client, r) : (r.name || r.title))}</div>`).join('') : `<div class="tiny muted">None</div>`}
                        </div>
                    </div>
                    <div>
                        <div class="tiny bold uppercase muted" style="margin-bottom:4px;">Resources</div>
                        <div style="max-height:200px; overflow:auto;">
                            ${groupsHtml(resourceGroups.map((g) => ({ label: g.label, items: g.items.filter((r) => resources.includes(r)) })).filter((g) => g.items.length), (r, i) => `<div class="tiny" style="padding:6px 8px; border:1px solid var(--line); border-radius:6px; cursor:pointer;" onclick="OL.__excerptPickIdx('resource', ${i})">${esc(r.name)}</div>`, { query: st.query || '', empty: 'None' })}
                        </div>
                    </div>
                </div>
                <div class="tiny muted" style="margin-bottom:12px;">Not finding it? <a href="#" onclick="event.preventDefault(); OL.startExcerptCreateTask();">Create a new task</a> or <a href="#" onclick="event.preventDefault(); OL.startExcerptCreateRequest();">create a new request</a> instead${!clientId ? ' (link this email to a project first)' : ''}.</div>
            `}

            <label class="tiny muted bold" style="display:block; margin-bottom:4px;">Note (optional — a refined summary, not the raw excerpt)</label>
            <textarea class="modal-input tiny" rows="2" style="width:100%; margin-bottom:14px;" placeholder="e.g. confirms all 12 fields mapped"
                      oninput="OL._excerptLinkState.note=this.value">${esc(st.note)}</textarea>

            <div style="display:flex; justify-content:flex-end; gap:8px;">
                ${st.creatingNewTask ? `
                    <button class="btn tiny soft" onclick="OL._excerptLinkState.creatingNewTask=false; OL.renderExcerptLinkPicker();">Back to search</button>
                    <button class="btn tiny primary" ${clientId ? '' : 'disabled'} onclick="OL.confirmExcerptCreateTask()">Create & link</button>
                ` : st.creatingNewRequest ? `
                    <button class="btn tiny soft" onclick="OL._excerptLinkState.creatingNewRequest=false; OL.renderExcerptLinkPicker();">Back to search</button>
                    <button class="btn tiny primary" ${clientId ? '' : 'disabled'} onclick="OL.confirmExcerptCreateRequest()">${state.adminMode === true && st.activateNow ? 'Create, link & activate' : 'Create & link'}</button>
                ` : `
                    <button class="btn tiny soft" onclick="OL._excerptLinkState=null; OL.closeModal(); OL.openGmailMessageModal('${st.messageId}')">Cancel</button>
                    <button class="btn tiny primary" ${st.targetId ? '' : 'disabled'} onclick="OL.confirmExcerptLink()">Link ${st.kind}</button>
                `}
            </div>
        </div>
    `;
    OL.showOverlayModal(content);
};

OL.__excerptPickIdx = function(type, index) {
    const item = OL._excerptPickLists?.[type]?.[index];
    if (item) OL.__excerptPick(type, item.id, item.label);
};

// Bridge for the inline onclick handlers above (keeps the picker's own
// state update + re-render in one place rather than duplicated per column).
OL.__excerptPick = function(type, id, label) {
    if (!OL._excerptLinkState) return;
    OL._excerptLinkState.targetType = type;
    OL._excerptLinkState.targetId = id;
    OL._excerptLinkState.targetLabel = label;
    OL.renderExcerptLinkPicker();
};

// ---- "not finding it? create a new task instead" — same picker, no separate flow ----
OL.startExcerptCreateTask = function() {
    const st = OL._excerptLinkState;
    if (!st) return;
    st.creatingNewTask = true;
    st.newTaskTitle = st.excerptText.length > 80 ? st.excerptText.slice(0, 80) : st.excerptText;
    OL.renderExcerptLinkPicker();
    setTimeout(() => document.getElementById('excerpt-new-task-title')?.focus(), 0);
};

// Creates the task (same shape/pattern as the existing whole-email
// OL.createAndLinkGmailTask), then reuses confirmExcerptLink for the
// piece_link write and any pending-suggestion resolution, rather than
// duplicating that logic here.
OL.confirmExcerptCreateTask = async function() {
    const st = OL._excerptLinkState;
    if (!st) return;
    const clientId = OL._gmailLinkState?.clientId;
    const title = (st.newTaskTitle || '').trim();
    if (!title || !clientId) return;

    let newTaskId;
    await updateAndSync(() => {
        const client = state.clients[clientId];
        if (!client) return;
        if (!client.projectData) client.projectData = {};
        if (!client.projectData.clientTasks) client.projectData.clientTasks = [];
        newTaskId = uid();
        client.projectData.clientTasks.unshift({
            id: newTaskId, title, name: title,
            description: st.excerptText || '', assignee: 'Sphynx Task', loggedHours: 0,
            createdAt: new Date().toISOString(),
        });
    }, clientId);
    if (!newTaskId) return;

    st.targetType = 'task'; st.targetId = newTaskId; st.targetLabel = title;
    st.creatingNewTask = false;
    await OL.confirmExcerptLink();
};

// ---- "or create a new request instead" — same picker, same reasoning as the task path ----
OL.startExcerptCreateRequest = function() {
    const st = OL._excerptLinkState;
    if (!st) return;
    st.creatingNewRequest = true;
    st.newRequestTitle = st.excerptText.length > 80 ? st.excerptText.slice(0, 80) : st.excerptText;
    OL.renderExcerptLinkPicker();
    setTimeout(() => document.getElementById('excerpt-new-request-title')?.focus(), 0);
};

// Creates a resource-less request line ("reqline-" id, matching the
// existing isRequestLine convention read elsewhere — see
// core/request-links.js) directly on the client's first scoping sheet,
// status "Considering". That status is deliberate: isActive in
// core/requests.js only ever triggers for status === "Do Now", so this can
// never accidentally activate or generate tasks on its own — someone has
// to deliberately move it to Do Now and approve its round first, same as
// any other request. It does NOT go through the backlog/"Add to scoping
// sheet" flow designed earlier (never built as code) — it lands straight
// on the sheet as a Considering line, same as manual entry does today.
OL.confirmExcerptCreateRequest = async function() {
    const st = OL._excerptLinkState;
    if (!st) return;
    const clientId = OL._gmailLinkState?.clientId;
    const title = (st.newRequestTitle || '').trim();
    if (!title || !clientId) return;
    const activate = state.adminMode === true && st.activateNow === true;
    const requestType = st.newRequestType || 'build';

    let newItemId;
    let activateMode = null;   // 'review' = open the activation review right after linking; 'round' = it waits for its round to be approved
    let roundForToast = null;
    await updateAndSync(() => {
        const client = state.clients[clientId];
        if (!client) return;
        if (!client.projectData) client.projectData = {};

        // Activate now, on a Maintenance client: the Maintenance queue is where its requests live. They are Do Now on a
        // sheet that is always approved, so the activation review can open straight away.
        if (activate && isMaintenanceClient(client)) {
            const queue = ensureMaintenanceSheet(client.projectData);
            const built = buildMaintenanceRequest({ title, requestType, source: 'email', resourceIds: [] }, { uid, now: new Date().toISOString() });
            queue.lineItems.push(built);
            newItemId = built.id;
            activateMode = 'review';
            return;
        }

        if (!client.projectData.scopingSheets) client.projectData.scopingSheets = [{ id: 'initial', lineItems: [] }];
        const sheet = client.projectData.scopingSheets[0];
        newItemId = 'reqline-' + Date.now();
        const item = {
            id: newItemId,
            // Request-only lines need a synthetic 'reqline-' resourceId, the same as the Add Request modal gives them
            // (see saveRequestLine in features/scoping.js). Without one, getResourceById can't resolve the line and the
            // scoping sheet silently hides it.
            resourceId: 'reqline-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            name: title,
            requestType,
            responsibleParty: 'Sphynx',
            teamMode: 'everyone',
            teamIds: [],
            data: {},
            manualHours: 0,
            dependencies: [],
        };
        if (activate) {
            // Do Now in the next open round. The round gets its own Drafting entry, as "Add to scoping sheet" does, so it
            // is not swept up by an old sheet-wide approval. It activates once the round is approved.
            const target = nextOpenRound(sheet);
            Object.assign(item, { status: 'Do Now', round: target });
            if (!sheet.roundApprovals) sheet.roundApprovals = {};
            const entry = sheet.roundApprovals[String(target)];
            if (!entry || !entry.status) {
                sheet.roundApprovals[String(target)] = { ...(entry || {}), status: 'Drafting', statusChangedAt: new Date().toISOString(), approvedAt: null, collapsed: false };
            }
            activateMode = 'round'; roundForToast = target;
        } else {
            // The Backlog is round 0: it waits on the scoping sheet until someone gives it a round (core/requests.js).
            Object.assign(item, { status: 'Backlog', round: null });
        }
        (sheet.lineItems = sheet.lineItems || []).push(item);
    }, clientId);
    if (!newItemId) return;

    st.targetType = 'request'; st.targetId = newItemId; st.targetLabel = title;
    st.creatingNewRequest = false;
    if (activateMode === 'review') {
        st.afterLink = async () => { await OL.openActivationReview(clientId, newItemId); };
    } else if (activateMode === 'round') {
        st.afterLink = () => {
            OL.openGmailMessageModal(st.messageId);
            const msg = `"${title}" is in Round ${roundForToast} as Do Now. It activates once that round is approved, and the review opens then.`;
            if (typeof OL.showToast === 'function') OL.showToast(msg);
        };
    }
    await OL.confirmExcerptLink();
};

OL.confirmExcerptLink = async function() {
    const st = OL._excerptLinkState;
    if (!st || !st.targetId) return;

    const { data: m, error: fetchErr } = await db.from('gmail_messages').select('piece_links, suggestions').eq('id', st.messageId).single();
    if (fetchErr) { alert('Could not load this email to link it.'); return; }

    const pieceLinks = Array.isArray(m.piece_links) ? m.piece_links.slice() : [];
    pieceLinks.push({
        id: 'pl-' + uid(), kind: st.kind, text: st.excerptText, note: st.note || '',
        targetType: st.targetType, targetId: st.targetId, targetLabel: st.targetLabel,
        attachmentPath: st.attachmentPath || null,
        createdAt: new Date().toISOString(),
    });

    const updatePayload = { piece_links: pieceLinks };
    // If this picker was opened from a suggestion's "Choose target..."
    // button, resolve that suggestion too so it drops out of the pending list.
    const pending = OL._pendingSuggestionLink;
    if (pending && pending.messageId === st.messageId) {
        updatePayload.suggestions = (m.suggestions || []).map((s) => s.id === pending.suggestionId ? { ...s, status: 'linked' } : s);
    }

    const { error } = await db.from('gmail_messages').update(updatePayload).eq('id', st.messageId);
    if (error) { alert('Could not save that link.'); return; }

    // A new link straight to a request rolls down onto its existing build tasks right away — not just at
    // activation (core/roll-down.js / features/rollup.js). A no-op if the request hasn't been activated yet.
    if (st.targetType === 'request' && typeof OL.rollDownForRequest === 'function') {
        const clientId = OL._gmailLinkState?.clientId;
        if (clientId) { try { await OL.rollDownForRequest(clientId, st.targetId); } catch (e) { console.warn('Roll-down failed:', e); } }
    }

    const afterLink = st.afterLink;
    OL._excerptLinkState = null;
    OL._pendingSuggestionLink = null;
    OL.closeModal();
    // Normally back to the email so the new link shows; "Activate it now" goes on to the activation review instead.
    if (typeof afterLink === 'function') { try { await afterLink(); } catch (e) { console.warn('After-link step failed:', e); OL.openGmailMessageModal(st.messageId); } }
    else OL.openGmailMessageModal(st.messageId);   // reopen fresh so the new piece-link shows
    if (updatePayload.suggestions) OL._maybePromptArchiveAfterSuggestions(st.messageId);
};

// ---- showing what's already linked, with jump-to-target and unlink ----
// ---- attachments (populated by get-gmail-messages' collectAttachmentParts
// / fetchAndStoreAttachments — see gmail_attachments.sql) ----
// The bucket is private, so viewing/downloading one always goes through a
// short-lived signed URL generated on demand, never a permanent public link.
OL.getGmailAttachmentUrl = async function(storagePath) {
    const { data, error } = await db.storage.from('gmail-attachments').createSignedUrl(storagePath, 3600);
    if (error) { alert('Could not open that attachment: ' + error.message); return null; }
    return data?.signedUrl || null;
};

OL.openGmailAttachment = async function(storagePath) {
    const url = await OL.getGmailAttachmentUrl(storagePath);
    if (url) window.open(url, '_blank');
};

OL.renderGmailAttachments = function(m) {
    const container = document.getElementById('gmail-attachments');
    if (!container) return;
    const attachments = Array.isArray(m.attachments) ? m.attachments : [];
    if (!attachments.length) { container.innerHTML = ''; return; }

    const sizeLabel = (bytes) => bytes > 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
    const alreadyLinked = (path) => (Array.isArray(m.piece_links) ? m.piece_links : []).some((l) => l.kind === 'attachment' && l.attachmentPath === path);

    container.innerHTML = `
        <div style="margin-bottom:16px;">
            <label class="bold tiny uppercase muted" style="display:block; margin-bottom:6px;">Attachments (${attachments.length})</label>
            <div style="display:flex; flex-wrap:wrap; gap:8px;">
                ${attachments.map((a) => `
                    <div style="display:flex; align-items:center; gap:8px; padding:6px 10px; border:1px solid var(--line); border-radius:6px;">
                        <span class="tiny" style="cursor:pointer; text-decoration:underline;" data-path="${esc(a.storagePath)}" onclick="OL.openGmailAttachment(this.dataset.path)" title="View / download">
                            <i data-lucide="paperclip" style="width:11px;height:11px;vertical-align:sub;"></i> ${esc(a.filename)} <span class="tiny muted">(${sizeLabel(a.size || 0)})</span>
                        </span>
                        ${alreadyLinked(a.storagePath)
                            ? `<span class="tiny" style="color:var(--accent);">Linked</span>`
                            : `<button class="btn tiny soft" data-path="${esc(a.storagePath)}" data-name="${esc(a.filename)}" onclick="OL.openExcerptLinkPicker('${esc(m.id)}', '' + this.dataset.name, 'attachment', this.dataset.path)">Link this attachment</button>`}
                    </div>
                `).join('')}
            </div>
        </div>
    `;
    if (window.lucide) lucide.createIcons();
};

OL.renderGmailPieceLinks = function(m) {
    const container = document.getElementById('gmail-piece-links');
    if (!container) return;
    const links = Array.isArray(m.piece_links) ? m.piece_links : [];
    if (!links.length) { container.innerHTML = ''; return; }

    container.innerHTML = `
        <div style="margin-top:12px; display:grid; gap:6px;">
            <span class="tiny bold uppercase muted">Linked parts of this email (${links.length})</span>
            ${links.map((l) => `
                <div style="padding:8px 10px; border:1px solid var(--line); border-radius:6px; background:rgba(var(--accent-rgb),0.04);">
                    <div class="tiny muted" style="margin-bottom:4px;">"${esc(l.text.length > 100 ? l.text.slice(0, 100) + '…' : l.text)}"</div>
                    <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
                        <span class="tiny bold">${esc(l.targetLabel)} <span class="pill tiny soft" style="font-size:9px;">${esc(l.targetType)}</span></span>
                        <div style="display:flex; gap:4px; flex-shrink:0;">
                            <button class="btn tiny soft" onclick="OL.jumpToGmailPieceTarget('${esc(l.targetType)}', '${esc(l.targetId)}', '${esc(m.linked_client_id || '')}')">Jump to ${esc(l.targetType)}</button>
                            <button class="btn tiny soft" style="color:#ef4444;" onclick="OL.unlinkGmailPiece('${m.id}', '${l.id}')">Unlink</button>
                        </div>
                    </div>
                    ${l.note ? `<div class="tiny muted" style="margin-top:4px;">${esc(l.note)}</div>` : ''}
                </div>
            `).join('')}
        </div>
    `;
};

OL.jumpToGmailPieceTarget = function(type, id, clientId) {
    OL.closeModal();
    if (type === 'task') { OL.openTaskInContext(clientId, id); return; }
    if (type === 'request') { OL.openRequestFromTask(clientId, id); return; }
    if (type === 'resource' && typeof OL.openResourceModal === 'function') { OL.openResourceModal(id); return; }
};

OL.unlinkGmailPiece = async function(messageId, pieceLinkId) {
    const { data: m, error: fetchErr } = await db.from('gmail_messages').select('piece_links').eq('id', messageId).single();
    if (fetchErr) return;
    const pieceLinks = (Array.isArray(m.piece_links) ? m.piece_links : []).filter((l) => l.id !== pieceLinkId);
    await db.from('gmail_messages').update({ piece_links: pieceLinks }).eq('id', messageId);
    OL.openGmailMessageModal(messageId);
};

// -------------------------------------------------------------
// EMAIL CANDIDATE CLASSIFICATION (fuzzy-match suggestions)
// -------------------------------------------------------------
// Fully local phrase-library matching — no network call, no API key,
// nothing sent off this machine. A whole-email heuristic first decides
// whether an email is worth looking at closely at all
// (OL._emailLooksLikeCandidate); a second, per-sentence pass then splits
// the body into lines and pattern-matches each one for type (new
// request / revision), fuzzy-scoring it against the client's open
// requests/resources for a possible existing-item match
// (OL._classifyEmailCandidatesLocally). Results cache on the row
// (classified_at) so re-opening an email, or a future re-sync, never
// re-classifies it.
//
// AN AI-BACKED VERSION IS BUILT BUT NOT CALLED FROM HERE — see
// supabase/functions/classify-email-candidates (requires an
// ANTHROPIC_API_KEY secret). Flagged as a future upgrade: swap
// OL.classifyEmailCandidates's body back to the db.functions.invoke(...)
// call (see BUILD_NOTES/git history) if the phrase-library's accuracy
// turns out not to be good enough in practice. The suggestions schema and
// UI are identical either way — only how a candidate gets found changes.
//
// NOT YET WIRED INTO SYNC: ideally this runs during the Gmail sync job so
// a badge is already there by the time someone opens the inbox — that
// file isn't something this pass has visibility into. For now it runs
// lazily the first time an unclassified email is opened (see the call in
// openGmailMessageModal below). Being fully local, cost isn't a concern
// here the way it was for the AI path — this could safely run on every
// synced email once wired into sync, not just on first open.

// Cheap, free, local — patterns that suggest an actual ask rather than
// scheduling chatter or a pleasantry. Intentionally permissive (a false
// positive costs nothing here — it's still all local — a false negative
// means a real ask never gets suggested at all, which is the worse failure).
OL._EMAIL_CANDIDATE_PATTERNS = [
    /could you( also)?\b/i, /can you\b/i, /would (it be possible|you|love)\b/i,
    /please (add|update|change|fix|build|set up|create)\b/i,
    /(need|needs|needed) (to|a|an)\b/i, /one more thing\b/i, /also,? \b/i,
    /(is|are) (going out|still)\b/i, /wrong\b/i, /doesn'?t work\b/i, /not working\b/i,
    /can we\b/i, /I think I mentioned\b/i, /wanted to flag\b/i,
];
OL._emailLooksLikeCandidate = function(bodyText) {
    const text = String(bodyText || '');
    if (text.trim().length < 20) return false;   // too short to contain a real ask
    return OL._EMAIL_CANDIDATE_PATTERNS.some((p) => p.test(text));
};

// The client's open requests/resources/tasks, as context for the classifier
// (so "existing_match" suggestions can name something real) — capped and
// kept to titles/ids only, never internal notes or pricing.
OL._openItemsForClassification = function(clientId) {
    const client = state.clients?.[clientId];
    if (!client) return [];
    const out = [];
    OL.listProjectRequests ? OL.listProjectRequests(client).forEach((r) => {
        if (r.status === 'Done' || r.status === "Don't Do") return;
        out.push({ id: String(r.id), type: 'request', label: OL.requestItemTitle ? OL.requestItemTitle(client, r) : (r.name || r.title || 'Request') });
    }) : null;
    (client.projectData?.localResources || []).forEach((res) => {
        if (res.isArchived || res.archived) return;
        out.push({ id: String(res.id), type: 'resource', label: res.name });
    });
    return out.slice(0, 60);
};

// Runs the two-stage classification for one email, if it hasn't already
// been classified. Writes suggestions + classified_at to the row and
// re-renders the panel if that email's modal is still open. Safe to call
// speculatively — no-ops instantly if already classified or the heuristic
// says skip.
// Sentence-level type patterns for the phrase-library classifier —
// deliberately similar in spirit to OL._EMAIL_CANDIDATE_PATTERNS (the
// whole-email gate above) but scored per sentence so each candidate gets
// its own type guess, not just a yes/no for the whole email.
OL._REVISION_PATTERNS = [
    /\bwrong\b/i, /\bbroken\b/i, /doesn'?t work/i, /not working/i, /\bfix(ed|ing)?\b/i,
    /\bissue\b/i, /\berror\b/i, /still (going out|showing|has)\b/i, /old (logo|version)\b/i,
];
OL._NEW_REQUEST_PATTERNS = [
    /could you( also)?\b/i, /can you\b/i, /can we\b/i, /would (it be possible|you|love)\b/i,
    /please (add|update|change|fix|build|set up|create)\b/i, /(need|needs|needed) (to|a|an)\b/i,
    /one more thing\b/i, /wanted to (flag|ask|see)\b/i,
];

// Splits on sentence-ending punctuation AND newlines (emails often list
// asks line by line without full stops), then keeps only the ones that
// actually look like a candidate on their own — the whole-email heuristic
// above just gates whether it's worth looking at all; this is the
// per-sentence pass that decides which lines matter.
OL._splitEmailIntoCandidateLines = function(bodyText) {
    const lines = String(bodyText || '')
        .split(/\r?\n|(?<=[.!?])\s+(?=[A-Z0-9])/)
        .map((s) => s.trim())
        .filter((s) => s.length >= 15 && s.length <= 400);
    // De-dupe near-identical lines (quoted reply chains repeat the same text).
    const seen = new Set();
    return lines.filter((s) => {
        const key = s.toLowerCase().replace(/\s+/g, ' ');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
};

// Cheap word-overlap similarity, 0..1 — no external library, just set
// intersection against the smaller side (an open item's title is usually
// much shorter than the candidate sentence it appears in).
OL._wordOverlapScore = function(a, b) {
    const words = (s) => new Set(String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2));
    const wa = words(a), wb = words(b);
    if (!wa.size || !wb.size) return 0;
    let hits = 0;
    wb.forEach((w) => { if (wa.has(w)) hits++; });
    return hits / Math.min(wa.size, wb.size);
};

// The phrase-library classifier itself — fully local, no network call, no
// API key. Caps at 5 suggestions per email so an over-eager pattern list
// doesn't flood the panel; see BUILD_NOTES for tuning notes. An AI-backed
// version (supabase/functions/classify-email-candidates) is built and
// ready as a future upgrade but not called from here — see BUILD_NOTES.
OL._classifyEmailCandidatesLocally = function(bodyText, openItems) {
    const lines = OL._splitEmailIntoCandidateLines(bodyText);
    const out = [];

    for (const line of lines) {
        if (out.length >= 5) break;
        const revisionHits = OL._REVISION_PATTERNS.filter((p) => p.test(line)).length;
        const newRequestHits = OL._NEW_REQUEST_PATTERNS.filter((p) => p.test(line)).length;
        if (revisionHits === 0 && newRequestHits === 0) continue;

        // Best existing-item match for this line, if any.
        let best = null;
        for (const item of openItems) {
            const score = OL._wordOverlapScore(line, item.label);
            if (score >= 0.5 && (!best || score > best.score)) best = { ...item, score };
        }

        if (best) {
            out.push({
                text: line, suggestedType: 'existing_match',
                matchTargetId: best.id, matchTargetLabel: best.label,
                confidence: best.score >= 0.75 ? 'high' : 'medium',
            });
        } else {
            const suggestedType = revisionHits > 0 && revisionHits >= newRequestHits ? 'revision' : 'new_request';
            const hitCount = Math.max(revisionHits, newRequestHits);
            out.push({ text: line, suggestedType, matchTargetId: null, matchTargetLabel: null, confidence: hitCount >= 2 ? 'medium' : 'low' });
        }
    }
    return out;
};

OL.classifyEmailCandidates = async function(messageId) {
    const { data: m, error: fetchErr } = await db.from('gmail_messages')
        .select('id, body, snippet, linked_client_id, classified_at').eq('id', messageId).single();
    if (fetchErr || !m || m.classified_at) return;

    const bodyText = OL._stripHtmlForPreview ? (OL._stripHtmlForPreview(m.body) || m.snippet || '') : (m.body || m.snippet || '');
    if (!OL._emailLooksLikeCandidate(bodyText)) {
        // Still mark classified — no candidates, but no need to re-check
        // this same email's heuristic again on every future open.
        await db.from('gmail_messages').update({ classified_at: new Date().toISOString(), suggestions: [] }).eq('id', messageId);
        return;
    }

    const openItems = OL._openItemsForClassification(m.linked_client_id);
    const candidates = OL._classifyEmailCandidatesLocally(bodyText, openItems);

    const suggestions = candidates.map((c) => ({
        id: 'sg-' + uid(), text: c.text, suggestedType: c.suggestedType,
        matchTargetId: c.matchTargetId || null, matchTargetLabel: c.matchTargetLabel || null,
        confidence: c.confidence, status: 'pending', classifiedAt: new Date().toISOString(),
    }));

    await db.from('gmail_messages').update({
        suggestions, classified_at: new Date().toISOString(),
    }).eq('id', messageId);

    // Re-render only if this email is still the one open.
    if (OL._gmailLinkState?.emailId === messageId) {
        const { data: fresh } = await db.from('gmail_messages').select('*').eq('id', messageId).single();
        if (fresh) OL.renderGmailSuggestions(fresh);
    }
};

OL.renderGmailSuggestions = function(m) {
    const container = document.getElementById('gmail-suggestions');
    if (!container) return;
    const pending = (Array.isArray(m.suggestions) ? m.suggestions : []).filter((s) => s.status === 'pending');
    if (!pending.length) { container.innerHTML = ''; return; }

    const confidenceColor = { high: 'var(--accent, #64c6a2)', medium: '#eab308', low: 'var(--text-muted, #94a3b8)' };
    const typeLabel = { new_request: 'Possible new request', revision: 'Possible revision', existing_match: 'Matches existing item' };

    container.innerHTML = `
        <div style="margin-bottom:16px;">
            <label class="bold tiny uppercase muted" style="display:block; margin-bottom:6px;">Suggested (${pending.length})</label>
            <div style="display:grid; gap:6px;">
                ${pending.map((s) => `
                    <div style="padding:8px 10px; border:1px solid var(--line); border-radius:6px;">
                        <div class="tiny" style="margin-bottom:4px;">"${esc(s.text.length > 120 ? s.text.slice(0, 120) + '…' : s.text)}"</div>
                        <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
                            <span class="tiny" style="color:${confidenceColor[s.confidence] || confidenceColor.low};">${esc(typeLabel[s.suggestedType] || 'Suggested')}${s.matchTargetLabel ? ` · ${esc(s.matchTargetLabel)}` : ''}</span>
                            <div style="display:flex; gap:4px; flex-shrink:0;">
                                ${s.suggestedType === 'existing_match' && s.matchTargetId
                                    ? `<button class="btn tiny primary" onclick="OL.linkGmailSuggestion('${m.id}', '${s.id}')">Link</button>`
                                    : `<button class="btn tiny soft" onclick="OL.openExcerptLinkPickerForSuggestion('${m.id}', '${s.id}')">Choose target…</button>`}
                                <button class="btn tiny soft" onclick="OL.dismissGmailSuggestion('${m.id}', '${s.id}')">Dismiss</button>
                            </div>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
};

// Quick path — a high-confidence existing-item match links in one click,
// same underlying storage (piece_links) as manual excerpt linking.
OL.linkGmailSuggestion = async function(messageId, suggestionId) {
    const { data: m, error: fetchErr } = await db.from('gmail_messages').select('suggestions, piece_links').eq('id', messageId).single();
    if (fetchErr) return;
    const suggestion = (m.suggestions || []).find((s) => s.id === suggestionId);
    if (!suggestion) return;

    const pieceLinks = Array.isArray(m.piece_links) ? m.piece_links.slice() : [];
    pieceLinks.push({
        id: 'pl-' + uid(), kind: 'excerpt', text: suggestion.text, note: '',
        targetType: 'resource', targetId: suggestion.matchTargetId, targetLabel: suggestion.matchTargetLabel,
        createdAt: new Date().toISOString(),
    });
    const suggestions = (m.suggestions || []).map((s) => s.id === suggestionId ? { ...s, status: 'linked' } : s);

    await db.from('gmail_messages').update({ piece_links: pieceLinks, suggestions }).eq('id', messageId);
    OL.openGmailMessageModal(messageId);
    OL._maybePromptArchiveAfterSuggestions(messageId);
};

// For a suggestion with no ready-made match (new_request/revision, or a
// low-confidence existing_match) — opens the same picker excerpt-linking
// uses, pre-filled with the suggested text, so a human decides where it
// actually goes rather than the system guessing.
OL.openExcerptLinkPickerForSuggestion = function(messageId, suggestionId) {
    OL._pendingSuggestionLink = { messageId, suggestionId };
    OL.openExcerptLinkPicker(messageId, '');   // filled in below once we have the suggestion's text
    db.from('gmail_messages').select('suggestions').eq('id', messageId).single().then(({ data }) => {
        const s = (data?.suggestions || []).find((x) => x.id === suggestionId);
        if (s && OL._excerptLinkState) { OL._excerptLinkState.excerptText = s.text; OL.renderExcerptLinkPicker(); }
    });
};

// Archive rule for suggestions: once every suggested item on an email has been linked or dismissed, the email is
// dealt with — so the app ASKS whether to archive it (only this message, in the app and in Gmail). It never archives
// on its own. An email with nothing suggested never triggers this, and a quick one-item link ("This answers it")
// doesn't either; see saveGmailLink for the other trigger (linked to a project AND another item).
OL._maybePromptArchiveAfterSuggestions = async function(messageId) {
    const { data: m, error } = await db.from('gmail_messages').select('suggestions, archived').eq('id', messageId).single();
    if (error || !m || m.archived) return;
    const list = Array.isArray(m.suggestions) ? m.suggestions : [];
    if (!list.length) return;
    if (!list.every((s) => s && (s.status === 'linked' || s.status === 'dismissed'))) return;
    OL.promptArchiveEmail(messageId, 'suggestions');
};

// The confirmation itself. Its own layer above any open modal (the email is usually still open behind it), and
// clicking outside means "not now" — nothing is archived unless "Archive" is pressed.
OL._archivePromptFor = null;
OL.promptArchiveEmail = async function(messageId, reason) {
    if (OL._archivePromptFor === messageId) return;   // already asking about this one
    const { data: m } = await db.from('gmail_messages').select('id, subject, archived').eq('id', messageId).maybeSingle();
    if (!m || m.archived) return;

    OL._archivePromptFor = messageId;
    document.getElementById('archive-email-prompt')?.remove();
    const why = reason === 'suggestions'
        ? 'Every suggested item on it has been linked or dismissed.'
        : "It's linked to a project and to another item, so it looks dealt with.";
    const wrap = document.createElement('div');
    wrap.id = 'archive-email-prompt';
    wrap.style.cssText = 'position:fixed; inset:0; z-index:20000; display:flex; align-items:center; justify-content:center; background:rgba(2,6,23,0.6);';
    wrap.onclick = () => OL.answerArchivePrompt(false);
    wrap.innerHTML = `
        <div class="card" style="max-width:420px; width:90vw; padding:20px; cursor:default;" onclick="event.stopPropagation();">
            <div style="display:flex; align-items:center; gap:8px; margin-bottom:10px; font-weight:bold;">
                <i data-lucide="archive" style="width:16px;height:16px;color:var(--accent);"></i> Archive this email?
            </div>
            <div class="small" style="line-height:1.5; margin-bottom:6px;">${esc(why)}</div>
            <div class="tiny muted" style="margin-bottom:16px;">${m.subject ? `<strong>${esc(m.subject)}</strong><br>` : ''}It will be archived here and in Gmail. Other messages in the conversation aren't touched.</div>
            <div style="display:flex; justify-content:flex-end; gap:8px;">
                <button class="btn small soft" onclick="OL.answerArchivePrompt(false)">Not now</button>
                <button class="btn small primary" style="font-weight:bold;" onclick="OL.answerArchivePrompt(true)">Archive</button>
            </div>
        </div>`;
    document.body.appendChild(wrap);
    if (window.lucide) lucide.createIcons();
};

OL.answerArchivePrompt = async function(archive) {
    const id = OL._archivePromptFor;
    document.getElementById('archive-email-prompt')?.remove();
    OL._archivePromptFor = null;
    if (!archive || !id) return;
    // Same as the Archive button: this message only, in the app and in Gmail; closes its modal and refreshes the list.
    await OL.archiveGmailMessage(id, true, { wholeThread: false });
};

OL.dismissGmailSuggestion = async function(messageId, suggestionId) {
    const { data: m, error: fetchErr } = await db.from('gmail_messages').select('suggestions').eq('id', messageId).single();
    if (fetchErr) return;
    const suggestions = (m.suggestions || []).map((s) => s.id === suggestionId ? { ...s, status: 'dismissed' } : s);
    await db.from('gmail_messages').update({ suggestions }).eq('id', messageId);
    OL.openGmailMessageModal(messageId);
    OL._maybePromptArchiveAfterSuggestions(messageId);
};

// -------------------------------------------------------------
// COMPOSE / SEND EMAIL
// -------------------------------------------------------------

// Shared compose modal. `options.onSent(result)` lets each entry point
// (reply, blank compose, quick-email-a-contact) do its own targeted
// refresh after a successful send, rather than this guessing at what's
// currently on screen.
OL.openComposeEmailModal = function(options = {}) {
    // Addresses arrive as text ("a@x.com, b@y.com", or "Name <a@x.com>"); the window shows them as chips.
    const addrList = (v) => (Array.isArray(v) ? v : String(v || '').split(/[,;]+/))
        .map((x) => { const t = String(x).trim(); const m = t.match(/<([^>]+)>/); return m ? m[1].trim() : t; }).filter(Boolean);
    OL._composeState = {
        title: options.title || '',
        subject: options.subject || '',
        body: options.body || '',
        bodyHtml: options.bodyHtml || '',
        quoted: options.quoted || null,
        quotedHtml: options.quotedHtml || null,
        quotedMeta: options.quotedMeta || '',
        // A reply does not carry the earlier emails below it: the quoted message is only added if this is ticked.
        includeQuoted: options.includeQuoted === true,
        threadId: options.threadId || null,
        replyToMessageId: options.replyToMessageId || null,
        linked_client_id: options.linked_client_id || null,
        linked_resource_id: options.linked_resource_id || null,
        linked_task_id: options.linked_task_id || null,
        linked_request_id: options.linked_request_id || null,
        linked_event_id: options.linked_event_id || null,
        includedTaskIds: [],  // open project tasks ticked "include" — listed in the email
        attachments: [],      // from your computer: { filename, mimeType, contentBase64, size }
        projectFiles: [],     // from the project (Drive): { name, url } — sent as links
        onSent: typeof options.onSent === 'function' ? options.onSent : null,
        docked: !!options.docked,
        suggestedPeople: options.suggestedPeople || []
    };
    const st = OL._composeState;
    const isReply = !!st.replyToMessageId;
    const templates = state.master?.emailTemplates || [];
    const startHtml = options.bodyHtml || (options.body ? OL.plainTextToHtml(options.body) : '');
    OL.initRecipients('compose', {
        to: addrList(options.to), cc: addrList(options.cc), bcc: addrList(options.bcc),
        directory: OL.personDirectory(st.linked_client_id ? state.clients?.[st.linked_client_id] : null,
            [['Suggested', st.suggestedPeople.map((p) => p.email)]]),
        onChange: () => OL.renderComposeTaskPicker(),   // the project's open tasks follow who the email is going to
    });

    const belowHtml = `
        <div style="padding:8px 10px; border:1px solid var(--line); border-radius:6px; margin-bottom:10px;">
            <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                <span class="tiny bold"><i data-lucide="paperclip" style="width:11px;height:11px;"></i> Attachments</span>
                <label class="btn tiny soft" style="cursor:pointer; display:inline-flex !important; margin:0 !important;">From computer
                    <input type="file" multiple style="display:none !important;" onchange="OL.addComposeAttachments(this.files); this.value='';">
                </label>
                <button type="button" class="btn tiny soft" onclick="OL.openComposeProjectFilePicker()">From project files</button>
                <button type="button" class="btn tiny soft" onclick="OL.openComposeLibraryPicker()" title="Link a resource from the Master Library (only the sections chosen for email linking)">From Master Library</button>
                <span class="tiny muted">PDF, images, Office docs, CSV/TXT · up to 5 files, 10 MB each</span>
            </div>
            <div id="compose-attachments-list" style="display:flex; flex-wrap:wrap; gap:6px; margin-top:6px;"></div>
            <div id="compose-project-file-picker"></div>
        </div>

        <div id="compose-task-picker" style="margin-bottom:10px;"></div>

        ${st.quoted || st.quotedHtml ? `
            <label class="tiny" style="display:flex; align-items:center; gap:6px; margin-bottom:6px; cursor:pointer;">
                <input type="checkbox" ${st.includeQuoted ? 'checked' : ''} onchange="OL._composeState.includeQuoted = this.checked">
                Include the message I'm replying to below my reply <span class="muted">(just that message, never the chain under it)</span>
            </label>
            <details style="margin-bottom:10px;">
                <summary class="tiny muted" style="cursor:pointer;">Preview of the message that would be included</summary>
                <div class="tiny muted" style="white-space:pre-wrap; padding:8px; background:rgba(255,255,255,0.02); border-radius:6px; margin-top:4px; max-height:200px; overflow:auto;">${esc(st.quoted || '')}</div>
            </details>
        ` : ''}
        ${!isReply ? `
            <div style="margin-bottom:10px;">
                <label class="tiny muted bold">Link to Project (optional)</label>
                <select id="compose-email-client" class="modal-input tiny" onchange="OL.renderComposeTaskPicker()">
                    <option value="">— No project —</option>
                    ${Object.values(state.clients || {})
                        .filter(c => c?.meta?.name)
                        .sort((a, b) => (a.meta.name || '').localeCompare(b.meta.name || ''))
                        .map(c => `<option value="${c.id}" ${st.linked_client_id === c.id ? 'selected' : ''}>${esc(c.meta.name)}</option>`)
                        .join('')}
                </select>
            </div>
        ` : (st.linked_client_id && state.clients?.[st.linked_client_id] ? `
            <div class="tiny muted" style="margin-bottom:10px;">Will stay linked to <strong>${esc(state.clients[st.linked_client_id].meta?.name || 'this project')}</strong>, same as the original email.</div>
        ` : '')}`;

    const html = OL.composeShellHtml({
        prefix: 'compose',
        title: st.title || (isReply ? '↩ Reply' : 'Compose Email'),
        headExtraHtml: st.docked ? `<button class="btn tiny soft" title="Minimize" onclick="OL.toggleComposeDockMinimized()">▁</button>` : '',
        closeAction: 'OL.closeCompose()',
        introHtml: st.linked_client_id && typeof OL.clientOpenItemsSidebarHtml === 'function' ? OL.clientOpenItemsSidebarHtml(st.linked_client_id) : '',
        fromHtml: `<div class="tiny muted" style="margin-bottom:10px;">From <strong>${esc(state.master?.communications?.gmail?.email || 'the connected Gmail account')}</strong>${OL.getCurrentUserName ? ` · signed in as <strong>${esc(OL.getCurrentUserName())}</strong>` : ''}</div>`,
        showBcc: true,
        subject: st.subject,
        greeting: false,
        messageHtml: startHtml, messageMinHeight: 200, messagePlaceholder: 'Write your message…',
        messageToolbarHtml: `
            <select class="modal-input tiny" style="width:auto !important;" onchange="if(this.value){ OL.applyEmailTemplate(this.value); this.value=''; }">
                <option value="">${templates.length ? 'Insert template…' : 'No templates yet'}</option>
                ${templates.map(t => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('')}
            </select>
            <button type="button" class="btn tiny soft" onclick="OL.saveComposeAsTemplate()" title="Save this subject + message as a reusable template">Save as template</button>
            <button type="button" class="btn tiny soft" onclick="OL.openEmailTemplatesManager()" title="Edit or delete templates"><i data-lucide="settings-2" style="width:11px;height:11px;"></i></button>`,
        recipientsExtraHtml: st.suggestedPeople.length ? `<div style="display:flex; flex-wrap:wrap; gap:4px; margin:-4px 0 10px;">${st.suggestedPeople.slice(0, 10).map(p => `<button type="button" class="btn tiny soft" style="font-size:10px;" title="${esc(p.email)}" onclick="OL.addComposeRecipient('${esc(p.email)}')">+ ${esc(p.name || p.email)}</button>`).join('')}</div>` : '',
        belowHtml,
        sendAction: 'OL.sendComposedEmail()',
        maxWidth: '760px',
    });
    if (st.docked) {
        // Docked panel (bottom-right) — sits over whatever you're looking at,
        // including an open task/meeting/request window, without closing it.
        let dock = document.getElementById('compose-dock');
        if (!dock) { dock = document.createElement('div'); dock.id = 'compose-dock'; document.body.appendChild(dock); }
        dock.className = 'modal';
        dock.style.cssText = 'position:fixed; right:20px; bottom:0; width:min(640px, 96vw); max-height:88vh; overflow:auto; z-index:600; border:1px solid var(--accent); border-bottom:none; border-radius:12px 12px 0 0; box-shadow:0 -8px 30px rgba(0,0,0,0.45); background:var(--panel-dark, #111);';
        dock.innerHTML = html;
        dock.dataset.minimized = '';
    } else {
        OL.showOverlayModal(html);
    }
    OL.renderAllRecipients('compose', ['to', 'cc', 'bcc']);
    OL.renderComposeAttachments();
    OL.renderComposeTaskPicker();
    if (window.lucide) lucide.createIcons();
    document.getElementById(isReply ? 'compose-message' : 'compose-to-input')?.focus();
};

// ---- Closing / docking ----
OL.closeCompose = function() {
    const st = OL._composeState;
    const dock = document.getElementById('compose-dock');
    if (st?.docked || dock) { dock?.remove(); OL._composeState = null; return; }
    OL.closeModal();
};
OL.toggleComposeDockMinimized = function() {
    const dock = document.getElementById('compose-dock');
    if (!dock) return;
    const min = dock.dataset.minimized !== '1';
    dock.dataset.minimized = min ? '1' : '';
    dock.querySelector('.modal-body').style.display = min ? 'none' : '';
};

// ---- In-context compose, from anywhere ----
// Works out what you're looking at (an open task, meeting or request
// window, else the project page you're on) and opens a docked compose
// pre-linked to it, with that project's people offered as recipients and
// its open tasks ready to tick in. Open with the ✉️ button (bottom-left),
// the Email buttons on task/meeting/request windows, or Alt+E.
OL._composeContext = null; // set by the task/event/request windows while open
OL.setComposeContext = function(ctx) { OL._composeContext = ctx ? { ...ctx, at: Date.now() } : null; };

OL.openContextCompose = function(explicit) {
    const layer = document.getElementById('modal-layer');
    const modalOpen = layer && layer.style.display !== 'none' && layer.innerHTML.trim() !== '';
    const ctx = explicit || (modalOpen ? OL._composeContext : null) || {};
    const clientId = ctx.clientId || (state.activeClientId && state.clients?.[state.activeClientId] ? state.activeClientId : '');
    const client = clientId ? state.clients[clientId] : null;
    const opts = { docked: true, linked_client_id: clientId || null };
    let subjectBits = [];
    let to = [];

    if (ctx.kind === 'task' && client) {
        const t = (client.projectData?.clientTasks || []).find(x => String(x.id) === String(ctx.id));
        if (t) {
            opts.linked_task_id = t.id;
            opts.linked_request_id = t.requestLineItemId || null;
            subjectBits.push(t.title || t.name);
            const person = (client.projectData?.teamMembers || []).find(m => m.name === t.assignee && m.email);
            if (person) to.push(person.email);
        }
    } else if (ctx.kind === 'request' && client) {
        const r = OL.findRequestItem ? OL.findRequestItem(client, ctx.id) : null;
        if (r) { opts.linked_request_id = r.id; subjectBits.push(OL.requestItemTitle ? OL.requestItemTitle(client, r) : (r.name || 'Request')); }
    } else if (ctx.kind === 'event') {
        opts.linked_event_id = ctx.id;
        if (ctx.title) subjectBits.push(ctx.title);
        (ctx.attendees || []).forEach(e => { if (!(state.master?.sphynxTeam || []).some(m => (m.email || '').toLowerCase() === String(e).toLowerCase())) to.push(e); });
    }

    opts.to = [...new Set(to)].join(', ');
    opts.subject = subjectBits.length ? `${client?.meta?.name ? client.meta.name + ' — ' : ''}${subjectBits[0]}` : '';
    opts.title = `New email${client ? ' · ' + (client.meta?.name || '') : ''}${subjectBits.length ? ' · ' + subjectBits[0] : ''}`;
    opts.suggestedPeople = (client?.projectData?.teamMembers || []).filter(m => m.email).map(m => ({ name: m.name, email: m.email }));
    if (ctx.kind === 'task' && opts.linked_task_id) {
        // Pre-tick the task you were looking at in the "open tasks" list.
        OL.openComposeEmailModal(opts);
        if (OL._composeState) { OL._composeState.includedTaskIds = [opts.linked_task_id]; OL.renderComposeTaskPicker(); }
        return;
    }
    OL.openComposeEmailModal(opts);
};

OL.addComposeRecipient = function(email) { OL.addRecipient('compose', 'to', email); };

// Floating ✉️ button + Alt+E, for staff.
(function installComposeLauncher() {
    const mount = () => {
        if (document.getElementById('compose-launcher') || window.IS_GUEST) return;
        if (!(state.adminMode === true || state.teamMemberMode === true)) return;
        const b = document.createElement('button');
        b.id = 'compose-launcher';
        b.title = 'New email about what you’re looking at (Alt+E)';
        b.innerHTML = '<i data-lucide="mail" style="width:14px;height:14px;display:inline-block;vertical-align:middle;"></i>';
        b.style.cssText = 'position:fixed; left:18px; bottom:18px; z-index:590; width:44px; height:44px; border-radius:50%; border:1px solid var(--accent); background:var(--panel-dark, #111); font-size:18px; cursor:pointer; box-shadow:0 6px 18px rgba(0,0,0,0.35);';
        b.onclick = () => OL.openContextCompose();
        document.body.appendChild(b);
    };
    setTimeout(mount, 3000);
    setInterval(mount, 15000);
    document.addEventListener('keydown', (e) => {
        if (e.altKey && (e.key === 'e' || e.key === 'E' || e.code === 'KeyE')) { e.preventDefault(); OL.openContextCompose(); }
    });
})();

// ---- Open tasks for the recipient's project ----
// Once there's a recipient (or a project picked), the project's open tasks
// are listed with an "include" box; ticked ones go into the email as a
// Next steps list, grouped by who owns them.
OL._composeProjectId = function() {
    const st = OL._composeState || {};
    const picked = document.getElementById('compose-email-client')?.value;
    if (picked) return picked;
    if (st.linked_client_id) return st.linked_client_id;
    const r = OL.getRecipients('compose');
    const emails = (r.to + ',' + r.cc).toLowerCase().match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) || [];
    if (!emails.length) return '';
    const hit = Object.values(state.clients || {}).find(c => (c.projectData?.teamMembers || []).some(m => emails.includes(String(m.email || '').toLowerCase())));
    return hit?.id || '';
};

OL.renderComposeTaskPicker = function() {
    const box = document.getElementById('compose-task-picker');
    const st = OL._composeState;
    if (!box || !st) return;
    const clientId = OL._composeProjectId();
    const client = clientId ? state.clients?.[clientId] : null;
    if (!client?.projectData) { box.innerHTML = ''; return; }
    const closed = new Set((OL.getSystemStatuses ? OL.getSystemStatuses() : []).filter(x => x.isClosed).map(x => x.name).concat(['Done']));
    const today = OL.localDateStr();
    const open = (client.projectData.clientTasks || []).filter(t => t && !closed.has(t.status) && !t.meetingSummaryEventId);
    const isClient = (t) => t.isClientTask || (OL.computeIsClientTask && OL.computeIsClientTask(t.assignee));
    open.sort((a, b) => isClient(b) - isClient(a) || String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999')));
    const inc = new Set(st.includedTaskIds.map(String));
    const q = String(st.taskFilter || '').toLowerCase();
    const shown = open.filter(t => !q || `${t.title || t.name} ${t.assignee || ''}`.toLowerCase().includes(q));
    box.innerHTML = open.length ? `
        <details ${inc.size ? 'open' : ''} style="padding:8px 10px; border:1px solid var(--line); border-radius:6px;">
            <summary class="tiny bold" style="cursor:pointer;">Open tasks for ${esc(client.meta?.name || 'this project')} (${open.length})${inc.size ? ` · ${inc.size} included` : ''}</summary>
            <div class="tiny muted" style="margin:6px 0;">Tick any to list them in the email as next steps / reminders.</div>
            <input type="text" class="modal-input tiny" placeholder="Filter…" value="${esc(st.taskFilter || '')}" style="width:100%; margin-bottom:6px;"
                   oninput="const v=this.value; OL.reRenderPreservingFocus(() => { OL._composeState.taskFilter = v; OL.renderComposeTaskPicker(); })">
            <div style="max-height:200px; overflow:auto; display:grid; gap:2px;">
                ${shown.map(t => {
                    const due = t.dueDate ? OL.localDayKey(t.dueDate) : '';
                    const overdue = due && due < today;
                    return `<label class="tiny" style="display:flex; gap:6px; align-items:flex-start; padding:3px 2px; cursor:pointer;">
                        <input type="checkbox" ${inc.has(String(t.id)) ? 'checked' : ''} onchange="OL.toggleComposeTask('${esc(String(t.id))}', this.checked)">
                        <span style="flex:1;">${esc(t.title || t.name)} <span class="muted">· ${esc(t.assignee || 'Unassigned')}${due ? ` · <span style="${overdue ? 'color:#ef4444; font-weight:700;' : ''}">${overdue ? 'overdue ' : 'due '}${esc(OL.formatDayKey(due, { month: 'short', day: 'numeric' }))}</span>` : ''}</span></span>
                    </label>`;
                }).join('') || '<span class="tiny muted">No matches.</span>'}
            </div>
        </details>` : '';
    OL._composeTaskClientId = clientId;
};

OL.toggleComposeTask = function(taskId, on) {
    const st = OL._composeState;
    if (!st) return;
    st.includedTaskIds = st.includedTaskIds.filter(id => String(id) !== String(taskId));
    if (on) st.includedTaskIds.push(taskId);
    const sum = document.querySelector('#compose-task-picker summary');
    if (sum) sum.innerHTML = sum.innerHTML.replace(/ · \d+ included$/, '') + (st.includedTaskIds.length ? ` · ${st.includedTaskIds.length} included` : '');
};

OL._composeTaskListHtml = function() {
    const st = OL._composeState || {};
    const client = state.clients?.[OL._composeTaskClientId || OL._composeProjectId()];
    if (!client || !st.includedTaskIds?.length) return { html: '', text: '' };
    const tasks = st.includedTaskIds.map(id => (client.projectData?.clientTasks || []).find(t => String(t.id) === String(id))).filter(Boolean);
    const isClient = (t) => t.isClientTask || (OL.computeIsClientTask && OL.computeIsClientTask(t.assignee));
    const line = (t) => {
        const names = (OL.getTaskAssignees ? OL.getTaskAssignees(t) : [t.assignee]).filter(n => n && !['Sphynx Task', 'Client Task'].includes(n));
        const who = names.length ? ` (${names.join(', ')})` : '';
        const due = t.dueDate && !(OL.taskIsClientOwned && OL.taskIsClientOwned(t, client)) ? `, due ${OL.formatDayKey(OL.localDayKey(t.dueDate), { month: 'short', day: 'numeric' })}` : '';
        return `${t.title || t.name}${who}${due}`;
    };
    const groups = [['Sphynx', tasks.filter(t => !isClient(t))], [client.meta?.name || 'Your team', tasks.filter(isClient)]].filter(([, l]) => l.length);
    return {
        html: `<p style="margin-top:12px;"><strong>Next steps</strong></p>${groups.map(([g, l]) => `<p style="margin:6px 0 2px;"><em>${esc(g)}</em></p><ul>${l.map(t => `<li>${esc(line(t))}</li>`).join('')}</ul>`).join('')}`,
        text: '\n\nNEXT STEPS\n' + groups.map(([g, l]) => `\n${g}\n${l.map(t => '• ' + line(t)).join('\n')}`).join('\n')
    };
};

// The signature (one per Sphynx team member) lives in features/business/compose-shared.js, shared by every email window.

// ---- Attachments ----
OL.COMPOSE_ALLOWED_TYPES = {
    pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
    txt: 'text/plain', csv: 'text/csv', doc: 'application/msword', xls: 'application/vnd.ms-excel',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
};
OL.addComposeAttachments = async function(fileList) {
    const st = OL._composeState;
    if (!st) return;
    for (const file of Array.from(fileList || [])) {
        if (st.attachments.length >= 5) { alert('At most 5 attachments.'); break; }
        const ext = (file.name.split('.').pop() || '').toLowerCase();
        const mimeType = OL.COMPOSE_ALLOWED_TYPES[ext];
        if (!mimeType) { alert(`${file.name}: that file type can't be attached. Share it as a project (Drive) file instead.`); continue; }
        if (file.size > 10 * 1024 * 1024) { alert(`${file.name} is over 10 MB.`); continue; }
        const total = st.attachments.reduce((n, a) => n + a.size, 0) + file.size;
        if (total > 15 * 1024 * 1024) { alert('Attachments can total at most 15 MB.'); break; }
        const contentBase64 = await new Promise((res, rej) => {
            const r = new FileReader();
            r.onload = () => res(String(r.result).split(',')[1] || '');
            r.onerror = () => rej(r.error);
            r.readAsDataURL(file);
        });
        st.attachments.push({ filename: file.name, mimeType, contentBase64, size: file.size });
    }
    OL.renderComposeAttachments();
};
OL.removeComposeAttachment = function(kind, idx) {
    const st = OL._composeState;
    if (!st) return;
    (kind === 'file' ? st.attachments : st.projectFiles).splice(idx, 1);
    OL.renderComposeAttachments();
};
OL.renderComposeAttachments = function() {
    const box = document.getElementById('compose-attachments-list');
    const st = OL._composeState;
    if (!box || !st) return;
    const chip = (label, sub, kind, i) => `<span class="pill tiny soft" style="display:inline-flex; align-items:center; gap:4px;">${label} <span class="muted" style="font-size:9px;">${sub}</span><button type="button" class="btn tiny ghost" style="padding:0 3px;" onclick="OL.removeComposeAttachment('${kind}', ${i})">✕</button></span>`;
    box.innerHTML = [
        ...st.attachments.map((a, i) => chip(`${esc(a.filename)}`, `${Math.max(1, Math.round(a.size / 1024))} KB`, 'file', i)),
        ...st.projectFiles.map((f, i) => chip(`${esc(f.name)}`, f.library ? 'Library link' : 'Drive link', 'project', i))
    ].join('') || '<span class="tiny muted">None.</span>';
};
// Project (Drive) files from the linked task/request/resource and its
// rollup. Sent as links (with the file name) in the message rather than as
// copies, so the recipient always gets the current version.
OL.openComposeProjectFilePicker = function() {
    const st = OL._composeState;
    const box = document.getElementById('compose-project-file-picker');
    if (!st || !box) return;
    const clientId = st.linked_client_id || document.getElementById('compose-email-client')?.value || '';
    const client = state.clients?.[clientId];
    if (!client) { box.innerHTML = '<div class="tiny muted" style="margin-top:6px;">Pick a project first.</div>'; return; }
    const pdata = client.projectData || {};
    const files = [];
    const add = (f, from) => f?.url && !files.some(x => x.url === f.url) && files.push({ name: f.name || 'File', url: f.url, from });
    (pdata.clientTasks || []).forEach(t => (t.driveFiles || []).forEach(f => add(f, t.title || t.name || 'Task')));
    (OL.listProjectRequests ? OL.listProjectRequests(client) : []).forEach(r => (r.driveFiles || []).forEach(f => add(f, 'Request: ' + (r.name || ''))));
    (pdata.localResources || []).forEach(r => (r.files || []).forEach(f => add(f, 'Resource: ' + (r.name || ''))));
    // The linked task's own files first.
    files.sort((a, b) => {
        const t = (pdata.clientTasks || []).find(x => String(x.id) === String(st.linked_task_id));
        const inT = f => (t?.driveFiles || []).some(d => d.url === f.url) ? 0 : 1;
        return inT(a) - inT(b);
    });
    box.innerHTML = `
        <div style="margin-top:6px; max-height:180px; overflow:auto; display:grid; gap:3px; border-top:1px dashed var(--line); padding-top:6px;">
            ${files.length ? files.map((f, i) => `
                <label class="tiny" style="display:flex; align-items:center; gap:6px; cursor:pointer;">
                    <input type="checkbox" ${st.projectFiles.some(p => p.url === f.url) ? 'checked' : ''} onchange="OL.toggleComposeProjectFile(${i}, this.checked)">
                    <span style="flex:1;">${esc(f.name)}</span><span class="muted" style="font-size:9px;">${esc(f.from)}</span>
                </label>`).join('') : '<span class="tiny muted">No Drive files on this project yet.</span>'}
        </div>`;
    OL._composeProjectFileOptions = files;
};
// Master Library resources that may be linked from an email. Only the sections (resource types) chosen under
// Automations > Templates & settings > Email links are offered — not every resource is meant to be sent out, and the
// full list would be far too long. Each resource's document links go in as links (name + URL), the same as project
// files, so the recipient always gets the current version.
OL.openComposeLibraryPicker = function() {
    const st = OL._composeState;
    const box = document.getElementById('compose-project-file-picker');
    if (!st || !box) return;
    const types = getOlSettings().emailLinkableResourceTypes || [];
    if (!types.length) {
        box.innerHTML = '<div class="tiny muted" style="margin-top:6px;">No Master Library sections are set up for email linking yet. Choose them under Automations → Templates &amp; settings → Email links.</div>';
        return;
    }
    box.innerHTML = `
        <div style="margin-top:6px; border-top:1px dashed var(--line); padding-top:6px;">
            <div class="tiny bold" style="margin-bottom:4px;">Master Library <span class="muted" style="font-weight:normal;">— ${types.map(esc).join(', ')}</span></div>
            <input type="text" class="modal-input tiny" placeholder="Search these sections…" oninput="OL._renderComposeLibraryList(this.value)" style="margin-bottom:4px;">
            <div id="compose-library-list" style="max-height:220px; overflow:auto;"></div>
        </div>`;
    OL._renderComposeLibraryList('');
};
OL._renderComposeLibraryList = function(query) {
    const st = OL._composeState;
    const list = document.getElementById('compose-library-list');
    if (!st || !list) return;
    const types = getOlSettings().emailLinkableResourceTypes || [];
    const q = String(query || '').trim().toLowerCase();
    const eligible = (state.master?.functions || []).filter((r) => r && !r.isArchived && types.includes(r.type));
    const rows = [];
    let noLink = 0;
    eligible.forEach((r) => {
        const withUrl = (r.files || []).filter((f) => f && f.url);
        if (!withUrl.length) { noLink++; return; }
        withUrl.forEach((f) => rows.push({ name: f.name && f.name !== r.name ? `${r.name} — ${f.name}` : (r.name || 'Resource'), url: f.url, type: r.type }));
    });
    // Grouped by section (resource type), searched by name and section.
    const groups = groupResources(rows.map((r) => ({ ...r })), q);
    OL._composeLibraryOptions = flattenGroups(groups).slice(0, 200);
    const allowed = new Set(OL._composeLibraryOptions);
    const shownGroups = groups.map((g) => ({ label: g.label, items: g.items.filter((r) => allowed.has(r)) })).filter((g) => g.items.length);
    const total = flattenGroups(groups).length;
    list.innerHTML = groupsHtml(shownGroups, (r, i) => `
            <label class="tiny" style="display:flex; align-items:center; gap:6px; cursor:pointer;">
                <input type="checkbox" ${st.projectFiles.some((p) => p.url === r.url) ? 'checked' : ''} onchange="OL.toggleComposeLibraryLink(${i}, this.checked)">
                <span style="flex:1;">${esc(r.name)}</span>
            </label>`, { query: q, empty: 'Nothing matches.' })
        + (total > 200 ? `<div class="tiny muted">Showing the first 200 of ${total} — type to narrow.</div>` : '')
        + (noLink ? `<div class="tiny muted">${noLink} resource${noLink === 1 ? '' : 's'} in these sections ${noLink === 1 ? 'has' : 'have'} no document link yet.</div>` : '');
};
OL.toggleComposeLibraryLink = function(i, on) {
    const st = OL._composeState;
    const r = (OL._composeLibraryOptions || [])[i];
    if (!st || !r) return;
    st.projectFiles = st.projectFiles.filter((p) => p.url !== r.url);
    if (on) st.projectFiles.push({ name: r.name, url: r.url, library: true });
    OL.renderComposeAttachments();
};

OL.toggleComposeProjectFile = function(i, on) {
    const st = OL._composeState;
    const f = (OL._composeProjectFileOptions || [])[i];
    if (!st || !f) return;
    st.projectFiles = st.projectFiles.filter(p => p.url !== f.url);
    if (on) st.projectFiles.push({ name: f.name, url: f.url });
    OL.renderComposeAttachments();
};

// ---- Templates (workspace_masters.email_templates) ----
// Merge fields: {{client_name}} {{first_name}} {{my_name}} {{my_first_name}} {{today}}
OL._fillTemplateFields = function(text) {
    const st = OL._composeState || {};
    const client = state.clients?.[st.linked_client_id || document.getElementById('compose-email-client')?.value || ''];
    const toEmail = (OL.getRecipients('compose').toList[0] || '').trim().toLowerCase();
    const contact = (client?.projectData?.teamMembers || []).find(m => (m.email || '').toLowerCase() === toEmail);
    const me = OL.getCurrentUserName ? OL.getCurrentUserName() : '';
    const map = {
        client_name: client?.meta?.name || '',
        first_name: (contact?.name || '').split(' ')[0] || '',
        my_name: me, my_first_name: (me || '').split(' ')[0],
        today: new Date().toLocaleDateString([], { dateStyle: 'long' })
    };
    return String(text || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => (k in map ? esc(map[k]) : m));
};
OL.applyEmailTemplate = function(id) {
    const t = (state.master?.emailTemplates || []).find(x => x.id === id);
    if (!t) return;
    const ed = document.getElementById('compose-message');
    const subj = document.getElementById('compose-subject');
    if (subj && t.subject && !subj.value.trim()) subj.value = OL._fillTemplateFields(t.subject).replace(/&amp;/g, '&');
    if (ed) ed.innerHTML = OL._fillTemplateFields(OL.sanitizeCommentHtml(t.html || '', { images: true })) + (ed.innerHTML.trim() ? '<br>' + ed.innerHTML : '');
};
OL.saveComposeAsTemplate = function() {
    if (!state.masterHasEmailTemplates) { alert('Run the email_templates migration first — templates can’t be saved until that column exists.'); return; }
    const name = prompt('Template name:');
    if (!name) return;
    const html = OL.sanitizeCommentHtml(document.getElementById('compose-message')?.innerHTML || '', { images: true });
    const subject = document.getElementById('compose-subject')?.value || '';
    updateAndSync(() => {
        if (!state.master.emailTemplates) state.master.emailTemplates = [];
        state.master.emailTemplates.push({ id: 'et-' + Date.now(), name: name.trim(), subject, html, createdBy: OL.getCurrentUserName ? OL.getCurrentUserName() : '' });
    });
    alert(`Saved "${name.trim()}". Tip: use {{first_name}}, {{client_name}} or {{my_first_name}} in a template and they fill in automatically.`);
};
OL.openEmailTemplatesManager = function() {
    const box = document.getElementById('compose-project-file-picker');
    if (!box) return;
    const list = state.master?.emailTemplates || [];
    box.innerHTML = `
        <div style="margin-top:6px; border-top:1px dashed var(--line); padding-top:6px; display:grid; gap:4px;">
            <div class="tiny bold">Email templates</div>
            ${list.length ? list.map(t => `
                <div class="tiny" style="display:flex; align-items:center; gap:6px;">
                    <span style="flex:1;">${esc(t.name)}${t.subject ? ` <span class="muted">— ${esc(t.subject)}</span>` : ''}</span>
                    <button type="button" class="btn tiny soft" onclick="OL.renameEmailTemplate('${esc(t.id)}')">Rename</button>
                    <button type="button" class="btn tiny soft" style="color:#ef4444;" onclick="OL.deleteEmailTemplate('${esc(t.id)}')">Delete</button>
                </div>`).join('') : '<span class="tiny muted">None yet — write a message and click "Save as template".</span>'}
            <div class="tiny muted">Merge fields: {{first_name}} {{client_name}} {{my_name}} {{my_first_name}} {{today}}</div>
        </div>`;
};
OL.renameEmailTemplate = function(id) {
    const t = (state.master?.emailTemplates || []).find(x => x.id === id);
    const name = t && prompt('New name:', t.name);
    if (!name) return;
    updateAndSync(() => { t.name = name.trim(); });
    OL.openEmailTemplatesManager();
};
OL.deleteEmailTemplate = function(id) {
    if (!confirm('Delete this template?')) return;
    updateAndSync(() => { state.master.emailTemplates = (state.master.emailTemplates || []).filter(x => x.id !== id); });
    OL.openEmailTemplatesManager();
};

// Final HTML + plain text for sending: message, project-file links,
// signature, then the quoted original (Gmail collapses it as usual).
OL._buildComposeBody = function() {
    const st = OL._composeState || {};
    const msgHtml = OL.sanitizeCommentHtml(document.getElementById('compose-message')?.innerHTML || '', { images: true });
    const taskList = OL._composeTaskListHtml();
    const files = st.projectFiles?.length;
    const built = OL.assembleEmail({
        messageHtml: msgHtml,
        sectionsHtml: taskList.html, sectionsText: taskList.text.trim(),
        extraHtml: files ? `<p style="margin-top:12px;"><strong>Files:</strong><br>${st.projectFiles.map(f => `<a href="${esc(f.url)}">${esc(f.name)}</a>`).join('<br>')}</p>` : '',
        extraText: files ? 'Files:\n' + st.projectFiles.map(f => `- ${f.name}: ${f.url}`).join('\n') : '',
        signature: OL.signatureParts(OL.signatureIncluded('compose')),
        quotedHtml: (st.includeQuoted && (st.quoted || st.quotedHtml))
            ? `<br><div class="gmail_quote">${st.quotedMeta ? `<div>${esc(st.quotedMeta)}</div>` : ''}<blockquote class="gmail_quote" style="margin:0 0 0 .8ex; border-left:1px solid #ccc; padding-left:1ex;">${st.quotedHtml ? OL.sanitizeCommentHtml(st.quotedHtml) : OL.plainTextToHtml(st.quoted)}</blockquote></div>` : '',
        quotedText: (st.includeQuoted && st.quoted) ? `${st.quotedMeta || ''}\n` + String(st.quoted).split('\n').map(l => '> ' + l).join('\n') : '',
    }, { gap: '' });   // the task list and file block carry their own spacing
    return { html: built.html, text: built.text, messageText: built.messageText };
};

// The send function only accepts signed-in Sphynx admins and team members, so every call
// carries the current login token. Without a session this returns nothing, and the function
// answers 401.
OL.getAuthHeaders = async function() {
    try {
        const { data } = await db.auth.getSession();
        const token = data?.session?.access_token;
        return token ? { Authorization: `Bearer ${token}` } : {};
    } catch (err) {
        console.warn('Could not read the login session:', err?.message || err);
        return {};
    }
};
window.OL.getAuthHeaders = OL.getAuthHeaders;

// What to tell the person when the send function refuses them (not a Gmail problem).
OL.sendAuthErrorMessage = function(result) {
    if (result && result.error === 'forbidden') {
        return result.message || 'Your account is not set up to send email from this app.';
    }
    return 'Your sign-in has expired or is missing. Refresh the page and sign in again, then retry.';
};
window.OL.sendAuthErrorMessage = OL.sendAuthErrorMessage;

// True when a backend function refused the caller (not signed in, or not allowed), as opposed to a
// Google or Zoom problem. Returns the function's answer in that case, otherwise null. It reads a
// copy, so the response can still be read normally afterwards.
OL.functionRefusal = async function(response) {
    if (!response || response.ok || (response.status !== 401 && response.status !== 403)) return null;
    const result = await response.clone().json().catch(() => ({}));
    return (result.error === 'unauthorized' || result.error === 'forbidden') ? result : null;
};
window.OL.functionRefusal = OL.functionRefusal;

// Archive, restore and delete change Gmail as well as the app, best-effort: the in-app change stands
// either way. This says so when Gmail was NOT updated, and why (verb: 'Archived', 'Restored', 'Deleted').
// A missing Google permission is shown once per page load, since every later action would say the same.
OL.handleGmailActionResponse = async function(res, verb) {
    if (!res || res.ok) return;
    const result = await res.clone().json().catch(() => ({}));
    if (result.error === 'unauthorized' || result.error === 'forbidden') {
        alert(verb + ' here, but not in Gmail. ' + OL.sendAuthErrorMessage(result));
        return;
    }
    if (result.error === 'insufficient_scope') {
        if (!OL._gmailScopeWarned) {
            OL._gmailScopeWarned = true;
            alert(verb + ' here, but not in Gmail. ' + (result.message || 'Reconnect the Google account to grant permission.'));
        } else {
            console.warn('Not updated in Gmail: Google permission missing. Reconnect the Google account.');
        }
        return;
    }
    console.warn('Could not update Gmail (still done in-app): ' + (result.message || ('HTTP ' + res.status)));
};
window.OL.handleGmailActionResponse = OL.handleGmailActionResponse;

// The send function reports how it actually sent the email. If formatting was
// written but the server says (or, being an older version, doesn't say) it went
// out as HTML, the person is told instead of finding out from the recipient.
OL._warnIfSentAsPlainText = function(result, hadHtml) {
    if (!hadHtml || result?.format === 'html') return;
    alert('Sent, but as PLAIN TEXT: the email server function is an older version that drops formatting, colors and images.\n\nRedeploy the send-gmail-message function (GitHub Actions → "Deploy Supabase Edge Functions", or Supabase → Edge Functions), then formatted emails will go out correctly.');
};

// Sends one email through the app's Gmail send function. Used by windows that build their own
// email (like the meeting summary). Returns { ok, result }; shows the same error alerts as
// the compose window. payload: { to, cc, subject, body, linked_client_id, linked_event_id, linked_task_id, ... }
OL.sendGmailMessage = async function(payload) {
    try {
        const response = await fetch('https://kexnnpwjerrnsmifauuo.supabase.co/functions/v1/send-gmail-message', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(await OL.getAuthHeaders()) },
            body: JSON.stringify(payload)
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            if (result.error === 'unauthorized' || result.error === 'forbidden') {
                alert(OL.sendAuthErrorMessage(result));
            } else if (response.status === 401 || result.error === 'reauth_required') {
                alert('The connected Gmail account needs to be reconnected before sending will work — click "Connect Google Account" again to grant send permission, then retry.');
            } else {
                alert(result.message || 'Failed to send email.');
            }
            return { ok: false, result };
        }
        OL._warnIfSentAsPlainText(result, !!payload?.bodyHtml);
        return { ok: true, result };
    } catch (err) {
        console.error('Failed to send email:', err);
        alert('Failed to send email — see console for details.');
        return { ok: false, result: null };
    }
};
window.OL.sendGmailMessage = OL.sendGmailMessage;

OL.sendComposedEmail = async function() {
    const st = OL._composeState || {};
    OL.commitRecipients('compose');
    const r = OL.getRecipients('compose');
    const subject = (document.getElementById('compose-subject')?.value || '').trim();
    const built = OL._buildComposeBody();
    const clientSelect = document.getElementById('compose-email-client');
    const linkedClientId = clientSelect ? clientSelect.value : st.linked_client_id;

    if (!r.to || !subject || !built.messageText.trim()) {
        alert('To, subject, and message are all required.');
        return;
    }
    const { ok, result } = await OL.sendCompose('compose', { to: r.to, cc: r.cc, bcc: r.bcc, subject, body: built.text, bodyHtml: built.html }, {
        attachments: (st.attachments || []).map(a => ({ filename: a.filename, mimeType: a.mimeType, contentBase64: a.contentBase64 })),
        threadId: st.threadId || undefined,
        replyToMessageId: st.replyToMessageId || undefined,
        linked_client_id: linkedClientId || st.linked_client_id || null,
        linked_resource_id: st.linked_resource_id || null,
        linked_task_id: st.linked_task_id || null,
        linked_event_id: st.linked_event_id || null,
        linked_request_id: st.linked_request_id || null
    });
    if (!ok) return;
    OL.closeCompose();
    if (typeof st.onSent === 'function') st.onSent(result);
};

// Reply, from an open email's own modal.
OL.openReplyToGmailMessage = async function(messageId, replyAll = false) {
    const { data: m, error } = await db.from('gmail_messages').select('*').eq('id', messageId).single();
    if (error || !m) { alert('Could not load that email.'); return; }

    const parsed = OL._parseSenderHeader(m.sender);
    const replyTo = parsed?.email || m.sender || '';
    const subject = /^re:/i.test(m.subject || '') ? m.subject : `Re: ${m.subject || ''}`;
    // Only the message being replied to, never the earlier emails it carries below its own text.
    // (A plain-text body with "Name <a@b.com>" in it is not HTML, even though it contains angle brackets.)
    const rawBody = String(m.body || '');
    const bodyIsHtml = !!m.body_html || /<(div|p|br|span|table|blockquote|html|body|a\s|b>|i>|ul|ol)\b/i.test(rawBody);
    const quoted = (bodyIsHtml ? OL._latestPlain(m, false).text : OL._splitQuotedText(rawBody).latest)
        || OL._stripHtmlForPreview(m.body) || m.snippet || '';
    const quotedHtmlLatest = m.body_html ? OL._splitQuotedHtml(m.body_html).latest : null;

    let cc = '';
    if (replyAll) {
        const myEmail = (state.master?.communications?.gmail?.email || '').toLowerCase();
        const extractEmails = (header) => (header || '').match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) || [];
        cc = [...extractEmails(m.recipient_to), ...extractEmails(m.recipient_cc)]
            .map(e => e.toLowerCase())
            .filter((e, i, arr) => arr.indexOf(e) === i) // dedupe
            .filter(e => e !== replyTo.toLowerCase() && e !== myEmail) // drop the person we're already replying to directly, and ourselves
            .join(', ');
    }

    OL.openComposeEmailModal({
        to: replyTo,
        cc,
        subject,
        threadId: m.thread_id,
        replyToMessageId: m.id,
        quoted,
        quotedHtml: quotedHtmlLatest,
        quotedMeta: `On ${m.date ? new Date(m.date).toLocaleString() : 'an earlier date'}, ${m.sender || 'the sender'} wrote:`,
        linked_request_id: m.linked_request_id,
        linked_client_id: m.linked_client_id,
        linked_resource_id: m.linked_resource_id,
        linked_task_id: m.linked_task_id,
        linked_event_id: m.linked_event_id,
        onSent: () => {
            // Land back on the thread so the sent reply is visible.
            OL.openGmailMessageModal(m.id);
        }
    });
};
window.OL.openReplyToGmailMessage = OL.openReplyToGmailMessage;

// Quick "email this contact" from a client's Team tab (or anywhere else
// that already knows a person's email and, optionally, which project
// they're on).
OL.quickEmailContact = function(email, clientId) {
    OL.openComposeEmailModal({
        to: email,
        linked_client_id: clientId || null,
        onSent: () => {
            if (typeof OL.renderTeamManager === 'function') OL.renderTeamManager();
        }
    });
};
window.OL.quickEmailContact = OL.quickEmailContact;

// -------------------------------------------------------------
// LINK TO PROJECT / RESOURCE / TASK — three independent selections,
// rendered inline in the email modal above (not a separate modal).
// Picking a Resource or a Task (searchable across all clients if no
// project is chosen yet) auto-fills the Project. Picking a Task also
// auto-fills Resource by matching the task's resourceName against that
// project's resource list. Picking Project alone doesn't touch the other
// two. Changing Project clears Resource/Task (they belong to whichever
// project was previously selected).
// -------------------------------------------------------------
// Helper to parse dates safely for sorting by recent activity
function getRecencyTimestamp(item) {
    const d = item.updatedAt || item.updated_at || item.createdDate || item.createdAt || item.created_at;
    return d ? new Date(d).getTime() : 0;
}

// ---- Resources ----
OL._allClientResourcesFlat = function() {
    const st = OL._gmailLinkState || {};
    return Object.values(state.clients || {}).flatMap(c =>
        (c.projectData?.localResources || [])
            // Filter out system/admin pinned reference resources
            .filter(r => !r.systemPinned && !r.adminPinned)
            // Filter out archived resources unless explicitly toggled on
            .filter(r => st.showArchived || !(r.isArchived || r.archived))
            .map(r => ({ ...r, _clientId: c.id, _clientName: c.meta?.name || 'Unnamed' }))
    ).sort((a, b) => getRecencyTimestamp(b) - getRecencyTimestamp(a));
};

// ---- Tasks ----
OL._allClientTasksFlat = function() {
    const st = OL._gmailLinkState || {};
    return Object.values(state.clients || {}).flatMap(c =>
        (c.projectData?.clientTasks || [])
            .filter(t => st.showCompletedTasks || (t.status !== 'Done' && t.status !== 'Completed' && !t.completed))
            .map(t => ({ ...t, _clientId: c.id, _clientName: c.meta?.name || 'Unnamed' }))
    ).sort((a, b) => getRecencyTimestamp(b) - getRecencyTimestamp(a));
};

// ---- Requests ----
OL._allClientRequestsFlat = function() {
    const st = OL._gmailLinkState || {};
    return Object.values(state.clients || {}).flatMap(c => {
        const sheet = c.projectData?.scopingSheets?.[0];
        const items = sheet?.lineItems || [];
        return items
            .filter(i => (i.isRequest || i.type === 'request' || i.requestType))
            .filter(i => st.showClosedRequests || (i.status !== 'Done' && i.status !== "Don't Do"))
            .map(r => ({ ...r, _clientId: c.id, _clientName: c.meta?.name || 'Unnamed' }));
    }).sort((a, b) => getRecencyTimestamp(b) - getRecencyTimestamp(a));
};

// Best-effort match of a task's resourceName against a project's actual
// resource list — same convention OL.getDashboardMasterTasks/tasks.js
// already use for resourceName (a free-text label, not a foreign key).
OL._findResourceForTask = function(clientId, task) {
    const label = (task?.resourceName || task?.category || '').trim().toLowerCase();
    if (!label) return null;
    const client = state.clients?.[clientId];
    const resources = client?.projectData?.localResources || [];
    return resources.find(r => (r.name || '').trim().toLowerCase() === label) || null;
};

// Compact, always-visible readout of the current link state (chips for
// whatever's linked, or "Not linked yet") plus a single button. All the
// actual picking happens in the modal opened by OL.openGmailLinkModal —
// this just reflects the result, same as a resolved suggestion would.
OL.renderGmailLinkSummary = function() {
    const st = OL._gmailLinkState;
    const container = document.getElementById('gmail-link-summary');
    if (!container || !st) return;

    const client = st.clientId ? state.clients[st.clientId] : null;
    const resource = st.resourceId
        ? (client?.projectData?.localResources || []).find(r => r.id === st.resourceId) || OL._allClientResourcesFlat().find(r => r.id === st.resourceId)
        : null;
    const task = st.taskId
        ? (client?.projectData?.clientTasks || []).find(t => t.id === st.taskId) || OL._allClientTasksFlat().find(t => t.id === st.taskId)
        : null;
    const request = st.requestId
        ? (client?.projectData?.scopingSheets?.[0]?.lineItems || []).find(r => String(r.id) === String(st.requestId)) || OL._allClientRequestsFlat().find(r => String(r.id) === String(st.requestId))
        : null;
    const event = st.eventId ? OL._gmailLinkSelectedEvent : null;

    const chips = [
        client ? `Project: ${client.meta?.name || 'Unnamed'}` : '',
        resource ? `Resource: ${resource.name}` : '',
        task ? `Task: ${task.title || task.name}` : '',
        request ? `Request: ${request.name || request.title}` : '',
        event ? `Event: ${event.title}` : ''
    ].filter(Boolean);   // plain text; escaped once when drawn below

    // A link icon, then this email's links as pills. Clicking any pill (or "+ Link" when there are none) opens the editor.
    const pillHtml = (text) => `<span class="pill tiny soft" role="button" tabindex="0" style="cursor:pointer;" title="Click to edit this email's link" onclick="OL.openGmailLinkModal()" onkeydown="if(event.key==='Enter') OL.openGmailLinkModal()">${esc(text)}</span>`;
    container.innerHTML = `
        <i data-lucide="link" style="width:14px;height:14px;flex-shrink:0;opacity:0.8;" aria-label="Linked to"></i>
        ${chips.length
            ? chips.map(pillHtml).join('')
            : `<span class="pill tiny soft" role="button" tabindex="0" style="cursor:pointer;" onclick="OL.openGmailLinkModal()" onkeydown="if(event.key==='Enter') OL.openGmailLinkModal()">Not linked yet · + Link</span>`}
    `;
    if (window.lucide) lucide.createIcons();
};

// Opens the full picker as a modal overlay on top of the email modal — the
// same OL.showOverlayModal pattern a suggestion's "Choose target..." uses
// (see OL.openExcerptLinkPicker). The ✕ closes everything and reopens the
// email modal fresh, matching that picker's Cancel behavior.
OL.openGmailLinkModal = function() {
    const st = OL._gmailLinkState;
    if (!st) return;
    const content = `
        <div style="padding:24px 36px 24px 24px; box-sizing:border-box; max-width:900px; width:90vw;" onclick="event.stopPropagation()">
            <div class="modal-header" style="display:flex; justify-content:space-between; align-items:flex-start; border-bottom:1px solid var(--line); padding-bottom:10px; margin-bottom:14px;">
                <h3 style="margin:0; font-size:15px;"><i data-lucide="link" style="width:14px;height:14px;vertical-align:sub;"></i> Link to Project / Resource / Task / Event</h3>
                <button class="btn tiny soft" onclick="OL.closeModal(); OL.openGmailMessageModal('${st.emailId}')">✕</button>
            </div>
            <div id="gmail-link-body"></div>
        </div>
    `;
    OL.showOverlayModal(content);
    OL.renderGmailLinkStep();
};

OL.renderGmailLinkStep = function() {
    const st = OL._gmailLinkState;
    const container = document.getElementById('gmail-link-body');
    if (!container || !st) return;

    const selectedClient = st.clientId ? state.clients[st.clientId] : null;

    // ---- Project ----
    const clientQuery = (st.clientQuery || '').trim().toLowerCase();
    const clients = Object.values(state.clients || {});
    const filteredClients = clientQuery
        ? clients.filter(c => (c.meta?.name || '').toLowerCase().includes(clientQuery))
        : clients;

    // ---- Resources (Filtered to exclude References + Sorted) ----
    const resourceQuery = (st.resourceQuery || '').trim().toLowerCase();
    let resourcePool = selectedClient
        ? (selectedClient.projectData?.localResources || [])
            .filter(r => !r.systemPinned && !r.adminPinned)
            .filter(r => st.showArchived || !(r.isArchived || r.archived))
            .map(r => ({ ...r, _clientId: st.clientId, _clientName: selectedClient.meta?.name }))
        : OL._allClientResourcesFlat();
    
    resourcePool.sort((a, b) => getRecencyTimestamp(b) - getRecencyTimestamp(a));

    // Grouped by type; the search looks at name, type, description and (across all projects) the project name. Within a
    // group the most recently touched come first.
    const resourceGroups = groupResources(resourcePool, resourceQuery, { extra: (r) => r._clientName, keepOrder: true });
    const filteredResources = flattenGroups(resourceGroups);

    const selectedResource = st.resourceId
        ? (selectedClient?.projectData?.localResources || []).find(r => r.id === st.resourceId)
            || OL._allClientResourcesFlat().find(r => r.id === st.resourceId)
        : null;

    // ---- Tasks (Filtered + Sorted) ----
    const taskQuery = (st.taskQuery || '').trim().toLowerCase();
    let taskPool = selectedClient
        ? (selectedClient.projectData?.clientTasks || [])
            .filter(t => st.showCompletedTasks || (t.status !== 'Done' && t.status !== 'Completed' && !t.completed))
            .map(t => ({ ...t, _clientId: st.clientId, _clientName: selectedClient.meta?.name }))
        : OL._allClientTasksFlat();

    taskPool.sort((a, b) => getRecencyTimestamp(b) - getRecencyTimestamp(a));

    const filteredTasks = taskQuery
        ? taskPool.filter(t => (t.title || t.name || '').toLowerCase().includes(taskQuery))
        : taskPool;

    const selectedTask = st.taskId
        ? (selectedClient?.projectData?.clientTasks || []).find(t => t.id === st.taskId)
            || OL._allClientTasksFlat().find(t => t.id === st.taskId)
        : null;

    // ---- Requests (Filtered + Sorted) ----
    const requestQuery = (st.requestQuery || '').trim().toLowerCase();
    let requestPool = selectedClient
        ? (selectedClient.projectData?.scopingSheets?.[0]?.lineItems || [])
            .filter(i => (i.isRequest || i.type === 'request' || i.requestType))
            .filter(i => st.showClosedRequests || (i.status !== 'Done' && i.status !== "Don't Do"))
            .map(r => ({ ...r, _clientId: st.clientId, _clientName: selectedClient.meta?.name }))
        : OL._allClientRequestsFlat();

    requestPool.sort((a, b) => getRecencyTimestamp(b) - getRecencyTimestamp(a));

    const filteredRequests = requestQuery
        ? requestPool.filter(r => (r.name || r.title || '').toLowerCase().includes(requestQuery))
        : requestPool;

    const selectedRequest = st.requestId
        ? (selectedClient?.projectData?.scopingSheets?.[0]?.lineItems || []).find(r => String(r.id) === String(st.requestId))
            || OL._allClientRequestsFlat().find(r => String(r.id) === String(st.requestId))
        : null;

    // ---- Events (-7 days to +7 days filter) ----
    const now = new Date();
    const past7Days = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
    const future7Days = new Date(now.getTime() + (7 * 24 * 60 * 60 * 1000));

    const eventQuery = (st.eventQuery || '').trim().toLowerCase();
    const eventPool = (st.eventResults || []).filter(e => {
        if (!e.start) return true;
        const eDate = new Date(e.start);
        return eDate >= past7Days && eDate <= future7Days;
    });

    const selectedEvent = st.eventId ? OL._gmailLinkSelectedEvent : null;
    // Clearing every selection on an already-linked email and saving is a
    // valid edit (= unlink), so Save stays enabled for it.
    const canLink = !!(st.clientId || st.resourceId || st.taskId || st.requestId || st.eventId || st.hadLinks);

    container.innerHTML = `
        <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:20px 20px; margin-bottom:16px;">
        <!-- Project Section -->
        <div>
            <label class="tiny muted bold" style="display:block; margin-bottom:4px;">Project</label>
            ${selectedClient ? `
                <div style="display:flex; align-items:center; justify-content:space-between; padding:8px 10px; background:rgba(var(--accent-rgb), 0.06); border:1px solid var(--accent); border-radius:6px;">
                    <span class="tiny bold">${esc(selectedClient.meta?.name || 'Unnamed')}</span>
                    <button class="btn tiny soft" onclick="OL.setGmailLinkClient('')">Change</button>
                </div>
            ` : `
                <input type="text" id="gmail-link-client-search" class="modal-input tiny" placeholder="Search projects..." value="${esc(st.clientQuery || '')}"
                       onfocus="OL.setGmailLinkFocus('clientFocused', true)" oninput="OL.setGmailLinkClientQuery(this.value)">
                ${st.clientFocused ? `
                    <div style="max-height:240px; overflow:auto; margin-top:6px; display:grid; gap:4px;">
                        ${filteredClients.length ? filteredClients.map(c => `
                            <div class="tiny" style="padding:7px 10px; border:1px solid var(--line); border-radius:6px; cursor:pointer;" onmousedown="OL.setGmailLinkClient('${c.id}')">${esc(c.meta?.name || 'Unnamed')}</div>
                        `).join('') : `<div class="tiny muted" style="padding:8px;">No matching projects.</div>`}
                    </div>
                ` : ''}
            `}
        </div>

        <!-- Resource Section -->
        <div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                <label class="tiny muted bold">Resource / Deliverable</label>
                <button class="btn tiny ghost" style="font-size:9px; padding:0 4px;" onclick="OL._gmailLinkState.showArchived = !OL._gmailLinkState.showArchived; OL.renderGmailLinkStep();">
                    ${st.showArchived ? 'Hide Archived' : 'Show Archived'}
                </button>
            </div>
            ${selectedResource ? `
                <div style="display:flex; align-items:center; justify-content:space-between; padding:8px 10px; background:rgba(var(--accent-rgb), 0.06); border:1px solid var(--accent); border-radius:6px;">
                    <span class="tiny bold">${esc(selectedResource.name)}${!selectedClient ? ` <span class="pill tiny soft" style="font-size:9px;">${esc(selectedResource._clientName || '')}</span>` : ''}</span>
                    <button class="btn tiny soft" onclick="OL.setGmailLinkResource('')">Change</button>
                </div>
            ` : `
                <input type="text" id="gmail-link-resource-search" class="modal-input tiny" placeholder="Search resources...${selectedClient ? '' : ' (all projects)'}" value="${esc(st.resourceQuery || '')}"
                       onfocus="OL.setGmailLinkFocus('resourceFocused', true)" oninput="OL.setGmailLinkResourceQuery(this.value)">
                ${st.resourceFocused ? `
                    <div style="max-height:260px; overflow:auto; margin-top:6px;">
                        ${groupsHtml(resourceGroups, (r) => `
                            <div class="tiny" style="padding:7px 10px; border:1px solid var(--line); border-radius:6px; cursor:pointer; display:flex; justify-content:space-between; gap:8px;" onmousedown="OL.setGmailLinkResource('${r.id}', '${r._clientId}')">
                                <span>${esc(r.name)}${(r.isArchived || r.archived) ? `<span class="pill tiny danger">Archived</span>` : ''}</span>
                                ${!selectedClient ? `<span class="pill tiny soft" style="font-size:9px; flex-shrink:0;">${esc(r._clientName || '')}</span>` : ''}
                            </div>`, { query: resourceQuery })}
                    </div>
                ` : ''}
            `}
        </div>

        <!-- Task Section -->
        <div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                <label class="tiny muted bold">Task</label>
                <button class="btn tiny ghost" style="font-size:9px; padding:0 4px;" onclick="OL._gmailLinkState.showCompletedTasks = !OL._gmailLinkState.showCompletedTasks; OL.renderGmailLinkStep();">
                    ${st.showCompletedTasks ? 'Hide Completed' : 'Show Completed'}
                </button>
            </div>
            ${selectedTask ? `
                <div style="display:flex; align-items:center; justify-content:space-between; padding:8px 10px; background:rgba(var(--accent-rgb), 0.06); border:1px solid var(--accent); border-radius:6px;">
                    <span class="tiny bold">${esc(selectedTask.title || selectedTask.name)}${!selectedClient ? ` <span class="pill tiny soft" style="font-size:9px;">${esc(selectedTask._clientName || '')}</span>` : ''}</span>
                    <button class="btn tiny soft" onclick="OL.setGmailLinkTask('')">Change</button>
                </div>
            ` : `
                <input type="text" id="gmail-link-task-search" class="modal-input tiny" placeholder="Search tasks...${selectedClient ? '' : ' (all projects)'}" value="${esc(st.taskQuery || '')}"
                       onfocus="OL.setGmailLinkFocus('taskFocused', true)" oninput="OL.setGmailLinkTaskQuery(this.value)">
                ${st.taskFocused ? `
                    <div style="max-height:240px; overflow:auto; margin-top:6px; display:grid; gap:4px;">
                        ${filteredTasks.length ? filteredTasks.map(t => `
                            <div class="tiny" style="padding:7px 10px; border:1px solid var(--line); border-radius:6px; cursor:pointer; display:flex; justify-content:space-between; gap:8px;" onmousedown="OL.setGmailLinkTask('${t.id}', '${t._clientId}')">
                                <span>${esc(t.title || t.name)}${(t.status === 'Done' || t.status === 'Completed' || t.completed) ? `<span class="pill tiny">Done</span>` : ''}</span>
                                ${!selectedClient ? `<span class="pill tiny soft" style="font-size:9px; flex-shrink:0;">${esc(t._clientName || '')}</span>` : ''}
                            </div>
                        `).join('') : `<div class="tiny muted" style="padding:8px;">No matching tasks.</div>`}
                    </div>
                ` : ''}
            `}
        </div>

        <!-- Request Section -->
        <div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                <label class="tiny muted bold">Request</label>
                <button class="btn tiny ghost" style="font-size:9px; padding:0 4px;" onclick="OL._gmailLinkState.showClosedRequests = !OL._gmailLinkState.showClosedRequests; OL.renderGmailLinkStep();">
                    ${st.showClosedRequests ? 'Hide Closed' : 'Show Closed'}
                </button>
            </div>
            ${selectedRequest ? `
                <div style="display:flex; align-items:center; justify-content:space-between; padding:8px 10px; background:rgba(var(--accent-rgb), 0.06); border:1px solid var(--accent); border-radius:6px;">
                    <span class="tiny bold">${esc(selectedRequest.name || selectedRequest.title)}${!selectedClient ? ` <span class="pill tiny soft" style="font-size:9px;">${esc(selectedRequest._clientName || '')}</span>` : ''}</span>
                    <button class="btn tiny soft" onclick="OL.setGmailLinkRequest('')">Change</button>
                </div>
            ` : `
                <input type="text" id="gmail-link-request-search" class="modal-input tiny" placeholder="Search requests...${selectedClient ? '' : ' (all projects)'}" value="${esc(st.requestQuery || '')}"
                       onfocus="OL.setGmailLinkFocus('requestFocused', true)" oninput="OL.setGmailLinkRequestQuery(this.value)">
                ${st.requestFocused ? `
                    <div style="max-height:240px; overflow:auto; margin-top:6px; display:grid; gap:4px;">
                        ${filteredRequests.length ? filteredRequests.map(r => `
                            <div class="tiny" style="padding:7px 10px; border:1px solid var(--line); border-radius:6px; cursor:pointer; display:flex; justify-content:space-between; gap:8px;" onmousedown="OL.setGmailLinkRequest('${r.id}', '${r._clientId}')">
                                <span>${esc(r.name || r.title)}${(r.status === 'Done' || r.status === "Don't Do") ? `<span class="pill tiny">${esc(r.status)}</span>` : ''}</span>
                                ${!selectedClient ? `<span class="pill tiny soft" style="font-size:9px; flex-shrink:0;">${esc(r._clientName || '')}</span>` : ''}
                            </div>
                        `).join('') : `<div class="tiny muted" style="padding:8px;">No matching requests.</div>`}
                    </div>
                ` : ''}
            `}
        </div>

        <!-- Events Section (Constrained to -7 to +7 days) -->
        <div>
            <label class="tiny muted bold" style="display:block; margin-bottom:4px;">Event (±7 Days)</label>
            ${selectedEvent ? `
                <div style="display:flex; align-items:center; justify-content:space-between; padding:8px 10px; background:rgba(var(--accent-rgb), 0.06); border:1px solid var(--accent); border-radius:6px;">
                    <span class="tiny bold">${esc(selectedEvent.title)}${selectedEvent.start ? ` <span class="tiny muted">· ${esc(new Date(selectedEvent.start).toLocaleDateString())}</span>` : ''}</span>
                    <button class="btn tiny soft" onclick="OL.setGmailLinkEvent('')">Change</button>
                </div>
            ` : `
                <input type="text" id="gmail-link-event-search" class="modal-input tiny" placeholder="Search calendar events..." value="${esc(st.eventQuery || '')}"
                       onfocus="OL.setGmailLinkFocus('eventFocused', true)" oninput="OL.setGmailLinkEventQuery(this.value)">
                ${st.eventFocused ? `
                    <div style="max-height:240px; overflow:auto; margin-top:6px; display:grid; gap:4px;">
                        ${eventPool.length ? eventPool.map(e => `
                            <div class="tiny" style="padding:7px 10px; border:1px solid var(--line); border-radius:6px; cursor:pointer;" onmousedown="OL.setGmailLinkEvent('${esc(e.id).replace(/'/g, "\\'")}')">
                                <div>${esc(e.title)}</div>${e.start ? `<div class="tiny muted" style="margin-top:1px;">${esc(new Date(e.start).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }))}</div>` : ''}
                            </div>
                        `).join('') : `<div class="tiny muted" style="padding:8px;">${(st.eventQuery || '').trim() ? 'No matching events in 14-day window.' : 'No meetings in the last/next 7 days — type to search.'}</div>`}
                    </div>
                ` : ''}
            `}
        </div>
        </div>

        <div style="display:flex; justify-content:flex-end; gap:10px;">
            ${(st.clientId || st.resourceId || st.taskId || st.requestId || st.eventId) ? `<button class="btn small danger" onclick="OL.unlinkGmailMessage()">Unlink</button>` : ''}
            <button class="btn small primary" onclick="OL.saveGmailLink()" style="font-weight:bold;" ${!canLink ? 'disabled' : ''}>Save Link</button>
        </div>
    `;
    if (window.lucide) lucide.createIcons();
};

// Shared by all four search boxes — flips the corresponding *Focused flag
// so its results list appears, without touching the query itself.
OL._GMAIL_LINK_DD_FLAGS = ['clientFocused', 'resourceFocused', 'taskFocused', 'requestFocused', 'eventFocused'];

// Opening one dropdown closes the others; the re-render keeps the cursor in
// the box you clicked (it used to drop focus, so the list flashed open but
// typing went nowhere).
OL.setGmailLinkFocus = function(flagName, value) {
    const st = OL._gmailLinkState;
    if (!st) return;
    const othersOpen = OL._GMAIL_LINK_DD_FLAGS.some(f => f !== flagName && st[f]);
    if (st[flagName] === value && !othersOpen) return; // already showing — don't re-render mid-keystroke
    OL._GMAIL_LINK_DD_FLAGS.forEach(f => { st[f] = false; });
    st[flagName] = value;
    OL.reRenderPreservingFocus(() => OL.renderGmailLinkStep());
    if (flagName === 'eventFocused' && value && !(st.eventQuery || '').trim()) OL._loadNearbyGmailLinkEvents();
};

// With nothing typed, the Event list shows this project's (or everyone's)
// meetings from a week either side, instead of "type to search".
OL._loadNearbyGmailLinkEvents = async function() {
    const st = OL._gmailLinkState;
    if (!st) return;
    const from = new Date(Date.now() - 7 * 86400000).toISOString();
    const to = new Date(Date.now() + 7 * 86400000).toISOString();
    let q = db.from('calendar_events').select('id, title, start, description').gte('start', from).lte('start', to).order('start', { ascending: false }).limit(30);
    if (st.clientId) q = q.eq('linked_client_id', st.clientId);
    const { data } = await q;
    if (OL._gmailLinkState !== st || (st.eventQuery || '').trim()) return;
    st.eventResults = data || [];
    OL.reRenderPreservingFocus(() => OL.renderGmailLinkStep());
};

// Click anywhere outside the link panel's boxes/lists closes its dropdowns.
document.addEventListener('mousedown', (e) => {
    const st = OL._gmailLinkState;
    if (!st || !OL._GMAIL_LINK_DD_FLAGS.some(f => st[f])) return;
    const t = e.target;
    if (!t || !document.body.contains(t)) return;               // a list item that just re-rendered
    const panel = document.getElementById('gmail-link-body');
    if (panel && panel.contains(t) && (t.closest('input') || t.closest('[onmousedown]'))) return;
    OL._GMAIL_LINK_DD_FLAGS.forEach(f => { st[f] = false; });
    if (panel) OL.renderGmailLinkStep();
});

OL.setGmailLinkClientQuery = function(value) {
    OL.reRenderPreservingFocus(() => {
        OL._gmailLinkState.clientQuery = value;
        OL._gmailLinkState.clientFocused = true;
        OL.renderGmailLinkStep();
    });
};

OL.setGmailLinkResourceQuery = function(value) {
    OL.reRenderPreservingFocus(() => {
        OL._gmailLinkState.resourceQuery = value;
        OL._gmailLinkState.resourceFocused = true;
        OL.renderGmailLinkStep();
    });
};

OL.setGmailLinkTaskQuery = function(value) {
    OL.reRenderPreservingFocus(() => {
        OL._gmailLinkState.taskQuery = value;
        OL._gmailLinkState.taskFocused = true;
        OL.renderGmailLinkStep();
    });
};

OL.setGmailLinkRequestQuery = function(q) {
    if (OL._gmailLinkState) {
        OL._gmailLinkState.requestQuery = q;
        OL.renderGmailLinkStep();
    }
};

OL.setGmailLinkRequest = function(requestId, clientId) {
    if (!OL._gmailLinkState) return;
    OL._gmailLinkState.requestId = requestId;
    if (clientId && !OL._gmailLinkState.clientId) {
        OL._gmailLinkState.clientId = clientId;
    }
    OL._gmailLinkState.requestFocused = false;
    OL.renderGmailLinkStep();
};

// Events aren't all loaded client-side (see OL.loadCalendarEvents — it's
// paginated/filtered), so this searches Supabase directly rather than
// filtering an in-memory pool like the other three. Debounced since it's
// a live query per keystroke otherwise.
OL.setGmailLinkEventQuery = function(value) {
    OL.reRenderPreservingFocus(() => {
        OL._gmailLinkState.eventQuery = value;
        OL._gmailLinkState.eventFocused = true;
        OL.renderGmailLinkStep();
    });

    clearTimeout(OL._gmailLinkEventSearchTimer);
    const q = (value || '').trim();
    if (!q) { OL._loadNearbyGmailLinkEvents(); return; }

    OL._gmailLinkEventSearchTimer = setTimeout(async () => {
        const { data, error } = await db.from('calendar_events')
            .select('id, title, start, description')
            .ilike('title', `%${q}%`)
            .order('start', { ascending: false })
            .limit(20);
        if (error) { console.error('Event search failed:', error.message); return; }
        // Query may have moved on while this was in flight — only apply if still current.
        if ((OL._gmailLinkState.eventQuery || '').trim() === q) {
            OL._gmailLinkState.eventResults = data || [];
            // This fires ~300ms after each keystroke, so if you keep typing
            // it lands WHILE the field still has focus. Unlike the render
            // right above (which reRenderPreservingFocus already wraps),
            // this one was calling renderGmailLinkStep() bare -- destroying
            // and recreating the input with no focus/cursor restore, which
            // is why typing into the event search felt like it kept
            // "unselecting" itself partway through.
            OL.reRenderPreservingFocus(() => OL.renderGmailLinkStep());
        }
    }, 300);
};

// Changing the project invalidates any resource/task picked under the
// previous one, so both get cleared.
OL.setGmailLinkClient = function(id) {
    OL._gmailLinkState.clientId = id;
    OL._gmailLinkState.clientFocused = false;
    OL._gmailLinkState.resourceId = '';
    OL._gmailLinkState.resourceQuery = '';
    OL._gmailLinkState.resourceFocused = false;
    OL._gmailLinkState.taskId = '';
    OL._gmailLinkState.taskQuery = '';
    OL._gmailLinkState.taskFocused = false;
    OL._gmailLinkState.requestId = '';
    OL._gmailLinkState.creatingTask = false;
    OL.renderGmailLinkStep();
};

// Picking a resource auto-fills Project if it wasn't already set —
// Task is left alone (a resource doesn't imply one specific task).
OL.setGmailLinkResource = function(id, clientId) {
    OL._gmailLinkState.resourceId = id;
    OL._gmailLinkState.resourceFocused = false;
    if (id && clientId && !OL._gmailLinkState.clientId) {
        OL._gmailLinkState.clientId = clientId;
    }
    OL.renderGmailLinkStep();
};

// Picking a task auto-fills Project (if unset) and Resource, by matching
// the task's resourceName against that project's resource list.
OL.setGmailLinkTask = function(id, clientId) {
    OL._gmailLinkState.taskId = id;
    OL._gmailLinkState.taskFocused = false;
    if (!id) { OL.renderGmailLinkStep(); return; }

    const resolvedClientId = OL._gmailLinkState.clientId || clientId;
    if (resolvedClientId && !OL._gmailLinkState.clientId) {
        OL._gmailLinkState.clientId = resolvedClientId;
    }

    const client = state.clients?.[resolvedClientId];
    const task = client?.projectData?.clientTasks?.find(t => t.id === id)
        || OL._allClientTasksFlat().find(t => t.id === id);
    const matchedResource = resolvedClientId && task ? OL._findResourceForTask(resolvedClientId, task) : null;
    if (matchedResource) OL._gmailLinkState.resourceId = matchedResource.id;

    OL.renderGmailLinkStep();
};

// Event is independent of Project/Resource/Task — an email can be tied to
// a specific calendar event without implying a client (e.g. a scheduling
// notification before there's even a project). Looks the event up from the
// last search results rather than round-tripping it through an HTML
// attribute (event titles can contain quotes/apostrophes, which would
// break out of an inline onmousedown string).
OL.setGmailLinkEvent = function(id) {
    OL._gmailLinkState.eventId = id;
    OL._gmailLinkState.eventFocused = false;
    OL._gmailLinkSelectedEvent = id
        ? (OL._gmailLinkState.eventResults || []).find(e => e.id === id) || OL._gmailLinkSelectedEvent
        : null;
    OL.renderGmailLinkStep();
};

OL.startGmailCreateTask = function() {
    OL._gmailLinkState.creatingTask = true;
    OL._gmailLinkState.newTaskTitle = '';
    OL.renderGmailLinkStep();
    setTimeout(() => document.getElementById('gmail-new-task-title')?.focus(), 0);
};

OL.cancelGmailCreateTask = function() {
    OL._gmailLinkState.creatingTask = false;
    OL.renderGmailLinkStep();
};

OL.createAndLinkGmailTask = async function() {
    const st = OL._gmailLinkState;
    const title = (st.newTaskTitle || '').trim();
    if (!title || !st.clientId) return;

    let newTaskId;
    await updateAndSync(() => {
        const client = state.clients[st.clientId];
        if (!client) return;
        if (!client.projectData) client.projectData = {};
        if (!client.projectData.clientTasks) client.projectData.clientTasks = [];
        newTaskId = uid();
        client.projectData.clientTasks.unshift({
            id: newTaskId,
            title, name: title,
            description: st.emailBody || '',
            assignee: 'Sphynx Task',
            loggedHours: 0,
            createdAt: new Date().toISOString()
        });
    }, st.clientId);

    st.taskId = newTaskId;
    st.creatingTask = false;
    await OL.saveGmailLink();
};

OL.saveGmailLink = async function({ skipArchive = false } = {}) {
    const st = OL._gmailLinkState;
    if (!st) return;
    // Everything cleared on a previously linked email → that's an unlink.
    if (!(st.clientId || st.resourceId || st.taskId || st.requestId || st.eventId)) {
        if (st.hadLinks) return OL.unlinkGmailMessage();
        return;
    }

    // 1. Fetch current message record to get the full participant list, and
    // its body — copied into `note` below as a starting point the team can
    // then edit down into an actual summary, without losing the link back
    // to the full message (see OL.loadLinkedEmailsForTask for where this
    // note is shown/edited).
    const { data: m, error: fetchErr } = await db.from('gmail_messages').select('participants, sender, body, snippet, note').eq('id', st.emailId).single();
    if (fetchErr) { console.error('Could not load message for manual link:', fetchErr.message); }

    // 2. Persist the links to Supabase
    const updatePayload = {
        linked_client_id: st.clientId || null,
        linked_resource_id: st.resourceId || null,
        linked_task_id: st.taskId || null,
        linked_request_id: st.requestId || null,
        linked_event_id: st.eventId || null,
        // A person chose these links (including removing some) — auto-link
        // and backfill must leave this row alone from now on.
        link_locked: true
    };

    // Only seed the note the first time this message gets linked to a task
    // — never overwrite one the team has already started editing/
    // summarizing, including on a re-link to a different task.
    if (st.taskId && m && !m.note) {
        const preview = (m.body || m.snippet || '').trim();
        if (preview) updatePayload.note = preview.slice(0, 3000);
    }

    const { error } = await db.from('gmail_messages').update(updatePayload).eq('id', st.emailId);

    if (error) { alert('Failed to save link: ' + error.message); return; }

    // Linking the whole email to a request rolls it down onto that request's existing build tasks right away —
    // same as an excerpt or attachment link does (see confirmExcerptLink above).
    if (st.requestId && typeof OL.rollDownForRequest === 'function') {
        try { await OL.rollDownForRequest(st.clientId, st.requestId); } catch (e) { console.warn('Roll-down failed:', e); }
    }

    // 3. Evaluate participants for the Team tab prompt (excluding internal & suppressed emails)
    if (st.clientId && m) {
        const rawParticipants = m.participants || [];
        if (!rawParticipants.length && m.sender) rawParticipants.push(m.sender);

        const externalEmails = rawParticipants.filter(email => {
            const clean = (email || '').toLowerCase().trim();
            return clean && !clean.endsWith('@sphynxautomation.com') && !clean.includes('no-reply');
        });

        // Loop through external emails sequentially to prompt for new team members
        for (const email of externalEmails) {
            await OL._maybePromptAddSenderToTeam(st.clientId, email);
        }
    }

    OL.closeModal();
    await OL.loadGmailFeed();
    OL._refreshAfterGmailAction();
    // 4. If the link is specific enough (a project AND another item) and this wasn't a quick, partial link
    // (skipArchive — see the "This answers it" button, and the suggested-items rule above), ASK whether to archive
    // THIS email. Nothing is archived unless it's confirmed, and the rest of the conversation is never touched.
    if (!skipArchive && st.clientId && (st.taskId || st.eventId || st.resourceId || st.requestId)) {
        OL.promptArchiveEmail(st.emailId, 'linked');
    }
    // Then SUGGEST (never do) the same for the thread's other messages.
    const { note: _omitNote, ...threadLinks } = updatePayload;
    OL.promptThreadFollowUp(st.emailId, threadLinks);
};

// After linking, if other messages in the same conversation are still
// unlinked, offer to link them the same way (and/or archive them). Nothing
// happens unless you click a button.
OL.promptThreadFollowUp = async function(emailId, links) {
    const threadId = await OL._gmailThreadIdFor(emailId);
    if (!threadId) return;
    const { data } = await db.from('gmail_messages')
        .select('id, subject, date, archived, linked_client_id, linked_task_id, linked_request_id, linked_resource_id, linked_event_id')
        .eq('thread_id', threadId).neq('id', emailId);
    const others = (data || []).filter(m => !m.linked_task_id && !m.linked_request_id && !m.linked_resource_id && !m.linked_event_id);
    if (!others.length) return;
    OL._threadFollowUp = { ids: others.map(m => m.id), links };
    const unarchived = others.filter(m => !m.archived).length;
    let box = document.getElementById('thread-followup-prompt');
    if (!box) { box = document.createElement('div'); box.id = 'thread-followup-prompt'; document.body.appendChild(box); }
    box.style.cssText = 'position:fixed; right:20px; bottom:20px; z-index:530; max-width:380px; padding:14px 16px; border:1px solid var(--accent); background:var(--panel-dark, #111); border-radius:10px; box-shadow:0 8px 24px rgba(0,0,0,0.4);';
    box.innerHTML = `
        <div class="small bold" style="margin-bottom:4px;">${others.length} other message${others.length === 1 ? '' : 's'} in this conversation ${others.length === 1 ? "isn't" : "aren't"} linked — link ${others.length === 1 ? 'it' : 'them'} the same way?</div>
        <div class="tiny muted" style="margin-bottom:10px;">Suggestion only — nothing has been changed.</div>
        <div style="display:flex; gap:6px; flex-wrap:wrap;">
            <button class="btn tiny primary" onclick="OL.applyThreadFollowUp(true, false)">Link them the same way</button>
            <button class="btn tiny ghost" onclick="document.getElementById('thread-followup-prompt')?.remove()">Leave them</button>
        </div>`;
    setTimeout(() => { if (OL._threadFollowUp?.ids?.[0] === others[0].id) document.getElementById('thread-followup-prompt')?.remove(); }, 30000);
};

OL.applyThreadFollowUp = async function(link, archive) {
    const f = OL._threadFollowUp;
    document.getElementById('thread-followup-prompt')?.remove();
    if (!f?.ids?.length) return;
    const patch = {};
    if (link && f.links) Object.assign(patch, f.links, { link_locked: true });
    delete patch.note; // the note belongs to the one email it was written on
    if (archive) patch.archived = true;
    const { error } = await db.from('gmail_messages').update(patch).in('id', f.ids);
    if (error) { alert('Could not update the other messages: ' + error.message); return; }
    if (archive) {
        const headers = { 'Content-Type': 'application/json', ...(await OL.getAuthHeaders()) };
        f.ids.forEach(id => fetch('https://kexnnpwjerrnsmifauuo.supabase.co/functions/v1/archive-gmail-message', { method: 'POST', headers, body: JSON.stringify({ id }) }).catch(() => {}));
    }
    OL._threadFollowUp = null;
    await OL.loadGmailFeed();
    OL._refreshAfterGmailAction();
};

// Parses a Gmail "From" header value like `Name <name@domain.com>` (or a
// bare address with no display name) into { name, email }.
OL._parseSenderHeader = function(sender) {
    const raw = (sender || '').trim();
    const match = raw.match(/^(.*?)<([^<>]+)>\s*$/);
    if (match) {
        const name = match[1].trim().replace(/^"|"$/g, '');
        const email = match[2].trim().toLowerCase();
        return { name: name || email, email };
    }
    // No angle brackets — either a bare address, or just a display name
    // with no address at all (nothing to add in that case).
    const bareEmailMatch = raw.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
    return bareEmailMatch ? { name: bareEmailMatch[0], email: bareEmailMatch[0].toLowerCase() } : null;
};

OL._maybePromptAddSenderToTeam = async function(clientId, senderHeader) {
    const parsed = OL._parseSenderHeader(senderHeader);
    if (!parsed?.email) { console.log('[+ contact] No parseable email in:', senderHeader); return; }

    const email = parsed.email.toLowerCase().trim();
    if (email.endsWith('@sphynxautomation.com') || email.includes('no-reply')) {
        console.log('[+ contact] Skipped — internal/no-reply address:', email);
        return;
    }

    const suppressed = state.master?.teamPromptSuppressions || [];
    if (suppressed.includes(email)) {
        console.log('[+ contact] Skipped — "Don\'t ask again" was clicked previously for:', email);
        return;
    }

    const client = state.clients?.[clientId];
    if (!client) { console.log('[+ contact] No client found for id:', clientId); return; }
    if (!client.projectData) client.projectData = {};

    const members = client.projectData.teamMembers || [];
    const alreadyOnTeam = members.some(m => (m.email || '').trim().toLowerCase() === email);
    if (alreadyOnTeam) { console.log('[+ contact] Skipped — already a team member on this project:', email); return; }

    const clientName = client.meta?.name || 'this project';
    const displayName = parsed.name && parsed.name !== email ? `${parsed.name} (${email})` : email;
    const defaultName = parsed.name && parsed.name !== email ? parsed.name : email.split('@')[0];

    // Same "assign to an existing card, or create a new one" picker as the
    // '+' prompt on an email with no project yet — the project is already
    // known here, so that step is skipped and this opens straight on the
    // contact-card step.
    const html = `
        <div class="modal-head">
            <div class="modal-title-text"><i data-lucide="user-plus" style="width:16px;height:16px;vertical-align:sub;margin-right:6px;"></i>Add Contact: ${esc(email)}</div>
            <button class="btn small soft" onclick="OL._resolveTeamPrompt('skip')">✕</button>
        </div>
        <div class="modal-body" style="max-width:420px; width:100%;">
            <p class="tiny" style="margin-bottom:14px;">
                <strong>${esc(displayName)}</strong> isn't linked to a contact card on <strong>${esc(clientName)}</strong> yet.
            </p>
            <label class="tiny bold uppercase muted" style="display:block; margin-bottom:6px;">Assign to Contact Card</label>
            <select id="team-prompt-member-select" class="modal-input tiny" style="width:100%; margin-bottom:8px;" onchange="OL._onTeamPromptMemberSelectChange(this.value)">
                <option value="__new__">+ Create New Contact Card...</option>
                ${members.map(m => `<option value="${esc(m.id)}">${esc(m.name || m.email || 'Contact')} (${esc(m.email || 'No email')})</option>`).join('')}
            </select>
            <div id="team-prompt-new-name-container">
                <input type="text" id="team-prompt-new-name" class="modal-input tiny" placeholder="Contact Person Name..." value="${esc(defaultName)}" style="width:100%;">
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-top:18px; flex-wrap:wrap;">
                <button class="btn small soft" style="color:var(--muted);" onclick="OL._resolveTeamPrompt('never')">Don't ask again for this address</button>
                <div style="display:flex; gap:8px;">
                    <button class="btn small soft" onclick="OL._resolveTeamPrompt('skip')">Skip</button>
                    <button class="btn small primary" onclick="OL._resolveTeamPrompt('save')" style="font-weight:bold;">Save</button>
                </div>
            </div>
        </div>
    `;

    const choice = await new Promise((resolve) => {
        OL._resolveTeamPrompt = (result) => resolve(result);
        openModal(html);
        if (window.lucide) lucide.createIcons();
    });

    if (choice === 'save') {
        const select = document.getElementById('team-prompt-member-select');
        const memberVal = select?.value || '__new__';

        if (memberVal === '__new__') {
            const nameInput = document.getElementById('team-prompt-new-name');
            const memberName = (nameInput?.value || '').trim() || defaultName;
            await updateAndSync(() => {
                if (!client.projectData.teamMembers) client.projectData.teamMembers = [];
                client.projectData.teamMembers.push({
                    id: 'tm-' + Date.now(),
                    name: memberName,
                    email: email,
                    roles: [],
                    createdDate: new Date().toISOString()
                });
            }, clientId);
        } else {
            // Add this email to an existing contact card that didn't have it yet
            await updateAndSync(() => {
                const targetMember = (client.projectData.teamMembers || []).find(m => m.id === memberVal);
                if (targetMember) targetMember.email = email;
            }, clientId);
        }
    } else if (choice === 'never') {
        if (!state.master) state.master = {};
        if (!state.master.teamPromptSuppressions) state.master.teamPromptSuppressions = [];
        state.master.teamPromptSuppressions.push(email);
        await OL.persist();
    }

    OL.closeModal();
};

OL._onTeamPromptMemberSelectChange = function(selectedMemberVal) {
    const container = document.getElementById('team-prompt-new-name-container');
    if (container) container.style.display = selectedMemberVal === '__new__' ? 'block' : 'none';
};

OL.unlinkGmailMessage = async function() {
    const st = OL._gmailLinkState;
    if (!st) return;

    // link_locked: true is what makes this stick — without it the next feed
    // load's auto-link (and the project backfill) would re-link it.
    const { error } = await db.from('gmail_messages').update({ linked_client_id: null, linked_resource_id: null, linked_task_id: null, linked_request_id: null, linked_event_id: null, link_locked: true }).eq('id', st.emailId);
    if (error) { alert('Failed to unlink: ' + error.message); return; }

    OL.closeModal();
    await OL.loadGmailFeed();
    OL._refreshAfterGmailAction();
};

// -------------------------------------------------------------
// SAME-THREAD LINK SUGGESTION — when a reply arrives on a thread where an
// earlier message was already linked, offer those links (banner + "Use
// Same Links" button, same pattern as the recurring-error suggestion on
// Error notes). Never applied automatically and never pre-selected: the
// link fields start empty for the new message until you click the button.
// -------------------------------------------------------------
OL.loadThreadLinkSuggestion = async function(m) {
    const box = document.getElementById('gmail-thread-link-suggestion');
    if (!box || !m?.thread_id) return;
    // Already linked: nothing to suggest.
    if (m.linked_client_id || m.linked_task_id || m.linked_resource_id || m.linked_request_id || m.linked_event_id) return;

    const { data, error } = await db.from('gmail_messages')
        .select('id, date, linked_client_id, linked_resource_id, linked_task_id, linked_request_id, linked_event_id')
        .eq('thread_id', m.thread_id)
        .neq('id', m.id)
        .order('date', { ascending: false })
        .limit(20);
    if (error || !data) return;
    const prior = data.find(r => r.linked_client_id || r.linked_task_id || r.linked_resource_id || r.linked_request_id || r.linked_event_id);
    if (!prior || OL._gmailLinkState?.emailId !== m.id) return;

    OL._threadLinkSuggestion = prior;
    const client = prior.linked_client_id ? state.clients?.[prior.linked_client_id] : null;
    const task = client?.projectData?.clientTasks?.find(t => String(t.id) === String(prior.linked_task_id));
    const resource = client?.projectData?.localResources?.find(r => String(r.id) === String(prior.linked_resource_id));
    const request = (client?.projectData?.scopingSheets || []).flatMap(sh => sh?.lineItems || []).find(i => String(i?.id) === String(prior.linked_request_id));
    const parts = [
        client ? `Project: ${client.meta?.name || 'Project'}` : '',
        request ? `Request: ${request.name || request.title || 'Request'}` : '',
        task ? `Task: ${task.title || task.name}` : '',
        resource ? `Resource: ${resource.name}` : '',
        prior.linked_event_id ? 'Event' : ''
    ].filter(Boolean);

    box.innerHTML = `
        <div style="display:flex; align-items:center; gap:10px; padding:10px 12px; margin-bottom:14px; background:rgba(var(--accent-rgb),0.08); border:1px solid var(--accent); border-radius:8px;">
            <i data-lucide="messages-square" style="width:14px;height:14px;color:var(--accent);flex-shrink:0;"></i>
            <div class="tiny" style="flex:1; min-width:0;">
                Another email in this thread is linked to <strong>${esc(parts.join(' · ') || 'a project')}</strong>. This one is not linked yet.
            </div>
            <button class="btn tiny primary" style="flex-shrink:0;" onclick="OL.applyThreadLinkSuggestion()">Use same links</button>
            <button class="btn tiny ghost" style="flex-shrink:0;" onclick="document.getElementById('gmail-thread-link-suggestion').innerHTML = ''">Not this one</button>
        </div>`;
    if (window.lucide) lucide.createIcons();
};

// Fills the link fields from the earlier message; you still review and
// click Save Link yourself.
OL.applyThreadLinkSuggestion = async function() {
    const prior = OL._threadLinkSuggestion;
    const st = OL._gmailLinkState;
    if (!prior || !st) return;
    st.clientId = prior.linked_client_id || '';
    st.resourceId = prior.linked_resource_id || '';
    st.taskId = prior.linked_task_id || '';
    st.requestId = prior.linked_request_id || '';
    st.eventId = prior.linked_event_id || '';
    if (st.eventId) {
        const { data: evt } = await db.from('calendar_events').select('id, title, start, description').eq('id', st.eventId).maybeSingle();
        OL._gmailLinkSelectedEvent = evt || null;
    }
    const box = document.getElementById('gmail-thread-link-suggestion');
    if (box) box.innerHTML = '';
    OL.renderGmailLinkSummary();
    OL.openGmailLinkModal();
};

window.OL.renderBusinessCommunications = OL.renderBusinessCommunications;
