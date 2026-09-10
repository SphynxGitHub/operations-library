import { esc, val, num, uid, state, getActiveClient, updateAndSync, loadFullClient } from '../core/data.js';

//=============DAILY DASHBOARD===============//

OL.renderDailyDashboard = function() {
    const main = document.getElementById("mainContent");
    if (!main) return;

    const clients = Object.values(state.clients || {});
    const allTasks = clients.flatMap(c => (c.projectData?.clientTasks || []).map(t => ({...t, clientName: c.meta.name, clientId: c.id})));
    const dueToday = allTasks.filter(t => t.status !== 'Done' && t.dueDate);

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
                <div style="font-size: 24px; font-weight: 900; color: #38bdf8; margin-top: 5px;">${allTasks.filter(t => t.status !== 'Done').length}</div>
            </div>
            <div class="card" style="padding: 15px;">
                <div class="tiny muted uppercase bold">Due Today / Overdue</div>
                <div style="font-size: 24px; font-weight: 900; color: #ef4444; margin-top: 5px;">${dueToday.length}</div>
            </div>
        </div>

        <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 20px;">
            <div class="card" style="padding: 20px;">
                <h3>📋 High-Priority Task Stream</h3>
                <div style="margin-top: 15px;">
                    ${allTasks.filter(t => t.status !== 'Done').slice(0, 8).map(t => `
                        <div style="display:flex; justify-content:space-between; align-items:center; padding: 8px 0; border-bottom: 1px solid var(--line);">
                            <div>
                                <strong>${esc(t.title || t.name)}</strong>
                                <span class="pill tiny soft">${esc(t.clientName)}</span>
                            </div>
                            <span class="pill tiny accent">${esc(t.status || 'Pending')}</span>
                        </div>
                    `).join('') || '<div class="tiny muted">No pending tasks.</div>'}
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

//============= GLOBAL TASK & TIME MANAGER ===============//

OL.globalTaskFilterState = {
    query: '',
    status: 'All',
    assignee: 'All',
    dateRange: 'All', // 'All' | 'Today' | 'Week' | 'Month' | 'Overdue'
    groupBy: 'client' // 'client' | 'status' | 'assignee'
};

// ⏱️ LIVE STOPWATCH STATE TRACKER
OL.activeTaskTimer = {
    clientId: null,
    taskId: null,
    startTime: null,
    intervalId: null,
    elapsedSeconds: 0
};

// Helper: Resolve team members for a given client ID
OL.getClientTeamOptions = function(clientId) {
    const client = state.clients[clientId];
    const teamMembers = client?.projectData?.team || client?.projectData?.teamMembers || [];
    return teamMembers.map(m => typeof m === 'string' ? { id: m, name: m } : { id: m.id || m.name, name: m.name || m.email || 'Team Member' });
};

// Helper: Calculate Scoping Sheet totals vs Logged Hours per Client
OL.getClientReconciliationMetrics = function(clientId) {
    const client = state.clients[clientId];
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

    return {
        scopedHours,
        scopedValue,
        loggedHours,
        hourlyRate,
        usedValue,
        remainingHours,
        remainingValue,
        burnRate
    };
};

OL.renderBusinessTaskManager = function() {
    const main = document.getElementById("mainContent");
    if (!main) return;

    const clients = Object.values(state.clients || {});
    
    // Aggregate tasks from all clients
    let masterTasks = clients.flatMap(c => 
        (c.projectData?.clientTasks || []).map(t => {
            const teamMembers = c.projectData?.team || c.projectData?.teamMembers || [];
            return {
                ...t,
                clientName: c.meta?.name || 'Unknown Client',
                clientId: c.id,
                teamMembers: teamMembers,
                assignee: t.assignee || t.responsibleParty || (t.isClientTask ? 'Client Task' : 'Sphynx Task'),
                loggedHours: Number(t.loggedHours || t.hoursLogged || 0)
            };
        })
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

        <!-- ⚡ QUICK TASK CREATION BAR -->
        <div class="card" style="padding: 16px; margin-bottom: 20px; background: rgba(var(--accent-rgb), 0.04); border: 1px solid var(--accent);">
            <div style="font-weight: 800; font-size: 11px; letter-spacing: 0.05em; text-transform: uppercase; color: var(--accent); margin-bottom: 10px; display:flex; align-items:center; gap:6px;">
                <i data-lucide="zap" style="width:14px;height:14px;"></i> Quick Task Creator
            </div>
            <form onsubmit="event.preventDefault(); OL.createGlobalQuickTask();" style="display: grid; grid-template-columns: 180px 2fr 150px 140px 110px 110px; gap: 10px; align-items: center;">
                <select id="quick-task-client" class="modal-input tiny" required onchange="OL.updateQuickTaskTeamDropdown(this.value)">
                    <option value="" disabled selected>Select Client...</option>
                    ${clients.map(c => `<option value="${c.id}">${esc(c.meta?.name || c.id)}</option>`).join('')}
                </select>
                <input type="text" id="quick-task-title" class="modal-input tiny" placeholder="Task title or deliverable description..." required>
                <select id="quick-task-assignee" class="modal-input tiny">
                    <option value="Sphynx Task" selected>⚡ Sphynx Task</option>
                    <option value="Client Task">👤 Client Task</option>
                </select>
                <input type="date" id="quick-task-duedate" class="modal-input tiny" title="Due Date">
                <select id="quick-task-status" class="modal-input tiny">
                    <option value="Pending" selected>Pending</option>
                    <option value="In Progress">In Progress</option>
                    <option value="Review">Review</option>
                    <option value="Done">Done</option>
                </select>
                <button type="submit" class="btn tiny primary" style="height: 100%; font-weight: bold; display:flex; align-items:center; justify-content:center; gap:4px;">
                    <i data-lucide="plus" style="width:14px;height:14px;"></i> Add Task
                </button>
            </form>
        </div>

        <div class="card" style="padding: 20px;">
            <!-- FILTER & GROUPING CONTROLS -->
            <div style="display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; margin-bottom: 15px; padding-bottom: 15px; border-bottom: 1px solid var(--line);">
                <div style="display: flex; gap: 8px; flex: 1; min-width: 240px; align-items:center;">
                    <i data-lucide="search" style="width:16px;height:16px;color:var(--muted);"></i>
                    <input type="text" 
                           class="modal-input tiny" 
                           placeholder="Search tasks, clients, or assignees..." 
                           value="${esc(OL.globalTaskFilterState.query)}"
                           oninput="OL.setGlobalTaskFilter('query', this.value)">
                </div>

                <!-- DATE RANGE PRESETS -->
                <div style="display: flex; gap: 6px; align-items: center;">
                    <i data-lucide="calendar" style="width:14px;height:14px;color:var(--muted);"></i>
                    <span class="tiny muted bold uppercase" style="margin-right:2px;">Due:</span>
                    <button class="btn tiny ${OL.globalTaskFilterState.dateRange === 'All' ? 'accent' : 'soft'}" onclick="OL.setGlobalTaskFilter('dateRange', 'All')">All</button>
                    <button class="btn tiny ${OL.globalTaskFilterState.dateRange === 'Overdue' ? 'accent' : 'soft'}" onclick="OL.setGlobalTaskFilter('dateRange', 'Overdue')">Overdue</button>
                    <button class="btn tiny ${OL.globalTaskFilterState.dateRange === 'Today' ? 'accent' : 'soft'}" onclick="OL.setGlobalTaskFilter('dateRange', 'Today')">Today</button>
                    <button class="btn tiny ${OL.globalTaskFilterState.dateRange === 'Week' ? 'accent' : 'soft'}" onclick="OL.setGlobalTaskFilter('dateRange', 'Week')">This Week</button>
                    <button class="btn tiny ${OL.globalTaskFilterState.dateRange === 'Month' ? 'accent' : 'soft'}" onclick="OL.setGlobalTaskFilter('dateRange', 'Month')">This Month</button>
                </div>

                <div style="display: flex; gap: 8px; align-items: center;">
                    <span class="tiny muted bold uppercase">Group By:</span>
                    <select class="modal-input tiny" style="width: auto;" onchange="OL.setGlobalTaskFilter('groupBy', this.value)">
                        <option value="client" ${OL.globalTaskFilterState.groupBy === 'client' ? 'selected' : ''}>Client Workspace</option>
                        <option value="status" ${OL.globalTaskFilterState.groupBy === 'status' ? 'selected' : ''}>Status</option>
                        <option value="assignee" ${OL.globalTaskFilterState.groupBy === 'assignee' ? 'selected' : ''}>Assignee / Member</option>
                    </select>
                </div>
            </div>

            <!-- TASK LIST CONTAINER -->
            <div id="global-task-table">
                ${OL.renderFilteredTaskGroups(masterTasks)}
            </div>
        </div>
    `;

    if (window.lucide) lucide.createIcons();
};

OL.setGlobalTaskFilter = function(key, val) {
    OL.globalTaskFilterState[key] = val;
    OL.renderBusinessTaskManager();
};

OL.renderFilteredTaskGroups = function(allTasks) {
    const { query, status, assignee, dateRange, groupBy } = OL.globalTaskFilterState;

    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);

    let filtered = allTasks.filter(t => {
        const titleMatch = (t.title || t.name || '').toLowerCase().includes(query.toLowerCase());
        const clientMatch = (t.clientName || '').toLowerCase().includes(query.toLowerCase());
        const statusMatch = status === 'All' || (t.status || 'Pending') === status;
        
        let assigneeMatch = true;
        if (assignee === 'Sphynx') assigneeMatch = t.assignee === 'Sphynx Task' || !t.isClientTask;
        if (assignee === 'Client') assigneeMatch = t.assignee !== 'Sphynx Task' || t.isClientTask;

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
                } else if (dateRange === 'Month') {
                    dateMatch = taskDate.getMonth() === now.getMonth() && taskDate.getFullYear() === now.getFullYear();
                }
            }
        }

        return (titleMatch || clientMatch) && statusMatch && assigneeMatch && dateMatch;
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
            
            <div style="display: grid; gap: 8px;">
                ${tasks.map(t => {
                    const teamOptions = OL.getClientTeamOptions(t.clientId);
                    const isClientAssigned = t.assignee !== 'Sphynx Task';
                    const isTimerRunning = OL.activeTaskTimer.taskId === t.id;
                    const isOverdue = t.dueDate && t.dueDate.slice(0,10) < todayStr && t.status !== 'Done';

                    return `
                    <div style="display:grid; grid-template-columns: 2fr 130px 140px 110px 240px; gap: 12px; padding: 10px 14px; background: ${isTimerRunning ? 'rgba(56, 189, 248, 0.08)' : 'rgba(255,255,255,0.02)'}; border: 1px solid ${isTimerRunning ? '#38bdf8' : 'var(--line)'}; border-radius: 6px; align-items:center; cursor:pointer;"
                         onclick="OL.handleTaskRowClick(event, '${t.clientId}', '${t.id}')">
                        
                        <!-- Task Title & Client Link -->
                        <div>
                            <div style="font-weight: 600;">${esc(t.title || t.name)}</div>
                            <div class="tiny muted" style="display:flex; gap: 8px; align-items:center; margin-top:2px;">
                                <!-- 🚀 CLICKING CLIENT NAME NAVIGATES DIRECTLY TO CLIENT WORKSPACE -->
                                <span class="client-link-badge" 
                                      style="cursor:pointer; text-decoration:underline; font-weight:bold; color:var(--accent);" 
                                      onclick="event.stopPropagation(); OL.navigateToClientProject('${t.clientId}')"
                                      title="Jump to ${esc(t.clientName)} Workspace">
                                    📁 ${esc(t.clientName)}
                                </span>
                                ${t.category ? `<span>• ${esc(t.category)}</span>` : ''}
                            </div>
                        </div>

                        <!-- Dynamic Team / Assignee Dropdown -->
                        <div onclick="event.stopPropagation();">
                            <select class="modal-input tiny" 
                                    style="width: 100%; border-color: ${isClientAssigned ? '#fbbf24' : 'var(--line)'};"
                                    onchange="OL.updateGlobalTaskAssignee('${t.clientId}', '${t.id}', this.value)">
                                <option value="Sphynx Task" ${t.assignee === 'Sphynx Task' ? 'selected' : ''}>⚡ Sphynx Task</option>
                                ${teamOptions.length > 0 ? `
                                    <optgroup label="Client Team">
                                        ${teamOptions.map(m => `
                                            <option value="${esc(m.name)}" ${t.assignee === m.name ? 'selected' : ''}>👤 ${esc(m.name)}</option>
                                        `).join('')}
                                    </optgroup>
                                ` : `
                                    <option value="Client Task" ${t.assignee === 'Client Task' || t.assignee === 'Client' ? 'selected' : ''}>👤 Client Task</option>
                                `}
                            </select>
                        </div>

                        <!-- Due Date Badge / Input -->
                        <div onclick="event.stopPropagation();" style="display:flex; align-items:center; gap:4px;">
                            <i data-lucide="calendar" style="width:12px;height:12px; color:${isOverdue ? '#ef4444' : 'var(--muted)'};"></i>
                            <input type="date" 
                                   class="modal-input tiny monospace" 
                                   value="${t.dueDate ? t.dueDate.slice(0,10) : ''}"
                                   style="width:100%; color:${isOverdue ? '#ef4444' : 'inherit'}; font-weight:${isOverdue ? 'bold' : 'normal'};"
                                   onchange="OL.updateGlobalTaskDueDate('${t.clientId}', '${t.id}', this.value)">
                        </div>

                        <!-- Editable Status Dropdown -->
                        <div onclick="event.stopPropagation();">
                            <select class="modal-input tiny" 
                                    style="width: 100%; font-weight: bold;" 
                                    onchange="OL.updateGlobalTaskStatus('${t.clientId}', '${t.id}', this.value)">
                                <option value="Pending" ${t.status === 'Pending' ? 'selected' : ''}>Pending</option>
                                <option value="In Progress" ${t.status === 'In Progress' ? 'selected' : ''}>In Progress</option>
                                <option value="Review" ${t.status === 'Review' ? 'selected' : ''}>Review</option>
                                <option value="Done" ${t.status === 'Done' ? 'selected' : ''}>Done</option>
                            </select>
                        </div>

                        <!-- ⏱️ COMPACT TIMER & LOG BUTTONS -->
                        <div onclick="event.stopPropagation();" style="display: flex; align-items: center; gap: 4px; justify-content: flex-end;">
                            <button class="btn tiny ${isTimerRunning ? 'danger' : 'primary'}" 
                                    id="timer-btn-${t.id}"
                                    title="${isTimerRunning ? 'Stop Timer' : 'Start Timer'}"
                                    style="font-weight: bold; width: 32px; height: 26px; padding:0; display:inline-flex; align-items:center; justify-content:center;" 
                                    onclick="OL.toggleLiveTaskTimer('${t.clientId}', '${t.id}')">
                                <i data-lucide="${isTimerRunning ? 'square' : 'timer'}" style="width:13px;height:13px;"></i>
                            </button>

                            <span id="timer-display-${t.id}" class="tiny monospace bold" style="min-width: 48px; text-align: right; color: ${isTimerRunning ? '#38bdf8' : 'var(--accent)'};">
                                ${isTimerRunning ? OL.formatSecondsDisplay(OL.activeTaskTimer.elapsedSeconds) : `${t.loggedHours.toFixed(1)}h`}
                            </span>

                            <button class="btn tiny soft" title="Add 0.5 hours" onclick="OL.logTaskHours('${t.clientId}', '${t.id}', 0.5)">+0.5</button>
                            <button class="btn tiny soft" title="Add 1.0 hour" onclick="OL.logTaskHours('${t.clientId}', '${t.id}', 1.0)">+1h</button>
                            <button class="btn tiny soft" title="Edit Retroactive Time Entry" onclick="OL.openEditTaskTimeModal('${t.clientId}', '${t.id}')">
                                <i data-lucide="pencil" style="width:11px;height:11px;"></i>
                            </button>
                        </div>
                    </div>
                    `;
                }).join('')}
            </div>
        </div>
        `;
    }).join('');
};

// 🚀 Navigate directly to client workspace
OL.navigateToClientProject = function(clientId) {
    if (typeof switchClient === 'function') {
        switchClient(clientId);
    } else if (typeof OL.switchClient === 'function') {
        OL.switchClient(clientId);
    } else {
        sessionStorage.setItem('lastActiveClientId', clientId);
        if (state) state.activeClientId = clientId;
        window.location.hash = '#/client-tasks';
    }
};

// Row click handler (Opens details unless an input/select/button/client-link was clicked)
OL.handleTaskRowClick = function(event, clientId, taskId) {
    const targetTag = event.target.tagName.toLowerCase();
    if (['select', 'input', 'button', 'option'].includes(targetTag) || event.target.closest('button') || event.target.closest('.client-link-badge')) {
        return;
    }
    OL.openTaskInContext(clientId, taskId);
};

// Update Due Date
OL.updateGlobalTaskDueDate = function(clientId, taskId, newDueDate) {
    updateAndSync(() => {
        const client = state.clients[clientId];
        if (!client || !client.projectData?.clientTasks) return;
        
        const task = client.projectData.clientTasks.find(t => t.id === taskId);
        if (task) {
            task.dueDate = newDueDate;
            console.log(`✅ Updated Task Due Date [${taskId}]: ${newDueDate}`);
        }
    });
};

// -------------------------------------------------------------
// 📊 RECONCILIATION & TIME REPORT MODAL
// -------------------------------------------------------------
OL.openTimeReportModal = function(selectedClientId) {
    const clients = Object.values(state.clients || {});
    const targetClientId = selectedClientId || (clients[0]?.id || '');
    
    const content = `
        <div style="padding: 20px; max-width: 900px; width: 100%;">
            <div class="modal-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 20px; border-bottom: 1px solid var(--line); padding-bottom: 12px;">
                <h3 style="margin:0; display:flex; align-items:center; gap:8px;">
                    <i data-lucide="bar-chart-2" style="width:20px;height:20px;color:var(--accent);"></i>
                    Time Reconciliation & Client Reports
                </h3>
                <button class="btn tiny soft" onclick="OL.closeTimeReportModal()" style="font-weight:bold;">✕</button>
            </div>

            <div style="display: flex; gap: 12px; align-items: center; margin-bottom: 20px;">
                <label class="bold tiny uppercase muted">Select Client:</label>
                <select class="modal-input tiny" style="width: 250px;" onchange="OL.openTimeReportModal(this.value)">
                    ${clients.map(c => `<option value="${c.id}" ${c.id === targetClientId ? 'selected' : ''}>${esc(c.meta?.name || c.id)}</option>`).join('')}
                </select>
                <button class="btn tiny primary" onclick="OL.exportClientTimeReportCSV('${targetClientId}')" style="display:inline-flex; align-items:center; gap:4px;">
                    <i data-lucide="download" style="width:12px;height:12px;"></i> Export CSV Report
                </button>
            </div>

            <div id="reconciliation-report-content">
                ${OL.renderClientReportView(targetClientId)}
            </div>
        </div>
    `;

    // Standardized modal launcher with overlay dismiss listener
    if (typeof window.openModal === 'function') {
        window.openModal(content);
        
        // Attach click-off dismiss listener to overlay
        const layer = document.getElementById("modal-layer") || document.getElementById("modal-overlay");
        if (layer) {
            layer.onclick = (e) => {
                if (e.target === layer) OL.closeTimeReportModal();
            };
        }
        if (window.lucide) lucide.createIcons();
    }
};

OL.closeTimeReportModal = function() {
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
    // Fallback to standard closeModal if defined
    if (typeof OL.closeModal === 'function' && OL.closeModal !== OL.closeTimeReportModal) {
        OL.closeModal();
    }
};

// -------------------------------------------------------------
// ✏️ RETROACTIVE TIME ENTRY EDIT MODAL
// -------------------------------------------------------------
OL.openEditTaskTimeModal = function(clientId, taskId) {
    const client = state.clients[clientId];
    const task = client?.projectData?.clientTasks?.find(t => t.id === taskId);
    if (!task) return;

    const currentHours = Number(task.loggedHours || task.hoursLogged || 0);

    const content = `
        <div class="modal-header">
            <h3><i data-lucide="pencil" style="width:18px;height:18px;vertical-align:sub;margin-right:6px;"></i>Retroactive Time Edit</h3>
            <button class="btn tiny soft" onclick="OL.closeModal()">✕</button>
        </div>
        <div class="modal-body" style="padding: 20px;">
            <div style="margin-bottom: 15px;">
                <strong>Task:</strong> ${esc(task.title || task.name)}
                <div class="tiny muted">Client: ${esc(client.meta?.name || clientId)}</div>
            </div>

            <form onsubmit="event.preventDefault(); OL.saveTaskTimeEdit('${clientId}', '${taskId}');">
                <div style="margin-bottom: 15px;">
                    <label class="bold tiny uppercase muted">Total Logged Hours:</label>
                    <input type="number" step="0.1" id="edit-task-hours" class="modal-input" value="${currentHours}" required style="margin-top:5px;">
                </div>

                <div style="margin-bottom: 15px;">
                    <label class="bold tiny uppercase muted">Audit Note / Adjustment Reason:</label>
                    <textarea id="edit-task-note" class="modal-input" placeholder="e.g. Corrected extra stopwatch time, manual Zoom meeting credit..." style="height: 70px; margin-top:5px;">${esc(task.timeAuditNote || '')}</textarea>
                </div>

                <div style="display:flex; justify-content:flex-end; gap: 10px;">
                    <button type="button" class="btn soft tiny" onclick="OL.closeModal()">Cancel</button>
                    <button type="submit" class="btn primary tiny">Save Adjustments</button>
                </div>
            </form>
        </div>
    `;

    if (typeof window.openModal === 'function') {
        window.openModal(content);
        if (window.lucide) lucide.createIcons();
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
        const client = state.clients[clientId];
        const task = client?.projectData?.clientTasks?.find(t => t.id === taskId);
        if (task) {
            task.loggedHours = hoursVal;
            task.hoursLogged = hoursVal;
            task.timeAuditNote = noteVal || '';
            console.log(`✅ Retroactive Time Adjustment Saved [${taskId}]: ${hoursVal}h`);
        }
    });

    if (typeof OL.closeModal === 'function') OL.closeModal();
    OL.renderBusinessTaskManager();
};

// CSV EXPORTER
OL.exportClientTimeReportCSV = function(clientId) {
    const client = state.clients[clientId];
    if (!client) return;

    const metrics = OL.getClientReconciliationMetrics(clientId);
    const tasks = client.projectData?.clientTasks || [];

    let csv = `Client Time & Scoping Reconciliation Report\n`;
    csv += `Client Name,${client.meta?.name || clientId}\n`;
    csv += `Report Date,${new Date().toLocaleDateString()}\n`;
    csv += `Base Hourly Rate,$${metrics.hourlyRate}/hr\n`;
    csv += `Total Scoped Hours,${metrics.scopedHours.toFixed(2)}h\n`;
    csv += `Total Logged Hours,${metrics.loggedHours.toFixed(2)}h\n`;
    csv += `Remaining Balance Hours,${metrics.remainingHours.toFixed(2)}h\n\n`;

    csv += `Task Title,Assignee,Status,Due Date,Logged Hours,Calculated Value ($),Audit Note\n`;

    tasks.forEach(t => {
        const hours = Number(t.loggedHours || t.hoursLogged || 0);
        const val = hours * metrics.hourlyRate;
        csv += `"${(t.title || t.name).replace(/"/g, '""')}","${t.assignee || 'Sphynx'}","${t.status || 'Pending'}","${t.dueDate || ''}",${hours.toFixed(2)},${val.toFixed(2)},"${(t.timeAuditNote || '').replace(/"/g, '""')}"\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `Time_Report_${(client.meta?.name || clientId).replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
};

// ⏱️ LIVE STOPWATCH CONTROLS
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
            isClientTask: (assignee !== 'Sphynx Task'),
            loggedHours: 0,
            createdAt: new Date().toISOString()
        };

        client.projectData.clientTasks.unshift(newTask);
        console.log(`✅ Quick Task Created for [${clientId}]:`, newTask);
    });

    const inputTitle = document.getElementById('quick-task-title');
    if (inputTitle) inputTitle.value = '';

    OL.renderBusinessTaskManager();
};

OL.updateGlobalTaskStatus = function(clientId, taskId, newStatus) {
    updateAndSync(() => {
        const client = state.clients[clientId];
        if (!client || !client.projectData?.clientTasks) return;
        
        const task = client.projectData.clientTasks.find(t => t.id === taskId);
        if (task) {
            task.status = newStatus;
            console.log(`✅ Updated Task Status [${taskId}]: ${newStatus}`);
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
            task.isClientTask = (newAssignee !== 'Sphynx Task');
            console.log(`✅ Updated Task Assignee [${taskId}]: ${newAssignee}`);
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
            console.log(`⏱️ Logged ${additionalHours}h on Task [${taskId}]. Total: ${task.loggedHours}h`);
        }
    });
    OL.renderBusinessTaskManager();
};

OL.openTaskInContext = async function(clientId, taskId) {
    await loadFullClient(clientId);
    
    if (typeof OL.openTaskModal === 'function') {
        OL.openTaskModal(taskId, false, clientId);
    } else if (typeof window.openTaskModal === 'function') {
        window.openTaskModal(taskId, false, clientId);
    } else {
        console.error("❌ openTaskModal renderer not found!");
    }
};

//=============FINANCIALS===============//

OL.renderBusinessFinancials = function() {
    const main = document.getElementById("mainContent");
    if (!main) return;

    const clients = Object.values(state.clients || {});
    let allScopedItems = clients.flatMap(c => {
        const sheet = c.projectData?.scopingSheets?.[0];
        return (sheet?.lineItems || []).map(li => ({
            ...li,
            clientName: c.meta.name,
            clientId: c.id
        }));
    });

    main.innerHTML = `
        <div class="section-header">
            <div>
                <h2>💰 Agency Financials & Scoped Work</h2>
                <div class="small muted">Track total gross, scoped deliverables, and approved revenue across all projects</div>
            </div>
        </div>

        <div class="card" style="padding: 20px;">
            <table class="matrix-table" style="width:100%;">
                <thead>
                    <tr>
                        <th style="text-align:left;">Client</th>
                        <th style="text-align:left;">Deliverable</th>
                        <th style="text-align:center;">Status</th>
                        <th style="text-align:center;">Party</th>
                        <th style="text-align:right;">Net Value</th>
                    </tr>
                </thead>
                <tbody>
                    ${allScopedItems.map(item => {
                        const res = OL.getResourceById(item.resourceId);
                        // 🎯 Calculate fee dynamically using your core pricing engine:
                        const netValue = res ? (OL.calculateRowFee(item, res) || 0) : 0;

                        return `
                            <tr>
                                <td><strong>${esc(item.clientName)}</strong></td>
                                <td>${esc(res?.name || item.name || 'Scoped Item')}</td>
                                <td style="text-align:center;"><span class="pill tiny soft">${esc(item.status || 'Do Now')}</span></td>
                                <td style="text-align:center;">${esc(item.responsibleParty || 'Sphynx')}</td>
                                <td style="text-align:right; font-weight:bold; color:var(--accent);">$${netValue.toLocaleString()}</td>
                            </tr>
                        `;
                    }).join('') || '<tr><td colspan="5" class="p-20 text-center muted">No scoped items found across projects.</td></tr>'}
                </tbody>
            </table>
        </div>
    `;
    if (window.lucide) lucide.createIcons();
};

//=============COMMUNICATIONS===============//

OL.renderBusinessCommunications = function() {
    const main = document.getElementById("mainContent");
    if (!main) return;
    main.innerHTML = `
        <div class="section-header">
            <div>
                <h2>✉️ Communications Center</h2>
                <div class="small muted">Connect Gmail API & Quo Webhook endpoints</div>
            </div>
        </div>
        <div class="card" style="padding: 30px; text-align: center;">
            <i data-lucide="mail" style="width: 48px; height: 48px; color: var(--accent); margin-bottom: 15px;"></i>
            <h3>API Integration Ready</h3>
            <p class="muted small" style="max-width: 400px; margin: 0 auto 20px auto;">
                Connect your OAuth tokens for Gmail or hook your Quo API credentials to manage all client threads from a single inbox.
            </p>
            <button class="btn primary">Configure API Keys</button>
        </div>
    `;
    if (window.lucide) lucide.createIcons();
};

//=============CALENDAR===============//

OL.renderBusinessCalendar = function() {
    const main = document.getElementById("mainContent");
    if (!main) return;
    main.innerHTML = `
        <div class="section-header">
            <div>
                <h2>📅 Unified Calendar</h2>
                <div class="small muted">Google Calendar API Synchronization</div>
            </div>
        </div>
        <div class="card" style="padding: 30px; text-align: center;">
            <i data-lucide="calendar" style="width: 48px; height: 48px; color: var(--accent); margin-bottom: 15px;"></i>
            <h3>Google Calendar Integration</h3>
            <p class="muted small" style="max-width: 400px; margin: 0 auto 20px auto;">
                Sync your Google Calendar to view milestone deadlines, client meetings, and scheduled releases.
            </p>
            <button class="btn primary">Connect Google Calendar</button>
        </div>
    `;
    if (window.lucide) lucide.createIcons();
};
