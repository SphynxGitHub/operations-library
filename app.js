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
import * as OLBusinessManager from './features/business-manager.js';

window.isMatrixActive = false;

// 🚀 SAFE ENTRY POINT
function bootSystem() {
    try {
        console.log("🏁 Booting System...");

        // 1. Initialize Security
        if (typeof OL !== 'undefined' && typeof OL.initializeSecurityContext === 'function') {
            const ok = OL.initializeSecurityContext();
            if (!ok) return;
        }

        // 2. Admin Check
        if (window.location.search.includes('admin=pizza123')) {
            if (typeof state !== 'undefined') state.adminMode = true;
        }

        // 3. Restore State Memory
        const savedClientId = sessionStorage.getItem('lastActiveClientId');
        if (savedClientId && typeof state !== 'undefined') state.activeClientId = savedClientId;

        // 4. Build Layout & Trigger Initial Route
        if (typeof window.buildLayout === 'function') window.buildLayout();
        if (typeof window.handleRoute === 'function') window.handleRoute();

        // 5. Connect Firebase Listener
        if (typeof OL !== 'undefined' && typeof OL.sync === 'function') {
            OL.sync();
        }
    } catch (err) {
        console.error("💀 Boot Error Caught:", err);
    }
}

if (document.readyState === "complete" || document.readyState === "interactive") {
    bootSystem();
} else {
    window.addEventListener("DOMContentLoaded", bootSystem);
}

OL.goToDashboard = function(hash) {
    if (typeof state !== 'undefined') state.activeClientId = null;
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
    const registry = (typeof state !== 'undefined' && state.master) ? state.master.resourceTypes || [] : [];
    const entry = registry.find(t => String(t.type).toLowerCase() === String(type).toLowerCase());
    if (entry && entry.lucideIcon) return entry.lucideIcon;

    const defaults = {
        zap: "zap", form: "file-text", email: "mail", event: "calendar",
        sop: "book-open", guide: "book-open", workflow: "workflow",
        checklist: "clipboard-list", signature: "pen-tool", spreadsheet: "table",
        folder: "folder", other: "settings"
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

    const panel = document.getElementById('v2-inspector-panel') || document.getElementById('inspector-panel');
    const inspectorOpen = panel && panel.classList.contains('open');
    const layout = document.querySelector('.three-pane-layout');

    if (layout) {
        const leftCol = isCollapsed ? '65px' : '240px';
        const rightCol = inspectorOpen ? '380px' : '0px';
        layout.style.gridTemplateColumns = `${leftCol} 1fr ${rightCol}`;
    }
    window.dispatchEvent(new Event('resize'));
};

window.addEventListener('load', () => {
    const sidebar = document.querySelector('.sidebar');
    if (sidebar && localStorage.getItem('sidebarCollapsed') === 'true') {
        sidebar.classList.add('collapsed');
    }
});

window.addEventListener('resize', () => {
    if (!window.location.hash.includes('visualizer')) return;
    const body = document.getElementById('fv-body');
    if (!body) return;

    body.style.display = 'none';
    body.offsetHeight;
    body.style.display = 'flex';

    if (typeof OL._fvSyncRailHeights === 'function') {
        OL._fvSyncRailHeights();
    }
});

OL.toggleTheme = function() {
    const isLight = document.body.classList.toggle('light-mode');
    localStorage.setItem('ol_theme', isLight ? 'light' : 'dark');
    if (typeof window.buildLayout === 'function') window.buildLayout(); 
    if (window.location.hash.includes('visualizer') && typeof OL.renderVisualizer === 'function') {
        OL.renderVisualizer();
    }
    if (window.lucide) window.lucide.createIcons();
};

OL.getViewMode = function(pageKey) {
    if (typeof state === 'undefined') return 'cards';
    if (!state.viewModes) state.viewModes = {};
    return state.viewModes[pageKey] || localStorage.getItem(`ol_view_${pageKey}`) || 'cards';
};

OL.setViewMode = function(pageKey, mode) {
    if (typeof state === 'undefined') return;
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
      console.error("❌ ERROR: Could not find 'app-root' in index.html!");
      return; 
  }
  const mainEl = document.getElementById('mainContent');
  if (mainEl && !window.location.hash.includes('visualizer')) {
      mainEl.style.cssText = '';
  }
  
  const client = typeof getActiveClient === 'function' ? getActiveClient() : null;
  const hash = location.hash || "#/";
  const urlParams = new URLSearchParams(window.location.search);
  const isAdmin = window.FORCE_ADMIN === true;
  const isPublic = urlParams.has("access");
  const isPartnerProject = client && client.meta?.status === "Partner";
  const isPartnerMode = isPartnerProject || (client && !!client.meta?.partnerOwner);
  const isMaster = hash.startsWith("#/vault") && !window.IS_GUEST;

  let homeLabel = "Dashboard";
  let homeAction = "";
  let showHome = true;

  if (isAdmin) {
      homeLabel = "Global Registry";
      homeAction = `OL.goToDashboard('#/')`;
  } else if (client && client.meta?.status === "Partner") {
      homeLabel = "My Portfolio";
      homeAction = `OL.goToDashboard('#/partner-dashboard')`;
  } else if (client && client.meta?.partnerOwner) {
      homeLabel = !window.IS_GUEST ? "Partner Home" : "My Portfolio";
      homeAction = `OL.goToDashboard('#/partner-dashboard')`;
  } else if (isPublic) {
      showHome = false;
  }
    
  if (!client && !isMaster && !isPublic && !isPartnerMode && !isAdmin) {
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

  const effectiveAdminMode = isPublic ? false : (typeof state !== 'undefined' ? state.adminMode : false);

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
    { key: "client-access", label: "Client Logins", icon: "key-round", href: "#/vault/client-access" }
  ];

  const businessTabs = [
    { key: "dashboard", label: "Daily Dashboard", icon: "layout-dashboard", href: "#/business/dashboard" },
    { key: "communications", label: "Communications", icon: "mail", href: "#/business/communications" },
    { key: "calendar", label: "Calendar", icon: "calendar", href: "#/business/calendar" },
    { key: "tasks", label: "Task Manager", icon: "check-square", href: "#/business/tasks" },
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
    { key: "data", label: "Data Tags", icon: "tag", href: "#/data" }
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
  const toggleArrow = isSidebarCollapsed ? '▶' : '◀';

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
          <!-- 📁 CLIENT MENU (Project Level) -->
          <div class="client-nav-zone">
              <div class="menu-category-label">Project Workspace</div>
              <div class="client-profile-trigger" 
                  ${!isPublic ? `onclick="OL.openClientProfileModal('${client.id}')" style="cursor:pointer;"` : `style="cursor:default;"`}>
                  <div class="client-avatar">${esc(client.meta?.name ? client.meta.name.substring(0,2).toUpperCase() : 'CL')}</div>
                  <div class="client-info">
                      <div class="client-name">${esc(client.meta?.name || 'Client')}</div>
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
                      const perm = typeof OL.checkPermission === 'function' ? OL.checkPermission(item.key) : 'full';
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

  const sidebar = shell.querySelector('.sidebar');
  if (sidebar) sidebar.innerHTML = sidebarContent;

  const main = shell.querySelector('main');
  if (main && main.id !== 'mainContent') main.id = 'mainContent';

  const inspector = document.getElementById('inspector-panel');
  if (inspector && !inspector.querySelector('.inspector-scroll-content')) {
      inspector.innerHTML = `<div class="sidebar-resizer right-side-handle"></div><div class="inspector-scroll-content"></div>`;
      if (typeof OL.initSideResizers === 'function') OL.initSideResizers();
  }

  const layout = document.querySelector('.three-pane-layout');
  if (layout) {
      const sidebarCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';
      const leftCol = sidebarCollapsed ? '65px' : '240px';
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
    
    if (!isVisualizer) {
        document.body.classList.remove('is-visualizer', 'fs-mode-active');
        
        ['inspector-panel', 'v2-inspector-panel'].forEach(id => {
            const panel = document.getElementById(id);
            if (panel) {
                panel.classList.remove('open');
                panel.style.width = '0px';
                panel.style.minWidth = '0px';
                panel.style.display = 'none';
            }
        });

        const inspectorContent = document.getElementById('inspector-content');
        if (inspectorContent) inspectorContent.innerHTML = '';
        if (window.OL?._fv) window.OL._fv._lastInspectorResId = null;

        const layout = document.querySelector('.three-pane-layout');
        if (layout) {
            const sidebarCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';
            const leftCol = sidebarCollapsed ? '65px' : '240px';
            layout.style.gridTemplateColumns = `${leftCol} 1fr 0px`;
        }
    } else {
        document.body.classList.add('is-visualizer');
    }

    window.buildLayout();

    const main = document.getElementById("mainContent");
    if (!main) return; 

    const client = typeof getActiveClient === 'function' ? getActiveClient() : null;
    const isVault = hash.startsWith('#/vault');
    const ol = window.OL || {};

    // 1. Business Manager / Daily Dashboard Routes (Global Level)
    if (hash === "#/" || hash === "" || hash === "#/business/dashboard") {
        document.body.classList.remove('is-visualizer', 'fs-mode-active');
        if (typeof OL.renderDailyDashboard === 'function') {
            OL.renderDailyDashboard();
        } else if (typeof renderClientDashboard === 'function') {
            renderClientDashboard();
        } else if (typeof OLClientDashboard.renderClientDashboard === 'function') {
            OLClientDashboard.renderClientDashboard();
        }
        return;
    }
    
    if (hash.startsWith('#/business')) {
        document.body.classList.remove('is-visualizer', 'fs-mode-active');
        
        if (hash.includes('/communications') && typeof OL.renderBusinessCommunications === 'function') OL.renderBusinessCommunications();
        else if (hash.includes('/calendar') && typeof OL.renderBusinessCalendar === 'function') OL.renderBusinessCalendar();
        else if (hash.includes('/tasks') && typeof OL.renderBusinessTaskManager === 'function') OL.renderBusinessTaskManager();
        else if (hash.includes('/financials') && typeof OL.renderBusinessFinancials === 'function') OL.renderBusinessFinancials();
        else if (hash.includes('/clients')) {
            if (typeof renderClientDashboard === 'function') renderClientDashboard();
            else if (typeof OLClientDashboard.renderClientDashboard === 'function') OLClientDashboard.renderClientDashboard();
        }
        return;
    }

    // 2. Vault / Master Routes
    if (isVault) {
        if (window.IS_GUEST) {
            window.location.hash = '#/';
            return;
        }
        if (hash.includes("/apps")) {
            if (typeof renderAppsGrid === 'function') renderAppsGrid();
            else if (typeof OLApps.renderAppsGrid === 'function') OLApps.renderAppsGrid();
        }
        else if (hash.includes("/functions")) {
            if (typeof renderFunctionsGrid === 'function') renderFunctionsGrid();
            else if (typeof OLFunctions.renderFunctionsGrid === 'function') OLFunctions.renderFunctionsGrid();
        }
        else if (hash.includes("/resources")) {
            if (typeof renderResourceManager === 'function') renderResourceManager();
            else if (typeof OLResourcesGrid.renderResourceManager === 'function') OLResourcesGrid.renderResourceManager();
        }
        else if (hash.includes("/visualizer")) {
            if (typeof state !== 'undefined') state.viewMode = 'graph';
            document.body.classList.add('is-visualizer');
            if (typeof renderVisualizer === 'function') renderVisualizer();
            else if (typeof ol.renderVisualizer === 'function') ol.renderVisualizer();
        }
        else if (hash.includes("/how-to")) {
            if (typeof renderHowToLibrary === 'function') renderHowToLibrary();
            else if (typeof ol.renderHowToLibrary === 'function') ol.renderHowToLibrary();
        }
        else if (hash.includes("/tasks")) {
            if (typeof renderChecklistModule === 'function') renderChecklistModule(true);
            else if (typeof OLTasks.renderChecklistModule === 'function') OLTasks.renderChecklistModule(true);
        }
        else if (hash.includes("/analyses")) {
            if (typeof renderAnalysisModule === 'function') renderAnalysisModule(true);
            else if (typeof OLAnalysis.renderAnalysisModule === 'function') OLAnalysis.renderAnalysisModule(true);
        }
        else if (hash.includes("/rates")) {
            if (typeof renderVaultRatesPage === 'function') renderVaultRatesPage();
            else if (typeof OLResourcesGrid.renderVaultRatesPage === 'function') OLResourcesGrid.renderVaultRatesPage();
        }
        else if (hash.includes("/data")) {
            if (typeof ol.renderGlobalDataManager === 'function') ol.renderGlobalDataManager();
        }
        else if (hash.includes("/client-access") && typeof OL.renderClientAccessList === 'function') {
            OL.renderClientAccessList();
        }
        return;
    }

    // 3. Client Project Workspace Routes
    if (client) {
        if (hash.includes("client-tasks")) {
            if (typeof renderChecklistModule === 'function') renderChecklistModule();
            else if (typeof OLTasks.renderChecklistModule === 'function') OLTasks.renderChecklistModule();
        }
        else if (hash.includes("resources")) {
            if (typeof renderResourceManager === 'function') renderResourceManager();
            else if (typeof OLResourcesGrid.renderResourceManager === 'function') OLResourcesGrid.renderResourceManager();
        }
        else if (hash.includes("applications")) {
            if (typeof renderAppsGrid === 'function') renderAppsGrid();
            else if (typeof OLApps.renderAppsGrid === 'function') OLApps.renderAppsGrid();
        }
        else if (hash.includes("functions")) {
            if (typeof renderFunctionsGrid === 'function') renderFunctionsGrid();
            else if (typeof OLFunctions.renderFunctionsGrid === 'function') OLFunctions.renderFunctionsGrid();
        }
        else if (hash.includes("visualizer")) {
            if (typeof state !== 'undefined') state.viewMode = 'graph';
            document.body.classList.add('is-visualizer');
            if (typeof renderVisualizer === 'function') renderVisualizer();
            else if (typeof ol.renderVisualizer === 'function') ol.renderVisualizer();
        }
        else if (hash.includes("scoping-sheet") || hash.includes("scoping")) {
            if (typeof renderScopingSheet === 'function') renderScopingSheet();
            else if (typeof ol.renderScopingSheet === 'function') ol.renderScopingSheet();
        }
        else if (hash.includes("analyze")) {
            if (typeof renderAnalysisModule === 'function') renderAnalysisModule();
            else if (typeof OLAnalysis.renderAnalysisModule === 'function') OLAnalysis.renderAnalysisModule();
        }
        else if (hash.includes("how-to")) {
            if (typeof renderHowToLibrary === 'function') renderHowToLibrary();
            else if (typeof ol.renderHowToLibrary === 'function') ol.renderHowToLibrary();
        }
        else if (hash.includes("team")) {
            if (typeof renderTeamManager === 'function') renderTeamManager();
            else if (typeof OLTeam.renderTeamManager === 'function') OLTeam.renderTeamManager();
        }
        else if (hash.includes("data")) {
            if (typeof ol.renderGlobalDataManager === 'function') ol.renderGlobalDataManager();
        }
    } else {
        if (typeof renderClientDashboard === 'function') renderClientDashboard();
        else if (typeof OLClientDashboard.renderClientDashboard === 'function') OLClientDashboard.renderClientDashboard();
    }
};

window.addEventListener("hashchange", handleRoute);
