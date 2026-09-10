//======================= CORE / DATA LAYER =======================//

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

// ---- small value helpers used throughout the data layer ----
export const val = (v) => (v === undefined || v === null) ? "" : v;
export const num = (v) => (v === undefined || v === null || v === 0) ? "" : v;
export const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const uid = () => "id_" + Math.random().toString(36).slice(2, 10);

// ---- Supabase client ----
const SUPABASE_URL = 'https://kexnnpwjerrnsmifauuo.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtleG5ucHdqZXJybnNtaWZhdXVvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc1MDcxNTEsImV4cCI6MjEwMzA4MzE1MX0.BAgC5wN4SKqfqKn0Gt7a53sGvigh_YlaMcQLdaovc08';
export const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---- state ----
export const state = {
    activeClientId: null,
    isCloudSynced: false,
    viewMode: localStorage.getItem('ol_preferred_view_mode') || 'global',
    ui: {
        showCompleted: false,
        zenMode: localStorage.getItem('ol_preferred_view_mode') === 'global'
    },
    master: {
        apps: [], functions: [], resources: [], taskBlueprints: [], howToLibrary: [],
        datapoints: [
            { id: 'dp-house', name: 'Household Name', key: '{householdName}', category: 'Identity', linkToResource: 'Naming Conventions' },
            { id: 'dp-folder', name: 'Folder Name', key: '{folderName}', category: 'Architecture', linkToResource: 'Naming Conventions' },
            { id: 'dp-hierarchy', name: 'Folder Location', key: '{folderPath}', category: 'Architecture', linkToResource: 'Folder Hierarchy' },
            { id: 'dp-fname', name: 'First Name', key: '{firstName}', category: 'Identity' },
            { id: 'dp-lname', name: 'Last Name', key: '{lastName}', category: 'Identity' },
            { id: 'dp-email', name: 'Email Address', key: '{email}', category: 'Contact' },
            { id: 'dp-phone', name: 'Phone Number', key: '{phone}', category: 'Contact' },
            { id: 'dp-ptype', name: 'Phone Type', key: '{phoneType}', category: 'Contact' },
            { id: 'dp-haddr', name: 'Home Address', key: '{homeAddress}', category: 'Location' },
            { id: 'dp-maddr', name: 'Mailing Address', key: '{mailingAddress}', category: 'Location' },
            {
                id: 'bundle-onboarding',
                name: 'Standard Client Info',
                isBundle: true,
                childIds: ['dp-house', 'dp-fname', 'dp-lname', 'dp-email', 'dp-phone'],
                category: 'Identity'
            }
        ],
        rates: { baseHourlyRate: 300, teamMultiplier: 1.1, variables: {} },
        resourceTypes: [
            { type: "Zap", typeKey: "zap", archetype: "Multi-Step" },
            { type: "Form", typeKey: "form", archetype: "Base" },
            { type: "Workflow", typeKey: "workflow", archetype: "Multi-Level" }
        ],
        analyses: []
    },
    clients: {}
};

// ---- persist: debounced write of master + active client to Supabase ----
export function persist() {
    if (window.IS_GUEST) {
        console.warn("🛡️ Persist skipped: Read-only guest mode.");
        return;
    }

    if (window.saveTimeout) clearTimeout(window.saveTimeout);
    window.lastSyncHash = null;
    window.saveTimeout = setTimeout(async () => {
        window.saveTimeout = null;
        try {
            console.log("☁️ Background Sync Starting...");

            const masterCopy = JSON.parse(JSON.stringify(state.master));

            const masterPayload = {
                id: 'main_state',
                exported_at: new Date().toISOString(),
                rates: masterCopy.rates || {},
                apps: masterCopy.apps || [],
                functions: masterCopy.functions || [],
                resource_types: masterCopy.resourceTypes || [],
                datapoints: masterCopy.datapoints || [],
                task_blueprints: masterCopy.taskBlueprints || [],
                how_to_library: masterCopy.howToLibrary || [],
                analyses: masterCopy.analyses || []
            };

            const { error: masterErr } = await db
                .from('workspace_masters')
                .upsert(masterPayload, { onConflict: 'id' });

            if (masterErr) {
                console.error("❌ Master Persist Error:", masterErr.message);
            }

            const activeId = state.activeClientId;
            if (activeId && state.clients[activeId]) {
                const clientCopy = JSON.parse(JSON.stringify(state.clients[activeId]));
                if (clientCopy.projectData) {
                    delete clientCopy.projectData.resources;
                }

                if (!clientCopy.projectData || !clientCopy.projectData.localResources) {
                    console.error('🛑 PERSIST ABORTED: Incomplete client object');
                    return;
                }

                const clientPayload = {
                    id: activeId,
                    public_token: clientCopy.publicToken || null,
                    meta: clientCopy.meta || {},
                    modules: clientCopy.modules || {},
                    permissions: clientCopy.permissions || {},
                    project_data: clientCopy.projectData || {},
                    shared_master_ids: clientCopy.sharedMasterIds || []
                };

                const { error: clientErr } = await db
                    .from('workspace_clients')
                    .upsert(clientPayload, { onConflict: 'id' });

                if (clientErr) {
                    console.error("❌ Client Persist Error:", clientErr.message);
                }
            }

            window.lastLocalSave = Date.now();
            console.log("✅ Background Sync Complete.");
        } catch (error) {
            console.error("💀 Persistence Error:", error);
        }
    }, 1500);
}

// ---- sync: initial fetch of master registry + client list ----
export async function sync() {
    if (window.isSyncInitialized) return;
    window.isSyncInitialized = true;
    console.log("📡 Initializing Supabase Unified Workspace Sync...");

    try {
        const { data: masterData, error: masterErr } = await db
            .from('workspace_masters')
            .select('*')
            .maybeSingle();

        if (masterErr) {
            console.error("❌ Master Fetch Error:", masterErr.message);
        } else if (masterData) {
            state.master.rates = masterData.rates || state.master.rates;
            if (Array.isArray(masterData.apps) && masterData.apps.length > 0) state.master.apps = masterData.apps;
            if (Array.isArray(masterData.functions) && masterData.functions.length > 0) state.master.functions = masterData.functions;
            if (Array.isArray(masterData.resource_types) && masterData.resource_types.length > 0) state.master.resourceTypes = masterData.resource_types;
            if (Array.isArray(masterData.datapoints) && masterData.datapoints.length > 0) state.master.datapoints = masterData.datapoints;
            if (Array.isArray(masterData.task_blueprints) && masterData.task_blueprints.length > 0) state.master.taskBlueprints = masterData.task_blueprints;
            if (Array.isArray(masterData.how_to_library) && masterData.how_to_library.length > 0) state.master.howToLibrary = masterData.how_to_library;
            if (Array.isArray(masterData.analyses) && masterData.analyses.length > 0) state.master.analyses = masterData.analyses;
            console.log(`🏛️ Master Registry Loaded: ${state.master.apps.length} Apps, ${state.master.functions.length} Functions.`);
        }

        const { data: clientsData, error: clientsErr } = await db
            .from('workspace_clients')
            .select('*');

        if (clientsErr) {
            console.error("❌ Clients Fetch Error:", clientsErr.message);
        } else if (clientsData && clientsData.length > 0) {
            clientsData.forEach(c => {
                const clientId = c.id || c.client_id;
                if (!clientId) return;

                state.clients[clientId] = {
                    id: clientId,
                    publicToken: c.public_token || c.publicToken || c.access_token,
                    meta: c.meta || { name: clientId, status: 'Discovery' },
                    modules: c.modules || { checklist: true, apps: true, functions: true, resources: true },
                    permissions: c.permissions || {},
                    projectData: c.project_data || c.projectData || { localResources: [], clientTasks: [] },
                    sharedMasterIds: c.shared_master_ids || c.sharedMasterIds || [],
                    authUserId: c.auth_user_id || null
                };
            });
            console.log(`📋 Successfully Loaded ${clientsData.length} clients from Supabase.`);
        }
    } catch (error) {
        console.error("❌ Sync Error:", error);
    } finally {
        state.isCloudSynced = true;
        if (typeof window.handleRoute === 'function') {
            window.handleRoute();
        }
    }
}

// ---- loadFullClient: lazy-load one client's full project data ----
export async function loadFullClient(clientId) {
    if (state.clients[clientId] && !state.clients[clientId]._metaOnly && state.clients[clientId].projectData) {
        return state.clients[clientId];
    }

    console.log(`📥 Loading full client data: ${clientId}`);
    const { data, error } = await db
        .from('workspace_clients')
        .select('*')
        .eq('id', clientId)
        .maybeSingle();

    if (error) {
        console.error(`❌ Error loading client ${clientId}:`, error.message);
        return state.clients[clientId] || null;
    }

    if (data) {
        state.clients[clientId] = {
            id: data.id,
            publicToken: data.public_token || data.publicToken,
            meta: data.meta || { name: data.id, status: 'Active' },
            modules: data.modules,
            permissions: data.permissions,
            projectData: data.project_data || data.projectData || { localResources: [], clientTasks: [] },
            sharedMasterIds: data.shared_master_ids || data.sharedMasterIds || []
        };
        delete state.clients[clientId]._metaOnly;
    }
    return state.clients[clientId];
}

// ---- switchClient: set active client, update URL, re-route ----
export async function switchClient(id) {
    state.activeClientId = id;
    sessionStorage.setItem('lastActiveClientId', id);

    const main = document.getElementById('mainContent');
    if (main) {
        main.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:center;height:100%;opacity:0.5;">
                <div style="text-align:center;">
                    <div style="font-size:24px;margin-bottom:10px;">⏳</div>
                    <div>Opening project...</div>
                </div>
            </div>`;
    }

    await loadFullClient(id);

    const urlParams = new URLSearchParams(window.location.search);
    urlParams.set('client', id);

    const newSearch = `?${urlParams.toString()}`;
    const newUrl = `${window.location.origin}${window.location.pathname}${newSearch}#/client-tasks`;

    window.history.pushState({}, '', newUrl);

    if (typeof window.buildLayout === 'function') window.buildLayout();
    if (typeof window.handleRoute === 'function') window.handleRoute();
}

// ---- updateAndSync: run a local mutation, then queue a persist ----
export async function updateAndSync(mutationFn) {
    state.isSaving = true;
    try {
        await mutationFn();
        persist();
        console.log("📥 Local State Updated. Sync Queued...");
    } catch (error) {
        console.error("❌ Local Mutation Failed:", error);
    } finally {
        setTimeout(() => { state.isSaving = false; }, 2000);
    }
}

// ---- getActiveClient: resolve the "current" client from URL/state ----
export function getActiveClient() {
    const urlParams = new URLSearchParams(window.location.search);
    const accessToken = urlParams.get('access');
    const clientIdParam = urlParams.get('client');

    if (!state.clients) return null;

    if (clientIdParam && state.clients[clientIdParam]) {
        state.activeClientId = clientIdParam;
        return state.clients[clientIdParam];
    }

    if (state.activeClientId && state.clients[state.activeClientId]) {
        return state.clients[state.activeClientId];
    }

    if (accessToken) {
        const foundClient = Object.values(state.clients).find(c =>
            c.publicToken === accessToken || c.id === accessToken || c.meta?.accessCode === accessToken
        );
        if (foundClient) {
            state.activeClientId = foundClient.id;
            return foundClient;
        }
    }

    return null;
}

// ---- backup export / import ----
export async function exportMasterBackup() {
    try {
        const { data: clientRows, error } = await db
            .from('workspace_clients')
            .select('*');

        if (error) throw error;

        const clients = (clientRows || []).map(row => ({
            _id: row.id,
            public_token: row.public_token,
            meta: row.meta,
            modules: row.modules,
            permissions: row.permissions,
            project_data: row.project_data,
            shared_master_ids: row.shared_master_ids || []
        }));

        const payload = {
            _version: 1,
            _exportedAt: new Date().toISOString(),
            master: JSON.parse(JSON.stringify(state.master)),
            clients
        };

        const ts = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `ol_backup_${ts}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
        console.log(`✅ Backup exported: master + ${clients.length} clients`);
    } catch (e) {
        alert('❌ Export failed: ' + e.message);
        console.error(e);
    }
}

export async function importMasterBackup(event) {
    const file = event.target.files[0];
    if (!file) return;
    event.target.value = '';

    let data;
    try { data = JSON.parse(await file.text()); } catch (e) { alert('Invalid JSON file'); return; }

    const isCombined = data._version === 1 && data.master && Array.isArray(data.clients);

    const masterData = isCombined ? data.master : (() => {
        const d = { ...data };
        if (d.master && !d.rates) { Object.assign(d, d.master); }
        delete d.master;
        return d;
    })();
    const clients = isCombined ? data.clients : [];

    const fnCount = (masterData.functions || []).length;
    const appCount = (masterData.apps || []).length;
    const varCount = Object.keys(masterData.rates?.variables || {}).length;
    const clientCount = clients.length;
    const exportedAt = data._exportedAt ? new Date(data._exportedAt).toLocaleString() : 'unknown date';

    if (!confirm(
        `Restore "${file.name}"?\n` +
        (data._exportedAt ? `Exported: ${exportedAt}\n` : '') +
        `\n• ${fnCount} functions\n• ${appCount} apps\n• ${varCount} rate variables` +
        (clientCount ? `\n• ${clientCount} client projects` : '\n• Master library only (no client data)') +
        `\n\nThis will overwrite your current data. Cannot be undone.`
    )) return;

    try {
        const masterPayload = {
            id: 'main_state',
            exported_at: new Date().toISOString(),
            rates: masterData.rates || {},
            apps: masterData.apps || [],
            functions: masterData.functions || [],
            resource_types: masterData.resourceTypes || [],
            datapoints: masterData.datapoints || [],
            task_blueprints: masterData.taskBlueprints || [],
            how_to_library: masterData.howToLibrary || [],
            analyses: masterData.analyses || []
        };

        const { error: masterErr } = await db
            .from('workspace_masters')
            .upsert(masterPayload, { onConflict: 'id' });

        if (masterErr) throw masterErr;
        state.master = masterData;

        if (clients.length) {
            const clientPayloads = clients.map(c => {
                const { _id, ...clientData } = c;
                return {
                    id: _id,
                    public_token: clientData.public_token ?? clientData.publicToken ?? null,
                    meta: clientData.meta || {},
                    modules: clientData.modules || {},
                    permissions: clientData.permissions || {},
                    project_data: clientData.project_data ?? clientData.projectData ?? {},
                    shared_master_ids: clientData.shared_master_ids ?? clientData.sharedMasterIds ?? []
                };
            });

            const { error: clientErr } = await db
                .from('workspace_clients')
                .upsert(clientPayloads, { onConflict: 'id' });

            if (clientErr) throw clientErr;

            clients.forEach(c => {
                const { _id, ...clientData } = c;
                state.clients[_id] = {
                    id: _id,
                    publicToken: clientData.public_token ?? clientData.publicToken,
                    meta: clientData.meta || { name: _id, status: 'Active' },
                    modules: clientData.modules,
                    permissions: clientData.permissions,
                    projectData: clientData.project_data ?? clientData.projectData ?? { localResources: [], clientTasks: [] },
                    sharedMasterIds: clientData.shared_master_ids ?? clientData.sharedMasterIds ?? []
                };
            });
        }

        console.log(`✅ Restored: master + ${clients.length} clients`);
        alert(`✅ Backup restored!\n\n• Master library\n${clients.length ? `• ${clients.length} client projects` : ''}`);
        if (typeof window.handleRoute === 'function') window.handleRoute();
    } catch (e) {
        alert('❌ Restore failed: ' + e.message);
        console.error(e);
    }
}

// ---- bridge: keep every not-yet-extracted OL.* / window.* call working ----
window.db = db;
window.state = state;
window.getActiveClient = getActiveClient;
window.OL = window.OL || {};

Object.assign(window.OL, {
    state, persist, sync, loadFullClient, switchClient, updateAndSync,
    exportMasterBackup, importMasterBackup
});
