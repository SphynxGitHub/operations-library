//======================= CORE / AUTH =======================//
// v2: real Supabase Auth login for partners/clients, replacing the old
// ?access=token URL scheme. Admin status now comes only from a real session
// plus the `admins` table. The old ?admin=... URL secret has been removed:
// it was readable in the public source and granted admin screens to anyone.

import { db, state, persist } from './data.js';

// Old ?access=token share links. OFF: they no longer open anything (the database lockdown ends them).
const LEGACY_LINKS_ENABLED = false;

// ---- initializeSecurityContext: gate the whole app on load ----
// Now async — the load listener that calls this in app.js needs
// `await OL.initializeSecurityContext()`.
//
// v3: admin status now comes from a real Supabase session + the `admins`
// table, not a URL secret. Sets both
// state.adminMode (~25 call sites across app.js) and window.FORCE_ADMIN
// (8 call sites) exactly as the old URL-secret path did, so nothing else
// in app.js needs to change.
export async function initializeSecurityContext() {
    const { data: { session } } = await db.auth.getSession();

    if (session) {
        const { data: adminRow } = await db
            .from('admins')
            .select('id')
            .eq('id', session.user.id)
            .maybeSingle();

        if (adminRow) {
            // Try to attach a real name for attribution (task comments, etc.)
            // by matching this admin's session against the team roster —
            // first by authUserId (if they were also provisioned as a team
            // member), then by email. Falls back to a generic label if
            // neither the roster nor their own account has a name.
            const { data: masterRowForAdmin } = await db
                .from('workspace_masters')
                .select('sphynx_team')
                .eq('id', 'main_state')
                .maybeSingle();

            const roster = masterRowForAdmin?.sphynx_team || [];
            const matchedMember =
                roster.find(m => m.authUserId === session.user.id) ||
                roster.find(m => (m.email || '').toLowerCase() === (session.user.email || '').toLowerCase());

            state.adminMode = true;
            window.FORCE_ADMIN = true;
            window.IS_GUEST = false;
            state.teamMemberMode = false;
            state.currentUser = {
                id: session.user.id,
                name: matchedMember?.name || 'Admin',
                role: matchedMember?.role || 'Master Admin',
                authType: 'admin'
            };
            console.log(`🛠️ Admin Mode Active (real login)${matchedMember ? ` — ${matchedMember.name}` : ''}`);
            return true;
        }

        // Not an admin — check if this is a logged-in Sphynx team member
        // (see supabase/migrations/team_member_login.sql). Team members get
        // write access like an admin, but are NOT window.FORCE_ADMIN: the
        // Business Manager nav and #/business/* routes are filtered down to
        // whatever OL.hasTeamPermission() says their record allows, and the
        // Template Vault (master config) stays admin-only either way.
        const { data: masterRow } = await db
            .from('workspace_masters')
            .select('sphynx_team')
            .eq('id', 'main_state')
            .maybeSingle();

        const teamMember = (masterRow?.sphynx_team || []).find(m => m.authUserId === session.user.id);
        if (teamMember) {
            state.adminMode = false;
            window.FORCE_ADMIN = false;
            window.IS_GUEST = false;
            state.teamMemberMode = true;
            state.currentUser = {
                id: teamMember.id,
                name: teamMember.name,
                role: teamMember.role || 'Team Member',
                authType: 'team_member',
                permissions: teamMember.permissions || {}
            };
            console.log(`👤 Team Member Mode Active: ${teamMember.name}`);
            return true;
        }

        // Not an admin — look up their client/partner project.
        const { data: client, error } = await db
            .from('workspace_clients')
            .select('*')
            .eq('auth_user_id', session.user.id)
            .maybeSingle();

        if (error || !client) {
            console.error('No project or admin role is linked to this login.', error);
            await db.auth.signOut();
            window.location.href = 'login.html';
            return false;
        }

        state.activeClientId = client.id;
        state.clients[client.id] = {
            id: client.id,
            publicToken: client.public_token,
            meta: client.meta || {},
            modules: client.modules,
            permissions: client.permissions,
            projectData: client.project_data || { localResources: [], clientTasks: [] },
            sharedMasterIds: client.shared_master_ids || []
        };

        state.adminMode = false;
        window.FORCE_ADMIN = false;
        // IS_GUEST historically meant "not admin" throughout app.js's UI
        // branching — a logged-in partner/client is still not admin, so
        // this stays true, same as the old ?access=token path.
        window.IS_GUEST = true;
        return true;
    }

    const params = new URLSearchParams(window.location.search);

    // MIGRATION SAFETY NET: existing clients from before the login-gate
    // change still have old ?access=token links (emailed, bookmarked,
    // etc.) and no auth_user_id yet. Keep honoring that token so nobody
    // gets locked out while you send out setup links via the "Client
    // Logins" admin screen. Remove this block once every client has
    // migrated (check via that screen — it flags anyone still on the
    // legacy path).
    if (params.get('access')) {
        // The old share links only work while the database still lets anonymous visitors read
        // client rows. Set LEGACY_LINKS_ENABLED to false in the same release as the database lockdown
        // (009_rls_stage_b_lockdown.sql): they would otherwise open an empty app.
        if (!LEGACY_LINKS_ENABLED) {
            window.location.href = 'login.html?legacy=1';
            return false;
        }
        state.adminMode = false;
        window.FORCE_ADMIN = false;
        window.IS_GUEST = true;
        console.log("🔗 Legacy access-token guest mode (client hasn't set up real login yet)");
        return true;
    }

    window.location.href = 'login.html';
    return false;
}

/*===================== BULK MIGRATION TOOL ==================*/

// Renders a table of every client/partner project with their login-setup
// status, so you can generate + copy setup links in bulk instead of one
// at a time through each project's profile modal. Wire into the admin
// vault as its own tab (see instructions).
export function renderClientAccessList() {
    const container = document.getElementById('mainContent');
    if (!container) return;

    const clients = Object.values(state.clients).sort((a, b) =>
        (a.meta?.name || '').localeCompare(b.meta?.name || '')
    );

    const migratedCount = clients.filter(c => c.authUserId).length;

    const rows = clients.map(c => {
        const isMigrated = !!c.authUserId;
        const hasPendingLink = c.meta?.setupToken && !c.meta?.setupUsed;
        return `
            <tr>
                <td>${c.meta?.name || c.id}</td>
                <td><span class="pill tiny soft">${c.meta?.status || ''}</span></td>
                <td>
                    ${isMigrated
                        ? `<span style="color:#48bb78;">✅ Logged in</span>`
                        : hasPendingLink
                            ? `<span style="color:#fbbf24;">⏳ Link sent, not claimed</span>`
                            : `<span style="color:#a0aec0;">— Not started</span>`
                    }
                </td>
                <td>
                    ${isMigrated ? '' : `
                        <input type="email" id="setupEmail-${c.id}" class="modal-input tiny"
                               placeholder="their@email.com" value="${c.meta?.setupEmail || ''}"
                               style="width:160px;display:inline-block;">
                        <button class="btn tiny primary" onclick="OL.copySetupLink('${c.id}')">
                            ${hasPendingLink ? 'Regenerate & Copy' : 'Generate & Copy'}
                        </button>
                    `}
                </td>
            </tr>
        `;
    }).join('');

    container.innerHTML = `
        <div style="padding:24px;">
            <h2 style="margin-bottom:4px;">Client Logins</h2>
            <p class="tiny muted" style="margin-bottom:16px;">
                ${migratedCount} of ${clients.length} projects have set up real login.
                Everyone else is still using their old share link as a fallback —
                generate a setup link for each and send it their way.
            </p>
            <table class="modal-input" style="width:100%; border-collapse:collapse;">
                <thead>
                    <tr style="text-align:left; border-bottom:1px solid var(--panel-border);">
                        <th style="padding:8px;">Project</th>
                        <th style="padding:8px;">Status</th>
                        <th style="padding:8px;">Login Setup</th>
                        <th style="padding:8px;">Action</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
    `;
}

// ---- checkPermission: per-tab read/write level for the active client ----
// Unchanged from v1.
export function checkPermission(tabKey) {
    const client = state.clients[state.activeClientId];
    if (!client) return "full";
    if (!client.permissions) return "full";
    return client.permissions[tabKey] || "full";
}

// Admin status comes from the real login only (see initializeSecurityContext).
export function isAdmin() {
    return state.adminMode === true;
}

// Kept so existing imports keep working; there is no admin URL parameter any more.
export function getAdminQuery() {
    return '';
}

export async function signOut() {
    await db.auth.signOut();
    window.location.href = 'login.html';
}

/*===================== SPHYNX TEAM PERMISSIONS ==================*/

// The set of Business Manager tabs that are provisionable per team member.
// (Template Vault / master config tabs are intentionally not in this list
// — those stay admin-only regardless of what's granted here.)
export const TEAM_PERMISSION_TABS = [
    // 🏢 Business Manager Tabs
    { key: 'communications', label: 'Communications' },
    { key: 'calendar', label: 'Calendar' },
    { key: 'errors', label: 'Error Tracking' },
    { key: 'tasks', label: 'Task Manager' },
    { key: 'time-reports', label: 'Time Reports' },
    { key: 'financials', label: 'Financials' },
    { key: 'team', label: 'Sphynx Team' },
    { key: 'clients', label: 'Clients' },

    // 🏛️ Template Vault Tabs (Granular Team Controls)
    { key: 'vault-apps', label: 'Vault: Master Apps' },
    { key: 'vault-functions', label: 'Vault: Master Functions' },
    { key: 'vault-resources', label: 'Vault: Master Resources' },
    { key: 'vault-visualizer', label: 'Vault: Flow Map' },
    { key: 'vault-how-to', label: 'Vault: Master How-To' },
    { key: 'vault-tasks', label: 'Vault: Master Tasks' },
    { key: 'vault-analyses', label: 'Vault: Master Analyses' },
    { key: 'vault-rates', label: 'Vault: Scoping Rates' },
    { key: 'vault-data', label: 'Vault: Master Data Tags' },
    { key: 'vault-automations', label: 'Vault: Automation Rules' },
    { key: 'vault-client-access', label: 'Vault: Client Logins' }
];

// True for real admins (who always see everything) and for a team member
// whose record has this tab explicitly granted. False otherwise — callers
// (app.js nav + route guard) treat false as "don't show / don't route".
export function hasTeamPermission(tabKey) {
    if (window.FORCE_ADMIN === true) return true;
    if (!state.teamMemberMode) return false;
    return !!(state.currentUser?.permissions && state.currentUser.permissions[tabKey]);
}

// state.currentUser.permissions is a SNAPSHOT taken at login (see
// initializeSecurityContext above) — it does not update itself when an
// admin later checks/unchecks tabs for that person in the Team & Access
// Manager. That edit only touches state.master.sphynxTeam[i].permissions.
// So a team member who's already logged in keeps seeing their OLD
// permissions (often none, if they just signed up) until something
// re-derives state.currentUser from the roster. Call this any time
// sphynxTeam gets refreshed from the server (sync(), the notification
// poller, etc.) to keep a live session's menu in sync without requiring
// a manual logout/login. Returns true if anything actually changed, so
// callers can decide whether to re-render.
export function reconcileCurrentUserPermissions() {
    if (!state.teamMemberMode || !state.currentUser?.id) return false;
    const roster = state.master?.sphynxTeam || [];
    const me = roster.find(m => m.id === state.currentUser.id);
    if (!me) return false;

    const before = JSON.stringify(state.currentUser.permissions || {});
    const after = JSON.stringify(me.permissions || {});
    if (before === after && state.currentUser.role === (me.role || 'Team Member')) return false;

    state.currentUser.permissions = me.permissions || {};
    state.currentUser.role = me.role || 'Team Member';
    return true;
}

// Display name for attribution (task comments, etc.) — falls back to a
// generic label when the roster has no match for this login
// where we don't have a real identified person.
export function getCurrentUserName() {
    return state.currentUser?.name || (window.FORCE_ADMIN ? 'Admin' : 'Unknown User');
}

/*===================== TEAM SETUP LINKS (mirrors client setup links) ==================*/

// Generates a one-time setup link for a Sphynx team member so they can set
// their own password. team-setup.html later claims it via claim_team_setup
// (see supabase/migrations/team_member_login.sql).
export function generateTeamSetupLink(memberId, email) {
    const member = (state.master.sphynxTeam || []).find(m => m.id === memberId);
    if (!member) return null;

    const token = crypto.randomUUID();
    member.setupToken = token;
    member.setupEmail = email || member.email || '';
    member.setupUsed = false;

    persist();

    return new URL(`team-setup.html?token=${token}`, window.location.href).toString();
}

export function copyTeamSetupLink(memberId) {
    const member = (state.master.sphynxTeam || []).find(m => m.id === memberId);
    const email = member?.email || '';

    if (!email) {
        alert('Add an email for this team member first — it\'ll be prefilled on their setup page.');
        return;
    }

    const url = generateTeamSetupLink(memberId, email);
    navigator.clipboard.writeText(url);
    alert('Setup link copied to clipboard!');
    if (typeof window.OL?.renderSphynxTeamPage === 'function') window.OL.renderSphynxTeamPage();
}

/*===================== SETUP LINKS (replaces old share-link) ==================*/

// Generates a one-time setup link for a client/partner project and saves
// the token so setup.html can later claim it via the claim_client_setup RPC.
export function generateSetupLink(clientId, email) {
    const client = state.clients[clientId];
    if (!client) return null;

    const token = crypto.randomUUID();
    client.meta.setupToken = token;
    client.meta.setupEmail = email || '';
    client.meta.setupUsed = false;

    persist();

    return new URL(`setup.html?token=${token}`, window.location.href).toString();
}

// Convenience wrapper for a "Generate & Copy Setup Link" button —
// reads the email input, generates the link, copies it, confirms.
export function copySetupLink(clientId) {
    const emailInput = document.getElementById(`setupEmail-${clientId}`);
    const email = emailInput ? emailInput.value.trim() : '';

    if (!email) {
        alert('Enter an email first — it\'ll be prefilled on their setup page.');
        return;
    }

    const url = generateSetupLink(clientId, email);
    navigator.clipboard.writeText(url);
    alert('Setup link copied to clipboard!');
}

// ---- bridge: keep OL.* calls working until callers import directly ----
window.OL = window.OL || {};
Object.assign(window.OL, {
    initializeSecurityContext, checkPermission, isAdmin, getAdminQuery,
    signOut, generateSetupLink, copySetupLink, renderClientAccessList,
    hasTeamPermission, reconcileCurrentUserPermissions, getCurrentUserName, generateTeamSetupLink, copyTeamSetupLink,
    TEAM_PERMISSION_TABS
});

// Retired in this version — link-token access is gone, and neither was
// ever called from elsewhere in app.js (confirmed before removing):
// getAccessToken, getHomeUrl, getPartnerContext (also relied on
// OL.getPartnerAccessToken, which never existed, and state.registry,
// which was never initialized — both dead bugs, now moot).
