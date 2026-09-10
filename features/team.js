//======================= FEATURES / TEAM =======================//
// Extracted from app.js "TEAM MANAGEMENT SECTION".
// Owns: the team roster grid, the team member modal (roles, signature,
// access section trigger), and team-to-scoping-item assignment.

import { state, esc, uid, getActiveClient, persist } from '../core/data.js';

export function renderTeamManager() {
    OL.registerView(renderTeamManager);
    const container = document.getElementById("mainContent");
    const client = getActiveClient();
    if (!client || !container) return;

    if (!client.projectData.teamMembers) client.projectData.teamMembers = [];
    const members = client.projectData.teamMembers;

    const memberCardsHtml = members
        .map((m) => {
            const rolesHtml = (m.roles || []).length
                ? m.roles
                    .map(
                        (r) =>
                            `<span class="pill tiny soft" style="font-size: 8px; display:flex; align-items:center; gap:3px;">
                  <i data-lucide="shield" style="width:8px; height:8px;"></i> ${esc(r)}
                </span>`,
                    )
                    .join("")
                : `<span class="tiny muted uppercase" style="display:flex; align-items:center; gap:4px;">
            <i data-lucide="user" style="width:10px; height:10px;"></i> ${esc(m.role || "Contributor")}
           </span>`;

            return `
           <div class="card is-clickable hover-trigger" onclick="OL.openTeamMemberModal('${m.id}')" style="padding:15px;">
              <div class="card-header" style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:10px;">
                  <div style="display:flex; align-items:center; gap:10px;">
                    <div style="background:var(--accent); color:black; width:32px; height:32px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:bold; font-size:12px;">
                        ${m.name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2)}
                    </div>
                    <div class="card-title tm-card-title-${m.id}" style="font-weight:bold;">${esc(m.name)}</div>
                  </div>
                  <button class="card-delete-btn" style="position:static;" onclick="event.stopPropagation(); OL.removeTeamMember('${m.id}')">
                    <i data-lucide="x" style="width:14px; height:14px;"></i>
                  </button>
              </div>
              <div class="card-body">
                  <div class="pills-row" style="display: flex; flex-wrap: wrap; gap: 4px;">
                      ${rolesHtml}
                  </div>
              </div>
          </div>
      `;
        })
        .join("");

    container.innerHTML = `
        <div class="section-header" style="display:flex; align-items:center; gap:12px;">
            <i data-lucide="users" style="width:28px; height:24px; color:var(--accent);"></i>
            <div style="flex:1;">
                <h2 style="margin:0;">Team Members</h2>
                <div class="small muted subheader">Manage members assigned to ${esc(client.meta.name)}</div>
            </div>
            <button class="btn primary" onclick="OL.promptAddTeamMember()" style="display:flex; align-items:center; gap:6px;">
                <i data-lucide="user-plus" style="width:16px; height:16px;"></i> Add Member
            </button>
            ${OL.viewToggleBtn('team', 'renderTeamManager')}
        </div>
        ${OL.getViewMode('team') === 'list' ? `
            <div style="display:flex;flex-direction:column;gap:2px;margin-top:10px;">
                ${members.map(m => `
                    <div style="display:flex;align-items:center;gap:12px;padding:10px 16px;
                                background:var(--panel-soft);border:1px solid var(--panel-border);
                                border-radius:8px;cursor:pointer;transition:border-color 0.2s;"
                         onclick="OL.openTeamMemberModal('${m.id}')"
                         onmouseover="this.style.borderColor='var(--accent)'"
                         onmouseout="this.style.borderColor='var(--panel-border)'">
                        <div style="width:28px;height:28px;border-radius:6px;background:var(--accent);
                                    color:#000;display:flex;align-items:center;justify-content:center;
                                    font-weight:900;font-size:11px;flex-shrink:0;">
                            ${m.name.split(' ').map(n=>n[0]).join('').toUpperCase().substring(0,2)}
                        </div>
                        <span style="font-weight:600;font-size:13px;flex:1;">${esc(m.name)}</span>
                        <div class="pills-row" style="margin:0;gap:4px;">
                            ${(m.roles||[]).map(r=>`<span class="pill tiny soft" style="font-size:9px;">${esc(r)}</span>`).join('')}
                        </div>
                        <button class="card-delete-btn" style="position:static;" onclick="event.stopPropagation();OL.removeTeamMember('${m.id}')">
                            <i data-lucide="x" style="width:12px;height:12px;"></i>
                        </button>
                    </div>
                `).join('')}
            </div>
        ` : `
        <div class="cards-grid" style="margin-top: 20px;">
            ${memberCardsHtml}
            ${members.length === 0 ? '<div class="empty-hint" style="grid-column: 1/-1; text-align: center; padding: 60px; opacity: 0.5;">No team members added yet.</div>' : ""}
        </div>
        `}
    `;

    if (window.lucide) {
        window.lucide.createIcons();
    }
}

export function promptAddTeamMember() {
    const draftId = 'draft-tm-' + Date.now();
    const draftMember = {
        id: draftId,
        name: "",
        roles: [],
        isDraft: true
    };

    openTeamMemberModal(draftId, draftMember);
}

export function handleTeamMemberSave(id, name) {
    const cleanName = name.trim();
    if (!cleanName) return;

    const client = getActiveClient();
    const isDraft = id.startsWith('draft-tm-');

    if (isDraft) {
        const newId = 'tm-' + Date.now();

        const newMember = {
            id: newId,
            name: cleanName,
            roles: [],
            createdDate: new Date().toISOString()
        };

        if (!client.projectData.teamMembers) client.projectData.teamMembers = [];
        client.projectData.teamMembers.push(newMember);

        persist();
        renderTeamManager();

        openTeamMemberModal(newId);

    } else {
        const member = client?.projectData?.teamMembers.find(m => m.id === id);
        if (member) {
            member.name = cleanName;
            persist();
        }
    }
}

export function updateTeamMember(memberId, field, value) {
    const client = getActiveClient();
    const member = client?.projectData?.teamMembers.find(
        (m) => m.id === memberId,
    );

    if (member) {
        member[field] = value.trim();
        persist();
        renderTeamManager();
    }
}

export function removeTeamMember(memberId) {
    if (!confirm("Remove this team member?")) return;
    const client = getActiveClient();
    client.projectData.teamMembers = client.projectData.teamMembers.filter(
        (m) => m.id !== memberId,
    );
    persist();
    renderTeamManager();
}

export function openTeamMemberModal(memberId, draftObj = null) {
    const client = getActiveClient();
    let member = draftObj || client?.projectData?.teamMembers.find(m => m.id === memberId);

    if (!member) return;

    if (!Array.isArray(member.roles)) {
        member.roles = member.role ? [member.role] : [];
    }

    const html = `
        <div class="modal-head" style="gap:15px; display:flex; align-items:center; padding: 20px;">
            <div style="display:flex; align-items:center; gap:10px; flex:1;">
                <i data-lucide="user" style="width:20px; height:20px; color:var(--accent);"></i>
                <input type="text" class="header-editable-input" 
                       value="${esc(member.name)}" 
                       placeholder="Full Name..."
                       style="background:transparent; border:none; color:inherit; font-size:18px; font-weight:bold; width:100%; outline:none;"
                       oninput="OL.syncTeamMemberName('${member.id}', this.value)"
                       onblur="OL.handleTeamMemberSave('${member.id}', this.value)">
            </div>
            <button class="btn small soft" onclick="OL.closeModal()">Close</button>
        </div>
        <div class="modal-body">

            <div class="card-section" style="margin-top: 20px;">
                <label class="modal-section-label" style="display:flex; align-items:center; gap:6px;">
                    <i data-lucide="shield" style="width:14px; height:14px;"></i> Assigned Roles
                </label>
                <div class="pills-row" style="margin-bottom: 12px; min-height: 32px; display:flex; flex-wrap:wrap; gap:6px;">
                    ${member.roles.map(role => `
                        <span class="pill tiny accent" style="display:flex; align-items:center; gap:4px;">
                            ${esc(role)}
                            <i data-lucide="x" style="width:10px; height:10px; cursor:pointer;" onclick="OL.removeRoleFromMember('${memberId}', '${esc(role)}')"></i>
                        </span>
                    `).join("") || '<span class="tiny muted">No roles assigned</span>'}
                </div>

                <div class="search-map-container">
                    <div style="position:relative; display:flex; align-items:center;">
                        <i data-lucide="search" style="position:absolute; left:10px; width:12px; height:12px; opacity:0.4;"></i>
                        <input type="text" class="modal-input tiny" 
                            style="padding-left:30px;"
                            placeholder="Search roles or type to add new..." 
                            onfocus="OL.filterRoleSearch('${memberId}', '')" 
                            oninput="OL.filterRoleSearch('${memberId}', this.value)">
                    </div>
                    <div id="role-search-results" class="search-results-overlay"></div>
                </div>
            </div>

            <div class="card-section" style="margin-top: 20px;">
                <label class="modal-section-label" style="display:flex; align-items:center; gap:6px;">
                    <i data-lucide="pen-tool" style="width:14px; height:14px;"></i> Email Signature
                </label>
                <textarea class="modal-textarea" 
                        style="min-height: 100px; font-family: monospace; font-size: 11px; line-height:1.4;" 
                        placeholder="Best regards,\n{{name}}\nSphynx Financial"
                        onblur="OL.updateTeamMember('${memberId}', 'signature', this.value)">${esc(member.signature || '')}</textarea>
                <div class="tiny muted" style="margin-top:5px; display:flex; align-items:center; gap:4px;">
                    <i data-lucide="info" style="width:10px; height:10px;"></i>
                    Used for automated email templates sent by this member.
                </div>
            </div>
            ${OL.renderAccessSection(memberId, "member")} 
        </div>
    `;
    openModal(html);

    if (window.lucide) {
        window.lucide.createIcons();
    }
}

export function syncTeamMemberName(memberId, newName) {
    const cardTitles = document.querySelectorAll(`.tm-card-title-${memberId}`);
    cardTitles.forEach(el => {
        el.innerText = newName;
    });
}

export function filterRoleSearch(memberId, query) {
    const listEl = document.getElementById("role-search-results");
    if (!listEl) return;

    const q = (query || "").toLowerCase().trim();
    const client = getActiveClient();
    const member = client?.projectData?.teamMembers.find(m => m.id === memberId);
    if (!member) return;

    const allProjectRoles = [...new Set(client.projectData.teamMembers.flatMap(m => m.roles || []))];
    const memberRoles = member.roles || [];
    const matches = allProjectRoles.filter(role =>
        role.toLowerCase().includes(q) && !memberRoles.includes(role)
    ).sort();

    let html = matches.map(role => `
        <div class="search-result-item" style="display:flex; align-items:center; gap:10px;" onmousedown="OL.addRoleToMember('${memberId}', '${esc(role)}')">
            <i data-lucide="tag" style="width:12px; height:12px; opacity:0.6;"></i>
            <span style="flex:1;">${esc(role)}</span>
            <span class="tiny muted">Assign</span>
        </div>
    `).join("");

    if (q.length > 0 && !allProjectRoles.some(r => r.toLowerCase() === q)) {
        html += `
            <div class="search-result-item create-action" style="display:flex; align-items:center; gap:10px;" onmousedown="OL.addRoleToMember('${memberId}', '${esc(query)}')">
                <i data-lucide="plus-circle" style="width:14px; height:14px; color:var(--accent);"></i>
                <span>Create Role "<strong>${esc(query)}</strong>"</span>
            </div>`;
    }

    listEl.innerHTML = html || `<div class="search-result-item muted">No other roles found.</div>`;

    if (window.lucide) window.lucide.createIcons();
}

export function addRoleToMember(memberId, roleName) {
    const client = getActiveClient();
    const member = client?.projectData?.teamMembers.find(m => m.id === memberId);

    if (member) {
        if (!member.roles) member.roles = [];
        if (!member.roles.includes(roleName)) {
            member.roles.push(roleName);
            persist();

            const results = document.getElementById("role-search-results");
            if (results) results.innerHTML = "";

            openTeamMemberModal(memberId);
            renderTeamManager();
        }
    }
}

export function removeRoleFromMember(memberId, roleName) {
    const client = getActiveClient();
    const member = client?.projectData?.teamMembers.find(
        (m) => m.id === memberId,
    );

    if (member && member.roles) {
        member.roles = member.roles.filter((r) => r !== roleName);
        persist();
        openTeamMemberModal(memberId);
        renderTeamManager();
    }
}

export function toggleTeamAssignment(itemId, memberId) {
    const client = getActiveClient();
    const item = client.projectData.scopingSheets[0].lineItems.find(
        (i) => i.id === itemId,
    );

    if (item) {
        if (!item.teamIds) item.teamIds = [];
        const idx = item.teamIds.indexOf(memberId);

        if (idx === -1) item.teamIds.push(memberId);
        else item.teamIds.splice(idx, 1);

        if (item.teamIds.length > 0) {
            item.teamMode = 'individual';
        } else {
            item.teamMode = 'everyone';
        }

        persist();

        OL.openTeamAssignmentModal(itemId);
        OL.renderScopingSheet();

        const searchResults = document.getElementById("team-search-results");
        if (searchResults) searchResults.innerHTML = "";
    }
}

export function filterTeamMapList(itemId, query) {
    const listEl = document.getElementById("team-search-results");
    if (!listEl) return;

    const q = (query || "").toLowerCase().trim();
    const client = getActiveClient();
    const team = client?.projectData?.teamMembers || [];

    const matches = team.filter((m) => m.name.toLowerCase().includes(q));
    const exactMatch = team.find((m) => m.name.toLowerCase() === q);

    let html = matches
        .map(
            (m) => `
        <div class="search-result-item" onclick="OL.toggleTeamAssignment('${itemId}', '${m.id}')">
            👨‍💼 ${esc(m.name)} <span class="tiny muted">(Existing Member)</span>
        </div>
    `,
        )
        .join("");

    if (!exactMatch) {
        html += `
            <div class="search-result-item create-action" onclick="OL.executeCreateTeamAndMap('${itemId}', '${esc(query)}')">
                <span class="pill tiny accent" style="margin-right:8px;">+ New</span> 
                Add "${esc(query)}" to Project Team
            </div>
        `;
    }

    listEl.innerHTML = html;
}

export function executeCreateTeamAndMap(itemId, name) {
    const client = getActiveClient();
    if (!client) return;

    if (!client.projectData.teamMembers) {
        client.projectData.teamMembers = [];
    }

    const newMember = {
        id: uid(),
        name: name.trim(),
        role: "Contributor",
    };

    client.projectData.teamMembers.push(newMember);

    toggleTeamAssignment(itemId, newMember.id);

    persist();
    console.log(`✅ Created and assigned new member: ${name}`);
}

// ---- bridge: keep OL.*/window.* calls working until callers import directly ----
window.OL = window.OL || {};
Object.assign(window.OL, {
    promptAddTeamMember, handleTeamMemberSave, updateTeamMember, removeTeamMember,
    openTeamMemberModal, syncTeamMemberName, filterRoleSearch, addRoleToMember,
    removeRoleFromMember, toggleTeamAssignment, filterTeamMapList, executeCreateTeamAndMap
});
// Called bare from sections still living in app.js (scoping sheet).
window.renderTeamManager = renderTeamManager;
