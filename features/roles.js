//======================= FEATURES / ROLES & COMP =======================//
// A master, editable list of roles (Sales, Scoping, Implementation,
// Testing, Communication by default), each carrying a default % of a
// working round's approved fee.
//
// Two distinct things live here, kept separate on purpose:
//
//   1. ROLE DEFAULTS (client.projectData.roleAssignments) — one default
//      person per role, project-wide. This is NOT comp — it's the
//      suggestion mechanism several other features read from (who to
//      auto-assign a "Communication" task to, who a meeting's follow-up
//      goes to, etc. — see core/testing.js's assigneeForRole and its
//      callers in core/conclusion.js, features/scoping.js, and
//      features/business/meeting-summary.js). Left untouched here.
//
//   2. ROUND-LEVEL COMP TRACKING (this file's new part) — for one working
//      round, an internal-only, auto-tracked view of who's actually doing
//      the work, by role bucket, and what share of that round's approved
//      fee each person's cut works out to. Nothing here is editable per
//      task — it's a rollup of task assignments that already exist:
//        - Communication and Testing tasks are identified by how the app
//          itself tags them when it generates them (see taskCompRoleId).
//        - Everything else Sphynx-side counts as Implementation.
//        - Sales and Scoping have no task trail to roll up (that work
//          happens before a round exists), so those two still show the
//          single project-level default person at 100% — worth a second
//          pass once there's a way to track that work too.
//      The role's cut of the round's fee is still governed by that
//      role's default % (state.master.roles) — splitting THAT more
//      finely is a later step (see openRoundRoleAssignmentsModal's note).
//
// state.master.roles is a NEW master-level field. Unlike client-level
// data (which rides inside the generic project_data JSONB blob and needs
// no schema change), state.master fields are individually whitelisted
// columns in core/data.js's persist()/sync() — this needs a `roles`
// jsonb column added to workspace_masters. See the accompanying SQL
// migration; this file assumes that column exists.

import { esc, uid, state, getActiveClient } from '../core/data.js';
import { tasksForItem } from '../core/work-status.js';

const DEFAULT_ROLES = [
    { id: 'role-sales', name: 'Sales', defaultPercent: 10 },
    { id: 'role-scoping', name: 'Scoping', defaultPercent: 15 },
    { id: 'role-implementation', name: 'Implementation', defaultPercent: 50 },
    { id: 'role-testing', name: 'Testing', defaultPercent: 10 },
    { id: 'role-communication', name: 'Communication', defaultPercent: 15 }
];

// Roles with no task trail to auto-track yet — see file header.
const MANUAL_ONLY_ROLES = ['role-sales', 'role-scoping'];

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
                Roles available across the app. The % is that role's default cut of a working round's
                approved fee, shown on that round's Role Assignments &amp; Comp view.
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
            <div class="tiny muted" style="margin-top:12px;">Default allocation totals ${total}%${total !== 100 ? ' (doesn\'t need to add to 100 — just the starting point)' : ''}.</div>
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
// ROLE DEFAULTS — one default person per role, project-wide. Used only
// as a suggestion source elsewhere in the app (see file header) — this
// is deliberately NOT where comp dollars are figured anymore.
// ---------------------------------------------------------------
export function openRoleDefaultsModal(clientId) {
    const client = state.clients[clientId];
    if (!client) return;
    if (!client.projectData.roleAssignments) client.projectData.roleAssignments = [];

    const roles = getRoles();
    const team = state.master.sphynxTeam || [];

    const html = `
        <div class="modal-head">
            <div class="modal-title-text">Role Defaults — ${esc(client.meta?.name || 'Project')}</div>
            <div class="spacer"></div>
            <button class="btn small soft" onclick="OL.closeModal()">Close</button>
        </div>
        <div class="modal-body">
            <p class="tiny muted" style="margin-bottom:10px;">
                Who this project auto-suggests for each role's work (communication follow-ups, etc.).
                This isn't comp — for the round-by-round breakdown of who's actually doing the work and their
                cut of the fee, open a working round's Role Assignments &amp; Comp from the Scoping tab.
            </p>
            <div id="role-defaults-rows">
                ${roles.map(role => renderRoleDefaultRow(client, role, team)).join('')}
            </div>
        </div>
    `;
    openModal(html);
    if (window.lucide) window.lucide.createIcons();
}

function renderRoleDefaultRow(client, role, team) {
    const assignment = (client.projectData.roleAssignments || []).find(a => a.roleId === role.id);
    return `
        <div class="ob-row ob-row-flex">
            <div class="tiny bold" style="flex:0 0 140px; align-self:center;">${esc(role.name)}</div>
            <select class="modal-input" style="flex:1 1 160px;" onchange="OL.updateRoleDefault('${client.id}', '${role.id}', this.value)">
                <option value="">Unassigned</option>
                ${team.map(m => `<option value="${esc(m.name)}" ${assignment?.memberName === m.name ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}
            </select>
        </div>
    `;
}

// Upserts the project-level default person for one role (there's exactly
// one default assignment per role, not a free-form list).
export function updateRoleDefault(clientId, roleId, memberName) {
    const client = state.clients[clientId];
    if (!client) return;
    if (!client.projectData.roleAssignments) client.projectData.roleAssignments = [];

    let a = client.projectData.roleAssignments.find(x => x.roleId === roleId);
    if (!a) {
        a = { id: uid(), roleId, memberName: '' };
        client.projectData.roleAssignments.push(a);
    }
    a.memberName = memberName;

    OL.markClientDirty(clientId);
    OL.persist();
    openRoleDefaultsModal(clientId);
}

// ---------------------------------------------------------------
// ROUND-LEVEL COMP TRACKING — see file header.
// ---------------------------------------------------------------

const isBlank = (v) => v === undefined || v === null || String(v).trim() === '';
const roundOf = (item) => { const r = parseInt(item?.round, 10); return Number.isFinite(r) && r >= 1 ? r : 1; };

// The request lines that are actually in this round and approved to happen.
function roundLineItems(sheet, round) {
    return (sheet?.lineItems || []).filter(i => i && !isBlank(i.id) && String(i.status || '') === 'Do Now' && roundOf(i) === Number(round));
}

// The round's approved fee: Do Now, Sphynx/Joint responsibility, minus
// that round's discount — the same math the scoping sheet's own round
// total (finalRoundNet) uses, so this always matches what's on the sheet.
export function roundApprovedFee(client, sheet, round) {
    const rKey = String(round);
    let billableSubtotal = 0;
    (sheet?.lineItems || []).forEach(item => {
        if (!item || roundOf(item) !== Number(round)) return;
        const status = String(item.status || '').toLowerCase().trim();
        const party = String(item.responsibleParty || '').toLowerCase().trim();
        if (status !== 'do now' || !(party === 'sphynx' || party === 'joint')) return;
        const res = typeof OL.getResourceById === 'function' ? OL.getResourceById(item.resourceId) : null;
        billableSubtotal += (typeof OL.calculateRowFee === 'function' ? OL.calculateRowFee(item, res) : 0) || 0;
    });

    let deduction = 0;
    const rDisc = sheet?.roundDiscounts?.[rKey];
    if (rDisc) {
        const discVal = parseFloat(rDisc.value) || 0;
        deduction = rDisc.type === '%' ? Math.round(billableSubtotal * (discVal / 100)) : discVal;
    }
    return billableSubtotal - deduction;
}

// Which comp-role bucket an internal (non-client) task belongs to, based
// on how the app itself created it — not a field anyone sets by hand.
//   - the round's own "notify client" / review follow-up tasks -> Communication
//   - a client-facing ask (review/document/feedback/third-party) is the
//     CLIENT's homework, not Sphynx labor, so it isn't counted at all
//   - a task generated off a failed testing step -> Testing
//   - everything else Sphynx-side (the SOP/blueprint build steps that
//     make up most of a round) -> Implementation
const ASK_KIND_KEYS = ['review', 'document', 'feedback', 'third_party', 'follow_up'];
export function taskCompRoleId(task) {
    if (!task || task.isClientTask) return null;
    if (ASK_KIND_KEYS.includes(task.askKind)) return null;
    if (task.reviewNotifyKey || task.reviewFollowUpKey) return 'role-communication';
    if (task.createdBy === 'testing' || task.testRunId) return 'role-testing';
    return 'role-implementation';
}

// Every internal task linked to one of this round's approved requests.
function tasksInRound(client, sheet, round) {
    const pd = client?.projectData || {};
    const tasks = pd.clientTasks || [];
    const items = roundLineItems(sheet, round);
    const seen = new Set();
    const out = [];
    items.forEach(item => {
        tasksForItem(tasks, item.id).forEach(t => {
            if (!t || seen.has(t.id)) return;
            seen.add(t.id);
            out.push(t);
        });
    });
    return out;
}

// The actual rollup: for every role, who's covering it this round and
// what share of that role's dollar cut each of them earns.
export function computeRoundRoleTracking(client, sheet, round) {
    const roles = getRoles();
    const fee = roundApprovedFee(client, sheet, round);
    const tasks = tasksInRound(client, sheet, round);
    const defaults = client.projectData?.roleAssignments || [];

    return roles.map(role => {
        const amount = fee ? fee * Number(role.defaultPercent || 0) / 100 : null;

        if (MANUAL_ONLY_ROLES.includes(role.id)) {
            const defaultAssignment = defaults.find(a => a.roleId === role.id);
            const name = defaultAssignment?.memberName || '';
            return {
                role, amount, autoTracked: false,
                people: name ? [{ name, count: 0, share: 1, amount }] : [],
            };
        }

        const roleTasks = tasks.filter(t => taskCompRoleId(t) === role.id);
        const counts = {};
        let unassigned = 0;
        roleTasks.forEach(t => {
            const name = (t.assignee || '').trim();
            if (!name) { unassigned++; return; }
            counts[name] = (counts[name] || 0) + 1;
        });
        const total = roleTasks.length;
        const people = Object.entries(counts).map(([name, count]) => {
            const share = total ? count / total : 0;
            return { name, count, share, amount: amount !== null ? amount * share : null };
        }).sort((a, b) => b.share - a.share);

        return { role, amount, autoTracked: true, totalTasks: total, unassigned, people };
    });
}

export function openRoundRoleAssignmentsModal(clientId, sheetId, round) {
    const client = state.clients[clientId];
    if (!client) return;
    const sheet = (client.projectData?.scopingSheets || []).find(s => String(s.id ?? '') === String(sheetId));
    if (!sheet) return;

    const fee = roundApprovedFee(client, sheet, round);
    const tracking = computeRoundRoleTracking(client, sheet, round);
    const totalPercent = getRoles().reduce((s, r) => s + Number(r.defaultPercent || 0), 0);

    const html = `
        <div class="modal-head">
            <div class="modal-title-text">Role Assignments & Comp — Round ${esc(String(round))}</div>
            <div class="spacer"></div>
            <button class="btn small soft" onclick="OL.closeModal()">Close</button>
        </div>
        <div class="modal-body">
            <div class="tiny muted" style="margin-bottom:12px;">
                Approved round total: <span class="bold" style="color:var(--text-main);">$${fee.toLocaleString()}</span>
                — Do Now items, Sphynx/Joint responsibility, minus this round's discount.
            </div>
            <p class="tiny muted" style="margin-bottom:14px;">
                Internal view only — not shown to the client or partner. Communication, Implementation and
                Testing are auto-tracked from who's actually assigned to this round's tasks; Sales and Scoping
                still show the project's default person until there's a way to track that work too. Each role's
                % of the round is still the master default for now (Comp Roles) — splitting that more finely per
                round is a later step.
            </p>
            ${tracking.map(t => renderRoundRoleSection(t)).join('')}
            <div class="tiny muted" style="margin-top:10px;">Role allocation totals ${totalPercent}%${totalPercent > 100 ? ' — over 100%, double check Comp Roles.' : ''}.</div>
        </div>
    `;
    openModal(html);
    if (window.lucide) window.lucide.createIcons();
}

function renderRoundRoleSection(t) {
    const amountText = t.amount !== null ? `$${t.amount.toFixed(2)}` : '—';
    let body;
    if (!t.autoTracked) {
        body = t.people.length
            ? `<div class="tiny">${esc(t.people[0].name)} — 100% (${amountText}) <span class="tiny muted">— project default, not yet auto-tracked</span></div>`
            : `<div class="tiny muted">No default person set for this role.</div>`;
    } else if (!t.totalTasks) {
        body = `<div class="tiny muted">No ${esc(t.role.name.toLowerCase())} tasks in this round yet.</div>`;
    } else {
        body = t.people.map(p => `
            <div class="tiny" style="display:flex; justify-content:space-between; gap:8px;">
                <span>${esc(p.name)} — ${p.count}/${t.totalTasks} tasks (${(p.share * 100).toFixed(0)}%)</span>
                <span class="muted">${p.amount !== null ? `$${p.amount.toFixed(2)}` : ''}</span>
            </div>
        `).join('') + (t.unassigned ? `<div class="tiny muted" style="margin-top:2px;">${t.unassigned} unassigned task${t.unassigned === 1 ? '' : 's'} not counted.</div>` : '');
    }

    return `
        <div class="card-section" style="margin-bottom:10px;">
            <div style="display:flex; justify-content:space-between; align-items:baseline;">
                <div class="tiny bold">${esc(t.role.name)} <span class="muted" style="font-weight:400;">(${t.role.defaultPercent}% — ${amountText})</span></div>
            </div>
            <div style="margin-top:6px;">${body}</div>
        </div>
    `;
}

window.OL = window.OL || {};
Object.assign(window.OL, {
    getRoles, openRolesManagerModal, updateRoleField, addRole, removeRole,
    openRoleDefaultsModal, updateRoleDefault,
    roundApprovedFee, taskCompRoleId, computeRoundRoleTracking, openRoundRoleAssignmentsModal,
});
