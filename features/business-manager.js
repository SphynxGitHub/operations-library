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

//============= GLOBAL TASK MANAGER ===============//

OL.globalTaskFilterState = {
    query: '',
    status: 'All',
    assignee: 'All',
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
                <h2><i data-lucide="check-square" style="width:24px;height:24px;vertical-align:sub;margin-right:8px;color:var(--accent);"></i>Cross-Project Task Manager</h2>
                <div class="small muted">Consolidated deliverables, team assignments, and live time tracking across all clients</div>
            </div>
            <div class="header-actions" style="display:flex; gap:10px; align-items:center;">
                <div class="pill tiny accent" style="font-weight: bold; display:flex; align-items:center; gap:6px;">
                    <i data-lucide="clock" style="width:14px;height:14px;"></i> Total Hours Logged: ${totalLoggedHours.toFixed(1)}h
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
            <form onsubmit="event.preventDefault(); OL.createGlobalQuickTask();" style="display: grid; grid-template-columns: 180px 2fr 160px 120px 110px; gap: 10px; align-items: center;">
                
                <!-- Client Select -->
                <select id="quick-task-client" class="modal-input tiny" required onchange="OL.updateQuickTaskTeamDropdown(this.value)">
                    <option value="" disabled selected>Select Client...</option>
                    ${clients.map(c => `<option value="${c.id}">${esc(c.meta?.name || c.id)}</option>`).join('')}
                </select>

                <!-- Task Title -->
                <input type="text" id="quick-task-title" class="modal-input tiny" placeholder="Task title or deliverable description..." required>

                <!-- Dynamic Assignee Dropdown -->
                <select id="quick-task-assignee" class="modal-input tiny">
                    <option value="Sphynx Task" selected>⚡ Sphynx Task</option>
                    <option value="Client Task">👤 Client Task</option>
                </select>

                <!-- Status -->
                <select id="quick-task-status" class="modal-input tiny">
                    <option value="Pending" selected>Pending</option>
                    <option value="In Progress">In Progress</option>
                    <option value="Review">Review</option>
                    <option value="Done">Done</option>
                </select>

                <!-- Submit Button -->
                <button type="submit" class="btn tiny primary" style="height: 100%; font-weight: bold; display:flex; align-items:center; justify-content:center; gap:4px;">
                    <i data-lucide="plus" style="width:14px;height:14px;"></i> Add Task
                </button>
            </form>
        </div>

        <div class="card" style="padding: 20px;">
            <!-- FILTER & GROUPING CONTROLS -->
            <div style="display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; margin-bottom: 20px; padding-bottom: 15px; border-bottom: 1px solid var(--line);">
                <div style="display: flex; gap: 8px; flex: 1; min-width: 260px; align-items:center;">
                    <i data-lucide="search" style="width:16px;height:16px;color:var(--muted);"></i>
                    <input type="text" 
                           class="modal-input tiny" 
                           placeholder="Search tasks, clients, or assignees..." 
                           value="${esc(OL.globalTaskFilterState.query)}"
                           oninput="OL.setGlobalTaskFilter('query', this.value)">
                </div>

                <div style="display: flex; gap: 8px; align-items: center;">
                    <span class="tiny muted bold uppercase">Assignee:</span>
                    <button class="btn tiny ${OL.globalTaskFilterState.assignee === 'All' ? 'accent' : 'soft'}" onclick="OL.setGlobalTaskFilter('assignee', 'All')">All</button>
                    <button class="btn tiny ${OL.globalTaskFilterState.assignee === 'Sphynx' ? 'accent' : 'soft'}" onclick="OL.setGlobalTaskFilter('assignee', 'Sphynx')">⚡ Sphynx</button>
                    <button class="btn tiny ${OL.globalTaskFilterState.assignee === 'Client' ? 'accent' : 'soft'}" onclick="OL.setGlobalTaskFilter('assignee', 'Client')">👤 Client / Team</button>
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

            <!-- STATUS QUICK FILTERS -->
            <div style="display: flex; gap: 8px; margin-bottom: 20px;">
                <button class="btn tiny ${OL.globalTaskFilterState.status === 'All' ? 'accent' : 'soft'}" onclick="OL.setGlobalTaskFilter('status', 'All')">All Statuses</button>
                <button class="btn tiny ${OL.globalTaskFilterState.status === 'Pending' ? 'accent' : 'soft'}" onclick="OL.setGlobalTaskFilter('status', 'Pending')">Pending</button>
                <button class="btn tiny ${OL.globalTaskFilterState.status === 'In Progress' ? 'accent' : 'soft'}" onclick="OL.setGlobalTaskFilter('status', 'In Progress')">In Progress</button>
                <button class="btn tiny ${OL.globalTaskFilterState.status === 'Review' ? 'accent' : 'soft'}" onclick="OL.setGlobalTaskFilter('status', 'Review')">Review</button>
                <button class="btn tiny ${OL.globalTaskFilterState.status === 'Done' ? 'accent' : 'soft'}" onclick="OL.setGlobalTaskFilter('status', 'Done')">Done</button>
            </div>

            <!-- TASK LIST CONTAINER -->
            <div id="global-task-table">
                ${OL.renderFilteredTaskGroups(masterTasks)}
            </div>
        </div>
    `;

    if (window.lucide) lucide.createIcons();
};

// Update Quick Task Assignee dropdown when client selection changes
OL.updateQuickTaskTeamDropdown = function(clientId) {
    const assigneeSelect = document.getElementById('quick-task-assignee');
    if (!assigneeSelect) return;

    const teamOptions = OL.getClientTeamOptions(clientId);
    
    let html = `<option value="Sphynx Task" selected>⚡ Sphynx Task</option>`;
    if (teamOptions.length > 0) {
        html += `<optgroup label="Client Team Members">`;
        teamOptions.forEach(m => {
            html += `<option value="${esc(m.name)}">👤 ${esc(m.name)}</option>`;
        });
        html += `</optgroup>`;
    } else {
        html += `<option value="Client Task">👤 Client Task</option>`;
    }

    assigneeSelect.innerHTML = html;
};

// Filter & Grouping Engine
OL.setGlobalTaskFilter = function(key, val) {
    OL.globalTaskFilterState[key] = val;
    OL.renderBusinessTaskManager();
};

OL.renderFilteredTaskGroups = function(allTasks) {
    const { query, status, assignee, groupBy } = OL.globalTaskFilterState;

    // Filter Pipeline
    let filtered = allTasks.filter(t => {
        const titleMatch = (t.title || t.name || '').toLowerCase().includes(query.toLowerCase());
        const clientMatch = (t.clientName || '').toLowerCase().includes(query.toLowerCase());
        const statusMatch = status === 'All' || (t.status || 'Pending') === status;
        
        let assigneeMatch = true;
        if (assignee === 'Sphynx') assigneeMatch = t.assignee === 'Sphynx Task' || !t.isClientTask;
        if (assignee === 'Client') assigneeMatch = t.assignee !== 'Sphynx Task' || t.isClientTask;

        return (titleMatch || clientMatch) && statusMatch && assigneeMatch;
    });

    if (filtered.length === 0) {
        return `<div class="p-20 muted text-center">No matching tasks found across projects.</div>`;
    }

    // Grouping Pipeline
    const groups = {};
    filtered.forEach(task => {
        let groupKey = 'Other';
        if (groupBy === 'client') groupKey = task.clientName;
        else if (groupBy === 'status') groupKey = task.status || 'Pending';
        else if (groupBy === 'assignee') groupKey = task.assignee || 'Sphynx Task';

        if (!groups[groupKey]) groups[groupKey] = [];
        groups[groupKey].push(task);
    });

    // Render HTML Output by Group
    return Object.entries(groups).map(([groupTitle, tasks]) => {
        const groupHours = tasks.reduce((sum, t) => sum + (t.loggedHours || 0), 0);

        return `
        <div style="margin-bottom: 24px;">
            <div style="font-weight: 800; font-size: 13px; letter-spacing: 0.05em; text-transform: uppercase; color: var(--accent); margin-bottom: 10px; display: flex; align-items: center; justify-content: space-between;">
                <div style="display:flex; align-items:center; gap:8px;">
                    <i data-lucide="folder" style="width:14px;height:14px;"></i>
                    <span>${esc(groupTitle)}</span>
                    <span class="pill tiny soft" style="font-size: 10px;">${tasks.length} tasks</span>
                </div>
                <div class="tiny muted monospace" style="font-weight: normal; display:flex; align-items:center; gap:4px;">
                    <i data-lucide="clock" style="width:12px;height:12px;"></i> Group Time: <strong style="color:var(--accent);">${groupHours.toFixed(1)}h</strong>
                </div>
            </div>
            
            <div style="display: grid; gap: 8px;">
                ${tasks.map(t => {
                    const teamOptions = OL.getClientTeamOptions(t.clientId);
                    const isClientAssigned = t.assignee !== 'Sphynx Task';
                    const isTimerRunning = OL.activeTaskTimer.taskId === t.id;

                    return `
                    <div style="display:grid; grid-template-columns: 2fr 160px 130px 240px 90px; gap: 12px; padding: 10px 14px; background: ${isTimerRunning ? 'rgba(56, 189, 248, 0.08)' : 'rgba(255,255,255,0.02)'}; border: 1px solid ${isTimerRunning ? '#38bdf8' : 'var(--line)'}; border-radius: 6px; align-items:center;">
                        
                        <!-- Task Title & Meta -->
                        <div>
                            <div style="font-weight: 600;">${esc(t.title || t.name)}</div>
                            <div class="tiny muted" style="display:flex; gap: 8px; align-items:center; margin-top:2px;">
                                <span>📁 ${esc(t.clientName)}</span>
                                ${t.category ? `<span>• ${esc(t.category)}</span>` : ''}
                            </div>
                        </div>

                        <!-- Dynamic Team / Assignee Dropdown -->
                        <div>
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

                        <!-- Editable Status Dropdown -->
                        <div>
                            <select class="modal-input tiny" 
                                    style="width: 100%; font-weight: bold;" 
                                    onchange="OL.updateGlobalTaskStatus('${t.clientId}', '${t.id}', this.value)">
                                <option value="Pending" ${t.status === 'Pending' ? 'selected' : ''}>Pending</option>
                                <option value="In Progress" ${t.status === 'In Progress' ? 'selected' : ''}>In Progress</option>
                                <option value="Review" ${t.status === 'Review' ? 'selected' : ''}>Review</option>
                                <option value="Done" ${t.status === 'Done' ? 'selected' : ''}>Done</option>
                            </select>
                        </div>

                        <!-- ⏱️ LIVE TIME TRACKING CONTROLS -->
                        <div style="display: flex; align-items: center; gap: 4px;">
                            <!-- Live Stopwatch Button -->
                            <button class="btn tiny ${isTimerRunning ? 'danger' : 'primary'}" 
                                    id="timer-btn-${t.id}"
                                    style="font-weight: bold; min-width: 80px; display:inline-flex; align-items:center; justify-content:center; gap:4px;" 
                                    onclick="OL.toggleLiveTaskTimer('${t.clientId}', '${t.id}')">
                                <i data-lucide="${isTimerRunning ? 'square' : 'play'}" style="width:11px;height:11px;"></i>
                                <span id="timer-display-${t.id}">${isTimerRunning ? OL.formatSecondsDisplay(OL.activeTaskTimer.elapsedSeconds) : 'Start'}</span>
                            </button>

                            <span class="tiny monospace bold" style="min-width: 42px; text-align: right; color: var(--accent); margin-right: 2px;">${t.loggedHours.toFixed(1)}h</span>
                            <button class="btn tiny soft" title="Add 0.5 hours" onclick="OL.logTaskHours('${t.clientId}', '${t.id}', 0.5)">+0.5</button>
                            <button class="btn tiny soft" title="Add 1.0 hour" onclick="OL.logTaskHours('${t.clientId}', '${t.id}', 1.0)">+1h</button>
                            <button class="btn tiny soft" title="Custom Hours" onclick="OL.promptCustomHours('${t.clientId}', '${t.id}', ${t.loggedHours})">
                                <i data-lucide="pencil" style="width:10px;height:10px;"></i>
                            </button>
                        </div>

                        <!-- In-Context Open Task Button -->
                        <div style="text-align: right;">
                            <button class="btn tiny primary" 
                                    style="display:inline-flex; align-items:center; gap:4px;"
                                    onclick="OL.openTaskInContext('${t.clientId}', '${t.id}')">
                                <i data-lucide="search" style="width:12px;height:12px;"></i> Details
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

// ⏱️ LIVE STOPWATCH ENGINE
OL.toggleLiveTaskTimer = function(clientId, taskId) {
    const timer = OL.activeTaskTimer;

    // If clicking on an active running timer -> STOP IT
    if (timer.taskId === taskId) {
        OL.stopLiveTaskTimer();
        return;
    }

    // If another timer is running elsewhere -> Stop that one first
    if (timer.taskId) {
        OL.stopLiveTaskTimer();
    }

    // Start New Timer
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

    // Re-render to update UI button states
    OL.renderBusinessTaskManager();
};

OL.stopLiveTaskTimer = function() {
    const timer = OL.activeTaskTimer;
    if (!timer.taskId) return;

    clearInterval(timer.intervalId);

    // Convert elapsed seconds to hours (rounded to 2 decimal places)
    const hoursEarned = Number((timer.elapsedSeconds / 3600).toFixed(2));

    if (hoursEarned > 0) {
        OL.logTaskHours(timer.clientId, timer.taskId, hoursEarned);
    }

    // Reset Timer State
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

// ⚡ Quick Creation Handler
OL.createGlobalQuickTask = function() {
    const clientId = document.getElementById('quick-task-client')?.value;
    const title = document.getElementById('quick-task-title')?.value;
    const assignee = document.getElementById('quick-task-assignee')?.value || 'Sphynx Task';
    const status = document.getElementById('quick-task-status')?.value || 'Pending';

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

// Live Update Handlers
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

// ⏱️ Time-Tracking Handlers
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

OL.promptCustomHours = function(clientId, taskId, currentHours) {
    const input = prompt("Set total hours logged for this task:", currentHours);
    if (input === null) return;
    const newTotal = parseFloat(input);
    if (isNaN(newTotal) || newTotal < 0) {
        alert("Please enter a valid number of hours.");
        return;
    }

    updateAndSync(() => {
        const client = state.clients[clientId];
        if (!client || !client.projectData?.clientTasks) return;
        
        const task = client.projectData.clientTasks.find(t => t.id === taskId);
        if (task) {
            task.loggedHours = newTotal;
            task.hoursLogged = newTotal;
            console.log(`⏱️ Set total hours on Task [${taskId}] to: ${newTotal}h`);
        }
    });
    OL.renderBusinessTaskManager();
};

// In-Context Modal Launcher
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

// -------------------------------------------------------------
// 📊 RECONCILIATION & TIME REPORT MODAL
// -------------------------------------------------------------
OL.openTimeReportModal = function(selectedClientId) {
    const clients = Object.values(state.clients || {});
    const targetClientId = selectedClientId || (clients[0]?.id || '');
    
    const content = `
        <div class="modal-header">
            <h3>📊 Time Reconciliation & Client Reports</h3>
            <button class="btn tiny soft" onclick="OL.closeModal()">✕</button>
        </div>
        <div class="modal-body" style="padding: 20px;">
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

    if (typeof window.openModal === 'function') {
        window.openModal(content);
        if (window.lucide) lucide.createIcons();
    }
};

OL.renderClientReportView = function(clientId) {
    const client = state.clients[clientId];
    if (!client) return `<div class="muted">No client selected.</div>`;

    const metrics = OL.getClientReconciliationMetrics(clientId);
    const tasks = client.projectData?.clientTasks || [];

    return `
        <!-- METRICS SUMMARY CARDS -->
        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 25px;">
            <div class="card" style="padding: 12px; text-align: center;">
                <div class="tiny muted uppercase bold">Paid Scoped Hours</div>
                <div style="font-size: 20px; font-weight: 900; color: #38bdf8; margin-top: 4px;">${metrics.scopedHours.toFixed(1)}h</div>
                <div class="tiny muted">$${metrics.scopedValue.toLocaleString()} Gross</div>
            </div>
            <div class="card" style="padding: 12px; text-align: center;">
                <div class="tiny muted uppercase bold">Logged Hours Used</div>
                <div style="font-size: 20px; font-weight: 900; color: var(--accent); margin-top: 4px;">${metrics.loggedHours.toFixed(1)}h</div>
                <div class="tiny muted">$${metrics.usedValue.toLocaleString()} Value</div>
            </div>
            <div class="card" style="padding: 12px; text-align: center;">
                <div class="tiny muted uppercase bold">Remaining Hours</div>
                <div style="font-size: 20px; font-weight: 900; color: ${metrics.remainingHours < 0 ? '#ef4444' : '#22c55e'}; margin-top: 4px;">${metrics.remainingHours.toFixed(1)}h</div>
                <div class="tiny muted">$${metrics.remainingValue.toLocaleString()} Balance</div>
            </div>
            <div class="card" style="padding: 12px; text-align: center;">
                <div class="tiny muted uppercase bold">Scoping Burn Rate</div>
                <div style="font-size: 20px; font-weight: 900; color: ${metrics.burnRate > 100 ? '#ef4444' : 'var(--accent)'}; margin-top: 4px;">${metrics.burnRate}%</div>
                <div class="tiny muted">${metrics.burnRate > 100 ? 'Over Scoped' : 'On Track'}</div>
            </div>
        </div>

        <!-- BREAKDOWN TABLE -->
        <h4>📋 Task Itemization & Time Audit</h4>
        <table class="matrix-table" style="width:100%; margin-top: 10px;">
            <thead>
                <tr>
                    <th style="text-align:left;">Deliverable / Task</th>
                    <th style="text-align:center;">Assignee</th>
                    <th style="text-align:center;">Status</th>
                    <th style="text-align:right;">Logged Hours</th>
                    <th style="text-align:right;">Calculated Value ($)</th>
                    <th style="text-align:center;">Action</th>
                </tr>
            </thead>
            <tbody>
                ${tasks.map(t => {
                    const hours = Number(t.loggedHours || t.hoursLogged || 0);
                    const val = hours * metrics.hourlyRate;
                    return `
                        <tr>
                            <td><strong>${esc(t.title || t.name)}</strong></td>
                            <td style="text-align:center;"><span class="pill tiny soft">${esc(t.assignee || 'Sphynx')}</span></td>
                            <td style="text-align:center;"><span class="pill tiny accent">${esc(t.status || 'Pending')}</span></td>
                            <td style="text-align:right; font-weight:bold;">${hours.toFixed(2)}h</td>
                            <td style="text-align:right; font-weight:bold; color:var(--accent);">$${val.toLocaleString()}</td>
                            <td style="text-align:center;">
                                <button class="btn tiny soft" onclick="OL.openEditTaskTimeModal('${clientId}', '${t.id}')">✏️ Edit Log</button>
                            </td>
                        </tr>
                    `;
                }).join('') || '<tr><td colspan="6" class="muted text-center p-20">No tasks or time entries logged for this client yet.</td></tr>'}
            </tbody>
        </table>
    `;
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
            <h3>✏️ Retroactive Time Edit</h3>
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

// -------------------------------------------------------------
// 📄 CSV REPORT EXPORTER
// -------------------------------------------------------------
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

    csv += `Task Title,Assignee,Status,Logged Hours,Calculated Value ($),Audit Note\n`;

    tasks.forEach(t => {
        const hours = Number(t.loggedHours || t.hoursLogged || 0);
        const val = hours * metrics.hourlyRate;
        csv += `"${(t.title || t.name).replace(/"/g, '""')}","${t.assignee || 'Sphynx'}","${t.status || 'Pending'}",${hours.toFixed(2)},${val.toFixed(2)},"${(t.timeAuditNote || '').replace(/"/g, '""')}"\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `Time_Report_${(client.meta?.name || clientId).replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
};

// -------------------------------------------------------------
// ⏱️ LIVE STOPWATCH & TASK CONTROLS
// -------------------------------------------------------------
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
