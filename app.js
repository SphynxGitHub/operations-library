//======================= GENERAL SECTION =======================//

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

// Define Namespace
const OL = window.OL = {};

// Supabase Credentials
const SUPABASE_URL = 'https://kexnnpwjerrnsmifauuo.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtleG5ucHdqZXJybnNtaWZhdXVvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc1MDcxNTEsImV4cCI6MjEwMzA4MzE1MX0.BAgC5wN4SKqfqKn0Gt7a53sGvigh_YlaMcQLdaovc08';

// Initialize Supabase Client & Attach Globally
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
window.db = db;
window.supabase = db;

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

//======================= SUPABASE CONFIG & INITIALIZATION =======================//

// 4. Initialize State Placeholder
let state = {
    activeClientId: null,
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
OL.state = state;

// 5. SAFE PERSIST ENGINE: Saves local state via Supabase Upsert (No auto-deletions)
OL.persist = async function() {
    if (window.saveTimeout) clearTimeout(window.saveTimeout);
    
    window.saveTimeout = setTimeout(async () => {
        window.saveTimeout = null;
        try {
            console.log("☁️ Background Sync Starting...");

            // --- Safeguard 1: Master Protection ---
            if (state.master && Object.keys(state.master).length > 0) {
                const masterCopy = JSON.parse(JSON.stringify(state.master));
                const { error: masterErr } = await db.from('workspace_masters').upsert({
                    id: 'main_state',
                    exported_at: new Date().toISOString(),
                    version: masterCopy._version || 1,
                    rates: masterCopy.rates || {},
                    resource_types: masterCopy.resourceTypes || [],
                    datapoints: masterCopy.datapoints || []
                });
                if (masterErr) throw masterErr;
            }

            // --- Safeguard 2: Active Client Protection ---
            const activeId = state.activeClientId;
            if (activeId && state.clients[activeId]) {
                const clientCopy = JSON.parse(JSON.stringify(state.clients[activeId]));
                if (clientCopy.projectData) delete clientCopy.projectData.resources;

                // ABORT GUARD: Never save an incomplete client object
                if (!clientCopy.projectData || !clientCopy.projectData.localResources) {
                    console.error('🛑 PERSIST ABORTED: Incomplete client object. Database untouched.');
                    window.lastLocalSave = Date.now();
                    return;
                }

                const { error: clientErr } = await db.from('workspace_clients').upsert({
                    id: activeId,
                    public_token: clientCopy.publicToken,
                    created_at: new Date().toISOString()
                });
                if (clientErr) throw clientErr;
            }

            window.lastLocalSave = Date.now();
            console.log("✅ Background Sync Complete.");
        } catch (error) {
            console.error("💀 Persistence Error:", error.message);
        }
    }, 1500);
};

// 6. EVENT BOOTLOADER
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
                <div style="font-size:13px;letter-spacing:0.05em;">Loading...</div>
            </div>`;
    }

    OL.sync();
});

// 7. READ-ONLY INITIAL SYNC (Safe Read from Supabase)
OL.sync = async function() {
    if (window.isSyncInitialized) return;
    window.isSyncInitialized = true;
    console.log("📡 Fetching Workspace Data from Supabase...");

    try {
        // 1. Fetch Master Registry
        const { data: masterData } = await db
            .from('workspace_masters')
            .select('*')
            .maybeSingle();

        if (masterData) {
            state.master.rates = masterData.rates || state.master.rates;
            state.master.resourceTypes = masterData.resource_types || state.master.resourceTypes;
            state.master.datapoints = masterData.datapoints || state.master.datapoints;
            console.log("🏛️ Master Registry Loaded.");
        }

        // 2. Fetch Client List
        const { data: clientsData, error: clientsErr } = await db
            .from('workspace_clients')
            .select('*');

        if (clientsErr) {
            console.error("❌ Clients Fetch Error:", clientsErr.message);
        } else if (clientsData && clientsData.length > 0) {
            clientsData.forEach(c => {
                state.clients[c.id] = {
                    id: c.id,
                    publicToken: c.public_token || c.publicToken,
                    meta: c.meta || { name: c.id, status: 'Discovery' },
                    modules: c.modules || {},
                    permissions: c.permissions || {},
                    projectData: c.project_data || c.projectData || { localResources: [], clientTasks: [] }
                };
            });
            console.log(`📋 Loaded ${clientsData.length} clients from Supabase.`);
        }

        // 3. Unblock rendering
        state.isCloudSynced = true;
        if (typeof window.handleRoute === 'function') window.handleRoute();

    } catch (error) {
        console.error("❌ Sync Error:", error);
        state.isCloudSynced = true;
        if (typeof window.handleRoute === 'function') window.handleRoute();
    }
};

// 8. RELATIONAL CLIENT FETCH
OL.loadFullClient = async function(clientId) {
    if (state.clients[clientId] && !state.clients[clientId]._metaOnly) {
        return state.clients[clientId];
    }
    
    console.log(`📥 Fetching client records from Supabase: ${clientId}`);

    const [stagesRes, teamRes, resourcesRes] = await Promise.all([
        db.from('workspace_stages').select('*').eq('client_id', clientId),
        db.from('team_members').select('*').eq('client_id', clientId),
        db.from('workspace_resources').select('*').eq('client_id', clientId)
    ]);

    state.clients[clientId] = {
        id: clientId,
        publicToken: state.clients[clientId]?.publicToken || null,
        projectData: {
            stages: stagesRes.data || [],
            teamMembers: teamRes.data || [],
            localResources: resourcesRes.data || []
        }
    };

    delete state.clients[clientId]._metaOnly;
    return state.clients[clientId];
};

OL.switchClient = async function(id) {
    state.activeClientId = id;
    sessionStorage.setItem('lastActiveClientId', id);
    
    // Show loading state immediately
    const main = document.getElementById('mainContent');
    if (main) main.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:center;height:100%;opacity:0.5;">
            <div style="text-align:center;">
                <div style="font-size:24px;margin-bottom:10px;">⏳</div>
                <div>Loading client...</div>
            </div>
        </div>`;
    
    // Load full client data if needed
    await OL.loadFullClient(id);
    
    window.location.hash = "#/client-tasks";
    window.handleRoute();
};

OL.updateAndSync = async function(mutationFn) {
    state.isSaving = true; // Shield on
    
    try {
        // 1. Run the local data change
        await mutationFn();
        
        // 2. Trigger the persist (the actual Firebase write)
        OL.persist();
        
        // Note: We don't log "Success" here anymore because persist is debounced
        console.log("📥 Local State Updated. Sync Queued...");
    } catch (error) {
        console.error("❌ Local Mutation Failed:", error);
    } finally {
        // Shield stays on for 2 seconds to prevent the "Bounce Back" ping
        setTimeout(() => { state.isSaving = false; }, 2000);
    }
};

OL.getRegistryIcon = function(type) {
    if (!type) return "file-text"; 
    
    const registry = state.master.resourceTypes || [];
    const entry = registry.find(t => 
        String(t.type).toLowerCase() === String(type).toLowerCase()
    );

    // If the registry entry has a lucide icon defined, use it
    if (entry && entry.lucideIcon) return entry.lucideIcon;

    // 🎯 Standardized Mapping
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

    // 🚀 If we have an explicit activeClientId, use it first
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

// Controls what a user can SEE
OL.checkPermission = function (tabKey) {
  const client = getActiveClient();
  if (!client) return "full";
  if (!client.permissions) return "full";
  return client.permissions[tabKey] || "full"; 
};

// Controls what a user can DO
OL.initializeSecurityContext = function() {
    const params = new URLSearchParams(window.location.search);
    const clientToken = params.get('access'); 
    let adminKeyFromUrl = params.get('admin'); 
    let savedAdminID = window.ADMIN_ACCESS_ID;

    if (savedAdminID && savedAdminID.includes('=')) {
        savedAdminID = savedAdminID.split('=').pop();
    }

    // 🚀 1. CLIENT CHECK FIRST (Strict Priority)
    // If 'access' is in the URL, we FORCE adminMode to false immediately.
    if (clientToken) {
        state.adminMode = false;
        OL.state.adminMode = false;
        window.IS_GUEST = true; // Set a global flag
        console.log("👨‍💼 Guest Access Mode Active");
        return true;
    }

    // 🛠️ 2. ADMIN CHECK SECOND
    if (adminKeyFromUrl && adminKeyFromUrl === savedAdminID) {
        state.adminMode = true;
        OL.state.adminMode = true;
        window.IS_GUEST = false; 
        console.log("🛠️ Admin Mode Active");
        return true; 
    }

    // 🔒 3. SECURE LOCKOUT
    if (!adminKeyFromUrl && !clientToken) {
        state.adminMode = false;
        document.body.innerHTML = `
            <div>
                <h1>🔒 Secure Portal</h1>
                <p>Please use the unique link provided by your administrator.</p>
            </div>`;
        return false;
    }
    
    return false;
};

// 4. LAYOUT & ROUTING ENGINE

OL.isAdmin = function() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.has('admin');
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
  // Force build the layout shell if it doesn't exist on the page
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
    
    // Only close inspector when LEAVING the visualizer
    if (wasVisualizer && !isVisualizer) {
        const panel = document.getElementById('v2-inspector-panel') || document.getElementById('inspector-panel');
        if (panel) {
            panel.classList.remove('open');
            panel.id = 'inspector-panel';
            panel.style.width = '0';
            panel.style.minWidth = '0';
        }
        // ── ADD THIS ──
        const inspectorContent = document.getElementById('inspector-content');
        if (inspectorContent) inspectorContent.innerHTML = '';
        // ─────────────
        if (OL._fv) OL._fv._lastInspectorResId = null;
    
        const layout = document.querySelector('.three-pane-layout');
        if (layout) {
            const sidebarCollapsed = document.querySelector('.sidebar.collapsed');
            const leftCol = sidebarCollapsed ? '65px' : '240px';
            layout.style.gridTemplateColumns = `${leftCol} 1fr 0px`;
        }
    }
    // --- 🚦 [Remainder of your standard routing evaluation conditions...] ---
    const matrix = document.querySelector('.matrix-table-container');
    const isAppLoading = document.getElementById('mainContent')?.innerHTML.includes('spinner');

    if (matrix && !isAppLoading) {
        console.warn("🛡️ Matrix Active: Blocking Background Refresh to save your focus.");
        return; 
    }

    window.buildLayout(); 

    const main = document.getElementById("mainContent");
    if (!main) return; 

    const client = getActiveClient();
    const isVault = hash.startsWith('#/vault');

    if (hash === "#/" || hash === "#/clients" || hash.includes("partner-dashboard")) {
        document.body.classList.remove('is-visualizer', 'fs-mode-active');
        if (window.FORCE_ADMIN && hash === "#/") {
            renderClientDashboard();
            return;
        }
        const leadProject = (client?.meta?.status === "Partner") ? client : state.clients[client?.meta?.partnerOwner];
        if (leadProject) {
            OL.renderPartnerDashboard(leadProject, main);
            return;
        }
        renderClientDashboard();
        return;
    }

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
            OL.renderVisualizer();
        }
        else if (hash.includes("/how-to")) renderHowToLibrary();
        else if (hash.includes("/tasks")) renderChecklistModule(true);
        else if (hash.includes("/analyses")) renderAnalysisModule(true);
        else if (hash.includes("/rates")) renderVaultRatesPage();
        else if (hash.includes("/data")) OL.renderGlobalDataManager();
        return;
    }

    if (client) {
        if (hash.includes("client-tasks")) renderChecklistModule();
        else if (hash.includes("resources")) renderResourceManager();
        else if (hash.includes("applications")) renderAppsGrid();
        else if (hash.includes("functions")) renderFunctionsGrid();
        else if (hash.includes("visualizer")) {
            state.viewMode = 'graph';
            document.body.classList.add('is-visualizer');
            OL.renderVisualizer();
        }
        else if (hash.includes("scoping-sheet")) renderScopingSheet();
        else if (hash.includes("analyze")) renderAnalysisModule();
        else if (hash.includes("how-to")) renderHowToLibrary();
        else if (hash.includes("team")) renderTeamManager();
        else if (hash.includes("data")) OL.renderGlobalDataManager();
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
    if (!step.assignees) st