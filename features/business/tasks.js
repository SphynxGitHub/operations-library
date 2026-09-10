import { esc, uid, state, updateAndSync, loadFullClient, switchClient, getBusinessScopedClients } from '../../core/data.js';

//============= GLOBAL TASK & TIME MANAGER ===============//

OL.globalTaskFilterState = { 
    query: '', 
    status: 'Open',     
    assignee: 'All',   
    dateRange: 'All',  
    groupBy: 'client', 
    subGroupBy: 'none' 
};

OL.activeTaskTimer = { 
    clientId: null, 
    taskId: null, 
    startTime: null, 
    intervalId: null, 
    elapsedSeconds: 0 
};

// 🔌 Standardized Third-Party / Vendor Assignees
OL.thirdPartyAssignees = [
    "Zapier Support",
    "Developer / Engineering",
    "Vendor / App Support",
    "External Consultant"
];

// Master Status Pipeline Fallback
OL.getSystemStatuses = function() {
    return state.master?.taskStatuses || [
        { id: "st-1", name: "Pending Sphynx Action", color: "#64c6a2", isClosed: false },
        { id: "st-2", name: "Pending Client Feedback", color: "#0880ea", isClosed: false },
        { id: "st-3", name: "Pending Client Document", color: "#4a55e6", isClosed: false },
        { id: "st-4", name: "Pending Client Review", color: "#b83dba", isClosed: false },
        { id: "st-5", name: "Pending Developer Update", color: "#9e832c", isClosed: false },
        { id: "st-6", name: "Pending Third Party Support", color: "#ffca18", isClosed: false },
        { id: "st-7", name: "Needs Follow Up", color: "#ff7f27", isClosed: false },
        { id: "st-8", name: "Client Task", color: "#cb1d63", isClosed: false },
        { id: "st-9", name: "Done", color: "#299764", isClosed: true }
    ];
};

// Helper: Resolve team members for a given client ID
OL.getClientTeamOptions = function(clientId) {
    const client = state.clients?.[clientId];
    const teamMembers = client?.projectData?.team || client?.projectData?.teamMembers || [];
    return teamMembers.map(m => typeof m === 'string' ? { id: m, name: m } : { id: m.id || m.name, name: m.name || m.email || 'Team Member' });
};

// Helper: Calculate Scoping Sheet totals vs Logged Hours per Client
OL.getClientReconciliationMetrics = function(clientId) {
    const client = state.clients?.[clientId];
    if (!client) return { scopedHours: 0, scopedValue: 0, loggedHours: 0, hourlyRate: 300, remainingHours: 0, remainingValue: 0, burnRate: 0 };

    const hourlyRate = state.master?.rates?.baseHourlyRate || 300;
    const sheet = client.projectData?.scopingSheets?.[0];
    const lineItems = sheet?.lineItems || [];
    let scopedHours = 0;
    let scopedValue = 0;

    lineItems.forEach(item => {
        const res = typeof OL.getResourceById === 'function' ? OL.getResourceById(item.resourceId) : null;
        const rowVal = res && typeof OL.calculateRowFee === 'function' ? OL.calculateRowFee(item, res) : (item.total || 0);
        scopedValue += rowVal;
        const itemHours = item.hours || (rowVal ? rowVal / hourlyRate : 0);
        scopedHours += itemHours;
    });

    const tasks = client.projectData?.clientTasks || [];
    const loggedHours = tasks.reduce((sum, t) => sum + Number(t.loggedHours || t.hoursLogged || 0), 0);

    const remainingHours = scopedHours - loggedHours;
    const usedValue = loggedHours * hourlyRate;
    const remainingValue = scopedValue - usedValue;
    const burnRate = scopedHours > 0 ? Math.min(Math.round((loggedHours / scopedHours) * 100), 999) : 0;

    return { scopedHours, scopedValue, loggedHours, hourlyRate, usedValue, remainingHours, remainingValue, burnRate };
};

OL.renderBusinessTaskManager = function() {
    const main = document.getElementById("mainContent");
    if (!main) return;

    const clients = getBusinessScopedClients();
    
    // Aggregate tasks from all clients
    let masterTasks = clients.flatMap(c => 
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

    const totalLoggedHours = masterTasks.reduce((acc, t) => acc + t.loggedHours, 0);
    const masterStatuses = OL.getSystemStatuses();

    main.innerHTML = `
        <div class="section-header">
            <div>
                <h2><i data-lucide="check-square" style="width:24px;height:24px;vertical-align:sub;margin-right:8px;color:var(--accent);"></i>Cross-Project Task & Time Engine</h2>
                <div class="small muted">Consolidated deliverables, team assignments, third-party logs, and scoping reconciliation</div>
            </div>
            <div class="header-actions" style="display:flex; gap:10px; align-items:center;">
                <button class="btn small soft" onclick="OL.openStatusManagerModal()" style="display:flex; align-items:center; gap:6px;">
                    <i data-lucide="settings-2" style="width:14px;height:14px;"></i> Status Pipeline
                </button>
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

        <!-- QUICK TASK CREATOR BAR -->
        <div class="card" style="padding: 16px; margin-bottom: 20px; background: rgba(var(--accent-rgb), 0.04); border: 1px solid var(--accent);">
            <div style="font-weight: 800; font-size: 11px; letter-spacing: 0.05em; text-transform: uppercase; color: var(--accent); margin-bottom: 10px; display:flex; align-items:center; gap:6px;">
                <i data-lucide="zap" style="width:14px;height:14px;"></i> Quick Task Creator
            </div>
            <form onsubmit="event.preventDefault(); OL.createGlobalQuickTask();" style="display: grid; grid-template-columns: 180px 2fr 160px 140px 140px 110px; gap: 10px; align-items: center;">
                
                <div style="position:relative; display:flex; align-items:center;">
                    <i data-lucide="building" style="position:absolute; left:8px; width:13px; height:13px; color:var(--muted); pointer-events:none;"></i>
                    <select id="quick-task-client" class="modal-input tiny" style="padding-left:26px; width:100%;" required onchange="OL.updateQuickTaskTeamDropdown(this.value)">
                        <option value="" disabled selected>Select Client...</option>
                        ${clients.map(c => `<option value="${c.id}">${esc(c.meta?.name || c.id)}</option>`).join('')}
                    </select>
                </div>

                <input type="text" id="quick-task-title" class="modal-input tiny" placeholder="Task title or deliverable description..." required>

                <div style="position:relative; display:flex; align-items:center;">
                    <i data-lucide="user" style="position:absolute; left:8px; width:13px; height:13px; color:var(--muted); pointer-events:none;"></i>
                    <select id="quick-task-assignee" class="modal-input tiny" style="padding-left:26px; width:100%;">
                        <option value="Sphynx Task" selected>Sphynx Task</option>
                        <option value="Client Task">Client Task</option>
                        <optgroup label="Third-Party / Vendors">
                            ${OL.thirdPartyAssignees.map(tp => `<option value="${esc(tp)}">${esc(tp)}</option>`).join('')}
                        </optgroup>
                    </select>
                </div>

                <input type="date" id="quick-task-duedate" class="modal-input tiny" title="Due Date">

                <div style="position:relative; display:flex; align-items:center;">
                    <i data-lucide="list-checks" style="position:absolute; left:8px; width:13px; height:13px; color:var(--muted); pointer-events:none;"></i>
                    <select id="quick-task-status" class="modal-input tiny" style="padding-left:26px; width:100%;">
                        ${masterStatuses.map(s => `<option value="${esc(s.name)}">${esc(s.name)}</option>`).join('')}
                    </select>
                </div>

                <button type="submit" class="btn tiny primary" style="height: 100%; font-weight: bold; display:flex; align-items:center; justify-content:center; gap:4px;">
                    <i data-lucide="plus" style="width:14px;height:14px;"></i> Add Task
                </button>
            </form>
        </div>

        <div class="card" style="padding: 20px;">
            <!-- ADVANCED FILTER TOOLBAR -->
            <div style="display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; margin-bottom: 15px; padding-bottom: 15px; border-bottom: 1px solid var(--line);">
                
                <div style="display: flex; gap: 8px; flex: 1; min-width: 200px; align-items:center;">
                    <i data-lucide="search" style="width:16px;height:16px;color:var(--muted);"></i>
                    <input type="text" 
                           class="modal-input tiny" 
                           placeholder="Search deliverables or tasks..." 
                           value="${esc(OL.globalTaskFilterState.query)}"
                           oninput="OL.setGlobalTaskFilter('query', this.value)">
                </div>

                <div style="display: flex; gap: 6px; align-items: center;">
                    <i data-lucide="list-checks" style="width:14px;height:14px;color:var(--muted);"></i>
                    <span class="tiny muted bold uppercase">Status:</span>
                    <select class="modal-input tiny" style="width: auto;" onchange="OL.setGlobalTaskFilter('status', this.value)">
                        <option value="Open" ${OL.globalTaskFilterState.status === 'Open' ? 'selected' : ''}>Open Items</option>
                        <option value="Closed" ${OL.globalTaskFilterState.status === 'Closed' ? 'selected' : ''}>Closed Items</option>
                        <option value="All" ${OL.globalTaskFilterState.status === 'All' ? 'selected' : ''}>All Statuses</option>
                        <optgroup label="Specific Pipeline Status">
                            ${masterStatuses.map(s => `<option value="${esc(s.name)}" ${OL.globalTaskFilterState.status === s.name ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
                        </optgroup>
                    </select>
                </div>

                <div style="display: flex; gap: 6px; align-items: center;">
                    <i data-lucide="user-check" style="width:14px;height:14px;color:var(--muted);"></i>
                    <span class="tiny muted bold uppercase">Assignee:</span>
                    <select class="modal-input tiny" style="width: auto;" onchange="OL.setGlobalTaskFilter('assignee', this.value)">
                        <option value="All" ${OL.globalTaskFilterState.assignee === 'All' ? 'selected' : ''}>All Assignees</option>
                        <option value="Sphynx" ${OL.globalTaskFilterState.assignee === 'Sphynx' ? 'selected' : ''}>All Sphynx Tasks</option>
                        <option value="Client" ${OL.globalTaskFilterState.assignee === 'Client' ? 'selected' : ''}>All Client Tasks</option>
                        <option value="3rdParty" ${OL.globalTaskFilterState.assignee === '3rdParty' ? 'selected' : ''}>All 3rd Party / Developer Tasks</option>
                        <optgroup label="3rd Party Vendors">
                            ${OL.thirdPartyAssignees.map(tp => `<option value="${esc(tp)}" ${OL.globalTaskFilterState.assignee === tp ? 'selected' : ''}>${esc(tp)}</option>`).join('')}
                        </optgroup>
                    </select>
                </div>

                <div style="display: flex; gap: 6px; align-items: center;">
                    <i data-lucide="calendar" style="width:14px;height:14px;color:var(--muted);"></i>
                    <span class="tiny muted bold uppercase">Due:</span>
                    <select class="modal-input tiny" style="width: auto;" onchange="OL.setGlobalTaskFilter('dateRange', this.value)">
                        <option value="All" ${OL.globalTaskFilterState.dateRange === 'All' ? 'selected' : ''}>All Dates</option>
                        <option value="Overdue" ${OL.globalTaskFilterState.dateRange === 'Overdue' ? 'selected' : ''}>Overdue</option>
                        <option value="Today" ${OL.globalTaskFilterState.dateRange === 'Today' ? 'selected' : ''}>Today</option>
                        <option value="Week" ${OL.globalTaskFilterState.dateRange === 'Week' ? 'selected' : ''}>This Week</option>
                        <option value="NextTwoWeeks" ${OL.globalTaskFilterState.dateRange === 'NextTwoWeeks' ? 'selected' : ''}>Next Two Weeks</option>
                        <option value="Month" ${OL.globalTaskFilterState.dateRange === 'Month' ? 'selected' : ''}>This Month</option>
                    </select>
                </div>

                <div style="display: flex; gap: 8px; align-items: center;">
                    <i data-lucide="layers" style="width:14px;height:14px;color:var(--muted);"></i>
                    <span class="tiny muted bold uppercase">Group:</span>
                    <select class="modal-input tiny" style="width: auto;" onchange="OL.setGlobalTaskFilter('groupBy', this.value)">
                        <option value="client" ${OL.globalTaskFilterState.groupBy === 'client' ? 'selected' : ''}>Client Workspace</option>
                        <option value="status" ${OL.globalTaskFilterState.groupBy === 'status' ? 'selected' : ''}>Status</option>
                        <option value="assignee" ${OL.globalTaskFilterState.groupBy === 'assignee' ? 'selected' : ''}>Assignee</option>
                    </select>

                    <span class="tiny muted bold uppercase">Sub-Group:</span>
                    <select class="modal-input tiny" style="width: auto;" onchange="OL.setGlobalTaskFilter('subGroupBy', this.value)">
                        <option value="none" ${OL.globalTaskFilterState.subGroupBy === 'none' ? 'selected' : ''}>None</option>
                        <option value="type" ${OL.globalTaskFilterState.subGroupBy === 'type' ? 'selected' : ''}>Task Type</option>
                        <option value="resource" ${OL.globalTaskFilterState.subGroupBy === 'resource' ? 'selected' : ''}>Related Resource</option>
                    </select>
                </div>
            </div>

            <!-- TASK LIST CONTAINER -->
            <div id="global-task-table">
                ${OL.renderFilteredTaskGroups(masterTasks)}
            </div>
        </div>
    `;

    requestAnimationFrame(() => {
        if (window.lucide) lucide.createIcons();
    });
};

OL.setGlobalTaskFilter = function(key, val) {
    OL.globalTaskFilterState[key] = val;
    OL.renderBusinessTaskManager();
};

OL.renderFilteredTaskGroups = function(allTasks) {
    const { query, status, assignee, dateRange, groupBy, subGroupBy } = OL.globalTaskFilterState;

    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);

    const nextTwoWeeks = new Date(now);
    nextTwoWeeks.setDate(now.getDate() + 14);

    const masterStatuses = OL.getSystemStatuses();
    const closedStatusNames = masterStatuses.filter(s => s.isClosed).map(s => s.name);

    let filtered = allTasks.filter(t => {
        const titleMatch = (t.title || t.name || '').toLowerCase().includes(query.toLowerCase());
        const clientMatch = (t.clientName || '').toLowerCase().includes(query.toLowerCase());
        const resourceMatch = (t.resourceName || '').toLowerCase().includes(query.toLowerCase());
        
        let statusMatch = true;
        if (status === 'Open') statusMatch = !closedStatusNames.includes(t.status) && t.status !== 'Done';
        else if (status === 'Closed') statusMatch = closedStatusNames.includes(t.status) || t.status === 'Done';
        else if (status !== 'All') statusMatch = (t.status || 'Pending Sphynx Action') === status;

        let assigneeMatch = true;
        if (assignee === 'Sphynx') assigneeMatch = t.assignee === 'Sphynx Task' || (!t.isClientTask && !OL.thirdPartyAssignees.includes(t.assignee));
        else if (assignee === 'Client') assigneeMatch = t.assignee !== 'Sphynx Task' && !OL.thirdPartyAssignees.includes(t.assignee);
        else if (assignee === '3rdParty') assigneeMatch = OL.thirdPartyAssignees.includes(t.assignee);
        else if (assignee !== 'All') assigneeMatch = t.assignee === assignee;

        let dateMatch = true;
        if (dateRange !== 'All') {
            if (!t.dueDate) {
                dateMatch = false;
            } else {
                const taskDate = new Date(t.dueDate);
                const taskDateStr = t.dueDate.slice(0, 10);

                if (dateRange === 'Overdue') {
                    dateMatch = taskDateStr < todayStr && !closedStatusNames.includes(t.status);
                } else if (dateRange === 'Today') {
                    dateMatch = taskDateStr === todayStr;
                } else if (dateRange === 'Week') {
                    dateMatch = taskDate >= startOfWeek && taskDate <= endOfWeek;
                } else if (dateRange === 'NextTwoWeeks') {
                    dateMatch = taskDate >= now && taskDate <= nextTwoWeeks;
                } else if (dateRange === 'Month') {
                    dateMatch = taskDate.getMonth() === now.getMonth() && taskDate.getFullYear() === now.getFullYear();
                }
            }
        }

        return (titleMatch || clientMatch || resourceMatch) && statusMatch && assigneeMatch && dateMatch;
    });

    if (filtered.length === 0) {
        return `<div class="p-20 muted text-center">No matching tasks found across projects.</div>`;
    }

    const groups = {};
    filtered.forEach(task => {
        let groupKey = 'Other';
        if (groupBy === 'client') groupKey = task.clientName;
        else if (groupBy === 'status') groupKey = task.status || 'Pending Sphynx Action';
        else if (groupBy === 'assignee') groupKey = task.assignee || 'Sphynx Task';

        if (!groups[groupKey]) groups[groupKey] = [];
        groups[groupKey].push(task);
    });

    return Object.entries(groups).map(([groupTitle, tasks]) => {
        const groupHours = tasks.reduce((sum, t) => sum + (t.loggedHours || 0), 0);
        const sampleClientId = tasks[0]?.clientId;
        const metrics = groupBy === 'client' ? OL.getClientReconciliationMetrics(sampleClientId) : null;

        const subGroups = {};
        if (subGroupBy !== 'none') {
            tasks.forEach(task => {
                let subKey = 'General';
                if (subGroupBy === 'type') subKey = task.taskType;
                else if (subGroupBy === 'resource') subKey = task.resourceName || 'Unassigned Resource';

                if (!subGroups[subKey]) subGroups[subKey] = [];
                subGroups[subKey].push(task);
            });
        }

        return `
        <div style="margin-bottom: 24px;">
            <div style="font-weight: 800; font-size: 13px; letter-spacing: 0.05em; text-transform: uppercase; color: var(--accent); margin-bottom: 10px; display: flex; align-items: center; justify-content: space-between;">
                <div style="display:flex; align-items:center; gap:8px;">
                    <i data-lucide="folder" style="width:14px;height:14px;"></i>
                    <span>${esc(groupTitle)}</span>
                    <span class="pill tiny soft" style="font-size: 10px;">${tasks.length} tasks</span>
                </div>
                
                <div style="display:flex; align-items:center; gap:12px;">
                    ${metrics && metrics.scopedHours > 0 ? `
                        <span class="tiny monospace" style="color:${metrics.remainingHours < 0 ? '#ef4444' : '#38bdf8'}; font-weight:bold;">
                            Paid Scoped: ${metrics.scopedHours.toFixed(1)}h (${metrics.burnRate}% Used)
                        </span>
                    ` : ''}
                    <div class="tiny muted monospace" style="font-weight: normal; display:flex; align-items:center; gap:4px;">
                        <i data-lucide="clock" style="width:12px;height:12px;"></i> Group Time: <strong style="color:var(--accent);">${groupHours.toFixed(1)}h</strong>
                    </div>
                </div>
            </div>
            
            ${subGroupBy === 'none' ? `
                <div style="display: grid; gap: 8px;">
                    ${tasks.map(t => OL.renderTaskRowHTML(t, todayStr)).join('')}
                </div>
            ` : `
                <div style="display: grid; gap: 16px; padding-left: 12px; border-left: 2px solid rgba(var(--accent-rgb), 0.2);">
                    ${Object.entries(subGroups).map(([subTitle, subTasks]) => `
                        <div>
                            <div class="tiny muted uppercase bold" style="margin-bottom: 6px; display:flex; align-items:center; gap:6px;">
                                <i data-lucide="corner-down-right" style="width:12px;height:12px;"></i> ${esc(subTitle)} (${subTasks.length})
                            </div>
                            <div style="display: grid; gap: 8px;">
                                ${subTasks.map(t => OL.renderTaskRowHTML(t, todayStr)).join('')}
                            </div>
                        </div>
                    `).join('')}
                </div>
            `}
        </div>
        `;
    }).join('');
};

// Render Individual Task Row (ClickUp-Style 2-Line Layout)
OL.renderTaskRowHTML = function(t, todayStr) {
    const is3rdParty = (OL.thirdPartyAssignees || []).includes(t.assignee);
    const isGenericSphynx = t.assignee === 'Sphynx Task' || t.assignee === 'Sphynx';
    const isGenericClient = t.assignee === 'Client Task' || t.assignee === 'Client';
    const isNamedPerson = !isGenericSphynx && !isGenericClient && !is3rdParty;

    const isTimerRunning = OL.activeTaskTimer.taskId === t.id;

    const masterStatuses = OL.getSystemStatuses();
    const activeStatusObj = masterStatuses.find(s => s.name === t.status) || { color: '#94a3b8', isClosed: false };
    const dotColor = activeStatusObj.color;
    const isOverdue = t.dueDate && t.dueDate.slice(0,10) < todayStr && !activeStatusObj.isClosed;

    // 🎨 Assignee Avatar Badge Styling
    let avatarBg = 'rgba(56, 189, 248, 0.15)';
    let avatarColor = '#38bdf8';
    let avatarContent = '';

    if (is3rdParty) {
        avatarBg = 'rgba(168, 85, 247, 0.15)';
        avatarColor = '#a855f7';
        avatarContent = `<i data-lucide="wrench" style="width:12px;height:12px; pointer-events:none;"></i>`;
    } else if (isGenericSphynx) {
        avatarBg = 'rgba(56, 189, 248, 0.15)';
        avatarColor = '#38bdf8';
        avatarContent = `<i data-lucide="zap" style="width:12px;height:12px; pointer-events:none;"></i>`;
    } else if (isGenericClient) {
        avatarBg = 'rgba(236, 72, 153, 0.15)';
        avatarColor = '#ec4899';
        avatarContent = `<i data-lucide="user" style="width:12px;height:12px; pointer-events:none;"></i>`;
    } else if (isNamedPerson) {
        avatarBg = '#ec4899';
        avatarColor = '#ffffff';
        const nameParts = (t.assignee || 'CL').trim().split(' ');
        if (nameParts.length >= 2) {
            avatarContent = `${nameParts[0][0]}${nameParts[nameParts.length - 1][0]}`.toUpperCase();
        } else {
            avatarContent = nameParts[0].substring(0, 2).toUpperCase();
        }
    }

    return `
    <div class="task-row-card" 
         style="display:flex; flex-direction:column; gap:6px; padding:10px 14px; background:${isTimerRunning ? 'rgba(56, 189, 248, 0.08)' : 'rgba(255,255,255,0.01)'}; border-bottom:1px solid var(--line); border-radius:4px; cursor:pointer;"
         onclick="OL.handleTaskRowClick(event, '${t.clientId}', '${t.id}')">
        
        <!-- LINE 1: Status Dot + Expanded Task Title + Workspace Badge -->
        <div style="display:flex; align-items:center; gap:10px; width:100%;">
            <!-- Status Dot -->
            <div onclick="event.stopPropagation();" style="display:flex; align-items:center;">
                <span title="Status: ${esc(t.status || 'Pending')}" 
                      style="width:10px; height:10px; border-radius:50%; background-color:${dotColor}; display:inline-block; cursor:pointer;"
                      onclick="OL.openEditTaskStatusQuickDropdown(event, '${t.clientId}', '${t.id}')">
                </span>
            </div>

            <!-- Full-Width Task Title -->
            <div class="task-title-cell" 
                 style="font-weight:600; font-size:13px; color:var(--text); cursor:pointer; flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;"
                 onclick="OL.openTaskInContext('${t.clientId}', '${t.id}')">
                ${esc(t.title || t.name)}
            </div>

            <!-- Workspace Tag -->
            <div style="flex-shrink:0;">
                <span class="client-link-badge pill tiny soft" 
                      style="cursor:pointer; text-decoration:none; font-weight:600; padding:2px 8px; border-radius:4px; display:inline-flex; align-items:center; gap:5px; font-size:11px;" 
                      onclick="event.stopPropagation(); OL.navigateToClientProject('${t.clientId}')"
                      title="Jump to Workspace">
                    <i data-lucide="folder" style="width:12px;height:12px; pointer-events:none;"></i> ${esc(t.clientName)}
                </span>
            </div>
        </div>

        <!-- LINE 2: Linked Resource | Due Date | Time Logging | Assignee Badge -->
        <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; padding-top:4px; border-top:1px dashed rgba(255,255,255,0.04);">
            
            <div style="display:flex; align-items:center; gap:12px;">
                <!-- Linked Resource -->
                <span class="pill tiny soft" style="font-size:10px; color:var(--accent); background:rgba(var(--accent-rgb), 0.06); border:1px solid rgba(var(--accent-rgb), 0.15); display:inline-flex; align-items:center; gap:4px;">
                    <i data-lucide="database" style="width:11px;height:11px; pointer-events:none;"></i>
                    ${esc(t.resourceName || t.category || 'General Resource')}
                </span>

                <!-- Due Date -->
                <div onclick="event.stopPropagation();" style="position:relative; display:flex; align-items:center;">
                    <i data-lucide="calendar" style="position:absolute; left:6px; width:12px; height:12px; color:${isOverdue ? '#ef4444' : 'var(--muted)'}; pointer-events:none;"></i>
                    <input type="date" 
                           class="modal-input tiny monospace" 
                           value="${t.dueDate ? t.dueDate.slice(0,10) : ''}"
                           style="width:125px; padding-left:22px; border:none; background:transparent; font-size:11px; color:${isOverdue ? '#ef4444' : 'inherit'}; font-weight:${isOverdue ? 'bold' : 'normal'};"
                           onchange="OL.updateGlobalTaskDueDate('${t.clientId}', '${t.id}', this.value)">
                </div>
            </div>

            <div style="display:flex; align-items:center; gap:10px;">
                <!-- Time Controls -->
                <div onclick="event.stopPropagation();" style="display:flex; align-items:center; gap:4px;">
                    <button class="btn tiny ${isTimerRunning ? 'danger' : 'primary'}" 
                            id="timer-btn-${t.id}"
                            title="Timer & Logging Options"
                            style="font-weight:bold; width:26px; height:24px; padding:0; display:inline-flex; align-items:center; justify-content:center;" 
                            onclick="OL.openTaskTimerDropdown(event, '${t.clientId}', '${t.id}')">
                        <i data-lucide="${isTimerRunning ? 'square' : 'timer'}" style="width:12px;height:12px; pointer-events:none;"></i>
                    </button>

                    <span id="timer-display-${t.id}" class="tiny monospace bold" style="min-width:38px; text-align:right; color:${isTimerRunning ? '#38bdf8' : 'var(--accent)'}; font-size:11px;">
                        ${isTimerRunning ? OL.formatSecondsDisplay(OL.activeTaskTimer.elapsedSeconds) : `${t.loggedHours.toFixed(1)}h`}
                    </span>

                    <button class="btn tiny soft" style="padding:2px 5px; font-size:10px;" onclick="OL.logTaskHours('${t.clientId}', '${t.id}', 0.5)">+0.5</button>
                    <button class="btn tiny soft" style="padding:2px 5px; font-size:10px;" onclick="OL.logTaskHours('${t.clientId}', '${t.id}', 1.0)">+1h</button>
                    <button class="btn tiny soft" title="Edit Time Log" onclick="OL.openEditTaskTimeModal('${t.clientId}', '${t.id}')" style="display:inline-flex; align-items:center; justify-content:center; padding:3px 5px;">
                        <i data-lucide="pencil" style="width:11px;height:11px; pointer-events:none;"></i>
                    </button>
                </div>

                <!-- Assignee Avatar -->
                <div onclick="event.stopPropagation();" style="display:flex; justify-content:center; position:relative;">
                    <div title="Assignee: ${esc(t.assignee)}" 
                         style="width:24px; height:24px; border-radius:50%; background:${avatarBg}; color:${avatarColor}; ${isNamedPerson ? 'border:none;' : `border:1px solid ${avatarColor};`} font-size:10px; font-weight:bold; display:flex; align-items:center; justify-content:center; cursor:pointer;"
                         onclick="OL.openEditTaskAssigneeDropdown(event, '${t.clientId}', '${t.id}')">
                        ${avatarContent}
                    </div>
                </div>
            </div>
        </div>
    </div>
    `;
};

// ================= LIGHTWEIGHT POPOVER DROPDOWNS ================= //

OL.closePopoverDropdown = function() {
    const existing = document.getElementById('task-popover-dropdown');
    if (existing) existing.remove();
    document.removeEventListener('click', OL.closePopoverDropdown);
};

OL.createPopoverContainer = function(event) {
    OL.closePopoverDropdown();
    event.stopPropagation();

    const popover = document.createElement('div');
    popover.id = 'task-popover-dropdown';
    popover.style.cssText = `
        position: fixed;
        z-index: 10000;
        background: var(--bg-card, #1e293b);
        border: 1px solid var(--line, #334155);
        border-radius: 6px;
        box-shadow: 0 10px 25px -5px rgba(0,0,0,0.5);
        padding: 8px;
        min-width: 180px;
        font-size: 12px;
    `;

    const rect = event.currentTarget.getBoundingClientRect();
    popover.style.top = `${rect.bottom + window.scrollY + 4}px`;
    popover.style.left = `${Math.min(rect.left + window.scrollX, window.innerWidth - 200)}px`;

    document.body.appendChild(popover);
    setTimeout(() => document.addEventListener('click', OL.closePopoverDropdown), 10);
    return popover;
};

// 🎯 Status Selection Popover
OL.openEditTaskStatusQuickDropdown = function(event, clientId, taskId) {
    const popover = OL.createPopoverContainer(event);
    const client = state.clients?.[clientId];
    const task = client?.projectData?.clientTasks?.find(t => String(t.id) === String(taskId) || String(t.key) === String(taskId));
    const statuses = OL.getSystemStatuses();

    popover.innerHTML = `
        <div class="tiny bold uppercase muted" style="margin-bottom:6px; padding:2px 4px;">Update Status</div>
        <div style="display:grid; gap:4px; max-height:260px; overflow-y:auto;">
            ${statuses.map(s => `
                <button class="btn tiny soft" 
                        style="display:flex; align-items:center; gap:8px; width:100%; text-align:left; justify-content:flex-start; padding:6px 8px; ${task?.status === s.name ? 'border:1px solid var(--accent); background:rgba(var(--accent-rgb),0.1);' : ''}"
                        onclick="OL.updateGlobalTaskStatus('${clientId}', '${taskId}', '${esc(s.name)}'); OL.closePopoverDropdown();">
                    <span style="width:8px; height:8px; border-radius:50%; background:${s.color}; flex-shrink:0;"></span>
                    <span style="flex:1;">${esc(s.name)}</span>
                    ${task?.status === s.name ? '<i data-lucide="check" style="width:12px;height:12px;color:var(--accent);"></i>' : ''}
                </button>
            `).join('')}
        </div>
    `;
    if (window.lucide) lucide.createIcons();
};

// 👥 Assignee Selection Popover
OL.openEditTaskAssigneeDropdown = function(event, clientId, taskId) {
    const popover = OL.createPopoverContainer(event);
    const teamOptions = OL.getClientTeamOptions(clientId);

    popover.innerHTML = `
        <div class="tiny bold uppercase muted" style="margin-bottom:6px; padding:2px 4px;">Assign Task</div>
        <div style="display:grid; gap:4px; max-height:260px; overflow-y:auto;">
            <button class="btn tiny soft" style="display:flex; align-items:center; gap:6px; text-align:left;" onclick="OL.updateGlobalTaskAssignee('${clientId}', '${taskId}', 'Sphynx Task'); OL.closePopoverDropdown();">
                <i data-lucide="zap" style="width:12px;height:12px;color:var(--accent);"></i> Sphynx Task
            </button>
            <button class="btn tiny soft" style="display:flex; align-items:center; gap:6px; text-align:left;" onclick="OL.updateGlobalTaskAssignee('${clientId}', '${taskId}', 'Client Task'); OL.closePopoverDropdown();">
                <i data-lucide="user" style="width:12px;height:12px;color:#ec4899;"></i> Client Task
            </button>
            ${(state.master?.sphynxTeam || []).length > 0 ? `
                <div class="tiny muted uppercase bold" style="margin-top:6px; padding:2px 4px;">Sphynx Team</div>
                ${state.master.sphynxTeam.map(m => `
                    <button class="btn tiny soft" style="display:flex; align-items:center; gap:6px; text-align:left;" onclick="OL.updateGlobalTaskAssignee('${clientId}', '${taskId}', '${esc(m.name)}'); OL.closePopoverDropdown();">
                        <i data-lucide="shield-check" style="width:12px;height:12px;color:var(--accent);"></i> ${esc(m.name)}
                    </button>
                `).join('')}
            ` : ''}
            ${teamOptions.length > 0 ? `
                <div class="tiny muted uppercase bold" style="margin-top:6px; padding:2px 4px;">Client Team</div>
                ${teamOptions.map(m => `
                    <button class="btn tiny soft" style="display:flex; align-items:center; gap:6px; text-align:left;" onclick="OL.updateGlobalTaskAssignee('${clientId}', '${taskId}', '${esc(m.name)}'); OL.closePopoverDropdown();">
                        <i data-lucide="user" style="width:12px;height:12px;color:#ec4899;"></i> ${esc(m.name)}
                    </button>
                `).join('')}
            ` : ''}
            <div class="tiny muted uppercase bold" style="margin-top:6px; padding:2px 4px;">Vendors / 3rd Party</div>
            ${OL.thirdPartyAssignees.map(tp => `
                <button class="btn tiny soft" style="display:flex; align-items:center; gap:6px; text-align:left;" onclick="OL.updateGlobalTaskAssignee('${clientId}', '${taskId}', '${esc(tp)}'); OL.closePopoverDropdown();">
                    <i data-lucide="wrench" style="width:12px;height:12px;color:#a855f7;"></i> ${esc(tp)}
                </button>
            `).join('')}
        </div>
    `;
    if (window.lucide) lucide.createIcons();
};

// ⏱️ Timer & Quick Time Logging Dropdown
OL.openTaskTimerDropdown = function(event, clientId, taskId) {
    const popover = OL.createPopoverContainer(event);
    const isTimerRunning = OL.activeTaskTimer.taskId === taskId;

    popover.innerHTML = `
        <div class="tiny bold uppercase muted" style="margin-bottom:6px; padding:2px 4px;">Timer & Time Log</div>
        <div style="display:grid; gap:4px;">
            <button class="btn tiny ${isTimerRunning ? 'danger' : 'primary'}" style="display:flex; align-items:center; gap:6px; justify-content:center; font-weight:bold;" onclick="OL.toggleLiveTaskTimer('${clientId}', '${taskId}'); OL.closePopoverDropdown();">
                <i data-lucide="${isTimerRunning ? 'square' : 'play'}" style="width:12px;height:12px;"></i>
                ${isTimerRunning ? 'Stop Timer' : 'Start Live Timer'}
            </button>
            <div class="tiny muted uppercase bold" style="margin-top:6px; padding:2px 4px;">Quick Time Add</div>
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:4px;">
                <button class="btn tiny soft" onclick="OL.logTaskHours('${clientId}', '${taskId}', 0.08); OL.closePopoverDropdown();">+5 mins</button>
                <button class="btn tiny soft" onclick="OL.logTaskHours('${clientId}', '${taskId}', 0.17); OL.closePopoverDropdown();">+10 mins</button>
                <button class="btn tiny soft" onclick="OL.logTaskHours('${clientId}', '${taskId}', 0.25); OL.closePopoverDropdown();">+15 mins</button>
                <button class="btn tiny soft" onclick="OL.logTaskHours('${clientId}', '${taskId}', 0.50); OL.closePopoverDropdown();">+30 mins</button>
                <button class="btn tiny soft" style="grid-column: span 2;" onclick="OL.logTaskHours('${clientId}', '${taskId}', 1.00); OL.closePopoverDropdown();">+60 mins (+1h)</button>
            </div>
            <div style="margin-top:6px; padding-top:6px; border-top:1px solid var(--line);">
                <button class="btn tiny soft" style="display:flex; align-items:center; gap:6px; width:100%; justify-content:center;" onclick="OL.openEditTaskTimeModal('${clientId}', '${taskId}'); OL.closePopoverDropdown();">
                    <i data-lucide="pencil" style="width:11px;height:11px;"></i> Custom Time Edit
                </button>
            </div>
        </div>
    `;
    if (window.lucide) lucide.createIcons();
};

// ================= DATA MUTATION & AUTO-RE-RENDER HANDLERS ================= //

// This shared task row (OL.renderTaskRowHTML) is used by both the master/global
// Business Manager task list AND the per-client workspace task list. Mutation
// handlers below must refresh whichever one is actually on screen, not always
// force-navigate back to the master rollup.
OL.refreshTaskView = function() {
    const hash = window.location.hash || '';
    if (hash.includes('client-tasks') && typeof window.renderClientTaskManager === 'function') {
        window.renderClientTaskManager();
    } else if (typeof OL.renderBusinessTaskManager === 'function') {
        OL.renderBusinessTaskManager();
    }
};

OL.updateGlobalTaskDueDate = function(clientId, taskId, newDueDate) {
    updateAndSync(() => {
        const client = state.clients[clientId];
        if (!client || !client.projectData?.clientTasks) return;
        
        const task = client.projectData.clientTasks.find(t => t.id === taskId);
        if (task) {
            task.dueDate = newDueDate;
        }
    }, clientId);
    OL.refreshTaskView();
};

// 🚦 Persist Status Change to Supabase State
OL.updateGlobalTaskStatus = function(clientId, taskId, newStatus) {
    console.log(`📡 Updating Status for Task [${taskId}] in Client [${clientId}] -> ${newStatus}`);

    updateAndSync(() => {
        const client = state.clients?.[clientId];
        if (!client) {
            console.error("❌ Client not found in state:", clientId);
            return;
        }

        if (!client.projectData) client.projectData = {};
        if (!client.projectData.clientTasks) client.projectData.clientTasks = [];

        // Flexible ID/Key match (handles both string & number representations)
        const task = client.projectData.clientTasks.find(t => 
            String(t.id) === String(taskId) || String(t.key) === String(taskId)
        );

        if (task) {
            task.status = newStatus;
            console.log(`✅ Status updated successfully for [${taskId}] -> ${newStatus}`);
        } else {
            console.error("❌ Task not found in client workspace:", taskId);
        }
    }, clientId);

    // Re-render immediately to reflect state
    OL.refreshTaskView();
};

// 👥 Persist Assignee Change to Supabase State
OL.updateGlobalTaskAssignee = function(clientId, taskId, newAssignee) {
    console.log(`📡 Updating Assignee for Task [${taskId}] in Client [${clientId}] -> ${newAssignee}`);

    updateAndSync(() => {
        const client = state.clients?.[clientId];
        if (!client) {
            console.error("❌ Client not found in state:", clientId);
            return;
        }

        if (!client.projectData) client.projectData = {};
        if (!client.projectData.clientTasks) client.projectData.clientTasks = [];

        // Flexible ID/Key match
        const task = client.projectData.clientTasks.find(t => 
            String(t.id) === String(taskId) || String(t.key) === String(taskId)
        );

        if (task) {
            task.assignee = newAssignee;
            task.isClientTask = (newAssignee !== 'Sphynx Task' && !(OL.thirdPartyAssignees || []).includes(newAssignee));
            console.log(`✅ Assignee updated successfully for [${taskId}] -> ${newAssignee}`);
        } else {
            console.error("❌ Task not found in client workspace:", taskId);
        }
    }, clientId);

    // Re-render immediately to reflect state
    OL.refreshTaskView();
};

OL.logTaskHours = function(clientId, taskId, additionalHours) {
    updateAndSync(() => {
        const client = state.clients[clientId];
        if (!client || !client.projectData?.clientTasks) return;
        
        const task = client.projectData.clientTasks.find(t => t.id === taskId);
        if (task) {
            const current = Number(task.loggedHours || task.hoursLogged || 0);
            task.loggedHours = current + Number(additionalHours);
            task.hoursLogged = task.loggedHours;
        }
    }, clientId);
    OL.refreshTaskView();
};

OL.toggleLiveTaskTimer = function(clientId, taskId) {
    const timer = OL.activeTaskTimer;

    if (timer.taskId === taskId) {
        OL.stopLiveTaskTimer();
        return;
    }

    if (timer.taskId) {
        OL.stopLiveTaskTimer();
    }

    timer.clientId = clientId;
    timer.taskId = taskId;
    timer.startTime = Date.now();
    timer.elapsedSeconds = 0;

    timer.intervalId = setInterval(() => {
        timer.elapsedSeconds++;
        const displayEl = document.getElementById(`timer-display-${taskId}`);
        if (displayEl) {
            displayEl.innerText = OL.formatSecondsDisplay(timer.elapsedSeconds);
        }
    }, 1000);

    OL.refreshTaskView();
};

OL.stopLiveTaskTimer = function() {
    const timer = OL.activeTaskTimer;
    if (!timer.taskId) return;

    clearInterval(timer.intervalId);
    const hoursEarned = Number((timer.elapsedSeconds / 3600).toFixed(2));

    if (hoursEarned > 0) {
        OL.logTaskHours(timer.clientId, timer.taskId, hoursEarned);
    }

    OL.activeTaskTimer = {
        clientId: null,
        taskId: null,
        startTime: null,
        intervalId: null,
        elapsedSeconds: 0
    };

    OL.refreshTaskView();
};

OL.formatSecondsDisplay = function(totalSeconds) {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
};

OL.updateQuickTaskTeamDropdown = function(clientId) {
    const assigneeSelect = document.getElementById('quick-task-assignee');
    if (!assigneeSelect) return;

    const teamOptions = OL.getClientTeamOptions(clientId);
    let html = `<option value="Sphynx Task" selected>Sphynx Task</option>`;
    if (teamOptions.length > 0) {
        html += `<optgroup label="Client Team Members">`;
        teamOptions.forEach(m => {
            html += `<option value="${esc(m.name)}">${esc(m.name)}</option>`;
        });
        html += `</optgroup>`;
    } else {
        html += `<option value="Client Task">Client Task</option>`;
    }
    html += `<optgroup label="Third-Party / Vendors">`;
    OL.thirdPartyAssignees.forEach(tp => {
        html += `<option value="${esc(tp)}">${esc(tp)}</option>`;
    });
    html += `</optgroup>`;

    assigneeSelect.innerHTML = html;
};

OL.navigateToClientProject = function(clientId) {
    if (typeof switchClient === 'function') switchClient(clientId);
    else if (typeof OL.switchClient === 'function') OL.switchClient(clientId);
};

// ================= HARDENED ROW CLICK HANDLER ================= //

OL.handleTaskRowClick = function(event, clientId, taskId) {
    const isInteractive = event.target.closest('select, input, button, a, .client-link-badge, #task-popover-dropdown');
    if (isInteractive) return;

    event.preventDefault();
    event.stopPropagation();

    OL.openTaskInContext(clientId, taskId);
};

// 📝 Standalone Generic Modal Overlay Helper
OL.showOverlayModal = function(htmlContent) {
    let layer = document.getElementById("modal-layer");
    if (!layer) {
        layer = document.createElement("div");
        layer.id = "modal-layer";
        layer.style.cssText = "position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.7); display:flex; align-items:center; justify-content:center; z-index:9999; backdrop-filter:blur(3px);";
        document.body.appendChild(layer);
    }
    layer.style.display = "flex";
    layer.innerHTML = `
        <div class="modal-box" style="background:var(--bg-card, #1e293b); border:1px solid var(--line, #334155); border-radius:8px; max-width:650px; width:90%; padding:20px; box-shadow:0 20px 25px -5px rgba(0,0,0,0.5); color:inherit;" onclick="event.stopPropagation()">
            ${htmlContent}
        </div>
    `;
    layer.onclick = function() { OL.closeModal(); };
    if (window.lucide) lucide.createIcons();
};

OL.closeModal = function() {
    const layer = document.getElementById("modal-layer");
    if (layer) {
        layer.style.display = "none";
        layer.innerHTML = "";
    }
    const overlay = document.getElementById("modal-overlay");
    if (overlay) {
        overlay.style.display = "none";
        overlay.innerHTML = "";
    }
};

// 🔍 In-Context Task Launcher
OL.openTaskInContext = async function(clientId, taskId) {
    try {
        if (typeof loadFullClient === 'function') {
            await loadFullClient(clientId);
        } else if (typeof OL.loadFullClient === 'function') {
            await OL.loadFullClient(clientId);
        }

        const client = state.clients?.[clientId];
        const task = client?.projectData?.clientTasks?.find(t => t.id === taskId || t.key === taskId);

        if (!task) {
            console.error("❌ Could not resolve task in state:", taskId);
            return;
        }

        if (typeof window.openTaskModal === 'function') {
            window.openTaskModal(taskId, false, clientId);
            return;
        }

        OL.renderInContextTaskModal(client, task);
    } catch (err) {
        console.error("❌ Error launching task modal:", err);
    }
};

OL.renderInContextTaskModal = function(client, task) {
    const is3rdParty = (OL.thirdPartyAssignees || []).includes(task.assignee);
    const isClientAssigned = task.assignee !== 'Sphynx Task' && !is3rdParty;

    const content = `
        <div style="padding: 24px; max-width: 650px; width: 100%;" onclick="event.stopPropagation()">
            <div class="modal-header" style="display:flex; justify-content:space-between; align-items:center; border-bottom: 1px solid var(--line); padding-bottom: 14px; margin-bottom: 20px;">
                <h3 style="margin:0; display:flex; align-items:center; gap:10px; font-size:18px;">
                    <i data-lucide="check-square" style="width:22px;height:22px;color:var(--accent);"></i>
                    ${esc(task.title || task.name)}
                </h3>
                <button class="btn tiny soft" onclick="OL.closeModal()" style="font-weight:bold; font-size:14px;">✕</button>
            </div>

            <div class="modal-body">
                <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-bottom: 20px;">
                    <span class="pill tiny soft" style="font-weight:600; display:inline-flex; align-items:center; gap:4px;">
                        <i data-lucide="folder" style="width:12px;height:12px;"></i> ${esc(client?.meta?.name || 'Workspace')}
                    </span>
                    <span class="pill tiny accent" style="font-weight:bold;">
                        Status: ${esc(task.status || 'Pending Sphynx Action')}
                    </span>
                    <span class="pill tiny soft" style="font-weight:bold; color:${is3rdParty ? '#38bdf8' : (isClientAssigned ? '#fbbf24' : 'var(--accent)')}">
                        Assignee: ${esc(task.assignee || 'Sphynx Task')}
                    </span>
                </div>

                <div style="margin-bottom: 20px; background: rgba(255,255,255,0.02); padding: 14px; border-radius: 6px; border:1px solid var(--line);">
                    <label class="bold tiny uppercase muted" style="display:block; margin-bottom:6px;">Deliverable Details & Description:</label>
                    <div style="font-size:13px; line-height:1.5; color:var(--text);">${esc(task.description || 'No additional notes provided for this task.')}</div>
                </div>

                <div style="display:grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 20px; background:rgba(0,0,0,0.15); padding:14px; border-radius:6px; border:1px solid var(--line);" class="tiny">
                    <div><strong class="muted">Due Date:</strong> ${task.dueDate ? new Date(task.dueDate).toLocaleDateString() : 'Unscheduled'}</div>
                    <div><strong class="muted">Total Logged Time:</strong> <span style="color:var(--accent); font-weight:bold;">${Number(task.loggedHours || 0).toFixed(1)}h</span></div>
                    <div><strong class="muted">Deliverable Category:</strong> ${esc(task.category || 'General')}</div>
                    <div><strong class="muted">Task ID:</strong> <span class="monospace">${esc(task.id)}</span></div>
                </div>

                ${task.timeAuditNote ? `
                    <div style="margin-bottom: 20px; padding:10px; background:rgba(251, 191, 36, 0.08); border:1px solid #fbbf24; border-radius:6px;" class="tiny">
                        <strong>📝 Retroactive Time Audit Note:</strong> ${esc(task.timeAuditNote)}
                    </div>
                ` : ''}

                <div style="display:flex; justify-content:space-between; align-items:center; margin-top:20px; border-top:1px solid var(--line); padding-top:16px;">
                    <button class="btn tiny soft" onclick="OL.openEditTaskTimeModal('${client?.id}', '${task.id}')" style="display:inline-flex; align-items:center; gap:6px;">
                        <i data-lucide="pencil" style="width:12px;height:12px;"></i> Adjust Logged Time
                    </button>
                    <button class="btn primary tiny" onclick="OL.closeModal()" style="font-weight:bold;">Close Window</button>
                </div>
            </div>
        </div>
    `;

    OL.showOverlayModal(content);
};

// ================= RETROACTIVE TIME EDIT MODAL ================= //

OL.openEditTaskTimeModal = function(clientId, taskId) {
    const client = state.clients?.[clientId];
    const task = client?.projectData?.clientTasks?.find(t => t.id === taskId || t.key === taskId);
    if (!task) return;

    const currentHours = Number(task.loggedHours || task.hoursLogged || 0);

    const content = `
        <div style="padding: 20px; max-width: 500px; width: 100%;" onclick="event.stopPropagation()">
            <div class="modal-header" style="display:flex; justify-content:space-between; align-items:center; border-bottom: 1px solid var(--line); padding-bottom: 12px; margin-bottom: 15px;">
                <h3 style="margin:0; display:flex; align-items:center; gap:8px;">
                    <i data-lucide="pencil" style="width:18px;height:18px;color:var(--accent);"></i>
                    Retroactive Time Adjustment
                </h3>
                <button class="btn tiny soft" onclick="OL.closeModal()">✕</button>
            </div>

            <div class="modal-body">
                <div style="margin-bottom: 15px; background: rgba(255,255,255,0.02); padding: 10px; border-radius: 6px; border: 1px solid var(--line);">
                    <strong style="display:block; font-size:13px;">${esc(task.title || task.name)}</strong>
                    <div class="tiny muted" style="margin-top:2px;">📁 ${esc(client.meta?.name || clientId)}</div>
                </div>

                <form onsubmit="event.preventDefault(); OL.saveTaskTimeEdit('${clientId}', '${taskId}');">
                    <div style="margin-bottom: 15px;">
                        <label class="bold tiny uppercase muted" style="display:block; margin-bottom:5px;">Total Hours Logged:</label>
                        <input type="number" step="0.01" min="0" id="edit-task-hours" class="modal-input" value="${currentHours}" required style="width:100%;">
                    </div>

                    <div style="margin-bottom: 20px;">
                        <label class="bold tiny uppercase muted" style="display:block; margin-bottom:5px;">Audit Note / Reason for Change:</label>
                        <textarea id="edit-task-note" class="modal-input" placeholder="e.g. Corrected extra stopwatch run time, added offline call time..." style="height: 70px; width:100%; font-size:12px;">${esc(task.timeAuditNote || '')}</textarea>
                    </div>

                    <div style="display:flex; justify-content:flex-end; gap: 10px;">
                        <button type="button" class="btn soft tiny" onclick="OL.closeModal()">Cancel</button>
                        <button type="submit" class="btn primary tiny" style="font-weight:bold;">Save Adjustments</button>
                    </div>
                </form>
            </div>
        </div>
    `;

    OL.showOverlayModal(content);
};

OL.saveTaskTimeEdit = function(clientId, taskId) {
    const hoursVal = parseFloat(document.getElementById('edit-task-hours')?.value);
    const noteVal = document.getElementById('edit-task-note')?.value;

    if (isNaN(hoursVal) || hoursVal < 0) {
        alert("Please enter a valid number of hours.");
        return;
    }

    updateAndSync(() => {
        const client = state.clients?.[clientId];
        const task = client?.projectData?.clientTasks?.find(t => t.id === taskId || t.key === taskId);
        if (task) {
            task.loggedHours = hoursVal;
            task.hoursLogged = hoursVal;
            task.timeAuditNote = noteVal || '';
        }
    }, clientId);

    if (typeof OL.closeModal === 'function') OL.closeModal();
    OL.refreshTaskView();
};

OL.createGlobalQuickTask = function() {
    const clientId = document.getElementById('quick-task-client')?.value;
    const title = document.getElementById('quick-task-title')?.value;
    const assignee = document.getElementById('quick-task-assignee')?.value || 'Sphynx Task';
    const status = document.getElementById('quick-task-status')?.value || 'Pending Sphynx Action';
    const dueDate = document.getElementById('quick-task-duedate')?.value || '';

    if (!clientId || !title) {
        alert("Please select a client and provide a task title.");
        return;
    }

    updateAndSync(() => {
        const client = state.clients[clientId];
        if (!client) return;

        if (!client.projectData) client.projectData = {};
        if (!client.projectData.clientTasks) client.projectData.clientTasks = [];

        const newTask = {
            id: uid(),
            title: title,
            name: title,
            status: status,
            assignee: assignee,
            dueDate: dueDate,
            isClientTask: (assignee !== 'Sphynx Task' && !OL.thirdPartyAssignees.includes(assignee)),
            loggedHours: 0,
            createdAt: new Date().toISOString()
        };

        client.projectData.clientTasks.unshift(newTask);
    }, clientId);

    const inputTitle = document.getElementById('quick-task-title');
    if (inputTitle) inputTitle.value = '';

    OL.renderBusinessTaskManager();
};
