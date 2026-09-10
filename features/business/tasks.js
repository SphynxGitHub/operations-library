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
                        
                        <!-- Task Title & Client Tag Badge (No Underline) -->
                        <div>
                            <div style="font-weight: 600;">${esc(t.title || t.name)}</div>
                            <div class="tiny muted" style="display:flex; gap: 8px; align-items:center; margin-top:4px;">
                                <span class="pill tiny soft" 
                                      style="cursor:pointer; text-decoration:none; font-weight:600; padding: 2px 8px; border-radius: 4px; display:inline-flex; align-items:center; gap:4px; font-size:10px;" 
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

OL.handleTaskRowClick = function(event, clientId, taskId) {
    const targetTag = event.target.tagName.toLowerCase();
    if (['select', 'input', 'button', 'option'].includes(targetTag) || event.target.closest('button') || event.target.closest('.pill')) {
        return;
    }
    OL.openTaskInContext(clientId, taskId);
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
