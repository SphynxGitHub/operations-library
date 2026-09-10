import { esc, uid, state, updateAndSync, getActiveClient } from '../core/data.js';

//============= CLIENT WORKSPACE TASK MANAGER ===============//

OL.clientTaskFilterState = {
    query: '',
    status: 'Open',     // 'Open' | 'Closed' | 'All' | Specific Status
    assignee: 'All',   // 'All' | 'Sphynx' | 'Client' | '3rdParty' | Member Name
    dateRange: 'All',  // 'All' | 'Overdue' | 'Today' | 'Week' | 'Month'
    groupBy: 'status'  // 'status' | 'assignee' | 'none'
};

export function renderClientTaskManager() {
    const main = document.getElementById("mainContent");
    const client = getActiveClient();
    if (!main || !client) return;

    if (!client.projectData) client.projectData = {};
    if (!client.projectData.clientTasks) client.projectData.clientTasks = [];

    const tasks = client.projectData.clientTasks.map(t => ({
        ...t,
        clientId: client.id,
        clientName: client.meta?.name || 'Workspace',
        resourceName: t.resourceName || t.category || 'General Resource',
        loggedHours: Number(t.loggedHours || t.hoursLogged || 0)
    }));

    const totalLoggedHours = tasks.reduce((sum, t) => sum + t.loggedHours, 0);
    const masterStatuses = OL.getSystemStatuses ? OL.getSystemStatuses() : [];

    main.innerHTML = `
        <div class="section-header" style="display:flex; justify-content:space-between; align-items:center;">
            <div>
                <h2><i data-lucide="check-square" style="width:24px;height:24px;vertical-align:sub;margin-right:8px;color:var(--accent);"></i>Workspace Deliverables & Tasks</h2>
                <div class="small muted">Deliverable tracking, status updates, and time logs for ${esc(client.meta?.name)}</div>
            </div>
            <div class="header-actions" style="display:flex; gap:10px; align-items:center;">
                <div class="pill tiny accent" style="font-weight: bold; display:flex; align-items:center; gap:6px;">
                    <i data-lucide="clock" style="width:14px;height:14px;"></i> Logged: ${totalLoggedHours.toFixed(1)}h
                </div>
                <button class="btn small primary" onclick="OL.openClientCreateTaskModal('${client.id}')" style="display:flex; align-items:center; gap:6px; font-weight:bold;">
                    <i data-lucide="plus" style="width:14px;height:14px;"></i> Add Deliverable
                </button>
            </div>
        </div>

        <!-- QUICK TASK CREATOR BAR (PRE-SET TO CURRENT CLIENT) -->
        <div class="card" style="padding: 14px 16px; margin-bottom: 20px; background: rgba(var(--accent-rgb), 0.04); border: 1px solid var(--accent);">
            <form onsubmit="event.preventDefault(); OL.createClientQuickTask('${client.id}');" style="display: grid; grid-template-columns: 2fr 160px 140px 140px 110px; gap: 10px; align-items: center;">
                
                <input type="text" id="client-quick-task-title" class="modal-input tiny" placeholder="New task title or deliverable description..." required>

                <div style="position:relative; display:flex; align-items:center;">
                    <i data-lucide="user" style="position:absolute; left:8px; width:13px; height:13px; color:var(--muted); pointer-events:none;"></i>
                    <select id="client-quick-task-assignee" class="modal-input tiny" style="padding-left:26px; width:100%;">
                        <option value="Sphynx Task" selected>Sphynx Task</option>
                        <option value="Client Task">Client Task</option>
                        ${(client.projectData.teamMembers || []).map(m => `<option value="${esc(m.name)}">${esc(m.name)}</option>`).join('')}
                        <optgroup label="Third-Party / Vendors">
                            ${(OL.thirdPartyAssignees || []).map(tp => `<option value="${esc(tp)}">${esc(tp)}</option>`).join('')}
                        </optgroup>
                    </select>
                </div>

                <input type="date" id="client-quick-task-duedate" class="modal-input tiny" title="Due Date">

                <div style="position:relative; display:flex; align-items:center;">
                    <i data-lucide="list-checks" style="position:absolute; left:8px; width:13px; height:13px; color:var(--muted); pointer-events:none;"></i>
                    <select id="client-quick-task-status" class="modal-input tiny" style="padding-left:26px; width:100%;">
                        ${masterStatuses.map(s => `<option value="${esc(s.name)}">${esc(s.name)}</option>`).join('')}
                    </select>
                </div>

                <button type="submit" class="btn tiny primary" style="height: 100%; font-weight: bold; display:flex; align-items:center; justify-content:center; gap:4px;">
                    <i data-lucide="plus" style="width:14px;height:14px;"></i> Add
                </button>
            </form>
        </div>

        <div class="card" style="padding: 20px;">
            <!-- WORKSPACE FILTER TOOLBAR -->
            <div style="display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; margin-bottom: 15px; padding-bottom: 15px; border-bottom: 1px solid var(--line);">
                
                <div style="display: flex; gap: 8px; flex: 1; min-width: 200px; align-items:center;">
                    <i data-lucide="search" style="width:16px;height:16px;color:var(--muted);"></i>
                    <input type="text" 
                           class="modal-input tiny" 
                           placeholder="Search deliverables in this project..." 
                           value="${esc(OL.clientTaskFilterState.query)}"
                           oninput="OL.setClientTaskFilter('query', this.value)">
                </div>

                <div style="display: flex; gap: 6px; align-items: center;">
                    <i data-lucide="list-checks" style="width:14px;height:14px;color:var(--muted);"></i>
                    <span class="tiny muted bold uppercase">Status:</span>
                    <select class="modal-input tiny" style="width: auto;" onchange="OL.setClientTaskFilter('status', this.value)">
                        <option value="Open" ${OL.clientTaskFilterState.status === 'Open' ? 'selected' : ''}>Open Items</option>
                        <option value="Closed" ${OL.clientTaskFilterState.status === 'Closed' ? 'selected' : ''}>Closed Items</option>
                        <option value="All" ${OL.clientTaskFilterState.status === 'All' ? 'selected' : ''}>All Statuses</option>
                        <optgroup label="Specific Pipeline Status">
                            ${masterStatuses.map(s => `<option value="${esc(s.name)}" ${OL.clientTaskFilterState.status === s.name ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
                        </optgroup>
                    </select>
                </div>

                <div style="display: flex; gap: 6px; align-items: center;">
                    <i data-lucide="user-check" style="width:14px;height:14px;color:var(--muted);"></i>
                    <span class="tiny muted bold uppercase">Assignee:</span>
                    <select class="modal-input tiny" style="width: auto;" onchange="OL.setClientTaskFilter('assignee', this.value)">
                        <option value="All" ${OL.clientTaskFilterState.assignee === 'All' ? 'selected' : ''}>All Assignees</option>
                        <option value="Sphynx" ${OL.clientTaskFilterState.assignee === 'Sphynx' ? 'selected' : ''}>Sphynx Tasks</option>
                        <option value="Client" ${OL.clientTaskFilterState.assignee === 'Client' ? 'selected' : ''}>Client Tasks</option>
                        ${(client.projectData.teamMembers || []).map(m => `<option value="${esc(m.name)}" ${OL.clientTaskFilterState.assignee === m.name ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}
                    </select>
                </div>

                <div style="display: flex; gap: 8px; align-items: center;">
                    <i data-lucide="layers" style="width:14px;height:14px;color:var(--muted);"></i>
                    <span class="tiny muted bold uppercase">Group:</span>
                    <select class="modal-input tiny" style="width: auto;" onchange="OL.setClientTaskFilter('groupBy', this.value)">
                        <option value="status" ${OL.clientTaskFilterState.groupBy === 'status' ? 'selected' : ''}>Status</option>
                        <option value="assignee" ${OL.clientTaskFilterState.groupBy === 'assignee' ? 'selected' : ''}>Assignee</option>
                        <option value="none" ${OL.clientTaskFilterState.groupBy === 'none' ? 'selected' : ''}>Flat List</option>
                    </select>
                </div>
            </div>

            <!-- TASK LIST CONTAINER (REUSES 2-LINE ROW RENDERER) -->
            <div id="client-task-table">
                ${OL.renderFilteredClientTaskGroups(tasks)}
            </div>
        </div>
    `;

    requestAnimationFrame(() => {
        if (window.lucide) lucide.createIcons();
    });
}

OL.setClientTaskFilter = function(key, val) {
    OL.clientTaskFilterState[key] = val;
    renderClientTaskManager();
};

OL.renderFilteredClientTaskGroups = function(tasks) {
    const { query, status, assignee, groupBy } = OL.clientTaskFilterState;
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const masterStatuses = OL.getSystemStatuses ? OL.getSystemStatuses() : [];
    const closedStatusNames = masterStatuses.filter(s => s.isClosed).map(s => s.name);

    let filtered = tasks.filter(t => {
        const titleMatch = (t.title || t.name || '').toLowerCase().includes(query.toLowerCase());
        const resourceMatch = (t.resourceName || '').toLowerCase().includes(query.toLowerCase());

        let statusMatch = true;
        if (status === 'Open') statusMatch = !closedStatusNames.includes(t.status) && t.status !== 'Done';
        else if (status === 'Closed') statusMatch = closedStatusNames.includes(t.status) || t.status === 'Done';
        else if (status !== 'All') statusMatch = (t.status || 'Pending Sphynx Action') === status;

        let assigneeMatch = true;
        if (assignee === 'Sphynx') assigneeMatch = t.assignee === 'Sphynx Task' || (!t.isClientTask && !(OL.thirdPartyAssignees || []).includes(t.assignee));
        else if (assignee === 'Client') assigneeMatch = t.assignee !== 'Sphynx Task' && !(OL.thirdPartyAssignees || []).includes(t.assignee);
        else if (assignee !== 'All') assigneeMatch = t.assignee === assignee;

        return (titleMatch || resourceMatch) && statusMatch && assigneeMatch;
    });

    if (filtered.length === 0) {
        return `<div class="p-20 muted text-center">No matching tasks in this workspace.</div>`;
    }

    if (groupBy === 'none') {
        return `<div style="display:grid; gap:8px;">${filtered.map(t => OL.renderTaskRowHTML(t, todayStr)).join('')}</div>`;
    }

    const groups = {};
    filtered.forEach(task => {
        let groupKey = 'Other';
        if (groupBy === 'status') groupKey = task.status || 'Pending Sphynx Action';
        else if (groupBy === 'assignee') groupKey = task.assignee || 'Sphynx Task';

        if (!groups[groupKey]) groups[groupKey] = [];
        groups[groupKey].push(task);
    });

    return Object.entries(groups).map(([groupTitle, groupTasks]) => `
        <div style="margin-bottom: 20px;">
            <div style="font-weight: 800; font-size: 12px; letter-spacing: 0.05em; text-transform: uppercase; color: var(--accent); margin-bottom: 8px; display: flex; align-items: center; justify-content: space-between;">
                <div style="display:flex; align-items:center; gap:8px;">
                    <i data-lucide="folder" style="width:13px;height:13px;"></i>
                    <span>${esc(groupTitle)}</span>
                    <span class="pill tiny soft" style="font-size:10px;">${groupTasks.length}</span>
                </div>
            </div>
            <div style="display: grid; gap: 8px;">
                ${groupTasks.map(t => OL.renderTaskRowHTML(t, todayStr)).join('')}
            </div>
        </div>
    `).join('');
};

OL.createClientQuickTask = function(clientId) {
    const title = document.getElementById('client-quick-task-title')?.value;
    const assignee = document.getElementById('client-quick-task-assignee')?.value || 'Sphynx Task';
    const status = document.getElementById('client-quick-task-status')?.value || 'Pending Sphynx Action';
    const dueDate = document.getElementById('client-quick-task-duedate')?.value || '';

    if (!title) return;

    updateAndSync(() => {
        const client = state.clients[clientId];
        if (!client) return;
        if (!client.projectData) client.projectData = {};
        if (!client.projectData.clientTasks) client.projectData.clientTasks = [];

        client.projectData.clientTasks.unshift({
            id: uid(),
            title: title,
            name: title,
            status: status,
            assignee: assignee,
            dueDate: dueDate,
            isClientTask: (assignee !== 'Sphynx Task' && !(OL.thirdPartyAssignees || []).includes(assignee)),
            loggedHours: 0,
            createdAt: new Date().toISOString()
        });
    });

    renderClientTaskManager();
};

window.renderClientTaskManager = renderClientTaskManager;
