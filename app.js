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
        const panel = document.getElementById('v2-inspector-panel') || document.getElementById('inspector-panel');
        const inspectorOpen = panel && panel.classList.contains('open');
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
    const wasVisualizer = document.body.classList.contains('is-visualizer');
    
    // Cleanup visualizer mode class when switching away
    if (wasVisualizer && !isVisualizer) {
        document.body.classList.remove('is-visualizer');
    }

    const main = document.getElementById("mainContent");
    if (!main) return; 

    // Build sidebar & layout shell
    window.buildLayout();

    const client = getActiveClient();
    const isVault = hash.startsWith('#/vault');

    // Safe OL namespace accessor
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
    const listEl = document.getElementById('capabilities-list');
    if (listEl) {
        listEl.innerHTML = renderCapabilitiesList(app);
        
        // Auto-focus the last added row
        const rows = listEl.querySelectorAll('.local-spec .dp-name-cell');
        if (rows.length > 0) rows[rows.length - 1].focus();
    }
};

OL.getEffectiveCapabilities = function(app) {
    // 1. If it's a Master Template, just return its own list
    if (app.id.startsWith('master-')) return app.capabilities || [];

    // 2. If it's a Local App, start with its private local list
    let localList = (app.capabilities || []).map(c => ({ ...c, isLocalOnly: true }));

    // 3. If linked to a Master, fetch the Master list and merge them
    if (app.masterRefId) {
        const masterSource = state.master.apps.find(ma => ma.id === app.masterRefId);
        const masterList = masterSource ? (masterSource.capabilities || []) : [];
        // Combined: Master standards first, then local custom ones
        return [...masterList, ...localList];
    }

    return localList;
};

OL.sortMappings = function(mappingArray) {
    if (!Array.isArray(mappingArray)) return [];
    
    const rank = { 'primary': 3, 'evaluating': 2, 'available': 1 };
    
    return [...mappingArray].sort((a, b) => {
        // Handle both object {id, status} and string "id" formats
        const statusA = (typeof a === 'string' ? 'available' : a.status) || 'available';
        const statusB = (typeof b === 'string' ? 'available' : b.status) || 'available';
        
        const scoreA = rank[statusA] || 0;
        const scoreB = rank[statusB] || 0;
        
        return scoreB - scoreA;
    });
};

OL.toggleCapabilityType = function(event, appId, idx) {
    if (event) { event.preventDefault(); event.stopPropagation(); }
    
    const client = getActiveClient();
    const hash = window.location.hash;
    const isVaultRoute = hash.startsWith('#/vault');
    
    let app = isVaultRoute 
        ? state.master.apps.find(a => String(a.id) === String(appId))
        : client?.projectData?.localApps?.find(a => String(a.id) === String(appId));

    if (app && app.capabilities && app.capabilities[idx]) {
        const current = app.capabilities[idx].type;
        app.capabilities[idx].type = (current === 'Action') ? 'Trigger' : 'Action';
        
        OL.persist();

        // 🚀 SURGICAL REFRESH (No Flash)
        const listEl = document.getElementById('capabilities-list');
        if (listEl) {
            listEl.innerHTML = renderCapabilitiesList(app);
        }

        // Keep the background grid in sync
        OL.refreshActiveView();
    }
};

OL.updateAppCapability = function(appId, idx, field, value) {
    const isVaultRoute = window.location.hash.startsWith('#/vault');
    
    // 🛡️ SECURITY GUARD
    if (!isVaultRoute) return; 

    const app = state.master.apps.find(a => a.id === appId);
    if (app && app.capabilities && app.capabilities[idx]) {
        app.capabilities[idx][field] = value.trim();
        OL.persist();
    }
};

// Also update the local text editor
OL.updateLocalCapability = function(appId, idx, field, value) {
    // 🛡️ Remove the "admin-only" check here so clients can save their drafts
    const client = getActiveClient();
    const app = (client?.projectData?.localApps || []).find(a => String(a.id) === String(appId));
    
    if (app && app.capabilities && app.capabilities[idx]) {
        const isPushed = !!app.capabilities[idx].masterRefId;
        
        // 🔒 Final Security Check: If it IS pushed, only Admin can save
        if (isPushed && !state.adminMode) {
            console.error("❌ Action denied: This capability is locked.");
            return;
        }

        app.capabilities[idx][field] = value.trim();
        OL.persist();
        console.log(`✅ Saved ${field} for ${app.name}`);
    }
};

OL.removeAppCapability = function(appId, idx) {
    const hash = window.location.hash;
    const isVaultRoute = hash.startsWith('#/vault');

    // 🛡️ SECURITY GUARD
    if (!isVaultRoute) {
        console.warn("🚫 Cannot delete global technical specs from a project profile.");
        return;
    }

    const app = state.master.apps.find(a => a.id === appId);
    if (app && app.capabilities) {
        app.capabilities.splice(idx, 1);
        OL.persist();
        OL.openAppModal(appId);
    }
};

OL.removeLocalCapability = function(appId, idx) {
    const client = getActiveClient();
    if (!client) return;

    const app = client.projectData.localApps.find(a => a.id === appId);
    
    if (app && app.capabilities) {
        if (confirm("Delete this local capability? Global master specs will not be affected.")) {
            app.capabilities.splice(idx, 1);
            OL.persist();
            OL.openAppModal(appId); // Refresh modal
        }
    }
};

OL.removeMasterCapabilityFromApp = function(appId, idx) {
    if (!state.adminMode) return;

    const client = getActiveClient();
    const app = (client?.projectData?.localApps || []).find(a => String(a.id) === String(appId));

    if (!app) return;

    if (!confirm("Remove this Master Capability from this project?")) return;

    // If the capability is in the local array (standard behavior)
    if (app.capabilities && app.capabilities[idx]) {
        app.capabilities.splice(idx, 1);
        OL.persist();
        console.log("✅ Master capability removed from local instance.");
        OL.openAppModal(appId);
    }
};

// ENABLE SYNC CAPABILITY TO MASTER TEMPLATE
OL.pushSpecToMaster = function(appId, localIdx) {
    const client = getActiveClient();
    const localApp = client?.projectData?.localApps?.find(a => a.id === appId);
    
    if (!localApp || !localApp.masterRefId) {
        return alert("This app must be linked to a Master App before pushing capabilities.");
    }

    const masterApp = state.master.apps.find(ma => ma.id === localApp.masterRefId);
    if (!masterApp) return;

    const specToPush = localApp.capabilities[localIdx];

    // 🛡️ Guard: Check if a capability with the same name already exists in Master
    const exists = masterApp.capabilities?.some(c => 
        c.name.toLowerCase() === specToPush.name.toLowerCase() && c.type === specToPush.type
    );

    if (exists) {
        return alert(`❌ The Master App "${masterApp.name}" already has a ${specToPush.type} named "${specToPush.name}".`);
    }

    if (!confirm(`Standardize "${specToPush.name}"? This will add it to the Vault for ALL clients.`)) return;

    // 1. Add to Master Vault (using a clean copy)
    if (!masterApp.capabilities) masterApp.capabilities = [];
    masterApp.capabilities.push({ 
        name: specToPush.name, 
        type: specToPush.type 
        // Add description or other fields here if you expand your specs later
    });

    // 2. Remove from Local (it will now appear in the "Synced" section of your modal)
    localApp.capabilities.splice(localIdx, 1);

    OL.persist();
    
    // 3. UI Refresh: Re-open the modal to show the capability has moved from "Local" to "Master"
    OL.openAppModal(appId); 
    console.log("🚀 Spec pushed to Master Vault.");
};

//======================== APPS and FUNCTIONS CROSS-REFERENCE=================//
OL.filterMapList = function(query, mode) {
    const listEl = document.getElementById("search-results-list");
    if (!listEl) return;

    const q = (query || "").toLowerCase().trim();
    const client = getActiveClient();
    const hash = window.location.hash;
    const isVaultMode = hash.startsWith('#/vault');
    const contextId = OL.currentOpenModalId; 

    // 1. Resolve current item to find existing mappings
    let currentItem = null;
    if (isVaultMode) {
        currentItem = (mode === 'functions' ? state.master.apps : state.master.functions).find(i => i.id === contextId);
    } else {
        currentItem = (mode === 'functions' ? client?.projectData?.localApps : client?.projectData?.localFunctions).find(i => i.id === contextId || i.masterRefId === contextId);
    }

    const mappedIds = (currentItem?.functionIds || currentItem?.appIds || []).map(m => String(m.id || m));

    // 2. Identify source list
    let source = [];
    if (isVaultMode) {
        source = (mode === 'functions' ? state.master.functions : state.master.apps);
    } else {
        const localItems = mode === 'functions' ? (client?.projectData?.localFunctions || []) : (client?.projectData?.localApps || []);
        const masterItems = mode === 'functions' ? state.master.functions : state.master.apps;
        source = [...masterItems, ...localItems];
    }

    // 3. Filter results
    const matches = source.filter(item => {
        const nameMatch = item.name.toLowerCase().includes(q);
        const alreadyMapped = mappedIds.includes(String(item.id)) || (item.masterRefId && mappedIds.includes(String(item.masterRefId)));
        return nameMatch && !alreadyMapped;
    });

    // 4. Render HTML
    let html = matches.map(item => `
        <div class="search-result-item" onmousedown="OL.executeMap('${item.id}', '${mode}')">
            <div style="display:flex; justify-content:space-between; width:100%; align-items:center;">
                <span>${esc(item.name)}</span>
                <span class="tiny-tag ${String(item.id).startsWith('local') ? 'local' : 'vault'}">
                    ${String(item.id).startsWith('local') ? 'LOCAL' : 'MASTER'}
                </span>
            </div>
        </div>
    `).join('');

    // 🚀 ADD "QUICK CREATE" OPTION (Uses your existing executeCreateAndMap logic)
    if (q.length > 0 && !matches.some(m => m.name.toLowerCase() === q)) {
        html += `
            <div class="search-result-item create-action" onmousedown="OL.executeCreateAndMap('${esc(query)}', '${mode}')">
                <span class="pill tiny accent">+ New</span> Create ${mode === 'apps' ? 'App' : 'Function'} "${esc(query)}"
            </div>`;
    }

    listEl.innerHTML = html || `<div class="search-result-item muted">No unmapped ${mode} found.</div>`;
};

OL.executeMap = function(targetId, mode) {
    const contextId = OL.currentOpenModalId; 
    const hash = window.location.hash;
    const isVaultMode = hash.startsWith('#/vault');
    const client = getActiveClient();
    const searchInput = document.querySelector('.search-map-container input');
    const currentQuery = searchInput ? searchInput.value : "";

    if (!contextId) return;

    // --- 🏛️ SCENARIO 1: MASTER VAULT MAPPING ---
    if (isVaultMode) {
        // In the Vault, we map IDs directly within state.master.apps
        const appId = (mode === 'functions') ? contextId : targetId;
        const fnId = (mode === 'functions') ? targetId : contextId;
        
        const masterApp = state.master.apps.find(a => a.id === appId);
        if (masterApp) {
            OL.executeMappingToggle(masterApp, fnId); // Use internal helper directly
            OL.persist();
        }
    } 
    // --- 💻 SCENARIO 2: PROJECT MAPPING ---
    else if (client) {
        const fnId = (mode === 'functions') ? targetId : contextId;
        
        // 🚀 THE AUTO-UNLOCK: If mapping a master function, share it with the project
        if (fnId.startsWith('fn-') || fnId.startsWith('master-')) {
            if (!client.sharedMasterIds.includes(fnId)) {
                client.sharedMasterIds.push(fnId);
            }
        }

        if (mode === 'apps') {
            let app = client.projectData.localApps?.find(a => a.id === targetId || a.masterRefId === targetId);
            OL.toggleAppFunction(app ? app.id : targetId, contextId);
        } else {
            let localApp = client.projectData.localApps?.find(a => a.id === contextId || a.masterRefId === contextId);
            OL.toggleAppFunction(localApp ? localApp.id : contextId, targetId);
        }
    }

    // Surgical UI Refresh: Redraw the modal and the search results
    const modalTitle = document.querySelector('.modal-title-text')?.textContent || "";
    if (modalTitle.includes('Function')) OL.openFunctionModal(contextId);
    else OL.openAppModal(contextId);

    if (currentQuery) {
        OL.filterMapList(currentQuery, mode);
    }
};

OL.executeCreateAndMap = async function(name, mode, analysisId = null) {
    const client = getActiveClient();
    const contextId = OL.currentOpenModalId;
    const isVault = window.location.hash.startsWith('#/vault');

    // 🚀 THE SHIELD: Wrap everything in one sync event
    await OL.updateAndSync(() => {
        // --- SCENARIO 1: Adding a Brand New App to an Analysis Matrix ---
        if (mode === 'analysis-app') {
            const newId = (isVault ? 'master-app-' : 'local-app-') + Date.now();
            const newApp = {
                id: newId,
                name: name,
                functionIds: [],
                capabilities: [],
                createdDate: new Date().toISOString()
            };

            // Save to Library
            if (isVault) state.master.apps.push(newApp);
            else if (client) client.projectData.localApps.push(newApp);

            // Link to the Matrix
            const source = isVault ? state.master.analyses : client.projectData.localAnalyses;
            const anly = source.find(a => a.id === (analysisId || state.activeMatrixId));
            if (anly) {
                if (!anly.apps) anly.apps = [];
                anly.apps.push({ appId: newId, scores: {} });
            }
        } 
        // --- SCENARIO 2: Original 'apps' mode (Create App from Function Modal) ---
        else if (mode === 'apps') {
            const newId = (isVault ? 'master-app-' : 'local-app-') + Date.now();
            const newApp = {
                id: newId,
                name: name,
                functionIds: [{ id: contextId, status: 'available' }],
                capabilities: []
            };
            if (isVault) state.master.apps.push(newApp);
            else if (client) client.projectData.localApps.push(newApp);
        } 
        // --- SCENARIO 3: Original 'functions' mode (Create Function from App Modal) ---
        else {
            const newId = (isVault ? 'fn-' : 'local-fn-') + Date.now();
            const newFn = { id: newId, name: name, description: "" };
            if (isVault) state.master.functions.push(newFn);
            else if (client) client.projectData.localFunctions.push(newFn);
            
            OL.toggleAppFunction(contextId, newId);
        }
    });

    // 🔄 UI Cleanup & Refresh
    OL.closeModal();
    
    if (mode === 'analysis-app') {
        OL.openAnalysisMatrix(analysisId || state.activeMatrixId, isVault);
    } else {
        OL.refreshActiveView();
        if (mode === 'apps') OL.openFunctionModal(contextId);
        else OL.openAppModal(contextId);
    }
};

OL.toggleAppFunction = function(appId, fnId, event) {
    if (event) event.stopPropagation();
    
    const client = getActiveClient();
    const hash = window.location.hash;
    const isVaultRoute = hash.startsWith('#/vault');
    
    console.log("🔄 Toggle Triggered:", { appId, fnId, isVaultRoute });

    // 1. DATA UPDATE LOGIC
    if (isVaultRoute) {
        // Only touch state.master
        const masterApp = state.master.apps.find(a => a.id === appId);
        if (masterApp) OL.executeMappingToggle(masterApp, fnId, event);
    } else if (client) {
        // 🚀 THE FIX: Only look for the LOCAL app instance.
        // Do NOT search state.master.apps here.
        let localApp = client.projectData.localApps?.find(a => a.id === appId);
        
        if (localApp) {
            OL.executeMappingToggle(localApp, fnId, event);
        } else {
            console.error("Attempted to toggle a Master App directly in Project View. Use 'Import' first.");
        }
    }

    OL.persist();

    // 2. REFRESH BACKGROUND GRIDS
    if (hash.includes('functions')) renderFunctionsGrid();
    if (hash.includes('applications') || hash.includes('apps')) renderAppsGrid();

    // 🚀 3. THE HARDENED MODAL REFRESH
    const modalLayer = document.getElementById("modal-layer");
    if (modalLayer && modalLayer.style.display === "flex") {
        // 1. Get the current active modal body
        const modalBody = modalLayer.querySelector('.modal-body');
        
        // 2. Identify the title to determine context
        const titleEl = modalLayer.querySelector('.modal-title-text') || modalLayer.querySelector('.header-editable-input');
        const modalTitle = titleEl ? (titleEl.textContent || titleEl.value || "").toLowerCase() : "";
        
        const safeClient = isVaultRoute ? null : client;

        // 🚀 TARGET: FUNCTION / PILLAR / PILLAR MODAL
        if (modalTitle.includes('function') || modalTitle.includes('function') || modalTitle.includes('group') || (titleEl && titleEl.placeholder && titleEl.placeholder.includes('Function'))) {
            
            // Find the object using the fnId passed to the toggle
            const fn = [...(state.master.functions || []), ...(client?.projectData?.localFunctions || [])]
                      .find(f => f.id === fnId);
            
            if (fn && modalBody) {
                // Force the specific Function Modal renderer to run
                modalBody.innerHTML = renderFunctionModalInnerContent(fn, safeClient);
                console.log("✅ Function Modal Surgically Refreshed");
            }
        }
        // CHECK 2: Is this an App Modal?
        else if (modalTitle.toLowerCase().includes('app') || 
                 modalTitle.toLowerCase().includes('configure') ||
                 (titleEl && titleEl.placeholder && titleEl.placeholder.includes('App'))) {
            
            const app = isVaultRoute 
                ? state.master.apps.find(a => a.id === appId)
                : client?.projectData?.localApps?.find(a => a.id === appId || a.masterRefId === appId);
            
            if (app && modalBody) {
                console.log("✨ Repainting App Modal...");
                modalBody.innerHTML = `
                    ${renderAppModalInnerContent(app, safeClient)}
                    ${OL.renderAccessSection(app.id, 'app')}
                `;
            }
        }
    }
};

// Internal helper to handle the actual array logic
OL.executeMappingToggle = function(appObj, fnId, event) {
    if (!appObj.functionIds) appObj.functionIds = [];
    
    const existingIdx = appObj.functionIds.findIndex(m => 
        (typeof m === 'string' ? m : m.id) === fnId
    );

    if (event && event.button === 2) { // Right Click
        if (existingIdx > -1) appObj.functionIds.splice(existingIdx, 1);
    } else {
        if (existingIdx === -1) {
            appObj.functionIds.push({ id: fnId, status: 'available' });
        } else {
            const m = appObj.functionIds[existingIdx];
            const stages = ['available', 'evaluating', 'primary'];
            const curIdx = stages.indexOf(m.status || 'available');
            m.status = stages[(curIdx + 1) % stages.length];
        }
    }
};

OL.syncMasterRelationships = function(clientId) {
    const client = state.clients[clientId];
    if (!client) return;

    const localApps = client.projectData.localApps || [];
    const sharedMasterFns = client.sharedMasterIds || [];

    localApps.forEach(app => {
        // Find the original Master version of this app
        const masterApp = state.master.apps.find(ma => ma.id === app.masterRefId);
        if (!masterApp || !masterApp.functionIds) return;

        masterApp.functionIds.forEach(m => {
            const masterFnId = typeof m === 'string' ? m : m.id;

            // 🚀 THE CONDITION: If this function is already in the project's library...
            const isFnInProject = sharedMasterFns.includes(masterFnId) || 
                                 (client.projectData.localFunctions || []).some(lf => lf.id === masterFnId);

            if (isFnInProject) {
                // ...and the relationship doesn't exist locally yet
                const alreadyMapped = app.functionIds.some(localM => (localM.id || localM) === masterFnId);
                
                if (!alreadyMapped) {
                    // Set to 'available' as the default local relationship
                    app.functionIds.push({ id: masterFnId, status: 'available' });
                    console.log(`🔗 Auto-detected relationship: ${app.name} is now Available for ${masterFnId}`);
                }
            }
        });
    });
};

//======================= FUNCTIONS GRID  SECTION =======================//

// 1. RENDER FUNCTIONS GRID
OL.openGlobalFunctionManager = function() {
    const fns = state.master.functions || [];

    const html = `
        <div class="modal-head" style="display:flex; align-items:center; gap:12px;">
            <i data-lucide="settings-2" style="width:20px; height:20px; color:var(--accent);"></i>
            <div class="modal-title-text">Master Function Groups</div>
            <div class="spacer"></div>
            <button class="btn small primary" onclick="OL.addNewMasterFunction()">
                <i data-lucide="plus" style="width:14px; height:14px; margin-right:6px;"></i> New Group
            </button>
            <button class="btn small soft" onclick="OL.closeModal()">Close</button>
        </div>
        <div class="modal-body">
            <p class="small muted" style="margin-bottom: 20px;">
                Define global categories (e.g., 'CRM', 'Billing', 'Custodian') to organize your App Library and enable Benchmarking.
            </p>
            <div class="dp-manager-list">
                ${fns.map(fn => `
                    <div class="dp-manager-row" style="display:flex; align-items:center; justify-content:space-between; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.05);">
                        <div class="dp-name-cell" contenteditable="true" 
                             style="flex:1; cursor:text; outline:none; font-size:13px;"
                             onblur="OL.updateMasterFunction('${fn.id}', 'name', this.textContent); OL.persist();">
                            ${esc(fn.name)}
                        </div>
                        <div class="dp-action-cell">
                            <button class="card-delete-btn" style="position:static; opacity:0.4;" onclick="OL.deleteMasterFunction('${fn.id}')">
                                <i data-lucide="x" style="width:14px; height:14px;"></i>
                            </button>
                        </div>
                    </div>
                `).join('')}
                ${fns.length === 0 ? '<div class="empty-hint" style="padding: 20px; text-align: center;">No function groups defined yet.</div>' : ''}
            </div>
        </div>
    `;
    openModal(html);
    if (window.lucide) window.lucide.createIcons();
};

window.renderFunctionsGrid = function() {
    OL.registerView(renderFunctionsGrid);
    const container = document.getElementById("mainContent");
    const client = getActiveClient(); 
    const hash = window.location.hash;
    const isMasterMode = hash.startsWith('#/vault');
    
    if (!container) return;
    container.style.cssText = '';
    document.body.classList.remove('is-visualizer');

    let displayFunctions = [];
    if (isMasterMode) {
        displayFunctions = state.master.functions || [];
    } else if (client) {
        const local = client.projectData.localFunctions || [];
        const sharedMaster = (state.master.functions || []).filter(f => 
            (client.sharedMasterIds || []).includes(f.id)
        );
        displayFunctions = [...sharedMaster, ...local];
    }
    displayFunctions.sort((a, b) => a.name.localeCompare(b.name));

    const allRelevantApps = isMasterMode 
        ? (state.master.apps || []) 
        : (client?.projectData?.localApps || []);

    container.innerHTML = `
        <div class="section-header" style="display:flex; align-items:center; gap:12px;">
            <i data-lucide="wrench" style="width:28px; height:24px; color:var(--accent);"></i>
            <div style="flex:1;">
                <h2 style="margin:0;">${isMasterMode ? 'Master Function Vault' : 'Project Functions'}</h2>
                <div class="small muted subheader">
                    ${isMasterMode ? 'Global System Architecture' : `Categorized Operations for ${esc(client.meta.name)}`}
                </div>
            </div>
            <div class="header-actions">
                ${isMasterMode ? `
                    <button class="btn primary" onclick="OL.addNewMasterFunction()">
                        <i data-lucide="plus" style="width:14px; height:14px; margin-right:6px;"></i> Create Master Function
                    </button>
                ` : `
                    <button class="btn small soft" onclick="OL.promptAddLocalFunction('${client.id}')">
                        <i data-lucide="plus" style="width:14px; height:14px; margin-right:6px;"></i> Local Function
                    </button>
                    <button class="btn primary" onclick="OL.openVaultFunctionDeploymentModal('${client.id}')">
                        <i data-lucide="download-cloud" style="width:14px; height:14px; margin-right:6px;"></i> Import from Master
                    </button>
                `}
                ${OL.viewToggleBtn('functions', 'renderFunctionsGrid')}
            </div>
        </div>
        ${renderStatusLegendHTML()}

        ${OL.getViewMode('functions') === 'list' ? `
            <div style="display:flex;flex-direction:column;gap:2px;margin-top:10px;">
                ${displayFunctions.map(fn => `
                    <div style="display:flex;align-items:center;gap:12px;padding:10px 16px;
                                background:var(--panel-soft);border:1px solid var(--panel-border);
                                border-radius:8px;cursor:pointer;transition:border-color 0.2s;"
                         onclick="OL.openFunctionModal('${fn.id}')"
                         onmouseover="this.style.borderColor='var(--accent)'"
                         onmouseout="this.style.borderColor='var(--panel-border)'">
                        <i data-lucide="component" style="width:14px;height:14px;color:var(--accent);flex-shrink:0;"></i>
                        <span style="font-weight:600;font-size:13px;flex:1;">${esc(fn.name)}</span>
                        <span class="vault-tag" style="font-size:8px;">${fn.masterRefId ? 'MASTER' : 'LOCAL'}</span>
                        <div class="pills-row" style="margin:0;gap:4px;">
                            ${allRelevantApps.filter(a=>a.functionIds?.some(m=>(m.id||m)===fn.id)).slice(0,3).map(a=>
                                `<span class="pill tiny soft">${esc(a.name)}</span>`
                            ).join('')}
                        </div>
                        <button class="card-delete-btn" style="position:static;" onclick="OL.universalDelete('${fn.id}','functions',event)">
                            <i data-lucide="x" style="width:12px;height:12px;"></i>
                        </button>
                    </div>
                `).join('')}
            </div>
        ` : `
        <div class="cards-grid">
            ${displayFunctions.map(fn => {
                const isMasterRef = !!fn.masterRefId || String(fn.id).startsWith('fn-');
                const tagLabel = isMasterRef ? 'MASTER' : 'LOCAL';
                const tagColor = isMasterRef ? 'var(--accent)' : 'var(--panel-border)';
                
                const mappedApps = allRelevantApps.filter(a => 
                    a.functionIds?.some(m => (typeof m === 'string' ? m : m.id) === fn.id)
                ).map(a => {
                    const mapping = a.functionIds.find(f => (typeof f === 'string' ? f : f.id) === fn.id);
                    return { ...a, currentStatus: (typeof mapping === 'string' ? 'available' : mapping.status) || 'available' };
                });

                const rank = { 'primary': 2, 'evaluating': 1, 'available': 0 };
                mappedApps.sort((a, b) => rank[b.currentStatus] - rank[a.currentStatus]);

                return `
                    <div class="card is-clickable" onclick="OL.openFunctionModal('${fn.id}')">
                        <div class="card-header">
                            <div style="display:flex; align-items:center; gap:8px;">
                                <i data-lucide="component" style="width:14px; height:14px; color:var(--accent);"></i>
                                <div class="card-title">${esc(fn.name)}</div>
                            </div>
                            <div style="display:flex; align-items:center; gap:8px;">
                                <span class="vault-tag" style="background: ${tagColor}; font-size: 8px;">
                                    ${tagLabel}
                                </span>
                                <button class="card-delete-btn" onclick="event.stopPropagation(); OL.universalDelete('${fn.id}', 'functions', event)">
                                    <i data-lucide="x" style="width:12px; height:12px;"></i>
                                </button>
                            </div>
                        </div>
                        <div class="card-body">
                            <div class="pills-row" style="margin-top: 10px;">
                                ${mappedApps.map(app => `
                                    <span class="pill tiny status-${app.currentStatus || 'available'} is-clickable" 
                                        onclick="OL.handlePillInteraction(event, '${app.id}', '${fn.id}')"
                                        oncontextmenu="OL.handlePillInteraction(event, '${app.id}', '${fn.id}'); return false;">
                                      ${esc(app.name)}
                                    </span>
                                `).join('')}
                                ${mappedApps.length === 0 ? '<span class="tiny muted italic">No apps mapped.</span>' : ''}
                            </div>
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
        `}
    `;

    // 🚀 THE REPAINT
    if (window.lucide) window.lucide.createIcons();
};

// 2. ADD, EDIT, OR REMOVE FUNCTION CARD
OL.addNewMasterFunction = function() {
    const draftId = 'draft-fn-vlt-' + Date.now();
    const draftFn = {
        id: draftId,
        name: "",
        description: "",
        isDraft: true,
        originContext: 'vault'
    };
    OL.openFunctionModal(draftId, draftFn);
};

OL.promptAddLocalFunction = function(clientId) {
    const draftId = 'draft-fn-prj-' + Date.now();
    const draftFn = {
        id: draftId,
        name: "",
        description: "",
        isDraft: true,
        originContext: 'project',
        clientId: clientId
    };
    OL.openFunctionModal(draftId, draftFn);
};

OL.handleFunctionSave = function(id, name) {
    const cleanName = name.trim();
    if (!cleanName) return; 

    const isDraft = id.startsWith('draft-fn-');
    const client = getActiveClient();

    if (isDraft) {
        const isVault = id.includes('-vlt-');
        const newId = (isVault ? 'fn-' : 'local-fn-') + Date.now();
        
        const newFn = {
            id: newId,
            name: cleanName,
            description: "",
            createdDate: new Date().toISOString()
        };

        if (isVault) {
            state.master.functions.push(newFn);
        } else if (client) {
            if (!client.projectData.localFunctions) client.projectData.localFunctions = [];
            client.projectData.localFunctions.push(newFn);
        }

        OL.persist();
        
        // 🔄 Switch to permanent ID and refresh background
        OL.openFunctionModal(newId);
        OL.refreshActiveView(); 
    } else {
        // Standard update for existing record
        OL.updateMasterFunction(id, 'name', cleanName);
        // Ensure updateMasterFunction calls refresh:
        OL.refreshActiveView();
    }
};

OL.updateMasterFunction = function(id, field, value) {
    // 1. Resolve Target (Search Master and Local)
    const client = getActiveClient();
    let fn = state.master.functions.find(f => String(f.id) === String(id));
    
    if (!fn && client) {
        fn = client.projectData.localFunctions.find(f => String(f.id) === String(id));
    }

    if (fn) {
        fn[field] = value.trim();
        OL.persist();
        
        // 🚀 THE FIX: Force the background UI to sync
        OL.refreshActiveView();
        
        console.log(`✅ Function ${id} updated: ${field} = ${value}`);
    }
};

OL.deleteMasterFunction = function(id) {
    if (!confirm("Delete this function group? This will un-categorize any apps using it.")) return;
    state.master.functions = state.master.functions.filter(f => f.id !== id);
    OL.persist();
    OL.openGlobalFunctionManager();
};

// 3. RENDER FUNCTION MODAL
OL.openFunctionModal = function(fnId, draftObj = null) {
    OL.currentOpenModalId = fnId;
    const client = getActiveClient();
    const hash = window.location.hash;
    const isVaultMode = hash.startsWith('#/vault');
    const isAdmin = state.adminMode === true;
    
    // 1. Resolve Function Data
    let fn = draftObj;
    if (!fn) {
        fn = [...(state.master.functions || []), ...(client?.projectData?.localFunctions || [])]
             .find(f => String(f.id) === String(fnId));
    }
    if (!fn) return;

    const isLinkedToMaster = !!fn.masterRefId;
    const isVaultRoute = window.location.hash.startsWith('#/vault');
    const canPushFunction = isAdmin && !isVaultRoute && !isLinkedToMaster;
    
    // 2. Identify Modal Shell for Soft Refresh
    const modalLayer = document.getElementById("modal-layer");
    const isModalVisible = modalLayer && modalLayer.style.display === "flex";
    const modalBody = document.querySelector('.modal-body');

    const safeClient = isVaultMode ? null : client;

    // Soft Refresh Logic
    if (isModalVisible && modalBody) {
        modalBody.innerHTML = renderFunctionModalInnerContent(fn, safeClient);
        
        const titleInput = document.querySelector('.header-editable-input');
        if (titleInput) titleInput.value = fn.name;

        // 🚀 Repaint icons for soft refresh
        if (window.lucide) window.lucide.createIcons();
        return;
    }

    // 3. Generate Full HTML
    const html = `
        <div class="modal-head" style="display:flex; align-items:center; gap:15px; padding: 20px;">
            <div style="display:flex; align-items:center; gap:10px; flex:1;">
                <i data-lucide="wrench" style="width:20px; height:20px; color:var(--accent);"></i>
                <input type="text" class="header-editable-input" 
                       value="${esc(val(fn.name))}" 
                       placeholder="Function Name..."
                       style="background:transparent; border:none; color:inherit; font-size:18px; font-weight:bold; width:100%; outline:none;"
                       onblur="OL.handleFunctionSave('${fn.id}', this.value)">
            </div>
            <div style="display:flex; align-items:center; gap:10px;">
                ${canPushFunction ? `
                    <button class="btn tiny primary" 
                            onclick="OL.pushLocalFunctionToMaster('${fn.id}')"
                            style="background: var(--accent); color: var(--main-text); font-weight: bold; display:flex; align-items:center; gap:6px;">
                        <i data-lucide="arrow-up-circle" style="width:12px; height:12px;"></i>
                        PUSH TO MASTER
                    </button>
                ` : ''}
                <button class="btn small soft" onclick="OL.closeModal()">Close</button>
            </div>
        </div>
        <div class="modal-body">
            ${renderFunctionModalInnerContent(fn, safeClient)}
        </div>
    `;
    
    window.openModal(html);

    // 🚀 THE REPAINT: Convert data-lucide to SVGs
    if (window.lucide) {
        window.lucide.createIcons();
    }
};

OL.pushLocalFunctionToMaster = function(fnId) {
    if (!state.adminMode) return;
    
    const client = getActiveClient();
    if (!client || !client.projectData) return;

    // 1. Find the local function
    const localFn = (client.projectData.localFunctions || []).find(f => String(f.id) === String(fnId));
    
    if (!localFn) {
        console.error("❌ Local function not found");
        return;
    }

    if (!confirm(`Promote "${localFn.name}" to the global Master Vault?`)) return;

    // 2. Create a clean Master Clone
    const masterFn = JSON.parse(JSON.stringify(localFn));
    masterFn.id = 'master-fn-' + Date.now();
    delete masterFn.masterRefId; // This is now the source
    
    // 3. Add to Master Library
    if (!state.master.functions) state.master.functions = [];
    state.master.functions.push(masterFn);

    // 4. Link the local version to the new Master
    localFn.masterRefId = masterFn.id;

    console.log("🚀 Function promoted to Master Vault");
    OL.persist();
    
    alert(`"${localFn.name}" is now a Master Function!`);
    OL.openFunctionModal(fnId); // Refresh to show status
};

function renderFunctionModalInnerContent(fn, client) {
    const isVaultRoute = window.location.hash.startsWith('#/vault');
    const isLinkedToMaster = !!fn.masterRefId;

    // 🚀 THE FIX: Logic Scoping
    let allRelevantApps = [];
    if (isVaultRoute) {
        // In the Vault, we show every app in the Master library
        allRelevantApps = state.master.apps || [];
    } else if (client) {
        // In a Project, we ONLY show apps actually in this project's library
        allRelevantApps = client.projectData.localApps || [];
    }

    // Deduplicate and filter for apps that perform this specific function
    const seenAppIds = new Set();
    const mappedApps = allRelevantApps.filter(a => {
        const hasFunction = a.functionIds?.some(m => String(m.id || m) === String(fn.id));
        if (!hasFunction) return false;

        const appId = String(a.masterRefId || a.id);
        if (seenAppIds.has(appId)) return false;
        
        seenAppIds.add(appId);
        return true;
    }).map(a => {
        const mapping = a.functionIds.find(f => String(f.id || f) === String(fn.id));
        return { ...a, currentStatus: (typeof mapping === 'string' ? 'available' : mapping.status) || 'available' };
    });

    const rank = { 'primary': 2, 'evaluating': 1, 'available': 0 };
    mappedApps.sort((a, b) => rank[b.currentStatus] - rank[a.currentStatus]);

    return `
        ${isLinkedToMaster && !isVaultRoute ? `
            <div class="banner info">
                💠 This function is a <b>Master Vault Reference</b>. App mappings and project standards are saved locally.
            </div>
        ` : ''}

        <div class="card-section">
            <div style="display:flex; justify-content:space-between; align-items:flex-end;">
                <label class="modal-section-label">Mapped Applications</label>
                ${renderStatusLegendHTML()}
            </div>
            <div class="pills-row" style="margin-top: 10px;">
                ${mappedApps.map(app => `
                    <span class="pill tiny status-${app.currentStatus || 'available'} is-clickable" 
                        onclick="OL.handlePillInteraction(event, '${app.id}', '${fn.id}')"
                        oncontextmenu="OL.handlePillInteraction(event, '${app.id}', '${fn.id}'); return false;"
                        title="Left Click: Jump | Right Click: Cycle Status | Cmd+Click: Unmap">
                      ${esc(app.name)}
                    </span>
                `).join('')}
                ${mappedApps.length === 0 ? '<span class="tiny muted">No project apps currently mapped to this function.</span>' : ''}
            </div>

            <div class="search-map-container" style="margin-top: 15px;">
                <input type="text" class="modal-input" 
                      placeholder="Click to link existing project app..." 
                      onfocus="OL.filterMapList('', 'apps')"
                      oninput="OL.filterMapList(this.value, 'apps')">
                <div id="search-results-list" class="search-results-overlay"></div>
            </div>
        </div>

        <div class="card-section" style="margin-top: 20px;">
            <label class="modal-section-label">Description / Project Standards</label>
            <textarea class="modal-textarea" rows="4" 
                      placeholder="Define the standard operating procedure for this function..."
                      onblur="OL.updateMasterFunction('${fn.id}', 'description', this.value); OL.persist();">${esc(fn.description || '')}</textarea>
        </div>
    `;
}

// 4. SYNC FUNCTIONS FROM MASTER TO PROJECT AND VICE VERSA
OL.openVaultFunctionDeploymentModal = function(clientId) {
    const html = `
        <div class="modal-head" style="display:flex; align-items:center; gap:12px; padding: 20px;">
            <i data-lucide="download-cloud" style="width:20px; height:20px; color:var(--accent);"></i>
            <div class="modal-title-text">Deploy Master Functions</div>
            <div class="spacer"></div>
            <button class="btn small soft" onclick="OL.closeModal()">Cancel</button>
        </div>
        <div class="modal-body">
            <div class="search-map-container">
                <div style="position:relative; display:flex; align-items:center;">
                    <i data-lucide="search" style="position:absolute; left:12px; width:14px; height:14px; opacity:0.4;"></i>
                    <input type="text" class="modal-input" 
                           style="padding-left:35px;"
                           placeholder="Search function library..." 
                           onfocus="OL.filterMasterFunctionImport('${clientId}', '')"
                           oninput="OL.filterMasterFunctionImport('${clientId}', this.value)" 
                           autofocus>
                </div>
                <div id="master-fn-import-results" class="search-results-overlay" style="margin-top:10px;"></div>
            </div>
        </div>
    `;
    openModal(html);

    // 🚀 THE REPAINT: Ensure the header and search icons render immediately
    if (window.lucide) {
        window.lucide.createIcons();
    }
};

OL.filterMasterFunctionImport = function(clientId, query) {
    const listEl = document.getElementById("master-fn-import-results");
    if (!listEl) return;

    const q = (query || "").toLowerCase().trim();
    const client = state.clients[clientId];
    
    // 🛡️ Get IDs of EVERYTHING already in the project
    const deployedRefs = (client?.projectData?.localFunctions || []).map(f => String(f.masterRefId));
    const sharedIds = (client?.sharedMasterIds || []).map(id => String(id));
    
    const available = (state.master.functions || [])
        .filter(fn => {
            const isMatch = fn.name.toLowerCase().includes(q);
            const isAlreadyPresent = deployedRefs.includes(String(fn.id)) || sharedIds.includes(String(fn.id));
            return isMatch && !isAlreadyPresent;
        })
        .sort((a, b) => a.name.localeCompare(b.name));

    listEl.innerHTML = available.map(fn => `
        <div class="search-result-item" onmousedown="OL.pushFunctionToClient('${fn.id}', '${clientId}'); OL.closeModal();">
            <div style="display:flex; align-items:center; gap:10px;">
                <i data-lucide="wrench" style="width:14px; height:14px; color:var(--accent); opacity:0.8;"></i>
                <span style="font-size: 13px;">${esc(fn.name)}</span>
            </div>
        </div>
    `).join('') || `<div class="search-result-item muted">No unlinked functions found.</div>`;

    // 🚀 THE TRIGGER: Repaint the icons for the newly injected HTML
    if (window.lucide) {
        window.lucide.createIcons();
    }
};

OL.adoptFunctionToMaster = function(clientId, localFnId) {
    const client = state.clients[clientId];
    const localFn = client?.projectData?.localFunctions?.find(f => f.id === localFnId);

    if (!localFn || !state.adminMode) return;

    // ... (Your existing duplicate name guards) ...

    // 2. Create the Master Source
    const globalId = 'fn-' + Date.now();
    
    // ✨ THE FIX: Clone the object but strip project-specific data
    const globalFn = JSON.parse(JSON.stringify(localFn));
    globalFn.id = globalId;
    globalFn.createdDate = new Date().toISOString();
    
    // We do NOT want app mappings in the Master Vault
    delete globalFn.functionIds; 
    delete globalFn.masterRefId;

    // 3. Save to Vault
    state.master.functions.push(globalFn);

    // 4. Link the Local Version (The client keeps THEIR mappings)
    localFn.masterRefId = globalId;

    // 5. Update Local App Mappings to point to the new Master ID
    // This ensures the client doesn't lose their work locally
    client.projectData.localApps?.forEach(app => {
        app.functionIds?.forEach((m, idx) => {
            const currentId = (typeof m === 'string' ? m : m.id);
            if (currentId === localFnId) {
                if (typeof m === 'string') app.functionIds[idx] = globalId;
                else m.id = globalId;
            }
        });
    });

    OL.persist();
    OL.closeModal();
    renderFunctionsGrid();
};

OL.pushFunctionToClient = async function(masterFnId, clientId) {
    const client = state.clients[clientId];
    const masterFn = state.master.functions.find(f => String(f.id) === String(masterFnId));
    if (!client || !masterFn) return;

    // 1. Check if already in project (Shared Master list)
    if (!client.sharedMasterIds) client.sharedMasterIds = [];
    const alreadyInProject = client.sharedMasterIds.includes(String(masterFnId));
    if (alreadyInProject) return alert("Function already active in this project.");

    // 2. Unlock the function for the sidebar/project visibility
    client.sharedMasterIds.push(String(masterFnId));

    // 🚀 3. THE REVERSE LOOKUP: Scan existing project apps for intersections
    (client.projectData.localApps || []).forEach(localApp => {
        // Match Master version by ID or Name
        const masterAppSource = state.master.apps.find(ma => 
            String(ma.id) === String(localApp.masterRefId) || 
            ma.name.toLowerCase() === localApp.name.toLowerCase()
        );
        
        if (masterAppSource && masterAppSource.functionIds) {
            // Check if the Vault says this App performs this new Function
            const isTiedInVault = masterAppSource.functionIds.some(m => {
                const id = typeof m === 'string' ? m : m.id;
                return String(id) === String(masterFnId);
            });
            
            if (isTiedInVault) {
                // Ensure local mapping exists
                if (!localApp.functionIds) localApp.functionIds = [];
                const alreadyMapped = localApp.functionIds.some(m => String(m.id || m) === String(masterFnId));
                
                if (!alreadyMapped) {
                    localApp.functionIds.push({ id: String(masterFnId), status: 'available' });
                    console.log(`🔗 Auto-mapped: ${localApp.name} is now Available for ${masterFn.name}`);
                }
            }
        }
    });

    // 4. Persist and Refresh UI
    await OL.persist();
    
    // Force immediate UI updates
    buildLayout();         // Update sidebar count
    renderFunctionsGrid(); // Redraw cards alphabetically
    
    // Close modal safely
    const modal = document.getElementById("modal-layer");
    if (modal) modal.style.display = "none";
};

//======================= TASK CHECKLIST SECTION =======================//

// 1. RENDER TASK CHECKLIST MODULE
window.renderChecklistModule = function (isVaultMode = false) {
    OL.registerView(renderChecklistModule);
    const container = document.getElementById("mainContent");
    const client = getActiveClient();
    const hash = window.location.hash;
    const isVault = isVaultMode || hash.startsWith('#/vault');

    // 🛡️ GUARD: Wait for full client data
    if (!isVault && (!client || !client.projectData)) {
        container.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;opacity:0.5;">
            <div style="text-align:center;">
                <div style="font-size:24px;margin-bottom:10px;">⏳</div>
                <div>Loading client data...</div>
            </div>
        </div>`;
        // Retry after full data loads
        OL.loadFullClient(client?.id).then(() => renderChecklistModule(isVaultMode));
        return;
    }
    
    if (!container || (!isVault && !client)) return;
    container.style.cssText = '';
    document.body.classList.remove('is-visualizer');

    const allTasks = isVault ? (state.master.taskBlueprints || []) : (client.projectData.clientTasks || []);
    const lineItems = client?.projectData?.scopingSheets?.[0]?.lineItems || [];
    const showCompleted = !!state.ui.showCompleted;

    // Filter logic: Always show Pending/In Progress/Blocked. Only show Done if toggled on.
    const visibleTasks = allTasks.filter(task => {
        // 1. Completion Filter
        if (!showCompleted && task.status === "Done") return false;
        if (isVaultMode) return true;

        // 2. Find if this task is a dependency of ANY resource
        // We scan all project resources to see if this task ID is in their dependencies
        const parentResource = (client.projectData.localResources || []).find(res => 
            (res.dependencies || []).some(dep => dep.id === task.id)
        );

        // 3. If it's NOT linked to a resource, show it (it's a standalone project task)
        if (!parentResource) return true;

        // 4. If it IS linked, check that resource's status in the Scoping Sheet
        const scopingItem = lineItems.find(li => String(li.resourceId) === String(parentResource.id));
        
        if (!scopingItem) return false; // Scoped out entirely

        const status = String(scopingItem.status || "").toLowerCase();
        const party = String(scopingItem.responsibleParty || "").toLowerCase();

        const isDoNow = status === 'do now';
        const isBillable = party === 'sphynx' || party === 'joint';

        return isDoNow && isBillable;
    });

    const completedCount = allTasks.filter(t => t.status === "Done").length;

    container.innerHTML = `
        <div class="section-header" style="display:flex; align-items:center; gap:12px;">
            <i data-lucide="${isVault ? 'shield-check' : 'clipboard-list'}" 
               style="width:28px; height:24px; color:var(--accent);"></i>
            
            <div style="flex: 1;">
                <h2 style="margin:0;">${isVault ? 'Master Tasks' : 'Project Checklist'}</h2>
                <div class="small muted">${visibleTasks.length} tasks visible</div>
            </div>
        
            <div class="header-actions">
                ${!isVault ? `
                    <button class="btn small ${showCompleted ? 'accent' : 'soft'}" onclick="OL.toggleCompletedTasks()">
                        <i data-lucide="${showCompleted ? 'eye-off' : 'eye'}" style="width:14px; height:14px; margin-right:6px;"></i>
                        ${showCompleted ? 'Hide' : 'Show'} Completed (${completedCount})
                    </button>
                ` : ''}
                <button class="btn small soft" onclick="${isVault ? 'OL.promptCreateMasterTask()' : `OL.openAddTaskModal('${client.id}')`}">
                    <i data-lucide="plus" style="width:14px; height:14px; margin-right:6px;"></i>
                    Create Task
                </button>
                <button class="btn primary" onclick="OL.openMasterTaskImporter()">
                    <i data-lucide="download-cloud" style="width:14px; height:14px; margin-right:6px;"></i>
                    Import from Master
                </button>
            </div>
        </div>

        <div class="task-single-column">
            <div id="active-tasks-list">
                ${renderTaskList(client?.id, visibleTasks, isVault)}
            </div>
        </div>
    `;
    if (window.lucide) {
        window.lucide.createIcons();
    }
};

window.renderBlueprintManager = function () {
    const container = document.getElementById("mainContent");
    const blueprints = state.master.taskBlueprints || [];

    container.innerHTML = `
        <div class="section-header" style="display:flex; align-items:center; gap:12px;">
            <i data-lucide="copy" style="width:28px; height:24px; color:var(--accent);"></i>
            <div style="flex: 1;">
                <h2 style="margin:0;">Master Task Blueprints</h2>
                <div class="small muted">Standard implementation steps</div>
            </div>
            <button class="btn primary" onclick="OL.promptCreateMasterTask()">
                <i data-lucide="plus" style="width:14px; height:14px; margin-right:6px;"></i>
                New Blueprint
            </button>
        </div>

        <div class="cards-grid">
            ${blueprints.map((task) => `
                <div class="card is-clickable" onclick="OL.openTaskModal('${task.id}', true)">
                    <div class="card-header">
                        <div class="card-title">${esc(task.title)}</div>
                        <div style="display:flex; align-items:center; gap:8px;">
                            <button class="card-delete-btn" onclick="event.stopPropagation(); OL.removeMasterTask('${task.id}')">
                                <i data-lucide="x" style="width:14px; height:14px;"></i>
                            </button>
                        </div>
                    </div>
                    <div class="card-body">
                        <div class="tiny muted" style="margin-bottom: 8px;">${esc(task.category || 'General')}</div>
                        <div class="pills-row">
                             ${(task.appIds || []).length > 0 ? `
                                <span class="pill tiny soft" style="display:flex; align-items:center; gap:4px;">
                                    <i data-lucide="layout-grid" style="width:10px; height:10px;"></i>
                                    ${(task.appIds || []).length} Tools
                                </span>` : ''}
                             ${(task.howToIds || []).length > 0 ? `
                                <span class="pill tiny soft" style="display:flex; align-items:center; gap:4px;">
                                    <i data-lucide="book-open" style="width:10px; height:10px;"></i>
                                    SOP Linked
                                </span>` : ''}
                        </div>
                    </div>
                </div>
            `).join("")}
            ${blueprints.length === 0 ? '<div class="empty-hint">No blueprints created yet.</div>' : ''}
        </div>
    `;

    // 🚀 Critical: Trigger the icon render
    if (window.lucide) {
        window.lucide.createIcons();
    }
};

// 2. RENDER TASK LIST AND TASK CARDS
function renderTaskList(clientId, tasks, isVault = false) {
    if (tasks.length === 0) return '<div class="empty-hint">No tasks found.</div>';
    const client = getActiveClient();

    // 🏷️ Table Header - Increased name column to 3fr
    const headerHtml = `
        <div class="task-grid-header" style="display: grid; grid-template-columns: 40px 3fr 1fr 1fr 100px 30px; gap: 20px; padding: 10px 15px; border-bottom: 1px solid var(--line); opacity: 0.6; font-size: 10px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px;">
            <div>Stat</div>
            <div>Task Description</div>
            <div>Assignee</div>
            <div>Tools / SOPs</div>
            <div style="text-align: right;">Due Date</div>
            <div></div>
        </div>
    `;

    const rowsHtml = tasks.map(task => {
        const statusConfig = {
            'Pending': '#94a3b8',
            'In Progress': '#3b82f6',
            'Blocked': '#ef4444',
            'Done': '#22c55e'
        };
        const config = statusConfig[task.status || 'Pending'];
        const isDone = task.status === 'Done';

        const parentRes = (client.projectData.localResources || []).find(r => 
            (r.dependencies || []).some(dep => dep.id === task.id)
        );

        const blockers = (task.dependencies || []).map(depId => {
            const depItem = client.projectData.clientTasks.find(t => t.id === depId);
            return (depItem && depItem.status !== 'Done') ? depItem.name : null;
        }).filter(Boolean);

        return `
            <div class="task-grid-row" style="display: grid; grid-template-columns: 40px 3fr 1fr 1fr 100px 30px; gap: 20px; padding: 14px 15px; border-bottom: 1px solid rgba(255,255,255,0.03); align-items: start; transition: background 0.2s; ${isDone ? 'opacity: 0.5;' : ''}">
                
                <div style="padding-top: 4px;">
                    <div onclick="OL.cycleTaskStatus('${clientId}', '${task.id}', event)" 
                         style="width: 12px; height: 12px; border-radius: 50%; background: ${config}; cursor: pointer; border: 2px solid rgba(255,255,255,0.1);">
                    </div>
                </div>

                <div style="display: flex; flex-direction: column; gap: 6px; min-width: 0;">
                    <div class="is-clickable bold ${isDone ? 'line-through' : ''}" 
                         style="font-size: 14px; color: var(--text-main); line-height: 1.4; word-wrap: break-word;"
                         onclick="OL.openTaskModal('${task.id}', ${isVault})">
                        ${esc(task.title || task.name)}
                        ${parentRes ? `<span style="font-weight: normal; opacity: 0.3; font-size: 11px; margin-left: 8px; display: inline-block;">→ ${esc(parentRes.name)}</span>` : ''}
                    </div>
                    
                    ${blockers.length > 0 ? `
                        <div style="display: block; width: 100%; margin-top: 4px;">
                            <div style="color: #ef4444; font-size: 10px; font-weight: bold; background: rgba(239, 68, 68, 0.08); padding: 4px 8px; border-radius: 4px; display: inline-flex; align-items: center; gap: 6px; border: 1px solid rgba(239, 68, 68, 0.2);">
                                <span>🛑 WAITING ON:</span>
                                <span style="font-weight: 500; opacity: 0.9;">${blockers.join(', ')}</span>
                            </div>
                        </div>
                    ` : ''}
                </div>

                <div style="display: flex; flex-wrap: wrap; gap: 4px; padding-top: 2px;">
                    ${(task.assigneeIds || []).length > 0 ? task.assigneeIds.map(id => {
                        const m = client.projectData.teamMembers?.find(mem => mem.id === id);
                        return m ? `<span class="pill tiny accent" style="font-size: 9px; padding: 2px 6px; border-radius: 4px;">${esc(m.name)}</span>` : '';
                    }).join('') : '<span class="tiny muted" style="opacity:0.2;">—</span>'}
                </div>

                <div style="display: flex; flex-wrap: wrap; gap: 6px; padding-top: 2px;">
                    ${(task.appIds || []).length > 0 ? `<span class="pill tiny soft" style="background: rgba(255,255,255,0.03); border: 1px solid var(--line); font-size: 9px;">💻 ${(task.appIds || []).length}</span>` : ''}
                    ${(task.howToIds || []).length > 0 ? `<span class="pill tiny soft" style="background: rgba(255,255,255,0.03); border: 1px solid var(--line); font-size: 9px;">📖 ${(task.howToIds || []).length}</span>` : ''}
                    ${(!task.appIds?.length && !task.howToIds?.length) ? '<span class="tiny muted" style="opacity:0.2;">—</span>' : ''}
                </div>

                <div style="text-align: right; padding-top: 4px;">
                    ${task.dueDate ? `
                        <span class="tiny ${new Date(task.dueDate) < new Date() && !isDone ? 'text-danger' : 'muted'}" style="font-size: 10px; font-weight: bold; font-family: monospace;">
                            ${new Date(task.dueDate).toLocaleDateString([], {month:'short', day:'numeric'}).toUpperCase()}
                        </span>` : '<span class="tiny muted" style="opacity: 0.2;">TBD</span>'}
                </div>

                <div style="text-align: right; padding-top: 2px;">
                    <button class="card-close" style="opacity: 0.2; font-size: 16px; cursor: pointer; transition: opacity 0.2s;" 
                            onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.2"
                            onclick="event.stopPropagation(); ${isVault ? `OL.removeMasterTask('${task.id}')` : `OL.removeClientTask('${clientId}', '${task.id}')`}">×</button>
                </div>
            </div>
        `;
    }).join("");

    return headerHtml + `<div class="task-grid-body">${rowsHtml}</div>`;
}

OL.cycleTaskStatus = function(clientId, taskId, event) {
    if (event) event.stopPropagation();
    const client = state.clients[clientId];
    const task = client?.projectData?.clientTasks.find(t => t.id === taskId);
    if (!task) return;

    // Define the cycle
    const statuses = ['Pending', 'In Progress', 'Blocked', 'Done'];
    let currentIdx = statuses.indexOf(task.status || 'Pending');
    task.status = statuses[(currentIdx + 1) % statuses.length];

    OL.persist();
    renderChecklistModule(); // Refresh UI to update the dot color and section
};

// Add to your state initialization if not present
if (state.ui.showCompleted === undefined) state.ui.showCompleted = false;

OL.toggleCompletedTasks = function() {
    state.ui.showCompleted = !state.ui.showCompleted;
    OL.persist(); // Save preference
    renderChecklistModule(); // Re-render to show/hide
};

OL.openTaskModal = function(taskId, isVault) {
    if (!state.v2) state.v2 = {}; 
    if (!state.v2.activeCommentTab) state.v2.activeCommentTab = 'internal';
    const client = getActiveClient();
    let task = isVault 
        ? state.master.taskBlueprints.find(t => t.id === taskId)
        : client?.projectData?.clientTasks.find(t => t.id === taskId);

    if (!task) return;

    const activeTab = state.v2?.activeCommentTab || 'internal';
    const isGuest = !!window.IS_GUEST;

    const html = `
        <div class="modal-head" style="gap:15px; display:flex; align-items:center; padding: 20px;">
            <div style="display:flex; align-items:center; gap:10px; flex:1;">
                <i data-lucide="clipboard-check" style="width:20px; height:20px; color:var(--accent);"></i>
                <input type="text" class="header-editable-input" 
                       value="${esc(task.title || task.name)}" 
                       placeholder="Task Name..."
                       style="background:transparent; border:none; color:inherit; font-size:18px; font-weight:bold; width:100%; outline:none;"
                       onblur="OL.updateTaskField('${taskId}', '${isVault ? 'title' : 'name'}', this.value, ${isVault})">
            </div>
            <button class="btn small soft" onclick="OL.closeModal()">Close</button>
        </div>

        <div class="modal-layout-wrapper" style="display: flex; height: 75vh; overflow: hidden;">
            
            <div class="modal-body main-config-area" style="flex: 1.5; overflow-y: auto; padding: 20px; border-right: 1px solid var(--line);">

                <div class="card-section" style="margin-top: 20px;">
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                        <div>
                            <label class="modal-section-label">
                                <i data-lucide="calendar" style="width:10px; height:10px; margin-right:4px;"></i> Due Date
                            </label>
                            <input type="date" class="modal-input tiny" value="${task.dueDate || ''}" 
                                   onchange="OL.updateTaskField('${taskId}', 'dueDate', this.value, false)">
                        </div>
                        <div>
                            <label class="modal-section-label">
                                <i data-lucide="activity" style="width:10px; height:10px; margin-right:4px;"></i> Status
                            </label>
                            <select class="modal-input tiny" onchange="OL.updateTaskField('${taskId}', 'status', this.value, false)">
                                <option value="Pending" ${task.status === 'Pending' ? 'selected' : ''}>⏳ Pending</option>
                                <option value="In Progress" ${task.status === 'In Progress' ? 'selected' : ''}>🚧 In Progress</option>
                                <option value="Done" ${task.status === 'Done' ? 'selected' : ''}>✅ Done</option>
                            </select>
                        </div>
                    </div>
                </div>
                
                <div class="card-section">
                    <label class="modal-section-label">
                        <i data-lucide="file-text" style="width:10px; height:10px; margin-right:4px;"></i> Internal SOP / Instructions
                    </label>
                    <textarea class="modal-textarea" rows="4" 
                              onblur="OL.updateTaskField('${taskId}', 'description', this.value, ${isVault})">${esc(task.description || task.notes || "")}</textarea>
                </div>

                <div class="card-section" style="margin-top: 20px;">
                    <label class="modal-section-label">
                        <i data-lucide="layout-grid" style="width:10px; height:10px; margin-right:4px;"></i> Required Tools (Apps)
                    </label>
                    <div class="pills-row" id="task-app-pills" style="margin-bottom: 8px;">
                        ${(task.appIds || []).map(appId => {
                            const app = [...state.master.apps, ...(client?.projectData.localApps || [])].find(a => a.id === appId);
                            return app ? `
                                <span class="pill tiny soft is-clickable" onclick="OL.handleTaskAppInteraction(event, '${taskId}', '${app.id}', ${isVault})">
                                    <i data-lucide="smartphone" style="width:10px; height:10px; margin-right:4px;"></i> ${esc(app.name)}
                                </span>` : '';
                        }).join('')}
                    </div>
                    <div class="search-map-container">
                        <input type="text" class="modal-input tiny" placeholder="Click to link an app..." 
                            onfocus="OL.filterTaskAppSearch('${taskId}', '', ${isVault})"
                            oninput="OL.filterTaskAppSearch('${taskId}', this.value, ${isVault})">
                        <div id="task-app-search-results" class="search-results-overlay"></div>
                    </div>
                </div>

                <div class="card-section" style="margin-top: 20px;">
                    <label class="modal-section-label">
                        <i data-lucide="book-open" style="width:10px; height:10px; margin-right:4px;"></i> Linked How-To Guides
                    </label>
                    <div class="pills-row" style="margin-bottom: 8px;">
                        ${(task.howToIds || []).map(htId => {
                            const guide = (state.master.howToLibrary || []).find(g => g.id === htId); 
                            if (!guide) return ''; 
                            return `
                                <span class="pill tiny soft is-clickable" 
                                      style="cursor: pointer;" 
                                      onclick="OL.openGuideEditor('${guide.id}')">
                                    <i data-lucide="book" style="width:10px; height:10px; margin-right:4px;"></i> ${esc(guide.name)}
                                </span>`;
                        }).join('')}
                    </div>
                    <div class="search-map-container">
                        <input type="text" class="modal-input tiny" placeholder="Click to view guides..." 
                            onfocus="OL.filterTaskHowToSearch('${taskId}', '', ${isVault})"
                            oninput="OL.filterTaskHowToSearch('${taskId}', this.value, ${isVault})">
                        <div id="task-howto-results" class="search-results-overlay"></div>
                    </div>
                </div>

                ${!isVault ? `
                <div class="card-section" style="margin-top: 20px; padding-top: 15px; border-top: 1px solid var(--line);">
                    <div style="margin-top:15px;">
                        <label class="modal-section-label">
                            <i data-lucide="users" style="width:10px; height:10px; margin-right:4px;"></i> Assigned Team Members
                        </label>
                        <div class="pills-row" id="task-assignee-pills" style="margin-bottom: 8px;">
                            ${(task.assigneeIds || []).map(mId => {
                                const member = client.projectData.teamMembers?.find(m => m.id === mId);
                                return member ? `
                                    <span class="pill tiny accent" style="display:flex; align-items:center; gap:4px;">
                                        <i data-lucide="user" style="width:10px; height:10px;"></i> ${esc(member.name)}
                                        <b class="pill-remove-x" style="cursor:pointer; margin-left:4px;" onclick="OL.toggleTaskAssignee(event, '${taskId}', '${member.id}')">×</b>
                                    </span>` : '';
                            }).join('')}
                        </div>
                        <div class="search-map-container">
                            <input type="text" class="modal-input tiny" placeholder="Click to assign member..." 
                                onfocus="OL.filterTaskAssigneeSearch('${taskId}', '')"
                                oninput="OL.filterTaskAssigneeSearch('${taskId}', this.value)">
                            <div id="task-assignee-results" class="search-results-overlay"></div>
                        </div>
                    </div>
                </div>
                ` : ''}
            </div>

            <aside class="modal-sidebar" style="flex: 1; display: flex; flex-direction: column; background: rgba(0,0,0,0.05);">
                <div style="display: flex; border-bottom: 1px solid var(--line);">
                    ${!isGuest ? `
                        <div onclick="state.v2.activeCommentTab='internal'; OL.openTaskModal('${taskId}', ${isVault})"
                             style="flex:1; padding: 12px; text-align:center; font-size:10px; cursor:pointer; font-weight:bold; display:flex; align-items:center; justify-content:center; gap:6px; ${activeTab === 'internal' ? 'color:var(--accent); border-bottom:2px solid var(--accent);' : 'opacity:0.5'}">
                            <i data-lucide="lock" style="width:12px; height:12px;"></i> INTERNAL
                        </div>
                    ` : ''}
                    <div onclick="state.v2.activeCommentTab='client'; OL.openTaskModal('${taskId}', ${isVault})"
                         style="flex:1; padding: 12px; text-align:center; font-size:10px; cursor:pointer; font-weight:bold; display:flex; align-items:center; justify-content:center; gap:6px; ${activeTab === 'client' ? 'color:#10b981; border-bottom:2px solid #10b981;' : 'opacity:0.5'}">
                        <i data-lucide="message-square" style="width:12px; height:12px;"></i> CLIENT FEEDBACK
                    </div>
                </div>

                <div id="task-comments-${taskId}" style="flex: 1; overflow-y: auto; padding: 15px;">
                    ${renderCommentsList(task, activeTab)}
                </div>

                <div class="comment-input-zone" style="padding: 15px; border-top: 1px solid var(--line); background: var(--bg-panel);">
                    <textarea id="new-comment-task-${taskId}" class="modal-textarea" 
                              placeholder="Type a ${activeTab === 'client' ? 'message...' : 'note...'}" 
                              style="min-height: 60px; margin-bottom: 8px; font-size: 11px;"></textarea>
                    <button class="btn tiny full-width" 
                            style="background:${activeTab === 'client' ? '#10b981' : 'var(--accent)'}; color:black; font-weight:bold; display:flex; align-items:center; justify-content:center; gap:6px;"
                            onclick="OL.addTaskComment('${taskId}', ${isVault}, ${activeTab === 'client'})">
                        <i data-lucide="send" style="width:12px; height:12px;"></i> Post ${activeTab === 'client' ? 'to Client' : 'Note'}
                    </button>
                </div>
            </aside>
        </div>
    `;
    openModal(html);

    // 🚀 THE REPAINT: Ensure all icons render correctly immediately
    if (window.lucide) {
        window.lucide.createIcons();
    }
};

OL.addTaskComment = async function(taskId, isVault, isClientFacing = false) {
    const input = document.getElementById(`new-comment-task-${taskId}`);
    const text = input.value.trim();
    if (!text) return;

    const client = getActiveClient();
    let task = isVault 
        ? state.master.taskBlueprints.find(t => t.id === taskId)
        : client?.projectData?.clientTasks.find(t => t.id === taskId);

    if (!task) return;

    let authorName = "Team Member";
    if (window.FORCE_ADMIN) {
        authorName = "Sphynx Team";
    } else if (window.IS_GUEST && client) {
        authorName = client.meta.name;
    }

    if (!task.comments) task.comments = [];
    
    task.comments.push({
        author: authorName,
        text: text,
        timestamp: new Date().toISOString(),
        isClientFacing: isClientFacing
    });

    await OL.persist();
    input.value = "";
    state.v2.activeCommentTab = isClientFacing ? 'client' : 'internal';
    OL.openTaskModal(taskId, isVault);
};

// 📑 UPDATED RENDERER (Ensures the onclick strings are perfectly formed)
function renderCommentsList(obj, activeTab = 'internal') {
    const comments = obj.comments || [];
    const filtered = comments.filter(c => activeTab === 'client' ? c.isClientFacing : !c.isClientFacing);

    if (filtered.length === 0) {
        return `<div class="tiny muted center italic" style="padding: 40px 20px;">No ${activeTab} notes yet.</div>`;
    }

    return filtered.map((c) => {
        const globalIdx = comments.indexOf(c);
        const isClientType = c.isClientFacing;
        const isVaultMode = window.location.hash.includes('vault');
        
        // 🚀 THE FIX: Use explicit global window calls in the string
        const deleteCall = `window.OL.deleteComment('${obj.id}', ${globalIdx})`;

        return `
            <div class="comment-bubble" style="margin-bottom: 12px; padding: 10px; border-radius: 6px; 
                 background: ${isClientType ? 'rgba(16, 185, 129, 0.05)' : 'rgba(255,255,255,0.03)'}; 
                 border: 1px solid ${isClientType ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255,255,255,0.05)'};">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                    <b class="tiny" style="color: ${isClientType ? '#10b981' : 'var(--accent)'}">${esc(c.author)}</b>
                    <span class="tiny muted" style="font-size: 8px;">${new Date(c.timestamp).toLocaleDateString()}</span>
                </div>
                <div class="small" style="line-height: 1.4; font-size: 12px;">${esc(c.text)}</div>
                ${!window.IS_GUEST ? `
                    <div style="text-align: right; margin-top: 5px;">
                        <button class="btn-icon-tiny" style="opacity:0.3; cursor:pointer;" onclick="${deleteCall}">delete</button>
                    </div>
                ` : ''}
            </div>
        `;
    }).join('');
}

window.OL.deleteComment = async function(id, idx) {
    console.log("🗑️ Attempting to delete comment from ID:", id);
    const client = getActiveClient();
    const isVault = window.location.hash.includes('vault');
    const data = isVault ? state.master : client?.projectData;

    if (!data) return;

    // 🕵️ 1. SEARCH TASKS (Checklist Module)
    let owner = (data.clientTasks || []).find(t => String(t.id) === String(id));

    // 🕵️ 2. SEARCH RESOURCES (Flow Map Cards)
    if (!owner) {
        owner = (data.localResources || data.resources || []).find(r => String(r.id) === String(id));
    }

    // 🕵️ 3. SEARCH STEPS (Inside Cards)
    if (!owner) {
        const pool = (data.localResources || data.resources || []);
        for (const res of pool) {
            const stepMatch = (res.steps || []).find(s => String(s.id) === String(id));
            if (stepMatch) {
                owner = stepMatch;
                break;
            }
        }
    }

    // 🗑️ EXECUTE DELETE
    if (owner && owner.comments) {
        owner.comments.splice(idx, 1);
        await OL.persist();
        console.log("✅ Comment removed.");

        // 🔄 REFRESH: Re-open the correct modal
        if (id.startsWith('id_') || (owner.hasOwnProperty('status'))) {
            OL.openTaskModal(id, isVault);
        } else {
            OL.openResourceModal(id);
        }
    } else {
        console.error("❌ Could not find the object or comments for ID:", id);
    }
};

// 3. MASTER TASK IMPORTER
OL.openMasterTaskImporter = function () {
    const html = `
        <div class="modal-head" style="display:flex; align-items:center; gap:12px; padding: 20px;">
            <i data-lucide="download-cloud" style="width:20px; height:20px; color:var(--accent);"></i>
            <div class="modal-title-text">Import Master Blueprints</div>
            <div class="spacer"></div>
            <button class="btn small soft" onclick="OL.closeModal()">Cancel</button>
        </div>
        <div class="modal-body">
            <div class="search-map-container">
                <div style="position:relative; display:flex; align-items:center;">
                    <i data-lucide="search" style="position:absolute; left:12px; width:14px; height:14px; opacity:0.4;"></i>
                    <input type="text" class="modal-input" 
                           style="padding-left:35px;"
                           placeholder="Search blueprints or onboarding steps..." 
                           onfocus="OL.filterMasterTaskImport('')"
                           oninput="OL.filterMasterTaskImport(this.value)" 
                           autofocus>
                </div>
                <div id="master-task-import-results" class="search-results-overlay" style="margin-top:10px;"></div>
            </div>
        </div>
    `;
    openModal(html);

    // 🚀 THE REPAINT: Ensure the icons render correctly immediately
    if (window.lucide) {
        window.lucide.createIcons();
    }
};

OL.filterMasterTaskImport = function(query) {
    const listEl = document.getElementById("master-task-import-results");
    if (!listEl) return;

    const q = (query || "").toLowerCase().trim();
    const client = getActiveClient();
    const existingOrigins = (client?.projectData?.clientTasks || []).map(t => String(t.originId));

    const available = (state.master.taskBlueprints || []).filter(t => 
        (t.title || t.name || "").toLowerCase().includes(q) && !existingOrigins.includes(String(t.id))
    );

    listEl.innerHTML = available.map(task => `
        <div class="search-result-item" onmousedown="OL.executeTaskImport('${task.id}')">
            <div>
                <strong>${esc(task.title || task.name)}</strong>
                <div class="tiny muted">${esc(task.category || 'Standard Process')}</div>
            </div>
        </div>
    `).join('') || `<div class="search-result-item muted">No new blueprints found.</div>`;
};

OL.executeTaskImport = function(masterId) {
    const client = getActiveClient();
    const blueprint = state.master.taskBlueprints.find(t => t.id === masterId);
    
    if (!client || !blueprint) return;

    // 1. Create the Local Task Instance
    const localTaskId = 'local-tk-' + Date.now();
    const newTask = {
        id: localTaskId,
        originId: blueprint.id, // Reference to where it came from
        name: blueprint.title,
        status: "Pending",
        description: blueprint.description || "",
        appIds: [...(blueprint.appIds || [])], // Clone the linked apps
        howToIds: [...(blueprint.howToIds || [])], // Clone the linked SOPs
        assigneeIds: [],
        createdDate: new Date().toISOString(),
        priority: "medium"
    };

    // 2. Save to Project
    if (!client.projectData.clientTasks) client.projectData.clientTasks = [];
    client.projectData.clientTasks.push(newTask);

    // 3. Persist and Refresh
    OL.persist();
    OL.closeModal();
    renderChecklistModule();
    
    // 4. Feedback
    console.log(`✅ Imported blueprint: ${blueprint.title}`);
};

OL.importAllAvailableTasks = function() {
    const client = getActiveClient();
    const masterTasks = state.master.taskBlueprints || [];
    const existingOrigins = (client.projectData.clientTasks || []).map(t => t.originId);
    
    const toImport = masterTasks.filter(t => !existingOrigins.includes(t.id));
    
    if (toImport.length === 0) return;

    toImport.forEach(blueprint => {
        const newTask = {
            id: 'local-tk-' + Date.now() + Math.random(),
            originId: blueprint.id,
            name: blueprint.title || blueprint.name,
            status: "Pending",
            description: blueprint.description || "",
            appIds: [...(blueprint.appIds || [])],
            howToIds: [...(blueprint.howToIds || [])],
            assigneeIds: [],
            createdDate: new Date().toISOString()
        };
        client.projectData.clientTasks.push(newTask);
    });

    OL.persist();
    OL.closeModal();
    renderChecklistModule();
    console.log(`🚀 Bulk Import Complete: ${toImport.length} tasks added.`);
};

// 4. CREATE CUSTOM TASK AND HANDLE MODAL, UPDATE, DELETE TASKS
OL.promptCreateMasterTask = function () {
    const newBlueprintId = uid();
    const newBlueprint = { 
        id: newBlueprintId, 
        title: "New Blueprint", 
        description: "",
        appIds: [],
        howToIds: []
    };

    if (!state.master.taskBlueprints) state.master.taskBlueprints = [];
    state.master.taskBlueprints.push(newBlueprint);

    OL.persist();
    renderChecklistModule(true); 

    // Open immediately
    setTimeout(() => { OL.openTaskModal(newBlueprintId, true); }, 50);
};

OL.openAddTaskModal = function (clientId) {
    const client = state.clients[clientId];
    if (!client) return;

    const newTaskId = uid(); 
    const newTask = {
        id: newTaskId,
        name: "New Task", // Placeholder to be overwritten in modal
        status: "Pending",
        description: "",
        priority: "medium",
        appIds: [],
        howToIds: [],
        assigneeIds: [], // Standardized array
        createdDate: new Date().toISOString()
    };

    if (!client.projectData.clientTasks) client.projectData.clientTasks = [];
    client.projectData.clientTasks.push(newTask);

    OL.persist();
    renderChecklistModule(); 

    // Open immediately
    setTimeout(() => { OL.openTaskModal(newTaskId, false); }, 50);
};

// HANDLE APP-TASK LINKING
OL.filterTaskAppSearch = function(taskId, query, isVault) {
    const listEl = document.getElementById("task-app-search-results");
    if (!listEl) return;

    const q = (query || "").toLowerCase().trim();
    const client = getActiveClient();
    
    const task = isVault 
        ? state.master.taskBlueprints.find(t => t.id === taskId)
        : client?.projectData?.clientTasks.find(t => t.id === taskId);
    
    const existingAppIds = task?.appIds || [];
    const source = [...state.master.apps, ...(client?.projectData?.localApps || [])];

    const matches = source.filter(a => {
        const nameMatch = a.name.toLowerCase().includes(q);
        const alreadyLinked = existingAppIds.includes(a.id);
        return nameMatch && !alreadyLinked;
    });

    listEl.innerHTML = matches.map(app => `
        <div class="search-result-item" onmousedown="OL.toggleTaskApp('${taskId}', '${app.id}', ${isVault})">
            <div style="display:flex; justify-content:space-between; width:100%; align-items:center;">
                <div style="display:flex; align-items:center; gap:8px;">
                    <i data-lucide="smartphone" style="width:14px; height:14px; color:var(--accent);"></i>
                    <span>${esc(app.name)}</span>
                </div>
                <span class="tiny-tag ${String(app.id).startsWith('local') ? 'local' : 'vault'}" style="font-size:8px; opacity:0.6;">
                    ${String(app.id).startsWith('local') ? 'LOCAL' : 'MASTER'}
                </span>
            </div>
        </div>
    `).join('') || '<div class="search-result-item muted">No unlinked tools found.</div>';

    // 🚀 Update icons instantly as user types
    if (window.lucide) window.lucide.createIcons();
};

OL.toggleTaskApp = function(taskId, appId, isVault) {
    const client = getActiveClient();
    let task = isVault 
        ? state.master.taskBlueprints.find(t => t.id === taskId)
        : client?.projectData?.clientTasks.find(t => t.id === taskId);

    if (task) {
        if (!task.appIds) task.appIds = [];
        const idx = task.appIds.indexOf(appId);
        
        if (idx === -1) task.appIds.push(appId);
        else task.appIds.splice(idx, 1);

        OL.persist();
        // Surgical refresh of the modal
        OL.openTaskModal(taskId, isVault);
    }
};

OL.handleTaskAppInteraction = function(event, taskId, appId, isVault) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }

    // 1. REMOVE LOGIC: Cmd + Click or Ctrl + Click
    if (event.metaKey || event.ctrlKey) {
        if (confirm("Remove this tool from the task?")) {
            OL.toggleTaskApp(taskId, appId, isVault);
        }
        return;
    }

    // 2. JUMP LOGIC: Standard Left Click
    OL.openAppModal(appId);
};

// 5. HANDLE TASK STATUS SWITCH
OL.toggleTaskStatus = function (clientId, taskId) {
    const client = state.clients[clientId];
    const task = client?.projectData?.clientTasks.find((t) => t.id === taskId);
    
    if (task) {
        task.status = task.status === "Done" ? "Pending" : "Done";
        OL.persist();
        
        // 🚀 SURGICAL REFRESH: Instead of handleRoute, just redraw the lists
        const allTasks = client.projectData.clientTasks || [];
        const pendingArea = document.getElementById('pending-tasks-list');
        const completedArea = document.getElementById('completed-tasks-list');
        
        if (pendingArea && completedArea) {
            pendingArea.innerHTML = renderTaskList(clientId, allTasks.filter(t => t.status !== "Done"), false);
            completedArea.innerHTML = renderTaskList(clientId, allTasks.filter(t => t.status === "Done"), false);
        } else {
            renderChecklistModule(false); // Fallback
        }
    }
};

// HANDLE TASK ASSIGNEES
OL.filterTaskAssigneeSearch = function(taskId, query) {
    const listEl = document.getElementById("task-assignee-results");
    if (!listEl) return;

    const q = (query || "").toLowerCase().trim();
    const client = getActiveClient();
    const task = client?.projectData?.clientTasks.find(t => t.id === taskId);
    const existingAssignees = task?.assigneeIds || [];

    const matches = (client.projectData.teamMembers || []).filter(m => {
        return m.name.toLowerCase().includes(q) && !existingAssignees.includes(m.id);
    });

    listEl.innerHTML = matches.map(member => `
        <div class="search-result-item" style="display:flex; align-items:center; gap:8px;" 
             onmousedown="OL.toggleTaskAssignee(event, '${taskId}', '${member.id}')">
            <i data-lucide="user" style="width:14px; height:14px; color:var(--accent);"></i>
            <span>${esc(member.name)}</span>
        </div>
    `).join('') || '<div class="search-result-item muted">No other members found.</div>';

    // 🚀 Update icons instantly as user types
    if (window.lucide) window.lucide.createIcons();
};

OL.toggleTaskAssignee = function(event, taskId, memberId) {
    if (event) event.stopPropagation();
    const client = getActiveClient();
    const task = client?.projectData?.clientTasks.find(t => t.id === taskId);

    if (task) {
        if (!task.assigneeIds) task.assigneeIds = [];
        const idx = task.assigneeIds.indexOf(memberId);
        
        if (idx === -1) task.assigneeIds.push(memberId);
        else task.assigneeIds.splice(idx, 1);

        OL.persist();
        OL.openTaskModal(taskId, false); // Refresh Modal
        renderChecklistModule(); // Refresh Background
    }
};

// UPDATE OR DELETE TASK
OL.updateTaskField = function(taskId, field, value, isVault) {
    const client = getActiveClient();
    let task = null;

    if (isVault) {
        task = state.master.taskBlueprints.find(t => t.id === taskId);
    } else {
        task = client?.projectData?.clientTasks.find(t => t.id === taskId);
    }

    if (task) {
        task[field] = value.trim();
        OL.persist();
        
        // Refresh background grid without closing modal
        if (isVault) renderBlueprintManager();
        else renderChecklistModule();
        
        console.log(`✅ Task Updated: ${field} = ${value}`);
    }
};

OL.removeMasterTask = function(taskId) {
    if (!confirm("Permanently delete this Master Blueprint? This will not remove tasks already deployed to clients.")) return;
    state.master.taskBlueprints = state.master.taskBlueprints.filter(t => t.id !== taskId);
    OL.persist();
    renderBlueprintManager();
};

OL.removeClientTask = function(clientId, taskId) {
    if (!confirm("Remove this task from the project?")) return;
    const client = state.clients[clientId];
    if (client) {
        client.projectData.clientTasks = client.projectData.clientTasks.filter(t => t.id !== taskId);
        OL.persist();
        renderChecklistModule();
    }
};

//======================= RESOURCES GRID SECTION =======================//

OL.isResourceInScope = function(resourceId) {
    const client = getActiveClient();
    if (!client || !client.projectData?.scopingSheets) return null;

    // Check the primary scoping sheet for any line item linked to this resource
    const sheet = client.projectData.scopingSheets[0];
    const foundItem = (sheet.lineItems || []).find(item => 
        String(item.resourceId) === String(resourceId)
    );

    return foundItem || null; 
};

// 1. RESOURCE MANAGER
if (!state.master.resourceTypes) {
  state.master.resourceTypes = [
    { type: "Zap", typeKey: "zap", archetype: "Multi-Step", lucideIcon: "zap" },
    { type: "Form", typeKey: "form", archetype: "Base", lucideIcon: "file-text" },
    { type: "Email", typeKey: "email", archetype: "Base", lucideIcon: "mail" },
    { type: "Event", typeKey: "event", archetype: "Base", lucideIcon: "calendar" },
    { type: "SOP", typeKey: "sop", archetype: "Base", lucideIcon: "book-open" },
    { type: "Signature", typeKey: "signature", archetype: "Base", lucideIcon: "pen-tool" },
    { type: "Folder", typeKey: "folder", archetype: "Base", lucideIcon: "folder" },
    { type: "Spreadsheet", typeKey: "spreadsheet", archetype: "Base", lucideIcon: "table-2" }
  ];
}

window.renderResourceManager = function () {
    OL.registerView(renderResourceManager);
    const container = document.getElementById("mainContent");
    const client = getActiveClient();
    const isVaultView = window.location.hash.startsWith('#/vault');

    if (!container) return;
    container.style.cssText = '';
    document.body.classList.remove('is-visualizer');
    
    // 🔓 FIX: Restore standard page scrolling
    document.body.classList.remove('is-visualizer', 'fs-mode-active');
    document.body.style.overflow = 'auto'; 

    const source = isVaultView ? (state.master.resources || []) : (client?.projectData?.localResources || []);
    
    // Data for dropdowns
    const types = [...new Set(source.map(r => r.type).filter(t => t && t !== 'Workflow'))].sort();
    const apps = [...new Set([
        // Direct app on resource
        ...source.map(r => r.appName).filter(Boolean),
        // Apps on steps within each resource
        ...source.flatMap(r => (r.steps || []).map(s => s.appName).filter(Boolean))
    ])].sort();
    const dataTags = state.master.datapoints?.filter(d => !d.isBundle) || [];
    const team = [...(state.master.teamMembers || []), ...(client?.projectData?.teamMembers || []), { name: 'Client 1' }, { name: 'Client 2' }];

    container.innerHTML = `
        <div class="section-header" style="display:flex; align-items:center; gap:12px;">
            <i data-lucide="database" style="width:28px; height:24px; color:var(--accent);"></i>
            <div style="flex:1;">
                <h2 style="margin:0;">${isVaultView ? 'Master Vault' : 'Project Library'}</h2>
                <div class="small muted subheader">Full technical catalog for ${esc(client?.meta.name || 'Global')}</div>
            </div>
            <div class="header-actions">
                ${state.adminMode ? `
                    <button class="btn small soft" onclick="OL.openResourceTypeManager()" style="display:flex; align-items:center; gap:6px;">
                        <i data-lucide="settings" style="width:14px; height:14px;"></i> Types
                    </button>` : ''}

                <button class="btn small ${state.showArchivedResources ? 'primary' : 'soft'}"
                        onclick="state.showArchivedResources = !state.showArchivedResources; renderResourceManager();"
                        style="display:flex;align-items:center;gap:6px;">
                    <i data-lucide="archive" style="width:14px;height:14px;"></i>
                    ${state.showArchivedResources ? 'Hide Archived' : 'Show Archived'}
                </button>
                
                ${OL.viewToggleBtn('resources', 'renderResourceManager')}
                
                <div class="dropdown-plus">
                    <button class="btn primary" onclick="OL.universalCreate('SOP')" style="display:flex; align-items:center; gap:6px;">
                        <i data-lucide="plus" style="width:16px; height:16px;"></i> New Resource
                    </button>
                    <div class="dropdown-content">
                        ${(state.master.resourceTypes || []).map(t => `
                            <a href="javascript:void(0)" onclick="OL.universalCreate('${t.type}')" style="display:flex; align-items:center; gap:8px;">
                                <i data-lucide="${OL.getRegistryIcon(t.type)}" style="width:14px; height:14px; opacity:0.7;"></i>
                                <span>New ${t.type}</span>
                            </a>
                        `).join('')}
                        <div class="divider"></div>
                        <a href="javascript:void(0)" onclick="OL.universalCreate('General')" style="display:flex; align-items:center; gap:8px;">
                            <i data-lucide="component" style="width:14px; height:14px; opacity:0.7;"></i>
                            <span>New General Resource</span>
                        </a>
                    </div>
                </div>

                <button class="btn primary" onclick="OL.bulkImportZaps()" style="display:flex; align-items:center; gap:6px;">
                    <i data-lucide="zap" style="width:14px; height:14px;"></i> Bulk Zaps
                </button>
                <button class="btn primary" onclick="OL.openImportHub()" style="display:flex; align-items:center; gap:6px;">
                    <i data-lucide="plug-2" style="width:14px; height:14px;"></i> Import Hub
                </button>
            </div>
        </div>

        <div class="v2-toolbar" style="margin: 20px 0; display: flex; gap: 10px; flex-wrap: wrap; background: rgba(255,255,255,0.03); padding: 15px; border-radius: 8px; border: 1px solid var(--line);">
            <div class="canvas-search-wrap" style="flex: 2; min-width: 250px; position:relative; display:flex; align-items:center;">
                <i data-lucide="search" style="position:absolute; left:12px; width:14px; height:14px; opacity:0.4;"></i>
                <input type="text" id="lib-filter-input" class="v2-search-input" 
                       placeholder="Search name, description, or notes..." 
                       style="padding-left:35px; width:100%;"
                       value="${state.libSearch || ''}"
                       oninput="state.libSearch = this.value; OL.syncResourceLibraryFilters()">
            </div>
            
            <select id="lib-filter-type" class="tiny-select" onchange="OL.syncResourceLibraryFilters()">
                <option value="">All Types</option>
                ${types.map(t => `<option value="${t}">${t}</option>`).join('')}
            </select>

            <select id="lib-filter-app" class="tiny-select" onchange="OL.syncResourceLibraryFilters()">
                <option value="">All Apps</option>
                ${apps.map(a => `<option value="${a}">${a}</option>`).join('')}
            </select>

            <select id="lib-filter-assignee" class="tiny-select" onchange="OL.syncResourceLibraryFilters()">
                <option value="">All Owners</option>
                ${team.map(m => `<option value="${esc(m.name)}">${esc(m.name)}</option>`).join('')}
            </select>

            <select id="lib-filter-scoped" class="tiny-select" onchange="OL.syncResourceLibraryFilters()">
                <option value="">All Scoping</option>
                <option value="scoped">Scoped ($)</option>
                <option value="unscoped">Unscoped</option>
            </select>

            <select id="lib-filter-party" class="tiny-select" onchange="OL.syncResourceLibraryFilters()">
                <option value="">All Parties</option>
                <option value="Sphynx">Sphynx</option>
                <option value="Client">Client</option>
                <option value="Joint">Joint</option>
            </select>

            <select id="lib-filter-logic" class="tiny-select" onchange="OL.syncResourceLibraryFilters()">
                <option value="">Any Logic</option>
                <option value="has">With λ Logic</option>
            </select>

            <button class="btn tiny danger soft" onclick="OL.clearResourceFilters()" style="display:flex; align-items:center; gap:4px;">
                <i data-lucide="filter-x" style="width:12px; height:12px;"></i> Clear
            </button>
        </div>

        <div id="resource-library-results"></div>
    `;

    // 🚀 THE REPAINT: Convert all tags to SVGs
    if (window.lucide) {
        window.lucide.createIcons();
    }

    OL.syncResourceLibraryFilters();
};

OL.syncResourceLibraryFilters = function() {
    const container = document.getElementById('resource-library-results');
    if (!container) return;
    container.style.cssText = '';
    document.body.classList.remove('is-visualizer');

    const query = document.getElementById('lib-filter-input')?.value.toLowerCase().trim() || "";
    const typeF = document.getElementById('lib-filter-type')?.value || "";
    const appF = document.getElementById('lib-filter-app')?.value || "";
    const dataTagF = document.getElementById('lib-filter-data-tag')?.value || "";
    const assigneeF = document.getElementById('lib-filter-assignee')?.value || "";
    const statusF = document.getElementById('lib-filter-scoped')?.value || "";
    const logicF = document.getElementById('lib-filter-logic')?.value || "";
    const scopeStatusF = document.getElementById('lib-filter-scoping-status')?.value || "";
    const partyF = document.getElementById('lib-filter-party')?.value || "";

    const client = getActiveClient();
    const isVault = window.location.hash.includes('vault');
    const source = isVault ? (state.master.resources || []) : (client?.projectData?.localResources || []);

    const filtered = source.filter(res => {
         if (!state.showArchivedResources && res.isArchived) return false;
        //if (res.type === 'Workflow') return false;

        const matchesQuery = !query || res.name.toLowerCase().includes(query) || (res.description || "").toLowerCase().includes(query);
        const matchesType = !typeF || res.type === typeF;
        const matchesApp = !appF || res.appName === appF || (res.steps || []).some(s => s.appName === appF);
        const matchesDataTag = !dataTagF || (res.steps || []).some(s => (s.datapoints || []).some(d => String(d.id) === String(dataTagF)));
        
        // Logic Filter
        const matchesLogic = !logicF || (res.steps || []).some(s => (s.logic?.in?.length > 0 || s.logic?.out?.length > 0));

        // Assignee Filter (Multi-select aware)
        const matchesAssignee = !assigneeF || (res.steps || []).some(s => 
            s.assigneeName === assigneeF || (s.assignees || []).some(a => (a.name || a) === assigneeF)
        );

        // Scoping Filter
        let matchesStatus = true;
        const isInScope = !!OL.isResourceInScope(res.id);
        if (statusF === "scoped") matchesStatus = isInScope;
        if (statusF === "unscoped") matchesStatus = !isInScope;

        const scopeData = OL.getScopingDataForResource(res.id);
        const matchesScopeStatus = !scopeStatusF || (scopeData && scopeData.status === scopeStatusF);
        const matchesParty = !partyF || (scopeData && scopeData.responsibleParty === partyF);

        return matchesQuery && matchesType && matchesApp && matchesDataTag && matchesAssignee && matchesStatus && matchesLogic && matchesScopeStatus && matchesParty;
    });

    OL.renderResourceGroups(container, filtered);
};

OL.renderResourceGroups = function(container, items) {
    if (!state.showArchivedResources) {
        items = items.filter(r => !r.isArchived);
    }
    
    if (items.length === 0) {
        container.innerHTML = `<div class="empty-hint" style="padding: 100px; text-align: center; opacity: 0.5;">No resources matching your filters.</div>`;
        return;
    }

    const sphynxPinned  = items.filter(res => res.systemPinned);
    const adminPinned   = items.filter(res => res.adminPinned);
    const standardItems = items.filter(res => !res.systemPinned && !res.adminPinned);

    const grouped = standardItems.reduce((acc, res) => {
        const type = res.type || "General";
        if (!acc[type]) acc[type] = [];
        acc[type].push(res);
        return acc;
    }, {});

    const sortedTypes = Object.keys(grouped).sort();

    container.innerHTML = `
        <div class="resource-sections-wrapper">
            ${sphynxPinned.length ? `
            <div class="resource-group" style="margin-bottom: 30px;">
                <div style="border-bottom: 2px solid var(--accent); padding: 8px; background: rgba(var(--accent-rgb), 0.05); margin-bottom:12px; display:flex; align-items:center; gap:8px;">
                    <i data-lucide="gem" style="width:16px; height:16px; color: var(--accent);"></i>
                    <h3 style="margin:0; font-size:12px; color: var(--accent); letter-spacing:0.05em;">SPHYNX RESOURCES</h3>
                </div>
                ${OL.getViewMode('resources') === 'list' ? `
                    <div style="display:flex;flex-direction:column;gap:2px;">
                        ${sphynxPinned.map(res => OL._renderResourceListRow(res)).join('')}
                    </div>
                ` : `
                    <div class="cards-grid">${sphynxPinned.map(r => renderResourceCard(r)).join('')}</div>
                `}
            </div>` : ''}
        
        ${adminPinned.length ? `
            <div class="resource-group" style="margin-bottom: 30px;">
                <div style="border-bottom: 2px solid #94a3b8; padding: 8px; background: rgba(148, 163, 184, 0.05); margin-bottom:12px; display:flex; align-items:center; gap:8px;">
                    <i data-lucide="shield-check" style="width:16px; height:16px; color: #94a3b8;"></i>
                    <h3 style="margin:0; font-size:12px; color: #94a3b8;">ADMIN</h3>
                </div>
                ${OL.getViewMode('resources') === 'list' ? `
                    <div style="display:flex;flex-direction:column;gap:2px;">
                        ${adminPinned.map(res => OL._renderResourceListRow(res)).join('')}
                    </div>
                ` : `
                    <div class="cards-grid">${adminPinned.map(r => renderResourceCard(r)).join('')}</div>
                `}
            </div>` : ''}

            ${sortedTypes.map(type => `
                <div class="resource-group" style="margin-bottom: 40px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; border-bottom: 1px solid var(--accent); padding-bottom: 8px; margin-bottom:15px;">
                        <div style="display:flex; align-items:center; gap:10px;">
                            <i data-lucide="${OL.getRegistryIcon(type)}" style="width:18px; height:18px; color: var(--accent);"></i>
                            <h3 style="margin:0; font-size: 13px; text-transform: uppercase; color: var(--accent); letter-spacing: 0.1em;">
                                ${type}s
                            </h3>
                        </div>
                        <button class="btn tiny soft" onclick="OL.promptBulkReclassify('${type}')">Bulk Move</button>
                    </div>
                    ${OL.getViewMode('resources') === 'list' ? `
                        <div style="display:flex;flex-direction:column;gap:2px;">
                            ${grouped[type].sort((a, b) => a.name.localeCompare(b.name)).map(res => {
                                const scopeData = OL.getScopingDataForResource(res.id);
                                const statusColors = {'Do Now':'#38bdf8','Done':'#22c55e','Do Later':'#fbbf24',"Don't Do":'#ef4444'};
                                const statusColor = scopeData ? (statusColors[scopeData.status]||'var(--accent)') : 'transparent';
                                return `
                                    <div style="display:flex;align-items:center;gap:12px;padding:10px 16px;
                                                background:var(--panel-soft);border:1px solid var(--panel-border);
                                                border-left:3px solid ${statusColor};
                                                border-radius:8px;cursor:pointer;transition:border-color 0.2s;"
                                         onclick="OL.selectResourceCard('${res.id}')"
                                         onmouseover="this.style.borderColor='var(--accent)'"
                                         onmouseout="this.style.borderColor='var(--panel-border)'">
                                        <i data-lucide="${OL.getRegistryIcon(res.type)}" style="width:14px;height:14px;color:var(--accent);flex-shrink:0;"></i>
                                        <span style="font-weight:600;font-size:13px;flex:1;">${esc(res.name)}</span>
                                        <span style="font-size:10px;color:var(--text-muted);">${esc(res.type||'General')}</span>
                                        ${scopeData ? `<span class="pill tiny" style="background:${statusColor}22;color:${statusColor};border:1px solid ${statusColor}44;font-size:8px;">${esc(scopeData.status)}</span>` : ''}
                                        ${!res.isLocked ? `
                                            <button class="card-delete-btn" style="position:static;" onclick="event.stopPropagation();OL.universalDelete('${res.id}','resources')">
                                                <i data-lucide="x" style="width:12px;height:12px;"></i>
                                            </button>` : ''}
                                    </div>
                                `;
                            }).join('')}
                        </div>
                    ` : `
                        <div class="cards-grid">
                            ${grouped[type].sort((a, b) => a.name.localeCompare(b.name)).map(r => renderResourceCard(r)).join('')}
                        </div>
                    `}
                </div>
            `).join('')}
        </div>
    `;

    if (window.lucide) window.lucide.createIcons();
};

OL._renderResourceListRow = function(res) {
    const scopeData = OL.getScopingDataForResource(res.id);
    const statusColors = {'Do Now':'#38bdf8','Done':'#22c55e','Do Later':'#fbbf24',"Don't Do":'#ef4444'};
    const statusColor = scopeData ? (statusColors[scopeData.status]||'var(--accent)') : 'transparent';
    return `
        <div style="display:flex;align-items:center;gap:12px;padding:10px 16px;
                    background:var(--panel-soft);border:1px solid var(--panel-border);
                    border-left:3px solid ${statusColor};
                    border-radius:8px;cursor:pointer;transition:border-color 0.2s;
                    opacity:${res.isArchived ? '0.5' : '1'};"
             onclick="OL.selectResourceCard('${res.id}')"
             onmouseover="this.style.borderColor='var(--accent)'"
             onmouseout="this.style.borderColor='var(--panel-border)'">
            <i data-lucide="${OL.getRegistryIcon(res.type)}" style="width:14px;height:14px;color:var(--accent);flex-shrink:0;"></i>
            <span style="font-weight:600;font-size:13px;flex:1;">${esc(res.name)}</span>
            ${res.isArchived ? `<span class="pill tiny" style="background:rgba(107,114,128,0.1);color:var(--text-dim);border:1px solid #6b7280;font-size:8px;">📦 Archived</span>` : ''}
            <span style="font-size:10px;color:var(--text-muted);">${esc(res.type||'General')}</span>
            ${scopeData ? `<span class="pill tiny" style="background:${statusColor}22;color:${statusColor};border:1px solid ${statusColor}44;font-size:8px;">${esc(scopeData.status)}</span>` : ''}
            ${!res.isLocked ? `
                <button class="card-delete-btn" style="position:static;" 
                        onclick="event.stopPropagation();OL.universalDelete('${res.id}','resources')">
                    <i data-lucide="x" style="width:12px;height:12px;"></i>
                </button>` : ''}
        </div>
    `;
};

OL.clearResourceFilters = function() {
    state.libSearch = "";
    state.libTypeFilter = "";
    // Reset inputs manually for immediate visual feedback
    document.getElementById('lib-filter-input').value = "";
    document.getElementById('lib-filter-type').selectedIndex = 0;
    document.getElementById('lib-filter-app').selectedIndex = 0;
    document.getElementById('lib-filter-data-tag').selectedIndex = 0;
    OL.syncResourceLibraryFilters();
};

OL.universalCreate = async function(type, options = {}) {
    const { name: predefinedName, linkToWfId, insertIdx } = options;
    
    const name = predefinedName || prompt(`Enter ${type} Name:`);
    if (!name) return null;

    const context = OL.getCurrentContext();
    const client = getActiveClient();
    const timestamp = Date.now();
    const newId = context.isMaster ? `res-vlt-${timestamp}` : `local-prj-${timestamp}`;

    const registry = state.master.resourceTypes || [];
    const typeInfo = registry.find(t => t.type === type);
    const archetype = typeInfo?.archetype || "Base";

    const newRes = {
        id: newId,
        name: name,
        type: type || "SOP",
        archetype: archetype,
        steps: [],
        triggers: [],
        data: {},
        description: options.description || "",
        createdDate: new Date().toISOString()
    };

    await OL.updateAndSync(() => {
        // 🛡️ Always push to the correct array directly
        if (context.isMaster) {
            if (!state.master.resources) state.master.resources = [];
            state.master.resources.push(newRes);
        } else if (client) {
            if (!client.projectData.localResources) client.projectData.localResources = [];
            client.projectData.localResources.push(newRes);
            // Keep the bridge in sync
            client.projectData.resources = client.projectData.localResources;
        }

        if (linkToWfId) {
            const wf = (context.isMaster ? state.master : client.projectData)
                .workflows?.find(w => String(w.id) === String(linkToWfId));
            if (wf) {
                if (!wf.steps) wf.steps = [];
                wf.steps.splice(insertIdx ?? wf.steps.length, 0, {
                    id: uid(),
                    resourceLinkId: newId
                });
            }
        }
    });

    if (linkToWfId) {
        OL.refreshMap();
        setTimeout(() => OL.openInspector(newId, linkToWfId), 100);
    } else {
        renderResourceManager();
        OL.openResourceModal(newId);
    }

    return newId;
};

// 📦 2. BULK RECLASSIFY
OL.promptBulkReclassify = function(oldType) {
    const newType = prompt(`Move all resources from "${oldType}" to which category?`, "Zap");
    if (!newType || newType === oldType) return;

    const isVault = location.hash.includes('vault');
    const source = isVault ? state.master.resources : getActiveClient().projectData.localResources;

    let count = 0;
    source.forEach(res => {
        if (res.type === oldType) {
            res.type = newType;
            res.typeKey = newType.toLowerCase().replace(/[^a-z0-9]+/g, "");
            count++;
        }
    });

    if (count > 0) {
        OL.persist();
        renderResourceManager();
        alert(`Successfully moved ${count} items to ${newType}.`);
    }
};

//================ RESOURCE TYPES ========================//

OL.openResourceTypeManager = function () {
    const registry = state.master.resourceTypes || [];
    const masterFunctions = state.master.functions || [];
    const quickIcons = ["zap", "file-text", "mail", "calendar", "plug-2", "book-open", "home", "message-square", "wrench", "target", "bot", "trending-up", "folder", "table-2", "pen-tool", "clipboard-list", "database", "users", "star", "flag"];

    let html = `
        <div class="modal-head" style="display:flex; align-items:center; gap:12px;">
            <i data-lucide="settings" style="width:20px; height:20px; color:var(--accent);"></i>
            <div class="modal-title-text">Manage Resource Types</div>
        </div>
        <div class="modal-body">
            <p class="tiny muted" style="margin-bottom:20px;">
                Click an icon in the quick grid to assign it. Changes pull through to all resource cards immediately.
            </p>
            
            <div class="dp-manager-list" style="max-height:400px; overflow-y:auto;">
                ${registry.map(t => {
                    const encType = btoa(t.type);
                    const currentIcon = t.lucideIcon || 'settings';
                    return `
                    <div class="dp-manager-row type-editor-row" 
                         id="type-row-${t.typeKey}"
                         style="display:flex; align-items:center; gap:10px; padding:10px 0; border-bottom:1px solid var(--line);">
                        
                        <div id="type-icon-preview-${t.typeKey}"
                             style="width:32px; height:32px; display:flex; align-items:center; justify-content:center;
                                    background:rgba(var(--accent-rgb),0.1); border:1px solid var(--accent);
                                    border-radius:6px; flex-shrink:0; cursor:pointer;"
                             onclick="OL._openIconPicker('${t.typeKey}')">
                            <i data-lucide="${currentIcon}" style="width:16px; height:16px; color:var(--accent);"></i>
                        </div>

                        <span contenteditable="true" 
                              style="flex:1; font-weight:600; outline:none; font-size:13px;"
                              onblur="OL.renameResourceTypeFlat('${encType}', this.innerText)">
                            ${esc(t.type)}
                        </span>
                        
                        <select class="modal-input tiny" style="width:140px;"
                                onchange="OL.updateResourceTypeProp('${t.typeKey}', 'matchedFunctionId', this.value)">
                            <option value="">-- No Auto-Lock --</option>
                            ${masterFunctions.map(f => `
                                <option value="${f.id}" ${t.matchedFunctionId === f.id ? 'selected' : ''}>
                                    ${esc(f.name)}
                                </option>
                            `).join('')}
                        </select>

                        <button class="card-delete-btn" style="position:static;" 
                                onclick="OL.removeRegistryTypeByKey('${t.typeKey}')">
                            <i data-lucide="x" style="width:14px; height:14px;"></i>
                        </button>
                    </div>`;
                }).join('')}
            </div>

            <div style="margin-top:20px; padding-top:20px; border-top:1px solid var(--line);">
                <label class="modal-section-label">Add New Type</label>
                <div style="display:flex; gap:10px; margin-bottom:15px;">
                    <input type="text" id="new-type-icon" class="modal-input tiny" style="width:100px;" placeholder="Icon (e.g. zap)">
                    <input type="text" id="new-type-input" class="modal-input" style="flex:1;" placeholder="New Type Name...">
                    <button class="btn primary" onclick="OL.addNewResourceTypeFlat()">Add Type</button>
                </div>
                
                <div style="display:flex; flex-wrap:wrap; gap:6px;">
                    ${quickIcons.map(icon => `
                        <div style="cursor:pointer; padding:8px; background:var(--bg-card); border:1px solid var(--line); 
                                    border-radius:6px; display:flex; align-items:center; justify-content:center;
                                    transition:all 0.15s;"
                             title="${icon}"
                             onmouseover="this.style.borderColor='var(--accent)'; this.style.background='rgba(var(--accent-rgb),0.1)';"
                             onmouseout="this.style.borderColor='var(--line)'; this.style.background='var(--bg-card)';"
                             onclick="document.getElementById('new-type-icon').value='${icon}'; 
                                      const active = document.querySelector('.type-editor-row.icon-picker-active');
                                      if (active) {
                                          const key = active.id.replace('type-row-','');
                                          OL.updateResourceTypeProp(key, 'lucideIcon', '${icon}');
                                      }">
                            <i data-lucide="${icon}" style="width:14px; height:14px;"></i>
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>`;
    openModal(html);
    if (window.lucide) window.lucide.createIcons();
};

OL._openIconPicker = function(typeKey) {
    // Deactivate all rows
    document.querySelectorAll('.type-editor-row').forEach(r => r.classList.remove('icon-picker-active'));
    
    // Activate this row
    const row = document.getElementById(`type-row-${typeKey}`);
    if (row) {
        row.classList.add('icon-picker-active');
        row.style.background = 'rgba(var(--accent-rgb), 0.05)';
        row.style.borderRadius = '6px';
    }
};

OL.renderHierarchySelectors = function (res, isVault) {
    const data = OL.getCurrentProjectData();
    const stages = data.stages || [];
    
    // Find any workflows (Resources typed as 'Workflow') 
    // to populate the parent workflow dropdown
    const workflows = (data.resources || []).filter(r => 
        String(r.type).toLowerCase() === 'workflow' && r.id !== res.id
    );

    return `
        <div class="hierarchy-selectors">
            <div class="form-group">
                <label class="tiny-label">Process Stage</label>
                <select class="modal-input tiny" 
                        onchange="OL.updateResourceMeta('${res.id}', 'stageId', this.value)">
                    <option value="">-- No Stage --</option>
                    ${stages.map(s => `
                        <option value="${s.id}" ${res.stageId === s.id ? "selected" : ""}>
                            ${esc(s.name)}
                        </option>
                    `).join("")}
                </select>
            </div>

            <div class="form-group">
                <label class="tiny-label">Parent Workflow</label>
                <select class="modal-input tiny" 
                        onchange="OL.updateResourceMeta('${res.id}', 'parentId', this.value)">
                    <option value="">-- Standalone --</option>
                    ${workflows.map(w => `
                        <option value="${w.id}" ${res.parentId === w.id ? "selected" : ""}>
                            ${esc(w.name)}
                        </option>
                    `).join("")}
                </select>
            </div>
        </div>
    `;
};

window.getAllIncomingLinks = function(targetResId, allResources) {
    const links = [];
    const targetIdStr = String(targetResId);

    allResources.forEach(res => {
        // 1. Check Step-Level Logic (Level 3)
        if (res.steps) {
            res.steps.forEach((step, sIdx) => {
                if (step.logic && step.logic.out) {
                    step.logic.out.forEach(outbound => {
                        // Check if the targetId starts with our resource ID
                        if (outbound.targetId && String(outbound.targetId).startsWith(targetIdStr)) {
                            links.push({
                                id: res.id,
                                name: res.name,
                                type: res.type || 'Resource',
                                context: 'Logic Link',
                                rule: outbound.rule || 'Direct'
                            });
                        }
                    });
                }
            });
        }

        // 2. Check Outcome-Level Links (Level 2)
        if (res.outcomes) {
            res.outcomes.forEach(outcome => {
                const tid = outcome.targetId || outcome.toId;
                if (String(tid) === targetIdStr) {
                    links.push({
                        id: res.id,
                        name: res.name,
                        type: res.type || 'Resource',
                        context: 'Flow Outcome',
                        rule: outcome.label || 'Next Step'
                    });
                }
            });
        }

        // 3. Check Parent/Child Leash Links
        if (String(res.parentId) === targetIdStr) {
            links.push({
                id: res.id,
                name: res.name,
                type: res.type || 'Resource',
                context: 'Sub-Process',
                rule: 'Child of'
            });
        }
    });

    // Deduplicate: If multiple steps link to the same card, just show the card once
    const uniqueLinks = [];
    const seen = new Set();
    links.forEach(l => {
        if (!seen.has(l.id)) {
            uniqueLinks.push(l);
            seen.add(l.id);
        }
    });

    return uniqueLinks;
};

window.renderSopStepList = function(res) {
    const steps = res.steps || [];
    
    let html = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
            <label class="tiny muted bold uppercase" style="letter-spacing:1px; font-size:10px;">Step Sequence</label>
            <span class="tiny muted" style="font-size:9px; opacity:0.6;">💡 Drag items to re-order steps instantly</span>
        </div>
    `;

    if (steps.length === 0) {
        return html + `<div class="empty-hint p-10" style="text-align:center; opacity:0.5; font-size:11px; padding:20px;">No steps defined. Click Add Step to build your sequence.</div>`;
    }

    html += steps.map((step, idx) => {
        const outRules = (step.logic?.out || []).filter(l => l.targetId);
        const hasLinks = step.links?.length > 0;

        const icons = [];
        if (outRules.some(l => l.type === 'loop'))      icons.push('↺');
        if (outRules.some(l => l.type === 'delay'))     icons.push('⏱');
        if (outRules.some(l => l.type === 'condition') || outRules.length > 1) icons.push('◆');
        else if (outRules.length === 1 && !icons.length) icons.push('→');
        
        const logicIcon = icons.map(ic =>
            `<span class="pill tiny accent" style="font-size:8px; padding:1px 5px; background:rgba(61,217,197,0.1); color:#3dd9c5; border:1px solid rgba(61,217,197,0.2); font-weight:bold;">${ic}</span>`
        ).join('');

        return `
            <div style="margin-bottom:6px; border:1px solid var(--line); border-radius:6px; overflow:hidden;">
                <div class="v2-step-item sop-step-row"
                     draggable="true"
                     ondragstart="OL.handleStepDragStart(event, '${res.id}', ${idx})"
                     ondragover="event.preventDefault(); event.stopPropagation(); this.classList.add('drag-over')"
                     ondragleave="this.classList.remove('drag-over')"
                     ondrop="this.classList.remove('drag-over'); OL.handleStepDrop(event, '${res.id}', ${idx})"
                     style="display:flex; align-items:center; gap:10px; padding:10px 12px; user-select:none;">
                    
                    <span class="drag-handle" style="cursor:grab; opacity:0.3; font-size:14px;">⠿</span>
                    <div class="step-number-circle" style="width:20px; height:20px; font-size:10px; flex-shrink:0;
                         background:rgba(255,255,255,0.05); border:1px solid var(--line); color:var(--text-muted);
                         display:flex; align-items:center; justify-content:center; border-radius:50%; font-weight:bold;">
                        ${idx + 1}
                    </div>
                    
                    <div style="flex:1; min-width:0; cursor:pointer;"
                         onclick="event.stopPropagation(); OL.toggleInlineStepEditor('${res.id}', '${step.id}')">
                        <div class="bold" style="font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                            ${esc(step.name || 'Untitled Step')}
                        </div>
                        <div style="display:flex; gap:4px; align-items:center; margin-top:2px; flex-wrap:wrap;">
                            ${step.appName ? `<span class="tiny accent" style="font-size:9px;">${esc(step.appName)}</span>` : ''}
                            ${logicIcon}
                            ${hasLinks ? `<span class="pill tiny soft" style="font-size:7px; padding:0 3px;">
                                <i data-lucide="link-2" style="width:8px; height:8px;"></i>
                            </span>` : ''}
                        </div>
                    </div>
                    
                    <div style="display:flex; align-items:center; gap:6px; flex-shrink:0;">
                        <button class="btn tiny soft" onclick="event.stopPropagation(); OL.toggleInlineStepEditor('${res.id}', '${step.id}')"
                                style="font-size:10px; padding:3px 8px; display:flex; align-items:center; gap:4px;">
                            <i data-lucide="sliders-horizontal" style="width:11px; height:11px; opacity:0.6;"></i> Configure
                        </button>
                        <button onclick="event.stopPropagation(); OL.deleteStep('${res.id}','${step.id}')"
                                style="width:20px; height:20px; border:none; background:none; cursor:pointer;
                                       color:var(--text-muted); display:flex; align-items:center; justify-content:center;
                                       border-radius:4px; transition:all 0.15s;"
                                onmouseover="this.style.color='#ef4444'; this.style.background='rgba(239,68,68,0.05)';"
                                onmouseout="this.style.color='var(--text-muted)'; this.style.background='none';">
                            <i data-lucide="trash-2" style="width:12px; height:12px;"></i>
                        </button>
                    </div>
                </div>
                
                <div id="fvi-inline-step-editor-${step.id}" 
                     style="display:none; border-top:1px solid var(--line); padding:15px;"></div>
            </div>
        `;
    }).join('');

    return html;
};
OL.toggleInlineStepEditor = function(resId, stepId) {
    const drawer = document.getElementById(`fvi-inline-step-editor-${stepId}`);
    if (!drawer) return;

    const isOpen = drawer.style.display === 'block';

    document.querySelectorAll('.inline-step-sub-drawer, [id^="fvi-inline-step-editor-"]').forEach(el => {
        if (el.id !== `fvi-inline-step-editor-${stepId}`) {
            el.style.display = 'none';
            el.innerHTML = '';
        }
    });

    if (isOpen) {
        drawer.style.display = 'none';
        drawer.innerHTML = '';
        return;
    }

    const data = OL.getCurrentProjectData();
    const res  = (data.resources || []).find(r => String(r.id) === String(resId));
    const step = res?.steps?.find(s => String(s.id) === String(stepId));
    if (!step) return;

    if (!step.logic) step.logic = { in: [], out: [] };
    if (!step.assignees) step.assignees = [];

    drawer.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:12px;">
            <div>
                <label class="modal-section-label">Move to resource</label>
                <select class="modal-input tiny" style="width:100%;"
                        onchange="if(this.value) OL.executeStepMove('${resId}', '${stepId}', this.value); this.value='';">
                    <option value="">— Keep in ${esc(res?.name || 'current resource')} —</option>
                    <optgroup label="Same stage">
                        ${(OL.getCurrentProjectData().resources || [])
                            .filter(r => String(r.id) !== String(resId) && r.stageId === res?.stageId)
                            .sort((a,b) => a.name.localeCompare(b.name))
                            .map(r => `<option value="${r.id}">${esc(r.name)} (${(r.steps||[]).length} steps)</option>`)
                            .join('')}
                    </optgroup>
                    <optgroup label="All resources">
                        ${(OL.getCurrentProjectData().resources || [])
                            .filter(r => String(r.id) !== String(resId) && r.stageId !== res?.stageId)
                            .sort((a,b) => a.name.localeCompare(b.name))
                            .map(r => `<option value="${r.id}">${esc(r.name)} (${(r.steps||[]).length} steps)</option>`)
                            .join('')}
                    </optgroup>
                </select>
            </div>
            <div>
                <label class="modal-section-label">Primary App</label>
                ${step.appId ? `
                    <div style="display:flex; align-items:center; justify-content:space-between; padding:6px 10px;
                                background:rgba(255,255,255,0.04); border:1px solid var(--line); border-radius:6px;">
                        <span style="font-size:12px;">
                            <i data-lucide="${a.type === 'person' ? 'user' : a.type === 'app' ? 'smartphone' : 'users'}" 
                           style="width:10px; height:10px;"></i>
                        ${esc(a.name)}</span>
                        <i data-lucide="x" class="is-clickable" style="width:12px; height:12px; opacity:0.4;"
                           onclick="event.stopPropagation(); OL.updateAppMetadataInline('${resId}', '${stepId}', null, null)"></i>
                    </div>
                ` : `
                    <div style="position:relative;">
                        <input type="text" class="modal-input tiny" style="width:100%; box-sizing:border-box; margin:0;"
                               placeholder="Search apps..."
                               onfocus="OL.filterInlineAppSearch('${resId}', '${stepId}', '')"
                               oninput="OL.filterInlineAppSearch('${resId}', '${stepId}', this.value)">
                        <div id="inline-app-results-${stepId}" class="search-results-overlay"></div>
                    </div>
                `}
            </div>
    
            <div>
                <label class="modal-section-label">Assigned To</label>
                <div style="display:flex; flex-wrap:wrap; gap:4px; margin-bottom:6px;">
                    ${step.assignees.length > 0 ? step.assignees.map((a, i) => `
                        <span class="pill tiny soft" style="display:inline-flex; align-items:center; gap:4px;">
                            ${esc(a.name)}
                            <b style="cursor:pointer; opacity:0.5;"
                               onclick="event.stopPropagation(); OL.removeInlineAssignee('${resId}', '${stepId}', ${i})">×</b>
                        </span>
                    `).join('') : ''}
                </div>
                <div style="position:relative;">
                    <input type="text" class="modal-input tiny" style="width:100%; box-sizing:border-box; margin:0;"
                           placeholder="Add assignee..."
                           onfocus="OL.filterInlineAssignmentSearch('${resId}', '${stepId}', '')"
                           oninput="OL.filterInlineAssignmentSearch('${resId}', '${stepId}', this.value)">
                    <div id="inline-assign-results-${stepId}" class="search-results-overlay"></div>
                </div>
            </div>
    
            <div style="display:flex; align-items:center; gap:10px;">
                <label class="modal-section-label" style="margin:0; white-space:nowrap;">Timing offset</label>
                <input type="number" class="modal-input tiny" style="width:60px; margin:0;" value="${step.timingValue || 0}"
                       onblur="OL.updateAtomicStep('${resId}', '${stepId}', 'timingValue', parseInt(this.value) || 0)">
                <span class="tiny muted">days after previous</span>
            </div>
    
            <div>
                <label class="modal-section-label">Outbound logic</label>
                <div style="display:flex; flex-direction:column; gap:6px;">
                    ${(step.logic.out || []).map((l, i) => OL.renderLogicBlock(resId, stepId, 'out', i, l, [])).join('')}
                </div>
                <button class="btn tiny soft" style="margin-top:6px; display:inline-flex; align-items:center; gap:4px;"
                        onclick="event.stopPropagation(); OL.addInlineStepLogic('${resId}', '${stepId}', 'out')">
                    <i data-lucide="plus" style="width:11px; height:11px;"></i> Add output path
                </button>
            </div>
    
        </div>
    `;
    drawer.style.display = 'block';
    if (window.lucide) lucide.createIcons();
};

OL.filterInlineAppSearch = function(resId, stepId, query) {
    const overlay = document.getElementById(`inline-app-results-${stepId}`);
    if (!overlay) return;
    const q = (query || '').toLowerCase().trim();
    const client = getActiveClient();
    const matches = (client?.projectData?.localApps || []).filter(a => a.name.toLowerCase().includes(q));
    overlay.innerHTML = matches.length 
        ? matches.map(app => `
            <div class="search-result-item"
                 onmousedown="event.preventDefault(); OL.updateAppMetadataInline('${resId}', '${stepId}', '${app.id}', '${esc(app.name)}')">
                💻 ${esc(app.name)}
            </div>`).join('')
        : '<div class="p-10 tiny muted">No tools found.</div>';
    overlay.style.display = 'block';
};

OL.filterInlineAssignmentSearch = function(resId, stepId, query) {
    const overlay = document.getElementById(`inline-assign-results-${stepId}`);
    if (!overlay) return;
    const q = (query || '').toLowerCase().trim();
    const matches = OL.getFilteredAssigneeOptions(q);
    overlay.innerHTML = matches.length
        ? matches.map(item => `
            <div class="search-result-item"
                 onmousedown="event.preventDefault(); OL.addInlineAssignee('${resId}', '${stepId}', '${item.id}', '${esc(item.name)}', '${item.type}')">
                ${item.icon} ${esc(item.name)}
            </div>`).join('')
        : '<div class="p-10 tiny muted">No matches found.</div>';
    overlay.style.display = 'block';
};

OL.updateAppMetadataInline = function(resId, stepId, appId, appName) {
    const data = OL.getCurrentProjectData();
    const res  = (data.resources || []).find(r => String(r.id) === String(resId));
    const step = res?.steps?.find(s => String(s.id) === String(stepId));
    if (!step) return;
    step.appId   = appId;
    step.appName = appName;
    OL.persist();
    OL.toggleInlineStepEditor(resId, stepId);
    OL.toggleInlineStepEditor(resId, stepId);
};

OL.addInlineAssignee = function(resId, stepId, assigneeId, assigneeName, type) {
    const data = OL.getCurrentProjectData();
    const res  = (data.resources || []).find(r => String(r.id) === String(resId));
    const step = res?.steps?.find(s => String(s.id) === String(stepId));
    if (!step) return;
    if (!step.assignees) step.assignees = [];
    if (!step.assignees.some(a => a.id === assigneeId)) {
        step.assignees.push({ id: assigneeId, name: assigneeName, type });
        OL.persist();
    }
    OL.toggleInlineStepEditor(resId, stepId);
    OL.toggleInlineStepEditor(resId, stepId);
};

OL.removeInlineAssignee = function(resId, stepId, idx) {
    const data = OL.getCurrentProjectData();
    const res  = (data.resources || []).find(r => String(r.id) === String(resId));
    const step = res?.steps?.find(s => String(s.id) === String(stepId));
    if (!step?.assignees) return;
    step.assignees.splice(idx, 1);
    OL.persist();
    OL.toggleInlineStepEditor(resId, stepId);
    OL.toggleInlineStepEditor(resId, stepId);
};

OL.addInlineStepLogic = function(resId, stepId, direction) {
    const data = OL.getCurrentProjectData();
    const res  = (data.resources || []).find(r => String(r.id) === String(resId));
    const step = res?.steps?.find(s => String(s.id) === String(stepId));
    if (!step) return;
    if (!step.logic) step.logic = { in: [], out: [] };
    step.logic[direction].push({ type: 'next', targetId: null, rule: '' });
    OL.persist();
    OL.toggleInlineStepEditor(resId, stepId);
    OL.toggleInlineStepEditor(resId, stepId);
};
        
OL.deleteStep = function(resId, stepId) {
    if (!confirm('Delete this step?')) return;
    const data = OL.getCurrentProjectData();
    // Try both keys since your app uses localResources in some places
    const allRes = [...(data.resources || []), ...(data.localResources || [])];
    const res = allRes.find(r => String(r.id) === String(resId));
    if (!res) { console.error('Resource not found:', resId); return; }
    const before = res.steps?.length;
    res.steps = (res.steps || []).filter(s => String(s.id) !== String(stepId));
    console.log(`Deleted step ${stepId} from ${res.name}: ${before} → ${res.steps.length}`);
    OL.persist();
    OL.openResourceModal(resId);
};

OL.addStepLogic = function(resId, stepId, dir) {
    const data = OL.getCurrentProjectData();
    const res  = (data.resources || []).find(r => String(r.id) === String(resId));
    const step = res?.steps?.find(s => String(s.id) === String(stepId));
    if (!step) return;
    if (!step.logic) step.logic = { in: [], out: [] };
    if (!step.logic[dir]) step.logic[dir] = [];

    // Auto-fill next sequential step as default target
    let defaultTargetId = '';
    if (dir === 'out') {
        const stepIdx = res.steps.indexOf(step);
        const nextStep = res.steps[stepIdx + 1];
        if (nextStep) defaultTargetId = `${resId}-${nextStep.id}`;
    }

    step.logic[dir].push({
        type: 'next',
        targetId: defaultTargetId,
        rule: '',
        loopLimit: '',
        delayValue: '',
        delayUnit: 'days'
    });

    OL.persist();
    OL._fvRefreshInspector(resId, stepId);
};

OL.goToStepFromLibrary = function(resId, stepId) {
    // 1. Detect if we are currently in the Vault/Master view
    const isVaultMode = window.location.hash.includes('vault');
    
    // 2. Close the current Modal
    OL.closeModal();

    // 3. Set the Map focus in memory
    state.focusedResourceId = resId;
    sessionStorage.setItem('active_resource_id', resId);
    
    // 4. Save the return path so the "Back" button works later
    sessionStorage.setItem('map_return_path', window.location.hash.split('?')[0]);

    // 5. Navigate to the CORRECT Map based on context
    if (isVaultMode) {
        window.location.hash = '#/vault/visualizer';
    } else {
        window.location.hash = '#/visualizer';
    }

    // 6. Wait for the map to render, then snap to node and open sidebar
    setTimeout(() => {
        // Ensure the visualizer renders the correct context
        if (typeof OL.renderVisualizer === 'function') {
            OL.renderVisualizer(isVaultMode);
        }

        if (typeof OL.centerCanvasNode === 'function') {
            OL.centerCanvasNode(resId);
        }
        
        // Open the Inspector for the specific step
        OL.openInspector(resId, stepId);
    }, 150);
};

// 1. Add New Type
OL.addNewResourceTypeFlat = function () {
    const input = document.getElementById('new-type-input');
    const iconInput = document.getElementById('new-type-icon'); // 🚀 Capture the emoji input
    
    const val = (input.value || "").trim();
    const iconVal = (iconInput.value || "⚙️").trim(); // Fallback to gear

    if (!val || val.toLowerCase() === "general") return;

    const typeKey = val.toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (!state.master.resourceTypes) state.master.resourceTypes = [];
    
    // Check for duplicates
    if (state.master.resourceTypes.some(t => t.typeKey === typeKey)) {
        return alert("Type already exists.");
    }

    // 1. Add to Registry with Icon
    state.master.resourceTypes.push({ 
        type: val, 
        typeKey: typeKey,
        icon: iconVal // 🚀 Save the icon here
    });

    // 2. Create default base rate in Pricing Library
    const safeKey = typeKey + "_" + Date.now().toString().slice(-4);
    if (!state.master.rates.variables) state.master.rates.variables = {};
    state.master.rates.variables[safeKey] = {
        id: safeKey,
        label: `${val} Base Rate`,
        value: 150,
        applyTo: val,
        category: "Resource Rates"
    };

    // 3. Persist and Refresh
    OL.persist();
    OL.openResourceTypeManager(); // Keep the modal open
    OL.renderVisualizer(location.hash.includes('vault')); // Update the Sidebar icons
};

// 2. Rename Type System-Wide
OL.renameResourceTypeFlat = function (oldNameEncoded, newName) {
    const oldName = atob(oldNameEncoded);
    const cleanNewName = (newName || "").trim();
    if (!cleanNewName || oldName === cleanNewName) return;

    const newKey = cleanNewName.toLowerCase().replace(/[^a-z0-9]+/g, "");

    // Update Registry
    state.master.resourceTypes.forEach(t => {
        if (t.type === oldName) {
            t.type = cleanNewName;
            t.typeKey = newKey;
        }
    });

    // Update all matching Variables in Rates
    if (state.master.rates?.variables) {
        Object.values(state.master.rates.variables).forEach(v => {
            if (v.applyTo === oldName) v.applyTo = cleanNewName;
        });
    }

    // Update all matching Resources (Vault + Clients)
    const allResources = [
        ...(state.master.resources || []),
        ...Object.values(state.clients).flatMap(c => c.projectData?.localResources || [])
    ];
    allResources.forEach(r => {
        if (r.type === oldName) {
            r.type = cleanNewName;
            r.typeKey = newKey;
        }
    });

    OL.persist();
    console.log(`✅ Renamed type: ${oldName} -> ${cleanNewName}`);
};

// 3. Add Icon
OL.updateResourceTypeProp = function(typeKey, prop, value) {
    const registry = state.master.resourceTypes || [];
    const entry = registry.find(t => t.typeKey === typeKey);
    if (entry) {
        entry[prop] = value;
        OL.persist();

        // Live update the icon preview in the modal if it's open
        if (prop === 'lucideIcon') {
            const preview = document.getElementById(`type-icon-preview-${typeKey}`);
            if (preview) {
                preview.innerHTML = `<i data-lucide="${value}" style="width:16px; height:16px; color:var(--accent);"></i>`;
                if (window.lucide) lucide.createIcons();
            }
            // Deactivate picker state
            document.querySelectorAll('.type-editor-row').forEach(r => {
                r.classList.remove('icon-picker-active');
                r.style.background = '';
                r.style.borderRadius = '';
            });
        }
    }
};

//4. Remove Type
OL.removeRegistryTypeByKey = function (typeKey) {
  if (!confirm(`Delete "${typeKey}" type? Resources will reset to "General".`))
    return;

  if (state.master.resourceTypes) {
    state.master.resourceTypes = state.master.resourceTypes.filter(
      (r) => r.typeKey !== typeKey,
    );
  }

  const resources = window.location.hash.includes("vault")
    ? state.master.resources
    : getActiveClient()?.projectData?.localResources;
  (resources || []).forEach((r) => {
    if (
      r.typeKey === typeKey ||
      r.type?.toLowerCase().replace(/[^a-z0-9]+/g, "") === typeKey
    ) {
      r.type = "General";
      r.typeKey = "general";
    }
  });

  if (state.master.rates?.variables) {
    Object.keys(state.master.rates.variables).forEach((id) => {
      if (
        state.master.rates.variables[id].applyTo
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "") === typeKey
      )
        delete state.master.rates.variables[id];
    });
  }
  OL.persist();
  OL.openResourceTypeManager();
};

OL.closeResourceTypeManager = function() {
    OL.closeModal(); // Closes the Type Manager modal layer
    
    // Check if a Resource Modal was open underneath
    const modalBox = document.getElementById('active-modal-box');
    if (modalBox) {
        const activeId = modalBox.dataset.activeId; // From Piece 117
        if (activeId) {
            console.log("♻️ Refreshing type list for resource:", activeId);
            OL.openResourceModal(activeId); // Refresh the modal to show new types
        }
    }
};

//================RESOURCE CARD AND MODAL===================//

// 2. RESOURCE CARD AND MODAL
window.renderResourceCard = function (res) {
    if (!res) return "";
    
    // 1. Resolve Live Scoping Data
    const scopeData = OL.getScopingDataForResource(res.id);
    const isMaster = String(res.id || "").startsWith("res-vlt-") || !!res.masterRefId;
    const isActive = state.focusedResourceId === res.id;

    // 2. Map Status to Colors (Matching the Scoping Sheet)
    const statusColors = { 
        'Do Now': '#38bdf8',    // Cyan
        'Done': '#22c55e',      // Green
        'Do Later': '#fbbf24',  // Amber
        "Don't Do": '#ef4444',  // Red
        'Default': 'var(--color-scoping)' 
    };
    
    const statusColor = scopeData ? (statusColors[scopeData.status] || statusColors.Default) : 'transparent';

    // 3. 👨‍👩‍👧‍👦 Family Number: Count instances specifically on the Canvas layer
    const numberingHtml = OL.getPartNumberHtml ? OL.getPartNumberHtml(res) : '';

    const tagStyle = isMaster 
        ? "background: var(--accent); color: #000;" 
        : "background: var(--panel-border); color: var(--text-dim); border: 1px solid var(--line);";

    return `
        <div class="card is-clickable ${scopeData ? 'is-priced' : ''} ${isActive ? 'is-active' : ''}" 
             id="res-card-${res.id}"
             onclick="OL.selectResourceCard('${res.id}')"
             style="${scopeData ? `border-left: 4px solid ${statusColor} !important;` : ''} opacity:${res.isArchived ? '0.5' : '1'};">
            
            <div class="card-header" style="display:flex; justify-content: space-between; align-items: flex-start;">
                <div class="card-title" style="flex:1; font-weight:600;">${esc(res.name || "Unnamed")}</div>
                
                <div class="card-controls" style="display:flex; align-items:center; gap:6px;">
                        ${numberingHtml}
                        
                        <span class="vault-tag" style="${tagStyle} padding: 2px 6px; font-size: 8px; border-radius: 3px; font-weight: bold;">
                            ${isMaster ? 'MASTER' : 'LOCAL'}
                        </span>
                        ${res.isArchived ? `<span style="font-size:8px;font-weight:700;padding:2px 6px;border-radius:3px;background:rgba(239,68,68,0.1);color:#ef4444;border:1px solid rgba(239,68,68,0.3);">📦 Archived</span>` : ''}
                        <button class="card-delete-btn" 
                                onclick="event.stopPropagation(); OL.handleResourceSave('${res.id}', 'isArchived', ${!res.isArchived}); renderResourceManager();"
                                title="${res.isArchived ? 'Unarchive' : 'Archive'}"
                                style="color:${res.isArchived ? '#ef4444' : 'var(--text-muted)'};">
                            <i data-lucide="archive" style="width:12px;height:12px;"></i>
                        </button>
                        ${res.isLocked ? '' : `<button class="card-delete-btn" onclick="event.stopPropagation(); OL.universalDelete('${res.id}', 'resources')">×</button>`}
                    </div>            
                </div>
            <div class="card-body" style="margin-top: 6px;">
                <div style="display:flex; justify-content:space-between; align-items:flex-end;">
                    <div>
                        <div class="tiny accent bold uppercase" style="font-size: 8px; letter-spacing: 0.5px; opacity: 0.8;">
                            ${esc(res.archetype || "Base")}
                        </div>
                        <div class="tiny muted" style="font-size:10px; opacity:0.6; display:flex; align-items:center; gap:4px;">
                            ${OL.getLucideSVG(OL.getRegistryIcon(res.type), 11, 'currentColor')}
                            ${esc(res.type || 'General')}
                        </div>
                    </div>

                    ${scopeData ? `
                    <div style="display:flex; flex-direction:column; align-items:flex-end; gap:3px;">
                        <div class="pill tiny" style="background:${statusColor}22; color:${statusColor}; border:1px solid ${statusColor}44; font-size:8px; font-weight:bold; padding: 1px 5px;">
                            ${(scopeData.status || "PENDING").toUpperCase()}
                        </div>
                        <div class="tiny muted bold" style="font-size: 8px; opacity: 0.5; display:flex; align-items:center; gap:3px;">
                            <i data-lucide="user" style="width:9px; height:9px;"></i>
                            ${esc(scopeData.responsibleParty || 'TBD')}
                        </div>
                    </div>
                ` : `
                    <div class="tiny muted italic" style="font-size: 8px; opacity: 0.3;">Not Scoped</div>
                `}
                </div>
            </div>
        </div>
    `;
};
OL.selectResourceCard = function(resId) {
    // 1. Update Global State
    state.focusedResourceId = resId;

    // 2. Clear previous active states in the DOM
    document.querySelectorAll('.card.is-active').forEach(card => card.classList.remove('is-active'));

    // 3. Add active state to the clicked card
    const selectedCard = document.getElementById(`res-card-${resId}`);
    if (selectedCard) {
        selectedCard.classList.add('is-active');
    }

    // 4. Trigger your existing Modal or Inspector
    OL.openResourceModal(resId);
};
// 3. CREATE DRAFT RESOURCE MODAL

// 3a. HANDLE THE FIRST UPDATE / SAVE DRAFT
OL.updateResourceMeta = function (resId, key, value) {
    const idStr = String(resId);
    let target = null;

    // 1. Resolve Target
    if (idStr.startsWith('res-vlt-')) {
        target = state.master.resources.find(r => r.id === resId);
    } else {
        const client = getActiveClient();
        target = client?.projectData?.localResources?.find(r => r.id === resId);
    }

    if (target) {
        target[key] = value;

        // 🚀 THE REACTIVE LOGIC:
        // If we changed the type, we must update the Archetype metadata 
        // from the registry to ensure the correct inputs show up.
        if (key === 'type') {
            const registryEntry = state.master.resourceTypes.find(t => t.type === value);
            if (registryEntry) {
                target.archetype = registryEntry.archetype || "Base";
            }
        }

        OL.persist();
        
        // 2. Refresh the Modal instantly to show new variables/archetype fields
        OL.openResourceModal(resId);
        
        // 3. Refresh the Background Grid so the card face updates
        renderResourceManager();
        
        console.log(`✅ Resource ${resId} updated: ${key} = ${value}`);
    }
};

OL.handleResourceHeaderBlur = function(id, name) {
    const cleanName = name.trim();
    if (!cleanName) return;

    const isDraft = id.startsWith('draft-');
    const isVault = window.location.hash.includes('vault');

    if (isDraft) {
        // Route to the committer for new items
        OL.commitDraftToSystem(id, cleanName, isVault ? 'vault' : 'project');
    } else {
        // Standard meta update for existing items
        OL.updateResourceMeta(id, 'name', cleanName);
    }
};

OL.handleModalSave = async function(id, nameOrContext) {
    const input = document.getElementById('modal-res-name');
    const typeSelector = document.getElementById('res-type-selector');
    
    // Safety guard for Team Members or Steps (which have their own save logic)
    if (id.includes('tm-') || id.includes('step')) return;
    
    const cleanName = input ? input.value.trim() : (typeof nameOrContext === 'string' ? nameOrContext.trim() : "");
    const selectedType = typeSelector ? typeSelector.value : "General";

    // Prevent context strings from being saved as names
    if (!cleanName || cleanName.toLowerCase() === 'vault' || cleanName.toLowerCase() === 'project') {
        if (!input) return; 
    }

    const isDraft = id.startsWith('draft-');
    const isVault = window.location.hash.includes('vault');

    if (isDraft) {
        const timestamp = Date.now();
        const newId = isVault ? `res-vlt-${timestamp}` : `local-prj-${timestamp}`;
        
        const newRes = { 
            id: newId, 
            name: cleanName, 
            type: selectedType, 
            archetype: "Base",
            data: {},
            steps: [],
            triggers: [],
            createdDate: new Date().toISOString() 
        };

        await OL.updateAndSync(() => {
            if (isVault) {
                if (!state.master.resources) state.master.resources = [];
                state.master.resources.push(newRes);
            } else {
                const client = getActiveClient();
                if (client) {
                    if (!client.projectData.localResources) client.projectData.localResources = [];
                    client.projectData.localResources.push(newRes);
                }
            }
        });

        // 2. Open the modal with the permanent ID
        OL.openResourceModal(newId); 
        
        // 3. Redraw the background library
        renderResourceManager();
        
    } else {
        // Standard update for existing resources
        OL.updateResourceMeta(id, 'name', cleanName);
    }
};

// 3b. COMMIT THE RESOURCE
OL.commitDraftToSystem = async function (tempId, finalName, context, integrationData = null) {
    if (window._savingLock === tempId) return;
    window._savingLock = tempId;

    const isVault = (context === 'vault');
    const timestamp = Date.now();
    const newResId = isVault ? `res-vlt-${timestamp}` : `local-prj-${timestamp}`;

    // 🏗️ Build the Resource with atomized metadata
    const newRes = { 
        id: newResId, 
        name: finalName, 
        type: integrationData ? "Automation" : "General", // Categorize automatically
        archetype: integrationData ? "Integration" : "Base", 
        
        // 🚀 THE ATOMIZED DATA
        integration: integrationData ? {
            app: integrationData.app,       // e.g., "Stripe"
            verb: integrationData.verb,     // e.g., "Create"
            object: integrationData.object, // e.g., "Customer"
            fullEvent: integrationData.fullEvent
        } : null,

        data: {}, 
        steps: [],
        triggers: [],
        createdDate: new Date().toISOString() 
    };

    // Push to State (Your existing logic)
    if (isVault) {
        if (!state.master.resources) state.master.resources = [];
        state.master.resources.push(newRes);
    } else {
        const client = getActiveClient();
        if (client) {
            if (!client.projectData.localResources) client.projectData.localResources = [];
            client.projectData.localResources.push(newRes);
        }
    }

    await OL.persist(); // Or OL.updateAndSync()
    
    // UI Cleanup
    window._savingLock = null;
    OL.closeModal();
    
    // Force a re-render of the visualizer to show the new card
    if (OL.renderVisualizer) OL.renderVisualizer(isVault);
};

OL.getDraftById = function(id) {
    // This finds the draft object currently held in the modal's internal state
    // If you are using a global draft variable or passing it through, ensure it's accessible.
    // Most simply, we can check the active modal box dataset:
    const box = document.getElementById('active-modal-box');
    return box ? JSON.parse(box.dataset.draftSource || '{}') : null;
};

OL.getResourceById = function(id) {
    if (!id || id === "undefined" || id === "null") return null;
    
    // 1. Clean the ID
    let cleanId = String(id).replace(/^(empty-|link-)/, '');
    const isExplicitStepId = String(id).startsWith('step-');

    const client = getActiveClient();
    const globalState = window.state || OL.state;
    const isVault = location.hash.includes('vault');
    const sourceData = isVault ? globalState.master : (client?.projectData || {});

    // 2. Check Stages
    const stage = (sourceData.stages || []).find(s => String(s.id) === cleanId);
    if (stage) return stage;

    // 3. Check Master/Local Resources (The Library)
    const resourcePool = isVault ? (globalState.master?.resources || []) : (client?.projectData?.localResources || []);
    const resource = resourcePool.find(r => String(r.id) === cleanId);
    if (resource) return resource;

    // 4. Deep Search for Steps (ONLY if we aren't explicitly looking for a library resource)
    // If the renderer is asking for a 'resourceLinkId', we usually want to return null 
    // if it's not in the main pool, rather than returning a Step object.
    if (isExplicitStepId) {
        for (const res of resourcePool) {
            if (res.steps) {
                const nestedStep = res.steps.find(s => String(s.id) === cleanId.replace('step-', ''));
                if (nestedStep) return nestedStep;
            }
        }
    }

    return null; 
};

// 3c. OPEN RESOURCE MODAL
OL.openResourceModal = function (targetId, draftObj = null) {
    console.trace('🚨 openResourceModal called:', targetId);
    if (!state.v2) state.v2 = {}; 
    if (!state.v2.activeCommentTab) state.v2.activeCommentTab = 'internal';
    if (!targetId) return;

    const isAdmin = state.adminMode || window.FORCE_ADMIN;
    const isClientView = window.location.search.includes('access='); // 1. Context Detection
    const isVaultMode = window.location.hash.includes('vault');

    OL.trackNav(targetId, 'resource');
    let res = null;

    // 🚩 THE TRACKER: Save the current ID before switching to the new target
    const currentId = document.getElementById('active-modal-box')?.dataset?.activeResId;
    if (currentId && currentId !== targetId) {
        sessionStorage.setItem('lastActiveResourceId', currentId);
    }

    const hasHistory = JSON.parse(sessionStorage.getItem('ol_nav_history') || '[]').length > 1;

    const client = getActiveClient();
    const sheet = client?.projectData?.scopingSheets?.[0];
    
    let lineItem = null;

    // 1. DATA RESOLUTION
    if (draftObj) {
        res = draftObj;
    } else {
        lineItem = sheet?.lineItems.find(i => String(i.id) === String(targetId));
        const lookupId = lineItem ? lineItem.resourceId : targetId;
        res = OL.getResourceById(lookupId);
    }

    if (!res) return;
    const activeData = lineItem || res;

    // 🧠 2. AUTO-MAPPING LOGIC (The New Brain)
    const rawType = String(res.type || 'General');
    const typeDef = (state.master.resourceTypes || []).find(t => t.type.toLowerCase() === rawType.toLowerCase());

    const isLockedByType = !!(typeDef && typeDef.matchedFunctionId);
    const isLockedByManual = !!res.matchedFunctionId;
    const isZap = rawType.toLowerCase() === 'zap';
    const isCompliance = res.name === "Compliance Documents" || res.isContainer;
    const isNaming = res.name === "Naming Conventions";
    const isHierarchy = res.name === "Folder Hierarchy";

    const allowedWorkflowTypes = ['workflow', 'zap', 'email campaign'];
    const showWorkflowSteps = allowedWorkflowTypes.includes(String(res.type || '').toLowerCase());

    // 1. Identify what the "Standard" tool should be
    const autoApp = (isLockedByType || isLockedByManual) && !isZap ? OL.getAppByFunction(rawType, res.matchedFunctionId) : null;

    // 🎯 2. THE OVERRIDE PROTECTION
    // We ONLY auto-assign if the field is currently EMPTY. 
    // If you manually picked an app, res.appId is no longer null, so this block is skipped.
    if (autoApp && !res.appId) {
        console.log(`🤖 Auto-assigning ${autoApp.name} to ${res.name}`);
        res.appId = autoApp.id;
        res.appName = autoApp.name;
        
        // Silent save to persist the auto-suggestion
        OL.handleResourceSave(res.id, 'appId', autoApp.id);
        OL.handleResourceSave(res.id, 'appName', autoApp.name);
    }

    // 3. Determine UI state for the pill
    const isManualOverride = res.appId && autoApp && String(res.appId) !== String(autoApp.id);
        
        // 🚀 THE SIMPLIFIED CHECK
    // 1. Is the user an admin? (Checks both state and URL)
    const userIsAdmin = state.adminMode || window.location.search.includes('admin=');

    // 2. Is it currently a Master item? (If so, hide button)
    const isAlreadyMaster = String(res.id).startsWith('res-vlt-') || !!res.masterRefId;

    // 3. Show button if Admin AND not already Master
    const canPromote = userIsAdmin && !isAlreadyMaster;
       
    // --- 🏷️ NEW: PILL & TAG UI ---
    // This replaces the dropdown with compact inline tags
    const originPill = `
        <span class="pill tiny ${isAlreadyMaster ? 'vault' : 'local' }" 
              style="display:flex; align-items:center; gap:4px; font-size: 9px; padding: 2px 8px; border-radius: 100px; text-transform: uppercase; font-weight: 700; border: 1px solid rgba(255,255,255,0.1);">
            <i data-lucide="${isAlreadyMaster ? 'shield-check' : 'map-pin'}" style="width:10px; height:10px;"></i>
            ${isAlreadyMaster ? 'Master' : 'Local' }
        </span>`;
    
    const typePill = `
        <div style="position: relative; display: inline-block;">
            <span class="pill tiny soft is-clickable" 
                  onclick="document.getElementById('res-type-selector').click()"
                  style="display:flex; align-items:center; gap:4px; font-size: 9px; padding: 2px 8px; border-radius: 100px; text-transform: uppercase; cursor: pointer; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2);">
                <i data-lucide="${OL.getRegistryIcon(res.type)}" style="width:10px; height:10px;"></i>
                ${esc(res.type || 'General')} <i data-lucide="chevron-down" style="width:10px; height:10px;"></i>
            </span>
            <select id="res-type-selector" 
                    style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer;"
                    onchange="OL.updateResourceMeta('${res.id}', 'type', this.value); OL.openResourceModal('${res.id}')">
                <option value="General">General</option>
                ${(state.master.resourceTypes || []).map(t => `
                    <option value="${esc(t.type)}" ${res.type === t.type ? "selected" : ""}>${esc(t.type)}</option>
                `).join("")}
            </select>
        </div>`;
    
      // 🎯 NEW: AUTO-MAPPING SECTION
      const appMappingHtml = `
        <div style="display:flex;align-items:center;justify-content:space-between;
                    padding:10px 14px;border:1px solid var(--line);border-radius:8px;margin-bottom:16px;">
            <label class="modal-section-label" style="margin:0;display:flex;align-items:center;gap:6px;">
                <i data-lucide="smartphone" style="width:12px;height:12px;"></i> PRIMARY APPLICATION
                ${isManualOverride ? '<span class="tiny accent bold" style="font-size:8px;margin-left:6px;">CUSTOM OVERRIDE</span>' : ''}
            </label>
            <div style="display:flex;align-items:center;gap:8px;">
                ${isZap ? `
                    <span class="pill soft tiny muted" style="display:flex;align-items:center;gap:4px;">
                        <i data-lucide="zap" style="width:10px;height:10px;"></i> Multi-App
                    </span>
                ` : res.appId ? `
                    <span class="pill ${isManualOverride ? 'accent' : 'primary'}" style="display:flex;align-items:center;gap:6px;">
                        <i data-lucide="${isManualOverride ? 'edit-3' : 'bot'}" style="width:11px;height:11px;"></i>
                        ${esc(res.appName)}
                        <i data-lucide="x" class="is-clickable" style="width:11px;height:11px;opacity:0.5;"
                           onclick="OL.handleResourceSave('${res.id}','appId',null);OL.handleResourceSave('${res.id}','appName',null);OL.openResourceModal('${res.id}')"></i>
                    </span>
                ` : `
                    <div style="position:relative;">
                        <input type="text" class="modal-input tiny" style="width:180px;" placeholder="Search apps..."
                               onfocus="OL.filterAppSearch('${res.id}',null,true,'')"
                               oninput="OL.filterAppSearch('${res.id}',null,true,this.value)">
                        <div id="res-app-results" class="search-results-overlay"></div>
                    </div>
                `}
            </div>
        </div>
    `;

    // Back button to go back to flow map if jumped from scope button
    const backBtn = state.v2.returnTo ? `
        <button class="btn-back-to-flow" onclick="OL.returnToFlow()">
            ⬅ Back to Flow
        </button>
    ` : '';

    // --- SECTION: INCOMING LINKS ---
      const allResources = isVaultMode ? state.master.resources : (client?.projectData?.localResources || []);
      const allConnections = getAllIncomingLinks(res.id, allResources);
      
      // State for filtering (you can persist this in state.ui if desired)
      const activeFilter = state.ui.relationshipFilter || 'All';
      const filteredConnections = allConnections.filter(c => 
          activeFilter === 'All' || c.type === activeFilter
      );
      
      const types = (allConnections.length > 0) 
            ? ['All', ...new Set(allConnections.map(c => c.type))] 
            : [];

    
  // --- 🔗 SPLIT DEPENDENCIES ---
    const allDeps = res.dependencies || [];
    const taskDeps = allDeps.filter(d => d.type === 'task');
    const resDeps = allDeps.filter(d => d.type === 'resource');
    
    const resType = (res.type || "General").toLowerCase();

    // --- 🗓️ SECTION: WORKFLOW PHASE ---
    const hash = window.location.hash;
    const isScopingSheet = hash.includes('scoping-sheet');
    const activeId = lineItem ? lineItem.id : targetId;
    const currentRound = lineItem ? (lineItem.round || 1) : 1;
    const scopeData = OL.getScopingDataForResource(res.id);
    const scopeAndRoundHtml = ((lineItem || isScopingSheet) || scopeData) ? `
        <div class="card-section" style="margin-bottom:20px;background:rgba(var(--accent-rgb),0.05);
                                          border:1px solid var(--accent);padding:12px 16px;border-radius:8px;">
            <div style="display:flex;align-items:flex-end;gap:12px;flex-wrap:wrap;">
                ${(lineItem || isScopingSheet) ? `
                    <div style="display:flex;flex-direction:column;gap:2px;">
                        <label style="font-size:10px;color:var(--text-muted);text-transform:uppercase;font-weight:700;">Round / Phase</label>
                        <input type="number" class="modal-input tiny" style="width:70px;"
                               value="${currentRound}" min="1"
                               onchange="OL.updateLineItem('${activeId}', 'round', this.value)">
                    </div>
                ` : ''}
                ${scopeData ? `
                    <div style="display:flex;flex-direction:column;gap:2px;">
                        <label style="font-size:10px;color:var(--text-muted);text-transform:uppercase;font-weight:700;">Scoping Status</label>
                        <select class="modal-input tiny" style="width:auto;"
                                onchange="OL.updateLineItem('${scopeData.id}', 'status', this.value)">
                            ${['Do Now','Do Later',"Don't Do",'Done'].map(s => `
                                <option value="${s}" ${scopeData.status === s ? 'selected' : ''}>${s}</option>
                            `).join('')}
                        </select>
                    </div>
                    <div style="display:flex;flex-direction:column;gap:2px;">
                        <label style="font-size:10px;color:var(--text-muted);text-transform:uppercase;font-weight:700;">Responsible Party</label>
                        <select class="modal-input tiny" style="width:auto;"
                                onchange="OL.updateLineItem('${scopeData.id}', 'responsibleParty', this.value)">
                            <option value="Sphynx" ${scopeData.responsibleParty === 'Sphynx' ? 'selected' : ''}>Sphynx</option>
                            <option value="Client" ${scopeData.responsibleParty === 'Client' ? 'selected' : ''}>Client</option>
                            <option value="Joint" ${scopeData.responsibleParty === 'Joint' ? 'selected' : ''}>Joint</option>
                        </select>
                    </div>
                ` : ''}
            </div>
        </div>
    ` : '';

    // --- 📊 SECTION: ADMIN PRICING ---
    const relevantVars = Object.entries(state.master.rates?.variables || {}).filter(([_, v]) => 
        String(v.applyTo).toLowerCase() === String(res.type).toLowerCase()
    );
    
    // 1. Pre-calculate the rows to avoid template nesting errors
    // 🔍 DEBUG LOGS - Check your console (F12) to see these!
    console.log("🛠️ Admin Check:", typeof isAdmin !== 'undefined' ? isAdmin : "Undefined");
    console.log("📋 Relevant Vars Count:", (typeof relevantVars !== 'undefined') ? relevantVars.length : "Undefined");
    console.log("💎 Active Resource:", typeof activeData !== 'undefined' ? activeData.name : "Missing activeData");

   const pricingRows = (relevantVars || []).map(([varKey, v]) => {
        const client = getActiveClient();
        const projectData = client?.projectData || {};
        
        // 🚀 1. GATHER ALL SOURCES
        // We combine the main library and any visual workflows
        const allPossibleResources = [
            ...(projectData.resources || []),      // Standard Library
            ...(projectData.localResources || []), // Local Library
            ...(projectData.localApps || []),      // Local Apps
            ...(projectData.workflows || []).flatMap(w => w.resources || []) // Map Canvas
        ];

        // 🚀 2. RESOLVE THE SOURCE OF TRUTH
        // We look for the object that has BOTH the right ID/Name AND the actual steps
        const projectRes = allPossibleResources.find(r => 
            (String(r.id) === String(activeData.resourceId || activeData.id) || r.name === activeData.name) 
            && (r.steps && r.steps.length > 0)
        ) || activeData;

        const isZap = projectRes?.type?.toLowerCase() === 'zap' || v.label?.toLowerCase().includes('zap');
        const isStepVar = v.label?.toLowerCase().includes('step');
       const isLogicVar = v.label?.toLowerCase().includes('logic');

        let displayVal = num(activeData.data?.[varKey]);
        let inputProps = "";
        let badge = "";

        if (isZap && isStepVar) {
            const allSteps = projectRes.steps || [];
            const actualStepCount = allSteps.filter((s, idx) => {
                if (idx === 0) return true; // always count first step (trigger)
                const assignees = s.assignees || [];
                const hasHumanAssignee = assignees.some(a => 
                    a.type === 'person' || a.type === 'role'
                );
                if (!hasHumanAssignee) return true; // no human assignee — count it
                // Has human assignee — only count if app is Zapier Approval
                const appName = (s.appName || '').toLowerCase();
                return appName.includes('zapier approval');
            }).length;
        
            displayVal = actualStepCount;
            inputProps = "readonly style='background:rgba(255,159,67,0.1);color:#ff9f43;border-color:#ff9f43;cursor:not-allowed;'";
            badge = `<span style="color:#ff9f43;font-size:9px;margin-left:5px;font-weight:bold;">⚡ AUTO</span>`;
        
            if (num(activeData.data?.[varKey]) !== actualStepCount) {
                if (!activeData.data) activeData.data = {};
                activeData.data[varKey] = actualStepCount;
                OL.updateResourcePricingData(activeData.id, varKey, actualStepCount);
            }
        }

       if (isLogicVar) {
            const actualLogicCount = (projectRes.steps || []).reduce((acc, s) => {
                return acc + (s.logic?.out || []).filter(l => {
                    if (!l.targetId) return false;
                    const types = l.types || [l.type || 'next'];
                    // Count any rule that has at least one non-next type
                    return types.some(t => t !== 'next');
                }).length;
            }, 0);
            displayVal = actualLogicCount;
            inputProps = "readonly style='background:rgba(255,159,67,0.1);color:#ff9f43;border-color:#ff9f43;cursor:not-allowed;'";
            badge = `<span style="color:#ff9f43;font-size:9px;margin-left:5px;font-weight:bold;">⚡ AUTO</span>`;
        
            if (num(activeData.data?.[varKey]) !== actualLogicCount) {
                if (!activeData.data) activeData.data = {};
                activeData.data[varKey] = actualLogicCount;
                OL.updateResourcePricingData(activeData.id, varKey, actualLogicCount);
            }
        }

        return `
             <div style="display:flex;flex-direction:column;gap:2px;">
                <label style="font-size:10px;color:var(--text-muted);">${esc(v.label)}${badge}</label>
                <input type="number" class="modal-input tiny" 
                    value="${displayVal}" 
                    ${inputProps}
                    oninput="OL.updateResourcePricingData('${activeData.id}', '${varKey}', this.value)">
                <span style="font-size:9px;color:var(--text-muted);">$${v.value} each</span>
            </div>`;
    }).join("");

    // 🚀 FORCE VISIBLE FOR TESTING: Remove "isAdmin &&" to show regardless of permissions
    // --- 📊 SECTION: ADMIN PRICING ---
    const adminPricingHtml = (isAdmin && relevantVars?.length > 0) ? `
        <div class="card-section" style="margin-bottom: 20px; padding: 15px; background: rgba(255,255,255,0.02); border: 1px solid var(--line); border-radius: 8px; display:block !important;">
            <label class="modal-section-label" style="display:flex; align-items:center; gap:6px;">
                <i data-lucide="settings" style="width:14px; height:14px;"></i> PRICING CONFIG
            </label>
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px; margin-top:10px;">
                ${pricingRows}
            </div>
        </div>` : '';
    
    // --- 📖 SECTION: LINKED MASTER GUIDES ---
    const linkedSOPs = (state.master.howToLibrary || []).filter(ht => 
        (ht.resourceIds || []).includes(res.masterRefId || res.id)
    );
    
    const sopLibraryHtml = `
        <div class="card-section" style="margin-bottom:20px;">
            <label class="modal-section-label" style="display:flex; align-items:center; gap:6px;">
                <i data-lucide="library" style="width:14px; height:14px;"></i> LINKED MASTER GUIDES
            </label>
            <div style="display:flex; flex-wrap:wrap; gap:8px; margin-top:10px;">
                ${linkedSOPs.length > 0 ? linkedSOPs.map(sop => `
                    <span class="pill soft tiny" style="display:flex; align-items:center; gap:4px;">
                        <i data-lucide="book-open" style="width:10px; height:10px;"></i> 
                        ${esc(sop.name)}
                    </span>`).join("") : `
                    <span class="tiny muted" style="display:flex; align-items:center; gap:4px;">
                        <i data-lucide="info" style="width:12px; height:12px; opacity:0.5;"></i>
                        No guides linked to this resource template.
                    </span>`}
            </div>
        </div>`;

const dependencyHtml = `
    <div class="card-section" style="margin-top:20px; border-top: 1px solid var(--line); padding-top:15px;">
        <label class="modal-section-label" style="display:flex; align-items:center; gap:6px;">
            <i data-lucide="list-checks" style="width:14px; height:14px;"></i> TASK DEPENDENCIES (PROJECT-SPECIFIC)
        </label>
        <div class="dp-manager-list" id="task-dependency-list">
            ${taskDeps.map((dep, idx) => renderDependencyRow(dep, res.id)).join('') || '<div class="tiny muted p-10">No tasks linked.</div>'}
        </div>
        <div class="search-map-container" style="margin-top:8px; position:relative; display:flex; align-items:center;">
            <i data-lucide="search" style="position:absolute; left:10px; width:12px; height:12px; opacity:0.4;"></i>
            <input type="text" class="modal-input tiny" style="padding-left:30px;" placeholder="Search or Create Task..." 
                   onfocus="OL.filterDependencySearch('${res.id}', 'task', '')"
                   oninput="OL.filterDependencySearch('${res.id}', 'task', this.value)">
            <div id="task-dep-results" class="search-results-overlay"></div>
        </div>
    </div>

    <div class="card-section" style="margin-top:20px; border-top: 1px solid var(--line); padding-top:15px;">
        <label class="modal-section-label" style="display:flex; align-items:center; gap:6px;">
            <i data-lucide="layers" style="width:14px; height:14px;"></i> RESOURCE DEPENDENCIES (INFRASTRUCTURE)
        </label>
        <div class="dp-manager-list" id="res-dependency-list">
            ${resDeps.map((dep, idx) => renderDependencyRow(dep, res.id)).join('') || '<div class="tiny muted p-10">No resources linked.</div>'}
        </div>
        <div class="search-map-container" style="margin-top:8px; position:relative; display:flex; align-items:center;">
            <i data-lucide="search" style="position:absolute; left:10px; width:12px; height:12px; opacity:0.4;"></i>
            <input type="text" class="modal-input tiny" style="padding-left:30px;" placeholder="Search Project Library..." 
                   onfocus="OL.filterDependencySearch('${res.id}', 'resource', '')"
                   oninput="OL.filterDependencySearch('${res.id}', 'resource', this.value)">
            <div id="res-dep-results" class="search-results-overlay"></div>
        </div>
    </div>
`;

  //------- SCOPING STATUS ---------//

  // Inside OL.openResourceModal...
  const activeTab = state.v2?.activeCommentTab || 'internal';
  const isGuest = !!window.IS_GUEST;
  const showPricing = state.v2?.showPricing || false;

  const sidebarHtml = `
      <aside class="modal-sidebar" style="flex: 1; display: flex; flex-direction: column; background: rgba(0,0,0,0.05); border-left: 1px solid var(--line);">
          
          <div style="display: flex; border-bottom: 1px solid var(--line);">
              ${!isGuest ? `
                  <div class="comment-tab ${activeTab === 'internal' ? 'active' : ''}" 
                      onclick="state.v2.activeCommentTab='internal'; OL.openResourceModal('${res.id}')"
                      style="flex:1; padding: 12px; text-align:center; font-size:10px; cursor:pointer; font-weight:bold; ${activeTab === 'internal' ? 'color:var(--accent); border-bottom:2px solid var(--accent);' : 'opacity:0.5'}">
                      INTERNAL NOTES
                  </div>
              ` : ''}
              <div class="comment-tab ${activeTab === 'client' ? 'active' : ''}" 
                  onclick="state.v2.activeCommentTab='client'; OL.openResourceModal('${res.id}')"
                  style="flex:1; padding: 12px; text-align:center; font-size:10px; cursor:pointer; font-weight:bold; ${activeTab === 'client' ? 'color:#10b981; border-bottom:2px solid #10b981;' : 'opacity:0.5'}">
                  CLIENT FEEDBACK
              </div>
          </div>

          <div id="comments-list-${res.id}" style="flex: 1; overflow-y: auto; padding: 15px;">
              ${renderCommentsList(res, activeTab)}
          </div>

          <div class="comment-input-zone" style="padding: 15px; border-top: 1px solid var(--line);">
              <textarea id="new-comment-input-${res.id}" class="modal-textarea" 
                        placeholder="Type a ${activeTab === 'client' ? 'message to the team' : 'private note'}..." 
                        style="min-height: 60px; margin-bottom: 8px; font-size: 11px;"></textarea>
              <button class="btn tiny full-width ${activeTab === 'client' ? 'primary' : 'soft'}" 
                      style="${activeTab === 'client' ? 'background:#10b981; color:white;' : ''}"
                      onclick="OL.addResourceComment('${res.id}', ${activeTab === 'client'})">
                  Post to ${activeTab === 'client' ? 'Client Thread' : 'Internal Stack'}
              </button>
          </div>
      </aside>
  `;

    let containerHtml = "";
    if (res.isContainer) {
        containerHtml = `
            <div class="card-section" style="margin-top:20px; background: rgba(255,255,255,0.02); padding: 20px; border-radius: 8px; border: 1px solid var(--line);">
                <label class="modal-section-label" style="display:flex; align-items:center; gap:6px;">
                    <i data-lucide="files" style="width:14px; height:14px;"></i> DOCUMENT COLLECTION
                </label>
                <div id="file-list-container" style="display:flex; flex-direction:column; gap:10px; margin-top:10px;">
                    ${(res.files || []).map((file, idx) => `
                        <div class="file-row" style="display:flex; align-items:center; gap:10px; padding:10px; background:rgba(0,0,0,0.2); border-radius:6px; border: 1px solid rgba(255,255,255,0.05);">
                            <div style="flex: 1; display:flex; align-items:center; gap:8px;">
                                <i data-lucide="file" style="width:12px; height:12px; opacity:0.5;"></i>
                                <input type="text" class="modal-input tiny" value="${esc(file.name)}" 
                                      style="font-weight:bold; border:none; background:transparent; padding:0; width:100%;"
                                      onblur="OL.updateContainerFile('${res.id}', ${idx}, 'name', this.value)">
                            </div>
                            
                            <div style="flex: 2; display:flex; align-items:center; gap:8px;">
                                <input type="text" class="modal-input tiny" placeholder="Paste link or URL..." 
                                      value="${esc(file.url || '')}" 
                                      onblur="OL.updateContainerFile('${res.id}', ${idx}, 'url', this.value)">
                                
                                ${file.url ? `
                                    <a href="${file.url}" target="_blank" class="btn primary tiny" style="height:24px; width:30px; display:flex; align-items:center; justify-content:center;">
                                        <i data-lucide="external-link" style="width:12px; height:12px;"></i>
                                    </a>
                                ` : `
                                    <button class="btn tiny soft" style="height:24px; width:30px; display:flex; align-items:center; justify-content:center;" 
                                            onclick="OL.simulateUpload('${res.id}', ${idx})" title="Upload File">
                                        <i data-lucide="upload-cloud" style="width:12px; height:12px;"></i>
                                    </button>
                                `}
                            </div>
                            <button class="card-delete-btn" style="position:static; opacity:0.5;" onclick="OL.removeFileFromContainer('${res.id}', ${idx})">
                                <i data-lucide="x" style="width:14px; height:14px;"></i>
                            </button>
                        </div>
                    `).join('')}
                </div>
                <button class="btn tiny soft full-width" style="margin-top:10px; border-style:dashed; display:flex; align-items:center; justify-content:center; gap:6px;" 
                        onclick="OL.addFileToContainer('${res.id}')">
                    <i data-lucide="plus" style="width:14px; height:14px;"></i> Add Document Entry
                </button>
            </div>
        `;
    }
    // --- 🚀 FINAL ASSEMBLY ---
    let bodyContent = "";
    if (resType === "email" || resType === "email template") {
         bodyContent = `
                ${appMappingHtml}
        
                <!-- DESCRIPTION - half height -->
                <div class="card-section" style="margin-bottom:16px;">
                    <label class="modal-section-label">Description & Access Notes</label>
                    <textarea class="modal-textarea"
                              style="min-height:48px;max-height:60px;resize:none;"
                              placeholder="Enter login details, account purpose, or specific access instructions..."
                              onblur="OL.handleResourceSave('${res.id}', 'description', this.value)">${esc(res.description || '')}</textarea>
                </div>
        
                <!-- EMAIL COMPOSITION -->
                <div class="card-section" style="margin-bottom:16px;background:rgba(255,255,255,0.02);padding:15px;border-radius:8px;border:1px solid var(--line);">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:15px;">
                        <label class="modal-section-label" style="display:flex;align-items:center;gap:6px;color:var(--accent);margin:0;">
                            <i data-lucide="mail" style="width:14px;height:14px;"></i> EMAIL COMPOSITION
                        </label>
                        <button class="btn tiny primary" onclick="OL.previewEmailTemplate('${res.id}')">
                            <i data-lucide="eye" style="width:12px;height:12px;margin-right:4px;"></i> Preview
                        </button>
                    </div>
        
                    <!-- FROM + TO on one line -->
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
                        <div>
                            <label class="tiny muted bold" style="display:flex;align-items:center;gap:4px;margin-bottom:4px;">
                                <i data-lucide="user-round" style="width:10px;height:10px;"></i> FROM
                            </label>
                            <select class="modal-input tiny" onchange="OL.handleResourceSave('${res.id}', 'emailFrom', this.value)">
                                <option value="">Select Sender...</option>
                                ${(client?.projectData?.teamMembers || []).map(m => `
                                    <option value="${m.id}" ${res.emailFrom === m.id ? 'selected' : ''}>${esc(m.name)}</option>
                                `).join('')}
                            </select>
                        </div>
                        <div>
                            <label class="tiny muted bold" style="display:flex;align-items:center;gap:4px;margin-bottom:4px;">
                                <i data-lucide="users" style="width:10px;height:10px;"></i> TO
                            </label>
                            <select class="modal-input tiny" onchange="OL.handleResourceSave('${res.id}', 'emailToType', this.value)">
                                <option value="">Select Recipient...</option>
                                <option value="Household" ${res.emailToType === 'Household' ? 'selected' : ''}>Household</option>
                                <option value="Client 1" ${res.emailToType === 'Client 1' ? 'selected' : ''}>Client 1</option>
                                <option value="Client 2" ${res.emailToType === 'Client 2' ? 'selected' : ''}>Client 2</option>
                                <option value="COI" ${res.emailToType === 'COI' ? 'selected' : ''}>COI (Professional)</option>
                            </select>
                        </div>
                    </div>
        
                    <!-- SUBJECT full width -->
                    <div style="margin-bottom:12px;">
                        <label class="tiny muted bold" style="display:block;margin-bottom:4px;">SUBJECT LINE</label>
                        <input type="text" class="modal-input" style="width:100%;"
                               placeholder="Enter email subject..."
                               value="${esc(res.emailSubject || '')}"
                               onblur="OL.handleResourceSave('${res.id}', 'emailSubject', this.value)">
                    </div>
        
                     <!-- BODY - preview by default, edit toggle -->
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                        <label class="tiny muted bold">EMAIL BODY</label>
                        <div style="display:flex;gap:6px;align-items:center;">
                            <!-- Data Tags picker -->
                            <div style="position:relative;">
                                <button class="btn tiny soft" id="data-tags-btn-${res.id}" 
                                        style="display:none;"
                                        onmousedown="event.preventDefault();"
                                        onclick="event.stopPropagation(); const m=document.getElementById('data-tag-menu-${res.id}'); 
                                                m.style.display=m.style.display==='none'?'block':'none';">
                                    <i data-lucide="tag" style="width:10px;height:10px;margin-right:4px;"></i> Data Tags ▾
                                </button>
                                <div id="data-tag-menu-${res.id}"
                                     onmousedown="event.preventDefault();"
                                     style="display:none;position:absolute;right:0;top:calc(100% + 4px);
                                            background:var(--panel);border:1px solid var(--panel-border);
                                            border-radius:8px;padding:4px;z-index:51;min-width:200px;max-height:220px;
                                            overflow-y:auto;box-shadow:0 4px 12px rgba(0,0,0,0.3);">
                                    ${Object.entries(
                                        (client?.projectData?.localDatapoints?.length ? client.projectData.localDatapoints : state.master.datapoints || []).reduce((groups, dp) => {
                                            (groups[dp.category] = groups[dp.category] || []).push(dp);
                                            return groups;
                                        }, {})
                                    ).map(([cat, tags]) => `
                                        <div style="padding:4px 8px;font-size:9px;font-weight:700;color:var(--text-dim);
                                                    text-transform:uppercase;letter-spacing:0.05em;margin-top:4px;">
                                            ${cat}
                                        </div>
                                        ${tags.map(dp => `
                                            <div onmousedown="event.preventDefault();
                                                             OL._geInsertDataTag('${res.id}', '${dp.key}');
                                                             setTimeout(function(){ document.getElementById('data-tag-menu-${res.id}').style.display='none'; }, 50);"
                                                 style="padding:7px 12px;cursor:pointer;font-size:11px;border-radius:6px;
                                                        display:flex;justify-content:space-between;align-items:center;"
                                                 onmouseover="this.style.background='var(--panel-soft)'"
                                                 onmouseout="this.style.background='transparent'">
                                                <span>${dp.name}</span>
                                                <code style="font-size:9px;opacity:0.5;background:rgba(255,255,255,0.05);
                                                             padding:1px 5px;border-radius:3px;">${dp.key}</code>
                                            </div>
                                        `).join('')}
                                    `).join('')}
                                </div>
                                <!-- Resource Links picker -->
                                <div style="position:relative;">
                                    <button class="btn tiny soft" id="res-tags-btn-${res.id}" 
                                            style="display:none;"
                                            onmousedown="event.preventDefault();"
                                            onclick="event.stopPropagation(); const m=document.getElementById('res-tag-menu-${res.id}'); m.style.display=m.style.display==='none'?'block':'none';">
                                        <i data-lucide="link" style="width:10px;height:10px;margin-right:4px;"></i> Resources ▾
                                    </button>
                                    <div id="res-tag-menu-${res.id}"
                                         onmousedown="event.preventDefault();"
                                         style="display:none;position:absolute;right:0;top:calc(100% + 4px);
                                                background:var(--panel);border:1px solid var(--panel-border);
                                                border-radius:8px;padding:4px;z-index:51;min-width:220px;max-height:220px;
                                                overflow-y:auto;box-shadow:0 4px 12px rgba(0,0,0,0.3);">
                                        ${OL.getResourceDatapoints().map(dp => `
                                            <div onmousedown="event.preventDefault();
                                                             OL._geInsertDataTag('${res.id}', '${dp.key}');
                                                             setTimeout(function(){ document.getElementById('res-tag-menu-${res.id}').style.display='none'; }, 50);"
                                                 style="padding:7px 12px;cursor:pointer;font-size:11px;border-radius:6px;
                                                        display:flex;justify-content:space-between;align-items:center;"
                                                 onmouseover="this.style.background='var(--panel-soft)'"
                                                 onmouseout="this.style.background='transparent'">
                                                <span style="display:flex;align-items:center;gap:6px;">
                                                    <i data-lucide="link" style="width:10px;height:10px;opacity:0.5;"></i>
                                                    ${dp.name}
                                                </span>
                                                <code style="font-size:9px;opacity:0.5;background:rgba(255,255,255,0.05);
                                                             padding:1px 5px;border-radius:3px;">${dp.key}</code>
                                            </div>
                                        `).join('')}
                                    </div>
                                </div>
                            </div>
                    
                            <!-- Edit button -->
                            <div style="position:relative;">
                                <button class="btn tiny soft" id="email-edit-btn-${res.id}"
                                        onclick="document.getElementById('email-edit-menu-${res.id}').style.display='block'">
                                    <i data-lucide="pencil" style="width:10px;height:10px;margin-right:4px;"></i> Edit ▾
                                </button>
                                <div id="email-edit-menu-${res.id}"
                                     style="display:none;position:absolute;right:0;top:calc(100% + 4px);
                                            background:var(--panel);border:1px solid var(--panel-border);
                                            border-radius:8px;padding:4px;z-index:50;min-width:140px;
                                            box-shadow:0 4px 12px rgba(0,0,0,0.3);">
                                    <div onmousedown="event.preventDefault();
                                                     document.getElementById('email-edit-menu-${res.id}').style.display='none';
                                                     OL._geToggleEmailBody('${res.id}', 'plain')"
                                         style="padding:8px 12px;cursor:pointer;font-size:11px;border-radius:6px;"
                                         onmouseover="this.style.background='var(--panel-soft)'"
                                         onmouseout="this.style.background='transparent'">
                                        <i data-lucide="code" style="width:11px;height:11px;margin-right:6px;"></i>Edit as HTML
                                    </div>
                                    <div onmousedown="event.preventDefault();
                                                     document.getElementById('email-edit-menu-${res.id}').style.display='none';
                                                     OL._geToggleEmailBody('${res.id}', 'rich')"
                                         style="padding:8px 12px;cursor:pointer;font-size:11px;border-radius:6px;"
                                         onmouseover="this.style.background='var(--panel-soft)'"
                                         onmouseout="this.style.background='transparent'">
                                        <i data-lucide="type" style="width:11px;height:11px;margin-right:6px;"></i>Edit as Rich Text
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Body preview + editor -->
                    <div id="email-body-preview-${res.id}"
                         style="background:rgba(0,0,0,0.15);border:1px solid var(--line);border-radius:6px;
                                padding:12px;font-size:12px;line-height:1.6;color:var(--text-main);
                                min-height:80px;">
                        ${OL._geRenderEmailPreview(res.emailBody || '', [
                            ...(client?.projectData?.localDatapoints?.length 
                                ? client.projectData.localDatapoints 
                                : (state.master.datapoints || [])),
                            ...OL.getResourceDatapoints()
                        ], client)}
                    </div>
                    <textarea id="email-body-edit-${res.id}"
                              class="modal-textarea"
                              style="display:none;min-height:160px;"
                              placeholder="Write email body...">${esc(res.emailBody || '')}</textarea>
                    <button id="email-body-done-${res.id}"
                            style="display:none;margin-top:8px;"
                            class="btn tiny soft"
                            onclick="const ed=document.getElementById('email-body-edit-${res.id}');
                                     const ri=document.getElementById('email-body-rich-${res.id}');
                                     const val=ri&&ri.style.display!=='none'?ri.innerHTML:ed.value;
                                     OL._geSaveEmailBody('${res.id}', val);">
                        ✓ Done Editing
                    </button>
                </div>
                <!-- CONNECTED RELATIONSHIPS -->
                <div class="card-section" style="margin-bottom:16px;">
                    <label class="modal-section-label">
                        <i data-lucide="share-2" style="width:14px;height:14px;"></i> Connected Relationships
                    </label>
                    <div style="display:flex;gap:5px;margin:8px 0;overflow-x:auto;padding-bottom:5px;">
                        ${['All',...new Set(allConnections.map(c=>c.type))].map(t => `
                            <span onclick="state.ui.relationshipFilter='${t}';OL.openResourceModal('${targetId}')"
                                  style="font-size:9px;padding:2px 8px;border-radius:100px;cursor:pointer;white-space:nowrap;
                                         background:${activeFilter===t?'var(--accent)':'rgba(255,255,255,0.05)'};
                                         color:${activeFilter===t?'#000':'#94a3b8'};
                                         border:1px solid rgba(255,255,255,0.1);">
                                ${t.toUpperCase()}
                            </span>
                        `).join('')}
                    </div>
                    <div style="display:flex;flex-direction:column;gap:6px;">
                        ${filteredConnections.length > 0 ? filteredConnections.map(conn => `
                            <div class="pill accent is-clickable"
                                 style="display:flex;align-items:center;justify-content:space-between;
                                        background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.1);
                                        cursor:pointer;padding:8px 12px;border-radius:8px;"
                                 onmousedown="event.preventDefault();event.stopPropagation();if(OL.closeModal)OL.closeModal();OL.openInspector('${conn.id}')">
                                <div style="display:flex;align-items:center;gap:8px;pointer-events:none;">
                                    ${OL.getLucideSVG(OL.getRegistryIcon(conn.type),14,'var(--accent)')}
                                    <div>
                                        <div style="font-size:11px;color:#eee;">${esc(conn.name)}</div>
                                        <div style="font-size:8px;color:var(--accent);">${conn.type.toUpperCase()}</div>
                                    </div>
                                </div>
                                <span style="font-size:9px;opacity:0.5;pointer-events:none;">Inspect →</span>
                            </div>
                        `).join('') : `<div class="tiny muted" style="padding:10px;text-align:center;">No connections found.</div>`}
                    </div>
                </div>
        
                <!-- TASK DEPENDENCIES -->
                <div class="card-section" style="margin-top:16px;border-top:1px solid var(--line);padding-top:15px;">
                    <label class="modal-section-label" style="display:flex;align-items:center;gap:6px;">
                        <i data-lucide="list-checks" style="width:14px;height:14px;"></i> TASK DEPENDENCIES
                    </label>
                    <div class="dp-manager-list" id="task-dependency-list">
                        ${taskDeps.map(dep => renderDependencyRow(dep, res.id)).join('') || '<div class="tiny muted p-10">No tasks linked.</div>'}
                    </div>
                    <div class="search-map-container" style="margin-top:8px;position:relative;display:flex;align-items:center;">
                        <i data-lucide="search" style="position:absolute;left:10px;width:12px;height:12px;opacity:0.4;"></i>
                        <input type="text" class="modal-input tiny" style="padding-left:30px;" placeholder="Search or Create Task..."
                               onfocus="OL.filterDependencySearch('${res.id}', 'task', '')"
                               oninput="OL.filterDependencySearch('${res.id}', 'task', this.value)">
                        <div id="task-dep-results" class="search-results-overlay"></div>
                    </div>
                </div>
        
                <!-- LINKED MASTER GUIDES -->
                <div class="card-section" style="margin-top:16px;">
                    <label class="modal-section-label">
                        <i data-lucide="library" style="width:14px;height:14px;"></i> LINKED MASTER GUIDES
                    </label>
                    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;">
                        ${linkedSOPs.length > 0 ? linkedSOPs.map(sop => `
                            <span class="pill soft tiny" style="display:flex;align-items:center;gap:4px;">
                                <i data-lucide="book-open" style="width:10px;height:10px;"></i>
                                ${esc(sop.name)}
                            </span>`).join('') : `
                            <span class="tiny muted">No guides linked to this resource.</span>`}
                    </div>
                </div>
            `;
    }
    else if (isHierarchy) {
        // --- MODE A: DRAGGABLE HIERARCHY HUB ---
        if (!res.tree) res.tree = [{ id: uid(), name: "Clients", children: [] }];
    
        bodyContent = `
            <div class="card-section" style="background: rgba(255,255,255,0.02); padding: 20px; border-radius: 8px; border: 1px solid var(--line);">
                <label class="modal-section-label" style="color: var(--accent); display:flex; align-items:center; gap:8px;">
                    <i data-lucide="sitemap" style="width:16px; height:16px;"></i> FOLDER ARCHITECTURE
                </label>
                <p class="tiny muted" style="margin-bottom: 15px;">Drag handles <i data-lucide="grip-vertical" style="width:12px; height:12px; vertical-align:middle; opacity:0.5;"></i> to reorder. Root 'Clients' is protected.</p>
                
                <div id="hierarchy-tree-root" class="hierarchy-container">
                    ${OL.renderHierarchyTree(res.id, res.tree)}
                </div>
                
                <div style="margin-top: 20px; padding-top: 15px; border-top: 1px solid var(--line);">
                    <button class="btn tiny primary" style="display:flex; align-items:center; gap:6px;" onclick="OL.addFolderNode('${res.id}')">
                        <i data-lucide="folder-plus" style="width:14px; height:14px;"></i> Add Root Folder
                    </button>
                </div>
            </div>
        `;
    }
    else if (isCompliance) {
        // --- MODE B: COMPLIANCE DOCS ---
        bodyContent = `
            <div class="card-section" style="margin-top:10px; background: rgba(255,255,255,0.02); padding: 20px; border-radius: 8px; border: 1px solid var(--line);">
                <label class="modal-section-label" style="display:flex; align-items:center; gap:8px;">
                    <i data-lucide="files" style="width:16px; height:16px;"></i> DOCUMENT COLLECTION
                </label>
                <div id="file-list-container" style="display:flex; flex-direction:column; gap:10px; margin-top:10px;">
                    ${(res.files || []).map((file, idx) => `
                        <div class="file-row" style="display:flex; align-items:center; gap:10px; padding:10px; background:rgba(0,0,0,0.2); border-radius:6px; border: 1px solid rgba(255,255,255,0.05);">
                            <div style="flex: 1.5; display:flex; align-items:center; gap:8px;">
                                <i data-lucide="file-check" style="width:14px; height:14px; color:var(--accent); opacity:0.6;"></i>
                                <input type="text" class="modal-input tiny" value="${esc(file.name)}" 
                                       style="font-weight:bold; border:none; background:transparent; padding:0; color:var(--accent); width:100%;"
                                       onblur="OL.updateContainerFile('${res.id}', ${idx}, 'name', this.value)">
                            </div>
                            <div style="flex: 2.5; display:flex; align-items:center; gap:5px;">
                                <input type="text" class="modal-input tiny" placeholder="Paste link or URL..." 
                                       value="${esc(file.url || '')}" 
                                       onblur="OL.updateContainerFile('${res.id}', ${idx}, 'url', this.value)">
                                ${file.url ? `
                                    <a href="${file.url}" target="_blank" class="btn primary tiny" style="padding:0 12px; height: 32px; display:flex; align-items:center; gap:6px; background:var(--accent); color:black; font-weight:bold; text-decoration:none;">
                                        <i data-lucide="external-link" style="width:14px; height:14px;"></i> OPEN
                                    </a>
                                ` : `
                                    <button class="btn tiny soft" style="height:32px; width:40px; display:flex; align-items:center; justify-content:center;" onclick="OL.simulateUpload('${res.id}', ${idx})">
                                        <i data-lucide="upload-cloud" style="width:16px; height:16px;"></i>
                                    </button>
                                `}
                            </div>
                            <button class="card-delete-btn" style="position:static; opacity:0.3;" onclick="OL.removeFileFromContainer('${res.id}', ${idx})">
                                <i data-lucide="x" style="width:14px; height:14px;"></i>
                            </button>
                        </div>
                    `).join('')}
                </div>
                <button class="btn tiny soft full-width" style="margin-top:15px; border-style:dashed; padding: 10px; display:flex; align-items:center; justify-content:center; gap:8px;" 
                        onclick="OL.addFileToContainer('${res.id}')">
                    <i data-lucide="plus-circle" style="width:16px; height:16px;"></i> Add Document Entry
                </button>
            </div>
        `;
    }
    else if (isNaming) {
        // --- MODE C: NAMING CONVENTIONS HUB ---
        const sections = [
            { id: 'household', label: 'HOUSEHOLD NAMING', icon: 'home' },
            { id: 'folders', label: 'FOLDER NAMING', icon: 'folder-search' }
        ];

        const fields = [
            { key: 'individual', label: 'Individual' },
            { key: 'jointSame', label: 'Joint - Same Last' },
            { key: 'jointDiff', label: 'Joint - Different Last' }
        ];

        bodyContent = sections.map(sec => `
            <div class="card-section" style="margin-bottom: 20px; background: rgba(255,255,255,0.02); padding: 20px; border-radius: 8px; border: 1px solid var(--line);">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 15px;">
                    <label class="modal-section-label" style="color: var(--accent); margin:0;">${sec.label}</label>
                    
                    ${sec.id === 'folders' && hierarchyRes ? `
                        <button class="btn tiny primary" style="font-size: 9px; padding: 4px 10px;" 
                                onclick="OL.openResourceModal('${hierarchyRes.id}')">
                            VIEW HIERARCHY ➔
                        </button>
                    ` : ''}
                </div>

                <div style="display: flex; flex-direction: column; gap: 12px;">
                    ${fields.map(f => `
                        <div class="input-group">
                            <label class="tiny muted bold uppercase" style="font-size: 9px; display: block; margin-bottom: 5px;">${f.label}</label>
                            <input type="text" class="modal-input tiny" 
                                   placeholder="e.g. Lastname, Firstname..."
                                   value="${esc(res.data?.[sec.id]?.[f.key] || '')}"
                                   onblur="OL.handleConventionUpdate('${res.id}', '${sec.id}', '${f.key}', this.value)">
                        </div>
                    `).join('')}
                </div>
            </div>
        `).join('');
    }
    else {
        // --- MODE D: STANDARD FULL RESOURCE VIEW ---
       bodyContent = `
            ${scopeAndRoundHtml}
            ${appMappingHtml}

           <div class="card-section" style="margin-top:20px;">
                <label class="modal-section-label" style="display:flex;align-items:center;gap:6px;">
                    <i data-lucide="align-start-vertical" style="width:14px;height:14px;"></i>
                    Hierarchy Context
                </label>
                <select class="modal-input tiny"
                        onchange="OL._fvAssignStageAndWorkflow('${res.id}', this.value)">
                    <option value="">— Workbench (Unassigned) —</option>
                    ${(OL.getCurrentProjectData().stages || []).map(s => {
                        const stageWorkflows = (OL.getCurrentProjectData().workflows || []).filter(w => String(w.stageId) === String(s.id));
                        const stageSelected  = res.stageId === s.id && !res.workflowId;
                        return `
                            <option value="stage:${esc(s.id)}" ${stageSelected ? 'selected' : ''}>
                                ${esc(s.name)}
                            </option>
                            ${stageWorkflows.map(wf => `
                                <option value="wf:${wf.id}:${s.id}" ${res.workflowId === wf.id ? 'selected' : ''}>
                                    &nbsp;&nbsp;↳ ${esc(wf.name)}
                                </option>
                            `).join('')}
                        `;
                    }).join('')}
                </select>
            </div>
                        
            <div class="card-section" style="margin-top:20px;">
                <label class="modal-section-label" style="display:flex;align-items:center;gap:6px;">
                    <i data-lucide="fingerprint" style="width:14px;height:14px;"></i> Description & Access Notes
                </label>
                <textarea class="modal-textarea"
                          placeholder="Enter login details, account purpose, or specific access instructions..."
                          style="min-height:80px;font-size:12px;width:100%;"
                          onblur="OL.handleResourceSave('${res.id}', 'description', this.value)">${esc(res.description || '')}</textarea>
            </div>
        
            ${showWorkflowSteps ? `
                <div class="card-section" style="margin-top:20px;">
                    <label class="modal-section-label" style="display:flex;align-items:center;gap:6px;">
                        <i data-lucide="git-branch" style="width:14px;height:14px;"></i> WORKFLOW STEPS
                    </label>
                    <div style="display:flex;gap:8px;margin-bottom:10px;">
                        <button class="btn tiny primary" onclick="OL.goToResourceInMap('${res.id}')" style="display:flex;align-items:center;gap:6px;">
                            <i data-lucide="mouse-pointer-2" style="width:12px;height:12px;"></i> Visual Editor
                        </button>
                        <button class="btn tiny primary" onclick="OL.addNewStepToCard('${res.id}')" style="display:flex;align-items:center;gap:6px;">
                            <i data-lucide="plus" style="width:12px;height:12px;"></i> Add Step
                        </button>
                    </div>
                    <div id="sop-step-list">${renderSopStepList(res)}</div>
                </div>
            ` : ''}
        
            ${dependencyHtml}
            ${sopLibraryHtml}
            ${containerHtml}
        
            <div class="card-section" style="margin-top:20px;">
                <label class="modal-section-label" style="display:flex;align-items:center;gap:6px;">
                    <i data-lucide="share-2" style="width:14px;height:14px;"></i> Connected Relationships
                </label>
                <div style="display:flex;gap:5px;margin:8px 0;overflow-x:auto;padding-bottom:5px;">
                    ${types.map(t => `
                        <span onclick="state.ui.relationshipFilter='${t}';OL.openResourceModal('${targetId}')"
                              style="font-size:9px;padding:2px 8px;border-radius:100px;cursor:pointer;white-space:nowrap;
                                     background:${activeFilter===t ? 'var(--accent)' : 'rgba(255,255,255,0.05)'};
                                     color:${activeFilter===t ? '#000' : '#94a3b8'};
                                     border:1px solid rgba(255,255,255,0.1);">
                            ${t.toUpperCase()}
                        </span>
                    `).join('')}
                </div>
                <div style="display:flex;flex-direction:column;gap:6px;">
                    ${filteredConnections.length > 0 ? filteredConnections.map(conn => {
                        const navAction = window.location.hash.includes('scoping-sheet')
                            ? `OL.openResourceModal('${conn.id}')`
                            : `OL.openInspector('${conn.id}')`;
                        return `
                        <div class="pill accent is-clickable"
                             style="display:flex;align-items:center;justify-content:space-between;
                                    background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.1);
                                    cursor:pointer;padding:8px 12px;border-radius:8px;"
                             onmousedown="event.preventDefault();event.stopPropagation();if(OL.closeModal)OL.closeModal();${navAction}">
                            <div style="display:flex;align-items:center;gap:8px;pointer-events:none;">
                                ${OL.getLucideSVG(OL.getRegistryIcon(conn.type), 14, 'var(--accent)')}
                                <div>
                                    <div style="font-size:11px;color:#eee;">${esc(conn.name)}</div>
                                    <div style="font-size:8px;color:var(--accent);">${conn.type.toUpperCase()}</div>
                                </div>
                            </div>
                            <span style="font-size:9px;opacity:0.5;pointer-events:none;">Inspect →</span>
                        </div>
                        `;
                    }).join('') : `<div class="tiny muted" style="padding:10px;text-align:center;">No connections found.</div>`}
                </div>
            </div>
        `;
      }
      // --- 🧱 FINAL RENDER ---
    
    const html = `
        <div class="modal-head" style="padding:14px 20px;border-bottom:0.5px solid var(--line);
                                background:var(--panel-dark);
                                display:flex;flex-direction:column;gap:10px;">
    
            <!-- Row 1: Icon + Title + link buttons -->
            <div style="display:flex;align-items:center;gap:8px;">
                <i data-lucide="${isCompliance ? 'clipboard-check' : 'settings'}" 
                   style="width:18px;height:18px;color:var(--accent);flex-shrink:0;"></i>
                <div contenteditable="true"
                     style="flex:1;font-size:18px;font-weight:700;color:var(--text-main);
                            line-height:1.3;outline:none;word-break:break-word;
                            border-bottom:1px dashed transparent;transition:border-color 0.2s;"
                     onfocus="this.style.borderColor='var(--accent)'"
                     onblur="this.style.borderColor='transparent';OL.handleResourceSave('${res.id}','name',this.innerText.trim())">
                    ${esc(res.name)}
                </div>
                ${hasHistory ? `
                    <button class="btn tiny soft" style="display:flex;align-items:center;gap:4px;"
                            onclick="OL.navigateBack()">
                        <i data-lucide="arrow-left" style="width:12px;height:12px;"></i> Back
                    </button>` : ''}
                ${res.externalUrl ? `
                    <a href="${res.externalUrl}" target="_blank"
                       style="width:26px;height:26px;display:flex;align-items:center;justify-content:center;
                              border:1px solid var(--panel-border);border-radius:6px;background:var(--panel-soft);
                              color:var(--text-dim);flex-shrink:0;text-decoration:none;" title="Open link">
                        <i data-lucide="external-link" style="width:12px;height:12px;"></i>
                    </a>` : ''}
                <button onclick="OL.promptEditLink('${res.id}')"
                        style="width:26px;height:26px;display:flex;align-items:center;justify-content:center;
                               border:1px solid var(--panel-border);border-radius:6px;background:var(--panel-soft);
                               color:var(--text-dim);cursor:pointer;flex-shrink:0;"
                        title="${res.externalUrl ? 'Edit link' : 'Add link'}">
                    <i data-lucide="pencil" style="width:12px;height:12px;"></i>
                </button>
            </div>
        
        
            <!-- Row 2: Stage + workflow + archive + pricing + promote — ALL ONE LINE -->
            <div style="display:flex;align-items:flex-end;gap:8px;flex-wrap:wrap;">
                ${originPill} ${typePill}
                <div style="width:0.5px;height:28px;background:var(--panel-border);flex-shrink:0;"></div>
                <button onclick="OL.handleResourceSave('${res.id}', 'isArchived', ${!res.isArchived})"
                        style="padding:4px 10px;border-radius:99px;font-size:11px;font-weight:600;cursor:pointer;
                               display:flex;align-items:center;gap:4px;
                               border:1px solid ${res.isArchived ? '#ef4444' : 'var(--panel-border)'};
                               background:${res.isArchived ? 'rgba(239,68,68,0.08)' : 'var(--panel-soft)'};
                               color:${res.isArchived ? '#ef4444' : 'var(--text-muted)'};">
                    <i data-lucide="${res.isArchived ? 'archive-restore' : 'archive'}" style="width:11px;height:11px;"></i>
                    ${res.isArchived ? 'Unarchive' : 'Archive'}
                </button>
                <button onclick="OL.handleResourceSave('${res.id}', 'isGlobal', ${!res.isGlobal}); OL.openResourceModal('${res.id}');"
                        style="padding:4px 10px;border-radius:99px;font-size:11px;font-weight:600;cursor:pointer;
                               display:flex;align-items:center;gap:4px;
                               border:1px solid ${res.isGlobal ? '#3dd9c5' : 'var(--panel-border)'};
                               background:${res.isGlobal ? 'rgba(61,217,197,0.1)' : 'var(--panel-soft)'};
                               color:${res.isGlobal ? '#3dd9c5' : 'var(--text-muted)'};">
                    <i data-lucide="globe" style="width:11px;height:11px;"></i>
                    ${res.isGlobal ? 'Global' : 'Set Global'}
                </button>
                ${isAdmin && relevantVars?.length > 0 ? `
                    <button onclick="if(!state.v2)state.v2={};state.v2.showPricing=!state.v2.showPricing;OL.openResourceModal('${res.id}')"
                            style="padding:4px 10px;border-radius:99px;font-size:11px;font-weight:600;cursor:pointer;
                                   display:flex;align-items:center;gap:4px;
                                   border:1px solid ${showPricing ? '#3dd9c5' : 'var(--panel-border)'};
                                   background:${showPricing ? 'rgba(61,217,197,0.1)' : 'var(--panel-soft)'};
                                   color:${showPricing ? '#3dd9c5' : 'var(--text-muted)'};">
                        <i data-lucide="${showPricing ? 'banknote-x' : 'banknote'}" style="width:11px;height:11px;"></i>
                        ${showPricing ? 'Hide pricing' : 'Show pricing'}
                    </button>` : ''}
                ${canPromote ? `
                    <button style="padding:4px 10px;border-radius:99px;font-size:11px;font-weight:600;cursor:pointer;
                                   background:#fbbf24;color:#000;border:none;display:flex;align-items:center;gap:4px;"
                            onclick="OL.pushToMaster('${res.id}')">
                        <i data-lucide="star" style="width:11px;height:11px;"></i> Promote
                    </button>` : ''}
            </div>
        </div>
        
        <!-- Pricing drawer -->
        ${showPricing && adminPricingHtml ? `
            <div style="border-bottom:1px solid var(--panel-border);background:var(--panel-dark);padding:12px 20px;">
                <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;
                            color:var(--accent);margin-bottom:8px;display:flex;align-items:center;gap:5px;">
                    <i data-lucide="settings" style="width:12px;height:12px;"></i> Pricing config
                </div>
                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(88px,1fr));gap:8px;">
                    ${pricingRows}
                </div>
            </div>
        ` : ''}
    
        <div style="display:flex;height:72vh;overflow:hidden;">
            <!-- Main body -->
            <div style="flex:1.6;overflow-y:auto;padding:16px 20px; height: 100%;">
                ${bodyContent}
            </div>
    
            <!-- Sidebar -->
            <aside style="flex:1;display:flex;flex-direction:column;border-left:1px solid var(--line);min-width:0; height:100%;">
                <div style="display:flex;border-bottom:1px solid var(--line);">
                    ${!isGuest ? `
                        <div onclick="state.v2.activeCommentTab='internal';OL.openResourceModal('${res.id}')"
                             style="flex:1;padding:10px 4px;text-align:center;font-size:10px;font-weight:700;
                                    cursor:pointer;${activeTab==='internal' ? 'color:var(--accent);border-bottom:2px solid var(--accent);' : 'opacity:0.5'}">
                            INTERNAL NOTES
                        </div>` : ''}
                    <div onclick="state.v2.activeCommentTab='client';OL.openResourceModal('${res.id}')"
                         style="flex:1;padding:10px 4px;text-align:center;font-size:10px;font-weight:700;
                                cursor:pointer;${activeTab==='client' ? 'color:#10b981;border-bottom:2px solid #10b981;' : 'opacity:0.5'}">
                        CLIENT FEEDBACK
                    </div>
                    <div onclick="state.v2.activeCommentTab='history';OL.openResourceModal('${res.id}')"
                         style="flex:1;padding:10px 4px;text-align:center;font-size:10px;font-weight:700;
                                cursor:pointer;${activeTab==='history' ? 'color:var(--accent);border-bottom:2px solid var(--accent);' : 'opacity:0.5'}">
                        EDIT HISTORY
                    </div>
                </div>
    
                <div style="flex:1;overflow-y:auto;padding:14px;">
                    ${activeTab === 'history' ? OL.renderEditHistory(res) : `
                        <div id="comments-list-${res.id}">
                            ${renderCommentsList(res, activeTab)}
                        </div>
                    `}
                </div>
    
                ${activeTab !== 'history' ? `
                    <div style="padding:12px;border-top:1px solid var(--line);">
                        <textarea id="new-comment-input-${res.id}" class="modal-textarea"
                                  placeholder="Type a ${activeTab === 'client' ? 'message to client' : 'private note'}..."
                                  style="min-height:60px;margin-bottom:8px;font-size:11px;"></textarea>
                        <button class="btn tiny full-width"
                                style="background:${activeTab === 'client' ? '#10b981' : 'var(--accent)'};"
                                onclick="OL.addResourceComment('${res.id}', ${activeTab === 'client'})">
                            Post to ${activeTab === 'client' ? 'Client Thread' : 'Internal Stack'}
                        </button>
                    </div>
                ` : ''}
            </aside>
        </div>
    `;
    
    openModal(html);
    setTimeout(() => {
        const el = document.getElementById('modal-res-name');
        if (el) el.style.height = el.scrollHeight + 'px';
    }, 10);

    // 🔍 DEBUG: Watch editor for style changes
    setTimeout(() => {
        const editor = document.getElementById(`email-body-edit-${res.id}`);
        if (editor) {
            new MutationObserver((mutations) => {
                mutations.forEach(m => {
                    if (m.attributeName === 'style') {
                        console.trace('Editor style changed to:', editor.style.display);
                    }
                });
            }).observe(editor, { attributes: true });
        }
    }, 500);
    if (window.lucide) {
        window.lucide.createIcons();
    }
};

OL._geRenderEmailPreview = function(value, datapoints, client) {
    if (!value) return '<span style="opacity:0.3;font-style:italic;">No body written yet. Click Edit to add content.</span>';
    
    const data = OL.getCurrentProjectData();
    const allResources = data.resources || [];

    let html = value;

    // 1. FIRST: Convert <a data-dp-key> anchors to pills (This prevents tags inside attributes from being mangled)
    html = html.replace(/<a\s+href="([^"]*)"[^>]*data-dp-key="([^"]*)"[^>]*>([\s\S]*?)<\/a>|<a\s+[^>]*data-dp-key="([^"]*)"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (fullMatch, url1, key1, text1, key2, url2, text2) => {
        const url = url1 || url2;
        const dpKey = (key1 || key2 || '').toLowerCase();
        const linkText = (text1 || text2 || '').trim();
        return `<span class="pill tiny accent is-clickable" 
                      style="display:inline-flex;align-items:center;gap:4px;font-size:10px;vertical-align:middle;cursor:pointer;"
                      onclick="window.open('${url}','_blank')">
                    <i data-lucide="link" style="width:9px;height:9px;"></i>${linkText}
                </span>`;
    });
    
    // 2. SECOND: Convert remaining plain {tags} to pills
    html = html.replace(/\{[^}]+\}/g, match => {
        const dp = datapoints.find(d => d.key === match);
        if (dp) {
            const linkedRes = dp.linkToResource 
                ? allResources.find(r => r.name === dp.linkToResource) : null;
            const url = linkedRes?.externalUrl;
            const pill = `<span class="pill tiny accent is-clickable" 
                               style="display:inline-flex;align-items:center;gap:4px;font-size:10px;vertical-align:middle;cursor:pointer;"
                               onclick="${url ? `window.open('${url}','_blank')` : `OL.openDataDetailModal('${dp.id}')`}">
                               <i data-lucide="tag" style="width:9px;height:9px;"></i>${dp.name}
                           </span>`;
            return pill;
        }
        return `<span class="pill tiny soft" style="display:inline-flex;font-size:10px;vertical-align:middle;">${match}</span>`;
    });

    return html;
};

OL._geToggleEmailBody = function(resId, mode) {
    const preview = document.getElementById(`email-body-preview-${resId}`);
    const editor  = document.getElementById(`email-body-edit-${resId}`);
    const tagsBtn = document.getElementById(`data-tags-btn-${resId}`);
    const resTagsBtn = document.getElementById(`res-tags-btn-${resId}`);
    const doneBtn = document.getElementById(`email-body-done-${resId}`);
    if (!preview || !editor) return;

    if (tagsBtn) tagsBtn.style.display = 'block';
    if (doneBtn) doneBtn.style.display = 'block';
    if (resTagsBtn) resTagsBtn.style.display = 'block';

    if (mode === 'rich') {
        preview.style.display = 'none';
        editor.style.display = 'none';
        let richEl = document.getElementById(`email-body-rich-${resId}`);
        if (!richEl) {
            richEl = document.createElement('div');
            richEl.id = `email-body-rich-${resId}`;
            richEl.contentEditable = 'true';
            richEl.style.cssText = 'min-height:160px;padding:12px;border:1px solid var(--line);border-radius:6px;font-size:12px;line-height:1.6;outline:none;background:rgba(0,0,0,0.1);';
            richEl.innerHTML = editor.value || '';
            editor.parentNode.appendChild(richEl);
        }
        // 🚀 Blur closes editor only if tag menu is closed
        richEl.onblur = function() {
            const menu = document.getElementById(`data-tag-menu-${resId}`);
            if (menu && menu.style.display === 'block') return;
            if (window._tagInserting) return;
            OL._geSaveEmailBody(resId, richEl.innerHTML);
        };
        richEl.style.display = 'block';
        richEl.focus();
    } else {
        const richEl = document.getElementById(`email-body-rich-${resId}`);
        if (richEl) richEl.style.display = 'none';
        preview.style.display = 'none';
        editor.style.display = 'block';
        // 🚀 Show sanitized HTML in editor
        const res = OL.getResourceById(resId);
        editor.value = OL._geSanitizeEmailHtml(res?.emailBody || '');
        editor.onblur = function() {
            const menu = document.getElementById(`data-tag-menu-${resId}`);
            if (menu && menu.style.display === 'block') return;
            if (window._tagInserting) return;
            OL._geSaveEmailBody(resId, editor.value);
        };
        editor.focus();
    }
};

OL._geInsertDataTag = function(resId, tag) {
    window._tagInserting = true;
    
    // 🚀 Check if this is a resource tag with a real URL
    const client = getActiveClient();
    const datapoints = [
        ...(client?.projectData?.localDatapoints?.length 
            ? client.projectData.localDatapoints 
            : (state.master.datapoints || [])),
        ...OL.getResourceDatapoints()
    ];
    const dp = datapoints.find(d => d.key === tag);
    const data = OL.getCurrentProjectData();
    const linkedRes = dp?.linkToResource
        ? (data.resources || []).find(r => r.name === dp.linkToResource)
        : null;
    const externalUrl = linkedRes?.externalUrl;

    // Build the actual insertion value
    const insertValue = externalUrl
        ? `<a href="${externalUrl}" target="_blank" data-dp-key="${tag}">${dp.name}</a>`
        : tag; // plain tag for non-resource datapoints

    const editor = document.getElementById(`email-body-edit-${resId}`);
    const richEl = document.getElementById(`email-body-rich-${resId}`);
    
    if (richEl && richEl.style.display !== 'none') {
        if (externalUrl) {
            // Insert as HTML node
            const temp = document.createElement('div');
            temp.innerHTML = insertValue;
            const node = temp.firstChild;
            const sel = window.getSelection();
            if (sel.rangeCount) {
                const range = sel.getRangeAt(0);
                range.deleteContents();
                range.insertNode(node);
                range.setStartAfter(node);
                range.collapse(true);
                sel.removeAllRanges();
                sel.addRange(range);
            } else {
                richEl.appendChild(node);
            }
        } else {
            const sel = window.getSelection();
            if (sel.rangeCount) {
                const range = sel.getRangeAt(0);
                range.deleteContents();
                range.insertNode(document.createTextNode(tag));
                range.collapse(false);
            } else {
                richEl.innerHTML += tag;
            }
        }
        OL.handleResourceSave(resId, 'emailBody', richEl.innerHTML);
        setTimeout(function() { richEl.focus(); window._tagInserting = false; }, 50);

    } else if (editor && editor.style.display !== 'none') {
        const start = editor.selectionStart;
        const end = editor.selectionEnd;
        editor.value = editor.value.substring(0, start) + insertValue + editor.value.substring(end);
        editor.selectionStart = editor.selectionEnd = start + insertValue.length;
        OL.handleResourceSave(resId, 'emailBody', editor.value);
        setTimeout(function() { editor.focus(); window._tagInserting = false; }, 50);
    } else {
        window._tagInserting = false;
    }
};

document.addEventListener('click', function(e) {
    if (!e.target.closest('[id^="data-tag-menu-"]') && !e.target.closest('[id^="data-tags-btn-"]')) {
        document.querySelectorAll('[id^="data-tag-menu-"]').forEach(el => el.style.display = 'none');
    }
    if (!e.target.closest('[id^="email-edit-menu-"]') && !e.target.closest('[id^="email-edit-btn-"]')) {
        document.querySelectorAll('[id^="email-edit-menu-"]').forEach(el => el.style.display = 'none');
    }
    // 🚀 Resource tags menu
    if (!e.target.closest('[id^="res-tag-menu-"]') && !e.target.closest('[id^="res-tags-btn-"]')) {
        document.querySelectorAll('[id^="res-tag-menu-"]').forEach(el => el.style.display = 'none');
    }
});

OL._geSanitizeEmailHtml = function(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<body>${html}</body>`, 'text/html');
    return doc.body.innerHTML;
};

OL._geSaveEmailBody = function(resId, value) {
    console.trace('_geSaveEmailBody called');
    const sanitized = OL._geSanitizeEmailHtml(value);
    OL.handleResourceSave(resId, 'emailBody', sanitized);
    
    const preview = document.getElementById(`email-body-preview-${resId}`);
    const editor  = document.getElementById(`email-body-edit-${resId}`);
    const richEl  = document.getElementById(`email-body-rich-${resId}`);
    const tagsBtn = document.getElementById(`data-tags-btn-${resId}`);
    const doneBtn = document.getElementById(`email-body-done-${resId}`);
    const resTagsBtn = document.getElementById(`res-tags-btn-${resId}`);

    const client = getActiveClient();
    const datapoints = [
        ...(client?.projectData?.localDatapoints?.length 
            ? client.projectData.localDatapoints 
            : (state.master.datapoints || [])),
        ...OL.getResourceDatapoints()
    ];

    const previewHtml = OL._geRenderEmailPreview(sanitized, datapoints, client);

    if (preview) { 
        preview.innerHTML = previewHtml;
        preview.style.display = 'block';
        if (window.lucide) window.lucide.createIcons();
    }
    if (editor)  editor.style.display  = 'none';
    if (richEl)  richEl.style.display  = 'none';
    if (tagsBtn) tagsBtn.style.display = 'none';
    if (doneBtn) doneBtn.style.display = 'none';
    if (resTagsBtn) resTagsBtn.style.display = 'none';
};

OL.promptEditLink = function(resId) {
    const data = OL.getCurrentProjectData();
    const res = (data.resources || []).find(r => String(r.id) === String(resId));
    if (!res) return;
    const url = prompt('External link URL:', res.externalUrl || '');
    if (url === null) return;
    OL.handleResourceSave(resId, 'externalUrl', url.trim());
};

OL.getResourceDatapoints = function() {
    const data = OL.getCurrentProjectData();
    const resources = (data.resources || data.localResources || []).filter(r => 
        !r.isDeleted && 
        !['Workflow', 'Zap', 'Email Campaign'].includes(r.type)
    );
    return resources.map(r => ({
        id: `res-tag-${r.id}`,
        name: r.name,
        key: `{${r.name.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()}}`,
        category: 'Resources',
        linkToResource: r.name,
        _isResourceTag: true
    }));
};

OL.renderHierarchyTree = function(resId, nodes, path = "") {
    return nodes.map((node, idx) => {
        const currentPath = path ? `${path}.${idx}` : `${idx}`;
        const isNamingLink = node.name.includes("{folderNamingConventions}");
        const client = getActiveClient();
        const namingRes = (client?.projectData?.localResources || []).find(r => r.name === "Naming Conventions");

        return `
            <div class="hierarchy-node-wrapper" style="margin-left: ${path ? '25' : '0'}px;">
                
                <div class="tree-drop-zone" 
                     ondragover="OL.handleTreeDragOver(event)" 
                     ondragleave="OL.handleTreeDragLeave(event)"
                     ondrop="OL.handleTreeDrop(event, '${resId}', '${currentPath}', 'before')"></div>

                <div class="hierarchy-item-row" 
                     draggable="true" 
                     ondragstart="OL.handleTreeDragStart(event, '${resId}', '${currentPath}')"
                     ondragover="OL.handleTreeDragOver(event)"
                     ondragleave="OL.handleTreeDragLeave(event)"
                     ondrop="OL.handleTreeDrop(event, '${resId}', '${currentPath}', 'inside')"
                     style="display:flex; align-items:center; gap:8px; padding: 6px; background: ${isNamingLink ? 'rgba(var(--accent-rgb), 0.1)' : 'rgba(0,0,0,0.2)'}; border-radius: 4px; border: 1px solid ${isNamingLink ? 'var(--accent)' : 'rgba(255,255,255,0.05)'};">
                    
                    <span class="drag-handle" style="cursor:grab; opacity:0.3;">⠿</span>
                    <span style="display: flex; align-items: center; justify-content: center; width: 16px; height: 16px;">
                        <i data-lucide="${node.children?.length > 0 ? 'folder-open' : 'folder'}" 
                           style="width: 14px; height: 14px; color: ${node.children?.length > 0 ? 'var(--accent)' : 'var(--text-dim)'};">
                        </i>
                    </span>
                    
                    <input type="text" class="tiny-input" 
                           value="${esc(node.name)}" 
                           ${isNamingLink ? 'readonly' : ''}
                           style="flex:1; background:transparent; border:none; color: ${isNamingLink ? 'var(--accent)' : 'white'}; font-weight: ${isNamingLink ? 'bold' : 'normal'}; outline:none;"
                           onblur="OL.updateTreeNode('${resId}', '${currentPath}', this.value)">

                    ${isNamingLink && namingRes ? `
                        <button class="btn tiny primary" style="font-size:7px; padding: 2px 6px;" 
                                onclick="event.stopPropagation(); OL.openResourceModal('${namingRes.id}')">
                            VIEW RULES ➔
                        </button>
                    ` : ''}
                    
                    <div class="hierarchy-actions">
                        <button class="btn-icon-tiny" onclick="OL.addFolderNode('${resId}', '${currentPath}')">+</button>
                        ${!isNamingLink ? `<button class="btn-icon-tiny danger" onclick="OL.removeTreeNode('${resId}', '${currentPath}')">×</button>` : ''}
                    </div>
                </div>

                ${idx === nodes.length - 1 ? `
                    <div class="tree-drop-zone" 
                         ondragover="OL.handleTreeDragOver(event)" 
                         ondragleave="OL.handleTreeDragLeave(event)"
                         ondrop="OL.handleTreeDrop(event, '${resId}', '${currentPath}', 'after')"></div>
                ` : ''}
                
                <div class="node-children">
                    ${node.children ? OL.renderHierarchyTree(resId, node.children, currentPath) : ''}
                </div>
            </div>
        `;
    }).join('');
    
    if (window.lucide) {
        window.lucide.createIcons();
    }
};

OL.addFolderNode = function(resId, path = null) {
    const res = OL.getResourceById(resId);
    if (!res.tree) res.tree = [];

    if (path === null) {
        res.tree.push({ id: uid(), name: "New Folder", children: [] });
    } else {
        // Deep find the node in the nested array
        const keys = path.split('.');
        let target = res.tree;
        keys.forEach((key, i) => {
            if (i === keys.length - 1) {
                if (!target[key].children) target[key].children = [];
                target[key].children.push({ id: uid(), name: "New Sub-folder", children: [] });
            } else {
                target = target[key].children;
            }
        });
    }
    OL.persist();
    OL.openResourceModal(resId);
};

OL.updateTreeNode = function(resId, path, value) {
    const res = OL.getResourceById(resId);
    const keys = path.split('.');
    let target = res.tree;
    keys.forEach((key, i) => {
        if (i === keys.length - 1) target[key].name = value;
        else target = target[key].children;
    });
    OL.persist();
};

OL.removeTreeNode = function(resId, path) {
    const res = OL.getResourceById(resId);
    const keys = path.split('.');
    const lastKey = keys.pop();
    let parent = res.tree;
    keys.forEach(key => parent = parent[key].children);
    
    if (confirm(`Delete "${parent[lastKey].name}" and all nested folders?`)) {
        parent.splice(lastKey, 1);
        OL.persist();
        OL.openResourceModal(resId);
    }
};

// 🚠 DRAG & DROP LOGIC
OL.handleTreeDragStart = function(e, resId, path) {
    e.dataTransfer.setData("text/plain", path);
    e.stopPropagation();
};

OL.handleTreeDrop = function(e, resId, targetPath, position) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.classList.remove('drag-over');

    const sourcePath = e.dataTransfer.getData("text/plain");
    if (!sourcePath || sourcePath === targetPath) return;

    const res = OL.getResourceById(resId);
    if (!res || !res.tree) return;

    // 🚀 THE RESET: We deep clone the tree to manipulate it safely
    const newTree = JSON.parse(JSON.stringify(res.tree));

    const getItemByPath = (tree, path) => {
        const parts = path.split('.').map(Number);
        let parent = { children: tree };
        let target = tree;
        let index = parts[parts.length - 1];

        for (let i = 0; i < parts.length; i++) {
            parent = (i === 0) ? { children: tree } : target;
            target = parent.children[parts[i]];
        }
        return { parent: parent.children, index: parts[parts.length - 1], item: target };
    };

    try {
        // 1. Snip the source
        const source = getItemByPath(newTree, sourcePath);
        const movedItem = source.parent.splice(source.index, 1)[0];

        // 2. Re-calculate target (indices might have shifted)
        // We use the original path but handle the offset if moved within same parent
        const target = getItemByPath(newTree, targetPath);

        if (position === 'inside') {
            if (!target.item.children) target.item.children = [];
            target.item.children.push(movedItem);
        } else {
            const insertIdx = (position === 'after') ? target.index + 1 : target.index;
            target.parent.splice(insertIdx, 0, movedItem);
        }

        // 3. Update State & UI
        res.tree = newTree;
        OL.persist();
        OL.openResourceModal(resId);

    } catch (err) {
        console.error("📋 Hierarchy Sync Error:", err);
        // Fallback: If logic breaks, just re-open to sync UI with data
        OL.openResourceModal(resId);
    }
};

// UI Feedback Helpers
OL.handleTreeDragOver = function(e) {
    e.preventDefault();
    e.currentTarget.classList.add('drag-over');
};

OL.handleTreeDragLeave = function(e) {
    e.currentTarget.classList.remove('drag-over');
};

OL.handleConventionUpdate = function(resId, section, key, value) {
    const res = OL.getResourceById(resId);
    if (res) {
        if (!res.data) res.data = {};
        if (!res.data[section]) res.data[section] = {};
        
        res.data[section][key] = value.trim();
        OL.persist();
        console.log(`✅ Naming Convention Saved: ${section} -> ${key}`);
    }
};

OL.updateContainerFile = function(resId, fileIdx, field, value) {
    const res = OL.getResourceById(resId);
    if (res && res.files && res.files[fileIdx]) {
        res.files[fileIdx][field] = value.trim();
        OL.persist();
    }
};

OL.addFileToContainer = function(resId) {
    const res = OL.getResourceById(resId);
    if (res) {
        if (!res.files) res.files = [];
        res.files.push({ name: "New Document", url: "", id: uid() });
        OL.persist();
        OL.openResourceModal(resId);
    }
};

OL.removeFileFromContainer = function(resId, idx) {
    const res = OL.getResourceById(resId);
    if (res && res.files && confirm("Remove this document entry?")) {
        res.files.splice(idx, 1);
        OL.persist();
        OL.openResourceModal(resId);
    }
};

OL.simulateUpload = function(resId, idx) {
    // Note: Actual PDF binary upload requires Firebase Storage.
    // For now, we prompt for a link (Google Drive/Dropbox).
    const url = prompt("Please enter the Google Drive or Dropbox link for this PDF:");
    if (url) {
        OL.updateContainerFile(resId, idx, 'url', url);
        OL.openResourceModal(resId);
    }
};

OL.addResourceComment = async function(resId, isClientFacing = false) {
    const input = document.getElementById(`new-comment-input-${resId}`);
    const text = input.value.trim();
    if (!text) return;

    const res = OL.getResourceById(resId);
    const client = getActiveClient();
    if (!res) return;

    // 🕵️ AUTHOR RESOLUTION
    let authorName = "Team Member";
    if (window.FORCE_ADMIN) {
        authorName = "Sphynx Team";
    } else if (window.IS_GUEST && client) {
        authorName = client.meta.name; // Uses the Company Name from Registry
    }

    if (!res.comments) res.comments = [];
    
    res.comments.push({
        author: authorName,
        text: text,
        timestamp: new Date().toISOString(),
        isClientFacing: isClientFacing // 🔒 Visibility Flag
    });

    await OL.persist();
    input.value = "";
    // Save current tab preference to state so it doesn't flip back on refresh
    state.v2.activeCommentTab = isClientFacing ? 'client' : 'internal';
    OL.openResourceModal(resId);
};

OL.renderResourceMiniMaps = function(targetResId) {
    const data = OL.getCurrentProjectData();
    const resources = data.resources || [];
    const currentRes = resources.find(r => String(r.id) === String(targetResId));
    if (!currentRes) return "";

    const incomingLinks = new Set();
    const outgoingLinks = new Set();

    // 🕵️ 1. CRAWL FOR CONNECTIONS
    resources.forEach(res => {
        (res.steps || []).forEach(step => {
            (step.logic?.out || []).forEach(link => {
                const parts = link.targetId?.split('-');
                if (!parts) return;
                parts.pop(); // Remove step index
                const tResId = parts.join('-');

                // If this resource points TO our current resource
                if (String(tResId) === String(targetResId)) {
                    incomingLinks.add(res.id);
                }
                // If our current resource points TO this resource
                if (String(res.id) === String(targetResId)) {
                    outgoingLinks.add(tResId);
                }
            });
        });
    });

    // 2. Resolve objects for rendering
    const leftNodes = Array.from(incomingLinks).map(id => resources.find(r => r.id === id)).filter(Boolean);
    const rightNodes = Array.from(outgoingLinks).map(id => resources.find(r => r.id === id)).filter(Boolean);

    // 3. Build the Grid HTML...
    return `
        <div class="card-section" style="margin-top:20px; border-top:1px solid var(--line); padding-top:20px;">
            <label class="modal-section-label">🕸️ RELATIONSHIP MAP</label>
            <div class="mini-map-grid" style="display: grid; grid-template-columns: 1fr 30px 1.2fr 30px 1fr; align-items: center; gap: 5px; margin-top: 15px;">
                
                <div style="display: flex; flex-direction: column; gap: 8px;">
                    ${leftNodes.length > 0 ? leftNodes.map(n => renderMiniNode(n, 'muted')).join('') : '<div class="tiny muted center italic">No Inputs</div>'}
                </div>

                <div class="mini-arrow">${leftNodes.length > 0 ? '→' : ''}</div>

                <div style="display: flex; justify-content: center;">
                    ${renderMiniNode(currentRes, 'active')}
                </div>

                <div class="mini-arrow">${rightNodes.length > 0 ? '→' : ''}</div>

                <div style="display: flex; flex-direction: column; gap: 8px;">
                    ${rightNodes.length > 0 ? rightNodes.map(n => renderMiniNode(n, 'muted')).join('') : '<div class="tiny muted center italic">No Outputs</div>'}
                </div>
            </div>
        </div>`;
};

// Helper to render the individual blocks
function renderMiniNode(res, status) {
    if (!res) return "";
    const isActive = status === 'active';
    const iconName = OL.getRegistryIcon(res.type);
    
    const bgTint = isActive ? 'rgba(251, 191, 36, 0.15)' : 'rgba(var(--text-rgb), 0.05)';
    const borderColor = isActive ? 'var(--accent)' : 'var(--line)';

    return `
        <div class="mini-node ${status} ${isMilestone ? 'is-milestone' : ''}" 
             onclick="event.stopPropagation(); OL.openResourceModal('${res.id}')"
             style="cursor:pointer; padding:8px; border-radius:8px; background:${bgTint}; border:1px solid ${borderColor}; min-width:120px; position:relative;">
            <div style="display:flex; flex-direction:column; align-items:center; gap:4px;">
                ${OL.getLucideSVG(iconName, 14, isActive ? 'var(--accent)' : 'currentColor')}
                <div class="mini-node-text" title="${esc(res.name)}">
                    ${esc(res.name)}
                </div>
                <div style="font-size:8px; text-transform:uppercase; color:var(--text-muted); font-weight:bold;">
                    ${res.type}
                </div>
            </div>
        </div>
    `;
}

// HANDLE WOKRFLOW VISUALIZER / FULL SCREEN MODE
// Global Workspace Logic
OL.goToResourceInMap = function(resId) {
    // 1. Detect where we are right now before we switch to the map
    const currentHash = window.location.hash;
    let returnPath = "/scoping-sheet"; // Default fallback

    if (currentHash.includes('resources')) {
        returnPath = "/resources";
    } else if (currentHash.includes('scoping-sheet')) {
        returnPath = "/scoping-sheet";
    }

    // 2. Save it to session storage so it survives the view change
    sessionStorage.setItem('map_return_path', returnPath);

    // 3. Proceed with existing logic
    OL.closeModal(); 
    OL.focusedResourceId = String(resId);
    
    if (typeof OL.setView === 'function') OL.setView('map');
    OL.renderVisualizer();
    
    setTimeout(() => {
        if (typeof OL.centerCanvasNode === 'function') OL.centerCanvasNode(resId);
    }, 150);
};

OL.navigateBack = function() {
    const history = JSON.parse(sessionStorage.getItem('ol_nav_history') || '[]');
    if (history.length < 2) {
        OL.closeModal(); // Nowhere to go back to
        return;
    }
    
    history.pop(); // Remove current view
    const prev = history.pop(); // Get previous view
    sessionStorage.setItem('ol_nav_history', JSON.stringify(history));

    if (prev.type === 'resource') OL.openResourceModal(prev.id);
    else if (prev.type === 'step') OL.openStepDetailModal(prev.resId, prev.id);
};

OL.trackNav = function(id, type, resId = null) {
    let history = JSON.parse(sessionStorage.getItem('ol_nav_history') || '[]');
    // Prevent duplicate entries if refreshing same item
    if (history.length > 0 && history[history.length - 1].id === id) return;
    
    history.push({ id, type, resId });
    if (history.length > 10) history.shift(); // Keep history lean
    sessionStorage.setItem('ol_nav_history', JSON.stringify(history));
};

OL.clearNavHistory = function() {
    sessionStorage.removeItem('ol_nav_history');
    console.log("🧹 Navigation stack reset.");
};

// Filter for Signature resources within the project
OL.filterSignatureSearch = function(resId, query) {
    const listEl = document.getElementById("sig-search-results");
    if (!listEl) return;
    const q = (query || "").toLowerCase();
    const client = getActiveClient();
    
    const sigs = (client.projectData.localResources || []).filter(r => 
        (r.type || "").toLowerCase() === "signature" && r.name.toLowerCase().includes(q)
    );

    listEl.innerHTML = sigs.map(s => `
        <div class="search-result-item" onmousedown="OL.linkSignature('${resId}', '${s.id}', '${esc(s.name)}')">
            ✍️ ${esc(s.name)}
        </div>
    `).join('') || '<div class="search-result-item muted">No signatures found. Create one typed "Signature" first!</div>';
};

// Link a Signature resource to an Email resource
OL.linkSignature = function(resId, sigId, sigName) {
    const res = OL.getResourceById(resId);
    if (res) {
        res.signatureId = sigId;
        res.signatureName = sigName;
        OL.persist();
        // Clear results and re-open modal to show change
        const results = document.getElementById("sig-search-results");
        if (results) results.innerHTML = "";
        OL.openResourceModal(resId);
    }
};

// 📧 THE PREVIEW ENGINE
OL.previewEmailTemplate = function(resId) {
    const res = OL.getResourceById(resId);
    if (!res) return;

    const client = getActiveClient();
    
    // 🚀 NEW LOGIC: Pull signature from the selected Team Member
    const sender = (client?.projectData?.teamMembers || []).find(m => m.id === res.emailFrom);
    const signatureContent = sender?.signature 
        ? `<div style="margin-top:20px; border-top:1px solid #eee; padding-top:15px; color:#555; font-style: normal;">${esc(sender.signature).replace(/\n/g, '<br>')}</div>` 
        : `<div class="tiny muted italic" style="margin-top:20px; color:#999;">(No signature defined for ${sender?.name || 'this sender'})</div>`;

    const previewHtml = `
        <div class="modal-head">
            <div class="modal-title-text">📧 Email Preview</div>
        </div>
        <div class="modal-body" style="background: #fff; color: #333; padding: 40px; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; border-radius: 0 0 8px 8px;">
            <div style="border-bottom: 1px solid #eee; padding-bottom: 15px; margin-bottom: 20px; font-size: 13px;">
                <div style="margin-bottom:5px;"><b style="color:#888;">To:</b> [${res.emailToType || 'Recipient'}]</div>
                <div><b style="color:#888;">Subject:</b> ${esc(res.emailSubject || '(No Subject)')}</div>
            </div>
            <div style="line-height: 1.6; font-size: 15px; color:#222;">${res.emailBody || '...'}</div>
            ${signatureContent}
            <div style="margin-top: 40px; text-align: center; border-top: 1px solid #eee; padding-top: 20px;">
                <button class="btn small soft" style="color:black !important;" onclick="OL.openResourceModal('${resId}')">← Back to Editor</button>
            </div>
        </div>
    `;
    window.openModal(previewHtml);
};

OL.copyToClipboard = function(text, btn) {
    navigator.clipboard.writeText(text).then(() => {
        const originalText = btn.innerText;
        btn.innerText = "✅ Copied!";
        btn.style.color = "var(--accent)";
        
        setTimeout(() => {
            btn.innerText = originalText;
            btn.style.color = "";
        }, 2000);
    }).catch(err => {
        console.error('Failed to copy: ', err);
    });
};

OL.logResourceEdit = function(resId, field, oldVal, newVal) {
    const data = OL.getCurrentProjectData();
    const res = (data.resources || []).find(r => String(r.id) === String(resId));
    if (!res) return;
    if (!res.editHistory) res.editHistory = [];
    const user = state.adminMode ? (state.master?.adminName || 'Admin') : 'You';
    res.editHistory.unshift({
        id: 'eh-' + Date.now(),
        user,
        field,
        oldVal: oldVal ?? null,
        newVal: newVal ?? null,
        ts: Date.now()
    });
    // Keep last 50 entries only
    if (res.editHistory.length > 50) res.editHistory = res.editHistory.slice(0, 50);
};

OL.handleResourceSave = function(id, field, value) {
    const data = OL.getCurrentProjectData();
    const res = data.resources.find(r => String(r.id) === String(id));
    
    if (res) {
        // 🌐 THE SAFETY SHIELD INTERCEPTOR
        // If the resource is global and an event forces a track lane shift on the root object,
        // short-circuit the execution to prevent it from vanishing from other workflows!
        if (res.isGlobal && (field === 'stageId' || field === 'workflowId')) {
            console.warn(`🛡️ Global Protection Guard: Aborted root mutation [${field}: ${value}] on resource "${res.name}". Workflow arrays handle this placement.`);
            
            // Still force a quick visual refresh to snap the card back into its correct track line if it visually moved
            if (window.location.hash.includes('visualizer')) {
                OL.renderVisualizer();
            }
            return; 
        }

        const oldVal = res[field];
        OL.logResourceEdit(id, field, oldVal, value);
        res[field] = value;
        
        OL.persist().then(() => {
            const modalOpen = document.getElementById('active-modal-box');
            const inspectorOpen = document.getElementById('v2-inspector-panel')?.classList.contains('open');
            const isVisualizer = window.location.hash.includes('visualizer');
            const isResources = window.location.hash.includes('resources');
            
            if (modalOpen) {
                // 🚀 Don't re-render modal for email body edits — it destroys the editor
                const emailFields = ['emailBody', 'emailFrom', 'emailToType', 'emailSubject'];
                if (!emailFields.includes(field)) {
                    OL.openResourceModal(id);
                }
            } else if (inspectorOpen && isVisualizer) {
                OL._fvOpenStepsList(id);
                if (field === 'stageId') setTimeout(() => OL.renderVisualizer(), 100);
            } else if (inspectorOpen && !isVisualizer) {
                OL.openInspector(id, null, 'cards');
            } else if (isResources) {
                renderResourceManager();
            } else if (isVisualizer) {
                OL.renderVisualizer();
            }
        });
    }
};

OL.renderEditHistory = function(res) {
    const entries = res.editHistory || [];
    if (!entries.length) return `<div style="font-size:12px;color:var(--color-text-secondary);text-align:center;padding:30px 0;">No changes recorded yet.</div>`;

    const timeAgo = (ts) => {
        const diff = Date.now() - ts;
        const m = Math.floor(diff / 60000);
        const h = Math.floor(diff / 3600000);
        const d = Math.floor(diff / 86400000);
        if (m < 1) return 'just now';
        if (m < 60) return `${m}m ago`;
        if (h < 24) return `${h}h ago`;
        if (d < 7) return `${d}d ago`;
        return new Date(ts).toLocaleDateString([], {month:'short', day:'numeric'});
    };

    const fieldLabel = (f) => ({
        name: 'Name', type: 'Type', appId: 'App', appName: 'App',
        stageId: 'Stage', description: 'Description', externalUrl: 'External link',
        isArchived: 'Archived', dueDate: 'Due date'
    }[f] || f);

    return entries.map(e => {
        const initials = e.user.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
        const isYou = e.user === 'You' || e.user === 'Admin';
        const avatarBg = isYou ? '#E1F5EE' : '#E6F1FB';
        const avatarColor = isYou ? '#0F6E56' : '#185FA5';

        let changeHtml = '';
        if (e.field === 'isArchived') {
            changeHtml = e.newVal 
                ? `Resource <strong>archived</strong>` 
                : `Resource <strong>unarchived</strong>`;
        } else if (e.oldVal === null || e.oldVal === undefined || e.oldVal === '') {
            changeHtml = `<span style="color:var(--color-text-secondary)">${fieldLabel(e.field)}</span> set to <span style="color:#0F6E56;font-weight:500">${esc(String(e.newVal || ''))}</span>`;
        } else if (e.newVal === null || e.newVal === undefined || e.newVal === '') {
            changeHtml = `<span style="color:var(--color-text-secondary)">${fieldLabel(e.field)}</span> cleared`;
        } else {
            changeHtml = `
                <span style="color:var(--color-text-secondary)">${fieldLabel(e.field)}</span> changed from
                <span style="text-decoration:line-through;color:var(--color-text-secondary)">${esc(String(e.oldVal))}</span> to
                <span style="color:#0F6E56;font-weight:500">${esc(String(e.newVal))}</span>
            `;
        }

        return `
            <div style="padding:10px 0;border-bottom:0.5px solid var(--color-border-tertiary);display:flex;gap:10px;">
                <div style="width:24px;height:24px;border-radius:50%;background:${avatarBg};color:${avatarColor};
                            font-size:10px;font-weight:500;display:flex;align-items:center;justify-content:center;
                            flex-shrink:0;margin-top:1px;">
                    ${initials}
                </div>
                <div style="flex:1;min-width:0;">
                    <div style="font-size:11px;font-weight:500;margin-bottom:3px;">
                        ${esc(e.user)} 
                        <span style="font-size:10px;color:var(--color-text-secondary);font-weight:400;">${timeAgo(e.ts)}</span>
                    </div>
                    <div style="font-size:11px;line-height:1.5;">${changeHtml}</div>
                </div>
            </div>
        `;
    }).join('');
};

// 4. RESOURCE CARD & FOLDER RENDERERS
window.renderVaultRatesPage = function () {
  const container = document.getElementById("mainContent");
  if (!container) return;
    container.style.cssText = '';
    document.body.classList.remove('is-visualizer');

  document.body.classList.remove('is-visualizer', 'fs-mode-active');
  document.body.style.overflow = 'auto';
  document.documentElement.style.overflow = 'auto';

  const rates = state.master.rates || {};
  const registry = state.master.resourceTypes || [];
  const variables = rates.variables || {};

  container.innerHTML = `
        <div class="section-header">
            <div>
                <h2>💰 Scoping Variable Library</h2>
                <div class="small muted">Manage technical pricing per Resource Type</div>
            </div>
            <div class="header-actions">
                <button class="btn small soft" onclick="OL.openResourceTypeManager()">⚙️ Types</button>
                <button class="btn primary" onclick="OL.addRegistryType()">+ Add New Type</button>
            </div>
        </div>

        <div class="cards-grid" style="margin-top:20px;">
            ${registry
              .map((type) => {
                const varCount = Object.values(variables).filter(
                  (v) => v.applyTo === type.type,
                ).length;
                return `
                    <div class="card is-clickable" onclick="OL.openTypeDetailModal('${type.type}')">
                        <div class="card-header">
                            <div class="card-title" style="text-transform: uppercase; color: var(--accent);">📁 ${esc(type.type)}</div>
                            <button class="card-delete-btn" onclick="event.stopPropagation(); OL.removeRegistryTypeByKey('${type.typeKey}')">×</button>
                        </div>
                        <div class="card-body">
                            <div class="small muted">${varCount} variables defined</div>
                            <button class="btn small soft full-width" style="margin-top:12px;">Manage Rates ➔</button>
                        </div>
                    </div>
                `;
              })
              .join("")}
        </div>
    `;
};

OL.addRegistryType = function () {
  const name = prompt("New Resource Type Name (e.g. Email Campaign):");
  if (!name) return;
  const typeKey = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
  if (!state.master.resourceTypes) state.master.resourceTypes = [];
  state.master.resourceTypes.push({ type: name, typeKey: typeKey });
  OL.persist();
  renderVaultRatesPage();
};

OL.updateResourcePricingData = function(targetId, varKey, value) {
    const numVal = parseFloat(value);
    const client = getActiveClient();
    if (!client) return;
  
    // 1. Identify the Source: Prioritize the project's Scoping Sheet
    const sheet = client?.projectData?.scopingSheets?.[0];
    let targetObj = sheet?.lineItems.find(i => i.id === targetId);

    // 2. Fallback: If not a line item, check Master and Local Resource libraries
    if (!targetObj) {
        targetObj = OL.getResourceById(targetId);
    }

    if (targetObj) {
        // Ensure data object exists to prevent 'undefined' errors
        if (!targetObj.data) targetObj.data = {};
        
        // Update value
        targetObj.data[varKey] = isNaN(numVal) ? 0 : numVal;
        
        // 🛡️ CRITICAL: Save to permanent storage
        OL.persist();
        
        console.log(`✅ Data Persisted: [${targetId}] ${varKey} = ${targetObj.data[varKey]}`);

        // 3. UI Sync: If in Scoping view, update background fees immediately
        if (window.location.hash.includes('scoping-sheet')) {
            renderScopingSheet();
        }
    } else {
        console.error("❌ Persistence Error: Target ID not found in current context.");
    }
};

OL.renameResourceType = function (oldNameEncoded, newName, archetype, isEncoded = false) {
  // 1. Decode the old name if it came from the encoded manager row
  const oldName = isEncoded ? atob(oldNameEncoded) : oldNameEncoded;
  const cleanNewName = (newName || "").trim();

  // 🛡️ Safety Guard: Stop if name is empty or unchanged
  if (!cleanNewName || oldName === cleanNewName) return;

  const isVaultMode = window.location.hash.includes("vault");
  const resources = isVaultMode
    ? state.master.resources || []
    : getActiveClient()?.projectData?.localResources || [];

  // 2. Cascade Update: Resources
  resources.forEach((r) => {
    if (r.type === oldName && r.archetype === archetype) {
      r.type = cleanNewName;
      // Also update the typeKey for internal indexing
      r.typeKey = cleanNewName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "")
        .trim();
    }
  });

  // 3. Cascade Update: Rates Library
  if (state.master.rates?.variables) {
    Object.values(state.master.rates.variables).forEach((v) => {
      if (
        v.applyTo === oldName &&
        (v.archetype === archetype || !v.archetype)
      ) {
        v.applyTo = cleanNewName;
        v.archetype = archetype; // Lock it to the current archetype
      }
    });
  }

  OL.persist();
  console.log(
    `✅ Renamed type: "${oldName}" -> "${cleanNewName}" in ${archetype}`,
  );
};

// 5. PUSH TO MASTER / IMPORT FROM MASTER
window.OL.pushToMaster = async function(localResId) {
    const client = getActiveClient();
    const localRes = client?.projectData?.localResources?.find(r => r.id === localResId);

    if (!localRes || !state.adminMode) return;
    if (!confirm("Standardize " + localRes.name + "?")) return;

    await OL.updateAndSync(() => {
        const masterId = 'res-vlt-' + Date.now();
        const masterCopy = JSON.parse(JSON.stringify(localRes));
        
        masterCopy.id = masterId;
        masterCopy.createdDate = new Date().toISOString();
        masterCopy.originProject = client.meta.name;
        delete masterCopy.masterRefId; 
        delete masterCopy.isScopingContext; 

        if (!state.master.resources) state.master.resources = [];
        state.master.resources.push(masterCopy);

        localRes.masterRefId = masterId;
        localRes.isGlobal = true;

        const projectResources = OL.getCurrentProjectData().resources || [];
        const allSources = [
            ...(client.projectData.localHowTo || []),
            ...(client.projectData.localResources || []),
            ...(state.master.howToLibrary || []),
            ...(state.master.resources || [])
        ];

        projectResources.forEach(res => {
            if (!res.steps || res.steps.length === 0) {
                const match = allSources.find(s => 
                    (s.name === res.name || s.id === res.masterRefId) && 
                    s.steps && s.steps.length > 0
                );
                if (match) {
                    res.steps = JSON.parse(JSON.stringify(match.steps));
                }
            }
        });
    });

    if (client.projectData?.scopingSheets?.[0]?.lineItems) {
        client.projectData.scopingSheets[0].lineItems.forEach(item => {
            if (String(item.resourceId) === String(localResId)) {
                item.status = item.status || "Do Now";
                item.responsibleParty = item.responsibleParty || "Sphynx";
            }
        });
    }

    OL.closeModal();
    if (typeof renderResourceManager === 'function') renderResourceManager(); 
    OL.renderVisualizer();
};

OL.filterMasterResourceImport = function(query) {
    const listEl = document.getElementById("master-res-import-results");
    if (!listEl) return;

    const q = (query || "").toLowerCase().trim();
    const client = getActiveClient();
    
    // 🛡️ Smart Filter: Only show what isn't already imported
    const existingMasterRefs = (client?.projectData?.localResources || []).map(r => r.masterRefId);
    const available = (state.master.resources || []).filter(r => 
        r.name.toLowerCase().includes(q) && !existingMasterRefs.includes(r.id)
    );

    listEl.innerHTML = available.map(res => `
        <div class="search-result-item" onmousedown="OL.executeResourceImport('${res.id}')">
            <div style="display:flex; justify-content:space-between; width:100%; align-items:center;">
                <span>🛠️ ${esc(res.name)}</span>
                <span class="pill tiny soft">${esc(res.type)}</span>
            </div>
        </div>
    `).join('') || `<div class="search-result-item muted">${q ? 'No matches' : 'All resources imported'}</div>`;
};

OL.importFromMaster = function() {
    const html = `
        <div class="modal-head">
            <div class="modal-title-text">📥 Import Master Resource</div>
            <div class="spacer"></div>
            <button class="btn small soft" onclick="OL.closeModal()">Cancel</button>
        </div>
        <div class="modal-body">
            <div class="search-map-container">
                <input type="text" class="modal-input" 
                       placeholder="Click to view library or search..." 
                       onfocus="OL.filterMasterResourceImport('')"
                       oninput="OL.filterMasterResourceImport(this.value)" 
                       autofocus>
                <div id="master-res-import-results" class="search-results-overlay" style="margin-top:10px;"></div>
            </div>
        </div>
    `;
    openModal(html);
};

OL.executeResourceImport = function(masterId) {
    const template = state.master.resources.find(r => r.id === masterId);
    const client = getActiveClient();
    if (!template || !client) return;

    // 🚀 THE BREAK: Deep clone the template so it becomes a unique project object
    const newRes = JSON.parse(JSON.stringify(template));
    
    // Assign a unique local ID
    const timestamp = Date.now();
    newRes.id = `local-prj-${timestamp}`;
    
    // Track lineage (optional, for UI tags) but keep data separate
    newRes.masterRefId = masterId; 
    
    if (!client.projectData.localResources) client.projectData.localResources = [];
    client.projectData.localResources.push(newRes);

    OL.persist();
    OL.closeModal();
    renderResourceManager(); 
};

OL.universalDelete = async function(id, type, options = {}) {
    const res = OL.getResourceById(id);
      if (res && res.isLocked) {
          alert("🔒 This is a required Sphynx system resource and cannot be removed.");
          return;
      }
    const { event, isFunction, name } = options;
    if (event) event.stopPropagation();

    const context = OL.getCurrentContext(); // Uses your existing context helper
    const client = getActiveClient();
    const isVaultRoute = context.isMaster;
    
    // 1. Determine if this is a Master Reference inside a Project
    const isMasterItem = String(id).startsWith('master-') || 
                         String(id).startsWith('fn-') || 
                         String(id).startsWith('res-vlt-') || 
                         String(id).startsWith('ht-vlt-');

    // 🛡️ SCENARIO A: Unlinking a Master Template from a Local Project
    if (isMasterItem && !isVaultRoute && client) {
        const msg = `Remove this Master ${type} from ${client.meta.name}?\n\n(This will NOT delete the global template from the Vault)`;
        if (!confirm(msg)) return;

        await OL.updateAndSync(() => {
            if (type === 'apps' || type === 'functions' || type === 'how-to') {
                client.sharedMasterIds = (client.sharedMasterIds || []).filter(mid => mid !== id);
            }
        });
        return OL.refreshActiveView();
    }

    // 🛡️ SCENARIO B: Permanent Deletion (Local items or Master items deleted from the Vault)
    const label = name || type.slice(0, -1); // "apps" becomes "app"
    let confirmMsg = isVaultRoute 
        ? `⚠️ PERMANENT VAULT DELETE: "${label}"\n\nThis removes the source for ALL projects. This cannot be undone.`
        : `Delete "${label}" from this project?`;

    if (isFunction && isVaultRoute) confirmMsg = `⚠️ WARNING: This will permanently remove the "${label}" Master Function from the Vault registry. Proceed?`;
    if (!confirm(confirmMsg)) return;

    await OL.updateAndSync(() => {
        const data = context.data;

        switch (type) {
            case 'resources':
                const resArray = isVaultRoute ? data.resources : data.localResources;
                if (resArray) {
                    const idx = resArray.findIndex(r => r.id === id);
                    if (idx > -1) resArray.splice(idx, 1);
                }
                break;

            case 'apps':
                const appArray = isVaultRoute ? data.apps : data.localApps;
                if (appArray) {
                    const idx = appArray.findIndex(a => a.id === id);
                    if (idx > -1) appArray.splice(idx, 1);
                }
                break;

            case 'functions':
                if (isVaultRoute) {
                    data.functions = (data.functions || []).filter(f => f.id !== id);
                } else {
                    data.localFunctions = (data.localFunctions || []).filter(f => f.id !== id);
                }
                break;

            case 'how-to':
                if (isVaultRoute) {
                    data.howToLibrary = (data.howToLibrary || []).filter(h => h.id !== id);
                } else {
                    data.localHowTo = (data.localHowTo || []).filter(h => h.id !== id);
                }
                break;

            case 'category':
            case 'feature':
                // Handles the globalContentManager logic
                (data.analyses || []).forEach(anly => {
                    if (type === 'category') {
                        anly.categories = anly.categories?.filter(c => c !== name);
                        anly.features?.forEach(f => { if (f.category === name) f.category = "General"; });
                        if (isFunction && isVaultRoute) {
                            data.functions = (data.functions || []).filter(f => f.name !== name);
                        }
                    } else {
                        anly.features = anly.features?.filter(f => f.name !== name);
                    }
                });
                break;
        }
    });

    // 🔄 Post-Delete UI Cleanup
    if (type === 'category' || type === 'feature') OL.openGlobalContentManager();
    OL.refreshActiveView();
};

//======================RESOURCES / TASKS OVERLAP ======================//


//======================= ANALYSIS MATRIX SECTION =======================//

if (!state.master.analyses) state.master.analyses = [];

// 1. RENDER ANALYSIS LIBRARY AND CARDS
window.renderAnalysisModule = function(isVaultMode = false) {
    OL.registerView(renderAnalysisModule);
    const container = document.getElementById("mainContent");
    
    // 🚀 THE FIX: Use hash check if isVaultMode wasn't explicitly passed
    const isActuallyVault = isVaultMode || window.location.hash.startsWith('#/vault');
    const client = isActuallyVault ? null : getActiveClient();
    
    if (!isActuallyVault && !client) return;
    if (!container) return;
    container.style.cssText = '';
    document.body.classList.remove('is-visualizer');

    const masterTemplates = state.master.analyses || [];
    
    // 🏗️ Determine which templates and local analyses to show
    const templatesToDisplay = isActuallyVault 
        ? masterTemplates 
        : masterTemplates.filter(t => client?.sharedMasterIds?.includes(t.id));

    const localAnalyses = (!isActuallyVault && client) ? (client.projectData.localAnalyses || []) : [];

    container.innerHTML = `
        <div class="section-header" style="display:flex; align-items:center; gap:12px;">
            <i data-lucide="${isActuallyVault ? 'library' : 'bar-chart-horizontal'}" 
               style="width:28px; height:24px; color:var(--accent);"></i>
            <div style="flex:1;">
                <h2 style="margin:0;">
                    ${isActuallyVault ? 'Master Analysis Library' : 'Feature Analysis & Comparison'}
                </h2>
                <div class="small muted subheader">
                    ${isActuallyVault ? 'Global templates for standardized scoring' : `Helping ${esc(client?.meta.name)} find the right fit`}
                </div>
            </div>
            <div class="header-actions">
                <button class="btn small soft" onclick="OL.openGlobalContentManager()" style="margin-right: 8px; display:inline-flex; align-items:center;" title="Manage Global Content">
                    <i data-lucide="settings" style="width:16px; height:16px;"></i>
                </button>
                ${isActuallyVault ? 
                    `<button class="btn primary" onclick="OL.createNewMasterAnalysis()" style="display:inline-flex; align-items:center; gap:6px;">
                        <i data-lucide="plus" style="width:14px; height:14px;"></i> Create Template
                     </button>` : 
                    `<button class="btn small soft" onclick="OL.createNewAnalysisSandbox()" style="display:inline-flex; align-items:center; gap:6px;">
                        <i data-lucide="plus" style="width:14px; height:14px;"></i> Local Analysis
                     </button>
                     <button class="btn primary" onclick="OL.importAnalysisFromVault()" style="margin-right:8px; display:inline-flex; align-items:center; gap:6px;">
                        <i data-lucide="download-cloud" style="width:14px; height:14px;"></i> Import from Master
                     </button>`
                }
            </div>
        </div>

        <div class="cards-grid">
            ${templatesToDisplay.map(anly => renderAnalysisCard(anly, true)).join('')}
            ${!isActuallyVault ? localAnalyses.map(anly => renderAnalysisCard(anly, false)).join('') : ''}
            ${(templatesToDisplay.length === 0 && localAnalyses.length === 0) ? '<div class="empty-hint">No analyses found.</div>' : ''}
        </div>

        <div id="activeAnalysisMatrix" class="matrix-container" style="margin-top: 40px;"></div>
    `;
    if (window.lucide) {
        window.lucide.createIcons();
    }
};

window.renderAnalysisCard = function (anly, isMaster) {
    const client = getActiveClient();
    const featCount = (anly.features || []).length;
    const appsInMatrix = anly.apps || [];
    const appCount = (anly.apps || []).length;

    const allApps = [
        ...(state.master.apps || []),
        ...(client?.projectData?.localApps || [])
    ];
    
    // Standardized tag styling
    const tagLabel = isMaster ? "MASTER" : "LOCAL";
    const tagStyle = isMaster 
        ? "background: var(--accent); color: white; border: none;" 
        : "background: var(--panel-border); color: var(--text-dim); border: 1px solid var(--line);";

    return `
        <div class="card is-clickable" onclick="OL.openAnalysisMatrix('${anly.id}', ${isMaster})">
            <div class="card-header">
                <div class="card-title card-title-${anly.id}">${esc(anly.name)}</div>
                <div style="display:flex; align-items:center; gap:8px;">
                    <span class="vault-tag" style="${tagStyle}">${tagLabel}</span>
                    <button class="card-delete-btn" onclick="event.stopPropagation(); OL.deleteAnalysis('${anly.id}', ${isMaster})">×</button>
                </div>
            </div>
            <div class="card-body">
                <div style="display: flex; gap: 12px; margin-bottom: 10px;">
                    <div class="tiny muted">
                        <b style="color: var(--text-main);">${featCount}</b> Features
                    </div>
                    <div class="tiny muted">
                        <b style="color: var(--text-main);">${appCount}</b> Apps
                    </div>
                </div>

                ${anly.summary ? `
                    <div class="tiny muted italic" style="margin-bottom: 10px; border-left: 2px solid var(--accent); padding-left: 8px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">
                        "${esc(anly.summary)}"
                    </div>
                ` : ''}

                <div class="pills-row">
                    ${(anly.apps || []).map(aObj => {
                        const matchedApp = allApps.find(a => a.id === aObj.appId);
                        if (!matchedApp) return '';

                        return `
                            <span class="pill tiny soft is-clickable" 
                                  style="font-size: 9px; opacity: 0.8; cursor: pointer;"
                                  onclick="event.stopPropagation(); OL.openAppModal('${matchedApp.id}')">
                                ${esc(matchedApp.name)}
                            </span>`;
                    }).join('')}
                </div>
            </div>
        </div>
    `;
};

OL.syncMatrixName = function(el) {
    const matrixId = el.getAttribute('data-m-id');
    const newName = el.innerText;
    
    // Find all elements with this matrix ID class and update them
    const relatedElements = document.querySelectorAll(`.m-name-${matrixId}`);
    relatedElements.forEach(item => {
        if (item !== el) {
            item.innerText = newName;
        }
    });
};

// 2. ANALYSIS CORE ACTIONS
OL.createNewMasterAnalysis = function () {
  const name = prompt("Enter Master Template Name:");
  if (!name) return;

  state.master.analyses.push({
    id: "master-anly-" + Date.now(),
    name: name,
    features: [],
    apps: [],
    categories: ["General"],
    createdDate: new Date().toISOString(),
  });

  OL.persist();
  renderAnalysisModule(true);
};

OL.createNewAnalysisSandbox = function () {
  const name = prompt("Name your Analysis (e.g., CRM Comparison):");
  if (!name) return;

  const client = getActiveClient();
  if (!client.projectData.localAnalyses) client.projectData.localAnalyses = [];

  client.projectData.localAnalyses.push({
    id: "anly-" + Date.now(),
    name: name,
    features: [],
    apps: [],
    categories: ["General"],
    createdDate: new Date().toISOString(),
  });

  OL.persist();
  renderAnalysisModule(false);
};

OL.deleteAnalysis = async function (anlyId, isVaultMode) {
    if (!confirm("Are you sure you want to delete this analysis?")) return;

    // 🚀 THE SHIELD: Wrap in updateAndSync to bypass the Muzzle
    await OL.updateAndSync(() => {
        if (isVaultMode) {
            state.master.analyses = state.master.analyses.filter(a => a.id !== anlyId);
        } else {
            const client = getActiveClient();
            if (client?.projectData?.localAnalyses) {
                client.projectData.localAnalyses = client.projectData.localAnalyses.filter(a => a.id !== anlyId);
            }
        }
    });

    // 🧹 UI Cleanup
    const container = document.getElementById("activeAnalysisMatrix");
    if (container) container.innerHTML = ""; // Wipe the matrix from view immediately
    
    state.activeMatrixId = null;
    window.isMatrixActive = false; // 🔓 Release the lock

    renderAnalysisModule(isVaultMode);
    console.log("🗑️ Analysis deleted and persisted.");
};

OL.filterMasterAnalysisImport = function(query) {
    const listEl = document.getElementById("master-anly-import-results");
    if (!listEl) return;

    const q = (query || "").toLowerCase().trim();
    const client = getActiveClient();
    
    const existingRefs = (client?.projectData?.localAnalyses || [])
        .map(a => String(a.masterRefId))
        .filter(Boolean);

    const available = (state.master.analyses || []).filter(t => 
        (t.name || "").toLowerCase().includes(q) && 
        !existingRefs.includes(String(t.id))
    );

    listEl.innerHTML = available.length ? available.map(anly => `
        <div class="search-result-item" onmousedown="OL.executeAnalysisImportById('${anly.id}')">
            <div>
                <strong>${esc(anly.name)}</strong>
                <div class="tiny muted">${(anly.apps||[]).length} apps · ${(anly.features||[]).length} features</div>
            </div>
        </div>
    `).join('') : `<div class="search-result-item muted">No templates found.</div>`;
};

OL.importAnalysisFromVault = function () {
    const html = `
        <div class="modal-head" style="display:flex; align-items:center; gap:12px; padding: 20px;">
            <i data-lucide="download-cloud" style="width:20px; height:20px; color:var(--accent);"></i>
            <div class="modal-title-text">Import Analysis Template</div>
            <div class="spacer"></div>
            <button class="btn small soft" onclick="OL.closeModal()">Cancel</button>
        </div>
        <div class="modal-body">
            <div class="search-map-container">
                <div style="position:relative; display:flex; align-items:center;">
                    <i data-lucide="search" style="position:absolute; left:12px; width:14px; height:14px; opacity:0.4;"></i>
                    <input type="text" class="modal-input" 
                           style="padding-left:35px;"
                           placeholder="Search templates (e.g. CRM, AI)..." 
                           onfocus="OL.filterMasterAnalysisImport('')"
                           oninput="OL.filterMasterAnalysisImport(this.value)" 
                           autofocus>
                </div>
                <div id="master-anly-import-results" class="search-results-overlay" style="margin-top:10px;"></div>
            </div>
        </div>
    `;
    openModal(html);

    // 🚀 THE REPAINT: Convert tags to SVGs
    if (window.lucide) {
        window.lucide.createIcons();
    }
};

// Helper to handle the specific ID from search
OL.executeAnalysisImportById = async function(templateId) {
    const template = state.master.analyses.find(t => String(t.id) === String(templateId));
    const client = getActiveClient();
    
    if (!template || !client) {
        console.error("❌ Import Failed: Missing template or client context.");
        return;
    }

    // 1. Deep Clone the template to create the project-specific version
    const newAnalysis = JSON.parse(JSON.stringify(template));
    newAnalysis.id = "anly-" + Date.now();
    newAnalysis.masterRefId = templateId;
    newAnalysis.isMaster = false;

    // Initialize localApps if missing
    if (!client.projectData.localApps) client.projectData.localApps = [];

    // 🚀 2. THE ATOMIC PROVISIONING LOOP
    if (newAnalysis.apps) {
        for (let i = 0; i < newAnalysis.apps.length; i++) {
            const matrixAppEntry = newAnalysis.apps[i];
            
            // Try to find the app in the Project already (by masterRef or Name)
            let localApp = client.projectData.localApps.find(la => 
                String(la.masterRefId) === String(matrixAppEntry.appId) || 
                la.name.toLowerCase() === (matrixAppEntry.name || "").toLowerCase()
            );

            if (!localApp) {
                // 🏗️ DISCOVERY: App missing from project. Find source in Master Vault.
                const masterSource = state.master.apps.find(ma => 
                    String(ma.id) === String(matrixAppEntry.appId) || 
                    ma.name.toLowerCase() === (matrixAppEntry.name || "").toLowerCase()
                );

                if (masterSource) {
                    console.log(`🚚 Deploying: ${masterSource.name}`);
                    localApp = {
                        ...JSON.parse(JSON.stringify(masterSource)),
                        id: 'local-app-' + Date.now() + Math.random().toString(36).substr(2, 5),
                        masterRefId: masterSource.id,
                        notes: `(Auto-deployed via ${template.name} Import)`
                    };
                    client.projectData.localApps.push(localApp);
                }
            }

            // 🎯 WIRE THE MATRIX TO THE LOCAL APP
            if (localApp) {
                newAnalysis.apps[i].appId = localApp.id;
                newAnalysis.apps[i].name = localApp.name; // Crucial for label rendering
                
                // Copy pricing to the app card if it's currently $0
                if (!localApp.monthlyCost || localApp.monthlyCost === 0) {
                    localApp.monthlyCost = matrixAppEntry.monthlyCost || 0;
                }
            } else {
                // ⚠️ LAST RESORT: If no master source found, preserve the name so it isn't "Unknown"
                newAnalysis.apps[i].name = matrixAppEntry.name || "Unknown Tool";
                console.warn(`⚠️ App "${newAnalysis.apps[i].name}" not found in Vault. Label preserved but unlinked.`);
            }
            
            // Clear evaluative scores for the fresh import
            newAnalysis.apps[i].scores = {};
        }
    }

    // 3. Save the new Analysis to the project
    if (!client.projectData.localAnalyses) client.projectData.localAnalyses = [];
    client.projectData.localAnalyses.push(newAnalysis);

    // 4. Force a hard save and immediate refresh
    await OL.persist();
    
    // UI Cleanup
    OL.closeModal();
    
    // 🔄 Switch to the newly imported matrix immediately
    setTimeout(() => {
        if (typeof renderAnalysisModule === "function") renderAnalysisModule(false);
        OL.openAnalysisMatrix(newAnalysis.id, false);
    }, 100);
};

OL.pushMatrixToMasterLibrary = function(anlyId) {
    const client = getActiveClient();
    const anly = (client?.projectData?.localAnalyses || []).find(a => a.id === anlyId);

    if (!anly) return;

    if (!confirm(`Push "${anly.name}" to Master Vault? This will include pricing and features for ${anly.apps?.length || 0} tools.`)) return;

    // 1. Create a deep clone
    const masterCopy = JSON.parse(JSON.stringify(anly));
    masterCopy.id = 'master-anly-' + Date.now();
    masterCopy.isMaster = true;
    
    // 🚀 THE FIX: Keep the apps but clear the client-specific scores
    if (masterCopy.apps) {
        masterCopy.apps = masterCopy.apps.map(app => {
            // Ensure we capture the name from the project app if it's missing in the matrix
            const appCard = client.projectData.localApps.find(la => la.id === app.appId);
            return {
                ...app,
                name: app.name || appCard?.name || "Unknown Tool",
                scores: {}, 
                featureScores: {} 
            };
        });
    }

    // 2. Save to Master State
    if (!state.master.analyses) state.master.analyses = [];
    state.master.analyses.push(masterCopy);

    OL.persist().then(() => {
        alert(`✅ "${anly.name}" saved to Vault with app data.`);
        window.location.hash = '#/vault/analyses';
        renderAnalysisModule(true);
    });
};

OL.deleteMasterAnalysis = function(anlyId) {
    if (!confirm("Are you sure you want to permanently delete this Master Template? It will no longer be available for import into new client projects.")) return;

    state.master.analyses = (state.master.analyses || []).filter(a => a.id !== anlyId);
    
    OL.persist();
    renderAnalysisModule(true); // Refresh the Vault view
};

// 3. OPEN INDIVIDUAL ANALYSIS MATRIX
OL.openAnalysisMatrix = function(analysisId, isMaster) {
    window.isMatrixActive = true;

    if (state.activeMatrixId === analysisId && 
        document.querySelector('.matrix-table')) {
        return;
    }
    
    state.activeMatrixId = analysisId;
    
    const client = getActiveClient();
    const source = isMaster ? state.master.analyses : (client?.projectData?.localAnalyses || []);
    const anly = source.find(a => a.id === analysisId);

    if (!anly) return console.error("Analysis not found:", analysisId);

    const container = document.getElementById("activeAnalysisMatrix");
    if (!container) return;
    container.style.cssText = '';
    document.body.classList.remove('is-visualizer');

    // 🏆 CALCULATIONS
    const totalWeight = (anly.features || []).reduce((sum, f) => sum + (parseFloat(f.weight) || 0), 0);
    const appResults = (anly.apps || []).map(appObj => ({
        appId: appObj.appId,
        total: parseFloat(OL.calculateAnalysisScore(appObj, anly.features || []))
    }));
    const topScore = Math.max(...appResults.map(r => r.total), 0);

    const appCount = (anly.apps || []).length;
    const compCount = (anly.competitors || []).length;

    // 🚀 THE FIX: Dynamic Colspan Calculation
    // Total = Feature Name (1) + Weight (1) + Apps count + Competitors count
    const totalColspan = 2 + appCount + compCount;

    let html = `
        <div class="matrix-interaction-wrapper" onclick="event.stopPropagation()">
            <div class="card matrix-card-main" style="border-top: 3px solid var(--accent); padding: 20px; margin-bottom: 40px;">
                <div class="section-header">
                    <div>
                        <h3 style="display:flex; align-items:center; gap:10px;">
                            <i data-lucide="bar-chart-horizontal" style="width:20px; height:20px; color:var(--accent);"></i>
                            Matrix: 
                            <span contenteditable="true" 
                                    class="editable-matrix-name m-name-${analysisId}"
                                    data-m-id="${analysisId}"
                                    style="border-bottom: 1px dashed var(--accent); cursor: text;"
                                    oninput="OL.syncMatrixName(this)"
                                    onblur="OL.renameMatrix('${analysisId}', this.innerText, ${isMaster})">
                                ${esc(anly.name)}
                            </span>
                        </h3>
                        <div class="subheader">Scores: 0 (N/A), 1 (<60%), 2 (60-80%), 3 (80%+)</div>
                    </div>
                    <div class="header-actions" style="display:flex; align-items:center; gap:8px;">
                        ${!isMaster && state.adminMode ? `
                            <button class="btn tiny warn" onclick="OL.pushMatrixToMasterLibrary('${analysisId}')" style="display:flex; align-items:center; gap:4px;">
                                <i data-lucide="upload-cloud" style="width:12px; height:12px;"></i> Push to Vault
                            </button>` : ''}
                        <button class="btn tiny primary" onclick="OL.universalPrint('${analysisId}', ${isMaster})" style="display:flex; align-items:center; gap:4px;">
                            <i data-lucide="printer" style="width:12px; height:12px;"></i> Print
                        </button>
                        <button class="btn tiny soft" onclick="OL.addAppToAnalysis('${analysisId}', ${isMaster})" style="display:flex; align-items:center; gap:4px;">
                            <i data-lucide="plus" style="width:12px; height:12px;"></i> App
                        </button>
                        <button class="btn tiny danger soft" onclick="document.getElementById('activeAnalysisMatrix').innerHTML='';" style="margin-left:10px; height:24px; width:24px; display:flex; align-items:center; justify-content:center;">
                            <i data-lucide="x" style="width:14px; height:14px;"></i>
                        </button>
                    </div>
                </div>

                <table class="matrix-table" style="width: 100%; margin-top: 20px; border-collapse: collapse; table-layout: fixed;">
                   <thead>
                        <tr>
                            <th style="text-align: left; width: 220px;">Features</th>
                            <th style="text-align: center; width:60px;">Weight</th>

                            ${(anly.apps || []).map(appObj => {
                                const allApps = [...(state.master.apps || []), ...(client?.projectData?.localApps || [])];
                                const matchedApp = allApps.find(a => a.id === appObj.appId);
                                const isWinner = topScore > 0 && appResults.find(r => r.appId === appObj.appId)?.total === topScore;

                                return `
                                    <th class="text-center" style="${isWinner ? 'background: rgba(251, 191, 36, 0.05);' : ''}">
                                        <div style="display:flex; flex-direction:column; align-items:center; gap:5px;">
                                            <button class="card-delete-btn" onclick="OL.removeAppFromAnalysis('${analysisId}', '${appObj.appId}', ${isMaster})">×</button>
                                            <span class="is-clickable" onclick="OL.openAppModal('${matchedApp?.id}')" style="${isWinner ? 'color: var(--vault-gold); font-weight: bold;' : ''}">
                                                ${isWinner ? '⭐ ' : ''}${esc(matchedApp?.name || 'Unknown')}
                                            </span>
                                        </div>
                                    </th>`;
                            }).join('')}
                        </tr>
                    </thead>
                    <tbody>
                        <tr class="category-header-row" style="background: rgba(var(--accent-rgb), 0.1); border-bottom: 1px solid var(--line);">
                            <td colspan="${totalColspan}" style="padding: 10px 12px;">
                                <div style="display: flex; align-items: center; gap: 8px;">
                                    <i data-lucide="banknote" style="width:14px; height:14px; color:var(--accent);"></i>
                                    <span style="color: var(--accent); font-weight: bold; text-transform: uppercase; font-size:11px; letter-spacing:0.1em;">PRICING & TIERS DEFINITION</span>
                                </div>
                            </td>
                        </tr>

                        <tr style="background: rgba(255,255,255,0.02); vertical-align: top;">
                            <td colspan="2" style="padding: 15px; color: var(--muted); font-size: 11px; line-height: 1.4;">
                                <strong>Rate Card:</strong><br>Aailable plan tiers and cost for each provider.
                            </td>
                            ${(anly.apps || []).map(appObj => {
                                const tiers = appObj.pricingTiers || [];
                                return `
                                    <td style="padding: 10px; border: 1px solid var(--line);">
                                        <div class="app-rate-card">                                           
                                            <div class="stacked-tiers-list" style="display:flex; flex-direction:column; gap:2px;">
                                                ${tiers.map((t, idx) => `
                                                    <div class="tier-entry" style="position:relative; padding: 4px; border-radius: 4px; margin-bottom: 6px; background: rgba(255,255,255,0.02); border: 1px solid var(--panel-border);">
                                                        <button class="card-delete-btn" onclick="OL.removeAppTier('${analysisId}', '${appObj.appId}', ${idx})" 
                                                                style="position:absolute; top:-6px; right:-6px; background:var(--bg); border:1px solid var(--panel-border); border-radius:50%; color:var(--danger); cursor:pointer; font-size:12px; width:18px; height:18px; display:flex; align-items:center; justify-content:center; z-index: 10;">×</button>
                                                        
                                                        <div style="display:flex; flex-wrap: wrap; align-items: center; gap:4px; width: 100%;">
                                                            
                                                            <input type="text" class="price-input-tiny" 
                                                                style="flex: 1 1 80px; min-width: 0; color: var(--text-main); background:transparent; border: none; font-size: 10px; padding: 2px 4px; font-weight: 600;" 
                                                                placeholder="Tier Name" value="${esc(t.name)}" 
                                                                onblur="OL.updateAppTier('${analysisId}', '${appObj.appId}', ${idx}, 'name', this.value)">
                                                            
                                                            <div style="display:flex; align-items:center; gap:2px; flex: 0 0 auto; background: rgba(0,0,0,0.2); padding: 2px 6px; border-radius: 4px; margin-left: auto;">
                                                                <span class="tiny muted" style="font-size: 9px; opacity: 0.5;">$</span>
                                                                <input type="number" class="price-input-tiny" 
                                                                    style="width: 45px; color: var(--accent); background:transparent; border: none; text-align: right; font-size: 10px; padding: 0; font-weight: bold; outline: none;" 
                                                                    placeholder="0" value="${t.price}" 
                                                                    onblur="OL.updateAppTier('${analysisId}', '${appObj.appId}', ${idx}, 'price', this.value)">
                                                            </div>
                                                        </div>
                                                    </div>
                                                `).join('')}
                                                <button class="btn tiny soft full-width" style="margin-top:4px; font-size:9px; border-style:dashed;" 
                                                        onclick="OL.addAppTier('${analysisId}', '${appObj.appId}')">+ Add Tier</button>
                                            </div>
                                        </div>
                                    </td>`;
                            }).join('')}
                            ${(anly.competitors || []).map(() => `<td style="border: 1px solid var(--line);"></td>`).join('')}
                        </tr>

                        ${renderAnalysisMatrixRows(anly, analysisId, isMaster, totalColspan)}
                        <tr style="background: rgba(255,255,255,0.02);">
                            <td style="padding: 15px 10px;">
                                <button class="btn tiny soft" onclick="OL.addFeatureToAnalysis('${analysisId}', ${isMaster})">+ Add Feature</button>
                            </td>
                            <td class="bold center" style="color: ${Math.abs(totalWeight - 100) < 0.1 ? 'var(--success)' : 'var(--danger)'}; border: 1px solid var(--line); font-weight: bold; padding:.5%;">
                                ${totalWeight.toFixed(1)}%
                                <div id="balance-button" onclick="OL.equalizeAnalysisWeights('${analysisId}', ${isMaster})" 
                                style="cursor:pointer; font-size: 10px; margin-top: 4px; color: var(--accent); border: 1px solid var(--accent); border-radius: 8px; margin-left:auto; margin-right:auto; padding-top: 15%; padding-bottom: 15%; width: 50%">⚖️</div>
                            </td>
                            ${(anly.apps || []).map(appObj => {
                                const score = OL.calculateAnalysisScore(appObj, anly.features || []);
                                return `
                                    <td class="text-center" style="border: 1px solid var(--line); vertical-align: middle;">
                                        <div style="font-size: 9px; color: var(--muted); margin-bottom: 4px; font-weight: bold;">TOTAL SCORE</div>
                                        <span class="pill ${score > 2.5 ? 'accent' : 'soft'}" data-app-total="${appObj.appId}">${score}</span>
                                    </td>`;
                            }).join('')}
                            ${(anly.competitors || []).map(() => `<td style="border: 1px solid var(--line);"></td>`).join('')}
                        </tr>

                        <tr style="background: rgba(var(--accent-rgb), 0.1);">
                            <td colspan="2" style="text-align: right; padding: 15px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; color: var(--accent);">
                                Est. Monthly Total Cost
                            </td>
                            ${(anly.apps || []).map(appObj => {
                                const cost = OL.calculateAppTotalCost(appObj);
                                return `
                                    <td class="text-center" style="border: 1px solid var(--line); padding: 15px 5px;">
                                        <div id="cost-display-${appObj.appId}" style="font-size: 1.2rem; font-weight: bold; color: var(--accent);">
                                            $${cost.toLocaleString()}
                                        </div>
                                        <div style="font-size: 9px; opacity: 0.6; margin-top: 2px;">PER USER / MO</div>
                                    </td>`;
                            }).join('')}
                            ${(anly.competitors || []).map(() => `<td style="border: 1px solid var(--line);"></td>`).join('')}
                        </tr>
                    </tbody>
                </table>

                <div class="executive-summary-wrapper" style="margin-top: 30px; padding: 20px; border-radius: 8px; border: 1px solid var(--line);">
                    <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 12px;">
                        <label class="modal-section-label" style="margin: 0; font-size: 1rem; color: var(--accent);">Executive Summary & Recommendations</label>
                    </div>
                    <textarea class="modal-textarea matrix-notes-auto" 
                            placeholder="Add your final analysis notes or decision rationale here..."
                            oninput="this.style.height = 'auto'; this.style.height = this.scrollHeight + 'px'"
                            onblur="OL.updateAnalysisMeta('${analysisId}', 'summary', this.value, ${isMaster})"
                            style="display: block; width: 100%; min-height: 100px;">${esc(anly.summary || "")}</textarea>
                </div>
            </div>
        </div>
    `;
    const isAlreadyOpen = container.innerHTML !== "" && state.activeMatrixId === analysisId;                            

    container.innerHTML = html;
    if (!isAlreadyOpen) {
        container.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    state.activeMatrixId = analysisId;

    requestAnimationFrame(() => {
        // Only resize textareas that are actually in the viewport
        const textareas = document.querySelectorAll('.matrix-notes-auto');
        textareas.forEach(el => {
            el.style.height = '28px'; // Set a fixed small default instead of auto-calculating
        });
    
        if (typeof OL.refreshMatrixTotals === 'function') {
            OL.refreshMatrixTotals(analysisId);
        }
    
        if (window.lucide) window.lucide.createIcons();
        console.log("⚡ Matrix interactivity initialized.");
    });
}

OL.updateAnalysisMeta = async function(anlyId, field, value, isMaster) {
    const client = getActiveClient();
    const source = isMaster ? state.master.analyses : (client?.projectData?.localAnalyses || []);
    const anly = source.find(a => a.id === anlyId);
    if (!anly) return;

    anly[field] = value.trim();
    OL.persist();

    // Only do surgical DOM updates, never re-render the whole matrix
    if (field === 'name') {
        const cardTitle = document.querySelector(`.card-title-${anlyId}`);
        if (cardTitle) cardTitle.innerText = value.trim();
        // Update the editable span in the matrix header too
        const nameSpan = document.querySelector(`.m-name-${anlyId}`);
        if (nameSpan && nameSpan !== document.activeElement) nameSpan.innerText = value.trim();
    }
};

OL.getCategorySortWeight = function(catName) {
    const normalized = (catName || "General").trim().toUpperCase();
    
    // 💡 Define your priority order here (Lower number = Higher on the page)
    const priorityMap = {
        "GENERAL": 10,
        "SECURITY": 20,
        "INTEGRATIONS": 30,
        "RATINGS": 900,
        "SUMMARY": 910
    };

    return priorityMap[normalized] || 100; // Default categories go to the middle (100)
};

window.renderAnalysisMatrixRows = function(anly, analysisId, isMaster, totalColspan) {
    const anlyId = anly.id;
    // 🛡️ Scope Fix: Force isMaster to a literal boolean string for the HTML attributes
    const masterFlag = isMaster ? true : false; 
    let currentCategory = null;
    let rowsHtml = "";

    const features = anly.features || [];
    // Sort features by category weight
    features.sort((a, b) => {
        const weightA = OL.getCategorySortWeight(a.category);
        const weightB = OL.getCategorySortWeight(b.category);
        if (weightA !== weightB) return weightA - weightB;
        return (a.category || "").localeCompare(b.category || "");
    });
    
    // We use a single loop to build the string to reduce memory overhead
    features.forEach(feat => {
        const catName = feat.category || "General";
        const featId = feat.id;

        // 1. Inject Category Header Row
        if (catName !== currentCategory) {
            currentCategory = catName;
            rowsHtml += `
                <tr class="category-header-row" style="background: rgba(255,255,255,0.03); border-bottom: 1px solid var(--line);">
                    <td colspan="${totalColspan}" style="padding: 10px 12px;">
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <span class="tiny muted">📁</span>
                            <span class="is-clickable"
                                  style="color: var(--accent); font-weight: bold; text-transform: uppercase; cursor: pointer;"
                                  onclick="OL.openCategoryManagerModal('${analysisId}', '${esc(catName)}', ${masterFlag})">
                                ${esc(catName)}
                            </span>
                        </div>
                    </td>
                </tr>
            `;
        }

        // 2. Feature Info Column
        rowsHtml += `
        <tr>
            <td style="padding-left: 28px;">
                <div style="display:flex; align-items:center; gap:8px;">
                    <button class="card-delete-btn" onclick="OL.removeFeatureFromAnalysis('${analysisId}', '${featId}', ${masterFlag})">×</button> 
                    <span class="small feature-edit-link" 
                            style="cursor: pointer; border-bottom: 1px dotted var(--muted);"
                            onclick="OL.editFeatureModal('${analysisId}', '${featId}', ${masterFlag})">
                        ${esc(feat.name)}
                        <span style="font-size: 10px; opacity: 0.3;">📝</span>
                    </span>
                </div>
                <div style="font-size: 10px; color: var(--text-dim); line-height: 1.3; font-style: italic; max-width: 260px; padding-left: 20px;">
                    ${feat.description ? esc(feat.description) : '<span style="opacity: 0.2;">No description...</span>'}
                </div>
            </td>
            <td style="padding: 0 8px; border: 1px solid var(--line); width: 100px; background:rgba(255,255,255,0.01);">
                <input type="number" 
                    class="tiny-input" 
                    style="width: 40px; background: transparent; border: none; color: var(--accent); text-align: right; font-weight: bold; font-size: 12px; outline: none;"
                    value="${feat.weight || 0}" 
                    onblur="OL.updateAnalysisFeature('${analysisId}', '${featId}', 'weight', this.value, ${masterFlag})">
            </td>`;

        // 3. Map Apps (The "Heavy" Loop)
        // Optimization: We pre-calculate common values outside the string builder
        const appCells = (anly.apps || []).map(appObj => {
            const pricing = appObj.featPricing?.[featId] || {};
            const costType = pricing.type || 'not_included'; 
            const isNotIncluded = costType === 'not_included';
            const mFlag = isMaster ? 'true' : 'false';

            return `
                <td style="padding: 6px; border: 1px solid var(--line); vertical-align: top; min-width: 140px; background: rgba(255,255,255,0.01);">
                    <div style="display: flex; flex-direction: column; gap: 6px;">                            
                        <select class="tiny-select" style="width: 100%; height: 22px;"
                            onchange="OL.handleMatrixPricingChange('${anlyId}', '${appObj.appId}', '${featId}', this.value, '${mFlag}')">
                            <option value="not_included" ${isNotIncluded ? 'selected' : ''}>Not Included</option>
                            <optgroup label="Included In:">
                                ${(appObj.pricingTiers || []).map(t => `
                                    <option value="tier|${esc(t.name)}" ${pricing.tierName === t.name ? 'selected' : ''}>
                                        Tier: ${esc(t.name)}
                                    </option>
                                `).join('')}
                            </optgroup>
                            <option value="addon" ${costType === 'addon' ? 'selected' : ''}>Add-on</option>
                        </select>

                        <textarea placeholder="Notes..." class="matrix-notes-auto"
                            oninput="this.style.height = ''; this.style.height = this.scrollHeight + 'px'"
                            onblur="OL.updateAnalysisNote('${analysisId}', '${appObj.appId}', '${featId}', this.value, ${masterFlag})"
                        >${esc(appObj.notes?.[featId] || "")}</textarea>

                        <div style="display: ${isNotIncluded ? 'none' : 'flex'}; align-items: center; gap: 8px; background: rgba(0,0,0,0.02); border-radius: 4px; padding: 2px 5px;">
                            <span style="color: var(--muted); font-size: 9px;">Score</span>
                            <input type="number" min="0" max="3" class="matrix-score-input" 
                                style="width: 100%; background: transparent; border: none; color: var(--accent); font-weight: bold; text-align: right; outline: none;"
                                value="${appObj.scores?.[featId] || 0}"
                                onblur="OL.updateAnalysisScore('${analysisId}', '${appObj.appId}', '${featId}', this.value, ${masterFlag})">
                        </div>

                        <div id="addon-price-${appObj.appId}-${featId}" 
                            style="display: ${costType === 'addon' ? 'flex' : 'none'}; align-items: center; gap: 4px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 4px;">
                            <span class="tiny muted" style="font-size: 9px;">$</span>
                            <input type="number" class="price-input-tiny" 
                                style="max-width:50px; background:transparent; border: 1px solid var(--panel-border); font-size: 10px;"
                                value="${pricing.addonPrice || 0}" 
                                onblur="OL.updateAppFeatAddonPrice('${analysisId}', '${appObj.appId}', '${featId}', this.value)">
                        </div>
                    </div>
                </td>`;
        }).join('');

        rowsHtml += appCells + `</tr>`;
    });
    return rowsHtml;
};

OL.updateAnalysisNote = async function(analysisId, appId, featId, value, isMaster) {
    const client = getActiveClient();
    
    // 1. Identify the Source
    const source = isMaster ? state.master.analyses : (client?.projectData?.localAnalyses || []);
    const anly = source.find(a => String(a.id) === String(analysisId));

    if (anly) {
        // 🚀 THE FIX: Changed 'appEntry' to 'appObj' to match the search
        const appObj = anly.apps.find(a => String(a.appId) === String(appId));
        
        if (appObj) {
            if (!appObj.notes) appObj.notes = {};
            appObj.notes[featId] = value;
            
            // ☁️ Save silently in the background
            await OL.persist(); 
            console.log("📝 Note saved surgically.");
        } else {
            console.error("App not found in analysis:", appId);
        }
    } else {
        console.error("Analysis not found:", analysisId);
    }
};

OL.universalPrint = function() {
    // 1. Identify the layout elements
    const shell = document.querySelector('.three-pane-layout');
    const sidebar = document.querySelector('.sidebar');
    const main = document.getElementById('mainContent');

    // 2. TEMPORARILY FLATTEN THE UI (The Margin Killer)
    if (shell) {
        shell.style.display = 'block'; 
        shell.style.gridTemplateColumns = 'none';
    }
    if (sidebar) sidebar.style.display = 'none';
    if (main) {
        main.style.marginLeft = '0';
        main.style.padding = '0';
        main.style.width = '100%';
    }

    // 3. Handle Textareas (Convert to readable divs so text isn't cut off)
    const textareas = document.querySelectorAll('textarea');
    const itemsToRestore = [];
    textareas.forEach((ta) => {
        const div = document.createElement('div');
        div.className = 'print-placeholder';
        div.innerText = ta.value;
        // Match standard document styling
        div.setAttribute('style', 'white-space: pre-wrap; width: 100%; display: block; color: black; padding: 5px 0; font-family: inherit; font-size: 11pt;');
        
        ta.parentNode.insertBefore(div, ta);
        
        // Save state and hide the actual input box
        itemsToRestore.push({ ta, div, originalVal: ta.value });
        ta.style.display = 'none';
        ta.value = ""; // Prevent "ghosting" repetition
    });

    // 4. TRIGGER PRINT
    setTimeout(() => {
        window.print();

        // 5. RESTORE EVERYTHING
        if (shell) {
            shell.style.display = ''; 
            shell.style.gridTemplateColumns = '';
        }
        if (sidebar) sidebar.style.display = '';
        if (main) {
            main.style.marginLeft = '';
            main.style.padding = '';
            main.style.width = '';
        }
        itemsToRestore.forEach(({ ta, div, originalVal }) => {
            div.remove();
            ta.style.display = 'block';
            ta.value = originalVal;
        });
    }, 500);
};

OL.printScopingSheet = function() {
    const client = getActiveClient();
    if (!client) return;
    const sheet = client.projectData?.scopingSheets?.[0];
    if (!sheet) return;

    const clientName = client.meta?.name || 'Scoping Sheet';
    const date = new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });
    const baseRate = client.projectData.customBaseRate || state.master.rates?.baseHourlyRate || 300;
    const vars = state.master.rates?.variables || {};

    // Group items by round
    const roundGroups = {};
    (sheet.lineItems || []).forEach(item => {
        const r = String(item.round || '1');
        if (!roundGroups[r]) roundGroups[r] = [];
        roundGroups[r].push(item);
    });
    const sortedRounds = Object.keys(roundGroups).sort((a,b) => Number(a) - Number(b));

    // Unit badges for an item — show all non-zero scoping vars regardless of resource type
    const unitBadgesHtml = (item) => {
        const combined = { ...(item.scopingData || {}), ...(item.customData || {}) };
        const badges = Object.entries(combined)
            .filter(([vid, count]) => { const v = vars[vid]; return v && Number(count) > 0; })
            .map(([vid, count]) => { const v = vars[vid]; return `<span class="unit-tag">${count} ${esc(v.label)}</span>`; })
            .join('');
        return badges ? `<div class="unit-row">${badges}</div>` : '';
    };

    // Calculate row values
    const rowGross = (item, res) => OL.calculateBaseFeeWithMultiplier(item, res);
    const rowNet   = (item, res) => OL.calculateRowFee(item, res);

    // Build rows
    let totalGross = 0, totalNet = 0, totalApproved = 0;
    let rowsHtml = '';
    sortedRounds.forEach(r => {
        let roundGross = 0, roundNet = 0;
        let roundRows = '';
        roundGroups[r].forEach(item => {
            const res = OL.getResourceById(item.resourceId);
            if (!res) return;
            const gross = rowGross(item, res);
            const net   = rowNet(item, res);
            const disc  = gross - net;
            totalGross += gross;
            totalNet   += net;
            roundGross += gross;
            roundNet   += net;

            // Approved = Do Now + (Sphynx or Joint)
            const statusLc = (item.status || '').toLowerCase().trim();
            const partyLc  = (item.responsibleParty || '').toLowerCase().trim();
            if (statusLc === 'do now' && (partyLc === 'sphynx' || partyLc === 'joint')) {
                totalApproved += net;
            }

            const multiplierLabel = (() => {
                const teamMult = item.teamMultiplier ?? state.master.rates?.teamMultiplier ?? 1;
                const parts = [];
                if (teamMult && teamMult !== 1) parts.push(`×${teamMult} team`);
                return parts.join(' · ') || '—';
            })();

            const pricingHtml = (() => {
                if (!gross && !net) return '';
                let s = `<span class="price-gross">$${gross.toLocaleString()}</span>`;
                if (disc > 0) s += `<span class="price-sep"> − </span><span class="price-disc">$${disc.toLocaleString()} disc</span>`;
                s += `<span class="price-sep"> → </span><span class="price-net">$${net.toLocaleString()}</span>`;
                return `<div class="item-pricing">${s}</div>`;
            })();

            roundRows += `<div class="item-row">
                <div class="item-body">
                    <div class="item-main">
                        <div class="item-name">${esc(res.name)}</div>
                        ${res.description ? `<div class="item-desc">${esc(res.description)}</div>` : ''}
                        ${unitBadgesHtml(item)}
                        ${pricingHtml}
                    </div>
                    <div class="item-meta">
                        <span class="mc-status meta-pill status-${(item.status||'').toLowerCase().replace(/\s+/g,'-')}">${esc(item.status || '—')}</span>
                        <span class="mc-party meta-pill party">${esc(item.responsibleParty || '—')}</span>
                        <span class="mc-mult meta-pill muted">${multiplierLabel}</span>
                    </div>
                </div>
            </div>`;
        });

        rowsHtml += `<div class="round-block">
            <div class="round-header">
                <span class="round-title">Round ${r}</span>
                <span class="round-totals">Gross $${roundGross.toLocaleString()} · Net <strong>$${roundNet.toLocaleString()}</strong></span>
            </div>
            ${roundRows}
        </div>`;
    });

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>${esc(clientName)} — Scoping Sheet</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Inter', -apple-system, sans-serif; font-size: 11px;
       color: #0f172a; background: #fff; padding: 28px 32px; }
@page { size: auto landscape; margin: 12mm 10mm; }

.print-header { display: flex; justify-content: space-between; align-items: flex-end;
                border-bottom: 2px solid #0f172a; padding-bottom: 12px; margin-bottom: 24px; }
.ph-title { font-size: 20px; font-weight: 800; }
.ph-sub { font-size: 11px; color: #64748b; margin-top: 3px; }
.ph-meta { text-align: right; font-size: 10px; color: #94a3b8; }

.round-block { margin-bottom: 20px; break-inside: avoid; }
.round-header { display: flex; justify-content: space-between; align-items: baseline;
                padding: 6px 10px; background: #f8fafc; border-left: 3px solid #0ea5e9;
                border-radius: 0 4px 4px 0; margin-bottom: 4px; }
.round-title { font-size: 10px; font-weight: 800; text-transform: uppercase;
               letter-spacing: 0.07em; color: #0ea5e9; }
.round-totals { font-size: 9px; color: #64748b; }
.round-totals strong { color: #0f172a; font-size: 10px; }

.item-row { border-bottom: 1px solid #f1f5f9; padding: 7px 10px 7px 12px;
            break-inside: avoid; }
.item-body { display: flex; align-items: flex-start; gap: 12px; }
.item-main { flex: 1; min-width: 0; }
.item-name { font-size: 11px; font-weight: 700; color: #0f172a; line-height: 1.3; }
.item-desc { font-size: 9px; color: #64748b; margin-top: 2px; line-height: 1.4;
             font-style: italic; }
.unit-row { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
.unit-tag { font-size: 8px; font-weight: 700; text-transform: uppercase;
            border: 1px solid #e2e8f0; border-radius: 3px; padding: 1px 6px; color: #475569; }
.item-pricing { margin-top: 4px; font-size: 9px; color: #94a3b8;
                font-variant-numeric: tabular-nums; }
.price-gross { color: #94a3b8; }
.price-disc  { color: #dc2626; }
.price-net   { color: #0f172a; font-weight: 800; font-size: 10px; }
.price-sep   { color: #cbd5e1; }

.item-meta { display: flex; flex-direction: column; align-items: flex-end; gap: 4px;
             flex-shrink: 0; padding-top: 1px; }
.meta-pill { font-size: 9px; padding: 2px 7px; border-radius: 99px;
             border: 1px solid #e2e8f0; color: #475569; white-space: nowrap; }
.meta-pill.status-do-now { background: #dcfce7; border-color: #86efac; color: #15803d; }
.meta-pill.status-do-later { background: #fef9c3; border-color: #fde047; color: #854d0e; }
.meta-pill.status-don-t-do { background: #fee2e2; border-color: #fca5a5; color: #991b1b; }
.meta-pill.status-done { background: #dbeafe; border-color: #93c5fd; color: #1d4ed8; }
.mc-status { }
.mc-party  { }
.mc-mult   { color: #94a3b8; }

.grand-total { display: flex; justify-content: flex-end; gap: 32px; align-items: flex-end;
               padding: 14px 10px; border-top: 2px solid #0f172a; margin-top: 16px; }
.gt-label { font-size: 9px; font-weight: 700; text-transform: uppercase;
            letter-spacing: 0.06em; color: #64748b; display: block; margin-bottom: 2px; }
.gt-val { font-size: 16px; font-weight: 800; color: #64748b; }
.gt-val.net { color: #0f172a; }
.gt-val.approved { font-size: 22px; color: #15803d; }
</style></head><body>
<div class="print-header">
  <div><div class="ph-title">${esc(clientName)}</div><div class="ph-sub">Scoping Sheet</div></div>
  <div class="ph-meta">Generated ${date}<br>${(sheet.lineItems||[]).length} items</div>
</div>
${rowsHtml}
<div class="grand-total">
  <div><span class="gt-label">Gross</span><span class="gt-val">$${totalGross.toLocaleString()}</span></div>
  <div><span class="gt-label">Net</span><span class="gt-val net">$${totalNet.toLocaleString()}</span></div>
  <div><span class="gt-label">Approved</span><span class="gt-val approved">$${totalApproved.toLocaleString()}</span></div>
</div>
</body></html>`;

    const win = window.open('', '_blank', 'width=1100,height=850');
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 600);
};

OL.renameMatrix = function(anlyId, newName, isMaster) {
    const cleanName = newName.trim();
    if (!cleanName) return;

    const client = getActiveClient();
    const source = isMaster ? state.master.analyses : (client?.projectData?.localAnalyses || []);
    const anly = source.find(a => a.id === anlyId);

    if (anly) {
        anly.name = cleanName;
        OL.persist();
        
        // 🚀 SURGICAL DOM UPDATE:
        // Find the card title in the background grid and update it without re-rendering
        const cardTitles = document.querySelectorAll(`.card-title-${anlyId}`);
        cardTitles.forEach(el => {
            el.innerText = cleanName;
        });
        
        console.log(`💾 Matrix ${anlyId} synced to card UI: ${cleanName}`);
    }
};

// PRICING PARAMETERS //
// 🎯 Optimized Total Cost Calculation
OL.calculateAppTotalCost = function(appObj) {
    let total = 0; // 🚀 No longer starts with basePrice

    // 1. Calculate Tier Cost (High-Water Mark)
    const activeTierNames = new Set();
    if (appObj.featPricing) {
        Object.values(appObj.featPricing).forEach(p => {
            if (p.type === 'tier' && p.tierName) activeTierNames.add(p.tierName);
        });
    }

    if (activeTierNames.size > 0) {
        const tierPrices = (appObj.pricingTiers || [])
            .filter(t => activeTierNames.has(t.name))
            .map(t => parseFloat(t.price) || 0);
        
        if (tierPrices.length > 0) {
            total += Math.max(...tierPrices);
        }
    }

    // 2. Add-ons (Cumulative)
    if (appObj.featPricing) {
        Object.values(appObj.featPricing).forEach(p => {
            if (p.type === 'addon') {
                total += parseFloat(p.addonPrice || 0);
            }
        });
    }

    return total;
};

// 🎯 Refined Dropdown Logic
// Add 'isMaster' to the arguments list here 👇
OL.handleMatrixPricingChange = async function(anlyId, appId, featId, value, isMaster) {
    const client = getActiveClient();
    
    // 1. Force isMaster to a real boolean (handles 'true' vs true)
    const masterBool = (isMaster === true || isMaster === 'true');
    
    // 2. Identify the correct source
    const source = masterBool ? (state.master?.analyses || []) : (client?.projectData?.localAnalyses || []);
    
    // 3. Find the analysis using String comparison to avoid ID type issues
    const anly = source.find(a => String(a.id) === String(anlyId));
    
    if (!anly) {
        console.error("❌ Analysis not found for ID:", anlyId, "| Master Mode:", masterBool);
        // Debug: Log the available IDs so you can see why it failed
        console.log("Available IDs in source:", source.map(a => a.id));
        return;
    }

    const appInMatrix = anly.apps.find(a => String(a.appId) === String(appId));    
    if (!appInMatrix) {
        console.error("❌ App not found in this analysis:", appId);
        return;
    }
    
    // 4. Process the value
    const [type, tierName] = value.split('|');
    if (!appInMatrix.featPricing) appInMatrix.featPricing = {};
    
    appInMatrix.featPricing[featId] = {
        type: type,
        tierName: tierName || null,
        addonPrice: appInMatrix.featPricing[featId]?.addonPrice || 0
    };

    // 5. Surgical Update (UI only)
    const newCost = OL.calculateAppTotalCost(appInMatrix);
    const costEl = document.getElementById(`cost-display-${appId}`);
    if (costEl) {
        costEl.innerText = `$${newCost.toLocaleString()}`;
    }

    // 6. Persist to Cloud
    await OL.persist();
    console.log("✅ Pricing updated and persisted.");
};

// Add a new Tier to a specific App
OL.addAppTier = async function(anlyId, appId) {
    const anly = OL.getScopedAnalyses().find(a => a.id === anlyId);
    const app = anly?.apps.find(a => a.appId === appId);
    if (app) {
        if (!app.pricingTiers) app.pricingTiers = [];
        app.pricingTiers.push({ name: "New Tier", price: 0 });
    }
    OL.persist();
    OL.openAnalysisMatrix(anlyId);
};

OL.updateAppTier = async function(anlyId, appId, tierIdx, field, value) {
    const anly = OL.getScopedAnalyses().find(a => a.id === anlyId);
    const app = anly?.apps.find(a => a.appId === appId);
    if (app?.pricingTiers?.[tierIdx]) {
        app.pricingTiers[tierIdx][field] = field === 'price' ? (parseFloat(value) || 0) : value;
    }
    OL.persist();
};

OL.removeAppTier = async function(anlyId, appId, idx) {
    if (!confirm("Remove this pricing tier?")) return;
    const anly = OL.getScopedAnalyses().find(a => a.id === anlyId);
    const app = anly?.apps.find(a => a.appId === appId);
    if (app?.pricingTiers) app.pricingTiers.splice(idx, 1);
    OL.persist();
    OL.openAnalysisMatrix(anlyId);
};

OL.updateAppFeatAddonPrice = async function(anlyId, appId, featId, value) {
    const anly = OL.getScopedAnalyses().find(a => a.id === anlyId);
    const app = anly?.apps.find(a => a.appId === appId);
    if (app?.featPricing?.[featId]) {
        app.featPricing[featId].addonPrice = parseFloat(value) || 0;
    }
    OL.persist();
    OL.openAnalysisMatrix(anlyId);
};

// 4. ADD APP TO ANALYSIS OR REMOVE

OL.filterAnalysisAppSearch = function (anlyId, isMaster, query) {
    const listEl = document.getElementById("analysis-app-search-results");
    if (!listEl) return;

    const q = (query || "").toLowerCase().trim();
    const client = getActiveClient();
    
    // 1. Find the current analysis to see what's already added
    const source = isMaster ? state.master.analyses : (client?.projectData?.localAnalyses || []);
    const anly = source.find(a => a.id === anlyId);
    const existingAppIds = (anly?.apps || []).map(a => a.appId);

    // 2. Aggregate all potential apps
    let allApps = isMaster ? (state.master.apps || []) : (client?.projectData?.localApps || []);

    // 3. Filter: Name match AND not already in the matrix
    const matches = allApps.filter(app => {
        return app.name.toLowerCase().includes(q) && !existingAppIds.includes(app.id);
    });

    // 🚀 THE FIX: Initialize 'html' with the mapped results
    let html = matches.map(app => `
        <div class="search-result-item" onmousedown="OL.executeAddAppToAnalysis('${anlyId}', '${app.id}', ${isMaster})">
            <div style="display:flex; justify-content:space-between; width:100%; align-items:center;">
                <span>💻 ${esc(app.name)}</span>
                <span class="tiny-tag ${String(app.id).startsWith('local') ? 'local' : 'vault'}">
                    ${String(app.id).startsWith('local') ? 'LOCAL' : 'MASTER'}
                </span>
            </div>
        </div>
    `).join('');

    // 🚀 4. Add the "Quick Create" button if search query exists and no exact name match
    if (q.length > 0 && !allApps.some(a => a.name.toLowerCase() === q)) {
        html += `
            <div class="search-result-item create-action" 
                style="background: rgba(var(--accent-rgb), 0.1) !important; border-top: 1px solid var(--line); margin-top: 5px;"
                onmousedown="OL.executeCreateAndMap('${esc(query)}', 'analysis-app', '${anlyId}')">
                <span class="pill tiny accent">+ New</span> Create & Add "${esc(query)}"
            </div>
        `;
    }

    // 5. Apply the final string to the DOM
    listEl.innerHTML = html || `<div class="search-result-item muted">No apps found. Type to create new.</div>`;
};

OL.addAppToAnalysis = function (anlyId, isMaster) {
    const html = `
        <div class="modal-head">
            <div class="modal-title-text">💻 Add App to Matrix</div>
            <div class="spacer"></div>
            <button class="btn small soft" onclick="OL.closeModal()">Cancel</button>
        </div>
        <div class="modal-body">
            <div class="search-map-container">
                <input type="text" class="modal-input" 
                       placeholder="Click to view apps or search..." 
                       onfocus="OL.filterAnalysisAppSearch('${anlyId}', ${isMaster}, '')"
                       oninput="OL.filterAnalysisAppSearch('${anlyId}', ${isMaster}, this.value)" 
                       autofocus>
                <div id="analysis-app-search-results" class="search-results-overlay" style="margin-top:10px;"></div>
            </div>
        </div>
    `;
    openModal(html);
};

OL.executeAddAppToAnalysis = async function (anlyId, appId, isMaster) {
    // 🚀 THE SHIELD
    await OL.updateAndSync(() => {
        const source = isMaster ? state.master.analyses : getActiveClient()?.projectData?.localAnalyses || [];
        const anly = source.find((a) => a.id === anlyId);

        if (anly) {
            if (!anly.apps) anly.apps = [];
            if (!anly.apps.some((a) => a.appId === appId)) {
                anly.apps.push({ appId, scores: {} });
            }
        }
    });

    OL.closeModal();
    // 🔄 Surgical Refresh
    OL.openAnalysisMatrix(anlyId, isMaster); 
};

OL.removeAppFromAnalysis = async function(anlyId, appId, isMaster) {
    const client = getActiveClient();
    const source = isMaster ? state.master.analyses : client.projectData.localAnalyses;
    const anly = source.find(a => a.id === anlyId);
    if (!anly || !anly.apps) return;
    if (!confirm('Remove this app from the comparison?')) return;

    // 1. Update data
    anly.apps = anly.apps.filter(a => a.appId !== appId);

    // 2. Fire and forget
    OL.persist();

    // 3. Re-render immediately without waiting for Firebase
    OL.openAnalysisMatrix(anlyId, isMaster);
};

// 4b. ADD FEATURE TO ANALYSIS OR REMOVE
OL.getGlobalCategories = function() {
    const client = getActiveClient();
    
    // 1. Get explicit Functional Pillars (Master + Local)
    const masterFunctions = (state.master?.functions || []).map(f => (f.name || f).toString());
    const localFunctions = (client?.projectData?.localFunctions || []).map(f => (f.name || f).toString());
    
    // 2. Scan all Analyses for ad-hoc categories
    const analyses = [
        ...(state.master?.analyses || []),
        ...(client?.projectData?.localAnalyses || [])
    ];
    
    const analysisCategories = analyses.flatMap(anly => 
        (anly.features || []).map(feat => feat.category)
    ).filter(Boolean);

    // 3. Merge into a unique, sorted list
    return [...new Set([
        ...masterFunctions, 
        ...localFunctions, 
        ...analysisCategories
    ])].sort((a, b) => a.localeCompare(b));
};

OL.getGlobalFeatures = function() {
    const client = getActiveClient();
    const localPool = client?.projectData?.localAnalyses?.flatMap(a => a.features || []) || [];
    const masterPool = state.master.analyses?.flatMap(a => a.features || []) || [];
    const resourcePool = client?.projectData?.localResources || [];

    // Combine all names and deduplicate
    return [...new Set([
        ...localPool.map(f => f.name),
        ...masterPool.map(f => f.name),
        ...resourcePool.map(r => r.name)
    ])].sort();
};

OL.filterContentManager = function(query) {
    const q = (query || "").toLowerCase().trim();
    const groups = document.querySelectorAll('.content-manager-group');

    groups.forEach(group => {
        const catName = group.getAttribute('data-cat') || "";
        const items = group.querySelectorAll('.content-item');
        let hasVisibleFeature = false;

        // 1. Filter Individual Features
        items.forEach(item => {
            const featName = item.getAttribute('data-feat') || "";
            if (featName.includes(q) || catName.includes(q)) {
                item.style.display = 'flex';
                hasVisibleFeature = true;
            } else {
                item.style.display = 'none';
            }
        });

        // 2. Hide/Show the entire Category Group
        // Show if the category name matches OR it contains a matching feature
        group.style.display = (catName.includes(q) || hasVisibleFeature) ? 'block' : 'none';
    });
};

OL.universalFeatureSearch = function(query, anlyId, isMaster, targetElementId, excludeNames = []) {
    const listEl = document.getElementById(targetElementId);
    if (!listEl) return;

    const q = (query || "").toLowerCase().trim();
    const client = getActiveClient();

    // 🚀 THE FIX: Pull from the actual Resource Library + Analysis Features
    const allFeatures = [
        ...(client?.projectData?.localResources || []), // Brain Dump / Global list
        ...(client?.projectData?.localAnalyses || []).flatMap(a => a.features || []),
        ...(state.master.analyses || []).flatMap(a => a.features || [])
    ];

    // 🛡️ Deduplicate by Name
    const uniqueMap = new Map();
    allFeatures.forEach(f => {
        const nameKey = f.name.toLowerCase().trim();
        if (!uniqueMap.has(nameKey)) uniqueMap.set(nameKey, f);
    });

    const results = Array.from(uniqueMap.values()).filter(f => {
        const nameLower = f.name.toLowerCase();
        return nameLower.includes(q) && !excludeNames.includes(nameLower);
    });

    let html = results.map(feat => `        
        <div class="search-result-item" onmousedown="
            event.preventDefault(); event.stopPropagation();
            document.getElementById('feat-name-input').value = '${esc(feat.name)}';
            document.getElementById('feat-cat-input').value = '${esc(feat.category || "General")}';
            this.parentElement.style.display = 'none';
        ">
            ✨ ${esc(feat.name)} <span class="tiny muted">(${esc(feat.category || "General")})</span>
        </div>
    `).join('');

    if (q && !results.some(m => m.name.toLowerCase() === q)) {
        html += `<div class="search-result-item create-action" onmousedown="
            event.preventDefault(); event.stopPropagation();
            document.getElementById('${targetElementId}').style.display = 'none';
            document.getElementById('feat-cat-input').focus();
        ">
            <span class="pill tiny accent">+ New</span> Create Feature "${esc(query)}"
        </div>`;
    }

    listEl.innerHTML = html || '<div class="search-result-item muted">No new features found.</div>';
    listEl.style.display = 'block';
};

OL.unifiedAddFlow = function(query, anlyId, isMaster, excludeNames=[]) {
    const q = query.trim();
    
    // 🚀 THE FIX: Only update the RESULTS div, not the parent container.
    // This prevents the input field from being re-rendered and losing focus.
    OL.universalFeatureSearch(query, anlyId, isMaster, 'feat-search-results', excludeNames);

    const finalizeBtn = document.getElementById('finalize-btn');
    if (finalizeBtn) {
        finalizeBtn.onclick = () => {
            const featName = document.getElementById('feat-name-input')?.value.trim();
            const catName = document.getElementById('feat-cat-input')?.value.trim() || "General";
            if (!featName) return alert("Please enter a feature name.");
            OL.finalizeFeatureAddition(anlyId, featName, catName, isMaster);
        };
    }
};

OL.updateAnalysisFeature = function(anlyId, featId, key, value, isMaster) {
    // 🚀 THE SHIELD: Wrap in updateAndSync to block the Firebase "bounce-back"
    OL.updateAndSync(() => {
        const client = getActiveClient();
        const source = isMaster ? state.master.analyses : (client?.projectData?.localAnalyses || []);
        const anly = source.find(a => a.id === anlyId);

        if (anly && anly.features) {
            const feat = anly.features.find(f => f.id === featId);
            if (feat) {
                // Convert to number if updating weight, otherwise keep as string
                const val = key === 'weight' ? (parseFloat(value) || 0) : value;
                feat[key] = val;
            }
        }
    });

    // 🔄 SURGICAL REFRESH: Only redraw the table, NOT the cards
    // ❌ REMOVE ANY CALL TO: renderAnalysisModule(isMaster);
    OL.openAnalysisMatrix(anlyId, isMaster); 
    
    console.log(`✅ Updated ${key} for feature ${featId} to ${value}`);
};

OL.syncFeatureChanges = function(oldName, newData, isVault) {
    const pool = OL.getScopedAnalyses();
    pool.forEach(anly => {
        anly.features?.forEach(f => {
            if (f.name === oldName) {
                if (newData.name) f.name = newData.name;
                if (newData.category) f.category = newData.category;
                if (newData.description !== undefined) f.description = newData.description;
            }
        });
        // Always maintain sorting after a sync
        anly.features.sort((a, b) => {
            const wA = OL.getCategoryWeight(a.category || "General");
            const wB = OL.getCategoryWeight(b.category || "General");
            return (wA - wB) || (a.category || "").localeCompare(b.category || "");
        });
    });
};

OL.promptFeatureCategory = function(anlyId, featName, isMaster) {
    const html = `
        <div class="modal-head">
            <div class="modal-title-text">📁 Step 2: Category for "${esc(featName)}"</div>
        </div>
        <div class="modal-body">
            <input type="text" id="cat-focus-target" class="modal-input" 
                   placeholder="Search or create category..." 
                   oninput="OL.universalCategorySearch(this.value, 'assign-to-feature', 'feat-cat-assign-results', { anlyId: '${anlyId}', featName: '${esc(featName)}', isMaster: ${isMaster} })">
            <div id="feat-cat-assign-results" class="search-results-overlay" style="margin-top:10px;"></div>
        </div>
    `;
    openModal(html);
    
    // 🚀 THE FIX: Wait for the browser to paint the modal, then force focus
    requestAnimationFrame(() => {
        const el = document.getElementById('cat-focus-target');
        if (el) el.focus();
    });

    OL.universalCategorySearch("", 'assign-to-feature', 'feat-cat-assign-results', { 
        anlyId, featName, isMaster 
    });
};

OL.removeFeatureFromAnalysis = async function(anlyId, featId, isMaster) {
    if (!confirm("Remove this feature? All scores for this feature will be lost.")) return;
    
    const client = getActiveClient();
    const source = isMaster ? state.master.analyses : client.projectData.localAnalyses;
    const anly = source.find(a => a.id === anlyId);

    if (anly) {
        // 1. Remove the feature
        anly.features = (anly.features || []).filter(f => f.id !== featId);
        
        // 2. Clear scores for this feature from all apps
        (anly.apps || []).forEach(appObj => {
            if (appObj.scores) delete appObj.scores[featId];
            if (appObj.featPricing) delete appObj.featPricing[featId];
        });

        // 3. Fire and forget
        OL.persist();

        // 4. Re-render
        OL.openAnalysisMatrix(anlyId, isMaster);
        console.log("🗑️ Feature removed.");
    }
};

// 4c. ADD CATEGORY TO ANALYSIS OR REMOVE
OL.openCategoryManagerModal = function(anlyId, catName, isMaster) {
    const client = getActiveClient();
    const source = isMaster ? state.master.analyses : (client?.projectData?.localAnalyses || []);
    const anly = source.find(a => a.id === anlyId);
    
    // 1. Get all features in this category currently in the matrix
    const localFeatNames = (anly.features || [])
        .filter(f => (f.category || "General") === catName)
        .map(f => f.name);

    // 2. Scan Master Library for features in this category NOT in the matrix
    const masterFeats = (state.master.analyses || [])
        .flatMap(a => a.features || [])
        .filter(f => (f.category || "General") === catName && !localFeatNames.includes(f.name));
    
    // Deduplicate library results
    const uniqueLibFeats = Array.from(new Set(masterFeats.map(f => f.name)))
        .map(name => masterFeats.find(f => f.name === name));

    const html = `
        <div class="modal-head">
            <div class="modal-title-text">📁 Manage Category: ${esc(catName)}</div>
        </div>
        <div class="modal-body">
            <label class="modal-section-label">Rename Category Globally</label>
            <input type="text" id="edit-cat-name-input" class="modal-input" 
                   style="font-size: 1.1rem; font-weight: bold; color: var(--accent);"
                   value="${esc(catName)}">
            
            <div style="margin-top: 25px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                    <label class="modal-section-label" style="margin:0;">Library Suggestions</label>
                    ${uniqueLibFeats.length > 0 ? 
                        `<button class="btn tiny primary" onclick="OL.addAllFeaturesFromCategory('${anlyId}', '${esc(catName)}', ${isMaster})">Import All (${uniqueLibFeats.length})</button>` : 
                        ''}
                </div>
                
                <div style="max-height: 200px; overflow-y: auto; border: 1px solid var(--line); border-radius: 4px; background: rgba(0,0,0,0.2);">
                    ${uniqueLibFeats.length > 0 ? uniqueLibFeats.map(f => `
                        <div class="search-result-item" style="display:flex; justify-content:space-between; align-items:center;">
                            <span>✨ ${esc(f.name)}</span>
                            <button class="btn tiny soft" onclick="OL.executeAddFeature('${anlyId}', '${esc(f.name)}', ${isMaster}, '${esc(catName)}', true)">+ Add</button>
                        </div>
                    `).join('') : '<div class="padding-20 muted tiny center">All library features for this category are already in your matrix.</div>'}
                </div>
            </div>

            <div style="display:flex; gap:10px; justify-content: flex-end; margin-top: 25px; padding-top: 15px; border-top: 1px solid var(--line);">
                <button class="btn soft" onclick="OL.closeModal()">Cancel</button>
                <button class="btn primary" onclick="OL.renameFeatureCategory('${anlyId}', '${esc(catName)}', document.getElementById('edit-cat-name-input').value, ${isMaster})">Save Changes</button>
            </div>
        </div>
    `;
    openModal(html);
};

OL.addAllFeaturesFromCategory = async function(anlyId, catName, isMaster) {
    const client = getActiveClient();
    
    // 1. Pull unique feature definitions from the Master Library for this category
    const masterSource = (state.master.analyses || []).flatMap(a => a.features || []);
    const catFeatures = masterSource.filter(f => (f.category || "General") === catName);
    
    // Deduplicate the source list by name first
    const uniqueSourceFeats = Array.from(new Set(catFeatures.map(f => f.name)))
        .map(name => catFeatures.find(f => f.name === name));

    // 2. Identify destination
    const source = isMaster ? state.master.analyses : (client?.projectData?.localAnalyses || []);
    const anly = source.find(a => a.id === anlyId);

    if (anly && uniqueSourceFeats.length > 0) {
        // 🚀 THE FIX: Only identify features that don't exist in THIS analysis (any category)
        const incomingFeats = uniqueSourceFeats.filter(feat => 
            !anly.features.some(f => f.name.toLowerCase() === feat.name.toLowerCase())
        );

        if (incomingFeats.length === 0) {
            alert(`All standard features for "${catName}" are already in your matrix.`);
            return;
        }

        if (!confirm(`Import ${incomingFeats.length} new features into "${catName}"?`)) return;

        // 🛡️ THE SHIELD: Batch update
        await OL.updateAndSync(() => {
            incomingFeats.forEach(feat => {
                anly.features.push({ 
                    id: 'feat-' + Date.now() + Math.random(), 
                    name: feat.name,
                    category: catName,
                    description: feat.description || "", // Carry over the library description
                    weight: 10 
                });
            });
        });

        // 🔄 Refresh Matrix & Close Modal
        OL.openAnalysisMatrix(anlyId, isMaster); 
        OL.closeModal();
        console.log(`✅ Bulk Import: ${incomingFeats.length} features added.`);
    }
};

OL.executeAddCategoryToAnalysis = function(anlyId, catName, isMaster) {
    const client = getActiveClient();
    const source = isMaster ? state.master.analyses : (client?.projectData?.localAnalyses || []);
    const anly = source.find(a => a.id === anlyId);

    if (anly) {
        const cleanName = catName.trim();
        if (cleanName && !anly.categories.includes(cleanName)) {
            anly.categories.push(cleanName);
            anly.categories.sort();

            // 🚀 SURGICAL UI UPDATE: Manually inject the new category header row
            const tableBody = document.querySelector(".matrix-table tbody");
            if (tableBody) {
                const totalColspan = 2 + (anly.apps || []).length;
                const newRow = document.createElement('tr');
                newRow.className = "category-header-row";
                newRow.style.background = "rgba(255,255,255,0.03)";
                newRow.style.borderBottom = "1px solid var(--line)";
                newRow.innerHTML = `
                    <td colspan="${totalColspan}" style="padding: 10px 12px;">
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <span class="tiny muted">📁</span>
                            <span style="color: var(--accent); font-weight: bold; text-transform: uppercase;">
                                ${esc(cleanName)}
                            </span>
                        </div>
                    </td>
                `;
                // Append it to the end of the current feature list
                tableBody.appendChild(newRow);
            }

            OL.persist();
        }
        OL.closeModal();
    }
};

// 5. SCORE ANALYSIS
OL.calculateAnalysisScore = function(app, features) {
    let totalScore = 0;
    let totalWeight = 0;

    features.forEach(feat => {
        const weight = parseFloat(feat.weight) || 0;
        const score = parseFloat(app.scores[feat.id]) || 0;
        
        totalScore += (score * weight);
        totalWeight += weight;
    });

    // Normalize to a 5-point scale or percentage
    return totalWeight > 0 ? (totalScore / totalWeight).toFixed(2) : 0;
};

OL.updateAnalysisScore = function(anlyId, appId, featId, value, isMaster) {
    let score = parseFloat(value) || 0;
    if (score < 0) score = 0;
    if (score > 3) score = 3;

    const client = getActiveClient();
    const source = isMaster ? state.master.analyses : client?.projectData?.localAnalyses || [];
    const anly = source.find(a => a.id === anlyId);
    if (anly) {
        const appObj = anly.apps.find(a => a.appId === appId);
        if (appObj) {
            if (!appObj.scores) appObj.scores = {};
            appObj.scores[featId] = score;
            const newTotal = OL.calculateAnalysisScore(appObj, anly.features || []);
            const scorePill = document.querySelector(`[data-app-total="${appId}"]`);
            if (scorePill) {
                scorePill.innerText = newTotal;
                scorePill.className = `pill ${newTotal > 2.5 ? 'accent' : 'soft'}`;
            }
        }
    }
    OL.persist();
};

OL.equalizeAnalysisWeights = function(anlyId, isMaster) {
    const client = getActiveClient();
    const source = isMaster ? state.master.analyses : (client?.projectData?.localAnalyses || []);
    const anly = source.find(a => a.id === anlyId);
    if (!anly || !anly.features || anly.features.length === 0) return;

    const activeCats = [...new Set(anly.features.map(f => f.category || "General"))];
    const weightPerCat = 100 / activeCats.length;
    anly.features.forEach(f => {
        const catFeatures = anly.features.filter(feat => (feat.category || "General") === (f.category || "General"));
        f.weight = parseFloat((weightPerCat / catFeatures.length).toFixed(2));
    });

    // Surgical UI update
    anly.features.forEach(f => {
        const inputs = document.querySelectorAll(`input[onblur*="'${f.id}'"][onblur*="'weight'"]`);
        inputs.forEach(input => input.value = f.weight);
    });

    OL.persist();
    console.log(`⚖️ Weights Balanced Surgically.`);
};

//======================= CONSOLIDATED FEATURES MANAGEMENT =======================//

OL.getScopedAnalyses = function() {
    const isVault = window.location.hash.includes('vault');
    const client = getActiveClient();
    return isVault ? (state.master.analyses || []) : (client?.projectData?.localAnalyses || []);
};

// --- 1. GLOBAL CONTENT MANAGER ---
OL.openGlobalContentManager = function() {
    const client = getActiveClient();
    
    // 1. Gather ALL potential features
    const allMaster = (state.master.analyses || []).flatMap(a => a.features || []);
    const allLocal = (client?.projectData?.localAnalyses || []).flatMap(a => a.features || []);

    // 2. 🛡️ THE DEDUPLICATOR: Use a Map to keep only the first unique instance of a name
    const uniqueMap = new Map();

    // Process Master first (so they take precedence as 'locked' items)
    allMaster.forEach(f => {
        const key = f.name.toLowerCase().trim();
        if (!uniqueMap.has(key)) {
            uniqueMap.set(key, { ...f, origin: 'master' });
        }
    });

    // Process Local second (only add if not already in Master)
    allLocal.forEach(f => {
        const key = f.name.toLowerCase().trim();
        if (!uniqueMap.has(key)) {
            uniqueMap.set(key, { ...f, origin: 'local' });
        }
    });

    const dedupedList = Array.from(uniqueMap.values());

    const html = `
        <div class="modal-head">
            <div class="modal-title-text">📚 Content & Library Manager</div>
        </div>
        <div class="modal-body">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                <input type="text" id="lib-search" class="modal-input" placeholder="Search all features..." 
                       oninput="OL.filterLibraryManager(this.value)" style="width:70%;">
                <button class="btn primary" onclick="OL.openAddLocalFeatureModal()">+ Add Local Feature</button>
            </div>

            <div class="library-scroll-area" style="max-height: 550px; overflow-y: auto;">
                <table class="library-features" style="width:95%; border-collapse: collapse; border-radius: 8px;">
                    <tbody id="lib-manager-tbody">
                        ${OL.renderLibraryManagerRows(dedupedList)}
                    </tbody>
                </table>
            </div>
        </div>
    `;
    openModal(html);
};

// 🚀 Use (allFeats = []) to prevent the "reading map of undefined" error
OL.renderLibraryManagerRows = function(allFeats = []) {
    // 1. Grouped Sorting: Priority Weight -> Category Name -> Feature Name
    allFeats.sort((a, b) => {
        const weightA = OL.getCategorySortWeight(a.category);
        const weightB = OL.getCategorySortWeight(b.category);
        if (weightA !== weightB) return weightA - weightB;
        
        const catA = (a.category || "General").toLowerCase();
        const catB = (b.category || "General").toLowerCase();
        return catA.localeCompare(catB) || a.name.localeCompare(b.name);
    });

    if (allFeats.length === 0) {
        return '<tr><td colspan="3" class="center muted p-20">No features found matching your search.</td></tr>';
    }

    let currentCategory = null;
    let html = "";

    allFeats.forEach(f => {
        const rawCat = (f.category || "General").trim();
        const compareCat = rawCat.toLowerCase();

        // 2. 📁 Inject Header Row when category changes
        if (compareCat !== currentCategory) {
            currentCategory = compareCat;
            html += `
                <tr class="lib-category-header" style="background: rgba(255,255,255,0.03);">
                    <td colspan="3" style="padding: 12px 10px; border-bottom: 1px solid var(--line);">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <span style="opacity: 0.5;">📁</span>
                            <span style="font-weight: bold; color: var(--accent); text-transform: uppercase; font-size: 0.85rem; letter-spacing: 0.5px;">
                                ${esc(rawCat)}
                            </span>
                        </div>
                    </td>
                </tr>
            `;
        }

        // 3. 📝 Render Feature Row
        const isMaster = f.origin === 'master';
        html += `
            <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
                <td style="padding-left: 35px; width: 5%;">
                    ${isMaster ? '🔒' : '✏️'}
                </td>
                <td style="padding: 10px 8px;">
                    ${isMaster ? 
                        `<span style="font-weight: 500;">${esc(f.name)}</span>` : 
                        `<input type="text" class="tiny-input" 
                                value="${esc(f.name)}" 
                                onblur="OL.updateLocalLibraryFeature('${f.id}', 'name', this.value)">`
                    }
                </td>
                <td style="padding: 10px 8px; text-align: right;">
                    <span class="pill tiny muted" style="opacity: 0.7;">
                        ${isMaster ? 'Master Definition' : 'Local Extension'}
                    </span>
                </td>
            </tr>
        `;
    });

    return html;
};

OL.filterLibraryManager = function(query) {
    const q = query.toLowerCase().trim();
    const client = getActiveClient();
    
    // 1. Re-gather all data
    const allMaster = (state.master?.analyses || []).flatMap(a => a.features || []);
    const allLocal = (client?.projectData?.localAnalyses || []).flatMap(a => a.features || []);

    // 2. Re-deduplicate
    const uniqueMap = new Map();
    allMaster.forEach(f => {
        const key = f.name.toLowerCase().trim();
        if (!uniqueMap.has(key)) uniqueMap.set(key, { ...f, origin: 'master' });
    });
    allLocal.forEach(f => {
        const key = f.name.toLowerCase().trim();
        if (!uniqueMap.has(key)) uniqueMap.set(key, { ...f, origin: 'local' });
    });

    const dedupedList = Array.from(uniqueMap.values());

    // 3. Filter based on query
    const filtered = dedupedList.filter(f => 
        f.name.toLowerCase().includes(q) || 
        (f.category || "").toLowerCase().includes(q)
    );

    // 4. Update the DOM
    const tbody = document.getElementById('lib-manager-tbody');
    if (tbody) {
        tbody.innerHTML = OL.renderLibraryManagerRows(filtered);
    }
};

OL.updateLocalLibraryFeature = async function(featId, property, newValue) {
    const client = getActiveClient();
    const val = newValue.trim();
    if (!val) return;

    await OL.updateAndSync(() => {
        client.projectData.localAnalyses.forEach(anly => {
            anly.features.forEach(f => {
                // If it matches the ID being edited, update it everywhere
                if (f.id === featId) {
                    f[property] = val;
                }
            });
        });
    });
    console.log(`Synced Local Library change: ${property} -> ${val}`);
};

// --- 2. THE EDITORS ---
OL.editFeatureModal = function(anlyId, featId, isMaster) {
    const analyses = OL.getScopedAnalyses();
    const anly = analyses.find(a => a.id === anlyId);
    const feat = anly?.features.find(f => f.id === featId);

    if (!feat) return;

    const currentCat = feat.category || "General";

    const html = `
        <div class="modal-head"><div class="modal-title-text">⚙️ Edit Feature</div></div>
        <div class="modal-body">
            <div style="margin-bottom: 15px;">
                <label class="modal-section-label">Feature Name</label>
                <input type="text" id="edit-feat-name" class="modal-input" value="${esc(feat.name)}">
            </div>

            <div style="margin-bottom: 15px;">
                <label class="modal-section-label">Category Group / Function</label>
                <input type="text" id="edit-feat-cat-search" class="modal-input" 
                      value="${esc(currentCat)}" 
                      placeholder="Search functions or categories..."
                      autocomplete="off"
                      onfocus="OL.universalCategorySearch(this.value, 'edit-feature', 'edit-cat-search-results', { anlyId: '${anlyId}' })"
                      oninput="OL.universalCategorySearch(this.value, 'edit-feature', 'edit-cat-search-results', { anlyId: '${anlyId}' })">
                
                <div id="edit-cat-search-results" class="search-results-overlay" 
                    style="margin-top:5px; max-height: 200px; overflow-y: auto; border: 1px solid var(--line); display: none;">
                </div>
                <input type="hidden" id="edit-feat-cat-value" value="${esc(currentCat)}">
            </div>
            
            <div style="margin-bottom: 15px;">
                <label class="modal-section-label">Description / Business Rule</label>
                <textarea id="edit-feat-description" class="modal-input" 
                    style="height: 80px; resize: vertical; padding-top: 8px; font-family: inherit; line-height: 1.4;">${esc(feat.description || "")}</textarea>
            </div>

            <div style="margin-bottom: 25px; padding: 10px; background: rgba(255, 215, 0, 0.05); border-radius: 4px; border: 1px solid rgba(255, 215, 0, 0.2);">
                <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 0.85rem;">
                    <input type="checkbox" id="edit-feat-global" style="width: 16px; height: 16px;">
                    <strong>Update Globally?</strong>
                </label>
            </div>

            <div style="display:flex; gap:10px; justify-content: flex-end;">
                <button class="btn soft" onclick="OL.closeModal()">Cancel</button>
                <button class="btn primary" onclick="OL.executeEditFeature('${anlyId}', '${featId}', ${isMaster})">Save Changes</button>
            </div>
        </div>
    `;
    openModal(html);
};

// This executes the save for both the Matrix Edit and the Global Manager
OL.executeEditFeature = function(anlyId, featId, isMaster) {
    const name = document.getElementById("edit-feat-name").value.trim();
    const cat = document.getElementById("edit-feat-cat-value").value.trim() || "General";
    const desc = document.getElementById('edit-feat-description').value;
    const isGlobal = document.getElementById("edit-feat-global").checked;

    const analyses = OL.getScopedAnalyses();
    const anly = analyses.find(a => a.id === anlyId);
    const feat = anly?.features.find(f => f.id === featId);
    const oldName = feat?.name;

    if (feat) {
        feat.name = name;
        feat.category = cat;
        feat.description = desc;

        if (isGlobal && oldName) {
            OL.syncFeatureChanges(oldName, { name, category: cat, description: desc }, isMaster);
        }

        OL.persist();
        OL.closeModal();
        OL.openAnalysisMatrix(anlyId, isMaster);
    }
};

OL.executeGlobalFeatureUpdate = async function(originalName, isVault) {
    const name = document.getElementById('global-edit-name').value.trim();
    const description = document.getElementById('global-edit-desc').value;

    OL.syncFeatureChanges(originalName, { name, description }, isVault);
    
    await OL.persist();
    OL.closeModal();
    OL.openGlobalContentManager();
};

// 4. MANAGE ADDING / EDITING FEATURES
OL.finalizeFeatureAddition = async function(anlyId, featName, category, isMaster) {
    const analyses = OL.getScopedAnalyses();
    const anly = analyses.find(a => a.id === anlyId);
    if (!anly) return;

    const cleanName = featName.trim();
    const cleanCat  = category.trim() || "General";

    // 1. Check if already on this matrix
    const onMatrix = (anly.features || []).some(f => f.name.toLowerCase() === cleanName.toLowerCase());
    if (onMatrix) {
        alert(`🚫 "${cleanName}" is already in this analysis matrix.`);
        return;
    }

    // 2. Adopt standard capitalisation if found in global pool
    const allFeatures  = OL.getGlobalFeatures();
    const existingEntry = allFeatures.find(f => f.toLowerCase() === cleanName.toLowerCase());

    // 3. Mutate directly
    if (!anly.features) anly.features = [];
    anly.features.push({
        id: "feat-" + Date.now() + Math.random().toString(36).substr(2, 5),
        name: existingEntry || cleanName,
        category: cleanCat,
        weight: 10,
        description: ""
    });

    // 4. Fire and forget
    OL.persist();

    // 5. UI reset for rapid entry
    const nameInput = document.getElementById('feat-name-input');
    if (nameInput) { nameInput.value = ''; nameInput.focus(); }

    const results = document.getElementById('feat-search-results');
    if (results) { results.innerHTML = ''; results.style.display = 'none'; }

    OL.openAnalysisMatrix(anlyId, isMaster);
    console.log("✅ Feature synchronized.");
};

// 2. THE UI FLOW (The "Single Modal")
OL.addFeatureToAnalysis = function (anlyId, isMaster) {
    const analyses = OL.getScopedAnalyses();
    const anly = analyses.find(a => a.id === anlyId);

    // 🛡️ Get names and stringify them for the HTML attributes
    const existingFeatureNames = (anly?.features || []).map(f => f.name.toLowerCase());
    const excludeData = JSON.stringify(existingFeatureNames).replace(/"/g, '&quot;');

    const html = `
        <div class="modal-head"><div class="modal-title-text">🔎 Add Feature</div></div>
        <div class="modal-body">
            <label class="modal-section-label">Feature Name</label>
            <input type="text" id="feat-name-input" class="modal-input" 
                   placeholder="Search library..." 
                   onclick="OL.unifiedAddFlow(this.value, '${anlyId}', ${isMaster}, ${excludeData})"
                   onfocus="OL.unifiedAddFlow(this.value, '${anlyId}', ${isMaster}, ${excludeData})"
                   oninput="OL.unifiedAddFlow(this.value, '${anlyId}', ${isMaster}, ${excludeData})">
            
            <div id="feat-search-results" class="search-results-overlay" style="margin-top:10px; max-height: 150px;"></div>

            <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid var(--line);">
                <label class="modal-section-label">Category</label>
                <div style="position:relative;">
                    <input type="text" id="feat-cat-input" class="modal-input" 
                           placeholder="Select category..."
                           onclick="OL.universalCategorySearch(this.value, 'local-ui-only', 'feat-cat-results')"
                           onfocus="OL.universalCategorySearch(this.value, 'local-ui-only', 'feat-cat-results')"
                           oninput="OL.universalCategorySearch(this.value, 'local-ui-only', 'feat-cat-results')">
                    <div id="feat-cat-results" class="search-results-overlay"></div>
                </div>
                
                <button class="btn primary full-width" style="margin-top:20px;" id="finalize-btn">
                    Add to Matrix
                </button>
            </div>
        </div>`;
    openModal(html);
    requestAnimationFrame(() => document.getElementById('feat-name-input').focus());
};

OL.pushFeatureToVault = function (featName) {
  const client = getActiveClient();
  const feat = client.projectData.localAnalyses
    .flatMap((a) => a.features || [])
    .find((f) => f.name === featName);

  if (!feat) return;

  // 🛡️ Ensure inbox exists with ALL required properties
  let masterInbox = state.master.analyses.find(
    (a) => a.name === "📥 Vault Submissions",
  );
  if (!masterInbox) {
    masterInbox = {
      id: "master-inbox-" + Date.now(),
      name: "📥 Vault Submissions",
      features: [],
      categories: ["General"],
      apps: [], // <--- Added this to prevent the error
      createdDate: new Date().toISOString(),
    };
    state.master.analyses.push(masterInbox);
  }

  if (!masterInbox.features.some((f) => f.name === feat.name)) {
    masterInbox.features.push({ ...feat, id: "feat-" + Date.now() });
    if (!masterInbox.categories.includes(feat.category)) {
      masterInbox.categories.push(feat.category);
    }
    OL.persist();
    alert(`✅ "${featName}" copied to Vault Submissions.`);
  }
  OL.openGlobalContentManager();
};

OL.renameFeatureCategory = function(anlyId, oldCatName, newCatName, isMaster) {
    const cleanNewName = newCatName.trim();
    if (!cleanNewName || cleanNewName === oldCatName) return;

    const client = getActiveClient();
    const source = isMaster ? state.master.analyses : (client.projectData.localAnalyses || []);
    const anly = source.find(a => a.id === anlyId);

    if (anly && anly.features) {
        // Update all features that matched the old name
        anly.features.forEach(f => {
            if ((f.category || "General") === oldCatName) {
                f.category = cleanNewName;
            }
        });

        // Re-sort to keep things clean
        anly.features.sort((a, b) => (a.category || "").localeCompare(b.category || ""));

        OL.persist();
        OL.openAnalysisMatrix(anlyId, isMaster); // Refresh UI
    }
};

OL.promoteToFunction = function (catName) {
  if (!state.master.functions) state.master.functions = [];

  // Check if it already exists to prevent duplicates
  if (state.master.functions.some((f) => f.name === catName)) {
    alert("This category is already a Function.");
    return;
  }

  const msg = `Promote "${catName}" to a Master Function?\n\nThis will apply special badges and priority sorting to this category across the entire system.`;
  if (!confirm(msg)) return;

  // Add to the registry
  state.master.functions.push({
    id: "func-" + Date.now(),
    name: catName,
    description: `Standardized ${catName} logic`,
    createdDate: new Date().toISOString(),
  });

  OL.persist();
  OL.openGlobalContentManager(); // Refresh UI to show the new badge
};

OL.demoteFromFunction = function (catName) {
  if (!confirm(`Demote "${catName}" back to a standard category?`)) return;

  state.master.functions = state.master.functions.filter(
    (f) => f.name !== catName,
  );

  OL.persist();
  OL.openGlobalContentManager();
};

OL.executeGlobalFeatureUpdate = async function(originalName, isVaultMode) {
    const newName = document.getElementById('global-edit-name').value.trim();
    const newDesc = document.getElementById('global-edit-desc').value;
    const client = getActiveClient();

    if (!newName) return alert("Name required");

    // Determine which pool to update
    const analyses = isVaultMode 
        ? (state.master.analyses || []) 
        : (client?.projectData?.localAnalyses || []);

    // Update every single feature that matches the original name
    analyses.forEach(anly => {
        anly.features?.forEach(f => {
            if (f.name === originalName) {
                f.name = newName;
                f.description = newDesc;
            }
        });
    });

    console.log(`🌎 Global Update Sync: ${originalName} -> ${newName}`);
    
    await OL.persist();
    OL.closeModal();
    
    // Refresh the Content Manager to reflect name changes
    OL.openGlobalContentManager();
};

OL.globalRenameContent = function(type, oldName, newName, forceNewCat = null) {
    const isVaultMode = window.location.hash.includes('vault');
    const cleanNewName = newName.trim();
    if (!cleanNewName || (cleanNewName === oldName && !forceNewCat)) return;

    const sources = isVaultMode 
        ? [state.master.analyses] 
        : [(getActiveClient()?.projectData?.localAnalyses || [])];

    sources.forEach(analysisList => {
        analysisList.forEach(anly => {
            if (type === 'category') {
                if (anly.categories) {
                    const idx = anly.categories.indexOf(oldName);
                    if (idx !== -1) anly.categories[idx] = cleanNewName;
                }
                anly.features?.forEach(f => {
                    if (f.category === oldName) f.category = cleanNewName;
                });
            } else if (type === 'feature') {
                anly.features?.forEach(f => {
                    if (f.name === oldName) {
                        f.name = cleanNewName;
                        if (forceNewCat) f.category = forceNewCat;
                    }
                });
            }
        });
    });

    OL.persist();
};

//======================= CONSOLIDATED CATEGORY SEARCH =======================//

OL.universalCategorySearch = function(query, type, targetElementId, extraParams = {}) {
    const listEl = document.getElementById(targetElementId);
    if (!listEl) return;

    listEl.style.display = "block";
    const q = (query || "").toLowerCase().trim();
    const allCats = OL.getGlobalCategories();
    const masterFunctions = (state.master?.functions || []).map(f => f.name || f);

    // 1. Filter matches
    const matches = allCats.filter(c => c.toLowerCase().includes(q));
    const exactMatch = matches.some(m => m.toLowerCase() === q);

    let html = "";

    // 🚀 THE "CREATE NEW" ACTION (Priority 1)
    if (q.length > 0 && !exactMatch) {
        html += `
            <div class="search-result-item create-action" 
                 style="background: rgba(var(--accent-rgb), 0.15) !important; border-bottom: 2px solid var(--accent); margin-bottom: 5px;"
                 onmousedown="OL.handleCategorySelection('${esc(query)}', '${type}', ${JSON.stringify(extraParams)})">
                <div style="display:flex; align-items:center; gap:8px;">
                    <span class="pill tiny accent" style="background:var(--accent); color:white; font-weight:bold;">+ CREATE NEW</span> 
                    <span style="color:var(--accent);">"${esc(query)}"</span>
                </div>
            </div>`;
    }

    // 🚀 THE EXISTING MATCHES (Priority 2)
    html += matches.map(cat => {
        const isFunction = masterFunctions.includes(cat);

        // We'll pass the params via a global state reference to avoid all quote/syntax issues
        window._tmpSearchParams = extraParams;

        return `
            <div class="search-result-item" style="display:flex; justify-content:space-between; align-items:center;">
                <div onmousedown="event.stopPropagation(); OL.handleCategorySelection('${esc(cat)}', '${type}', window._tmpSearchParams)" style="flex:1;">
                    <span>${isFunction ? '⚙️' : '📁'} ${esc(cat)}</span>
                </div>
            </div>`;
    }).join('');

    listEl.innerHTML = html || '<div class="search-result-item muted">No categories found...</div>';
};

// 4b. MANAGE ADDING / EDITING CATEGORIES
OL.getCategoryWeight = function(catName) {
    const coreLogic = ["GENERAL", "PRICING", "SECURITY", "ARCHITECTURE", "TEAM ACCESS"];
    const normalized = catName.toUpperCase();
    
    const index = coreLogic.indexOf(normalized);
    // If it's in our core list, return its position (0-4), otherwise return a high number
    return index !== -1 ? index : 99; 
};

OL.handleCategorySelection = function(catName, type, params = {}) {
    const { anlyId, isMaster, featName } = params;

    // 🎯 ROUTE 1: Feature Editor (L3 Matrix Modal)
    if (type === 'edit-feature') {
        const searchInput = document.getElementById("edit-feat-cat-search");
        const hiddenInput = document.getElementById("edit-feat-cat-value");
        if (searchInput) searchInput.value = catName;
        if (hiddenInput) hiddenInput.value = catName;
        document.getElementById("edit-cat-search-results").style.display = "none";
    } 

    // 🎯 ROUTE 2: Analysis Assignment (Adding a blank Category to a Matrix)
    else if (type === 'add-to-analysis') {
        OL.executeAddCategoryToAnalysis(anlyId, catName, isMaster);
    }

    // 🎯 ROUTE 3: Global Content Manager (Library Search)
    else if (type === 'global-manager') {
        const input = document.getElementById('global-feat-cat-search');
        if (input) input.value = catName;
        document.getElementById('global-cat-results').innerHTML = '';
    }

    // 🎯 ROUTE 4: The Unified "Add Feature" UI (Pre-filling the category field)
    else if (type === 'local-ui-only' || type === 'assign-to-feature') {
        const catInput = document.getElementById('feat-cat-input') || document.getElementById('new-feat-cat-input');
        if (catInput) catInput.value = catName;
        
        // Close whichever results div is open
        const res1 = document.getElementById('feat-cat-results');
        const res2 = document.getElementById('new-feat-cat-results');
        if (res1) res1.style.display = 'none';
        if (res2) res2.style.display = 'none';
    }

    // Cleanup global state safety bridge
    if (window._tmpSearchParams) delete window._tmpSearchParams;
};

//===========================INFINITE GRID (V2 CONSOLIDATED)===========================
state.v2 = {
    zoom: 1,
    pan: { x: 0, y: 0 },
    activeDragId: null,
    selectedNodes: new Set(),
    expandedNodes: new Set(),
    isDraggingNode: false,
    trayTypeFilter: 'All'
};

// Simple global listener to clear selection when clicking the background
document.addEventListener('mousedown', (e) => {
    if (e.target.id === 'v2-canvas' || e.target.id === 'v2-node-layer'|| e.target.id === 'v2-canvas-scroll-wrap') {
        state.v2.selectedNodes.clear();
        OL.renderVisualizer(); // Re-render to clear blue borders
        OL.closeInspector();
    }
});

document.addEventListener('mousedown', (e) => {
    // Only fire on the flowchart canvas background or swimlane empty space
    const isCanvasBg = e.target.id === 'fv-canvas-wrap' 
                    || e.target.id === 'fv-canvas'
                    || e.target.classList.contains('fv-swimlane')
                    || e.target.id === 'fv-lanes-container';
    
    if (isCanvasBg) {
        OL.closeInspectorPanel();
        document.querySelectorAll('.fv-card.selected, .fv-step-card.selected')
            .forEach(el => el.classList.remove('selected'));
    }
});

const FLOW_COLUMN_VW = 22;   // Width of one card (22% of viewport)
const FLOW_GAP_VW = 3;      // Gap between columns (3% of viewport)
const FLOW_SPINE_X_VW = 50;  // The center of the screen

OL.initWBMotion = function(e, id) {
    const canvas = document.getElementById('v2-canvas');
    const zoom = OL.state.v2.zoom || 1;
    const data = OL.getCurrentProjectData(); 
    const resources = data.resources; 
    const stages = data.stages;
    
    const res = resources.find(r => String(r.id) === String(id));
    if (!res) return;

    let isResizingLane = false; 
    let pendingWidthChange = null;
    let pendingStageIdx = null;

    let indicator = document.getElementById('drag-indicator');
    if (!indicator) {
        indicator = document.createElement('div');
        indicator.id = 'drag-indicator';
        document.body.appendChild(indicator);
    }
    
    indicator.style.display = 'block';
    indicator.style.zIndex = '99999'; 
    indicator.style.opacity = '1';

    const el = document.getElementById(`v2-node-${id}`);
    if (el) el.classList.add('is-dragging-ghost');

    const onMove = (mE) => {
        indicator.style.left = `${mE.clientX - 7}px`;
        indicator.style.top = `${mE.clientY - 7}px`;
        indicator.style.position = 'fixed';

        const rect = canvas.getBoundingClientRect();
        const mouseCanvasX = (mE.clientX - rect.left) / zoom;

        // Legacy lane resizing logic (Optional: keep or remove)
   