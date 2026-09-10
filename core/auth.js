//======================= CORE / AUTH =======================//
// v2: real Supabase Auth login for partners/clients, replacing the old
// ?access=token URL scheme. Admin mode is UNCHANGED — it still runs on
// the ?admin=pizza123 URL secret, not a real session (see the note at
// the bottom of 001_login_gate.sql about why RLS isn't enabled yet).

import { db, state, persist } from './data.js';

// ---- FORCE_ADMIN: computed once on load, same as the original ----
// Restored here after being lost in the core/data.js extraction — this
// is read in 8 places across app.js (buildLayout and several tab-render
// functions) to decide whether to show admin UI.
const _params = new URLSearchParams(window.location.search);
const _isFiddle = window.location.hostname.includes('jsfiddle.net') || window.location.hostname.includes('fiddle.jshell.net');
window.FORCE_ADMIN = _params.get('admin') === 'pizza123' || _isFiddle;

// ---- initializeSecurityContext: gate the whole app on load ----
// Now async — the load listener that calls this in app.js needs
// `await OL.initializeSecurityContext()`.
export async function initializeSecurityContext() {
    const params = new URLSearchParams(window.location.search);
    const adminKeyFromUrl = params.get('admin');

    // Admin path: unchanged.
    if (adminKeyFromUrl && adminKeyFromUrl === 'pizza123') {
        state.adminMode = true;
        window.IS_GUEST = false;
        console.log("🛠️ Admin Mode Active");
        return true;
    }

    // Everyone else needs a real Supabase session now.
    const { data: { session } } = await db.auth.getSession();

    if (!session) {
        window.location.href = 'login.html';
        return false;
    }

    const { data: client, error } = await db
        .from('workspace_clients')
        .select('*')
        .eq('auth_user_id', session.user.id)
        .maybeSingle();

    if (error || !client) {
        console.error('No project is linked to this login.', error);
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
    // IS_GUEST historically meant "not admin" throughout app.js's UI
    // branching (14 call sites) — a logged-in partner/client is still
    // not admin, so this stays true, same as the old ?access=token path.
    window.IS_GUEST = true;
    return true;
}

// ---- checkPermission: per-tab read/write level for the active client ----
// Unchanged from v1.
export function checkPermission(tabKey) {
    const client = state.clients[state.activeClientId];
    if (!client) return "full";
    if (!client.permissions) return "full";
    return client.permissions[tabKey] || "full";
}

export function isAdmin() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('admin') === 'pizza123';
}

export function getAdminQuery() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.has('admin') ? `?admin=${urlParams.get('admin')}` : '';
}

export async function signOut() {
    await db.auth.signOut();
    window.location.href = 'login.html';
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
    signOut, generateSetupLink, copySetupLink
});

// Retired in this version — link-token access is gone, and neither was
// ever called from elsewhere in app.js (confirmed before removing):
// getAccessToken, getHomeUrl, getPartnerContext (also relied on
// OL.getPartnerAccessToken, which never existed, and state.registry,
// which was never initialized — both dead bugs, now moot).
