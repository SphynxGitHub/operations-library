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
        if (!doc.exists || state.isSaving || (window.lastLocalRender && (now - window.lastLocalRender < 2000))) {
            return; 
        }

        const cloudData = doc.data();

        // 2. 🧠 SMART EQUALITY CHECK
        // If state.master is undefined/null, this is our FIRST load. We MUST proceed.
        const isFirstLoad = !state.master || Object.keys(state.master).length === 0;
        const hasFocusChanged = cloudData.focusedResourceId !== state.focusedResourceId;
        const hasDataChanged = JSON.stringify(cloudData.master) !== JSON.stringify(state.master);
        const hasClientsChanged = JSON.stringify(cloudData.clients) !== JSON.stringify(state.clients);

        if (!isFirstLoad && !hasFocusChanged && !hasDataChanged && !hasClientsChanged) return; 

        console.log("🔄 Valid Cloud Change Detected. Updating State...");

        // 3. Update State
        state.master = cloudData.master || {};
        state.clients = cloudData.clients || {};
        state.focusedResourceId = cloudData.focusedResourceId;
        state.viewMode = cloudData.viewMode || 'global';

        // 4. 🚀 THE NUDGE (Move this UP)
        // If the screen is empty or loading, trigger the router immediately
        const main = document.getElementById('mainContent');
        if (main && (main.innerHTML.includes('spinner') || main.innerHTML.trim() === "")) {
            console.log("📡 Data arrived. Nudging router to draw the current page...");
            window.handleRoute();
            return; // Exit early because handleRoute will trigger the necessary render
        }

        // 5. 🎨 DEBOUNCED VISUALIZER REFRESH
        // Only do this if we are actually ON a visualizer page
        if (window.location.hash.includes('visualizer')) {
            clearTimeout(window.syncDebounce);
            window.syncDebounce = setTimeout(() => {
                window.renderGlobalVisualizer(window.location.hash.includes('vault'));
            }, 300); 
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

  if (!client && !isMaster && !isPublic) {
        // Only render the Dashboard link if no client context exists
        root.innerHTML = `<aside class="sidebar"><nav class="menu"><a href="#/" class="active"><i>🏠</i> <span>Dashboard</span></a></nav></aside><main id="mainContent"></main>`;
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

    // 1. Prepare the Sidebar HTML content
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

  // 2. 🚀 THE LOGIC: Check if we just need to update or build from scratch
  const existingSidebar = root.querySelector('.sidebar');
  const existingMain = document.getElementById('mainContent');

  if (existingSidebar && existingMain) {
      // 🛡️ ONLY update the sidebar content. Leave mainContent (and your Flow Map) alone!
      existingSidebar.innerHTML = sidebarContent;
  } else {
      // 🏗️ First-time build (Initial page load)
      root.innerHTML = `
          <aside class="sidebar">${sidebarContent}</aside>
          <main id="mainContent"></main>
      `;
  }
};

window.handleRoute = function () {
    const originalHandleRoute = window.handleRoute;
        window.handleRoute = function() {
        console.group("🚦 ROUTE DEBUG");
        console.log("Current Hash:", window.location.hash);
        console.log("Focus Before Route:", state.focusedResourceId);
        
        // Run the original logic
        originalHandleRoute.apply(this, arguments);
        
        console.log("Focus After Route:", state.focusedResourceId);
        console.groupEnd();
    };

    const hash = window.location.hash || "#/";
    
    // 1. Force the Skeleton 🏗️
    window.buildLayout(); 

    const main = document.getElementById("mainContent");
    if (!main) return; 

    // 2. Identify Context 🔍
    const client = getActiveClient();

    if (client) {
        console.log("✅ Verified Client Access:", client.meta.name);
        // Render your modules here
    } else {
        console.warn("❌ Access Token invalid or Data not loaded yet.");
    }

    const isVault = hash.includes('vault');

    // 3. The "Loading" Safety Net 🛡️
    // If we aren't in the Vault and don't have a client yet, show loading
    if (!isVault && hash !== "#/" && !client) {
        main.innerHTML = `
            <div style="padding:100px; text-align:center; opacity:0.5;">
                <div class="spinner">⏳</div>
                <h3>Synchronizing Project Data...</h3>
                <p class="tiny">If this persists, please return to the Dashboard.</p>
            </div>`;
        return; 
    }

    // 3. 🎯 THE ROUTER
    if (hash.includes('visualizer')) {
        // 🚀 RECOVERY: Ensure state is synced with sessionStorage BEFORE rendering
        if (!state.focusedResourceId) {
            state.focusedResourceId = sessionStorage.getItem('active_resource_id');
        }
        if (!state.focusedWorkflowId) {
            state.focusedWorkflowId = sessionStorage.getItem('active_workflow_id');
        }

        console.log("🕸️ Visualizer Context:", { 
            L3: state.focusedResourceId, 
            L2: state.focusedWorkflowId 
        });

        document.body.classList.add('is-visualizer', 'fs-mode-active');
        
        const isVault = hash.includes('vault');
        window.renderGlobalVisualizer(isVault);
        return; 
    }

   // 4. Standard Routes
   document.body.classList.remove('is-visualizer', 'fs-mode-active');

    // 5. DATA RENDERING
    if (isVault) {
        // Vault logic is fine...
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
        
        // Use simplified includes that match your clientTabs hrefs
        if (hash.includes("client-tasks")) renderChecklistModule();
        else if (hash.includes("resources")) renderResourceManager();
        else if (hash.includes("applications")) renderAppsGrid();
        else if (hash.includes("functions")) renderFunctionsGrid();
        else if (hash.includes("scoping-sheet")) renderScopingSheet();
        else if (hash.includes("analyze")) renderAnalysisModule();
        else if (hash.includes("team")) renderTeamManager();
        else if (hash.includes("how-to")) renderHowToLibrary();
        else {
            console.warn("❓ Unknown client hash, defaulting to Tasks");
            renderChecklistModule();
        }
    } else {
        console.error("🔴 No client found for hash:", hash);
        renderClientDashboard(); // Fallback if lost
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
                        style="background: var(--accent); color: #000; font-weight: bold; border:none;">
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
                    style="background: var(--accent); color: #000; font-weight: bold; margin-right:10px;">
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

    let html = "";

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

OL.executeAssignment = async function(resId, stepId, isTrigger, memberId, memberName, type) {
    const client = getActiveClient();
    if (!client) return;

    // 1. Determine exactly which library we are in
    const isVault = window.location.hash.includes('vault');
    const targetLibrary = isVault ? state.master.resources : state.clients[state.activeClientId].projectData.localResources;

    await OL.updateAndSync(() => {
        let found = false;

        for (let r of targetLibrary) {
            // Case A: The target is the Resource itself
            if (String(r.id) === String(stepId)) {
                r.assigneeId = memberId;
                r.assigneeName = memberName;
                r.assigneeType = type;
                found = true;
                break;
            }

            // Case B: The target is a Step inside this resource
            if (r.steps) {
                const stepIdx = r.steps.findIndex(s => String(s.id) === String(stepId));
                if (stepIdx > -1) {
                    r.steps[stepIdx].assigneeId = memberId;
                    r.steps[stepIdx].assigneeName = memberName;
                    r.steps[stepIdx].assigneeType = type;
                    found = true;
                    break;
                }
            }
        }

        if (!found) throw new Error("Target ID not found in live state tree.");
        console.log("🎯 Property injected into Live State index.");
    });

    // 2. UI REFRESH
    OL.loadInspector(stepId, resId !== stepId ? resId : null);
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

OL.updateAtomicStep = function(resId, stepId, field, value) {
    const activeResId = resId || state.activeInspectorParentId;
    const res = OL.getResourceById(activeResId);
    if (!res) return;

    const step = res.steps?.find(s => String(s.id) === String(stepId));
    if (step) {
        step[field] = value;
        OL.persist();
    }

    // 1. Refresh Canvas
    const canvas = document.getElementById('l3-canvas-wrapper');
    if (canvas) canvas.parentElement.innerHTML = renderLevel3Canvas(activeResId);

    // 2. 🚀 LOCK THE VIEW: Pass BOTH IDs to keep Scenario A active
    OL.loadInspector(stepId, activeResId);
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
                            <th style="text-align: left;">Features</th>
                            <th style="text-align: center; width: 80px;">Weight</th>

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
                                                    <div class="tier-entry" style="position:relative; padding: 6px; border-radius: 4px;">
                                                        <button class="card-delete-btn" onclick="OL.removeAppTier('${analysisId}', '${appObj.appId}', ${idx})" 
                                                                style="position:absolute; top:-2px; right:-10px; background:none; border:none; color:var(--danger); cursor:pointer; font-size:14px; padding:0;">×</button>
                                                        
                                                        <div style="display:flex; justify-content: space-between; gap:4px;">
                                                            <input type="text" class="price-input-tiny" style="width:100%; color: #ccc; background:transparent;  border: 1px solid var(--panel-border);" 
                                                                placeholder="Tier Name (e.g. Pro)" value="${esc(t.name)}" 
                                                                onblur="OL.updateAppTier('${analysisId}', '${appObj.appId}', ${idx}, 'name', this.value)">
                                                            
                                                            <div style="display:flex; align-items:center; gap:4px;">
                                                                <span class="tiny muted">$</span>
                                                                <input type="number" class="price-input-tiny" style="width:100%; color: #ccc; background:transparent;  border: 1px solid var(--panel-border);" 
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
                const costType = pricing.type || 'included'; 
                const currentTier = pricing.tierName || '';
                const currentAddonPrice = pricing.addonPrice || 0;
                const appTiers = appObj.pricingTiers || [];

                return `
                    <td style="padding: 6px; border: 1px solid var(--line); vertical-align: top; min-width: 140px; background: rgba(255,255,255,0.01);">
                        <div style="display: flex; flex-direction: column; gap: 4px;">
                            <div style="display: flex; justify-content: space-between">
                                <div style="display: flex; align-items: center; gap: 10px; background: rgba(0,0,0,0.2); border-radius: 4px; padding: 2px 5px;">
                                    <span style="color: var(--muted); font-weight: bold; width: 25px;">Score</span>
                                    <input type="number" 
                                        min="0"
                                        max="3"
                                        class="matrix-score-input" 
                                        style="width: 100%; background: transparent; border: none; color: var(--accent); font-weight: bold; text-align: right; font-size: 12px;"
                                        value="${currentScore}"
                                        onblur="OL.updateAnalysisScore('${analysisId}', '${appObj.appId}', '${feat.id}', this.value, ${isMaster})">
                                </div>

                                <select class="tiny-select" 
                                    onchange="OL.handleMatrixPricingChange('${analysisId}', '${appObj.appId}', '${feat.id}', this.value)">
                                    <option value="included" ${costType === 'not_included' ? 'selected' : ''}>Not Included</option>
                                    <optgroup label="Included In:">
                                        ${appTiers.map(t => `
                                            <option style="font-weight: bold;" value="tier|${esc(t.name)}" ${pricing.tierName === t.name ? 'selected' : ''}>
                                                Tier: ${esc(t.name)}
                                            </option>
                                        `).join('')}
                                    </optgroup>
                                    <option value="addon" ${costType === 'addon' ? 'selected' : ''}>Add-on</option>
                                </select>

                                <div id="addon-price-${appObj.appId}-${feat.id}" 
                                    style="display: ${costType === 'addon' ? 'flex' : 'none'}; align-items: center; gap: 4px; border-top: 1px solid rgba(255,255,255,0.1);">
                                    <span class="tiny muted">$</span>
                                    <input type="number" class="price-input-tiny" style="max-width:40px; color: #ccc; background:transparent; border: 1px solid var(--panel-border);"
                                        value="${currentAddonPrice}" 
                                        onblur="OL.updateAppFeatAddonPrice('${analysisId}', '${appObj.appId}', '${feat.id}', this.value)">
                                </div>
                            </div>
                            <textarea 
                            placeholder="Notes..." 
                            class="matrix-notes-auto"
                            style="width: 100%; min-height: 40px; height: auto; overflow: hidden; line-height: 1.1; background: transparent; border: 1px solid rgba(255,255,255,0.05); color: #ccc; resize: none; padding: 4px; border-radius: 4px; font-family: inherit;"
                            oninput="this.style.height = ''; this.style.height = this.scrollHeight + 'px'"
                            onblur="OL.updateAnalysisNote('${analysisId}', '${appObj.appId}', '${feat.id}', this.value, ${isMaster})"
                        >${esc(currentNote)}</textarea>
                    </div>
                </td>`;
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
        
        const [type, tierName] = value.split('|');
        
        // We preserve the addonPrice so it's not lost if they toggle back and forth
        const existingAddon = appObj.featPricing[featId]?.addonPrice || 0;
        
        appObj.featPricing[featId] = {
            type: type, // 'not_included', 'tier', or 'addon'
            tierName: tierName || null,
            addonPrice: existingAddon
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
    
    // 1. Safely get Local features
    const localFeats = client?.projectData?.localAnalyses
        ? client.projectData.localAnalyses.flatMap(a => a.features || [])
        : [];
        
    // 2. Get Master features
    const masterFeats = (state.master.analyses || []).flatMap(a => a.features || []);
    
    // Return unique feature names
    return [...new Set([...localFeats, ...masterFeats].map(f => f.name))].sort();
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

    // 1. Unified Data Pull
    const allFeatures = [
        ...(client?.projectData?.localAnalyses || []).flatMap(a => a.features || []),
        ...(state.master.analyses || []).flatMap(a => a.features || [])
    ];

    // 2. Filter & Deduplicate
    const uniqueMatches = Array.from(new Set(
        allFeatures
            .filter(f => {
                const nameLower = f.name.toLowerCase();
                const matchesQuery = nameLower.includes(q);
                const alreadyOnMatrix = excludeNames.includes(nameLower);
                return matchesQuery && !alreadyOnMatrix;
            })
            .map(f => f.name.toLowerCase().trim())
    )).map(name => allFeatures.find(f => f.name.toLowerCase().trim() === name));

    let html = "";

    // 3. Build HTML
    html += uniqueMatches.map(feat => `        
        <div class="search-result-item" onmousedown="
            const nameInput = document.getElementById('feat-name-input');
            const catInput = document.getElementById('feat-cat-input');
            if (nameInput) nameInput.value = '${esc(feat.name)}';
            if (catInput) catInput.value = '${esc(feat.category || "General")}';
            this.parentElement.style.display = 'none';
        ">
            ✨ ${esc(feat.name)} <span class="tiny muted">(${esc(feat.category || "General")})</span>
        </div>
    `).join('');

    // 4. "Create New" Logic (ID Fixed to feat-cat-input)
    if (q && !uniqueMatches.some(m => m.name.toLowerCase() === q)) {
        html += `
            <div class="search-result-item create-action" onmousedown="
                document.getElementById('${targetElementId}').style.display='none';
                const catInp = document.getElementById('feat-cat-input');
                if(catInp) catInp.focus();
            ">
                <span class="pill tiny accent">+ New</span> Create Feature "${esc(query)}"
            </div>`;
    }

    listEl.innerHTML = html || `<div class="search-result-item muted">No new features found.</div>`;
    
    // 🚀 THE REVEAL: Ensure the list is visible
    listEl.style.display = 'block';
};

OL.unifiedAddFlow = function(query, anlyId, isMaster, excludeNames=[]) {
    const q = query.trim();
    
    // 1. Run Feature Search
    OL.universalFeatureSearch(query, anlyId, isMaster, 'feat-search-results', excludeNames);

    // 2. Setup the Finalizer Button logic safely
    const finalizeBtn = document.getElementById('finalize-btn');
    
    // 🚀 THE FIX: Only attach if the button is found
    if (finalizeBtn) {
        finalizeBtn.onclick = () => {
            const featName = document.getElementById('feat-name-input')?.value.trim();
            const catName = document.getElementById('feat-cat-input')?.value.trim() || "General";
            
            if (!featName) return alert("Please enter a feature name.");
            OL.finalizeFeatureAddition(anlyId, featName, catName, isMaster);
        };
    }

    // ⌨️ Keyboard Shortcut for the category box
    const catInput = document.getElementById('feat-cat-input');
    if (catInput) {
        catInput.onkeydown = (e) => {
            if (e.key === 'Enter') {
                const featName = document.getElementById('feat-name-input')?.value.trim();
                if (featName) OL.finalizeFeatureAddition(anlyId, featName, catInput.value, isMaster);
            }
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
        const catInput = document.getElementById('feat-cat-input') || document.getElementById('new-feat-cat-input');
        if (catInput) catInput.value = catName;
        
        // Close whichever results div is open
        const res1 = document.getElementById('feat-cat-results');
        const res2 = document.getElementById('new-feat-cat-results');
        if (res1) res1.style.display = 'none';
        if (res2) res2.style.display = 'none';
    }

    else if (type === 'local-ui-only' || type === 'assign-to-feature') {
        // 🚀 Check for both potential ID names to be safe
        const catInput = document.getElementById('feat-cat-input') || document.getElementById('new-feat-cat-input');
        
        if (catInput) {
            catInput.value = catName;
        } else {
            console.warn("⚠️ Could not find category input field in DOM.");
        }
        
        // Hide any open results overlays
        const res = document.getElementById('feat-cat-results') || document.getElementById('new-feat-cat-results');
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
    });

        OL.persist();
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

    if (!anly) return console.error("Analysis not found");

    // 🛡️ DUPLICATE CHECK
    const isDuplicate = (anly.features || []).some(f => 
        f.name.toLowerCase() === featName.toLowerCase() && 
        (f.category || "General").toLowerCase() === category.toLowerCase()
    );

    if (isDuplicate) {
        alert(`🚫 "${featName}" is already in the "${category}" category.`);
        return;
    }

    await OL.updateAndSync(() => {
        if (!anly.features) anly.features = [];
        anly.features.push({
            id: "feat-" + Date.now() + Math.random().toString(36).substr(2, 5),
            name: featName.trim(),
            category: category.trim() || "General",
            weight: 10,
            description: "" 
        });
    });

    OL.closeModal();
    OL.openAnalysisMatrix(anlyId, isMaster);
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
                <div onmousedown="OL.handleCategorySelection('${esc(cat)}', '${type}', window._tmpSearchParams)" style="flex:1;">
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
    pan: { x: 0, y: 0 },
    looseNodes: [], // For the brain dump
    dragContext: null
};

window.renderVisualizerV2 = function(isVault) {
    const container = document.getElementById("mainContent");
    
    container.innerHTML = `
        <div class="v2-viewport" id="v2-viewport">
                <div class="v2-canvas" id="v2-canvas" 
                    style="transform: translate3d(${state.v2.pan.x}px, ${state.v2.pan.y}px, 0) scale(${state.v2.zoom});">
                
                <div class="v2-stage-layer">
                    ${renderV2Stages(isVault)}
                </div>

                <svg class="v2-svg-layer" id="v2-connections"></svg>

                <div class="v2-node-layer" id="v2-nodes">
                    ${renderV2Nodes(isVault)}
                </div>

            </div>

            <div class="v2-ui-overlay">
                <div class="v2-toolbar">
                    <button class="btn primary" onclick="OL.openBrainDump()">🧠 Brain Dump</button>
                    <button id="connect-tool-btn" class="btn soft" onclick="OL.toggleConnectTool()" title="Connect Nodes">🔌 Connect</button>
                    <div class="divider-v"></div>
                    <button class="btn soft" onclick="OL.zoom(0.1)">+</button>
                    <button class="btn soft" onclick="OL.zoom(-0.1)">-</button>
                </div>
            </div>
        </div>
    `;

    // At the bottom of renderVisualizerV2
    setTimeout(() => {
        OL.initV2Panning(); // Activates grid movement
        console.log("🎮 Graph Engine Initialized");
    }, 50);
};

OL.openBrainDump = function() {
    const html = `
        <div class="modal-head"><div class="modal-title-text">🧠 Brain Dump: New Step</div></div>
        <div class="modal-body">
            <div class="dump-flow">
                <label class="tiny-label">1. SELECT APP</label>
                <select id="dump-app" class="modal-input" onchange="OL.syncDumpOptions()">
                    <option value="Manual">Manual (No App)</option>
                    ${state.master.apps.map(a => `<option value="${a.id}">${a.name}</option>`).join('')}
                </select>

                <label class="tiny-label">2. SELECT OBJECT</label>
                <select id="dump-obj" class="modal-input" onchange="OL.syncDumpOptions()">
                    </select>

                <label class="tiny-label">3. SELECT VERB</label>
                <select id="dump-verb" class="modal-input">
                    </select>
            </div>
            <button class="btn primary full-width" onclick="OL.commitBrainDump()">Drop on Canvas</button>
        </div>
    `;
    openModal(html);
    OL.syncDumpOptions(); 
};

OL.initV2Panning = function() {
    const viewport = document.getElementById('v2-viewport');
    const canvas = document.getElementById('v2-canvas');
    if (!viewport || !canvas) return;

    let isPanning = false;
    let startX, startY;

    viewport.onmousedown = (e) => {
        // Only pan if clicking the background, not a card
        if (e.target !== viewport && e.target !== canvas) return;
        
        isPanning = true;
        startX = e.clientX - state.v2.pan.x;
        startY = e.clientY - state.v2.pan.y;
        viewport.style.cursor = 'grabbing';
    };

    window.onmousemove = (e) => {
        if (!isPanning) return;
        
        state.v2.pan.x = e.clientX - startX;
        state.v2.pan.y = e.clientY - startY;

        // 🚀 THE GPU FIX: Use translate3d to avoid layout thrashing
        canvas.style.transform = `translate3d(${state.v2.pan.x}px, ${state.v2.pan.y}px, 0) scale(${state.v2.zoom})`;
    };

    window.onmouseup = () => {
        isPanning = false;
        viewport.style.cursor = 'grab';
    };
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

OL.startNodeDrag = function(e, nodeId) {
    e.preventDefault();
    e.stopPropagation();

    const nodeEl = document.getElementById(`v2-node-${nodeId}`);
    const canvas = document.getElementById('v2-canvas');
    if (!nodeEl || !canvas) return;

    // 1. Calculate the offset between cursor and card corner
    // We adjust for zoom so dragging feels natural at any scale
    const zoom = state.v2.zoom || 1;
    let startX = e.clientX / zoom - nodeEl.offsetLeft;
    let startY = e.clientY / zoom - nodeEl.offsetTop;

    nodeEl.style.zIndex = "1000"; // Bring to front
    nodeEl.style.cursor = "grabbing";

    const onMouseMove = (moveEvent) => {
        // 2. Calculate new position
        const newX = moveEvent.clientX / zoom - startX;
        const newY = moveEvent.clientY / zoom - startY;

        // 3. SURGICAL UPDATE: Update DOM directly for 60fps performance
        nodeEl.style.left = `${newX}px`;
        nodeEl.style.top = `${newY}px`;
        OL.drawV2Connections();
    };

    const onMouseUp = async () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        
        nodeEl.style.zIndex = "10";
        nodeEl.style.cursor = "grab";

        // 4. PERSISTENCE: Save final coordinates to State & Firebase once
        const finalX = parseInt(nodeEl.style.left);
        const finalY = parseInt(nodeEl.style.top);

        await OL.updateAndSync(() => {
            const isVault = window.location.hash.includes('vault');
            const client = getActiveClient();
            const source = isVault ? state.master.resources : client.projectData.localResources;
            const nodeData = source.find(n => n.id === nodeId);
            
            if (nodeData) {
                nodeData.coords = { x: finalX, y: finalY };
            }
        });
        console.log(`📍 Node ${nodeId} parked at:`, finalX, finalY);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
};

OL.syncDumpOptions = function() {
    const appVal = document.getElementById('dump-app').value;
    const objEl = document.getElementById('dump-obj');
    const verbEl = document.getElementById('dump-verb');

    // Example logic: In a real app, this pulls from ATOMIC_STEP_LIB 
    // or the App's 'capabilities' array we built earlier.
    const availableObjects = ATOMIC_STEP_LIB.Objects; 
    objEl.innerHTML = availableObjects.map(o => `<option value="${o}">${o}</option>`).join('');

    const availableVerbs = appVal === 'Manual' ? ATOMIC_STEP_LIB.ActionVerbs : ATOMIC_STEP_LIB.TriggerVerbs;
    verbEl.innerHTML = availableVerbs.map(v => `<option value="${v}">${v}</option>`).join('');
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

function renderV2Nodes(isVault) {
    const client = getActiveClient();
    const allResources = isVault ? (state.master.resources || []) : (client?.projectData?.localResources || []);
    const nodes = allResources.filter(r => (r.type || "").toLowerCase() !== 'workflow');

    return nodes.map((node, idx) => {
        // 🚀 THE AUTO-SPREAD: If no coords, stagger them in a grid 
        // 4 nodes per row, 250px apart
        const defaultX = 100 + (idx % 4) * 250;
        const defaultY = 100 + Math.floor(idx / 4) * 150;

        const x = node.coords?.x || defaultX;
        const y = node.coords?.y || defaultY;
        const icon = OL.getRegistryIcon(node.type);

        return `
            <div class="v2-node-card" 
                id="v2-node-${node.id}"
                style="position: absolute; left: ${x}px; top: ${y}px;"
                onmousedown="OL.startNodeDrag(event, '${node.id}')"
                onclick="OL.handleNodeClick('${node.id}')">
                
                <div class="v2-port port-in"></div>
                <div class="v2-port port-out"></div>

                <div class="v2-node-header" style="pointer-events: none;">
                    <span>${icon}</span>
                    <span class="tiny muted uppercase bold" style="font-size: 8px;">${esc(node.type)}</span>
                </div>
                <div class="v2-node-body" style="pointer-events: none;">${esc(node.name)}</div>
            </div>
        `;
    }).join('');
}

OL.commitBrainDump = async function() {
    const appVal = document.getElementById('dump-app').value;
    const objVal = document.getElementById('dump-obj').value;
    const verbVal = document.getElementById('dump-verb').value;
    const isVault = window.location.hash.includes('vault');
    
    const name = `${verbVal} ${objVal}`;
    const timestamp = Date.now();
    const newId = isVault ? `res-vlt-${timestamp}` : `local-prj-${timestamp}`;

    const newNode = {
        id: newId,
        name: name,
        type: "SOP", // Default type for brain dump
        coords: { x: 100 + (Math.random() * 50), y: 100 + (Math.random() * 50) }, // Centered-ish drop
        data: { verb: verbVal, object: objVal, appId: appVal },
        createdDate: new Date().toISOString()
    };

    await OL.updateAndSync(() => {
        const targetList = isVault ? state.master.resources : getActiveClient().projectData.localResources;
        targetList.push(newNode);
    });

    OL.closeModal();
    window.renderGlobalVisualizer(isVault); // Refresh the graph
};

OL.drawV2Connections = function() {
    const svg = document.getElementById('v2-connections');
    if (!svg) return;

    const isVault = window.location.hash.includes('vault');
    const client = getActiveClient();
    const source = isVault ? state.master.resources : client.projectData.localResources;
    
    // Clear old lines
    svg.innerHTML = '';
    
    // Update SVG size to match the infinite canvas scroll
    const canvas = document.getElementById('v2-canvas');
    svg.setAttribute('width', canvas.scrollWidth);
    svg.setAttribute('height', canvas.scrollHeight);

    source.forEach(node => {
        if (!node.outcomes || node.outcomes.length === 0) return;

        node.outcomes.forEach(outcome => {
            // Find target ID (handling jump_step_ and jump_res_ prefixes)
            let tid = outcome.targetId || outcome.toId;
            if (!tid && outcome.action) {
                tid = outcome.action.replace('jump_step_', '').replace('jump_res_', '');
            }

            const fromEl = document.getElementById(`v2-node-${node.id}`);
            const toEl = document.getElementById(`v2-node-${tid}`);

            if (fromEl && toEl) {
                OL.drawPathBetweenElements(svg, fromEl, toEl, outcome.condition);
            }
        });
    });
};

OL.drawPathBetweenElements = function(svg, startEl, endEl, label) {
    const s = {
        x: startEl.offsetLeft + startEl.offsetWidth,
        y: startEl.offsetTop + (startEl.offsetHeight / 2)
    };
    const e = {
        x: endEl.offsetLeft,
        y: endEl.offsetTop + (endEl.offsetHeight / 2)
    };

    const cp1x = s.x + (e.x - s.x) / 2;
    const cp2x = s.x + (e.x - s.x) / 2;

    const pathData = `M ${s.x} ${s.y} C ${cp1x} ${s.y}, ${cp2x} ${e.y}, ${e.x} ${e.y}`;
    
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathData);
    path.setAttribute("stroke", label ? "#fbbf24" : "rgba(56, 189, 248, 0.4)");
    path.setAttribute("stroke-width", "2");
    path.setAttribute("fill", "none");
    path.style.transition = "all 0.3s ease";
    
    svg.appendChild(path);
};

state.v2.connectionMode = {
    active: false,
    sourceId: null
};

OL.toggleConnectTool = function() {
    state.v2.connectionMode.active = !state.v2.connectionMode.active;
    state.v2.connectionMode.sourceId = null;
    
    const btn = document.getElementById('connect-tool-btn');
    if (btn) btn.classList.toggle('accent', state.v2.connectionMode.active);
    
    const viewport = document.getElementById('v2-viewport');
    if (viewport) viewport.style.cursor = state.v2.connectionMode.active ? 'crosshair' : 'grab';
    
    console.log("🔌 Connect Tool:", state.v2.connectionMode.active ? "ON" : "OFF");
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
                            ...internalStep, 
                            asset: asset, 
                            isLoose: false, // 🚀 FORCE FALSE: This is NOT a loose step
                            originalWfIndex: wfIdx 
                        });
                    });
                }
            }
        }
    });

    // 2. GROUP: Group consecutive items that belong to the same technical asset
    const groupedItems = [];
    flattenedSequence.forEach((item) => {
        const lastGroup = groupedItems[groupedItems.length - 1];
        
        // 🚀 THE FIX: Use item.asset?.id for the grouping key
        const currentAssetId = item.isLoose ? null : item.asset?.id;

        if (lastGroup && !item.isLoose && !lastGroup.isLoose && lastGroup.resourceId === currentAssetId) {
            lastGroup.steps.push(item);
        } else {
            groupedItems.push({
                resourceId: currentAssetId,
                asset: item.asset,
                isLoose: item.isLoose,
                steps: [item],
                insertIndex: item.originalWfIndex + 1 
            });
        }
    });

    const hasIncoming = OL.checkIncomingLogic(wf.id);
    const hasOutgoing = (wf.outcomes && wf.outcomes.length > 0);

    let html = `
        <div class="wf-global-node ${isInspectingWorkflow ? 'is-inspecting' : ''}" 
             id="l2-node-${wf.id}"
             onclick="event.stopPropagation(); OL.loadInspector('${wf.id}')"
             style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.1); border-radius: 10px; padding: 12px; border-top: 2px solid var(--accent); cursor: pointer;">

             ${hasIncoming ? `<div class="logic-trace-trigger incoming" title="View Incoming Logic" onclick="event.stopPropagation(); OL.traceLogic('${wf.id}', 'incoming')">🔀</div>` : ''}
            
             <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                <div style="color: var(--accent); font-weight: 900; font-size: 12px; display: flex; align-items: center; gap: 8px;">
                    <span style="font-size: 14px;">🔄</span> ${esc(wf.name).toUpperCase()}
                </div>
                <button class="card-delete-btn" style="opacity:0; position:static;" 
                onclick="event.stopPropagation(); OL.handleWorkflowUnmap('${wf.id}', ${isVaultMode})">×</button>
            </div>

            <div class="tier-3-resource-stack" style="display: flex; flex-direction: column; gap: 10px;">`;

    // 🚀 INITIAL INSERT POINT
    html += renderInlineInsertUI(wf, 0, `${wf.id}:0`, isVaultMode);

    // 🚀 RENDER THE GROUPS
    html += groupedItems.map((group) => {
        if (group.isLoose) {
            const step = group.steps[0];
            
            // 🚀 Check for existence of logic
            const hasIn = OL.checkIncomingLogic(step.id);
            const hasOut = (step.outcomes && step.outcomes.length > 0);

            const isStepActive = String(state.activeInspectorResId) === String(step.id);

            return `
                <div class="wf-resource-wrapper loose-step-wrapper" id="step-row-${step.id}">
                    <div class="atomic-step-row loose-step-card" ${isStepActive ? 'step-active' : ''}
                        onclick="event.stopPropagation(); OL.loadInspector('${step.id}', '${wf.id}')"
                        style="background: rgba(56, 189, 248, 0.05); border: 1px dashed rgba(56, 189, 248, 0.3); border-radius: 6px; padding: 8px 12px; display: flex; align-items: center; gap: 10px; cursor: pointer;">
                        
                        ${hasIn ? `<span class="logic-trace-icon in" onclick="event.stopPropagation(); OL.traceLogic('${step.id}', 'incoming')">🔀</span>` : ''}
                        
                        <span style="font-size: 11px; color: #38bdf8; font-weight: bold; flex: 1;">📝 ${esc(step.name || "Draft Step")}</span>
                        
                        ${hasOut ? `<span class="logic-trace-icon out" onclick="event.stopPropagation(); OL.traceLogic('${step.id}', 'outgoing')">🔀</span>` : ''}
                    
                        <button class="card-delete-btn" 
                            style="position:static; opacity: 0.4; font-size: 14px;"
                            onmouseover="this.style.opacity='1'" 
                            onmouseout="this.style.opacity='0.4'"
                            onclick="event.stopPropagation(); OL.removeStepFromCanvas('${wf.id}', '${step.id}')">
                            ×
                        </button>
                    </div>
                </div>` + renderInlineInsertUI(wf, group.insertIndex, `${wf.id}-${group.insertIndex}`, isVaultMode);
        } else {
            const asset = group.asset;
            const isInspectingRes = String(state.activeInspectorResId) === String(asset.id);
            const isInScope = !!OL.isResourceInScope(asset.id);

            return `
                <div class="wf-resource-wrapper" id="l3-node-${asset.id}">
                    <div class="asset-mini-card is-navigable ${isInspectingRes ? 'is-inspecting' : ''} ${isInScope ? 'is-in-scope' : ''}" 
                        onclick="event.stopPropagation(); OL.loadInspector('${asset.id}', '${wf.id}')"
                        style="background: rgba(0,0,0,0.4); border-radius: 6px; padding: 10px; position:relative; cursor: pointer;
                                border-left: 3px solid ${isInScope ? '#10b981' : '#38bdf8'}; border: 1px solid rgba(255,255,255,0.05);">
                        
                        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; margin-bottom:8px;">
                            <div style="font-size: 11px; font-weight: bold; color: #eee; flex: 1;">
                                ${OL.getRegistryIcon(asset.type)} ${esc(asset.name)}
                            </div>
                            ${isInScope ? `<button 
                                onclick="event.stopPropagation(); OL.jumpToScopingItem('${asset.id}')" 
                                title="View in Scoping" 
                                style="padding: 2.25px 4px; font-size: 9px; background: #10b981; color: white; border: 1px solid white; border-radius: 180px;">
                            $</button>` : ''}
                            <button class="card-delete-btn" 
                                style="position:static; opacity: 0.4; font-size: 14px;"
                                onmouseover="this.style.opacity='1'" 
                                onmouseout="this.style.opacity='0.4'"
                                onclick="event.stopPropagation(); OL.handleResourceUnmap('${wf.id}', '${asset.id}', ${isVaultMode})">
                                ×
                            </button>
                        </div>

                        <div class="resource-description" style="font-size: 9px; color: #94a3b8; margin-bottom: 8px; line-height: 1.3;">
                            ${esc(asset.description || '')}
                        </div>

                        <div class="atomic-step-container">
                            ${group.steps.map(s => {
                                // 🚀 Logic detection for internal steps
                                const stepIn = OL.checkIncomingLogic(s.id);
                                const stepOut = (s.outcomes && s.outcomes.length > 0);
                                
                                // Check if the inspector is currently looking at this specific sub-step
                                const isStepActive = String(state.activeInspectorResId) === String(s.id);

                                return `
                                    <div class="tiny atomic-step-row ${s.isPlaceholder ? 'muted italic' : ''} ${isStepActive ? 'step-active' : ''}" 
                                        id="step-row-${s.id}" 
                                        style="display:flex; align-items:center; gap:5px; padding: 2px 4px; border:none !important; background:transparent !important;"
                                        onclick="event.stopPropagation(); OL.loadInspector('${s.id}', '${asset.id}')">
                                        
                                        <div style="width: 14px; display: flex; justify-content: center; flex-shrink: 0;">
                                            ${stepIn ? `<span class="logic-trace-icon in" onclick="event.stopPropagation(); OL.traceLogic('${s.id}', 'incoming')">🔀</span>` : ''}
                                        </div>
                                        
                                        <span style="color: ${s.type === 'Trigger' ? '#ffbf00' : '#38bdf8'}; font-size:10px; flex-shrink: 0;">
                                            ${s.type === 'Trigger' ? '⚡' : '•'}
                                        </span>
                                        
                                        <span style="flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #eee;">
                                            ${esc(s.name)}
                                        </span>
                                        
                                        <div style="width: 14px; display: flex; justify-content: center; flex-shrink: 0;">
                                            ${stepOut ? `<span class="logic-trace-icon out" onclick="event.stopPropagation(); OL.traceLogic('${s.id}', 'outgoing')">🔀</span>` : ''}
                                        </div>
                                    </div>`;
                            }).join('')}
                        </div>
                    </div>
                </div>` + renderInlineInsertUI(wf, group.insertIndex, `${wf.id}:${group.insertIndex}`, isVaultMode);
        }
    }).join('');

    html += `</div>
            ${hasOutgoing ? `<div class="logic-trace-trigger outgoing" title="View Outgoing Logic" onclick="event.stopPropagation(); OL.traceLogic('${wf.id}', 'outgoing')">🔀</div>` : ''}
        </div>`;
    
    return html;
}

function renderInlineInsertUI(wf, index, key, isVaultMode) {
    const isInsertingHere = (state.openInsertIndex === key);

    if (isInsertingHere) {
        // 🚀 THE CHOICE MENU (Restored)
        if (!state.tempInsertMode) {
            return `
            <div class="inline-insert-card fade-in" onclick="event.stopPropagation()" 
                 style="background: #0f172a; border: 1px solid var(--accent); border-radius: 8px; padding: 12px; margin: 4px 0; position: relative; z-index: 100;">
                <div style="display:flex; justify-content:space-between; margin-bottom:10px;">
                    <span class="tiny accent bold">INSERT LOGIC</span>
                    <button onclick="state.openInsertIndex = null; OL.refreshMap();" style="background:none; border:none; color:#64748b; cursor:pointer;">×</button>
                </div>
                <div style="display:flex; gap:8px;">
                    <div onclick="OL.setInsertMode('loose')" style="flex:1; background:rgba(255,255,255,0.03); padding:10px; border-radius:6px; cursor:pointer; text-align:center; border:1px solid rgba(255,255,255,0.1);">
                        <span style="display:block; font-size:16px;">📝</span><b style="font-size:10px;">Loose Step</b>
                    </div>
                    <div onclick="OL.setInsertMode('resource')" style="flex:1; background:rgba(255,255,255,0.03); padding:10px; border-radius:6px; cursor:pointer; text-align:center; border:1px solid rgba(255,255,255,0.1);">
                        <span style="display:block; font-size:16px;">🔗</span><b style="font-size:10px;">Resource</b>
                    </div>
                </div>
            </div>`;
        }

        // 📝 LOOSE STEP FORM
        if (state.tempInsertMode === 'loose') {
            return `
            <div class="inline-insert-card fade-in" onclick="event.stopPropagation()" style="background: #0f172a; border: 1px solid var(--accent); border-radius: 8px; padding: 12px; margin: 4px 0;">
                <div style="display:flex; justify-content:space-between; margin-bottom:10px;">
                    <span class="tiny accent bold">NEW LOOSE STEP</span>
                    <button onclick="OL.setInsertMode(null)" style="background:none; border:none; color:#64748b; cursor:pointer;">⬅</button>
                </div>
                ${renderInlineLooseForm(wf.id, index)}
            </div>`;
        }

        // 🔗 RESOURCE SEARCH FORM
        if (state.tempInsertMode === 'resource') {
            return `
            <div class="inline-insert-card fade-in" onclick="event.stopPropagation()" style="background: #0f172a; border: 1px solid var(--accent); border-radius: 8px; padding: 12px; margin: 4px 0; overflow: visible !important;">
                <div style="display:flex; justify-content:space-between; margin-bottom:10px;">
                    <span class="tiny accent bold">LINK RESOURCE</span>
                    <button onclick="OL.setInsertMode(null)" style="background:none; border:none; color:#64748b; cursor:pointer;">⬅</button>
                </div>
                <input type="text" class="mini-search" placeholder="Search or type new..." 
                       oninput="OL.handleInlineResourceSearch(this.value)" 
                       style="width:100%; background:#1e293b; border:1px solid #334155; color:white; padding:8px; border-radius:4px; font-size:11px; outline:none;">
                <div id="inline-search-results" style="background:#0f172a; border-top:none; max-height:200px; left:0; right:0; z-index:1000;"></div>
            </div>`;
        }
    }

    // Standard "+" Divider
    return `<div class="insert-divider resource-gap" onclick="event.stopPropagation(); state.openInsertIndex = '${key}'; state.tempInsertMode = null; OL.refreshMap();"><span>+</span></div>`;
}

OL.handleInlineResourceSearch = function(query) {
    const resultsContainer = document.getElementById('inline-search-results');
    if (!resultsContainer) return;

    const q = (query || "").toLowerCase().trim();
    if (!q) {
        resultsContainer.innerHTML = '';
        return;
    }

    // 🚀 THE FIX: Use the new colon separator to get the clean Parent ID
    if (!state.openInsertIndex) return;
    const [parentId, sequenceIdxStr] = state.openInsertIndex.split(':');
    const sequenceIdx = parseInt(sequenceIdxStr || 0);

    // Get the correct data context
    const context = OL.getCurrentContext();
    const resources = context.isMaster 
        ? (context.data?.resources || []) 
        : (context.data?.localResources || []);

    // 1. Filter the library for assets (excluding workflows)
    const filtered = resources.filter(res => 
        (res.type || "").toLowerCase() !== 'workflow' && 
        (res.name || "").toLowerCase().includes(q)
    ).slice(0, 5);

    // 2. Build the Results HTML
    let html = filtered.map(res => `
        <div class="search-item tiny" 
             style="padding:10px; cursor:pointer; border-bottom:1px solid rgba(255,255,255,0.05);"
             onclick="OL.linkResourceToWorkflow('${parentId}', '${res.id}', ${sequenceIdx})">
            <span style="margin-right:8px;">${OL.getRegistryIcon(res.type)}</span>
            <span>${esc(res.name)}</span>
        </div>
    `).join('');

    // 3. Always offer the "Create New" option
    html += `
        <div class="search-item tiny" 
             style="padding:12px; cursor:pointer; color: var(--accent); font-weight: bold; text-align: center; background: rgba(56, 189, 248, 0.05);"
             onclick="OL.createNewResourceAndLink('${parentId}', '${esc(query)}', ${sequenceIdx})">
            ➕ CREATE NEW: "${esc(query)}"
        </div>
    `;

    resultsContainer.innerHTML = html;
};

OL.linkResourceToWorkflow = async function(wfId, resId, index) {
    // 🚀 THE FIX: Clean the ID. If it contains a hyphen followed by a single digit at the end, strip it.
    // This handles cases where 'local-prj-123-1' is passed instead of 'local-prj-123'
    const cleanWfId = wfId.includes(':') ? wfId.split(':')[0] : wfId.replace(/-\d$/, '');
    
    console.log(`🔗 Linking Resource ${resId} into Workflow ${cleanWfId} at index ${index}`);

    await OL.updateAndSync(() => {
        const isVault = window.location.hash.includes('vault');
        const client = getActiveClient();
        const resources = isVault ? state.master.resources : client.projectData.localResources;

        // Use the cleaned ID for the search
        const wf = resources.find(r => String(r.id) === String(cleanWfId));
        
        if (wf) {
            if (!wf.steps) wf.steps = [];
            
            wf.steps.splice(index, 0, {
                id: 'link_' + Math.random().toString(36).substr(2, 9),
                resourceLinkId: resId,
                mapOrder: index 
            });

            wf.steps.forEach((s, idx) => s.mapOrder = idx);
            console.log("✅ Link successful to:", wf.name);
        } else {
            console.error("❌ Still could not find Workflow:", cleanWfId);
            // Log the library to see what IDs actually exist
            console.log("Current Library IDs:", resources.map(r => r.id));
        }
    });

    state.openInsertIndex = null;
    state.tempInsertMode = null;
    OL.refreshMap();
};

OL.createNewResourceAndLink = async function(wfId, name, index) {
    // 🚀 THE FIX: Resolve detectedType based on keywords in the name
    const n = name.toLowerCase();
    let detectedType = "SOP"; // Default
    if (n.includes("email")) detectedType = "Email";
    else if (n.includes("form")) detectedType = "Form";
    else if (n.includes("zap") || n.includes("automation")) detectedType = "Zap";
    else if (n.includes("sign") || n.includes("contract")) detectedType = "Signature";

    console.log(`✨ Auto-categorized as: ${detectedType}`);

    // STEP 1: Create the actual asset in the library
    const newResId = await OL.universalCreate(detectedType, { name });
    if (!newResId) return;

    // STEP 2: Link it to the workflow using our hardened function above
    await OL.linkResourceToWorkflow(wfId, newResId, index);

    // STEP 3: Focus the new item in the right sidebar
    setTimeout(() => OL.loadInspector(newResId, wfId), 150);
};

// Toggle custom input visibility
OL.handleInlineCustomToggle = function(selectEl, wrapId) {
    const wrap = document.getElementById(wrapId);
    if (selectEl.value === 'CUSTOM') {
        wrap.style.display = 'block';
        wrap.querySelector('input').focus();
    } else {
        wrap.style.display = 'none';
    }
};

// Finalize and Save
OL.finalizeInlineInsert = function(wfId, index) {
    const verbSelect = document.getElementById('verb-select');
    const objSelect = document.getElementById('obj-select');
    
    const verb = verbSelect.value === 'CUSTOM' ? document.getElementById('verb-custom-input').value : verbSelect.value;
    const obj = objSelect.value === 'CUSTOM' ? document.getElementById('obj-custom-input').value : objSelect.value;
    
    if (!verb || !obj) return alert("Please provide both a verb and an object.");

    const wf = OL.getResourceById(wfId);
    const newStep = {
        id: 'id_' + Math.random().toString(36).substr(2, 9),
        name: `${verb} ${obj}`,
        type: 'Action', // Defaulted as requested
        resourceLinkId: null
    };

    wf.steps.splice(index, 0, newStep);
    state.openInsertIndex = null;
    state.tempInsertMode = null;
    
    OL.persist();
    OL.refreshMap();
};

// 🔄 The Master Refresh Bridge
OL.refreshMap = OL.render = function() {
    const isVault = location.hash.includes('vault');
    // Your app uses renderGlobalVisualizer as the primary entry point
    if (typeof renderGlobalVisualizer === 'function') {
        renderGlobalVisualizer(isVault);
    } else {
        console.error("Critical: renderGlobalVisualizer not found.");
    }
};

OL.setInsertMode = function(mode) {
    state.tempInsertMode = mode;
    state.tempType = 'Action'; // Default
    OL.refreshMap();
};

function renderInlineLooseForm(wfId, index) {
    // 📚 Reference your existing library
    const verbs = [...ATOMIC_STEP_LIB.ActionVerbs].sort();
    const objects = [...ATOMIC_STEP_LIB.Objects].sort();

    return `
        <div class="inline-form-box fade-in">
            <div style="display:flex; flex-direction:column; gap:12px; margin-bottom:12px;">
                
                <div class="select-field">
                    <label style="display:block; font-size:8px; color:var(--accent); font-weight:bold; margin-bottom:4px;">ACTION VERB</label>
                    <select id="verb-select" class="modal-input tiny" style="width:100%;" onchange="OL.handleInlineCustomToggle(this, 'verb-custom-wrap')">
                        ${verbs.map(v => `<option value="${v}">${v}</option>`).join('')}
                        <option value="CUSTOM">-- Custom Verb --</option>
                    </select>
                    <div id="verb-custom-wrap" style="display:none; margin-top:5px;">
                        <input type="text" id="verb-custom-input" class="modal-input tiny" placeholder="Type verb..." style="width:100%;">
                    </div>
                </div>

                <div class="select-field">
                    <label style="display:block; font-size:8px; color:var(--accent); font-weight:bold; margin-bottom:4px;">DATA OBJECT</label>
                    <select id="obj-select" class="modal-input tiny" style="width:100%;" onchange="OL.handleInlineCustomToggle(this, 'obj-custom-wrap')">
                        ${objects.map(o => `<option value="${o}">${o}</option>`).join('')}
                        <option value="CUSTOM">-- Custom Object --</option>
                    </select>
                    <div id="obj-custom-wrap" style="display:none; margin-top:5px;">
                        <input type="text" id="obj-custom-input" class="modal-input tiny" placeholder="Type object..." style="width:100%;">
                    </div>
                </div>

            </div>
            <button class="btn-confirm" onclick="OL.finalizeInlineInsert('${wfId}', ${index})" 
                    style="width:100%; background:var(--accent); color:white; border:none; padding:8px; border-radius:4px; font-weight:bold; cursor:pointer; font-size:10px;">
                Confirm Logic Step
            </button>
        </div>
    `;
}

OL.checkIncomingLogic = function(stepId) {
    const client = getActiveClient();
    const allResources = [
        ...(state.master.resources || []),
        ...(client?.projectData?.localResources || [])
    ];

    // Scan all resources and their steps for an outcome pointing to our stepId
    return allResources.some(res => 
        (res.steps || []).some(step => 
            (step.outcomes || []).some(out => {
                const tid = out.targetId || (out.action?.includes('jump_step_') ? out.action.split('jump_step_')[1] : null);
                return String(tid) === String(stepId);
            })
        )
    );
};

OL.traceLogic = function(nodeId, direction) {
    // 🔍 TOGGLE CHECK:
    // Check if we are already showing a trace for THIS node and THIS direction
    const existingTraceId = `trace-${nodeId}-${direction}`;
    const alreadyExists = document.querySelector(`[data-trace-group="${existingTraceId}"]`);

    if (alreadyExists) {
        console.log("🧼 Toggling Trace OFF for:", nodeId);
        document.querySelectorAll(`[data-trace-group="${existingTraceId}"]`).forEach(el => el.remove());
        
        // Remove active state from the icon
        const rowEl = document.getElementById(`step-row-${nodeId}`) || document.getElementById(nodeId);
        if (rowEl) {
            const icon = rowEl.querySelector(`.logic-trace-icon.${direction === 'incoming' ? 'in' : 'out'}`);
            if (icon) icon.classList.remove('trace-active-icon');
        }
        return; // Exit function
    }

    OL.clearLogicTraces();
    console.log("🔍 TRACING:", nodeId);

    const client = getActiveClient();
    const all = [...(state.master.resources || []), ...(client?.projectData?.localResources || [])];
    
    // 1. Resolve Step Data
    const parentRes = all.find(r => String(r.id) === String(nodeId) || (r.steps || []).find(s => String(s.id) === String(nodeId)));
    const stepObj = (parentRes?.id === nodeId) ? parentRes : parentRes?.steps?.find(s => String(s.id) === String(nodeId));

    if (!stepObj) return console.error("❌ Data missing for ID:", nodeId);

    // 2. Resolve Starting DOM Element
    const rowEl = document.getElementById(`step-row-${nodeId}`) || document.getElementById(nodeId);
    if (!rowEl) return console.error("❌ DOM Source missing for ID:", nodeId);

    const sourceIcon = rowEl.querySelector(`.logic-trace-icon.${direction === 'incoming' ? 'in' : 'out'}`);
    const anchorEl = sourceIcon || rowEl;
    anchorEl.classList.add('trace-active-icon');

    const connections = [];

    if (direction === 'outgoing') {
        (stepObj.outcomes || []).forEach((o, index) => {
            console.log(`🔍 DEBUG Outcome ${index}:`, o); // This will reveal the true key name
        });

        (stepObj.outcomes || []).forEach(o => {
            // 🚀 THE FIX: Try every possible way to find the target ID
            let tid = o.targetId || o.toId;
            
            // If ID is buried in the action string (e.g., "jump_step_id_123")
            if (!tid && o.action && typeof o.action === 'string') {
                if (o.action.includes('jump_step_')) {
                    tid = o.action.replace('jump_step_', '');
                } else if (o.action.includes('jump_res_')) {
                    tid = o.action.replace('jump_res_', '');
                }
            }
            
            console.log("🎯 Resolved Target ID:", tid);

            if (tid) {
                const targetEl = document.getElementById(`step-row-${tid}`) || 
                                 document.getElementById(`l3-node-${tid}`) || 
                                 document.getElementById(`l2-node-${tid}`) ||
                                 document.getElementById(tid);
                
                if (targetEl) {
                    const targetIcon = targetEl.querySelector('.logic-trace-icon.in') || targetEl;
                    const conditionText = (o.condition && String(o.condition).trim() !== "") 
                              ? o.condition 
                              : `(${o.label || 'Always'})`;

                    connections.push({ from: anchorEl, to: targetIcon, label: conditionText });
                } else {
                    // 🚀 IMPROVED ROCKET (Body-anchored to ensure clickability)
                    const rect = anchorEl.getBoundingClientRect();
                    const teleportBtn = document.createElement('div');
                    teleportBtn.className = 'teleport-rocket fade-in';
                    teleportBtn.style.cssText = `
                        position: fixed;
                        left: ${rect.right + 10}px;
                        top: ${rect.top}px;
                        z-index: 10000;
                        pointer-events: auto !important;
                    `;
                    teleportBtn.innerHTML = `🚀 Jump to ${o.label || 'Target'}`;
                    
                    teleportBtn.onmousedown = (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        console.log("🚀 Warp Speed to:", tid);
                        OL.loadInspector(tid);
                        teleportBtn.remove();
                    };
                    
                    document.body.appendChild(teleportBtn);
                    setTimeout(() => teleportBtn.remove(), 5000);
                }
            }
        });
    } else {
        // Incoming Logic (Existing working logic)
        all.forEach(r => {
            (r.steps || []).forEach(s => {
                (s.outcomes || []).forEach(o => {
                    let tid = o.targetId || (o.action?.includes('jump_step_') ? o.action.split('jump_step_')[1] : null);
                    if (String(tid) === String(nodeId)) {
                        const fromRow = document.getElementById(`step-row-${s.id}`) || document.getElementById(s.id);
                        if (fromRow) {
                            const fromIcon = fromRow.querySelector('.logic-trace-icon.out') || fromRow;
                            const incomingLabel = (o.condition && String(o.condition).trim() !== "") 
                              ? o.condition 
                              : `(${o.label || 'Jump'})`;

                            connections.push({ from: fromIcon, to: anchorEl, label: incomingLabel });
                        }
                    }
                });
            });
        });
    }

    console.log(`🔗 Found ${connections.length} connections.`);
    connections.forEach(conn => {
        // Draw the arrow
        OL.drawTraceArrow(conn.from, conn.to, direction, conn.label, nodeId);

        // 🌟 THE GLOW: Find the card or row and light it up
        // We look for the closest parent with a card class, or the icon itself
        const targetCard = conn.to.closest('.workflow-block-card') || 
                           conn.to.closest('.atomic-step-row') || 
                           conn.to;

        targetCard.classList.add('trace-highlight-glow');

        // Remove the glow after 3 seconds so the UI stays clean
        setTimeout(() => {
            targetCard.classList.remove('trace-highlight-glow');
        }, 3000);

        // Optional: Smoothly center the target in the viewport
        targetCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
};

// 🚀 Updated signature to include direction and nodeId
OL.drawTraceArrow = function(fromEl, toEl, direction = "outgoing", label = "", nodeId = "unknown") {
    if (!fromEl || !toEl) return;

    const mapContainer = document.querySelector('.global-macro-map');
    if (!mapContainer) return;

    // 🚀 FIX: Get the SVG layer reference
    let svg = document.getElementById('logic-trace-layer');
    if (!svg) {
        svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.id = 'logic-trace-layer';
        Object.assign(svg.style, {
            position: 'absolute',
            top: '0',
            left: '0',
            width: mapContainer.scrollWidth + 'px',
            height: mapContainer.scrollHeight + 'px',
            pointerEvents: 'none',
            overflow: 'visible',
            zIndex: '5'
        });
        
        // Add the arrowhead definition
        svg.innerHTML = `
            <defs>
                <marker id="arrowhead" viewBox="0 0 10 10" refX="8" refY="5" 
                        markerWidth="6" markerHeight="6" orient="auto">
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="#38bdf8" />
                </marker>
            </defs>`;
        mapContainer.appendChild(svg);
    }

    const mapRect = mapContainer.getBoundingClientRect();
    const fRect = fromEl.getBoundingClientRect();
    const tRect = toEl.getBoundingClientRect();

    let x1 = (fRect.right) - mapRect.left;
    let y1 = (fRect.top + fRect.height / 2) - mapRect.top;
    let x2 = (tRect.left) - mapRect.left; 
    let y2 = (tRect.top + tRect.height / 2) - mapRect.top;

    const isSameColumn = Math.abs(fRect.left - tRect.left) < 50;
    const curveWidth = 60; 

    let d;
    if (isSameColumn) {
        // Pointing to right side of target
        x2 = (tRect.right) - mapRect.left + 2; 
        
        // Use a "C" bracket curve
        d = `M ${x1} ${y1} 
             C ${x1 + curveWidth} ${y1}, 
               ${x2 + curveWidth} ${y2}, 
               ${x2} ${y2}`;
    } else {
        // Standard "S" Curve (Left to Right)
        x2 = x2 - 2; 
        const deltaX = Math.abs(x2 - x1);
        const controlPointOffset = Math.min(deltaX / 2, 100); 

        d = `M ${x1} ${y1} 
             C ${x1 + controlPointOffset} ${y1}, 
               ${x2 - controlPointOffset} ${y2}, 
               ${x2} ${y2}`;
    }

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    path.setAttribute("stroke", "#38bdf8");
    path.setAttribute("stroke-width", "2.5");
    path.setAttribute("fill", "none");
    path.setAttribute("class", "trace-path"); 
    path.setAttribute("marker-end", "url(#arrowhead)");
    path.setAttribute("data-trace-group", `trace-${nodeId}-${direction}`);

    svg.appendChild(path);

    if (label) {
        const lbl = document.createElement('div');
        lbl.className = 'trace-label fade-in';
        lbl.setAttribute("data-trace-group", `trace-${nodeId}-${direction}`);
        lbl.innerText = label;
        
        // 🚀 Improved Label Placement: Apex of the curve for loops
        const midX = isSameColumn ? (x1 + curveWidth) : (x1 + (x2 - x1) / 2);
        const midY = y1 + (y2 - y1) / 2;
        
        lbl.style.cssText = `
            position:absolute; 
            left:${midX}px; 
            top:${midY}px; 
            transform:translate(-50%,-50%); 
            background:#0f172a; 
            color:#38bdf8; 
            padding:2px 6px; 
            border-radius:4px; 
            font-size:9px; 
            border:1px solid #38bdf8; 
            font-weight:bold; 
            white-space:nowrap; 
            z-index:10; 
            pointer-events:none;
            box-shadow: 0 2px 4px rgba(0,0,0,0.5);
        `;
        mapContainer.appendChild(lbl);
    }
};

// Global keyboard listener
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        console.log("⌨️ Escape pressed: Clearing all logic traces");
        OL.clearLogicTraces();
        
        // Also remove the "active" styling from all icons
        document.querySelectorAll('.trace-active-icon').forEach(el => {
            el.classList.remove('trace-active-icon');
        });

        // Remove any floating rockets
        document.querySelectorAll('.teleport-rocket').forEach(el => el.remove());
    }
});

OL.clearLogicTraces = function() {
    // 1. Wipe the SVG paths
    const svg = document.getElementById('logic-trace-layer');
    if (svg) {
        // Keep the <defs> for the arrowhead, just remove the paths
        const paths = svg.querySelectorAll('path:not([id])'); 
        paths.forEach(p => p.remove());
    }

    // 2. Wipe the floating text labels
    document.querySelectorAll('.trace-label').forEach(lbl => lbl.remove());
};

OL.handleResourceUnmap = async function(wfId, resId, isVault) {
    if (!confirm("Unmap this resource from this workflow?")) return;

    // 🚀 THE FIX: Use the standardized context helper instead of window globals
    const context = OL.getCurrentContext();
    const data = context.data;

    if (!data) {
        console.error("❌ Unmap Failed: No project or vault data context found.");
        return;
    }

    // Determine which list to look in based on the context
    const resources = context.isMaster ? data.resources : data.localResources;

    if (!resources) {
        console.error("❌ Unmap Failed: Resource library is missing from context.");
        return;
    }

    await OL.updateAndSync(() => {
        // Find the parent Workflow
        const wf = resources.find(r => String(r.id) === String(wfId));
        
        if (wf && wf.steps) {
            // Remove the link to the resource from the workflow's sequence
            wf.steps = wf.steps.filter(s => String(s.resourceLinkId) !== String(resId));
            console.log(`✅ Unmapped Resource ${resId} from Workflow ${wf.name}`);
        } else {
            console.warn("⚠️ Parent Workflow not found or has no steps.");
        }
    });

    // Refresh the map to show the item has been removed from the lane
    OL.refreshMap();
};

OL.handleWorkflowUnmap = async function(wfId, isVault) {
    if (!confirm("Remove this workflow from the stage?")) return;

    await OL.updateAndSync(() => {
        // Use the ID as a string to find the item
        const resources = isVault ? state.master.resources : getActiveClient().projectData.localResources;
        const wf = resources.find(r => String(r.id) === String(wfId));
        if (wf) {
            wf.stageId = null;
            wf.mapOrder = null;
        }
    });

    renderGlobalVisualizer(isVault);
};

OL.promptInsertResourceInWorkflow = async function(workflowId, order, isVault) {
    const name = prompt("Enter Resource/Asset Name (e.g. 'Customer Onboarding Form'):");
    if (!name) return;

    const workflow = OL.getResourceById(workflowId);
    if (!workflow) return;

    // 1. Create the permanent technical resource in the library
    const timestamp = Date.now();
    const newResId = isVault ? `res-vlt-${timestamp}` : `local-prj-${timestamp}`;
    
    const newRes = {
        id: newResId,
        name: name,
        type: "SOP", // Default
        steps: [],
        createdDate: new Date().toISOString()
    };

    const client = getActiveClient();
    if (isVault) state.master.resources.push(newRes);
    else client.projectData.localResources.push(newRes);

    // 2. Map it into the Workflow steps array at the specific position
    if (!workflow.steps) workflow.steps = [];
    
    const newStepLink = {
        id: uid(),
        name: name,
        resourceLinkId: newResId,
        mapOrder: order
    };

    // Inline Splice
    workflow.steps.splice(order, 0, newStepLink);

    // 3. Clean up the indexing
    workflow.steps.forEach((s, idx) => s.mapOrder = idx);

    OL.persist();
    renderGlobalVisualizer(isVault);

    // 4. 🧠 TRIGGER SMART SCAN
    // Reusing your logic: If they named it "Email", it will prompt to link/type it.
    const keywords = ["Email", "Form", "Meeting", "Signature", "Zap"];
    const detected = keywords.find(word => name.toLowerCase().includes(word.toLowerCase()));
    
    if (detected) {
        requestAnimationFrame(() => {
            if (confirm(`Detected "${detected}". Want to classify and link this immediately?`)) {
                // Classify the resource and open the modal
                OL.updateResourceMeta(newResId, 'type', detected);
            }
        });
    }
};

OL.promptInsertAtomicStep = function(resId, order, isVault) {
    const res = OL.getResourceById(resId);
    if (!res) return;

    const name = prompt("Enter Step Name (e.g. 'Send Confirmation Email'):");
    if (!name) return;

    if (!res.steps) res.steps = [];

    const newStep = {
        id: uid(),
        name: name,
        type: "Action",
        outcomes: [],
        timingValue: 0,
        timingType: 'after_prev'
    };

    // 1. Inline Insertion
    res.steps.splice(order, 0, newStep);
    res.steps.forEach((s, idx) => s.mapOrder = idx);

    // 2. 🚀 SMART SCAN: Check for keywords in the name
    const keywords = ["Email", "Form", "Meeting", "Signature", "Contract", "Zap", "SOP"];
    const detectedKeyword = keywords.find(word => name.toLowerCase().includes(word.toLowerCase()));

    OL.persist();
    renderGlobalVisualizer(isVault);

    // 3. 💡 Trigger Linker if keyword matched
    if (detectedKeyword) {
        // Normalizing 'Contract' or 'Signature' to 'Signature' etc.
        let targetType = detectedKeyword === "Contract" ? "Signature" : 
                         detectedKeyword === "Zap" ? "Zap" : detectedKeyword;
        
        // Slight delay to ensure the canvas has re-rendered the new node
        requestAnimationFrame(() => {
            if (confirm(`Detected "${detectedKeyword}" in step name. Would you like to link a technical asset now?`)) {
                OL.openResourceLinkerForStep(newStep.id, targetType);
            }
        });
    }
};

OL.isResourceInScope = function(resId) {
    const client = getActiveClient();
    const lineItems = client?.projectData?.scopingSheets?.[0]?.lineItems || [];
    // Check if any line item points to this resource
    return lineItems.find(item => String(item.resourceId) === String(resId));
};

OL.jumpToScopingItem = function(resId) {
    // 1. Set a temporary filter or focus state so the scoping sheet highlights it
    state.scopingSearch = OL.getResourceById(resId)?.name || "";
    // 2. Switch tabs
    location.hash = "#/scoping-sheet";
};

OL.toggleGlobalView = function(isVaultMode) {
    state.viewMode = (state.viewMode === 'global') ? 'focus' : 'global';
    localStorage.setItem('ol_preferred_view_mode', state.viewMode);
    
    // 🚀 THE GHOST REMOVAL:
    // If we are moving TO global, clear the specific focuses from state AND session
    if (state.viewMode === 'global') {
        state.focusedWorkflowId = null;
        state.focusedResourceId = null;
        sessionStorage.removeItem('active_workflow_id');
        sessionStorage.removeItem('active_resource_id');
    }
    
    renderGlobalVisualizer(isVaultMode);
};

state.currentDropIndex = null;

window.renderGlobalVisualizer = function(isVaultMode) {
    OL.registerView(() => renderGlobalVisualizer(isVaultMode));
    const container = document.getElementById("mainContent");
    const client = getActiveClient();
    if (!container) return;

    // 1. Resolve Data Sources
    const sourceData = isVaultMode ? state.master : (client?.projectData || {});
    const allResources = isVaultMode ? (state.master.resources || []) : (client?.projectData?.localResources || []);
    
    // 2. State & Mode Setup

    // 🚀 NEW: Route to V2 if in graph mode
    if (state.viewMode === 'graph') {
        window.renderVisualizerV2(isVaultMode);
        return;
    }

    if (!state.viewMode) state.viewMode = 'global';
    const isGlobalMode = state.viewMode === 'global';
    const isZen = state.ui.zenMode;
    const zenClass = (isZen && !state.ui.sidebarOpen) ? 'zen-mode-active' : '';

    let toolboxHtml = "";
    let canvasHtml = "";
    // 🚀 FIX: Breadcrumb always starts with clickable Global link
    let breadcrumbHtml = `<span class="breadcrumb-item" onclick="OL.exitToLifecycle()">🌐 Global Lifecycle</span>`;

    // 3. DETERMINISTIC RENDERING LOGIC (Corrected Priority)

    // Branch 1: Node Map (V2 Engine)
    if (state.viewMode === 'graph') {
        console.log("🕸️ Node Map Mode Active");
        breadcrumbHtml += ` <span class="muted"> > </span> <span class="breadcrumb-current">Node Map</span>`;
        // Note: window.renderVisualizerV2 handles its own toolbox and canvas internals
        window.renderVisualizerV2(isVaultMode);
        return; // 🚀 ABSOLUTE EXIT: Stop processing Tier 1/2/3 logic
    }

    // Branch 2: Step Factory (Level 3 Focus)
    if (state.focusedResourceId) {
        console.log("L3!!!");
        const res = OL.getResourceById(state.focusedResourceId);
        const parentWorkflow = allResources.find(r => (r.steps || []).some(s => s.resourceLinkId === state.focusedResourceId));
        if (parentWorkflow) {
            breadcrumbHtml += ` <span class="muted"> > </span> 
                <span class="breadcrumb-item clickable" onclick="OL.drillDownIntoWorkflow('${parentWorkflow.id}')">${esc(parentWorkflow.name)}</span>`;
        }
        if (res) {
            breadcrumbHtml += ` <span class="muted"> > </span> <span class="breadcrumb-current">Step Factory: ${esc(res.name)}</span>`;
            toolboxHtml = renderLevel3SidebarContent(state.focusedResourceId);
            canvasHtml = renderLevel3Canvas(state.focusedResourceId);
        }
    } 
    // Branch 3: Workflow Spine (Level 2 Focus)
    else if (state.focusedWorkflowId) {
        console.log("L2!!!");
        const focusedRes = OL.getResourceById(state.focusedWorkflowId);
        breadcrumbHtml += ` <span class="muted"> > </span> <span class="breadcrumb-current">${esc(focusedRes?.name)}</span>`;
        toolboxHtml = renderLevel2SidebarContent(allResources);
        canvasHtml = renderLevel2Canvas(state.focusedWorkflowId);
    } 
    // Branch 4: Macro Map (Level 1 Global)
    else if (state.viewMode === 'global') {
        console.log("L1!!!");
        toolboxHtml = renderLevel1SidebarContent(allResources);
        canvasHtml = renderGlobalCanvas(isVaultMode);
    } 
    // Branch 5: Focus Mode Fallback (Level 1 Focus)
    else {
        console.log("📋 Focus Fallback");
        toolboxHtml = renderLevel1SidebarContent(allResources);
        canvasHtml = renderLevel1Canvas(sourceData, isVaultMode);
    }

    // 4. INJECT HTML
    container.innerHTML = `
        <div class="three-pane-layout ${layoutClass} ${zenClass} toolbox-focused">
            <aside id="pane-drawer" class="pane-drawer">${toolboxHtml}</aside>
            <main class="pane-canvas-wrap">
                <div class="canvas-header" style="display: flex; justify-content: space-between; align-items: center; padding: 10px 15px;">
                    <div class="breadcrumbs">${breadcrumbHtml}</div>
                    
                    <div class="canvas-actions" style="display:flex; gap:10px;">
                        <button class="btn tiny ${state.viewMode === 'graph' ? 'accent' : 'soft'}" 
                                onclick="OL.setVisualizerMode('graph', ${isVaultMode})">
                            🕸️ Node Map
                        </button>

                        <button class="btn tiny ${state.viewMode === 'global' ? 'accent' : 'soft'}" 
                                onclick="OL.setVisualizerMode('global', ${isVaultMode})">
                            🌐 Global View
                        </button>

                        <button class="btn tiny ${state.viewMode === 'focus' ? 'accent' : 'soft'}" 
                                onclick="OL.setVisualizerMode('focus', ${isVaultMode})">
                            🔍 Focus Mode
                        </button>
                    </div>

                </div>
                <div class="${isGlobalMode ? 'global-scroll-canvas' : 'vertical-stage-canvas'}" id="fs-canvas">
                    ${canvasHtml}
                </div>
            </main>
            <aside id="inspector-panel" class="pane-inspector"></aside>
        </div>
    `;

    // 5. POST-RENDER SCRIPTS
    setTimeout(() => {
        OL.initSideResizers();
        if (state.focusedResourceId) OL.drawVerticalLogicLines(state.focusedResourceId);
        if (state.focusedWorkflowId) OL.drawLevel2LogicLines(state.focusedWorkflowId);
    }, 50);
};

OL.handleCanvasBackgroundClick = function(e) {
    // If we click the actual background (the #fs-canvas) and not a child element
    if (e.target.id === 'fs-canvas' && state.ui.sidebarOpen) {
        console.log("🌊 Background clicked - retracting sidebar");
        OL.closeSidebar();
    }
};

OL.toggleZenMode = function() {
    const layout = document.querySelector('.three-pane-layout');
    if (!layout) return;

    const isActive = layout.classList.toggle('zen-mode-active');
    
    // 💾 Persist preference
    localStorage.setItem('ol_zen_mode', isActive);

    // Update the button icon/text
    const btn = document.getElementById('zen-mode-toggle');
    if (btn) {
        btn.innerHTML = isActive ? 'Collapse ⤓' : 'Full Screen ⤢';
        btn.classList.toggle('accent', isActive);
    }
    
    // 🔄 Redraw lines because canvas size changed
    setTimeout(() => {
        if (state.focusedWorkflowId) OL.drawLevel2LogicLines(state.focusedWorkflowId);
        if (state.focusedResourceId) OL.drawVerticalLogicLines(state.focusedResourceId);
    }, 350);
};

OL.addLifecycleStage = function(isVaultMode) {
    console.log("🛠️ Adding Level 1 Stage. Vault Mode:", isVaultMode);
    
    const client = getActiveClient();
    // Identify if we are updating the Master Vault or a Client Project
    const sourceData = isVaultMode ? state.master : (client?.projectData || {});
    
    if (!sourceData.stages) sourceData.stages = [];

    const newStage = {
        id: "stage-" + Date.now(),
        name: "New Phase",
        order: sourceData.stages.length
    };

    sourceData.stages.push(newStage);

    // 💾 Save to Firebase
    OL.persist();
    
    // 🔄 Force UI refresh
    renderGlobalVisualizer(isVaultMode);
};

// --- TIER 1 RENDERER ---
window.renderLevel1Canvas = function(sourceData, isVaultMode) {
    const stages = sourceData.stages || [];
    stages.sort((a, b) => (a.order || 0) - (b.order || 0));

    return stages.map((stage, i) => `
        <div class="stage-container"> <div class="stage-header-row" draggable="true" 
                 ondragstart="event.stopPropagation(); OL.handleDragStart(event, '${stage.id}', 'stage', ${i})"
                 style="display:flex; justify-content:space-between; align-items:center;">
                
                <div style="display:flex; align-items:center; gap:8px; flex:1;">
                    <span class="muted" style="cursor: grab; font-size: 12px;">⋮⋮</span>
                    <span class="stage-number">${i+1}</span>
                    <span class="stage-name" 
                          contenteditable="true" 
                          spellcheck="false"
                          style="flex:1; outline:none;"
                          onblur="OL.renameLifecycleStage(${isVaultMode}, '${stage.id}', this.innerText)"
                          onkeydown="if(event.key==='Enter'){ event.preventDefault(); this.blur(); }">
                        ${esc(stage.name)}
                    </span>
                </div>
                <div class="stage-delete-x" 
                     onclick="event.stopPropagation(); OL.deleteLifecycleStage(${isVaultMode}, '${stage.id}')">
                    ×
                </div>
            </div>

            <div class="stage-workflow-stream grid-drop-target" 
                 data-section-id="${stage.id}"
                 ondragover="OL.handleUniversalDragOver(event)" 
                 ondragleave="OL.handleUniversalDragLeave(event)"
                 ondrop="OL.handleUniversalDrop(event, '${stage.id}')">
                
                ${renderWorkflowsInStage(stage.id, isVaultMode)}

                <div class="insert-divider initial" onclick="event.stopPropagation(); OL.focusToolbox('${stage.id}')">
                    <span>+ Add Workflow</span>
                </div>
            </div>
        </div>`).join('');
};

OL.renameLifecycleStage = function(isVaultMode, stageId, newName) {
    const client = getActiveClient();
    const sourceData = isVaultMode ? state.master : (client?.projectData || {});
    
    if (!sourceData.stages) return;

    const stage = sourceData.stages.find(s => s.id === stageId);
    if (stage && newName.trim() !== "") {
        stage.name = newName.trim();
        OL.persist();
        console.log(`✅ Stage ${stageId} renamed to: ${newName}`);
    }
};

// ✥ Stage Reordering Logic
OL.handleStageReorderStart = function(e, stageId) {
    // Only allow drag if clicking the handle/header, not a workflow card
    if (e.target.closest('.workflow-block-card')) return;
    e.dataTransfer.setData("moveStageId", stageId);
};

// 🗑️ Stage Deletion Logic
OL.deleteLifecycleStage = function(isVaultMode, stageId) {
    const client = getActiveClient();
    const sourceData = isVaultMode ? state.master : (client?.projectData || {});
    const allResources = isVaultMode ? (state.master.resources || []) : (client?.projectData?.localResources || []);

    if (!confirm("Remove this stage? Workflows will be moved back to the library.")) return;

    if (sourceData.stages) {
        sourceData.stages = sourceData.stages.filter(s => s.id !== stageId);
        // Re-index remaining stages
        sourceData.stages.forEach((s, idx) => s.order = idx);
    }

    allResources.forEach(res => {
        if (res.stageId === stageId) {
            res.stageId = null;
            res.mapOrder = null;
        }
    });

    OL.persist();
    renderGlobalVisualizer(isVaultMode);
};

// --- TIER 2 RENDERER ---
window.renderLevel2Canvas = function(workflowId) {
    // ⚡ THE GHOST KILLER: Ensure L3 is nulled when entering L2
    state.focusedWorkflowId = workflowId;
    state.focusedResourceId = null; 
    
    console.log("📍 View Context Set: L2 Mode (L3 Cleared)");
    
    const res = OL.getResourceById(workflowId);
    if (!res) return `<div class="p-20 muted text-center">Workflow not found</div>`;

    // 🚀 FILTER STATE
    const activeTypeFilter = state.l2TypeFilter || 'All';
    let steps = (res.steps || []).sort((a, b) => (a.mapOrder || 0) - (b.mapOrder || 0));

    // Filter logic
    if (activeTypeFilter !== 'All') {
        steps = steps.filter(s => {
            const asset = OL.getResourceById(s.resourceLinkId);
            return asset?.type === activeTypeFilter;
        });
    }

    const typesPresent = [...new Set((res.steps || []).map(s => OL.getResourceById(s.resourceLinkId)?.type))].filter(Boolean);

    let html = `
        <div class="canvas-filter-bar" style="padding: 10px 20px; display:flex; gap:8px; border-bottom:1px solid rgba(255,255,255,0.05); background: rgba(0,0,0,0.2);">
            <span class="pill tiny ${activeTypeFilter === 'All' ? 'accent' : 'soft'}" onclick="OL.setL2Filter('All')">All Assets</span>
            ${typesPresent.map(t => `
                <span class="pill tiny ${activeTypeFilter === t ? 'accent' : 'soft'}" onclick="OL.setL2Filter('${t}')">
                    ${OL.getRegistryIcon(t)} ${t}
                </span>
            `).join('')}
        </div>

        <div id="l2-canvas-wrapper" style="position: relative; padding: 60px; min-height: 100vh; display: flex; flex-direction: column; align-items: center;">
            <svg id="vis-links-layer-l2" style="position: absolute; top:0; left:0; width:100%; height:100%; pointer-events: none; overflow: visible; z-index: 1;"></svg>
            
            <div class="vertical-process-spine" 
                 style="width: 400px; display: flex; flex-direction: column; gap: 30px;"
                 ondragover="OL.handleUniversalDragOver(event)" 
                 ondragleave="OL.handleUniversalDragLeave(event)"
                 ondrop="OL.handleUniversalDrop(event, '${workflowId}')">
                
                ${steps.map((step, idx) => {
                    // 1. Try to find the tech asset
                    const techAsset = step.resourceLinkId ? OL.getResourceById(step.resourceLinkId) : null;
                    
                    // 2. Identify if this is a Factory/Atomic step
                    const isAtomic = !techAsset;
                    
                    // 3. Resolve Display Data (Use library asset if it exists, otherwise use step's internal data)
                    const displayName = techAsset ? techAsset.name : (step.name || "Untitled Step");
                    const displayIcon = techAsset ? OL.getRegistryIcon(techAsset.type) : "⚙️";
                    const displayDesc = techAsset ? (techAsset.description || '') : "Atomic logical step from Procedure level.";
                    
                    const isInspecting = techAsset ? (state.activeInspectorResId === techAsset.id) : (state.activeInspectorResId === step.id);
                    const scopingItem = techAsset ? OL.isResourceInScope(techAsset.id) : null;
                    const isInScope = !!scopingItem;

                    return `
                    <div class="workflow-block-card l2-resource-node ${isInScope ? 'is-priced' : ''} ${isInspecting ? 'is-inspecting' : ''} ${isAtomic ? 'is-atomic' : ''}" 
                        id="l2-node-${step.id}"
                        draggable="true"
                        ondragstart="event.stopPropagation(); OL.handleDragStart(event, '${step.id}', 'step', ${idx})"
                        onclick="event.stopPropagation(); OL.loadInspector('${techAsset?.id || step.id}', '${workflowId}')"
                        ondblclick="event.stopPropagation(); OL.drillIntoResourceMechanics('${techAsset?.id || step.id}')"
                        style="cursor: pointer; 
                        ${isAtomic ? 'border-left: 4px solid var(--vault-gold) !important;' : ''} 
                        ${isInScope ? 'border-left: 4px solid #10b981 !important;' : ''}"
                    >

                        ${isAtomic ? `
                            <div class="connect-resource-bridge" 
                                style="margin-top:10px; padding:8px; background:rgba(255,191,0,0.05); border:1px dashed var(--vault-gold); border-radius:4px; text-align:center;"
                                onclick="event.stopPropagation(); OL.openResourcePickerForStep('${step.id}')">
                                <span class="tiny" style="color:var(--vault-gold); font-weight:bold; cursor:pointer;">
                                    🔗 CONNECT TO LIBRARY RESOURCE
                                </span>
                            </div>
                        ` : ''}
                        
                        <div style="display:flex; justify-content:space-between; align-items:center; pointer-events: none;">
                            <span class="tiny muted">STEP ${idx + 1}</span>
                            ${isAtomic ? `<span class="pill tiny" style="background:var(--vault-gold); color:black; font-size:8px; font-weight:bold;">ATOMIC</span>` : ''}
                            ${isInScope ? `<span class="pill tiny" style="background:#10b981; color:white; font-size:8px;">PRICED $</span>` : ''}
                        </div>

                        <div class="bold accent" style="margin: 8px 0; font-size: 14px; pointer-events: none;">
                            ${displayIcon} ${esc(displayName)}
                        </div>
                        
                        <div class="tiny muted" style="font-size: 9px; line-height: 1.3; margin-bottom: 8px; pointer-events: none;">
                            ${esc(displayDesc)}
                        </div>

                        ${(step.outcomes || []).length > 0 ? `
                            <div class="tiny" style="color:var(--vault-gold); font-weight: bold; margin-top: 5px; pointer-events: none;">
                                🔀 ${step.outcomes.length} Logic Branches
                            </div>
                        ` : ''}

                        <div class="card-footer-meta" style="margin-top: auto; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.05); display: flex; justify-content: space-between; pointer-events: none;">
                            <span class="tiny muted">👤 ${esc(techAsset?.assigneeName || 'System')}</span>
                            <span class="tiny muted" style="opacity:0.5;">ID: ...${(techAsset?.id || step.id).slice(-4)}</span>
                        </div>
                    </div>
                    `;
                }).join('')}

                ${steps.length === 0 ? `<div class="p-40 muted italic text-center" style="border: 2px dashed rgba(255,255,255,0.05); border-radius: 12px;">Drop Resources here to build the sequence</div>` : ''}
            </div>
        </div>
    `;

    // Re-draw connection lines for jumps/logic
    setTimeout(() => OL.drawLevel2LogicLines(workflowId), 100);
    return html;
};

OL.setL2Filter = function(type) {
    state.l2TypeFilter = type;
    // We pass true/false based on whether the current URL includes 'vault'
    window.renderGlobalVisualizer(location.hash.includes('vault'));
};

OL.drawLevel2LogicLines = function(workflowId) {
    const svg = document.getElementById('vis-links-layer-l2');
    const wrapper = document.getElementById('l2-canvas-wrapper');
    if (!svg || !wrapper) return;
    
    const workflow = OL.getResourceById(workflowId);
    const steps = workflow.steps || [];
    const wrapperRect = wrapper.getBoundingClientRect();
    let pathsHtml = "";

    steps.forEach((step) => {
        (step.outcomes || []).forEach((oc, oIdx) => {
            // Find the target node on the canvas
            const targetId = oc.action?.replace('jump_res_', '').replace('jump_step_', '');
            const sourceEl = document.getElementById(`l2-node-${step.id}`);
            const targetEl = document.getElementById(`l2-node-${targetId}`);

            if (sourceEl && targetEl) {
                const s = sourceEl.getBoundingClientRect();
                const t = targetEl.getBoundingClientRect();
                
                const x1 = s.left - wrapperRect.left;
                const y1 = (s.top + s.height / 2) - wrapperRect.top;
                const x2 = t.left - wrapperRect.left;
                const y2 = (t.top + t.height / 2) - wrapperRect.top;

                // Create a 'Skip' curve to the left
                const curveOffset = 60 + (oIdx * 20);
                const d = `M ${x1} ${y1} C ${x1 - curveOffset} ${y1}, ${x2 - curveOffset} ${y2}, ${x2} ${y2}`;
                
                pathsHtml += `
                    <path d="${d}" fill="none" stroke="var(--vault-gold)" stroke-width="2" opacity="0.4" stroke-dasharray="6,3" />
                    <text x="${x1 - (curveOffset/2)}" y="${(y1+y2)/2}" fill="var(--vault-gold)" style="font-size:9px; font-weight:bold;">${esc(oc.condition || 'IF')}</text>
                `;
            }
        });
    });
    svg.innerHTML = pathsHtml;
};

// --- SIDEBAR RENDERERS ---

window.renderLevel1SidebarContent = function(allResources) {
    // Only show workflows that aren't already mapped to a stage
    const workflows = allResources.filter(res => (res.type || "").toLowerCase() === 'workflow' && !res.stageId);
    
    return `
        <div class="drawer-header">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 8px;">
                <h3 style="color: var(--accent); margin:0;">🔄 Workflows</h3>
                <button class="btn tiny primary" style="width:24px; height:24px; padding:0;" onclick="OL.quickCreateWorkflow()" title="Create New Workflow">+</button>
            </div>
            <input type="text" class="modal-input tiny sidebar-search" id="workflow-toolbox-search" 
                    placeholder="Search..." 
                    value="${state.lastSearchQuery || ''}"
                    oninput="OL.filterToolbox(this.value)">
        </div>
        
        <div class="drawer-tools" id="toolbox-list" style="height: calc(100% - 150px); overflow-y: auto;">
            ${workflows.map(res => `
                <div class="draggable-workflow-item" 
                     data-name="${res.name.toLowerCase()}" 
                     draggable="true" 
                     ondragstart="event.stopPropagation(); OL.handleDragStart(event, '${res.id}', 'workflow', 0)">
                    <span>⚙️</span> 
                    <span style="flex:1;">${esc(res.name)}</span>
                    <button class="btn tiny soft clone-btn" 
                            style="padding: 2px 4px; font-size: 10px; opacity: 0.4;" 
                            onclick="event.preventDefault(); event.stopPropagation(); OL.cloneResourceWorkflow('${res.id}')"
                            title="Clone Workflow">⿻</button>
                </div>
            `).join('')}
            
            <div id="no-results-msg" class="tiny muted italic" style="display:none; padding:20px; text-align:center;">
                No matching workflows found.
            </div>
        </div>

        <div class="return-to-library-zone grid-drop-target" 
             style="margin-top: auto; border-top: 1px solid rgba(255,255,255,0.1); padding: 15px; text-align: center; transition: all 0.2s;"
             ondragover="OL.handleUniversalDragOver(event)" 
             ondragleave="OL.handleUniversalDragLeave(event)"
             ondrop="OL.handleUnifiedDelete(event)">
            🗑️ Drop to Unmap
        </div>
    `;
};

OL.getRegistryIcon = function(typeName) {
    const registry = state.master.resourceTypes || [];
    // 🛡️ Case-insensitive find
    const entry = registry.find(t => t.type.toLowerCase() === (typeName || "").toLowerCase());
    
    if (entry && entry.icon) return entry.icon;
    
    // 🔍 Hardcoded fallback if the registry hasn't loaded yet
    const fuzzy = (typeName || "").toLowerCase();
    if (fuzzy.includes('email')) return "📧";
    if (fuzzy.includes('form')) return "📄";
    if (fuzzy.includes('zap')) return "⚡";
    
    return '⚙️'; 
};

window.renderLevel2SidebarContent = function(allResources) {
    const currentWorkflow = OL.getResourceById(state.focusedWorkflowId);
    const existingStepResourceIds = (currentWorkflow?.steps || []).map(s => s.resourceLinkId);

    // 1. Filter assets
    const assets = allResources.filter(res => 
        (res.type || "").toLowerCase() !== 'workflow' && 
        !existingStepResourceIds.includes(res.id)
    );

    // 2. Unique types for pills
    const uniqueTypes = [...new Set(assets.map(a => a.type || "Other"))].sort();

    // 3. Grouping
    const grouped = assets.reduce((acc, res) => {
        const type = res.type || "Other";
        if (!acc[type]) acc[type] = [];
        acc[type].push(res);
        return acc;
    }, {});

    // 4. Generate HTML (The icon lookup MUST be inside the map)
    const groupsHtml = Object.keys(grouped).sort().map(type => {
        // 🚀 MOVE THIS HERE:
        const icon = OL.getRegistryIcon(type);

        return `
            <div class="sidebar-type-group" data-group-type="${type}">
                <label class="modal-section-label" style="margin: 15px 0 8px 5px; opacity: 0.8;">
                    ${icon} ${type}s
                </label>
                ${grouped[type].map(res => `
                    <div class="draggable-workflow-item" 
                         data-name="${res.name.toLowerCase()}" 
                         draggable="true" 
                         ondragstart="event.stopPropagation(); OL.handleDragStart(event, '${res.id}', 'factory', 0)">
                        <span style="font-size: 1.2em; width: 24px; text-align: center;">${icon}</span>
                        <span style="flex: 1;">${esc(res.name)}</span>
                    </div>
                `).join('')}
            </div>
        `;
    }).join('');
    
    return `
        <div class="drawer-header">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 8px;">
                <h3 style="color: var(--accent); margin:0;">📦 Resource Library</h3>
                <button class="btn tiny primary" 
                        type="button" 
                        onclick="event.preventDefault(); OL.universalCreate(type)">
                    +
                </button>
            </div>
            <input type="text" class="modal-input tiny sidebar-search" 
                   id="resource-toolbox-search"
                   placeholder="Search assets..." 
                   oninput="OL.filterToolbox(this.value)">

            <div class="filter-pill-bar" style="display:flex; gap:4px; overflow-x:auto; padding: 8px 0 4px 0;">
                <div class="filter-pill active" onclick="OL.setSidebarTypeFilter('All', this)">All</div>
                ${uniqueTypes.map(t => `
                    <div class="filter-pill" onclick="OL.setSidebarTypeFilter('${t}', this)" title="${t}">
                        ${OL.getRegistryIcon(t)}
                    </div>
                `).join('')}
            </div>
        </div>
        <div class="drawer-tools" id="resource-toolbox-list">
            ${groupsHtml}
            <div id="no-resource-results-msg" class="no-results-placeholder tiny muted italic" style="display:none; padding:20px; text-align:center;">
                No matching resources found.
            </div>
            ${assets.length === 0 ? '<div class="tiny muted italic" style="padding:10px; text-align:center;">No assets available.</div>' : ''}
        </div>
        <div class="quick-build-section" style="padding: 15px; border-top: 1px solid rgba(255,255,255,0.1); background: rgba(0,0,0,0.15);">
            <label class="modal-section-label" style="color: var(--vault-gold);">⚡ Quick-Build Stream</label>
            <textarea id="quick-paste-box" class="modal-textarea" 
                      placeholder="1. Receive Lead&#10;2. KYC Verification&#10;3. DocuSign Signature" 
                      style="height:80px; font-size:11px; margin-top:8px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); color: #fff; width: 100%; border-radius: 4px; padding: 5px;"></textarea>
            <button class="btn tiny primary" style="width:100%; margin-top:8px; font-weight: bold;" 
                    onclick="OL.processQuickPaste()">Build Sequence</button>
        </div>
        <div class="return-to-library-zone grid-drop-target" 
             style="margin-top: auto; border-top: 1px solid rgba(255,255,255,0.1); padding: 15px; text-align: center; transition: all 0.2s;"
             ondragover="OL.handleUniversalDragOver(event)" 
             ondragleave="OL.handleUniversalDragLeave(event)"
             ondrop="OL.handleUnifiedDelete(event)">
            🗑️ Drop to Unmap
        </div>
    `;
};

OL.processQuickPaste = function() {
    const box = document.getElementById('quick-paste-box');
    const text = box.value.trim();
    if (!text) return;

    const workflow = OL.getResourceById(state.focusedWorkflowId);
    if (!workflow) return alert("Select a workflow first!");

    // 1. Split by new lines and clean up numbers/bullets
    const lines = text.split('\n').map(line => {
        return line.replace(/^[\d\.\-\*\>\s]+/, '').trim();
    }).filter(line => line.length > 0);

    // 2. Convert lines to Steps
    lines.forEach((line, index) => {
        const newResId = `local-prj-${Date.now()}-${index}`;
        
        // Create the Resource (The SOP)
        const newRes = {
            id: newResId,
            name: line,
            type: "SOP",
            steps: []
        };
        
        // Save it to the library
        const client = getActiveClient();
        client.projectData.localResources.push(newRes);

        // Map it to this Workflow (Level 2)
        if (!workflow.steps) workflow.steps = [];
        workflow.steps.push({
            id: uid(),
            name: line,
            resourceLinkId: newResId,
            mapOrder: workflow.steps.length
        });
    });

    // 3. Save & Refresh
    OL.persist();
    box.value = ""; // Clear the box
    window.renderGlobalVisualizer(location.hash.includes('vault'));
};

const ATOMIC_STEP_LIB = {
    Triggers: [
        "Meeting Booked", "Meeting Completed", "Task Completed", "Task Created", 
        "Workflow Step Completed", "Workflow Completed", "Workflow Started", 
        "Email Sent", "Form Completed", "Form Sent", "Document Uploaded"
    ],
    TriggerVerbs: ["Found", "Created", "Updated", "Deleted", "Sent", "Launched", "Completed", "Requested", "Tagged", "Added to List", "Added to Group", "Moved", "Submitted",
        "Passed","Reached","Approaching","Scheduled"
    ],
    ActionVerbs: ["Find", "Create", "Update", "Delete", "Send", "Launch", "Complete", "Request","Tag","Add to List","Add to Group","Move","Submit","Wait","Schedule"],
    Objects: ["Email", "Task", "Workflow", "Document", "Contact", "Event", "Opportunity", "Folder", "Form", "Table Row", "Tag", "Text", "Slack Message", "Signature Request"]
};

window.renderLevel3SidebarContent = function(resourceId) {
    console.group("🏭 L3 SIDEBAR DEBUG");
    console.log("1. Received resourceId:", resourceId);

    // Clean ID
    const cleanId = String(resourceId).replace(/^(l3-node-|step-node-|empty-)/, '');
    console.log("2. Cleaned ID for lookup:", cleanId);

    // Check Data
    const res = OL.getResourceById(cleanId);
    if (!res) {
        console.error("❌ CRITICAL: OL.getResourceById returned NULL for:", cleanId);
        console.log("Current state.master.resources:", state.master.resources);
        console.log("Current state.clients:", state.clients);
        console.groupEnd();
        return `<div class="p-20 tiny danger">⚠️ ERROR: Resource Data Missing for ${cleanId}</div>`;
    }

    console.log("3. Resource Found:", res.name);

    // Check Library
    const dbLib = state.master?.atomicLibrary;
    if (!dbLib) {
        console.warn("⚠️ state.master.atomicLibrary is MISSING. Using hardcoded fallbacks.");
    } else {
        console.log("4. Library Data Found:", dbLib);
    }

    const triggerVerbs = [...new Set([...ATOMIC_STEP_LIB.TriggerVerbs, ...(dbLib?.TriggerVerbs || [])])].sort();
    const actionVerbs = [...new Set([...ATOMIC_STEP_LIB.ActionVerbs, ...(dbLib?.ActionVerbs || [])])].sort();
    const objects = [...new Set([...ATOMIC_STEP_LIB.Objects, ...(dbLib?.Objects || [])])].sort();

    console.log("5. Builder Lists Ready - Triggers:", triggerVerbs.length, "Actions:", actionVerbs.length);
    console.groupEnd();

    // The actual HTML return
    return `
        <div class="drawer-header">
            <h3 style="color:var(--vault-gold)">🛠️ Step Factory</h3>
            <div class="tiny muted uppercase bold" style="margin-top:4px;">${esc(res.name)}</div>
        </div>
        <div class="factory-scroll-zone" style="padding:15px; overflow-y:auto; height: calc(100vh - 120px);">
            
            <label class="modal-section-label" style="color:#ffbf00">⚡ Trigger Builder</label>
            <div class="builder-box" style="background:rgba(255, 191, 0, 0.03); padding:12px; border-radius:8px; border: 1px solid rgba(255, 191, 0, 0.2); margin-bottom: 20px;">
                <select id="trigger-object" class="modal-input tiny">${objects.map(o => `<option value="${o}">${o}</option>`).join('')}</select>
                <select id="trigger-verb" class="modal-input tiny">${triggerVerbs.map(v => `<option value="${v}">${v}</option>`).join('')}</select>
                <div class="draggable-factory-item trigger" draggable="true" ondragstart="OL.handleDragStart(event, 'new', 'factory-trigger', null)">
                     ⚡ DRAG NEW TRIGGER
                </div>
            </div>

            <label class="modal-section-label">🎬 Action Builder</label>
            <div class="builder-box" style="background:rgba(255,255,255,0.03); padding:12px; border-radius:8px; border: 1px solid var(--line);">
                <select id="builder-verb" class="modal-input tiny">${actionVerbs.map(v => `<option value="${v}">${v}</option>`).join('')}</select>
                <select id="builder-object" class="modal-input tiny">${objects.map(o => `<option value="${o}">${o}</option>`).join('')}</select>
                <div class="draggable-factory-item action" draggable="true" ondragstart="OL.handleDragStart(event, 'new', 'factory-action', null)">
                     🚀 DRAG NEW ACTION
                </div>
            </div>
            
            <div style="margin-top:20px; text-align:center;">
                <button class="btn tiny soft" onclick="OL.promptAddAtomic('Verbs')">+ Add Verb</button>
                <button class="btn tiny soft" onclick="OL.promptAddAtomic('Objects')">+ Add Object</button>
            </div>
        </div>
    `;
};

OL.promptAddAtomic = function(category) {
    const newVal = prompt(`Add new ${category.slice(0, -1)}:`);
    if (!newVal) return;

    // 1. 🛡️ BOOTSTRAP CHECK
    // If the database library doesn't exist yet, initialize it using your CONST values
    if (!state.master.atomicLibrary) {
        console.log("🛠️ Initializing Atomic Library in database from constant...");
        state.master.atomicLibrary = {
            TriggerVerbs: [...ATOMIC_STEP_LIB.TriggerVerbs],
            ActionVerbs: [...ATOMIC_STEP_LIB.ActionVerbs],
            Objects: [...ATOMIC_STEP_LIB.Objects]
        };
    }

    // 2. Ensure the specific category array exists (safety for future updates)
    if (!state.master.atomicLibrary[category]) {
        state.master.atomicLibrary[category] = [];
    }
    
    // 3. Check for duplicates (Search both the DB and the hardcoded Const)
    const exists = state.master.atomicLibrary[category].includes(newVal) || 
                   (ATOMIC_STEP_LIB[category] && ATOMIC_STEP_LIB[category].includes(newVal));

    if (!exists) {
        state.master.atomicLibrary[category].push(newVal);
        state.master.atomicLibrary[category].sort();
        
        OL.persist(); // 💾 Save to Firestore
        renderGlobalVisualizer(location.hash.includes('vault'));
    } else {
        alert("Item already exists in the library.");
    }
};

OL.quickCreateWorkflow = async function() {
    const name = prompt("Enter Workflow Name:");
    if (!name) return;

    // 🚀 THE FIX: Determine isVaultMode inside the function
    const isVault = window.location.hash.includes('vault');
    const context = OL.getCurrentContext();
    const timestamp = Date.now();
    const newId = isVault ? `res-vlt-${timestamp}` : `local-prj-${timestamp}`;

    const newWorkflow = {
        id: newId,
        name: name,
        type: "Workflow",
        archetype: "Multi-Level",
        steps: [],
        stageId: null, 
        createdDate: new Date().toISOString()
    };

    const targetList = isVault ? state.master.resources : getActiveClient().projectData.localResources;
    targetList.push(newWorkflow);

    await OL.persist();
    
    // 🔄 Switch to Focus Mode and open the Inspector for the new item
    // This will open the right sidebar for naming/setup
    OL.loadInspector(newId); 
    console.log(`✨ Created New Workflow: ${name}`);
};

OL.cloneResourceWorkflow = function(resId) {
    const original = OL.getResourceById(resId);
    if (!original) return;

    const context = OL.getCurrentContext();
    const clone = JSON.parse(JSON.stringify(original));
    
    // 2. Generate New Identity
    const timestamp = Date.now();
    clone.id = context.isMaster ? `res-vlt-${timestamp}` : `local-prj-${timestamp}`;
    clone.name = `${original.name} (Copy)`;
    clone.stageId = null; // 🚀 Always force back into the toolbox/library
    clone.mapOrder = null;
    clone.createdDate = new Date().toISOString();

    // 3. Save to correct location
    const targetList = context.isMaster ? context.data.resources : context.data.localResources;
    targetList.push(clone);

    OL.persist();
    renderGlobalVisualizer(isVaultMode);
    console.log(`⿻ Cloned Workflow: ${clone.name}`);
};

// --- INSPECTOR ENGINE ---
// ==========================================
// THE UNIFIED INSPECTOR ENGINE
// Handles: Stages, Workflows, Resources, and Steps
// ==========================================

OL.renderHierarchySelectors = function(targetObj, isVaultMode, parentId=null) {
    const client = getActiveClient();
    const allResources = isVaultMode ? (state.master.resources || []) : (client?.projectData?.localResources || []);
    const sourceData = isVaultMode ? state.master : (client?.projectData || {});
    
    // 🚀 THE DYNAMIC FIX: Get all recognized types from the Type Manager
    const dynamicTypes = Object.values(state.master.rates?.variables || {}).map(v => v.applyTo);
    const recognizedTypes = [...new Set(dynamicTypes.filter(Boolean))];

    const isWorkflow = targetObj.type === 'Workflow';
    
    // Check if targetObj.type matches ANY of the types in your Type Manager
    const isResource = recognizedTypes.some(t => 
        t.toLowerCase() === (targetObj.type || "").toLowerCase()
    );
    
    const isStep = !isWorkflow && !isResource;

    let html = `<div class="hierarchy-selectors" style="display:flex; flex-direction:column; gap:10px; margin-bottom:20px; padding:12px; background:rgba(0,0,0,0.2); border-radius:8px; border:1px solid rgba(255,255,255,0.1);">`;

    // 🟢 1. WORKFLOW -> STAGE
    if (isWorkflow) {
        html += `
            <div class="form-group">
                <label class="tiny muted bold uppercase" style="font-size:8px; color:var(--accent); margin-bottom:4px;">Stage</label>
                <select class="modal-input tiny" onchange="OL.reassignHierarchy('${targetObj.id}', 'stageId', this.value, ${isVaultMode})">
                    <option value="">-- Unmapped --</option>
                    ${(sourceData.stages || []).map(s => `<option value="${s.id}" ${String(s.id) === String(targetObj.stageId) ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
                </select>
            </div>`;
    }

    // 🔵 2. RESOURCE -> WORKFLOW (Reverse Lookup)
    if (isResource) {
        const currentWf = allResources.find(r => r.type === 'Workflow' && (r.steps || []).some(s => String(s.resourceLinkId) === String(targetObj.id)));
        html += `
            <div class="form-group">
                <label class="tiny muted bold uppercase" style="font-size:8px; color:var(--accent); margin-bottom:4px;">Workflow Assignment</label>
                <select class="modal-input tiny full-width" onchange="OL.reassignHierarchy('${targetObj.id}', 'workflowId', this.value, ${isVaultMode})">
                    <option value="" ${!currentWf ? 'selected' : ''}>-- Unmapped (Library Only) --</option>
                    ${allResources.filter(r => r.type === 'Workflow').map(w => `<option value="${w.id}" ${currentWf?.id === w.id ? 'selected' : ''}>🔄 ${esc(w.name)}</option>`).join('')}
                </select>
            </div>`;
    }

    // 🟠 3. STEP -> RESOURCE
    if (isStep) {
        // 🚀 THE FIX: If targetObj doesn't have a linkId, but we are in a parent context, 
        // it means THIS is the internal step.
        const effectiveParentId = targetObj.resourceLinkId || parentId;

        const parentWf = allResources.find(r => r.type === 'Workflow' && (r.steps || []).some(s => String(s.id) === String(targetObj.id)));
        
        const filteredResources = allResources.filter(res => {
            const isNotWorkflow = res.type !== 'Workflow';
            const isInThisWorkflow = (parentWf?.steps || []).some(s => String(s.resourceLinkId) === String(res.id));
            return isNotWorkflow && isInThisWorkflow;
        });

        return `
            <div class="hierarchy-stack" style="display:flex; flex-direction:column; gap:12px; margin-bottom:20px;">
                <div class="stack-field">
                    <label class="tiny-label">WORKFLOW CONTAINER</label>
                    <select class="modal-input tiny full-width" onchange="OL.moveStepToWorkflow('${targetObj.id}', this.value, ${isVaultMode})">
                        ${allResources.filter(r => r.type === 'Workflow').map(w => `
                            <option value="${w.id}" ${parentWf?.id === w.id ? 'selected' : ''}>🔄 ${esc(w.name)}</option>
                        `).join('')}
                    </select>
                </div>

                <div class="stack-field">
                    <label class="tiny-label">RESOURCE ASSIGNMENT</label>
                    <select class="modal-input tiny full-width" onchange="OL.handleStepAssignmentChange('${targetObj.id}', this.value, ${isVaultMode})">
                        <option value="LOOSE" ${!effectiveParentId ? 'selected' : ''}>📝 Loose Step (Unassigned)</option>
                        <optgroup label="Workflow Assets">
                            ${filteredResources.map(res => `
                                <option value="${res.id}" ${String(res.id) === String(effectiveParentId) ? 'selected' : ''}>
                                    ${OL.getRegistryIcon(res.type)} ${esc(res.name)}
                                </option>
                            `).join('')}
                        </optgroup>
                    </select>
                </div>
            </div>
        `;
    }

    html += `</div>`;
    return html;
};

OL.moveStepToWorkflow = async function(stepId, targetWfId, isVault) {
    const client = getActiveClient();
    const sourceResources = isVault ? state.master.resources : client.projectData.localResources;
    
    let stepObj = null;

    await OL.updateAndSync(() => {
        // 1. Find and Remove from old workflow
        sourceResources.forEach(wf => {
            if (wf.type === 'Workflow' && wf.steps) {
                const idx = wf.steps.findIndex(s => String(s.id) === String(stepId));
                if (idx > -1) {
                    [stepObj] = wf.steps.splice(idx, 1);
                }
            }
        });

        // 2. Add to new workflow
        const targetWf = sourceResources.find(r => r.id === targetWfId);
        if (targetWf && stepObj) {
            if (!targetWf.steps) targetWf.steps = [];
            targetWf.steps.push(stepObj);
        }
    });

    OL.refreshMap();
    OL.loadInspector(stepId);
};

OL.handleStepAssignmentChange = async function(stepId, newValue, isVault) {
    // 1. Get current data
    const client = getActiveClient();
    const sourceResources = isVault ? state.master.resources : client.projectData.localResources;
    
    // Find the step and its current workflow parent
    let stepObj = null;
    let parentWf = sourceResources.find(wf => {
        const found = (wf.steps || []).find(s => String(s.id) === String(stepId));
        if (found) { stepObj = found; return true; }
        return false;
    });

    if (!stepObj) return;

    await OL.updateAndSync(() => {
        if (newValue === "LOOSE") {
            // 🔓 Make it a standalone row in the workflow
            delete stepObj.resourceLinkId;
        } else {
            // 🔗 Bind it to the resource
            // We set the resourceLinkId so the Map knows which card to group it into
            stepObj.resourceLinkId = newValue;
            
            // 🚀 OPTIONAL: If you want the step to also exist inside the Resource's own procedure:
            const targetRes = sourceResources.find(r => r.id === newValue);
            if (targetRes) {
                if (!targetRes.steps) targetRes.steps = [];
                // Check if it's already in there to prevent duplication
                const alreadyInRes = targetRes.steps.some(s => String(s.id) === String(stepId));
                if (!alreadyInRes) {
                    targetRes.steps.push({...stepObj}); // Add to resource's internal procedure
                }
            }
        }
    });

    OL.refreshMap();
    OL.loadInspector(stepId, parentWf?.id);
};

OL.reassignHierarchy = async function(targetId, level, newParentId, isVault) {
    const item = OL.getResourceById(targetId);
    if (!item) return;

    // 🛡️ THE SHIELD: Prevent incoming syncs from resetting the UI while we work
    state.activeInspectorResId = targetId; 

    const client = getActiveClient();
    const sourceResources = isVault ? state.master.resources : client.projectData.localResources;

    await OL.updateAndSync(() => {
        // 🟢 LEVEL 1: Move Workflow to different Stage
        if (level === 'stageId') {
            item.stageId = newParentId;
            item.mapOrder = 999; 
        } 

        // 🔵 LEVEL 2: Move Resource to different Workflow
        if (level === 'workflowId') {
            // 1. Remove from all other workflows first
            sourceResources.forEach(wf => {
                if (wf.steps) wf.steps = wf.steps.filter(s => String(s.resourceLinkId) !== String(targetId));
            });
            
            // 2. Add to the new parent workflow
            const newWf = sourceResources.find(r => String(r.id) === String(newParentId));
            if (newWf) {
                if (!newWf.steps) newWf.steps = [];
                newWf.steps.push({ id: uid(), name: item.name, resourceLinkId: targetId });
            }
        }
    });

    // 🔄 Force a clean redraw
    renderGlobalVisualizer(isVault);
    OL.loadInspector(targetId);
};

const getAllIncomingLinks = (targetId, allResources) => {
    const connections = [];
    allResources.forEach(parent => {
        // Search in steps (Workflows/SOPs)
        if (parent.steps && parent.steps.some(s => String(s.resourceLinkId) === String(targetId))) {
            connections.push(parent);
        }
        // Search in app references or other custom link fields if they exist
        if (parent.appId === targetId || parent.linkedResourceId === targetId) {
            connections.push(parent);
        }
    });
    return connections;
};

OL.loadInspector = function(targetId, parentId = null) {
    const cleanId = String(targetId).replace(/^(empty-|step-|link-)/, '');   
    const isVaultMode = location.hash.includes('vault');
    const client = getActiveClient();
    const data = OL.getResourceById(cleanId); // Use cleaned ID
    
    if (!data) {
        console.error("❌ Inspector Error: No data found for", cleanId);
        return;
    }

    const allResources = isVaultMode 
        ? (state.master.resources || []) 
        : (client?.projectData?.localResources || []);

    const isTopLevelResource = allResources.some(r => String(r.id) === cleanId);

    // ⚓ THE ANCHOR: Lock the parent context for re-renders
    if (parentId) {
        state.activeInspectorParentId = parentId;
    } else {
        parentId = state.activeInspectorParentId;
    }

    state.activeInspectorResId = targetId;
    const panel = document.getElementById('inspector-panel');
    if (!panel) return;

    const layout = document.querySelector('.three-pane-layout');
    if (layout && layout.classList.contains('zen-mode-active')) {
        layout.classList.remove('zen-mode-active');
    }

    let contentWrapper = panel.querySelector('.inspector-scroll-content');
    if (!contentWrapper) {
        panel.innerHTML = `
            <div class="sidebar-resizer right-side-handle"></div>
            <div class="inspector-scroll-content"></div>
        `;
        contentWrapper = panel.querySelector('.inspector-scroll-content');
        OL.initSideResizers(); 
    }

    const isAssigned = !!data.resourceLinkId;

    setTimeout(() => OL.scrollToCanvasNode(targetId), 50);

    // 1. Get the list of types defined in your Type Manager
    const dynamicTypes = Object.keys(state.master.rates?.variables || {});
    
    const isRecognizedType = dynamicTypes.some(t => 
        t.toLowerCase() === (data.type || "").toLowerCase()
    );

    // 2. Identify the current item
    const isStage = cleanId.startsWith('stage-');
    const isWorkflow = data.type === 'Workflow';

    // 🛡️ THE DYNAMIC CHECK: 
    // Is the current item's type found in the Type Manager?
   const isLibraryResource = isVaultMode 
        ? state.master.resources.some(r => String(r.id) === cleanId)
        : client.projectData.localResources.some(r => String(r.id) === cleanId);

    const isTechnicalResource = isLibraryResource && !isWorkflow;
    
    const isInternalStep = !!parentId && parentId !== cleanId;

    // 🛡️ A step is ONLY atomic if it's NOT a stage, NOT a workflow, NOT in library, AND NOT internal
    const isAtomicStep = !isStage && !isWorkflow && !isLibraryResource && !isInternalStep;

    const levelLabel = 
        isStage ? "Stage" : 
        isWorkflow ? "Workflow" : 
        isRecognizedType ? (data.type || "Resource") : 
        (isInternalStep ? "Procedural Step" : "Step");

    console.log(`🕵️ Inspector Identity: [${data.name}] -> ${levelLabel} (isAtomic: ${isAtomicStep})`);
    
    const allApps = [...(state.master.apps || []), ...(client?.projectData?.localApps || [])];

    // 🚀 NEW: Check for Incoming Logic using targetId
    const isTargetOfLogic = OL.checkIncomingLogic(targetId);

   const allConnections = getAllIncomingLinks(targetId, allResources);
    
    // State for filtering (you can persist this in state.ui if desired)
    const activeFilter = state.ui.relationshipFilter || 'All';
    const filteredConnections = allConnections.filter(c => 
        activeFilter === 'All' || c.type === activeFilter
    );
    
    let types = []; 
    if (allConnections.length > 0) {
        types = ['All', ...new Set(allConnections.map(c => c.type))];
    }
  
    OL.syncCanvasHighlights(); 
    OL.applyCanvasHighlight();

    // ------------------------------------------------------------
    // 1. DYNAMIC HEADER & BACK BUTTON
    // ------------------------------------------------------------
    let html = `<div class="inspector-content fade-in" style="padding: 20px; width: 100%; box-sizing: border-box;">`;
    html += OL.renderHierarchySelectors(data, isVaultMode, parentId);

    // 🚀 THE UNASSIGN TRIGGER
    if (isAtomicStep && isAssigned) {
        html += `
            <div style="margin-bottom: 15px;">
                <button class="btn tiny soft" onclick="OL.unassignStep('${targetId}', '${parentId}')" 
                        style="background: rgba(244, 63, 94, 0.1); color: #fb7185; border: 1px solid rgba(244, 63, 94, 0.2); width: 100%; justify-content: center;">
                    🔓 Unassign from Resource (Make Loose)
                </button>
            </div>
        `;
    } else if (isAtomicStep && !isAssigned) {
        html += `
            <div style="margin-bottom: 15px; padding: 10px; background: rgba(56, 189, 248, 0.05); border: 1px dashed #38bdf8; border-radius: 6px; text-align: center;">
                <span class="tiny accent" style="display: block; margin-bottom: 4px;">📝 LOOSE DRAFT STEP</span>
                <button class="btn tiny primary" onclick="OL.openResourcePickerForStep('${targetId}')" style="font-size: 9px;">
                    🔗 Assign to Resource
                </button>
            </div>
        `;
    }

    html += `
        <div style="border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 15px; margin-bottom: 20px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                <span class="pill tiny accent">${isTechnicalResource ? '📦 ' : ''}${levelLabel.toUpperCase()}</span>
                
                ${isAtomicStep ? `
                    <button class="btn tiny soft" onclick="OL.loadInspector('${parentId}')" 
                            style="background: rgba(255,255,255,0.1); font-size: 9px; padding: 2px 8px;">
                        ⬅ Back to Resource
                    </button>
                ` : ''}

                ${isTechnicalResource ? `<button class="btn tiny soft" onclick="OL.openResourceModal('${data.id}')">↗ Full Modal</button>` : ''}
            </div>
            
            <input type="text" class="header-editable-input" value="${esc(data.name || data.title)}" 
                   style="background:transparent; border:none; color:#fff; font-size:18px; font-weight:bold; width:100%; outline:none;"
                   onblur="${isAtomicStep  || isInternalStep ? 
                        `OL.updateAtomicStep('${parentId}', '${data.id}', 'name', this.value)` : 
                        `OL.updateResourceMetadata('${data.id}', 'name', this.value)`}">
            
        </div>`;

    // ------------------------------------------------------------
    // 🚀 NEW: INCOMING LOGIC BADGE (Renders right under the title)
    // ------------------------------------------------------------
    if (isTargetOfLogic) {
        html += `
            <div class="logic-badge incoming fade-in" style="margin-bottom: 20px;">
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="font-size:14px;">📥</span>
                    <div style="display:flex; flex-direction:column;">
                        <span style="font-weight:bold; font-size:10px;">INCOMING CONNECTION</span>
                        <span style="font-size:9px; opacity:0.8;">This step is triggered by external logic.</span>
                    </div>
                </div>
                <button class="btn tiny primary" style="font-size:9px; padding:2px 10px;" 
                        onclick="OL.traceLogic('${targetId}', 'incoming')">
                    Trace Source
                </button>
            </div>
        `;
    }

    // ------------------------------------------------------------
    // 2. DESCRIPTION & NOTES
    // ------------------------------------------------------------

    html += `
        <div class="card-section">
            <label class="modal-section-label">📝 Description & Technical Notes</label>
            <textarea class="modal-textarea" rows="3" style="width:100%; font-size:11px;"
                      onblur="${isAtomicStep ? 
                        `OL.updateAtomicStep('${parentId}', '${data.id}', 'description', this.value)` : 
                        `OL.updateResourceMetadata('${targetId}', 'description', this.value)`}">${esc(data.description || data.notes || '')}</textarea>
        </div>`;

    // ------------------------------------------------------------
    // 3. INTERNAL PROCEDURE / STEPS (For Workflows & Resources)
    // ------------------------------------------------------------
    if (isTechnicalResource || isWorkflow) {
        html += `
            <div class="card-section" style="margin-top:25px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                    <label class="modal-section-label">⚙️ Procedure Steps</label>
                    ${isTechnicalResource ? `<button class="btn tiny primary" onclick="OL.promptInsertAtomicStep('${data.id}', ${data.steps?.length || 0}, ${isVaultMode})">+</button>` : ''}
                </div>
                
                <div id="inspector-step-list" 
                     class="grid-drop-target"
                     ondragover="OL.handleUniversalDragOver(event)"
                     ondragleave="OL.handleUniversalDragLeave(event)"
                     ondrop="OL.handleUniversalDrop(event, '${data.id}')"
                     style="display:flex; flex-direction:column; gap:5px; min-height:50px; transition: background 0.2s;">
                    
                    ${(data.steps || []).map((step, idx) => `
                    <div class="inspector-step-row vis-node" 
                        draggable="true"
                        data-step-id="${step.id}"
                        ondragstart="event.stopPropagation(); OL.handleDragStart(event, '${step.id}', 'step', ${idx})"
                        style="
                            display: flex !important; 
                            position: relative !important; /* 🚀 Stops the pile-up */
                            left: 0 !important; 
                            top: 0 !important; 
                            margin-bottom: 8px; /* Spacing between rows */
                            align-items: center; 
                            gap: 8px; 
                            background: rgba(255,255,255,0.05); 
                            padding: 10px; 
                            border-radius: 4px; 
                            border: 1px solid rgba(255,255,255,0.1); 
                            cursor: default;
                            width: 100%;
                        ">
                        
                        <span class="muted" style="cursor:grab; font-size:12px; opacity:0.5;">⋮⋮</span>
                        <span class="tiny bold accent" style="width:18px;">${idx + 1}</span>
                        
                        <div class="is-clickable" style="flex:1; font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;"
                            onclick="OL.loadInspector('${step.id || step.resourceLinkId}', '${data.id}')">
                            ${esc(step.name || 'Unnamed Step')}
                        </div>
                        
                        <button class="card-delete-btn" style="position:static; font-size:16px; opacity:0.7;" 
                                onclick="event.stopPropagation(); OL.removeStepFromCanvas('${data.id}', '${step.id}')">×</button>
                    </div>
                `).join('')}
                </div>
            </div>`;
    }

    // ------------------------------------------------------------
    // 4. ATOMIC STEP CONFIG (App & Assignment - Only for Steps)
    // ------------------------------------------------------------
    if (isAtomicStep) {
        const stepApp = allApps.find(a => String(a.id) === String(data.appId));
        html += `
            <div class="card-section" style="margin-top:20px;">
                <label class="modal-section-label">📱 Linked Application</label>
                <div style="margin-top:8px;">
                    ${stepApp ? `
                        <div class="pill accent is-clickable" onclick="OL.openAppModal('${stepApp.id}')" style="display:flex; align-items:center; width: 100%; justify-content: space-between;">
                            <span>📱 ${esc(stepApp.name)}</span>
                            <b class="pill-remove-x" onclick="event.stopPropagation(); OL.updateAtomicStep('${parentId}', '${data.id}', 'appId', '')">×</b>
                        </div>
                    ` : `
                        <div class="search-map-container">
                            <input type="text" class="modal-input tiny" placeholder="Link App..." 
                                   onfocus="OL.filterAppSearch('${parentId}', '${data.id}', this.value)"
                                   oninput="OL.filterAppSearch('${parentId}', '${data.id}', this.value)">
                            <div id="app-search-results" class="search-results-overlay"></div>
                        </div>
                    `}
                </div>
            </div>
            <div class="card-section" style="margin-top:20px;">
                <label class="modal-section-label">👨‍💼 Assigned To</label>
                <div class="search-map-container" style="margin-top: 8px;">
                    <input type="text" class="modal-input tiny" placeholder="Assign member..." 
                           onfocus="OL.filterAssignmentSearch('${parentId}', '${data.id}', false, '')"
                           oninput="OL.filterAssignmentSearch('${parentId}', '${data.id}', false, this.value)">
                    <div id="assignment-search-results" class="search-results-overlay"></div>
                </div>
            </div>`;
    }

    // ------------------------------------------------------------
    // 🔗 RESOURCE MAPPING AREA (Reusing Existing Logic)
    // ------------------------------------------------------------
    html += `
        <div class="card-section" style="margin-top:25px; border-top: 1px solid rgba(255,255,255,0.05); padding-top:20px;">
            <label class="modal-section-label" style="font-size:9px; color:var(--accent);">🔗 LINKED RESOURCES & GUIDES</label>
            
            <div id="step-resources-list-${targetId}">
                ${renderStepResources(parentId || targetId, data)}
            </div>

            <div class="search-map-container" style="position:relative; margin-top:5px;">
                <input type="text" class="modal-input tiny" 
                       placeholder="+ Link a Guide or SOP..." 
                       onfocus="OL.filterResourceSearch('${parentId || targetId}', '${targetId}', this.value)"
                       oninput="OL.filterResourceSearch('${parentId || targetId}', '${targetId}', this.value)">
                
                <div id="resource-results-${targetId}" class="search-results-overlay"></div>
            </div>
        </div>
    `;

    // ------------------------------------------------------------
    // 🚀 UNIVERSAL RELATIONSHIP SCANNER (Moved OUTSIDE if(isAtomicStep))
    // ------------------------------------------------------------
    // If we're on a Step, we check where the Parent Resource is used. 
    // Otherwise, we check where this specific Resource/Workflow is used.
    const scannerTargetId = isAtomicStep ? parentId : targetId;

        html += `
            <div class="card-section" style="margin-top:20px; border-top: 1px solid rgba(255,255,255,0.05); padding-top:15px;">
                <label class="modal-section-label">🔗 Connected Relationships</label>
                
                <div style="display: flex; gap: 5px; margin: 8px 0; overflow-x: auto; padding-bottom: 5px;">
                    ${types.map(t => `
                        <span onclick="state.ui.relationshipFilter = '${t}'; OL.refreshInspector();" 
                              style="font-size: 9px; padding: 2px 8px; border-radius: 10px; cursor: pointer; 
                              background: ${activeFilter === t ? 'var(--accent)' : 'rgba(255,255,255,0.05)'};
                              color: ${activeFilter === t ? '#000' : '#94a3b8'}; border: 1px solid rgba(255,255,255,0.1);">
                            ${t.toUpperCase()}
                        </span>
                    `).join('')}
                </div>

                <div style="display: flex; flex-direction: column; gap: 6px;">
                    ${filteredConnections.map(conn => `
                        <div class="pill accent is-clickable" 
                             onclick="event.preventDefault(); event.stopPropagation(); OL.loadInspector('${conn.id}')"
                             style="display:flex; align-items:center; justify-content: space-between; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.1); pointer-events: auto !important;">
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <span style="font-size: 12px;">${OL.getRegistryIcon(conn.type)}</span>
                                <div style="display:flex; flex-direction:column;">
                                    <span style="font-size: 11px; color: #eee;">${esc(conn.name)}</span>
                                    <span style="font-size: 8px; color: var(--accent); opacity: 0.8;">${conn.type.toUpperCase()}</span>
                                </div>
                            </div>
                            <span style="font-size: 9px; opacity: 0.5;">Navigate →</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    
    // ------------------------------------------------------------
    // 5. RECURSIVE LOGIC / OUTCOMES (Available on ALL levels)
    // ------------------------------------------------------------
    html += `
        <div class="card-section" style="margin-top:25px; border-top: 2px solid var(--accent); padding-top:15px; background: rgba(56, 189, 248, 0.03);">
            <label class="modal-section-label">🎯 ${levelLabel.toUpperCase()} EXIT LOGIC</label>
            <div id="step-outcomes-list" style="margin-top:8px;">
                ${renderStepOutcomes(targetId, data)} 
            </div>
            <div class="search-map-container" style="margin-top:10px;">
                <input type="text" class="modal-input tiny outcome-search-input" placeholder="+ Add path from this ${levelLabel}..." 
                       onfocus="OL.filterOutcomeSearch('${targetId}', '${targetId}', '')"
                       oninput="OL.filterOutcomeSearch('${targetId}', '${targetId}', this.value)">
                <div id="outcome-results" class="search-results-overlay"></div>
            </div>
        </div>`;

    // ------------------------------------------------------------
    // 6. PRICING VARIABLES (For Technical Resources)
    // ------------------------------------------------------------
    if (isTechnicalResource) {
        const relevantVars = Object.entries(state.master.rates?.variables || {}).filter(([_, v]) => 
            String(v.applyTo).toLowerCase() === String(data.type).toLowerCase()
        );
        html += `
            <div class="card-section" style="margin-top:25px; padding-top:15px; border-top:1px solid rgba(255,255,255,0.1);">
                <label class="modal-section-label">💰 Pricing Variables</label>
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-top:10px;">
                    ${relevantVars.map(([varKey, v]) => `
                        <div class="modal-column">
                            <label class="tiny muted" style="font-size:8px;">${esc(v.label)}</label>
                            <input type="number" class="modal-input tiny" style="width:100%;"
                                   value="${num(data.data?.[varKey])}" 
                                   oninput="OL.updateResourcePricingData('${data.id}', '${varKey}', this.value)">
                        </div>`).join("")}
                </div>
            </div>`;
    }

    html += `</div>`;
   
    contentWrapper.innerHTML = html;

    if (!panel.querySelector('.sidebar-resizer')) {
        OL.initSideResizers();
    }

    if (state.viewMode === 'global') {
        const isVault = location.hash.includes('vault');
        const canvas = document.getElementById('fs-canvas');
        if (canvas) {
            canvas.innerHTML = renderGlobalCanvas(isVault);
            
            // 🚀 THE REDRAW TRIGGER: 
            // If we are looking at a Workflow or Resource, redraw tiers
            if (state.focusedWorkflowId) {
                setTimeout(() => OL.drawLevel2LogicLines(state.focusedWorkflowId), 50);
            }
            if (state.focusedResourceId) {
                setTimeout(() => OL.drawVerticalLogicLines(state.focusedResourceId), 50);
            }
        }
    }
};

// 🔓 Strip the resource link
OL.unassignStep = function(stepId, resourceId) {
    const step = OL.getResourceById(stepId);
    if (step) {
        delete step.resourceLinkId; // Remove the link
        console.log(`🔓 Step ${stepId} is now loose.`);
        OL.persist();
        
        // Refresh both the inspector and the map
        OL.loadInspector(stepId, state.activeInspectorParentId); 
        OL.refreshMap(); 
    }
};

// 🔗 Prompt to pick a resource for a loose step
OL.openResourcePickerForStep = function(stepId) {
    // This would trigger your existing resource selection modal
    OL.promptInsertResourceInWorkflow(state.activeInspectorParentId, 0, false, stepId);
};

OL.ensureInspectorSkeleton = function() {
    const panel = document.getElementById('inspector-panel');
    if (!panel) return null;

    let contentWrapper = panel.querySelector('.inspector-scroll-content');
    
    if (!contentWrapper) {
        // Nuke and rebuild the skeleton to ensure order is correct
        panel.innerHTML = `
            <div class="sidebar-resizer right-side-handle"></div>
            <div class="inspector-scroll-content"></div>
        `;
        contentWrapper = panel.querySelector('.inspector-scroll-content');
        
        // 🚀 BIND IMMEDIATELY: Don't wait for a timeout
        OL.initSideResizers(); 
    }
    return contentWrapper;
};

OL.initSideResizers = function() {
    const resizablePanes = [
        { id: 'pane-drawer', side: 'left', storageKey: 'ol_toolbox_width' },
        { id: 'inspector-panel', side: 'right', storageKey: 'ol_inspector_width' }
    ];

    resizablePanes.forEach(config => {
        const pane = document.getElementById(config.id);
        if (!pane) return;

        // 🚀 THE FIX: If resizer already exists, don't delete/re-add it
        if (pane.querySelector('.sidebar-resizer')) return;

        const resizer = document.createElement('div');
        resizer.className = 'sidebar-resizer';
        // We use prepend so it stays at the top of the DOM inside the sidebar
        pane.prepend(resizer); 

        let startX, startWidth;

        resizer.addEventListener('mousedown', (e) => {
            startX = e.clientX;
            // Get current computed width
            startWidth = pane.offsetWidth;
            
            resizer.classList.add('is-dragging');
            document.body.classList.add('resizing-active'); // For cursor locking

            const doDrag = (e) => {
                let newWidth = config.side === 'left' 
                    ? startWidth + (e.clientX - startX)
                    : startWidth + (startX - e.clientX);
                
                if (newWidth > 250 && newWidth < (window.innerWidth * 0.7)) {
                    // 🚀 THE FIX: Set BOTH width and flex-basis
                    const widthStr = `${newWidth}px`;
                    pane.style.width = widthStr;
                    pane.style.minWidth = widthStr;
                    pane.style.flex = `0 0 ${widthStr}`;
                }
            };

            const stopDrag = () => {
                resizer.classList.remove('is-dragging');
                document.body.classList.remove('resizing-active');
                document.removeEventListener('mousemove', doDrag);
                document.removeEventListener('mouseup', stopDrag);
                localStorage.setItem(config.storageKey, pane.style.width);
            };

            document.addEventListener('mousemove', doDrag);
            document.addEventListener('mouseup', stopDrag);
        });
    });
};
// Call this once on app load
window.addEventListener('DOMContentLoaded', OL.initSideResizers);

OL.applyCanvasHighlight = function() {
    // 1. Remove highlight from whatever was selected before
    document.querySelectorAll('.is-inspecting, .parent-active').forEach(el => {
        el.classList.remove('is-inspecting', 'parent-active');
    });

    // 2. Highlight the new selection
    // Note: We use the ID patterns from your Tier 1, 2, and 3 nodes
    const targetId = state.activeInspectorResId;
    const parentId = state.activeInspectorParentId;

    const targetEl = document.getElementById(`l1-node-${targetId}`) || 
                     document.getElementById(`l2-node-${targetId}`) || 
                     document.getElementById(`step-node-${targetId}`);
    
    if (targetEl) {
        targetEl.classList.add('is-inspecting');
        console.log("🔦 Surgically highlighted node:", targetId);
    }

    // 3. Highlight the parent (the blue border)
    const parentEl = document.getElementById(`l1-node-${parentId}`) || 
                     document.getElementById(`l2-node-${parentId}`);
    
    if (parentEl) {
        parentEl.classList.add('parent-active');
    }
};

OL.syncCanvasHighlights = function() {
    // 1. Clear all existing highlights on the map
    document.querySelectorAll('.is-inspecting, .parent-active').forEach(el => {
        el.classList.remove('is-inspecting', 'parent-active');
    });

    // 2. Apply to the new Active Resource/Step
    const targetNode = document.getElementById(`l1-node-${state.activeInspectorResId}`) || 
                       document.getElementById(`l2-node-${state.activeInspectorResId}`) ||
                       document.getElementById(`step-node-${state.activeInspectorResId}`);
    
    if (targetNode) targetNode.classList.add('is-inspecting');

    // 3. Apply to the Parent if we are looking at a step
    if (state.activeInspectorParentId) {
        const parentNode = document.getElementById(`l1-node-${state.activeInspectorParentId}`) || 
                           document.getElementById(`l2-node-${state.activeInspectorParentId}`);
        if (parentNode) parentNode.classList.add('parent-active');
    }
};

OL.scrollToCanvasNode = function(id) {
    // 1. Try to find the node on the L1 Macro Map or L2 Spine
    const node = document.getElementById(`l1-node-${id}`) || 
                 document.getElementById(`l2-node-${id}`) || 
                 document.getElementById(`step-node-${id}`);
    
    const canvas = document.getElementById('fs-canvas');
    
    if (node && canvas) {
        node.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
            inline: 'center'
        });
        
        // 💫 Visual Polish: Brief "Look at me" flash
        node.style.transition = 'none';
        node.style.boxShadow = '0 0 30px var(--accent)';
        setTimeout(() => {
            node.style.transition = 'all 0.5s ease';
            node.style.boxShadow = '';
        }, 500);
    }
};

OL.handleInspectorStepDrop = function(e, resId, targetIdx) {
    e.preventDefault();
    const dragIdx = parseInt(e.dataTransfer.getData('dragIdx'));
    if (dragIdx === targetIdx) return;

    const res = OL.getResourceById(resId);
    if (!res || !res.steps) return;

    // Move the item
    const [movedStep] = res.steps.splice(dragIdx, 1);
    res.steps.splice(targetIdx, 0, movedStep);

    // Save and Re-render
    OL.persist();
    OL.loadInspector(resId); // Refresh the list
    renderGlobalVisualizer(location.hash.includes('vault')); // Sync the canvas
};

OL.promptQuickCreateAsset = async function(parentResId, stepId) {
    const assetName = prompt("Enter Name for New Asset:", "New Resource");
    if (!assetName) return;

    // Build Type Options from your registry
    const types = state.master.resourceTypes || [];
    const typeList = types.map((t, i) => `${i + 1}. ${t.type}`).join('\n');
    const typeChoice = prompt(`Select Type (Enter Number):\n${typeList}`, "1");
    
    const selectedType = types[parseInt(typeChoice) - 1] || types[0];

    // 1. Create the new Resource in the Global Library
    const newAsset = {
        id: uid(),
        name: assetName,
        type: selectedType.type,
        archetype: 'Base',
        createdDate: new Date().toISOString(),
        data: {}
    };

    if (!state.master.resources) state.master.resources = [];
    state.master.resources.push(newAsset);

    // 2. Link it to the Step
    const parentRes = OL.getResourceById(parentResId);
    const step = parentRes.steps.find(s => String(s.id) === String(stepId));
    
    if (step) {
        if (!step.links) step.links = [];
        step.links.push({
            id: newAsset.id,
            name: newAsset.name,
            type: newAsset.type
        });
    }

    // 3. Persist and Refresh
    OL.persist();
    OL.loadInspector(stepId, parentResId); // Refresh Inspector
    renderGlobalVisualizer(location.hash.includes('vault'));
    
    console.log(`✅ Created and Linked: ${newAsset.name}`);
};

OL.filterAppSearch = function(resId, stepId, query) {
    const resultsOverlay = document.getElementById('app-search-results');
    if (!resultsOverlay) return;
    
    const q = (query || "").toLowerCase();
    const client = getActiveClient();
    
    // 🚀 THE FIX: Filter only localApps
    const localApps = client?.projectData?.localApps || [];
    
    const matches = localApps.filter(a => a.name.toLowerCase().includes(q));

    resultsOverlay.innerHTML = matches.map(a => `
        <div class="search-result-item" 
            onmousedown="event.stopPropagation(); OL.updateAtomicStep('${resId}', '${stepId}', 'appId', '${a.id}')">
            <span style="margin-right:8px;">📱</span> ${esc(a.name)}
        </div>
    `).join('') || `<div class="p-10 tiny muted">No local apps found.</div>`;
};

OL.updateResourceMetadata = function(resId, field, value) {
    const res = OL.getResourceById(resId);
    if (!res) return;

    const cleanValue = (typeof value === 'string') ? value.trim() : value;
    
    // 1. Only update if the value actually changed
    if (res[field] === cleanValue) return;

    // 🛡️ Use the restored Global Mutator
    OL.updateAndSync(() => {
        res[field] = cleanValue;
        console.log(`📡 [updateAndSync] Metadata ${field} -> ${cleanValue}`);

        // 2. THE SURGICAL UI FIX: 
        // We do this inside the mutation block so it's protected by the shield
        
        // Update the card title on the canvas
        const canvasCardTitle = document.querySelector(`#l1-node-${resId} .bold, #l2-node-${resId} .bold`);
        if (canvasCardTitle && field === 'name') {
            canvasCardTitle.innerText = cleanValue;
        }

        // Update sidebar items
        const sidebarItem = document.querySelector(`.draggable-workflow-item[onclick*="${resId}"] span:last-child`);
        if (sidebarItem && (field === 'name' || field === 'title')) {
            sidebarItem.innerText = cleanValue;
        }
    });

    // Note: Because updateAndSync handles persist(), we don't call it here.
    // Because state.activeInspectorResId is set, OL.sync will skip buildLayout().
};

OL.updateResourceType = function(resId, newType) {
    const res = OL.getResourceById(resId);
    if (res) {
        res.type = newType;
        console.log(`🏷️ Updated ${res.name} to Type: ${newType}`);
        
        OL.persist();
        // Full refresh to update sidebar groups and icons
        renderGlobalVisualizer(location.hash.includes('vault'));
    }
};

OL.clearInspector = function() {
    state.activeInspectorResId = null;
    const panel = document.getElementById('inspector-panel');
    if (panel) panel.innerHTML = `<div class="empty-inspector tiny muted">Select a node to inspect</div>`;
};

// LEVEL 1: Workflows in Stages
window.renderWorkflowsInStage = function(stageId, isVaultMode) {
    const client = getActiveClient();
    const sourceResources = isVaultMode ? (state.master.resources || []) : (client?.projectData?.localResources || []);
    
    const matchedWorkflows = sourceResources
        .filter(r => String(r.stageId) === String(stageId))
        .sort((a, b) => (a.mapOrder || 0) - (b.mapOrder || 0));

    // 🚀 UX FIX: Use the 'grid-drop-target' classes even in the empty state
    if (matchedWorkflows.length === 0) {
        return `<div class="tiny muted italic" style="opacity:0.3; padding: 20px; text-align:center; border: 1px dashed rgba(255,255,255,0.05); border-radius: 8px;">
            Drop Workflows Here
        </div>`;
    }

    return matchedWorkflows.map((res, idx) => {
        return `
        <div class="workflow-block-card l1-workflow-node vis-node" 
             id="l1-node-${res.id}"
             draggable="true" 
             onmousedown="event.stopPropagation(); OL.loadInspector('${res.id}')"
             ondragstart="event.stopPropagation(); OL.handleDragStart(event, '${res.id}', 'workflow', ${idx})"
             ondblclick="OL.drillDownIntoWorkflow('${res.id}')">
            
            <div class="bold" style="font-size: 12px; color: var(--accent);">${esc(res.name)}</div>
            
            ${res.description ? `
                <div class="tiny" style="color: var(--text-muted); font-style: italic; margin-top: 4px; opacity: 0.8; line-height: 1.2;">
                    ${esc(res.description)}
                </div>
            ` : ''}
            
            <div class="tiny muted" style="margin-top: 8px; font-size: 9px; opacity: 0.5; display: flex; justify-content: space-between;">
                <span>📝 ${(res.steps || []).length} Resources</span>
                <span class="muted">Order: ${res.mapOrder || 0}</span>
            </div>
        </div>
    `}).join('');
};

// LEVEL 2: Resources in Workflow Lanes
function renderResourcesInWorkflowLane(workflowId, laneId) {
    const workflow = OL.getResourceById(workflowId);
    if (!workflow || !workflow.steps) return '';

    // Filter items in this lane (could be a Resource or a loose Step)
    const items = workflow.steps
        .filter(s => String(s.gridLane) === String(laneId))
        .sort((a, b) => (a.mapOrder || 0) - (b.mapOrder || 0));

    return items.map((item, idx) => {
        // 🔍 Check if this step is a "Resource Container" or an "Atomic Step"
        const linkedRes = item.resourceLinkId ? OL.getResourceById(item.resourceLinkId) : null;
        
        // If it's a resource, it might have nested steps of its own (L3)
        const nestedStepCount = linkedRes?.steps?.length || 0;
        
        const displayName = linkedRes ? linkedRes.name : (item.name || "Loose Step");
        const displayIcon = linkedRes ? OL.getRegistryIcon(linkedRes.type) : "✏️";
        const isLoose = !linkedRes;

        return `
            <div class="workflow-block-card l2-node ${isLoose ? 'is-loose-step' : 'is-resource'}" 
                 draggable="true" 
                 ondragstart="event.stopPropagation(); OL.handleDragStart(event, '${item.id}', 'step', ${idx})"
                 onclick="event.stopPropagation(); OL.loadInspector('${linkedRes?.id || item.id}')"
                 style="${isLoose ? 'border-left: 4px solid var(--vault-gold) !important;' : 'border-left: 4px solid var(--accent) !important;'}">
                
                <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                    <div style="display:flex; align-items:center; gap:8px;">
                        <span>${displayIcon}</span>
                        <div class="bold accent">${esc(displayName)}</div>
                    </div>
                    <span class="tiny muted">#${idx + 1}</span>
                </div>

                ${!isLoose && nestedStepCount > 0 ? `
                    <div class="tiny" style="margin-top:8px; color:var(--accent); opacity:0.8;">
                        📋 Contains ${nestedStepCount} Sub-Steps (L3)
                    </div>
                ` : ''}

                ${isLoose ? `
                    <div class="connect-resource-bridge" 
                         style="margin-top:10px; padding:6px; background:rgba(255,191,0,0.05); border:1px dashed var(--vault-gold); border-radius:4px; text-align:center; cursor:pointer;"
                         onclick="event.stopPropagation(); OL.openResourcePickerForStep('${item.id}')">
                        <span class="tiny" style="color:var(--vault-gold); font-size:9px; font-weight:bold;">
                            🔗 WRAP IN RESOURCE
                        </span>
                    </div>
                ` : ''}
            </div>
        `;
    }).join('');
}

// LEVEL 3: Render Steps in Resources

window.renderLevel3Canvas = function(resourceId) {
    // ⚡ THE GHOST KILLER: Ensure L2 is nulled when entering L3
    state.focusedResourceId = resourceId;
    state.focusedWorkflowId = null; 
    
    console.log("📍 View Context Set: L3 Mode (L2 Cleared)");

    const res = OL.getResourceById(resourceId);
    if (!res) return `<div class="p-20 muted text-center">Resource not found</div>`;

    // 🚀 FIX 1: Change to Flexbox, remove inline-block, and kill the fixed padding
    let html = `
    <div id="l3-canvas-wrapper" style="display: flex; flex-direction: row; gap: 40px; justify-content: center; align-items: flex-start; padding: 40px; min-height: 100%;">
        <svg id="vis-links-layer" style="position: absolute; top:0; left:0; width:100%; height:100%; pointer-events: none; z-index: 1; overflow: visible;"></svg>`;

    const groups = [
        { type: 'Trigger', label: '⚡ ENTRY TRIGGERS', color: '#ffbf00' },
        { type: 'Action', label: '🎬 SEQUENCE ACTIONS', color: 'var(--accent)' }
    ];
    
    html += groups.map(group => {
        const steps = (res.steps || [])
            .filter(s => String(s.type || 'Action').toLowerCase() === String(group.type).toLowerCase())
            .sort((a, b) => (a.mapOrder || 0) - (b.mapOrder || 0));

        return `
            <div class="stage-container" style="flex-shrink: 0;">
                <div class="stage-header-row" style="margin-bottom: 20px; text-align: center;">
                    <span class="stage-name" style="color:${group.color}; font-weight: bold; letter-spacing: 1px;">${group.label}</span>
                </div>
                
                <div class="stage-workflow-stream grid-drop-target" 
                    data-section-id="${group.type}"
                    style="display: flex; flex-direction: column; gap: 15px; min-height: 200px; border: 1px dashed rgba(255,255,255,0.1); border-radius: 8px; padding: 10px;"
                    ondragover="OL.handleUniversalDragOver(event)" 
                    ondragleave="OL.handleUniversalDragLeave(event)"
                    ondrop="OL.handleUniversalDrop(event, '${group.type}')">
                    
                    ${steps.map((step, idx) => {
                        const isTrigger = step.type === 'Trigger';
                        const typeIcon = isTrigger ? "⚡" : "🎬";
                        
                        // 📱 Resolve Application Icon
                        const client = getActiveClient();
                        const allApps = [...(state.master.apps || []), ...(client?.projectData?.localApps || [])];
                        const linkedApp = allApps.find(a => String(a.id) === String(step.appId));
                        const appIconHtml = linkedApp ? `<span title="${esc(linkedApp.name)}" style="font-size:10px; margin-left:5px; opacity:0.8;">📱</span>` : '';

                        // 🔗 Generate Asset Icons
                        const links = step.links || [];
                        const linkedAssetsHtml = links.map(link => {
                            const assetIcon = OL.getRegistryIcon(link.type);
                            return `<span class="pill tiny soft" style="font-size: 10px; padding: 1px 4px; background: rgba(255,255,255,0.1); 
                            border: 1px solid rgba(255,255,255,0.05);">${assetIcon}</span>`;
                        }).join('');

                        return `
                            <div class="workflow-block-card" 
                                id="step-node-${step.id}" 
                                draggable="true" 
                                style="position: relative; width: 100%; min-height: 85px; display: flex; flex-direction: column; padding: 12px; cursor: pointer; z-index: 5;"
                                onmousedown="event.stopPropagation(); OL.loadInspector('${step.id}', '${resourceId}')"
                                ondragstart="event.stopPropagation(); OL.handleDragStart(event, '${step.id}', 'step', ${idx})">
                                <div class="card-delete-hitbox" 
                                    style="position: absolute; top: 0; right: 0; width: 30px; height: 30px; 
                                            display: flex; align-items: center; justify-content: center; 
                                            z-index: 999; pointer-events: auto;"
                                    onmousedown="event.stopPropagation(); OL.removeStepFromCanvas('${resourceId}', '${step.id}')">
                                    
                                    <span class="delete-icon" 
                                        style="font-size: 16px; color: rgba(255,255,255,0.4); transition: color 0.2s, transform 0.2s;"
                                        onmouseover="this.style.color='#ef4444'; this.style.transform='scale(1.2)';"
                                        onmouseout="this.style.color='rgba(255,255,255,0.4)'; this.style.transform='scale(1)';"
                                        title="Delete Step">
                                        &times;
                                    </span>
                                </div>
                                
                                <div style="display:flex; align-items:center; margin-bottom:8px; pointer-events: none;">
                                    <span class="pill tiny ${isTrigger ? 'accent' : 'soft'}" style="font-size:9px; padding:2px 8px; display:flex; align-items:center; gap:4px;">
                                        <span style="font-size:10px;">${typeIcon}</span> ${esc(step.type).toUpperCase()}
                                    </span>
                                </div>

                                <div class="bold accent" style="line-height:1.2; font-size: 13px; display:flex; align-items:center; flex-wrap:wrap; pointer-events: none;">
                                    ${esc(step.name || "Untitled")} ${appIconHtml}
                                </div>

                                <div class="node-linked-assets" style="display: flex; gap: 4px; flex-wrap: wrap; margin-top: 8px; min-height: 12px; pointer-events: none;">
                                    ${linkedAssetsHtml}
                                </div>
                                
                                <div class="tiny muted" style="font-size:9px; margin-top:auto; padding-top:8px; opacity:0.6; pointer-events: none;">
                                    ${step.assigneeName ? `👤 ${esc(step.assigneeName)}` : '👥 Unassigned'}
                                </div>
                            </div>`;
                    }).join('')}
                </div>
            </div>`;
    }).join('');

    html += `</div>`;
    
    setTimeout(() => OL.drawVerticalLogicLines(resourceId), 100);
    return html;
};

OL.drawVerticalLogicLines = function(resId) {
    const svg = document.getElementById('vis-links-layer');
    const wrapper = document.getElementById('l3-canvas-wrapper');
    if (!svg || !wrapper) return;
    
    const res = OL.getResourceById(resId);
    const steps = res.steps || [];
    const wrapperRect = wrapper.getBoundingClientRect();

    let pathsHtml = "";

    steps.forEach((step, sIdx) => {
        const outcomes = step.outcomes || [];
        const totalOutcomes = outcomes.length;
        
        // 🚀 THE WIRING HARNESS: Spread the start points vertically
        const portSpacing = 12; 
        const startYBase = -((totalOutcomes - 1) * portSpacing) / 2;

        outcomes.forEach((oc, oIdx) => {
            const sourceEl = document.getElementById(`step-node-${step.id}`);
            if (!sourceEl) return;
            
            const s = sourceEl.getBoundingClientRect();
            const x1 = s.left - wrapperRect.left;
            const y1 = (s.top + s.height / 2) - wrapperRect.top + (startYBase + (oIdx * portSpacing));

            let isExternal = false;
            let targetId = null;
            let externalName = "";

            if (oc.action?.startsWith('jump_step_')) {
                targetId = oc.action.replace('jump_step_', '');
            } else if (oc.action?.startsWith('jump_res_')) {
                isExternal = true;
                targetId = oc.action.replace('jump_res_', '');
                const extRes = OL.getResourceById(targetId);
                externalName = extRes ? extRes.name : "External Resource";
            } else if (oc.action === 'next') {
                targetId = steps[sIdx + 1]?.id;
            }

            const targetEl = document.getElementById(`step-node-${targetId}`);

            if (!isExternal && targetEl) {
                // --- 🔵 INTERNAL JUMP (Fanning Curves) ---
                const t = targetEl.getBoundingClientRect();
                const x2 = t.left - wrapperRect.left;
                const y2 = (t.top + t.height / 2) - wrapperRect.top;
                
                // 🚀 THE SWING: Fan out horizontally based on index and distance
                const dist = Math.abs(y2 - y1);
                const curveWidth = 30 + (oIdx * 20) + (dist * 0.05); 
                
                const d = `M ${x1} ${y1} C ${x1 - curveWidth} ${y1}, ${x2 - curveWidth} ${y2}, ${x2} ${y2}`;
                const color = oc.condition ? "#fbbf24" : "#38bdf8";

                // Draw path
                pathsHtml += `<path d="${d}" fill="none" stroke="${color}" stroke-width="2" opacity="0.4" marker-end="url(#arrowhead-l3)" />`;

                // Add Inline Condition Label
                if (oc.condition) {
                    const midY = (y1 + y2) / 2;
                    const midX = x1 - (curveWidth * 0.75);
                    pathsHtml += `
                        <g style="pointer-events: none;">
                            <rect x="${midX - 40}" y="${midY - 9}" width="80" height="16" rx="4" fill="#050816" stroke="${color}" stroke-width="1" />
                            <text x="${midX}" y="${midY + 3}" text-anchor="middle" fill="${color}" style="font-size: 8px; font-weight: bold; text-transform: uppercase;">
                                IF: ${esc(oc.condition.substring(0, 15))}
                            </text>
                        </g>`;
                }
            } 
            else if (isExternal) {
                // --- 🟢 EXTERNAL EXIT (Clickable Rocket Links) ---
                // Stagger purely for visibility
                const x2 = x1 - (120 + (oIdx * 30)); 
                const y2 = y1 - (20 + (oIdx * 25)); 
                
                const d = `M ${x1} ${y1} Q ${x1 - 40} ${y1}, ${x2} ${y2}`;
                const displayLabel = (oc.condition ? `IF ${oc.condition.toUpperCase()}: ` : "") + externalName;
                
                // 🚀 POINTER-EVENTS: AUTO is required to make SVG groups clickable
                pathsHtml += `
                    <g class="external-exit-link" style="cursor: pointer; pointer-events: auto !important;" 
                       onclick="event.stopPropagation(); OL.openResourceModal('${targetId}')">
                        <path d="${d}" fill="none" stroke="#10b981" stroke-width="2" stroke-dasharray="3,3" opacity="0.8" marker-end="url(#arrowhead-external)" />
                        <rect x="${x2 - 160}" y="${y2 - 12}" width="160" height="24" rx="6" fill="#0b1020" stroke="#10b981" stroke-width="1.5" class="exit-label-bg" />
                        <text x="${x2 - 10}" y="${y2 + 4}" text-anchor="end" fill="#10b981" style="font-size: 9px; font-weight: 800; font-family: var(--font-main);">
                            🚀 ${esc(displayLabel.substring(0, 25))}
                        </text>
                    </g>`;
            }
        });
    });

    svg.innerHTML = `
        <defs>
            <marker id="arrowhead-l3" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(255,255,255,0.4)" /></marker>
            <marker id="arrowhead-external" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#10b981" /></marker>
        </defs>
        ${pathsHtml}`;
};

// --- NAVIGATION & STATE ---

OL.drillDownIntoWorkflow = function(resId) {
    console.log("📂 Drilling into Workflow (L2):", resId);
    
    state.focusedWorkflowId = resId;
    state.focusedResourceId = null; 
    state.lastSearchQuery = ""; 

    // 💾 Persist Level 2 state for refresh
    sessionStorage.setItem('active_workflow_id', resId);
    
    // 🧹 Clean up Level 3 state to ensure we start at the top of the workflow
    sessionStorage.removeItem('active_resource_id');

    renderGlobalVisualizer(location.hash.includes('vault'));
};

OL.drillIntoResourceMechanics = function(resId) { 
    console.log("🏭 Entering Step Factory (L3) for:", resId);
    
    // 1. Update State & Memory
    state.focusedResourceId = resId;
    state.viewMode = 'focus'; // Ensure we aren't in Macro mode
    sessionStorage.setItem('active_resource_id', resId);

    // 2. 🚀 THE CRITICAL STEP: Call the orchestrator
    // This function handles the sidebar (toolboxHtml), header, AND canvas
    const isVaultMode = window.location.hash.includes('vault');
    window.renderGlobalVisualizer(isVaultMode);
    
    // 3. Focus the inspector on the resource we just entered
    OL.loadInspector(resId);
};

OL.exitToWorkflow = function() {
    state.focusedResourceId = null;
    sessionStorage.removeItem('active_resource_id'); // 🧹 Clear Resource level
    renderGlobalVisualizer(location.hash.includes('vault'));
};

OL.exitToLifecycle = function() {
    state.focusedWorkflowId = null;
    state.focusedResourceId = null;
    sessionStorage.removeItem('active_workflow_id'); // 🧹 Clear Workflow level
    sessionStorage.removeItem('active_resource_id'); // 🧹 Clear Resource level
    state.lastSearchQuery = ""; 
    renderGlobalVisualizer(location.hash.includes('vault'));
};

// Update the filter function to save the query to state
const originalFilter = OL.filterToolbox;
state.activeSidebarType = 'All';

OL.setSidebarTypeFilter = function(type, el) {
    // UI Update: Toggle active class on pills
    const parent = el.parentElement;
    parent.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
    el.classList.add('active');

    // State Update
    state.activeSidebarType = type;

    // Trigger the existing filter logic (respects search query + new type filter)
    const searchVal = document.getElementById('resource-toolbox-search')?.value || "";
    OL.filterToolbox(searchVal);
};

OL.filterToolbox = function(query) {
    state.isFiltering = true; 
    state.lastSearchQuery = query; 
    const q = query.toLowerCase();
    
    const listContainer = document.getElementById('toolbox-list') || 
                          document.getElementById('resource-toolbox-list');
    
    if (!listContainer) return;

    // 1. Filter the actual cards
    const items = listContainer.querySelectorAll('.draggable-workflow-item');
    let totalVisibleCount = 0;

    items.forEach(item => {
        const name = item.getAttribute('data-name') || item.innerText.toLowerCase();
        const parentGroup = item.closest('.sidebar-type-group');
        const groupType = parentGroup?.getAttribute('data-group-type');

        const matchesSearch = name.includes(q);
        const matchesType = (state.activeSidebarType === 'All' || state.activeSidebarType === groupType);

        if (matchesSearch && matchesType) {
            item.style.display = "flex";
            totalVisibleCount++;
        } else {
            item.style.display = "none";
        }
    });

    // 2. 🚀 NEW: Clean up the Group Containers
    // If a group (e.g., "Forms") has 0 matching items, hide the whole group/label
    listContainer.querySelectorAll('.sidebar-type-group').forEach(group => {
        const hasVisible = [...group.querySelectorAll('.draggable-workflow-item')].some(i => i.style.display !== 'none');
        group.style.display = hasVisible ? "block" : "none";
    });

    // 3. Handle the global empty message
    const emptyMsg = document.getElementById('no-results-msg') || 
                     document.getElementById('no-resource-results-msg');
    if (emptyMsg) {
        emptyMsg.style.display = (totalVisibleCount === 0 && q !== "") ? "block" : "none";
    }

    console.log(`✅ Filtered: ${totalVisibleCount} items visible.`);
};

// Ensure both levels call the same logic
OL.filterResourceToolbox = OL.filterToolbox;

// --- DRAG & DROP ORCHESTRATION --DRAG OVER CANVAS AND DROPZONE HIGHLIGHT //

OL.prepFactoryDrag = function(e, stepType) {
    // 1. Get values based on which builder was used
    let verb, object;
    if (stepType === 'Trigger') {
        verb = document.getElementById('trigger-verb').value;
        object = document.getElementById('trigger-object').value;
    } else {
        verb = document.getElementById('builder-verb').value;
        object = document.getElementById('builder-object').value;
    }

    const fullName = `${verb} ${object}`;

    // 2. Set the data for our unified handleUniversalDrop
    e.dataTransfer.setData("itemType", "factory");
    e.dataTransfer.setData("moveId", `new-atomic-${Date.now()}`); // Unique ID for a new step
    e.dataTransfer.setData("stepName", fullName);
    e.dataTransfer.setData("stepType", stepType);

    // 3. UI feedback
    e.currentTarget.classList.add('dragging');
    
    // Hide inspector to clear the drop zones
    document.querySelector('.three-pane-layout')?.classList.add('no-inspector');
};

OL.handleDragStart = function(e, id, type, index) {
    // 1. Basic Data
    e.dataTransfer.setData("moveId", id);
    e.dataTransfer.setData("itemType", type);
    e.dataTransfer.setData("dragIdx", index);
    
    // 🚀 2. FACTORY LOGIC: If dragging a builder item, grab the name from dropdowns
    if (type === 'factory-trigger' || type === 'factory-action') {
        const isTrigger = type === 'factory-trigger';
        const verb = document.getElementById(isTrigger ? 'trigger-verb' : 'builder-verb')?.value;
        const obj = document.getElementById(isTrigger ? 'trigger-object' : 'builder-object')?.value;
        
        const finalName = isTrigger ? `${obj} ${verb}` : `${verb} ${obj}`;
        
        // Pass these specifically for OL.handleUniversalDrop to catch
        e.dataTransfer.setData("stepName", finalName);
        e.dataTransfer.setData("stepType", isTrigger ? 'Trigger' : 'Action');
    }

    // 3. UI Polish
    e.currentTarget.classList.add('is-dragging-source');
    
    // Fallback: If it's a sidebar item, we set a smaller drag ghost
    if (e.currentTarget.classList.contains('draggable-factory-item')) {
        e.dataTransfer.setDragImage(e.currentTarget, 20, 20);
    }
};

OL.handleUniversalDragOver = function(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    
    const container = e.currentTarget;
    container.classList.add('hovered');

    const draggingType = state.currentDraggingType;

    // 1. Find or Create the Ghost Placeholder
    let ghost = document.querySelector('.drop-placeholder');
    if (!ghost) {
        ghost = document.createElement('div');
        ghost.className = 'drop-placeholder';
    }

    // 🚀 BRANCH A: HORIZONTAL REARRANGE (STAGES)
    if (draggingType === 'stage') {
        const stageCols = [...document.querySelectorAll('.macro-stage-col')]
                          .filter(c => !c.classList.contains('is-dragging-source'));

        // Calculate based on horizontal X axis
        const afterStage = stageCols.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = e.clientX - (box.left + box.width / 2); // 🎯 Use X axis
            if (offset < 0 && offset > closest.offset) return { offset, element: child };
            return closest;
        }, { offset: Number.NEGATIVE_INFINITY }).element;

        const mainMap = document.querySelector('.global-macro-map');
        if (afterStage) {
            mainMap.insertBefore(ghost, afterStage);
            state.currentDropIndex = stageCols.indexOf(afterStage);
        } else {
            mainMap.appendChild(ghost);
            state.currentDropIndex = stageCols.length;
        }

        // Style ghost as a tall vertical divider
        ghost.style.height = "80vh";
        ghost.style.width = "40px";
        ghost.style.margin = "0 20px";
        ghost.style.display = "block";
        return; // Exit early
    }

    // 2. Identify all valid cards in this specific container
    // Add .wf-node-container to the selector list
    const cards = [...container.querySelectorAll('.wf-node-container, .workflow-block-card, .inspector-step-row')]
                .filter(c => !c.classList.contains('is-dragging-source'));

    // 3. Determine insertion point
    const afterElement = cards.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = e.clientY - (box.top + box.height / 2);
        if (offset < 0 && offset > closest.offset) return { offset, element: child };
        return closest;
    }, { offset: Number.NEGATIVE_INFINITY }).element;

    // 4. Position the ghost and save index
    if (afterElement) {
        container.insertBefore(ghost, afterElement);
        state.currentDropIndex = cards.indexOf(afterElement);
    } else {
        container.appendChild(ghost);
        state.currentDropIndex = cards.length;
    }
};

OL.handleNodeRearrange = function(e, sectionId, targetIdx, moveId) {
    const isVaultMode = location.hash.includes('vault');
    const activeParentId = state.focusedWorkflowId || state.focusedResourceId;

    // 🟢 TIER 1: Reordering Workflows across Stages
    if (!activeParentId) {
        const client = getActiveClient();
        const source = isVaultMode ? state.master.resources : client.projectData.localResources;
        const wf = source.find(r => String(r.id) === String(moveId));

        if (wf) {
            wf.stageId = sectionId; // Update the column it belongs to
            
            // Re-sort the target lane
            let siblings = source.filter(r => String(r.stageId) === String(sectionId) && String(r.id) !== String(moveId))
                                 .sort((a, b) => (a.mapOrder || 0) - (b.mapOrder || 0));
            
            siblings.splice(targetIdx, 0, wf);
            siblings.forEach((r, i) => r.mapOrder = i);
        }
    } 
    
    // 🔵 TIER 2 & 3: Reordering Steps inside a Workflow or Procedure
    else {
        const parent = OL.getResourceById(activeParentId);
        if (parent && parent.steps) {
            const oldIdx = parent.steps.findIndex(s => String(s.id) === String(moveId));
            
            if (oldIdx > -1) {
                const [item] = parent.steps.splice(oldIdx, 1);

                // Update context (Lane for L2, Type for L3)
                if (state.focusedResourceId) item.type = sectionId;
                else item.gridLane = sectionId;

                // Find items already in that specific column/type
                const sectionItems = parent.steps.filter(s => 
                    state.focusedResourceId ? s.type === sectionId : s.gridLane === sectionId
                );

                // Insert relative to the neighbors in that column
                const targetNeighbor = sectionItems[targetIdx];
                if (targetNeighbor) {
                    const absoluteInsertIdx = parent.steps.indexOf(targetNeighbor);
                    parent.steps.splice(absoluteInsertIdx, 0, item);
                } else {
                    parent.steps.push(item);
                }
                
                // Final pass to ensure mapOrder is clean
                parent.steps.forEach((s, i) => s.mapOrder = i);
            }
        }
    }
};

OL.handleUniversalDragLeave = function(e) {
    const container = e.currentTarget;
    if (!container.contains(e.relatedTarget)) {
        container.classList.remove('hovered');
        const ghost = document.querySelector('.drop-placeholder');
        if (ghost) ghost.remove();
    }
};

// --- THE MASTER DROP HANDLER ---
OL.handleUniversalDrop = async function(e, sectionId) {
    e.preventDefault();
    
    const moveId = e.dataTransfer.getData("moveId");
    const itemType = e.dataTransfer.getData("itemType"); 
    const dragIdx = parseInt(e.dataTransfer.getData("dragIdx"));
    const isVault = location.hash.includes('vault');
    const targetIdx = (state.currentDropIndex !== null) ? state.currentDropIndex : 999;

    document.querySelectorAll('.hovered').forEach(el => el.classList.remove('hovered'));
    document.querySelectorAll('.drop-placeholder').forEach(el => el.remove());

    await OL.updateAndSync(async () => {
        const client = getActiveClient();
        // 🎯 REFERENCE: Get the actual live array
        const source = isVault ? state.master.resources : client.projectData.localResources;
        const activeParentId = state.focusedWorkflowId || state.focusedResourceId;

        // --- BRANCH A: GLOBAL REARRANGE ---
        /* if (!activeParentId && itemType === 'workflow') {
            const wf = source.find(r => String(r.id) === String(moveId));
            if (wf) {
                wf.stageId = sectionId;

                // 1. Get all siblings in the target stage
                const siblings = source.filter(r => String(r.stageId) === String(sectionId));
                
                // 2. Sort by current mapOrder
                siblings.sort((a, b) => (a.mapOrder || 0) - (b.mapOrder || 0));

                // 3. Remove the moving workflow from its current sibling position
                const oldIdx = siblings.findIndex(r => String(r.id) === String(moveId));
                if (oldIdx > -1) siblings.splice(oldIdx, 1);

                // 4. Insert at the new visual target
                // If targetIdx is too high, splice handles it by pushing to end
                siblings.splice(targetIdx, 0, wf);

                // 5. 💾 PERSISTENCE KEY: Update the original objects
                siblings.forEach((r, i) => {
                    r.mapOrder = i;
                });
            }
        }*/
        // --- BRANCH A: GLOBAL REARRANGE ---
        if (!activeParentId && itemType === 'workflow') {
            const wf = source.find(r => String(r.id) === String(moveId));
            if (wf) {
                const oldStageId = wf.stageId;
                wf.stageId = sectionId;

                // 1. Get all siblings in the target stage
                let siblings = source.filter(r => String(r.stageId) === String(sectionId));
                siblings.sort((a, b) => (a.mapOrder || 0) - (b.mapOrder || 0));

                // 2. If moving within the SAME stage, we need to handle the index shift
                const isSameStage = String(oldStageId) === String(sectionId);
                const currentIdxInSiblings = siblings.findIndex(r => String(r.id) === String(moveId));

                if (isSameStage && currentIdxInSiblings !== -1) {
                    siblings.splice(currentIdxInSiblings, 1);
                } else {
                    // If coming from a different stage, remove it from its old stage siblings 
                    // (The source.find and stageId update already handles the logic, 
                    // but we ensure the target array is clean)
                    const cleanSourceIdx = siblings.findIndex(r => String(r.id) === String(moveId));
                    if (cleanSourceIdx > -1) siblings.splice(cleanSourceIdx, 1);
                }

                // 3. Insert at the new visual target
                // We use Math.min to ensure we don't go out of bounds
                const finalInsertIdx = Math.min(targetIdx, siblings.length);
                siblings.splice(finalInsertIdx, 0, wf);

                // 4. Update the original objects' mapOrder
                siblings.forEach((r, i) => {
                    r.mapOrder = i;
                });
                
                console.log(`📍 Workflow ${wf.name} moved to ${sectionId} at index ${finalInsertIdx}`);
            }
        }
        // --- BRANCH B: INTERNAL REARRANGE (Tier 2/3) ---
        else if (activeParentId) {
            const isL3Drop = (sectionId === 'Trigger' || sectionId === 'Action');
    
            const parentId = isL3Drop ? state.focusedResourceId : state.focusedWorkflowId;
            const parent = source.find(r => String(r.id) === String(parentId));
            
            if (!parent) return console.error("Drop failed: Parent not found for ID", parentId);

            // 1. Dropping a NEW item
            if (itemType.includes('factory') || itemType === 'resource' || itemType === 'workflow') {
                const stepName = e.dataTransfer.getData("stepName");
                const stepType = e.dataTransfer.getData("stepType");
                
                const isTrigger = sectionId === 'Trigger';
                const verb = document.getElementById(isTrigger ? 'trigger-verb' : 'builder-verb')?.value;
                const obj = document.getElementById(isTrigger ? 'trigger-object' : 'builder-object')?.value;

                const newStep = { 
                    id: 'step-' + Date.now(), 
                    name: stepName || (verb ? `${verb} ${obj}` : "New Step"), 
                    // 🚀 Ensure L3 (focusedResourceId) always gets the sectionId as the type
                    type: isL3Drop ? sectionId : (stepType || 'Action'),
                    gridLane: !isL3Drop ? sectionId : null,
                    resourceLinkId: (moveId === 'new' || moveId === 'factory') ? null : moveId,
                    verb: verb || null,
                    object: obj || null,
                    outcomes: [],
                    mapOrder: targetIdx
                };
                
                parent.steps.splice(targetIdx, 0, newStep);
            } 
            
            // 2. Rearranging Existing
            else if (itemType === 'step') {
                const actualDragIdx = parent.steps.findIndex(s => String(s.id) === String(moveId));
                if (actualDragIdx > -1) {
                    const [movingItem] = parent.steps.splice(actualDragIdx, 1);
                    
                    // 🚀 Update context based on which view we are in
                    if (state.focusedResourceId) {
                        movingItem.type = sectionId; // 'Trigger' or 'Action'
                    } else {
                        movingItem.gridLane = sectionId; // L2 Grid Lane ID
                    }
                    
                    parent.steps.splice(targetIdx, 0, movingItem);
                }
            }

            // 3. 💾 Normalize mapOrder for PERSISTENCE
            parent.steps.forEach((s, i) => {
                s.mapOrder = i;
            });
        }

        // --- BRANCH C: STAGE REARRANGE (Moving Columns) ---
        else if (itemType === 'stage') {
            const sourceStages = isVault ? state.master.stages : client.projectData.stages;
            const movingStage = sourceStages.find(s => String(s.id) === String(moveId));
            
            if (movingStage) {
                // 1. Remove from old position
                const oldIdx = sourceStages.findIndex(s => String(s.id) === String(moveId));
                if (oldIdx > -1) sourceStages.splice(oldIdx, 1);
                
                // 2. Insert at new target index
                // Since stages are usually a flat list, targetIdx corresponds to the column slot
                sourceStages.splice(targetIdx, 0, movingStage);
                
                // 3. Normalize the 'order' property for persistence
                sourceStages.forEach((s, i) => {
                    s.order = i;
                });
                
                console.log(`🏗️ Stage ${movingStage.name} moved to position ${targetIdx}`);
            }
        }
    });

    state.currentDropIndex = null;
    
    // Clear inspector to prevent ghosting old data
    OL.clearInspector?.();

    if (typeof window.renderGlobalVisualizer === 'function') {
        window.renderGlobalVisualizer(isVault);
    }

    if (typeof OL.closeSidebar === 'function') {
        OL.closeSidebar();
    }
    
    console.log(`✅ Drop Successful: ${itemType} -> ${sectionId}`);
};

const cleanupUI = () => {
    document.querySelectorAll('.drop-placeholder').forEach(el => el.remove());
    document.querySelectorAll('.stage-workflow-stream').forEach(el => el.style.background = "");
};

OL.closeSidebar = function() {
    console.log("🧹 Closing Sidebar & Restoring Canvas");

    const layout = document.querySelector('.three-pane-layout');
    const canvas = document.querySelector('.global-scroll-canvas');

    // 1. Remove Layout Class
    if (layout) {
        layout.classList.remove('toolbox-focused');
    }

    // 2. Update State
    state.ui.sidebarOpen = false;

    // 3. 🚀 THE ELASTIC BOUNCE
    // Use the coordinates saved during focusToolbox to snap back
    if (canvas && state.ui.lastScrollPos) {
        canvas.scrollTo({
            left: state.ui.lastScrollPos.x,
            top: state.ui.lastScrollPos.y,
            behavior: 'smooth'
        });
    }

    // 4. Force Repaint to clear the sidebar from the DOM
    const isVault = window.location.hash.includes('vault');
    window.renderGlobalVisualizer(isVault);
};

// --- UNMAPPING / TRASH LOGIC ---

OL.removeStepFromCanvas = function(resId, stepId) {
    // 1. Immediate confirmation
    if (!confirm("Delete this step?")) return;

    const res = OL.getResourceById(resId);
    if (!res) return;

    // 2. Identify and Clean Dual-Homed Triggers
    const stepToDelete = res.steps.find(s => String(s.id) === String(stepId));
    if (stepToDelete && stepToDelete.type === 'Trigger') {
        // Remove from the list view array if it exists
        res.triggers = (res.triggers || []).filter(t => t.name !== stepToDelete.name);
    }

    // 3. Remove from Steps
    res.steps = res.steps.filter(s => String(s.id) !== String(stepId));

    // 4. Persistence & UI Reset
    OL.persist();
    renderGlobalVisualizer(location.hash.includes('vault'));
    
    // Clear the inspector so it doesn't show deleted data
    const panel = document.getElementById('inspector-panel');
    if (panel) panel.innerHTML = `<div class="p-20 muted text-center">Step removed.</div>`;
    
    console.log(`🗑️ Step ${stepId} removed.`);
};

OL.handleUnifiedDelete = function(e) {
    e.preventDefault();
    e.stopPropagation();
    
    // 1. Extract IDs from the drag event
    const moveId = e.dataTransfer.getData("moveNodeId") || e.dataTransfer.getData("moveStepId");
    const resId = e.dataTransfer.getData("resId"); // Sidebar source
    const isVaultMode = location.hash.includes('vault');
    
    // Clean up UI
    e.currentTarget.classList.remove('drag-over');

    // If we are dragging from the sidebar (resId), we don't need to delete anything
    if (resId && !moveId) return;

    const actualParentId = state.focusedResourceId || state.focusedWorkflowId;

    // --- SCENARIO A: UNMAPPING FROM TIER 1 (Lifecycle) ---
    if (!actualParentId && moveId) {
        const source = isVaultMode ? state.master.resources : getActiveClient().projectData.localResources;
        const item = source.find(r => r.id === moveId);
        if (item) {
            item.stageId = null;
            item.mapOrder = null;
            console.log(`📥 Unmapped Workflow: ${item.name}`);
        }
    } 
    // --- SCENARIO B: DELETING STEPS FROM TIER 2 OR 3 ---
    else if (actualParentId && moveId) {
        const parent = OL.getResourceById(actualParentId);
        if (parent && parent.steps) {
            const originalLength = parent.steps.length;
            parent.steps = parent.steps.filter(s => s.id !== moveId);
            
            if (parent.steps.length < originalLength) {
                console.log(`🗑️ Deleted Step ${moveId} from ${actualParentId}`);
                OL.clearInspector();
            }
        }
    }

    OL.persist();
    renderGlobalVisualizer(isVaultMode);
};

OL.handleUnifiedUnmap = function(e) {
    e.preventDefault();
    const moveId = e.dataTransfer.getData("moveNodeId");
    if (!moveId) return;

    const isVault = location.hash.includes('vault');
    const res = OL.getResourceById(moveId);
    
    if (res && confirm(`Unmap "${res.name}" and return to library?`)) {
        res.stageId = null;
        res.mapOrder = null;
        OL.persist();
        renderGlobalVisualizer(isVault);
    }
};

// RESOURCE LINKING IN SIDEBAR or MODAL //

OL.openResourceLinkerForStep = function(stepId, targetType) {
    // Note: stepId is used to identify where the link will be saved
    const parentResId = state.focusedResourceId || state.activeInspectorParentId;
    
    const html = `
        <div class="modal-head">
            <div class="modal-title-text">🔗 Link ${targetType} Asset</div>
        </div>
        <div class="modal-body">
            <p class="tiny muted">Filtering library for: <b>${targetType}s</b></p>
            <div class="search-map-container">
                <input type="text" class="modal-input" placeholder="Search your ${targetType}s..." 
                       onfocus="OL.filterLinkerByType('${parentResId}', '${stepId}', '${targetType}', '')"
                       oninput="OL.filterLinkerByType('${parentResId}', '${stepId}', '${targetType}', this.value)"
                       autofocus>
                <div id="res-linker-results" class="search-results-overlay"></div>
            </div>
            <div style="margin-top: 15px; border-top: 1px solid var(--line); padding-top: 15px; display:flex; gap:10px;">
                <button class="btn tiny primary" onclick="OL.quickCreateAndLink('${stepId}', '${targetType}')">+ Create New ${targetType}</button>
                <button class="btn tiny soft" onclick="OL.closeModal()">Skip</button>
            </div>
        </div>`;
    openModal(html);
};

OL.filterLinkerByType = function(parentResId, stepId, type, query) {
    const listEl = document.getElementById("res-linker-results");
    if (!listEl) return;
    
    const q = (query || "").toLowerCase();
    const client = getActiveClient();
    
    // Filter local resources by the specific type detected in the drag
    const available = client.projectData.localResources.filter(r => 
        r.id !== parentResId && 
        r.type === type &&
        (r.name || "").toLowerCase().includes(q)
    );

    listEl.innerHTML = available.map(r => `
        <div class="search-result-item" onmousedown="OL.addResourceLinkToStep('${parentResId}', '${stepId}', '${r.id}', '${esc(r.name)}')">
            <div style="display:flex; justify-content:space-between; align-items:center; width:100%;">
                <span>${OL.getRegistryIcon(r.type)} ${esc(r.name)}</span>
                <span class="pill tiny soft">LINK</span>
            </div>
        </div>
    `).join('') || `<div class="search-result-item muted">No ${type}s found.</div>`;
};

OL.addResourceLinkToStep = function(parentResId, stepId, targetId, targetName) {
    const res = OL.getResourceById(parentResId);
    const step = res?.steps.find(s => s.id === stepId);
    const targetRes = OL.getResourceById(targetId);

    if (step && targetRes) {
        if (!step.links) step.links = [];
        if (step.links.some(l => l.id === targetId)) return alert("Already linked.");

        step.links.push({
            id: targetId,
            name: targetName,
            type: (targetRes.type || 'SOP').toLowerCase()
        });

        OL.persist();
        OL.closeModal();
        OL.loadInspector(stepId, parentResId);
    }
};

// ===========================TASK RESOURCE OVERLAP===========================

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

//======================= SCOPING AND PRICING SECTION =======================//

OL.getScopingWorkflowContext = function() {
    const workflowId = state.focusedWorkflowId;
    if (!workflowId) return null;

    const workflow = OL.getResourceById(workflowId);
    if (!workflow) return null;

    const stepCount = (workflow.steps || []).length;
    const assets = (workflow.steps || []).map(s => OL.getResourceById(s.resourceLinkId)).filter(Boolean);
    
    // Count types (e.g., 3 Emails, 2 Zaps)
    const typeCounts = assets.reduce((acc, a) => {
        acc[a.type] = (acc[a.type] || 0) + 1;
        return acc;
    }, {});

    const typeSummary = Object.entries(typeCounts)
        .map(([type, count]) => `${count} ${type}${count > 1 ? 's' : ''}`)
        .join(', ');

    return {
        name: workflow.name,
        summary: typeSummary || "No assets mapped yet",
        count: stepCount
    };
};

// 1. RENDER SCOPING SHEET TABLE
window.renderScopingSheet = function () {
    OL.registerView(renderScopingSheet);
    const container = document.getElementById("mainContent");
    const client = getActiveClient();
    const isAdmin = state.adminMode === true;
    
    if (!container || !client) return;

    // 1. INITIALIZE DATA STRUCTURES
    if (!client.projectData) client.projectData = {};
    if (!client.projectData.localResources) client.projectData.localResources = [];
    if (!client.projectData.scopingSheets) {
        client.projectData.scopingSheets = [{ id: "initial", lineItems: [] }];
    }

    const sheet = client.projectData.scopingSheets[0];
    const baseRate = client.projectData.customBaseRate || state.master.rates.baseHourlyRate || 300;
    const showUnits = !!state.ui?.showScopingUnits;
    const wfContext = OL.getScopingWorkflowContext();
    
    // 🚀 FILTER STATE INITIALIZATION
    const q = (state.scopingSearch || "").toLowerCase();
    const typeF = state.scopingTypeFilter || "All";
    const statusF = state.scopingStatusFilter || "All";
    const partyF = state.scopingPartyFilter || "All";

    // 2. ADVANCED FILTERING LOGIC
    const filteredItems = sheet.lineItems.filter(item => {
        const res = OL.getResourceById(item.resourceId);
        if (!res) return false;

        const matchesSearch = res.name.toLowerCase().includes(q) || (res.description || "").toLowerCase().includes(q);
        const matchesType = typeF === "All" || res.type === typeF;
        const matchesStatus = statusF === "All" || item.status === statusF;
        const matchesParty = partyF === "All" || item.responsibleParty === partyF;

        return matchesSearch && matchesType && matchesStatus && matchesParty;
    });

    // 3. DATA FOR DROPDOWNS (Pulled from full list so you can always see options)
    const availableTypes = [...new Set(sheet.lineItems.map(i => OL.getResourceById(i.resourceId)?.type))].filter(Boolean).sort();
    const availableParties = [...new Set(sheet.lineItems.map(i => i.responsibleParty))].filter(Boolean).sort();

    // 4. DYNAMIC ROUND GROUPING (🚀 FIXED: Now uses filteredItems)
    const roundGroups = {};
    filteredItems.forEach((item) => {
        const r = parseInt(item.round, 10) || 1;
        if (!roundGroups[r]) roundGroups[r] = [];
        roundGroups[r].push(item);
    });

    // Sort the round numbers numerically
    const sortedRoundKeys = Object.keys(roundGroups)
        .map((n) => parseInt(n, 10))
        .sort((a, b) => a - b);

    // 5. RENDER HTML
    container.innerHTML = `
    <div class="section-header">
        <div>
            <h2>📊 ${esc(client.meta.name)} Scoping Sheet</h2>
        </div>
        <div class="header-actions">
            <button class="btn small soft" onclick="OL.toggleScopingUnits()">
                ${showUnits ? "👁️ Hide Units" : "👁️ Show Units"}
            </button>
            
            ${(state.adminMode || window.location.search.includes('admin=')) ? `
                <button class="btn small soft" onclick="OL.universalCreate('SOP')">+ Create New Resource</button>
                <button class="btn primary" onclick="OL.addResourceToScope()">+ Add From Library</button>
            ` : ''}
        </div>
    </div>

    ${wfContext ? `
        <div class="workflow-context-widget" 
             style="background: rgba(56, 189, 248, 0.05); border: 1px solid rgba(56, 189, 248, 0.2); padding: 12px 15px; border-radius: 8px; margin-bottom: 25px; display: flex; align-items: center; gap: 15px;">
            <div style="font-size: 20px;">🕸️</div>
            <div style="flex: 1;">
                <div class="tiny accent bold uppercase" style="font-size: 9px;">Active Mapping Context</div>
                <div style="font-weight: bold; color: white; font-size: 14px;">${esc(wfContext.name)}</div>
                <div class="tiny muted">${wfContext.summary}</div>
            </div>
            <button class="btn tiny primary" onclick="location.hash='#/visualizer'">View Map ➔</button>
        </div>
    ` : ''}
    
    <div class="toolbar" style="display:grid; grid-template-columns: 2fr 1fr 1fr 1fr; gap:10px; margin-bottom: 20px; background: rgba(255,255,255,0.03); padding: 12px; border-radius: 8px; border: 1px solid var(--line);">
        <input type="text" id="scoping-search-input" class="modal-input tiny" 
               placeholder="Search..." value="${state.scopingSearch || ''}"
               oninput="state.scopingSearch = this.value; renderScopingSheet(); OL.refocus('scoping-search-input')">
        
        <select class="modal-input tiny" onchange="state.scopingTypeFilter = this.value; renderScopingSheet()">
            <option value="All">All Types</option>
            ${availableTypes.map(t => `<option value="${t}" ${typeF === t ? 'selected' : ''}>${t}</option>`).join('')}
        </select>

        <select class="modal-input tiny" onchange="state.scopingStatusFilter = this.value; renderScopingSheet()">
            <option value="All">All Statuses</option>
            ${['Do Now', 'Do Later', 'Done'].map(s => `<option value="${s}" ${statusF === s ? 'selected' : ''}>${s}</option>`).join('')}
        </select>

        <select class="modal-input tiny" onchange="state.scopingPartyFilter = this.value; renderScopingSheet()">
            <option value="All">All Parties</option>
            ${availableParties.map(p => `<option value="${p}" ${partyF === p ? 'selected' : ''}>${p}</option>`).join('')}
        </select>
    </div>

    <div class="scoping-grid">
        <div class="grid-row grid-header">
            <div class="col-expand">Deliverable</div>
            <div class="col-status">Status</div>
            <div class="col-team">Versions Multiplier</div>
            <div class="col-gross" style="text-align:center;">Gross</div>
            <div class="col-discount" style="text-align:center;">Disc</div> 
            <div class="col-numeric" style="text-align:right;">Net</div>
            <div class="col-actions"></div>
        </div>
    </div>

    <div class="rounds-container">
        ${sortedRoundKeys.length > 0 
            ? sortedRoundKeys.map((r) =>
                renderRoundGroup(
                    `Round ${r}`,
                    roundGroups[r], // 🚀 Now contains only filtered items for this round
                    baseRate,
                    showUnits,
                    client.meta.name,
                    r
                )
            ).join("")
            : `<div class="p-40 muted italic text-center">No items match your current filters.</div>`
        }
    </div>

    <div id="grand-totals-area"></div>
    `;

    // 💰 TRIGGER TOTALS
    // Note: Totals usually reflect the FULL project, not just filtered results. 
    // If you want totals to change with the filters, pass filteredItems here instead.
    renderGrandTotals(sheet.lineItems, baseRate);
};

// 2. RENDER ROUND GROUPS
// CHANGE THIS:
window.renderRoundGroup = function(roundName, items, baseRate, showUnits, clientName, roundNum) {
    const client = getActiveClient();
    const sheet = client.projectData.scopingSheets[0];
    
    let roundGrossValue = 0;   // 🚀 Includes EVERYTHING (Total Value)
    let billableSubtotal = 0;  // 💸 Only billable "Do Now" items

    // 1. Process items with distinct logic for Gross vs Net
    items.forEach(item => {
        const res = OL.getResourceById(item.resourceId);
        if (!res) return;

        // 🟢 ALWAYS add to Gross (Regardless of status or party)
        const itemStickerPrice = OL.calculateBaseFeeWithMultiplier(item, res);
        roundGrossValue += itemStickerPrice;

        // 🔵 ONLY add to Net if 'Do Now' AND billable party
        const isBillable = item.responsibleParty === 'Sphynx' || item.responsibleParty === 'Joint';
        if (item.status === 'Do Now' && isBillable) {
            billableSubtotal += OL.calculateRowFee(item, res);
        }
    });

    // 2. Calculate Round Discount (applied against the Billable Subtotal)
    let roundDeductionAmt = 0;
    const rKey = String(roundNum);
    
    if (sheet.roundDiscounts && sheet.roundDiscounts[rKey]) {
        const rDisc = sheet.roundDiscounts[rKey];
        const discVal = parseFloat(rDisc.value) || 0;
        
        roundDeductionAmt = (rDisc.type === '%') 
            ? Math.round(billableSubtotal * (discVal / 100)) 
            : discVal;
    }

    // 3. Final Header Calculations
    const finalRoundNet = billableSubtotal - roundDeductionAmt;
    // Total Savings = (The difference between everything's sticker price and what we are charging)
    const totalRoundSavings = roundGrossValue - finalRoundNet;

    const rows = items.map((item, idx) => renderScopingRow(item, idx, showUnits)).join("");

    return `
        <div class="round-section" style="margin-bottom: 25px; border: 1px solid var(--panel-border); border-radius: 8px; overflow: hidden;">
            <div class="grid-row round-header-row" style="background: rgba(56, 189, 248, 0.1); border-bottom: 1px solid var(--accent);">
                <div class="col-expand">
                    <strong style="color: var(--accent); text-transform: uppercase; font-size: 11px;">${esc(roundName)}</strong>
                </div>
                <div class="col-status"></div>
                <div class="col-team"></div>
                
                <div class="col-gross tiny muted bold" style="text-align:center; line-height: 1.1;">
                    $${roundGrossValue.toLocaleString()}
                </div>
                
                <div class="col-discount tiny accent bold" style="text-align:center; line-height: 1.1;">
                    -$${totalRoundSavings.toLocaleString()}
                </div>
                
                <div class="col-numeric bold" style="color: white; font-size: 12px; text-align:right; line-height: 1.1;">
                    $${finalRoundNet.toLocaleString()}
                </div>
                
                <div class="col-actions"></div>
            </div>
            <div class="round-grid">${rows}</div>
        </div>
    `;
};

// 3. RENDER SCOPING ROW / UPDATE ROW
function renderScopingRow (item, idx, showUnits) {
    const client = getActiveClient();
    
    // 1. Resolve Resource using the robust helper
    const res = OL.getResourceById(item.resourceId);
    const isAdmin = state.adminMode === true;

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
                <div class="col-gross">N/A</div>
                <div class="col-discount">—</div>
                <div class="col-numeric">$0</div>
                <div class="col-actions">
                    ${isAdmin ? `
                        <button class="card-delete-btn" style="opacity: 0.3; font-size: 16px;" onclick="OL.removeFromScopeByID('${item.id}')">×</button>
                    ` : ''}
                </div>
            </div>
        `;
    }

    // 2. Financial Calculations
    // Only "Do Now" and "Sphynx/Joint" count towards the totals
    const isBillable = item.responsibleParty === 'Sphynx' || item.responsibleParty === 'Joint';
    const isCounted = item.status === 'Do Now' && isBillable;

    const typeIcon = OL.getRegistryIcon(res.type);

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
    const multiplierHtml = `<span class="multiplier-tag">${OL.getMultiplierDisplay(item)}</span>`;

    if (mode === 'global') {
        teamLabel = '<span class="tiny muted italic">Global Item</span>';
        hoverText = "Applies to the entire project scope";
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
            teamLabel = `<span class="tiny muted">Individuals (${selectedCount})</span>`;
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

    const teamBtnAttr = isAdmin 
    ? `onclick="OL.openTeamAssignmentModal('${item.id}')" class="btn tiny ${btnClass}"` 
    : `class="btn tiny ${btnClass}" style="cursor: default; pointer-events: none; opacity: 0.9;"`;

    return `
        <div class="grid-row" style="border-bottom: 1px solid var(--line); padding: 8px 10px;">
        <div class="col-expand">
            <div class="row-title is-clickable" onclick="OL.openResourceModal('${item.id}')">
                <span style="font-size: 1.2em; line-height: 1; margin-top: 2px;">${typeIcon}</span>
                ${esc(res.name || "Manual Item")}
            </div>
            ${res.description ? `<div class="row-note">${esc(res.description)}</div>` : ""}
            ${unitsHtml}
        </div>
      
        <div class="col-status">
            <select class="tiny-select" onchange="OL.updateLineItem('${item.id}', 'status', this.value)">
            <option value="Do Now" ${item.status === "Do Now" ? "selected" : ""}>Do Now</option>
            <option value="Do Later" ${item.status === "Do Later" ? "selected" : ""}>Do Later</option>
            <option value="Don't Do" ${item.status === "Don't Do" ? "selected" : ""}>Don't Do</option>
            <option value="Done" ${item.status === "Done" ? "selected" : ""}>Done</option>
            </select>
            <select class="tiny-select" style="margin-top:4px" onchange="OL.updateLineItem('${item.id}', 'responsibleParty', this.value)">
            <option value="Sphynx" ${item.responsibleParty === "Sphynx" ? "selected" : ""}>Sphynx</option>
            <option value="${esc(client.meta.name)}" ${item.responsibleParty === client.meta.name ? "selected" : ""}>${esc(client.meta.name)}</option>
            <option value="Joint" ${item.responsibleParty === "Joint" ? "selected" : ""}>Joint</option>
            </select>
        </div>

        <div class="col-team">
            <div style="display:flex; flex-direction:column; gap:4px;" title="${esc(hoverText)}">
                <div style="display:flex; align-items:center; gap:6px;">
                    <button ${teamBtnAttr}>
                        ${btnIcon}
                    </button>
                    
                    <div class="pills-row" 
                        ${isAdmin ? `onclick="OL.openTeamAssignmentModal('${item.id}')" style="cursor:pointer;"` : `style="cursor:default;"`}>
                        ${teamLabel}
                    </div>
                </div>
                <div style="padding-left: 34px;">
                    ${multiplierHtml}
                </div>
            </div>
        </div>
        
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
            ${isAdmin ? `
                <button class="card-delete-btn" style="opacity: 0.3; font-size: 16px;" onclick="OL.removeFromScopeByID('${item.id}')">×</button>
            ` : ''}
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
    const sheet = client.projectData.scopingSheets[0];
    
    // 1. Try to find by strict ID (the li- ID)
    let item = sheet.lineItems.find(i => String(i.id) === String(itemId));

    // 2. FALLBACK: If not found, user might have passed a Resource ID
    if (!item) {
        console.warn("⚠️ li-ID not found, searching via Resource ID:", itemId);
        item = sheet.lineItems.find(i => String(i.resourceId) === String(itemId));
    }

    if (item) {
        console.log(`✅ Item Resolved. Updating ${field} to:`, value);

        if (field === 'round') {
            item.round = parseInt(value, 10) || 1;
        } else {
            item[field] = value;
        }

        // Save and Re-render
        OL.persist(); 
        window.renderScopingSheet();
    } else {
        console.error("❌ CRITICAL: Item completely missing from sheet.", itemId);
        console.log("Available Sheet Items:", sheet.lineItems);
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

OL.removeFromScope = async function(indexStr) {
    if (!confirm("Remove this item from project scope?")) return;
    
    const client = getActiveClient();
    if (!client || !client.projectData.scopingSheets) return;

    const index = parseInt(indexStr, 10);
    const sheet = client.projectData.scopingSheets[0];

    console.log(`🗑️ Attempting to remove item at index: ${index}`);

    // 🚀 THE SHIELD: Use updateAndSync to ensure Firebase saves the deletion
    await OL.updateAndSync(() => {
        if (index > -1 && index < sheet.lineItems.length) {
            const removed = sheet.lineItems.splice(index, 1);
            console.log("✅ Successfully removed item:", removed[0]);
        } else {
            console.error("❌ Removal failed: Index out of bounds", index);
        }
    });

    // Refresh the UI
    renderScopingSheet();
};

OL.removeFromScopeByID = async function(lineItemId) {
    if (!confirm("Remove this specific item from project scope?")) return;
    
    const client = getActiveClient();
    if (!client || !client.projectData.scopingSheets) return;

    const sheet = client.projectData.scopingSheets[0];

    // 🚀 THE FIX: Find the actual index of the item with this specific ID
    const actualIndex = sheet.lineItems.findIndex(i => String(i.id) === String(lineItemId));

    if (actualIndex > -1) {
        console.log(`🗑️ Removing specific item ID: ${lineItemId} found at database index: ${actualIndex}`);
        
        await OL.updateAndSync(() => {
            sheet.lineItems.splice(actualIndex, 1);
        });

        // 🔄 Surgical UI Update
        renderScopingSheet();
    } else {
        console.error("❌ Could not find item ID in database:", lineItemId);
        alert("Error: Item not found in database. Please refresh.");
    }
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
    return `<span class="text-dim">1.00x</span>`;
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
  const isIncremented = additionalMembers > 0;
  const color = isIncremented ? "var(--accent)" : "var(--text-dim)";

  return `
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
    const isAdmin = state.adminMode === true;

    if (!area || !client || !sheet) return;

    let totalGross = 0; // 🚀 Include EVERYTHING
    let netAfterLineItems = 0; // 💸 Only billable "Do Now"

    lineItems.forEach(item => {
        const res = OL.getResourceById(item.resourceId);
        if (!res) return;

        // 1. Calculate Gross (Total potential value regardless of status/party)
        totalGross += OL.calculateBaseFeeWithMultiplier(item, res);

        // 2. Calculate Net (Only "Do Now" and billable parties)
        const isBillable = item.responsibleParty === 'Sphynx' || item.responsibleParty === 'Joint';
        if (item.status === 'Do Now' && isBillable) {
            netAfterLineItems += OL.calculateRowFee(item, res);
        }
    });

    // 3. Subtract Adjustments/Discounts from the Net
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

    const gVal = client.projectData.totalDiscountValue || 0;
    const gType = client.projectData.totalDiscountType || '$';
    const globalAdjustment = gType === '%' ? Math.round(netAfterRounds * (gVal / 100)) : Math.min(netAfterRounds, gVal);
    const finalApproved = netAfterRounds - globalAdjustment;

    // The "Adjustments" display shows the gap between Gross and Final Net
    const totalAdjustments = totalGross - finalApproved;

    area.innerHTML = `
    <div class="grand-totals-bar">
      <div class="grand-actions">
        <button class="btn tiny soft" onclick="window.print()">🖨️ PDF</button>
        ${isAdmin ? `<button class="btn tiny accent" onclick="OL.openDiscountManager()">🏷️ Adjustments</button>` : ''}
      </div>

      <div class="total-item-gross">
        <div class="tiny muted uppercase bold">Gross Value</div>
        <div style="font-size: 14px; font-weight: 600;">$${totalGross.toLocaleString()}</div>
      </div>

      <div class="total-item-disc">
        <div class="tiny accent uppercase bold">Adjustments</div>
        <div class="accent" style="font-size: 14px; font-weight: 600;">-$${totalAdjustments.toLocaleString()}</div>
      </div>

      <div class="total-item-net">
        <div class="tiny muted uppercase bold" style="color: var(--accent);">Final Approved</div>
        <div style="font-size: 22px; font-weight: 900; color: #fff; line-height: 1;">$${finalApproved.toLocaleString()}</div>
      </div>
    </div>`;
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
            <div class="card-section" style="margin-top: 20px;">
                <label class="modal-section-label">✍️ Email Signature</label>
                <textarea class="modal-textarea" 
                        style="min-height: 100px; font-family: monospace; font-size: 11px;" 
                        placeholder="Best regards,\n{{name}}\nSphynx Financial"
                        onblur="OL.updateTeamMember('${memberId}', 'signature', this.value)">${esc(member.signature || '')}</textarea>
                <div class="tiny muted" style="margin-top:5px;">This signature will be used for all email templates sent by this member.</div>
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
    if (!client) return;

    const registry = client.projectData.accessRegistry || [];
    let source = [];

    if (type === "member") {
        // 🚀 THE FIX: Inside a Member Modal, only search LOCAL Project Apps
        const linkedAppIds = registry.filter(r => r.memberId === ownerId).map(r => r.appId);
        source = (client.projectData.localApps || [])
                 .filter(a => !linkedAppIds.includes(a.id));
    } else {
        // Inside an App Modal, searching for a Member (This is already local-only)
        const linkedMemberIds = registry.filter(r => r.appId === ownerId).map(r => r.memberId);
        source = (client.projectData.teamMembers || [])
                 .filter(m => !linkedMemberIds.includes(m.id));
    }

    const matches = source.filter((item) => item.name.toLowerCase().includes(q));

    if (matches.length === 0) {
        listEl.innerHTML = `<div class="search-result-item muted">No unlinked ${type === "member" ? "local apps" : "team members"} found.</div>`;
        return;
    }

    listEl.innerHTML = matches.map(item => `
        <div class="search-result-item" onclick="OL.linkAccess('${ownerId}', '${item.id}', '${type}')">
            ${type === "member" ? "📱" : "👨‍💼"} ${esc(item.name)}
        </div>
    `).join('');
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

window.renderHowToLibrary = function() {
    OL.registerView(renderHowToLibrary);
    const container = document.getElementById("mainContent");
    const client = getActiveClient();
    const hash = window.location.hash;

    if (!container) return;

    const isAdmin = window.FORCE_ADMIN === true;
    const isVaultView = hash.startsWith('#/vault');

    // 1. Data Selection (Master + Project Local)
    const masterLibrary = state.master.howToLibrary || [];
    const localLibrary = (client && client.projectData.localHowTo) || [];
    
    // If in Vault, show all master. If in project, show shared masters + locals.
    const visibleGuides = isVaultView 
        ? masterLibrary 
        : [...masterLibrary.filter(ht => (client?.sharedMasterIds || []).includes(ht.id)), ...localLibrary];

    container.innerHTML = `
        <div class="section-header" style="display: flex !important; visibility: visible !important; opacity: 1 !important;">
            <div style="flex: 1;">
                <h2>📖 ${isVaultView ? 'Master SOP Vault' : 'Project Instructions'}</h2>
                <div class="small muted">${isVaultView ? 'Global Standards' : `Custom guides for ${esc(client?.meta?.name)}`}</div>
            </div>
            
            <div class="header-actions" style="display: flex !important; gap: 10px !important;">
                ${isVaultView && isAdmin ? `
                    <button class="btn primary" style="background: #38bdf8 !important; color: black !important; font-weight: bold;" onclick="OL.openHowToEditorModal()">+ Create Master SOP</button>
                ` : ''}

                ${!isVaultView ? `
                    <button class="btn small soft" onclick="OL.openLocalHowToEditor()">+ Create Local SOP</button>
                    ${isAdmin ? `<button class="btn primary" style="background: #38bdf8 !important; color: black !important; margin-left:8px;" onclick="OL.importHowToToProject()">⬇ Import Master</button>` : ''}
                ` : ''}
            </div>
        </div>

        <div class="cards-grid" style="margin-top: 20px;">
            ${visibleGuides.map(ht => renderHowToCard(client?.id, ht, !isVaultView)).join('')}
            ${visibleGuides.length === 0 ? '<div class="empty-hint" style="grid-column: 1/-1; text-align: center; padding: 60px; opacity: 0.5;">No guides found in this library.</div>' : ''}
        </div>
    `;
};

// 2. RENDER HOW TO CARDS
function renderHowToCard(clientId, ht, isClientView) {
    const client = state.clients[clientId];
    const isAdmin = window.FORCE_ADMIN === true;
    
    // 🚀 THE FIX: Define the missing variable
    const isVaultView = window.location.hash.includes('vault');
    
    const isLocal = String(ht.id).includes('local');
    const isMaster = !isLocal;
    const canDelete = isAdmin || isLocal;
    const isShared = client?.sharedMasterIds?.includes(ht.id);

    return `
        <div class="card hover-trigger ${isMaster ? (isShared ? 'is-shared' : 'is-private') : 'is-local'}" 
             style="cursor: pointer; position: relative;" 
             onclick="OL.openHowToModal('${ht.id}')">

            <div class="card-header">
                <div class="card-title ht-card-title-${ht.id}">${esc(ht.name || 'Untitled SOP')}</div>

                ${canDelete ? `
                <button class="card-delete-btn" 
                        title="${isVaultView ? 'Delete Master Source' : (isMaster ? 'Remove from Client View' : 'Delete Permanently')}" 
                        onclick="event.stopPropagation(); OL.deleteSOP('${clientId}', '${ht.id}')">×</button>
                ` : ''}
            </div>
            
            <div class="card-body" style="padding-top: 12px;">
                <div style="display: flex; gap: 6px; align-items: center;">
                    <span class="pill tiny ${isMaster ? 'vault' : 'local'}" style="font-size: 8px; letter-spacing: 0.05em;">
                        ${isMaster ? 'MASTER' : 'LOCAL'}
                    </span>

                    ${!isClientView && isMaster ? `
                        <span class="pill tiny ${isShared ? 'accent' : 'soft'}" 
                              style="font-size: 8px; cursor: pointer;"
                              onclick="event.stopPropagation(); OL.toggleSOPSharing('${clientId}', '${ht.id}')">
                            ${isShared ? '🌍 Client-Facing' : '🔒 Internal-Only'}
                        </span>
                    ` : ''}
                </div>
                <p class="small muted" style="display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.4;">
                    ${esc(ht.summary || 'No summary provided.')}
                </p>
            </div>
        </div>
    `;
}

OL.getProjectsSharingSOP = function(sopId) {
    return Object.values(state.clients || {}).filter(client => 
        (client.sharedMasterIds || []).includes(sopId)
    ).map(client => ({
        id: client.id,
        name: client.meta?.name || 'Unnamed Client'
    }));
};

OL.openLocalHowToEditor = function() {
    const client = getActiveClient();
    if (!client) return;

    const draftId = 'draft-local-ht-' + Date.now();
    const draftHowTo = {
        id: draftId,
        name: "",
        summary: "",
        content: "",
        isDraft: true,
        isLocal: true // 🚀 Flag to tell the saver where to go
    };
    OL.openHowToModal(draftId, draftHowTo);
};

// 3. RENDER HOW TO MODAL
OL.openHowToModal = function(htId, draftObj = null) {
    const hash = window.location.hash;
    const isVaultMode = hash.includes('vault'); 
    const client = getActiveClient();
    
    // 1. Resolve Guide Data
    let ht = draftObj || (state.master.howToLibrary || []).find(h => h.id === htId);
    if (!ht && client) {
        ht = (client.projectData.localHowTo || []).find(h => h.id === htId);
    }
    if (!ht) return;

    // 2. Identify Permissions & Scope
    const isAdmin = window.FORCE_ADMIN === true;
    const isLocal = String(ht.id).includes('local');
    const isMaster = !isLocal; // 🚀 FIXED: isMaster is now defined here
    const isDraft = String(htId).startsWith('draft');
    const isShared = client?.sharedMasterIds?.includes(ht.id);

    const canEdit = isAdmin || isLocal || isDraft;
    const canPromote = isAdmin && isLocal && !isVaultMode;
    const allApps = [...(state.master.apps || []), ...(client?.projectData?.localApps || [])];
    const backlinks = OL.getSOPBacklinks(ht.id);
    const sharedProjects = isMaster ? OL.getProjectsSharingSOP(ht.id) : [];

    const html = `
        <div class="modal-head" style="gap:15px;">
            <div style="display:flex; align-items:center; gap:10px; flex:1;">
                <span style="font-size:18px;">📖</span>
                <input type="text" class="header-editable-input" 
                       value="${esc(ht.name)}" 
                       placeholder="Enter SOP Name..."
                       style="background:transparent; border:none; color:inherit; font-size:18px; font-weight:bold; width:100%; outline:none;"
                       ${!canEdit ? 'readonly' : ''} 
                       onblur="OL.handleHowToSave('${ht.id}', 'name', this.value)">
            </div>
            
            ${canPromote ? `
                <button class="btn tiny primary" 
                        style="background: #fbbf24 !important; color: black !important; font-weight: bold;" 
                        onclick="OL.promoteLocalSOPToMaster('${ht.id}')">
                    ⭐ PROMOTE TO MASTER
                </button>
            ` : ''}

            ${isAdmin && isMaster ? `
                <span class="pill tiny ${isShared ? 'accent' : 'soft'}" 
                    style="font-size: 8px; cursor: pointer;"
                    onclick="OL.toggleSOPSharing('${client?.id}', '${ht.id}'); OL.openHowToModal('${ht.id}')">
                    ${isShared ? '🌍 Client-Facing' : '🔒 Internal-Only'}
                </span>
            ` : ''}
            
            ${!isAdmin && isLocal ? `
                <span class="pill tiny soft" style="font-size: 8px;">📍 Project-Specific</span>
            ` : ''}

        </div>
        <div class="modal-body">
            <div class="card-section" style="margin-top:15px;">
                <label class="modal-section-label">📄 Brief Summary (Shows on card)</label>
                <input type="text" class="modal-input tiny" 
                       placeholder="One-sentence overview..."
                       value="${esc(ht.summary || '')}" 
                       ${!canEdit ? 'readonly' : ''}
                       onblur="OL.handleHowToSave('${ht.id}', 'summary', this.value)">
            </div>

            <div class="card-section" style="margin-top:15px;">
                <label class="modal-section-label">🎥 Training Video URL</label>
                ${canEdit ? `
                    <input type="text" class="modal-input tiny" 
                           placeholder="Paste link..."
                           value="${esc(ht.videoUrl || '')}" 
                           onblur="OL.handleHowToSave('${ht.id}', 'videoUrl', this.value); OL.openHowToModal('${ht.id}')">
                ` : ''}
                ${ht.videoUrl ? `<div class="video-preview-wrap" style="margin-top:10px;">${OL.parseVideoEmbed(ht.videoUrl)}</div>` : ''}
            </div>

            <div class="card-section" style="margin-top:15px;">
                <label class="modal-section-label">📂 Category</label>
                <input type="text" class="modal-input tiny" 
                       value="${esc(ht.category || 'General')}" 
                       ${!canEdit ? 'readonly' : ''}
                       onblur="OL.handleHowToSave('${ht.id}', 'category', this.value)">
            </div>

            <div class="card-section" style="margin-top:15px;">
                <label class="modal-section-label">📱 Related Applications</label>
                <div class="pills-row" id="ht-app-pills">
                    ${(ht.appIds || []).map(appId => {
                        const app = allApps.find(a => a.id === appId);
                        return app ? `<span class="pill tiny accent">${esc(app.name)}</span>` : '';
                    }).join('')}
                </div>
                ${canEdit ? `
                    <div class="search-map-container" style="margin-top:8px;">
                        <input type="text" class="modal-input tiny" placeholder="Link an app..." 
                               onfocus="OL.filterHTAppSearch('${ht.id}', '')"
                               oninput="OL.filterHTAppSearch('${ht.id}', this.value)">
                        <div id="ht-app-search-results" class="search-results-overlay"></div>
                    </div>
                ` : ''}
            </div>

            <div class="card-section" style="margin-top:20px; border-top: 1px solid var(--line); padding-top:20px;">
                <label class="modal-section-label">Instructions</label>
                <textarea class="modal-textarea" rows="12" 
                          ${!canEdit ? 'readonly' : ''} 
                          style="${!canEdit ? 'background:transparent; border:none; color:rgba(255,255,255,0.5);' : ''}"
                          onblur="OL.handleHowToSave('${ht.id}', 'content', this.value)">${esc(ht.content || '')}</textarea>
            </div>
            ${backlinks.length > 0 ? `
                <div class="card-section" style="margin-top:25px; border-top: 1px solid var(--line); padding-top:20px;">
                    <label class="modal-section-label" style="color: var(--accent); opacity: 1;">🔗 Mapped to Technical Resources</label>
                    <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 10px;">
                        ${backlinks.map(link => `
                            <div class="pill soft is-clickable" 
                                style="display: flex; align-items: center; gap: 10px; padding: 8px; background: rgba(56, 189, 248, 0.05);"
                                onclick="OL.openResourceModal('${link.resId}')">
                                <span style="font-size: 12px;">📱</span>
                                <div style="flex: 1;">
                                    <div style="font-size: 10px; font-weight: bold;">${esc(link.resName)}</div>
                                    <div style="font-size: 8px; opacity: 0.6;">Linked via ${link.context}: "${esc(link.detail)}"</div>
                                </div>
                                <span style="font-size: 10px; opacity: 0.4;">View Resource ➔</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            ` : ''}

            ${sharedProjects.length > 0 ? `
                <div class="card-section" style="margin-top:25px; border-top: 1px solid var(--line); padding-top:20px;">
                    <label class="modal-section-label" style="color: #10b981;">🌍 Shared With Projects</label>
                    <div style="display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px;">
                        ${sharedProjects.map(p => `
                            <div class="pill soft" style="display: flex; align-items: center; gap: 8px; padding: 4px 10px; background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.2);">
                                <span style="font-size: 10px;">🏢</span>
                                <span style="font-size: 10px; font-weight: bold;">${esc(p.name)}</span>
                                <button class="pill-remove-x" 
                                        style="cursor:pointer; opacity: 0.5; margin-left: 5px;" 
                                        onclick="event.stopPropagation(); OL.deleteSOP('${p.id}', '${ht.id}'); OL.openHowToModal('${ht.id}')">×</button>
                            </div>
                        `).join('')}
                    </div>
                </div>
            ` : (isMaster ? '<div class="tiny muted" style="margin-top:20px;">This Master SOP is not shared with any projects.</div>' : '')}
                    </div>
        `;
    openModal(html);
};

window.OL.promoteLocalSOPToMaster = function(localId) {
    const client = getActiveClient();
    const localSOP = client?.projectData?.localHowTo?.find(h => h.id === localId);

    if (!localSOP) return;
    if (!confirm(`Standardize "${localSOP.name}"? This will add it to the Global Vault for all future projects.`)) return;

    // 1. Create the Master Copy
    const masterId = 'ht-vlt-' + Date.now();
    const masterCopy = {
        ...JSON.parse(JSON.stringify(localSOP)), 
        id: masterId,
        scope: 'global',
        createdDate: new Date().toISOString()
    };

    // 2. Add to Global Library
    if (!state.master.howToLibrary) state.master.howToLibrary = [];
    state.master.howToLibrary.push(masterCopy);

    // 3. Remove Local copy and replace with Shared Master link
    client.projectData.localHowTo = client.projectData.localHowTo.filter(h => h.id !== localId);
    if (!client.sharedMasterIds) client.sharedMasterIds = [];
    client.sharedMasterIds.push(masterId);

    OL.persist();
    OL.closeModal();
    renderHowToLibrary(); // Refresh grid to show new status
    
    alert(`🚀 "${localSOP.name}" is now a Master Template!`);
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
    const client = getActiveClient();
    let ht = state.master.howToLibrary.find(h => h.id === htId);
    
    if (!ht && client && client.projectData.localHowTo) {
        ht = client.projectData.localHowTo.find(h => h.id === htId);
    }

    if (!ht) return;
    
    if (!ht.appIds) ht.appIds = [];
    const idx = ht.appIds.indexOf(appId);
    
    if (idx === -1) ht.appIds.push(appId);
    else ht.appIds.splice(idx, 1);
    
    OL.persist();
    OL.openHowToModal(htId);
};

OL.filterHTAppSearch = function(htId, query) {
    const listEl = document.getElementById("ht-app-search-results");
    if (!listEl) return;
    const q = (query || "").toLowerCase();
    const client = getActiveClient();
    
    // 1. Resolve current guide (to avoid linking to itself)
    let currentHt = state.master.howToLibrary.find(h => h.id === htId) || 
                   (client?.projectData?.localHowTo || []).find(h => h.id === htId);

    const currentAppIds = currentHt ? (currentHt.appIds || []) : [];

    // 🚀 2. THE MERGE: Combine Global Master Apps/SOPs with Local Project Apps/SOPs
    const masterApps = state.master.apps || [];
    const localApps = client?.projectData?.localApps || [];
    const allAvailableApps = [...masterApps, ...localApps];

    // 3. Filter based on query and exclude what's already linked
    const matches = allAvailableApps.filter(a => 
        a.name.toLowerCase().includes(q) && 
        !currentAppIds.includes(a.id)
    );
    
    // 4. Render results
    listEl.innerHTML = matches.map(app => `
        <div class="search-result-item" onmousedown="OL.toggleHTApp('${htId}', '${app.id}')">
            ${String(app.id).includes('local') ? '📍' : '🏛️'} ${esc(app.name)}
        </div>
    `).join('') || '<div class="search-result-item muted">No matching items found</div>';
};

OL.parseVideoEmbed = function(url) {
    if (!url) return "";
    
    // YouTube logic
    const ytMatch = url.match(/(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    if (ytMatch) return `<iframe width="100%" height="315" src="https://www.youtube.com/embed/${ytMatch[1]}" frameborder="0" allowfullscreen></iframe>`;
    
    // Loom logic
    const loomMatch = url.match(/(?:https?:\/\/)?(?:www\.)?loom\.com\/share\/([a-zA-Z0-9]+)/);
    if (loomMatch) return `<div style="position: relative; padding-bottom: 56.25%; height: 0;"><iframe src="https://www.loom.com/embed/${loomMatch[1]}" frameborder="0" webkitallowfullscreen mozallowfullscreen allowfullscreen style="position: absolute; top: 0; left: 0; width: 100%; height: 100%;"></iframe></div>`;

    // Vimeo logic
    const vimeoMatch = url.match(/(?:https?:\/\/)?(?:www\.)?vimeo\.com\/(\d+)/);
    if (vimeoMatch) return `<iframe src="https://player.vimeo.com/video/${vimeoMatch[1]}" width="100%" height="315" frameborder="0" allow="autoplay; fullscreen" allowfullscreen></iframe>`;

    return `<div class="p-10 tiny warn">Unrecognized video format. Please use Loom, YouTube, or Vimeo.</div>`;
};

// Toggle a resource ID in the guide's resourceIds array
OL.toggleHTResource = function(htId, resId) {
    const client = getActiveClient();
    
    // 🚀 THE FIX: Find the target SOP in Master OR Local
    let ht = (state.master.howToLibrary || []).find(h => h.id === htId);
    if (!ht && client && client.projectData.localHowTo) {
        ht = client.projectData.localHowTo.find(h => h.id === htId);
    }

    if (!ht) return;
    
    if (!ht.resourceIds) ht.resourceIds = [];
    const idx = ht.resourceIds.indexOf(resId);
    
    if (idx === -1) {
        ht.resourceIds.push(resId);
    } else {
        ht.resourceIds.splice(idx, 1);
    }
    
    OL.persist(); // This will now save the modified object in whichever array it lives in
    OL.openHowToModal(htId); 
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
    renderResourceLibrary(); // Refresh view
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
    const client = getActiveClient();
    const cleanVal = (typeof value === 'string') ? value.trim() : value;
    const isVaultMode = window.location.hash.includes('vault');
    
    // 1. Resolve Target
    let ht = state.master.howToLibrary.find(h => h.id === id);
    if (!ht && client) {
        ht = (client.projectData.localHowTo || []).find(h => h.id === id);
    }

    // 🚀 NEW: Initialize MASTER SOP if it's a new draft in the Vault
    if (!ht && isVaultMode && (id.startsWith('draft') || id.startsWith('vlt'))) {
        const newMaster = { 
            id: id, 
            name: "", 
            content: "", 
            category: "General",
            scope: "internal", // Default to internal/private
            appIds: [],
            resourceIds: []
        };
        state.master.howToLibrary.push(newMaster);
        ht = newMaster;
        renderHowToLibrary();
        console.log("🏛️ New Master SOP Initialized in Vault");
    }

    // 🚀 EXISTING: Initialize LOCAL SOP if it's a new local draft
    if (!ht && id.includes('local') && client) {
        if (!client.projectData.localHowTo) client.projectData.localHowTo = [];
        const newLocal = { 
            id: id, 
            name: "", 
            content: "", 
            category: "General",
            appIds: [],
            resourceIds: []
        };
        client.projectData.localHowTo.push(newLocal);
        ht = newLocal;
        renderHowToLibrary();
        console.log("📍 New Local SOP Initialized in Project Data");
    }

    if (ht) {
        ht[field] = cleanVal;

        // 🔒 TERMINOLOGY SYNC: If scope becomes internal, revoke client sharing
        if (field === 'scope' && cleanVal === 'internal') {
            Object.values(state.clients).forEach(c => {
                if (c.sharedMasterIds) {
                    c.sharedMasterIds = c.sharedMasterIds.filter(mid => mid !== id);
                }
            });
            console.log("🔒 Revoked sharing for internal guide.");
        }

        OL.persist();
        
        // 🔄 Surgical UI Sync for name
        if (field === 'name') {
            document.querySelectorAll(`.ht-card-title-${id}`).forEach(el => el.innerText = cleanVal || "New SOP");
        }
    } else {
        console.error("❌ SAVE FAILED: No SOP or Client Context found for ID:", id);
    }
};

OL.deleteSOP = function(clientId, htId) {
    const isVaultView = window.location.hash.includes('vault');
    const isLocal = String(htId).includes('local');
    const client = state.clients[clientId];
    
    // 1. Backlink Check (Only for permanent deletes)
    if (isVaultView || isLocal) {
        const backlinks = OL.getSOPBacklinks(htId);
        if (backlinks.length > 0) {
            const resNames = [...new Set(backlinks.map(b => b.resName))].join(', ');
            if (!confirm(`⚠️ WARNING: This SOP is mapped to: ${resNames}.\n\nDeleting the SOURCE will break these links. Proceed?`)) return;
        }
    }

    // 2. Resolve Guide Name
    let guide;
    if (isLocal && client) {
        guide = (client.projectData.localHowTo || []).find(h => h.id === htId);
    } else {
        guide = (state.master.howToLibrary || []).find(h => h.id === htId);
    }
    if (!guide) return;

    // 3. Contextual Execution
    if (isVaultView) {
        // --- MASTER VAULT DELETE ---
        if (!confirm(`⚠️ PERMANENT VAULT DELETE: "${guide.name}"\n\nThis removes the source file for ALL projects. This cannot be undone.`)) return;
        
        state.master.howToLibrary = (state.master.howToLibrary || []).filter(h => h.id !== htId);
        // Scrub the ID from every single client's shared list
        Object.values(state.clients).forEach(c => {
            if (c.sharedMasterIds) c.sharedMasterIds = c.sharedMasterIds.filter(id => id !== htId);
        });
        console.log("🗑️ Master Source Deleted:", htId);

    } else if (isLocal) {
        // --- LOCAL PROJECT DELETE ---
        if (!confirm(`Delete local SOP "${guide.name}"?`)) return;
        if (client) {
            client.projectData.localHowTo = client.projectData.localHowTo.filter(h => h.id !== htId);
        }
        console.log("🗑️ Local SOP Deleted:", htId);

    } else {
        // --- MASTER UNLINK (Revoke Access) ---
        if (!confirm(`Remove "${guide.name}" from this project?\n\nThe guide will remain safe in your Master Vault.`)) return;
        if (client && client.sharedMasterIds) {
            client.sharedMasterIds = client.sharedMasterIds.filter(id => id !== htId);
        }
        console.log("🔒 Master SOP Unlinked from Client:", clientId);
    }

    // 4. Finalize
    OL.persist();
    renderHowToLibrary();
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

//=======================HOW-TO RESOURCES OVERLAP ====================//
OL.getSOPBacklinks = function(sopId) {
    const client = getActiveClient();
    const allResources = [...(state.master.resources || []), ...(client?.projectData?.localResources || [])];
    const links = [];

    allResources.forEach(res => {
        // Check Triggers
        (res.triggers || []).forEach((trig, idx) => {
            if ((trig.links || []).some(l => String(l.id) === String(sopId))) {
                links.push({ resId: res.id, resName: res.name, context: 'Trigger', detail: trig.name });
            }
        });
        // Check Steps
        (res.steps || []).forEach(step => {
            if ((step.links || []).some(l => String(l.id) === String(sopId))) {
                links.push({ resId: res.id, resName: res.name, context: 'Step', detail: step.text });
            }
        });
    });
    return links;
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

// =========================HOW TO SCOPING OVERLAP=====================================
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

// 🚀 THE BULLETPROOF STARTER
function bootRouter() {
    console.log("🏁 App Ignition: Checking route...");
    // Force a default if empty
    if (!window.location.hash || window.location.hash === "#/") {
        // window.location.hash = "#/client-tasks"; 
    }
    window.handleRoute();
}

// 🔄 Handle initial load (covers all browser timings)
if (document.readyState === "complete" || document.readyState === "interactive") {
    bootRouter();
} else {
    window.addEventListener("DOMContentLoaded", bootRouter);
}

// 🔄 Handle every click thereafter
window.addEventListener("hashchange", window.handleRoute);