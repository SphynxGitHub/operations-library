//======================= FEATURES / TEAM =======================//
// Extracted from app.js "TEAM MANAGEMENT SECTION".
// Owns: the team roster grid, the team member modal (roles, signature,
// contact details, access section trigger), and team-to-scoping-item assignment.

import { state, esc, uid, getActiveClient, persist, db } from '../core/data.js';

// ---------------- portal logins for this project's team members ----------------
// Each team member on a partner's or client's project can have their own login (table project_logins,
// see supabase/migrations/2026_09e_project_member_logins.sql). Every login on a project sees what the
// project's View Profile settings allow. Only Sphynx staff invite or remove logins.
const isStaff = () => !window.IS_GUEST && (window.FORCE_ADMIN === true || state.teamMemberMode === true || state.adminMode === true);
OL._projectLogins = OL._projectLogins || {};

async function loadProjectLogins(clientId) {
    const slot = OL._projectLogins[clientId] = OL._projectLogins[clientId] || { rows: [], loaded: false };
    slot.loading = true;
    const { data, error } = await db.from('project_logins').select('id, member_id, setup_email, setup_token, auth_user_id, claimed_at').eq('client_id', clientId);
    slot.rows = data || [];
    slot.error = error ? (/project_logins/.test(error.message || '') ? 'Run 2026_09e_project_member_logins.sql in Supabase to turn on team member logins.' : error.message) : '';
    slot.loaded = true; slot.loading = false;
    return slot;
}
const loginFor = (clientId, memberId) => (OL._projectLogins[clientId]?.rows || []).find((r) => String(r.member_id) === String(memberId)) || null;

function loginBadgeHtml(clientId, memberId) {
    if (!isStaff()) return '';
    const row = loginFor(clientId, memberId);
    if (row?.auth_user_id) return '<span class="tiny bold" style="color:#48bb78;" title="Has a portal login">Portal login</span>';
    if (row?.setup_token) return '<span class="tiny bold" style="color:#fbbf24;" title="Setup link made, not used yet">Link sent</span>';
    return '<span class="tiny muted">— No login</span>';
}

function memberLoginSectionHtml(client, member) {
    if (!isStaff()) return '';
    const slot = OL._projectLogins[client.id];
    const row = loginFor(client.id, member.id);
    const body = !slot?.loaded ? '<div class="tiny muted">Loading…</div>'
        : slot.error ? `<div class="tiny" style="color:#f59e0b;">${esc(slot.error)}</div>`
        : row?.auth_user_id ? `
            <div class="tiny" style="color:#48bb78; margin-bottom:8px;">${esc(member.name)} has a login${row.claimed_at ? ` (since ${esc(new Date(row.claimed_at).toLocaleDateString())})` : ''}${row.setup_email ? ` · ${esc(row.setup_email)}` : ''}.</div>
            <button class="btn tiny soft" style="color:#ef4444;" onclick="OL.removeMemberLogin('${esc(client.id)}', '${esc(member.id)}')">Remove login</button>
            <div class="tiny muted" style="margin-top:6px;">Removing it signs them out of this project for good; you can invite them again later.</div>`
        : `
            <div class="tiny ${row?.setup_token ? '' : 'muted'}" style="margin-bottom:8px; ${row?.setup_token ? 'color:#fbbf24;' : ''}">${row?.setup_token ? `Setup link made for ${esc(row.setup_email || '')}, not used yet.` : 'No login yet.'}</div>
            <button class="btn tiny primary" style="width:100%;" onclick="OL.copyMemberSetupLink('${esc(client.id)}', '${esc(member.id)}')">${row?.setup_token ? 'Regenerate & Copy Setup Link' : 'Generate & Copy Setup Link'}</button>
            <div id="member-link-${esc(member.id)}" class="tiny muted" style="margin-top:6px; word-break:break-all;">Uses the email above. They'll see everything this project's View Profile settings allow${client.meta?.status === 'Partner' ? ', including the clients this partner manages' : ''}.</div>`;
    return `
        <div class="card-section" style="margin-bottom: 20px; padding: 16px; background: rgba(255,255,255,0.02); border: 1px solid var(--panel-border); border-radius: 8px;">
            <label class="modal-section-label" style="display:flex; align-items:center; gap:8px; margin-bottom:12px; font-weight:bold; font-size:11px; color:var(--accent);">
                <i data-lucide="key-round" style="width:14px; height:14px;"></i> Portal Login
            </label>
            ${body}
        </div>`;
}

export async function copyMemberSetupLink(clientId, memberId) {
    if (!isStaff()) return;
    const client = state.clients[clientId];
    const member = client?.projectData?.teamMembers?.find((m) => String(m.id) === String(memberId));
    if (!member) return;
    const email = (document.getElementById(`tm-email-${memberId}`)?.value || member.email || '').trim();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { alert('Add an email address for this person first. The setup link is made for that email.'); return; }
    if (email !== member.email) { member.email = email; persist(); }
    const existing = loginFor(clientId, memberId);
    if (existing?.auth_user_id) { alert('They already have a login.'); return; }
    const token = crypto.randomUUID();
    const { error } = await db.from('project_logins').upsert(
        { client_id: clientId, member_id: String(memberId), setup_email: email, setup_token: token },
        { onConflict: 'client_id,member_id' });
    if (error) { alert(/project_logins/.test(error.message || '') ? 'Run 2026_09e_project_member_logins.sql in Supabase first.' : 'Could not make the link: ' + error.message); return; }
    const url = new URL(`setup.html?login=${token}`, window.location.href).toString();
    try { await navigator.clipboard.writeText(url); } catch (e) { /* shown below to copy by hand */ }
    await loadProjectLogins(clientId);
    openTeamMemberModal(memberId);
    const el = document.getElementById(`member-link-${memberId}`);
    if (el) el.innerHTML = `Copied. Send this to ${esc(email)} (it only works once, for that email):<br><span style="user-select:all; color:var(--text);">${esc(url)}</span>`;
    renderTeamManagerQuietly();
}

export async function removeMemberLogin(clientId, memberId) {
    if (!isStaff()) return;
    const member = state.clients[clientId]?.projectData?.teamMembers?.find((m) => String(m.id) === String(memberId));
    if (!confirm(`Remove ${member?.name || 'this person'}'s portal login? They'll no longer be able to open this project.`)) return;
    const { error } = await db.from('project_logins').delete().eq('client_id', clientId).eq('member_id', String(memberId));
    if (error) { alert('Could not remove the login: ' + error.message); return; }
    await loadProjectLogins(clientId);
    openTeamMemberModal(memberId);
    renderTeamManagerQuietly();
}

function renderTeamManagerQuietly() {
    if (String(window.location.hash).includes('team') && document.getElementById('mainContent')) {
        try { renderTeamManager(); } catch (e) { /* the page moved on */ }
    }
}

export function renderTeamManager() {
    if (typeof OL.registerView === 'function') OL.registerView(renderTeamManager);
    const container = document.getElementById("mainContent");
    const client = getActiveClient();
    if (!client || !container) return;

    if (!client.projectData.teamMembers) client.projectData.teamMembers = [];
    const members = client.projectData.teamMembers;
    if (isStaff() && !OL._projectLogins[client.id]?.loaded && !OL._projectLogins[client.id]?.loading) {
        loadProjectLogins(client.id).then(() => renderTeamManagerQuietly());
    }

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
           <div class="card is-clickable hover-trigger" onclick="OL.openTeamMemberModal('${m.id}')" style="padding:15px; display:flex; flex-direction:column; justify-between; gap:10px;">
              <div>
                  <div class="card-header" style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:10px;">
                      <div style="display:flex; align-items:center; gap:10px;">
                        <div style="background:var(--accent); color:black; width:36px; height:36px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:bold; font-size:12px; flex-shrink:0;">
                            ${m.name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2)}
                        </div>
                        <div style="min-width:0;">
                            <div class="card-title tm-card-title-${m.id}" style="font-weight:bold; font-size:14px;">${esc(m.name)}${m.isFollowUpContact ? ' <span class="pill tiny soft" style="font-size:8px; color:#22c55e;" title="Client follow-ups are addressed to this person">★ Follow-up contact</span>' : ''}</div>
                            <div class="pills-row" style="display: flex; flex-wrap: wrap; gap: 4px; margin-top:2px;">
                                ${rolesHtml}
                            </div>
                        </div>
                      </div>
                      <button class="card-delete-btn" style="position:static;" onclick="event.stopPropagation(); OL.removeTeamMember('${m.id}')">
                        <i data-lucide="x" style="width:14px; height:14px;"></i>
                      </button>
                  </div>

                  <!-- Contact Information Row -->
                  <div class="card-body" style="display:grid; gap:4px; font-size:11px; margin-top:10px;" class="muted">
                      ${m.email ? `
                      <div style="display:flex; align-items:center; gap:6px; opacity:0.8;">
                          <i data-lucide="mail" style="width:12px; height:12px; color:var(--accent);"></i>
                          <span style="flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(m.email)}</span>
                          <button class="btn tiny soft" style="padding:2px 5px; flex-shrink:0;" title="Email ${esc(m.name)}" onclick="event.stopPropagation(); OL.quickEmailContact('${esc(m.email)}', '${client.id}')"><i data-lucide="send" style="width:10px;height:10px; pointer-events:none;"></i></button>
                      </div>` : ''}
                      ${m.phone ? `
                      <div style="display:flex; align-items:center; gap:6px; opacity:0.8;">
                          <i data-lucide="phone" style="width:12px; height:12px; color:var(--accent);"></i>
                          <span>${esc(m.phone)}</span>
                      </div>` : ''}
                  </div>
              </div>
              ${isStaff() ? `<div style="border-top:1px solid var(--line); padding-top:8px;">${loginBadgeHtml(client.id, m.id)}</div>` : ''}
          </div>
      `;
        })
        .join("");

    container.innerHTML = `
        <div class="section-header" style="display:flex; align-items:center; gap:12px;">
            <i data-lucide="users" style="width:28px; height:24px; color:var(--accent);"></i>
            <div style="flex:1;">
                <h2 style="margin:0;">Team Members</h2>
                <div class="small muted subheader">Manage client members assigned to ${esc(client.meta.name)}</div>
            </div>
            <div class="header-actions">
                <button class="btn soft" onclick="OL.openRolesManager()" style="display:flex; align-items:center; gap:6px;">
                    <i data-lucide="shield" style="width:16px; height:16px;"></i> Manage Roles
                </button>
                <button class="btn primary" onclick="OL.promptAddTeamMember()" style="display:flex; align-items:center; gap:6px;">
                    <i data-lucide="user-plus" style="width:16px; height:16px;"></i> Add Member
                </button>
                ${typeof OL.viewToggleBtn === 'function' ? OL.viewToggleBtn('team', 'renderTeamManager') : ''}
            </div>
        </div>
        ${typeof OL.getViewMode === 'function' && OL.getViewMode('team') === 'list' ? `
            <div style="display:flex;flex-direction:column;gap:4px;margin-top:10px;">
                ${members.map(m => `
                    <div style="display:flex;align-items:center;gap:12px;padding:10px 16px;
                                background:var(--panel-soft);border:1px solid var(--panel-border);
                                border-radius:8px;cursor:pointer;transition:border-color 0.2s;"
                         onclick="OL.openTeamMemberModal('${m.id}')"
                         onmouseover="this.style.borderColor='var(--accent)'"
                         onmouseout="this.style.borderColor='var(--panel-border)'">
                        <div style="width:32px;height:32px;border-radius:50%;background:var(--accent);
                                    color:#000;display:flex;align-items:center;justify-content:center;
                                    font-weight:900;font-size:11px;flex-shrink:0;">
                            ${m.name.split(' ').map(n=>n[0]).join('').toUpperCase().substring(0,2)}
                        </div>
                        <div style="flex:1; min-width:0;">
                            <span style="font-weight:600;font-size:13px;display:block;">${esc(m.name)}${m.isFollowUpContact ? ' <span class="pill tiny soft" style="font-size:8px; color:#22c55e;">★ Follow-up contact</span>' : ''}</span>
                            <span class="tiny muted">${esc(m.email || 'No email')} ${m.phone ? `• ${esc(m.phone)}` : ''}</span>
                        </div>
                        <div class="pills-row" style="margin:0;gap:4px;">
                            ${(m.roles||[]).map(r=>`<span class="pill tiny soft" style="font-size:9px;">${esc(r)}</span>`).join('')}
                        </div>
                        ${loginBadgeHtml(client.id, m.id)}
                        <button class="card-delete-btn" style="position:static;" onclick="event.stopPropagation();OL.removeTeamMember('${m.id}')">
                            <i data-lucide="x" style="width:12px;height:12px;"></i>
                        </button>
                    </div>
                `).join('')}
            </div>
        ` : `
        <div class="cards-grid" style="margin-top: 20px; display:grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap:16px;">
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
        email: "",
        phone: "",
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
            email: document.getElementById(`tm-email-${id}`)?.value || "",
            phone: document.getElementById(`tm-phone-${id}`)?.value || "",
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

// Marks ONE team member as the person client follow-ups are addressed to (greetingContact in
// features/business/compose-shared.js). Exclusive within the project; unticking leaves nobody flagged, and the
// follow-up falls back to the project's primary contact, then the first member with an email.
export function setFollowUpContact(memberId, on) {
    const client = getActiveClient();
    const members = client?.projectData?.teamMembers || [];
    if (!members.some((m) => m.id === memberId)) return;
    members.forEach((m) => { if (m.id === memberId) m.isFollowUpContact = !!on; else if (on) delete m.isFollowUpContact; });
    if (!on) delete members.find((m) => m.id === memberId).isFollowUpContact;
    persist();
    renderTeamManager();
}

export function removeTeamMember(memberId) {
    const client = getActiveClient();
    const hasLogin = !!loginFor(client?.id, memberId)?.auth_user_id;
    if (!confirm(hasLogin ? "Remove this team member? Their portal login will be removed too." : "Remove this team member?")) return;
    if (isStaff() && client) {
        db.from('project_logins').delete().eq('client_id', client.id).eq('member_id', String(memberId))
            .then(({ error }) => { if (error && !/project_logins/.test(error.message || '')) console.warn('Could not remove their login:', error.message); loadProjectLogins(client.id); });
    }
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
        <div class="modal-head" style="gap:15px; display:flex; align-items:center; padding: 20px; border-bottom:1px solid var(--panel-border);">
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

        <div class="modal-body" style="padding: 20px;">

            <!-- NEW: CONTACT INFORMATION CARD SECTION -->
            <div class="card-section" style="margin-bottom: 20px; padding: 16px; background: rgba(255,255,255,0.02); border: 1px solid var(--panel-border); border-radius: 8px;">
                <label class="modal-section-label" style="display:flex; align-items:center; gap:8px; margin-bottom:12px; font-weight:bold; font-size:11px; color:var(--accent);" class="uppercase">
                    <i data-lucide="contact" style="width:14px; height:14px;"></i> Contact Information
                </label>
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
                    <div>
                        <label class="tiny muted uppercase bold" style="display:block; margin-bottom:4px; font-size:10px;">
                            <i data-lucide="mail" style="width:11px; height:11px; vertical-align:middle; margin-right:4px;"></i> Email Address
                        </label>
                        <input type="email" 
                               id="tm-email-${member.id}" 
                               class="modal-input tiny" 
                               value="${esc(member.email || '')}" 
                               placeholder="garret@sphynxfinancial.com" 
                               style="width:100%;" 
                               onblur="OL.updateTeamMember('${member.id}', 'email', this.value)">
                    </div>
                    <div>
                        <label class="tiny muted uppercase bold" style="display:block; margin-bottom:4px; font-size:10px;">
                            <i data-lucide="phone" style="width:11px; height:11px; vertical-align:middle; margin-right:4px;"></i> Phone Number
                        </label>
                        <input type="text" 
                               id="tm-phone-${member.id}" 
                               class="modal-input tiny" 
                               value="${esc(member.phone || '')}" 
                               placeholder="(555) 000-0000" 
                               style="width:100%;" 
                               onblur="OL.updateTeamMember('${member.id}', 'phone', this.value)">
                    </div>
                </div>
            </div>

            <!-- PRIMARY POINT OF CONTACT FOR FOLLOW-UPS -->
            ${member.isDraft ? '' : `
            <div class="card-section" style="margin-bottom: 20px; padding: 12px 16px; background: rgba(255,255,255,0.02); border: 1px solid var(--panel-border); border-radius: 8px;">
                <label class="tiny" style="display:flex !important; align-items:center; gap:8px; cursor:pointer; margin:0 !important;">
                    <input type="checkbox" style="width:auto !important; display:inline-block !important;" ${member.isFollowUpContact ? 'checked' : ''} onchange="OL.setFollowUpContact('${member.id}', this.checked)">
                    <span><strong>Primary point of contact for follow-ups</strong><br><span class="muted">Client follow-up emails are addressed to this person. Only one person per project; ticking this clears it from anyone else.</span></span>
                </label>
            </div>`}

            <!-- ASSIGNED ROLES SECTION -->
            <div class="card-section" style="margin-bottom: 20px; padding: 16px; background: rgba(255,255,255,0.02); border: 1px solid var(--panel-border); border-radius: 8px;">
                <label class="modal-section-label" style="display:flex; align-items:center; gap:8px; margin-bottom:12px; font-weight:bold; font-size:11px; color:var(--accent);" class="uppercase">
                    <i data-lucide="shield" style="width:14px; height:14px;"></i> Assigned Roles
                    <a href="#" style="margin-left:auto; font-weight:500; font-size:10px;" onclick="event.preventDefault(); OL.openRolesManager()">Manage roles</a>
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

            <!-- EMAIL SIGNATURE SECTION -->
            <div class="card-section" style="margin-bottom: 20px; padding: 16px; background: rgba(255,255,255,0.02); border: 1px solid var(--panel-border); border-radius: 8px;">
                <label class="modal-section-label" style="display:flex; align-items:center; gap:8px; margin-bottom:8px; font-weight:bold; font-size:11px; color:var(--accent);" class="uppercase">
                    <i data-lucide="pen-tool" style="width:14px; height:14px;"></i> Email Signature
                </label>
                <textarea class="modal-textarea" 
                        style="min-height: 80px; font-family: monospace; font-size: 11px; line-height:1.4; width:100%;" 
                        placeholder="Best regards,\n{{name}}\nSphynx Financial" 
                        onblur="OL.updateTeamMember('${memberId}', 'signature', this.value)">${esc(member.signature || '')}</textarea>
                <div class="tiny muted" style="margin-top:5px; display:flex; align-items:center; gap:4px;">
                    <i data-lucide="info" style="width:10px; height:10px;"></i>
                    Used for automated email templates sent by this member.
                </div>
            </div>

            <!-- PORTAL LOGIN (staff only) -->
            ${client ? memberLoginSectionHtml(client, member) : ''}

            <!-- SYSTEM ACCESS & CREDENTIALS SECTION -->
            ${typeof OL.renderAccessSection === 'function' ? OL.renderAccessSection(memberId, "member") : ''} 
        </div>
    `;

    if (typeof openModal === 'function') openModal(html);
    else if (typeof OL.showOverlayModal === 'function') OL.showOverlayModal(html);
    if (client && isStaff() && !OL._projectLogins[client.id]?.loaded) {
        loadProjectLogins(client.id).then(() => { if (document.getElementById(`tm-email-${member.id}`)) openTeamMemberModal(memberId, draftObj); });
    }

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

    const allProjectRoles = roleRows(client).map(r => r.name);
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
        ensureProjectRole(client, roleName);
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


// ---------------------------------------------------------------
// ROLES — one list for the Team Members tab and the flow map's assignments.
//   company roles   state.master.roles          (Comp Roles; read-only here)
//   project roles   client.projectData.roles    [{ id, name }]  (managed here)
//   roles people already hold (member.roles, typed in the member window) are adopted as project roles
// The flow map's assignee search reads the same lists, so a role made here can be assigned to a step or resource,
// and the map shows who holds it.
// ---------------------------------------------------------------
function ensureProjectRole(client, name) {
    const clean = String(name || '').trim();
    if (!client || !clean) return null;
    const pd = client.projectData || (client.projectData = {});
    if (!Array.isArray(pd.roles)) pd.roles = [];
    const key = clean.toLowerCase();
    const hit = (state.master?.roles || []).find(r => String(r.name).toLowerCase() === key) || pd.roles.find(r => String(r.name).toLowerCase() === key);
    if (hit) return hit;
    const role = { id: 'role-' + clean, name: clean };   // same id the flow map already gives a role typed on a member
    pd.roles.push(role);
    return role;
}

export function roleRows(client = getActiveClient()) {
    if (!client) return [];
    (client.projectData?.teamMembers || []).forEach(m => (m.roles || []).forEach(r => ensureProjectRole(client, r)));
    const company = (state.master?.roles || []).map(r => ({ id: r.id, name: r.name, source: 'company' }));
    const own = (client.projectData?.roles || []).filter(r => !company.some(c => c.name.toLowerCase() === String(r.name).toLowerCase()))
        .map(r => ({ id: r.id, name: r.name, source: 'project' }));
    return [...company, ...own];
}

export function roleHolders(name, client = getActiveClient()) {
    const key = String(name || '').toLowerCase();
    return (client?.projectData?.teamMembers || []).filter(m => (m.roles || []).some(r => String(r).toLowerCase() === key)).map(m => m.name);
}

function eachAssigneeList(client, fn) {
    const pd = (OL.getCurrentProjectData ? OL.getCurrentProjectData() : client.projectData) || {};
    (pd.resources || []).forEach(res => {
        if (Array.isArray(res.assignees)) fn(res.assignees, res, null);
        (res.steps || []).forEach(st => { if (Array.isArray(st.assignees)) fn(st.assignees, res, st); });
    });
}
const sameRole = (a, role) => a && a.type === 'role' && (String(a.id) === String(role.id) || String(a.name).toLowerCase() === String(role.name).toLowerCase());

let _rolesView = [];
export function openRolesManager() {
    const client = getActiveClient();
    if (!client) return;
    const rows = roleRows(client);
    _rolesView = rows;
    const members = client.projectData.teamMembers || [];
    const uses = rows.map(() => 0);
    eachAssigneeList(client, (list) => list.forEach(a => rows.forEach((r, i) => { if (sameRole(a, r)) uses[i]++; })));

    const body = rows.map((r, i) => {
        const held = members.filter(m => (m.roles || []).some(x => String(x).toLowerCase() === r.name.toLowerCase()));
        const free = members.filter(m => !held.includes(m));
        const mine = r.source === 'project';
        return `
        <div style="display:grid; grid-template-columns: minmax(180px,1.2fr) 3fr 110px 70px; gap:12px; align-items:center; padding:10px 0; border-bottom:1px solid var(--line);">
            <div>
                ${mine ? `<input type="text" class="modal-input" value="${esc(r.name)}" onchange="OL.renameProjectRole(${i}, this.value)">`
                       : `<div style="font-weight:600; font-size:13px;">${esc(r.name)}</div><div class="tiny muted">Company role</div>`}
            </div>
            <div style="display:flex; flex-wrap:wrap; gap:4px; align-items:center;">
                ${held.map(m => `<span class="pill tiny soft" style="display:inline-flex; align-items:center; gap:4px;">${esc(m.name)}
                    <i data-lucide="x" style="width:10px;height:10px;cursor:pointer;" onclick="OL.toggleRoleMember(${i}, '${esc(m.id)}')"></i></span>`).join('') || '<span class="tiny muted">No one holds this role</span>'}
                ${free.length ? `<select class="modal-input tiny" style="width:auto; max-width:160px;" onchange="if(this.value) OL.toggleRoleMember(${i}, this.value)">
                    <option value="">+ Add person</option>${free.map(m => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('')}</select>` : ''}
            </div>
            <div class="tiny muted" title="Steps and resources on the flow map assigned to this role">${uses[i]} on flow map</div>
            <div style="text-align:right;">${mine ? `<button class="btn tiny soft" title="Delete role" onclick="OL.deleteProjectRole(${i})"><i data-lucide="trash-2" style="width:12px;height:12px;"></i></button>` : ''}</div>
        </div>`;
    }).join('');

    const html = `
        <div class="modal-head">
            <div class="modal-title-text"><i data-lucide="shield" style="width:14px;height:14px;display:inline-block;vertical-align:middle;"></i> Roles</div>
            <div class="spacer"></div>
            <button class="btn small soft" onclick="OL.closeModal()">Close</button>
        </div>
        <div class="modal-body">
            <p class="tiny muted" style="margin-bottom:12px;">Roles for ${esc(client.meta?.name || 'this project')}. Anyone holding a role shows on the Team Members tab, and the role can be assigned to steps and resources on the flow map. Renaming a role updates its assignments.
                Company roles are set in <a href="#" onclick="event.preventDefault(); OL.openRolesManagerModal && OL.openRolesManagerModal()">Comp Roles</a>.</p>
            <div style="display:flex; gap:8px; margin-bottom:8px;">
                <input type="text" id="new-project-role" class="modal-input" style="flex:1;" placeholder="New role name"
                       onkeydown="if(event.key==='Enter'){event.preventDefault();OL.addProjectRole(this.value);}">
                <button class="btn primary" onclick="OL.addProjectRole(document.getElementById('new-project-role').value)">Add role</button>
            </div>
            ${body || '<div class="tiny muted" style="padding:20px 0;">No roles yet.</div>'}
        </div>`;
    if (typeof openModal === 'function') openModal(html);
    const box = document.getElementById('active-modal-box');
    if (box) box.classList.add('modal-wide');
    if (window.lucide) window.lucide.createIcons();
}

function rolesChanged() {
    persist();
    openRolesManager();
    renderTeamManagerQuietly();
    if (typeof OL.renderVisualizer === 'function' && String(window.location.hash).includes('visualizer')) { try { OL.renderVisualizer(); } catch (e) { /* map not showing */ } }
}

export function addProjectRole(name) {
    const client = getActiveClient();
    if (!client || !String(name || '').trim()) return;
    ensureProjectRole(client, name);
    rolesChanged();
}

export function renameProjectRole(i, value) {
    const client = getActiveClient();
    const row = _rolesView[i];
    const clean = String(value || '').trim();
    if (!client || !row || row.source !== 'project' || !clean || clean === row.name) return openRolesManager();
    if (roleRows(client).some(r => r !== row && r.name.toLowerCase() === clean.toLowerCase())) { alert(`There is already a role called "${clean}".`); return openRolesManager(); }
    const old = row.name;
    const role = (client.projectData.roles || []).find(r => String(r.id) === String(row.id));
    if (role) role.name = clean;
    (client.projectData.teamMembers || []).forEach(m => { m.roles = (m.roles || []).map(x => String(x).toLowerCase() === old.toLowerCase() ? clean : x); });
    eachAssigneeList(client, (list) => list.forEach(a => { if (sameRole(a, row)) a.name = clean; }));
    rolesChanged();
}

export function deleteProjectRole(i) {
    const client = getActiveClient();
    const row = _rolesView[i];
    if (!client || !row || row.source !== 'project') return;
    let n = 0;
    eachAssigneeList(client, (list) => list.forEach(a => { if (sameRole(a, row)) n++; }));
    const held = roleHolders(row.name, client).length;
    if (!confirm(`Delete the role "${row.name}"?${held ? `\n\nIt is taken off ${held} team member${held === 1 ? '' : 's'}.` : ''}${n ? `\nIt is also taken off ${n} assignment${n === 1 ? '' : 's'} on the flow map.` : ''}`)) return;
    client.projectData.roles = (client.projectData.roles || []).filter(r => String(r.id) !== String(row.id));
    (client.projectData.teamMembers || []).forEach(m => { m.roles = (m.roles || []).filter(x => String(x).toLowerCase() !== row.name.toLowerCase()); });
    eachAssigneeList(client, (list) => { for (let k = list.length - 1; k >= 0; k--) if (sameRole(list[k], row)) list.splice(k, 1); });
    rolesChanged();
}

export function toggleRoleMember(i, memberId) {
    const client = getActiveClient();
    const row = _rolesView[i];
    const m = (client?.projectData?.teamMembers || []).find(x => String(x.id) === String(memberId));
    if (!row || !m) return;
    if (!Array.isArray(m.roles)) m.roles = m.role ? [m.role] : [];
    const at = m.roles.findIndex(x => String(x).toLowerCase() === row.name.toLowerCase());
    if (at >= 0) m.roles.splice(at, 1); else m.roles.push(row.name);
    rolesChanged();
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

        if (typeof OL.openTeamAssignmentModal === 'function') OL.openTeamAssignmentModal(itemId);
        if (typeof OL.renderScopingSheet === 'function') OL.renderScopingSheet();

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
            ${esc(m.name)} <span class="tiny muted">(Existing Member)</span>
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
}

// Bridge global exports
window.OL = window.OL || {};
Object.assign(window.OL, {
    renderTeamManager, promptAddTeamMember, handleTeamMemberSave, updateTeamMember, removeTeamMember,
    openTeamMemberModal, syncTeamMemberName, filterRoleSearch, addRoleToMember,
    removeRoleFromMember, openRolesManager, addProjectRole, renameProjectRole, deleteProjectRole, toggleRoleMember, roleHolders, roleRows,
    toggleTeamAssignment, filterTeamMapList, executeCreateTeamAndMap,
    copyMemberSetupLink, removeMemberLogin, setFollowUpContact
});

window.renderTeamManager = renderTeamManager;
