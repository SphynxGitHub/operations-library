//======================= GENERAL SECTION =======================//

// 1. MUST BE LINE 1: Define the namespace immediately
const OL = window.OL = {};

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

OL.persist = async function() {
    if (window.saveTimeout) clearTimeout(window.saveTimeout);

    window.saveTimeout = setTimeout(async () => {
        try {
            const activeId = state.activeClientId;
            
            // 🚀 SHREDDER LOGIC: Split large object into smaller documents
            // 1. Save Master Data (Standard library)
            const masterCopy = JSON.parse(JSON.stringify(state.master));
            await db.collection('systems').doc('master_registry').set(masterCopy);

            // 2. Save Active Client specifically (gives you 1MB per client)
            if (activeId && state.clients[activeId]) {
                const clientCopy = JSON.parse(JSON.stringify(state.clients[activeId]));
                await db.collection('clients').doc(activeId).set(clientCopy);
                console.log(`☁️ CLOUD ACKNOWLEDGED: Client [${activeId}] safe.`);
            }

            window.lastLocalSave = Date.now();
            localStorage.setItem('OL_FS_TEST', JSON.stringify(state)); 
        } catch (error) {
            console.error("💀 SAVE FAILED:", error);
            if (error.message.includes("too large")) {
                alert("CRITICAL: Data too large. Please split your Workflow into smaller resources.");
            }
        }
    }, 1000);
};

OL.sync = function() {
    console.log("📡 Initializing Multi-Doc Collection Sync...");

    // 1. Listen to the Master Registry
    db.collection('systems').doc('master_registry').onSnapshot((doc) => {
        if (doc.exists) {
            state.master = doc.data();
            console.log("🏛️ Master Registry Loaded");
        } else {
            // BRIDGE: Pull master from old state if new one doesn't exist
            db.collection('systems').doc('main_state').get().then(oldDoc => {
                if (oldDoc.exists) {
                    state.master = oldDoc.data().master;
                    console.log("🌉 Bridge: Master Data recovered.");
                }
            });
        }
    });

    // 2. Listen to the WHOLE Clients Collection (For the Dashboard)
    db.collection('clients').onSnapshot((querySnapshot) => {
        const cloudClients = {};
        querySnapshot.forEach((doc) => {
            cloudClients[doc.id] = doc.data();
        });

        // If we found clients in the new collection, update the state
        if (Object.keys(cloudClients).length > 0) {
            state.clients = cloudClients;
            console.log(`📋 Dashboard Synced: ${Object.keys(cloudClients).length} clients found.`);
            window.handleRoute();
        } else {
            // BRIDGE: If new collection is empty, pull all clients from old main_state once
            db.collection('systems').doc('main_state').get().then(oldDoc => {
                if (oldDoc.exists && !Object.keys(state.clients).length) {
                    state.clients = oldDoc.data().clients || {};
                    console.log("🌉 Bridge: Full Client List recovered from old state.");
                    window.handleRoute();
                }
            });
        }
    });

    // 3. Keep track of the ACTIVE Client for V2 Sets
    const activeId = sessionStorage.getItem('lastActiveClientId');
    if (activeId) {
        state.activeClientId = activeId;
        // Listen specifically to active client for V2 logic (Set casting)
        db.collection('clients').doc(activeId).onSnapshot((doc) => {
            if (doc.exists) {
                const clientData = doc.data();
                if (!state.v2) state.v2 = {};
                const rawSelected = clientData.v2?.selectedNodes;
                state.v2.selectedNodes = new Set(Array.isArray(rawSelected) ? rawSelected : (rawSelected ? Object.values(rawSelected) : []));
                const rawExpanded = clientData.v2?.expandedNodes;
                state.v2.expandedNodes = new Set(Array.isArray(rawExpanded) ? rawExpanded : (rawExpanded ? Object.values(rawExpanded) : []));
            }
        });
    }
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
    if (!type) return "📄"; // Default fallback
    const registry = state.master.resourceTypes || [];
    const entry = registry.find(t => 
        String(t.type).toLowerCase() === String(type).toLowerCase()
    );

    // 🚀 Return the custom icon from the registry, or a smart fallback
    if (entry && entry.icon) return entry.icon;

    // Smart Fallbacks if registry entry is missing icons
    const defaults = {
        zap: "⚡",
        form: "📄",
        email: "📧",
        event: "🗓️",
        sop: "📖",
        workflow: "🕸️",
        other: "⚙️"
    };
    return defaults[type.toLowerCase()] || "📄";
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

    // 🚀 THE SHIELD: Only resume the map if we aren't trying to go to Scoping
    if ((state.focusedWorkflowId || state.focusedResourceId) && 
        (isDashboard || isVisualizer) && 
        !currentHash.includes('scoping')) { 
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
    // This matches the "pizza123" or whatever your secret key is
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
    
    // Toggle the inner visibility
    if (innerContent) {
        innerContent.style.display = isCollapsed ? 'none' : 'block';
    }

    // Flip the arrow
    if (toggleIcon) {
        toggleIcon.innerText = isCollapsed ? '▶' : '◀';
    }
    
    localStorage.setItem('sidebarCollapsed', isCollapsed);
    window.dispatchEvent(new Event('resize'));
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
                ${!window.IS_GUEST ? `<button class="btn primary" onclick="OL.partnerCreateClient('${leadProject.id}')">+ Onboard New Client</button>` : ''}
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
            scopingSheets: [{ id: 'sheet-' + uid(), lineItems: [] }]
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
  const client = getActiveClient();
  const hash = location.hash || "#/";
  const urlParams = new URLSearchParams(window.location.search);
  const isAdmin = window.FORCE_ADMIN === true;
  const isPublic = new URLSearchParams(window.location.search).has("access");
  const isPartnerProject = client && client.meta.status === "Partner";
  const isPartnerMode = isPartnerProject || (client && !!client.meta.partnerOwner);
  
  const token = urlParams.get("access");
  const isMaster = hash.startsWith("#/vault");

  let homeLabel = "Dashboard";
  let homeAction = "";
  let showHome = true;

  if (isAdmin) {
      // Master Admin always goes to Global Registry
      homeLabel = "Global Registry";
      homeAction = `window.location.hash = '#/'`;
  } else if (client && client.meta.status === "Partner") {
      // Partner goes to their Portfolio
      homeLabel = "My Portfolio";
      homeAction = `window.location.hash='#/partner-dashboard'`;
  } else if (client && client.meta.partnerOwner) {
      // Sub-client of a partner goes back to the Portfolio
      homeLabel = "Partner Home";
      homeAction = `window.location.hash='#/partner-dashboard'`;
  } else if (isPublic) {
      // Direct Clients see no Home button (keeps them in their project)
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
      icon: "🔨",
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
    { key: "data", label: "Master Data Tags", icon: "🏷️", href: "#/vault/data" },
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
      icon: "🔨",
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
    { key: "data", label: "Data Tags", icon: "🏷️", href: "#/data" },
  ];

  // Inside your layout/sidebar render function:
    const isLightMode = document.body.classList.contains('light-mode');
    const themeIcon = isLightMode ? '🌙' : '☀️';
    const themeLabel = isLightMode ? 'Dark Mode' : 'Light Mode';

    const themeSection = `
        <div class="theme-toggle-zone">
            <button class="btn soft tiny" onclick="OL.toggleTheme()" title="${themeLabel}">
                <span class="theme-icon">${themeIcon}</span>
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
                                <i>🏠</i> <span>${homeLabel.toUpperCase()}</span>
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
                            <i>${item.icon}</i> <span class="menu-item">${item.label}</span>
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
                                <i>${item.icon}</i> <span class="menu-item">${item.label}</span>
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
            <div>
                <div class="spinner">⏳</div>
                <h3 class="muted">Connecting to Registry...</h3>
            </div>`;
        return;
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
        { name: "Compliance Documents", type: "Compliance", systemPinned: true, 
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
        <div class="dp-manager-row master-spec">
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
        <div class="dp-manager-row local-spec">
            
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
        <div class="modal-head">
            <div style="display:flex; align-items:center; gap:10px; flex:1;">
                <span style="font-size:18px;">⚒️</span>
                <input type="text" class="header-editable-input" 
                       value="${esc(val(fn.name))}" 
                       placeholder="Function Name..."
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
                <div id="master-fn-import-results" class="search-results-overlay"></div>
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

        <div class="task-single-column">
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
                        <div class="pills-row">
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
                    ${(task.appIds || []).length > 0 ? `<span class="pill tiny soft" style="background: rgba(255,255,255,0.03); border: 1px solid var(--line); font-size: 9px;">📱 ${(task.appIds || []).length}</span>` : ''}
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
        <div class="modal-head" style="gap:15px;">
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

        <div class="modal-layout-wrapper" style="display: flex; height: 75vh; overflow: hidden;">
            
            <div class="modal-body main-config-area" style="flex: 1.5; overflow-y: auto; padding: 20px; border-right: 1px solid var(--line);">

                <div class="card-section" style="margin-top: 20px;">
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                        <div>
                            <label class="modal-section-label">📅 Due Date</label>
                            <input type="date" class="modal-input tiny" value="${task.dueDate || ''}" 
                                   onchange="OL.updateTaskField('${taskId}', 'dueDate', this.value, false)">
                        </div>
                        <div>
                            <label class="modal-section-label">Status</label>
                            <select class="modal-input tiny" onchange="OL.updateTaskField('${taskId}', 'status', this.value, false)">
                                <option value="Pending" ${task.status === 'Pending' ? 'selected' : ''}>⏳ Pending</option>
                                <option value="In Progress" ${task.status === 'In Progress' ? 'selected' : ''}>🚧 In Progress</option>
                                <option value="Done" ${task.status === 'Done' ? 'selected' : ''}>✅ Done</option>
                            </select>
                        </div>
                    </div>
                </div>
                
                <div class="card-section">
                    <label class="modal-section-label">Internal SOP / Instructions</label>
                    <textarea class="modal-textarea" rows="4" 
                              onblur="OL.updateTaskField('${taskId}', 'description', this.value, ${isVault})">${esc(task.description || task.notes || "")}</textarea>
                </div>

                <div class="card-section" style="margin-top: 20px;">
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

                <div class="card-section" style="margin-top: 20px;">
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
                    <div style="margin-top:15px;">
                        <label class="modal-section-label">👨‍💼 Assigned Team Members</label>
                        <div class="pills-row" id="task-assignee-pills" style="margin-bottom: 8px;">
                            ${(task.assigneeIds || []).map(mId => {
                                const member = client.projectData.teamMembers?.find(m => m.id === mId);
                                return member ? `
                                    <span class="pill tiny accent">
                                        👨‍💼 ${esc(member.name)}
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
                             style="flex:1; padding: 12px; text-align:center; font-size:10px; cursor:pointer; font-weight:bold; ${activeTab === 'internal' ? 'color:var(--accent); border-bottom:2px solid var(--accent);' : 'opacity:0.5'}">
                            INTERNAL
                        </div>
                    ` : ''}
                    <div onclick="state.v2.activeCommentTab='client'; OL.openTaskModal('${taskId}', ${isVault})"
                         style="flex:1; padding: 12px; text-align:center; font-size:10px; cursor:pointer; font-weight:bold; ${activeTab === 'client' ? 'color:#10b981; border-bottom:2px solid #10b981;' : 'opacity:0.5'}">
                        CLIENT FEEDBACK
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
                            style="background:${activeTab === 'client' ? '#10b981' : 'var(--accent)'}; color:black; font-weight:bold;"
                            onclick="OL.addTaskComment('${taskId}', ${isVault}, ${activeTab === 'client'})">
                        Post ${activeTab === 'client' ? 'to Client' : 'Note'}
                    </button>
                </div>
            </aside>
        </div>
    `;
    openModal(html);
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
    const isVaultView = window.location.hash.startsWith('#/vault');

    if (!container) return;

    // 🔓 FIX: Restore standard page scrolling
    document.body.classList.remove('is-visualizer', 'fs-mode-active');
    document.body.style.overflow = 'auto'; 

    const source = isVaultView ? (state.master.resources || []) : (client?.projectData?.localResources || []);
    
    // Data for dropdowns
    const types = [...new Set(source.map(r => r.type).filter(t => t && t !== 'Workflow'))].sort();
    const apps = [...new Set(source.map(r => r.appName).filter(Boolean))].sort();
    const dataTags = state.master.datapoints?.filter(d => !d.isBundle) || [];
    const team = [...(state.master.teamMembers || []), ...(client?.projectData?.teamMembers || []), { name: 'Client 1' }, { name: 'Client 2' }];

    container.innerHTML = `
        <div class="section-header">
            <div>
                <h2>📦 ${isVaultView ? 'Master Vault' : 'Project Library'}</h2>
                <div class="small muted subheader">Full technical catalog for ${esc(client?.meta.name || 'Global')}</div>
            </div>
            <div class="header-actions">
                ${state.adminMode ? `<button class="btn small soft" onclick="OL.openResourceTypeManager()">⚙️ Types</button>` : ''}
                <button class="btn primary" onclick="OL.universalCreate('SOP')">+ New Resource</button>
            </div>
        </div>

        <div class="v2-toolbar" style="margin: 20px 0; display: flex; gap: 10px; flex-wrap: wrap; background: rgba(255,255,255,0.03); padding: 15px; border-radius: 8px; border: 1px solid var(--line);">
            <div class="canvas-search-wrap" style="flex: 2; min-width: 250px;">
                <span class="search-icon">🔍</span>
                <input type="text" id="lib-filter-input" class="v2-search-input" 
                       placeholder="Search name, description, or notes..." 
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

            <select id="lib-filter-data-tag" class="tiny-select" onchange="OL.syncResourceLibraryFilters()">
                <option value="">All Data Tags</option>
                ${dataTags.map(d => `<option value="${d.id}">${d.name}</option>`).join('')}
            </select>

            <select id="lib-filter-scoped" class="tiny-select" onchange="OL.syncResourceLibraryFilters()">
                <option value="">All Scoping</option>
                <option value="scoped">Scoped ($)</option>
                <option value="unscoped">Unscoped</option>
            </select>

            <select id="lib-filter-scoping-status" class="tiny-select" onchange="OL.syncResourceLibraryFilters()">
                <option value="">All Statuses</option>
                <option value="Do Now">Do Now</option>
                <option value="Do Later">Do Later</option>
                <option value="Don't Do">Don't Do</option>
                <option value="Done">Done</option>
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

            <button class="btn tiny danger soft" onclick="OL.clearResourceFilters()">✕ Clear</button>
        </div>

        <div id="resource-library-results"></div>
    `;

    OL.syncResourceLibraryFilters();
};

OL.syncResourceLibraryFilters = function() {
    const container = document.getElementById('resource-library-results');
    if (!container) return;

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
        if (res.type === 'Workflow') return false;

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
    if (items.length === 0) {
        container.innerHTML = `<div class="empty-hint" style="padding: 100px; text-align: center; opacity: 0.5;">No resources matching your filters.</div>`;
        return;
    }

    const sphynxPinned = items.filter(res => res.systemPinned);
    const adminPinned = items.filter(res => res.adminPinned);
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
                    <div style="border-bottom: 2px solid var(--accent); padding: 8px; background: rgba(var(--accent-rgb), 0.05); margin-bottom:12px;">
                        <h3 style="margin:0; font-size:12px; color: var(--accent);">💎 SPHYNX RESOURCES</h3>
                    </div>
                    <div class="cards-grid">${sphynxPinned.map(r => renderResourceCard(r)).join('')}</div>
                </div>` : ''}

            ${adminPinned.length ? `
                <div class="resource-group" style="margin-bottom: 30px;">
                    <div style="border-bottom: 2px solid #94a3b8; padding: 8px; background: rgba(148, 163, 184, 0.05); margin-bottom:12px;">
                        <h3 style="margin:0; font-size:12px; color: #94a3b8;">📁 ADMIN</h3>
                    </div>
                    <div class="cards-grid">${adminPinned.map(r => renderResourceCard(r)).join('')}</div>
                </div>` : ''}

            ${sortedTypes.map(type => `
                <div class="resource-group" style="margin-bottom: 40px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; border-bottom: 1px solid var(--accent); padding-bottom: 8px; margin-bottom:15px;">
                        <h3 style="margin:0; font-size: 13px; text-transform: uppercase; color: var(--accent); letter-spacing: 0.1em;">
                            ${OL.getRegistryIcon(type)} ${type}s
                        </h3>
                        <button class="btn tiny soft" onclick="OL.promptBulkReclassify('${type}')">Bulk Move</button>
                    </div>
                    <div class="cards-grid">
                        ${grouped[type].sort((a, b) => a.name.localeCompare(b.name)).map(r => renderResourceCard(r)).join('')}
                    </div>
                </div>
            `).join('')}
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
    const quickIcons = ["⚡", "📄", "📧", "📅", "🔌", "📖", "🏠", "💬", "🛠️", "🎯", "🤖", "📈"];

    let html = `
        <div class="modal-head">
            <div class="modal-title-text">⚙️ Manage Resource Types</div>
        </div>
        <div class="modal-body">
            <p class="tiny muted mb-20">
                Define categories, icons, and link them to Master Functions to enable auto-locking of primary apps.
            </p>
            
            <div class="dp-manager-list custom-scrollbar">
                ${registry.map(t => {
                    const encType = btoa(t.type);
                    return `
                    <div class="dp-manager-row type-editor-row">
                        <span contenteditable="true" 
                              class="icon-edit-box"
                              onblur="OL.updateResourceTypeProp('${t.typeKey}', 'icon', this.innerText)">
                            ${t.icon || '⚙️'}
                        </span>

                        <span contenteditable="true" 
                              class="type-name-edit"
                              onblur="OL.renameResourceTypeFlat('${encType}', this.innerText)">
                            ${esc(t.type)}
                        </span>
                        
                        <select class="modal-input tiny func-match-select" 
                                onchange="OL.updateResourceTypeProp('${t.typeKey}', 'matchedFunctionId', this.value)">
                            <option value="">-- No Auto-Lock --</option>
                            ${masterFunctions.map(f => `
                                <option value="${f.id}" ${t.matchedFunctionId === f.id ? 'selected' : ''}>
                                    Map to: ${esc(f.name)}
                                </option>
                            `).join('')}
                        </select>

                        <button class="card-delete-btn" onclick="OL.removeRegistryTypeByKey('${t.typeKey}')">×</button>
                    </div>`;
                }).join('')}
            </div>

            <div class="manager-footer-add">
                <label class="modal-section-label">Quick Add New Type</label>
                <div class="add-type-form">
                    <input type="text" id="new-type-icon" class="modal-input icon-input" placeholder="⚙️" maxlength="2">
                    <input type="text" id="new-type-input" class="modal-input name-input" placeholder="New Type Name...">
                    <button class="btn primary" onclick="OL.addNewResourceTypeFlat()">Add Type</button>
                </div>
                
                <div class="emoji-quick-grid">
                    ${quickIcons.map(icon => `
                        <div class="emoji-option" onclick="document.getElementById('new-type-icon').value='${icon}'">${icon}</div>
                    `).join('')}
                </div>
            </div>
        </div>`;
    openModal(html);
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
    if (steps.length === 0) {
        return `<div class="empty-hint p-10">No steps defined. Use the Visual Editor to add sequence logic.</div>`;
    }

    return steps.map((step, idx) => `
        <div class="sop-step-row" style="display:flex; align-items:flex-start; gap:10px; padding:8px; border-bottom:1px solid var(--line);">
            <div class="step-number-circle">${idx + 1}</div>
            <div style="flex:1;">
                <div class="bold" style="font-size:11px;">${esc(step.name || 'Untitled Step')}</div>
                ${step.notes ? `<div class="tiny muted">${esc(step.notes)}</div>` : ''}
            </div>
        </div>
    `).join('');
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
        console.log(`✅ Updated Type Registry: ${entry.type} is now ${value}`);
        // Refresh the visualizer so the sidebar/inspector immediately reflect the new icon
        OL.renderVisualizer(location.hash.includes('vault'));
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
             style="${scopeData ? `border-left: 4px solid ${statusColor} !important;` : ''}">
            
            <div class="card-header" style="display:flex; justify-content: space-between; align-items: flex-start;">
                <div class="card-title" style="flex:1; font-weight:600;">${esc(res.name || "Unnamed")}</div>
                
                <div class="card-controls" style="display:flex; align-items:center; gap:6px;">
                    ${numberingHtml}
                    
                    <span class="vault-tag" style="${tagStyle} padding: 2px 6px; font-size: 8px; border-radius: 3px; font-weight: bold;">
                        ${isMaster ? 'MASTER' : 'LOCAL'}
                    </span>

                    ${res.isLocked ? '' : `<button class="card-delete-btn" onclick="event.stopPropagation(); OL.universalDelete('${res.id}', 'resources')">×</button>`}
                </div>
            </div>

            <div class="card-body" style="margin-top: 6px;">
                <div style="display:flex; justify-content:space-between; align-items:flex-end;">
                    <div>
                        <div class="tiny accent bold uppercase" style="font-size: 8px; letter-spacing: 0.5px; opacity: 0.8;">
                            ${esc(res.archetype || "Base")}
                        </div>
                        <div class="tiny muted" style="font-size: 10px; opacity: 0.6;">
                            ${OL.getRegistryIcon(res.type)} ${esc(res.type || "General")}
                        </div>
                    </div>

                    ${scopeData ? `
                        <div style="display:flex; flex-direction:column; align-items:flex-end; gap:3px;">
                            <div class="pill tiny" style="background:${statusColor}22; color:${statusColor}; border:1px solid ${statusColor}44; font-size:8px; font-weight:bold; padding: 1px 5px;">
                                ${scopeData.status.toUpperCase()}
                            </div>
                            <div class="tiny muted bold" style="font-size: 8px; opacity: 0.5;">
                                👤 ${esc(scopeData.responsibleParty || 'TBD')}
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
    if (!state.v2) state.v2 = {}; 
    if (!state.v2.activeCommentTab) state.v2.activeCommentTab = 'internal';
    if (!targetId) return;

    const isAdmin = true//state.adminMode === true || window.location.search.includes('admin=');
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

      // 🎯 NEW: AUTO-MAPPING SECTION
      const appMappingHtml = `
      <div class="card-section" style="margin-bottom: 20px; border-bottom: 1px solid var(--line); padding-bottom: 20px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <label class="modal-section-label" style="margin:0;">📱 PRIMARY APPLICATION</label>
              ${isManualOverride ? '<span class="tiny accent bold" style="font-size:8px;">CUSTOM OVERRIDE</span>' : ''}
          </div>

          <div id="modal-app-pill-container">
              ${isZap ? `<div class="pill soft tiny muted" style="width:100%; border-style:dashed; justify-content:center;">⚡ Multi-App Automation</div>` : 
                res.appId ? `
                  <div class="pill ${isManualOverride ? 'accent' : 'primary'}" style="display:flex; justify-content:space-between; align-items:center; width:100%;">
                      <div style="display:flex; align-items:center; gap:8px;">
                          <span>${isManualOverride ? '✏️' : '🤖'}</span>
                          <span style="font-weight:bold;">${esc(res.appName)}</span>
                      </div>
                      <b class="is-clickable" style="padding: 2px 6px; opacity: 0.5;" 
                        onclick="OL.handleResourceSave('${res.id}', 'appId', null); OL.handleResourceSave('${res.id}', 'appName', null); OL.openResourceModal('${res.id}')">
                        ×
                      </b>
                  </div>
              ` : `
                  <div class="search-map-container">
                      <input type="text" class="modal-input tiny" placeholder="Search Apps to Override..." 
                            onfocus="OL.filterAppSearch('${res.id}', null, true, '')"
                            oninput="OL.filterAppSearch('${res.id}', null, true, this.value)">
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

        let displayVal = num(activeData.data?.[varKey]);
        let inputProps = "";
        let badge = "";

        if (isZap && isStepVar) {
            // 🚀 3. THE TALLY (Pulling from the resolved Master Resource)
            const actualStepCount = (projectRes.steps || []).length;
            displayVal = actualStepCount;
            
            inputProps = "readonly style='background:rgba(255,159,67,0.1); color:#ff9f43; border-color:#ff9f43; cursor:not-allowed;'";
            badge = `<span style="color:#ff9f43; font-size:9px; margin-left:5px; font-weight:bold;">⚡ AUTO</span>`;

            // 🚀 4. SYNC BACK TO STORAGE
            // Note: We save to activeData.id (the Line Item or Resource ID) 
            // to ensure the price updates on the sheet you are currently looking at.
            if (num(activeData.data?.[varKey]) !== actualStepCount) {
                if (!activeData.data) activeData.data = {};
                activeData.data[varKey] = actualStepCount;
                OL.updateResourcePricingData(activeData.id, varKey, actualStepCount);
            }
        }

        return `
            <div class="modal-column">
                <label class="tiny muted">${esc(v.label)} ($${v.value})${badge}</label>
                <input type="number" class="modal-input tiny" 
                    value="${displayVal}" 
                    ${inputProps}
                    oninput="OL.updateResourcePricingData('${activeData.id}', '${varKey}', this.value)">
            </div>`;
    }).join("");

    // 🚀 FORCE VISIBLE FOR TESTING: Remove "isAdmin &&" to show regardless of permissions
    const adminPricingHtml = (isAdmin && relevantVars?.length > 0) ? `
        <div class="card-section" style="margin-bottom: 20px; padding: 15px; background: rgba(255,255,255,0.02); border: 1px solid var(--line); border-radius: 8px; display:block !important;">
            <label class="modal-section-label">⚙️ PRICING CONFIG</label>
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px; margin-top:10px;">
                ${pricingRows}
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

  // --- 🔗 SPLIT DEPENDENCIES ---
const allDeps = res.dependencies || [];
const taskDeps = allDeps.filter(d => d.type === 'task');
const resDeps = allDeps.filter(d => d.type === 'resource');

const dependencyHtml = `
    <div class="card-section" style="margin-top:20px; border-top: 1px solid var(--line); padding-top:15px;">
        <label class="modal-section-label">📋 TASK DEPENDENCIES (PROJECT-SPECIFIC)</label>
        <div class="dp-manager-list" id="task-dependency-list">
            ${taskDeps.map((dep, idx) => renderDependencyRow(dep, res.id)).join('') || '<div class="tiny muted p-10">No tasks linked.</div>'}
        </div>
        <div class="search-map-container" style="margin-top:8px;">
            <input type="text" class="modal-input tiny" placeholder="Search or Create Task..." 
                   onfocus="OL.filterDependencySearch('${res.id}', 'task', '')"
                   oninput="OL.filterDependencySearch('${res.id}', 'task', this.value)">
            <div id="task-dep-results" class="search-results-overlay"></div>
        </div>
    </div>

    <div class="card-section" style="margin-top:20px; border-top: 1px solid var(--line); padding-top:15px;">
        <label class="modal-section-label">🛠️ RESOURCE DEPENDENCIES (INFRASTRUCTURE)</label>
        <div class="dp-manager-list" id="res-dependency-list">
            ${resDeps.map((dep, idx) => renderDependencyRow(dep, res.id)).join('') || '<div class="tiny muted p-10">No resources linked.</div>'}
        </div>
        <div class="search-map-container" style="margin-top:8px;">
            <input type="text" class="modal-input tiny" placeholder="Search Project Library..." 
                   onfocus="OL.filterDependencySearch('${res.id}', 'resource', '')"
                   oninput="OL.filterDependencySearch('${res.id}', 'resource', this.value)">
            <div id="res-dep-results" class="search-results-overlay"></div>
        </div>
    </div>
`;

  //------- SCOPING STATUS ---------//

  const scopeData = OL.getScopingDataForResource(res.id);
  let scopeContextHtml = "";

  if (scopeData) {
      scopeContextHtml = `
          <div class="card-section" style="background: rgba(var(--accent-rgb), 0.05); border: 1px solid var(--accent); padding: 15px; border-radius: 8px; margin-bottom: 20px; display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
              <div>
                  <label class="tiny muted bold uppercase" style="font-size:9px; display:block; margin-bottom:5px;">Scoping Status</label>
                  <select class="modal-input tiny" onchange="OL.updateLineItem('${scopeData.id}', 'status', this.value)">
                      ${['Do Now', 'Do Later', "Don't Do", 'Done'].map(s => `<option value="${s}" ${scopeData.status === s ? 'selected' : ''}>${s}</option>`).join('')}
                  </select>
              </div>
              <div>
                  <label class="tiny muted bold uppercase" style="font-size:9px; display:block; margin-bottom:5px;">Responsible Party</label>
                  <select class="modal-input tiny" onchange="OL.updateLineItem('${scopeData.id}', 'responsibleParty', this.value)">
                      <option value="Sphynx" ${scopeData.responsibleParty === 'Sphynx' ? 'selected' : ''}>Sphynx</option>
                      <option value="Client" ${scopeData.responsibleParty === 'Client' ? 'selected' : ''}>Client</option>
                      <option value="Joint" ${scopeData.responsibleParty === 'Joint' ? 'selected' : ''}>Joint</option>
                  </select>
              </div>
          </div>
      `;
  }

  // Inside OL.openResourceModal...
  const activeTab = state.v2?.activeCommentTab || 'internal';
  const isGuest = !!window.IS_GUEST;

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
                <label class="modal-section-label">📋 DOCUMENT COLLECTION</label>
                <div id="file-list-container" style="display:flex; flex-direction:column; gap:10px; margin-top:10px;">
                    ${(res.files || []).map((file, idx) => `
                        <div class="file-row" style="display:flex; align-items:center; gap:10px; padding:10px; background:rgba(0,0,0,0.2); border-radius:6px; border: 1px solid rgba(255,255,255,0.05);">
                            <div style="flex: 1;">
                                <input type="text" class="modal-input tiny" value="${esc(file.name)}" 
                                      style="font-weight:bold; border:none; background:transparent; padding:0;"
                                      onblur="OL.updateContainerFile('${res.id}', ${idx}, 'name', this.value)">
                            </div>
                            
                            <div style="flex: 2; display:flex; gap:5px;">
                                <input type="text" class="modal-input tiny" placeholder="Paste link or URL..." 
                                      value="${esc(file.url || '')}" 
                                      onblur="OL.updateContainerFile('${res.id}', ${idx}, 'url', this.value)">
                                
                                ${file.url ? `
                                    <a href="${file.url}" target="_blank" class="btn primary tiny" style="padding:0 10px;">🚀</a>
                                ` : `
                                    <button class="btn tiny soft" onclick="OL.simulateUpload('${res.id}', ${idx})" title="Upload PDF">📁</button>
                                `}
                            </div>
                            <button class="card-delete-btn" style="position:static;" onclick="OL.removeFileFromContainer('${res.id}', ${idx})">×</button>
                        </div>
                    `).join('')}
                </div>
                <button class="btn tiny soft full-width" style="margin-top:10px; border-style:dashed;" 
                        onclick="OL.addFileToContainer('${res.id}')">+ Add Document Entry</button>
            </div>
        `;
    }

    // --- 🚀 FINAL ASSEMBLY ---
    let bodyContent = "";
    if (isHierarchy) {
        // --- MODE A: DRAGGABLE HIERARCHY HUB ---
        if (!res.tree) res.tree = [{ id: uid(), name: "Clients", children: [] }];

        bodyContent = `
            <div class="card-section" style="background: rgba(255,255,255,0.02); padding: 20px; border-radius: 8px; border: 1px solid var(--line);">
                <label class="modal-section-label" style="color: var(--accent);">📁 FOLDER ARCHITECTURE</label>
                <p class="tiny muted" style="margin-bottom: 15px;">Drag handles ⠿ to reorder. Root 'Clients' is protected.</p>
                
                <div id="hierarchy-tree-root" class="hierarchy-container">
                    ${OL.renderHierarchyTree(res.id, res.tree)}
                </div>
                
                <div style="margin-top: 20px; padding-top: 15px; border-top: 1px solid var(--line);">
                    <button class="btn tiny primary" onclick="OL.addFolderNode('${res.id}')">+ Add Root Folder</button>
                </div>
            </div>
        `;
    }
    else if (isCompliance) {
        // --- MODE B: COMPLIANCE DOCS---
        bodyContent = `
            <div class="card-section" style="margin-top:10px; background: rgba(255,255,255,0.02); padding: 20px; border-radius: 8px; border: 1px solid var(--line);">
                <label class="modal-section-label">📋 DOCUMENT COLLECTION</label>
                <div id="file-list-container" style="display:flex; flex-direction:column; gap:10px; margin-top:10px;">
                    ${(res.files || []).map((file, idx) => `
                        <div class="file-row" style="display:flex; align-items:center; gap:10px; padding:10px; background:rgba(0,0,0,0.2); border-radius:6px; border: 1px solid rgba(255,255,255,0.05);">
                            <div style="flex: 1.5;">
                                <input type="text" class="modal-input tiny" value="${esc(file.name)}" 
                                       style="font-weight:bold; border:none; background:transparent; padding:0; color:var(--accent);"
                                       onblur="OL.updateContainerFile('${res.id}', ${idx}, 'name', this.value)">
                            </div>
                            <div style="flex: 2.5; display:flex; gap:5px;">
                                <input type="text" class="modal-input tiny" placeholder="Paste link or URL..." 
                                       value="${esc(file.url || '')}" 
                                       onblur="OL.updateContainerFile('${res.id}', ${idx}, 'url', this.value)">
                                ${file.url ? `
                                    <a href="${file.url}" target="_blank" class="btn primary tiny" style="padding:0 12px; height: 32px; display:flex; align-items:center; background:var(--accent); color:black; font-weight:bold; text-decoration:none;">🚀 OPEN</a>
                                ` : `
                                    <button class="btn tiny soft" onclick="OL.simulateUpload('${res.id}', ${idx})" style="height:32px;">📁</button>
                                `}
                            </div>
                            <button class="card-delete-btn" style="position:static; opacity:0.3;" onclick="OL.removeFileFromContainer('${res.id}', ${idx})">×</button>
                        </div>
                    `).join('')}
                </div>
                <button class="btn tiny soft full-width" style="margin-top:15px; border-style:dashed; padding: 10px;" 
                        onclick="OL.addFileToContainer('${res.id}')">+ Add Document Entry</button>
            </div>
        `;
    }
    else if (isNaming) {
        // --- MODE C: NAMING CONVENTIONS HUB ---
        const hierarchyRes = (client?.projectData?.localResources || []).find(r => r.name === "Folder Hierarchy");
        const sections = [
            { id: 'household', label: '🏠 HOUSEHOLD NAMING' },
            { id: 'folders', label: '📁 FOLDER NAMING' }
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
       bodyContent =`${roundInputHtml}
          ${scopeContextHtml}
          ${hierarchyHtml}
          ${adminPricingHtml}
          ${dependencyHtml}
          ${appMappingHtml}
          ${containerHtml}

          <div class="card-section" style="margin-top:20px;">
              <label class="modal-section-label">📝 Description & Access Notes</label>
              <textarea class="modal-textarea" 
                      placeholder="Enter login details, account purpose, or specific access instructions..." 
                      style="min-height: 80px; font-size: 12px; width: 100%; background: rgba(0,0,0,0.2); border: 1px solid var(--line); border-radius: 4px; color: white; padding: 10px;"
                      onblur="OL.handleResourceSave('${res.id}', 'description', this.value)">${esc(res.description || '')}</textarea>
          </div>
          ${OL.renderResourceMiniMaps(res.id)}
          ${showWorkflowSteps ? `
            <div class="card-section" style="margin-top:20px; padding-top:20px; border-top: 1px solid var(--line);">
                <label class="modal-section-label">📋 WORKFLOW STEPS</label>
                <div style="display:flex; gap:8px; width: 100%; padding-bottom: 10px;">
                    <button class="btn tiny primary" onclick="OL.goToResourceInMap('${res.id}')">🎨 Visual Editor</button>
                </div>
                <div id="sop-step-list">${renderSopStepList(res)}</div>
            </div>
        ` : ''}
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
                          : `OL.openInspector('${conn.id}')`;

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

          ${typeSpecificHtml}`
      }
      // --- 🧱 FINAL RENDER ---
    const html = `
        <div class="modal-head" style="padding: 20px; border-bottom: 1px solid var(--line); background: var(--panel-dark);">
            <div style="display: flex; flex-direction: column; gap: 12px; width: 100%;">
                <div style="display: flex; align-items: flex-start; gap: 12px; width: 100%;">
                    <span style="font-size: 24px; margin-top: 2px;">${isCompliance ? '📋' : '🛠️'}</span>
                    <div style="flex-grow: 1;">
                        <textarea class="header-editable-input" id="modal-res-name"
                            style="background: transparent; border: none; color: inherit; font-size: 22px; font-weight: bold; width: 100%; outline: none; resize: none; overflow: hidden;"
                            onblur="OL.handleResourceSave('${res.id}', 'name', this.value)">${esc(res.name)}</textarea>
                    </div>
                </div>
                <div style="display: flex; gap: 8px; align-items: center; padding-left: 36px;">
                    ${originPill} ${typePill} ${backBtn}
                    ${hasHistory ? `<button class="btn tiny soft" style="color:black!important; background:#fff!important;" onclick="OL.navigateBack()">⬅️ Back</button>` : ''}
                    ${canPromote ? `<button class="btn tiny primary" style="background:#fbbf24!important; color:black!important;" onclick="OL.pushToMaster('${res.id}')">⭐ Promote to Master</button>` : ''}
                </div>
            </div>
        </div>

        <div class="modal-layout-wrapper" style="display: flex; height: 75vh; overflow: hidden;">
            <div class="modal-body" style="flex: 1.5; overflow-y: auto; padding: 20px;">
                ${bodyContent}
            </div>

            <aside class="modal-sidebar" style="flex: 1; display: flex; flex-direction: column; background: rgba(0,0,0,0.05); border-left: 1px solid var(--line);">
                <div style="display: flex; border-bottom: 1px solid var(--line);">
                    ${!isGuest ? `<div class="comment-tab ${activeTab === 'internal' ? 'active' : ''}" onclick="state.v2.activeCommentTab='internal'; OL.openResourceModal('${res.id}')" style="flex:1; padding: 12px; text-align:center; font-size:10px; cursor:pointer; font-weight:bold; ${activeTab === 'internal' ? 'color:var(--accent); border-bottom:2px solid var(--accent);' : 'opacity:0.5'}">INTERNAL NOTES</div>` : ''}
                    <div class="comment-tab ${activeTab === 'client' ? 'active' : ''}" onclick="state.v2.activeCommentTab='client'; OL.openResourceModal('${res.id}')" style="flex:1; padding: 12px; text-align:center; font-size:10px; cursor:pointer; font-weight:bold; ${activeTab === 'client' ? 'color:#10b981; border-bottom:2px solid #10b981;' : 'opacity:0.5'}">CLIENT FEEDBACK</div>
                </div>
                <div id="comments-list-${res.id}" style="flex: 1; overflow-y: auto; padding: 15px;">
                    ${renderCommentsList(res, activeTab)}
                </div>
                <div class="comment-input-zone" style="padding: 15px; border-top: 1px solid var(--line);">
                    <textarea id="new-comment-input-${res.id}" class="modal-textarea" placeholder="Type a message..." style="min-height: 60px; margin-bottom: 8px; font-size: 11px;"></textarea>
                    <button class="btn tiny full-width" style="background:${activeTab === 'client' ? '#10b981' : 'var(--accent)'};" onclick="OL.addResourceComment('${res.id}', ${activeTab === 'client'})">Post</button>
                </div>
            </aside>
        </div>
    `;
    
    openModal(html);
    setTimeout(() => {
        const el = document.getElementById('modal-res-name');
        if (el) el.style.height = el.scrollHeight + 'px';
    }, 10);
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
                    <span style="font-size: 12px;">${node.children?.length > 0 ? '📂' : '📁'}</span>
                    
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
    const icon = OL.getRegistryIcon(res.type);
    
    // Milestone Check
    const isMilestone = (res.steps || []).some(s => s.targetResourceId); 

    // Use RGBA for the tint so it adapts to Light/Dark backgrounds
    const bgTint = isActive ? 'rgba(251, 191, 36, 0.15)' : 'rgba(var(--text-rgb), 0.05)';
    const borderColor = isMilestone ? '#fbbf24' : (isActive ? 'var(--accent)' : 'var(--line)');

    return `
        <div class="mini-node ${status} ${isMilestone ? 'is-milestone' : ''}" 
             onclick="event.stopPropagation(); OL.openResourceModal('${res.id}')"
             style="cursor:pointer; padding:8px; border-radius:8px; background:${bgTint}; border:1px solid ${borderColor}; min-width:120px; position:relative;">
            <div style="display:flex; flex-direction:column; align-items:center; gap:4px;">
                <span style="font-size:14px; color:var(--text-main);">${icon}</span>
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

OL.handleResourceSave = function(id, field, value) {
    const data = OL.getCurrentProjectData();
    const res = data.resources.find(r => String(r.id) === String(id));
    
    if (res) {
        res[field] = value;
        
        // 💾 Persist to Firebase/DB
        OL.persist().then(() => {
            // 🚩 THE FIX: Check where we are before redirecting
            const modalOpen = document.getElementById('active-modal-box');
            const inspectorOpen = document.getElementById('v2-inspector-panel')?.classList.contains('open');

            if (modalOpen) {
                // If the main modal is open, just refresh its content
                OL.openResourceModal(id);
            } else if (inspectorOpen) {
                // If inspector is open, refresh the inspector
                OL.openInspector(id, null, 'cards');
            } else {
                // Only go back to the map if no detail view is active
                OL.renderVisualizer(); 
            }
        });
    }
};

// 4. RESOURCE CARD & FOLDER RENDERERS
window.renderVaultRatesPage = function () {
  const container = document.getElementById("mainContent");
  if (!container) return;

  document.body.classList.remove('is-visualizer', 'fs-mode-active');
  document.body.style.overflow = 'auto';
  document.documentElement.style.overflow = 'auto';

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

    // 1. Deep Clone the template
    const newAnalysis = JSON.parse(JSON.stringify(template));
    
    // 2. Localize and Link
    newAnalysis.id = "anly-" + Date.now();
    newAnalysis.masterRefId = templateId;
    newAnalysis.isMaster = false;
    
    // 3. 🧠 THE SYNC BRIDGE: Clear scores but push Prices to Registry
    if (newAnalysis.apps) {
        newAnalysis.apps = newAnalysis.apps.map(app => {
            // Find the corresponding App Card in the project library
            // (Matching by either strict ID or by Name)
            const appCard = client.projectData.localApps?.find(a => 
                a.id === app.appId || a.masterRefId === app.appId || a.name === app.name
            );

            // 🚀 If the template has price research, update the App Card billing info
            if (appCard) {
                // If the app card doesn't have a price yet, or it's 0, adopt the research price
                if (!appCard.monthlyCost || appCard.monthlyCost === 0) {
                    appCard.monthlyCost = app.monthlyCost || 0;
                    appCard.clientTier = app.clientTier || "Standard";
                    console.log(`📡 Auto-synced price for ${appCard.name}: $${appCard.monthlyCost}`);
                }
                
                // Ensure the ID in the Matrix matches the ID in the project library
                app.appId = appCard.id; 
            }

            return {
                ...app,
                scores: {} // 🧼 Always wipe evaluative scores for new projects
            };
        });
    }
    
    // 4. Save to Project
    if (!client.projectData.localAnalyses) client.projectData.localAnalyses = [];
    client.projectData.localAnalyses.push(newAnalysis);

    OL.persist();
    OL.closeModal();
    
    // 5. Refresh UI
    if (typeof renderAnalysisModule === "function") {
        renderAnalysisModule(false);
    }
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
                        <button class="btn tiny primary" onclick="OL.universalPrint('${analysisId}', ${isMaster})">🖨️ Print</button>
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
                                oninput="this.style.height = ''; this.style.height = this.scrollHeight + 'px'"
                                onblur="OL.updateAnalysisNote('${analysisId}', '${appObj.appId}', '${feat.id}', this.value, ${isMaster})"
                            >${esc(currentNote)}</textarea>

                            <div style="display: ${isNotIncluded ? 'none' : 'flex'}; 
                                        align-items: center; gap: 8px; background: rgba(0,0,0,0.02); 
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
OL.handleMatrixPricingChange = async function(anlyId, appId, featId, value) {
    await OL.updateAndSync(() => {
        const client = getActiveClient();
        const analyses = OL.getScopedAnalyses();
        const anly = analyses.find(a => a.id === anlyId);
        const appInMatrix = anly?.apps.find(a => a.appId === appId);
        
        if (!appInMatrix) return;
        
        const [type, tierName] = value.split('|');

        // 1. Update the Matrix Data
        if (!appInMatrix.featPricing) appInMatrix.featPricing = {};
        appInMatrix.featPricing[featId] = {
            type: type,
            tierName: tierName || null,
            addonPrice: appInMatrix.featPricing[featId]?.addonPrice || 0
        };

        // 🚀 2. THE SYNC BRIDGE: Update the App Card
        if (type === 'tier' && tierName && client) {
            const appCard = client.projectData.localApps.find(a => a.id === appId || a.masterRefId === appId);
            if (appCard) {
                // Find the price of this tier from the matrix app's pricingTiers
                const tierObj = appInMatrix.pricingTiers?.find(t => t.name === tierName);
                if (tierObj) {
                    appCard.monthlyCost = parseFloat(tierObj.price) || 0;
                    appCard.clientTier = tierName;
                    console.log(`📡 Syncing ${appCard.name} to Tier: ${tierName} ($${tierObj.price})`);
                }
            }
        }
    });

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

        if (mE.clientY < 150) { 
            let accX = 40; 
            const laneElements = document.querySelectorAll('.v2-lane-section:not(.start-trigger)');
            
            laneElements.forEach((laneEl, idx) => {
                const stage = stages[idx];
                if (!stage) return;
                const w = stage.width || 320;
                const isNearLine = mouseCanvasX > (accX + w - 30) && mouseCanvasX < (accX + w + 30);
                
                if (isNearLine) {
                    isResizingLane = true;
                    pendingStageIdx = idx;
                    const newWidth = Math.max(300, mouseCanvasX - accX);
                    pendingWidthChange = newWidth;
                    laneEl.style.width = `${newWidth}px`;
                }
                accX += w;
            });
        }
    };

    const onUp = async (uE) => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        
        indicator.style.display = 'none';
        if (el) el.classList.remove('is-dragging-ghost');

        if (isResizingLane && pendingStageIdx !== null) {
            await OL.updateAndSync(() => {
                stages[pendingStageIdx].width = pendingWidthChange;
            });
            isResizingLane = false;
            OL.renderVisualizer();
            return;
        }

        el.style.display = 'none';
        const dropPointEl = document.elementFromPoint(uE.clientX, uE.clientY);
        el.style.display = 'block';

        const stepRow = dropPointEl?.closest('.v2-step-item');
        const targetCardEl = dropPointEl?.closest('.v2-node-card');
        const isOverTopShelf = dropPointEl?.closest('#global-shelf');
        const isOverWorkbench = dropPointEl?.closest('#v2-workbench-sidebar');

        if (stepRow && targetCardEl && targetCardEl.id !== `v2-node-${res.id}`) {
            const targetId = targetCardEl.id.replace('v2-node-', '');
            const targetRes = resources.find(r => String(r.id) === String(targetId));
            const stepIdAttr = stepRow.getAttribute('data-step-id');
            const stepUniqueId = stepIdAttr ? stepIdAttr.split('-').pop() : null;
            const step = (targetRes.steps || []).find(s => String(s.id) === String(stepUniqueId));

            if (step) {
                if (!step.links) step.links = [];
                step.links.push({ id: res.id, name: res.name, type: res.type });
                await OL.persist();
                OL.renderVisualizer();
                return;
            }
        }

        if (targetCardEl && targetCardEl.id !== `v2-node-${res.id}` && !isOverTopShelf && !isOverWorkbench) {
            const targetId = targetCardEl.id.replace('v2-node-', '');
            const targetRes = resources.find(r => String(r.id) === String(targetId));

            if (targetRes && confirm(`Merge steps from "${res.name}" into "${targetRes.name}"?`)) {
                await OL.updateAndSync(() => {
                    const stepsToMove = JSON.parse(JSON.stringify(res.steps || []));
                    targetRes.steps = [...(targetRes.steps || []), ...stepsToMove].filter(Boolean);
                    const resIdx = resources.findIndex(r => String(r.id) === String(res.id));
                    if (resIdx > -1) resources.splice(resIdx, 1);
                    OL.refreshFamilyNaming(targetRes, resources);
                    OL.syncLogicPorts();
                });
                OL.renderVisualizer();
                return;
            }
        }

        if (isOverTopShelf || isOverWorkbench) {
            const shelfContents = document.getElementById('shelf-contents');
            const workbenchContents = document.getElementById('workbench-contents');
            const container = isOverTopShelf ? shelfContents : workbenchContents;
            if (!container) return;

            const siblings = Array.from(container.querySelectorAll('.v2-node-card:not(.is-dragging-ghost)'));
            let targetResId = null;
            for (let i = 0; i < siblings.length; i++) {
                const rect = siblings[i].getBoundingClientRect();
                const isBefore = isOverTopShelf ? (uE.clientX < rect.left + rect.width / 2) : (uE.clientY < rect.top + rect.height / 2);
                if (isBefore) {
                    targetResId = siblings[i].id.replace('v2-node-', '');
                    break;
                }
            }

            await OL.updateAndSync(() => {
                const currentData = OL.getCurrentProjectData();
                const liveResources = currentData.resources; 
                const draggedIdx = liveResources.findIndex(r => String(r.id) === String(res.id));
                if (draggedIdx === -1) return;
                const [movedItem] = liveResources.splice(draggedIdx, 1);
                movedItem.isGlobal = true;
                movedItem.isTopShelf = !!isOverTopShelf;
                movedItem.stageId = null;
                delete movedItem.coords;
                if (targetResId) {
                    const insertIdx = liveResources.findIndex(r => String(r.id) === String(targetResId));
                    liveResources.splice(insertIdx, 0, movedItem);
                } else {
                    liveResources.push(movedItem);
                }
            });
            OL.renderVisualizer();
            return;
        } else {
            const rect = canvas.getBoundingClientRect();
            const canvasX = (uE.clientX - rect.left) / zoom;
            const canvasY = (uE.clientY - rect.top) / zoom;
            res.coords = { x: Math.round(canvasX - 110), y: Math.round(canvasY - 20) };
            res.isGlobal = false;
            res.isTopShelf = false;
            let accX = 40; 
            for (let s of stages) {
                const w = s.width || 320;
                if (canvasX >= accX && canvasX <= accX + w) {
                    res.stageId = s.id;
                    res._col = Math.floor(Math.max(0, canvasX - accX) / 300);
                    break;
                }
                accX += w;
            }
        }

        await OL.updateAndSync(() => { 
            OL.autoAlignNodes(false);
            OL.drawConnections();
        });
        OL.renderVisualizer();
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
};

OL.handleCanvasDrop = async function(e) {
    e.preventDefault();
    const canvas = document.getElementById('v2-canvas');
    if (!canvas) return;
    
    const zoom = state.v2.zoom || 1;
    const rect = canvas.getBoundingClientRect();
    
    const x = (e.clientX - rect.left) / zoom;
    const y = (e.clientY - rect.top) / zoom;

    let dragId = null;
    try {
        const jsonData = e.dataTransfer.getData('application/json');
        dragId = jsonData ? JSON.parse(jsonData).id : null;
    } catch(err) {
        dragId = e.dataTransfer.getData('text/plain');
    }

    if (dragId) {
        const data = OL.getCurrentProjectData();
        const res = data.resources.find(r => String(r.id) === String(dragId));
        
        if (res) {
            res.coords = { x: Math.round(x - 110), y: Math.round(y - 20) };
            res.isGlobal = false;
            res.isTopShelf = false;
            res.isDeleted = false;

            const stages = data.stages || [];
            let accX = 40;
            for (let s of stages) {
                const w = s.width || 320;
                if (x >= accX && x <= accX + w) {
                    res.stageId = s.id;
                    res._col = Math.floor(Math.max(0, x - accX) / 300);
                    break;
                }
                accX += w;
            }

            await OL.persist();
            await OL.autoAlignNodes(false);
            OL.renderVisualizer();
        }
    }
};

OL.autoAlignNodes = async function() {
    const data = OL.getCurrentProjectData();
    const resources = data.resources || [];
    const stages = data.stages || [];
    
    const VERTICAL_GAP = 35;         
    const COLUMN_WIDTH = 300;       
    const START_Y = 120;            
    const LANE_LEFT_PADDING = 40; // 🚀 Keeps cards from touching the left divider

    // Start at the very beginning of the "World"
    let currentXOffset = 0; 

    stages.forEach((stage) => {
        const laneNodes = resources.filter(r => String(r.stageId) === String(stage.id) && !r.isGlobal);
        
        // Sort by current Y to preserve the sequence
        laneNodes.sort((a, b) => (a.coords?.y || 0) - (b.coords?.y || 0));

        const columnYCursors = {}; 

        laneNodes.forEach(node => {
            const col = node._col || 0;
            if (columnYCursors[col] === undefined) columnYCursors[col] = START_Y;

            const element = document.getElementById(`v2-node-${node.id}`);
            let measuredHeight = 100; 

            if (element) {
                measuredHeight = element.offsetHeight;
            }

            // 🚀 THE HORIZONTAL FIX:
            // currentXOffset (previous stages) + Padding + (Column Index * Width)
            node.coords = {
                x: currentXOffset + LANE_LEFT_PADDING + (col * COLUMN_WIDTH),
                y: columnYCursors[col]
            };

            columnYCursors[col] += (measuredHeight + VERTICAL_GAP);
        });

        // Calculate how wide this stage actually needs to be based on how many columns are in it
        const maxColIndex = Math.max(-1, ...Object.keys(columnYCursors).map(Number));
        const calculatedStageWidth = ((maxColIndex + 1) * COLUMN_WIDTH) + (LANE_LEFT_PADDING * 2);
        
        // Update stage width (minimum 400px)
        stage.width = Math.max(400, calculatedStageWidth);
        
        // 🚀 THE ANCHOR: Move the starting point for the NEXT stage
        currentXOffset += stage.width;
    });

    // Save coordinates to Firebase
    await OL.persist();
    
    // Apply visual positions immediately
    resources.forEach(node => {
        const el = document.getElementById(`v2-node-${node.id}`);
        if (el && node.coords) {
            el.style.left = `${node.coords.x}px`;
            el.style.top = `${node.coords.y}px`;
        }
    });

    // Refresh lane backgrounds and connection lines
    OL.renderVisualizer(); 
    if (OL.drawConnections) OL.drawConnections();
};

OL.getCurrentProjectData = function() {
    const hash = window.location.hash || "#/";
    const isVault = hash.startsWith('#/vault');
    
    if (isVault) {
        if (!state.master.stages) state.master.stages = [];
        return state.master; // Already has .stages and .resources
    } else {
        const client = getActiveClient();
        if (!client) return { stages: [], resources: [] };

        // Ensure stages exists
        if (!client.projectData.stages) client.projectData.stages = [];
        
        // 🎯 THE MAPPING FIX: 
        // We point .resources to .localResources so the visualizer 
        // sees the cards it's looking for.
        return {
            ...client.projectData,
            stages: client.projectData.stages,
            resources: client.projectData.localResources || []
        };
    }
};

// 🛡️ Global Logic Menu Closer
document.addEventListener('mousedown', (e) => {
    // If the click is NOT on a logic badge or inside a logic menu, hide all menus
    if (!e.target.closest('.v2-logic-badge') && !e.target.closest('.v2-logic-menu')) {
        document.querySelectorAll('.v2-logic-menu').forEach(m => m.style.display = 'none');
    }
});

OL.renderVisualizer = function() {
    const mainArea = document.getElementById('mainContent');
    if (!mainArea) return;

    const client = getActiveClient();
    if (!client) return; // Guard against null client

    const data = OL.getCurrentProjectData();
    const stages = data.stages || [];
    const resources = (data.resources || []).filter(r => !r.isLocked);

    // 🏷️ Extract Unique Values for Filter Dropdowns
    const types = [...new Set(resources.map(r => r.type))].filter(Boolean).sort();
    const apps = [...new Set(resources.map(r => r.integration?.app))].filter(Boolean).sort();
    const objects = [...new Set(resources.map(r => r.integration?.object))].filter(Boolean).sort();
    const verbs = [...new Set(resources.map(r => r.integration?.verb))].filter(Boolean).sort();
    const assignees = [...new Set([
        ...resources.map(r => r.assigneeName),
        ...resources.flatMap(r => (r.steps || []).map(s => s.assigneeName))
    ])].filter(Boolean).sort();

    const isAnyExpanded = resources.some(r => r.isExpanded);
    const trayOpen = state.ui.sidebarOpen;
    const expandIcon = isAnyExpanded ? '📂' : '📁';
    const toggleIcon = trayOpen ? '🔳' : '⬜';
    const tidyIcon = '🧹';
    const filterIcon = '📶';

    if (!document.getElementById('v2-viewport')) {
        const trayOpen = state.ui.sidebarOpen !== false; // Default to open
        mainArea.innerHTML = `
            <div class="v2-ui-overlay" style="position: absolute; top: 20px; left: 20px; z-index: 5000; pointer-events: none;">
                <div class="v2-master-toolbar" style="display: flex; align-items: center; gap: 10px; pointer-events: auto;">
                    <div class="v2-toolbar">
                        <div class="canvas-search-wrap">
                            <span class="search-icon">🔍</span>
                            <input class="v2-search-input" 
                                type="text" id="canvas-filter-input" placeholder="Search map..." oninput="OL.syncCanvasFilters(this.value)">
                        </div>
                        <div class="v2-search-nav" id="search-nav-controls">
                            <button class="btn tiny soft" onclick="OL.centerPrevCanvasMatch()" title="Previous Result">◀</button>
                            <span id="canvas-match-count" class="tiny muted search-counter">0/0</span>
                            <button class="btn tiny soft" onclick="OL.centerNextCanvasMatch()" title="Next Result">▶</button>
                            <button class="btn tiny danger soft search-clear-btn" onclick="OL.clearAllFilters()" title="Clear Search">✕</button>
                        </div>
                        <button id="filter-menu-btn" class="btn tiny soft" onclick="OL.toggleFilterMenu(event)">
                            ${filterIcon} Filter <span id="active-filter-count" class="pill tiny accent" style="display:none; margin-left:5px; font-size:9px; padding:1px 5px;">0</span>
                        </button>
                        <button class="btn primary tiny" onclick="OL.addNewResourceToCanvas()">+ Add Resource</button>
                        <button class="btn soft tiny" onclick="OL.autoAlignNodes()" title="Tidy">${tidyIcon}</button>
                        <button class="btn soft tiny" onclick="OL.toggleWorkbenchTray()">${toggleIcon}</button>
                        <button class="btn soft tiny" onclick="OL.toggleMasterExpand()">${expandIcon}</button>
                        <div class="divider-v"></div>
                        <button class="btn soft tiny" onclick="OL.zoom(0.1)">+</button>
                        <button class="btn soft tiny" onclick="OL.zoom(-0.1)">-</button>
                    </div>
                </div>
                <div id="v2-filter-submenu" class="v2-toolbar context-menu" style="display: none; margin-top: 10px; flex-wrap: wrap; gap: 8px;">
                    <select id="filter-type" class="tiny-select" onchange="OL.syncCanvasFilters()">
                        <option value="">All Types</option>
                        ${types.map(t => `<option value="${t}">${t}</option>`).join('')}
                    </select>
                    <select id="filter-app" class="tiny-select" onchange="OL.syncCanvasFilters()">
                        <option value="">All Apps</option>
                        ${apps.map(a => `<option value="${a}">${a}</option>`).join('')}
                    </select>
                    <select id="filter-assignee" class="tiny-select" onchange="OL.syncCanvasFilters()">
                        <option value="">All Owners</option>
                        ${assignees.map(a => `<option value="${a}">${a}</option>`).join('')}
                    </select>
                    <select id="filter-logic" class="tiny-select" onchange="OL.syncCanvasFilters()">
                        <option value="">Any Logic</option>
                        <option value="has">With λ Logic</option>
                    </select>
                    
                    <select id="filter-delay" class="tiny-select" onchange="OL.syncCanvasFilters()">
                        <option value="">Any Timing</option>
                        <option value="has">With ⏱ Delay</option>
                    </select>

                    <select id="filter-loop" class="tiny-select" onchange="OL.syncCanvasFilters()">
                        <option value="">Any Repeat</option>
                        <option value="has">With ⟳ Loop</option>
                    </select>

                    <select id="filter-scoped" class="tiny-select" onchange="OL.syncCanvasFilters()">
                        <option value="">All Scoped Status</option>
                        <option value="scoped">Scoped ($)</option>
                        <option value="unscoped">Unscoped</option>
                    </select>

                    <select id="filter-data-tag" class="tiny-select" onchange="OL.syncCanvasFilters()">
                        <option value="">All Data Tags</option>
                        ${state.master.datapoints.filter(d => !d.isBundle).map(d => `<option value="${d.id}">${d.name}</option>`).join('')}
                    </select>
                </div>
            </div>

            <div id="v2-viewport" class="${trayOpen ? '' : 'tray-closed'}">
              <aside id="global-shelf" class="global-shelf-container">
                  <div class="global-shelf-label">GLOBAL RESOURCES</div>
                  <div id="shelf-contents"></div>
              </aside>
              
              <div id="v2-main-content">
                  <aside id="v2-workbench-sidebar">
                      ${OL.renderWorkbenchTabs()}
                      <div id="workbench-contents" class="workbench-contents"></div>
                  </aside>

                  <div id="v2-workspace">
                      <div id="v2-canvas-scroll-wrap">
                          <div id="v2-canvas">                     
                              <div id="v2-stage-layer"></div>
                              <div id="v2-node-layer"></div>
                              <svg id="v2-connections">
                                  <defs>
                                      <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="5" refY="3.5" orient="auto" markerUnits="userSpaceOnUse">
                                          <path d="M0,0 L10,3.5 L0,7 Z" fill="var(--accent)" />
                                      </marker>
                                  </defs>
                                  <g id="line-group"></g>
                              </svg>
                          </div>
                      </div>
                  </div>

                  <aside id="v2-inspector-panel">
                      <div id="inspector-content"><div class="empty-state">Select a step to inspect</div></div>
                  </aside>
              </div>
            </div>
        `;
    }    // 1. 🏗️ BUILD THE UI SHELL

    const shelfContents = document.getElementById('shelf-contents');
    const workbenchContents = document.getElementById('workbench-contents');
    const nodeLayer = document.getElementById('v2-node-layer');
    const stageLayer = document.getElementById('v2-stage-layer');

    if (!workbenchContents || !shelfContents) {
        console.warn("⏳ Workbench containers missing. Aborting render pass.");
        return; 
    }

    const canvas = document.getElementById('v2-canvas');
    const traySearch = document.getElementById('tray-search-input')?.value.toLowerCase() || "";
    
    // 1. Clear everything
    [shelfContents, workbenchContents, nodeLayer, stageLayer].forEach(el => { if(el) el.innerHTML = ''; });

    // 🗂️ 2. Resolve what goes in the Workbench
    const activeTab = state.ui.activeWorkbenchTab || 'flows';
    const sidebarSearch = document.getElementById('sidebar-search-input')?.value.toLowerCase() || "";
    let workbenchItems = [];

    if (activeTab === 'flows') {
        // Only show Flows that are NOT yet on the map
        workbenchItems = resources.filter(r => 
            ['Workflow', 'Zap', 'Email Campaign'].includes(r.type) && !r.coords
        );
    } else if (activeTab === 'assets') {
        // Only show Assets that are NOT yet on the map
        workbenchItems = resources.filter(r => 
            !['Workflow', 'Zap', 'Email Campaign'].includes(r.type) && !r.coords
        );
    } else if (activeTab === 'guides') {
        workbenchItems = [...(state.master.howToLibrary || []), ...(client?.projectData?.localHowTo || [])];
    } else if (activeTab === 'data') {
        workbenchItems = state.master.datapoints || [];
    }

    // 🔍 NEW: Filter the resulting list by the Sidebar-specific search string
    if (sidebarSearch) {
        workbenchItems = workbenchItems.filter(item => 
            item.name.toLowerCase().includes(sidebarSearch) || 
            (item.key && item.key.toLowerCase().includes(sidebarSearch))
        );
    }

    // 3. 🎨 RENDER THE WORKBENCH CONTENT
    workbenchItems.forEach(item => {
        const div = document.createElement('div');
        
        if (activeTab === 'data') {
            div.className = 'data-tag-draggable';
            div.draggable = true;
            div.ondragstart = (e) => OL.handleDataDragStart(e, item.id);
            div.style = `padding:8px; margin:5px; background:rgba(167, 139, 250, 0.1); border:1px solid #a78bfa; border-radius:4px; font-size:11px; cursor:grab; color:white;`;
            div.innerHTML = `${item.isBundle ? '📦' : '🏷️'} <b>${item.name}</b>`;
        } else {
            const isGuide = activeTab === 'guides';
            div.id = `v2-node-${item.id}`;
            div.className = `v2-node-card on-shelf ${isGuide ? 'guide-card' : ''}`;
            
            // Interaction Logic: Flows get moved to map, Assets/Guides get linked to steps
            div.onmousedown = (e) => {
                if (activeTab === 'flows') OL.initWBMotion(e, item.id);
                else OL.handleAssetDragStart(e, item.id, activeTab === 'assets' ? 'asset' : 'guide');
            };

            div.innerHTML = `
                <div class="v2-node-header"
                    ondragover="event.preventDefault(); this.classList.add('drag-over');" 
                    ondragleave="this.classList.remove('drag-over');"
                    ondrop="OL.handleStepDrop(event, '${item.id}', null)">

                    <div class="header-row-content">
                        <b class="res-name-text">${isGuide ? '📖 ' : ''}${esc(item.name)}</b>
                    </div>
                </div>
            `;
        }
        if (activeTab === 'flows' || activeTab === 'assets' || activeTab === 'guides' || activeTab === 'data') {
             if (workbenchContents) {
                 workbenchContents.appendChild(div);
             }
        }
    });

    // 🎯 2. CANVAS WIDTH MATH
    const totalCanvasWidth = stages.reduce((acc, s) => acc + (s.width || 320), 0) + 600;
    if (canvas) {
        canvas.style.width = `${totalCanvasWidth}px`;
        canvas.style.transform = `scale(${OL.state.v2.zoom})`;
    }
    const startTrigger = document.createElement('div');
        startTrigger.className = 'v2-lane-section start-trigger';
        startTrigger.style.width = '40px';
        startTrigger.innerHTML = `
            <div class="lane-insert-trigger" onclick="OL.addStageBetween(0)">
                <div class="insert-btn" title="Add First Stage">+</div>
            </div>
        `;
        stageLayer.appendChild(startTrigger);

    // --- 📁 3. RENDER STAGES ---
    stages.forEach((s, idx) => {
        const div = document.createElement('div');
        div.className = 'v2-lane-section';
        div.style.width = `${s.width || 320}px`;
        div.innerHTML = `
            <div class="lane-label">
                <span contenteditable="true" onblur="OL.renameStage(${idx}, this.innerText)">${esc(s.name)}</span>
                <button class="delete-lane-btn" onclick="OL.deleteStage(${idx})">×</button>
            </div>
            <div class="lane-insert-trigger" onclick="OL.addStageBetween(${idx + 1})">
                <div class="insert-btn">+</div>
            </div>
        `;
        stageLayer.appendChild(div);
    });

    let totalZapSteps = 0;

    // --- 📇 4. RENDER RESOURCES ---
    const milestoneIds = new Set();
    resources.forEach(r => {
        (r.steps || []).forEach(s => {
            if (s.targetResourceId) milestoneIds.add(String(s.targetResourceId));
        });
    });

    resources.forEach(res => {
        const isExpanded = res.isExpanded || false;
        const isFocused = OL.focusedResourceId === String(res.id);
        const isMilestone = milestoneIds.has(String(res.id));
        const hasActiveFocus = !!OL.focusedResourceId;

        const stepCount = (res.steps || []).length;

    // 🚀 THE TALLY LOGIC
        if (res.type?.toLowerCase() === 'zap') {
            totalZapSteps += stepCount;
        }

        let cardClass = "resource-card";
        if (hasActiveFocus) {
            cardClass += isFocused ? " focused-node" : " node-dimmed";
        }

        const isInScope = !!OL.isResourceInScope(res.id);
        const scopeBadge = `
            <a href="#/scoping-sheet?focus=${res.id}" 
              class="v2-scope-badge ${isInScope ? 'is-on' : 'is-off'}" 
              onmousedown="event.stopPropagation();" 
              onclick="if(!${isInScope}) { event.preventDefault(); } event.stopPropagation(); sessionStorage.removeItem('active_resource_id'); state.focusedResourceId = null;"
              oncontextmenu="event.preventDefault(); event.stopPropagation(); OL.toggleScopingStatus('${res.id}', ${isInScope})"
              title="Left Click: View in Sheet | Right Click: Toggle Status"
              >
                $
            </a>`;        
            // 🔍 Check if ANY step in this resource has incoming or outgoing logic
        const hasLogic = (res.steps || []).some(s => 
            (s.logic?.in?.length > 0) || (s.logic?.out?.length > 0)
        );

        const logicMenu = `
            <div class="v2-logic-trigger-wrap" style="position: relative; display: inline-block;">
                <button class="v2-logic-badge ${hasLogic ? 'has-logic': ''}"
                  onclick="event.stopPropagation(); OL.toggleLogicMenu('${res.id}')">
                    λ
                </button>
                <div id="logic-menu-${res.id}" class="v2-logic-menu dropdown-plus-menu">
                    <div class="dropdown-item" onclick="OL.setTraceMode('${res.id}', 'in')">📥 Show Inputs</div>
                    <div class="dropdown-item" onclick="OL.setTraceMode('${res.id}', 'out')">📤 Show Outputs</div>
                    <div class="dropdown-item" onclick="OL.setTraceMode('${res.id}', 'both')">↔️ Show Both</div>
                    <div class="divider"></div>
                    <div class="dropdown-item" onclick="OL.setTraceMode('${res.id}', 'trace-start')">⏪ Flow to Start</div>
                    <div class="dropdown-item" onclick="OL.setTraceMode('${res.id}', 'trace-end')">⏩ Flow to End</div>
                    <div class="dropdown-item danger" onclick="OL.setTraceMode(null, null)">🚫 Hide All</div>
                </div>
            </div>
        `;
        const duplicateBadge = `
          <div class="v2-duplicate-badge action-duplicate" 
              data-id="${res.id}"
              title="Duplicate Resource">
              ⿻
          </div>
      `;
        
        // Handle Tray Filtering
        if (res.isGlobal && !res.isTopShelf && traySearch && !res.name.toLowerCase().includes(traySearch)) return;

        const div = document.createElement('div');
        div.id = `v2-node-${res.id}`;
        div.className = `v2-node-card ${cardClass} ${res.isGlobal ? 'on-shelf' : ''} ${isExpanded ? 'is-expanded' : ''} ${isMilestone ? 'is-milestone' : ''}`;
        
        if (!res.isGlobal && res.coords) {
            div.style.left = `${res.coords.x}px`;
            div.style.top = `${res.coords.y}px`;
        }

        const numberingHtml = OL.getPartNumberHtml ? OL.getPartNumberHtml(res) : '';

        div.innerHTML = `
            <div class="v2-node-header" onclick="event.stopPropagation(); OL.openInspector('${res.id}', null, 'cards')">
                <div class="header-row-content">
                    <b class="res-name-text">${esc(res.name)}</b>
                    <div class="header-badges-wrap">
                        <small class="tiny muted uppercase type-badge">${esc(res.type || 'Resource')}</small>
                        ${numberingHtml}
                        ${scopeBadge}
                        ${logicMenu}
                        ${duplicateBadge}
                    </div>
                </div>
            </div>
            <div class="v2-steps-preview" style="display: ${isExpanded ? 'flex' : 'none'}">
                ${(res.steps || []).map((s, i) => {
                    const stepId = s.id || i; 
                    const stepAssignees = s.assignees || [];

                    // 1. Assignee Border Logic
                    const hasTeamAssignee = stepAssignees.some(a => a.name === "Any Team Member" || a.type === "person" || (a.type === "role" && !["Client 1", "Client 2", "Any Client"].includes(a.name)));
                    const hasClientAssignee = stepAssignees.some(a => ["Client 1", "Client 2", "Any Client"].includes(a.name));
                    let borderColor = "transparent"; let borderWidth = "1px";
                    if (hasTeamAssignee) { borderColor = "#22c55e"; borderWidth = "2px"; }
                    else if (hasClientAssignee) { borderColor = "#fbbf24"; borderWidth = "2px"; }
                    
                    // 2. 📥 INCOMING LOGIC SUMMARY (Left Side)
                    const allIn = s.logic?.in || [];
                    const inHasCond = allIn.some(l => l.type === 'link' || !l.type);
                    const inHasNext = allIn.some(l => l.type === 'next');
                    const inHasLoop = allIn.some(l => l.type === 'loop');
                    const inHasDelay = allIn.some(l => l.type === 'delay');
                    const inTooltip = allIn.map(l => `${l.type === 'next' ? '➔' : l.type === 'loop' ? '⟳' :  l.type ==='delay' ? '⏱︎' : 'λ'} From: ${l.rule || 'Previous'}`).join(' | ');

                    // 3. 📤 OUTGOING LOGIC SUMMARY (Right Side)
                    const allOut = s.logic?.out || [];
                    const outHasCond = allOut.some(l => l.type === 'link' || !l.type);
                    const outHasNext = allOut.some(l => l.type === 'next');
                    const outHasLoop = allOut.some(l => l.type === 'loop');
                    const outHasDelay = allOut.some(l => l.type === 'delay');
                    const outTooltip = allOut.map(l => `${l.type === 'next' ? '➔' : l.type === 'loop' ? '⟳' : l.type ==='delay'  ? '⏱︎' : 'λ'} ${l.rule || (l.type === 'next' ? 'Next' : 'Logic')}`).join(' | ');

                    return `
                        <div class="v2-step-item" 
                            data-step-id="${res.id}-${stepId}" 
                            ondragover="event.preventDefault(); OL.handleStepDragOver(event)"
                            ondragleave="OL.handleStepDragLeave(event)"
                            ondrop="OL.handleStepDrop(event, '${res.id}', ${i})"
                            onclick="event.stopPropagation(); OL.openInspector('${res.id}', '${stepId}')"
                            style="border: ${borderWidth} solid ${borderColor}; border-radius: 4px; margin: 2px 0; position: relative;">
                            
                            <span class="step-port port-in" style="pointer-events:none"></span>
                            <span class="step-port port-out" style="pointer-events:none"></span>

                            <div class="step-row-content">
                                <span class="drag-handle" style="cursor: grab; opacity: 0.3; flex-shrink: 0;" draggable="true" ondragstart="OL.handleStepDragStart(event, '${res.id}', ${i})">⠿</span>
                                
                                <div style="display:flex; gap:3px; flex-direction: column; flex-shrink: 0; min-width: 15px;">
                                    ${inHasLoop ? `<span class="step-logic-icon loop" title="${esc(inTooltip)}">⟳</span>` : ''}
                                    ${inHasCond ? `<span class="step-logic-icon active" onclick="event.stopPropagation(); OL.setTraceMode('${res.id}', 'in')" title="${esc(inTooltip)}">λ</span>` : ''}
                                    ${inHasNext ? `<span class="step-logic-icon" onclick="event.stopPropagation(); OL.setTraceMode('${res.id}', 'in')" title="${esc(inTooltip)}">➔</span>` : ''}
                                    ${inHasDelay ? `<span class="step-logic-icon" onclick="event.stopPropagation(); OL.setTraceMode('${res.id}', 'in')" title="${esc(inTooltip)}">⏱︎</span>` : ''}
                                </div>

                                <span style="flex: 1; font-size: 11px; line-height: 1.3; padding: 0 4px;">
                                    <span style="color:var(--accent); margin-right:4px;">${OL.getStepIcon(s)}</span>
                                    ${esc(s.name || 'New Step')}
                                </span>

                                <div style="display:flex; gap:3px; flex-direction: column; flex-shrink: 0; justify-content: flex-end;">
                                    ${outHasLoop ? `<span class="step-logic-icon loop" title="${esc(outTooltip)}">⟳</span>` : ''}
                                    ${outHasCond ? `<span class="step-logic-icon active" onclick="event.stopPropagation(); OL.setTraceMode('${res.id}', 'out')" title="${esc(outTooltip)}">λ</span>` : ''}
                                    ${outHasNext ? `<span class="step-logic-icon" onclick="event.stopPropagation(); OL.setTraceMode('${res.id}', 'out')" title="${esc(outTooltip)}">➔</span>` : ''}
                                    ${outHasDelay ? `<span class="step-logic-icon" onclick="event.stopPropagation(); OL.setTraceMode('${res.id}', 'in')" title="${esc(inTooltip)}">⏱︎</span>` : ''}
                                </div>

                                <span class="delete-step-btn" style="flex-shrink: 0; opacity: 0.2; margin-left: 5px;" onclick="event.stopPropagation(); OL.deleteStep('${res.id}', ${i})">✕</span>
                            </div>
                        </div>

                        ${i < res.steps.length - 1 ? `
                            <div class="v2-step-divider" onclick="event.stopPropagation(); OL.splitCardAtStep('${res.id}', ${i})">
                                <div class="split-icon">✂️</div>
                            </div>` : ''}
                    `;
                }).join('')}
            </div>
            <div class="v2-card-footer">
                <button class="v2-add-step-btn" onclick="event.stopPropagation(); OL.addNewStepToCard('${res.id}')">+ Add Step</button>
                <div class="v2-step-badge" onclick="event.stopPropagation(); OL.toggleSteps('${res.id}')">
                    ${(res.steps || []).length} Steps ${isExpanded ? '▴' : '▾'}
                </div>
            </div>
        `;

        div.onmousedown = (e) => {
            // Keep your existing guards
            if (e.target.closest('.v2-logic-trigger-wrap, .v2-logic-badge, .v2-logic-menu')) return;
            if (e.target.closest('.v2-step-badge, .v2-step-divider, .v2-card-part, .v2-step-item, .v2-add-step-btn, .delete-step-btn')) return;
            
            e.stopPropagation();

            // 💡 ADD THIS: Track mouse position to distinguish between a click and a drag
            const startX = e.clientX;
            const startY = e.clientY;

            const onMouseUp = (upE) => {
                const diffX = Math.abs(upE.clientX - startX);
                const diffY = Math.abs(upE.clientY - startY);

                // If the mouse barely moved (less than 5px), treat it as a click
                if (diffX < 5 && diffY < 5) {
                    if (e.target.closest('.v2-node-header')) {
                        OL.openInspector(res.id, null, 'cards');
                    }
                }
                window.removeEventListener('mouseup', onMouseUp);
            };

            window.addEventListener('mouseup', onMouseUp);

            // Call your existing motion logic
            OL.initWBMotion(e, res.id);
        };

        if (res.isGlobal) {
            // ✅ ONLY handle the Top Shelf here.
            // We ignore the 'else' because OL.renderWorkbenchItemsOnly handles the sidebar.
            if (res.isTopShelf) {
                shelfContents.appendChild(div);
            }
        } else {
            // 📍 Handle the active project resources on the Canvas
            if (res.coords) {
                nodeLayer.appendChild(div);
            }
        }
    });

    const viewport = document.getElementById('v2-canvas-scroll-wrap');
    if (viewport) {
        viewport.ondragover = (e) => e.preventDefault();
        viewport.ondrop = (e) => OL.handleCanvasDrop(e);
    }

    OL.renderFocusControls();
    // --- 🚀 5. FINAL PASS ---
    if (OL.state.v2.pan) {
        const { x, y } = OL.state.v2.pan;
        canvas.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${OL.state.v2.zoom})`;
    }

    // Refresh connections and run any active filters
    OL.renderWorkbenchItemsOnly();
    OL.drawConnections();
    OL.refreshFilterDropdowns();
    if (document.getElementById('canvas-filter-input')?.value) {
        OL.syncCanvasFilters(document.getElementById('canvas-filter-input').value);
    }
};

OL.handleSidebarSearch = function(e) {
    const val = e.target.value;
    
    // 1. Update the global state immediately
    state.ui.sidebarSearchQuery = val;
    
    // 2. ONLY render the items, do NOT call OL.renderVisualizer()
    // This prevents the map, stages, and toolbar from flashing/resetting
    OL.renderWorkbenchItemsOnly();
    
    // 3. Force focus back just in case the browser tried to blur it
    e.target.focus();
};

OL.getStepIcon = function(step) {
    if (!step.links || step.links.length === 0) return '•';
    
    const linked = step.links.map(l => ({
        ...l,
        res: OL.getResourceById(l.id)
    }));

    const check = (str) => {
        const s = str.toLowerCase();
        return linked.some(l => 
            l.type?.toLowerCase().includes(s) || 
            l.res?.type?.toLowerCase().includes(s) ||
            l.name?.toLowerCase().includes(s)
        );
    };

    if (check('email')) return '✉️';
    if (check('form')) return '📄';
    if (check('event') || check('scheduler')) return '📅';
    if (check('guide') || check('sop')) return '📖';
    if (check('signature') || check('sig-')) return '🖋️';
    
    if (check('zap') || check('automation')) return '⚡';
    if (check('database') || check('sheet')) return '📊';
    if (check('legal') || check('contract')) return '⚖️';
    if (check('folder') || check('file')) return '📁';
    if (check('video') || check('recording')) return '🎥';
    if (check('payment') || check('invoice')) return '💰';

    return '🔗'; 
};

OL.renderWorkbenchTabs = function() {
    const tabs = [
        { id: 'flows', label: '🌊 Flows', color: 'var(--accent)' },
        { id: 'assets', label: '📦 Assets', color: '#38bdf8' },
        { id: 'guides', label: '📖 Guides', color: '#fbbf24' },
        { id: 'data', label: '🏷️ Data', color: '#a78bfa' }
    ];

    return `
        <div class="workbench-header" style="background: rgba(0,0,0,0.3); border-bottom: 1px solid var(--line);">
            <div class="workbench-tab-bar" style="display: flex;">
                ${tabs.map(t => `
                    <div class="wb-tab ${state.ui.activeWorkbenchTab === t.id ? 'active' : ''}" 
                        onclick="OL.switchWorkbenchTab('${t.id}')" 
                        style="flex:1; padding: 12px 5px; text-align:center; font-size:9px; font-weight:bold; cursor:pointer; 
                                border-bottom: 2px solid ${state.ui.activeWorkbenchTab === t.id ? t.color : 'transparent'};
                                color: ${state.ui.activeWorkbenchTab === t.id ? t.color : 'var(--text-dim)'};">
                        ${t.label.toUpperCase()}
                    </div>
                `).join('')}
            </div>
            
            <div class="sidebar-search-wrap" style="padding: 10px; border-top: 1px solid rgba(255,255,255,0.05); display: flex; flex-direction: column; gap: 8px;">
                <input type="text" id="sidebar-search-input" 
                  placeholder="Search ${state.ui.activeWorkbenchTab}..." 
                  value="${state.ui.sidebarSearchQuery || ''}"
                  oninput="OL.handleSidebarSearch(event)"
                  autocomplete="off"
                  style="width: 100%; background: rgba(0,0,0,0.2); border: 1px solid var(--line); color: white; padding: 6px 10px; border-radius: 4px; font-size: 11px;">
                
                <div id="sidebar-sub-filter-container">
                    ${state.ui.activeWorkbenchTab === 'assets' ? OL.renderSidebarTypeFilter() : ''}
                </div>
            </div>
        </div>
    `;
};

if (state.v2.hideLinkedAssets === undefined) state.v2.hideLinkedAssets = false;

OL.renderSidebarTypeFilter = function() {
    const activeTab = state.ui.activeWorkbenchTab;
    const hideLinked = state.v2.hideLinkedAssets;
    
    // 🛡️ Guard: Only show filters for Assets and Guides
    if (activeTab !== 'assets' && activeTab !== 'guides') return '';

    // Only show the type dropdown if we are on the Assets tab
    let typeDropdown = '';
    if (activeTab === 'assets') {
        const data = OL.getCurrentProjectData();
        const resources = data.resources || [];
        const types = [...new Set(resources.filter(r => !['Workflow', 'Zap', 'Email Campaign'].includes(r.type)).map(r => r.type))].filter(Boolean).sort();
        
        typeDropdown = `
            <select class="modal-input tiny" 
                    onchange="state.v2.trayTypeFilter = this.value; OL.renderWorkbenchItemsOnly();" 
                    style="margin:0; background: rgba(0,0,0,0.2); border-color: var(--line); font-size: 10px; color: white; width: 100%;">
                <option value="All">All Asset Types</option>
                ${types.map(t => `<option value="${t}" ${state.v2.trayTypeFilter === t ? 'selected' : ''}>${t}</option>`).join('')}
            </select>
        `;
    }

    // 🏗️ The Wrapper: This now returns for both Assets AND Guides
    return `
        <div style="display: flex; flex-direction: column; gap: 8px; padding-top: 4px;">
            ${typeDropdown}
            <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; user-select: none; padding-left: 2px;">
                <input type="checkbox" ${hideLinked ? 'checked' : ''} 
                       onchange="state.v2.hideLinkedAssets = this.checked; OL.renderWorkbenchItemsOnly();"
                       style="width: 12px; height: 12px; cursor: pointer;">
                <span class="tiny muted" style="font-size: 9px; text-transform: uppercase; font-weight: bold; letter-spacing: 0.5px;">
                    Hide Already Linked
                </span>
            </label>
        </div>
    `;
};

OL.renderWorkbenchItemsOnly = function() {
    const workbenchContents = document.getElementById('workbench-contents');
    if (!workbenchContents) return;

    const activeTab = state.ui.activeWorkbenchTab || 'flows';
    const query = (state.ui.sidebarSearchQuery || "").toLowerCase();
    const typeFilter = state.v2.trayTypeFilter || "All";
    const hideLinked = state.v2.hideLinkedAssets;
    
    const data = OL.getCurrentProjectData();
    const resources = (data.resources || []).filter(r => !r.isDeleted && !r.isLocked);

    // 🕵️ BUILD LINKED SET (Scans all steps for Resource AND Guide links)
    const linkedIds = new Set();
    resources.forEach(res => {
        (res.steps || []).forEach(step => {
            (step.links || []).forEach(link => linkedIds.add(String(link.id)));
            // Also check explicit guide IDs if your schema stores them separately
            if (step.howToIds) step.howToIds.forEach(id => linkedIds.add(String(id)));
        });
    });

    let items = [];

    if (activeTab === 'flows') {
        items = resources.filter(r => {
            const isFlow = ['Workflow', 'Zap', 'Email Campaign'].includes(r.type);
            return isFlow && !r.coords && !r.isTopShelf;
        });
    } else if (activeTab === 'assets') {
        items = resources.filter(r => {
            const isAsset = !['Workflow', 'Zap', 'Email Campaign'].includes(r.type);
            const matchesType = (typeFilter === "All" || r.type === typeFilter);
            const passesLinkFilter = !hideLinked || !linkedIds.has(String(r.id));
            return isAsset && matchesType && !r.coords && !r.isTopShelf && passesLinkFilter;
        });
    } else if (activeTab === 'guides') {
        const masterGuides = state.master.howToLibrary || [];
        const localGuides = getActiveClient()?.projectData?.localHowTo || [];
        items = [...masterGuides, ...localGuides].filter(g => {
            const passesLinkFilter = !hideLinked || !linkedIds.has(String(g.id));
            return passesLinkFilter;
        });
    } else if (activeTab === 'data') {
        const datapoints = state.master.datapoints || [];
        
        // Filter by the sidebar search query
        items = datapoints.filter(d => 
            (d.name || "").toLowerCase().includes(query) || 
            (d.key && d.key.toLowerCase().includes(query))
        );

        workbenchContents.innerHTML = '';
        
        if (items.length === 0) {
            workbenchContents.innerHTML = `
                <div class="empty-hint p-10">
                    No datapoints found. <br>
                    <a href="javascript:void(0)" onclick="OL.renderGlobalDataManager()" class="accent">Manage Library</a>
                </div>`; // ⬅️ Changed href to an onclick with OL. prefix
            return;
        }

        items.forEach(item => {
            const div = document.createElement('div');
            div.className = 'data-tag-draggable';
            div.draggable = true;
            
            // 🎨 Purple tag styling
            div.style = `padding:8px; margin:5px; background:rgba(167, 139, 250, 0.1); border:1px solid #a78bfa; border-radius:4px; font-size:11px; cursor:grab; color:white; display:flex; justify-content:space-between; align-items:center;`;
            
            div.ondragstart = (e) => {
                e.dataTransfer.setData("application/sphynx-type", "datapoint");
                e.dataTransfer.setData("application/sphynx-id", item.id);
            };

            div.innerHTML = `
                <div style="display:flex; align-items:center; gap:6px;">
                    <span>${item.isBundle ? '📦' : '🏷️'}</span>
                    <b>${esc(item.name)}</b>
                </div>
                <span class="tiny muted" style="opacity:0.4; font-family:monospace;">${item.key || ''}</span>
            `;
            workbenchContents.appendChild(div);
        });
        return; // Stop execution here for the data tab
    }

    // Apply text search
    if (query.trim()) {
        items = items.filter(i => (i.name || i.title || "").toLowerCase().includes(query.trim()));
    }

    workbenchContents.innerHTML = '';
    items.forEach(item => {
        const div = document.createElement('div');
        const icon = OL.getRegistryIcon(item.type);
        const isGuide = activeTab === 'guides';
        const isInScope = !!OL.isResourceInScope(item.id);
        
        div.id = `v2-node-${item.id}`;
        div.className = `v2-node-card on-shelf ${isGuide ? 'guide-card' : ''}`;
        div.draggable = true;
        div.ondragstart = (e) => {
            e.dataTransfer.setData('application/json', JSON.stringify({ id: item.id, name: item.name || item.title, type: item.type }));
        };

        div.innerHTML = `
            <div class="v2-node-header">
                <div class="header-row-content">
                    <span style="margin-right: 8px; font-size: 14px;">${isGuide ? '📖' : icon}</span>
                    <div style="display: flex; flex-direction: column; flex: 1; min-width: 0;">
                        <b class="res-name-text" style="font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${esc(item.name || item.title)}</b>
                    </div>
                    <div class="header-badges-wrap" style="display: flex; align-items: center; gap: 6px; margin-left: auto; flex-shrink: 0;">
                        ${!isGuide ? `<small class="tiny muted uppercase type-badge" style="font-size: 8px; opacity: 0.6;">${esc(item.type)}</small>` : ''}
                        <div class="v2-scope-badge ${isInScope ? 'is-on' : 'is-off'}" 
                             oncontextmenu="event.preventDefault(); event.stopPropagation(); OL.toggleScopingStatus('${item.id}', ${isInScope}); OL.renderWorkbenchItemsOnly();">
                             $
                        </div>
                    </div>
                </div>
            </div>
        `;
        workbenchContents.appendChild(div);
    });
};

OL.switchWorkbenchTab = function(tabId) {
    state.ui.activeWorkbenchTab = tabId;
    
    const filterContainer = document.getElementById('sidebar-sub-filter-container');
    if (filterContainer) {
        filterContainer.innerHTML = OL.renderSidebarTypeFilter();
    } else {
        const header = document.querySelector('.workbench-header');
        if (header) header.outerHTML = OL.renderWorkbenchTabs();
    }
    
    OL.renderWorkbenchItemsOnly();
};

OL.switchWorkbenchTab(state.ui.activeWorkbenchTab);

// DRAG ASSET/GUIDE
OL.handleAssetDragStart = function(e, id, type) {
    e.dataTransfer.setData("application/sphynx-type", type); // 'asset' or 'guide'
    e.dataTransfer.setData("application/sphynx-id", id);
    e.dataTransfer.effectAllowed = "link";
};

// DRAG DATAPOINT
OL.handleDataDragStart = function(e, id) {
    e.dataTransfer.setData("application/sphynx-type", "datapoint");
    e.dataTransfer.setData("application/sphynx-id", id);
};

// STEP DROP ZONE HANDLER (Update your existing Step HTML to include this)
// ondrop="OL.handleUniversalDropOnStep(event, '${res.id}', '${step.id}')"
OL.handleUniversalDropOnStep = async function(e, resId, stepId) {
    e.preventDefault();
    const type = e.dataTransfer.getData("application/sphynx-type");
    const id = e.dataTransfer.getData("application/sphynx-id");

    const data = OL.getCurrentProjectData();
    const res = data.resources.find(r => String(r.id) === String(resId));
    const step = res?.steps?.find(s => String(s.id) === String(stepId));
    
    if (!step) return;

    await OL.updateAndSync(() => {
        if (type === 'datapoint') {
            if (!step.datapoints) step.datapoints = [];
            const dp = state.master.datapoints.find(d => d.id === id);
            
            if (dp.isBundle) {
                // Expand bundle and add all children
                dp.childIds.forEach(childId => {
                    const child = state.master.datapoints.find(c => c.id === childId);
                    if (child && !step.datapoints.some(existing => existing.id === child.id)) {
                        step.datapoints.push(child);
                    }
                });
            } else {
                if (!step.datapoints.some(existing => existing.id === id)) {
                    step.datapoints.push(dp);
                }
            }
            console.log(`🏷️ Mapped data to step: ${step.name}`);
        }
    });

    OL.renderVisualizer();
};

window.renderTrayContent = function(isVault, query = "", typeFilter = "All") {
};

document.addEventListener('mousedown', function(e) {
    const badge = e.target.closest('.action-duplicate');
    if (badge) {
        // 🛑 KILL THE EVENT IMMEDIATELY
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        const resId = badge.getAttribute('data-id');
        console.log("🚀 Manual Intercept: Duplicating", resId);
        
        // Trigger the duplicate function
        OL.duplicateResourceV2(resId);
    }
}, true); // 🎯 The 'true' is critical: it uses 'Capture' phase to catch the click first

// Global to track the dragged index
state.draggingStepIdx = null;

OL.renderFocusControls = function() {
    let scopeBtn = document.getElementById('exit-focus-btn');
    
    // 1. If no focus, remove the button and stop
    if (!OL.focusedResourceId) {
        if (scopeBtn) scopeBtn.remove();
        return;
    }

    // 2. Determine destination text
    const savedPath = sessionStorage.getItem('map_return_path') || "/scoping-sheet";
    const destinationName = savedPath.includes('resources') ? 'Library' : 'Scope';

    // 3. Create button if it doesn't exist
    if (!scopeBtn) {
        scopeBtn = document.createElement('button');
        scopeBtn.id = 'exit-focus-btn';
        document.body.appendChild(scopeBtn);
    }

    // 4. Update Button Content & Action
    scopeBtn.innerHTML = `⬅️ Back to ${destinationName}`;
    scopeBtn.style.display = 'block';
    
    scopeBtn.onclick = () => {
        const savedPath = sessionStorage.getItem('map_return_path') || "/scoping-sheet";
        
        // 1. Reset Focus State
        OL.focusedResourceId = null;
        sessionStorage.removeItem('active_resource_id');
        sessionStorage.removeItem('map_return_path');

        // 2. Nuke the Map Container (Instant)
        const mainArea = document.getElementById('mainContent');
        if (mainArea) mainArea.innerHTML = ''; 

        // 3. Update the URL (Silent)
        window.location.hash = savedPath;

        // 4. 🚀 THE "INSTANT SWAP"
        // We check the path and call the specific "Render" function for that page
        if (savedPath.includes('scoping-sheet')) {
            if (typeof OL.renderScopingSheet === 'function') {
                OL.renderScopingSheet(); 
            } else if (typeof OL.renderScope === 'function') {
                OL.renderScope();
            } else {
                window.location.reload(); // Fallback if name is unknown
            }
        } else if (savedPath.includes('resources')) {
            if (typeof OL.renderResources === 'function') {
                OL.renderResources();
            } else if (typeof OL.showResources === 'function') {
                OL.showResources();
            } else {
                window.location.reload();
            }
        }

        scopeBtn.remove();
    };
        
    // 🛑 REMOVED: The self-calling line that was causing the crash
};

OL.exitVisualFocus = function() {
    // 1. Clear the focus variable
    OL.focusedResourceId = null;

    // 2. Re-render the map (this removes the .node-dimmed classes)
    OL.renderVisualizer();

    // 3. Hide the focus controls
    OL.renderFocusControls();

    // 4. Optional: If you want to literally switch 'Views' back to a list
    // if (typeof OL.setView === 'function') OL.setView('scope');
};

OL.addNewResourceToCanvas = async function() {
    const data = OL.getCurrentProjectData();
    const stages = data.stages || [];
    if (stages.length === 0) return alert("Please create a stage first.");

    // 1. Calculate Viewport Center
    const scrollWrap = document.getElementById('v2-canvas-scroll-wrap');
    const zoom = state.v2.zoom || 1;
    
    const centerX = (scrollWrap.scrollLeft + (scrollWrap.offsetWidth / 2)) / zoom;
    const centerY = (scrollWrap.scrollTop + (scrollWrap.offsetHeight / 2)) / zoom;

    // 2. Identify the target Stage (Lane) based on centerX
    let targetStage = stages[0];
    let accX = 0;
    for (let s of stages) {
        const w = s.width || 320;
        if (centerX >= accX && centerX <= accX + w) {
            targetStage = s;
            break;
        }
        accX += w;
    }

    // 3. Define Step ID and Resource ID
    const newResId = 'res-' + Date.now();
    const initialStepId = uid();

    // 4. Create the Resource Object
    const newRes = {
        id: newResId,
        name: "New Resource", // Default placeholder
        type: "General",
        stageId: targetStage.id,
        isGlobal: false,
        isExpanded: true,
        coords: { x: centerX - 140, y: centerY - 50 },
        steps: [{ 
            id: initialStepId, 
            name: "Initial Step", 
            logic: { in: [], out: [] } 
        }],
        createdDate: new Date().toISOString()
    };

    // 5. Save and Prep the UI
    await OL.updateAndSync(() => {
        data.resources.push(newRes);
        // Clear old highlights and set this as the single active match
        state.canvasMatches = [newResId];
        state.currentCanvasMatchIdx = 0;
    });

    // 6. Refresh the Canvas
    OL.renderVisualizer();
    
    // 7. SURGICAL HANDOFF: Scroll, Pulse, and Inspect
    setTimeout(() => {
        const el = document.getElementById(`v2-node-${newResId}`);
        if (el) {
            el.classList.add('search-focus');
            el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
            
            // 🚀 OPEN INSPECTOR IMMEDIATELY
            // We pass the newResId and null to open the card-level metadata inspector
            OL.openInspector(newResId, null, 'cards');

            // ⌨️ BONUS: Auto-focus the name field in the inspector if it exists
            const nameInput = document.getElementById('modal-res-name');
            if (nameInput) {
                nameInput.select(); // Select the "New Resource" text so they can just type over it
            }
        }
    }, 150);
};

OL.toggleLogicMenu = function(id) {
    const target = document.getElementById(`logic-menu-${id}`);
    const isAlreadyOpen = target.style.display === 'block';

    // Close all other open menus
    document.querySelectorAll('.v2-logic-menu').forEach(m => m.style.display = 'none');

    // Toggle the clicked one
    if (target) {
        target.style.display = isAlreadyOpen ? 'none' : 'block';
    }
};

OL.setTraceMode = function(startId, direction) {
    if (!startId) {
        state.v2.activeTrace = null;
        state.v2.highlightedIds = [];
        OL.renderVisualizer();
        return;
    }

    // 🚀 THE FIX: Get the freshest data directly from the state
    const currentData = OL.getCurrentProjectData();
    const resources = currentData.resources || [];
    
    const highlighted = new Set();
    const rootId = String(startId);
    highlighted.add(rootId);

    console.log(`🚀 STARTING CRAWL: ${direction} from ${rootId}`);
    console.log(`Total resources in pool: ${resources.length}`);

    function crawl(currentId) {
        // Force string comparison for the ID
        const res = resources.find(r => String(r.id) === String(currentId));
        
        if (!res) {
            console.warn(`⚠️ Crawler lost: Could not find ${currentId} among ${resources.length} resources.`);
            // Debug: Log the first resource ID to see the format difference
            if (resources.length > 0) console.log("Sample Resource ID in data:", resources[0].id);
            return;
        }

        const steps = res.steps || [];
        steps.forEach((step, sIdx) => {
            // Check 'out' for trace-end, 'in' for trace-start
            const logicPool = (direction === 'trace-end') ? (step.logic?.out || []) : (step.logic?.in || []);
            
            logicPool.forEach(link => {
                // Determine property name based on direction
                const rawTarget = (direction === 'trace-end') ? link.targetId : link.sourceId;
                
                if (rawTarget) {
                    // Standardize ID: "local-prj-123-step_0" -> "local-prj-123"
                    const idParts = String(rawTarget).split('-');
                    if (idParts.length > 1) idParts.pop();
                    const cleanedId = idParts.join('-');

                    if (cleanedId && !highlighted.has(cleanedId)) {
                        console.log(`✅ Connection found: ${currentId} -> ${cleanedId}`);
                        highlighted.add(cleanedId);
                        crawl(cleanedId); // Recurse
                    }
                }
            });
        });
    }

    crawl(rootId);

    // Update global state
    state.v2.activeTrace = { resId: rootId, mode: direction };
    state.v2.highlightedIds = Array.from(highlighted);

    console.log("🏁 FINAL HIGHLIGHTED SET:", state.v2.highlightedIds);

    OL.renderVisualizer();
    if (OL.drawConnections) OL.drawConnections();
};

OL.handleStepDragStart = function(e, resId, index) {
    state.draggingStepResId = resId; // 🎯 TRACK THE CARD ID
    state.draggingStepIdx = index;
    
    e.dataTransfer.effectAllowed = 'move';
    
    // Target the entire row, not just the handle
    const row = e.target.closest('.v2-step-item');
    if (row) row.classList.add('is-dragging');
};

OL.handleStepDragOver = function(e) {
    e.preventDefault(); 
    const item = e.currentTarget.closest('.v2-step-item');
    if (item && !item.classList.contains('is-dragging')) {
        item.classList.add('drag-over');
    }
};

OL.handleStepDragLeave = function(e) {
    const item = e.currentTarget.closest('.v2-step-item');
    if (item) item.classList.remove('drag-over');
};

OL.handleStepDrop = async function(e, targetResId, droppedOnIdx) {
    e.preventDefault();
    e.stopPropagation(); // 🛡️ Stop the event from hitting parent containers
    
    // 🧹 Clean up visual indicators
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));

    // 1. Identify Drag Source
    const sourceStepResId = state.draggingStepResId;
    const draggedStepIdx = state.draggingStepIdx;
    
    // Get external resource data (from Sidebar/Canvas)
    let sourceResId = null;
    try {
        const resourceData = JSON.parse(e.dataTransfer.getData('application/json') || '{}');
        sourceResId = resourceData.id;
    } catch(err) {
        sourceResId = e.dataTransfer.getData('text/plain');
    }

    // --- 🟢 CASE 1: INTERNAL STEP REORDER ---
    // (Triggered when dragging a step handle within the same card)
    if (sourceStepResId === targetResId && draggedStepIdx !== null) {
        if (draggedStepIdx === droppedOnIdx) return;
        
        const res = OL.getResourceById(targetResId);
        const [movedStep] = res.steps.splice(draggedStepIdx, 1);
        res.steps.splice(droppedOnIdx, 0, movedStep);
        
        await OL.persist();
        OL.renderVisualizer();
        return;
    }

    // --- 🔵 CASE 2: EXTERNAL RESOURCE DROP ---
    if (sourceResId && sourceResId !== targetResId) {
        
        // 🎯 LOGIC SPLIT: Did they drop on a STEP or the HEADER?
        if (droppedOnIdx !== null) {
            // 🔗 LINK LOGIC (Dropped specifically on a step row)
            const sourceRes = OL.getResourceById(sourceResId);
            const targetRes = OL.getResourceById(targetResId);
            const step = targetRes.steps[droppedOnIdx];

            if (confirm(`Link "${sourceRes.name}" to step: "${step.name}"?`)) {
                if (!step.links) step.links = [];
                step.links.push({ id: sourceRes.id, name: sourceRes.name, type: sourceRes.type });
                await OL.persist();
                OL.renderVisualizer();
            }
        } else {
            // 🏛️ MERGE LOGIC (Dropped on the card header/empty space)
            const sourceRes = OL.getResourceById(sourceResId);
            const targetRes = OL.getResourceById(targetResId);

            if (confirm(`MERGE: Move all steps from "${sourceRes.name}" into "${targetRes.name}"?`)) {
                targetRes.steps = [...(targetRes.steps || []), ...(sourceRes.steps || [])];
                sourceRes.coords = null; // Send back to tray or delete
                await OL.persist();
                OL.renderVisualizer();
            }
        }
    }
};

OL.save = function() {
    // 💾 Push the current master state into the browser's local cache
    localStorage.setItem('OL_FS_TEST', JSON.stringify(this.state));
    console.log("💾 State Cached");
};

OL.getPartNumberHtml = function(res) {
    // 🎯 THE FIX: If res.originId doesn't exist (it's the Master), use its own ID
    const searchId = res.originId || res.id;
    if (!searchId) return '';

    const data = OL.getCurrentProjectData();
    const resources = data.resources || [];

    // Filter map resources that point back to this Master/Origin
    const family = resources.filter(r => 
        String(r.originId) === String(searchId) || 
        String(r.masterRefId) === String(searchId)
    );
    
    // If it hasn't been placed on the map, don't show the badge
    if (family.length === 0) return '';

    // If we are on the map, show "1/3". If we are in the List, just show the Total "3"
    const isMapNode = !!res.originId; 

    if (isMapNode) {
        const sortedFamily = family.sort((a, b) => (a.coords?.y || 0) - (b.coords?.y || 0));
        const index = sortedFamily.findIndex(r => r.id === res.id) + 1;
        return `
            <span class="v2-card-part" 
                  onclick="event.stopPropagation(); OL.highlightFamily('${searchId}')"
                  title="Part ${index} of ${family.length}">
                ${index}/${family.length}
            </span>
        `;
    } else {
        // 🏠 List View: Just show the family total count (the "Family Number")
        return `
            <span class="v2-card-part family-badge" 
                  onclick="event.stopPropagation(); OL.highlightFamily('${res.id}')"
                  style="cursor: pointer; background: rgba(var(--accent-rgb), 0.1); border: 1px solid var(--accent); color: var(--accent);"
                  title="Total instances on map. Click to highlight.">
                ${family.length}
            </span>
        `;
    }
};

OL.toggleMasterExpand = function(forceExpand = null) {
    const data = OL.getCurrentProjectData();
    if (!data.resources) return;

    // Determine target state: 
    // If forceExpand is provided (true/false), use it. 
    // Otherwise, toggle based on the first resource's current state.
    const currentState = data.resources[0]?.isExpanded || false;
    const newState = forceExpand !== null ? forceExpand : !currentState;

    data.resources.forEach(res => {
        res.isExpanded = newState;
    });

    // 🚀 Update and Redraw
    OL.save(data);
    OL.renderVisualizer(); // Re-renders nodes
    
    // Crucial: Redraw connections since card heights just changed!
    setTimeout(() => {
        OL.drawConnections();
    }, 50); 
};

OL.closeModal = function() {
    const quickInput = document.getElementById('quick-step-input');
    
    // 1. 🤖 AUTO-SAVE CHECK (Keep your existing logic)
    if (quickInput && quickInput.value.trim().length > 2) {
        const resId = quickInput.getAttribute('data-res-id');
        const valToSave = quickInput.value;
        quickInput.value = ""; 
        console.log("💾 Auto-saving draft before close...");
        OL.commitQuickStep(resId, valToSave);
        return; 
    }

    // 2. 🧹 STANDARD CLOSE & CLEANUP
    const layer = document.getElementById('modal-layer');
    if (layer) {
        layer.style.display = 'none';
        layer.innerHTML = '';
    }

    // 3. RESET STATE
    OL.isSavingStep = false;
    OL.quickAddState = { 
        name: "", app: "", appId: null, 
        assignee: [], links: [], target: null, 
        delay: 0, note: "", rule: "" 
    };

    // 🚩 THE FIX: Context-Aware Refresh
    const hash = window.location.hash;

    if (hash.includes('resources')) {
        // If on Project Resources or Vault Resources, stay there and refresh the list
        if (typeof renderResourceManager === "function") renderResourceManager();
    } 
    else if (hash.includes('applications') || hash.includes('apps')) {
        // If on Project Apps or Vault Apps, stay there and refresh the grid
        if (typeof renderAppsGrid === "function") renderAppsGrid();
    }
    else if (hash.includes('analyze')) {
        // If in Analysis tab, refresh the cards
        if (typeof renderAnalysisModule === "function") renderAnalysisModule();
    }
    else if (hash.includes('visualizer')) {
        // ONLY render the Flow Map if we are actually ON the visualizer route
        if (typeof OL.renderVisualizer === "function") OL.renderVisualizer();
    }
    else {
        // Fallback for dashboard or other views
        window.handleRoute();
    }
};

OL.addNewStepToCard = function(resId) {
    const data = OL.getCurrentProjectData();
    const res = data.resources.find(r => String(r.id) === String(resId));
    const functionMappings = data.functions || {};
    
    // 🚀 1. PRE-DETERMINE THE ASSIGNEE
    let autoAssigneeObj = null; 

    if (res) {
        const rawType = typeof res.type === 'object' ? res.type.label : res.type;
        const resType = String(rawType || '').toLowerCase();
        const functionMappings = data.functions || {};

        let foundName = null;

        // 1. Determine the Name
        if (resType.includes('zap')) {
            foundName = "Zapier";
        } else if (resType.includes('scheduler') || resType.includes('scheduling')) {
            foundName = functionMappings["Scheduling"];
        } else if (resType.includes('form') || resType.includes('gathering')) {
            foundName = functionMappings["Data Gathering"];
        } else if (resType.includes('database')) {
            foundName = functionMappings["Database"];
        } else if (resType.includes('email')) {
            foundName = functionMappings["Email Marketing"];
        }

        // 2. Wrap the Name in the required Object Structure
        if (foundName) {
            autoAssigneeObj = { 
                name: String(foundName), 
                type: "app", 
                id: `auto-${Date.now()}` // Gives it a unique key for React/Lists
            };
        }
    }

    // 🚀 2. INITIALIZE STATE WITH THE AUTO-ASSIGNEE
    OL.quickAddState = { 
        name: "", 
        app: "", 
        appId: null, 
        assignee: autoAssigneeObj ? [autoAssigneeObj] : [],
        links: [], 
        target: null, 
        delay: 0, 
        note: "", 
        rule: "" 
    };

    const html = `
        <div id="quick-add-modal"> 
            <div class="modal-head">
                <div class="modal-title-text">⚡ Power Add Step</div>
                ${autoAssigneeObj ? `<div style="font-size:10px; color:var(--accent); margin-top:4px;">Auto-assigning to: ${autoAssigneeObj.name}</div>` : ''}
            </div>
            <div class="modal-body" style="position:relative;">
                <div id="quick-add-container">
                    <input type="text" id="quick-step-input" data-res-id="${resId}" class="modal-input" 
                           placeholder="Task Name /..."
                           autocomplete="off"
                           oninput="OL.handleQuickAddInput(event, '${resId}')"
                           onkeydown="OL.handleQuickAddKeys(event, '${resId}')"
                           style="font-size: 16px; padding: 15px; border: 2px solid var(--accent); width:100%;">
                    
                    <div id="slash-menu" class="slash-menu"></div>
                </div>
                <div id="step-preview-zone" style="margin-top:15px; display:none; background: rgba(0,0,0,0.2); border: 1px solid var(--line); padding: 15px; border-radius: 8px;"></div>
            </div>
        </div>
    `;
    openModal(html);
    setTimeout(() => document.getElementById('quick-step-input').focus(), 100);
};

OL.parseStepInput = function(rawText) {
    // 🏷️ Mapping Synonyms to Fields
    const config = {
        assignee: ['assign', 'who', 'owner', '@'],
        delay:    ['delay', 'wait', 'after', 'pause'],
        dueDate:  ['due', 'date', 'by', 'deadline'],
        app:      ['app', 'tool', 'via', 'using'],
        note:     ['note', 'desc', 'info', 'details'],
        rule:     ['rule', 'if', 'logic', 'when']
    };

    const parts = rawText.split('/');
    const taskName = parts[0].trim();
    
    let result = {
        name: taskName || "New Step",
        appName: null,
        assigneeName: null,
        timingValue: 0,
        dueDate: null,
        notes: "",
        rule: ""
    };

    parts.slice(1).forEach(part => {
        const lowerPart = part.toLowerCase().trim();
        
        // Check which field this "shortcut" belongs to
        for (const [field, keywords] of Object.entries(config)) {
            const match = keywords.find(k => lowerPart.startsWith(k));
            if (match) {
                const content = part.substring(part.indexOf(':') + 1).trim();
                if (field === 'assignee') result.assigneeName = content;
                if (field === 'delay')    result.timingValue = parseInt(content) || 0;
                if (field === 'dueDate')  result.dueDate = content;
                if (field === 'app')      result.appName = content;
                if (field === 'note')     result.notes = content;
                if (field === 'rule')     result.rule = content;
            }
        }
    });

    return result;
};

OL.handleQuickAddInput = function(e, resId) {
    const inputEl = e.target;
    const val = inputEl.value; 
    const menu = document.getElementById('slash-menu');
    
    // 1. Get the Apps from the REAL source
    const client = getActiveClient();
    const projectApps = client?.projectData?.localApps || [];

    // 2. Sync State Name
    OL.quickAddState.name = val;

    // 🔍 3. DYNAMIC APP SCANNING (Using localApps)
    let detectedApp = null;

    if (val.trim().length > 2) {
        projectApps.forEach(app => {
            const appName = app.name || "";
            if (!appName) return;

            const searchStr = val.toLowerCase();
            const targetApp = appName.toLowerCase();

            // Match if the typed text contains the app name
            if (searchStr.includes(targetApp)) {
                detectedApp = app;
            }
        });
    }

    if (detectedApp) {
        OL.quickAddState.app = detectedApp.name;
        OL.quickAddState.appId = detectedApp.id || null;
        console.log("✅ Sync Match Found:", detectedApp.name);
    } else {
        // Only clear if no slash command or previous detection is active
        // This prevents flickering while typing
        if (!val.includes('/app:')) {
            OL.quickAddState.app = "";
            OL.quickAddState.appId = null;
        }
    }

    // ⚡ 4. SLASH MENU LOGIC
    const lastSlashIndex = val.lastIndexOf('/');
    if (lastSlashIndex !== -1) {
        const query = val.substring(lastSlashIndex + 1);
        if (query.includes(':')) {
            const parts = query.split(':');
            const command = parts[0].toLowerCase().trim();
            const paramQuery = parts[1] ? parts[1].trim() : ""; 
            
            const subTypeMap = {
                'assign': 'team', 'who': 'team', 'app': 'apps', 'tool': 'apps'
            };
            
            const subType = subTypeMap[command];
            if (subType && typeof OL.showSubMenu === 'function') {
                OL.showSubMenu(subType, paramQuery.toLowerCase()); 
            }
        } else if (typeof OL.showSlashMenu === 'function') {
            OL.showSlashMenu(query.toLowerCase().trim(), resId);
        }
    } else if (menu) {
        menu.style.display = 'none';
    }

    // 🚀 5. THE UI REFRESH
    if (typeof OL.updateQuickAddPreview === 'function') {
        OL.updateQuickAddPreview();
    }
};

OL.updateQuickAddPreview = function() {
    const preview = document.getElementById('step-preview-zone');
    if (!preview) return;

    const state = OL.quickAddState;
    const data = OL.getCurrentProjectData();
    
    // 🔍 Find the actual app object to get its icon
    const appObj = (data.apps || []).find(a => a.name === state.app || a.id === state.appId);
    const iconHtml = appObj?.icon ? `<img src="${appObj.icon}" style="width:16px; height:16px; margin-right:8px;">` : '🛠️';

    if (state.name || state.app || state.assignee.length > 0) {
        preview.style.display = 'block';
        
        // Build the Preview HTML
        preview.innerHTML = `
            <div style="display:flex; align-items:center; gap:10px;">
                <div style="flex-shrink:0;">${iconHtml}</div>
                <div style="flex-grow:1;">
                    <div style="font-weight:bold; color:white;">${state.name || 'Untitled Task'}</div>
                    <div style="font-size:11px; color:var(--text-dim);">
                        App: <span style="color:var(--accent);">${state.app || 'Auto'}</span> | 
                        Who: <span style="color:var(--accent);">${state.assignee.map(a => a.name).join(', ') || 'Unassigned'}</span>
                    </div>
                </div>
            </div>
        `;
    } else {
        preview.style.display = 'none';
    }
};

OL.showSlashMenu = function(query, resId) {
    const menu = document.getElementById('slash-menu');
    const options = [
        { label: 'Assignee', key: 'Assign:', icon: '👤', sub: 'team' },
        { label: 'Application', key: 'App:', icon: '📱', sub: 'apps' },
        { label: 'Delay', key: 'Delay:', icon: '⏱', sub: null },
        { label: 'Note', key: 'Note:', icon: '📝', sub: null },
        { label: 'Due Date', key: 'Due:', icon: '📅', sub: 'due' }, // ✨ New Option
        { label: 'Rules', key: 'Rule:', icon: 'λ', sub: 'logic' },
        { label: 'Link Assets', key: 'Link:', icon: '🔗', sub: 'links' },
        { label: 'Target Resource', key: 'Target:', icon: '🎯', sub: 'target' }
    ];

    const filtered = options.filter(o => o.label.toLowerCase().includes(query.toLowerCase()));
    
    if (filtered.length > 0) {
        menu.innerHTML = filtered.map((o, i) => `
            <div class="slash-option ${i === 0 ? 'selected' : ''}" 
                 data-label="${o.key}" 
                 data-sub="${o.sub || ''}"
                 onmousedown="event.preventDefault(); OL.selectMenuOption('${o.key}', '${o.sub || ''}')">
                <span>${o.icon} ${o.label}</span>
            </div>
        `).join('');
        menu.style.display = 'block';
    } else {
        menu.style.display = 'none';
    }
};

OL.insertCommand = function(key, subType) {
    const input = document.getElementById('quick-step-input');
    if (!input) return;

    const val = input.value;
    const lastSlash = val.lastIndexOf('/');
    
    // Insert the command (e.g., /App:)
    input.value = val.substring(0, lastSlash + 1) + key + " ";
    
    // Hide the level-1 menu
    document.getElementById('slash-menu').style.display = 'none';
    input.focus();

    // 🚀 FORCE RE-SCAN: This triggers handleQuickAddInput again immediately
    const inputEvent = new Event('input', { bubbles: true });
    input.dispatchEvent(inputEvent);
};

OL.handleQuickAddKeys = function(e, resId) {
    const menu = document.getElementById('slash-menu');
    const isMenuVisible = menu && menu.style.display === 'block';
    const input = e.target;
    
    if (isMenuVisible) {
        const options = menu.querySelectorAll('.slash-option');
        if (options.length === 0) return; // Nothing to select

        let activeIdx = Array.from(options).findIndex(opt => opt.classList.contains('selected'));

        if (e.key === 'Enter' || e.key === 'Tab') {
            e.preventDefault();
            e.stopImmediatePropagation(); // 🛑 Stop modal from saving
            
            // Default to first option if none highlighted
            const selectedIdx = activeIdx >= 0 ? activeIdx : 0;
            const selectedEl = options[selectedIdx];

            if (selectedEl) {
                // 🕵️ Instead of firing the mouse event, we look at the data we stored
                const label = selectedEl.getAttribute('data-label');
                const sub = selectedEl.getAttribute('data-sub');
                OL.selectMenuOption(label, sub);
            }
            return false;
        }

        // 1. Navigation
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            e.stopImmediatePropagation();
            
            if (activeIdx >= 0) options[activeIdx].classList.remove('selected');
            
            if (e.key === 'ArrowDown') activeIdx = (activeIdx + 1) % options.length;
            else activeIdx = (activeIdx - 1 + options.length) % options.length;
            
            options[activeIdx].classList.add('selected');
            options[activeIdx].scrollIntoView({ block: 'nearest' });
            return false;
        }

        // 2. 🎯 THE FIX: Enter / Tab / Right Arrow
        if (e.key === 'Enter' || e.key === 'Tab' || e.key === 'ArrowRight') {
            e.preventDefault();
            e.stopImmediatePropagation();
            
            // If nothing is highlighted, grab the first available option
            const selected = (activeIdx >= 0) ? options[activeIdx] : options[0];
            
            if (selected) {
                // Trigger the mousedown logic
                selected.onmousedown(); 
            }
            return false;
        }

        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopImmediatePropagation();
            menu.style.display = 'none';
            return false;
        }
    }

    // 🏁 3. Standard Step Commit (Only if menu is hidden)
    if (e.key === 'Enter' && !e.shiftKey) {
        const val = input.value;
        const lastSlash = val.lastIndexOf('/');

        if (lastSlash !== -1) {
            const cmdPart = val.substring(lastSlash + 1);
            if (cmdPart.includes(':')) {
                // We are mid-command! 
                e.preventDefault();
                e.stopImmediatePropagation();

                const parts = cmdPart.split(':');
                const cmd = parts[0].toLowerCase().trim();
                const content = parts.slice(1).join(':').trim(); // Join in case they typed colons in a note

                if (content.length > 0) {
                    // 💾 Save to state (Mapping synonyms)
                    if (cmd === 'delay' || cmd === 'wait') OL.quickAddState.delay = content;
                    if (cmd === 'note' || cmd === 'desc' || cmd === 'description') OL.quickAddState.note = content;
                    if (cmd === 'due' || cmd === 'date') OL.quickAddState.due = content;
                    if (cmd === 'rule' || cmd === 'if') OL.quickAddState.rule = content;
                    
                    // 🧹 Clear the command from input, keep the base task name
                    input.value = val.substring(0, lastSlash).trim() + " ";
                    
                    // 🔄 FORCE REFRESH PREVIEW
                    OL.updateStepPreview(input.value);
                    return false;
                }
            }
        }
        
        // Final Save Step (Only if no slash command was found above)
        OL.commitQuickStep(resId);
    }
};

OL.updateStepPreview = function(val) {
    const previewZone = document.getElementById('step-preview-zone');
    if (!previewZone) return;

    const taskName = (val || "").split('/')[0].trim();
    const s = OL.quickAddState;

    // 1. Check if we have anything to show
    const hasData = taskName || s.app || s.assignee || s.delay || s.note || s.rule || s.due;
    
    if (!hasData) {
        previewZone.style.display = 'none';
        return;
    }

    previewZone.style.display = 'block';
    previewZone.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 8px;">
            <div style="font-size: 13px; color: var(--accent); font-weight: bold; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 5px;">
                ${taskName || '<span style="opacity:0.5">Untitled Action...</span>'}
            </div>
            
            <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                ${s.app ? `<span class="pill status-primary">📱 ${s.app}</span>` : ''}
                ${(s.assignee || []).map(a => `
                    <span class="pill vault-gold" style="font-size: 10px;">👤 ${a.name}</span> `).join('')}
                ${s.delay ? `<span class="pill">⏱ ${s.delay}</span>` : ''}
                ${s.due ? `<span class="pill" style="border: 1px solid #ff4757; color: #ff4757;">📅 ${s.due}</span>` : ''}
                ${s.rule ? `<span class="pill" style="border: 1px solid var(--warning); color: var(--warning);">λ ${s.rule}</span>` : ''}
            </div>

            ${s.note ? `
                <div style="font-size: 11px; background: rgba(255,255,255,0.05); padding: 8px; border-radius: 4px; color: #000; font-style: italic; border-left: 2px solid var(--accent);">
                    " ${s.note} "
                </div>
            ` : ''}
        </div>
    `;
};

OL.showSubMenu = function(subType, filterQuery = "") {
    const menu = document.getElementById('slash-menu');
    if (!menu) return;

    const q = (filterQuery || "").toLowerCase().trim();
    let menuHtml = "";

    // 1. SELECT DATA BASED ON TYPE
    switch (subType) {
        case 'team':
            const matches = OL.getFilteredAssigneeOptions(q);
            menuHtml = `<div class="search-category-label">Assign to... (Multi-select)</div>`;
            menuHtml += `
                <div class="slash-option exit-option" style="border-bottom: 1px solid var(--line); color: var(--accent); font-weight:bold;" 
                     onmousedown="event.preventDefault(); OL.exitSubMenu()">
                    <span>✅ Done Selecting</span>
                </div>
            `;
            menuHtml += matches.map((item) => {
                const isSelected = (OL.quickAddState.assignee || []).some(a => a.id === item.id);
                return `
                    <div class="slash-option ${isSelected ? 'active' : ''}" 
                         onmousedown="event.preventDefault(); OL.selectMultiAssignee('${item.id}', '${esc(item.name)}', '${item.type}')">
                        <span>${item.icon} ${esc(item.name)}</span>
                        ${isSelected ? '<span class="tiny" style="margin-left:auto;">✅</span>' : ''}
                    </div>
                `;
            }).join('');
            break;

        case 'due':
            const dueOptions = [
                { label: 'Same Day', icon: '⚡' },
                { label: '+1 Day', icon: '🌅' },
                { label: '+2 Days', icon: '📅' },
                { label: '+1 Week', icon: '🗓️' },
                { label: 'Immediate', icon: '🚀' }
            ];
            menuHtml = `<div class="search-category-label">Select Due Offset...</div>`;
            menuHtml += dueOptions.filter(o => o.label.toLowerCase().includes(q)).map(o => `
                <div class="slash-option" onmousedown="event.preventDefault(); OL.selectMenuOption('${o.label}')">
                    <span>${o.icon} ${o.label}</span>
                </div>
            `).join('');
            break;

        case 'apps':
            const client = getActiveClient();
            const apps = (client?.projectData?.localApps || []).filter(a => a.name.toLowerCase().includes(q));
            menuHtml = `<div class="search-category-label">Select Application...</div>`;
            menuHtml += apps.map(a => `
                <div class="slash-option" onmousedown="event.preventDefault(); OL.selectMenuOption('${esc(a.name)}', null, '${a.id}')">
                    <span>📱 ${esc(a.name)}</span>
                </div>
            `).join('');
            break;

        case 'logic':
            const logicOptions = [
                { label: 'If Approved', icon: 'λ' }, 
                { label: 'If Rejected', icon: 'λ' }, 
                { label: 'On Success', icon: 'λ' }
            ];
            menuHtml = `<div class="search-category-label">Select Logic Rule...</div>`;
            menuHtml += logicOptions.filter(o => o.label.toLowerCase().includes(q)).map(o => `
                <div class="slash-option" onmousedown="event.preventDefault(); OL.selectMenuOption('${o.label}')">
                    <span>${o.icon} ${o.label}</span>
                </div>
            `).join('');
            break;
        
        // Inside OL.showSubMenu switch statement:

        case 'links': // 📖 Guides & Assets
            const clientData = getActiveClient();
            const allRes = [...(state.master.resources || []), ...(clientData?.projectData?.localResources || [])];
            const allSOPs = [...(state.master.howToLibrary || []), ...(clientData?.projectData?.localHowTo || [])];
            
            // Combine and filter
            const linkMatches = [...allRes, ...allSOPs].filter(item => item.name.toLowerCase().includes(q));

            menuHtml = `<div class="search-category-label">Link Assets/SOPs (Multi)</div>`;
            menuHtml += linkMatches.map(item => {
                const isSelected = (OL.quickAddState.links || []).some(l => l.id === item.id);
                const icon = item.type === 'SOP' || item.content !== undefined ? '📖' : '📱';
                return `
                    <div class="slash-option ${isSelected ? 'active' : ''}" 
                        onmousedown="event.preventDefault(); OL.selectMultiLink('${item.id}', '${esc(item.name)}', '${item.type || 'sop'}')">
                        <span>${icon} ${esc(item.name)}</span>
                        ${isSelected ? '<span class="tiny">✅</span>' : ''}
                    </div>
                `;
            }).join('');
            break;

        case 'target': // 🎯 The "Milestone" Resource
            const data = OL.getCurrentProjectData();
            const targetMatches = (data.resources || []).filter(r => r.name.toLowerCase().includes(q));

            menuHtml = `<div class="search-category-label">Set Target Resource (Milestone)</div>`;
            menuHtml += targetMatches.map(r => `
                <div class="slash-option" onmousedown="event.preventDefault(); OL.selectTargetResource('${r.id}', '${esc(r.name)}')">
                    <span>🎯 ${esc(r.name)}</span>
                </div>
            `).join('');
            break;
    }

    // 2. RENDER OR HIDE
    if (menuHtml && menuHtml.length > 50) { // Safety check to ensure we didn't just render a label
        menu.innerHTML = menuHtml;
        menu.style.display = 'block';
    } else {
        menu.style.display = 'none';
    }
};

OL.selectMultiLink = function(id, name, type) {
    if (!OL.quickAddState.links) OL.quickAddState.links = [];
    const idx = OL.quickAddState.links.findIndex(l => l.id === id);
    if (idx === -1) OL.quickAddState.links.push({ id, name, type });
    else OL.quickAddState.links.splice(idx, 1);
    
    OL.updateStepPreview(document.getElementById('quick-step-input').value);
    OL.showSubMenu('links', ''); 
};

OL.selectTargetResource = function(id, name) {
    OL.quickAddState.target = { id, name };
    OL.exitSubMenu(); // Targets are usually single-select, so we auto-exit
};

OL.selectMultiAssignee = function(id, name, type) {
    if (!Array.isArray(OL.quickAddState.assignee)) OL.quickAddState.assignee = [];
    
    const idx = OL.quickAddState.assignee.findIndex(a => a.id === id);
    if (idx === -1) {
        OL.quickAddState.assignee.push({ id, name, type });
    } else {
        OL.quickAddState.assignee.splice(idx, 1);
    }

    const input = document.getElementById('quick-step-input');
    
    // 🛡️ Guard against the null error
    if (input) {
        OL.updateStepPreview(input.value);
        
        // Use a tiny timeout or animation frame to let the click event finish
        // before forcing focus back into the box.
        requestAnimationFrame(() => {
            if (input) input.focus();
        });
    }

    // Refresh the submenu so checkmarks appear/disappear instantly
    OL.showSubMenu('team', ''); 
};

OL.exitSubMenu = function() {
    const input = document.getElementById('quick-step-input');
    const menu = document.getElementById('slash-menu');
    if (!input) return;

    const val = input.value;
    const lastSlash = val.lastIndexOf('/');

    // 🧹 Strip the command part but keep the base task name
    // e.g., "Send Invoice /Assign: " -> "Send Invoice "
    if (lastSlash !== -1) {
        input.value = val.substring(0, lastSlash).trim() + " ";
    }

    if (menu) menu.style.display = 'none';
    input.focus();
    
    // Refresh the preview one last time
    OL.updateStepPreview(input.value);
};

OL.completeSubMenuValue = function(value) {
    const input = document.getElementById('quick-step-input');
    const val = input.value;
    
    // Find where the last command started
    const lastColon = val.lastIndexOf(':');
    
    // Construct new value: Everything up to the colon + the selected value
    input.value = val.substring(0, lastColon + 1) + " " + value + " ";
    
    document.getElementById('slash-menu').style.display = 'none';
    input.focus();
    OL.updateStepPreview(input.value);
};

// 📦 A temporary object to hold our draft step data
OL.quickAddState = { name: "", app: "", assignee: "", delay: 0 };

OL.selectMenuOption = function(label, subType = null, appId = null) {
    const input = document.getElementById('quick-step-input');
    if (!input) return;

    const val = input.value;
    const lastSlash = val.lastIndexOf('/');
    const isCommandStart = label.endsWith(':');

    if (isCommandStart) {
        input.value = val.substring(0, lastSlash).trim() + " /" + label + " ";
        document.getElementById('slash-menu').style.display = 'none';
        input.focus();
        if (subType && subType !== 'null' && subType !== '') {
            input.dispatchEvent(new Event('input', { bubbles: true }));
        } else {
            OL.updateStepPreview(input.value);
        }
    } 
    else {
        const commandText = val.substring(lastSlash); 
        
        // 🎯 THE FIX: Capture the ID for the Inspector
        if (commandText.includes('App:')) {
            OL.quickAddState.app = label;
            OL.quickAddState.appId = appId; 
        }
        
        // Existing mappings...
        if (commandText.includes('Assign:')) OL.quickAddState.assignee = label; // Handled by selectMultiAssignee usually
        if (commandText.includes('Delay:')) OL.quickAddState.delay = label;
        if (commandText.includes('Due:')) OL.quickAddState.due = label;
        if (commandText.includes('Note:')) OL.quickAddState.note = label;
        if (commandText.includes('Rule:')) OL.quickAddState.rule = label;

        input.value = val.substring(0, lastSlash).trim() + " ";
        document.getElementById('slash-menu').style.display = 'none';
        input.focus();
        OL.updateStepPreview(input.value);
    }
};

OL.isSavingStep = false; // Global flag

OL.commitQuickStep = async function(resId) {
    if (OL.isSavingStep) return;
    
    const input = document.getElementById('quick-step-input');
    if (!input) return;

    const taskName = input.value.split('/')[0].trim();
    const s = OL.quickAddState; // Shortcut to our draft state

    if (!taskName && !s.note) {
        OL.isSavingStep = false;
        OL.closeModal(); 
        return;
    }

    OL.isSavingStep = true;
    input.value = ""; 

    try {
        const newStep = {
            id: "step_" + Date.now(),
            name: taskName || "Untitled Action",
            
            // 📱 App Alignment: Inspector uses .appId
            appId: s.appId || null, 
            appName: s.app || null,

            // 👤 Assignee Alignment: Inspector uses .assignees (Array)
            assignees: Array.isArray(s.assignee) ? s.assignee : [], 

            // 📝 Note Alignment: Inspector uses .description
            description: s.note || "", 
            
            // ⏱ Timing & Logic
            timingValue: parseInt(s.delay) || 0,
            timingType: 'after_prev', 
            dueDate: s.due || null,
            rule: s.rule || "",
            logic: { in: [], out: [] },
            links: [],
            links: s.links || [],         // 📖 Attached Guides/Assets Array
            targetResourceId: s.target?.id || null, // 🎯 The Milestone ID
            targetResourceName: s.target?.name || null,
        };

        const client = getActiveClient();
        const isVault = window.location.hash.includes('vault');
        const resourcePool = isVault ? state.master.resources : client.projectData.localResources;
        const resource = resourcePool.find(r => String(r.id) === String(resId));

        if (resource) {
            if (!resource.steps) resource.steps = [];
            resource.steps.push(newStep);
            resource.isExpanded = true;

            await OL.persist(); 
            if (window.location.hash.includes('visualizer')) OL.renderVisualizer();
        }
    } catch (err) {
        console.error("❌ Power Add Sync Failure:", err);
    } finally {
        OL.isSavingStep = false;
        OL.closeModal();
    }
};

OL.updateStepName = function(resId, stepIdx, newName) {
    const data = OL.getCurrentProjectData();
    const res = data.resources.find(r => String(r.id) === String(resId));
    const step = res?.steps?.[stepIdx];

    if (step) {
        step.name = newName || 'Untitled Step';
        
        // 💾 Save change (Surgical update, no need to re-align)
        OL.persist();
        
        // 🚀 SURGICAL DOM UPDATE: Update the step text on the canvas directly
        // to avoid a full re-render while the user is typing in the inspector.
        const stepEl = document.querySelector(`[data-step-id="${resId}-${stepIdx}"] span`);
        if (stepEl) stepEl.innerText = `• ${step.name}`;
    }
};

OL.deleteStep = async function(resId, stepIdx) {
    const data = OL.getCurrentProjectData();
    const resources = data.resources || [];
    const res = resources.find(r => String(r.id) === String(resId));
    
    if (res && res.steps && res.steps[stepIdx]) {
        const stepToDelete = res.steps[stepIdx];
        const stepFullId = `${resId}-${stepIdx}`;

        if (!confirm(`Delete step "${stepToDelete.name}"? This will also remove any logic links connected to it.`)) return;

        // 🚀 1. THE CLEANUP CRAWL
        // Scan every single step in every resource to find links to THIS step
        resources.forEach(r => {
            (r.steps || []).forEach(otherStep => {
                if (otherStep.logic) {
                    // Remove 'out' links pointing to our deleted step
                    if (otherStep.logic.out) {
                        otherStep.logic.out = otherStep.logic.out.filter(link => String(link.targetId) !== stepFullId);
                    }
                    // Remove 'in' links coming from our deleted step
                    if (otherStep.logic.in) {
                        otherStep.logic.in = otherStep.logic.in.filter(link => String(link.sourceId) !== stepFullId);
                    }
                }
            });
        });

        // 🚀 2. RE-INDEX PROTECTOR
        // Because steps are stored in an array by index, deleting Step 1 makes Step 2 become the new Step 1.
        // We must update any logic links that pointed to higher indices in this specific resource.
        resources.forEach(r => {
            (r.steps || []).forEach(otherStep => {
                ['in', 'out'].forEach(dir => {
                    const key = dir === 'in' ? 'sourceId' : 'targetId';
                    (otherStep.logic?.[dir] || []).forEach(link => {
                        const parts = String(link[key]).split('-');
                        const targetResId = parts.slice(0, -1).join('-');
                        const targetIdx = parseInt(parts.pop());

                        if (targetResId === String(resId) && targetIdx > stepIdx) {
                            // Shift the index down by 1 to match the new array position
                            link[key] = `${targetResId}-${targetIdx - 1}`;
                        }
                    });
                });
            });
        });

        // 🚀 3. PERFORM THE DELETE
        res.steps.splice(stepIdx, 1);

        // 💾 4. PERSIST & REFRESH
        await OL.updateAndSync(() => {
            OL.autoAlignNodes(false); // Fix vertical gaps
        });

        OL.renderVisualizer();
        OL.closeInspector(); 
        console.log(`🧹 Step ${stepIdx} deleted and all logic links scrubbed.`);
    }
};

OL.toggleSteps = function(id) {
    // 🎯 1. Use the context-aware helper
    const data = OL.getCurrentProjectData();
    const res = data.resources.find(r => String(r.id) === String(id));
    
    if (res) {
        // 🔄 2. Toggle state
        res.isExpanded = !res.isExpanded;
        
        // 💾 3. Persist change
        OL.save(); 

        // 📏 4. Re-calculate spacing
        // We pass 'false' because we only want to fix the Y-gap, 
        // not move cards to different columns.
        OL.autoAlignNodes(false); 
        
        // ⚡ 5. Urgent Connection Refresh
        // Since the card height changed, logic ports moved.
        // 50ms gives the browser enough time to finish the render layout.
        setTimeout(() => {
            if (typeof OL.drawConnections === 'function') {
                OL.drawConnections();
            }
        }, 50);
    }
};

// 📝 THE RENAME HELPER
OL.renameStage = function(index, newName) {
    const cleanName = newName.trim();
    
    // 🎯 1. Get the correct data context (Project vs Vault)
    const data = OL.getCurrentProjectData();
    const stage = data.stages[index];

    if (cleanName && stage) {
        // 2. Update the data
        stage.name = cleanName;
        console.log(`✅ Stage ${index} renamed to: ${cleanName}`);
        
        // 💾 3. CRITICAL: Save the change to the database/localStorage
        OL.save(); 
        
        // 🚀 4. OPTIONAL: Refresh connections 
        // Sometimes labels shifting can slightly move connection lines
        OL.drawConnections();
    }
};

// ➕ THE INSERTION LOGIC
OL.addStageBetween = async function(index) {
    const name = prompt("Enter Stage Name:", "New Stage");
    if (!name) return;

    const client = getActiveClient();
    const isVault = window.location.hash.startsWith('#/vault');

    await OL.updateAndSync(() => {
        const newStage = {
            id: 'stage-' + Date.now(),
            name: name,
            width: 400
        };

        if (isVault) {
            if (!state.master.stages) state.master.stages = [];
            state.master.stages.splice(index, 0, newStage);
        } else if (client) {
            if (!client.projectData.stages) client.projectData.stages = [];
            // Target the REAL array inside the client object
            client.projectData.stages.splice(index, 0, newStage);
        }
    });

    OL.renderVisualizer();
};

OL.deleteStage = function(index) {
    // 🎯 1. Get the correct project context
    const data = OL.getCurrentProjectData();
    const stage = data.stages[index];
    
    if (!stage) return;

    // Use data.resources instead of currentData
    const cardsInLane = data.resources.filter(r => r.stageId === stage.id);

    // 🛡️ Safety Guard
    if (cardsInLane.length > 0) {
        if (!confirm(`This stage contains ${cardsInLane.length} cards. Deleting it will move them back to the Global Shelf. Proceed?`)) {
            return;
        }
        // Unmap the cards
        cardsInLane.forEach(r => {
            r.isGlobal = true;
            r.stageId = null;
            delete r.coords; // Remove canvas coords so they snap to shelf
        });
    } else {
        if (!confirm(`Delete the "${stage.name}" stage?`)) return;
    }

    // 🚀 2. Remove from array
    data.stages.splice(index, 1);
    
    // 💾 3. Persist the changes
    OL.save(); 
    
    // 📏 4. Refresh the UI
    // autoAlign to close the gap, then render to redraw the lanes
    OL.autoAlignNodes(false);
    OL.renderVisualizer();
};

OL.splitCardAtStep = function(resourceId, stepIndex) {
    // 🎯 1. Get correct context (fixes currentData is not defined)
    const data = OL.getCurrentProjectData(); 
    const resources = data.resources;
    
    const originalRes = resources.find(r => String(r.id) === String(resourceId));
    if (!originalRes || !originalRes.steps) return;

    // Ensure we track the family lineage
    if (!originalRes.originId) originalRes.originId = originalRes.id;

    // ✂️ 2. IDENTIFY AND MOVE STEPS
    const movedSteps = originalRes.steps.splice(stepIndex + 1).filter(s => s !== null);
    if (movedSteps.length === 0) return;
    const newId = 'r' + Date.now();

    // 🚀 3. THE REPAIR MAPPING
    // We need to tell the world that [OldID]-StepX is now [NewID]-StepY
    const repairMap = {};
    movedSteps.forEach((step, i) => {
        const oldFullId = `${originalRes.id}-${stepIndex + 1 + i}`;
        const newFullId = `${newId}-${i}`;
        repairMap[oldFullId] = newFullId;
    });

    // 🚀 4. UPDATE GLOBAL CONNECTIONS
    // Scan every card to update any logic links pointing to the moved steps
    resources.forEach(res => {
        res.steps?.forEach(step => {
            ['in', 'out'].forEach(dir => {
                const key = dir === 'out' ? 'targetId' : 'sourceId';
                step.logic?.[dir]?.forEach(link => {
                    if (repairMap[link[key]]) {
                        console.log(`🛠️ Repairing Link: ${link[key]} -> ${repairMap[link[key]]}`);
                        link[key] = repairMap[link[key]];
                    }
                });
            });
        });
    });

    // 🏗️ 5. CREATE THE NEW CARD
    const newCard = {
        id: newId,
        originId: originalRes.originId,
        name: originalRes.name, // Will be updated by refreshFamilyNaming
        type: originalRes.type,
        stageId: originalRes.stageId,
        isGlobal: false,
        isExpanded: true,
        _col: originalRes._col || 0,
        // Position it slightly below the original
        coords: { 
            x: originalRes.coords.x, 
            y: originalRes.coords.y + (originalRes.isExpanded ? 150 : 80) 
        },
        steps: movedSteps
    };

    resources.push(newCard);
    
    // 🏷️ 6. REFRESH FAMILY NAMING
    // This ensures both cards get their (1/2) and (2/2) badges immediately
    if (typeof OL.refreshFamilyNaming === 'function') {
        OL.refreshFamilyNaming(newCard, resources);
    }

    // 🏁 7. SYNC & SAVE
    this.syncLogicPorts(); 
    this.save();
    this.autoAlignNodes(false); 
};

OL.highlightFamily = function(originId) {
    const data = OL.getCurrentProjectData();
    const resources = data.resources || [];

    const nodeLayer = document.getElementById('v2-node-layer');
    const mainContent = document.getElementById('mainContent');
    const activeLayer = nodeLayer || mainContent;

    if (!activeLayer) return;

    // Toggle Off
    if (activeLayer.classList.contains('canvas-dimmed')) {
        activeLayer.classList.remove('canvas-dimmed');
        document.querySelectorAll('.family-focus').forEach(el => el.classList.remove('family-focus'));
        return;
    }

    // Toggle On
    activeLayer.classList.add('canvas-dimmed');
    
    // 🔍 Find the Family
    resources.forEach(res => {
        const isMatch = String(res.originId) === String(originId) || 
                        String(res.masterRefId) === String(originId) || 
                        String(res.id) === String(originId);

        if (isMatch) {
            // Check for Map Node OR Resource Card
            const el = document.getElementById(`v2-node-${res.id}`) || 
                       document.getElementById(`res-card-${res.id}`); // 👈 Matches your renderResourceCard ID
            
            if (el) el.classList.add('family-focus');
        }
    });

    const clearFocus = (e) => {
        if (['v2-canvas', 'v2-node-layer', 'mainContent'].includes(e.target.id)) {
            activeLayer.classList.remove('canvas-dimmed');
            document.querySelectorAll('.family-focus').forEach(el => el.classList.remove('family-focus'));
            window.removeEventListener('mousedown', clearFocus);
        }
    };
    window.addEventListener('mousedown', clearFocus);
};

OL.toggleScopingStatus = async function(resId) {
    const client = getActiveClient();
    if (!client || !client.projectData) return;

    // 1. Data Logic (Same as before)
    const sheet = client.projectData.scopingSheets?.[0] || { lineItems: [] };
    const targetId = String(resId);
    const existingItem = OL.isResourceInScope(targetId);

    // 🚀 2. Instant UI Flip (Detects badge on ANY page)
    const badges = document.querySelectorAll(`[id="badge-${targetId}"], [oncontextmenu*="${targetId}"]`);
    badges.forEach(badgeEl => {
        if (existingItem) {
            badgeEl.classList.replace('is-on', 'is-off');
        } else {
            badgeEl.classList.replace('is-off', 'is-on');
        }
    });

    // 3. Update the Array
    if (existingItem) {
        client.projectData.scopingSheets[0].lineItems = sheet.lineItems.filter(item => String(item.resourceId) !== targetId);
    } else {
        const res = OL.getResourceById(targetId);
        client.projectData.scopingSheets[0].lineItems.push({
            id: `li-${Date.now()}`,
            resourceId: targetId,
            name: res?.name || "New Resource",
            rate: 0, units: 0, total: 0
        });
    }

    // 4. Persist
    await OL.persist(); 
    
    // 5. Smart Refresh: Only re-render the heavy stuff if we are on that page
    const currentHash = window.location.hash;
    if (currentHash.includes('visualizer')) {
        OL.renderVisualizer(); 
    } else if (currentHash.includes('resources')) {
        // If you have a specific refresh for the resources table, call it here
        // OL.renderResourcesPage(); 
    }
};

OL.getAppByFunction = function(resourceType) {
    const data = OL.getCurrentProjectData();
    const master = state.master || {};
    const apps = (data.localApps && data.localApps.length > 0) ? data.localApps : (master.apps || []);
    
    // 🔍 Find the Type Definition in your registry
    const typeDef = (master.resourceTypes || []).find(t => t.type.toLowerCase() === String(resourceType).toLowerCase());
    
    // If there's no mapping set in the Resource Manager, we stop here
    const targetFunctionId = typeDef ? typeDef.matchedFunctionId : null;
    if (!targetFunctionId) return null;

    // 🎯 Find the app that is PRIMARY for this specific Function ID
    return apps.find(a => {
        return (a.functionIds || []).some(f => 
            String(f.id || f) === targetFunctionId && f.status === 'primary'
        );
    }) || apps.find(a => {
        // Fallback: Just any app that has this function mapped
        return (a.functionIds || []).some(f => String(f.id || f) === targetFunctionId);
    });
};

OL.getResourceIcon = function(type) {
    const registry = (state.master && state.master.resourceTypes) ? state.master.resourceTypes : [];
    const match = registry.find(t => t.type.toLowerCase() === String(type).toLowerCase());
    return match ? match.icon : '📄'; // Fallback to a page icon
};

// 🔍 Open Inspector
OL.openInspector = function(resId = null, stepTarget = null, mode = 'steps') {
    const panel = document.getElementById('v2-inspector-panel');
    const content = document.getElementById('inspector-content');
    if (!panel || !content) return;

    // 🎯 1. Get Context
    const data = OL.getCurrentProjectData();
    const resources = data.resources || [];
    panel.classList.add('open');

    // 📑 2. STEP DETAIL MODE
    // 🚀 FIX: Using stepTarget to check against null
    if (resId && stepTarget !== null) { 
        const res = resources.find(r => String(r.id) === String(resId));
        if (!res) return;

        // 🧠 HYBRID LOOKUP: Hunt by ID first, fallback to Index if numeric
        let step = res.steps.find(s => String(s.id) === String(stepTarget));
        if (!step && isFinite(stepTarget)) {
            step = res.steps[stepTarget];
        }
        
        if (!step) {
            console.error("❌ Inspector Error: Step not found", resId, stepTarget);
            content.innerHTML = `<div class="muted-notice" style="padding:40px; text-align:center; opacity:0.5;">Step not found: ${stepTarget}</div>`;
            return;
        }

        // 🔢 CALCULATE THE DYNAMIC INDEX (For the UI Label)
        const currentIdx = res.steps.indexOf(step);
        
        // 🛡️ Data Safety
        if (!step.logic) step.logic = { in: [], out: [] };
        if (!step.assignees) step.assignees = [];
        
        const allOptions = this.getAllStepOptions();

        content.innerHTML = `
            <div class="breadcrumb" onclick="OL.openInspector('${resId}', null, 'cards')">« Back to Steps</div>
            
            <div class="inspector-header">
                <div class="section-label">EDIT STEP ${currentIdx + 1}</div>
                <input type="text" class="inspector-name-input" 
                      value="${esc(step.name)}" 
                      onblur="OL.updateAtomicStep('${resId}', '${step.id}', 'name', this.value)"
                      placeholder="Step Name">
            </div>

            <div class="inspector-body">
                <div class="inspector-section">
                    <div class="section-label">📥 INPUT CONDITIONS (From where?)</div>
                    ${step.logic.in.map((l, i) => OL.renderLogicBlock(resId, step.id, 'in', i, l, allOptions)).join('')}
                </div>

                <div class="inspector-section">
                    <label class="section-label">📝 INTERNAL NOTES</label>
                    <textarea class="modal-textarea" style="min-height:60px;"
                              onblur="OL.updateAtomicStep('${resId}', '${step.id}', 'description', this.value)">${esc(step.description || '')}</textarea>
                </div>

                <div class="inspector-section">
                    <label class="section-label">🎯 RELATIONAL TARGET (MILESTONE)</label>
                    ${step.targetResourceId ? `
                        <div class="pill accent" style="display:flex; justify-content:space-between; align-items:center; background:rgba(var(--accent-rgb), 0.1); border:1px solid var(--accent);">
                            <span>🎯 ${esc(step.targetResourceName)}</span>
                            <b class="is-clickable" style="opacity:0.5;" onclick="OL.setStepTargetResource('${resId}', '${step.id}', null, null)">×</b>
                        </div>
                    ` : `
                        <div class="search-map-container">
                            <input type="text" class="modal-input tiny" placeholder="Search Milestones..." 
                                  onfocus="OL.filterTargetSearch('${resId}', '${step.id}', '')"
                                  oninput="OL.filterTargetSearch('${resId}', '${step.id}', this.value)">
                            <div id="target-search-results" class="search-results-overlay"></div>
                        </div>
                    `}
                </div>

                <div class="inspector-section">
                    <label class="section-label">👤 ASSIGNEES (WHO?)</label>
                    <div class="pill-display" style="display:flex; flex-wrap:wrap; gap:4px; margin-bottom:8px;">
                        ${step.assignees.length > 0 ? step.assignees.map((a, idx) => `
                            <div class="pill accent" style="display:flex; align-items:center; gap:6px; background:rgba(var(--accent-rgb), 0.1); border: 1px solid var(--accent);">
                                <span style="font-size:10px;">${a.type === 'person' ? '👤' : a.type === 'role' ? '👥' : '📱'} ${esc(a.name)}</span>
                                <b class="is-clickable" style="opacity:0.5;" onclick="OL.removeAssignee('${resId}', '${step.id}', ${idx})">×</b>
                            </div>
                        `).join('') : '<div class="tiny muted italic" style="padding: 5px;">Unassigned</div>'}
                    </div>
                    <div class="search-map-container">
                        <input type="text" class="modal-input tiny" placeholder="Add Person, Role, or App..."
                               onfocus="OL.filterAssignmentSearch('${resId}', '${step.id}', false, '')"
                               oninput="OL.filterAssignmentSearch('${resId}', '${step.id}', false, this.value)">
                        <div id="assignment-search-results" class="search-results-overlay"></div>
                    </div>
                </div>

                <div class="inspector-section">
                    <label class="section-label">📱 PRIMARY APPLICATION (TOOL)</label>
                    ${step.appId ? `
                        <div class="pill-display" style="margin-bottom:8px;">
                            <div class="pill primary" 
                                style="display:flex; justify-content:space-between; align-items:center; background: rgba(var(--accent-rgb), 0.1); 
                                border: 1px solid var(--accent); padding: 5px 8px; border-radius: 6px;"
                                onclick="OL.openAppModal('${step.appId}')">
                                <span style="font-size:10px;">📱 ${esc(step.appName)}</span>
                                <b class="pill-remove-x" style="opacity:0.5; margin-left: 8px;" 
                                  onclick="event.stopPropagation(); OL.removeAppFromStep('${resId}', '${step.id}')">×</b>
                            </div>
                        </div>
                    ` : `
                        <div class="search-map-container">
                            <input type="text" class="modal-input tiny" placeholder="Link Application..." 
                                  onfocus="OL.filterAppSearch('${resId}', '${step.id}', '')"
                                  oninput="OL.filterAppSearch('${resId}', '${step.id}', this.value)">
                            <div id="app-search-results" class="search-results-overlay"></div>
                        </div>
                    `}
                </div>

                <div class="inspector-section">
                    <label class="section-label">🔗 ATTACHED GUIDES & ASSETS</label>
                    <div id="step-resources-list-${step.id}" style="margin-bottom:8px;">
                        ${renderStepResources(resId, step)}
                    </div>
                    <div class="search-map-container">
                        <input type="text" class="modal-input tiny" placeholder="+ Link Resource or SOP..." 
                               onfocus="OL.filterResourceSearch('${resId}', '${step.id}', this.value)"
                               oninput="OL.filterResourceSearch('${resId}', '${step.id}', this.value)">
                        <div id="resource-results-${step.id}" class="search-results-overlay"></div>
                    </div>
                </div>

                <div class="inspector-section">
                    <label class="section-label">📅 DYNAMIC SCHEDULING</label>
                    <div style="display:flex; gap:8px; align-items:center;">
                        <input type="number" class="modal-input tiny" style="width:50px;" 
                               value="${step.timingValue || 0}" 
                               onblur="OL.updateAtomicStep('${resId}', '${step.id}', 'timingValue', this.value)">
                        <select class="modal-input tiny" style="flex:1;" 
                                onchange="OL.updateAtomicStep('${resId}', '${step.id}', 'timingType', this.value)">
                            <option value="after_prev" ${step.timingType === 'after_prev' ? 'selected' : ''}>Days after Previous</option>
                            <option value="after_start" ${step.timingType === 'after_start' ? 'selected' : ''}>Days after Project Start</option>
                            <option value="manual" ${step.timingType === 'manual' ? 'selected' : ''}>Fixed Date</option>
                        </select>
                    </div>
                    ${step.timingType === 'manual' ? `
                        <input type="date" class="modal-input tiny" style="margin-top:8px;"
                               value="${step.fixedDate || ''}"
                               onchange="OL.updateAtomicStep('${resId}', '${step.id}', 'fixedDate', this.value)">
                    ` : ''}
                </div>

                <div class="inspector-section">
                    <div class="section-label">📤 OUTPUT CONDITIONS (To where?)</div>
                    ${step.logic.out.map((l, i) => OL.renderLogicBlock(resId, step.id, 'out', i, l, allOptions)).join('')}
                    <button class="add-logic-btn" onclick="OL.addStepLogic('${resId}', '${step.id}', 'out')">+ Add Output Rule</button>
                </div>

                <div class="inspector-section">
                    <label class="section-label">🏷️ DATA REQUIREMENTS (INPUT/OUTPUT)</label>
                    <div class="pill-display" style="display:flex; flex-wrap:wrap; gap:4px; margin-bottom:8px;">
                        ${step.datapoints && step.datapoints.length > 0 
                            ? OL.renderDataTagPills(resId, step.id, step.datapoints) 
                            : '<div class="tiny muted italic">No data mapped. Drag tags from sidebar to add.</div>'}
                    </div>
                    
                    <div class="data-drop-zone-hint" 
                        ondragover="event.preventDefault(); this.style.borderColor='var(--accent)';" 
                        ondragleave="this.style.borderColor='transparent';"
                        ondrop="OL.handleUniversalDropOnStep(event, '${resId}', '${step.id}')"
                        style="border: 1px dashed transparent; border-radius: 4px; padding: 5px; text-align: center; transition: 0.2s;">
                        <small class="tiny muted" style="font-size: 8px;">Drop tags here to map</small>
                    </div>
                </div>
            </div>
        `;
        return;
    }
    // 📑 3. RESOURCE (CARD) DETAIL MODE
if (mode === 'cards' && resId) {
    const res = resources.find(r => String(r.id) === String(resId));
    if (!res) return;

    const rawType = String(res.type || 'General');
    const resTypeLower = rawType.toLowerCase();
    
    // 1. Resolve Auto-Mapping from Registry
    const typeDef = (state.master.resourceTypes || []).find(t => t.type.toLowerCase() === resTypeLower);
    const isLockedType = !!(typeDef && typeDef.matchedFunctionId);
    const isZap = resTypeLower === 'zap';
    const autoApp = (isLockedType && !isZap) ? OL.getAppByFunction(rawType, res.matchedFunctionId) : null;

    // 🎯 2. THE OVERRIDE PROTECTION
    // Only auto-assign if the field is currently EMPTY.
    if (autoApp && !res.appId) {
        console.log(`🤖 Inspector auto-assigning ${autoApp.name}`);
        res.appId = autoApp.id;
        res.appName = autoApp.name;
        OL.handleResourceSave(res.id, 'appId', autoApp.id);
        OL.handleResourceSave(res.id, 'appName', autoApp.name);
    }

    // 3. Determine UI state for the override badge
    const isManualOverride = res.appId && autoApp && String(res.appId) !== String(autoApp.id);

    content.innerHTML = `
        <div class="inspector-header">
            <div class="section-label">EDIT RESOURCE</div>
            <textarea id="modal-res-name" class="inspector-name-input res-name-auto" 
                onblur="OL.handleResourceSave('${res.id}', 'name', this.value)">${esc(res.name)}</textarea>
        </div>

        <div class="inspector-body">
            <div class="inspector-section no-border">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                    <label class="section-label" style="margin:0;">📱 PRIMARY APPLICATION</label>
                    ${isManualOverride ? '<span class="tiny accent bold" style="font-size:8px; letter-spacing:0.5px;">CUSTOM OVERRIDE</span>' : ''}
                </div>

                <div id="res-app-pill-${res.id}" class="pill-display">
                    ${isZap ? `
                        <div class="tiny muted italic">Multi-app automation.</div>
                    ` : (res.appId ? `
                        <div class="pill ${isManualOverride ? 'accent' : 'primary'}" 
                             style="display:flex; justify-content:space-between; align-items:center; width:100%;">
                            <span class="pill-text">
                                ${isManualOverride ? '✏️' : '🤖'} ${esc(res.appName)}
                            </span>
                            <b class="is-clickable pill-remove" 
                               title="Clear and Revert"
                               style="padding: 2px 6px; opacity: 0.5;"
                               onclick="OL.handleResourceSave('${res.id}', 'appId', null); OL.handleResourceSave('${res.id}', 'appName', null); OL.openInspector('${res.id}', null, 'cards');">
                               ×
                            </b>
                        </div>
                    ` : `
                        <div class="search-map-container">
                            <input type="text" class="modal-input tiny" placeholder="Search App Registry..."
                                   onfocus="OL.filterAppSearch('${res.id}', null, true, '')"
                                   oninput="OL.filterAppSearch('${res.id}', null, true, this.value)">
                            <div id="res-app-results" class="search-results-overlay"></div>
                        </div>
                    `)}
                </div>
            </div>

            ${isLockedType && !autoApp && !isZap ? `
                <div class="inspector-section no-border">
                    <div class="pill warning">
                        <span class="pill-text">⚠️ No Primary tool found for this function in the Registry.</span>
                    </div>
                </div>
            ` : ''}

                <div class="inspector-section no-border">
                    <label class="section-label">🔗 EXTERNAL LINK (${isZap ? 'ZAPIER' : 'DASHBOARD'})</label>
                    <input type="url" class="modal-input tiny" placeholder="https://..." value="${esc(res.externalLink || '')}" onblur="OL.handleResourceSave('${res.id}', 'externalLink', this.value)">
                </div>

                ${!isZap ? `
                <div class="inspector-section no-border">
                    <label class="section-label">👤 RESOURCE ASSIGNEE(S)</label>
                    <div id="res-assignee-pills-${res.id}" class="pill-display assignee-row">
                        ${(res.assignees || []).length > 0 ? res.assignees.map((a, idx) => `
                            <div class="pill accent">
                                <span class="pill-text">${a.type === 'person' ? '👤' : '👥'} ${esc(a.name)}</span>
                                <b class="is-clickable pill-remove" onclick="OL.removeResourceAssignee('${res.id}', ${idx})">×</b>
                            </div>
                        `).join('') : '<div class="tiny muted italic">Unassigned</div>'}
                    </div>
                    <div class="search-map-container">
                        <input type="text" class="modal-input tiny" placeholder="Search People or Roles..." onfocus="OL.filterAssignmentSearch('${res.id}', null, true, '')" oninput="OL.filterAssignmentSearch('${res.id}', null, true, this.value)">
                        <div id="res-assignment-results" class="search-results-overlay"></div>
                    </div>
                </div>
                ` : ''}

                <div class="inspector-section no-border">
                    <label class="section-label">📅 ${isZap ? 'GO-LIVE DATE' : 'DUE DATE'}</label>
                    <input type="date" class="modal-input tiny" value="${res.dueDate || ''}" onchange="OL.handleResourceSave('${res.id}', 'dueDate', this.value)">
                </div>

                <div class="inspector-section">
                    <label class="section-label">📂 CLASSIFICATION</label>
                    <select class="modal-input tiny" onchange="OL.handleResourceSave('${res.id}', 'type', this.value); OL.openInspector('${res.id}', null, 'cards');">
                        <option value="General" ${res.type === 'General' ? 'selected' : ''}>General</option>
                        ${(state.master.resourceTypes || []).map(t => `<option value="${esc(t.type)}" ${res.type === t.type ? 'selected' : ''}>${esc(t.type)}</option>`).join('')}
                    </select>
                </div>

                <div class="inspector-section">
                    <label class="section-label">📝 DESCRIPTION</label>
                    <textarea class="modal-textarea res-desc-input" placeholder="Notes..." onblur="OL.handleResourceSave('${res.id}', 'description', this.value)">${esc(res.description || '')}</textarea>
                </div>
            </div>
        `;
        return;
    }

    content.innerHTML = `<div class="muted-notice">Select a card or step to inspect.</div>`;
};

window.renderStepResources = function(resId, step) {
    const links = step.links || [];
    if (links.length === 0) return '<div class="tiny muted" style="padding: 5px; opacity:0.6;">No linked items.</div>';
    
    return links.map((link, idx) => {
        // Determine Icon based on type
        const isSOP = link.type === 'sop' || link.type === 'guide';
        const icon = isSOP ? '📖' : '📱';
        
        // Navigation Logic
        const openAction = isSOP ? `OL.openHowToModal('${link.id}')` : `OL.openResourceModal('${link.id}')`;
        const deleteAction = `event.stopPropagation(); OL.removeStepLink('${resId}', '${step.id}', ${idx})`;

        return `
            <div class="pill soft is-clickable" 
                 style="display:flex; align-items:center; gap:8px; margin-bottom:4px; padding:6px 10px; background: rgba(255,255,255,0.05); border-radius: 4px;"
                 onclick="${openAction}">
                <span style="font-size:10px;">${icon}</span>
                <span style="flex:1; font-size:10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                    ${esc(link.name)}
                </span>
                <b class="pill-remove-x" 
                   style="cursor:pointer; opacity: 0.4; padding: 2px 5px;" 
                   onmouseover="this.style.opacity='1'; this.style.color='var(--danger)'"
                   onmouseout="this.style.opacity='0.4'; this.style.color='inherit'"
                   onclick="${deleteAction}">×</b>
            </div>`;
    }).join('');
};

OL.updateAtomicStep = async function(resId, stepId, field, value) {
    // 1. Get the current project data directly
    const data = OL.getCurrentProjectData(); 
    const projectResources = data.resources || [];
    
    // 2. 🔍 Find the specific instance on the map
    // We use String() to avoid Type mismatches (Number vs String)
    const res = projectResources.find(r => String(r.id) === String(resId));

    if (!res) {
        console.error("❌ Resource not found in Project Data:", resId);
        // Fallback: Check if it's a Master resource being edited in the Library
        const masterRes = (state.master?.resources || []).find(r => String(r.id) === String(resId));
        if (!masterRes) return;
        
        // If editing a master, point 'res' to that
        var targetRes = masterRes;
    } else {
        var targetRes = res;
    }

    if (!targetRes.steps) {
        console.error("❌ This resource has no steps array:", resId);
        return;
    }

    // 3. 🎯 Find the Step by ID
    const step = targetRes.steps.find(s => String(s.id) === String(stepId));
    
    if (!step) {
        console.error("❌ Step ID not found in this resource:", stepId);
        return;
    }

    // 4. Update the value
    step[field] = value;
    console.log(`✅ ${field} updated to: ${value}`);

    // 5. Persist & Refresh
    await OL.persist();
    
    // If we are on the map, redraw to show the new name/desc
    if (window.location.hash.includes('visualizer')) {
        OL.renderVisualizer();
    }
};

OL.filterAppSearch = function(parentId, stepId, query) {
    const resultsOverlay = document.getElementById('app-search-results');
    if (!resultsOverlay) return;

    const q = (query || "").toLowerCase().trim();
    const client = getActiveClient();
    const localApps = client?.projectData?.localApps || [];
    const matches = localApps.filter(a => a.name.toLowerCase().includes(q));

    if (matches.length === 0) {
        resultsOverlay.innerHTML = `<div class="p-10 tiny muted">No apps found.</div>`;
        resultsOverlay.style.display = 'block';
        return;
    }

    resultsOverlay.innerHTML = matches.map(app => `
        <div class="search-result-item" 
             style="cursor: pointer; padding: 8px; border-bottom: 1px solid var(--line);"
             onmousedown="event.preventDefault(); event.stopPropagation(); OL.selectAppForStep('${parentId}', '${stepId}', '${app.id}', '${esc(app.name)}');">
            <div style="display:flex; align-items:center; gap:8px;">
                <span>📱</span>
                <div>${esc(app.name)}</div>
            </div>
        </div>
    `).join('');
    
    resultsOverlay.style.display = 'block';
};

window.OL.selectAppForStep = async function(parentId, stepId, appId, appName) {
    const res = OL.getResourceById(parentId);
    if (!res) return;

    const step = (res.steps || []).find(s => String(s.id) === String(stepId));
    if (step) {
        // 1. Update the data
        step.appId = appId;
        step.appName = appName;
        
        // 2. Persist
        await OL.persist();
        
        // 3. 🚀 THE FIX: Manually find the input and force the new value
        // This stops the browser from holding onto your 'typed' string.
        const input = document.querySelector('.inspector-body .search-map-container input');
        if (input) {
            input.value = appName;
            input.blur(); // Remove focus to trigger the UI refresh properly
        }

        // 4. Hide the results overlay
        const resultsOverlay = document.getElementById('app-search-results');
        if (resultsOverlay) resultsOverlay.style.display = 'none';
        
        // 5. Re-render the whole panel string
        OL.openInspector(stepId, parentId);
    }
};

window.OL.removeAppFromStep = async function(resId, stepId) {
    const res = OL.getResourceById(resId);
    if (!res) return;

    const step = (res.steps || []).find(s => String(s.id) === String(stepId));
    if (step) {
        // Clear the linkage data
        step.appId = null;
        step.appName = null;
        
        await OL.persist();
        
        // 🔄 Force re-render of the inspector to hide the pill and show the search box
        console.log("🔄 App removed. Re-rendering inspector.");
        OL.openInspector(resId, stepId);
    }
};

OL.getFilteredAssigneeOptions = function(query) {
    const q = (query || "").toLowerCase().trim();
    const client = getActiveClient();
    
    // 1. Define Virtual & Global Options
    const virtualOptions = [
        { id: 'any-team', name: 'Any Team Member', type: 'role', icon: '👥' },
        { id: 'all-client', name: 'Any Client', type: 'role', icon: '🏠' },
        { id: 'role-client-1', name: 'Client 1', type: 'role', icon: '👤' },
        { id: 'role-client-2', name: 'Client 2', type: 'role', icon: '👤' },
        { id: 'role-coi', name: 'COI', type: 'role', icon: '👨‍💼' },
        { id: 'role-sphynx', name: 'Sphynx', type: 'role', icon: '👩‍🎤' }
    ];

    // 2. Gather Dynamic Data
    const masterRoles = (state.master.roles || []).map(r => ({ id: r.id, name: r.name, type: 'role', icon: '🎭' }));
    const clientRoles = (client?.projectData?.roles || []).map(r => ({ id: r.id, name: r.name, type: 'role', icon: '🎭' }));
    
    // Extract roles defined within the team member objects themselves
    const teamList = [...(state.master.teamMembers || []), ...(client?.projectData?.teamMembers || [])];
    const inlineRoles = [...new Set(teamList.flatMap(m => m.roles || []))].map(r => ({ id: `role-${r}`, name: r, type: 'role', icon: '🎭' }));

    const people = teamList.map(m => ({ id: m.id, name: m.name, type: 'person', icon: '👤' }));
    const apps = (client?.projectData?.localApps || []).map(a => ({ id: a.id, name: a.name, type: 'app', icon: '📱' }));

    // 3. Combine and Filter
    const all = [...virtualOptions, ...masterRoles, ...clientRoles, ...inlineRoles, ...people, ...apps];
    
    // Deduplicate by name (in case a role is in multiple lists)
    const unique = Array.from(new Map(all.map(item => [item.name.toLowerCase(), item])).values());

    return unique.filter(item => item.name.toLowerCase().includes(q));
};

OL.filterAssignmentSearch = function(parentId, stepId, isResource, query) {
    const resultsOverlay = document.getElementById('assignment-search-results');
    if (!resultsOverlay) return;

    const q = (query || "").toLowerCase().trim();
    if (!q && !document.activeElement.matches(':focus')) {
        resultsOverlay.style.display = 'none';
        return;
    }

    const matches = OL.getFilteredAssigneeOptions(q);

    if (matches.length === 0) {
        resultsOverlay.innerHTML = `<div class="p-10 tiny muted">No matches found.</div>`;
        resultsOverlay.style.display = 'block';
        return;
    }

    // Group by type for the labels
    const groups = {
        role: { label: 'Roles & Clients', items: [] },
        person: { label: 'Team Members', items: [] },
        app: { label: 'Applications', items: [] }
    };

    matches.forEach(opt => groups[opt.type].items.push(opt));

    let html = '';
    Object.values(groups).forEach(g => {
        if (g.items.length === 0) return;
        html += `<div class="search-category-label">${g.label}</div>`;
        html += g.items.map(item => `
            <div class="search-result-item" onmousedown="event.preventDefault(); OL.executeAssignment('${parentId}', '${stepId}', false, '${item.id}', '${esc(item.name)}', '${item.type}')">
                ${item.icon} ${esc(item.name)}
            </div>
        `).join('');
    });

    resultsOverlay.innerHTML = html;
    resultsOverlay.style.display = 'block';
};

window.OL.executeAssignment = async function(parentId, stepId, isResource, assigneeId, assigneeName, type) {
    const res = OL.getResourceById(parentId);
    if (!res) return;

    const step = (res.steps || []).find(s => String(s.id) === String(stepId));
    if (step) {
        // Initialize as array if it doesn't exist
        if (!step.assignees) step.assignees = [];

        // Prevent duplicate assignments
        const exists = step.assignees.some(a => a.id === assigneeId);
        if (!exists) {
            step.assignees.push({
                id: assigneeId,
                name: assigneeName,
                type: type
            });
            await OL.persist();
        }
        
        // Clear search and refresh
        const overlay = document.getElementById('assignment-search-results');
        if (overlay) overlay.style.display = 'none';
        OL.openInspector(parentId, stepId);
    }
    // Add this line to the end of window.OL.executeAssignment
    const searchInput = document.querySelector('.inspector-section input[placeholder*="Add Person"]');
    if (searchInput) {
        searchInput.value = '';
        searchInput.focus(); // Keep focus if you want to add multiple people quickly
    }
};

window.OL.removeAssignee = async function(parentId, stepId, index) {
    const res = OL.getResourceById(parentId);
    const step = res?.steps?.find(s => String(s.id) === String(stepId));
    if (step && step.assignees) {
        step.assignees.splice(index, 1);
        await OL.persist();
        OL.openInspector(parentId, stepId);
    }
};

state.filterMatches = [];
state.canvasMatches = [];
state.currentCanvasMatchIdx = -1;

// Add this inside your toolbar initialization or global scope
document.addEventListener('keydown', (e) => {
    const searchInput = document.getElementById('canvas-filter-input');
    
    // If the user hits 'Enter' while inside the search box...
    if (e.key === 'Enter' && document.activeElement === searchInput) {
        e.preventDefault();
        OL.centerNextCanvasMatch(); // The cycling function we built earlier
    }
});

// 1. Filter Resources for the Target/Milestone search
OL.filterTargetSearch = function(resId, stepId, query) {
    const resultsOverlay = document.getElementById('target-search-results');
    if (!resultsOverlay) return;

    const q = (query || "").toLowerCase().trim();
    const data = OL.getCurrentProjectData();
    // Show all resources except the one we are currently inside
    const matches = (data.resources || []).filter(r => 
        String(r.id) !== String(resId) && r.name.toLowerCase().includes(q)
    );

    if (matches.length === 0) {
        resultsOverlay.innerHTML = `<div class="p-10 tiny muted">No matching resources found.</div>`;
        resultsOverlay.style.display = 'block';
        return;
    }

    resultsOverlay.innerHTML = matches.map(r => `
        <div class="search-result-item" onmousedown="event.preventDefault(); OL.setStepTargetResource('${resId}', '${stepId}', '${r.id}', '${esc(r.name)}')">
            🎯 ${esc(r.name)}
        </div>
    `).join('');
    
    resultsOverlay.style.display = 'block';
};

// 2. Set the Milestone Target
OL.setStepTargetResource = async function(resId, stepId, targetId, targetName) {
    const res = OL.getResourceById(resId);
    const step = res?.steps?.find(s => String(s.id) === String(stepId));
    
    if (step) {
        step.targetResourceId = targetId;
        step.targetResourceName = targetName;
        await OL.persist();
        
        // Hide overlay and refresh inspector
        const overlay = document.getElementById('target-search-results');
        if (overlay) overlay.style.display = 'none';
        OL.openInspector(resId, stepId);
    }
};

OL.filterResourceSearch = function(resId, stepId, query) {
    const resultsOverlay = document.getElementById(`resource-results-${stepId}`);
    if (!resultsOverlay) return;

    const q = (query || "").toLowerCase().trim();
    if (!q) {
        resultsOverlay.style.display = 'none';
        return;
    }

    const client = getActiveClient();
    
    // 1. GATHER DATA
    // All project resources (excluding the one we are currently editing)
    const allResources = [...(state.master.resources || []), ...(client?.projectData?.localResources || [])];
    const filteredRes = allResources.filter(r => r.id !== resId && r.name.toLowerCase().includes(q));

    // All How-To Guides
    const allHowTos = [...(state.master.howTos || []), ...(client?.projectData?.localHowTos || [])];
    const filteredHowTos = allHowTos.filter(h => h.name.toLowerCase().includes(q));

    if (!filteredRes.length && !filteredHowTos.length) {
        resultsOverlay.innerHTML = `<div class="p-10 tiny muted">No matches found.</div>`;
        resultsOverlay.style.display = 'block';
        return;
    }

    // 2. RENDER HTML
    let html = '';

    // Assets/Resources Section
    if (filteredRes.length) {
        html += `<div class="search-category-label">Project Assets</div>`;
        html += filteredRes.map(r => `
            <div class="search-result-item" onmousedown="event.preventDefault(); OL.addLinkToStep('${resId}', '${stepId}', '${r.id}', '${esc(r.name)}', 'resource')">
                📱 ${esc(r.name)}
            </div>`).join('');
    }

    // How-To Guides Section
    if (filteredHowTos.length) {
        html += `<div class="search-category-label">How-To Guides (SOPs)</div>`;
        html += filteredHowTos.map(h => `
            <div class="search-result-item" onmousedown="event.preventDefault(); OL.addLinkToStep('${resId}', '${stepId}', '${h.id}', '${esc(h.name)}', 'sop')">
                📖 ${esc(h.name)}
            </div>`).join('');
    }

    resultsOverlay.innerHTML = html;
    resultsOverlay.style.display = 'block';
};

OL.toggleFilterMenu = function(e) {
    if (e) e.stopPropagation();
    const menu = document.getElementById('v2-filter-submenu');
    const btn = document.getElementById('filter-menu-btn');
    
    const isShowing = menu.style.display === 'flex';
    
    menu.style.display = isShowing ? 'none' : 'flex';
    btn.classList.toggle('active', !isShowing);
};

OL.syncCanvasFilters = function() {
    const query = document.getElementById('canvas-filter-input')?.value.toLowerCase().trim() || "";
    const statusF = document.getElementById('filter-scoped')?.value || ""; 
    const typeF = document.getElementById('filter-type')?.value || "";
    const appF = document.getElementById('filter-app')?.value || "";
    const assigneeF = document.getElementById('filter-assignee')?.value || "";
    const dataTagF = document.getElementById('filter-data-tag')?.value || "";

    state.canvasMatches = [];
    const nodes = document.querySelectorAll('.v2-node-card');
    
    // 💡 Determine if we are actively filtering right now
    const isFiltering = !!(query || statusF || typeF || appF || assigneeF || dataTagF);

    nodes.forEach(node => {
        const resId = node.id.replace('v2-node-', '');
        const res = OL.getResourceById(resId);
        if (!res) return;

        // --- CRITERIA CHECKS ---
        const matchesQuery = !query || res.name.toLowerCase().includes(query);
        const matchesType = !typeF || res.type === typeF;
        const matchesApp = !appF || (res.steps || []).some(s => s.appName === appF);
        // Update this specific block inside OL.syncCanvasFilters

        const matchesAssignee = !assigneeF || (res.steps || []).some(s => {
            // 🛡️ THE SHIELD: If step is null or undefined, skip it safely
            if (!s) return false; 

            // 1. Check the new 'assignees' array (Multi-select)
            const inArray = Array.isArray(s.assignees) && s.assignees.some(a => {
                if (!a) return false;
                return (a.name || a) === assigneeF;
            });
            
            // 2. Check the legacy 'assigneeName' string (as a fallback)
            const isLegacyMatch = s.assigneeName === assigneeF;

            return inArray || isLegacyMatch;
        });
         

        // 🚀 STATUS CHECK (Scoped vs Unscoped)
        let matchesStatus = true;
        const isInScope = !!OL.isResourceInScope(resId);
        if (statusF === "scoped") matchesStatus = isInScope;
        if (statusF === "unscoped") matchesStatus = !isInScope;

        const matchesDataTag = !dataTagF || (res.steps || []).some(s => 
            (s.datapoints || []).some(d => d.id === dataTagF)
        );

        // --- FINAL DECISION ---
        const isMatch = matchesQuery && matchesType && matchesApp && matchesAssignee 
        && matchesStatus && matchesDataTag;

        if (isMatch) {
            node.classList.remove('node-dimmed', 'filter-hidden'); // Ensure it's visible
            node.classList.add('search-match');
            
            // Only add to navigation if it's on the canvas
            if (node.closest('#v2-node-layer')) {
                state.canvasMatches.push(node.id);
            }
        } else {
            node.classList.remove('search-match', 'search-active');
            // 🚀 If we are filtering, DIM the non-matches. If not, reset them.
            if (isFiltering) {
                node.classList.add('node-dimmed');
            } else {
                node.classList.remove('node-dimmed');
            }
        }
    });

    // --- UI COUNTER & NAV ---
    const nav = document.getElementById('search-nav-controls');
    const countLabel = document.getElementById('canvas-match-count');

    if (isFiltering && state.canvasMatches.length > 0) {
        nav.classList.add('is-visible');
        if (state.currentCanvasMatchIdx === -1) state.currentCanvasMatchIdx = 0;
        countLabel.innerText = `${state.currentCanvasMatchIdx + 1}/${state.canvasMatches.length}`;
    } else {
        nav.classList.remove('is-visible');
    }

    // Update lines (which now handle dimming internally)
    if (window.OL.drawConnections) OL.drawConnections();
};

OL.centerNextCanvasMatch = function() {
    if (state.canvasMatches.length === 0) return;

    // Cycle through indices
    state.currentCanvasMatchIdx = (state.currentCanvasMatchIdx + 1) % state.canvasMatches.length;
    const targetId = state.canvasMatches[state.currentCanvasMatchIdx];
    
    document.getElementById('canvas-match-count').innerText = 
        `${state.currentCanvasMatchIdx + 1}/${state.canvasMatches.length}`;

    OL.centerCanvasNode(targetId);
};

OL.centerPrevCanvasMatch = function() {
    if (!state.canvasMatches || state.canvasMatches.length === 0) return;

    state.currentCanvasMatchIdx--;
    if (state.currentCanvasMatchIdx < 0) {
        state.currentCanvasMatchIdx = state.canvasMatches.length - 1;
    }
    
    const targetId = state.canvasMatches[state.currentCanvasMatchIdx];
    
    // Update UI Counter
    const countLabel = document.getElementById('canvas-match-count');
    if (countLabel) {
        countLabel.innerText = `${state.currentCanvasMatchIdx + 1}/${state.canvasMatches.length}`;
    }

    OL.centerCanvasNode(targetId);
};

OL.centerCanvasNode = function(nodeId) {
    let nodeEl = document.getElementById(nodeId) || document.getElementById(`v2-node-${nodeId}`);
    
    if (!nodeEl) {
        console.warn("❌ Centering failed: Could not find element with ID", nodeId);
        return;
    }
    // 1. 🔍 THE AUTO-OPEN CHECK
    // Check if the node is inside a tray/sidebar
    const workbench = document.getElementById('v2-workbench-sidebar');
    const shelf = document.getElementById('global-shelf');

    // 1. 🔍 THE AUTO-OPEN CHECK
    const viewport = document.getElementById('v2-viewport');

    // Workbench Check
    if (nodeEl.closest('#v2-workbench-sidebar')) {
        if (viewport.classList.contains('tray-closed')) {
            OL.toggleWorkbenchTray();
        }
    }

    // 🚀 ADDED: Global Shelf Check
    if (nodeEl.closest('#global-shelf')) {
        const shelf = document.getElementById('global-shelf');
        // If you have a specific class or style that hides the shelf, toggle it here
        // Example: if (shelf.style.display === 'none') shelf.style.display = 'block';
        
        // Smooth scroll to the item in the shelf list
        nodeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    // If it's in the workbench, make sure the workbench is open
    if (nodeEl.closest('#v2-workbench-sidebar')) {
        if (viewport.classList.contains('tray-closed')) {
            console.log("📂 Auto-opening Workbench for search match...");
            OL.toggleWorkbenchTray(); // Use your existing toggle function
        }
    }
    
    // 2. 🎯 SNAP TO CENTER (Only if it's on the Canvas)
    if (nodeEl.closest('#v2-node-layer')) {
        const nodeX = parseFloat(nodeEl.style.left) || 0;
        const nodeY = parseFloat(nodeEl.style.top) || 0;
        const viewW = viewport ? viewport.offsetWidth : window.innerWidth;
        const viewH = viewport ? viewport.offsetHeight : window.innerHeight;

        const moveX = (viewW / 2) - (nodeX + (nodeEl.offsetWidth / 2));
        const moveY = (viewH / 2) - (nodeY + (nodeEl.offsetHeight / 2));

        const layer = document.getElementById('v2-node-layer');
        if (layer) {
            layer.style.transition = "transform 0.5s cubic-bezier(0.2, 0.8, 0.2, 1)";
            layer.style.transform = `translate(${moveX}px, ${moveY}px)`;
        }
    } else {
        // 💫 If it's in a sidebar, just wiggle/highlight it since we can't "center" it
        nodeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    // 3. ✨ VISUAL FOCUS
    document.querySelectorAll('.v2-node-card').forEach(n => n.classList.remove('search-focus'));
    nodeEl.classList.add('search-focus');
};

OL.refreshFilterDropdowns = function() {
    const client = getActiveClient();
    const apps = client?.projectData?.localApps || [];
    const team = [
        ...(state.master.teamMembers || []), 
        ...(client?.projectData?.teamMembers || []),
        { name: 'Client 1' }, { name: 'Client 2' } // Include your Ghost Roles
    ];

    const appSelect = document.getElementById('filter-app');
    const assigneeSelect = document.getElementById('filter-assignee');

    if (appSelect) {
        appSelect.innerHTML = `<option value="">All Apps</option>` + 
            apps.map(a => `<option value="${esc(a.name)}">${esc(a.name)}</option>`).join('');
    }

    if (assigneeSelect) {
        assigneeSelect.innerHTML = `<option value="">All Owners</option>` + 
            team.map(t => `<option value="${esc(t.name)}">${esc(t.name)}</option>`).join('');
    }
};

OL.clearAllFilters = function() {
    // 1. 📝 CLEAR THE INPUTS
    const searchInput = document.getElementById('canvas-filter-input');
    if (searchInput) searchInput.value = "";
    
    const selects = document.querySelectorAll('#v2-filter-submenu select');
    selects.forEach(select => { select.selectedIndex = 0; });

    // 2. 🚀 REMOVE ALL CSS CLASSES
    const allNodes = document.querySelectorAll('.v2-node-card');
    allNodes.forEach(node => {
        node.classList.remove('search-match', 'search-active', 'filter-hidden', 'node-dimmed', 'search-focus');
    });

    // 3. 🗺️ RESET NAVIGATION & UI
    state.canvasMatches = [];
    state.currentCanvasMatchIdx = -1;
    
    // Reset the "1/5" counter text
    const countLabel = document.getElementById('canvas-match-count');
    if (countLabel) countLabel.innerText = "0/0";

    // Hide the navigation row
    const nav = document.getElementById('search-nav-controls');
    if (nav) nav.classList.remove('is-visible');

    // Reset the "active filter" count pill on the main button
    const countPill = document.getElementById('active-filter-count');
    if (countPill) {
        countPill.innerText = "0";
        countPill.style.display = 'none';
    }

    // Close the submenu if open
    const filterMenu = document.getElementById('v2-filter-submenu');
    if (filterMenu) filterMenu.style.display = 'none';
    const filterBtn = document.getElementById('filter-menu-btn');
    if (filterBtn) filterBtn.classList.remove('active');

    // 4. 🔗 RESTORE CONNECTIONS
    document.querySelectorAll('#v2-connections path').forEach(path => {
        path.style.opacity = "0.7";
    });

    // 5. 🔄 FINAL SYNC
    OL.syncCanvasFilters(); 
    console.log("✨ Canvas and Search Bar fully reset.");

    // 6. 🚀 RESET SCROLL & VIEWPORT POSITION
    const nodeLayer = document.getElementById('v2-node-layer');
    const stageLayer = document.getElementById('v2-stage-layer');
    const lineGroup = document.getElementById('line-group');

    if (nodeLayer) {
        nodeLayer.classList.remove('canvas-dimmed');
        // Reset the CSS translation (centering) applied during search
        nodeLayer.style.transform = "translate(0, 0)"; 
        nodeLayer.style.transition = "transform 0.3s ease"; // Smooth snap back
    }

    if (stageLayer) {
        stageLayer.style.transform = "translate(0, 0)";
        stageLayer.style.transition = "transform 0.3s ease";
    }

    // 🔗 Restore all connection lines to full visibility
    if (lineGroup) {
        const paths = lineGroup.querySelectorAll('path');
        paths.forEach(p => {
            p.style.opacity = "0.7"; // Your default opacity
            p.style.strokeWidth = "2px";
        });
    }

    // Reset the "active trace" logic so highlight flows disappear
    state.v2.activeTrace = null;
    state.v2.highlightedIds = [];

    // Trigger one final redraw of the visualizer to snap everything into place
    OL.renderVisualizer();
};

window.OL.addLinkToStep = async function(resId, stepId, linkId, linkName, type) {
    const res = OL.getResourceById(resId);
    if (!res) return;

    const step = (res.steps || []).find(s => String(s.id) === String(stepId));
    if (step) {
        if (!step.links) step.links = [];

        // Avoid duplicate links
        if (!step.links.some(l => l.id === linkId)) {
            step.links.push({
                id: linkId,
                name: linkName,
                type: type
            });
            await OL.persist();
        }
        
        // Hide overlay and clear input
        const overlay = document.getElementById(`resource-results-${stepId}`);
        if (overlay) overlay.style.display = 'none';
        
        // 🔄 Force refresh to show the new pill
        OL.openInspector(resId, stepId);
    }
};

window.OL.removeStepLink = async function(resId, stepId, linkIdx) {
    const res = OL.getResourceById(resId);
    if (!res) return;

    // Find the specific step
    const step = (res.steps || []).find(s => String(s.id) === String(stepId));
    
    if (step && step.links) {
        // Remove the item at the specific index
        step.links.splice(linkIdx, 1);
        
        // Save state
        await OL.persist();
        
        // 🔄 Immediate UI Refresh
        console.log("🗑️ Attachment removed from step:", stepId);
        OL.openInspector(resId, stepId);
    }
};

OL.renderLogicBlock = function(resId, stepId, dir, i, logic, allOptions) {
    const myFullId = `${resId}-${stepId}`; 
    const targetId = dir === 'out' ? (logic.targetId || "") : (logic.sourceId || "");
    const isReadOnly = dir === 'in';
    
    let displayLabel = '-- Select Step --';

    if (targetId) {
        if (targetId === myFullId) {
            displayLabel = '[Current Step / Loopback]';
        } else {
            // 🚀 THE FIX: Robust Parsing for IDs with multiple hyphens
            // This finds the LAST hyphen to separate Resource ID from Step ID
            const lastHyphenIdx = String(targetId).lastIndexOf('-');
            const tResId = targetId.substring(0, lastHyphenIdx);
            const tStepId = targetId.substring(lastHyphenIdx + 1);
            
            const data = OL.getCurrentProjectData();
            const targetRes = data.resources.find(r => String(r.id) === String(tResId));
            
            if (targetRes) {
                // Find by unique ID string
                const targetStep = (targetRes.steps || []).find(s => String(s.id) === String(tStepId));
                
                // Fallback: If it's old index-based data
                const finalStep = targetStep || targetRes.steps[parseInt(tStepId)];
                
                const locationPrefix = targetRes.isTopShelf ? '🏛️ ' : (targetRes.isGlobal ? '🛠️ ' : '📍 ');
                displayLabel = `${locationPrefix}${targetRes.name} > ${finalStep?.name || 'Unnamed Step'}`;
            } else {
                displayLabel = '⚠️ Missing Resource';
            }
        }
    }

    const isLoop = (logic.type === 'loop') || (String(targetId) === String(myFullId));
    const isNextStep = logic.type === 'next';
    const isDelay = logic.type === 'delay';

    return `
        <div class="logic-item ${isReadOnly ? 'is-readonly' : ''}" 
             style="border-left: 3px solid ${isLoop ? 'var(--warning)' : (dir === 'out' ? 'var(--accent)' : '#4a90e2')}; 
                    padding: 12px; margin-bottom: 10px; position: relative; background: rgba(255,255,255,0.03); border-radius: 6px;">
            
            <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:6px; gap: 8px;">
                <div style="flex-grow: 1;">
                    <div class="section-label tiny" style="margin-bottom: 4px; color: ${isReadOnly ? 'var(--text-muted)' : 'var(--text-main)'}; font-weight: bold; letter-spacing: 0.5px;">
                        ${dir === 'out' ? '📤 OUTGOING OUTPUT' : '📥 INCOMING INPUT'} ${isReadOnly ? '🔒' : ''}
                    </div>

                    ${dir === 'out' ? `
                        <select class="modal-input tiny" style="margin:0; height:24px;" onchange="OL.updateStepLogic('${resId}', '${stepId}', '${dir}', ${i}, 'type', this.value)">
                            <option value="next" ${isNextStep ? 'selected' : ''}>➔ Next Step</option>
                            <option value="link" ${!isLoop ? 'selected' : ''}>Standard Link</option>
                            <option value="loop" ${isLoop ? 'selected' : ''}>🔄 Loop/Repeat</option>
                            <option value="delay" ${isDelay ? 'selected' : ''}>⏱︎ Wait For</option>
                        </select>
                    ` : ''}
                </div>

                ${!isReadOnly ? `
                    <button class="logic-delete-btn" onclick="OL.removeStepLogic('${resId}', '${stepId}', '${dir}', ${i})" title="Remove Rule">×</button>
                ` : ''}
            </div>

            <div style="background: rgba(0,0,0,0.2); padding: 6px 8px; border-radius: 4px; margin-bottom: 8px; display: flex; align-items: center; justify-content: space-between; border: 1px solid var(--line);">
                <span style="font-size: 10px; color: var(--text-main);">${esc(displayLabel)}</span>
                ${targetId ? `<button class="logic-jump-btn" onclick="OL.centerCanvasNode('${String(targetId).split('-')[0]}')" title="Jump to Card">🎯</button>` : ''}
            </div>

            <input class="modal-input tiny" value="${esc(logic.rule || '')}" 
                   ${isReadOnly ? 'readonly' : ''}
                   placeholder="${isReadOnly ? 'No condition' : 'Condition (e.g. If Approved)'}" 
                   style="width: 100%; margin-bottom: 8px; ${isReadOnly ? 'border-color: transparent; background: transparent; pointer-events: none; opacity: 0.6;' : ''}"
                   onblur="OL.updateStepLogic('${resId}', '${stepId}', '${dir}', ${i}, 'rule', this.value)">
            
            ${!isReadOnly ? `
                <div class="search-map-container" style="position:relative;">
                    <input type="text" class="modal-input tiny" 
                           placeholder="🔍 Search target resource/step..." 
                           onfocus="OL.filterLogicTargetSearch('${resId}', '${stepId}', '${dir}', ${i}, '')"
                           oninput="OL.filterLogicTargetSearch('${resId}', '${stepId}', '${dir}', ${i}, this.value)">
                    <div id="logic-search-results-${resId}-${stepId}-${i}" class="search-results-overlay" style="max-height: 200px; overflow-y: auto;"></div>
                </div>
            ` : ''}

            ${isLoop && dir === 'out' ? `
                <div style="margin-top:10px; padding-top: 8px; border-top: 1px dashed rgba(255,255,255,0.1);">
                    <div class="section-label" style="font-size:8px; color: var(--warning);">LOOP LIMIT / EXIT CRITERIA</div>
                    <input class="modal-input tiny" value="${esc(logic.loopLimit || '')}" 
                           placeholder="e.g. 3 times..." 
                           style="border-style:dashed; color: var(--warning); border-color: var(--warning);"
                           onblur="OL.updateStepLogic('${resId}', '${stepId}', '${dir}', ${i}, 'loopLimit', this.value)">
                </div>
            ` : ''}
        </div>
    `;
};

OL.filterLogicTargetSearch = function(resId, stepId, dir, logicIdx, query) {
    const listEl = document.getElementById(`logic-search-results-${resId}-${stepId}-${logicIdx}`);
    if (!listEl) return;

    const q = (query || "").toLowerCase().trim();
    const data = OL.getCurrentProjectData();
    const resources = data.resources || [];
    const myFullId = `${resId}-${stepId}`;

    // 1. Get all resources that actually have steps defined
    const activeResources = resources.filter(res => (res.steps || []).length > 0);

    let html = "";

    activeResources.forEach(res => {
        // Identify physical location
        const familyPrefix = res.isTopShelf ? '🏛️ [SHELF] ' : (res.isGlobal ? '🛠️ [WORKBENCH] ' : '📍 [CANVAS] ');
        
        // Filter steps within this resource
        const matchedSteps = res.steps.filter((s, idx) => {
            return res.name.toLowerCase().includes(q) || (s.name || "").toLowerCase().includes(q);
        });

        if (matchedSteps.length > 0) {
            html += `<div class="search-category-label" style="background: rgba(var(--accent-rgb), 0.1); color: var(--accent); padding: 4px 8px; font-size: 10px; margin-top: 5px; border-radius: 4px; font-weight:bold;">${familyPrefix}${esc(res.name)}</div>`;

            matchedSteps.forEach((s) => {
                // Construct the ID: [ResourceID]-[StepID]
                const targetFullId = `${res.id}-${s.id}`; 
                const stepName = s.name || `Unnamed Step`;
                const isSelf = targetFullId === myFullId;

                html += `
                    <div class="search-result-item" 
                        style="padding-left: 20px; font-size: 11px; display: flex; justify-content: space-between; align-items:center;"
                        onmousedown="event.preventDefault(); OL.updateStepTarget('${resId}', '${stepId}', '${dir}', ${logicIdx}, '${targetFullId}')">
                        <span>• ${esc(stepName)}</span>
                        ${isSelf ? '<span style="font-size:8px; background:var(--warning); color:black; padding:1px 4px; border-radius:3px;">LOOP</span>' : ''}
                    </div>
                `;
            });
        }
    });

    listEl.innerHTML = html || '<div class="search-result-item muted">No matches found.</div>';
    listEl.style.display = 'block';

    // Auto-close overlay when clicking elsewhere
    const closeListener = (e) => {
        if (!listEl.contains(e.target) && e.target.tagName !== 'INPUT') {
            listEl.style.display = 'none';
            document.removeEventListener('mousedown', closeListener);
        }
    };
    document.addEventListener('mousedown', closeListener);
};

OL.getAllStepOptions = function() {
    const data = OL.getCurrentProjectData();
    const resources = data.resources || [];
    const stages = data.stages || [];
    let options = [];

    // 1. Filter out Resources that have 0 steps first
    const activeResources = resources.filter(res => res.steps && res.steps.length > 0);

    stages.forEach(stage => {
        // 2. Find only resources that belong to this stage AND have steps
        const stageResources = activeResources.filter(r => r.stageId === stage.id);
        
        // 🚀 THE FIX: If this stage has no resources with steps, skip the stage header entirely
        if (stageResources.length === 0) return;

        // 📂 Add the STAGE header
        options.push({ id: 'header', label: `📂 ${stage.name.toUpperCase()}`, isHeader: true });

        stageResources.forEach(res => {
            const family = activeResources.filter(r => r.originId === res.originId);
            const partNum = family.length > 1 ? ` (${family.findIndex(r => r.id === res.id) + 1}/${family.length})` : '';
            
            // 📦 Add the RESOURCE (Indented level 1)
            options.push({ id: 'header', label: `\u00A0\u00A0📦 ${res.name}${partNum}`, isHeader: true });

            // ⚡ Add the STEPS (Indented level 2)
            res.steps.forEach((step, idx) => {
                options.push({
                    id: `${res.id}-${idx}`,
                    label: `\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0• ${step.name || 'Step ' + (idx + 1)}`
                });
            });
        });
    });

    return options;
};

// ➕ Add Logic to a Step
OL.addStepLogic = function(resId, stepId, direction) {
    const data = OL.getCurrentProjectData();
    const res = data.resources.find(r => String(r.id) === String(resId));
    if (!res) return;

    const step = res.steps.find(s => String(s.id) === String(stepId));
    if (!step) return;

    // 1. Initialize logic if it doesn't exist
    if (!step.logic) step.logic = { in: [], out: [] };
    
    // 2. Push a clean new logic object
    step.logic[direction].push({
        condition: "If...",
        targetId: null,
        action: "Go to Step"
    });

    // 3. CRITICAL: Persist the change and then re-open the inspector to show it
    OL.persist().then(() => {
        OL.openInspector(resId, stepId, 'steps');
        console.log(`✅ Logic added to ${direction} for step ${stepId}`);
    });
};

// 💾 Update Logic Value (Rule or Target)
OL.updateStepLogic = async function(resId, stepTarget, direction, logicIdx, field, value) {
    const data = OL.getCurrentProjectData();
    const res = data.resources.find(r => String(r.id) === String(resId));
    
    // 🎯 FIX: ID-Aware lookup
    let step = res?.steps.find(s => String(s.id) === String(stepTarget));
    if (!step && isFinite(stepTarget)) step = res?.steps[stepTarget];
    
    if (step && step.logic?.[direction]?.[parseInt(logicIdx)]) {
        step.logic[direction][parseInt(logicIdx)][field] = value;

        OL.syncLogicPorts();
        await OL.persist(); 
        
        // Use requestAnimationFrame for smooth line updates
        requestAnimationFrame(() => {
            if (typeof OL.drawConnections === 'function') OL.drawConnections();
        });
    }
};

OL.removeStepLogic = async function(resId, stepTarget, direction, logicIdx) {
    const data = OL.getCurrentProjectData();
    const res = data.resources.find(r => String(r.id) === String(resId));
    
    // 🎯 FIX: ID-Aware lookup
    let step = res?.steps.find(s => String(s.id) === String(stepTarget));
    if (!step && isFinite(stepTarget)) step = res?.steps[stepTarget];

    if (!step || !step.logic) return;

    const itemToRemove = step.logic[direction][logicIdx];
    const partnerId = direction === 'out' ? itemToRemove.targetId : itemToRemove.sourceId;

    if (partnerId) {
        this.clearMirrorLink(`${resId}-${res.steps.indexOf(step)}`, partnerId);
    }

    step.logic[direction].splice(logicIdx, 1);
    
    await OL.persist(); 
    this.drawConnections();
    this.openInspector(resId, step.id); 
};

OL.updateStepTarget = async function(resId, stepId, direction, logicIdx, newPartnerFullId) {
    const data = OL.getCurrentProjectData();
    const res = data.resources.find(r => String(r.id) === String(resId));
    if (!res) return;

    // 🎯 1. FIND THE STEP BY ID (Not Index)
    // This ensures we are saving to the correct step even if the list order changed
    const step = res.steps.find(s => String(s.id) === String(stepId));
    if (!step || !step.logic) {
        console.error("❌ Step logic block not found for stepId:", stepId);
        return;
    }

    const item = step.logic[direction][parseInt(logicIdx)];
    const myFullId = `${res.id}-${stepId}`;

    console.log(`🔗 Saving Logic: [${direction}] at index ${logicIdx} set to target ${newPartnerFullId}`);

    if (direction === 'out') {
        item.targetId = String(newPartnerFullId);
        // Automatic Loop Detection
        item.type = (newPartnerFullId === myFullId) ? 'loop' : 'link';
    } else {
        item.sourceId = String(newPartnerFullId);
    }

    // 💾 2. PERSIST
    OL.syncLogicPorts(); 
    await OL.persist();
    
    // 🧹 3. UI CLEANUP
    // Close the specific search overlay
    const overlay = document.getElementById(`logic-search-results-${resId}-${stepId}-${logicIdx}`);
    if (overlay) overlay.style.display = 'none';

    // 🔄 4. REFRESH
    // Pass the unique stepId back to the inspector
    OL.openInspector(resId, stepId, 'steps');
    
    if (window.location.hash.includes('visualizer')) {
        OL.drawConnections();
    }
};

OL.syncLogicPorts = function() {
    const data = OL.getCurrentProjectData();
    const resources = data.resources || [];

    // 1. Wipe all 'In' arrays to rebuild from 'Out' rules
    resources.forEach(res => {
        (res.steps || []).forEach(step => {
            if (step.logic) step.logic.in = []; 
        });
    });

    // 2. Rebuild 'In' links based on 'Out' rules
    resources.forEach(sourceRes => {
        sourceRes.steps?.forEach((step) => {
            if (!step.logic?.out) return;

            // Filter out rules that might have become invalid
            step.logic.out = step.logic.out.filter(outRule => {
                if (!outRule.targetId) return true; // Keep empty rules for editing

                // 🚀 ROBUST PARSING (Matches renderLogicBlock)
                const lastHyphenIdx = String(outRule.targetId).lastIndexOf('-');
                if (lastHyphenIdx === -1) return false; // Invalid format

                const tResId = outRule.targetId.substring(0, lastHyphenIdx);
                const tStepId = outRule.targetId.substring(lastHyphenIdx + 1);
                
                const targetRes = resources.find(r => String(r.id) === String(tResId));
                if (!targetRes) return false; // Resource deleted? Drop the link.

                // Find step by ID or Index
                const targetStep = (targetRes.steps || []).find(s => String(s.id) === String(tStepId)) 
                                   || targetRes.steps[parseInt(tStepId)];

                if (targetStep) {
                    // It exists! Create the mirrored 'In' rule
                    if (!targetStep.logic) targetStep.logic = { in: [], out: [] };
                    targetStep.logic.in.push({
                        sourceId: `${sourceRes.id}-${step.id}`,
                        rule: outRule.rule || "",
                        type: outRule.type || "link"
                    });
                    return true;
                }
                
                return false; // Step deleted? Drop the link.
            });
        });
    });
};

OL.updateStepLink = function(resId, stepIdx, direction, logicIdx, newTargetId) {
    const data = OL.getCurrentProjectData();
    const resources = data.resources || [];

    const res = resources.find(r => String(r.id) === String(resId));
    const step = res?.steps?.[stepIdx];
    if (!step || !step.logic) return;

    const oldLogic = step.logic[direction][logicIdx];
    const oldTargetId = direction === 'out' ? oldLogic.targetId : oldLogic.sourceId;

    // 1. Clean up the "Old" partner
    if (oldTargetId) {
        this.clearMirrorLink(`${resId}-${stepIdx}`, oldTargetId);
    }

    // 2. Set the "New" link
    if (direction === 'out') {
        oldLogic.targetId = newTargetId;
    } else {
        oldLogic.sourceId = newTargetId;
    }

    // 3. Create the "New" mirror
    if (newTargetId) {
        this.createMirrorLink(`${resId}-${stepIdx}`, newTargetId, direction, oldLogic.rule);
    }

    OL.save();
    this.drawConnections();
    this.openInspector(resId, stepIdx); 
};

OL.createMirrorLink = function(myFullId, partnerFullId, myDirection, myRule) {
    if (myFullId === partnerFullId) return; 

    const data = OL.getCurrentProjectData();
    const resources = data.resources || [];

    const [pResId, pStepIdx] = partnerFullId.split('-');
    const partnerRes = resources.find(r => String(r.id) === String(pResId));
    const partnerStep = partnerRes?.steps?.[parseInt(pStepIdx)];
    
    if (!partnerStep) return;
    if (!partnerStep.logic) partnerStep.logic = { in: [], out: [] };

    const pDir = myDirection === 'out' ? 'in' : 'out';
    const key = pDir === 'in' ? 'sourceId' : 'targetId';

    // Add mirror link if it doesn't exist
    if (!partnerStep.logic[pDir].some(l => l[key] === myFullId)) {
        partnerStep.logic[pDir].push({ [key]: myFullId, rule: myRule, type: 'link' });
    }
};

OL.clearMirrorLink = function(myFullId, partnerFullId) {
    if (myFullId === partnerFullId) return; 

    const data = OL.getCurrentProjectData();
    const resources = data.resources || [];

    const [pResId, pStepIdx] = partnerFullId.split('-');
    const pRes = resources.find(r => String(r.id) === String(pResId));
    const pStep = pRes?.steps?.[parseInt(pStepIdx)];

    if (pStep && pStep.logic) {
        pStep.logic.in = pStep.logic.in.filter(l => l.sourceId !== myFullId);
        pStep.logic.out = pStep.logic.out.filter(l => l.targetId !== myFullId);
    }
};

OL.closeInspector = function() {
    document.getElementById('v2-inspector-panel').classList.remove('open');
};

// Helper to find the X/Y of a card's edge
OL.getCardConnectionPoint = function(resId, stepId, side) {
    const nodeEl = document.getElementById(`v2-node-${resId}`);
    const svgEl = document.getElementById('v2-connections');
    if (!nodeEl || !svgEl) return { x: 0, y: 0 };

    const stepFullId = String(stepId).includes(resId) ? stepId : `${resId}-${stepId}`;
    
    // 1. Identify specific port
    const isIntake = (side === 'left' || side === 'top');
    const portId = isIntake ? `port-in-${stepFullId}` : `port-out-${stepFullId}`;
    
    // 🔍 Try Icon -> then Step Row -> then Card Node
    let targetEl = document.getElementById(portId) || 
                   document.querySelector(`[data-step-id="${stepFullId}"]`) || 
                   nodeEl;

    const isIcon = targetEl.classList.contains('step-logic-icon');
    const isStaticShelf = !!targetEl.closest('#global-shelf');
    
    // 2. Get Geometry
    const rect = targetEl.getBoundingClientRect();
    const svgRect = svgEl.getBoundingClientRect();
    const zoom = isStaticShelf ? 1 : (OL.state.v2.zoom || 1);

    // 📐 THE PRECISION MATH
    // Calculate Y: Always the vertical center of the element
    const y = (rect.top - svgRect.top + (rect.height / 2)) / zoom;
    
    // Calculate X: 
    let x;
    if (isIcon) {
        // If it's the λ icon, we DO want the center of that tiny circle
        x = (rect.left - svgRect.left + (rect.width / 2)) / zoom;
    } else {
        // 🎯 THE FIX: If we fell back to the Row or Card, use the EXTERIOR EDGES
        if (side === 'left' || side === 'top') {
            x = (rect.left - svgRect.left) / zoom; // Flush Left
        } else {
            x = (rect.right - svgRect.left) / zoom; // Flush Right
        }
    }

    return { x, y };
};

OL.drawConnections = function() {
    const svg = document.getElementById('v2-connections');
    const lineGroup = document.getElementById('line-group');
    const shelfLineGroup = document.getElementById('shelf-line-group');
    const shelfEl = document.getElementById('global-shelf');
    if (!svg || !lineGroup) return;

    // 🧹 1. RESET
    lineGroup.innerHTML = ''; 
    if (shelfLineGroup) shelfLineGroup.innerHTML = '';

    // 🕵️ 2. DATA LOAD
    const data = OL.getCurrentProjectData();
    const resources = data?.resources || []; 
    const trace = state.v2?.activeTrace;
    const highlightedIds = (state.v2?.highlightedIds || []).map(id => String(id));
    const zoom = state.v2.zoom || 1;

    if (trace && !trace.resId && !trace.mode) return;

    // 🔄 3. MAIN LOOP
    resources.forEach(sourceRes => {
        if (!sourceRes || !sourceRes.steps) return;
        const sourceResId = String(sourceRes.id); 
        const sourceEl = document.getElementById(`v2-node-${sourceResId}`);
        if (sourceEl && sourceEl.classList.contains('filter-hidden')) return;

        sourceRes.steps.forEach((step) => {
            if (!step.logic?.out) return;

            step.logic.out.forEach(outLogic => {
                if (!outLogic?.targetId) return;

                // 🚀 ROBUST PARSER (Correctly handles multiple hyphens)
                const targetFullId = String(outLogic.targetId);
                const lastHyphen = targetFullId.lastIndexOf('-');
                if (lastHyphen === -1) return; // Malformed ID

                const targetResId = targetFullId.substring(0, lastHyphen);
                const targetStepId = targetFullId.substring(lastHyphen + 1);

                let shouldDraw = false;

                // --- 🚦 TRACE RULES ---
                const hasTrace = !!(trace && trace.mode && trace.resId);

                if (hasTrace) {
                    const mode = trace.mode;
                    const focusId = String(trace.resId);

                    // 📥 INPUTS: Draw if the target is our focused card
                    if (mode === 'in' && targetResId === focusId) {
                        shouldDraw = true;
                    }
                    // 📤 OUTPUTS: Draw if the source is our focused card
                    else if (mode === 'out' && sourceResId === focusId) {
                        shouldDraw = true;
                    }
                    // ↔️ BOTH: Draw if either side matches
                    else if (mode === 'both' && (sourceResId === focusId || targetResId === focusId)) {
                        shouldDraw = true;
                    }
                    // ⏪⏩ RECURSIVE FLOWS: Draw if both IDs are in the pre-calculated highlight list
                    else if ((mode === 'trace-start' || mode === 'trace-end') && 
                            highlightedIds.includes(sourceResId) && 
                            highlightedIds.includes(targetResId)) {
                        shouldDraw = true;
                    }
                } else {
                    // Keep it clean if no trace is active
                    shouldDraw = false;
                }

                if (shouldDraw) {
                    const targetRes = resources.find(r => String(r.id) === targetResId);
                    const targetEl = document.getElementById(`v2-node-${targetResId}`);
                    
                    if (!targetRes || (targetEl && targetEl.classList.contains('filter-hidden'))) return;

                    let start, end, sSide, tSide;

                    // 📐 4. PORT LOGIC
                    const isSourceTrulyGlobal = (!!sourceRes.isGlobal || !!sourceRes.isTopShelf) && !sourceRes.coords;
                    const isTargetTrulyGlobal = (!!targetRes.isGlobal || !!targetRes.isTopShelf) && !targetRes.coords;

                    if (isSourceTrulyGlobal && !isTargetTrulyGlobal) {
                        tSide = 'top';
                        end = OL.getCardConnectionPoint(targetRes.id, targetStepId, tSide);
                        const sRect = sourceEl.getBoundingClientRect();
                        const svgRect = svg.getBoundingClientRect();
                        const visualMidX = sRect.left + (sRect.width / 2);
                        start = { x: (visualMidX - svgRect.left) / zoom, y: 0 };
                    } 
                    else if (!isSourceTrulyGlobal && isTargetTrulyGlobal) {
                        sSide = 'top';
                        start = OL.getCardConnectionPoint(sourceRes.id, step.id, sSide);
                        const tRect = targetEl.getBoundingClientRect();
                        const svgRect = svg.getBoundingClientRect();
                        const visualMidX = tRect.left + (tRect.width / 2);
                        end = { x: (visualMidX - svgRect.left) / zoom, y: 0 };
                    } 
                    else if (targetRes.coords && sourceRes.coords) {
                        const dx = targetRes.coords.x - sourceRes.coords.x;
                        const isVertical = Math.abs(dx) < 150; 
                        sSide = isVertical ? 'right' : (dx > 0 ? 'right' : 'left');
                        tSide = isVertical ? 'right' : (dx > 0 ? 'left' : 'right');

                        start = OL.getCardConnectionPoint(sourceRes.id, step.id, sSide);
                        end = OL.getCardConnectionPoint(targetResId, targetStepId, tSide);
                    }

                    // 🎢 5. DRAW PATH
                    if (start && end) {
                        let targetX = end.x, targetY = end.y;
                        const gap = 15; 
                        if (tSide === 'left') targetX -= gap;
                        if (tSide === 'right') targetX += gap;
                        if (tSide === 'top') targetY -= gap;
                        if (tSide === 'bottom') targetY += gap;

                        let d;
                        const absDx = Math.abs(targetX - start.x);
                        const absDy = Math.abs(targetY - start.y);

                        if (isSourceTrulyGlobal || isTargetTrulyGlobal) {
                            // Shelf curves: Horizontal start, vertical drop
                            const midY = (start.y + targetY) / 2;
                            d = `M ${start.x} ${start.y} C ${start.x} ${midY}, ${targetX} ${midY}, ${targetX} ${targetY}`;
                        } 
                        else if (sSide === tSide) {
                            // Same-side "C" curve (e.g. Loop)
                            const sweep = Math.min(100, absDy * 0.4 + 40); 
                            const direction = (sSide === 'right') ? 1 : -1;
                            d = `M ${start.x} ${start.y} C ${start.x + (sweep * direction)} ${start.y}, ${targetX + (sweep * direction)} ${targetY}, ${targetX} ${targetY}`;
                        } 
                        else {
                            // 🌊 Standard S-Curve (The one in your screenshot)
                            // 🎯 THE FIX: Force CP1.y to match start.y and CP2.y to match targetY
                            // This makes the line "plug in" horizontally to the icon.
                            const tension = Math.max(50, Math.min(absDx * 0.7, 180));
                            
                            const cp1x = start.x + (sSide === 'right' ? tension : -tension);
                            const cp2x = targetX + (tSide === 'right' ? tension : -tension);
                            
                            // We use start.y for CP1 and targetY for CP2 to prevent the "diagonal dive"
                            d = `M ${start.x} ${start.y} 
                                C ${cp1x} ${start.y}, 
                                  ${cp2x} ${targetY}, 
                                  ${targetX} ${targetY}`;
                        }
                        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                        path.setAttribute('d', d);
                        path.setAttribute('fill', 'none');
                        path.setAttribute('marker-end', 'url(#arrowhead)');
                        
                        const isGlobalLink = isSourceTrulyGlobal || isTargetTrulyGlobal;
                        path.setAttribute('stroke', isGlobalLink ? 'var(--text-dim)' : (outLogic.type === 'loop' ? 'var(--warning)' : 'var(--accent)'));
                        if (isGlobalLink) path.setAttribute('stroke-dasharray', '5,5');
                        
                        lineGroup.appendChild(path);

                        if (outLogic.rule?.trim()) {
                            try {
                                // 📏 Calculate the actual midpoint of the curved path
                                const pathLength = path.getTotalLength();
                                const midPoint = path.getPointAtLength(pathLength / 2);
                                
                                OL.drawLogicIcon(lineGroup, midPoint.x, midPoint.y, outLogic.rule, outLogic.type === 'loop', outLogic.loopLimit || '');
                            } catch (e) {
                                // Fallback for non-rendered paths
                                OL.drawLogicIcon(lineGroup, (start.x + targetX)/2, (start.y + targetY)/2, outLogic.rule, outLogic.type === 'loop', outLogic.loopLimit || '');
                            }
                        }
                    }
                }
            });
        });
    });
};

// 🚀 THE FIX: Attach to document so it works even if the element is rendered later
document.addEventListener('scroll', (e) => {
    if (e.target && e.target.id === 'v2-canvas-scroll-wrap') {
        // Use requestAnimationFrame to keep the lines buttery smooth during scroll
        requestAnimationFrame(() => {
            if (typeof OL.drawConnections === 'function') {
                OL.drawConnections();
            }
        });
    }
}, true); // 'true' enables Capture mode, which is required for scroll events to bubble up

OL.drawLogicIcon = function(group, x, y, rule, isLoop = false, limit = '') {
    if (type === 'next' && !rule) return; // Don't draw bubbles for plain arrows

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', `logic-gate-container ${isLoop ? 'is-loop-gate' : ''}`);
    g.setAttribute('pointer-events', 'all'); // 🎯 Force hover detection
    g.style.cursor = 'pointer';
    
    // 1. The Rule Label (Hover Reveal)
    const labelGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    labelGroup.setAttribute('class', 'logic-rule-label');
    
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    
    text.setAttribute('x', x);
    text.setAttribute('y', y - 22);
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('fill', 'var(--text-main)');
    text.setAttribute('font-size', '10px');
    text.textContent = rule;

    const textWidth = rule.length * 6 + 20;
    rect.setAttribute('x', x - textWidth / 2); 
    rect.setAttribute('y', y - 35);
    rect.setAttribute('width', textWidth);
    rect.setAttribute('height', '20');
    rect.setAttribute('rx', '4');
    rect.setAttribute('fill', 'var(--bg-card)');
    rect.setAttribute('stroke', isLoop ? 'var(--warning)' : 'var(--accent)');
    
    labelGroup.appendChild(rect);
    labelGroup.appendChild(text);

    // 2. The Main Icon Circle
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', x);
    circle.setAttribute('cy', y);
    circle.setAttribute('r', '8');
    circle.setAttribute('fill', 'var(--bg-panel)');
    circle.setAttribute('stroke', isLoop ? 'var(--warning)' : 'var(--accent)');

    const iconText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    iconText.setAttribute('x', x);
    iconText.setAttribute('y', y + 4); 
    iconText.setAttribute('text-anchor', 'middle');
    iconText.setAttribute('fill', isLoop ? 'var(--warning)' : 'var(--accent)');
    iconText.setAttribute('font-size', isLoop ? '12px' : '9px');
    iconText.style.pointerEvents = 'none';
    iconText.textContent = isLoop ? '↺' : 'λ';

    // 🚀 3. THE LOOP LIMIT BADGE (Visible by default)
    if (isLoop && limit) {
        const badgeG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        const bRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        const bText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        
        const bWidth = limit.length * 5 + 8;
        bRect.setAttribute('x', x + 10);
        bRect.setAttribute('y', y - 6);
        bRect.setAttribute('width', bWidth);
        bRect.setAttribute('height', '12');
        bRect.setAttribute('rx', '6');
        bRect.setAttribute('fill', 'var(--warning)');
        
        bText.setAttribute('x', x + 10 + bWidth / 2);
        bText.setAttribute('y', y + 3);
        bText.setAttribute('text-anchor', 'middle');
        bText.setAttribute('fill', '#000');
        bText.setAttribute('font-size', '8px');
        bText.setAttribute('font-weight', 'bold');
        bText.textContent = limit;
        
        badgeG.appendChild(bRect);
        badgeG.appendChild(bText);
        g.appendChild(badgeG);
    }

    g.appendChild(labelGroup);
    g.appendChild(circle);
    g.appendChild(iconText);
    group.appendChild(g);
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

OL.refreshFamilyNaming = function(targetRes, resources) {
    if (!targetRes || !resources) return;

    // 1. Get the 'Base Name' by stripping any existing (1/2) suffixes
    const baseName = targetRes.name.replace(/\s\(\d+\/\d+\)$/, "").trim();
    
    // 2. Find all current parts on the canvas that share this base name within the provided resource array
    const family = resources.filter(r => {
        const rBase = r.name.replace(/\s\(\d+\/\d+\)$/, "").trim();
        return rBase === baseName;
    }).sort((a, b) => (a.coords?.y || 0) - (b.coords?.y || 0));

    // 3. Re-assign the counters based on the new current total
    if (family.length <= 1) {
        family[0].name = baseName;
    } else {
        family.forEach((member, i) => {
            member.name = `${baseName} (${i + 1}/${family.length})`;
        });
    }
};

window.OL.duplicateResourceV2 = async function(resourceId) {
    // 🛡️ Secondary shield against bubbling
    if (window.event) {
        window.event.stopPropagation();
        window.event.preventDefault();
    }

    const isVault = window.location.hash.includes('vault');
    const client = getActiveClient();
    
    // 1. Resolve Data Source
    let source = isVault ? state.master.resources : client?.projectData?.localResources;
    if (!source) return console.error("❌ Source array not found");

    // 2. Find Original
    const original = source.find(r => String(r.id) === String(resourceId));
    if (!original) return console.error("❌ Original not found");

    // 3. Clone and Save
    await OL.updateAndSync(() => {
        const clone = JSON.parse(JSON.stringify(original));
        const timestamp = Date.now();
        
        clone.id = (isVault ? 'res-vlt-' : 'local-prj-') + timestamp;
        clone.name = original.name.replace(/\s\(\d+\/\d+\)$/, "").replace(" (Copy)", "") + " (Copy)";
        
        // Offset so it's not hidden behind the original
        if (clone.coords) {
            clone.coords.x += 50;
            clone.coords.y += 50;
        }

        // Wipe instance-specific flags
        delete clone.masterRefId; 
        
        source.push(clone);
        console.log("✅ Duplicated to:", clone.id);
    });

    // 4. Force UI to Draw
    OL.renderVisualizer();
};

OL.toggleWorkbenchTray = function() {
    const viewport = document.getElementById('v2-viewport');
    if (!viewport) return;

    // 1. Force a boolean check. If it's undefined, assume it's currently OPEN (true)
    if (state.ui.sidebarOpen === undefined) {
        state.ui.sidebarOpen = true;
    }

    // 2. Flip the state
    state.ui.sidebarOpen = !state.ui.sidebarOpen;

    // 3. Update the DOM immediately
    if (state.ui.sidebarOpen) {
        viewport.classList.remove('tray-closed');
    } else {
        viewport.classList.add('tray-closed');
    }

    // 4. Update the Button Icon if you have one
    const btn = document.querySelector('.v2-tray-toggle-btn');
    if (btn) btn.innerHTML = state.ui.sidebarOpen ? '🔳' : '⬜';
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
    // 🚩 CLAIM THE ENGINE: Tell Sync that Scoping is the ONLY active view
    if (typeof OL.registerView === 'function') {
        OL.registerView(() => renderScopingSheet());
    }

    OL.registerView(renderScopingSheet); // Set the legacy reference too

    const urlParams = new URLSearchParams(window.location.hash.split('?')[1]);
    const focusId = urlParams.get('focus');
    
    if (focusId) {
        state.scopingFilterActive = true;
        state.scopingTargetId = focusId;
    }

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
        // 🎯 Now this will work because focusId is pulled from the URL
        if (state.scopingFilterActive && state.scopingTargetId) {
            return String(item.resourceId) === String(state.scopingTargetId);
        }

        const res = OL.getResourceById(item.resourceId);
        if (!res) return false;

        const matchesSearch = res.name.toLowerCase().includes(q) || (res.description || "").toLowerCase().includes(q);
        const matchesType = typeF === "All" || res.type === typeF;
        const matchesStatus = statusF === "All" || item.status === statusF;
        const matchesParty = partyF === "All" || item.responsibleParty === partyF;

        return matchesSearch && matchesType;
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

    ${state.scopingFilterActive ? `
        <div style="display: flex; gap: 10px; margin-bottom: 20px;">
            <button class="btn primary" onclick="state.scopingFilterActive = false; state.scopingTargetId = null; location.hash='#/scoping-sheet';">
                ⬅ Show Full Scoping Sheet
            </button>
            <button class="btn soft" onclick="state.scopingFilterActive = false; state.scopingTargetId = null; location.hash='#/visualizer';">
                🌐 Back to Flow Map
            </button>
        </div>
    ` : ''}

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

    ${state.scopingFilterActive ? `
        <div class="filter-banner" 
             style="background: rgba(16, 185, 129, 0.1); border: 1px solid #10b981; padding: 12px 20px; border-radius: 8px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center;">
            <div>
                <span class="tiny accent bold uppercase" style="display:block; font-size:9px;">Surgical View Active</span>
                <span style="color: white; font-weight: bold;">📍 Showing scoped details for linked resource</span>
            </div>
            <button class="btn tiny primary" 
                    onclick="state.scopingFilterActive = false; state.scopingTargetId = null; renderScopingSheet()">
                Show Full Sheet
            </button>
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
    
    // 🚩 1. INITIALIZE ALL VARIABLES (Prevents ReferenceErrors)
    let roundGrossValue = 0;   // Sticker Price total
    let billableSubtotal = 0;  // Pre-discount billable total
    let roundDeductionAmt = 0; // The discount amount for this round
    let finalRoundNet = 0;     // The final number in the right column
    let totalRoundSavings = 0; // The "Disc" column total

    // 🔄 2. CALCULATION LOOP
    items.forEach(item => {
        const res = OL.getResourceById(item.resourceId);
        if (!res) return;

        // Calculate Gross (Always)
        const itemStickerPrice = OL.calculateBaseFeeWithMultiplier(item, res) || 0;
        roundGrossValue += itemStickerPrice;

        // Calculate Net (Only if Do Now + Billable Party)
        const status = String(item.status || "").toLowerCase().trim();
        const party = String(item.responsibleParty || "").toLowerCase().trim();
        
        if (status === 'do now' && (party === 'sphynx' || party === 'joint')) {
            billableSubtotal += (OL.calculateRowFee(item, res) || 0);
        }
    });

    // 💸 3. ROUND DISCOUNT CALCULATION
    const rKey = String(roundNum);
    if (sheet.roundDiscounts && sheet.roundDiscounts[rKey]) {
        const rDisc = sheet.roundDiscounts[rKey];
        const discVal = parseFloat(rDisc.value) || 0;
        
        roundDeductionAmt = (rDisc.type === '%') 
            ? Math.round(billableSubtotal * (discVal / 100)) 
            : discVal;
    }

    // 🏁 4. FINAL ROUND TOTALS
    finalRoundNet = billableSubtotal - roundDeductionAmt;
    totalRoundSavings = roundGrossValue - finalRoundNet;

    // 🎨 5. RENDER ROWS
    const rows = items.map((item, idx) => renderScopingRow(item, idx, showUnits)).join("");

    // 🖼️ 6. RETURN HTML
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
                
                <div class="col-numeric bold" style="font-size: 12px; text-align:right; line-height: 1.1;">
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
    
    const typeIcon = OL.getRegistryIcon(res.type);

    // 2. Financial Calculations
    const status = (item.status || "").toLowerCase();
    const party = (item.responsibleParty || "").toLowerCase();

    const isBillable = party === 'sphynx' || party === 'joint';
    const isCounted = status === 'do now' && isBillable;

    const gross = OL.calculateBaseFeeWithMultiplier(item, res);

    // 🎯 THE FIX: If it's NOT counted (e.g., "Do Later"), 
    // we set Net to Gross so the discount stays $0, 
    // rather than setting Net to $0 which creates a massive discount.
    const net = isCounted ? OL.calculateRowFee(item, res) : gross; 
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

    const isTarget = state.scopingFilterActive && String(item.resourceId) === String(state.scopingTargetId);

    return `
        <div class="grid-row ${isTarget ? 'surgical-focus-row' : ''}" style="border-bottom: 1px solid var(--line); padding: 8px 10px;">
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
            <div class="bold" style="font-size: 13px;">$${net.toLocaleString()}</div>
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

    // 3. Filter for search term OR surgical match
    const matches = combined.filter((res) => {
        // 🚀 SURGICAL OVERRIDE: If we are coming from a badge click
        if (state.scopingFilterActive && state.scopingTargetId) {
            return String(res.id) === String(state.scopingTargetId);
        }

        // Standard behavior for normal searching
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
        manualHours: 0,
        dependencies: [],
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
        const itemGross = OL.calculateBaseFeeWithMultiplier(item, res);
        totalGross += itemGross

        // 2. Calculate Net (Only "Do Now" and billable parties)
        const status = (item.status || "").toLowerCase();
        const party = (item.responsibleParty || "").toLowerCase();
        
        const isDoNow = status === 'do now';
        const isBillable = party === 'sphynx' || party === 'joint';

        // 2. Calculate Net (Only items we are actually charging for)
        if (isDoNow && isBillable) {
            netAfterLineItems += OL.calculateRowFee(item, res);
        }
    });

    // 3. Subtract Adjustments/Discounts from the Net
   let netAfterRounds = netAfterLineItems;
    if (sheet.roundDiscounts) {
        Object.keys(sheet.roundDiscounts).forEach(rNum => {
            const rDisc = sheet.roundDiscounts[rNum];
            // Filter only "Do Now" items in this round to calculate the discount basis
            const roundItems = lineItems.filter(i => 
                String(i.round) === String(rNum) && 
                (i.status || "").toLowerCase() === 'do now'
            );
            
            const roundSubtotal = roundItems.reduce((s, i) => {
                const r = OL.getResourceById(i.resourceId);
                return s + (r ? OL.calculateRowFee(i, r) : 0);
            }, 0);
            
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
        <button class="btn tiny soft" onclick="OL.universalPrint()">🖨️ PDF</button>
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
        <div style="font-size: 22px; font-weight: 900; line-height: 1;">$${finalApproved.toLocaleString()}</div>
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

function renderDependencyRow(dep, parentId) {
    const client = getActiveClient();
    const isTask = dep.type === 'task';
    
    // 🎯 Resolve the object
    let obj = isTask 
        ? (client?.projectData?.clientTasks || []).find(t => t.id === dep.id)
        : OL.getResourceById(dep.id);

    const icon = isTask ? '📋' : OL.getRegistryIcon(obj?.type);
    
    // 🎯 Navigation Logic
    const clickAction = isTask 
        ? `OL.openTaskModal('${dep.id}', false)` 
        : `OL.openResourceModal('${dep.id}')`;

    return `
        <div class="dp-manager-row" style="display:flex; justify-content:space-between; align-items:center; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.03);">
            <div style="display:flex; align-items:center; gap:8px; cursor:pointer; flex:1;" onclick="${clickAction}">
                <span style="font-size:12px;">${icon}</span>
                <div style="display:flex; flex-direction:column;">
                    <span style="font-size:11px; font-weight:bold; color: ${isTask ? 'var(--text-main)' : 'var(--accent)'}">${esc(obj?.name || "Deleted Item")}</span>
                    <span style="font-size:8px; opacity:0.5; text-transform:uppercase;">${isTask ? (obj?.status || 'Pending') : (obj?.type || 'Resource')}</span>
                </div>
            </div>
            <button class="card-delete-btn" style="position:static; opacity:0.4;" onclick="OL.removeDependencyById('${parentId}', '${dep.id}')">×</button>
        </div>
    `;
}

OL.getDependencyStatus = function(item, allItems) {
    if (!item.dependencies || item.dependencies.length === 0) return 'ready';
    
    const blockedBy = [];
    item.dependencies.forEach(depId => {
        const depItem = allItems.find(i => i.id === depId);
        if (depItem && depItem.status !== 'Done') {
            const res = OL.getResourceById(depItem.resourceId);
            blockedBy.push(res?.name || "Required Task");
        }
    });

    return blockedBy.length > 0 ? { status: 'blocked', list: blockedBy } : { status: 'ready' };
};

OL.openDependencyManager = function(lineItemId) {
    const client = getActiveClient();
    const sheet = client.projectData.scopingSheets[0];
    const targetItem = sheet.lineItems.find(i => i.id === lineItemId);
    const targetRes = OL.getResourceById(targetItem.resourceId);

    const html = `
        <div class="modal-head">
            <div class="modal-title-text">🔗 Manage Dependencies for: ${esc(targetRes?.name)}</div>
            <button class="btn small soft" onclick="OL.closeModal()">Close</button>
        </div>
        <div class="modal-body">
            <label class="modal-section-label">Active Dependencies</label>
            <div class="dp-manager-list" style="margin-bottom: 20px;">
                ${(targetItem.dependencies || []).map(depId => {
                    const depItem = sheet.lineItems.find(i => i.id === depId);
                    const depRes = OL.getResourceById(depItem?.resourceId);
                    return `
                        <div class="dp-manager-row" style="display:flex; justify-content:space-between; align-items:center;">
                            <span>🎯 ${esc(depRes?.name || "Unknown Item")}</span>
                            <button class="btn-icon-tiny" onclick="OL.toggleDependency('${lineItemId}', '${depId}')">×</button>
                        </div>
                    `;
                }).join('') || '<div class="tiny muted">No dependencies set.</div>'}
            </div>

            <label class="modal-section-label">Add Dependency (Search project items)</label>
            <div class="search-map-container">
                <input type="text" class="modal-input" placeholder="Search other scoped items..."
                       oninput="OL.filterDependencySearch('${lineItemId}', this.value)">
                <div id="dep-search-results" class="search-results-overlay"></div>
            </div>
        </div>
    `;
    openModal(html);
};

OL.filterDependencySearch = function(currentResId, mode, query) {
    const targetElId = mode === 'task' ? "task-dep-results" : "res-dep-results";
    const listEl = document.getElementById(targetElId);
    if (!listEl) return;

    const q = (query || "").toLowerCase().trim();
    const client = getActiveClient();
    const currentRes = OL.getResourceById(currentResId);
    const existingIds = (currentRes.dependencies || []).map(d => d.id);

    let matches = [];
    let html = "";

    if (mode === 'task') {
        // --- TASK MODE ---
        matches = (client?.projectData?.clientTasks || []).filter(t => 
            !existingIds.includes(t.id) && t.name.toLowerCase().includes(q)
        );
        html = matches.map(t => `
            <div class="search-result-item" onmousedown="OL.addDependency('${currentResId}', '${t.id}', 'task')">
                <span>📋 ${esc(t.name)}</span>
            </div>
        `).join('');

        // Quick Create Task only
        if (q.length > 0 && !matches.some(m => m.name.toLowerCase() === q)) {
            html += `<div class="search-result-item create-action" onmousedown="OL.createAndLinkTaskDependency('${currentResId}', '${esc(query)}')">
                <span class="pill tiny accent">+ CREATE TASK</span> "${esc(query)}"
            </div>`;
        }
    } else {
        // --- RESOURCE MODE ---
        const data = OL.getCurrentProjectData();
        matches = (data.resources || []).filter(r => 
            String(r.id) !== String(currentResId) && !existingIds.includes(r.id) && r.name.toLowerCase().includes(q)
        );
        html = matches.map(r => `
            <div class="search-result-item" onmousedown="OL.addDependency('${currentResId}', '${r.id}', 'resource')">
                <span>${OL.getRegistryIcon(r.type)} ${esc(r.name)}</span>
            </div>
        `).join('');
    }

    listEl.innerHTML = html || '<div class="search-result-item muted">No matches found.</div>';
    listEl.style.display = 'block';
};

OL.createAndLinkTaskDependency = async function(resId, taskName) {
    const client = getActiveClient();
    if (!client) return;

    const taskId = 'tk-' + Date.now(); // Use your task prefix
    const newTask = {
        id: taskId,
        name: taskName,
        status: "Pending", // 🎯 Critical for showing up in "Active" lists
        description: "",
        appIds: [],
        howToIds: [],
        assigneeIds: [],
        createdDate: new Date().toISOString()
    };

    await OL.updateAndSync(() => {
        // 🎯 SAVE TO THE CORRECT ARRAY
        if (!client.projectData.clientTasks) client.projectData.clientTasks = [];
        client.projectData.clientTasks.push(newTask);

        // Link to the current resource
        const res = OL.getResourceById(resId);
        if (res) {
            if (!res.dependencies) res.dependencies = [];
            res.dependencies.push({
                id: taskId,
                type: 'task',
                addedDate: new Date().toISOString()
            });
        }
    });

    // 🚀 AUTO-OPEN: Open the task immediately for editing
    OL.openTaskModal(taskId, false); 
    
    // Refresh background if needed
    if (typeof renderChecklistModule === 'function') renderChecklistModule();
};

OL.addDependency = async function(resId, depId, type) {
    const res = OL.getResourceById(resId);
    if (!res) return;

    if (!res.dependencies) res.dependencies = [];
    
    // Check for circular dependency (simple 1-level check)
    const depTarget = OL.getResourceById(depId);
    if (depTarget?.dependencies?.some(d => d.id === resId)) {
        alert("🚫 Circular Dependency detected! This item already depends on the current one.");
        return;
    }

    res.dependencies.push({
        id: depId,
        type: type, // 'resource' or 'step'
        addedDate: new Date().toISOString()
    });

    await OL.persist();
    OL.openResourceModal(resId); // Refresh modal
};

OL.removeDependencyById = async function(resId, depId) {
    const res = OL.getResourceById(resId);
    if (res && res.dependencies) {
        res.dependencies = res.dependencies.filter(d => d.id !== depId);
        await OL.persist();
        OL.openResourceModal(resId);
    }
};

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
    
    // 🚀 THE FIX: Determine the correct data source (Project vs Master)
    const dataContext = client?.projectData || state.master;
    
    // Ensure accessRegistry exists on whichever context we are using
    if (!dataContext.accessRegistry) dataContext.accessRegistry = [];
    const registry = dataContext.accessRegistry;

    const connections = type === "member"
        ? registry.filter((a) => a.memberId === ownerId)
        : registry.filter((a) => a.appId === ownerId);

    const allApps = [
        ...(state.master.apps || []),
        ...(client?.projectData?.localApps || []),
    ];
    
    const allMembers = client?.projectData?.teamMembers || state.master.teamMembers || [];

    return `
        <div class="card-section" style="margin-top:20px; border-top: 1px solid var(--line); padding-top:15px;">
            <label class="modal-section-label">System Access & Credentials</label>
            <div class="dp-manager-list" style="margin-bottom:10px;">
                ${connections.length === 0 ? '<div class="muted tiny" style="padding:10px;">No linked credentials found.</div>' : ''}
                ${connections.map((conn) => {
                    const linkedObj = type === "member"
                        ? allApps.find((a) => a.id === conn.appId)
                        : allMembers.find((m) => m.id === conn.memberId);

                    const jumpTarget = type === "member"
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
                }).join("")}
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

// 🛑 GLOBAL REFRESH SHIELD
// This stops the browser from navigating if a drop fails or is mishandled
['dragover', 'drop'].forEach(eventName => {
    window.addEventListener(eventName, e => {
        e.preventDefault();
        e.stopPropagation();
    }, false);
});


/*======================= DATAPOINTS =============================*/
state.ui.activeWorkbenchTab = 'flows'; // Default tab

OL.renderGlobalDataManager = function() {
    OL.registerView(OL.renderGlobalDataManager);
    const container = document.getElementById("mainContent");
    if (!container) return;

    const isVaultMode = window.location.hash.includes('vault');
    const client = getActiveClient();

    // Determine source based on context
    const sourcePool = (isVaultMode || !client) 
        ? (state.master.datapoints || []) 
        : (client.projectData.localDatapoints || []);

    const datapoints = sourcePool.filter(d => !d.isBundle);
    const bundles = sourcePool.filter(d => d.isBundle);

    container.innerHTML = `
        <div class="section-header" style="margin-bottom: 30px; padding-bottom: 20px;">
            <div>
                <h2 style="font-size: 24px; letter-spacing: -0.5px;">🏷️ Data Architecture Manager</h2>
                <div class="small muted" style="margin-top: 8px;">Standardize fields and drag them into bundles to organize technical requirements.</div>
            </div>
            <div class="header-actions">
                ${!isVaultMode ? `<button class="btn primary" style="background:#38bdf8; color:black; margin-right:8px;" onclick="OL.openMasterDataImporter()">⬇️ Import Master</button>` : ''}
                <button class="btn small soft" onclick="OL.addNewDatapoint(true)">+ New Bundle</button>
                <button class="btn primary" onclick="OL.addNewDatapoint(false)">+ New Field</button>
            </div>
        </div>

        <div class="data-manager-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 40px;">
            
            <div class="data-column">
                <div class="column-label" style="padding: 0 0 15px 5px; border-bottom: 1px solid var(--line); margin-bottom: 15px;">
                    <b class="tiny muted uppercase" style="letter-spacing: 1px;">Individual Master Fields</b>
                </div>
                <div id="master-fields-list">
                    ${datapoints.map(dp => {
                        const parentBundles = bundles.filter(b => (b.childIds || []).includes(dp.id));
                        
                        const protectedFields = [
                            '{householdName}', '{folderName}', '{firstName}', '{lastName}', 
                            '{email}', '{phone}', '{phoneType}', '{homeAddress}', '{mailingAddress}'
                        ];
                        const isProtected = protectedFields.includes(dp.key);

                        return `
                            <div class="data-field-card draggable-field" 
                                draggable="true"
                                onclick="OL.openDataDetailModal('${dp.id}')"
                                ondragstart="OL.handleFieldDragStart(event, '${dp.id}')"
                                style="display: flex; align-items: center; justify-content: space-between; 
                                        padding: 10px 15px; margin-bottom: 8px; 
                                        background: rgba(255,255,255,0.03); border: 1px solid var(--line); 
                                        border-radius: 6px; cursor: pointer; transition: 0.2s;">
                                
                                <div style="display:flex; align-items:center; gap:12px; flex: 1;">
                                    <span style="opacity:0.3; font-size:10px; cursor: grab;" onmousedown="event.stopPropagation()">⠿</span>
                                    <div style="min-width: 0;">
                                        <div class="bold" style="font-size: 12px; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                                            ${dp.linkToResource ? '🔗' : '🏷️'} ${esc(dp.name)}
                                        </div>
                                        <div class="tiny muted" style="font-family: monospace; opacity:0.5; font-size: 9px;">${dp.key}</div>
                                    </div>
                                </div>

                                <div style="display:flex; align-items:center; gap:10px;">
                                    <div class="pills-row" style="gap:3px;">
                                        ${parentBundles.map(b => `<span class="pill tiny soft" style="font-size:7px; padding: 1px 4px;">📦</span>`).join('')}
                                    </div>
                                    
                                    ${!isProtected ? `
                                        <button class="card-delete-btn" 
                                                style="position:static; font-size: 16px; opacity: 0.4;" 
                                                onclick="event.stopPropagation(); OL.deleteMasterDatapointById('${dp.id}')">×</button>
                                    ` : `
                                        <span title="System Protected Field" style="font-size: 10px; opacity: 0.2; width: 22px; text-align: center;">🔒</span>
                                    `}
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>

            <div class="data-column">
                <div class="column-label" style="padding: 0 0 15px 5px; border-bottom: 1px solid var(--line); margin-bottom: 15px;">
                    <b class="tiny muted uppercase" style="letter-spacing: 1px;">System Bundles</b>
                </div>
                <div id="bundles-list">
                    ${bundles.map(bn => `
                        <div class="bundle-drop-zone" 
                             id="bundle-zone-${bn.id}"
                             ondragover="OL.handleBundleDragOver(event)"
                             ondragleave="OL.handleBundleDragLeave(event)"
                             ondrop="OL.handleFieldDropOnBundle(event, '${bn.id}')"
                             style="margin-bottom: 15px; padding: 20px; border: 1px solid var(--line); border-radius: 8px; background: rgba(255,255,255,0.02); transition: 0.2s;">
                            <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:12px;">
                                <div>
                                    <div class="bold" style="color: var(--accent); font-size: 14px;">📦 ${esc(bn.name)}</div>
                                    <div class="tiny muted">${(bn.childIds || []).length} Fields Linked</div>
                                </div>
                                <button class="btn-icon-tiny" onclick="OL.deleteMasterDatapointById('${bn.id}')">×</button>
                            </div>
                            <div class="pills-row" style="gap:5px;">
                                ${(bn.childIds || []).map(cid => {
                                    const child = datapoints.find(d => d.id === cid);
                                    return child ? `<span class="pill tiny soft" style="font-size:9px;">${esc(child.name)} <b class="is-clickable" onclick="OL.removeFieldFromBundle('${bn.id}', '${child.id}')" style="margin-left:5px; opacity:0.5;">×</b></span>` : '';
                                }).join('')}
                                ${bn.childIds?.length === 0 ? '<div class="tiny muted italic">Drag fields here to group...</div>' : ''}
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>
    `;
};

OL.openMasterDataImporter = function() {
    const html = `
        <div class="modal-head">
            <div class="modal-title-text">🏛️ Import Master Data Tags</div>
            <div class="spacer"></div>
            <button class="btn small soft" onclick="OL.closeModal()">Cancel</button>
        </div>
        <div class="modal-body">
            <div class="search-map-container">
                <input type="text" class="modal-input" 
                       placeholder="Search master fields or bundles..." 
                       onfocus="OL.filterMasterDataImport('')"
                       oninput="OL.filterMasterDataImport(this.value)" 
                       autofocus>
                <div id="master-data-import-results" class="search-results-overlay" style="margin-top:10px;"></div>
            </div>
        </div>
    `;
    openModal(html);
};

OL.filterMasterDataImport = function(query) {
    const listEl = document.getElementById("master-data-import-results");
    if (!listEl) return;

    const q = (query || "").toLowerCase().trim();
    const client = getActiveClient();
    
    // Get IDs already in the local project to prevent duplicates
    const localIds = (client?.projectData?.localDatapoints || []).map(d => d.masterRefId || d.id);
    
    // Filter Master Library
    const available = (state.master.datapoints || []).filter(dp => 
        (dp.name.toLowerCase().includes(q) || (dp.key && dp.key.toLowerCase().includes(q))) &&
        !localIds.includes(dp.id)
    ).sort((a, b) => (a.isBundle === b.isBundle) ? a.name.localeCompare(b.name) : a.isBundle ? -1 : 1);

    listEl.innerHTML = available.map(dp => `
        <div class="search-result-item" onmousedown="OL.executeDataImport('${dp.id}')">
            <div style="display:flex; justify-content:space-between; width:100%; align-items:center;">
                <div style="display:flex; align-items:center; gap:10px;">
                    <span>${dp.isBundle ? '📦' : '🏷️'}</span>
                    <div>
                        <div class="bold">${esc(dp.name)}</div>
                        <div class="tiny muted">${dp.isBundle ? (dp.childIds?.length || 0) + ' Fields' : dp.key}</div>
                    </div>
                </div>
                <span class="pill tiny vault">MASTER</span>
            </div>
        </div>
    `).join('') || `<div class="search-result-item muted">No unlinked tags found.</div>`;
};

OL.executeDataImport = async function(masterId) {
    const client = getActiveClient();
    const template = state.master.datapoints.find(d => d.id === masterId);
    if (!client || !template) return;

    await OL.updateAndSync(() => {
        // Deep clone the tag/bundle
        const newTag = JSON.parse(JSON.stringify(template));
        
        // Localize it
        newTag.masterRefId = masterId; // Link back to master
        newTag.id = (newTag.isBundle ? 'local-bundle-' : 'local-dp-') + Date.now();
        
        if (!client.projectData.localDatapoints) client.projectData.localDatapoints = [];
        client.projectData.localDatapoints.push(newTag);
        
        // 🚀 SMART BUNDLE IMPORT:
        // If importing a bundle, we should also import all the individual fields within it
        if (newTag.isBundle && template.childIds) {
            template.childIds.forEach(childMasterId => {
                const childTemplate = state.master.datapoints.find(d => d.id === childMasterId);
                const alreadyLocal = client.projectData.localDatapoints.find(ld => ld.masterRefId === childMasterId);
                
                if (childTemplate && !alreadyLocal) {
                    const localChild = JSON.parse(JSON.stringify(childTemplate));
                    localChild.masterRefId = childMasterId;
                    localChild.id = 'local-dp-' + Date.now() + Math.random();
                    client.projectData.localDatapoints.push(localChild);
                }
            });
        }
    });

    OL.closeModal();
    OL.renderGlobalDataManager();
    console.log(`✅ Imported Master Data: ${template.name}`);
};

// Internal Helper for Field Rows
function renderDataRow(dp, allBundles) {
    const parentBundles = allBundles.filter(b => (b.childIds || []).includes(dp.id));
    return `
        <div class="dp-manager-row" style="padding: 12px; border-bottom: 1px solid var(--line); display: flex; align-items: center; gap: 10px;">
            <div style="flex: 1;" class="is-clickable" onclick="OL.openDataDetailModal('${dp.id}')">
                <div class="bold" style="font-size: 13px;">🏷️ ${esc(dp.name)}</div>
                <div class="tiny muted" style="font-family: monospace;">${dp.key}</div>
            </div>
            <div class="pills-row" style="flex: 1; justify-content: flex-end;">
                ${parentBundles.map(b => `<span class="pill tiny soft" style="font-size:8px;">📦 ${esc(b.name)}</span>`).join('')}
                <button class="btn-icon-tiny" onclick="OL.openDataDetailModal('${dp.id}')">🔍</button>
            </div>
        </div>
    `;
}

// Internal Helper for Bundle Rows
function renderBundleRow(bn, allFields) {
    const childCount = (bn.childIds || []).length;
    return `
        <div class="dp-manager-row" style="padding: 12px; border-bottom: 1px solid var(--line); display: flex; align-items: center; gap: 10px;">
            <div style="flex: 1;" class="is-clickable" onclick="OL.openDataDetailModal('${bn.id}')">
                <div class="bold" style="color: #fbbf24;">📦 ${esc(bn.name)}</div>
                <div class="tiny muted">${childCount} linked fields</div>
            </div>
            <button class="btn tiny soft" onclick="OL.editBundle('${bn.id}')">Map Fields</button>
        </div>
    `;
}

OL.openDataDetailModal = function(id) {
    const client = getActiveClient();
    const sourcePool = [...(state.master.datapoints || []), ...(client?.projectData?.localDatapoints || [])];
    const dp = sourcePool.find(d => String(d.id) === String(id));
    
    if (!dp) return console.error("❌ Data Tag not found:", id);

    // 🕵️ Find Project Backlinks
    const usage = [];
    const projectResources = client?.projectData?.localResources || [];
    projectResources.forEach(res => {
        (res.steps || []).forEach(step => {
            if ((step.datapoints || []).some(d => d.id === id)) {
                usage.push({ resId: res.id, resName: res.name, stepName: step.name });
            }
        });
    });
    const linkedResource = dp.linkToResource ? 
        (client?.projectData?.localResources || []).find(r => r.name === dp.linkToResource) : null;

    let html = `
        <div class="modal-head">
            <div class="modal-title-text">${dp.isBundle ? '📦' : '🏷️'} ${esc(dp.name)}</div>
        </div>
        <div class="modal-body">
            ${linkedResource ? `
                <div class="card-section" style="background: rgba(56, 189, 248, 0.1); border: 1px solid #38bdf8; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
                    <div class="tiny accent bold uppercase" style="margin-bottom: 5px;">Linked Logic Source</div>
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span>📖 ${esc(linkedResource.name)}</span>
                        <button class="btn tiny primary" onclick="OL.openResourceModal('${linkedResource.id}')">View Rules ➔</button>
                    </div>
                </div>
            ` : ''}

            <div class="card-section">
                <label class="modal-section-label">📉 DATA USAGE & FLOW</label>
                ${OL.renderDataFlowMiniMap(id)}
            </div>

            <div class="card-section" style="margin-top:20px;">
                <label class="modal-section-label">📍 PROJECT BACKLINKS</label>
                <div class="dp-manager-list">
                    ${usage.map(u => `
                        <div class="pill soft is-clickable" style="margin-bottom:5px; display:flex; justify-content:space-between;" onclick="OL.openResourceModal('${u.resId}')">
                            <span><b>${esc(u.resName)}</b> › ${esc(u.stepName)}</span>
                            <span class="tiny accent">View Card ➔</span>
                        </div>
                    `).join('') || '<div class="tiny muted italic">Not currently mapped to any project resources.</div>'}
                </div>
            </div>
        </div>
    `;
    openModal(html);
};

// 🕸️ The Data Flow Mini-Map
OL.renderDataFlowMiniMap = function(dataId) {
    const client = getActiveClient();
    const resources = client?.projectData?.localResources || [];
    const nodes = [];

    // Find resources that provide or require this data
    resources.forEach(res => {
        const isUsed = (res.steps || []).some(s => (s.datapoints || []).some(d => d.id === dataId));
        if (isUsed) nodes.push(res);
    });

    return `
        <div class="mini-map-grid" style="display:flex; gap:10px; flex-wrap:wrap; justify-content:center; padding:20px; background:rgba(0,0,0,0.2); border-radius:8px;">
            ${nodes.map((n, i) => `
                <div class="mini-node muted" style="min-width:100px; border-color:var(--accent);">
                    <div class="tiny bold">${esc(n.name)}</div>
                </div>
                ${i < nodes.length - 1 ? '<div class="mini-arrow">→</div>' : ''}
            `).join('') || '<div class="tiny muted">No flow detected.</div>'}
        </div>
    `;
};

OL.addNewDatapoint = function(isBundle = false) {
    const name = prompt(`Enter ${isBundle ? 'Bundle' : 'Field'} Name:`);
    if (!name) return;

    const id = (isBundle ? 'bundle-' : 'dp-') + Date.now();
    const key = `{${name.replace(/\s+/g, '').toLowerCase()}}`;
    
    state.master.datapoints.push({
        id: id,
        name: name,
        key: isBundle ? null : key,
        isBundle: isBundle,
        childIds: isBundle ? [] : null,
        category: 'General'
    });

    OL.persist();
    OL.renderGlobalDataManager();
};

OL.updateMasterDatapoint = function(index, field, value) {
    if (value === 'new') {
        const newCat = prompt("Enter new category name:");
        value = newCat || 'General';
    }
    
    state.master.datapoints[index][field] = value;
    OL.persist();
    OL.renderGlobalDataManager();
    OL.renderWorkbenchItemsOnly();
};

OL.deleteMasterDatapointById = function(id) {
    if (!confirm("Permanently delete this item?")) return;
    state.master.datapoints = state.master.datapoints.filter(d => d.id !== id);
    OL.persist();
    OL.renderGlobalDataManager();
};

OL.editBundle = function(bundleId) {
    const bundle = state.master.datapoints.find(d => d.id === bundleId);
    const allDps = state.master.datapoints.filter(d => !d.isBundle);

    let html = `
        <div class="modal-head">
            <div class="modal-title-text">📦 Edit Bundle: ${esc(bundle.name)}</div>
        </div>
        <div class="modal-body">
            <div class="dp-manager-list">
                ${allDps.map(dp => {
                    const isChecked = (bundle.childIds || []).includes(dp.id);
                    return `
                        <label class="dp-manager-row" style="display:flex; align-items:center; gap:10px; cursor:pointer;">
                            <input type="checkbox" ${isChecked ? 'checked' : ''} 
                                   onchange="OL.toggleDpInBundle('${bundleId}', '${dp.id}')">
                            <span>${esc(dp.name)}</span>
                            <span class="tiny muted" style="margin-left:auto;">${dp.category}</span>
                        </label>
                    `;
                }).join('')}
            </div>
            <button class="btn primary full-width" style="margin-top:20px;" onclick="OL.renderGlobalDataManager()">Back to Library</button>
        </div>
    `;
    openModal(html);
};

OL.toggleDpInBundle = function(bundleId, dpId) {
    const bundle = state.master.datapoints.find(d => d.id === bundleId);
    if (!bundle.childIds) bundle.childIds = [];
    
    const idx = bundle.childIds.indexOf(dpId);
    if (idx === -1) bundle.childIds.push(dpId);
    else bundle.childIds.splice(idx, 1);
    
    OL.persist();
    OL.editBundle(bundleId);
};

OL.removeStepDatapoint = async function(resId, stepId, idx) {
    const data = OL.getCurrentProjectData();
    const res = data.resources.find(r => String(r.id) === String(resId));
    const step = res?.steps?.find(s => String(s.id) === String(stepId));
    
    if (step && step.datapoints) {
        const dp = step.datapoints[idx];
        
        // 🚀 SMART NAV: If it's a naming tag, left-clicking the text jumps to the resource
        // We only splice if they click the '×' (handled in the HTML string below)
        step.datapoints.splice(idx, 1);
        await OL.persist();
        OL.openInspector(resId, stepId);
        OL.renderVisualizer();
    }
};

OL.renderDataTagPills = function(resId, stepId, datapoints) {
    const client = getActiveClient();
    return datapoints.map((dp, idx) => {
        // Find if this tag points to a specific naming/hierarchy resource
        let jumpAction = "";
        if (dp.linkToResource) {
            const targetRes = (client?.projectData?.localResources || []).find(r => r.name === dp.linkToResource);
            if (targetRes) {
                jumpAction = `onclick="event.stopPropagation(); OL.openResourceModal('${targetRes.id}')"`;
            }
        }

        return `
            <div class="pill purple" ${jumpAction} 
                 style="background:rgba(167, 139, 250, 0.1); border:1px solid #a78bfa; display:flex; align-items:center; gap:5px; cursor:${jumpAction ? 'pointer' : 'default'}; padding: 4px 8px; border-radius: 4px;">
                <span style="font-size:10px;">${dp.linkToResource ? '🔗' : '🏷️'} ${esc(dp.name)}</span>
                <b class="is-clickable" style="opacity:0.5; padding: 0 4px; font-size: 12px;" 
                   onclick="event.stopPropagation(); OL.removeStepDatapoint('${resId}', '${stepId}', ${idx})">×</b>
            </div>
        `;
    }).join('');
};

OL.traceDataLineage = function(dataId) {
    if (!dataId) return OL.setTraceMode(null, null);
    
    const client = getActiveClient();
    const resources = client.projectData.localResources;
    
    // Highlight every node that contains this data ID
    const pathIds = resources.filter(res => 
        (res.steps || []).some(s => (s.datapoints || []).some(d => d.id === dataId))
    ).map(r => String(r.id));

    state.v2.activeTrace = { mode: 'data-trace', resId: dataId };
    state.v2.highlightedIds = pathIds;
    
    OL.renderVisualizer();
};

// 1. Drag Start
OL.handleFieldDragStart = function(e, fieldId) {
    e.dataTransfer.setData("application/sphynx-field-id", fieldId);
    e.currentTarget.style.opacity = '0.4';
};

// 2. Drag Over (Visual feedback)
OL.handleBundleDragOver = function(e) {
    e.preventDefault();
    const zone = e.currentTarget;
    zone.style.borderColor = 'var(--accent)';
    zone.style.background = 'rgba(var(--accent-rgb), 0.05)';
};

// 3. Drag Leave (Reset feedback)
OL.handleBundleDragLeave = function(e) {
    const zone = e.currentTarget;
    zone.style.borderColor = 'var(--line)';
    zone.style.background = 'rgba(255,255,255,0.02)';
};

// 4. Drop (Execute Mapping)
OL.handleFieldDropOnBundle = async function(e, bundleId) {
    e.preventDefault();
    OL.handleBundleDragLeave(e);
    
    const fieldId = e.dataTransfer.getData("application/sphynx-field-id");
    if (!fieldId) return;

    const bundle = state.master.datapoints.find(d => d.id === bundleId);
    if (bundle) {
        if (!bundle.childIds) bundle.childIds = [];
        if (!bundle.childIds.includes(fieldId)) {
            bundle.childIds.push(fieldId);
            await OL.persist();
            OL.renderGlobalDataManager();
            console.log(`🔗 Linked ${fieldId} to Bundle ${bundleId}`);
        }
    }
};

// 5. Remove Mapping
OL.removeFieldFromBundle = async function(bundleId, fieldId) {
    const bundle = state.master.datapoints.find(d => d.id === bundleId);
    if (bundle && bundle.childIds) {
        bundle.childIds = bundle.childIds.filter(id => id !== fieldId);
        await OL.persist();
        OL.renderGlobalDataManager();
    }
};
