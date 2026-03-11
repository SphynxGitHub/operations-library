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
                    onclick="OL.openOutcomePicker(event, '${activeResId}', '${step.id}', ${idx})"
                    title="Click to remap destination">
                    ${esc(oc.label || 'Select Destination...')}
                </div>
            </div>

            <button class="card-delete-btn" style="position: static; font-size: 14px;" 
                    onclick="event.stopPropagation(); OL.removeOutcome('${activeResId}', '${step.id}', ${idx})">×</button>
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

OL.executeAssignmentOutcome = function(parentId, itemId, actionCode, destinationLabel) {
    const targetObj = OL.getResourceById(itemId);
    const parentObj = OL.getResourceById(parentId);
    
    if (!targetObj) return console.error("❌ Target missing:", itemId);

    if (!targetObj.outcomes) targetObj.outcomes = [];

    // 🚀 Update State
    if (state.activeRemap && state.activeRemap.idx !== undefined) {
        targetObj.outcomes[state.activeRemap.idx].action = actionCode;
        targetObj.outcomes[state.activeRemap.idx].label = destinationLabel;
        state.activeRemap = null; 
    } else {
        targetObj.outcomes.push({ condition: "", action: actionCode, label: destinationLabel });
    }

    OL.persist();
    
    // 🔄 SURGICAL UI REFRESH
    const detailList = document.getElementById('step-outcomes-list');
    if (detailList) {
        // If parent and item are the same (Stage/Workflow), pass null as parent to the renderer
        const contextId = (parentId === itemId) ? itemId : parentId;
        detailList.innerHTML = renderStepOutcomes(contextId, targetObj);
    }

    // Refresh sequence list if in Resource Modal
    const mainList = document.getElementById('sop-step-list');
    if (mainList && parentObj) mainList.innerHTML = renderSopStepList(parentObj);

    // Clear Search Overlay
    const results = document.getElementById('outcome-results');
    if (results) results.innerHTML = "";

    // 🔀 Global Map Sync: Update "🌲" indicators
    if (typeof renderGlobalVisualizer === 'function') {
        renderGlobalVisualizer(location.hash.includes('vault'));
    }
    
    console.log(`✅ Logic updated for ${targetObj.name || itemId}`);
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
    const client = getActiveClient();
    const all = [...(state.master.resources || []), ...(client?.projectData?.localResources || [])];
    
    let res = null;
    let step = null;

    // 1. 🔍 THE HUNT: Find the resource that contains this stepId
    res = all.find(r => (r.steps || []).some(s => String(s.id) === String(stepId)));

    // 2. Fallback: If we can't find it by step ownership, try the direct resId
    if (!res) res = OL.getResourceById(resId);

    if (res && res.steps) {
        step = res.steps.find(s => String(s.id) === String(stepId));
    }

    // 3. 💾 SAVE LOGIC
    if (step && step.outcomes && step.outcomes[idx]) {
        step.outcomes[idx][field] = value;
        console.log(`✅ Logic Saved to Resource [${res.name}]: ${field} = "${value}"`);
        
        OL.persist();

        // 4. Update Sidebar UI
        const outcomeList = document.getElementById('step-outcomes-list');
        if (outcomeList) {
            // Re-render only the outcomes list to show the new value
            outcomeList.innerHTML = renderStepOutcomes(res.id, step);
        }
    } else {
        console.error("❌ Save Error: Target outcome not found.", { 
            resFound: !!res, 
            stepFound: !!step, 
            idx 
        });
    }
};

OL.removeOutcome = function(resId, stepId, idx) {
    // 1. Find the resource that actually owns this step
    const client = getActiveClient();
    const all = [...(state.master.resources || []), ...(client?.projectData?.localResources || [])];
    
    let res = all.find(r => (r.steps || []).some(s => String(s.id) === String(stepId)));

    // 2. Fallback to direct lookup
    if (!res) res = OL.getResourceById(resId);

    if (!res) return console.error("❌ Delete Failed: Resource not found.");

    const step = res.steps?.find(s => String(s.id) === String(stepId));

    if (step && step.outcomes && step.outcomes[idx]) {
        // 🗑️ Remove the item from the array
        const removed = step.outcomes.splice(idx, 1);
        console.log(`🗑️ Removed logic path:`, removed[0]);

        OL.persist();

        // 🔄 Refresh the Inspector UI immediately
        if (typeof OL.loadInspector === 'function') {
            OL.loadInspector(stepId, res.id); 
        }
        
        // Clear any active traces on the map since the logic is gone
        OL.clearLogicTraces();
    } else {
        console.error("❌ Delete Failed: Could not locate outcome at index", idx);
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
    const localApps = client?.projectData?.localApps || [];
    const roles = [...new Set(team.flatMap(m => m.roles || []))];
    const systemRoles = [
        { name: "Client 1", icon: "🙎‍♀️", type: "client" },
        { name: "Client 2", icon: "🙎‍♂️", type: "client" },
        { name: "Household", icon: "🏠", type: "household" }
    ];

    let html = "";

    // 🟡 Render Client/ System Roles (Filtered by query)
    const matchedSystem = systemRoles.filter(s => s.name.toLowerCase().includes(q));
    if (matchedSystem.length > 0) {
        html += `<div class="search-group-header">External Parties</div>`;
        html += matchedSystem.map(s => `
            <div class="search-result-item" 
                 onmousedown="event.stopPropagation(); OL.executeAssignment('${resId}', '${targetId}', ${isTrigger}, '${s.name}', '${s.name}', 'role')">
                <span style="margin-right:8px;">${s.icon}</span> ${esc(s.name)}
            </div>`).join('');
    }

    // 🟢 Section: People
    const matchPeople = team.filter(m => m.name.toLowerCase().includes(q));
    if (matchPeople.length > 0) {
        html += `<div class="search-group-header">Team Members</div>`;
        html += matchPeople.map(m => `
            <div class="search-result-item" 
                 onmousedown="event.stopPropagation(); OL.executeAssignment('${resId}', '${targetId}', ${isTrigger}, '${m.id}', '${esc(m.name)}', 'person')">
                👨‍💼 ${esc(m.name)}
            </div>`).join('');
    }

    // 🔵 Section: Roles
    const matchRoles = roles.filter(r => r.toLowerCase().includes(q));
    if (matchRoles.length > 0) {
        html += `<div class="search-group-header">Roles</div>`;
        html += matchRoles.map(r => `
            <div class="search-result-item" 
                 onmousedown="event.stopPropagation(); OL.executeAssignment('${resId}', '${targetId}', ${isTrigger}, '${esc(r)}', '${esc(r)}', 'role')">
                🎭 ${esc(r)}
            </div>`).join('');
    }

    // 🟠 Section: Systems
    const matchApps = localApps.filter(a => a.name.toLowerCase().includes(q));
    if (matchApps.length > 0) {
        html += `<div class="search-group-header">Project Apps</div>`;
        html += matchApps.map(a => `
            <div class="search-result-item" 
                onmousedown="event.stopPropagation(); OL.executeAssignment('${resId}', '${targetId}', ${isTrigger}, '${a.id}', '${esc(a.name)}', 'system')">
                📱 ${esc(a.name)}
            </div>`).join('');
    }

    listEl.innerHTML = html || `<div class="search-result-item muted">No matching local assignments found</div>`;
};

OL.executeAssignment = async function(parentId, stepId, isTrigger, memberId, memberName, type) {
    // 🛡️ Resolve Context: If they are equal, it's a Resource. If not, it's a Step.
    const isResourceLevel = String(parentId) === String(stepId);
    
    await OL.updateAndSync(() => {
        const res = OL.getResourceById(parentId);
        if (!res) return console.error("❌ Context Resource not found");

        if (isResourceLevel) {
            // 🏰 Apply to Resource Root
            res.assigneeId = memberId;
            res.assigneeName = memberName;
            res.assigneeType = type;
        } else {
            // 📝 Apply to specific Step inside the Resource
            if (!res.steps) res.steps = [];
            const step = res.steps.find(s => String(s.id) === String(stepId));
            
            if (step) {
                step.assigneeId = memberId;
                step.assigneeName = memberName;
                step.assigneeType = type;
                console.log(`✅ Step [${step.name}] assigned to ${memberName}`);
            } else {
                // 🚨 Fallback: Check if it's a 'link' type step
                console.error("❌ Step object not found in parent array. Check ID mapping.");
            }
        }
    });

    // 🔄 Force UI to show the data we just saved
    OL.loadInspector(stepId, parentId);
    OL.refreshMap();
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

    const trigId = `trig-${triggerIdx}`;
    const client = getActiveClient();
    const allApps = [...(state.master.apps || []), ...(client?.projectData?.localApps || [])];
    const linkedApp = allApps.find(a => String(a.id) === String(trigger.appId));

    const html = `
        <div class="modal-head" style="gap:15px; background: var(--panel-dark);">
            <div style="display:flex; align-items:center; gap:10px; flex:1;">
                <span style="font-size:18px;">⚡</span>
                <input type="text" class="header-editable-input" 
                       value="${esc(val(trigger.name))}" 
                       placeholder="Trigger Name..."
                       style="background:transparent; border:none; color:inherit; font-size:18px; font-weight:bold; width:100%; outline:none;"
                       onblur="OL.updateTriggerMeta('${resId}', ${triggerIdx}, 'name', this.value)">
            </div>
            <button class="btn tiny soft" style="color: black !important; background: #fff !important;" onclick="OL.openResourceModal('${resId}')">Back to Resource</button>
        </div>
        <div class="modal-body">
            <div class="card-section">
                <label class="modal-section-label">📱 Source Application (Tool)</label>
                <div style="display:flex; align-items:center; gap:10px; margin-bottom:10px;">
                    ${linkedApp ? `
                        <div class="pill accent is-clickable" 
                            style="display:flex; align-items:center; gap:8px; cursor:pointer;"
                            onclick="OL.openAppModal('${linkedApp.id}')" title="Jump to App Settings">
                            📱 ${esc(linkedApp.name)}
                            <b class="pill-remove-x" onclick="event.stopPropagation(); OL.updateTriggerMeta('${resId}', ${triggerIdx}, 'appId', ''); OL.openTriggerDetailModal('${resId}', ${triggerIdx})">×</b>
                        </div>
                    ` : '<span class="tiny muted">No source app linked</span>'}
                </div>
                <div class="search-map-container">
                    <input type="text" class="modal-input tiny" 
                        placeholder="Search Apps..." 
                        onfocus="OL.filterTriggerAppSearch('${resId}', ${triggerIdx}, '')"
                        oninput="OL.filterTriggerAppSearch('${resId}', ${triggerIdx}, this.value)">
                    <div id="trigger-app-results" class="search-results-overlay"></div>
                </div>
            </div>
            <div class="card-section" style="margin-top:20px;">
                <label class="modal-section-label">👨‍💼 Responsibility Assignment</label>
                <div style="display:flex; align-items:center; gap:10px; margin-bottom:10px;">
                    ${trigger.assigneeName ? `
                        <div class="pill accent is-clickable" 
                            style="display:flex; align-items:center; gap:8px; cursor:pointer; background:rgba(168, 85, 247, 0.1); border: 1px solid #a855f7;"
                            onclick="event.stopPropagation(); (window.OL.openTeamMemberModal || window.OL.openAssigneeModal)('${trigger.assigneeId}')">
                            <span>👨‍💼</span>
                            <span style="font-weight:600;">${esc(trigger.assigneeName)}</span>
                            <b class="pill-remove-x" 
                            onclick="event.stopPropagation(); OL.updateTriggerMeta('${resId}', ${triggerIdx}, 'assigneeId', ''); OL.updateTriggerMeta('${resId}', ${triggerIdx}, 'assigneeName', '');">×</b>
                        </div>
                    ` : '<span class="tiny muted">Unassigned</span>'}
                </div>
                
                <div class="search-map-container">
                    <input type="text" class="modal-input tiny" 
                        placeholder="Assign a Person..." 
                        onfocus="OL.filterAssignmentSearch('${resId}', ${triggerIdx}, true, '')"
                        oninput="OL.filterAssignmentSearch('${resId}', ${triggerIdx}, true, this.value)">
                    <div id="assignment-search-results" class="search-results-overlay"></div>
                </div>
            </div>

            <div class="card-section" style="margin-top:20px;">
                <label class="modal-section-label">Technical Notes / Source URL</label>
                <textarea class="modal-textarea" rows="3" 
                          placeholder="Link to the Zap, Form URL, or API documentation..."
                          onblur="OL.updateTriggerMeta('${resId}', ${triggerIdx}, 'notes', this.value)">${esc(trigger.notes || "")}</textarea>
            </div>
        </div>
    `;
    openModal(html);
};

OL.filterTriggerAppSearch = function(resId, triggerIdx, query) {
    const listEl = document.getElementById("trigger-app-results");
    if (!listEl) return;

    const q = (query || "").toLowerCase().trim();
    const client = getActiveClient();
    const localApps = client?.projectData?.localApps || [];
    const masterApps = state.master.apps || [];
    const allApps = [...masterApps, ...localApps];

    const matches = allApps.filter(a => a.name.toLowerCase().includes(q));

    listEl.innerHTML = matches.map(app => `
        <div class="search-result-item" 
             onmousedown="OL.updateTriggerMeta('${resId}', ${triggerIdx}, 'appId', '${app.id}'); OL.openTriggerDetailModal('${resId}', ${triggerIdx})">
            📱 ${esc(app.name)} 
            <span class="tiny muted">(${String(app.id).includes('local') ? 'Local' : 'Master'})</span>
        </div>
    `).join('') || `<div class="search-result-item muted">No apps found.</div>`;
};

// Update Logic with Surgical Refresh
OL.updateTriggerMeta = function(resId, idx, field, value, extraData = null) {
    const res = OL.getResourceById(resId);
    if (res && res.triggers[idx]) {
        // Handle standard field updates
        res.triggers[idx][field] = value;
        
        // 🚀 THE PILL FIX: If extraData (like a Name) is passed, save it too
        if (extraData) {
            Object.keys(extraData).forEach(key => {
                res.triggers[idx][key] = extraData[key];
            });
        }

        OL.persist();
        
        // Surgical Update for the background list
        const listEl = document.getElementById('sop-step-list');
        if (listEl) listEl.innerHTML = renderSopStepList(res);

        // ALWAYS refresh the Trigger Modal to show the new Pill state
        OL.openTriggerDetailModal(resId, idx);
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
    if (!listEl) return;
    
    const q = (query || "").toLowerCase();
    const client = getActiveClient();
    
    // 🚀 THE FIX: Only look at local project resources
    if (!client || !client.projectData || !client.projectData.localResources) {
        listEl.innerHTML = '<div class="search-result-item muted">No local resources found.</div>';
        return;
    }

    const available = client.projectData.localResources.filter(r => 
        r.id !== parentResId && 
        (r.name || "").toLowerCase().includes(q)
    );

    listEl.innerHTML = available.map(r => `
        <div class="search-result-item" onmousedown="OL.addLinkedResourceStep('${parentResId}', '${r.id}')">
            <div style="display:flex; justify-content:space-between; align-items:center; width:100%;">
                <span>🛠️ ${esc(r.name)}</span>
                <span class="pill tiny local">LOCAL</span>
            </div>
        </div>
    `).join('') || `<div class="search-result-item muted">No matching local resources for "${esc(query)}"</div>`;
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

OL.updateAtomicStep = async function(parentId, targetId, field, value) {
    // 1. Identify the Resource context
    const res = OL.getResourceById(parentId);
    if (!res) return console.error("❌ Context Resource not found:", parentId);

    await OL.updateAndSync(() => {
        // 🎯 THE SWITCH
        // If targetId === parentId, we are updating the FULL RESOURCE
        // If they differ, we are updating a STEP inside that resource
        const isFullResource = String(parentId) === String(targetId);
        
        if (isFullResource) {
            console.log(`💾 Saving [${field}] to Full Resource: ${res.name}`);
            res[field] = value;
            
            // 🚀 Special Case: Sync Name to Assignment
            if (field === 'assigneeId') {
                const client = getActiveClient();
                const member = client?.projectData?.teamMembers?.find(m => m.id === value);
                res.assigneeName = member ? member.name : "Unassigned";
            }
        } else {
            const step = (res.steps || []).find(s => String(s.id) === String(targetId));
            if (step) {
                console.log(`💾 Saving [${field}] to Step: ${step.name}`);
                step[field] = value;
                
                if (field === 'assigneeId') {
                    const client = getActiveClient();
                    const member = client?.projectData?.teamMembers?.find(m => m.id === value);
                    step.assigneeName = member ? member.name : "Unassigned";
                }
            }
        }
    });

    // 🔄 REFRESH: Reload the inspector to show the saved state
    OL.loadInspector(targetId, parentId);
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

    const masterTemplates = state.master.analyses || [];
    
    // 🏗️ Determine which templates and local analyses to show
    const templatesToDisplay = isActuallyVault 
        ? masterTemplates 
        : masterTemplates.filter(t => client?.sharedMasterIds?.includes(t.id));

    const localAnalyses = (!isActuallyVault && client) ? (client.projectData.localAnalyses || []) : [];

    container.innerHTML = `
        <div class="section-header">
            <div>
                <h2>${isActuallyVault ? '📚 Master Analysis Library' : '📈 Feature Analysis & Comparison'}</h2>
                <div class="small muted subheader">
                    ${isActuallyVault ? 'Global templates for standardized scoring' : `Helping ${esc(client?.meta.name)} find the right fit`}
                </div>
            </div>
            <div class="header-actions">
                <button class="btn small soft" onclick="OL.openGlobalContentManager()" style="margin-right: 8px;" title="Manage Global Content">
                    ⚙️
                </button>
                ${isActuallyVault ? 
                    `<button class="btn primary" onclick="OL.createNewMasterAnalysis()">+ Create Template</button>` : 
                    `<button class="btn small soft" onclick="OL.createNewAnalysisSandbox()">+ Create Local Analysis</button>
                    <button class="btn primary" onclick="OL.importAnalysisFromVault()" style="margin-right:8px;">⬇ Import from Master</button>`
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

// 3. OPEN INDIVIDUAL ANALYSIS MATRIX

OL.openAnalysisMatrix = function(analysisId, isMaster) {
    const client = getActiveClient();
    const source = isMaster ? state.master.analyses : (client?.projectData?.localAnalyses || []);
    const anly = source.find(a => a.id === analysisId);

    if (!anly) return console.error("Analysis not found:", analysisId);

    state.activeMatrixId = analysisId;

    const container = document.getElementById("activeAnalysisMatrix");
    if (!container) return;

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
                        <div class="subheader">Scores: 0 (N/A), 1 (<60%), 2 (60-80%), 3 (80%+)</div>
                    </div>
                    <div class="header-actions">
                        ${!isMaster ? `<button class="btn tiny warn" onclick="OL.pushMatrixToMasterLibrary('${analysisId}')">⭐ Push to Vault</button>` : ''}
                        <button class="btn tiny primary" onclick="OL.printAnalysisPDF('${analysisId}', ${isMaster})">🖨️ Print</button>
                        <button class="btn tiny soft" onclick="OL.addAppToAnalysis('${analysisId}', ${isMaster})">+ Add App</button>
                        <button class="btn tiny danger soft" onclick="document.getElementById('activeAnalysisMatrix').innerHTML='';" style="margin-left:10px;">✕</button>
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
                                <div style="display: flex; align-items: center; gap: 2px;">
                                    <span class="tiny">💰</span>
                                    <span style="color: var(--accent); font-weight: bold; text-transform: uppercase;">PRICING & TIERS DEFINITION</span>
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
                                        <span class="pill ${score > 2.5 ? 'accent' : 'soft'}" style="font-size: 1.1rem; padding: 4px 12px;">${score}</span>
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
                                        <div style="font-size: 1.2rem; font-weight: bold; color: var(--accent);">$${cost.toLocaleString()}</div>
                                        <div style="font-size: 9px; opacity: 0.6; margin-top: 2px;">PER USER / MO</div>
                                    </td>`;
                            }).join('')}
                            ${(anly.competitors || []).map(() => `<td style="border: 1px solid var(--line);"></td>`).join('')}
                        </tr>
                    </tobdy>
                </table>

                <div class="executive-summary-wrapper" style="margin-top: 30px; padding: 20px; border-radius: 8px; border: 1px solid var(--line);">
                    <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 12px;">
                        <label class="modal-section-label" style="margin: 0; font-size: 1rem; color: var(--accent);">Executive Summary & Recommendations</label>
                    </div>
                    <textarea class="modal-textarea matrix-notes-auto" 
                            placeholder="Add your final analysis notes or decision rationale here..."
                            oninput="this.style.height = 'auto'; this.style.height = this.scrollHeight + 'px'"
                            onblur="OL.updateAnalysisMeta('${analysisId}', 'summary', this.value, ${isMaster})"
                            style="display: block; width: 100%; height: auto; min-height: 100px; overflow: hidden; 
                                    background: rgba(255,255,255,0.03); color: #ddd; border: 1px solid rgba(255,255,255,0.1); 
                                    padding: 12px; font-family: inherit; line-height: 1.4; border-radius: 4px; resize: none;">${esc(anly.summary || "")}</textarea>
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

    // Add at the end of OL.openAnalysisMatrix
    setTimeout(() => {
        document.querySelectorAll('.matrix-notes-auto').forEach(el => {
            el.style.height = el.scrollHeight + 'px';
        });
        const textareas = container.querySelectorAll('textarea');
        textareas.forEach(ta => {
            ta.style.height = 'auto';
            ta.style.height = ta.scrollHeight + 'px';
        })
    }, 50);
}

OL.updateAnalysisMeta = async function(anlyId, field, value, isMaster) {
    // 🚀 THE SHIELD
    await OL.updateAndSync(() => {
        const client = getActiveClient();
        const source = isMaster ? state.master.analyses : (client?.projectData?.localAnalyses || []);
        const anly = source.find(a => a.id === anlyId);

        if (anly) {
            anly[field] = value.trim();
        }
    });

    // 🔄 Surgical Refresh of the Matrix only
    OL.openAnalysisMatrix(anlyId, isMaster);
    
    // Manual sync for the background card title if the name changed
    if (field === 'name') {
        const cardTitle = document.querySelector(`.card-title-${anlyId}`);
        if (cardTitle) cardTitle.innerText = value.trim();
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
    let currentCategory = null;
    let rowsHtml = "";

    const features = anly.features || [];
    features.sort((a, b) => {
        const weightA = OL.getCategorySortWeight(a.category);
        const weightB = OL.getCategorySortWeight(b.category);
        if (weightA !== weightB) return weightA - weightB;
        return (a.category || "").localeCompare(b.category || "");
    });
    
    features.forEach(feat => {
        const catName = feat.category || "General";

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
                                  onclick="OL.openCategoryManagerModal('${analysisId}', '${esc(catName)}', ${isMaster})">
                                ${esc(catName)}
                            </span>
                        </div>
                    </td>
                </tr>
            `;
        }

        // 2. Standard Rows (Features)
        rowsHtml += `
        <tr>
            <td style="padding-left: 28px;">
                <div style="display:flex; align-items:center; gap:8px;">
                    <button class="card-delete-btn" onclick="OL.removeFeatureFromAnalysis('${analysisId}', '${feat.id}', ${isMaster})">×</button> 
                    <span class="small feature-edit-link" 
                            style="cursor: pointer; border-bottom: 1px dotted var(--muted);"
                            onclick="OL.editFeatureModal('${analysisId}', '${feat.id}', ${isMaster})">
                        ${esc(feat.name)}
                        <span style="font-size: 10px; opacity: 0.3;">📝</span>
                    </span>
                </div>
                <div style="font-size: 10px; color: var(--text-dim); line-height: 1.3; font-style: italic; max-width: 260px; padding-left: 20px;">
                    ${feat.description ? esc(feat.description) : '<span style="opacity: 0.2;">No description added...</span>'}
                </div>
            </td>
            <td style="padding: 0 8px; border: 1px solid var(--line); width: 100px; background:rgba(255,255,255,0.01);">
                <div style="display: flex; align-items: center; justify-content: space-between; height: 32px;">
                    <input type="number" 
                        class="tiny-input" 
                        style="width: 40px; background: transparent; border: none; color: var(--accent) text-align: right; font-weight: bold; font-size: 12px; outline: none;"
                        value="${feat.weight || 0}" 
                        onblur="OL.updateAnalysisFeature('${analysisId}', '${feat.id}', 'weight', this.value, ${isMaster})">
                </div>
            </td>`;

            // 3. Map Apps
            rowsHtml += (anly.apps || []).map(appObj => {
                const currentScore = appObj.scores?.[feat.id] || 0;
                const currentNote = (appObj.notes && appObj.notes[feat.id]) ? appObj.notes[feat.id] : "";
                const pricing = appObj.featPricing?.[feat.id] || {};
                
                // 🚀 IMPROVED LOGIC: Default to 'not_included' if nothing is set
                const costType = pricing.type || 'not_included'; 
                const currentAddonPrice = pricing.addonPrice || 0;
                const appTiers = appObj.pricingTiers || [];
                const isNotIncluded = costType === 'not_included';

                return `
    <td style="padding: 6px; border: 1px solid var(--line); vertical-align: top; min-width: 140px; background: rgba(255,255,255,0.01);">
        <div style="display: flex; flex-direction: column; gap: 6px;">
            
            <select class="tiny-select" 
                style="width: 100%; height: 22px; flex-shrink: 0;"
                onchange="OL.handleMatrixPricingChange('${analysisId}', '${appObj.appId}', '${feat.id}', this.value)">
                <option value="not_included" ${costType === 'not_included' ? 'selected' : ''}>Not Included</option>
                <optgroup label="Included In:">
                    ${appTiers.map(t => `
                        <option value="tier|${esc(t.name)}" ${pricing.tierName === t.name ? 'selected' : ''}>
                            Tier: ${esc(t.name)}
                        </option>
                    `).join('')}
                </optgroup>
                <option value="addon" ${costType === 'addon' ? 'selected' : ''}>Add-on</option>
            </select>

            <textarea 
                placeholder="Notes..." 
                class="matrix-notes-auto"
                style="width: 100%; min-height: 40px; height: auto; overflow: hidden; line-height: 1.1; background: transparent; border: 1px solid rgba(255,255,255,0.05); color: #ccc; resize: none; padding: 4px; border-radius: 4px; font-family: inherit;"
                oninput="this.style.height = ''; this.style.height = this.scrollHeight + 'px'"
                onblur="OL.updateAnalysisNote('${analysisId}', '${appObj.appId}', '${feat.id}', this.value, ${isMaster})"
            >${esc(currentNote)}</textarea>

            <div style="display: ${isNotIncluded ? 'none' : 'flex'}; 
                        align-items: center; gap: 8px; background: rgba(0,0,0,0.2); 
                        border-radius: 4px; padding: 2px 5px; width: 100%;">
                <span style="color: var(--muted); font-weight: bold; font-size: 9px;">Score</span>
                <input type="number" min="0" max="3" class="matrix-score-input" 
                    style="width: 100%; background: transparent; border: none; color: var(--accent); font-weight: bold; text-align: right; font-size: 12px; outline: none;"
                    value="${currentScore}"
                    onblur="OL.updateAnalysisScore('${analysisId}', '${appObj.appId}', '${feat.id}', this.value, ${isMaster})">
            </div>

            <div id="addon-price-${appObj.appId}-${feat.id}" 
                style="display: ${costType === 'addon' ? 'flex' : 'none'}; align-items: center; gap: 4px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 4px;">
                <span class="tiny muted" style="font-size: 9px;">Add-on: $</span>
                <input type="number" class="price-input-tiny" 
                    style="max-width:50px; color: var(--accent); background:transparent; border: 1px solid var(--panel-border); font-size: 10px;"
                    value="${currentAddonPrice}" 
                    onblur="OL.updateAppFeatAddonPrice('${analysisId}', '${appObj.appId}', '${feat.id}', this.value)">
            </div>

        </div>
    </td>
`;
            }).join('');
            rowsHtml += 
        `</tr>`;
    });
    return rowsHtml;
};

OL.updateAnalysisNote = async function(analysisId, appId, featId, value, isMaster) {
    let anly = null;

    // 🚀 THE SCOPE FIX: Direct path to data source
    if (isMaster) {
        anly = (state.master?.analyses || []).find(a => String(a.id) === String(analysisId));
    } else {
        const client = getActiveClient();
        anly = (client?.projectData?.localAnalyses || []).find(a => String(a.id) === String(analysisId));
    }

    if (!anly) return console.error("❌ Analysis not found in scope:", analysisId);

    const appEntry = (anly.apps || []).find(a => String(a.appId) === String(appId));
    if (appEntry) {
        if (!appEntry.notes) appEntry.notes = {};
        appEntry.notes[featId] = value;

        console.log(`💾 Note persisted to ${isMaster ? 'Master' : 'Local'} scope.`);
        await OL.persist();
    }
};

OL.printAnalysisPDF = function(analysisId, isMaster) {
    const container = document.getElementById("activeAnalysisMatrix");
    if (!container) return;

    // 1. Cleanup any existing placeholders just in case
    container.querySelectorAll('.print-placeholder').forEach(el => el.remove());

    const textareas = container.querySelectorAll('textarea');
    const itemsToRestore = [];

    // 2. Create the flowable divs
    textareas.forEach((ta) => {
        const div = document.createElement('div');
        div.className = 'print-placeholder';
        // Match the text exactly including line breaks
        div.innerText = ta.value;
        
        // Style the div to match the location
        div.setAttribute('style', 'white-space: pre-wrap; width: 100%; display: block;');
        
        // Insert it and track it
        ta.parentNode.insertBefore(div, ta);
        itemsToRestore.push({ ta, div });
    });

    // 3. Enter Print Mode
    document.body.classList.add("print-mode-active");
    window.scrollTo(0,0);
    container.classList.add("print-target");

    setTimeout(() => {
        window.print();

        // 4. Exit Print Mode & Cleanup
        document.body.classList.remove("print-mode-active");
        container.classList.remove("print-target");
        
        itemsToRestore.forEach(({ ta, div }) => {
            div.remove();
        });
        console.log("✅ Print cleanup complete.");
    }, 500); // Slightly longer delay to ensure the OS print spooler has the data
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

// Update the Base Price for a specific App in the analysis
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
OL.handleMatrixPricingChange = async function(anlyId, appId, featId, value) {
    await OL.updateAndSync(() => {
        const anly = OL.getScopedAnalyses().find(a => a.id === anlyId);
        const appObj = anly?.apps.find(a => a.appId === appId);
        
        if (!appObj) return;
        if (!appObj.featPricing) appObj.featPricing = {};
        if (!appObj.scores) appObj.scores = {};
        
        const [type, tierName] = value.split('|');

        if (type === 'not_included') {
            appObj.scores[featId] = 0;
        }
        
        // We preserve the addonPrice so it's not lost if they toggle back and forth
        const existingAddon = appObj.featPricing[featId]?.addonPrice || 0;
        
        appObj.featPricing[featId] = {
            type: type, // 'not_included', 'tier', or 'addon'
            tierName: tierName || null,
            addonPrice: appObj.featPricing[featId]?.addonPrice || 0
        };
    });

    // Full refresh to update all Totals and UI states
    OL.openAnalysisMatrix(anlyId);
};

// Add a new Tier to a specific App
OL.addAppTier = async function(anlyId, appId) {
    await OL.updateAndSync(() => {
        const anly = OL.getScopedAnalyses().find(a => a.id === anlyId);
        const app = anly?.apps.find(a => a.appId === appId);
        if (app) {
            if (!app.pricingTiers) app.pricingTiers = [];
            app.pricingTiers.push({ name: "New Tier", price: 0 });
        }
    });
    OL.openAnalysisMatrix(anlyId); // Refresh to show new input
};

// Update an existing Tier (name or price)
OL.updateAppTier = async function(anlyId, appId, tierIdx, field, value) {
    await OL.updateAndSync(() => {
        const anly = OL.getScopedAnalyses().find(a => a.id === anlyId);
        const app = anly?.apps.find(a => a.appId === appId);
        if (app?.pricingTiers?.[tierIdx]) {
            app.pricingTiers[tierIdx][field] = field === 'price' ? (parseFloat(value) || 0) : value;
        }
    });
};

OL.removeAppTier = async function(anlyId, appId, idx) {
    if(!confirm("Remove this pricing tier?")) return;
    await OL.updateAndSync(() => {
        const anly = OL.getScopedAnalyses().find(a => a.id === anlyId);
        const app = anly?.apps.find(a => a.appId === appId);
        if (app?.pricingTiers) app.pricingTiers.splice(idx, 1);
    });
    OL.openAnalysisMatrix(anlyId);
};

OL.updateAppFeatAddonPrice = async function(anlyId, appId, featId, value) {
    await OL.updateAndSync(() => {
        const anly = OL.getScopedAnalyses().find(a => a.id === anlyId);
        const app = anly?.apps.find(a => a.appId === appId);
        
        if (app && app.featPricing && app.featPricing[featId]) {
            // Convert to float, defaulting to 0 if empty or invalid
            app.featPricing[featId].addonPrice = parseFloat(value) || 0;
        }
    });
    
    // Refresh to update the "Est. Monthly Total Cost" at the bottom
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
                <span>📱 ${esc(app.name)}</span>
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

    if (anly && anly.apps) {
        if (!confirm(`Are you sure you want to remove this app from the comparison?`)) return;

        // 🚀 THE SHIELD: Block sync-engine while deleting
        await OL.updateAndSync(() => {
            anly.apps = anly.apps.filter(a => a.appId !== appId);
        });

        // 🔄 SURGICAL REFRESH
        OL.openAnalysisMatrix(anlyId, isMaster);
        console.log("🗑️ App removed safely under shield.");
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

// 💡 Update handleCategorySelection to support the 'local-ui-only' mode
// This just fills the input field without triggering a database save
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
        // 🚀 THE FIX: Check for both potential ID names to be safe
        const catInput = document.getElementById('feat-cat-input') || 
                        document.getElementById('new-feat-cat-input') ||
                        document.getElementById('cat-focus-target'); // From the Step 2 modal
        
        if (catInput) {
            catInput.value = catName;
            // If it's the standalone category modal, trigger the final save automatically
            if (catInput.id === 'cat-focus-target') {
                OL.finalizeFeatureAddition(params.anlyId, params.featName, catName, params.isMaster);
                OL.closeModal();
            }
        }
        
        const res = document.getElementById('feat-cat-results') || 
                    document.getElementById('new-feat-cat-results') || 
                    document.getElementById('feat-cat-assign-results');
        if (res) res.style.display = 'none';
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
        // 🚀 THE SHIELD: Block sync-engine while deleting
        await OL.updateAndSync(() => {
            // 1. Remove the feature row
            anly.features = (anly.features || []).filter(f => f.id !== featId);
            
            // 2. Clear out any scores for this feature in mapped apps
            (anly.apps || []).forEach(appObj => {
                if (appObj.scores) delete appObj.scores[featId];
            });
        });

        // 🔄 SURGICAL REFRESH
        OL.openAnalysisMatrix(anlyId, isMaster);
        console.log("🗑️ Feature removed safely under shield.");
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
    // 🛡️ Enforce the 0-3 limit globally
    let score = parseFloat(value) || 0;
    if (score < 0) score = 0;
    if (score > 3) score = 3;

    OL.updateAndSync(() => { // 🚀 Wrap this!
        const client = getActiveClient();
        const source = isMaster ? state.master.analyses : client?.projectData?.localAnalyses || [];
        const anly = source.find((a) => a.id === anlyId);

        if (anly) {
            const appObj = anly.apps.find((a) => a.appId === appId);
            if (appObj) {
                if (!appObj.scores) appObj.scores = {};
                appObj.scores[featId] = parseFloat(value) || 0;
            }
        }
    });
    // Re-render only the matrix
    OL.openAnalysisMatrix(anlyId, isMaster); 
};

OL.equalizeAnalysisWeights = function(anlyId, isMaster) {
    OL.updateAndSync(() => { // 🚀 Wrap the logic!
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
    });
    OL.openAnalysisMatrix(anlyId, isMaster);
    console.log(`⚖️ Weights Balanced & Normalized. Total: 100.00%`);
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
    const cleanCat = category.trim() || "General";

    // 1. Check if it's already on THIS matrix (The hard stop)
    const onMatrix = (anly.features || []).some(f => f.name.toLowerCase() === cleanName.toLowerCase());
    if (onMatrix) {
        alert(`🚫 "${cleanName}" is already in this analysis matrix.`);
        return;
    }

    // 🚀 THE FIX: Check if the feature exists in the GLOBAL/LOCAL pool
    // We look for any feature with this name to "adopt" its description or metadata
    const allFeatures = OL.getGlobalFeatures(); // Assuming this returns unique names
    const existingEntry = allFeatures.find(f => f.toLowerCase() === cleanName.toLowerCase());

    await OL.updateAndSync(() => {
        if (!anly.features) anly.features = [];
        
        anly.features.push({
            id: "feat-" + Date.now() + Math.random().toString(36).substr(2, 5),
            name: existingEntry || cleanName, // Use standard capitalization if found
            category: cleanCat,
            weight: 10,
            description: "" // You could pull existingEntry.description if you have the full object
        });
    });

    // 🔄 UI Reset for Rapid Entry
    const nameInput = document.getElementById('feat-name-input');
    if (nameInput) { 
        nameInput.value = ''; 
        nameInput.focus(); 
    }
    
    const results = document.getElementById('feat-search-results');
    if (results) {
        results.innerHTML = '';
        results.style.display = 'none';
    }

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

//===========================INFINITE GRID=========================================
state.v2 = {
    zoom: 1,
    pan: { x: 400, y: 200 },
    activeDragId: null, // 🚀 NEW: Tracks current node moving
    isFromTray: false,   // 🚀 NEW: Distinguishes between mapping and moving
    expandedNodes: state.v2?.expandedNodes || new Set(),
    looseNodes: [], // For the brain dump
    dragContext: null
};

state.v2.connectionMode = {
    active: false,
    sourceId: null
};

state.v2.expandedNodes = state.v2.expandedNodes || new Set();

state.v2.trayTypeFilter = state.v2.trayTypeFilter || 'All';

state.v2.trayExpandedNodes = state.v2.trayExpandedNodes || new Set();

state.v2.selectedNodes = new Set();

// Add this to your global listeners if it's not there
document.addEventListener('mousedown', (e) => {
    // If we click the background canvas or a card, hide the connection toolbar
    if (!e.target.closest('.v2-connection-group') && !e.target.closest('#v2-context-toolbar')) {
        const ctxBar = document.getElementById('v2-context-toolbar');
        if (ctxBar) ctxBar.style.display = 'none';
        
        document.querySelectorAll('.v2-connection-group.is-sticky').forEach(el => {
            el.classList.remove('is-sticky');
        });
        
        state.v2.activeConnection = null;
    }
});

OL.handleContextAction = function(action) {
    const conn = state.v2.activeConnection;
    if (!conn) return;

    // 🚀 THE FIX: Use the actual DOM ID to hide the bar
    const ctxBar = document.getElementById('v2-context-toolbar');
    
    switch(action) {
        case 'logic':
            if (ctxBar) ctxBar.style.display = 'none'; // Replaces the missing function
            OL.openLogicBuilder(conn);
            break;

        case 'delete':
            if (conn.isLeash) OL.unlinkParent(conn.sourceId);
            else OL.removeConnection(conn.sourceId, conn.outcomeIdx);
            if (ctxBar) ctxBar.style.display = 'none';
            break;
            
        case 'reorder':
            OL.requestReorder(conn.sourceId, conn.targetId);
            break;

        case 'delay':
            const delay = prompt("Enter delay (e.g., 24h, 2d):", "1h");
            if (delay) OL.saveConnectionDelay(conn, delay);
            break;
        
        case 'loop':
            if (ctxBar) ctxBar.style.display = 'none';
            OL.openLoopBuilder(conn);
            break;
    }
};

OL.openLogicBuilder = function(conn) {
    const sourceRes = OL.getResourceById(conn.sourceId);
    const targetRes = OL.getResourceById(conn.targetId);
    
    if (!sourceRes || !targetRes) return;

    // 🎯 DATA LOOKUP LOGIC
    let currentLogic;
    
    if (conn.isLeash || conn.outcomeIdx === null || conn.outcomeIdx === undefined) {
        // It's a Leash: Data is on the sourceRes (which we ensured is the Child)
        currentLogic = sourceRes.logic || { field: '', operator: 'contains', value: '' };
        console.log("🔍 Loading Logic from Leash Root:", sourceRes.id);
    } else {
        // It's a Flow Path: Data is in the outcome array
        const outcome = sourceRes.outcomes?.[conn.outcomeIdx] || {};
        currentLogic = outcome.logic || { field: '', operator: 'contains', value: '' };
        console.log("🔍 Loading Logic from Outcome Index:", conn.outcomeIdx);
    }

    const modalHtml = `
        <div id="logic-modal" class="modal-backdrop" style="z-index: 10000; position: fixed; inset: 0; background: rgba(0,0,0,0.8); display: flex; align-items: center; justify-content: center;">
            <div class="modal-content" style="background: #1e293b; padding: 25px; border-radius: 12px; border: 1px solid var(--accent); width: 400px; color: white;">
                <div class="modal-header" style="margin-bottom: 20px;">
                    <h3 class="tiny accent uppercase bold" style="color: var(--accent); margin: 0;">${conn.isLeash ? 'Leash Logic' : 'Path Logic'}</h3>
                    <div style="font-size: 11px; opacity: 0.6;">${sourceRes.name} ➔ ${targetRes.name}</div>
                </div>
                
                <div class="modal-body" style="display: flex; flex-direction: column; gap: 15px;">
                    <div>
                        <label class="tiny uppercase bold muted" style="display: block; margin-bottom: 5px; font-size: 9px;">Field / Property</label>
                        <input type="text" id="logic-field" class="modal-input" style="width: 100%; background: #0b0f1a; border: 1px solid #334155; color: white; padding: 8px; border-radius: 4px;" placeholder="e.g. user_role" value="${currentLogic.field || ''}">
                    </div>
                    
                    <div style="display: flex; gap: 10px; align-items: flex-end;">
                        <div style="flex: 1;">
                            <label class="tiny uppercase bold muted" style="display: block; margin-bottom: 5px; font-size: 9px;">Operator</label>
                            <select class="logic-operator-select" 
                                    onchange="OL.toggleLogicValueField(this)"
                                    style="width: 100%; height: 35px; background: #0b0f1a; border: 1px solid #334155; color: white; padding: 0 8px; border-radius: 4px; font-size: 12px; appearance: none; cursor: pointer;">
                                <option value="contains" ${currentLogic.operator === 'contains' ? 'selected' : ''}>contains</option>
                                <option value="not_contains" ${currentLogic.operator === 'not_contains' ? 'selected' : ''}>does not contain</option>
                                <option value="equals" ${currentLogic.operator === 'equals' ? 'selected' : ''}>is exactly</option>
                                <option value="exists" ${currentLogic.operator === 'exists' ? 'selected' : ''}>exists / has value</option>
                                <option value="not_exists" ${currentLogic.operator === 'not_exists' ? 'selected' : ''}>is empty</option>
                            </select>
                        </div>

                        <div id="logic-value-wrapper" style="flex: 1; transition: all 0.2s ease; opacity: ${(currentLogic.operator === 'exists' || currentLogic.operator === 'not_exists') ? '0' : '1'};">
                            <label class="tiny uppercase bold muted" style="display: block; margin-bottom: 5px; font-size: 9px;">Value</label>
                            <input type="text" id="logic-value" 
                                class="modal-input" 
                                style="width: 100%; height: 35px; background: #0b0f1a; border: 1px solid #334155; color: white; padding: 0 8px; border-radius: 4px; font-size: 12px;" 
                                placeholder="Value..."
                                value="${currentLogic.value || ''}">
                        </div>
                    </div>
                </div>

                <div class="modal-footer" style="margin-top: 25px; display: flex; justify-content: flex-end; gap: 10px;">
                    <button class="btn soft tiny" onclick="document.getElementById('logic-modal').remove()">Cancel</button>
                    <button class="btn primary tiny" onclick="OL.saveLogic('${conn.sourceId}', ${conn.outcomeIdx !== undefined ? conn.outcomeIdx : 'null'})">Save Logic</button>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
};

OL.toggleLogicValueField = function(selectEl) {
    const wrapper = document.getElementById('logic-value-wrapper');
    const input = document.getElementById('logic-value');
    
    const unaryOperators = ['exists', 'not_exists'];
    const isUnary = unaryOperators.includes(selectEl.value);

    if (wrapper && input) {
        if (isUnary) {
            wrapper.style.opacity = '0';
            wrapper.style.pointerEvents = 'none';
            input.value = ''; // Reset data for clean save
        } else {
            wrapper.style.opacity = '1';
            wrapper.style.pointerEvents = 'auto';
        }
    }
};

OL.saveLogic = function(targetId, outcomeIdx) {
    const logicData = {
        field: document.getElementById('logic-field')?.value || '',
        operator: document.querySelector('.logic-operator-select')?.value || 'contains',
        value: document.getElementById('logic-value')?.value || '' 
    };

    const client = getActiveClient();
    const res = client?.projectData?.localResources.find(r => String(r.id) === String(targetId));

    if (!res) return;

    if (outcomeIdx !== null && outcomeIdx !== undefined && outcomeIdx !== 'null') {
        // Flow Path (Parent Outcome)
        if (!res.outcomes) res.outcomes = [];
        if (res.outcomes[outcomeIdx]) res.outcomes[outcomeIdx].logic = logicData;
    } else {
        // 🚀 LEASH: Saved to the Resource Root (The Child/SOP)
        res.logic = logicData;
        console.log(`🔥 SUCCESS: Logic saved to ID ${targetId} (Child)`);
    }

    OL.persist();
    document.getElementById('logic-modal')?.remove();
    OL.drawV2Connections();
};

OL.saveConnectionDelay = async function(conn, delayValue) {
    // 🎯 Determine the correct target ID BEFORE the sync block
    // If it's a leash, we save to the CHILD (targetId)
    const targetId = conn.isLeash ? conn.sourceId : conn.sourceId; 
    // Wait—look at your Loop Builder log: 
    // sourceId is 'sop-1772837917778' (The Child).
    // So for leashes, we use sourceId directly as the target.

    await OL.updateAndSync(() => {
        const res = OL.getResourceById(conn.sourceId);
        if (!res) return;

        if (conn.isLeash || conn.outcomeIdx === null || conn.outcomeIdx === undefined) {
            // 🚀 LEASH FIX: Save directly to the resource root
            res.delay = delayValue;
            console.log(`✅ Leash Delay saved to Child (${res.id}): ${delayValue}`);
        } else {
            // ⚡ FLOW PATH: Save to the specific outcome
            if (res.outcomes && res.outcomes[conn.outcomeIdx]) {
                res.outcomes[conn.outcomeIdx].delay = delayValue;
            }
        }
    });

    window.renderGlobalVisualizer(window.location.hash.includes('vault'));
    console.log(`⏱ Delay of ${delayValue} added to path.`);
};

OL.openLoopBuilder = function(conn) {
    console.log("🛠️ Attempting to open Loop Builder for:", conn);
    
    const sourceRes = OL.getResourceById(conn.sourceId);
    if (!sourceRes) {
        console.error("❌ Could not find source resource for ID:", conn.sourceId);
        return;
    }

    const outcome = sourceRes.outcomes?.[conn.outcomeIdx] || {};
    const currentLoop = outcome.loop || { type: 'times', value: '3' };

    // Remove any existing loop modal first to prevent duplicates
    const existing = document.getElementById('loop-modal');
    if (existing) existing.remove();

    const modalHtml = `
        <div id="loop-modal" class="modal-backdrop" style="z-index: 100000; position: fixed; inset: 0; background: rgba(0,0,0,0.85); display: flex; align-items: center; justify-content: center;" onclick="this.remove()">
            <div class="modal-content" style="background: #1e293b; padding: 24px; border-radius: 12px; border: 1px solid var(--accent); width: 400px; box-shadow: 0 20px 50px rgba(0,0,0,0.5);" onclick="event.stopPropagation()">
                <div class="modal-header" style="margin-bottom: 20px;">
                    <h3 class="tiny accent uppercase bold" style="color: var(--accent); margin: 0;">∞ Loop Configuration</h3>
                    <div style="font-size: 11px; opacity: 0.6; margin-top: 4px;">Pattern for: ${sourceRes.name}</div>
                </div>
                
                <div class="modal-body" style="display: flex; flex-direction: column; gap: 16px;">
                    <div>
                        <label class="tiny uppercase bold muted" style="display: block; margin-bottom: 6px; font-size: 9px; letter-spacing: 1px;">Repeat Logic</label>
                        <select id="loop-type" class="modal-input" style="width: 100%; background: #0b0f1a; border: 1px solid #334155; color: white; padding: 10px; border-radius: 6px;" onchange="OL.toggleLoopLabels(this.value)">
                            <option value="times" ${currentLoop.type === 'times' ? 'selected' : ''}>Fixed Iterations</option>
                            <option value="collection" ${currentLoop.type === 'collection' ? 'selected' : ''}>For Each Item in List</option>
                            <option value="until" ${currentLoop.type === 'until' ? 'selected' : ''}>Until Condition is Met</option>
                        </select>
                    </div>
                    
                    <div>
                        <label id="loop-value-label" class="tiny uppercase bold muted" style="display: block; margin-bottom: 6px; font-size: 9px; letter-spacing: 1px;">
                            ${currentLoop.type === 'collection' ? 'Variable Name' : currentLoop.type === 'until' ? 'Condition' : 'Number of Times'}
                        </label>
                        <input type="text" id="loop-value" class="modal-input" style="width: 100%; background: #0b0f1a; border: 1px solid #334155; color: white; padding: 10px; border-radius: 6px;" placeholder="e.g. 5" value="${currentLoop.value || ''}">
                    </div>
                </div>

                <div class="modal-footer" style="margin-top: 30px; display: flex; justify-content: flex-end; gap: 12px;">
                    <button class="btn soft tiny" onclick="document.getElementById('loop-modal').remove()">Cancel</button>
                    <button class="btn primary tiny" onclick="OL.saveLoop('${conn.sourceId}', ${conn.outcomeIdx})">Set Loop</button>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);
    console.log("✅ Loop Modal Injected into DOM");
};

// Toggle helper for labels
OL.toggleLoopLabels = function(val) {
    const lbl = document.getElementById('loop-value-label');
    const inp = document.getElementById('loop-value');
    if (val === 'times') { lbl.innerText = "Number of Times"; inp.placeholder = "e.g. 5"; }
    else if (val === 'collection') { lbl.innerText = "Variable Name"; inp.placeholder = "e.g. users_list"; }
    else { lbl.innerText = "Condition"; inp.placeholder = "e.g. status == 'done'"; }
};

// Helper to keep the UI reactive
OL.updateLoopLabel = function(val) {
    const lbl = document.getElementById('loop-val-label');
    if (val === 'times') lbl.innerText = "Number of Times";
    else if (val === 'collection') lbl.innerText = "List/Variable Name";
    else lbl.innerText = "Condition Logic";
};

// Helper to update labels when the dropdown changes
OL.toggleLoopInputs = function(type) {
    const label = document.getElementById('loop-label');
    const input = document.getElementById('loop-value');
    if (type === 'times') {
        label.innerText = "Number of Iterations";
        input.placeholder = "e.g. 3";
    } else if (type === 'collection') {
        label.innerText = "Variable / List Name";
        input.placeholder = "e.g. line_items";
    } else {
        label.innerText = "Stop Condition";
        input.placeholder = "e.g. status == 'success'";
    }
};

OL.saveLoop = async function(sourceId, outcomeIdx) {
    const type = document.getElementById('loop-type')?.value || 'count';
    const value = document.getElementById('loop-value')?.value || '1';
    
    await OL.updateAndSync(() => {
        const res = OL.getResourceById(sourceId);
        if (!res) return;

        // 🎯 THE LEASH CHECK
        if (outcomeIdx === null || outcomeIdx === undefined || outcomeIdx === 'null') {
            // Save to the root of the SOP resource
            res.loop = { type, value };
            res.isLoop = true; // Set a simple flag for easy checking
            console.log(`✅ Loop data saved to Resource Root: ${sourceId}`);
        } else {
            // Save to the specific outcome path
            if (!res.outcomes) res.outcomes = [];
            if (res.outcomes[outcomeIdx]) {
                res.outcomes[outcomeIdx].loop = { type, value };
                res.outcomes[outcomeIdx].isLoop = true;
            }
        }
    });

    document.getElementById('loop-modal')?.remove();
    OL.drawV2Connections();
};

OL.getInferredScope = (node) => {
    if (!node) return null;
    if (node.scope) return node.scope;
    if (node.originProject) return node.originProject;
    
    // Scan text for keywords
    const text = `${node.name || ''} ${node.description || ''}`.toLowerCase();
    if (text.includes('wealthbox')) return 'Wealthbox';
    if (text.includes('zapier')) return 'Zapier';
    if (text.includes('rightcapital')) return 'RightCapital';
    if (text.includes('redtail')) return 'Redtail';
    if (text.includes('attend')) return 'Attend Wealth';
    if (text.includes('kaylin')) return 'Kaylin Dillon';
    
    return null;
};

window.renderVisualizerV2 = function(isVault, targetId="v2-workbench-target") {
    const container = document.getElementById(targetId);
    if (!container) return;

    const client = getActiveClient();
    const allResources = isVault ? (state.master.resources || []) : (client?.projectData?.localResources || []);

    // 🏷️ Extract Unique Values for Dropdowns
    const types = [...new Set(allResources.map(r => r.type))].filter(Boolean).sort();
    const apps = [...new Set(allResources.map(r => r.integration?.app))].filter(Boolean).sort();
    const objects = [...new Set(allResources.map(r => r.integration?.object))].filter(Boolean).sort();
    const verbs = [...new Set(allResources.map(r => r.integration?.verb))].filter(Boolean).sort();
    const assignees = [...new Set([
        ...allResources.map(r => r.assigneeName),
        ...allResources.flatMap(r => (r.steps || []).map(s => s.assigneeName))
    ])].filter(Boolean).sort();

    // Get stage data to render sticky headers
    const sourceData = isVault ? state.master : (client?.projectData || {});
    const stages = (sourceData.stages || []).sort((a, b) => (a.order || 0) - (b.order || 0));

    const isAnyExpanded = state.v2.expandedNodes.size > 0;
    const isToggled = state.ui.sidebarOpen;
    const expandIcon = isAnyExpanded ? '📂' : '📁';
    const toggleIcon = isToggled ? '🔳' : '⬜';
    
    const totalWidth = (stages.length + 1) * 300;
    
    container.innerHTML = `
        <div class="v2-viewport" id="v2-viewport">
            
            <div class="v2-canvas-header-area">

                <div id="global-shelf" class="global-shelf-container"
                    style="scale: ${state.v2.zoom};"
                    ondragover="event.preventDefault(); this.classList.add('drag-over');"
                    ondragleave="this.classList.remove('drag-over');"
                    ondrop="OL.handleShelfDrop(event)">
                    <span class="global-shelf-label">Global Resources</span>
                </div>

                <div id="v2-sticky-stage-headers" style="width: ${totalWidth}px; transform: translateX(${state.v2.pan.x}px) scale(${state.v2.zoom});">
                    ${stages.map((s, i) => `
                        <div class="v2-lane-label" 
                            style="width: 300px; flex-shrink: 0; position: relative; pointer-events: none; overflow: visible; display: flex; align-items: center;">
                            
                            <div class="v2-label-interactive-area" 
                                style="pointer-events: all; display: flex; align-items: center; gap: 8px; background: rgba(255,255,255,0.05); padding: 4px 12px; border-radius: 20px;">
                                
                                <span class="stage-name-text" 
                                    contenteditable="true"
                                    onblur="OL.editStageName(${i}, this.innerText)"
                                    onmousedown="event.stopPropagation();"
                                    style="cursor: text; font-size: 12px; font-weight: 600;">
                                    ${esc(s.name)}
                                </span>

                                <button class="v2-lane-delete-btn" 
                                    style="pointer-events: all; cursor: pointer; background: none; border: none; color: #ef4444; font-size: 16px; line-height: 1;"
                                    onmousedown="event.stopPropagation();"
                                    onclick="event.stopPropagation(); console.log('Deleting stage ${i}'); OL.removeStage(${i})">
                                    ×
                                </button>
                            </div>

                            <div class="v2-lane-divider-trigger" 
                                style="pointer-events: all; position: absolute; right: -12px; z-index: 2500; cursor: pointer;"
                                onmousedown="event.stopPropagation();"
                                onclick="event.stopPropagation(); OL.addNewStageAfter(${i})">
                                <span>+</span>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>

            <div id="v2-canvas-scroll-wrap"  class="v2-canvas-scroll-wrap"
                onmousedown="OL.initV2Panning(event)"
                ondragover="event.preventDefault();" 
                ondrop="OL.handleCanvasDrop(event)">

                <div class="v2-canvas" id="v2-canvas" 
                    style="width: ${totalWidth}px; transform: translate3d(${state.v2.pan.x}px, ${state.v2.pan.y}px, 0) scale(${state.v2.zoom});">
                    
                    <div class="v2-stage-layer" id="v2-stage-layer">
                        ${stages.map((s, i) => {
                            const leftPos = i * 300; // This is the starting point
                            return `
                                <div class="v2-lane-section" 
                                    data-lane-id="${s.id || i}" 
                                    style="position: absolute; left: ${leftPos}px; top: 0; bottom: 0; width: 300px;">
                                    
                                    <div class="v2-lane-guide"></div>

                                    <div class="v2-add-stage-trigger" 
                                        onclick="event.stopPropagation(); OL.addNewStageAfter(${i})"
                                        title="Add Stage After ${esc(s.name)}">
                                        <div class="v2-add-icon">+</div>
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>

                    <svg class="v2-svg-layer" id="v2-connections" style="width: ${totalWidth}px" ></svg>
                    <div class="v2-node-layer" id="v2-nodes" style="width: ${totalWidth}px">     </div>
                </div>
            </div>

            <div class="v2-ui-overlay">
                <div class="v2-master-toolbar" style="display: flex; flex-direction: column; align-items: flex-start;">
                    <div class="v2-toolbar">
                        <div class="canvas-search-wrap" 
                            style="display: flex; align-items: center; gap: 8px; border-right: 1px solid rgba(255,255,255,0.1); padding-right: 10px; margin-right: 4px;">
                            <span style="font-size: 12px; opacity: 0.5;">🔍</span>
                            <input type="text" id="canvas-filter-input" 
                                placeholder="Search canvas..." 
                                oninput="OL.filterCanvasNodes(this.value)"
                                style="background: transparent; border: none; color: var(--main-text); font-size: 11px; width: 150px; outline: none;">
                        </div>
                        <button class="btn primary" onclick="OL.openBrainDump()">🧠 Brain Dump</button>
                        <button id="filter-menu-btn" class="btn soft" onclick="OL.toggleFilterMenu(event)">
                            🔍 Filter <span id="active-filter-count" class="pill tiny accent" style="display:none; margin-left:5px; font-size:9px; padding:1px 5px;">0</span>
                        </button>
                        <button class="btn soft" onclick="OL.autoAlignNodes()" title="Tidy">🪄</button>
                        <button class="btn soft" onclick="OL.toggleWorkbenchTray()">${toggleIcon}</button>
                        <button class="btn soft" onclick="OL.toggleMasterExpand()">${expandIcon}</button>
                        <button class="btn soft" onclick="OL.zoom(0.1)">+</button>
                        <button class="btn soft" onclick="OL.zoom(-0.1)">-</button>
                        
                        <div id="v2-context-toolbar" style="display:none;">
                            <div class="divider-v"></div>
                            <button class="btn soft ctx-logic" onclick="OL.handleContextAction('logic')">λ</button>
                            <button class="btn soft ctx-delay" onclick="OL.handleContextAction('delay')">⏱</button>
                            <button class="btn soft ctx-loop" onclick="OL.handleContextAction('loop')">⟳</button>
                            <button class="btn soft ctx-delete" onclick="OL.handleContextAction('delete')" style="color: #ef4444;">×</button>
                        </div>
                    </div>
                    
                    <div id="v2-filter-submenu" class="v2-toolbar context-menu" style="display: none;">
                        <select id="filter-type" class="canvas-select" onchange="OL.runCanvasFilters()">
                            <option value="">All Types</option>
                            ${types.map(t => `<option value="${t}">${t}</option>`).join('')}
                        </select>

                        <select id="filter-app" class="canvas-select" onchange="OL.runCanvasFilters()">
                            <option value="">All Apps</option>
                            ${apps.map(a => `<option value="${a}">${a}</option>`).join('')}
                        </select>

                        <select id="filter-object" class="canvas-select" onchange="OL.runCanvasFilters()">
                            <option value="">All Objects</option>
                            ${objects.map(o => `<option value="${o}">${o}</option>`).join('')}
                        </select>

                        <select id="filter-verb" class="canvas-select" onchange="OL.runCanvasFilters()">
                            <option value="">All Verbs</option>
                            ${verbs.map(v => `<option value="${v}">${v}</option>`).join('')}
                        </select>

                        <div class="divider-v"></div>

                        <select id="filter-assignee" class="canvas-select" onchange="OL.runCanvasFilters()">
                            <option value="">All Owners</option>
                            ${assignees.map(a => `<option value="${a}">${a}</option>`).join('')}
                        </select>

                        <select id="filter-logic" class="canvas-select" onchange="OL.runCanvasFilters()">
                            <option value="">Any Logic</option>
                            <option value="has">With λ Logic</option>
                            <option value="none">Standard Path</option>
                        </select>

                        <select id="filter-delay" class="canvas-select" onchange="OL.runCanvasFilters()">
                            <option value="">Any Timing</option>
                            <option value="has">With ⏱ Delay</option>
                        </select>

                        <select id="filter-loop" class="canvas-select" onchange="OL.runCanvasFilters()">
                            <option value="">Any Repeat</option>
                            <option value="has">With ⟳ Loop</option>
                        </select>

                        <select id="filter-scoped" class="canvas-select" onchange="OL.runCanvasFilters()">
                            <option value="">All Status</option>
                            <option value="priced">Scoped ($)</option>
                            <option value="unpriced">Unscoped</option>
                        </select>
                    </div>
                </div>
            </div>
        </div>
    `;

    // 🌊 THE AUTO-CLOSE LISTENER (Optimized for Grid)
    const viewport = container.querySelector('#v2-viewport');
    if (viewport) {
        // 🌊 THE AUTO-CLOSE & CLEAR LISTENER
        viewport.addEventListener('mousedown', (e) => {
            // If we clicked a card, stop. (startNodeDrag handles that now)
            if (e.target.closest('.v2-node-card')) return;

            // If we clicked the background (and not a toolbar/button)
            if (!e.target.closest('.v2-toolbar') && !e.target.closest('.btn')) {
                console.log("🌊 Background clicked: Clearing selection");
                state.v2.selectedNodes.clear();
                
                // Reach up to close inspector
                const layout = document.querySelector('.three-pane-layout');
                if (layout) layout.classList.add('zen-mode-active');
                
                renderVisualizerV2(isVault);
            }
        });
    }

    // 🚀 POST-RENDER NODE SORTING
    // We need to physically move Global nodes into the shelf
    const allNodesHTML = renderV2Nodes(isVault);
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = allNodesHTML;

    const shelf = document.getElementById('global-shelf');
    const nodesLayer = document.getElementById('v2-nodes');

    // Filter and Append
    const nodesArray = Array.from(tempDiv.children);
    nodesArray.forEach(nodeEl => {
        if (nodeEl.classList.contains('on-shelf')) {
            shelf.appendChild(nodeEl);
        } else {
            nodesLayer.appendChild(nodeEl);
        }
    });

    setTimeout(() => {
        OL.initV2Panning();
        OL.drawV2Connections();
    }, 100);
};

OL.adjustLaneWidths = function() {
    const lanes = document.querySelectorAll('.v2-lane-section');
    const isVault = window.location.hash.includes('vault');
    const source = isVault ? state.master.resources : getActiveClient().projectData.localResources;

    lanes.forEach(laneEl => {
        const laneId = laneEl.getAttribute('data-lane-id');
        // Find all cards belonging to this lane
        const cardsInLane = source.filter(r => r.gridLane === laneId && r.coords);
        
        if (cardsInLane.length > 0) {
            // Find the card furthest to the right
            const maxRight = Math.max(...cardsInLane.map(r => r.coords.x + 260)); // 260 is card width + margin
            laneEl.style.width = `${maxRight}px`;
        } else {
            laneEl.style.width = '300px'; // Reset to default if empty
        }
    });
};

OL.recalculateLaneWidths = function() {
    const isVault = window.location.hash.includes('vault');
    const source = isVault ? state.master.resources : getActiveClient()?.projectData?.localResources;
    if (!source) return;

    const laneSections = document.querySelectorAll('.v2-lane-section');
    const laneLabels = document.querySelectorAll('.v2-lane-label');
    let accumulatedOffset = 0;

    laneSections.forEach((laneEl, i) => {
        const laneId = laneEl.getAttribute('data-lane-id');
        const cardsInLane = source.filter(r => (r.gridLane === laneId || r.stageId === laneId) && r.coords);
        
        // Calculate max width needed for this lane
        let laneWidth = 300; // default
        if (cardsInLane.length > 0) {
            const furthestRight = Math.max(...cardsInLane.map(r => r.coords.x + 320));
            // Furthest right is relative to the canvas, so we subtract the lane's start
            laneWidth = Math.max(300, furthestRight - (i * 300)); 
        }

        // Apply position and width
        laneEl.style.left = `${accumulatedOffset}px`;
        laneEl.style.width = `${laneWidth}px`;
        
        // Move the header label to match
        if (laneLabels[i]) {
            laneLabels[i].style.width = `${laneWidth}px`;
        }

        accumulatedOffset += laneWidth;
    });

    // Update the total canvas width so scrolling works
    const canvas = document.getElementById('v2-canvas');
    if (canvas) canvas.style.width = `${accumulatedOffset + 400}px`;
};

OL.toggleFilterMenu = function(e) {
    if (e) e.stopPropagation();
    const menu = document.getElementById('v2-filter-submenu');
    const btn = document.getElementById('filter-menu-btn');
    
    const isShowing = menu.style.display === 'flex';
    
    // Hide context menu if open
    document.getElementById('v2-context-toolbar').style.display = 'none';
    
    menu.style.display = isShowing ? 'none' : 'flex';
    btn.classList.toggle('active', !isShowing);
};

// Reset function to clear the highlights
OL.clearAllCanvasFilters = function() {
    const filters = ['canvas-filter-input', 'filter-type', 'filter-app', 'filter-assignee', 'filter-logic'];
    filters.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = "";
    });
    
    OL.runCanvasFilters(); // Run once more to reset the visual dimming
    document.getElementById('v2-filter-submenu').style.display = 'none';
    document.getElementById('filter-menu-btn').classList.remove('active');
};

OL.filterCanvasNodes = function(query) {
    const q = query.toLowerCase().trim();
    const cards = document.querySelectorAll('.v2-node-card');
    const connections = document.querySelectorAll('.v2-connection-group');

    if (!q) {
        // Reset everything if search is empty
        cards.forEach(c => c.classList.remove('node-dimmed', 'node-matched'));
        connections.forEach(l => l.style.opacity = "1");
        return;
    }

    cards.forEach(card => {
        const id = card.id.replace('v2-node-', '');
        const res = OL.getResourceById(id);
        if (!res) return;

        // 🔍 Deep Search: Check name OR internal steps
        const nameMatch = (res.name || "").toLowerCase().includes(q);
        const stepMatch = (res.steps || []).some(s => (s.name || s.text || "").toLowerCase().includes(q));

        if (nameMatch || stepMatch) {
            card.classList.remove('node-dimmed');
            card.classList.add('node-matched');
        } else {
            card.classList.add('node-dimmed');
            card.classList.remove('node-matched');
        }
    });

    // 🕸️ Optional: Dim connections that don't lead to a match
    connections.forEach(line => {
        line.style.opacity = "0.1";
    });
};

OL.runCanvasFilters = function() {
    const query = document.getElementById('canvas-filter-input')?.value.toLowerCase().trim();
    const typeF = document.getElementById('filter-type')?.value;
    const appF = document.getElementById('filter-app')?.value;
    const objF = document.getElementById('filter-object')?.value;
    const verbF = document.getElementById('filter-verb')?.value;
    const assigneeF = document.getElementById('filter-assignee')?.value;
    const logicF = document.getElementById('filter-logic')?.value;
    const delayF = document.getElementById('filter-delay')?.value;
    const loopF = document.getElementById('filter-loop')?.value;
    const scopedF = document.getElementById('filter-scoped')?.value;

    const cards = document.querySelectorAll('.v2-node-card');
    const connections = document.querySelectorAll('.v2-connection-group');

    cards.forEach(card => {
        const id = card.id.replace('v2-node-', '');
        const res = OL.getResourceById(id);
        if (!res) return;

        // 🔍 1. Metadata Checks
        const matchesSearch = !query || 
            (res.name || "").toLowerCase().includes(query) || 
            (res.steps || []).some(s => (s.name || s.text || "").toLowerCase().includes(query));
        
        const matchesType = !typeF || res.type === typeF;
        const matchesApp = !appF || res.integration?.app === appF;
        const matchesObj = !objF || res.integration?.object === objF;
        const matchesVerb = !verbF || res.integration?.verb === verbF;
        
        // 🔍 2. Assignee (Check root or any sub-step)
        const matchesAssignee = !assigneeF || 
            res.assigneeName === assigneeF || 
            (res.steps || []).some(s => s.assigneeName === assigneeF);

        // 🔍 3. Conditional Presence (Check Leash root OR Outcomes array)
        const hasLogic = !!(res.logic || (res.outcomes || []).some(o => o.logic));
        const matchesLogic = !logicF || (logicF === 'has' ? hasLogic : !hasLogic);

        const hasDelay = !!(res.delay || (res.outcomes || []).some(o => o.delay));
        const matchesDelay = !delayF || (delayF === 'has' ? hasDelay : !hasDelay);

        const hasLoop = !!(res.isLoop || res.loop || (res.outcomes || []).some(o => o.isLoop || o.loop));
        const matchesLoop = !loopF || (loopF === 'has' ? hasLoop : !hasLoop);

        // 🔍 4. Scoped Status
        const isScoped = OL.isResourceInScope(res.id);
        const matchesScoped = !scopedF || (scopedF === 'priced' ? isScoped : !isScoped);

        // 🏁 Result
        if (matchesSearch && matchesType && matchesApp && matchesObj && matchesVerb && 
            matchesAssignee && matchesLogic && matchesDelay && matchesLoop && matchesScoped) {
            card.classList.remove('node-dimmed');
            card.classList.add('node-matched');
        } else {
            card.classList.add('node-dimmed');
            card.classList.remove('node-matched');
        }
    });

    // Dim connections if any filter is active
    const isFiltered = query || typeF || appF || objF || verbF || assigneeF || logicF || delayF || loopF || scopedF;
    connections.forEach(l => l.style.opacity = isFiltered ? "0.1" : "1");
};

OL.editStageName = async function(index, newName) {
    // 1. Sanitize input
    const cleanName = newName.trim();
    const isVault = window.location.hash.includes('vault');
    const client = getActiveClient();
    
    // 2. Locate the source of truth
    const sourceData = isVault ? state.master : client?.projectData;
    
    if (!sourceData || !sourceData.stages || !sourceData.stages[index]) {
        console.error("❌ Stage update failed: Target not found.");
        return;
    }

    const oldName = sourceData.stages[index].name;
    if (cleanName === oldName) return;

    // 🚀 THE SYNC: Wrap in the global sync handler
    await OL.updateAndSync(() => {
        // Update the actual object in the state
        sourceData.stages[index].name = cleanName;
        console.log(`✅ Stage ${index} state updated to: ${cleanName}`);
    });

    // 3. Final visual refresh to lock it in
    window.renderGlobalVisualizer(isVault);
};

OL.removeStage = async function(index) {
    const isVault = window.location.hash.includes('vault');
    const target = isVault ? state.master : getActiveClient()?.projectData;
    const stageName = target.stages[index].name;

    if (!confirm(`Are you sure you want to remove the "${stageName}" stage?`)) return;

    await OL.updateAndSync(() => {
        target.stages.splice(index, 1);
        // Re-order remaining stages
        target.stages.forEach((s, i) => s.order = i);
    });

    window.renderVisualizerV2(isVault);
};

OL.addNewStage = async function() {
    const isVault = window.location.hash.includes('vault');
    const name = prompt("New Stage Name:");
    if (!name) return;

    await OL.updateAndSync(() => {
        // 1. Identify where to push the data
        let target;
        if (isVault) {
            target = state.master; // Global vault stages
        } else {
            const client = getActiveClient();
            if (!client.projectData) client.projectData = {};
            target = client.projectData; // Client-specific project stages
        }

        // 2. Push the new stage
        if (!target.stages) target.stages = [];
        target.stages.push({
            name: name,
            id: 'stage-' + Date.now(),
            order: target.stages.length
        });
    });

    // 3. 🚀 THE TRIGGER: Re-run the visualizer
    window.renderVisualizerV2(isVault);
};

OL.openBrainDump = function() {
    const html = `
        <div class="modal-head"><div class="modal-title-text">🧠 Smart Brain Dump</div></div>
        <div class="modal-body">
            <div class="smart-dump-container" style="display:flex; flex-direction:column; gap:15px;">
                <label class="tiny-label">WHAT DO YOU WANT TO AUTOMATE?</label>
                <input type="text" id="smart-dump-input" class="modal-input" 
                       placeholder="e.g. Stripe create customer or New HubSpot contact"
                       oninput="OL.updateSmartPreview(this.value)"
                       style="font-size: 16px; padding: 15px;">

                <div id="smart-preview-zone" class="smart-preview-card" 
                     style="background: rgba(255,255,255,0.03); border: 1px solid var(--line); padding: 15px; border-radius: 8px; display:none;">
                    </div>
            </div>
            <button class="btn primary full-width" id="smart-commit-btn" disabled onclick="OL.commitBrainDump()">Drop on Canvas</button>
        </div>
    `;
    openModal(html);
};

OL.updateSmartPreview = function(val) {
    const previewZone = document.getElementById('smart-preview-zone');
    const commitBtn = document.getElementById('smart-commit-btn');
    
    if (!val || val.length < 3) {
        previewZone.style.display = 'none';
        commitBtn.disabled = true;
        return;
    }

    const data = OL.parseSmartInput(val);
    previewZone.style.display = 'block';
    
    // Store data on the element for the commit function to grab
    previewZone.dataset.parsed = JSON.stringify(data);

    previewZone.innerHTML = `
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
            <div><label class="tiny muted bold">APP</label><div class="accent">${data.app}</div></div>
            <div><label class="tiny muted bold">TYPE</label><div style="color: ${data.type === 'triggers' ? '#ffbf00' : '#38bdf8'}">${data.type.toUpperCase()}</div></div>
            <div><label class="tiny muted bold">VERB</label><div>${data.verb || '---'}</div></div>
            <div><label class="tiny muted bold">OBJECT</label><div>${data.object || '---'}</div></div>
        </div>
        ${!data.verb ? '<div class="tiny muted italic" style="margin-top:10px; color:#ef4444;">No exact event match found... checking keywords.</div>' : ''}
    `;

    commitBtn.disabled = false;
};

OL.parseSmartInput = function(rawText) {
    const lib = state.master.automationLibrary || {};
    const text = rawText.toLowerCase().trim();
    
    let result = { app: 'Manual', type: 'actions', verb: '', object: '', matched: false };

    // 1. Identify the App first
    const appNames = Object.keys(lib);
    const matchedApp = appNames.find(a => text.includes(a.toLowerCase()));
    
    if (matchedApp) {
        result.app = matchedApp;
        result.matched = true;
        const appData = lib[matchedApp];

        // 2. Identify the specific Event within that App
        const allEvents = [
            ...appData.triggers.map(t => ({...t, group: 'triggers'})),
            ...appData.actions.map(a => ({...a, group: 'actions'}))
        ];

        // Sort by length to catch specific matches first
        allEvents.sort((a, b) => b.full.length - a.full.length);

        const matchedEvent = allEvents.find(e => text.includes(e.full.toLowerCase()));

        if (matchedEvent) {
            result.type = matchedEvent.group;
            
            // 🚀 THE LOGIC FIX: 
            // We use the pre-split verb/object from our database loader
            // which already handled the "Invitee Created" vs "Create Invitee" logic.
            result.verb = matchedEvent.verb;
            result.object = matchedEvent.object;
        }
    }
    return result;
};

// 2. Fetch Verb/Object from DB when App is selected
OL.syncZapLogic = function(selectEl) {
    const row = selectEl.closest('.bd-draft-item');
    const appName = selectEl.value;
    const eventSelect = row.querySelector('.bd-verb');
    
    // Clear the verbs immediately
    eventSelect.innerHTML = `<option value="">Select Event...</option>`;

    const library = state.master.automationLibrary || {};
    const appData = library[appName];
    
    if (!appData) return;

    let html = `<option value="">Select Event...</option>`;
    
    // Build the triggers and actions list
    const format = (entry) => `<option value="${entry.full}" data-verb="${entry.verb}" data-obj="${entry.object}">${entry.verb} [${entry.object}]</option>`;

    if (appData.triggers?.length) {
        html += `<optgroup label="⚡ Triggers">${appData.triggers.map(format).join('')}</optgroup>`;
    }
    if (appData.actions?.length) {
        html += `<optgroup label="🛠️ Actions">${appData.actions.map(format).join('')}</optgroup>`;
    }

    eventSelect.innerHTML = html;
};

OL.initV2Panning = function() {
    const viewport = document.getElementById('v2-viewport');
    if (!viewport) return;

    let isPanning = false;
    let startX, startY;

    viewport.onmousedown = (e) => {
        // Only pan if clicking the background
        if (e.target.closest('.v2-node-card') || e.target.closest('.btn') || e.target.closest('.v2-toolbar')) return;

        isPanning = true;
        startX = e.clientX - state.v2.pan.x;
        startY = e.clientY - state.v2.pan.y;
        
        viewport.style.cursor = 'grabbing';
    };

    // 🚀 USE DOCUMENT instead of window/viewport for smoother tracking
    document.addEventListener('mousemove', (e) => {
        if (!isPanning) return;
        
        state.v2.pan.x = e.clientX - startX;
        state.v2.pan.y = e.clientY - startY;

        const canvas = document.getElementById('v2-canvas');
        const headers = document.getElementById('v2-sticky-stage-headers');

        // 🏎️ Use requestAnimationFrame for buttery smooth 60fps
        requestAnimationFrame(() => {
            if (canvas) {
                canvas.style.transform = `translate3d(${state.v2.pan.x}px, ${state.v2.pan.y}px, 0) scale(${state.v2.zoom})`;
            }
            if (headers) {
                // Headers follow X pan but stay at top
                headers.style.transform = `translateX(${state.v2.pan.x}px) scale(${state.v2.zoom})`;
            }
        });
    });

    document.addEventListener('mouseup', () => {
        isPanning = false;
        if(viewport) viewport.style.cursor = 'grab';
    });
};

OL.zoom = function(delta) {
    const canvas = document.getElementById('v2-canvas');
    if (!canvas) return;

    // 1. Calculate new zoom level
    let newZoom = (state.v2.zoom || 1) + delta;
    
    // 2. Clamp values (0.2x min, 2.0x max)
    if (newZoom < 0.2) newZoom = 0.2;
    if (newZoom > 2.0) newZoom = 2.0;

    // 3. Update State
    state.v2.zoom = newZoom;

    // 4. Apply to DOM immediately for smoothness
    // Note: We include the pan coordinates so zooming doesn't reset your position
    const { x, y } = state.v2.pan || { x: 0, y: 0 };
    canvas.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${newZoom})`;
    
    console.log(`🔍 Zoom Level: ${Math.round(newZoom * 100)}%`);
};

// 🚚 Dragging from Tray (MouseDown)
OL.handleTrayDrag = function(e, resId) {
    e.preventDefault();
    state.v2.activeDragId = resId;
    state.v2.isFromTray = true;
    OL.initWBMotion(e, resId);
};

// 🖱️ Dragging on Canvas (MouseDown)
OL.startNodeDrag = function(e, nodeId) {
    if (e.target.classList.contains('v2-port')) return;
    if (e.target.closest('.v2-step-item')) return;

    const idStr = String(nodeId);
    const isVault = window.location.hash.includes('vault');
    
    // 🚀 NEW: Check if the element is in the Sidebar/Tray
    const isFromTray = !!e.target.closest('.v2-workbench-tray') || !!e.target.closest('.v2-sidebar');

    if (e.shiftKey && !isFromTray) { // Only handle shift-select if NOT in the tray
        e.preventDefault();
        e.stopPropagation();

        if (state.v2.selectedNodes.has(idStr)) {
            state.v2.selectedNodes.delete(idStr);
        } else {
            state.v2.selectedNodes.add(idStr);
        }
        
        renderVisualizerV2(isVault); 
        return; 
    } 

    // NORMAL DRAG
    // Only clear selection if we aren't dragging from the tray
    if (!isFromTray && !state.v2.selectedNodes.has(idStr)) {
        state.v2.selectedNodes.clear();
        state.v2.selectedNodes.add(idStr);
    }

    state.v2.activeDragId = idStr;
    state.v2.isFromTray = isFromTray; // ⬅️ Ensure this is set correctly
    
    OL.initWBMotion(e, idStr);
};

// ⚙️ THE PHYSICS CORE
OL.initWBMotion = function(e, id) {
    const isVault = window.location.hash.includes('vault');
    const canvas = document.getElementById('v2-canvas');
    const rect = canvas.getBoundingClientRect();
    const zoom = state.v2.zoom || 1;
    const startX = e.clientX;
    const startY = e.clientY;
    
    // 🚀 THE FIX: Define zone here so all sub-functions can see it
    const zone = document.getElementById('unmap-zone');
    let hasMovedSignificantAmount = false;

    // Capture initial coordinates for every selected node
    const dragGroup = Array.from(state.v2.selectedNodes).map(nodeId => {
        const res = OL.getResourceById(nodeId);
        return {
            id: nodeId,
            initialX: res.coords?.x || 0,
            initialY: res.coords?.y || 0,
            el: document.getElementById(`v2-node-${nodeId}`)
        };
    });

    const onMove = (mE) => {
        const dx = (mE.clientX - startX) / zoom;
        const dy = (mE.clientY - startY) / zoom;

        // 1. 📏 CHECK THRESHOLD
        if (!hasMovedSignificantAmount) {
            const dist = Math.hypot(mE.clientX - startX, mE.clientY - startY);
            if (dist < 5) return; 
            hasMovedSignificantAmount = true;

            document.body.classList.add('is-dragging-node');

            if (zone) zone.classList.add('visible');
            
            dragGroup.forEach(node => {
                if (node.el) node.el.classList.add('is-dragging');
            });
        }

        // 🚀 2. APPLY DELTA TO ALL SELECTED ELEMENTS
        dragGroup.forEach(node => {
            if (node.el) {
                node.el.style.left = `${node.initialX + dx}px`;
                node.el.style.top = `${node.initialY + dy}px`;
            }
        });
        OL.recalculateLaneWidths();
        OL.drawV2Connections();

        // 3. 🎯 DETECT HOVER TARGET
        const target = document.elementFromPoint(mE.clientX, mE.clientY);
        const isOverUnmap = !!target?.closest('#unmap-zone');

        document.querySelectorAll('.v2-node-card').forEach(c => c.classList.remove('drop-target-highlight'));
        const targetCardEl = target?.closest('.v2-node-card');
        
        // Highlight logic (Only if target isn't part of the dragged group)
        if (targetCardEl && !state.v2.selectedNodes.has(targetCardEl.id.replace('v2-node-', ''))) {
            targetCardEl.classList.add('drop-target-highlight');
        }

        if (zone) {
            if (isOverUnmap) {
                zone.classList.add('is-hovered');
                targetCardEl?.classList.remove('drop-target-highlight');
            } else {
                zone.classList.remove('is-hovered');
            }
        }

        // 4. 👻 HANDLE GHOST (Primary node only)
        let ghost = document.getElementById('drag-ghost');
        if (target?.closest('#v2-workbench-target')) {
            if (!ghost) {
                ghost = document.createElement('div');
                ghost.id = 'drag-ghost';
                ghost.className = 'v2-node-card ghost';
                canvas.appendChild(ghost);
            }
            const res = OL.getResourceById(id);
            ghost.innerHTML = `<b style="color:var(--accent)">${res?.name || 'Mapping...'}</b>`;
            ghost.style.left = `${(mE.clientX - rect.left) / zoom}px`;
            ghost.style.top = `${(mE.clientY - rect.top) / zoom}px`;
        }
    };
    
    const onUp = async (uE) => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        document.body.classList.remove('is-dragging-node');

        if (!hasMovedSignificantAmount) {
            state.v2.activeDragId = null;
            return; 
        }

        const isVault = window.location.hash.includes('vault');
        const dx = (uE.clientX - startX) / zoom;
        const dy = (uE.clientY - startY) / zoom;

        await OL.updateAndSync(async () => {
            const client = getActiveClient();
            const source = isVault ? (state.master.resources || []) : (client?.projectData?.localResources || []);
            if (!source) throw new Error("Sync aborted: Source data unreachable.");

            for (const node of dragGroup) {
                const movingRes = source.find(r => String(r.id) === String(node.id));
                if (!movingRes) continue;

                const elementsAtPoint = document.elementsFromPoint(uE.clientX, uE.clientY);
                const targetCardEl = elementsAtPoint.find(el => 
                    el.classList.contains('v2-node-card') && !state.v2.selectedNodes.has(el.id.replace('v2-node-', ''))
                );

                if (targetCardEl) {
                    const targetId = targetCardEl.id.replace('v2-node-', '');
                    const parentRes = source.find(r => String(r.id) === String(targetId));

                    if (parentRes && parentRes.id !== movingRes.id) {
                        // 🧬 UNIFIED MERGE: Check if moving item has steps OR is a loose step
                        const hasSteps = movingRes.steps && movingRes.steps.length > 0;
                        const isLooseStep = movingRes.type === 'STEP' || movingRes.type === 'SOP';

                        if (hasSteps || isLooseStep) {
                            console.log("🧬 Absorbing content into target...");

                            // 1. Prepare steps to move (either the children or the node itself)
                            const stepsToMove = hasSteps 
                                ? JSON.parse(JSON.stringify(movingRes.steps)) 
                                : [JSON.parse(JSON.stringify(movingRes))];

                            parentRes.steps = [...(parentRes.steps || []), ...stepsToMove];
                            
                            // 2. Normalize mapOrder
                            parentRes.steps.forEach((s, i) => s.mapOrder = i);

                            // 3. Promote parent to RESOURCE if it was just a STEP
                            if (parentRes.type === 'STEP' || parentRes.type === 'SOP') {
                                parentRes.type = 'RESOURCE';
                            }

                            // 4. Remove the source card
                            const idx = source.findIndex(r => String(r.id) === String(movingRes.id));
                            if (idx > -1) source.splice(idx, 1);

                            // 🚀 AUTO-EXPAND: Ensure the user sees the new steps immediately
                            state.v2.expandedNodes.add(parentRes.id);

                            // 5. Update naming/counters
                            OL.refreshFamilyNaming(parentRes, source);
                        } else {
                            // Standard Nesting Fallback
                            if (!parentRes.steps) parentRes.steps = [];
                            parentRes.steps.push({
                                id: 'link_' + Date.now(),
                                name: movingRes.name || "Step",
                                resourceLinkId: movingRes.id
                            });
                            delete movingRes.coords;
                            movingRes.parentId = parentRes.id;
                            
                            // Also auto-expand for nesting
                            state.v2.expandedNodes.add(parentRes.id);
                        }
                    }
                } else {
                    // Standard Repositioning
                    movingRes.coords = {
                        x: node.initialX + dx,
                        y: node.initialY + dy
                    };
                }
            }
        });

        const ghost = document.getElementById('drag-ghost');
        if (ghost) ghost.remove();
        state.v2.activeDragId = null;
        OL.recalculateLaneWidths();
        window.renderGlobalVisualizer(isVault);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
};

OL.performInternalMerge = function(moving, target, source) {
    const stepsToMove = JSON.parse(JSON.stringify(moving.steps || []));
    target.steps = [...target.steps, ...stepsToMove];
    target.steps.forEach((s, i) => s.mapOrder = i);

    const idx = source.findIndex(r => r.id === moving.id);
    if (idx > -1) source.splice(idx, 1);
    
    // Refresh family counters
    OL.refreshFamilyNaming(target, source);
};

OL.refreshFamilyNaming = function(targetRes, source) {
    if (!targetRes || !source) return;

    // 1. Get the 'Base Name' by stripping any existing (1/2) suffixes
    const baseName = targetRes.name.replace(/\s\(\d+\/\d+\)$/, "").trim();
    
    // 2. Find all current parts on the canvas that share this base name
    const family = source.filter(r => {
        const rBase = r.name.replace(/\s\(\d+\/\d+\)$/, "").trim();
        return rBase === baseName;
    }).sort((a, b) => (a.coords?.y || 0) - (b.coords?.y || 0));

    // 3. Re-assign the counters based on the new current total
    if (family.length <= 1) {
        // If it's the only one left, remove the counter entirely
        family[0].name = baseName;
    } else {
        family.forEach((member, i) => {
            member.name = `${baseName} (${i + 1}/${family.length})`;
        });
    }
    console.log(`🏷️ Family naming refreshed for: ${baseName} (Total: ${family.length})`);
};

OL.syncDumpOptions = function() {
    const appVal = document.getElementById('dump-app').value;
    const typeVal = document.getElementById('dump-type').value; // 'triggers' or 'actions'
    const objEl = document.getElementById('dump-obj');
    const library = state.master.automationLibrary || {};
    const appData = library[appVal];

    if (appVal === 'Manual' || !appData) {
        objEl.innerHTML = `<option value="Task">Task</option><option value="Note">Note</option>`;
        OL.syncDumpVerbs();
        return;
    }

    // 1. Get events filtered by the selected Type (Trigger vs Action)
    const events = appData[typeVal] || [];
    
    // 2. Extract Unique Objects for this specific App + Type
    const uniqueObjects = [...new Set(events.map(e => e.object))].sort();

    // 3. Update Object Dropdown
    objEl.innerHTML = uniqueObjects.map(o => `<option value="${o}">${o}</option>`).join('');

    // 4. Cascade to update Verbs
    OL.syncDumpVerbs();
};

OL.syncDumpVerbs = function() {
    const appVal = document.getElementById('dump-app').value;
    const typeVal = document.getElementById('dump-type').value;
    const objVal = document.getElementById('dump-obj').value;
    const verbEl = document.getElementById('dump-verb');
    
    const library = state.master.automationLibrary || {};
    const appData = library[appVal];

    if (appVal === 'Manual' || !appData) {
        verbEl.innerHTML = `<option value="Create">Create</option><option value="Update">Update</option>`;
        return;
    }

    // Filter events by both Type AND the selected Object
    const events = appData[typeVal] || [];
    const availableVerbs = events
        .filter(e => e.object === objVal)
        .map(e => e.verb);
    
    verbEl.innerHTML = [...new Set(availableVerbs)].map(v => `<option value="${v}">${v}</option>`).join('');
};

OL.setVisualizerMode = function(mode, isVault) {
    state.viewMode = mode;
    localStorage.setItem('ol_preferred_view_mode', mode);
    
    // If switching to Graph, we might want to clear specific focuses to show the whole map
    if (mode === 'graph') {
        // state.focusedResourceId = null; // Optional: depending on if you want it auto-focused
    }
    
    // Re-run the visualizer orchestrator
    window.renderGlobalVisualizer(isVault);
};

// --- V2 GRAPH MODE RENDERERS ---

function renderV2Stages(isVault) {
    const client = getActiveClient();
    const sourceData = isVault ? state.master : (client?.projectData || {});
    const stages = (sourceData.stages || []).sort((a, b) => (a.order || 0) - (b.order || 0));

    if (stages.length === 0) return `<div class="v2-lane"><div class="v2-lane-label">No Stages Defined</div></div>`;

    return stages.map(s => `
        <div class="v2-lane" id="v2-lane-${s.id}">
            <div class="v2-lane-label">${esc(s.name)}</div>
        </div>
    `).join('');
}

// 1. Convert Raw Text to Draft Rows
OL.parseBrainDump = function() {
    const rawInput = document.getElementById('bd-raw-input').value;
    const lines = rawInput.split('\n').filter(line => line.trim().length > 0);
    const listContainer = document.getElementById('bd-draft-list');
    
    listContainer.innerHTML = '';
    
    if (lines.length === 0) {
        listContainer.innerHTML = '<div class="tiny muted italic text-center" style="margin-top: 50px;">No items parsed yet...</div>';
        OL.updateBDCount();
        return;
    }

    // 1. Get the Apps from your library
    const library = state.master.automationLibrary || {};
    const appOptions = Object.keys(library).sort().map(app => 
        `<option value="${app}">${app}</option>`
    ).join('');

    // 2. Generate rows using a <select> for the App
    listContainer.innerHTML = lines.map((line, i) => `
        <div class="bd-draft-item" style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; background: var(--bg); padding: 12px; border-radius: 8px; border: 1px solid #334155;">
            <div style="display: flex; gap: 8px; align-items: center;">
                <input type="text" class="modal-input tiny bd-main-name" value="${esc(line)}" style="flex: 1; font-weight: bold;">
                <button class="card-delete-btn" onclick="this.parentElement.parentElement.remove(); OL.updateBDCount();" style="position: static;">×</button>
            </div>
            <div style="display: flex; gap: 5px;">
                <select class="modal-input tiny bd-app" onchange="OL.syncZapLogic(this)" style="flex: 1;">
                    <option value="">Select App...</option>
                    ${appOptions}
                </select>
                
                <select class="modal-input tiny bd-verb" style="flex: 1.2;">
                    <option value="">Select Event...</option>
                </select>
            </div>
        </div>
    `).join('');

    OL.updateBDCount();
};

OL.updateBDCount = function() {
    const count = document.querySelectorAll('.bd-draft-item').length;
    const statsEl = document.getElementById('bd-stats');
    const commitBtn = document.getElementById('bd-commit-btn');
    
    if (statsEl) statsEl.innerText = `${count} items drafted`;
    if (commitBtn) commitBtn.disabled = count === 0;
};

OL.commitBrainDump = async function() {
    const previewZone = document.getElementById('smart-preview-zone');
    const data = JSON.parse(previewZone.dataset.parsed);
    const isVault = window.location.hash.includes('vault');

    // 🚀 THE NAMING ENGINE
    let finalName;
    if (data.type === 'triggers') {
        // Triggers: "Invitee Created" (Object then Verb)
        finalName = `${data.object} ${data.verb}`.trim();
    } else {
        // Actions: "Create Invitee" (Verb then Object)
        finalName = `${data.verb} ${data.object}`.trim();
    }

    // Fallback if parsing failed
    if (!data.verb || !data.object) {
        finalName = document.getElementById('smart-dump-input').value;
    }

    const newNode = {
        id: isVault ? `res-vlt-${Date.now()}` : `local-prj-${Date.now()}`,
        name: finalName,
        type: data.type === 'triggers' ? "Trigger" : "Action",
        coords: { x: 200, y: 200 },
        integration: data,
        createdDate: new Date().toISOString()
    };

    await OL.updateAndSync(() => {
        const targetList = isVault ? state.master.resources : getActiveClient().projectData.localResources;
        targetList.push(newNode);
    });

    OL.closeModal();
    renderGlobalVisualizer(isVault);
};

function renderV2Nodes(isVault) {
    const client = getActiveClient();
    let nodes = isVault ? (state.master.resources || []) : (client?.projectData?.localResources || []);

    // 1. Filter by Scope if active
    const visibleNodes = nodes.filter(node => (node.coords && typeof node.coords.x === 'number') || node.isGlobal);

    // 2. Filter by Scope if active
    let filteredNodes = visibleNodes;
    if (state.v2.activeScope && state.v2.activeScope !== 'all') {
        filteredNodes = visibleNodes.filter(n => 
            (n.scope === state.v2.activeScope || n.originProject === state.v2.activeScope)
        );
    }

    return filteredNodes.map((node, idx) => {
        const isGlobal = !!node.isGlobal;
        const icon = OL.getRegistryIcon(node.type);
        const steps = Array.isArray(node.steps) ? node.steps : [];
        const isExpanded = state.v2.expandedNodes.has(node.id);
        const typeClean = (node.type || "").toUpperCase();
        const isLooseStep = typeClean === 'SOP' || typeClean === 'STEP' || typeClean === 'INSTRUCTION';
        const isInScope = !!OL.isResourceInScope(node.id);

        const positionStyle = isGlobal 
            ? `position: relative; transform: none; margin: 0;` 
            : `position: absolute; left: ${node.coords.x}px; top: ${node.coords.y}px;`

       // Change it to a simple link that clears the filter flags
        // Inside renderV2Nodes
        const scopeBadge = isInScope ? `
            <div class="v2-scope-badge" 
                onclick="event.stopPropagation(); OL.navigateToScoping('${node.id}')"
                title="View in Scoping Sheet">
                $
            </div>
        ` : '';

        // 🚀 Dynamic Badge for standard resources
        const stepBadge = (steps.length > 0) ? 
            `<div class="v2-step-badge" onclick="event.stopPropagation(); OL.toggleStepView('${node.id}')">
                ${steps.length} Steps ${isExpanded ? '▴' : '▾'}
            </div>` : '';

        const duplicateBadge = `
            <div class="v2-duplicate-badge" 
                onclick="event.stopPropagation(); OL.duplicateResourceV2('${node.id}')"
                title="Duplicate Resource">
                ⿻
            </div>
        `;

        const stepsHtml = isExpanded ? steps.map((step, i) => {
            const content = step.text || step.name || "Step";
            const portInId = `port-in-${node.id}-step-${i}`;
            const portOutId = `port-out-${node.id}-step-${i}`;

            // 🚀 THE STEP ROW
            let rowHtml = `
                <div class="v2-step-row-container">
                    <div class="v2-step-item"
                        onmousedown="event.stopPropagation();"
                        onclick="event.stopPropagation(); OL.loadInspector('${step.id}', '${node.id}')">
                        
                        <div class="v2-port step-port-in" id="${portInId}" onclick="event.stopPropagation(); OL.handlePortClick('${node.id}', 'in', ${i})"></div>
                        
                        <div style="display: flex; align-items: center; justify-content: space-between; padding: 4px 12px; width: 100%;">
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <span class="v2-step-number">${i + 1}</span>
                                <span class="v2-step-text" style="font-size: 11px;">${esc(content)}</span>
                            </div>
                            <div class="v2-step-eject" onclick="event.stopPropagation(); OL.ejectStep('${node.id}', ${i})">🪂</div>
                        </div>
                        
                        <div class="v2-port step-port-out" id="${portOutId}" onclick="event.stopPropagation(); OL.handlePortClick('${node.id}', 'out', ${i})"></div>
                    </div>
                </div>
            `;

            // 🚀 THE SPLIT DIVIDER (Injected BETWEEN rows)
            if (i < node.steps.length - 1) {
                rowHtml += `
                    <div class="v2-step-divider" onclick="event.stopPropagation(); OL.splitResourceAtStep('${node.id}', ${i})">
                        <div class="split-icon">✂️</div>
                    </div>
                `;
            }

            return rowHtml;
        }).join('') : '';

        // Add 4 tiny invisible/subtle hit-areas for linking
        const cornerLinkers = isLooseStep ? `
            <div class="v2-corner-link tl" onmousedown="OL.startParentLinking(event, '${node.id}', 'tl')"></div>
            <div class="v2-corner-link tr" onmousedown="OL.startParentLinking(event, '${node.id}', 'tr')"></div>
            <div class="v2-corner-link bl" onmousedown="OL.startParentLinking(event, '${node.id}', 'bl')"></div>
            <div class="v2-corner-link br" onmousedown="OL.startParentLinking(event, '${node.id}', 'br')"></div>
        ` : '';

        // Context Icon update: show active link if parentId exists
        const contextIcon = node.parentId 
            ? `<i class="fas fa-link active-link-icon" title="Leashed to Parent" style="color: #fbbf24;"></i>`
            : (isLooseStep ? `<i class="fas fa-ghost muted-icon"></i>` : `<i class="fas fa-cube"></i>`);

        const isSelected = state.v2.selectedNodes.has(String(node.id));
      
        const nodeID = String(node.id);

        // 1. Try to find the Resource directly in the Project (Local)
        let res = OL.getResourceById(nodeID);

        // 2. 🚀 THE PARACHUTE FIX: 
        // If it's a loose step, its name might be stored in 'node.text' 
        // or as a 'resourceLinkId' reference.
        const displayName = res?.name || node.text || node.name || "Untitled Step";

        return `
            <div class="v2-node-card ${isSelected ? 'is-selected' : ''} ${isGlobal ? 'on-shelf' : ''} ${isLooseStep ? 'is-loose type-step' : 'is-resource'} ${isExpanded ? 'is-expanded' : ''}" 
                id="v2-node-${node.id}"
                style="${positionStyle}; ${node.parentId ? 'border-left: 3px solid #fbbf24;' : ''}"
                onmousedown="event.stopPropagation(); OL.startNodeDrag(event, '${node.id}')"
                onclick="if(event.shiftKey) { event.stopPropagation(); return; } OL.loadInspector('${node.id}')">

                ${cornerLinkers}

                <div class="v2-context-corner">${contextIcon}</div>
                ${scopeBadge}
                ${duplicateBadge}
                ${stepBadge}
                
                <div class="v2-port port-in" title="In" onclick="event.stopPropagation(); OL.handlePortClick('${node.id}', 'in')"></div>
                <div class="v2-port port-out" title="Out" onclick="event.stopPropagation(); OL.handlePortClick('${node.id}', 'out')"></div>
                <div class="v2-port port-top" title="Top" onclick="event.stopPropagation(); OL.handlePortClick('${node.id}', 'in')"></div>
                <div class="v2-port port-bottom" title="Bottom" onclick="event.stopPropagation(); OL.handlePortClick('${node.id}', 'out')"></div>

                <div class="v2-node-header" style="display: flex; justify-content: ${isLooseStep ? 'flex-end' : 'flex-start'}; align-items: center; gap: 8px; pointer-events: none;">
                    <span>${icon}</span>
                    <span class="tiny muted uppercase bold" style="font-size: 8px;">${esc(node.type)}</span>
                </div>
                
                <div class="v2-node-body" 
                style="text-align: ${isLooseStep ? 'right' : 'left'}; padding-right: ${isLooseStep ? '4px' : '0'};">
                    ${esc(displayName|| node.text || "Untitled Step")}
                </div>

                <div class="v2-steps-preview" id="steps-${node.id}" style="display: ${isExpanded ? 'block' : 'none'}">
                    ${stepsHtml}
                </div>
            </div>
        `;
    }).join('');
}

// --- DUPLICATE LOGIC ---
OL.duplicateResourceV2 = async function(resourceId) {
    const isVault = location.hash.includes('vault');
    const source = isVault ? state.master.resources : getActiveClient().projectData.localResources;
    const original = source.find(r => r.id === resourceId);
    if (!original) return;

    await OL.updateAndSync(() => {
        const clone = JSON.parse(JSON.stringify(original));
        clone.id = 'res-' + Date.now();
        clone.coords.x += 30; // Slight offset so it's visible
        clone.coords.y += 30;
        
        // Remove counter if duplicating a split part, or keep base name
        clone.name = original.name.replace(/\s\(\d+\/\d+\)$/, "") + " (Copy)";
        
        source.push(clone);
    });
    if (window.renderGlobalVisualizer) window.renderGlobalVisualizer(isVault);
};

// --- MERGE LOGIC (Internal logic for handleUniversalDrop) ---
OL.mergeResources = async function(droppedId, targetId) {
    const isVault = location.hash.includes('vault');
    const source = isVault ? state.master.resources : getActiveClient().projectData.localResources;
    
    const moving = source.find(r => String(r.id) === String(droppedId));
    const target = source.find(r => String(r.id) === String(targetId));

    if (!moving || !target || moving.id === target.id) return;

    await OL.updateAndSync(() => {
        // 🚀 1. EXTRACT STEPS ONLY
        // We ensure we are grabbing the step data, not the resource reference
        const stepsToMove = JSON.parse(JSON.stringify(moving.steps || []));
        
        // 🚀 2. APPEND & RE-INDEX
        target.steps = [...target.steps, ...stepsToMove];
        target.steps.forEach((s, i) => s.mapOrder = i);

        // 🚀 3. DELETE THE OLD CONTAINER
        const movingIdx = source.findIndex(r => String(r.id) === String(droppedId));
        if (movingIdx > -1) source.splice(movingIdx, 1);

        // 🚀 4. RE-CALCULATE FAMILY (The Counter Fix)
        const baseName = target.name.replace(/\s\(\d+\/\d+\)$/, "").trim();
        
        // Find everyone currently ALIVE on the canvas with this base name
        const family = source.filter(r => 
            r.name.replace(/\s\(\d+\/\d+\)$/, "").trim() === baseName
        ).sort((a, b) => (a.coords?.y || 0) - (b.coords?.y || 0));

        // Update the numbers based on the new current total
        if (family.length <= 1) {
            family[0].name = baseName; // Remove (1/1) if it's the only one left
        } else {
            family.forEach((member, i) => {
                member.name = `${baseName} (${i + 1}/${family.length})`;
            });
        }
    });

    if (window.renderGlobalVisualizer) window.renderGlobalVisualizer(isVault);
};

OL.splitResourceAtStep = async function(resourceId, splitAfterIndex) {
    const isVault = location.hash.includes('vault');
    const source = isVault ? state.master.resources : getActiveClient().projectData.localResources;
    const original = source.find(r => r.id === resourceId);

    if (!original || !original.steps || original.steps.length < 2) return;

    await OL.updateAndSync(() => {
        // 1. Clone Part 2
        const part2 = JSON.parse(JSON.stringify(original));
        part2.id = 'res-' + Date.now();
        
        // 2. Distribute the steps
        const originalSteps = [...original.steps];
        original.steps = originalSteps.slice(0, splitAfterIndex + 1);
        part2.steps = originalSteps.slice(splitAfterIndex + 1);

        // 🚀 THE FIX: Ensure coordinates exist before sorting
        if (!original.coords) original.coords = { x: 100, y: 100 };
        part2.coords = { 
            x: original.coords.x, 
            y: original.coords.y + (original.steps.length * 40) + 60 
        };

        const baseName = original.name.replace(/\s\(\d+\/\d+\)$/, "").trim();
        
        // 1. Find all current parts (excluding the one we're about to add)
        const existingFamily = source.filter(r => 
            r.name.replace(/\s\(\d+\/\d+\)$/, "").trim() === baseName
        );

        // 2. The new total is existing + the one we just created
        const newTotal = existingFamily.length + 1;

        // 3. Combine them and sort by Y position for logical numbering
        const allParts = [...existingFamily, part2].sort((a, b) => 
            (a.coords?.y || 0) - (b.coords?.y || 0)
        );

        // 4. Assign fresh (X/Total) strings to everyone
        allParts.forEach((member, idx) => {
            member.name = `${baseName} (${idx + 1}/${newTotal})`;
        });

        source.push(part2);
    });

    if (window.renderGlobalVisualizer) window.renderGlobalVisualizer(isVault);
};

OL.navigateToScoping = function(resourceId) {
    const idStr = String(resourceId);
    
    // 1. Lock the state first
    state.viewMode = 'scoping';
    state.scopingTargetId = idStr;
    state.scopingFilterActive = true; 

    // 2. Switch Hash (Triggers page switch)
    window.location.hash = `#/scoping-sheet?focus=${resourceId}`;

    // 3. ⚡ FORCE RENDER: Explicitly call the function to ensure it uses the NEW state
    // Use a small timeout to let the hash-change settle
    setTimeout(() => {
        if (typeof renderScopingSheet === 'function') {
            console.log("⚡ Executing Surgical Render for ID:", idStr);
            renderScopingSheet();
        }
    }, 50);
};

OL.jumpToScopingItem = function(nodeId) {
    console.log("🧨 KILLING VISUALIZER CONTEXT for:", nodeId);

    // 1. Wipe the state that triggers the visualizer branches
    state.viewMode = 'scoping';
    state.focusedResourceId = null;
    state.focusedWorkflowId = null;
    state.scopingTargetId = nodeId;
    state.scopingFilterActive = true;

    // 2. 🛑 THE KILL SWITCH: Overwrite the view registry immediately
    // This stops any background sync from calling renderGlobalVisualizer
    OL.registerView(() => renderScopingSheet());

    // 3. Update the URL
    const url = new URL(window.location.href);
    url.searchParams.set('view', 'scoping');
    url.hash = "#/scoping-sheet"; 
    window.history.pushState({}, '', url.toString());

    // 4. Force Render
    window.renderScopingSheet();
};

OL.handlePortClick = async function(nodeId, direction, stepIndex = null) {
    const nodeEl = document.getElementById(`v2-node-${nodeId}`);

    // 1. STARTING A CONNECTION
    if (!state.v2.connectionMode.sourceId) {
        if (direction === 'out') {
            state.v2.connectionMode.sourceId = nodeId;
            state.v2.connectionMode.sourceStepIndex = stepIndex; // 🚀 Store which step started this
            nodeEl.classList.add('source-selected');
            console.log(`🔌 Connection started from Node: ${nodeId}, Step: ${stepIndex ?? 'Main'}`);
        }
        return;
    }

    // 2. FINISHING A CONNECTION (Always target the Card's 'In' port for now)
    if (direction === 'in') {
        const sourceId = state.v2.connectionMode.sourceId;
        const sourceStepIdx = state.v2.connectionMode.sourceStepIndex;
        
        if (sourceId === nodeId && sourceStepIdx === stepIndex) return; 

        await OL.updateAndSync(() => {
            const isVault = window.location.hash.includes('vault');
            const source = isVault ? state.master.resources : getActiveClient().projectData.localResources;
            const sourceNode = source.find(n => n.id === sourceId);
            
            if (sourceNode) {
                const newLink = {
                    id: 'link_' + Date.now(),
                    fromStepIndex: sourceStepIdx, 
                    toStepIndex: stepIndex, // 🚀 SAVE THE TARGET STEP
                    action: `jump_res_${nodeId}`,
                    label: "Next Step"
                };

                if (!sourceNode.outcomes) sourceNode.outcomes = [];
                sourceNode.outcomes.push(newLink);
            }
        });

        OL.resetWiringState();
        OL.drawV2Connections();
    }
};

// Add this to your event listeners or onclick in the HTML
OL.jumpToParent = function(parentId) {
    const parentEl = document.getElementById(`v2-node-${parentId}`);
    if (parentEl) {
        parentEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Optional: Trigger a brief glow on the parent
        parentEl.classList.add('drop-target-highlight');
        setTimeout(() => parentEl.classList.remove('drop-target-highlight'), 1000);
    }
};

OL.drawV2Connections = function() {
    const svg = document.getElementById('v2-connections');
    if (!svg) return;

    const isVault = window.location.hash.includes('vault');
    const source = isVault ? (state.master.resources || []) : (getActiveClient()?.projectData?.localResources || []);
    
    svg.innerHTML = ''; 
    svg.setAttribute('viewBox', '0 0 5000 5000');

    // Ensure this is globally accessible or at the top of OL.drawV2Connections
   function drawIcon(x, y, char, tooltip) {
        const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
        g.style.cursor = "help"; // 🚀 Visual cue that there is hover info

        const bg = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        bg.setAttribute("cx", x);
        bg.setAttribute("cy", y);
        bg.setAttribute("r", "9"); // 🚀 Reduced size
        bg.setAttribute("fill", "#1e293b"); 
        bg.setAttribute("stroke", "#fbbf24");
        bg.setAttribute("stroke-width", "1");
        
        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("x", x);
        text.setAttribute("y", y);
        text.setAttribute("fill", "#fbbf24");
        text.setAttribute("font-size", char === "⏱" ? "9px" : "11px"); // 🚀 Proportional scaling
        text.setAttribute("text-anchor", "middle");
        text.setAttribute("dominant-baseline", "central");
        text.setAttribute("font-weight", "bold");
        text.textContent = char;

        // 🚀 THE HOVER PARAMETERS:
        const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
        title.textContent = tooltip; 
        
        g.appendChild(bg);
        g.appendChild(text);
        g.appendChild(title); // This creates the native browser tooltip
        
        return g;
    }

    // 🚀 NEW HELPER: Calculate position based on line direction
    function getSmartOffsetPos(sAnchor, eAnchor, index) {
        const gap = 22;
        const margin = 28;
        const offset = margin + (index * gap);

        // Calculate relative distance
        const dx = Math.abs(sAnchor.x - eAnchor.x);
        const dy = Math.abs(sAnchor.y - eAnchor.y);

        // 🎯 LOGIC: 
        // If dy > dx, cards are stacked vertically -> Align icons HORIZONTALLY
        // If dx > dy, cards are in different columns -> Align icons VERTICALLY
        const isVerticalFlow = dy > dx;

        if (isVerticalFlow) {
            // Stacked vertically: Move icons left/right of the port, then spread them horizontally
            const horizontalSpread = index * gap;
            return { 
                x: sAnchor.dir === 'left' ? sAnchor.x - margin - horizontalSpread : sAnchor.x + margin + horizontalSpread, 
                y: sAnchor.y 
            };
        } else {
            // Different columns: Spread them along the line direction
            switch (sAnchor.dir) {
                case 'right':  return { x: sAnchor.x + offset, y: sAnchor.y };
                case 'left':   return { x: sAnchor.x - offset, y: sAnchor.y };
                case 'bottom': return { x: sAnchor.x, y: sAnchor.y + offset };
                case 'top':    return { x: sAnchor.x, y: sAnchor.y - offset };
                default:       return { x: sAnchor.x + offset, y: sAnchor.y };
            }
        }
    }
    // 🚀 NEW HELPER: Resolves the 4 cardinal points of a card
    function getAnchors(r, canvasRect, zoom) {
        if (!r || !canvasRect) return []; // Return empty array if rect is missing
        return [
            { x: (r.left + r.width / 2 - canvasRect.left) / zoom, y: (r.top - canvasRect.top) / zoom, dir: 'top' },
            { x: (r.left + r.width / 2 - canvasRect.left) / zoom, y: (r.bottom - canvasRect.top) / zoom, dir: 'bottom' },
            { x: (r.left - canvasRect.left) / zoom, y: (r.top + r.height / 2 - canvasRect.top) / zoom, dir: 'left' },
            { x: (r.right - canvasRect.left) / zoom, y: (r.top + r.height / 2 - canvasRect.top) / zoom, dir: 'right' }
        ];
    }

    source.forEach(node => {
        // 🐕 1. REFINED LEASH LINES (Parent -> Child)
        if (node.parentId) {
            const parent = source.find(n => n.id === node.parentId);
            const sEl = document.getElementById(`v2-node-${parent?.id}`);
            const tEl = document.getElementById(`v2-node-${node.id}`);

            const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
            group.setAttribute("class", "v2-connection-group leash-link");

            let s, e;

            if (sEl && tEl) {
                const cRect = svg.getBoundingClientRect();
                const sR = sEl.getBoundingClientRect();
                const tR = tEl.getBoundingClientRect();

                const getCorners = (r) => [
                    { x: r.left - cRect.left, y: r.top - cRect.top },
                    { x: r.right - cRect.left, y: r.top - cRect.top },
                    { x: r.left - cRect.left, y: r.bottom - cRect.top },
                    { x: r.right - cRect.left, y: r.bottom - cRect.top }
                ];

                const pC = getCorners(sR);
                const cC = getCorners(tR);
                let minDist = Infinity;
                s = pC[0]; e = cC[0];

                pC.forEach(pc => {
                    cC.forEach(cc => {
                        const d = Math.hypot(pc.x - cc.x, pc.y - cc.y);
                        if (d < minDist) { minDist = d; s = pc; e = cc; }
                    });
                });
            } else if (parent && parent.coords && node.coords) {
                s = { x: parent.coords.x + 100, y: parent.coords.y + 80 };
                e = { x: node.coords.x + 100, y: node.coords.y };
            }

            if (s && e) {
                const midX = (s.x + e.x) / 2;
                const midY = (s.y + e.y) / 2 + 30;
                const pathData = `M ${s.x} ${s.y} Q ${midX} ${midY} ${e.x} ${e.y}`;

                const hitArea = document.createElementNS("http://www.w3.org/2000/svg", "path");
                hitArea.setAttribute("d", pathData);
                hitArea.setAttribute("stroke", "transparent");
                hitArea.setAttribute("stroke-width", "25");
                hitArea.setAttribute("fill", "none");
                hitArea.style.cursor = "pointer";

                const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
                path.setAttribute("d", pathData);
                path.setAttribute("stroke", "#fbbf24");
                path.setAttribute("stroke-width", "2");
                path.setAttribute("stroke-dasharray", "6,4");
                path.setAttribute("fill", "none");
                path.setAttribute("opacity", "0.6");

                group.onmousedown = (evt) => {
                    evt.stopPropagation();
                    
                    // 🎯 TARGETING THE CHILD:
                    // In this loop, 'node' is the child that possesses the leash.
                    // We want the logic to be saved to THIS node.
                    state.v2.activeConnection = { 
                        sourceId: node.id,    // <--- This must be the CHILD ID (the SOP)
                        targetId: parent.id,  // This is the Zap
                        outcomeIdx: null,
                        isLeash: true 
                    };

                    document.querySelectorAll('.v2-connection-group').forEach(el => el.classList.remove('is-sticky'));
                    group.classList.add('is-sticky');
                    
                    const bar = document.getElementById('v2-context-toolbar');
                    if (bar) bar.style.display = 'flex';
                };

                group.appendChild(hitArea);
                group.appendChild(path);

                // --- ICONS (Leash Logic) ---
                // 🎯 THE FIX: Fetch the 'Live' child to ensure logic/delay are visible after sync
                const liveChild = OL.getResourceById(node.id); 
                let iconOffset = 20;

                if (liveChild) {
                    console.log(`✨ Checking Live Child (${liveChild.id}):`, { logic: liveChild.logic, delay: liveChild.delay, loop: liveChild.loop });

                    // 🚀 1. RENDER LOGIC (Check for 'logic' object or 'hasLogic' flag)
                    if (liveChild.logic && (liveChild.logic.field || liveChild.logic.operator)) {
                        const text = drawIcon(s.x + iconOffset, s.y - 12, "λ", `Logic: ${liveChild.logic.field} ${liveChild.logic.operator}`);
                        group.appendChild(text);
                        iconOffset += 22; 
                    }

                    // ⏱️ 2. RENDER DELAY
                    if (liveChild.delay && liveChild.delay !== "0") {
                        const text = drawIcon(s.x + iconOffset, s.y - 12, "⏱", `Delay: ${liveChild.delay}`);
                        text.setAttribute("font-size", "12px");
                        group.appendChild(text);
                        iconOffset += 22;
                    }

                    // 🔄 3. RENDER LOOP (Improved check for your 'action' strings)
                    const isLooping = liveChild.isLoop || liveChild.allowLoop || liveChild.loop || (liveChild.action && liveChild.action.includes('loop'));
                    if (isLooping) {
                        const text = drawIcon(s.x + iconOffset, s.y - 12, "⟳", "Repeats");
                        text.setAttribute("font-size", "14px");
                        group.appendChild(text);
                    }
                }
                // Append the group to SVG *after* icons are added to it
                svg.appendChild(group);
            }
        }

        // ⚡ 2. FLOW PATHS (Outcomes)
        if (node.outcomes) {
            node.outcomes.forEach((outcome, outcomeIdx) => {
                let tid = outcome.targetId || outcome.toId;
                if (!tid && outcome.action) {
                    tid = outcome.action.replace('jump_res_', '').replace('jump_step_', '');
                }

                const canvas = document.getElementById('v2-canvas');
                const canvasRect = canvas.getBoundingClientRect();
                const zoom = state.v2.zoom || 1;

                // 🚀 1. SPECIFIC PORT RESOLUTION (The "Lock")
                const sourcePortId = (outcome.fromStepIndex !== null && outcome.fromStepIndex !== undefined)
                    ? `port-out-${node.id}-step-${outcome.fromStepIndex}`
                    : `port-out-${node.id}`;

                const targetPortId = (outcome.toStepIndex !== null && outcome.toStepIndex !== undefined)
                    ? `port-in-${tid}-step-${outcome.toStepIndex}`
                    : `port-in-${tid}`;

                const sPort = document.getElementById(sourcePortId);
                const tPort = document.getElementById(targetPortId);

                let sAnchor, eAnchor;

                // --- SOURCE ANCHOR RESOLUTION ---
                const sEl = document.getElementById(`v2-node-${node.id}`);
                if (!sEl) return;
                const sR = sEl.getBoundingClientRect();

                if (sPort && (outcome.fromStepIndex !== null && outcome.fromStepIndex !== undefined)) {
                    const r = sPort.getBoundingClientRect();
                    sAnchor = {
                        x: (r.left + r.width / 2 - canvasRect.left) / zoom,
                        y: (r.top + r.height / 2 - canvasRect.top) / zoom,
                        dir: 'right'
                    };
                } else {
                    const anchors = getAnchors(sR, canvasRect, zoom);
                    const tEl = document.getElementById(`v2-node-${tid}`);
                    const tRect = tEl ? tEl.getBoundingClientRect() : {left:0, top:0, width:0, height:0};
                    const tCenter = { 
                        x: (tRect.left + tRect.width/2 - canvasRect.left)/zoom, 
                        y: (tRect.top + tRect.height/2 - canvasRect.top)/zoom 
                    };
                    
                    sAnchor = anchors.length > 0 ? anchors.reduce((prev, curr) => 
                        Math.hypot(curr.x - tCenter.x, curr.y - tCenter.y) < Math.hypot(prev.x - tCenter.x, prev.y - tCenter.y) ? curr : prev, anchors[0]
                    ) : null;
                }

                if (!sAnchor) return;

                // --- TARGET ANCHOR RESOLUTION ---
                const tEl = document.getElementById(`v2-node-${tid}`);
                if (!tEl) return;
                const tR = tEl.getBoundingClientRect();

                if (tPort && (outcome.toStepIndex !== null && outcome.toStepIndex !== undefined)) {
                    const r = tPort.getBoundingClientRect();
                    eAnchor = {
                        x: (r.left + r.width / 2 - canvasRect.left) / zoom,
                        y: (r.top + r.height / 2 - canvasRect.top) / zoom,
                        dir: 'left'
                    };
                } else {
                    const anchors = getAnchors(tR, canvasRect, zoom);
                    eAnchor = anchors.length > 0 ? anchors.reduce((prev, curr) => 
                        Math.hypot(curr.x - sAnchor.x, curr.y - sAnchor.y) < Math.hypot(prev.x - sAnchor.x, prev.y - sAnchor.y) ? curr : prev, anchors[0]
                    ) : null;
                }

                if (!eAnchor) return;

                // 📐 PATH GENERATION (Bezier)
                const sX = sAnchor.x; const sY = sAnchor.y;
                const eX = eAnchor.x; const eY = eAnchor.y;
                let pathData;
                if (sAnchor.dir === 'top' || sAnchor.dir === 'bottom') {
                    const cpY = (sY + eY) / 2;
                    pathData = `M ${sX} ${sY} C ${sX} ${cpY}, ${eX} ${cpY}, ${eX} ${eY}`;
                } else {
                    const cpX = (sX + eX) / 2;
                    pathData = `M ${sX} ${sY} C ${cpX} ${sX < eX ? sY : eY}, ${cpX} ${sX < eX ? eY : sY}, ${eX} ${eY}`;
                }

                const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
                group.setAttribute("class", "v2-connection-group flow-link");

                group.onmousedown = (clickEvt) => {
                    clickEvt.stopPropagation();
                    clickEvt.preventDefault();
                    state.v2.activeConnection = { sourceId: node.id, targetId: tid, outcomeIdx: outcomeIdx, isLeash: false };
                    document.querySelectorAll('.v2-connection-group').forEach(el => el.classList.remove('is-sticky'));
                    group.classList.add('is-sticky');
                    const ctxBar = document.getElementById('v2-context-toolbar');
                    if (ctxBar) ctxBar.style.display = 'flex';
                };

                const visualPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
                visualPath.setAttribute("d", pathData);
                visualPath.setAttribute("stroke", "#fbbf24");
                visualPath.setAttribute("stroke-width", "2");
                visualPath.setAttribute("fill", "none");
                visualPath.setAttribute("marker-end", "url(#arrowhead-v2)");

                const hitArea = document.createElementNS("http://www.w3.org/2000/svg", "path");
                hitArea.setAttribute("d", pathData);
                hitArea.setAttribute("stroke", "transparent");
                hitArea.setAttribute("stroke-width", "20");
                hitArea.setAttribute("fill", "none");
                hitArea.style.cursor = "pointer";

                group.appendChild(hitArea);
                group.appendChild(visualPath);

                // 🛠️ DYNAMIC INDICATOR PLACEMENT
                // Inside the outcome loop:
                const indicators = [];
                if (outcome.isLoop) indicators.push({ 
                    char: "⟳", 
                    tip: `Loop: ${outcome.loopCount || 'Infinite'} times`, 
                    side: 'target' 
                });
                if (outcome.logic) indicators.push({ 
                    char: "λ", 
                    tip: `Condition: ${outcome.logic.field} ${outcome.logic.operator} ${outcome.logic.value}`, 
                    side: 'source' 
                });
                if (outcome.delay && outcome.delay !== "0") indicators.push({ 
                    char: "⏱", 
                    tip: `Wait: ${outcome.delay}`, 
                    side: 'source' 
                });

                const sourceIcons = indicators.filter(i => i.side === 'source');
                const targetIcons = indicators.filter(i => i.side === 'target');

                sourceIcons.forEach((icon, i) => {
                    const pos = getSmartOffsetPos(sAnchor, eAnchor, i);
                    group.appendChild(drawIcon(pos.x, pos.y, icon.char, icon.tip));
                });

                // Inside the targetIcons.forEach loop (for the Loop icon):
                targetIcons.forEach((icon, i) => {
                    // For target icons, we usually want them near the end of the line
                    const pos = getSmartOffsetPos(eAnchor, sAnchor, i); // Pass eAnchor as primary
                    group.appendChild(drawIcon(pos.x, pos.y, icon.char, icon.tip));
                });

                svg.appendChild(group);
            });
        }

    });
};

OL.createMiniMenu = function(midX, midY, isLeash, sourceId, targetId, outcomeIdx) {
    const menuGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
    menuGroup.setAttribute("class", "v2-mini-menu");
    
    const safeX = isNaN(midX) ? 100 : midX;
    const safeY = isNaN(midY) ? 100 : midY;
    
    menuGroup.setAttribute("transform", `translate(${safeX}, ${safeY})`);

    // An invisible circle that covers the entire menu area to prevent flicker
    const bridge = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    bridge.setAttribute("r", "50"); // Large enough to cover all icons
    bridge.setAttribute("fill", "transparent");
    bridge.setAttribute("style", "pointer-events: auto;");
    menuGroup.appendChild(bridge);

    // Define our buttons: [Label/Icon, Color, Action]
    const actions = [
        { id: 'logic', icon: 'λ', color: '#8b5cf6', title: 'Add Logic' },
        { id: 'delay', icon: '⏱', color: '#06b6d4', title: 'Set Delay' },
        { id: 'loop', icon: '↻', color: '#10b981', title: 'Looping' },
        { id: 'delete', icon: '×', color: '#ef4444', title: 'Delete' },
        { id: 'reroute', icon: '⇄', color: '#f59e0b', title: 'Reroute' }
    ];

    // Add the "Reorder" button ONLY for leashes
    if (isLeash) {
        actions.push({ id: 'reorder', icon: '☰', color: '#3b82f6', title: 'Reorder in Parent' });
    }

    actions.forEach((btn, i) => {
        const btnG = document.createElementNS("http://www.w3.org/2000/svg", "g");
        btnG.setAttribute("class", `menu-item btn-${btn.id}`);
        btnG.setAttribute("style", "cursor: pointer;");
        
        // Arrange in a small grid or offset pattern
        const offsetX = (i % 3 - 1) * 24;
        const offsetY = (Math.floor(i / 3) - 0.5) * 24;

        btnG.innerHTML = `
            <circle cx="${offsetX}" cy="${offsetY}" r="10" fill="${btn.color}" stroke="white" stroke-width="1.5" />
            <text x="${offsetX}" y="${offsetY + 3.5}" text-anchor="middle" font-size="10" fill="white" font-weight="bold" style="pointer-events:none; font-family: Arial;">${btn.icon}</text>
            <title>${btn.title}</title>
        `;

        btnG.onclick = (e) => {
            e.stopPropagation();
            OL.handleMenuAction(btn.id, sourceId, targetId, outcomeIdx);
        };

        menuGroup.appendChild(btnG);
    });

    return menuGroup;
};

OL.handleMenuAction = function(action, sourceId, targetId, outcomeIdx) {
    console.log(`Action: ${action} on ${sourceId} -> ${targetId}`);
    
    switch(action) {
        case 'delete':
            if (outcomeIdx === undefined) OL.unlinkParent(sourceId); // It's a leash
            else OL.removeConnection(sourceId, outcomeIdx); // It's a flow line
            break;
        case 'reorder':
            // Request the index mapping we discussed earlier
            OL.requestReorder(sourceId, targetId);
            break;
        case 'logic':
            alert("Logic Builder coming soon!");
            break;
        // Add other cases as you build them
    }
};

OL.requestReorder = async function(stepId, parentId) {
    const isVault = window.location.hash.includes('vault');
    const source = isVault ? state.master.resources : getActiveClient().projectData.localResources;
    const parent = source.find(n => n.id === parentId);
    
    if (!parent) return;
    
    const currentIdx = (parent.steps || []).findIndex(s => s.id === stepId);
    const newPos = prompt(`Currently at position ${currentIdx + 1}. Enter new position (1 - ${parent.steps.length}):`);
    
    if (newPos) {
        const targetIdx = parseInt(newPos) - 1;
        // Logic to move the element in the parent.steps array...
        alert(`Moving to index ${targetIdx}`);
    }
};

OL.getRelativePointer = function(e, svg) {
    const canvas = document.getElementById('v2-canvas');
    const rect = canvas.getBoundingClientRect();
    const zoom = state.v2.zoom || 1;

    // 🚀 Calculate position relative to the SCALED canvas
    return {
        x: (e.clientX - rect.left) / zoom,
        y: (e.clientY - rect.top) / zoom
    };
};

OL.drawPathBetweenElements = function(svg, startCard, endCard, label, sourceId, outcomeIdx, outcomeData) {
    const canvas = document.getElementById('v2-canvas');
    const canvasRect = canvas.getBoundingClientRect();
    const zoom = state.v2.zoom || 1;

    // 🚀 NEW: Detect if the connection starts from the Global Shelf
    const isFromShelf = !!startCard.closest('#global-shelf');
    
    let outPort, inPort;

    // 1. RESOLVE PORTS
    if (outcomeData && typeof outcomeData.fromStepIndex === 'number') {
        outPort = document.getElementById(`port-out-${sourceId}-step-${outcomeData.fromStepIndex}`);
    }
    if (!outPort) {
        // Shelf items always exit from bottom, Grid items use dynamic logic
        outPort = isFromShelf ? startCard.querySelector('.port-bottom') : (
            Math.abs(endCard.offsetTop - startCard.offsetTop) > Math.abs(endCard.offsetLeft - startCard.offsetLeft)
            ? (endCard.offsetTop > startCard.offsetTop ? startCard.querySelector('.port-bottom') : startCard.querySelector('.port-top'))
            : (endCard.offsetLeft > startCard.offsetLeft ? startCard.querySelector('.port-out') : startCard.querySelector('.port-in'))
        );
    }

    inPort = endCard.querySelector('.port-top') || endCard.querySelector('.port-in');

    if (!outPort || !inPort) return;

    // 2. PIXEL-PERFECT COORDINATE NORMALIZATION
    // We calculate everything relative to the canvasRect so the line "starts" correctly in SVG space
    const oR = outPort.getBoundingClientRect();
    const iR = inPort.getBoundingClientRect();

    const s = {
        x: (oR.left - canvasRect.left + (oR.width / 2)) / zoom,
        y: (oR.top - canvasRect.top + (oR.height / 2)) / zoom
    };

    const e = {
        x: (iR.left - canvasRect.left + (iR.width / 2)) / zoom,
        y: (iR.top - canvasRect.top + (iR.height / 2)) / zoom
    };

    // 3. THE "S-CURVE" BRIDGE MATH
    let pathData;
    let midX, midY; // 🚀 Define these here

    if (isFromShelf || Math.abs(e.y - s.y) > Math.abs(e.x - s.x)) {
        // Vertical S-Curve
        const cpOffset = isFromShelf ? 100 : Math.min(Math.abs(e.y - s.y) / 2, 150);
        pathData = `M ${s.x} ${s.y} C ${s.x} ${s.y + cpOffset}, ${e.x} ${e.y - cpOffset}, ${e.x} ${e.y}`;
        
        // 🚀 Midpoint calculation for Vertical Cubic Bezier (t=0.5)
        midX = 0.125 * s.x + 0.375 * s.x + 0.375 * e.x + 0.125 * e.x; // Simplifies to (s.x + e.x) / 2
        midY = 0.125 * s.y + 0.375 * (s.y + cpOffset) + 0.375 * (e.y - cpOffset) + 0.125 * e.y;
    } else {
        // Horizontal Curve
        const cpOffset = Math.min(Math.abs(e.x - s.x) / 2, 150);
        pathData = `M ${s.x} ${s.y} C ${s.x + cpOffset} ${s.y}, ${e.x - cpOffset} ${e.y}, ${e.x} ${e.y}`;
        
        // 🚀 Midpoint calculation for Horizontal Cubic Bezier (t=0.5)
        midX = 0.125 * s.x + 0.375 * (s.x + cpOffset) + 0.375 * (e.x - cpOffset) + 0.125 * e.x;
        midY = 0.125 * s.y + 0.375 * s.y + 0.375 * e.y + 0.125 * e.y;
    }

    // 4. CREATE SVG GROUP & ATTACH MENU LOGIC
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.setAttribute("class", "v2-connection-group flow-link");

    // 🖱️ THE MENU FIX: Attach logic to the whole group and use clientX/Y for positioning
    group.onmousedown = (clickEvt) => {
        clickEvt.stopPropagation();
        clickEvt.preventDefault();
        
        const targetId = endCard.id.replace('v2-node-', '');
        state.v2.activeConnection = { sourceId, targetId, outcomeIdx, isLeash: false };

        // Visual feedback for selection
        document.querySelectorAll('.v2-connection-group').forEach(el => el.classList.remove('is-sticky'));
        group.classList.add('is-sticky');

        const ctxBar = document.getElementById('v2-context-toolbar');
        if (ctxBar) {
            // 🚀 RESET STYLES: Remove fixed positioning so it docks to the toolbar
            ctxBar.style.display = 'flex';
            ctxBar.style.position = 'static'; 
            ctxBar.style.left = 'auto';
            ctxBar.style.top = 'auto';
            
            // Hide reorder button for lines (usually only for nodes)
            const reorderBtn = document.getElementById('ctx-reorder-btn');
            if (reorderBtn) reorderBtn.style.display = 'none';
        }
    };

    // 4. INDICATOR STACK (Vertical Alignment)
    const res = OL.getResourceById(sourceId);
    const outcome = res?.outcomes?.[outcomeIdx] || outcomeData || {};
    
    const hasLogic = !!(outcome.logic && outcome.logic.field);
    const hasDelay = !!outcome.delay;
    const hasLoop = !!outcome.loop;

    if (hasLogic || hasDelay || hasLoop) {
        // Offset everything to the right of the line
        const badgeX = midX + 12;

        // --- ⏱ THE DELAY (Center Anchor) ---
        if (hasDelay) {
            const delayBadge = document.createElementNS("http://www.w3.org/2000/svg", "text");
            delayBadge.setAttribute("x", badgeX);
            delayBadge.setAttribute("y", midY + 4); // The "Zero" point
            delayBadge.setAttribute("fill", "#fbbf24");
            delayBadge.setAttribute("style", "font-size: 10px; font-weight: bold; pointer-events: auto; cursor: help;");
            
            const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
            title.textContent = `Delay: ${outcome.delay}`;
            delayBadge.appendChild(title);
            delayBadge.append(`⏱ ${outcome.delay}`);
            svg.appendChild(delayBadge);
        }

        // --- λ THE LOGIC (Positioned ABOVE Delay) ---
        if (hasLogic) {
            const logicBadge = document.createElementNS("http://www.w3.org/2000/svg", "text");
            logicBadge.setAttribute("x", badgeX);
            
            // If delay exists, move up. If not, stay at center.
            const logicY = hasDelay ? (midY - 8) : (midY + 4);
            
            logicBadge.setAttribute("y", logicY);
            logicBadge.setAttribute("fill", "#a855f7");
            logicBadge.setAttribute("style", "font-size: 12px; font-weight: 900; pointer-events: auto; cursor: help;");

            const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
            title.textContent = `Condition: If ${outcome.logic.field} ${outcome.logic.operator} ${outcome.logic.value}`;
            logicBadge.appendChild(title);
            logicBadge.append("λ");
            svg.appendChild(logicBadge);
        }

        // --- ∞ THE LOOP (Positioned BELOW Delay) ---
        if (hasLoop) {
            const loopBadge = document.createElementNS("http://www.w3.org/2000/svg", "text");
            loopBadge.setAttribute("x", badgeX);
            
            // logic is at -8, delay is at +4, so loop goes to +16 (creates even spacing)
            let loopY = midY + 4;
            if (hasDelay) loopY = midY + 16;
            else if (hasLogic) loopY = midY + 16; // Maintain gap even if delay is missing

            loopBadge.setAttribute("y", loopY);
            loopBadge.setAttribute("fill", "#10b981");
            loopBadge.setAttribute("style", "font-size: 14px; font-weight: bold; pointer-events: auto; cursor: help;");

            const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
            title.textContent = `Loop: Repeat ${outcome.loop.type} (${outcome.loop.value})`;
            loopBadge.appendChild(title);
            loopBadge.append("∞");
            svg.appendChild(loopBadge);
        }
    }
    
    // 5. APPEND PATHS
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathData);
    path.setAttribute("stroke", hasLogic ? "#a855f7" : (label ? "#fbbf24" : "rgba(56, 189, 248, 0.5)"));
    path.setAttribute("stroke-width", "2");
    path.setAttribute("fill", "none");

    const hitArea = document.createElementNS("http://www.w3.org/2000/svg", "path");
    hitArea.setAttribute("d", pathData);
    hitArea.setAttribute("stroke", "transparent");
    hitArea.setAttribute("stroke-width", "25");
    hitArea.setAttribute("fill", "none");
    hitArea.style.cursor = "pointer";

    group.appendChild(path);
    group.appendChild(hitArea);
    svg.appendChild(group);
};

OL.drawLeashLine = function(svg, childEl, parentEl, nodeId) {
    const res = OL.getResourceById(nodeId);
    const parent = OL.getResourceById(res?.parentId);

    if (!res?.coords || !parent?.coords) return;

    // 1. Define all 4 corners for both (using 200x80 card dimensions)
    const getCorners = (c) => [
        { x: c.x, y: c.y },           // Top Left
        { x: c.x + 200, y: c.y },     // Top Right
        { x: c.x, y: c.y + 80 },      // Bottom Left
        { x: c.x + 200, y: c.y + 80 }  // Bottom Right
    ];

    const cCorners = getCorners(res.coords);
    const pCorners = getCorners(parent.coords);

    // 2. Find the closest pair of corners
    let minDist = Infinity;
    let s = cCorners[0], e = pCorners[0];

    cCorners.forEach(cc => {
        pCorners.forEach(pc => {
            const dist = Math.hypot(cc.x - pc.x, cc.y - pc.y);
            if (dist < minDist) {
                minDist = dist;
                s = cc;
                e = pc;
            }
        });
    });

    // 3. 🚀 THE CURVE MATH: Create an organic "sag"
    // We use a mid-point with a slight Y-offset to make it look like a real leash
    const midX = (s.x + e.x) / 2;
    const midY = (s.y + e.y) / 2 + 20; // Adds 20px "gravity"
    const d = `M ${s.x} ${s.y} Q ${midX} ${midY} ${e.x} ${e.y}`;

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    path.setAttribute("stroke", "#fbbf24");
    path.setAttribute("stroke-width", "2");
    path.setAttribute("stroke-dasharray", "6,4");
    path.setAttribute("fill", "none");
    path.setAttribute("opacity", "0.6");
    
    svg.appendChild(path);
};

OL.startParentLinking = function(e, sourceId) {
    e.preventDefault(); e.stopPropagation();

    const canvas = document.getElementById('v2-canvas');
    const svg = document.getElementById('v2-connections');
    const sourceEl = document.getElementById(`v2-node-${sourceId}`);

    if (!svg || !sourceEl) return;

    // 1. 🚀 CHANGE: Create a PATH instead of a LINE
    const ghostLine = document.createElementNS("http://www.w3.org/2000/svg", "path");
    ghostLine.setAttribute("stroke", "#fbbf24");
    ghostLine.setAttribute("stroke-width", "3");
    ghostLine.setAttribute("stroke-dasharray", "5,5");
    ghostLine.setAttribute("fill", "none"); // Crucial for paths
    svg.appendChild(ghostLine);

    const onMouseMove = (moveEvent) => {
        const zoom = state.v2.zoom || 1;
        const canvasRect = canvas.getBoundingClientRect();
        const sourceRect = sourceEl.getBoundingClientRect();

        // 🚀 START AT CORNER: (Top-Left)
        const x1 = (sourceRect.left - canvasRect.left) / zoom;
        const y1 = (sourceRect.top - canvasRect.top) / zoom;

        // END AT MOUSE
        const x2 = (moveEvent.clientX - canvasRect.left) / zoom;
        const y2 = (moveEvent.clientY - canvasRect.top) / zoom;

        // 🚀 BEZIER MATH:
        // We create two control points to make the line "swing"
        const cp1x = x1; 
        const cp1y = y1 + (y2 - y1) * 0.5;
        const cp2x = x2; 
        const cp2y = y2 - (y2 - y1) * 0.5;

        const pathData = `M ${x1} ${y1} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${x2} ${y2}`;
        ghostLine.setAttribute("d", pathData);

        // Hover highlighting...
        const hit = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY);
        const targetCard = hit?.closest('.v2-node-card.is-resource');
        document.querySelectorAll('.v2-node-card').forEach(c => c.style.boxShadow = '');
        if (targetCard) {
            const tR = targetCard.getBoundingClientRect();
            const tCorners = [
                {x: tR.left, y: tR.top}, {x: tR.right, y: tR.top},
                {x: tR.left, y: tR.bottom}, {x: tR.right, y: tR.bottom}
            ];
            
            // Find closest corner of target to current mouse pos
            let bestCorner = tCorners[0];
            let minD = Infinity;
            tCorners.forEach(tc => {
                const d = Math.hypot(tc.x - moveEvent.clientX, tc.y - moveEvent.clientY);
                if (d < minD) { minD = d; bestCorner = tc; }
            });

            x2 = (bestCorner.x - canvasRect.left) / zoom;
            y2 = (bestCorner.y - canvasRect.top) / zoom;
        }
    };

    const onMouseUp = (upEvent) => {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        if (svg.contains(ghostLine)) svg.removeChild(ghostLine);

        const hit = document.elementFromPoint(upEvent.clientX, upEvent.clientY);
        const targetCard = hit?.closest('.v2-node-card.is-resource');
        document.querySelectorAll('.v2-node-card').forEach(c => c.style.boxShadow = '');

        if (targetCard) {
            const targetId = targetCard.id.replace('v2-node-', '');
            if (targetId !== sourceId) OL.linkStepToParent(sourceId, targetId);
        }
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
};

OL.linkStepToParent = async function(stepId, targetResourceId) {
    await OL.updateAndSync(() => {
        const isVault = window.location.hash.includes('vault');
        const source = isVault ? state.master.resources : getActiveClient().projectData.localResources;
        const node = source.find(n => n.id === stepId);
        
        if (node) {
            node.parentId = targetResourceId; 
            console.log(`✅ Data Locked: ${node.name} -> ${targetResourceId}`);
        }
    });

    // 🚀 THE FIX: Force immediate redraw of all connections
    if (typeof OL.drawV2Connections === 'function') {
        OL.drawV2Connections();
    }
};

OL.showParentLine = function(childId, parentId) {
    const childEl = document.getElementById(`v2-node-${childId}`);
    const parentEl = document.getElementById(`v2-node-${parentId}`);
    if (!childEl || !parentEl) return;

    // Create or find a temporary overlay line
    let ghostLine = document.getElementById('v2-ghost-line');
    if (!ghostLine) {
        ghostLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
        ghostLine.setAttribute('id', 'v2-ghost-line');
        document.getElementById('v2-svg-layer').appendChild(ghostLine);
    }

    // Get coordinates (accounting for zoom/pan if necessary)
    const x1 = parseInt(childEl.style.left) + 10;
    const y1 = parseInt(childEl.style.top) + 10;
    const x2 = parseInt(parentEl.style.left) + 100;
    const y2 = parseInt(parentEl.style.top) + 50;

    ghostLine.setAttribute('x1', x1);
    ghostLine.setAttribute('y1', y1);
    ghostLine.setAttribute('x2', x2);
    ghostLine.setAttribute('y2', y2);
    ghostLine.setAttribute('stroke', 'rgba(56, 189, 248, 0.5)'); // Semi-transparent blue
    ghostLine.setAttribute('stroke-width', '3');
    ghostLine.setAttribute('stroke-dasharray', '8,8');
    ghostLine.style.display = 'block';
};

OL.hideParentLine = function() {
    const ghostLine = document.getElementById('v2-ghost-line');
    if (ghostLine) ghostLine.style.display = 'none';
};

OL.unlinkParent = async function(nodeId) {
    if (!confirm("Remove this leash? The card will stay loose on the canvas.")) return;

    const isVault = window.location.hash.includes('vault');
    const client = getActiveClient();
    const source = isVault ? state.master.resources : client.projectData.localResources;
    
    const node = source.find(n => n.id === nodeId);
    if (node) {
        await OL.updateAndSync(() => {
            delete node.parentId; // 🚀 Sever the connection
        });
        
        // Refresh visuals
        renderVisualizerV2(isVault);
    }
};

OL.toggleStepView = function(nodeId) {
    if (!state.v2.expandedNodes) state.v2.expandedNodes = new Set();
    
    const isVault = window.location.hash.includes('vault');
    const client = getActiveClient();
    const source = isVault ? state.master.resources : client.projectData.localResources;
    
    const node = source.find(n => n.id === nodeId);
    if (!node || !node.coords) return;

    const wasExpanded = state.v2.expandedNodes.has(nodeId);
    const stepHeight = 32;
    const laneBuffer = 150;
    const shiftAmount = (node.steps?.length || 0) * stepHeight;

    // 1. Update State
    if (wasExpanded) state.v2.expandedNodes.delete(nodeId);
    else state.v2.expandedNodes.add(nodeId);

    // 2. Nudge nodes in the same lane
    source.forEach(otherNode => {
        if (otherNode.id === nodeId || !otherNode.coords) return;

        // Logic: Is it in the same lane AND below the toggled node?
        const isInLane = Math.abs(otherNode.coords.x - node.coords.x) < laneBuffer;
        const isBelow = otherNode.coords.y > node.coords.y;

        if (isInLane && isBelow) {
            if (wasExpanded) {
                otherNode.coords.y -= shiftAmount; // Pull up
            } else {
                otherNode.coords.y += shiftAmount; // Push down
            }
        }
    });

    // 3. Align, Persist and Paint
    renderVisualizerV2(isVault);

    // 3. Then we wait 50ms for the DOM to calculate the new heights, then tidy
    setTimeout(() => {
        OL.autoAlignNodes();
        OL.persist(); // Save positions once they are correct
    }, 50);
    
    setTimeout(() => OL.drawV2Connections(), 150);
};

OL.toggleMasterExpand = function() {
    const isVault = window.location.hash.includes('vault');
    const client = getActiveClient();
    const source = isVault ? state.master.resources : client.projectData.localResources;
    
    const hasExpanded = state.v2.expandedNodes.size > 0;
    const stepHeight = 32; 
    const laneBuffer = 150; // Nodes within 150px horizontally are considered in the same "lane"

    // 1. Get all nodes currently on the canvas
    const activeNodes = [...source].filter(n => n.coords);
    const padding = 20;

    // 2. Identify unique vertical lanes
    const lanes = [];
    activeNodes.forEach(node => {
        let foundLane = lanes.find(l => Math.abs(l.x - node.coords.x) < laneBuffer);
        if (foundLane) {
            foundLane.nodes.push(node);
        } else {
            lanes.push({ x: node.coords.x, nodes: [node] });
        }
    });

    // 3. Process each lane independently
    lanes.forEach(lane => {
        // Sort nodes in THIS lane top-to-bottom
        lane.nodes.sort((a, b) => a.coords.y - b.coords.y);

        let runningOffset = 0;

        lane.nodes.forEach(node => {
            if (hasExpanded) {
                // 🚀 COLLAPSE LOGIC (Pull up)
                node.coords.y -= runningOffset;
                if (state.v2.expandedNodes.has(node.id)) {
                    runningOffset += (node.steps?.length || 0) * stepHeight + padding;
                }
            } else {
                // 🚀 EXPAND LOGIC (Push down)
                node.coords.y += runningOffset;
                if (node.steps && node.steps.length > 0) {
                    runningOffset += node.steps.length * stepHeight + padding;
                }
            }
        });
    });

    // 4. Update the expanded state set
    if (hasExpanded) {
        state.v2.expandedNodes.clear();
    } else {
        activeNodes.forEach(n => {
            if (n.steps?.length > 0) state.v2.expandedNodes.add(n.id);
        });
    }

    // 5. Align, Persist and Paint
    renderVisualizerV2(isVault);

    // 3. Then we wait 50ms for the DOM to calculate the new heights, then tidy
    setTimeout(() => {
        OL.autoAlignNodes();
        OL.persist(); // Save positions once they are correct
    }, 50);

    setTimeout(() => OL.drawV2Connections(), 150);
};

OL.toggleWorkbenchTray = function() {
    state.ui.sidebarOpen = !state.ui.sidebarOpen;
    localStorage.setItem('ol_tray_open', state.ui.sidebarOpen);

    // 🚀 THE FIX: Ensure the filter variable is initialized in state
    if (!state.v2.trayTypeFilter) state.v2.trayTypeFilter = 'All';

    const isVault = window.location.hash.includes('vault');
    window.renderGlobalVisualizer(isVault);
};

OL.toggleTrayNodeExpand = function(e, resId, isVault) {
    e.stopPropagation(); // Prevents starting a drag by accident
    
    if (state.v2.trayExpandedNodes.has(resId)) {
        state.v2.trayExpandedNodes.delete(resId);
    } else {
        state.v2.trayExpandedNodes.add(resId);
    }
    
    // Refresh the tray only
    const searchVal = document.getElementById('tray-search-input')?.value || "";
    const typeFilter = state.v2.trayTypeFilter || "All";
    const list = document.getElementById('pane-drawer');
    if (list) {
        list.innerHTML = window.renderTrayContent(isVault, searchVal, typeFilter);
    }
};

OL.ejectStep = async function(resourceId, stepIdx) {
    const isVault = window.location.hash.includes('vault');
    const source = isVault ? state.master.resources : getActiveClient().projectData.localResources;
    const parentNode = source.find(n => n.id === resourceId);
    
    if (!parentNode || !parentNode.steps[stepIdx]) return;

    const stepData = parentNode.steps[stepIdx];

    await OL.updateAndSync(() => {
        // 1. Find existing data
        const linkedRes = OL.getResourceById(stepData.resourceLinkId);
        
        // 🚀 THE FIX: Never let the name be "Step" or "Untitled"
        const stableName = linkedRes?.name || stepData.text || stepData.name || "New SOP";
        const stableType = linkedRes?.type || "Action";

        const newNode = {
            id: stepData.resourceLinkId || ('sop-' + Date.now()), 
            name: stableName,
            type: stableType,
            parentId: resourceId, 
            coords: {
                x: (parentNode.coords?.x || 0), // Spawn clear of the parent
                y: (parentNode.coords?.y || 0) + (stepIdx * 60)
            },
            steps: linkedRes?.steps || []
        };

        // 2. Prevent duplication
        const exists = source.find(r => r.id === newNode.id);
        if (!exists) {
            source.push(newNode);
        } else {
            exists.parentId = resourceId;
            exists.coords = newNode.coords;
            exists.name = stableName;
            exists.type = stableType;
        }

        // 3. Remove from parent
        parentNode.steps.splice(stepIdx, 1);
    });

    renderVisualizerV2(isVault);
};

OL.handleNodeClick = async function(nodeId) {
    // If we aren't in connection mode, just load the inspector as normal
    if (!state.v2.connectionMode.active) {
        OL.loadInspector(nodeId);
        return;
    }

    // PHASE 1: Selecting the Source
    if (!state.v2.connectionMode.sourceId) {
        state.v2.connectionMode.sourceId = nodeId;
        document.getElementById(`v2-node-${nodeId}`).style.borderColor = "#fbbf24";
        console.log("📍 Source selected:", nodeId);
        return;
    }

    // PHASE 2: Selecting the Target (and preventing self-linking)
    if (state.v2.connectionMode.sourceId === nodeId) return;

    const sourceId = state.v2.connectionMode.sourceId;
    const targetId = nodeId;

    console.log(`🔗 Linking ${sourceId} to ${targetId}`);

    await OL.updateAndSync(() => {
        const isVault = window.location.hash.includes('vault');
        const client = getActiveClient();
        const source = isVault ? state.master.resources : client.projectData.localResources;
        
        const sourceNode = source.find(n => n.id === sourceId);
        if (sourceNode) {
            if (!sourceNode.outcomes) sourceNode.outcomes = [];
            // Create a new outcome link
            sourceNode.outcomes.push({
                id: 'link_' + Date.now(),
                action: `jump_res_${targetId}`,
                label: "Connected Path",
                condition: ""
            });
        }
    });

    // Reset Tool
    OL.toggleConnectTool();
    OL.drawV2Connections(); // Redraw lines immediately
};

OL.resetWiringState = function() {
    document.querySelectorAll('.source-selected').forEach(el => el.classList.remove('source-selected'));
    state.v2.connectionMode.sourceId = null;
};

OL.removeConnection = async function(sourceId, index) {
    console.log(`🗑️ Attempting to remove outcome at index ${index} for node ${sourceId}`);

    await OL.updateAndSync(() => {
        const isVault = window.location.hash.includes('vault');
        const client = getActiveClient();
        const source = isVault ? state.master.resources : client.projectData.localResources;
        
        // 1. Find the specific node
        const node = source.find(n => n.id === sourceId);
        
        if (node && node.outcomes) {
            // 2. Remove the link from the data array
            node.outcomes.splice(index, 1);
            console.log("✅ Data removed from local state.");
        } else {
            console.error("❌ Could not find node or outcomes array.");
        }
    });

    // 3. FORCE RE-RENDER
    // We refresh the inspector (in case it was open) and the lines
    if (state.activeInspectorResId === sourceId) {
        OL.loadInspector(sourceId);
    }
    OL.drawV2Connections();
};

OL.shiftOutcome = async function(nodeId, index, direction) {
    const isVault = window.location.hash.includes('vault');
    const client = getActiveClient();
    const source = isVault ? state.master.resources : client.projectData.localResources;
    const node = source.find(n => n.id === nodeId);

    if (node && node.outcomes) {
        const newIndex = index + direction;
        if (newIndex >= 0 && newIndex < node.outcomes.length) {
            const [movedItem] = node.outcomes.splice(index, 1);
            node.outcomes.splice(newIndex, 0, movedItem);
            
            await OL.persist();
            OL.loadInspector(nodeId); // Refresh sidebar
            OL.drawV2Connections();   // Refresh canvas
        }
    }
};

OL.autoAlignNodes = async function() {
    const isVault = window.location.hash.includes('vault');
    const source = isVault ? state.master.resources : getActiveClient().projectData.localResources;
    
    const cardEls = Array.from(document.querySelectorAll('.v2-node-layer .v2-node-card'));
    if (cardEls.length === 0) return;

    const columnWidth = 300; 
    const cardWidth = 200;   
    const centeringOffset = (columnWidth - cardWidth) / 2 - 110; 
    const verticalMargin = 40; // ↕️ The fixed space BETWEEN cards
    const startY = 100;      

    await OL.updateAndSync(() => {
        // 1. Group cards by their lanes
        const lanes = {};

        cardEls.forEach(el => {
            const id = el.id.replace('v2-node-', '');
            const nodeData = source.find(n => n.id === id);
            if (nodeData && nodeData.coords) {
                const laneIndex = Math.round(nodeData.coords.x / columnWidth);
                if (!lanes[laneIndex]) lanes[laneIndex] = [];
                lanes[laneIndex].push({ el, data: nodeData });
            }
        });

        // 2. Distribute vertically based on ACTUAL element height
        Object.keys(lanes).forEach(laneIdx => {
            const currentLane = lanes[laneIdx];
            
            // Sort by current Y to preserve user order
            currentLane.sort((a, b) => a.data.coords.y - b.data.coords.y);

            // 🚀 THE FIX: Track a running Y position for this specific lane
            let nextAvailableY = startY;

            currentLane.forEach((item) => {
                const targetX = (laneIdx * columnWidth) + centeringOffset;
                const targetY = nextAvailableY;

                // Update Database
                item.data.coords.x = targetX;
                item.data.coords.y = targetY;

                // Update UI
                item.el.style.transition = "all 0.5s cubic-bezier(0.2, 1, 0.3, 1)";
                item.el.style.setProperty('left', `${targetX}px`, 'important');
                item.el.style.setProperty('top', `${targetY}px`, 'important');

                // 📏 CALCULATE OFFSET FOR NEXT CARD
                // We take the current card's height and add our margin
                const currentCardHeight = item.el.offsetHeight;
                nextAvailableY += currentCardHeight + verticalMargin;
            });
        });
    });

    // 🔄 Redraw connections with the heartbeat loop
    let frames = 0;
    const heartbeat = () => {
        OL.drawV2Connections();
        frames++;
        if (frames < 30) requestAnimationFrame(heartbeat);
    };
    requestAnimationFrame(heartbeat);

    setTimeout(() => {
        OL.drawV2Connections();
        cardEls.forEach(el => el.style.transition = "");
    }, 600);
};

// ===========================GLOBAL WORKFLOW VISUALIZER===========================

window.renderGlobalCanvas = function(isVaultMode) {
    const client = getActiveClient();
    const sourceData = isVaultMode ? state.master : (client?.projectData || {});
    const stages = (sourceData.stages || []).sort((a, b) => (a.order || 0) - (b.order || 0));
    const allResources = isVaultMode ? (state.master.resources || []) : (client?.projectData?.localResources || []);

    if (stages.length === 0) {
        return `
            <div class="global-macro-map empty-state" style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:80vh; gap:20px;">
                <div class="text-center">
                    <h2 class="muted" style="margin-bottom:10px;">Canvas is Empty</h2>
                    <p class="tiny muted uppercase bold" style="margin-bottom:20px;">Choose a starting point</p>
                    <div style="display:flex; gap:15px; justify-content:center;">
                        <button class="btn primary" onclick="OL.addLifecycleStageAt(0, ${isVaultMode})">+ Manual Stage</button>
                        <button class="btn accent" onclick="OL.applyStandardLifecycleTemplate(${isVaultMode})">⚡ Apply 5-Stage Template</button>
                    </div>
                </div>
            </div>`;
    }

    return `
        <div class="global-macro-map" onclick="OL.handleCanvasBackgroundClick(event)" 
             style="display: flex; padding: 60px; align-items: flex-start; min-height: 100vh;">
            
            ${stages.map((stage, sIdx) => {
                const isInspectingStage = String(state.activeInspectorResId) === String(stage.id);
                const workflowsInStage = allResources.filter(r => 
                    r.type === 'Workflow' && String(r.stageId) === String(stage.id)
                ).sort((a, b) => (a.mapOrder || 0) - (b.mapOrder || 0));
                
                return `
                <div class="macro-stage-col" 
                     draggable="true" 
                     ondragstart="OL.handleDragStart(event, '${stage.id}', 'stage', ${sIdx})"
                     style="display: flex; align-items: flex-start; position: relative;">
                    
                    <div style="min-width: 300px;">
                        <div class="stage-header ${isInspectingStage ? 'is-inspecting' : ''}" 
                             style="border-bottom: 3px solid var(--accent); margin-bottom: 20px; padding-bottom: 8px; display:flex; justify-content:space-between; align-items:center; cursor: pointer;"
                             onclick="OL.loadInspector('${stage.id}')">
                            <div>
                                <span class="tiny accent bold">STAGE 0${sIdx + 1}</span>
                                <h3 style="margin: 0; font-size: 16px; color: #fff; text-transform: uppercase;">${esc(stage.name)}</h3>
                            </div>
                            <button class="card-delete-btn" onclick="event.stopPropagation(); OL.handleStageDelete('${stage.id}', ${isVaultMode})">×</button>
                        </div>
                        
                        <div class="workflow-stack stage-workflow-stream" 
                            data-stage-id="${stage.id}"
                            ondragover="OL.handleUniversalDragOver(event)" 
                            ondragleave="OL.handleUniversalDragLeave(event)"
                            ondrop="OL.handleUniversalDrop(event, '${stage.id}')"
                            style="min-height: 100px; display: flex; flex-direction: column; gap: 20px; min-height: 150px; width: 100%;">
                            
                            ${workflowsInStage.map((wf, wIdx) => {
                                const isInspectingWorkflow = String(state.activeInspectorResId) === String(wf.id);
                                return `
                                <div class="wf-node-container ${isInspectingWorkflow ? 'is-inspecting' : ''}" 
                                     draggable="true"
                                     ondragstart="event.stopPropagation(); OL.handleDragStart(event, '${wf.id}', 'workflow', ${wIdx})"
                                     style="margin-bottom:25px; border-radius: 10px; position: relative; cursor: grab;">
                                    
                                    ${renderGlobalWorkflowNode(wf, allResources, isVaultMode)}
                                    
                                    <div class="insert-divider vertical" 
                                         onclick="event.stopPropagation(); OL.focusToolbox()">
                                        <span>+</span>
                                    </div>
                                </div>`;
                            }).join('')}

                            ${workflowsInStage.length === 0 ? `
                                <div class="insert-divider initial" style="position: relative; opacity: 1;" 
                                     onclick="event.stopPropagation(); OL.focusToolbox('${stage.id}')">
                                    <span>+ Add Workflow</span>
                                </div>` : ''}
                        </div>
                    </div>

                    <div class="insert-divider horizontal" 
                         onclick="OL.addLifecycleStageAt(${sIdx + 1}, ${isVaultMode})">
                        <span>+</span>
                    </div>
                </div>`;
            }).join('')}
        </div>`;
};

OL.applyStandardLifecycleTemplate = async function(isVaultMode) {
    const confirmMsg = "This will add 5 standard stages: Cold Lead, Warm Lead, Onboarding, New Client, Ongoing Client. Proceed?";
    if (!confirm(confirmMsg)) return;

    const stages = [
        { name: "Cold Lead", order: 0 },
        { name: "Warm Lead", order: 1 },
        { name: "Onboarding", order: 2 },
        { name: "New Client", order: 3 },
        { name: "Ongoing Client", order: 4 }
    ];

    await OL.updateAndSync(() => {
        const sourceData = isVaultMode ? state.master : getActiveClient().projectData;
        if (!sourceData.stages) sourceData.stages = [];

        stages.forEach(s => {
            sourceData.stages.push({
                id: "stage-" + Math.random().toString(36).substr(2, 9),
                name: s.name,
                order: s.order
            });
        });
    });

    // Refresh the view
    window.renderGlobalVisualizer(isVaultMode);
};

OL.handleCanvasBackgroundClick = function(event) {
    // 🛑 STOP if we clicked a card, button, or input inside the canvas
    if (event.target.closest('.wf-global-node') || 
        event.target.closest('.asset-mini-card') || 
        event.target.closest('.atomic-step-row') ||
        event.target.closest('.btn') ||
        event.target.closest('.insert-divider')) {
        return; 
    }

    // ✅ If we clicked the grid background, clear the UI
    if (event.target.classList.contains('global-macro-map') || 
        event.target.id === 'fs-canvas' || 
        event.target.classList.contains('global-scroll-canvas')) {
        
        console.log("🧼 Canvas background clicked: Cleaning UI state");

        // 1. Reset specific UI flags
        state.ui.sidebarOpen = false; // 🚀 THE FIX: Allows sidebar to hide again
        state.ui.zenMode = true;      // Returns to wide-view default
        
        // 2. Clear data focus
        OL.clearInspector();
        state.activeInspectorResId = null;
        state.activeInspectorParentId = null;
        
        // 3. Sync DOM classes
        const layout = document.querySelector('.three-pane-layout');
        if (layout) {
            layout.classList.add('zen-mode-active');
            layout.classList.remove('toolbox-focused');
        }
        
        // 4. Repaint
        OL.refreshMap(); 
    }
};

OL.focusToolbox = function(targetStageId = null) {
    console.log("🚀 Universal Sidebar Focus Triggered");

    const canvas = document.querySelector('.global-scroll-canvas');
    if (canvas) {
        // 💾 SAVE THE "HOME" POSITION before we move anything
        state.ui.lastScrollPos = { x: canvas.scrollLeft, y: canvas.scrollTop };
    }
    let scrollX = canvas ? canvas.scrollLeft : 0;
    let scrollY = canvas ? canvas.scrollTop : 0;

    // 🎯 1. CALCULATE CENTERING (If a stage was clicked)
    if (targetStageId && canvas) {
        const stageEl = document.querySelector(`[data-stage-id="${targetStageId}"]`);
        if (stageEl) {
            // Calculate the middle of the canvas and the middle of the stage
            const stageRect = stageEl.getBoundingClientRect();
            const canvasRect = canvas.getBoundingClientRect();
            
            // New X = Current Scroll + (Stage Left relative to Canvas) - (Half Canvas Width) + (Half Stage Width)
            scrollX = canvas.scrollLeft + (stageRect.left - canvasRect.left) - (canvasRect.width / 2) + (stageRect.width / 2);
        }
    }

    // 2. State & Mode Logic
    const mode = state.focusedWorkflowId ? 'resource' : 'workflow';
    state.ui.zenMode = false;
    state.ui.sidebarOpen = true; 
    OL.clearInspector();

    // 3. Force Repaint
    const isVault = window.location.hash.includes('vault');
    window.renderGlobalVisualizer(isVault);

    // ⚓ 4. RESTORE OR CENTER SCROLL
    if (canvas) {
        requestAnimationFrame(() => {
            const reFoundCanvas = document.querySelector('.global-scroll-canvas');
            if (reFoundCanvas) {
                reFoundCanvas.scrollTo({
                    left: scrollX,
                    top: scrollY,
                    behavior: targetStageId ? 'smooth' : 'auto' // Smooth if centering, instant if just anchoring
                });
            }
        });
    }

    // 5. UI Layout Classes
    const layout = document.querySelector('.three-pane-layout');
    if (layout) {
        layout.classList.remove('zen-mode-active', 'no-sidebar');
        layout.classList.add('toolbox-focused');
    }

    // 6. Focus Search
    setTimeout(() => {
        const id = mode === 'workflow' ? 'workflow-toolbox-search' : 'resource-toolbox-search';
        const el = document.getElementById(id);
        if (el) el.focus();
    }, 100);
};

// 🗑️ Handle Stage Deletion & Unmapping
OL.handleStageDelete = async function(stageId, isVault) {
    const resCount = (isVault ? state.master.resources : getActiveClient().projectData.localResources)
        .filter(r => String(r.stageId) === String(stageId)).length;

    if (resCount > 0) {
        if (!confirm(`Confirm: This will delete the stage and unmap ${resCount} workflows. They will return to your sidebar library.`)) return;
    }

    await OL.updateAndSync(() => {
        const source = isVault ? state.master : getActiveClient().projectData;
        source.stages = source.stages.filter(s => s.id !== stageId);
        // Unmap workflows
        const resources = isVault ? state.master.resources : getActiveClient().projectData.localResources;
        resources.forEach(r => { if(String(r.stageId) === String(stageId)) { r.stageId = null; r.mapOrder = null; } });
    });
    renderGlobalVisualizer(isVault);
};

// ➕ Insert Stage at specific index
OL.addLifecycleStageAt = function(index, isVault) {
    const client = getActiveClient();
    const source = isVault ? state.master : (client?.projectData || {});
    
    // 🚀 THE FIX: Ensure stages exists before doing ANYTHING else
    if (!source.stages) source.stages = [];

    // 1. Shift existing orders to make room (Safe now because we initialized above)
    source.stages.forEach(s => { 
        if (s.order >= index) s.order++; 
    });

    // 2. Create the new stage
    const newStage = { 
        id: "stage-" + Date.now(), 
        name: "New Phase", 
        order: index 
    };
    
    source.stages.push(newStage);
    
    // 3. Save and Refresh
    OL.persist();
    
    // Ensure the visualizer re-renders
    if (typeof window.renderGlobalVisualizer === 'function') {
        window.renderGlobalVisualizer(isVault);
    } else {
        OL.refreshActiveView();
    }
};

function renderGlobalWorkflowNode(wf, allResources, isVaultMode) {
    const isInspectingWorkflow = String(state.activeInspectorResId) === String(wf.id);
    
    const sortedWfSteps = (wf.steps || []).sort((a, b) => (a.mapOrder || 0) - (b.mapOrder || 0));

    let flattenedSequence = [];
    // 🛡️ Track IDs to prevent double-rendering for the SAME asset
    const seenAssetIds = new Set();

    sortedWfSteps.forEach((wfStep, wfIdx) => {
        // 1. Check if this is a "Loose Step" (No Resource Link)
        if (!wfStep.resourceLinkId) {
            flattenedSequence.push({ 
                ...wfStep, 
                isLoose: true, 
                asset: null, // Explicitly null
                originalWfIndex: wfIdx 
            });
        } else {
            // 2. It's a Linked Resource
            const asset = allResources.find(r => String(r.id) === String(wfStep.resourceLinkId));
            
            // 🛑 DEDUPLICATION GUARD: If we've already rendered this asset in this workflow, skip it.
            if (asset && !seenAssetIds.has(asset.id)) {
                seenAssetIds.add(asset.id);
                const internalSteps = (asset.steps || []);
                
                if (internalSteps.length === 0) {
                    // Add Placeholder
                    flattenedSequence.push({ 
                        id: `empty-${asset.id}`, 
                        name: "No internal steps defined", 
                        isPlaceholder: true, 
                        asset: asset, 
                        isLoose: false, 
                        originalWfIndex: wfIdx 
                    });
                } else {
                    // Add real internal steps and FORCE the asset link
                    internalSteps.forEach(internalStep => {
                        flattenedSequence.push({ 
                          