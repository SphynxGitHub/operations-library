import { esc, uid, state, db, updateAndSync, getBusinessScopedClients } from '../../core/data.js';

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

            ${threads.length === 0 ? `
                <div style="text-align:center; padding: 40px; color: var(--muted);">
                    <i data-lucide="inbox" style="width:36px;height:32px;margin-bottom:8px;opacity:0.5;"></i>
                    <div>${isConnected ? (OL.commTabState.showArchived ? 'No archived emails.' : 'No emails match these filters.') : 'Connect your Google account under Gmail Settings to stream real emails.'}</div>
                </div>
            ` : (groupBy === 'none' ? OL.renderCommThreadRows(threads) : OL.renderGroupedCommThreads(threads, groupBy, subGroupBy))}
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
        <div style="display:grid; gap:10px;">
            ${threads.map(m => OL.renderCommThreadRow(m)).join('')}
        </div>
    `;
};

OL.renderCommThreadRow = function(m) {
    const parsedSender = OL._parseSenderHeader(m.sender);
    const senderName = parsedSender?.name || m.sender || 'Unknown';
    const senderEmail = parsedSender?.email || '';

    return `
        <div style="display:grid; grid-template-columns: 20px 76px 160px 1fr 118px; gap: 10px; padding: 12px; background: rgba(255,255,255,0.02); border: 1px solid var(--line); border-radius: 6px; align-items:center;">
            <div style="display:flex; align-items:center; justify-content:center;" title="Gmail">
                <i data-lucide="mail" style="width:14px;height:14px; color:var(--accent);"></i>
            </div>
            <div class="tiny muted monospace" style="white-space:nowrap;">${m.date ? new Date(m.date).toLocaleDateString() : ''}</div>
            <div style="min-width:0; cursor:pointer;" onclick="OL.openGmailMessageModal('${m.id}')">
                <div style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:bold; font-size:12px;">${esc(senderName)}</div>
                ${senderEmail ? `<div class="tiny muted" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(senderEmail)}</div>` : ''}
            </div>
            <div style="min-width:0; cursor:pointer;" onclick="OL.openGmailMessageModal('${m.id}')">
                <div style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(m.subject)}</div>
                ${m.snippet ? `<div class="tiny muted" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(m.snippet)}</div>` : ''}
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

            state.master.communications.gmail.connected = true;
            state.master.googleConnected = true;
        });

        // Clean the address bar without reloading. The redirect puts
        // "connected=true" INSIDE the hash (e.g. "#/business/communications
        // ?connected=true"), not in the page's real query string — stripping
        // only window.location.search (the old behavior) left it sitting in
        // the hash forever, which is what caused the loop above.
        const hashPath = window.location.hash.split('?')[0];
        window.history.replaceState({}, document.title, window.location.pathname + hashPath);

        // Auto-fetch both Live Feeds
        if (typeof OL.fetchLiveGmailMessages === 'function') OL.fetchLiveGmailMessages();
        if (typeof OL.fetchLiveGoogleCalendar === 'function') OL.fetchLiveGoogleCalendar();
    }
};

// Loads the feed straight from the gmail_messages table (this is the
// durable store now — nothing Gmail-related lives in the big JSON state
// blob anymore, so this doesn't bloat every save).
OL.loadGmailFeed = async function() {
    const { data, error } = await db
        .from('gmail_messages')
        .select('id, sender, subject, snippet, date, linked_client_id, linked_task_id, linked_resource_id, archived, participants')
        .eq('archived', OL.commTabState.showArchived)
        .order('date', { ascending: false })
        .limit(GMAIL_FEED_LIMIT);

    if (error) {
        console.error('Failed to load Gmail feed:', error.message);
        return;
    }

    if (!state.master) state.master = {};
    if (!state.master.communications) state.master.communications = {};
    state.master.communications.threads = data || [];

    await OL.autoLinkGmailMessagesToTasks();
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
    const candidates = threads.filter(m => m.linked_client_id && !m.linked_task_id && !m.archived && (m.participants || []).length);
    if (!candidates.length) return;

    const updates = [];
    for (const m of candidates) {
        const client = state.clients?.[m.linked_client_id];
        if (!client) continue;

        const emailByAssignee = OL.buildAssigneeEmailMap(client);
        const participants = (m.participants || []).map(p => p.toLowerCase());

        const openTasks = (client.projectData?.clientTasks || []).filter(t => t.status !== 'Done');
        const matches = openTasks.filter(t => {
            const assigneeEmail = emailByAssignee[(t.assignee || '').toLowerCase()];
            return assigneeEmail && participants.includes(assigneeEmail);
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
OL.archiveGmailMessage = async function(id, alsoInGmail = true) {
    const { error } = await db.from('gmail_messages').update({ archived: true }).eq('id', id);
    if (error) { alert('Failed to archive: ' + error.message); return; }

    if (alsoInGmail) {
        // Best-effort: the in-app archive stands either way, but a refusal is shown, because it means
        // the email is archived here and still in the Gmail inbox.
        const authHeaders = await OL.getAuthHeaders();
        fetch("https://kexnnpwjerrnsmifauuo.supabase.co/functions/v1/archive-gmail-message", {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders },
            body: JSON.stringify({ id })
        }).then(res => OL.handleGmailActionResponse(res, 'Archived'))
          .catch(err => console.warn('Could not archive in Gmail (still archived in-app):', err));
    }

    OL.closeModal();
    await OL.loadGmailFeed();
    OL._refreshAfterGmailAction();
};

OL.unarchiveGmailMessage = async function(id, alsoInGmail = true) {
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
            body: JSON.stringify({ id })
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
    if (!confirm('Delete this email? This removes it from Operations Library' + (alsoInGmail ? ' and moves it to Trash in Gmail.' : '.'))) return;

    if (alsoInGmail) {
        // The delete function only accepts signed-in Sphynx admins and team members. This is still
        // best-effort: the in-app delete goes ahead either way, but a refusal is shown, because it
        // means the email is gone here and still in Gmail.
        const authHeaders = await OL.getAuthHeaders();
        fetch("https://kexnnpwjerrnsmifauuo.supabase.co/functions/v1/delete-gmail-message", {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders },
            body: JSON.stringify({ id })
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

OL.openGmailMessageModal = async function(id) {
    const { data: m, error } = await db.from('gmail_messages').select('*').eq('id', id).single();
    if (error || !m) { alert('Could not load that email.'); return; }

    OL._gmailLinkState = {
        emailId: id,
        sender: m.sender || '', // kept for the "add sender as team member?" prompt on manual link
        emailBody: OL._stripHtmlForPreview(m.body) || m.snippet || '', // copied into a new task's description below, still editable there
        clientId: m.linked_client_id || '',
        resourceId: m.linked_resource_id || '',
        taskId: m.linked_task_id || '',
        eventId: m.linked_event_id || '',
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
            <div class="modal-title-text">✉️ ${esc(m.subject || 'No Subject')}</div>
            <button class="btn small soft" onclick="OL.closeModal()">Close</button>
        </div>
        <div class="modal-body" style="max-width:900px; width:100%;">
            <div class="tiny muted" style="margin-bottom:14px; display:flex; flex-direction:column; gap:6px;">
                <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                    <strong>From:</strong> ${OL.formatEmailHeaderAddresses(m.sender, m.linked_client_id)}
                </div>
                ${m.recipient_to ? `<div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;"><strong>To:</strong> ${OL.formatEmailHeaderAddresses(m.recipient_to, m.linked_client_id)}</div>` : ''}
                ${m.recipient_cc ? `<div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;"><strong>Cc:</strong> ${OL.formatEmailHeaderAddresses(m.recipient_cc, m.linked_client_id)}</div>` : ''}
                ${m.recipient_bcc ? `<div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;"><strong>Bcc:</strong> ${OL.formatEmailHeaderAddresses(m.recipient_bcc, m.linked_client_id)}</div>` : ''}
                <div><strong>Date:</strong> ${m.date ? new Date(m.date).toLocaleString() : 'Unknown'}</div>
            </div>

            <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:16px;">
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

            <div style="display:grid; grid-template-columns: 1.4fr 1fr; gap:24px; align-items:start;">
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
                    <iframe id="gmail-body-html-frame" sandbox="allow-same-origin allow-popups" style="width:100%; height:460px; border:1px solid var(--line); border-radius:6px; background:#fff;"></iframe>
                ` : `
                    <div style="white-space:pre-wrap; line-height:1.6; font-size:13px; max-height:460px; overflow:auto; border-top:1px solid var(--line); padding-top:14px; min-width:0;">
                        ${esc(OL._stripHtmlForPreview(m.body) || m.snippet || 'No preview available for this message.')}
                    </div>
                `}

                <div style="border-left:1px solid var(--line); padding-left:20px; min-width:0;">
                    <label class="bold tiny uppercase muted" style="display:block; margin-bottom:8px;">
                        <i data-lucide="link" style="width:12px;height:12px;vertical-align:sub;"></i> Link to Project / Resource / Task / Event
                    </label>
                    <div id="gmail-link-body"></div>
                </div>
            </div>
        </div>
    `;
    OL._gmailLinkSelectedEvent = null; // resolved just below if this email already has a linked event

    openModal(html);
    OL.renderGmailLinkStep();

    if (m.body_html) {
        const frame = document.getElementById('gmail-body-html-frame');
        if (frame) {
            // Ensure image URLs with leading // get explicit https:
            let processedHtml = m.body_html.replace(/src=["']\/\//gi, 'src="https://');

            // Click-to-expand images: the iframe is intentionally sandboxed
            // without allow-scripts (this is untrusted external HTML), so a
            // JS lightbox isn't an option. Instead wrap each <img> in an
            // anchor to a full-size overlay shown via the CSS :target
            // trick — no scripting needed, works purely off anchor
            // fragment navigation, which sandboxed iframes still allow.
            processedHtml = OL._wrapEmailImagesForLightbox(processedHtml);

            // Add a base style tag so images scale properly and don't overflow
            const styleHeader = `
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
    
            frame.srcdoc = styleHeader + processedHtml;
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
// COMPOSE / SEND EMAIL
// -------------------------------------------------------------

// Shared compose modal. `options.onSent(result)` lets each entry point
// (reply, blank compose, quick-email-a-contact) do its own targeted
// refresh after a successful send, rather than this guessing at what's
// currently on screen.
OL.openComposeEmailModal = function(options = {}) {
    OL._composeState = {
        title: options.title || '',
        to: options.to || '',
        cc: options.cc || '',
        subject: options.subject || '',
        body: options.body || '',
        quoted: options.quoted || null,
        threadId: options.threadId || null,
        replyToMessageId: options.replyToMessageId || null,
        linked_client_id: options.linked_client_id || null,
        linked_resource_id: options.linked_resource_id || null,
        linked_task_id: options.linked_task_id || null,
        linked_event_id: options.linked_event_id || null,
        onSent: typeof options.onSent === 'function' ? options.onSent : null
    };
    const st = OL._composeState;
    const isReply = !!st.replyToMessageId;

    const html = `
        <div class="modal-head">
            <div class="modal-title-text">${st.title ? esc(st.title) : (isReply ? '↩ Reply' : '✉️ Compose Email')}</div>
            <button class="btn small soft" onclick="OL.closeModal()">Close</button>
        </div>
        <div class="modal-body" style="max-width:640px; width:100%;">
            <div style="display:grid; gap:10px;">
                <div>
                    <label class="tiny muted bold" style="display:block; margin-bottom:2px;">To</label>
                    <input type="text" id="compose-email-to" class="modal-input" style="width:100%; box-sizing:border-box;" value="${esc(st.to)}" placeholder="name@example.com">
                </div>
                <div>
                    <label class="tiny muted bold" style="display:block; margin-bottom:2px;">Cc</label>
                    <input type="text" id="compose-email-cc" class="modal-input" style="width:100%; box-sizing:border-box;" value="${esc(st.cc)}" placeholder="optional, comma-separated">
                </div>
                <div>
                    <label class="tiny muted bold" style="display:block; margin-bottom:2px;">Subject</label>
                    <input type="text" id="compose-email-subject" class="modal-input" style="width:100%; box-sizing:border-box;" value="${esc(st.subject)}">
                </div>
                <div>
                    <label class="tiny muted bold" style="display:block; margin-bottom:2px;">Message</label>
                    <textarea id="compose-email-body" class="modal-input" rows="10" style="width:100%; box-sizing:border-box;">${esc(st.body)}</textarea>
                </div>
                ${st.quoted ? `
                    <details>
                        <summary class="tiny muted" style="cursor:pointer;">Quoted original message</summary>
                        <div class="tiny muted" style="white-space:pre-wrap; padding:8px; background:rgba(255,255,255,0.02); border-radius:6px; margin-top:4px; max-height:200px; overflow:auto;">${esc(st.quoted)}</div>
                    </details>
                ` : ''}
                ${!isReply ? `
                    <div>
                        <label class="tiny muted bold" style="display:block; margin-bottom:2px;">Link to Project (optional)</label>
                        <select id="compose-email-client" class="modal-input tiny">
                            <option value="">— No project —</option>
                            ${Object.values(state.clients || {})
                                .filter(c => c?.meta?.name)
                                .sort((a, b) => (a.meta.name || '').localeCompare(b.meta.name || ''))
                                .map(c => `<option value="${c.id}" ${st.linked_client_id === c.id ? 'selected' : ''}>${esc(c.meta.name)}</option>`)
                                .join('')}
                        </select>
                    </div>
                ` : (st.linked_client_id && state.clients?.[st.linked_client_id] ? `
                    <div class="tiny muted">Will stay linked to <strong>${esc(state.clients[st.linked_client_id].meta?.name || 'this project')}</strong>, same as the original email.</div>
                ` : '')}
                <div style="display:flex; justify-content:flex-end; gap:8px;">
                    <button class="btn small soft" onclick="OL.closeModal()">Cancel</button>
                    <button class="btn small primary" id="compose-email-send-btn" onclick="OL.sendComposedEmail()"><i data-lucide="send" style="width:12px;height:12px;"></i> Send</button>
                </div>
            </div>
        </div>
    `;
    OL.showOverlayModal(html);
    document.getElementById(isReply ? 'compose-email-body' : 'compose-email-to')?.focus();
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
    const to = (document.getElementById('compose-email-to')?.value || '').trim();
    const subject = (document.getElementById('compose-email-subject')?.value || '').trim();
    const body = document.getElementById('compose-email-body')?.value || '';
    const cc = (document.getElementById('compose-email-cc')?.value || '').trim();
    const clientSelect = document.getElementById('compose-email-client');
    const linkedClientId = clientSelect ? clientSelect.value : st.linked_client_id;

    if (!to || !subject || !body.trim()) {
        alert('To, subject, and message are all required.');
        return;
    }

    const btn = document.getElementById('compose-email-send-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Sending...'; }

    try {
        const response = await fetch('https://kexnnpwjerrnsmifauuo.supabase.co/functions/v1/send-gmail-message', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(await OL.getAuthHeaders()) },
            body: JSON.stringify({
                to, cc: cc || undefined, subject, body,
                threadId: st.threadId || undefined,
                replyToMessageId: st.replyToMessageId || undefined,
                linked_client_id: linkedClientId || st.linked_client_id || null,
                linked_resource_id: st.linked_resource_id || null,
                linked_task_id: st.linked_task_id || null,
                linked_event_id: st.linked_event_id || null
            })
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
            if (btn) { btn.disabled = false; btn.innerHTML = '<i data-lucide="send" style="width:12px;height:12px;"></i> Send'; if (window.lucide) lucide.createIcons(); }
            return;
        }

        OL.closeModal();
        if (typeof st.onSent === 'function') st.onSent(result);
    } catch (err) {
        console.error('Failed to send email:', err);
        alert('Failed to send email — see console for details.');
        if (btn) { btn.disabled = false; btn.innerHTML = '<i data-lucide="send" style="width:12px;height:12px;"></i> Send'; if (window.lucide) lucide.createIcons(); }
    }
};

// Reply, from an open email's own modal.
OL.openReplyToGmailMessage = async function(messageId, replyAll = false) {
    const { data: m, error } = await db.from('gmail_messages').select('*').eq('id', messageId).single();
    if (error || !m) { alert('Could not load that email.'); return; }

    const parsed = OL._parseSenderHeader(m.sender);
    const replyTo = parsed?.email || m.sender || '';
    const subject = /^re:/i.test(m.subject || '') ? m.subject : `Re: ${m.subject || ''}`;
    const quoted = OL._stripHtmlForPreview(m.body) || m.snippet || '';

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
OL._allClientResourcesFlat = function() {
    return Object.values(state.clients || {}).flatMap(c =>
        (c.projectData?.localResources || []).map(r => ({ ...r, _clientId: c.id, _clientName: c.meta?.name || 'Unnamed' }))
    );
};

OL._allClientTasksFlat = function() {
    return Object.values(state.clients || {}).flatMap(c =>
        (c.projectData?.clientTasks || []).map(t => ({ ...t, _clientId: c.id, _clientName: c.meta?.name || 'Unnamed' }))
    );
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

    // ---- Resource (scoped to project if one's picked, else global) ----
    const resourceQuery = (st.resourceQuery || '').trim().toLowerCase();
    const resourcePool = selectedClient
        ? (selectedClient.projectData?.localResources || []).map(r => ({ ...r, _clientId: st.clientId, _clientName: selectedClient.meta?.name }))
        : OL._allClientResourcesFlat();
    const filteredResources = resourceQuery
        ? resourcePool.filter(r => (r.name || '').toLowerCase().includes(resourceQuery))
        : resourcePool;
    const selectedResource = st.resourceId
        ? (selectedClient?.projectData?.localResources || []).find(r => r.id === st.resourceId)
            || OL._allClientResourcesFlat().find(r => r.id === st.resourceId)
        : null;

    // ---- Task (scoped to project if one's picked, else global) ----
    const taskQuery = (st.taskQuery || '').trim().toLowerCase();
    const taskPool = selectedClient
        ? (selectedClient.projectData?.clientTasks || []).map(t => ({ ...t, _clientId: st.clientId, _clientName: selectedClient.meta?.name }))
        : OL._allClientTasksFlat();
    const filteredTasks = taskQuery
        ? taskPool.filter(t => (t.title || t.name || '').toLowerCase().includes(taskQuery))
        : taskPool;
    const selectedTask = st.taskId
        ? (selectedClient?.projectData?.clientTasks || []).find(t => t.id === st.taskId)
            || OL._allClientTasksFlat().find(t => t.id === st.taskId)
        : null;

    // ---- Event (not all loaded client-side — searched live against Supabase
    // by OL.setGmailLinkEventQuery below; st.eventResults holds the latest hits) ----
    const selectedEvent = st.eventId ? OL._gmailLinkSelectedEvent : null;

    const canLink = !!(st.clientId || st.resourceId || st.taskId || st.eventId);

    container.innerHTML = `
        <div style="margin-bottom:14px;">
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
                    <div style="max-height:140px; overflow:auto; margin-top:6px; display:grid; gap:4px;">
                        ${filteredClients.length ? filteredClients.map(c => `
                            <div class="tiny" style="padding:7px 10px; border:1px solid var(--line); border-radius:6px; cursor:pointer;" onmousedown="OL.setGmailLinkClient('${c.id}')">${esc(c.meta?.name || 'Unnamed')}</div>
                        `).join('') : `<div class="tiny muted" style="padding:8px;">No matching projects.</div>`}
                    </div>
                ` : ''}
            `}
        </div>

        <div style="margin-bottom:14px;">
            <label class="tiny muted bold" style="display:block; margin-bottom:4px;">Resource / Deliverable</label>
            ${selectedResource ? `
                <div style="display:flex; align-items:center; justify-content:space-between; padding:8px 10px; background:rgba(var(--accent-rgb), 0.06); border:1px solid var(--accent); border-radius:6px;">
                    <span class="tiny bold">${esc(selectedResource.name)}${!selectedClient ? ` <span class="pill tiny soft" style="font-size:9px;">${esc(selectedResource._clientName || '')}</span>` : ''}</span>
                    <button class="btn tiny soft" onclick="OL.setGmailLinkResource('')">Change</button>
                </div>
            ` : `
                <input type="text" id="gmail-link-resource-search" class="modal-input tiny" placeholder="Search resources...${selectedClient ? '' : ' (all projects)'}" value="${esc(st.resourceQuery || '')}"
                       onfocus="OL.setGmailLinkFocus('resourceFocused', true)" oninput="OL.setGmailLinkResourceQuery(this.value)">
                ${st.resourceFocused ? `
                    <div style="max-height:140px; overflow:auto; margin-top:6px; display:grid; gap:4px;">
                        ${filteredResources.length ? filteredResources.map(r => `
                            <div class="tiny" style="padding:7px 10px; border:1px solid var(--line); border-radius:6px; cursor:pointer; display:flex; justify-content:space-between; gap:8px;" onmousedown="OL.setGmailLinkResource('${r.id}', '${r._clientId}')">
                                <span>${esc(r.name)}</span>
                                ${!selectedClient ? `<span class="pill tiny soft" style="font-size:9px; flex-shrink:0;">${esc(r._clientName || '')}</span>` : ''}
                            </div>
                        `).join('') : `<div class="tiny muted" style="padding:8px;">No matching resources.</div>`}
                    </div>
                ` : ''}
            `}
        </div>

        <div style="margin-bottom:14px;">
            <label class="tiny muted bold" style="display:block; margin-bottom:4px;">Task</label>
            ${selectedTask ? `
                <div style="display:flex; align-items:center; justify-content:space-between; padding:8px 10px; background:rgba(var(--accent-rgb), 0.06); border:1px solid var(--accent); border-radius:6px;">
                    <span class="tiny bold">${esc(selectedTask.title || selectedTask.name)}${!selectedClient ? ` <span class="pill tiny soft" style="font-size:9px;">${esc(selectedTask._clientName || '')}</span>` : ''}</span>
                    <button class="btn tiny soft" onclick="OL.setGmailLinkTask('')">Change</button>
                </div>
            ` : `
                <input type="text" id="gmail-link-task-search" class="modal-input tiny" placeholder="Search tasks...${selectedClient ? '' : ' (all projects)'}" value="${esc(st.taskQuery || '')}"
                       onfocus="OL.setGmailLinkFocus('taskFocused', true)" oninput="OL.setGmailLinkTaskQuery(this.value)">
                ${st.taskFocused ? `
                    <div style="max-height:140px; overflow:auto; margin-top:6px; display:grid; gap:4px;">
                        ${filteredTasks.length ? filteredTasks.map(t => `
                            <div class="tiny" style="padding:7px 10px; border:1px solid var(--line); border-radius:6px; cursor:pointer; display:flex; justify-content:space-between; gap:8px;" onmousedown="OL.setGmailLinkTask('${t.id}', '${t._clientId}')">
                                <span>${esc(t.title || t.name)}</span>
                                ${!selectedClient ? `<span class="pill tiny soft" style="font-size:9px; flex-shrink:0;">${esc(t._clientName || '')}</span>` : ''}
                            </div>
                        `).join('') : `<div class="tiny muted" style="padding:8px;">No matching tasks.</div>`}
                    </div>

                    ${selectedClient ? (st.creatingTask ? `
                        <div style="margin-top:10px; padding:10px; border:1px dashed var(--accent); border-radius:6px;">
                            <input type="text" id="gmail-new-task-title" class="modal-input tiny" placeholder="New task title..." value="${esc(st.newTaskTitle || '')}" oninput="OL._gmailLinkState.newTaskTitle = this.value">
                            <div style="display:flex; gap:8px; margin-top:8px; justify-content:flex-end;">
                                <button class="btn tiny soft" onclick="OL.cancelGmailCreateTask()">Cancel</button>
                                <button class="btn tiny primary" onclick="OL.createAndLinkGmailTask()" style="font-weight:bold;">Create &amp; Link</button>
                            </div>
                        </div>
                    ` : `
                        <button class="btn tiny soft" style="margin-top:8px; width:100%; display:flex; align-items:center; justify-content:center; gap:6px;" onclick="OL.startGmailCreateTask()">
                            <i data-lucide="plus" style="width:11px;height:11px;"></i> Create New Task
                        </button>
                    `) : `<div class="tiny muted" style="margin-top:6px;">Pick a project first to create a new task.</div>`}
                ` : ''}
            `}
        </div>

        <div style="margin-bottom:16px;">
            <label class="tiny muted bold" style="display:block; margin-bottom:4px;">Event</label>
            ${selectedEvent ? `
                <div style="display:flex; align-items:center; justify-content:space-between; padding:8px 10px; background:rgba(var(--accent-rgb), 0.06); border:1px solid var(--accent); border-radius:6px;">
                    <span class="tiny bold">${esc(selectedEvent.title)}${selectedEvent.start ? ` <span class="tiny muted">· ${esc(new Date(selectedEvent.start).toLocaleDateString())}</span>` : ''}</span>
                    <button class="btn tiny soft" onclick="OL.setGmailLinkEvent('')">Change</button>
                </div>
            ` : `
                <input type="text" id="gmail-link-event-search" class="modal-input tiny" placeholder="Search calendar events..." value="${esc(st.eventQuery || '')}"
                       onfocus="OL.setGmailLinkFocus('eventFocused', true)" oninput="OL.setGmailLinkEventQuery(this.value)">
                ${st.eventFocused ? `
                    <div style="max-height:140px; overflow:auto; margin-top:6px; display:grid; gap:4px;">
                        ${st.eventResults.length ? st.eventResults.map(e => `
                            <div class="tiny" style="padding:7px 10px; border:1px solid var(--line); border-radius:6px; cursor:pointer;" onmousedown="OL.setGmailLinkEvent('${esc(e.id).replace(/'/g, "\\'")}')">
                                <div>${esc(e.title)}</div>
                                ${e.start ? `<div class="tiny muted" style="margin-top:1px;">${esc(new Date(e.start).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }))}</div>` : ''}
                            </div>
                        `).join('') : `<div class="tiny muted" style="padding:8px;">${(st.eventQuery || '').trim() ? 'No matching events.' : 'Type to search events...'}</div>`}
                    </div>
                ` : ''}
            `}
        </div>

        <div style="display:flex; justify-content:flex-end; gap:10px;">
            ${(st.clientId || st.resourceId || st.taskId || st.eventId) ? `<button class="btn small danger" onclick="OL.unlinkGmailMessage()">Unlink</button>` : ''}
            <button class="btn small primary" onclick="OL.saveGmailLink()" style="font-weight:bold;" ${!canLink ? 'disabled' : ''}>Save Link</button>
        </div>
    `;
    if (window.lucide) lucide.createIcons();
};

// Shared by all four search boxes — flips the corresponding *Focused flag
// so its results list appears, without touching the query itself.
OL.setGmailLinkFocus = function(flagName, value) {
    if (OL._gmailLinkState[flagName] === value) return; // already showing — don't re-render mid-keystroke
    OL._gmailLinkState[flagName] = value;
    OL.renderGmailLinkStep();
};

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
    if (!q) { OL._gmailLinkState.eventResults = []; OL.renderGmailLinkStep(); return; }

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

OL.saveGmailLink = async function() {
    const st = OL._gmailLinkState;
    if (!st || !(st.clientId || st.resourceId || st.taskId || st.eventId)) return;

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
        linked_event_id: st.eventId || null
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

    // 4. Auto-archive if specific enough (Project + Task/Event/Resource)
    if (st.clientId && (st.taskId || st.eventId || st.resourceId)) {
        OL.closeModal();
        await OL.archiveGmailMessage(st.emailId, true);
        return;
    }

    OL.closeModal();
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
            <div class="modal-title-text">👤 Add Contact: ${esc(email)}</div>
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

    const { error } = await db.from('gmail_messages').update({ linked_client_id: null, linked_resource_id: null, linked_task_id: null, linked_event_id: null }).eq('id', st.emailId);
    if (error) { alert('Failed to unlink: ' + error.message); return; }

    OL.closeModal();
    await OL.loadGmailFeed();
    OL._refreshAfterGmailAction();
};

window.OL.renderBusinessCommunications = OL.renderBusinessCommunications;
