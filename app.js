import * as OLData from './core/data.js';
import * as OLAuth from './core/auth.js';
import { esc, val, num, uid } from './core/data.js';
import * as OLClientDashboard from './features/client-dashboard.js';
import * as OLApps from './features/apps.js';
import * as OLFunctions from './features/functions.js';
import * as OLTasks from './features/tasks.js';
import * as OLResourcesGrid from './features/resources-grid.js';
import * as OLResourcesModal from './features/resources-modal.js';
import * as OLWorkflows from './features/flow-visualizer/workflows.js';
import * as OLScoping from './features/scoping.js';
import * as OLTeam from './features/team.js';
import * as OLCredentials from './features/credentials.js';
import * as OLDataManager from './features/data-manager.js';
import * as OLIntegrations from './features/integrations.js';

window.isMatrixActive = false;

OL.getScopingDataForResource = function(resId) {
    const client = getActiveClient();
    if (!client?.projectData?.scopingSheets?.[0]) return null;
    const sheet = client.projectData.scopingSheets[0];
    return sheet.lineItems.find(item => String(item.resourceId) === String(resId));
};

window.addEventListener("load", async () => {
    // 1. Security Check FIRST
    const allowed = await OL.initializeSecurityContext();
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

OL.goToDashboard = function(hash) {
    state.activeClientId = null;
    sessionStorage.removeItem('lastActiveClientId');
    const params = new URLSearchParams(window.location.search);
    params.delete('client');
    const newSearch = params.toString();
    window.history.pushState({}, '', `${window.location.pathname}${newSearch ? '?' + newSearch : ''}${hash}`);
    if (typeof window.buildLayout === 'function') window.buildLayout();
    if (typeof window.handleRoute === 'function') window.handleRoute();
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
    homeAction = `OL.goToDashboard('#/')`;
} else if (client && client.meta.status === "Partner") {
    homeLabel = "My Portfolio";
    homeAction = `OL.goToDashboard('#/partner-dashboard')`;
} else if (client && client.meta.partnerOwner) {
    if (!window.IS_GUEST) {
        homeLabel = "Partner Home";
        homeAction = `OL.goToDashboard('#/partner-dashboard')`;
    } else {
        homeLabel = "My Portfolio";
        homeAction = `OL.goToDashboard('#/partner-dashboard')`;
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
    { key: "client-access", label: "Client Logins", icon: "key-round", href: "#/vault/client-access" },
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
        else if (hash.includes("/client-access")) OL.renderClientAccessList();
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
        const vw = window.innerWidth / 100;
        const rect = canvas.getBoundingClientRect();
        const canvasX = (uE.clientX - rect.left) / zoom;
        const canvasY = (uE.clientY - rect.top) / zoom;
        
        // 🧲 Magnetic Column Snap
        const droppedXvw = canvasX / vw;
        const colStep = FLOW_COLUMN_VW + FLOW_GAP_VW;
        res.layoutCol = Math.round((droppedXvw - FLOW_SPINE_X_VW) / colStep);

        // --- Step Linking ---
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

        // --- Merge Logic ---
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

        // --- Shelf / Workspace or Stage Drop ---
        if (isOverTopShelf || isOverWorkbench) {
            await OL.updateAndSync(() => {
                res.isGlobal = true;
                res.isTopShelf = !!isOverTopShelf;
                res.stageId = null;
                delete res.coords;
            });
        } else {
            // 📍 Vertical Stage Detection
            const sortedStages = [...stages].sort((a, b) => (b.yPos || 0) - (a.yPos || 0));
            const targetStage = sortedStages.find(s => canvasY >= (s.yPos || 0)) || stages[0];

            res.stageId = targetStage.id;
            res.coords = { x: Math.round(canvasX), y: Math.round(canvasY) };
            res.isGlobal = false;
            res.isTopShelf = false;
        }

        await OL.updateAndSync(() => { 
            OL.autoAlignNodes(); 
            if (OL.drawConnections) OL.drawConnections();
        });

        OL.renderVisualizer();
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
};
    
// Add this near your other event listeners
window.addEventListener('resize', () => {
    if (window.location.hash.includes('visualizer')) {
        // Debounce this if you want to be extra performant
        clearTimeout(window.resizeSnapTimer);
        window.resizeSnapSnapTimer = setTimeout(() => {
            OL.autoAlignNodes();
        }, 200);
    }
});

OL.handleCanvasDrop = async function(e) {
    // 🛑 STOP BOTH BROWSER ACTIONS AND ELEMENT OVERLAPS FROM FIRING MULTIPLE DROPS
    e.preventDefault();
    e.stopPropagation();
    
    const canvas = document.getElementById('v2-canvas') || document.getElementById('fv-canvas');
    if (!canvas) return;
    
    const zoom = (state.v2 && state.v2.zoom) || (OL._fv && OL._fv.zoom) || 1;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / zoom;
    const y = (e.clientY - rect.top) / zoom;

    const dragId = e.dataTransfer.getData('application/fv-resource') || e.dataTransfer.getData('text/plain');
    if (!dragId) return;

    const data = OL.getCurrentProjectData();
    const res = data.resources.find(r => String(r.id) === String(dragId));
    if (!res) return;

    // 🎯 1. FIND THE TARGET WORKFLOW AND STAGE DIRECTLY BENEATH THE MOUSE CURSOR
    let targetStageId = null;
    let targetWorkflowId = null;

    const elementsUnderCursor = document.elementsFromPoint(e.clientX, e.clientY);
    for (const el of elementsUnderCursor) {
        const wfGroup = el.closest('.fv-list-workflow-group');
        const stageLane = el.closest('.fv-list-stage') || el.closest('[data-stage-id]');
        
        if (wfGroup && wfGroup.id) {
            targetWorkflowId = wfGroup.id.replace('fv-workflow-group-', ''); 
        }
        if (stageLane) {
            targetStageId = stageLane.id ? stageLane.id.replace('fv-list-stage-', '') : stageLane.getAttribute('data-stage-id');
        }
        if (targetStageId || targetWorkflowId) break;
    }

    if (targetWorkflowId && !targetStageId) {
        const matchingWf = (data.workflows || []).find(w => String(w.id) === String(targetWorkflowId));
        if (matchingWf) targetStageId = matchingWf.stageId;
    }

    // Capture the origin workflow context that we bundled during DragStart
    const sourceWfId = e.dataTransfer.getData('application/fv-context-wf') || OL._fv._draggingContextWfId;

    // 🎯 2. PROCESS ENGINES BASED ON GLOBAL BLUEPRINT STATUS
    if (res.isGlobal === true) {
        // 🌐 GLOBAL ARTIFACT RULES: ABSOLUTELY ZERO ROOT PROPERTY MUTATIONS ALLOWED
        // We do NOT write to res.stageId or res.workflowId. This leaves old map copies alone!
        
        if (targetWorkflowId) {
            const targetWf = (data.workflows || []).find(w => String(w.id) === String(targetWorkflowId));
            if (targetWf) {
                if (!targetWf.resourceIds) targetWf.resourceIds = [];
                
                // Add to the new workflow sequence array
                if (!targetWf.resourceIds.includes(String(res.id))) {
                    targetWf.resourceIds.push(String(res.id));
                }
            }
            console.log(`🌐 Global stamped safely onto Workflow Array: ${targetWorkflowId}`);
        }
    } else {
        // 🏠 LOCAL ARTIFACT RULES: STANDARD SINGLE-INSTANCE MOVE
        // Clean out its tracking reference from its old workflow array lane
        if (sourceWfId && String(sourceWfId) !== String(targetWorkflowId)) {
            const oldWf = (data.workflows || []).find(w => String(w.id) === String(sourceWfId));
            if (oldWf && oldWf.resourceIds) {
                oldWf.resourceIds = oldWf.resourceIds.filter(id => String(id) !== String(res.id));
            }
        }

        // Standard root property mutations for local files
        res.stageId = targetStageId || res.stageId || null;
        res.workflowId = targetWorkflowId || null;
        res.coords = { x: Math.round(x - 110), y: Math.round(y - 20) };

        if (targetWorkflowId) {
            const targetWf = (data.workflows || []).find(w => String(w.id) === String(targetWorkflowId));
            if (targetWf) {
                if (!targetWf.resourceIds) targetWf.resourceIds = [];
                if (!targetWf.resourceIds.includes(String(res.id))) {
                    targetWf.resourceIds.push(String(res.id));
                }
            }
        }
    }

    res.isTopShelf = false;
    res.isDeleted = false;

    await OL.persist();
    OL.renderVisualizer(); 
};

OL.autoAlignNodes = async function() {
    const data = OL.getCurrentProjectData();
    const resources = data.resources || [];
    const stages = data.stages || [];
    const vw = window.innerWidth / 100;
    const depth = OL.state.v2.viewDepth;
    
    const VERTICAL_GAP = 40;
    let currentY = 100; // Starting point at the top of the map

    stages.forEach((stage) => {
        stage.yPos = currentY;
        currentY += 80;

        // 🚀 THE BIG SWITCH: Get either Resources or individual Steps
        let nodesToAlign = [];
        const stageResources = resources.filter(r => String(r.stageId) === String(stage.id) && !r.isGlobal);

        if (depth === 'step') {
            // Flatten all steps into a single list for this stage
            stageResources.forEach(res => {
                res.steps.forEach((step, idx) => {
                    nodesToAlign.push({
                        ...step,
                        parentId: res.id,
                        parentName: res.name,
                        parentType: res.type,
                        stepIdx: idx,
                        // Maintain the user's manual vertical preference
                        sortY: (res.coords?.y || 0) + (idx * 50) 
                    });
                });
            });
        } else {
            nodesToAlign = stageResources.map(r => ({ ...r, sortY: r.coords?.y || 0 }));
        }

        nodesToAlign.sort((a, b) => a.sortY - b.sortY);

        let stageHeightAccumulator = 0;
        nodesToAlign.forEach(node => {
            // Logic to calculate xPosPx based on node.layoutCol or parent's layoutCol...
            // Logic to calculate yPos based on currentY + stageHeightAccumulator...
            
            // If it's a step, we save its coords to a temp state for drawing lines
            // If it's a resource, we update res.coords directly.
        });
        
        currentY += Math.max(stageHeightAccumulator, 150) + 100;
    });
    await OL.persist();
    OL.renderVisualizer();
     if (OL.drawConnections) OL.drawConnections();
};

OL.getCurrentProjectData = function() {
    const hash = window.location.hash || "#/";
    const isVault = hash.startsWith('#/vault');
    
    if (isVault) {
        if (!state.master.stages) state.master.stages = [];
        if (!state.master.resources) state.master.resources = [];
        if (!state.master.workflows) state.master.workflows = [];
        return state.master; 
    } else {
        const client = getActiveClient();
        if (!client || !client.projectData) return { stages: [], resources: [], workflows: [] };

        const pd = client.projectData;

        // 🩺 AUTOMATIC SANITIZATION: Force proper arrays on the LIVE reference
        if (!pd.stages) pd.stages = [];
        if (!pd.localResources) pd.localResources = [];
        
        // 🚑 THE TYPO BRIDGE: Heal 'workfows' vs 'workflows' on the fly
        if (pd.workfows && !pd.workflows) {
            pd.workflows = pd.workfows;
        }
        if (!pd.workflows) pd.workflows = [];

        // 🎯 THE COMPATIBILITY BRIDGE
        // We attach a live reference link of .localResources to .resources 
        // so the layout engine finds exactly what it's hunting for.
        pd.resources = pd.localResources;

        // 🏗️ DAFUALT WORKFLOW GEN: If they have stages but no workflows, 
        // auto-build a placeholder workflow so their cards don't vanish from Swimlanes
        if (pd.stages.length > 0 && pd.workflows.length === 0) {
            pd.stages.forEach(stage => {
                const hasWf = pd.workflows.some(w => w.stageId === stage.id);
                if (!hasWf) {
                    pd.workflows.push({
                        id: 'wf-auto-' + stage.id,
                        name: `Main ${stage.name} Process`,
                        stageId: stage.id,
                        resourceIds: pd.localResources
                            .filter(r => r.stageId === stage.id)
                            .map(r => String(r.id))
                    });
                }
            });
        }

        return pd; // Return the exact reference object so background edits persist!
    }
};

// 🛡️ Global Logic Menu Closer
document.addEventListener('mousedown', (e) => {
    // If the click is NOT on a logic badge or inside a logic menu, hide all menus
    if (!e.target.closest('.v2-logic-badge') && !e.target.closest('.v2-logic-menu')) {
        document.querySelectorAll('.v2-logic-menu').forEach(m => m.style.display = 'none');
    }
});

OL.state.v2.viewDepth = 'resource'; // Options: 'resource' (current) or 'step' (broken out)

// ── TYPE CONFIG ───────────────────────────────────────────
OL._fvTypes = {
  'Workflow':       { color: '#1b2d3f', abbr: 'WF' },
  'Zap':            { color: '#ff4a00', abbr: 'ZP' },
  'Email Campaign': { color: '#3dd9c5', abbr: 'EM' },
  'Form':           { color: '#f5b800', abbr: 'FO' },
  'Task':           { color: '#6b7280', abbr: 'TK' },
  'Calendar':       { color: '#7c3aed', abbr: 'CA' },
  'Decision':       { color: '#f5b800', abbr: '?' },
  'General':        { color: '#6b7280', abbr: '•' },
};
OL._fvGetType = t => OL._fvTypes[t] || { color: '#6b7280', abbr: (t||'?').substring(0,2).toUpperCase() };

OL._fvNormalizeStepCoords = function() {
    const data = OL.getCurrentProjectData();
    (data.resources || []).forEach(res => {
        (res.steps || []).forEach(step => {
            // Don't set 0,0 — leave null so _fvComputeLayout handles it
            if (!step.coords) step.coords = null;
            if (step.pinned === undefined) step.pinned = false;
        });
    });
};

// Returns explicit logic.out links if any targetId is set; otherwise a synthetic
// implicit link to the next sequential step in the same resource.
OL._fvGetEffectiveOut = function(step, res) {
    const explicit = (step.logic?.out || []).filter(l => l.targetId);
    if (explicit.length > 0) return explicit;
    const steps = res.steps || [];
    const idx = steps.indexOf(step);
    if (idx === -1 || idx >= steps.length - 1) return [];
    const nextStep = steps[idx + 1];
    return [{ type: 'next', types: ['next'], targetId: `${res.id}-${nextStep.id}`, _implicit: true }];
};

// Computes per-step layout info for a single resource.
// Main-path steps (not branch targets): colOffset=0, sequential rows.
// Branch targets (reached via condition/loop/delay): colOffset≥1, same row as parent.
OL._fvLayoutResource = function(res) {
    const steps = res.steps || [];

    // Find which steps are branch targets and who their parent is
    const branchOf = {}; // stepId → parentStepId
    steps.forEach(step => {
        (step.logic?.out || []).forEach(link => {
            if (!link.targetId) return;
            const lastH  = link.targetId.lastIndexOf('-');
            const tResId = link.targetId.substring(0, lastH);
            if (String(tResId) !== String(res.id)) return;
            const tStepId = link.targetId.substring(lastH + 1);
            const types   = link.types || [link.type || 'next'];
            if (types.some(t => ['condition', 'loop', 'delay'].includes(t)) && !branchOf[tStepId]) {
                branchOf[tStepId] = step.id;
            }
        });
    });

    const layout   = {};   // stepId → {colOffset, row, parentId}
    const parentRow = {};  // stepId → row index (for branch alignment)
    let mainRow = 0;

    // Main-path steps in array order
    steps.forEach(step => {
        if (branchOf[step.id]) return;
        layout[step.id]    = { colOffset: 0, row: mainRow, parentId: null };
        parentRow[step.id] = mainRow;
        mainRow++;
    });

    // Branch steps: same row as parent, colOffset > 0
    const rowBranchCount = {};
    steps.forEach(step => {
        const parentId = branchOf[step.id];
        if (!parentId) return;
        const pRow = parentRow[parentId] ?? 0;
        rowBranchCount[pRow] = (rowBranchCount[pRow] || 0) + 1;
        layout[step.id] = { colOffset: rowBranchCount[pRow], row: pRow, parentId };
    });

    return layout;
};

// Persist sequential next-step links for any step that has no outbound link defined.
// Safe to call on every render — skips steps that already have logic.out set.
OL._fvAutoLinkSteps = function(resources) {
    let changed = false;
    (resources || []).forEach(res => {
        (res.steps || []).forEach((step, idx) => {
            if (!step.logic) step.logic = { in: [], out: [] };
            if (!step.logic.out) step.logic.out = [];
            if (!step.logic.in)  step.logic.in  = [];
            const hasOut = step.logic.out.some(l => l.targetId);
            if (hasOut) return;
            const nextStep = (res.steps || [])[idx + 1];
            if (!nextStep) return;
            step.logic.out.push({
                type: 'next', types: ['next'],
                targetId: `${res.id}-${nextStep.id}`,
                rule: '', loopLimit: '', delayValue: '', delayUnit: 'days'
            });
            changed = true;
        });
    });
    if (changed) OL.persist();
    return changed;
};
// ── SHARED STATE ─────────────────────────────────────────
if (!OL._fv) OL._fv = {
    layout: sessionStorage.getItem('fv_layout') || 'flowchart',
    zoom: 1,
    showConnections: true,
    stageFilter: '',
    globalsExpanded: false,
    searchMatches: [], searchIdx: -1,
    snapToGrid: false, gridSize: 20,
    _searchQuery: '',
    railCollapsed: sessionStorage.getItem('fv_rail_collapsed') === 'true',
};

// ── MAIN ENTRY ────────────────────────────────────────────
OL.renderVisualizer = function() {
  const wasOpen = OL._fv._lastInspectorResId;
  const mainArea = document.getElementById('mainContent');
  if (!mainArea) return;

  document.body.classList.add('is-visualizer');
  mainArea.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden;padding:0;';

  const client    = getActiveClient();
  const data      = OL.getCurrentProjectData();
  const stages    = data.stages || [];
  const resources = (data.resources || []).filter(r => !r.isDeleted && !r.isLocked);

  if (!OL._fv) OL._fv = {
        layout: sessionStorage.getItem('fv_layout') || 'flowchart', zoom: 1,
        showConnections: true, stageFilter: '',
        globalsExpanded: false,
        searchMatches: [], searchIdx: -1,
        snapToGrid: false, gridSize: 20,
        _searchQuery: '',
    };
    
  // Run DAG layout for flowchart view only — steps view does its own positioning
  if (OL._fv.layout !== 'steps') {
    OL._fvNormalizeStepCoords();
    OL._fvComputeLayout(resources, OL._fv.stageFilter);
  }

  mainArea.innerHTML = `
    <div id="fv-shell">

      <!-- TOPBAR -->
      <div id="fv-topbar">
        <div class="fv-breadcrumb">
          <span>${client ? esc(client.meta.name) : 'Workspace'}</span>
          <span class="fv-sep">/</span>
          <span class="fv-current">Flow Map</span>
        </div>
        <div class="fv-spacer"></div>

        <button class="fv-btn fv-icon"
                onclick="OL._fv.railCollapsed = !OL._fv.railCollapsed; 
                 sessionStorage.setItem('fv_rail_collapsed', OL._fv.railCollapsed); 
                 OL.renderVisualizer();"
                title="${OL._fv.railCollapsed ? 'Expand panel' : 'Collapse panel'}">
            <i data-lucide="${OL._fv.railCollapsed ? 'panel-left-open' : 'panel-left-close'}"></i>
        </button>

        <div class="fv-search-wrap">
          <i data-lucide="search" style="width:13px;height:13px;color:var(--text-muted);flex-shrink:0;"></i>
          <input id="fv-search" type="text"
                 placeholder="Search steps…"
                 value="${esc(OL._fv._searchQuery || '')}"
                 oninput="OL.fvSearch(this.value)"
                 autocomplete="off">
        </div>
        <div id="fv-search-nav"
             style="display:${OL._fv.searchMatches?.length ? 'flex' : 'none'};align-items:center;gap:4px;">
          <button class="fv-btn fv-icon" onclick="OL.fvPrevMatch()">
            <i data-lucide="chevron-left"></i>
          </button>
          <span id="fv-match-count"
                style="font-size:11px;color:var(--text-muted);min-width:32px;text-align:center;"></span>
          <button class="fv-btn fv-icon" onclick="OL.fvNextMatch()">
            <i data-lucide="chevron-right"></i>
          </button>
          <button class="fv-btn fv-icon" onclick="OL.fvClearSearch()">
            <i data-lucide="x"></i>
          </button>
          <button class="fv-toggle-btn ${OL._fv.showArchived ? 'on' : ''}"
                    onclick="OL._fv.showArchived = !OL._fv.showArchived; OL.renderVisualizer();">
              📦 ${OL._fv.showArchived ? 'Hide Archived' : 'Show Archived'}
            </button>
        </div>

        <div class="fv-divider"></div>

        <!-- Layout switcher -->
        <div class="fv-layout-toggle-group" style="display: inline-flex; background: rgba(255,255,255,0.03); border: 1px solid var(--line); border-radius: 8px; padding: 2px; gap: 2px;">
            <button class="fv-layout-btn ${OL._fv.layout === 'flowchart' ? 'active' : ''}" 
                    style="display: flex; align-items: center; gap: 6px; padding: 5px 10px; border: none; font-size: 11px; font-weight: 600; font-family: inherit; border-radius: 6px; cursor: pointer; transition: all 0.15s; 
                           background: ${OL._fv.layout === 'flowchart' ? 'rgba(61,217,197,0.15)' : 'transparent'}; 
                           color: ${OL._fv.layout === 'flowchart' ? 'var(--accent)' : 'var(--text-muted)'};"
                    onclick="OL._fv.layout = 'flowchart'; sessionStorage.setItem('fv_layout', 'flowchart'); OL.renderVisualizer();"
                    title="Swimlanes View">
                <i data-lucide="columns-3" style="width: 13px; height: 13px;"></i>
                <span>Swimlanes</span>
            </button>
        
            <button class="fv-layout-btn ${OL._fv.layout === 'steps' ? 'active' : ''}" 
                    style="display: flex; align-items: center; gap: 6px; padding: 5px 10px; border: none; font-size: 11px; font-weight: 600; font-family: inherit; border-radius: 6px; cursor: pointer; transition: all 0.15s; 
                           background: ${OL._fv.layout === 'steps' ? 'rgba(61,217,197,0.15)' : 'transparent'}; 
                           color: ${OL._fv.layout === 'steps' ? 'var(--accent)' : 'var(--text-muted)'};"
                    onclick="OL._fv.layout = 'steps'; sessionStorage.setItem('fv_layout', 'steps'); OL.renderVisualizer();"
                    title="Steps View">
                <i data-lucide="hexagon" style="width: 13px; height: 13px;"></i>
                <span>Steps</span>
            </button>
        
            <button class="fv-layout-btn ${OL._fv.layout === 'list' ? 'active' : ''}" 
                    style="display: flex; align-items: center; gap: 6px; padding: 5px 10px; border: none; font-size: 11px; font-weight: 600; font-family: inherit; border-radius: 6px; cursor: pointer; transition: all 0.15s; 
                           background: ${OL._fv.layout === 'list' ? 'rgba(61,217,197,0.15)' : 'transparent'}; 
                           color: ${OL._fv.layout === 'list' ? 'var(--accent)' : 'var(--text-muted)'};"
                    onclick="OL._fv.layout = 'list'; sessionStorage.setItem('fv_layout', 'list'); OL.renderVisualizer();"
                    title="List View">
                <i data-lucide="list" style="width: 13px; height: 13px;"></i>
                <span>List</span>
            </button> 
        </div>

        <!-- Stage filter -->
        <select id="fv-stage-filter" class="fv-select"
                onchange="OL._fv.stageFilter = this.value; OL.renderVisualizer();">
          <option value="">All stages & workflows</option>
          ${stages.map(s => {
            const stageWorkflows = (OL.getWorkflows() || []).filter(w => w.stageId === s.id);
            const stageSelected  = OL._fv.stageFilter === `stage-${s.id}`;
            return `
              <option value="stage-${esc(s.id)}" ${stageSelected ? 'selected' : ''}>
                ${esc(s.name)}
              </option>
              ${stageWorkflows.map(wf => `
                <option value="${esc(wf.id)}" ${OL._fv.stageFilter === wf.id ? 'selected' : ''}>
                  &nbsp;&nbsp;↳ ${esc(wf.name)}
                </option>
              `).join('')}
            `;
          }).join('')}
        </select>

        <!-- Globals toggle (flowchart only) -->
        ${OL._fv.layout === 'flowchart' ? `
          <button class="fv-toggle-btn ${OL._fv.globalsExpanded ? 'on' : ''}"
                  onclick="OL._fv.globalsExpanded=!OL._fv.globalsExpanded; OL.renderVisualizer();">
            <i data-lucide="globe"></i>
            Globals ${OL._fv.globalsExpanded ? 'On' : 'Off'}
          </button>
        ` : ''}

        <!-- Steps view controls -->
        ${OL._fv.layout === 'steps' ? `
          <button class="fv-toggle-btn ${OL._fv.snapToGrid ? 'on' : ''}"
                  onclick="OL._fv.snapToGrid=!OL._fv.snapToGrid; OL.renderVisualizer();"
                  title="Snap to grid">
            <i data-lucide="grid"></i>
            Grid ${OL._fv.snapToGrid ? 'On' : 'Off'}
          </button>

          <!-- Tidy dropdown -->
          <div style="position:relative;display:inline-flex;">
            <button class="fv-btn" onclick="OL._fvTidy('global')"
                    title="Tidy layout (respects pinned)">
              <i data-lucide="align-justify"></i> Tidy
            </button>
            <button class="fv-btn fv-icon" style="border-left:none;border-radius:0 8px 8px 0;padding:7px 6px;"
                    onclick="OL._fvShowTidyMenu(event)">
              <i data-lucide="chevron-down"></i>
            </button>
          </div>
        ` : ''}

        <div class="fv-divider"></div>

        <!-- Step Expand button-->
        ${OL._fv.layout === 'flowchart' ? `
          <button class="fv-toggle-btn ${OL._fv.stepsExpanded ? 'on' : ''}"
                  onclick="OL._fv.stepsExpanded=!OL._fv.stepsExpanded; OL.renderVisualizer();"
                  title="Show steps inside cards">
            <i data-lucide="list"></i>
            Steps ${OL._fv.stepsExpanded ? 'On' : 'Off'}
          </button>
        ` : ''}

        <!-- Zoom -->
        <button class="fv-btn fv-icon" onclick="OL.fvZoom(-0.12)">
          <i data-lucide="minus"></i>
        </button>
        <span id="fv-zoom-label"
              style="font-size:11px;font-weight:600;color:var(--text-dim);min-width:38px;text-align:center;">
          ${Math.round((OL._fv.zoom||1)*100)}%
        </span>
        <button class="fv-btn fv-icon" onclick="OL.fvZoom(0.12)">
          <i data-lucide="plus"></i>
        </button>
      </div>

        <div class="fv-divider"></div>
        <div style="position:relative;display:inline-flex;">
            <button class="fv-btn" style="gap:6px;"
                    id="fv-print-btn"
                    onclick="OL._fvTogglePrintMenu()">
                <i data-lucide="printer" style="width:13px;height:13px;"></i>
                Export PDF
            </button>
            <div id="fv-print-menu" style="
                display:none;position:absolute;top:calc(100% + 6px);right:0;
                background:var(--panel);border:1px solid var(--panel-border);
                border-radius:10px;padding:6px;z-index:100;min-width:160px;
                box-shadow:0 8px 24px rgba(0,0,0,0.3);">
                ${[
                    { view:'flowchart', icon:'columns-3',   label:'Swimlanes' },
                    { view:'list',      icon:'list',         label:'List View' },
                    { view:'steps',     icon:'hexagon',      label:'Steps View' },
                ].map(v => `
                    <div onmousedown="event.preventDefault();OL.printFlowMap('${v.view}');document.getElementById('fv-print-menu').style.display='none';"
                         style="display:flex;align-items:center;gap:10px;padding:9px 12px;
                                border-radius:7px;cursor:pointer;transition:background 0.12s;"
                         onmouseover="this.style.background='var(--panel-soft)'"
                         onmouseout="this.style.background='transparent'">
                        <i data-lucide="${v.icon}" style="width:13px;height:13px;color:var(--accent);flex-shrink:0;"></i>
                        <span style="font-size:12px;font-weight:600;color:var(--text-main);">${v.label}</span>
                    </div>
                `).join('')}
            </div>
        </div>

      <!-- BODY -->
      <div id="fv-body">

        <!-- Workbench icon rail -->
        <div id="fv-wb-rail"
             ondragover="event.preventDefault(); this.style.background='rgba(61,217,197,0.15)';"
             ondragleave="this.style.background='';"
             ondrop="event.preventDefault(); this.style.background=''; 
                     const id=event.dataTransfer.getData('application/fv-resource'); 
                     if(id) OL._fvUnmapResource(id);">
        
            <div class="fv-wb-icon ${OL._fv._wbTab==='flows' ?'active':''}"
                  onclick="OL._fvToggleWb('flows')" title="Flows">
              <i data-lucide="workflow"></i>
            </div>
            <div class="fv-wb-icon ${OL._fv._wbTab==='assets' ?'active':''}"
                  onclick="OL._fvToggleWb('assets')" title="Assets">
              <i data-lucide="database"></i>
            </div>
            <div class="fv-wb-icon ${OL._fv._wbTab==='guides' ?'active':''}"
                  onclick="OL._fvToggleWb('guides')" title="Guides">
              <i data-lucide="book-open"></i>
            </div>
            <div class="fv-wb-icon ${OL._fv._wbTab==='data' ?'active':''}"
                  onclick="OL._fvToggleWb('data')" title="Data">
              <i data-lucide="tag"></i>
            </div>
        </div>
        <!-- Workbench drawer -->
        <div id="fv-wb-drawer" class="${OL._fv._wbTab ? 'open' : ''}"
             ondragover="event.preventDefault(); event.stopPropagation(); this.style.background='rgba(61,217,197,0.08)';"
             ondragleave="if(!this.contains(event.relatedTarget)){this.style.background='';}"
             ondrop="OL._fvHandleDrawerDrop(event)"">
          <div class="fv-wb-header">
            <span class="fv-wb-title">${OL._fv._wbTab ? OL._fv._wbTab.charAt(0).toUpperCase() + OL._fv._wbTab.slice(1) : ''}</span>
            <button class="fv-btn fv-icon" onclick="OL._fvToggleWb(null)">
              <i data-lucide="x"></i>
            </button>
          </div>
          <div id="fv-wb-content"></div>
        </div>

        <!-- Lane rail (flowchart + list only) -->
        ${OL._fv.layout !== 'steps' ? `
          <div id="fv-lane-rail"></div>
        ` : ''}

        <!-- Main canvas -->
        <div id="fv-canvas-wrap"
             onclick="OL._fvHandleCanvasClick(event)">
          <div id="fv-canvas">
            <svg id="fv-svg-layer"></svg>
            <div id="fv-content"></div>
          </div>
        </div>

      </div>
    </div>
  `;
    
   const realInspector = document.getElementById('inspector-panel');
    if (realInspector) {
      realInspector.id = 'v2-inspector-panel';
      // Ensure inspector-content exists inside it
      if (!document.getElementById('inspector-content')) {
        const scrollContent = realInspector.querySelector('.inspector-scroll-content');
        if (scrollContent) {
          scrollContent.innerHTML = '<div id="inspector-content"></div>';
        }
      }
    }

  if (window.lucide) lucide.createIcons();

  // Render content based on layout
  if (OL._fv.layout === 'flowchart') {
    OL._fvRenderFlowchart(stages, resources);
  } else if (OL._fv.layout === 'steps') {
    OL._fvRenderSteps(resources);
  } else {
    OL._fvRenderList(stages, resources);
  }

  // Populate workbench if open
  if (OL._fv._wbTab) OL._fvPopulateWb(OL._fv._wbTab, resources);

  // Setup interactions
  OL._fvSetupZoom();
  if (OL._fv.layout !== 'steps') {
    OL._fvSyncRailHeights();
    OL._fvSetupRailScroll();
  }

 if (wasOpen) {
    requestAnimationFrame(() => {
        OL._fvOpenStepsList(wasOpen);
    });
  }
};

OL._fvTogglePrintMenu = function() {
    const menu = document.getElementById('fv-print-menu');
    if (!menu) return;
    const isOpen = menu.style.display === 'block';
    menu.style.display = isOpen ? 'none' : 'block';
    if (!isOpen) {
        setTimeout(() => {
            document.addEventListener('click', function closePrintMenu(e) {
                const btn = document.getElementById('fv-print-btn');
                if (!menu.contains(e.target) && btn && !btn.contains(e.target)) {
                    menu.style.display = 'none';
                    document.removeEventListener('click', closePrintMenu);
                }
            });
        }, 50);
    }
};

OL._fvHandleDrawerDrop = function(event) {
    event.preventDefault();
    event.stopPropagation();
    const drawer = event.currentTarget;
    drawer.style.background = '';
    const resId = event.dataTransfer.getData('application/fv-resource') 
               || event.dataTransfer.getData('text/plain');
    if (resId) OL._fvUnmapResource(resId);
};

OL._fvRenderFlowchart = function(stages, resources) {
  const body = document.getElementById('fv-body');
  if (!body) return;

  // Remove any previous rail/canvas before injecting fresh ones
  ['fv-lane-rail', 'fv-canvas-wrap'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.remove();
  });

  const html = OL._fvBuildFlowchartShell(stages, resources);
  const temp = document.createElement('div');
  temp.innerHTML = html;

  // Just append — inspector is now in the grid, not in fv-body
  while (temp.firstChild) {
    body.appendChild(temp.firstChild);
  }

  if (window.lucide) lucide.createIcons();
  OL._fvSyncRailHeights();
  OL._fvSetupRailScroll();
};

OL._fvRenderList = function(stages, resources) {
  const body = document.getElementById('fv-body');
  if (!body) return;

  // Remove previous content
  ['fv-list-wrap', 'fv-lane-rail', 'fv-canvas-wrap'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.remove();
  });

  const html = OL._fvBuildListShell(stages, resources);
  const temp = document.createElement('div');
  temp.innerHTML = html;

  while (temp.firstChild) {
    body.appendChild(temp.firstChild);
  }

  if (window.lucide) lucide.createIcons();
};

// ══════════════════════════════════════════════
// FLOWCHART VIEW
// ══════════════════════════════════════════════

OL._fvBuildFlowchartShell = function(stages, resources) {
  const data      = OL.getCurrentProjectData();
  if (!data.workflows) data.workflows = [];
  const workflows = data.workflows;
  const filter    = OL._fv.stageFilter || '';
  const expanded  = OL._fv.globalsExpanded || false;

  const globalResources = resources.filter(r => r.isGlobal);
  const globalIds       = new Set(globalResources.map(r => String(r.id)));

  // Build global stage count map
  const globalStageCount = {};
  globalResources.forEach(gr => {
    globalStageCount[String(gr.id)] = 0;
    stages.forEach(s => {
      const stageRes = resources.filter(r => r.stageId === s.id && !globalIds.has(String(r.id)));
      const referenced = stageRes.some(r =>
        (r.steps||[]).some(step =>
          (step.logic?.out||[]).some(out => {
            const lastH = String(out.targetId||'').lastIndexOf('-');
            return lastH !== -1 && out.targetId.substring(0, lastH) === String(gr.id);
          })
        )
      );
      if (referenced) globalStageCount[String(gr.id)]++;
    });
  });

  // Determine which stages/workflows to show based on filter
  // filter can be 'stage-{id}' or 'wf-{id}' or ''
  const isWfFilter    = filter.startsWith('wf-');
  const isStageFilter = filter.startsWith('stage-');
  const filteredWfId  = isWfFilter ? filter : null;
  const filteredStageId = isStageFilter ? filter.replace('stage-', '') : null;

  let railHtml  = '';
  let lanesHtml = '';
  let globalCardNum = 0;

  // ── COLORS for workflows ─────────────────────────────
  const WF_COLORS = [
    '#3dd9c5','#7c3aed','#f97316','#38bdf8',
    '#a78bfa','#fb923c','#10b981','#f43f5e'
  ];

  const displayStages = [...stages];

  displayStages.forEach((stage, si) => {
    if (filteredStageId && stage.id !== filteredStageId) return;

    // Get workflows for this stage
    const stageWorkflows = workflows.filter(w => w.stageId === stage.id);

    // Get unassigned resources for this stage
    const assignedResIds = new Set(
      stageWorkflows.flatMap(w => w.resourceIds || [])
    );
    const unassignedRes = resources.filter(r =>
      r.stageId === stage.id &&
      !globalIds.has(String(r.id)) &&
      !assignedResIds.has(String(r.id))
    );

    // Skip stage if wf filter and no matching workflow
    if (filteredWfId) {
      const hasMatchingWf = stageWorkflows.some(w => w.id === filteredWfId);
      if (!hasMatchingWf) return;
    }

    // ── RAIL: Stage header ───────────────────────────────
    railHtml += `
      <div class="fv-rail-stage-group"
           draggable="true"
           ondragstart="OL._fvRailDragStart(event, 'stage', '${stage.id}')"
           ondragover="event.preventDefault(); this.classList.add('fv-rail-drag-over')"
           ondragleave="this.classList.remove('fv-rail-drag-over')"
           ondrop="this.classList.remove('fv-rail-drag-over'); OL._fvRailDrop(event, 'stage', '${stage.id}')">
        <div style="padding:8px 10px 3px;display:flex;align-items:center;gap:6px;cursor:grab;">
          <span style="opacity:0.2;font-size:12px;">⠿</span>
          <span contenteditable="true"
                style="font-size:9px;font-weight:700;text-transform:uppercase;
                       letter-spacing:0.1em;color:rgba(255,255,255,0.25);
                       outline:none;flex:1;"
                onblur="OL._fvEditStageName('${stage.id}', this.innerText.trim())">
            ${esc(stage.name)}
          </span>
        </div>
    `;
    // ── RAIL: Workflow entries ───────────────────────────
    stageWorkflows.forEach((wf, wfi) => {
      if (filteredWfId && wf.id !== filteredWfId) return;
      const wfColor  = wf.color || WF_COLORS[wfi % WF_COLORS.length];
      const isActive = OL._fv.stageFilter === wf.id;
      const wfRes    = (wf.resourceIds || [])
        .map(id => resources.find(r => String(r.id) === id))
        .filter(Boolean);
        
        railHtml += `
          <div class="fv-rail-wf-item"
               draggable="true"
               ondragstart="OL._fvRailDragStart(event, 'workflow', '${wf.id}', '${stage.id}')"
               ondragover="event.preventDefault(); event.stopPropagation(); this.classList.add('fv-rail-drag-over')"
               ondragleave="this.classList.remove('fv-rail-drag-over')"
               ondrop="event.stopPropagation(); this.classList.remove('fv-rail-drag-over'); OL._fvRailDrop(event, 'workflow', '${wf.id}', '${stage.id}')"
               style="padding:5px 10px 5px 16px;display:flex;align-items:center;gap:6px;cursor:grab;
                      border-left:3px solid ${isActive ? wfColor : 'transparent'};
                      background:${isActive ? `${wfColor}15` : 'transparent'};">
            <span style="opacity:0.2;font-size:11px;">⠿</span>
            <div style="width:8px;height:8px;border-radius:50%;background:${wfColor};flex-shrink:0;"></div>
            <span style="font-size:10px;font-weight:500;color:${isActive ? wfColor : 'rgba(255,255,255,0.5)'};flex:1;
                         white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"
                  onclick="OL._fv.stageFilter='${wf.id}';OL.renderVisualizer();">
              ${esc(wf.name)}
            </span>
            <span style="font-size:9px;color:rgba(255,255,255,0.2);">${wfRes.length}</span>
          </div>
        `;

      // Rail: resources within workflow
      wfRes.forEach(res => {
        const tc = OL._fvGetType(res.type);
        railHtml += `
          <div style="padding:3px 10px 3px 22px;display:flex;align-items:center;gap:5px;
                      cursor:pointer;transition:background 0.12s;"
               onclick="OL._fvOpenStepsList('${res.id}')"
               onmouseover="this.style.background='rgba(255,255,255,0.03)'"
               onmouseout="this.style.background='transparent'">
            <div style="width:5px;height:5px;border-radius:50%;
                        background:${tc.color};flex-shrink:0;"></div>
            <span style="font-size:10px;color:rgba(255,255,255,0.3);
                         white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
              ${esc(res.name.substring(0, 18))}
            </span>
          </div>
        `;
      });
    });

    // Rail: unassigned
    if (unassignedRes.length > 0 && !filteredWfId) {
      railHtml += `
        <div style="padding:5px 10px;display:flex;align-items:center;gap:6px;opacity:0.5;">
          <div style="width:8px;height:8px;border-radius:50%;
                      background:#6b7280;flex-shrink:0;"></div>
          <span style="font-size:10px;color:rgba(255,255,255,0.3);">
            Unassigned
          </span>
          <span style="font-size:9px;color:rgba(255,255,255,0.2);">
            ${unassignedRes.length}
          </span>
        </div>
      `;
    }
    railHtml += `</div>`; // close fv-rail-stage-group
      
    // ── CANVAS: Stage header ─────────────────────────────
    lanesHtml += `
      <div style="padding:8px 16px;background:var(--panel);
                  border-bottom:0.5px solid var(--panel-border);
                  display:flex;align-items:center;gap:8px;
                  position:sticky;top:0;z-index:10;">
        <div style="width:20px;height:20px;border-radius:5px;
                    background:#3dd9c5;color:var(--panel);font-size:9px;
                    font-weight:700;display:flex;align-items:center;
                    justify-content:center;flex-shrink:0;">
          ${si + 1}
        </div>
        <span contenteditable="true"
              style="font-size:12px;font-weight:500;color:var(--text-main);outline:none;
                     border-bottom:1px dashed transparent;transition:border-color 0.2s;"
              onfocus="this.style.borderColor='#3dd9c5'"
              onblur="this.style.borderColor='transparent';OL._fvEditStageName('${stage.id}', this.innerText.trim())">
          ${esc(stage.name)}
        </span>
        <div style="display:flex;align-items:center;gap:4px;margin-left:auto;">
          <button onclick="OL._fvCreateWorkflow('${stage.id}')"
                  style="display:inline-flex;align-items:center;gap:4px;padding:4px 8px;
                         border-radius:6px;border:0.5px solid var(--panel-border);background:var(--panel-soft);
                         color:var(--text-dim);font-size:10px;cursor:pointer;">
            <i data-lucide="plus" style="width:10px;height:10px;"></i> Workflow
          </button>
          <button onclick="OL.addStageBetween(${si})"
                  style="display:inline-flex;align-items:center;gap:4px;padding:4px 8px;
                         border-radius:6px;border:0.5px solid var(--panel-border);background:var(--panel-soft);
                         color:var(--text-dim);font-size:10px;cursor:pointer;"
                  title="Add stage before">
            <i data-lucide="plus-circle" style="width:10px;height:10px;"></i>
          </button>
          <button onclick="OL._fvEditStageName('${stage.id}')"
                  style="display:inline-flex;align-items:center;gap:4px;padding:4px 8px;
                         border-radius:6px;border:0.5px solid var(--panel-border);background:var(--panel-soft);
                         color:var(--text-dim);font-size:10px;cursor:pointer;"
                  title="Rename stage">
            <i data-lucide="pencil" style="width:10px;height:10px;"></i>
          </button>
          <button onclick="OL._fvDeleteStage('${stage.id}')"
                  style="display:inline-flex;align-items:center;gap:4px;padding:4px 8px;
                         border-radius:6px;border:0.5px solid rgba(239,68,68,0.3);
                         background:rgba(239,68,68,0.06);
                         color:#ef4444;font-size:10px;cursor:pointer;"
                  title="Delete stage">
            <i data-lucide="trash-2" style="width:10px;height:10px;"></i>
          </button>
        </div>
      </div>
    `;

    // ── CANVAS: Workflow swimlanes ───────────────────────
    stageWorkflows.forEach((wf, wfi) => {
      if (filteredWfId && wf.id !== filteredWfId) return;
      const wfColor = wf.color || WF_COLORS[wfi % WF_COLORS.length];
      const wfRes   = (wf.resourceIds || [])
        .map(id => resources.find(r => String(r.id) === id))
        .filter(Boolean);

      // Build globals for this workflow's resources
      const wfGlobals = globalResources.filter(gr =>
        wfRes.some(r =>
          (r.steps||[]).some(step =>
            (step.logic?.out||[]).some(out => {
              const lastH = String(out.targetId||'').lastIndexOf('-');
              return lastH !== -1 && out.targetId.substring(0, lastH) === String(gr.id);
            })
          )
        )
      );

      const cardsHtml = wfRes.map((res, idx) => {
            globalCardNum++;
            return `
                <div class="fv-card-slot"
                     ondragover="event.preventDefault(); event.stopPropagation();
                                 this.classList.add('fv-insert-before');"
                     ondragleave="this.classList.remove('fv-insert-before')"
                     ondrop="this.classList.remove('fv-insert-before');
                             OL._fvDropAtIndex(event, '${stage.id}', '${wf.id}', ${idx});"
                     style="position:relative;">
                    ${OL._fvBuildCard(res, globalCardNum, false, 0)}
                </div>
            `;
        }).join('') + `
            <div class="fv-card-slot"
                 ondragover="event.preventDefault(); event.stopPropagation();
                             this.classList.add('fv-insert-before');"
                 ondragleave="this.classList.remove('fv-insert-before')"
                 ondrop="this.classList.remove('fv-insert-before');
                         OL._fvDropAtIndex(event, '${stage.id}', '${wf.id}', ${wfRes.length});"
                 style="position:relative;min-width:20px;min-height:80px;flex-shrink:0;">
            </div>
        `;

      const globalsHtml = expanded ? wfGlobals.map(gr => {
        globalCardNum++;
        return OL._fvBuildCard(gr, globalCardNum, true, globalStageCount[String(gr.id)] || 1);
      }).join('') : wfGlobals.map(gr => {
        const tc = OL._fvGetType(gr.type);
        const stageCount = globalStageCount[String(gr.id)] || 1;
        return `
          <div class="fv-global-chip"
               onclick="OL.openInspector('${gr.id}', null, 'cards')"
               title="${esc(gr.name)} — used in ${stageCount} workflow${stageCount !== 1 ? 's' : ''}">
            <div class="fv-global-chip-icon" style="background:${tc.color};">${tc.abbr}</div>
            <span>${esc(gr.name.substring(0, 20))}</span>
            <span class="fv-global-chip-count">×${stageCount}</span>
          </div>
        `;
      }).join('');

      lanesHtml += `
        <div class="fv-swimlane" id="fv-lane-${wf.id}"
             data-stage-id="${stage.id}"
             data-wf-id="${wf.id}"
             onclick="OL._fvHandleCanvasClick(event)"
             ondragover="OL._fvLaneDragOver(event)"
             ondragleave="OL._fvLaneDragLeave(event)"
             ondrop="OL._fvLaneDrop(event, '${stage.id}', '${wf.id}')">
            <div style="display:flex;align-items:center;gap:8px;width:100%;
                        margin-bottom:10px;padding-bottom:8px;
                        border-bottom:0.5px solid var(--line);">
                <div style="width:10px;height:10px;border-radius:50%;
                            background:${wfColor};flex-shrink:0;"></div>
                <span contenteditable="true"
                      style="font-size:11px;font-weight:500;color:var(--text-dim);outline:none;"
                      onblur="OL.renameWorkflow('${wf.id}', this.innerText.trim())">
                    ${esc(wf.name)}
                </span>
                <span style="font-size:10px;color:var(--text-muted);">
                    ${wfRes.length} resource${wfRes.length !== 1 ? 's' : ''}
                </span>
                <button class="fv-btn" style="margin-left:auto;font-size:9px;padding:2px 6px;"
                        onclick="event.stopPropagation(); OL._fvAddResourceToWorkflow('${wf.id}')">
                    <i data-lucide="plus" style="width:10px;height:10px;"></i> Add Resource
                </button>
                <button class="fv-btn" style="font-size:9px;padding:2px 6px;color:#ef4444;"
                        onclick="event.stopPropagation(); OL.deleteWorkflow('${wf.id}')">
                    <i data-lucide="trash-2" style="width:10px;height:10px;"></i>
                </button>
            </div>
            <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-start;">
                ${cardsHtml}
                ${globalsHtml}
            </div>
            ${(wfRes.length === 0 && wfGlobals.length === 0) ? `
                <div style="font-size:11px;color:var(--text-muted);font-style:italic;
                            border:1px dashed var(--panel-border);border-radius:8px;
                            text-align:center;padding:20px;
                            pointer-events:none;">
                    Drag resources here or click + Add
                </div>
            ` : ''}
        </div>
    `;
    });

    // ── CANVAS: Unassigned resources ─────────────────────
    if (unassignedRes.length > 0 && !filteredWfId) {
      lanesHtml += `
        <div class="fv-swimlane" id="fv-lane-unassigned-${stage.id}"
             data-stage-id="${stage.id}"
             style="opacity:0.7;"
             ondragover="OL._fvLaneDragOver(event)"
             ondragleave="OL._fvLaneDragLeave(event)"
             ondrop="OL._fvLaneDrop(event, '${stage.id}', null)">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
            <div style="width:8px;height:8px;border-radius:50%;
                        background:var(--text-muted);flex-shrink:0;"></div>
            <span style="font-size:11px;color:var(--text-muted);">Unassigned</span>
            <span style="font-size:10px;color:var(--line);">
              ${unassignedRes.length} resource${unassignedRes.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div style="display:flex;gap:10px;flex-wrap:wrap;">
            ${unassignedRes.map(res => {
              globalCardNum++;
              return OL._fvBuildCard(res, globalCardNum, false, 0);
            }).join('')}
          </div>
        </div>
      `;
    }
  });

  // ── ADD STAGE AT END ─────────────────────────────────
  const railCollapsed = OL._fv.railCollapsed;

  return `
    <div id="fv-lane-rail"
         style="width:${railCollapsed ? '32px' : '140px'};
                min-width:${railCollapsed ? '32px' : '140px'};
                transition:width 0.25s ease, min-width 0.25s ease;
                overflow:hidden;">
        ${railCollapsed ? `
            <div style="display:flex;flex-direction:column;align-items:center;
                        padding:8px 0;gap:4px;">
                <button onclick="OL._fv.railCollapsed=false;OL.renderVisualizer();"
                        style="width:24px;height:24px;border:none;
                               background:rgba(255,255,255,0.08);
                               border-radius:6px;cursor:pointer;
                               color:rgba(255,255,255,0.4);
                               display:flex;align-items:center;justify-content:center;
                               margin-bottom:6px;">
                    <i data-lucide="panel-left-open" style="width:13px;height:13px;"></i>
                </button>
                ${displayStages.flatMap(stage => {
                    const stageWorkflows = workflows.filter(w => w.stageId === stage.id);
                    return stageWorkflows.map((wf, wfi) => {
                        const wfColor = wf.color || WF_COLORS[wfi % WF_COLORS.length];
                        return `
                            <div title="${esc(wf.name)}"
                                 onclick="OL._fv.stageFilter='${wf.id}';OL._fv.railCollapsed=false;OL.renderVisualizer();"
                                 style="width:10px;height:10px;border-radius:50%;
                                        background:${wfColor};cursor:pointer;flex-shrink:0;
                                        transition:transform 0.15s;"
                                 onmouseover="this.style.transform='scale(1.4)'"
                                 onmouseout="this.style.transform='scale(1)'">
                            </div>
                        `;
                    });
                }).join('')}
                <div title="Unassigned"
                     style="width:8px;height:8px;border-radius:50%;
                            background:#6b7280;opacity:0.4;margin-top:4px;">
                </div>
            </div>
        ` : `
            ${railHtml}
            <div style="padding:8px 10px;">
                <button class="fv-lane-action-btn"
                        style="width:100%;justify-content:center;opacity:0.5;"
                        onclick="OL.addStageBetween(${displayStages.length})"
                        title="Add stage at end">
                    <i data-lucide="plus"></i>
                </button>
            </div>
        `}
    </div>
    <div id="fv-canvas-wrap"
         onclick="OL._fvHandleCanvasClick(event)">
        <div id="fv-canvas">
            <svg id="fv-svg-layer"></svg>
            <div id="fv-lanes-container">${lanesHtml}</div>
        </div>
    </div>
  `;
};

    OL._fvRailDragStart = function(e, type, id, parentId) {
    e.stopPropagation();
    e.dataTransfer.setData('fv-rail-type', type);
    e.dataTransfer.setData('fv-rail-id', id);
    if (parentId) e.dataTransfer.setData('fv-rail-parent', parentId);
    e.dataTransfer.effectAllowed = 'move';
};

OL._fvDropAtIndex = async function(e, targetStageId, targetWfId, targetIndex) {
    if (e) {
        e.preventDefault();
        e.stopPropagation();
    }

    const dragId = e.dataTransfer.getData('application/fv-resource') || e.dataTransfer.getData('text/plain');
    if (!dragId) return;

    const data = OL.getCurrentProjectData();
    const res = data.resources.find(r => String(r.id) === String(dragId));
    if (!res) return;

    // Grab the origin workflow context that we bundled during DragStart
    const sourceWfId = e.dataTransfer.getData('application/fv-context-wf') || OL._fv._draggingContextWfId;

    // 🎯 THE GLOBAL SAFETY SHIELD:
    if (res.isGlobal === true) {
        // 🌐 GLOBAL BLUEPRINT CLONE RULES:
        // Absolute zero root property mutations allowed. We don't touch res.workflowId.
        
        // 1. Remove the instance link from the old workflow array it was dragged out of
        if (sourceWfId && String(sourceWfId) !== String(targetWfId)) {
            const oldWf = (data.workflows || []).find(w => String(w.id) === String(sourceWfId));
            if (oldWf && oldWf.resourceIds) {
                oldWf.resourceIds = oldWf.resourceIds.filter(id => String(id) !== String(res.id));
            }
        }

        // 2. Inject it into the new workflow array index cleanly
        const targetWf = (data.workflows || []).find(w => String(w.id) === String(targetWfId));
        if (targetWf) {
            if (!targetWf.resourceIds) targetWf.resourceIds = [];
            
            // Remove it first if it somehow exists to prevent internal dupes in the same list
            targetWf.resourceIds = targetWf.resourceIds.filter(id => String(id) !== String(res.id));
            
            // Insert it precisely at the specific index it was dropped onto in the lane sequence!
            targetWf.resourceIds.splice(targetIndex, 0, String(res.id));
        }
        
        console.log(`🌐 Global instance safely spliced into Workflow ${targetWfId} at index ${targetIndex}`);
    } else {
        // 🏠 LOCAL ASSET behavior (Original Physical Move Logic)
        if (sourceWfId && String(sourceWfId) !== String(targetWfId)) {
            const oldWf = (data.workflows || []).find(w => String(w.id) === String(sourceWfId));
            if (oldWf && oldWf.resourceIds) {
                oldWf.resourceIds = oldWf.resourceIds.filter(id => String(id) !== String(res.id));
            }
        }

        // Standard local assignment shifts
        res.workflowId = targetWfId;
        res.stageId = targetStageId;

        const targetWf = (data.workflows || []).find(w => String(w.id) === String(targetWfId));
        if (targetWf) {
            if (!targetWf.resourceIds) targetWf.resourceIds = [];
            targetWf.resourceIds = targetWf.resourceIds.filter(id => String(id) !== String(res.id));
            targetWf.resourceIds.splice(targetIndex, 0, String(res.id));
        }
    }

    await OL.persist();
    OL.renderVisualizer();
};

OL._fvRailDrop = function(e, targetType, targetId, targetParentId) {
    e.preventDefault();
    e.stopPropagation();

    const type     = e.dataTransfer.getData('fv-rail-type');
    const dragId   = e.dataTransfer.getData('fv-rail-id');
    const parentId = e.dataTransfer.getData('fv-rail-parent');

    if (dragId === targetId) return;

    const data = OL.getCurrentProjectData();

    if (type === 'stage' && targetType === 'stage') {
        // Reorder stages
        const stages = data.stages;
        const fromIdx = stages.findIndex(s => s.id === dragId);
        const toIdx   = stages.findIndex(s => s.id === targetId);
        if (fromIdx === -1 || toIdx === -1) return;
        const [moved] = stages.splice(fromIdx, 1);
        stages.splice(toIdx, 0, moved);
    } 
    else if (type === 'workflow' && targetType === 'workflow') {
        // Reorder workflows within same stage
        if (parentId !== targetParentId) {
            // Move workflow to different stage
            const wf = data.workflows.find(w => w.id === dragId);
            if (wf) wf.stageId = targetParentId;
        }
        const workflows = data.workflows.filter(w => w.stageId === (targetParentId || parentId));
        const fromIdx = workflows.findIndex(w => w.id === dragId);
        const toIdx   = workflows.findIndex(w => w.id === targetId);
        if (fromIdx === -1 || toIdx === -1) return;
        // Apply reorder to the main array
        const allWfs = data.workflows;
        const fromGlobal = allWfs.findIndex(w => w.id === dragId);
        const toGlobal   = allWfs.findIndex(w => w.id === targetId);
        const [moved] = allWfs.splice(fromGlobal, 1);
        allWfs.splice(toGlobal, 0, moved);
    }

    OL.persist();
    OL.renderVisualizer();
};

OL._fvLaneDragOver = function(e) {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    const lane = e.currentTarget;
    lane.style.background = 'rgba(61,217,197,0.06)';
    lane.style.outline = '2px dashed #3dd9c5';
    lane.style.outlineOffset = '-4px';
};

OL._fvLaneDragLeave = function(e) {
    e.stopPropagation();
    const lane = e.currentTarget;
    if (!lane.contains(e.relatedTarget)) {
        lane.style.background = '';
        lane.style.outline = '';
    }
};

OL._fvLaneDrop = function(event, stageId, wfId) {
    event.preventDefault();
    event.stopPropagation();

    // Clear highlights
    document.querySelectorAll('.fv-swimlane').forEach(el => {
        el.style.background = '';
        el.style.outline = '';
    });

    // Try both data keys — canvas cards use application/fv-resource,
    // workbench items also use application/fv-resource
    const resId = event.dataTransfer.getData('application/fv-resource') ||
                  event.dataTransfer.getData('text/plain');

    if (!resId) { console.warn('No resId in drop'); return; }

    const data = OL.getCurrentProjectData();
    const res  = (data.resources||[]).find(r => String(r.id) === String(resId));
    if (!res) { console.warn('Resource not found:', resId); return; }

    const wrap       = document.getElementById('fv-canvas-wrap');
    const scrollTop  = wrap?.scrollTop  || 0;
    const scrollLeft = wrap?.scrollLeft || 0;

    // Assign stage
    res.stageId = stageId;

    // Assign workflow
    if (wfId && wfId !== 'null') {
        OL.addResourceToWorkflow(wfId, resId);
    } else {
        // Dropped on unassigned — remove from any existing workflow
        const prevWf = (data.workflows||[]).find(w =>
            (w.resourceIds||[]).includes(String(resId))
        );
        if (prevWf) OL.removeResourceFromWorkflow(prevWf.id, resId);
    }

    OL.persist();
    OL.renderVisualizer();

    requestAnimationFrame(() => {
        const newWrap = document.getElementById('fv-canvas-wrap');
        if (newWrap) {
            newWrap.scrollTop  = scrollTop;
            newWrap.scrollLeft = scrollLeft;
        }
    });
};

OL._fvComputeLayout = function(resources, stageFilter) {
  const allSteps = [];
  const stepMap  = {};

  const workflows = OL.getWorkflows() || [];
  const orderedIds = workflows.flatMap(w => w.resourceIds || []);

  const sortedResources = [
    ...orderedIds
        .map(id => resources.find(r => String(r.id) === String(id)))
        .filter(Boolean),
    ...resources.filter(r => !orderedIds.map(String).includes(String(r.id)))
  ];

  sortedResources.forEach(res => {
    if (stageFilter && res.stageId !== stageFilter) return;
    (res.steps || []).forEach((step, idx) => {
      const fullId = `${res.id}-${step.id}`;
      const entry  = { step, res, fullId, col: -1, row: -1 };
      allSteps.push(entry);
      stepMap[fullId] = entry;
    });
  });
    
  if (allSteps.length === 0) return;

  // Build adjacency from logic.out
  const outEdges = {}; // fullId → [fullId]
  const inDegree = {}; // fullId → count
  allSteps.forEach(e => {
    outEdges[e.fullId] = [];
    inDegree[e.fullId] = 0;
  });

  allSteps.forEach(({ step, res }) => {
    const fromId = `${res.id}-${step.id}`;
    OL._fvGetEffectiveOut(step, res).forEach(out => {
      if (!out.targetId) return;
      const lastH = String(out.targetId).lastIndexOf('-');
      if (lastH === -1) return;
      const tResId  = out.targetId.substring(0, lastH);
      const tStepId = out.targetId.substring(lastH + 1);
      // Find matching step
      const toEntry = allSteps.find(e =>
        String(e.res.id) === String(tResId) &&
        String(e.step.id) === String(tStepId)
      );
      if (toEntry && outEdges[fromId]) {
        outEdges[fromId].push(toEntry.fullId);
        inDegree[toEntry.fullId] = (inDegree[toEntry.fullId] || 0) + 1;
      }
    });
  });

  // Kahn's algorithm — assign columns (depth layers)
  const queue = allSteps
    .filter(e => (inDegree[e.fullId] || 0) === 0)
    .map(e => ({ id: e.fullId, col: 0 }));

  const visited = new Set();
  while (queue.length > 0) {
    const { id, col } = queue.shift();
    if (visited.has(id)) continue;
    visited.add(id);
    const entry = stepMap[id];
    if (entry) entry.col = Math.max(entry.col, col);
    (outEdges[id] || []).forEach(toId => {
      queue.push({ id: toId, col: col + 1 });
    });
  }

  // Any steps not reached (disconnected) get their own columns
  // grouped by resource
  let maxCol = Math.max(...allSteps.map(e => e.col), 0);
  const resColMap = {};
  allSteps.forEach(e => {
    if (e.col === -1) {
      if (resColMap[e.res.id] === undefined) {
        resColMap[e.res.id] = ++maxCol;
      }
      e.col = resColMap[e.res.id];
    }
  });
    
  // Assign rows within each column
  const colRows = {};
  allSteps
      .sort((a, b) => {
          if (a.col !== b.col) return a.col - b.col;
          if (a.res.id !== b.res.id) return String(a.res.id).localeCompare(String(b.res.id));
          return (a.res.steps||[]).indexOf(a.step) - (b.res.steps||[]).indexOf(b.step);
      })
      .forEach(e => {
          const key = String(e.col);
          if (colRows[key] === undefined) colRows[key] = 0;
          e.row = colRows[key]++;
      });

  // Convert col/row to pixel coords
  const COL_W = 200; // horizontal spacing between columns
  const ROW_H = 200; // vertical spacing between rows
  const PAD_X = 60;
  const PAD_Y = 60;

  allSteps.forEach(({ step, col, row }) => {
    // Only update if not pinned
    if (!step.pinned) {
      step.coords = {
        x: PAD_X + col * COL_W,
        y: PAD_Y + row * ROW_H,
      };
    }
  });
};

OL.getLucideSVG = function(name, size = 12, color = 'currentColor') {
    const icons = {
        'zap':        `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
        'file-text':  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>`,
        'mail':       `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>`,
        'calendar':   `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
        'book-open':  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>`,
        'pen-tool':   `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 19 7-7 3 3-7 7-3-3z"/><path d="m18 13-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="m2 2 7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>`,
        'folder':     `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,
        'table-2':    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/></svg>`,
        'link-2':     `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 7h3a5 5 0 0 1 5 5 5 5 0 0 1-5 5h-3m-6 0H6a5 5 0 0 1-5-5 5 5 0 0 1 5-5h3"/><line x1="8" y1="12" x2="16" y2="12"/></svg>`,
        'settings':   `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
        'globe':      `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
        'clipboard-list': `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><line x1="12" y1="11" x2="16" y2="11"/><line x1="12" y1="16" x2="16" y2="16"/><line x1="8" y1="11" x2="8.01" y2="11"/><line x1="8" y1="16" x2="8.01" y2="16"/></svg>`,
        'chevron-up':   `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>`,
        'chevron-down': `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`,
        'user':         `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
        'users':        `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
        'smartphone':   `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>`,
        'target':       `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>`,
        'database':     `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>`,
        'archive':      `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>`,
        'corner-right-up': `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="10 9 15 4 20 9"/><path d="M4 20h7a4 4 0 0 0 4-4V4"/></svg>`,
        'circle-dollar-sign': `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 18V6"/></svg>`,
    };
    return icons[name] || icons['settings'];
};

// ── CARD BUILDER (shared between regular + expanded globals) ──
OL._fvBuildCard = function(res, num, isGlobal, globalStageCount) {
  const tc = OL._fvGetType(res.type);
  const stepCount = (res.steps || []).length;
  const hasLogic = (res.steps || []).some(s => (s.logic?.out || []).some(l => l.targetId));
  const isExpanded = OL._fv.stepsExpanded || OL._fv._expandedCards?.has(res.id);
    
  const tags = (res.steps || []).slice(0, 2)
    .map(s => `<span class="fv-card-tag">${esc((s.name||'').substring(0,16))}</span>`)
    .join('');
    
  const relTypeConfig = {
    triggers:   '#f59e0b',
    requires:   '#38bdf8',
    produces:   '#10b981',
    references: '#a78bfa',
  };

  const linkedAssets = (res.steps || [])
    .flatMap(s => s.links || [])
    .filter((l, i, arr) => arr.findIndex(x => x.id === l.id) === i);

  const assetIconsHtml = linkedAssets.length > 0 ? `
    <div style="display:flex; gap:4px; flex-wrap:wrap; margin-top:6px;">
        ${linkedAssets.map(link => {
            const color = relTypeConfig[link.relType] || 'var(--accent)';
            return `
                <div title="${esc(link.relType ? link.relType + ': ' : '')}${esc(link.name)}"
                     onclick="event.stopPropagation(); OL.openInspector('${link.id}', null, 'cards')"
                     style="width:22px; height:22px; border-radius:4px; cursor:pointer;
                            background:${color}18; border:1px solid ${color}44;
                            display:flex; align-items:center; justify-content:center;
                            transition:all 0.15s;"
                     onmouseover="this.style.borderColor='${color}'; this.style.background='${color}30';"
                     onmouseout="this.style.borderColor='${color}44'; this.style.background='${color}18';">
                    ${OL.getLucideSVG(OL.getRegistryIcon(link.type), 12, color)}
                </div>
            `;
        }).join('')}
    </div>
  ` : '';
    
  const logicTypes = new Set((res.steps || []).flatMap(s => 
    (s.logic?.out || []).filter(l => l.targetId).map(l => l.type || 'next')
  ));
  const logicBadge = logicTypes.size === 0 ? '' :
    logicTypes.has('loop')      ? '↺' :
    logicTypes.has('delay')     ? '⏱' :
    logicTypes.has('condition') ? '◆' :
    logicTypes.size > 0          ? '→' : '';

  const stepsPreview = (isExpanded && stepCount > 0) ? `
    <div class="fv-card-steps-preview">
      ${(res.steps || []).map((s, i) => {
        const appLabel  = s.appName
          ? `<span class="fv-card-step-app">${esc(s.appName.substring(0,10))}</span>`
          : '';
        const stepOut = (s.logic?.out || []).filter(l => l.targetId);
        const stepLogicIcon = stepOut.length === 0 ? '' :
            stepOut.some(l => l.type === 'loop')      ? '↺' :
            stepOut.some(l => l.type === 'delay')     ? '⏱' :
            stepOut.some(l => l.type === 'condition') ? '◆' :
            stepOut.length > 1                         ? '◆' : '→';
        const logicIcon = stepLogicIcon 
          ? `<span style="color:var(--accent);font-size:9px;font-weight:700;">${stepLogicIcon}</span>` 
          : '';
        return `
          <div class="fv-card-step-row"
               onclick="event.stopPropagation(); OL.openInspector('${res.id}','${s.id}');">
            <span class="fv-card-step-num-sm">${i+1}</span>
            <span class="fv-card-step-name">${esc(s.name || 'Unnamed')}</span>
            ${appLabel}
            ${logicIcon}
          </div>
        `;
      }).join('')}
    </div>
  ` : '';

  const scopeData = OL.isResourceInScope(res.id);
  const scopeColors = {
      'Do Now':    '#38bdf8',
      'Done':      '#22c55e', 
      'Do Later':  '#fbbf24',
      "Don't Do":  '#ef4444'
  };
  const scopeColor = scopeData ? (scopeColors[scopeData.status] || 'var(--accent)') : null;

  const renderAsGlobalCard = isGlobal === true || res.isGlobal === true;
    
  return `
    <div class="fv-card ${renderAsGlobalCard ? 'is-global' : ''}"
         id="fv-card-${res.id}-${res.workflowId || 'unassigned'}"
         data-res-id="${res.id}"
         data-stage-id="${res.stageId || '__none__'}"
         data-workflow-id="${res.workflowId || ''}"
         draggable="true"
         ondragstart="OL._fvCardDragStart(event, '${res.id}')"
         ondragend="OL._fvCardDragEnd(event)"
         onclick="event.stopPropagation();
                  document.querySelectorAll('.fv-card.selected').forEach(e=>e.classList.remove('selected'));
                  this.classList.add('selected');
                  OL._fvOpenStepsList('${res.id}');">

      <div class="fv-card-accent" style="background:${tc.color};"></div>

      <div class="fv-card-body">
        <div class="fv-card-type-row">
          <div class="fv-card-type-icon" style="background:${tc.color};">
                ${OL.getLucideSVG(OL.getRegistryIcon(res.type), 11, 'var(--panel)')}
            </div>
          <span class="fv-card-type-label" style="color:${tc.color};">${esc(res.type||'General')}</span>
          <span class="fv-card-step-num">${num}</span>
        </div>
        <div class="fv-card-name">${esc(res.name)}</div>
        ${tags ? `<div class="fv-card-tags" style="margin-bottom:4px;">${tags}</div>` : ''}
        ${assetIconsHtml}
      </div>

      <div class="fv-card-footer">
            <span class="fv-step-count-btn"
                  onclick="event.stopPropagation(); OL._fvToggleCardSteps('${res.id}');"
                  title="Toggle steps">
                ${OL.getLucideSVG(isExpanded ? 'chevron-up' : 'chevron-down', 10, 'currentColor')}
                ${stepCount} step${stepCount!==1?'s':''}
            </span>
            <div style="display:flex;gap:4px;align-items:center;">
                ${scopeColor ? `
                    <div title="${esc(scopeData.status)} · ${esc(scopeData.responsibleParty || 'TBD')}"
                         onclick="event.stopPropagation(); 
                                  state.scopingFilterActive = true; 
                                  state.scopingTargetId = '${res.id}';
                                  window.location.hash = '#/scoping-sheet';"
                         style="display:flex; align-items:center; justify-content:center;
                                width:18px; height:18px; border-radius:4px; cursor:pointer;
                                background:${scopeColor}18; border:1px solid ${scopeColor}44;
                                transition:all 0.15s;"
                         onmouseover="this.style.borderColor='${scopeColor}'; this.style.background='${scopeColor}30';"
                         onmouseout="this.style.borderColor='${scopeColor}44'; this.style.background='${scopeColor}18';">
                        ${OL.getLucideSVG('circle-dollar-sign', 10, scopeColor)}
                    </div>
                ` : ''}
                ${renderAsGlobalCard ? `<span class="fv-global-card-badge">🌐 ×${globalStageCount}</span>` : ''}
                    <button onclick="event.stopPropagation();
                                     OL.handleResourceSave('${res.id}','isGlobal',${!renderAsGlobalCard});
                                     OL.renderVisualizer();"
                            title="${renderAsGlobalCard ? 'Remove global' : 'Set as global'}"
                            style="width:18px;height:18px;border:none;background:none;cursor:pointer;
                                   display:flex;align-items:center;justify-content:center;border-radius:4px;
                                   color:${renderAsGlobalCard ? '#7c3aed' : 'var(--text-muted)'};transition:color 0.15s;"
                            onmouseover="this.style.color='#7c3aed'"
                            onmouseout="this.style.color='${renderAsGlobalCard ? '#7c3aed' : '#d1d5db'}'">
                        ${OL.getLucideSVG('globe', 10, renderAsGlobalCard ? '#7c3aed' : 'var(--text-muted)')}
                    </button>
                ${logicBadge ? `
                    <span style="font-size:9px;padding:2px 5px;border-radius:99px;
                                 background:var(--accent-glow);color:var(--accent);
                                 font-weight:700;">${logicBadge}</span>
                ` : ''}
            </div>
        </div>
      ${stepsPreview}
    </div>
  `;
};

OL._fvCardDragStart = function(e, resId) {
    if (!e || !e.dataTransfer) return;

    // 🎯 Captures the exact, unique card element instance sitting under your mouse cursor
    const cardElement = e.target.closest('.fv-card');
    
    // Read the true workflow lane context string straight out of the HTML dataset we stamped
    const contextWfId = cardElement ? (cardElement.getAttribute('data-workflow-id') || '') : '';

    // Bind data layers to the drag event payload securely
    e.dataTransfer.clearData();
    e.dataTransfer.setData('text/plain', String(resId));
    e.dataTransfer.setData('application/fv-resource', String(resId));
    e.dataTransfer.setData('application/fv-source', 'canvas'); 
    
    // 🚀 THE FIX: This transfers the correct container context to the workbench drop area cleanly!
    e.dataTransfer.setData('application/fv-context-wf', String(contextWfId));
    e.dataTransfer.effectAllowed = 'move';

    // Apply visual fade classes targeting the correct clicked instance copy
    requestAnimationFrame(() => {
        if (cardElement) cardElement.classList.add('fv-dragging');
    });

    OL._fv._draggingResId = resId;
    OL._fv._draggingContextWfId = contextWfId;
    console.log(`🧲 Drag started for resource ${resId} out of lane context: "${contextWfId}"`);
};

OL._fvCardDragEnd = function(e) {
    // 🎯 THE FIX: Query via class selectors so it doesn't crash on multi-instance global cards!
    document.querySelectorAll('.fv-card.fv-dragging').forEach(el => {
        el.classList.remove('fv-dragging');
    });

    OL._fv._draggingResId = null;
    OL._fv._draggingContextWfId = null;

    // Clear all swimlane tracking styles safely
    document.querySelectorAll('.fv-swimlane').forEach(el => {
        if (el && el.style) {
            el.style.background = '';
            el.style.outline = '';
        }
    });
};

OL._fvToggleCardSteps = function(resId) {
  if (!OL._fv._expandedCards) OL._fv._expandedCards = new Set();

  if (OL._fv._expandedCards.has(resId)) {
    OL._fv._expandedCards.delete(resId);
  } else {
    OL._fv._expandedCards.add(resId);
  }

  // Surgical re-render of just this card
  const data = OL.getCurrentProjectData();
  const resources = (data.resources || []).filter(r => !r.isDeleted && !r.isLocked  && (OL._fv.showArchived || !r.isArchived));
  const res = resources.find(r => String(r.id) === resId);
  if (!res) return;

  const cardEl = document.getElementById(`fv-card-${resId}`);
  if (!cardEl) return;

  const isExpanded = OL._fv._expandedCards.has(resId);
  const tc = OL._fvGetType(res.type);

  // Just update the steps preview section
  let preview = cardEl.querySelector('.fv-card-steps-preview');
  if (isExpanded && (res.steps || []).length > 0) {
    if (!preview) {
      preview = document.createElement('div');
      preview.className = 'fv-card-steps-preview';
      cardEl.querySelector('.fv-card-body').appendChild(preview);
    }
    preview.innerHTML = (res.steps || []).map((s, i) => {
      const appLabel  = s.appName ? `<span class="fv-card-step-app">${esc(s.appName.substring(0,10))}</span>` : '';
      const logicIcon = (s.logic?.out||[]).some(l=>l.targetId)
        ? `<span style="color:#3dd9c5;font-size:9px;font-weight:700;">λ</span>` : '';
      return `
        <div class="fv-card-step-row"
             onclick="event.stopPropagation(); OL.openInspector('${res.id}','${s.id}');">
          <span class="fv-card-step-num-sm">${i+1}</span>
          <span class="fv-card-step-name">${esc(s.name||'Unnamed')}</span>
          ${appLabel}${logicIcon}
        </div>
      `;
    }).join('');
  } else if (preview) {
    preview.remove();
  }

  // Update chevron
  const countBtn = cardEl.querySelector('.fv-step-count-btn');
  if (countBtn) {
    const icon = countBtn.querySelector('i');
    if (icon) {
      icon.setAttribute('data-lucide', isExpanded ? 'chevron-up' : 'chevron-down');
      if (window.lucide) lucide.createIcons();
    }
  }

  // Re-sync rail heights since card height changed
  OL._fvSyncRailHeights();
};

OL._fvRenderSteps = function(resources) {
  const canvas    = document.getElementById('fv-content');
  const svg       = document.getElementById('fv-svg-layer');
  const data      = OL.getCurrentProjectData();
  const stages    = data.stages || [];
  const wfAll     = OL.getWorkflows() || [];
  const STEP_GAP  = 14;

  if (!canvas || !svg) return;
  canvas.innerHTML = '';

  // Persist which consolidated cards are open across re-renders
  if (!OL._fv.expandedGroups) OL._fv.expandedGroups = new Set();

  const stageFilter = OL._fv.stageFilter || '';

  // ── Stage → Workflow → Resources (unassigned resources not shown) ────────────
  const stageGroups = [];
  stages.forEach(stage => {
    if (stageFilter && String(stage.id) !== String(stageFilter)) return;
    const stageWfs = wfAll.filter(w => String(w.stageId) === String(stage.id));
    const wfGroups = [];
    stageWfs.forEach(wf => {
      const wfRes = (wf.resourceIds || [])
        .map(id => resources.find(r => String(r.id) === String(id)))
        .filter(r => r && !r.isGlobal && (r.steps || []).length > 0);
      if (wfRes.length > 0) wfGroups.push({ workflow: wf, resources: wfRes });
    });
    if (wfGroups.length > 0) stageGroups.push({ stage, wfGroups });
  });

  OL._fvAutoLinkSteps(resources);

  const CARD_W    = 180;
  const COL_GAP   = 52;
  const ZONE_PAD  = 20;
  const ZONE_HDR  = 22;   // stage label height
  const WF_PAD    = 14;   // padding inside workflow sub-zone
  const WF_HDR    = 26;   // workflow sub-zone label height
  const RES_HDR   = 28;   // resource column header height
  const STAGE_GAP = 48;
  const WF_GAP    = 20;
  const PAD_X     = 48;
  const PAD_Y     = 36;
  const EST_STEP  = 100;
  const CONSOL_H  = 44;   // estimated collapsed consolidated card height

  const allActiveResources = [];
  const stageMeta = [];
  let currentY = PAD_Y;

  // ── Helper: build merged flow sequence for a workflow group ──────────────────
  // Returns [{type:'columns', sections:[{res,steps:[]}]}, {type:'consolidated', groupName, members:[{res,step}]}, ...]
  function buildMergedFlow(wfRes) {
    // Find consolidated groups (stepGroup appearing in >1 resource)
    const groupMap = {};
    wfRes.forEach(res => {
      (res.steps || []).forEach(step => {
        if (!step.stepGroup) return;
        if (!groupMap[step.stepGroup]) groupMap[step.stepGroup] = [];
        groupMap[step.stepGroup].push({ res, step });
      });
    });
    const consolidatedGroups = {};
    Object.entries(groupMap).forEach(([g, members]) => {
      if (members.length > 1) consolidatedGroups[g] = members;
    });
    const consolidatedIds = new Set(
      Object.values(consolidatedGroups).flat().map(m => String(m.step.id))
    );

    if (Object.keys(consolidatedGroups).length === 0) {
      // No consolidation — single columns section
      return {
        consolidatedGroups,
        sequence: [{ type: 'columns', sections: wfRes.map(res => ({ res, steps: res.steps || [] })) }]
      };
    }

    // Build per-resource annotated flow
    const perResFlow = wfRes.map(res => {
      const flow = [];
      const seenGroups = new Set();
      (res.steps || []).forEach(step => {
        if (consolidatedIds.has(String(step.id))) {
          const g = Object.entries(consolidatedGroups).find(([, ms]) =>
            ms.some(m => String(m.step.id) === String(step.id))
          )?.[0];
          if (g && !seenGroups.has(g)) { seenGroups.add(g); flow.push({ type: 'consolidated', group: g }); }
        } else {
          flow.push({ type: 'step', step });
        }
      });
      return flow;
    });

    // Determine group ordering by min position across resources
    const groupOrder = Object.keys(consolidatedGroups).sort((a, b) => {
      const posA = Math.min(...perResFlow.map(f => { const i = f.findIndex(x => x.type === 'consolidated' && x.group === a); return i === -1 ? Infinity : i; }));
      const posB = Math.min(...perResFlow.map(f => { const i = f.findIndex(x => x.type === 'consolidated' && x.group === b); return i === -1 ? Infinity : i; }));
      return posA - posB;
    });

    // Build merged sequence
    const sequence = [];
    const ptrs = wfRes.map(() => 0);

    groupOrder.forEach(group => {
      // Collect steps before this group from each resource
      const sections = wfRes.map((res, ri) => {
        const steps = [];
        while (ptrs[ri] < perResFlow[ri].length &&
               !(perResFlow[ri][ptrs[ri]].type === 'consolidated' && perResFlow[ri][ptrs[ri]].group === group)) {
          if (perResFlow[ri][ptrs[ri]].type === 'step') steps.push(perResFlow[ri][ptrs[ri]].step);
          ptrs[ri]++;
        }
        if (ptrs[ri] < perResFlow[ri].length) ptrs[ri]++; // skip the group marker
        return { res, steps };
      });
      if (sections.some(s => s.steps.length > 0)) sequence.push({ type: 'columns', sections });
      sequence.push({ type: 'consolidated', groupName: group, members: consolidatedGroups[group] });
    });

    // Remaining steps after last group
    const trailing = wfRes.map((res, ri) => {
      const steps = [];
      while (ptrs[ri] < perResFlow[ri].length) {
        if (perResFlow[ri][ptrs[ri]].type === 'step') steps.push(perResFlow[ri][ptrs[ri]].step);
        ptrs[ri]++;
      }
      return { res, steps };
    });
    if (trailing.some(s => s.steps.length > 0)) sequence.push({ type: 'columns', sections: trailing });

    return { consolidatedGroups, sequence };
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  stageGroups.forEach(({ stage, wfGroups }) => {
    const stageTop = currentY;
    let stageBgEl = null, stageLblEl = null;

    if (stage) {
      stageBgEl = document.createElement('div');
      stageBgEl.style.cssText = `position:absolute;left:${PAD_X - 16}px;top:${stageTop}px;
        width:200px;height:100px;border-radius:14px;
        background:rgba(255,255,255,0.016);border:1px solid rgba(255,255,255,0.05);
        pointer-events:none;`;
      canvas.appendChild(stageBgEl);

      stageLblEl = document.createElement('div');
      stageLblEl.style.cssText = `position:absolute;left:${PAD_X}px;top:${stageTop + 10}px;
        font-size:8px;font-weight:800;letter-spacing:0.11em;text-transform:uppercase;
        color:var(--text-muted);opacity:0.4;white-space:nowrap;overflow:hidden;
        text-overflow:ellipsis;max-width:260px;cursor:default;`;
      stageLblEl.textContent = stage.name;
      stageLblEl.title = stage.name;
      canvas.appendChild(stageLblEl);
    }

    const stageContentTop = stageTop + ZONE_PAD + (stage ? ZONE_HDR : 0);
    let wfY = stageContentTop;
    const wfMetaList = [];

    wfGroups.forEach(({ workflow, resources: wfRes }) => {
      const { sequence } = buildMergedFlow(wfRes);

      // Compute x positions for each resource
      const resLayouts = new Map();
      const resBaseX   = new Map();
      let cumX = PAD_X;
      wfRes.forEach(r => {
        const rLayout = OL._fvLayoutResource(r);
        resLayouts.set(r, rLayout);
        resBaseX.set(r, cumX);
        const maxOff = Math.max(0, ...Object.values(rLayout).map(l => l.colOffset));
        cumX += (1 + maxOff) * (CARD_W + COL_GAP);
      });
      const wfWidth = Math.max(cumX - PAD_X - COL_GAP + 28, 60);
      const wfRight = PAD_X + wfWidth;

      // Workflow sub-zone background
      const wfBgEl = document.createElement('div');
      wfBgEl.style.cssText = `position:absolute;left:${PAD_X - 10}px;top:${wfY}px;
        width:${wfWidth + 4}px;height:100px;border-radius:10px;
        background:rgba(255,255,255,0.01);border:1px solid rgba(255,255,255,0.038);
        pointer-events:none;`;
      canvas.appendChild(wfBgEl);

      const wfLblEl = document.createElement('div');
      wfLblEl.style.cssText = `position:absolute;left:${PAD_X}px;top:${wfY + 9}px;
        font-size:9px;font-weight:700;letter-spacing:0.07em;text-transform:uppercase;
        color:var(--accent);opacity:0.55;white-space:nowrap;overflow:hidden;
        text-overflow:ellipsis;max-width:${wfWidth - 10}px;cursor:default;`;
      wfLblEl.textContent = workflow.name;
      wfLblEl.title = workflow.name;
      canvas.appendChild(wfLblEl);

      const wfContentTop = wfY + WF_PAD + WF_HDR;

      // Resource headers
      const resMeta = [];
      wfRes.forEach(res => {
        allActiveResources.push(res);
        const tc   = OL._fvGetType(res.type);
        const colX = resBaseX.get(res);
        const hdrEl = document.createElement('div');
        hdrEl.style.cssText = `position:absolute;left:${colX}px;top:${wfContentTop + 2}px;
          width:${CARD_W}px;display:flex;align-items:center;gap:5px;`;
        hdrEl.innerHTML = `
          <div style="width:7px;height:7px;border-radius:50%;background:${tc.color};flex-shrink:0;"></div>
          <span title="${esc(res.name)}"
                style="font-size:10px;font-weight:700;color:${tc.color};text-transform:uppercase;
                       letter-spacing:0.06em;white-space:nowrap;overflow:hidden;
                       text-overflow:ellipsis;max-width:${CARD_W - 20}px;">${esc(res.name)}</span>`;
        canvas.appendChild(hdrEl);
        resMeta.push({ res, hdrEl, layout: resLayouts.get(res), colX });
      });

      const colY0 = wfContentTop + RES_HDR;

      // Render each sequence item
      const seqMeta = []; // for measurement pass
      let estY = colY0;

      sequence.forEach((item, seqIdx) => {
        if (item.type === 'columns') {
          const sectionCards = [];
          item.sections.forEach(({ res, steps }) => {
            const tc     = OL._fvGetType(res.type);
            const layout = resLayouts.get(res);
            const colX   = resBaseX.get(res);
            steps.forEach((step, idx) => {
              const li = layout[step.id] || { colOffset: 0, row: idx };
              const x  = colX + li.colOffset * (CARD_W + COL_GAP);
              const y  = estY + idx * (EST_STEP + STEP_GAP);
              step.coords = { x, y };

              const appBadge = step.appName
                ? `<span class="fv-step-badge" style="background:var(--accent-glow);color:var(--accent);">${esc(step.appName.substring(0,12))}</span>`
                : '';
              const assigneeBadges = (step.assignees || []).slice(0, 2).map(a =>
                `<span class="fv-step-badge" style="background:rgba(255,255,255,0.06);color:var(--text-dim);">${esc((a.name||'').substring(0,12))}</span>`
              ).join('');
              const groupTag = step.stepGroup
                ? `<span class="fv-step-group-tag">${esc(step.stepGroup)}</span>`
                : '';

              const div = document.createElement('div');
              div.className = 'fv-step-card';
              div.id = `fv-step-${res.id}-${step.id}`;
              div.dataset.resId  = res.id;
              div.dataset.stepId = step.id;
              div.style.left = x + 'px';
              div.style.top  = y + 'px';
              div.innerHTML = `
                <button class="fv-pin-btn ${step.pinned?'pinned':''}" title="${step.pinned?'Unpin':'Pin'}"
                        onclick="event.stopPropagation();OL._fvTogglePin('${res.id}','${step.id}')">
                  ${OL.getLucideSVG(step.pinned?'pin':'pin-off',10,'currentColor')}
                </button>
                <div class="fv-step-card-accent" style="background:${tc.color};"></div>
                <div class="fv-step-card-body" onclick="event.stopPropagation();OL._fvSelectStep('${res.id}','${step.id}')">
                  <div style="display:flex;align-items:flex-start;gap:7px;">
                    <span style="flex-shrink:0;width:18px;height:18px;border-radius:50%;
                                 background:${tc.color}22;color:${tc.color};border:1px solid ${tc.color}44;
                                 font-size:9px;font-weight:800;display:flex;
                                 align-items:center;justify-content:center;margin-top:1px;">${idx+1}</span>
                    <div style="min-width:0;flex:1;">
                      <div class="fv-step-name">${esc(step.name||'Unnamed Step')}</div>
                      <div class="fv-step-badges" style="margin-top:4px;">${appBadge}${assigneeBadges}${groupTag}</div>
                    </div>
                  </div>
                </div>
                <div class="fv-port fv-port-top"    id="port-top-${res.id}-${step.id}"
                     onmousedown="event.stopPropagation();OL._fvStartConnection(event,'${res.id}','${step.id}','top')"></div>
                <div class="fv-port fv-port-bottom" id="port-bottom-${res.id}-${step.id}"
                     onmousedown="event.stopPropagation();OL._fvStartConnection(event,'${res.id}','${step.id}','bottom')"></div>
                <div class="fv-port fv-port-left"   id="port-left-${res.id}-${step.id}"
                     onmousedown="event.stopPropagation();OL._fvStartConnection(event,'${res.id}','${step.id}','left')"></div>
                <div class="fv-port fv-port-right"  id="port-right-${res.id}-${step.id}"
                     onmousedown="event.stopPropagation();OL._fvStartConnection(event,'${res.id}','${step.id}','right')"></div>`;
              OL._fvSetupCardDrag(div, res.id, step.id);
              canvas.appendChild(div);
              sectionCards.push({ res, step, el: div, idx });
            });
          });
          const estH = Math.max(...item.sections.map(s => s.steps.length), 1) * (EST_STEP + STEP_GAP);
          seqMeta.push({ type: 'columns', sectionCards, estH });
          estY += estH;

        } else if (item.type === 'consolidated') {
          const { groupName, members } = item;
          // Center a standard-width card under the member resource columns
          const memberResources = [...new Set(members.map(m => m.res))];
          const memberXs = memberResources.map(r => resBaseX.get(r)).filter(x => x !== undefined);
          const spanLeft  = memberXs.length ? Math.min(...memberXs) : PAD_X;
          const spanRight = memberXs.length ? Math.max(...memberXs) + CARD_W : PAD_X + wfWidth;
          const consolCenterX = (spanLeft + spanRight) / 2;
          const cardW   = CARD_W;
          const cardX   = Math.round(consolCenterX - cardW / 2);
          const cardY   = estY;

          // Use first member's type color and step name — all members share the same step
          const consolTc   = OL._fvGetType(members[0].res.type);
          const consolName = members[0].step.name || 'Unnamed Step';
          const consolApp  = members[0].step.appName || '';

          const consolEl = document.createElement('div');
          consolEl.className = 'fv-step-card';
          consolEl.id = `fv-consol-${String(groupName).replace(/\W+/g,'-')}`;
          consolEl.style.cssText = `left:${cardX}px;top:${cardY}px;width:${cardW}px;`;
          const isExpanded = OL._fv.expandedGroups.has(groupName);
          consolEl.innerHTML = `
            <div class="fv-step-card-accent" style="background:${consolTc.color};"></div>
            <div class="fv-step-card-body fv-consol-header" data-group="${esc(groupName)}"
                 onclick="OL._fvToggleConsolidated(this)" style="cursor:pointer;">
              <div style="display:flex;align-items:flex-start;gap:7px;">
                <span style="flex-shrink:0;width:18px;height:18px;border-radius:50%;
                             background:${consolTc.color}22;color:${consolTc.color};
                             border:1px solid ${consolTc.color}44;
                             font-size:9px;display:flex;align-items:center;
                             justify-content:center;margin-top:1px;">
                  ${OL.getLucideSVG('git-merge',9,'currentColor')}
                </span>
                <div style="min-width:0;flex:1;">
                  <div class="fv-step-name">${esc(consolName)}</div>
                  <div class="fv-step-badges" style="margin-top:4px;">
                    ${consolApp ? `<span class="fv-step-badge" style="background:var(--accent-glow);color:var(--accent);">${esc(consolApp.substring(0,12))}</span>` : ''}
                    <span class="fv-step-badge" style="background:${consolTc.color}22;color:${consolTc.color};">×${members.length}</span>
                    ${OL.getLucideSVG(isExpanded ? 'chevron-up' : 'chevron-down',10,'var(--text-muted)')}
                  </div>
                </div>
              </div>
            </div>
            <div class="fv-consol-body" style="display:${isExpanded ? 'flex' : 'none'};">
              ${members.map(m => {
                const tc = OL._fvGetType(m.res.type);
                const appBadge = m.step.appName
                  ? `<span class="fv-step-badge" style="background:var(--accent-glow);color:var(--accent);margin-top:4px;">${esc(m.step.appName.substring(0,14))}</span>`
                  : '';
                return `<div class="fv-consol-instance" style="cursor:pointer;"
                            onclick="event.stopPropagation();OL._fvSelectStep('${m.res.id}','${m.step.id}')">
                  <div style="font-size:9px;font-weight:700;color:${tc.color};text-transform:uppercase;letter-spacing:0.04em;margin-bottom:3px;">${esc(m.res.name)}</div>
                  <div style="font-size:11px;color:var(--text-main);line-height:1.3;">${esc(m.step.name||'Unnamed Step')}</div>
                  ${appBadge}
                </div>`;
              }).join('')}
            </div>`;
          canvas.appendChild(consolEl);

          // Invisible anchor divs so _fvDrawStepConnections can find consolidated member steps.
          // data-consol-card-id lets drawConnections use the real card rect when this is the SOURCE.
          const consolAnchors = [];
          members.forEach(m => {
            const anchor = document.createElement('div');
            anchor.id = `fv-step-${m.res.id}-${m.step.id}`;
            anchor.dataset.consolCardId = consolEl.id;
            anchor.style.cssText = `position:absolute;left:${Math.round(consolCenterX - 1)}px;top:${cardY}px;width:2px;height:1px;pointer-events:none;opacity:0;`;
            canvas.appendChild(anchor);
            consolAnchors.push(anchor);
          });

          members.forEach(m => { m.step.coords = { x: cardX, y: cardY }; });
          seqMeta.push({ type: 'consolidated', el: consolEl, members, cardX, cardW, consolCenterX, estH: CONSOL_H, anchors: consolAnchors });
          estY += CONSOL_H + STEP_GAP;
        }
      });

      const estWfH = WF_PAD + WF_HDR + RES_HDR + estY - colY0 + WF_PAD;
      wfMetaList.push({ wfBgEl, wfLblEl, resMeta, seqMeta, wfContentTop, colY0, wfWidth });
      wfY += estWfH + WF_GAP;
    });

    stageMeta.push({ stageBgEl, stageLblEl, stage, stageTop, wfMetaList });
    currentY = wfY + STAGE_GAP;
  });

  // ── Measurement pass ─────────────────────────────────────────────────────────
  requestAnimationFrame(() => {
    let curStageY = PAD_Y;

    stageMeta.forEach(({ stageBgEl, stageLblEl, stage, stageTop, wfMetaList }) => {
      if (stageLblEl) stageLblEl.style.top = (curStageY + 10) + 'px';
      if (stageBgEl)  stageBgEl.style.top  = curStageY + 'px';

      let wfY = curStageY + ZONE_PAD + (stage ? ZONE_HDR : 0);
      let stageBottom = wfY;

      wfMetaList.forEach(({ wfBgEl, wfLblEl, resMeta, seqMeta, wfContentTop, colY0, wfWidth }) => {
        const wfTop     = wfY;
        const actualColY = wfTop + WF_PAD + WF_HDR + RES_HDR;

        if (wfLblEl) wfLblEl.style.top = (wfTop + 9) + 'px';
        if (wfBgEl)  wfBgEl.style.top  = wfTop + 'px';
        resMeta.forEach(({ hdrEl }) => { hdrEl.style.top = (wfTop + WF_PAD + WF_HDR + 2) + 'px'; });

        let y = actualColY;
        let wfBottom = actualColY;

        seqMeta.forEach(item => {
          if (item.type === 'columns') {
            // Group cards by resource
            const byRes = new Map();
            item.sectionCards.forEach(sc => {
              if (!byRes.has(sc.res)) byRes.set(sc.res, []);
              byRes.get(sc.res).push(sc);
            });

            // Build lookup: 'resId-stepId' → card, for steps in this section only
            const cardByKey = new Map();
            item.sectionCards.forEach(sc => {
              cardByKey.set(`${sc.res.id}-${sc.step.id}`, sc);
            });

            // Pass 1: compute natural (independent) Y for each card via simple stacking
            const naturalTopY = new Map(); // el → top Y from simple stacking
            byRes.forEach(cards => {
              let ry = y;
              cards.forEach(({ el }) => { naturalTopY.set(el, ry); ry += el.offsetHeight + STEP_GAP; });
            });

            // Pass 2: for each cross-resource outbound link within this section,
            // record the minimum Y (source bottom) the target card must sit at
            const minY = new Map(); // el → minimum allowed top Y
            item.sectionCards.forEach(sc => {
              (sc.step.logic?.out || []).forEach(link => {
                if (!link.targetId || link._implicit) return;
                const targetCard = cardByKey.get(String(link.targetId));
                if (!targetCard || targetCard.res === sc.res) return; // same resource, skip
                const srcBottom = naturalTopY.get(sc.el) + sc.el.offsetHeight;
                const prev = minY.get(targetCard.el) || 0;
                minY.set(targetCard.el, Math.max(prev, srcBottom));
              });
            });

            // Pass 3: position each column, honouring minY constraints as steps are stacked
            let maxBottom = y;
            byRes.forEach(cards => {
              let ry = y;
              cards.forEach(({ step, el }) => {
                const constraint = minY.get(el);
                if (constraint !== undefined && constraint > ry) ry = constraint;
                if (!step.pinned) { el.style.top = ry + 'px'; step.coords.y = ry; }
                ry += el.offsetHeight + STEP_GAP;
              });
              maxBottom = Math.max(maxBottom, ry - STEP_GAP);
            });

            y = maxBottom + STEP_GAP;
            wfBottom = Math.max(wfBottom, maxBottom);

          } else if (item.type === 'consolidated') {
            item.el.style.top = y + 'px';
            // Keep anchor divs aligned to top-center of card for arrow targeting
            item.anchors.forEach(anchor => {
              anchor.style.top  = y + 'px';
              anchor.style.left = Math.round(item.consolCenterX - 1) + 'px';
            });
            item.members.forEach(m => { m.step.coords.y = y; });
            y += item.el.offsetHeight + STEP_GAP * 2;
            wfBottom = Math.max(wfBottom, y - STEP_GAP);
          }
        });

        const actualWfH = wfBottom - wfTop + WF_PAD * 2;
        if (wfBgEl) wfBgEl.style.height = actualWfH + 'px';
        stageBottom = Math.max(stageBottom, wfBottom + WF_PAD * 2);
        wfY = wfTop + actualWfH + WF_GAP;
      });

      const actualStageH = stageBottom - curStageY + ZONE_PAD;
      if (stageBgEl) {
        stageBgEl.style.height = actualStageH + 'px';
        // Width: widest workflow
        const maxWfW = Math.max(...wfMetaList.map(w => w.wfWidth), 100);
        stageBgEl.style.width = (maxWfW + 20) + 'px';
      }
      curStageY += actualStageH + STAGE_GAP;
    });

    const allCards = Array.from(canvas.querySelectorAll('.fv-step-card'));
    const maxX = Math.max(...allCards.map(el => (parseFloat(el.style.left)||0) + (parseFloat(el.style.width)||CARD_W)), 800);
    const maxY = Math.max(...allCards.map(el => (parseFloat(el.style.top)||0) + el.offsetHeight + 60), 600);
    canvas.style.width  = (maxX + PAD_X) + 'px';
    canvas.style.height = maxY + 'px';

    OL._fvDrawStepConnections(allActiveResources);
  });
};

OL._fvToggleConsolidated = function(headerEl) {
  const groupName = headerEl.dataset.group;
  if (!groupName) return;
  if (!OL._fv.expandedGroups) OL._fv.expandedGroups = new Set();
  if (OL._fv.expandedGroups.has(groupName)) {
    OL._fv.expandedGroups.delete(groupName);
  } else {
    OL._fv.expandedGroups.add(groupName);
  }
  // Re-render so the measurement pass uses the correct expanded card height
  // and repositions all cards below it correctly
  OL.renderVisualizer();
};

// Set or clear a step's consolidation group
OL._fvSetStepGroup = function(resId, stepId, groupName) {
  const data = OL.getCurrentProjectData();
  const res  = (data.localResources || data.resources || []).find(r => String(r.id) === String(resId));
  if (!res) return;
  const step = (res.steps || []).find(s => String(s.id) === String(stepId));
  if (!step) return;
  step.stepGroup = groupName ? groupName.trim() : undefined;
  OL.persist();
  OL.renderVisualizer();
};

// Draw connections between step cards
OL._fvDrawStepConnections = function(resources) {
  const svg    = document.getElementById('fv-svg-layer');
  const canvas = document.getElementById('fv-content');
  if (!svg || !canvas) return;

  const cRect = canvas.getBoundingClientRect();

  svg.innerHTML = `
    <defs>
      <marker id="fv-arr" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
        <path d="M0,0 L8,3 L0,6 Z" fill="#3dd9c5"/>
      </marker>
      <marker id="fv-arr-no" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
        <path d="M0,0 L8,3 L0,6 Z" fill="#d4472a"/>
      </marker>
    </defs>
    <g id="fv-lines"></g>
  `;

  svg.style.width  = canvas.style.width;
  svg.style.height = canvas.style.height;

  if (!OL._fv.showConnections) return;

  const group = document.getElementById('fv-lines');

  resources.forEach(sourceRes => {
    (sourceRes.steps || []).forEach((sourceStep, sourceIdx) => {
      OL._fvGetEffectiveOut(sourceStep, sourceRes).forEach(outRule => {
        if (!outRule.targetId) return;

        // Skip implicit synthetic fallbacks — real links drawn below
        if (outRule._implicit) return;

        const lastH = String(outRule.targetId).lastIndexOf('-');
        if (lastH === -1) return;
        const tResId  = outRule.targetId.substring(0, lastH);
        const tStepId = outRule.targetId.substring(lastH + 1);

        const fromElRaw = document.getElementById(`fv-step-${sourceRes.id}-${sourceStep.id}`);
        // If fromEl is a consolidated anchor (tiny proxy div), use the real card for exit coords
        const fromEl = (fromElRaw?.dataset.consolCardId && document.getElementById(fromElRaw.dataset.consolCardId)) || fromElRaw;
        const toEl   = document.getElementById(
          `fv-step-${tResId}-${tStepId}` ||
          // fallback: find by resId + step index if id-based lookup fails
          Array.from(document.querySelectorAll(`[data-res-id="${tResId}"]`))
            .find(el => el.dataset.stepId === tStepId)?.id
        );

        if (!fromEl || !toEl) return;

        const fRect = fromEl.getBoundingClientRect();
        const tRect = toEl.getBoundingClientRect();

        // Determine best anchor based on relative positions
        const fx_center = fRect.left - cRect.left + fRect.width / 2;
        const fy_center = fRect.top  - cRect.top  + fRect.height / 2;
        const tx_center = tRect.left - cRect.left  + tRect.width / 2;
        const ty_center = tRect.top  - cRect.top   + tRect.height / 2;

        const dx = tx_center - fx_center;
        const dy = ty_center - fy_center;
        const isCrossResource = String(tResId) !== String(sourceRes.id);

        let fx, fy, tx, ty, isVert;
        if (isCrossResource) {
          // Cross-resource: always exit from bottom or right (never top/left) to read as "forward"
          if (dx > 0) {
            // Target is to the right — exit right, enter left
            fx = fRect.right - cRect.left; fy = fy_center;
            tx = tRect.left  - cRect.left; ty = ty_center;
            isVert = false;
          } else {
            // Target is below (or same column) — exit bottom, enter top
            fx = fx_center; fy = fRect.bottom - cRect.top;
            tx = tx_center; ty = tRect.top    - cRect.top;
            isVert = true;
          }
        } else if (Math.abs(dy) >= Math.abs(dx)) {
          // Same resource, primarily vertical
          if (dy > 0) {
            fx = fx_center; fy = fRect.bottom - cRect.top;
            tx = tx_center; ty = tRect.top    - cRect.top;
          } else {
            fx = fx_center; fy = fRect.top    - cRect.top;
            tx = tx_center; ty = tRect.bottom - cRect.top;
          }
          isVert = true;
        } else {
          // Same resource, primarily horizontal
          if (dx > 0) {
            fx = fRect.right - cRect.left; fy = fy_center;
            tx = tRect.left  - cRect.left; ty = ty_center;
          } else {
            fx = fRect.left  - cRect.left; fy = fy_center;
            tx = tRect.right - cRect.left; ty = ty_center;
          }
          isVert = false;
        }

        const tension = Math.max(50, Math.abs(isVert ? dy : dx) * 0.4);
        const cp1x = isVert ? fx : fx + (dx > 0 ?  tension : -tension);
        const cp1y = isVert ? fy + (dy > 0 ?  tension : -tension) : fy;
        const cp2x = isVert ? tx : tx + (dx > 0 ? -tension :  tension);
        const cp2y = isVert ? ty + (dy > 0 ? -tension :  tension) : ty;

        const d = `M ${fx} ${fy} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${tx} ${ty}`;

        const isNo   = outRule.type === 'no' || outRule.rule?.toLowerCase().includes('no');
        const isLoop     = outRule.type === 'loop';
        const isImplicit = !!outRule._implicit;
        const color      = isImplicit ? '#3dd9c5' : isLoop ? '#f5b800' : isNo ? '#d4472a' : '#3dd9c5';

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', d);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', color);
        path.setAttribute('stroke-width', isImplicit ? '1' : '1.5');
        path.setAttribute('stroke-opacity', isImplicit ? '0.3' : '0.7');
        path.setAttribute('marker-end', isNo ? 'url(#fv-arr-no)' : 'url(#fv-arr)');
        if (isImplicit) path.setAttribute('stroke-dasharray', '4,4');
        else if (isNo || isLoop) path.setAttribute('stroke-dasharray', '5,3');
        group.appendChild(path);

        // Logic icon on line midpoint (implicit links get no icon)
        const hasRule  = !isImplicit && outRule.rule?.trim();
        const hasDelay = !isImplicit && (outRule.type === 'delay' || parseInt(outRule.delayValue) > 0);
        const iconChar = isLoop ? '↺' : hasDelay ? '⏱' : hasRule ? 'λ' : null;

        if (iconChar) {
          // Find midpoint of bezier curve
          const mx = (fx + tx) / 2;
          const my = (fy + ty) / 2;

          const bg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          bg.setAttribute('cx', mx); bg.setAttribute('cy', my); bg.setAttribute('r', '10');
          bg.setAttribute('fill', '#fff');
          bg.setAttribute('stroke', color); bg.setAttribute('stroke-width', '1.5');
          group.appendChild(bg);

          const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          txt.setAttribute('x', mx); txt.setAttribute('y', my + 4);
          txt.setAttribute('text-anchor', 'middle');
          txt.setAttribute('font-size', iconChar === 'λ' ? '11' : '10');
          txt.setAttribute('font-weight', '700');
          txt.setAttribute('fill', color);
          txt.setAttribute('font-family', 'DM Sans, sans-serif');
          txt.setAttribute('pointer-events', 'none');
          txt.textContent = iconChar;
          group.appendChild(txt);

          // Tooltip on hover showing the rule/delay
          if (hasRule || hasDelay) {
            const label = hasDelay
              ? `⏱ ${outRule.delayValue || '?'} ${outRule.delayUnit || 'days'}`
              : outRule.rule;
            bg.setAttribute('title', label);
            bg.style.cursor = 'help';
          }
        }
      });
    });
  });
};

OL._fvSetupCardDrag = function(el, resId, stepId) {
  let startX, startY, startLeft, startTop, hasMoved = false;

  el.addEventListener('mousedown', e => {
    // Don't drag if clicking interactive elements
    if (e.target.closest('.fv-pin-btn, .fv-res-tidy-btn, .fv-port, .fv-step-card-body')) return;
    e.preventDefault();
    e.stopPropagation();

    startX    = e.clientX;
    startY    = e.clientY;
    startLeft = parseFloat(el.style.left) || 0;
    startTop  = parseFloat(el.style.top)  || 0;
    hasMoved  = false;

    const zoom = OL._fv.zoom || 1;

    const onMove = e => {
      const dx = (e.clientX - startX) / zoom;
      const dy = (e.clientY - startY) / zoom;

      if (!hasMoved && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
        hasMoved = true;
        el.classList.add('is-dragging');
      }
      if (!hasMoved) return;

      let newX = startLeft + dx;
      let newY = startTop  + dy;

      // Snap to grid
      if (OL._fv.snapToGrid) {
        const g = OL._fv.gridSize || 20;
        newX = Math.round(newX / g) * g;
        newY = Math.round(newY / g) * g;
      }

      newX = Math.max(0, newX);
      newY = Math.max(0, newY);

      el.style.left = newX + 'px';
      el.style.top  = newY + 'px';

      // Redraw connections live
      const data = OL.getCurrentProjectData();
      const resources = (data.resources||[]).filter(r=>!r.isDeleted&&!r.isLocked);
      OL._fvDrawStepConnections(resources);
    };

    const onUp = async () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup',   onUp);
      el.classList.remove('is-dragging');

      if (!hasMoved) return;

      // Save coords and auto-pin
      const data = OL.getCurrentProjectData();
      const res  = (data.resources||[]).find(r => String(r.id) === String(resId));
      const step = res?.steps?.find(s => String(s.id) === String(stepId));

      if (step) {
        step.coords = {
          x: parseFloat(el.style.left) || 0,
          y: parseFloat(el.style.top)  || 0,
        };
        step.pinned = true; // Auto-pin on first drag
        el.classList.add('is-pinned');

        // Update pin button
        const pinBtn = el.querySelector('.fv-pin-btn');
        if (pinBtn) {
          pinBtn.classList.add('pinned');
          pinBtn.title = 'Unpin (allow auto-layout)';
          pinBtn.innerHTML = '<i data-lucide="pin"></i>';
          if (window.lucide) lucide.createIcons();
        }

        await OL.persist();
      }
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup',   onUp);
  });
};

// ── STAGE NAME EDITING ────────────────────────────────────
OL._fvEditStageName = function(stageId, name) {
    const data  = OL.getCurrentProjectData();
    const stage = (data.stages || []).find(s => String(s.id) === String(stageId));
    if (!stage) return;

    if (name && name.trim()) {
        // Called from contenteditable onblur — just save
        stage.name = name.trim();
        OL.persist();
        // No re-render needed — contenteditable already shows the new name
    } else if (!name) {
        // Called from pencil button — show prompt
        const newName = prompt('Stage name:', stage.name);
        if (!newName?.trim()) return;
        stage.name = newName.trim();
        OL.persist();
        OL.renderVisualizer();
    }
};

// ── JUMP TO LANE ─────────────────────────────────────────
OL._fvJumpToLane = function(stageId) {
  const lane = document.getElementById(`fv-lane-${stageId}`);
  if (!lane) return;
  lane.scrollIntoView({ behavior: 'smooth', block: 'start' });
  // Flash highlight
  lane.style.transition = 'background 0.2s';
  lane.style.background = 'rgba(61,217,197,0.08)';
  setTimeout(() => { lane.style.background = ''; }, 1200);
};

// Sync rail label heights to their matching swimlane
OL._fvSyncRailHeights = function() {
  requestAnimationFrame(() => {
    const data = OL.getCurrentProjectData();
    const stages = [
      ...(data.stages || []),
      { id: '__none__', name: 'Unassigned' }
    ];

    stages.forEach(stage => {
      const lane = document.getElementById(`fv-lane-${stage.id}`);
      const rail = document.getElementById(`fv-rail-${stage.id}`);
      if (lane && rail) {
        // +1 for the border-bottom
        const h = lane.offsetHeight + 1;
        rail.style.height    = h + 'px';
        rail.style.minHeight = h + 'px';
      }
    });

    // Draw connections after heights settle
    const resources = (data.resources || [])
      .filter(r => !r.isDeleted && !r.isLocked);
    OL._fvDrawConnections(resources);

    if (window.lucide) lucide.createIcons();
  });
};

// Draw SVG connection lines
OL._fvDrawConnections = function(resources) {
  const svg    = document.getElementById('fv-svg-layer');
  const canvas = document.getElementById('fv-canvas');
  if (!svg || !canvas) return;

  svg.innerHTML = `
    <defs>
      <marker id="fv-arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
        <path d="M0,0 L8,3 L0,6 Z" fill="#3dd9c5" opacity="0.9"/>
      </marker>
      <marker id="fv-arrow-cross" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
        <path d="M0,0 L8,3 L0,6 Z" fill="#d4472a" opacity="0.8"/>
      </marker>
      <marker id="fv-arrow-global" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
        <path d="M0,0 L8,3 L0,6 Z" fill="#7c3aed" opacity="0.8"/>
      </marker>
    </defs>
    <g id="fv-lines"></g>
  `;

  if (!OL._fv.showConnections) return;

  svg.setAttribute('width',  canvas.scrollWidth  || 2000);
  svg.setAttribute('height', canvas.scrollHeight || 2000);
  svg.style.width  = (canvas.scrollWidth  || 2000) + 'px';
  svg.style.height = (canvas.scrollHeight || 2000) + 'px';

  const group = document.getElementById('fv-lines');
  const canvasRect = canvas.getBoundingClientRect();
  const globalIds = new Set(
    (resources || []).filter(r => r.isGlobal).map(r => String(r.id))
  );

  (resources || []).forEach(sourceRes => {
    (sourceRes.steps || []).forEach(step => {
      (step.logic?.out || []).forEach(outRule => {
        if (!outRule.targetId) return;

        const lastH = String(outRule.targetId).lastIndexOf('-');
        if (lastH === -1) return;
        const targetResId = outRule.targetId.substring(0, lastH);
        if (targetResId === String(sourceRes.id)) return; // skip same-card

        const fromEl = document.getElementById(`fv-card-${sourceRes.id}`);
        const toEl   = document.getElementById(`fv-card-${targetResId}`);
        if (!fromEl || !toEl) return;

        const fRect = fromEl.getBoundingClientRect();
        const tRect = toEl.getBoundingClientRect();

        const fx = fRect.left - canvasRect.left + fRect.width / 2;
        const fy = fRect.top  - canvasRect.top  + fRect.height;
        const tx = tRect.left - canvasRect.left  + tRect.width / 2;
        const ty = tRect.top  - canvasRect.top;

        const isGlobalLink = globalIds.has(String(sourceRes.id)) || globalIds.has(targetResId);
        const isCross = fromEl.dataset.stageId !== toEl.dataset.stageId;
        const isLoop  = outRule.type === 'loop';

        const color  = isGlobalLink ? '#7c3aed' : isLoop ? '#f5b800' : isCross ? '#d4472a' : '#3dd9c5';
        const marker = isGlobalLink ? 'url(#fv-arrow-global)' : isCross ? 'url(#fv-arrow-cross)' : 'url(#fv-arrow)';
        const tension = Math.max(40, Math.abs(ty - fy) * 0.45);

        const d = isCross
          ? `M ${fx} ${fy} C ${fx} ${fy+tension}, ${tx} ${ty-tension}, ${tx} ${ty}`
          : `M ${fx} ${fy-fRect.height/2} C ${fx+60} ${fy-fRect.height/2}, ${tx-60} ${ty+tRect.height/2}, ${tx} ${ty+tRect.height/2}`;

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', d);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', color);
        path.setAttribute('stroke-width', '1.5');
        path.setAttribute('stroke-opacity', '0.6');
        path.setAttribute('marker-end', marker);
        path.setAttribute('data-from', sourceRes.id);
        path.setAttribute('data-to', targetResId);
        if (isCross || isGlobalLink) path.setAttribute('stroke-dasharray', '5,3');
        group.appendChild(path);
      });
    });
  });
};

// Highlight global connections on hover
OL._fvHighlightGlobalConnections = function(resId, on) {
  document.querySelectorAll(`[data-from="${resId}"], [data-to="${resId}"]`).forEach(path => {
    path.setAttribute('stroke-opacity', on ? '1' : '0.6');
    path.setAttribute('stroke-width',   on ? '2.5' : '1.5');
  });
  document.querySelectorAll('.fv-card').forEach(card => {
    const id = card.dataset.resId;
    const isConnected = document.querySelector(`[data-from="${resId}"][data-to="${id}"], [data-from="${id}"][data-to="${resId}"]`);
    if (id !== resId) {
      card.classList.toggle('global-hover', on && !!isConnected);
      card.classList.toggle('dimmed', on && !isConnected);
    }
  });
};

// TIDY FUNCTIONS

OL._fvTidy = async function(scope, resourceId) {
  const data      = OL.getCurrentProjectData();
  const resources = (data.resources||[]).filter(r=>!r.isDeleted&&!r.isLocked);

  if (scope === 'global') {
    resources.forEach(res => {
      (res.steps||[]).forEach(step => {
        if (!step.pinned) step.coords = null;
      });
    });
  } else if (scope === 'force') {
    resources.forEach(res => {
      (res.steps||[]).forEach(step => {
        step.pinned = false;
        step.coords = null;
      });
    });
  } else if (scope === 'stage') {
    const stageId = resourceId;
    resources
      .filter(r => r.stageId === stageId)
      .forEach(res => {
        (res.steps||[]).forEach(step => {
          if (!step.pinned) step.coords = null;
        });
      });
  } else if (scope === 'resource') {
    const res = resources.find(r => String(r.id) === String(resourceId));
    if (res) {
      (res.steps||[]).forEach(step => {
        step.pinned = false;
        step.coords = null;
      });
    }
  }

  OL._fvNormalizeStepCoords();
  OL._fvComputeLayout(resources, OL._fv.stageFilter);
  await OL.persist();
  OL.renderVisualizer();
};

OL._fvShowTidyMenu = function(e) {
  e.stopPropagation();
  const existing = document.getElementById('fv-tidy-menu');
  if (existing) { existing.remove(); return; }

  const btn    = e.currentTarget;
  const rect   = btn.getBoundingClientRect();
  const stages = OL.getCurrentProjectData().stages || [];

  const menu = document.createElement('div');
  menu.id = 'fv-tidy-menu';
  menu.style.cssText = `
    position:fixed; top:${rect.bottom+4}px; left:${rect.left}px;
    background:var(--panel); border:1px solid var(--panel-border); border-radius:8px;
    box-shadow:0 4px 16px rgba(0,0,0,0.1); z-index:1000;
    min-width:200px; overflow:hidden;
  `;

  const items = [
    { label: 'Tidy All (respect pinned)', action: `OL._fvTidy('global')` },
    { label: 'Force Tidy All', action: `OL._fvTidy('force')`, danger: true },
    { label: '─────────────────', divider: true },
    ...stages.map(s => ({
      label: `Tidy: ${s.name}`,
      action: `OL._fvTidy('stage','${s.id}')`,
    })),
  ];

  items.forEach(item => {
    if (item.divider) {
      const d = document.createElement('div');
      d.style.cssText = 'padding:4px 12px;font-size:10px;color:var(--line);';
      d.textContent = item.label;
      menu.appendChild(d);
      return;
    }
    const el = document.createElement('div');
    el.style.cssText = `
      padding:9px 14px; font-size:12px; cursor:pointer;
      color:${item.danger ? '#d4472a' : '#374151'};
      transition:background 0.1s;
    `;
    el.textContent = item.label;
    el.onmouseenter = () => el.style.background = '#f5f6f8';
    el.onmouseleave = () => el.style.background = '';
    el.onclick = () => { menu.remove(); eval(item.action); };
    menu.appendChild(el);
  });

  document.body.appendChild(menu);
  setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 10);
};

OL._fvTogglePin = async function(resId, stepId) {
  const data = OL.getCurrentProjectData();
  const res  = (data.resources||[]).find(r => String(r.id) === String(resId));
  const step = res?.steps?.find(s => String(s.id) === String(stepId));
  if (!step) return;

  step.pinned = !step.pinned;
  await OL.persist();

  // Surgical update — just update the pin button without full re-render
  const card = document.getElementById(`fv-step-${resId}-${stepId}`);
  if (card) {
    const btn = card.querySelector('.fv-pin-btn');
    if (btn) {
      btn.classList.toggle('pinned', step.pinned);
      btn.title = step.pinned ? 'Unpin (allow auto-layout)' : 'Pin (manual position)';
      btn.innerHTML = `<i data-lucide="${step.pinned ? 'pin' : 'pin-off'}"></i>`;
      if (window.lucide) lucide.createIcons();
    }
    card.classList.toggle('is-pinned', step.pinned);
  }
};

// WORKBENCH PANEL

OL._fvToggleWb = function(tab) {
  OL._fv._wbTab = OL._fv._wbTab === tab ? null : tab;
    if (state.us) {
        state.ui.sidebarSearchQuery = "";
    }
    if (typeof OL.syncResourceLibraryFilters === 'function') {
        OL.syncResourceLibraryFilters();
    }
  OL.renderVisualizer();
};

OL._fvPopulateWb = function(tab, resources) {
    const content = document.getElementById('fv-wb-content');
    if (!content) return;
    const drawer = document.getElementById('fv-wb-drawer');
    if (drawer) {
        drawer.ondragover = (e) => {
            e.preventDefault();
            drawer.style.background = 'rgba(61,217,197,0.08)';
            drawer.style.borderLeft = '2px solid #3dd9c5';
        };
        drawer.ondragleave = () => {
            drawer.style.background = '';
            drawer.style.borderLeft = '';
        };
        drawer.ondrop = (e) => {
            e.preventDefault();
            drawer.style.background = '';
            drawer.style.borderLeft = '';
            const resId = e.dataTransfer.getData('application/fv-resource') || 
                          e.dataTransfer.getData('text/plain');
            if (resId) OL._fvUnmapResource(resId);
        };
    }

    const client       = getActiveClient();
    const data         = OL.getCurrentProjectData();
    const masterGuides = state.master?.howToLibrary || [];
    const localGuides  = client?.projectData?.localHowTo || [];
    const datapoints   = state.master?.datapoints || [];

    let allItems = [];

    if (tab === 'flows') {
        allItems = resources.filter(r => 
            ['Workflow','Zap','Email Campaign'].includes(r.type) &&
            !r.isArchived && (!r.stageId || r.isGlobal)
        );
    } else if (tab === 'assets') {
        allItems = resources.filter(r => 
            !['Workflow','Zap','Email Campaign'].includes(r.type) &&
            !r.isArchived && (!r.stageId || r.isGlobal)
        );
    } else if (tab === 'guides') {
        // Only show client-facing guides in the workbench
        allItems = [...masterGuides, ...localGuides].filter(g => g.isShared === true);
    } else if (tab === 'data') {
        allItems = datapoints;
    }

    const searchId = `fv-wb-search-${tab}`;
    const listId   = `fv-wb-items-${tab}`;

    content.innerHTML = `
        <div style="padding:8px 8px 4px;">
            <input type="text" id="${searchId}"
                   placeholder="Search..."
                   oninput="OL._fvFilterWb('${tab}')"
                   style="width:100%;padding:6px 8px;border:1px solid rgba(255,255,255,0.1);
                          border-radius:6px;background:rgba(0,0,0,0.2);color:#fff;
                          font-size:11px;outline:none;box-sizing:border-box;font-family:inherit;">
        </div>
        <div id="${listId}">
            ${OL._fvRenderWbItems(allItems, tab)}
        </div>
    `;

    if (window.lucide) lucide.createIcons();
};

OL._fvRenderWbItems = function(items, tab) {
    if (!items.length) return `<div style="padding:20px; text-align:center; color:var(--text-muted); font-size:12px; font-style:italic;">No ${tab} found</div>`;
    
    const data = OL.getCurrentProjectData();
    const resources = data.resources || [];

    return items.map((item, idx) => {
        const tc     = OL._fvGetType(item.type);
        const name   = item.name || item.title || 'Unnamed';
        const isData = tab === 'data';
        
        // 🎯 RENDER LOGIC FOR STAGES TRAY CARDS
        if (tab === 'stages') {
            const stageResCount = resources.filter(r => String(r.stageId) === String(item.id)).length;
            
            return `
                <div class="fv-wb-item fv-stage-sort-row"
                     draggable="true"
                     data-id="${item.id}"
                     data-stage-idx="${idx}"
                     id="stage-sort-row-${item.id}"
                     ondragstart="OL.handleStageSortDragStart(event, ${idx})"
                     ondragover="event.preventDefault(); this.style.borderTop='2px solid var(--accent)';"
                     ondragleave="this.style.borderTop='';"
                     ondrop="OL.handleStageSortDrop(event, ${idx})"
                     style="display:flex; align-items:center; gap:10px; padding:10px 12px; border-bottom:1px solid var(--line); cursor:grab;">
                    
                    <div class="fv-wb-item-icon" style="background:rgba(61,217,197,0.1); color:var(--accent); font-weight:bold; font-size:10px; width:24px; height:24px; border-radius:4px; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                        #${idx + 1}
                    </div>
                    
                    <div class="fv-wb-item-info" style="flex:1; min-width:0;">
                        <input type="text" value="${esc(name)}" 
                               style="background:transparent; border:none; color:white; font-size:12px; font-weight:600; width:100%; outline:none; padding:0; margin:0;"
                               onchange="OL.renameStage('${item.id}', this.value)">
                        <div style="font-size:9px; color:var(--text-muted); margin-top:2px;">
                            ${stageResCount} Resource${stageResCount !== 1 ? 's' : ''}
                        </div>
                    </div>

                    <div style="display:flex; gap:2px; align-items:center; flex-shrink:0;">
                        <button class="btn-icon-tiny" title="Move Up" onclick="event.stopPropagation(); OL.moveStageIndex(${idx}, ${idx - 1})" ${idx === 0 ? 'disabled style="opacity:0.2; cursor:not-allowed;"' : ''}>▲</button>
                        <button class="btn-icon-tiny" title="Move Down" onclick="event.stopPropagation(); OL.moveStageIndex(${idx}, ${idx + 1})" ${idx === items.length - 1 ? 'disabled style="opacity:0.2; cursor:not-allowed;"' : ''}>▼</button>
                        <button onclick="event.stopPropagation(); OL.deleteStage('${item.id}')"
                                style="border:none; background:none; cursor:pointer; color:var(--text-muted); display:flex; align-items:center; justify-content:center; padding:2px; margin-left:4px;">
                            <i data-lucide="trash-2" style="width:12px; height:12px;"></i>
                        </button>
                    </div>
                </div>
            `;
        }

        // Standard return path fallback loops for assets/flows
        return `
            <div class="fv-wb-item"
                 draggable="true"
                 data-id="${item.id}"
                 data-type="${tab}"
                 ondragstart="OL._fvWbDragStart(event,'${item.id}','${tab}')"
                 onclick="OL.openInspector('${item.id}', null, 'cards')"
                 style="cursor:grab;${item.isGlobal ? 'border:1.5px solid #7c3aed;box-shadow:0 0 0 1px rgba(124,58,237,0.15);' : ''}">
                <div class="fv-wb-item-icon"
                     style="background:${isData ? 'rgba(124,58,237,0.1)' : tc.color+'18'};
                            color:${isData ? '#7c3aed' : tc.color};">
                    ${isData ? '🏷' : tc.abbr}
                </div>
                <div class="fv-wb-item-info">
                    <div class="fv-wb-item-name">${esc(name.substring(0,24))}</div>
                    ${!isData ? `<div class="fv-wb-item-type">${esc(item.type||'')}</div>` : ''}
                </div>
               <div style="margin-left:auto;display:flex;align-items:center;gap:4px;">
                    ${item.isGlobal ? OL.getLucideSVG('globe', 10, '#7c3aed') : ''}
                    <span style="color:rgba(255,255,255,0.2);font-size:10px;">⠿</span>
                </div>
            </div>
        `;
    }).join('');
    
    if (window.lucide) lucide.createIcons();
};

OL._fvFilterWb = function(tab) {
    const input = document.getElementById(`fv-wb-search-${tab}`);
    const q = (input?.value || '').toLowerCase().trim();
    const data = OL.getCurrentProjectData();
    const resources = (data.resources || []).filter(r => !r.isDeleted && !r.isLocked);
    const client = getActiveClient();

    let items = [];
    if (tab === 'flows') {
        items = resources.filter(r =>
            ['Workflow','Zap','Email Campaign'].includes(r.type) &&
            !r.isArchived && (!r.stageId || r.isGlobal)
        );
    } else if (tab === 'assets') {
        items = resources.filter(r =>
            !['Workflow','Zap','Email Campaign'].includes(r.type) &&
            !r.isArchived && (!r.stageId || r.isGlobal)
        );
    } else if (tab === 'guides') {
        items = [...(state.master?.howToLibrary || []), ...(client?.projectData?.localHowTo || [])];
    } else if (tab === 'data') {
        items = state.master?.datapoints || [];
    }

    if (q) items = items.filter(i => (i.name || i.title || '').toLowerCase().includes(q));

    const list = document.getElementById(`fv-wb-items-${tab}`);
    if (list) list.innerHTML = OL._fvRenderWbItems(items, tab);
};

OL._fvWbDragStart = function(e, id, type) {
  e.dataTransfer.setData('application/fv-resource', id);
  e.dataTransfer.setData('application/fv-tab', type);
  e.dataTransfer.effectAllowed = 'move';
  // Visual feedback
  e.currentTarget.style.opacity = '0.4';
  e.currentTarget.addEventListener('dragend', () => {
    e.currentTarget.style.opacity = '1';
  }, { once: true });
};

// RAIL SCROLL AND CANVAS CLICK
OL._fvSetupRailScroll = function() {
  const wrap = document.getElementById('fv-canvas-wrap');
  const rail = document.getElementById('fv-lane-rail');
  if (!wrap || !rail) return;

  wrap.addEventListener('scroll', () => {
    rail.scrollTop = wrap.scrollTop;
  }, { passive: true });
};

OL._fvUnmapResource = async function(resId, contextWorkflowId = null) {
    const data = OL.getCurrentProjectData();
    const res = (data.resources || []).find(r => String(r.id) === String(resId));
    if (!res) return;

    console.group(`🧼 Unmapping Resource: ${res.name}`);

    // 🎯 IF WE KNOW EXACTLY WHICH WORKFLOW TRAY IT CAME FROM
    if (contextWorkflowId) {
        const wf = (data.workflows || []).find(w => String(w.id) === String(contextWorkflowId));
        if (wf && wf.resourceIds) {
            wf.resourceIds = wf.resourceIds.filter(id => String(id) !== String(resId));
            console.log(`❌ Removed instance reference from Workflow array: ${contextWorkflowId}`);
        }
    } 
    // 🔍 FALLBACK: If dragged to the sidebar rail and contextWorkflowId wasn't passed,
    // look up which workflow currently holds it under the cursor
    else {
        (data.workflows || []).forEach(wf => {
            if (wf.resourceIds && wf.resourceIds.includes(String(resId))) {
                // If it's global, we only want to drop it from the workflow we are interacting with.
                // For safety in a global drag-to-rail fallback without context, we check if it matches the current view state.
                if (!res.isGlobal || String(wf.id) === String(OL._fv.activeWorkflowId)) {
                    wf.resourceIds = wf.resourceIds.filter(id => String(id) !== String(resId));
                }
            }
        });
    }

    // 🏠 LOCAL MECHANICS ONLY: Global master attributes remain completely untouched!
    if (!res.isGlobal) {
        res.stageId = null;
        res.workflowId = null;
        if (res.coords) delete res.coords;
        console.log("🧹 Local asset wiped clean from root properties.");
    }

    console.groupEnd();

    await OL.persist();
    OL.renderVisualizer();
};

OL._fvHandleCanvasClick = function(e) {
    const isCard      = e.target.closest('.fv-card, .fv-step-card, .fv-list-item, .fv-card-footer, .fv-card-body, .fv-card-steps-preview');
    const isBtn       = e.target.closest('button, select, input, a, textarea, label');
    const isInspector = e.target.closest('#v2-inspector-panel, #inspector-panel');
    const isWb        = e.target.closest('#fv-wb-rail, #fv-wb-drawer');
    const isLaneRail  = e.target.closest('#fv-lane-rail');
    const isTopbar    = e.target.closest('#fv-topbar');

    if (isCard || isBtn || isInspector || isWb || isLaneRail || isTopbar) return;

    document.querySelectorAll('.fv-card.selected, .fv-step-card.selected, .fv-list-item.selected')
        .forEach(el => el.classList.remove('selected'));

    OL.closeInspectorPanel();
};

OL.closeInspectorPanel = function() {
    OL._fv._lastInspectorResId = null;

    const panel = document.getElementById('v2-inspector-panel') || document.getElementById('inspector-panel');
    if (panel) {
        panel.classList.remove('open');
        panel.id = 'inspector-panel';
        panel.style.width = '0';
        panel.style.minWidth = '0';
    }

    const layout = document.querySelector('.three-pane-layout');
    if (layout) {
        const sidebarCollapsed = document.querySelector('.sidebar.collapsed');
        const leftCol = sidebarCollapsed ? '65px' : '240px';
        layout.style.gridTemplateColumns = `${leftCol} 1fr 0px`;
    }
};

OL._fvSelectStep = function(resId, stepId) {
  document.querySelectorAll('.fv-step-card.selected').forEach(el => el.classList.remove('selected'));
  const card = document.getElementById(`fv-step-${resId}-${stepId}`);
  if (card) card.classList.add('selected');
  OL.openInspector(resId, stepId);
};

// ══════════════════════════════════════════════
// LIST VIEW
// ══════════════════════════════════════════════

OL._fvBuildListShell = function(stages, resources) {
    window._fvRenderedStepRegistry = new Set();
    const filter = OL._fv.stageFilter;
    const globalIds = new Set(resources.filter(r => r.isGlobal).map(r => String(r.id)));
    const workflows = OL.getWorkflows() || [];

    const displayStages = [...stages];

    const stagesHtml = displayStages.map((stage, si) => {
        // Handle explicit stage filtering context paths
        if (filter && filter.startsWith('stage-') && stage.id !== filter.replace('stage-', '')) return '';
        
        // Handle specific workflow context paths
        if (filter && !filter.startsWith('stage-') && filter !== '') {
            const activeWf = workflows.find(w => w.id === filter);
            if (!activeWf || activeWf.stageId !== stage.id) return '';
        }

        // Get workflows explicitly tied to this structural stage index lane
        const stageWorkflows = workflows.filter(w => w.stageId === stage.id);
        
        // 🎯 TRACK RENDERED GLOBAL ASSETS
        // Keep a running record of any global resource ID that successfully renders inside an active workflow group
        const globalsRenderedInWorkflows = new Set();

        let stageWorkflowsHtml = '';
        let totalStageStepsCount = 0;

        // 🏢 1. GROUP AND RENDER WORKFLOW BUCKETS UNDER STAGE
        stageWorkflows.forEach(wf => {
            if (filter && !filter.startsWith('stage-') && filter !== '' && wf.id !== filter) return;

            // THE MULTI-INSTANCE BRIDGE:
            const wfResources = (wf.resourceIds || [])
                .map(id => {
                    const found = resources.find(r => String(r.id) === id);
                    if (!found) return null;
                    
                    if (found.isGlobal) {
                        globalsRenderedInWorkflows.add(String(found.id));
                        return {
                            ...found,
                            stageId: stage.id,
                            workflowId: wf.id,
                            isGlobalInstanceCopy: true
                        };
                    }
                    return found;
                })
                .filter(r => r && (OL._fv.showArchived || !r.isArchived));

            if (wfResources.length === 0) return;

            // Map out steps nested directly within this workflow bucket container
            const wfStepsContentHtml = wfResources.map(res => {
                const steps = (res.steps || []).filter(s => OL._fv.showArchived || !s.isArchived);
                totalStageStepsCount += steps.length;
                
                return steps.map((step, idx) => {
                    // 🎯 PASS WORKFLOW CONTEXT IF IT'S A GLOBAL CLONE INSTANCE
                    // This tells the step renderer to append a unique suffix to the HTML IDs 
                    // (e.g., id="step-${step.id}-${wf.id}") so different copies stay isolated.
                    const contextWfId = res.isGlobalInstanceCopy ? wf.id : null;
                    
                    return OL._fvRenderListStep(
                        step, 
                        res, 
                        idx, 
                        globalIds, 
                        resources, 
                        0, 
                        new Set(), 
                        contextWfId // 🚀 Added parameter passing
                    );
                }).join('');
            }).join('');

            stageWorkflowsHtml += `
                <div class="fv-list-workflow-group" 
                     id="fv-workflow-group-${wf.id}" 
                     ondragover="event.preventDefault();"
                     ondrop="OL.handleCanvasDrop(event);"
                     style="margin-top: 12px; margin-bottom: 15px; padding-left: 10px; border-left: 2px solid var(--accent);">
                     
                    <div style="display:flex; align-items:center; gap:6px; margin-bottom:10px; opacity:0.7;">
                        <i data-lucide="workflow" style="width:12px; height:12px; color:var(--accent);"></i>
                        <span style="font-size:11px; font-weight:700; text-transform:uppercase; color:var(--text-muted); letter-spacing:0.05em;">
                            Process: ${esc(wf.name)}
                        </span>
                    </div>
                    ${wfStepsContentHtml}
                </div>
            `;
        });
        
        // 🏢 2. RENDER UNASSIGNED COMPONENT CORES UNDER STAGE
        // 🎯 THE SURGICAL DE-DUPLICATION FILTER
        // A resource qualifies for the fallback bottom tray if it belongs to this stage,
        // is NOT assigned to a local workflow sequence, and has NOT already been rendered as a global instance copy.
        const assignedResIds = new Set(stageWorkflows.flatMap(w => w.resourceIds || []));
        const unassignedResources = resources.filter(r => 
            r.stageId === stage.id && 
            !assignedResIds.has(String(r.id)) && 
            !globalsRenderedInWorkflows.has(String(r.id))
        );

        if (unassignedResources.length > 0 && (!filter || filter.startsWith('stage-'))) {
            const unassignedStepsContentHtml = unassignedResources.map(res => {
                const steps = (res.steps || []).filter(s => OL._fv.showArchived || !s.isArchived);
                totalStageStepsCount += steps.length;
                
                return steps.map((step, idx) => 
                    OL._fvRenderListStep(step, res, idx, globalIds, resources, 0, new Set())
                ).join('');
            }).join('');

            stageWorkflowsHtml += `
                <div class="fv-list-workflow-group unassigned" style="margin-top: 12px; margin-bottom: 15px; padding-left: 10px; border-left: 2px dashed #6b7280;">
                    <div style="display:flex; align-items:center; gap:6px; margin-bottom:10px; opacity:0.5;">
                        <i data-lucide="help-circle" style="width:12px; height:12px;"></i>
                        <span style="font-size:11px; font-weight:700; text-transform:uppercase; color:var(--text-muted); letter-spacing:0.05em;">
                            Unassigned Resources
                        </span>
                    </div>
                    ${unassignedStepsContentHtml}
                </div>
            `;
        }

        if (totalStageStepsCount === 0) return '';

        return `
            <div style="display:flex; align-items:center; gap:8px; padding:4px 0;">
                <button class="fv-btn" style="padding:2px 8px; font-size:10px; opacity:0.5;" onclick="OL.addStageBetween(${si})">
                    <i data-lucide="plus" style="width:10px; height:10px;"></i> Add Stage
                </button>
                <div style="flex:1; height:1px; background:var(--line);"></div>
            </div>
            <div class="fv-list-stage" id="fv-list-stage-${stage.id}">
                <div class="fv-list-stage-header" style="display:flex; align-items:center; gap:10px; background:var(--panel-soft); padding:8px 12px; border-radius:6px;">
                    <div class="fv-list-stage-num" style="background:var(--accent); color:black; font-weight:bold; width:20px; height:20px; border-radius:4px; display:flex; align-items:center; justify-content:center; font-size:11px;">${si + 1}</div>
                    <div class="fv-list-stage-name" style="font-weight:bold; font-size:14px; color:var(--text-main);">${esc(stage.name)}</div>
                    <div class="fv-list-stage-line" style="flex:1; height:1px; background:var(--line); margin:0 10px;"></div>
                    <div class="fv-list-stage-count" style="font-size:11px; color:var(--text-muted); font-weight:500;">${totalStageStepsCount} steps</div>
                    
                    <button class="fv-btn" style="padding:3px 8px; font-size:10px;"
                            onclick="document.querySelectorAll('#fv-list-stage-${stage.id} [id^=fv-substeps-]').forEach(el=>el.style.display='none');
                                     document.querySelectorAll('#fv-list-stage-${stage.id} .fv-substep-toggle').forEach(b=>b.textContent='+');">
                        Collapse
                    </button>
                    <button class="fv-btn" style="padding:3px 8px; font-size:10px;"
                            onclick="document.querySelectorAll('#fv-list-stage-${stage.id} [id^=fv-substeps-]').forEach(el=>el.style.display='block');
                                     document.querySelectorAll('#fv-list-stage-${stage.id} .fv-substep-toggle').forEach(b=>b.textContent='-');">
                        Expand
                    </button>
                </div>
                <div style="padding:5px 0 15px 0;">
                    ${stageWorkflowsHtml}
                </div>
            </div>
        `;
    }).join('');

    return `
        <div id="fv-list-wrap" onclick="OL._fvHandleCanvasClick(event)" style="padding:20px; max-height:100%; overflow-y:auto;">
            ${stagesHtml || `
                <div class="fv-loading-state" style="text-align:center; padding:100px; opacity:0.5;">
                    <i data-lucide="inbox" style="width:32px; height:32px; margin-bottom:10px;"></i>
                    <div>No stages or steps found. Assign resources to workflows to generate data fields.</div>
                </div>`}
        </div>
    `;
};

OL._fvOpenStepsList = function(resId) {
  OL._fv._lastInspectorResId = resId;
  const data   = OL.getCurrentProjectData();
  const res    = (data.resources||[]).find(r => String(r.id) === resId);
  if (!res) return;

  // Ensure correct panel ID in visualizer context
  const rawPanel = document.getElementById('inspector-panel');
  if (rawPanel && !document.getElementById('v2-inspector-panel')) {
      rawPanel.id = 'v2-inspector-panel';
  }
  const panel = document.getElementById('v2-inspector-panel');
  if (!panel) return;

  // Always get content RELATIVE to panel to avoid stale references
  let content = panel.querySelector('#inspector-content');
  if (!content) {
      const scrollWrap = panel.querySelector('.inspector-scroll-content');
      if (scrollWrap) {
          content = document.createElement('div');
          content.id = 'inspector-content';
          scrollWrap.innerHTML = '';
          scrollWrap.appendChild(content);
      }
  }
  if (!content) return;

  content.innerHTML = '';
    console.group('🔍 Inspector Debug');
    console.log('resId:', resId);
    console.log('res found:', !!res);
    console.log('panel el:', panel);
    console.log('panel.id:', panel?.id);
    console.log('panel has open class:', panel?.classList.contains('open'));
    console.log('panel width:', panel?.style.width);
    console.log('panel offsetWidth:', panel?.offsetWidth);
    console.log('content el:', content);
    console.log('content parent:', content?.parentElement);
    console.log('content in DOM:', document.contains(content));
    console.log('panel in DOM:', document.contains(panel));
    console.groupEnd();

  panel.classList.add('open');
    panel.style.width = '';
  panel.style.minWidth = '';

  const layout = document.querySelector('.three-pane-layout');
  if (layout) {
      const sidebarCollapsed = document.querySelector('.sidebar.collapsed');
      const leftCol = sidebarCollapsed ? '65px' : '240px';
      layout.style.gridTemplateColumns = `${leftCol} 1fr 380px`;
  }

  const tc     = OL._fvGetType(res.type);
  const stages = data.stages || [];
  const client = getActiveClient();

  if (!OL._fv._stepsOpen) OL._fv._stepsOpen = {};
  if (OL._fv._stepsOpen[resId] === undefined) OL._fv._stepsOpen[resId] = true;
  const stepsOpen = OL._fv._stepsOpen[resId];
  const stageName = stages.find(s => s.id === res.stageId)?.name || '';

  // ── APP SECTION ──────────────────────────────────────
  const rawType    = String(res.type || 'General');
  const typeDef    = (state.master?.resourceTypes||[])
    .find(t => t.type.toLowerCase() === rawType.toLowerCase());
  const isZap      = rawType.toLowerCase() === 'zap';
  const autoApp    = (!isZap && typeDef?.matchedFunctionId)
    ? OL.getAppByFunction?.(rawType) : null;

  const appSection = isZap
    ? `<div class="fvi-value muted">Multi-app automation.</div>`
    : res.appId
      ? `<div style="display:flex;align-items:center;gap:6px;">
           <div style="display:flex;align-items:center;gap:6px;flex:1;
                       padding:7px 10px;border:1px solid var(--panel-border);
                       border-radius:8px;background:var(--panel-soft);">
             <span style="font-size:12px;font-weight:500;color:var(--text-main);">
               ${esc(res.appName||'')}
             </span>
           </div>
           <button onclick="OL.handleResourceSave('${res.id}','appId',null);
                            OL.handleResourceSave('${res.id}','appName',null);"
                   style="padding:7px;border:1px solid var(--panel-border);border-radius:8px;
                          background:var(--panel);cursor:pointer;color:var(--text-muted);
                          transition:color 0.15s;">
             <i data-lucide="x" style="width:12px;height:12px;"></i>
           </button>
         </div>`
      : `<div style="position:relative;">
           <input type="text" class="fvi-input"
                  placeholder="Search apps…"
                  onfocus="OL.filterAppSearch('${res.id}',null,true,'')"
                  oninput="OL.filterAppSearch('${res.id}',null,true,this.value)">
           <div id="res-app-results" class="search-results-overlay"></div>
         </div>`;

  // ── STEPS LIST ───────────────────────────────────────
  const stepsList = (res.steps||[]).length > 0
    ? (res.steps).map((s, i) => {
        const assigneeBadges = (s.assignees||[]).map(a =>
          `<span class="fvi-badge fvi-badge-gray">${esc(a.name||'')}</span>`
        ).join('');
        const appBadge = s.appName
          ? `<span class="fvi-badge fvi-badge-blue">${esc(s.appName)}</span>`
          : '';
        const stepOut = (s.logic?.out || []).filter(l => l.targetId);
        const icons = [];
        if (stepOut.some(l => l.type === 'loop'))      icons.push('↺');
        if (stepOut.some(l => l.type === 'delay'))     icons.push('⏱');
        if (stepOut.some(l => l.type === 'condition') || stepOut.length > 1) icons.push('◆');
        else if (stepOut.length === 1 && !icons.length) icons.push('→');
        const logicIcon = icons.map(ic =>
            `<span class="fvi-badge" style="background:var(--accent-glow);color:var(--accent);">${ic}</span>`
        ).join('');
        const hasBadges = s.appName || (s.assignees||[]).length > 0 || icons.length > 0;

        return `
          <div class="fvi-step-row v2-step-item"
               draggable="true"
               ondragstart="OL.handleStepDragStart(event, '${res.id}', ${i})"
               ondragover="event.preventDefault(); event.stopPropagation(); this.classList.add('drag-over')"
               ondragleave="this.classList.remove('drag-over')"
               ondrop="this.classList.remove('drag-over'); OL.handleStepDrop(event, '${res.id}', ${i})"
               style="cursor:default;">
            <span class="drag-handle"
                  style="cursor:grab;opacity:0.2;flex-shrink:0;font-size:14px;
                         padding-right:4px;user-select:none;">⠿</span>
            <div class="fvi-step-num" style="background:${tc.color}18;color:${tc.color};">
              ${i+1}
            </div>
            <div style="flex:1;min-width:0;cursor:pointer;"
                 onclick="event.stopPropagation(); OL.openInspector('${res.id}','${s.id}')">
              <div class="fvi-step-name">${esc(s.name||'Unnamed Step')}</div>
              ${hasBadges ? `
                <div style="display:flex;flex-wrap:wrap;gap:3px;margin-top:4px;">
                  ${appBadge}${assigneeBadges}${logicIcon}
                </div>` : ''}
            </div>
            <div style="display:flex;align-items:center;gap:4px;flex-shrink:0;">
              <i data-lucide="chevron-right"
                 style="width:11px;height:11px;color:var(--line);cursor:pointer;"
                 onclick="event.stopPropagation(); OL.openInspector('${res.id}','${s.id}')"></i>
              <button onclick="event.stopPropagation(); OL.deleteStep('${res.id}','${s.id}')"
                      style="width:16px;height:16px;border:none;background:none;cursor:pointer;
                             color:var(--line);display:flex;align-items:center;justify-content:center;
                             border-radius:4px;padding:0;transition:color 0.15s;"
                      onmouseover="this.style.color='#ef4444'"
                      onmouseout="this.style.color='var(--line)'"
                      title="Delete step">
                <i data-lucide="x" style="width:10px;height:10px;pointer-events:none;"></i>
              </button>
            </div>
          </div>
        `;
      }).join('')
    : `<div style="padding:16px;text-align:center;color:var(--text-muted);
                   font-size:11px;font-style:italic;">
         No steps yet
       </div>`;

  // ── FULL PANEL ───────────────────────────────────────
  content.innerHTML = `
    <div class="fvi-panel">

      <!-- HEADER -->
      <div class="fvi-header">
        <div class="fvi-header-icon" style="background:${tc.color}18;color:${tc.color};">
          ${tc.abbr}
        </div>
        <div style="flex:1;min-width:0;">
          <textarea class="fvi-name-input"
                    onblur="OL.handleResourceSave('${res.id}','name',this.value)"
                    rows="1"
                    oninput="this.style.height='auto';this.style.height=this.scrollHeight+'px';"
          >${esc(res.name)}</textarea>
          <div class="fvi-header-meta">
            <span style="color:${tc.color};font-weight:700;">${esc(res.type||'')}</span>
            <span class="fvi-meta-sep">·</span>
            <span>${(res.steps||[]).length} step${(res.steps||[]).length!==1?'s':''}</span>
            ${stageName ? `<span class="fvi-meta-sep">·</span><span>${esc(stageName)}</span>` : ''}
          </div>
        </div>
        <button class="fvi-add-step-btn"
                onclick="event.stopPropagation(); OL._fvOpenStepCanvas('${res.id}')">
            <i data-lucide="workflow" style="width:11px;height:11px;"></i>
            Flow
        </button>
      </div>

      <!-- PRIMARY APP -->
      <div class="fvi-section">
        <div class="fvi-label">
          <i data-lucide="smartphone" style="width:11px;height:11px;"></i>
          Primary Application
        </div>
        ${appSection}
      </div>

      <!-- STAGE -->
      <div class="fvi-section">
        <div class="fvi-label">
            <i data-lucide="map-pin" style="width:11px;height:11px;"></i>
            Stage & Workflow
        </div>
        <select class="fvi-select"
                onchange="OL._fvAssignStageAndWorkflow('${res.id}', this.value)">
            <option value="">— Unassigned —</option>
            ${stages.map(s => {
                const stageWorkflows = (OL.getWorkflows()||[]).filter(w => w.stageId === s.id);
                const stageVal = `stage:${s.id}`;
                const stageSelected = res.stageId === s.id && !res.workflowId;
                return `
                    <option value="${stageVal}" ${stageSelected ? 'selected' : ''}>
                        ${esc(s.name)}
                    </option>
                    ${stageWorkflows.map(wf => {
                        const wfSelected = res.workflowId === wf.id;
                        return `
                            <option value="wf:${wf.id}:${s.id}" ${wfSelected ? 'selected' : ''}>
                                &nbsp;&nbsp;↳ ${esc(wf.name)}
                            </option>
                        `;
                    }).join('')}
                `;
            }).join('')}
        </select>
    </div>

      <!-- CLASSIFICATION -->
      <div class="fvi-section">
        <div class="fvi-label">
          <i data-lucide="folder" style="width:11px;height:11px;"></i>
          Classification
        </div>
        <select class="fvi-select"
                onchange="OL.handleResourceSave('${res.id}','type',this.value)">
          <option value="General" ${res.type==='General'?'selected':''}>General</option>
          ${(state.master?.resourceTypes||[]).map(t =>
            `<option value="${esc(t.type)}"
                     ${res.type===t.type?'selected':''}>
               ${esc(t.type)}
             </option>`
          ).join('')}
        </select>
      </div>

      <!-- EXTERNAL LINK -->
      <div class="fvi-section">
        <div class="fvi-label">
          <i data-lucide="link" style="width:11px;height:11px;"></i>
          ${isZap ? 'Zapier Link' : 'External Link'}
        </div>
        <input type="url" class="fvi-input"
               placeholder="https://…"
               value="${esc(res.externalLink||'')}"
               onblur="OL.handleResourceSave('${res.id}','externalLink',this.value)">
      </div>

      <!-- STEPS -->
      <div class="fvi-section" style="padding-bottom:0;">
        <div class="fvi-label fvi-label-row">
          <span style="display:flex;align-items:center;gap:5px;">
            <i data-lucide="list" style="width:11px;height:11px;"></i>
            Steps
          </span>
          <div style="display:flex;align-items:center;gap:6px;margin-left:auto;">
            <button class="fvi-add-step-btn"
                    onclick="event.stopPropagation(); OL.addNewStepToCard('${res.id}')">
              <i data-lucide="plus" style="width:11px;height:11px;"></i>
              Add
            </button>
            <button class="fvi-toggle-steps-btn"
                    onclick="OL._fvToggleStepsPanel('${res.id}')"
                    title="${stepsOpen ? 'Collapse steps' : 'Expand steps'}">
              <i data-lucide="${stepsOpen ? 'chevron-up' : 'chevron-down'}"
                 style="width:12px;height:12px;"></i>
            </button>
          </div>
        </div>
        <div id="fvi-steps-list-${res.id}"
             style="display:${stepsOpen ? 'block' : 'none'};">
          ${stepsList}
        </div>
      </div>

      <!-- DESCRIPTION -->
      <div class="fvi-section">
        <div class="fvi-label">
          <i data-lucide="file-text" style="width:11px;height:11px;"></i>
          Description
        </div>
        <textarea class="fvi-textarea"
                  placeholder="Notes…"
                  onblur="OL.handleResourceSave('${res.id}','description',this.value)"
        >${esc(res.description||'')}</textarea>
      </div>

    </div>
  `;

  if (window.lucide) lucide.createIcons();

    // 2. Fix textarea height AFTER paint
  requestAnimationFrame(() => {
    const nameInput = content.querySelector('.fvi-name-input');
    if (nameInput) {
      nameInput.style.height = 'auto';
      nameInput.style.height = nameInput.scrollHeight + 'px';
    }
    if (window.lucide) lucide.createIcons();
  });
};

OL._fvAssignStageAndWorkflow = function(resId, value) {
    const data = OL.getCurrentProjectData();
    const res  = (data.resources || []).find(r => String(r.id) === String(resId));
    if (!res) return;

    console.group(`🎯 Re-assigning Lane Context for: ${res.name}`);

    if (!value) {
        // Option selected is Unassigned
        res.stageId = null;
        res.workflowId = null;
        res.isGlobal = true;
        delete res.coords;
    } 
    else if (value.startsWith('stage:')) {
        // Raw Stage lane selected (not assigned to a specific workflow process track)
        const targetStageId = value.replace('stage:', '');
        res.stageId = targetStageId;
        res.workflowId = null;
        res.isGlobal = false;
    } 
    else if (value.startsWith('wf:')) {
        // Nested Workflow Process track selected
        const [, wfId, targetStageId] = value.split(':');
        res.stageId = targetStageId;
        res.workflowId = wfId;
        res.isGlobal = false;
        
        // Push the resource ID directly into the workflow structure array if missing
        const targetWf = (data.workflows || []).find(w => String(w.id) === String(wfId));
        if (targetWf) {
            if (!targetWf.resourceIds) targetWf.resourceIds = [];
            if (!targetWf.resourceIds.includes(String(resId))) {
                targetWf.resourceIds.push(String(resId));
            }
        }
    }

    console.groupEnd();

    // Persist to Firestore and snap layouts back into place safely
    OL.persist().then(() => {
        if (typeof OL.autoAlignNodes === 'function') OL.autoAlignNodes();
        if (typeof OL.syncLogicPorts === 'function') OL.syncLogicPorts();
        
        // Re-render open side views cleanly
        OL._fvOpenStepsList(resId);
    });
};

OL._fvOpenStepCanvas = function(resId, breadcrumb) {
    const data      = OL.getCurrentProjectData();
    const resources = data.resources || [];
    const res       = resources.find(r => String(r.id) === String(resId));
    if (!res) return;

    const tc     = OL._fvGetType(res.type);
    const steps  = res.steps || [];
    const trail  = breadcrumb || [];

    // Save scroll position
    const canvasWrap = document.getElementById('fv-canvas-wrap');
    const scrollTop  = canvasWrap?.scrollTop  || 0;
    const scrollLeft = canvasWrap?.scrollLeft || 0;

    // Build step cards top to bottom, branches to the right
    const CARD_W  = 180;
    const CARD_H  = 100;
    const GAP_X   = 80;
    const GAP_Y   = 40;
    const PAD     = 40;

    // Use _fvLayoutResource (same logic as main steps canvas) to assign row/colOffset
    const layout = OL._fvLayoutResource(res);

    // Convert layout rows → y positions using actual array order for main-path steps
    const rowY = {};
    let y = PAD;
    steps.forEach((step, idx) => {
        const li = layout[step.id];
        if (!li || li.colOffset !== 0) return; // branch — skip
        rowY[li.row] = y;
        y += CARD_H + GAP_Y;
    });

    // Build posMap: main-path steps in column 0, branches to the right
    const posMap = {};
    steps.forEach((step, idx) => {
        const li = layout[step.id] || { colOffset: 0, row: idx };
        posMap[String(step.id)] = {
            x: PAD + li.colOffset * (CARD_W + GAP_X),
            y: rowY[li.row] !== undefined ? rowY[li.row] : PAD + idx * (CARD_H + GAP_Y),
        };
    });

    // Calculate canvas size
    const maxX = Math.max(...Object.values(posMap).map(p => p.x), 0) + CARD_W + PAD;
    const maxY = Math.max(...Object.values(posMap).map(p => p.y), 0) + CARD_H + PAD;

    // Build SVG arrows
    let svgArrows = '';
    steps.forEach(s => {
        const fromPos = posMap[String(s.id)];
        if (!fromPos) return;
        (s.logic?.out || []).filter(l => l.targetId).forEach(rule => {
            const lastH   = String(rule.targetId).lastIndexOf('-');
            const tResId  = rule.targetId.substring(0, lastH);
            const tStepId = rule.targetId.substring(lastH + 1);
            const toPos   = posMap[tStepId];
            
            // 🎯 CONTEXT MATCH CORRECTION:
            // If the target step exists within our local posMap structure array, use it.
            // If not, we scan via tracking contexts to resolve cross-card references.
            if (!toPos) return;

            const isCross = String(tResId) !== String(resId);
            const isVertical = toPos.y > fromPos.y + CARD_H / 2;
            let x1, y1, x2, y2, pathD;
            if (isVertical) {
                // Bottom-center to top-center (vertical next-step arrow)
                x1 = fromPos.x + CARD_W / 2; y1 = fromPos.y + CARD_H;
                x2 = toPos.x   + CARD_W / 2; y2 = toPos.y;
                const mid = (y1 + y2) / 2;
                pathD = `M${x1},${y1} C${x1},${mid} ${x2},${mid} ${x2},${y2}`;
            } else {
                // Right-center to left-center (horizontal branch arrow)
                x1 = fromPos.x + CARD_W; y1 = fromPos.y + CARD_H / 2;
                x2 = toPos.x;            y2 = toPos.y   + CARD_H / 2;
                pathD = `M${x1},${y1} C${x1 + 40},${y1} ${x2 - 40},${y2} ${x2},${y2}`;
            }

            const color = isCross ? '#a78bfa' :
                rule.type === 'condition' ? '#f5b800' :
                rule.type === 'loop'      ? '#f97316' :
                rule.type === 'delay'     ? '#7c3aed' : '#3dd9c5';

            const dash = isCross ? '6,3' :
                rule.type === 'condition' ? '4,3' : 'none';

            svgArrows += `
                <path d="${pathD}"
                      fill="none" stroke="${color}" stroke-width="1.5"
                      ${dash !== 'none' ? `stroke-dasharray="${dash}"` : ''}
                      opacity="0.7"/>
                <circle cx="${x2}" cy="${y2}" r="3" fill="${color}" opacity="0.7"/>
            `;

            // Label for conditions/delays/loops
            if (rule.type && rule.type !== 'next') {
                const mx = isVertical ? x1 : (x1 + x2) / 2;
                const my = isVertical ? (y1 + y2) / 2 - 8 : (y1 + y2) / 2 - 8;
                const label = rule.type === 'condition' ? `If: ${(rule.rule||'').substring(0,20)}` :
                              rule.type === 'delay'     ? `⏱ ${rule.delayValue||'?'} ${rule.delayUnit||'days'}` :
                              rule.type === 'loop'      ? `↺ ${rule.loopLimit||''}` : '';
                if (label) svgArrows += `
                    <rect x="${mx - 30}" y="${my - 8}" width="60" height="14"
                          rx="3" fill="white" opacity="0.9"/>
                    <text x="${mx}" y="${my + 2}" text-anchor="middle"
                          font-size="8" fill="${color}" font-family="inherit">
                        ${esc(label.substring(0, 18))}
                    </text>
                `;
            }
        });
    });

    // Build step cards
    const cardsHtml = steps.map(s => {
        const pos = posMap[String(s.id)];
        if (!pos) return '';

        const outRules   = (s.logic?.out || []).filter(l => l.targetId);
        const crossLinks = outRules.filter(rule => {
            const lastH  = String(rule.targetId).lastIndexOf('-');
            const tResId = rule.targetId.substring(0, lastH);
            return String(tResId) !== String(resId);
        });

        // Ghost cards for cross-resource connections
        const ghostsHtml = crossLinks.map(rule => {
            const lastH   = String(rule.targetId).lastIndexOf('-');
            const tResId  = rule.targetId.substring(0, lastH);
            const tStepId = rule.targetId.substring(lastH + 1);
            const tRes    = resources.find(r => String(r.id) === tResId);
            const tStep   = tRes?.steps?.find(st => String(st.id) === tStepId);
            if (!tRes || !tStep) return '';

            const ghostX = pos.x + CARD_W + GAP_X;
            const ghostY = pos.y;

            return `
                <div style="position:absolute;left:${ghostX}px;top:${ghostY}px;
                            width:${CARD_W}px;
                            background:var(--panel-soft);border:1.5px dashed #a78bfa;
                            border-radius:10px;padding:10px;
                            opacity:0.75;cursor:pointer;"
                     onclick="OL._fvOpenStepCanvas('${tResId}', ${JSON.stringify([...trail, {resId, name: res.name}])})">
                    <div style="font-size:8px;font-weight:700;text-transform:uppercase;
                                letter-spacing:0.06em;color:#a78bfa;margin-bottom:4px;">
                        🌐 ${esc(tRes.name.substring(0, 16))}
                    </div>
                    <div style="font-size:11px;font-weight:500;color:var(--text-dim);
                                line-height:1.3;">
                        ${esc(tStep.name || 'Unnamed')}
                    </div>
                    <div style="font-size:9px;color:#a78bfa;margin-top:6px;">
                        Switch context →
                    </div>
                </div>
            `;
        }).join('');

        const icons = [];
        if (outRules.some(l => l.type === 'loop'))      icons.push('↺');
        if (outRules.some(l => l.type === 'delay'))     icons.push('⏱');
        if (outRules.some(l => l.type === 'condition')) icons.push('◆');

        // 🎯 UNIQUE ELEMENT REGISTRY: Match contextual id identifiers per copy on step layout canvas
        const stepContainerHtmlId = res.workflowId ? `fvi-step-${s.id}-${res.workflowId}` : `fvi-step-${s.id}`;

        return `
            ${ghostsHtml}
            <div style="position:absolute;left:${pos.x}px;top:${pos.y}px;
                        width:${CARD_W}px;
                        background:var(--panel);border:1.5px solid #e5e7eb;
                        border-radius:10px;overflow:hidden;cursor:pointer;
                        box-shadow:0 1px 3px rgba(0,0,0,0.06);
                        transition:border-color 0.15s,box-shadow 0.15s;"
                 id="${stepContainerHtmlId}"
                 onmouseover="this.style.borderColor='#3dd9c5';this.style.boxShadow='0 4px 14px rgba(61,217,197,0.2)'"
                 onmouseout="this.style.borderColor='#e5e7eb';this.style.boxShadow='0 1px 3px rgba(0,0,0,0.06)'"
                 onclick="OL.openInspector('${res.id}','${s.id}')">
                <div style="height:3px;background:${tc.color};"></div>
                <div style="padding:8px 10px;">
                    <div style="font-size:9px;font-weight:700;text-transform:uppercase;
                                letter-spacing:0.06em;color:${tc.color};margin-bottom:4px;">
                        ${tc.abbr} · ${String(steps.indexOf(s) + 1).padStart(2,'0')}
                    </div>
                    <div style="font-size:12px;font-weight:500;color:var(--text-main);
                                line-height:1.35;margin-bottom:6px;">
                        ${esc(s.name || 'Unnamed Step')}
                    </div>
                    <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;">
                        ${s.appName ? `<span style="font-size:9px;padding:1px 5px;border-radius:99px;
                                                    background:#f5f6f8;color:var(--text-dim);">${esc(s.appName)}</span>` : ''}
                        ${icons.map(ic => `<span style="font-size:9px;padding:1px 5px;border-radius:99px;
                                                    background:var(--accent-glow);color:var(--accent);
                                                    font-weight:700;">${ic}</span>`).join('')}
                    </div>
                </div>
            </div>
        `;
    }).join('');

    // Breadcrumb trail
    const breadcrumbHtml = trail.length > 0 ? `
        <div style="position:sticky;top:0;z-index:20;background:var(--panel);
                    border-bottom:0.5px solid var(--panel-border);padding:8px 16px;
                    display:flex;align-items:center;gap:6px;font-size:11px;">
            <span onclick="OL.renderVisualizer()"
                  style="color:var(--text-muted);cursor:pointer;">
                <i data-lucide="layout-dashboard" style="width:11px;height:11px;"></i> Map
            </span>
            ${trail.map((t, i) => `
                <span style="color:var(--line);">›</span>
                <span onclick="OL._fvOpenStepCanvas('${t.resId}', ${JSON.stringify(trail.slice(0,i))})"
                      style="color:#3dd9c5;cursor:pointer;">
                    ${esc(t.name)}
                </span>
            `).join('')}
            <span style="color:var(--line);">›</span>
            <span style="color:var(--text-main);font-weight:500;">${esc(res.name)}</span>
            <button onclick="OL.renderVisualizer()"
                    class="fv-btn fv-icon" style="margin-left:auto;">
                <i data-lucide="x" style="width:12px;height:12px;"></i>
            </button>
        </div>
    ` : `
        <div style="position:sticky;top:0;z-index:20;background:var(--panel);
                    border-bottom:0.5px solid var(--panel-border);padding:8px 16px;
                    display:flex;align-items:center;gap:8px;">
            <button onclick="OL.renderVisualizer()" class="fv-btn" style="font-size:11px;">
                <i data-lucide="arrow-left" style="width:12px;height:12px;"></i> Back to map
            </button>
            <div style="width:8px;height:8px;border-radius:50%;background:${tc.color};"></div>
            <span style="font-size:13px;font-weight:500;color:var(--text-main);">${esc(res.name)}</span>
            <span style="font-size:11px;color:var(--text-muted);">${steps.length} steps</span>
            <button onclick="OL.addNewStepToCard('${res.id}')"
                    class="fv-btn" style="margin-left:auto;font-size:11px;">
                <i data-lucide="plus" style="width:12px;height:12px;"></i> Add Step
            </button>
        </div>
    `;

    // Replace main canvas content
    const mainArea = document.getElementById('mainContent');
    if (!mainArea) return;

    mainArea.innerHTML = `
        <div style="display:flex;flex-direction:column;height:100%;overflow:hidden;">
            ${breadcrumbHtml}
            <div style="flex:1;overflow:auto;position:relative;background:#f5f6f8;">
                <div style="position:relative;width:${maxX}px;height:${maxY}px;min-width:100%;min-height:100%;">
                    <svg style="position:absolute;top:0;left:0;width:100%;height:100%;
                                pointer-events:none;overflow:visible;">
                        <defs>
                            <marker id="sc-arrow" markerWidth="6" markerHeight="6"
                                    refX="5" refY="3" orient="auto">
                                <path d="M0,0 L0,6 L6,3 z" fill="#3dd9c5" opacity="0.7"/>
                            </marker>
                        </defs>
                        ${svgArrows}
                    </svg>
                    ${cardsHtml}
                </div>
            </div>
        </div>
    `;

    if (window.lucide) lucide.createIcons();
};

// Toggle steps list open/closed without full re-render
OL._fvToggleStepsPanel = function(resId) {
  if (!OL._fv._stepsOpen) OL._fv._stepsOpen = {};
  OL._fv._stepsOpen[resId] = !OL._fv._stepsOpen[resId];
  const isOpen = OL._fv._stepsOpen[resId];

  const list = document.getElementById(`fvi-steps-list-${resId}`);
  if (list) list.style.display = isOpen ? 'block' : 'none';

  // Update chevron
  const btn = list?.previousElementSibling?.querySelector('.fvi-toggle-steps-btn i');
  if (btn) {
    btn.setAttribute('data-lucide', isOpen ? 'chevron-up' : 'chevron-down');
    if (window.lucide) lucide.createIcons();
  }
};

OL._fvRenderListStep = function(step, res, stepIdx, globalIds, allResources, depth, visited, contextWfId = null) {
    // Guard against infinite recursion and excessive depth
    if (depth > 5) return '';
    if (!visited) visited = new Set();
    
    // 🎯 UNIQUE REGISTRY KEYS FOR GLOBAL COPIES
    // We add the context ID string to the tracking key so the anti-duplication shield 
    // treats separate workflow tracks as completely independent lane instances.
    const stepKey = contextWfId ? `${res.id}-${step.id}-${contextWfId}` : `${res.id}-${step.id}`;
    if (visited.has(stepKey)) return '';
    visited.add(stepKey);

    const tc = OL._fvGetType(res.type);
    const isGlobal      = globalIds.has(String(res.id));
    const isDecision    = (step.logic?.out || []).filter(l => l.targetId).length > 1;
    const hasLoop       = (step.logic?.out || []).some(l => l.type === 'loop');
    const isConditional = isDecision || (step.logic?.out || []).some(l => l.rule?.trim());
    
    const outRules = (step.logic?.out || []).filter(l => {
        if (!l.targetId) return false;
        if (OL._fv.showArchived) return true;
        const lastH  = String(l.targetId).lastIndexOf('-');
        const tResId = l.targetId.substring(0, lastH);
        const tRes   = allResources.find(r => String(r.id) === String(tResId));
        return !tRes?.isArchived;
    });

    // 🎯 CONTEXT-AWARE HOOK IDENTIFIERS
    const collapseId = contextWfId ? `fv-substeps-${step.id}-${contextWfId}` : `fv-substeps-${step.id}`;
    const resBadgeBg = tc.color + '18';
    
    const resBadge = `<span class="fv-list-res-badge"
        style="background:${resBadgeBg};color:${tc.color};border:1px solid ${tc.color}30;cursor:pointer;"
        onclick="event.stopPropagation();
                 document.querySelectorAll('.fv-list-item.selected').forEach(e=>e.classList.remove('selected'));
                 OL._fvOpenStepsList('${res.id}');">
        ${tc.abbr} ${esc(res.name.substring(0, 14))}
      </span>`;

    let inlineRoutingBadgesHtml = '';
    let nestedBranchesHtml = '';
    let hasNesting = false;
    
    const isIndentedChild = depth > 0;

    outRules.forEach(rule => {
        const lastH   = String(rule.targetId).lastIndexOf('-');
        const tResId  = rule.targetId.substring(0, lastH);
        const tStepId = rule.targetId.substring(lastH + 1);
        const tRes    = allResources.find(r => String(r.id) === String(tResId));
        const tStep   = tRes?.steps?.find(s => String(s.id) === String(tStepId));
        if (!tRes || !tStep) return;

        const nextSequentialStep = res.steps[stepIdx + 1];
        const isSubsequentLocalStep = (String(tResId) === String(res.id)) && nextSequentialStep && (String(tStepId) === String(nextSequentialStep.id));

        const isLoop  = rule.type === 'loop';
        const isDelay = rule.type === 'delay';
        const isCond  = rule.type === 'condition' || (rule.rule && rule.rule.trim().length > 0);
        
        const targetLabel = `${tRes.name.substring(0,12)} › ${tStep.name || 'Step'}`;
        
        // 🎯 TARGET CLONE COPIES IN SCROLL JUMPS
        // If the current step lives in a workflow context lane, ensure the smooth-scrolling target
        // looks for its neighboring step copy inside that exact same layout track!
        const jumpTargetHtmlId = contextWfId ? `fv-list-step-${tStepId}-${contextWfId}` : `fv-list-step-${tStepId}`;

        // 🔀 PATH A: Structural Conditional Cascading
        if (isCond) {
            hasNesting = true;
            const ruleText = rule.rule && rule.rule.trim() ? rule.rule.trim() : 'Conditional';

            if (!window._fvRenderedStepRegistry) window._fvRenderedStepRegistry = new Set();
            window._fvRenderedStepRegistry.add(stepKey);

            nestedBranchesHtml += `
                <div class="fv-list-branch" style="margin-top: 6px; position: relative;">
                    <div class="fv-branch-label" style="color:#10b981; display:flex; align-items:center; gap:6px; font-size:11px; font-weight:700; letter-spacing:0.02em; padding-left: ${28 + (depth * 12)}px; margin-bottom: 4px;">
                        <i data-lucide="git-commit" style="width:12px; height:12px; color:#10b981;"></i> 
                        <span>IF: ${esc(ruleText.toUpperCase())}</span>
                    </div>
                    ${OL._fvRenderListStep(tStep, tRes, tRes.steps.indexOf(tStep), globalIds, allResources, depth + 1, visited, contextWfId)}
                </div>`;
        } 
        // 🔀 PATH B: Flat Inline Badge Indicators (Loops, Delays, Jumps)
        else if (isLoop || isDelay || !isSubsequentLocalStep) {
            let badgeStyle = "background:rgba(255,255,255,0.03); color:var(--text-muted); border:1px solid var(--line);";
            let badgeText = `➔ Jump: ${targetLabel}`;
            let clickAction = '';

            if (!isSubsequentLocalStep) {
                clickAction = `onclick="event.stopPropagation(); const targetRow = document.getElementById('${jumpTargetHtmlId}'); if(targetRow) { targetRow.scrollIntoView({ behavior: 'smooth', block: 'center' }); document.querySelectorAll('.fv-list-item.selected').forEach(e=>e.classList.remove('selected')); targetRow.classList.add('selected'); targetRow.style.outline='2px solid var(--accent)'; setTimeout(()=>targetRow.style.outline='',1500); }"`;
            }

            if (isLoop) {
                badgeStyle = "background:rgba(245,184,0,0.06); color:#f5b800; border:1px solid rgba(245,184,0,0.2);";
                badgeText = `Loop${rule.loopLimit ? ` (${rule.loopLimit})` : ''} ➔ ${targetLabel}`;
            } else if (isDelay) {
                badgeStyle = "background:rgba(167,139,250,0.06); color:#a78bfa; border:1px solid rgba(167,139,250,0.2);";
                badgeText = `Delay: ${rule.delayValue || '?'} ${rule.delayUnit || 'days'} ➔ ${targetLabel}`;
            } else if (!isSubsequentLocalStep) {
                badgeStyle = "background:rgba(56,189,248,0.08); color:#38bdf8; border:1px solid rgba(56,189,248,0.25); cursor:pointer;";
                badgeText = `🔀 Skip To: ${targetLabel} ➔`;
            }

            if (rule.rule && rule.rule.trim() && !isCond) {
                badgeText = `[If: "${rule.rule.trim()}"] ${badgeText}`;
            }

            inlineRoutingBadgesHtml += `
                <span class="pill tiny split-jump-badge" ${clickAction} style="display:inline-flex; align-items:center; gap:4px; font-size:9px; font-weight:700; padding:2px 6px; border-radius:4px; ${badgeStyle}">
                    ${esc(badgeText)}
                </span>`;
        }
    });

    // 🛡️ THE ANTI-DUPLICATION SHIELD:
    if (!isIndentedChild && window._fvRenderedStepRegistry && window._fvRenderedStepRegistry.has(stepKey)) {
        return ''; 
    }

    const tags = [
        isGlobal ? `<span class="fv-list-tag global">🌐 Global</span>` : '',
        hasLoop   ? `<span class="fv-list-tag loop">↺ Loop</span>`      : '',
        (isDecision) ? `<span class="fv-list-tag conditional">◆ Decision</span>` : '',
        (isConditional && !isDecision) ? `<span class="fv-list-tag conditional">◆ Conditional</span>` : ''
    ].filter(Boolean).join('');

    // 🎯 CONTEXT-ISOLATED INTERACTION SURFACE
    const customRowElementHtmlId = contextWfId ? `fv-list-step-${step.id}-${contextWfId}` : `fv-list-step-${step.id}`;

    return `
    <div style="margin-bottom: 4px; margin-left:${isIndentedChild ? '24px' : '0px'};">
      <div class="fv-list-row" style="${isIndentedChild ? 'border-left: 2px dashed rgba(61,217,197,0.25); padding-left: 12px;' : ''}">
        <div class="fv-tree-connector"></div>
        <div class="fv-list-item ${isDecision ? 'is-decision' : ''} ${isGlobal ? 'is-global' : ''}"
             id="${customRowElementHtmlId}"
             data-step-id="${step.id}"
             data-res-id="${res.id}"
             data-context-wf-id="${contextWfId || ''}"
             draggable="true"
             ondragstart="event.stopPropagation(); OL.handleStepDragStart(event, '${res.id}', ${res.steps.indexOf(step)})"
             ondragover="event.preventDefault(); event.stopPropagation(); this.classList.add('drag-over')"
             ondragleave="this.classList.remove('drag-over')"
             ondrop="event.stopPropagation(); this.classList.remove('drag-over'); OL.handleStepDrop(event, '${res.id}', ${res.steps.indexOf(step)})"
             onclick="event.stopPropagation();
                      document.querySelectorAll('.fv-list-item.selected').forEach(e=>e.classList.remove('selected'));
                      this.classList.add('selected');
                      OL.openInspector('${res.id}', '${step.id}');">
          <span class="drag-handle" style="cursor:grab; opacity:0.25; flex-shrink:0; padding-right:4px; font-size:14px;">⠿</span>
          <div class="fv-list-type-dot" style="background:${tc.color}; margin-top:5px;"></div>
          
          <div style="display:flex; flex-direction:column; gap:1px; flex:1; min-width:0;">
              <span class="fv-list-step-name ${isDecision ? 'decision-name' : ''}" style="font-weight:600; font-size:13px; color:var(--text-main);">${esc(step.name || 'Unnamed Step')}</span>
              
              ${inlineRoutingBadgesHtml ? `<div style="display:flex; flex-wrap:wrap; gap:4px; margin-top:4px;">${inlineRoutingBadgesHtml}</div>` : ''}
          </div>

          ${tags}
          ${resBadge}
          ${hasNesting ? `
            <span class="fv-substep-toggle"
                      onclick="event.stopPropagation();
                               const el=document.getElementById('${collapseId}');
                               const collapsed=el.style.display==='none';
                               el.style.display=collapsed?'block':'none';
                               this.textContent=collapsed?'−':'+';
                               this.title=collapsed?'Collapse':'Expand';"
                      title="Collapse"
                      style="margin-left:auto; flex-shrink:0; width:18px; height:18px;
                             border-radius:4px; background:rgba(255,255,255,0.03); border:1px solid var(--line);
                             display:flex; align-items:center; justify-content:center;
                             font-size:11px; font-weight:700; color:var(--text-muted); cursor:pointer;
                             line-height:1;">−</span>
            ` : ''}
        </div>
      </div>
      ${hasNesting ? `<div id="${collapseId}">${nestedBranchesHtml}</div>` : ''}
    </div>
  `;
};

// ══════════════════════════════════════════════
// SHARED CONTROLS
// ══════════════════════════════════════════════

OL.fvSearch = function(query) {
  OL._fv._searchQuery = query;
  const q   = (query || '').toLowerCase().trim();
  const nav = document.getElementById('fv-search-nav');

  if (OL._fv.layout === 'flowchart') {
    document.querySelectorAll('.fv-card').forEach(el => el.classList.remove('search-match','search-active','dimmed'));
  } else {
    document.querySelectorAll('.fv-list-item').forEach(el => el.classList.remove('search-match','dimmed'));
  }

  if (!q) {
    OL._fv.searchMatches = []; OL._fv.searchIdx = -1;
    if (nav) nav.style.display = 'none';
    return;
  }

  const data = OL.getCurrentProjectData();
  const resources = (data.resources || []).filter(r => !r.isDeleted && !r.isLocked);

  let matches = [];
  if (OL._fv.layout === 'flowchart') {
    matches = resources
      .filter(r => (r.name||'').toLowerCase().includes(q) || (r.type||'').toLowerCase().includes(q))
      .map(r => ({ type: 'card', id: r.id }));
    document.querySelectorAll('.fv-card').forEach(el => {
      const hit = matches.some(m => m.id === el.dataset.resId);
      el.classList.toggle('search-match', hit);
      el.classList.toggle('dimmed', !hit);
    });
  } else {
    resources.forEach(r => {
      (r.steps || []).forEach(s => {
        if ((s.name||'').toLowerCase().includes(q) || (r.name||'').toLowerCase().includes(q)) {
          matches.push({ type: 'step', id: s.id, resId: r.id });
        }
      });
    });
    document.querySelectorAll('.fv-list-item').forEach(el => {
      const hit = matches.some(m => m.id === el.dataset.stepId);
      el.classList.toggle('search-match', hit);
      el.classList.toggle('dimmed', !hit);
    });
  }

  OL._fv.searchMatches = matches;
  OL._fv.searchIdx = matches.length > 0 ? 0 : -1;

  if (nav) nav.style.display = matches.length ? 'flex' : 'none';
  if (matches.length) OL.fvActivateMatch();

  const count = document.getElementById('fv-match-count');
  if (count) count.textContent = matches.length ? `1/${matches.length}` : '0/0';
};

OL.fvNextMatch = function() {
  if (!OL._fv.searchMatches?.length) return;
  OL._fv.searchIdx = (OL._fv.searchIdx + 1) % OL._fv.searchMatches.length;
  OL.fvActivateMatch();
};
OL.fvPrevMatch = function() {
  if (!OL._fv.searchMatches?.length) return;
  OL._fv.searchIdx = (OL._fv.searchIdx - 1 + OL._fv.searchMatches.length) % OL._fv.searchMatches.length;
  OL.fvActivateMatch();
};
OL.fvActivateMatch = function() {
  const match = OL._fv.searchMatches[OL._fv.searchIdx];
  if (!match) return;

  const sel = OL._fv.layout === 'flowchart'
    ? document.getElementById(`fv-card-${match.id}`)
    : document.getElementById(`fv-list-step-${match.id}`);

  document.querySelectorAll('.fv-card.search-active, .fv-list-item.search-active')
    .forEach(el => el.classList.remove('search-active'));

  if (sel) {
    sel.classList.add('search-active');
    sel.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
  }
  const count = document.getElementById('fv-match-count');
  if (count) count.textContent = `${OL._fv.searchIdx + 1}/${OL._fv.searchMatches.length}`;
};
OL.fvClearSearch = function() {
  OL._fv._searchQuery = '';
  const input = document.getElementById('fv-search');
  if (input) input.value = '';
  OL.fvSearch('');
};

OL.fvToggleConnections = function() {
  OL._fv.showConnections = !OL._fv.showConnections;
  const data = OL.getCurrentProjectData();
  const resources = (data.resources || []).filter(r => !r.isDeleted && !r.isLocked);
  OL._fvDrawConnections(resources);
  // Re-render just the button
  const btn = document.getElementById('fv-conn-btn');
  if (btn) btn.classList.toggle('fv-active', OL._fv.showConnections);
};

OL._fvSetupZoom = function() {
  const wrap = document.getElementById('fv-canvas-wrap');
  if (!wrap) return;
  wrap.addEventListener('wheel', e => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    OL.fvZoom(e.deltaY > 0 ? -0.08 : 0.08);
  }, { passive: false });
};

OL.fvZoom = function(delta) {
  OL._fv.zoom = Math.min(2, Math.max(0.3, (OL._fv.zoom || 1) + delta));
  const canvas = document.getElementById('fv-canvas');
  if (canvas) { canvas.style.transform = `scale(${OL._fv.zoom})`; canvas.style.transformOrigin = 'top left'; }
  const label = document.getElementById('fv-zoom-label');
  if (label) label.textContent = Math.round(OL._fv.zoom * 100) + '%';
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
    if (!step.links || step.links.length === 0) return 'circle'; // Generic dot
    
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

    // Return Lucide Icon Slugs
    if (check('email')) return 'mail';
    if (check('form')) return 'file-text';
    if (check('event') || check('scheduler')) return 'calendar';
    if (check('guide') || check('sop')) return 'book-open';
    if (check('signature') || check('sig-')) return 'pen-tool';
    
    if (check('zap') || check('automation')) return 'zap';
    if (check('database') || check('sheet')) return 'table-2';
    if (check('legal') || check('contract')) return 'file-signature';
    if (check('folder') || check('file')) return 'folder';
    if (check('video') || check('recording')) return 'video';
    if (check('payment') || check('invoice')) return 'banknote';

    return 'link'; 
};

OL.renderWorkbenchTabs = function() {
    const tabs = [
        { id: 'flows', label: 'Flows', icon: 'workflow', color: 'var(--accent)' },
        { id: 'assets', label: 'Assets', icon: 'database', color: '#38bdf8' },
        { id: 'guides', label: 'Guides', icon: 'book-open', color: '#fbbf24' },
        { id: 'data', label: 'Data', icon: 'tag', color: '#a78bfa' }
    ];

    return `
        <div class="workbench-header" style="background: rgba(0,0,0,0.3); border-bottom: 1px solid var(--line);">
            <div class="workbench-tab-bar" style="display: flex;">
                ${tabs.map(t => `
                    <div class="wb-tab ${state.ui.activeWorkbenchTab === t.id ? 'active' : ''}" 
                        onclick="OL.switchWorkbenchTab('${t.id}')" 
                        style="flex:1; padding: 12px 5px; text-align:center; cursor:pointer; 
                                border-bottom: 2px solid ${state.ui.activeWorkbenchTab === t.id ? t.color : 'transparent'};
                                color: ${state.ui.activeWorkbenchTab === t.id ? t.color : 'var(--text-dim)'};
                                display: flex; flex-direction: column; align-items: center; gap: 4px;">
                        
                        <i data-lucide="${t.icon}" style="width:14px; height:14px;"></i>
                        <span style="font-size:9px; font-weight:bold;">${t.label.toUpperCase()}</span>
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
    const data = OL.getCurrentProjectData();
    const resources = (data.resources || []).filter(r => !r.isDeleted && !r.isLocked);

    // 🕵️ BUILD LINKED SET
    const linkedIds = new Set();
    resources.forEach(res => {
        (res.steps || []).forEach(step => {
            (step.links || []).forEach(link => linkedIds.add(String(link.id)));
            if (step.howToIds) step.howToIds.forEach(id => linkedIds.add(String(id)));
        });
    });

    let items = [];
    if (activeTab === 'flows') {
        items = resources.filter(r => ['Workflow', 'Zap', 'Email Campaign'].includes(r.type) && !r.coords);
    } else if (activeTab === 'assets') {
        items = resources.filter(r => !['Workflow', 'Zap', 'Email Campaign'].includes(r.type) && !r.coords);
    } else if (activeTab === 'guides') {
        items = [...(state.master.howToLibrary || []), ...(getActiveClient()?.projectData?.localHowTo || [])];
    } else if (activeTab === 'data') {
        const client = getActiveClient();
        items = client?.projectData?.localDatapoints?.length 
            ? client.projectData.localDatapoints 
            : (state.master.datapoints || []);
    }

    if (query.trim()) {
        items = items.filter(i => (i.name || i.title || "").toLowerCase().includes(query.trim()));
    }

    workbenchContents.innerHTML = '';
    
    items.forEach(item => {
        const div = document.createElement('div');
        div.id = `wb-node-${item.id}`;
        div.className = activeTab === 'data' ? 'data-tag-draggable' : 'v2-node-card on-shelf';
        div.draggable = true;
        
        div.addEventListener('dragstart', (e) => {
            if (activeTab === 'data') {
                e.dataTransfer.setData("application/sphynx-type", "datapoint");
                e.dataTransfer.setData("application/sphynx-id", item.id);
            } else {
                e.dataTransfer.setData('text/plain', item.id);
                e.dataTransfer.effectAllowed = "move";
            }
            e.target.style.opacity = "0.5";
        });

        div.addEventListener('dragend', (e) => { e.target.style.opacity = "1"; });

        // 🎯 FIXED: Icon Resolution using 'item' instead of 'res'
        let iconName = "";
        if (activeTab === 'data') {
            iconName = item.isBundle ? "package" : "tag";
        } else {
            // Using the registry helper we updated earlier
            iconName = OL.getRegistryIcon(item.type);
        }

        div.innerHTML = `
            <div class="v2-node-header" style="pointer-events: none;">
                <div class="header-row-content" style="display:flex; align-items:center;">
                    <i data-lucide="${iconName}" style="width:14px; height:14px; margin-right:8px; color: var(--accent); flex-shrink:0;"></i>
                    <b class="res-name-text" style="font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                        ${esc(item.name || item.title)}
                    </b>
                </div>
            </div>`;
            
        workbenchContents.appendChild(div);
    });

    // 🚀 THE REPAINT TRIGGER
    if (window.lucide) {
        window.lucide.createIcons();
    }
};

OL.switchWorkbenchTab = function(tabId) {
    // 1. Update the logical state
    state.ui.activeWorkbenchTab = tabId;
    
    // 2. 🚀 SURGICAL CSS UPDATE: Update tab highlights without a full redraw
    const tabs = document.querySelectorAll('.wb-tab');
    tabs.forEach(tab => {
        // We look for the function call inside the onclick to identify the tab
        if (tab.getAttribute('onclick').includes(`'${tabId}'`)) {
            tab.classList.add('active');
            // Force the specific styling you defined in renderWorkbenchTabs
            tab.style.color = "var(--accent)"; 
            tab.style.borderBottom = "2px solid var(--accent)";
        } else {
            tab.classList.remove('active');
            tab.style.color = "var(--text-dim)";
            tab.style.borderBottom = "2px solid transparent";
        }
    });

    // 3. Update the sidebar sub-filters (important for the Assets checkbox)
    const filterContainer = document.getElementById('sidebar-sub-filter-container');
    if (filterContainer) {
        filterContainer.innerHTML = OL.renderSidebarTypeFilter();
    }

    // 4. Refresh the list content
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
            //OL.openInspector(newResId, null, 'cards');
            OL._fvOpenStepsList('${res.id}')

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
    state.draggingStepResId = resId;
    state.draggingStepIdx = index;
    e.dataTransfer.effectAllowed = 'move';

    // Fix: list view uses .fv-list-item, not .v2-step-item
    const row = e.target.closest('.fv-list-item') || e.target.closest('.v2-step-item');
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
    e.stopPropagation();
    
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));

    const sourceStepResId = state.draggingStepResId;
    const draggedStepIdx = state.draggingStepIdx;
    
    let sourceResId = null;
    try {
        const resourceData = JSON.parse(e.dataTransfer.getData('application/json') || '{}');
        sourceResId = resourceData.id;
    } catch(err) {
        sourceResId = e.dataTransfer.getData('text/plain');
    }

    // --- CASE 1: INTERNAL STEP REORDER ---
    if (sourceStepResId === targetResId && draggedStepIdx !== null) {
        if (draggedStepIdx === droppedOnIdx) return;
        
        const res = OL.getResourceById(targetResId);
        if (!res || !res.steps) return;
        
        const [movedStep] = res.steps.splice(draggedStepIdx, 1);
        res.steps.splice(droppedOnIdx, 0, movedStep);
        
        await OL.persist();
    
        if (document.getElementById('active-modal-box')) {
            const stepListContainer = document.getElementById('sop-step-list');
            if (stepListContainer) {
                stepListContainer.innerHTML = window.renderSopStepList(res);
            } else {
                OL.openResourceModal(targetResId);
            }
        } else {
            // Covers both inspector and list view
            OL.renderVisualizer();
        }
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
    window.isMatrixActive = false;
    const quickInput = document.getElementById('quick-step-input');
 
    if (quickInput && quickInput.value.trim().length > 2) {
        const resId = quickInput.getAttribute('data-res-id');
        const valToSave = quickInput.value;
        quickInput.value = "";
        console.log("💾 Auto-saving draft before close...");
        OL.commitQuickStep(resId, valToSave);
        return;
    }
 
    const layer = document.getElementById('modal-layer');
    if (layer) {
        layer.style.display = 'none';
        layer.innerHTML = '';
    }
 
    OL.isSavingStep = false;
    OL.quickAddState = {
        name: "", app: "", appId: null,
        assignee: [], links: [], target: null,
        delay: 0, note: "", rule: ""
    };
 
    const hash = window.location.hash;
 
    // 🎯 Preserve scroll position across the refresh, whichever branch below fires.
    const scrollHost = document.getElementById('mainContent');
    const savedScrollTop = scrollHost ? scrollHost.scrollTop : 0;
    const restoreScroll = () => {
        requestAnimationFrame(() => {
            const host = document.getElementById('mainContent');
            if (host) host.scrollTop = savedScrollTop;
        });
    };
 
    if (hash.includes('resources')) {
        if (typeof renderResourceManager === "function") renderResourceManager();
        restoreScroll();
    }
    else if (hash.includes('applications') || hash.includes('apps')) {
        if (typeof renderAppsGrid === "function") renderAppsGrid();
        restoreScroll();
    }
    // 🚀 THE FIX: this branch was missing entirely, so Functions-page modal
    // closes fell through to the heavy window.handleRoute() path below.
    else if (hash.includes('functions')) {
        if (typeof renderFunctionsGrid === "function") renderFunctionsGrid();
        restoreScroll();
    }
    else if (hash.includes('analyze')) {
        if (typeof renderAnalysisModule === "function") renderAnalysisModule();
        restoreScroll();
    }
    else if (hash.includes('visualizer')) {
        if (typeof OL.renderVisualizer === "function") OL.renderVisualizer();
    }
    else {
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

    const dockedPanel = document.getElementById('v2-inspector-panel') || document.getElementById('inspector-panel');    
    const launchedFromInspector = !!(dockedPanel && dockedPanel.classList.contains('open') && window.location.hash.includes('visualizer'));    
    OL._quickAddOrigin = launchedFromInspector ? 'inspector' : 'modal';

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
        { label: 'Assignee', key: 'Assign:', icon: '👨‍💼', sub: 'team' },
        { label: 'Application', key: 'App:', icon: '💻', sub: 'apps' },
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
                ${s.app ? `<span class="pill status-primary">💻 ${s.app}</span>` : ''}
                ${(s.assignee || []).map(a => `
                    <span class="pill vault-gold" style="font-size: 10px;">👨‍💼 ${a.name}</span> `).join('')}
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
                    <span>💻 ${esc(a.name)}</span>
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
                const icon = item.type === 'SOP' || item.content !== undefined ? '📖' : '💻';
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
    const s = OL.quickAddState;
 
    if (!taskName && !s.note) {
        OL.isSavingStep = false;
        OL.closeModal();
        return;
    }
 
    OL.isSavingStep = true;
    input.value = "";
 
    let succeeded = false;
 
    try {
        const newStep = {
            id: "step_" + Date.now(),
            name: taskName || "Untitled Action",
            appId: s.appId || null,
            appName: s.app || null,
            assignees: Array.isArray(s.assignee) ? s.assignee : [],
            description: s.note || "",
            timingValue: parseInt(s.delay) || 0,
            timingType: 'after_prev',
            dueDate: s.due || null,
            rule: s.rule || "",
            logic: { in: [], out: [] },
            links: s.links || [],
            targetResourceId: s.target?.id || null,
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
            succeeded = true;
        }
    } catch (err) {
        console.error("❌ Power Add Sync Failure:", err);
    } finally {
        OL.isSavingStep = false;
 
        // 🚀 THE FIX: go back to the Resource Modal you were already in,
        // instead of routing away to the underlying page.
        const modalLayer = document.getElementById('modal-layer');
        if (modalLayer) {
            modalLayer.style.display = 'none';
            modalLayer.innerHTML = '';
        }
        const cameFromInspector = OL._quickAddOrigin === 'inspector';        
        OL._quickAddOrigin = null;
        if (succeeded && resId) {
            if (cameFromInspector && window.location.hash.includes('visualizer')) {                
                OL._fvOpenStepsList(resId);            
            } else {                
                // Not returning to the docked Inspector — make sure it isn't                
                // left open behind the modal from an earlier Visualizer visit.                
                const dockedPanel = document.getElementById('v2-inspector-panel') || document.getElementById('inspector-panel');                
                if (dockedPanel) dockedPanel.classList.remove('open');               
                OL.openResourceModal(resId);            
            }        
        } else {
            OL.closeModal();
        }
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

OL.deleteStep = function(resId, stepId) {
    const data = OL.getCurrentProjectData();
    const res = (data.resources || []).find(r => String(r.id) === String(resId));
    if (!res) return;

    const step = (res.steps || []).find(s => String(s.id) === String(stepId));
    if (!step) return;

    if (!confirm(`Delete step "${step.name}"? This will also remove any logic links connected to it.`)) return;

    // 1. Cleanup: remove all logic links pointing to this step
    const fullId = `${resId}-${stepId}`;
    (data.resources || []).forEach(r => {
        (r.steps || []).forEach(s => {
            if (s.logic?.out) s.logic.out = s.logic.out.filter(l => l.targetId !== fullId);
            if (s.logic?.in)  s.logic.in  = s.logic.in.filter(l => l.sourceId !== fullId);
        });
    });

    // 2. Delete the step
    res.steps = res.steps.filter(s => String(s.id) !== String(stepId));

    // 3. Persist and go back to resource view
    OL.persist();
    OL._fvOpenStepsList(resId);
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
    const onVisualizer = window.location.hash.includes('visualizer');
 
    // 🚀 THE FIX: outside the Visualizer, "open inspector" for a resource
    // should just open the normal full Resource Modal — the docked 380px
    // panel only makes sense alongside the flow-map canvas.
    if (!onVisualizer) {
        if (resId && stepTarget === null) {
            return OL.openResourceModal(resId);
        }
        if (resId && stepTarget !== null) {
            // Step-level deep link from outside the visualizer: open the
            // resource modal — there's no flow-map canvas to dock next to.
            return OL.openResourceModal(resId);
        }
        return;
    }
    
    const panel = document.getElementById('v2-inspector-panel') || document.getElementById('inspector-panel');
    const content = document.getElementById('inspector-content');
    if (!panel || !content) return;
 
    // 🎯 RESTORE INTERNAL SCROLL LAYER VISIBILITY
    panel.style.overflow = '';
    const scrollContent = panel.querySelector('.inspector-scroll-content');
    if (scrollContent) {
        scrollContent.style.display = 'block'; // Bring it back to life!
    }

    // 🎯 Get Context Data
    const data = OL.getCurrentProjectData();
    const resources = data.resources || [];
    panel.classList.add('open');

    // Force grid open
    const layout = document.querySelector('.three-pane-layout');
    if (layout) {
        const sidebarCollapsed = document.querySelector('.sidebar.collapsed');
        const leftCol = sidebarCollapsed ? '65px' : '240px';
        layout.style.gridTemplateColumns = `${leftCol} 1fr 380px`;
    }

    try {
        OL._buildInspectorContent(resId, stepTarget, mode, panel, content, data, resources);
    } catch (err) {
        console.error("❌ Inspector render failed:", err);
        content.innerHTML = `
            <div style="padding:24px;color:#ef4444;font-size:12px;line-height:1.6;">
                <strong>Inspector failed to render.</strong><br>
                ${esc(err.message || String(err))}
                <div style="margin-top:10px;opacity:0.6;font-size:10px;">
                    Check the browser console for the full stack trace.
                </div>
            </div>`;
    }
};

OL._buildInspectorContent = function(resId, stepTarget, mode, panel, content, data, resources) {
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
            <div class="breadcrumb" onclick="OL._fvOpenStepsList('${resId}')"
                 style="display:flex;align-items:center;gap:4px;cursor:pointer;">
                <i data-lucide="arrow-left" style="width:10px;height:10px;"></i> Back to Resource
            </div>
            
            <div class="inspector-header">
                <div class="section-label">EDIT STEP ${currentIdx + 1}</div>
                <input type="text" class="inspector-name-input" 
                      value="${esc(step.name)}" 
                      onblur="OL.updateAtomicStep('${resId}', '${step.id}', 'name', this.value)"
                      placeholder="Step Name">
                <button onclick="OL.deleteStep('${resId}','${step.id}')"
                        style="padding:4px 8px;border-radius:6px;font-size:10px;cursor:pointer;
                               border:1px solid rgba(239,68,68,0.3);background:rgba(239,68,68,0.06);
                               color:#ef4444;flex-shrink:0;">
                    Delete step
                </button>
                <button onclick="event.preventDefault(); event.stopPropagation(); 
                                 OL.handleResourceSave('${res.id}', 'isArchived', ${!res.isArchived}); 
                                 renderResourceManager();"
                        title="${res.isArchived ? 'Unarchive' : 'Archive'}"
                        style="color:${res.isArchived ? '#ef4444' : 'var(--text-muted)'};">
                    <i data-lucide="archive" style="width:12px;height:12px;"></i>
                </button>
            </div>

            <div class="inspector-body">
                <div class="inspector-section">
                    <div class="section-label">
                        <i data-lucide="corner-right-up" style="width:11px;height:11px;"></i>
                        Move to resource
                    </div>
                    <select class="fvi-select"
                            onchange="if(this.value) OL.executeStepMove('${resId}', '${step.id}', this.value); this.value='';">
                        <option value="">— Keep in ${esc(res.name)} —</option>
                        <optgroup label="Same stage">
                            ${(OL.getCurrentProjectData().resources || [])
                                .filter(r => String(r.id) !== String(resId) && r.stageId === res.stageId)
                                .sort((a,b) => a.name.localeCompare(b.name))
                                .map(r => `<option value="${r.id}">${esc(r.name)} (${(r.steps||[]).length} steps)</option>`)
                                .join('')}
                        </optgroup>
                        <optgroup label="All resources">
                            ${(OL.getCurrentProjectData().resources || [])
                                .filter(r => String(r.id) !== String(resId) && r.stageId !== res.stageId)
                                .sort((a,b) => a.name.localeCompare(b.name))
                                .map(r => `<option value="${r.id}">${esc(r.name)} (${(r.steps||[]).length} steps)</option>`)
                                .join('')}
                        </optgroup>
                    </select>
                </div>
                
                <div class="inspector-section">
                    <div class="section-label">
                        <i data-lucide="arrow-down-to-line" style="width:11px;height:11px;"></i> INPUT CONDITIONS
                    </div>
                    ${step.logic.in.map((l, i) => OL.renderLogicBlock(resId, step.id, 'in', i, l, allOptions)).join('')}
                </div>

                <div class="inspector-section">
                    <label class="section-label">
                        <i data-lucide="notebook-pen" style="width:11px;height:11px;"></i> INTERNAL NOTES
                    </label>
                    <textarea class="modal-textarea" style="min-height:60px;"
                              onblur="OL.updateAtomicStep('${resId}', '${step.id}', 'description', this.value)">${esc(step.description || '')}</textarea>
                </div>

                <div class="inspector-section">
                    <label class="section-label">
                        <i data-lucide="target" style="width:11px;height:11px;"></i> RELATIONAL TARGET (MILESTONE)
                    </label>
                    ${step.targetResourceId ? `
                        <div class="pill accent" style="display:flex; justify-content:space-between; align-items:center; background:rgba(var(--accent-rgb), 0.1); border:1px solid var(--accent);">
                            <span style="display:flex;align-items:center;gap:4px;">
                                <i data-lucide="target" style="width:10px;height:10px;"></i>
                                ${esc(step.targetResourceName)}
                            </span>
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
                    <label class="section-label">
                        <i data-lucide="users" style="width:11px;height:11px;"></i> ASSIGNEES (WHO?)
                    </label>
                    <div class="pill-display" style="display:flex; flex-wrap:wrap; gap:4px; margin-bottom:8px;">
                        ${step.assignees.length > 0 ? step.assignees.map((a, idx) => `
                            <span style="display:inline-flex;align-items:center;gap:5px;
                                         padding:3px 8px;border-radius:99px;font-size:10px;font-weight:600;
                                         background:var(--accent-glow);color:var(--accent);
                                         border:1px solid rgba(61,217,197,0.3);">
                                <i data-lucide="${a.type==='person' ? 'user' : a.type==='role' ? 'users' : 'smartphone'}" 
                                   style="width:10px;height:10px;"></i>
                                ${esc(a.name)}
                                <span onclick="OL.removeAssignee('${resId}','${step.id}',${idx})"
                                      style="opacity:0.5;cursor:pointer;margin-left:2px;font-size:12px;line-height:1;">×</span>
                            </span>
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
                    <label class="section-label">
                        <i data-lucide="smartphone" style="width:11px;height:11px;"></i> PRIMARY APPLICATION (TOOL)
                    </label>
                    ${step.appId ? `
                        <div class="pill-display" style="margin-bottom:8px;">
                            <span style="display:inline-flex;align-items:center;gap:5px;
                                         padding:3px 8px;border-radius:99px;font-size:10px;font-weight:600;
                                         background:var(--accent-glow);color:var(--accent);
                                         border:1px solid rgba(61,217,197,0.3);">
                                <i data-lucide="smartphone" style="width:10px;height:10px;"></i>
                                ${esc(step.appName)}
                                <span onclick="OL.removeAppFromStep('${resId}','${step.id}')"
                                      style="opacity:0.5;cursor:pointer;margin-left:2px;font-size:12px;line-height:1;">×</span>
                            </span>
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
                    <label class="section-label">
                        <i data-lucide="git-merge" style="width:11px;height:11px;"></i> CONSOLIDATION GROUP
                    </label>
                    ${step.stepGroup ? `
                        <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
                            <span style="display:inline-flex;align-items:center;gap:5px;
                                         padding:3px 10px;border-radius:99px;font-size:10px;font-weight:600;
                                         background:var(--accent-glow);color:var(--accent);
                                         border:1px solid rgba(61,217,197,0.3);">
                                ${esc(step.stepGroup)}
                                <span onclick="OL._fvSetStepGroup('${resId}','${step.id}',null)"
                                      style="opacity:0.5;cursor:pointer;margin-left:2px;font-size:12px;line-height:1;"
                                      title="Remove from group">×</span>
                            </span>
                        </div>
                        <input type="text" class="modal-input tiny" placeholder="Rename group…"
                               value="${esc(step.stepGroup)}"
                               onblur="if(this.value.trim()) OL._fvSetStepGroup('${resId}','${step.id}',this.value)"
                               onkeydown="if(event.key==='Enter'){this.blur();}">
                    ` : `
                        <div class="tiny muted italic" style="padding:4px 0 6px;">Not grouped</div>
                        <input type="text" class="modal-input tiny" placeholder="Assign to group…"
                               onblur="if(this.value.trim()) OL._fvSetStepGroup('${resId}','${step.id}',this.value)"
                               onkeydown="if(event.key==='Enter'){this.blur();}">
                        <div class="tiny muted" style="margin-top:4px;opacity:0.6;">
                            Steps with the same group name across resources consolidate into one card in the visualizer.
                        </div>
                    `}
                </div>

                <div class="inspector-section">
                    <label class="section-label">
                        <i data-lucide="link-2" style="width:11px;height:11px;"></i> ATTACHED GUIDES & ASSETS
                    </label>
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
                    <label class="section-label">
                        <i data-lucide="calendar-clock" style="width:11px;height:11px;"></i> DYNAMIC SCHEDULING
                    </label>
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
                  <div class="section-label">
                    <i data-lucide="arrow-up-from-line" style="width:11px;height:11px;"></i> NEXT STEP
                </div>
                
                  ${(step.logic?.out || []).map((l, i) => {
                    const targetId = l.targetId || '';
                    let targetLabel = '— Select target —';
                    if (targetId) {
                      const lastH  = targetId.lastIndexOf('-');
                      const tResId = targetId.substring(0, lastH);
                      const tStepId = targetId.substring(lastH + 1);
                      const tRes  = (OL.getCurrentProjectData().resources||[]).find(r => String(r.id) === tResId);
                      const tStep = tRes?.steps?.find(s => String(s.id) === tStepId);
                      if (tRes && tStep) targetLabel = `${esc(tRes.name)} › ${esc(tStep.name||'Step')}`;
                    }
                    return `
                      <div style="background:var(--panel-soft);border:1px solid var(--panel-border);border-radius:8px;
                                  padding:10px 12px;margin-bottom:8px;">
                
                        <div style="display:flex;gap:4px;margin-bottom:8px;flex-wrap:wrap;">
                          ${[
                            { key:'next',      label:'Next',  icon:'arrow-right' },
                            { key:'condition', label:'If',    icon:'git-branch'  },
                            { key:'loop',      label:'Loop',  icon:'repeat'      },
                            { key:'delay',     label:'Delay', icon:'clock'       },
                          ].map(t => {
                            const types = (l.types || [l.type || 'next']);
                            const isOn  = types.includes(t.key);
                            return `
                              <span onclick="event.stopPropagation(); OL._fvToggleLogicType('${resId}','${step.id}',${i},'${t.key}')"
                                    style="display:inline-flex;align-items:center;gap:4px;
                                           font-size:9px;font-weight:700;padding:3px 9px;border-radius:99px;
                                           cursor:pointer;text-transform:uppercase;letter-spacing:0.05em;
                                           background:${isOn ? 'var(--accent)' : 'var(--panel-soft)'};
                                           color:${isOn ? 'var(--panel)' : 'var(--text-muted)'};
                                           border:1px solid ${isOn ? 'var(--accent)' : 'var(--panel-border)'};">
                                <i data-lucide="${t.icon}" style="width:10px;height:10px;pointer-events:none;"></i>
                                ${t.label}
                              </span>
                            `;
                          }).join('')}
                        </div>
                
                        <div style="position:relative;margin-bottom:${l.type==='condition'||l.type==='delay' ? '8px' : '0'};">
                          <div onclick="OL._fvOpenTargetPicker('${resId}','${step.id}',${i})"
                               style="padding:7px 10px;border:1px solid var(--panel-border);border-radius:8px;
                                      font-size:11px;color:${targetId ? 'var(--text-main)' : 'var(--text-muted)'};
                                      background:var(--panel);cursor:pointer;display:flex;
                                      align-items:center;justify-content:space-between;">
                            <span>${targetLabel}</span>
                            <i data-lucide="chevron-down" style="width:12px;height:12px;color:var(--text-muted);"></i>
                          </div>
                          <div id="target-picker-${resId}-${step.id}-${i}"
                               class="search-results-overlay" style="display:none;max-height:200px;overflow-y:auto;"></div>
                        </div>
                
                        ${(l.types||[l.type||'next']).includes('condition') ? `
                            <div style="margin-top:6px;">
                                <label style="font-size:9px;color:var(--text-muted);text-transform:uppercase;
                                               letter-spacing:0.06em;display:flex;align-items:center;gap:4px;margin-bottom:4px;">
                                    <i data-lucide="git-branch" style="width:9px;height:9px;"></i> Condition
                                </label>
                                <input type="text" class="fvi-input"
                                       placeholder="e.g. If approved..."
                                       value="${esc(l.rule||'')}"
                                       onblur="OL.updateStepLogic('${resId}','${step.id}','out',${i},'rule',this.value)">
                            </div>
                        ` : ''}
                        
                        ${(l.types||[l.type||'next']).includes('delay') ? `
                            <div style="margin-top:6px;">
                                <label style="font-size:9px;color:var(--text-muted);text-transform:uppercase;
                                               letter-spacing:0.06em;display:flex;align-items:center;gap:4px;margin-bottom:4px;">
                                    <i data-lucide="clock" style="width:9px;height:9px;"></i> Delay
                                </label>
                                <div style="display:flex;gap:6px;align-items:center;">
                                    <input type="number" class="fvi-input" style="width:70px;"
                                           placeholder="0"
                                           value="${esc(String(l.delayValue||''))}"
                                           onblur="OL.updateStepLogic('${resId}','${step.id}','out',${i},'delayValue',this.value)">
                                    <select class="fvi-select" style="flex:1;"
                                            onchange="OL.updateStepLogic('${resId}','${step.id}','out',${i},'delayUnit',this.value)">
                                        <option value="hours" ${l.delayUnit==='hours'?'selected':''}>Hours</option>
                                        <option value="days"  ${l.delayUnit==='days' ?'selected':''}>Days</option>
                                        <option value="weeks" ${l.delayUnit==='weeks'?'selected':''}>Weeks</option>
                                    </select>
                                </div>
                            </div>
                        ` : ''}
                        
                        ${(l.types||[l.type||'next']).includes('loop') ? `
                            <div style="margin-top:6px;">
                                <label style="font-size:9px;color:var(--text-muted);text-transform:uppercase;
                                               letter-spacing:0.06em;display:flex;align-items:center;gap:4px;margin-bottom:4px;">
                                    <i data-lucide="repeat" style="width:9px;height:9px;"></i> Loop limit
                                </label>
                                <input type="text" class="fvi-input"
                                       placeholder="e.g. 3 times, or leave blank for infinite"
                                       value="${esc(l.loopLimit||'')}"
                                       onblur="OL.updateStepLogic('${resId}','${step.id}','out',${i},'loopLimit',this.value)">
                            </div>
                        ` : ''}
                    
                        <button onclick="OL.removeStepLogic('${resId}','${step.id}','out',${i})"
                                style="margin-top:8px;width:100%;background:none;border:none;
                                       color:#ef4444;font-size:10px;cursor:pointer;
                                       text-align:left;padding:0;font-family:inherit;">
                          Remove
                        </button>
                      </div>
                    `;
                  }).join('')}
                
                  <button onclick="OL.addStepLogic('${resId}', '${step.id}', 'out')"
                          class="fvi-add-step-btn" style="margin-top:4px;">
                    + Add Output
                  </button>
                </div>

                <div class="inspector-section">
                    <label class="section-label">
                        <i data-lucide="tag" style="width:11px;height:11px;"></i> DATA REQUIREMENTS (INPUT/OUTPUT)
                    </label>
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
        if (window.lucide) window.lucide.createIcons();
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
                    <label class="section-label" style="margin:0;">
                        <i data-lucide="smartphone" style="width:11px;height:11px;"></i> PRIMARY APPLICATION
                    </label>
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
                    <label class="section-label">
                        <i data-lucide="link-2" style="width:11px;height:11px;"></i> EXTERNAL LINK
                    </label>
                    <input type="url" class="modal-input tiny" placeholder="https://..." value="${esc(res.externalLink || '')}" onblur="OL.handleResourceSave('${res.id}', 'externalLink', this.value)">
                </div>

                ${!isZap ? `
                <div class="inspector-section no-border">
                    <label class="section-label">
                        <i data-lucide="users" style="width:11px;height:11px;"></i> RESOURCE ASSIGNEE(S)
                    </label>
                    <div id="res-assignee-pills-${res.id}" class="pill-display assignee-row">
                        ${(res.assignees || []).length > 0 ? res.assignees.map((a, idx) => `
                            <span style="display:inline-flex;align-items:center;gap:5px;
                                         padding:3px 8px;border-radius:99px;font-size:10px;font-weight:600;
                                         background:var(--accent-glow);color:var(--accent);
                                         border:1px solid rgba(61,217,197,0.3);">
                                <i data-lucide="${a.type === 'person' ? 'user' : 'users'}" style="width:10px;height:10px;"></i>
                                ${esc(a.name)}
                                <span onclick="OL.removeResourceAssignee('${res.id}', ${idx})"
                                      style="opacity:0.5;cursor:pointer;margin-left:2px;font-size:12px;line-height:1;">×</span>
                            </span>
                        `).join('') : '<div class="tiny muted italic">Unassigned</div>'}
                    </div>
                    <div class="search-map-container">
                        <input type="text" class="modal-input tiny" placeholder="Search People or Roles..." onfocus="OL.filterAssignmentSearch('${res.id}', null, true, '')" oninput="OL.filterAssignmentSearch('${res.id}', null, true, this.value)">
                        <div id="res-assignment-results" class="search-results-overlay"></div>
                    </div>
                </div>
                ` : ''}

                <div class="inspector-section no-border">
                    <label class="section-label">
                        <i data-lucide="calendar" style="width:11px;height:11px;"></i> DUE DATE
                    </label>
                    <input type="date" class="modal-input tiny" value="${res.dueDate || ''}" onchange="OL.handleResourceSave('${res.id}', 'dueDate', this.value)">
                </div>

                <div class="inspector-section" style="position: relative; width: 100%;">
                    <label class="section-label" style="display: flex; align-items: center; gap: 6px; font-weight: 700; margin-bottom: 6px;">
                        <i data-lucide="milestone" style="width:11px; height:11px;"></i> STAGE & WORKFLOW
                    </label>
                    
                    <div class="fv-custom-select-trigger" 
                         onclick="event.stopPropagation(); const menu = this.nextElementSibling; menu.style.display = menu.style.display === 'block' ? 'none' : 'block';"
                         style="display: flex; align-items: center; justify-content: space-between; width: 100%; box-sizing: border-box; padding: 6px 12px; background:var(--panel); border:1px solid var(--panel-border); color:var(--text-main); border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; min-height: 32px; user-select: none;">
                        <span>
                            ${(function() {
                                if (!res.stageId && !res.workflowId) return 'Unassigned (Workbench Side-Tray)';
                                const projectData = OL.getCurrentProjectData();
                                if (res.workflowId) {
                                    const wf = (projectData.workflows || []).find(w => String(w.id) === String(res.workflowId));
                                    return wf ? `Workflow: ${esc(wf.name)}` : 'Select Location...';
                                }
                                const stg = (projectData.stages || []).find(s => String(s.id) === String(res.stageId));
                                return stg ? `Stage: ${esc(stg.name)}` : 'Select Location...';
                            })()}
                        </span>
                        <i data-lucide="chevron-down" style="width: 14px; height: 14px; opacity: 0.6; color:var(--text-dim);"></i>
                    </div>
                
                    <div class="fv-custom-select-menu" 
                         style="display: none; position: absolute; top: 100%; left: 0; width: 100%; z-index: 100; background:var(--panel); border:1px solid var(--panel-border); border-radius: 6px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -1px rgba(0,0,0,0.06); max-height: 250px; overflow-y: auto; margin-top: 4px; box-sizing: border-box;">
                        
                        <div class="fv-custom-option" 
                             style="padding: 8px 12px; font-size: 11px; font-weight: 700; color: #ef4444; cursor: pointer; border-bottom: 1px solid #f3f4f6;"
                             onclick="
                                 OL.handleResourceSave('${res.id}', 'stageId', '');
                                 OL.handleResourceSave('${res.id}', 'workflowId', '');
                                 OL._fvOpenStepsList('${res.id}');
                                 this.parentElement.style.display = 'none';
                             "
                             onmouseover="this.style.background='rgba(239,68,68,0.08)';"
                             onmouseout="this.style.background='transparent';">
                             Remove Assignment (Workbench Side-Tray)
                        </div>
                
                        ${(function() {
                            const projectData = OL.getCurrentProjectData();
                            const currentStages = projectData.stages || [];
                            const currentWorkflows = projectData.workflows || [];
                            
                            return currentStages.map(s => {
                                const stageWorkflows = currentWorkflows.filter(w => String(w.stageId) === String(s.id));
                                
                                return `
                                    <div class="fv-custom-option stage-header-row" 
                                         style="padding: 8px 12px; font-size: 11px; font-weight: 700; color:var(--text-main); background:var(--panel-dark); border-bottom: 1px solid #f3f4f6; display: flex; align-items: center; gap: 4px; cursor: pointer;"
                                         onclick="
                                             OL.handleResourceSave('${res.id}', 'stageId', '${s.id}');
                                             OL.handleResourceSave('${res.id}', 'workflowId', '');
                                             OL._fvOpenStepsList('${res.id}');
                                             this.parentElement.style.display = 'none';
                                         "
                                         onmouseover="this.style.background='var(--panel-soft)';"
                                         onmouseout="this.style.background='var(--panel-dark)';">
                                         <i data-lucide="folder" style="width:12px; height:12px; color:var(--text-dim);"></i>
                                         <span>STAGE: ${esc(s.name.toUpperCase())}</span>
                                    </div>
                                    
                                    ${stageWorkflows.map(wf => `
                                        <div class="fv-custom-option workflow-item-row" 
                                             style="padding: 8px 12px 8px 24px; font-size: 12px; font-weight: 500; color:var(--text-main); cursor: pointer; border-bottom: 1px solid #f9fafb; display: flex; align-items: center; gap: 4px; transition: background 0.1s;"
                                             onclick="
                                                 OL.handleResourceSave('${res.id}', 'stageId', '${s.id}');
                                                 OL.handleResourceSave('${res.id}', 'workflowId', '${wf.id}');
                                                 OL._fvOpenStepsList('${res.id}');
                                                 this.parentElement.style.display = 'none';
                                             "
                                             onmouseover="this.style.background='rgba(61,217,197,0.08)'; this.style.color='#0d9488';"
                                             onmouseout="this.style.background='transparent'; this.style.color='var(--text-main)';">
                                             <i data-lucide="git-commit" style="width:12px; height:12px; opacity: 0.5;"></i>
                                             <span>${esc(wf.name)}</span>
                                        </div>
                                    `).join('')}
                                `;
                            }).join('');
                        })()}
                    </div>
                </div>
                
                <script>
                    // Global auto-dismiss framework listener loop
                    document.addEventListener('click', function() {
                        document.querySelectorAll('.fv-custom-select-menu').forEach(el => el.style.display = 'none');
                    });
                </script>

                <div class="inspector-section">
                    <label class="section-label">
                        <i data-lucide="folder" style="width:11px;height:11px;"></i> CLASSIFICATION
                    </label>
                    <div style="display:flex;gap:8px;align-items:center;">
                        <select class="modal-input tiny" onchange="OL.handleResourceSave('${res.id}', 'type', this.value); OL.openInspector('${res.id}', null, 'cards');">
                            <option value="General" ${res.type === 'General' ? 'selected' : ''}>General</option>
                            ${(state.master.resourceTypes || []).map(t => `<option value="${esc(t.type)}" ${res.type === t.type ? 'selected' : ''}>${esc(t.type)}</option>`).join('')}
                        </select>
                        <button onclick="event.preventDefault(); event.stopPropagation(); 
                                         OL.handleResourceSave('${res.id}', 'isArchived', ${!res.isArchived}); 
                                         renderResourceManager();"
                                title="${res.isArchived ? 'Unarchive' : 'Archive'}"
                                style="color:${res.isArchived ? '#ef4444' : 'var(--text-muted)'};">
                            <i data-lucide="archive" style="width:12px;height:12px;"></i>
                        </button>
                    </div>
                </div>

                <div class="inspector-section">
                    <label class="section-label">
                        <i data-lucide="globe" style="width:11px;height:11px;"></i> VISIBILITY
                    </label>
                    <div style="display:flex;align-items:center;gap:8px;">
                        <button onclick="OL.handleResourceSave('${res.id}', 'isGlobal', ${!res.isGlobal}); OL.openInspector('${res.id}', null, 'cards');"
                                style="padding:4px 10px;border-radius:99px;font-size:11px;font-weight:600;cursor:pointer;
                                       border:1px solid ${res.isGlobal ? '#3dd9c5' : 'var(--panel-border)'};
                                       background:${res.isGlobal ? 'rgba(61,217,197,0.1)' : 'var(--panel-soft)'};
                                       color:${res.isGlobal ? '#3dd9c5' : 'var(--text-muted)'};">
                            🌐 ${res.isGlobal ? 'Global (click to unset)' : 'Set as Global'}
                        </button>
                    </div>
                </div>

                <div class="inspector-section">
                    <label class="section-label">
                        <i data-lucide="file-text" style="width:11px;height:11px;"></i> DESCRIPTION
                    </label>
                    <textarea class="modal-textarea res-desc-input" placeholder="Notes..." onblur="OL.handleResourceSave('${res.id}', 'description', this.value)">${esc(res.description || '')}</textarea>
                </div>
            </div>
        `;
        if (window.lucide) window.lucide.createIcons();
        return;
    }

    content.innerHTML = `<div class="muted-notice">Select a card or step to inspect.</div>`;
    if (window.lucide) window.lucide.createIcons();
}; 

OL.executeStepMove = function(fromResId, stepId, toResId) {
    const data = OL.getCurrentProjectData();
    const fromRes = data.resources.find(r => String(r.id) === String(fromResId));
    const toRes   = data.resources.find(r => String(r.id) === String(toResId));
    if (!fromRes || !toRes) return;

    const stepIdx = (fromRes.steps || []).findIndex(s => String(s.id) === String(stepId));
    if (stepIdx === -1) return;

    const [movedStep] = fromRes.steps.splice(stepIdx, 1);
    if (!toRes.steps) toRes.steps = [];
    toRes.steps.push(movedStep);

    OL.persist();

    // Refresh whichever view is active
    const modalOpen = document.getElementById('modal-layer')?.style.display === 'flex';
    if (modalOpen) {
        OL.openResourceModal(fromResId);
    } else {
        OL._fvOpenStepsList(fromResId);
    }
};

OL._fvToggleLogicType = function(resId, stepId, idx, type) {
    const data = OL.getCurrentProjectData();
    const res  = (data.resources||[]).find(r => String(r.id) === resId);
    const step = res?.steps?.find(s => String(s.id) === stepId);
    if (!step?.logic?.out?.[idx]) return;

    const rule = step.logic.out[idx];
    if (!rule.types) rule.types = [rule.type || 'next'];

    const pos = rule.types.indexOf(type);
    if (pos === -1) {
        rule.types.push(type);
    } else {
        rule.types.splice(pos, 1);
        if (rule.types.length === 0) rule.types = ['next'];
    }
    // Keep legacy type field in sync with first type
    rule.type = rule.types[0];

    OL.persist();
    OL._fvRefreshInspector(resId, stepId);
};

OL._fvOpenTargetPicker = function(resId, stepId, idx) {
    const pickerId = `target-picker-${resId}-${stepId}-${idx}`;
    const picker   = document.getElementById(pickerId);
    if (!picker) return;

    const isOpen = picker.style.display === 'block';
    document.querySelectorAll('.search-results-overlay').forEach(el => el.style.display = 'none');
    if (isOpen) return;

    const data      = OL.getCurrentProjectData();
    const resources = (data.resources||[]).filter(r => !r.isDeleted && !r.isLocked);

    const buildList = (q) => {
        let html = '';
        resources.forEach(res => {
            if (!(res.steps||[]).length) return;
            const steps = res.steps.filter(s => 
                !q || 
                (s.name||'').toLowerCase().includes(q) || 
                res.name.toLowerCase().includes(q)
            );
            if (!steps.length) return;
            html += `<div style="padding:6px 10px;font-size:9px;font-weight:700;
                                 text-transform:uppercase;letter-spacing:0.08em;
                                 color:var(--text-muted);background:var(--panel-soft);">
                       ${esc(res.name)}
                     </div>`;
            steps.forEach(s => {
                const fullId = `${res.id}-${s.id}`;
                html += `<div class="search-result-item"
                              onmousedown="OL.updateStepTarget('${resId}','${stepId}','out',${idx},'${fullId}')">
                           ${esc(s.name || 'Unnamed Step')}
                         </div>`;
            });
        });
        return html || '<div class="search-result-item muted">No steps found.</div>';
    };

    picker.innerHTML = `
        <div style="padding:8px;border-bottom:1px solid #e5e7eb;position:sticky;top:0;background:var(--panel);z-index:1;">
            <input type="text" class="fvi-input" placeholder="Search steps..."
                   style="margin:0;"
                   oninput="document.getElementById('${pickerId}-list').innerHTML = 
                       (function(q){ 
                           ${resources.map(res => '').join('')}
                       })(this.value.toLowerCase().trim())"
                   autofocus>
        </div>
        <div id="${pickerId}-list">${buildList('')}</div>
    `;

    // Wire up the search properly after render
    const input = picker.querySelector('input');
    if (input) {
        input.addEventListener('input', () => {
            const list = document.getElementById(`${pickerId}-list`);
            if (list) list.innerHTML = buildList(input.value.toLowerCase().trim());
        });
        setTimeout(() => input.focus(), 50);
    }

    picker.style.display = 'block';
};

window.renderStepResources = function(resId, step) {
    const links = step.links || [];
    if (links.length === 0) return '<div class="tiny muted" style="padding:5px;opacity:0.6;">No linked items.</div>';
    
    return links.map((link, idx) => {
        const isSOP = link.type === 'sop' || link.type === 'guide';
        const icon = isSOP ? 'book-open' : 'database';
        const openAction = isSOP ? `OL.openGuideEditor('${link.id}')` : `OL.openResourceModal('${link.id}')`;
        const deleteAction = `event.stopPropagation(); OL.removeStepLink('${resId}', '${step.id}', ${idx})`;

        return `
            <span onclick="${openAction}"
                  style="display:inline-flex;align-items:center;gap:5px;
                         padding:3px 8px;border-radius:99px;font-size:10px;font-weight:600;
                         background:var(--accent-glow);color:var(--accent);
                         border:1px solid rgba(61,217,197,0.3);
                         cursor:pointer;margin-bottom:4px;margin-right:4px;">
                <i data-lucide="${icon}" style="width:10px;height:10px;pointer-events:none;"></i>
                <span style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                    ${esc(link.name)}
                </span>
                <span onclick="${deleteAction}"
                      style="opacity:0.5;cursor:pointer;margin-left:2px;font-size:12px;line-height:1;">×</span>
            </span>
        `;
    }).join('');
};

OL.updateAtomicStep = function(resId, stepId, field, value) {
    const data = OL.getCurrentProjectData(); 
    const projectResources = data.resources || [];
    
    let targetRes = projectResources.find(r => String(r.id) === String(resId));
    if (!targetRes) {
        targetRes = (state.master?.resources || []).find(r => String(r.id) === String(resId));
    }
    if (!targetRes?.steps) return;

    const step = targetRes.steps.find(s => String(s.id) === String(stepId));
    if (!step) return;

    step[field] = value;
    OL.persist();

    // Surgical DOM updates — no full re-render
    if (field === 'name') {
        // Update step name in list view if visible
        const stepRow = document.getElementById(`fv-list-step-${stepId}`);
        if (stepRow) {
            const nameEl = stepRow.querySelector('.fv-list-step-name');
            if (nameEl) nameEl.textContent = value;
        }
        // Update step in inspector steps list
        const fviRow = document.querySelector(`[onclick*="'${stepId}'"] .fvi-step-name`);
        if (fviRow) fviRow.textContent = value;
        // Update card in flowchart if visible
        const cardStep = document.querySelector(`.fv-card-step-name[data-step-id="${stepId}"]`);
        if (cardStep) cardStep.textContent = value;
    }
    // For all other fields, refresh just the inspector content
    // preserving scroll position
    else {
        OL._fvRefreshInspector(resId, stepId);
    }
};

// Add this helper:
OL._fvRefreshInspector = function(resId, stepId) {
    // Save scroll position
    const scrollContent = document.querySelector('.inspector-scroll-content');
    const scrollTop = scrollContent?.scrollTop || 0;
    
    // Re-render inspector content only
    OL.openInspector(resId, stepId);
    
    // Restore scroll
    requestAnimationFrame(() => {
        const newScrollContent = document.querySelector('.inspector-scroll-content');
        if (newScrollContent) newScrollContent.scrollTop = scrollTop;
    });
};

OL.filterAppSearch = function(parentId, stepId, arg3, arg4) {
    // Two calling conventions exist in the codebase:
    //   (parentId, stepId, query)                  → step-level search, results in #app-search-results
    //   (parentId, stepId, isResourceLevel, query)  → resource-level search, results in #res-app-results
    let query, isResourceLevel;
    if (arg4 !== undefined) {
        isResourceLevel = !!arg3;
        query = arg4;
    } else {
        isResourceLevel = false;
        query = arg3;
    }
 
    const resultsId = isResourceLevel ? 'res-app-results' : 'app-search-results';
    const resultsOverlay = document.getElementById(resultsId);
    if (!resultsOverlay) return;
 
    const q = String(query || "").toLowerCase().trim();
    const client = getActiveClient();
    const localApps = client?.projectData?.localApps || [];
    const matches = localApps.filter(a => a.name.toLowerCase().includes(q));
 
    if (matches.length === 0) {
        resultsOverlay.innerHTML = `<div class="p-10 tiny muted">No apps found.</div>`;
        resultsOverlay.style.display = 'block';
        return;
    }
 
    const selectFn = isResourceLevel ? 'OL.selectAppForResource' : 'OL.selectAppForStep';
 
    resultsOverlay.innerHTML = matches.map(app => `
        <div class="search-result-item"
             style="cursor: pointer; padding: 8px; border-bottom: 1px solid var(--line);"
             onmousedown="event.preventDefault(); event.stopPropagation(); ${selectFn}('${parentId}', '${stepId}', '${app.id}', '${esc(app.name)}');">
            <div style="display:flex; align-items:center; gap:8px;">
                <span>💻</span>
                <div>${esc(app.name)}</div>
            </div>
        </div>
    `).join('');
 
    resultsOverlay.style.display = 'block';
};
 
// 🚀 NEW: resource-level counterpart to the existing OL.selectAppForStep.
// This didn't exist before — the resource-level search had nothing to call
// even if it had worked.
window.OL.selectAppForResource = async function(resId, _unused, appId, appName) {
    const overlay = document.getElementById('res-app-results');
    if (overlay) overlay.style.display = 'none';
 
    // OL.handleResourceSave already persists and refreshes whichever view
    // (modal / inspector / grid) is currently showing this resource.
    OL.handleResourceSave(resId, 'appId', appId);
    OL.handleResourceSave(resId, 'appName', appName);
};
 
window.OL.selectAppForStep = async function(parentId, stepId, appId, appName) {
    const res = OL.getResourceById(parentId);
    if (!res) return;
    const step = (res.steps || []).find(s => String(s.id) === String(stepId));
    if (!step) return;

    // 1. Update data
    step.appId   = appId;
    step.appName = appName;

    // 2. Hide overlay immediately
    const overlay = document.getElementById('app-search-results');
    if (overlay) overlay.style.display = 'none';

    // 3. Persist
    OL.persist();

    // 4. Re-render inspector with correct argument order
    OL.openInspector(parentId, stepId);
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
        OL._fvRefreshInspector(resId, stepId);
    }
};

OL.getFilteredAssigneeOptions = function(query) {
    const q = (query || "").toLowerCase().trim();
    const client = getActiveClient();
    
    // 1. Define Virtual & Global Options
    const virtualOptions = [
        { id: 'any-team', name: 'Any Team Member', type: 'role', icon: '👥' },
        { id: 'all-client', name: 'Any Client', type: 'role', icon: '🏠' },
        { id: 'role-client-1', name: 'Client 1', type: 'role', icon: '👨‍💼' },
        { id: 'role-client-2', name: 'Client 2', type: 'role', icon: '👨‍💼' },
        { id: 'role-coi', name: 'COI', type: 'role', icon: '👨‍💼' },
        { id: 'role-sphynx', name: 'Sphynx', type: 'role', icon: '👩‍🎤' }
    ];

    // 2. Gather Dynamic Data
    const masterRoles = (state.master.roles || []).map(r => ({ id: r.id, name: r.name, type: 'role', icon: '🎭' }));
    const clientRoles = (client?.projectData?.roles || []).map(r => ({ id: r.id, name: r.name, type: 'role', icon: '🎭' }));
    
    // Extract roles defined within the team member objects themselves
    const teamList = [...(state.master.teamMembers || []), ...(client?.projectData?.teamMembers || [])];
    const inlineRoles = [...new Set(teamList.flatMap(m => m.roles || []))].map(r => ({ id: `role-${r}`, name: r, type: 'role', icon: '🎭' }));

    const people = teamList.map(m => ({ id: m.id, name: m.name, type: 'person', icon: '👨‍💼' }));
    const apps = (client?.projectData?.localApps || []).map(a => ({ id: a.id, name: a.name, type: 'app', icon: '💻' }));

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
        OL._fvRefreshInspector(resId, stepId);
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
    
    const allResources = [...(state.master.resources || []), ...(client?.projectData?.localResources || [])];
    const filteredRes = allResources.filter(r => r.id !== resId && r.name.toLowerCase().includes(q));
    const allHowTos = [...(state.master.howToLibrary || []), ...(client?.projectData?.localHowTo || [])];
    const filteredHowTos = allHowTos.filter(h => h.name.toLowerCase().includes(q));

    if (!filteredRes.length && !filteredHowTos.length) {
        resultsOverlay.innerHTML = `<div class="p-10 tiny muted">No matches found.</div>`;
        resultsOverlay.style.display = 'block';
        return;
    }

    let html = '';

    if (filteredRes.length) {
        html += `<div class="search-category-label">Project Assets</div>`;
        html += filteredRes.map(r => `
            <div class="search-result-item" style="display:flex; align-items:center; gap:8px;"
                 onmousedown="event.preventDefault(); OL.addLinkToStep('${resId}', '${stepId}', '${r.id}', '${esc(r.name)}', '${esc(r.type)}')">
                ${OL.getLucideSVG(OL.getRegistryIcon(r.type), 13, 'var(--accent)')}
                ${esc(r.name)}
            </div>`).join('');
    }

    if (filteredHowTos.length) {
        html += `<div class="search-category-label">How-To Guides</div>`;
        html += filteredHowTos.map(h => `
            <div class="search-result-item" style="display:flex; align-items:center; gap:8px;"
                 onmousedown="event.preventDefault(); OL.addLinkToStep('${resId}', '${stepId}', '${h.id}', '${esc(h.name)}', 'SOP')">
                ${OL.getLucideSVG('book-open', 13, 'var(--accent)')}
                ${esc(h.name)}
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
    if (!step) return;

    if (step.links?.some(l => l.id === linkId)) return; // already linked

    const relType = await OL.promptLinkType(linkName);
    if (!relType) return; // user cancelled

    if (!step.links) step.links = [];
    step.links.push({ id: linkId, name: linkName, type, relType });

    await OL.persist();

    const overlay = document.getElementById(`resource-results-${stepId}`);
    if (overlay) overlay.style.display = 'none';

    OL._fvRefreshInspector(resId, stepId);
};

OL.promptLinkType = function(name) {
    return new Promise(resolve => {
        const id = 'link-type-picker-' + Date.now();
        const html = `
            <div class="modal-head">
                <div class="modal-title-text">How is "${esc(name)}" used?</div>
            </div>
            <div class="modal-body">
                <div style="display:flex; flex-direction:column; gap:8px;">
                    ${[
                        { key: 'triggers',  icon: 'zap',           label: 'Triggers',  desc: 'This step fires or sends this asset',        color: '#f59e0b' },
                        { key: 'requires',  icon: 'arrow-down-to-line', label: 'Requires',  desc: 'This step needs this asset to run',          color: '#38bdf8' },
                        { key: 'produces',  icon: 'arrow-up-from-line', label: 'Produces',  desc: 'This step creates or outputs this asset',    color: '#10b981' },
                        { key: 'references',icon: 'link-2',        label: 'References', desc: 'This step refers to or reads from this asset', color: '#a78bfa' },
                    ].map(t => `
                        <div onclick="window._resolveLinkType('${t.key}')"
                             style="display:flex; align-items:center; gap:12px; padding:12px;
                                    border:1px solid var(--line); border-radius:8px; cursor:pointer;
                                    transition:all 0.15s;"
                             onmouseover="this.style.borderColor='${t.color}'; this.style.background='${t.color}18';"
                             onmouseout="this.style.borderColor='var(--line)'; this.style.background='transparent';">
                            <div style="width:32px; height:32px; border-radius:6px; flex-shrink:0;
                                        background:${t.color}18; border:1px solid ${t.color}44;
                                        display:flex; align-items:center; justify-content:center;">
                                <i data-lucide="${t.icon}" style="width:16px; height:16px; color:${t.color};"></i>
                            </div>
                            <div>
                                <div style="font-weight:600; font-size:13px;">${t.label}</div>
                                <div class="tiny muted">${t.desc}</div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
        window._resolveLinkType = (val) => {
            delete window._resolveLinkType;
            OL.closeModal();
            resolve(val);
        };
        openModal(html);
        if (window.lucide) lucide.createIcons();
    });
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
        OL._fvRefreshInspector(resId, stepId);
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
    const resources = data.resources || [];
    const res = resources.find(r => String(r.id) === String(resId));
    
    // 🎯 ID-Aware lookup
    let step = res?.steps.find(s => String(s.id) === String(stepTarget));
    if (!step && isFinite(stepTarget)) step = res?.steps[stepTarget];

    if (!step || !step.logic) return;

    // 1. 🔍 IDENTIFY THE PARTNER before deleting
    const itemToRemove = step.logic[direction][logicIdx];
    const myFullId = `${resId}-${step.id}`;
    
    // If we're deleting an Output, the partner is the TargetId. 
    // If we're deleting an Input, the partner is the SourceId.
    const partnerFullId = direction === 'out' ? itemToRemove.targetId : itemToRemove.sourceId;

    if (partnerFullId) {
        const lastHyphen = String(partnerFullId).lastIndexOf('-');
        const pResId = partnerFullId.substring(0, lastHyphen);
        const pStepId = partnerFullId.substring(lastHyphen + 1);
        
        const partnerRes = resources.find(r => String(r.id) === String(pResId));
        const partnerStep = partnerRes?.steps.find(s => String(s.id) === String(pStepId));

        if (partnerStep && partnerStep.logic) {
            // 🧹 Clean the mirror side
            if (direction === 'out') {
                // We are 'Out', so remove the 'In' from the target
                partnerStep.logic.in = (partnerStep.logic.in || []).filter(l => l.sourceId !== myFullId);
            } else {
                // We are 'In', so remove the 'Out' from the source
                partnerStep.logic.out = (partnerStep.logic.out || []).filter(l => l.targetId !== myFullId);
            }
        }
    }

    // 2. 🔥 DELETE THE LOCAL RULE
    step.logic[direction].splice(logicIdx, 1);
    
    // 3. 💾 PERSIST & REFRESH
    await OL.persist(); 
    
    // Draw connections to clear the lines from the map
    if (typeof OL.drawConnections === 'function') OL.drawConnections();
    
    // Refresh the inspector to show the rule is gone
    OL.openInspector(resId, step.id); 
    console.log(`🧹 Ghost link removed from ${partnerFullId}`);
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
    container.style.cssText = '';
    document.body.classList.remove('is-visualizer');

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
    <div class="section-header" style="display:flex; align-items:center; gap:12px;">
        <i data-lucide="table-properties" style="width:28px; height:24px; color:var(--accent);"></i>
        <div style="flex:1;">
            <h2 style="margin:0;">${esc(client.meta.name)} Scoping Sheet</h2>
        </div>
        <div class="header-actions">
            <button class="btn small soft" onclick="OL.toggleScopingUnits()" style="display:flex; align-items:center; gap:6px;">
                <i data-lucide="${showUnits ? "eye-off" : "eye"}" style="width:14px; height:14px;"></i>
                ${showUnits ? "Hide Units" : "Show Units"}
            </button>
            
            ${(state.adminMode || window.location.search.includes('admin=')) ? `
                <button class="btn small soft" onclick="OL.universalCreate('SOP')" style="display:flex; align-items:center; gap:6px;">
                    <i data-lucide="plus" style="width:14px; height:14px;"></i> New Resource
                </button>
                <button class="btn primary" onclick="OL.addResourceToScope()" style="display:flex; align-items:center; gap:6px;">
                    <i data-lucide="library" style="width:14px; height:14px;"></i> Add From Library
                </button>
            ` : ''}
        </div>
    </div>

    ${state.scopingFilterActive ? `
        <div style="display: flex; gap: 10px; margin-bottom: 20px;">
            <button class="btn primary" style="display:flex; align-items:center; gap:6px;"
                    onclick="state.scopingFilterActive = false; state.scopingTargetId = null; location.hash='#/scoping-sheet';">
                <i data-lucide="arrow-left" style="width:14px; height:14px;"></i> Show Full Scoping Sheet
            </button>
            <button class="btn soft" style="display:flex; align-items:center; gap:6px;"
                    onclick="state.scopingFilterActive = false; state.scopingTargetId = null; location.hash='#/visualizer';">
                <i data-lucide="map" style="width:14px; height:14px;"></i> Back to Flow Map
            </button>
        </div>
    ` : ''}

    ${wfContext ? `
        <div class="workflow-context-widget" 
             style="background: rgba(56, 189, 248, 0.05); border: 1px solid rgba(56, 189, 248, 0.2); padding: 12px 15px; border-radius: 8px; margin-bottom: 25px; display: flex; align-items: center; gap: 15px;">
            <i data-lucide="workflow" style="width:24px; height:24px; color:var(--accent);"></i>
            <div style="flex: 1;">
                <div class="tiny accent bold uppercase" style="font-size: 9px; letter-spacing: 0.05em;">Active Mapping Context</div>
                <div style="font-weight: bold; color: white; font-size: 14px;">${esc(wfContext.name)}</div>
                <div class="tiny muted">${wfContext.summary}</div>
            </div>
            <button class="btn tiny primary" onclick="location.hash='#/visualizer'" style="display:flex; align-items:center; gap:6px;">
                View Map <i data-lucide="chevron-right" style="width:12px; height:12px;"></i>
            </button>
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
    
    if (window.lucide) {
        window.lucide.createIcons();
    }
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
    if (window.lucide) {
        window.lucide.createIcons();
    }
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
                    <div class="row-title text-danger" style="display:flex; align-items:center; gap:6px;">
                        <i data-lucide="alert-triangle" style="width:14px; height:14px; color:#ef4444;"></i>
                        Missing Resource
                    </div>
                    <div class="tiny muted">Item: ${item.id}</div>
                </div>
                <div class="col-status">N/A</div>
                <div class="col-team">N/A</div>
                <div class="col-gross">N/A</div>
                <div class="col-discount">—</div>
                <div class="col-numeric">$0</div>
                <div class="col-actions">
                    ${isAdmin ? `
                        <button class="card-delete-btn" style="opacity: 0.3; display:flex; align-items:center; justify-center;" onclick="OL.removeFromScopeByID('${item.id}')">
                            <i data-lucide="x" style="width:14px; height:14px;"></i>
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
    }

    const typeIcon = OL.getRegistryIcon(res.type);

    // 2. Financial Calculations
    const status = (item.status || "").toLowerCase();
    const party = (item.responsibleParty || "").toLowerCase();

    const isBillable = party === 'sphynx' || party === 'joint';
    const isCounted = status === 'do now' && isBillable;

    const gross = OL.calculateBaseFeeWithMultiplier(item, res);
    const net = isCounted ? OL.calculateRowFee(item, res) : gross; 
    const discountAmt = gross - net;

    const combinedData = { ...(res.data || {}), ...(item.data || {}) };
    const unitsHtml = showUnits ? OL.renderUnitBadges(combinedData, res) : "";

    const projectTeam = client?.projectData?.teamMembers || [];
    const mode = (item.teamMode || 'everyone').toLowerCase();

    // 3. Team UI Logic
    let hoverText = '';
    let teamLabel = '';
    let btnIcon = `<i data-lucide="users" style="width:14px; height:14px;"></i>`;
    let btnClass = 'soft';
    const multiplierHtml = `<span class="multiplier-tag">${OL.getMultiplierDisplay(item)}</span>`;

    if (mode === 'global') {
        teamLabel = '<span class="tiny muted italic">Global Item</span>';
        hoverText = "Applies to the entire project scope";
        btnIcon = `<i data-lucide="globe" style="width:14px; height:14px;"></i>`;
        btnClass = 'accent';
    } else if (mode === 'individual') {
        const selectedIds = item.teamIds || []; 
        const selectedCount = selectedIds.length;
        btnIcon = `<i data-lucide="user" style="width:14px; height:14px;"></i>`;
        btnClass = 'primary';
        const names = selectedIds
            .map(id => projectTeam.find(tm => tm.id === id)?.name || "Unknown")
            .filter(n => n !== "Unknown");

        if (selectedCount > 0) {
            teamLabel = `<span class="tiny muted">Individuals (${selectedCount})</span>`;
            hoverText = names.join(", ");
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
    ? `onclick="OL.openTeamAssignmentModal('${item.id}')" class="btn tiny ${btnClass}" style="display:inline-flex; align-items:center; justify-content:center; padding: 4px 6px;"` 
    : `class="btn tiny ${btnClass}" style="cursor: default; pointer-events: none; opacity: 0.9; display:inline-flex; align-items:center; justify-content:center; padding: 4px 6px;"`;

    const isTarget = state.scopingFilterActive && String(item.resourceId) === String(state.scopingTargetId);

    // Refresh Lucide icons after DOM insertion
    setTimeout(() => { if (window.lucide) window.lucide.createIcons(); }, 0);

    return `
        <div class="grid-row ${isTarget ? 'surgical-focus-row' : ''}" style="border-bottom: 1px solid var(--line); padding: 8px 10px;">
        <div class="col-expand">
            <div class="row-title is-clickable" style="display:flex; align-items:center; gap:6px;" onclick="OL.openResourceModal('${item.id}')">
                ${OL.getLucideSVG(OL.getRegistryIcon(res.type), 13, 'var(--accent)')}
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
                <button class="card-delete-btn" style="opacity: 0.3; display:flex; align-items:center; justify-content:center;" onclick="OL.removeFromScopeByID('${item.id}')">
                    <i data-lucide="x" style="width:14px; height:14px;"></i>
                </button>
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
        <button class="btn tiny soft" onclick="OL.printScopingSheet()">🖨️ PDF</button>
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

OL.updateVarRate = async function(key, field, val) {
    if (!state.master.rates.variables[key]) return;
 
    state.master.rates.variables[key][field] = field === 'value' ? parseFloat(val) || 0 : val.trim();
 
    // Supabase has no dot-notation partial update — write back the whole rates object,
    // same pattern OL.persist() already uses for master data.
    const { error } = await window.db
        .from('workspace_masters')
        .update({ rates: state.master.rates })
        .eq('id', 'main_state');
 
    if (error) {
        console.error('❌ Rate save failed:', error.message);
        return;
    }
    console.log('✅ Variable saved:', key, field, val);
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

    const icon = isTask ? OL.getLucideSVG('clipboard-list', 14, 'currentColor') : OL.getLucideSVG(OL.getRegistryIcon(obj?.type), 14, 'currentColor');
    
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
                <span style="display:flex; align-items:center; gap:6px;">
                    ${OL.getLucideSVG(OL.getRegistryIcon(r.type), 13, 'var(--accent)')}
                    ${esc(r.name)}
                </span>
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
                `<span class="pill tiny soft" style="font-size: 8px; display:flex; align-items:center; gap:3px;">
                  <i data-lucide="shield" style="width:8px; height:8px;"></i> ${esc(r)}
                </span>`,
            )
            .join("")
        : `<span class="tiny muted uppercase" style="display:flex; align-items:center; gap:4px;">
            <i data-lucide="user" style="width:10px; height:10px;"></i> ${esc(m.role || "Contributor")}
           </span>`;

      return `
           <div class="card is-clickable hover-trigger" onclick="OL.openTeamMemberModal('${m.id}')" style="padding:15px;">
              <div class="card-header" style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:10px;">
                  <div style="display:flex; align-items:center; gap:10px;">
                    <div style="background:var(--accent); color:black; width:32px; height:32px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:bold; font-size:12px;">
                        ${m.name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2)}
                    </div>
                    <div class="card-title tm-card-title-${m.id}" style="font-weight:bold;">${esc(m.name)}</div>
                  </div>
                  <button class="card-delete-btn" style="position:static;" onclick="event.stopPropagation(); OL.removeTeamMember('${m.id}')">
                    <i data-lucide="x" style="width:14px; height:14px;"></i>
                  </button>
              </div>
              <div class="card-body">
                  <div class="pills-row" style="display: flex; flex-wrap: wrap; gap: 4px;">
                      ${rolesHtml}
                  </div>
              </div>
          </div>
      `;
    })
    .join("");

  container.innerHTML = `
        <div class="section-header" style="display:flex; align-items:center; gap:12px;">
            <i data-lucide="users" style="width:28px; height:24px; color:var(--accent);"></i>
            <div style="flex:1;">
                <h2 style="margin:0;">Team Members</h2>
                <div class="small muted subheader">Manage members assigned to ${esc(client.meta.name)}</div>
            </div>
            <button class="btn primary" onclick="OL.promptAddTeamMember()" style="display:flex; align-items:center; gap:6px;">
                <i data-lucide="user-plus" style="width:16px; height:16px;"></i> Add Member
            </button>
            ${OL.viewToggleBtn('team', 'renderTeamManager')}
        </div>
        ${OL.getViewMode('team') === 'list' ? `
            <div style="display:flex;flex-direction:column;gap:2px;margin-top:10px;">
                ${members.map(m => `
                    <div style="display:flex;align-items:center;gap:12px;padding:10px 16px;
                                background:var(--panel-soft);border:1px solid var(--panel-border);
                                border-radius:8px;cursor:pointer;transition:border-color 0.2s;"
                         onclick="OL.openTeamMemberModal('${m.id}')"
                         onmouseover="this.style.borderColor='var(--accent)'"
                         onmouseout="this.style.borderColor='var(--panel-border)'">
                        <div style="width:28px;height:28px;border-radius:6px;background:var(--accent);
                                    color:#000;display:flex;align-items:center;justify-content:center;
                                    font-weight:900;font-size:11px;flex-shrink:0;">
                            ${m.name.split(' ').map(n=>n[0]).join('').toUpperCase().substring(0,2)}
                        </div>
                        <span style="font-weight:600;font-size:13px;flex:1;">${esc(m.name)}</span>
                        <div class="pills-row" style="margin:0;gap:4px;">
                            ${(m.roles||[]).map(r=>`<span class="pill tiny soft" style="font-size:9px;">${esc(r)}</span>`).join('')}
                        </div>
                        <button class="card-delete-btn" style="position:static;" onclick="event.stopPropagation();OL.removeTeamMember('${m.id}')">
                            <i data-lucide="x" style="width:12px;height:12px;"></i>
                        </button>
                    </div>
                `).join('')}
            </div>
        ` : `
        <div class="cards-grid" style="margin-top: 20px;">
            ${memberCardsHtml}
            ${members.length === 0 ? '<div class="empty-hint" style="grid-column: 1/-1; text-align: center; padding: 60px; opacity: 0.5;">No team members added yet.</div>' : ""}
        </div>
        `}
    `;

    // 🚀 THE REPAINT: Essential for dynamic card icons
    if (window.lucide) {
        window.lucide.createIcons();
    }
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
    let member = draftObj || client?.projectData?.teamMembers.find(m => m.id === memberId);
    
    if (!member) return;

    if (!Array.isArray(member.roles)) {
        member.roles = member.role ? [member.role] : [];
    }

    const html = `
        <div class="modal-head" style="gap:15px; display:flex; align-items:center; padding: 20px;">
            <div style="display:flex; align-items:center; gap:10px; flex:1;">
                <i data-lucide="user" style="width:20px; height:20px; color:var(--accent);"></i>
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
                <label class="modal-section-label" style="display:flex; align-items:center; gap:6px;">
                    <i data-lucide="shield" style="width:14px; height:14px;"></i> Assigned Roles
                </label>
                <div class="pills-row" style="margin-bottom: 12px; min-height: 32px; display:flex; flex-wrap:wrap; gap:6px;">
                    ${member.roles.map(role => `
                        <span class="pill tiny accent" style="display:flex; align-items:center; gap:4px;">
                            ${esc(role)}
                            <i data-lucide="x" style="width:10px; height:10px; cursor:pointer;" onclick="OL.removeRoleFromMember('${memberId}', '${esc(role)}')"></i>
                        </span>
                    `).join("") || '<span class="tiny muted">No roles assigned</span>'}
                </div>

                <div class="search-map-container">
                    <div style="position:relative; display:flex; align-items:center;">
                        <i data-lucide="search" style="position:absolute; left:10px; width:12px; height:12px; opacity:0.4;"></i>
                        <input type="text" class="modal-input tiny" 
                            style="padding-left:30px;"
                            placeholder="Search roles or type to add new..." 
                            onfocus="OL.filterRoleSearch('${memberId}', '')" 
                            oninput="OL.filterRoleSearch('${memberId}', this.value)">
                    </div>
                    <div id="role-search-results" class="search-results-overlay"></div>
                </div>
            </div>

            <div class="card-section" style="margin-top: 20px;">
                <label class="modal-section-label" style="display:flex; align-items:center; gap:6px;">
                    <i data-lucide="pen-tool" style="width:14px; height:14px;"></i> Email Signature
                </label>
                <textarea class="modal-textarea" 
                        style="min-height: 100px; font-family: monospace; font-size: 11px; line-height:1.4;" 
                        placeholder="Best regards,\n{{name}}\nSphynx Financial"
                        onblur="OL.updateTeamMember('${memberId}', 'signature', this.value)">${esc(member.signature || '')}</textarea>
                <div class="tiny muted" style="margin-top:5px; display:flex; align-items:center; gap:4px;">
                    <i data-lucide="info" style="width:10px; height:10px;"></i>
                    Used for automated email templates sent by this member.
                </div>
            </div>
            ${OL.renderAccessSection(memberId, "member")} 
        </div>
    `;
    openModal(html);

    if (window.lucide) {
        window.lucide.createIcons();
    }
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

    const allProjectRoles = [...new Set(client.projectData.teamMembers.flatMap(m => m.roles || []))];
    const memberRoles = member.roles || [];
    const matches = allProjectRoles.filter(role => 
        role.toLowerCase().includes(q) && !memberRoles.includes(role)
    ).sort();

    let html = matches.map(role => `
        <div class="search-result-item" style="display:flex; align-items:center; gap:10px;" onmousedown="OL.addRoleToMember('${memberId}', '${esc(role)}')">
            <i data-lucide="tag" style="width:12px; height:12px; opacity:0.6;"></i>
            <span style="flex:1;">${esc(role)}</span>
            <span class="tiny muted">Assign</span>
        </div>
    `).join("");

    if (q.length > 0 && !allProjectRoles.some(r => r.toLowerCase() === q)) {
        html += `
            <div class="search-result-item create-action" style="display:flex; align-items:center; gap:10px;" onmousedown="OL.addRoleToMember('${memberId}', '${esc(query)}')">
                <i data-lucide="plus-circle" style="width:14px; height:14px; color:var(--accent);"></i>
                <span>Create Role "<strong>${esc(query)}</strong>"</span>
            </div>`;
    }

    listEl.innerHTML = html || `<div class="search-result-item muted">No other roles found.</div>`;
    
    if (window.lucide) window.lucide.createIcons();
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
    
    // 1. Determine the correct data source (Project vs Master)
    const dataContext = client?.projectData || state.master;
    
    // Ensure accessRegistry exists
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
            <div class="section-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                <label class="modal-section-label" style="margin:0;">System Access & Credentials</label>
                <div class="header-actions">
                    <button class="btn tiny primary" onclick="document.getElementById('access-search-input').focus()">+ Add Access</button>
                </div>
            </div>

            <div class="dp-manager-list" style="margin-bottom:10px;">
                ${connections.length === 0 ? '<div class="muted tiny" style="padding:10px; text-align:center; border: 1px dashed var(--line); border-radius:4px;">No credentials linked yet.</div>' : ''}
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
                                    ${type === "member" ? "💻" : "👨‍💼"} ${esc(linkedObj?.name || "Unknown")}
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
                                <button class="card-close" style="position:static; padding: 0 5px;" onclick="OL.removeAccess('${conn.id}', '${ownerId}', '${type}')">×</button>
                            </div>
                        </div>
                    `;
                }).join("")}
            </div>

            <div class="search-map-container" style="margin-top: 15px;">
                <input type="text" id="access-search-input" class="modal-input" 
                    placeholder="Type to find ${type === "member" ? "an App" : "a Member"} to grant access..." 
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
            ${type === "member" ? "💻" : "👨‍💼"} ${esc(item.name)}
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

window.renderHowToLibrary = OL.renderHowToLibrary = function renderHowToLibrary () {
    OL.registerView(renderHowToLibrary);
    const container = document.getElementById("mainContent");
    const client = getActiveClient();
    const hash = window.location.hash;

    if (!container) return;
    container.style.cssText = '';
    document.body.classList.remove('is-visualizer');

    const isAdmin = window.FORCE_ADMIN === true;
    const isVaultView = hash.startsWith('#/vault');

    // 1. Data Selection (Master + Project Local)
    const masterLibrary = state.master.howToLibrary || [];
    const localLibrary = (client && client.projectData.localHowTo) || [];
    
    const visibleGuides = isVaultView 
        ? masterLibrary 
        : [...masterLibrary.filter(ht => (client?.sharedMasterIds || []).includes(ht.id)), ...localLibrary];

    container.innerHTML = `
        <div class="section-header" style="display: flex !important; align-items: center; gap: 12px; visibility: visible !important; opacity: 1 !important;">
            <i data-lucide="library" style="width: 28px; height: 24px; color: var(--accent);"></i>
            <div style="flex: 1;">
                <h2 style="margin:0;">${isVaultView ? 'Master SOP Vault' : 'Project Instructions'}</h2>
                <div class="small muted">${isVaultView ? 'Global Standards' : `Custom guides for ${esc(client?.meta?.name)}`}</div>
            </div>
            
            <div class="header-actions" style="display: flex !important; gap: 10px !important; align-items: center;">
                ${isVaultView && isAdmin ? `
                    <button class="btn primary" style="background: var(--accent) !important; color: black !important; font-weight: bold; display: flex; align-items: center; gap: 6px;" 
                            onclick="OL.openHowToEditorModal()">
                        <i data-lucide="plus" style="width: 14px; height: 14px;"></i> Create Master SOP
                    </button>
                    ${OL.viewToggleBtn('howto', 'renderHowToLibrary')}
                ` : ''}

                ${!isVaultView ? `
                    <button class="btn small soft" style="display: flex; align-items: center; gap: 6px;" 
                            onclick="OL.openLocalHowToEditor()">
                        <i data-lucide="plus" style="width: 14px; height: 14px;"></i> Local SOP
                    </button>
                    ${isAdmin ? `
                        <button class="btn primary" style="background: var(--accent) !important; color: black !important; display: flex; align-items: center; gap: 6px;" 
                                onclick="OL.importHowToToProject()">
                            <i data-lucide="download-cloud" style="width: 14px; height: 14px;"></i> Import Master
                        </button>` : ''}
                ` : ''}
            </div>
        </div>
        ${OL.getViewMode('howto') === 'list' ? `
            <div style="display:flex;flex-direction:column;gap:2px;margin-top:10px;">
                ${visibleGuides.map(ht => `
                    <div style="display:flex;align-items:center;gap:12px;padding:10px 16px;
                                background:var(--panel-soft);border:1px solid var(--panel-border);
                                border-radius:8px;cursor:pointer;transition:border-color 0.2s;"
                         onclick="OL.openGuideEditor('${ht.id}')"
                         onmouseover="this.style.borderColor='var(--accent)'"
                         onmouseout="this.style.borderColor='var(--panel-border)'">
                        <i data-lucide="book-open" style="width:14px;height:14px;color:var(--accent);flex-shrink:0;"></i>
                        <div style="flex:1;min-width:0;">
                            <div style="font-weight:600;font-size:13px;">${esc(ht.name||'Untitled SOP')}</div>
                            ${ht.summary ? `<div style="font-size:10px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(ht.summary)}</div>` : ''}
                        </div>
                        <span class="pill tiny ${String(ht.id).includes('local') ? 'soft' : 'vault'}" style="font-size:8px;">
                            ${String(ht.id).includes('local') ? 'LOCAL' : 'MASTER'}
                        </span>
                        <button class="card-delete-btn" style="position:static;" onclick="event.stopPropagation();OL.deleteSOP('${client?.id}','${ht.id}')">
                            <i data-lucide="x" style="width:12px;height:12px;"></i>
                        </button>
                    </div>
                `).join('')}
            </div>
        ` : `
        <div class="cards-grid" style="margin-top: 20px;">
            ${visibleGuides.map(ht => renderHowToCard(client?.id, ht, !isVaultView)).join('')}
            ${visibleGuides.length === 0 ? '<div class="empty-hint" style="grid-column: 1/-1; text-align: center; padding: 60px; opacity: 0.5;">No guides found in this library.</div>' : ''}
        </div>
        `}
    `;

    // 🚀 THE REPAINT
    if (window.lucide) {
        window.lucide.createIcons();
    }
};

// 2. RENDER HOW TO CARDS
function renderHowToCard(clientId, ht, isClientView) {
    const client = state.clients[clientId];
    const isAdmin = window.FORCE_ADMIN === true;
    
    const isVaultView = window.location.hash.includes('vault');
    const isLocal = String(ht.id).includes('local');
    const isMaster = !isLocal;
    const canDelete = isAdmin || isLocal;
    const isShared = client?.sharedMasterIds?.includes(ht.id);

    return `
        <div class="card hover-trigger ${isMaster ? (isShared ? 'is-shared' : 'is-private') : 'is-local'}" 
             style="cursor: pointer; position: relative;" 
             onclick="OL.openGuideEditor('${ht.id}')">

            <div class="card-header" style="display:flex; justify-content:space-between; align-items:flex-start;">
                <div style="display:flex; align-items:center; gap:8px;">
                    <i data-lucide="book-open" style="width:14px; height:14px; color:var(--accent); opacity:0.8;"></i>
                    <div class="card-title ht-card-title-${ht.id}">${esc(ht.name || 'Untitled SOP')}</div>
                </div>

                ${canDelete ? `
                <button class="card-delete-btn" 
                        style="position:static;"
                        title="${isVaultView ? 'Delete Master Source' : (isMaster ? 'Remove from Client View' : 'Delete Permanently')}" 
                        onclick="event.stopPropagation(); OL.deleteSOP('${clientId}', '${ht.id}')">
                    <i data-lucide="x" style="width:14px; height:14px;"></i>
                </button>
                ` : ''}
            </div>
            
            <div class="card-body" style="padding-top: 12px;">
                <div style="display: flex; gap: 6px; align-items: center; margin-bottom: 10px;">
                    <span class="pill tiny ${isMaster ? 'vault' : 'local'}" style="font-size: 8px; letter-spacing: 0.05em; display:flex; align-items:center; gap:4px;">
                        <i data-lucide="${isMaster ? 'shield-check' : 'map-pin'}" style="width:10px; height:10px;"></i>
                        ${isMaster ? 'MASTER' : 'LOCAL'}
                    </span>

                    ${!isClientView && isMaster ? `
                        <span class="pill tiny ${isShared ? 'accent' : 'soft'}" 
                              style="font-size: 8px; cursor: pointer; display:flex; align-items:center; gap:4px;"
                              onclick="event.stopPropagation(); OL.toggleSOPSharing('${clientId}', '${ht.id}')">
                            <i data-lucide="${isShared ? 'globe' : 'lock'}" style="width:10px; height:10px;"></i>
                            ${isShared ? 'Client-Facing' : 'Internal-Only'}
                        </span>
                    ` : ''}
                </div>
                <p class="small muted" style="display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.4; font-size: 11px;">
                    ${esc(ht.summary || 'No summary provided.')}
                </p>
            </div>
        </div>
    `;
}

OL.openGuideEditor = function(htId, draftObj = null) {
    const mainArea = document.getElementById('mainContent');
    if (!mainArea) return;

    document.body.classList.add('is-visualizer');
    mainArea.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden;padding:0;';

    const hash = window.location.hash;
    const isVaultMode = hash.includes('vault');
    const client = getActiveClient();

    // 1. Resolve guide
    let ht = draftObj;
    if (!ht) ht = (state.master.howToLibrary || []).find(h => h.id === htId);
    if (!ht && client) ht = (client.projectData.localHowTo || []).find(h => h.id === htId);
    if (!ht) return;

    // 2. Migrate legacy content to blocks
    if (!ht.blocks) {
        ht.blocks = [];
        if (ht.content && ht.content.trim()) {
            ht.blocks.push({
                id: 'blk-' + Date.now(),
                type: 'text',
                data: { html: ht.content }
            });
        }
        // don't delete ht.content yet — keep as fallback
    }

    const isAdmin = window.FORCE_ADMIN === true;
    const isLocal = String(ht.id).includes('local');
    const canEdit = isAdmin || isLocal || String(htId).startsWith('draft');

    OL._ge = { htId: ht.id, canEdit };

    mainArea.innerHTML = `
        <div id="ge-shell" style="display:flex;flex-direction:column;height:100%;overflow:hidden;background:var(--bg);">

            <!-- TOPBAR -->
            <div id="ge-topbar" style="
                display:flex;align-items:center;gap:10px;
                padding:10px 20px;flex-shrink:0;
                background:var(--panel);border-bottom:1px solid var(--panel-border);
                min-height:56px;">

                <button class="fv-btn" onclick="OL.closeGuideEditor()" style="gap:6px;">
                    <i data-lucide="arrow-left" style="width:13px;height:13px;"></i>
                    Back
                </button>

                <div style="width:1px;height:20px;background:var(--panel-border);"></div>

                <i data-lucide="book-open" style="width:16px;height:16px;color:var(--accent);flex-shrink:0;"></i>
                <input type="text"
                       id="ge-title-input"
                       value="${esc(ht.name || '')}"
                       placeholder="Guide title..."
                       ${!canEdit ? 'readonly' : ''}
                       style="background:transparent;border:none;outline:none;font-size:16px;
                              font-weight:700;color:var(--text-main);flex:1;font-family:inherit;"
                       onblur="OL._geSaveField('name', this.value)">

                <div style="flex:1;"></div>

                ${canEdit ? `
                    <div style="position:relative;">
                        <button class="fv-btn" id="ge-add-block-btn"
                                onclick="OL._geToggleBlockMenu()"
                                style="gap:6px;background:var(--accent);color:#000;border-color:var(--accent);font-weight:700;">
                            <i data-lucide="plus" style="width:13px;height:13px;"></i>
                            Add Block
                        </button>
                        <div id="ge-block-menu" style="
                            display:none;position:absolute;top:calc(100% + 6px);right:0;
                            background:var(--panel);border:1px solid var(--panel-border);
                            border-radius:10px;padding:6px;z-index:100;min-width:180px;
                            box-shadow:0 8px 24px rgba(0,0,0,0.3);">
                            ${[
                                { type:'text',      icon:'align-left',   label:'Text / HTML' },
                                { type:'checklist', icon:'check-square', label:'Checklist' },
                                { type:'image',     icon:'image',        label:'Image' },
                                { type:'resource',  icon:'link',         label:'Resource Link' },
                            ].map(b => `
                                <div onclick="OL._geAddBlock('${b.type}'); OL._geToggleBlockMenu();"
                                     style="display:flex;align-items:center;gap:10px;padding:9px 12px;
                                            border-radius:7px;cursor:pointer;transition:background 0.12s;"
                                     onmouseover="this.style.background='var(--panel-soft)'"
                                     onmouseout="this.style.background='transparent'">
                                    <i data-lucide="${b.icon}" style="width:13px;height:13px;color:var(--accent);flex-shrink:0;"></i>
                                    <span style="font-size:12px;font-weight:600;color:var(--text-main);">${b.label}</span>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                ` : ''}

                <button class="fv-btn" onclick="OL.closeGuideEditor()"
                        style="background:var(--panel-soft);color:var(--text-dim);">
                    <i data-lucide="x" style="width:13px;height:13px;"></i>
                </button>
            </div>

            <!-- BODY -->
            <div id="ge-body" style="display:flex;flex:1;overflow:hidden;">

                <!-- EDITOR COLUMN -->
                <div id="ge-editor" style="
                    flex:1;overflow-y:auto;padding:40px;
                    display:flex;flex-direction:column;gap:12px;
                    max-width:860px;margin:0 auto;width:100%;">

                    <!-- Summary -->
                    <input type="text"
                           placeholder="One-sentence summary..."
                           value="${esc(ht.summary || '')}"
                           ${!canEdit ? 'readonly' : ''}
                           style="background:transparent;border:none;border-bottom:1px solid var(--panel-border);
                                  outline:none;font-size:13px;color:var(--text-dim);padding:4px 0;
                                  font-family:inherit;width:100%;"
                           onblur="OL._geSaveField('summary', this.value)">

                    <div style="height:1px;background:var(--panel-border);margin:8px 0;"></div>

                    <!-- BLOCKS -->
                    <div id="ge-blocks-container">
                        ${OL._geRenderAllBlocks(ht)}
                    </div>

                    ${canEdit ? `
                        <div style="position:relative;margin-top:8px;">
                            <div onmousedown="event.preventDefault(); 
                                             const m=this.nextElementSibling; 
                                             m.style.display=m.style.display==='block'?'none':'block';"
                                 style="border:1px dashed var(--panel-border);border-radius:10px;
                                        padding:20px;text-align:center;cursor:pointer;
                                        color:var(--text-muted);font-size:12px;transition:all 0.15s;"
                                 onmouseover="this.style.borderColor='var(--accent)';this.style.color='var(--accent)'"
                                 onmouseout="this.style.borderColor='var(--panel-border)';this.style.color='var(--text-muted)'">
                                <i data-lucide="plus-circle" style="width:16px;height:16px;display:block;margin:0 auto 6px;"></i>
                                Add a block
                            </div>
                            <div style="display:none;position:absolute;top:calc(100% + 6px);left:50%;
                                        transform:translateX(-50%);background:var(--panel);
                                        border:1px solid var(--panel-border);border-radius:10px;
                                        padding:6px;z-index:100;min-width:180px;
                                        box-shadow:0 8px 24px rgba(0,0,0,0.3);">
                                ${[
                                    { type:'text',      icon:'align-left',   label:'Text / HTML' },
                                    { type:'checklist', icon:'check-square', label:'Checklist' },
                                    { type:'image',     icon:'image',        label:'Image' },
                                    { type:'resource',  icon:'link',         label:'Resource Link' },
                                ].map(b => `
                                    <div onmousedown="event.preventDefault(); OL._geAddBlock('${b.type}'); this.closest('[style*=position]').style.display='none';"
                                         style="display:flex;align-items:center;gap:10px;padding:9px 12px;
                                                border-radius:7px;cursor:pointer;transition:background 0.12s;"
                                         onmouseover="this.style.background='var(--panel-soft)'"
                                         onmouseout="this.style.background='transparent'">
                                        <i data-lucide="${b.icon}" style="width:13px;height:13px;color:var(--accent);flex-shrink:0;"></i>
                                        <span style="font-size:12px;font-weight:600;color:var(--text-main);">${b.label}</span>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    ` : ''}
                </div>

                <!-- RIGHT SIDEBAR (metadata) -->
                <div id="ge-sidebar" style="
                    width:260px;flex-shrink:0;
                    border-left:1px solid var(--panel-border);
                    background:var(--panel-soft);
                    overflow-y:auto;padding:20px;
                    display:flex;flex-direction:column;gap:16px;">

                    <!-- Video -->
                    <div>
                        <div style="font-size:9px;font-weight:700;text-transform:uppercase;
                                    letter-spacing:0.1em;color:var(--text-muted);margin-bottom:6px;
                                    display:flex;align-items:center;gap:5px;">
                            <i data-lucide="video" style="width:11px;height:11px;"></i> Training Video
                        </div>
                        <input type="text" class="fvi-input"
                               placeholder="YouTube / Loom / Vimeo URL"
                               value="${esc(ht.videoUrl || '')}"
                               ${!canEdit ? 'readonly' : ''}
                               onblur="OL._geSaveField('videoUrl', this.value); OL._geRefreshVideoPreview(this.value);">
                        <div id="ge-video-preview" style="margin-top:8px;">
                            ${ht.videoUrl ? OL.parseVideoEmbed(ht.videoUrl) : ''}
                        </div>
                    </div>

                    <!-- Category -->
                    <div>
                        <div style="font-size:9px;font-weight:700;text-transform:uppercase;
                                    letter-spacing:0.1em;color:var(--text-muted);margin-bottom:6px;
                                    display:flex;align-items:center;gap:5px;">
                            <i data-lucide="folder" style="width:11px;height:11px;"></i> Category
                        </div>
                        <input type="text" class="fvi-input"
                               value="${esc(ht.category || 'General')}"
                               ${!canEdit ? 'readonly' : ''}
                               onblur="OL._geSaveField('category', this.value)">
                    </div>

                    <!-- Related Apps -->
                    <div>
                        <div style="font-size:9px;font-weight:700;text-transform:uppercase;
                                    letter-spacing:0.1em;color:var(--text-muted);margin-bottom:6px;
                                    display:flex;align-items:center;gap:5px;">
                            <i data-lucide="smartphone" style="width:11px;height:11px;"></i> Related Apps
                        </div>
                        <div id="ge-app-pills" style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px;">
                            ${OL._geRenderAppPills(ht)}
                        </div>
                        ${canEdit ? `
                            <div style="position:relative;">
                                <input type="text" class="fvi-input" placeholder="Search apps..."
                                       onfocus="OL._geFilterAppSearch('${ht.id}','')"
                                       oninput="OL._geFilterAppSearch('${ht.id}',this.value)">
                                <div id="ge-app-results" class="search-results-overlay" style="position:absolute;z-index:50;width:100%;"></div>
                            </div>
                        ` : ''}
                    </div>
                </div>
            </div>
        </div>
    `;

    if (window.lucide) lucide.createIcons();

    // Close block menu on outside click
    document.addEventListener('click', OL._geOutsideClick);
};

OL._geOutsideClick = function(e) {
    const menu = document.getElementById('ge-block-menu');
    const btn  = document.getElementById('ge-add-block-btn');
    if (menu && !menu.contains(e.target) && btn && !btn.contains(e.target)) {
        menu.style.display = 'none';
    }
};

OL.closeGuideEditor = function() {
    document.removeEventListener('click', OL._geOutsideClick);
    document.body.classList.remove('is-visualizer');
    const mainArea = document.getElementById('mainContent');
    if (mainArea) mainArea.style.cssText = '';
    renderHowToLibrary();
};

// ── BLOCK MENU TOGGLE ──────────────────────────────
OL._geToggleBlockMenu = function() {
    const menu = document.getElementById('ge-block-menu');
    if (!menu) return;
    menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
};

// ── SAVE FIELD ─────────────────────────────────────
OL._geSaveField = function(field, value) {
    const { htId } = OL._ge;
    OL.handleHowToSave(htId, field, value);
};

// ── RESOLVE GUIDE ──────────────────────────────────
OL._geGetHt = function() {
    const { htId } = OL._ge;
    const client = getActiveClient();
    return (state.master.howToLibrary || []).find(h => h.id === htId)
        || (client?.projectData?.localHowTo || []).find(h => h.id === htId);
};

// ── SAVE BLOCKS ────────────────────────────────────
OL._geSaveBlocks = function() {
    const ht = OL._geGetHt();
    if (!ht) return;
    OL.persist();
};

// ── ADD BLOCK ──────────────────────────────────────
OL._geAddBlock = function(type) {
    const ht = OL._geGetHt();
    if (!ht) return;
    if (!ht.blocks) ht.blocks = [];

    const id = 'blk-' + Date.now();
    const defaults = {
        text:      { html: '' },
        checklist: { items: [] },
        image:     { url: '', caption: '' },
        resource:  { resourceId: null, resourceName: '', note: '' },
    };

    ht.blocks.push({ id, type, data: defaults[type] || {} });
    OL.persist();

    // Re-render just the blocks container
    const container = document.getElementById('ge-blocks-container');
    if (container) {
        container.innerHTML = OL._geRenderAllBlocks(ht);
        if (window.lucide) lucide.createIcons();
        // Focus new block
        requestAnimationFrame(() => {
            const newBlock = document.getElementById(`ge-blk-${id}`);
            if (newBlock) {
                newBlock.scrollIntoView({ behavior: 'smooth', block: 'center' });
                const input = newBlock.querySelector('textarea, input[type="text"]');
                if (input) input.focus();
            }
        });
    }
};

// ── DELETE BLOCK ───────────────────────────────────
OL._geDeleteBlock = function(blockId) {
    const ht = OL._geGetHt();
    if (!ht) return;
    ht.blocks = (ht.blocks || []).filter(b => b.id !== blockId);
    OL.persist();
    const container = document.getElementById('ge-blocks-container');
    if (container) {
        container.innerHTML = OL._geRenderAllBlocks(ht);
        if (window.lucide) lucide.createIcons();
    }
};

// ── MOVE BLOCK ─────────────────────────────────────
OL._geMoveBlock = function(blockId, dir) {
    const ht = OL._geGetHt();
    if (!ht || !ht.blocks) return;
    const idx = ht.blocks.findIndex(b => b.id === blockId);
    if (idx === -1) return;
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= ht.blocks.length) return;
    const tmp = ht.blocks[idx];
    ht.blocks[idx] = ht.blocks[newIdx];
    ht.blocks[newIdx] = tmp;
    OL.persist();
    const container = document.getElementById('ge-blocks-container');
    if (container) {
        container.innerHTML = OL._geRenderAllBlocks(ht);
        if (window.lucide) lucide.createIcons();
    }
};

// ── RENDER ALL BLOCKS ──────────────────────────────
OL._geRenderAllBlocks = function(ht) {
    const blocks = ht.blocks || [];
    if (!blocks.length) {
        return `<div style="text-align:center;padding:60px 20px;color:var(--text-muted);font-size:12px;opacity:0.6;">
            No blocks yet — click <strong>Add Block</strong> above to get started.
        </div>`;
    }
    return blocks.map((b, i) => OL._geRenderBlock(b, i, blocks.length)).join('');
};

// ── RENDER SINGLE BLOCK ────────────────────────────
OL._geRenderBlock = function(block, idx, total) {
    const { canEdit } = OL._ge || {};
    const controls = canEdit ? `
        <div class="ge-block-controls" style="
            position:absolute;top:10px;right:10px;
            display:none;align-items:center;gap:4px;z-index:10;">
            <button onclick="OL._geMoveBlock('${block.id}', -1)"
                    title="Move up" ${idx === 0 ? 'disabled' : ''}
                    style="width:24px;height:24px;border:1px solid var(--panel-border);
                           background:var(--panel-soft);border-radius:5px;cursor:pointer;
                           color:var(--text-dim);display:flex;align-items:center;justify-content:center;
                           opacity:${idx === 0 ? '0.3' : '1'};">
                <i data-lucide="chevron-up" style="width:11px;height:11px;pointer-events:none;"></i>
            </button>
            <button onclick="OL._geMoveBlock('${block.id}', 1)"
                    title="Move down" ${idx === total-1 ? 'disabled' : ''}
                    style="width:24px;height:24px;border:1px solid var(--panel-border);
                           background:var(--panel-soft);border-radius:5px;cursor:pointer;
                           color:var(--text-dim);display:flex;align-items:center;justify-content:center;
                           opacity:${idx === total-1 ? '0.3' : '1'};">
                <i data-lucide="chevron-down" style="width:11px;height:11px;pointer-events:none;"></i>
            </button>
            <button onclick="OL._geDeleteBlock('${block.id}')"
                    title="Delete block"
                    style="width:24px;height:24px;border:1px solid rgba(239,68,68,0.3);
                           background:rgba(239,68,68,0.06);border-radius:5px;cursor:pointer;
                           color:#ef4444;display:flex;align-items:center;justify-content:center;">
                <i data-lucide="trash-2" style="width:11px;height:11px;pointer-events:none;"></i>
            </button>
        </div>
    ` : '';

    const inner = OL._geRenderBlockInner(block, canEdit);

    return `
        <div id="ge-blk-${block.id}"
             class="ge-block"
             style="position:relative;background:var(--panel);border:1px solid var(--panel-border);
                    border-radius:10px;padding:18px 20px;transition:border-color 0.15s;"
             onmouseenter="const c=this.querySelector('.ge-block-controls'); if(c) c.style.display='flex';"
             onmouseleave="const c=this.querySelector('.ge-block-controls'); if(c) c.style.display='none';">
            ${controls}
            ${inner}
        </div>
    `;
};

// ── RENDER BLOCK INNER BY TYPE ─────────────────────
OL._geRenderBlockInner = function(block, canEdit) {
    switch (block.type) {

        case 'text':
            return `
                <div style="display:flex;align-items:center;gap:6px;margin-bottom:10px;">
                    <i data-lucide="align-left" style="width:12px;height:12px;color:var(--accent);"></i>
                    <span style="font-size:9px;font-weight:700;text-transform:uppercase;
                                 letter-spacing:0.1em;color:var(--text-muted);">Text</span>
                </div>
                ${canEdit ? `
                    <textarea
                        style="width:100%;min-height:100px;background:var(--panel-soft);
                               border:1px solid var(--panel-border);border-radius:8px;
                               color:var(--text-main);font-size:13px;line-height:1.6;
                               padding:10px 12px;font-family:inherit;resize:vertical;outline:none;
                               transition:border-color 0.15s;box-sizing:border-box;"
                        onfocus="this.style.borderColor='var(--accent)'"
                        onblur="this.style.borderColor='var(--panel-border)';
                                OL._geUpdateBlockData('${block.id}', {html: this.value})"
                        placeholder="Type text or paste HTML..."
                    >${block.data.html || ''}</textarea>
                    <div style="font-size:9px;color:var(--text-muted);margin-top:4px;opacity:0.6;">
                        HTML is supported — paste rich content freely.
                    </div>
                ` : `
                    <div style="font-size:13px;line-height:1.7;color:var(--text-main);">
                        ${block.data.html || '<em style="opacity:0.4;">Empty text block</em>'}
                    </div>
                `}
            `;

        case 'checklist':
            const items = block.data.items || [];
            return `
                <div style="display:flex;align-items:center;gap:6px;margin-bottom:10px;">
                    <i data-lucide="check-square" style="width:12px;height:12px;color:var(--accent);"></i>
                    <span style="font-size:9px;font-weight:700;text-transform:uppercase;
                                 letter-spacing:0.1em;color:var(--text-muted);">Checklist</span>
                </div>
                <div id="ge-cl-${block.id}" style="display:flex;flex-direction:column;gap:4px;">
                    ${items.map((item, i) => OL._geRenderChecklistItem(block.id, item, i)).join('')}
                </div>
                ${canEdit ? `
                    <button onclick="OL._geAddChecklistItem('${block.id}')"
                            style="display:flex;align-items:center;gap:6px;margin-top:8px;
                                   background:none;border:1px dashed var(--panel-border);
                                   border-radius:7px;padding:6px 12px;cursor:pointer;
                                   color:var(--text-muted);font-size:11px;font-family:inherit;
                                   width:100%;transition:all 0.15s;"
                            onmouseover="this.style.borderColor='var(--accent)';this.style.color='var(--accent)'"
                            onmouseout="this.style.borderColor='var(--panel-border)';this.style.color='var(--text-muted)'">
                        <i data-lucide="plus" style="width:11px;height:11px;pointer-events:none;"></i>
                        Add item
                    </button>
                ` : ''}
            `;

        case 'image':
            return `
                <div style="display:flex;align-items:center;gap:6px;margin-bottom:10px;">
                    <i data-lucide="image" style="width:12px;height:12px;color:var(--accent);"></i>
                    <span style="font-size:9px;font-weight:700;text-transform:uppercase;
                                 letter-spacing:0.1em;color:var(--text-muted);">Image</span>
                </div>
                ${canEdit ? `
                    <input type="text" class="fvi-input" style="margin-bottom:8px;"
                           placeholder="Paste image URL..."
                           value="${esc(block.data.url || '')}"
                           onblur="OL._geUpdateBlockData('${block.id}', {url: this.value, caption: document.getElementById('ge-img-cap-${block.id}')?.value || ''});
                                   OL._geRefreshImageBlock('${block.id}', this.value)">
                ` : ''}
                <div id="ge-img-preview-${block.id}">
                    ${block.data.url ? `
                        <img src="${esc(block.data.url)}" alt=""
                             style="width:100%;border-radius:8px;border:1px solid var(--panel-border);display:block;">
                    ` : `
                        <div style="background:var(--panel-soft);border:1px dashed var(--panel-border);
                                    border-radius:8px;padding:30px;text-align:center;
                                    color:var(--text-muted);font-size:12px;">
                            <i data-lucide="image" style="width:24px;height:24px;margin-bottom:8px;display:block;margin:0 auto 8px;opacity:0.4;"></i>
                            No image URL set
                        </div>
                    `}
                </div>
                <input type="text" id="ge-img-cap-${block.id}"
                       class="fvi-input" style="margin-top:8px;"
                       placeholder="Caption (optional)..."
                       value="${esc(block.data.caption || '')}"
                       ${!canEdit ? 'readonly' : ''}
                       onblur="OL._geUpdateBlockData('${block.id}', {url: document.querySelector('#ge-blk-${block.id} input[type=text]')?.value || '${esc(block.data.url || '')}', caption: this.value})">
                ${block.data.caption ? `
                    <div style="font-size:11px;color:var(--text-muted);margin-top:4px;font-style:italic;">
                        ${esc(block.data.caption)}
                    </div>
                ` : ''}
            `;

        case 'resource':
            return `
                <div style="display:flex;align-items:center;gap:6px;margin-bottom:10px;">
                    <i data-lucide="link" style="width:12px;height:12px;color:var(--accent);"></i>
                    <span style="font-size:9px;font-weight:700;text-transform:uppercase;
                                 letter-spacing:0.1em;color:var(--text-muted);">Resource Link</span>
                </div>
                ${block.data.resourceId ? `
                    <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;
                                background:var(--panel-soft);border:1px solid var(--panel-border);
                                border-radius:8px;cursor:pointer;"
                         onclick="OL.openResourceModal('${block.data.resourceId}')">
                        <i data-lucide="workflow" style="width:14px;height:14px;color:var(--accent);flex-shrink:0;"></i>
                        <div style="flex:1;">
                            <div style="font-weight:600;font-size:12px;color:var(--text-main);">
                                ${esc(block.data.resourceName || 'Linked Resource')}
                            </div>
                            ${block.data.note ? `
                                <div style="font-size:10px;color:var(--text-muted);margin-top:2px;">
                                    ${esc(block.data.note)}
                                </div>
                            ` : ''}
                        </div>
                        <i data-lucide="chevron-right" style="width:13px;height:13px;color:var(--text-muted);"></i>
                        ${canEdit ? `
                            <button onclick="event.stopPropagation();OL._geUpdateBlockData('${block.id}',{resourceId:null,resourceName:'',note:''})"
                                    style="background:none;border:none;color:var(--text-muted);cursor:pointer;padding:2px;">
                                <i data-lucide="x" style="width:12px;height:12px;pointer-events:none;"></i>
                            </button>
                        ` : ''}
                    </div>
                ` : (canEdit ? `
                    <div style="position:relative;">
                        <input type="text" class="fvi-input"
                               placeholder="Search resources..."
                               onfocus="OL._geFilterResourceSearch('${block.id}', '')"
                               oninput="OL._geFilterResourceSearch('${block.id}', this.value)">
                        <div id="ge-res-results-${block.id}"
                             class="search-results-overlay"
                             style="position:absolute;z-index:50;width:100%;"></div>
                    </div>
                    <input type="text" class="fvi-input" style="margin-top:6px;"
                           placeholder="Note about this resource (optional)..."
                           id="ge-res-note-${block.id}"
                           onblur="OL._geUpdateBlockData('${block.id}', {note: this.value})">
                ` : `
                    <div style="color:var(--text-muted);font-size:12px;font-style:italic;">No resource linked.</div>
                `)}
            `;

        default:
            return `<div style="color:var(--text-muted);font-size:12px;">Unknown block type: ${block.type}</div>`;
    }
};

// ── CHECKLIST ITEM ─────────────────────────────────
OL._geRenderChecklistItem = function(blockId, item, idx) {
    const { canEdit } = OL._ge || {};
    return `
        <div id="ge-cli-${item.id}" style="display:flex;align-items:center;gap:8px;
             padding:6px 8px;border-radius:7px;transition:background 0.12s;"
             onmouseover="this.style.background='var(--panel-soft)'"
             onmouseout="this.style.background='transparent'">
            <input type="checkbox"
                   ${item.checked ? 'checked' : ''}
                   onchange="OL._geToggleChecklistItem('${blockId}', '${item.id}', this.checked)"
                   style="width:15px;height:15px;cursor:pointer;flex-shrink:0;accent-color:var(--accent);">
            ${canEdit ? `
                <input type="text"
                       value="${esc(item.text || '')}"
                       placeholder="Checklist item..."
                       style="flex:1;background:transparent;border:none;outline:none;
                              font-size:13px;color:${item.checked ? 'var(--text-muted)' : 'var(--text-main)'};
                              font-family:inherit;text-decoration:${item.checked ? 'line-through' : 'none'};"
                       onblur="OL._geUpdateChecklistItem('${blockId}', '${item.id}', 'text', this.value)"
                       onkeydown="if(event.key==='Enter'){event.preventDefault();OL._geAddChecklistItem('${blockId}');}
                                  if(event.key==='Backspace'&&this.value===''){event.preventDefault();OL._geDeleteChecklistItem('${blockId}','${item.id}');}">
                <button onclick="OL._geDeleteChecklistItem('${blockId}', '${item.id}')"
                        style="background:none;border:none;cursor:pointer;
                               color:var(--text-muted);padding:2px;opacity:0;transition:opacity 0.15s;"
                        onmouseenter="this.style.opacity='1';this.style.color='#ef4444'"
                        onmouseleave="this.style.opacity='0'">
                    <i data-lucide="x" style="width:11px;height:11px;pointer-events:none;"></i>
                </button>
            ` : `
                <span style="flex:1;font-size:13px;
                             color:${item.checked ? 'var(--text-muted)' : 'var(--text-main)'};
                             text-decoration:${item.checked ? 'line-through' : 'none'};">
                    ${esc(item.text || '')}
                </span>
            `}
        </div>
    `;
};

// ── CHECKLIST OPERATIONS ───────────────────────────
OL._geAddChecklistItem = function(blockId) {
    const ht = OL._geGetHt();
    if (!ht) return;
    const block = (ht.blocks || []).find(b => b.id === blockId);
    if (!block) return;
    if (!block.data.items) block.data.items = [];
    const newItem = { id: 'cli-' + Date.now(), text: '', checked: false };
    block.data.items.push(newItem);
    OL.persist();

    const container = document.getElementById(`ge-cl-${blockId}`);
    if (container) {
        container.innerHTML = (block.data.items || [])
            .map((item, i) => OL._geRenderChecklistItem(blockId, item, i))
            .join('');
        if (window.lucide) lucide.createIcons();
        requestAnimationFrame(() => {
            const newInput = document.getElementById(`ge-cli-${newItem.id}`)
                ?.querySelector('input[type=text]');
            if (newInput) newInput.focus();
        });
    }
};

OL._geToggleChecklistItem = function(blockId, itemId, checked) {
    const ht = OL._geGetHt();
    const block = (ht?.blocks || []).find(b => b.id === blockId);
    const item = (block?.data?.items || []).find(i => i.id === itemId);
    if (item) { item.checked = checked; OL.persist(); }

    // Update styling without full re-render
    const row = document.getElementById(`ge-cli-${itemId}`);
    if (row) {
        const input = row.querySelector('input[type=text]');
        const span  = row.querySelector('span');
        const el = input || span;
        if (el) {
            el.style.color = checked ? 'var(--text-muted)' : 'var(--text-main)';
            el.style.textDecoration = checked ? 'line-through' : 'none';
        }
    }
};

OL._geUpdateChecklistItem = function(blockId, itemId, field, value) {
    const ht = OL._geGetHt();
    const block = (ht?.blocks || []).find(b => b.id === blockId);
    const item = (block?.data?.items || []).find(i => i.id === itemId);
    if (item) { item[field] = value; OL.persist(); }
};

OL._geDeleteChecklistItem = function(blockId, itemId) {
    const ht = OL._geGetHt();
    const block = (ht?.blocks || []).find(b => b.id === blockId);
    if (!block) return;
    block.data.items = (block.data.items || []).filter(i => i.id !== itemId);
    OL.persist();

    const container = document.getElementById(`ge-cl-${blockId}`);
    if (container) {
        container.innerHTML = (block.data.items || [])
            .map((item, i) => OL._geRenderChecklistItem(blockId, item, i))
            .join('');
        if (window.lucide) lucide.createIcons();
    }
};

// ── UPDATE BLOCK DATA ──────────────────────────────
OL._geUpdateBlockData = function(blockId, newData) {
    const ht = OL._geGetHt();
    const block = (ht?.blocks || []).find(b => b.id === blockId);
    if (!block) return;
    Object.assign(block.data, newData);
    OL.persist();

    // Re-render just this block's inner content
    const blockEl = document.getElementById(`ge-blk-${blockId}`);
    if (blockEl) {
        const inner = blockEl.querySelector('.ge-block-inner');
        if (inner) {
            inner.innerHTML = OL._geRenderBlockInner(block, OL._ge?.canEdit);
            if (window.lucide) lucide.createIcons();
        }
    }
};

// ── IMAGE PREVIEW REFRESH ──────────────────────────
OL._geRefreshImageBlock = function(blockId, url) {
    const preview = document.getElementById(`ge-img-preview-${blockId}`);
    if (!preview) return;
    preview.innerHTML = url
        ? `<img src="${esc(url)}" alt="" style="width:100%;border-radius:8px;border:1px solid var(--panel-border);display:block;">`
        : `<div style="background:var(--panel-soft);border:1px dashed var(--panel-border);border-radius:8px;padding:30px;text-align:center;color:var(--text-muted);font-size:12px;">No image URL set</div>`;
};

// ── VIDEO PREVIEW REFRESH ──────────────────────────
OL._geRefreshVideoPreview = function(url) {
    const preview = document.getElementById('ge-video-preview');
    if (!preview) return;
    preview.innerHTML = url ? OL.parseVideoEmbed(url) : '';
};

// ── APP PILLS ──────────────────────────────────────
OL._geRenderAppPills = function(ht) {
    const client = getActiveClient();
    const allApps = [...(state.master.apps || []), ...(client?.projectData?.localApps || [])];
    return (ht.appIds || []).map(appId => {
        const app = allApps.find(a => a.id === appId);
        if (!app) return '';
        return `
            <span style="display:inline-flex;align-items:center;gap:5px;padding:3px 8px;
                         border-radius:99px;font-size:10px;font-weight:600;
                         background:var(--accent-glow);color:var(--accent);
                         border:1px solid rgba(56,189,248,0.3);">
                ${esc(app.name)}
                <span onclick="OL.toggleHTApp('${ht.id}','${appId}');
                               document.getElementById('ge-app-pills').innerHTML=OL._geRenderAppPills(OL._geGetHt());
                               if(window.lucide)lucide.createIcons();"
                      style="opacity:0.5;cursor:pointer;font-size:12px;line-height:1;">×</span>
            </span>
        `;
    }).join('');
};

OL._geFilterAppSearch = function(htId, query) {
    const listEl = document.getElementById('ge-app-results');
    if (!listEl) return;
    const q = (query || '').toLowerCase();
    const client = getActiveClient();
    const ht = OL._geGetHt();
    const currentIds = ht?.appIds || [];
    const allApps = [...(state.master.apps || []), ...(client?.projectData?.localApps || [])];
    const matches = allApps.filter(a => a.name.toLowerCase().includes(q) && !currentIds.includes(a.id));

    listEl.innerHTML = matches.slice(0, 8).map(app => `
        <div class="search-result-item"
             onmousedown="OL.toggleHTApp('${htId}','${app.id}');
                          document.getElementById('ge-app-pills').innerHTML=OL._geRenderAppPills(OL._geGetHt());
                          if(window.lucide)lucide.createIcons();
                          document.getElementById('ge-app-results').innerHTML='';">
            ${esc(app.name)}
        </div>
    `).join('') || '<div class="search-result-item" style="opacity:0.5;">No matches</div>';
};

// ── RESOURCE SEARCH ────────────────────────────────
OL._geFilterResourceSearch = function(blockId, query) {
    const listEl = document.getElementById(`ge-res-results-${blockId}`);
    if (!listEl) return;
    const q = (query || '').toLowerCase();
    const client = getActiveClient();
    const resources = (client?.projectData?.resources || []).filter(r =>
        !r.isArchived && r.name.toLowerCase().includes(q)
    );

    listEl.innerHTML = resources.slice(0, 8).map(res => `
        <div class="search-result-item"
             onmousedown="OL._geSetResourceBlock('${blockId}', '${res.id}', '${esc(res.name)}')">
            ${esc(res.name)}
            <span style="font-size:9px;color:var(--text-muted);margin-left:6px;">${esc(res.type || '')}</span>
        </div>
    `).join('') || '<div class="search-result-item" style="opacity:0.5;">No resources found</div>';
};

OL._geSetResourceBlock = function(blockId, resId, resName) {
    const ht = OL._geGetHt();
    const block = (ht?.blocks || []).find(b => b.id === blockId);
    if (!block) return;

    const note = document.getElementById(`ge-res-note-${blockId}`)?.value || '';
    block.data = { resourceId: resId, resourceName: resName, note };
    OL.persist();

    // Re-render just this block
    const blockEl = document.getElementById(`ge-blk-${blockId}`);
    if (blockEl) {
        blockEl.innerHTML = (OL._ge?.canEdit ? `
            <div class="ge-block-controls" style="position:absolute;top:10px;right:10px;display:none;align-items:center;gap:4px;z-index:10;">
                <button onclick="OL._geDeleteBlock('${blockId}')"
                        style="width:24px;height:24px;border:1px solid rgba(239,68,68,0.3);background:rgba(239,68,68,0.06);border-radius:5px;cursor:pointer;color:#ef4444;display:flex;align-items:center;justify-content:center;">
                    <i data-lucide="trash-2" style="width:11px;height:11px;pointer-events:none;"></i>
                </button>
            </div>
        ` : '') + OL._geRenderBlockInner(block, OL._ge?.canEdit);
        if (window.lucide) lucide.createIcons();
    }
};

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
    const draftHowTo = { id: draftId, name: '', summary: '', content: '', blocks: [], isDraft: true, isLocal: true };
    // Save draft first
    if (!client.projectData.localHowTo) client.projectData.localHowTo = [];
    client.projectData.localHowTo.push(draftHowTo);
    OL.openGuideEditor(draftId);
};

OL.openHowToEditorModal = function() {
    const draftId = 'draft-ht-' + Date.now();
    const draftHowTo = { id: draftId, name: '', summary: '', content: '', blocks: [], isDraft: true };
    if (!state.master.howToLibrary) state.master.howToLibrary = [];
    state.master.howToLibrary.push(draftHowTo);
    OL.openGuideEditor(draftId);
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
                <button class="card-delete-btn" style="position:static;" onclick="OL.removeHTRequirement('${ht.id}', ${idx})">×</button>
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
    OL.openGuideEditor(htId);
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
    OL.openGuideEditor(htId); 
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
    container.style.cssText = '';
    document.body.classList.remove('is-visualizer');

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
    OL.openGuideEditor(htId); // Refresh the modal to show the new row
};

OL.updateHTReq = function(htId, index, field, value) {
    const ht = (state.master.howToLibrary || []).find(h => h.id === htId);
    if (!ht || !ht.requirements || !ht.requirements[index]) return;

    ht.requirements[index][field] = value;

    // We persist, but we don't necessarily need to re-open the modal 
    // for text inputs to avoid losing focus, unless it's a dropdown change.
    OL.persist();
    
    if (field === 'targetId' || field === 'clientGuideId') {
        OL.openGuideEditor(htId);
    }
};

// Remove a requirement from the list
OL.removeHTRequirement = function(htId, index) {
    const ht = (state.master.howToLibrary || []).find(h => h.id === htId);
    if (!ht || !ht.requirements) return;

    ht.requirements.splice(index, 1);
    
    OL.persist();
    OL.openGuideEditor(htId);
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

// hashchange listener already registered near the top of the file

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
    container.style.cssText = '';
    document.body.classList.remove('is-visualizer');

    const isVaultMode = window.location.hash.includes('vault');
    const client = getActiveClient();

    const sourcePool = (isVaultMode || !client) 
        ? (state.master.datapoints || []) 
        : (client.projectData.localDatapoints || []);

    const datapoints = sourcePool.filter(d => !d.isBundle);
    const bundles = sourcePool.filter(d => d.isBundle);

    container.innerHTML = `
        <div class="section-header" style="display: flex; align-items: center; gap: 12px; margin-bottom: 30px; padding-bottom: 20px; border-bottom: 1px solid var(--line);">
            <i data-lucide="database" style="width: 28px; height: 24px; color: var(--accent);"></i>
            <div style="flex: 1;">
                <h2 style="font-size: 24px; letter-spacing: -0.5px; margin: 0;">Data Architecture Manager</h2>
                <div class="small muted" style="margin-top: 4px;">Standardize fields and drag them into bundles to organize technical requirements.</div>
            </div>
            <div class="header-actions" style="display: flex; gap: 8px;">
                ${!isVaultMode ? `
                    <button class="btn primary" style="background:#38bdf8; color:black; display: flex; align-items: center; gap: 6px;" onclick="OL.openMasterDataImporter()">
                        <i data-lucide="download-cloud" style="width: 14px; height: 14px;"></i> Import Master
                    </button>` : ''}
                <button class="btn small soft" style="display: flex; align-items: center; gap: 6px;" onclick="OL.addNewDatapoint(true)">
                    <i data-lucide="package-plus" style="width: 14px; height: 14px;"></i> New Bundle
                </button>
                <button class="btn primary" style="display: flex; align-items: center; gap: 6px;" onclick="OL.addNewDatapoint(false)">
                    <i data-lucide="plus" style="width: 14px; height: 14px;"></i> New Field
                </button>
            </div>
        </div>

        <div class="data-manager-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 40px;">
            
            <div class="data-column">
                <div class="column-label" style="display: flex; align-items: center; gap: 8px; padding: 0 0 15px 5px; border-bottom: 1px solid var(--line); margin-bottom: 15px;">
                    <i data-lucide="list" style="width: 12px; height: 12px; opacity: 0.5;"></i>
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
                                    <i data-lucide="grip-vertical" style="width: 14px; height: 14px; opacity: 0.2; cursor: grab;" onmousedown="event.stopPropagation()"></i>
                                    <div style="min-width: 0;">
                                        <div class="bold" style="display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                                            <i data-lucide="${dp.linkToResource ? 'link' : 'tag'}" style="width: 12px; height: 12px; color: var(--accent); opacity: 0.8;"></i>
                                            ${esc(dp.name)}
                                        </div>
                                        <div class="tiny muted" style="font-family: monospace; opacity:0.5; font-size: 9px; padding-left: 18px;">${dp.key}</div>
                                    </div>
                                </div>

                                <div style="display:flex; align-items:center; gap:10px;">
                                    <div class="pills-row" style="gap:3px;">
                                        ${parentBundles.map(b => `
                                            <span class="pill tiny soft" style="padding: 2px 4px;" title="Included in ${esc(b.name)}">
                                                <i data-lucide="package" style="width: 8px; height: 8px;"></i>
                                            </span>`).join('')}
                                    </div>
                                    
                                    ${!isProtected ? `
                                        <button class="card-delete-btn" 
                                                style="position:static; opacity: 0.4; display: flex; align-items: center; justify-content: center;" 
                                                onclick="event.stopPropagation(); OL.deleteMasterDatapointById('${dp.id}')">
                                            <i data-lucide="x" style="width: 14px; height: 14px;"></i>
                                        </button>
                                    ` : `
                                        <span title="System Protected Field" style="opacity: 0.2; width: 22px; display: flex; justify-content: center;">
                                            <i data-lucide="lock" style="width: 12px; height: 12px;"></i>
                                        </span>
                                    `}
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>

            <div class="data-column">
                <div class="column-label" style="display: flex; align-items: center; gap: 8px; padding: 0 0 15px 5px; border-bottom: 1px solid var(--line); margin-bottom: 15px;">
                    <i data-lucide="layers" style="width: 12px; height: 12px; opacity: 0.5;"></i>
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
                                <div style="display: flex; align-items: center; gap: 10px;">
                                    <i data-lucide="package" style="width: 18px; height: 18px; color: var(--accent);"></i>
                                    <div>
                                        <div class="bold" style="color: var(--accent); font-size: 14px;">${esc(bn.name)}</div>
                                        <div class="tiny muted">${(bn.childIds || []).length} Fields Linked</div>
                                    </div>
                                </div>
                                <button class="btn-icon-tiny" style="display: flex; align-items: center; justify-content: center;" onclick="OL.deleteMasterDatapointById('${bn.id}')">
                                    <i data-lucide="x" style="width: 12px; height: 12px;"></i>
                                </button>
                            </div>
                            <div class="pills-row" style="gap:5px;">
                                ${(bn.childIds || []).map(cid => {
                                    const child = datapoints.find(d => d.id === cid);
                                    return child ? `
                                        <span class="pill tiny soft" style="font-size:9px; display: flex; align-items: center; gap: 6px;">
                                            ${esc(child.name)} 
                                            <i data-lucide="x-circle" class="is-clickable" onclick="OL.removeFieldFromBundle('${bn.id}', '${child.id}')" style="width: 10px; height: 10px; opacity:0.5;"></i>
                                        </span>` : '';
                                }).join('')}
                                ${bn.childIds?.length === 0 ? '<div class="tiny muted italic">Drag fields here to group...</div>' : ''}
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>
    `;

    // 🚀 THE REPAINT
    if (window.lucide) {
        window.lucide.createIcons();
    }
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
        OL._fvRefreshInspector(resId, stepId);
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

// IMPORT ZAP AUDIT
OL.processZapLogic = function(zap, isMaster = false) {
    const client = getActiveClient();
    const library = isMaster ? state.master.resources : client.projectData.localResources;
    const dataLibrary = isMaster ? state.master.datapoints : (client.projectData.localDatapoints || []);

    const transformedSteps = zap.steps.map((s, i) => {
        const cleanAppName = s.app ? s.app.split('@')[0].replace(/CLIAPI|V\d+|V\d+CLIAPI/g, '').replace(/([A-Z])/g, ' $1').trim() : "System";
        const stepLinks = [];
        const stepDatapoints = [];

        if (s.mappings) {
            s.mappings.forEach(m => {
                const fieldLower = (m.label || m.field || "").toLowerCase();
                const idFields = ['spreadsheet', 'folder', 'file', 'form', 'board', 'database'];

                // 🏗️ INFRASTRUCTURE DISCOVERY
                if (idFields.some(f => fieldLower.includes(f)) && m.value && !m.value.includes('{{')) {
                    let existingRes = library.find(r => r.externalUrl && r.externalUrl.includes(m.value));
                    if (!existingRes) {
                        let genUrl = fieldLower.includes('folder') ? `https://drive.google.com/drive/u/1/folders/${m.value}` : `https://docs.google.com/spreadsheets/d/${m.value}`;
                        existingRes = {
                            id: (isMaster ? 'res-vlt-' : 'local-prj-') + Date.now() + Math.random().toString(36).substr(2, 5),
                            name: `[Discovered] ${m.field}: ${m.value.substring(0, 8)}...`,
                            type: fieldLower.includes('folder') ? 'Folder' : 'Spreadsheet',
                            externalUrl: genUrl,
                            isGlobal: true, coords: null, stageId: null
                        };
                        library.push(existingRes);
                    }
                    stepLinks.push({ id: existingRes.id, name: existingRes.name, type: existingRes.type });
                }

                // 🏷️ DATA TAG DISCOVERY
                if (m.value && m.value.includes('{{')) {
                    const rawName = m.label || m.field || "Unknown";
                    const cleanName = rawName.replace(/_/g, ' ').trim();
                    let tag = dataLibrary.find(d => d.name.toLowerCase() === cleanName.toLowerCase());
                    if (!tag) {
                        tag = { id: 'dp-' + Date.now() + Math.random().toString(36).substr(2, 5), name: cleanName, category: 'Auto-Discovered' };
                        dataLibrary.push(tag);
                    }
                    if (!stepDatapoints.some(d => d.id === tag.id)) stepDatapoints.push(tag);
                }
            });
        }

        return {
            id: "step_" + Date.now() + "_" + i,
            name: s.title || "Untitled Step",
            appName: cleanAppName,
            assignees: (i === 0) ? [{ id: 'role-client', name: 'Any Client', type: 'role' }] : [{ id: 'zap-auto', name: 'Zapier', type: 'app' }],
            logic: { in: [], out: [] },
            links: stepLinks,
            datapoints: stepDatapoints
        };
    });

    return {
        id: (isMaster ? 'res-vlt-' : 'local-prj-') + Date.now() + Math.random().toString(36).substr(2, 5),
        type: 'Zap',
        archetype: 'Multi-Step',
        name: `⚡ ${zap.zapName}`,
        steps: transformedSteps,
        isExpanded: true
    };
};

OL.bulkImportZaps = function(isMaster = false) {
    const activeId = state.activeClientId;
    const client = state.clients[activeId];
    if (!client && !isMaster) return alert("❌ No active project.");

    const zapierRobotMap = {
        "app115533": "Wealthbox",
        "app235438": "Orion",
        "app223706": "CurrentClient",
        "schedule": "Zapier Scheduler",
        "zapierlooping": "Zapier Looping",
        "filterapi": "Zapier Filter",
        "codeapi": "Zapier Code",
        "engineapi": "Zapier Engine",
        "storage": "Zapier Storage",
        "slackapi": "Slack",
        "googlemakersuite": "Google Maker Suite",
        "smsapi" : "Zapier SMS"
    };

    const projectApps = (client.projectData?.localApps || [])
        .sort((a, b) => {
            const nameA = typeof a === 'string' ? a : (a.name || a.label || "");
            const nameB = typeof b === 'string' ? b : (b.name || b.label || "");
            return nameB.length - nameA.length;
        });

    const library = isMaster ? state.master.resources : client.projectData.localResources;
    const destinationName = isMaster ? "MASTER VAULT" : `PROJECT: ${client.meta?.name}`;

    const rawData = prompt(`🔄 LOGIC-PRESERVING SYNC\nTarget: ${client.meta?.name}\n\nPaste JSON:`);
    if (!rawData) return;

    try {
        const zapArray = JSON.parse(rawData);
        
        zapArray.forEach((zapData) => {
            const stepIdMap = []; 

            // 1. PRE-CLEAN
            if (zapData.steps) {
                zapData.steps.forEach((step, sIdx) => {
                    let incoming = step.app.split('@')[0].replace(/CLIAPI|V\d+/g, '').toLowerCase().trim();
                    if (zapierRobotMap[incoming]) incoming = zapierRobotMap[incoming].toLowerCase();

                    const matchedApp = projectApps.find(pApp => {
                        const pName = typeof pApp === 'string' ? pApp : (pApp.name || pApp.label || "");
                        const pClean = pName.toLowerCase().replace(/\s/g, '');
                        return incoming === pClean || new RegExp(`\\b${incoming}\\b`, 'i').test(pName);
                    });

                    if (matchedApp) {
                        step.app = typeof matchedApp === 'string' ? matchedApp : matchedApp.name;
                        step.appId = typeof matchedApp === 'string' ? null : matchedApp.id;
                        stepIdMap[sIdx] = { name: step.app, id: step.appId };
                    }
                });
            }

            // 2. PROCESS LOGIC
            const processedZap = OL.processZapLogic(zapData, isMaster);
            
            // 3. RE-INJECT APP IDs
            processedZap.steps.forEach((pStep, pIdx) => {
                if (stepIdMap[pIdx]) {
                    pStep.appId = stepIdMap[pIdx].id;
                    pStep.appName = stepIdMap[pIdx].name;
                }
            });

            processedZap.originalZapId = zapData.zapId;
            processedZap.name = `⚡ ${zapData.zapName.replace(/^⚡\s*/, '').trim()}`;

            // 🎯 4. LOGIC & POSITION GRAFTING
            const existingIndex = library.findIndex(r => 
                r.type === 'Zap' && (String(r.originalZapId) === String(zapData.zapId) || r.name.toLowerCase() === processedZap.name.toLowerCase())
            );

            if (existingIndex !== -1) {
                const oldZap = library[existingIndex];
                
                // Copy Card Meta
                processedZap.id = oldZap.id; 
                processedZap.coords = oldZap.coords;
                processedZap.stageId = oldZap.stageId;
                processedZap.isGlobal = oldZap.isGlobal;
                processedZap.isTopShelf = oldZap.isTopShelf;
                processedZap._col = oldZap._col;

                // 🧠 DEEP STEP RECOVERY: Restore Logic Links and Data Tags
                processedZap.steps.forEach(newStep => {
                    // Find the matching step in the old version by name
                    const oldStep = (oldZap.steps || []).find(s => s.name === newStep.name);
                    
                    if (oldStep) {
                        // Restore the lines (Logic)
                        if (oldStep.logic) {
                            newStep.logic = JSON.parse(JSON.stringify(oldStep.logic));
                        }
                        // Restore the purple tags (Datapoints)
                        if (oldStep.datapoints) {
                            newStep.datapoints = JSON.parse(JSON.stringify(oldStep.datapoints));
                        }
                        // Restore internal ID so incoming links from other cards don't break
                        newStep.id = oldStep.id; 
                    }
                });

                library[existingIndex] = processedZap;
            } else {
                library.unshift(processedZap);
            }
        });

        // 5. Final UI Sync
        OL.syncLogicPorts(); // Forces all "Inbound" links to recalculate
        OL.persist();
        OL.renderVisualizer(isMaster);
        OL.renderWorkbenchItemsOnly();
        
        alert(`✅ Sync Complete! Positions, Connections (Logic), and Tags were preserved.`);
    } catch (e) {
        console.error("🔥 Sync Error:", e);
    }
};

OL.syncWealthbox = async function(client) {
    // 1. Find Wealthbox Credentials in the Access Registry
    const registry = client.projectData.accessRegistry || [];
    const wbCreds = registry.find(r => {
        const app = client.projectData.localApps.find(a => a.id === r.appId);
        return app?.name.toLowerCase().includes('wealthbox');
    });

    if (!wbCreds || !wbCreds.secret) {
        throw new Error("Wealthbox API Key not found in Credentials section.");
    }

    const apiKey = wbCreds.secret;

    // 2. Fetch Workflow Templates from Wealthbox
    const cloudUrl = `https://us-central1-operations-library-d2fee.cloudfunctions.net/syncWealthboxProxy?apiKey=${apiKey}`;

    console.log("📡 Calling Firebase Middleman...");
    
    const response = await fetch(cloudUrl);

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Middleman Error: ${errorText}`);
    }
    
    const result = await response.json();
    const templates = result.workflow_templates || [];

    console.log(`📥 Wealthbox: Found ${templates.length} templates.`);

    // 3. Process each template into your Library
    templates.forEach(wf => {
        const resourceData = {
            id: `wb-${wf.id}`,
            externalId: wf.id,
            name: `🕸️ WB: ${wf.name}`,
            type: 'Workflow',  
            visible: true, 
            category: 'Flows',
            archetype: 'Multi-Level',
            
            // 🎯 TYPO FIXED: Was 'isExpannded'
            isExpanded: true, 

            steps: (wf.workflow_steps || []).map((s, idx) => ({
                id: `wb-step-${wf.id}-${idx}`,
                name: s.name,
                description: s.description || "",
                appName: 'Wealthbox'
            }))
        };

        // 🎯 ADD THIS: Register with the system so it "sticks"
        OL.upsertExternalResource(client, resourceData);
    
        // 🟢 Save to localResources
        if (!client.projectData.localResources) client.projectData.localResources = [];
        
        const idx = client.projectData.localResources.findIndex(r => r.id === resourceData.id);
        if (idx > -1) {
            client.projectData.localResources[idx] = resourceData;
        } else {
            client.projectData.localResources.push(resourceData);
        }
    });
    console.log(`✅ Wealthbox sync complete: ${templates.length} templates.`);

    // 🎯 THE STICKY FIX: 
    // We use a small timeout (100ms) to ensure the Data Layer is finished 
    // before we scream at the UI Layer to wake up.
    setTimeout(() => {
        const activeId = OL.state.activeClientId;
        const clientObj = OL.state.clients[activeId];
        
        // 1. Ensure the metadata is forced (matching your console logic)
        if (clientObj && clientObj.projectData.localResources) {
            clientObj.projectData.localResources.forEach(res => {
                if (res.name && res.name.includes('WB:')) {
                    res.type = 'Workflow';
                    res.visible = true;
                    res.category = 'Flows';
                }
            });
        }

        // 2. Reset Search State
        OL.state.libSearch = ""; 

        // 3. Trigger the internal filters
        if (typeof OL.syncResourceLibraryFilters === 'function') {
            OL.syncResourceLibraryFilters();
        }

        // 4. Force the render (Use BOTH potential names to be safe)
        if (typeof OL.renderResourceManager === 'function') {
            OL.renderResourceManager(clientObj);
        } else if (typeof OL.renderLibrary === 'function') {
            OL.renderLibrary(clientObj);
        }

        // 5. Force the HTML search bar to unlock
        const input = document.getElementById('lib-filter-input');
        if (input) {
            input.disabled = false;
            input.style.pointerEvents = 'auto';
            input.style.opacity = '1';
        }

        console.log("🔓 Search bar auto-unlocked via Timeout.");
    }, 100);

    return templates.length;
};

OL.openImportHub = function() {
    const html = `
        <div class="modal-head">
            <div class="modal-title-text">🔌 System Importer Hub</div>
            <button class="btn small soft" onclick="OL.closeModal()">Close</button>
        </div>
        <div class="modal-body">
            <p class="tiny muted" style="margin-bottom: 20px;">
                Select a service to sync. This will fetch live data using the API keys saved in your <b>Credentials</b> section.
            </p>
            
            <div class="cards-grid" style="grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 15px;">
                
                <div class="card is-clickable import-card" onclick="OL.syncExternalIntegrations('wealthbox')">
                    <div style="font-size: 24px; margin-bottom: 10px;">🕸️</div>
                    <div class="bold">Wealthbox</div>
                    <div class="tiny muted">Sync Workflow Templates & Steps</div>
                </div>

                <div class="card is-clickable import-card" onclick="OL.syncExternalIntegrations('jotform')">
                    <div style="font-size: 24px; margin-bottom: 10px;">📄</div>
                    <div class="bold">Jotform</div>
                    <div class="tiny muted">Import active Forms & Links</div>
                </div>

                <div class="card is-clickable import-card" onclick="OL.syncExternalIntegrations('calendly')">
                    <div style="font-size: 24px; margin-bottom: 10px;">📅</div>
                    <div class="bold">Calendly</div>
                    <div class="tiny muted">Import Event Types & Booking URLs</div>
                </div>

                <div class="card is-clickable import-card" onclick="OL.syncExternalIntegrations('ycbm')">
                    <div style="font-size: 24px; margin-bottom: 10px;">🗓️</div>
                    <div class="bold">YouCanBook.me</div>
                    <div class="tiny muted">Sync Booking Profiles</div>
                </div>

                <div class="card is-clickable import-card" onclick="OL.syncExternalIntegrations('activecampaign')">
                    <div style="font-size: 24px; margin-bottom: 10px;">📧</div>
                    <div class="bold">ActiveCampaign</div>
                    <div class="tiny muted">Import Marketing Automations</div>
                </div>

                <div class="card is-clickable import-card" onclick="OL.syncExternalIntegrations('mailerlite')">
                    <div style="font-size: 24px; margin-bottom: 10px;">⚡</div>
                    <div class="bold">MailerLite</div>
                    <div class="tiny muted">Sync Email Sequences</div>
                </div>

            </div>
        </div>
    `;
    openModal(html);
};

OL.upsertExternalResource = function(client, data) {
    if (!client.projectData.localResources) client.projectData.localResources = [];
    const library = client.projectData.localResources;
    
    // 🎯 REFINED MATCHING LOGIC
    // We check: 1. External ID (Best), 2. Name Match, 3. Clean Name Match (ignoring icons)
    const existingIdx = library.findIndex(r => {
        const matchId = (r.externalId && data.externalId && String(r.externalId) === String(data.externalId));
        const matchExactName = r.name.toLowerCase() === data.name.toLowerCase();
        
        // Handle "Imported" prefixes (e.g., matching "My Form" with "📄 Form: My Form")
        const cleanR = r.name.toLowerCase().replace(/^(📅 cal:|📄 form:|📧 ac:|🕸️ wb:)\s*/, '').trim();
        const cleanD = data.name.toLowerCase().replace(/^(📅 cal:|📄 form:|📧 ac:|🕸️ wb:)\s*/, '').trim();
        const matchCleanName = cleanR === cleanD;

        return matchId || matchExactName || matchCleanName;
    });

    if (existingIdx !== -1) {
        const old = library[existingIdx];
        console.log(`♻️ Grafting update onto: ${old.name}`);
        
        // 🧠 DEEP STEP PRESERVATION
        // If the imported data has steps, we try to preserve local edits (like descriptions or logic)
        if (data.steps && old.steps) {
            data.steps.forEach(newStep => {
                const oldStep = old.steps.find(os => os.name === newStep.name);
                if (oldStep) {
                    // Carry over logic and user-written descriptions from the existing card
                    newStep.logic = oldStep.logic || { in: [], out: [] };
                    newStep.description = oldStep.description || newStep.description;
                    newStep.id = oldStep.id; // Keep internal ID to prevent line breakage
                }
            });
        }

        // 🧬 UPDATE OBJECT
        library[existingIdx] = { 
            ...old, 
            ...data, 
            id: old.id,           // Never change the system ID
            coords: old.coords,   // Keep on Map
            stageId: old.stageId, // Keep in Lane
            layoutCol: old.layoutCol, // Keep in Column
            isGlobal: old.isGlobal,
            isExpanded: old.isExpanded ?? true
        };
    } else {
        // ✨ NEW DISCOVERY: Assign a formatted ID based on type
        console.log(`✨ New asset discovered: ${data.name}`);
        const prefix = data.id?.split('-')[0] || 'ext';
        data.id = `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
        
        // Initial setup for the Workbench
        data.isGlobal = true; 
        data.isExpanded = true;
        
        library.push(data);
    }
};

// 📡 THE SYNC ORCHESTRATOR
OL.syncExternalIntegrations = async function(serviceKey) {
    const client = getActiveClient();
    if (!client) return alert("❌ No active project selected.");

    const btn = event?.target;
    const originalText = btn ? btn.innerText : "";
    if (btn) { btn.innerText = "⏳ Syncing..."; btn.disabled = true; }

    try {
        console.group(`📡 Syncing: ${serviceKey}`);
        let count = 0;

        switch(serviceKey) {
            case 'wealthbox':
                count = await OL.syncWealthbox(client);
                break;
            case 'jotform':
                count = await OL.importJotform(client);
                break;
            case 'calendly':
                count = await OL.importCalendly(client);
                break;
            case 'activecampaign':
                count = await OL.importActiveCampaign(client);
                break;
            case 'mailerlite':
                count = await OL.importMailerLite(client);
                break;
            case 'ycbm':
                count = await OL.importYCBM(client);
                break;
            case 'redtail': // 🎯 ADDED
                count = await OL.syncRedtail(client);
                break;
            case 'processstreet': // 🎯 ADDED
            case 'process-street':
                count = await OL.syncProcessStreet(client);
                break;
        }

        await OL.persist();
        if (window.location.hash.includes('visualizer')) OL.renderVisualizer();
        alert(`✅ Sync Successful!\n- ${serviceKey.toUpperCase()}: ${count} items updated.`);

    } catch (e) {
        console.error(`🔥 ${serviceKey} Sync Error:`, e);
        alert(`Sync Failed: ${e.message}`);
    } finally {
        if (btn) { btn.innerText = originalText; btn.disabled = false; }
        console.groupEnd();
    }
};

OL.openImportHub = function() {
    const html = `
        <div class="modal-head">
            <div class="modal-title-text">🔌 System Importer Hub</div>
            <button class="btn small soft" onclick="OL.closeModal()">Close</button>
        </div>
        <div class="modal-body">
            <p class="tiny muted" style="margin-bottom: 20px;">
                Select a service to sync live data into your Workbench.
            </p>
            
            <div class="cards-grid" style="grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 15px;">
                
                <div class="card is-clickable import-card" onclick="OL.syncExternalIntegrations('wealthbox')">
                    <div style="font-size: 24px; margin-bottom: 10px;">🕸️</div>
                    <div class="bold">Wealthbox</div>
                    <div class="tiny muted">Sync Workflows</div>
                </div>

                <div class="card is-clickable import-card" onclick="OL.syncExternalIntegrations('jotform')">
                    <div style="font-size: 24px; margin-bottom: 10px;">📄</div>
                    <div class="bold">Jotform</div>
                    <div class="tiny muted">Sync Active Forms</div>
                </div>

                <div class="card is-clickable import-card" onclick="OL.syncExternalIntegrations('calendly')">
                    <div style="font-size: 24px; margin-bottom: 10px;">📅</div>
                    <div class="bold">Calendly</div>
                    <div class="tiny muted">Sync Event Types</div>
                </div>

                <div class="card is-clickable import-card" onclick="OL.syncExternalIntegrations('activecampaign')">
                    <div style="font-size: 24px; margin-bottom: 10px;">📧</div>
                    <div class="bold">ActiveCampaign</div>
                    <div class="tiny muted">Sync Automations</div>
                </div>

                <div class="card is-clickable import-card" onclick="OL.syncExternalIntegrations('mailerlite')">
                    <div style="font-size: 24px; margin-bottom: 10px;">⚡</div>
                    <div class="bold">MailerLite</div>
                    <div class="tiny muted">Sync Sequences</div>
                </div>

                <div class="card is-clickable import-card" onclick="OL.syncExternalIntegrations('ycbm')">
                    <div style="font-size: 24px; margin-bottom: 10px;">🗓️</div>
                    <div class="bold">YouCanBook.me</div>
                    <div class="tiny muted">Sync Booking Profiles</div>
                </div>

                <div class="card is-clickable import-card" onclick="OL.syncRedtail(OL.activeClient)">
                    <div style="font-size: 24px; margin-bottom: 10px;">🔴</div>
                    <div class="bold">Redtail</div>
                    <div class="tiny muted">Sync CRM Workflows</div>
                </div>
                
                <div class="card is-clickable import-card" onclick="OL.syncExternalIntegrations('processstreet')">
                    <div style="font-size: 24px; margin-bottom: 10px;">🏁</div>
                    <div class="bold">Process Street</div>
                    <div class="tiny muted">Sync Checklists</div>
                </div>

            </div>
        </div>
    `;
    openModal(html);
};

OL.importCalendly = async function(client) {
    const creds = OL.getCredsForApp(client, 'calendly');
    if (!creds?.secret) throw new Error("Calendly API Key missing in Credentials (Secret field).");

    // 🎯 The exact URL you provided
    const url = `https://us-central1-operations-library-d2fee.cloudfunctions.net/calendlyProxy?apiKey=${creds.secret}`;

    console.log("📡 Fetching from Calendly Proxy...");
    const response = await fetch(url);

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`Proxy Error: ${err}`);
    }

    const data = await response.json();
    const events = data.collection || [];

    events.forEach(ev => {
        const externalId = ev.uri.split('/').pop(); 
        
        OL.upsertExternalResource(client, {
            id: `cal-${externalId}`,
            externalId: externalId,
            name: `📅 Cal: ${ev.name}`,
            type: 'Event',
            externalUrl: ev.scheduling_url,
            description: ev.description || "Calendly Event Type",
            steps: [{ 
                id: uid(), 
                name: "Client Schedules Appointment", 
                appName: "Calendly" 
            }]
        });
    });

    return events.length;
};

OL.importYCBM = async function(client) {
    const creds = OL.getCredsForApp(client, 'youcanbookme');
    if (!creds?.secret) throw new Error("YCBM API Key missing in App Credentials.");

    // 1. Get the email from the username field, or prompt the user
    let email = creds.username;
    if (!email || email.trim() === "") {
        email = prompt("Please enter your YouCanBookMe account email:");
        if (!email) return 0; // User cancelled

        // Optional: Save it back to the project so it's remembered
        creds.username = email.trim();
        OL.persist(); 
    }

    let authKey = creds.secret;

    // 2. Encode to Base64 (email:api_key)
    // We check if it's already encoded; if it starts with 'ak_', it definitely isn't.
    if (authKey.startsWith('ak_')) {
        authKey = btoa(`${email.trim()}:${authKey.trim()}`);
    }

    const url = `https://us-central1-operations-library-d2fee.cloudfunctions.net/ycbmProxy?apiKey=${authKey}`;

    console.log("📡 Fetching from YCBM Proxy...");
    const response = await fetch(url);
    
    if (!response.ok) {
        const err = await response.text();
        throw new Error(`YCBM Error: ${err}`);
    }

    const profiles = await response.json();
    
    profiles.forEach(p => {
        OL.upsertExternalResource(client, {
            externalId: p.id,
            name: `🗓️ YCBM: ${p.title}`,
            type: 'Event',
            externalUrl: `https://${p.subdomain}.youcanbook.me`,
            steps: [{ id: uid(), name: "Customer Schedules via YCBM", appName: "YouCanBookMe" }]
        });
    });

    return profiles.length;
};

OL.importActiveCampaign = async function(client) {
    const creds = OL.getCredsForApp(client, 'activecampaign');
    if (!creds?.secret) throw new Error("ActiveCampaign API Key missing in Secret field.");

    // 1. Handle the Base URL (Prompt if missing)
    let baseUrl = creds.username; // We'll store the URL in the 'username' slot
    if (!baseUrl || !baseUrl.includes('http')) {
        baseUrl = prompt("Please enter your ActiveCampaign API URL (e.g., https://accountname.api-us1.com):");
        if (!baseUrl) return 0;
        
        // Sanitize: remove trailing slashes
        baseUrl = baseUrl.trim().replace(/\/$/, "");
        creds.username = baseUrl;
        OL.persist();
    }

    // 2. Use your Firebase v2 Proxy
    // 🎯 REPLACE 'acproxy-xxx' with your actual Firebase URL from the console
    const proxyUrl = `https://us-central1-operations-library-d2fee.cloudfunctions.net/acProxy`; 
    const finalUrl = `${proxyUrl}/?apiKey=${creds.secret}&baseUrl=${encodeURIComponent(baseUrl)}`;

    console.log("📡 Syncing ActiveCampaign Automations...");
    const response = await fetch(finalUrl);
    
    if (!response.ok) {
        const errTxt = await response.text();
        throw new Error(`AC Proxy Error: ${errTxt}`);
    }

    const data = await response.json();
    const autos = data.automations || [];

    autos.forEach(auto => {
        OL.upsertExternalResource(client, {
            id: `ac-${auto.id}`,
            externalId: auto.id,
            name: `📧 AC: ${auto.name}`,
            type: 'Email Campaign',
            archetype: 'Multi-Level',
            steps: [
                { id: uid(), name: "Trigger: " + (auto.enter_trigger || "Start"), appName: "ActiveCampaign" },
                { id: uid(), name: "Automation Flow Sequence", appName: "ActiveCampaign" }
            ]
        });
    });

    return autos.length;
};

OL.importMailerLite = async function(client) {
    const creds = OL.getCredsForApp(client, 'mailerlite');
    if (!creds?.secret) throw new Error("MailerLite API Key missing.");

    const url = `https://us-central1-operations-library-d2fee.cloudfunctions.net/mailerliteProxy?apiKey=${creds.secret}`;
    const response = await fetch(url);
    const data = await response.json();
    const automations = data.data || [];

    automations.forEach(auto => {
        OL.upsertExternalResource(client, {
            externalId: auto.id,
            name: `📧 ML: ${auto.name}`,
            type: 'Email Campaign',
            archetype: 'Multi-Level',
            steps: [
                { id: uid(), name: "Trigger: " + (auto.trigger_type || "Subscriber Joins"), appName: "MailerLite" },
                { id: uid(), name: "Automation Flow", appName: "MailerLite" }
            ]
        });
    });
    return automations.length;
};

OL.importJotform = async function(client) {
    const creds = OL.getCredsForApp(client, 'jotform');
    if (!creds?.secret) throw new Error("Jotform API Key missing.");

    // Ensure the URL is EXACT
    const url = `https://us-central1-operations-library-d2fee.cloudfunctions.net/jotformProxy?apiKey=${creds.secret}`;

    try {
        const response = await fetch(url, {
            method: 'GET',
            mode: 'cors', // Explicitly ask for CORS
            headers: { 'Accept': 'application/json' }
        });

        if (!response.ok) {
            const errTxt = await response.text();
            throw new Error(`Jotform Proxy Error (${response.status}): ${errTxt}`);
        }

        const data = await response.json();
        const forms = data.content || data.data || (Array.isArray(data) ? data : []);

        forms.forEach(form => {
            OL.upsertExternalResource(client, {
                id: `jf-${form.id}`,
                externalId: form.id,
                name: `📄 Form: ${form.title}`,
                type: 'Form',
                externalUrl: `https://www.jotform.com/form/${form.id}`,
                steps: [{ id: uid(), name: "User Submits Form", appName: "Jotform" }]
            });
        });
        return forms.length;
    } catch (err) {
        console.error("Fetch Interruption:", err);
        throw err;
    }
};

OL.syncProcessStreet = async function(client) {
    console.log("🚀 Starting Process Street v1.1 Sync...");
    const targetClient = client || OL.state.clients[OL.state.activeClientId];
    
    try {
        const registry = targetClient.projectData.accessRegistry || [];
        const psCreds = registry.find(r => {
            const app = targetClient.projectData.localApps.find(a => a.id === r.appId);
            const name = app?.name || "";
            return name.toLowerCase().includes('processstreet') || name.toLowerCase().includes('process street');
        });

        if (!psCreds?.secret) {
            alert("Missing Process Street API Key in Registry.");
            return;
        }

        let allWorkflows = [];
        // The API defaults to 20 results and uses a 'links' object for the next page
        let nextUrl = `https://us-central1-operations-library-d2fee.cloudfunctions.net/processStreetProxy?apiKey=${psCreds.secret}`;

        console.log("📡 Fetching Workflows...");

        while (nextUrl) {
            const res = await fetch(nextUrl);
            const data = await res.json();
            
            // 🎯 THE FIX: v1.1 uses 'workflows' instead of 'items'
            const pageWorkflows = data.workflows || [];
            allWorkflows = allWorkflows.concat(pageWorkflows);
            
            console.log(`📥 Received ${pageWorkflows.length} workflows...`);

            // Check for pagination in the 'links' section
            const nextLink = data.links?.find(l => l.rel === 'next' || l.name === 'next');
            if (nextLink && nextLink.href) {
                // Construct the next proxy URL
                nextUrl = `https://us-central1-operations-library-d2fee.cloudfunctions.net/processStreetProxy?apiKey=${psCreds.secret}&next=${encodeURIComponent(nextLink.href)}`;
            } else {
                nextUrl = null;
            }
        }

        console.log(`✅ Total Collected: ${allWorkflows.length} workflows.`);

        if (allWorkflows.length === 0) {
            alert("Process Street returned 0 workflows. Verify your account has 'Active' workflows.");
            return;
        }

        // 🧹 Wipe and Rebuild
        targetClient.projectData.localResources = (targetClient.projectData.localResources || [])
            .filter(r => !r.id.startsWith('ps-'));

        allWorkflows.forEach((wf, i) => {
            targetClient.projectData.localResources.push({
                id: `ps-workflow-${wf.id}-${i}`,
                externalId: wf.id,
                name: `🏁 PS: ${wf.name}`,
                type: 'Checklist',
                visible: true,
                category: 'Flows',
                isExpanded: true,
                steps: [] // We can fetch tasks later if needed
            });
        });

        if (typeof OL.persist === 'function') OL.persist();

        setTimeout(() => {
            const activeId = OL.state.activeClientId;
            if (OL.state.clients[activeId]) {
                OL.state.clients[activeId].projectData.localResources = targetClient.projectData.localResources;
            }
            if (typeof OL.syncResourceLibraryFilters === 'function') OL.syncResourceLibraryFilters();
            if (typeof OL.renderResourceManager === 'function') OL.renderResourceManager(targetClient);
        }, 300);

        alert(`🎉 Success! Synced ${allWorkflows.length} Process Street workflows.`);

    } catch (e) {
        console.error("🔥 PS v1.1 Sync Error:", e);
        alert("Sync Failed: " + e.message);
    }
};

// Renamed to 'syncRedtail' to break the cache
OL.syncRedtail = async function(client) {
    const targetClient = client || OL.state.clients[OL.state.activeClientId];
    if (!targetClient || !targetClient.projectData) return;

    try {
        const registry = targetClient.projectData.accessRegistry || [];
        const rtCreds = registry.find(r => {
            const app = targetClient.projectData.localApps.find(a => a.id === r.appId);
            return app?.name.toLowerCase().includes('redtail');
        });

        if (!rtCreds || !rtCreds.secret) throw new Error("Credentials missing.");

        const authString = rtCreds.secret;
        let allTemplates = [];
        let currentPage = 1;
        let totalPages = 1;

        console.log("📡 Starting Paginated Sync...");

        // 🎯 THE PAGINATION LOOP
        do {
            const url = `https://us-central1-operations-library-d2fee.cloudfunctions.net/redtailProxy?apiKey=${encodeURIComponent(authString)}&page=${currentPage}`;
            
            const response = await fetch(url);
            const result = await response.json();
            
            const pageTemplates = result.workflow_templates || [];
            allTemplates = allTemplates.concat(pageTemplates);
            
            // Update total pages from the API response
            totalPages = result.total_pages || 1;
            console.log(`📥 Received Page ${currentPage} of ${totalPages} (${pageTemplates.length} items)`);
            
            currentPage++;
        } while (currentPage <= totalPages);

       console.log(`✅ Total Templates Collected: ${allTemplates.length}`);

        // 1. Clear out old Redtail entries first to start fresh
        if (!targetClient.projectData.localResources) targetClient.projectData.localResources = [];
        targetClient.projectData.localResources = targetClient.projectData.localResources.filter(r => !r.id.startsWith('rt-'));

        console.log("🧹 Cleared old Redtail references. Re-building from 61 items...");

        allTemplates.forEach((wf, index) => {
            // 🎯 THE FIX: Force a unique ID using the Redtail ID + Index
            // This prevents the system from "merging" 61 items into 3.
            const uniqueId = `rt-workflow-${wf.id || index}-${index}`;

            const resourceData = {
                id: uniqueId,
                externalId: wf.id,
                name: `🔴 RT: ${wf.name}`,
                type: 'Workflow',
                visible: true,
                category: 'Flows',
                isExpanded: true,
                workflowId: null,
                archetype: 'Multi-Level',
                steps: [{ id: `step-${uniqueId}`, name: "Workflow Template", appName: 'Redtail' }]
            };

            // 🟢 Push directly to the array - bypassing any 'upsert' logic that might be bugged
            targetClient.projectData.localResources.push(resourceData);
        });

        console.log(`💾 Array count before persist: ${targetClient.projectData.localResources.length}`);

        // 🎯 THE LOCK: Ensure the system writes this array to the DB
        if (typeof OL.persist === 'function') OL.persist();

        // 🎯 UI RECOVERY: Force the render
        setTimeout(() => {
            if (typeof OL.syncResourceLibraryFilters === 'function') OL.syncResourceLibraryFilters();
            
            if (typeof OL.renderResourceManager === 'function') {
                OL.renderResourceManager(targetClient);
            }
            
            // Final Verification Check
            const finalCount = targetClient.projectData.localResources.filter(r => r.id.startsWith('rt-')).length;
            console.log(`🏁 Final verification: ${finalCount} Redtail items in memory.`);
            
            if(finalCount < 61) {
                console.error("⚠️ ALERT: Something is still stripping the array during persist!");
            }
        }, 300);
        
    } catch (e) {
        console.error("🔥 Sync Failed:", e);
    }
};

OL.getCredsForApp = function(client, appSlug) {
    // 🎯 SAFETY CHECK: If projectData is missing, the app isn't initialized
    if (typeof projectData === 'undefined' || !projectData) {
        console.error("❌ Database not loaded. Please wait a second and try again.");
        return null;
    }
    
    if (!client || !client.externalIntegrations) return null;
    return client.externalIntegrations.find(i => i.appSlug === appSlug);
};

OL.printFlowMap = function(view) {
    const client = getActiveClient();
    const data   = OL.getCurrentProjectData();
    const stages    = data.stages || [];
    const resources = (data.resources || []).filter(r => !r.isDeleted && !r.isLocked && !r.isArchived);
    const workflows = data.workflows || [];

    const clientName = client?.meta?.name || 'Flow Map';
    const viewLabel  = { flowchart: 'Swimlanes', list: 'List', steps: 'Steps' }[view] || view;
    const date       = new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });

    let bodyHtml = '';

    if (view === 'flowchart') {
        bodyHtml = OL._printFlowchartHtml(stages, resources, workflows);
    } else if (view === 'list') {
        bodyHtml = OL._printListHtml(stages, resources, workflows);
    } else if (view === 'steps') {
        bodyHtml = OL._printStepsHtml(stages, resources, workflows);
    }

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${clientName} — Flow Map (${viewLabel})</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Inter', -apple-system, sans-serif; font-size: 11px;
       color: #1b2d3f; background: #fff; padding: 32px; }

/* ── HEADER ── */
.print-header { display: flex; justify-content: space-between; align-items: flex-end;
                border-bottom: 2px solid #0f172a; padding-bottom: 12px; margin-bottom: 28px; }
.print-header-title { font-size: 20px; font-weight: 800; color: #0f172a; }
.print-header-sub { font-size: 11px; color: #64748b; margin-top: 3px; }
.print-header-meta { text-align: right; font-size: 10px; color: #94a3b8; }

/* ── STAGE HEADER ── */
.stage-header { display: flex; align-items: center; gap: 8px;
                margin: 28px 0 12px; padding-bottom: 8px;
                border-bottom: 1.5px solid #e5e7eb; }
.stage-num { width: 22px; height: 22px; border-radius: 5px; background: #3dd9c5;
             color: #fff; font-size: 10px; font-weight: 800;
             display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.stage-name { font-size: 13px; font-weight: 700; color: #0f172a; }
.stage-count { font-size: 10px; color: #94a3b8; margin-left: auto; }

/* ── WORKFLOW LABEL ── */
.wf-label { display: flex; align-items: center; gap: 6px;
            margin: 12px 0 8px; padding: 4px 0; }
.wf-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.wf-name { font-size: 10px; font-weight: 700; text-transform: uppercase;
           letter-spacing: 0.06em; color: #6b7280; }

/* ── SWIMLANES VIEW ── */
.swimlane-cards { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }

.resource-card { width: 220px; border: 1px solid #e5e7eb; border-radius: 10px;
                 overflow: hidden; page-break-inside: avoid; break-inside: avoid;
                 background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
.card-accent { height: 4px; width: 100%; }
.card-body { padding: 9px 11px 10px; }
.card-type-row { display: flex; align-items: center; gap: 5px; margin-bottom: 5px; }
.card-type-badge { padding: 1px 5px; border-radius: 3px; font-size: 8px;
                   font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; }
.card-name { font-size: 11px; font-weight: 700; color: #0f172a;
             line-height: 1.35; margin-bottom: 6px; }
.card-meta { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 5px; }
.card-meta-pill { font-size: 9px; padding: 1px 6px; border-radius: 99px;
                  background: #f1f5f9; color: #475569; border: 1px solid #e2e8f0; }
.card-steps { border-top: 1px solid #f1f5f9; margin-top: 6px; padding-top: 5px; }
.card-step { display: flex; align-items: flex-start; gap: 5px;
             padding: 3px 0; font-size: 9px; color: #374151; }
.card-step-num { width: 14px; height: 14px; border-radius: 99px; background: #f1f5f9;
                 font-size: 8px; font-weight: 700; color: #94a3b8; display: flex;
                 align-items: center; justify-content: center; flex-shrink: 0; }
.card-step-name { flex: 1; line-height: 1.3; }
.card-step-app { font-size: 8px; color: #0284c7; }
.card-step-logic { font-size: 8px; color: #7c3aed; font-weight: 700; }
.card-step-assignees { font-size: 8px; color: #64748b; }
.card-step-desc { font-size: 8px; color: #94a3b8; font-style: italic;
                  margin-top: 2px; line-height: 1.3; }

/* ── LIST VIEW ── */
.list-step-row { display: flex; align-items: flex-start; gap: 8px;
                 padding: 7px 10px; border: 1px solid #e5e7eb;
                 border-radius: 7px; margin-bottom: 4px;
                 page-break-inside: avoid; break-inside: avoid; }
.list-type-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; margin-top: 3px; }
.list-step-name { font-size: 11px; font-weight: 600; color: #0f172a; flex: 1; }
.list-step-meta { font-size: 9px; color: #64748b; margin-top: 2px; }
.list-step-branch { padding-left: 20px; border-left: 2px solid #e5e7eb; margin-left: 12px; margin-bottom: 4px; }
.list-branch-label { font-size: 8px; font-weight: 800; text-transform: uppercase;
                     color: #94a3b8; padding: 3px 0 4px 6px; }

/* ── STEPS VIEW (grouped by resource) ── */
.res-section { margin-bottom: 24px; page-break-inside: avoid; }
.res-section-header { display: flex; align-items: center; gap: 8px;
                      padding: 8px 12px; border-radius: 8px; margin-bottom: 8px; }
.res-section-name { font-size: 12px; font-weight: 700; color: #0f172a; }
.res-section-type { font-size: 9px; font-weight: 700; text-transform: uppercase;
                    letter-spacing: 0.06em; }
.step-row { display: flex; align-items: flex-start; gap: 8px;
            padding: 8px 12px; border: 1px solid #e5e7eb;
            border-radius: 8px; margin-bottom: 4px;
            page-break-inside: avoid; break-inside: avoid; }
.step-num { width: 20px; height: 20px; border-radius: 99px;
            font-size: 9px; font-weight: 800; display: flex;
            align-items: center; justify-content: center; flex-shrink: 0; }
.step-content { flex: 1; }
.step-name { font-size: 11px; font-weight: 600; color: #0f172a; margin-bottom: 3px; }
.step-details { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 3px; }
.step-detail-pill { font-size: 9px; padding: 1px 6px; border-radius: 99px; border: 1px solid; }
.step-app-pill { background: rgba(2,132,199,0.08); color: #0284c7; border-color: rgba(2,132,199,0.2); }
.step-assignee-pill { background: rgba(56,189,248,0.08); color: #0369a1; border-color: rgba(56,189,248,0.2); }
.step-logic-pill { background: rgba(124,58,237,0.08); color: #7c3aed; border-color: rgba(124,58,237,0.2); }
.step-desc { font-size: 9px; color: #64748b; margin-top: 4px; line-height: 1.4; font-style: italic; }
.logic-out { font-size: 9px; color: #7c3aed; margin-top: 3px; }
.logic-out-item { display: flex; align-items: center; gap: 4px; margin-top: 2px; }
.logic-arrow { color: #94a3b8; }

@media print {
  body { padding: 20px; }
  .stage-header { break-before: auto; }
  .res-section { break-inside: avoid; }
}
</style>
</head>
<body>
<div class="print-header">
    <div>
        <div class="print-header-title">${clientName}</div>
        <div class="print-header-sub">Flow Map — ${viewLabel} View</div>
    </div>
    <div class="print-header-meta">
        Generated ${date}<br>
        ${resources.length} resources · ${stages.length} stages
    </div>
</div>
${bodyHtml}
</body>
</html>`;

    // Open in new window and trigger print
    const win = window.open('', '_blank', 'width=1000,height=800');
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 800);
};

// ── FLOWCHART (SWIMLANES) ──────────────────────────
OL._printIcon = function(name, size = 10) {
    const icons = {
        'smartphone': '<path d="M17 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2z"/><line x1="12" y1="18" x2="12.01" y2="18"/>',
        'user':       '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
        'clock':      '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
        'repeat':     '<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
        'git-branch': '<line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
        'arrow-right':'<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>',
    };
    const path = icons[name] || '';
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;margin-right:3px;">${path}</svg>`;
};

OL._printFlowchartHtml = function(stages, resources, workflows) {
    const WF_COLORS = ['#3dd9c5','#7c3aed','#f97316','#38bdf8','#a78bfa','#fb923c','#10b981','#f43f5e'];
    let html = '';
    stages.forEach((stage, si) => {
        const stageWfs  = workflows.filter(w => w.stageId === stage.id);
        const assignedIds = new Set(stageWfs.flatMap(w => w.resourceIds || []));
        const unassigned  = resources.filter(r => r.stageId === stage.id && !assignedIds.has(String(r.id)));
        const totalCards  = stageWfs.reduce((a, w) => a + (w.resourceIds || []).length, 0) + unassigned.length;
        if (totalCards === 0) return;
        html += `<div class="stage-header">
            <div class="stage-num">${si + 1}</div>
            <div class="stage-name">${esc(stage.name)}</div>
            <div class="stage-count">${totalCards} resource${totalCards !== 1 ? 's' : ''}</div>
        </div>`;
        stageWfs.forEach((wf, wfi) => {
            const wfColor = wf.color || WF_COLORS[wfi % WF_COLORS.length];
            const wfRes = (wf.resourceIds || [])
                .map(id => resources.find(r => String(r.id) === id))
                .filter(Boolean);
            if (!wfRes.length) return;
            html += `<div class="wf-label">
                <div class="wf-dot" style="background:${wfColor};"></div>
                <div class="wf-name">${esc(wf.name)}</div>
            </div>
            <div class="swimlane-cards">
                ${wfRes.map(res => OL._printCard(res, resources)).join('')}
            </div>`;
        });
        if (unassigned.length) {
            html += `<div class="wf-label">
                <div class="wf-dot" style="background:#9ca3af;"></div>
                <div class="wf-name">Unassigned</div>
            </div>
            <div class="swimlane-cards">
                ${unassigned.map(res => OL._printCard(res, resources)).join('')}
            </div>`;
        }
    });
    return html;
};

OL._printCard = function(res, allResources) {
    const tc = OL._fvGetType(res.type);
    const steps = (res.steps || []).filter(s => !s.isArchived);
    const assignees = (res.assignees || []).map(a => esc(a.name)).join(', ');
    const appName = res.appName || '';

    return `<div class="resource-card">
        <div class="card-accent" style="background:${tc.color};"></div>
        <div class="card-body">
            <div class="card-type-row">
                <span class="card-type-badge" style="background:${tc.color}18;color:${tc.color};">
                    ${esc(res.type || 'General')}
                </span>
            </div>
            <div class="card-name">${esc(res.name)}</div>
            ${appName || assignees ? `
                <div class="card-meta">
                    ${appName ? `<span class="card-meta-pill">${OL._printIcon('smartphone')} ${esc(appName)}</span>` : ''}
                    ${assignees ? `<span class="card-meta-pill">${OL._printIcon('user')} ${assignees}</span>` : ''}
                </div>
            ` : ''}
            ${steps.length ? `
                <div class="card-steps">
                    ${steps.map((s, i) => {
                        const stepAssignees = (s.assignees || []).map(a => a.name).join(', ');
                        const logicOuts = (s.logic?.out || []).filter(l => l.targetId || l.type === 'delay');

                        const logicLines = logicOuts.map(l => {
                            const types = l.types || [l.type || 'next'];

                            if (types.includes('delay')) {
                                const amt   = l.delayAmount || l.amount || '';
                                const unit  = l.delayUnit  || l.unit   || 'days';
                                const label = l.rule || l.label || '';
                                return `<div class="card-step-logic-out">${OL._printIcon('clock')} Delay ${amt ? amt + ' ' + unit : unit}${label ? ' — ' + esc(label) : ''}</div>`;
                            }

                            if (types.includes('loop')) {
                                const label = l.rule || l.label || l.loopOver || '';
                                return `<div class="card-step-logic-out">${OL._printIcon('repeat')} Loop${label ? ' <em>' + esc(label) + '</em>' : ''}</div>`;
                            }

                            if (types.includes('condition')) {
                                const rule = l.rule || l.label || '';
                                const lastH = String(l.targetId || '').lastIndexOf('-');
                                let targetLabel = '';
                                if (lastH !== -1) {
                                    const tRes  = (allResources || []).find(r => String(r.id) === l.targetId.substring(0, lastH));
                                    const tStep = tRes?.steps?.find(s2 => String(s2.id) === l.targetId.substring(lastH + 1));
                                    if (tStep) targetLabel = ' → ' + esc(tStep.name);
                                    else if (tRes) targetLabel = ' → ' + esc(tRes.name);
                                }
                                return `<div class="card-step-logic-out">${OL._printIcon('git-branch')} ${rule ? '<em>' + esc(rule) + '</em>' : 'If condition'}${targetLabel}</div>`;
                            }

                            const label = l.rule || l.label || '';
                            return label ? `<div class="card-step-logic-out">${OL._printIcon('arrow-right')} ${esc(label)}</div>` : '';
                        }).filter(Boolean).join('');

                        return `<div class="card-step">
                            <div class="card-step-num">${i + 1}</div>
                            <div style="flex:1;">
                                <div class="card-step-name">${esc(s.name || 'Unnamed')}</div>
                                ${s.appName ? `<div class="card-step-app">${OL._printIcon('smartphone')} ${esc(s.appName)}</div>` : ''}
                                ${stepAssignees ? `<div class="card-step-assignees">${OL._printIcon('user')} ${stepAssignees}</div>` : ''}
                                ${logicLines}
                            </div>
                        </div>`;
                    }).join('')}
                </div>
            ` : ''}
        </div>
    </div>`;
};

// ── LIST VIEW ──────────────────────────────────────
OL._printListHtml = function(stages, resources, workflows) {
    let html = '';
    const renderedSteps = new Set();

    const renderStep = (step, res, depth) => {
        if (renderedSteps.has(step.id)) return '';
        renderedSteps.add(step.id);
        const tc = OL._fvGetType(res.type);
        const assignees = (step.assignees || []).map(a => a.name).join(', ');
        const logic = (step.logic?.out || []).filter(l => l.targetId);
        const conditions = logic.filter(l => (l.types||[l.type||'next']).includes('condition'));
        const indent = depth > 0 ? `padding-left:${depth * 20}px;` : '';

        let out = `<div class="list-step-row" style="${indent}">
            <div class="list-type-dot" style="background:${tc.color};"></div>
            <div style="flex:1;">
                <div class="list-step-name">${esc(step.name || 'Unnamed')}</div>
                <div class="list-step-meta">
                    ${esc(res.name)}
                    ${step.appName ? ` · ${esc(step.appName)}` : ''}
                    ${assignees ? ` · ${assignees}` : ''}
                </div>
            </div>
        </div>`;

        conditions.forEach(cond => {
            const lastH = String(cond.targetId || '').lastIndexOf('-');
            if (lastH === -1) return;
            const tResId  = cond.targetId.substring(0, lastH);
            const tStepId = cond.targetId.substring(lastH + 1);
            const tRes  = resources.find(r => String(r.id) === tResId);
            const tStep = tRes?.steps?.find(s => String(s.id) === tStepId);
            if (tRes && tStep) {
                out += `<div class="list-step-branch">
                    <div class="list-branch-label">◆ ${esc(cond.rule || 'If condition')}</div>
                    ${renderStep(tStep, tRes, depth + 1)}
                </div>`;
            }
        });

        return out;
    };

    const WF_COLORS = ['#3dd9c5','#7c3aed','#f97316','#38bdf8','#a78bfa','#fb923c','#10b981','#f43f5e'];

    stages.forEach((stage, si) => {
        const stageWfs    = workflows.filter(w => w.stageId === stage.id);
        const assignedIds = new Set(stageWfs.flatMap(w => w.resourceIds || []));
        const unassigned  = resources.filter(r => r.stageId === stage.id && !assignedIds.has(String(r.id)));

        // Check if stage has any content before rendering header
        const hasContent = stageWfs.some(wf => (wf.resourceIds || []).some(id => {
            const res = resources.find(r => String(r.id) === id);
            return res && (res.steps || []).some(s => !s.isArchived);
        })) || unassigned.some(r => (r.steps || []).some(s => !s.isArchived));
        if (!hasContent) return;

        html += `<div class="stage-header">
            <div class="stage-num">${si + 1}</div>
            <div class="stage-name">${esc(stage.name)}</div>
        </div>`;

        stageWfs.forEach((wf, wfi) => {
            const wfColor = wf.color || WF_COLORS[wfi % WF_COLORS.length];
            const wfRes = (wf.resourceIds || [])
                .map(id => resources.find(r => String(r.id) === id))
                .filter(Boolean);

            let wfStepsHtml = '';
            wfRes.forEach(res => {
                (res.steps || []).filter(s => !s.isArchived)
                    .forEach(s => { wfStepsHtml += renderStep(s, res, 0); });
            });

            if (!wfStepsHtml) return;

            html += `<div class="wf-label">
                <div class="wf-dot" style="background:${wfColor};"></div>
                <div class="wf-name">${esc(wf.name)}</div>
            </div>
            ${wfStepsHtml}`;
        });

        let unassignedHtml = '';
        unassigned.forEach(res => {
            (res.steps || []).filter(s => !s.isArchived)
                .forEach(s => { unassignedHtml += renderStep(s, res, 0); });
        });

        if (unassignedHtml) {
            html += `<div class="wf-label">
                <div class="wf-dot" style="background:#9ca3af;"></div>
                <div class="wf-name">Unassigned</div>
            </div>
            ${unassignedHtml}`;
        }
    });

    return html;
};

// ── STEPS VIEW (resources as side-by-side columns per workflow, mirroring the visualizer) ──
OL._printStepsHtml = function(stages, resources, workflows) {
    let html = '';
    const WF_COLORS = ['#3dd9c5','#7c3aed','#f97316','#38bdf8','#a78bfa','#fb923c','#10b981','#f43f5e'];

    // Build one step row for a column
    const stepRowHtml = (s, i, res, allResources) => {
        const tc = OL._fvGetType(res.type);
        const assignees = (s.assignees || []).map(a => esc(a.name)).join(', ');
        const logic = (s.logic?.out || []).filter(l => l.targetId && !l._implicit);
        const crossLinks = logic.map(l => {
            const lastH = String(l.targetId || '').lastIndexOf('-');
            if (lastH === -1) return '';
            const tResId = l.targetId.substring(0, lastH);
            if (String(tResId) === String(res.id)) return ''; // same-resource next step, skip
            const tRes  = allResources.find(r => String(r.id) === tResId);
            const tStep = tRes?.steps?.find(s2 => String(s2.id) === l.targetId.substring(lastH + 1));
            if (!tRes || !tStep) return '';
            const types = l.types || [l.type || 'next'];
            const arrow = types.includes('condition') ? '◆' : types.includes('loop') ? '↺' : types.includes('delay') ? '⏱' : '→';
            const rule  = l.rule ? `<em>${esc(l.rule)}</em>: ` : '';
            return `<div style="font-size:8px;color:#7c3aed;margin-top:2px;">${arrow} ${rule}${esc(tRes.name)}</div>`;
        }).filter(Boolean).join('');

        return `<div style="padding:6px 9px;border-bottom:1px solid #f1f5f9;display:flex;gap:6px;align-items:flex-start;break-inside:avoid;">
            <div style="width:17px;height:17px;border-radius:50%;background:${tc.color}18;color:${tc.color};
                        font-size:8px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px;">${i + 1}</div>
            <div style="flex:1;min-width:0;">
                <div style="font-size:10px;font-weight:600;color:#0f172a;line-height:1.35;">${esc(s.name || 'Unnamed')}</div>
                ${s.appName ? `<div style="font-size:8px;color:#0284c7;margin-top:1px;">${esc(s.appName)}</div>` : ''}
                ${assignees ? `<div style="font-size:8px;color:#64748b;margin-top:1px;">${esc(assignees)}</div>` : ''}
                ${crossLinks}
            </div>
        </div>`;
    };

    stages.forEach((stage, si) => {
        const stageWfs = workflows.filter(w => w.stageId === stage.id);
        const assignedIds = new Set(stageWfs.flatMap(w => w.resourceIds || []));
        const hasContent = stageWfs.some(wf =>
            (wf.resourceIds || []).some(id => {
                const r = resources.find(r => String(r.id) === id);
                return r && (r.steps || []).some(s => !s.isArchived);
            })
        );
        if (!hasContent) return;

        html += `<div class="stage-header" style="break-before:auto;">
            <div class="stage-num">${si + 1}</div>
            <div class="stage-name">${esc(stage.name)}</div>
        </div>`;

        stageWfs.forEach((wf, wfi) => {
            const wfColor = wf.color || WF_COLORS[wfi % WF_COLORS.length];
            const wfRes = (wf.resourceIds || [])
                .map(id => resources.find(r => String(r.id) === id))
                .filter(r => r && (r.steps || []).some(s => !s.isArchived));
            if (!wfRes.length) return;

            html += `<div class="wf-label">
                <div class="wf-dot" style="background:${wfColor};"></div>
                <div class="wf-name">${esc(wf.name)}</div>
            </div>
            <div style="display:flex;gap:10px;align-items:flex-start;margin-bottom:20px;break-inside:avoid;">`;

            wfRes.forEach(res => {
                const steps = (res.steps || []).filter(s => !s.isArchived);
                const tc = OL._fvGetType(res.type);
                html += `<div style="flex:1;min-width:0;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;break-inside:avoid;">
                    <div style="padding:7px 9px;background:${tc.color}12;border-bottom:2px solid ${tc.color};">
                        <div style="font-size:8px;font-weight:800;text-transform:uppercase;letter-spacing:0.06em;color:${tc.color};">${esc(res.type || 'General')}</div>
                        <div style="font-size:11px;font-weight:700;color:#0f172a;margin-top:1px;line-height:1.2;">${esc(res.name)}</div>
                        ${res.appName ? `<div style="font-size:8px;color:#0284c7;margin-top:2px;">${esc(res.appName)}</div>` : ''}
                    </div>
                    ${steps.map((s, i) => stepRowHtml(s, i, res, resources)).join('')}
                </div>`;
            });

            html += `</div>`; // close flex row
        });

        // Unassigned resources for this stage
        const unassigned = resources.filter(r => r.stageId === stage.id && !assignedIds.has(String(r.id)) && (r.steps || []).some(s => !s.isArchived));
        if (unassigned.length) {
            html += `<div class="wf-label"><div class="wf-dot" style="background:#9ca3af;"></div><div class="wf-name">Unassigned</div></div>
            <div style="display:flex;gap:10px;align-items:flex-start;margin-bottom:20px;break-inside:avoid;">`;
            unassigned.forEach(res => {
                const steps = (res.steps || []).filter(s => !s.isArchived);
                const tc = OL._fvGetType(res.type);
                html += `<div style="flex:1;min-width:0;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;break-inside:avoid;">
                    <div style="padding:7px 9px;background:${tc.color}12;border-bottom:2px solid ${tc.color};">
                        <div style="font-size:8px;font-weight:800;text-transform:uppercase;letter-spacing:0.06em;color:${tc.color};">${esc(res.type || 'General')}</div>
                        <div style="font-size:11px;font-weight:700;color:#0f172a;margin-top:1px;">${esc(res.name)}</div>
                    </div>
                    ${steps.map((s, i) => stepRowHtml(s, i, res, resources)).join('')}
                </div>`;
            });
            html += `</div>`;
        }
    });

    return html;
};
