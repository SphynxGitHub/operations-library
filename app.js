//======================= GENERAL SECTION =======================//

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

// 1. MUST BE LINE 1: Define the namespace immediately
window.OL = window.OL || {};
const OL = window.OL = {};

// 🎨 THEME BOOTLOADER: Run immediately on script load
(function initTheme() {
    const savedTheme = localStorage.getItem('ol_theme'); 
    if (savedTheme === 'light') {
        document.body.classList.add('light-mode');
    } else {
        document.body.classList.remove('light-mode');
    }
    console.log("🌓 Theme Initialized:", savedTheme || 'dark (default)');
})();

window.isMatrixActive = false;

OL.getScopingDataForResource = function(resId) {
    const client = getActiveClient();
    if (!client?.projectData?.scopingSheets?.[0]) return null;
    const sheet = client.projectData.scopingSheets[0];
    return sheet.lineItems.find(item => String(item.resourceId) === String(resId));
};

// 🚀 THE ANCHOR: Context-Aware Security Lock
const params = new URLSearchParams(window.location.search);
const isFiddle = window.location.hostname.includes('jsfiddle.net') || window.location.hostname.includes('fiddle.jshell.net');

// Force admin if the secret key is present OR if we are running in JSFiddle
window.FORCE_ADMIN = params.get('admin') === 'pizza123' || isFiddle; 

const val = (v) => (v === undefined || v === null) ? "" : v;
const num = (v) => (v === undefined || v === null || v === 0) ? "" : v;
const esc = (s) => String(s ?? "").replace(/&/g, "&").replace(/</g, "<").replace(/>/g, ">").replace(/"/g, "");
const uid = () => "id_" + Math.random().toString(36).slice(2, 10);

// 3. Initialize Supabase Client
const SUPABASE_URL = 'https://kexnnpwjerrnsmifauuo.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtleG5ucHdqZXJybnNtaWZhdXVvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc1MDcxNTEsImV4cCI6MjEwMzA4MzE1MX0.BAgC5wN4SKqfqKn0Gt7a53sGvigh_YlaMcQLdaovc08';
window.db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// 4. Initialize the state placeholder
let state = {
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
OL.state = window.state = state;

// Persist Changes directly to Supabase
OL.persist = async function() {
    if (window.saveTimeout) clearTimeout(window.saveTimeout);
    window.lastSyncHash = null;
    window.saveTimeout = setTimeout(async () => {
        window.saveTimeout = null;
        try {
            console.log("☁️ Background Sync Starting...");

            // Always save master
            const masterCopy = JSON.parse(JSON.stringify(state.master));
            await window.db
                .from('workspace_masters')
                .upsert({ id: 'main_state', ...masterCopy });

            const activeId = state.activeClientId;
            if (activeId && state.clients[activeId]) {
                const clientCopy = JSON.parse(JSON.stringify(state.clients[activeId]));
                if (clientCopy.projectData) {
                    delete clientCopy.projectData.resources;
                }
                if (!clientCopy.projectData || !clientCopy.projectData.localResources) {
                    console.error('🛑 PERSIST ABORTED: Incomplete client object, refusing to save');
                    window.lastLocalSave = Date.now();
                    return;
                }
                await window.db
                    .from('workspace_clients')
                    .upsert({ id: activeId, ...clientCopy });
            }

            window.lastLocalSave = Date.now();
            console.log("✅ Background Sync Complete.");
        } catch (error) {
            console.error("💀 Persistence Error:", error);
        }
    }, 1500);
};

window.addEventListener("load", () => {
    // 1. Security Check FIRST
    const allowed = OL.initializeSecurityContext();
    if (!allowed) return;

    // 2. Admin Verification
    if (window.location.search.includes('admin=pizza123')) {
        state.adminMode = true;
    }

    // 3. Recall Client
    const savedClientId = sessionStorage.getItem('lastActiveClientId');
    if (savedClientId) state.activeClientId = savedClientId;

    // 4. Recall Visualizer depth
    state.focusedWorkflowId = sessionStorage.getItem('active_workflow_id');
    state.focusedResourceId = sessionStorage.getItem('active_resource_id');

    const currentHash = location.hash;
    const isDashboard = currentHash === "" || currentHash === "#/";
    const isVisualizer = currentHash.includes('visualizer');

    if ((state.focusedWorkflowId || state.focusedResourceId) &&
        (isDashboard || isVisualizer) &&
        !currentHash.includes('scoping')) {
        console.log("♻️ Resuming Flow Map depth");
        const isVault = currentHash.includes('vault');
        location.hash = isVault ? "#/vault/visualizer" : "#/visualizer";
    }

    if (typeof window.buildLayout === 'function') window.buildLayout();
    const mainEl = document.getElementById('mainContent');
    if (mainEl) {
        mainEl.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:center;height:60vh;flex-direction:column;gap:16px;opacity:0.4;">
                <div class="fv-spinner"></div>
                <div style="font-size:13px;letter-spacing:0.05em;">Connecting to Registry...</div>
            </div>`;
    }

    OL.sync();
});

// Fetch Data from Supabase
OL.sync = async function() {
    if (window.isSyncInitialized) return;
    window.isSyncInitialized = true;
    console.log("📡 Initializing Supabase Unified Workspace Sync...");

    try {
        // 1. Fetch Master Registry
        const { data: masterData, error: masterErr } = await window.db
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

        // 2. Fetch Client List
        const { data: clientsData, error: clientsErr } = await window.db
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
                    projectData: c.project_data || c.projectData || { localResources: [], clientTasks: [] }
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
};

OL.loadFullClient = async function(clientId) {
    if (state.clients[clientId] && !state.clients[clientId]._metaOnly && state.clients[clientId].projectData) {
        return state.clients[clientId];
    }
    
    console.log(`📥 Loading full client data: ${clientId}`);
    const { data, error } = await window.db
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
            projectData: data.project_data || data.projectData || { localResources: [], clientTasks: [] }
        };
        delete state.clients[clientId]._metaOnly;
    }
    return state.clients[clientId];
};

OL.switchClient = async function(id) {
    state.activeClientId = id;
    sessionStorage.setItem('lastActiveClientId', id);
    
    const main = document.getElementById('mainContent');
    if (main) main.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:center;height:100%;opacity:0.5;">
            <div style="text-align:center;">
                <div style="font-size:24px;margin-bottom:10px;">⏳</div>
                <div>Loading client...</div>
            </div>
        </div>`;
    
    await OL.loadFullClient(id);
    
    const currentSearch = window.location.search || '';
    window.location.href = `${window.location.origin}${window.location.pathname}${currentSearch}#/client-tasks`;
    window.handleRoute();
};

OL.updateAndSync = async function(mutationFn) {
    state.isSaving = true;
    try {
        await mutationFn();
        OL.persist();
        console.log("📥 Local State Updated. Sync Queued...");
    } catch (error) {
        console.error("❌ Local Mutation Failed:", error);
    } finally {
        setTimeout(() => { state.isSaving = false; }, 2000);
    }
};

OL.getRegistryIcon = function(type) {
    if (!type) return "file-text"; 
    
    const registry = state.master.resourceTypes || [];
    const entry = registry.find(t => 
        String(t.type).toLowerCase() === String(type).toLowerCase()
    );

    if (entry && entry.lucideIcon) return entry.lucideIcon;

    const defaults = {
        zap: "zap",
        form: "file-text",
        email: "mail",
        event: "calendar",
        sop: "book-open",
        guide: "book-open",
        workflow: "workflow",
        checklist: "clipboard-list",
        signature: "pen-tool",
        spreadsheet: "table",
        folder: "folder",
        other: "settings"
    };
    
    return defaults[type.toLowerCase()] || "file-text";
};

window.getActiveClient = function() {
    const urlParams = new URLSearchParams(window.location.search);
    const accessToken = urlParams.get('access');

    if (!state.clients) return null;

    if (state.activeClientId && state.clients[state.activeClientId]) {
        return state.clients[state.activeClientId];
    }

    if (accessToken) {
        const foundClient = Object.values(state.clients).find(c => 
            c.publicToken === accessToken || c.id === accessToken
        );
        if (foundClient) {
            state.activeClientId = foundClient.id;
            return foundClient;
        }
    }

    return null;
};

OL.checkPermission = function (tabKey) {
  const client = getActiveClient();
  if (!client) return "full";
  if (!client.permissions) return "full";
  return client.permissions[tabKey] || "full"; 
};

OL.initializeSecurityContext = function() {
    const params = new URLSearchParams(window.location.search);
    const clientToken = params.get('access'); 
    let adminKeyFromUrl = params.get('admin'); 

    if (clientToken) {
        state.adminMode = false;
        OL.state.adminMode = false;
        window.IS_GUEST = true;
        console.log("👨‍💼 Guest Access Mode Active");
        return true;
    }

    if (adminKeyFromUrl && adminKeyFromUrl === 'pizza123') {
        state.adminMode = true;
        OL.state.adminMode = true;
        window.IS_GUEST = false; 
        console.log("🛠️ Admin Mode Active");
        return true; 
    }

    if (!adminKeyFromUrl && !clientToken) {
        state.adminMode = false;
        document.body.innerHTML = `
            <div style="display:flex;height:100vh;align-items:center;justify-content:center;background:#0d0f12;color:#a0aec0;font-family:sans-serif;text-align:center;">
                <div style="max-width:400px;padding:32px;background:#161920;border-radius:12px;border:1px solid #2d3748;">
                    <div style="font-size:32px;margin-bottom:12px;">🔒</div>
                    <h2 style="color:#fff;margin:0 0 8px 0;font-size:18px;">Access Restricted</h2>
                    <p style="font-size:13px;line-height:1.5;color:#718096;">
                        A valid access key is required to view this workspace.
                    </p>
                </div>
            </div>`;
        return false;
    }
    
    return false;
};

OL.isAdmin = function() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('admin') === 'pizza123';
};

OL.getAdminQuery = function() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.has('admin') ? `?admin=${urlParams.get('admin')}` : '';
};

OL.toggleSidebar = function() {
    const sidebar = document.querySelector('.sidebar');
    const innerContent = document.querySelector('.sidebar-inner-content');
    const toggleIcon = document.querySelector('.toggle-icon');
    if (!sidebar) return;

    const isCollapsed = sidebar.classList.toggle('collapsed');
    if (innerContent) innerContent.style.display = isCollapsed ? 'none' : 'block';
    if (toggleIcon) toggleIcon.innerText = isCollapsed ? '▶' : '◀';
    localStorage.setItem('sidebarCollapsed', isCollapsed);

    // 🚀 Sync the grid — check if inspector is currently open
    const panel = document.getElementById('v2-inspector-panel') 
               || document.getElementById('inspector-panel');
    const inspectorOpen = panel && panel.classList.contains('open');
    const layout = document.querySelector('.three-pane-layout');

    if (layout) {
        const leftCol = isCollapsed ? '65px' : '240px';
        const rightCol = inspectorOpen ? '380px' : '0px';
        layout.style.gridTemplateColumns = `${leftCol} 1fr ${rightCol}`;
    }

    window.dispatchEvent(new Event('resize'));
};

// Run this on page load to restore state
window.addEventListener('load', () => {
    const sidebar = document.querySelector('.sidebar');
    if (sidebar && localStorage.getItem('sidebarCollapsed') === 'true') {
        sidebar.classList.add('collapsed');
    }
});

// Recalculate visualizer layout when sidebar collapses/expands
window.addEventListener('resize', () => {
  if (!window.location.hash.includes('visualizer')) return;

  const body = document.getElementById('fv-body');
  if (!body) return;

  // Force flex to recalculate available width
  body.style.display = 'none';
  body.offsetHeight; // trigger reflow
  body.style.display = 'flex';

  // Re-sync rail heights since available width may have changed
  if (typeof OL._fvSyncRailHeights === 'function') {
    OL._fvSyncRailHeights();
  }
});

OL.toggleTheme = function() {
    const isLight = document.body.classList.toggle('light-mode');
    
    // Save the specific string to match our bootloader check
    localStorage.setItem('ol_theme', isLight ? 'light' : 'dark');
    
    // 🔄 UI Refresh Logic
    if (typeof window.buildLayout === 'function') window.buildLayout(); 
    
    if (window.location.hash.includes('visualizer') && typeof OL.renderVisualizer === 'function') {
        OL.renderVisualizer();
    }

    if (window.lucide) window.lucide.createIcons();
    
    console.log("💾 Theme Preference Saved:", isLight ? 'light' : 'dark');
};

OL.getViewMode = function(pageKey) {
    if (!state.viewModes) state.viewModes = {};
    return state.viewModes[pageKey] || localStorage.getItem(`ol_view_${pageKey}`) || 'cards';
};

OL.setViewMode = function(pageKey, mode) {
    if (!state.viewModes) state.viewModes = {};
    state.viewModes[pageKey] = mode;
    localStorage.setItem(`ol_view_${pageKey}`, mode);
};

OL.viewToggleBtn = function(pageKey, refreshFn) {
    const mode = OL.getViewMode(pageKey);
    return `<button class="btn small soft" 
                    onclick="OL.setViewMode('${pageKey}', '${mode === 'list' ? 'cards' : 'list'}'); ${refreshFn}();"
                    style="display:flex;align-items:center;gap:6px;">
                <i data-lucide="${mode === 'list' ? 'layout-grid' : 'list'}" style="width:14px;height:14px;"></i>
                ${mode === 'list' ? 'Card View' : 'List View'}
            </button>`;
};

/*===================== PARTNER ACCESS ==================*/

// 🔑 THE TOKEN GENERATOR
OL.getAccessToken = function(clientId) {
    const client = state.clients[clientId];
    if (!client) return "guest";

    // 1. If the client already has a dedicated access code, use it
    if (client.meta.accessCode) return client.meta.accessCode;

    // 2. Fallback: Generate a clean 'slug' from their name or ID
    // We'll use this if no specific code exists.
    const slug = client.meta.name.toLowerCase().replace(/[^a-z0-9]/g, '-');
    return `${slug}-${clientId.split('-').pop()}`;
};

OL.getHomeUrl = function() {
    const client = getActiveClient();
    if (!client) return "index.html#/";

    // If this specific project is a Partner, Home is its own Dashboard
    if (client.meta.status === "Partner") {
        return `index.html?access=${OL.getAccessToken()}#/partner-dashboard`;
    }

    // If this project belongs to a partner, Home goes to that Partner's Dashboard
    if (client.meta.partnerOwner) {
        return `index.html?access=${OL.getPartnerAccessToken(client.meta.partnerOwner)}#/partner-dashboard`;
    }

    return "index.html#/";
};

OL.getPartnerContext = function() {
    const params = new URLSearchParams(window.location.search);
    const partnerKey = params.get('partner');
    return state.registry.partners[partnerKey] || null;
};

OL.renderPartnerDashboard = function(leadProject, container) {
    if (!container || !leadProject) return;
    container.style.cssText = '';
    document.body.classList.remove('is-visualizer');

    // 🔍 THE FIX: Ensure we are comparing strings and checking the partnerOwner metadata
    const subClients = Object.values(state.clients).filter(c => 
        String(c.meta?.partnerOwner) === String(leadProject.id)
    );

    container.innerHTML = `
        <div class="partner-portal-header" style="padding: 30px; background: var(--panel-dark); border-bottom: 2px solid var(--accent);">
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <div>
                    <h1 style="margin:0;">🤝 ${esc(leadProject.meta.name)} Portfolio</h1>
                    <p class="tiny accent bold uppercase" style="letter-spacing:1px; margin-top:5px;">Partner Command Center</p>
                </div>
                ${(!window.IS_GUEST || window.location.search.includes('access=')) ? `
                    <button class="btn primary" onclick="OL.partnerCreateClient('${leadProject.id}')">+ Onboard New Client</button>` : ''
                }
            </div>
        </div>

        <div class="partner-grid" style="display:grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap:20px; padding:30px;">
            ${subClients.length > 0 ? subClients.map(c => `
                <div class="card is-clickable" onclick="OL.switchClient('${c.id}')">
                    <div style="font-size: 10px; color: var(--accent); font-weight: bold; margin-bottom: 5px;">SUB-CLIENT</div>
                    <h3 style="margin:0; font-size: 16px;">${esc(c.meta.name)}</h3>
                    <div style="margin-top: 15px; display: flex; justify-content: space-between; align-items: center;">
                        <span class="pill tiny soft">${esc(c.meta.status)}</span>
                        <span style="font-size: 10px; opacity: 0.5;">Open Project ➔</span>
                    </div>
                </div>
            `).join('') : `
                <div style="grid-column: 1/-1; padding: 100px; text-align: center; opacity: 0.5;">
                    <div style="font-size: 40px; margin-bottom: 20px;">📂</div>
                    <h3>No clients assigned yet.</h3>
                    <p class="small">Assign clients to this partner in their Profile Settings.</p>
                </div>
            `}
        </div>
    `;
};

OL.partnerCreateClient = function(partnerKey) {
    const name = prompt("Enter Client Name (Family or Business):");
    if (!name) return;

    const clientId = 'c-' + Math.random().toString(36).slice(2, 9);
    
    const newClient = {
        id: clientId,
        meta: {
            name: name,
            status: "Discovery",
            partnerOwner: partnerKey, // 🔒 Mandatory link
            createdDate: new Date().toISOString()
        },
        projectData: {
            localResources: [],
            localApps: [],
            scopingSheets: [{ id: 'sheet-' + uid(), lineItems: [] }],
            localFunctions: [],
            stages: [],
            workflows: [],
            clientTasks: [],
        }
    };

    state.clients[clientId] = newClient;
    
    // 🚀 Auto-Provision Agreement, Naming, Hierarchy, and Compliance
    OL.provisionSphynxTemplates(clientId);

    OL.persist().then(() => {
        OL.renderPartnerDashboard();
    });
};

// 🤝 THE PARTNER ASSIGNMENT HANDLER
OL.handlePartnerAssignment = function(clientId, partnerKey) {
    const client = state.clients[clientId];
    if (!client) {
        console.error("❌ Assignment Failed: Client ID not found.");
        return;
    }

    // 1. Update the metadata
    client.meta.partnerOwner = partnerKey;

    // 2. Add an activity log entry for history
    if (!client.meta.activityLog) client.meta.activityLog = [];
    client.meta.activityLog.push({
        action: partnerKey ? `Assigned to Partner: ${partnerKey}` : "Set to Internal Project",
        timestamp: new Date().toISOString()
    });

    console.log(`🎯 Client "${client.meta.name}" ownership updated to: ${partnerKey || 'None'}`);

    // 3. Persist and Refresh
    OL.persist().then(() => {
        // If you have a specific modal refresh function, call it here
        if (typeof OL.openClientProfileModal === 'function') {
            OL.openClientProfileModal(clientId);
        } else {
            // Fallback: Refresh the whole route to update UI
            window.handleRoute();
        }
    });
};

window.buildLayout = function () {
  const root = document.getElementById("app-root");
  if (!root) {
      console.error("❌ ERROR: Could not find 'app-root' in your index.html!");
      return; 
  }
  const mainEl = document.getElementById('mainContent');
  if (mainEl && !window.location.hash.includes('visualizer')) {
      mainEl.style.cssText = '';
  }
  const client = getActiveClient();
  const hash = location.hash || "#/";
  const urlParams = new URLSearchParams(window.location.search);
  const isAdmin = window.FORCE_ADMIN === true;
  const isPublic = new URLSearchParams(window.location.search).has("access");
  const isPartnerProject = client && client.meta.status === "Partner";
  const isPartnerMode = isPartnerProject || (client && !!client.meta.partnerOwner);
  
  const token = urlParams.get("access");
    const isMaster = hash.startsWith("#/vault") && !window.IS_GUEST;

  let homeLabel = "Dashboard";
  let homeAction = "";
  let showHome = true;

  if (isAdmin) {
    homeLabel = "Global Registry";
    homeAction = `window.location.hash = '#/'`;
} else if (client && client.meta.status === "Partner") {
    homeLabel = "My Portfolio";
    homeAction = `window.location.hash='#/partner-dashboard'`;
} else if (client && client.meta.partnerOwner) {
    if (!window.IS_GUEST) {
        homeLabel = "Partner Home";
        homeAction = `window.location.hash='#/partner-dashboard'`;
    } else {
        homeLabel = "My Portfolio";
        homeAction = `state.activeClientId=null; sessionStorage.removeItem('lastActiveClientId'); window.location.hash='#/partner-dashboard'; window.handleRoute();`;
    }
} else if (isPublic) {
    showHome = false;
}
    
  // 1. Dashboard/Non-Context View
  if (!client && !isMaster && !isPublic && !isPartnerMode && !isAdmin) {
        // Only render the Dashboard link if no client context exists
        root.innerHTML = `
            <div class="three-pane-layout zen-mode-active">
                <aside class="sidebar"><nav class="menu"><a href="#/" class="active"><i>🏠</i> <span>Dashboard</span></a></nav></aside>
                <main id="mainContent"></main>
                <aside id="inspector-panel" class="pane-inspector">
                    <div class="sidebar-resizer right-side-handle"></div>
                    <div class="inspector-scroll-content">
                        <div id="inspector-content"></div>
                    </div>
                </aside>
            </div>`;
        return;
    }  

  const effectiveAdminMode = isPublic ? false : state.adminMode;

  if (!root) return; // Safety guard

  const masterTabs = [
  { key: "apps", label: "Master Apps", icon: "layout-grid", href: "#/vault/apps" },
  { key: "functions", label: "Master Functions", icon: "wrench", href: "#/vault/functions" },
  { key: "resources", label: "Master Resources", icon: "database", href: "#/vault/resources" },
  { key: "visualizer", label: "Flow Map", icon: "workflow", href: "#/vault/visualizer" },
  { key: "how-to", label: "Master How-To Guides", icon: "book-open", href: "#/vault/how-to" },
  { key: "checklist", label: "Master Tasks", icon: "clipboard-list", href: "#/vault/tasks" },
  { key: "analyses", label: "Master Analyses", icon: "trending-up", href: "#/vault/analyses" },
  { key: "rates", label: "Scoping Rates", icon: "circle-dollar-sign", href: "#/vault/rates" },
  { key: "data", label: "Master Data Tags", icon: "tag", href: "#/vault/data" },
];

const clientTabs = [
  { key: "checklist", label: "Tasks", icon: "clipboard-list", href: "#/client-tasks" },
  { key: "apps", label: "Applications", icon: "layout-grid", href: "#/applications" },
  { key: "functions", label: "Functions", icon: "wrench", href: "#/functions" },
  { key: "resources", label: "Project Resources", icon: "database", href: "#/resources" },
  { key: "visualizer", label: "Flow Map", icon: "workflow", href: "#/visualizer" },
  { key: "scoping", label: "Scoping & Pricing", icon: "bar-chart-2", href: "#/scoping-sheet" },
  { key: "analysis", label: "Weighted Analysis", icon: "trending-up", href: "#/analyze" },
  { key: "how-to", label: "How-To Library", icon: "book-open", href: "#/how-to" },
  { key: "team", label: "Team Members", icon: "users", href: "#/team" },
  { key: "data", label: "Data Tags", icon: "tag", href: "#/data" },
];

const isLightMode = document.body.classList.contains('light-mode');
const themeIcon = isLightMode ? "moon" : "sun";
const themeLabel = isLightMode ? "Dark Mode" : "Light Mode";

    const themeSection = `
        <div class="theme-toggle-zone">
            <button class="btn soft tiny" onclick="OL.toggleTheme()" title="${themeLabel}">
                <i data-lucide="${themeIcon}" style="width:16px;height:16px;"></i>
                <span class="theme-label">${themeLabel}</span>
            </button>
        </div>
    `;

    const isSidebarCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';
    const toggleArrow = isSidebarCollapsed ? '▶' : '◀'; // Flip based on state

    const sidebarContent = `
        <button class="sidebar-toggle" onclick="OL.toggleSidebar()" title="Toggle Menu">
            <span class="toggle-icon">${toggleArrow}</span>
        </button>       

        <div class="sidebar-inner-content" style="${isSidebarCollapsed ? 'display:none;' : ''}">
            <div class="sidebar-padding" style="padding: 10px;">
                ${showHome ? `
                    <div class="admin-nav-zone">
                        <nav class="menu">
                            <a href="javascript:void(0)" 
                                onclick="${homeAction}" 
                                class="${(hash === '#/' || hash === '#/partner-dashboard') ? 'active' : ''}"
                                style="${isAdmin ? 'border-left: 3px solid var(--accent);' : 'background: rgba(var(--accent-rgb), 0.1); font-weight: bold;'}">
                                <i data-lucide="home" style="width:16px;height:16px;"></i> 
                                <span>${homeLabel.toUpperCase()}</span>

                            </a>
                        </nav>
                    </div>
                    <div class="divider"></div>
                ` : ''}

                ${client ? `
                    <div class="client-nav-zone">
                        </div>
                ` : ''}
            </div>
        </div>

        ${isMaster ? `
            <div class="client-nav-zone admin-workspace">
                <div class="menu-category-label">Global Administration</div>
              
                <nav class="menu">
                    ${masterTabs.map(item => `
                        <a href="${item.href}" class="${hash === item.href ? 'active' : ''}">
                            <i data-lucide="${item.icon}" style="width:16px;height:16px;flex-shrink:0;"></i>
                            <span class="menu-item">${item.label}</span>
                        </a>
                    `).join('')}
                </nav>
                <div style="padding:8px 8px 4px;display:flex;flex-direction:column;gap:4px;">
                    <button class="btn tiny soft" style="width:100%;justify-content:flex-start;gap:6px;"
                            onclick="OL.exportMasterBackup()">
                        ${OL.getLucideSVG('download',12,'currentColor')} Export Backup
                    </button>
                    <label class="btn tiny soft" style="width:100%;justify-content:flex-start;gap:6px;cursor:pointer;">
                        ${OL.getLucideSVG('upload',12,'currentColor')} Import Backup
                        <input type="file" accept=".json" style="display:none;"
                               onchange="OL.importMasterBackup(event)">
                    </label>
                </div>
            </div>
        ` : client ? `
            <div class="client-nav-zone">
                <div class="menu-category-label">Project Workspace</div>
                <div class="client-profile-trigger" 
                    ${!isPublic ? `onclick="OL.openClientProfileModal('${client.id}')" style="cursor:pointer;"` : `style="cursor:default;"`}>
                    <div class="client-avatar">${esc(client.meta.name.substring(0,2).toUpperCase())}</div>
                    <div class="client-info">
                        <div class="client-name">${esc(client.meta.name)}</div>
                        <div class="client-meta">${!isPublic ? 'View Profile ⚙️' : 'Project Portal'}</div>
                    </div>
                </div>

                ${isAdmin && isPartnerProject ? `
                    <button class="btn tiny primary" 
                            style="margin: 10px; width: calc(100% - 20px); background: #fbbf24; color: black; font-weight: bold; border: none;"
                            onclick="window.location.hash='#/partner-dashboard'">
                        👁️ VIEW AS PORTFOLIO
                    </button>
                ` : ''}
                ${themeSection}
                <nav class="menu">
                    ${clientTabs.map(item => {
                        const perm = OL.checkPermission(item.key);
                        if (perm === 'none') return '';
                        const isModuleEnabled = effectiveAdminMode || (client.modules && client.modules[item.key] === true);
                        if (!isModuleEnabled) return ''; 
                        const isActive = hash.startsWith(item.href);
                        return `
                            <a href="${item.href}" class="${isActive ? 'active' : ''}">
                                <i data-lucide="${item.icon}" style="width:16px;height:16px;flex-shrink:0;"></i> 
                                <span class="menu-item">${item.label}</span>
                                ${perm === 'view' ? '<i class="lock-icon" title="Read Only">🔒</i>' : ''}
                            </a>
                        `;
                    }).join('')}
                </nav>
            </div>
        ` : `
            <div class="empty-context-hint"><p>Select a Client or enter Global Vault.</p></div>
        `}
  `;

    // 3. 🏗️ HARDENED SHELL LOGIC
    // We check for the .three-pane-layout wrapper. If it's missing, we build the full structure.
    let shell = root.querySelector('.three-pane-layout');
    
    if (!shell) {
        root.innerHTML = `
            <div class="three-pane-layout zen-mode-active">
                <aside class="sidebar"></aside>
                <main id="mainContent"></main>
                <aside id="inspector-panel" class="pane-inspector">
                    <div class="sidebar-resizer right-side-handle"></div>
                    <div class="inspector-scroll-content">
                        <div id="inspector-content"></div>
                    </div>
                </aside>
            </div>
        `;
        shell = root.querySelector('.three-pane-layout');
    }

    // 4. SURGICAL UPDATES
    // Now that the shell is guaranteed to exist, update the dynamic parts
    const sidebar = shell.querySelector('.sidebar');
    if (sidebar) sidebar.innerHTML = sidebarContent;

    // Ensure the mainContent ID is always there for routing
    const main = shell.querySelector('main');
    if (main && main.id !== 'mainContent') main.id = 'mainContent';

    // Ensure Inspector is ready
    const inspector = document.getElementById('inspector-panel');
    if (inspector && !inspector.querySelector('.inspector-scroll-content')) {
        inspector.innerHTML = `<div class="sidebar-resizer right-side-handle"></div><div class="inspector-scroll-content"></div>`;
        OL.initSideResizers();
    }

    // At the bottom of buildLayout(), before the lucide call:
    const layout = document.querySelector('.three-pane-layout');
    if (layout) {
        const isCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';
        const leftCol = isCollapsed ? '65px' : '240px';
        const isVisualizer = window.location.hash.includes('visualizer');
        
        const panel = document.getElementById('v2-inspector-panel') || document.getElementById('inspector-panel');
        const inspectorOpen = isVisualizer && panel && panel.classList.contains('open');
        const rightCol = inspectorOpen ? '380px' : '0px';
        
        layout.style.gridTemplateColumns = `${leftCol} 1fr ${rightCol}`;
    }
    
    if (window.lucide) window.lucide.createIcons();
};

OL.exportMasterBackup = async function() {
    try {
        // Fetch all clients fresh from Firestore so nothing is missed
        const snap = await db.collection('clients').get();
        const clients = [];
        snap.forEach(doc => clients.push({ _id: doc.id, ...doc.data() }));

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
    } catch(e) {
        alert('❌ Export failed: ' + e.message);
        console.error(e);
    }
};

OL.importMasterBackup = async function(event) {
    const file = event.target.files[0];
    if (!file) return;
    event.target.value = '';

    let data;
    try { data = JSON.parse(await file.text()); } catch(e) { alert('Invalid JSON file'); return; }

    // Combined backup format: { _version, master, clients[] }
    const isCombined = data._version === 1 && data.master && Array.isArray(data.clients);

    // Legacy master-only backup: detect by presence of functions/apps at top level
    const masterData = isCombined ? data.master : (() => {
        const d = { ...data };
        if (d.master && !d.rates) { Object.assign(d, d.master); }
        delete d.master;
        return d;
    })();
    const clients = isCombined ? data.clients : [];

    const fnCount     = (masterData.functions || []).length;
    const appCount    = (masterData.apps      || []).length;
    const varCount    = Object.keys(masterData.rates?.variables || {}).length;
    const clientCount = clients.length;
    const exportedAt  = data._exportedAt ? new Date(data._exportedAt).toLocaleString() : 'unknown date';

    if (!confirm(
        `Restore "${file.name}"?\n` +
        (data._exportedAt ? `Exported: ${exportedAt}\n` : '') +
        `\n• ${fnCount} functions\n• ${appCount} apps\n• ${varCount} rate variables` +
        (clientCount ? `\n• ${clientCount} client projects` : '\n• Master library only (no client data)') +
        `\n\nThis will overwrite your current data. Cannot be undone.`
    )) return;

    try {
        // Restore master
        await db.collection('systems').doc('main_state').set(masterData);
        state.master = masterData;

        // Restore clients (if present)
        if (clients.length) {
            const batch = db.batch();
            clients.forEach(c => {
                const { _id, ...clientData } = c;
                batch.set(db.collection('clients').doc(_id), clientData);
            });
            await batch.commit();
            clients.forEach(c => {
                const { _id, ...clientData } = c;
                state.clients[_id] = clientData;
            });
        }

        console.log(`✅ Restored: master + ${clients.length} clients`);
        alert(`✅ Backup restored!\n\n• Master library\n${clients.length ? `• ${clients.length} client projects` : ''}`);
        window.handleRoute();
    } catch(e) {
        alert('❌ Restore failed: ' + e.message);
        console.error(e);
    }
};

window.handleRoute = function () {
    const hash = window.location.hash || "#/";
    const isVisualizer = hash.includes('visualizer');
    
    // 🛡️ ALWAYS RESET INSPECTOR PANEL & GRID WHEN NOT ON VISUALIZER
    if (!isVisualizer) {
        document.body.classList.remove('is-visualizer', 'fs-mode-active');
        
        // 1. Close both Inspector panel IDs
        ['inspector-panel', 'v2-inspector-panel'].forEach(id => {
            const panel = document.getElementById(id);
            if (panel) {
                panel.classList.remove('open');
                panel.style.width = '0px';
                panel.style.minWidth = '0px';
                panel.style.display = 'none';
            }
        });

        // 2. Clear Inspector DOM content
        const inspectorContent = document.getElementById('inspector-content');
        if (inspectorContent) inspectorContent.innerHTML = '';
        if (window.OL?._fv) window.OL._fv._lastInspectorResId = null;

        // 3. Force Grid back to 2 Columns (Sidebar + Main Content Only)
        const layout = document.querySelector('.three-pane-layout');
        if (layout) {
            const sidebarCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';
            const leftCol = sidebarCollapsed ? '65px' : '240px';
            layout.style.gridTemplateColumns = `${leftCol} 1fr 0px`;
        }
    } else {
        document.body.classList.add('is-visualizer');
    }

    // Build sidebar & layout shell
    window.buildLayout();

    const main = document.getElementById("mainContent");
    if (!main) return; 

    const client = getActiveClient();
    const isVault = hash.startsWith('#/vault');
    const ol = window.OL || {};

    // 1. Dashboard Routes
    if (hash === "#/" || hash === "#/clients" || hash.includes("partner-dashboard")) {
        document.body.classList.remove('is-visualizer', 'fs-mode-active');
        renderClientDashboard();
        return;
    }

    // 2. Vault / Master Routes
    if (isVault) {
        if (window.IS_GUEST) {
            window.location.hash = '#/';
            return;
        }
        if (hash.includes("/apps")) renderAppsGrid();
        else if (hash.includes("/functions")) renderFunctionsGrid();
        else if (hash.includes("/resources")) renderResourceManager();
        else if (hash.includes("/visualizer")) {
            state.viewMode = 'graph';
            document.body.classList.add('is-visualizer');
            if (typeof renderVisualizer === 'function') renderVisualizer();
            else if (typeof ol.renderVisualizer === 'function') ol.renderVisualizer();
        }
        else if (hash.includes("/how-to")) {
            if (typeof renderHowToLibrary === 'function') renderHowToLibrary();
            else if (typeof ol.renderHowToLibrary === 'function') ol.renderHowToLibrary();
        }
        else if (hash.includes("/tasks")) renderChecklistModule(true);
        else if (hash.includes("/analyses")) renderAnalysisModule(true);
        else if (hash.includes("/rates")) renderVaultRatesPage();
        else if (hash.includes("/data")) {
            if (typeof ol.renderGlobalDataManager === 'function') ol.renderGlobalDataManager();
        }
        return;
    }

    // 3. Client Project Workspace Routes
    if (client) {
        if (hash.includes("client-tasks")) renderChecklistModule();
        else if (hash.includes("resources")) renderResourceManager();
        else if (hash.includes("applications")) renderAppsGrid();
        else if (hash.includes("functions")) renderFunctionsGrid();
        else if (hash.includes("visualizer")) {
            state.viewMode = 'graph';
            document.body.classList.add('is-visualizer');
            if (typeof renderVisualizer === 'function') renderVisualizer();
            else if (typeof ol.renderVisualizer === 'function') ol.renderVisualizer();
        }
        else if (hash.includes("scoping-sheet") || hash.includes("scoping")) {
            if (typeof renderScopingSheet === 'function') renderScopingSheet();
            else if (typeof ol.renderScopingSheet === 'function') ol.renderScopingSheet();
        }
        else if (hash.includes("analyze")) renderAnalysisModule();
        else if (hash.includes("how-to")) {
            if (typeof renderHowToLibrary === 'function') renderHowToLibrary();
            else if (typeof ol.renderHowToLibrary === 'function') ol.renderHowToLibrary();
        }
        else if (hash.includes("team")) renderTeamManager();
        else if (hash.includes("data")) {
            if (typeof ol.renderGlobalDataManager === 'function') ol.renderGlobalDataManager();
        }
    } else {
        renderClientDashboard();
    }
};

window.addEventListener("hashchange", handleRoute);

// 4b. HANDLE GLOBAL SEARCH BAR
OL.handleGlobalSearch = function(query) {
    const resultsEl = document.getElementById("global-search-results");
    if (!resultsEl) return;

    const q = (query || "").toLowerCase().trim();
    const clients = Object.values(state.clients);
    const apps = state.master.apps || [];

    // Filter Logic
    const matchedClients = clients.filter(c => c.meta.name.toLowerCase().includes(q));
    const matchedApps = apps.filter(a => a.name.toLowerCase().includes(q));

    let html = "";

    if (matchedClients.length > 0) {
        html += `<div class="search-category-label">Projects</div>`;
        html += matchedClients.map(c => `
            <div class="search-result-item" onclick="OL.switchClient('${c.id}')">
                <span>📁 ${esc(c.meta.name)}</span>
                <span class="tiny muted">${esc(c.meta.status)}</span>
            </div>
        `).join('');
    }

    if (matchedApps.length > 0) {
        html += `<div class="search-category-label">Master Apps</div>`;
        html += matchedApps.map(a => `
            <div class="search-result-item" onclick="OL.openAppModal('${a.id}')">
                <span>💻 ${esc(a.name)}</span>
                <span class="tiny muted">Master Vault</span>
            </div>
        `).join('');
    }

    if (html === "") {
        html = `<div class="search-result-item muted">No results found for "${esc(query)}"</div>`;
    }

    resultsEl.innerHTML = html;
};

OL.refocus = function(id) {
    requestAnimationFrame(() => {
        const el = document.getElementById(id);
        if (el) {
            el.focus();
            // Move cursor to the end
            const val = el.value;
            el.value = '';
            el.value = val;
        }
    });
};

// 🛡️ UNIVERSAL SEARCH OVERLAY CLOSER
document.addEventListener('mousedown', (e) => {
    // 1. Find every element currently on the screen that acts as an overlay
    const activeOverlays = document.querySelectorAll('.search-results-overlay');

    activeOverlays.forEach(overlay => {
        // 2. Resolve the container (parent with .search-map-container or fallback to parent)
        const container = overlay.closest('.search-map-container') || overlay.parentElement;
        
        // 3. Logic: If the click was NOT inside the overlay 
        // AND NOT inside the container/input that holds it...
        if (!overlay.contains(e.target) && !container.contains(e.target)) {
            overlay.innerHTML = ""; // Wipe the results
        }
    });
});

// ⌨️ GLOBAL ESCAPE-TO-CLOSE LISTENER
document.addEventListener('keydown', (e) => {
    // 1. ESCAPE: Clear overlays
    if (e.key === 'Escape') {
        document.querySelectorAll('.search-results-overlay').forEach(ov => ov.innerHTML = "");
    }

    // 2. ENTER: Save and Refresh
    if (e.key === 'Enter') {
        // 🛡️ THE SHIELD: If we are in the Power Add input, STOP
        if (e.target.id === 'quick-step-input' || document.getElementById('slash-menu')?.style.display === 'block') {
            return; 
        }

        // 🚀 THE FIX: If the user is in a TEXTAREA, allow the default "New Line" behavior
        if (e.target.tagName === 'TEXTAREA') {
            return; // Exit here and let the browser add the line break
        }

        const isInput = e.target.classList.contains('modal-input') || 
                        e.target.classList.contains('header-editable-input') ||
                        e.target.tagName === 'INPUT';
        
        if (isInput) {
            e.target.blur(); 
            console.log("⌨️ Entry saved via Enter");
        }
    }
});

// 4a. REFRESH VIEW
OL.currentRenderer = null;

OL.getCurrentContext = function() {
    const hash = window.location.hash || "#/";
    const isVaultView = hash.startsWith('#/vault') || hash.includes('resource-manager');
    const client = getActiveClient();

    if (isVaultView) {
        return {
            data: state.master || {}, // Fallback to empty object
            isMaster: true,
            namespace: 'res-vlt-',
            label: '🛡️ GLOBAL VAULT'
        };
    }
    
    // 🚀 THE FIX: Ensure projectData actually exists before returning
    if (client && client.projectData) {
        return {
            data: client.projectData,
            isMaster: false,
            namespace: 'local-prj-',
            label: `📁 PROJECT: ${client.meta.name}`
        };
    }

    // Ultimate fallback to prevent "undefined" errors
    return { 
        data: { localResources: [], resources: [] }, 
        isMaster: false, 
        label: '⚠️ NO CONTEXT' 
    };
};

// 🚀 Register current view so modals know what to refresh
OL.registerView = function(renderFn) {
    if (window.isMatrixActive) return;
    // 🛡️ THE LOCK: If the matrix is on screen, we update the logic but ABORT the render
    if (document.querySelector('.matrix-table-container')) {
        OL.currentRenderer = renderFn;
        console.log(`🛡️ View Context Updated Silently (Matrix Active): ${renderFn.name}`);
        return; // 🛑 Stop the process here!
    }

    OL.currentRenderer = renderFn;
    const viewName = renderFn.name || window.location.hash;
    console.log(`📍 View Context Set: ${renderFn.name}`);
};

// 🚀 Dynamic Refresh function to be used in all updateHandlers
OL.refreshActiveView = function() {
    if (typeof OL.currentRenderer === 'function') {
        OL.currentRenderer();
    } else {
        // Fallback to your hash-based logic if no renderer is registered
        const context = OL.getCurrentContext();
        console.warn("Reverting to hash-based refresh for context:", context.label);
        // ... (your existing if/else hash logic)
    }
};

// 5. MODAL ENGINE
let activeOnClose = null;

window.openModal = function (contentHTML) {
  const layer = document.getElementById("modal-layer");
  if (!layer) return;

  layer.innerHTML = `
      <div id="modal-overlay" class="modal-overlay">
          <div class="modal-box modal-content" id="active-modal-box" onclick="event.stopPropagation()">
              ${contentHTML}
          </div>
      </div>
  `;
  layer.style.display = "flex";

  // 🎯 ENSURE THIS CALLS OL.closeModal() specifically
  const overlay = document.getElementById("modal-overlay");
  overlay.onclick = () => {
      if (typeof OL.closeModal === 'function') OL.closeModal();
      else {
          layer.style.display = "none";
          layer.innerHTML = "";
      }
  };
};

OL.handlePillInteraction = function(event, appId, fnId) {
    if (event) {
        event.preventDefault(); // Prevents standard context menu
        event.stopPropagation();
    }

    // 1. REMOVE LOGIC: Cmd/Ctrl + Click
    if (event.metaKey || event.ctrlKey) {
        OL.toggleAppFunction(appId, fnId, { button: 2, stopPropagation: () => {} });
        return;
    }

    // 2. CYCLE LOGIC: Right Click
    if (event.button === 2) {
        OL.toggleAppFunction(appId, fnId, { button: 0, stopPropagation: () => {} });
        return;
    }

    // 3. JUMP LOGIC: Standard Left Click
    // 🚀 THE FIX: Check the current modal's title OR the URL hash to decide where to jump
    const modalTitle = document.querySelector('.modal-title-text')?.textContent || "";
    const hash = window.location.hash;

    // If we are in the Functions grid OR a Function Modal, jump to the App
    if (hash.includes('functions') || modalTitle.includes('Function') || modalTitle.includes('Function')) {
        OL.openAppModal(appId);
    } 
    // Otherwise (Apps grid or App Modal), jump to the Function
    else {
        OL.openFunctionModal(fnId);
    }
};

//======================= CLIENT DASHBOARD SECTION =======================//

// 1. CLIENT DASHBOARD & CORE MODULES
window.renderClientDashboard = function() {
    const container = document.getElementById("mainContent");
    if (!container) return;
    container.style.cssText = '';
    document.body.classList.remove('is-visualizer');

    const activeView = state.dashboardView || localStorage.getItem('ol_dashboard_view') || 'cards';
    state.dashboardView = activeView; // keep state in sync
    
    // 🚀 FILTER LOGIC
    const activeFilter = state.dashboardFilter || 'All';
    let clients = state.clients ? Object.values(state.clients) : [];
    
    // Apply Status Filter
    if (activeFilter !== 'All') {
        clients = clients.filter(c => c.meta.status === activeFilter);
    }
    
    // 🛡️ THE LOADING GUARD
    // If we have no clients AND we haven't confirmed the cloud is empty, show loading
    if (!state.clients || Object.keys(state.clients).length === 0) {
        if (getActiveClient()) {
            // Proceed to render...
        }
        else {
            container.innerHTML = `
                <div>
                    <div class="spinner">⏳</div>
                    <h3 class="muted">Connecting to Registry...</h3>
                </div>`;
            return;
        }
    }

    container.innerHTML = `
        <div class="section-header search-header">
            <div>
                <h2>Registry & Command</h2>
                <div class="small muted">Quick access to projects and master systems</div>
            </div>
              
            <div class="search-map-container">
                <input type="text" id="global-command-search" class="modal-input" 
                       placeholder="Search clients or apps..." 
                       oninput="OL.handleGlobalSearch(this.value)">
                <div id="global-search-results" class="search-results-overlay"></div>
            </div>

            <div class="header-actions"">
                <button class="btn primary" onclick="OL.onboardNewClient()">+ Add Client</button>
                <button class="btn small warn" onclick="OL.pushFeaturesToAllClients()" title="Sync System Changes">⚙️ Migration</button>
                <button class="btn small soft" onclick="state.dashboardView = state.dashboardView === 'list' ? 'cards' : 'list'; 
                         localStorage.setItem('ol_dashboard_view', state.dashboardView); 
                         renderClientDashboard();"
                        style="display:flex;align-items:center;gap:6px;">
                    <i data-lucide="${activeView === 'list' ? 'layout-grid' : 'list'}" style="width:14px;height:14px;"></i>
                    ${activeView === 'list' ? 'Card View' : 'List View'}
                </button>
            </div>
        </div>

        <div class="filter-bar">
            ${['All', 'Discovery', 'White Glove', 'Coaching', 'Ongoing Maintenance', 'Ad Hoc Maintenance', 'Former Client', 'Former Prospect', 'Partner'].map(f => `
                <span class="pill tiny ${activeFilter === f ? 'accent' : 'soft'}" 
                      style="border: 1px solid ${activeFilter === f ? 'var(--accent)' : 'transparent'}; padding: 4px 12px; border-radius: 20px;"
                      onclick="OL.setDashboardFilter('${f}')">
                    ${f}
                </span>
            `).join('')}
        </div>

        ${activeView === 'list' ? `
        <div style="display:flex;flex-direction:column;gap:2px;margin-top:10px;">
    
            <!-- Vault Row -->
            <div class="fv-list-item" style="background:var(--panel-soft);border:1px solid var(--panel-border);border-radius:8px;
                        padding:10px 16px;cursor:pointer;margin-bottom:4px;
                        border-left:3px solid var(--accent);"
                 onclick="location.hash='#/vault/apps'">
                <span style="font-size:13px;font-weight:700;color:var(--accent);">🏛️ Master Vault</span>
            </div>
            ${clients.map(client => {
                const tasks = (client.projectData?.clientTasks || []);
                const openTasks = tasks.filter(t => t.status !== 'Done');
                const doneTasks = tasks.filter(t => t.status === 'Done');
                const isExpanded = state.dashboardExpanded?.[client.id] !== false;
            
                return `
                    <div style="margin-bottom:4px;">
                        <div style="display:flex;align-items:center;gap:10px;padding:10px 16px;
                                    background:var(--panel-soft);border:1px solid var(--panel-border);
                                    border-radius:8px;cursor:pointer;transition:border-color 0.2s;"
                             onclick="OL.switchClient('${client.id}')"
                             onmouseover="this.style.borderColor='var(--accent)'"
                             onmouseout="this.style.borderColor='var(--panel-border)'">
                            <div style="width:28px;height:28px;border-radius:6px;background:var(--accent);
                                        color:#000;display:flex;align-items:center;justify-content:center;
                                        font-weight:900;font-size:11px;flex-shrink:0;">
                                ${esc(client.meta.name.substring(0,2).toUpperCase())}
                            </div>
                            <div style="flex:1;min-width:0;">
                                <div style="font-weight:700;font-size:13px;color:var(--text-main);">
                                    ${esc(client.meta.name)}
                                </div>
                                <div style="font-size:10px;color:var(--text-dim);">
                                    ${openTasks.length} open · ${doneTasks.length} done
                                </div>
                            </div>
                            <span style="font-size:10px;color:var(--text-dim);">${esc(client.meta.status)}</span>
                            ${openTasks.length ? `
                                <span onclick="event.stopPropagation();
                                              if(!state.dashboardExpanded) state.dashboardExpanded={};
                                              state.dashboardExpanded['${client.id}'] = !${isExpanded};
                                              renderClientDashboard();"
                                      style="width:20px;height:20px;border-radius:4px;
                                             background:var(--panel-soft);border:1px solid var(--panel-border);
                                             display:flex;align-items:center;justify-content:center;
                                             font-size:11px;font-weight:700;color:var(--text-dim);cursor:pointer;">
                                    ${isExpanded ? '−' : '+'}
                                </span>
                            ` : ''}
                        </div>
            
                        ${isExpanded && openTasks.length ? `
                            <div style="padding-left:44px;margin-top:2px;display:flex;flex-direction:column;gap:2px;">
                                ${openTasks.map(task => {
                                    const statusColors = {
                                        'Pending':     '#94a3b8',
                                        'In Progress': '#3b82f6',
                                        'Blocked':     '#ef4444',
                                        'Done':        '#22c55e'
                                    };
                                    const color = statusColors[task.status || 'Pending'];
                                    return `
                                        <div style="display:flex;align-items:center;gap:8px;
                                                    padding:7px 12px;
                                                    background:var(--panel-dark);
                                                    border:1px solid var(--panel-border);
                                                    border-radius:6px;cursor:pointer;transition:border-color 0.2s;"
                                             onclick="OL.switchClient('${client.id}');
                                                      setTimeout(()=>OL.openTaskModal('${task.id}', false), 200);"
                                             onmouseover="this.style.borderColor='var(--accent)'"
                                             onmouseout="this.style.borderColor='var(--panel-border)'">
                                            <div style="width:8px;height:8px;border-radius:50%;
                                                        background:${color};flex-shrink:0;"></div>
                                            <span style="font-size:11px;color:var(--text-main);flex:1;">
                                                ${esc(task.name || task.title)}
                                            </span>
                                            ${task.dueDate ? `
                                                <span style="font-size:10px;color:var(--text-dim);font-family:monospace;">
                                                    ${new Date(task.dueDate).toLocaleDateString([],{month:'short',day:'numeric'})}
                                                </span>
                                            ` : ''}
                                        </div>
                                    `;
                                }).join('')}
                            </div>
                        ` : ''}
                    </div>
                `;
            }).join('')}
            </div>
        ` : `
            <div class="cards-grid">

            ${clients.map(client => {
                // Get 3 most recent tasks for the hover preview
                const recentTasks = (client.projectData?.clientTasks || []).slice(-3).reverse();

                return `
                <div class="card client-card is-clickable" onclick="OL.switchClient('${client.id}')">
                    <div class="card-header">
                        <div class="card-title" 
                             contenteditable="true" 
                             spellcheck="false"
                             style="outline: none; border-bottom: 1px dashed transparent; transition: border 0.2s;"
                             onfocus="this.style.borderBottom='1px dashed var(--accent)'"
                             onclick="event.stopPropagation()"
                             onblur="this.style.borderBottom='1px dashed transparent'; OL.updateClientNameInline('${client.id}', this.innerText)"
                             onkeydown="if(event.key === 'Enter') { event.preventDefault(); this.blur(); }">
                             ${esc(client.meta.name)}
                        </div>
                        <select class="status-pill-dropdown" 
                                onclick="event.stopPropagation()" 
                                onchange="OL.updateClientStatus('${client.id}', this.value)"
                                style="background: var(--bg-card); color: var(--text-muted); border: 1px solid rgba(255,255,255,0.1); border-radius: 4px; font-size: 10px; cursor: pointer; outline: none;">
                            ${['Discovery', 'White Glove', 'Coaching', 'Ongoing Maintenance', 'Ad Hoc Maintenance', 'Former Client', 'Former Prospect', 'Partner'].map(status => `
                                <option value="${status}" ${client.meta.status === status ? 'selected' : ''}>${status}</option>
                            `).join('')}
                        </select>
                    </div>
                    <div class="card-body">
                        <div class="hover-preview-zone" style="position:relative; display:inline-block;">
                            <div class="small muted">Onboarded: ${client.meta.onboarded}</div>
                            <div class="task-preview-tooltip">
                                <div class="bold tiny accent" style="margin-bottom:5px; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:3px;">Open Tasks</div>
                                ${recentTasks.length ? recentTasks.map(t => `<div class="tiny muted" style="margin-bottom:2px;">• ${esc(t.name)}</div>`).join('') : '<div class="tiny muted">No recent tasks</div>'}
                            </div>
                        </div>

                        <div class="card-footer-actions" style="margin-top:20px;">
                            <button class="btn small soft flex-1">Enter Project</button>
                            <button class="btn tiny soft" style="margin-left:8px;"
                                    onclick="event.stopPropagation(); OL.openClientProfileModal('${client.id}')">
                                ⚙️
                            </button>
                        </div>
                    </div>
                </div>`;
            }).join('')}
        </div>
        `}
    `;
// 🚀 Backfill full data for meta-only clients
    setTimeout(() => {
        const metaOnlyClients = Object.values(state.clients).filter(c => c._metaOnly);
        if (metaOnlyClients.length > 0) {
            console.log(`📥 Backfilling ${metaOnlyClients.length} clients...`);
            Promise.all(metaOnlyClients.map(c => OL.loadFullClient(c.id)))
                .then(() => {
                    console.log('✅ All clients loaded');
                    renderClientDashboard();
                });
        }
    }, 100);
};

// 2. CREATE CLIENT INCLUDING PROFILE ID FOR PUBLIC LINK
OL.onboardNewClient = function () {
  const name = prompt("Enter Client Name:");
  if (!name) return;
  const clientId = "c-" + Date.now();
  state.clients[clientId] = {
    id: clientId,
    publicToken: "access_" + Math.random().toString(36).slice(2, 12), // NEW: Access Token
    meta: {
      name,
      onboarded: new Date().toLocaleDateString(),
      status: "Discovery",
    },
    modules: {
        checklist: true,      // Usually on by default
        apps: false,
        functions: false,
        resources: false,
        scoping: false,
        analysis: false,
        "how-to": false,
        team: false
    },
    permissions: {
      apps: "full",
      functions: "full",
      resources: "full",
      scoping: "full",
      checklist: "full",
      team: "full",
      "how-to": "full",
      analysis: "full"
    },
    projectData: {
      localApps: [],
      localFunctions: [],
      localAnalyses: [],
      localResources: [],
      localHowTo: [],
      scopingSheets: [{ id: "initial", lineItems: [] }],
      clientTasks: [],
      teamMembers: [],
      stages: [],
      workflows: [],
    },
    sharedMasterIds: [],
  };
  OL.provisionSphynxTemplates(clientId);
  state.activeClientId = clientId;
  OL.persist();
  location.hash = "#/client-tasks";
};

OL.provisionSphynxTemplates = function(clientId) {
    const client = state.clients[clientId];
    if (!client) return;

    if (!client.projectData.localResources) client.projectData.localResources = [];
    const currentResources = client.projectData.localResources;

    // 🏛️ System Level
    const systemTemplates = [
        { name: "Sphynx Client Agreement", type: "Legal", systemPinned: true },
    ];

    if (client.meta.status === 'Ongoing Maintenance') {
        systemTemplates.push({ name: "Maintenance Time Tracker and Zapier Error Log", type: "Admin", systemPinned: true });
    }

    // 📂 Admin Level
    const adminTemplates = [
        { name: "Folder Hierarchy", type: "Admin", adminPinned: true },
        { name: "Naming Conventions", type: "Admin", adminPinned: true,
          isContainer: true,
            tree: [
                { 
                    id: "root-clients", 
                    name: "Clients", 
                    children: [
                        { 
                            id: "naming-bridge", 
                            name: "{folderNamingConventions}", 
                            children: [
                                { id: "tax-" + Date.now(), name: "Tax", children: [] },
                                { id: "estate-" + Date.now(), name: "Estate", children: [] },
                                { id: "ins-" + Date.now(), name: "Insurance", children: [] }
                            ] 
                        }
                    ] 
                }
            ]
        },
        { name: "Compliance Documents", type: "Compliance", adminPinned: true, 
          isContainer: true, // 🚀 Custom flag for specific UI
          files: [
              { name: "ADV", url: "", id: uid() },
              { name: "CRS", url: "", id: uid() },
              { name: "Privacy Policy", url: "", id: uid() }
          ] 
        }
    ];

    const allToProvision = [...systemTemplates, ...adminTemplates];

    allToProvision.forEach(temp => {
        const exists = currentResources.some(r => r.name === temp.name);
        if (!exists) {
            currentResources.push({
                ...temp,
                id: 'sys-' + uid(),
                isLocked: true,
                description: "Standard Sphynx Asset.",
                createdDate: new Date().toISOString(),
                steps: [],
                data: {}
            });
        }
    });
};

//=======BUILD CLIENT PROFILE SETTINGS / LINK / DELETE PROFILE ===========//

OL.getDynamicPartners = function() {
    return Object.values(state.clients)
        .filter(c => c.meta.status === "Partner")
        .map(c => ({
            id: c.id,
            name: c.meta.name,
            logo: "🤝"
        }));
};

OL.openClientProfileModal = function(clientId) {
    const client = state.clients[clientId];
    if (!client) return;

    const dynamicPartners = OL.getDynamicPartners();
    const currentPartnerId = client.meta.partnerOwner || "";

    const partnerDropdownHtml = `
        <div class="card-section" style="margin-top: 20px; padding: 15px; background: rgba(var(--accent-rgb), 0.05); border: 1px solid var(--accent); border-radius: 8px;">
            <label class="modal-section-label" style="color: var(--accent);">🤝 LINK TO PARTNER PORTAL</label>
            <div style="margin-top: 10px;">
                <select class="modal-input tiny" 
                        style="width: 100%; cursor: pointer;"
                        onchange="OL.handlePartnerAssignment('${client.id}', this.value)">
                    <option value="">-- No Partner (Direct Sphynx Client) --</option>
                    ${dynamicPartners.map(p => `
                        <option value="${p.id}" ${currentPartnerId === p.id ? 'selected' : ''}>
                            ${p.logo} ${esc(p.name)}
                        </option>
                    `).join('')}
                </select>
                <p class="tiny muted" style="margin-top: 8px;">
                    ${currentPartnerId ? `This project is managed under the <b>${state.clients[currentPartnerId]?.meta.name}</b> portfolio.` : 'This is a standalone project.'}
                </p>
            </div>
        </div>
    `;

    const html = `
        <div class="modal-head">
            <div class="modal-title-text">Client Profile: ${esc(client.meta.name)}</div>
            <div class="spacer"></div>
            <button class="btn small soft" onclick="OL.closeModal()">Close</button>
        </div>
        <div class="modal-body">
            ${partnerDropdownHtml}
            <label class="modal-section-label">Active Modules (Client Access)</label>
            <div id="module-selection" class="card-section">
                ${[
                    { id: 'checklist', label: 'Tasks' },
                    { id: 'apps', label: 'Apps' },
                    { id: 'functions', label: 'Functions' },
                    { id: 'resources', label: 'Resources' },
                    { id: 'visualizer', label: 'Flow Map' },
                    { id: 'scoping', label: 'Scoping' },
                    { id: 'analysis', label: 'Analysis' },
                    { id: 'how-to', label: 'How-To' },
                    { id: 'team', label: 'Team' },
                    { id: 'data', label: 'Data' }
                ].map(m => `
                    <label style="display:flex; align-items:center; gap:8px; font-size:11px; cursor:pointer;">
                        <input type="checkbox" 
                            ${client.modules?.[m.id] ? 'checked' : ''} 
                            onchange="OL.toggleClientModule('${clientId}', '${m.id}')">
                        ${m.label}
                    </label>
                `).join('')}
            </div>
            
            <label class="modal-section-label">Project Metadata</label>
            <div class="card-section">
                <div class="small">Status: <strong>${client.meta.status}</strong></div>
                <div class="small">Onboarded: ${client.meta.onboarded}</div>
            </div>

            <label class="modal-section-label">External Sharing</label>
            <div class="card-section">
                <p class="tiny muted">Share this link with the client for read-only access to their tasks.</p>
                <div style="display:flex; gap:8px; margin-top:8px;">
                    <input type="text" class="modal-input small" readonly 
                          value="${window.location.origin}${window.location.pathname}?access=${client.publicToken}#/client-tasks">
                    <button class="btn tiny primary" onclick="OL.copyShareLink('${client.publicToken}')">Copy</button>
                </div>
            </div>

            <label class="modal-section-label">Danger Zone</label>
            <div class="card-section">
                <p class="tiny muted" style="margin-bottom: 12px; padding-left: 8px;">Permanently delete this client and all associated project data. This cannot be undone.</p>
                <button class="btn small" 
                        style="background: #ef4444; color: white; width: 100%;" 
                        onclick="OL.deleteClient('${clientId}')">
                    Delete Project
                </button>
            </div>
        </div>
    `;
    openModal(html);
};

OL.toggleClientModule = function(clientId, moduleId) {
    OL.updateAndSync(() => {
        const client = state.clients[clientId];
        if (!client.modules) client.modules = {};
        client.modules[moduleId] = !client.modules[moduleId];
    });
};

OL.copyShareLink = function(token) {
    const url = `${window.location.origin}${window.location.pathname}?access=${token}#/client-tasks`;
    navigator.clipboard.writeText(url);
    alert("Share link copied to clipboard!");
};

OL.setDashboardFilter = function(filterName) {
    state.dashboardFilter = filterName;
    // We don't necessarily need to persist this to Firebase (local session is fine)
    window.renderClientDashboard();
};

OL.updateClientStatus = function(clientId, newStatus) {
    const client = state.clients[clientId];
    if (!client) return;

    client.meta.status = newStatus;
    
    OL.provisionSphynxTemplates(clientId);
    OL.persist().then(() => {
        window.handleRoute();
    });
    
    console.log(`📡 Status updated for ${client.meta.name}: ${newStatus}`);
    
    // The sync engine will automatically refresh the UI across all tabs
};

OL.updateClientNameInline = function(clientId, newName) {
    const client = state.clients[clientId];
    if (!client) return;
    
    const cleanName = newName.trim();
    if (!cleanName || cleanName === client.meta.name) return;

    // Update the local state
    client.meta.name = cleanName;

    // Persist to Firebase
    OL.persist();
    
    console.log(`✅ Client renamed to: ${cleanName}`);
    
    // Note: buildLayout() will be triggered by your OL.sync engine 
    // when the Firestore write completes.
};

OL.deleteClient = function(clientId) {
    const client = state.clients[clientId];
    if (!client) return;

    // 1. Confirmation Guard
    const confirmName = prompt(`Type "${client.meta.name}" to confirm deletion of this project:`);
    if (confirmName !== client.meta.name) {
        alert("Deletion cancelled. Name did not match.");
        return;
    }

    // 2. Remove from state
    delete state.clients[clientId];

    // 3. Clear active client if we just deleted the one we were viewing
    if (state.activeClientId === clientId) {
        state.activeClientId = null;
    }

    // 4. Save and redirect
    OL.persist();
    OL.closeModal();
    window.location.hash = "#/"; // Return to registry
    handleRoute(); 
};

// 4. SET PERMISSIONS OR PUSH FEATURES TO CLIENT
OL.setAllPermissions = function(clientId, level) {
    const client = state.clients[clientId];
    if (!client) return;

    // Update every permission key to the new level
    Object.keys(client.permissions).forEach(key => {
        client.permissions[key] = level;
    });

    OL.persist();
    OL.closeModal();
    handleRoute(); // Refresh the sidebar and view immediately
};

OL.pushFeaturesToAllClients = function() {
    const clientIds = Object.keys(state.clients);
    clientIds.forEach(id => {
        const client = state.clients[id];
        
        // 1. If modules don't exist at all, create the default object
        if (!client.modules) {
            client.modules = { 
                checklist: true, apps: true, functions: true, resources: true, 
                visualizer: false, // New module defaults to OFF
                scoping: true, analysis: true, "how-to": true, team: true 
            };
        } else {
            // 2. Fix naming migration if 'tasks' was used instead of 'checklist'
            if (client.modules.tasks !== undefined) {
                client.modules.checklist = client.modules.tasks;
                delete client.modules.tasks;
            }

            // 3. Ensure the 'visualizer' key exists for the checkbox to work
            if (client.modules.visualizer === undefined) {
                client.modules.visualizer = false;
            }
        }
    });

    OL.persist();
    alert("System Migration Complete. You can now enable 'Flow Map' in individual Client Profiles.");
    location.reload();
};

//======================= APPS GRID SECTION =======================//

// 1. RENDER APPS GRID
window.renderAppsGrid = function() {
    OL.registerView(renderAppsGrid);
    const container = document.getElementById("mainContent");
    const client = getActiveClient(); 
    const hash = window.location.hash;
    const isVaultMode = hash.startsWith('#/vault');

    if (!container) return;
    container.style.cssText = '';
    document.body.classList.remove('is-visualizer');

    const masterApps = state.master.apps || [];
    const localApps = client ? (client.projectData.localApps || []) : [];

    let displayApps = isVaultMode ? masterApps : (client?.projectData?.localApps || []);

    displayApps = displayApps.filter(app => {
        if (isVaultMode) return true; 
        const name = (app.name || "").trim();
        const isZapUtility = name.startsWith("Zapier ") || 
                             ["Webhook", "SubZap", "Zapier Robot"].some(u => name.includes(u));
        if (name === "Zapier") return true;
        return !isZapUtility;
    });
    
    displayApps.sort((a, b) => a.name.localeCompare(b.name));

    container.innerHTML = `
      <div class="section-header" style="display:flex; align-items:center; gap:12px;">
          <i data-lucide="layout-grid" style="width:28px; height:24px; color:var(--accent);"></i>
          <div style="flex:1;">
              <h2 style="margin:0;">${isVaultMode ? 'Master App Vault' : 'Project Applications'}</h2>
              <div class="small muted subheader">${isVaultMode ? 'Global Standard Library' : `Software stack for ${esc(client.meta.name)}`}</div>
          </div>
          <div class="header-actions">
              ${isVaultMode ? `
                  <button class="btn primary" onclick="OL.createMasterAppFromGrid()">
                    <i data-lucide="plus" style="width:14px; height:14px; margin-right:6px;"></i> Create Master App
                  </button>
              ` : `
                  <button class="btn small soft" onclick="OL.promptAddApp('${client.id}')">
                    <i data-lucide="plus" style="width:14px; height:14px; margin-right:6px;"></i> Local App
                  </button>
                  <button class="btn primary" onclick="OL.openVaultDeploymentModal('${client.id}')">
                    <i data-lucide="download-cloud" style="width:14px; height:14px; margin-right:6px;"></i> Import from Master
                  </button>
              `}
              ${OL.viewToggleBtn('apps', 'renderAppsGrid')}
          </div>
      </div>
      ${renderStatusLegendHTML()}

        ${OL.getViewMode('apps') === 'list' ? `
            <div style="display:flex;flex-direction:column;gap:2px;margin-top:10px;">
                ${displayApps.map(app => `
                    <div style="display:flex;align-items:center;gap:12px;padding:10px 16px;
                                background:var(--panel-soft);border:1px solid var(--panel-border);
                                border-radius:8px;cursor:pointer;transition:border-color 0.2s;"
                         onclick="OL.openAppModal('${app.id}')"
                         onmouseover="this.style.borderColor='var(--accent)'"
                         onmouseout="this.style.borderColor='var(--panel-border)'">
                        <i data-lucide="smartphone" style="width:14px;height:14px;color:var(--accent);flex-shrink:0;"></i>
                        <span style="font-weight:600;font-size:13px;flex:1;">${esc(app.name)}</span>
                        <span class="vault-tag" style="font-size:8px;">${app.masterRefId ? 'MASTER' : 'LOCAL'}</span>
                        <div class="pills-row" style="margin:0;gap:4px;">
                            ${(app.functionIds||[]).slice(0,3).map(m => {
                                const fn = [...(state.master.functions||[]),...(client?.projectData?.localFunctions||[])].find(f=>f.id===(m.id||m));
                                return fn ? `<span class="pill tiny status-${m.status||'available'}">${esc(fn.name)}</span>` : '';
                            }).join('')}
                        </div>
                        <button class="card-delete-btn" style="position:static;" onclick="OL.universalDelete('${app.id}','apps',event)">
                            <i data-lucide="x" style="width:12px;height:12px;"></i>
                        </button>
                    </div>
                `).join('')}
            </div>
        ` : `
      <div class="cards-grid">
          ${displayApps.length > 0 ? displayApps.map(app => {
              const isMasterRef = !!app.masterRefId || String(app.id).startsWith('master-');
              const tagLabel = isMasterRef ? 'MASTER' : 'LOCAL';
              const tagColor = isMasterRef ? 'var(--accent)' : 'var(--panel-border)';
              
              let mappings = (app.functionIds || []).map(m => 
                  typeof m === 'string' ? { id: m, status: 'available' } : m
              );
              
              const rank = { 'primary': 2, 'evaluating': 1, 'available': 0 };
              mappings.sort((a, b) => (rank[b.status] || 0) - (rank[a.status] || 0));
                
              return `
                  <div class="card is-clickable" onclick="OL.openAppModal('${app.id}')">
                      <div class="card-header">
                          <div style="display:flex; align-items:center; gap:10px;">
                             <i data-lucide="smartphone" style="width:16px; height:16px; color:var(--accent);"></i>
                             <div class="card-title">${esc(app.name)}</div>
                          </div>
                          <div style="display:flex; align-items:center; gap:8px;">
                              <span class="vault-tag" style="background: ${tagColor}; border: 1px solid ${isMasterRef ? 'transparent' : 'var(--line)'}; font-size:8px;">
                                ${tagLabel}
                              </span>    
                              <button class="card-delete-btn" onclick="OL.universalDelete('${app.id}', 'apps', event)">
                                <i data-lucide="x" style="width:12px; height:12px;"></i>
                              </button>
                          </div>
                      </div>
                      <div class="card-body">
                            ${app.name === "Zapier" ? `
                                <div class="zap-utilities-summary" style="margin-bottom: 12px; padding: 8px; background: rgba(var(--accent-rgb), 0.05); border-radius: 4px; border: 1px solid rgba(var(--accent-rgb), 0.2);">
                                    <div class="tiny accent bold uppercase" style="font-size: 8px; letter-spacing: 0.5px; margin-bottom: 5px; display:flex; align-items:center; gap:4px;">
                                        <i data-lucide="cpu" style="width:10px; height:10px;"></i>
                                        ${isVaultMode ? 'Master Utility Templates' : 'Included Utilities'}
                                    </div>
                                    <div style="display: flex; flex-wrap: wrap; gap: 4px;">
                                        ${(isVaultMode ? state.master.apps : (client?.projectData?.localApps || []))
                                            .filter(a => {
                                                const n = (a.name || "").toLowerCase();
                                                const isUtil = n.includes('zapier') && n !== 'zapier';
                                                const isOther = ["webhook", "subzap", "engine"].some(u => n.includes(u));
                                                return isUtil || isOther;
                                            })
                                            .map(u => `<span class="tiny" style="font-size: 9px; background: rgba(255,255,255,0.05); color: var(--text-main); padding: 1px 4px; border-radius: 3px; border: 1px solid rgba(255,255,255,0.1);">${esc(u.name.replace('Zapier ', ''))}</span>`)
                                            .join('')}
                                    </div>
                                </div>
                            ` : ''}
                          <div class="pills-row">
                              ${mappings.map(mapping => {
                                  const targetId = mapping.id || mapping;
                                  const allFunctions = [
                                      ...(state.master.functions || []),
                                      ...(client?.projectData?.localFunctions || [])
                                  ];
                                  const fn = allFunctions.find(f => f.id === targetId);
                                  if (!fn) return '';
                                  
                                  return `
                                      <span class="pill tiny status-${mapping.status || 'available'} is-clickable" 
                                            onclick="OL.handlePillInteraction(event, '${app.id}', '${fn.id}')"
                                            oncontextmenu="OL.handlePillInteraction(event, '${app.id}', '${fn.id}'); return false;">
                                          ${esc(fn.name)}
                                      </span>`;
                              }).join('')}
                          </div>
                      </div>
                  </div>
              `;
          }).join('') : `<div class="empty-hint">No apps deployed. Use the buttons above to get started.</div>`}
      </div>
      `}
    `;

    // 🚀 Refresh Lucide
    if (window.lucide) {
        window.lucide.createIcons();
    }
};

OL.openVaultDeploymentModal = function(clientId) {
    const html = `
        <div class="modal-head">
            <div class="modal-title-text">☁️ Deploy Master App</div>
            <div class="spacer"></div>
            <button class="btn small soft" onclick="OL.closeModal()">Cancel</button>
        </div>
        <div class="modal-body">
            <div class="search-map-container">
                <input type="text" class="modal-input" 
                       placeholder="Click to view library or search apps..." 
                       onfocus="OL.filterMasterAppImport('${clientId}', '')"
                       oninput="OL.filterMasterAppImport('${clientId}', this.value)" 
                       autofocus>
                <div id="master-app-import-results" class="search-results-overlay"></div>
            </div>
        </div>
    `;
    openModal(html);
};

OL.filterMasterAppImport = function(clientId, query) {
    const listEl = document.getElementById("master-app-import-results");
    if (!listEl) return;

    const q = (query || "").toLowerCase().trim();
    const client = state.clients[clientId];
    
    // 🛡️ Filter out apps already in the project
    const existingMasterIds = (client.projectData.localApps || []).map(a => String(a.masterRefId));
    
    const available = (state.master.apps || [])
        .filter(app => !existingMasterIds.includes(String(app.id)) && app.name.toLowerCase().includes(q))
        .sort((a, b) => a.name.localeCompare(b.name));

    listEl.innerHTML = available.map(app => {
        // Resolve the specific icon for this app from the registry
        const iconName = OL.getRegistryIcon(app.type);

        return `
            <div class="search-result-item" style="display:flex; align-items:center; gap:10px;" 
                 onmousedown="OL.pushAppToClient('${app.id}', '${clientId}'); OL.closeModal();">
                <i data-lucide="${iconName}" style="width:14px; height:14px; color:var(--accent); opacity:0.7;"></i>
                <span style="font-size: 13px;">${esc(app.name)}</span>
            </div>
        `;
    }).join('') || `<div class="search-result-item muted">No new apps found.</div>`;

    // 🚀 THE TRIGGER: Since this list updates as you type, 
    // we must tell Lucide to scan the new HTML immediately.
    if (window.lucide) {
        window.lucide.createIcons();
    }
};

// CREATE NEW APP
OL.promptAddApp = function(clientId) {
    const draftId = 'draft-app-' + Date.now();
    const draftApp = {
        id: draftId,
        name: "",
        notes: "",
        functionIds: [],
        capabilities: [],
        isDraft: true,
        originContext: 'project',
        clientId: clientId
    };
    OL.openAppModal(draftId, draftApp);
};

OL.createMasterAppFromGrid = function() {
    const draftId = 'draft-vlt-' + Date.now();
    const draftApp = {
        id: draftId,
        name: "",
        notes: "",
        functionIds: [],
        capabilities: [],
        isDraft: true,
        originContext: 'vault'
    };
    OL.openAppModal(draftId, draftApp);
};

// 🚀 THE FIX: Added 'field' parameter (defaults to 'name' for the header input)
OL.handleAppSave = function(id, value, field = 'name') {
    const cleanValue = value.trim();
    if (!cleanValue && field === 'name') return; 

    const isDraft = id.startsWith('draft-');
    const client = getActiveClient();

    if (isDraft) {
        const isVault = id.includes('-vlt-');
        const newId = (isVault ? 'master-app-' : 'local-app-') + Date.now();
        
        const newApp = {
            id: newId,
            name: field === 'name' ? cleanValue : "New App", 
            category: "", 
            monthlyCost: 0,
            // 🚀 Logic to handle if notes are entered before the name
            notes: field === 'notes' ? cleanValue : "",
            description: "",
            functionIds: [],
            capabilities: [],
            createdDate: new Date().toISOString()
        };

        if (isVault) {
            if (!state.master.apps) state.master.apps = [];
            state.master.apps.push(newApp);
        } else if (client) {
            if (!client.projectData.localApps) client.projectData.localApps = [];
            client.projectData.localApps.push(newApp);
        }

        OL.persist();
        OL.openAppModal(newId);
        OL.refreshActiveView(); 
        
    } else {
        // 🚀 THE CRITICAL CHANGE: Use the dynamic 'field' variable 
        // instead of the hardcoded string 'name'
        OL.updateAppMeta(id, field, cleanValue);
    }
};

OL.updateAppMeta = function(appId, field, value) {
    const client = getActiveClient();
    let app = state.master.apps.find(a => String(a.id) === String(appId));
    
    if (!app && client) {
        app = client.projectData.localApps.find(a => String(a.id) === String(appId));
    }

    if (app) {
        const cleanValue = value.trim();
        
        // 1. Only update if the value actually changed
        if (app[field] === cleanValue) return;

        // 2. Update the data
        app[field] = (field === 'monthlyCost') ? parseFloat(cleanValue) || 0 : cleanValue;
        
        // 3. Persist to Firebase (Silent)
        OL.persist();
        
        // 🚀 THE SURGICAL FIX: 
        // Manually update the card title in the background grid if the name changed.
        // We DO NOT call OL.refreshActiveView() here.
        if (field === 'name') {
            const cardTitles = document.querySelectorAll(`.app-card-title-${appId}`);
            cardTitles.forEach(el => el.innerText = cleanValue);
        }
        
        console.log(`✅ App ${field} updated for: ${app.name}`);
    }
};

// RENDER APPS MODAL
function renderAppModalInnerContent(app, client) {
    const isVaultRoute = window.location.hash.startsWith('#/vault');
    const isLinkedToMaster = !!app.masterRefId;
    const linkedGuides = (state.master.howToLibrary || []).filter(ht => (ht.appIds || []).includes(app.id));

    const isMasterCard = isVaultRoute || app.id.startsWith('master-');
    const showAddButton = !isVaultRoute || (isVaultRoute && app.id.startsWith('master-'));

    const allFunctions = client 
    ? [...(state.master.functions || []), ...(client.projectData.localFunctions || [])]
    : (state.master.functions || []);

    const projectSharedIds = client ? (client.sharedMasterIds || []) : [];
    const projectLocalIds = client ? (client.projectData.localFunctions || []).map(f => String(f.id)) : [];

    const sortedMappings = OL.sortMappings(app.functionIds || []);
    const seenIds = new Set();
    const finalUniqueMappings = sortedMappings.filter(m => {
        const id = String(m.id || m);
        if (client && !isVaultRoute) {
            const isVisibleInProject = projectSharedIds.includes(id) || projectLocalIds.includes(id);
            if (!isVisibleInProject) return false;
        }
        if (seenIds.has(id)) return false;
        seenIds.add(id);
        return true;
    });

    const source = isVaultRoute ? state.master.analyses : (client?.projectData?.localAnalyses || []);

    // 📊 NEW: Find Analyses this app is part of
    const linkedAnalyses = (state.master.analyses || []).filter(anly => 
        (anly.apps || []).some(a => a.id === app.id || a.name === app.name)
    );

    // 💰 TIER RESOLUTION ENGINE
    // 1. Check if the app itself has tiers (Direct Registry Data)
    // 🔍 DIAGNOSTIC LOGGING
    console.group(`🕵️ Modal QA: ${app.name} (${app.id})`);
    console.log("1. Object Passed to Function:", app);
    console.log("2. Is Vault Route?", isVaultRoute);
    console.log("3. App.pricingTiers length:", (app.pricingTiers || []).length);

    // Identify the Registry Entry (Source of Truth)
    const masterRegistryApp = state.master.apps.find(a => 
        String(a.id) === String(app.id) || 
        String(a.id) === String(app.masterRefId) || 
        a.name === app.name
    );
    console.log("4. Found in Master Registry?:", masterRegistryApp ? "✅ Yes" : "❌ No");

    // 🔍 UNIVERSAL SYNC LOOKUP
    const masterAnlyWithApp = (state.master.analyses || []).find(anly => {
        return (anly.apps || []).some(a => {
            const matrixAppId = String(a.appId || "");
            const currentAppId = String(app.id || "");
            const currentRefId = String(app.masterRefId || "");
            const searchName = String(app.name || "").toLowerCase().trim();
            const matrixName = String(a.name || "").toLowerCase().trim();

            // Match if ID matches OR Name matches
            return (matrixAppId.length > 0 && (matrixAppId === currentAppId || matrixAppId === currentRefId)) ||
                   (matrixName.length > 0 && matrixName === searchName);
        });
    });

    // 🎯 TIER RESOLUTION
    let availableTiers = app.pricingTiers || [];
    
    if (availableTiers.length === 0 && masterAnlyWithApp) {
        const matrixApp = masterAnlyWithApp.apps.find(a => 
            String(a.appId) === String(app.id) || 
            String(a.appId) === String(app.masterRefId) ||
            String(a.name || "").toLowerCase().trim() === String(app.name).toLowerCase().trim()
        );
        
        availableTiers = matrixApp?.pricingTiers || [];
        
        // 🚑 AUTO-REPAIR: Save these tiers to the Master App Registry Card
        if (availableTiers.length > 0 && isVaultRoute) {
            app.pricingTiers = JSON.parse(JSON.stringify(availableTiers));
            OL.persist();
        }
    }

    console.log("6. Final Tiers used for Render:", availableTiers);
    console.log("7. Final Source:", source);
    console.groupEnd();

    const externalLinkHtml = `
        <div class="card-section" style="margin-bottom: 20px;">
            <label class="modal-section-label">🌐 APP ACCESS LINK</label>
            <div style="display: flex; gap: 10px; margin-top: 8px;">
                <input type="text" class="modal-input tiny" 
                      style="flex: 1;"
                      placeholder="https://app.slack.com..." 
                      value="${esc(app.loginUrl || '')}" 
                      onblur="OL.updateAppMeta('${app.id}', 'loginUrl', this.value)">
                
                ${app.loginUrl ? `
                    <a href="${app.loginUrl}" target="_blank" class="btn primary tiny" 
                      style="display: flex; align-items: center; gap: 6px; text-decoration: none; background: var(--accent); color: black; font-weight: bold; padding: 0 15px;">
                      🚀 LAUNCH
                    </a>
                ` : `
                    <button class="btn tiny soft" disabled style="opacity: 0.5; cursor: not-allowed;">🚀 LAUNCH</button>
                `}
            </div>
            <div class="tiny muted" style="margin-top: 5px;">Direct link to the application login or dashboard.</div>
        </div>
    `;

    return `
        ${isLinkedToMaster && !isVaultRoute ? `
            <div class="banner info" style="margin-bottom:20px; padding:10px; background:rgba(var(--accent-rgb), 0.05); border: 1px solid var(--accent); border-radius:6px; font-size:11px;">
                💠 This app is linked to the <b>Master Vault</b>. Automation capabilities are synced globally, while notes and categories remain private to this project.
            </div>
        ` : ''}

        ${externalLinkHtml}

        <div class="card-section" style="background: var(--panel-soft); padding: 15px; border-radius: 8px; border: 1px solid var(--line); margin-bottom: 20px;">
            <label class="modal-section-label">${isMasterCard ? '🏛️ MASTER VAULT TIER DEFINITIONS' : '💳 CLIENT SUBSCRIPTION'}</label>
            
            ${isMasterCard ? `
                <div class="stacked-tiers-list" style="margin-top:10px;">
                    ${availableTiers.length > 0 ? availableTiers.map((t, idx) => `
                        <div class="subscription-grid" style="margin-bottom:8px; display: flex; align-items: center; gap: 10px;">
                            <div class="input-group" style="flex: 2; display: flex; flex-direction: column; gap: 4px;">
                                <input type="text" class="modal-input tiny" value="${esc(t.name)}" placeholder="Tier Name (e.g. Pro)"
                                       onblur="OL.updateMasterAppTier('${app.id}', ${idx}, 'name', this.value)">
                            </div>
                            <div class="input-group" style="flex: 1; display: flex; flex-direction: column; gap: 4px;">
                                <div class="fee-input-wrapper" style="display: flex; align-items: center; gap: 5px; border: 1px solid var(--line); padding: 0 8px; border-radius: 4px; height: 32px; background: rgba(255,255,255,0.05);">
                                    <span class="tiny muted">$</span>
                                    <input type="number" class="modal-input tiny" value="${t.price}" 
                                           style="border:none; background:transparent; width:100%;"
                                           onblur="OL.updateMasterAppTier('${app.id}', ${idx}, 'price', this.value)">
                                </div>
                            </div>
                            <button class="card-delete-btn" style="position:static; margin-left: 5px;" onclick="OL.removeMasterAppTier('${app.id}', ${idx})">×</button>
                        </div>
                    `).join('') : '<div class="tiny muted italic p-10">No tiers defined yet. Click below to add.</div>'}
                    
                    <button class="btn tiny soft full-width" style="border-style:dashed; margin-top: 10px;" onclick="OL.addMasterAppTier('${app.id}')">
                        + Add Tier Definition
                    </button>
                </div>
            ` : `
                <div class="subscription-grid" style="display: flex; align-items: flex-end; gap: 15px; margin-top: 10px; width: 100%;">
                    <div class="input-group" style="flex: 1; display: flex; flex-direction: column; gap: 5px;">
                        <label class="tiny muted bold uppercase" style="font-size: 9px; margin:0; line-height:1;">Selected Tier / Plan</label>
                        <select class="modal-input tiny" style="width: 100%; height: 32px; margin: 0;" onchange="OL.handleAppTierSelection('${app.id}', this.value)">
                            <option value="">-- Select Plan --</option>
                            ${availableTiers.map(t => `
                                <option value="${t.name}|${t.price}" ${app.clientTier === t.name ? 'selected' : ''}>
                                    ${esc(t.name)} ($${t.price}/mo)
                                </option>
                            `).join('')}
                            <option value="Custom" ${app.clientTier === 'Custom' ? 'selected' : ''}>⚠️ Custom / Other</option>
                        </select>
                    </div>
                    <div class="input-group" style="flex: 1; display: flex; flex-direction: column; gap: 5px;">
                        <label class="tiny muted bold uppercase" style="font-size: 9px; margin:0; line-height:1;">Actual Monthly Fee</label>
                        <div class="fee-input-wrapper" style="display: flex; align-items: center; gap: 5px; height: 32px; padding: 0 10px; border: 1px solid var(--line); border-radius: 4px; ${app.clientTier && app.clientTier !== 'Custom' ? 'opacity:0.6; background:rgba(255,255,255,0.03);' : 'background:rgba(0,0,0,0.2);'}">
                            <span class="tiny muted" style="font-weight: bold; opacity: 0.5;">$</span>
                            <input type="number" id="app-cost-input-${app.id}" 
                                   style="border:none; background:transparent; width:100%; outline:none; font-size:12px; padding:0;"
                                   value="${app.monthlyCost || 0}" 
                                   ${app.clientTier && app.clientTier !== 'Custom' ? 'readonly' : ''}
                                   onblur="OL.handleAppSave('${app.id}', this.value, 'monthlyCost')">
                        </div>
                    </div>
                </div>
            `}
        </div>

        <div class="card-section">
            <div style="display:flex; justify-content:space-between; align-items:flex-end; margin-bottom:10px;">
                <label class="modal-section-label">Functional Categories</label>
                ${renderStatusLegendHTML()}
            </div>
            <div class="pills-row">
                ${finalUniqueMappings.map(mapping => {
                    const targetId = mapping.id || mapping;
                    const fn = allFunctions.find(f => String(f.id) === String(targetId));
                    if (!fn) return '';
                    
                    return `
                        <span class="pill tiny status-${mapping.status || 'available'} is-clickable" 
                            onclick="OL.handlePillInteraction(event, '${app.id}', '${fn.id}')"
                            oncontextmenu="OL.handlePillInteraction(event, '${app.id}', '${fn.id}'); return false;"
                            title="Left Click: Jump | Right Click: Cycle | Cmd/Ctrl+Click: Unmap">
                            ${esc(fn.name)}
                        </span>`;
                }).join('')}
            </div>
            <div class="search-map-container" style="margin-top: 15px;">
                <input type="text" class="modal-input" 
                      placeholder="Click to view categories..." 
                      onfocus="OL.filterMapList('', 'functions')"
                      oninput="OL.filterMapList(this.value, 'functions')">
                
                <div id="search-results-list" class="search-results-overlay"></div>
            </div>
        </div>

        <div class="card-section" style="margin-top: 20px;">
            <label class="modal-section-label">📊 Featured In Analysis Matrices</label>
            <div class="pills-row" style="margin-top:10px;">
                ${linkedAnalyses.length > 0 ? linkedAnalyses.map(anly => `
                    <span class="pill tiny soft is-clickable" onclick="OL.openAnalysisMatrix('${anly.id}')">
                        📈 ${esc(anly.name)}
                    </span>
                `).join('') : '<span class="tiny muted italic">No linked analyses found.</span>'}
            </div>
        </div>

        <div class="card-section" style="margin-top: 20px;">
            <label class="modal-section-label">App Notes & Project Instructions</label>
            <textarea class="modal-textarea" rows="3" onblur="OL.handleAppSave('${app.id}', this.value, 'notes')">${esc(app.notes || '')}</textarea>
        </div>

        <div class="card-section" style="margin-top: 20px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                <label class="modal-section-label">
                    Automation Capabilities ${isLinkedToMaster && !isVaultRoute ? '<span class="tiny accent">(Live Sync Active)</span>' : ''}
                </label>
                
                ${showAddButton ? `
                    <button class="btn small soft" onclick="OL.addAppCapability('${app.id}')">+ Add Local Spec</button>
                ` : ''}
            </div>
            <div class="dp-manager-list" id="capabilities-list">
                ${renderCapabilitiesList(app)} 
            </div>
        </div>
        <div class="card-section" style="margin-top: 20px;">
            <label class="modal-section-label">📖 Linked How-To Guides</label>
            <div class="pills-row">
                ${linkedGuides.map(guide => `
                    <span class="pill tiny soft is-clickable" onclick="OL.openGuideEditor('${guide.id}')">
                        📖 ${esc(guide.name)}
                    </span>
                `).join('')}
                ${linkedGuides.length === 0 ? '<span class="tiny muted italic">No guides linked to this tool.</span>' : ''}
            </div>
        </div>
    `;
}

let modalPillOrder = [];
OL.openAppModal = function(appId, draftObj = null) {
    OL.currentOpenModalId = appId;
    const client = getActiveClient();
    const hash = window.location.hash;
    const isVaultRoute = hash.startsWith('#/vault');

    // 1. Resolve Data: Context-Aware Lookup
    let app = draftObj;
    if (!app) {
        if (isVaultRoute) {
            app = (state.master.apps || []).find(a => a.id === appId);
        } else {
            app = (client?.projectData?.localApps || []).find(a => 
                a.id === appId || a.masterRefId === appId
            );
            if (!app) {
                app = (state.master.apps || []).find(a => a.id === appId);
            }
        }
    }

    if (!app) {
        console.error("❌ Modal Error: App object not found for ID:", appId);
        return; 
    }

    // 🎯 Resolve the Lucide icon for this app
    const iconName = OL.getRegistryIcon(app.type);

    // 2. Identify Modal Shell for Soft Refresh
    const modalLayer = document.getElementById("modal-layer");
    const isModalVisible = modalLayer && modalLayer.style.display === "flex";
    const modalBody = document.querySelector('.modal-body');

    // Soft Refresh Logic
    if (isModalVisible && modalBody && document.querySelector('.modal-title-text')) {
        modalBody.innerHTML = `
            ${renderAppModalInnerContent(app, client)}
            ${OL.renderAccessSection(appId, 'app')} 
        `;
        // Trigger repaint for dynamic content
        if (window.lucide) window.lucide.createIcons();
        return;
    }

    const isAdmin = state.adminMode === true;
    const isLinkedToMaster = !!app.masterRefId;
    const canPushToMaster = isAdmin && !isVaultRoute && !isLinkedToMaster;

    // 3. Generate Full HTML
    const html = `
        <div class="modal-head" style="gap:15px; display:flex; align-items:center;">
            <div style="display:flex; align-items:center; gap:10px; flex:1;">
                <i data-lucide="${iconName}" style="width:20px; height:20px; color:var(--accent);"></i>
                <input type="text" class="header-editable-input" 
                       value="${esc(val(app.name))}" 
                       placeholder="App Name (e.g. Slack)..."
                       style="background:transparent; border:none; color:inherit; font-size:18px; font-weight:bold; width:100%; outline:none;"
                       onblur="OL.handleAppSave('${app.id}', this.value)">
            </div>
            ${canPushToMaster ? `
                <button class="btn tiny primary" 
                        onclick="OL.pushLocalAppToMaster('${app.id}')"
                        style="background: var(--accent); color: var(--main-text); font-weight: bold; border:none; display:flex; align-items:center; gap:6px;">
                    <i data-lucide="arrow-up-circle" style="width:12px; height:12px;"></i>
                    PUSH TO MASTER
                </button>
            ` : ''}
            <button class="btn small soft" onclick="OL.closeModal()">Close</button>
        </div>
        <div class="modal-body">
            ${renderAppModalInnerContent(app, client)}
            ${OL.renderAccessSection(appId, 'app')}
        </div>
    `;
    
    window.openModal(html);

    // 🚀 THE REPAINT: Convert all data-lucide to SVGs
    if (window.lucide) {
        window.lucide.createIcons();
    }

    // Auto-focus the name field
    setTimeout(() => {
        const input = document.getElementById('modal-app-name-input');
        if (input) input.focus();
    }, 100);
};

OL.handleAppTierSelection = function(appId, value) {
    const [tierName, tierPrice] = value.split('|');
    const client = getActiveClient();
    if (!client) return;

    const appCard = client.projectData.localApps.find(a => String(a.id) === String(appId));
    if (!appCard) return;

    // 1. Update the data
    if (value === "Custom") {
        appCard.clientTier = "Custom";
    } else {
        appCard.clientTier = tierName;
        appCard.monthlyCost = parseFloat(tierPrice) || 0;
    }

    // 2. Persist to Cloud
    OL.persist().then(() => {
        console.log(`✅ Tier updated for ${appCard.name}. Refreshing modal...`);
        
        // 🚀 THE FIX: Re-open the modal with the current client context
        // This ensures the modal renderer finds the local app object again.
        OL.openAppModal(appId); 
    });
};

OL.addMasterAppTier = function(appId) {
    // Force finding the app in the MASTER registry
    let app = state.master.apps.find(a => String(a.id) === String(appId));
    
    // Fallback: If we passed a local ID, find the master it points to
    if (!app) {
        const client = getActiveClient();
        const localApp = client?.projectData?.localApps.find(la => la.id === appId);
        if (localApp?.masterRefId) {
            app = state.master.apps.find(ma => ma.id === localApp.masterRefId);
        }
    }

    if (app) {
        if (!app.pricingTiers) app.pricingTiers = [];
        app.pricingTiers.push({ name: "New Tier", price: 0 });
        
        OL.persist().then(() => {
            // Re-open with the resolved app object to ensure the UI sees the new array
            OL.openAppModal(app.id); 
        });
    } else {
        console.error("❌ Could not find Master App to add tier to.");
    }
};

OL.updateMasterAppTier = function(appId, idx, field, value) {
    const app = state.master.apps.find(a => String(a.id) === String(appId));
    if (app && app.pricingTiers[idx]) {
        app.pricingTiers[idx][field] = (field === 'price') ? parseFloat(value) || 0 : value;
        OL.persist(); 
        // No modal refresh here to keep focus while typing name
    }
};

OL.removeMasterAppTier = function(appId, idx) {
    const app = state.master.apps.find(a => String(a.id) === String(appId));
    if (app && app.pricingTiers) {
        app.pricingTiers.splice(idx, 1);
        OL.persist().then(() => OL.openAppModal(appId));
    }
};

OL.pushLocalAppToMaster = function(appId) {
    if (!state.adminMode) return;
    
    const client = getActiveClient();
    const localApp = (client?.projectData?.localApps || []).find(a => String(a.id) === String(appId));
    
    if (!localApp) return;

    if (!confirm(`Promote "${localApp.name}" to Master? This will clear local overrides and link this app to the new Vault template.`)) return;

    // 1. Create the Master Clone
    const masterApp = JSON.parse(JSON.stringify(localApp));
    masterApp.id = 'master-app-' + Date.now();
    masterApp.notes = ""; 
    delete masterApp.masterRefId; 

    // 2. Push to Vault
    if (!state.master.apps) state.master.apps = [];
    state.master.apps.push(masterApp);

    // 3. 🚀 THE CLEANUP: Link local to master and WIPE local capabilities
    localApp.masterRefId = masterApp.id;
    localApp.capabilities = []; // Clear local list to prevent duplicates

    console.log("🚀 App promoted and local capabilities cleared.");
    OL.persist();
    
    alert(`"${localApp.name}" is now a Master Template. Local overrides have been removed.`);
    OL.openAppModal(appId);
};

function renderStatusLegendHTML() {
    return `
        <div class="status-legend">
            <div style="display:flex; gap:15px; align-items:center;">
                <div style="display:flex; align-items:center; gap:6px;">
                    <span class="status-dot primary"></span>
                    <span class="tiny muted uppercase bold" style="letter-spacing:0.5px;">Primary</span>
                </div>
                <div style="display:flex; align-items:center; gap:6px;">
                    <span class="status-dot evaluating"></span>
                    <span class="tiny muted uppercase bold" style="letter-spacing:0.5px;">Evaluating</span>
                </div>
                <div style="display:flex; align-items:center; gap:6px;">
                    <span class="status-dot available"></span>
                    <span class="tiny muted uppercase bold" style="letter-spacing:0.5px;">Available</span>
                </div>
            </div>

            <div style="text-align: right; opacity: 0.7;">
                <span class="tiny muted uppercase bold" style="letter-spacing:0.5px; font-size: 0.75em;">
                    Right click pill to cycle. Left click pill to jump. Ctrl/Cmd click pill to unmap.
                </span>
            </div>
        </div>
    `;
}

// SYNC MASTER APPS TO CLIENT AND VICE VERSA
OL.updateMasterApp = function (id, field, value) {
    const hash = window.location.hash;
    const isVaultMode = hash.startsWith('#/vault');
    const client = getActiveClient();

    let targetApp = null;

    if (isVaultMode || id.startsWith('master-')) {
        targetApp = state.master.apps.find(a => a.id === id);
    } else if (client) {
        targetApp = client.projectData.localApps.find(a => a.id === id);
    }

    if (targetApp) {
        targetApp[field] = value;
        OL.persist();
        console.log(`✅ Saved ${field} to ${isVaultMode ? 'Master' : 'Local'} app.`);
    }
};

OL.promoteAppToMaster = function(clientId, localAppId) {
    const client = state.clients[clientId];
    const localApp = client.projectData.localApps.find(a => a.id === localAppId);
    
    if (!localApp) return;
    if (!confirm(`Promote "${localApp.name}" to the Global Master Vault?`)) return;

    // Create a clean master copy
    const masterCopy = JSON.parse(JSON.stringify(localApp));
    masterCopy.id = 'master-app-' + Date.now();
    masterCopy.isMasterTemplate = true;
    
    state.master.apps.push(masterCopy);
    OL.persist();
    alert("✅ App promoted to Master Vault.");
    renderAppsGrid();
};

OL.pushAppToClient = async function(appId, clientId) {
    const client = state.clients[clientId];
    const masterApp = state.master.apps.find(a => String(a.id) === String(appId));
    if (!client || !masterApp) return;

    // 1. Standard Provisioning for the selected App
    const localMappings = (masterApp.functionIds || []).map(m => {
        const fnId = String(typeof m === 'string' ? m : m.id);
        if (!client.sharedMasterIds?.includes(fnId)) {
            if (!client.sharedMasterIds) client.sharedMasterIds = [];
            client.sharedMasterIds.push(fnId);
        }
        return { id: fnId, status: 'available' };
    });

    const localInstance = {
        id: 'local-app-' + Date.now(),
        masterRefId: appId, 
        name: masterApp.name,
        notes: masterApp.notes || "",
        functionIds: localMappings,
        capabilities: [] 
    };

    if (!client.projectData.localApps) client.projectData.localApps = [];
    client.projectData.localApps.push(localInstance);

    // 🚀 2. THE ZAPIER SUITE AUTO-PROVISIONER
    // If the app being added is "Zapier", automatically add the utilities as hidden
    if (masterApp.name === "Zapier") {
        console.log("⚡ Zapier detected. Provisioning Hidden Utility Suite...");
        
        const utilities = [
            { name: "Zapier Filter", key: "filter" },
            { name: "Zapier Formatter", key: "formatter" },
            { name: "Zapier Code", key: "code" },
            { name: "Zapier Delay", key: "delay" },
            { name: "Zapier Manager", key: "manager" },
            { name: "Zapier Looping", key: "looping" },
            { name: "Zapier Webhooks", key: "webhook" },
            { name: "Zapier Email", key: "mail" },
            { name: "Zapier Scheduler", key: "scheduler" },
            { name: "Zapier Formatter", key: "formatter" },
            { name: "Zapier Storage", key: "storage" },
            { name: "Zapier Table", key: "table" },
            { name: "Zapier SMS", key: "sms" },
            { name: "Zapier Engine", key: "engine" },
            { name: "Zapier AI", key: "ai" },
            { name: "Webhook", key: "webhook" },
            { name: "SubZap", key: "subzap" },
        ];

        utilities.forEach(util => {
            // Check if already exists to prevent duplicates
            const exists = client.projectData.localApps.some(a => a.name === util.name);
            if (!exists) {
                client.projectData.localApps.push({
                    id: `local-util-${util.key}-${Date.now()}`,
                    name: util.name,
                    isHidden: true, // 🔒 THE SECRET FLAG
                    notes: "System Utility (Auto-added with Zapier)",
                    functionIds: [],
                    capabilities: []
                });
            }
        });
    }

    await OL.persist();
    buildLayout();
    renderAppsGrid();
    
    setTimeout(() => {
        const modal = document.getElementById("modal-layer");
        if (modal) modal.style.display = "none";
    }, 50);
};

OL.cloneMasterToLocal = function(masterAppId, clientId) {
    const client = state.clients[clientId];
    const masterApp = state.master.apps.find(a => a.id === masterAppId);

    if (!client || !masterApp) return;

    if (!confirm(`Clone "${masterApp.name}" to Local? \n\nThis will create a private copy for this project. You will no longer receive global updates for this specific app instance.`)) return;

    // 1. Create the Local Clone
    const localClone = JSON.parse(JSON.stringify(masterApp));
    localClone.id = 'local-app-' + Date.now();
    localClone.originMasterId = masterAppId; // Track lineage
    localClone.notes += `\n(Cloned from Master on ${new Date().toLocaleDateString()})`;

    // 2. Add to Client's Local Apps
    if (!client.projectData.localApps) client.projectData.localApps = [];
    client.projectData.localApps.push(localClone);

    // 3. Detach the Master Reference
    client.sharedMasterIds = client.sharedMasterIds.filter(id => id !== masterAppId);
    OL.persist();
    OL.closeModal();
    renderAppsGrid();
    
    console.log(`📋 Cloned "${masterApp.name}" to Local Project Stack.`);
};

//======================= APP CAPABILITIES SECTION (TRIGGERS / ACTIONS) =======================//

function renderCapabilitiesList(app, isReadOnlyView) {
    const isVaultRoute = window.location.hash.startsWith('#/vault');
    const client = getActiveClient();
    const isAdmin = state.adminMode === true;
    
    // 1. Get Master Specs
    let masterSpecs = [];
    if (app.masterRefId) {
        const masterSource = state.master.apps.find(ma => ma.id === app.masterRefId);
        masterSpecs = masterSource ? (masterSource.capabilities || []) : [];
    } else if (isVaultRoute) {
        masterSpecs = app.capabilities || [];
    }

    // 2. Get Local Specs
    const localSpecs = isVaultRoute ? [] : (app.capabilities || []);

    // --- RENDER MASTER SPECS ---
    let html = masterSpecs.map((cap, idx) => `
        <div class="dp-manager-row master-spec" style="display:flex; align-items:center; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.03);">
            <div style="display:flex; gap:10px; align-items:center; flex:1;">
                <span class="pill tiny soft" style="display:flex; align-items:center; gap:4px; font-size:9px;">
                    <i data-lucide="${cap.type === 'Trigger' ? 'zap' : 'play'}" style="width:10px; height:10px;"></i>
                    ${cap.type}
                </span>
                <div class="dp-name-cell muted" style="cursor: default; font-size:12px;">${esc(cap.name)}</div>
            </div>
            <div style="display:flex; align-items:center; gap:8px;">
                ${isAdmin ? `
                    <button class="card-delete-btn" style="position:static; opacity:0.4;" 
                            onclick="event.stopPropagation(); OL.removeMasterCapabilityFromApp('${app.id}', ${idx})">
                        <i data-lucide="x" style="width:14px; height:14px;"></i>
                    </button>
                ` : `
                    <i data-lucide="lock" style="width:12px; height:12px; margin-right:10px; opacity:0.3;"></i>
                `}
            </div>
        </div>
    `).join('');

    // --- RENDER LOCAL SPECS ---
    html += localSpecs.map((cap, idx) => {
        const urlParams = new URLSearchParams(window.location.search);
        const isAdmin = state.adminMode === true || urlParams.get('admin') === 'pizza123';
        const isPushed = !!cap.masterRefId;
        const canEdit = (!isPushed || isAdmin);

        return `
        <div class="dp-manager-row local-spec" style="display:flex; align-items:center; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.03);">
            <div style="display:flex; gap:10px; align-items:center; flex:1;">
                <span class="pill tiny ${cap.type === 'Trigger' ? 'accent' : 'soft'} is-clickable" 
                    style="display:flex; align-items:center; gap:4px; min-width: 75px; justify-content: center; user-select: none; font-size:9px;"
                    onmousedown="if(${canEdit}) { event.stopPropagation(); OL.toggleCapabilityType(event, '${app.id}', ${idx}); }">
                    <i data-lucide="${cap.type === 'Trigger' ? 'zap' : 'play'}" style="width:10px; height:10px;"></i>
                    ${cap.type || 'Action'}
                </span>

                <div class="dp-name-cell" 
                    contenteditable="${canEdit ? 'true' : 'false'}" 
                    style="flex: 1; cursor: ${canEdit ? 'text' : 'default'}; padding: 4px; outline: none; font-size:12px; color: var(--text-main);"
                    onmousedown="event.stopPropagation();"
                    onblur="OL.updateLocalCapability('${app.id}', ${idx}, 'name', this.textContent)">
                    ${esc(cap.name)}
                </div>
            </div>

            <div style="display:flex; gap:8px; align-items:center;">
                ${isAdmin && !isPushed && !!app.masterRefId ? `
                    <button class="btn tiny primary" style="font-size:8px; padding: 2px 6px; display:flex; align-items:center; gap:4px;" 
                            onclick="OL.pushSpecToMaster('${app.id}', ${idx})">
                        <i data-lucide="arrow-up-circle" style="width:10px; height:10px;"></i> PUSH
                    </button>
                ` : ''}
                
                ${canEdit ? `
                    <button class="card-delete-btn" style="position:static; opacity:0.4;"
                            onmousedown="event.stopPropagation(); OL.removeLocalCapability('${app.id}', ${idx})">
                        <i data-lucide="x" style="width:14px; height:14px;"></i>
                    </button>
                ` : `
                    <i data-lucide="lock" style="width:12px; height:12px; margin-right:10px; opacity:0.3;"></i>
                `}
            </div>
        </div>`;
    }).join('');

    // 🚀 Trigger icon generation for dynamic content
    setTimeout(() => { if (window.lucide) window.lucide.createIcons(); }, 0);

    return html || '<div class="empty-hint" style="padding:20px; text-align:center; opacity:0.5; font-size:11px;">No capabilities defined.</div>';
}

OL.addAppCapability = function(appId) {
    const client = getActiveClient();
    const isVaultRoute = window.location.hash.startsWith('#/vault');
    
    let app = isVaultRoute 
        ? state.master.apps.find(a => String(a.id) === String(appId))
        : client?.projectData?.localApps?.find(a => String(a.id) === String(appId));

    if (!app) return;
    if (!app.capabilities) app.capabilities = [];
    
    app.capabilities.push({ name: "", type: 'Action' });
    OL.persist();

    // 🚀 SURGICAL REFRESH (No Flash)
    const listEl = document