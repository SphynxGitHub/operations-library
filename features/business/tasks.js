import { esc, uid, state, updateAndSync, loadFullClient, switchClient } from '../../core/data.js';

//============= GLOBAL TASK & TIME MANAGER ===============//

OL.globalTaskFilterState = { 
    query: '', 
    status: 'Open',     // 'Open' | 'Closed' | 'All' | 'Pending' | 'In Progress' | 'Review' | 'Done'
    assignee: 'All',   // 'All' | 'Sphynx' | 'Client' | '3rdParty' | Member Name
    dateRange: 'All',  // 'All' | 'Overdue' | 'Today' | 'Week' | 'NextTwoWeeks' | 'Month'
    groupBy: 'client', // 'client' | 'status' | 'assignee'
    subGroupBy: 'none' // 'none' | 'resource' | 'type'
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

    const clients = Object.values(state.clients || {});
    
    // Aggregate tasks from all clients
    let masterTasks = clients.flatMap(c => 
        (c.projectData?.clientTasks || []).map(t => {
            const teamMembers = c.projectData?.team || c.projectData?.teamMembers || [];
            
            // Resolve Task Classification Type
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
                resourceName: t.resourceName || t.category || 'General Deliverable',
                loggedHours: Number(t.loggedHours || t.hoursLogged || 0)
            };
        })
    );

    const totalLoggedHours = masterTasks.reduce((acc, t) => acc + t.loggedHours, 0);

    main.innerHTML = `
        <div class="section-header">
            <div>
                <h2><i data-lucide="check-square" style="width:24px;height:24px;vertical-align:sub;margin-right:8px;color:var(--accent);"></i>Cross-Project Task & Time Engine</h2>
                <div class="small muted">Consolidated deliverables, team assignments, third-party logs, and scoping reconciliation</div>
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

        <!-- QUICK TASK CREATOR BAR -->
        <div class="card" style="padding: 16px; margin-bottom: 20px; background: rgba(var(--accent-rgb), 0.04); border: 1px solid var(--accent);">
            <div style="font-weight: 800; font-size: 11px; letter-spacing: 0.05em; text-transform: uppercase; color: var(--accent); margin-bottom: 10px; display:flex; align-items:center; gap:6px;">
                <i data-lucide="zap" style="width:14px;height:14px;"></i> Quick Task Creator
            </div>
            <form onsubmit="event.preventDefault(); OL.createGlobalQuickTask();" style="display: grid; grid-template-columns: 180px 2fr 160px 140px 110px 110px; gap: 10px; align-items: center;">
                
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
                    <i data-lucide="flag" style="position:absolute; left:8px; width:13px; height:13px; color:var(--muted); pointer-events:none;"></i>
                    <select id="quick-task-status" class="modal-input tiny" style="padding-left:26px; width:100%;">
                        <option value="Pending" selected>Pending</option>
                        <option value="In Progress">In Progress</option>
                        <option value="Review">Review</option>
                        <option value="Done">Done</option>
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
                        <option value="Open" ${OL.globalTaskFilterState.status === 'Open' ? 'selected' : ''}>Open Items (Pending/Progress/Review)</option>
                        <option value="Closed" ${OL.globalTaskFilterState.status === 'Closed' ? 'selected' : ''}>Closed Items (Done)</option>
                        <option value="All" ${OL.globalTaskFilterState.status === 'All' ? 'selected' : ''}>All Statuses</option>
                        <option value="Pending" ${OL.globalTaskFilterState.status === 'Pending' ? 'selected' : ''}>Pending Only</option>
                        <option value="In Progress" ${OL.globalTaskFilterState.status === 'In Progress' ? 'selected' : ''}>In Progress Only</option>
                        <option value="Review" ${OL.globalTaskFilterState.status === 'Review' ? 'selected' : ''}>Review Only</option>
                        <option value="Done" ${OL.globalTaskFilterState.status === 'Done' ? 'selected' : ''}>Done Only</option>
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

    let filtered = allTasks.filter(t => {
        const titleMatch = (t.title || t.name || '').toLowerCase().includes(query.toLowerCase());
        const clientMatch = (t.clientName || '').toLowerCase().includes(query.toLowerCase());
        const resourceMatch = (t.resourceName || '').toLowerCase().includes(query.toLowerCase());
        
        let statusMatch = true;
        if (status === 'Open') statusMatch = t.status !== 'Done';
        else if (status === 'Closed') statusMatch = t.status === 'Done';
        else if (status !== 'All') statusMatch = (t.status || 'Pending') === status;

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
                    dateMatch = taskDateStr < todayStr && t.status !== 'Done';
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
        else if (groupBy === 'status') groupKey = task.status || 'Pending';
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

// Render Individual Task Row
OL.renderTaskRowHTML = function(t, todayStr) {
    const teamOptions = OL.getClientTeamOptions(t.clientId);
    const isClientAssigned = t.assignee !== 'Sphynx Task' && !OL.thirdPartyAssignees.includes(t.assignee);
    const is3rdParty = OL.thirdPartyAssignees.includes(t.assignee);
    const isTimerRunning = OL.activeTaskTimer.taskId === t.id;
    const isOverdue = t.dueDate && t.dueDate.slice(0,10) < todayStr && t.status !== 'Done';

    return `
    <div class="task-row-container" 
         style="display:grid; grid-template-columns: 2fr 160px 140px 110px 240px; gap: 12px; padding: 10px 14px; background: ${isTimerRunning ? 'rgba(56, 189, 248, 0.08)' : 'rgba(255,255,255,0.02)'}; border: 1px solid ${isTimerRunning ? '#38bdf8' : 'var(--line)'}; border-radius: 6px; align-items:center; cursor:pointer;"
         onclick="OL.handleTaskRowClick(event, '${t.clientId}', '${t.id}')">
        
        <!-- Task Title & Client Tag Badge -->
        <div>
            <div class="task-title-cell" 
                 style="font-weight: 600; cursor: pointer;" 
                 onclick="OL.openTaskInContext('${t.clientId}', '${t.id}')">
                ${esc(t.title || t.name)}
            </div>
            <div class="tiny muted" style="display:flex; gap: 8px; align-items:center; margin-top:4px;">
                <span class="client-link-badge pill tiny soft" 
                      style="cursor:pointer; text-decoration:none; font-weight:600; padding: 2px 8px; border-radius: 4px; display:inline-flex; align-items:center; gap:4px; font-size:10px;" 
                      onclick="event.stopPropagation(); OL.navigateToClientProject('${t.clientId}')"
                      title="Jump to ${esc(t.clientName)} Workspace">
                    <i data-lucide="folder" style="width:10px;height:10px; pointer-events:none;"></i> ${esc(t.clientName)}
                </span>
                ${t.resourceName ? `<span class="muted">• ${esc(t.resourceName)}</span>` : ''}
            </div>
        </div>

        <!-- Assignee Dropdown -->
        <div onclick="event.stopPropagation();" style="position:relative; display:flex; align-items:center;">
            <i data-lucide="${is3rdParty ? 'wrench' : (isClientAssigned ? 'user' : 'zap')}" style="position:absolute; left:8px; width:13px; height:13px; color:${is3rdParty ? '#38bdf8' : (isClientAssigned ? '#fbbf24' : 'var(--accent)')}; pointer-events:none;"></i>
            <select class="modal-input tiny" 
                    style="width: 100%; padding-left: 26px; border-color: ${is3rdParty ? '#38bdf8' : (isClientAssigned ? '#fbbf24' : 'var(--line)')};"
                    onchange="OL.updateGlobalTaskAssignee('${t.clientId}', '${t.id}', this.value)">
                <option value="Sphynx Task" ${t.assignee === 'Sphynx Task' ? 'selected' : ''}>Sphynx Task</option>
                ${teamOptions.length > 0 ? `
                    <optgroup label="Client Team">
                        ${teamOptions.map(m => `
                            <option value="${esc(m.name)}" ${t.assignee === m.name ? 'selected' : ''}>${esc(m.name)}</option>
                        `).join('')}
                    </optgroup>
                ` : `
                    <option value="Client Task" ${t.assignee === 'Client Task' || t.assignee === 'Client' ? 'selected' : ''}>Client Task</option>
                `}
                <optgroup label="3rd Party / Vendors">
                    ${OL.thirdPartyAssignees.map(tp => `
                        <option value="${esc(tp)}" ${t.assignee === tp ? 'selected' : ''}>${esc(tp)}</option>
                    `).join('')}
                </optgroup>
            </select>
        </div>

        <!-- Due Date Input -->
        <div onclick="event.stopPropagation();" style="position:relative; display:flex; align-items:center;">
            <i data-lucide="calendar" style="position:absolute; left:8px; width:12px; height:12px; color:${isOverdue ? '#ef4444' : 'var(--muted)'}; pointer-events:none;"></i>
            <input type="date" 
                   class="modal-input tiny monospace" 
                   value="${t.dueDate ? t.dueDate.slice(0,10) : ''}"
                   style="width:100%; padding-left: 24px; color:${isOverdue ? '#ef4444' : 'inherit'}; font-weight:${isOverdue ? 'bold' : 'normal'};"
                   onchange="OL.updateGlobalTaskDueDate('${t.clientId}', '${t.id}', this.value)">
        </div>

        <!-- Status Dropdown -->
        <div onclick="event.stopPropagation();" style="position:relative; display:flex; align-items:center;">
            <i data-lucide="check-circle" style="position:absolute; left:8px; width:12px; height:12px; color:var(--accent); pointer-events:none;"></i>
            <select class="modal-input tiny" 
                    style="width: 100%; padding-left: 24px; font-weight: bold;" 
                    onchange="OL.updateGlobalTaskStatus('${t.clientId}', '${t.id}', this.value)">
                <option value="Pending" ${t.status === 'Pending' ? 'selected' : ''}>Pending</option>
                <option value="In Progress" ${t.status === 'In Progress' ? 'selected' : ''}>In Progress</option>
                <option value="Review" ${t.status === 'Review' ? 'selected' : ''}>Review</option>
                <option value="Done" ${t.status === 'Done' ? 'selected' : ''}>Done</option>
            </select>
        </div>

        <!-- Timer & Log Controls -->
        <div onclick="event.stopPropagation();" style="display: flex; align-items: center; gap: 4px; justify-content: flex-end;">
            <button class="btn tiny ${isTimerRunning ? 'danger' : 'primary'}" 
                    id="timer-btn-${t.id}"
                    title="${isTimerRunning ? 'Stop Timer' : 'Start Timer'}"
                    style="font-weight: bold; width: 32px; height: 26px; padding:0; display:inline-flex; align-items:center; justify-content:center;" 
                    onclick="event.stopPropagation(); OL.toggleLiveTaskTimer('${t.clientId}', '${t.id}')">
                <i data-lucide="${isTimerRunning ? 'square' : 'timer'}" style="width:13px;height:13px; pointer-events:none;"></i>
            </button>

            <span id="timer-display-${t.id}" class="tiny monospace bold" style="min-width: 48px; text-align: right; color: ${isTimerRunning ? '#38bdf8' : 'var(--accent)'};">
                ${isTimerRunning ? OL.formatSecondsDisplay(OL.activeTaskTimer.elapsedSeconds) : `${t.loggedHours.toFixed(1)}h`}
            </span>

            <button class="btn tiny soft" title="Add 0.5 hours" onclick="event.stopPropagation(); OL.logTaskHours('${t.clientId}', '${t.id}', 0.5)">+0.5</button>
            <button class="btn tiny soft" title="Add 1.0 hour" onclick="event.stopPropagation(); OL.logTaskHours('${t.clientId}', '${t.id}', 1.0)">+1h</button>
            <button class="btn tiny soft" title="Edit Retroactive Time Entry" onclick="event.stopPropagation(); OL.openEditTaskTimeModal('${t.clientId}', '${t.id}')" style="display:inline-flex; align-items:center; justify-content:center;">
                <i data-lucide="pencil" style="width:11px;height:11px; pointer-events:none;"></i>
            </button>
        </div>
    </div>
    `;
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
    // Strictly isolate clicks on interactive controls (Selects, Inputs, Buttons, & Client Workspace Links)
    const isInteractive = event.target.closest('select, input, button, a') || 
                          event.target.classList.contains('client-link-badge') || 
                          event.target.closest('.client-link-badge');
                          
    if (isInteractive) return;

    event.preventDefault();
    event.stopPropagation();

    console.log(`🔍 Direct Row Click - Opening Modal: Client [${clientId}], Task [${taskId}]`);
    OL.openTaskInContext(clientId, taskId);
};

// In-Context Task Detail Modal Launcher
OL.openTaskInContext = async function(clientId, taskId) {
    try {
        if (typeof loadFullClient === 'function') {
            await loadFullClient(clientId);
        } else if (typeof OL.loadFullClient === 'function') {
            await OL.loadFullClient(clientId);
        }

        const client = state.clients?.[clientId];
        const task = client?.projectData?.clientTasks?.find(t => t.id === taskId || t.key === taskId);

        if (typeof window.openTaskModal === 'function') {
            window.openTaskModal(taskId, false, clientId);
        } else if (typeof OL.openTaskModal === 'function') {
            OL.openTaskModal(taskId, false, clientId);
        } else if (task) {
            OL.renderFallbackTaskModal(client, task);
        } else {
            console.error("❌ Task not resolved for modal launcher:", taskId);
        }
    } catch (err) {
        console.error("❌ Error launching task modal:", err);
    }
};

// Fallback Task Detail Modal
OL.renderFallbackTaskModal = function(client, task) {
    const content = `
        <div style="padding: 20px; max-width: 600px; width: 100%;" onclick="event.stopPropagation()">
            <div class="modal-header" style="display:flex; justify-content:space-between; align-items:center; border-bottom: 1px solid var(--line); padding-bottom: 10px; margin-bottom: 15px;">
                <h3 style="margin:0; display:flex; align-items:center; gap:8px;">
                    <i data-lucide="check-square" style="width:20px;height:20px;color:var(--accent);"></i>
                    ${esc(task.title || task.name)}
                </h3>
                <button class="btn tiny soft" onclick="OL.closeModal()">✕</button>
            </div>
            <div class="modal-body">
                <div style="margin-bottom: 12px; display:flex; gap:8px;">
                    <span class="pill tiny soft"><i data-lucide="folder" style="width:12px;height:12px;"></i> ${esc(client?.meta?.name || 'Client')}</span>
                    <span class="pill tiny accent">Status: ${esc(task.status || 'Pending')}</span>
                </div>
                ${task.description ? `<div style="margin-bottom: 15px; background: rgba(255,255,255,0.03); padding: 12px; border-radius: 6px; border:1px solid var(--line);">${esc(task.description)}</div>` : ''}
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 15px;" class="tiny muted">
                    <div><strong>Assignee:</strong> ${esc(task.assignee || 'Sphynx')}</div>
                    <div><strong>Due Date:</strong> ${task.dueDate ? new Date(task.dueDate).toLocaleDateString() : 'None'}</div>
                    <div><strong>Logged Hours:</strong> ${Number(task.loggedHours || 0).toFixed(1)}h</div>
                </div>
                <div style="text-align: right; margin-top: 20px;">
                    <button class="btn primary tiny" onclick="OL.closeModal()">Close</button>
                </div>
            </div>
        </div>
    `;

    if (typeof window.openModal === 'function') {
        window.openModal(content);
        requestAnimationFrame(() => {
            if (window.lucide) lucide.createIcons();
        });
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
    });
};

OL.updateGlobalTaskStatus = function(clientId, taskId, newStatus) {
    updateAndSync(() => {
        const client = state.clients[clientId];
        if (!client || !client.projectData?.clientTasks) return;
        
        const task = client.projectData.clientTasks.find(t => t.id === taskId);
        if (task) {
            task.status = newStatus;
        }
    });
};

OL.updateGlobalTaskAssignee = function(clientId, taskId, newAssignee) {
    updateAndSync(() => {
        const client = state.clients[clientId];
        if (!client || !client.projectData?.clientTasks) return;
        
        const task = client.projectData.clientTasks.find(t => t.id === taskId);
        if (task) {
            task.assignee = newAssignee;
            task.isClientTask = (newAssignee !== 'Sphynx Task' && !OL.thirdPartyAssignees.includes(newAssignee));
        }
    });
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
    });
    OL.renderBusinessTaskManager();
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

    OL.renderBusinessTaskManager();
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

    OL.renderBusinessTaskManager();
};

OL.formatSecondsDisplay = function(totalSeconds) {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
};

OL.createGlobalQuickTask = function() {
    const clientId = document.getElementById('quick-task-client')?.value;
    const title = document.getElementById('quick-task-title')?.value;
    const assignee = document.getElementById('quick-task-assignee')?.value || 'Sphynx Task';
    const status = document.getElementById('quick-task-status')?.value || 'Pending';
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
    });

    const inputTitle = document.getElementById('quick-task-title');
    if (inputTitle) inputTitle.value = '';

    OL.renderBusinessTaskManager();
};

// ================= RETROACTIVE TIME EDIT MODAL ================= //

OL.openEditTaskTimeModal = function(clientId, taskId) {
    const client = state.clients?.[clientId];
    const task = client?.projectData?.clientTasks?.find(t => t.id === taskId || t.key === taskId);
    if (!task) {
        console.error("❌ Task not found for time edit:", taskId);
        return;
    }

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
                        <input type="number" step="0.1" min="0" id="edit-task-hours" class="modal-input" value="${currentHours}" required style="width:100%;">
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

    if (typeof window.openModal === 'function') {
        window.openModal(content);
        requestAnimationFrame(() => {
            if (window.lucide) lucide.createIcons();
        });
    }
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
            console.log(`✅ Retroactive Time Adjustment Saved [${taskId}]: ${hoursVal}h`);
        }
    });

    if (typeof OL.closeModal === 'function') OL.closeModal();
    else if (typeof window.closeModal === 'function') window.closeModal();

    OL.renderBusinessTaskManager();
};
