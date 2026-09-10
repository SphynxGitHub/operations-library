// ================= 🏛️ MASTER TASK BLUEPRINTS (Template Library) =================
// state.master.taskBlueprints — reusable task templates at the vault level.
// This is the "Master Tasks" sidebar item under Template Vault. Distinct
// from a client's own projectData.clientTasks.

import { esc, uid, state, updateAndSync } from '../core/data.js';

OL.renderMasterTaskBlueprints = function() {
    const main = document.getElementById("mainContent");
    if (!main) return;

    const blueprints = state.master.taskBlueprints || [];

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
                            <button class="btn tiny soft" onclick="OL.openTaskBlueprintModal('${bp.id}')" title="Edit"><i data-lucide="pencil" style="width:11px;height:11px;"></i></button>
                            <button class="btn tiny" style="background:#ef4444;color:white;" onclick="OL.deleteTaskBlueprint('${bp.id}')" title="Delete"><i data-lucide="trash-2" style="width:11px;height:11px;"></i></button>
                        </div>
                    </div>
                    ${bp.description ? `<div class="tiny muted" style="margin-top:6px;">${esc(bp.description)}</div>` : ''}
                    <div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:10px;">
                        ${bp.defaultAssignee ? `<span class="pill tiny soft">👤 ${esc(bp.defaultAssignee)}</span>` : ''}
                        ${bp.defaultStatus ? `<span class="pill tiny soft">${esc(bp.defaultStatus)}</span>` : ''}
                        ${bp.dueInDays !== undefined && bp.dueInDays !== null && bp.dueInDays !== '' ? `<span class="pill tiny soft">Due +${esc(bp.dueInDays)}d</span>` : ''}
                        ${(bp.howToIds || []).length ? `<span class="pill tiny soft">📖 ${bp.howToIds.length} guide${bp.howToIds.length === 1 ? '' : 's'}</span>` : ''}
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
            <label class="modal-section-label">Title</label>
            <input type="text" id="bp-title" class="modal-input" value="${esc(bp?.title || '')}" placeholder="e.g. Implementation: {resource}">

            <label class="modal-section-label">Description</label>
            <textarea id="bp-description" class="modal-input" style="height:70px;">${esc(bp?.description || '')}</textarea>

            <div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap:8px; margin-top:12px;">
                <div>
                    <label class="tiny muted uppercase bold">Default Assignee</label>
                    <input type="text" id="bp-assignee" class="modal-input tiny" value="${esc(bp?.defaultAssignee || 'Sphynx Task')}">
                </div>
                <div>
                    <label class="tiny muted uppercase bold">Default Status</label>
                    <input type="text" id="bp-status" class="modal-input tiny" value="${esc(bp?.defaultStatus || 'Pending Sphynx Action')}">
                </div>
                <div>
                    <label class="tiny muted uppercase bold">Due In (days)</label>
                    <input type="number" id="bp-due" class="modal-input tiny" value="${esc(bp?.dueInDays ?? '')}" placeholder="optional">
                </div>
            </div>

            <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:20px;">
                <button class="btn soft" onclick="OL.closeModal()">Cancel</button>
                <button class="btn primary" onclick="OL.saveTaskBlueprint('${bp?.id || ''}')">Save Blueprint</button>
            </div>
        </div>
    `;
    openModal(html);
};

OL.saveTaskBlueprint = function(blueprintId) {
    const title = document.getElementById('bp-title')?.value?.trim();
    if (!title) { alert('Give the blueprint a title first.'); return; }

    const description = document.getElementById('bp-description')?.value || '';
    const defaultAssignee = document.getElementById('bp-assignee')?.value || 'Sphynx Task';
    const defaultStatus = document.getElementById('bp-status')?.value || 'Pending Sphynx Action';
    const dueRaw = document.getElementById('bp-due')?.value;
    const dueInDays = dueRaw === '' || dueRaw === undefined ? null : Number(dueRaw);

    updateAndSync(() => {
        if (!state.master.taskBlueprints) state.master.taskBlueprints = [];
        if (blueprintId) {
            const existing = state.master.taskBlueprints.find(b => b.id === blueprintId);
            if (existing) Object.assign(existing, { title, description, defaultAssignee, defaultStatus, dueInDays });
        } else {
            state.master.taskBlueprints.push({
                id: uid(),
                title, description, defaultAssignee, defaultStatus, dueInDays,
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
