//======================= FEATURES / ANALYSIS =======================//
// Extracted from app.js "ANALYSIS MATRIX SECTION" + "CONSOLIDATED
// FEATURES MANAGEMENT" + "CONSOLIDATED CATEGORY SEARCH" — these three
// were combined into one module since they're tightly coupled (the
// matrix, its scoring, and the feature/category library it scores
// against) and there was no clean function-level boundary between them
// in the original file.

import { state, esc, getActiveClient, persist } from '../core/data.js';

export function renderAnalysisModule(isVaultMode = false) {
    OL.registerView(renderAnalysisModule);
    const container = document.getElementById("mainContent");
    
    // 🚀 THE FIX: Use hash check if isVaultMode wasn't explicitly passed
    const isActuallyVault = isVaultMode || window.location.hash.startsWith('#/vault');
    const client = isActuallyVault ? null : getActiveClient();
    
    if (!isActuallyVault && !client) return;
    if (!container) return;
    container.style.cssText = '';
    document.body.classList.remove('is-visualizer');

    const masterTemplates = state.master.analyses || [];
    
    // 🏗️ Determine which templates and local analyses to show
    const templatesToDisplay = isActuallyVault 
        ? masterTemplates 
        : masterTemplates.filter(t => client?.sharedMasterIds?.includes(t.id));

    const localAnalyses = (!isActuallyVault && client) ? (client.projectData.localAnalyses || []) : [];

    container.innerHTML = `
        <div class="section-header" style="display:flex; align-items:center; gap:12px;">
            <i data-lucide="${isActuallyVault ? 'library' : 'bar-chart-horizontal'}" 
               style="width:28px; height:24px; color:var(--accent);"></i>
            <div style="flex:1;">
                <h2 style="margin:0;">
                    ${isActuallyVault ? 'Master Analysis Library' : 'Feature Analysis & Comparison'}
                </h2>
                <div class="small muted subheader">
                    ${isActuallyVault ? 'Global templates for standardized scoring' : `Helping ${esc(client?.meta.name)} find the right fit`}
                </div>
            </div>
            <div class="header-actions">
                <button class="btn small soft" onclick="OL.openGlobalContentManager()" style="margin-right: 8px; display:inline-flex; align-items:center;" title="Manage Global Content">
                    <i data-lucide="settings" style="width:16px; height:16px;"></i>
                </button>
                ${isActuallyVault ? 
                    `<button class="btn primary" onclick="OL.createNewMasterAnalysis()" style="display:inline-flex; align-items:center; gap:6px;">
                        <i data-lucide="plus" style="width:14px; height:14px;"></i> Create Template
                     </button>` : 
                    `<button class="btn small soft" onclick="OL.createNewAnalysisSandbox()" style="display:inline-flex; align-items:center; gap:6px;">
                        <i data-lucide="plus" style="width:14px; height:14px;"></i> Local Analysis
                     </button>
                     <button class="btn primary" onclick="OL.importAnalysisFromVault()" style="margin-right:8px; display:inline-flex; align-items:center; gap:6px;">
                        <i data-lucide="download-cloud" style="width:14px; height:14px;"></i> Import from Master
                     </button>`
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
    if (window.lucide) {
        window.lucide.createIcons();
    }
};

export function renderAnalysisCard(anly, isMaster) {
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

export function syncMatrixName(el) {
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
export function createNewMasterAnalysis() {
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

export function createNewAnalysisSandbox() {
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

export async function deleteAnalysis(anlyId, isVaultMode) {
    if (!confirm("Are you sure you want to delete this analysis?")) return;

    // 🚀 THE SHIELD: Wrap in updateAndSync to bypass the Muzzle
    await OL.updateAndSync(() => {
        if (isVaultMode) {
            state.master.analyses = state.master.analyses.filter(a => a.id !== anlyId);
        } else {
            const client = getActiveClient();
            if (client?.projectData?.localAnalyses) {
                client.projectData.localAnalyses = client.projectData.localAnalyses.filter(a => a.id !== anlyId);
            }
        }
    });

    // 🧹 UI Cleanup
    const container = document.getElementById("activeAnalysisMatrix");
    if (container) container.innerHTML = ""; // Wipe the matrix from view immediately
    
    state.activeMatrixId = null;
    window.isMatrixActive = false; // 🔓 Release the lock

    renderAnalysisModule(isVaultMode);
    console.log("🗑️ Analysis deleted and persisted.");
};

export function filterMasterAnalysisImport(query) {
    const listEl = document.getElementById("master-anly-import-results");
    if (!listEl) return;

    const q = (query || "").toLowerCase().trim();
    const client = getActiveClient();
    
    const existingRefs = (client?.projectData?.localAnalyses || [])
        .map(a => String(a.masterRefId))
        .filter(Boolean);

    const available = (state.master.analyses || []).filter(t => 
        (t.name || "").toLowerCase().includes(q) && 
        !existingRefs.includes(String(t.id))
    );

    listEl.innerHTML = available.length ? available.map(anly => `
        <div class="search-result-item" onmousedown="OL.executeAnalysisImportById('${anly.id}')">
            <div>
                <strong>${esc(anly.name)}</strong>
                <div class="tiny muted">${(anly.apps||[]).length} apps · ${(anly.features||[]).length} features</div>
            </div>
        </div>
    `).join('') : `<div class="search-result-item muted">No templates found.</div>`;
};

export function importAnalysisFromVault() {
    const html = `
        <div class="modal-head" style="display:flex; align-items:center; gap:12px; padding: 20px;">
            <i data-lucide="download-cloud" style="width:20px; height:20px; color:var(--accent);"></i>
            <div class="modal-title-text">Import Analysis Template</div>
            <div class="spacer"></div>
            <button class="btn small soft" onclick="OL.closeModal()">Cancel</button>
        </div>
        <div class="modal-body">
            <div class="search-map-container">
                <div style="position:relative; display:flex; align-items:center;">
                    <i data-lucide="search" style="position:absolute; left:12px; width:14px; height:14px; opacity:0.4;"></i>
                    <input type="text" class="modal-input" 
                           style="padding-left:35px;"
                           placeholder="Search templates (e.g. CRM, AI)..." 
                           onfocus="OL.filterMasterAnalysisImport('')"
                           oninput="OL.filterMasterAnalysisImport(this.value)" 
                           autofocus>
                </div>
                <div id="master-anly-import-results" class="search-results-overlay" style="margin-top:10px;"></div>
            </div>
        </div>
    `;
    openModal(html);

    // 🚀 THE REPAINT: Convert tags to SVGs
    if (window.lucide) {
        window.lucide.createIcons();
    }
};

// Helper to handle the specific ID from search
export async function executeAnalysisImportById(templateId) {
    const template = state.master.analyses.find(t => String(t.id) === String(templateId));
    const client = getActiveClient();
    
    if (!template || !client) {
        console.error("❌ Import Failed: Missing template or client context.");
        return;
    }

    // 1. Deep Clone the template to create the project-specific version
    const newAnalysis = JSON.parse(JSON.stringify(template));
    newAnalysis.id = "anly-" + Date.now();
    newAnalysis.masterRefId = templateId;
    newAnalysis.isMaster = false;

    // Initialize localApps if missing
    if (!client.projectData.localApps) client.projectData.localApps = [];

    // 🚀 2. THE ATOMIC PROVISIONING LOOP
    if (newAnalysis.apps) {
        for (let i = 0; i < newAnalysis.apps.length; i++) {
            const matrixAppEntry = newAnalysis.apps[i];
            
            // Try to find the app in the Project already (by masterRef or Name)
            let localApp = client.projectData.localApps.find(la => 
                String(la.masterRefId) === String(matrixAppEntry.appId) || 
                la.name.toLowerCase() === (matrixAppEntry.name || "").toLowerCase()
            );

            if (!localApp) {
                // 🏗️ DISCOVERY: App missing from project. Find source in Master Vault.
                const masterSource = state.master.apps.find(ma => 
                    String(ma.id) === String(matrixAppEntry.appId) || 
                    ma.name.toLowerCase() === (matrixAppEntry.name || "").toLowerCase()
                );

                if (masterSource) {
                    console.log(`🚚 Deploying: ${masterSource.name}`);
                    localApp = {
                        ...JSON.parse(JSON.stringify(masterSource)),
                        id: 'local-app-' + Date.now() + Math.random().toString(36).substr(2, 5),
                        masterRefId: masterSource.id,
                        notes: `(Auto-deployed via ${template.name} Import)`
                    };
                    client.projectData.localApps.push(localApp);
                }
            }

            // 🎯 WIRE THE MATRIX TO THE LOCAL APP
            if (localApp) {
                newAnalysis.apps[i].appId = localApp.id;
                newAnalysis.apps[i].name = localApp.name; // Crucial for label rendering
                
                // Copy pricing to the app card if it's currently $0
                if (!localApp.monthlyCost || localApp.monthlyCost === 0) {
                    localApp.monthlyCost = matrixAppEntry.monthlyCost || 0;
                }
            } else {
                // ⚠️ LAST RESORT: If no master source found, preserve the name so it isn't "Unknown"
                newAnalysis.apps[i].name = matrixAppEntry.name || "Unknown Tool";
                console.warn(`⚠️ App "${newAnalysis.apps[i].name}" not found in Vault. Label preserved but unlinked.`);
            }
            
            // Clear evaluative scores for the fresh import
            newAnalysis.apps[i].scores = {};
        }
    }

    // 3. Save the new Analysis to the project
    if (!client.projectData.localAnalyses) client.projectData.localAnalyses = [];
    client.projectData.localAnalyses.push(newAnalysis);

    // 4. Force a hard save and immediate refresh
    await OL.persist();
    
    // UI Cleanup
    OL.closeModal();
    
    // 🔄 Switch to the newly imported matrix immediately
    setTimeout(() => {
        if (typeof renderAnalysisModule === "function") renderAnalysisModule(false);
        OL.openAnalysisMatrix(newAnalysis.id, false);
    }, 100);
};

export function pushMatrixToMasterLibrary(anlyId) {
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

export function deleteMasterAnalysis(anlyId) {
    if (!confirm("Are you sure you want to permanently delete this Master Template? It will no longer be available for import into new client projects.")) return;

    state.master.analyses = (state.master.analyses || []).filter(a => a.id !== anlyId);
    
    OL.persist();
    renderAnalysisModule(true); // Refresh the Vault view
};

// 3. OPEN INDIVIDUAL ANALYSIS MATRIX
export function openAnalysisMatrix(analysisId, isMaster) {
    window.isMatrixActive = true;

    if (state.activeMatrixId === analysisId && 
        document.querySelector('.matrix-table')) {
        return;
    }
    
    state.activeMatrixId = analysisId;
    
    const client = getActiveClient();
    const source = isMaster ? state.master.analyses : (client?.projectData?.localAnalyses || []);
    const anly = source.find(a => a.id === analysisId);

    if (!anly) return console.error("Analysis not found:", analysisId);

    const container = document.getElementById("activeAnalysisMatrix");
    if (!container) return;
    container.style.cssText = '';
    document.body.classList.remove('is-visualizer');

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
                        <h3 style="display:flex; align-items:center; gap:10px;">
                            <i data-lucide="bar-chart-horizontal" style="width:20px; height:20px; color:var(--accent);"></i>
                            Matrix: 
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
                    <div class="header-actions" style="display:flex; align-items:center; gap:8px;">
                        ${!isMaster && state.adminMode ? `
                            <button class="btn tiny warn" onclick="OL.pushMatrixToMasterLibrary('${analysisId}')" style="display:flex; align-items:center; gap:4px;">
                                <i data-lucide="upload-cloud" style="width:12px; height:12px;"></i> Push to Vault
                            </button>` : ''}
                        <button class="btn tiny primary" onclick="OL.universalPrint('${analysisId}', ${isMaster})" style="display:flex; align-items:center; gap:4px;">
                            <i data-lucide="printer" style="width:12px; height:12px;"></i> Print
                        </button>
                        <button class="btn tiny soft" onclick="OL.addAppToAnalysis('${analysisId}', ${isMaster})" style="display:flex; align-items:center; gap:4px;">
                            <i data-lucide="plus" style="width:12px; height:12px;"></i> App
                        </button>
                        <button class="btn tiny danger soft" onclick="document.getElementById('activeAnalysisMatrix').innerHTML='';" style="margin-left:10px; height:24px; width:24px; display:flex; align-items:center; justify-content:center;">
                            <i data-lucide="x" style="width:14px; height:14px;"></i>
                        </button>
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
                                <div style="display: flex; align-items: center; gap: 8px;">
                                    <i data-lucide="banknote" style="width:14px; height:14px; color:var(--accent);"></i>
                                    <span style="color: var(--accent); font-weight: bold; text-transform: uppercase; font-size:11px; letter-spacing:0.1em;">PRICING & TIERS DEFINITION</span>
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
                                        <span class="pill ${score > 2.5 ? 'accent' : 'soft'}" data-app-total="${appObj.appId}">${score}</span>
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
                                        <div id="cost-display-${appObj.appId}" style="font-size: 1.2rem; font-weight: bold; color: var(--accent);">
                                            $${cost.toLocaleString()}
                                        </div>
                                        <div style="font-size: 9px; opacity: 0.6; margin-top: 2px;">PER USER / MO</div>
                                    </td>`;
                            }).join('')}
                            ${(anly.competitors || []).map(() => `<td style="border: 1px solid var(--line);"></td>`).join('')}
                        </tr>
                    </tbody>
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

    requestAnimationFrame(() => {
        // Only resize textareas that are actually in the viewport
        const textareas = document.querySelectorAll('.matrix-notes-auto');
        textareas.forEach(el => {
            el.style.height = '28px'; // Set a fixed small default instead of auto-calculating
        });
    
        if (typeof OL.refreshMatrixTotals === 'function') {
            OL.refreshMatrixTotals(analysisId);
        }
    
        if (window.lucide) window.lucide.createIcons();
        console.log("⚡ Matrix interactivity initialized.");
    });
}

export async function updateAnalysisMeta(anlyId, field, value, isMaster) {
    const client = getActiveClient();
    const source = isMaster ? state.master.analyses : (client?.projectData?.localAnalyses || []);
    const anly = source.find(a => a.id === anlyId);
    if (!anly) return;

    anly[field] = value.trim();
    OL.persist();

    // Only do surgical DOM updates, never re-render the whole matrix
    if (field === 'name') {
        const cardTitle = document.querySelector(`.card-title-${anlyId}`);
        if (cardTitle) cardTitle.innerText = value.trim();
        // Update the editable span in the matrix header too
        const nameSpan = document.querySelector(`.m-name-${anlyId}`);
        if (nameSpan && nameSpan !== document.activeElement) nameSpan.innerText = value.trim();
    }
};

export function getCategorySortWeight(catName) {
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

export function renderAnalysisMatrixRows(anly, analysisId, isMaster, totalColspan) {
    const anlyId = anly.id;
    // 🛡️ Scope Fix: Force isMaster to a literal boolean string for the HTML attributes
    const masterFlag = isMaster ? true : false; 
    let currentCategory = null;
    let rowsHtml = "";

    const features = anly.features || [];
    // Sort features by category weight
    features.sort((a, b) => {
        const weightA = OL.getCategorySortWeight(a.category);
        const weightB = OL.getCategorySortWeight(b.category);
        if (weightA !== weightB) return weightA - weightB;
        return (a.category || "").localeCompare(b.category || "");
    });
    
    // We use a single loop to build the string to reduce memory overhead
    features.forEach(feat => {
        const catName = feat.category || "General";
        const featId = feat.id;

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
                                  onclick="OL.openCategoryManagerModal('${analysisId}', '${esc(catName)}', ${masterFlag})">
                                ${esc(catName)}
                            </span>
                        </div>
                    </td>
                </tr>
            `;
        }

        // 2. Feature Info Column
        rowsHtml += `
        <tr>
            <td style="padding-left: 28px;">
                <div style="display:flex; align-items:center; gap:8px;">
                    <button class="card-delete-btn" onclick="OL.removeFeatureFromAnalysis('${analysisId}', '${featId}', ${masterFlag})">×</button> 
                    <span class="small feature-edit-link" 
                            style="cursor: pointer; border-bottom: 1px dotted var(--muted);"
                            onclick="OL.editFeatureModal('${analysisId}', '${featId}', ${masterFlag})">
                        ${esc(feat.name)}
                        <span style="font-size: 10px; opacity: 0.3;">📝</span>
                    </span>
                </div>
                <div style="font-size: 10px; color: var(--text-dim); line-height: 1.3; font-style: italic; max-width: 260px; padding-left: 20px;">
                    ${feat.description ? esc(feat.description) : '<span style="opacity: 0.2;">No description...</span>'}
                </div>
            </td>
            <td style="padding: 0 8px; border: 1px solid var(--line); width: 100px; background:rgba(255,255,255,0.01);">
                <input type="number" 
                    class="tiny-input" 
                    style="width: 40px; background: transparent; border: none; color: var(--accent); text-align: right; font-weight: bold; font-size: 12px; outline: none;"
                    value="${feat.weight || 0}" 
                    onblur="OL.updateAnalysisFeature('${analysisId}', '${featId}', 'weight', this.value, ${masterFlag})">
            </td>`;

        // 3. Map Apps (The "Heavy" Loop)
        // Optimization: We pre-calculate common values outside the string builder
        const appCells = (anly.apps || []).map(appObj => {
            const pricing = appObj.featPricing?.[featId] || {};
            const costType = pricing.type || 'not_included'; 
            const isNotIncluded = costType === 'not_included';
            const mFlag = isMaster ? 'true' : 'false';

            return `
                <td style="padding: 6px; border: 1px solid var(--line); vertical-align: top; min-width: 140px; background: rgba(255,255,255,0.01);">
                    <div style="display: flex; flex-direction: column; gap: 6px;">                            
                        <select class="tiny-select" style="width: 100%; height: 22px;"
                            onchange="OL.handleMatrixPricingChange('${anlyId}', '${appObj.appId}', '${featId}', this.value, '${mFlag}')">
                            <option value="not_included" ${isNotIncluded ? 'selected' : ''}>Not Included</option>
                            <optgroup label="Included In:">
                                ${(appObj.pricingTiers || []).map(t => `
                                    <option value="tier|${esc(t.name)}" ${pricing.tierName === t.name ? 'selected' : ''}>
                                        Tier: ${esc(t.name)}
                                    </option>
                                `).join('')}
                            </optgroup>
                            <option value="addon" ${costType === 'addon' ? 'selected' : ''}>Add-on</option>
                        </select>

                        <textarea placeholder="Notes..." class="matrix-notes-auto"
                            oninput="this.style.height = ''; this.style.height = this.scrollHeight + 'px'"
                            onblur="OL.updateAnalysisNote('${analysisId}', '${appObj.appId}', '${featId}', this.value, ${masterFlag})"
                        >${esc(appObj.notes?.[featId] || "")}</textarea>

                        <div style="display: ${isNotIncluded ? 'none' : 'flex'}; align-items: center; gap: 8px; background: rgba(0,0,0,0.02); border-radius: 4px; padding: 2px 5px;">
                            <span style="color: var(--muted); font-size: 9px;">Score</span>
                            <input type="number" min="0" max="3" class="matrix-score-input" 
                                style="width: 100%; background: transparent; border: none; color: var(--accent); font-weight: bold; text-align: right; outline: none;"
                                value="${appObj.scores?.[featId] || 0}"
                                onblur="OL.updateAnalysisScore('${analysisId}', '${appObj.appId}', '${featId}', this.value, ${masterFlag})">
                        </div>

                        <div id="addon-price-${appObj.appId}-${featId}" 
                            style="display: ${costType === 'addon' ? 'flex' : 'none'}; align-items: center; gap: 4px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 4px;">
                            <span class="tiny muted" style="font-size: 9px;">$</span>
                            <input type="number" class="price-input-tiny" 
                                style="max-width:50px; background:transparent; border: 1px solid var(--panel-border); font-size: 10px;"
                                value="${pricing.addonPrice || 0}" 
                                onblur="OL.updateAppFeatAddonPrice('${analysisId}', '${appObj.appId}', '${featId}', this.value)">
                        </div>
                    </div>
                </td>`;
        }).join('');

        rowsHtml += appCells + `</tr>`;
    });
    return rowsHtml;
};

export async function updateAnalysisNote(analysisId, appId, featId, value, isMaster) {
    const client = getActiveClient();
    
    // 1. Identify the Source
    const source = isMaster ? state.master.analyses : (client?.projectData?.localAnalyses || []);
    const anly = source.find(a => String(a.id) === String(analysisId));

    if (anly) {
        // 🚀 THE FIX: Changed 'appEntry' to 'appObj' to match the search
        const appObj = anly.apps.find(a => String(a.appId) === String(appId));
        
        if (appObj) {
            if (!appObj.notes) appObj.notes = {};
            appObj.notes[featId] = value;
            
            // ☁️ Save silently in the background
            await OL.persist(); 
            console.log("📝 Note saved surgically.");
        } else {
            console.error("App not found in analysis:", appId);
        }
    } else {
        console.error("Analysis not found:", analysisId);
    }
};

export function universalPrint() {
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

export function printScopingSheet() {
    const client = getActiveClient();
    if (!client) return;
    const sheet = client.projectData?.scopingSheets?.[0];
    if (!sheet) return;

    const clientName = client.meta?.name || 'Scoping Sheet';
    const date = new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });
    const baseRate = client.projectData.customBaseRate || state.master.rates?.baseHourlyRate || 300;
    const vars = state.master.rates?.variables || {};

    // Group items by round
    const roundGroups = {};
    (sheet.lineItems || []).forEach(item => {
        const r = String(item.round || '1');
        if (!roundGroups[r]) roundGroups[r] = [];
        roundGroups[r].push(item);
    });
    const sortedRounds = Object.keys(roundGroups).sort((a,b) => Number(a) - Number(b));

    // Unit badges for an item — show all non-zero scoping vars regardless of resource type
    const unitBadgesHtml = (item) => {
        const combined = { ...(item.scopingData || {}), ...(item.customData || {}) };
        const badges = Object.entries(combined)
            .filter(([vid, count]) => { const v = vars[vid]; return v && Number(count) > 0; })
            .map(([vid, count]) => { const v = vars[vid]; return `<span class="unit-tag">${count} ${esc(v.label)}</span>`; })
            .join('');
        return badges ? `<div class="unit-row">${badges}</div>` : '';
    };

    // Calculate row values
    const rowGross = (item, res) => OL.calculateBaseFeeWithMultiplier(item, res);
    const rowNet   = (item, res) => OL.calculateRowFee(item, res);

    // Build rows
    let totalGross = 0, totalNet = 0, totalApproved = 0;
    let rowsHtml = '';
    sortedRounds.forEach(r => {
        let roundGross = 0, roundNet = 0;
        let roundRows = '';
        roundGroups[r].forEach(item => {
            const res = OL.getResourceById(item.resourceId);
            if (!res) return;
            const gross = rowGross(item, res);
            const net   = rowNet(item, res);
            const disc  = gross - net;
            totalGross += gross;
            totalNet   += net;
            roundGross += gross;
            roundNet   += net;

            // Approved = Do Now + (Sphynx or Joint)
            const statusLc = (item.status || '').toLowerCase().trim();
            const partyLc  = (item.responsibleParty || '').toLowerCase().trim();
            if (statusLc === 'do now' && (partyLc === 'sphynx' || partyLc === 'joint')) {
                totalApproved += net;
            }

            const multiplierLabel = (() => {
                const teamMult = item.teamMultiplier ?? state.master.rates?.teamMultiplier ?? 1;
                const parts = [];
                if (teamMult && teamMult !== 1) parts.push(`×${teamMult} team`);
                return parts.join(' · ') || '—';
            })();

            const pricingHtml = (() => {
                if (!gross && !net) return '';
                let s = `<span class="price-gross">$${gross.toLocaleString()}</span>`;
                if (disc > 0) s += `<span class="price-sep"> − </span><span class="price-disc">$${disc.toLocaleString()} disc</span>`;
                s += `<span class="price-sep"> → </span><span class="price-net">$${net.toLocaleString()}</span>`;
                return `<div class="item-pricing">${s}</div>`;
            })();

            roundRows += `<div class="item-row">
                <div class="item-body">
                    <div class="item-main">
                        <div class="item-name">${esc(res.name)}</div>
                        ${res.description ? `<div class="item-desc">${esc(res.description)}</div>` : ''}
                        ${unitBadgesHtml(item)}
                        ${pricingHtml}
                    </div>
                    <div class="item-meta">
                        <span class="mc-status meta-pill status-${(item.status||'').toLowerCase().replace(/\s+/g,'-')}">${esc(item.status || '—')}</span>
                        <span class="mc-party meta-pill party">${esc(item.responsibleParty || '—')}</span>
                        <span class="mc-mult meta-pill muted">${multiplierLabel}</span>
                    </div>
                </div>
            </div>`;
        });

        rowsHtml += `<div class="round-block">
            <div class="round-header">
                <span class="round-title">Round ${r}</span>
                <span class="round-totals">Gross $${roundGross.toLocaleString()} · Net <strong>$${roundNet.toLocaleString()}</strong></span>
            </div>
            ${roundRows}
        </div>`;
    });

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>${esc(clientName)} — Scoping Sheet</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Inter', -apple-system, sans-serif; font-size: 11px;
       color: #0f172a; background: #fff; padding: 28px 32px; }
@page { size: auto landscape; margin: 12mm 10mm; }

.print-header { display: flex; justify-content: space-between; align-items: flex-end;
                border-bottom: 2px solid #0f172a; padding-bottom: 12px; margin-bottom: 24px; }
.ph-title { font-size: 20px; font-weight: 800; }
.ph-sub { font-size: 11px; color: #64748b; margin-top: 3px; }
.ph-meta { text-align: right; font-size: 10px; color: #94a3b8; }

.round-block { margin-bottom: 20px; break-inside: avoid; }
.round-header { display: flex; justify-content: space-between; align-items: baseline;
                padding: 6px 10px; background: #f8fafc; border-left: 3px solid #0ea5e9;
                border-radius: 0 4px 4px 0; margin-bottom: 4px; }
.round-title { font-size: 10px; font-weight: 800; text-transform: uppercase;
               letter-spacing: 0.07em; color: #0ea5e9; }
.round-totals { font-size: 9px; color: #64748b; }
.round-totals strong { color: #0f172a; font-size: 10px; }

.item-row { border-bottom: 1px solid #f1f5f9; padding: 7px 10px 7px 12px;
            break-inside: avoid; }
.item-body { display: flex; align-items: flex-start; gap: 12px; }
.item-main { flex: 1; min-width: 0; }
.item-name { font-size: 11px; font-weight: 700; color: #0f172a; line-height: 1.3; }
.item-desc { font-size: 9px; color: #64748b; margin-top: 2px; line-height: 1.4;
             font-style: italic; }
.unit-row { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
.unit-tag { font-size: 8px; font-weight: 700; text-transform: uppercase;
            border: 1px solid #e2e8f0; border-radius: 3px; padding: 1px 6px; color: #475569; }
.item-pricing { margin-top: 4px; font-size: 9px; color: #94a3b8;
                font-variant-numeric: tabular-nums; }
.price-gross { color: #94a3b8; }
.price-disc  { color: #dc2626; }
.price-net   { color: #0f172a; font-weight: 800; font-size: 10px; }
.price-sep   { color: #cbd5e1; }

.item-meta { display: flex; flex-direction: column; align-items: flex-end; gap: 4px;
             flex-shrink: 0; padding-top: 1px; }
.meta-pill { font-size: 9px; padding: 2px 7px; border-radius: 99px;
             border: 1px solid #e2e8f0; color: #475569; white-space: nowrap; }
.meta-pill.status-do-now { background: #dcfce7; border-color: #86efac; color: #15803d; }
.meta-pill.status-do-later { background: #fef9c3; border-color: #fde047; color: #854d0e; }
.meta-pill.status-don-t-do { background: #fee2e2; border-color: #fca5a5; color: #991b1b; }
.meta-pill.status-done { background: #dbeafe; border-color: #93c5fd; color: #1d4ed8; }
.mc-status { }
.mc-party  { }
.mc-mult   { color: #94a3b8; }

.grand-total { display: flex; justify-content: flex-end; gap: 32px; align-items: flex-end;
               padding: 14px 10px; border-top: 2px solid #0f172a; margin-top: 16px; }
.gt-label { font-size: 9px; font-weight: 700; text-transform: uppercase;
            letter-spacing: 0.06em; color: #64748b; display: block; margin-bottom: 2px; }
.gt-val { font-size: 16px; font-weight: 800; color: #64748b; }
.gt-val.net { color: #0f172a; }
.gt-val.approved { font-size: 22px; color: #15803d; }
</style></head><body>
<div class="print-header">
  <div><div class="ph-title">${esc(clientName)}</div><div class="ph-sub">Scoping Sheet</div></div>
  <div class="ph-meta">Generated ${date}<br>${(sheet.lineItems||[]).length} items</div>
</div>
${rowsHtml}
<div class="grand-total">
  <div><span class="gt-label">Gross</span><span class="gt-val">$${totalGross.toLocaleString()}</span></div>
  <div><span class="gt-label">Net</span><span class="gt-val net">$${totalNet.toLocaleString()}</span></div>
  <div><span class="gt-label">Approved</span><span class="gt-val approved">$${totalApproved.toLocaleString()}</span></div>
</div>
</body></html>`;

    const win = window.open('', '_blank', 'width=1100,height=850');
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 600);
};

export function renameMatrix(anlyId, newName, isMaster) {
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
export function calculateAppTotalCost(appObj) {
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
// Add 'isMaster' to the arguments list here 👇
export async function handleMatrixPricingChange(anlyId, appId, featId, value, isMaster) {
    const client = getActiveClient();
    
    // 1. Force isMaster to a real boolean (handles 'true' vs true)
    const masterBool = (isMaster === true || isMaster === 'true');
    
    // 2. Identify the correct source
    const source = masterBool ? (state.master?.analyses || []) : (client?.projectData?.localAnalyses || []);
    
    // 3. Find the analysis using String comparison to avoid ID type issues
    const anly = source.find(a => String(a.id) === String(anlyId));
    
    if (!anly) {
        console.error("❌ Analysis not found for ID:", anlyId, "| Master Mode:", masterBool);
        // Debug: Log the available IDs so you can see why it failed
        console.log("Available IDs in source:", source.map(a => a.id));
        return;
    }

    const appInMatrix = anly.apps.find(a => String(a.appId) === String(appId));    
    if (!appInMatrix) {
        console.error("❌ App not found in this analysis:", appId);
        return;
    }
    
    // 4. Process the value
    const [type, tierName] = value.split('|');
    if (!appInMatrix.featPricing) appInMatrix.featPricing = {};
    
    appInMatrix.featPricing[featId] = {
        type: type,
        tierName: tierName || null,
        addonPrice: appInMatrix.featPricing[featId]?.addonPrice || 0
    };

    // 5. Surgical Update (UI only)
    const newCost = OL.calculateAppTotalCost(appInMatrix);
    const costEl = document.getElementById(`cost-display-${appId}`);
    if (costEl) {
        costEl.innerText = `$${newCost.toLocaleString()}`;
    }

    // 6. Persist to Cloud
    await OL.persist();
    console.log("✅ Pricing updated and persisted.");
};

// Add a new Tier to a specific App
export async function addAppTier(anlyId, appId) {
    const anly = OL.getScopedAnalyses().find(a => a.id === anlyId);
    const app = anly?.apps.find(a => a.appId === appId);
    if (app) {
        if (!app.pricingTiers) app.pricingTiers = [];
        app.pricingTiers.push({ name: "New Tier", price: 0 });
    }
    OL.persist();
    OL.openAnalysisMatrix(anlyId);
};

export async function updateAppTier(anlyId, appId, tierIdx, field, value) {
    const anly = OL.getScopedAnalyses().find(a => a.id === anlyId);
    const app = anly?.apps.find(a => a.appId === appId);
    if (app?.pricingTiers?.[tierIdx]) {
        app.pricingTiers[tierIdx][field] = field === 'price' ? (parseFloat(value) || 0) : value;
    }
    OL.persist();
};

export async function removeAppTier(anlyId, appId, idx) {
    if (!confirm("Remove this pricing tier?")) return;
    const anly = OL.getScopedAnalyses().find(a => a.id === anlyId);
    const app = anly?.apps.find(a => a.appId === appId);
    if (app?.pricingTiers) app.pricingTiers.splice(idx, 1);
    OL.persist();
    OL.openAnalysisMatrix(anlyId);
};

export async function updateAppFeatAddonPrice(anlyId, appId, featId, value) {
    const anly = OL.getScopedAnalyses().find(a => a.id === anlyId);
    const app = anly?.apps.find(a => a.appId === appId);
    if (app?.featPricing?.[featId]) {
        app.featPricing[featId].addonPrice = parseFloat(value) || 0;
    }
    OL.persist();
    OL.openAnalysisMatrix(anlyId);
};

// 4. ADD APP TO ANALYSIS OR REMOVE

export function filterAnalysisAppSearch(anlyId, isMaster, query) {
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
                <span>💻 ${esc(app.name)}</span>
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

export function addAppToAnalysis(anlyId, isMaster) {
    const html = `
        <div class="modal-head">
            <div class="modal-title-text">💻 Add App to Matrix</div>
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

export async function executeAddAppToAnalysis(anlyId, appId, isMaster) {
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

export async function removeAppFromAnalysis(anlyId, appId, isMaster) {
    const client = getActiveClient();
    const source = isMaster ? state.master.analyses : client.projectData.localAnalyses;
    const anly = source.find(a => a.id === anlyId);
    if (!anly || !anly.apps) return;
    if (!confirm('Remove this app from the comparison?')) return;

    // 1. Update data
    anly.apps = anly.apps.filter(a => a.appId !== appId);

    // 2. Fire and forget
    OL.persist();

    // 3. Re-render immediately without waiting for Firebase
    OL.openAnalysisMatrix(anlyId, isMaster);
};

// 4b. ADD FEATURE TO ANALYSIS OR REMOVE
export function getGlobalCategories() {
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

export function getGlobalFeatures() {
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

export function filterContentManager(query) {
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

export function universalFeatureSearch(query, anlyId, isMaster, targetElementId, excludeNames = []) {
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

export function unifiedAddFlow(query, anlyId, isMaster, excludeNames=[]) {
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

export function updateAnalysisFeature(anlyId, featId, key, value, isMaster) {
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

export function syncFeatureChanges(oldName, newData, isVault) {
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

export function promptFeatureCategory(anlyId, featName, isMaster) {
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

export async function removeFeatureFromAnalysis(anlyId, featId, isMaster) {
    if (!confirm("Remove this feature? All scores for this feature will be lost.")) return;
    
    const client = getActiveClient();
    const source = isMaster ? state.master.analyses : client.projectData.localAnalyses;
    const anly = source.find(a => a.id === anlyId);

    if (anly) {
        // 1. Remove the feature
        anly.features = (anly.features || []).filter(f => f.id !== featId);
        
        // 2. Clear scores for this feature from all apps
        (anly.apps || []).forEach(appObj => {
            if (appObj.scores) delete appObj.scores[featId];
            if (appObj.featPricing) delete appObj.featPricing[featId];
        });

        // 3. Fire and forget
        OL.persist();

        // 4. Re-render
        OL.openAnalysisMatrix(anlyId, isMaster);
        console.log("🗑️ Feature removed.");
    }
};

// 4c. ADD CATEGORY TO ANALYSIS OR REMOVE
export function openCategoryManagerModal(anlyId, catName, isMaster) {
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

export async function addAllFeaturesFromCategory(anlyId, catName, isMaster) {
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

export function executeAddCategoryToAnalysis(anlyId, catName, isMaster) {
    const client = getActiveClient();
    const source = isMaster ? state.master.analyses : (client?.projectData?.localAnalyses || []);
    const anly = source.find(a => a.id === anlyId);

    if (anly) {
        const cleanName = catName.trim();
        if (cleanName && !anly.categories.includes(cleanName)) {
            anly.categories.push(cleanName);
            anly.categories.sort();

            // 🚀 SURGICAL UI UPDATE: Manually inject the new category header row
            const tableBody = document.querySelector(".matrix-table tbody");
            if (tableBody) {
                const totalColspan = 2 + (anly.apps || []).length;
                const newRow = document.createElement('tr');
                newRow.className = "category-header-row";
                newRow.style.background = "rgba(255,255,255,0.03)";
                newRow.style.borderBottom = "1px solid var(--line)";
                newRow.innerHTML = `
                    <td colspan="${totalColspan}" style="padding: 10px 12px;">
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <span class="tiny muted">📁</span>
                            <span style="color: var(--accent); font-weight: bold; text-transform: uppercase;">
                                ${esc(cleanName)}
                            </span>
                        </div>
                    </td>
                `;
                // Append it to the end of the current feature list
                tableBody.appendChild(newRow);
            }

            OL.persist();
        }
        OL.closeModal();
    }
};

// 5. SCORE ANALYSIS
export function calculateAnalysisScore(app, features) {
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

export function updateAnalysisScore(anlyId, appId, featId, value, isMaster) {
    let score = parseFloat(value) || 0;
    if (score < 0) score = 0;
    if (score > 3) score = 3;

    const client = getActiveClient();
    const source = isMaster ? state.master.analyses : client?.projectData?.localAnalyses || [];
    const anly = source.find(a => a.id === anlyId);
    if (anly) {
        const appObj = anly.apps.find(a => a.appId === appId);
        if (appObj) {
            if (!appObj.scores) appObj.scores = {};
            appObj.scores[featId] = score;
            const newTotal = OL.calculateAnalysisScore(appObj, anly.features || []);
            const scorePill = document.querySelector(`[data-app-total="${appId}"]`);
            if (scorePill) {
                scorePill.innerText = newTotal;
                scorePill.className = `pill ${newTotal > 2.5 ? 'accent' : 'soft'}`;
            }
        }
    }
    OL.persist();
};

export function equalizeAnalysisWeights(anlyId, isMaster) {
    const client = getActiveClient();
    const source = isMaster ? state.master.analyses : (client?.projectData?.localAnalyses || []);
    const anly = source.find(a => a.id === anlyId);
    if (!anly || !anly.features || anly.features.length === 0) return;

    const activeCats = [...new Set(anly.features.map(f => f.category || "General"))];
    const weightPerCat = 100 / activeCats.length;
    anly.features.forEach(f => {
        const catFeatures = anly.features.filter(feat => (feat.category || "General") === (f.category || "General"));
        f.weight = parseFloat((weightPerCat / catFeatures.length).toFixed(2));
    });

    // Surgical UI update
    anly.features.forEach(f => {
        const inputs = document.querySelectorAll(`input[onblur*="'${f.id}'"][onblur*="'weight'"]`);
        inputs.forEach(input => input.value = f.weight);
    });

    OL.persist();
    console.log(`⚖️ Weights Balanced Surgically.`);
};

//======================= CONSOLIDATED FEATURES MANAGEMENT =======================//

export function getScopedAnalyses() {
    const isVault = window.location.hash.includes('vault');
    const client = getActiveClient();
    return isVault ? (state.master.analyses || []) : (client?.projectData?.localAnalyses || []);
};

// --- 1. GLOBAL CONTENT MANAGER ---
export function openGlobalContentManager() {
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
export function renderLibraryManagerRows(allFeats = []) {
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

export function filterLibraryManager(query) {
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

export async function updateLocalLibraryFeature(featId, property, newValue) {
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
export function editFeatureModal(anlyId, featId, isMaster) {
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
export function executeEditFeature(anlyId, featId, isMaster) {
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


// 4. MANAGE ADDING / EDITING FEATURES
export async function finalizeFeatureAddition(anlyId, featName, category, isMaster) {
    const analyses = OL.getScopedAnalyses();
    const anly = analyses.find(a => a.id === anlyId);
    if (!anly) return;

    const cleanName = featName.trim();
    const cleanCat  = category.trim() || "General";

    // 1. Check if already on this matrix
    const onMatrix = (anly.features || []).some(f => f.name.toLowerCase() === cleanName.toLowerCase());
    if (onMatrix) {
        alert(`🚫 "${cleanName}" is already in this analysis matrix.`);
        return;
    }

    // 2. Adopt standard capitalisation if found in global pool
    const allFeatures  = OL.getGlobalFeatures();
    const existingEntry = allFeatures.find(f => f.toLowerCase() === cleanName.toLowerCase());

    // 3. Mutate directly
    if (!anly.features) anly.features = [];
    anly.features.push({
        id: "feat-" + Date.now() + Math.random().toString(36).substr(2, 5),
        name: existingEntry || cleanName,
        category: cleanCat,
        weight: 10,
        description: ""
    });

    // 4. Fire and forget
    OL.persist();

    // 5. UI reset for rapid entry
    const nameInput = document.getElementById('feat-name-input');
    if (nameInput) { nameInput.value = ''; nameInput.focus(); }

    const results = document.getElementById('feat-search-results');
    if (results) { results.innerHTML = ''; results.style.display = 'none'; }

    OL.openAnalysisMatrix(anlyId, isMaster);
    console.log("✅ Feature synchronized.");
};

// 2. THE UI FLOW (The "Single Modal")
export function addFeatureToAnalysis(anlyId, isMaster) {
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

export function pushFeatureToVault(featName) {
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

export function renameFeatureCategory(anlyId, oldCatName, newCatName, isMaster) {
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

export function promoteToFunction(catName) {
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

export function demoteFromFunction(catName) {
  if (!confirm(`Demote "${catName}" back to a standard category?`)) return;

  state.master.functions = state.master.functions.filter(
    (f) => f.name !== catName,
  );

  OL.persist();
  OL.openGlobalContentManager();
};

export async function executeGlobalFeatureUpdate(originalName, isVaultMode) {
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

export function globalRenameContent(type, oldName, newName, forceNewCat = null) {
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

export function universalCategorySearch(query, type, targetElementId, extraParams = {}) {
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
export function getCategoryWeight(catName) {
    const coreLogic = ["GENERAL", "PRICING", "SECURITY", "ARCHITECTURE", "TEAM ACCESS"];
    const normalized = catName.toUpperCase();
    
    const index = coreLogic.indexOf(normalized);
    // If it's in our core list, return its position (0-4), otherwise return a high number
    return index !== -1 ? index : 99; 
};

export function handleCategorySelection(catName, type, params = {}) {
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


// ---- bridge: keep OL.*/window.* calls working until callers import directly ----
window.OL = window.OL || {};
Object.assign(window.OL, {
    universalCategorySearch, getCategoryWeight, handleCategorySelection,
    syncMatrixName, createNewMasterAnalysis, createNewAnalysisSandbox,
    deleteAnalysis, filterMasterAnalysisImport, importAnalysisFromVault,
    executeAnalysisImportById, pushMatrixToMasterLibrary, deleteMasterAnalysis,
    openAnalysisMatrix, updateAnalysisMeta, getCategorySortWeight,
    updateAnalysisNote, universalPrint, printScopingSheet, renameMatrix,
    calculateAppTotalCost, handleMatrixPricingChange, addAppTier,
    updateAppTier, removeAppTier, updateAppFeatAddonPrice,
    filterAnalysisAppSearch, addAppToAnalysis, executeAddAppToAnalysis,
    removeAppFromAnalysis, getGlobalCategories, getGlobalFeatures,
    filterContentManager, universalFeatureSearch, unifiedAddFlow,
    updateAnalysisFeature, syncFeatureChanges, promptFeatureCategory,
    removeFeatureFromAnalysis, openCategoryManagerModal,
    addAllFeaturesFromCategory, executeAddCategoryToAnalysis,
    calculateAnalysisScore, updateAnalysisScore, equalizeAnalysisWeights,
    getScopedAnalyses, openGlobalContentManager, renderLibraryManagerRows,
    filterLibraryManager, updateLocalLibraryFeature, editFeatureModal,
    renderAnalysisCard, renderAnalysisMatrixRows
});
// Called bare from sections still living in app.js — bridge onto window.
window.renderAnalysisModule = renderAnalysisModule;
