//======================= FEATURES / CREDENTIALS =======================//
// Extracted from app.js "CREDENTIALS AND APP ACCESS MANAGEMENT SECTION".
// Owns: the access/credentials section shown on team-member and app
// modals (renderAccessSection is called from both), and the credentials
// table row renderer + status updater used elsewhere.

import { state, esc, getActiveClient, persist } from '../core/data.js';

export function renderAccessSection(ownerId, type) {
    const client = getActiveClient();

    const dataContext = client?.projectData || state.master;

    if (!dataContext.accessRegistry) dataContext.accessRegistry = [];
    const registry = dataContext.accessRegistry;

    const connections = type === "member"
        ? registry.filter((a) => a.memberId === ownerId)
        : registry.filter((a) => a.appId === ownerId);

    const allApps = [
        ...(state.master.apps || []),
        ...(client?.projectData?.localApps || []),
    ];

    const allMembers = client?.projectData?.teamMembers || state.master.teamMembers || [];

    return `
        <div class="card-section" style="margin-top:20px; border-top: 1px solid var(--line); padding-top:15px;">
            <div class="section-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                <label class="modal-section-label" style="margin:0;">System Access & Credentials</label>
                <div class="header-actions">
                    <button class="btn tiny primary" onclick="document.getElementById('access-search-input').focus()">+ Add Access</button>
                </div>
            </div>

            <div class="dp-manager-list" style="margin-bottom:10px;">
                ${connections.length === 0 ? '<div class="muted tiny" style="padding:10px; text-align:center; border: 1px dashed var(--line); border-radius:4px;">No credentials linked yet.</div>' : ''}
                ${connections.map((conn) => {
                    const linkedObj = type === "member"
                        ? allApps.find((a) => a.id === conn.appId)
                        : allMembers.find((m) => m.id === conn.memberId);

                    const jumpTarget = type === "member"
                        ? `OL.openAppModal('${conn.appId}')`
                        : `OL.openTeamMemberModal('${conn.memberId}')`;

                    return `
                        <div class="dp-manager-row" style="display: flex; align-items: flex-start; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.05);">
                            <div style="width: 140px; min-width: 140px; padding: 5px;">
                                <strong class="is-clickable text-accent" 
                                        style="font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block;" 
                                        onclick="${jumpTarget}" 
                                        title="Jump to ${esc(linkedObj?.name)}">
                                    ${type === "member" ? "💻" : "👨‍💼"} ${esc(linkedObj?.name || "Unknown")}
                                </strong>
                            </div>

                            <div style="flex: 1; padding: 5px;">
                                <input type="text" 
                                       class="modal-input tiny" 
                                       style="font-family: monospace; color: white; font-size: 10px; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.1);"
                                       placeholder="API Key / Secret / Notes..."
                                       value="${esc(conn.secret || "")}"
                                       onblur="OL.updateAccessValue('${conn.id}', 'secret', this.value)">
                            </div>

                            <div style="display:flex; align-items:center; gap:8px; padding: 5px;">
                                <select class="tiny-select" style="width: 80px;" onchange="OL.updateAccessValue('${conn.id}', 'level', this.value)">
                                    <option value="Viewer" ${conn.level === "Viewer" ? "selected" : ""}>Viewer</option>
                                    <option value="Editor" ${conn.level === "Editor" ? "selected" : ""}>Editor</option>
                                    <option value="Admin" ${conn.level === "Admin" ? "selected" : ""}>Admin</option>
                                </select>
                                <button class="card-close" style="position:static; padding: 0 5px;" onclick="OL.removeAccess('${conn.id}', '${ownerId}', '${type}')">×</button>
                            </div>
                        </div>
                    `;
                }).join("")}
            </div>

            <div class="search-map-container" style="margin-top: 15px;">
                <input type="text" id="access-search-input" class="modal-input" 
                    placeholder="Type to find ${type === "member" ? "an App" : "a Member"} to grant access..." 
                    onfocus="OL.filterAccessSearch('${ownerId}', '${type}', '')" 
                    oninput="OL.filterAccessSearch('${ownerId}', '${type}', this.value)">
                <div id="access-search-results" class="search-results-overlay"></div>
            </div>
        </div>
    `;
}

export function filterAccessSearch(ownerId, type, query) {
    const listEl = document.getElementById("access-search-results");
    if (!listEl) return;

    const q = (query || "").toLowerCase().trim();
    const client = getActiveClient();
    if (!client) return;

    const registry = client.projectData.accessRegistry || [];
    let source = [];

    if (type === "member") {
        const linkedAppIds = registry.filter(r => r.memberId === ownerId).map(r => r.appId);
        source = (client.projectData.localApps || [])
                 .filter(a => !linkedAppIds.includes(a.id));
    } else {
        const linkedMemberIds = registry.filter(r => r.appId === ownerId).map(r => r.memberId);
        source = (client.projectData.teamMembers || [])
                 .filter(m => !linkedMemberIds.includes(m.id));
    }

    const matches = source.filter((item) => item.name.toLowerCase().includes(q));

    if (matches.length === 0) {
        listEl.innerHTML = `<div class="search-result-item muted">No unlinked ${type === "member" ? "local apps" : "team members"} found.</div>`;
        return;
    }

    listEl.innerHTML = matches.map(item => `
        <div class="search-result-item" onclick="OL.linkAccess('${ownerId}', '${item.id}', '${type}')">
            ${type === "member" ? "💻" : "👨‍💼"} ${esc(item.name)}
        </div>
    `).join('');
}

export function linkAccess(ownerId, targetId, type) {
    const client = getActiveClient();
    const memberId = type === "member" ? ownerId : targetId;
    const appId = type === "member" ? targetId : ownerId;

    client.projectData.accessRegistry.push({
        id: "acc_" + Date.now(),
        memberId,
        appId,
        level: "Viewer",
        secret: "",
    });

    persist();
    type === "member"
        ? OL.openTeamMemberModal(ownerId)
        : OL.openAppModal(ownerId);
}

export function updateAccessValue(accessId, field, value) {
    const client = getActiveClient();
    const entry = client.projectData.accessRegistry.find(
        (a) => a.id === accessId,
    );
    if (entry) {
        entry[field] = value;
        persist();
    }
}

export function removeAccess(accessId, ownerId, type) {
    const client = getActiveClient();
    client.projectData.accessRegistry = client.projectData.accessRegistry.filter(
        (a) => a.id !== accessId,
    );
    persist();
    type === "member"
        ? OL.openTeamMemberModal(ownerId)
        : OL.openAppModal(ownerId);
}

export function renderCredentialRow(clientId, cred, idx, perm) {
    const app = state.master.apps.find((a) => a.id === cred.appId);
    const isFull = perm === "full";

    return `
        <tr>
            <td>
                <div style="display:flex; align-items:center; gap:8px;">
                    ${OL.iconHTML(app || { name: "?" })} 
                    <strong>${esc(app?.name || "Unknown App")}</strong>
                </div>
            </td>
            <td><span class="pill tiny soft">${esc(cred.type)}</span></td>
            <td>
                <div class="reveal-box" onclick="this.classList.toggle('revealed')">
                    <span class="hidden-val">••••••••</span>
                    <span class="visible-val">${esc(cred.username)}</span>
                </div>
            </td>
            <td>
                <div class="reveal-box" onclick="this.classList.toggle('revealed')">
                    <span class="hidden-val">••••••••</span>
                    <span class="visible-val">${esc(cred.password)}</span>
                </div>
            </td>
            <td>
                <select class="perm-select" style="width:100px;"
                        onchange="OL.updateCredentialStatus('${clientId}', ${idx}, this.value)"
                        ${!isFull ? "disabled" : ""}>
                    <option value="Pending" ${cred.status === "Pending" ? "selected" : ""}>⏳ Pending</option>
                    <option value="Verified" ${cred.status === "Verified" ? "selected" : ""}>✅ Verified</option>
                    <option value="Invalid" ${cred.status === "Invalid" ? "selected" : ""}>❌ Invalid</option>
                </select>
            </td>
            <td>
                ${isFull ? `<span class="card-delete-btn" onclick="OL.deleteCredential('${clientId}', ${idx})">×</span>` : ""}
            </td>
        </tr>
    `;
}

export function updateCredentialStatus(clientId, idx, status) {
    const client = state.clients[clientId];
    const cred = client.projectData.credentials[idx];

    if (cred) {
        cred.status = status;
        const app = state.master.apps.find((a) => a.id === cred.appId);
        console.log(`Access for ${app?.name} marked as ${status}`);

        persist();
    }
}

// ---- bridge: keep OL.*/window.* calls working until callers import directly ----
window.OL = window.OL || {};
Object.assign(window.OL, {
    renderAccessSection, filterAccessSearch, linkAccess, updateAccessValue,
    removeAccess, renderCredentialRow, updateCredentialStatus
});
