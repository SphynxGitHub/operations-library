//======================= FEATURES / ROLES & COMP =======================//
// A master, editable list of roles (Sales, Scoping, Implementation,
// Testing, Communication by default) each carrying a default % of the
// project fee. Roles can be assigned to a team member at the PROJECT
// level (client.projectData.roleAssignments) and at the individual
// RESOURCE level (res.roleAssignment on a localResources entry) — both
// use the role's defaultPercent unless overridden for that assignment.
//
// state.master.roles is a NEW master-level field. Unlike client-level
// data (which rides inside the generic project_data JSONB blob and needs
// no schema change), state.master fields are individually whitelisted
// columns in core/data.js's persist()/sync() — this needs a `roles`
// jsonb column added to workspace_masters. See the accompanying SQL
// migration; this file assumes that column exists.

import { esc, uid, state, getActiveClient } from '../core/data.js';

const DEFAULT_ROLES = [
    { id: 'role-sales', name: 'Sales', defaultPercent: 10 },
    { id: 'role-scoping', name: 'Scoping', defaultPercent: 15 },
    { id: 'role-implementation', name: 'Implementation', defaultPercent: 50 },
    { id: 'role-testing', name: 'Testing', defaultPercent: 10 },
    { id: 'role-communication', name: 'Communication', defaultPercent: 15 }
];

export function getRoles() {
    if (!state.master) state.master = {};
    if (!state.master.roles || !state.master.roles.length) {
        state.master.roles = DEFAULT_ROLES.map(r => ({ ...r }));
    }
    return state.master.roles;
}

// ---------------------------------------------------------------
// ROLES MANAGER — the editable master list (name + default %)
// ---------------------------------------------------------------
export function openRolesManagerModal() {
    const roles = getRoles();
    const total = roles.reduce((s, r) => s + Number(r.defaultPercent || 0), 0);

    const html = `
        <div class="modal-head">
            <div class="modal-title-text">Comp Roles</div>
            <div class="spacer"></div>
            <button class="btn small soft" onclick="OL.closeModal()">Close</button>
        </div>
        <div class="modal-body">
            <p class="tiny muted" style="margin-bottom:12px;">
                Roles available to assign on any project or resource. The % is the default cut of the project
                fee for that role — it can be overridden per assignment.
            </p>
            <div id="roles-manager-rows">
                ${roles.map(r => `
                    <div class="ob-row ob-row-flex" data-role-id="${r.id}">
                        <input type="text" class="modal-input ob-name-field" value="${esc(r.name)}" onchange="OL.updateRoleField('${r.id}', 'name', this.value)">
                        <div style="position:relative; flex:0 0 100px;">
                            <input type="number" class="modal-input" min="0" max="100" value="${r.defaultPercent}" style="padding-right:24px; width:100%;" onchange="OL.updateRoleField('${r.id}', 'defaultPercent', this.value)">
                            <span class="tiny muted" style="position:absolute; right:8px; top:50%; transform:translateY(-50%); pointer-events:none;">%</span>
                        </div>
                        <button class="btn tiny soft ob-remove-row" onclick="OL.removeRole('${r.id}')"><i data-lucide="x" style="width:12px;height:12px;"></i></button>
                    </div>
                `).join('')}
            </div>
            <button class="btn small soft ob-add-more-btn" onclick="OL.addRole()">+ Add role</button>
            <div class="tiny muted" style="margin-top:12px;">Default allocation totals ${total}%${total !== 100 ? ' (doesn\'t need to add to 100 — just the starting point for new assignments)' : ''}.</div>
        </div>
    `;
    openModal(html);
    if (window.lucide) window.lucide.createIcons();
}

export function updateRoleField(roleId, field, value) {
    const role = getRoles().find(r => r.id === roleId);
    if (!role) return;
    role[field] = field === 'defaultPercent' ? Number(value) : value;
    OL.persist();
}

export function addRole() {
    getRoles().push({ id: 'role-' + uid(), name: 'New Role', defaultPercent: 0 });
    OL.persist();
    openRolesManagerModal();
}

export function removeRole(roleId) {
    if (!confirm('Remove this role? Existing assignments using it will keep their saved name/percent but won\'t update if you edit the role further.')) return;
    state.master.roles = getRoles().filter(r => r.id !== roleId);
    OL.persist();
    openRolesManagerModal();
}

// ---------------------------------------------------------------
// PROJECT-LEVEL DEFAULTS — one default person per role, at that role's
// % of the project fee. This is what "auto-applies" to every resource in
// the project: a resource with no role override of its own is counted
// under its role's project-level default person.
//
// RESOURCE-LEVEL OVERRIDE — a resource can be tagged with a role + a
// specific person, overriding the project default for that one resource.
// When more than one person ends up covering the same role (the project
// default plus one or more resource-level overrides pointing at someone
// else), the role's % of the fee is split between them, weighted by how
// many resources each of them is covering for that role — two people
// each covering one resource under "Sales" split that role's cut 50/50;
// someone covering 3 resources to another's 1 splits it 75/25.
// ---------------------------------------------------------------
function computeFee(client) {
    return Number(client.meta?.projectFee || 0);
}

// The actual rollup: for every role, who's covering it and what share of
// that role's dollar amount each of them earns.
export function computeRoleCompSplits(client) {
    const roles = getRoles();
    const fee = computeFee(client);
    const defaults = client.projectData?.roleAssignments || [];
    const resources = client.projectData?.localResources || [];

    return roles.map(role => {
        const defaultAssignment = defaults.find(a => a.roleId === role.id);
        const percent = defaultAssignment ? Number(defaultAssignment.percent) : Number(role.defaultPercent || 0);
        const roleResources = resources.filter(r => r.roleAssignment?.roleId === role.id);

        // Units = resource count per person. A resource with no
        // resource-level override still counts as one unit for the
        // project default person, so an unmodified role still resolves
        // to "one person, 100% of the role's cut."
        const units = {};
        if (roleResources.length) {
            roleResources.forEach(r => {
                const name = r.roleAssignment.memberName || defaultAssignment?.memberName || '';
                if (!name) return;
                units[name] = (units[name] || 0) + 1;
            });
        } else if (defaultAssignment?.memberName) {
            units[defaultAssignment.memberName] = 1;
        }

        const totalUnits = Object.values(units).reduce((s, n) => s + n, 0);
        const roleAmount = fee ? fee * percent / 100 : null;
        const people = Object.entries(units).map(([name, n]) => {
            const share = totalUnits ? n / totalUnits : 0;
            return {
                name, resourceCount: n, share,
                amount: roleAmount !== null ? roleAmount * share : null
            };
        }).sort((a, b) => b.share - a.share);

        return { role, percent, defaultName: defaultAssignment?.memberName || '', amount: roleAmount, people };
    });
}

export function openProjectRoleAssignmentsModal(clientId) {
    const client = state.clients[clientId];
    if (!client) return;
    if (!client.projectData.roleAssignments) client.projectData.roleAssignments = [];

    const roles = getRoles();
    const team = state.master.sphynxTeam || [];
    const fee = computeFee(client);
    const splits = computeRoleCompSplits(client);
    const totalPercent = splits.reduce((s, x) => s + Number(x.percent || 0), 0);

    const html = `
        <div class="modal-head">
            <div class="modal-title-text">Role Assignments & Comp — ${esc(client.meta?.name || 'Project')}</div>
            <div class="spacer"></div>
            <button class="btn small soft" onclick="OL.closeModal()">Close</button>
        </div>
        <div class="modal-body">
            <div class="ob-field" style="max-width:220px; margin-bottom:16px;">
                <label>Project Total Fee</label>
                <input type="number" class="modal-input" min="0" value="${fee}" onchange="OL.updateProjectFee('${clientId}', this.value)">
            </div>

            <p class="tiny muted" style="margin-bottom:10px;">
                Set a default person per role — this auto-applies to every resource in the project.
                Override it on a specific resource (from that resource's card) if someone else covers it instead;
                when more than one person ends up covering a role, its cut splits between them by how many
                resources each of them has.
            </p>

            <label class="modal-section-label">Role Defaults</label>
            <div id="role-assignment-rows">
                ${roles.map(role => renderProjectRoleRow(client, role, team, fee, splits)).join('')}
            </div>

            <div class="tiny muted" style="margin-top:14px;">
                Default allocation totals ${totalPercent}%${totalPercent > 100 ? ' — over 100%, double check the role %s below.' : ''}
            </div>
        </div>
    `;
    openModal(html);
    if (window.lucide) window.lucide.createIcons();
}

function renderProjectRoleRow(client, role, team, fee, splits) {
    const assignment = (client.projectData.roleAssignments || []).find(a => a.roleId === role.id);
    const percent = assignment ? assignment.percent : role.defaultPercent;
    const split = splits.find(s => s.role.id === role.id);
    const amount = fee ? (fee * Number(percent || 0) / 100) : null;

    const splitHtml = split && split.people.length > 1 ? `
        <div class="tiny muted" style="flex-basis:100%; padding-left:2px; margin-top:-2px;">
            Split: ${split.people.map(p => `${esc(p.name)} ${(p.share * 100).toFixed(0)}%${amount !== null ? ` ($${p.amount.toFixed(2)})` : ''}`).join(', ')}
        </div>
    ` : '';

    return `
        <div class="ob-row ob-row-flex" style="flex-wrap:wrap;">
            <div class="tiny bold" style="flex:0 0 140px; align-self:center;">${esc(role.name)}</div>
            <select class="modal-input" style="flex:1 1 160px;" onchange="OL.updateProjectRoleDefault('${client.id}', '${role.id}', 'memberName', this.value)">
                <option value="">Unassigned</option>
                ${team.map(m => `<option value="${esc(m.name)}" ${assignment?.memberName === m.name ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}
            </select>
            <div style="position:relative; flex:0 0 90px;">
                <input type="number" class="modal-input" min="0" max="100" value="${percent}" style="padding-right:22px; width:100%;" onchange="OL.updateProjectRoleDefault('${client.id}', '${role.id}', 'percent', this.value)">
                <span class="tiny muted" style="position:absolute; right:8px; top:50%; transform:translateY(-50%); pointer-events:none;">%</span>
            </div>
            ${amount !== null ? `<span class="tiny muted" style="flex:0 0 80px; align-self:center;">$${amount.toFixed(2)}</span>` : ''}
            ${splitHtml}
        </div>
    `;
}

export function updateProjectFee(clientId, value) {
    const client = state.clients[clientId];
    if (!client) return;
    client.meta.projectFee = Number(value) || 0;
    OL.markClientDirty(clientId);
    OL.persist();
    openProjectRoleAssignmentsModal(clientId);
}

// Upserts the project-level default for one role (there's exactly one
// default assignment per role, not a free-form list).
export function updateProjectRoleDefault(clientId, roleId, field, value) {
    const client = state.clients[clientId];
    if (!client) return;
    if (!client.projectData.roleAssignments) client.projectData.roleAssignments = [];

    let a = client.projectData.roleAssignments.find(x => x.roleId === roleId);
    if (!a) {
        const role = getRoles().find(r => r.id === roleId);
        a = { id: uid(), roleId, memberName: '', percent: role?.defaultPercent || 0 };
        client.projectData.roleAssignments.push(a);
    }

    if (field === 'percent') a.percent = Number(value) || 0;
    else a[field] = value;

    OL.markClientDirty(clientId);
    OL.persist();
    openProjectRoleAssignmentsModal(clientId);
}

// ---------------------------------------------------------------
// RESOURCE-LEVEL OVERRIDE — role + person on one resource. No % here:
// the % lives on the project-level role and gets split automatically
// across whoever ends up covering that role (see computeRoleCompSplits).
// ---------------------------------------------------------------
export function openResourceRoleAssignmentModal(resourceId) {
    const client = getActiveClient();
    if (!client) return;
    const res = (client.projectData.localResources || []).find(r => r.id === resourceId);
    if (!res) return;

    const roles = getRoles();
    const team = state.master.sphynxTeam || [];
    const current = res.roleAssignment || {};

    const html = `
        <div class="modal-head">
            <div class="modal-title-text">Role — ${esc(res.name || 'Resource')}</div>
            <div class="spacer"></div>
            <button class="btn small soft" onclick="OL.closeModal()">Close</button>
        </div>
        <div class="modal-body">
            <p class="tiny muted" style="margin-bottom:10px;">
                Leave "Assigned To" as the role's project default unless someone else specifically covered this resource.
            </p>
            <div class="ob-field-grid">
                <div class="ob-field">
                    <label>Role</label>
                    <select id="res-role-select" class="modal-input" onchange="OL.onResourceRoleSelectChange('${resourceId}', this.value)">
                        <option value="">None</option>
                        ${roles.map(r => `<option value="${r.id}" ${current.roleId === r.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}
                    </select>
                </div>
                <div class="ob-field">
                    <label>Assigned To</label>
                    <select id="res-role-member" class="modal-input">
                        <option value="">Project default</option>
                        ${team.map(m => `<option value="${esc(m.name)}" ${current.memberName === m.name ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}
                    </select>
                </div>
            </div>
            <div style="display:flex; justify-content:flex-end; margin-top:16px;">
                <button class="btn small primary" onclick="OL.saveResourceRoleAssignment('${resourceId}')">Save</button>
            </div>
        </div>
    `;
    openModal(html);
    if (window.lucide) window.lucide.createIcons();
}

// When the role dropdown changes, pre-select that role's project-default
// person in the "Assigned To" field (just a UI convenience — saving with
// the "Project default" option keeps it unset either way).
export function onResourceRoleSelectChange(resourceId, roleId) {
    const client = getActiveClient();
    const memberSelect = document.getElementById('res-role-member');
    if (!client || !memberSelect) return;
    const defaultAssignment = (client.projectData.roleAssignments || []).find(a => a.roleId === roleId);
    if (defaultAssignment?.memberName) {
        const opt = Array.from(memberSelect.options).find(o => o.value === defaultAssignment.memberName);
        if (opt) memberSelect.value = defaultAssignment.memberName;
    }
}

export function saveResourceRoleAssignment(resourceId) {
    const client = getActiveClient();
    if (!client) return;
    const res = (client.projectData.localResources || []).find(r => r.id === resourceId);
    if (!res) return;

    const roleId = document.getElementById('res-role-select')?.value || '';
    const memberName = document.getElementById('res-role-member')?.value || '';

    res.roleAssignment = roleId ? { roleId, memberName } : null;
    OL.markClientDirty(client.id);
    OL.persist();
    OL.closeModal();
    if (typeof window.renderResourceManager === 'function') window.renderResourceManager();
};

export function getResourceRoleLabel(res) {
    if (!res.roleAssignment) return 'Assign role';
    const role = getRoles().find(r => r.id === res.roleAssignment.roleId);
    const roleName = role?.name || 'Role';
    return res.roleAssignment.memberName ? `${roleName} — ${res.roleAssignment.memberName}` : `${roleName} — project default`;
}

window.OL = window.OL || {};
Object.assign(window.OL, {
    getRoles, openRolesManagerModal, updateRoleField, addRole, removeRole,
    computeRoleCompSplits, openProjectRoleAssignmentsModal, updateProjectFee,
    updateProjectRoleDefault, openResourceRoleAssignmentModal,
    onResourceRoleSelectChange, saveResourceRoleAssignment, getResourceRoleLabel
});
