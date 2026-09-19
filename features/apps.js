//======================= FEATURES / APPS =======================//
// Extracted from app.js "APPS GRID SECTION" + "APP CAPABILITIES SECTION
// (TRIGGERS / ACTIONS)" + "APPS and FUNCTIONS CROSS-REFERENCE".
// Owns: the apps grid (master vault + per-client), the app detail modal,
// capability/trigger-action management on apps, master/local app
// push-pull sync, and the app<->function mapping UI.

import { state, esc, val, getActiveClient, persist, updateAndSync } from '../core/data.js';

//======================= APPS GRID SECTION =======================//

// 1. RENDER APPS GRID
export function renderAppsGrid() {
    OL.registerView(renderAppsGrid);
    const container = document.getElementById("mainContent");
    const client = getActiveClient(); 
    const hash = window.location.hash;
    const isVaultMode = hash.startsWith('#/vault');

    if (!container) return;
    container.style.cssText = '';
    document.body.classList.remove('is-visualizer');

    const masterApps = state.master.apps || [];
    const localApps = client ? (client.projectData.localApps || []) : [];

    let displayApps = isVaultMode ? masterApps : (client?.projectData?.localApps || []);

    displayApps = displayApps.filter(app => {
        if (isVaultMode) return true; 
        const name = (app.name || "").trim();
        const isZapUtility = name.startsWith("Zapier ") || 
                             ["Webhook", "SubZap", "Zapier Robot"].some(u => name.includes(u));
        if (name === "Zapier") return true;
        return !isZapUtility;
    });
    
    displayApps.sort((a, b) => a.name.localeCompare(b.name));

    container.innerHTML = `
      <div class="section-header" style="display:flex; align-items:center; gap:12px;">
          <i data-lucide="layout-grid" style="width:28px; height:24px; color:var(--accent);"></i>
          <div style="flex:1;">
              <h2 style="margin:0;">${isVaultMode ? 'Master App Vault' : 'Project Applications'}</h2>
              <div class="small muted subheader">${isVaultMode ? 'Global Standard Library' : `Software stack for ${esc(client.meta.name)}`}</div>
          </div>
          <div class="header-actions">
              ${isVaultMode ? `
                  <button class="btn primary" onclick="OL.createMasterAppFromGrid()">
                    <i data-lucide="plus" style="width:14px; height:14px; margin-right:6px;"></i> Create Master App
                  </button>
              ` : `
                  <button class="btn small soft" onclick="OL.promptAddApp('${client.id}')">
                    <i data-lucide="plus" style="width:14px; height:14px; margin-right:6px;"></i> Local App
                  </button>
                  <button class="btn primary" onclick="OL.openVaultDeploymentModal('${client.id}')">
                    <i data-lucide="download-cloud" style="width:14px; height:14px; margin-right:6px;"></i> Import from Master
                  </button>
              `}
              ${OL.viewToggleBtn('apps', 'renderAppsGrid')}
          </div>
      </div>
      ${renderStatusLegendHTML()}

        ${OL.getViewMode('apps') === 'list' ? `
            <div style="display:flex;flex-direction:column;gap:2px;margin-top:10px;">
                ${displayApps.map(app => `
                    <div style="display:flex;align-items:center;gap:12px;padding:10px 16px;
                                background:var(--panel-soft);border:1px solid var(--panel-border);
                                border-radius:8px;cursor:pointer;transition:border-color 0.2s;"
                         onclick="OL.openAppModal('${app.id}')"
                         onmouseover="this.style.borderColor='var(--accent)'"
                         onmouseout="this.style.borderColor='var(--panel-border)'">
                        <i data-lucide="smartphone" style="width:14px;height:14px;color:var(--accent);flex-shrink:0;"></i>
                        <span style="font-weight:600;font-size:13px;flex:1;">${esc(app.name)}</span>
                        <span class="vault-tag" style="font-size:8px;">${app.masterRefId ? 'MASTER' : 'LOCAL'}</span>
                        <div class="pills-row" style="margin:0;gap:4px;">
                            ${(app.functionIds||[]).slice(0,3).map(m => {
                                const fn = [...(state.master.functions||[]),...(client?.projectData?.localFunctions||[])].find(f=>f.id===(m.id||m));
                                return fn ? `<span class="pill tiny status-${m.status||'available'}">${esc(fn.name)}</span>` : '';
                            }).join('')}
                        </div>
                        <button class="card-delete-btn" style="position:static;" onclick="OL.universalDelete('${app.id}','apps',event)">
                            <i data-lucide="x" style="width:12px;height:12px;"></i>
                        </button>
                    </div>
                `).join('')}
            </div>
        ` : `
      <div class="cards-grid">
          ${displayApps.length > 0 ? displayApps.map(app => {
              const isMasterRef = !!app.masterRefId || String(app.id).startsWith('master-');
              const tagLabel = isMasterRef ? 'MASTER' : 'LOCAL';
              const tagColor = isMasterRef ? 'var(--accent)' : 'var(--panel-border)';
              
              let mappings = (app.functionIds || []).map(m => 
                  typeof m === 'string' ? { id: m, status: 'available' } : m
              );
              
              const rank = { 'primary': 2, 'evaluating': 1, 'available': 0 };
              mappings.sort((a, b) => (rank[b.status] || 0) - (rank[a.status] || 0));
                
              return `
                  <div class="card is-clickable" onclick="OL.openAppModal('${app.id}')">
                      <div class="card-header">
                          <div style="display:flex; align-items:center; gap:10px;">
                             <i data-lucide="smartphone" style="width:16px; height:16px; color:var(--accent);"></i>
                             <div class="card-title">${esc(app.name)}</div>
                          </div>
                          <div style="display:flex; align-items:center; gap:8px;">
                              <span class="vault-tag" style="background: ${tagColor}; border: 1px solid ${isMasterRef ? 'transparent' : 'var(--line)'}; font-size:8px;">
                                ${tagLabel}
                              </span>    
                              <button class="card-delete-btn" onclick="OL.universalDelete('${app.id}', 'apps', event)">
                                <i data-lucide="x" style="width:12px; height:12px;"></i>
                              </button>
                          </div>
                      </div>
                      <div class="card-body">
                            ${app.name === "Zapier" ? `
                                <div class="zap-utilities-summary" style="margin-bottom: 12px; padding: 8px; background: rgba(var(--accent-rgb), 0.05); border-radius: 4px; border: 1px solid rgba(var(--accent-rgb), 0.2);">
                                    <div class="tiny accent bold uppercase" style="font-size: 8px; letter-spacing: 0.5px; margin-bottom: 5px; display:flex; align-items:center; gap:4px;">
                                        <i data-lucide="cpu" style="width:10px; height:10px;"></i>
                                        ${isVaultMode ? 'Master Utility Templates' : 'Included Utilities'}
                                    </div>
                                    <div style="display: flex; flex-wrap: wrap; gap: 4px;">
                                        ${(isVaultMode ? state.master.apps : (client?.projectData?.localApps || []))
                                            .filter(a => {
                                                const n = (a.name || "").toLowerCase();
                                                const isUtil = n.includes('zapier') && n !== 'zapier';
                                                const isOther = ["webhook", "subzap", "engine"].some(u => n.includes(u));
                                                return isUtil || isOther;
                                            })
                                            .map(u => `<span class="tiny" style="font-size: 9px; background: rgba(255,255,255,0.05); color: var(--text-main); padding: 1px 4px; border-radius: 3px; border: 1px solid rgba(255,255,255,0.1);">${esc(u.name.replace('Zapier ', ''))}</span>`)
                                            .join('')}
                                    </div>
                                </div>
                            ` : ''}
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
                                            oncontextmenu="OL.handlePillInteraction(event, '${app.id}', '${fn.id}'); return false;">
                                          ${esc(fn.name)}
                                      </span>`;
                              }).join('')}
                          </div>
                      </div>
                  </div>
              `;
          }).join('') : `<div class="empty-hint">No apps deployed. Use the buttons above to get started.</div>`}
      </div>
      `}
    `;

    // 🚀 Refresh Lucide
    if (window.lucide) {
        window.lucide.createIcons();
    }
};

export function openVaultDeploymentModal(clientId) {
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

export function filterMasterAppImport(clientId, query) {
    const listEl = document.getElementById("master-app-import-results");
    if (!listEl) return;

    const q = (query || "").toLowerCase().trim();
    const client = state.clients[clientId];
    
    // 🛡️ Filter out apps already in the project
    const existingMasterIds = (client.projectData.localApps || []).map(a => String(a.masterRefId));
    
    const available = (state.master.apps || [])
        .filter(app => !existingMasterIds.includes(String(app.id)) && app.name.toLowerCase().includes(q))
        .sort((a, b) => a.name.localeCompare(b.name));

    listEl.innerHTML = available.map(app => {
        // Resolve the specific icon for this app from the registry
        const iconName = OL.getRegistryIcon(app.type);

        return `
            <div class="search-result-item" style="display:flex; align-items:center; gap:10px;" 
                 onmousedown="OL.pushAppToClient('${app.id}', '${clientId}'); OL.closeModal();">
                <i data-lucide="${iconName}" style="width:14px; height:14px; color:var(--accent); opacity:0.7;"></i>
                <span style="font-size: 13px;">${esc(app.name)}</span>
            </div>
        `;
    }).join('') || `<div class="search-result-item muted">No new apps found.</div>`;

    // 🚀 THE TRIGGER: Since this list updates as you type, 
    // we must tell Lucide to scan the new HTML immediately.
    if (window.lucide) {
        window.lucide.createIcons();
    }
};

// CREATE NEW APP
export function promptAddApp(clientId) {
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

export function createMasterAppFromGrid() {
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
export function handleAppSave(id, value, field = 'name') {
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

export function updateAppMeta(appId, field, value) {
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
export function renderAppModalInnerContent(app, client) {
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
                    <span class="pill tiny soft is-clickable" onclick="OL.openGuideEditor('${guide.id}')">
                        📖 ${esc(guide.name)}
                    </span>
                `).join('')}
                ${linkedGuides.length === 0 ? '<span class="tiny muted italic">No guides linked to this tool.</span>' : ''}
            </div>
        </div>
    `;
}

let modalPillOrder = [];
export function openAppModal(appId, draftObj = null) {
    OL.currentOpenModalId = appId;
    const client = getActiveClient();
    const hash = window.location.hash;
    const isVaultRoute = hash.startsWith('#/vault');

    // 1. Resolve Data: Context-Aware Lookup
    let app = draftObj;
    if (!app) {
        if (isVaultRoute) {
            app = (state.master.apps || []).find(a => a.id === appId);
        } else {
            app = (client?.projectData?.localApps || []).find(a => 
                a.id === appId || a.masterRefId === appId
            );
            if (!app) {
                app = (state.master.apps || []).find(a => a.id === appId);
            }
        }
    }

    if (!app) {
        console.error("❌ Modal Error: App object not found for ID:", appId);
        return; 
    }

    // 🎯 Resolve the Lucide icon for this app
    const iconName = OL.getRegistryIcon(app.type);

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
        // Trigger repaint for dynamic content
        if (window.lucide) window.lucide.createIcons();
        return;
    }

    const isAdmin = state.adminMode === true;
    const isLinkedToMaster = !!app.masterRefId;
    const canPushToMaster = isAdmin && !isVaultRoute && !isLinkedToMaster;

    // 3. Generate Full HTML
    const html = `
        <div class="modal-head" style="gap:15px; display:flex; align-items:center;">
            <div style="display:flex; align-items:center; gap:10px; flex:1;">
                <i data-lucide="${iconName}" style="width:20px; height:20px; color:var(--accent);"></i>
                <input type="text" class="header-editable-input" 
                       value="${esc(val(app.name))}" 
                       placeholder="App Name (e.g. Slack)..."
                       style="background:transparent; border:none; color:inherit; font-size:18px; font-weight:bold; width:100%; outline:none;"
                       onblur="OL.handleAppSave('${app.id}', this.value)">
            </div>
            ${canPushToMaster ? `
                <button class="btn tiny primary" 
                        onclick="OL.pushLocalAppToMaster('${app.id}')"
                        style="background: var(--accent); color: var(--main-text); font-weight: bold; border:none; display:flex; align-items:center; gap:6px;">
                    <i data-lucide="arrow-up-circle" style="width:12px; height:12px;"></i>
                    PUSH TO MASTER
                </button>
            ` : ''}
            <button class="btn small soft" onclick="OL.closeModal()">Close</button>
        </div>
        <div class="modal-body">
            ${renderAppModalInnerContent(app, client)}
            ${OL.renderAccessSection(appId, 'app')}
        </div>
    `;
    
    window.openModal(html);

    // 🚀 THE REPAINT: Convert all data-lucide to SVGs
    if (window.lucide) {
        window.lucide.createIcons();
    }

    // Auto-focus the name field
    setTimeout(() => {
        const input = document.getElementById('modal-app-name-input');
        if (input) input.focus();
    }, 100);
};

export function handleAppTierSelection(appId, value) {
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

export function addMasterAppTier(appId) {
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

export function updateMasterAppTier(appId, idx, field, value) {
    const app = state.master.apps.find(a => String(a.id) === String(appId));
    if (app && app.pricingTiers[idx]) {
        app.pricingTiers[idx][field] = (field === 'price') ? parseFloat(value) || 0 : value;
        OL.persist(); 
        // No modal refresh here to keep focus while typing name
    }
};

export function removeMasterAppTier(appId, idx) {
    const app = state.master.apps.find(a => String(a.id) === String(appId));
    if (app && app.pricingTiers) {
        app.pricingTiers.splice(idx, 1);
        OL.persist().then(() => OL.openAppModal(appId));
    }
};

export function pushLocalAppToMaster(appId) {
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

export function renderStatusLegendHTML() {
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
export function updateMasterApp(id, field, value) {
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

export function promoteAppToMaster(clientId, localAppId) {
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

export async function pushAppToClient(appId, clientId) {
    const client = state.clients[clientId];
    const masterApp = state.master.apps.find(a => String(a.id) === String(appId));
    if (!client || !masterApp) return;

    // 1. Standard Provisioning for the selected App
    const localMappings = (masterApp.functionIds || []).map(m => {
        const fnId = String(typeof m === 'string' ? m : m.id);
        if (!client.sharedMasterIds?.includes(fnId)) {
            if (!client.sharedMasterIds) client.sharedMasterIds = [];
            client.sharedMasterIds.push(fnId);
        }
        return { id: fnId, status: 'available' };
    });

    const localInstance = {
        id: 'local-app-' + Date.now(),
        masterRefId: appId, 
        name: masterApp.name,
        notes: masterApp.notes || "",
        functionIds: localMappings,
        capabilities: [] 
    };

    if (!client.projectData.localApps) client.projectData.localApps = [];
    client.projectData.localApps.push(localInstance);

    // 🚀 2. THE ZAPIER SUITE AUTO-PROVISIONER
    // If the app being added is "Zapier", automatically add the utilities as hidden
    if (masterApp.name === "Zapier") {
        console.log("⚡ Zapier detected. Provisioning Hidden Utility Suite...");
        
        const utilities = [
            { name: "Zapier Filter", key: "filter" },
            { name: "Zapier Formatter", key: "formatter" },
            { name: "Zapier Code", key: "code" },
            { name: "Zapier Delay", key: "delay" },
            { name: "Zapier Manager", key: "manager" },
            { name: "Zapier Looping", key: "looping" },
            { name: "Zapier Webhooks", key: "webhook" },
            { name: "Zapier Email", key: "mail" },
            { name: "Zapier Scheduler", key: "scheduler" },
            { name: "Zapier Formatter", key: "formatter" },
            { name: "Zapier Storage", key: "storage" },
            { name: "Zapier Table", key: "table" },
            { name: "Zapier SMS", key: "sms" },
            { name: "Zapier Engine", key: "engine" },
            { name: "Zapier AI", key: "ai" },
            { name: "Webhook", key: "webhook" },
            { name: "SubZap", key: "subzap" },
        ];

        utilities.forEach(util => {
            // Check if already exists to prevent duplicates
            const exists = client.projectData.localApps.some(a => a.name === util.name);
            if (!exists) {
                client.projectData.localApps.push({
                    id: `local-util-${util.key}-${Date.now()}`,
                    name: util.name,
                    isHidden: true, // 🔒 THE SECRET FLAG
                    notes: "System Utility (Auto-added with Zapier)",
                    functionIds: [],
                    capabilities: []
                });
            }
        });
    }

    await OL.persist();
    buildLayout();
    renderAppsGrid();
    
    setTimeout(() => {
        const modal = document.getElementById("modal-layer");
        if (modal) modal.style.display = "none";
    }, 50);
};

export function cloneMasterToLocal(masterAppId, clientId) {
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

export function renderCapabilitiesList(app, isReadOnlyView) {
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
        <div class="dp-manager-row master-spec" style="display:flex; align-items:center; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.03);">
            <div style="display:flex; gap:10px; align-items:center; flex:1;">
                <span class="pill tiny soft" style="display:flex; align-items:center; gap:4px; font-size:9px;">
                    <i data-lucide="${cap.type === 'Trigger' ? 'zap' : 'play'}" style="width:10px; height:10px;"></i>
                    ${cap.type}
                </span>
                <div class="dp-name-cell muted" style="cursor: default; font-size:12px;">${esc(cap.name)}</div>
            </div>
            <div style="display:flex; align-items:center; gap:8px;">
                ${isAdmin ? `
                    <button class="card-delete-btn" style="position:static; opacity:0.4;" 
                            onclick="event.stopPropagation(); OL.removeMasterCapabilityFromApp('${app.id}', ${idx})">
                        <i data-lucide="x" style="width:14px; height:14px;"></i>
                    </button>
                ` : `
                    <i data-lucide="lock" style="width:12px; height:12px; margin-right:10px; opacity:0.3;"></i>
                `}
            </div>
        </div>
    `).join('');

    // --- RENDER LOCAL SPECS ---
    html += localSpecs.map((cap, idx) => {
        const urlParams = new URLSearchParams(window.location.search);
        const isAdmin = state.adminMode === true || urlParams.get('admin') === 'pizza123';
        const isPushed = !!cap.masterRefId;
        const canEdit = (!isPushed || isAdmin);

        return `
        <div class="dp-manager-row local-spec" style="display:flex; align-items:center; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.03);">
            <div style="display:flex; gap:10px; align-items:center; flex:1;">
                <span class="pill tiny ${cap.type === 'Trigger' ? 'accent' : 'soft'} is-clickable" 
                    style="display:flex; align-items:center; gap:4px; min-width: 75px; justify-content: center; user-select: none; font-size:9px;"
                    onmousedown="if(${canEdit}) { event.stopPropagation(); OL.toggleCapabilityType(event, '${app.id}', ${idx}); }">
                    <i data-lucide="${cap.type === 'Trigger' ? 'zap' : 'play'}" style="width:10px; height:10px;"></i>
                    ${cap.type || 'Action'}
                </span>

                <div class="dp-name-cell" 
                    contenteditable="${canEdit ? 'true' : 'false'}" 
                    style="flex: 1; cursor: ${canEdit ? 'text' : 'default'}; padding: 4px; outline: none; font-size:12px; color: var(--text-main);"
                    onmousedown="event.stopPropagation();"
                    onblur="OL.updateLocalCapability('${app.id}', ${idx}, 'name', this.textContent)">
                    ${esc(cap.name)}
                </div>
            </div>

            <div style="display:flex; gap:8px; align-items:center;">
                ${isAdmin && !isPushed && !!app.masterRefId ? `
                    <button class="btn tiny primary" style="font-size:8px; padding: 2px 6px; display:flex; align-items:center; gap:4px;" 
                            onclick="OL.pushSpecToMaster('${app.id}', ${idx})">
                        <i data-lucide="arrow-up-circle" style="width:10px; height:10px;"></i> PUSH
                    </button>
                ` : ''}
                
                ${canEdit ? `
                    <button class="card-delete-btn" style="position:static; opacity:0.4;"
                            onmousedown="event.stopPropagation(); OL.removeLocalCapability('${app.id}', ${idx})">
                        <i data-lucide="x" style="width:14px; height:14px;"></i>
                    </button>
                ` : `
                    <i data-lucide="lock" style="width:12px; height:12px; margin-right:10px; opacity:0.3;"></i>
                `}
            </div>
        </div>`;
    }).join('');

    // 🚀 Trigger icon generation for dynamic content
    setTimeout(() => { if (window.lucide) window.lucide.createIcons(); }, 0);

    return html || '<div class="empty-hint" style="padding:20px; text-align:center; opacity:0.5; font-size:11px;">No capabilities defined.</div>';
}

export function addAppCapability(appId) {
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

export function getEffectiveCapabilities(app) {
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

export function sortMappings(mappingArray) {
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

export function toggleCapabilityType(event, appId, idx) {
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

export function updateAppCapability(appId, idx, field, value) {
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
export function updateLocalCapability(appId, idx, field, value) {
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

export function removeAppCapability(appId, idx) {
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

export function removeLocalCapability(appId, idx) {
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

export function removeMasterCapabilityFromApp(appId, idx) {
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
export function pushSpecToMaster(appId, localIdx) {
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
export function filterMapList(query, mode) {
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

export function executeMap(targetId, mode) {
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
    // --- 💻 SCENARIO 2: PROJECT MAPPING ---
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

export async function executeCreateAndMap(name, mode, analysisId = null) {
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

export function toggleAppFunction(appId, fnId, event) {
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
export function executeMappingToggle(appObj, fnId, event) {
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

export function syncMasterRelationships(clientId) {
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
export function openGlobalFunctionManager() {
    const fns = state.master.functions || [];

    const html = `
        <div class="modal-head" style="display:flex; align-items:center; gap:12px;">
            <i data-lucide="settings-2" style="width:20px; height:20px; color:var(--accent);"></i>
            <div class="modal-title-text">Master Function Groups</div>
            <div class="spacer"></div>
            <button class="btn small primary" onclick="OL.addNewMasterFunction()">
                <i data-lucide="plus" style="width:14px; height:14px; margin-right:6px;"></i> New Group
            </button>
            <button class="btn small soft" onclick="OL.closeModal()">Close</button>
        </div>
        <div class="modal-body">
            <p class="small muted" style="margin-bottom: 20px;">
                Define global categories (e.g., 'CRM', 'Billing', 'Custodian') to organize your App Library and enable Benchmarking.
            </p>
            <div class="dp-manager-list">
                ${fns.map(fn => `
                    <div class="dp-manager-row" style="display:flex; align-items:center; justify-content:space-between; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.05);">
                        <div class="dp-name-cell" contenteditable="true" 
                             style="flex:1; cursor:text; outline:none; font-size:13px;"
                             onblur="OL.updateMasterFunction('${fn.id}', 'name', this.textContent); OL.persist();">
                            ${esc(fn.name)}
                        </div>
                        <div class="dp-action-cell">
                            <button class="card-delete-btn" style="position:static; opacity:0.4;" onclick="OL.deleteMasterFunction('${fn.id}')">
                                <i data-lucide="x" style="width:14px; height:14px;"></i>
                            </button>
                        </div>
                    </div>
                `).join('')}
                ${fns.length === 0 ? '<div class="empty-hint" style="padding: 20px; text-align: center;">No function groups defined yet.</div>' : ''}
            </div>
        </div>
    `;
    openModal(html);
    if (window.lucide) window.lucide.createIcons();
};


// ---- bridge: keep OL.*/window.* calls working until callers import directly ----
window.OL = window.OL || {};
Object.assign(window.OL, {
    openVaultDeploymentModal, filterMasterAppImport, promptAddApp,
    createMasterAppFromGrid, handleAppSave, updateAppMeta, openAppModal,
    handleAppTierSelection, addMasterAppTier, updateMasterAppTier,
    removeMasterAppTier, pushLocalAppToMaster, updateMasterApp,
    promoteAppToMaster, pushAppToClient, cloneMasterToLocal,
    addAppCapability, getEffectiveCapabilities, sortMappings,
    toggleCapabilityType, updateAppCapability, updateLocalCapability,
    removeAppCapability, removeLocalCapability, removeMasterCapabilityFromApp,
    pushSpecToMaster, filterMapList, executeMap, executeCreateAndMap,
    toggleAppFunction, executeMappingToggle, syncMasterRelationships,
    openGlobalFunctionManager
});
// These two are called bare (no OL./window. prefix) from sections still
// living in app.js (Functions Grid and beyond) — bridge onto window
// directly so those calls keep resolving after this module moves out.
window.renderAppsGrid = renderAppsGrid;
window.renderStatusLegendHTML = renderStatusLegendHTML;
