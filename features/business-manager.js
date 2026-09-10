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

OL.renderBusinessTaskManager = function() {
    const main = document.getElementById("mainContent");
    if (!main) return;

    const clients = Object.values(state.clients || {});
    
    // Aggregate tasks from all clients
    let masterTasks = clients.flatMap(c => 
        (c.projectData?.clientTasks || []).map(t => ({
            ...t,
            clientName: c.meta?.name || 'Unknown Client',
            clientId: c.id,
            assignee: t.assignee || t.responsibleParty || (t.isClientTask ? 'Client' : 'Sphynx')
        }))
    );

    main.innerHTML = `
        <div class="section-header">
            <div>
                <h2>📋 Cross-Project Task Manager</h2>
                <div class="small muted">Consolidated view of deliverables across all client workspaces</div>
            </div>
            <div class="header-actions">
                <button class="btn small soft" onclick="OL.renderBusinessTaskManager()">🔄 Refresh</button>
            </div>
        </div>

        <div class="card" style="padding: 20px;">
            <!-- FILTER & GROUPING CONTROLS -->
            <div style="display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; margin-bottom: 20px; padding-bottom: 15px; border-bottom: 1px solid var(--line);">
                <div style="display: flex; gap: 8px; flex: 1; min-width: 260px;">
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
                    <button class="btn tiny ${OL.globalTaskFilterState.assignee === 'Client' ? 'accent' : 'soft'}" onclick="OL.setGlobalTaskFilter('assignee', 'Client')">👤 Client</button>
                </div>

                <div style="display: flex; gap: 8px; align-items: center;">
                    <span class="tiny muted bold uppercase">Group By:</span>
                    <select class="modal-input tiny" style="width: auto;" onchange="OL.setGlobalTaskFilter('groupBy', this.value)">
                        <option value="client" ${OL.globalTaskFilterState.groupBy === 'client' ? 'selected' : ''}>Client Workspace</option>
                        <option value="status" ${OL.globalTaskFilterState.groupBy === 'status' ? 'selected' : ''}>Status</option>
                        <option value="assignee" ${OL.globalTaskFilterState.groupBy === 'assignee' ? 'selected' : ''}>Assignee (Party)</option>
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

// Filter & Grouping Engine
OL.setGlobalTaskFilter = function(key, val) {
    OL.globalTaskFilterState[key] = val;
    OL.renderBusinessTaskManager();
};

OL.renderFilteredTaskGroups = function(allTasks) {
    const { query, status, assignee, groupBy } = OL.globalTaskFilterState;

    // Apply Filter Pipeline
    let filtered = allTasks.filter(t => {
        const titleMatch = (t.title || t.name || '').toLowerCase().includes(query.toLowerCase());
        const clientMatch = (t.clientName || '').toLowerCase().includes(query.toLowerCase());
        const statusMatch = status === 'All' || (t.status || 'Pending') === status;
        
        let assigneeMatch = true;
        if (assignee === 'Sphynx') assigneeMatch = t.assignee === 'Sphynx' || !t.isClientTask;
        if (assignee === 'Client') assigneeMatch = t.assignee === 'Client' || t.isClientTask;

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
        else if (groupBy === 'assignee') groupKey = task.assignee || 'Sphynx';

        if (!groups[groupKey]) groups[groupKey] = [];
        groups[groupKey].push(task);
    });

    // Render HTML Output by Group
    return Object.entries(groups).map(([groupTitle, tasks]) => `
        <div style="margin-bottom: 24px;">
            <div style="font-weight: 800; font-size: 13px; letter-spacing: 0.05em; text-transform: uppercase; color: var(--accent); margin-bottom: 10px; display: flex; align-items: center; gap: 8px;">
                <span>${esc(groupTitle)}</span>
                <span class="pill tiny soft" style="font-size: 10px;">${tasks.length}</span>
            </div>
            
            <div style="display: grid; gap: 8px;">
                ${tasks.map(t => `
                    <div style="display:grid; grid-template-columns: 2fr 140px 130px 110px 110px; gap: 12px; padding: 10px 14px; background: rgba(255,255,255,0.02); border: 1px solid var(--line); border-radius: 6px; align-items:center;">
                        
                        <!-- Task Title & Meta -->
                        <div>
                            <div style="font-weight: 600;">${esc(t.title || t.name)}</div>
                            <div class="tiny muted" style="display:flex; gap: 8px; align-items:center; margin-top:2px;">
                                <span>📁 ${esc(t.clientName)}</span>
                                ${t.category ? `<span>• ${esc(t.category)}</span>` : ''}
                            </div>
                        </div>

                        <!-- Assignee / Task Type Selector -->
                        <div>
                            <select class="modal-input tiny" 
                                    style="width: 100%; border-color: ${t.assignee === 'Client' ? '#fbbf24' : 'var(--line)'};"
                                    onchange="OL.updateGlobalTaskAssignee('${t.clientId}', '${t.id}', this.value)">
                                <option value="Sphynx" ${t.assignee === 'Sphynx' ? 'selected' : ''}>⚡ Sphynx</option>
                                <option value="Client" ${t.assignee === 'Client' ? 'selected' : ''}>👤 Client Task</option>
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

                        <!-- Due Date -->
                        <div class="tiny monospace muted" style="text-align: center;">
                            ${t.dueDate ? new Date(t.dueDate).toLocaleDateString() : '—'}
                        </div>

                        <!-- In-Context Open Task Button -->
                        <div style="text-align: right;">
                            <button class="btn tiny primary" 
                                    onclick="OL.openTaskInContext('${t.clientId}', '${t.id}')">
                                🔍 Details
                            </button>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `).join('');
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
            task.isClientTask = (newAssignee === 'Client');
            console.log(`✅ Updated Task Assignee [${taskId}]: ${newAssignee}`);
        }
    });
};

// In-Context Modal Launcher (Does NOT switch client context/route)
OL.openTaskInContext = async function(clientId, taskId) {
    // 1. Ensure full client project data is in memory
    await loadFullClient(clientId);
    
    // 2. Open task modal directly without changing URL hash or triggering full layout rebuild
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
