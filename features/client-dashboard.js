//======================= FEATURES / CLIENT DASHBOARD =======================//
// Extracted from app.js "CLIENT DASHBOARD SECTION" +
// "BUILD CLIENT PROFILE SETTINGS / LINK / DELETE PROFILE".
// Owns: the main client/partner registry grid, the "Add Client" flow,
// the client profile modal (modules, partner assignment, share link,
// delete), and the cross-client feature-sync ("Migration") action.

import { state, esc, uid, getActiveClient, persist, updateAndSync, switchClient, loadFullClient } from '../core/data.js';

//======================= CLIENT DASHBOARD SECTION =======================//

// 1. CLIENT DASHBOARD & CORE MODULES
export function renderClientDashboard() {
    const container = document.getElementById("mainContent");
    if (!container) return;
    container.style.cssText = '';
    document.body.classList.remove('is-visualizer');

    const activeView = state.dashboardView || localStorage.getItem('ol_dashboard_view') || 'cards';
    state.dashboardView = activeView;
    
    // 🚀 FILTER LOGIC & PARTNER ISOLATION
    const activeFilter = state.dashboardFilter || 'All';
    let clients = state.clients ? Object.values(state.clients) : [];
    
    // 🛡️ SECURITY & PORTFOLIO GUARD
    const urlParams = new URLSearchParams(window.location.search);
    const accessToken = urlParams.get('access');
    const activeClient = getActiveClient();
    const isPartnerRoute = window.location.hash.includes('partner-dashboard');

    // 🤝 Apply portfolio filtering if on partner-dashboard OR in guest/access mode
    if (isPartnerRoute || window.IS_GUEST || accessToken) {
        if (activeClient) {
            const partnerId = activeClient.meta?.status === "Partner" 
                ? activeClient.id 
                : activeClient.meta?.partnerOwner;

            if (partnerId) {
                clients = clients.filter(c => String(c.id) === String(partnerId) || String(c.meta?.partnerOwner) === String(partnerId));
            } else {
                clients = clients.filter(c => String(c.id) === String(activeClient.id));
            }
        }
    }

    // Apply Status Filter
    if (activeFilter !== 'All') {
        clients = clients.filter(c => c.meta?.status === activeFilter);
    }
    
    // 🛡️ THE LOADING GUARD
    if (!state.clients || Object.keys(state.clients).length === 0) {
        if (!getActiveClient()) {
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

            <div class="header-actions">
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

// 2. CREATE CLIENT INCLUDING PROFILE ID FOR PUBLIC LINK
export function onboardNewClient() {
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

export function provisionSphynxTemplates(clientId) {
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

export function getDynamicPartners() {
    return Object.values(state.clients)
        .filter(c => c.meta.status === "Partner")
        .map(c => ({
            id: c.id,
            name: c.meta.name,
            logo: "🤝"
        }));
};

export function openClientProfileModal(clientId) {
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

           <label class="modal-section-label">Partner / Client Login</label>
           <div class="card-section">
               <p class="tiny muted">Generate a one-time setup link so they can create their own login.</p>
               <input type="email" id="setupEmail-${clientId}" class="modal-input small"
                      placeholder="their@email.com" value="${client.meta.setupEmail || ''}">
               <div style="display:flex; gap:8px; margin-top:8px;">
                   <button class="btn tiny primary" onclick="OL.copySetupLink('${clientId}')">Generate & Copy Setup Link</button>
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

export function toggleClientModule(clientId, moduleId) {
    OL.updateAndSync(() => {
        const client = state.clients[clientId];
        if (!client.modules) client.modules = {};
        client.modules[moduleId] = !client.modules[moduleId];
    });
};

export function copyShareLink(token) {
    const url = `${window.location.origin}${window.location.pathname}?access=${token}#/client-tasks`;
    navigator.clipboard.writeText(url);
    alert("Share link copied to clipboard!");
};

export function setDashboardFilter(filterName) {
    state.dashboardFilter = filterName;
    // We don't necessarily need to persist this to Firebase (local session is fine)
    window.renderClientDashboard();
};

export function updateClientStatus(clientId, newStatus) {
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

export function updateClientNameInline(clientId, newName) {
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

export function deleteClient(clientId) {
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
export function setAllPermissions(clientId, level) {
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

export function pushFeaturesToAllClients() {
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

// ---- bridge: keep OL.*/window.* calls working until callers import directly ----
window.OL = window.OL || {};
Object.assign(window.OL, {
    onboardNewClient, provisionSphynxTemplates, getDynamicPartners,
    openClientProfileModal, toggleClientModule, copyShareLink,
    setDashboardFilter, updateClientStatus, updateClientNameInline,
    deleteClient, setAllPermissions, pushFeaturesToAllClients
});
window.renderClientDashboard = renderClientDashboard;
