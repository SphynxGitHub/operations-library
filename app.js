//======================= GENERAL SECTION =======================//

// 1. MUST BE LINE 1: Define the namespace immediately
const OL = window.OL = {};

// 🚀 THE ANCHOR: Lock the security context at the absolute start
const params = new URLSearchParams(window.location.search);
window.FORCE_ADMIN = params.get('admin') === 'pizza123'; 
console.log("🛠️ Global Admin Lock:", window.FORCE_ADMIN);

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
    viewMode: localStorage.getItem('ol_preferred_view_mode') || 'global',
    ui: { 
        showCompleted: false,
        zenMode: localStorage.getItem('ol_preferred_view_mode') === 'global' 
    },
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

// 2. REAL-TIME CLOUD ENGINE
// We keep the name 'persist' so we don't have to change the rest of the code.
OL.persist = async function() {
    const statusEl = document.getElementById('cloud-status');
    if(statusEl) statusEl.innerHTML = "⏳ Syncing...";

    try {
        // 1. Create a clean clone
        const rawState = JSON.parse(JSON.stringify(state));
        delete rawState.isSaving;
        delete rawState.adminMode;

        // 📏 SIZE CHECK (Crucial for 245+ resources)
        const size = new TextEncoder().encode(JSON.stringify(rawState)).length;
        const kb = (size / 1024).toFixed(2);
        console.log(`📦 Outbound Data Size: ${kb} KB`);
        
        if (size > 1000000) {
            console.error("❌ CRITICAL: Document exceeds 1MB limit. Firebase will reject this.");
            if(statusEl) statusEl.innerHTML = "⚠️ DATA TOO LARGE";
            return;
        }

        // 2. THE PUSH
        // Using .update() instead of .set() can sometimes bypass full document overwrites
        await db.collection('systems').doc('main_state').set(rawState);
        
        console.log("☁️ Firebase Acknowledged Save");
        if(statusEl) statusEl.innerHTML = "✅ Synced";

    } catch (error) {
        console.error("❌ Firebase Write ERROR:", error);
        if(statusEl) statusEl.innerHTML = "⚠️ Sync Error";
        throw error; 
    }
};

// 3. REAL-TIME SYNC ENGINE
OL.sync = function() {
    console.log("📡 Initializing Iron-Clad Sync...");
    
    db.collection('systems').doc('main_state').onSnapshot((doc) => {
        const now = Date.now();
        
        // 1. 🛡️ THE SHIELD
        // Prevent refresh if document doesn't exist, we are currently saving, 
        // or a local render just happened (prevents feedback loops).
        if (!doc.exists || state.isSaving || (window.lastLocalRender && (now - window.lastLocalRender < 2000))) {
            return; 
        }

        const cloudData = doc.data();

        // 2. 🧠 SMART EQUALITY CHECK
        // Determine if anything meaningful actually changed before triggering DOM work.
        const isFirstLoad = !state.master || Object.keys(state.master).length === 0;
        const hasFocusChanged = cloudData.focusedResourceId !== state.focusedResourceId;
        const hasDataChanged = JSON.stringify(cloudData.master) !== JSON.stringify(state.master);
        const hasClientsChanged = JSON.stringify(cloudData.clients) !== JSON.stringify(state.clients);

        if (!isFirstLoad && !hasFocusChanged && !hasDataChanged && !hasClientsChanged) return; 

        console.log("🔄 Valid Cloud Change Detected. Updating State...");

        // 3. Update Global State
        state.master = cloudData.master || {};
        state.clients = cloudData.clients || {};
        state.focusedResourceId = cloudData.focusedResourceId;
        state.viewMode = cloudData.viewMode || 'global';

        // 4. 🚀 THE NUDGE
        // If the screen is currently empty or showing a spinner, boot the router.
        const main = document.getElementById('mainContent');
        if (main && (main.innerHTML.includes('spinner') || main.innerHTML.trim() === "")) {
            console.log("📡 Data arrived. Nudging router to draw the current page...");
            window.handleRoute();
            return; 
        }

        // 5. 🎨 CONTEXTUAL REFRESH
        // If we are on the visualizer, use the debounced engine for performance.
        if (window.location.hash.includes('visualizer')) {
            clearTimeout(window.syncDebounce);
            window.syncDebounce = setTimeout(() => {
                window.renderGlobalVisualizer(window.location.hash.includes('vault'));
            }, 300); 
        } 
        // For all other views (Scoping, Tasks, Apps, etc.), run handleRoute to redraw.
        else {
            window.handleRoute();
        }
    });
};

/**
 * 🚀 THE GLOBAL MUTATOR
 * Wraps data changes in a sync-shield to prevent cloud "bounce-back"
 * @param {Function} mutationFn - The logic to execute before syncing
 */
OL.updateAndSync = async function(mutationFn) {
    state.isSaving = true; // Start the shield
    
    try {
        // Run your data change
        await mutationFn();

        // Push to cloud
        await OL.persist();
        
        console.log("🚀 Update & Sync Success");
    } catch (error) {
        console.error("💀 FATAL SYNC FAILURE:", error);
        // If it fails, we HAVE to alert so you don't keep working on "fake" data
        alert("CRITICAL: Data did not save to cloud. Please refresh.");
    } finally {
        // Only release the shield after a timeout
        setTimeout(() => { state.isSaving = false; }, 800);
    }
};


window.addEventListener("load", () => {
    // 1. Admin Verification
    if (window.location.search.includes('admin=pizza123')) {
        state.adminMode = true;
        OL.state.adminMode = true;
    }
    
    // 2. Recall Client
    const savedClientId = sessionStorage.getItem('lastActiveClientId');
    if (savedClientId) state.activeClientId = savedClientId;

    // 3. 🚩 RECALL VISUALIZER DEPTH (The Correct Way)
    state.focusedWorkflowId = sessionStorage.getItem('active_workflow_id');
    state.focusedResourceId = sessionStorage.getItem('active_resource_id');

    // 🚀 THE FIX: Only redirect if the user is on the Dashboard or explicitly on the Visualizer
    const currentHash = location.hash;
    const isDashboard = currentHash === "" || currentHash === "#/";
    const isVisualizer = currentHash.includes('visualizer');

    if ((state.focusedWorkflowId || state.focusedResourceId) && (isDashboard || isVisualizer)) {
        console.log("♻️ Resuming Flow Map depth");
        const isVault = currentHash.includes('vault');
        location.hash = isVault ? "#/vault/visualizer" : "#/visualizer";
    }
    
    OL.sync(); 
});

window.getActiveClient = function() {
    // 1. Check the URL for public access
    const urlParams = new URLSearchParams(window.location.search);
    const accessToken = urlParams.get('access');

    if (!state.clients) return null;

    // 2. 🟢 IF WE HAVE A TOKEN: Use the Deep Search (Public View)
    if (accessToken) {
        const foundClient = Object.values(state.clients).find(c => 
            c.publicToken === accessToken || c.id === accessToken
        );
        if (foundClient) {
            state.activeClientId = foundClient.id;
            return foundClient;
        }
    }

    // 3. 🔵 IF NO TOKEN: Use the Standard ID (Admin/Master View)
    // This allows you to click between clients in the dashboard
    if (state.activeClientId && state.clients[state.activeClientId]) {
        return state.clients[state.activeClientId];
    }

    return null;
};

// Controls what a user can SEE
OL.checkPermission = function (tabKey) {
  const client = getActiveClient();
  // If we are in the Master Vault or no client is selected, allow everything
  if (!client) return "full";
  
  // 🚀 THE FIX: If the permission key is missing, default to "full" instead of "none"
  // This ensures new features like 'visualizer' show up immediately
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
            <div style="background:#050816; color:white; height:100vh; display:flex; flex-direction:column; align-items:center; justify-content:center; font-family:sans-serif;">
                <h1 style="color:#38bdf8;">🔒 Secure Portal</h1>
                <p style="opacity:0.6;">Please use the unique link provided by your administrator.</p>
            </div>`;
        return false;
    }
    
    return false;
};

// 4. LAYOUT & ROUTING ENGINE

OL.toggleSidebar = function() {
    const sidebar = document.querySelector('.sidebar');
    const isCollapsed = sidebar.classList.toggle('collapsed');
    
    // Save to memory so it sticks on refresh
    localStorage.setItem('sidebarCollapsed', isCollapsed);
    
    // Redraw the visualizer lines if we are in Tier 3, 
    // because the card positions physically shifted on screen.
    if (state.focusedResourceId) {
        setTimeout(() => OL.drawVerticalLogicLines(state.focusedResourceId), 350);
    }
};

// Run this on page load to restore state
window.addEventListener('load', () => {
    const sidebar = document.querySelector('.sidebar');
    if (sidebar && localStorage.getItem('sidebarCollapsed') === 'true') {
        sidebar.classList.add('collapsed');
    }
});

OL.toggleTheme = function() {
    // 1. Toggle the class on body
    const isLight = document.body.classList.toggle('light-mode');
    
    // 2. Persist to localStorage
    localStorage.setItem('ol_theme', isLight ? 'light' : 'dark');
    
    // 3. 🚀 CRITICAL: Re-render the main layout so the sidebar button text updates
    if (typeof OL.renderLayout === 'function') {
        OL.renderLayout(); 
    } else {
        // Fallback: reload if layout function isn't globally accessible
        window.location.reload(); 
    }
};

// Call this at the very top of your script execution
(function initTheme() {
    if (localStorage.getItem('ol_theme') === 'light') {
        document.body.classList.add('light-mode');
    }
})();

// 💡 Run this on app initialization to load saved theme
OL.initTheme = function() {
    if (localStorage.getItem('ol_theme') === 'light') {
        document.body.classList.add('light-mode');
    }
};


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

  // 1. Dashboard/Non-Context View
  if (!client && !isMaster && !isPublic) {
        // Only render the Dashboard link if no client context exists
        root.innerHTML = `
            <div class="three-pane-layout zen-mode-active">
                <aside class="sidebar"><nav class="menu"><a href="#/" class="active"><i>🏠</i> <span>Dashboard</span></a></nav></aside>
                <main id="mainContent"></main>
                <aside id="inspector-panel" class="pane-inspector">
                    <div class="sidebar-resizer right-side-handle"></div>
                    <div class="inspector-scroll-content"></div>
                </aside>
            </div>`;
        return;
    }  

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
      key: "visualizer",
      label: "Flow Map",
      icon: "🕸️",
      href: "#/vault/visualizer",
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
      key: "visualizer",
      label: "Flow Map",
      icon: "🕸️",
      href: "#/visualizer",
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
      key: "how-to",
      label: "How-To Library",
      icon: "👩‍🏫",
      href: "#/how-to",
    },
    { key: "team", label: "Team Members", icon: "👬", href: "#/team" },
  ];

  // Inside your layout/sidebar render function:
    const isLightMode = document.body.classList.contains('light-mode');
    const themeIcon = isLightMode ? '🌙' : '☀️';
    const themeLabel = isLightMode ? 'Dark Mode' : 'Light Mode';

    const themeSection = `
        <div class="theme-toggle-zone" style="padding: 0 15px; margin: 10px 0;">
            <button class="btn soft tiny" onclick="OL.toggleTheme()" title="${themeLabel}"
                style="width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px; background: var(--panel-soft); border: 1px solid var(--line); color: var(--text-main); padding: 8px; border-radius: 6px; cursor: pointer;">
                <span class="theme-icon" style="min-width: 20px; text-align: center;">${themeIcon}</span>
                <span class="theme-label">${themeLabel}</span>
            </button>
        </div>
    `;

    // 2 Prepare the Sidebar HTML content
    const sidebarContent = `
        <button class="sidebar-toggle" onclick="OL.toggleSidebar()" title="Toggle Menu">
            <span class="toggle-icon">◀</span>
        </button>
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
                                <i>${item.icon}</i> <span>${item.label}</span>
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
                    <div class="inspector-scroll-content"></div>
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
};

window.handleRoute = function () {
    const hash = window.location.hash || "#/";
    const urlParams = new URLSearchParams(window.location.search);
    const viewParam = urlParams.get('view');

    // --- 🚦 ROUTE DEBUG ---
    console.group("🚦 ROUTE DEBUG");
    console.log("Current Hash:", window.location.hash);
    console.log("Focus Before Route:", state.focusedResourceId);
    console.groupEnd();

    // 🚀 RESET SURGICAL FILTERS
    // We clear these so standard navigation is always clean/unfiltered
    state.scopingFilterActive = false;
    state.scopingTargetId = null;

    // 1. Force the Skeleton 🏗️
    window.buildLayout(); 

    const main = document.getElementById("mainContent");
    if (!main) return; 

    // 2. Identify Context 🔍
    const client = getActiveClient();
    if (client) {
        console.log("✅ Verified Client Access:", client.meta.name);
    } else {
        console.warn("❌ Access Token invalid or Data not loaded yet.");
    }

    const isVault = hash.includes('vault');

    // 3. The "Loading" Safety Net 🛡️
    if (!isVault && hash !== "#/" && !client) {
        main.innerHTML = `
            <div style="padding:100px; text-align:center; opacity:0.5;">
                <div class="spinner">⏳</div>
                <h3>Synchronizing Project Data...</h3>
                <p class="tiny">If this persists, please return to the Dashboard.</p>
            </div>`;
        return; 
    }

    // 4. VISUALIZER ROUTE 🕸️
    if (hash.includes('visualizer')) {
        state.viewMode = 'graph'; 
        
        // Sync state with session storage for recovery
        if (!state.focusedResourceId) {
            state.focusedResourceId = sessionStorage.getItem('active_resource_id');
        }
        if (!state.focusedWorkflowId) {
            state.focusedWorkflowId = sessionStorage.getItem('active_workflow_id');
        }

        document.body.classList.add('is-visualizer', 'fs-mode-active');
        window.renderGlobalVisualizer(isVault);
        return; 
    }

    // 5. Standard Routes Cleanup
    document.body.classList.remove('is-visualizer', 'fs-mode-active');

    // 6. DATA RENDERING
    if (isVault) {
        if (hash.includes("resources")) renderResourceManager();
        else if (hash.includes("apps")) renderAppsGrid();
        else if (hash.includes("functions")) renderFunctionsGrid();
        else if (hash.includes("rates")) renderVaultRatesPage();
        else if (hash.includes("analyses")) renderAnalysisModule(); 
        else if (hash.includes("how-to")) renderHowToLibrary(); 
        else if (hash.includes("tasks")) renderBlueprintManager();
        else renderAppsGrid(); 
    } else if (hash === "#/" || hash === "#/clients") {
        renderClientDashboard();
    } else if (client) {
        console.log("🟢 Routing to Client Module:", hash);
        
        if (hash.includes("client-tasks")) renderChecklistModule();
        else if (hash.includes("resources")) renderResourceManager();
        else if (hash.includes("applications")) renderAppsGrid();
        else if (hash.includes("functions")) renderFunctionsGrid();
        else if (hash.includes("scoping-sheet")) {
            state.viewMode = 'scoping';
            renderScopingSheet();
        }
        else if (hash.includes("analyze")) renderAnalysisModule();
        else if (hash.includes("team")) renderTeamManager();
        else if (hash.includes("how-to")) renderHowToLibrary();
        else {
            console.warn("❓ Unknown client hash, defaulting to Tasks");
            renderChecklistModule();
        }
    } else {
        console.error("🔴 No client found for hash:", hash);
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

  const overlay = document.getElementById("modal-overlay");
  overlay.onclick = () => OL.closeModal();
};

OL.closeModal = function () {
    const layer = document.getElementById("modal-layer");
    if (layer) {
        layer.style.display = "none";
        layer.innerHTML = "";
    }
    // 🚀 NEW: Wipe history on close
    OL.clearNavHistory();
    
    if (typeof activeOnClose === "function") activeOnClose();
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

OL.sync();

//======================= CLIENT DASHBOARD SECTION =======================//

// 1. CLIENT DASHBOARD & CORE MODULES
window.renderClientDashboard = function() {
    const container = document.getElementById("mainContent");
    if (!container) return;

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
        container.innerHTML = `
            <div style="padding:100px; text-align:center;">
                <div class="spinner">⏳</div>
                <h3 class="muted">Connecting to Registry...</h3>
            </div>`;
        return;
    }

    container.innerHTML = `
        <div class="section-header search-header" style="display: flex; align-items: flex-end; gap: 20px; margin-bottom: 10px;">
            <div style="flex: 1;">
                <h2 style="margin:0;">Registry & Command</h2>
                <div class="small muted">Quick access to projects and master systems</div>
            </div>
              
            <div class="search-map-container" style="position: relative; flex: 1; max-width: 400px;">
                <input type="text" id="global-command-search" class="modal-input" 
                       placeholder="Search clients or apps..." 
                       oninput="OL.handleGlobalSearch(this.value)">
                <div id="global-search-results" class="search-results-overlay"></div>
            </div>

            <div class="header-actions" style="display: flex; gap: 10px;">
                <button class="btn primary" onclick="OL.onboardNewClient()">+ Add Client</button>
                <button class="btn small warn" onclick="OL.pushFeaturesToAllClients()" title="Sync System Changes">⚙️ Migration</button>
            </div>
        </div>

        <div class="filter-bar" style="display:flex; gap:10px; margin-bottom:25px; padding-left: 5px;">
            ${['All', 'Discovery', 'Active', 'On Hold', 'Review', 'Completed'].map(f => `
                <span class="pill tiny ${activeFilter === f ? 'accent' : 'soft'}" 
                      style="cursor:pointer; border: 1px solid ${activeFilter === f ? 'var(--accent)' : 'transparent'}; padding: 4px 12px; border-radius: 20px;"
                      onclick="OL.setDashboardFilter('${f}')">
                    ${f}
                </span>
            `).join('')}
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
                            ${['Discovery', 'Active', 'On Hold', 'Review', 'Completed'].map(status => `
                                <option value="${status}" ${client.meta.status === status ? 'selected' : ''}>${status}</option>
                            `).join('')}
                        </select>
                    </div>
                    <div class="card-body">
                        <div class="hover-preview-zone" style="position:relative; display:inline-block;">
                            <div class="small muted">Onboarded: ${client.meta.onboarded}</div>
                            <div class="task-preview-tooltip">
                                <div class="bold tiny accent" style="margin-bottom:5px; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:3px;">Recent Activity</div>
                                ${recentTasks.length ? recentTasks.map(t => `<div class="tiny muted" style="margin-bottom:2px;">• ${esc(t.task)}</div>`).join('') : '<div class="tiny muted">No recent tasks</div>'}
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
    },
    sharedMasterIds: [],
  };
  state.activeClientId = clientId;
  OL.persist();
  location.hash = "#/client-tasks";
};

//=======BUILD CLIENT PROFILE SETTINGS / LINK / DELETE PROFILE ===========//
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
                    { id: 'visualizer', label: 'Flow Map' },
                    { id: 'scoping', label: 'Scoping' },
                    { id: 'analysis', label: 'Analysis' },
                    { id: 'how-to', label: 'How-To' },
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

OL.switchClient = function (id) {
    state.activeClientId = id;
    sessionStorage.setItem('lastActiveClientId', id); // 🚩 Save to browser memory
    window.location.hash = "#/client-tasks";
    window.handleRoute();
}

OL.setDashboardFilter = function(filterName) {
    state.dashboardFilter = filterName;
    // We don't necessarily need to persist this to Firebase (local session is fine)
    window.renderClientDashboard();
};

OL.updateClientStatus = function(clientId, newStatus) {
    const client = state.clients[clientId];
    if (!client) return;

    client.meta.status = newStatus;
    
    // Save to Firestore
    OL.persist();
    
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
                              <button class="card-delete-btn" onclick="OL.universalDelete('${app.id}', 'apps', event)">×</button>
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
    const hash = window.location.hash;
    const isVaultRoute = hash.startsWith('#/vault');

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
    if (!app) {
        console.error("❌ Modal Error: App object not found for ID:", appId);
        // Optional: Close modal if it's broken to prevent white-screen
        // OL.closeModal(); 
        return; 
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

    const isAdmin = state.adminMode === true;
    const isLinkedToMaster = !!app.masterRefId;
    const canPushToMaster = isAdmin && !isVaultRoute && !isLinkedToMaster;

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
            ${canPushToMaster ? `
                <button class="btn tiny primary" 
                        onclick="OL.pushLocalAppToMaster('${app.id}')"
                        style="background: var(--accent); color: var(--main-text); font-weight: bold; border:none;">
                    ⭐ PUSH TO MASTER
                </button>
            ` : ''}
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
        <div class="status-legend" style="display:flex; justify-content: space-between; margin-bottom:12px; align-items:center; width: 100%;">
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
        <div class="dp-manager-row master-spec" style="background: var(--panel-soft); border-left: 2px solid transparent;">
            <div style="display:flex; gap:10px; flex:1;">
                <span class="pill tiny soft">${cap.type}</span>
                <div class="dp-name-cell muted" style="cursor: default;">${esc(cap.name)}</div>
            </div>
            <div style="display:flex; align-items:center; gap:8px;">
                ${isAdmin ? `
                    <span class="card-close" 
                          style="cursor:pointer; padding-right:5px; font-size: 18px; color: var(--text-dim);" 
                          onclick="event.stopPropagation(); OL.removeMasterCapabilityFromApp('${app.id}', ${idx})">×</span>
                ` : `
                    <span class="tiny muted" style="padding-right:10px; font-size: 10px;">🔒</span>
                `}
            </div>
        </div>
    `).join('');

    // --- RENDER LOCAL SPECS ---
    html += localSpecs.map((cap, idx) => {
        const isAdmin = state.adminMode === true || window.location.search.includes('admin=pizza');
        const isPushed = !!cap.masterRefId;
        const canEdit = (!isPushed || isAdmin);

        return `
        <div class="dp-manager-row local-spec" style="display:flex; align-items:center; gap:10px; padding:6px; border-bottom:1px solid var(--line);">
            
            <span class="pill tiny ${cap.type === 'Trigger' ? 'accent' : 'soft'}" 
                style="cursor: ${canEdit ? 'pointer' : 'default'}; min-width: 60px; text-align: center; user-select: none;"
                onmousedown="if(${canEdit}) { event.stopPropagation(); OL.toggleCapabilityType(event, '${app.id}', ${idx}); }">
                ${cap.type || 'Action'}
            </span>

            <div class="dp-name-cell" 
                contenteditable="${canEdit ? 'true' : 'false'}" 
                style="flex: 1; cursor: ${canEdit ? 'text' : 'default'}; padding: 4px; outline: none;"
                onmousedown="event.stopPropagation();"
                onblur="OL.updateLocalCapability('${app.id}', ${idx}, 'name', this.textContent)">
                ${esc(cap.name)}
            </div>

            <div style="display:flex; gap:5px; align-items:center;">
                ${isAdmin && !isPushed && !!app.masterRefId ? `
                    <button class="btn tiny primary" onclick="OL.pushSpecToMaster('${app.id}', ${idx})">⭐ PUSH</button>
                ` : ''}
                
                ${canEdit ? `
                    <span class="card-close" style="cursor:pointer; font-size:18px; padding:0 8px;" 
                        onmousedown="event.stopPropagation(); OL.removeLocalCapability('${app.id}', ${idx})">×</span>
                ` : `<span class="tiny muted">🔒</span>`}
            </div>
        </div>`;
    }).join('');

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
                                <button class="card-delete-btn" onclick="event.stopPropagation(); OL.universalDelete('${fn.id}', 'functions', event)">×</button>
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
            ${canPushFunction ? `
            <button class="btn tiny primary" 
                    onclick="OL.pushLocalFunctionToMaster('${fn.id}')"
                    style="background: var(--accent); color: var(--main-text); font-weight: bold; margin-right:10px;">
                ⭐ PUSH TO MASTER
            </button>
        ` : ''}
        </div>
        <div class="modal-body">
            ${renderFunctionModalInnerContent(fn, safeClient)}
        </div>
    `;
    window.openModal(html);
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
    { type: "Zap", typeKey: "zap", archetype: "Multi-Step", icon: "⚡" },
    { type: "Form", typeKey: "form", archetype: "Base", icon: "📄" },
    { type: "Email", typeKey: "email", archetype: "Base", icon: "📧" },
    { type: "Event", typeKey: "event", archetype: "Base", icon: "🗓️" },
    { type: "SOP", typeKey: "sop", archetype: "Base", icon: "📖" },
    { type: "Signature", typeKey: "signature", archetype: "Base", icon: "✍️" }
  ];
}

window.renderResourceManager = function () {
    OL.registerView(renderResourceManager);
    const container = document.getElementById("mainContent");
    const client = getActiveClient();
    const hash = window.location.hash;

    const isVaultView = hash.startsWith('#/vault');
    const isAdmin = state.adminMode === true;

    let displayRes = isVaultView ? (state.master.resources || []) : (client?.projectData?.localResources || []);

    // 🔎 SEARCH & FILTER LOGIC
    const query = (state.libSearch || "").toLowerCase();
    const activeType = state.libTypeFilter || 'All';

    const filtered = displayRes.filter(res => {
        const matchesSearch = (res.name || "").toLowerCase().includes(query) || 
                             (res.description || "").toLowerCase().includes(query);
        const matchesType = activeType === 'All' || res.type === activeType;
        // Optional: Hide workflows from this view if you only want technical assets
        const isNotWorkflow = res.type !== 'Workflow'; 
        return matchesSearch && matchesType && isNotWorkflow;
    });

    const uniqueTypes = [...new Set(displayRes.map(r => r.type).filter(t => t && t !== 'Workflow'))].sort();

    // Grouping logic
    const grouped = filtered.reduce((acc, res) => {
        const type = res.type || "General";
        if (!acc[type]) acc[type] = [];
        acc[type].push(res);
        return acc;
    }, {});

    const sortedTypes = Object.keys(grouped).sort();

    container.innerHTML = `
        <div class="section-header">
            <div>
                <h2>📦 ${isVaultView ? 'Master Vault' : 'Project Library'}</h2>
                <div class="small muted">${filtered.length} items found</div>
            </div>
            <div class="header-actions">
                ${isAdmin ? `<button class="btn small soft" onclick="OL.openResourceTypeManager()">⚙️ Types</button>` : ''}
                
                <div class="dropdown-plus-container" style="display:inline-block; position:relative;">
                    <button class="btn primary" style="font-weight:bold;">+ New Resource</button>
                    <div class="dropdown-plus-menu" style="right: 0; left: auto;">
                        <label class="tiny muted bold uppercase" style="padding: 10px 15px; display: block; border-bottom: 1px solid rgba(255,255,255,0.1); letter-spacing: 0.5px;">Select Classification</label>
                        ${(state.master.resourceTypes || []).map(t => `
                            <div class="dropdown-item" onclick="OL.universalCreate('${t.type}')">
                                ${OL.getRegistryIcon(t.type)} ${t.type}
                            </div>
                        `).join('')}
                        <div class="dropdown-item" onclick="OL.universalCreate('SOP')" style="border-top: 1px solid rgba(255,255,255,0.1);">
                            📄 Basic SOP
                        </div>
                    </div>
                </div>

                ${!isVaultView && isAdmin ? `
                    <button class="btn primary" style="background:#38bdf8; color:black; font-weight:bold;" onclick="OL.importFromMaster()">⬇️ Import</button>
                ` : ''}
            </div>
        </div>

        <div class="toolbar" style="display:flex; gap:15px; margin: 20px 0; background:rgba(255,255,255,0.03); padding:15px; border-radius:8px; border: 1px solid var(--line);">
            <input type="text" id="resource-lib-search" class="modal-input" 
                placeholder="Search..." value="${state.libSearch || ''}"
                oninput="state.libSearch = this.value; renderResourceManager(); OL.refocus('resource-lib-search')">
            
            <select class="modal-input" style="flex:1;" onchange="state.libTypeFilter = this.value; renderResourceManager()">
                <option value="All">All Categories</option>
                ${uniqueTypes.map(t => `<option value="${t}" ${activeType === t ? 'selected' : ''}>${t}</option>`).join('')}
            </select>
        </div>

        <div class="resource-sections-wrapper">
            ${sortedTypes.length > 0 ? sortedTypes.map(type => `
                <div class="resource-group" style="margin-bottom: 40px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; border-bottom: 1px solid var(--accent); padding-bottom: 8px; margin-bottom:15px;">
                        <h3 style="margin:0; font-size: 13px; text-transform: uppercase; color: var(--accent); letter-spacing: 0.1em;">
                            ${OL.getRegistryIcon(type)} ${esc(type)}s
                        </h3>
                        <button class="btn tiny soft" onclick="OL.promptBulkReclassify('${type}')">Bulk Move</button>
                    </div>
                    <div class="cards-grid">
                        ${grouped[type]
                            .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
                            .map(res => renderResourceCard(res))
                            .join("")}
                    </div>
                </div>
            `).join("") : `
                <div class="empty-hint" style="padding: 40px; text-align: center; opacity: 0.5;">
                    No resources matching your search.
                </div>
            `}
        </div>
    `;
};

OL.universalCreate = async function(type, options = {}) {
    const { name: predefinedName, linkToWfId, insertIdx } = options;
    
    // 1. Get Name
    const name = predefinedName || prompt(`Enter ${type} Name:`);
    if (!name) return null;

    const context = OL.getCurrentContext();
    const data = context.data;
    if (!data) return console.error("❌ Context Data not found");

    // 2. Generate Identity
    const timestamp = Date.now();
    const newId = context.isMaster ? `res-vlt-${timestamp}` : `local-prj-${timestamp}`;

    // 3. Define Default Archetype based on Type
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

    // 4. Atomic Database Update
    await OL.updateAndSync(() => {
        // A. Add to Library
        const targetLibrary = context.isMaster ? data.resources : data.localResources;
        targetLibrary.push(newRes);

        // B. Optional: Link to a Workflow (Scenario: Inline Builder)
        if (linkToWfId) {
            const wf = targetLibrary.find(r => String(r.id) === String(linkToWfId));
            if (wf) {
                if (!wf.steps) wf.steps = [];
                wf.steps.splice(insertIdx ?? wf.steps.length, 0, {
                    id: uid(),
                    resourceLinkId: newId
                });
            }
        }
    });

    // 5. UI Orcherstration
    if (linkToWfId) {
        OL.refreshMap();
        setTimeout(() => OL.loadInspector(newId, linkToWfId), 100);
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
    const quickIcons = ["⚡", "📄", "📧", "📅", "🔌", "📖", "🏠", "💬", "🛠️", "🎯", "🤖", "📈"];

    let html = `
        <div class="modal-head">
            <div class="modal-title-text">⚙️ Manage Resource Types</div>
            <div class="spacer"></div>
        </div>
        <div class="modal-body">
            <p class="tiny muted" style="margin-bottom:20px;">
                Define categories and icons. Every resource assigned to these types will inherit the icon automatically.
            </p>
            
            <div class="dp-manager-list" style="max-height: 300px; overflow-y: auto; padding-right: 5px;">
                ${registry.map(t => {
                    const encType = btoa(t.type);
                    return `
                    <div class="dp-manager-row" style="margin-bottom: 8px; background: var(--panel-soft); padding: 10px; border-radius: 6px; display:flex; gap:12px; align-items:center;">
                        <span contenteditable="true" 
                              class="icon-edit-box"
                              onblur="OL.updateResourceTypeProp('${t.typeKey}', 'icon', this.innerText)">
                            ${t.icon || '⚙️'}
                        </span>

                        <span contenteditable="true" 
                              style="font-weight:600; flex:1; cursor: text;"
                              onblur="OL.renameResourceTypeFlat('${encType}', this.innerText)">
                            ${esc(t.type)}
                        </span>
                        
                        <button class="card-delete-btn" style="position:static" onclick="OL.removeRegistryTypeByKey('${t.typeKey}')">×</button>
                    </div>`;
                }).join('')}
            </div>

            <div style="margin-top:20px; padding-top:20px; border-top: 1px solid var(--panel-border);">
                <label class="modal-section-label">Quick Add New Type</label>
                <div style="display:flex; gap:8px; margin-bottom: 12px;">
                    <input type="text" id="new-type-icon" class="modal-input" style="width:50px; text-align:center; font-size: 18px;" placeholder="⚙️" maxlength="2">
                    <input type="text" id="new-type-input" class="modal-input" style="flex:1;" placeholder="New Type Name...">
                    <button class="btn primary" onclick="OL.addNewResourceTypeFlat()">Add Type</button>
                </div>
                
                <div class="emoji-quick-grid" style="display: grid; grid-template-columns: repeat(6, 1fr); gap: 5px;">
                    ${quickIcons.map(icon => `
                        <div class="emoji-option" onclick="document.getElementById('new-type-icon').value='${icon}'">${icon}</div>
                    `).join('')}
                </div>
            </div>
        </div>`;
    openModal(html);
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
    renderGlobalVisualizer(location.hash.includes('vault')); // Update the Sidebar icons
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
        console.log(`✅ Updated Type Registry: ${entry.type} is now ${value}`);
        // Refresh the visualizer so the sidebar/inspector immediately reflect the new icon
        renderGlobalVisualizer(location.hash.includes('vault'));
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
    
    // 1. Determine Identity & Permissions
    const isAdmin = state.adminMode === true;
    const isVaultItem = String(res.id || "").startsWith("res-vlt-");
    const isLinkedToMaster = !!res.masterRefId;
    const isMaster = isVaultItem || isLinkedToMaster;

    // 2. Logic: Admins can delete anything. 
    // Clients can ONLY delete if it's not a Master/Synced item.
    const canDelete = isAdmin || !isMaster;

    const scopingItem = OL.isResourceInScope(res.id);
    const isInScope = !!scopingItem;
    
    const tagLabel = isMaster ? "MASTER" : "LOCAL";
    const tagStyle = isMaster 
        ? "background: var(--accent); border: none;" 
        : "background: var(--panel-border); color: var(--text-dim); border: 1px solid var(--line);";

    return `
        <div class="card is-clickable ${isInScope ? 'is-priced' : ''}" 
             onclick="OL.openResourceModal('${res.id}')"
             style="${isInScope ? 'border-left: 3px solid #10b981 !important;' : ''}">
            <div class="card-header">
                <div class="card-title">${esc(res.name || "Unnamed")}</div>
                <div style="display:flex; align-items:center; gap:8px;">
                    ${isInScope ? `
                        <button class="btn tiny" style="background:#10b981; color:white; padding:2px 6px; font-size:10px; border:none;" 
                                onclick="event.stopPropagation(); OL.jumpToScopingItem('${res.id}')">$</button>
                    ` : ''}
                    <span class="vault-tag" style="${tagStyle}">${tagLabel}</span>
                    <button class="card-delete-btn" onclick="event.stopPropagation(); OL.universalDelete('${res.id}', 'resources')">×</button>
                </div>
            </div>
            <div class="card-body">
                <div class="tiny accent bold uppercase">${esc(res.archetype || "Base")}</div>
                <div class="tiny muted">${esc(res.type || "General")}</div>
            </div>
        </div>
    `;
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
    if (window.renderVisualizerV2) window.renderVisualizerV2(isVault);
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
    if (!targetId) return;

    const isAdmin = state.adminMode === true || window.location.search.includes('admin=');
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
              style="font-size: 9px; padding: 2px 8px; border-radius: 100px; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 700; border: 1px solid rgba(255,255,255,0.1);">
            ${isAlreadyMaster ? '🏛️ Master' : '📍 Local' }
        </span>`;
    
    const typePill = `
        <div style="position: relative; display: inline-block;">
            <span class="pill tiny soft is-clickable" 
                  onclick="document.getElementById('res-type-selector').click()"
                  style="font-size: 9px; padding: 2px 8px; border-radius: 100px; text-transform: uppercase; cursor: pointer; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2);">
                ${esc(res.type || 'General')} ▾
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

    // Back button to go back to flow map if jumped from scope button
    const backBtn = state.v2.returnTo ? `
        <button class="btn-back-to-flow" onclick="OL.returnToFlow()">
            ⬅ Back to Flow
        </button>
    ` : '';
   
    // --- Inside OL.openResourceModal ---
    const resType = (res.type || "General").toLowerCase();
        let typeSpecificHtml = "";

        if (resType === "email") {
            const team = client?.projectData?.teamMembers || [];
            
            typeSpecificHtml = `
            <div class="card-section" style="background: rgba(255,255,255,0.02); padding: 15px; border-radius: 8px; border: 1px solid var(--line); margin-top: 20px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 15px;">
                    <label class="modal-section-label" style="color: var(--accent); margin:0;">✉️ EMAIL COMPOSITION</label>
                    <button class="btn tiny primary" onclick="OL.previewEmailTemplate('${res.id}')">👁️ Preview Template</button>
                </div>
                
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                    <div class="modal-column">
                        <label class="tiny muted bold">FROM (Team Member)</label>
                        <select class="modal-input tiny" onchange="OL.handleResourceSave('${res.id}', 'emailFrom', this.value)">
                            <option value="">Select Sender...</option>
                            ${team.map(m => `<option value="${m.id}" ${res.emailFrom === m.id ? 'selected' : ''}>👨‍💼 ${esc(m.name)}</option>`).join('')}
                        </select>
                    </div>
                    <div class="modal-column">
                        <label class="tiny muted bold">TO (Contact Type)</label>
                        <select class="modal-input tiny" onchange="OL.handleResourceSave('${res.id}', 'emailToType', this.value)">
                            <option value="">Select Recipient...</option>
                            <option value="Household" ${res.emailToType === 'Household' ? 'selected' : ''}>🏠 Household</option>
                            <option value="Client 1" ${res.emailToType === 'Client 1' ? 'selected' : ''}>👤 Client 1</option>
                            <option value="Client 2" ${res.emailToType === 'Client 2' ? 'selected' : ''}>👤 Client 2</option>
                            <option value="COI" ${res.emailToType === 'COI' ? 'selected' : ''}>🤝 COI (Professional)</option>
                        </select>
                    </div>
                </div>

                <div style="margin-top: 12px;">
                    <label class="tiny muted bold">SUBJECT LINE</label>
                    <input type="text" class="modal-input" placeholder="Enter email subject..." 
                        value="${esc(res.emailSubject || '')}" 
                        onblur="OL.handleResourceSave('${res.id}', 'emailSubject', this.value)">
                </div>

                <div style="margin-top: 12px;">
                    <label class="tiny muted bold">EMAIL BODY</label>
                    <textarea class="modal-textarea" style="min-height: 180px; font-family: 'Inter', sans-serif; font-size: 13px;" 
                            placeholder="Write email template here..."
                            onblur="OL.handleResourceSave('${res.id}', 'emailBody', this.value)">${esc(res.emailBody || '')}</textarea>
                </div>

                <div style="margin-top: 12px; padding: 8px; background: rgba(var(--accent-rgb), 0.05); border-radius: 4px;">
                    <label class="tiny muted bold">SIGNATURE STATUS</label>
                    <div class="tiny">
                        ${res.emailFrom ? '✅ Signature will be pulled from selected Team Member.' : '⚠️ Select a "FROM" sender to enable signature preview.'}
                    </div>
                </div>
            </div>
        `;
    }

    const miniMapsHtml = OL.renderResourceMiniMaps(res.id);

    // --- 🗓️ SECTION: WORKFLOW PHASE ---
    const hash = window.location.hash;
    const isScopingSheet = hash.includes('scoping-sheet');
    let roundInputHtml = "";
    let hierarchyHtml = "";
    if (lineItem || isScopingSheet) {
        const activeId = lineItem ? lineItem.id : targetId;
        const currentRound = lineItem ? (lineItem.round || 1) : 1;
        roundInputHtml = `
            <div class="card-section" style="margin-bottom: 20px; background: rgba(56, 189, 248, 0.05); padding: 15px; border-radius: 8px; border: 1px solid var(--accent);">
                <label class="modal-section-label" style="color: var(--accent);">🗓️ IMPLEMENTATION STAGE</label>
                <div class="form-group" style="margin-top: 10px;">
                    <label class="tiny muted uppercase bold">Round / Phase Number</label>
                    <input type="number" class="modal-input" value="${currentRound}" min="1"
                           onchange="OL.updateLineItem('${activeId}', 'round', this.value)">
                </div>
            </div>`;
    }
    else {
        hierarchyHtml = `
            <div class="modal-hierarchy-container" style="margin: 10px 0 20px 36px; max-width: 400px;">
                ${OL.renderHierarchySelectors(res, isVaultMode)}
            </div>`;
    }

    // --- 📊 SECTION: ADMIN PRICING ---
    const relevantVars = Object.entries(state.master.rates?.variables || {}).filter(([_, v]) => 
        String(v.applyTo).toLowerCase() === String(res.type).toLowerCase()
    );
    
    const adminPricingHtml = isAdmin ? `
        <div class="card-section" style="margin-bottom: 20px; padding: 15px; background: rgba(255,255,255,0.02); border: 1px solid var(--line); border-radius: 8px;">
            <label class="modal-section-label">⚙️ PRICING CONFIG</label>
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px; margin-top:10px;">
                ${relevantVars.length > 0 ? relevantVars.map(([varKey, v]) => `
                    <div class="modal-column">
                        <label class="tiny muted">${esc(v.label)} ($${v.value})</label>
                        <input type="number" class="modal-input tiny" 
                            value="${num(activeData.data?.[varKey])}" 
                            oninput="OL.updateResourcePricingData('${activeData.id}', '${varKey}', this.value)">
                    </div>`).join("") : '<div class="tiny muted italic" style="grid-column: 1/-1;">No pricing variables found for this type.</div>'}
            </div>
        </div>` : '';

    // --- 📝 SECTION: LINKED MASTER GUIDES ---
    const linkedSOPs = (state.master.howToLibrary || []).filter(ht => 
        (ht.resourceIds || []).includes(res.masterRefId || res.id)
    );
    
    const sopLibraryHtml = `
        <div class="card-section" style="margin-bottom:20px;">
            <label class="modal-section-label">📚 LINKED MASTER GUIDES</label>
            <div style="display:flex; flex-wrap:wrap; gap:8px; margin-top:10px;">
                ${linkedSOPs.length > 0 ? linkedSOPs.map(sop => `<span class="pill soft tiny">📖 ${esc(sop.name)}</span>`).join("") : '<span class="tiny muted">No guides linked to this resource template.</span>'}
            </div>
        </div>`;

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

    // --- 🚀 FINAL ASSEMBLY ---
    const html = `
        <div class="modal-head" style="padding: 20px; border-bottom: 1px solid var(--line); background: var(--panel-dark);">
            <div style="display: flex; flex-direction: column; gap: 12px; width: 100%;">
                
                <div style="display: flex; align-items: flex-start; gap: 12px; width: 100%;">
                    <span style="font-size: 24px; margin-top: 2px; flex-shrink: 0;">🛠️</span>
                    <div style="flex-grow: 1;">
                        <textarea class="header-editable-input" id="modal-res-name"
                            placeholder="Resource Name..."
                            style="background: transparent; border: none; color: inherit; 
                                font-size: 22px; font-weight: bold; width: 100%; 
                                outline: none; resize: none; overflow: hidden; 
                                padding: 0; line-height: 1.2; display: block;"
                            oninput="this.style.height = ''; this.style.height = this.scrollHeight + 'px';"
                            onblur="OL.handleResourceSave('${res.id}', 'name', this.value)">${esc(res.name || '')}</textarea>
                    </div>
                </div>

                <div style="display: flex; gap: 8px; align-items: center; padding-left: 36px;">
                    ${originPill}
                    ${typePill}
                    ${backBtn}

                    ${hasHistory ? `
                        <button class="btn tiny soft" style="color: black !important; background: #fff !important; font-weight:bold;" 
                                onclick="OL.navigateBack()">
                            ⬅️ Back
                        </button>
                    ` : ''}
                    
                    ${canPromote ? `
                    <button class="btn tiny primary" 
                            style="background: #fbbf24 !important; color: black !important; font-weight: bold; border: none;"
                            onclick="OL.pushToMaster('${res.id}')">
                        ⭐ Promote to Master
                    </button>
                ` : ''}
                </div>
            </div>
        </div>

        <div class="modal-body" style="max-height: 70vh; overflow-y: auto; padding: 20px;">
            ${roundInputHtml}
            ${hierarchyHtml}
            ${adminPricingHtml}

            <div class="card-section" style="margin-top:20px;">
                <label class="modal-section-label">📝 Description & Access Notes</label>
                <textarea class="modal-textarea" 
                        placeholder="Enter login details, account purpose, or specific access instructions..." 
                        style="min-height: 80px; font-size: 12px; width: 100%; background: rgba(0,0,0,0.2); border: 1px solid var(--line); border-radius: 4px; color: white; padding: 10px;"
                        onblur="OL.handleResourceSave('${res.id}', 'description', this.value)">${esc(res.description || '')}</textarea>
            </div>

            ${miniMapsHtml}
            <div class="card-section" style="margin-top:20px; padding-top:20px; border-top: 1px solid var(--line);">
                <label class="modal-section-label">📋 WORKFLOW STEPS</label>
                <div style="display:flex; gap:8px; width: 100%; padding-bottom: 10px;">
                    <button class="btn tiny primary" onclick="OL.launchDirectToVisual('${res.id}')">🎨 Visual Editor</button>
                </div>
                <div id="sop-step-list">
                    ${renderSopStepList(res)}
                </div>
            </div>
            ${sopLibraryHtml}
            
            <div class="card-section" style="margin-top:20px;">
                <label class="modal-section-label">🌐 External Link & Source</label>
                <div style="display:flex; gap:10px; margin-bottom:10px;">
                    <input type="text" class="modal-input tiny" 
                        style="flex: 1;"
                        placeholder="https://app.example.com" 
                        value="${esc(res.externalUrl || '')}" 
                        onblur="OL.handleResourceSave('${res.id}', 'externalUrl', this.value); OL.openResourceModal('${res.id}')">
                    
                    ${res.externalUrl ? `
                        <button class="btn soft tiny" style="color: black !important; padding: 0 12px;" 
                                onclick="OL.copyToClipboard('${esc(res.externalUrl)}', this)" title="Copy Link">
                            📋 Copy
                        </button>
                        <a href="${res.externalUrl}" target="_blank" class="btn primary tiny" 
                           style="display: flex; align-items: center; gap: 4px; text-decoration: none; background: var(--accent); color: black; font-weight: bold; padding: 0 12px;">
                            ↗️ Open
                        </a>
                    ` : ''}
                </div>
                ${!res.externalUrl ? `<div class="tiny muted italic">No link provided for this resource.</div>` : ''}
            </div>

            <div class="card-section" style="margin-top:20px; border-top: 1px solid rgba(255,255,255,0.05); padding-top:15px;">
                <label class="modal-section-label">🔗 Connected Relationships</label>
                
                <div style="display: flex; gap: 5px; margin: 8px 0; overflow-x: auto; padding-bottom: 5px;">
                    ${types.map(t => `
                        <span onclick="state.ui.relationshipFilter = '${t}'; OL.openResourceModal('${targetId}')" 
                              style="font-size: 9px; padding: 2px 8px; border-radius: 100px; cursor: pointer; 
                              background: ${activeFilter === t ? 'var(--accent)' : 'rgba(255,255,255,0.05)'};
                              color: ${activeFilter === t ? '#000' : '#94a3b8'}; border: 1px solid rgba(255,255,255,0.1);">
                            ${t.toUpperCase()}
                        </span>
                    `).join('')}
                </div>
            
                <div style="display: flex; flex-direction: column; gap: 6px;">
                    ${filteredConnections.length > 0 ? filteredConnections.map(conn => {
                        const isScopingEnv = window.location.hash.includes('scoping-sheet');
                        const navAction = isScopingEnv 
                            ? `OL.openResourceModal('${conn.id}')` 
                            : `OL.loadInspector('${conn.id}')`;

                        return ` 
                            <div class="pill accent is-clickable" 
                                style="display:flex; align-items:center; justify-content: space-between; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.1); cursor: pointer !important; position: relative; z-index: 9999;"
                                onmousedown="event.preventDefault(); event.stopPropagation(); if(window.OL.closeModal) OL.closeModal(); ${navAction}">

                                <div style="display: flex; align-items: center; gap: 8px; pointer-events: none;">
                                    <span style="font-size: 12px;">${OL.getRegistryIcon(conn.type)}</span>
                                    <div style="display:flex; flex-direction:column;">
                                        <span style="font-size: 11px; color: #eee;">${esc(conn.name)}</span>
                                        <span style="font-size: 8px; color: var(--accent); opacity: 0.8;">${conn.type.toUpperCase()}</span>
                                    </div>
                                </div>
                                <span style="font-size: 9px; opacity: 0.5; pointer-events: none;">
                                    ${isScopingEnv ? 'Open Modal ↗' : 'Inspect ➔'}
                                </span>
                            </div>
                        `;
                    }).join('') : `
                        <div class="tiny muted" style="padding: 10px; text-align: center;">
                            ${activeFilter === 'All' ? 'No connections found.' : `No ${activeFilter} links found.`}
                        </div>
                    `}
                </div>
            </div>

            ${typeSpecificHtml}
        </div>
    `;
    
    openModal(html);
    setTimeout(() => {
        const el = document.getElementById('modal-res-name');
        if (el) el.style.height = el.scrollHeight + 'px';
    }, 10);
};

OL.renderResourceMiniMaps = function(targetResId, specificStepId = null) {
    const client = getActiveClient();
    const allResources = (client?.projectData?.localResources || []);
    let html = `<div class="card-section"><label class="modal-section-label">🕸️ FLOW CONTEXT</label><div style="display: flex; flex-direction: column; gap: 24px; margin-top: 15px;">`;

    let instances = [];
    allResources.forEach(container => {
        const steps = container.steps || container.proceduralSteps || [];
        steps.forEach((step, idx) => {
            if (String(step.resourceLinkId) === String(targetResId)) {
                instances.push({ container, step, idx });
            }
        });
    });

    if (instances.length === 0) {
        return `
            <div class="card-section">
                <label class="modal-section-label">🕸️ FLOW CONTEXT</label>
                <div class="mini-map-container" style="text-align:center; padding: 20px; opacity: 0.6;">
                    <div class="tiny muted">Standalone resource: No preceding or following steps found.</div>
                </div>
            </div>`;
    }

    html += instances.map(inst => {
        const stepsArray = inst.container.steps || inst.container.proceduralSteps || [];
        
        // 🟢 FIXED VARIABLE NAMES
        const preceding = stepsArray[inst.idx - 1] ? [stepsArray[inst.idx - 1]] : [];
        const following = stepsArray[inst.idx + 1] ? [stepsArray[inst.idx + 1]] : [];

        // Logic Bridge for Start/End of containers
        if (preceding.length === 0) {
            const triggers = allResources.filter(r => (r.logicLinks || []).some(l => String(l.targetId) === String(inst.container.id)));
            preceding.push(...triggers);
        }
        if (following.length === 0) {
            const outcomes = (inst.container.logicLinks || []).map(l => OL.getResourceById(l.targetId)).filter(Boolean);
            following.push(...outcomes);
        }

        return `
            <div class="mini-map-container" style="background: rgba(0,0,0,0.2); padding: 20px 15px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.05);">
                <div class="tiny muted uppercase bold" style="margin-bottom: 15px; font-size: 8px; text-align: center; opacity: 0.5;">
                    Instance in: ${esc(inst.container.name)}
                </div>
                <div style="display: grid; grid-template-columns: 1fr 40px 1.2fr 40px 1fr; align-items: center; gap: 5px;">
                    <div style="display: flex; flex-direction: column; gap: 5px; align-items: flex-end;">
                        ${preceding.length > 0 ? preceding.map(p => renderMiniNode(p, 'muted')).join('') : '<span class="tiny muted">Start</span>'}
                    </div>
                    <div class="mini-arrow">→</div>
                    <div style="display: flex; justify-content: center;">
                        ${renderMiniNode(inst.step, 'active')}
                    </div>
                    <div class="mini-arrow">→</div>
                    <div style="display: flex; flex-direction: column; gap: 5px; align-items: flex-start;">
                        ${following.length > 0 ? following.map(f => renderMiniNode(f, 'muted')).join('') : '<span class="tiny muted">End</span>'}
                    </div>
                </div>
            </div>
        `;
    }).join('');

    return html + `</div></div>`;
};

// Helper to render the individual blocks
function renderMiniNode(item, status) {
    if (!item) return "";
    
    // Resolve Resource ID: Could be item.resourceLinkId (a step) or item.id (a full resource)
    const resId = item.resourceLinkId || item.id;
    const res = OL.getResourceById(resId);
    
    const icon = OL.getRegistryIcon(res?.type || item.type || 'SOP');
    const isActive = status === 'active';
    const name = item.name || res?.name || "Unnamed Step";
    
    return `
        <div class="mini-node ${status}" style="${isActive ? 'border: 2px solid #fbbf24; background: rgba(251, 191, 36, 0.15); box-shadow: 0 0 15px rgba(251, 191, 36, 0.1);' : ''}">
            <div class="mini-node-content">
                <div class="mini-icon-circle" style="${isActive ? 'color: #fbbf24;' : ''}">${icon}</div>
                <div style="font-weight: ${isActive ? 'bold' : 'normal'}; color: ${isActive ? '#fff' : '#cbd5e1'};">
                    ${esc(name)}
                </div>
            </div>
        </div>
    `;
}

OL.expandFlowMap = function(wfId, activeIdx) {
    const wf = OL.getResourceById(wfId);
    if (!wf) return;

    const start = Math.max(0, activeIdx - 2);
    const end = Math.min(wf.steps.length, activeIdx + 3);
    const slice = wf.steps.slice(start, end);

    const html = `
        <div class="modal-head">
            <div class="modal-title-text">🕸️ Full Sequence: ${esc(wf.name)}</div>
        </div>
        <div class="modal-body" style="padding: 80px 40px; display: flex; align-items: center; justify-content: center; overflow-x: auto; background: #050816;">
            <div style="display: flex; align-items: center; gap: 25px;">
                ${slice.map((step, i) => {
                    const isActualTarget = (start + i === activeIdx);
                    const res = OL.getResourceById(step.resourceLinkId);
                    const icon = OL.getRegistryIcon(res?.type || 'SOP');
                    
                    return `
                        <div class="mini-node ${isActualTarget ? 'active' : 'muted'}" 
                             style="width: 150px; font-size: 11px; padding: 20px; min-height: 80px; flex-shrink: 0;">
                            <div class="mini-node-content">
                                <div class="mini-icon-circle" style="width: 32px; height: 32px; font-size: 18px;">${icon}</div>
                                <div>${esc(step.name)}</div>
                            </div>
                        </div>
                        ${(i < slice.length - 1) ? '<div class="mini-arrow" style="font-size: 24px; opacity: 0.8;">→</div>' : ''}
                    `;
                }).join('')}
            </div>
        </div>
        <div class="modal-foot">
            <button class="btn primary full" onclick="OL.closeModal()">Return to SOP</button>
        </div>
    `;
    
    openModal(html); 
};

// HANDLE WOKRFLOW VISUALIZER / FULL SCREEN MODE
// Global Workspace Logic
OL.launchDirectToVisual = function(resId) {
    console.log("🚀 Launching Level 3 Visualizer for Resource:", resId);
    
    // 1. Close the current modal layer
    OL.closeModal();
    
    // 2. Set the Level 3 Focus
    state.focusedResourceId = resId; 
    
    // 3. Ensure we have a Level 2 parent context if possible
    // (If we came from the library, focusedWorkflowId might be null, which is fine)
    
    // 4. Trigger the unified visualizer
    const isVaultMode = location.hash.includes('vault');
    renderGlobalVisualizer(isVaultMode);
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
            <div style="line-height: 1.6; white-space: pre-wrap; font-size: 15px; color:#222;">${esc(res.emailBody || '...')}</div>
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

OL.handleResourceSave = async function(id, field, value) {
    const client = getActiveClient();
    const isVaultMode = window.location.hash.includes('vault');
    
    // 1. Resolve Target
    let res = state.master.resources.find(r => r.id === id);
    if (!res && client) {
        res = (client.projectData.localResources || []).find(r => r.id === id);
    }

    // 🚀 THE PERSISTENCE FIX: If it's a new draft, commit it immediately
    if (!res && id.startsWith('draft-')) {
        console.log("📝 Auto-committing draft...");
        await OL.handleModalSave(id, document.getElementById('modal-res-name')?.value || "New Resource");
        // Re-fetch res after commit
        res = isVaultMode 
            ? state.master.resources.find(r => r.id.includes(id.split('-').pop()))
            : client.projectData.localResources.find(r => r.id.includes(id.split('-').pop()));
    }

    if (res) {
        res[field] = value;
        await OL.persist(); // ⚡ Push to Cloud
        
        if (field === 'name') {
            document.querySelectorAll(`.res-card-title-${id}`).forEach(el => el.innerText = value || "Untitled");
        }
    }
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

OL.removeTrigger = function(resId, index) {
    const res = OL.getResourceById(resId);
    if (!res || !res.triggers) return;

    const triggerToDelete = res.triggers[index];
    
    // 1. Remove from triggers array
    res.triggers.splice(index, 1);

    // 2. 🚀 THE SYNC: Remove from steps array (Canvas)
    if (triggerToDelete) {
        res.steps = (res.steps || []).filter(s => 
            !(s.type === 'Trigger' && s.name === triggerToDelete.name)
        );
    }

    OL.persist();
    
    // Re-render both views if open
    OL.openResourceModal(resId); 
    if (state.focusedResourceId === resId) {
        renderGlobalVisualizer(location.hash.includes('vault'));
    }
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
OL.pushToMaster = async function(localResId) {
    const client = getActiveClient();
    const localRes = client?.projectData?.localResources?.find(r => r.id === localResId);

    if (!localRes) return;
    if (!state.adminMode) return alert("Admin Mode required.");

    if (!confirm(`Standardize "${localRes.name}"?\n\nThis will add it to the Global Master Vault for all future projects.`)) return;

    // 🚀 THE SYNC WRAPPER: Ensures both updates are pushed as one state change
    await OL.updateAndSync(() => {
        // 1. Create Global Master Clone
        const masterId = 'res-vlt-' + Date.now();
        const masterCopy = JSON.parse(JSON.stringify(localRes));
        
        masterCopy.id = masterId;
        masterCopy.createdDate = new Date().toISOString();
        masterCopy.originProject = client.meta.name;
        delete masterCopy.masterRefId; // Ensure the Master isn't linked to itself
        delete masterCopy.isScopingContext; 

        // 2. Add to Master Vault
        if (!state.master.resources) state.master.resources = [];
        state.master.resources.push(masterCopy);

        // 3. ✨ THE HYBRID LINK
        // Link the local copy and empty the steps so it "Inherits" from the Vault
        localRes.masterRefId = masterId;
        localRes.steps = []; 
    });

    // 4. UI Cleanup
    OL.closeModal();
    
    // Grid refresh is handled by the Real-Time Listener, but we call it 
    // manually here just to ensure instant local feedback.
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

OL.universalDelete = async function(id, type, options = {}) {
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


//======================= SOP STEP LOGIC =======================//

window.renderSopStepList = function (res) {
    if (!res) return "";

    // 1. Gather all "Triggers" (both dedicated array and trigger-type steps)
    const entryTriggers = res.triggers || [];
    const stepTriggers = (res.steps || []).filter(s => s.type === 'Trigger');
    
    // 2. Filter for only Actions in the Sequence section
    const actionSteps = (res.steps || []).filter(s => s.type !== 'Trigger'); 
    
    let html = "";

    // --- ⚡ SECTION 1: TRIGGERS (Combined) ---
    html += `
        <div class="triggers-container" style="margin-bottom: 20px; border-bottom: 1px solid rgba(255,191,0,0.1); padding-bottom: 10px;">
            <label class="tiny accent bold uppercase" style="color:var(--vault-gold)">⚡ Entry Triggers & Events</label>
            <div id="triggers-list" style="margin-top:8px;">
                ${entryTriggers.map(t => `
                    <div class="dp-manager-row">
                        <span class="bold tiny" style="color:#ffbf00">${esc(t.name)}</span>
                    </div>
                `).join("")}
                
                ${stepTriggers.map(s => `
                    <div class="dp-manager-row" style="background: rgba(255,191,0,0.05); border-left: 2px solid #ffbf00;">
                         <span class="tiny" style="margin-right:8px; opacity:0.5;">L3</span>
                         <input class="ghost-input tiny bold" 
                                style="color:#ffbf00"
                                value="${esc(s.name)}" 
                                onchange="OL.updateStepName('${res.id}', '${s.id}', this.value)">
                    </div>
                `).join("")}
            </div>
        </div>
    `;

    // --- 📝 SECTION 2: SEQUENTIAL ACTIONS ---
    html += `<label class="tiny muted bold uppercase">📝 Action Sequence</label>`;
    
    html += actionSteps.map((step, idx) => `
        <div class="step-group">
            <div class="dp-manager-row">
                <span class="tiny muted" style="min-width: 15px;">${idx + 1}</span>
                <input class="ghost-input tiny bold" 
                       style="width: 100%"
                       value="${esc(step.name)}" 
                       onchange="OL.updateStepName('${res.id}', '${step.id}', this.value)">
            </div>
        </div>
    `).join("");

    return html;
};

OL.toggleStepType = function(resId, stepId) {
    const res = OL.getResourceById(resId);
    const step = res.steps.find(s => s.id === stepId);
    if (step) {
        step.type = (step.type === 'Trigger') ? 'Action' : 'Trigger';
        OL.persist();
        // Refresh the FS overlay or list
        OL.addSopStep(resId); // Or a dedicated refresh call
    }
};

// Helper for Trigger Toggle
OL.toggleTrigDetails = function(event, resId, trigId) {
    if (event) event.stopPropagation();
    
    if (!(state.expandedTriggers instanceof Set)) state.expandedTriggers = new Set();
    
    if (state.expandedTriggers.has(trigId)) {
        state.expandedTriggers.delete(trigId);
    } else {
        state.expandedTriggers.add(trigId);
    }
    
    // RE-RENDER JUST THE LIST
    const res = OL.getResourceById(resId);
    document.getElementById('sop-step-list').innerHTML = renderSopStepList(res);
};

OL.openStepDetailModal = function(resId, stepId) {
    OL.trackNav(stepId, 'step', resId);

    const res = OL.getResourceById(resId);
    const step = res?.steps?.find(s => String(s.id) === String(stepId));
    if (!step) return;

    const client = getActiveClient();
    const allApps = [...(state.master.apps || []), ...(client?.projectData?.localApps || [])];
    
    // 🚀 THE FIX: Find linkedApp here so it's defined for the template below
    const linkedApp = allApps.find(a => String(a.id) === String(step.appId));

    const modalLayer = document.getElementById("modal-layer");
    const isModalVisible = modalLayer && modalLayer.style.display === "flex";
    const existingBody = document.querySelector('.modal-body');

    // Inner UI content (Description, Apps, Assignments, Links, Outcomes)
    const innerHtml = `
        <div class="card-section">
            <label class="modal-section-label">📱 Linked Application</label>
            <div style="display:flex; align-items:center; gap:10px; margin-bottom:10px;">
                ${linkedApp ? `
                    <div class="pill accent is-clickable" 
                        onclick="OL.openAppModal('${linkedApp.id}')"
                        style="display:flex; align-items:center; gap:8px; cursor:pointer; background:rgba(56, 189, 248, 0.1); border: 1px solid var(--accent); padding: 5px 12px; border-radius: 20px;">
                        📱 ${esc(linkedApp.name)}
                        <b class="pill-remove-x" style="margin-left:8px;" onclick="event.stopPropagation(); OL.updateAtomicStep('${resId}', '${stepId}', 'appId', '')">×</b>
                    </div>
                ` : '<span class="tiny muted">No app linked to this step</span>'}
            </div>
        </div>
        
        <div class="card-section" style="margin-top:20px;">
            <label class="modal-section-label">👨‍💼 Responsibility Assignment</label>
            <div style="display:flex; align-items:center; gap:10px; margin-bottom:10px;">
                ${step.assigneeName ? `
                <div class="pill accent is-clickable" 
                    style="display:flex; align-items:center; gap:8px; cursor:pointer; background:rgba(168, 85, 247, 0.1); border: 1px solid #a855f7;"
                    onclick="event.stopPropagation(); OL.openTeamMemberModal('${step.assigneeId}')">
                    
                    <span>${step.assigneeType === 'person' ? '👨‍💼' : (step.assigneeType === 'role' ? '🎭' : '👥')}</span>
                    <span style="font-weight:600;">${esc(step.assigneeName)}</span>
                    
                    <b class="pill-remove-x" 
                    style="margin-left:5px; opacity:0.6;" 
                    onclick="event.stopPropagation(); OL.executeAssignment('${resId}', '${stepId}', false, '', '', '')">×</b>
                </div>
            ` : '<span class="tiny muted">Unassigned</span>'}
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

        <div style="display:flex; flex-direction:column; gap:5px; margin-top: 20px;">
            <label class="modal-section-label" style="font-size:9px; color:var(--accent);">🔗 LINKED RESOURCES & GUIDES</label>
            <div id="step-resources-list-${step.id}">
                ${renderStepResources(res.id, step)}
            </div>
            <div class="search-map-container" style="position:relative; margin-top:5px;">
                <input type="text" class="modal-input tiny" 
                      placeholder="+ Link a Guide or SOP..." 
                      onfocus="OL.filterResourceSearch('${res.id}', '${step.id}', this.value)"
                      oninput="OL.filterResourceSearch('${res.id}', '${step.id}', this.value)">
                <div id="resource-results-${step.id}" class="search-results-overlay"></div>
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

    // 🚀 THE FIX: Use updateAtomicStep and avoid ID collisions
        if (isModalVisible && existingBody) {
            // 1. Swap the body content
            existingBody.innerHTML = innerHtml;
            
            // 2. FORCE THE HEADER INPUT TO SHOW THE STEP NAME
            const headerInput = document.querySelector('.header-editable-input');
            if (headerInput) {
                headerInput.value = step.name || "Untitled Step";
                // IMPORTANT: Update the onblur so it saves to the STEP, not the Resource
                headerInput.setAttribute('onblur', `OL.updateAtomicStep('${resId}', '${step.id}', 'name', this.value)`);
            }
            
            // 3. Update the "Back" button if it exists
            const headerZone = document.querySelector('.modal-head');
            if (headerZone && !headerZone.innerHTML.includes('Back to Resource')) {
                // If we just came from Resource view, we need the Back button
                const btn = document.createElement('button');
                btn.className = "btn small soft";
                btn.innerText = "Back to Resource";
                btn.onclick = () => OL.openResourceModal(resId);
                headerZone.appendChild(btn);
            }
        } else {
        const fullHtml = `
            <div class="modal-head" style="gap:15px;">
                <div style="display:flex; align-items:center; gap:10px; flex:1;">
                    <span style="font-size:18px;">⚙️</span>
                    <input type="text" class="header-editable-input" id="modal-step-name" 
                        value="${esc(val(step.name))}" 
                        placeholder="Step Name..."
                        style="background:transparent; border:none; color:inherit; font-size:18px; font-weight:bold; width:100%; outline:none;"
                        onblur="OL.updateAtomicStep('${resId}', '${step.id}', 'name', this.value)">
                </div>
                <div style="display: flex; gap: 8px;">
                    <button class="btn tiny soft" style="color: black !important; font-weight: bold; background: #fff !important;" 
                            onclick="OL.navigateBack()">
                        ⬅️ Back
                    </button>
                    <button class="btn tiny soft" style="color: black !important; font-weight: bold; background: #fff !important;" 
                            onclick="OL.openResourceModal('${resId}')">
                        🏠 Index
                    </button>
                </div>
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

    // 🛡️ THE FIX: Add 'type: "Action"' so the L3 Column filter catches it
    res.steps.push({ 
        id: newId, 
        name: "", 
        type: "Action", // 👈 Crucial for L3 visibility
        outcomes: [], 
        description: "",
        mapOrder: res.steps.length // Optional: helps keep sorting consistent
    });
    
    state.editingStepId = newId;
    OL.persist();

    // 🚀 THE FULLSCREEN FIX:
    const fsOverlay = document.getElementById('fs-canvas'); // 👈 Updated ID
    if (fsOverlay && fsOverlay.style.display !== 'none') {
        // Force the refresh of the L3 view
        fsOverlay.innerHTML = window.renderLevel3Canvas(resId);
    }else {
        const listEl = document.getElementById('sop-step-list');
        if (listEl) listEl.innerHTML = renderSopStepList(res);
    }
    
    // Auto-focus logic remains the same
    setTimeout(() => {
        const inputs = document.querySelectorAll('.ghost-input, .vis-input-ghost');
        if (inputs.length > 0) inputs[inputs.length - 1].focus();
    }, 150);
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
}

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
            <div class="fs-editor-wrap" style="padding: 40px 20px; overflow-y: auto; height: 100%; background: #050816;">
                <div style="max-width:900px; margin: 0 auto; background: var(--panel-bg); padding: 30px; border-radius: 12px; border: 1px solid var(--line); box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
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
        OL.launchDirectToVisual(resId);
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

// HANDLE RESOURCE AND SOP LINKING
function renderStepResources(resId, item, isTrigger = false, trigIdx = null) {
    const links = item.links || [];
    if (links.length === 0) return '<div class="tiny muted" style="padding: 5px;">No linked items.</div>';
    
    return links.map((link, idx) => {
        const isSOP = link.type === 'sop' || link.type === 'guide';
        const icon = isSOP ? '📖' : '📱';
        const openAction = isSOP ? `OL.openHowToModal('${link.id}')` : `OL.openResourceModal('${link.id}')`;
        
        const deleteAction = isTrigger 
            ? `event.stopPropagation(); OL.removeTriggerLink('${resId}', ${trigIdx}, ${idx})`
            : `event.stopPropagation(); OL.removeStepLink('${resId}', '${item.id}', ${idx})`;

        return `
            <div class="pill soft is-clickable" 
                 style="display:flex; align-items:center; gap:8px; margin-bottom:4px; padding:4px 10px; background: rgba(255,255,255,0.05); cursor: pointer; border: 1px solid transparent;"
                 onmouseover="this.style.borderColor='var(--accent)'" 
                 onmouseout="this.style.borderColor='transparent'"
                 onclick="${openAction}">
                <span style="font-size:10px; opacity: 0.7;">${icon}</span>
                <span style="flex:1; font-size:10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="View Link">
                    ${esc(link.name)}
                </span>
                <b class="pill-remove-x" 
                   style="cursor:pointer; opacity: 0.4; padding: 2px 5px; margin-right: -5px;" 
                   onmouseover="this.style.opacity='1'; this.style.color='var(--danger)'"
                   onmouseout="this.style.opacity='0.4'; this.style.color='inherit'"
                   onclick="${deleteAction}">×</b>
            </div>`;
    }).join('');
}

OL.filterResourceSearch = function(resId, elementId, query, isTrigger = false, trigIdx = null) {
    const resultsContainer = document.getElementById(`resource-results-${elementId}`);
    if (!resultsContainer) return;

    const q = (query || "").toLowerCase();
    const res = OL.getResourceById(resId);
    const client = getActiveClient();
    const isAdmin = window.FORCE_ADMIN === true;
    
    if (!client) return;

    // 1. Resolve current linked IDs to prevent duplicates
    let targetItem = isTrigger ? res?.triggers?.[trigIdx] : res?.steps?.find(s => String(s.id) === String(elementId));
    const alreadyLinkedIds = (targetItem?.links || []).map(l => String(l.id));

    // 🚀 RULE 1 & 2: Local Project Data
    const localResources = (client.projectData?.localResources || []).filter(r => 
        String(r.id) !== String(resId) && !alreadyLinkedIds.includes(String(r.id)) && (r.name || "").toLowerCase().includes(q)
    ).map(r => ({ id: r.id, name: r.name, type: 'resource', origin: 'Local', icon: '📱' }));

    const localSOPs = (client.projectData?.localHowTo || []).filter(h => 
        !alreadyLinkedIds.includes(String(h.id)) && (h.name || "").toLowerCase().includes(q)
    ).map(h => ({ id: h.id, name: h.name, type: 'sop', origin: 'Local', icon: '📍' }));

    // 🚀 RULE 3 & 4: Master SOPs (Filtered for Visibility/Sharing)
    // Note: masterResources is intentionally omitted to avoid template clutter.
    const masterSOPs = (state.master.howToLibrary || []).filter(h => {
        const isShared = (client.sharedMasterIds || []).includes(h.id);
        const isClientFacing = h.scope === 'global' || h.scope === 'client' || h.isClientFacing === true;
        const matchesQuery = (h.name || "").toLowerCase().includes(q);
        const notLinked = !alreadyLinkedIds.includes(String(h.id));

        // Strictly only show if it's already linked to this client OR marked as public-facing
        return (isShared || isClientFacing) && notLinked && matchesQuery;
    }).map(h => ({ 
        id: h.id, 
        name: h.name, 
        type: 'sop', 
        origin: 'Vault', 
        icon: '📖' 
    }));

    const combined = [...localResources, ...localSOPs, ...masterSOPs];

    if (combined.length === 0) {
        resultsContainer.innerHTML = `<div class="search-item muted" style="padding:10px;">No matching project-ready items found.</div>`;
        return;
    }

    // 4. Render results
    resultsContainer.innerHTML = combined.map(item => `
        <div class="search-result-item" 
             style="display: flex; align-items: center; gap: 10px; padding: 8px 12px; cursor: pointer; border-bottom: 1px solid rgba(255,255,255,0.05);"
             onmousedown="OL.addStepResource('${resId}', '${elementId}', '${item.id}', '${esc(item.name)}', '${item.type}', ${isTrigger}, ${trigIdx})">
            <span style="width: 16px; text-align: center;">${item.icon}</span>
            <div style="flex:1">
                <div style="font-size: 11px; font-weight: bold; color: white;">${esc(item.name)}</div>
                <div style="font-size: 8px; opacity: 0.5; text-transform: uppercase;">${item.origin} ${item.type}</div>
            </div>
        </div>
    `).join('');
};

OL.addStepResource = function(resId, elementId, targetId, targetName, targetType, isTrigger = false, trigIdx = null) {
    const client = getActiveClient();
    if (!client) return;

    console.log(`🔍 Link Attempt: Parent[${resId}] Element[${elementId}] Target[${targetName}]`);

    const isVault = window.location.hash.includes('vault');
    const allResources = isVault ? (state.master.resources || []) : (client.projectData.localResources || []);

    let targetObj = null;

    // 1. STRATEGY A: Is the element itself a top-level Resource? 
    // (This handles clicking from the Inspector when viewing an SOP/Zap)
    targetObj = allResources.find(r => String(r.id) === String(elementId));

    // 2. STRATEGY B: Is it a nested Step or Trigger?
    if (!targetObj) {
        for (const r of allResources) {
            // Check Steps
            const foundStep = (r.steps || []).find(s => String(s.id) === String(elementId));
            if (foundStep) { targetObj = foundStep; break; }
            
            // Check Triggers
            if (isTrigger && String(r.id) === String(resId)) {
                targetObj = r.triggers?.[trigIdx];
                if (targetObj) break;
            }
        }
    }

    if (!targetObj) {
        console.error("❌ Link failed: Target object not found in system.", elementId);
        return;
    }

    // 3. PERFORM LINK
    if (!targetObj.links) targetObj.links = [];
    if (targetObj.links.some(l => String(l.id) === String(targetId))) {
        console.warn("⚠️ Already linked.");
    } else {
        // Auto-share logic for Vault SOPs
        const isVaultSOP = targetId.startsWith('ht-vlt-') || (!targetId.includes('local') && targetType === 'sop');
        if (isVaultSOP && !isVault) {
            if (!client.sharedMasterIds) client.sharedMasterIds = [];
            if (!client.sharedMasterIds.includes(targetId)) client.sharedMasterIds.push(targetId);
        }

        targetObj.links.push({ id: targetId, name: targetName, type: targetType });
        console.log("✅ Link Success to:", targetObj.name || "Unnamed Step");
    }

    OL.persist();
    
    // 4. UI REFRESH
    const results = document.getElementById(`resource-results-${elementId}`);
    if (results) results.innerHTML = "";
    
    // Keep inspector open on the element we just updated
    OL.loadInspector(elementId, resId !== elementId ? resId : null);
};

OL.removeStepLink = function(resId, stepId, linkIdx) {
    const res = OL.getResourceById(resId);
    const step = res?.steps?.find(s => String(s.id) === String(stepId));
    if (step && step.links) {
        step.links.splice(linkIdx, 1);
        OL.persist();
        // Refresh the specific list UI
        const listContainer = document.getElementById(`step-resources-list-${stepId}`);
        if (listContainer) listContainer.innerHTML = renderStepResources(resId, step);
    }
};

OL.removeTriggerLink = function(resId, trigIdx, linkIdx) {
    const res = OL.getResourceById(resId);
    const trigger = res?.triggers?.[trigIdx];
    
    if (trigger && trigger.links) {
        // Remove the specific link from the array
        trigger.links.splice(linkIdx, 1);
        
        OL.persist();
        
        // 🚀 SURGICAL UI REFRESH
        // If the detail modal is open, refresh its content
        const trigId = `trig-${trigIdx}`;
        const listContainer = document.getElementById(`step-resources-list-${trigId}`);
        if (listContainer) {
            listContainer.innerHTML = renderStepResources(resId, trigger, true, trigIdx);
        }

        // Also sync the background list in the Resource Modal
        const mainList = document.getElementById('sop-step-list');
        if (mainList) mainList.innerHTML = renderSopStepList(res);
        
        console.log(`🗑️ Link removed from Trigger ${trigIdx}`);
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
    } else {
        state.expandedSteps.clear(); // Keeps it focused
        state.expandedSteps.add(stepId);
    }
    
    // 💡 Note: We removed state.editingStepId here so the name stays read-only in the list
    
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
    const client = getActiveClient();
    const isVault = location.hash.includes('vault');
    const sourceData = isVault ? state.master : client.projectData;
    const allResources = isVault ? (state.master.resources || []) : (client?.projectData?.localResources || []);

    let html = '';

    // 1. STANDARD ACTIONS (Always visible)
    if (!q) {
        html += `<div class="search-group-header">Standard Logic</div>
                 <div class="search-result-item" onmousedown="OL.executeAssignmentOutcome('${resId}','${stepId}','next','➡️ Next Step')">➡️ Next Step</div>
                 <div class="search-result-item" onmousedown="OL.executeAssignmentOutcome('${resId}','${stepId}','close','🏁 End Workflow')">🏁 End Workflow</div>`;
    }

    // 2. THE NAVIGATOR (If no specific query, show Stages/Workflows to drill down)
    if (!q) {
        html += `<div class="search-group-header">Navigator: Select Target Step</div>`;
        
        // Show Stages
        (sourceData.stages || []).forEach(stage => {
            html += `
                <div class="search-result-item stage-drill" style="border-left: 2px solid var(--accent);" 
                     onclick="event.stopPropagation(); OL.filterOutcomeSearch('${resId}', '${stepId}', 'stage:${stage.id}')">
                    📁 Stage: ${esc(stage.name)} <span class="tiny muted">➔</span>
                </div>`;
        });
    } 
    
    // 3. DRILL DOWN: Workflows in Stage
    else if (q.startsWith('stage:')) {
        const targetStageId = q.split(':')[1];
        html += `<div class="search-result-item back-btn" onclick="OL.filterOutcomeSearch('${resId}', '${stepId}', '')">⬅ Back to Stages</div>`;
        allResources.filter(r => r.type === 'Workflow' && String(r.stageId) === targetStageId).forEach(wf => {
            html += `
                <div class="search-result-item wf-drill" style="border-left: 2px solid #38bdf8;"
                     onclick="event.stopPropagation(); OL.filterOutcomeSearch('${resId}', '${stepId}', 'wf:${wf.id}')">
                    🔄 Workflow: ${esc(wf.name)} <span class="tiny muted">➔</span>
                </div>`;
        });
    }

    // 4. DRILL DOWN: Resources in Workflow
    else if (q.startsWith('wf:')) {
        const targetWfId = q.split(':')[1];
        const wf = OL.getResourceById(targetWfId);
        html += `<div class="search-result-item back-btn" onclick="OL.filterOutcomeSearch('${resId}', '${stepId}', 'stage:${wf.stageId}')">⬅ Back to Stage</div>`;
        (wf.steps || []).forEach(stepLink => {
            const asset = allResources.find(r => r.id === stepLink.resourceLinkId);
            if (asset) {
                html += `
                    <div class="search-result-item res-drill" style="border-left: 2px solid #10b981;"
                         onclick="event.stopPropagation(); OL.filterOutcomeSearch('${resId}', '${stepId}', 'res:${asset.id}')">
                        📦 ${OL.getRegistryIcon(asset.type)} ${esc(asset.name)} <span class="tiny muted">➔</span>
                    </div>`;
            }
        });
    }

    // 5. FINAL STOP: Steps in Resource (The actual linkable items)
    else if (q.startsWith('res:')) {
        const targetResId = q.split(':')[1];
        const res = OL.getResourceById(targetResId);
        html += `<div class="search-result-item back-btn" onclick="OL.filterOutcomeSearch('${resId}', '${stepId}', '')">⬅ Start Over</div>`;
        (res.steps || []).forEach(s => {
            if (s.id === stepId) return; // Can't link to self
            html += `
                <div class="search-result-item" onmousedown="OL.executeAssignmentOutcome('${resId}', '${stepId}', 'jump_step_${s.id}', '↪ Step: ${esc(s.name)}')">
                    📍 Link Step: ${esc(s.name)}
                </div>`;
        });
    }

    // 6. TEXT SEARCH OVERRIDE (If they type normally)
    else {
        html += `<div class="search-group-header">Search Results</div>`;
        allResources.forEach(resource => {
            (resource.steps || []).forEach(s => {
                // 🛡️ THE FIX: Add (s.name || "") before calling toLowerCase()
                const stepName = (s.name || "").toLowerCase();
                
                if (stepName.includes(q) && String(s.id) !== String(stepId)) {
                    html += `
                        <div class="search-result-item" onmousedown="OL.executeAssignmentOutcome('${resId}', '${stepId}', 'jump_step_${s.id}', '↪ Step: ${esc(s.name || "Unnamed Step")}')">
                            <div style="display:flex; flex-direction:column;">
                                <span>↪ ${esc(s.name || "Unnamed Step")}</span>
                                <span class="tiny muted" style="font-size:8px;">In: ${esc(resource.name || "Unknown Resource")}</span>
                            </div>
                        </div>`;
                }
            });
        });
    }

    listEl.innerHTML = html || `<div class="search-result-item muted">No steps found</div>`;
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
    // 🛡️ SELF-HEAL: If resId is invalid, try to find the correct ID
    const activeResId = (resId && resId !== 'undefined' && resId !== 'null') 
                        ? resId 
                        : (state.activeInspectorParentId || state.activeInspectorResId);

    const outcomes = step.outcomes || [];
    
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
                      placeholder="Enter condition..."
                      style="background: transparent; border: none; font-size: 11px; width: 100%; outline: none; color: white; text-align: left; padding: 0;"
                      onblur="OL.updateOutcomeDetail('${activeResId}', '${step.id}', ${idx}, 'condition', this.value)">
            </div>

            <div style="flex: 1; display: flex; align-items: center; justify-content: flex-start; gap: 8px; border-left: 1px solid var(--line); padding-left: 10px;">
                <span class="tiny muted" style="font-size: 9px; min-width: 30px; text-align: left;">THEN</span>
                <div class="is-clickable outcome-mapping-target" 
                    style="font-size: 11px; color: var(--text-main); flex: 1; text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;"
                    onclick="OL.openOutcomePicker(event, '${a