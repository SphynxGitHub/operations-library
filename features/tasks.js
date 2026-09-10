//======================= FEATURES / TASKS =======================//
// Extracted from app.js "TASK CHECKLIST SECTION".
// Owns: the checklist/blueprint views (master + per-client), the task
// detail modal, comments, master task import, and task<->app /
// task<->assignee linking.

import { state, esc, uid, getActiveClient, persist, loadFullClient } from '../core/data.js';

export function renderChecklistModule(isVaultMode = false) {
    OL.registerView(renderChecklistModule);
    const container = document.getElementById("mainContent");
    const client = getActiveClient();
    const hash = window.location.hash;
    const isVault = isVaultMode || hash.startsWith('#/vault');

    // 🛡️ GUARD: Wait for full client data
    if (!isVault && (!client || !client.projectData)) {
        container.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;opacity:0.5;">
            <div style="text-align:center;">
                <div style="font-size:24px;margin-bottom:10px;">⏳</div>
                <div>Loading client data...</div>
            </div>
        </div>`;
        // Retry after full data loads
        OL.loadFullClient(client?.id).then(() => renderChecklistModule(isVaultMode));
        return;
    }
    
    if (!container || (!isVault && !client)) return;
    container.style.cssText = '';
    document.body.classList.remove('is-visualizer');

    const allTasks = isVault ? (state.master.taskBlueprints || []) : (client.projectData.clientTasks || []);
    const lineItems = client?.projectData?.scopingSheets?.[0]?.lineItems || [];
    const showCompleted = !!state.ui.showCompleted;

    // Filter logic: Always show Pending/In Progress/Blocked. Only show Done if toggled on.
    const visibleTasks = allTasks.filter(task => {
        // 1. Completion Filter
        if (!showCompleted && task.status === "Done") return false;
        if (isVaultMode) return true;

        // 2. Find if this task is a dependency of ANY resource
        // We scan all project resources to see if this task ID is in their dependencies
        const parentResource = (client.projectData.localResources || []).find(res => 
            (res.dependencies || []).some(dep => dep.id === task.id)
        );

        // 3. If it's NOT linked to a resource, show it (it's a standalone project task)
        if (!parentResource) return true;

        // 4. If it IS linked, check that resource's status in the Scoping Sheet
        const scopingItem = lineItems.find(li => String(li.resourceId) === String(parentResource.id));
        
        if (!scopingItem) return false; // Scoped out entirely

        const status = String(scopingItem.status || "").toLowerCase();
        const party = String(scopingItem.responsibleParty || "").toLowerCase();

        const isDoNow = status === 'do now';
        const isBillable = party === 'sphynx' || party === 'joint';

        return isDoNow && isBillable;
    });

    const completedCount = allTasks.filter(t => t.status === "Done").length;

    container.innerHTML = `
        <div class="section-header" style="display:flex; align-items:center; gap:12px;">
            <i data-lucide="${isVault ? 'shield-check' : 'clipboard-list'}" 
               style="width:28px; height:24px; color:var(--accent);"></i>
            
            <div style="flex: 1;">
                <h2 style="margin:0;">${isVault ? 'Master Tasks' : 'Project Checklist'}</h2>
                <div class="small muted">${visibleTasks.length} tasks visible</div>
            </div>
        
            <div class="header-actions">
                ${!isVault ? `
                    <button class="btn small ${showCompleted ? 'accent' : 'soft'}" onclick="OL.toggleCompletedTasks()">
                        <i data-lucide="${showCompleted ? 'eye-off' : 'eye'}" style="width:14px; height:14px; margin-right:6px;"></i>
                        ${showCompleted ? 'Hide' : 'Show'} Completed (${completedCount})
                    </button>
                ` : ''}
                <button class="btn small soft" onclick="${isVault ? 'OL.promptCreateMasterTask()' : `OL.openAddTaskModal('${client.id}')`}">
                    <i data-lucide="plus" style="width:14px; height:14px; margin-right:6px;"></i>
                    Create Task
                </button>
                <button class="btn primary" onclick="OL.openMasterTaskImporter()">
                    <i data-lucide="download-cloud" style="width:14px; height:14px; margin-right:6px;"></i>
                    Import from Master
                </button>
            </div>
        </div>

        <div class="task-single-column">
            <div id="active-tasks-list">
                ${renderTaskList(client?.id, visibleTasks, isVault)}
            </div>
        </div>
    `;
    if (window.lucide) {
        window.lucide.createIcons();
    }
};

export function renderBlueprintManager() {
    const container = document.getElementById("mainContent");
    const blueprints = state.master.taskBlueprints || [];

    container.innerHTML = `
        <div class="section-header" style="display:flex; align-items:center; gap:12px;">
            <i data-lucide="copy" style="width:28px; height:24px; color:var(--accent);"></i>
            <div style="flex: 1;">
                <h2 style="margin:0;">Master Task Blueprints</h2>
                <div class="small muted">Standard implementation steps</div>
            </div>
            <button class="btn primary" onclick="OL.promptCreateMasterTask()">
                <i data-lucide="plus" style="width:14px; height:14px; margin-right:6px;"></i>
                New Blueprint
            </button>
        </div>

        <div class="cards-grid">
            ${blueprints.map((task) => `
                <div class="card is-clickable" onclick="OL.openTaskModal('${task.id}', true)">
                    <div class="card-header">
                        <div class="card-title">${esc(task.title)}</div>
                        <div style="display:flex; align-items:center; gap:8px;">
                            <button class="card-delete-btn" onclick="event.stopPropagation(); OL.removeMasterTask('${task.id}')">
                                <i data-lucide="x" style="width:14px; height:14px;"></i>
                            </button>
                        </div>
                    </div>
                    <div class="card-body">
                        <div class="tiny muted" style="margin-bottom: 8px;">${esc(task.category || 'General')}</div>
                        <div class="pills-row">
                             ${(task.appIds || []).length > 0 ? `
                                <span class="pill tiny soft" style="display:flex; align-items:center; gap:4px;">
                                    <i data-lucide="layout-grid" style="width:10px; height:10px;"></i>
                                    ${(task.appIds || []).length} Tools
                                </span>` : ''}
                             ${(task.howToIds || []).length > 0 ? `
                                <span class="pill tiny soft" style="display:flex; align-items:center; gap:4px;">
                                    <i data-lucide="book-open" style="width:10px; height:10px;"></i>
                                    SOP Linked
                                </span>` : ''}
                        </div>
                    </div>
                </div>
            `).join("")}
            ${blueprints.length === 0 ? '<div class="empty-hint">No blueprints created yet.</div>' : ''}
        </div>
    `;

    // 🚀 Critical: Trigger the icon render
    if (window.lucide) {
        window.lucide.createIcons();
    }
};

// 2. RENDER TASK LIST AND TASK CARDS
export function renderTaskList(clientId, tasks, isVault = false) {
    if (!tasks || tasks.length === 0) {
        return `<div class="empty-hint" style="padding: 30px; text-align: center; opacity: 0.5;">No tasks found.</div>`;
    }

    const statusColors = {
        'Pending':     '#94a3b8',
        'In Progress': '#19f2eb',
        'Blocked':     '#f46b2c',
        'Done':        '#22c55e'
    };

    return tasks.map(task => {
        const currentColor = statusColors[task.status || 'Pending'] || '#94a3b8';
        
        return `
            <div class="task-row-item" 
                 style="display:flex; align-items:center; justify-content:space-between; padding:10px 14px; background:var(--panel-soft); border:1px solid var(--panel-border); border-radius:8px; margin-bottom:6px; cursor:pointer;"
                 onclick="OL.openTaskModal('${task.id}', ${isVault})">
                
                <div style="display:flex; align-items:center; gap:12px; flex:1; min-width:0;">
                    <select class="task-status-dropdown"
                            onclick="event.stopPropagation()"
                            onchange="OL.updateTaskStatus('${clientId}', '${task.id}', this.value, event)"
                            style="background: rgba(255,255,255,0.05); 
                                   color: ${currentColor}; 
                                   border: 1px solid ${currentColor}44; 
                                   border-radius: 4px; 
                                   padding: 3px 8px; 
                                   font-size: 11px; 
                                   font-weight: 700; 
                                   cursor: pointer; 
                                   outline: none;">
                        ${['Pending', 'In Progress', 'Blocked', 'Done'].map(st => `
                            <option value="${st}" ${task.status === st ? 'selected' : ''} style="background: var(--panel-dark); color: var(--text-main);">
                                ${st}
                            </option>
                        `).join('')}
                    </select>

                    <span style="font-size:13px; font-weight:600; color:var(--text-main); flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; ${task.status === 'Done' ? 'text-decoration: line-through; opacity: 0.5;' : ''}">
                        ${esc(task.name || task.title)}
                    </span>
                </div>

                <div style="display:flex; align-items:center; gap:10px;">
                    ${task.dueDate ? `
                        <span style="font-size:11px; color:var(--text-dim); font-family:monospace;">
                            ${new Date(task.dueDate).toLocaleDateString([], {month:'short', day:'numeric'})}
                        </span>
                    ` : ''}

                    <button class="card-delete-btn" style="position:static; opacity:0.4;" 
                            onclick="event.stopPropagation(); OL.universalDelete('${task.id}', 'tasks', event)">
                        <i data-lucide="x" style="width:14px; height:14px;"></i>
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

export function updateTaskStatus(clientId, taskId, newStatus, event) {
    if (event) event.stopPropagation();
    const client = state.clients[clientId] || getActiveClient();
    if (!client || !client.projectData?.clientTasks) return;

    const task = client.projectData.clientTasks.find(t => String(t.id) === String(taskId));
    if (task) {
        task.status = newStatus;
        if (newStatus === 'Done') {
            task.completedAt = new Date().toISOString();
        } else {
            delete task.completedAt;
        }

        OL.persist();
        if (typeof renderChecklistModule === 'function') {
            renderChecklistModule();
        } else {
            OL.refreshActiveView();
        }
        console.log(`✅ Task "${task.name || task.title}" status updated to: ${newStatus}`);
    }
};

export function cycleTaskStatus(clientId, taskId, event) {
    if (event) event.stopPropagation();
    const client = state.clients[clientId];
    const task = client?.projectData?.clientTasks.find(t => t.id === taskId);
    if (!task) return;

    // Define the cycle
    const statuses = ['Pending', 'In Progress', 'Blocked', 'Done'];
    let currentIdx = statuses.indexOf(task.status || 'Pending');
    task.status = statuses[(currentIdx + 1) % statuses.length];

    OL.persist();
    renderChecklistModule(); // Refresh UI to update the dot color and section
};

// Add to your state initialization if not present
if (state.ui.showCompleted === undefined) state.ui.showCompleted = false;

export function toggleCompletedTasks() {
    state.ui.showCompleted = !state.ui.showCompleted;
    OL.persist(); // Save preference
    renderChecklistModule(); // Re-render to show/hide
};

export function openTaskModal(taskId, isVault) {
    if (!state.v2) state.v2 = {}; 
    if (!state.v2.activeCommentTab) state.v2.activeCommentTab = 'internal';
    const client = getActiveClient();
    let task = isVault 
        ? state.master.taskBlueprints.find(t => t.id === taskId)
        : client?.projectData?.clientTasks.find(t => t.id === taskId);

    if (!task) return;

    const activeTab = state.v2?.activeCommentTab || 'internal';
    const isGuest = !!window.IS_GUEST;

    const html = `
        <div class="modal-head" style="gap:15px; display:flex; align-items:center; padding: 20px;">
            <div style="display:flex; align-items:center; gap:10px; flex:1;">
                <i data-lucide="clipboard-check" style="width:20px; height:20px; color:var(--accent);"></i>
                <input type="text" class="header-editable-input" 
                       value="${esc(task.title || task.name)}" 
                       placeholder="Task Name..."
                       style="background:transparent; border:none; color:inherit; font-size:18px; font-weight:bold; width:100%; outline:none;"
                       onblur="OL.updateTaskField('${taskId}', '${isVault ? 'title' : 'name'}', this.value, ${isVault})">
            </div>
            <button class="btn small soft" onclick="OL.closeModal()">Close</button>
        </div>

        <div class="modal-layout-wrapper" style="display: flex; height: 75vh; overflow: hidden;">
            
            <div class="modal-body main-config-area" style="flex: 1.5; overflow-y: auto; padding: 20px; border-right: 1px solid var(--line);">

                <div class="card-section" style="margin-top: 20px;">
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                        <div>
                            <label class="modal-section-label">
                                <i data-lucide="calendar" style="width:10px; height:10px; margin-right:4px;"></i> Due Date
                            </label>
                            <input type="date" class="modal-input tiny" value="${task.dueDate || ''}" 
                                   onchange="OL.updateTaskField('${taskId}', 'dueDate', this.value, false)">
                        </div>
                        <div>
                            <label class="modal-section-label">
                                <i data-lucide="activity" style="width:10px; height:10px; margin-right:4px;"></i> Status
                            </label>
                            <select class="modal-input tiny" onchange="OL.updateTaskField('${taskId}', 'status', this.value, false)">
                                <option value="Pending" ${task.status === 'Pending' ? 'selected' : ''}>⏳ Pending</option>
                                <option value="In Progress" ${task.status === 'In Progress' ? 'selected' : ''}>🚧 In Progress</option>
                                <option value="Done" ${task.status === 'Done' ? 'selected' : ''}>✅ Done</option>
                            </select>
                        </div>
                    </div>
                </div>
                
                <div class="card-section">
                    <label class="modal-section-label">
                        <i data-lucide="file-text" style="width:10px; height:10px; margin-right:4px;"></i> Internal SOP / Instructions
                    </label>
                    <textarea class="modal-textarea" rows="4" 
                              onblur="OL.updateTaskField('${taskId}', 'description', this.value, ${isVault})">${esc(task.description || task.notes || "")}</textarea>
                </div>

                <div class="card-section" style="margin-top: 20px;">
                    <label class="modal-section-label">
                        <i data-lucide="layout-grid" style="width:10px; height:10px; margin-right:4px;"></i> Required Tools (Apps)
                    </label>
                    <div class="pills-row" id="task-app-pills" style="margin-bottom: 8px;">
                        ${(task.appIds || []).map(appId => {
                            const app = [...state.master.apps, ...(client?.projectData.localApps || [])].find(a => a.id === appId);
                            return app ? `
                                <span class="pill tiny soft is-clickable" onclick="OL.handleTaskAppInteraction(event, '${taskId}', '${app.id}', ${isVault})">
                                    <i data-lucide="smartphone" style="width:10px; height:10px; margin-right:4px;"></i> ${esc(app.name)}
                                </span>` : '';
                        }).join('')}
                    </div>
                    <div class="search-map-container">
                        <input type="text" class="modal-input tiny" placeholder="Click to link an app..." 
                            onfocus="OL.filterTaskAppSearch('${taskId}', '', ${isVault})"
                            oninput="OL.filterTaskAppSearch('${taskId}', this.value, ${isVault})">
                        <div id="task-app-search-results" class="search-results-overlay"></div>
                    </div>
                </div>

                <div class="card-section" style="margin-top: 20px;">
                    <label class="modal-section-label">
                        <i data-lucide="book-open" style="width:10px; height:10px; margin-right:4px;"></i> Linked How-To Guides
                    </label>
                    <div class="pills-row" style="margin-bottom: 8px;">
                        ${(task.howToIds || []).map(htId => {
                            const guide = (state.master.howToLibrary || []).find(g => g.id === htId); 
                            if (!guide) return ''; 
                            return `
                                <span class="pill tiny soft is-clickable" 
                                      style="cursor: pointer;" 
                                      onclick="OL.openGuideEditor('${guide.id}')">
                                    <i data-lucide="book" style="width:10px; height:10px; margin-right:4px;"></i> ${esc(guide.name)}
                                </span>`;
                        }).join('')}
                    </div>
                    <div class="search-map-container">
                        <input type="text" class="modal-input tiny" placeholder="Click to view guides..." 
                            onfocus="OL.filterTaskHowToSearch('${taskId}', '', ${isVault})"
                            oninput="OL.filterTaskHowToSearch('${taskId}', this.value, ${isVault})">
                        <div id="task-howto-results" class="search-results-overlay"></div>
                    </div>
                </div>

                ${!isVault ? `
                <div class="card-section" style="margin-top: 20px; padding-top: 15px; border-top: 1px solid var(--line);">
                    <div style="margin-top:15px;">
                        <label class="modal-section-label">
                            <i data-lucide="users" style="width:10px; height:10px; margin-right:4px;"></i> Assigned Team Members
                        </label>
                        <div class="pills-row" id="task-assignee-pills" style="margin-bottom: 8px;">
                            ${(task.assigneeIds || []).map(mId => {
                                const member = client.projectData.teamMembers?.find(m => m.id === mId);
                                return member ? `
                                    <span class="pill tiny accent" style="display:flex; align-items:center; gap:4px;">
                                        <i data-lucide="user" style="width:10px; height:10px;"></i> ${esc(member.name)}
                                        <b class="pill-remove-x" style="cursor:pointer; margin-left:4px;" onclick="OL.toggleTaskAssignee(event, '${taskId}', '${member.id}')">×</b>
                                    </span>` : '';
                            }).join('')}
                        </div>
                        <div class="search-map-container">
                            <input type="text" class="modal-input tiny" placeholder="Click to assign member..." 
                                onfocus="OL.filterTaskAssigneeSearch('${taskId}', '')"
                                oninput="OL.filterTaskAssigneeSearch('${taskId}', this.value)">
                            <div id="task-assignee-results" class="search-results-overlay"></div>
                        </div>
                    </div>
                </div>
                ` : ''}
            </div>

            <aside class="modal-sidebar" style="flex: 1; display: flex; flex-direction: column; background: rgba(0,0,0,0.05);">
                <div style="display: flex; border-bottom: 1px solid var(--line);">
                    ${!isGuest ? `
                        <div onclick="state.v2.activeCommentTab='internal'; OL.openTaskModal('${taskId}', ${isVault})"
                             style="flex:1; padding: 12px; text-align:center; font-size:10px; cursor:pointer; font-weight:bold; display:flex; align-items:center; justify-content:center; gap:6px; ${activeTab === 'internal' ? 'color:var(--accent); border-bottom:2px solid var(--accent);' : 'opacity:0.5'}">
                            <i data-lucide="lock" style="width:12px; height:12px;"></i> INTERNAL
                        </div>
                    ` : ''}
                    <div onclick="state.v2.activeCommentTab='client'; OL.openTaskModal('${taskId}', ${isVault})"
                         style="flex:1; padding: 12px; text-align:center; font-size:10px; cursor:pointer; font-weight:bold; display:flex; align-items:center; justify-content:center; gap:6px; ${activeTab === 'client' ? 'color:#10b981; border-bottom:2px solid #10b981;' : 'opacity:0.5'}">
                        <i data-lucide="message-square" style="width:12px; height:12px;"></i> CLIENT FEEDBACK
                    </div>
                </div>

                <div id="task-comments-${taskId}" style="flex: 1; overflow-y: auto; padding: 15px;">
                    ${renderCommentsList(task, activeTab)}
                </div>

                <div class="comment-input-zone" style="padding: 15px; border-top: 1px solid var(--line); background: var(--bg-panel);">
                    <textarea id="new-comment-task-${taskId}" class="modal-textarea" 
                              placeholder="Type a ${activeTab === 'client' ? 'message...' : 'note...'}" 
                              style="min-height: 60px; margin-bottom: 8px; font-size: 11px;"></textarea>
                    <button class="btn tiny full-width" 
                            style="background:${activeTab === 'client' ? '#10b981' : 'var(--accent)'}; color:black; font-weight:bold; display:flex; align-items:center; justify-content:center; gap:6px;"
                            onclick="OL.addTaskComment('${taskId}', ${isVault}, ${activeTab === 'client'})">
                        <i data-lucide="send" style="width:12px; height:12px;"></i> Post ${activeTab === 'client' ? 'to Client' : 'Note'}
                    </button>
                </div>
            </aside>
        </div>
    `;
    openModal(html);

    // 🚀 THE REPAINT: Ensure all icons render correctly immediately
    if (window.lucide) {
        window.lucide.createIcons();
    }
};

export async function addTaskComment(taskId, isVault, isClientFacing = false) {
    const input = document.getElementById(`new-comment-task-${taskId}`);
    const text = input.value.trim();
    if (!text) return;

    const client = getActiveClient();
    let task = isVault 
        ? state.master.taskBlueprints.find(t => t.id === taskId)
        : client?.projectData?.clientTasks.find(t => t.id === taskId);

    if (!task) return;

    let authorName = "Team Member";
    if (window.FORCE_ADMIN) {
        authorName = "Sphynx Team";
    } else if (window.IS_GUEST && client) {
        authorName = client.meta.name;
    }

    if (!task.comments) task.comments = [];
    
    task.comments.push({
        author: authorName,
        text: text,
        timestamp: new Date().toISOString(),
        isClientFacing: isClientFacing
    });

    await OL.persist();
    input.value = "";
    state.v2.activeCommentTab = isClientFacing ? 'client' : 'internal';
    OL.openTaskModal(taskId, isVault);
};

// 📑 UPDATED RENDERER (Ensures the onclick strings are perfectly formed)
export function renderCommentsList(obj, activeTab = 'internal') {
    const comments = obj.comments || [];
    const filtered = comments.filter(c => activeTab === 'client' ? c.isClientFacing : !c.isClientFacing);

    if (filtered.length === 0) {
        return `<div class="tiny muted center italic" style="padding: 40px 20px;">No ${activeTab} notes yet.</div>`;
    }

    return filtered.map((c) => {
        const globalIdx = comments.indexOf(c);
        const isClientType = c.isClientFacing;
        const isVaultMode = window.location.hash.includes('vault');
        
        // 🚀 THE FIX: Use explicit global window calls in the string
        const deleteCall = `window.OL.deleteComment('${obj.id}', ${globalIdx})`;

        return `
            <div class="comment-bubble" style="margin-bottom: 12px; padding: 10px; border-radius: 6px; 
                 background: ${isClientType ? 'rgba(16, 185, 129, 0.05)' : 'rgba(255,255,255,0.03)'}; 
                 border: 1px solid ${isClientType ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255,255,255,0.05)'};">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                    <b class="tiny" style="color: ${isClientType ? '#10b981' : 'var(--accent)'}">${esc(c.author)}</b>
                    <span class="tiny muted" style="font-size: 8px;">${new Date(c.timestamp).toLocaleDateString()}</span>
                </div>
                <div class="small" style="line-height: 1.4; font-size: 12px;">${esc(c.text)}</div>
                ${!window.IS_GUEST ? `
                    <div style="text-align: right; margin-top: 5px;">
                        <button class="btn-icon-tiny" style="opacity:0.3; cursor:pointer;" onclick="${deleteCall}">delete</button>
                    </div>
                ` : ''}
            </div>
        `;
    }).join('');
}

export async function deleteComment(id, idx) {
    console.log("🗑️ Attempting to delete comment from ID:", id);
    const client = getActiveClient();
    const isVault = window.location.hash.includes('vault');
    const data = isVault ? state.master : client?.projectData;

    if (!data) return;

    // 🕵️ 1. SEARCH TASKS (Checklist Module)
    let owner = (data.clientTasks || []).find(t => String(t.id) === String(id));

    // 🕵️ 2. SEARCH RESOURCES (Flow Map Cards)
    if (!owner) {
        owner = (data.localResources || data.resources || []).find(r => String(r.id) === String(id));
    }

    // 🕵️ 3. SEARCH STEPS (Inside Cards)
    if (!owner) {
        const pool = (data.localResources || data.resources || []);
        for (const res of pool) {
            const stepMatch = (res.steps || []).find(s => String(s.id) === String(id));
            if (stepMatch) {
                owner = stepMatch;
                break;
            }
        }
    }

    // 🗑️ EXECUTE DELETE
    if (owner && owner.comments) {
        owner.comments.splice(idx, 1);
        await OL.persist();
        console.log("✅ Comment removed.");

        // 🔄 REFRESH: Re-open the correct modal
        if (id.startsWith('id_') || (owner.hasOwnProperty('status'))) {
            OL.openTaskModal(id, isVault);
        } else {
            OL.openResourceModal(id);
        }
    } else {
        console.error("❌ Could not find the object or comments for ID:", id);
    }
};

// 3. MASTER TASK IMPORTER
export function openMasterTaskImporter() {
    const html = `
        <div class="modal-head" style="display:flex; align-items:center; gap:12px; padding: 20px;">
            <i data-lucide="download-cloud" style="width:20px; height:20px; color:var(--accent);"></i>
            <div class="modal-title-text">Import Master Blueprints</div>
            <div class="spacer"></div>
            <button class="btn small soft" onclick="OL.closeModal()">Cancel</button>
        </div>
        <div class="modal-body">
            <div class="search-map-container">
                <div style="position:relative; display:flex; align-items:center;">
                    <i data-lucide="search" style="position:absolute; left:12px; width:14px; height:14px; opacity:0.4;"></i>
                    <input type="text" class="modal-input" 
                           style="padding-left:35px;"
                           placeholder="Search blueprints or onboarding steps..." 
                           onfocus="OL.filterMasterTaskImport('')"
                           oninput="OL.filterMasterTaskImport(this.value)" 
                           autofocus>
                </div>
                <div id="master-task-import-results" class="search-results-overlay" style="margin-top:10px;"></div>
            </div>
        </div>
    `;
    openModal(html);

    // 🚀 THE REPAINT: Ensure the icons render correctly immediately
    if (window.lucide) {
        window.lucide.createIcons();
    }
};

export function filterMasterTaskImport(query) {
    const listEl = document.getElementById("master-task-import-results");
    if (!listEl) return;

    const q = (query || "").toLowerCase().trim();
    const client = getActiveClient();
    const existingOrigins = (client?.projectData?.clientTasks || []).map(t => String(t.originId));

    const available = (state.master.taskBlueprints || []).filter(t => 
        (t.title || t.name || "").toLowerCase().includes(q) && !existingOrigins.includes(String(t.id))
    );

    listEl.innerHTML = available.map(task => `
        <div class="search-result-item" onmousedown="OL.executeTaskImport('${task.id}')">
            <div>
                <strong>${esc(task.title || task.name)}</strong>
                <div class="tiny muted">${esc(task.category || 'Standard Process')}</div>
            </div>
        </div>
    `).join('') || `<div class="search-result-item muted">No new blueprints found.</div>`;
};

export function executeTaskImport(masterId) {
    const client = getActiveClient();
    const blueprint = state.master.taskBlueprints.find(t => t.id === masterId);
    
    if (!client || !blueprint) return;

    // 1. Create the Local Task Instance
    const localTaskId = 'local-tk-' + Date.now();
    const newTask = {
        id: localTaskId,
        originId: blueprint.id, // Reference to where it came from
        name: blueprint.title,
        status: "Pending",
        description: blueprint.description || "",
        appIds: [...(blueprint.appIds || [])], // Clone the linked apps
        howToIds: [...(blueprint.howToIds || [])], // Clone the linked SOPs
        assigneeIds: [],
        createdDate: new Date().toISOString(),
        priority: "medium"
    };

    // 2. Save to Project
    if (!client.projectData.clientTasks) client.projectData.clientTasks = [];
    client.projectData.clientTasks.push(newTask);

    // 3. Persist and Refresh
    OL.persist();
    OL.closeModal();
    renderChecklistModule();
    
    // 4. Feedback
    console.log(`✅ Imported blueprint: ${blueprint.title}`);
};

export function importAllAvailableTasks() {
    const client = getActiveClient();
    const masterTasks = state.master.taskBlueprints || [];
    const existingOrigins = (client.projectData.clientTasks || []).map(t => t.originId);
    
    const toImport = masterTasks.filter(t => !existingOrigins.includes(t.id));
    
    if (toImport.length === 0) return;

    toImport.forEach(blueprint => {
        const newTask = {
            id: 'local-tk-' + Date.now() + Math.random(),
            originId: blueprint.id,
            name: blueprint.title || blueprint.name,
            status: "Pending",
            description: blueprint.description || "",
            appIds: [...(blueprint.appIds || [])],
            howToIds: [...(blueprint.howToIds || [])],
            assigneeIds: [],
            createdDate: new Date().toISOString()
        };
        client.projectData.clientTasks.push(newTask);
    });

    OL.persist();
    OL.closeModal();
    renderChecklistModule();
    console.log(`🚀 Bulk Import Complete: ${toImport.length} tasks added.`);
};

// 4. CREATE CUSTOM TASK AND HANDLE MODAL, UPDATE, DELETE TASKS
export function promptCreateMasterTask() {
    const newBlueprintId = uid();
    const newBlueprint = { 
        id: newBlueprintId, 
        title: "New Blueprint", 
        description: "",
        appIds: [],
        howToIds: []
    };

    if (!state.master.taskBlueprints) state.master.taskBlueprints = [];
    state.master.taskBlueprints.push(newBlueprint);

    OL.persist();
    renderChecklistModule(true); 

    // Open immediately
    setTimeout(() => { OL.openTaskModal(newBlueprintId, true); }, 50);
};

export function openAddTaskModal(clientId) {
    const client = state.clients[clientId];
    if (!client) return;

    const newTaskId = uid(); 
    const newTask = {
        id: newTaskId,
        name: "New Task", // Placeholder to be overwritten in modal
        status: "Pending",
        description: "",
        priority: "medium",
        appIds: [],
        howToIds: [],
        assigneeIds: [], // Standardized array
        createdDate: new Date().toISOString()
    };

    if (!client.projectData.clientTasks) client.projectData.clientTasks = [];
    client.projectData.clientTasks.push(newTask);

    OL.persist();
    renderChecklistModule(); 

    // Open immediately
    setTimeout(() => { OL.openTaskModal(newTaskId, false); }, 50);
};

// HANDLE APP-TASK LINKING
export function filterTaskAppSearch(taskId, query, isVault) {
    const listEl = document.getElementById("task-app-search-results");
    if (!listEl) return;

    const q = (query || "").toLowerCase().trim();
    const client = getActiveClient();
    
    const task = isVault 
        ? state.master.taskBlueprints.find(t => t.id === taskId)
        : client?.projectData?.clientTasks.find(t => t.id === taskId);
    
    const existingAppIds = task?.appIds || [];
    const source = [...state.master.apps, ...(client?.projectData?.localApps || [])];

    const matches = source.filter(a => {
        const nameMatch = a.name.toLowerCase().includes(q);
        const alreadyLinked = existingAppIds.includes(a.id);
        return nameMatch && !alreadyLinked;
    });

    listEl.innerHTML = matches.map(app => `
        <div class="search-result-item" onmousedown="OL.toggleTaskApp('${taskId}', '${app.id}', ${isVault})">
            <div style="display:flex; justify-content:space-between; width:100%; align-items:center;">
                <div style="display:flex; align-items:center; gap:8px;">
                    <i data-lucide="smartphone" style="width:14px; height:14px; color:var(--accent);"></i>
                    <span>${esc(app.name)}</span>
                </div>
                <span class="tiny-tag ${String(app.id).startsWith('local') ? 'local' : 'vault'}" style="font-size:8px; opacity:0.6;">
                    ${String(app.id).startsWith('local') ? 'LOCAL' : 'MASTER'}
                </span>
            </div>
        </div>
    `).join('') || '<div class="search-result-item muted">No unlinked tools found.</div>';

    // 🚀 Update icons instantly as user types
    if (window.lucide) window.lucide.createIcons();
};

export function toggleTaskApp(taskId, appId, isVault) {
    const client = getActiveClient();
    let task = isVault 
        ? state.master.taskBlueprints.find(t => t.id === taskId)
        : client?.projectData?.clientTasks.find(t => t.id === taskId);

    if (task) {
        if (!task.appIds) task.appIds = [];
        const idx = task.appIds.indexOf(appId);
        
        if (idx === -1) task.appIds.push(appId);
        else task.appIds.splice(idx, 1);

        OL.persist();
        // Surgical refresh of the modal
        OL.openTaskModal(taskId, isVault);
    }
};

export function handleTaskAppInteraction(event, taskId, appId, isVault) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }

    // 1. REMOVE LOGIC: Cmd + Click or Ctrl + Click
    if (event.metaKey || event.ctrlKey) {
        if (confirm("Remove this tool from the task?")) {
            OL.toggleTaskApp(taskId, appId, isVault);
        }
        return;
    }

    // 2. JUMP LOGIC: Standard Left Click
    OL.openAppModal(appId);
};

// 5. HANDLE TASK STATUS SWITCH
export function toggleTaskStatus(clientId, taskId) {
    const client = state.clients[clientId];
    const task = client?.projectData?.clientTasks.find((t) => t.id === taskId);
    
    if (task) {
        task.status = task.status === "Done" ? "Pending" : "Done";
        OL.persist();
        
        // 🚀 SURGICAL REFRESH: Instead of handleRoute, just redraw the lists
        const allTasks = client.projectData.clientTasks || [];
        const pendingArea = document.getElementById('pending-tasks-list');
        const completedArea = document.getElementById('completed-tasks-list');
        
        if (pendingArea && completedArea) {
            pendingArea.innerHTML = renderTaskList(clientId, allTasks.filter(t => t.status !== "Done"), false);
            completedArea.innerHTML = renderTaskList(clientId, allTasks.filter(t => t.status === "Done"), false);
        } else {
            renderChecklistModule(false); // Fallback
        }
    }
};

// HANDLE TASK ASSIGNEES
export function filterTaskAssigneeSearch(taskId, query) {
    const listEl = document.getElementById("task-assignee-results");
    if (!listEl) return;

    const q = (query || "").toLowerCase().trim();
    const client = getActiveClient();
    const task = client?.projectData?.clientTasks.find(t => t.id === taskId);
    const existingAssignees = task?.assigneeIds || [];

    const matches = (client.projectData.teamMembers || []).filter(m => {
        return m.name.toLowerCase().includes(q) && !existingAssignees.includes(m.id);
    });

    listEl.innerHTML = matches.map(member => `
        <div class="search-result-item" style="display:flex; align-items:center; gap:8px;" 
             onmousedown="OL.toggleTaskAssignee(event, '${taskId}', '${member.id}')">
            <i data-lucide="user" style="width:14px; height:14px; color:var(--accent);"></i>
            <span>${esc(member.name)}</span>
        </div>
    `).join('') || '<div class="search-result-item muted">No other members found.</div>';

    // 🚀 Update icons instantly as user types
    if (window.lucide) window.lucide.createIcons();
};

export function toggleTaskAssignee(event, taskId, memberId) {
    if (event) event.stopPropagation();
    const client = getActiveClient();
    const task = client?.projectData?.clientTasks.find(t => t.id === taskId);

    if (task) {
        if (!task.assigneeIds) task.assigneeIds = [];
        const idx = task.assigneeIds.indexOf(memberId);
        
        if (idx === -1) task.assigneeIds.push(memberId);
        else task.assigneeIds.splice(idx, 1);

        OL.persist();
        OL.openTaskModal(taskId, false); // Refresh Modal
        renderChecklistModule(); // Refresh Background
    }
};

// UPDATE OR DELETE TASK
export function updateTaskField(taskId, field, value, isVault) {
    const client = getActiveClient();
    let task = null;

    if (isVault) {
        task = state.master.taskBlueprints.find(t => t.id === taskId);
    } else {
        task = client?.projectData?.clientTasks.find(t => t.id === taskId);
    }

    if (task) {
        task[field] = value.trim();
        OL.persist();
        
        // Refresh background grid without closing modal
        if (isVault) renderBlueprintManager();
        else renderChecklistModule();
        
        console.log(`✅ Task Updated: ${field} = ${value}`);
    }
};

export function removeMasterTask(taskId) {
    if (!confirm("Permanently delete this Master Blueprint? This will not remove tasks already deployed to clients.")) return;
    state.master.taskBlueprints = state.master.taskBlueprints.filter(t => t.id !== taskId);
    OL.persist();
    renderBlueprintManager();
};

export function removeClientTask(clientId, taskId) {
    if (!confirm("Remove this task from the project?")) return;
    const client = state.clients[clientId];
    if (client) {
        client.projectData.clientTasks = client.projectData.clientTasks.filter(t => t.id !== taskId);
        OL.persist();
        renderChecklistModule();
    }
};

//======================= RESOURCES GRID SECTION =======================//

export function isResourceInScope(resourceId) {
    const client = getActiveClient();
    if (!client || !client.projectData?.scopingSheets) return null;

    // Check the primary scoping sheet for any line item linked to this resource
    const sheet = client.projectData.scopingSheets[0];
    const foundItem = (sheet.lineItems || []).find(item => 
        String(item.resourceId) === String(resourceId)
    );

    return foundItem || null; 
};

// 1. RESOURCE MANAGER
if (!state.master.resourceTypes) {
  state.master.resourceTypes = [
    { type: "Zap", typeKey: "zap", archetype: "Multi-Step", lucideIcon: "zap" },
    { type: "Form", typeKey: "form", archetype: "Base", lucideIcon: "file-text" },
    { type: "Email", typeKey: "email", archetype: "Base", lucideIcon: "mail" },
    { type: "Event", typeKey: "event", archetype: "Base", lucideIcon: "calendar" },
    { type: "SOP", typeKey: "sop", archetype: "Base", lucideIcon: "book-open" },
    { type: "Signature", typeKey: "signature", archetype: "Base", lucideIcon: "pen-tool" },
    { type: "Folder", typeKey: "folder", archetype: "Base", lucideIcon: "folder" },
    { type: "Spreadsheet", typeKey: "spreadsheet", archetype: "Base", lucideIcon: "table-2" }
  ];
}


// ---- bridge: keep OL.*/window.* calls working until callers import directly ----
window.OL = window.OL || {};
Object.assign(window.OL, {
    updateTaskStatus, cycleTaskStatus, toggleCompletedTasks, openTaskModal,
    addTaskComment, deleteComment, openMasterTaskImporter,
    filterMasterTaskImport, executeTaskImport, importAllAvailableTasks,
    promptCreateMasterTask, openAddTaskModal, filterTaskAppSearch,
    toggleTaskApp, handleTaskAppInteraction, toggleTaskStatus,
    filterTaskAssigneeSearch, toggleTaskAssignee, updateTaskField,
    removeMasterTask, removeClientTask, isResourceInScope
});
// Called bare (no OL./window. prefix) from sections still living in
// app.js — bridge onto window directly so those calls keep resolving.
window.renderChecklistModule = renderChecklistModule;
window.renderBlueprintManager = renderBlueprintManager;
window.renderCommentsList = renderCommentsList;
