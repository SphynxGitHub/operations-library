//======================= GENERAL SECTION =======================//

// 1. MUST BE LINE 1: Define the namespace immediately
const OL = window.OL = {};

// 2. Define standard helpers next (so functions can use them)

// val: returns empty string if missing (allows placeholder to show)
const val = (v) => (v === undefined || v === null) ? "" : v;

// num: returns empty string if missing or 0 (allows placeholder to show)
const num = (v) => (v === undefined || v === null || v === 0) ? "" : v;

const esc = (s) => String(s ?? "").replace(/&/g, "&").replace(/</g, "<").replace(/>/g, ">").replace(/"/g, "");
const uid = () => "id_" + Math.random().toString(36).slice(2, 10);

// 3. Firebase configuration
const apiKey = window.GOOGLE_API_KEY;
const firebaseConfig = {
  apiKey: apiKey,
  authDomain: "operations-library-d2fee.firebaseapp.com",
  projectId: "operations-library-d2fee",
  storageBucket: "operations-library-d2fee.firebasestorage.app",
  messagingSenderId: "353128653022",
  appId: "1:353128653022:web:5e6a11b7c91c8b3446224f",
  measurementId: "G-B8Q6H7YXHE"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// 4. Initialize the state placeholder
let state = {
    activeClientId: null,
    ui: {showCompleted: false},
    master: {
        apps: [], functions: [], resources: [], taskBlueprints: [], howToLibrary: [],
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

// 2. CLOUD STORAGE ENGINE
OL.persist = async function() {
    // 1. Move this to the top so it's defined for the fail-safe
    const statusEl = document.getElementById('cloud-status');
    if(statusEl) statusEl.innerHTML = "⏳ Syncing...";
    
    const client = state.clients[state.activeClientId];
    
    // 🛡️ THE FAIL-SAFE
    if (client && (!client.projectData.localResources || client.projectData.localResources.length === 0)) {
        const doc = await db.collection('systems').doc('main_state').get();
        const diskData = doc.data();
        const diskCount = diskData.clients[state.activeClientId]?.projectData?.localResources?.length || 0;
        
        if (diskCount > 0) {
            console.error("🛑 CRITICAL: Memory/Disk Mismatch. Prevented accidental deletion.");
            // 🚀 NOW THIS WORKS:
            if(statusEl) statusEl.innerHTML = "⚠️ Sync Blocked"; 
            return; 
        }
    }

    try {
        const cleanState = JSON.parse(JSON.stringify(state));
        await db.collection('systems').doc('main_state').set(cleanState);
        console.log("💾 Cloud Sync Successful.");
        if(statusEl) statusEl.innerHTML = "✅ Synced";
        
        // Clear status after 2 seconds
        setTimeout(() => { if(statusEl) statusEl.innerHTML = "☁️ Ready"; }, 2000);
    } catch (error) {
        console.error("❌ Sync Failed:", error);
        if(statusEl) statusEl.innerHTML = "❌ Sync Error";
    }
};

// 3. CLOUD BOOT (The "Master Key" to opening the app)
OL.boot = async function() {
    console.log("🚀 Sphynx System: Booting...");

    // 1. Wait for config variables
    let attempts = 0;
    while (!window.ADMIN_ACCESS_ID && attempts < 30) {
        await new Promise(r => setTimeout(r, 100));
        attempts++;
    }

    // 2. Security Check
    const isAuthorized = OL.initializeSecurityContext();
    if (!isAuthorized) return; 
    
    try {
        const doc = await db.collection('systems').doc('main_state').get();
        
        if (doc.exists) {
            const cloudData = doc.data();
            
            // 🚀 THE RESET FIX: 
            // Instead of merging, we completely replace the local 'state' variable.
            // This kills any 'ghost' items living in your browser's RAM.
            state = JSON.parse(JSON.stringify(cloudData));
            OL.state = state; 

            // Ensure important sub-objects exist so the UI doesn't crash
            if (!state.clients) state.clients = {};
            if (!state.master) state.master = { apps: [], functions: [], resources: [], rates: { variables: {} } };

            console.log("✅ State Hard-Reset from Cloud. Clients:", Object.keys(state.clients).length);
        }
        // 🚀 Ensure routing triggers after data is local
        handleRoute(); 
        
    } catch (err) {
        console.error("❌ Firebase Error:", err);
    }
};

// Update your event listener to use the Async Boot
window.addEventListener("load", OL.boot);

const getActiveClient = () => state.clients[state.activeClientId] || null;

// Controls what a user can SEE
OL.checkPermission = function (tabKey) {
  const client = getActiveClient();
  if (!client) return "full";
  return client.permissions[tabKey] || "none";
};

// Controls what a user can DO
OL.initializeSecurityContext = function() {
    const params = new URLSearchParams(window.location.search);
    const clientToken = params.get('access'); 
    let adminKeyFromUrl = params.get('admin'); 
    
    // 🛡️ Get the key from the window (injected via config.js)
    let savedAdminID = window.ADMIN_ACCESS_ID;

    // 🚀 THE CLEANER: If the secret accidentally contains "admin=" or "?admin=", strip it
    if (savedAdminID && savedAdminID.includes('=')) {
        savedAdminID = savedAdminID.split('=').pop();
    }

    // 1. ADMIN CHECK
    if (adminKeyFromUrl && adminKeyFromUrl === savedAdminID) {
        state.adminMode = true;
        console.log("🛠️ Admin Verified");
        return true; 
    }

    // 2. CLIENT CHECK
    if (clientToken) {
        state.adminMode = false;
        console.log("👨‍💼 Client Portal");
        return true;
    } 
    
    // 3. SECURE LOCKOUT
    if (!adminKeyFromUrl && !clientToken) {
        state.adminMode = false;
        document.body.innerHTML = `
            <div style="background:#050816; color:white; height:100vh; display:flex; flex-direction:column; align-items:center; justify-content:center; font-family:sans-serif;">
                <h1 style="color:#38bdf8;">🔒 Secure Portal</h1>
                <p style="opacity:0.6;">Please use the unique link provided by your administrator.</p>
            </div>`;
        return false;
    }
    
    return false;
};

// 4. LAYOUT & ROUTING ENGINE
window.buildLayout = function () {
  const root = document.getElementById("app-root");
  if (!root) {
      console.error("❌ ERROR: Could not find 'app-root' in your index.html!");
      return; 
  }
  const client = getActiveClient();
  const hash = location.hash || "#/";
  const urlParams = new URLSearchParams(window.location.search);

  const isPublic = urlParams.has("access");
  const token = urlParams.get("access");
  const isMaster = hash.startsWith("#/vault");

  const effectiveAdminMode = isPublic ? false : state.adminMode;

  if (!root) return; // Safety guard

  const masterTabs = [
    { key: "apps", label: "Master Apps", icon: "📱", href: "#/vault/apps" },
    {
      key: "functions",
      label: "Master Functions",
      icon: "⚒",
      href: "#/vault/functions",
    },
    {
      key: "resources",
      label: "Master Resources",
      icon: "💾",
      href: "#/vault/resources",
    },
     {
      key: "how-to",
      label: "Master How-To Guides",
      icon: "👩‍🏫",
      href: "#/vault/how-to",
    },
     {
      key: "checklist",
      label: "Master Tasks",
      icon: "📋",
      href: "#/vault/tasks",
    },
    {
      key: "analyses",
      label: "Master Analyses",
      icon: "📈",
      href: "#/vault/analyses",
    },
    { key: "rates", label: "Scoping Rates", icon: "💰", href: "#/vault/rates" },
  ];

  const clientTabs = [
    {
      key: "checklist",
      label: "Tasks",
      icon: "📋",
      href: "#/client-tasks",
    },
    {
      key: "apps",
      label: "Applications",
      icon: "📱",
      href: "#/applications",
    },
    {
      key: "functions",
      label: "Functions",
      icon: "⚒",
      href: "#/functions",
    },
    {
      key: "resources",
      label: "Project Resources",
      icon: "💾",
      href: "#/resources",
    },
    {
      key: "scoping",
      label: "Scoping & Pricing",
      icon: "📊",
      href: "#/scoping-sheet",
    },
    {
      key: "analysis",
      label: "Weighted Analysis",
      icon: "📈",
      href: "#/analyze",
    },
    {
      key: "howto",
      label: "How-To Library",
      icon: "👩‍🏫",
      href: "#/how-to",
    },
    { key: "team", label: "Team Members", icon: "👬", href: "#/team" },
  ];

  root.innerHTML = `
        <aside class="sidebar">
            ${!isPublic ? `
                <div class="admin-nav-zone">
                    <nav class="menu">
                        <a href="#/" class="${hash === '#/' ? 'active' : ''}">
                            <i>🏠</i> <span>Dashboard</span>
                        </a>
                    </nav>
                </div>
                <div class="divider"></div>
            ` : ''}

            ${isMaster ? `
                <div class="client-nav-zone admin-workspace">
                    <div class="menu-category-label">Global Administration</div>
                    <div class="client-profile-trigger is-master">
                        <div class="client-avatar" style="background: var(--accent); color: white;">M</div>
                        <div class="client-info">
                            <div class="client-name">Master Vault</div>
                            <div class="client-meta">Global Standards</div>
                        </div>
                    </div>
                    <nav class="menu">
                        ${masterTabs.map(item => `
                            <a href="${item.href}" class="${hash === item.href ? 'active' : ''}">
                                <i>${item.icon}</i> <span>${item.label}</span>
                            </a>
                        `).join('')}
                    </nav>
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

                    <nav class="menu">
                        ${clientTabs.map(item => {
                            // 1. Resolve Permission: Check if they are locked out via Permissions
                            const perm = OL.checkPermission(item.key);
                            if (perm === 'none') return '';

                            // 🚀 THE FIX: Use effectiveAdminMode. 
                            // Also added a check for the specific module key.
                            const isModuleEnabled = effectiveAdminMode || (client.modules && client.modules[item.key] === true);
                            
                            if (!isModuleEnabled) return ''; 

                            // 3. Generate Link
                            const linkHref = isPublic ? `${item.href}?access=${token}` : item.href;
                            const isActive = hash.startsWith(item.href);

                            return `
                                <a href="${linkHref}" class="${isActive ? 'active' : ''}">
                                    <i>${item.icon}</i> <span>${item.label}</span>
                                    ${perm === 'view' ? '<i class="lock-icon" title="Read Only">🔒</i>' : ''}
                                </a>
                            `;
                        }).join('')}
                    </nav>
            ` : `
                <div class="empty-context-hint"><p>Select a Client or enter Global Vault from Dashboard.</p></div>
            `}
        </aside>
        <main id="mainContent"></main>
    `;
};

window.handleRoute = function () {
  const hash = window.location.hash || "#/";
  buildLayout();
  const main = document.getElementById("mainContent");
  if (!main) return;

  if (hash.startsWith("#/vault")) {
    if (hash === "#/vault/resources") renderResourceManager();
    else if (hash === "#/vault/apps") renderAppsGrid();
    else if (hash === "#/vault/functions") renderFunctionsGrid();
    else if (hash === "#/vault/rates") renderVaultRatesPage();
    else if (hash === "#/vault/analyses") renderAnalysisModule(true);
    else if (hash === "#/vault/how-to") renderHowToLibrary();
    else if (hash === "#/vault/tasks") renderBlueprintManager();
    else if (hash === "#/vault/datapoints") renderVaultDatapointsPage();
    else renderAppsGrid();
  } else if (hash === "#/") {
    renderClientDashboard();
  } else if (getActiveClient()) {
    if (hash.includes("#/resources")) renderResourceManager();
    else if (hash.includes("#/applications")) renderAppsGrid();
    else if (hash.includes("#/functions")) renderFunctionsGrid();
    else if (hash.includes("#/scoping-sheet")) renderScopingSheet();
    else if (hash.includes("#/analyze")) renderAnalysisModule();
    else if (hash.includes("#/client-tasks")) renderChecklistModule();
    else if (hash.includes("#/team")) renderTeamManager();
    else if (hash.includes("#/how-to")) renderHowToLibrary();
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
                <span>📱 ${esc(a.name)}</span>
                <span class="tiny muted">Master Vault</span>
            </div>
        `).join('');
    }

    if (html === "") {
        html = `<div class="search-result-item muted">No results found for "${esc(query)}"</div>`;
    }

    resultsEl.innerHTML = html;
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
        console.log("⌨️ Overlays cleared");
    }

    // 2. ENTER: Save and Refresh
    if (e.key === 'Enter') {
        const isInput = e.target.classList.contains('modal-input') || 
                        e.target.classList.contains('header-editable-input') ||
                        e.target.tagName === 'INPUT';
        
        if (isInput) {
            e.target.blur(); // This triggers your 'onblur' save functions
            console.log("⌨️ Entry saved via Enter");
        }
    }
});

// 4a. REFRESH VIEW
OL.currentRenderer = null;

OL.getCurrentContext = function() {
    const hash = window.location.hash || "#/";
    
    // 1. PHYSICAL CHECK: Are we actually inside the Vault routes?
    const isVaultView = hash.startsWith('#/vault') || hash.includes('resource-manager');
    const activeClient = getActiveClient();

    if (isVaultView) {
        return {
            isMaster: true,
            namespace: 'res-vlt-',
            label: '🛡️ GLOBAL VAULT',
            type: 'vault'
        };
    }
    
    // 2. PROJECT CHECK: If we aren't in the Vault, check for a project
    if (activeClient) {
        return {
            isMaster: false,
            namespace: 'local-prj-',
            label: `📁 PROJECT: ${activeClient.meta.name}`,
            type: 'project'
        };
    }

    // 3. FALLBACK: Default to project if no specific vault route detected
    return { isMaster: false, namespace: 'local-prj-', label: '⚠️ NO CONTEXT', type: 'project' };
};

// 🚀 Register current view so modals know what to refresh
OL.registerView = function(renderFn) {
    OL.currentRenderer = renderFn;
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

  const overlay = document.getElementById("modal-overlay");
  overlay.onclick = () => OL.closeModal();
};

OL.closeModal = function () {
  const layer = document.getElementById("modal-layer");
  if (layer) {
    layer.style.display = "none";
    layer.innerHTML = "";
  }
  if (typeof activeOnClose === "function") activeOnClose();
};

OL.deleteCard = function(id, type, event) {
    if (event) event.stopPropagation();
    
    const client = getActiveClient();
    const hash = window.location.hash;
    const isVaultRoute = hash.startsWith('#/vault');
    const isMasterItem = String(id).startsWith('master-') || String(id).startsWith('fn-') || String(id).startsWith('res-vlt-');
    
    // 🛡️ SCENARIO 1: Unlinking a Master reference from a Project
    if (isMasterItem && !isVaultRoute && client) {
        if (confirm(`Remove this Master reference from ${client.meta.name}? \n\n(This will NOT delete the global template from the Vault)`)) {
            if (type === 'apps') {
                client.sharedMasterIds = (client.sharedMasterIds || []).filter(mid => mid !== id);
            }
            // Add similar unlinking logic for functions/resources if they use sharedMasterIds
            
            OL.persist();
            renderAppsGrid(); // or relevant grid refresh
            return;
        }
        return;
    }

    // 🛡️ SCENARIO 2: Permanent Deletion (Only for Local items or when in the Vault)
    const itemTypeLabel = type === 'apps' ? 'Application' : 'Function';
    if (!confirm(`⚠️ PERMANENT DELETE: Are you sure you want to delete this ${itemTypeLabel}? \n\nThis cannot be undone.`)) return;

    if (type === 'apps') {
        // If we are in the Vault, remove from global list
        if (isVaultRoute) {
            state.master.apps = (state.master.apps || []).filter(a => a.id !== id);
        } else if (client) {
            // If in project, remove from local specific apps
            client.projectData.localApps = (client.projectData.localApps || []).filter(a => a.id !== id);
        }
    } else if (type === 'functions') {
        if (isVaultRoute) {
            state.master.functions = (state.master.functions || []).filter(f => f.id !== id);
        } else if (client) {
            client.projectData.localFunctions = (client.projectData.localFunctions || []).filter(f => f.id !== id);
        }
    }

    OL.persist();
    
    // Refresh the current view based on type
    if (type === 'apps') renderAppsGrid();
    else if (type === 'functions') renderFunctionsGrid();
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

    const clients = state.clients ? Object.values(state.clients) : [];
    
    // 🛡️ Guard: Show onboarding if no clients exist
    if (clients.length === 0) {
        container.innerHTML = `
            <div style="padding:40px; text-align:center; opacity:0.5;">
                <p>Registry is empty.</p>
                <button class="btn primary" onclick="OL.onboardNewClient()">+ Add First Client Project</button>
            </div>`;
        return;
    }

    container.innerHTML = `
        <div class="setion-header">
            <div style="flex: 1;">
                <h2>Registry & Command</h2>
                <div class="small muted">Quick access to projects and master systems</div>
            </div>
        <div class="section-header search-header">           
            <div class="search-map-container" style="position: relative; flex: 1; max-width: 400px;">
                <input type="text" id="global-command-search" class="modal-input" 
                      placeholder="Search clients or apps..." 
                      onfocus="OL.handleGlobalSearch(this.value)"
                      oninput="OL.handleGlobalSearch(this.value)">
                <div id="global-search-results" class="search-results-overlay"></div>
            </div>

            <div class="header-actions" style="margin-left: 20px;">
                <button class="btn primary" onclick="OL.onboardNewClient()">+ Add New Client</button>
            </div>
            <button class="btn small warn" onclick="OL.pushFeaturesToAllClients()">⚙️ System Migration</button>
        </div>

        <div class="cards-grid">
            <div class="card vault-card is-clickable" onclick="location.hash='#/vault/apps'" 
                 style="border: 1px solid var(--accent); background: rgba(var(--accent-rgb), 0.05);">
                <div class="card-header">
                    <div class="card-title" style="color: var(--accent);">🏛️ Master Vault</div>
                    <div class="status-pill accent">System Admin</div>
                </div>
                <div class="card-body">
                    <div class="small muted" style="margin-bottom: 20px;">
                        Configure global apps, standard rates, and task blueprints.
                    </div>
                    <div class="card-footer-actions">
                        <button class="btn small primary flex-1">Enter Vault Manager</button>
                    </div>
                </div>
            </div>

            ${clients.map(client => `
                <div class="card client-card is-clickable" onclick="OL.switchClient('${client.id}')">
                    <div class="card-header">
                        <div class="card-title">${esc(client.meta.name)}</div>
                        <div class="status-pill">${esc(client.meta.status || 'Discovery')}</div>
                    </div>
                    <div class="card-body">
                        <div class="small muted" style="margin-bottom: 20px;">
                            Onboarded: ${client.meta.onboarded}
                        </div>
                        <div class="card-footer-actions">
                            <button class="btn small soft flex-1">
                                Enter Project
                            </button>
                            <button class="btn tiny soft" style="margin-left:8px;"
                                    onclick="event.stopPropagation(); OL.openClientProfileModal('${client.id}')">
                                ⚙️
                            </button>
                        </div>
                    </div>
                </div>
            `).join('')}
        </div>
    `;
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
        howto: false,
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
    },
    projectData: {
      localApps: [],
      localFunctions: [],
      localAnalyses: [],
      localResources: [],
      scopingSheets: [{ id: "initial", lineItems: [] }],
      clientTasks: [],
      teamMembers: [],
    },
    sharedMasterIds: [],
  };
  state.activeClientId = clientId;
  OL.persist();
  location.hash = "#/client-tasks";
};

// 3. BUILD CLIENT PROFILE SETTINGS / LINK / DELETE PROFILE
OL.openClientProfileModal = function(clientId) {
    const client = state.clients[clientId];
    if (!client) return;

    const html = `
        <div class="modal-head">
            <div class="modal-title-text">Client Profile: ${esc(client.meta.name)}</div>
            <div class="spacer"></div>
            <button class="btn small soft" onclick="OL.closeModal()">Close</button>
        </div>
        <div class="modal-body">
            <label class="modal-section-label">Active Modules (Client Access)</label>
            <div class="card-section" style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                ${[
                    { id: 'checklist', label: 'Tasks' },
                    { id: 'apps', label: 'Apps' },
                    { id: 'functions', label: 'Functions' },
                    { id: 'resources', label: 'Resources' },
                    { id: 'scoping', label: 'Scoping' },
                    { id: 'analysis', label: 'Analysis' },
                    { id: 'howto', label: 'How-To' },
                    { id: 'team', label: 'Team' }
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

            <label class="modal-section-label" style="color: #ef4444; margin-top: 25px;">Danger Zone</label>
            <div class="card-section" style="border: 1px solid rgba(239, 68, 68, 0.2); background: rgba(239, 68, 68, 0.05);">
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
    const client = state.clients[clientId];
    if (!client) return;

    // Ensure the modules object exists
    if (!client.modules) client.modules = {};

    // Toggle the value
    client.modules[moduleId] = !client.modules[moduleId];

    OL.persist();
    
    // 🚀 Refresh the sidebar immediately so you see the change
    buildLayout(); 
    console.log(`✅ Module ${moduleId} for ${client.meta.name}: ${client.modules[moduleId] ? 'ENABLED' : 'DISABLED'}`);
};

OL.copyShareLink = function(token) {
    const url = `${window.location.origin}${window.location.pathname}?access=${token}#/client-tasks`;
    navigator.clipboard.writeText(url);
    alert("Share link copied to clipboard!");
};

OL.switchClient = function (id) {
  state.activeClientId = id;
  OL.persist();
  window.location.hash = "#/client-tasks";
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
        
        // Ensure modules exist and the key is 'checklist' to match the sidebar
        if (!client.modules) {
            client.modules = { 
                checklist: true, apps: true, functions: true, resources: true, 
                scoping: true, analysis: true, "how-to": true, team: true 
            };
        } else {
            // Fix naming if 'tasks' was used instead of 'checklist'
            if (client.modules.tasks) {
                client.modules.checklist = client.modules.tasks;
                delete client.modules.tasks;
            }
        }
    });
    OL.persist();
    alert("Migration Complete. Refreshing...");
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

    const masterApps = state.master.apps || [];
    const localApps = client ? (client.projectData.localApps || []) : [];
    
    // Determine which list to show based on view
    const displayApps = isVaultMode ? masterApps : (client?.projectData?.localApps || []);
    displayApps.sort((a, b) => a.name.localeCompare(b.name));

    container.innerHTML = `
      <div class="section-header">
          <div>
              <h2>${isVaultMode ? '🏛️ Master App Vault' : '📱 Project Applications'}</h2>
              <div class="small muted subheader">${isVaultMode ? 'Global Standard Library' : `Software stack for ${esc(client.meta.name)}`}</div>
          </div>
          <div class="header-actions">
              ${isVaultMode ? `
                  <button class="btn primary" onclick="OL.createMasterAppFromGrid()">+ Create Master App</button>
              ` : `
                  <button class="btn small soft" onclick="OL.promptAddApp('${client.id}')">+ Create Local App</button>
                  <button class="btn primary" onclick="OL.openVaultDeploymentModal('${client.id}')">⬇ Import from Master</button>
              `}
          </div>
      </div>
      ${renderStatusLegendHTML()}

      <div class="cards-grid">
          ${displayApps.length > 0 ? displayApps.map(app => {
              // ✨ FIXED: Move these lines INSIDE the map loop
              const isMasterRef = !!app.masterRefId || String(app.id).startsWith('master-');
              const tagLabel = isMasterRef ? 'MASTER' : 'LOCAL';
              const tagColor = isMasterRef ? 'var(--accent)' : 'var(--panel-border)';
              
              const isLocal = app.id && String(app.id).startsWith('local-');
              
              // Standardize mapping format
              let mappings = (app.functionIds || []).map(m => 
                  typeof m === 'string' ? { id: m, status: 'available' } : m
              );
              
              // Sort the 'mappings' array for the card face
              const rank = { 'primary': 2, 'evaluating': 1, 'available': 0 };
              mappings.sort((a, b) => {
                  const scoreA = rank[a.status || 'available'] || 0;
                  const scoreB = rank[b.status || 'available'] || 0;
                  return scoreB - scoreA;
              });
                
              return `
                  <div class="card is-clickable" onclick="OL.openAppModal('${app.id}')">
                      <div class="card-header">
                          <div class="card-title">${esc(app.name)}</div>
                          <div style="display:flex; align-items:center; gap:8px;">
                              <span class="vault-tag" style="background: ${tagColor}; border: 1px solid ${isMasterRef ? 'transparent' : 'var(--line)'};">
                                ${tagLabel}
                              </span>   
                              <button class="card-delete-btn" onclick="OL.deleteCard('${app.id}', 'apps', event)">×</button>
                          </div>
                      </div>
                      <div class="card-body">
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
                                            oncontextmenu="OL.handlePillInteraction(event, '${app.id}', '${fn.id}'); return false;"
                                            title="Left Click: Jump | Right Click: Cycle | Cmd/Ctrl+Click: Unmap">
                                          ${esc(fn.name)}
                                      </span>`;
                              }).join('')}
                          </div>
                      </div>
                  </div>
              `;
          }).join('') : `<div class="empty-hint">No apps deployed. Use the buttons above to get started.</div>`}
      </div>
    `;
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
                <div id="master-app-import-results" class="search-results-overlay" style="margin-top:10px;"></div>
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
        .sort((a, b) => a.name.localeCompare(b.name)); // 🚀 Sort the list

    listEl.innerHTML = available.map(app => `
        <div class="search-result-item" onmousedown="OL.pushAppToClient('${app.id}', '${clientId}'); OL.closeModal();">
            <span>📱 ${esc(app.name)}</span>
        </div>
    `).join('') || `<div class="search-result-item muted">No new apps found.</div>`;
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

OL.handleAppSave = function(id, name) {
    const cleanName = name.trim();
    if (!cleanName) return; 

    const isDraft = id.startsWith('draft-');
    const client = getActiveClient();

    if (isDraft) {
        const isVault = id.includes('-vlt-');
        // 🚀 FIX: Use 'master-' prefix so the UI recognizes it as a Vault item
        const newId = (isVault ? 'master-app-' : 'local-app-') + Date.now();
        
        const newApp = {
            id: newId,
            name: cleanName,
            category: "", 
            monthlyCost: 0,
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
        OL.updateAppMeta(id, 'name', cleanName);
    }
};

OL.updateAppMeta = function(appId, field, value) {
    const client = getActiveClient();
    let app = state.master.apps.find(a => String(a.id) === String(appId));
    
    if (!app && client) {
        app = client.projectData.localApps.find(a => String(a.id) === String(appId));
    }

    if (app) {
        // Update data
        app[field] = (field === 'monthlyCost') ? parseFloat(value) || 0 : value;
        OL.persist();
        
        // 🚀 THE FIX: Redraw the active background view instantly
        OL.refreshActiveView();
        
        console.log(`✅ App ${appId} updated: ${field} = ${value}`);
    }
};

// RENDER APPS MODAL
function renderAppModalInnerContent(app, client) {
    const isVaultRoute = window.location.hash.startsWith('#/vault');
    const isLinkedToMaster = !!app.masterRefId;
    const linkedGuides = (state.master.howToLibrary || []).filter(ht => (ht.appIds || []).includes(app.id));
    
    const showAddButton = !isVaultRoute || (isVaultRoute && app.id.startsWith('master-'));

    const allFunctions = client 
    ? [...(state.master.functions || []), ...(client.projectData.localFunctions || [])]
    : (state.master.functions || []);

    // 🚀 THE FIX: Filter out functions that aren't shared with this project
    const projectSharedIds = client ? (client.sharedMasterIds || []) : [];
    const projectLocalIds = client ? (client.projectData.localFunctions || []).map(f => String(f.id)) : [];

    const sortedMappings = OL.sortMappings(app.functionIds || []);

    // 2. 🚀 THE FINAL FILTER: Deduplicate the sorted list immediately before rendering
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

    return `
        ${isLinkedToMaster && !isVaultRoute ? `
            <div class="banner info" style="margin-bottom:20px; padding:10px; background:rgba(var(--accent-rgb), 0.05); border: 1px solid var(--accent); border-radius:6px; font-size:11px;">
                💠 This app is linked to the <b>Master Vault</b>. Automation capabilities are synced globally, while notes and categories remain private to this project.
            </div>
        ` : ''}

        <div class="card-section">
            <div style="display:flex; justify-content:space-between; align-items:flex-end; margin-bottom:10px;">
                <label class="modal-section-label">Functional Categories</label>
                ${renderStatusLegendHTML()}
            </div>
            <div class="pills-row">
                ${finalUniqueMappings.map(mapping => { // 👈 Use the finalUniqueMappings here
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
                    <span class="pill tiny soft is-clickable" onclick="OL.openHowToModal('${guide.id}')">
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
    
    // 1. Resolve Data: Context-Aware Lookup
    let app = draftObj;
    if (!app) {
        const hash = window.location.hash;
        const isVaultMode = hash.startsWith('#/vault');

        if (isVaultMode) {
            // In Vault, only look at Master
            app = (state.master.apps || []).find(a => a.id === appId);
        } else {
            // In Project, find the LOCAL instance specifically
            // Even if appId is a master ID, we find the local app that REFERENCES it
            app = (client?.projectData?.localApps || []).find(a => 
                a.id === appId || a.masterRefId === appId
            );
            
            // Fallback: If not found in project, check master (e.g. previewing from search)
            if (!app) {
                app = (state.master.apps || []).find(a => a.id === appId);
            }
        }
    }

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
        return;
    }

    // 3. Generate Full HTML
    const html = `
        <div class="modal-head" style="gap:15px;">
            <div style="display:flex; align-items:center; gap:10px; flex:1;">
                <span style="font-size:18px;">📱</span>
                <input type="text" class="header-editable-input" 
                       value="${esc(val(app.name))}" 
                       placeholder="App Name (e.g. Slack)..."
                       style="background:transparent; border:none; color:inherit; font-size:18px; font-weight:bold; width:100%; outline:none;"
                       onblur="OL.handleAppSave('${app.id}', this.value)">
            </div>
            <button class="btn small soft" onclick="OL.closeModal()">Close</button>
        </div>
        <div class="modal-body">
            ${renderAppModalInnerContent(app, client)}
            ${OL.renderAccessSection(appId, 'app')}
        </div>
    `;
    window.openModal(html);

    // Auto-focus the name field
    setTimeout(() => {
        const input = document.getElementById('modal-app-name-input');
        if (input) input.focus();
    }, 100);
};

function renderStatusLegendHTML() {
    return `
        <div class="status-legend" style="display:flex; gap:15px; margin-bottom:12px; align-items:center;">
            <div style="display:flex; align-items:center; gap:6px;">
                <span class="status-dot primary";"></span>
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

    // 1. Pre-calculate the local mappings before creating the instance
    const localMappings = [];
    (masterApp.functionIds || []).forEach(m => {
        const fnId = String(typeof m === 'string' ? m : m.id);
        
        const isAlreadyVisible = (client.sharedMasterIds || []).includes(fnId) || 
                                 (client.projectData.localFunctions || []).some(lf => String(lf.id) === fnId);

        if (!isAlreadyVisible && (fnId.startsWith('fn-') || fnId.startsWith('master-'))) {
            if (!client.sharedMasterIds) client.sharedMasterIds = [];
            client.sharedMasterIds.push(fnId);
        }

        // We map it if it's visible now (which it is, thanks to auto-unlock above)
        localMappings.push({ id: fnId, status: 'available' });
    });

    const localInstance = {
        id: 'local-app-' + Date.now(),
        masterRefId: appId, 
        name: masterApp.name,
        notes: masterApp.notes || "",
        functionIds: localMappings, // 🚀 Mappings are born with the object
        capabilities: [] 
    };

    if (!client.projectData.localApps) client.projectData.localApps = [];
    client.projectData.localApps.push(localInstance);
    
    // 2. Persist the change
    await OL.persist();
    
    // 3. 🚀 THE UI TRIGGER: Ensure we refresh the specific view
    // buildLayout updates the sidebar (newly unlocked functions)
    // renderAppsGrid updates the cards (the new app with its pills)
    buildLayout();
    renderAppsGrid();
    
    // Small delay only for DOM cleanup if needed, but the render calls above do the heavy lifting
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
    
    // 1. Get Master Specs (Always Read-Only in Client View)
    let masterSpecs = [];
    if (app.masterRefId) {
        const masterSource = state.master.apps.find(ma => ma.id === app.masterRefId);
        masterSpecs = masterSource ? (masterSource.capabilities || []) : [];
    } else if (isVaultRoute) {
        masterSpecs = app.capabilities || [];
    }

    // 2. Get Local Specs (Private to this project)
    const localSpecs = isVaultRoute ? [] : (app.capabilities || []);

    // --- RENDER MASTER SPECS ---
    let html = masterSpecs.map(cap => `
        <div class="dp-manager-row master-spec" style="background: var(--panel-soft); border-left: 2px solid transparent;">
            <div style="display:flex; gap:10px; flex:1;">
                <span class="pill tiny soft">${cap.type}</span>
                <div class="dp-name-cell muted" style="cursor: default;">${esc(cap.name)}</div>
            </div>
            <span class="tiny muted" style="padding-right:10px; font-size: 10px;">🔒</span>
        </div>
    `).join('');

    // --- RENDER LOCAL SPECS ---
    html += localSpecs.map((cap, idx) => `
        <div class="dp-manager-row local-spec" style="border-left: 2px solid var(--accent); background: rgba(var(--accent-rgb), 0.03);">
            <div style="display:flex; gap:10px; flex:1;">
                <span class="pill tiny ${cap.type === 'Trigger' ? 'accent' : 'soft'} is-clickable" 
                      style="cursor:pointer; user-select:none; min-width: 55px; text-align:center;"
                      title="Left or Right Click to toggle Trigger/Action"
                      onclick="OL.toggleCapabilityType(event, '${app.id}', ${idx})"
                      oncontextmenu="OL.toggleCapabilityType(event, '${app.id}', ${idx}); return false;">
                    ${cap.type || 'Action'}
                </span>

                <div class="dp-name-cell" 
                    contenteditable="true" 
                    style="cursor: text; flex: 1;"
                    onblur="OL.updateLocalCapability('${app.id}', ${idx}, 'name', this.textContent)">
                    ${esc(cap.name)}
                </div>
            </div>
            <div style="display:flex; gap:5px; align-items:center;">
                ${state.adminMode ? `
                    <button class="btn tiny primary" 
                            style="padding: 2px 6px; font-size: 9px;"
                            onclick="OL.pushSpecToMaster('${app.id}', ${idx})">⭐ PUSH</button>
                ` : ''}
                <span class="card-close" 
                      style="cursor:pointer; padding-right:5px;" 
                      onclick="OL.removeLocalCapability('${app.id}', ${idx})">×</span>
            </div>
        </div>
    `).join('');
    return html || '<div class="empty-hint">No capabilities defined.</div>';
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
    const client = getActiveClient();
    const app = client?.projectData?.localApps.find(a => a.id === appId);
    
    if (app && app.capabilities && app.capabilities[idx]) {
        app.capabilities[idx][field] = value.trim();
        OL.persist();
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
    // --- 📱 SCENARIO 2: PROJECT MAPPING ---
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

OL.executeCreateAndMap = function(name, mode) {
    const client = getActiveClient();
    const contextId = OL.currentOpenModalId;
    const isVault = window.location.hash.startsWith('#/vault');

    if (mode === 'apps') {
        const newId = (isVault ? 'master-app-' : 'local-app-') + Date.now();
        const newApp = {
            id: newId,
            name: name,
            functionIds: [{ id: contextId, status: 'available' }],
            capabilities: []
        };
        
        if (isVault) {
            state.master.apps.push(newApp);
        } else if (client) {
            client.projectData.localApps.push(newApp);
        }
    } else {
        // Handle creating a new Function from an App modal
        const newId = (isVault ? 'fn-' : 'local-fn-') + Date.now();
        const newFn = { id: newId, name: name, description: "" };
        
        if (isVault) {
            state.master.functions.push(newFn);
        } else if (client) {
            client.projectData.localFunctions.push(newFn);
        }
        
        // Map the new function to the current app
        OL.toggleAppFunction(contextId, newId);
    }
    
    OL.persist();
    OL.refreshActiveView();
    // Refresh current modal
    if (mode === 'apps') OL.openFunctionModal(contextId);
    else OL.openAppModal(contextId);
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
        <div class="modal-head">
            <div class="modal-title-text">⚙️ Master Function Groups</div>
            <div class="spacer"></div>
            <button class="btn small primary" onclick="OL.addNewMasterFunction()">+ New Group</button>
            <button class="btn small soft" onclick="OL.closeModal()">Close</button>
        </div>
        <div class="modal-body">
            <p class="small muted" style="margin-bottom: 20px;">
                Define global categories (e.g., 'CRM', 'Billing', 'Custodian') to organize your App Library and enable Benchmarking.
            </p>
            <div class="dp-manager-list">
                ${fns.map(fn => `
                    <div class="dp-manager-row">
                        <div class="dp-name-cell" contenteditable="true" 
                             onblur="OL.updateMasterFunction('${fn.id}', 'name', this.textContent); OL.persist();">
                            ${esc(fn.name)}
                        </div>
                        <div class="dp-action-cell">
                            <span class="card-close" onclick="OL.deleteMasterFunction('${fn.id}')">×</span>
                        </div>
                    </div>
                `).join('')}
                ${fns.length === 0 ? '<div class="empty-hint" style="padding: 20px; text-align: center;">No function groups defined yet.</div>' : ''}
            </div>
        </div>
    `;
    openModal(html);
};

window.renderFunctionsGrid = function() {
    OL.registerView(renderFunctionsGrid);
    const container = document.getElementById("mainContent");
    const client = getActiveClient(); 
    const hash = window.location.hash;
    const isMasterMode = hash.startsWith('#/vault');
    
    if (!container) return;

    // 1. DATA AGGREGATION: Smart Filtering
    let displayFunctions = [];
    if (isMasterMode) {
        // Vault: Show all global templates
        displayFunctions = state.master.functions || [];
    } else if (client) {
        // Project: Show ONLY local functions + Master functions this client has deployed
        const local = client.projectData.localFunctions || [];
        const sharedMaster = (state.master.functions || []).filter(f => 
            (client.sharedMasterIds || []).includes(f.id)
        );
        displayFunctions = [...sharedMaster, ...local];
    }
    displayFunctions.sort((a, b) => a.name.localeCompare(b.name));

    // Get Apps for pill display inside the cards
    const masterApps = state.master.apps || [];
    const clientLocalApps = client?.projectData?.localApps || [];
    const allRelevantApps = isMasterMode 
        ? (state.master.apps || []) 
        : (client?.projectData?.localApps || []);

    container.innerHTML = `
        <div class="section-header">
            <div>
                <h2>${isMasterMode ? '🏛️ Master Function Vault' : '⚒️ Project Functions'}</h2>
                <div class="small muted subheader">
                    ${isMasterMode ? 'Global System Architecture' : `Categorized Operations for ${esc(client.meta.name)}`}
                </div>
            </div>
            <div class="header-actions">
                ${isMasterMode ? `
                    <button class="btn primary" onclick="OL.addNewMasterFunction()">+ Create Master Function</button>
                ` : `
                    <button class="btn small soft" onclick="OL.promptAddLocalFunction('${client.id}')">+ Create Local Function</button>
                    <button class="btn primary" onclick="OL.openVaultFunctionDeploymentModal('${client.id}')">⬇ Import from Master</button>
                `}
            </div>
        </div>
        ${renderStatusLegendHTML()}

        <div class="cards-grid">
            ${displayFunctions.map(fn => {
                // Determine Tag and color based on Linkage
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
                            <div class="card-title">${esc(fn.name)}</div>
                            <div style="display:flex; align-items:center; gap:8px;">
                                <span class="vault-tag" style="background: ${tagColor}">
                                    ${tagLabel}
                                </span>
                                <button class="card-delete-btn" onclick="event.stopPropagation(); OL.deleteCard('${fn.id}', 'functions', event)">×</button>
                            </div>
                        </div>
                        <div class="card-body">
                            <div class="pills-row" style="margin-top: 10px;">
                                ${mappedApps.map(app => `
                                    <span class="pill tiny status-${app.currentStatus || 'available'} is-clickable" 
                                        onclick="OL.handlePillInteraction(event, '${app.id}', '${fn.id}')"
                                        oncontextmenu="OL.handlePillInteraction(event, '${app.id}', '${fn.id}'); return false;"
                                        title="Left Click: Jump | Right Click: Cycle Status | Cmd+Click: Unmap">
                                      ${esc(app.name)}
                                    </span>
                                `).join('')}
                                ${mappedApps.length === 0 ? '<span class="tiny muted">No apps currently mapped.</span>' : ''}
                            </div>
                        </div>
                    </div>
                `;
              }).join('')}
            ${displayFunctions.length === 0 ? '<div class="empty-hint">No functions active. Deploy from vault or add local.</div>' : ''}
        </div>
    `;
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
    
    // 1. Resolve Function Data
    let fn = draftObj;
    if (!fn) {
        fn = [...(state.master.functions || []), ...(client?.projectData?.localFunctions || [])]
             .find(f => String(f.id) === String(fnId));
    }
    if (!fn) return;

    // 2. Identify Modal Shell for Soft Refresh
    const modalLayer = document.getElementById("modal-layer");
    const isModalVisible = modalLayer && modalLayer.style.display === "flex";
    const modalBody = document.querySelector('.modal-body');

    // 🚀 THE FIX: Use a "Safe Client" variable to ensure the renderer 
    // knows exactly which context to look at for Apps.
    const safeClient = isVaultMode ? null : client;

    // Soft Refresh Logic
    if (isModalVisible && modalBody) {
        modalBody.innerHTML = renderFunctionModalInnerContent(fn, safeClient);
        // Sync the header name too
        const titleInput = document.querySelector('.header-editable-input');
        if (titleInput) titleInput.value = fn.name;
        return;
    }

    // 3. Generate Full HTML (Standard logic)
    const html = `
        <div class="modal-head" style="gap:15px;">
            <div style="display:flex; align-items:center; gap:10px; flex:1;">
                <span style="font-size:18px;">⚒️</span>
                <input type="text" class="header-editable-input" 
                       value="${esc(val(fn.name))}" 
                       placeholder="Function Name..."
                       style="background:transparent; border:none; color:inherit; font-size:18px; font-weight:bold; width:100%; outline:none;"
                       onblur="OL.handleFunctionSave('${fn.id}', this.value)">
            </div>
            <button class="btn small soft" onclick="OL.closeModal()">Close</button>
        </div>
        <div class="modal-body">
            ${renderFunctionModalInnerContent(fn, safeClient)}
        </div>
    `;
    window.openModal(html);
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
            <div class="banner info" style="margin-bottom:20px; padding:10px; background:rgba(var(--accent-rgb), 0.05); border: 1px solid var(--accent); border-radius:6px; font-size:11px;">
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
        <div class="modal-head">
            <div class="modal-title-text">⚒️ Deploy Master Functions</div>
            <div class="spacer"></div>
            <button class="btn small soft" onclick="OL.closeModal()">Cancel</button>
        </div>
        <div class="modal-body">
            <div class="search-map-container">
                <input type="text" class="modal-input" 
                       placeholder="Click to view functions..." 
                       onfocus="OL.filterMasterFunctionImport('${clientId}', '')"
                       oninput="OL.filterMasterFunctionImport('${clientId}', this.value)" 
                       autofocus>
                <div id="master-fn-import-results" class="search-results-overlay" style="margin-top:10px;"></div>
            </div>
        </div>
    `;
    openModal(html);
};

OL.filterMasterFunctionImport = function(clientId, query) {
    const listEl = document.getElementById("master-fn-import-results");
    if (!listEl) return;

    const q = (query || "").toLowerCase().trim();
    const client = state.clients[clientId];
    
    // 🛡️ Get IDs of EVERYTHING already in the project
    // This includes locally created functions AND master functions already shared/imported
    const deployedRefs = (client?.projectData?.localFunctions || []).map(f => String(f.masterRefId));
    const sharedIds = (client?.sharedMasterIds || []).map(id => String(id));
    
    const available = (state.master.functions || [])
        .filter(fn => {
            const isMatch = fn.name.toLowerCase().includes(q);
            const isAlreadyPresent = deployedRefs.includes(String(fn.id)) || sharedIds.includes(String(fn.id));
            return isMatch && !isAlreadyPresent;
        })
        .sort((a, b) => a.name.localeCompare(b.name)); // 🚀 Alphabetical Sort

    listEl.innerHTML = available.map(fn => `
        <div class="search-result-item" onmousedown="OL.pushFunctionToClient('${fn.id}', '${clientId}'); OL.closeModal();">
            <div style="display:flex; align-items:center; gap:8px;">
                <span>⚙️</span>
                <span>${esc(fn.name)}</span>
            </div>
        </div>
    `).join('') || `<div class="search-result-item muted">No unlinked functions found.</div>`;
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
    
    if (!container || (!isVault && !client)) return;

    const allTasks = isVault ? (state.master.taskBlueprints || []) : (client.projectData.clientTasks || []);
    const showCompleted = !!state.ui.showCompleted;

    // Filter logic: Always show Pending/In Progress/Blocked. Only show Done if toggled on.
    const visibleTasks = allTasks.filter(t => showCompleted || t.status !== "Done");
    const completedCount = allTasks.filter(t => t.status === "Done").length;

    container.innerHTML = `
        <div class="section-header">
            <div>
                <h2>📋 ${isVault ? 'Master Tasks' : 'Project Checklist'}</h2>
                <div class="small muted">${visibleTasks.length} tasks visible</div>
            </div>
            <div class="header-actions">
                ${!isVault ? `
                    <button class="btn small ${showCompleted ? 'accent' : 'soft'}" onclick="OL.toggleCompletedTasks()">
                        ${showCompleted ? '👁️ Hide' : '👁️ Show'} Completed (${completedCount})
                    </button>
                ` : ''}
                <button class="btn small soft" onclick="${isVault ? 'OL.promptCreateMasterTask()' : `OL.openAddTaskModal('${client.id}')`}">
                    + Create Task
                </button>
                <button class="btn primary" onclick="OL.openMasterTaskImporter()">
                    ⬇️ Import from Master
                </button>
            </div>
        </div>

        <div class="task-single-column" style="max-width: 800px; margin: 0 auto;">
            <div id="active-tasks-list">
                ${renderTaskList(client?.id, visibleTasks, isVault)}
            </div>
        </div>
    `;
};

window.renderBlueprintManager = function () {
  const container = document.getElementById("mainContent");
  const blueprints = state.master.taskBlueprints || [];

  container.innerHTML = `
        <div class="section-header">
            <div>
                <h2>📋 Master Task Blueprints</h2>
                <div class="small muted">Standard implementation steps</div>
            </div>
            <button class="btn primary" onclick="OL.promptCreateMasterTask()">+ New Blueprint</button>
        </div>
        <div class="cards-grid">
            ${blueprints.map((task) => `
                <div class="card is-clickable" onclick="OL.openTaskModal('${task.id}', true)">
                    <div class="card-header">
                        <div class="card-title">${esc(task.title)}</div>
                        <div style="display:flex; align-items:center; gap:8px;">
                            <button class="card-delete-btn" onclick="event.stopPropagation(); OL.removeMasterTask('${task.id}')">×</button>
                        </div>
                    </div>
                    <div class="card-body">
                        <div class="tiny muted">${esc(task.category || 'General')}</div>
                        <div class="pills-row" style="margin-top:8px;">
                             ${(task.appIds || []).length > 0 ? `<span class="pill tiny soft">📱 ${(task.appIds || []).length} Tools</span>` : ''}
                             ${(task.howToIds || []).length > 0 ? `<span class="pill tiny soft">📖 SOP Linked</span>` : ''}
                        </div>
                    </div>
                </div>
            `).join("")}
            ${blueprints.length === 0 ? '<div class="empty-hint">No blueprints created yet.</div>' : ''}
        </div>
    `;
};

// 2. RENDER TASK LIST AND TASK CARDS
function renderTaskList(clientId, tasks, isVault = false) {
    if (tasks.length === 0) return '<div class="empty-hint">No tasks found.</div>';
    const client = getActiveClient();

    return tasks.map(task => {
        const statusConfig = {
            'Pending': { color: '#94a3b8' },
            'In Progress': { color: '#3b82f6' },
            'Blocked': { color: '#ef4444' },
            'Done': { color: '#22c55e' }
        };
        const config = statusConfig[task.status || 'Pending'];
        const isDone = task.status === 'Done';

        return `
            <div class="task-card horizontal-row" style="
                position:relative; 
                background: ${isDone ? 'rgba(255,255,255,0.02)' : 'var(--panel-bg)'}; 
                border: 1px solid var(--panel-border); 
                padding: 8px 12px; 
                border-radius: 6px; 
                margin-bottom: 6px; 
                display: flex; 
                align-items: center; 
                gap: 16px; 
                transition: all 0.2s ease;
                ${isDone ? 'opacity: 0.6;' : ''}">
                
                <div style="width: 24px; display: flex; justify-content: center; flex-shrink: 0;">
                    ${!isVault ? `
                        <div onclick="OL.cycleTaskStatus('${clientId}', '${task.id}', event)" 
                             title="Status: ${task.status}"
                             style="width: 12px; height: 12px; border-radius: 50%; background: ${config.color}; cursor: pointer; border: 2px solid rgba(255,255,255,0.1); box-shadow: 0 0 5px ${config.color}33;">
                        </div>
                    ` : '<i style="font-size:12px; opacity:0.4;">📋</i>'}
                </div>

                <div class="task-name is-clickable ${isDone ? 'muted italic line-through' : ''}" 
                     onclick="OL.openTaskModal('${task.id}', ${isVault})"
                     style="font-weight: 500; font-size: 13.5px; flex: 1; min-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                    ${esc(task.title || task.name)}
                </div>

                <div style="display: flex; align-items: center; gap: 12px; flex-shrink: 0;">
                    ${!isVault && task.dueDate ? `
                        <span class="tiny muted" style="font-size: 10px; white-space: nowrap;">
                            📅 ${new Date(task.dueDate).toLocaleDateString([], {month:'short', day:'numeric'})}
                        </span>
                    ` : ''}

                    <div style="display: flex; gap: -4px;"> ${!isVault && (task.assigneeIds || []).map(mId => {
                            const m = client.projectData.teamMembers?.find(mem => mem.id === mId);
                            return m ? `<span class="pill tiny accent" style="font-size: 9px; padding: 1px 6px; border-radius: 10px; border: 1px solid var(--accent); background: rgba(var(--accent-rgb), 0.1); margin-left: -4px;">${esc(m.name.substring(0,1))}</span>` : '';
                        }).join('')}
                    </div>
                </div>

                <div style="display: flex; align-items: center; gap: 8px; min-width: 120px; justify-content: flex-end; flex-shrink: 0;">
                    ${(task.appIds || []).length > 0 ? `
                        <span class="pill tiny soft" title="${(task.appIds || []).length} Tools Linked" style="font-size: 10px; padding: 2px 6px; background: rgba(255,255,255,0.03); border: 1px solid var(--panel-border);">
                            📱 ${(task.appIds || []).length}
                        </span>` : ''}
                    ${(task.howToIds || []).length > 0 ? `
                        <span class="pill tiny soft" title="${(task.howToIds || []).length} SOPs Linked" style="font-size: 10px; padding: 2px 6px; background: rgba(255,255,255,0.03); border: 1px solid var(--panel-border);">
                            📖 ${(task.howToIds || []).length}
                        </span>` : ''}
                </div>

                <div style="width: 20px; display: flex; justify-content: flex-end;">
                    <button class="card-close" style="font-size: 14px; opacity: 0.3; cursor: pointer; background: none; border: none; color: inherit;"
                            onclick="event.stopPropagation(); ${isVault ? `OL.removeMasterTask('${task.id}')` : `OL.removeClientTask('${clientId}', '${task.id}')`}">×</button>
                </div>
            </div>
        `;
    }).join("");
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
    const client = getActiveClient();
    let task = isVault 
        ? state.master.taskBlueprints.find(t => t.id === taskId)
        : client?.projectData?.clientTasks.find(t => t.id === taskId);

    if (!task) return;

    const html = `
        <div class="modal-head">
            <div style="display:flex; align-items:center; gap:10px; flex:1;">
                <span style="font-size:18px;">📋</span>
                <input type="text" class="header-editable-input" 
                      value="${esc(task.title || task.name)}" 
                      placeholder="Task Name..."
                      style="background:transparent; border:none; color:inherit; font-size:18px; font-weight:bold; width:100%; outline:none;"
                        onblur="OL.updateTaskField('${taskId}', '${isVault ? 'title' : 'name'}', this.value, ${isVault})">
            </div>
            <button class="btn small soft" onclick="OL.closeModal()">Close</button>
        </div>
        <div class="modal-body">
            <div class="card-section" style="margin-top: 15px;">
                <label class="modal-section-label">Internal SOP / Instructions</label>
                <textarea class="modal-textarea" rows="4" 
                          onblur="OL.updateTaskField('${taskId}', 'description', this.value, ${isVault})">${esc(task.description || task.notes || "")}</textarea>
            </div>

            <div class="card-section" style="margin-top: 15px;">
                <label class="modal-section-label">🛠️ Required Tools (Apps)</label>
                <div class="pills-row" id="task-app-pills" style="margin-bottom: 8px;">
                    ${(task.appIds || []).map(appId => {
                        const app = [...state.master.apps, ...(client?.projectData.localApps || [])].find(a => a.id === appId);
                        return app ? `
                            <span class="pill tiny soft is-clickable" onclick="OL.handleTaskAppInteraction(event, '${taskId}', '${app.id}', ${isVault})">
                                📱 ${esc(app.name)}
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

            <div class="card-section" style="margin-top: 15px;">
                <label class="modal-section-label">👩‍🏫 Linked How-To Guides</label>
                <div class="pills-row" style="margin-bottom: 8px;">
                    ${(task.howToIds || []).map(htId => {
                        const guide = (state.master.howToLibrary || []).find(g => g.id === htId); 
                        if (!guide) return ''; 
                        return `
                            <span class="pill tiny soft is-clickable" 
                                  style="cursor: pointer;" 
                                  onclick="OL.openHowToModal('${guide.id}')">
                                📖 ${esc(guide.name)}
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
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                    <div>
                        <label class="modal-section-label">📅 Due Date</label>
                        <input type="date" class="modal-input" value="${task.dueDate || ''}" 
                               onchange="OL.updateTaskField('${taskId}', 'dueDate', this.value, false)">
                    </div>
                    <div>
                        <label class="modal-section-label">Status</label>
                        <select class="modal-input" onchange="OL.updateTaskField('${taskId}', 'status', this.value, false)">
                            <option value="Pending" ${task.status === 'Pending' ? 'selected' : ''}>⏳ Pending</option>
                            <option value="In Progress" ${task.status === 'In Progress' ? 'selected' : ''}>🚧 In Progress</option>
                            <option value="Done" ${task.status === 'Done' ? 'selected' : ''}>✅ Done</option>
                        </select>
                    </div>
                </div>
                <div>
                    <label class="modal-section-label" style="margin-top:15px;">👨‍💼 Assigned Team Members</label>
                    <div class="pills-row" id="task-assignee-pills" style="margin-bottom: 8px;">
                        ${(task.assigneeIds || []).map(mId => {
                            const member = client.projectData.teamMembers?.find(m => m.id === mId);
                            if (!member) return '';
                            return `
                                <span class="pill tiny accent">
                                    👨‍💼 ${esc(member.name)}
                                    <b class="pill-remove-x" onclick="OL.toggleTaskAssignee(event, '${taskId}', '${member.id}')">×</b>
                                </span>`;
                        }).join('')}
                    </div>
                    <div class="search-map-container">
                        <input type="text" class="modal-input tiny" placeholder="Click to assign member..." 
                            onfocus="OL.filterTaskAssigneeSearch('${taskId}', '')"
                            oninput="OL.filterTaskAssigneeSearch('${taskId}', this.value)">
                        <div id="task-assignee-results" class="search-results-overlay"></div>
                    </div>
                </div>
            ` : ''}
        </div>
    `;
    openModal(html);
};

// 3. MASTER TASK IMPORTER
OL.openMasterTaskImporter = function () {
    const html = `
        <div class="modal-head">
            <div class="modal-title-text">📥 Import Master Blueprints</div>
            <div class="spacer"></div>
            <button class="btn small soft" onclick="OL.closeModal()">Cancel</button>
        </div>
        <div class="modal-body">
            <div class="search-map-container">
                <input type="text" class="modal-input" 
                       placeholder="Search blueprints or onboarding steps..." 
                       onfocus="OL.filterMasterTaskImport('')"
                       oninput="OL.filterMasterTaskImport(this.value)" 
                       autofocus>
                <div id="master-task-import-results" class="search-results-overlay" style="margin-top:10px;"></div>
            </div>
        </div>
    `;
    openModal(html);
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
    
    // 1. Resolve current task to find existing app links
    const task = isVault 
        ? state.master.taskBlueprints.find(t => t.id === taskId)
        : client?.projectData?.clientTasks.find(t => t.id === taskId);
    
    const existingAppIds = task?.appIds || [];

    // 2. Identify the source list (Master + Local)
    const source = [...state.master.apps, ...(client?.projectData?.localApps || [])];

    // 3. Apply Smart Filter: Match search AND exclude existing IDs
    const matches = source.filter(a => {
        const nameMatch = a.name.toLowerCase().includes(q);
        const alreadyLinked = existingAppIds.includes(a.id);
        return nameMatch && !alreadyLinked;
    });

    // 4. Render results
    listEl.innerHTML = matches.map(app => `
        <div class="search-result-item" onmousedown="OL.toggleTaskApp('${taskId}', '${app.id}', ${isVault})">
            <div style="display:flex; justify-content:space-between; width:100%; align-items:center;">
                <span>📱 ${esc(app.name)}</span>
                <span class="tiny-tag ${String(app.id).startsWith('local') ? 'local' : 'vault'}">
                    ${String(app.id).startsWith('local') ? 'LOCAL' : 'MASTER'}
                </span>
            </div>
        </div>
    `).join('') || '<div class="search-result-item muted">All matching tools are already linked.</div>';
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
        <div class="search-result-item" onmousedown="OL.toggleTaskAssignee(event, '${taskId}', '${member.id}')">
            👨‍💼 ${esc(member.name)}
        </div>
    `).join('') || '<div class="search-result-item muted">Everyone matching is already assigned.</div>';
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

// 1. RESOURCE MANAGER
if (!state.master.resourceTypes) {
  state.master.resourceTypes = [
    { type: "Zap", typeKey: "zap", archetype: "Multi-Step" },
    { type: "Form", typeKey: "form", archetype: "Base" },
  ];
}

window.renderResourceManager = function () {
    OL.registerView(renderResourceManager);
    const container = document.getElementById("mainContent");
    const client = getActiveClient();
    const hash = window.location.hash;

    // Use startsWith for a more reliable check
    const isVaultView = hash.startsWith('#/vault');

    let displayRes = [];

    if (isVaultView) {
        displayRes = state.master.resources || [];
    } else if (client) {
        // 🚀 FORCE INITIALIZATION: Ensure the key exists before trying to read it
        if (!client.projectData.localResources) {
            client.projectData.localResources = [];
        }
        displayRes = client.projectData.localResources;
    }

    if (isVaultView && displayRes.length === 0 && state.master.resources) {
        displayRes = state.master.resources;
    }

    // 🚀 SAFE SORT: Create a copy [...displayRes] so we don't mutate the original state in-place
    const sortedRes = [...displayRes].sort((a, b) => (a.name || "").localeCompare(b.name || ""));

    container.innerHTML = `
        <div class="section-header">
            <div>
                <h2>📦 ${isVaultView ? 'Master Vault' : 'Project Library'}</h2>
                <div class="small muted">${sortedRes.length} items found</div>
            </div>
            <div class="header-actions">
                <button class="btn small soft" onclick="OL.openResourceTypeManager()">⚙️ Types</button>
                <button class="btn small soft" onclick="OL.promptCreateResource()">
                    + Create ${isVaultView ? 'Master' : 'Local'} Resource
                </button>
                ${!isVaultView ? `<button class="btn primary" onclick="OL.importFromMaster()">⬇️ Import from Master</button>` : ''}
            </div>
        </div>
        <div class="cards-grid">
            ${sortedRes.length > 0 
                ? sortedRes.map(res => renderResourceCard(res)).join("") 
                : `<div class="empty-hint" style="grid-column: 1/-1; padding: 40px; text-align: center; opacity: 0.5;">
                    No resources found in this ${isVaultView ? 'Vault' : 'Project'}.
                   </div>`
            }
        </div>
    `;
};

OL.openResourceTypeManager = function () {
    const registry = state.master.resourceTypes || [];

    let html = `
        <div class="modal-head">
            <div class="modal-title-text">⚙️ Manage Resource Types</div>
            <div class="spacer"></div>
            <button class="btn small soft" onclick="OL.closeModal()">Close</button>
        </div>
        <div class="modal-body">
            <p class="tiny muted" style="margin-bottom:20px;">
                Define categories for your resources. Each type automatically gets a standard base rate in the Pricing library.
            </p>
            
            <div class="dp-manager-list">
                ${registry.map(t => {
                    const encType = btoa(t.type);
                    return `
                    <div class="dp-manager-row" style="margin-bottom: 8px; background: var(--panel-soft); padding: 10px; border-radius: 6px; display:flex; justify-content:space-between; align-items:center;">
                        <span contenteditable="true" 
                              style="font-weight:600; cursor: text; border-bottom: 1px dashed transparent;"
                              onblur="OL.renameResourceTypeFlat('${encType}', this.innerText)">
                            ${esc(t.type)}
                        </span>
                        <button class="card-delete-btn" style="position:static" onclick="OL.removeRegistryTypeByKey('${t.typeKey}')">×</button>
                    </div>`;
                }).join('')}
            </div>

            <div style="display:flex; gap:8px; margin-top:20px; padding-top:20px; border-top: 1px solid var(--line);">
                <input type="text" id="new-type-input" class="modal-input" placeholder="e.g. Email Campaign, Zap, Form...">
                <button class="btn primary" onclick="OL.addNewResourceTypeFlat()">Add Type</button>
            </div>
        </div>`;
    openModal(html);
};

// 1. Add New Type
OL.addNewResourceTypeFlat = function () {
    const input = document.getElementById('new-type-input');
    const val = (input.value || "").trim();
    if (!val || val.toLowerCase() === "general") return;

    const typeKey = val.toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (!state.master.resourceTypes) state.master.resourceTypes = [];
    
    // Check for duplicates
    if (state.master.resourceTypes.some(t => t.typeKey === typeKey)) return alert("Type already exists.");

    state.master.resourceTypes.push({ type: val, typeKey: typeKey });

    // Create default base rate
    const safeKey = typeKey + "_" + Date.now().toString().slice(-4);
    if (!state.master.rates.variables) state.master.rates.variables = {};
    state.master.rates.variables[safeKey] = {
        id: safeKey,
        label: `${val} Base Rate`,
        value: 150,
        applyTo: val,
        category: "Resource Rates"
    };

    OL.persist();
    OL.openResourceTypeManager(); 
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

// 2. RESOURCE CARD AND MODAL
window.renderResourceCard = function (res) {
    if (!res) return "";
    
    // Check if it's master or local
    const isVaultItem = String(res.id || "").startsWith("res-vlt-");
    const isLinkedToMaster = !!res.masterRefId;
    const isMaster = isVaultItem || isLinkedToMaster;
    
    const tagLabel = isMaster ? "MASTER" : "LOCAL";
    const tagStyle = isMaster 
        ? "background: var(--accent); border: none;" 
        : "background: var(--panel-border); color: var(--text-dim); border: 1px solid var(--line);";

    return `
        <div class="card is-clickable" onclick="OL.openResourceModal('${res.id}')">
            <div class="card-header">
                <div class="card-title">${esc(res.name || "Unnamed")}</div>
                <div style="display:flex; align-items:center; gap:8px;">
                    <span class="vault-tag" style="${tagStyle}">
                        ${tagLabel}
                    </span>
                    <button class="card-delete-btn" 
                            onclick="event.stopPropagation(); OL.deleteResource('${res.id}')">×</button>
                </div>
            </div>
            <div class="card-body">
                <div class="tiny accent bold uppercase">${esc(res.archetype || "Base")}</div>
                <div class="tiny muted">${esc(res.type || "General")}</div>
                ${isLinkedToMaster && !isVaultItem ? `<div class="tiny muted" style="margin-top:4px; font-style:italic;">⛓️ Synced to Vault</div>` : ''}
            </div>
        </div>
    `;
};

// 3. CREATE DRAFT RESOURCE MODAL
OL.promptCreateResource = function () {
    const hash = window.location.hash;
    const isVault = hash.startsWith('#/vault');
    const tempId = 'draft-' + Date.now();
    
    const draftRes = {
        id: tempId,
        name: "",
        type: "General",
        archetype: "Base",
        isDraft: true,
        // 🚀 THE KEY: Tag the draft with its intended home
        originContext: isVault ? 'vault' : 'project',
        returnRoute: hash 
    };

    OL.openResourceModal(tempId, draftRes);
};

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
                target.archetype = registryEntry.archetype;
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

OL.handleModalSave = function(id, nameOrContext) {
    // 1. Get the actual name from the DOM input
    const input = document.getElementById('modal-res-name');
    const cleanName = input ? input.value.trim() : (typeof nameOrContext === 'string' ? nameOrContext.trim() : "");

    if (!cleanName || cleanName.toLowerCase() === 'vault' || cleanName.toLowerCase() === 'project') {
        // This guard prevents the "Vault" string from becoming the name
        // if the function was accidentally called with context as the name.
        if (!input) return; 
    }

    const isDraft = id.startsWith('draft-');
    const isVault = window.location.hash.includes('vault');

    if (isDraft) {
        const timestamp = Date.now();
        const newId = isVault ? `res-vlt-${timestamp}` : `local-prj-${timestamp}`;
        
        const newRes = { 
            id: newId, 
            name: cleanName, // 🚀 Uses the name from the input, not the context string
            type: "General", 
            archetype: "Base", 
            createdDate: new Date().toISOString() 
        };

        if (isVault) {
            if (!state.master.resources) state.master.resources = [];
            state.master.resources.push(newRes);
        } else {
            const client = getActiveClient();
            if (!client.projectData.localResources) client.projectData.localResources = [];
            client.projectData.localResources.push(newRes);
        }
        
        OL.persist();
        OL.openResourceModal(newId); 
        renderResourceManager();
    } else {
        OL.updateResourceMeta(id, 'name', cleanName);
    }
};

// 3b. COMMIT THE RESOURCE
OL.commitDraftToSystem = async function (tempId, finalName, context) {
    if (window._savingLock === tempId) return;
    window._savingLock = tempId;

    const isVault = (context === 'vault');
    const timestamp = Date.now();
    const newResId = isVault ? `res-vlt-${timestamp}` : `local-prj-${timestamp}`;

    const newRes = { 
        id: newResId, 
        name: finalName, 
        type: "General", 
        archetype: "Base", 
        data: {}, 
        steps: [],
        triggers: [],
        createdDate: new Date().toISOString() 
    };

    // Push to State
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

    await OL.persist();
    
    // UI Cleanup
    window._savingLock = null;
    OL.closeModal();
    renderResourceManager();
    
    // Optional: Re-open with permanent ID
    setTimeout(() => OL.openResourceModal(newResId), 100);
};

OL.getDraftById = function(id) {
    // This finds the draft object currently held in the modal's internal state
    // If you are using a global draft variable or passing it through, ensure it's accessible.
    // Most simply, we can check the active modal box dataset:
    const box = document.getElementById('active-modal-box');
    return box ? JSON.parse(box.dataset.draftSource || '{}') : null;
};

OL.getResourceById = function(id) {
    if (!id) return null;
    const idStr = String(id);

    // Check Master
    const fromMaster = (OL.state.master.resources || []).find(r => String(r.id) === idStr);
    if (fromMaster) return fromMaster;

    // Check Active Client
    const client = getActiveClient();
    const fromLocal = (client?.projectData?.localResources || []).find(r => String(r.id) === idStr);
    return fromLocal || null;
};

// 3c. OPEN RESOURCE MODAL
OL.openResourceModal = function (targetId, draftObj = null) {
    if (!targetId) return;

    const client = getActiveClient();
    const sheet = client?.projectData?.scopingSheets?.[0];
    const ctx = OL.getCurrentContext(); 
    
    let res = null;
    let lineItem = null;
    let isScopingContext = false;

    // 1. DATA RESOLUTION
    if (draftObj) {
        res = draftObj;
        isScopingContext = !!draftObj.isScopingContext;
    } else {
        lineItem = sheet?.lineItems.find(i => i.id === targetId);
        const lookupId = lineItem ? lineItem.resourceId : targetId;
        res = OL.getResourceById(lookupId);
        isScopingContext = !!lineItem;
    }

    if (!res) return;

    const isDraft = String(res.id).startsWith('draft-');
    const isMasterLinked = !!res.masterRefId;
    const isVaultResource = String(res.id).startsWith('res-vlt-');
    const activeData = isScopingContext ? lineItem : res;
    
    const relevantVars = Object.entries(state.master.rates?.variables || {}).filter(([_, v]) => {
        return v.applyTo === res.type;
    });

    const lookupId = res.masterRefId || res.id; // Get the original Master ID if this is a client copy

    const linkedSOPs = (state.master.howToLibrary || []).filter(ht => 
        (ht.resourceIds || []).includes(lookupId)
    );

    const html = `
        <div class="modal-head" style="gap:15px;">
            <div style="display:flex; align-items:center; gap:10px; flex:1;">
                <span style="font-size:18px;">🛠️</span>
                <input type="text" class="header-editable-input" 
                    id="modal-res-name"
                    value="${esc(val(res.name))}" 
                    placeholder="Resource Name..."
                    style="background:transparent; border:none; color:inherit; font-size:18px; font-weight:bold; width:100%; outline:none;"
                    onblur="OL.handleModalSave('${res.id}')">
            </div>
            
            <button class="btn tiny primary" onclick="OL.launchDirectToVisual('${res.id}')">🎨 Visual Editor</button>
            
            <button class="btn tiny accent" onclick="OL.toggleWorkflowFullscreen('${res.id}')">🖥️ Fullscreen</button>
            <button class="btn small soft" onclick="OL.closeModal()">Close</button>
        </div>

        <div class="modal-body" style="max-height: 80vh; overflow-y: auto;">

            <div class="card-section" style="margin-top:15px;">
                <label class="modal-section-label">Resource Type</label>
                <select class="modal-input" onchange="OL.updateResourceMeta('${res.id}', 'type', this.value)">
                    <option value="General" ${(!res.type || res.type === "General") ? "selected" : ""}>General</option>
                    ${(state.master.resourceTypes || []).map(t => `<option value="${esc(t.type)}" ${res.type === t.type ? "selected" : ""}>${esc(t.type)}</option>`).join("")}
                </select>
            </div>

            <div class="card-section" style="margin-top: 20px;">
                <label class="modal-section-label">📊 Scoping & Pricing</label>
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
                    ${relevantVars.map(([varKey, v]) => `
                        <div class="modal-column">
                            <label class="tiny muted">${esc(v.label)} ($${v.value})</label>
                            <input type="number" class="modal-input tiny" 
                                  value="${num(activeData.data?.[varKey])}" 
                                  placeholder="0"
                                  oninput="OL.updateResourcePricingData('${activeData.id}', '${varKey}', this.value)">
                        </div>`).join("")}
                </div>
            </div>

            <div class="card-section" style="margin-top:20px; padding-top:15px; border-top: 1px solid var(--line);">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                    <label class="modal-section-label">📝 Workflow Steps (SOP)</label>
                    <button class="btn tiny soft" onclick="OL.openResourceLinker('${res.id}')">🔗 Link Resource</button>
                    <button class="btn tiny accent" onclick="OL.addResourceTrigger('${res.id}')">+ Add Trigger</button>
                    <button class="btn tiny primary" onclick="OL.addSopStep('${res.id}')">+ Add Step</button>
                </div>
                <div id="sop-step-list">${renderSopStepList(res)}</div>
            </div>

            <div class="card-section" style="margin-top: 15px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                    <label class="modal-section-label">📖 Linked Deployment Guides (SOPs)</label>
                    <div class="search-map-container" style="width: 200px;">
                        <input type="text" class="modal-input tiny" placeholder="Link an SOP..." 
                                onfocus="OL.filterResourceSOPLinker('${res.id}', '')"
                                oninput="OL.filterResourceSOPLinker('${res.id}', this.value)">
                        <div id="res-sop-linker-results" class="search-results-overlay"></div>
                    </div>
                </div>
                <div class="pills-row">
                    ${linkedSOPs.map(sop => `
                        <span class="pill tiny accent is-clickable" style="cursor:pointer;" onclick="OL.openHowToModal('${sop.id}')">
                            📖 ${esc(sop.name)}
                        </span>
                    `).join('')}
                    ${linkedSOPs.length === 0 ? '<span class="tiny muted italic">No SOP linked.</span>' : ''}
                </div>
            </div>

            <div class="card-section" style="margin-top: 20px;">
                <label class="modal-section-label">Notes</label>
                <textarea class="modal-textarea" rows="3" onblur="OL.updateResourceMeta('${res.id}', 'notes', this.value)">${esc(res.notes || "")}</textarea>
            </div>
        </div>
    `;
    openModal(html);
};

// RESOURCE TRIGGERS SECTION

function renderResourceTriggers(res) {
    const triggers = res.triggers || [];
    
    return `
        <div style="display:flex; flex-wrap:wrap; gap:8px; align-items:center;">
            <span class="tiny muted bold uppercase" style="letter-spacing:1px; margin-right:5px;">Triggers:</span>
            ${triggers.map((t, idx) => `
                <div class="pill-group" style="display:flex; align-items:center; background:var(--panel-soft); border-radius:15px; padding:2px 8px; border:1px solid var(--line);">
                    <span class="is-clickable" style="font-size:10px; margin-right:6px;" 
                          onclick="OL.toggleTriggerType('${res.id}', ${idx})"
                          title="Toggle Auto/Manual">
                        ${t.type === 'auto' ? '⚡' : '👨‍💼'}
                    </span>
                    <span contenteditable="true" class="tiny" style="outline:none; min-width:40px;"
                          onblur="OL.updateTriggerName('${res.id}', ${idx}, this.innerText)">
                        ${esc(val(t.name, "New Trigger..."))}
                    </span>
                    <b class="pill-remove-x" style="margin-left:8px; cursor:pointer; opacity:0.5;" 
                       onclick="OL.removeTrigger('${res.id}', ${idx})">×</b>
                </div>
            `).join('')}
            <button class="btn tiny soft" onclick="OL.addResourceTrigger('${res.id}')" style="border-radius:15px; padding: 2px 10px;">+ Add</button>
        </div>
    `;
}

OL.addResourceTrigger = function(resId) {
    const res = OL.getResourceById(resId);
    if (!res) return;
    if (!res.triggers) res.triggers = [];
    
    res.triggers.push({ name: "", type: "auto" });
    OL.persist();
    
    // Surgical Update
    document.getElementById('resource-triggers-zone').innerHTML = renderResourceTriggers(res);
};

OL.toggleTriggerType = function(resId, idx) {
    const res = OL.getResourceById(resId);
    if (res && res.triggers[idx]) {
        res.triggers[idx].type = (res.triggers[idx].type === 'auto') ? 'manual' : 'auto';
        OL.persist();
        document.getElementById('resource-triggers-zone').innerHTML = renderResourceTriggers(res);
    }
};

OL.removeTrigger = function(resId, idx) {
    const res = OL.getResourceById(resId);
    if (res && res.triggers) {
        res.triggers.splice(idx, 1);
        OL.persist();
        document.getElementById('resource-triggers-zone').innerHTML = renderResourceTriggers(res);
    }
};

// UPDATE OR DELETE RESOURCE

OL.deleteResource = function (id) {
  if (!confirm("Delete resource?")) return;
  const isVault = window.location.hash.includes("vault");
  if (isVault)
    state.master.resources = state.master.resources.filter((r) => r.id !== id);
  else
    getActiveClient().projectData.localResources =
      getActiveClient().projectData.localResources.filter((r) => r.id !== id);
  OL.persist();
  renderResourceManager();
};

// 4. RESOURCE CARD & FOLDER RENDERERS
window.renderVaultRatesPage = function () {
  const container = document.getElementById("mainContent");
  if (!container) return;

  const rates = state.master.rates || {};
  const registry = state.master.resourceTypes || [];
  const variables = state.master.rates.variables || {};

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
OL.pushToMaster = function(localResId) {
    const client = getActiveClient();
    const localRes = client?.projectData?.localResources?.find(r => r.id === localResId);

    if (!localRes) return;
    if (!state.adminMode) return alert("Admin Mode required.");

    if (!confirm(`Standardize "${localRes.name}"?\n\nThis will add it to the Global Master Vault for all future projects.`)) return;

    // 1. Create Global Master Clone (The "Gold Standard" Source)
    const masterId = 'res-vlt-' + Date.now();
    const masterCopy = JSON.parse(JSON.stringify(localRes));
    
    masterCopy.id = masterId;
    masterCopy.createdDate = new Date().toISOString();
    masterCopy.originProject = client.meta.name; // Useful for tracking where it came from
    delete masterCopy.isScopingContext; 

    // 2. Add to Master Vault
    if (!state.master.resources) state.master.resources = [];
    state.master.resources.push(masterCopy);

    // 3. ✨ THE HYBRID LINK
    // We assign the ID and then empty the local steps.
    // This forces the app to look at the Vault for the SOP list.
    localRes.masterRefId = masterId;
    localRes.steps = []; 

    OL.persist();
    OL.closeModal();
    
    // 4. Refresh the Grid
    // Because renderResourceCard now checks !!masterRefId, the tag will flip to MASTER.
    renderResourceManager(); 
    
    alert(`🚀 Resource "${localRes.name}" is now a Master Template.`);
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

//======================RESOURCES / TASKS OVERLAP ======================//


//======================= SOP STEP LOGIC =======================//
window.renderSopStepList = function (res) {
    if (!(state.expandedSteps instanceof Set)) {
        // If it's an array (from persistence), convert it. Otherwise, new Set.
        state.expandedSteps = new Set(Array.isArray(state.expandedSteps) ? state.expandedSteps : []);
    }
    
    // Ensure editing state is also ready
    if (state.editingStepId === undefined) state.editingStepId = null;

    const triggers = res.triggers || [];
    const steps = res.steps || [];
    
    if (triggers.length === 0 && steps.length === 0) {
        return '<div class="empty-hint">No triggers or workflow steps defined.</div>';
    }

    let html = "";

    // 1. RENDER TRIGGERS (Entry Points) - Unchanged
    html += triggers.map((t, idx) => {
        const assigneeHtml = t.assigneeName ? `
            <span class="tiny muted" style="margin-left:auto; font-size:9px; background:rgba(255,255,255,0.1); padding:2px 6px; border-radius:10px; color:var(--accent);">
                ${t.assigneeType === 'role' ? '🎭' : t.assigneeType === 'system' ? '📱' : '👨'} ${esc(t.assigneeName)}
            </span>
        ` : '';

        return `
            <div class="dp-manager-row trigger-row" 
                 style="gap:10px; margin-bottom:6px; align-items: center; background: rgba(255, 191, 0, 0.08); border-left: 3px solid var(--accent);"
                 onclick="OL.openTriggerDetailModal('${res.id}', ${idx})">
                <span class="tiny accent bold" style="width:35px; font-size:9px;">WHEN</span>
                <div style="flex:1; display:flex; align-items:center; gap:8px;">
                    <span style="font-size:12px;">${t.type === 'auto' ? '⚡' : '👨'}</span>
                    <span class="bold" style="font-size:0.9em; color: var(--accent);">${esc(val(t.name, "New Trigger..."))}</span>
                    ${assigneeHtml}
                </div>
                <button class="card-delete-btn" style="position:static" onclick="event.stopPropagation(); OL.removeTrigger('${res.id}', ${idx})">×</button>
            </div>
        `;
    }).join("");

    // 2. RENDER STEPS (Sequential Actions with Inline Editing
    html += steps.map((step, idx) => {
        const outcomes = step.outcomes || [];
        const hasOutcomes = outcomes.length > 0;
        const isExpanded = state.expandedSteps.has(step.id);
        const isEditing = state.editingStepId === step.id;
        const isModule = step.type === 'module_block';
        const isLocked = !!step.isLocked || isModule;
        
        // Look up app name for the tooltip
        const client = getActiveClient();
        const allApps = [...(state.master.apps || []), ...(client?.projectData?.localApps || [])];
        const linkedApp = allApps.find(a => String(a.id) === String(step.appId));

        // --- ICON PLACEHOLDERS ---
        const assigneeDisplay = step.assigneeName 
            ? `<span class="pill tiny soft" title="Assigned To: ${esc(step.assigneeName)}">${step.assigneeType === 'role' ? '🎭' : step.assigneeType === 'system' ? '📱' : '👨‍💼'}</span>`
            : `<span class="tiny-placeholder" onclick="event.stopPropagation(); OL.openStepDetailModal('${res.id}', '${step.id}')">👨‍💼</span>`;

        const appDisplay = step.appId 
            ? `<span class="pill tiny accent" title="App: ${esc(linkedApp?.name || 'Linked')}">📱</span>`
            : `<span class="tiny-placeholder" onclick="event.stopPropagation(); OL.openStepDetailModal('${res.id}', '${step.id}')">📱</span>`;

        // --- 3. DYNAMIC DUE DATE (Reference-Based Lookup) ---
        let dateTooltip = "Set Due Date...";

        if (step.timingType) {
            let referenceName = "";

            if (step.timingType === 'after_prev') {
                referenceName = "Previous Step";
            } else if (step.timingType === 'after_start') {
                referenceName = "Workflow Start";
            } else if (step.timingType === 'before_end') {
                referenceName = "Workflow End";
            } else if (step.timingType.startsWith('after_')) {
                // 🔍 Extract ID: Remove 'after_' prefix to get the actual step ID
                const targetId = step.timingType.replace('after_', '');
                const targetStep = steps.find(s => String(s.id) === targetId);
                
                referenceName = targetStep ? val(targetStep.name, "Unnamed Step") : "Target Step";
            }

            if (referenceName) {
                // Example: "Due: 3 Days after Initial Call"
                dateTooltip = `Due: ${num(step.timingValue)} Days after ${esc(referenceName)}`;
            }
        }

        const dateDisplay = step.timingType
            ? `<span class="pill tiny soft" title="${dateTooltip}">📅</span>`
            : `<span class="tiny-placeholder" title="${dateTooltip}" onclick="event.stopPropagation(); OL.toggleInlineEdit(event, '${res.id}', '${step.id}')">📅</span>`;

        // --- TOGGLE BUTTON ---
        const toggleBtn = `
            <div class="vis-detail-toggle" onmousedown="OL.toggleStepOutcomes(event, '${res.id}', '${step.id}')" 
                style="cursor:pointer; width: 25px; height: 25px; display: flex; align-items: center; justify-content: center; margin-right: -10px; z-index: 10;">
                <span style="font-size: 10px; transition: transform 0.2s; display: inline-block; ${isExpanded ? 'transform: rotate(90deg);' : ''}">
                    ▶
                </span>
            </div>
        `;

        // --- 🚀 BRANCH 1: MODULE BLOCK (Updated with Icons) ---
        if (isModule) {
            const nestedRes = OL.getResourceById(step.linkedResourceId);
            const nestedSteps = nestedRes?.steps || [];
            const client = getActiveClient();
            const allApps = [...(state.master.apps || []), ...(client?.projectData?.localApps || [])];

            return `
                <div class="step-group module-block-container" draggable="true" 
                    ondragstart="OL.handleStepDragStart(event, ${idx})"
                    ondragover="OL.handleDragOver(event)"
                    ondrop="OL.handleStepDrop(event, ${idx}, '${res.id}')"
                    style="margin-bottom: 12px; border: 1px solid var(--accent); border-radius: 8px; overflow: hidden; background: rgba(var(--accent-rgb), 0.02);">
                    
                    <div class="dp-manager-row" style="background: rgba(var(--accent-rgb), 0.1); border-bottom: 1px solid var(--accent); padding: 8px 12px;">
                        <div style="display:flex; align-items:center; width:45px; opacity: 0.4;">
                            <span class="drag-handle">⠿</span>
                            <span class="tiny muted" style="margin-left:8px;">${idx + 1}</span>
                        </div>
                        
                        <div style="flex:1; display:flex; align-items:center; gap:10px; cursor: pointer;" 
                            onclick="OL.openResourceModal('${step.linkedResourceId}')">
                            <span style="font-size: 14px;">📦</span>
                            <strong style="color: var(--accent); font-size: 0.9em;">MODULE: ${esc(step.name)}</strong>
                            <span class="pill tiny soft" style="font-size: 9px; opacity: 0.7;">VIEW ONLY</span>
                        </div>

                        <button class="card-delete-btn" style="position:static; margin-left: 15px;" 
                                onclick="event.stopPropagation(); OL.removeSopStep('${res.id}', '${step.id}')">×</button>
                    </div>

                    <div class="module-nested-steps" style="padding: 12px 12px 12px 55px; display: flex; flex-direction: column; gap: 8px; opacity: 0.6; pointer-events: none;">
                        ${nestedSteps.map((ns, nidx) => {
                            const nsApp = allApps.find(a => String(a.id) === String(ns.appId));
                            const nsAssigneeIcon = ns.assigneeType === 'role' ? '🎭' : ns.assigneeType === 'system' ? '📱' : '👨‍💼';
                            
                            return `
                                <div style="display:flex; align-items:center; gap:10px; font-size: 11px;">
                                    <span class="muted" style="width: 15px;">${nidx + 1}.</span>
                                    <span style="flex:1; color: var(--text-dim);">${esc(ns.name)}</span>
                                    
                                    <div style="display:flex; gap:4px; align-items:center; opacity: 0.5; transform: scale(0.85);">
                                        ${ns.assigneeName ? `<span class="pill tiny soft" title="${esc(ns.assigneeName)}">${nsAssigneeIcon}</span>` : ''}
                                        ${nsApp ? `<span class="pill tiny accent" title="${esc(nsApp.name)}">📱</span>` : ''}
                                    </div>
                                </div>
                            `;
                        }).join('')}
                        ${nestedSteps.length === 0 ? '<div class="tiny muted italic">No steps in this module.</div>' : ''}
                    </div>
                </div>`;
        }

        // --- 📝 BRANCH 2: STANDARD STEP ---
        let stepRowHtml = `
            <div class="dp-manager-row ${isLocked ? 'is-locked-module' : 'is-clickable'}" 
                style="gap:10px; margin-bottom:2px; align-items: center; 
                      ${isEditing ? 'border-bottom:none; background:rgba(var(--accent-rgb), 0.05);' : ''}" 
                onclick="${isLocked ? '' : `OL.toggleStepOutcomes(event, '${res.id}', '${step.id}')`}">
                
                <div style="display:flex; align-items:center; width:55px; justify-content:space-between; padding-left:5px;">
                    <span class="drag-handle" style="cursor:${isLocked ? 'default' : 'grab'}; opacity:${isLocked ? '0' : '0.3'}; font-size:12px;">⠿</span>
                    <span class="tiny muted" style="font-size:10px;">${idx + 1}</span>
                    ${toggleBtn}
                </div>
                
                <div style="flex:1; display:flex; align-items:center; gap:12px;">
                    <input type="text" class="ghost-input bold" style="flex:1; font-size:0.9em;" 
                          value="${esc(step.name)}" placeholder="Enter Step Name..."
                          onclick="event.stopPropagation()"
                          onblur="OL.updateAtomicStep('${res.id}', '${step.id}', 'name', this.value)">
                    
                    <div style="display:flex; gap:6px; align-items:center;">
                        ${assigneeDisplay}
                        ${appDisplay}
                        ${dateDisplay}
                    </div>
                </div>

                <button class="card-delete-btn" style="position:static" onclick="event.stopPropagation(); OL.removeSopStep('${res.id}', '${step.id}')">×</button>
            </div>`;

        // --- EXPANDED EDIT PANEL ---
        let editPanelHtml = isEditing || state.isPrinting === true? `
            <div style="margin-left:45px; margin-bottom:15px; padding:15px; background:rgba(255,255,255,0.02); border:1px solid var(--line); border-top:none; border-radius:0 0 8px 8px; display:flex; flex-direction:column; gap:20px;">
                
                <div style="display:flex; flex-direction:column; gap:5px;">
                    <label class="modal-section-label" style="font-size:9px; color:var(--accent);">📝 DESCRIPTION / NOTES</label>
                    <textarea class="modal-input tiny" style="min-height:50px; background:rgba(0,0,0,0.1);" 
                              placeholder="Additional notes or context..."
                              onblur="OL.updateAtomicStep('${res.id}', '${step.id}', 'description', this.value)">${esc(step.description || '')}</textarea>
                </div>

                <div style="display:flex; flex-direction:column; gap:5px;">
                    <label class="modal-section-label" style="font-size:9px; color:var(--accent);">🔗 LINKED RESOURCES & GUIDES</label>
                    <div id="step-resources-list-${step.id}">
                        ${renderStepResources(res.id, step)}
                    </div>
                    <div class="search-map-container" style="position:relative; margin-top:5px;">
                        <input type="text" class="modal-input tiny" 
                              placeholder="+ Link a Guide or SOP..." 
                              onfocus="OL.filterResourceSearch('${res.id}', '${step.id}', this.value)"
                              oninput="OL.filterResourceSearch('${res.id}', '${step.id}', this.value)">
                        <div id="resource-results-${step.id}" class="search-results-overlay" style="position:absolute; top:100%; left:0; width:100%; z-index:100;"></div>
                    </div>
                </div>

                <div style="display:flex; flex-direction:column; gap:5px;">
                    <label class="modal-section-label" style="font-size:9px; color:var(--accent);">🎯 BRANCHING LOGIC</label>
                    <div id="step-outcomes-list">${renderStepOutcomes(res.id, step)}</div>
                    <div class="search-map-container" style="margin-top:5px;">
                        <input type="text" class="modal-input tiny outcome-search-input" placeholder="+ Add outcome..." 
                              onfocus="OL.filterOutcomeSearch('${res.id}', '${step.id}', '')">
                        <div id="outcome-results" class="search-results-overlay"></div>
                    </div>
                </div>

            </div>
        ` : '';

        let outcomesHtml = (isExpanded && hasOutcomes && !isEditing) ? outcomes.map(oc => `
            <div class="dp-manager-row" 
                style="margin-left: 55px; margin-bottom: 2px; padding: 4px 10px; ...">
                <span style="font-size: 10px; color: var(--accent); font-weight: bold;">↳</span>
                <div style="flex: 1; display: flex; align-items: center; gap: 6px; font-size: 10px;">
                    <span class="bold accent" style="text-transform: uppercase; font-size: 8px;">${esc(oc.condition || 'IF...')}</span>
                    <span class="muted" style="font-size: 10px;">${esc(oc.label || 'Next Step')}</span>
                </div>
            </div>
        `).join("") : "";

        // 🚀 WRAP EVERYTHING IN A DRAGGABLE GROUP
        return `
            <div class="step-group" draggable="true" 
                ondragstart="OL.handleStepDragStart(event, ${idx})"
                ondragover="OL.handleDragOver(event)"
                ondrop="OL.handleStepDrop(event, ${idx}, '${res.id}')">
                ${stepRowHtml}
                ${editPanelHtml}
                ${outcomesHtml}
            </div>
        `;
    }).join("");

    return html;
};

// Toggle Controller
OL.toggleInlineEdit = function(event, resId, stepId) {
    if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') return;
    if (event) event.stopPropagation();

    const res = OL.getResourceById(resId);
    
    // Accordion Logic: If clicking a new step, collapse others. 
    // If clicking the current step, close it.
    if (state.editingStepId === stepId) {
        state.editingStepId = null;
        state.expandedSteps.delete(stepId);
    } else {
        state.editingStepId = stepId;
        state.expandedSteps.clear(); // 🚀 THE FIX: Clear all other expanded states
        state.expandedSteps.add(stepId);
    }
    
    document.getElementById('sop-step-list').innerHTML = renderSopStepList(res);
};

OL.openStepDetailModal = function(resId, stepId) {
    const res = OL.getResourceById(resId);
    const step = res?.steps?.find(s => String(s.id) === String(stepId));
    if (!step) return;

    const client = getActiveClient();
    const allApps = [...(state.master.apps || []), ...(client?.projectData?.localApps || [])];
    const linkedApp = allApps.find(a => String(a.id) === String(step.appId));

    // 🚀 THE FIX: Check if modal is already open to prevent "flicker"
    const modalLayer = document.getElementById("modal-layer");
    const isModalVisible = modalLayer && modalLayer.style.display === "flex";
    const existingBody = document.querySelector('.modal-body');

    const innerHtml = `
        <div class="card-section">
            <label class="modal-section-label">📱 Required App</label>
            <div class="search-map-container" style="position:relative;">
                <input type="text" class="modal-input" 
                        placeholder="${linkedApp ? '📱 ' + esc(linkedApp.name) : 'Search Apps...'}" 
                        onfocus="OL.filterStepAppSearch('${resId}', '${stepId}', '')"
                        oninput="OL.filterStepAppSearch('${resId}', '${stepId}', this.value)">
                ${linkedApp ? `
                    <button onclick="OL.updateAtomicStep('${resId}', '${stepId}', 'appId', ''); OL.openStepDetailModal('${resId}', '${stepId}')" 
                            style="position:absolute; right:10px; top:50%; transform:translateY(-50%); background:none; border:none; color:var(--text-dim); cursor:pointer; font-size:18px;">
                        ×
                    </button>
                ` : ''}
                <div id="step-app-results" class="search-results-overlay"></div>
            </div>
        </div>
        
        <div class="card-section" style="margin-top:20px;">
            <label class="modal-section-label">👨‍💼 Responsibility Assignment</label>
            <div style="display:flex; align-items:center; gap:10px; margin-bottom:10px;">
                ${step.assigneeName ? `
                    <div class="pill accent" style="display:flex; align-items:center; gap:8px;">
                        ${step.assigneeType === 'person' ? '👨‍💼' : step.assigneeType === 'role' ? '🎭' : '📱'}
                        ${esc(step.assigneeName)}
                        <b class="pill-remove-x" onclick="OL.executeAssignment('${resId}', '${stepId}', false, '', '', '')">×</b>
                    </div>
                ` : '<span class="tiny muted">No one assigned yet</span>'}
            </div>
            <div class="search-map-container">
                <input type="text" class="modal-input tiny" 
                      placeholder="Assign to Person, Role, or App..." 
                      onfocus="OL.filterAssignmentSearch('${resId}', '${stepId}', false, '')"
                      oninput="OL.filterAssignmentSearch('${resId}', '${stepId}', false, this.value)">
                <div id="assignment-search-results" class="search-results-overlay"></div>
            </div>
        </div>

        <div class="card-section" style="margin-top:20px;">
            <label class="modal-section-label">📅 Relational Scheduling</label>
            <div style="display:flex; gap:10px; align-items:center;">
                <input type="number" class="modal-input tiny" style="width:60px;" placeholder="0"
                       value="${num(step.timingValue)}" onblur="OL.updateAtomicStep('${resId}', '${step.id}', 'timingValue', this.value)">
                <select class="modal-input tiny" onchange="OL.updateAtomicStep('${resId}', '${step.id}', 'timingType', this.value)">
                    <option value="after_prev" ${step.timingType === 'after_prev' ? 'selected' : ''}>Days after Previous Step</option>
                    <option value="after_start" ${step.timingType === 'after_start' ? 'selected' : ''}>Days after Workflow Start</option>
                    <option value="before_end" ${step.timingType === 'before_end' ? 'selected' : ''}>Days before Workflow End</option>
                    <optgroup label="Specific Step Logic">
                        ${(res.steps || []).filter(s => String(s.id) !== String(stepId)).map(s => `
                            <option value="after_${s.id}" ${step.timingType === 'after_'+s.id ? 'selected' : ''}>After: ${esc(val(s.name, 'Unnamed Step'))}</option>
                        `).join('')}
                    </optgroup>
                </select>
            </div>
        </div>

        <div style="display:flex; flex-direction:column; gap:5px;">
            <label class="modal-section-label" style="font-size:9px; color:var(--accent);">🔗 LINKED RESOURCES & GUIDES</label>
            <div id="step-resources-list-${step.id}">
                ${renderStepResources(res.id, step)}
            </div>
            <div class="search-map-container" style="position:relative; margin-top:5px;">
                <input type="text" class="modal-input tiny" 
                      placeholder="+ Link a Guide or SOP..." 
                      onfocus="OL.filterResourceSearch('${res.id}', '${step.id}', this.value)"
                      oninput="OL.filterResourceSearch('${res.id}', '${step.id}', this.value)">
                <div id="resource-results-${step.id}" class="search-results-overlay" style="position:absolute; top:100%; left:0; width:100%; z-index:100;"></div>
            </div>
        </div>

        <div class="card-section" style="margin-top: 20px;">
            <label class="modal-section-label">🎯 Conditional Branching (Logic)</label>
            <div id="step-outcomes-list" style="margin-bottom: 10px;">
                ${renderStepOutcomes(resId, step)}
            </div>
            <div class="search-map-container">
                <input type="text" class="modal-input tiny outcome-search-input" 
                      placeholder="+ Add new branch..." 
                      onfocus="OL.filterOutcomeSearch('${resId}', '${stepId}', '')"
                      oninput="OL.filterOutcomeSearch('${resId}', '${stepId}', this.value)">
                <div id="outcome-results" class="search-results-overlay"></div>
            </div>
        </div>
    `;

    // 🚀 THE LOGIC: If open, just update the body. If closed, do the full animation.
    if (isModalVisible && existingBody) {
        existingBody.innerHTML = innerHtml;
        // Also update the header input name if it changed
        const headerInput = document.querySelector('.header-editable-input');
        if (headerInput && headerInput.value !== step.name) headerInput.value = step.name;
    } else {
        const fullHtml = `
            <div class="modal-head" style="gap:15px;">
                <div style="display:flex; align-items:center; gap:10px; flex:1;">
                    <span style="font-size:18px;">⚙️</span>
                    <input type="text" class="header-editable-input" 
                    value="${esc(val(res.name))}" 
                    placeholder="Resource Name..."
                    style="background:transparent; border:none; color:inherit; font-size:18px; font-weight:bold; width:100%; outline:none;"
                    onblur="OL.handleModalSave('${res.id}', this.value)">
                </div>
                <button class="btn small soft" onclick="OL.openResourceModal('${resId}')">Back to Resource</button>
            </div>
            <div class="modal-body">
                ${innerHtml}
            </div>
        `;
        window.openModal(fullHtml);
    }
};

// 1. ADD NEW STEP TO RESOURCE
OL.addSopStep = function(resId) {
    const res = OL.getResourceById(resId);
    const newId = uid(); 
    
    if (!res.steps) res.steps = [];
    res.steps.push({ id: newId, name: "", outcomes: [], description: "" });
    
    // Set the new step as the one being edited
    state.editingStepId = newId;
    OL.persist();

    // 🚀 THE FULLSCREEN FIX:
    const fsOverlay = document.getElementById('workflow-fs-overlay');
    if (fsOverlay) {
        // If fullscreen is active, use switchFSMode to force a total redraw of the canvas
        const isVisualMode = document.getElementById('mode-visual')?.classList.contains('active');
        OL.switchFSMode(isVisualMode ? 'visual' : 'editor', resId);
    } else {
        // Standard Modal Refresh Logic
        const listEl = document.getElementById('sop-step-list');
        if (listEl) listEl.innerHTML = renderSopStepList(res);
    }
    
    // Auto-focus the new input (delay slightly to allow DOM redraw)
    setTimeout(() => {
        const inputs = document.querySelectorAll('.ghost-input, .vis-input-ghost');
        if (inputs.length > 0) inputs[inputs.length - 1].focus();
    }, 150);
};

// HANDLE WOKRFLOW VISUALIZER / FULL SCREEN MODE
// Global Workspace Logic
OL.launchDirectToVisual = function(resId) {
    // 1. Trigger the standard fullscreen opening logic
    OL.toggleWorkflowFullscreen(resId);
    
    // 2. Immediately switch the mode to visual
    // We wrap this in a tiny timeout to ensure the DOM elements 
    // from toggleWorkflowFullscreen are painted first
    setTimeout(() => {
        OL.switchFSMode('visual', resId);
    }, 10);
};

OL.toggleWorkflowFullscreen = function(resId) {
    const res = OL.getResourceById(resId);
    if (!res) {
        console.error("Resource not found for ID:", resId);
        return;
    }

    let fsOverlay = document.getElementById('workflow-fs-overlay');

    if (!fsOverlay) {
        // 🚀 THE FIX: Close the standard modal first so it doesn't block the view
        OL.closeModal();

        // Remove any potentially broken ghost overlays
        const oldOverlays = document.querySelectorAll('#workflow-fs-overlay');
        oldOverlays.forEach(el => el.remove());

        // Create the Fullscreen Shell
        fsOverlay = document.createElement('div');
        fsOverlay.id = 'workflow-fs-overlay';
        fsOverlay.setAttribute('data-active-res-id', resId);
        fsOverlay.innerHTML = `
            <div class="fs-header">
                <div class="fs-title-zone">
                    <span style="font-size:20px; margin-right:10px;">🚀</span>
                    <h2 style="margin:0; font-size:16px; color:var(--accent);">${esc(res.name)}</h2>
                </div>
                <div class="fs-mode-toggle">
                    <button id="mode-editor" class="fs-mode-btn active" onclick="OL.switchFSMode('editor', '${resId}')">📝 List Editor</button>
                    <button id="mode-visual" class="fs-mode-btn" onclick="OL.switchFSMode('visual', '${resId}')">🎨 Visualizer</button>
                </div>
                <div class="fs-actions" style="display: flex; gap: 10px;">
                    <button class="btn small soft" onclick="OL.printSop('${resId}')">🖨️ Export PDF</button>
                    <button class="btn small soft" onclick="OL.toggleWorkflowFullscreen('${res.id}')">Close Workspace</button>
                </div>
            </div>
            <div id="fs-canvas" class="fs-body"></div>
        `;
        document.body.appendChild(fsOverlay);
        document.body.classList.add('fs-mode-active');
        
        OL.switchFSMode('editor', resId);
    } else {
        // Close Workspace logic
        fsOverlay.remove();
        document.body.classList.remove('fs-mode-active');
        // Return to the standard modal view for continuity
        OL.openResourceModal(resId);
    }
};

OL.switchFSMode = function(mode, resId) {
    const canvas = document.getElementById('fs-canvas');
    const res = OL.getResourceById(resId);
    if (!canvas || !res) return;
    
    // UI Button Sync
    document.querySelectorAll('.fs-mode-btn').forEach(b => b.classList.remove('active'));
    const activeBtn = document.getElementById(`mode-${mode}`);
    if (activeBtn) activeBtn.classList.add('active');

    if (mode === 'editor') {
        canvas.innerHTML = `
            <div class="fs-editor-wrap" style="padding: 40px 20px; overflow-y: auto; height: 100%;">
                <div style="max-width:900px; margin: 0 auto; background: var(--panel-bg); padding: 20px; border-radius: 12px; border: 1px solid var(--line);">
                    <div id="sop-step-list"> 
                        ${renderSopStepList(res)}
                    </div>
                    
                    <div style="margin-top: 30px; padding-top: 20px; border-top: 1px dashed var(--line); text-align: center;">
                        <button class="btn primary" onclick="OL.addSopStep('${resId}')" style="padding: 12px 30px;">
                            + Add Workflow Step
                        </button>
                    </div>
                </div>
            </div>
        `;
    } else {
        OL.renderVisualizer(resId);
    }
};

OL.printSop = function(resId) {
    const res = OL.getResourceById(resId);
    if (!res) return;

    // 1. Set global printing flag & backup state
    state.isPrinting = true;
    const originalExpanded = new Set(state.expandedSteps);
    const originalEditing = state.editingStepId;

    // 2. Force state to include all IDs for the renderer
    state.expandedSteps = new Set(res.steps.map(s => s.id));
    state.editingStepId = null;

    // 3. Force RE-RENDER
    const listContainer = document.getElementById('sop-step-list');
    if (listContainer) {
        listContainer.innerHTML = renderSopStepList(res);
    }

    // 4. Trigger Print after browser paints the expanded DOM
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            setTimeout(() => {
                window.print();

                // 5. CLEANUP: Reset flag and restore UI
                state.isPrinting = false;
                state.expandedSteps = originalExpanded;
                state.editingStepId = originalEditing;
                if (listContainer) {
                    listContainer.innerHTML = renderSopStepList(res);
                }
            }, 600); 
        });
    });
};

OL.renderVisualizer = function(resId) {
    const canvas = document.getElementById('fs-canvas');
    
    // 1. Resolve Data FIRST to prevent ReferenceErrors
    const res = OL.getResourceById(resId);
    if (!canvas || !res) return;

    if (!(state.expandedVisualNodes instanceof Set)) {
        state.expandedVisualNodes = new Set();
    }

    // 2. Initialize default lanes if missing
    if (!res.lanes || res.lanes.length === 0) {
        res.lanes = [
            { id: 'lane1', title: 'Sales', width: 450 },
            { id: 'lane2', title: 'Operations', width: 450 },
            { id: 'lane3', title: 'Finance', width: 450 }
        ];
    }

    const triggers = res.triggers || [];
    const steps = res.steps || [];

    // 3. Generate Background Lanes
    const lanesHtml = res.lanes.map(lane => `
        <div class="vis-lane" style="width: ${lane.width}px;">
            <div class="vis-lane-header" contenteditable="true" 
                 onblur="OL.updateLaneTitle('${resId}', '${lane.id}', this.innerText)">
                ${esc(lane.title)}
            </div>
        </div>
    `).join('');
    
    // Position triggers at the top of the absolute plane
    const triggersHtml = triggers.map((trigger, idx) => `
        <div class="vis-node trigger-node" style="left: ${50 + (idx * 280)}px; top: 80px; position: absolute;">
            <div class="vis-node-header trigger-header">
                <span class="vis-idx">🏁</span>
                <textarea class="vis-input-ghost bold" rows="1"
                    oninput="OL.autoGrowNode(this, '${resId}')"
                    onblur="OL.updateTriggerName('${resId}', ${idx}, this.value)"
                >${esc(trigger.name || '')}</textarea>
            </div>
            <div class="vis-node-body tiny muted uppercase" style="padding:10px;">Entry Point</div>
        </div>
    `).join('');

    const nodesHtml = steps.map((step, idx) => {
        const isExpanded = state.expandedVisualNodes.has(step.id);
        const client = getActiveClient();
        const allApps = [...(state.master.apps || []), ...(client?.projectData?.localApps || [])];
        const linkedApp = allApps.find(a => String(a.id) === String(step.appId));
        const assigneeIcon = step.assigneeType === 'role' ? '🎭' : step.assigneeType === 'system' ? '📱' : '👨‍💼';
        
        let timingLabel = "";
        if (step.timingType) {
            const ref = step.timingType === 'after_prev' ? 'Prev' : 'Start';
            timingLabel = `T+${step.timingValue || 0}d (${ref})`;
        }

        // 🚀 POSITION LOGIC: Use saved coords or staggered vertical default
        const pos = step.position || { x: 100, y: (idx * 200) + 250 };

        return `
        <div class="vis-node" id="vis-node-${step.id}" 
            style="left: ${pos.x}px; top: ${pos.y}px; position: absolute;"
            onmousedown="OL.startCardMove(event, '${resId}', '${step.id}')">

            <div class="vis-node-header">
                <span class="vis-drag-handle">⠿</span>
                <span class="vis-idx">${idx + 1}</span>
                <textarea class="vis-input-ghost bold" rows="1"
                    onfocus="this.style.height='auto'; this.style.height=this.scrollHeight+'px';"
                    oninput="OL.autoGrowNode(this, '${resId}')"
                    onblur="OL.updateStepFromWorkspace('${resId}', '${step.id}', 'name', this.value)"
                >${esc(step.name || '')}</textarea>
                
                <div class="vis-header-actions">
                    <button class="vis-icon-btn edit" onclick="event.stopPropagation(); OL.openStepConfigFromVis('${resId}', '${step.id}')">⚙️</button>
                    <button class="vis-icon-btn delete" onclick="event.stopPropagation(); OL.removeStepFromVisualizer('${resId}', '${step.id}')">×</button>
                </div>
            </div>

            <div class="vis-node-body">
                <div class="vis-card-meta">
                    ${step.assigneeName ? `<div class="vis-meta-pill">${assigneeIcon} ${esc(step.assigneeName)}</div>` : ''}
                    ${linkedApp ? `<div class="vis-meta-pill">📱 ${esc(linkedApp.name)}</div>` : ''}
                    ${timingLabel ? `<div class="vis-meta-pill">📅 ${timingLabel}</div>` : ''}
                </div>

                <div class="vis-detail-toggle" onclick="event.stopPropagation(); OL.toggleVisNodeDetails('${step.id}', '${resId}')">
                    ${isExpanded ? 'Collapse Procedures ▴' : 'View Procedures ▾'}
                </div>

                ${isExpanded ? `
                    <div class="vis-expanded-editor">
                        <div class="vis-detail-block">
                            <label class="vis-section-label">Procedure Summary</label>
                            <div class="vis-read-only-text">${esc(step.description || 'No notes.')}</div>
                        </div>
                    </div>
                ` : ''}

                <div class="vis-outcomes-area">
                    ${(step.outcomes || []).map((oc, oIdx) => `
                        <div class="vis-port" id="port-${step.id}-${oIdx}">
                            <div class="vis-outcome-chip">
                                <span class="tiny-label">IF</span> ${esc(oc.condition || '...')}
                            </div>
                            <div class="vis-arrow"> ${esc(oc.label || 'Next')}</div>
                        </div>
                    `).join('')}
                </div>
                <button class="btn-vis-add" onclick="event.stopPropagation(); OL.addSopStep('${resId}')">+</button>
            </div>
        </div>
        `;
    }).join('');

    // 4. Assemble the Canvas with Dynamic Scrolling width
    // 🚀 CALCULATE DYNAMIC SIZE
    const totalLaneWidth = res.lanes.reduce((sum, l) => sum + (l.width || 450), 0);
    
    // Find the step with the highest Y position to determine canvas height
    const maxY = res.steps.reduce((max, s) => Math.max(max, (s.position?.y || 0)), 0);
    const maxStepX = res.steps.reduce((max, s) => Math.max(max, (s.position?.x || 0) + 300), 0);
    const canvasHeight = Math.max(3000, maxY + 1000); // Content + 1000px buffer
    const dynamicWidth = Math.max(3000, totalLaneWidth, maxStepX + 500);

    canvas.innerHTML = `
        <div class="vis-workspace" id="vis-workspace" 
             style="width: ${dynamicWidth}px; height: ${canvasHeight}px;">
            <div class="vis-swimlane-layer">${lanesHtml}</div>
            
            <div class="vis-trigger-row" style="position: absolute; top: 100px; left: 50px; display: flex; gap: 40px; z-index: 100;">
                ${triggersHtml}
            </div>
            
            <div class="vis-absolute-container">
                ${nodesHtml}
            </div>

            <svg id="vis-links-layer" class="vis-svg"></svg>
        </div>
    `;

    // 5. Finalize UI
    setTimeout(() => {
        document.querySelectorAll('.vis-input-ghost').forEach(el => {
            el.style.height = '0px'; 
            el.style.height = el.scrollHeight + 'px';
        });
        OL.drawVisualizerLines(resId);
    }, 150);
};

OL.autoGrowNode = function(element, resId) {
    element.style.height = '1px';
    element.style.height = element.scrollHeight + 'px';
    
    // 🚀 REDRAW: Ensure lines stay attached while typing
    OL.drawVisualizerLines(resId);
};

OL.toggleVisNodeDetails = function(stepId, resId) {
    // Safety check for Set
    if (!(state.expandedVisualNodes instanceof Set)) {
        state.expandedVisualNodes = new Set();
    }

    if (state.expandedVisualNodes.has(stepId)) {
        state.expandedVisualNodes.delete(stepId);
    } else {
        state.expandedVisualNodes.add(stepId);
    }

    // 🚀 Redraw the visualizer to reflect the expanded/collapsed state
    OL.renderVisualizer(resId);
};

OL.openStepConfigFromVis = function(resId, stepId) {
    console.log("🛠️ Switching from Visualizer to Full Config...");
    
    const modalLayer = document.getElementById('modal-layer');
    if (modalLayer) {
        modalLayer.style.display = 'flex';
        // Redundant safety check to ensure it beats the FS Overlay
        modalLayer.style.zIndex = '10001'; 
    }

    // Call the standard modal system
    OL.openStepDetailModal(resId, stepId);
};

OL.updateLaneTitle = function(resId, laneId, newTitle) {
    const res = OL.getResourceById(resId);
    const lane = res.lanes.find(l => l.id === laneId);
    if (lane) {
        lane.title = newTitle.trim();
        OL.persist();
    }
};

// HANDLE CARD MOVEMENT ON CANVAS
OL.startCardMove = function(e, resId, stepId) {
    // Only drag if clicking the header or empty space, not buttons/inputs
    if (['INPUT', 'TEXTAREA', 'BUTTON'].includes(e.target.tagName)) return;
    
    e.preventDefault();
    const node = document.getElementById(`vis-node-${stepId}`);
    
    activeCardDrag = {
        resId,
        stepId,
        node,
        offsetX: e.clientX - node.offsetLeft,
        offsetY: e.clientY - node.offsetTop
    };

    document.addEventListener('mousemove', OL.handleCardMove);
    document.addEventListener('mouseup', OL.stopCardMove);
};

OL.handleCardMove = function(e) {
    if (!activeCardDrag) return;
    const { node, offsetX, offsetY, resId } = activeCardDrag;

    let newX = e.clientX - offsetX;
    let newY = e.clientY - offsetY;

    // Optional: 20px Grid Snap
    newX = Math.round(newX / 20) * 20;
    newY = Math.round(newY / 20) * 20;

    node.style.left = `${newX}px`;
    node.style.top = `${newY}px`;

    // 🚀 REDRAW: Pass resId to the engine
    OL.drawVisualizerLines(resId);
};

OL.stopCardMove = function() {
    if (activeCardDrag) {
        const { resId, stepId, node } = activeCardDrag;
        const res = OL.getResourceById(resId);
        const step = res.steps.find(s => s.id === stepId);
        
        // Save final coordinates to state
        if (!step.position) step.position = {};
        step.position.x = parseInt(node.style.left);
        step.position.y = parseInt(node.style.top);

        OL.persist(); // Sync to Firebase
    }
    
    activeCardDrag = null;
    document.removeEventListener('mousemove', OL.handleCardMove);
    document.removeEventListener('mouseup', OL.stopCardMove);
};

// HANDLE VISUALIZER LINES
// Add this to your initialization or global scope
document.addEventListener('mousedown', (e) => {
    const handle = e.target.closest('.path-handle');
    if (!handle) return;

    // 🚀 THE MAGIC: Kill the card drag before it starts
    e.preventDefault();
    e.stopPropagation();

    // Identify handle data from attributes we'll add in the next step
    const type = handle.getAttribute('data-type');
    const resId = handle.getAttribute('data-res-id');
    const stepId = handle.getAttribute('data-step-id');
    const oIdx = parseInt(handle.getAttribute('data-oidx'));

    // Temporarily disable draggability of all nodes so they stay frozen
    document.querySelectorAll('.vis-node').forEach(n => n.setAttribute('draggable', 'false'));

    OL.activeLinkDrag = { type, resId, stepId, oIdx };
    
    document.addEventListener('mousemove', OL.handleLinkMove);
    document.addEventListener('mouseup', OL.stopLinkMove);
    
    console.log(`🎯 Locked ${type} handle - Card movement suppressed`);
}, true); // <--- 'true' enables the Capture Phase

OL.drawVisualizerLines = function(resIdOrObj) {
    const svg = document.getElementById('vis-links-layer');
    if (!svg) return;
    
    // Resolve 'res' context: handle both string IDs and direct objects
    let res = (typeof resIdOrObj === 'string') 
        ? OL.getResourceById(resIdOrObj) 
        : resIdOrObj;

    // Safety guard to prevent ReferenceErrors
    if (!res || !res.steps) {
        console.warn("Drawing aborted: Resource data is missing or invalid.");
        return;
    }

    // 1. Clear previous SVG content to avoid 'ghost' lines
    svg.innerHTML = ''; 

    const workspace = document.getElementById('vis-workspace');
    if (!workspace) return;
    const cRect = workspace.getBoundingClientRect();

    // 2. Draw Step Outcomes (Sequential and Jump logic)
    res.steps.forEach((step, sIdx) => {
        (step.outcomes || []).forEach((oc, oIdx) => {
            const sourceEl = document.getElementById(`vis-node-${step.id}`);
            
            // Resolve Target ID for "Next" or "Jump"
            let targetId = null;
            if (oc.action === 'next') {
                targetId = res.steps[sIdx + 1]?.id;
            } else if (oc.action?.startsWith('jump_')) {
                targetId = oc.action.replace('jump_', '');
            }

            const targetEl = document.getElementById(`vis-node-${targetId}`);
            
            if (sourceEl && targetEl) {
                const s = sourceEl.getBoundingClientRect();
                const t = targetEl.getBoundingClientRect();

                // Calculate relative anchor points (Base Ports)
                const baseStartX = s.right - cRect.left;
                const baseStartY = s.top + (s.height / 2) - cRect.top;
                const baseEndX = t.left - cRect.left;
                const baseEndY = t.top + (t.height / 2) - cRect.top;

                // Ensure manual offset objects exist in the data
                if (!oc.startOffset) oc.startOffset = { x: 0, y: 0 };
                if (!oc.midOffset) oc.midOffset = { x: 0, y: 0 };
                if (!oc.endOffset) oc.endOffset = { x: 0, y: 0 };

                // Apply manual offsets from user dragging
                const x1 = baseStartX + (oc.startOffset?.x || 0);
                const y1 = baseStartY + (oc.startOffset?.y || 0);
                const x2 = baseEndX + (oc.endOffset?.x || 0);
                const y2 = baseEndY + (oc.endOffset?.y || 0);

                // Quadratic Bezier Calculation (The "Bend")
                const naturalMidX = (x1 + x2) / 2;
                const naturalMidY = (y1 + y2) / 2;
                const cx = naturalMidX + (oc.midOffset?.x || 0);
                const cy = naturalMidY + (oc.midOffset?.y || 0);

                const d = `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`;
                
                const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
                path.setAttribute("d", d);
                path.setAttribute("class", "vis-path editable-path");
                path.setAttribute("marker-end", "url(#arrowhead)");
                svg.appendChild(path);

                // Create the 3 interactive handles (Green Start, Blue Mid, Red End)
                OL.createHandle(svg, x1, y1, 'start', res.id, step.id, oIdx);
                OL.createHandle(svg, cx, cy, 'mid', res.id, step.id, oIdx);
                OL.createHandle(svg, x2, y2, 'end', res.id, step.id, oIdx);
            }
        });
    });

    // 3. Inject Arrowhead markers
    svg.innerHTML += `
        <defs>
            <marker id="arrowhead" viewBox="0 0 10 10" refX="8" refY="5" 
                    markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--accent)" />
            </marker>
        </defs>
    `;
};

OL.createHandle = function(svg, x, y, type, resId, stepId, oIdx) {
    const handle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    handle.setAttribute("cx", x);
    handle.setAttribute("cy", y);
    handle.setAttribute("r", "8"); // Slightly larger for mobile/ease
    handle.setAttribute("class", `path-handle handle-${type}`);
    
    // Store metadata for the capture listener
    handle.setAttribute('data-type', type);
    handle.setAttribute('data-res-id', resId);
    handle.setAttribute('data-step-id', stepId);
    handle.setAttribute('data-oidx', oIdx);
    
    svg.appendChild(handle);
};

OL.activeLinkDrag = null;

OL.handleLinkMove = function(e) {
    if (!OL.activeLinkDrag) return;
    const { type, resId, stepId, oIdx } = OL.activeLinkDrag;
    const res = OL.getResourceById(resId);
    const step = res.steps.find(s => s.id === stepId);
    const oc = step.outcomes[oIdx];
    
    // Initialize offsets
    if (!oc.startOffset) oc.startOffset = { x: 0, y: 0 };
    if (!oc.midOffset) oc.midOffset = { x: 0, y: 0 };
    if (!oc.endOffset) oc.endOffset = { x: 0, y: 0 };

    const workspace = document.getElementById('vis-workspace');
    const cRect = workspace.getBoundingClientRect();
    const mouseX = e.clientX - cRect.left;
    const mouseY = e.clientY - cRect.top;

    // Resolve target node for 'end' handles
    let targetNodeId = stepId; 
    if (type === 'end') {
        const curIdx = res.steps.findIndex(s => s.id === stepId);
        targetNodeId = oc.action === 'next' ? res.steps[curIdx + 1]?.id : oc.action.replace('jump_', '');
    }

    const nodeEl = document.getElementById(`vis-node-${targetNodeId}`);
    if (!nodeEl) return;

    const n = nodeEl.getBoundingClientRect();
    const snapPadding = 40; // Increased padding for better 'catch'

    // 1. Define the 4 Snap Points (Relative to Workspace)
    const ports = {
        right:  { x: n.right - cRect.left,              y: n.top + n.height / 2 - cRect.top },
        left:   { x: n.left - cRect.left,               y: n.top + n.height / 2 - cRect.top },
        top:    { x: n.left + n.width / 2 - cRect.left, y: n.top - cRect.top },
        bottom: { x: n.left + n.width / 2 - cRect.left, y: n.bottom - cRect.top }
    };

    // 2. Identify Base Port (where offset is 0,0)
    // Start handles default to 'right', End handles default to 'left'
    const basePort = type === 'start' ? ports.right : ports.left;

    if (type === 'start' || type === 'end') {
        const offset = (type === 'start') ? oc.startOffset : oc.endOffset;
        
        // 3. Find the closest port to the current mouse position
        let closestPort = null;
        let minDistance = snapPadding;

        Object.keys(ports).forEach(key => {
            const dist = Math.hypot(mouseX - ports[key].x, mouseY - ports[key].y);
            if (dist < minDistance) {
                minDistance = dist;
                closestPort = ports[key];
            }
        });

        // 4. Snap or Free Move
        if (closestPort) {
            // SNAP: Set offset to exactly reach the port from the base
            offset.x = closestPort.x - basePort.x;
            offset.y = closestPort.y - basePort.y;
        } else {
            // FREE MOVE: Standard mouse tracking
            offset.x = mouseX - basePort.x;
            offset.y = mouseY - basePort.y;
        }
    } else if (type === 'mid') {
        oc.midOffset.x += e.movementX;
        oc.midOffset.y += e.movementY;
        if (Math.abs(oc.midOffset.x) < 15) oc.midOffset.x = 0;
        if (Math.abs(oc.midOffset.y) < 15) oc.midOffset.y = 0;
    }

    OL.drawVisualizerLines(res);
};

OL.stopLinkMove = function() {
    if (OL.activeLinkDrag) {
        OL.persist();
        // 🚀 RESTORE: Turn card dragging back on
        document.querySelectorAll('.vis-node').forEach(n => n.setAttribute('draggable', 'true'));
    }
    
    OL.activeLinkDrag = null;
    document.removeEventListener('mousemove', OL.handleLinkMove);
    document.removeEventListener('mouseup', OL.stopLinkMove);
};

// Helper to keep code clean
OL.createBezierPath = function(svg, x1, y1, x2, y2, className) {
    // If it's a trigger (vertical flow), use a vertical curve
    // If it's a step outcome (side-to-side), use a horizontal curve
    const isVertical = className === 'trigger-path';
    
    let d;
    if (isVertical) {
        const cp = y1 + (y2 - y1) / 2;
        d = `M ${x1} ${y1} C ${x1} ${cp}, ${x2} ${cp}, ${x2} ${y2}`;
    } else {
        const cp = x1 + (x2 - x1) / 2;
        d = `M ${x1} ${y1} C ${cp} ${y1}, ${cp} ${y2}, ${x2} ${y2}`;
    }

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    path.setAttribute("class", className);
    path.setAttribute("marker-end", "url(#arrowhead)");
    svg.appendChild(path);
};

let activePathDrag = null;

OL.startPathDrag = function(e, resId, stepId, outcomeIdx) {
    e.stopPropagation();
    e.preventDefault();
    
    activePathDrag = { resId, stepId, outcomeIdx };
    
    document.addEventListener('mousemove', OL.handlePathDrag);
    document.addEventListener('mouseup', OL.stopPathDrag);
};

OL.handlePathDrag = function(e) {
    if (!activePathDrag) return;
    
    const { resId, stepId, outcomeIdx } = activePathDrag;
    const res = OL.getResourceById(resId);
    const step = res.steps.find(s => s.id === stepId);
    const oc = step.outcomes[outcomeIdx];
    
    const workspace = document.getElementById('vis-workspace');
    const cRect = workspace.getBoundingClientRect();
    
    // Identify natural mid-point to calculate relative offset
    const sourcePort = document.getElementById(`port-${stepId}-${outcomeIdx}`).getBoundingClientRect();
    // Simplified target lookup for math
    const targetNode = document.querySelector('.vis-node:not(.is-dragging)'); 
    
    const x1 = sourcePort.right - cRect.left;
    const y1 = (sourcePort.top + sourcePort.height / 2) - cRect.top;
    // Note: In real use, you'd find the specific target node coordinates here
    
    // Update data relative to mouse
    if (!oc.offset) oc.offset = { x: 0, y: 0 };
    
    const mouseX = e.clientX - cRect.left;
    const mouseY = e.clientY - cRect.top;
    
    // We calculate offset from the straight-line midpoint
    // This is a simplified version; you can refine the midX calculation
    oc.offset.x = mouseX - x1; 
    oc.offset.y = mouseY - y1;

    // Real-time redraw
    OL.drawVisualizerLines(res);
};

OL.stopPathDrag = function() {
    if (activePathDrag) {
        OL.persist(); // Save the bend to Firebase
    }
    activePathDrag = null;
    document.removeEventListener('mousemove', OL.handlePathDrag);
    document.removeEventListener('mouseup', OL.stopPathDrag);
};

// Universal Step Updater
OL.updateStepFromWorkspace = function(resId, stepId, field, value) {
    const res = OL.getResourceById(resId);
    const step = res?.steps.find(s => String(s.id) === String(stepId));
    
    if (step) {
        step[field] = value.trim();
        OL.persist();
        
        // 🚀 SMART REFRESH: If we are in the Visualizer, redraw lines 
        // to reflect any logic changes immediately.
        if (document.getElementById('vis-links-layer')) {
            OL.drawVisualizerLines(res);
        }
    }
};

OL.removeStepFromVisualizer = function(resId, stepId) {
    if (!confirm("Are you sure you want to delete this step? This will also remove any branching logic pointing to it.")) return;

    const res = OL.getResourceById(resId);
    if (res && res.steps) {
        // 1. Remove the actual step
        res.steps = res.steps.filter(s => String(s.id) !== String(stepId));
        
        // 2. Clean up outcomes in other steps that might point to this deleted step
        res.steps.forEach(s => {
            if (s.outcomes) {
                s.outcomes.forEach(oc => {
                    if (oc.action === `jump_${stepId}`) {
                        oc.action = 'next'; // Reset to default "Next Step" logic
                        oc.label = 'Proceed to Next Step';
                    }
                });
            }
        });

        OL.persist();

        // 3. 🚀 Trigger a total redraw of the Visualizer
        OL.renderVisualizer(resId);
        
        console.log(`🗑️ Step ${stepId} removed via Visualizer.`);
    }
};

// HANDLE APP LINKING
OL.filterStepAppSearch = function(resId, stepId, query) {
    const listEl = document.getElementById("step-app-results");
    if (!listEl) return;

    const q = (query || "").toLowerCase().trim();
    const client = getActiveClient();
    
    // 1. Combine Master Apps and Local Project Apps
    const allApps = [
        ...(state.master.apps || []),
        ...(client?.projectData?.localApps || [])
    ];

    console.log("Searching through apps:", allApps.length); // Check console if this is 0

    // 2. Filter matches
    const matches = allApps.filter(a => a.name.toLowerCase().includes(q));

    // 3. Render
    if (matches.length > 0) {
        listEl.innerHTML = matches.map(app => `
            <div class="search-result-item" 
                 onmousedown="OL.updateAtomicStep('${resId}', '${stepId}', 'appId', '${app.id}'); OL.openStepDetailModal('${resId}', '${stepId}')">
                📱 ${esc(app.name)} 
                <span class="tiny muted">${app.id.startsWith('local') ? '(Local)' : '(Vault)'}</span>
            </div>
        `).join('');
    } else {
        listEl.innerHTML = `<div class="search-result-item muted">No apps found matching "${esc(q)}"</div>`;
    }
};

// HANDLE RESOURCE AND SOP LINKING
function renderStepResources(resId, step) {
    const links = step.links || [];
    if (links.length === 0) return '<div class="tiny muted" style="padding: 5px;">No linked resources.</div>';
    
    return links.map((link, idx) => {
        // Use the saved type to determine which icon to show on the pill
        const icon = link.type === 'guide' ? '📖' : '📂';
        
        return `
            <div class="pill soft" style="display:flex; align-items:center; gap:8px; margin-bottom:4px; padding:4px 10px; background: rgba(255,255,255,0.05);">
                <span style="font-size:10px; opacity: 0.7;">${icon}</span>
                <span style="flex:1; font-size:10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${esc(link.name)}</span>
                <b class="pill-remove-x" style="cursor:pointer; opacity: 0.5;" 
                   onclick="OL.removeStepLink('${resId}', '${step.id}', ${idx})">×</b>
            </div>
        `;
    }).join('');
}

OL.filterResourceSearch = function(resId, stepId, query) {
    const resultsContainer = document.getElementById(`resource-results-${stepId}`);
    if (!resultsContainer) return;

    const q = (query || "").toLowerCase();
    const res = OL.getResourceById(resId);
    const step = res?.steps.find(s => String(s.id) === String(stepId));
    const alreadyLinkedIds = (step?.links || []).map(l => String(l.id));

    // 1. Map SOP Resources with a Folder icon
    const otherResources = (state.master.resources || []).filter(r => 
        String(r.id) !== String(resId) && !alreadyLinkedIds.includes(String(r.id))
    ).map(r => ({ id: r.id, name: r.name, icon: '📂', type: 'sop' }));

    // 2. Map How-To Library with a Book icon
    const guides = (state.master.howToLibrary || []).filter(g => 
        !alreadyLinkedIds.includes(String(g.id))
    ).map(g => ({ id: g.id, name: g.name, icon: '📖', type: 'guide' }));

    const combined = [...otherResources, ...guides].filter(item => 
        item.name.toLowerCase().includes(q)
    );

    if (combined.length === 0) {
        resultsContainer.innerHTML = q ? '<div class="search-item muted">No unlinked matches...</div>' : '';
        return;
    }

    resultsContainer.innerHTML = combined.map(item => `
        <div class="search-result-item" 
             style="display: flex; align-items: center; gap: 10px; padding: 8px 12px;"
             onmousedown="OL.addStepResource('${resId}', '${stepId}', '${item.id}', '${esc(item.name)}', '${item.type}')">
            <span style="font-size: 14px; opacity: 0.8;">${item.icon}</span>
            <div style="flex:1">
                <div style="font-size: 11px; font-weight: bold; color: white;">${esc(item.name)}</div>
                <div style="font-size: 8px; opacity: 0.5; text-transform: uppercase; letter-spacing: 0.5px;">${item.type === 'guide' ? 'Instructional Guide' : 'SOP Module'}</div>
            </div>
        </div>
    `).join('');
};

OL.addStepResource = function(resId, stepId, targetId, targetName, targetType) {
    const res = OL.getResourceById(resId);
    const step = res?.steps.find(s => String(s.id) === String(stepId));
    
    if (!step) return;
    if (!step.links) step.links = [];

    step.links.push({ id: targetId, name: targetName, type: targetType });
    OL.persist();
    
    // Refresh the local resource list
    const listContainer = document.getElementById(`step-resources-list-${stepId}`);
    if (listContainer) listContainer.innerHTML = renderStepResources(resId, step);
    
    // 🚀 Close only this specific dropdown
    const resultsContainer = document.getElementById(`resource-results-${stepId}`);
    if (resultsContainer) resultsContainer.innerHTML = "";
};

OL.removeStepLink = function(resId, stepId, index) {
    const res = OL.getResourceById(resId);
    const step = res?.steps.find(s => String(s.id) === String(stepId));
    
    if (step && step.links) {
        step.links.splice(index, 1);
        OL.persist();
        
        const listContainer = document.getElementById('step-resources-list-' + stepId);
        if (listContainer) {
            listContainer.innerHTML = renderStepResources(resId, step);
        }
    }
};

// HANDLE EDITING, INCLUDING DRAG AND DROP
OL.toggleInlineEdit = function(event, resId, stepId) {
    // If the user clicked an input or textarea inside the row, don't collapse/expand
    if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') return;
    
    if (event) event.stopPropagation();
    state.editingStepId = (state.editingStepId === stepId) ? null : stepId;
    
    const res = OL.getResourceById(resId);
    document.getElementById('sop-step-list').innerHTML = renderSopStepList(res);
};

OL.handleStepDragStart = function(event, index) {
    // 1. Store the index for the drop handler
    event.dataTransfer.setData("draggedIndex", index);
    
    // 2. Identify the element actually being dragged
    // currentTarget is the element that has the ondragstart attribute
    const dragTarget = event.currentTarget;
    
    if (dragTarget) {
        dragTarget.style.opacity = '0.4';
        // Optional: set the drag image to the whole row
        event.dataTransfer.setDragImage(dragTarget, 0, 0);
    } else {
        // Fallback to finding the closest row if currentTarget fails
        const fallback = event.target.closest('.dp-manager-row') || event.target.closest('.step-group');
        if (fallback) fallback.style.opacity = '0.4';
    }
};

OL.handleStepDrop = function(event, targetIndex, resId) {
    event.preventDefault();

    // Cleanup visual classes immediately
    document.querySelectorAll('.vis-node').forEach(n => {
        n.classList.remove('drop-target-active');
        n.classList.remove('is-dragging-source');
    });

    const draggedIndex = parseInt(event.dataTransfer.getData("draggedIndex"));
    if (draggedIndex === targetIndex) return;

    const res = OL.getResourceById(resId);
    const steps = res.steps;

    // Move the item in the array
    const [movedItem] = steps.splice(draggedIndex, 1);
    steps.splice(targetIndex, 0, movedItem);

    OL.persist();
    
    const visCanvas = document.getElementById('vis-links-layer');
    if (visCanvas) {
        OL.renderVisualizer(resId);
    } else {
        const listEl = document.getElementById('sop-step-list');
        if (listEl) listEl.innerHTML = renderSopStepList(res);
    }
};

OL.handleDragOver = function(event) {
    event.preventDefault(); // Necessary to allow drop
    
    // Remove highlight from ALL nodes first
    document.querySelectorAll('.vis-node').forEach(n => n.classList.remove('drop-target-active'));
    
    // Identify the card currently under the mouse
    const targetCard = event.target.closest('.vis-node');
    
    // Only light it up if it's NOT the one we are currently dragging
    if (targetCard && !targetCard.classList.contains('is-dragging-source')) {
        targetCard.classList.add('drop-target-active');
    }
};

// HANDLE OUTCOMES
state.expandedSteps = state.expandedSteps || new Set();

OL.toggleStepOutcomes = function(event, resId, stepId) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }

    if (!(state.expandedSteps instanceof Set)) {
        state.expandedSteps = new Set();
    }

    const isCurrentlyExpanded = state.expandedSteps.has(stepId);
    
    if (isCurrentlyExpanded) {
        state.expandedSteps.delete(stepId);
        if (state.editingStepId === stepId) state.editingStepId = null;
    } else {
        state.expandedSteps.clear(); // 🚀 THE FIX: Ensures only one branch is visible
        state.expandedSteps.add(stepId);
        state.editingStepId = stepId; 
    }
    
    const res = OL.getResourceById(resId);
    const listEl = document.getElementById('sop-step-list');
    if (listEl && res) {
        listEl.innerHTML = renderSopStepList(res);
    }
};

OL.filterOutcomeSearch = function(resId, stepId, query) {
    const listEl = document.getElementById("outcome-results");
    if (!listEl) return;
    const q = (query || "").toLowerCase();
    const res = OL.getResourceById(resId);

    const logicActions = [
        { id: 'next', name: 'Proceed to Next Step', icon: '➡️' },
        { id: 'close', name: 'Close Workflow', icon: '🏁' },
        { id: 'restartStep', name: 'Restart Step', icon: '🔁' },
        { id: 'restartWorkflow', name: 'Restart Workflow', icon: '🔝' },
    ];
    
    const steps = (res.steps || []).filter(s => String(s.id) !== String(stepId));
    const externalResources = (state.master.resources || []).filter(r => r.id !== resId);

    let html = '';

    // 1. Logic Group
    const filteredLogic = logicActions.filter(a => a.name.toLowerCase().includes(q));
    if (filteredLogic.length) {
        html += `<div class="search-group-header">Logic</div>`;
        filteredLogic.forEach(a => {
            // Passing the icon + name as the destination label
            html += `<div class="search-result-item" onmousedown="OL.executeAssignmentOutcome('${resId}', '${stepId}', '${a.id}', '${esc(a.icon + " " + a.name)}')">
                ${a.icon} ${a.name}
            </div>`;
        });
    }

    // 2. Jump Group
    const filteredSteps = steps.filter(s => val(s.name, "Unnamed Step").toLowerCase().includes(q));
    if (filteredSteps.length) {
        html += `<div class="search-group-header">Jump To Step</div>`;
        filteredSteps.forEach(s => {
            const stepTitle = val(s.name, "Unnamed Step");
            html += `<div class="search-result-item" onmousedown="OL.executeAssignmentOutcome('${resId}', '${stepId}', 'jump_${s.id}', '↪ ${esc(stepTitle)}')">
                ↪ ${esc(stepTitle)}
            </div>`;
        });
    }

    // 3. External Group
    const filteredExt = externalResources.filter(r => r.name.toLowerCase().includes(q));
    if (filteredExt.length) {
        html += `<div class="search-group-header">Trigger External Resource</div>`;
        filteredExt.forEach(r => {
            html += `<div class="search-result-item" onmousedown="OL.executeAssignmentOutcome('${resId}', '${stepId}', 'launch_${r.id}', '🚀 Launch: ${esc(r.name)}')">
                🚀 Launch: ${esc(r.name)}
            </div>`;
        });
    }

    listEl.innerHTML = html || `<div class="search-result-item muted">No outcomes found</div>`;
};

OL.getOutcomeLabel = function(action, res) {
    if (!action || action === 'next') return "➡️ Proceed to Next Step";
    if (action === 'close') return "🏁 Close Workflow";
    
    if (action.startsWith('jump_')) {
        const targetId = action.replace('jump_', '');
        const target = res.steps.find(s => String(s.id) === String(targetId));
        return `↩️ Jump to: ${val(target?.name, "Unnamed Step")}`;
    }
    
    if (action.startsWith('launch_')) {
        const targetId = action.replace('launch_', '');
        const target = state.master.resources.find(r => r.id === targetId);
        return `🚀 Launch: ${val(target?.name, "Unknown Resource")}`;
    }
    
    return "Search outcomes...";
};

function renderStepOutcomes(resId, step) {
    const outcomes = step.outcomes || [];
    const res = OL.getResourceById(resId);
    
    if (outcomes.length === 0) {
        return '<div class="tiny muted" style="padding: 10px; border: 1px dashed var(--line); border-radius: 4px; text-align: center;">No branching logic defined.</div>';
    }

    return outcomes.map((oc, idx) => `
        <div class="dp-manager-row outcome-row" 
            style="background: rgba(var(--accent-rgb), 0.03); margin-bottom: 4px; border-left: 2px solid var(--accent); display: flex; align-items: center; justify-content: flex-start; gap: 10px; padding: 6px 10px;">
            
            <div style="flex: 1; display: flex; align-items: center; justify-content: flex-start; gap: 8px;">
                <span class="tiny bold accent" style="font-size: 9px; opacity: 0.7; min-width: 15px; text-align: left;">IF</span>
                <input type="text" class="tiny-input" 
                      value="${esc(oc.condition || '')}" 
                      placeholder="Enter condition (e.g. Approved)..."
                      style="background: transparent; border: none; font-size: 11px; width: 100%; outline: none; color: white; text-align: left; padding: 0;"
                      onblur="OL.updateOutcomeDetail('${resId}', '${step.id}', ${idx}, 'condition', this.value)">
            </div>

            <div style="flex: 1; display: flex; align-items: center; justify-content: flex-start; gap: 8px; border-left: 1px solid var(--line); padding-left: 10px;">
                <span class="tiny muted" style="font-size: 9px; min-width: 30px; text-align: left;">THEN</span>
                <div class="is-clickable outcome-mapping-target" 
                    style="font-size: 11px; color: var(--text-main); flex: 1; text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;"
                    onclick="OL.openOutcomePicker(event, '${resId}', '${step.id}', ${idx})"
                    title="Click to remap destination">
                    ${esc(oc.label || 'Select Destination...')}
                </div>
            </div>

            <button class="card-delete-btn" style="position: static; font-size: 14px;" 
                    onclick="OL.removeOutcome('${resId}', '${step.id}', ${idx})">×</button>
        </div>
    `).join('');
}

OL.openOutcomePicker = function(event, resId, stepId, idx) {
    // We can store which index we are currently "remapping"
    state.activeRemap = { resId, stepId, idx };
    
    // Focus the search input that already exists in your modal
    const searchInput = document.querySelector('.outcome-search-input');
    if (searchInput) {
        searchInput.focus();
        OL.filterOutcomeSearch(resId, stepId, ''); // Open the full list
    }
};

OL.executeAssignmentOutcome = function(resId, stepId, actionCode, destinationLabel) {
    const res = OL.getResourceById(resId);
    const step = res?.steps.find(s => String(s.id) === String(stepId));
    if (!step) return;

    if (!step.outcomes) step.outcomes = [];

    // 🚀 Check if we are remapping an existing row or adding a new one
    if (state.activeRemap && state.activeRemap.idx !== undefined) {
        const idx = state.activeRemap.idx;
        step.outcomes[idx].action = actionCode;
        step.outcomes[idx].label = destinationLabel;
        state.activeRemap = null; // Clear state
    } else {
        step.outcomes.push({ 
            condition: "", 
            action: actionCode, 
            label: destinationLabel 
        });
    }

    OL.persist();
    
    // Surgical Refresh
    const detailList = document.getElementById('step-outcomes-list');
    if (detailList) detailList.innerHTML = renderStepOutcomes(resId, step);

    const mainList = document.getElementById('sop-step-list');
    if (mainList) mainList.innerHTML = renderSopStepList(res);

    // Clear search
    const results = document.getElementById('outcome-results');
    if (results) results.innerHTML = "";
};

OL.updateOutcomeValue = function(resId, stepId, idx, field, value) {
    const res = OL.getResourceById(resId);
    const step = res.steps.find(s => s.id === stepId);
    if (step && step.outcomes[idx]) {
        step.outcomes[idx][field] = value;
        OL.persist();
    }
};

OL.updateOutcomeDetail = function(resId, stepId, idx, field, value) {
    const res = OL.getResourceById(resId);
    const step = res?.steps.find(s => String(s.id) === String(stepId));
    
    if (step && step.outcomes[idx]) {
        step.outcomes[idx][field] = value;
        OL.persist();
        
        // Update background grid surgically to reflect the new custom name
        const mainList = document.getElementById('sop-step-list');
        if (mainList) mainList.innerHTML = renderSopStepList(res);
    }
};

OL.removeOutcome = function(resId, stepId, idx) {
    const res = OL.getResourceById(resId);
    const step = res?.steps.find(s => String(s.id) === String(stepId));

    if (step && step.outcomes) {
        step.outcomes.splice(idx, 1);
        OL.persist();

        // Surgical Update
        const detailList = document.getElementById('step-outcomes-list');
        if (detailList) detailList.innerHTML = renderStepOutcomes(resId, step);

        const mainList = document.getElementById('sop-step-list');
        if (mainList) mainList.innerHTML = renderSopStepList(res);
    }
};

// HANDLE DUE DATES AND ASSIGNMENTS
OL.calculateDeployedDate = function(baseDate, offsetDays) {
    const date = new Date(baseDate);
    date.setDate(date.getDate() + parseInt(offsetDays || 0));
    return date.toISOString().split('T')[0]; // Returns YYYY-MM-DD
};

OL.filterAssignmentSearch = function(resId, targetId, isTrigger, query) {
    const listEl = document.getElementById("assignment-search-results");
    if (!listEl) return;

    const q = (query || "").toLowerCase().trim();
    const client = getActiveClient();
    const team = client?.projectData?.teamMembers || [];
    const apps = [...state.master.apps, ...(client?.projectData?.localApps || [])];

    // 1. Get Unique Roles
    const roles = [...new Set(team.flatMap(m => m.roles || []))];

    let html = "";

    // 🟢 Section: People
    const matchPeople = team.filter(m => m.name.toLowerCase().includes(q));
    if (matchPeople.length) {
        html += `<div class="search-group-header">Team Members</div>`;
        html += matchPeople.map(m => `
            <div class="search-result-item" onmousedown="OL.executeAssignment('${resId}', '${targetId}', ${isTrigger}, 'person', '${m.id}', '${esc(m.name)}')">
                👨‍💼 ${esc(m.name)}
            </div>`).join('');
    }

    // 🔵 Section: Roles
    const matchRoles = roles.filter(r => r.toLowerCase().includes(q));
    if (matchRoles.length) {
        html += `<div class="search-group-header">Roles</div>`;
        html += matchRoles.map(r => `
            <div class="search-result-item" onmousedown="OL.executeAssignment('${resId}', '${targetId}', ${isTrigger}, 'role', '${esc(r)}', '${esc(r)}')">
                🎭 Role: ${esc(r)}
            </div>`).join('');
    }

    // 🟠 Section: Systems (Apps)
    const matchApps = apps.filter(a => a.name.toLowerCase().includes(q));
    if (matchApps.length) {
        html += `<div class="search-group-header">Systems / Apps</div>`;
        html += matchApps.map(a => `
            <div class="search-result-item" onmousedown="OL.executeAssignment('${resId}', '${targetId}', ${isTrigger}, 'system', '${a.id}', '${esc(a.name)}')">
                📱 ${esc(a.name)}
            </div>`).join('');
    }

    listEl.innerHTML = html || `<div class="search-result-item muted">No matches found</div>`;
};

OL.executeAssignment = function(resId, targetId, isTrigger, type, id, name) {
    const res = OL.getResourceById(resId);
    let target = isTrigger 
        ? res.triggers[targetId] 
        : res.steps.find(s => s.id === targetId);

    if (target) {
        target.assigneeType = type; // 'person', 'role', or 'system'
        target.assigneeId = id;
        target.assigneeName = name;
        
        OL.persist();
        
        // Refresh the detail modal to show the new assignee
        if (isTrigger) OL.openTriggerDetailModal(resId, targetId);
        else OL.openStepDetailModal(resId, targetId);
        
        // Refresh the background list surgically
        const listEl = document.getElementById('sop-step-list');
        if (listEl) listEl.innerHTML = renderSopStepList(res);
    }
};

// ADD UPDATE OR REMOVE TRIGGERS
OL.addResourceTrigger = function(resId) {
    const res = OL.getResourceById(resId);
    if (!res) return;
    if (!res.triggers) res.triggers = [];
    
    res.triggers.push({ name: "", type: "auto" });
    OL.persist();
    
    // Surgical Update
    const listEl = document.getElementById('sop-step-list');
    if (listEl) listEl.innerHTML = renderSopStepList(res);
};

OL.openTriggerDetailModal = function(resId, triggerIdx) {
    const res = OL.getResourceById(resId);
    const trigger = res?.triggers?.[triggerIdx];
    if (!trigger) return;

    const html = `
        <div class="modal-head" style="gap:15px;">
            <div style="display:flex; align-items:center; gap:10px; flex:1;">
                <span style="font-size:18px;">⚡</span>
                <input type="text" class="header-editable-input" 
                       value="${esc(val(trigger.name))}" 
                       placeholder="Trigger Name (e.g. New Lead)..."
                       style="background:transparent; border:none; color:inherit; font-size:18px; font-weight:bold; width:100%; outline:none;"
                       onblur="OL.updateTriggerMeta('${resId}', ${triggerIdx}, 'name', this.value)">
            </div>
            <button class="btn small soft" onclick="OL.openResourceModal('${resId}')">Back to Resource</button>
        </div>
        <div class="modal-body">
            <div class="card-section">
                <label class="modal-section-label">Trigger Logic Type</label>
                <div style="display:flex; gap:10px; margin-top:10px;">
                    <button class="btn small ${trigger.type === 'auto' ? 'accent' : 'soft'} flex-1" 
                            onclick="OL.updateTriggerMeta('${resId}', ${triggerIdx}, 'type', 'auto')">
                        ⚡ Automatic (Zap/Webhook)
                    </button>
                    <button class="btn small ${trigger.type === 'manual' ? 'accent' : 'soft'} flex-1" 
                            onclick="OL.updateTriggerMeta('${resId}', ${triggerIdx}, 'type', 'manual')">
                        👨‍💼 Manual Action
                    </button>
                </div>
            </div>

            <div class="card-section" style="margin-top:20px;">
                <label class="modal-section-label">Technical Notes / Source URL</label>
                <textarea class="modal-textarea" rows="3" 
                          placeholder="Link to the Zap, Form URL, or description of the starting event..."
                          onblur="OL.updateTriggerMeta('${resId}', ${triggerIdx}, 'notes', this.value)">${esc(trigger.notes || "")}</textarea>
            </div>
        </div>
    `;
    openModal(html);
};

// Update Logic with Surgical Refresh
OL.updateTriggerMeta = function(resId, idx, field, value) {
    const res = OL.getResourceById(resId);
    if (res && res.triggers[idx]) {
        res.triggers[idx][field] = value;
        OL.persist();
        
        // Surgical Update: Refresh the list in the background Resource Modal
        const listEl = document.getElementById('sop-step-list');
        if (listEl) listEl.innerHTML = renderSopStepList(res);

        // If we toggled the type, refresh the detail modal to update button colors
        if (field === 'type') OL.openTriggerDetailModal(resId, idx);
    }
};

OL.removeTrigger = function(resId, idx) {
    const res = OL.getResourceById(resId);
    if (res && res.triggers) {
        res.triggers.splice(idx, 1);
        OL.persist();
        document.getElementById('sop-step-list').innerHTML = renderSopStepList(res);
    }
};

OL.updateTriggerName = function(resId, idx, name) {
    const res = OL.getResourceById(resId);
    if (res && res.triggers[idx]) {
        res.triggers[idx].name = name;
        OL.persist();
        // Background card sync if needed
        OL.refreshActiveView();
    }
};

// ADD LINKED RESOURCE TO CURRENT RESOURCE
OL.openResourceLinker = function(parentResId) {
    const html = `
        <div class="modal-head"><div class="modal-title-text">Link Workflow Module</div></div>
        <div class="modal-body">
            <div class="search-map-container">
                <input type="text" class="modal-input" placeholder="Search resources to link..." 
                       onfocus="OL.filterResourceLinker('${parentResId}', '')"
                       oninput="OL.filterResourceLinker('${parentResId}', this.value)">
                <div id="res-linker-results" class="search-results-overlay"></div>
            </div>
        </div>`;
    openModal(html);
};

OL.filterResourceLinker = function(parentResId, query) {
    const listEl = document.getElementById("res-linker-results");
    const q = (query || "").toLowerCase();
    
    // Get all apps except the current one (prevent infinite recursion)
    const available = (state.master.resources || []).filter(r => 
        r.id !== parentResId && r.name.toLowerCase().includes(q)
    );

    listEl.innerHTML = available.map(r => `
        <div class="search-result-item" onmousedown="OL.addLinkedResourceStep('${parentResId}', '${r.id}'); OL.closeModal();">
            📦 ${esc(r.name)}
        </div>
    `).join('');
};

OL.addLinkedResourceStep = function(parentResId, linkedResId) {
    const parentRes = OL.getResourceById(parentResId);
    const linkedRes = OL.getResourceById(linkedResId);
    
    if (!parentRes || !linkedRes) return;

    if (!parentRes.steps) parentRes.steps = [];
    
    // Create ONE step that represents the WHOLE module
    parentRes.steps.push({
        id: uid(),
        type: 'module_block', // Custom type for rendering
        linkedResourceId: linkedResId,
        name: linkedRes.name,
        isLocked: true // Ensures no inline editing
    });

    OL.persist();
    OL.openResourceModal(parentResId);
};

// 2. UPDATE STEP OR REMOVE
OL.updateSopStep = function (resId, stepId, field, value) {
  const isVault = window.location.hash.includes("vault");
  const resources = isVault
    ? state.master.resources
    : getActiveClient()?.projectData?.localResources;
  const res = resources.find((r) => r.id === resId);

  if (res && res.steps) {
    const step = res.steps.find((s) => s.id === stepId);
    if (step) {
      step[field] = field === "duration" ? parseFloat(value) || 0 : value;
      OL.persist();
      // We don't re-render here to prevent losing focus while typing
    }
  }
};

OL.updateAtomicStep = function (resId, stepId, field, value) {
    const context = OL.getCurrentContext();
    let res = null;

    if (context.isMaster) {
        res = state.master.resources.find(r => String(r.id) === String(resId));
    } else {
        const client = getActiveClient();
        res = client?.projectData?.localResources?.find(r => String(r.id) === String(resId));
    }

    if (res && res.steps) {
        const step = res.steps.find(s => String(s.id) === String(stepId));
        if (step) {
            step[field] = value;
            OL.persist();
            
            // 1. Refresh Standard Modal List
            const listEl = document.getElementById('sop-step-list');
            if (listEl) listEl.innerHTML = renderSopStepList(res);
            
            // 🚀 THE FULLSCREEN RE-RENDER FIX:
            const fsOverlay = document.getElementById('workflow-fs-overlay');
            if (fsOverlay) {
                const visualModeBtn = document.getElementById('mode-visual');
                // Check if we are currently looking at the Visualizer
                if (visualModeBtn && visualModeBtn.classList.contains('active')) {
                    console.log("♻️ Syncing Visualizer with Modal Changes...");
                    OL.renderVisualizer(resId);
                }
            }
            
            OL.refreshActiveView();
            console.log(`✅ Step Updated: ${field} = ${value}`);
        }
    }
};

OL.removeSopStep = function (resId, stepId) {
    if (!confirm("Delete this workflow step?")) return;

    const res = OL.getResourceById(resId);

    if (res && res.steps) {
        res.steps = res.steps.filter((s) => String(s.id) !== String(stepId));
        OL.persist();

        // 🚀 SURGICAL UPDATE: Refresh list without closing modal
        const listEl = document.getElementById('sop-step-list');
        if (listEl) {
            listEl.innerHTML = renderSopStepList(res);
        }
        
        // Sync background cards
        OL.refreshActiveView();
    }
};
//======================= ANALYSIS MATRIX SECTION =======================//

// 1. RENDER WEIGHTED ANALYSIS MODULE
window.renderAnalysisModule = function(isVaultMode = false) {
    OL.registerView(renderAnalysisModule);
    const container = document.getElementById("mainContent");
    const client = getActiveClient();
    
    // 1. Updated Guard: Only exit if we aren't in Vault AND have no client
    if (!isVaultMode && !client) return;
    if (!container) return;

    // 2. Get Data Sources
    const masterTemplates = state.master.analyses || [];
    
    // If in Vault, show all. If in Client, show only shared templates.
    const templatesToDisplay = isVaultMode 
        ? masterTemplates 
        : masterTemplates.filter(t => client?.sharedMasterIds?.includes(t.id));

    // Local analyses only exist in Client mode
    const localAnalyses = (!isVaultMode && client) ? (client.projectData.localAnalyses || []) : [];

    container.innerHTML = `
        <div class="section-header">
            <div>
                <h2>${isVaultMode ? '📚 Master Analysis Library' : '📈 Feature Analysis & Comparison'}</h2>
                <div class="small muted subheader">
                    ${isVaultMode ? 'Global templates for standardized scoring' : `Helping ${esc(client?.meta.name)} find the right fit`}
                </div>
            </div>
            <div class="header-actions">
                <button class="btn small soft" onclick="OL.openGlobalContentManager()" style="margin-right: 8px;" title="Manage Global Content">
                    ⚙️
                </button>
                ${isVaultMode ? 
                    `<button class="btn primary" onclick="OL.createNewMasterAnalysis()">+ Create Template</button>` : 
                    `<button class="btn small soft" onclick="OL.createNewAnalysisSandbox()">+ Create Local Analysis</button>
                    <button class="btn primary" onclick="OL.importAnalysisFromVault()" style="margin-right:8px;">⬇ Import from Master</button>`
                }
            </div>
        </div>

        <div class="cards-grid">
            ${templatesToDisplay.map(anly => renderAnalysisCard(anly, true)).join('')}
            
            ${!isVaultMode ? localAnalyses.map(anly => renderAnalysisCard(anly, false)).join('') : ''}
            
            ${(templatesToDisplay.length === 0 && localAnalyses.length === 0) ? '<div class="empty-hint">No analyses found.</div>' : ''}
        </div>

        <div id="activeAnalysisMatrix" class="matrix-container" style="margin-top: 40px;"></div>
    `;
};

OL.openAnalysisMatrix = function(analysisId, isMaster) {
    const client = getActiveClient();
    const source = isMaster ? state.master.analyses : (client?.projectData?.localAnalyses || []);
    const anly = source.find(a => a.id === analysisId);

    if (!anly) return console.error("Analysis not found:", analysisId);

    const totalWeight = (anly.features || []).reduce((sum, f) => sum + (parseFloat(f.weight) || 0), 0);

    const container = document.getElementById("activeAnalysisMatrix");
    if (!container) return;

    // 🏆 WINNER CALCULATION: Find the highest score among all apps
    const appResults = (anly.apps || []).map(appObj => ({
        appId: appObj.appId,
        total: parseFloat(OL.calculateAnalysisScore(appObj, anly.features || []))
    }));
    
    const topScore = Math.max(...appResults.map(r => r.total), 0);

    const html = `
        <div class="print-container">
            <div class="analysis-summary-card">
                <strong style="font-size: 1.1em; color: #333;">${esc(anly.name)}</strong>
                <span class="muted" style="font-size: 0.9em;">
                    ${anly.features.length} Features  •  ${anly.apps.length} Apps
                </span>
            </div>

            <div class="matrix-table-container">
                <table class="matrix-table">
                    </table>
            </div>
        </div>
    `;

    // Scroll to the matrix area
    container.scrollIntoView({ behavior: 'smooth' });

    // Add category button if you want to re-add later
    /* <button class="btn tiny soft" onclick="OL.promptAddCategory('${analysisId}', ${isMaster})">
      + Add Category
      </button>
    */

    container.innerHTML = `
        <div class="card" style="border-top: 3px solid var(--accent); padding: 20px;">
            <div class="section-header">
                <div>
                    <h3>📊 Matrix: 
                      <span contenteditable="true" 
                            class="editable-matrix-name m-name-${analysisId}"
                            data-m-id="${analysisId}"
                            style="border-bottom: 1px dashed var(--accent); cursor: text;"
                            oninput="OL.syncMatrixName(this)"
                            onblur="OL.renameMatrix('${analysisId}', this.innerText, ${isMaster})">
                          ${esc(anly.name)}
                      </span>
                    </h3>
                    <div class="subheader">Scores: 0 (Feature is N/A for app), 1 (<60% of desired performance), 2 (60 - 80% of desired performance), 3 (80%+ desired performance) </div>
                </div>
                <div class="header-actions">
                    ${!isMaster ? `
                        <button class="btn tiny warn" onclick="OL.pushMatrixToMasterLibrary('${analysisId}')" title="Save this matrix as a standard template in the Vault">
                            ⭐ Push to Vault
                        </button>
                    ` : ''}
                    <button class="btn tiny primary" onclick="OL.printAnalysisPDF('${analysisId}', ${isMaster})">🖨️ Print PDF</button>
                    <button class="btn tiny soft" onclick="OL.addAppToAnalysis('${analysisId}', ${isMaster})">+ Add App</button>
                </div>
            </div>

            <table class="matrix-table" style="width: 100%; margin-top: 20px; border-collapse: collapse;">
                <thead>
                    <tr>
                        <th style="text-align: left;">Features</th>
                        <th style="text-align: center;">Weight</th>
                        ${(anly.apps || []).map(appObj => {
                            const allAvailableApps = [
                                ...(state.master.apps || []),
                                ...(client?.projectData?.localApps || [])
                            ];
                            
                            const matchedApp = allAvailableApps.find(a => a.id === appObj.appId);
                            
                            const isWinner = topScore > 0 && appResults.find(r => r.appId === appObj.appId)?.total === topScore;
                            
                            return `
                                <th class="text-center" style="${isWinner ? 'background: rgba(255, 215, 0, 0.05); border-radius: 8px 8px 0 0;' : ''}">
                                    <div style="display:flex; flex-direction:column; align-items:center; gap:5px;">
                                        <button class="card-delete-btn" 
                                                onclick="OL.removeAppFromAnalysis('${analysisId}', '${appObj.appId}', ${isMaster})"
                                                style="font-size: 14px; opacity: 0.5;">×</button>
                                        <span onclick="event.stopPropagation(); OL.openAppModal('${matchedApp.id}')" style="${isWinner ? 'color: var(--vault-gold); font-weight: bold;' : ''}">
                                            ${isWinner ? '⭐ ' : ''}${esc(matchedApp?.name || 'Unknown App')}
                                        </span>
                                    </div>
                                </th>`;
                        }).join('')}
                    </tr>
                </thead>
                <tbody>
                    ${renderAnalysisMatrixRows(anly, analysisId, isMaster)}
                </tbody>
                <tfoot>
                    <tr style="border-top: 2px solid var(--line);">
                        <td>
                          <button class="btn tiny soft" onclick="OL.addFeatureToAnalysis('${analysisId}', ${isMaster})">+ Add Feature</button>
                        </td>
                        <td class="bold" style="color: ${totalWeight === 100 ? 'var(--accent)' : '#ff4444'}">
                            ${totalWeight.toFixed(2)}% 
                            <button class="btn tiny soft" style="margin: 1%;"
                                    onclick="OL.equalizeAnalysisWeights('${analysisId}', ${isMaster})"
                                    title="Equally distribute 100% weight across categories and features">
                                ⚖️
                            </button>
                        </td>
                        ${(anly.apps || []).map(appObj => {
                            const score = OL.calculateAnalysisScore(appObj, anly.features || []);
                            return `<td class="text-center"><span class="pill tiny ${score > 3.5 ? 'accent' : 'soft'}">${score}</span></td>`;
                        }).join('')}
                    </tr>
                </tfoot>
            </table>
            <div class="card-section" style="margin-top: 25px; border-top: 1px solid var(--line); padding-top: 20px;">
                <label class="modal-section-label">📋 Executive Summary / Final Verdict</label>
                <textarea class="modal-textarea" 
                          placeholder="Provide a high-level summary of the findings or recommend a specific tool..."
                          onblur="OL.updateAnalysisMeta('${anly.id}', 'summary', this.value, ${isMaster})"
                          style="min-height: 80px; background: rgba(0,0,0,0.1); margin-top: 10px;">${esc(anly.summary || "")}</textarea>
            </div>
        </div>
    `;
};

OL.updateAnalysisMeta = function(anlyId, field, value, isMaster) {
    const client = getActiveClient();
    const source = isMaster ? state.master.analyses : (client?.projectData?.localAnalyses || []);
    const anly = source.find(a => a.id === anlyId);

    if (anly) {
        anly[field] = value.trim();
        OL.persist(); // Save to Firebase
        
        // 🔄 Reactive UI: Refresh the module grid to show the new summary on the card face
        renderAnalysisModule(isMaster); 
        
        // Ensure the matrix stays open after the grid refresh
        OL.openAnalysisMatrix(anlyId, isMaster);
        
        console.log(`✅ Analysis ${field} updated.`);
    }
};

window.renderAnalysisMatrixRows = function(anly, analysisId, isMaster) {
    let currentCategory = null;
    let rowsHtml = "";
    const features = anly.features || [];
    
    features.forEach(feat => {
        const catName = feat.category || "General";

        // Inject Editable Category Header Row
        if (catName !== currentCategory) {
            currentCategory = catName;
            rowsHtml += `
                <tr class="category-header-row" style="background: rgba(255,255,255,0.03); border-bottom: 1px solid var(--line);">
                    <td colspan="${(anly.apps || []).length + 2}" style="padding: 10px 12px;">
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <span class="tiny muted">📁</span>
                            <span class="is-clickable"
                                  style="color: var(--accent); font-weight: bold; text-transform: uppercase; cursor: text; border-bottom: 1px dashed transparent;"
                                  onfocus="this.style.borderBottom='1px dashed var(--accent)'"
                                  onblur="OL.renameFeatureCategory('${analysisId}', '${esc(catName)}', this.innerText, ${isMaster})"
                                  onclick="OL.openGlobalContentManager(); setTimeout(() => OL.filterContentManager('${esc(catName)}'), 50)">
                                ${esc(catName)}
                            </span>
                            <span class="tiny muted" style="font-size: 9px;"></span>
                        </div>
                    </td>
                </tr>
            `;
        }

        // Standard Row (Features)
        rowsHtml += `
            <tr>
                <td style="padding-left: 28px;">
                    <div style="display:flex; align-items:center; gap:8px;">
                        <button class="card-delete-btn" onclick="OL.removeFeatureFromAnalysis('${analysisId}', '${feat.id}', ${isMaster})">×</button> 
                        <span class="small feature-edit-link" 
                              style="cursor: pointer; border-bottom: 1px dotted var(--muted);"
                              onclick="OL.editFeatureModal('${analysisId}', '${feat.id}', ${isMaster})">
                            ${esc(feat.name)}
                        </span>
                    </div>
                </td>
                <td>
                    <input type="number" class="tiny-input" style="width:45px" value="${feat.weight || 0}" 
                           onblur="OL.updateAnalysisFeature('${analysisId}', '${feat.id}', 'weight', this.value, ${isMaster})">
                </td>
                ${(anly.apps || []).map(appObj => `
                    <td class="text-center" style="padding: 8px;">
                        <input type="number" class="matrix-score-input" 
                              value="${appObj.scores?.[feat.id] || 0}"
                              onblur="OL.updateAnalysisScore('${analysisId}', '${appObj.appId}', '${feat.id}', this.value, ${isMaster})">
                    </td>
                `).join('')}
            </tr>
        `;
    });
    return rowsHtml;
};

OL.printAnalysisPDF = function(analysisId, isMaster) {
    const container = document.getElementById("activeAnalysisMatrix");
    if (!container) return;

    // 1. Add a temporary class for print styling
    document.body.classList.add("print-mode-active");
    container.classList.add("print-target");

    // 2. Trigger the native print dialog
    window.print();

    // 3. Cleanup
    document.body.classList.remove("print-mode-active");
    container.classList.remove("print-target");
};

// 2. RENDER ANALYSIS CARDS
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

// 3. ANALYSIS CORE ACTIONS
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

OL.deleteAnalysis = function (anlyId, isVaultMode) {
  if (!confirm("Are you sure you want to delete this analysis?")) return;

  if (isVaultMode) {
    state.master.analyses = state.master.analyses.filter(
      (a) => a.id !== anlyId,
    );
  } else {
    const client = getActiveClient();
    client.projectData.localAnalyses = client.projectData.localAnalyses.filter(
      (a) => a.id !== anlyId,
    );
  }

  OL.persist();
  renderAnalysisModule(isVaultMode);
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
    const allApps = [...state.master.apps, ...(client?.projectData?.localApps || [])];

    // 3. Filter: Name match AND not already in the matrix
    const matches = allApps.filter(app => {
        return app.name.toLowerCase().includes(q) && !existingAppIds.includes(app.id);
    });

    // 4. Render results (using onmousedown for instant selection)
    listEl.innerHTML = matches.map(app => `
        <div class="search-result-item" onmousedown="OL.executeAddAppToAnalysis('${anlyId}', '${app.id}', ${isMaster})">
            <div style="display:flex; justify-content:space-between; width:100%; align-items:center;">
                <span>📱 ${esc(app.name)}</span>
                <span class="tiny-tag ${String(app.id).startsWith('local') ? 'local' : 'vault'}">
                    ${String(app.id).startsWith('local') ? 'LOCAL' : 'MASTER'}
                </span>
            </div>
        </div>
    `).join('') || `<div class="search-result-item muted">${q ? 'No matches' : 'All available apps are already in this matrix'}</div>`;
};

OL.addAppToAnalysis = function (anlyId, isMaster) {
    const html = `
        <div class="modal-head">
            <div class="modal-title-text">📱 Add App to Matrix</div>
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

OL.executeAddAppToAnalysis = function (anlyId, appId, isMaster) {
  const source = isMaster
    ? state.master.analyses
    : getActiveClient()?.projectData?.localAnalyses || [];
  const anly = source.find((a) => a.id === anlyId);

  if (anly) {
    if (!anly.apps) anly.apps = [];
    if (!anly.apps.some((a) => a.appId === appId)) {
      anly.apps.push({ appId, scores: {} });
      OL.persist();
    }
    OL.closeModal();
    OL.openAnalysisMatrix(anlyId, isMaster);
  }
};

OL.removeAppFromAnalysis = function(anlyId, appId, isMaster) {
    const client = getActiveClient();
    const source = isMaster ? state.master.analyses : client.projectData.localAnalyses;
    const anly = source.find(a => a.id === anlyId);

    if (anly && anly.apps) {
        // Find the app name for the confirmation message
        const masterApp = state.master.apps.find(a => a.id === appId);
        const appName = masterApp ? masterApp.name : "this application";

        if (confirm(`Are you sure you want to remove ${appName} from this analysis? All scores for this app will be deleted.`)) {
            // Filter out the app from the analysis apps array
            anly.apps = anly.apps.filter(a => a.appId !== appId);
            
            OL.persist();
            // Refresh the Matrix view immediately
            OL.openAnalysisMatrix(anlyId, isMaster);
            console.log(`✅ Removed app ${appId} from analysis ${anlyId}`);
        }
    }
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
    
    // 1. Safely get Local features
    const localFeats = client?.projectData?.localAnalyses
        ? client.projectData.localAnalyses.flatMap(a => a.features || [])
        : [];
        
    // 2. Get Master features
    const masterFeats = (state.master.analyses || []).flatMap(a => a.features || []);
    
    // Return unique feature names
    return [...new Set([...localFeats, ...masterFeats].map(f => f.name))].sort();
};

OL.filterAnalysisFeatureSearch = function (anlyId, isMaster, query) {
    const listEl = document.getElementById("feat-search-results");
    if (!listEl) return;

    // 🚀 THE FIX: Allow empty string to show all results on focus
    const q = (query || "").toLowerCase().trim();
    const client = getActiveClient();

    // 1. Gather all unique features from existing analyses
    const localFeats = client?.projectData?.localAnalyses
        ? client.projectData.localAnalyses.flatMap((a) => a.features || [])
        : [];
    const masterFeats = (state.master.analyses || []).flatMap(
        (a) => a.features || [],
    );
    const allFeatures = [...localFeats, ...masterFeats];

    // 2. Filter matches (if q is empty, matches every name)
    const matches = allFeatures.filter((f) => f.name.toLowerCase().includes(q));

    // 3. Deduplicate matches by name
    const uniqueMatches = Array.from(new Set(matches.map((m) => m.name))).map(
        (name) => matches.find((m) => m.name === name),
    );

    let html = uniqueMatches
        .map(
            (feat) => `
            <div class="search-result-item" onmousedown="OL.executeAddFeature('${anlyId}', '${esc(feat.name)}', ${isMaster}, '${esc(feat.category || "General")}')">
                ✨ ${esc(feat.name)} <span class="tiny muted">(${esc(feat.category || "General")})</span>
            </div>
        `,
        )
        .join("");

    // 4. Option to create brand new feature
    if (q && !uniqueMatches.some((m) => m.name.toLowerCase() === q)) {
        html += `
            <div class="search-result-item create-action" onmousedown="OL.executeAddFeature('${anlyId}', '${esc(query)}', ${isMaster}, 'General')">
                <span class="pill tiny accent">+ New</span> Create Feature "${esc(query)}"
            </div>
        `;
    }

    listEl.innerHTML = html || `<div class="search-result-item muted">No unlinked features found.</div>`;
};

OL.addFeatureToAnalysis = function (anlyId, isMaster) {
  const html = `
        <div class="modal-head">
            <div class="modal-title-text">🔎 Add Feature to Analysis</div>
        </div>
        <div class="modal-body">
            <div class="search-map-container">
                <input type="text" class="modal-input" 
                      placeholder="Click to view global features or type new..." 
                      onfocus="OL.filterAnalysisFeatureSearch('${anlyId}', ${isMaster}, '')"
                      oninput="OL.filterAnalysisFeatureSearch('${anlyId}', ${isMaster}, this.value)" 
                      autofocus>
                <div id="feat-search-results" class="search-results-overlay" style="margin-top:10px;"></div>
            </div>
        </div>
    `;
  openModal(html);
};

if (!state.master.analyses) state.master.analyses = [];

OL.removeFeatureFromAnalysis = function(anlyId, featId, isMaster) {
    if (!confirm("Remove this feature? All scores for this feature will be lost.")) return;
    
    const client = getActiveClient();
    const source = isMaster ? state.master.analyses : client.projectData.localAnalyses;
    const anly = source.find(a => a.id === anlyId);

    if (anly) {
        // Remove from features list
        anly.features = anly.features.filter(f => f.id !== featId);
        
        // Cleanup scores in each app object
        anly.apps.forEach(appObj => {
            if (appObj.scores) delete appObj.scores[featId];
        });

        OL.persist();
        OL.openAnalysisMatrix(anlyId, isMaster);
    }
};

// 4c. ADD CATEGORY TO ANALYSIS OR 
OL.addAllFeaturesFromCategory = function(anlyId, catName, isMaster) {
    const client = getActiveClient();
    
    // 1. Pull feature definitions from the Master Library based on the category name
    const masterSource = (state.master.analyses || []).flatMap(a => a.features || []);
    const catFeatures = masterSource.filter(f => (f.category || "General") === catName);

    // 2. Identify the specific active analysis (Destination)
    const source = isMaster ? state.master.analyses : (client?.projectData?.localAnalyses || []);
    const anly = source.find(a => a.id === anlyId);

    if (anly && catFeatures.length > 0) {
        if (!confirm(`Import all ${catFeatures.length} standard features from "${catName}" into this matrix?`)) return;

        catFeatures.forEach(feat => {
            // Deduplicate: Don't add if the feature name already exists in THIS matrix
            if (!anly.features.some(f => f.name === feat.name)) {
                anly.features.push({ 
                    id: 'feat-' + Date.now() + Math.random(), // New unique ID for this instance
                    name: feat.name,
                    category: catName,
                    weight: 10 // Default starting weight
                });
            }
        });

        OL.persist();
        OL.openAnalysisMatrix(anlyId, isMaster); // Refresh the active matrix
        OL.closeModal();
    }
};

OL.executeAddCategoryToAnalysis = function(anlyId, catName, isMaster) {
    const client = getActiveClient();
    // 🛡️ Source Selection: Use Master Vault if flag is true, else Local Client
    const source = isMaster ? state.master.analyses : (client?.projectData?.localAnalyses || []);
    const anly = source.find(a => a.id === anlyId);

    if (anly) {
        if (!anly.categories) anly.categories = [];
        const cleanName = catName.trim();
        if (cleanName && !anly.categories.includes(cleanName)) {
            anly.categories.push(cleanName);
            anly.categories.sort();
            OL.persist();
        }
        OL.closeModal();
        OL.openAnalysisMatrix(anlyId, isMaster);
    } else {
        console.error("Analysis not found for ID:", anlyId);
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

OL.updateAnalysisScore = function (anlyId, appId, featId, value, isMaster) {
  const client = getActiveClient();
  const source = isMaster
    ? state.master.analyses
    : client?.projectData?.localAnalyses || [];
  const anly = source.find((a) => a.id === anlyId);

  if (anly) {
    const appObj = anly.apps.find((a) => a.appId === appId);
    if (appObj) {
      if (!appObj.scores) appObj.scores = {};
      appObj.scores[featId] = parseFloat(value) || 0;
      OL.persist();
      OL.openAnalysisMatrix(anlyId, isMaster);
    }
  }
}

OL.equalizeAnalysisWeights = function(anlyId, isMaster) {
    const client = getActiveClient();
    const source = isMaster ? state.master.analyses : (client?.projectData?.localAnalyses || []);
    const anly = source.find(a => a.id === anlyId);

    if (!anly || !anly.features || anly.features.length === 0) return;

    // 1. Identify categories that actually contain features
    const activeCats = [...new Set(anly.features.map(f => f.category || "General"))];
    const catCount = activeCats.length;
    if (catCount === 0) return;

    // 2. Distribute 100% across the categories
    const weightPerCat = 100 / catCount;

    anly.features.forEach(f => {
        const catFeatures = anly.features.filter(feat => (feat.category || "General") === (f.category || "General"));
        const featCount = catFeatures.length;
        // Divide the category's slice by the number of features in it
        f.weight = parseFloat((weightPerCat / featCount).toFixed(2));
    });

    // 3. 🛡️ NORMALIZE: Ensure the sum is exactly 100.00
    const currentTotal = anly.features.reduce((sum, f) => sum + f.weight, 0);
    const difference = parseFloat((100 - currentTotal).toFixed(2));

    if (difference !== 0 && anly.features.length > 0) {
        // Apply the tiny remainder (e.g., 0.01) to the last feature
        anly.features[anly.features.length - 1].weight = 
            parseFloat((anly.features[anly.features.length - 1].weight + difference).toFixed(2));
    }

    OL.persist();
    OL.openAnalysisMatrix(anlyId, isMaster);
    console.log(`⚖️ Weights Balanced & Normalized. Total: 100.00%`);
};

// 6. IMPORT ANALYSIS FROM MASTER VAULT OR PUSH TO MASTER VAULT
OL.importAnalysisFromVault = function () {
    const html = `
        <div class="modal-head">
            <div class="modal-title-text">📚 Import Analysis Template</div>
            <div class="spacer"></div>
            <button class="btn small soft" onclick="OL.closeModal()">Cancel</button>
        </div>
        <div class="modal-body">
            <div class="search-map-container">
                <input type="text" class="modal-input" 
                       placeholder="Search templates (e.g. CRM, AI)..." 
                       onfocus="OL.filterMasterAnalysisImport('')"
                       oninput="OL.filterMasterAnalysisImport(this.value)" 
                       autofocus>
                <div id="master-anly-import-results" class="search-results-overlay" style="margin-top:10px;"></div>
            </div>
        </div>
    `;
    openModal(html);
};

OL.filterMasterAnalysisImport = function(query) {
    const listEl = document.getElementById("master-anly-import-results");
    if (!listEl) return;

    const q = (query || "").toLowerCase().trim();
    const available = (state.master.analyses || []).filter(a => 
        a.name.toLowerCase().includes(q)
    );

    listEl.innerHTML = available.map(anly => `
        <div class="search-result-item" onmousedown="OL.executeAnalysisImportById('${anly.id}')">
            📈 ${esc(anly.name)}
        </div>
    `).join('') || `<div class="search-result-item muted">No templates found.</div>`;
};

// Helper to handle the specific ID from search
OL.executeAnalysisImportById = function(templateId) {
    const template = state.master.analyses.find(t => t.id === templateId);
    const client = getActiveClient();
    if (!template || !client) return;

    const newAnalysis = JSON.parse(JSON.stringify(template));
    newAnalysis.id = "anly-" + Date.now();
    
    if (!client.projectData.localAnalyses) client.projectData.localAnalyses = [];
    client.projectData.localAnalyses.push(newAnalysis);

    OL.persist();
    OL.closeModal();
    renderAnalysisModule(false);
};

OL.pushMatrixToMasterLibrary = function(anlyId) {
    const client = getActiveClient();
    const anly = (client?.projectData?.localAnalyses || []).find(a => a.id === anlyId);

    if (!anly) return;

    if (!confirm(`This will save "${anly.name}" as a standard template in your Master Library for use with all future clients. Proceed?`)) return;

    // 1. Create a Master-standard copy of the analysis
    const masterCopy = JSON.parse(JSON.stringify(anly));
    masterCopy.id = 'master-anly-' + Date.now();
    masterCopy.isMaster = true;
    
    // Optional: Templates usually start with blank scores, though they keep feature weights
    masterCopy.apps = []; 

    // 2. Sync Local Categories to Global Registry
    if (anly.categories) {
        if (!state.master.categories) state.master.categories = [];
        anly.categories.forEach(cat => {
            if (!state.master.categories.includes(cat)) {
                state.master.categories.push(cat);
            }
        });
    }

    // 3. Sync Local Features to Global Registry
    if (anly.features) {
        anly.features.forEach(feat => {
            // Logic to ensure these names appear in future searchable dropdowns
            // (Assumes you have a master features list or rely on getGlobalFeatures)
        });
    }

    // 4. Save to Master State
    if (!state.master.analyses) state.master.analyses = [];
    state.master.analyses.push(masterCopy);

    OL.persist();
    alert(`✅ Matrix "${anly.name}" is now a Master Template.`);
    
    // Redirect to the Vault Library to see the new template
    window.location.hash = '#/vault/analyses';
};

OL.deleteMasterAnalysis = function(anlyId) {
    if (!confirm("Are you sure you want to permanently delete this Master Template? It will no longer be available for import into new client projects.")) return;

    state.master.analyses = (state.master.analyses || []).filter(a => a.id !== anlyId);
    
    OL.persist();
    renderAnalysisModule(true); // Refresh the Vault view
};

// 7. UPDATE EXISTING MATRIX (AND SYNC CARD)
OL.updateAnalysisFeature = function(anlyId, featId, key, value, isMaster) {
    const client = getActiveClient();
    // 🛡️ Source Selection: Master Vault vs Local Client
    const source = isMaster ? state.master.analyses : (client?.projectData?.localAnalyses || []);
    const anly = source.find(a => a.id === anlyId);

    if (anly && anly.features) {
        const feat = anly.features.find(f => f.id === featId);
        if (feat) {
            // Convert to number if updating weight, otherwise keep as string
            const val = key === 'weight' ? (parseFloat(value) || 0) : value;
            feat[key] = val;

            OL.persist();
            
            // 🔄 Reactive UI: Re-render the matrix to update Total Weights and Scores
            OL.openAnalysisMatrix(anlyId, isMaster);
            
            console.log(`✅ Updated ${key} for feature ${featId} to ${val}`);
        }
    }
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

//======================= FEATURES MANAGEMENT SECTION =======================//

// 1. RENDER FEATURE MANAGER LIST GROUPED BY CATEGORY/FUNCTION
OL.openGlobalContentManager = function() {
    const isVaultMode = window.location.hash.includes('vault');
    const client = getActiveClient();
    const isAdmin = !window.location.hash.includes('client-view'); 
    
    // 1. Initialize function names for UI badges/styling
    const masterFunctions = (state.master?.functions || []).map(f => f.name);
    const featureGroups = {};
    
    // 🚀 THE FIX: Strict Data Scope
    // If in Vault mode, ONLY load master analyses.
    // If in Client mode, ONLY load that specific client's local analyses.
    const analysesToLoad = isVaultMode 
        ? (state.master.analyses || []) 
        : (client?.projectData?.localAnalyses || []);
        
    // Always keep a reference of what is already in Master to handle the "Push to Vault" Star UI
    const masterFeatureNames = new Set(
        (state.master.analyses || []).flatMap(a => (a.features || []).map(f => f.name))
    );

    // 2. Scan only the scoped analyses to populate the management groups
    analysesToLoad.forEach(anly => {
        anly.features?.forEach(feat => {
            const cat = feat.category || "General";
            if (!featureGroups[cat]) featureGroups[cat] = new Set();
            featureGroups[cat].add(feat.name);
        });
    });

    // 3. Filter the global categories list to only show those active in the current scope
    const allCats = OL.getGlobalCategories().filter(cat => featureGroups[cat]);

    const html = `
        <div class="modal-head">
            <div class="modal-title-text">⚙️ ${isVaultMode ? 'Master Library' : 'Project Content'} Manager</div>
            <div class="spacer"></div>
            <button class="btn small soft" onclick="OL.closeModal()">Close</button>
        </div>
        <div class="modal-body" style="max-height: 75vh; overflow-y: auto;">
            <div style="position: sticky; top: 0; background: var(--panel-bg); padding-bottom: 15px; z-index: 10;">
                <input type="text" class="modal-input" placeholder="Search categories or features..." 
                       oninput="OL.filterContentManager(this.value)">
            </div>

            <p class="tiny muted" style="margin-bottom: 20px;">
                ${isVaultMode 
                    ? "Editing here updates <b>Master Templates</b> globally." 
                    : `Editing here updates <b>${esc(client?.meta.name)}</b> project data only.`}
            </p>

            <div id="manager-content-root">
                ${allCats.map(catName => {
                    const isFunction = masterFunctions.includes(catName);
                    const featuresInCat = Array.from(featureGroups[catName] || []);
                    
                    return `
                        <div class="content-manager-group" data-cat="${esc(catName).toLowerCase()}" style="margin-bottom: 25px;">
                            <div class="dp-manager-row" style="background: var(--panel-soft); border-left: 3px solid ${isFunction ? 'var(--accent)' : 'var(--panel-border)'}; padding: 8px 12px; margin-bottom: 8px;">
                                <div style="flex:1;">
                                    <div style="display:flex; align-items:center; gap:8px;">
                                        <span contenteditable="true" 
                                              style="font-weight: bold; color: ${isFunction ? 'var(--accent)' : 'inherit'}; text-transform: uppercase; cursor: text;"
                                              onblur="OL.globalRenameContent('category', '${esc(catName)}', this.innerText)">
                                            ${esc(catName)}
                                        </span>
                                        ${isFunction ? 
                                            `<span class="pill tiny accent" style="font-size:8px; cursor:pointer;" onclick="OL.demoteFromFunction('${esc(catName)}')" title="Click to Demote to Standard Category">FUNCTION ✕</span>` :
                                            `<button class="btn tiny soft" onclick="OL.promoteToFunction('${esc(catName)}')" title="Promote to Master Function">⚡ Promote</button>`
                                        }
                                    </div>
                                </div>
                                <button class="card-delete-btn" onclick="OL.globalDeleteContent('category', '${esc(catName)}', ${isFunction})">×</button>
                            </div>

                            <div class="content-manager-features" style="padding-left: 15px;">
                                ${featuresInCat.map(featName => {
                                    const inMaster = masterFeatureNames.has(featName);
                                    // Only show the star if we are NOT in the vault and the feature isn't already standardized
                                    const showStar = !isVaultMode && isAdmin && !inMaster;

                                    return `
                                    <div class="dp-manager-row content-item" data-feat="${esc(featName).toLowerCase()}" 
                                    style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.05); padding: 8px 0;">
                                    
                                    <div class="dp-name-cell" style="cursor: pointer; font-size: 13px; flex: 1;" 
                                        onclick="OL.openGlobalFeatureEditor('${esc(featName)}')">
                                        ✨ ${esc(featName)}
                                    </div>

                                    <div style="display:flex; gap: 8px; align-items: center; margin-left: 15px;">
                                        ${showStar ? `<button class="btn tiny accent" onclick="OL.pushFeatureToVault('${esc(featName)}')" title="Push to Master Vault">⭐</button>` : ''}
                                        <button class="btn tiny soft" onclick="OL.openGlobalFeatureEditor('${esc(featName)}')">⚙️</button>
                                        <button class="card-delete-btn" style="position: static;" onclick="OL.globalDeleteContent('feature', '${esc(featName)}')">×</button>
                                    </div>
                                </div>`;
                                }).join('')}
                            </div>
                        </div>`;
                }).join('')}
            </div>
        </div>
    `;
    openModal(html);
};

// 2. OPEN INDIVIDUAL FEATURE EDITOR MODAL
OL.openGlobalFeatureEditor = function (featName) {
  // Find the current category for this feature from the global state
  const client = getActiveClient();
  const allAnalyses = [
    ...(state.master.analyses || []),
    ...Object.values(state.clients).flatMap(
      (c) => c.projectData?.localAnalyses || [],
    ),
  ];

  const instance = allAnalyses
    .flatMap((a) => a.features || [])
    .find((f) => f.name === featName);
  const currentCat = instance?.category || "General";

  const html = `
        <div class="modal-head"><div class="modal-title-text">Edit Global Feature</div></div>
        <div class="modal-body">
            <label class="modal-section-label">Rename Feature</label>
            <input type="text" id="global-feat-name" class="modal-input" value="${esc(featName)}">
            
            <label class="modal-section-label" style="margin-top:15px;">Move to Category</label>
            <input type="text" id="global-feat-cat-search" class="modal-input" value="${esc(currentCat)}"
                   onfocus="OL.filterGlobalManagerCategorySearch(this.value)"
                   oninput="OL.filterGlobalManagerCategorySearch(this.value)">
            <div id="global-cat-results" class="search-results-overlay"></div>
            
            <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:20px;">
                <button class="btn soft" onclick="OL.openGlobalContentManager()">Back</button>
                <button class="btn primary" onclick="OL.executeGlobalFeatureUpdate('${esc(featName)}')">Save System-Wide</button>
            </div>
        </div>
    `;
  openModal(html);
};

OL.editFeatureModal = function(anlyId, featId, isMaster) {
    const client = getActiveClient();
    const source = isMaster ? state.master.analyses : (client.projectData.localAnalyses || []);
    const anly = source.find(a => a.id === anlyId);
    const feat = anly.features.find(f => f.id === featId);

    if (!feat) return;

    const currentCat = feat.category || "General";

    const html = `
        <div class="modal-head">
            <div class="modal-title-text">⚙️ Edit Feature</div>
        </div>
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
                      onfocus="OL.filterEditCategorySearch('${anlyId}', '${featId}', ${isMaster}, this.value)"
                      oninput="OL.filterEditCategorySearch('${anlyId}', '${featId}', ${isMaster}, this.value)">
                <div id="edit-cat-search-results" class="search-results-overlay" 
                    style="margin-top:5px; max-height: 200px; overflow-y: auto; border: 1px solid var(--line); display: none;">
                </div>
                <input type="hidden" id="edit-feat-cat-value" value="${esc(currentCat)}">
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

// 3. SEARCH FOR FEATURE FROM LIST
OL.filterContentManager = function(query) {
    const q = query.toLowerCase().trim();
    const groups = document.querySelectorAll('.content-manager-group');

    groups.forEach(group => {
        const catName = group.getAttribute('data-cat');
        const items = group.querySelectorAll('.content-item');
        let hasVisibleFeature = false;

        items.forEach(item => {
            const featName = item.getAttribute('data-feat');
            if (featName.includes(q) || catName.includes(q)) {
                item.style.display = 'flex';
                hasVisibleFeature = true;
            } else {
                item.style.display = 'none';
            }
        });

        // Show group if category matches OR if it contains a matching feature
        if (catName.includes(q) || hasVisibleFeature) {
            group.style.display = 'block';
        } else {
            group.style.display = 'none';
        }
    });
};

// 4. MANAGE ADDING / EDITING FEATURES
OL.executeAddFeature = function (anlyId, name, isMaster, category) {
  const source = isMaster
    ? state.master.analyses
    : getActiveClient()?.projectData?.localAnalyses || [];
  const anly = source.find((a) => a.id === anlyId);

  if (anly) {
    if (!anly.features) anly.features = [];
    anly.features.push({
      id: "feat-" + Date.now(),
      name: name,
      category: category || "General",
      weight: 10,
    });

    OL.persist();
    OL.closeModal();
    OL.openAnalysisMatrix(anlyId, isMaster); // Refresh matrix view
  }
};

OL.promptFeatureCategory = function(anlyId, featName, isMaster) {
    const html = `
        <div class="modal-head">
            <div class="modal-title-text">📁 Assign Category to "${esc(featName)}"</div>
        </div>
        <div class="modal-body">
            <input type="text" class="modal-input" placeholder="Search or create category..." 
                   oninput="OL.filterFeatureCategoryAssignment('${anlyId}', '${esc(featName)}', ${isMaster}, this.value)" autofocus>
            <div id="feat-cat-assign-results" class="search-results-overlay" style="margin-top:10px;"></div>
        </div>
    `;
    openModal(html);
    // Initialize results with all available global categories
    OL.filterFeatureCategoryAssignment(anlyId, featName, isMaster, "");
};

OL.filterFeatureCategoryAssignment = function(anlyId, featName, isMaster, query) {
    const listEl = document.getElementById("feat-cat-assign-results");
    if (!listEl) return;

    const q = (query || "").toLowerCase().trim();
    
    // 1. Get Unified Categories (Pillars + Analyses)
    const allCats = OL.getGlobalCategories();
    const masterFunctions = (state.master?.functions || []).map(f => (f.name || f).toString());

    let html = "";

    // 🚀 2. ALWAYS SHOW "CREATE NEW" IF TEXT EXISTS (Priority #1)
    const exactMatch = allCats.some(c => c.toLowerCase() === q);
    if (q.length > 0 && !exactMatch) {
        html += `
            <div class="search-result-item create-action" 
                 style="background: rgba(var(--accent-rgb), 0.15) !important; border-bottom: 2px solid var(--accent); margin-bottom: 8px;"
                 onmousedown="OL.executeAddFeature('${anlyId}', '${esc(featName)}', ${isMaster}, '${esc(query)}')">
                <div style="display:flex; align-items:center; gap:8px;">
                    <span class="pill tiny accent" style="background:var(--accent); color:white; font-weight:bold;">+ CREATE NEW</span> 
                    <span style="color:var(--accent);">"${esc(query)}"</span>
                </div>
            </div>`;
    }

    // 🚀 3. FILTER EXISTING MATCHES
    const matches = allCats.filter(c => c.toLowerCase().includes(q));
    
    html += matches.map(cat => {
        const isFunction = masterFunctions.includes(cat);
        return `
            <div class="search-result-item" onmousedown="OL.executeAddFeature('${anlyId}', '${esc(featName)}', ${isMaster}, '${esc(cat)}')">
                <div style="display:flex; justify-content:space-between; align-items:center; width:100%;">
                    <span>${isFunction ? '⚙️' : '📁'} ${esc(cat)}</span>
                    ${isFunction ? '<span class="pill tiny accent" style="font-size:8px;">PILLAR</span>' : ''}
                </div>
            </div>`;
    }).join('');

    // 🚀 4. FINAL RENDER
    if (!html) {
        listEl.innerHTML = '<div class="search-result-item muted">Search or type a new category...</div>';
    } else {
        listEl.innerHTML = html;
    }
};

OL.confirmFeatureWithCategory = function(anlyId, featName, isMaster) {
    const cat = document.getElementById("new-feat-cat-select").value;
    OL.executeAddFeature(anlyId, featName, isMaster, cat);
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

OL.executeEditFeature = function(anlyId, featId, isMaster) {
    const newName = document.getElementById("edit-feat-name").value.trim();
    const newCat = document.getElementById("edit-feat-cat-value").value.trim() || "General";
    const isGlobal = document.getElementById("edit-feat-global").checked;

    if (!newName) { alert("Feature name cannot be empty"); return; }

    const client = getActiveClient();
    const source = isMaster ? state.master.analyses : (client?.projectData?.localAnalyses || []);
    const anly = source.find(a => a.id === anlyId);
    const originalFeat = anly?.features.find(f => f.id === featId);
    const originalName = originalFeat?.name;

    const weightedSort = (features) => {
        features.sort((a, b) => {
            const wA = OL.getCategoryWeight(a.category || "General");
            const wB = OL.getCategoryWeight(b.category || "General");
            if (wA !== wB) return wA - wB; 
            return (a.category || "").localeCompare(b.category || ""); 
        });
    };

    if (originalFeat) {
        // 1. UPDATE THE TARGET INSTANCE
        originalFeat.name = newName;
        originalFeat.category = newCat;
        weightedSort(anly.features);

        // 🚀 2. STRICTLY SCOPED SYNC (The Fix)
        if (isGlobal && originalName) {
            // Determine source based ONLY on where we are currently working
            const targetScope = isMaster 
                ? state.master.analyses 
                : (client?.projectData?.localAnalyses || []);
            
            targetScope.forEach(a => {
                if (!a.features) return;

                // Only update features that match the name within this scope
                a.features.forEach(f => {
                    if (f.name === originalName) {
                        f.name = newName;
                        f.category = newCat;
                    }
                });

                // Deduplicate within the scope to prevent array bloating
                const seenNames = new Set();
                a.features = a.features.filter(f => {
                    if (seenNames.has(f.name)) return false;
                    seenNames.add(f.name);
                    return true;
                });

                weightedSort(a.features);
            });
        }

        OL.persist();
        OL.closeModal();
        OL.openAnalysisMatrix(anlyId, isMaster);
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

OL.executeGlobalFeatureUpdate = function(oldName) {
    const newName = document.getElementById("global-feat-name").value.trim();
    const newCat = document.getElementById("global-feat-cat-search").value.trim() || "General";
    
    // Trigger your existing global rename logic with the 'isGlobal' behavior forced to true
    OL.globalRenameContent('feature', oldName, newName, newCat);
    OL.openGlobalContentManager(); // Return to list
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

OL.globalDeleteContent = function(type, name, isFunction = false) {
    const isVaultMode = window.location.hash.includes('vault');
    
    let msg = isVaultMode 
        ? `Delete "${name}" from the Master Library? (Client projects will not be affected)`
        : `Delete "${name}" from this project only?`;

    if (isFunction && isVaultMode) {
        msg = `⚠️ WARNING: This will permanently remove the "${name}" Master Function from the Vault. Proceed?`;
    }

    if (!confirm(msg)) return;

    // 🛡️ Logic Shift: Determine source based on current view
    const sources = isVaultMode 
        ? [state.master.analyses] 
        : [(getActiveClient()?.projectData?.localAnalyses || [])];

    sources.forEach(analysisList => {
        analysisList.forEach(anly => {
            if (type === 'category') {
                anly.categories = anly.categories?.filter(c => c !== name);
                anly.features?.forEach(f => {
                    if (f.category === name) f.category = "General";
                });
                
                // Only delete from Master Function registry if in Vault Mode
                if (isFunction && isVaultMode) {
                    state.master.functions = state.master.functions.filter(f => f.name !== name);
                }
            } else if (type === 'feature') {
                anly.features = anly.features?.filter(f => f.name !== name);
            }
        });
    });

    OL.persist();
    OL.openGlobalContentManager(); 
    renderAnalysisModule(isVaultMode); 
};

// 4b. MANAGE ADDING / EDITING CATEGORIES
OL.getCategoryWeight = function(catName) {
    const coreLogic = ["GENERAL", "PRICING", "SECURITY", "ARCHITECTURE", "TEAM ACCESS"];
    const normalized = catName.toUpperCase();
    
    const index = coreLogic.indexOf(normalized);
    // If it's in our core list, return its position (0-4), otherwise return a high number
    return index !== -1 ? index : 99; 
};

OL.promptAddCategory = function(anlyId, isMaster) {
    const html = `
        <div class="modal-head"><div class="modal-title-text">📁 Add Global Category</div></div>
        <div class="modal-body">
            <input type="text" class="modal-input" placeholder="Search categories..." 
                   oninput="OL.filterGlobalCategorySearch('${anlyId}', ${isMaster}, this.value)" autofocus>
            <div id="cat-search-results" class="search-results-overlay" style="margin-top:10px;"></div>
        </div>
    `;
    openModal(html);
};

OL.filterGlobalCategorySearch = function(anlyId, isMaster, query) {
    const listEl = document.getElementById("cat-search-results");
    if (!listEl) return;

    const q = (query || "").toLowerCase().trim();
    const allCats = OL.getGlobalCategories();
    const matches = allCats.filter(c => c.toLowerCase().includes(q));

    let html = matches.map(cat => `
        <div class="search-result-item" onclick="OL.executeAddCategoryToAnalysis('${anlyId}', '${esc(cat)}', ${isMaster})">
            📁 ${esc(cat)}
        </div>
    `).join('');

    if (q && !matches.some(m => m.toLowerCase() === q)) {
        html += `
            <div class="search-result-item create-action" onclick="OL.executeAddCategoryToAnalysis('${anlyId}', '${esc(query)}', ${isMaster})">
                <span class="pill tiny accent">+ New</span> Create Category "${esc(query)}"
            </div>
        `;
    }
    listEl.innerHTML = html;
};

OL.filterGlobalManagerCategorySearch = function(query) {
    const listEl = document.getElementById("global-cat-results");
    if (!listEl) return;

    const q = (query || "").toLowerCase().trim();
    const allCats = OL.getGlobalCategories();
    const masterFunctions = (state.master?.functions || []).map(f => (f.name || f).toString());
    
    // 1. Filter existing matches
    const matches = allCats.filter(c => c.toLowerCase().includes(q));

    // 2. Build the HTML string starting with existing matches
    let html = matches.map(cat => {
        const isFunction = masterFunctions.includes(cat);
        return `
            <div class="search-result-item" onmousedown="document.getElementById('global-feat-cat-search').value='${esc(cat)}'; document.getElementById('global-cat-results').innerHTML=''">
                <div style="display:flex; justify-content:space-between; align-items:center; width:100%;">
                    <span>${isFunction ? '⚙️' : '📁'} ${esc(cat)}</span>
                    ${isFunction ? '<span class="pill tiny accent" style="font-size:7px;">PILLAR</span>' : ''}
                </div>
            </div>`;
    }).join('');

    // 🚀 3. THE FIX: If there is text and no exact match, APPEND the "Create New" button to the string
    const exactMatch = matches.some(m => m.toLowerCase() === q);
    if (q.length > 0 && !exactMatch) {
        html += `
            <div class="search-result-item create-action" 
                 style="background: rgba(var(--accent-rgb), 0.15) !important; border-top: 1px solid var(--line); margin-top: 5px;"
                 onmousedown="document.getElementById('global-feat-cat-search').value='${esc(query)}'; document.getElementById('global-cat-results').innerHTML=''">
                <span class="pill tiny accent">+ NEW</span> Create "${esc(query)}"
            </div>
        `;
    }

    // 4. Final Render: Now 'html' will NOT be empty if 'q' has text, so the fallback won't show
    if (!html && !q) {
        listEl.innerHTML = '<div class="search-result-item muted">Start typing to see categories...</div>';
    } else {
        listEl.innerHTML = html || '<div class="search-result-item muted">No categories found</div>';
    }
};

OL.filterEditCategorySearch = function(anlyId, featId, isMaster, query) {
    const listEl = document.getElementById("edit-cat-search-results");
    if (!listEl) return;

    listEl.style.display = "block";
    const q = (query || "").toLowerCase().trim();
    
    // Build Data context
    const allCats = OL.getGlobalCategories();
    const masterFunctions = (state.master?.functions || []).map(f => f.name || f);

    let html = "";

    // 🚀 PRIORITY 1: Force "Create New" if text exists
    if (q.length > 0) {
        html += `
            <div class="search-result-item create-action" 
                 style="background: rgba(var(--accent-rgb), 0.15) !important; border-bottom: 2px solid var(--accent); margin-bottom: 5px;"
                 onmousedown="OL.selectEditCategory('${esc(query)}')">
                <div style="display:flex; align-items:center; gap:8px;">
                    <span class="pill tiny accent" style="background:var(--accent); color:white; font-weight:bold;">+ CREATE NEW</span> 
                    <span style="color:var(--accent);">"${esc(query)}"</span>
                </div>
            </div>`;
    }

    // 🚀 PRIORITY 2: Map existing matches
    const matches = allCats.filter(c => c.toLowerCase().includes(q));
    
    html += matches.map(cat => {
        const isFunction = masterFunctions.includes(cat);
        return `
            <div class="search-result-item" onmousedown="OL.selectEditCategory('${esc(cat)}')">
                <div style="display:flex; justify-content:space-between; align-items:center; width:100%;">
                    <span>${isFunction ? '⚙️' : '📁'} ${esc(cat)}</span>
                    ${isFunction ? '<span class="pill tiny accent" style="font-size:8px;">PILLAR</span>' : ''}
                </div>
            </div>`;
    }).join('');

    // 🚀 PRIORITY 3: Fallback if everything is empty
    if (!html) {
        html = '<div class="search-result-item muted">Search or type a new category...</div>';
    }

    listEl.innerHTML = html;
};

OL.selectEditCategory = function(catName) {
    const searchInput = document.getElementById("edit-feat-cat-search");
    const hiddenInput = document.getElementById("edit-feat-cat-value");
    const resultsEl = document.getElementById("edit-cat-search-results");

    if (searchInput) searchInput.value = catName;
    if (hiddenInput) hiddenInput.value = catName;
    if (resultsEl) resultsEl.style.display = "none";
};

//======================= SCOPING AND PRICING SECTION =======================//

// 1. RENDER SCOPING SHEET TABLE
window.renderScopingSheet = function () {
  OL.registerView(renderScopingSheet);
  const container = document.getElementById("mainContent");
  const client = getActiveClient();
  if (!container || !client) return;

  if (!client.projectData) client.projectData = {};
  if (!client.projectData.localResources) client.projectData.localResources = [];
  if (!client.projectData.scopingSheets) client.projectData.scopingSheets = [{ id: "initial", lineItems: [] }];

  const sheet = client.projectData.scopingSheets[0];
  const baseRate =
    client.projectData.customBaseRate ||
    state.master.rates.baseHourlyRate ||
    300;

  const showUnits = !!state.ui?.showScopingUnits;

  // Normalize rounds → numeric
  const rounds = {};
  sheet.lineItems.forEach((item) => {
    const r = parseInt(item.round, 10) || 1;
    item.round = r;
    if (!rounds[r]) rounds[r] = [];
    rounds[r].push(item);
  });

  const sortedRounds = Object.keys(rounds)
    .map((n) => parseInt(n, 10))
    .sort((a, b) => a - b);

  container.innerHTML = `
    <div class="section-header">
      <div>
        <h2>📊 ${esc(client.meta.name)} Scoping Sheet</h2>
      </div>
      <div class="header-actions">
        <button class="btn small soft" onclick="OL.toggleScopingUnits()">
          ${showUnits ? "👁️ Hide Units" : "👁️ Show Units"}
        </button>
        <button class="btn small soft" onclick="OL.promptCreateResource()">+ Create New Resource</button>
        <button class="btn primary" onclick="OL.addResourceToScope()">+ Add From Library</button>
      </div>
    </div>

    <div class="scoping-grid">
        <div class="grid-row grid-header">
            <div class="col-expand">Deliverable</div>
            <div class="col-status">Status</div>
            <div class="col-team">Applies To</div>
            <div class="col-multiplier" style="text-align:center;">Mult</div>
            <div class="col-gross" style="text-align:center;">Gross</div>
            <div class="col-discount" style="text-align:center;">Disc</div> 
            <div class="col-numeric" style="text-align:right;">Fee</div>
            <div class="col-actions"></div>
        </div>
    </div>

    <div class="rounds-container">
      ${sortedRounds
        .map((r) =>
          renderRoundGroup(
            `Round ${r}`,
            rounds[r],
            baseRate,
            showUnits,
            client.meta.name,
            r,
          ),
        )
        .join("")}
    </div>

    <div id="grand-totals-area"></div>
  `;

  renderGrandTotals(sheet.lineItems, baseRate);
};

// 2. RENDER ROUND GROUPS
// CHANGE THIS:
window.renderRoundGroup = function(roundName, items, baseRate, showUnits, clientName, roundNum) {
    // Note: I added 'baseRate' as the 3rd argument to match your .map call
    
    const client = getActiveClient();
    const sheet = client.projectData.scopingSheets[0];
    
    let roundGross = 0;
    let netAfterLineItems = 0;

    // 1. Sum up the items in THIS round
    items.forEach(item => {
        const res = OL.getResourceById(item.resourceId);
        const isBillable = item.responsibleParty === 'Sphynx' || item.responsibleParty === 'Joint';
        
        if (item.status === 'Do Now' && isBillable) {
            const itemGross = OL.calculateBaseFeeWithMultiplier(item, res);
            const itemNet = OL.calculateRowFee(item, res);
            
            roundGross += itemGross;
            netAfterLineItems += itemNet;
        }
    });

    // 2. Lookup the discount using the now-correct roundNum (6th argument)
    let roundDeductionAmt = 0;
    const rKey = String(roundNum);
    
    if (sheet.roundDiscounts && sheet.roundDiscounts[rKey]) {
        const rDisc = sheet.roundDiscounts[rKey];
        const val = parseFloat(rDisc.value) || 0;
        
        roundDeductionAmt = (rDisc.type === '%') 
            ? Math.round(netAfterLineItems * (val / 100)) 
            : val;
    }

    // 3. Math for the header
    const finalRoundNet = netAfterLineItems - roundDeductionAmt;
    const totalPhaseSavings = (roundGross - netAfterLineItems) + roundDeductionAmt;

    const rows = items.map((item, idx) => renderScopingRow(item, idx, showUnits)).join("");

    return `
        <div class="round-section" style="margin-bottom: 25px; border: 1px solid var(--panel-border); border-radius: 8px; overflow: hidden;">
            <div class="grid-row round-header-row" style="background: rgba(56, 189, 248, 0.1); border-bottom: 1px solid var(--accent);">
                <div class="col-expand">
                    <strong style="color: var(--accent); text-transform: uppercase; font-size: 11px;">${esc(roundName)}</strong>
                </div>
                <div class="col-status"></div>
                <div class="col-team"></div>
                <div class="col-multiplier"></div>
                
                <div class="col-gross tiny muted bold" style="text-align:center; line-height: 1.1;">
                    GROSS<br>$${roundGross.toLocaleString()}
                </div>
                
                <div class="col-discount tiny accent bold" style="text-align:center; line-height: 1.1;">
                    DISC<br>-$${totalPhaseSavings.toLocaleString()}
                </div>
                
                <div class="col-numeric bold" style="color: white; font-size: 12px; text-align:right; line-height: 1.1;">
                    NET<br>$${finalRoundNet.toLocaleString()}
                </div>
                
                <div class="col-actions"></div>
            </div>
            <div class="round-grid">${rows}</div>
        </div>
    `;
};

// 3. RENDER SCOPING ROW / UPDATE ROW
function renderScopingRow(item, idx, showUnits) {
    const client = getActiveClient();
    
    // 1. Resolve Resource using the robust helper
    const res = OL.getResourceById(item.resourceId);

    // 🛡️ SAFETY CHECK: Handle deleted/missing resources
    if (!res) {
        return `
            <div class="grid-row" style="opacity: 0.6; background: rgba(255,0,0,0.05); padding: 8px 10px;">
                <div class="col-expand">
                    <div class="row-title text-danger">⚠️ Missing Resource</div>
                    <div class="tiny muted">Item: ${item.id}</div>
                </div>
                <div class="col-status">N/A</div>
                <div class="col-team">N/A</div>
                <div class="col-multiplier">1.00x</div>
                <div class="col-gross">N/A</div>
                <div class="col-discount">—</div>
                <div class="col-numeric">$0</div>
                <div class="col-actions">
                    <span class="card-close" onclick="OL.removeFromScope('${idx}')">×</span>
                </div>
            </div>
        `;
    }

    // 2. Financial Calculations
    // Only "Do Now" and "Sphynx/Joint" count towards the totals
    const isBillable = item.responsibleParty === 'Sphynx' || item.responsibleParty === 'Joint';
    const isCounted = item.status === 'Do Now' && isBillable;

    const gross = OL.calculateBaseFeeWithMultiplier(item, res);
    const net = isCounted ? OL.calculateRowFee(item, res) : 0;
    const discountAmt = gross - net;

    const combinedData = { ...(res.data || {}), ...(item.data || {}) };
    const unitsHtml = showUnits ? OL.renderUnitBadges(combinedData, res) : "";

    const projectTeam = client?.projectData?.teamMembers || [];
    const mode = (item.teamMode || 'everyone').toLowerCase();

    // 3. Team UI Logic
    let teamLabel = '';
    let btnIcon = '👨🏼‍🤝‍👨🏻';
    let btnClass = 'soft';

    if (mode === 'global') {
        teamLabel = '<span class="tiny muted italic">Global Item</span>';
        btnIcon = '🌎';
        btnClass = 'accent';
    } else if (mode === 'individual') {
        const selectedIds = item.teamIds || []; 
        const selectedCount = selectedIds.length;
        btnIcon = '👨‍💼';
        btnClass = 'primary';
        const names = selectedIds
            .map(id => projectTeam.find(tm => tm.id === id)?.name || "Unknown")
            .filter(n => n !== "Unknown");

        if (selectedCount > 0) {
            teamLabel = `<span class="tiny muted">${selectedCount} Team Member${selectedCount > 1 ? 's' : ''}</span>`;
            hoverText = names.join(", "); // Plain text list for the title attribute
        } else {
            teamLabel = '<span class="tiny danger">No members!</span>';
            hoverText = "Click to assign team members";
        }
    } else {
        const totalCount = projectTeam.length;
        teamLabel = `<span class="tiny muted">Everyone (${totalCount})</span>`;
        hoverText = projectTeam.map(tm => tm.name).join(", ");
    }

    return `
        <div class="grid-row" style="border-bottom: 1px solid var(--line); padding: 8px 10px;">
        <div class="col-expand">
            <div class="row-title is-clickable" onclick="OL.openResourceModal('${res.id}')">
            ${esc(res.name || "Manual Item")}
            </div>
            ${res.notes ? `<div class="row-note">${esc(res.notes)}</div>` : ""}
            ${unitsHtml}
        </div>
      
        <div class="col-status">
            <select class="tiny-select" onchange="OL.updateLineItem('${item.id}', 'status', this.value)">
            <option value="Do Now" ${item.status === "Do Now" ? "selected" : ""}>Do Now</option>
            <option value="Do Later" ${item.status === "Do Later" ? "selected" : ""}>Do Later</option>
            <option value="Done" ${item.status === "Done" ? "selected" : ""}>Done</option>
            </select>
            <select class="tiny-select" style="margin-top:4px" onchange="OL.updateLineItem('${item.id}', 'responsibleParty', this.value)">
            <option value="Sphynx" ${item.responsibleParty === "Sphynx" ? "selected" : ""}>Sphynx</option>
            <option value="${esc(client.meta.name)}" ${item.responsibleParty === client.meta.name ? "selected" : ""}>${esc(client.meta.name)}</option>
            <option value="Joint" ${item.responsibleParty === "Joint" ? "selected" : ""}>Joint</option>
            </select>
        </div>

        <div class="col-team">
            <div style="display:flex; align-items:center; gap:8px;">
                <button class="btn tiny ${btnClass}" onclick="OL.openTeamAssignmentModal('${item.id}')" style="padding: 2px 6px; min-width: 28px;">
                    ${btnIcon}
                </button>
                <div class="pills-row" style="cursor:pointer;" onclick="OL.openTeamAssignmentModal('${item.id}')">
                    ${teamLabel}
                </div>
            </div>
        </div>

        <div class="col-multiplier">${OL.getMultiplierDisplay(item)}</div>

        <div class="col-gross tiny muted" style="text-align:center;">
            $${gross.toLocaleString()}
        </div>

        <div class="col-discount">
            ${discountAmt > 0 ? `
                <span class="tiny muted" onclick="OL.openDiscountManager()" style="padding: 2px 4px; font-size: 9px;">
                    -$${discountAmt.toLocaleString()}
                </span>
            ` : '<span class="tiny muted" style="opacity:0.2;">—</span>'}
        </div>

        <div class="col-numeric">
            <div class="bold" style="color: white; font-size: 13px;">$${net.toLocaleString()}</div>
        </div>

        <div class="col-actions">
            <button class="card-delete-btn" style="opacity: 0.3; font-size: 16px;" onclick="OL.removeFromScope('${idx}')">×</button>
        </div>
    </div>
  `;
}

OL.openTeamAssignmentModal = function (itemId) {
    const client = getActiveClient();
    const item = client.projectData.scopingSheets[0].lineItems.find(i => i.id === itemId);
    const team = client.projectData.teamMembers || [];

    if (!item.teamIds) item.teamIds = [];

    let html = `
        <div class="modal-head">
            <div class="modal-title-text">👥 Assign Team to Item</div>
            <button class="btn small soft" onclick="OL.closeModal()">Done</button>
        </div>
        <div class="modal-body">
            <p class="tiny muted" style="margin-bottom:15px;">
                Selecting individual members will apply a multiplier based on the group size.
            </p>
            <div class="dp-manager-list">
                ${team.map(m => {
                    const isAssigned = item.teamIds.includes(m.id);
                    return `
                        <div class="dp-manager-row is-clickable" 
                             style="display:flex; justify-content:space-between; align-items:center; padding:10px; border-bottom:1px solid var(--line);"
                             onclick="OL.toggleTeamAssignment('${itemId}', '${m.id}')">
                            <div style="display:flex; align-items:center; gap:10px;">
                                <span>${isAssigned ? '✅' : '⬜'}</span>
                                <span style="${isAssigned ? 'font-weight:bold; color:var(--accent);' : ''}">${esc(m.name)}</span>
                            </div>
                            <span class="tiny muted uppercase">${esc(m.roles?.[0] || 'Member')}</span>
                        </div>
                    `;
                }).join('')}
                ${team.length === 0 ? '<div class="empty-hint">No project team members found. Add them in the Team tab first.</div>' : ''}
            </div>
            
            <div style="margin-top:20px; padding-top:15px; border-top:1px solid var(--line); display:flex; gap:10px;">
                <button class="btn tiny soft flex-1" onclick="OL.setTeamMode('${itemId}', 'everyone')">Apply to Everyone</button>
                <button class="btn tiny soft flex-1" onclick="OL.setTeamMode('${itemId}', 'global')">Mark as Global (1x)</button>
            </div>
        </div>
    `;
    openModal(html);
};

// Helper to quickly switch modes from the modal
OL.setTeamMode = function(itemId, mode) {
    const client = getActiveClient();
    const item = client.projectData.scopingSheets[0].lineItems.find(i => i.id === itemId);
    if (item) {
        item.teamMode = mode;
        if (mode === 'everyone') item.teamIds = []; 
        OL.persist();
        OL.closeModal();
        renderScopingSheet();
    }
};

OL.updateLineItem = function(itemId, field, value) {
    const client = getActiveClient();
    if (!client) return;

    const sheet = client.projectData.scopingSheets[0];
    const item = sheet.lineItems.find(i => i.id === itemId);

    if (item) {
        if (field === 'round') {
            item[field] = parseInt(value, 10) || 1;
        } else {
            item[field] = value;
        }

        // 🚀 THE ENGINE: Deploy requirements when marked as "Do Now"
        if (field === 'status' && value === 'Do Now') {
            OL.deployRequirementsFromResource(item.resourceId);
        }
        
        OL.persist(); // Save change to storage
        renderScopingSheet(); // Refresh the sheet
        
        console.log(`✅ Item ${itemId} updated. Engine check: ${field === 'status' && value === 'Do Now' ? 'DEPLOYED' : 'SKIP'}`);
    }
};

// 4. HANDLE UNIT BADGE SHOW/HIDE BUTTON AND TAGS
OL.toggleScopingUnits = function () {
  if (!state.ui) state.ui = {};
  state.ui.showScopingUnits = !state.ui.showScopingUnits;

  OL.persist();
  renderScopingSheet();
};

// 74. HARDENED UNIT BADGE RENDERER
OL.renderUnitBadges = function (dataObject, res) {
    if (!state.ui?.showScopingUnits) return "";
    if (!dataObject || Object.keys(dataObject).length === 0) return "";

    const vars = state.master.rates.variables || {};
    const normalize = (s) => String(s || "").toLowerCase().replace(/\s+/g, "").trim();
    const resTypeKey = normalize(res?.type);

    const badges = Object.entries(dataObject)
        .filter(([varId, count]) => {
            const v = vars[varId];
            return v && count > 0 && normalize(v.applyTo) === resTypeKey;
        })
        .map(([varId, count]) => {
            const v = vars[varId];
            return `<span class="unit-tag">${count} ${esc(v.label)}</span>`;
        })
        .join("");

    return badges ? `<div class="unit-badge-container">${badges}</div>` : "";
};

// 5. ADD ITEM TO SCOPING SHEET FROM MASTER LIBRARY
OL.addResourceToScope = function () {
    const html = `
        <div class="modal-head">
            <div class="modal-title-text">🔎 Add Resource to Scope</div>
            <div class="spacer"></div>
            <button class="btn small soft" onclick="OL.closeModal()">Cancel</button>
        </div>
        <div class="modal-body">
            <div class="search-map-container">
                <input type="text" class="modal-input" 
                       placeholder="Click to view library or search..." 
                       onfocus="OL.filterResourceForScope('')"  // 🚀 THE FIX: Opens list immediately
                       oninput="OL.filterResourceForScope(this.value)" 
                       autofocus>
                <div id="scope-search-results" class="search-results-overlay" style="margin-top:15px;"></div>
            </div>
        </div>
    `;
    openModal(html);
};

OL.removeFromScope = async function(index) {
    if (!confirm("Remove this item?")) return;
    const client = getActiveClient();
    
    // 1. Physically remove from the array
    client.projectData.scopingSheets[0].lineItems.splice(index, 1);
    
    // 2. FORCE a full sync and WAIT for it to finish
    await OL.persist();
    
    // 3. ONLY THEN refresh the view
    renderScopingSheet();
};

OL.filterResourceForScope = function (query) {
    const listEl = document.getElementById("scope-search-results");
    if (!listEl) return;

    const q = (query || "").toLowerCase().trim();
    const client = getActiveClient();
    
    // 1. Get current IDs already on the scoping sheet to hide them
    const existingIds = (client?.projectData?.scopingSheets?.[0]?.lineItems || []).map(i => i.resourceId);

    // 2. Identify and Tag Sources
    const masterSource = (state.master.resources || []).map(r => ({ ...r, origin: 'Master' }));
    const localSource = (client?.projectData?.localResources || []).map(r => ({ ...r, origin: 'Local' }));
    
    // 🚀 THE DEDUPLICATION FIX:
    // Create a list of IDs that are already "cloned" into the local project
    const localMasterRefs = localSource.map(r => r.masterRefId);
    
    // Filter the Master source so it only shows items NOT yet cloned locally
    const filteredMaster = masterSource.filter(m => !localMasterRefs.includes(m.id));

    // Combine local items with only the "un-cloned" master items
    const combined = [...localSource, ...filteredMaster];

    // 3. Filter for search term AND exclude items ALREADY on the scoping sheet
    const matches = combined.filter((res) => {
        const nameMatch = res.name.toLowerCase().includes(q);
        const alreadyInScope = existingIds.includes(res.id);
        return nameMatch && !alreadyInScope;
    });

    // 4. Split into Groups for rendering
    const masterMatches = matches.filter(m => m.origin === 'Master').sort((a,b) => a.name.localeCompare(b.name));
    const localMatches = matches.filter(m => m.origin === 'Local').sort((a,b) => a.name.localeCompare(b.name));

    let html = "";

    // 🏗️ Render Local Group (Items already in project library)
    if (localMatches.length > 0) {
        html += `<div class="search-group-header">📍 Available in Project</div>`;
        html += localMatches.map(res => renderResourceSearchResult(res, 'local')).join('');
    }

    // 🏛️ Render Master Group (Standard templates not yet used in this project)
    if (masterMatches.length > 0) {
        html += `<div class="search-group-header" style="margin-top:10px;">🏛️ Master Vault Standards</div>`;
        html += masterMatches.map(res => renderResourceSearchResult(res, 'vault')).join('');
    }

    if (matches.length === 0) {
        html = `<div class="search-result-item muted">No unlinked resources match "${esc(query)}"</div>`;
    }

    listEl.innerHTML = html;
};

function renderResourceSearchResult(res, tagClass) {
    return `
        <div class="search-result-item" onmousedown="OL.executeScopeAdd('${res.id}')">
            <div style="display:flex; justify-content:space-between; align-items:center; width: 100%;">
                <div style="display:flex; align-items:center; gap:8px;">
                    <span>🛠️</span>
                    <div>
                        <div style="font-size: 13px; font-weight: 500;">${esc(res.name)}</div>
                        <div class="tiny muted">${esc(res.type || "General")}</div>
                    </div>
                </div>
                <span class="pill tiny ${tagClass}">${tagClass.toUpperCase()}</span>
            </div>
        </div>
    `;
}

OL.executeScopeAdd = async function (resId) {
    const client = getActiveClient();
    if (!client) return;

    let finalResourceId = resId;

    // 🚀 STEP 1: Handle Auto-Cloning to Library
    if (resId.startsWith('res-vlt-')) {
        const template = state.master.resources.find(r => r.id === resId);
        if (template) {
            // Check if we already have this specific master item in our local project
            const existingLocal = (client.projectData.localResources || [])
                .find(r => r.masterRefId === resId);

            if (existingLocal) {
                finalResourceId = existingLocal.id;
            } else {
                // DEEP CLONE: Make a permanent project-specific copy
                const newRes = JSON.parse(JSON.stringify(template));
                newRes.id = 'local-prj-' + Date.now() + Math.random().toString(36).substr(2, 5);
                newRes.masterRefId = resId; // Essential for the "Sync" logic
                
                if (!client.projectData.localResources) client.projectData.localResources = [];
                client.projectData.localResources.push(newRes);
                finalResourceId = newRes.id;
            }
        }
    }

    // 🚀 STEP 2: Add to Scoping Sheet
    const newItem = {
        id: 'li-' + Date.now(),
        resourceId: finalResourceId, 
        status: "Do Now",
        responsibleParty: "Sphynx",
        round: 1,
        teamMode: "everyone", 
        teamIds: [],
        data: {},
        manualHours: 0
    };

    if (!client.projectData.scopingSheets) client.projectData.scopingSheets = [{id: 'initial', lineItems: []}];
    client.projectData.scopingSheets[0].lineItems.push(newItem);

    // 🚀 STEP 3: PERSIST BOTH ARRAYS
    await OL.persist();
    
    OL.closeModal();
    renderScopingSheet(); 
};

// 6. ADD CUSTOM ITEM TO SCOPING SHEET

// 7. STATUS AND RESPONSIBLE PARTY

// 8. TEAM ASSIGNMENT FOR SCOPING ITEM
OL.cycleTeamMode = function(itemId) {
    const client = getActiveClient();
    const item = client.projectData.scopingSheets[0].lineItems.find(i => i.id === itemId);
    if (!item) return;

    // Define the cycle: everyone -> individual -> global -> back to everyone
    const modes = ['everyone', 'individual', 'global'];
    let currentIdx = modes.indexOf(item.teamMode || 'everyone');
    item.teamMode = modes[(currentIdx + 1) % modes.length];

    OL.persist();
    renderScopingSheet();
};

// 9. MULTIPLIER DISPLAY
OL.getMultiplierDisplay = function (item) {
  const client = getActiveClient();
  const rate = parseFloat(state.master.rates.teamMultiplier) || 1.1;
  
  // 🚀 HARDENING: Force lowercase and provide strict fallback
  const mode = (item.teamMode || "everyone").toLowerCase();

  if (mode === "global") {
    return `<span class="tiny muted" style="letter-spacing:0.5px;">GLOBAL</span><br><span class="text-dim">1.00x</span>`;
  }

  let count = 0;
  // Check for 'individual' OR if there are specific IDs present
  if (mode === "individual" || (item.teamIds && item.teamIds.length > 0)) {
    count = (item.teamIds || []).length;
  } else {
    count = (client?.projectData?.teamMembers || []).length || 1;
  }
  
  // ✅ THE FORMULA: 1 + ((count - 1) * (rate - 1))
  // If rate is 1.1, (rate - 1) is 0.1
  const incrementalRate = rate - 1;
  const additionalMembers = Math.max(0, count - 1);
  const displayMult = 1 + additionalMembers * incrementalRate;

  const label = mode === "individual" ? "TEAM" : "EVERYONE";
  const isIncremented = additionalMembers > 0;
  const color = isIncremented ? "var(--accent)" : "var(--text-dim)";

  return `
    <span class="tiny muted" style="letter-spacing:0.5px;">${label}</span><br>
    <span style="color: ${color}; font-weight: ${isIncremented ? "600" : "400"};">
        ${displayMult.toFixed(2)}x
    </span>
  `;
};

// 10. FEE CALCULATION
// Net Calculation (Line Item Level)
OL.calculateRowFee = function(item, resource) {
    const gross = OL.calculateBaseFeeWithMultiplier(item, resource);
    return OL.applyDiscount(gross, item.discountValue, item.discountType);
};

// Alias for consistency in older renderers
// Function to calculate the "Sticker Price" before line-item discounts
OL.calculateBaseFeeWithMultiplier = function(item, resource) {
    if (!item) return 0;
    const vars = state.master.rates.variables || {};
    
    // Merge template data and local overrides
    let calcData = { ...(resource?.data || {}), ...(item.data || {}) };
    
    let baseAmount = 0;
    let hasTechnicalData = false;

    // Calculate via technical variables
    Object.entries(calcData).forEach(([varId, count]) => {
        const v = vars[varId];
        const numCount = parseFloat(count) || 0;
        if (v && numCount > 0 && v.applyTo === resource?.type) {
            baseAmount += numCount * (parseFloat(v.value) || 0);
            hasTechnicalData = true;
        }
    });

    // Fallback to hourly if no technical units exist
    if (!hasTechnicalData) {
        const client = getActiveClient();
        const baseRate = client?.projectData?.customBaseRate || state.master.rates.baseHourlyRate || 300;
        baseAmount = (parseFloat(item.manualHours) || 0) * baseRate;
    }

    // Apply Team Multiplier
    let multiplier = 1.0;
    const mode = (item.teamMode || 'everyone').toLowerCase();
    if (mode !== 'global') {
        const rate = parseFloat(state.master.rates.teamMultiplier) || 1.1;
        const inc = rate - 1;
        const count = mode === 'individual' ? (item.teamIds || []).length : (getActiveClient()?.projectData?.teamMembers || []).length || 1;
        multiplier = 1 + (Math.max(0, count - 1) * inc);
    }

    return Math.round(baseAmount * multiplier);
};


// 11. GRAND TOTALS SUMMARY
window.renderGrandTotals = function(lineItems, baseRate) {
    const area = document.getElementById("grand-totals-area");
    const client = getActiveClient();
    const sheet = client?.projectData?.scopingSheets?.[0];
    if (!area || !client || !sheet) return;

    let totalGross = 0;
    let netAfterLineItems = 0;

    // 1. Calculate base totals
    lineItems.forEach(item => {
        const res = OL.getResourceById(item.resourceId);
        const isBillable = item.responsibleParty === 'Sphynx' || item.responsibleParty === 'Joint';
        
        if (item.status === 'Do Now' && isBillable) {
            totalGross += OL.calculateBaseFeeWithMultiplier(item, res);
            netAfterLineItems += OL.calculateRowFee(item, res);
        }
    });

    // 2. Subtract Round Discounts
    let netAfterRounds = netAfterLineItems;
    if (sheet.roundDiscounts) {
        Object.keys(sheet.roundDiscounts).forEach(rNum => {
            const rDisc = sheet.roundDiscounts[rNum];
            const roundItems = lineItems.filter(i => i.round == rNum && i.status === 'Do Now');
            const roundSubtotal = roundItems.reduce((s, i) => s + OL.calculateRowFee(i, OL.getResourceById(i.resourceId)), 0);
            const rDeduct = rDisc.type === '%' 
                ? Math.round(roundSubtotal * (parseFloat(rDisc.value) / 100)) 
                : parseFloat(rDisc.value) || 0;
            netAfterRounds -= rDeduct;
        });
    }

    // 3. Subtract Global Project Discount
    const gVal = client.projectData.totalDiscountValue || 0;
    const gType = client.projectData.totalDiscountType || '$';
    const globalAdjustment = gType === '%' ? Math.round(netAfterRounds * (gVal / 100)) : Math.min(netAfterRounds, gVal);
    const finalApproved = netAfterRounds - globalAdjustment;

    // 4. Calculate total delta for the "Adjustments" column
    const totalAdjustments = totalGross - finalApproved;

    area.innerHTML = `
    <div class="grand-totals-bar">
      <div class="grand-actions">
        <button class="btn tiny soft" onclick="window.print()">🖨️ PDF</button>
        <button class="btn tiny accent" onclick="OL.openDiscountManager()">🏷️ Adjustments</button>
      </div>

      <div class="total-item-gross">
        <div class="tiny muted uppercase bold">Gross</div>
        <div style="font-size: 14px; font-weight: 600;">$${totalGross.toLocaleString()}</div>
      </div>

      <div class="total-item-disc">
        <div class="tiny accent uppercase bold">Adjustments</div>
        <div class="accent" style="font-size: 14px; font-weight: 600;">-$${totalAdjustments.toLocaleString()}</div>
      </div>

      <div class="total-item-net">
        <div class="tiny muted uppercase bold" style="color: var(--accent);">Final Approved</div>
        <div style="font-size: 22px; font-weight: 900; color: #fff; line-height: 1;">$${finalApproved.toLocaleString()}</div>
        <div class="tiny muted" style="margin-top: 2px;">
          (${(finalApproved / baseRate).toFixed(1)}h)
        </div>
      </div>
      
      <div></div>
    </div>
  `;
};

// 12. DISCOUNT MANAGEMENT
window.renderDiscountInput = function (level, id, value, type) {
  return `
    <div class="discount-control">
      <input type="number" class="tiny-input"
        value="${Number(value) || 0}"
        oninput="OL.updateDiscount('${level}', '${id}', 'value', this.value)">
      <div class="toggle-group">
        <button class="toggle-btn ${type === "$" ? "active" : ""}"
          onclick="OL.updateDiscount('${level}', '${id}', 'type', '$')">$</button>
        <button class="toggle-btn ${type === "%" ? "active" : ""}"
          onclick="OL.updateDiscount('${level}', '${id}', 'type', '%')">%</button>
      </div>
    </div>
  `;
};

OL.openDiscountManager = function () {
  const client = getActiveClient();
  const sheet = client?.projectData?.scopingSheets?.[0];
  if (!client || !sheet) return;

  const allRes = [
    ...(state.master.resources || []),
    ...(client.projectData.localResources || []),
  ];

  // Build rounds with billable items only
  const rounds = {};
  sheet.lineItems.forEach((item) => {
    if (
      item.status === "Do Now" &&
      (item.responsibleParty === "Sphynx" || item.responsibleParty === "Joint")
    ) {
      const r = item.round || 1;
      if (!rounds[r]) rounds[r] = [];
      rounds[r].push(item);
    }
  });

  let html = `
    <div class="modal-head">
      <div class="modal-title-text">💰 Financial Adjustments</div>
      <button class="btn tiny soft"
        onclick="if(confirm('Clear all discounts?')) OL.clearAllDiscounts()">
        🔄 Reset
      </button>
    </div>

    <div class="modal-body" style="max-height:75vh; overflow:auto;">
  `;

  Object.keys(rounds)
    .sort((a, b) => a - b)
    .forEach((rNum) => {
      const items = rounds[rNum];
      let roundGross = 0;
      let itemDeductions = 0;

      html += `
      <div class="card-section" style="margin-bottom:25px;">
        <label class="modal-section-label">ROUND ${rNum}</label>
    `;

      items.forEach((item) => {
        const res = allRes.find((r) => r.id === item.resourceId);
        const gross = OL.calculateBaseFeeWithMultiplier(item, res);
        const net = OL.calculateRowFee(item, res);
        const deduct = gross - net;

        roundGross += gross;
        itemDeductions += deduct;

        html += `
        <div class="discount-row">
          <div class="tiny">${esc(res?.name || "Manual Item")}</div>
          <div class="tiny muted">$${gross.toLocaleString()}</div>
          ${renderDiscountInput(
            "item",
            item.id,
            item.discountValue || 0,
            item.discountType || "$",
          )}
        </div>
      `;
      });

      const rDisc = sheet.roundDiscounts?.[rNum] || { value: 0, type: "$" };
      const netAfterItems = roundGross - itemDeductions;

      html += `
        <div class="divider"></div>

        <div class="discount-row">
          <span class="tiny muted">Item Discounts</span>
          <span class="tiny accent">-$${itemDeductions.toLocaleString()}</span>
        </div>

        <div class="discount-row">
          <span class="tiny muted">Round Discount</span>
          ${renderDiscountInput("round", rNum, rDisc.value, rDisc.type)}
        </div>
      </div>
    `;
    });

  const gVal = client.projectData.totalDiscountValue || 0;
  const gType = client.projectData.totalDiscountType || "$";

  html += `
      <div class="card-section">
        <label class="modal-section-label">GLOBAL DISCOUNT</label>
        ${renderDiscountInput("total", "global", gVal, gType)}
      </div>
    </div>

    <div class="modal-foot">
      <button class="btn primary full"
        onclick="OL.closeModal(); renderScopingSheet();">
        Apply Adjustments
      </button>
    </div>
  `;

  openModal(html);
};

OL.updateDiscount = function (level, id, field, value) {
  const client = getActiveClient();
  const sheet = client?.projectData?.scopingSheets?.[0];
  if (!client || !sheet) return;

  if (level === "item") {
    const item = sheet.lineItems.find((i) => i.id === id);
    if (!item) return;
    if (field === "value") item.discountValue = parseFloat(value) || 0;
    if (field === "type") item.discountType = value;
  }

  if (level === "round") {
    if (!sheet.roundDiscounts) sheet.roundDiscounts = {};
    const rKey = String(id); // Force string key
    if (!sheet.roundDiscounts[rKey]) {
        sheet.roundDiscounts[rKey] = { value: 0, type: "$" };
    }
    if (field === "value")
      sheet.roundDiscounts[id].value = parseFloat(value) || 0;
    if (field === "type") sheet.roundDiscounts[id].type = value;
  }

  if (level === "total") {
    if (field === "value")
      client.projectData.totalDiscountValue = parseFloat(value) || 0;
    if (field === "type") client.projectData.totalDiscountType = value;
  }

  OL.persist();

  // Refresh both contexts safely
  OL.refreshDiscountManagerUI();
  renderScopingSheet();
};

OL.refreshDiscountManagerUI = function () {
  const client = getActiveClient();
  const sheet = client?.projectData?.scopingSheets?.[0];
  if (!client || !sheet) return;

  const allRes = [
    ...(state.master.resources || []),
    ...(client.projectData.localResources || []),
  ];

  let gross = 0;
  let deductions = 0;

  sheet.lineItems.forEach((item) => {
    if (
      item.status !== "Do Now" ||
      (item.responsibleParty !== "Sphynx" && item.responsibleParty !== "Joint")
    )
      return;

    const res = allRes.find((r) => r.id === item.resourceId);
    const g = OL.calculateBaseFeeWithMultiplier(item, res);
    const n = OL.calculateRowFee(item, res);

    gross += g;
    deductions += g - n;
  });

  const netPreGlobal = gross - deductions;
  const gVal = client.projectData.totalDiscountValue || 0;
  const gType = client.projectData.totalDiscountType || "$";
  const gDeduct =
    gType === "%"
      ? Math.round(netPreGlobal * (gVal / 100))
      : Math.min(netPreGlobal, gVal);

  const final = gross - deductions - gDeduct;

  const elGross = document.getElementById("summary-gross-total");
  const elDeduct = document.getElementById("summary-total-deductions");
  const elFinal = document.getElementById("summary-final-total");

  if (elGross) elGross.textContent = `$${gross.toLocaleString()}`;
  if (elDeduct)
    elDeduct.textContent = `-$${(deductions + gDeduct).toLocaleString()}`;
  if (elFinal) elFinal.textContent = `$${final.toLocaleString()}`;
};

OL.applyDiscount = function (amount, value, type) {
  const v = parseFloat(value) || 0;
  if (v <= 0) return amount;

  if (type === "%") {
    return Math.round(amount * (1 - v / 100));
  }

  // "$"
  return Math.max(0, Math.round(amount - v));
};

OL.clearAllDiscounts = function () {
  const client = getActiveClient();
  const sheet = client?.projectData?.scopingSheets?.[0];
  if (!client || !sheet) return;

  client.projectData.totalDiscountValue = 0;
  client.projectData.totalDiscountType = "$";
  sheet.roundDiscounts = {};

  sheet.lineItems.forEach((item) => {
    delete item.discountValue;
    delete item.discountType;
  });

  OL.persist();
  renderScopingSheet();
};

// 13. PRICING FOLDER MODAL
OL.openTypeDetailModal = function (typeKey) {
  const registry = state.master.resourceTypes || [];
  const typeData = registry.find(
    (r) => r.type === typeKey || r.typeKey === typeKey,
  );
  const variables = state.master.rates.variables || {};
  const relevantVars = Object.entries(variables).filter(
    ([_, v]) => v.applyTo === typeKey,
  );

  const html = `
        <div class="modal-head">
            <div class="modal-title-text">⚙️ Pricing Folder: ${esc(typeData?.type || typeKey)}</div>
        </div>
        <div class="modal-body">
            <label class="modal-section-label">Active Rates</label>
            <div class="dp-manager-list" style="margin-bottom: 25px;">
                ${relevantVars.map(([key, v]) => `
                    <div class="dp-manager-row" style="display:flex; align-items:center; gap:12px; padding: 10px 10px; border-bottom: 1px solid var(--line);">
                        <div style="flex:1">
                            <div contenteditable="true" 
                                class="bold" 
                                style="cursor: text; outline:none;"
                                onblur="OL.updateVarRate('${key}', 'label', this.innerText)">
                                ${esc(v.label)}
                            </div>
                            <div class="tiny muted" style="font-family: monospace; opacity: 0.5;">ID: ${key}</div>
                        </div>
                        
                        <div style="display:flex; align-items:center; gap:8px;">
                            <div style="display:flex; align-items:center; background: rgba(255,255,255,0.05); padding: 2px 8px; border-radius: 4px; border: 1px solid var(--line);">
                                <span class="tiny muted" style="margin-right:4px;">$</span>
                                <input type="number" class="modal-input tiny" value="${v.value}" 
                                      style="width:60px; border:none; background:transparent; color: white; text-align:right;"
                                      onblur="OL.updateVarRate('${key}', 'value', this.value)">
                            </div>
                            
                            <button class="card-delete-btn" 
                                    style="position:static; opacity: 0.3;" 
                                    onmouseover="this.style.opacity=1" 
                                    onmouseout="this.style.opacity=0.3"
                                    onclick="OL.removeScopingVariable('${key}', '${typeKey}')">
                                ×
                            </button>
                        </div>
                    </div>
                `).join("")}
                ${relevantVars.length === 0 ? '<div class="empty-hint">No variables yet.</div>' : ""}
            </div>

            <label class="modal-section-label">Create New Variable</label>
            <div class="search-map-container">
                <input type="text" class="modal-input" placeholder="Enter label (e.g. Per Segment)..." 
                       onkeydown="if(event.key==='Enter'){ OL.createNewVarForType(this.value, '${typeKey}'); this.value=''; }">
                <div class="tiny muted" style="margin-top:5px;">Press Enter to save.</div>
            </div>
        </div>
    `;
  openModal(html);
};

OL.createNewVarForType = function (label, typeKey) {
    const safeTypeKey = (typeKey || "general").toLowerCase().trim();
    const varKey = label.toLowerCase().replace(/[^a-z0-9]+/g, "") + "_" + Date.now().toString().slice(-4);
    
    if (!state.master.rates.variables) state.master.rates.variables = {};

    state.master.rates.variables[varKey] = {
        label,
        value: 0,
        applyTo: typeKey, // Match exactly what the folder is using
        archetype: "Base",
    };

    OL.persist();
    
    // 1. Refresh the Modal to show the new row
    OL.openTypeDetailModal(typeKey); 
    
    // 2. 🚀 Refresh the Background Page to update the "X variables defined" count on the card
    renderVaultRatesPage(); 
};

OL.updateVarRate = async function (key, field, val) {
    if (state.master.rates.variables[key]) {
        // 1. Update the local memory variable only
        state.master.rates.variables[key][field] = field === "value" ? parseFloat(val) || 0 : val.trim();
        
        // 2. Perform a "Surgical Save"
        // Instead of saving the whole state, we just tell Firebase to update this one key
        const updatePath = `master.rates.variables.${key}`;
        try {
            await db.collection('systems').doc('main_state').update({
                [updatePath]: state.master.rates.variables[key]
            });
            console.log("🎯 Surgical Rate Update Successful.");
            renderVaultRatesPage();
        } catch (e) {
            // Fallback to full persist if update fails
            await OL.persist();
        }
    }
};

OL.removeScopingVariable = function(varKey, typeKey) {
    if (!confirm("Are you sure you want to delete this pricing variable? This will remove it from all resources using this type.")) return;

    if (state.master.rates.variables && state.master.rates.variables[varKey]) {
        // 1. Delete from data
        delete state.master.rates.variables[varKey];
        
        OL.persist();

        // 2. Refresh the background grid (the folder cards)
        if (window.location.hash.includes('vault/rates')) {
            renderVaultRatesPage();
        }

        // 3. Refresh the modal to show the updated list
        OL.openTypeDetailModal(typeKey);
        
        console.log(`🗑️ Variable ${varKey} removed.`);
    }
};

//======================= SCOPING-TASKS OVERLAP ========================//

//======================= TEAM MANAGEMENT SECTION =======================//

// 1. RENDER TEAM GRID
window.renderTeamManager = function () {
  OL.registerView(renderTeamManager);
  const container = document.getElementById("mainContent");
  const client = getActiveClient();
  if (!client || !container) return;

  // Ensure the data structure exists
  if (!client.projectData.teamMembers) client.projectData.teamMembers = [];
  const members = client.projectData.teamMembers;

  const memberCardsHtml = members
    .map((m) => {
      // Handle the multi-role display logic here
      const rolesHtml = (m.roles || []).length
        ? m.roles
            .map(
              (r) =>
                `<span class="pill tiny soft" style="font-size: 8px;">${esc(r)}</span>`,
            )
            .join("")
        : `<span class="tiny muted uppercase">${esc(m.role || "Contributor")}</span>`;

      return `
           <div class="card is-clickable" onclick="OL.openTeamMemberModal('${m.id}')">
              <div class="card-header">
                  <div class="card-title tm-card-title-${m.id}">${esc(m.name)}</div>
                  <button class="card-delete-btn" onclick="event.stopPropagation(); OL.removeTeamMember('${m.id}')">×</button>
              </div>
              <div class="card-body">
                  <div class="pills-row" style="margin-top: 5px; display: flex; flex-wrap: wrap; gap: 4px;">
                      ${rolesHtml}
                  </div>
              </div>
          </div>
      `;
    })
    .join("");

  container.innerHTML = `
        <div class="section-header">
            <div>
                <h2>👬 Team Members</h2>
                <div class="small muted subheader">Manage members assigned to ${esc(client.meta.name)}</div>
            </div>
            <button class="btn primary" onclick="OL.promptAddTeamMember()">+ Add Member</button>
        </div>

        <div class="cards-grid">
            ${memberCardsHtml}
            ${members.length === 0 ? '<div class="empty-hint">No team members added yet.</div>' : ""}
        </div>
    `;
};

// 2. ADD, UPDATE, REMOVE TEAM MEMBERS
OL.promptAddTeamMember = function () {
    const draftId = 'draft-tm-' + Date.now();
    const draftMember = {
        id: draftId,
        name: "",
        roles: [],
        isDraft: true
    };
    
    // Trigger the modal directly with the draft object
    OL.openTeamMemberModal(draftId, draftMember);
};

OL.handleTeamMemberSave = function(id, name) {
    const cleanName = name.trim();
    if (!cleanName) return; 

    const client = getActiveClient();
    const isDraft = id.startsWith('draft-tm-');

    if (isDraft) {
        // 🚀 1. CREATE the ID first so it can be referenced
        const newId = 'tm-' + Date.now(); 
        
        const newMember = {
            id: newId,
            name: cleanName,
            roles: [], 
            createdDate: new Date().toISOString()
        };

        // 2. Add to projectData safely
        if (!client.projectData.teamMembers) client.projectData.teamMembers = [];
        client.projectData.teamMembers.push(newMember);

        OL.persist(); // Save to Firebase
        renderTeamManager(); // Update background grid
        
        // 🚀 3. RELOAD modal with the permanent ID
        // This stops the "ReferenceError" by using the variable we just created
        OL.openTeamMemberModal(newId);
        
    } else {
        // Handle standard rename for existing members
        const member = client?.projectData?.teamMembers.find(m => m.id === id);
        if (member) {
            member.name = cleanName;
            OL.persist();
        }
    }
};

OL.updateTeamMember = function (memberId, field, value) {
  const client = getActiveClient();
  const member = client?.projectData?.teamMembers.find(
    (m) => m.id === memberId,
  );

  if (member) {
    member[field] = value.trim();
    OL.persist();
    renderTeamManager(); // Refresh the grid behind the modal
  }
};

OL.removeTeamMember = function (memberId) {
  if (!confirm("Remove this team member?")) return;
  const client = getActiveClient();
  client.projectData.teamMembers = client.projectData.teamMembers.filter(
    (m) => m.id !== memberId,
  );
  OL.persist();
  renderTeamManager();
};

// 3. OPEN TEAM MEMBER MODAL
OL.openTeamMemberModal = function (memberId, draftObj = null) {
    const client = getActiveClient();
    
    // 1. Resolve Data: Use draft if provided, otherwise find in client data
    let member = draftObj;
    if (!member) {
        member = client?.projectData?.teamMembers.find(m => m.id === memberId);
    }
    
    if (!member) return;

    // Ensure roles is initialized as an array
    if (!Array.isArray(member.roles)) {
        member.roles = member.role ? [member.role] : [];
    }

    const html = `
        <div class="modal-head" style="gap:15px;">
            <div style="display:flex; align-items:center; gap:10px; flex:1;">
                <span style="font-size:18px;">👨‍💼</span>
                <input type="text" class="header-editable-input" 
                       value="${esc(member.name)}" 
                       placeholder="Full Name..."
                       style="background:transparent; border:none; color:inherit; font-size:18px; font-weight:bold; width:100%; outline:none;"
                       oninput="OL.syncTeamMemberName('${member.id}', this.value)"
                       onblur="OL.handleTeamMemberSave('${member.id}', this.value)">
            </div>
            <button class="btn small soft" onclick="OL.closeModal()">Close</button>
        </div>
        <div class="modal-body">

            <div class="card-section" style="margin-top: 20px;">
                <label class="modal-section-label">Assigned Roles</label>
                <div class="pills-row" style="margin-bottom: 12px; min-height: 32px;">
                    ${member.roles.map(role => `
                        <span class="pill tiny accent">
                            ${esc(role)}
                            <b style="cursor:pointer; margin-left:4px;" onclick="OL.removeRoleFromMember('${memberId}', '${esc(role)}')">×</b>
                        </span>
                    `).join("") || '<span class="tiny muted">No roles assigned</span>'}
                </div>

                <div class="search-map-container">
                    <input type="text" class="modal-input tiny" 
                        placeholder="Search roles or type to add new..." 
                        onfocus="OL.filterRoleSearch('${memberId}', '')" // 🚀 THE FIX: Trigger on click/focus
                        oninput="OL.filterRoleSearch('${memberId}', this.value)">
                    <div id="role-search-results" class="search-results-overlay"></div>
                </div>
            </div>
            ${OL.renderAccessSection(memberId, "member")} 
        </div>
    `;
    openModal(html);

    // Auto-focus name field immediately
    setTimeout(() => {
        const input = document.getElementById('modal-tm-name-input');
        if (input) input.focus();
    }, 100);
};

// 🚀 REAL-TIME SURGICAL SYNC
OL.syncTeamMemberName = function(memberId, newName) {
    const cardTitles = document.querySelectorAll(`.tm-card-title-${memberId}`);
    cardTitles.forEach(el => {
        el.innerText = newName;
    });
};

// 4. TEAM ROLE MANAGEMENT
OL.filterRoleSearch = function (memberId, query) {
    const listEl = document.getElementById("role-search-results");
    if (!listEl) return;

    const q = (query || "").toLowerCase().trim();
    const client = getActiveClient();
    const member = client?.projectData?.teamMembers.find(m => m.id === memberId);
    if (!member) return;

    // 1. Get unique list of every role used in the project
    const allProjectRoles = [
        ...new Set(client.projectData.teamMembers.flatMap(m => m.roles || []))
    ];

    // 2. Filter: Match search AND exclude roles the member already has
    const memberRoles = member.roles || [];
    const matches = allProjectRoles.filter(role => 
        role.toLowerCase().includes(q) && !memberRoles.includes(role)
    ).sort();

    let html = matches.map(role => `
        <div class="search-result-item" onmousedown="OL.addRoleToMember('${memberId}', '${esc(role)}')">
            <span>🎭 ${esc(role)}</span>
            <span class="tiny muted">Assign</span>
        </div>
    `).join("");

    // 3. Add "Create New" option if typing a unique role name
    if (q.length > 0 && !allProjectRoles.some(r => r.toLowerCase() === q)) {
        html += `
            <div class="search-result-item create-action" onmousedown="OL.addRoleToMember('${memberId}', '${esc(query)}')">
                <span class="pill tiny accent">+ New</span> Create Role "${esc(query)}"
            </div>`;
    }

    listEl.innerHTML = html || `<div class="search-result-item muted">No other roles found.</div>`;
};

OL.addRoleToMember = function (memberId, roleName) {
    const client = getActiveClient();
    const member = client?.projectData?.teamMembers.find(m => m.id === memberId);

    if (member) {
        if (!member.roles) member.roles = [];
        if (!member.roles.includes(roleName)) {
            member.roles.push(roleName);
            OL.persist();
            
            // 🚀 THE FIX: Clear the dropdown results immediately
            const results = document.getElementById("role-search-results");
            if (results) results.innerHTML = "";
            
            OL.openTeamMemberModal(memberId); // Refresh modal to show new pill
            renderTeamManager(); // Sync background
        }
    }
};

OL.removeRoleFromMember = function (memberId, roleName) {
  const client = getActiveClient();
  const member = client?.projectData?.teamMembers.find(
    (m) => m.id === memberId,
  );

  if (member && member.roles) {
    member.roles = member.roles.filter((r) => r !== roleName);
    OL.persist();
    OL.openTeamMemberModal(memberId);
    renderTeamManager();
  }
};

// 5. ASSIGN TEAM MEMBERS TO SCOPING SHEET ITEMS
OL.toggleTeamAssignment = function (itemId, memberId) {
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
    
    OL.persist();

    // Refresh UI components
    OL.openTeamAssignmentModal(itemId);
    renderScopingSheet();

    // Clear search results overlay if it exists
    const searchResults = document.getElementById("team-search-results");
    if (searchResults) searchResults.innerHTML = "";
  }
};

OL.filterTeamMapList = function (itemId, query) {
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
            👨‍💼 ${esc(m.name)} <span class="tiny muted">(Existing Member)</span>
        </div>
    `,
    )
    .join("");

  // If no exact match, provide the "Create & Map" option
  if (!exactMatch) {
    html += `
            <div class="search-result-item create-action" onclick="OL.executeCreateTeamAndMap('${itemId}', '${esc(query)}')">
                <span class="pill tiny accent" style="margin-right:8px;">+ New</span> 
                Add "${esc(query)}" to Project Team
            </div>
        `;
  }

  listEl.innerHTML = html;
};

OL.executeCreateTeamAndMap = function (itemId, name) {
  const client = getActiveClient();
  if (!client) return;

  // 🛡️ SAFETY CHECK: Initialize the array if it is missing
  if (!client.projectData.teamMembers) {
    client.projectData.teamMembers = [];
  }

  const newMember = {
    id: uid(),
    name: name.trim(),
    role: "Contributor",
  };

  // 1. Add to Project Team
  client.projectData.teamMembers.push(newMember);

  // 2. Assign to the Line Item (This also sets mode to 'individual')
  OL.toggleTeamAssignment(itemId, newMember.id);

  OL.persist();
  console.log(`✅ Created and assigned new member: ${name}`);
};

//======================= CREDENTIALS AND APP ACCESS MANAGEMENT SECTION =======================//

// 1. RENDER CREDENTIALS SECTION ON TEAM MEMBER CARDS
OL.renderAccessSection = function (ownerId, type) {
  const client = getActiveClient();
  const registry =
    client.projectData.accessRegistry ||
    (client.projectData.accessRegistry = []);

  const connections =
    type === "member"
      ? registry.filter((a) => a.memberId === ownerId)
      : registry.filter((a) => a.appId === ownerId);

  const allApps = [
    ...state.master.apps,
    ...(client.projectData.localApps || []),
  ];
  const allMembers = client.projectData.teamMembers || [];

  return `
        <div class="card-section" style="margin-top:20px; border-top: 1px solid var(--line); padding-top:15px;">
            <label class="modal-section-label">System Access & Credentials</label>
            <div class="dp-manager-list" style="margin-bottom:10px;">
                ${connections
                  .map((conn) => {
                    const linkedObj =
                      type === "member"
                        ? allApps.find((a) => a.id === conn.appId)
                        : allMembers.find((m) => m.id === conn.memberId);

                    const jumpTarget =
                      type === "member"
                        ? `OL.openAppModal('${conn.appId}')`
                        : `OL.openTeamMemberModal('${conn.memberId}')`;

                    return `
                        <div class="dp-manager-row" style="display: flex; align-items: flex-start; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.05);">
                            <div style="width: 140px; min-width: 140px; padding: 5px;">
                                <strong class="is-clickable text-accent" 
                                        style="font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block;" 
                                        onclick="${jumpTarget}" 
                                        title="Jump to ${esc(linkedObj?.name)}">
                                    ${type === "member" ? "📱" : "👨‍💼"} ${esc(linkedObj?.name || "Unknown")}
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
                                <button class="card-delete-btn" onclick="OL.removeAccess('${conn.id}', '${ownerId}', '${type}')">×</button>
                            </div>
                        </div>
                    `;
                  })
                  .join("")}
            </div>

            <div class="search-map-container" style="margin-top: 15px;">
                <input type="text" class="modal-input" 
                    placeholder="Click to link ${type === "member" ? "an App" : "a Member"}..." 
                    onfocus="OL.filterAccessSearch('${ownerId}', '${type}', '')" 
                    oninput="OL.filterAccessSearch('${ownerId}', '${type}', this.value)">
                <div id="access-search-results" class="search-results-overlay"></div>
            </div>
        </div>
    `;
};

OL.filterAccessSearch = function (ownerId, type, query) {
    const listEl = document.getElementById("access-search-results");
    if (!listEl) return;

    const q = (query || "").toLowerCase().trim();
    const client = getActiveClient();
    const registry = client.projectData.accessRegistry || [];

    // Filter logic: Find items of the "other" type NOT already linked to this owner
    let source = [];
    if (type === "member") {
        // We are in a Member Modal, searching for an App
        const linkedAppIds = registry.filter(r => r.memberId === ownerId).map(r => r.appId);
        source = [...state.master.apps, ...(client.projectData.localApps || [])]
                 .filter(a => !linkedAppIds.includes(a.id));
    } else {
        // We are in an App Modal, searching for a Member
        const linkedMemberIds = registry.filter(r => r.appId === ownerId).map(r => r.memberId);
        source = (client.projectData.teamMembers || [])
                 .filter(m => !linkedMemberIds.includes(m.id));
    }

    const matches = source.filter((item) => item.name.toLowerCase().includes(q));

    listEl.innerHTML = matches.map(item => `
        <div class="search-result-item" onclick="OL.linkAccess('${ownerId}', '${item.id}', '${type}')">
            ${type === "member" ? "📱" : "👨‍💼"} ${esc(item.name)}
        </div>
    `).join('') || '<div class="search-result-item muted">All matches are already linked.</div>';
};

OL.linkAccess = function (ownerId, targetId, type) {
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

  OL.persist();
  // Refresh whichever modal is currently open
  type === "member"
    ? OL.openTeamMemberModal(ownerId)
    : OL.openAppModal(ownerId);
};

OL.updateAccessValue = function (accessId, field, value) {
  const client = getActiveClient();
  const entry = client.projectData.accessRegistry.find(
    (a) => a.id === accessId,
  );
  if (entry) {
    entry[field] = value;
    OL.persist();
  }
};

OL.removeAccess = function (accessId, ownerId, type) {
  const client = getActiveClient();
  client.projectData.accessRegistry = client.projectData.accessRegistry.filter(
    (a) => a.id !== accessId,
  );
  OL.persist();
  type === "member"
    ? OL.openTeamMemberModal(ownerId)
    : OL.openAppModal(ownerId);
};

// 2. RENDER CREDENTIALS SECTION ON APP CARDS
function renderCredentialRow(clientId, cred, idx, perm) {
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

OL.updateCredentialStatus = function (clientId, idx, status) {
  const client = state.clients[clientId];
  const cred = client.projectData.credentials[idx];

  if (cred) {
    cred.status = status;
    // Auto-log the verification in the project history
    const app = state.master.apps.find((a) => a.id === cred.appId);
    console.log(`Access for ${app?.name} marked as ${status}`);

    OL.persist();
  }
};

//============================= HOW TO SECTION ============================== //

// 1. RENDER HOW TO LIBRARY
window.renderHowToLibrary = function() {
    OL.registerView(renderHowToLibrary);
    const container = document.getElementById("mainContent");
    const client = getActiveClient();
    const hash = window.location.hash;

    // 🛡️ THE GATEKEEPER: Determine if we are viewing the Master Vault or a Project
    const isVaultView = hash.includes('vault');
    
    // 1. Permissions Check
    const perm = OL.checkPermission('how-to');
    if (perm === 'none' && !isVaultView) return;

    // 2. Data Selection
    const masterLibrary = state.master.howToLibrary || [];
    const visibleGuides = isVaultView 
        ? masterLibrary 
        : masterLibrary.filter(ht => (client?.sharedMasterIds || []).includes(ht.id));

    // 3. UI logic: Only show edit/create buttons if we are an Admin
    const canManage = state.adminMode === true;

    container.innerHTML = `
        <div class="section-header">
            <div>
                <h2>📖 ${isVaultView ? 'Master SOP Vault' : 'Project Instructions'}</h2>
                <div class="small muted subheader">${isVaultView ? 'Global Operational Standards' : `Guides shared with ${esc(client?.meta?.name)}`}</div>
            </div>
            
            <div class="header-actions">
                ${canManage ? `
                    ${isVaultView ? `
                        <button class="btn primary" onclick="OL.openHowToEditorModal()">+ Create Master SOP</button>
                    ` : `
                        <button class="btn primary" onclick="OL.importHowToToProject()">⬇ Import from Master</button>
                    `}
                ` : ''}
            </div>
        </div>

        <div class="cards-grid">
            ${visibleGuides.map(ht => renderHowToCard(client?.id, ht, !isVaultView)).join('')}
            ${visibleGuides.length === 0 ? '<div class="empty-hint">No instructional guides found here.</div>' : ''}
        </div>
    `;
};

// 2. RENDER HOW TO CARDS
function renderHowToCard(clientId, ht, isClientView) {
    const client = state.clients[clientId];
    const isShared = client.sharedMasterIds.includes(ht.id);

    return `
        <div class="card ${isShared ? 'is-shared' : 'is-private'}">
            <div class="card-header">
                <div class="card-title ht-card-title-${ht.id}">${esc(ht.name)}</div>
                ${!isClientView ? `
                    <button class="pill tiny ${isShared ? 'accent' : 'soft'}" 
                            onclick="OL.toggleSOPSharing('${clientId}', '${ht.id}')">
                        ${isShared ? '🌍 Shared' : '🔒 Private'}
                    </button>
                ` : ''}
            </div>
            <div class="card-body">
                <p class="small muted" style="height: 40px; overflow: hidden;">${esc(ht.summary || 'No summary provided.')}</p>
                <button class="btn small soft full-width" onclick="OL.openHowToModal('${ht.id}')">Read Guide ➔</button>
            </div>
        </div>
    `;
}

// 3. RENDER HOW TO MODAL
OL.openHowToModal = function(htId, draftObj = null) {
    const hash = window.location.hash;
    const isVaultMode = hash.includes('vault'); 
    const client = getActiveClient();
    
    // 1. Resolve Guide Data
    let ht = draftObj || (state.master.howToLibrary || []).find(h => h.id === htId);
    if (!ht) return;

    // 2. Identify Permissions
    const isAdmin = state.adminMode === true;
    const allApps = [...(state.master.apps || []), ...(client?.projectData?.localApps || [])];

    const linkedTasks = (state.master.taskBlueprints || []).filter(t => (t.howToIds || []).includes(htId));

    const html = `
        <div class="modal-head" style="gap:15px;">
            <div style="display:flex; align-items:center; gap:10px; flex:1;">
                <span style="font-size:18px;">📖</span>
                <input type="text" class="header-editable-input" 
                       value="${esc(ht.name)}" 
                       style="background:transparent; border:none; color:inherit; font-size:18px; font-weight:bold; width:100%; outline:none;"
                       ${!isAdmin ? 'readonly' : ''}
                       onblur="OL.handleHowToSave('${ht.id}', 'name', this.value)">
            </div>
            
            ${isVaultMode ? `
                <div style="display:flex; background:var(--panel-soft); border-radius:6px; padding:2px; margin-right:10px;">
                    <button class="btn tiny ${ht.scope === 'global' || !ht.scope ? 'accent' : 'soft'}" 
                            style="min-width:70px;"
                            onclick="OL.handleHowToSave('${ht.id}', 'scope', 'global')">Global</button>
                    <button class="btn tiny ${ht.scope === 'internal' ? 'accent' : 'soft'}" 
                            style="min-width:70px;"
                            onclick="OL.handleHowToSave('${ht.id}', 'scope', 'internal')">Internal</button>
                </div>
            ` : ''}

            <button class="btn small soft" onclick="OL.closeModal()">Close</button>
        </div>
        <div class="modal-body">
            <div class="card-section" style="margin-top:15px;">
                <label class="modal-section-label">📂 Category</label>
                <input type="text" class="modal-input tiny" 
                       value="${esc(ht.category || 'General')}" 
                       ${!isAdmin ? 'readonly' : ''}
                       placeholder="e.g. Finance, Tech..."
                       onblur="OL.handleHowToSave('${ht.id}', 'category', this.value)">
            </div>

            <div class="card-section" style="margin-top:15px;">
                <label class="modal-section-label">📱 Related Applications</label>
                <div class="pills-row" id="ht-app-pills" style="margin-bottom:8px;">
                    ${(ht.appIds || []).map(appId => {
                        const app = allApps.find(a => a.id === appId);
                        return app ? `
                            <span class="pill tiny accent is-clickable" 
                                  style="cursor: pointer;" 
                                  onclick="OL.openAppModal('${app.id}')">
                                ${esc(app.name)}
                            </span>` : '';
                    }).join('')}
                </div>
                <div class="search-map-container">
                    <input type="text" class="modal-input tiny" placeholder="Link an app..." 
                           onfocus="OL.filterHTAppSearch('${ht.id}', '')"
                           oninput="OL.filterHTAppSearch('${ht.id}', this.value)">
                    <div id="ht-app-search-results" class="search-results-overlay"></div>
                </div>
            </div>

            <div class="card-section" style="margin-top:15px;">
                <label class="modal-section-label">🛠️ Linked Master Resources</label>
                <div class="pills-row" id="ht-resource-pills" style="margin-bottom:8px;">
                    ${(ht.resourceIds || []).map(resId => {
                        const res = (state.master.resources || []).find(r => r.id === resId);
                        return res ? `
                            <span class="pill tiny soft is-clickable" 
                                  style="cursor: pointer;" 
                                  oonclick="OL.openResourceModal('${res.id}')">
                                 ${esc(res.name)}
                            </span>` : '';
                    }).join('')}
                </div>
                <div class="search-map-container">
                    <input type="text" class="modal-input tiny" placeholder="Link a Resource to this guide..." 
                          onfocus="OL.filterHTResourceSearch('${ht.id}', '')"
                          oninput="OL.filterHTResourceSearch('${ht.id}', this.value)">
                    <div id="ht-resource-search-results" class="search-results-overlay"></div>
                </div>
            </div>

            <div class="card-section" style="margin-top:15px;">
                <label class="modal-section-label">🎥 Training Video URL</label>
                <input type="text" class="modal-input tiny" 
                       value="${esc(ht.videoUrl || '')}" 
                       ${!isAdmin ? 'readonly' : ''}
                       onblur="OL.handleHowToSave('${ht.id}', 'videoUrl', this.value)">
            </div>

            <div class="card-section" style="margin-top:20px; border-top: 1px solid var(--line); padding-top:15px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                    <label class="modal-section-label">📋 Client Requirements Logic</label>
                    <button class="btn tiny primary" onclick="OL.addHTRequirement('${ht.id}')">+ Add Requirement</button>
                </div>
                <div id="ht-requirements-list">
                    ${renderHTRequirements(ht)}
                </div>
            </div>

            <div class="card-section" style="margin-top: 20px;">
                <label class="modal-section-label">📋 Used in Master Tasks</label>
                <div class="pills-row">
                    ${linkedTasks.map(task => `
                        <span class="pill tiny soft is-clickable" 
                              style="cursor: pointer;"
                              onclick="OL.openTaskModal('${task.id}', true)">
                            📋 ${esc(task.title || task.name)}
                        </span>
                    `).join('')}
                    ${linkedTasks.length === 0 ? '<span class="tiny muted italic">Not currently linked to any blueprints.</span>' : ''}
                </div>
            </div>

            <div class="card-section" style="margin-top:20px; border-top: 1px solid var(--line); padding-top:20px;">
                <label class="modal-section-label">Instructions</label>
                <textarea class="modal-textarea" rows="12" 
                          onblur="OL.handleHowToSave('${ht.id}', 'content', this.value)">${esc(ht.content || '')}</textarea>
            </div>
        </div>
    `;
    openModal(html);
};

function renderHTRequirements(ht) {
    const requirements = ht.requirements || [];
    const masterFunctions = (state.master?.functions || []);
    const allGuides = (state.master.howToLibrary || []);

    return requirements.map((req, idx) => `
        <div class="dp-manager-row" style="flex-direction:column; gap:8px; background:rgba(var(--accent-rgb), 0.05); padding:12px; margin-bottom:10px; border-left:3px solid var(--accent);">
            <div style="display:flex; gap:10px; align-items:center;">
                <input type="text" class="modal-input tiny" style="flex:2;" placeholder="Action Name (e.g. Provide Login)" 
                       value="${esc(req.actionName || '')}" onblur="OL.updateHTReq('${ht.id}', ${idx}, 'actionName', this.value)">
                
                <select class="tiny-select" style="flex:1;" onchange="OL.updateHTReq('${ht.id}', ${idx}, 'targetId', this.value)">
                    <option value="">-- Target Function --</option>
                    ${masterFunctions.map(f => `<option value="${f.id}" ${req.targetId === f.id ? 'selected' : ''}>⚙️ ${esc(f.name)}</option>`).join('')}
                </select>
                <button class="card-delete-btn" style="position:static;" onclick="OL.removeHTReq('${ht.id}', ${idx})">×</button>
            </div>
            
            <div style="display:flex; gap:10px; align-items:center;">
                <select class="tiny-select" style="flex:1;" onchange="OL.updateHTReq('${ht.id}', ${idx}, 'clientGuideId', this.value)">
                    <option value="">-- Client Helper Guide (SOP) --</option>
                    ${allGuides.filter(g => g.id !== ht.id).map(g => `<option value="${g.id}" ${req.clientGuideId === g.id ? 'selected' : ''}>📖 ${esc(g.name)}</option>`).join('')}
                </select>
                <input type="text" class="modal-input tiny" style="flex:1;" placeholder="Instructions for client..." 
                       value="${esc(req.description || '')}" onblur="OL.updateHTReq('${ht.id}', ${idx}, 'description', this.value)">
            </div>
        </div>
    `).join('') || '<div class="empty-hint">No structured requirements defined.</div>';
}

// HOW TO AND APP OVERLAP
OL.toggleHTApp = function(htId, appId) {
    const ht = state.master.howToLibrary.find(h => h.id === htId);
    if (!ht) return;
    
    if (!ht.appIds) ht.appIds = [];
    const idx = ht.appIds.indexOf(appId);
    
    if (idx === -1) ht.appIds.push(appId);
    else ht.appIds.splice(idx, 1);
    
    OL.persist();
    OL.openHowToModal(htId); // Refresh
};

OL.filterHTAppSearch = function(htId, query) {
    const listEl = document.getElementById("ht-app-search-results");
    if (!listEl) return;
    const q = (query || "").toLowerCase();
    const client = getActiveClient();
    const ht = state.master.howToLibrary.find(h => h.id === htId);
    
    const allApps = [...state.master.apps, ...(client?.projectData?.localApps || [])];
    const matches = allApps.filter(a => a.name.toLowerCase().includes(q) && !(ht.appIds || []).includes(a.id));
    
    listEl.innerHTML = matches.map(app => `
        <div class="search-result-item" onmousedown="OL.toggleHTApp('${htId}', '${app.id}')">
            📱 ${esc(app.name)}
        </div>
    `).join('') || '<div class="search-result-item muted">No apps found</div>';
};

OL.parseVideoEmbed = function(url) {
    if (!url) return "";
    
    // YouTube
    const ytMatch = url.match(/(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    if (ytMatch) return `<iframe width="100%" height="315" src="https://www.youtube.com/embed/${ytMatch[1]}" frameborder="0" allowfullscreen></iframe>`;
    
    // Loom
    const loomMatch = url.match(/(?:https?:\/\/)?(?:www\.)?loom\.com\/share\/([a-zA-Z0-9]+)/);
    if (loomMatch) return `<div style="position: relative; padding-bottom: 56.25%; height: 0;"><iframe src="https://www.loom.com/embed/${loomMatch[1]}" frameborder="0" webkitallowfullscreen mozallowfullscreen allowfullscreen style="position: absolute; top: 0; left: 0; width: 100%; height: 100%;"></iframe></div>`;

    // Vimeo
    const vimeoMatch = url.match(/(?:https?:\/\/)?(?:www\.)?vimeo\.com\/(\d+)/);
    if (vimeoMatch) return `<iframe src="https://player.vimeo.com/video/${vimeoMatch[1]}" width="100%" height="315" frameborder="0" allow="autoplay; fullscreen" allowfullscreen></iframe>`;

    return "";
};

// Toggle a resource ID in the guide's resourceIds array
OL.toggleHTResource = function(htId, resId) {
    const ht = (state.master.howToLibrary || []).find(h => h.id === htId);
    if (!ht) return;
    
    if (!ht.resourceIds) ht.resourceIds = [];
    const idx = ht.resourceIds.indexOf(resId);
    
    if (idx === -1) ht.resourceIds.push(resId);
    else ht.resourceIds.splice(idx, 1);
    
    OL.persist(); //
    OL.openHowToModal(htId); // Refresh UI to show updated pills
};

// Filter the master resource library for the search dropdown
OL.filterHTResourceSearch = function(htId, query) {
    const listEl = document.getElementById("ht-resource-search-results");
    if (!listEl) return;
    const q = (query || "").toLowerCase();
    const ht = (state.master.howToLibrary || []).find(h => h.id === htId);
    
    const availableResources = (state.master.resources || []).filter(res => 
        res.name.toLowerCase().includes(q) && 
        !(ht.resourceIds || []).includes(res.id)
    );
    
    listEl.innerHTML = availableResources.map(res => `
        <div class="search-result-item" onmousedown="OL.toggleHTResource('${htId}', '${res.id}')">
            🛠️ ${esc(res.name)}
        </div>
    `).join('') || '<div class="search-result-item muted">No resources found</div>';
};

// 4. HANDLE STATUS / EDITING
OL.toggleSOPSharing = function(clientId, htId) {
    const client = state.clients[clientId];
    if (!client) return;

    const idx = client.sharedMasterIds.indexOf(htId);
    if (idx === -1) {
        client.sharedMasterIds.push(htId);
    } else {
        client.sharedMasterIds.splice(idx, 1);
    }

    OL.persist();
    renderHowToLibrary(); // Refresh view
};

// 5. HANDLE EDIT or REMOVE HOW TO
OL.openHowToEditorModal = function() {
    const draftId = 'draft-ht-' + Date.now();
    const draftHowTo = {
        id: draftId,
        name: "",
        summary: "",
        content: "",
        isDraft: true
    };
    OL.openHowToModal(draftId, draftHowTo);
};

// 🚀 REAL-TIME SURGICAL SYNC
OL.syncHowToName = function(htId, newName) {
    const cardTitles = document.querySelectorAll(`.ht-card-title-${htId}`);
    cardTitles.forEach(el => {
        el.innerText = newName;
    });
};

// UPDATED SAVE LOGIC
OL.handleHowToSave = function(id, field, value) {
    const ht = state.master.howToLibrary.find(h => h.id === id);
    if (!ht) return;

    const cleanVal = (typeof value === 'string') ? value.trim() : value;
    ht[field] = cleanVal;

    // 🔒 1. If set to internal, automatically revoke from all clients
    if (field === 'scope' && cleanVal === 'internal') {
        Object.values(state.clients).forEach(client => {
            if (client.sharedMasterIds) {
                client.sharedMasterIds = client.sharedMasterIds.filter(mid => mid !== id);
            }
        });
    }

    OL.persist(); // Save to Firebase

    // 🔄 2. THE FIX: Trigger an immediate UI refresh for specific fields
    if (field === 'scope') {
        // Re-opens the current modal to update button colors and scope indicators
        OL.openHowToModal(id); 
        
        // Also refresh the background grid to sync visibility
        if (typeof renderHowToLibrary === 'function') {
            renderHowToLibrary(); 
        }
    }
};

OL.deleteHowToGuide = function(htId) {
    const guide = state.master.howToLibrary.find(h => h.id === htId);
    if (!guide) return;

    if (!confirm(`⚠️ PERMANENT DELETE: Are you sure you want to delete "${guide.name}"?\n\nThis will remove the guide from the library for ALL client projects.`)) return;

    // 1. Remove from Master Library
    state.master.howToLibrary = state.master.howToLibrary.filter(h => h.id !== htId);

    // 2. Cleanup Client Links (Optional but recommended)
    Object.values(state.clients).forEach(client => {
        if (client.sharedMasterIds) {
            client.sharedMasterIds = client.sharedMasterIds.filter(id => id !== htId);
        }
    });

    OL.persist();
    renderHowToLibrary();
    console.log("🗑️ Master Guide Deleted:", htId);
};

// 6. HANDLE SYNCING TO MASTER AND VICE VERSA
OL.importHowToToProject = function() {
    const html = `
        <div class="modal-head">
            <div class="modal-title-text">📚 Link Master SOP</div>
            <div class="spacer"></div>
            <button class="btn small soft" onclick="OL.closeModal()">Cancel</button>
        </div>
        <div class="modal-body">
            <div class="search-map-container">
                <input type="text" class="modal-input" 
                       placeholder="Click to view guides..." 
                       onfocus="OL.filterMasterHowToImport('')"
                       oninput="OL.filterMasterHowToImport(this.value)" 
                       autofocus>
                <div id="master-howto-import-results" class="search-results-overlay" style="margin-top:10px;"></div>
            </div>
        </div>
    `;
    openModal(html);
};

OL.filterMasterHowToImport = function(query) {
    const listEl = document.getElementById("master-howto-import-results");
    if (!listEl) return;

    const q = (query || "").toLowerCase().trim();
    const client = getActiveClient();
    const alreadyShared = client?.sharedMasterIds || [];

    const available = (state.master.howToLibrary || []).filter(ht => 
        ht.name.toLowerCase().includes(q) && !alreadyShared.includes(ht.id)
    );

    listEl.innerHTML = available.map(ht => `
        <div class="search-result-item" onmousedown="OL.toggleSOPSharing('${client.id}', '${ht.id}'); OL.closeModal();">
            📖 ${esc(ht.name)}
        </div>
    `).join('') || `<div class="search-result-item muted">No unlinked guides found.</div>`;
};

//======================= HOW-TO TASKS OVERLAP ========================//

OL.filterTaskHowToSearch = function(taskId, query, isVault) {
    const container = document.getElementById('task-howto-results');
    if (!container) return;

    const client = getActiveClient();
    const q = (query || "").toLowerCase().trim();
    
    // 1. Resolve current task to find existing links
    const task = isVault 
        ? state.master.taskBlueprints.find(t => t.id === taskId)
        : client?.projectData?.clientTasks.find(t => t.id === taskId);
    
    const existingIds = task?.howToIds || [];

    // 2. Filter available guides (exclude existing)
    const results = (state.master.howToLibrary || []).filter(guide => {
        const matches = (guide.name || "").toLowerCase().includes(q);
        const alreadyLinked = existingIds.includes(guide.id);
        return matches && !alreadyLinked;
    });

    if (results.length === 0) {
        container.innerHTML = `<div class="search-result-item muted">No unlinked guides found.</div>`;
        return;
    }

    container.innerHTML = results.map(guide => `
        <div class="search-result-item is-clickable" 
             onmousedown="OL.toggleTaskHowTo(event, '${taskId}', '${guide.id}', ${isVault})">
            📖 ${esc(guide.name)}
        </div>
    `).join('');
};

OL.toggleTaskHowTo = function(event, taskId, howToId, isVault) {
    if (event) event.stopPropagation();
    const client = getActiveClient();
    
    let task = isVault 
        ? state.master.taskBlueprints.find(t => t.id === taskId)
        : client?.projectData?.clientTasks.find(t => t.id === taskId);

    const guide = (state.master.howToLibrary || []).find(g => g.id === howToId);

    if (task && guide) {
        if (!task.howToIds) task.howToIds = [];
        const idx = task.howToIds.indexOf(howToId);
        
        if (idx === -1) {
            // 🚀 LINKING: Add ID and Sync Content
            task.howToIds.push(howToId);
            
            // Append Prework and Items Needed to the task description
            const syncNotice = `\n\n--- Linked SOP: ${guide.name} ---`;
            const itemsText = guide.itemsNeeded ? `\n📦 Items Needed: ${guide.itemsNeeded}` : "";
            const preworkText = guide.prework ? `\n⚡ Required Prework: ${guide.prework}` : "";
            
            task.description = (task.description || "") + syncNotice + itemsText + preworkText;
        } else {
            // UNLINKING: Remove ID
            task.howToIds.splice(idx, 1);
        }
        
        OL.persist();
        OL.openTaskModal(taskId, isVault); 
    }
};

// Add a new empty requirement object to a guide
OL.addHTRequirement = function(htId) {
    const ht = (state.master.howToLibrary || []).find(h => h.id === htId);
    if (!ht) return;

    // Initialize the requirements array if it doesn't exist
    if (!ht.requirements) ht.requirements = [];

    // Push a new requirement structure
    ht.requirements.push({
        actionName: "",
        targetType: "function", // Default to function-based resolution
        targetId: "",           // Will hold the Function ID
        clientGuideId: "",      // Will hold the Helper SOP ID
        description: ""
    });

    OL.persist(); // Sync to storage
    OL.openHowToModal(htId); // Refresh the modal to show the new row
};

OL.updateHTReq = function(htId, index, field, value) {
    const ht = (state.master.howToLibrary || []).find(h => h.id === htId);
    if (!ht || !ht.requirements || !ht.requirements[index]) return;

    ht.requirements[index][field] = value;

    // We persist, but we don't necessarily need to re-open the modal 
    // for text inputs to avoid losing focus, unless it's a dropdown change.
    OL.persist();
    
    if (field === 'targetId' || field === 'clientGuideId') {
        OL.openHowToModal(htId);
    }
};

// Remove a requirement from the list
OL.removeHTRequirement = function(htId, index) {
    const ht = (state.master.howToLibrary || []).find(h => h.id === htId);
    if (!ht || !ht.requirements) return;

    ht.requirements.splice(index, 1);
    
    OL.persist();
    OL.openHowToModal(htId);
};

// HOW TO SCOPING OVERLAP
OL.resolveRequirementTarget = function(requirement) {
    const client = getActiveClient();
    if (requirement.targetType === 'app') return requirement.targetId;

    if (requirement.targetType === 'function') {
        // Find the client's app that is the "Primary" for this function
        const localApps = client.projectData.localApps || [];
        const primaryApp = localApps.find(app => 
            app.functionIds?.some(m => (m.id === requirement.targetId && m.status === 'primary'))
        );
        return primaryApp ? primaryApp.id : null;
    }
    return null;
};

OL.deployRequirementsFromResource = function(resourceId) {
    const client = getActiveClient();
    // Find the Master Guide linked to this Resource
    const guide = (state.master.howToLibrary || []).find(ht => (ht.resourceIds || []).includes(resourceId));
    
    if (!guide || !guide.requirements || guide.requirements.length === 0) return;

    guide.requirements.forEach(req => {
        // Resolve the target App by looking for the "Primary" mapping for the Function
        const targetAppId = OL.resolveRequirementTarget(req);
        const allApps = [...state.master.apps, ...(client.projectData.localApps || [])];
        const targetAppName = allApps.find(a => a.id === targetAppId)?.name || "System";

        const newTask = {
            id: 'tm-' + Date.now() + Math.random().toString(36).substr(2, 5),
            name: `${req.actionName || 'Requirement'} (${targetAppName})`,
            description: req.description || `Required for ${guide.name} implementation.`,
            status: "Pending",
            appIds: targetAppId ? [targetAppId] : [],
            howToIds: req.clientGuideId ? [req.clientGuideId] : [], // Attach the Helper Guide
            createdDate: new Date().toISOString()
        };

        if (!client.projectData.clientTasks) client.projectData.clientTasks = [];
        client.projectData.clientTasks.push(newTask);
    });
    
    OL.persist();
};

// HANDLE TASK RESOURCE OVERLAP
// Filter SOPs that aren't already linked to this resource
OL.filterResourceSOPLinker = function(resId, query) {
    const listEl = document.getElementById("res-sop-linker-results");
    if (!listEl) return;
    const q = (query || "").toLowerCase();
    
    const availableSOPs = (state.master.howToLibrary || []).filter(ht => {
        const isMatch = ht.name.toLowerCase().includes(q);
        const isNotLinked = !(ht.resourceIds || []).includes(resId);
        return isMatch && isNotLinked;
    });

    listEl.innerHTML = availableSOPs.map(sop => `
        <div class="search-result-item" onmousedown="OL.toggleSOPToResource('${sop.id}', '${resId}')">
            📖 ${esc(sop.name)}
        </div>
    `).join('') || '<div class="search-result-item muted">No unlinked SOPs found</div>';
};

// Update the SOP's resourceIds list
OL.toggleSOPToResource = function(sopId, resId) {
    const sop = state.master.howToLibrary.find(h => h.id === sopId);
    if (!sop) return;

    if (!sop.resourceIds) sop.resourceIds = [];
    const idx = sop.resourceIds.indexOf(resId);

    if (idx === -1) {
        sop.resourceIds.push(resId);
    } else {
        sop.resourceIds.splice(idx, 1);
    }

    OL.persist();
    OL.openResourceModal(resId); // Refresh the resource modal to show the new pill
};
handleRoute();