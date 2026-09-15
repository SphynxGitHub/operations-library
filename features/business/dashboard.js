import { esc, state, getBusinessScopedClients } from '../../core/data.js';

// -------------------------------------------------------------
// TASK STREAM FILTER STATE — due-date presets + grouping (mirroring the
// Workspace Task Manager's filter pattern) plus assignee/status filters,
// matching what the master Task Manager already offers.
// -------------------------------------------------------------
OL.dashboardTaskState = {
    dueRange: 'all',     // 'all' | 'today' | 'week' | 'next2weeks' | 'overdue'
    groupBy: 'none',     // 'none' | 'client' | 'date' | 'status' | 'assignee'
    assignee: 'all',
    status: 'all'
};

// Defaults the Assignee filter to whoever's logged in, the first time the
// dashboard renders in a session — but only if that name actually shows
// up as an assignee on something, and only once (so picking "All" back
// deliberately later doesn't get silently reset on the next render).
OL._dashboardAssigneeDefaulted = false;

// Builds the task list with the exact same normalization the master Task
// Engine uses (features/business/tasks.js OL.renderBusinessTaskManager),
// so rows rendered via OL.renderTaskRowHTML here look and behave
// identically — status dot dropdown, assignee avatar dropdown, inline due
// date, time logging, workspace link, bulk-select — not a simplified copy.
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

OL.renderDailyDashboard = function() {
    const main = document.getElementById("mainContent");
    if (!main) return;

    const clients = getBusinessScopedClients();
    const allTasks = OL.getDashboardMasterTasks();
    const openTasks = allTasks.filter(t => t.status !== 'Done');
    const dueTodayOrOverdue = OL.filterTasksByDueRange(openTasks, 'overdue').length + OL.filterTasksByDueRange(openTasks, 'today').length;

    const assigneeOptions = OL.getDistinctAssignees(openTasks);
    const statusOptions = OL.getDistinctStatuses(openTasks);

    if (!OL._dashboardAssigneeDefaulted) {
        OL._dashboardAssigneeDefaulted = true;
        const myName = state.currentUser?.name;
        if (myName && assigneeOptions.includes(myName)) {
            OL.dashboardTaskState.assignee = myName;
        }
    }

    // Logged-in user's name first (if they're an assignee on anything),
    // everyone else alphabetically after.
    const myName = state.currentUser?.name;
    const orderedAssigneeOptions = myName && assigneeOptions.includes(myName)
        ? [myName, ...assigneeOptions.filter(a => a !== myName)]
        : assigneeOptions;

    main.innerHTML = `
        <div class="section-header">
            <div>
                <h2>☀️ Daily Command Dashboard</h2>
                <div class="small muted">Overview of operations, active tasks, and client communications</div>
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

        <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 20px; align-items:start;">
            <div class="card" style="padding: 20px;">
                <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom: 15px;">
                    <h3 style="margin:0;">📋 High-Priority Task Stream</h3>
                    <div style="display:flex; gap:14px; flex-wrap:wrap; align-items:center;">
                        <button class="btn tiny soft" onclick="OL.toggleShowTaskComments()" style="display:flex; align-items:center; gap:6px;">
                            <i data-lucide="${OL.showTaskComments ? 'eye-off' : 'eye'}" style="width:12px;height:12px;"></i> ${OL.showTaskComments ? 'Hide' : 'Show'} Comments
                        </button>
                        <div style="display:flex; gap:6px; align-items:center;">
                            <i data-lucide="user" style="width:14px;height:14px;color:var(--muted);"></i>
                            <span class="tiny muted bold uppercase">Assignee:</span>
                            <select class="modal-input tiny" style="width:auto;" onchange="OL.setDashboardTaskFilter('assignee', this.value)">
                                <option value="all" ${OL.dashboardTaskState.assignee === 'all' ? 'selected' : ''}>All</option>
                                ${orderedAssigneeOptions.map(a => `<option value="${esc(a)}" ${OL.dashboardTaskState.assignee === a ? 'selected' : ''}>${esc(a)}${a === myName ? ' (you)' : ''}</option>`).join('')}
                            </select>
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
                    ${OL.renderDashboardTaskStream(openTasks)}
                </div>
            </div>

            <div class="card" style="padding: 20px;">
                <h3>✉️ Communications & Sync</h3>
                <div class="tiny muted" style="margin-top: 10px;">Connect Gmail and Quo webhook integrations to stream messages directly here.</div>
                <button class="btn primary tiny" style="margin-top: 15px;" onclick="window.location.hash='#/business/communications'">Connect API</button>
            </div>
        </div>
    `;
    if (window.lucide) lucide.createIcons();
};

OL.setDashboardTaskFilter = function(key, value) {
    OL.dashboardTaskState[key] = value;
    const openTasks = OL.getDashboardMasterTasks().filter(t => t.status !== 'Done');

    // Assignee/status option lists can change what's available, and the
    // header itself needs to reflect the new selection, so re-render the
    // whole dashboard rather than just the list container.
    OL.renderDailyDashboard();
};

// today/week/next-2-weeks/overdue are computed off local midnight so an
// item due "today" doesn't flip buckets depending on time of day.
OL.filterTasksByDueRange = function(tasks, range) {
    if (range === 'all') return tasks;

    const startOfDay = (d) => { const c = new Date(d); c.setHours(0, 0, 0, 0); return c; };
    const today = startOfDay(new Date());
    const endOfWeek = new Date(today); endOfWeek.setDate(endOfWeek.getDate() + (7 - today.getDay()));
    const twoWeeksOut = new Date(today); twoWeeksOut.setDate(twoWeeksOut.getDate() + 14);

    return tasks.filter(t => {
        if (!t.dueDate) return false;
        const due = startOfDay(new Date(t.dueDate));
        if (range === 'overdue') return due < today;
        if (range === 'today') return due.getTime() === today.getTime();
        if (range === 'week') return due >= today && due <= endOfWeek;
        if (range === 'next2weeks') return due >= today && due <= twoWeeksOut;
        return true;
    });
};

// Renders rows with OL.renderTaskRowWithMentions — the same row the
// master Task Engine uses (status dot, assignee avatar, inline due date,
// time logging, workspace link, bulk-select), plus an @mention sub-row
// under any task where you were tagged, and mention-first ordering so
// those tasks float to the top of whichever filtered/grouped view is
// showing.
OL.renderDashboardTaskStream = function(openTasks) {
    const { dueRange, groupBy, assignee, status } = OL.dashboardTaskState;
    const todayStr = new Date().toISOString().slice(0, 10);
    const filtered = OL.sortTasksMentionsFirst(
        OL.filterTasksByAssigneeStatus(OL.filterTasksByDueRange(openTasks, dueRange), assignee, status)
            .sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'))
    );

    if (!filtered.length) {
        return `<div class="tiny muted">No tasks match this filter.</div>`;
    }

    if (groupBy === 'none') {
        return `<div style="display:flex; flex-direction:column; gap:6px;">${filtered.map(t => OL.renderTaskRowWithMentions(t, todayStr)).join('')}</div>`;
    }

    const groups = {};
    filtered.forEach(t => {
        let key = 'Other';
        if (groupBy === 'client') key = t.clientName || 'Client';
        else if (groupBy === 'status') key = t.status || 'Pending Sphynx Action';
        else if (groupBy === 'assignee') key = t.assignee || 'Sphynx Task';
        else if (groupBy === 'date') key = t.dueDate ? new Date(t.dueDate).toLocaleDateString([], { dateStyle: 'medium' }) : 'Unscheduled';

        if (!groups[key]) groups[key] = [];
        groups[key].push(t);
    });

    return Object.entries(groups).map(([groupTitle, groupTasks]) => `
        <div style="margin-bottom: 16px;">
            <div style="font-weight: 800; font-size: 11px; letter-spacing: 0.05em; text-transform: uppercase; color: var(--accent); margin-bottom: 6px; display:flex; align-items:center; gap:8px;">
                <span>${esc(groupTitle)}</span>
                <span class="pill tiny soft" style="font-size:10px;">${groupTasks.length}</span>
            </div>
            <div style="display:flex; flex-direction:column; gap:6px;">
                ${groupTasks.map(t => OL.renderTaskRowWithMentions(t, todayStr)).join('')}
            </div>
        </div>
    `).join('');
};
