import { esc, uid, state, updateAndSync, loadFullClient, switchClient } from '../../core/data.js';

OL.globalTaskFilterState = { query: '', status: 'All', assignee: 'All', dateRange: 'All', groupBy: 'client' };
OL.activeTaskTimer = { clientId: null, taskId: null, startTime: null, intervalId: null, elapsedSeconds: 0 };

OL.getClientTeamOptions = function(clientId) {
    const client = state.clients[clientId];
    const teamMembers = client?.projectData?.team || client?.projectData?.teamMembers || [];
    return teamMembers.map(m => typeof m === 'string' ? { id: m, name: m } : { id: m.id || m.name, name: m.name || m.email || 'Team Member' });
};

OL.renderBusinessTaskManager = function() {
    const main = document.getElementById("mainContent");
    if (!main) return;

    const clients = Object.values(state.clients || {});
    let masterTasks = clients.flatMap(c => 
        (c.projectData?.clientTasks || []).map(t => ({
            ...t,
            clientName: c.meta?.name || 'Unknown Client',
            clientId: c.id,
            teamMembers: c.projectData?.team || c.projectData?.teamMembers || [],
            assignee: t.assignee || (t.isClientTask ? 'Client Task' : 'Sphynx Task'),
            loggedHours: Number(t.loggedHours || t.hoursLogged || 0)
        }))
    );

    const totalLoggedHours = masterTasks.reduce((acc, t) => acc + t.loggedHours, 0);

    main.innerHTML = `
        <div class="section-header">
            <div>
                <h2><i data-lucide="check-square" style="width:24px;height:24px;vertical-align:sub;margin-right:8px;color:var(--accent);"></i>Cross-Project Task & Time Engine</h2>
                <div class="small muted">Consolidated deliverables, time logs, and scoping reconciliation</div>
            </div>
            <div class="header-actions" style="display:flex; gap:10px; align-items:center;">
                <button class="btn small primary" onclick="OL.openTimeReportModal()" style="display:flex; align-items:center; gap:6px;">
                    <i data-lucide="bar-chart-2" style="width:14px;height:14px;"></i> Reconciliation Report
                </button>
                <div class="pill tiny accent" style="font-weight: bold; display:flex; align-items:center; gap:6px;">
                    <i data-lucide="clock" style="width:14px;height:14px;"></i> Total Hours: ${totalLoggedHours.toFixed(1)}h
                </div>
                <button class="btn small soft" onclick="OL.renderBusinessTaskManager()" style="display:flex; align-items:center; gap:6px;">
                    <i data-lucide="rotate-cw" style="width:14px;height:14px;"></i> Refresh
                </button>
            </div>
        </div>

        <div class="card" style="padding: 16px; margin-bottom: 20px; background: rgba(var(--accent-rgb), 0.04); border: 1px solid var(--accent);">
            <div style="font-weight: 800; font-size: 11px; letter-spacing: 0.05em; text-transform: uppercase; color: var(--accent); margin-bottom: 10px; display:flex; align-items:center; gap:6px;">
                <i data-lucide="zap" style="width:14px;height:14px;"></i> Quick Task Creator
            </div>
            <form onsubmit="event.preventDefault(); OL.createGlobalQuickTask();" style="display: grid; grid-template-columns: 180px 2fr 150px 140px 110px 110px; gap: 10px; align-items: center;">
                <select id="quick-task-client" class="modal-input tiny" required>
                    <option value="" disabled selected>Select Client...</option>
                    ${clients.map(c => `<option value="${c.id}">${esc(c.meta?.name || c.id)}</option>`).join('')}
                </select>
                <input type="text" id="quick-task-title" class="modal-input tiny" placeholder="Task title..." required>
                <select id="quick-task-assignee" class="modal-input tiny"><option value="Sphynx Task" selected>⚡ Sphynx Task</option></select>
                <input type="date" id="quick-task-duedate" class="modal-input tiny">
                <select id="quick-task-status" class="modal-input tiny"><option value="Pending" selected>Pending</option></select>
                <button type="submit" class="btn tiny primary" style="height: 100%; font-weight: bold;">+ Add Task</button>
            </form>
        </div>

        <div class="card" style="padding: 20px;">
            <div id="global-task-table">${OL.renderFilteredTaskGroups(masterTasks)}</div>
        </div>
    `;
    if (window.lucide) lucide.createIcons();
};

OL.renderFilteredTaskGroups = function(allTasks) {
    return `<div class="p-20 text-center muted">${allTasks.length} active tasks across workspaces.</div>`;
};

OL.navigateToClientProject = function(clientId) {
    if (typeof switchClient === 'function') switchClient(clientId);
    else if (typeof OL.switchClient === 'function') OL.switchClient(clientId);
};

OL.handleTaskRowClick = function(event, clientId, taskId) {
    const targetTag = event.target.tagName.toLowerCase();
    if (['select', 'input', 'button', 'option'].includes(targetTag) || event.target.closest('button')) return;
    OL.openTaskInContext(clientId, taskId);
};

OL.openTaskInContext = async function(clientId, taskId) {
    await loadFullClient(clientId);
    if (typeof OL.openTaskModal === 'function') OL.openTaskModal(taskId, false, clientId);
};
