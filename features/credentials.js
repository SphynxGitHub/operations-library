//======================= FEATURES / CREDENTIALS =======================//
// Extracted from app.js "CREDENTIALS AND APP ACCESS MANAGEMENT SECTION".
// Owns: the access/credentials section shown on team-member and app
// modals (renderAccessSection is called from both), and the credentials
// table row renderer + status updater used elsewhere.

import { state, esc, getActiveClient, persist, loadFullClient, markClientDirty } from '../core/data.js';
import { storeSecret, removeSecret, secureEntry, MASTER_ID } from '../core/secrets.js';

// The key field. A key is never shown: once stored it is only "stored securely", and it can be
// replaced or removed but not read back.
let lastOwner = null;
function secretFieldHtml(conn) {
    if (conn.secretSet) {
        return `
            <div style="display:flex; align-items:center; gap:8px; padding:6px 4px; font-size:11px;">
                <span>🔒 Stored securely${conn.secretHint ? ` <span class="muted" style="font-family:monospace;">••••${esc(conn.secretHint)}</span>` : ''}</span>
                <button class="btn tiny soft" onclick="OL.replaceAccessSecret('${conn.id}')">Replace</button>
                <button class="btn tiny soft" onclick="OL.clearAccessSecret('${conn.id}')">Remove</button>
            </div>`;
    }
    if (String(conn.secret || '').trim()) {
        return `
            <div style="display:flex; align-items:center; gap:8px; padding:6px 4px; font-size:11px; color:#fbbf24;">
                <span>⚠️ Stored in plain text</span>
                <button class="btn tiny primary" onclick="OL.secureAccessSecret('${conn.id}')">Move to secure storage</button>
            </div>`;
    }
    return `
        <input type="password" autocomplete="off" class="modal-input tiny"
               style="font-family: monospace; font-size:10px;"
               placeholder="Paste API key (stored securely, never shown again)"
               onchange="OL.saveAccessSecret('${conn.id}', this.value); this.value=''">`;
}

export function renderAccessSection(ownerId, type) {
    lastOwner = { ownerId, type };
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
                <div class="header-actions" style="display:flex; gap:6px;">
                    ${(() => { const n = registry.filter(a => !a.secretSet && String(a.secret || '').trim()).length; return n ? `<button class=\"btn tiny soft\" onclick=\"OL.secureClientKeys()\">Move ${n} key${n === 1 ? '' : 's'} to secure storage</button>` : ''; })()}
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
                                ${secretFieldHtml(conn)}
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

function registryFor(client) {
    const ctx = client?.projectData || state.master;
    if (!ctx.accessRegistry) ctx.accessRegistry = [];
    return ctx.accessRegistry;
}
const clientIdFor = (client) => (client && client.id) || MASTER_ID;
function redrawAccess() {
    if (!lastOwner) return;
    if (lastOwner.type === 'member') OL.openTeamMemberModal(lastOwner.ownerId);
    else OL.openAppModal(lastOwner.ownerId);
}

// Pasting or replacing a key sends it to secure storage. The entry keeps only "stored" and a 4-character hint.
export async function saveAccessSecret(accessId, value) {
    const client = getActiveClient();
    const entry = registryFor(client).find((a) => a.id === accessId);
    const key = String(value || '').trim();
    if (!entry || !key) return;
    try {
        const result = await storeSecret(clientIdFor(client), entry.id, key);
        entry.secretSet = true;
        entry.secretHint = result.hint || '';
        entry.secretUpdatedAt = new Date().toISOString();
        entry.secret = '';
        persist();
        redrawAccess();
    } catch (err) {
        alert('Could not store the key: ' + err.message);
    }
}

export async function replaceAccessSecret(accessId) {
    const key = prompt('Paste the new API key. It replaces the stored one and is never shown again.');
    if (key && key.trim()) await saveAccessSecret(accessId, key);
}

export async function clearAccessSecret(accessId) {
    const client = getActiveClient();
    const entry = registryFor(client).find((a) => a.id === accessId);
    if (!entry) return;
    if (!confirm('Remove the stored key? The imports that use it will stop working until a new key is added.')) return;
    try {
        await removeSecret(clientIdFor(client), entry.id);
        entry.secretSet = false;
        entry.secretHint = '';
        entry.secret = '';
        persist();
        redrawAccess();
    } catch (err) {
        alert('Could not remove the key: ' + err.message);
    }
}

// A key that is still stored as plain text (from before secure storage) moves in, without retyping.
export async function secureAccessSecret(accessId) {
    const client = getActiveClient();
    const entry = registryFor(client).find((a) => a.id === accessId);
    if (!entry) return;
    try {
        if (await secureEntry(client, entry)) { persist(); redrawAccess(); }
    } catch (err) {
        alert('Could not move the key: ' + err.message);
    }
}

// Every plain-text key in the open project.
export async function secureClientKeys(clientArg) {
    const client = clientArg || getActiveClient();
    let moved = 0;
    const failed = [];
    for (const entry of registryFor(client)) {
        try { if (await secureEntry(client, entry)) moved++; }
        catch (err) { failed.push(err.message); }
    }
    if (moved) persist();
    if (!clientArg) {
        alert(`Moved ${moved} key${moved === 1 ? '' : 's'} to secure storage.` + (failed.length ? `\n${failed.length} could not be moved: ${failed[0]}` : ''));
        redrawAccess();
    }
    return { moved, failed };
}

// Every plain-text key in every project. Run once from the console: await OL.secureAllStoredKeys()
export async function secureAllStoredKeys() {
    if (state.adminMode !== true && state.teamMemberMode !== true) return alert('Only Sphynx staff can do this.');
    let moved = 0, projects = 0;
    const failures = [];
    for (const id of Object.keys(state.clients || {})) {
        const client = await loadFullClient(id);
        if (!client || !client.projectData) continue;
        const { moved: n, failed } = await secureClientKeys(client);
        if (n) { moved += n; projects++; markClientDirty(id); }
        failed.forEach((m) => failures.push(`${client.meta?.name || id}: ${m}`));
    }
    const master = await secureClientKeys({ id: MASTER_ID, projectData: state.master });
    moved += master.moved;
    await persist();
    const summary = `Moved ${moved} key${moved === 1 ? '' : 's'} across ${projects} project${projects === 1 ? '' : 's'} to secure storage.` + (failures.length ? ` ${failures.length} could not be moved.` : '');
    console.log(summary, failures);
    alert(summary + (failures.length ? `\nFirst problem: ${failures[0]}` : ''));
    return { moved, projects, failures };
}

export function updateAccessValue(accessId, field, value) {
    // A key is never written into the project as text; it goes to secure storage.
    if (field === 'secret') return saveAccessSecret(accessId, value);
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
    const gone = client.projectData.accessRegistry.find((a) => a.id === accessId);
    // Take the stored key out of secure storage too (best effort; the entry is removed either way).
    if (gone && gone.secretSet) removeSecret(clientIdFor(client), gone.id).catch((e) => console.warn('Could not remove the stored key:', e.message));
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
    removeAccess, renderCredentialRow, updateCredentialStatus,
    saveAccessSecret, replaceAccessSecret, clearAccessSecret, secureAccessSecret,
    secureClientKeys, secureAllStoredKeys
});
