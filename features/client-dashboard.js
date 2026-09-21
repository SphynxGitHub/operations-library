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

    // A partner browsing their own portfolio gets a quick "Manage Access"
    // shortcut on each client card, instead of having to switch into that
    // client's whole workspace just to toggle which tabs it can see.
    const isPartnerViewer = getActiveClient()?.meta?.status === 'Partner' && !(window.FORCE_ADMIN === true);

    // Partners can define their own pipeline stages instead of the fixed
    // Sphynx status list — stored on the partner's own client record so
    // it's scoped to that partner only. Falls back to the standard list.
    const DEFAULT_PIPELINE_STATUSES = ['Discovery', 'White Glove', 'Coaching', 'Ongoing Maintenance', 'Ad Hoc Maintenance', 'Former Client', 'Former Prospect', 'Partner'];
    const partnerRecord = isPartnerViewer ? getActiveClient() : null;
    const pipelineStatuses = (partnerRecord?.meta?.pipelineStatuses?.length ? partnerRecord.meta.pipelineStatuses : DEFAULT_PIPELINE_STATUSES);
    
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
                // Only clients actually managed by this partner — never the
                // partner's own account record itself.
                clients = clients.filter(c => String(c.meta?.partnerOwner) === String(partnerId));
            } else {
                clients = clients.filter(c => String(c.id) === String(activeClient.id));
            }
        }
    }

    // Apply Status Filter
    if (activeFilter !== 'All') {
        clients = clients.filter(c => c.meta?.status === activeFilter);
    }

    // Apply the search bar as an actual filter on the visible grid, not
    // just the jump-to overlay below it — previously typing here only
    // populated a small floating dropdown of clickable matches and left
    // the card/list grid untouched, which reads as "search doesn't do
    // anything" if you're expecting the list itself to narrow down.
    const dashboardSearch = (state.dashboardSearch || '').toLowerCase().trim();
    if (dashboardSearch) {
        clients = clients.filter(c => (c.meta?.name || '').toLowerCase().includes(dashboardSearch));
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

            <div class="header-actions">
                <button class="btn primary" onclick="OL.onboardNewClient()">+ Add Client</button>
                ${!isPartnerViewer ? `<button class="btn small warn" onclick="OL.pushFeaturesToAllClients()" title="Sync System Changes">⚙️ Migration</button>` : ''}
                ${isPartnerViewer ? `<button class="btn small soft" onclick="OL.editPipelineStatuses()" title="Customize your pipeline stages">Edit Statuses</button>` : ''}
                ${isPartnerViewer ? `<button class="btn small soft" onclick="OL.openOnboardingWizard()" title="Guided setup" style="display:flex;align-items:center;gap:6px;">
                    <i data-lucide="rocket" style="width:14px;height:14px;"></i> Get Started
                </button>` : ''}
                <button class="btn small soft" onclick="state.dashboardView = state.dashboardView === 'list' ? 'cards' : 'list'; 
                         localStorage.setItem('ol_dashboard_view', state.dashboardView); 
                         renderClientDashboard();"
                        style="display:flex;align-items:center;gap:6px;">
                    <i data-lucide="${activeView === 'list' ? 'layout-grid' : 'list'}" style="width:14px;height:14px;"></i>
                    ${activeView === 'list' ? 'Card View' : 'List View'}
                </button>
            </div>
        </div>

        <div class="search-map-container search-map-container--full">
            <input type="text" id="global-command-search" class="modal-input" 
                   placeholder="Search clients or apps..." 
                   value="${esc(state.dashboardSearch || '')}"
                   oninput="const v=this.value; OL.reRenderPreservingFocus(() => { state.dashboardSearch = v; renderClientDashboard(); }); OL.handleGlobalSearch(v);">
            <div id="global-search-results" class="search-results-overlay"></div>
        </div>

        <div class="filter-bar">
            ${['All', ...pipelineStatuses].map(f => `
                <span class="pill tiny ${activeFilter === f ? 'accent' : 'soft'}" 
                      style="border: 1px solid ${activeFilter === f ? 'var(--accent)' : 'transparent'}; padding: 4px 12px; border-radius: 20px;"
                      onclick="OL.setDashboardFilter('${f}')">
                    ${f}
                </span>
            `).join('')}
        </div>

        ${activeView === 'list' ? `
        <div style="display:flex;flex-direction:column;gap:2px;margin-top:10px;">
    
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
                            <select class="status-pill-dropdown"
                                    onclick="event.stopPropagation()"
                                    onchange="event.stopPropagation(); OL.updateClientStatus('${client.id}', this.value)"
                                    style="background: var(--bg-card); color: var(--text-muted); border: 1px solid rgba(255,255,255,0.1); border-radius: 4px; font-size: 10px; cursor: pointer; outline: none;">
                                ${pipelineStatuses.map(status => `
                                    <option value="${status}" ${client.meta.status === status ? 'selected' : ''}>${status}</option>
                                `).join('')}
                            </select>
                            ${isPartnerViewer ? `
                                <button class="btn tiny soft" onclick="event.stopPropagation(); OL.openPartnerClientModulesModal('${client.id}')" title="Manage Access">
                                    <i data-lucide="sliders-horizontal" style="width:11px;height:11px;"></i>
                                </button>
                            ` : `
                                <button class="btn tiny soft" onclick="event.stopPropagation(); OL.openClientProfileModal('${client.id}')" title="Settings">
                                    <i data-lucide="settings" style="width:11px;height:11px;"></i>
                                </button>
                            `}
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
                                                      setTimeout(()=>OL.openTaskInContext('${client.id}', '${task.id}'), 200);"
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
                            ${pipelineStatuses.map(status => `
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
                                    onclick="event.stopPropagation(); ${isPartnerViewer ? `OL.openPartnerClientModulesModal('${client.id}')` : `OL.openClientProfileModal('${client.id}')`}"
                                    title="${isPartnerViewer ? 'Manage Access' : 'Settings'}">
                                <i data-lucide="${isPartnerViewer ? 'sliders-horizontal' : 'settings'}" style="width:12px;height:12px;"></i>
                            </button>
                        </div>
                    </div>
                </div>`;
            }).join('')}
        </div>
        `}
    `;

    // 🚀 Re-render Lucide icons for whatever we just injected. The outer
    // shell (buildLayout) only re-runs this on a full route/theme change,
    // so icons added by this function alone (view toggle, list-view
    // access/settings buttons) were staying blank until the next full
    // render — e.g. switching themes, which happens to trigger buildLayout.
    if (window.lucide) window.lucide.createIcons();

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
async function onboardNewClient(clientData) {
    try {
        // 1. Insert new client into Supabase workspace_clients
        const { data: newClient, error } = await db
            .from('workspace_clients')
            .insert([{
                name: clientData.name,
                meta: { name: clientData.name, email: clientData.email },
                status: 'active'
            }])
            .select()
            .single();

        if (error) throw error;

        // 2. Automatically trigger Drive folder creation
        if (newClient?.id && typeof OL.resolveClientDriveFolder === 'function') {
            console.log(`📁 Auto-creating Drive folders for ${clientData.name}...`);
            await OL.resolveClientDriveFolder(newClient.id);
        }

        // 3. Update local state and UI
        state.clients[newClient.id] = newClient;
        OL.persist();
        
        alert(`Client "${clientData.name}" onboarded and Google Drive folders created!`);
        return newClient;

    } catch (err) {
        console.error('Error during client onboarding:', err);
        alert(`Onboarding failed: ${err.message}`);
    }
}

export async function onboardNewClient() {
  const name = prompt("Enter Client Name:");
  if (!name) return;
  
  const clientId = "c-" + Date.now();
  const newClientObj = {
    id: clientId,
    publicToken: "access_" + Math.random().toString(36).slice(2, 12),
    googleDriveFolderId: null,
    driveSubfolders: {},
    meta: {
      name,
      onboarded: new Date().toLocaleDateString(),
      status: "Discovery",
    },
    modules: {
      checklist: true,
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

  // 1. Assign to local state & provision templates
  state.clients[clientId] = newClientObj;
  OL.provisionSphynxTemplates(clientId);
  state.activeClientId = clientId;

  // 2. Persist initial state to Supabase
  await OL.persist();

  // 3. Auto-create Google Drive folder & subfolders
  let driveFolderId = null;
  if (typeof OL.resolveClientDriveFolder === "function") {
    try {
      console.log(`📁 Creating Google Drive workspace for ${name}...`);
      const driveResult = await OL.resolveClientDriveFolder(clientId);
      if (driveResult?.folderId) {
        driveFolderId = driveResult.folderId;
        state.clients[clientId].googleDriveFolderId = driveResult.folderId;
        state.clients[clientId].driveSubfolders = driveResult.subfolders;
        await OL.persist();
      }
    } catch (err) {
      console.warn("Automated Drive creation skipped or failed:", err);
    }
  }

  // 4. Create App Notification for Sphynx Team Members
  const notificationId = "notif-" + Date.now();
  const driveUrl = driveFolderId 
    ? `https://drive.google.com/drive/folders/${driveFolderId}`
    : null;

  const teamNotification = {
    id: notificationId,
    type: "client_onboarded",
    title: "🚀 New Client Onboarded",
    message: `${name} has been onboarded to Operations Library.`,
    clientId: clientId,
    clientName: name,
    driveUrl: driveUrl,
    createdByName: state.currentUser?.name || "Team Member",
    createdAt: new Date().toISOString(),
    readBy: [state.currentUser?.id].filter(Boolean), // Marked read for creator
  };

  // Ensure notifications array exists in global state
  state.notifications = state.notifications || [];
  state.notifications.unshift(teamNotification);

  // Re-persist updated state with new notification
  await OL.persist();

  // Trigger UI toast or notification badge render if helper exists
  if (typeof OL.renderNotifications === "function") {
    OL.renderNotifications();
  }
  if (typeof OL.showToast === "function") {
    OL.showToast(`Notification sent to Sphynx Team for ${name}`);
  }

  // 5. Navigate to client tasks
  location.hash = "#/client-tasks";
}

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

OL.resolveClientDriveFolder = async function(clientId) {
    const client = state.clients?.[clientId];
    if (!client) return;

    const clientName = client.meta?.name || 'Unnamed Client';

    try {
        const { data, error } = await db.functions.invoke('google-drive-sync', {
            body: { action: 'get_or_create_client_folder', clientName, clientId }
        });

        if (error) {
            console.error('Drive Sync Edge Function Error:', error);

            // Extract the JSON payload returned from the Edge Function
            let errorDetails = error.message || 'Unknown Edge Function Error';
            try {
                const responseBody = await error.context.json();
                errorDetails = responseBody.message || responseBody.error || JSON.stringify(responseBody);
            } catch (e) {
                // Response context couldn't be parsed as JSON
            }

            alert(`Drive Sync Error (${error.name}):\n${errorDetails}`);
            return;
        }

        if (data?.folderId) {
            client.googleDriveFolderId = data.folderId;
            client.driveSubfolders = data.subfolders;

            // Save folder ID to workspace_clients
            await db.from('workspace_clients')
                .update({ google_drive_folder_id: data.folderId })
                .eq('id', clientId);

            OL.persist();
            
            // Re-render modal if open
            if (typeof OL.openClientProfileModal === 'function') {
                OL.openClientProfileModal(clientId);
            }
            return data;
        }
    } catch (err) {
        console.error('Network / Execution Error during Drive lookup:', err);
        alert('Failed to connect to Google Drive sync service.');
    }
};

window.OL = window.OL || {};
window.OL.resolveClientDriveFolder = OL.resolveClientDriveFolder;

// Define and attach directly to the OL namespace
OL.renderClientDriveCard = function(clientId) {
    const client = state.clients?.[clientId];
    if (!client) return '';

    const folderId = client.googleDriveFolderId || client.meta?.googleDriveFolderId;

    return `
        <div class="card-section" style="margin-top: 12px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <i data-lucide="folder-git-2" style="width: 16px; height: 16px; color: var(--accent);"></i>
                    <div>
                        <strong style="font-size: 12px; display: block;">Google Drive Folder</strong>
                        <span class="tiny muted">Sync recordings, task attachments, and snapshots</span>
                    </div>
                </div>
                <div>
                    ${folderId ? `
                        <a href="https://drive.google.com/drive/folders/${folderId}" target="_blank" class="btn tiny soft" style="display: inline-flex; align-items: center; gap: 4px; text-decoration: none;">
                            <i data-lucide="external-link" style="width: 11px; height: 11px;"></i> Open Drive
                        </a>
                    ` : `
                        <button class="btn tiny primary" onclick="OL.resolveClientDriveFolder('${clientId}').then(() => OL.openClientProfileModal('${clientId}'))">
                            <i data-lucide="folder-plus" style="width: 11px; height: 11px;"></i> Link Drive Folder
                        </button>
                    `}
                </div>
            </div>

            ${folderId ? `
                <div class="tiny muted monospace" style="margin-top: 8px; background: rgba(0,0,0,0.15); padding: 4px 6px; border-radius: 4px; word-break: break-all;">
                    Folder ID: ${esc(folderId)}
                </div>
            ` : ''}
        </div>
    `;
};

// Expose explicitly to window to prevent ReferenceErrors in template string evaluation
window.renderClientDriveCard = OL.renderClientDriveCard;
window.OL.renderClientDriveCard = OL.renderClientDriveCard;

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
                            ${p.logo}${esc(p.name)}
                        </option>
                    `).join('')}
                </select>
                <p class="tiny muted" style="margin-top: 8px;">
                    ${currentPartnerId ? `This project is managed under the <b>${state.clients[currentPartnerId]?.meta.name}</b> portfolio.` : 'This is a standalone project.'}
                </p>
            </div>
        </div>
    `;

    const folderId = client.googleDriveFolderId || client.meta?.googleDriveFolderId;

    const html = `
        <div class="modal-head" style="display:flex; align-items:center; gap:8px;">
            <span class="modal-title-text" style="white-space:nowrap;">Client Profile:</span>
            <input type="text" 
                   class="modal-input tiny bold" 
                   style="font-size:16px; font-weight:bold; flex:1; min-width:180px;" 
                   value="${esc(client.meta.name || '')}" 
                   onchange="OL.updateClientNameInline('${client.id}', this.value)"
                   placeholder="Project Name">
            <div class="spacer"></div>
            <button class="btn small soft" onclick="OL.closeModal()">Close</button>
        </div>
        <div class="modal-body" style="max-width:820px;">
            ${partnerDropdownHtml}
            <label class="modal-section-label">Active Modules (Client Access)</label>
            <div id="module-selection" class="card-section" style="display:grid; grid-template-columns:repeat(3, 1fr); gap:8px 16px;">
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
                    { id: 'data', label: 'Data' },
                    { id: 'errors', label: 'Error Tracking' }
                ].map(m => `
                    <label style="display:flex; align-items:center; gap:8px; font-size:11px; cursor:pointer;">
                        <input type="checkbox" 
                            ${client.modules?.[m.id] ? 'checked' : ''} 
                            onchange="OL.toggleClientModule('${clientId}', '${m.id}')">
                        ${m.label}
                    </label>
                `).join('')}
            </div>
            
            ${client.meta.status === 'Partner' ? `
            <label class="modal-section-label">Business Manager Access (Partner)</label>
            <div id="business-module-selection" class="card-section" style="display:grid; grid-template-columns:repeat(3, 1fr); gap:8px 16px;">
                <p class="tiny muted" style="margin:0 0 4px; grid-column:1/-1;">Controls which of THIS partner's own Business Manager tabs they can see. Data shown is automatically limited to clients assigned to them above.</p>
                ${[
                    { id: 'tasks', label: 'Task Manager' },
                    { id: 'financials', label: 'Financials' },
                    { id: 'communications', label: 'Communications' },
                    { id: 'time-reports', label: 'Time Reports' },
                    { id: 'calendar', label: 'Calendar' }
                ].map(m => `
                    <label style="display:flex; align-items:center; gap:8px; font-size:11px; cursor:pointer;">
                        <input type="checkbox" 
                            ${client.businessModules?.[m.id] ? 'checked' : ''} 
                            onchange="OL.toggleClientBusinessModule('${clientId}', '${m.id}')">
                        ${m.label}
                    </label>
                `).join('')}
            </div>
            ` : ''}

            <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; align-items:start;">
                <div>
                    <label class="modal-section-label">Project Metadata</label>
                    <div class="card-section">
                        <div class="small" style="display:flex; align-items:center; gap:8px;">
                            Status:
                            <select class="modal-input tiny" style="width:auto; flex:1;" onchange="OL.updateClientStatus('${clientId}', this.value)">
                                ${['Discovery', 'White Glove', 'Coaching', 'Ongoing Maintenance', 'Ad Hoc Maintenance', 'Former Client', 'Former Prospect', 'Partner'].map(s => `
                                    <option value="${s}" ${client.meta.status === s ? 'selected' : ''}>${s}</option>
                                `).join('')}
                            </select>
                        </div>
                        <div class="small" style="margin-top:6px;">Onboarded: ${client.meta.onboarded}</div>
                    </div>
                </div>

                <div>
                    <label class="modal-section-label">Role Assignments &amp; Comp</label>
                    <div class="card-section">
                        <p class="tiny muted" style="margin:0;">
                            Who covers each role on this project, and their cut of the fee. Overridable per resource from that resource's card.
                        </p>
                        <button class="btn tiny soft full-width" style="margin-top:8px;" onclick="OL.closeModal(); OL.openProjectRoleAssignmentsModal('${clientId}')">
                            <i data-lucide="percent" style="width:12px;height:12px;"></i> Open Role Assignments & Comp
                        </button>
                    </div>
                </div>
            </div>

            <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; align-items:start;">
                <div>
                    <label class="modal-section-label">Partner / Client Login</label>
                    <div class="card-section">
                        <p class="tiny muted" style="margin:0;">Generate a one-time setup link so they can create their own login.</p>
                        <input type="email" id="setupEmail-${clientId}" class="modal-input small" style="margin-top:8px;"
                               placeholder="their@email.com" value="${client.meta.setupEmail || ''}">
                        <button class="btn tiny primary" style="margin-top:8px; width:100%;" onclick="OL.copySetupLink('${clientId}')">Generate & Copy Setup Link</button>
                    </div>
                </div>

                <!-- GOOGLE DRIVE WORKSPACE FOLDER INTEGRATION -->
                <div>
                    <label class="modal-section-label">Google Drive Folder</label>
                    <div class="card-section">
                        <p class="tiny muted" style="margin:0 0 8px 0;">Root folder for Zoom recordings, task attachments, and app snapshots.</p>
                        ${folderId ? `
                            <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
                                <input type="text" class="modal-input small monospace" value="${esc(folderId)}" readonly style="flex:1;">
                                <a href="https://drive.google.com/drive/folders/${esc(folderId)}" target="_blank" class="btn tiny soft" style="display:inline-flex; align-items:center; gap:4px; text-decoration:none;">
                                    <i data-lucide="external-link" style="width:12px;height:12px;"></i> Drive
                                </a>
                            </div>
                        ` : `
                            <button class="btn tiny primary" style="width:100%; display:inline-flex; align-items:center; justify-content:center; gap:6px;" onclick="OL.resolveClientDriveFolder('${clientId}').then(() => OL.openClientProfileModal('${clientId}'))">
                                <i data-lucide="folder-plus" style="width:12px;height:12px;"></i> Find / Create Drive Folder
                            </button>
                        `}
                    </div>
                </div>
            </div>

            <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; align-items:start;">
                <div>
                    <label class="modal-section-label">Gmail Auto-Labeling</label>
                    <div class="card-section">
                        <label style="display:flex; align-items:center; gap:8px; font-size:11px; cursor:pointer;">
                            <input type="checkbox" ${client.meta.gmailLabelEnabled ? 'checked' : ''} onchange="OL.toggleGmailLabelForClient('${clientId}', this.checked)">
                            Auto-label incoming emails for this project
                        </label>
                        <p class="tiny muted" style="margin:4px 0 8px 0;">
                            Matches each synced email's sender/recipients against this project's Team tab addresses.
                        </p>
                        <input type="text" id="gmail-label-input-${clientId}" class="modal-input small"
                               placeholder="Label name"
                               value="${esc(client.meta.gmailLabel || client.meta.name || '')}"
                               ${client.meta.gmailLabelEnabled ? '' : 'disabled'}
                               onchange="OL.updateGmailLabelName('${clientId}', this.value)">
                    </div>
                </div>

                <div>
                    <label class="modal-section-label">Error Tracking</label>
                    <div class="card-section">
                        <p class="tiny muted" style="margin:0 0 6px 0;">
                            Send this project's ID as <code>client_id</code> in the Zap payload for direct matching.
                        </p>
                        <div style="display:flex; gap:8px; margin-bottom:8px;">
                            <input type="text" class="modal-input small monospace" value="${esc(clientId)}" readonly style="flex:1;">
                            <button class="btn tiny soft" onclick="navigator.clipboard.writeText('${esc(clientId)}'); alert('Project ID copied!');">Copy</button>
                        </div>
                        <input type="text" class="modal-input small"
                               placeholder="Tracking Sheet ID (optional, legacy)"
                               value="${esc(client.meta.errorSheetId || '')}"
                               onchange="OL.updateErrorSheetId('${clientId}', this.value)">
                    </div>
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
    if (window.lucide) lucide.createIcons();
};

// Partner-facing version of the Client Profile modal for one of THEIR OWN
// managed clients (client.meta.partnerOwner === them) — module access
// checklist + login setup, same as the admin modal, minus the admin-only
// sections (partner re-assignment, Sphynx business config, error tracking
// IDs). Delete only shows for clients the partner created themselves
// (meta.createdByPartner) — not ones an admin assigned to their portfolio.
export function openPartnerClientModulesModal(clientId) {
    const client = state.clients[clientId];
    if (!client) return;

    const viewer = getActiveClient();
    const canDelete = !!client.meta.createdByPartner &&
        String(client.meta.partnerOwner) === String(viewer?.id);

    const html = `
        <div class="modal-head">
            <div class="modal-title-text">Client Access: ${esc(client.meta.name)}</div>
            <div class="spacer"></div>
            <button class="btn small soft" onclick="OL.closeModal()">Close</button>
        </div>
        <div class="modal-body">
            <p class="tiny muted" style="margin-bottom:10px;">Choose which tabs ${esc(client.meta.name)} can see in their project workspace.</p>
            <label class="modal-section-label">Active Modules (Client Access)</label>
            <div class="card-section">
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

            <label class="modal-section-label">Login Setup</label>
            <div class="card-section">
                <p class="tiny muted">Generate a one-time setup link so ${esc(client.meta.name)} can create their own login.</p>
                <input type="email" id="setupEmail-${clientId}" class="modal-input small"
                       placeholder="their@email.com" value="${client.meta.setupEmail || ''}">
                <div style="display:flex; gap:8px; margin-top:8px;">
                    <button class="btn tiny primary" onclick="OL.copySetupLink('${clientId}')">Generate & Copy Setup Link</button>
                </div>
            </div>

            ${canDelete ? `
            <label class="modal-section-label">Danger Zone</label>
            <div class="card-section">
                <p class="tiny muted" style="margin-bottom: 12px; padding-left: 8px;">Permanently delete this client and all associated project data. This cannot be undone.</p>
                <button class="btn small" 
                        style="background: #ef4444; color: white; width: 100%;" 
                        onclick="OL.deleteClient('${clientId}')">
                    Delete Project
                </button>
            </div>
            ` : ''}
        </div>
    `;
    openModal(html);
};

// ================= PARTNER TEMPLATE LIBRARY: PUSH TO A MANAGED CLIENT =================
// Lets a Partner push one of their own local resources/analyses/how-to
// guides down into one of the clients they manage. Complements the
// existing admin-only "Promote to Master" actions already on each of
// those items (that stays as-is — this is the other direction).

const SOP_ITEM_TYPE_CONFIG = {
    resource: { arrayKey: 'localResources', label: 'Resource' },
    analysis: { arrayKey: 'localAnalyses', label: 'Analysis' },
    howto: { arrayKey: 'localHowTo', label: 'How-To Guide' }
};

export function openPushLocalItemToClientModal(itemType, itemId) {
    const config = SOP_ITEM_TYPE_CONFIG[itemType];
    if (!config) return;

    const sourceClient = getActiveClient();
    const item = sourceClient?.projectData?.[config.arrayKey]?.find(x => x.id === itemId);
    if (!item) { alert(`Couldn't find that ${config.label.toLowerCase()}.`); return; }

    // Only the partner's own managed clients are valid push targets.
    const managedClients = Object.values(state.clients || {})
        .filter(c => String(c.meta?.partnerOwner) === String(sourceClient.id))
        .sort((a, b) => (a.meta?.name || '').localeCompare(b.meta?.name || ''));

    const html = `
        <div class="modal-head">
            <div class="modal-title-text">Push "${esc(item.name || item.title)}" to a Client</div>
            <div class="spacer"></div>
            <button class="btn small soft" onclick="OL.closeModal()">Close</button>
        </div>
        <div class="modal-body">
            ${managedClients.length === 0 ? `
                <p class="tiny muted">You don't have any clients assigned to you yet.</p>
            ` : `
                <label class="modal-section-label">Client</label>
                <select id="push-item-client" class="modal-input">
                    <option value="">Select a client...</option>
                    ${managedClients.map(c => `<option value="${c.id}">${esc(c.meta?.name || c.id)}</option>`).join('')}
                </select>
                <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:20px;">
                    <button class="btn soft" onclick="OL.closeModal()">Cancel</button>
                    <button class="btn primary" onclick="OL.pushLocalItemToClient('${itemType}', '${itemId}', document.getElementById('push-item-client').value)">Push</button>
                </div>
            `}
        </div>
    `;
    openModal(html);
};

export function pushLocalItemToClient(itemType, itemId, targetClientId) {
    const config = SOP_ITEM_TYPE_CONFIG[itemType];
    if (!config) return;
    if (!targetClientId) { alert('Pick a client first.'); return; }

    const sourceClient = getActiveClient();
    const item = sourceClient?.projectData?.[config.arrayKey]?.find(x => x.id === itemId);
    if (!item) return;

    updateAndSync(() => {
        const targetClient = state.clients[targetClientId];
        if (!targetClient) return;
        if (!targetClient.projectData) targetClient.projectData = {};
        if (!targetClient.projectData[config.arrayKey]) targetClient.projectData[config.arrayKey] = [];

        const copy = JSON.parse(JSON.stringify(item));
        copy.id = uid();
        copy.pushedFrom = { partnerId: sourceClient.id, originalId: item.id };
        copy.createdAt = new Date().toISOString();

        targetClient.projectData[config.arrayKey].push(copy);
    }, targetClientId);

    OL.closeModal();
    alert(`"${item.name || item.title}" pushed to ${state.clients[targetClientId]?.meta?.name || targetClientId}.`);
};

export function toggleClientModule(clientId, moduleId) {
    OL.updateAndSync(() => {
        const client = state.clients[clientId];
        if (!client.modules) client.modules = {};
        client.modules[moduleId] = !client.modules[moduleId];
    }, clientId);
};

export function toggleClientBusinessModule(clientId, moduleId) {
    OL.updateAndSync(() => {
        const client = state.clients[clientId];
        if (!client.businessModules) client.businessModules = {};
        client.businessModules[moduleId] = !client.businessModules[moduleId];
    }, clientId);
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
    OL.markClientDirty(clientId);
    OL.persist().then(() => {
        window.handleRoute();
    });
    
    console.log(`📡 Status updated for ${client.meta.name}: ${newStatus}`);
    
    // The sync engine will automatically refresh the UI across all tabs
};

// Lets a partner define their own pipeline stage list for their portfolio
// view, instead of the fixed Sphynx status set. Stored on the partner's
// own client record (meta.pipelineStatuses) so it only affects them.
export function editPipelineStatuses() {
    const partner = getActiveClient();
    if (!partner || partner.meta?.status !== 'Partner') return;

    const current = (partner.meta.pipelineStatuses && partner.meta.pipelineStatuses.length)
        ? partner.meta.pipelineStatuses
        : ['Discovery', 'White Glove', 'Coaching', 'Ongoing Maintenance', 'Ad Hoc Maintenance', 'Former Client', 'Former Prospect', 'Partner'];

    const input = prompt("Edit your pipeline stages (comma-separated):", current.join(', '));
    if (input === null) return;

    const parsed = input.split(',').map(s => s.trim()).filter(Boolean);
    if (!parsed.length) return;

    partner.meta.pipelineStatuses = parsed;
    OL.markClientDirty(partner.id);
    OL.persist().then(() => {
        renderClientDashboard();
    });
};

export function updateClientNameInline(clientId, newName) {
    const client = state.clients[clientId];
    if (!client) return;
    
    const cleanName = newName.trim();
    if (!cleanName || cleanName === client.meta.name) return;

    // Update the local state
    client.meta.name = cleanName;

    // Persist to Firebase
    OL.markClientDirty(clientId);
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

    OL.markClientDirty(clientId);
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

// ---- appended: partner dashboard + creation (was living in the old
// "PARTNER ACCESS" block in app.js, mixed in with the dead link-based
// access functions we dropped — these three are still live and used) ----

export function renderPartnerDashboard(leadProject, container) {
    if (!container || !leadProject) return;
    container.style.cssText = '';
    document.body.classList.remove('is-visualizer');

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
}

export function partnerCreateClient(partnerKey) {
    const name = prompt("Enter Client Name (Family or Business):");
    if (!name) return;

    const clientId = 'c-' + Math.random().toString(36).slice(2, 9);

    const newClient = {
        id: clientId,
        meta: {
            name: name,
            status: "Discovery",
            partnerOwner: partnerKey,
            createdDate: new Date().toISOString(),
            // Distinguishes clients the partner made themselves (delete-able
            // by them) from clients assigned to their portfolio by an admin.
            createdByPartner: true
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

    OL.provisionSphynxTemplates(clientId);

    persist().then(() => {
        renderPartnerDashboard();
    });
}

export function handlePartnerAssignment(clientId, partnerKey) {
    const client = state.clients[clientId];
    if (!client) {
        console.error("❌ Assignment Failed: Client ID not found.");
        return;
    }

    client.meta.partnerOwner = partnerKey;

    if (!client.meta.activityLog) client.meta.activityLog = [];
    client.meta.activityLog.push({
        action: partnerKey ? `Assigned to Partner: ${partnerKey}` : "Set to Internal Project",
        timestamp: new Date().toISOString()
    });

    console.log(`🎯 Client "${client.meta.name}" ownership updated to: ${partnerKey || 'None'}`);

    OL.markClientDirty(clientId);
    persist().then(() => {
        if (typeof OL.openClientProfileModal === 'function') {
            OL.openClientProfileModal(clientId);
        } else {
            window.handleRoute();
        }
    });
}

// ---- Gmail auto-labeling config (per client) ----
export function toggleGmailLabelForClient(clientId, enabled) {
    updateAndSync(() => {
        const client = state.clients[clientId];
        if (!client) return;
        if (!client.meta.gmailLabel) client.meta.gmailLabel = client.meta.name;
        client.meta.gmailLabelEnabled = enabled;
    }, clientId);
    openClientProfileModal(clientId); // re-render so the label input enables/disables
}

export function updateGmailLabelName(clientId, value) {
    updateAndSync(() => {
        const client = state.clients[clientId];
        if (!client) return;
        client.meta.gmailLabel = value.trim() || client.meta.name;
    }, clientId);
}

export function updateErrorSheetId(clientId, value) {
    updateAndSync(() => {
        const client = state.clients[clientId];
        if (!client) return;
        client.meta.errorSheetId = value.trim() || null;
    }, clientId);
}

// ---- bridge: keep OL.*/window.* calls working until callers import directly ----
window.OL = window.OL || {};
Object.assign(window.OL, {
    renderPartnerDashboard, partnerCreateClient, handlePartnerAssignment,
    onboardNewClient, provisionSphynxTemplates, getDynamicPartners,
    openClientProfileModal, toggleClientModule, toggleClientBusinessModule, copyShareLink,
    openPartnerClientModulesModal, openPushLocalItemToClientModal, pushLocalItemToClient,
    setDashboardFilter, updateClientStatus, updateClientNameInline,
    deleteClient, setAllPermissions, pushFeaturesToAllClients,
    toggleGmailLabelForClient, updateGmailLabelName, updateErrorSheetId,
    editPipelineStatuses
});
window.renderClientDashboard = renderClientDashboard;
window.OL.resolveClientDriveFolder = OL.resolveClientDriveFolder;
window.OL.renderClientDriveCard = renderClientDriveCard;
