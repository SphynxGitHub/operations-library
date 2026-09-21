//======================= CORE / DATA LAYER =======================//

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';
import { mirrorClientRequests } from './requests.js';

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
        automationRules: [],
        sops: [], // Standard Operating Procedures — named groups of taskBlueprints applied together
        testTemplates: [], // The steps a tester works through for each kind of request (see features/testing.js)
        reviewDefaults: { days: 30, followUpEveryDays: 10 }, // Client review length and check-in spacing (see features/review.js)
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

// ---- visible save-failure notice ----
// persist() previously only logged failures to console — invisible unless
// you happened to have DevTools open. This surfaces the same failures as
// an on-screen toast so a broken save is never silent again.
function showSyncErrorToast(message) {
    if (typeof document === 'undefined') return;
    let el = document.getElementById('ol-sync-error-toast');
    if (!el) {
        el = document.createElement('div');
        el.id = 'ol-sync-error-toast';
        el.style.cssText = `
            position:fixed; bottom:20px; right:20px; z-index:99999;
            background:#7f1d1d; color:#fecaca; border:1px solid #ef4444;
            padding:12px 16px; border-radius:8px; max-width:360px;
            font-size:12px; line-height:1.5; box-shadow:0 10px 25px -5px rgba(0,0,0,0.5);
            display:flex; align-items:flex-start; gap:10px;
        `;
        document.body.appendChild(el);
    }
    el.innerHTML = `
        <div style="flex:1;">
            <strong style="display:block; margin-bottom:2px;">⚠️ Save failed</strong>
            <span>${message}</span>
        </div>
        <button onclick="document.getElementById('ol-sync-error-toast')?.remove()"
                style="background:none;border:none;color:#fecaca;cursor:pointer;font-size:14px;line-height:1;">✕</button>
    `;
    clearTimeout(window._olSyncErrorToastTimer);
    window._olSyncErrorToastTimer = setTimeout(() => { el.remove(); }, 12000);
}

// ---- persist: debounced write of master + active client to Supabase ----
export function persist() {
    // NOTE: window.IS_GUEST is set to true for any non-admin session —
    // including a real logged-in partner/client and the legacy
    // ?access=token flow (see core/auth.js). Those users legitimately
    // need to save their own project's data (e.g. team member card
    // edits), so IS_GUEST can no longer be used as a blanket "read-only"
    // gate here. Per-tab write access is enforced separately via
    // checkPermission(); this function just performs the save.
    if (window.saveTimeout) clearTimeout(window.saveTimeout);
    window.lastSyncHash = null;
    // Always return a real Promise — several callers chain `.then()`
    // off this (e.g. features/apps.js handleAppTierSelection), which
    // previously crashed with "Cannot read properties of undefined
    // (reading 'then')" because this function never returned anything.
    //
    // 🐛 FIX: persist() debounces by clearing any pending save timer and
    // starting a new one. That's fine for the save itself, but every call
    // used to hand back its OWN promise tied to ITS OWN timer — and
    // clearTimeout()'ing an earlier timer meant that timer's resolve()
    // never ran, so any caller who did `OL.persist().then(cb)` on an
    // earlier call in the same debounce window had its `cb` silently
    // dropped forever. In practice that showed up as things like a
    // resource modal auto-save's "refresh whatever's showing after the
    // save completes" callback firing 1.5s late — often well after the
    // user had already closed the modal and moved on — instead of not
    // firing at all when a second save call landed before the first
    // fired (or, elsewhere, of legitimate follow-up work never running).
    // Now every call's resolver is queued and ALL of them get resolved
    // together when the (single, still-debounced) save actually runs.
    if (!window._pendingPersistResolvers) window._pendingPersistResolvers = [];
    return new Promise((resolve) => {
        window._pendingPersistResolvers.push(resolve);
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
                analyses: masterCopy.analyses || [],
                sphynx_team: masterCopy.sphynxTeam || [],
                automation_rules: masterCopy.automationRules || [],
                sops: masterCopy.sops || [],
                synced_calendar_ids: masterCopy.syncedCalendarIds || [],
                roles: masterCopy.roles || [],
                team_prompt_suppressions: masterCopy.teamPromptSuppressions || []
            };
            if (state.masterHasTestTemplates) masterPayload.test_templates = masterCopy.testTemplates || [];
            if (state.masterHasReviewDefaults) masterPayload.review_defaults = masterCopy.reviewDefaults || { days: 30, followUpEveryDays: 10 };

            // Only staff write the master row. A partner's or client's copy of it is a limited,
            // read-only view (see sync), and saving it back would overwrite the team roster,
            // automation rules and SOPs with blanks.
            const { error: masterErr } = window.IS_GUEST
                ? { error: null }
                : await db
                    .from('workspace_masters')
                    .upsert(masterPayload, { onConflict: 'id' });

            if (masterErr) {
                console.error("❌ Master Persist Error:", masterErr.message);
                showSyncErrorToast(`Some changes couldn't be saved (${masterErr.message}). Your latest edits may not have synced.`);
            }

            const idsToSave = new Set(state.dirtyClientIds || []);
            if (state.activeClientId) idsToSave.add(state.activeClientId);
            state.dirtyClientIds = new Set(); // claimed for this cycle; re-added below on failure

            for (const activeId of idsToSave) {
                const client = state.clients[activeId];
                if (!client) continue;

                // Requests that just became active get their automation rules run once,
                // before this save captures the client, so any tasks they create are saved too.
                try {
                    if (window.OL && typeof window.OL.fireRequestActivations === 'function') {
                        window.OL.fireRequestActivations(client, masterCopy.resources || []);
                    }
                } catch (activationErr) {
                    console.warn('Request activation rules failed:', activationErr);
                }

                // A request whose steps are now done gets its testing checklist (and a fix task for any failed
                // step) before this save captures the client, so they are saved with it.
                try {
                    if (!window.IS_GUEST && window.OL && typeof window.OL.updateTestRunsFor === 'function') {
                        window.OL.updateTestRunsFor(client);
                    }
                    // once every request in the round has passed, the review is set up and the client notification is due
                    if (!window.IS_GUEST && window.OL && typeof window.OL.updateRoundStatesFor === 'function') {
                        window.OL.updateRoundStatesFor(client);
                    }
                } catch (testingErr) {
                    console.warn('Testing checklist update failed:', testingErr);
                }

                const clientCopy = JSON.parse(JSON.stringify(client));
                if (clientCopy.projectData) {
                    delete clientCopy.projectData.resources;
                }

                if (!clientCopy.projectData || !clientCopy.projectData.localResources) {
                    console.error(`🛑 PERSIST SKIPPED for ${activeId}: Incomplete client object`);
                    showSyncErrorToast(`A project's data looked incomplete, so its save was skipped to avoid overwriting anything. Refresh and try again.`);
                    continue;
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
                    console.error(`❌ Client Persist Error [${activeId}]:`, clientErr.message);
                    showSyncErrorToast(`Couldn't save changes for a client project (${clientErr.message}). Will retry automatically.`);
                    // Keep it marked dirty so the next debounced cycle retries it.
                    if (!state.dirtyClientIds) state.dirtyClientIds = new Set();
                    state.dirtyClientIds.add(activeId);
                } else {
                    // Copy scoping line items into the requests tables. Fire and
                    // forget: it never throws and never blocks or fails a save.
                    mirrorClientRequests(db, clientCopy, {
                        masterResources: masterCopy.resources || [],
                        roles: masterCopy.roles || [],
                        closedNames: (state.master?.taskStatuses || []).filter(st => st.isClosed).map(st => st.name),   // empty falls back to Done
                        staff: state.adminMode === true || state.teamMemberMode === true,
                    });
                }
            }

            window.lastLocalSave = Date.now();
            console.log("✅ Background Sync Complete.");
        } catch (error) {
            console.error("💀 Persistence Error:", error);
            showSyncErrorToast(`Save failed unexpectedly (${error?.message || error}). Check your connection and try again.`);
            } finally {
                const resolvers = window._pendingPersistResolvers || [];
                window._pendingPersistResolvers = [];
                resolvers.forEach(r => r());
            }
        }, 1500);
    });
}

// ---- sync: initial fetch of master registry + client list ----
export async function sync() {
    if (window.isSyncInitialized) return;
    window.isSyncInitialized = true;
    console.log("📡 Initializing Supabase Unified Workspace Sync...");

    try {
        // Staff read the whole master row. Partners and clients only get the shared registry (apps,
        // functions, resource types, datapoints, rates, templates), never the team roster, automation
        // rules or SOPs. Until the database lockdown is applied that function does not exist yet, so
        // fall back to the plain read.
        let masterData = null;
        let masterErr = null;
        if (window.IS_GUEST) {
            const viaRpc = await db.rpc('ol_master_for_clients');
            if (!viaRpc.error && viaRpc.data) {
                masterData = viaRpc.data;
            } else {
                const plain = await db.from('workspace_masters').select('*').maybeSingle();
                masterData = plain.data;
                masterErr = plain.error;
            }
        } else {
            const staffRead = await db.from('workspace_masters').select('*').maybeSingle();
            masterData = staffRead.data;
            masterErr = staffRead.error;
        }

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
            if (Array.isArray(masterData.sphynx_team) && masterData.sphynx_team.length > 0) state.master.sphynxTeam = masterData.sphynx_team;
            if (Array.isArray(masterData.automation_rules)) state.master.automationRules = masterData.automation_rules;
            if (Array.isArray(masterData.sops)) state.master.sops = masterData.sops;
            if (Array.isArray(masterData.synced_calendar_ids)) state.master.syncedCalendarIds = masterData.synced_calendar_ids;
            if (Array.isArray(masterData.roles)) state.master.roles = masterData.roles;
            if (Array.isArray(masterData.team_prompt_suppressions)) state.master.teamPromptSuppressions = masterData.team_prompt_suppressions;
            // The test_templates column comes from 013_test_templates.sql. Until it exists, do not try to save it
            // (an unknown column would make every master save fail).
            state.masterHasTestTemplates = Object.prototype.hasOwnProperty.call(masterData, 'test_templates');
            if (Array.isArray(masterData.test_templates)) state.master.testTemplates = masterData.test_templates;
            state.masterHasReviewDefaults = Object.prototype.hasOwnProperty.call(masterData, 'review_defaults');
            if (masterData.review_defaults && typeof masterData.review_defaults === 'object' && !Array.isArray(masterData.review_defaults)) state.master.reviewDefaults = masterData.review_defaults;
            console.log(`🏛️ Master Registry Loaded: ${state.master.apps.length} Apps, ${state.master.functions.length} Functions.`);

            // A logged-in team member's menu permissions are a snapshot
            // taken at login — refresh them from the roster we just pulled
            // so an admin granting access post-signup takes effect without
            // requiring that person to log out and back in.
            if (typeof OL.reconcileCurrentUserPermissions === 'function' && OL.reconcileCurrentUserPermissions()) {
                if (typeof window.buildLayout === 'function') window.buildLayout();
            }
        }

        // Sphynx staff roster: make sure it's populated even if this is the
        // first load and the Team page hasn't been opened yet this session.
        if (!state.master.sphynxTeam || state.master.sphynxTeam.length === 0) {
            state.master.sphynxTeam = [
                { id: "tm-1", name: "Admin Owner", email: "admin@sphynx.agency", phone: "", role: "Master Admin", signature: "Admin Owner | Sphynx Agency", rate: 300 },
                { id: "tm-2", name: "Lead Developer", email: "dev@sphynx.agency", phone: "", role: "Developer", signature: "Development Team | Sphynx Agency", rate: 150 }
            ];
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

        // Google connection status was previously only ever set in-memory
        // right after the OAuth redirect, so it reset to "disconnected" on
        // every page load/reload even though the tokens were still valid
        // server-side. Check for a real stored token instead, so the UI
        // reflects the actual connection state.
        const { data: googleTokenRow, error: googleTokenErr } = window.IS_GUEST
            ? { data: null, error: null }     // partners and clients do not see the company Google connection
            : await db
                .from('google_auth_tokens')
                .select('email')
                .limit(1)
                .maybeSingle();

        if (googleTokenErr) {
            console.error("❌ Google Token Check Error (RLS on google_auth_tokens likely blocking anon reads — connection status will keep resetting on reload until this is fixed):", googleTokenErr.message);
        } else if (googleTokenRow) {
            console.log("✅ Google Token Found — restoring Connected status:", googleTokenRow.email);
            state.master.googleConnected = true;
            if (!state.master.communications) state.master.communications = {};
            if (!state.master.communications.gmail) state.master.communications.gmail = {};
            state.master.communications.gmail.connected = true;
            state.master.communications.gmail.email = googleTokenRow.email || '';
        } else if (!window.IS_GUEST) {
            console.warn("⚠️ No row found in google_auth_tokens — Google will show as disconnected until you reconnect.");
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

// ---- markClientDirty: flag a client for the next persist() cycle ----
// For code paths that mutate state.clients[id] directly and call persist()
// themselves rather than going through updateAndSync (e.g. status/name/
// permission edits from the global client registry, where id often isn't
// state.activeClientId). Call this before persist() or the write is silently
// dropped — persist() only ever saves activeClientId plus whatever's here.
export function markClientDirty(clientId) {
    if (!clientId) return;
    if (!state.dirtyClientIds) state.dirtyClientIds = new Set();
    state.dirtyClientIds.add(clientId);
}

// ---- updateAndSync: run a local mutation, then queue a persist ----
export async function updateAndSync(mutationFn, targetClientId) {
    state.isSaving = true;
    try {
        await mutationFn();
        // Most mutations happen against state.activeClientId (the workspace
        // you're currently inside), which persist() already covers. But some
        // callers — e.g. the master Task Manager rollup — mutate an arbitrary
        // client by id while activeClientId is unset or points elsewhere.
        // Track those explicitly so persist() knows to save them too.
        if (targetClientId) {
            if (!state.dirtyClientIds) state.dirtyClientIds = new Set();
            state.dirtyClientIds.add(targetClientId);
        }
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

// ---- getBusinessScopedClients: clients visible in Business Manager views ----
// Admin (state.businessScopePartnerId unset) sees every client.
// A Partner viewing their own Business Manager tabs only sees clients they manage
// (client.meta.partnerOwner === that partner's client id).
export function getBusinessScopedClients() {
    const all = Object.values(state.clients || {});
    const partnerId = state.businessScopePartnerId;
    if (!partnerId) return all;
    return all.filter(c => String(c.meta?.partnerOwner) === String(partnerId));
}

// Was referenced in a couple of places (task comments, and now how-to guide
// edit-tracking) but never actually defined anywhere — always silently fell
// back to "Sphynx Team" regardless of who's logged in. Best-effort here
// across a few plausible property names, since this app's per-member login
// identity may live somewhere this file doesn't know about yet — correct
// the property name if it's tracked differently.
export function getCurrentUserName() {
    return state.currentUser?.name
        || state.currentMember?.name
        || window.CURRENT_USER_NAME
        || window.LOGGED_IN_MEMBER_NAME
        || (window.FORCE_ADMIN ? 'Admin' : '')
        || 'Sphynx Team';
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

// ---- Global OL namespace declaration ----
window.OL = window.OL || {};
const OL = window.OL;

// Resolves an email address against Sphynx staff and Client Team rosters.
// Returns an interactive, clickable pill with display name if matched,
// or an interactive '+' prompt button if unrecognized.
OL.renderContactPillOrPrompt = function(emailStr, options = {}) {
    const clean = (emailStr || '').toLowerCase().trim();
    if (!clean) return '';

    const roster = state.master?.sphynxTeam || [];
    const staff = roster.find(m => (m.email || '').toLowerCase().trim() === clean);
    
    // 1. Check Sphynx Team — Clickable to open Sphynx Team tab/modal
    if (staff) {
        return `<span class="pill tiny soft" 
                      style="font-size:10px; font-weight:600; padding:2px 8px; border-radius:10px; display:inline-flex; align-items:center; gap:4px; cursor:pointer;"
                      onclick="event.stopPropagation(); if(typeof OL.openTeamMemberModal === 'function') OL.openTeamMemberModal('${staff.id}'); else window.location.hash='#/business/team';"
                      title="Sphynx Team Member — Click to view profile">
            <i data-lucide="user" style="width:10px;height:10px; color:var(--accent); pointer-events:none;"></i> ${esc(staff.name)}
        </span>`;
    }

    // 2. Check Client Team Members — Clickable to jump directly into the Project Workspace
    let matchedClientContact = null;
    let matchedClientId = '';
    let matchedClientName = '';

    Object.values(state.clients || {}).forEach(c => {
        const found = (c.projectData?.teamMembers || []).find(tm => (tm.email || '').toLowerCase().trim() === clean);
        if (found) {
            matchedClientContact = found;
            matchedClientId = c.id;
            matchedClientName = c.meta?.name || 'Project';
        }
    });

    if (matchedClientContact) {
        return `<span class="client-link-badge pill tiny soft" 
                      style="font-size:10px; font-weight:600; padding:2px 8px; border-radius:10px; display:inline-flex; align-items:center; gap:4px; cursor:pointer;"
                      onclick="event.stopPropagation(); if(typeof OL.closeModal === 'function') OL.closeModal(); OL.switchClient('${matchedClientId}');"
                      title="Jump to ${esc(matchedClientName)} Workspace">
            <i data-lucide="folder" style="width:10px;height:10px; color:#38bdf8; pointer-events:none;"></i> ${esc(matchedClientContact.name || clean)} <span class="muted" style="font-size:9px;">(${esc(matchedClientName)})</span>
        </span>`;
    }

    // 3. Unrecognized Email — Render Email with '+' Add Contact Prompt
    const clickHandler = options.clientId 
        ? `OL._maybePromptAddSenderToTeam('${options.clientId}', '${esc(clean)}')` 
        : `OL.promptCreateClientFromUnrecognizedEmail('${esc(clean)}')`;

    return `<span style="display:inline-flex; align-items:center; gap:4px; font-size:11px;">
        <span class="muted">${esc(clean)}</span>
        <button class="btn tiny soft" 
                style="padding:1px 5px; font-size:10px; font-weight:bold; color:var(--accent);" 
                onclick="event.stopPropagation(); ${clickHandler}" 
                title="Unrecognized contact — click to create client or add to team">
            <i data-lucide="user-plus" style="width:10px;height:10px; pointer-events:none;"></i> +
        </button>
    </span>`;
};

// 1. CONVERT TASK TO RESOURCE
OL.convertTaskToResource = function(clientId, taskId) {
  const client = state.clients?.[clientId];
  const task = client?.projectData?.clientTasks?.find(t => t.id === taskId);

  if (!task) {
    alert("Task not found.");
    return;
  }

  if (!confirm(`Convert task "${task.name || task.title}" into a Resource?`)) return;

  OL.updateAndSync(() => {
    if (!client.projectData.localResources) client.projectData.localResources = [];

    // Transform Task into Resource object structure
    const newResource = {
      id: "sys-" + uid(),
      name: task.name || task.title,
      type: "Admin",
      description: task.description || "Converted from client task.",
      createdDate: new Date().toISOString(),
      isLocked: false,
      steps: [],
      data: {
        originalTaskId: taskId,
        source: "task_conversion"
      }
    };

    client.projectData.localResources.push(newResource);

    // Remove task from clientTasks
    client.projectData.clientTasks = client.projectData.clientTasks.filter(t => t.id !== taskId);
  }, clientId);

  if (typeof OL.showToast === "function") {
    OL.showToast(`Converted task to Resource: "${task.name || task.title}"`);
  }

  // Refresh UI / Close Modal
  if (typeof OL.closeModal === "function") OL.closeModal();
  if (typeof window.handleRoute === "function") window.handleRoute();
};


// 2. CONVERT TASK TO REQUEST / SCOPING REQUIREMENT
OL.convertTaskToRequirement = function(clientId, taskId) {
  const client = state.clients?.[clientId];
  const task = client?.projectData?.clientTasks?.find(t => t.id === taskId);

  if (!task) {
    alert("Task not found.");
    return;
  }

  if (!confirm(`Convert task "${task.name || task.title}" into a Client Request/Requirement?`)) return;

  OL.updateAndSync(() => {
    if (!client.projectData.scopingSheets) {
      client.projectData.scopingSheets = [{ id: "initial", lineItems: [] }];
    }

    const activeSheet = client.projectData.scopingSheets[0];

    // Transform Task into Scoping/Requirement Line Item
    const newRequirement = {
      id: "req-" + Date.now(),
      actionName: task.name || task.title,
      description: task.description || "Action required from client.",
      targetType: "function",
      targetId: "",
      clientGuideId: task.howToIds?.[0] || "",
      status: "Pending Client Action",
      createdDate: new Date().toISOString()
    };

    activeSheet.lineItems.push(newRequirement);

    // Remove task from clientTasks
    client.projectData.clientTasks = client.projectData.clientTasks.filter(t => t.id !== taskId);
  }, clientId);

  if (typeof OL.showToast === "function") {
    OL.showToast(`Converted task to Client Request: "${task.name || task.title}"`);
  }

  // Refresh UI / Close Modal
  if (typeof OL.closeModal === "function") OL.closeModal();
  if (typeof window.handleRoute === "function") window.handleRoute();
};

// Interactive modal prompt when clicking '+' on an unrecognized email
OL.promptCreateClientFromUnrecognizedEmail = function(email) {
    const cleanEmail = (email || '').toLowerCase().trim();
    if (!cleanEmail) return;

    const clients = Object.values(state.clients || {}).filter(c => c.meta?.name);
    const defaultName = cleanEmail.split('@')[0];

    const html = `
        <div class="modal-head">
            <div class="modal-title-text">👤 Add Contact: ${esc(cleanEmail)}</div>
            <button class="btn small soft" onclick="OL.closeModal()">✕</button>
        </div>
        <div class="modal-body" style="max-width:500px; width:100%;">
            <!-- STEP 1: SELECT OR CREATE PROJECT -->
            <div style="margin-bottom:16px;">
                <label class="tiny bold uppercase muted" style="display:block; margin-bottom:6px;">1. Select Project / Client</label>
                <select id="contact-assign-project-select" class="modal-input tiny" style="width:100%; margin-bottom:8px;" onchange="OL._onContactProjectSelectChange(this.value, '${esc(cleanEmail)}')">
                    <option value="__new__">+ Create New Project...</option>
                    ${clients.map(c => `<option value="${c.id}">${esc(c.meta?.name || 'Unnamed')}</option>`).join('')}
                </select>

                <div id="contact-new-project-input-container">
                    <input type="text" id="contact-new-project-name" class="modal-input tiny" placeholder="New Project / Client Name..." value="${esc(defaultName)}" style="width:100%;">
                </div>
            </div>

            <!-- STEP 2: SELECT EXISTING CONTACT OR CREATE NEW -->
            <div style="margin-bottom:20px;">
                <label class="tiny bold uppercase muted" style="display:block; margin-bottom:6px;">2. Assign to Contact Card</label>
                <div id="contact-member-picker-container">
                    <!-- Populated dynamically when a project is selected -->
                    <div class="tiny muted" style="padding:8px; background:rgba(255,255,255,0.02); border:1px solid var(--line); border-radius:6px;">
                        Will create a new contact card on the new project.
                    </div>
                </div>
            </div>

            <div style="display:flex; justify-content:flex-end; gap:8px;">
                <button class="btn tiny soft" onclick="OL.closeModal()">Cancel</button>
                <button class="btn tiny primary" onclick="OL._saveContactFromUnrecognizedModal('${esc(cleanEmail)}')" style="font-weight:bold;">
                    <i data-lucide="check" style="width:12px;height:12px;"></i> Save Contact
                </button>
            </div>
        </div>
    `;

    openModal(html);
    if (window.lucide) lucide.createIcons();
};

// Updates Step 2 options when changing the selected project in Step 1
OL._onContactProjectSelectChange = function(selectedVal, email) {
    const inputContainer = document.getElementById('contact-new-project-input-container');
    const memberPickerContainer = document.getElementById('contact-member-picker-container');
    if (!memberPickerContainer) return;

    if (selectedVal === '__new__') {
        if (inputContainer) inputContainer.style.display = 'block';
        memberPickerContainer.innerHTML = `
            <div class="tiny muted" style="padding:8px; background:rgba(255,255,255,0.02); border:1px solid var(--line); border-radius:6px;">
                Will create a new primary contact card on the new project.
            </div>
        `;
        return;
    }

    if (inputContainer) inputContainer.style.display = 'none';

    const client = state.clients[selectedVal];
    const members = client?.projectData?.teamMembers || [];

    memberPickerContainer.innerHTML = `
        <select id="contact-assign-member-select" class="modal-input tiny" style="width:100%; margin-bottom:8px;" onchange="OL._onContactMemberSelectChange(this.value)">
            <option value="__new__">+ Create New Contact Card on ${esc(client?.meta?.name || 'Project')}...</option>
            ${members.map(m => `<option value="${m.id}">${esc(m.name || m.email || 'Contact')} (${esc(m.email || 'No email')})</option>`).join('')}
        </select>
        <div id="contact-new-member-name-container">
            <input type="text" id="contact-new-member-name" class="modal-input tiny" placeholder="Contact Person Name..." value="${esc(email.split('@')[0])}" style="width:100%;">
        </div>
    `;
};

OL._onContactMemberSelectChange = function(selectedMemberVal) {
    const inputContainer = document.getElementById('contact-new-member-name-container');
    if (inputContainer) {
        inputContainer.style.display = selectedMemberVal === '__new__' ? 'block' : 'none';
    }
};

// Saves the contact and syncs state
OL._saveContactFromUnrecognizedModal = async function(email) {
    const projectSelect = document.getElementById('contact-assign-project-select');
    if (!projectSelect) return;

    const projectVal = projectSelect.value;
    let targetClientId = projectVal;

    // 1. Create new project if selected
    if (projectVal === '__new__') {
        const newProjectInput = document.getElementById('contact-new-project-name');
        const projectName = (newProjectInput?.value || '').trim() || email.split('@')[0];

        targetClientId = 'c-' + uid();
        state.clients[targetClientId] = {
            id: targetClientId,
            meta: { name: projectName, status: 'Discovery', createdDate: new Date().toISOString() },
            projectData: {
                teamMembers: [{ id: uid(), name: projectName, email: email, isPrimaryContact: true, roles: [] }],
                localResources: [], localApps: [], localAnalyses: [], clientTasks: [],
                scopingSheets: [{ id: 'sheet-' + uid(), lineItems: [] }]
            }
        };
    } else {
        // 2. Attach to existing project
        const client = state.clients[targetClientId];
        if (!client) return;
        if (!client.projectData) client.projectData = {};
        if (!client.projectData.teamMembers) client.projectData.teamMembers = [];

        const memberSelect = document.getElementById('contact-assign-member-select');
        const memberVal = memberSelect?.value || '__new__';

        if (memberVal === '__new__') {
            const memberNameInput = document.getElementById('contact-new-member-name');
            const memberName = (memberNameInput?.value || '').trim() || email.split('@')[0];

            client.projectData.teamMembers.push({
                id: uid(),
                name: memberName,
                email: email,
                roles: [],
                createdDate: new Date().toISOString()
            });
        } else {
            // Add email to existing team member card if not present
            const targetMember = client.projectData.teamMembers.find(m => m.id === memberVal);
            if (targetMember) {
                targetMember.email = email;
            }
        }
    }

    OL.markClientDirty(targetClientId);
    await OL.persist();
    OL.closeModal();

    // Refresh whichever view you actually triggered this from -- NOT both
    // unconditionally. renderBusinessCalendar() and renderBusinessCommunications()
    // both write directly to the same #mainContent, so calling them back to
    // back always left you on whichever one ran last (Communications), even
    // if you started on Calendar. OL._activeEventModalId is only ever set
    // while a calendar event modal is open, so it's a reliable signal for
    // "this came from Calendar" -- everything else (currently just the Gmail
    // unrecognized-sender flow) falls back to Communications, matching this
    // function's original single-purpose behavior before it was reused here.
    if (OL._activeEventModalId && typeof OL.openCalendarEventModal === 'function') {
        if (typeof OL.renderBusinessCalendar === 'function') OL.renderBusinessCalendar();
        OL.openCalendarEventModal(OL._activeEventModalId);
    } else if (typeof OL.renderBusinessCommunications === 'function') {
        OL.renderBusinessCommunications();
    }
};

// Universal Searchable Project/Client Picker Generator
OL.renderSearchableClientPicker = function(options = {}) {
    const {
        id = 'searchable-client-select',
        value = '',
        placeholder = 'Search or pick a project...',
        onSelectFn = 'OL._onSearchableClientSelected',
        includeGeneral = false,
        style = ''
    } = options;

    const currentClient = value ? state.clients[value] : null;
    const initialText = currentClient 
        ? (currentClient.meta?.name || value) 
        : (includeGeneral ? 'General / Business (no client)' : '');

    return `
        <div class="searchable-client-picker-wrapper" style="position:relative; min-width:200px; z-index:100; ${style}">
            <input type="hidden" id="${id}" value="${esc(value)}">
            <div style="position:relative; display:flex; align-items:center;">
                <i data-lucide="building" style="position:absolute; left:8px; width:13px; height:13px; color:var(--muted); pointer-events:none; z-index:2;"></i>
                <input type="text" 
                       id="${id}-search" 
                       class="modal-input tiny" 
                       style="padding-left:26px; padding-right:20px; width:100%; box-sizing:border-box;" 
                       placeholder="${esc(placeholder)}" 
                       value="${esc(initialText)}"
                       autocomplete="off"
                       onfocus="OL._renderPickerDropdown('${id}', this.value, ${includeGeneral}, '${onSelectFn}')" 
                       oninput="OL._renderPickerDropdown('${id}', this.value, ${includeGeneral}, '${onSelectFn}')">
                <i data-lucide="chevron-down" style="position:absolute; right:6px; width:12px; height:12px; color:var(--muted); pointer-events:none;"></i>
            </div>
            <div id="${id}-results" 
                 style="display:none; position:absolute; top:100%; left:0; right:0; z-index:99999; max-height:220px; overflow-y:auto; background:var(--panel-dark, #0f172a); border:1px solid var(--line); border-radius:6px; margin-top:4px; box-shadow:0 10px 25px rgba(0,0,0,0.5); padding:4px;">
            </div>
        </div>
    `;
};

OL.uploadFileToDrive = async function(clientId, file, subfolderName = "Task Attachments") {
  const client = state.clients?.[clientId];
  if (!client) {
    alert("No active client found for file upload.");
    return null;
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);

    reader.onload = async () => {
      try {
        console.log(`📤 Uploading ${file.name} to ${subfolderName}...`);
        
        const { data, error } = await db.functions.invoke("google-drive-sync", {
          body: {
            action: "upload_client_file",
            clientId: clientId,
            clientName: client.meta?.name || "Client Workspace",
            fileName: file.name,
            fileType: file.type,
            fileData: reader.result,
            subfolderName: subfolderName // "App Snapshots" or "Task Attachments"
          }
        });

        if (error || !data?.success) {
          throw new Error(error?.message || "Drive upload failed");
        }

        if (typeof OL.showToast === "function") {
          OL.showToast(`Uploaded ${file.name} to ${subfolderName}`);
        }

        resolve(data); // Returns { fileId, webViewLink }
      } catch (err) {
        console.error("Drive upload error:", err);
        alert(`Failed to upload file to Drive: ${err.message}`);
        reject(err);
      }
    };
  });
};

OL.uploadGlobalSnapshotToDrive = async function(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);

    reader.onload = async () => {
      try {
        console.log(`📤 Uploading global snapshot "${file.name}" to Google Drive...`);
        
        const { data, error } = await db.functions.invoke("google-drive-sync", {
          body: {
            action: "upload_global_snapshot",
            fileName: `${Date.now()}_${file.name}`,
            fileType: file.type,
            fileData: reader.result
          }
        });

        if (error || !data?.success) {
          throw new Error(error?.message || "Drive upload failed");
        }

        if (typeof OL.showToast === "function") {
          OL.showToast(`Image uploaded to Global Drive Snapshots!`);
        }

        resolve(data.url); // Returns direct rendering Drive URL
      } catch (err) {
        console.error("Global Drive snapshot upload error:", err);
        alert(`Failed to upload snapshot to Google Drive: ${err.message}`);
        reject(err);
      }
    };
  });
};

// Internal Dropdown Renderer
OL._renderPickerDropdown = function(pickerId, query, includeGeneral, onSelectFn) {
    const resultsContainer = document.getElementById(`${pickerId}-results`);
    if (!resultsContainer) return;

    const cleanQuery = (query || '').toLowerCase().trim();
    const clients = Object.values(state.clients || {}).filter(c => c.meta?.name);
    const matches = cleanQuery
        ? clients.filter(c => (c.meta?.name || '').toLowerCase().includes(cleanQuery))
        : clients;

    let html = '';
    if (includeGeneral) {
        html += `
            <div class="tiny" 
                 style="padding:6px 10px; border-radius:4px; cursor:pointer; font-weight:600; color:var(--accent); display:flex; align-items:center; gap:6px;"
                 onmouseover="this.style.background='rgba(56,189,248,0.12)'"
                 onmouseout="this.style.background='transparent'"
                 onmousedown="${onSelectFn}('${pickerId}', '', 'General / Business (no client)')">
                <i data-lucide="briefcase" style="width:12px;height:12px;"></i> General / Business (no client)
            </div>
        `;
    }

    if (matches.length) {
        html += matches.map(c => `
            <div class="tiny" 
                 style="padding:6px 10px; border-radius:4px; cursor:pointer; display:flex; align-items:center; gap:6px;"
                 onmouseover="this.style.background='rgba(56,189,248,0.12)'"
                 onmouseout="this.style.background='transparent'"
                 onmousedown="${onSelectFn}('${pickerId}', '${c.id}', '${esc(c.meta?.name || c.id).replace(/'/g, "\\'")}')">
                <i data-lucide="folder" style="width:12px;height:12px;color:#38bdf8;"></i> ${esc(c.meta?.name || c.id)}
            </div>
        `).join('');
    } else if (cleanQuery) {
        html += `<div class="tiny muted" style="padding:6px 10px;">No matching projects</div>`;
    }

    resultsContainer.innerHTML = html;
    resultsContainer.style.display = 'block';
    if (window.lucide) lucide.createIcons();
};

// Default Selection Callback
OL._onSearchableClientSelected = function(pickerId, clientId, clientName) {
    const hiddenInput = document.getElementById(pickerId);
    const searchInput = document.getElementById(`${pickerId}-search`);
    const resultsContainer = document.getElementById(`${pickerId}-results`);

    if (hiddenInput) {
        hiddenInput.value = clientId;
        hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (searchInput) searchInput.value = clientId ? clientName : (searchInput.placeholder.includes('General') ? 'General / Business (no client)' : '');
    if (resultsContainer) resultsContainer.style.display = 'none';
};

// Global Click-Outside Dismiss
// 🐛 FIX: this was querying `[id$="-results"]` site-wide — matching ANY
// element whose id happens to end in "-results", not just this picker's
// own dropdown. That included #resource-library-results (the whole
// resources page's results grid) and #global-search-results, so clicking
// literally anywhere outside a picker — any button, a view-toggle, a
// resource card — silently set display:none on the resources grid. Scoped
// to just the dropdown results that actually belong to a
// .searchable-client-picker-wrapper instance.
document.addEventListener('click', function(e) {
    if (!e.target.closest('.searchable-client-picker-wrapper')) {
        document.querySelectorAll('.searchable-client-picker-wrapper [id$="-results"]').forEach(el => el.style.display = 'none');
    }
});

// ---- bridge: keep every not-yet-extracted OL.* / window.* call working ----
window.db = db;
window.state = state;
window.getActiveClient = getActiveClient;
window.getBusinessScopedClients = getBusinessScopedClients;
window.markClientDirty = markClientDirty;

Object.assign(window.OL, {
    getBusinessScopedClients,
    getCurrentUserName,
    markClientDirty,
    state, persist, sync, loadFullClient, switchClient, updateAndSync,
    exportMasterBackup, importMasterBackup, convertTaskToResource: OL.convertTaskToResource,
  convertTaskToRequirement: OL.convertTaskToRequirement
});
