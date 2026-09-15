import { esc, state, db, getBusinessScopedClients } from '../../core/data.js';

// -------------------------------------------------------------
// TASK STREAM FILTER STATE
// - dueRange/groupBy/status: unchanged, single-select
// - assignees: multi-select (empty array = All); '__unassigned__' is a
//   pseudo-value matching tasks/events with no assignee set
// - types: multi-select of which item kinds appear at all — 'comment'
//   doesn't add its own rows, it drives whether mention sub-rows show
//   under tasks/events (same flag Task Manager's own toggle uses)
// -------------------------------------------------------------
OL.dashboardTaskState = {
    dueRange: 'all',
    groupBy: 'none',
    assignees: [],
    status: 'all',
    types: ['task', 'email', 'event', 'comment', 'error']
};

OL._dashboardAssigneeDefaulted = false;

// -------------------------------------------------------------
// DATA SOURCES — tasks (from already-loaded client state), events,
// unarchived emails, and open errors. Events/emails/errors are fetched
// once per session (cached) and reloaded on demand elsewhere (e.g. after
// syncing); the dashboard just reads whatever's cached and triggers a
// background load the first time it renders.
// -------------------------------------------------------------
OL.getDashboardMasterTasks = function() {
    const clients = getBusinessScopedClients();
    return clients.flatMap(c =>
        (c.projectData?.clientTasks || []).map(t => {
            const teamMembers = c.projectData?.team || c.projectData?.teamMembers || [];

            let taskType = "Sphynx Task";
            if (OL.thirdPartyAssignees.includes(t.assignee)) {
                taskType = "Developer / 3rd Party Task";
            } else if (t.isClientTask || (t.assignee && t.assignee !== 'Sphynx Task' && t.assignee !== 'Sphynx')) {
                taskType = "Client Task";
            }

            return {
                ...t,
                _type: 'task',
                isUnassigned: !t.assignee,
                clientName: c.meta?.name || 'Unknown Client',
                clientId: c.id,
                teamMembers: teamMembers,
                assignee: t.assignee || t.responsibleParty || (t.isClientTask ? 'Client Task' : 'Sphynx Task'),
                taskType: taskType,
                resourceName: t.resourceName || t.category || 'General Resource',
                loggedHours: Number(t.loggedHours || t.hoursLogged || 0)
            };
        })
    );
};

OL._dashboardEventsCache = null;
OL.loadDashboardEvents = async function() {
    const windowStart = new Date(); windowStart.setDate(windowStart.getDate() - 30);
    const windowEnd = new Date(); windowEnd.setDate(windowEnd.getDate() + 60);

    const { data, error } = await db.from('calendar_events')
        .select('id, title, start, end, all_day, linked_client_id, assignee, billable, logged_hours, duration_hours_snapshot, comments')
        .gte('start', windowStart.toISOString())
        .lte('start', windowEnd.toISOString())
        .order('start', { ascending: true });

    if (error) { console.error('Failed to load dashboard events:', error.message); OL._dashboardEventsCache = []; return; }
    OL._dashboardEventsCache = data || [];
    if (typeof OL.applyEventTimeRecalculation === 'function') await OL.applyEventTimeRecalculation(OL._dashboardEventsCache);
};

OL.getDashboardEventItems = function() {
    return (OL._dashboardEventsCache || []).map(e => ({
        ...e,
        _type: 'event',
        isUnassigned: !e.assignee,
        dueDate: e.start,
        assignee: e.assignee || 'Unassigned',
        status: null,
        clientId: e.linked_client_id,
        clientName: e.linked_client_id ? (state.clients[e.linked_client_id]?.meta?.name || 'Project') : 'Unassigned'
    }));
};

// Unarchived emails — shown on the dashboard by default for everyone (no
// setting to turn this off yet; use the Types filter to hide them).
OL._dashboardEmailsCache = null;
OL.loadDashboardEmails = async function() {
    const { data, error } = await db.from('gmail_messages')
        .select('id, sender, subject, snippet, date, linked_client_id, linked_task_id, linked_resource_id, participants')
        .eq('archived', false)
        .order('date', { ascending: false })
        .limit(100);

    if (error) { console.error('Failed to load dashboard emails:', error.message); OL._dashboardEmailsCache = []; return; }
    OL._dashboardEmailsCache = data || [];
};

OL.getDashboardEmailItems = function() {
    return (OL._dashboardEmailsCache || []).map(m => ({
        ...m,
        _type: 'email',
        dueDate: m.date,
        clientId: m.linked_client_id,
        clientName: m.linked_client_id ? (state.clients[m.linked_client_id]?.meta?.name || 'Project') : 'Unlinked'
    }));
};

// Open (unresolved) items from the Error Tracking log.
OL._dashboardErrorsCache = null;
OL.loadDashboardErrors = async function() {
    const { data, error } = await db.from('error_log')
        .select('*')
        .neq('status', 'resolved')
        .order('occurred_at', { ascending: false })
        .limit(100);

    if (error) { console.error('Failed to load dashboard errors:', error.message); OL._dashboardErrorsCache = []; return; }
    OL._dashboardErrorsCache = data || [];
};

OL.getDashboardErrorItems = function() {
    return (OL._dashboardErrorsCache || []).map(r => ({
        ...r,
        _type: 'error',
        dueDate: r.occurred_at,
        clientId: r.client_id,
        clientName: r.client_id ? (state.clients[r.client_id]?.meta?.name || 'Project') : 'Unlinked'
    }));
};

OL.renderDailyDashboard = function() {
    const main = document.getElementById("mainContent");
    if (!main) return;

    if (OL._dashboardEventsCache === null) {
        OL._dashboardEventsCache = [];
        OL.loadDashboardEvents().then(() => OL.renderDailyDashboard());
    }
    if (OL._dashboardEmailsCache === null) {
        OL._dashboardEmailsCache = [];
        OL.loadDashboardEmails().then(() => OL.renderDailyDashboard());
    }
    if (OL._dashboardErrorsCache === null) {
        OL._dashboardErrorsCache = [];
        OL.loadDashboardErrors().then(() => OL.renderDailyDashboard());
    }

    const clients = getBusinessScopedClients();
    const allTasks = OL.getDashboardMasterTasks();
    const openTasks = allTasks.filter(t => t.status !== 'Done');
    const eventItems = OL.getDashboardEventItems();
    const emailItems = OL.getDashboardEmailItems();
    const errorItems = OL.getDashboardErrorItems();
    const allItems = [...openTasks, ...eventItems, ...emailItems, ...errorItems];

    const dueTodayOrOverdue = OL.filterTasksByDueRange(openTasks.concat(eventItems), 'overdue').length
        + OL.filterTasksByDueRange(openTasks.concat(eventItems), 'today').length;

    const assigneeOptions = OL.getDistinctAssignees(openTasks.concat(eventItems).filter(i => !i.isUnassigned));
    const statusOptions = OL.getDistinctStatuses(openTasks);
    const hasUnassigned = openTasks.concat(eventItems).some(i => i.isUnassigned);

    if (!OL._dashboardAssigneeDefaulted) {
        OL._dashboardAssigneeDefaulted = true;
        const myName = state.currentUser?.name;
        if (myName && assigneeOptions.includes(myName)) {
            OL.dashboardTaskState.assignees = [myName];
        }
    }

    const myName = state.currentUser?.name;
    const orderedAssigneeOptions = myName && assigneeOptions.includes(myName)
        ? [myName, ...assigneeOptions.filter(a => a !== myName)]
        : assigneeOptions;

    const assigneeSummary = OL.dashboardTaskState.assignees.length === 0
        ? 'All'
        : OL.dashboardTaskState.assignees.length === 1
            ? (OL.dashboardTaskState.assignees[0] === '__unassigned__' ? 'Unassigned' : OL.dashboardTaskState.assignees[0])
            : `${OL.dashboardTaskState.assignees.length} selected`;

    const TYPE_LABELS = { task: 'Tasks', email: 'Emails', event: 'Events', comment: 'Comments', error: 'Errors' };
    const typesSummary = OL.dashboardTaskState.types.length === 5 ? 'All' : OL.dashboardTaskState.types.map(t => TYPE_LABELS[t]).join(', ') || 'None';

    main.innerHTML = `
        <div class="section-header">
            <div>
                <h2>☀️ Daily Command Dashboard</h2>
                <div class="small muted">Overview of operations, tasks, events, emails, and errors</div>
            </div>
        </div>

        <div class="cards-grid" style="grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); margin-bottom: 25px;">
            <div class="card" style="padding: 15px;">
                <div class="tiny muted uppercase bold">Active Clients</div>
                <div style="font-size: 24px; font-weight: 900; color: var(--accent); margin-top: 5px;">${clients.length}</div>
            </div>
            <div class="card" style="padding: 15px;">
                <div class="tiny muted uppercase bold">Open Action Items</div>
                <div style="font-size: 24px; font-weight: 900; color: #38bdf8; margin-top: 5px;">${openTasks.length}</div>
            </div>
            <div class="card" style="padding: 15px;">
                <div class="tiny muted uppercase bold">Due Today / Overdue</div>
                <div style="font-size: 24px; font-weight: 900; color: #ef4444; margin-top: 5px;">${dueTodayOrOverdue}</div>
            </div>
        </div>

        <div class="card" style="padding: 20px;">
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom: 15px;">
                <h3 style="margin:0;">📋 High-Priority Stream</h3>
                <div style="display:flex; gap:14px; flex-wrap:wrap; align-items:center;">
                    <div style="display:flex; gap:6px; align-items:center;">
                        <i data-lucide="layers-3" style="width:14px;height:14px;color:var(--muted);"></i>
                        <span class="tiny muted bold uppercase">Show:</span>
                        <button class="btn tiny soft" onclick="OL.openDashboardTypesPopover(event)">${esc(typesSummary)} <i data-lucide="chevron-down" style="width:10px;height:10px;"></i></button>
                    </div>
                    <div style="display:flex; gap:6px; align-items:center;">
                        <i data-lucide="user" style="width:14px;height:14px;color:var(--muted);"></i>
                        <span class="tiny muted bold uppercase">Assignee:</span>
                        <button class="btn tiny soft" onclick="OL.openDashboardAssigneePopover(event)">${esc(assigneeSummary)} <i data-lucide="chevron-down" style="width:10px;height:10px;"></i></button>
                    </div>
                    <div style="display:flex; gap:6px; align-items:center;">
                        <i data-lucide="flag" style="width:14px;height:14px;color:var(--muted);"></i>
                        <span class="tiny muted bold uppercase">Status:</span>
                        <select class="modal-input tiny" style="width:auto;" onchange="OL.setDashboardTaskFilter('status', this.value)">
                            <option value="all" ${OL.dashboardTaskState.status === 'all' ? 'selected' : ''}>All</option>
                            ${statusOptions.map(s => `<option value="${esc(s)}" ${OL.dashboardTaskState.status === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}
                        </select>
                    </div>
                    <div style="display:flex; gap:6px; align-items:center;">
                        <i data-lucide="calendar-clock" style="width:14px;height:14px;color:var(--muted);"></i>
                        <span class="tiny muted bold uppercase">Due:</span>
                        <select class="modal-input tiny" style="width:auto;" onchange="OL.setDashboardTaskFilter('dueRange', this.value)">
                            <option value="all" ${OL.dashboardTaskState.dueRange === 'all' ? 'selected' : ''}>All</option>
                            <option value="overdue" ${OL.dashboardTaskState.dueRange === 'overdue' ? 'selected' : ''}>Overdue</option>
                            <option value="today" ${OL.dashboardTaskState.dueRange === 'today' ? 'selected' : ''}>Due Today</option>
                            <option value="week" ${OL.dashboardTaskState.dueRange === 'week' ? 'selected' : ''}>Due This Week</option>
                            <option value="next2weeks" ${OL.dashboardTaskState.dueRange === 'next2weeks' ? 'selected' : ''}>Due Next 2 Weeks</option>
                        </select>
                    </div>
                    <div style="display:flex; gap:6px; align-items:center;">
                        <i data-lucide="layers" style="width:14px;height:14px;color:var(--muted);"></i>
                        <span class="tiny muted bold uppercase">Group:</span>
                        <select class="modal-input tiny" style="width:auto;" onchange="OL.setDashboardTaskFilter('groupBy', this.value)">
                            <option value="none" ${OL.dashboardTaskState.groupBy === 'none' ? 'selected' : ''}>Flat List</option>
                            <option value="client" ${OL.dashboardTaskState.groupBy === 'client' ? 'selected' : ''}>Client</option>
                            <option value="date" ${OL.dashboardTaskState.groupBy === 'date' ? 'selected' : ''}>Due Date</option>
                            <option value="status" ${OL.dashboardTaskState.groupBy === 'status' ? 'selected' : ''}>Status</option>
                            <option value="assignee" ${OL.dashboardTaskState.groupBy === 'assignee' ? 'selected' : ''}>Assignee</option>
                        </select>
                    </div>
                </div>
            </div>
            <div id="dashboard-task-stream">
                ${OL.renderDashboardTaskStream(allItems)}
            </div>
        </div>
    `;
    if (window.lucide) lucide.createIcons();

    // Stash for the popovers below (built once per render, read at click time)
    OL._dashboardAssigneeOptions = orderedAssigneeOptions;
    OL._dashboardHasUnassigned = hasUnassigned;
};

OL.setDashboardTaskFilter = function(key, value) {
    OL.dashboardTaskState[key] = value;
    OL.renderDailyDashboard();
};

// -------------------------------------------------------------
// MULTI-SELECT POPOVERS — Assignee and Types. Each checkbox stops
// propagation so the popover stays open across multiple picks (only the
// underlying #mainContent gets re-rendered on each toggle, not the
// popover itself — it's a separate node appended to document.body, so it
// survives OL.renderDailyDashboard() rewriting the page under it).
// -------------------------------------------------------------
OL.openDashboardAssigneePopover = function(event) {
    const popover = OL.createPopoverContainer(event);
    const selected = OL.dashboardTaskState.assignees;
    const options = OL._dashboardAssigneeOptions || [];

    popover.innerHTML = `
        <div class="tiny bold uppercase muted" style="margin-bottom:6px; padding:2px 4px;">Filter by Assignee</div>
        <div style="display:grid; gap:2px; max-height:260px; overflow-y:auto; min-width:180px;">
            <label style="display:flex; align-items:center; gap:6px; padding:5px 6px; cursor:pointer;" onclick="event.stopPropagation();">
                <input type="checkbox" ${selected.length === 0 ? 'checked' : ''} onclick="OL.clearDashboardAssignees(event)">
                <span class="tiny bold">All</span>
            </label>
            ${OL._dashboardHasUnassigned ? `
                <label style="display:flex; align-items:center; gap:6px; padding:5px 6px; cursor:pointer;" onclick="event.stopPropagation();">
                    <input type="checkbox" ${selected.includes('__unassigned__') ? 'checked' : ''} onclick="OL.toggleDashboardAssignee(event, '__unassigned__')">
                    <span class="tiny">Unassigned</span>
                </label>
            ` : ''}
            ${options.map(a => `
                <label style="display:flex; align-items:center; gap:6px; padding:5px 6px; cursor:pointer;" onclick="event.stopPropagation();">
                    <input type="checkbox" ${selected.includes(a) ? 'checked' : ''} onclick="OL.toggleDashboardAssignee(event, '${esc(a)}')">
                    <span class="tiny">${esc(a)}${a === state.currentUser?.name ? ' (you)' : ''}</span>
                </label>
            `).join('')}
        </div>
    `;
    if (window.lucide) lucide.createIcons();
};

OL.toggleDashboardAssignee = function(event, value) {
    event.stopPropagation();
    const list = OL.dashboardTaskState.assignees;
    const idx = list.indexOf(value);
    if (idx === -1) list.push(value); else list.splice(idx, 1);
    OL.renderDailyDashboard();
};

OL.clearDashboardAssignees = function(event) {
    event.stopPropagation();
    OL.dashboardTaskState.assignees = [];
    OL.renderDailyDashboard();
};

OL.openDashboardTypesPopover = function(event) {
    const popover = OL.createPopoverContainer(event);
    const selected = OL.dashboardTaskState.types;
    const TYPE_LABELS = { task: 'Tasks', email: 'Emails', event: 'Events', comment: 'Comments', error: 'Errors' };

    popover.innerHTML = `
        <div class="tiny bold uppercase muted" style="margin-bottom:6px; padding:2px 4px;">Show in Dashboard</div>
        <div style="display:grid; gap:2px; min-width:160px;">
            ${Object.entries(TYPE_LABELS).map(([key, label]) => `
                <label style="display:flex; align-items:center; gap:6px; padding:5px 6px; cursor:pointer;" onclick="event.stopPropagation();">
                    <input type="checkbox" ${selected.includes(key) ? 'checked' : ''} onclick="OL.toggleDashboardType(event, '${key}')">
                    <span class="tiny">${label}</span>
                </label>
            `).join('')}
        </div>
    `;
    if (window.lucide) lucide.createIcons();
};

OL.toggleDashboardType = function(event, key) {
    event.stopPropagation();
    const list = OL.dashboardTaskState.types;
    const idx = list.indexOf(key);
    if (idx === -1) list.push(key); else list.splice(idx, 1);
    OL.renderDailyDashboard();
};

// -------------------------------------------------------------
// FILTERING — due-range only meaningfully applies to tasks/events (emails
// and errors always pass through, sorted in by date instead); status only
// applies to tasks; assignee only applies to tasks/events.
// -------------------------------------------------------------
OL.filterTasksByDueRange = function(items, range) {
    if (range === 'all') return items;

    const startOfDay = (d) => { const c = new Date(d); c.setHours(0, 0, 0, 0); return c; };
    const today = startOfDay(new Date());
    const endOfWeek = new Date(today); endOfWeek.setDate(endOfWeek.getDate() + (7 - today.getDay()));
    const twoWeeksOut = new Date(today); twoWeeksOut.setDate(twoWeeksOut.getDate() + 14);

    return items.filter(item => {
        if (item._type === 'email' || item._type === 'error') return true;
        if (!item.dueDate) return false;
        const due = startOfDay(new Date(item.dueDate));
        if (range === 'overdue') return due < today;
        if (range === 'today') return due.getTime() === today.getTime();
        if (range === 'week') return due >= today && due <= endOfWeek;
        if (range === 'next2weeks') return due >= today && due <= twoWeeksOut;
        return true;
    });
};

OL.filterDashboardItems = function(items, assignees, status, types) {
    return items.filter(item => {
        if (!types.includes(item._type)) return false;

        const isTaskOrEvent = item._type === 'task' || item._type === 'event';
        const assigneeMatch = !isTaskOrEvent || assignees.length === 0
            || (assignees.includes('__unassigned__') && item.isUnassigned)
            || assignees.includes(item.assignee);

        const statusMatch = item._type !== 'task' || status === 'all' || (item.status || 'Pending Sphynx Action') === status;

        return assigneeMatch && statusMatch;
    });
};

// Renders tasks via OL.renderTaskRowWithMentions, events via
// OL.renderEventRowHTML, emails via OL.renderDashboardEmailRowHTML, and
// errors via the same OL.renderErrorLogRow the Error Tracking tab uses —
// all sorted together by date. OL.showTaskComments (which the task/event
// mention sub-rows check) is driven here by whether "Comments" is in the
// Types filter, so it matches this page's own control instead of
// whatever the Task Manager last left it as.
OL.renderDashboardTaskStream = function(allItems) {
    const { dueRange, groupBy, assignees, status, types } = OL.dashboardTaskState;
    OL.showTaskComments = types.includes('comment');

    const todayStr = new Date().toISOString().slice(0, 10);
    const filtered = OL.sortTasksMentionsFirst(
        OL.filterDashboardItems(OL.filterTasksByDueRange(allItems, dueRange), assignees, status, types)
            .sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'))
    );

    if (!filtered.length) {
        return `<div class="tiny muted">Nothing matches this filter.</div>`;
    }

    const renderItem = item => {
        if (item._type === 'event') return OL.renderEventRowHTML(item);
        if (item._type === 'email') return OL.renderDashboardEmailRowHTML(item);
        if (item._type === 'error') return OL.renderErrorLogRow(item, false);
        return OL.renderTaskRowWithMentions(item, todayStr);
    };

    if (groupBy === 'none') {
        return `<div style="display:flex; flex-direction:column; gap:6px;">${filtered.map(renderItem).join('')}</div>`;
    }

    const groups = {};
    filtered.forEach(item => {
        let key = 'Other';
        if (groupBy === 'client') key = item.clientName || 'Client';
        else if (groupBy === 'status') key = item._type === 'task' ? (item.status || 'Pending Sphynx Action') : (item._type === 'event' ? 'Scheduled Events' : item._type === 'email' ? 'Emails' : 'Errors');
        else if (groupBy === 'assignee') key = item.assignee || (item._type === 'task' || item._type === 'event' ? 'Sphynx Task' : 'N/A');
        else if (groupBy === 'date') key = item.dueDate ? new Date(item.dueDate).toLocaleDateString([], { dateStyle: 'medium' }) : 'Unscheduled';

        if (!groups[key]) groups[key] = [];
        groups[key].push(item);
    });

    return Object.entries(groups).map(([groupTitle, groupItems]) => `
        <div style="margin-bottom: 16px;">
            <div style="font-weight: 800; font-size: 11px; letter-spacing: 0.05em; text-transform: uppercase; color: var(--accent); margin-bottom: 6px; display:flex; align-items:center; gap:8px;">
                <span>${esc(groupTitle)}</span>
                <span class="pill tiny soft" style="font-size:10px;">${groupItems.length}</span>
            </div>
            <div style="display:flex; flex-direction:column; gap:6px;">
                ${groupItems.map(renderItem).join('')}
            </div>
        </div>
    `).join('');
};

// Compact card for an unarchived email — matches the task/event row
// styling (task-row-card) rather than the Communications tab's wider
// grid row, since this sits in the same mixed stream.
OL.renderDashboardEmailRowHTML = function(m) {
    const linkLabel = m.linked_task_id ? OL.getLinkedTaskLabel(m) : (m.linked_resource_id ? OL.getLinkedResourceLabel(m) : '');
    return `
    <div class="task-row-card" style="display:flex; flex-direction:column; gap:6px; padding:10px 14px; background:rgba(168,85,247,0.03); border-bottom:1px solid var(--line); border-radius:4px; cursor:pointer;"
         onclick="OL.openGmailMessageModal('${m.id}')">
        <div style="display:flex; align-items:center; gap:10px; width:100%;">
            <div style="display:flex; align-items:center;" title="Email"><i data-lucide="mail" style="width:14px;height:14px; color:#a855f7;"></i></div>
            <div style="flex:1; min-width:0; overflow:hidden;">
                <strong style="display:block; font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(m.subject || 'No Subject')}</strong>
                <div class="tiny muted" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(m.sender)}${m.snippet ? ' — ' + esc(m.snippet) : ''}</div>
            </div>
            ${m.clientName && m.clientId ? `
                <div style="flex-shrink:0;">
                    <span class="client-link-badge pill tiny soft" style="cursor:pointer; font-weight:600; padding:2px 8px; border-radius:4px; display:inline-flex; align-items:center; gap:5px; font-size:11px;"
                          onclick="event.stopPropagation(); OL.navigateToClientProject('${m.clientId}')" title="Jump to Workspace">
                        <i data-lucide="folder" style="width:12px;height:12px; pointer-events:none;"></i> ${esc(m.clientName)}
                    </span>
                </div>
            ` : ''}
        </div>
        ${linkLabel ? `
            <div style="padding-top:4px; border-top:1px dashed rgba(255,255,255,0.04);">
                <span class="pill tiny soft" style="font-size:10px;"><i data-lucide="link" style="width:10px;height:10px;"></i> ${esc(linkLabel)}</span>
            </div>
        ` : ''}
    </div>
    `;
};
