import { esc, state } from '../../core/data.js';

// -------------------------------------------------------------
// TASK STREAM FILTER STATE — due-date presets + grouping, mirroring the
// filter/group pattern used on the Workspace Task Manager
// (see features/tasks.js OL.clientTaskFilterState) so the UX is familiar.
// -------------------------------------------------------------
OL.dashboardTaskState = {
    dueRange: 'all',     // 'all' | 'today' | 'week' | 'next2weeks' | 'overdue'
    groupBy: 'none'      // 'none' | 'client' | 'date' | 'status' | 'assignee'
};

OL.renderDailyDashboard = function() {
    const main = document.getElementById("mainContent");
    if (!main) return;

    const clients = Object.values(state.clients || {});
    const allTasks = clients.flatMap(c => (c.projectData?.clientTasks || []).map(t => ({ ...t, clientName: c.meta?.name || 'Client', clientId: c.id })));
    const openTasks = allTasks.filter(t => t.status !== 'Done');
    const dueTodayOrOverdue = OL.filterTasksByDueRange(openTasks, 'overdue').length + OL.filterTasksByDueRange(openTasks, 'today').length;

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
    const clients = Object.values(state.clients || {});
    const openTasks = clients.flatMap(c => (c.projectData?.clientTasks || [])
        .filter(t => t.status !== 'Done')
        .map(t => ({ ...t, clientName: c.meta?.name || 'Client', clientId: c.id })));

    const container = document.getElementById('dashboard-task-stream');
    if (container) {
        container.innerHTML = OL.renderDashboardTaskStream(openTasks);
        if (window.lucide) lucide.createIcons();
    }
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

OL.renderDashboardTaskStream = function(openTasks) {
    const { dueRange, groupBy } = OL.dashboardTaskState;
    const filtered = OL.filterTasksByDueRange(openTasks, dueRange)
        .sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));

    if (!filtered.length) {
        return `<div class="tiny muted">No tasks match this filter.</div>`;
    }

    if (groupBy === 'none') {
        return `<div style="display:flex; flex-direction:column; gap:2px;">${filtered.map(t => OL.renderDashboardTaskRow(t)).join('')}</div>`;
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
            <div style="display:flex; flex-direction:column; gap:2px;">
                ${groupTasks.map(t => OL.renderDashboardTaskRow(t)).join('')}
            </div>
        </div>
    `).join('');
};

OL.renderDashboardTaskRow = function(t) {
    const dueLabel = t.dueDate ? new Date(t.dueDate).toLocaleDateString([], { dateStyle: 'medium' }) : '';
    const isOverdue = t.dueDate && new Date(t.dueDate).setHours(0, 0, 0, 0) < new Date().setHours(0, 0, 0, 0);

    return `
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px; padding: 8px 0; border-bottom: 1px solid var(--line); cursor:pointer;"
             onclick="OL.openTaskInContext('${t.clientId}', '${t.id}')">
            <div style="min-width:0;">
                <strong style="display:block; white-space:normal; word-break:break-word;">${esc(t.title || t.name)}</strong>
                <div style="display:flex; gap:6px; align-items:center; margin-top:2px; flex-wrap:wrap;">
                    <span class="pill tiny soft">${esc(t.clientName)}</span>
                    ${dueLabel ? `<span class="pill tiny soft" style="${isOverdue ? 'color:#ef4444;' : ''}">${esc(dueLabel)}</span>` : ''}
                </div>
            </div>
            <span class="pill tiny accent" style="flex-shrink:0;">${esc(t.status || 'Pending')}</span>
        </div>
    `;
};
