// ================= 🏛️ MASTER TASK BLUEPRINTS (Template Library) =================
// state.master.taskBlueprints — reusable task templates at the vault level.
// This is the "Master Tasks" sidebar item under Template Vault. Distinct
// from a client's own projectData.clientTasks.

import { esc, uid, state, updateAndSync } from '../core/data.js';

OL.renderMasterTaskBlueprints = function() {
    const main = document.getElementById("mainContent");
    if (!main) return;

    const blueprints = state.master.taskBlueprints || [];
    const sops = state.master.sops || [];

    main.innerHTML = `
        <div class="section-header" style="display:flex; justify-content:space-between; align-items:center;">
            <div>
                <h2><i data-lucide="clipboard-list" style="width:22px;height:22px;vertical-align:sub;margin-right:8px;color:var(--accent);"></i>Master Tasks</h2>
                <div class="small muted">Reusable task templates you can pull from when scoping or building out a client's task list.</div>
            </div>
            <button class="btn small primary" onclick="OL.openTaskBlueprintModal()" style="display:flex; align-items:center; gap:6px;">
                <i data-lucide="plus" style="width:14px;height:14px;"></i> New Blueprint
            </button>
        </div>

        <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap:14px; margin-top:16px;">
            ${blueprints.length === 0 ? `
                <div class="card" style="padding:24px; text-align:center; grid-column: 1 / -1;">
                    <p class="muted small">No task blueprints yet. Click "New Blueprint" to create a reusable template — e.g. "Implementation: {resource}" with a default assignee and status.</p>
                </div>
            ` : blueprints.map(bp => `
                <div class="card" style="padding:14px 16px;">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
                        <strong style="font-size:13px;">${esc(bp.title || 'Untitled Blueprint')}</strong>
                        <div style="display:flex; gap:4px; flex-shrink:0;">
                            <button class="btn tiny primary" onclick="OL.openApplyBlueprintModal('${bp.id}')" title="Apply to a client"><i data-lucide="send" style="width:11px;height:11px;"></i></button>
                            <button class="btn tiny soft" onclick="OL.openTaskBlueprintModal('${bp.id}')" title="Edit"><i data-lucide="pencil" style="width:11px;height:11px;"></i></button>
                            <button class="btn tiny" style="background:#ef4444;color:white;" onclick="OL.deleteTaskBlueprint('${bp.id}')" title="Delete"><i data-lucide="trash-2" style="width:11px;height:11px;"></i></button>
                        </div>
                    </div>
                    ${bp.description ? `<div class="tiny muted" style="margin-top:6px;">${esc(bp.description)}</div>` : ''}
                    <div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:10px;">
                        ${bp.defaultAssignee ? `<span class="pill tiny soft" style="display:inline-flex;align-items:center;gap:4px;"><i data-lucide="user" style="width:10px;height:10px;"></i>${esc(bp.defaultAssignee)}</span>` : ''}
                        ${bp.defaultStatus ? `<span class="pill tiny soft">${esc(bp.defaultStatus)}</span>` : ''}
                        ${bp.dueInDays !== undefined && bp.dueInDays !== null && bp.dueInDays !== '' ? `<span class="pill tiny soft">Due +${esc(bp.dueInDays)}d</span>` : ''}
                        ${bp.phase ? `<span class="pill tiny soft">${bp.phase === 'before' ? 'Before' : bp.phase === 'after' ? 'After' : 'Implementation'}</span>` : ''}
                        ${(bp.howToIds || []).length ? `<span class="pill tiny soft" style="display:inline-flex;align-items:center;gap:4px;"><i data-lucide="book-open" style="width:10px;height:10px;"></i>${bp.howToIds.length} guide${bp.howToIds.length === 1 ? '' : 's'}</span>` : ''}
                    </div>
                </div>
            `).join('')}
        </div>

        <div class="section-header" style="display:flex; justify-content:space-between; align-items:center; margin-top:32px;">
            <div>
                <h2><i data-lucide="layers" style="width:20px;height:20px;vertical-align:sub;margin-right:8px;color:var(--accent);"></i>SOPs</h2>
                <div class="small muted">Group blueprints into a standard workflow you can apply to a client all at once.</div>
            </div>
            <button class="btn small primary" onclick="OL.openSopModal()" style="display:flex; align-items:center; gap:6px;">
                <i data-lucide="plus" style="width:14px;height:14px;"></i> New SOP
            </button>
        </div>

        <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap:14px; margin-top:16px;">
            ${sops.length === 0 ? `
                <div class="card" style="padding:24px; text-align:center; grid-column: 1 / -1;">
                    <p class="muted small">No SOPs yet. Group a few blueprints together — e.g. "New Client Onboarding" — and apply the whole set to a client in one click.</p>
                </div>
            ` : sops.map(sop => `
                <div class="card" style="padding:14px 16px;">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
                        <strong style="font-size:13px;">${esc(sop.name || 'Untitled SOP')}</strong>
                        <div style="display:flex; gap:4px; flex-shrink:0;">
                            <button class="btn tiny primary" onclick="OL.openApplySopModal('${sop.id}')" title="Apply to a client"><i data-lucide="send" style="width:11px;height:11px;"></i></button>
                            <button class="btn tiny soft" onclick="OL.openSopModal('${sop.id}')" title="Edit"><i data-lucide="pencil" style="width:11px;height:11px;"></i></button>
                            <button class="btn tiny" style="background:#ef4444;color:white;" onclick="OL.deleteSop('${sop.id}')" title="Delete"><i data-lucide="trash-2" style="width:11px;height:11px;"></i></button>
                        </div>
                    </div>
                    ${sop.description ? `<div class="tiny muted" style="margin-top:6px;">${esc(sop.description)}</div>` : ''}
                    <div style="margin-top:10px; display:flex; flex-direction:column; gap:3px;">
                        ${OL.resolveSopItems(sop).map((item, i) => {
                            const relNote = item.dueMode === 'relative' && item.relativeToIndex !== null && item.relativeToIndex !== undefined
                                ? ` <span style="color:var(--accent);">· due ${item.offsetDays ?? 0}d after #${item.relativeToIndex + 1}</span>`
                                : '';
                            return `<div class="tiny muted">${i + 1}. ${esc(item.blueprint.title)}${relNote}</div>`;
                        }).join('') || `<div class="tiny muted">No blueprints added yet.</div>`}
                    </div>
                </div>
            `).join('')}
        </div>
    `;
    if (window.lucide) lucide.createIcons();
};

OL.openTaskBlueprintModal = function(blueprintId) {
    const blueprints = state.master.taskBlueprints || [];
    const bp = blueprintId ? blueprints.find(b => b.id === blueprintId) : null;

    const html = `
        <div class="modal-head">
            <div class="modal-title-text">${bp ? 'Edit' : 'New'} Task Blueprint</div>
            <div class="spacer"></div>
            <button class="btn small soft" onclick="OL.closeModal()">Close</button>
        </div>
        <div class="modal-body">
            <div style="background: rgba(255,255,255,0.02); padding: 14px; border-radius: 8px; border:1px solid var(--line); margin-bottom:16px;">
                <label class="modal-section-label" style="margin-top:0;">Title</label>
                <input type="text" id="bp-title" class="modal-input" value="${esc(bp?.title || '')}" placeholder="e.g. Implementation: {resource}">

                <label class="modal-section-label">Description</label>
                <textarea id="bp-description" class="modal-input" rows="4" style="width:100%; box-sizing:border-box; resize:vertical; min-height:90px;">${esc(bp?.description || '')}</textarea>
            </div>

            <div style="background: rgba(255,255,255,0.02); padding: 14px; border-radius: 8px; border:1px solid var(--line); margin-bottom:16px;">
                <div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap:12px;">
                    <div>
                        <label class="tiny muted uppercase bold" style="display:block; margin-bottom:4px;">Default Assignee</label>
                        <select id="bp-assignee" class="modal-input tiny">
                            <option value="Sphynx Task" ${(!bp || bp.defaultAssignee === 'Sphynx Task' || !bp.defaultAssignee) ? 'selected' : ''}>Sphynx Task</option>
                            <option value="Client Task" ${bp?.defaultAssignee === 'Client Task' ? 'selected' : ''}>Client Task</option>
                            ${(state.master?.sphynxTeam || []).length ? `
                                <optgroup label="Sphynx Team">
                                    ${state.master.sphynxTeam.map(m => `<option value="${esc(m.name)}" ${bp?.defaultAssignee === m.name ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}
                                </optgroup>
                            ` : ''}
                            <optgroup label="Vendors / 3rd Party">
                                ${(OL.thirdPartyAssignees || []).map(tp => `<option value="${esc(tp)}" ${bp?.defaultAssignee === tp ? 'selected' : ''}>${esc(tp)}</option>`).join('')}
                            </optgroup>
                        </select>
                    </div>
                    <div>
                        <label class="tiny muted uppercase bold" style="display:block; margin-bottom:4px;">Default Status</label>
                        <select id="bp-status" class="modal-input tiny">
                            ${(OL.getSystemStatuses ? OL.getSystemStatuses() : []).map(s => `<option value="${esc(s.name)}" ${(bp?.defaultStatus === s.name || (!bp && s.name === 'Pending Sphynx Action')) ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
                        </select>
                    </div>
                    <div>
                        <label class="tiny muted uppercase bold" style="display:block; margin-bottom:4px;">Due In (days)</label>
                        <input type="number" id="bp-due" class="modal-input tiny" value="${esc(bp?.dueInDays ?? '')}" placeholder="optional">
                    </div>
                    <div>
                        <label class="tiny muted uppercase bold" style="display:block; margin-bottom:4px;">Phase</label>
                        <select id="bp-phase" class="modal-input tiny">
                            <option value="" ${!bp?.phase ? 'selected' : ''}>Automatic</option>
                            <option value="before" ${bp?.phase === 'before' ? 'selected' : ''}>Before (pre-meeting or pre-implementation)</option>
                            <option value="implementation" ${bp?.phase === 'implementation' ? 'selected' : ''}>Implementation</option>
                            <option value="after" ${bp?.phase === 'after' ? 'selected' : ''}>After (post-meeting action item)</option>
                        </select>
                    </div>
                </div>
            </div>

            ${bp ? `
                <div style="background: rgba(255,255,255,0.02); padding: 14px; border-radius: 8px; border:1px solid var(--line); margin-bottom:16px;">
                    <label class="bold tiny uppercase muted" style="display:block; margin-bottom:8px;">
                        <i data-lucide="book-open" style="width:12px;height:12px;vertical-align:sub;"></i> Linked How-To Guides
                    </label>
                    ${(bp.howToIds && bp.howToIds.length) ? `
                        <div style="display:grid; gap:8px; margin-bottom:10px;">
                            ${bp.howToIds.map(htId => {
                                const guide = (state.master.howToLibrary || []).find(g => g.id === htId);
                                if (!guide) return '';
                                return `
                                    <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; padding:8px 10px; background:rgba(255,255,255,0.02); border:1px solid var(--line); border-radius:6px;">
                                        <strong class="tiny" style="cursor:pointer;" onclick="OL.openGuideEditor('${guide.id}')">${esc(guide.name)}</strong>
                                        <button class="btn tiny soft" title="Unlink" onclick="OL.toggleTaskHowTo(event, '${bp.id}', '${guide.id}', true); OL.openTaskBlueprintModal('${bp.id}');">✕</button>
                                    </div>
                                `;
                            }).join('')}
                        </div>
                    ` : ''}
                    <input type="text" class="modal-input tiny" placeholder="Search guides to link..." oninput="OL.filterTaskHowToSearch('${bp.id}', this.value, true)">
                    <div id="task-howto-results" style="max-height:140px; overflow:auto; margin-top:4px;"></div>
                </div>
            ` : `
                <div class="tiny muted" style="margin-bottom:16px;">Save the blueprint first, then reopen it to link How-To guides.</div>
            `}

            <div style="display:flex; justify-content:flex-end; gap:10px;">
                <button class="btn soft" onclick="OL.closeModal()">Cancel</button>
                <button class="btn primary" onclick="OL.saveTaskBlueprint('${bp?.id || ''}')">Save Blueprint</button>
            </div>
        </div>
    `;
    openModal(html);
    if (window.lucide) lucide.createIcons();
};

OL.saveTaskBlueprint = function(blueprintId) {
    const title = document.getElementById('bp-title')?.value?.trim();
    if (!title) { alert('Give the blueprint a title first.'); return; }

    const description = document.getElementById('bp-description')?.value || '';
    const defaultAssignee = document.getElementById('bp-assignee')?.value || 'Sphynx Task';
    const defaultStatus = document.getElementById('bp-status')?.value || 'Pending Sphynx Action';
    const dueRaw = document.getElementById('bp-due')?.value;
    const dueInDays = dueRaw === '' || dueRaw === undefined ? null : Number(dueRaw);
    const phaseRaw = document.getElementById('bp-phase')?.value;
    const phase = ['before', 'implementation', 'after'].includes(phaseRaw) ? phaseRaw : '';

    updateAndSync(() => {
        if (!state.master.taskBlueprints) state.master.taskBlueprints = [];
        if (blueprintId) {
            const existing = state.master.taskBlueprints.find(b => b.id === blueprintId);
            if (existing) { Object.assign(existing, { title, description, defaultAssignee, defaultStatus, dueInDays }); if (phase) existing.phase = phase; else delete existing.phase; }
        } else {
            state.master.taskBlueprints.push({
                id: uid(),
                title, description, defaultAssignee, defaultStatus, dueInDays,
                ...(phase ? { phase } : {}),
                howToIds: [],
                createdAt: new Date().toISOString()
            });
        }
    });

    OL.closeModal();
    OL.renderMasterTaskBlueprints();
};

OL.deleteTaskBlueprint = function(blueprintId) {
    if (!confirm('Delete this task blueprint?')) return;
    updateAndSync(() => {
        state.master.taskBlueprints = (state.master.taskBlueprints || []).filter(b => b.id !== blueprintId);
    });
    OL.renderMasterTaskBlueprints();
};

// ================= APPLYING A BLUEPRINT TO A CLIENT =================
// Shared by the manual "Apply to Client" button below AND by the
// automation engine's 'apply_blueprint' action, so both stay in sync.
//
// ctx (all optional) supports template placeholders in title/description:
//   {resourceName}, {taskTitle}, {clientName} — same placeholders the
//   free-form automation action uses.
// ctx.task, if provided (an automation firing off an existing task),
// lets asSubtask nest the new task under it.
OL.buildTaskFromBlueprint = function(blueprint, client, ctx) {
    ctx = ctx || {};
    const fill = (str) => String(str || '')
        .replace(/\{resourceName\}/g, ctx.resourceName || '')
        .replace(/\{taskTitle\}/g, ctx.title || '')
        .replace(/\{clientName\}/g, client?.meta?.name || '');

    let dueDate = '';
    const dueInDays = ctx.dueInDaysOverride ?? blueprint.dueInDays;
    if (dueInDays !== undefined && dueInDays !== null && dueInDays !== '') {
        const d = new Date();
        d.setDate(d.getDate() + Number(dueInDays));
        dueDate = d.toISOString().slice(0, 10);
    }

    const assignee = blueprint.defaultAssignee || 'Sphynx Task';
    const title = fill(blueprint.title) || 'Task';

    return {
        id: uid(),
        title,
        name: title,
        description: fill(blueprint.description),
        status: blueprint.defaultStatus || 'Pending Sphynx Action',
        assignee,
        dueDate,
        isClientTask: (assignee !== 'Sphynx Task' && !(OL.thirdPartyAssignees || []).includes(assignee)),
        loggedHours: 0,
        parentTaskId: (ctx.asSubtask && ctx.task) ? ctx.task.id : null,
        howToIds: [...(blueprint.howToIds || [])],
        blueprintId: blueprint.id,
        requestLineItemId: ctx.requestLineItemId || undefined,
        phase: ['before', 'implementation', 'after'].includes(blueprint.phase) ? blueprint.phase : undefined,
        createdBy: ctx.automationRuleId ? 'automation' : 'blueprint',
        automationRuleId: ctx.automationRuleId || undefined,
        createdAt: new Date().toISOString()
    };
};

// Manual UI entry point — pushes the built task into a client's workspace.
// clientId is passed as the updateAndSync target since a blueprint can be
// applied to any client, not necessarily the "active" one.
OL.applyTaskBlueprintToClient = function(blueprintId, clientId) {
    const blueprint = (state.master.taskBlueprints || []).find(b => b.id === blueprintId);
    if (!blueprint) return;
    if (!clientId) { alert('Pick a client first.'); return; }

    updateAndSync(() => {
        const client = state.clients?.[clientId];
        if (!client) return;
        if (!client.projectData) client.projectData = {};
        if (!client.projectData.clientTasks) client.projectData.clientTasks = [];

        const newTask = OL.buildTaskFromBlueprint(blueprint, client, {});
        client.projectData.clientTasks.unshift(newTask);
    }, clientId);

    OL.closeModal();
    alert(`"${blueprint.title}" applied to ${state.clients[clientId]?.meta?.name || clientId}.`);
};

// Every task ever created from this blueprint, across every client —
// relies on buildTaskFromBlueprint already stamping task.blueprintId, so
// no extra linkage bookkeeping is needed beyond that existing field.
OL.getBlueprintApplications = function(blueprintId) {
    const results = [];
    Object.values(state.clients || {}).forEach(client => {
        (client.projectData?.clientTasks || []).forEach(task => {
            if (task.blueprintId === blueprintId) {
                results.push({
                    clientId: client.id,
                    clientName: client.meta?.name || client.id,
                    taskId: task.id,
                    taskTitle: task.title || task.name,
                    status: task.status || 'Pending Sphynx Action'
                });
            }
        });
    });
    return results;
};

// Bulk variant — applies the blueprint to every client id given, one
// updateAndSync per client (so each is correctly marked dirty for persist).
OL.applyTaskBlueprintToClients = function(blueprintId, clientIds) {
    const blueprint = (state.master.taskBlueprints || []).find(b => b.id === blueprintId);
    if (!blueprint) return;
    if (!clientIds || !clientIds.length) { alert('Pick at least one client first.'); return; }

    clientIds.forEach(clientId => {
        updateAndSync(() => {
            const client = state.clients?.[clientId];
            if (!client) return;
            if (!client.projectData) client.projectData = {};
            if (!client.projectData.clientTasks) client.projectData.clientTasks = [];

            const newTask = OL.buildTaskFromBlueprint(blueprint, client, {});
            client.projectData.clientTasks.unshift(newTask);
        }, clientId);
    });

    OL.closeModal();
    alert(`"${blueprint.title}" applied to ${clientIds.length} client${clientIds.length === 1 ? '' : 's'}.`);
};

OL.openApplyBlueprintModal = function(blueprintId) {
    const blueprint = (state.master.taskBlueprints || []).find(b => b.id === blueprintId);
    if (!blueprint) return;

    OL._applyBpFilter = 'all'; // 'all' | 'applied' | 'not-applied'
    window._applyBpBlueprintId = blueprintId;
    openModal(OL._renderApplyBlueprintModalHTML(blueprintId));
};

// Rebuildable body — the search box and filter buttons call this to
// re-render just the client list without tearing down the whole modal.
OL._renderApplyBlueprintModalHTML = function(blueprintId, query) {
    const blueprint = (state.master.taskBlueprints || []).find(b => b.id === blueprintId);
    if (!blueprint) return '';

    const clients = Object.values(state.clients || {}).sort((a, b) =>
        (a.meta?.name || '').localeCompare(b.meta?.name || '')
    );
    const applications = OL.getBlueprintApplications(blueprintId);
    const appliedClientIds = new Set(applications.map(a => a.clientId));

    const q = (query || '').toLowerCase().trim();
    const filter = OL._applyBpFilter || 'all';
    const visibleClients = clients.filter(c => {
        const matchesQuery = !q || (c.meta?.name || c.id).toLowerCase().includes(q);
        const isApplied = appliedClientIds.has(c.id);
        const matchesFilter = filter === 'all' || (filter === 'applied' ? isApplied : !isApplied);
        return matchesQuery && matchesFilter;
    });

    return `
        <div class="modal-head">
            <div class="modal-title-text">Apply "${esc(blueprint.title)}"</div>
            <div class="spacer"></div>
            <button class="btn small soft" onclick="OL.closeModal()">Close</button>
        </div>
        <div class="modal-body" style="max-width:560px; width:100%;">
            <label class="modal-section-label">Apply to Clients (${clients.length})</label>
            <p class="tiny muted" style="margin-top:-4px; margin-bottom:10px;">Check any number of clients — applying creates a fresh copy of this task for each one.</p>

            <div style="display:flex; gap:8px; margin-bottom:10px;">
                <input type="text" class="modal-input tiny" style="flex:1;" placeholder="Search clients..."
                       value="${esc(query || '')}"
                       oninput="OL._refreshApplyBlueprintList('${blueprintId}', this.value)">
                <div style="display:flex; gap:4px; flex-shrink:0;">
                    <button class="btn tiny ${filter === 'all' ? 'primary' : 'soft'}" onclick="OL._setApplyBlueprintFilter('${blueprintId}', 'all')">All</button>
                    <button class="btn tiny ${filter === 'not-applied' ? 'primary' : 'soft'}" onclick="OL._setApplyBlueprintFilter('${blueprintId}', 'not-applied')">Not Applied</button>
                    <button class="btn tiny ${filter === 'applied' ? 'primary' : 'soft'}" onclick="OL._setApplyBlueprintFilter('${blueprintId}', 'applied')">Applied</button>
                </div>
            </div>

            <div id="apply-bp-client-list" style="display:grid; gap:6px; max-height:260px; overflow:auto; margin-bottom:14px; border:1px solid var(--line); border-radius:8px; padding:8px;">
                ${visibleClients.length ? visibleClients.map(c => `
                    <label style="display:flex; align-items:center; gap:8px; font-size:12px; cursor:pointer; padding:6px 8px; border:1px solid var(--line); border-radius:6px;">
                        <input type="checkbox" class="apply-bp-client-cb" value="${c.id}">
                        <span style="flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(c.meta?.name || c.id)}</span>
                        ${appliedClientIds.has(c.id) ? `<span class="pill tiny soft" style="flex-shrink:0; font-size:9px;">Already applied</span>` : ''}
                    </label>
                `).join('') : `<div class="tiny muted" style="padding:8px;">No clients match.</div>`}
            </div>

            ${applications.length ? `
                <label class="modal-section-label">Applied To (${applications.length})</label>
                <div style="display:grid; gap:6px; max-height:160px; overflow:auto; margin-bottom:14px;">
                    ${applications.map(a => `
                        <div class="tiny" style="display:flex; justify-content:space-between; align-items:center; gap:8px; padding:6px 8px; background:rgba(255,255,255,0.02); border:1px solid var(--line); border-radius:6px; cursor:pointer;" onclick="OL.closeModal(); OL.openTaskInContext('${a.clientId}', '${a.taskId}')">
                            <span style="min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(a.clientName)} — ${esc(a.taskTitle)}</span>
                            <span class="pill tiny soft" style="flex-shrink:0;">${esc(a.status)}</span>
                        </div>
                    `).join('')}
                </div>
            ` : ''}

            <div style="display:flex; justify-content:flex-end; gap:10px;">
                <button class="btn soft" onclick="OL.closeModal()">Cancel</button>
                <button class="btn primary" onclick="OL.applyTaskBlueprintToClients('${blueprintId}', [...document.querySelectorAll('.apply-bp-client-cb:checked')].map(el => el.value))">Apply to Selected</button>
            </div>
        </div>
    `;
};

// Re-render just the client list (used by the search box) — keeps the
// currently-checked boxes checked instead of wiping the whole modal.
OL._refreshApplyBlueprintList = function(blueprintId, query) {
    const checked = new Set([...document.querySelectorAll('.apply-bp-client-cb:checked')].map(el => el.value));
    const listEl = document.getElementById('apply-bp-client-list');
    if (!listEl) return;

    const clients = Object.values(state.clients || {}).sort((a, b) =>
        (a.meta?.name || '').localeCompare(b.meta?.name || '')
    );
    const applications = OL.getBlueprintApplications(blueprintId);
    const appliedClientIds = new Set(applications.map(a => a.clientId));

    const q = (query || '').toLowerCase().trim();
    const filter = OL._applyBpFilter || 'all';
    const visibleClients = clients.filter(c => {
        const matchesQuery = !q || (c.meta?.name || c.id).toLowerCase().includes(q);
        const isApplied = appliedClientIds.has(c.id);
        const matchesFilter = filter === 'all' || (filter === 'applied' ? isApplied : !isApplied);
        return matchesQuery && matchesFilter;
    });

    listEl.innerHTML = visibleClients.length ? visibleClients.map(c => `
        <label style="display:flex; align-items:center; gap:8px; font-size:12px; cursor:pointer; padding:6px 8px; border:1px solid var(--line); border-radius:6px;">
            <input type="checkbox" class="apply-bp-client-cb" value="${c.id}" ${checked.has(c.id) ? 'checked' : ''}>
            <span style="flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(c.meta?.name || c.id)}</span>
            ${appliedClientIds.has(c.id) ? `<span class="pill tiny soft" style="flex-shrink:0; font-size:9px;">Already applied</span>` : ''}
        </label>
    `).join('') : `<div class="tiny muted" style="padding:8px;">No clients match.</div>`;
};

OL._setApplyBlueprintFilter = function(blueprintId, filter) {
    OL._applyBpFilter = filter;
    const searchInput = document.querySelector('#apply-bp-client-list')?.parentElement?.querySelector('input[type="text"]');
    openModal(OL._renderApplyBlueprintModalHTML(blueprintId, searchInput?.value || ''));
};

// ================= SOPs (grouped blueprints) =================

OL.openSopModal = function(sopId) {
    const sops = state.master.sops || [];
    const sop = sopId ? sops.find(s => s.id === sopId) : null;
    const blueprints = state.master.taskBlueprints || [];

    // Normalize into the in-memory editing array (supports older SOPs saved
    // as a flat blueprintIds list, before relative due dates existed).
    window._sopEditingItems = sop?.items
        ? JSON.parse(JSON.stringify(sop.items))
        : (sop?.blueprintIds || []).map(id => ({ blueprintId: id, dueMode: 'default', relativeToIndex: null, offsetDays: null }));

    const html = `
        <div class="modal-head">
            <div class="modal-title-text">${sop ? 'Edit' : 'New'} SOP</div>
            <div class="spacer"></div>
            <button class="btn small soft" onclick="OL.closeModal()">Close</button>
        </div>
        <div class="modal-body">
            <label class="modal-section-label">Name</label>
            <input type="text" id="sop-name" class="modal-input" value="${esc(sop?.name || '')}" placeholder="e.g. New Client Onboarding">

            <label class="modal-section-label">Description</label>
            <textarea id="sop-description" class="modal-input" style="height:60px;">${esc(sop?.description || '')}</textarea>

            <label class="modal-section-label">Add a Blueprint</label>
            <div style="display:flex; gap:6px;">
                <select id="sop-add-blueprint" class="modal-input tiny" style="flex:1;">
                    <option value="">Select a blueprint...</option>
                    ${blueprints.map(bp => `<option value="${bp.id}">${esc(bp.title)}</option>`).join('')}
                </select>
                <button type="button" class="btn tiny primary" onclick="OL.addSopItem()">Add</button>
            </div>

            <label class="modal-section-label">Workflow Order</label>
            <p class="tiny muted" style="margin-top:-6px; margin-bottom:8px;">Applied in this order. Each task can either use its blueprint's own due-date offset, or be due N days after an earlier task in this SOP is completed.</p>
            <div id="sop-items-list" style="max-height:320px; overflow-y:auto;"></div>

            <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:20px;">
                <button class="btn soft" onclick="OL.closeModal()">Cancel</button>
                <button class="btn primary" onclick="OL.saveSop('${sop?.id || ''}')">Save SOP</button>
            </div>
        </div>
    `;
    openModal(html);
    OL.renderSopItemsEditor();
};

OL.addSopItem = function() {
    const blueprintId = document.getElementById('sop-add-blueprint')?.value;
    if (!blueprintId) return;
    window._sopEditingItems = window._sopEditingItems || [];
    window._sopEditingItems.push({ blueprintId, dueMode: 'default', relativeToIndex: null, offsetDays: 3 });
    OL.renderSopItemsEditor();
};

OL.removeSopItem = function(index) {
    window._sopEditingItems.splice(index, 1);
    // Fix up any relative references that pointed at, or after, the removed item.
    window._sopEditingItems.forEach(item => {
        if (item.relativeToIndex === index) { item.dueMode = 'default'; item.relativeToIndex = null; }
        else if (item.relativeToIndex !== null && item.relativeToIndex !== undefined && item.relativeToIndex > index) item.relativeToIndex -= 1;
    });
    OL.renderSopItemsEditor();
};

OL.updateSopItemField = function(index, field, value) {
    const item = window._sopEditingItems?.[index];
    if (!item) return;
    if (field === 'relativeToIndex') item[field] = value === '' ? null : Number(value);
    else if (field === 'offsetDays') item[field] = value === '' ? null : Number(value);
    else item[field] = value;
    if (field === 'dueMode' && value !== 'relative') item.relativeToIndex = null;
    OL.renderSopItemsEditor();
};

OL.renderSopItemsEditor = function() {
    const container = document.getElementById('sop-items-list');
    if (!container) return;
    const blueprints = state.master.taskBlueprints || [];
    const items = window._sopEditingItems || [];

    container.innerHTML = items.length === 0 ? `<p class="tiny muted">No blueprints added yet.</p>` : items.map((item, i) => {
        const bp = blueprints.find(b => b.id === item.blueprintId);
        const priorItems = items.slice(0, i); // only earlier items are valid predecessors — no forward/circular refs

        return `
            <div class="card-section" style="margin-bottom:8px; padding:10px;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <strong class="tiny">${i + 1}. ${esc(bp?.title || '(deleted blueprint)')}</strong>
                    <button type="button" class="btn tiny soft" onclick="OL.removeSopItem(${i})" title="Remove"><i data-lucide="x" style="width:11px;height:11px;"></i></button>
                </div>
                <div style="display:flex; align-items:center; gap:6px; margin-top:6px; flex-wrap:wrap;">
                    <select class="modal-input tiny" style="width:auto;" onchange="OL.updateSopItemField(${i}, 'dueMode', this.value)">
                        <option value="default" ${item.dueMode !== 'relative' ? 'selected' : ''}>Use blueprint's own due offset</option>
                        <option value="relative" ${item.dueMode === 'relative' ? 'selected' : ''} ${priorItems.length === 0 ? 'disabled' : ''}>Due relative to an earlier task</option>
                    </select>
                    ${item.dueMode === 'relative' ? `
                        <select class="modal-input tiny" style="width:auto;" onchange="OL.updateSopItemField(${i}, 'relativeToIndex', this.value)">
                            <option value="">Select task...</option>
                            ${priorItems.map((pItem, pIdx) => {
                                const pBp = blueprints.find(b => b.id === pItem.blueprintId);
                                return `<option value="${pIdx}" ${item.relativeToIndex === pIdx ? 'selected' : ''}>${pIdx + 1}. ${esc(pBp?.title || '?')}</option>`;
                            }).join('')}
                        </select>
                        <span class="tiny">due</span>
                        <input type="number" min="0" class="modal-input tiny" style="width:55px;" value="${item.offsetDays ?? 3}" onchange="OL.updateSopItemField(${i}, 'offsetDays', this.value)">
                        <span class="tiny">days after it's completed</span>
                    ` : ''}
                </div>
            </div>
        `;
    }).join('');
    if (window.lucide) lucide.createIcons();
};

OL.saveSop = function(sopId) {
    const name = document.getElementById('sop-name')?.value?.trim();
    if (!name) { alert('Give the SOP a name first.'); return; }

    const description = document.getElementById('sop-description')?.value || '';
    const items = (window._sopEditingItems || []).filter(i => i.blueprintId);

    for (const item of items) {
        if (item.dueMode === 'relative' && (item.relativeToIndex === null || item.relativeToIndex === undefined)) {
            alert('Pick which earlier task each relative due date is based on (or switch it back to "use blueprint\'s own due offset").');
            return;
        }
    }

    updateAndSync(() => {
        if (!state.master.sops) state.master.sops = [];
        const blueprintIds = items.map(i => i.blueprintId); // kept for backward compatibility with any older reader
        if (sopId) {
            const existing = state.master.sops.find(s => s.id === sopId);
            if (existing) Object.assign(existing, { name, description, items, blueprintIds });
        } else {
            state.master.sops.push({
                id: uid(),
                name, description, items, blueprintIds,
                createdAt: new Date().toISOString()
            });
        }
    });

    window._sopEditingItems = null;
    OL.closeModal();
    OL.renderMasterTaskBlueprints();
};

OL.deleteSop = function(sopId) {
    if (!confirm('Delete this SOP? The blueprints and tasks it already created are unaffected.')) return;
    updateAndSync(() => {
        state.master.sops = (state.master.sops || []).filter(s => s.id !== sopId);
    });
    OL.renderMasterTaskBlueprints();
};

// Applies every blueprint in an SOP to a client in one shot — one
// updateAndSync call so all the resulting tasks land in a single
// persist cycle instead of one write per blueprint.
// Normalizes an SOP's items (supports old SOPs saved as a flat
// blueprintIds list, before relative due dates existed) and resolves
// each to its actual blueprint object.
OL.resolveSopItems = function(sop) {
    const items = (sop.items && sop.items.length)
        ? sop.items
        : (sop.blueprintIds || []).map(id => ({ blueprintId: id, dueMode: 'default' }));
    return items
        .map(item => ({ ...item, blueprint: (state.master.taskBlueprints || []).find(b => b.id === item.blueprintId) }))
        .filter(item => item.blueprint);
};

// Creates every task in an SOP for a client in one shot, wiring relative
// due dates between the tasks created in THIS run — so "task 2 due 3 days
// after task 1 completes" works even though both are brand new right now.
// baseCtx is passed through to buildTaskFromBlueprint for each task (so
// automation-fired SOPs can carry resourceName/title placeholders, an
// asSubtask flag, etc. — see automations.js).
OL.createTasksFromSop = function(sop, client, baseCtx) {
    const items = OL.resolveSopItems(sop);
    const createdTasks = [];

    items.forEach(item => {
        const newTask = OL.buildTaskFromBlueprint(item.blueprint, client, baseCtx || {});
        newTask.sopId = sop.id;

        if (item.dueMode === 'relative' && item.relativeToIndex !== null && item.relativeToIndex !== undefined && createdTasks[item.relativeToIndex]) {
            const predecessorTask = createdTasks[item.relativeToIndex];
            newTask.dueRelativeTo = {
                taskId: predecessorTask.id,
                offsetDays: Number(item.offsetDays) || 0,
                predecessorTitle: predecessorTask.title
            };
            newTask.dueDate = ''; // unresolved until the predecessor completes
        }

        createdTasks.push(newTask);
        client.projectData.clientTasks.unshift(newTask);
    });

    return createdTasks;
};

// Every task ever created from this SOP, across every client — grouped
// per client since one SOP application creates several tasks at once
// (mirrors OL.getBlueprintApplications' per-task shape for single blueprints).
OL.getSopApplications = function(sopId) {
    const results = [];
    Object.values(state.clients || {}).forEach(client => {
        const tasks = (client.projectData?.clientTasks || []).filter(t => t.sopId === sopId);
        if (tasks.length) {
            results.push({
                clientId: client.id,
                clientName: client.meta?.name || client.id,
                taskCount: tasks.length,
                firstTaskId: tasks[0].id
            });
        }
    });
    return results;
};

OL.applySopToClient = function(sopId, clientId) {
    const sop = (state.master.sops || []).find(s => s.id === sopId);
    if (!sop) return;
    if (!clientId) { alert('Pick a client first.'); return; }

    const items = OL.resolveSopItems(sop);
    if (items.length === 0) {
        alert('This SOP has no blueprints in it yet — edit it and add some first.');
        return;
    }

    updateAndSync(() => {
        const client = state.clients?.[clientId];
        if (!client) return;
        if (!client.projectData) client.projectData = {};
        if (!client.projectData.clientTasks) client.projectData.clientTasks = [];
        OL.createTasksFromSop(sop, client, {});
    }, clientId);

    OL.closeModal();
    alert(`"${sop.name}" (${items.length} task${items.length === 1 ? '' : 's'}) applied to ${state.clients[clientId]?.meta?.name || clientId}.`);
};

// Bulk variant — same shape as OL.applyTaskBlueprintToClients.
OL.applySopToClients = function(sopId, clientIds) {
    const sop = (state.master.sops || []).find(s => s.id === sopId);
    if (!sop) return;
    if (!clientIds || !clientIds.length) { alert('Pick at least one client first.'); return; }

    const items = OL.resolveSopItems(sop);
    if (items.length === 0) {
        alert('This SOP has no blueprints in it yet — edit it and add some first.');
        return;
    }

    clientIds.forEach(clientId => {
        updateAndSync(() => {
            const client = state.clients?.[clientId];
            if (!client) return;
            if (!client.projectData) client.projectData = {};
            if (!client.projectData.clientTasks) client.projectData.clientTasks = [];
            OL.createTasksFromSop(sop, client, {});
        }, clientId);
    });

    OL.closeModal();
    alert(`"${sop.name}" applied to ${clientIds.length} client${clientIds.length === 1 ? '' : 's'}.`);
};

OL.openApplySopModal = function(sopId) {
    const sop = (state.master.sops || []).find(s => s.id === sopId);
    if (!sop) return;

    OL._applySopFilter = 'all'; // 'all' | 'applied' | 'not-applied'
    openModal(OL._renderApplySopModalHTML(sopId));
};

// Same structure as OL._renderApplyBlueprintModalHTML — kept as a
// separate (not shared/generalized) function so each stays easy to read
// on its own, at the cost of some duplication between the two.
OL._renderApplySopModalHTML = function(sopId, query) {
    const sop = (state.master.sops || []).find(s => s.id === sopId);
    if (!sop) return '';

    const clients = Object.values(state.clients || {}).sort((a, b) =>
        (a.meta?.name || '').localeCompare(b.meta?.name || '')
    );
    const applications = OL.getSopApplications(sopId);
    const appliedClientIds = new Set(applications.map(a => a.clientId));
    const taskCount = (sop.blueprintIds || []).length || (sop.items || []).length;

    const q = (query || '').toLowerCase().trim();
    const filter = OL._applySopFilter || 'all';
    const visibleClients = clients.filter(c => {
        const matchesQuery = !q || (c.meta?.name || c.id).toLowerCase().includes(q);
        const isApplied = appliedClientIds.has(c.id);
        const matchesFilter = filter === 'all' || (filter === 'applied' ? isApplied : !isApplied);
        return matchesQuery && matchesFilter;
    });

    return `
        <div class="modal-head">
            <div class="modal-title-text">Apply "${esc(sop.name)}"</div>
            <div class="spacer"></div>
            <button class="btn small soft" onclick="OL.closeModal()">Close</button>
        </div>
        <div class="modal-body" style="max-width:560px; width:100%;">
            <label class="modal-section-label">Apply to Clients (${clients.length})</label>
            <p class="tiny muted" style="margin-top:-4px; margin-bottom:10px;">Check any number of clients — applying creates ${taskCount} fresh task${taskCount === 1 ? '' : 's'} for each one.</p>

            <div style="display:flex; gap:8px; margin-bottom:10px;">
                <input type="text" class="modal-input tiny" style="flex:1;" placeholder="Search clients..."
                       value="${esc(query || '')}"
                       oninput="OL._refreshApplySopList('${sopId}', this.value)">
                <div style="display:flex; gap:4px; flex-shrink:0;">
                    <button class="btn tiny ${filter === 'all' ? 'primary' : 'soft'}" onclick="OL._setApplySopFilter('${sopId}', 'all')">All</button>
                    <button class="btn tiny ${filter === 'not-applied' ? 'primary' : 'soft'}" onclick="OL._setApplySopFilter('${sopId}', 'not-applied')">Not Applied</button>
                    <button class="btn tiny ${filter === 'applied' ? 'primary' : 'soft'}" onclick="OL._setApplySopFilter('${sopId}', 'applied')">Applied</button>
                </div>
            </div>

            <div id="apply-sop-client-list" style="display:grid; gap:6px; max-height:260px; overflow:auto; margin-bottom:14px; border:1px solid var(--line); border-radius:8px; padding:8px;">
                ${visibleClients.length ? visibleClients.map(c => `
                    <label style="display:flex; align-items:center; gap:8px; font-size:12px; cursor:pointer; padding:6px 8px; border:1px solid var(--line); border-radius:6px;">
                        <input type="checkbox" class="apply-sop-client-cb" value="${c.id}">
                        <span style="flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(c.meta?.name || c.id)}</span>
                        ${appliedClientIds.has(c.id) ? `<span class="pill tiny soft" style="flex-shrink:0; font-size:9px;">Already applied</span>` : ''}
                    </label>
                `).join('') : `<div class="tiny muted" style="padding:8px;">No clients match.</div>`}
            </div>

            ${applications.length ? `
                <label class="modal-section-label">Applied To (${applications.length})</label>
                <div style="display:grid; gap:6px; max-height:160px; overflow:auto; margin-bottom:14px;">
                    ${applications.map(a => `
                        <div class="tiny" style="display:flex; justify-content:space-between; align-items:center; gap:8px; padding:6px 8px; background:rgba(255,255,255,0.02); border:1px solid var(--line); border-radius:6px; cursor:pointer;" onclick="OL.closeModal(); OL.openTaskInContext('${a.clientId}', '${a.firstTaskId}')">
                            <span style="min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(a.clientName)}</span>
                            <span class="pill tiny soft" style="flex-shrink:0;">${a.taskCount} task${a.taskCount === 1 ? '' : 's'}</span>
                        </div>
                    `).join('')}
                </div>
            ` : ''}

            <div style="display:flex; justify-content:flex-end; gap:10px;">
                <button class="btn soft" onclick="OL.closeModal()">Cancel</button>
                <button class="btn primary" onclick="OL.applySopToClients('${sopId}', [...document.querySelectorAll('.apply-sop-client-cb:checked')].map(el => el.value))">Apply to Selected</button>
            </div>
        </div>
    `;
};

OL._refreshApplySopList = function(sopId, query) {
    const checked = new Set([...document.querySelectorAll('.apply-sop-client-cb:checked')].map(el => el.value));
    const listEl = document.getElementById('apply-sop-client-list');
    if (!listEl) return;

    const clients = Object.values(state.clients || {}).sort((a, b) =>
        (a.meta?.name || '').localeCompare(b.meta?.name || '')
    );
    const applications = OL.getSopApplications(sopId);
    const appliedClientIds = new Set(applications.map(a => a.clientId));

    const q = (query || '').toLowerCase().trim();
    const filter = OL._applySopFilter || 'all';
    const visibleClients = clients.filter(c => {
        const matchesQuery = !q || (c.meta?.name || c.id).toLowerCase().includes(q);
        const isApplied = appliedClientIds.has(c.id);
        const matchesFilter = filter === 'all' || (filter === 'applied' ? isApplied : !isApplied);
        return matchesQuery && matchesFilter;
    });

    listEl.innerHTML = visibleClients.length ? visibleClients.map(c => `
        <label style="display:flex; align-items:center; gap:8px; font-size:12px; cursor:pointer; padding:6px 8px; border:1px solid var(--line); border-radius:6px;">
            <input type="checkbox" class="apply-sop-client-cb" value="${c.id}" ${checked.has(c.id) ? 'checked' : ''}>
            <span style="flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(c.meta?.name || c.id)}</span>
            ${appliedClientIds.has(c.id) ? `<span class="pill tiny soft" style="flex-shrink:0; font-size:9px;">Already applied</span>` : ''}
        </label>
    `).join('') : `<div class="tiny muted" style="padding:8px;">No clients match.</div>`;
};

OL._setApplySopFilter = function(sopId, filter) {
    OL._applySopFilter = filter;
    const searchInput = document.querySelector('#apply-sop-client-list')?.parentElement?.querySelector('input[type="text"]');
    openModal(OL._renderApplySopModalHTML(sopId, searchInput?.value || ''));
};
