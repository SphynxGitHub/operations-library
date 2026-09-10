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
import * as OLTeam from './features/team.js';
import * as OLCredentials from './features/credentials.js';
import * as OLDataManager from './features/data-manager.js';
import * as OLScoping from './features/scoping.js';
import * as OLIntegrations from './features/integrations.js';
import * as OLHowTo from './features/how-to.js';
import * as OLAnalysis from './features/analysis.js';
import * as OLFlowCore from './features/flow-visualizer/core.js';
import * as OLBusinessManager from './features/business/index.js';

window.isMatrixActive = false;

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

    const businessTabs = [
    { key: "dashboard", label: "Daily Dashboard", icon: "layout-dashboard", href: "#/business/dashboard" },
    { key: "communications", label: "Communications", icon: "mail", href: "#/business/communications" },
    { key: "calendar", label: "Calendar", icon: "calendar", href: "#/business/calendar" },
    { key: "tasks", label: "Task Manager", icon: "check-square", href: "#/business/tasks" },
    { key: "time-reports", label: "Time Reports", icon: "bar-chart-2", href: "#/business/time-reports" },
    { key: "financials", label: "Financials", icon: "circle-dollar-sign", href: "#/business/financials" },
    { key: "clients", label: "Clients", icon: "users", href: "#/business/clients" }
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

   //================SIDEBAR MENU CONTROLS=================//
    
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

    ${(isAdmin || effectiveAdminMode) && !client ? `
        <!-- 🏢 BUSINESS MANAGER MENU (Global Level) -->
        <div class="client-nav-zone admin-workspace">
            <div class="menu-category-label">Business Manager</div>
            <nav class="menu">
                ${businessTabs.map(item => `
                    <a href="${item.href}" class="${(hash === item.href || (item.key === 'dashboard' && (hash === '#/' || hash === ''))) ? 'active' : ''}">
                        <i data-lucide="${item.icon}" style="width:16px;height:16px;flex-shrink:0;"></i> 
                        <span class="menu-item">${item.label}</span>
                    </a>
                `).join('')}
            </nav>
            
            <div class="divider" style="margin: 15px 0;"></div>
            
            <!-- 🏛️ TEMPLATE VAULT / BUILDER LINK -->
            <div class="menu-category-label">Template Vault</div>
            <nav class="menu">
                ${masterTabs.map(item => `
                    <a href="${item.href}" class="${hash === item.href ? 'active' : ''}">
                        <i data-lucide="${item.icon}" style="width:16px;height:16px;flex-shrink:0;"></i> 
                        <span class="menu-item">${item.label}</span>
                    </a>
                `).join('')}
            </nav>
        </div>
    ` : client ? `
        <!-- 📁 2. SHOW CLIENT MENU ONLY WHEN INSIDE A CLIENT PROJECT -->
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
    const isBusinessRoute = hash.startsWith('#/business') || hash === '#/' || hash === '';
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

    if (hash === "#/" || hash === "" || hash === "#/business/dashboard") {
        document.body.classList.remove('is-visualizer', 'fs-mode-active');
        OL.renderDailyDashboard();
        return;
    }
    
    if (hash.startsWith('#/business')) {
        document.body.classList.remove('is-visualizer', 'fs-mode-active');
        
        if (hash.includes('/communications')) OL.renderBusinessCommunications();
        else if (hash.includes('/calendar')) OL.renderBusinessCalendar();
        else if (hash.includes('/tasks')) OL.renderBusinessTaskManager();
        else if (hash.includes('/time-reports') && typeof OL.openTimeReportModal === 'function') {
            OL.renderBusinessTimeReports();
        }
        else if (hash.includes('/financials')) OL.renderBusinessFinancials();
        else if (hash.includes('/clients')) renderClientDashboard(); // Shows current global registry view
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
