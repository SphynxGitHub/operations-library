import { esc, uid, state, db, updateAndSync, loadFullClient, switchClient, getBusinessScopedClients } from '../../core/data.js';
import { findRequestForTask } from '../../core/request-links.js';

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

// -------------------------------------------------------------
// MENTIONS IN THE TASK LIST — shared by both the master Task Manager and
// the Daily Dashboard (both render rows via OL.renderTaskRowHTML), so a
// task you were @mentioned on floats to the top with the mention shown as
// a sub-row underneath it, and the "Show/Hide Comments" toggle works the
// same in both places off one shared flag.
// -------------------------------------------------------------
OL.showTaskComments = true;

OL.toggleShowTaskComments = function() {
    OL.showTaskComments = !OL.showTaskComments;
    OL.refreshTaskView();
};

// Per-card "show every comment" expansion, toggled by clicking the 💬
// counter on a task's row — independent of the global mentions toggle
// above (that one auto-surfaces just the comments that tag you; this one
// is an explicit per-card opt-in to see the whole thread inline).
OL.expandedCommentCards = {};

OL.toggleExpandedTaskComments = function(taskId) {
    OL.expandedCommentCards[taskId] = !OL.expandedCommentCards[taskId];
    OL.refreshTaskView();
};

OL.toggleTaskBillable = function(clientId, taskId) {
    updateAndSync(() => {
        const client = state.clients?.[clientId];
        const task = client?.projectData?.clientTasks?.find(t =>
            String(t.id) === String(taskId) || String(t.key) === String(taskId)
        );
        if (task) task.billable = task.billable === false ? true : false;
    }, clientId);
    OL.refreshTaskView();
};

OL.getMyMentionName = function() {
    return (state.currentUser?.name || '').toLowerCase();
};

// Every comment on this task (internal only — ClickUp imports were never
// tagged by anyone here) that mentions the current logged-in person.
OL.getTaskMentionComments = function(task) {
    const myName = OL.getMyMentionName();
    if (!myName) return [];
    return (task.comments || []).filter(c => (c.mentions || []).some(m => (m.name || '').toLowerCase() === myName));
};

OL.taskHasMentionOfMe = function(task) {
    return OL.getTaskMentionComments(task).length > 0;
};

// Stable sort: tasks with a mention of me first (most recent mention
// first among those), everything else keeps its existing relative order.
OL.sortTasksMentionsFirst = function(tasks) {
    const withMentions = [];
    const rest = [];
    tasks.forEach(t => {
        const mentions = OL.getTaskMentionComments(t);
        if (mentions.length) withMentions.push({ t, latest: mentions.reduce((max, c) => Math.max(max, new Date(c.date || 0).getTime()), 0) });
        else rest.push(t);
    });
    withMentions.sort((a, b) => b.latest - a.latest);
    return [...withMentions.map(x => x.t), ...rest];
};

// The row itself (unchanged) plus a sub-row underneath when either:
// (a) comments are globally visible and this task has a mention of me, or
// (b) this specific card has been expanded via its 💬 counter — in which
// case every comment on it shows, not just mentions.
OL.renderTaskRowWithMentions = function(t, todayStr, enableBulkSelect = true) {
    const rowHTML = OL.renderTaskRowHTML(t, todayStr, enableBulkSelect);

    const isExpanded = !!OL.expandedCommentCards[t.id];
    const mentions = OL.showTaskComments ? OL.getTaskMentionComments(t) : [];
    const toShow = isExpanded ? (t.comments || []) : mentions;
    if (!toShow.length) return rowHTML;

    const sorted = [...toShow].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
    const subrow = `
        <div style="margin: -2px 0 6px ${t.parentTaskId ? '48px' : '20px'}; padding:8px 12px; border-left:2px solid var(--accent); background:rgba(var(--accent-rgb),0.05); border-radius:0 6px 6px 0; cursor:pointer;"
             onclick="OL.openTaskInContext('${t.clientId}', '${t.id}')">
            ${sorted.map(c => `
                <div class="tiny" style="display:flex; gap:6px; align-items:flex-start; margin-bottom:6px;">
                    <i data-lucide="${isExpanded ? 'message-square' : 'at-sign'}" style="width:10px;height:10px; color:var(--accent); flex-shrink:0; margin-top:3px;"></i>
                    <strong style="flex-shrink:0; width:100px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(c.author || 'Someone')}</strong>
                    <span class="muted" style="font-size:10px; flex-shrink:0; width:70px;">${c.date ? esc(new Date(c.date).toLocaleDateString([], { dateStyle: 'medium' })) : ''}</span>
                    <span style="flex:1; min-width:0; white-space:normal; overflow-wrap:break-word; line-height:1.4;">${OL.renderCommentTextWithMentions ? OL.renderCommentTextWithMentions(c.text, c.html) : esc(c.text)}</span>
                </div>
            `).join('')}
        </div>
    `;
    return rowHTML + subrow;
};

// -------------------------------------------------------------
// ASSIGNEE / STATUS FILTER — reusable list-building for the two filter
// dropdowns. Distinct values are pulled from whatever task set is
// currently in scope so the dropdown never offers an option with zero
// matches.
// -------------------------------------------------------------
OL.getDistinctAssignees = function(tasks) {
    const names = new Set();
    tasks.forEach(t => { if (t.assignee) names.add(t.assignee); });
    return [...names].sort();
};

OL.getDistinctStatuses = function(tasks) {
    const names = new Set();
    tasks.forEach(t => { names.add(t.status || 'Pending Sphynx Action'); });
    return [...names].sort();
};

OL.filterTasksByAssigneeStatus = function(tasks, assignee, status) {
    return tasks.filter(t => {
        const assigneeMatch = (assignee === 'all') || (t.assignee || 'Sphynx Task') === assignee;
        const statusMatch = (status === 'all') || (t.status || 'Pending Sphynx Action') === status;
        return assigneeMatch && statusMatch;
    });
};

// 🗂️ Bulk Task Editor selection — { taskId: clientId } so we know which
// client each selected task belongs to even when selecting across the
// master rollup (which spans many clients at once).
OL.bulkTaskSelection = OL.bulkTaskSelection || {};

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

// ================= 🗑️ TASK DELETION HANDLERS ================= //

OL.deleteTask = function(clientId, taskId, skipConfirm = false) {
    if (!skipConfirm && !confirm("Are you sure you want to delete this task? This action cannot be undone.")) {
        return;
    }

    if (OL.activeTaskTimer.taskId === taskId) {
        OL.stopLiveTaskTimer();
    }

    updateAndSync(() => {
        const client = state.clients?.[clientId];
        if (!client || !client.projectData?.clientTasks) return;

        client.projectData.clientTasks = client.projectData.clientTasks.filter(t => 
            String(t.id) !== String(taskId) && String(t.key) !== String(taskId)
        );
    }, clientId);

    delete OL.bulkTaskSelection[taskId];

    if (OL._activeModalTaskContext?.taskId === taskId) {
        OL.closeModal();
    }

    OL.refreshTaskView();
};

OL.bulkDeleteTasks = function() {
    const ids = Object.keys(OL.bulkTaskSelection);
    if (ids.length === 0) return;

    if (!confirm(`Are you sure you want to permanently delete these ${ids.length} tasks?`)) {
        return;
    }

    const byClient = {};
    Object.entries(OL.bulkTaskSelection).forEach(([taskId, clientId]) => {
        if (!byClient[clientId]) byClient[clientId] = [];
        byClient[clientId].push(taskId);
    });

    Object.entries(byClient).forEach(([clientId, taskIds]) => {
        updateAndSync(() => {
            const client = state.clients?.[clientId];
            if (!client?.projectData?.clientTasks) return;

            const idSet = new Set(taskIds.map(String));
            client.projectData.clientTasks = client.projectData.clientTasks.filter(t => 
                !idSet.has(String(t.id)) && !idSet.has(String(t.key))
            );
        }, clientId);
    });

    OL.bulkTaskSelection = {};
    OL.refreshTaskView();
};

OL.isSphynxAssignee = function(assignee) {
    if (!assignee) return true;
    if (assignee === 'Sphynx Task' || assignee === 'Sphynx') return true;
    const sphynxTeam = state.master?.sphynxTeam || [];
    return sphynxTeam.some(m => m.name === assignee);
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
            } else if (!OL.isSphynxAssignee(t.assignee)) {
                // Derived straight from the assignee name (via the roster
                // check in OL.isSphynxAssignee) rather than trusting the
                // stored t.isClientTask flag, since existing tasks already
                // assigned to a named team member before this fix have that
                // flag stuck at the wrong value — this self-heals the
                // display without needing a data migration.
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
                <button class="btn small soft" onclick="OL.toggleShowTaskComments()" style="display:flex; align-items:center; gap:6px;">
                    <i data-lucide="${OL.showTaskComments ? 'eye-off' : 'eye'}" style="width:14px;height:14px;"></i> ${OL.showTaskComments ? 'Hide' : 'Show'} Comments
                </button>
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

        ${OL.renderBulkTaskToolbar()}

        <!-- QUICK TASK CREATOR BAR -->
        <div class="card" style="padding: 16px; margin-bottom: 20px; background: rgba(var(--accent-rgb), 0.04); border: 1px solid var(--accent); position: relative; z-index: 100; overflow: visible;">
            <div style="font-weight: 800; font-size: 11px; letter-spacing: 0.05em; text-transform: uppercase; color: var(--accent); margin-bottom: 10px; display:flex; align-items:center; gap:6px;">
                <i data-lucide="zap" style="width:14px;height:14px;"></i> Quick Task Creator
            </div>
            <form onsubmit="event.preventDefault(); OL.createGlobalQuickTask();" class="quick-task-form" style="display:flex; flex-wrap:wrap; gap:10px; align-items:center;">
                
                <!-- SEARCHABLE PROJECT/CLIENT PICKER -->
                <div class="qtf-field" style="flex:0 1 220px; min-width:200px; position:relative;">
                    <!-- Hidden input maintaining backwards compatibility for forms reading element.value -->
                    <input type="hidden" id="quick-task-client" value="">
                    
                    <div style="position:relative; display:flex; align-items:center;">
                        <i data-lucide="building" style="position:absolute; left:8px; width:13px; height:13px; color:var(--muted); pointer-events:none; z-index:2;"></i>
                        <input type="text" 
                               id="quick-task-client-search" 
                               class="modal-input tiny" 
                               style="padding-left:26px; padding-right:20px; width:100%; box-sizing:border-box;" 
                               placeholder="General / Business (no client)" 
                               autocomplete="off"
                               onfocus="OL.renderQuickTaskClientDropdown(this.value)" 
                               oninput="OL.renderQuickTaskClientDropdown(this.value)">
                        
                        <i data-lucide="chevron-down" style="position:absolute; right:6px; width:12px; height:12px; color:var(--muted); pointer-events:none;"></i>
                    </div>
        
                    <!-- Floating Overlay Results -->
                    <div id="quick-task-client-results" 
                         style="display:none; position:absolute; top:100%; left:0; right:0; z-index:99999; max-height:220px; overflow-y:auto; background:var(--panel-dark, #0f172a); border:1px solid var(--line); border-radius:6px; margin-top:4px; box-shadow:0 10px 25px rgba(0,0,0,0.5); padding:4px;">
                    </div>
                </div>
        
                <input type="text" id="quick-task-title" class="modal-input tiny qtf-field" style="flex:2 1 260px; min-width:220px; text-align: left;" placeholder="Task title or deliverable description..." required>
        
                <div class="qtf-field" style="flex:1 1 170px; min-width:160px; position:relative; display:flex; align-items:center;">
                    <i data-lucide="user" style="position:absolute; left:8px; width:13px; height:13px; color:var(--muted); pointer-events:none;"></i>
                    <select id="quick-task-assignee" class="modal-input tiny" style="padding-left:26px; width:100%;">
                        <option value="Sphynx Task" selected>Sphynx Task (unassigned)</option>
                        ${(state.master?.sphynxTeam || []).length ? `
                            <optgroup label="Sphynx Team">
                                ${state.master.sphynxTeam.map(m => `<option value="${esc(m.name)}">${esc(m.name)}</option>`).join('')}
                            </optgroup>
                        ` : ''}
                        <option value="Client Task">Client Task</option>
                        <optgroup label="Third-Party / Vendors">
                            ${OL.thirdPartyAssignees.map(tp => `<option value="${esc(tp)}">${esc(tp)}</option>`).join('')}
                        </optgroup>
                    </select>
                </div>
        
                <input type="date" id="quick-task-duedate" class="modal-input tiny qtf-field" style="flex:1 1 150px; min-width:150px;" title="Due Date">
        
                <div class="qtf-field" style="flex:1 1 170px; min-width:160px; position:relative; display:flex; align-items:center;">
                    <i data-lucide="list-checks" style="position:absolute; left:8px; width:13px; height:13px; color:var(--muted); pointer-events:none;"></i>
                    <select id="quick-task-status" class="modal-input tiny" style="padding-left:26px; width:100%;">
                        ${masterStatuses.map(s => `<option value="${esc(s.name)}">${esc(s.name)}</option>`).join('')}
                    </select>
                </div>
        
                <div class="qtf-field add-split-btn" style="flex:0 0 auto;">
                    <button type="submit" class="btn tiny primary" style="min-width:96px; height:36px; font-weight: bold; display:flex; align-items:center; justify-content:center; gap:4px;" title="Add — defaults to Task, hover for the Request option">
                        <i data-lucide="plus" style="width:14px;height:14px;"></i> Add
                    </button>
                    <div class="add-split-menu">
                        <button type="submit" class="btn tiny soft" style="justify-content:flex-start; gap:6px; text-align:left;">
                            <i data-lucide="check-square" style="width:12px;height:12px;"></i> Create Task
                        </button>
                        <button type="button" class="btn tiny soft" style="justify-content:flex-start; gap:6px; text-align:left;"
                                onclick="OL.openQuickRequestPicker()" title="Create a Request (scoping line item) for the selected client instead of a Task">
                            <i data-lucide="layers" style="width:12px;height:12px;"></i> Create Request
                        </button>
                    </div>
                </div>
            </form>
        </div>

        <div class="card" style="padding: 20px;">
            <!-- ADVANCED FILTER TOOLBAR -->
            <div style="display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; margin-bottom: 15px; padding-bottom: 15px; border-bottom: 1px solid var(--line);">
                
                <div style="display: flex; gap: 8px; flex: 2 1 320px; min-width: 260px; align-items:center;">
                    <i data-lucide="search" style="width:16px;height:16px;color:var(--muted);"></i>
                    <input type="text" id="task-manager-search-input"
                           class="modal-input tiny" style="flex:1; width:100%;"
                           placeholder="Search deliverables or tasks..." 
                           value="${esc(OL.globalTaskFilterState.query)}"
                           oninput="const v=this.value; OL.reRenderPreservingFocus(() => OL.setGlobalTaskFilter('query', v));">
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
                
                        <!-- SPHYNX TEAM MEMBERS -->
                        <optgroup label="Sphynx Team">
                            ${((state.master?.sphynxTeam?.length) ? state.master.sphynxTeam : [{ name: 'Admin Owner' }, { name: 'Lead Developer' }]).map(member => `
                                <option value="${esc(member.name)}" ${OL.globalTaskFilterState.assignee === member.name ? 'selected' : ''}>${esc(member.name)}</option>
                            `).join('')}
                        </optgroup>
                
                        <!-- 3RD PARTY VENDORS -->
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
                        <option value="request" ${OL.globalTaskFilterState.groupBy === 'request' ? 'selected' : ''}>Request</option>
                        <option value="status" ${OL.globalTaskFilterState.groupBy === 'status' ? 'selected' : ''}>Status</option>
                        <option value="assignee" ${OL.globalTaskFilterState.groupBy === 'assignee' ? 'selected' : ''}>Assignee</option>
                        <option value="date" ${OL.globalTaskFilterState.groupBy === 'date' ? 'selected' : ''}>Due Date</option>
                        <option value="type" ${OL.globalTaskFilterState.groupBy === 'type' ? 'selected' : ''}>Task Type</option>
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

    // Pre-build the quick-task project dropdown's option list right now,
    // rather than waiting for the first focus event to build it — it stays
    // hidden (renderQuickTaskClientDropdown doesn't touch display until
    // told to) until the user actually focuses the field, but this removes
    // any dependency on that focus handler's timing relative to when
    // client data is available, which was leaving it looking empty until
    // a keystroke (oninput) re-ran the same render after data caught up.
    if (typeof OL.renderQuickTaskClientDropdown === 'function') {
        OL.renderQuickTaskClientDropdown('');
        const preBuilt = document.getElementById('quick-task-client-results');
        if (preBuilt) preBuilt.style.display = 'none';
    }
};

// Renders and filters the client search dropdown overlay
OL.renderQuickTaskClientDropdown = function(query) {
    const resultsContainer = document.getElementById('quick-task-client-results');
    if (!resultsContainer) return;

    const cleanQuery = (query || '').toLowerCase().trim();
    // Scoped (not raw state.clients) so a Partner only sees their own
    // clients here too, matching what the rest of this page shows them.
    const clients = getBusinessScopedClients().filter(c => c.meta?.name);

    const matches = cleanQuery
        ? clients.filter(c => (c.meta?.name || '').toLowerCase().includes(cleanQuery))
        : clients;

    let html = `
        <div class="tiny" 
             style="padding:6px 10px; border-radius:4px; cursor:pointer; font-weight:600; color:var(--accent); display:flex; align-items:center; gap:6px;"
             onmouseover="this.style.background='rgba(56,189,248,0.12)'"
             onmouseout="this.style.background='transparent'"
             onmousedown="OL.selectQuickTaskClient('', 'General / Business (no client)')">
            <i data-lucide="briefcase" style="width:12px;height:12px;"></i> General / Business (no client)
        </div>
    `;

    if (matches.length) {
        html += matches.map(c => `
            <div class="tiny" 
                 style="padding:6px 10px; border-radius:4px; cursor:pointer; display:flex; align-items:center; gap:6px;"
                 onmouseover="this.style.background='rgba(56,189,248,0.12)'"
                 onmouseout="this.style.background='transparent'"
                 onmousedown="OL.selectQuickTaskClient('${c.id}', '${esc(c.meta?.name || c.id).replace(/'/g, "\\'")}')">
                <i data-lucide="folder" style="width:12px;height:12px;color:#38bdf8;"></i> ${esc(c.meta?.name || c.id)}
            </div>
        `).join('');
    } else if (cleanQuery) {
        html += `<div class="tiny muted" style="padding:6px 10px;">No matching projects</div>`;
    }

    resultsContainer.innerHTML = html;
    resultsContainer.style.display = 'block';
    if (window.lucide) lucide.createIcons();
};

// Selects a project and triggers the assignee dropdown update
OL.selectQuickTaskClient = function(clientId, clientName) {
    const hiddenInput = document.getElementById('quick-task-client');
    const searchInput = document.getElementById('quick-task-client-search');
    const resultsContainer = document.getElementById('quick-task-client-results');

    if (hiddenInput) hiddenInput.value = clientId;
    if (searchInput) searchInput.value = clientId ? clientName : '';
    if (resultsContainer) resultsContainer.style.display = 'none';

    // 🚀 Trigger team update callback
    if (typeof OL.updateQuickTaskTeamDropdown === 'function') {
        OL.updateQuickTaskTeamDropdown(clientId);
    }
};

// Dismiss floating dropdown when clicking outside
document.addEventListener('click', function(e) {
    const resultsContainer = document.getElementById('quick-task-client-results');
    const searchInput = document.getElementById('quick-task-client-search');
    if (resultsContainer && searchInput && !resultsContainer.contains(e.target) && !searchInput.contains(e.target)) {
        resultsContainer.style.display = 'none';
    }
});

OL.setGlobalTaskFilter = function(key, val) {
    OL.globalTaskFilterState[key] = val;
    OL.renderBusinessTaskManager();
};

OL.renderFilteredTaskGroups = function(allTasks) {
    const { query, status, assignee, dateRange, groupBy, subGroupBy } = OL.globalTaskFilterState;

    const now = new Date();
    const todayStr = OL.localDateStr(now);
    
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

    const DATE_BUCKETS = ['Overdue', 'Today', 'This Week', 'Later', 'No Due Date'];
    const taskDateBucket = (task) => {
        if (!task.dueDate) return 'No Due Date';
        if (task.dueDate === todayStr) return 'Today';
        const due = new Date(task.dueDate);
        const today = new Date(todayStr);
        if (due < today) return 'Overdue';
        const weekOut = new Date(today);
        weekOut.setDate(weekOut.getDate() + 7);
        return due <= weekOut ? 'This Week' : 'Later';
    };

    const groups = {};
    const groupRequestInfo = {}; // groupKey -> resolved request metadata, only set when groupBy === 'request'
    if (groupBy === 'date') DATE_BUCKETS.forEach(b => { groups[b] = []; }); // fixed order, even if a bucket ends up empty
    filtered.forEach(task => {
        let groupKey = 'Other';
        if (groupBy === 'client') groupKey = task.clientName;
        else if (groupBy === 'status') groupKey = task.status || 'Pending Sphynx Action';
        else if (groupBy === 'assignee') groupKey = task.assignee || 'Sphynx Task';
        else if (groupBy === 'date') groupKey = taskDateBucket(task);
        else if (groupBy === 'type') groupKey = task.taskType || 'Sphynx Task';
        else if (groupBy === 'request') {
            const client = state.clients?.[task.clientId];
            const resourceLookup = (id) => (client?.projectData?.localResources || []).find(r => r.id === id) || (state.master?.resources || []).find(r => r.id === id) || null;
            const req = client ? findRequestForTask(client, task, resourceLookup) : null;
            if (req) {
                // Keyed by client + item id (not just the request title) so
                // two different clients' requests never collide into one
                // card, and so the card header can link straight to it.
                groupKey = `req:${task.clientId}:${req.itemId}`;
                groupRequestInfo[groupKey] = req;
            } else {
                groupKey = 'No Request';
            }
        }

        if (!groups[groupKey]) groups[groupKey] = [];
        groups[groupKey].push(task);
    });

    return Object.entries(groups).filter(([, tasks]) => tasks.length > 0).map(([groupTitleKey, tasks]) => {
        const groupHours = tasks.reduce((sum, t) => sum + (t.loggedHours || 0), 0);
        const sampleClientId = tasks[0]?.clientId;
        const metrics = groupBy === 'client' ? OL.getClientReconciliationMetrics(sampleClientId) : null;
        const reqInfo = groupBy === 'request' ? groupRequestInfo[groupTitleKey] : null;
        // For every other groupBy, the key IS the display title; for
        // "request" it's the req:clientId:itemId key above, so the actual
        // title comes from the resolved request (or "No Request").
        const groupTitle = reqInfo ? reqInfo.title : groupTitleKey;

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
        <div style="margin-bottom: 20px; padding: 16px; background: ${reqInfo ? 'rgba(100,198,162,0.05)' : 'rgba(255,255,255,0.02)'}; border: 1px solid ${reqInfo ? 'rgba(100,198,162,0.3)' : 'var(--line)'}; border-radius: 10px;">
            <div style="font-weight: 800; font-size: 13px; letter-spacing: 0.05em; text-transform: uppercase; color: ${reqInfo ? '#64c6a2' : 'var(--accent)'}; margin-bottom: 14px; display: flex; align-items: center; justify-content: space-between;">
                <div style="display:flex; align-items:center; gap:8px; ${reqInfo ? 'cursor:pointer;' : ''}" ${reqInfo ? `onclick="OL.openRequestFromTask('${esc(sampleClientId || '')}', '${esc(reqInfo.itemId)}')" title="Open this request on the scoping sheet"` : ''}>
                    ${OL.renderGroupSelectCheckbox(tasks)}
                    <i data-lucide="${reqInfo ? 'git-pull-request' : (groupBy === 'date' ? 'calendar' : (groupBy === 'status' ? 'flag' : (groupBy === 'assignee' ? 'user' : (groupBy === 'type' ? 'tag' : 'folder'))))}" style="width:14px;height:14px;"></i>
                    <span>${esc(groupTitle)}</span>
                    ${reqInfo ? `<span class="pill tiny soft" style="font-size:9px;">${esc(reqInfo.requestType.charAt(0).toUpperCase() + reqInfo.requestType.slice(1))} · Round ${reqInfo.round}</span>` : ''}
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
                    ${OL.sortTasksMentionsFirst(OL.sortTasksWithSubtasksNested(tasks)).map(t => OL.renderTaskRowWithMentions(t, todayStr)).join('')}
                </div>
            ` : `
                <div style="display: grid; gap: 16px; padding-left: 12px; border-left: 2px solid rgba(var(--accent-rgb), 0.2);">
                    ${Object.entries(subGroups).map(([subTitle, subTasks]) => `
                        <div>
                            <div class="tiny muted uppercase bold" style="margin-bottom: 6px; display:flex; align-items:center; gap:6px;">
                                ${OL.renderGroupSelectCheckbox(subTasks)}
                                <i data-lucide="corner-down-right" style="width:12px;height:12px;"></i> ${esc(subTitle)} (${subTasks.length})
                            </div>
                            <div style="display: grid; gap: 8px;">
                                ${OL.sortTasksMentionsFirst(OL.sortTasksWithSubtasksNested(subTasks)).map(t => OL.renderTaskRowWithMentions(t, todayStr)).join('')}
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
// Reorders a flat task array so each sub-task (t.parentTaskId set) sits
// immediately after its parent, for visually nested rendering. Orphaned
// sub-tasks (parent filtered out of this list, e.g. by a status filter)
// just render in place, unindented.
// ================= 🔗 RELATIONAL DUE DATES =================
// A task can be due N days after another task in the same client
// completes, instead of a fixed calendar date:
//   task.dueRelativeTo = { taskId: '<predecessor task id>', offsetDays: 3 }
// While waiting on its predecessor, task.dueDate stays blank. The moment
// the predecessor's status flips to a closed status, its completedAt gets
// stamped and every task relative to it gets its dueDate computed and set.

OL.isClosedStatus = function(statusName) {
    const s = (OL.getSystemStatuses() || []).find(x => x.name === statusName);
    return !!s?.isClosed;
};

// Call right after a task's status is mutated (before persisting). Stamps
// completedAt the moment a task first becomes closed, and cascades the due
// date to anything waiting on it. Safe to call unconditionally — it's a
// no-op unless the status actually just became closed.
OL.handleTaskCompletionCascade = function(client, task, previousStatus) {
    const wasClosed = OL.isClosedStatus(previousStatus);
    const isClosed = OL.isClosedStatus(task.status);
    if (!isClosed || wasClosed) return; // only fires on the transition INTO closed

    task.completedAt = new Date().toISOString();

    const tasks = client.projectData?.clientTasks || [];
    tasks.forEach(other => {
        if (other.dueRelativeTo?.taskId === task.id) {
            const d = new Date(task.completedAt);
            d.setDate(d.getDate() + Number(other.dueRelativeTo.offsetDays || 0));
            other.dueDate = d.toISOString().slice(0, 10);
        }
    });
};

// Sets (or clears, if predecessorTaskId is falsy) a task's relational due
// date. If the predecessor is already closed, resolves the due date
// immediately instead of waiting for a future status change.
OL.setRelativeTaskDueDate = function(clientId, taskId, predecessorTaskId, offsetDays) {
    updateAndSync(() => {
        const client = state.clients?.[clientId];
        const task = client?.projectData?.clientTasks?.find(t => t.id === taskId);
        if (!task) return;

        if (!predecessorTaskId) {
            task.dueRelativeTo = null;
            return;
        }

        const predecessor = client.projectData.clientTasks.find(t => t.id === predecessorTaskId);

        task.dueRelativeTo = { taskId: predecessorTaskId, offsetDays: Number(offsetDays) || 0, predecessorTitle: predecessor?.title || predecessor?.name || '' };
        task.dueDate = ''; // unresolved until the predecessor completes

        if (predecessor?.completedAt) {
            const d = new Date(predecessor.completedAt);
            d.setDate(d.getDate() + (Number(offsetDays) || 0));
            task.dueDate = d.toISOString().slice(0, 10);
        }
    }, clientId);
    OL.closePopoverDropdown();
    OL.refreshTaskView();
};

// Sets a plain fixed due date, clearing any relational link that was
// previously set on this task (fixed and relative are mutually exclusive).
OL.setFixedTaskDueDate = function(clientId, taskId, newDueDate) {
    updateAndSync(() => {
        const client = state.clients?.[clientId];
        const task = client?.projectData?.clientTasks?.find(t => t.id === taskId);
        if (!task) return;
        task.dueRelativeTo = null;
        task.dueDate = newDueDate;
    }, clientId);
    OL.closePopoverDropdown();
    OL.refreshTaskView();
};

OL.openDueDateDropdown = function(event, clientId, taskId) {
    const popover = OL.createPopoverContainer(event);
    const client = state.clients?.[clientId];
    const task = client?.projectData?.clientTasks?.find(t => t.id === taskId);
    if (!task) return;

    const otherTasks = (client.projectData?.clientTasks || []).filter(t => t.id !== taskId);

    popover.innerHTML = `
        <div class="tiny bold uppercase muted" style="margin-bottom:6px; padding:2px 4px;">Due Date</div>
        <div style="display:grid; gap:6px; min-width:240px;">
            <div>
                <label class="tiny muted">Fixed date</label>
                <input type="date" class="modal-input tiny" value="${task.dueRelativeTo ? '' : (task.dueDate ? task.dueDate.slice(0,10) : '')}"
                       onchange="OL.setFixedTaskDueDate('${clientId}', '${taskId}', this.value)">
            </div>
            <div style="border-top:1px solid var(--line); padding-top:6px;">
                <label class="tiny muted">— or — due after another task completes</label>
                <select id="due-rel-predecessor" class="modal-input tiny" style="margin-top:4px;">
                    <option value="">Select a task...</option>
                    ${otherTasks.map(t => `<option value="${t.id}" ${task.dueRelativeTo?.taskId === t.id ? 'selected' : ''}>${esc(t.title || t.name)}</option>`).join('')}
                </select>
                <div style="display:flex; align-items:center; gap:6px; margin-top:6px;">
                    <span class="tiny">Due</span>
                    <input type="number" id="due-rel-offset" class="modal-input tiny" style="width:60px;" value="${task.dueRelativeTo?.offsetDays ?? 3}" min="0">
                    <span class="tiny">days after it's completed</span>
                </div>
                <button class="btn tiny primary" style="width:100%; margin-top:8px;"
                        onclick="OL.setRelativeTaskDueDate('${clientId}', '${taskId}', document.getElementById('due-rel-predecessor').value, document.getElementById('due-rel-offset').value)">
                    Set Relative Due Date
                </button>
                ${task.dueRelativeTo ? `<button class="btn tiny soft" style="width:100%; margin-top:4px;" onclick="OL.setRelativeTaskDueDate('${clientId}', '${taskId}', null, 0)">Clear (use fixed date)</button>` : ''}
            </div>
        </div>
    `;
    if (window.lucide) lucide.createIcons();
};

OL.sortTasksWithSubtasksNested = function(tasks) {
    const byId = {};
    tasks.forEach(t => { byId[t.id] = t; });

    const topLevel = tasks.filter(t => !t.parentTaskId || !byId[t.parentTaskId]);
    const childrenOf = {};
    tasks.forEach(t => {
        if (t.parentTaskId && byId[t.parentTaskId]) {
            if (!childrenOf[t.parentTaskId]) childrenOf[t.parentTaskId] = [];
            childrenOf[t.parentTaskId].push(t);
        }
    });

    const ordered = [];
    topLevel.forEach(t => {
        ordered.push(t);
        (childrenOf[t.id] || []).forEach(child => ordered.push(child));
    });
    return ordered;
};

// 🎨 Shared assignee avatar styling — used by both task rows and event
// rows (features/business/calendar.js OL.renderEventRowHTML) so the two
// card types look consistent.
OL.computeAssigneeAvatar = function(assignee) {
    const is3rdParty = (OL.thirdPartyAssignees || []).includes(assignee);
    const isGenericSphynx = assignee === 'Sphynx Task' || assignee === 'Sphynx';
    const isGenericClient = assignee === 'Client Task' || assignee === 'Client';
    const isSphynxTeamMember = (state.master?.sphynxTeam || []).some(m => m.name === assignee);
    const isNamedPerson = !isGenericSphynx && !isGenericClient && !is3rdParty;

    let avatarBg = 'rgba(56, 189, 248, 0.15)';
    let avatarColor = '#38bdf8';
    let avatarContent = '';

    if (is3rdParty) {
        avatarBg = 'rgba(234, 179, 8, 0.15)';
        avatarColor = '#eab308';
        avatarContent = `<i data-lucide="wrench" style="width:12px;height:12px; pointer-events:none;"></i>`;
    } else if (isGenericSphynx) {
        avatarBg = 'rgba(56, 189, 248, 0.15)';
        avatarColor = '#38bdf8';
        avatarContent = `<i data-lucide="zap" style="width:12px;height:12px; pointer-events:none;"></i>`;
    } else if (isGenericClient) {
        avatarBg = 'rgba(236, 72, 153, 0.15)';
        avatarColor = '#ec4899';
        avatarContent = `<i data-lucide="user" style="width:12px;height:12px; pointer-events:none;"></i>`;
    } else if (isNamedPerson && isSphynxTeamMember) {
        avatarBg = '#2dd4bf';
        avatarColor = '#ffffff';
        const nameParts = (assignee || 'SP').trim().split(' ');
        avatarContent = nameParts.length >= 2
            ? `${nameParts[0][0]}${nameParts[nameParts.length - 1][0]}`.toUpperCase()
            : nameParts[0].substring(0, 2).toUpperCase();
    } else if (isNamedPerson) {
        avatarBg = '#ec4899';
        avatarColor = '#ffffff';
        const nameParts = (assignee || 'CL').trim().split(' ');
        avatarContent = nameParts.length >= 2
            ? `${nameParts[0][0]}${nameParts[nameParts.length - 1][0]}`.toUpperCase()
            : nameParts[0].substring(0, 2).toUpperCase();
    } else if (!assignee) {
        avatarContent = `<i data-lucide="user" style="width:12px;height:12px; pointer-events:none; opacity:0.5;"></i>`;
    }

    return { avatarBg, avatarColor, avatarContent, isNamedPerson };
};

OL.renderTaskRowHTML = function(t, todayStr, enableBulkSelect = true) {
    const is3rdParty = (OL.thirdPartyAssignees || []).includes(t.assignee);
    const isGenericSphynx = t.assignee === 'Sphynx Task' || t.assignee === 'Sphynx';
    const isGenericClient = t.assignee === 'Client Task' || t.assignee === 'Client';
    const isSphynxTeamMember = (state.master?.sphynxTeam || []).some(m => m.name === t.assignee);
    const isNamedPerson = !isGenericSphynx && !isGenericClient && !is3rdParty;

    const isTimerRunning = OL.activeTaskTimer.taskId === t.id;

    const masterStatuses = OL.getSystemStatuses();
    const activeStatusObj = masterStatuses.find(s => s.name === t.status) || { color: '#94a3b8', isClosed: false };
    const dotColor = activeStatusObj.color;
    const isOverdue = t.dueDate && t.dueDate.slice(0,10) < todayStr && !activeStatusObj.isClosed;

    const { avatarBg, avatarColor, avatarContent } = OL.computeAssigneeAvatar(t.assignee);

    return `
    <div class="task-row-card" 
         style="display:flex; flex-direction:column; gap:6px; padding:10px 14px; margin-left:${t.parentTaskId ? '28px' : '0'}; background:${isTimerRunning ? 'rgba(56, 189, 248, 0.08)' : 'rgba(255,255,255,0.01)'}; border-bottom:1px solid var(--line); border-radius:4px; cursor:pointer; ${t.parentTaskId ? 'border-left:2px solid var(--accent);' : ''}"
         onclick="OL.handleTaskRowClick(event, '${t.clientId}', '${t.id}')">
        ${t.parentTaskId ? `<div class="tiny muted" style="display:flex; align-items:center; gap:4px;"><i data-lucide="corner-down-right" style="width:11px;height:11px;"></i> Sub-task${t.automationRuleId ? ' · auto-created' : ''}</div>` : ''}
        <!-- LINE 1: Status Dot + Expanded Task Title + Workspace Badge -->
        <div style="display:flex; align-items:center; gap:10px; width:100%;">
            <!-- Bulk Select Checkbox — only on views that actually have the
                 bulk-action toolbar (Task Manager / Client Tasks). The
                 Daily Dashboard reuses this same row template for its
                 "Open Action Items" list but has no bulk-action bar, so
                 showing a checkbox there did nothing when checked. -->
            ${enableBulkSelect ? `
                <input type="checkbox" 
                       onclick="event.stopPropagation();"
                       onchange="OL.toggleBulkTaskSelection('${t.id}', '${t.clientId}')"
                       ${OL.bulkTaskSelection[t.id] ? 'checked' : ''}
                       style="width:14px;height:14px;flex-shrink:0;cursor:pointer;">
            ` : ''}
            <!-- Status Dot -->
            <div onclick="event.stopPropagation();" style="display:flex; align-items:center;">
                <span title="Status: ${esc(t.status || 'Pending')}" 
                      style="width:10px; height:10px; border-radius:50%; background-color:${dotColor}; display:inline-block; cursor:pointer;"
                      onclick="OL.openEditTaskStatusQuickDropdown(event, '${t.clientId}', '${t.id}')">
                </span>
            </div>

            <!-- Full-Width Task Title -->
            <div class="task-title-cell"
                 id="task-title-display-${t.id}"
                 style="font-weight:600; font-size:13px; color:var(--text); cursor:pointer; flex:1; min-width:0; max-width:100%; overflow:hidden; word-break:break-word; overflow-wrap:break-word; display:flex; align-items:center; gap:6px; line-height:1.3;"
                 title="${esc(t.title || t.name)}"
                 onclick="OL.openTaskInContext('${t.clientId}', '${t.id}')">
                <span style="display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;">${esc(t.title || t.name)}</span>
                <i data-lucide="pencil" style="width:11px;height:11px; flex-shrink:0; opacity:0.5; cursor:pointer;"
                   onclick="event.stopPropagation(); OL.startInlineTaskTitleEdit('${t.clientId}', '${t.id}')"></i>
                ${(t.comments && t.comments.length) ? `
                    <span class="pill tiny soft" style="cursor:pointer; font-size:10px; display:inline-flex; align-items:center; gap:3px; flex-shrink:0;"
                          onclick="event.stopPropagation(); OL.toggleExpandedTaskComments('${t.id}')"
                          title="${OL.expandedCommentCards[t.id] ? 'Hide comments' : 'Show all comments'}">
                        <i data-lucide="message-square" style="width:10px;height:10px; pointer-events:none;"></i> ${t.comments.length}
                    </span>
                ` : ''}
            </div>

            <!-- Workspace Tag -->
            <div style="flex-shrink:0;">
                ${OL.renderProjectPill(t.clientId, t.clientName, { extraClass: 'client-link-badge' })}
            </div>
        </div>

        <!-- LINE 2: Linked Resource | Due Date | Time Logging | Assignee Badge -->
        <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; padding-top:4px; border-top:1px dashed rgba(255,255,255,0.04);">
            
            <div style="display:flex; align-items:center; gap:12px;">
                <!-- Linked Resource -->
                <span class="pill tiny soft" style="font-size:10px; color:var(--accent); background:rgba(var(--accent-rgb), 0.06); border:1px solid rgba(var(--accent-rgb), 0.15); display:inline-flex; align-items:center; gap:4px;">
                    <i data-lucide="database" style="width:11px;height:11px; pointer-events:none;"></i>
                    ${esc(typeof OL.taskResourceLabel === 'function' ? OL.taskResourceLabel(t) : (t.resourceName || t.category || 'General Resource'))}
                </span>
                ${typeof OL.renderRequestTagHTML === 'function' ? OL.renderRequestTagHTML(t) : ''}

                ${(t.clickupComments && t.clickupComments.length) ? `
                <span class="pill tiny soft" title="Imported from ClickUp" style="font-size:10px; display:inline-flex; align-items:center; gap:4px;">
                    <i data-lucide="message-square" style="width:11px;height:11px; pointer-events:none;"></i>
                    ${t.clickupComments.length}
                </span>` : ''}

                <!-- Due Date -->
                <div onclick="event.stopPropagation();" style="position:relative; display:flex; align-items:center;">
                    ${t.dueRelativeTo ? `
                        <span class="pill tiny soft" style="cursor:pointer; display:inline-flex; align-items:center; gap:4px; font-size:10px;" onclick="OL.openDueDateDropdown(event, '${t.clientId}', '${t.id}')" title="Due ${t.dueRelativeTo.offsetDays}d after '${esc(t.dueRelativeTo.predecessorTitle)}' completes">
                            <i data-lucide="link" style="width:10px;height:10px;"></i>
                            ${t.dueDate ? esc(t.dueDate.slice(0,10)) : `+${t.dueRelativeTo.offsetDays}d after predecessor`}
                        </span>
                    ` : `
                        <i data-lucide="calendar" style="position:absolute; left:6px; width:12px; height:12px; color:${isOverdue ? '#ef4444' : 'var(--muted)'}; pointer-events:none; cursor:pointer;" onclick="OL.openDueDateDropdown(event, '${t.clientId}', '${t.id}')"></i>
                        <input type="date" 
                               class="modal-input tiny monospace" 
                               value="${t.dueDate ? t.dueDate.slice(0,10) : ''}"
                               style="width:125px; padding-left:22px; border:none; background:transparent; font-size:11px; color:${isOverdue ? '#ef4444' : 'inherit'}; font-weight:${isOverdue ? 'bold' : 'normal'};"
                               onchange="OL.updateGlobalTaskDueDate('${t.clientId}', '${t.id}', this.value)">
                    `}
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
                </div>

                <!-- Billable Toggle -->
                <div onclick="event.stopPropagation();" style="display:flex; align-items:center;">
                    <span title="${t.billable === false ? 'Non-billable — click to mark billable' : 'Billable — click to mark non-billable'}"
                          style="cursor:pointer; font-size:10px; font-weight:bold; padding:2px 6px; border-radius:10px; ${t.billable === false ? 'background:rgba(148,163,184,0.15); color:var(--muted);' : 'background:rgba(34,197,94,0.15); color:#22c55e;'}"
                          onclick="OL.toggleTaskBillable('${t.clientId}', '${t.id}')">
                        ${t.billable === false ? '⊘ $' : '$'}
                    </span>
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

// ================= 🗂️ BULK TASK EDITOR =================

OL.toggleBulkTaskSelection = function(taskId, clientId) {
    if (OL.bulkTaskSelection[taskId]) {
        delete OL.bulkTaskSelection[taskId];
    } else {
        OL.bulkTaskSelection[taskId] = clientId;
    }
    OL.refreshTaskView();
};

OL.clearBulkTaskSelection = function() {
    OL.bulkTaskSelection = {};
    OL.refreshTaskView();
};

// Select/deselect every task in a group at once. pairsStr is
// "taskId:clientId,taskId:clientId,..." (built by renderGroupSelectCheckbox)
// since a group can span multiple clients (e.g. grouped by status/assignee
// in the master rollup).
OL.toggleBulkSelectGroup = function(pairsStr, checked) {
    pairsStr.split(',').filter(Boolean).forEach(pair => {
        const [taskId, clientId] = pair.split(':');
        if (checked) {
            OL.bulkTaskSelection[taskId] = clientId;
        } else {
            delete OL.bulkTaskSelection[taskId];
        }
    });
    OL.refreshTaskView();
};

// Renders the "select all in this group" checkbox for a group header.
// Checked when every task in the group is currently selected.
OL.renderGroupSelectCheckbox = function(tasks) {
    if (!tasks || tasks.length === 0) return '';
    const pairs = tasks.map(t => `${t.id}:${t.clientId}`).join(',');
    const allSelected = tasks.every(t => OL.bulkTaskSelection[t.id]);
    return `
        <input type="checkbox"
               title="Select all in this group"
               onclick="event.stopPropagation();"
               onchange="OL.toggleBulkSelectGroup('${pairs}', this.checked)"
               ${allSelected ? 'checked' : ''}
               style="width:13px;height:13px;cursor:pointer;">
    `;
};

// Renders the sticky bulk-action bar. Returns '' (renders nothing) when
// nothing is selected, so callers can just drop this above their task list
// unconditionally.
OL.renderBulkTaskToolbar = function() {
    const ids = Object.keys(OL.bulkTaskSelection);
    if (ids.length === 0) return '';

    const masterStatuses = OL.getSystemStatuses();

    const clientIds = [...new Set(Object.values(OL.bulkTaskSelection))];
    const seenNames = new Set();
    const clientTeamOptions = [];
    clientIds.forEach(cid => {
        (OL.getClientTeamOptions ? OL.getClientTeamOptions(cid) : []).forEach(m => {
            if (m.name && !seenNames.has(m.name)) {
                seenNames.add(m.name);
                clientTeamOptions.push(m);
            }
        });
    });

    return `
        <div style="position:fixed; bottom:20px; left:50%; transform:translateX(-50%); z-index:500; padding:10px 16px; display:flex; align-items:center; gap:10px; flex-wrap:wrap; justify-content:center; border:1px solid var(--accent); background:var(--panel-dark, #111); box-shadow:0 8px 24px rgba(0,0,0,0.4); border-radius:10px; max-width:92vw;">
            <strong class="tiny" style="white-space:nowrap;">${ids.length} task${ids.length === 1 ? '' : 's'} selected</strong>

            <select id="bulk-set-status" class="modal-input tiny" style="width:auto;">
                <option value="">Set Status...</option>
                ${masterStatuses.map(s => `<option value="${esc(s.name)}">${esc(s.name)}</option>`).join('')}
            </select>

            <select id="bulk-set-assignee" class="modal-input tiny" style="width:180px;">
                <option value="">Set Assignee...</option>
                <option value="Sphynx Task">Sphynx Task</option>
                <option value="Client Task">Client Task</option>
                ${(state.master?.sphynxTeam || []).length ? `
                    <optgroup label="Sphynx Team">
                        ${state.master.sphynxTeam.map(m => `<option value="${esc(m.name)}">${esc(m.name)}</option>`).join('')}
                    </optgroup>
                ` : ''}
                ${clientTeamOptions.length ? `
                    <optgroup label="Client Team">
                        ${clientTeamOptions.map(m => `<option value="${esc(m.name)}">${esc(m.name)}</option>`).join('')}
                    </optgroup>
                ` : ''}
                <optgroup label="Vendors / 3rd Party">
                    ${(OL.thirdPartyAssignees || []).map(tp => `<option value="${esc(tp)}">${esc(tp)}</option>`).join('')}
                </optgroup>
            </select>

            <select id="bulk-set-billable" class="modal-input tiny" style="width:auto;">
                <option value="">Billable...</option>
                <option value="true">Billable ($)</option>
                <option value="false">Non-Billable (⊘)</option>
            </select>

            <input type="date" id="bulk-set-duedate" class="modal-input tiny" style="width:auto;">

            <button class="btn tiny primary" onclick="OL.applyBulkTaskEdit()">Apply to Selected</button>
            <button class="btn tiny danger soft" onclick="OL.bulkDeleteTasks()" style="display:flex; align-items:center; gap:4px;">
                <i data-lucide="trash-2" style="width:12px;height:12px;"></i> Delete
            </button>
            <button class="btn tiny soft" onclick="OL.clearBulkTaskSelection()">Clear Selection</button>
        </div>
    `;
};

OL.applyBulkTaskEdit = function() {
    const newStatus = document.getElementById('bulk-set-status')?.value || '';
    const newAssignee = document.getElementById('bulk-set-assignee')?.value?.trim() || '';
    const newBillableVal = document.getElementById('bulk-set-billable')?.value || '';
    const newDueDate = document.getElementById('bulk-set-duedate')?.value || '';

    if (!newStatus && !newAssignee && !newDueDate && newBillableVal === '') {
        alert('Set at least one field (status, assignee, billable, or due date) before applying.');
        return;
    }

    const byClient = {};
    Object.entries(OL.bulkTaskSelection).forEach(([taskId, clientId]) => {
        if (!byClient[clientId]) byClient[clientId] = [];
        byClient[clientId].push(taskId);
    });

    Object.entries(byClient).forEach(([clientId, taskIds]) => {
        updateAndSync(() => {
            const client = state.clients?.[clientId];
            if (!client?.projectData?.clientTasks) return;

            taskIds.forEach(taskId => {
                const task = client.projectData.clientTasks.find(t =>
                    String(t.id) === String(taskId) || String(t.key) === String(taskId)
                );
                if (!task) return;

                if (newStatus) {
                    const previousStatus = task.status;
                    task.status = newStatus;
                    OL.handleTaskCompletionCascade(client, task, previousStatus);
                    if (typeof OL.runAutomationRules === 'function') {
                        OL.runAutomationRules('task_status_change', {
                            clientId, client, task,
                            previousStatus, newStatus,
                            assignee: task.assignee,
                            title: task.title || task.name,
                            resourceName: task.resourceName || task.category || ''
                        });
                    }
                }
                if (newAssignee) {
                    const previousAssignee = task.assignee;
                    task.assignee = newAssignee;
                    task.isClientTask = OL.computeIsClientTask(newAssignee);
                    if (newAssignee !== previousAssignee && typeof OL.notifyEvent === 'function') {
                        OL.notifyEvent('newAssignment', newAssignee, {
                            subject: `You were assigned "${task.title || task.name}"`,
                            body: `Assigned on ${client?.meta?.name || 'a project'}.`
                        });
                    }
                }
                if (newBillableVal !== '') {
                    task.billable = newBillableVal === 'true';
                }
                if (newDueDate) {
                    task.dueDate = newDueDate;
                }
            });
        }, clientId);
    });

    OL.bulkTaskSelection = {};
    OL.refreshTaskView();
};

OL.closePopoverDropdown = function(e) {
    const existing = document.getElementById('task-popover-dropdown');
    if (!existing) return;
    // The document-level "click outside to close" listener below passes
    // its click event through here -- if that click actually landed
    // INSIDE the popover (e.g. typing into the Quick Time Add "Custom
    // Entry" H/M inputs, or any other input this popover ever grows),
    // leave it open. This used to close on every single click anywhere,
    // popover-interior clicks included, since nothing checked the target
    // at all -- typing into a field inside a popover closed the popover
    // before you could finish. Explicit "action just happened, now close"
    // calls elsewhere (onclick="...; OL.closePopoverDropdown();") pass no
    // event and always close, same as before.
    if (e && existing.contains(e.target)) return;
    existing.remove();
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
        max-height: 60vh;
        overflow-y: auto;
        font-size: 12px;
        visibility: hidden;
    `;

    const rect = event.currentTarget.getBoundingClientRect();
    document.body.appendChild(popover);

    // Positioning has to wait until the caller (right after this returns)
    // fills in the popover's actual contents -- its real height isn't known
    // yet at this point, so this used to just always drop straight below
    // the trigger regardless of whether that fit, which is exactly what
    // was cutting status/user list dropdowns off at the bottom (or top,
    // near the edges of a modal). Deferring one tick lets the content
    // settle first, then this clamps to the viewport on every edge —
    // flipping above the trigger if there's no room below, and pulling in
    // from the sides if it would run off either edge. Also: getBoundingClientRect()
    // is already viewport-relative, so this fixed-position element must NOT
    // add window.scrollY on top of it (the previous version did, which
    // double-counted scroll and could push it further off-screen on any
    // page that was scrolled).
    setTimeout(() => {
        const popRect = popover.getBoundingClientRect();
        const margin = 8;

        let top = rect.bottom + 4;
        if (top + popRect.height > window.innerHeight - margin) {
            const aboveTop = rect.top - popRect.height - 4;
            top = aboveTop >= margin ? aboveTop : Math.max(margin, window.innerHeight - popRect.height - margin);
        }

        let left = rect.left;
        if (left + popRect.width > window.innerWidth - margin) {
            left = window.innerWidth - popRect.width - margin;
        }
        left = Math.max(margin, left);

        popover.style.top = `${top}px`;
        popover.style.left = `${left}px`;
        popover.style.visibility = 'visible';
    }, 0);

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
                        onclick="OL.closePopoverDropdown(); OL.updateGlobalTaskStatus('${clientId}', '${taskId}', '${esc(s.name)}');">
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
            <button class="btn tiny soft" style="display:flex; align-items:center; gap:6px; text-align:left;" onclick="OL.closePopoverDropdown(); OL.updateGlobalTaskAssignee('${clientId}', '${taskId}', 'Sphynx Task');">
                <i data-lucide="zap" style="width:12px;height:12px;color:var(--accent);"></i> Sphynx Task
            </button>
            <button class="btn tiny soft" style="display:flex; align-items:center; gap:6px; text-align:left;" onclick="OL.closePopoverDropdown(); OL.updateGlobalTaskAssignee('${clientId}', '${taskId}', 'Client Task');">
                <i data-lucide="user" style="width:12px;height:12px;color:#ec4899;"></i> Client Task
            </button>
            ${(state.master?.sphynxTeam || []).length > 0 ? `
                <div class="tiny muted uppercase bold" style="margin-top:6px; padding:2px 4px;">Sphynx Team</div>
                ${state.master.sphynxTeam.map(m => `
                    <button class="btn tiny soft" style="display:flex; align-items:center; gap:6px; text-align:left;" onclick="OL.closePopoverDropdown(); OL.updateGlobalTaskAssignee('${clientId}', '${taskId}', '${esc(m.name)}');">
                        <i data-lucide="shield-check" style="width:12px;height:12px;color:var(--accent);"></i> ${esc(m.name)}
                    </button>
                `).join('')}
            ` : ''}
            ${teamOptions.length > 0 ? `
                <div class="tiny muted uppercase bold" style="margin-top:6px; padding:2px 4px;">Client Team</div>
                ${teamOptions.map(m => `
                    <button class="btn tiny soft" style="display:flex; align-items:center; gap:6px; text-align:left;" onclick="OL.closePopoverDropdown(); OL.updateGlobalTaskAssignee('${clientId}', '${taskId}', '${esc(m.name)}');">
                        <i data-lucide="user" style="width:12px;height:12px;color:#ec4899;"></i> ${esc(m.name)}
                    </button>
                `).join('')}
            ` : ''}
            <div class="tiny muted uppercase bold" style="margin-top:6px; padding:2px 4px;">Vendors / 3rd Party</div>
            ${OL.thirdPartyAssignees.map(tp => `
                <button class="btn tiny soft" style="display:flex; align-items:center; gap:6px; text-align:left;" onclick="OL.closePopoverDropdown(); OL.updateGlobalTaskAssignee('${clientId}', '${taskId}', '${esc(tp)}');">
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
            <button class="btn tiny ${isTimerRunning ? 'danger' : 'primary'}" style="display:flex; align-items:center; gap:6px; justify-content:center; font-weight:bold;" onclick="OL.closePopoverDropdown(); OL.toggleLiveTaskTimer('${clientId}', '${taskId}');">
                <i data-lucide="${isTimerRunning ? 'square' : 'play'}" style="width:12px;height:12px;"></i>
                ${isTimerRunning ? 'Stop Timer' : 'Start Live Timer'}
            </button>
            <div class="tiny muted uppercase bold" style="margin-top:6px; padding:2px 4px;">Quick Time Add</div>
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:4px;">
                <button class="btn tiny soft" onclick="OL.closePopoverDropdown(); OL.logTaskHours('${clientId}', '${taskId}', 0.08);">+5 mins</button>
                <button class="btn tiny soft" onclick="OL.closePopoverDropdown(); OL.logTaskHours('${clientId}', '${taskId}', 0.17);">+10 mins</button>
                <button class="btn tiny soft" onclick="OL.closePopoverDropdown(); OL.logTaskHours('${clientId}', '${taskId}', 0.25);">+15 mins</button>
                <button class="btn tiny soft" onclick="OL.closePopoverDropdown(); OL.logTaskHours('${clientId}', '${taskId}', 0.50);">+30 mins</button>
                <button class="btn tiny soft" style="grid-column: span 2;" onclick="OL.closePopoverDropdown(); OL.logTaskHours('${clientId}', '${taskId}', 1.00);">+60 mins (+1h)</button>
            </div>
            <div style="margin-top:6px; padding-top:6px; border-top:1px solid var(--line);">
                <div class="tiny muted uppercase bold" style="margin-bottom:4px; padding:2px 4px;">Custom Entry (adds to total)</div>
                <div style="display:flex; gap:4px; align-items:center;">
                    <input type="number" min="0" step="1" id="quick-log-custom-h" placeholder="H" class="modal-input tiny" style="width:100%;">
                    <input type="number" min="0" max="59" step="1" id="quick-log-custom-m" placeholder="M" class="modal-input tiny" style="width:100%;">
                    <button class="btn tiny primary" style="flex-shrink:0; font-weight:bold;" onclick="OL.logCustomTaskTime('${clientId}', '${taskId}')">Add</button>
                </div>
            </div>
            <div style="margin-top:6px; padding-top:6px; border-top:1px solid var(--line);">
                <button class="btn tiny soft" style="display:flex; align-items:center; gap:6px; width:100%; justify-content:center;" onclick="OL.closePopoverDropdown(); OL.openEditTaskTimeModal('${clientId}', '${taskId}');">
                    <i data-lucide="pencil" style="width:11px;height:11px;"></i> Edit Total (Override)
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
    const onDashboard = hash.includes('/business/dashboard') || hash === '#/' || hash === '';
    if (hash.includes('client-tasks') && typeof window.renderClientTaskManager === 'function') {
        window.renderClientTaskManager();
    } else if (hash.includes('/business/calendar') && typeof OL.renderBusinessCalendar === 'function') {
        OL.renderBusinessCalendar();
    } else if (onDashboard && typeof OL.renderDailyDashboard === 'function') {
        OL.renderDailyDashboard();
    } else if (typeof OL.renderBusinessTaskManager === 'function') {
        OL.renderBusinessTaskManager();
    }

    // If the task detail modal is currently open (opened from the dashboard,
    // master task manager, or a client workspace), re-render it too so field
    // edits (status/assignee/due date/title) made via its controls — or via
    // a row elsewhere while the modal happens to be open — show up live
    // instead of only updating the page underneath.
    const ctx = OL._activeModalTaskContext;
    if (ctx) {
        const client = state.clients?.[ctx.clientId];
        const task = client?.projectData?.clientTasks?.find(t =>
            String(t.id) === String(ctx.taskId) || String(t.key) === String(ctx.taskId)
        );
        if (client && task) OL.renderInContextTaskModal(client, task);
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
    // Deferred one tick: this input's own onchange is still firing when we
    // get here, and the browser is mid-way through closing its native date
    // picker for it. Rebuilding the row (and thus this very input) inside
    // that same synchronous handler was cutting that close animation off
    // partway through, leaving the picker visually stuck open. Letting the
    // browser finish first, then re-rendering, fixes that without changing
    // anything else about the flow.
    setTimeout(() => OL.refreshTaskView(), 0);
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
            const previousStatus = task.status;
            task.status = newStatus;
            console.log(`✅ Status updated successfully for [${taskId}] -> ${newStatus}`);

            OL.handleTaskCompletionCascade(client, task, previousStatus);

            if (typeof OL.runAutomationRules === 'function') {
                OL.runAutomationRules('task_status_change', {
                    clientId, client, task,
                    previousStatus, newStatus,
                    assignee: task.assignee,
                    title: task.title || task.name,
                    resourceName: task.resourceName || task.category || ''
                });
            }
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
            const previousAssignee = task.assignee;
            task.assignee = newAssignee;
            task.isClientTask = OL.computeIsClientTask(newAssignee);
            console.log(`✅ Assignee updated successfully for [${taskId}] -> ${newAssignee}`);
            if (newAssignee !== previousAssignee && typeof OL.notifyEvent === 'function') {
                OL.notifyEvent('newAssignment', newAssignee, {
                    subject: `You were assigned "${task.title || task.name}"`,
                    body: `Assigned on ${client?.meta?.name || 'a project'}.`
                });
            }
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

// One-off additive entry (e.g. "add 1h 23m") — distinct from both the fixed
// Quick Time Add presets and Edit Total, which overwrites the running total.
OL.logCustomTaskTime = function(clientId, taskId) {
    const hInput = document.getElementById('quick-log-custom-h');
    const mInput = document.getElementById('quick-log-custom-m');
    const h = parseInt(hInput?.value, 10) || 0;
    const m = parseInt(mInput?.value, 10) || 0;

    if (h < 0 || m < 0 || m > 59) {
        alert('Minutes must be between 0 and 59.');
        return;
    }
    if (h === 0 && m === 0) {
        alert('Enter an hours and/or minutes value greater than 0.');
        return;
    }

    OL.logTaskHours(clientId, taskId, OL.hmToDecimalHours(h, m));
    if (typeof OL.closePopoverDropdown === 'function') OL.closePopoverDropdown();
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
    OL._persistActiveTimer();
    OL._runTaskTimerTick(taskId);

    OL.refreshTaskView();
};

// Recomputes elapsed time from the wall-clock startTime rather than
// counting "+1 per tick". A plain counter undercounts badly in a
// background/minimized tab, since browsers throttle setInterval there
// (often to once a minute, sometimes fully paused) — so a tab left
// unfocused looked like the timer had "stopped". Deriving elapsed time
// from Date.now() - startTime instead means it always self-corrects to
// the true value the moment the tab wakes back up, tick throttling or not.
OL._runTaskTimerTick = function(taskId) {
    const timer = OL.activeTaskTimer;
    clearInterval(timer.intervalId);
    timer.intervalId = setInterval(() => {
        if (timer.taskId !== taskId || !timer.startTime) return;
        timer.elapsedSeconds = Math.floor((Date.now() - timer.startTime) / 1000);
        const displayEl = document.getElementById(`timer-display-${taskId}`);
        if (displayEl) {
            displayEl.innerText = OL.formatSecondsDisplay(timer.elapsedSeconds);
        }
    }, 1000);
};

// Saved to localStorage (not just held in memory) so a running timer
// survives the app being closed, refreshed, or crashing mid-session.
// OL.restoreActiveTaskTimer (called on app boot) picks this back up and
// recovers the real elapsed time from the saved startTime, instead of the
// old behavior where closing the app while a timer ran lost that time
// with no record of it at all.
OL._TIMER_STORAGE_KEY = 'ol_active_task_timer';

OL._persistActiveTimer = function() {
    const timer = OL.activeTaskTimer;
    try {
        localStorage.setItem(OL._TIMER_STORAGE_KEY, JSON.stringify({
            clientId: timer.clientId, taskId: timer.taskId, startTime: timer.startTime
        }));
    } catch (e) { console.warn('Could not persist active timer:', e); }
};

OL._clearPersistedTimer = function() {
    try { localStorage.removeItem(OL._TIMER_STORAGE_KEY); } catch (e) { /* ignore */ }
};

// Called once on app load. If a timer was left running when the app last
// closed (tab closed, browser crashed, laptop slept), this picks it back
// up: elapsed time is recomputed from the saved startTime to now, so
// nothing is lost, and the live timer resumes ticking for that task as if
// it had never stopped.
OL.restoreActiveTaskTimer = function() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(OL._TIMER_STORAGE_KEY) || 'null'); } catch (e) { /* ignore */ }
    if (!saved || !saved.taskId || !saved.startTime) return;

    const client = state.clients?.[saved.clientId];
    const task = client?.projectData?.clientTasks?.find(t => t.id === saved.taskId);
    if (!task) { OL._clearPersistedTimer(); return; } // task no longer exists — nothing to resume

    OL.activeTaskTimer.clientId = saved.clientId;
    OL.activeTaskTimer.taskId = saved.taskId;
    OL.activeTaskTimer.startTime = saved.startTime;
    OL.activeTaskTimer.elapsedSeconds = Math.floor((Date.now() - saved.startTime) / 1000);
    OL._runTaskTimerTick(saved.taskId);
};

OL.stopLiveTaskTimer = function() {
    const timer = OL.activeTaskTimer;
    if (!timer.taskId) return;

    clearInterval(timer.intervalId);
    // Final read from wall-clock time, same reasoning as the tick above —
    // whatever the throttled interval last managed to write, this corrects
    // it to the true elapsed time before it's logged.
    timer.elapsedSeconds = Math.floor((Date.now() - timer.startTime) / 1000);
    const hoursEarned = Number((timer.elapsedSeconds / 3600).toFixed(2));

    if (hoursEarned > 0) {
        OL.logTaskHours(timer.clientId, timer.taskId, hoursEarned);
    }

    OL._clearPersistedTimer();
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
    const sphynxTeam = state.master?.sphynxTeam || [];

    let html = `<option value="Sphynx Task" selected>Sphynx Task (unassigned)</option>`;
    if (sphynxTeam.length > 0) {
        html += `<optgroup label="Sphynx Team">`;
        sphynxTeam.forEach(m => {
            html += `<option value="${esc(m.name)}">${esc(m.name)}</option>`;
        });
        html += `</optgroup>`;
    }
    if (teamOptions.length > 0) {
        html += `<optgroup label="Client Team Members">`;
        teamOptions.forEach(m => {
            html += `<option value="${esc(m.name)}">${esc(m.name)}</option>`;
        });
        html += `</optgroup>`;
    } else if (sphynxTeam.length === 0) {
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
    // Always close whatever modal happens to be open first — this pill
    // shows up inside modals (the calendar event detail modal, notably),
    // and switching the whole page's client context out from under an
    // open modal left it stuck on screen over the newly rendered project.
    if (typeof OL.closeModal === 'function') OL.closeModal();
    if (typeof switchClient === 'function') switchClient(clientId);
    else if (typeof OL.switchClient === 'function') OL.switchClient(clientId);
};

// ---------------------------------------------------------------
// UNIFIED PILLS — one look, one click behavior, used everywhere a project
// name or a team member's name shows up as a small tag (task rows,
// resource cards, financials/time reports, blueprints, etc). Building the
// HTML in one place means every page that adopts these gets the same
// style automatically, and the "go to X" behavior only has to be right
// once.
// ---------------------------------------------------------------

// clientId + display name -> a clickable pill that jumps to that project's
// workspace. Falls back to a plain (non-clickable) pill if no clientId is
// resolvable, so callers don't have to branch themselves.
OL.renderProjectPill = function(clientId, name, opts = {}) {
    const label = esc(name || (clientId && state.clients?.[clientId]?.meta?.name) || 'Unknown Project');
    const extraClass = opts.extraClass ? ` ${opts.extraClass}` : '';
    if (!clientId) {
        return `<span class="pill tiny project-pill is-static${extraClass}">📁 ${label}</span>`;
    }
    const stop = opts.stopPropagation !== false ? "event.stopPropagation();" : "";
    return `<span class="pill tiny project-pill${extraClass}" onclick="${stop} OL.navigateToClientProject('${clientId}')" title="Jump to ${label}">📁 ${label}</span>`;
};

// name + the clientId whose roster it should resolve against -> a
// clickable pill that opens that person's card. Client team members open
// via the existing team-member modal; Sphynx team members currently have
// no card view to link to, so their pill renders as a plain (non-clickable)
// tag rather than silently going nowhere.
OL.renderTeamPill = function(name, clientId, opts = {}) {
    const label = esc(name || 'Unassigned');
    if (!name) return `<span class="pill tiny team-pill is-static"> ${label}</span>`;

    const client = clientId ? state.clients?.[clientId] : null;
    const member = client?.projectData?.teamMembers?.find(m => m.name === name);
    if (member) {
        const stop = opts.stopPropagation !== false ? "event.stopPropagation();" : "";
        return `<span class="pill tiny team-pill" onclick="${stop} OL.openTeamMemberModal('${member.id}')" title="Open ${label}'s card"> ${label}</span>`;
    }
    // Sphynx-side assignee (or unresolved name) — no card to open yet.
    return `<span class="pill tiny team-pill is-static"> ${label}</span>`;
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
    OL._activeModalTaskContext = null;
    // A popover opened from inside a modal (e.g. the notifications "Type"
    // filter) is appended directly to document.body, not nested inside
    // #modal-layer — closing the modal never touched it, so it could be
    // left orphaned and still visibly floating on screen after the modal
    // behind it was gone. That read as "click-off didn't close it" since
    // one click closed the modal but left the popover behind requiring a
    // second click. closePopoverDropdown() is a no-op if none is open.
    if (typeof OL.closePopoverDropdown === 'function') OL.closePopoverDropdown();
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
    OL._activeModalTaskContext = { clientId: client?.id, taskId: task.id };
    const is3rdParty = (OL.thirdPartyAssignees || []).includes(task.assignee);
    const isClientAssigned = task.assignee !== 'Sphynx Task' && !is3rdParty;

    // Ensure driveFiles array exists (with fallback to legacy single driveFileUrl if present)
    const attachedFiles = task.driveFiles || (task.driveFileUrl ? [{ name: task.driveFileName || 'Attached Drive File', url: task.driveFileUrl }] : []);

    const content = `
        <div style="padding: 24px; max-width: 920px; width: 100%;" onclick="event.stopPropagation()">
            <div class="modal-header" style="display:flex; justify-content:space-between; align-items:center; border-bottom: 1px solid var(--line); padding-bottom: 14px; margin-bottom: 20px;">
                <div style="display:flex; align-items:center; gap:10px; flex:1; min-width:0;">
                    <i data-lucide="check-square" style="width:22px;height:22px;color:var(--accent); flex-shrink:0;"></i>
                    <input type="text" class="modal-input" id="task-title-input-${task.id}"
                           value="${esc(task.title || task.name || '')}"
                           style="font-size:18px; font-weight:bold; border:none; background:transparent; padding:2px 4px; width:100%;"
                           onblur="OL.updateTaskTitle('${client?.id}', '${task.id}', this.value)"
                           onkeydown="if(event.key==='Enter'){ this.blur(); }">
                </div>
                <div style="display:flex; align-items:center; gap:8px;">
                    <button class="btn tiny soft" onclick="OL.deleteTask('${client?.id}', '${task.id}')" style="color:#ef4444; font-weight:bold; display:flex; align-items:center; gap:4px;" title="Delete Task">
                        <i data-lucide="trash-2" style="width:14px;height:14px;"></i> Delete
                    </button>
                    <button class="btn tiny soft" onclick="OL.closeModal()" style="font-weight:bold; font-size:14px; flex-shrink:0;">✕</button>
                </div>
            </div>

            ${OL.renderTaskParentRequestBanner(client, task)}

            <div class="modal-body" style="display:grid; grid-template-columns: 1.6fr 1fr; gap:24px; align-items:start;">
                <div style="min-width:0;">
                    
                    <!-- REARRANGED HEADER TAGS -->
                    <div style="display:flex; flex-direction:column; gap:8px; margin-bottom: 20px;">
                        <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                            <span class="client-link-badge pill tiny soft" style="font-weight:600; display:inline-flex; align-items:center; gap:4px; cursor:pointer;"
                                  onclick="OL.closeModal(); OL.navigateToClientProject('${client?.id}')" title="Jump to Workspace">
                                <i data-lucide="folder" style="width:12px;height:12px; pointer-events:none;"></i> ${esc(client?.meta?.name || 'Workspace')}
                            </span>
                            <span class="pill tiny soft" style="font-weight:bold; cursor:pointer; display:inline-flex; align-items:center; gap:4px;"
                                  onclick="OL.openTaskParentPicker('${client?.id}', '${task.id}')">
                                <i data-lucide="pencil" style="width:10px;height:10px;"></i> Parent: ${OL.getTaskParentLabel(client, task)}
                            </span>
                        </div>

                        <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                            <span class="pill tiny accent" style="font-weight:bold; cursor:pointer; display:inline-flex; align-items:center; gap:4px;"
                                  onclick="OL.openEditTaskStatusQuickDropdown(event, '${client?.id}', '${task.id}')">
                                <i data-lucide="pencil" style="width:10px;height:10px;"></i> Status: ${esc(task.status || 'Pending Sphynx Action')}
                            </span>
                            <span class="pill tiny soft" style="font-weight:bold; cursor:pointer; display:inline-flex; align-items:center; gap:4px; color:${is3rdParty ? '#38bdf8' : (isClientAssigned ? '#fbbf24' : 'var(--accent)')}"
                                  onclick="OL.openEditTaskAssigneeDropdown(event, '${client?.id}', '${task.id}')">
                                <i data-lucide="pencil" style="width:10px;height:10px;"></i> Assignee: ${esc(task.assignee || 'Sphynx Task')}
                            </span>
                        </div>
                    </div>

                    <!-- CONVERT DELIVERABLE SECTION -->
                    <div style="margin-bottom: 20px; background: rgba(255,255,255,0.02); padding: 12px 14px; border-radius: 6px; border:1px solid var(--line); display:flex; flex-direction:column; gap:10px;">
                        <div>
                            <strong class="tiny muted uppercase" style="display:block;">Convert Deliverable:</strong>
                            <span class="tiny dim" style="display:block; margin-top:2px;">Transform this task into an SOP asset or request client input.</span>
                        </div>
                        <div style="display:flex; gap:8px;">
                            <button class="btn tiny soft" onclick="OL.convertTaskToResource('${client?.id}', '${task.id}')" style="display:inline-flex; align-items:center; gap:4px;">
                                <i data-lucide="workflow" style="width:11px;height:11px;color:var(--accent);"></i> To Resource
                            </button>
                            <button class="btn tiny soft" onclick="OL.convertTaskToRequirement('${client?.id}', '${task.id}')" style="display:inline-flex; align-items:center; gap:4px;">
                                <i data-lucide="help-circle" style="width:11px;height:11px;color:var(--accent);"></i> To Client Request
                            </button>
                        </div>
                    </div>

                    <!-- DELIVERABLE DETAILS, DESCRIPTION & MULTI-FILE DRIVE ATTACHMENTS -->
                    <div style="margin-bottom: 20px; background: rgba(255,255,255,0.02); padding: 14px; border-radius: 6px; border:1px solid var(--line);">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                            <label class="bold tiny uppercase muted" style="margin:0;">Deliverable Details & Description:</label>
                            
                            <!-- UPLOAD BUTTON (ALWAYS ACCEPTS NEW FILES) -->
                            <label class="btn tiny soft" style="cursor:pointer; display:inline-flex; align-items:left; gap:4px; font-size:10px;">
                                <i data-lucide="upload-cloud" style="width:11px;height:11px;color:var(--accent);"></i> Upload File to Drive
                                <input type="file" style="display:none;" onchange="
                                    const file = this.files[0];
                                    if (file) {
                                        OL.uploadFileToDrive('${client?.id}', file, 'Task Attachments').then(res => {
                                            if (res?.webViewLink) {
                                                OL.updateAndSync(() => {
                                                    const targetTask = state.clients['${client?.id}']?.projectData?.clientTasks?.find(t => t.id === '${task.id}');
                                                    if (targetTask) {
                                                        if (!targetTask.driveFiles) targetTask.driveFiles = [];
                                                        targetTask.driveFiles.push({ name: file.name, url: res.webViewLink });
                                                    }
                                                }, '${client?.id}');
                                                OL.openTaskInContext('${client?.id}', '${task.id}');
                                            }
                                        });
                                    }
                                ">
                            </label>
                        </div>
                        
                        <textarea class="modal-input tiny" id="task-desc-${task.id}" rows="4"
                                  style="width:100%; box-sizing:border-box; font-size:13px; line-height:1.5; resize:vertical; text-align:left;"
                                  placeholder="Add deliverable details / notes for this task..."
                                  onblur="OL.updateTaskDescription('${client?.id}', '${task.id}', this.value)">${esc(task.description || '')}</textarea>

                        <!-- LIST OF ALL ATTACHED DRIVE FILES -->
                        ${attachedFiles.length ? `
                            <div style="margin-top:10px; padding-top:10px; border-top:1px dashed var(--line); display:flex; flex-direction:column; gap:6px;">
                                <label class="bold tiny uppercase muted">Attached Drive Files (${attachedFiles.length}):</label>${attachedFiles.map((fileObj, fIdx) => `
                                    <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(0,0,0,0.15); padding:6px 10px; border-radius:4px;">
                                        <div style="display:flex; align-items:center; gap:6px; min-width:0; overflow:hidden;">
                                            <i data-lucide="file-text" style="width:13px;height:13px;color:var(--accent); flex-shrink:0;"></i>
                                            <span class="tiny bold" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(fileObj.name)}</span>
                                        </div>
                                        <a href="${esc(fileObj.url)}" target="_blank" rel="noopener noreferrer" class="btn tiny primary" style="display:inline-flex; align-items:center; gap:4px; text-decoration:none; flex-shrink:0; font-weight:bold;">
                                            <i data-lucide="external-link" style="width:11px;height:11px;"></i> Open in Drive
                                        </a>
                                    </div>
                                `).join('')}
                            </div>
                        ` : ''}
                    </div>

                    <div style="margin-bottom: 20px; background: rgba(255,255,255,0.02); padding: 14px; border-radius: 6px; border:1px solid var(--line);">
                        <label class="bold tiny uppercase muted" style="display:block; margin-bottom:8px;">
                            <i data-lucide="book-open" style="width:12px;height:12px;vertical-align:sub;"></i> Linked How-To Guides
                        </label>
                         ${(task.howToIds && task.howToIds.length) ? `
                            <div style="display:grid; gap:8px; margin-bottom:10px;">
                                ${task.howToIds.map(htId => {
                                    const guide = (state.master.howToLibrary || []).find(g => g.id === htId);
                                    if (!guide) return '';
                                    const textBlock = (guide.blocks || []).find(b => b.type === 'text');
                                    const preview = textBlock?.data?.html ? textBlock.data.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '';
                                    return `
                                        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px; padding:8px 10px; background:rgba(255,255,255,0.02); border:1px solid var(--line); border-radius:6px; cursor:pointer;" onclick="OL.openGuideEditor('${guide.id}')">
                                            <div style="min-width:0; overflow:hidden;">
                                                <strong class="tiny">${esc(guide.name)}</strong>
                                                ${preview ? `<div class="tiny muted" style="margin-top:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(preview.slice(0, 140))}</div>` : ''}
                                            </div>
                                            <button class="btn tiny soft" style="flex-shrink:0;" title="Unlink" onclick="event.stopPropagation(); OL.toggleTaskHowTo(event, '${task.id}', '${guide.id}', false, '${client?.id}');">✕</button>
                                        </div>
                                    `;
                                }).join('')}
                            </div>
                        ` : ''}
                        <input type="text" class="modal-input tiny" placeholder="Search guides to link..." oninput="OL.filterTaskHowToSearch('${task.id}', this.value, false, '${client?.id}')">
                        <div id="task-howto-results" style="max-height:140px; overflow:auto; margin-top:4px;"></div>
                    </div>

                    <div style="display:grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 20px; background:rgba(0,0,0,0.15); padding:14px; border-radius:6px; border:1px solid var(--line);" class="tiny">
                        <div style="cursor:pointer;" onclick="OL.openDueDateDropdown(event, '${client?.id}', '${task.id}')">
                            <strong class="muted">Due Date:</strong> ${task.dueDate ? new Date(task.dueDate).toLocaleDateString() : (task.dueRelativeTo ? 'Relative (see below)' : 'Unscheduled')}
                            <i data-lucide="pencil" style="width:10px;height:10px; opacity:0.5; margin-left:4px;"></i>
                        </div>
                        <div><strong class="muted">Total Logged Time:</strong> <span style="color:var(--accent); font-weight:bold;">${Number(task.loggedHours || 0).toFixed(1)}h</span></div>
                        <div><strong class="muted">Deliverable Category:</strong> ${esc(task.category || 'General')}</div>
                        <div><strong class="muted">Task ID:</strong> <span class="monospace">${esc(task.id)}</span></div>
                    </div>

                    ${task.timeAuditNote ? `
                        <div style="margin-bottom: 20px; padding:10px; background:rgba(251, 191, 36, 0.08); border:1px solid #fbbf24; border-radius:6px;" class="tiny">
                            <strong>📝 Retroactive Time Audit Note:</strong> ${esc(task.timeAuditNote)}
                        </div>
                    ` : ''}

                    <!-- LINKED EMAILS SECTION WITH ENFORCED CONSTRAINTS -->
                    <div style="margin-bottom: 20px; min-width: 0; width: 100%; overflow-x: hidden;">
                        <label class="bold tiny uppercase muted" style="display:block; margin-bottom:8px;">
                            <i data-lucide="mail" style="width:12px;height:12px;vertical-align:sub;"></i> Linked Emails
                        </label>
                        <div id="linked-emails-list" class="tiny muted" style="min-width:0; width:100%; box-sizing:border-box; overflow-x:hidden;">Loading…</div>
                    </div>

                    <div style="display:flex; justify-content:space-between; align-items:center; margin-top:20px; border-top:1px solid var(--line); padding-top:16px;">
                        <button class="btn tiny soft" onclick="OL.openEditTaskTimeModal('${client?.id}', '${task.id}')" style="display:inline-flex; align-items:center; gap:6px;">
                            <i data-lucide="pencil" style="width:12px;height:12px;"></i> Adjust Logged Time
                        </button>
                        <button class="btn primary tiny" onclick="OL.closeModal()" style="font-weight:bold;">Close Window</button>
                    </div>
                </div>

                <div id="task-comments-sidebar-${task.id}" style="border-left:1px solid var(--line); padding-left:20px; min-width:0;">
                    ${OL.renderTaskCommentsSidebarHTML(client, task)}
                </div>
            </div>
        </div>
    `;

    OL.showOverlayModal(content);
    OL.loadLinkedEmailsForTask(task.id);
    if (window.lucide) lucide.createIcons();
};

// -------------------------------------------------------------
// COMMENTS SIDEBAR — internal comments (task.comments, stored with the
// task) merged with any imported ClickUp comments (task.clickupComments,
// read-only, kept separate from the source data). Newest first.
// -------------------------------------------------------------
OL.renderTaskCommentsSidebarHTML = function(client, task) {
    const internal = (task.comments || []).map(c => ({ ...c, _source: 'internal' }));
    const imported = (task.clickupComments || []).map(c => ({ ...c, _source: 'clickup' }));
    const all = [...internal, ...imported].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

    let parentLinkHTML = '';
    if (task.parentResourceId) {
        const res = client?.projectData?.localResources?.find(r => r.id === task.parentResourceId);
        if (res) {
            parentLinkHTML = `<div class="tiny muted" style="margin-bottom:8px; cursor:pointer;" onclick="OL.closeModal(); OL.openResourceModal('${res.id}')"><i data-lucide="corner-left-up" style="width:10px;height:10px;vertical-align:sub;"></i> Part of resource <strong>${esc(res.name)}</strong> — comments here also show on its thread</div>`;
        }
    } else if (task.parentEventId) {
        const evt = OL._taskParentEventCache?.[task.parentEventId];
        parentLinkHTML = `<div class="tiny muted" style="margin-bottom:8px; cursor:pointer;" onclick="OL.closeModal(); OL.openCalendarEventModal('${task.parentEventId}')"><i data-lucide="corner-left-up" style="width:10px;height:10px;vertical-align:sub;"></i> Part of event <strong>${esc(evt ? evt.title : 'event')}</strong> — comments here also show on its thread</div>`;
        if (task.meetingSummaryEventId) {
            parentLinkHTML += `<button class="btn tiny primary" style="margin-bottom:8px;" onclick="OL.closeModal(); OL.openMeetingSummaryEmail('${task.meetingSummaryEventId}')">✉️ Prepare summary email</button>`;
        }
    }

    if (task.requestLineItemId && typeof OL.renderRequestTagHTML === 'function') {
        parentLinkHTML += `<div style="margin-bottom:8px;">${OL.renderRequestTagHTML({ ...task, clientId: client?.id || task.clientId })}</div>`;
        if (typeof OL.taskPhaseSelectHtml === 'function') parentLinkHTML += OL.taskPhaseSelectHtml(client, task);
    }

    if (task.reviewNotifyKey) {
        parentLinkHTML += `<button class="btn tiny primary" style="margin-bottom:8px;" onclick="OL.closeModal(); OL.openReviewNotification('${task.reviewNotifyKey}', '${client?.id || ''}')">📨 Open the notification</button>`;
    }

    if (task.testRunId) {
        parentLinkHTML += `<button class="btn tiny primary" style="margin-bottom:8px;" onclick="OL.closeModal(); OL.openTestRun('${task.testRunId}', '${client?.id || ''}')">🧪 Open checklist</button>`;
    }

    return `
        <label class="bold tiny uppercase muted" style="display:block; margin-bottom:8px;">
            <i data-lucide="message-square" style="width:12px;height:12px;vertical-align:sub;"></i> Comments
        </label>
        ${parentLinkHTML}

        <div style="display:flex; flex-direction:column; gap:0; margin-bottom:12px; position:relative;">
            <div class="tiny muted" style="margin-bottom:6px;">Posting as <strong>${esc(OL.getCurrentUserName ? OL.getCurrentUserName() : 'Sphynx Team')}</strong></div>
            
            <!-- Toolbar -->
            <div style="display:flex; align-items:center; gap:2px; background:rgba(0,0,0,0.2); padding:4px 6px; border:1px solid var(--line); border-bottom:none; border-radius:6px 6px 0 0;">
                <button type="button" class="btn tiny soft" style="padding:2px 6px; font-weight:bold;" title="Bold" onmousedown="event.preventDefault()" onclick="OL.execCommentCommand('bold')">B</button>
                <button type="button" class="btn tiny soft" style="padding:2px 6px; font-style:italic;" title="Italic" onmousedown="event.preventDefault()" onclick="OL.execCommentCommand('italic')">I</button>
                <button type="button" class="btn tiny soft" style="padding:2px 6px;" title="Bullet List" onmousedown="event.preventDefault()" onclick="OL.execCommentCommand('insertUnorderedList')">• List</button>
                <button type="button" class="btn tiny soft" style="padding:2px 6px;" title="Numbered List" onmousedown="event.preventDefault()" onclick="OL.execCommentCommand('insertOrderedList')">1. List</button>
                <button type="button" class="btn tiny soft" style="padding:2px 6px; display:inline-flex; align-items:center;" title="Insert Link" onmousedown="event.preventDefault()" onclick="OL.toggleInlineLinkPopover('${task.id}')">
                    <i data-lucide="link" style="width:12px;height:12px;"></i>
                </button>
            </div>

            <!-- Inline Link Input Popover -->
            <div id="inline-link-popover-${task.id}" style="display:none; padding:6px; background:var(--bg-card-header, #0f172a); border:1px solid var(--line); border-bottom:none; gap:6px; align-items:center;">
                <input type="url" id="inline-link-input-${task.id}" class="modal-input tiny" placeholder="Paste URL (e.g. https://...)" style="flex:1;" onkeydown="OL.handleInlineLinkKeydown(event, '${task.id}')">
                <button type="button" class="btn tiny primary" style="padding:2px 8px;" onclick="OL.applyInlineLink('${task.id}')">Apply</button>
                <button type="button" class="btn tiny soft" style="padding:2px 6px;" onclick="OL.hideInlineLinkPopover('${task.id}')">✕</button>
            </div>

            <!-- Editor Box -->
            <div id="task-comment-editor-${task.id}" 
                 contenteditable="true" 
                 class="modal-input tiny" 
                 style="min-height:70px; max-height:160px; overflow-y:auto; border-radius:0 0 6px 6px; 
                 background:var(--bg-card, #1e293b); padding:8px; line-height:1.4; text-align:left;"
                 placeholder="Add a comment... use @ to tag someone"
                 oninput="OL.handleCommentMentionInput(this, '${task.id}')"
                 onkeydown="OL.handleCommentMentionKeydown(event, '${task.id}')"></div>

            <div id="comment-mention-dropdown-${task.id}"></div>
            <button class="btn tiny primary" style="align-self:flex-end; margin-top:6px;" onclick="OL.addTaskComment('${client?.id}', '${task.id}')">
                <i data-lucide="send" style="width:12px;height:12px;"></i> Post
            </button>
        </div>

        <div style="display:grid; gap:8px; max-height:420px; overflow:auto;">
            ${all.length ? all.map(c => {
                const isEditing = OL._editingTaskCommentId === c.id;
                const isEditable = c._source === 'internal';

                if (isEditing) {
                    return `
                    <div style="background: rgba(255,255,255,0.02); padding:10px; border-radius:6px; border:1px solid var(--accent);">
                        <div class="tiny muted bold" style="margin-bottom:4px;">Editing comment</div>
                        <div id="task-comment-edit-editor-${c.id}" contenteditable="true" class="modal-input tiny"
                             style="min-height:60px; max-height:200px; overflow-y:auto; padding:6px; line-height:1.4; 
                             background:var(--bg-card, #1e293b); text-align:left;">${c.html || esc(c.text || '')}</div>
                        <div style="display:flex; justify-content:flex-end; gap:6px; margin-top:6px;">
                            <button class="btn tiny soft" onclick="OL.cancelEditTaskComment('${client?.id}', '${task.id}')">Cancel</button>
                            <button class="btn tiny primary" onclick="OL.saveEditedTaskComment('${client?.id}', '${task.id}', '${c.id}')">Save</button>
                        </div>
                    </div>
                    `;
                }

                const currentUserName = OL.getCurrentUserName ? OL.getCurrentUserName() : 'Sphynx Team';
                const isMentioned = (c.mentions || []).some(m => m.name === currentUserName);
                const alreadyViewed = (c.viewedBy || []).some(v => v.name === currentUserName);
                const viewedNames = (c.viewedBy || []).map(v => v.name);

                return `
                <div style="background: rgba(255,255,255,0.02); padding:10px; border-radius:6px; border:1px solid var(--line);">
                    <!-- COMMENT HEADER: Author on Line 1, Date & Actions on Line 2 -->
                    <div class="tiny muted bold" style="margin-bottom:6px;">
                        <div style="font-size:12px; color:var(--text-main, #f8fafc); font-weight:700;">
                            ${esc(c.author || 'Unknown')}${c._source === 'clickup' ? ' <span class="pill tiny soft" style="font-size:9px; margin-left:4px;">ClickUp</span>' : ''}${c.editedDate ? ' <span class="tiny muted" style="font-style:italic; font-weight:normal;">(edited)</span>' : ''}
                        </div>
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:2px; font-weight:normal; opacity:0.8;">
                            <span>${c.date ? esc(new Date(c.date).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })) : ''}</span>
                            ${isEditable ? `
                                <div style="display:flex; gap:4px; align-items:center;">
                                    <button class="btn tiny soft" style="padding:2px 4px;" title="Edit comment" onclick="OL.startEditTaskComment('${client?.id}', '${task.id}', '${c.id}')"><i data-lucide="pencil" style="width:10px;height:10px;"></i></button>
                                    <button class="btn tiny soft" style="padding:2px 4px; color:#ef4444;" title="Delete comment" onclick="OL.deleteTaskComment('${client?.id}', '${task.id}', '${c.id}')"><i data-lucide="trash-2" style="width:10px;height:10px;"></i></button>
                                </div>
                            ` : ''}
                        </div>
                    </div>
                    <div class="tiny" style="line-height:1.5; overflow-wrap:break-word;">${OL.renderCommentTextWithMentions(c.text, c.html)}</div>${isMentioned && !alreadyViewed ? `
                        <label class="tiny" style="display:flex; align-items:center; gap:5px; margin-top:6px; cursor:pointer; color:var(--accent);">
                            <input type="checkbox" onclick="OL.markTaskCommentViewed('${client?.id}', '${task.id}', '${c.id}')" style="cursor:pointer; margin:0;">
                            You were tagged — mark as viewed
                        </label>
                    ` : ''}
                    ${viewedNames.length ? `
                        <div class="tiny muted" style="margin-top:4px; font-style:italic;">${esc(viewedNames.join(', '))} ${viewedNames.length > 1 ? 'viewed' : 'viewed'} this comment</div>
                    ` : ''}
                </div>
                `;
            }).join('') : `<div class="tiny muted">No comments yet.</div>`}
        </div>
    `;
};

// Stores text selection range per task so prompt-less linking works reliably
OL._savedCommentSelections = {};

OL.toggleInlineLinkPopover = function(taskId) {
    const popover = document.getElementById(`inline-link-popover-${taskId}`);
    const input = document.getElementById(`inline-link-input-${taskId}`);
    const editor = document.getElementById(`task-comment-editor-${taskId}`);
    if (!popover || !input || !editor) return;

    if (popover.style.display === 'flex') {
        OL.hideInlineLinkPopover(taskId);
        return;
    }

    // Ensure editor maintains focus and clone the selection
    editor.focus();
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
        OL._savedCommentSelections[taskId] = selection.getRangeAt(0).cloneRange();
    }

    popover.style.display = 'flex';
    input.value = '';
    setTimeout(() => input.focus(), 50);
};

OL.hideInlineLinkPopover = function(taskId) {
    const popover = document.getElementById(`inline-link-popover-${taskId}`);
    if (popover) popover.style.display = 'none';
    delete OL._savedCommentSelections[taskId];
};

OL.handleInlineLinkKeydown = function(event, taskId) {
    // Stop event propagation so app.js global keydown listeners don't blur/close
    event.stopPropagation();

    if (event.key === 'Enter') {
        event.preventDefault();
        OL.applyInlineLink(taskId);
    } else if (event.key === 'Escape') {
        event.preventDefault();
        OL.hideInlineLinkPopover(taskId);
    }
};

OL.applyInlineLink = function(taskId) {
    const input = document.getElementById(`inline-link-input-${taskId}`);
    const editor = document.getElementById(`task-comment-editor-${taskId}`);
    if (!input || !editor) return;

    let url = input.value.trim();
    if (!url) {
        OL.hideInlineLinkPopover(taskId);
        return;
    }

    if (!/^https?:\/\//i.test(url)) {
        url = `https://${url}`;
    }

    editor.focus();
    const selection = window.getSelection();
    selection.removeAllRanges();

    const range = OL._savedCommentSelections[taskId];
    if (range) {
        selection.addRange(range);
    }

    // If text was selected, format it as a link.
    // If no text was selected, insert the raw URL as an anchor element.
    if (selection.toString().length > 0) {
        document.execCommand('createLink', false, url);
    } else {
        const a = document.createElement('a');
        a.href = url;
        a.textContent = url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        
        if (range) {
            range.insertNode(a);
        } else {
            editor.appendChild(a);
        }
    }

    OL.hideInlineLinkPopover(taskId);
};

// -------------------------------------------------------------
// @MENTIONS — tag a Sphynx team member in a comment. Typing "@" opens a
// small dropdown of roster names filtered as you keep typing; picking one
// (click or Enter/Tab) inserts "@Full Name " at the cursor. On post, the
// final text is scanned against the roster to record structured mentions
// (comment.mentions = [{id, name}]) — that's what the dashboard and Task
// Manager use to surface "tasks where you were tagged" and what renders
// the highlighted @Name styling in the comment thread.
// -------------------------------------------------------------
OL.getMentionRoster = function() {
    return (state.master?.sphynxTeam || []).map(m => ({ id: m.id, name: m.name })).filter(m => m.name);
};

// Finds an in-progress "@partial" right before the cursor, if any.
OL._findMentionQuery = function(text, caretPos) {
    const upToCaret = text.slice(0, caretPos);
    const at = upToCaret.lastIndexOf('@');
    if (at === -1) return null;
    const between = upToCaret.slice(at + 1);
    if (/[\n@]/.test(between)) return null; // a newline or another @ closes the mention attempt
    if (between.length > 40) return null; // way too long to still be a name — give up
    return { start: at, query: between.toLowerCase() };
};

// The comment box is a contenteditable div, not a <textarea> — it has no
// .value/.selectionStart. These two helpers do the equivalent character-
// offset math against element.textContent using the Selection/Range APIs.
OL._getCaretOffset = function(element) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return 0;
    const range = sel.getRangeAt(0);
    if (!element.contains(range.startContainer)) return 0;
    const preRange = range.cloneRange();
    preRange.selectNodeContents(element);
    preRange.setEnd(range.endContainer, range.endOffset);
    return preRange.toString().length;
};

OL._setCaretOffset = function(element, offset) {
    const range = document.createRange();
    const sel = window.getSelection();
    let remaining = offset;
    let node = null;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null);
    while (walker.nextNode()) {
        const len = walker.currentNode.length;
        if (remaining <= len) { node = walker.currentNode; break; }
        remaining -= len;
    }
    if (node) {
        range.setStart(node, remaining);
    } else {
        range.selectNodeContents(element);
        range.collapse(false);
    }
    if (node) range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    return range;
};

// Positioned with `position:fixed` from the editor's live screen rect rather
// than CSS `position:absolute`, because absolute positioning here nests
// inside .modal-body / .modal-box, both of which set overflow-y:auto /
// overflow:hidden — the list was getting silently clipped by that scroll
// box any time it had less than ~160px of room above the editor. `fixed`
// escapes that clipping entirely. It's re-anchored on every keystroke (via
// this function) and closed on modal scroll/resize so it never drifts from
// the editor it belongs to.
OL.handleCommentMentionInput = function(editor, taskId) {
    const dropdown = document.getElementById(`comment-mention-dropdown-${taskId}`);
    if (!dropdown) return;

    const match = OL._findMentionQuery(editor.textContent || '', OL._getCaretOffset(editor));
    if (!match) { dropdown.innerHTML = ''; OL._teardownMentionDropdownReposition(taskId); return; }

    const roster = OL.getMentionRoster().filter(m => m.name.toLowerCase().includes(match.query));
    if (!roster.length) { dropdown.innerHTML = ''; OL._teardownMentionDropdownReposition(taskId); return; }

    const rect = editor.getBoundingClientRect();

    dropdown.innerHTML = `
        <div style="position:fixed; z-index:2000; left:${rect.left}px; width:${rect.width}px; bottom:${window.innerHeight - rect.top + 4}px; background:var(--bg-card, #1e293b); border:1px solid var(--line); border-radius:6px; box-shadow:0 10px 25px -5px rgba(0,0,0,0.5); max-height:160px; overflow:auto;">
            ${roster.map((m, i) => `
                <div class="tiny mention-suggestion" data-idx="${i}"
                     style="padding:7px 10px; cursor:pointer; ${i === 0 ? 'background:rgba(var(--accent-rgb),0.12);' : ''}"
                     onmousedown="event.preventDefault(); OL.insertMention('${taskId}', '${esc(m.name)}', ${match.start})">
                    ${esc(m.name)}
                </div>
            `).join('')}
        </div>
    `;

    OL._setupMentionDropdownReposition(taskId, editor);
};

// Keeps the fixed-position dropdown glued to the editor while its scroll
// ancestor (.modal-body) scrolls, and closes it if the editor scrolls out
// of view or the window resizes. One listener pair per task, replaced
// (not stacked) on every call.
OL._setupMentionDropdownReposition = function(taskId, editor) {
    OL._teardownMentionDropdownReposition(taskId);
    const reposition = () => {
        const dropdown = document.getElementById(`comment-mention-dropdown-${taskId}`);
        const box = dropdown && dropdown.firstElementChild;
        if (!dropdown || !box || !document.body.contains(editor)) {
            OL._teardownMentionDropdownReposition(taskId);
            return;
        }
        const rect = editor.getBoundingClientRect();
        const modalBody = editor.closest('.modal-body');
        const modalRect = modalBody ? modalBody.getBoundingClientRect() : null;
        if (modalRect && (rect.bottom < modalRect.top || rect.top > modalRect.bottom)) {
            dropdown.innerHTML = '';
            OL._teardownMentionDropdownReposition(taskId);
            return;
        }
        box.style.left = rect.left + 'px';
        box.style.width = rect.width + 'px';
        box.style.bottom = (window.innerHeight - rect.top + 4) + 'px';
    };
    OL._mentionRepositionHandlers = OL._mentionRepositionHandlers || {};
    OL._mentionRepositionHandlers[taskId] = reposition;
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition, true);
};

OL._teardownMentionDropdownReposition = function(taskId) {
    const handlers = OL._mentionRepositionHandlers;
    if (!handlers || !handlers[taskId]) return;
    window.removeEventListener('scroll', handlers[taskId], true);
    window.removeEventListener('resize', handlers[taskId], true);
    delete handlers[taskId];
};

OL.handleCommentMentionKeydown = function(event, taskId) {
    const dropdown = document.getElementById(`comment-mention-dropdown-${taskId}`);
    if (!dropdown || !dropdown.innerHTML.trim()) return;

    if (event.key === 'Escape') {
        dropdown.innerHTML = '';
        OL._teardownMentionDropdownReposition(taskId);
        return;
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
        const first = dropdown.querySelector('.mention-suggestion');
        if (first) {
            event.preventDefault();
            first.dispatchEvent(new Event('mousedown'));
        }
    }
};

OL.insertMention = function(taskId, name, atPosition) {
    const editor = document.getElementById(`task-comment-editor-${taskId}`);
    const dropdown = document.getElementById(`comment-mention-dropdown-${taskId}`);
    if (!editor) return;

    editor.focus();
    const caret = OL._getCaretOffset(editor);

    // Build a Range spanning the typed "@partial" text (atPosition..caret)
    // by placing the caret at each boundary and reading back where the
    // Selection API actually put it.
    const startRange = OL._setCaretOffset(editor, atPosition);
    const startContainer = startRange.startContainer, startOffset = startRange.startOffset;
    const endRange = OL._setCaretOffset(editor, caret);

    const replaceRange = document.createRange();
    replaceRange.setStart(startContainer, startOffset);
    replaceRange.setEnd(endRange.startContainer, endRange.startOffset);
    replaceRange.deleteContents();

    const insertion = document.createTextNode(`@${name} `);
    replaceRange.insertNode(insertion);

    const caretRange = document.createRange();
    caretRange.setStartAfter(insertion);
    caretRange.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(caretRange);

    if (dropdown) dropdown.innerHTML = '';
    OL._teardownMentionDropdownReposition(taskId);
};

// Wires the Bold/Italic/List/Link toolbar buttons to the comment editor.
// Buttons use onmousedown="event.preventDefault()" so clicking them doesn't
// blur the contenteditable div first (which would collapse the selection
// execCommand needs to act on).
OL.execCommentCommand = function(command) {
    if (command === 'createLink') {
        // 1. Save current selection before prompt() takes focus away
        const selection = window.getSelection();
        if (!selection.rangeCount) return;
        const range = selection.getRangeAt(0);

        const url = prompt('Link URL:');
        if (!url) return;

        // 2. Restore the saved selection
        selection.removeAllRanges();
        selection.addRange(range);

        // 3. Format link with protocol fallback
        const formattedUrl = url.match(/^https?:\/\//i) ? url : `https://${url}`;
        document.execCommand('createLink', false, formattedUrl);
        return;
    }
    document.execCommand(command, false, null);
};

// Strips a comment editor's HTML down to a small safe allowlist before it
// gets stored/rendered for other people. Unwraps (keeps the text/children
// of, but discards the tag itself) anything not on the list, and strips
// every attribute except a validated href on <a> — this is what lets the
// Bold/Italic/List/Link toolbar's output persist without also letting a
// paste from somewhere else smuggle in a <script>, an onerror handler, or
// a javascript: link.
OL._ALLOWED_COMMENT_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'UL', 'OL', 'LI', 'BR', 'A', 'DIV', 'SPAN', 'P']);
OL.sanitizeCommentHtml = function(html) {
    const container = document.createElement('div');
    container.innerHTML = html || '';

    const walk = (node) => {
        Array.from(node.childNodes).forEach((child) => {
            if (child.nodeType === 1) { // element
                if (!OL._ALLOWED_COMMENT_TAGS.has(child.tagName)) {
                    // Unwrap: keep its contents, drop the tag itself
                    while (child.firstChild) node.insertBefore(child.firstChild, child);
                    node.removeChild(child);
                    return;
                }
                Array.from(child.attributes).forEach((attr) => {
                    if (child.tagName === 'A' && attr.name === 'href') {
                        const val = attr.value.trim();
                        if (/^\s*(javascript|data|vbscript):/i.test(val)) {
                            child.removeAttribute('href');
                        } else {
                            child.setAttribute('target', '_blank');
                            child.setAttribute('rel', 'noopener noreferrer');
                        }
                    } else if (attr.name !== 'href') {
                        child.removeAttribute(attr.name);
                    }
                });
                walk(child);
            } else if (child.nodeType !== 3) { // not an element, not plain text (comments, etc.)
                node.removeChild(child);
            }
        });
    };
    walk(container);
    return container.innerHTML;
};

// Wraps every "@Name" match with a highlighted span, operating on actual
// DOM text nodes (not a regex over the raw HTML string) so it can't
// corrupt tag structure or match text sitting inside an attribute.
OL._highlightMentionsInHtml = function(html) {
    const roster = OL.getMentionRoster().sort((a, b) => b.name.length - a.name.length);
    if (!roster.length) return html;
    const pattern = roster.map(m => `@${m.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).join('|');
    if (!pattern) return html;
    const re = new RegExp(`(${pattern})`, 'g');

    const container = document.createElement('div');
    container.innerHTML = html || '';

    const walk = (node) => {
        Array.from(node.childNodes).forEach((child) => {
            if (child.nodeType === 3) { // text node
                const parts = child.textContent.split(re);
                if (parts.length <= 1) return;
                const frag = document.createDocumentFragment();
                parts.forEach((part) => {
                    if (roster.some(m => part === `@${m.name}`)) {
                        const span = document.createElement('span');
                        span.className = 'pill tiny accent';
                        span.style.cssText = 'padding:1px 6px; font-weight:bold;';
                        span.textContent = part;
                        frag.appendChild(span);
                    } else if (part) {
                        frag.appendChild(document.createTextNode(part));
                    }
                });
                node.replaceChild(frag, child);
            } else if (child.nodeType === 1) {
                walk(child);
            }
        });
    };
    walk(container);
    return container.innerHTML;
};

// Scans final comment text for "@Full Name" against the roster. Longest
// names are matched first so "@Karen Smith" doesn't get short-matched as
// just "@Karen" when both exist.
OL.extractMentions = function(text) {
    const roster = OL.getMentionRoster().sort((a, b) => b.name.length - a.name.length);
    const found = [];
    roster.forEach(m => {
        const needle = `@${m.name}`;
        if (text.toLowerCase().includes(needle.toLowerCase()) && !found.some(f => f.id === m.id)) {
            found.push({ id: m.id, name: m.name });
        }
    });
    return found;
};

// Renders comment text with "@Name" spans highlighted. If the comment has
// a saved `html` (the rich-text version from the toolbar), that's rendered
// — already sanitized at save time, but re-sanitized here too as
// defense-in-depth against any old row that predates that check. Comments
// that only have plain `text` (either posted before rich text was
// supported, or from an external source like ClickUp) fall back to
// escaping it and turning line breaks into real <br> tags — the escaped
// text alone would just collapse every line break to a single space in
// HTML, which is why multi-line comments looked like line breaks weren't
// being saved even though they were.
OL.renderCommentTextWithMentions = function(text, html) {
    if (html) {
        return OL._highlightMentionsInHtml(OL.sanitizeCommentHtml(html));
    }

    const raw = text || '';
    const roster = OL.getMentionRoster().sort((a, b) => b.name.length - a.name.length);
    const withBreaks = (s) => esc(s).replace(/\n/g, '<br>');
    if (!roster.length) return withBreaks(raw);

    const pattern = roster.map(m => `@${m.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).join('|');
    if (!pattern) return withBreaks(raw);

    const re = new RegExp(`(${pattern})`, 'g');
    return raw.split(re).map(part =>
        roster.some(m => part === `@${m.name}`)
            ? `<span class="pill tiny accent" style="padding:1px 6px; font-weight:bold;">${esc(part)}</span>`
            : withBreaks(part)
    ).join('');
};

// -------------------------------------------------------------
// PARENT LINKING — most tasks should hang off a Resource or a Calendar
// Event (personal/internal events are the exception). This just supports
// setting that link; nothing enforces it. A task's own comments roll up
// into its parent's merged comment thread at render time (read-only
// aggregation — see OL.getRolledUpResourceComments in
// features/resources-modal.js and the event modal in calendar.js), so
// nothing needs to be copied or kept in sync — the task remains the
// single source of truth for its own comments.
// -------------------------------------------------------------
// Prominent "Request (parent) > Task" banner at the top of the task
// detail modal — the small request-tag pill further down (next to the
// comment thread) still exists for that context, but on its own it read
// as a minor tag rather than the task's actual place in the hierarchy.
// This also lists sibling tasks under the same request, so you can see
// where this task sits among the request's other steps without leaving
// the modal.
OL.renderTaskParentRequestBanner = function(client, task) {
    const pd = client?.projectData;
    if (!pd || !task.requestLineItemId) return '';

    let item = null;
    for (const sheet of pd.scopingSheets || []) {
        item = (sheet?.lineItems || []).find(i => i && String(i.id) === String(task.requestLineItemId));
        if (item) break;
    }
    if (!item) return '';

    const resourceLookup = (id) => (pd.localResources || []).find(r => r.id === id) || (state.master?.resources || []).find(r => r.id === id) || null;
    const resource = item.resourceId ? resourceLookup(item.resourceId) : null;
    const title = (item.name && String(item.name).trim()) || resource?.name || 'Request';
    const requestType = item.requestType || 'build';
    const round = Math.max(parseInt(item.round, 10) || 1, 1);

    const siblingTasks = (pd.clientTasks || []).filter(t => t.requestLineItemId === task.requestLineItemId);
    const masterStatuses = OL.getSystemStatuses ? OL.getSystemStatuses() : [];
    const dotColorFor = (statusName) => (masterStatuses.find(s => s.name === statusName) || {}).color || '#94a3b8';

    return `
        <div style="margin:0 24px 0 24px; padding:12px 14px; background:rgba(100,198,162,0.06); border:1px solid rgba(100,198,162,0.25); border-radius:8px;">
            <div style="display:flex; align-items:center; gap:8px; cursor:pointer;" onclick="OL.openRequestFromTask('${esc(client?.id || '')}', '${esc(item.id)}')" title="Open this request on the scoping sheet">
                <i data-lucide="git-pull-request" style="width:14px;height:14px;color:#64c6a2; flex-shrink:0;"></i>
                <span class="tiny bold uppercase muted">Request (parent)</span>
                <span style="font-weight:700; color:#64c6a2;">${esc(title)}</span>
                <span class="pill tiny soft" style="font-size:9px;">${esc(requestType.charAt(0).toUpperCase() + requestType.slice(1))} · Round ${round}</span>
            </div>
            ${siblingTasks.length ? `
                <div style="margin-top:8px; padding-top:8px; border-top:1px solid rgba(100,198,162,0.2); display:grid; gap:4px;">
                    <span class="tiny muted uppercase bold" style="margin-bottom:2px;">Tasks under this request (${siblingTasks.length})</span>
                    ${siblingTasks.map(t => `
                        <div style="display:flex; align-items:center; gap:6px; padding:3px 4px; border-radius:4px; cursor:pointer; ${String(t.id) === String(task.id) ? 'background:rgba(100,198,162,0.12);' : ''}"
                             onclick="event.stopPropagation(); ${String(t.id) === String(task.id) ? '' : `OL.openTaskInContext('${esc(client?.id || '')}', '${esc(t.id)}')`}">
                            <span style="width:8px; height:8px; border-radius:50%; background:${dotColorFor(t.status)}; flex-shrink:0;"></span>
                            <span class="tiny" style="${String(t.id) === String(task.id) ? 'font-weight:700;' : ''}">${esc(t.title || t.name)}</span>
                            ${String(t.id) === String(task.id) ? '<span class="tiny muted">(this task)</span>' : ''}
                        </div>
                    `).join('')}
                </div>
            ` : ''}
        </div>
    `;
};

OL.getTaskParentLabel = function(client, task) {
    if (task.parentResourceId) {
        const res = client?.projectData?.localResources?.find(r => r.id === task.parentResourceId);
        return esc(res ? res.name : 'Resource');
    }
    if (task.parentEventId) {
        const evt = OL._taskParentEventCache?.[task.parentEventId];
        return esc(evt ? evt.title : 'Event');
    }
    return 'None';
};

OL.openTaskParentPicker = async function(clientId, taskId) {
    const client = state.clients?.[clientId];
    const task = client?.projectData?.clientTasks?.find(t => t.id === taskId);
    if (!client || !task) return;

    // Fetch this project's events fresh each time the picker opens — cheap,
    // and keeps the list current without a standing subscription.
    const { data: events } = await db.from('calendar_events')
        .select('id, title, start')
        .eq('linked_client_id', clientId)
        .order('start', { ascending: false })
        .limit(100);

    OL._taskParentEventCache = OL._taskParentEventCache || {};
    (events || []).forEach(e => { OL._taskParentEventCache[e.id] = e; });

    OL._taskParentPickerState = { clientId, taskId, query: '', events: events || [] };
    OL.renderTaskParentPickerStep();
};

OL.renderTaskParentPickerStep = function() {
    const st = OL._taskParentPickerState;
    if (!st) return;
    const client = state.clients?.[st.clientId];
    const task = client?.projectData?.clientTasks?.find(t => t.id === st.taskId);
    if (!client || !task) return;

    const query = (st.query || '').trim().toLowerCase();
    const resources = (client.projectData?.localResources || []).filter(r => (r.name || '').toLowerCase().includes(query));
    const events = (st.events || []).filter(e => (e.title || '').toLowerCase().includes(query));

    const content = `
        <div style="padding: 20px; max-width: 420px; width: 100%;" onclick="event.stopPropagation()">
            <div class="modal-header" style="display:flex; justify-content:space-between; align-items:center; border-bottom: 1px solid var(--line); padding-bottom: 10px; margin-bottom: 14px;">
                <h3 style="margin:0; font-size:15px;">Set Parent</h3>
                <button class="btn tiny soft" onclick="OL.closeModal(); OL.openTaskInContext('${st.clientId}', '${st.taskId}')">✕</button>
            </div>
            <input type="text" class="modal-input tiny" placeholder="Search resources or events..." value="${esc(st.query)}" style="width:100%; margin-bottom:10px;"
                   oninput="const v=this.value; OL.reRenderPreservingFocus(() => { OL._taskParentPickerState.query = v; OL.renderTaskParentPickerStep(); })" id="task-parent-search">
            <button class="btn tiny soft" style="width:100%; margin-bottom:10px;" onclick="OL.setTaskParent('${st.clientId}', '${st.taskId}', null, null)">None</button>
            <div class="tiny bold uppercase muted" style="margin-bottom:6px;">Resources</div>
            <div style="display:grid; gap:4px; max-height:140px; overflow:auto; margin-bottom:12px;">
                ${resources.length ? resources.map(r => `
                    <div class="tiny" style="padding:7px 10px; border:1px solid var(--line); border-radius:6px; cursor:pointer; ${task.parentResourceId === r.id ? 'border-color:var(--accent); background:rgba(var(--accent-rgb),0.08);' : ''}" onclick="OL.setTaskParent('${st.clientId}', '${st.taskId}', 'resource', '${r.id}')">${esc(r.name)}</div>
                `).join('') : `<div class="tiny muted">No resources.</div>`}
            </div>
            <div class="tiny bold uppercase muted" style="margin-bottom:6px;">Events</div>
            <div style="display:grid; gap:4px; max-height:140px; overflow:auto;">
                ${events.length ? events.map(e => `
                    <div class="tiny" style="padding:7px 10px; border:1px solid var(--line); border-radius:6px; cursor:pointer; ${task.parentEventId === e.id ? 'border-color:var(--accent); background:rgba(var(--accent-rgb),0.08);' : ''}" onclick="OL.setTaskParent('${st.clientId}', '${st.taskId}', 'event', '${e.id}')">${esc(e.title)} <span class="muted">${e.start ? new Date(e.start).toLocaleDateString() : ''}</span></div>
                `).join('') : `<div class="tiny muted">No events for this project yet.</div>`}
            </div>
        </div>
    `;
    OL.showOverlayModal(content);
    document.getElementById('task-parent-search')?.focus();
};

OL.setTaskParent = function(clientId, taskId, type, id) {
    updateAndSync(() => {
        const client = state.clients?.[clientId];
        const task = client?.projectData?.clientTasks?.find(t => t.id === taskId);
        if (!task) return;
        task.parentResourceId = type === 'resource' ? id : null;
        task.parentEventId = type === 'event' ? id : null;
    }, clientId);

    OL.closeModal();
    OL.openTaskInContext(clientId, taskId);
};

OL.updateTaskTitle = function(clientId, taskId, newTitle) {
    const trimmed = (newTitle || '').trim();
    if (!trimmed) return; // don't allow blanking the title out

    updateAndSync(() => {
        const client = state.clients?.[clientId];
        const task = client?.projectData?.clientTasks?.find(t =>
            String(t.id) === String(taskId) || String(t.key) === String(taskId)
        );
        if (task) {
            task.title = trimmed;
            task.name = trimmed;
        }
    }, clientId);

    OL.refreshTaskView();
};

OL.updateTaskDescription = function(clientId, taskId, newDescription) {
    updateAndSync(() => {
        const client = state.clients?.[clientId];
        const task = client?.projectData?.clientTasks?.find(t =>
            String(t.id) === String(taskId) || String(t.key) === String(taskId)
        );
        if (task) task.description = newDescription;
    }, clientId);
};

// Appends a structured entry to a task's activity log rather than into its
// description — anything that used to narrate itself into the description
// (guide links, etc.) should call this instead. Not yet wired into status/
// assignee/due-date changes; just the how-to guide linking for now.
OL.logTaskActivity = function(clientId, taskId, text) {
    updateAndSync(() => {
        const client = state.clients?.[clientId];
        const task = client?.projectData?.clientTasks?.find(t =>
            String(t.id) === String(taskId) || String(t.key) === String(taskId)
        );
        if (task) {
            if (!task.activityLog) task.activityLog = [];
            task.activityLog.push({
                text,
                user: OL.getCurrentUserName ? OL.getCurrentUserName() : 'Sphynx Team',
                ts: Date.now()
            });
        }
    }, clientId);
};

// -------------------------------------------------------------
// INLINE ROW TITLE EDIT — swaps the title cell (wherever it's rendered:
// master task manager, client workspace list, etc.) into a text input
// without opening the full task modal. Saves on blur/Enter via the same
// OL.updateTaskTitle used by the modal.
// -------------------------------------------------------------
OL.startInlineTaskTitleEdit = function(clientId, taskId) {
    const cell = document.getElementById(`task-title-display-${taskId}`);
    if (!cell) return;

    const client = state.clients?.[clientId];
    const task = client?.projectData?.clientTasks?.find(t =>
        String(t.id) === String(taskId) || String(t.key) === String(taskId)
    );
    if (!task) return;

    cell.outerHTML = `
        <div class="task-title-cell" id="task-title-display-${taskId}" style="flex:1; min-width:0; max-width:100%;" onclick="event.stopPropagation();">
            <input type="text" id="task-title-inline-input-${taskId}" class="modal-input tiny"
                   value="${esc(task.title || task.name || '')}"
                   style="width:100%; box-sizing:border-box; font-weight:600; font-size:13px;"
                   onblur="OL.saveInlineTaskTitleEdit('${clientId}', '${taskId}')"
                   onkeydown="if(event.key==='Enter'){ this.blur(); } if(event.key==='Escape'){ OL.refreshTaskView(); }">
        </div>
    `;
    const input = document.getElementById(`task-title-inline-input-${taskId}`);
    if (input) { input.focus(); input.select(); }
};

OL.saveInlineTaskTitleEdit = function(clientId, taskId) {
    const input = document.getElementById(`task-title-inline-input-${taskId}`);
    if (!input) return;
    OL.updateTaskTitle(clientId, taskId, input.value);
};

OL.addTaskComment = function(clientId, taskId) {
    const editor = document.getElementById(`task-comment-editor-${taskId}`);
    const text = (editor?.innerText || '').trim();
    if (!text) return;
    // The toolbar above the editor (Bold/Italic/Lists/Link) runs
    // document.execCommand on this contenteditable, which produces real
    // HTML — but this used to only ever save `.innerText`, throwing all of
    // that formatting away on Post even though it displayed correctly
    // while typing. `html` now captures the sanitized rich version;
    // `text` stays as the plain-text fallback (also still used for mention
    // detection and search, and for rendering any comment posted before
    // this change, which only ever has `text`).
    const html = OL.sanitizeCommentHtml(editor.innerHTML);
    const author = (OL.getCurrentUserName ? OL.getCurrentUserName() : '') || 'Sphynx Team';
    const mentions = OL.extractMentions(text);

    updateAndSync(() => {
        const client = state.clients?.[clientId];
        const task = client?.projectData?.clientTasks?.find(t =>
            String(t.id) === String(taskId) || String(t.key) === String(taskId)
        );
        if (task) {
            if (!task.comments) task.comments = [];
            task.comments.push({ id: uid(), author, text, html, mentions, date: new Date().toISOString() });
        }
    }, clientId);

    // Notify anyone @mentioned (email only — in-app is computed on demand
    // from this same comment data, see features/notifications.js).
    if (typeof OL.notifyEvent === 'function') {
        const client = state.clients?.[clientId];
        const task = client?.projectData?.clientTasks?.find(t =>
            String(t.id) === String(taskId) || String(t.key) === String(taskId)
        );
        (mentions || []).forEach(m => {
            OL.notifyEvent('newComment', m.name, {
                subject: `${author} mentioned you on "${task?.title || task?.name || 'a task'}"`,
                body: text
            });
        });
    }

    if (editor) editor.innerHTML = '';

    const client = state.clients?.[clientId];
    const task = client?.projectData?.clientTasks?.find(t =>
        String(t.id) === String(taskId) || String(t.key) === String(taskId)
    );
    const sidebar = document.getElementById(`task-comments-sidebar-${taskId}`);
    if (sidebar && task) {
        sidebar.innerHTML = OL.renderTaskCommentsSidebarHTML(client, task);
        if (window.lucide) lucide.createIcons();
    }
};

OL.markTaskCommentViewed = function(clientId, taskId, commentId) {
    const currentUserName = OL.getCurrentUserName ? OL.getCurrentUserName() : 'Sphynx Team';

    updateAndSync(() => {
        const client = state.clients?.[clientId];
        const task = client?.projectData?.clientTasks?.find(t =>
            String(t.id) === String(taskId) || String(t.key) === String(taskId)
        );
        const comment = task?.comments?.find(c => c.id === commentId);
        if (comment) {
            if (!comment.viewedBy) comment.viewedBy = [];
            if (!comment.viewedBy.some(v => v.name === currentUserName)) {
                comment.viewedBy.push({ name: currentUserName, date: new Date().toISOString() });
            }
        }
    }, clientId);

    const client = state.clients?.[clientId];
    const task = client?.projectData?.clientTasks?.find(t => String(t.id) === String(taskId) || String(t.key) === String(taskId));
    const sidebar = document.getElementById(`task-comments-sidebar-${taskId}`);
    if (sidebar && task) {
        sidebar.innerHTML = OL.renderTaskCommentsSidebarHTML(client, task);
        if (window.lucide) lucide.createIcons();
    }
};

OL._editingTaskCommentId = null;

OL.startEditTaskComment = function(clientId, taskId, commentId) {
    OL._editingTaskCommentId = commentId;
    const client = state.clients?.[clientId];
    const task = client?.projectData?.clientTasks?.find(t => String(t.id) === String(taskId) || String(t.key) === String(taskId));
    const sidebar = document.getElementById(`task-comments-sidebar-${taskId}`);
    if (sidebar && task) {
        sidebar.innerHTML = OL.renderTaskCommentsSidebarHTML(client, task);
        if (window.lucide) lucide.createIcons();
        const editor = document.getElementById(`task-comment-edit-editor-${commentId}`);
        if (editor) { editor.focus(); document.execCommand && document.execCommand('selectAll', false, null); }
    }
};

OL.cancelEditTaskComment = function(clientId, taskId) {
    OL._editingTaskCommentId = null;
    const client = state.clients?.[clientId];
    const task = client?.projectData?.clientTasks?.find(t => String(t.id) === String(taskId) || String(t.key) === String(taskId));
    const sidebar = document.getElementById(`task-comments-sidebar-${taskId}`);
    if (sidebar && task) {
        sidebar.innerHTML = OL.renderTaskCommentsSidebarHTML(client, task);
        if (window.lucide) lucide.createIcons();
    }
};

OL.saveEditedTaskComment = function(clientId, taskId, commentId) {
    const editor = document.getElementById(`task-comment-edit-editor-${commentId}`);
    if (!editor) return;
    const text = (editor.innerText || '').trim();
    if (!text) { alert('Comment can\'t be empty — delete it instead if you want it gone.'); return; }
    const html = OL.sanitizeCommentHtml(editor.innerHTML);
    const mentions = OL.extractMentions(text);

    updateAndSync(() => {
        const client = state.clients?.[clientId];
        const task = client?.projectData?.clientTasks?.find(t =>
            String(t.id) === String(taskId) || String(t.key) === String(taskId)
        );
        const comment = task?.comments?.find(c => c.id === commentId);
        if (comment) {
            comment.text = text;
            comment.html = html;
            comment.mentions = mentions;
            comment.editedDate = new Date().toISOString();
        }
    }, clientId);

    OL._editingTaskCommentId = null;
    const client = state.clients?.[clientId];
    const task = client?.projectData?.clientTasks?.find(t => String(t.id) === String(taskId) || String(t.key) === String(taskId));
    const sidebar = document.getElementById(`task-comments-sidebar-${taskId}`);
    if (sidebar && task) {
        sidebar.innerHTML = OL.renderTaskCommentsSidebarHTML(client, task);
        if (window.lucide) lucide.createIcons();
    }
};

OL.deleteTaskComment = function(clientId, taskId, commentId) {
    if (!confirm('Delete this comment? This can\'t be undone.')) return;

    updateAndSync(() => {
        const client = state.clients?.[clientId];
        const task = client?.projectData?.clientTasks?.find(t =>
            String(t.id) === String(taskId) || String(t.key) === String(taskId)
        );
        if (task?.comments) {
            task.comments = task.comments.filter(c => c.id !== commentId);
        }
    }, clientId);

    const client = state.clients?.[clientId];
    const task = client?.projectData?.clientTasks?.find(t => String(t.id) === String(taskId) || String(t.key) === String(taskId));
    const sidebar = document.getElementById(`task-comments-sidebar-${taskId}`);
    if (sidebar && task) {
        sidebar.innerHTML = OL.renderTaskCommentsSidebarHTML(client, task);
        if (window.lucide) lucide.createIcons();
    }
};

OL._editingLinkedEmailNoteId = null;

OL.loadLinkedEmailsForTask = async function(taskId) {
    const container = document.getElementById('linked-emails-list');
    const { data, error } = await db
        .from('gmail_messages')
        .select('id, sender, subject, snippet, date, note, body')
        .eq('linked_task_id', taskId)
        .order('date', { ascending: false });

    if (!container) return; // modal already closed before this resolved

    if (error) {
        container.innerHTML = `<span style="color:#ef4444;">Failed to load linked emails.</span>`;
        return;
    }
    if (!data || !data.length) {
        container.innerHTML = `No emails linked yet — use the 🔗 icon on an email in Communications to link one here.`;
        return;
    }

    container.innerHTML = `
        <div style="display:grid; gap:6px; min-width:0; width:100%; box-sizing:border-box;">
            ${data.map(m => {
                const isEditing = OL._editingLinkedEmailNoteId === m.id;
                const displayText = m.note || m.body || m.snippet || '';

                return `
                <div style="padding:8px; background:rgba(255,255,255,0.02); border:1px solid var(--line); border-radius:6px; min-width:0; width:100%; box-sizing:border-box; overflow-x:hidden;">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px; cursor:pointer;" onclick="OL.openGmailMessageModal('${m.id}')" title="Open full email">
                        <div style="min-width:0; flex:1; overflow-wrap:anywhere; word-break:break-word;">
                            <strong style="display:block; overflow-wrap:anywhere; word-break:break-word;">${esc(m.subject || 'No Subject')}</strong>
                            <div class="muted" style="overflow-wrap:anywhere; word-break:break-word;">${esc(m.sender)}${m.date ? ` · ${new Date(m.date).toLocaleDateString()}` : ''}</div>
                        </div>
                        <i data-lucide="external-link" style="width:12px;height:12px; flex-shrink:0; margin-top:2px; color:var(--muted);"></i>
                    </div>
                    ${isEditing ? `
                        <div style="margin-top:6px; min-width:0; width:100%;" onclick="event.stopPropagation();">
                            <textarea id="linked-email-note-${m.id}" class="modal-input tiny" rows="4" style="width:100%; 
                            box-sizing:border-box; resize:vertical; text-align: left;">${esc(displayText)}</textarea>
                            <div style="display:flex; justify-content:flex-end; gap:6px; margin-top:4px;">
                                <button class="btn tiny soft" onclick="OL.cancelEditLinkedEmailNote('${taskId}')">Cancel</button>
                                <button class="btn tiny primary" onclick="OL.saveLinkedEmailNote('${taskId}', '${m.id}')">Save Note</button>
                            </div>
                        </div>
                    ` : (displayText ? `
                        <div style="margin-top:6px; padding-top:6px; border-top:1px dashed rgba(255,255,255,0.06); display:flex; justify-content:space-between; align-items:flex-start; gap:8px; min-width:0; width:100%;" onclick="event.stopPropagation();">
                            <div class="muted" style="white-space:pre-wrap; overflow-wrap:anywhere; word-break:break-word; line-height:1.4; flex:1; min-width:0;">${esc(displayText)}</div>
                            <button class="btn tiny soft" style="flex-shrink:0; padding:2px 5px;" title="Edit note" onclick="OL.startEditLinkedEmailNote('${taskId}', '${m.id}')"><i data-lucide="pencil" style="width:10px;height:10px;"></i></button>
                        </div>
                    ` : `
                        <div style="margin-top:6px; padding-top:6px; border-top:1px dashed rgba(255,255,255,0.06); display:flex; justify-content:flex-end;" onclick="event.stopPropagation();">
                            <button class="btn tiny soft" onclick="OL.startEditLinkedEmailNote('${taskId}', '${m.id}')"><i data-lucide="pencil" style="width:10px;height:10px;"></i> Add note</button>
                        </div>
                    `)}
                </div>
                `;
            }).join('')}
        </div>
    `;
    if (window.lucide) lucide.createIcons();
};

OL.startEditLinkedEmailNote = function(taskId, messageId) {
    OL._editingLinkedEmailNoteId = messageId;
    OL.loadLinkedEmailsForTask(taskId);
};

OL.cancelEditLinkedEmailNote = function(taskId) {
    OL._editingLinkedEmailNoteId = null;
    OL.loadLinkedEmailsForTask(taskId);
};

OL.saveLinkedEmailNote = async function(taskId, messageId) {
    const textarea = document.getElementById(`linked-email-note-${messageId}`);
    if (!textarea) return;
    const note = textarea.value; // intentionally allows saving back to empty — clearing it out is a valid edit

    const { error } = await db.from('gmail_messages').update({ note }).eq('id', messageId);
    if (error) { alert('Failed to save note: ' + error.message); return; }

    OL._editingLinkedEmailNoteId = null;
    OL.loadLinkedEmailsForTask(taskId);
};

// Converts a decimal-hours value (as stored on the task) to whole hours +
// minutes for display in H/M input pairs, and back again when saving.
OL.decimalHoursToHM = function(decimalHours) {
    const total = Math.max(0, Number(decimalHours) || 0);
    const h = Math.floor(total);
    const m = Math.round((total - h) * 60);
    // Rounding minutes up to 60 (e.g. 1.999h) should roll into the next hour
    return m >= 60 ? { h: h + 1, m: 0 } : { h, m };
};
OL.hmToDecimalHours = function(h, m) {
    return (Number(h) || 0) + (Number(m) || 0) / 60;
};

OL.openEditTaskTimeModal = function(clientId, taskId) {
    const client = state.clients?.[clientId];
    const task = client?.projectData?.clientTasks?.find(t => t.id === taskId || t.key === taskId);
    if (!task) return;

    const currentHours = Number(task.loggedHours || task.hoursLogged || 0);
    const { h: currentH, m: currentM } = OL.decimalHoursToHM(currentHours);

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
                        <label class="bold tiny uppercase muted" style="display:block; margin-bottom:5px;">Total Time Logged (this is the running total of every entry on this task):</label>
                        <div style="display:flex; gap:8px; align-items:center;">
                            <input type="number" step="1" min="0" id="edit-task-hours-h" class="modal-input" value="${currentH}" required style="width:100%;" placeholder="Hours">
                            <span class="tiny muted">h</span>
                            <input type="number" step="1" min="0" max="59" id="edit-task-hours-m" class="modal-input" value="${currentM}" required style="width:100%;" placeholder="Minutes">
                            <span class="tiny muted">m</span>
                        </div>
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
    const hoursPart = parseInt(document.getElementById('edit-task-hours-h')?.value, 10);
    const minsPart = parseInt(document.getElementById('edit-task-hours-m')?.value, 10);
    const noteVal = document.getElementById('edit-task-note')?.value;

    if (isNaN(hoursPart) || hoursPart < 0 || isNaN(minsPart) || minsPart < 0 || minsPart > 59) {
        alert("Please enter a valid number of hours and minutes (0-59).");
        return;
    }

    const hoursVal = OL.hmToDecimalHours(hoursPart, minsPart);

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

// A stable, always-findable "no specific client" home for tasks that
// don't belong to one project — created lazily on first use, then reused
// (never duplicated) since it's keyed by a fixed id rather than name match.
OL.GENERAL_PROJECT_ID = 'general-business-ops';

OL.ensureGeneralProject = function() {
    if (state.clients[OL.GENERAL_PROJECT_ID]) return state.clients[OL.GENERAL_PROJECT_ID];

    state.clients[OL.GENERAL_PROJECT_ID] = {
        id: OL.GENERAL_PROJECT_ID,
        publicToken: "access_" + Math.random().toString(36).slice(2, 12),
        meta: {
            name: "General / Business Ops",
            onboarded: new Date().toLocaleDateString(),
            status: "Active"
        },
        modules: {
            checklist: true, apps: false, functions: false, resources: false,
            scoping: false, analysis: false, "how-to": false, team: false, errors: true
        },
        permissions: {
            apps: "full", functions: "full", resources: "full", scoping: "full",
            checklist: "full", team: "full", "how-to": "full", analysis: "full"
        },
        projectData: {
            localApps: [], localFunctions: [], localAnalyses: [], localResources: [],
            localHowTo: [], scopingSheets: [{ id: "initial", lineItems: [] }],
            clientTasks: [], teamMembers: [], stages: [], workflows: []
        },
        sharedMasterIds: []
    };
    return state.clients[OL.GENERAL_PROJECT_ID];
};

OL.createGlobalQuickTask = function() {
    let clientId = document.getElementById('quick-task-client')?.value;
    const title = document.getElementById('quick-task-title')?.value;
    const assignee = document.getElementById('quick-task-assignee')?.value || 'Sphynx Task';
    const status = document.getElementById('quick-task-status')?.value || 'Pending Sphynx Action';
    const dueDate = document.getElementById('quick-task-duedate')?.value || '';

    if (!title) {
        alert("Please provide a task title.");
        return;
    }

    // No client picked — home it in the General / Business project instead
    // of forcing a pick. Created on first use, reused every time after.
    if (!clientId) clientId = OL.ensureGeneralProject().id;

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
            isClientTask: OL.computeIsClientTask(assignee),
            loggedHours: 0,
            createdAt: new Date().toISOString()
        };

        client.projectData.clientTasks.unshift(newTask);
    }, clientId);

    const inputTitle = document.getElementById('quick-task-title');
    if (inputTitle) inputTitle.value = '';

    OL.renderBusinessTaskManager();
};

// -------------------------------------------------------------
// "+ Request" — the Add button's alternative to "+ Task". A Request is a
// scoping-sheet line item (it needs a Resource, not just a title), so
// this can't reuse the quick-task form directly — it opens a small
// resource picker instead, scoped to whichever client is currently
// selected in that same form. Deliberately a self-contained copy of the
// core of features/scoping.js's addResourceToScope/executeScopeAdd rather
// than calling those directly: those operate on getActiveClient()
// (state.activeClientId) and finish by calling renderScopingSheet(), both
// of which assume you're already on that client's Scoping tab — calling
// them from here would either silently target the wrong client or blow
// away the Task Manager view they were called from. This version takes
// clientId explicitly and returns to the Task Manager when done.
// -------------------------------------------------------------
OL.openQuickRequestPicker = function() {
    const clientId = document.getElementById('quick-task-client')?.value;
    if (!clientId) {
        alert("Pick a client in the field above first — a Request is a scoping-sheet line item for one client, so it needs one selected (General/Business tasks don't have a scoping sheet).");
        return;
    }
    const client = state.clients[clientId];
    if (!client) return;

    const html = `
        <div class="modal-head">
            <div class="modal-title-text">🔎 Add Request — ${esc(client.meta?.name || clientId)}</div>
            <div class="spacer"></div>
            <button class="btn small soft" onclick="OL.closeModal()">Cancel</button>
        </div>
        <div class="modal-body">
            <div class="search-map-container">
                <input type="text" class="modal-input"
                       placeholder="Click to view library or search..."
                       onfocus="OL.filterQuickRequestResources('', '${clientId}')"
                       oninput="OL.filterQuickRequestResources(this.value, '${clientId}')"
                       autofocus>
                <div id="quick-request-search-results" class="search-results-overlay" style="margin-top:15px;"></div>
            </div>
        </div>
    `;
    openModal(html);
};

OL.filterQuickRequestResources = function(query, clientId) {
    const listEl = document.getElementById("quick-request-search-results");
    if (!listEl) return;

    const q = (query || "").toLowerCase().trim();
    const client = state.clients[clientId];
    const existingIds = (client?.projectData?.scopingSheets?.[0]?.lineItems || []).map(i => i.resourceId);

    const masterSource = (state.master.resources || []).map(r => ({ ...r, origin: 'Master' }));
    const localSource = (client?.projectData?.localResources || []).map(r => ({ ...r, origin: 'Local' }));
    const localMasterRefs = localSource.map(r => r.masterRefId);
    const filteredMaster = masterSource.filter(m => !localMasterRefs.includes(m.id));
    const combined = [...localSource, ...filteredMaster];

    const matches = combined.filter(res => res.name.toLowerCase().includes(q) && !existingIds.includes(res.id));
    const masterMatches = matches.filter(m => m.origin === 'Master').sort((a, b) => a.name.localeCompare(b.name));
    const localMatches = matches.filter(m => m.origin === 'Local').sort((a, b) => a.name.localeCompare(b.name));

    let html = "";
    if (localMatches.length > 0) {
        html += `<div class="search-group-header">📍 Available in Project</div>`;
        html += localMatches.map(res => `
            <div class="search-result-item" onmousedown="OL.executeQuickRequestAdd('${res.id}', '${clientId}')">
                <div style="display:flex; justify-content:space-between; align-items:center; width: 100%;">
                    <div style="display:flex; align-items:center; gap:8px;">
                        <span>🛠️</span>
                        <div>
                            <div style="font-size: 13px; font-weight: 500;">${esc(res.name)}</div>
                            <div class="tiny muted">${esc(res.type || "General")}</div>
                        </div>
                    </div>
                    <span class="pill tiny local">LOCAL</span>
                </div>
            </div>
        `).join('');
    }
    if (masterMatches.length > 0) {
        html += `<div class="search-group-header" style="margin-top:10px;">🏛️ Master Vault Standards</div>`;
        html += masterMatches.map(res => `
            <div class="search-result-item" onmousedown="OL.executeQuickRequestAdd('${res.id}', '${clientId}')">
                <div style="display:flex; justify-content:space-between; align-items:center; width: 100%;">
                    <div style="display:flex; align-items:center; gap:8px;">
                        <span>🛠️</span>
                        <div>
                            <div style="font-size: 13px; font-weight: 500;">${esc(res.name)}</div>
                            <div class="tiny muted">${esc(res.type || "General")}</div>
                        </div>
                    </div>
                    <span class="pill tiny vault">VAULT</span>
                </div>
            </div>
        `).join('');
    }
    if (matches.length === 0) {
        html = `<div class="search-result-item muted">No unlinked resources match "${esc(query)}"</div>`;
    }
    listEl.innerHTML = html;
};

OL.executeQuickRequestAdd = async function(resId, clientId) {
    const client = state.clients[clientId];
    if (!client) return;

    let finalResourceId = resId;
    if (resId.startsWith('res-vlt-')) {
        const template = state.master.resources.find(r => r.id === resId);
        if (template) {
            const existingLocal = (client.projectData.localResources || []).find(r => r.masterRefId === resId);
            if (existingLocal) {
                finalResourceId = existingLocal.id;
            } else {
                const newRes = JSON.parse(JSON.stringify(template));
                newRes.id = 'local-prj-' + Date.now() + Math.random().toString(36).substr(2, 5);
                newRes.masterRefId = resId;
                if (!client.projectData.localResources) client.projectData.localResources = [];
                client.projectData.localResources.push(newRes);
                finalResourceId = newRes.id;
            }
        }
    }

    const addedRes = (client.projectData.localResources || []).find(r => r.id === finalResourceId)
        || (state.master.resources || []).find(r => r.id === finalResourceId);
    const isEventType = String(addedRes?.type || '').toLowerCase() === 'event';

    const newItem = {
        id: 'li-' + Date.now(),
        resourceId: finalResourceId,
        status: "Do Now",
        responsibleParty: isEventType ? (client.meta?.name || "Client") : "Sphynx",
        round: 1,
        teamMode: "everyone",
        teamIds: [],
        data: {},
        manualHours: 0,
        dependencies: [],
    };

    if (!client.projectData.scopingSheets) client.projectData.scopingSheets = [{ id: 'initial', lineItems: [] }];
    client.projectData.scopingSheets[0].lineItems.push(newItem);

    await OL.persist();

    OL.closeModal();
    OL.renderBusinessTaskManager();
};
