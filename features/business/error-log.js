import { esc, uid, state, db, updateAndSync, getActiveClient, getBusinessScopedClients, getBusinessScopeClientIds, isInBusinessScope, scopeQueryToBusinessClients } from '../../core/data.js';

// Small Lucide icon helper for inline pill/tag labels.
function ic(name) {
    return `<i data-lucide="${name}" style="width:11px;height:11px;vertical-align:-1px;margin-right:3px;"></i>`;
}

// Starter set for the Resolution "insert template" picker — still fully
// free-text after inserting, this just saves retyping the common ones.
const RESOLUTION_TEMPLATES = [
    'Reauthorized the app connection in Zapier',
    'Refreshed expired API credentials',
    'Added retry/error-handling logic to the Zap',
    'Disabled duplicate/conflicting Zap',
    'Corrected a formatting/mapping issue in the Zap step',
    'Contacted vendor support to resolve on their end',
    'Manually corrected the affected record(s)',
    'One-off failure — no fix needed, working as expected on retry'
];

const CAUSE_TEMPLATES = [
    "API Rate Limit",
    "Database Timeout",
    "Invalid Auth Token/API Key",
    "Missing Required Field",
    "Network Interruption",
    "Third-Party Service Down",
    "Incorrectly-Formatted Entry",
    "Notification Error (not a real error)",
    "Polling Issue",
    "Updated Password; Account Not Reconnected to Zapier"
];

OL.insertResolutionTemplate = function(id, template) {
    if (!template) return;
    const ta = document.getElementById(`error-resolution-${id}`);
    if (!ta) return;
    ta.value = ta.value ? `${ta.value}\n${template}` : template;
    ta.focus();
    OL.saveErrorField(id, 'resolution', ta.value);
};

OL.insertCauseTemplate = function(id, template) {
    if (!template) return;
    const ta = document.getElementById(`error-cause-${id}`);
    if (!ta) return;
    ta.value = ta.value ? `${ta.value}\n${template}` : template;
    ta.focus();
    OL.saveErrorField(id, 'cause', ta.value);
};


OL.errorLogState = {
    statusFilter: 'open',   // 'open' | 'resolved' | 'all'
    clientFilter: '',
    serviceFilter: '',
    resourceFilter: '',
    query: '',
    groupBy: 'none',        // 'none' | 'message' | 'service' | 'client' | 'date' | 'resource'
    rows: [],
    services: [],
    resources: [],
    loading: false,
    loadedOnce: false,
    loadedForScope: null,
    lockedClientId: null    // set when viewing from inside a specific client's project
};

// Re-render whichever mode is currently active (centralized vs client-locked)
OL._rerenderErrorLog = function() {
    // Several error-row actions (resolve, save a field, mark a note
    // viewed, etc.) call this when they finish. It used to unconditionally
    // rebuild the WHOLE #mainContent into the Error Tracking page shell —
    // fine when that's actually what's on screen, but the Dashboard's
    // activity feed also reuses these same error rows (see dashboard.js),
    // so acting on a row from there was force-navigating away into Error
    // Tracking. That got fixed by checking the error-log shell was
    // actually mounted first — but that fix's flip side was that the
    // Dashboard then never found out the row it was showing had changed,
    // staying stale until a manual refresh. This checks the URL hash
    // (same approach OL.refreshTaskView already uses successfully for the
    // equivalent task-row case) and refreshes whichever page is actually
    // current, instead of only ever handling the Error Tracking case.
    const hash = window.location.hash || '';

    if (hash.includes('/errors')) {
        if (OL.errorLogState.lockedClientId) OL.renderClientErrorLog();
        else OL.renderBusinessErrorLog();
        return;
    }

    const onDashboard = hash.includes('/business/dashboard') || hash === '#/' || hash === '';
    if (onDashboard && typeof OL.renderDailyDashboard === 'function') {
        // The Dashboard keeps its own separate cache of error rows
        // (OL._dashboardErrorsCache) rather than reading OL.errorLogState —
        // nulling it out makes renderDailyDashboard refetch fresh instead
        // of re-rendering the same stale snapshot it already had in memory.
        OL._dashboardErrorsCache = null;
        OL.renderDailyDashboard();
    }
};

OL.renderBusinessErrorLog = function() {
    OL.errorLogState.lockedClientId = null;
    OL._renderErrorLogShell('Error Tracking', 'Centralized log across every client project — Zapier failures, manual notes, and quirks');
};

OL.renderClientErrorLog = function() {
    const client = getActiveClient();
    if (!client) return;
    OL.errorLogState.lockedClientId = client.id;

    const title = `Error Tracking — ${client.meta?.name || 'Project'}`;
    const subtitle = `<span class="pill tiny soft" style="border:none; cursor:pointer;" title="Click to copy" onclick="navigator.clipboard.writeText('${client.id}'); alert('Copied Client ID: ${client.id}');">${ic('hash')}${esc(client.id)}</span> &nbsp;Zapier failures, manual notes, and quirks for this project`;

    OL._renderErrorLogShell(title, subtitle);
};

OL._renderErrorLogShell = function(title, subtitle) {
    const main = document.getElementById("mainContent");
    if (!main) return;

    const desiredScope = OL.errorLogState.lockedClientId || '__global';
    if ((!OL.errorLogState.loadedOnce || OL.errorLogState.loadedForScope !== desiredScope) && !OL.errorLogState.loading) {
        OL.errorLogState.loadedOnce = true;
        OL.errorLogState.loadedForScope = desiredScope;
        OL.loadErrorLog().then(() => OL._rerenderErrorLog());
    }

    const locked = !!OL.errorLogState.lockedClientId;
    const clients = getBusinessScopedClients();
    const rows = OL.errorLogState.rows;
    const renderRows = (rowList) => `<div style="display:grid; gap:10px;">${rowList.map(r => OL.renderErrorLogRow(r, locked)).join('')}</div>`;

    main.innerHTML = `
        <div id="error-log-shell">
        <div class="section-header">
            <div>
                <h2><i data-lucide="alert-triangle" style="width:24px;height:24px;vertical-align:sub;margin-right:8px;color:var(--accent);"></i>${esc(title)}</h2>
                <div class="small muted" style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">${subtitle}</div>
            </div>
            <div class="header-actions">
                <button class="btn small primary" onclick="OL.openAddErrorModal()">
                    <i data-lucide="plus" style="width:14px;height:14px;"></i> Add Error
                </button>
            </div>
        </div>

        <div class="card" style="padding:20px;">
            <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin-bottom:18px; border-bottom:1px solid var(--line); padding-bottom:15px;">
                <div style="display:flex; gap:8px;">
                    <button class="btn tiny ${OL.errorLogState.statusFilter === 'open' ? 'primary' : 'soft'}" onclick="OL.setErrorLogFilter('statusFilter', 'open')">Open</button>
                    <button class="btn tiny ${OL.errorLogState.statusFilter === 'resolved' ? 'primary' : 'soft'}" onclick="OL.setErrorLogFilter('statusFilter', 'resolved')">Resolved</button>
                    <button class="btn tiny ${OL.errorLogState.statusFilter === 'all' ? 'primary' : 'soft'}" onclick="OL.setErrorLogFilter('statusFilter', 'all')">All</button>
                </div>
                ${!locked ? `
                    ${OL.renderSearchableProjectPicker({
                        idPrefix: 'errorlog-client-filter',
                        clients: clients,
                        selectedId: OL.errorLogState.clientFilter && OL.errorLogState.clientFilter !== '__unassigned' ? OL.errorLogState.clientFilter : '',
                        selectedLabel: OL.errorLogState.clientFilter === '__unassigned'
                            ? 'Unassigned'
                            : (OL.errorLogState.clientFilter ? (clients.find(c => c.id === OL.errorLogState.clientFilter)?.meta?.name || '') : ''),
                        allOptionLabel: 'All Clients',
                        extraOptions: [{ value: '__unassigned', label: 'Unassigned' }],
                        onSelect: 'setErrorLogClientFilter',
                        placeholder: 'All Clients'
                    })}
                ` : ''}
                <select class="modal-input tiny" style="width:180px;" onchange="OL.setErrorLogFilter('serviceFilter', this.value)">
                    <option value="">All Services</option>
                    ${OL.errorLogState.services.map(s => `<option value="${esc(s)}" ${OL.errorLogState.serviceFilter === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}
                </select>
                <select class="modal-input tiny" style="width:180px;" onchange="OL.setErrorLogFilter('resourceFilter', this.value)">
                    <option value="">All Resources</option>
                    ${OL.errorLogState.resources.map(s => `<option value="${esc(s)}" ${OL.errorLogState.resourceFilter === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}
                </select>
                <select class="modal-input tiny" style="width:150px;" onchange="OL.setErrorLogFilter('groupBy', this.value)">
                    <option value="none" ${OL.errorLogState.groupBy === 'none' ? 'selected' : ''}>No Grouping</option>
                    <option value="message" ${OL.errorLogState.groupBy === 'message' ? 'selected' : ''}>Group: Error Message</option>
                    <option value="service" ${OL.errorLogState.groupBy === 'service' ? 'selected' : ''}>Group: Service</option>
                    <option value="resource" ${OL.errorLogState.groupBy === 'resource' ? 'selected' : ''}>Group: Resource</option>
                    ${!locked ? `<option value="client" ${OL.errorLogState.groupBy === 'client' ? 'selected' : ''}>Group: Project</option>` : ''}
                    <option value="date" ${OL.errorLogState.groupBy === 'date' ? 'selected' : ''}>Group: Date</option>
                </select>
                <input type="text" class="modal-input tiny" style="flex:1; min-width:180px;" placeholder="Search title/message..." value="${esc(OL.errorLogState.query)}" oninput="OL.setErrorLogFilter('query', this.value)">
            </div>

            ${OL.errorLogState.loading ? `<div class="tiny muted" style="text-align:center; padding:30px;">Loading...</div>` : ''}

            ${(!OL.errorLogState.loading && rows.length === 0) ? `
                <div style="text-align:center; padding:40px; color:var(--muted);">
                    <i data-lucide="check-circle" style="width:36px;height:32px;margin-bottom:8px;opacity:0.5;"></i>
                    <div>No errors match these filters.</div>
                </div>
            ` : (OL.errorLogState.groupBy === 'none' ? renderRows(rows) : `
                <div style="display:grid; gap:20px;">
                    ${OL.groupErrorRows(rows, OL.errorLogState.groupBy).map(g => `
                        <div>
                            <div class="tiny bold uppercase muted" style="margin-bottom:6px; padding-bottom:4px; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; align-items:center; gap:8px;">
                                <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(g.label)}</span>
                                <span class="pill tiny soft" style="flex-shrink:0;">${g.rows.length}</span>
                            </div>
                            ${renderRows(g.rows)}
                        </div>
                    `).join('')}
                </div>
            `)}
        </div>
        </div>
    `;
    if (window.lucide) lucide.createIcons();
};

OL.groupErrorRows = function(rows, groupBy) {
    const map = new Map();
    rows.forEach(r => {
        let key, label;
        if (groupBy === 'message') {
            key = (r.message || '').trim() || '__none';
            label = (r.message || '').trim() || '(No message)';
        } else if (groupBy === 'service') {
            key = r.service || '__none';
            label = r.service || 'No Service';
        } else if (groupBy === 'resource') {
            key = r.resource_id || '__none';
            label = r.resource_name || 'No Resource';
        } else if (groupBy === 'client') {
            key = r.client_id || '__unassigned';
            label = r.client_id ? (state.clients[r.client_id]?.meta?.name || 'Unknown Project') : 'Unassigned';
        } else if (groupBy === 'date') {
            key = r.occurred_at ? new Date(r.occurred_at).toDateString() : '__unknown';
            label = r.occurred_at ? new Date(r.occurred_at).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : 'Unknown Date';
        } else {
            key = '__all'; label = 'All';
        }
        if (!map.has(key)) map.set(key, { key, label, rows: [] });
        map.get(key).rows.push(r);
    });

    const groups = [...map.values()];
    if (groupBy === 'date') {
        groups.sort((a, b) => new Date(b.rows[0].occurred_at || 0) - new Date(a.rows[0].occurred_at || 0));
    } else {
        groups.sort((a, b) => b.rows.length - a.rows.length || a.label.localeCompare(b.label));
    }
    return groups;
};

// -------------------------------------------------------------
// CARD ROW — accent bar reflects status at a glance, a tag row for
// date/system/project, a message preview, and a notes box previewing
// cause/resolution/resolved-date (muted placeholders when empty).
// Click anywhere on the card for the full structured modal.
// -------------------------------------------------------------
OL.renderErrorLogRow = function(r, locked) {
    const isResolved = r.status === 'resolved';
    const accentColor = isResolved ? '#22c55e' : '#f59e0b';
    const statusBg = isResolved ? 'rgba(34,197,94,0.15)' : 'rgba(245,158,11,0.15)';

    const occurred = r.occurred_at ? new Date(r.occurred_at).toLocaleDateString([], { dateStyle: 'medium' }) : '';
    const resolvedDate = r.resolution_date ? new Date(r.resolution_date).toLocaleDateString([], { dateStyle: 'medium' }) : '';
    const clientName = (!locked && r.client_id) ? (state.clients[r.client_id]?.meta?.name || 'Unknown') : '';
    const snippet = (r.message || '').replace(/\s+/g, ' ').trim();

    return `
        <div class="card-section" style="border-color: var(--line); background: rgba(255,255,255,0.02); border-left:3px solid ${accentColor}; border-radius:0 8px 8px 0; cursor:pointer;" onclick="OL.openErrorDetailModal('${r.id}')">
            <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:8px;">
                <strong style="font-size:14px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(r.title || 'Untitled Error')}</strong>
                <div style="display:flex; align-items:center; gap:8px; flex-shrink:0;" onclick="event.stopPropagation();">
                    ${OL.renderErrorTaskButton(r)}
                    <select class="tiny" style="border:none; border-radius:14px; padding:4px 10px; cursor:pointer; background:${statusBg}; color:${accentColor}; font-weight:bold; flex-shrink:0;" onchange="OL.onErrorStatusSelect(this, '${r.id}')">
                        <option value="open" ${!isResolved ? 'selected' : ''}>Open</option>
                        <option value="resolved" ${isResolved ? 'selected' : ''}>Complete</option>
                    </select>
                </div>
            </div>

            <div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:8px;">
                ${occurred ? `<span class="pill tiny soft">${ic('calendar')}${esc(occurred)}</span>` : ''}
                ${r.service ? `<span class="pill tiny soft">${ic('wrench')}${esc(r.service)}</span>` : ''}
                ${clientName ? `<span class="pill tiny" style="border:none; background:rgba(var(--accent-rgb),0.15); color:var(--accent); cursor:pointer;" title="Click to copy Client ID: ${esc(r.client_id)}" onclick="event.stopPropagation(); navigator.clipboard.writeText('${r.client_id}'); alert('Copied Client ID: ${r.client_id}');">${ic('folder')}${esc(clientName)}</span>` : ''}
                ${r.resource_name ? `<span class="pill tiny soft">${ic('git-branch')}${esc(r.resource_name)}</span>` : ''}
                ${r.outage ? `<span class="pill tiny" style="border:none; background:rgba(239,68,68,0.15); color:#ef4444;">${ic('alert-circle')}Outage</span>` : ''}
                ${OL.renderErrorTaskPill(r)}
                ${r.occurrence_count && r.occurrence_count > 1 ? `<span class="pill tiny soft">×${r.occurrence_count}</span>` : ''}
            </div>

            <div class="tiny muted" style="margin-bottom:8px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                ${esc(snippet)}
            </div>

            <div style="background:rgba(255,255,255,0.03); border-radius:6px; padding:8px 10px; display:flex; flex-direction:column; gap:4px;">
                <div class="tiny ${r.cause ? '' : 'muted'}">${ic('wrench')}${r.cause ? 'Cause: ' + esc(r.cause) : 'Cause not yet noted'}</div>
                <div class="tiny ${r.resolution ? '' : 'muted'}">${ic('check')}${r.resolution ? 'Resolution: ' + esc(r.resolution) : 'Resolution not yet noted'}</div>
                <div class="tiny ${resolvedDate ? '' : 'muted'}">${ic('calendar-check')}${resolvedDate ? 'Resolved: ' + esc(resolvedDate) : 'Not yet resolved'}</div>
            </div>
        </div>
    `;
};

OL.setErrorLogFilter = function(key, value) {
    OL.errorLogState[key] = value;
    if (key === 'groupBy') { OL._rerenderErrorLog(); return; } // pure client-side reorganization, no reload needed
    OL.loadErrorLog().then(() => OL._rerenderErrorLog());
};

OL.setErrorLogClientFilter = function(clientId) {
    OL.setErrorLogFilter('clientFilter', clientId || '');
};

OL.loadErrorLog = async function() {
    OL.errorLogState.loading = true;

    // Inside one project's own Error Tracking tab the list is that project only (and a partner/client login
    // may only open a project that is theirs or one they manage). Everywhere else it is limited to the
    // projects this login may see business data for.
    const lockedId = OL.errorLogState.lockedClientId;
    const scopeErrors = (q) => lockedId ? q.eq('client_id', lockedId) : scopeQueryToBusinessClients(q, 'client_id');
    if (lockedId && window.IS_GUEST === true) {
        const managed = getBusinessScopeClientIds();
        const allowed = String(lockedId) === String(state.loginClientId) || (managed && managed.has(String(lockedId)));
        if (!allowed) { OL.errorLogState.loading = false; OL.errorLogState.rows = []; return; }
    }

    let query = scopeErrors(db.from('error_log').select('*'));

    if (OL.errorLogState.lockedClientId) {
        query = query.eq('client_id', OL.errorLogState.lockedClientId);
    } else if (OL.errorLogState.clientFilter === '__unassigned') {
        query = query.is('client_id', null);
    } else if (OL.errorLogState.clientFilter) {
        query = query.eq('client_id', OL.errorLogState.clientFilter);
    }

    if (OL.errorLogState.statusFilter !== 'all') {
        query = query.eq('status', OL.errorLogState.statusFilter);
    }
    if (OL.errorLogState.serviceFilter) {
        query = query.eq('service', OL.errorLogState.serviceFilter);
    }
    if (OL.errorLogState.resourceFilter) {
        query = query.eq('resource_name', OL.errorLogState.resourceFilter);
    }
    if (OL.errorLogState.query.trim()) {
        const q = OL.errorLogState.query.trim();
        query = query.or(`title.ilike.%${q}%,message.ilike.%${q}%`);
    }

    const { data, error } = await query.order('occurred_at', { ascending: false }).limit(300);
    OL.errorLogState.loading = false;

    if (error) { console.error('Failed to load error log:', error.message); OL.errorLogState.rows = []; return; }
    OL.errorLogState.rows = (data || []).filter(r => lockedId || isInBusinessScope(r.client_id));

    // Populate the service filter dropdown from whatever's actually in the table
    const { data: serviceRows } = await scopeErrors(db.from('error_log').select('service').not('service', 'is', null));
    OL.errorLogState.services = [...new Set((serviceRows || []).map(r => r.service).filter(Boolean))].sort();

    // Same, for the resource filter dropdown
    const { data: resourceRows } = await scopeErrors(db.from('error_log').select('resource_name').not('resource_name', 'is', null));
    OL.errorLogState.resources = [...new Set((resourceRows || []).map(r => r.resource_name).filter(Boolean))].sort();
};

OL.assignErrorClient = async function(id, clientId) {
    // Changing the project invalidates any resource assignment from the
    // previous project's resource list.
    const { error } = await db.from('error_log').update({ client_id: clientId || null, resource_id: null, resource_name: null }).eq('id', id);
    if (error) { alert('Failed to assign client: ' + error.message); return; }
    const row = OL.errorLogState.rows.find(r => r.id === id);
    if (row) { row.client_id = clientId || null; row.resource_id = null; row.resource_name = null; }
};

// Used by the detail modal's Project select — reopens the modal afterward so
// the Resource dropdown refreshes to the newly-selected project's resources.
OL.assignErrorClientAndRefreshModal = async function(id, clientId) {
    await OL.assignErrorClient(id, clientId);
    OL.openErrorDetailModal(id);
};

OL.assignErrorResource = async function(id, resourceId) {
    const row = OL.errorLogState.rows.find(r => r.id === id);
    const clientId = row?.client_id || OL.errorLogState.lockedClientId;

    if (resourceId === '__create_new') {
        const defaultName = row?.title || row?.service || 'New Zap';
        const name = prompt('Name this resource:', defaultName);
        if (!name || !name.trim()) return;

        const newId = uid();
        const link = row?.zap_link || (row?.root_id ? `https://zapier.com/editor/${row.root_id}` : '');

        await updateAndSync(() => {
            const client = state.clients[clientId];
            if (!client) return;
            if (!client.projectData) client.projectData = {};
            if (!client.projectData.localResources) client.projectData.localResources = [];
            client.projectData.localResources.push({
                id: newId,
                name: name.trim(),
                type: 'Zap',
                archetype: 'Multi-Step',
                category: 'Flows',
                visible: true,
                steps: [],
                externalUrl: link
            });
        }, clientId);

        resourceId = newId;
        // Fall through to the normal assignment below, using the new resource.
    }

    const resource = (state.clients[clientId]?.projectData?.localResources || []).find(res => res.id === resourceId);

    const { error } = await db.from('error_log').update({ resource_id: resourceId || null, resource_name: resource?.name || null }).eq('id', id);
    if (error) { alert('Failed to assign resource: ' + error.message); return; }
    if (row) { row.resource_id = resourceId || null; row.resource_name = resource?.name || null; }

    // First time this resource gets linked to a Zap error and it doesn't
    // have its External Link set yet — fill it in from this error's Zap
    // link, so future errors from the same Zap auto-match by root_id.
    if (resource && !resource.externalUrl && (row?.zap_link || row?.root_id)) {
        const link = row.zap_link || `https://zapier.com/editor/${row.root_id}`;
        updateAndSync(() => {
            const client = state.clients[clientId];
            const res = client?.projectData?.localResources?.find(r => r.id === resourceId);
            if (res) res.externalUrl = link;
        }, clientId);
    }

    OL.openErrorDetailModal(id);
};

// Status dropdown — also stamps/clears Resolution Date automatically
// (never overwrites a Resolution Date you've already set by hand).
OL.updateErrorStatus = async function(id, newStatus, opts = {}) {
    // Completing an error needs its cause, resolution and notes (see COMPLETE ERROR below). opts.skipGate is
    // only set by that flow itself, once the fields are filled in; opts.extra carries them into the same update.
    if (newStatus === 'resolved' && !opts.skipGate) {
        await OL.requestCompleteError(id);
        OL._rerenderErrorLog();   // safety net for any caller that flipped a control to "Complete" first
        return false;
    }

    const row = OL.errorLogState.rows.find(r => r.id === id);
    const updates = { status: newStatus, ...(opts.extra || {}) };
    if (newStatus === 'resolved' && !row?.resolution_date) updates.resolution_date = new Date().toISOString();
    if (newStatus === 'open') updates.resolution_date = null;

    const { error } = await db.from('error_log').update(updates).eq('id', id);
    if (error) { alert('Failed to update status: ' + error.message); return false; }

    if (OL.errorLogState.statusFilter !== 'all') {
        // toggled out of the current filter view — just reload
        await OL.loadErrorLog();
        OL._rerenderErrorLog();
    } else {
        if (row) Object.assign(row, updates);
        OL._rerenderErrorLog();
    }
    return true;
};

// Same as above, but for use inside the detail modal — re-opens the modal
// afterward (or closes it, if the row toggled out of the current filter).
OL.updateErrorStatusAndRefreshModal = async function(id, newStatus) {
    await OL.updateErrorStatus(id, newStatus);
    const stillPresent = OL.errorLogState.rows.find(r => r.id === id);
    if (stillPresent) OL.openErrorDetailModal(id);
    else OL.closeModal();
};

OL.saveErrorField = async function(id, field, value) {
    const { error } = await db.from('error_log').update({ [field]: value }).eq('id', id);
    if (error) { console.error(`Failed to save ${field}:`, error.message); return; }
    const row = OL.errorLogState.rows.find(r => r.id === id);
    if (row) row[field] = value;
};

// Notes has its own save (rather than going through the generic
// saveErrorField above) because it also needs to extract @mentions from
// the text on save, same as task/event comments do.
OL.saveErrorNotes = async function(id) {
    const editor = document.getElementById(`task-comment-editor-notes-${id}`);
    if (!editor) return;
    const text = (editor.innerText || '').trim();
    const mentions = OL.extractMentions ? OL.extractMentions(text) : [];

    const { error } = await db.from('error_log').update({ notes: text, notes_mentions: mentions }).eq('id', id);
    if (error) { console.error('Failed to save notes:', error.message); return; }

    const row = OL.errorLogState.rows.find(r => r.id === id);
    if (row) { row.notes = text; row.notes_mentions = mentions; }
};

OL.markErrorNoteViewed = async function(id) {
    const currentUserName = OL.getCurrentUserName ? OL.getCurrentUserName() : 'Sphynx Team';
    const row = OL.errorLogState.rows.find(r => r.id === id);
    if (!row) return;

    const viewedBy = row.notes_viewed_by || [];
    if (viewedBy.some(v => v.name === currentUserName)) return;
    const updated = [...viewedBy, { name: currentUserName, date: new Date().toISOString() }];

    const { error } = await db.from('error_log').update({ notes_viewed_by: updated }).eq('id', id);
    if (error) { alert('Failed to save: ' + error.message); return; }

    row.notes_viewed_by = updated;
    OL.openErrorDetailModal(id);
};

OL.saveErrorDateField = async function(id, field, value) {
    const iso = value ? new Date(value + 'T00:00:00').toISOString() : null;
    const { error } = await db.from('error_log').update({ [field]: iso }).eq('id', id);
    if (error) { console.error(`Failed to save ${field}:`, error.message); return; }
    const row = OL.errorLogState.rows.find(r => r.id === id);
    if (row) row[field] = iso;
    OL._rerenderErrorLog();
};

// -------------------------------------------------------------
// DETAIL MODAL — compact header strip (status pill + tag row for
// system/source/date/project/resource), message + links, then a
// cause/resolution/notes timeline. Resource tag opens a searchable picker.
// -------------------------------------------------------------
OL.openErrorDetailModal = async function(id) {
    let r = OL.errorLogState.rows.find(x => x.id === id);
    if (!r) {
        // Not in the in-memory cache yet — most likely this was opened
        // from somewhere that shows error rows without going through the
        // full Error Tracking list first (the Dashboard's activity feed
        // queries error_log directly, see dashboard.js). This used to
        // silently no-op here, which is why clicking an error card from
        // the Dashboard did nothing. Fetch it and splice it into the
        // cache so every in-modal action below (resolve, comment, etc. —
        // which all look the row up via this same array) keeps working
        // once the modal's open.
        const { data, error } = await db.from('error_log').select('*').eq('id', id).single();
        if (error || !data) { alert('Could not load that error.'); return; }
        r = data;
        OL.errorLogState.rows.push(r);
    }

    const locked = !!OL.errorLogState.lockedClientId;
    const clients = getBusinessScopedClients();
    const isResolved = r.status === 'resolved';
    const statusBg = isResolved ? 'rgba(34,197,94,0.15)' : 'rgba(245,158,11,0.15)';
    const statusColor = isResolved ? '#22c55e' : '#f59e0b';
    const occurred = r.occurred_at ? new Date(r.occurred_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Unknown';
    const sourceIcon = r.source === 'webhook' ? 'webhook' : (r.source === 'email' ? 'mail' : 'pencil');

    const html = `
        <div class="modal-head">
            <div class="modal-title-text"><i data-lucide="alert-triangle" style="width:16px;height:16px;vertical-align:-2px;margin-right:6px;"></i>${esc(r.title || r.service || 'Error Detail')}</div>
            <button class="btn small soft" onclick="OL.closeModal()">Close</button>
        </div>
        <div class="modal-body" style="max-width:600px; width:100%;">

            <div style="display:flex; justify-content:flex-end; align-items:center; gap:8px; margin-bottom:10px;">
                ${OL.renderErrorTaskButton(r)}
                <button type="button" class="btn tiny soft" onclick="OL.emailErrorInContext('${r.id}')" title="Open an email draft with this error's details inside it">${ic('mail')}Send email</button>
                <select class="tiny" style="border:none; border-radius:14px; padding:4px 10px; cursor:pointer; background:${statusBg}; color:${statusColor}; font-weight:bold;" onchange="OL.onErrorStatusSelect(this, '${r.id}', true)">
                    <option value="open" ${!isResolved ? 'selected' : ''}>Open</option>
                    <option value="resolved" ${isResolved ? 'selected' : ''}>Complete</option>
                </select>
            </div>

            <div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:16px; align-items:center;">
                ${r.service ? `<span class="pill tiny soft" style="border:none;">${ic('wrench')}${esc(r.service)}</span>` : ''}
                <span class="pill tiny soft" style="border:none;">${ic(sourceIcon)}${esc(r.source)}</span>
                <span class="pill tiny soft" style="border:none;">${ic('calendar')}${esc(occurred)}</span>
                ${!locked ? `
                    <select class="pill tiny soft" style="border:none; cursor:pointer;" onchange="OL.assignErrorClientAndRefreshModal('${r.id}', this.value)">
                        <option value="">Unassigned</option>
                        ${clients.map(c => `<option value="${c.id}" ${r.client_id === c.id ? 'selected' : ''}>${esc(c.meta?.name || 'Unnamed')}</option>`).join('')}
                    </select>
                    ${r.client_id ? `<span class="pill tiny soft" style="cursor:pointer;" title="Click to copy" onclick="navigator.clipboard.writeText('${r.client_id}'); alert('Copied Client ID: ${r.client_id}');">${ic('hash')}${esc(r.client_id)}</span>` : ''}
                ` : ''}
                <span id="error-resource-tag"></span>
            </div>

            <div style="border-top:1px solid var(--line); padding-top:14px; margin-bottom:14px;">
                <div style="white-space:pre-wrap; line-height:1.6; font-size:13px;">${esc(r.message || '')}</div>
                ${(r.history_link || r.zap_link) ? `
                    <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:10px;">
                        ${r.history_link ? `<a href="${r.history_link}" target="_blank" class="btn tiny soft" style="text-decoration:none;">History Link</a>` : ''}
                        ${r.zap_link ? `<a href="${r.zap_link}" target="_blank" class="btn tiny soft" style="text-decoration:none;">Zap Link</a>` : ''}
                    </div>
                ` : ''}
            </div>

            <div id="error-recurring-suggestion-${r.id}"></div>

            <div style="border-top:1px solid var(--line); padding-top:14px; display:flex; flex-direction:column; gap:14px;">
                <div style="display:flex; gap:10px; align-items:flex-start;">
                    <div style="width:8px; height:8px; border-radius:50%; background:#f59e0b; margin-top:8px; flex-shrink:0;"></div>
                    <div style="flex:1; min-width:0;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                            <label class="tiny muted bold" style="display:block; margin-bottom:4px;">Cause</label>
                            <select class="tiny" style="border:none; background:transparent; color:var(--accent); cursor:pointer;" onchange="OL.insertCauseTemplate('${r.id}', this.value); this.selectedIndex=0;">
                                <option value="">+ Insert template...</option>
                                ${CAUSE_TEMPLATES.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('')}
                            </select>
                        </div>
                        <textarea id="error-cause-${r.id}" class="modal-input tiny" rows="2" style="width:100%; box-sizing:border-box; text-align:left;" placeholder="What caused this?" onblur="OL.saveErrorField('${r.id}', 'cause', this.value)">${esc(r.cause || '')}</textarea>
                    </div>
                </div>
                <div style="display:flex; gap:10px; align-items:flex-start;">
                    <div style="width:8px; height:8px; border-radius:50%; background:#22c55e; margin-top:8px; flex-shrink:0;"></div>
                    <div style="flex:1; min-width:0;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                            <label class="tiny muted bold">Resolution</label>
                            <select class="tiny" style="border:none; background:transparent; color:var(--accent); cursor:pointer;" onchange="OL.insertResolutionTemplate('${r.id}', this.value); this.selectedIndex=0;">
                                <option value="">+ Insert template...</option>
                                ${RESOLUTION_TEMPLATES.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('')}
                            </select>
                        </div>
                        <textarea id="error-resolution-${r.id}" class="modal-input tiny" rows="2" style="width:100%; box-sizing:border-box; text-align:left;" placeholder="How was it fixed?" onblur="OL.saveErrorField('${r.id}', 'resolution', this.value)">${esc(r.resolution || '')}</textarea>
                    </div>
                </div>
                <div style="display:flex; gap:10px; align-items:flex-start;">
                    <div style="width:8px; height:8px; border-radius:50%; background:var(--accent); margin-top:8px; flex-shrink:0;"></div>
                    <div style="flex:1; min-width:0;">
                        ${isResolved && r.resolution_date ? `
                            <div class="tiny muted" style="margin-bottom:8px;">${ic('calendar-check')}Resolved ${esc(new Date(r.resolution_date).toLocaleDateString([], { dateStyle: 'medium' }))}</div>
                        ` : ''}
                        <label class="tiny muted bold" style="display:block; margin-bottom:4px;">Additional Notes</label>
                        <div style="position:relative;">
                            <div id="task-comment-editor-notes-${r.id}" contenteditable="true" class="modal-input tiny"
                                 style="min-height:50px; max-height:200px; overflow-y:auto; padding:6px; line-height:1.4; text-align:left;"
                                 oninput="OL.handleCommentMentionInput(this, 'notes-${r.id}')"
                                 onkeydown="OL.handleCommentMentionKeydown(event, 'notes-${r.id}')"
                                 onblur="OL.saveErrorNotes('${r.id}')">${r.notes ? esc(r.notes) : ''}</div>
                            <div id="comment-mention-dropdown-notes-${r.id}"></div>
                        </div>
                        ${(() => {
                            const currentUserName = OL.getCurrentUserName ? OL.getCurrentUserName() : 'Sphynx Team';
                            const notesMentions = r.notes_mentions || [];
                            const notesViewedBy = r.notes_viewed_by || [];
                            const isMentioned = notesMentions.some(m => m.name === currentUserName);
                            const alreadyViewed = notesViewedBy.some(v => v.name === currentUserName);
                            const viewedNames = notesViewedBy.map(v => v.name);
                            return `
                                ${isMentioned && !alreadyViewed ? `
                                    <label class="tiny" style="display:flex; align-items:center; gap:5px; margin-top:6px; cursor:pointer; color:var(--accent);">
                                        <input type="checkbox" onclick="OL.markErrorNoteViewed('${r.id}')" style="cursor:pointer; margin:0;">
                                        You were tagged — mark as viewed
                                    </label>
                                ` : ''}
                                ${viewedNames.length ? `
                                    <div class="tiny muted" style="margin-top:4px; font-style:italic;">${esc(viewedNames.join(', '))} viewed this note</div>
                                ` : ''}
                            `;
                        })()}
                    </div>
                </div>
            </div>
        </div>
    `;
    openModal(html);
    if (window.lucide) lucide.createIcons();
    OL._resourcePickerOpen = false;
    OL.renderResourceTag(id);

    // Only worth checking when there's nothing filled in yet — an error
    // that already has its own cause/resolution shouldn't get overwritten
    // by a suggestion from a different occurrence.
    if (!r.cause && !r.resolution) OL.loadRecurringErrorSuggestion(r);
};
window.OL.openErrorDetailModal = OL.openErrorDetailModal;

// -------------------------------------------------------------
// RECURRING-ERROR PREFILL — "recurring" is defined as same service + same
// title (the Zap/step name, which stays constant across runs even though
// the exact message details vary run to run) on a past RESOLVED error that
// actually has a cause and/or resolution written down. Suggested, never
// applied automatically — a banner offers it, the user decides.
// -------------------------------------------------------------
// Opens the compose window with this error's details already in the draft, addressed to the project's primary
// contact(s) when the error is matched to a project. The draft is linked to the project (and resource, when
// known) so the sent email files itself there. Cause, resolution and notes are included only if filled in.
OL.emailErrorInContext = function(id) {
    const r = OL.errorLogState.rows.find(x => x.id === id);
    if (!r) return;
    const client = r.client_id ? state.clients?.[r.client_id] : null;
    const team = client?.projectData?.teamMembers || [];
    const contacts = team.filter(m => m.email && m.isPrimaryContact);
    const to = (contacts.length ? contacts : team.filter(m => m.email).slice(0, 1)).map(m => m.email).join(', ');
    const names = (contacts.length ? contacts : team.filter(m => m.email).slice(0, 1)).map(m => String(m.name || '').split(' ')[0]).filter(Boolean);
    const occurred = r.occurred_at ? new Date(r.occurred_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '';
    // One full-width row per field ("Automation: …") instead of a label column beside a value column — the
    // two-column version squeezed long values into a narrow strip that wrapped word by word in most mail apps.
    const row = (label, value) => value ? `<tr><td style="padding:3px 0;"><span style="color:#64748b;">${esc(label)}:</span> ${esc(value)}</td></tr>` : '';
    const link = r.history_link ? `<p><a href="${esc(r.history_link)}">View the run in Zapier</a></p>` : '';
    const bodyHtml = `<p>Hi ${esc(names.length ? names.join(' and ') : 'there')},</p>`
        + `<p>We noticed an error on one of your automations and wanted to let you know.</p>`
        + `<table role="presentation" style="border-collapse:collapse; width:100%;">${row('Automation', r.title || r.service)}${row('Service', r.service)}${row('When', occurred)}</table>`
        + (r.message ? `<p style="white-space:pre-wrap;">${esc(r.message)}</p>` : '')
        + (r.cause ? `<p><strong>Likely cause:</strong> ${esc(r.cause)}</p>` : '')
        + (r.resolution ? `<p><strong>What we did:</strong> ${esc(r.resolution)}</p>` : '')
        + link;
    if (typeof OL.openComposeEmailModal !== 'function') { alert('Email is not available here.'); return; }
    OL.closeModal?.();
    OL.openComposeEmailModal({
        title: `✉️ Email about error${client ? ' · ' + (client.meta?.name || '') : ''}`,
        to,
        subject: `${client?.meta?.name ? client.meta.name + ' — ' : ''}Error: ${r.title || r.service || 'automation'}`,
        bodyHtml,
        linked_client_id: r.client_id || null,
        linked_resource_id: r.resource_id || null,
    });
};

OL.findRecurringErrorMatch = async function(r) {
    if (!r.service && !r.title) return null; // nothing distinctive enough to match on

    let query = db.from('error_log')
        .select('id, cause, resolution, occurred_at')
        .eq('status', 'resolved')
        .neq('id', r.id)
        .order('occurred_at', { ascending: false })
        .limit(1);

    if (r.service) query = query.eq('service', r.service);
    if (r.title) query = query.eq('title', r.title);

    const { data, error } = await query.maybeSingle();
    if (error || !data) return null;
    if (!data.cause && !data.resolution) return null; // no point suggesting an empty match
    return data;
};

OL.loadRecurringErrorSuggestion = async function(r) {
    const match = await OL.findRecurringErrorMatch(r);
    const container = document.getElementById(`error-recurring-suggestion-${r.id}`);
    if (!container) return; // modal closed before the lookup finished

    if (!match) { container.innerHTML = ''; return; }

    OL._recurringSuggestions = OL._recurringSuggestions || {};
    OL._recurringSuggestions[r.id] = match;

    container.innerHTML = `
        <div style="display:flex; align-items:center; gap:10px; padding:10px 12px; margin-bottom:14px; background:rgba(var(--accent-rgb),0.08); border:1px solid var(--accent); border-radius:8px;">
            <i data-lucide="repeat" style="width:14px;height:14px;color:var(--accent);flex-shrink:0;"></i>
            <div class="tiny" style="flex:1; min-width:0;">This looks like a recurring error — a past occurrence has a cause/resolution on file.</div>
            <button class="btn tiny primary" style="flex-shrink:0;" onclick="OL.applyRecurringErrorSuggestion('${r.id}')">Use It</button>
        </div>
    `;
    if (window.lucide) lucide.createIcons();
};

OL.applyRecurringErrorSuggestion = async function(id) {
    const match = OL._recurringSuggestions?.[id];
    if (!match) return;

    const causeEl = document.getElementById(`error-cause-${id}`);
    const resolutionEl = document.getElementById(`error-resolution-${id}`);
    if (causeEl && match.cause) causeEl.value = match.cause;
    if (resolutionEl && match.resolution) resolutionEl.value = match.resolution;

    const updates = {};
    if (match.cause) updates.cause = match.cause;
    if (match.resolution) updates.resolution = match.resolution;

    const { error } = await db.from('error_log').update(updates).eq('id', id);
    if (error) { alert('Failed to apply suggestion: ' + error.message); return; }

    const row = OL.errorLogState.rows.find(r => r.id === id);
    if (row) Object.assign(row, updates);

    const container = document.getElementById(`error-recurring-suggestion-${id}`);
    if (container) container.innerHTML = '';
};

// -------------------------------------------------------------
// SEARCHABLE RESOURCE PICKER — renders into #error-resource-tag,
// a compact pill by default, expanding into a search box + filtered
// list (including "+ Create new resource") when clicked.
// -------------------------------------------------------------
OL.renderResourceTag = function(id) {
    const container = document.getElementById('error-resource-tag');
    if (!container) return;

    const r = OL.errorLogState.rows.find(x => x.id === id);
    if (!r) return;

    const clientId = r.client_id || OL.errorLogState.lockedClientId;
    if (!clientId) {
        container.outerHTML = `<span id="error-resource-tag" class="tiny muted">Assign a project to link a resource</span>`;
        return;
    }

    if (!OL._resourcePickerOpen) {
        container.outerHTML = `<span id="error-resource-tag" class="pill tiny soft" style="border:none; background:rgba(var(--accent-rgb),0.15); color:var(--accent); cursor:pointer;" onclick="OL.openResourcePicker('${id}')">${ic('git-branch')}${r.resource_name ? esc(r.resource_name) : 'Link a resource'}</span>`;
        if (window.lucide) lucide.createIcons();
        return;
    }

    const resources = state.clients[clientId]?.projectData?.localResources || [];
    const q = (OL._resourcePickerQuery || '').trim().toLowerCase();
    const filtered = q ? resources.filter(res => (res.name || '').toLowerCase().includes(q)) : resources;

    container.outerHTML = `
        <span id="error-resource-tag" style="display:inline-flex; flex-direction:column; gap:4px; width:220px;">
            <input type="text" class="modal-input tiny" placeholder="Search resources..." value="${esc(OL._resourcePickerQuery || '')}" oninput="OL.setResourcePickerQuery(this.value, '${id}')" autofocus>
            <div style="max-height:160px; overflow:auto; display:flex; flex-direction:column; gap:2px; background:var(--panel-soft, rgba(0,0,0,0.02)); border:1px solid var(--line); border-radius:6px; padding:4px;">
                <div class="tiny" style="padding:5px 8px; cursor:pointer; color:var(--accent);" onclick="OL.pickResource('${id}', '__create_new')">${ic('plus')}Create new resource...</div>
                ${r.resource_id ? `<div class="tiny" style="padding:5px 8px; cursor:pointer;" onclick="OL.pickResource('${id}', '')">${ic('x')}Remove current link</div>` : ''}
                ${filtered.length ? filtered.map(res => `
                    <div class="tiny" style="padding:5px 8px; cursor:pointer; ${res.id === r.resource_id ? 'font-weight:bold;' : ''}" onclick="OL.pickResource('${id}', '${res.id}')">${esc(res.name)}</div>
                `).join('') : `<div class="tiny muted" style="padding:5px 8px;">No matching resources.</div>`}
            </div>
        </span>
    `;
    if (window.lucide) lucide.createIcons();
};

OL.openResourcePicker = function(id) {
    OL._resourcePickerOpen = true;
    OL._resourcePickerQuery = '';
    OL.renderResourceTag(id);
};

OL.setResourcePickerQuery = function(value, id) {
    OL._resourcePickerQuery = value;
    OL.renderResourceTag(id);
};

OL.pickResource = async function(id, resourceId) {
    OL._resourcePickerOpen = false;
    await OL.assignErrorResource(id, resourceId);
    // assignErrorResource already reopens the full modal
};

// -------------------------------------------------------------
// MANUAL ADD
// -------------------------------------------------------------
OL.openAddErrorModal = function() {
    const locked = OL.errorLogState.lockedClientId;
    const lockedClientName = locked ? (state.clients[locked]?.meta?.name || 'This project') : null;
    const clients = getBusinessScopedClients();

    const html = `
        <div class="modal-head">
            <div class="modal-title-text"><i data-lucide="plus-circle" style="width:16px;height:16px;vertical-align:-2px;margin-right:6px;"></i>Add Error / Quirk</div>
            <button class="btn small soft" onclick="OL.closeModal()">Close</button>
        </div>
        <div class="modal-body" style="max-width:500px; width:100%;">
            <div style="display:flex; flex-direction:column; gap:10px;">
                <div>
                    <label class="tiny muted bold">Client</label>
                    ${locked ? `
                        <input type="text" class="modal-input tiny" value="${esc(lockedClientName)}" disabled>
                    ` : `
                        ${OL.renderSearchableProjectPicker({
                            idPrefix: 'add-error-client',
                            clients: clients,
                            selectedId: '',
                            selectedLabel: '',
                            allOptionLabel: '-- Unassigned --',
                            placeholder: '-- Unassigned --'
                        })}
                    `}
                </div>
                <div>
                    <label class="tiny muted bold">Error (title)</label>
                    <input type="text" id="add-error-title" class="modal-input tiny" placeholder="Short summary">
                </div>
                <div>
                    <label class="tiny muted bold">System</label>
                    <input type="text" id="add-error-service" class="modal-input tiny" placeholder="e.g. RingCentral, Wealthbox">
                </div>
                <div>
                    <label class="tiny muted bold">Message *</label>
                    <textarea id="add-error-message" class="modal-input tiny" rows="3" placeholder="What happened?"></textarea>
                </div>
                <div>
                    <label class="tiny muted bold">Cause</label>
                    <textarea id="add-error-cause" class="modal-input tiny" rows="2"></textarea>
                </div>
                <div>
                    <label class="tiny muted bold">Resolution</label>
                    <textarea id="add-error-resolution" class="modal-input tiny" rows="2"></textarea>
                </div>
                <div>
                    <label class="tiny muted bold">Additional Notes</label>
                    <textarea id="add-error-notes" class="modal-input tiny" rows="2"></textarea>
                </div>
            </div>
            <div style="display:flex; justify-content:flex-end; margin-top:16px;">
                <button class="btn small primary" onclick="OL.saveManualError()" style="font-weight:bold;">Add Error</button>
            </div>
        </div>
    `;
    openModal(html);
    if (window.lucide) lucide.createIcons();
};

OL.saveManualError = async function() {
    const message = document.getElementById('add-error-message')?.value.trim();
    if (!message) { alert('Message is required.'); return; }

    const row = {
        client_id: OL.errorLogState.lockedClientId || document.getElementById('add-error-client-value')?.value || null,
        source: 'manual',
        title: document.getElementById('add-error-title')?.value.trim() || null,
        service: document.getElementById('add-error-service')?.value.trim() || null,
        message,
        cause: document.getElementById('add-error-cause')?.value.trim() || null,
        resolution: document.getElementById('add-error-resolution')?.value.trim() || null,
        notes: document.getElementById('add-error-notes')?.value.trim() || null,
        occurred_at: new Date().toISOString()
    };

    const { error } = await db.from('error_log').insert(row);
    if (error) { alert('Failed to add error: ' + error.message); return; }

    OL.closeModal();
    await OL.loadErrorLog();
    OL._rerenderErrorLog();
};

// =============================================================
// ERROR → TASK
//
// "Create task" on an error card opens a prefilled task modal (title "Error: <error title>", due today). The
// task carries the link (task.errorId, plus task.errorTitle for display), so nothing extra is stored on the
// error row and no database change is needed.
//
// Feed rules (Dashboard activity feed only — Error Tracking always lists every error):
//   • error open, no task ................ shown in the feed
//   • error open, task open .............. hidden from the feed (the task is now the thing to work)
//   • error open, task closed ............ back in the feed, and a prompt asks whether to complete the error
//   • task deleted ....................... back in the feed
// Visibility is worked out from the task's live status each time the feed renders, so it stays correct
// however the task got closed, reopened or deleted.
// =============================================================

// errorId -> { client, task } for every task that was created from an error. Built by one scan of the tasks
// already in memory; the cache is dropped on the next tick so a render never sees a stale answer.
OL._errorTaskMapCache = null;
OL.getErrorTaskMap = function() {
    if (OL._errorTaskMapCache) return OL._errorTaskMapCache;
    const map = new Map();
    Object.values(state.clients || {}).forEach(client => {
        (client?.projectData?.clientTasks || []).forEach(task => {
            if (task?.errorId && !map.has(String(task.errorId))) map.set(String(task.errorId), { client, task });
        });
    });
    OL._errorTaskMapCache = map;
    setTimeout(() => { OL._errorTaskMapCache = null; }, 0);
    return map;
};

OL._errorTaskIsClosed = function(task) {
    return typeof OL.isClosedStatus === 'function' ? OL.isClosedStatus(task?.status) : task?.status === 'Done';
};

// True while an open error has an open task working it — the Dashboard feed skips these.
OL.isErrorHiddenFromFeed = function(errorId) {
    const hit = OL.getErrorTaskMap().get(String(errorId));
    return !!hit && !OL._errorTaskIsClosed(hit.task);
};

// "Create task" — or "Open task" once one exists, so an error can't collect duplicate tasks by accident.
OL.renderErrorTaskButton = function(r) {
    const hit = OL.getErrorTaskMap().get(String(r.id));
    if (hit) {
        return `<button type="button" class="btn tiny soft" onclick="event.stopPropagation(); OL.openTaskInContext('${esc(String(hit.client.id))}', '${esc(String(hit.task.id))}')" title="Open the task created for this error">${ic('check-square')}Open task</button>`;
    }
    return `<button type="button" class="btn tiny soft" onclick="event.stopPropagation(); OL.openErrorTaskModal('${esc(String(r.id))}')" title="Create a task for this error">${ic('plus')}Create task</button>`;
};

// Small status pill for the tag row: shows the linked task's current status.
OL.renderErrorTaskPill = function(r) {
    const hit = OL.getErrorTaskMap().get(String(r.id));
    if (!hit) return '';
    const closed = OL._errorTaskIsClosed(hit.task);
    const color = closed ? '#22c55e' : 'var(--accent)';
    return `<span class="pill tiny soft" style="border:none; color:${color};" title="Task created for this error">${ic('check-square')}Task: ${esc(hit.task.status || 'Pending Sphynx Action')}</span>`;
};

// Banner shown at the top of the task modal for a task created from an error, with the way back.
OL.renderTaskErrorBanner = function(task) {
    if (!task?.errorId) return '';
    const label = task.errorTitle ? ` — ${esc(task.errorTitle)}` : '';
    return `
        <div style="margin:0 24px 12px 24px; display:flex; align-items:center; gap:10px; padding:10px 14px; border:1px solid rgba(245,158,11,0.35); border-radius:8px; background:rgba(245,158,11,0.08);">
            <i data-lucide="alert-triangle" style="width:14px;height:14px;color:#f59e0b;flex-shrink:0;"></i>
            <div class="tiny" style="flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;"><strong>Created from an error</strong>${label}</div>
            <button type="button" class="btn tiny soft" style="flex-shrink:0;" onclick="OL.openErrorDetailModal('${esc(String(task.errorId))}')">${ic('alert-triangle')}Open error card</button>
        </div>
    `;
};

// The row from the in-memory list, or fetched when the error was opened from somewhere that never loaded it.
OL._getErrorRowById = async function(id) {
    let r = OL.errorLogState.rows.find(x => String(x.id) === String(id));
    if (r) return r;
    const { data, error } = await db.from('error_log').select('*').eq('id', id).single();
    if (error || !data) return null;
    OL.errorLogState.rows.push(data);
    return data;
};

OL.openErrorTaskModal = async function(id) {
    const r = await OL._getErrorRowById(id);
    if (!r) { alert('Could not load that error.'); return; }

    // Already has a task: open it rather than creating a second one.
    const existing = OL.getErrorTaskMap().get(String(r.id));
    if (existing) { OL.openTaskInContext(existing.client.id, existing.task.id); return; }

    const generalId = OL.GENERAL_PROJECT_ID;
    const clients = getBusinessScopedClients()
        .filter(c => c.id !== generalId)
        .sort((a, b) => String(a.meta?.name || '').localeCompare(String(b.meta?.name || '')));
    const preselected = (r.client_id && state.clients?.[r.client_id]) ? r.client_id : '';
    const openStatuses = (OL.getSystemStatuses ? OL.getSystemStatuses() : []).filter(s => !s.isClosed);
    const title = `Error: ${r.title || r.service || 'Automation error'}`;
    const today = OL.localDateStr();

    // .modal-input has no width of its own and its "tiny" size centers text, so every field is sized and aligned
    // explicitly here; labels are blocks so they sit above their field instead of beside it.
    const F = 'display:block; width:100%; box-sizing:border-box; text-align:left; font-size:13px; padding:8px 10px; border-radius:8px;';
    const L = 'display:block; margin-bottom:4px;';
    const html = `
        <div class="modal-head">
            <div class="modal-title-text"><i data-lucide="check-square" style="width:16px;height:16px;vertical-align:-2px;margin-right:6px;"></i>Create Task from Error</div>
            <button class="btn small soft" onclick="OL.closeModal()">Close</button>
        </div>
        <div class="modal-body" style="width:min(560px, 92vw); box-sizing:border-box;">
            <div style="display:flex; flex-direction:column; gap:14px; width:100%;">
                <div style="display:flex; justify-content:flex-start;">
                    <button type="button" class="btn tiny soft" onclick="OL.openErrorDetailModal('${esc(String(r.id))}')" title="Open the error card (this form will close)">${ic('alert-triangle')}Open error card</button>
                </div>
                <div style="width:100%;">
                    <label class="tiny muted bold" style="${L}">Title *</label>
                    <input type="text" id="error-task-title" class="modal-input" style="${F}" value="${esc(title)}">
                </div>
                <div style="width:100%;">
                    <label class="tiny muted bold" style="${L}">Project</label>
                    <select id="error-task-client" class="modal-input" style="${F}" onchange="OL.refreshErrorTaskAssignees()">
                        <option value="" ${preselected ? '' : 'selected'}>General / Business Ops</option>
                        ${clients.map(c => `<option value="${esc(c.id)}" ${c.id === preselected ? 'selected' : ''}>${esc(c.meta?.name || 'Unnamed')}</option>`).join('')}
                    </select>
                </div>
                <div style="width:100%;">
                    <label class="tiny muted bold" style="${L}">Description</label>
                    <textarea id="error-task-desc" class="modal-input" rows="6" style="${F} resize:vertical; min-height:110px; line-height:1.45; font-family:inherit;">${esc(r.message || '')}</textarea>
                </div>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; width:100%;">
                    <div style="min-width:0;">
                        <label class="tiny muted bold" style="${L}">Assignee</label>
                        <select id="error-task-assignee" class="modal-input" style="${F}">${OL.buildQuickTaskAssigneeOptions(preselected)}</select>
                    </div>
                    <div style="min-width:0;">
                        <label class="tiny muted bold" style="${L}">Status</label>
                        <select id="error-task-status" class="modal-input" style="${F}">
                            ${(openStatuses.length ? openStatuses : [{ name: 'Pending Sphynx Action' }]).map(s => `<option value="${esc(s.name)}">${esc(s.name)}</option>`).join('')}
                        </select>
                    </div>
                </div>
                <div style="width:100%;">
                    <label class="tiny muted bold" style="${L}">Due Date</label>
                    <input type="date" id="error-task-duedate" class="modal-input" style="${F} max-width:220px;" value="${today}">
                </div>
                <div class="tiny muted">Once created, this error leaves your Dashboard feed until the task is closed.</div>
                <div style="display:flex; justify-content:flex-end; width:100%;">
                    <button class="btn small primary" onclick="OL.saveErrorTask('${esc(String(r.id))}')" style="font-weight:bold; padding:8px 18px;">Create Task</button>
                </div>
            </div>
        </div>
    `;
    openModal(html);
    if (window.lucide) lucide.createIcons();
};

// Project changed in the form: rebuild the assignee list for that project's team, keeping the pick if it's still there.
OL.refreshErrorTaskAssignees = function() {
    const clientId = document.getElementById('error-task-client')?.value || '';
    const sel = document.getElementById('error-task-assignee');
    if (!sel) return;
    const previous = sel.value;
    sel.innerHTML = OL.buildQuickTaskAssigneeOptions(clientId);
    if ([...sel.options].some(o => o.value === previous)) sel.value = previous;
};

OL.saveErrorTask = async function(errorId) {
    const title = document.getElementById('error-task-title')?.value.trim();
    if (!title) { alert('Title is required.'); return; }

    const description = document.getElementById('error-task-desc')?.value.trim() || '';
    const assignee = document.getElementById('error-task-assignee')?.value || 'Sphynx Task';
    const status = document.getElementById('error-task-status')?.value || 'Pending Sphynx Action';
    const dueDate = document.getElementById('error-task-duedate')?.value || OL.localDateStr();

    // No project picked: home it in General / Business Ops, same as the quick task creator does.
    let clientId = document.getElementById('error-task-client')?.value || '';
    if (!clientId) clientId = OL.ensureGeneralProject().id;

    // Guard against a double-click creating two tasks for one error.
    if (OL.getErrorTaskMap().get(String(errorId))) { OL.closeModal(); return; }

    const row = OL.errorLogState.rows.find(x => String(x.id) === String(errorId));

    await updateAndSync(() => {
        const client = state.clients[clientId];
        if (!client) return;
        if (!client.projectData) client.projectData = {};
        if (!client.projectData.clientTasks) client.projectData.clientTasks = [];

        client.projectData.clientTasks.unshift({
            id: uid(),
            title, name: title,
            description,
            status, assignee, dueDate,
            isClientTask: OL.computeIsClientTask(assignee),
            loggedHours: 0,
            createdAt: new Date().toISOString(),
            errorId: String(errorId),
            errorTitle: row?.title || row?.service || ''
        });
    }, clientId);

    OL._errorTaskMapCache = null;
    OL.closeModal();
    OL._rerenderErrorLog();   // Dashboard: the card drops out of the feed. Error Tracking: the card now shows the task.
};

// -------------------------------------------------------------
// TASK CLOSED, ERROR STILL OPEN — called from the task-completion hook (features/business/tasks.js) the
// moment a task created from an error becomes closed. The error is already back in the feed by then (see the
// feed rules above); this asks whether to complete it too. Prompts queue up, so closing several tasks at
// once (bulk edit) asks about each error in turn instead of stacking dialogs.
// -------------------------------------------------------------
OL._errorClosePromptQueue = [];
OL._errorClosePromptOpen = false;

OL.onErrorTaskClosed = function(clientId, task) {
    if (!task?.errorId) return;
    OL._errorTaskMapCache = null;
    const errorId = String(task.errorId);
    if (!OL._errorClosePromptQueue.some(q => q.errorId === errorId)) {
        OL._errorClosePromptQueue.push({ errorId, taskTitle: task.title || task.name || 'Task', closedAt: task.completedAt || new Date().toISOString() });
    }
    // Wait for the status change to finish saving and re-rendering before asking.
    setTimeout(() => OL._drainErrorClosePrompts(), 150);
};

OL._drainErrorClosePrompts = async function() {
    if (OL._errorClosePromptOpen) return;
    const next = OL._errorClosePromptQueue.shift();
    if (!next) return;

    OL._errorClosePromptOpen = true;
    try {
        const { data: err } = await db.from('error_log').select('id, title, service, status').eq('id', next.errorId).maybeSingle();
        // Gone, or already completed: nothing to ask.
        if (!err || err.status === 'resolved') { OL._finishErrorClosePrompt(); return; }
        OL._errorClosePromptCurrent = next;
        OL._showErrorClosePrompt(err, next.taskTitle);
    } catch (e) {
        console.error('Could not check the error for a closed task:', e);
        OL._finishErrorClosePrompt();
    }
};

OL._showErrorClosePrompt = function(err, taskTitle) {
    document.getElementById('error-close-prompt')?.remove();
    const id = esc(String(err.id));
    const wrap = document.createElement('div');
    wrap.id = 'error-close-prompt';
    // Its own layer above the modal layer, so it never replaces a task modal that is open behind it.
    wrap.style.cssText = 'position:fixed; inset:0; z-index:20000; display:flex; align-items:center; justify-content:center; background:rgba(2,6,23,0.6);';
    wrap.onclick = () => OL.dismissErrorClosePrompt();
    wrap.innerHTML = `
        <div class="card" style="max-width:440px; width:90vw; padding:20px; cursor:default;" onclick="event.stopPropagation();">
            <div style="display:flex; align-items:center; gap:8px; margin-bottom:10px; font-weight:bold;">
                <i data-lucide="alert-triangle" style="width:16px;height:16px;color:#f59e0b;"></i> Complete this error too?
            </div>
            <div class="small" style="line-height:1.5; margin-bottom:6px;">
                The task <strong>${esc(taskTitle)}</strong> is closed, but the error <strong>${esc(err.title || err.service || 'this error')}</strong> is still open.
            </div>
            <div class="tiny muted" style="margin-bottom:16px;">You'll be asked for the cause and resolution before it closes. If you leave it open, it stays in your Dashboard feed until it's marked complete.</div>
            <div style="display:flex; justify-content:flex-end; gap:8px; flex-wrap:wrap;">
                <button class="btn small soft" onclick="OL.dismissErrorClosePrompt()">Leave open</button>
                <button class="btn small soft" onclick="OL.dismissErrorClosePrompt(); OL.openErrorDetailModal('${id}')">Open error card</button>
                <button class="btn small primary" style="font-weight:bold;" onclick="OL.completeErrorFromPrompt('${id}')">Complete error</button>
            </div>
        </div>
    `;
    document.body.appendChild(wrap);
    if (window.lucide) lucide.createIcons();
};

OL._finishErrorClosePrompt = function() {
    document.getElementById('error-close-prompt')?.remove();
    OL._errorClosePromptOpen = false;
    if (OL._errorClosePromptQueue.length) setTimeout(() => OL._drainErrorClosePrompts(), 0);
};

// Leave open: the error stays in the feed (it already came back when the task closed); refresh so it shows.
OL.dismissErrorClosePrompt = function() {
    OL._finishErrorClosePrompt();
    OL._rerenderErrorLog();
};

// "Complete error" on the prompt: swap it for the cause / resolution / notes form (or complete straight away if
// those are already filled in). The queue moves on to the next prompt only once this one is finished or cancelled.
OL.completeErrorFromPrompt = async function(id) {
    document.getElementById('error-close-prompt')?.remove();
    const closedAt = OL._errorClosePromptCurrent?.closedAt;
    await OL.requestCompleteError(id, { fromTask: { closedAt }, onDone: () => OL._finishErrorClosePrompt() });
};

// =============================================================
// COMPLETE ERROR — cause and resolution are required before an error can be marked complete, so a closed error
// never goes into the log without its write-up. Notes are optional. Every route to "resolved" (the task-closed
// prompt, the status dropdown on a card, the dropdown in the detail modal) goes through OL.requestCompleteError,
// which completes straight away when both are already filled in and otherwise asks for them first.
//
// The dropdowns are reset to "Open" the moment "Complete" is picked (OL.onErrorStatusSelect) and only become
// "Complete" once the form is submitted, so cancelling leaves the error exactly as it was.
// =============================================================
OL._errorNeedsCloseout = function(row) {
    return !(row?.cause || '').trim() || !(row?.resolution || '').trim();
};

// Notes get a "Completed from task on <date>." line when the error is being completed because its task closed.
OL._withTaskCompletionNote = function(existingNotes, closedAt) {
    const when = new Date(closedAt || Date.now()).toLocaleDateString([], { dateStyle: 'medium' });
    const line = `Completed from task on ${when}.`;
    const cur = (existingNotes || '').trim();
    if (!cur) return line;
    return cur.includes(line) ? cur : `${cur}\n${line}`;
};

// A status dropdown changed. "Complete" is never applied by the dropdown itself: it snaps back to Open and the
// form (or, if cause and resolution are already filled in, a straight completion) takes over.
OL.onErrorStatusSelect = function(selectEl, id, inModal = false) {
    const value = selectEl.value;
    if (value === 'resolved') {
        selectEl.value = 'open';
        return OL.requestCompleteError(id, { onDone: (ok) => { if (ok && inModal) OL._refreshErrorModalAfterStatusChange(id); } });
    }
    return inModal ? OL.updateErrorStatusAndRefreshModal(id, value) : OL.updateErrorStatus(id, value);
};

OL._refreshErrorModalAfterStatusChange = function(id) {
    const stillPresent = OL.errorLogState.rows.find(r => r.id === id);
    if (stillPresent) OL.openErrorDetailModal(id);
    else OL.closeModal();
};

// opts.fromTask: { closedAt } — set when completing because the error's task was closed.
// opts.onDone(success) runs once the flow ends: true = the error is now complete, false = it was left open.
OL.requestCompleteError = async function(id, opts = {}) {
    const done = (ok) => { if (typeof opts.onDone === 'function') opts.onDone(ok); return ok; };

    // Read the latest from the database — notes typed in another tab or just saved on blur count.
    const { data: row } = await db.from('error_log').select('id, title, service, cause, resolution, notes, status').eq('id', id).maybeSingle();
    if (!row) { alert('Could not load that error.'); return done(false); }
    if (row.status === 'resolved') return done(true);

    const notes = opts.fromTask ? OL._withTaskCompletionNote(row.notes, opts.fromTask.closedAt) : (row.notes || '');

    if (!OL._errorNeedsCloseout(row)) {
        const extra = notes !== (row.notes || '') ? { notes, notes_mentions: OL.extractMentions ? OL.extractMentions(notes) : [] } : undefined;
        const ok = await OL.updateErrorStatus(id, 'resolved', { skipGate: true, extra });
        return done(ok !== false);
    }

    OL._showErrorCompleteForm({ ...row, notes }, opts);
    return false;
};

OL._showErrorCompleteForm = function(row, opts = {}) {
    document.getElementById('error-complete-form')?.remove();
    OL._errorCompleteCtx = { id: row.id, opts };
    const id = esc(String(row.id));
    const F = 'display:block; width:100%; box-sizing:border-box; text-align:left; font-size:13px; padding:8px 10px; border-radius:8px; font-family:inherit; line-height:1.45;';
    const L = 'display:block; margin-bottom:4px;';
    const tplSelect = (targetId, list) => `
        <select class="tiny" style="border:none; background:transparent; color:var(--accent); cursor:pointer;" onchange="OL._ecfInsertTemplate('${targetId}', this.value); this.selectedIndex=0;">
            <option value="">+ Insert template...</option>
            ${list.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('')}
        </select>`;

    const wrap = document.createElement('div');
    wrap.id = 'error-complete-form';
    // Its own layer above everything (including the close prompt and any task modal behind it). Clicking the
    // backdrop does nothing on purpose, so typed text is never lost by accident; Cancel is the way out.
    wrap.style.cssText = 'position:fixed; inset:0; z-index:20001; display:flex; align-items:center; justify-content:center; background:rgba(2,6,23,0.65);';
    wrap.innerHTML = `
        <div class="card" style="width:min(580px, 92vw); max-height:90vh; overflow-y:auto; padding:22px; box-sizing:border-box; cursor:default;">
            <div style="display:flex; align-items:center; gap:8px; font-weight:bold; margin-bottom:4px;">
                <i data-lucide="check-circle" style="width:16px;height:16px;color:#22c55e;"></i> Complete this error
            </div>
            <div class="tiny muted" style="margin-bottom:16px; line-height:1.5;">
                <strong>${esc(row.title || row.service || 'Untitled Error')}</strong> — log what happened before it's closed. Cause and resolution are required.
            </div>
            <div style="display:flex; flex-direction:column; gap:14px;">
                <div>
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                        <label class="tiny muted bold">Cause <span style="color:#ef4444;">*</span></label>
                        ${tplSelect('ecf-cause', CAUSE_TEMPLATES)}
                    </div>
                    <textarea id="ecf-cause" class="modal-input" rows="3" style="${F} resize:vertical;" placeholder="What caused this?">${esc(row.cause || '')}</textarea>
                </div>
                <div>
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                        <label class="tiny muted bold">Resolution <span style="color:#ef4444;">*</span></label>
                        ${tplSelect('ecf-resolution', RESOLUTION_TEMPLATES)}
                    </div>
                    <textarea id="ecf-resolution" class="modal-input" rows="3" style="${F} resize:vertical;" placeholder="How was it fixed?">${esc(row.resolution || '')}</textarea>
                </div>
                <div>
                    <label class="tiny muted bold" style="${L}">Additional Notes <span style="font-weight:normal;">(optional)</span></label>
                    <div style="position:relative;">
                        <div id="task-comment-editor-notes-done-${id}" contenteditable="true" class="modal-input"
                             style="${F} min-height:70px; max-height:200px; overflow-y:auto;"
                             oninput="OL.handleCommentMentionInput(this, 'notes-done-${id}')"
                             onkeydown="OL.handleCommentMentionKeydown(event, 'notes-done-${id}')">${esc(row.notes || '')}</div>
                        <div id="comment-mention-dropdown-notes-done-${id}"></div>
                    </div>
                    <div class="tiny muted" style="margin-top:4px;">Anything worth knowing next time — type @ to mention a teammate.</div>
                </div>
                <div id="ecf-error" class="tiny" style="color:#ef4444; display:none;"></div>
                <div style="display:flex; justify-content:flex-end; gap:8px;">
                    <button class="btn small soft" onclick="OL.cancelErrorCompleteForm()">Cancel</button>
                    <button id="ecf-submit" class="btn small primary" style="font-weight:bold;" onclick="OL.submitErrorCompleteForm()">Complete error</button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(wrap);
    if (window.lucide) lucide.createIcons();
    // Land on the first empty field.
    const first = ['ecf-cause', 'ecf-resolution'].map(x => document.getElementById(x)).find(el => el && !el.value.trim())
        || document.getElementById(`task-comment-editor-notes-done-${row.id}`);
    first?.focus();
};

OL._ecfInsertTemplate = function(targetId, template) {
    if (!template) return;
    const ta = document.getElementById(targetId);
    if (!ta) return;
    ta.value = ta.value.trim() ? `${ta.value}\n${template}` : template;
    ta.focus();
};

OL.cancelErrorCompleteForm = function() {
    const ctx = OL._errorCompleteCtx;
    document.getElementById('error-complete-form')?.remove();
    OL._errorCompleteCtx = null;
    if (ctx?.opts && typeof ctx.opts.onDone === 'function') ctx.opts.onDone(false);
};

OL.submitErrorCompleteForm = async function() {
    const ctx = OL._errorCompleteCtx;
    if (!ctx) return;
    const cause = document.getElementById('ecf-cause')?.value.trim() || '';
    const resolution = document.getElementById('ecf-resolution')?.value.trim() || '';
    const notes = (document.getElementById(`task-comment-editor-notes-done-${ctx.id}`)?.innerText || '').trim();

    const missing = [!cause && 'Cause', !resolution && 'Resolution'].filter(Boolean);
    const errEl = document.getElementById('ecf-error');
    if (missing.length) {
        if (errEl) { errEl.textContent = `Please fill in: ${missing.join(', ')}.`; errEl.style.display = 'block'; }
        return;
    }
    if (errEl) errEl.style.display = 'none';

    const btn = document.getElementById('ecf-submit');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }

    const mentions = notes && OL.extractMentions ? OL.extractMentions(notes) : [];
    const ok = await OL.updateErrorStatus(ctx.id, 'resolved', { skipGate: true, extra: { cause, resolution, notes, notes_mentions: mentions } });
    if (ok === false) {   // the save failed (an alert already said why): keep the form open so nothing typed is lost
        if (btn) { btn.disabled = false; btn.textContent = 'Complete error'; }
        return;
    }
    document.getElementById('error-complete-form')?.remove();
    OL._errorCompleteCtx = null;
    if (typeof ctx.opts.onDone === 'function') ctx.opts.onDone(true);
};


window.OL.renderBusinessErrorLog = OL.renderBusinessErrorLog;
window.OL.renderClientErrorLog = OL.renderClientErrorLog;
