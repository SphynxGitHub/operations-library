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

// ================= ⚙️ CUSTOM STATUS MANAGER ================= //
OL.getSystemStatuses = fuction () {
    return state.master? taskStatues || [
        { id: "st-1", name: "Pending Sphynx Action", color: "#64c6a2", isClosed: false, order: 1 },
        { id: "st-2", name: "Pending Client Feedback", color: "#0880ea", isClosed: false, order: 2 },
        { id: "st-3", name: "Pending Client Document", color: "#4a55e6", isClosed: false, order: 3 },
        { id: "st-4", name: "Pending Client Review", color: "#b83dba", isClosed: false, order: 4 },
        { id: "st-5", name: "Pending Developer Update", color: "#9e832c", isClosed: false, order: 5 },
        { id: "st-6", name: "Pending Third Party Support", color: "#ffca18", isClosed: false, order: 6 },
        { id: "st-7", name: "Needs Follow Up", color: "#ff7f27", isClosed: false, order: 7 },
        { id: "st-8", name: "Client Task", color: "#cb1d63", isClosed: false, order: 8 },
        { id: "st-9", name: "Done", color: "#299764", isClosed: true, order: 9}
    ];
}

OL.openStatusManagerModal = function() {
    if (!state.master) state.master = {};
    if (!state.master.taskStatuses) {
        state.master.taskStatuses = [
            { id: "st-1", name: "Pending Sphynx Action", color: "#64c6a2", isClosed: false, order: 1 },
            { id: "st-2", name: "Pending Client Feedback", color: "#0880ea", isClosed: false, order: 2 },
            { id: "st-3", name: "Pending Client Document", color: "#4a55e6", isClosed: false, order: 3 },
            { id: "st-4", name: "Pending Client Review", color: "#b83dba", isClosed: false, order: 4 },
            { id: "st-5", name: "Pending Developer Update", color: "#9e832c", isClosed: false, order: 5 },
            { id: "st-6", name: "Pending Third Party Support", color: "#ffca18", isClosed: false, order: 6 },
            { id: "st-7", name: "Needs Follow Up", color: "#ff7f27", isClosed: false, order: 7 },
            { id: "st-8", name: "Client Task", color: "#cb1d63", isClosed: false, order: 8 },
            { id: "st-9", name: "Done", color: "#299764", isClosed: true, order: 9}
        ];
    }

    const statuses = state.master.taskStatuses.sort((a,b) => a.order - b.order);

    const content = `
        <div style="padding: 24px; max-width: 600px; width: 100%;" onclick="event.stopPropagation()">
            <div class="modal-header" style="display:flex; justify-content:space-between; align-items:center; border-bottom: 1px solid var(--line); padding-bottom: 12px; margin-bottom: 20px;">
                <h3 style="margin:0; display:flex; align-items:center; gap:8px;">
                    <i data-lucide="settings-2" style="width:20px;height:20px;color:var(--accent);"></i>
                    Global Task Status Pipeline Manager
                </h3>
                <button class="btn tiny soft" onclick="OL.closeModal()" style="font-weight:bold;">✕</button>
            </div>

            <div class="modal-body">
                <div class="tiny muted" style="margin-bottom: 15px;">
                    Define color-coded status pipelines used across the Global Task Manager and client workspaces.
                </div>

                <!-- Existing Statuses List -->
                <div id="status-items-list" style="display:grid; gap:10px; margin-bottom: 20px;">
                    ${statuses.map(st => `
                        <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; padding:8px 12px; background:rgba(255,255,255,0.02); border:1px solid var(--line); border-radius:6px;">
                            <div style="display:flex; align-items:center; gap:10px;">
                                <input type="color" value="${st.color}" style="width:24px; height:24px; border:none; background:none; cursor:pointer;" onchange="OL.updateStatusColor('${st.id}', this.value)">
                                <strong>${esc(st.name)}</strong>
                                <span class="pill tiny ${st.isClosed ? 'accent' : 'soft'}" style="font-size:10px;">
                                    ${st.isClosed ? 'Closed State (Done)' : 'Open State'}
                                </span>
                            </div>

                            <div style="display:flex; align-items:center; gap:6px;">
                                <button class="btn tiny soft" onclick="OL.toggleStatusClosedType('${st.id}')" title="Toggle Open/Closed State">
                                    <i data-lucide="${st.isClosed ? 'check-circle' : 'circle'}" style="width:12px;height:12px;"></i>
                                </button>
                                <button class="btn tiny soft danger" onclick="OL.deleteCustomStatus('${st.id}')" title="Delete Status">
                                    <i data-lucide="trash-2" style="width:12px;height:12px;"></i>
                                </button>
                            </div>
                        </div>
                    `).join('')}
                </div>

                <!-- Add New Status Form -->
                <form onsubmit="event.preventDefault(); OL.createNewCustomStatus();" style="display:grid; grid-template-columns: 36px 1fr 120px 100px; gap:8px; align-items:center; padding-top:15px; border-top:1px solid var(--line);">
                    <input type="color" id="new-status-color" value="#38bdf8" style="width:32px; height:32px; border:none; background:none; cursor:pointer;">
                    <input type="text" id="new-status-name" class="modal-input tiny" placeholder="New status name..." required>
                    <select id="new-status-type" class="modal-input tiny">
                        <option value="false">Open State</option>
                        <option value="true">Closed State</option>
                    </select>
                    <button type="submit" class="btn tiny primary" style="font-weight:bold; height:100%;">
                        <i data-lucide="plus" style="width:12px;height:12px;"></i> Add
                    </button>
                </form>
            </div>
        </div>
    `;

    OL.showOverlayModal(content);
};

OL.openEditTaskStatusQuickMenu = function(event, clientId, taskId) {
    event.stopPropagation();
    event.preventDefault();

    const client = state.clients?.[clientId];
    const task = client?.projectData?.clientTasks?.find(t => t.id === taskId || t.key === taskId);
    if (!task) return;

    const statuses = OL.getSystemStatuses();

    const content = `
        <div style="padding: 16px; max-width: 360px; width: 100%;" onclick="event.stopPropagation()">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid var(--line);">
                <span class="tiny bold uppercase muted">Update Status</span>
                <button class="btn tiny soft" onclick="OL.closeModal()">✕</button>
            </div>
            <div style="display:grid; gap:8px;">
                ${statuses.map(s => `
                    <button class="btn tiny soft" 
                            style="display:flex; align-items:center; justify-content:space-between; padding:8px 12px; width:100%; ${task.status === s.name ? 'border:1px solid var(--accent); background:rgba(var(--accent-rgb),0.1);' : ''}"
                            onclick="OL.updateGlobalTaskStatus('${clientId}', '${taskId}', '${esc(s.name)}'); OL.closeModal();">
                        <div style="display:flex; align-items:center; gap:8px;">
                            <span style="width:10px; height:10px; border-radius:50%; background:${s.color};"></span>
                            <strong>${esc(s.name)}</strong>
                        </div>
                        ${task.status === s.name ? '<i data-lucide="check" style="width:12px;height:12px;color:var(--accent);"></i>' : ''}
                    </button>
                `).join('')}
            </div>
            <div style="margin-top:12px; padding-top:8px; border-top:1px solid var(--line); text-align:center;">
                <button class="btn tiny soft" style="font-size:10px;" onclick="OL.closeModal(); OL.openStatusManagerModal();">
                    ⚙️ Manage Status Pipeline
                </button>
            </div>
        </div>
    `;

    OL.showOverlayModal(content);
};

// ⚙️ Status Pipeline Settings Modal (Master Tasks / Vault / Business Manager)
OL.openStatusManagerModal = function() {
    if (!state.master) state.master = {};
    if (!state.master.taskStatuses) {
        state.master.taskStatuses = OL.getSystemStatuses();
    }

    const statuses = state.master.taskStatuses;

    const content = `
        <div style="padding: 24px; max-width: 550px; width: 100%;" onclick="event.stopPropagation()">
            <div class="modal-header" style="display:flex; justify-content:space-between; align-items:center; border-bottom: 1px solid var(--line); padding-bottom: 12px; margin-bottom: 16px;">
                <h3 style="margin:0; display:flex; align-items:center; gap:8px;">
                    <i data-lucide="settings-2" style="width:20px;height:20px;color:var(--accent);"></i>
                    Task Status Pipeline Manager
                </h3>
                <button class="btn tiny soft" onclick="OL.closeModal()" style="font-weight:bold;">✕</button>
            </div>

            <div class="modal-body">
                <div class="tiny muted" style="margin-bottom: 15px;">
                    Configure global status names, color dot badges, and completion states across all workspaces.
                </div>

                <div style="display:grid; gap:8px; margin-bottom: 20px;">
                    ${statuses.map(st => `
                        <div style="display:flex; align-items:center; justify-content:space-between; padding:8px 12px; background:rgba(255,255,255,0.02); border:1px solid var(--line); border-radius:6px;">
                            <div style="display:flex; align-items:center; gap:10px;">
                                <input type="color" value="${st.color}" style="width:22px; height:22px; border:none; background:none; cursor:pointer;" onchange="OL.updateStatusColor('${st.id}', this.value)">
                                <strong style="font-size:13px;">${esc(st.name)}</strong>
                                <span class="pill tiny ${st.isClosed ? 'accent' : 'soft'}" style="font-size:9px;">
                                    ${st.isClosed ? 'Closed State' : 'Open State'}
                                </span>
                            </div>

                            <div style="display:flex; align-items:center; gap:6px;">
                                <button class="btn tiny soft" onclick="OL.toggleStatusClosedType('${st.id}')" title="Toggle Open/Closed State">
                                    <i data-lucide="${st.isClosed ? 'check-circle' : 'circle'}" style="width:12px;height:12px;"></i>
                                </button>
                                <button class="btn tiny soft danger" onclick="OL.deleteCustomStatus('${st.id}')" title="Delete Status">
                                    <i data-lucide="trash-2" style="width:12px;height:12px;"></i>
                                </button>
                            </div>
                        </div>
                    `).join('')}
                </div>

                <form onsubmit="event.preventDefault(); OL.createNewCustomStatus();" style="display:grid; grid-template-columns: 36px 1fr 110px 80px; gap:8px; align-items:center; padding-top:15px; border-top:1px solid var(--line);">
                    <input type="color" id="new-status-color" value="#38bdf8" style="width:30px; height:30px; border:none; background:none; cursor:pointer;">
                    <input type="text" id="new-status-name" class="modal-input tiny" placeholder="Status name..." required>
                    <select id="new-status-type" class="modal-input tiny">
                        <option value="false">Open</option>
                        <option value="true">Closed</option>
                    </select>
                    <button type="submit" class="btn tiny primary" style="font-weight:bold; height:100%;">+ Add</button>
                </form>
            </div>
        </div>
    `;

    OL.showOverlayModal(content);
};

// Data Mutation Handlers
OL.createNewCustomStatus = function() {
    const name = document.getElementById('new-status-name')?.value;
    const color = document.getElementById('new-status-color')?.value || '#38bdf8';
    const isClosed = document.getElementById('new-status-type')?.value === 'true';

    if (!name) return;

    updateAndSync(() => {
        if (!state.master) state.master = {};
        if (!state.master.taskStatuses) state.master.taskStatuses = OL.getSystemStatuses();
        
        state.master.taskStatuses.push({
            id: uid(),
            name: name,
            color: color,
            isClosed: isClosed,
            order: state.master.taskStatuses.length + 1
        });
    });

    OL.openStatusManagerModal();
    OL.renderBusinessTaskManager();
};

OL.updateStatusColor = function(statusId, newColor) {
    updateAndSync(() => {
        const st = state.master.taskStatuses?.find(s => s.id === statusId);
        if (st) st.color = newColor;
    });
    OL.renderBusinessTaskManager();
};

OL.toggleStatusClosedType = function(statusId) {
    updateAndSync(() => {
        const st = state.master.taskStatuses?.find(s => s.id === statusId);
        if (st) st.isClosed = !st.isClosed;
    });
    OL.openStatusManagerModal();
    OL.renderBusinessTaskManager();
};

OL.deleteCustomStatus = function(statusId) {
    if (!confirm("Are you sure you want to remove this status option?")) return;

    updateAndSync(() => {
        state.master.taskStatuses = state.master.taskStatuses.filter(s => s.id !== statusId);
    });
    OL.openStatusManagerModal();
    OL.renderBusinessTaskManager();
};

// Data Mutation Handlers
OL.createNewCustomStatus = function() {
    const name = document.getElementById('new-status-name')?.value;
    const color = document.getElementById('new-status-color')?.value || '#38bdf8';
    const isClosed = document.getElementById('new-status-type')?.value === 'true';

    if (!name) return;

    updateAndSync(() => {
        const newSt = {
            id: uid(),
            name: name,
            color: color,
            isClosed: isClosed,
            order: (state.master.taskStatuses.length || 0) + 1
        };
        state.master.taskStatuses.push(newSt);
    });

    OL.openStatusManagerModal();
    OL.renderBusinessTaskManager();
};

OL.updateStatusColor = function(statusId, newColor) {
    updateAndSync(() => {
        const st = state.master.taskStatuses.find(s => s.id === statusId);
        if (st) st.color = newColor;
    });
    OL.renderBusinessTaskManager();
};

OL.toggleStatusClosedType = function(statusId) {
    updateAndSync(() => {
        const st = state.master.taskStatuses.find(s => s.id === statusId);
        if (st) st.isClosed = !st.isClosed;
    });
    OL.openStatusManagerModal();
    OL.renderBusinessTaskManager();
};

OL.deleteCustomStatus = function(statusId) {
    if (!confirm("Are you sure you want to delete this status?")) return;

    updateAndSync(() => {
        state.master.taskStatuses = state.master.taskStatuses.filter(s => s.id !== statusId);
    });
    OL.openStatusManagerModal();
    OL.renderBusinessTaskManager();
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
                        <option value="Pending" ${OL.globalTaskFilterState.status === 'Pending' ? 'selected' : ''}>Pending</option>
                        <option value="Open" ${OL.globalTaskFilterState.status === 'Open' ? 'selected' : ''}>Open</option>
                        <option value="In Progress" ${OL.globalTaskFilterState.status === 'In Progress' ? 'selected' : ''}>In Progress</option>
                        <option value="Review" ${OL.globalTaskFilterState.status === 'Review' ? 'selected' : ''}>Review Only</option>
                        <option value="Closed" ${OL.globalTaskFilterState.status === 'Closed' ? 'selected' : ''}>Closed</option>
                        <option value="All" ${OL.globalTaskFilterState.status === 'All' ? 'selected' : ''}>All Statuses</option>                
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
    const isClientAssigned = t.assignee !== 'Sphynx Task' && !(OL.thirdPartyAssignees || []).includes(t.assignee);
    const is3rdParty = (OL.thirdPartyAssignees || []).includes(t.assignee);
    const isTimerRunning = OL.activeTaskTimer.taskId === t.id;
    const isOverdue = t.dueDate && t.dueDate.slice(0,10) < todayStr && t.status !== 'Done';

    // ClickUp Status Color Mapping
    const statusColors = {
        'Pending': '#94a3b8',
        'In Progress': '#38bdf8',
        'Review': '#fbbf24',
        'Done': '#22c55e'
    };
    const dotColor = statusColors[t.status] || '#94a3b8';

    // Assignee Avatar Icon Configuration (Pure Lucide Icons)
    let avatarBg = 'rgba(56, 189, 248, 0.15)';
    let avatarIcon = 'zap';
    let avatarColor = '#38bdf8';

    if (is3rdParty) {
        avatarBg = 'rgba(168, 85, 247, 0.15)';
        avatarIcon = 'wrench';
        avatarColor = '#a855f7';
    } else if (isClientAssigned) {
        avatarBg = 'rgba(236, 72, 153, 0.15)';
        avatarIcon = 'user';
        avatarColor = '#ec4899';
    }

    return `
    <div class="task-row-card" 
         style="display:grid; grid-template-columns: 24px 2fr 160px 150px 120px 210px 32px; gap: 12px; padding: 8px 12px; background: ${isTimerRunning ? 'rgba(56, 189, 248, 0.08)' : 'rgba(255,255,255,0.01)'}; border-bottom: 1px solid var(--line); border-radius: 4px; align-items:center; cursor:pointer;"
         onclick="OL.handleTaskRowClick(event, '${t.clientId}', '${t.id}')">
        
        <!-- 1. Color-Coded ClickUp Status Dot -->
        <div onclick="event.stopPropagation();" style="display:flex; justify-content:center;">
            <span title="Status: ${esc(t.status || 'Pending')}" 
                  style="width: 10px; height: 10px; border-radius: 50%; background-color: ${dotColor}; display: inline-block; cursor: pointer;"
                  onclick="OL.openEditTaskStatusQuickMenu(event, '${t.clientId}', '${t.id}')">
            </span>
        </div>

        <!-- 2. Compact Task Name -->
        <div class="task-title-cell" 
             style="font-weight: 600; font-size: 13px; color: var(--text); cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;"
             onclick="OL.openTaskInContext('${t.clientId}', '${t.id}')">
            ${esc(t.title || t.name)}
        </div>

        <!-- 3. Workspace Tag with Lucide Folder Icon -->
        <div>
            <span class="client-link-badge pill tiny soft" 
                  style="cursor:pointer; text-decoration:none; font-weight:600; padding: 2px 8px; border-radius: 4px; display:inline-flex; align-items:center; gap:5px; font-size:11px;" 
                  onclick="event.stopPropagation(); OL.navigateToClientProject('${t.clientId}')"
                  title="Jump to Workspace">
                <i data-lucide="folder" style="width:12px;height:12px; pointer-events:none;"></i> ${esc(t.clientName)}
            </span>
        </div>

        <!-- 4. Linked Resource Reference with Lucide Database Icon -->
        <div>
            <span class="pill tiny soft" style="font-size: 10px; color: var(--accent); background: rgba(var(--accent-rgb), 0.06); border: 1px solid rgba(var(--accent-rgb), 0.15); display: inline-flex; align-items: center; gap: 4px; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                <i data-lucide="database" style="width:11px;height:11px; pointer-events:none;"></i>
                ${esc(t.resourceName || t.category || 'General Resource')}
            </span>
        </div>

        <!-- 5. Compact Due Date with Lucide Calendar Icon -->
        <div onclick="event.stopPropagation();" style="position:relative; display:flex; align-items:center;">
            <i data-lucide="calendar" style="position:absolute; left:6px; width:12px; height:12px; color:${isOverdue ? '#ef4444' : 'var(--muted)'}; pointer-events:none;"></i>
            <input type="date" 
                   class="modal-input tiny monospace" 
                   value="${t.dueDate ? t.dueDate.slice(0,10) : ''}"
                   style="width:100%; padding-left: 22px; border:none; background:transparent; font-size:11px; color:${isOverdue ? '#ef4444' : 'inherit'}; font-weight:${isOverdue ? 'bold' : 'normal'};"
                   onchange="OL.updateGlobalTaskDueDate('${t.clientId}', '${t.id}', this.value)">
        </div>

        <!-- 6. Time Tracking Controls with Lucide Timer & Pencil Icons -->
        <div onclick="event.stopPropagation();" style="display: flex; align-items: center; gap: 4px; justify-content: flex-end;">
            <button class="btn tiny ${isTimerRunning ? 'danger' : 'primary'}" 
                    id="timer-btn-${t.id}"
                    title="${isTimerRunning ? 'Stop Timer' : 'Start Timer'}"
                    style="font-weight: bold; width: 26px; height: 24px; padding:0; display:inline-flex; align-items:center; justify-content:center;" 
                    onclick="event.stopPropagation(); OL.toggleLiveTaskTimer('${t.clientId}', '${t.id}')">
                <i data-lucide="${isTimerRunning ? 'square' : 'timer'}" style="width:12px;height:12px; pointer-events:none;"></i>
            </button>

            <span id="timer-display-${t.id}" class="tiny monospace bold" style="min-width: 38px; text-align: right; color: ${isTimerRunning ? '#38bdf8' : 'var(--accent)'}; font-size: 11px;">
                ${isTimerRunning ? OL.formatSecondsDisplay(OL.activeTaskTimer.elapsedSeconds) : `${t.loggedHours.toFixed(1)}h`}
            </span>

            <button class="btn tiny soft" style="padding:2px 5px; font-size:10px;" onclick="event.stopPropagation(); OL.logTaskHours('${t.clientId}', '${t.id}', 0.5)">+0.5</button>
            <button class="btn tiny soft" style="padding:2px 5px; font-size:10px;" onclick="event.stopPropagation(); OL.logTaskHours('${t.clientId}', '${t.id}', 1.0)">+1h</button>
            <button class="btn tiny soft" title="Edit Time Log" onclick="event.stopPropagation(); OL.openEditTaskTimeModal('${t.clientId}', '${t.id}')" style="display:inline-flex; align-items:center; justify-content:center; padding:3px 5px;">
                <i data-lucide="pencil" style="width:11px;height:11px; pointer-events:none;"></i>
            </button>
        </div>

        <!-- 7. Assignee Lucide Avatar Badge -->
        <div onclick="event.stopPropagation();" style="display:flex; justify-content:center;">
            <div title="Assignee: ${esc(t.assignee)}" 
                 style="width:24px; height:24px; border-radius:50%; background:${avatarBg}; color:${avatarColor}; border:1px solid ${avatarColor}; display:flex; align-items:center; justify-content:center; cursor:pointer;"
                 onclick="OL.openEditTaskAssigneeModal('${t.clientId}', '${t.id}')">
                <i data-lucide="${avatarIcon}" style="width:12px;height:12px; pointer-events:none;"></i>
            </div>
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
    // Isolate interactive form controls (selects, inputs, timer buttons, links)
    const isInteractive = event.target.closest('select, input, button, a, .client-link-badge');
    if (isInteractive) return;

    event.preventDefault();
    event.stopPropagation();

    OL.openTaskInContext(clientId, taskId);
};

// 📝 Standalone Generic Modal Overlay Helper (In case window.openModal is missing)
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
        // 1. Ensure target client data is synced into state
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

        // 2. Delegate to primary application openTaskModal if available
        if (typeof window.openTaskModal === 'function') {
            window.openTaskModal(taskId, false, clientId);
            return;
        }

        // 3. Guaranteed Standalone In-Context Modal Renderer
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
                <!-- Metadata Badges -->
                <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-bottom: 20px;">
                    <span class="pill tiny soft" style="font-weight:600; display:inline-flex; align-items:center; gap:4px;">
                        <i data-lucide="folder" style="width:12px;height:12px;"></i> ${esc(client?.meta?.name || 'Workspace')}
                    </span>
                    <span class="pill tiny accent" style="font-weight:bold;">
                        Status: ${esc(task.status || 'Pending')}
                    </span>
                    <span class="pill tiny soft" style="font-weight:bold; color:${is3rdParty ? '#38bdf8' : (isClientAssigned ? '#fbbf24' : 'var(--accent)')}">
                        Assignee: ${esc(task.assignee || 'Sphynx Task')}
                    </span>
                </div>

                <!-- Description Block -->
                <div style="margin-bottom: 20px; background: rgba(255,255,255,0.02); padding: 14px; border-radius: 6px; border:1px solid var(--line);">
                    <label class="bold tiny uppercase muted" style="display:block; margin-bottom:6px;">Deliverable Details & Description:</label>
                    <div style="font-size:13px; line-height:1.5; color:var(--text);">${esc(task.description || 'No additional notes provided for this task.')}</div>
                </div>

                <!-- Task Metrics Grid -->
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

                <!-- Modal Actions -->
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
