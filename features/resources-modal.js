//======================= FEATURES / RESOURCES MODAL =======================//
// Extracted from app.js "RESOURCE CARD AND MODAL".
// Owns: the resource detail modal — the biggest single piece of the app
// (hierarchy tree, email template editor, file containers, edit history,
// signature linking, master push/import, universal delete) — plus the
// vault rates page, which was tucked in at the tail of this section in
// the original file.
// Companion to features/resources-grid.js (see that file's header note
// about the circular renderResourceManager <-> renderResourceCard calls).

import { state, esc, uid, getActiveClient, persist } from '../core/data.js';

export function renderResourceCard(res) {
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
             style="${scopeData ? `border-left: 4px solid ${statusColor} !important;` : ''} opacity:${res.isArchived ? '0.5' : '1'};">
            
            <div class="card-header" style="display:flex; justify-content: space-between; align-items: flex-start;">
                <div class="card-title" style="flex:1; font-weight:600;">${esc(res.name || "Unnamed")}</div>
                
                <div class="card-controls" style="display:flex; align-items:center; gap:6px;">
                        ${numberingHtml}
                        
                        <span class="vault-tag" style="${tagStyle} padding: 2px 6px; font-size: 8px; border-radius: 3px; font-weight: bold;">
                            ${isMaster ? 'MASTER' : 'LOCAL'}
                        </span>
                        ${res.isArchived ? `<span style="font-size:8px;font-weight:700;padding:2px 6px;border-radius:3px;background:rgba(239,68,68,0.1);color:#ef4444;border:1px solid rgba(239,68,68,0.3);">📦 Archived</span>` : ''}
                        <button class="card-delete-btn" 
                                onclick="event.stopPropagation(); OL.handleResourceSave('${res.id}', 'isArchived', ${!res.isArchived}); renderResourceManager();"
                                title="${res.isArchived ? 'Unarchive' : 'Archive'}"
                                style="color:${res.isArchived ? '#ef4444' : 'var(--text-muted)'};">
                            <i data-lucide="archive" style="width:12px;height:12px;"></i>
                        </button>
                        ${res.isLocked ? '' : `<button class="card-delete-btn" onclick="event.stopPropagation(); OL.universalDelete('${res.id}', 'resources')">×</button>`}
                    </div>            
                </div>
            <div class="card-body" style="margin-top: 6px;">
                <div style="display:flex; justify-content:space-between; align-items:flex-end;">
                    <div>
                        <div class="tiny accent bold uppercase" style="font-size: 8px; letter-spacing: 0.5px; opacity: 0.8;">
                            ${esc(res.archetype || "Base")}
                        </div>
                        <div class="tiny muted" style="font-size:10px; opacity:0.6; display:flex; align-items:center; gap:4px;">
                            ${OL.getLucideSVG(OL.getRegistryIcon(res.type), 11, 'currentColor')}
                            ${esc(res.type || 'General')}
                        </div>
                    </div>

                    ${scopeData ? `
                    <div style="display:flex; flex-direction:column; align-items:flex-end; gap:3px;">
                        <div class="pill tiny" style="background:${statusColor}22; color:${statusColor}; border:1px solid ${statusColor}44; font-size:8px; font-weight:bold; padding: 1px 5px;">
                            ${(scopeData.status || "PENDING").toUpperCase()}
                        </div>
                        <div class="tiny muted bold" style="font-size: 8px; opacity: 0.5; display:flex; align-items:center; gap:3px;">
                            <i data-lucide="user" style="width:9px; height:9px;"></i>
                            ${esc(scopeData.responsibleParty || 'TBD')}
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
export function selectResourceCard(resId) {
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
export function updateResourceMeta(resId, key, value) {
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

export function handleResourceHeaderBlur(id, name) {
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

export async function handleModalSave(id, nameOrContext) {
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
export async function commitDraftToSystem(tempId, finalName, context, integrationData = null) {
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

export function getDraftById(id) {
    // This finds the draft object currently held in the modal's internal state
    // If you are using a global draft variable or passing it through, ensure it's accessible.
    // Most simply, we can check the active modal box dataset:
    const box = document.getElementById('active-modal-box');
    return box ? JSON.parse(box.dataset.draftSource || '{}') : null;
};

export function getResourceById(id) {
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
export function openResourceModal(targetId, draftObj = null) {
    console.trace('🚨 openResourceModal called:', targetId);
    if (!state.v2) state.v2 = {}; 
    if (!state.v2.activeCommentTab) state.v2.activeCommentTab = 'internal';
    if (!targetId) return;

    const isAdmin = state.adminMode || window.FORCE_ADMIN;
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
              style="display:flex; align-items:center; gap:4px; font-size: 9px; padding: 2px 8px; border-radius: 100px; text-transform: uppercase; font-weight: 700; border: 1px solid rgba(255,255,255,0.1);">
            <i data-lucide="${isAlreadyMaster ? 'shield-check' : 'map-pin'}" style="width:10px; height:10px;"></i>
            ${isAlreadyMaster ? 'Master' : 'Local' }
        </span>`;
    
    const typePill = `
        <div style="position: relative; display: inline-block;">
            <span class="pill tiny soft is-clickable" 
                  onclick="document.getElementById('res-type-selector').click()"
                  style="display:flex; align-items:center; gap:4px; font-size: 9px; padding: 2px 8px; border-radius: 100px; text-transform: uppercase; cursor: pointer; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2);">
                <i data-lucide="${OL.getRegistryIcon(res.type)}" style="width:10px; height:10px;"></i>
                ${esc(res.type || 'General')} <i data-lucide="chevron-down" style="width:10px; height:10px;"></i>
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
        <div style="display:flex;align-items:center;justify-content:space-between;
                    padding:10px 14px;border:1px solid var(--line);border-radius:8px;margin-bottom:16px;">
            <label class="modal-section-label" style="margin:0;display:flex;align-items:center;gap:6px;">
                <i data-lucide="smartphone" style="width:12px;height:12px;"></i> PRIMARY APPLICATION
                ${isManualOverride ? '<span class="tiny accent bold" style="font-size:8px;margin-left:6px;">CUSTOM OVERRIDE</span>' : ''}
            </label>
            <div style="display:flex;align-items:center;gap:8px;">
                ${isZap ? `
                    <span class="pill soft tiny muted" style="display:flex;align-items:center;gap:4px;">
                        <i data-lucide="zap" style="width:10px;height:10px;"></i> Multi-App
                    </span>
                ` : res.appId ? `
                    <span class="pill ${isManualOverride ? 'accent' : 'primary'}" style="display:flex;align-items:center;gap:6px;">
                        <i data-lucide="${isManualOverride ? 'edit-3' : 'bot'}" style="width:11px;height:11px;"></i>
                        ${esc(res.appName)}
                        <i data-lucide="x" class="is-clickable" style="width:11px;height:11px;opacity:0.5;"
                           onclick="OL.handleResourceSave('${res.id}','appId',null);OL.handleResourceSave('${res.id}','appName',null);OL.openResourceModal('${res.id}')"></i>
                    </span>
                ` : `
                    <div style="position:relative;">
                        <input type="text" class="modal-input tiny" style="width:180px;" placeholder="Search apps..."
                               onfocus="OL.filterAppSearch('${res.id}',null,true,'')"
                               oninput="OL.filterAppSearch('${res.id}',null,true,this.value)">
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
    
    const resType = (res.type || "General").toLowerCase();

    // --- 🗓️ SECTION: WORKFLOW PHASE ---
    const hash = window.location.hash;
    const isScopingSheet = hash.includes('scoping-sheet');
    const activeId = lineItem ? lineItem.id : targetId;
    const currentRound = lineItem ? (lineItem.round || 1) : 1;
    const scopeData = OL.getScopingDataForResource(res.id);
    const scopeAndRoundHtml = ((lineItem || isScopingSheet) || scopeData) ? `
        <div class="card-section" style="margin-bottom:20px;background:rgba(var(--accent-rgb),0.05);
                                          border:1px solid var(--accent);padding:12px 16px;border-radius:8px;">
            <div style="display:flex;align-items:flex-end;gap:12px;flex-wrap:wrap;">
                ${(lineItem || isScopingSheet) ? `
                    <div style="display:flex;flex-direction:column;gap:2px;">
                        <label style="font-size:10px;color:var(--text-muted);text-transform:uppercase;font-weight:700;">Round / Phase</label>
                        <input type="number" class="modal-input tiny" style="width:70px;"
                               value="${currentRound}" min="1"
                               onchange="OL.updateLineItem('${activeId}', 'round', this.value)">
                    </div>
                ` : ''}
                ${scopeData ? `
                    <div style="display:flex;flex-direction:column;gap:2px;">
                        <label style="font-size:10px;color:var(--text-muted);text-transform:uppercase;font-weight:700;">Scoping Status</label>
                        <select class="modal-input tiny" style="width:auto;"
                                onchange="OL.updateLineItem('${scopeData.id}', 'status', this.value)">
                            ${['Do Now','Do Later',"Don't Do",'Done'].map(s => `
                                <option value="${s}" ${scopeData.status === s ? 'selected' : ''}>${s}</option>
                            `).join('')}
                        </select>
                    </div>
                    <div style="display:flex;flex-direction:column;gap:2px;">
                        <label style="font-size:10px;color:var(--text-muted);text-transform:uppercase;font-weight:700;">Responsible Party</label>
                        <select class="modal-input tiny" style="width:auto;"
                                onchange="OL.updateLineItem('${scopeData.id}', 'responsibleParty', this.value)">
                            <option value="Sphynx" ${scopeData.responsibleParty === 'Sphynx' ? 'selected' : ''}>Sphynx</option>
                            <option value="Client" ${scopeData.responsibleParty === 'Client' ? 'selected' : ''}>Client</option>
                            <option value="Joint" ${scopeData.responsibleParty === 'Joint' ? 'selected' : ''}>Joint</option>
                        </select>
                    </div>
                ` : ''}
            </div>
        </div>
    ` : '';

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
       const isLogicVar = v.label?.toLowerCase().includes('logic');

        let displayVal = num(activeData.data?.[varKey]);
        let inputProps = "";
        let badge = "";

        if (isZap && isStepVar) {
            const allSteps = projectRes.steps || [];
            const actualStepCount = allSteps.filter((s, idx) => {
                if (idx === 0) return true; // always count first step (trigger)
                const assignees = s.assignees || [];
                const hasHumanAssignee = assignees.some(a => 
                    a.type === 'person' || a.type === 'role'
                );
                if (!hasHumanAssignee) return true; // no human assignee — count it
                // Has human assignee — only count if app is Zapier Approval
                const appName = (s.appName || '').toLowerCase();
                return appName.includes('zapier approval');
            }).length;
        
            displayVal = actualStepCount;
            inputProps = "readonly style='background:rgba(255,159,67,0.1);color:#ff9f43;border-color:#ff9f43;cursor:not-allowed;'";
            badge = `<span style="color:#ff9f43;font-size:9px;margin-left:5px;font-weight:bold;">⚡ AUTO</span>`;
        
            if (num(activeData.data?.[varKey]) !== actualStepCount) {
                if (!activeData.data) activeData.data = {};
                activeData.data[varKey] = actualStepCount;
                OL.updateResourcePricingData(activeData.id, varKey, actualStepCount);
            }
        }

       if (isLogicVar) {
            const actualLogicCount = (projectRes.steps || []).reduce((acc, s) => {
                return acc + (s.logic?.out || []).filter(l => {
                    if (!l.targetId) return false;
                    const types = l.types || [l.type || 'next'];
                    // Count any rule that has at least one non-next type
                    return types.some(t => t !== 'next');
                }).length;
            }, 0);
            displayVal = actualLogicCount;
            inputProps = "readonly style='background:rgba(255,159,67,0.1);color:#ff9f43;border-color:#ff9f43;cursor:not-allowed;'";
            badge = `<span style="color:#ff9f43;font-size:9px;margin-left:5px;font-weight:bold;">⚡ AUTO</span>`;
        
            if (num(activeData.data?.[varKey]) !== actualLogicCount) {
                if (!activeData.data) activeData.data = {};
                activeData.data[varKey] = actualLogicCount;
                OL.updateResourcePricingData(activeData.id, varKey, actualLogicCount);
            }
        }

        return `
             <div style="display:flex;flex-direction:column;gap:2px;">
                <label style="font-size:10px;color:var(--text-muted);">${esc(v.label)}${badge}</label>
                <input type="number" class="modal-input tiny" 
                    value="${displayVal}" 
                    ${inputProps}
                    oninput="OL.updateResourcePricingData('${activeData.id}', '${varKey}', this.value)">
                <span style="font-size:9px;color:var(--text-muted);">$${v.value} each</span>
            </div>`;
    }).join("");

    // 🚀 FORCE VISIBLE FOR TESTING: Remove "isAdmin &&" to show regardless of permissions
    // --- 📊 SECTION: ADMIN PRICING ---
    const adminPricingHtml = (isAdmin && relevantVars?.length > 0) ? `
        <div class="card-section" style="margin-bottom: 20px; padding: 15px; background: rgba(255,255,255,0.02); border: 1px solid var(--line); border-radius: 8px; display:block !important;">
            <label class="modal-section-label" style="display:flex; align-items:center; gap:6px;">
                <i data-lucide="settings" style="width:14px; height:14px;"></i> PRICING CONFIG
            </label>
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px; margin-top:10px;">
                ${pricingRows}
            </div>
        </div>` : '';
    
    // --- 📖 SECTION: LINKED MASTER GUIDES ---
    const linkedSOPs = (state.master.howToLibrary || []).filter(ht => 
        (ht.resourceIds || []).includes(res.masterRefId || res.id)
    );
    
    const sopLibraryHtml = `
        <div class="card-section" style="margin-bottom:20px;">
            <label class="modal-section-label" style="display:flex; align-items:center; gap:6px;">
                <i data-lucide="library" style="width:14px; height:14px;"></i> LINKED MASTER GUIDES
            </label>
            <div style="display:flex; flex-wrap:wrap; gap:8px; margin-top:10px;">
                ${linkedSOPs.length > 0 ? linkedSOPs.map(sop => `
                    <span class="pill soft tiny" style="display:flex; align-items:center; gap:4px;">
                        <i data-lucide="book-open" style="width:10px; height:10px;"></i> 
                        ${esc(sop.name)}
                    </span>`).join("") : `
                    <span class="tiny muted" style="display:flex; align-items:center; gap:4px;">
                        <i data-lucide="info" style="width:12px; height:12px; opacity:0.5;"></i>
                        No guides linked to this resource template.
                    </span>`}
            </div>
        </div>`;

const dependencyHtml = `
    <div class="card-section" style="margin-top:20px; border-top: 1px solid var(--line); padding-top:15px;">
        <label class="modal-section-label" style="display:flex; align-items:center; gap:6px;">
            <i data-lucide="list-checks" style="width:14px; height:14px;"></i> TASK DEPENDENCIES (PROJECT-SPECIFIC)
        </label>
        <div class="dp-manager-list" id="task-dependency-list">
            ${taskDeps.map((dep, idx) => renderDependencyRow(dep, res.id)).join('') || '<div class="tiny muted p-10">No tasks linked.</div>'}
        </div>
        <div class="search-map-container" style="margin-top:8px; position:relative; display:flex; align-items:center;">
            <i data-lucide="search" style="position:absolute; left:10px; width:12px; height:12px; opacity:0.4;"></i>
            <input type="text" class="modal-input tiny" style="padding-left:30px;" placeholder="Search or Create Task..." 
                   onfocus="OL.filterDependencySearch('${res.id}', 'task', '')"
                   oninput="OL.filterDependencySearch('${res.id}', 'task', this.value)">
            <div id="task-dep-results" class="search-results-overlay"></div>
        </div>
    </div>

    <div class="card-section" style="margin-top:20px; border-top: 1px solid var(--line); padding-top:15px;">
        <label class="modal-section-label" style="display:flex; align-items:center; gap:6px;">
            <i data-lucide="layers" style="width:14px; height:14px;"></i> RESOURCE DEPENDENCIES (INFRASTRUCTURE)
        </label>
        <div class="dp-manager-list" id="res-dependency-list">
            ${resDeps.map((dep, idx) => renderDependencyRow(dep, res.id)).join('') || '<div class="tiny muted p-10">No resources linked.</div>'}
        </div>
        <div class="search-map-container" style="margin-top:8px; position:relative; display:flex; align-items:center;">
            <i data-lucide="search" style="position:absolute; left:10px; width:12px; height:12px; opacity:0.4;"></i>
            <input type="text" class="modal-input tiny" style="padding-left:30px;" placeholder="Search Project Library..." 
                   onfocus="OL.filterDependencySearch('${res.id}', 'resource', '')"
                   oninput="OL.filterDependencySearch('${res.id}', 'resource', this.value)">
            <div id="res-dep-results" class="search-results-overlay"></div>
        </div>
    </div>
`;

  //------- SCOPING STATUS ---------//

  // Inside OL.openResourceModal...
  const activeTab = state.v2?.activeCommentTab || 'internal';
  const isGuest = !!window.IS_GUEST;
  const showPricing = state.v2?.showPricing || false;

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
                <label class="modal-section-label" style="display:flex; align-items:center; gap:6px;">
                    <i data-lucide="files" style="width:14px; height:14px;"></i> DOCUMENT COLLECTION
                </label>
                <div id="file-list-container" style="display:flex; flex-direction:column; gap:10px; margin-top:10px;">
                    ${(res.files || []).map((file, idx) => `
                        <div class="file-row" style="display:flex; align-items:center; gap:10px; padding:10px; background:rgba(0,0,0,0.2); border-radius:6px; border: 1px solid rgba(255,255,255,0.05);">
                            <div style="flex: 1; display:flex; align-items:center; gap:8px;">
                                <i data-lucide="file" style="width:12px; height:12px; opacity:0.5;"></i>
                                <input type="text" class="modal-input tiny" value="${esc(file.name)}" 
                                      style="font-weight:bold; border:none; background:transparent; padding:0; width:100%;"
                                      onblur="OL.updateContainerFile('${res.id}', ${idx}, 'name', this.value)">
                            </div>
                            
                            <div style="flex: 2; display:flex; align-items:center; gap:8px;">
                                <input type="text" class="modal-input tiny" placeholder="Paste link or URL..." 
                                      value="${esc(file.url || '')}" 
                                      onblur="OL.updateContainerFile('${res.id}', ${idx}, 'url', this.value)">
                                
                                ${file.url ? `
                                    <a href="${file.url}" target="_blank" class="btn primary tiny" style="height:24px; width:30px; display:flex; align-items:center; justify-content:center;">
                                        <i data-lucide="external-link" style="width:12px; height:12px;"></i>
                                    </a>
                                ` : `
                                    <button class="btn tiny soft" style="height:24px; width:30px; display:flex; align-items:center; justify-content:center;" 
                                            onclick="OL.simulateUpload('${res.id}', ${idx})" title="Upload File">
                                        <i data-lucide="upload-cloud" style="width:12px; height:12px;"></i>
                                    </button>
                                `}
                            </div>
                            <button class="card-delete-btn" style="position:static; opacity:0.5;" onclick="OL.removeFileFromContainer('${res.id}', ${idx})">
                                <i data-lucide="x" style="width:14px; height:14px;"></i>
                            </button>
                        </div>
                    `).join('')}
                </div>
                <button class="btn tiny soft full-width" style="margin-top:10px; border-style:dashed; display:flex; align-items:center; justify-content:center; gap:6px;" 
                        onclick="OL.addFileToContainer('${res.id}')">
                    <i data-lucide="plus" style="width:14px; height:14px;"></i> Add Document Entry
                </button>
            </div>
        `;
    }
    // --- 🚀 FINAL ASSEMBLY ---
    let bodyContent = "";
    if (resType === "email" || resType === "email template") {
         bodyContent = `
                ${appMappingHtml}
        
                <!-- DESCRIPTION - half height -->
                <div class="card-section" style="margin-bottom:16px;">
                    <label class="modal-section-label">Description & Access Notes</label>
                    <textarea class="modal-textarea"
                              style="min-height:48px;max-height:60px;resize:none;"
                              placeholder="Enter login details, account purpose, or specific access instructions..."
                              onblur="OL.handleResourceSave('${res.id}', 'description', this.value)">${esc(res.description || '')}</textarea>
                </div>
        
                <!-- EMAIL COMPOSITION -->
                <div class="card-section" style="margin-bottom:16px;background:rgba(255,255,255,0.02);padding:15px;border-radius:8px;border:1px solid var(--line);">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:15px;">
                        <label class="modal-section-label" style="display:flex;align-items:center;gap:6px;color:var(--accent);margin:0;">
                            <i data-lucide="mail" style="width:14px;height:14px;"></i> EMAIL COMPOSITION
                        </label>
                        <button class="btn tiny primary" onclick="OL.previewEmailTemplate('${res.id}')">
                            <i data-lucide="eye" style="width:12px;height:12px;margin-right:4px;"></i> Preview
                        </button>
                    </div>
        
                    <!-- FROM + TO on one line -->
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
                        <div>
                            <label class="tiny muted bold" style="display:flex;align-items:center;gap:4px;margin-bottom:4px;">
                                <i data-lucide="user-round" style="width:10px;height:10px;"></i> FROM
                            </label>
                            <select class="modal-input tiny" onchange="OL.handleResourceSave('${res.id}', 'emailFrom', this.value)">
                                <option value="">Select Sender...</option>
                                ${(client?.projectData?.teamMembers || []).map(m => `
                                    <option value="${m.id}" ${res.emailFrom === m.id ? 'selected' : ''}>${esc(m.name)}</option>
                                `).join('')}
                            </select>
                        </div>
                        <div>
                            <label class="tiny muted bold" style="display:flex;align-items:center;gap:4px;margin-bottom:4px;">
                                <i data-lucide="users" style="width:10px;height:10px;"></i> TO
                            </label>
                            <select class="modal-input tiny" onchange="OL.handleResourceSave('${res.id}', 'emailToType', this.value)">
                                <option value="">Select Recipient...</option>
                                <option value="Household" ${res.emailToType === 'Household' ? 'selected' : ''}>Household</option>
                                <option value="Client 1" ${res.emailToType === 'Client 1' ? 'selected' : ''}>Client 1</option>
                                <option value="Client 2" ${res.emailToType === 'Client 2' ? 'selected' : ''}>Client 2</option>
                                <option value="COI" ${res.emailToType === 'COI' ? 'selected' : ''}>COI (Professional)</option>
                            </select>
                        </div>
                    </div>
        
                    <!-- SUBJECT full width -->
                    <div style="margin-bottom:12px;">
                        <label class="tiny muted bold" style="display:block;margin-bottom:4px;">SUBJECT LINE</label>
                        <input type="text" class="modal-input" style="width:100%;"
                               placeholder="Enter email subject..."
                               value="${esc(res.emailSubject || '')}"
                               onblur="OL.handleResourceSave('${res.id}', 'emailSubject', this.value)">
                    </div>
        
                     <!-- BODY - preview by default, edit toggle -->
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                        <label class="tiny muted bold">EMAIL BODY</label>
                        <div style="display:flex;gap:6px;align-items:center;">
                            <!-- Data Tags picker -->
                            <div style="position:relative;">
                                <button class="btn tiny soft" id="data-tags-btn-${res.id}" 
                                        style="display:none;"
                                        onmousedown="event.preventDefault();"
                                        onclick="event.stopPropagation(); const m=document.getElementById('data-tag-menu-${res.id}'); 
                                                m.style.display=m.style.display==='none'?'block':'none';">
                                    <i data-lucide="tag" style="width:10px;height:10px;margin-right:4px;"></i> Data Tags ▾
                                </button>
                                <div id="data-tag-menu-${res.id}"
                                     onmousedown="event.preventDefault();"
                                     style="display:none;position:absolute;right:0;top:calc(100% + 4px);
                                            background:var(--panel);border:1px solid var(--panel-border);
                                            border-radius:8px;padding:4px;z-index:51;min-width:200px;max-height:220px;
                                            overflow-y:auto;box-shadow:0 4px 12px rgba(0,0,0,0.3);">
                                    ${Object.entries(
                                        (client?.projectData?.localDatapoints?.length ? client.projectData.localDatapoints : state.master.datapoints || []).reduce((groups, dp) => {
                                            (groups[dp.category] = groups[dp.category] || []).push(dp);
                                            return groups;
                                        }, {})
                                    ).map(([cat, tags]) => `
                                        <div style="padding:4px 8px;font-size:9px;font-weight:700;color:var(--text-dim);
                                                    text-transform:uppercase;letter-spacing:0.05em;margin-top:4px;">
                                            ${cat}
                                        </div>
                                        ${tags.map(dp => `
                                            <div onmousedown="event.preventDefault();
                                                             OL._geInsertDataTag('${res.id}', '${dp.key}');
                                                             setTimeout(function(){ document.getElementById('data-tag-menu-${res.id}').style.display='none'; }, 50);"
                                                 style="padding:7px 12px;cursor:pointer;font-size:11px;border-radius:6px;
                                                        display:flex;justify-content:space-between;align-items:center;"
                                                 onmouseover="this.style.background='var(--panel-soft)'"
                                                 onmouseout="this.style.background='transparent'">
                                                <span>${dp.name}</span>
                                                <code style="font-size:9px;opacity:0.5;background:rgba(255,255,255,0.05);
                                                             padding:1px 5px;border-radius:3px;">${dp.key}</code>
                                            </div>
                                        `).join('')}
                                    `).join('')}
                                </div>
                                <!-- Resource Links picker -->
                                <div style="position:relative;">
                                    <button class="btn tiny soft" id="res-tags-btn-${res.id}" 
                                            style="display:none;"
                                            onmousedown="event.preventDefault();"
                                            onclick="event.stopPropagation(); const m=document.getElementById('res-tag-menu-${res.id}'); m.style.display=m.style.display==='none'?'block':'none';">
                                        <i data-lucide="link" style="width:10px;height:10px;margin-right:4px;"></i> Resources ▾
                                    </button>
                                    <div id="res-tag-menu-${res.id}"
                                         onmousedown="event.preventDefault();"
                                         style="display:none;position:absolute;right:0;top:calc(100% + 4px);
                                                background:var(--panel);border:1px solid var(--panel-border);
                                                border-radius:8px;padding:4px;z-index:51;min-width:220px;max-height:220px;
                                                overflow-y:auto;box-shadow:0 4px 12px rgba(0,0,0,0.3);">
                                        ${OL.getResourceDatapoints().map(dp => `
                                            <div onmousedown="event.preventDefault();
                                                             OL._geInsertDataTag('${res.id}', '${dp.key}');
                                                             setTimeout(function(){ document.getElementById('res-tag-menu-${res.id}').style.display='none'; }, 50);"
                                                 style="padding:7px 12px;cursor:pointer;font-size:11px;border-radius:6px;
                                                        display:flex;justify-content:space-between;align-items:center;"
                                                 onmouseover="this.style.background='var(--panel-soft)'"
                                                 onmouseout="this.style.background='transparent'">
                                                <span style="display:flex;align-items:center;gap:6px;">
                                                    <i data-lucide="link" style="width:10px;height:10px;opacity:0.5;"></i>
                                                    ${dp.name}
                                                </span>
                                                <code style="font-size:9px;opacity:0.5;background:rgba(255,255,255,0.05);
                                                             padding:1px 5px;border-radius:3px;">${dp.key}</code>
                                            </div>
                                        `).join('')}
                                    </div>
                                </div>
                            </div>
                    
                            <!-- Edit button -->
                            <div style="position:relative;">
                                <button class="btn tiny soft" id="email-edit-btn-${res.id}"
                                        onclick="document.getElementById('email-edit-menu-${res.id}').style.display='block'">
                                    <i data-lucide="pencil" style="width:10px;height:10px;margin-right:4px;"></i> Edit ▾
                                </button>
                                <div id="email-edit-menu-${res.id}"
                                     style="display:none;position:absolute;right:0;top:calc(100% + 4px);
                                            background:var(--panel);border:1px solid var(--panel-border);
                                            border-radius:8px;padding:4px;z-index:50;min-width:140px;
                                            box-shadow:0 4px 12px rgba(0,0,0,0.3);">
                                    <div onmousedown="event.preventDefault();
                                                     document.getElementById('email-edit-menu-${res.id}').style.display='none';
                                                     OL._geToggleEmailBody('${res.id}', 'plain')"
                                         style="padding:8px 12px;cursor:pointer;font-size:11px;border-radius:6px;"
                                         onmouseover="this.style.background='var(--panel-soft)'"
                                         onmouseout="this.style.background='transparent'">
                                        <i data-lucide="code" style="width:11px;height:11px;margin-right:6px;"></i>Edit as HTML
                                    </div>
                                    <div onmousedown="event.preventDefault();
                                                     document.getElementById('email-edit-menu-${res.id}').style.display='none';
                                                     OL._geToggleEmailBody('${res.id}', 'rich')"
                                         style="padding:8px 12px;cursor:pointer;font-size:11px;border-radius:6px;"
                                         onmouseover="this.style.background='var(--panel-soft)'"
                                         onmouseout="this.style.background='transparent'">
                                        <i data-lucide="type" style="width:11px;height:11px;margin-right:6px;"></i>Edit as Rich Text
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Body preview + editor -->
                    <div id="email-body-preview-${res.id}"
                         style="background:rgba(0,0,0,0.15);border:1px solid var(--line);border-radius:6px;
                                padding:12px;font-size:12px;line-height:1.6;color:var(--text-main);
                                min-height:80px;">
                        ${OL._geRenderEmailPreview(res.emailBody || '', [
                            ...(client?.projectData?.localDatapoints?.length 
                                ? client.projectData.localDatapoints 
                                : (state.master.datapoints || [])),
                            ...OL.getResourceDatapoints()
                        ], client)}
                    </div>
                    <textarea id="email-body-edit-${res.id}"
                              class="modal-textarea"
                              style="display:none;min-height:160px;"
                              placeholder="Write email body...">${esc(res.emailBody || '')}</textarea>
                    <button id="email-body-done-${res.id}"
                            style="display:none;margin-top:8px;"
                            class="btn tiny soft"
                            onclick="const ed=document.getElementById('email-body-edit-${res.id}');
                                     const ri=document.getElementById('email-body-rich-${res.id}');
                                     const val=ri&&ri.style.display!=='none'?ri.innerHTML:ed.value;
                                     OL._geSaveEmailBody('${res.id}', val);">
                        ✓ Done Editing
                    </button>
                </div>
                <!-- CONNECTED RELATIONSHIPS -->
                <div class="card-section" style="margin-bottom:16px;">
                    <label class="modal-section-label">
                        <i data-lucide="share-2" style="width:14px;height:14px;"></i> Connected Relationships
                    </label>
                    <div style="display:flex;gap:5px;margin:8px 0;overflow-x:auto;padding-bottom:5px;">
                        ${['All',...new Set(allConnections.map(c=>c.type))].map(t => `
                            <span onclick="state.ui.relationshipFilter='${t}';OL.openResourceModal('${targetId}')"
                                  style="font-size:9px;padding:2px 8px;border-radius:100px;cursor:pointer;white-space:nowrap;
                                         background:${activeFilter===t?'var(--accent)':'rgba(255,255,255,0.05)'};
                                         color:${activeFilter===t?'#000':'#94a3b8'};
                                         border:1px solid rgba(255,255,255,0.1);">
                                ${t.toUpperCase()}
                            </span>
                        `).join('')}
                    </div>
                    <div style="display:flex;flex-direction:column;gap:6px;">
                        ${filteredConnections.length > 0 ? filteredConnections.map(conn => `
                            <div class="pill accent is-clickable"
                                 style="display:flex;align-items:center;justify-content:space-between;
                                        background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.1);
                                        cursor:pointer;padding:8px 12px;border-radius:8px;"
                                 onmousedown="event.preventDefault();event.stopPropagation();if(OL.closeModal)OL.closeModal();OL.openInspector('${conn.id}')">
                                <div style="display:flex;align-items:center;gap:8px;pointer-events:none;">
                                    ${OL.getLucideSVG(OL.getRegistryIcon(conn.type),14,'var(--accent)')}
                                    <div>
                                        <div style="font-size:11px;color:#eee;">${esc(conn.name)}</div>
                                        <div style="font-size:8px;color:var(--accent);">${conn.type.toUpperCase()}</div>
                                    </div>
                                </div>
                                <span style="font-size:9px;opacity:0.5;pointer-events:none;">Inspect →</span>
                            </div>
                        `).join('') : `<div class="tiny muted" style="padding:10px;text-align:center;">No connections found.</div>`}
                    </div>
                </div>
        
                <!-- TASK DEPENDENCIES -->
                <div class="card-section" style="margin-top:16px;border-top:1px solid var(--line);padding-top:15px;">
                    <label class="modal-section-label" style="display:flex;align-items:center;gap:6px;">
                        <i data-lucide="list-checks" style="width:14px;height:14px;"></i> TASK DEPENDENCIES
                    </label>
                    <div class="dp-manager-list" id="task-dependency-list">
                        ${taskDeps.map(dep => renderDependencyRow(dep, res.id)).join('') || '<div class="tiny muted p-10">No tasks linked.</div>'}
                    </div>
                    <div class="search-map-container" style="margin-top:8px;position:relative;display:flex;align-items:center;">
                        <i data-lucide="search" style="position:absolute;left:10px;width:12px;height:12px;opacity:0.4;"></i>
                        <input type="text" class="modal-input tiny" style="padding-left:30px;" placeholder="Search or Create Task..."
                               onfocus="OL.filterDependencySearch('${res.id}', 'task', '')"
                               oninput="OL.filterDependencySearch('${res.id}', 'task', this.value)">
                        <div id="task-dep-results" class="search-results-overlay"></div>
                    </div>
                </div>
        
                <!-- LINKED MASTER GUIDES -->
                <div class="card-section" style="margin-top:16px;">
                    <label class="modal-section-label">
                        <i data-lucide="library" style="width:14px;height:14px;"></i> LINKED MASTER GUIDES
                    </label>
                    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;">
                        ${linkedSOPs.length > 0 ? linkedSOPs.map(sop => `
                            <span class="pill soft tiny" style="display:flex;align-items:center;gap:4px;">
                                <i data-lucide="book-open" style="width:10px;height:10px;"></i>
                                ${esc(sop.name)}
                            </span>`).join('') : `
                            <span class="tiny muted">No guides linked to this resource.</span>`}
                    </div>
                </div>
            `;
    }
    else if (isHierarchy) {
        // --- MODE A: DRAGGABLE HIERARCHY HUB ---
        if (!res.tree) res.tree = [{ id: uid(), name: "Clients", children: [] }];
    
        bodyContent = `
            <div class="card-section" style="background: rgba(255,255,255,0.02); padding: 20px; border-radius: 8px; border: 1px solid var(--line);">
                <label class="modal-section-label" style="color: var(--accent); display:flex; align-items:center; gap:8px;">
                    <i data-lucide="sitemap" style="width:16px; height:16px;"></i> FOLDER ARCHITECTURE
                </label>
                <p class="tiny muted" style="margin-bottom: 15px;">Drag handles <i data-lucide="grip-vertical" style="width:12px; height:12px; vertical-align:middle; opacity:0.5;"></i> to reorder. Root 'Clients' is protected.</p>
                
                <div id="hierarchy-tree-root" class="hierarchy-container">
                    ${OL.renderHierarchyTree(res.id, res.tree)}
                </div>
                
                <div style="margin-top: 20px; padding-top: 15px; border-top: 1px solid var(--line);">
                    <button class="btn tiny primary" style="display:flex; align-items:center; gap:6px;" onclick="OL.addFolderNode('${res.id}')">
                        <i data-lucide="folder-plus" style="width:14px; height:14px;"></i> Add Root Folder
                    </button>
                </div>
            </div>
        `;
    }
    else if (isCompliance) {
        // --- MODE B: COMPLIANCE DOCS ---
        bodyContent = `
            <div class="card-section" style="margin-top:10px; background: rgba(255,255,255,0.02); padding: 20px; border-radius: 8px; border: 1px solid var(--line);">
                <label class="modal-section-label" style="display:flex; align-items:center; gap:8px;">
                    <i data-lucide="files" style="width:16px; height:16px;"></i> DOCUMENT COLLECTION
                </label>
                <div id="file-list-container" style="display:flex; flex-direction:column; gap:10px; margin-top:10px;">
                    ${(res.files || []).map((file, idx) => `
                        <div class="file-row" style="display:flex; align-items:center; gap:10px; padding:10px; background:rgba(0,0,0,0.2); border-radius:6px; border: 1px solid rgba(255,255,255,0.05);">
                            <div style="flex: 1.5; display:flex; align-items:center; gap:8px;">
                                <i data-lucide="file-check" style="width:14px; height:14px; color:var(--accent); opacity:0.6;"></i>
                                <input type="text" class="modal-input tiny" value="${esc(file.name)}" 
                                       style="font-weight:bold; border:none; background:transparent; padding:0; color:var(--accent); width:100%;"
                                       onblur="OL.updateContainerFile('${res.id}', ${idx}, 'name', this.value)">
                            </div>
                            <div style="flex: 2.5; display:flex; align-items:center; gap:5px;">
                                <input type="text" class="modal-input tiny" placeholder="Paste link or URL..." 
                                       value="${esc(file.url || '')}" 
                                       onblur="OL.updateContainerFile('${res.id}', ${idx}, 'url', this.value)">
                                ${file.url ? `
                                    <a href="${file.url}" target="_blank" class="btn primary tiny" style="padding:0 12px; height: 32px; display:flex; align-items:center; gap:6px; background:var(--accent); color:black; font-weight:bold; text-decoration:none;">
                                        <i data-lucide="external-link" style="width:14px; height:14px;"></i> OPEN
                                    </a>
                                ` : `
                                    <button class="btn tiny soft" style="height:32px; width:40px; display:flex; align-items:center; justify-content:center;" onclick="OL.simulateUpload('${res.id}', ${idx})">
                                        <i data-lucide="upload-cloud" style="width:16px; height:16px;"></i>
                                    </button>
                                `}
                            </div>
                            <button class="card-delete-btn" style="position:static; opacity:0.3;" onclick="OL.removeFileFromContainer('${res.id}', ${idx})">
                                <i data-lucide="x" style="width:14px; height:14px;"></i>
                            </button>
                        </div>
                    `).join('')}
                </div>
                <button class="btn tiny soft full-width" style="margin-top:15px; border-style:dashed; padding: 10px; display:flex; align-items:center; justify-content:center; gap:8px;" 
                        onclick="OL.addFileToContainer('${res.id}')">
                    <i data-lucide="plus-circle" style="width:16px; height:16px;"></i> Add Document Entry
                </button>
            </div>
        `;
    }
    else if (isNaming) {
        // --- MODE C: NAMING CONVENTIONS HUB ---
        const sections = [
            { id: 'household', label: 'HOUSEHOLD NAMING', icon: 'home' },
            { id: 'folders', label: 'FOLDER NAMING', icon: 'folder-search' }
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
       bodyContent = `
            ${scopeAndRoundHtml}
            ${appMappingHtml}

           <div class="card-section" style="margin-top:20px;">
                <label class="modal-section-label" style="display:flex;align-items:center;gap:6px;">
                    <i data-lucide="align-start-vertical" style="width:14px;height:14px;"></i>
                    Hierarchy Context
                </label>
                <select class="modal-input tiny"
                        onchange="OL._fvAssignStageAndWorkflow('${res.id}', this.value)">
                    <option value="">— Workbench (Unassigned) —</option>
                    ${(OL.getCurrentProjectData().stages || []).map(s => {
                        const stageWorkflows = (OL.getCurrentProjectData().workflows || []).filter(w => String(w.stageId) === String(s.id));
                        const stageSelected  = res.stageId === s.id && !res.workflowId;
                        return `
                            <option value="stage:${esc(s.id)}" ${stageSelected ? 'selected' : ''}>
                                ${esc(s.name)}
                            </option>
                            ${stageWorkflows.map(wf => `
                                <option value="wf:${wf.id}:${s.id}" ${res.workflowId === wf.id ? 'selected' : ''}>
                                    &nbsp;&nbsp;↳ ${esc(wf.name)}
                                </option>
                            `).join('')}
                        `;
                    }).join('')}
                </select>
            </div>
                        
            <div class="card-section" style="margin-top:20px;">
                <label class="modal-section-label" style="display:flex;align-items:center;gap:6px;">
                    <i data-lucide="fingerprint" style="width:14px;height:14px;"></i> Description & Access Notes
                </label>
                <textarea class="modal-textarea"
                          placeholder="Enter login details, account purpose, or specific access instructions..."
                          style="min-height:80px;font-size:12px;width:100%;"
                          onblur="OL.handleResourceSave('${res.id}', 'description', this.value)">${esc(res.description || '')}</textarea>
            </div>
        
            ${showWorkflowSteps ? `
                <div class="card-section" style="margin-top:20px;">
                    <label class="modal-section-label" style="display:flex;align-items:center;gap:6px;">
                        <i data-lucide="git-branch" style="width:14px;height:14px;"></i> WORKFLOW STEPS
                    </label>
                    <div style="display:flex;gap:8px;margin-bottom:10px;">
                        <button class="btn tiny primary" onclick="OL.goToResourceInMap('${res.id}')" style="display:flex;align-items:center;gap:6px;">
                            <i data-lucide="mouse-pointer-2" style="width:12px;height:12px;"></i> Visual Editor
                        </button>
                        <button class="btn tiny primary" onclick="OL.addNewStepToCard('${res.id}')" style="display:flex;align-items:center;gap:6px;">
                            <i data-lucide="plus" style="width:12px;height:12px;"></i> Add Step
                        </button>
                    </div>
                    <div id="sop-step-list">${renderSopStepList(res)}</div>
                </div>
            ` : ''}
        
            ${dependencyHtml}
            ${sopLibraryHtml}
            ${containerHtml}
        
            <div class="card-section" style="margin-top:20px;">
                <label class="modal-section-label" style="display:flex;align-items:center;gap:6px;">
                    <i data-lucide="share-2" style="width:14px;height:14px;"></i> Connected Relationships
                </label>
                <div style="display:flex;gap:5px;margin:8px 0;overflow-x:auto;padding-bottom:5px;">
                    ${types.map(t => `
                        <span onclick="state.ui.relationshipFilter='${t}';OL.openResourceModal('${targetId}')"
                              style="font-size:9px;padding:2px 8px;border-radius:100px;cursor:pointer;white-space:nowrap;
                                     background:${activeFilter===t ? 'var(--accent)' : 'rgba(255,255,255,0.05)'};
                                     color:${activeFilter===t ? '#000' : '#94a3b8'};
                                     border:1px solid rgba(255,255,255,0.1);">
                            ${t.toUpperCase()}
                        </span>
                    `).join('')}
                </div>
                <div style="display:flex;flex-direction:column;gap:6px;">
                    ${filteredConnections.length > 0 ? filteredConnections.map(conn => {
                        const navAction = window.location.hash.includes('scoping-sheet')
                            ? `OL.openResourceModal('${conn.id}')`
                            : `OL.openInspector('${conn.id}')`;
                        return `
                        <div class="pill accent is-clickable"
                             style="display:flex;align-items:center;justify-content:space-between;
                                    background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.1);
                                    cursor:pointer;padding:8px 12px;border-radius:8px;"
                             onmousedown="event.preventDefault();event.stopPropagation();if(OL.closeModal)OL.closeModal();${navAction}">
                            <div style="display:flex;align-items:center;gap:8px;pointer-events:none;">
                                ${OL.getLucideSVG(OL.getRegistryIcon(conn.type), 14, 'var(--accent)')}
                                <div>
                                    <div style="font-size:11px;color:#eee;">${esc(conn.name)}</div>
                                    <div style="font-size:8px;color:var(--accent);">${conn.type.toUpperCase()}</div>
                                </div>
                            </div>
                            <span style="font-size:9px;opacity:0.5;pointer-events:none;">Inspect →</span>
                        </div>
                        `;
                    }).join('') : `<div class="tiny muted" style="padding:10px;text-align:center;">No connections found.</div>`}
                </div>
            </div>
        `;
      }
      // --- 🧱 FINAL RENDER ---
    
    const html = `
        <div class="modal-head" style="padding:14px 20px;border-bottom:0.5px solid var(--line);
                                background:var(--panel-dark);
                                display:flex;flex-direction:column;gap:10px;">
    
            <!-- Row 1: Icon + Title + link buttons -->
            <div style="display:flex;align-items:center;gap:8px;">
                <i data-lucide="${isCompliance ? 'clipboard-check' : 'settings'}" 
                   style="width:18px;height:18px;color:var(--accent);flex-shrink:0;"></i>
                <div contenteditable="true"
                     style="flex:1;font-size:18px;font-weight:700;color:var(--text-main);
                            line-height:1.3;outline:none;word-break:break-word;
                            border-bottom:1px dashed transparent;transition:border-color 0.2s;"
                     onfocus="this.style.borderColor='var(--accent)'"
                     onblur="this.style.borderColor='transparent';OL.handleResourceSave('${res.id}','name',this.innerText.trim())">
                    ${esc(res.name)}
                </div>
                ${hasHistory ? `
                    <button class="btn tiny soft" style="display:flex;align-items:center;gap:4px;"
                            onclick="OL.navigateBack()">
                        <i data-lucide="arrow-left" style="width:12px;height:12px;"></i> Back
                    </button>` : ''}
                ${res.externalUrl ? `
                    <a href="${res.externalUrl}" target="_blank"
                       style="width:26px;height:26px;display:flex;align-items:center;justify-content:center;
                              border:1px solid var(--panel-border);border-radius:6px;background:var(--panel-soft);
                              color:var(--text-dim);flex-shrink:0;text-decoration:none;" title="Open link">
                        <i data-lucide="external-link" style="width:12px;height:12px;"></i>
                    </a>` : ''}
                <button onclick="OL.promptEditLink('${res.id}')"
                        style="width:26px;height:26px;display:flex;align-items:center;justify-content:center;
                               border:1px solid var(--panel-border);border-radius:6px;background:var(--panel-soft);
                               color:var(--text-dim);cursor:pointer;flex-shrink:0;"
                        title="${res.externalUrl ? 'Edit link' : 'Add link'}">
                    <i data-lucide="pencil" style="width:12px;height:12px;"></i>
                </button>
            </div>
        
        
            <!-- Row 2: Stage + workflow + archive + pricing + promote — ALL ONE LINE -->
            <div style="display:flex;align-items:flex-end;gap:8px;flex-wrap:wrap;">
                ${originPill} ${typePill}
                <div style="width:0.5px;height:28px;background:var(--panel-border);flex-shrink:0;"></div>
                <button onclick="OL.handleResourceSave('${res.id}', 'isArchived', ${!res.isArchived})"
                        style="padding:4px 10px;border-radius:99px;font-size:11px;font-weight:600;cursor:pointer;
                               display:flex;align-items:center;gap:4px;
                               border:1px solid ${res.isArchived ? '#ef4444' : 'var(--panel-border)'};
                               background:${res.isArchived ? 'rgba(239,68,68,0.08)' : 'var(--panel-soft)'};
                               color:${res.isArchived ? '#ef4444' : 'var(--text-muted)'};">
                    <i data-lucide="${res.isArchived ? 'archive-restore' : 'archive'}" style="width:11px;height:11px;"></i>
                    ${res.isArchived ? 'Unarchive' : 'Archive'}
                </button>
                <button onclick="OL.handleResourceSave('${res.id}', 'isGlobal', ${!res.isGlobal}); OL.openResourceModal('${res.id}');"
                        style="padding:4px 10px;border-radius:99px;font-size:11px;font-weight:600;cursor:pointer;
                               display:flex;align-items:center;gap:4px;
                               border:1px solid ${res.isGlobal ? '#3dd9c5' : 'var(--panel-border)'};
                               background:${res.isGlobal ? 'rgba(61,217,197,0.1)' : 'var(--panel-soft)'};
                               color:${res.isGlobal ? '#3dd9c5' : 'var(--text-muted)'};">
                    <i data-lucide="globe" style="width:11px;height:11px;"></i>
                    ${res.isGlobal ? 'Global' : 'Set Global'}
                </button>
                ${isAdmin && relevantVars?.length > 0 ? `
                    <button onclick="if(!state.v2)state.v2={};state.v2.showPricing=!state.v2.showPricing;OL.openResourceModal('${res.id}')"
                            style="padding:4px 10px;border-radius:99px;font-size:11px;font-weight:600;cursor:pointer;
                                   display:flex;align-items:center;gap:4px;
                                   border:1px solid ${showPricing ? '#3dd9c5' : 'var(--panel-border)'};
                                   background:${showPricing ? 'rgba(61,217,197,0.1)' : 'var(--panel-soft)'};
                                   color:${showPricing ? '#3dd9c5' : 'var(--text-muted)'};">
                        <i data-lucide="${showPricing ? 'banknote-x' : 'banknote'}" style="width:11px;height:11px;"></i>
                        ${showPricing ? 'Hide pricing' : 'Show pricing'}
                    </button>` : ''}
                ${canPromote ? `
                    <button style="padding:4px 10px;border-radius:99px;font-size:11px;font-weight:600;cursor:pointer;
                                   background:#fbbf24;color:#000;border:none;display:flex;align-items:center;gap:4px;"
                            onclick="OL.pushToMaster('${res.id}')">
                        <i data-lucide="star" style="width:11px;height:11px;"></i> Promote
                    </button>` : ''}
            </div>
        </div>
        
        <!-- Pricing drawer -->
        ${showPricing && adminPricingHtml ? `
            <div style="border-bottom:1px solid var(--panel-border);background:var(--panel-dark);padding:12px 20px;">
                <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;
                            color:var(--accent);margin-bottom:8px;display:flex;align-items:center;gap:5px;">
                    <i data-lucide="settings" style="width:12px;height:12px;"></i> Pricing config
                </div>
                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(88px,1fr));gap:8px;">
                    ${pricingRows}
                </div>
            </div>
        ` : ''}
    
        <div style="display:flex;height:72vh;overflow:hidden;">
            <!-- Main body -->
            <div style="flex:1.6;overflow-y:auto;padding:16px 20px; height: 100%;">
                ${bodyContent}
            </div>
    
            <!-- Sidebar -->
            <aside style="flex:1;display:flex;flex-direction:column;border-left:1px solid var(--line);min-width:0; height:100%;">
                <div style="display:flex;border-bottom:1px solid var(--line);">
                    ${!isGuest ? `
                        <div onclick="state.v2.activeCommentTab='internal';OL.openResourceModal('${res.id}')"
                             style="flex:1;padding:10px 4px;text-align:center;font-size:10px;font-weight:700;
                                    cursor:pointer;${activeTab==='internal' ? 'color:var(--accent);border-bottom:2px solid var(--accent);' : 'opacity:0.5'}">
                            INTERNAL NOTES
                        </div>` : ''}
                    <div onclick="state.v2.activeCommentTab='client';OL.openResourceModal('${res.id}')"
                         style="flex:1;padding:10px 4px;text-align:center;font-size:10px;font-weight:700;
                                cursor:pointer;${activeTab==='client' ? 'color:#10b981;border-bottom:2px solid #10b981;' : 'opacity:0.5'}">
                        CLIENT FEEDBACK
                    </div>
                    <div onclick="state.v2.activeCommentTab='history';OL.openResourceModal('${res.id}')"
                         style="flex:1;padding:10px 4px;text-align:center;font-size:10px;font-weight:700;
                                cursor:pointer;${activeTab==='history' ? 'color:var(--accent);border-bottom:2px solid var(--accent);' : 'opacity:0.5'}">
                        EDIT HISTORY
                    </div>
                </div>
    
                <div style="flex:1;overflow-y:auto;padding:14px;">
                    ${activeTab === 'history' ? OL.renderEditHistory(res) : `
                        <div id="comments-list-${res.id}">
                            ${renderCommentsList(res, activeTab)}
                        </div>
                    `}
                </div>
    
                ${activeTab !== 'history' ? `
                    <div style="padding:12px;border-top:1px solid var(--line);">
                        <textarea id="new-comment-input-${res.id}" class="modal-textarea"
                                  placeholder="Type a ${activeTab === 'client' ? 'message to client' : 'private note'}..."
                                  style="min-height:60px;margin-bottom:8px;font-size:11px;"></textarea>
                        <button class="btn tiny full-width"
                                style="background:${activeTab === 'client' ? '#10b981' : 'var(--accent)'};"
                                onclick="OL.addResourceComment('${res.id}', ${activeTab === 'client'})">
                            Post to ${activeTab === 'client' ? 'Client Thread' : 'Internal Stack'}
                        </button>
                    </div>
                ` : ''}
            </aside>
        </div>
    `;
    
    openModal(html);
    setTimeout(() => {
        const el = document.getElementById('modal-res-name');
        if (el) el.style.height = el.scrollHeight + 'px';
    }, 10);

    // 🔍 DEBUG: Watch editor for style changes
    setTimeout(() => {
        const editor = document.getElementById(`email-body-edit-${res.id}`);
        if (editor) {
            new MutationObserver((mutations) => {
                mutations.forEach(m => {
                    if (m.attributeName === 'style') {
                        console.trace('Editor style changed to:', editor.style.display);
                    }
                });
            }).observe(editor, { attributes: true });
        }
    }, 500);
    if (window.lucide) {
        window.lucide.createIcons();
    }
};

export function _geRenderEmailPreview(value, datapoints, client) {
    if (!value) return '<span style="opacity:0.3;font-style:italic;">No body written yet. Click Edit to add content.</span>';
    
    const data = OL.getCurrentProjectData();
    const allResources = data.resources || [];

    let html = value;

    // 1. FIRST: Convert <a data-dp-key> anchors to pills (This prevents tags inside attributes from being mangled)
    html = html.replace(/<a\s+href="([^"]*)"[^>]*data-dp-key="([^"]*)"[^>]*>([\s\S]*?)<\/a>|<a\s+[^>]*data-dp-key="([^"]*)"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (fullMatch, url1, key1, text1, key2, url2, text2) => {
        const url = url1 || url2;
        const dpKey = (key1 || key2 || '').toLowerCase();
        const linkText = (text1 || text2 || '').trim();
        return `<span class="pill tiny accent is-clickable" 
                      style="display:inline-flex;align-items:center;gap:4px;font-size:10px;vertical-align:middle;cursor:pointer;"
                      onclick="window.open('${url}','_blank')">
                    <i data-lucide="link" style="width:9px;height:9px;"></i>${linkText}
                </span>`;
    });
    
    // 2. SECOND: Convert remaining plain {tags} to pills
    html = html.replace(/\{[^}]+\}/g, match => {
        const dp = datapoints.find(d => d.key === match);
        if (dp) {
            const linkedRes = dp.linkToResource 
                ? allResources.find(r => r.name === dp.linkToResource) : null;
            const url = linkedRes?.externalUrl;
            const pill = `<span class="pill tiny accent is-clickable" 
                               style="display:inline-flex;align-items:center;gap:4px;font-size:10px;vertical-align:middle;cursor:pointer;"
                               onclick="${url ? `window.open('${url}','_blank')` : `OL.openDataDetailModal('${dp.id}')`}">
                               <i data-lucide="tag" style="width:9px;height:9px;"></i>${dp.name}
                           </span>`;
            return pill;
        }
        return `<span class="pill tiny soft" style="display:inline-flex;font-size:10px;vertical-align:middle;">${match}</span>`;
    });

    return html;
};

export function _geToggleEmailBody(resId, mode) {
    const preview = document.getElementById(`email-body-preview-${resId}`);
    const editor  = document.getElementById(`email-body-edit-${resId}`);
    const tagsBtn = document.getElementById(`data-tags-btn-${resId}`);
    const resTagsBtn = document.getElementById(`res-tags-btn-${resId}`);
    const doneBtn = document.getElementById(`email-body-done-${resId}`);
    if (!preview || !editor) return;

    if (tagsBtn) tagsBtn.style.display = 'block';
    if (doneBtn) doneBtn.style.display = 'block';
    if (resTagsBtn) resTagsBtn.style.display = 'block';

    if (mode === 'rich') {
        preview.style.display = 'none';
        editor.style.display = 'none';
        let richEl = document.getElementById(`email-body-rich-${resId}`);
        if (!richEl) {
            richEl = document.createElement('div');
            richEl.id = `email-body-rich-${resId}`;
            richEl.contentEditable = 'true';
            richEl.style.cssText = 'min-height:160px;padding:12px;border:1px solid var(--line);border-radius:6px;font-size:12px;line-height:1.6;outline:none;background:rgba(0,0,0,0.1);';
            richEl.innerHTML = editor.value || '';
            editor.parentNode.appendChild(richEl);
        }
        // 🚀 Blur closes editor only if tag menu is closed
        richEl.onblur = function() {
            const menu = document.getElementById(`data-tag-menu-${resId}`);
            if (menu && menu.style.display === 'block') return;
            if (window._tagInserting) return;
            OL._geSaveEmailBody(resId, richEl.innerHTML);
        };
        richEl.style.display = 'block';
        richEl.focus();
    } else {
        const richEl = document.getElementById(`email-body-rich-${resId}`);
        if (richEl) richEl.style.display = 'none';
        preview.style.display = 'none';
        editor.style.display = 'block';
        // 🚀 Show sanitized HTML in editor
        const res = OL.getResourceById(resId);
        editor.value = OL._geSanitizeEmailHtml(res?.emailBody || '');
        editor.onblur = function() {
            const menu = document.getElementById(`data-tag-menu-${resId}`);
            if (menu && menu.style.display === 'block') return;
            if (window._tagInserting) return;
            OL._geSaveEmailBody(resId, editor.value);
        };
        editor.focus();
    }
};

export function _geInsertDataTag(resId, tag) {
    window._tagInserting = true;
    
    // 🚀 Check if this is a resource tag with a real URL
    const client = getActiveClient();
    const datapoints = [
        ...(client?.projectData?.localDatapoints?.length 
            ? client.projectData.localDatapoints 
            : (state.master.datapoints || [])),
        ...OL.getResourceDatapoints()
    ];
    const dp = datapoints.find(d => d.key === tag);
    const data = OL.getCurrentProjectData();
    const linkedRes = dp?.linkToResource
        ? (data.resources || []).find(r => r.name === dp.linkToResource)
        : null;
    const externalUrl = linkedRes?.externalUrl;

    // Build the actual insertion value
    const insertValue = externalUrl
        ? `<a href="${externalUrl}" target="_blank" data-dp-key="${tag}">${dp.name}</a>`
        : tag; // plain tag for non-resource datapoints

    const editor = document.getElementById(`email-body-edit-${resId}`);
    const richEl = document.getElementById(`email-body-rich-${resId}`);
    
    if (richEl && richEl.style.display !== 'none') {
        if (externalUrl) {
            // Insert as HTML node
            const temp = document.createElement('div');
            temp.innerHTML = insertValue;
            const node = temp.firstChild;
            const sel = window.getSelection();
            if (sel.rangeCount) {
                const range = sel.getRangeAt(0);
                range.deleteContents();
                range.insertNode(node);
                range.setStartAfter(node);
                range.collapse(true);
                sel.removeAllRanges();
                sel.addRange(range);
            } else {
                richEl.appendChild(node);
            }
        } else {
            const sel = window.getSelection();
            if (sel.rangeCount) {
                const range = sel.getRangeAt(0);
                range.deleteContents();
                range.insertNode(document.createTextNode(tag));
                range.collapse(false);
            } else {
                richEl.innerHTML += tag;
            }
        }
        OL.handleResourceSave(resId, 'emailBody', richEl.innerHTML);
        setTimeout(function() { richEl.focus(); window._tagInserting = false; }, 50);

    } else if (editor && editor.style.display !== 'none') {
        const start = editor.selectionStart;
        const end = editor.selectionEnd;
        editor.value = editor.value.substring(0, start) + insertValue + editor.value.substring(end);
        editor.selectionStart = editor.selectionEnd = start + insertValue.length;
        OL.handleResourceSave(resId, 'emailBody', editor.value);
        setTimeout(function() { editor.focus(); window._tagInserting = false; }, 50);
    } else {
        window._tagInserting = false;
    }
};

document.addEventListener('click', function(e) {
    if (!e.target.closest('[id^="data-tag-menu-"]') && !e.target.closest('[id^="data-tags-btn-"]')) {
        document.querySelectorAll('[id^="data-tag-menu-"]').forEach(el => el.style.display = 'none');
    }
    if (!e.target.closest('[id^="email-edit-menu-"]') && !e.target.closest('[id^="email-edit-btn-"]')) {
        document.querySelectorAll('[id^="email-edit-menu-"]').forEach(el => el.style.display = 'none');
    }
    // 🚀 Resource tags menu
    if (!e.target.closest('[id^="res-tag-menu-"]') && !e.target.closest('[id^="res-tags-btn-"]')) {
        document.querySelectorAll('[id^="res-tag-menu-"]').forEach(el => el.style.display = 'none');
    }
});

export function _geSanitizeEmailHtml(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<body>${html}</body>`, 'text/html');
    return doc.body.innerHTML;
};

export function _geSaveEmailBody(resId, value) {
    console.trace('_geSaveEmailBody called');
    const sanitized = OL._geSanitizeEmailHtml(value);
    OL.handleResourceSave(resId, 'emailBody', sanitized);
    
    const preview = document.getElementById(`email-body-preview-${resId}`);
    const editor  = document.getElementById(`email-body-edit-${resId}`);
    const richEl  = document.getElementById(`email-body-rich-${resId}`);
    const tagsBtn = document.getElementById(`data-tags-btn-${resId}`);
    const doneBtn = document.getElementById(`email-body-done-${resId}`);
    const resTagsBtn = document.getElementById(`res-tags-btn-${resId}`);

    const client = getActiveClient();
    const datapoints = [
        ...(client?.projectData?.localDatapoints?.length 
            ? client.projectData.localDatapoints 
            : (state.master.datapoints || [])),
        ...OL.getResourceDatapoints()
    ];

    const previewHtml = OL._geRenderEmailPreview(sanitized, datapoints, client);

    if (preview) { 
        preview.innerHTML = previewHtml;
        preview.style.display = 'block';
        if (window.lucide) window.lucide.createIcons();
    }
    if (editor)  editor.style.display  = 'none';
    if (richEl)  richEl.style.display  = 'none';
    if (tagsBtn) tagsBtn.style.display = 'none';
    if (doneBtn) doneBtn.style.display = 'none';
    if (resTagsBtn) resTagsBtn.style.display = 'none';
};

export function promptEditLink(resId) {
    const data = OL.getCurrentProjectData();
    const res = (data.resources || []).find(r => String(r.id) === String(resId));
    if (!res) return;
    const url = prompt('External link URL:', res.externalUrl || '');
    if (url === null) return;
    OL.handleResourceSave(resId, 'externalUrl', url.trim());
};

export function getResourceDatapoints() {
    const data = OL.getCurrentProjectData();
    const resources = (data.resources || data.localResources || []).filter(r => 
        !r.isDeleted && 
        !['Workflow', 'Zap', 'Email Campaign'].includes(r.type)
    );
    return resources.map(r => ({
        id: `res-tag-${r.id}`,
        name: r.name,
        key: `{${r.name.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()}}`,
        category: 'Resources',
        linkToResource: r.name,
        _isResourceTag: true
    }));
};

export function renderHierarchyTree(resId, nodes, path = "") {
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
                    <span style="display: flex; align-items: center; justify-content: center; width: 16px; height: 16px;">
                        <i data-lucide="${node.children?.length > 0 ? 'folder-open' : 'folder'}" 
                           style="width: 14px; height: 14px; color: ${node.children?.length > 0 ? 'var(--accent)' : 'var(--text-dim)'};">
                        </i>
                    </span>
                    
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
    
    if (window.lucide) {
        window.lucide.createIcons();
    }
};

export function addFolderNode(resId, path = null) {
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

export function updateTreeNode(resId, path, value) {
    const res = OL.getResourceById(resId);
    const keys = path.split('.');
    let target = res.tree;
    keys.forEach((key, i) => {
        if (i === keys.length - 1) target[key].name = value;
        else target = target[key].children;
    });
    OL.persist();
};

export function removeTreeNode(resId, path) {
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
export function handleTreeDragStart(e, resId, path) {
    e.dataTransfer.setData("text/plain", path);
    e.stopPropagation();
};

export function handleTreeDrop(e, resId, targetPath, position) {
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
export function handleTreeDragOver(e) {
    e.preventDefault();
    e.currentTarget.classList.add('drag-over');
};

export function handleTreeDragLeave(e) {
    e.currentTarget.classList.remove('drag-over');
};

export function handleConventionUpdate(resId, section, key, value) {
    const res = OL.getResourceById(resId);
    if (res) {
        if (!res.data) res.data = {};
        if (!res.data[section]) res.data[section] = {};
        
        res.data[section][key] = value.trim();
        OL.persist();
        console.log(`✅ Naming Convention Saved: ${section} -> ${key}`);
    }
};

export function updateContainerFile(resId, fileIdx, field, value) {
    const res = OL.getResourceById(resId);
    if (res && res.files && res.files[fileIdx]) {
        res.files[fileIdx][field] = value.trim();
        OL.persist();
    }
};

export function addFileToContainer(resId) {
    const res = OL.getResourceById(resId);
    if (res) {
        if (!res.files) res.files = [];
        res.files.push({ name: "New Document", url: "", id: uid() });
        OL.persist();
        OL.openResourceModal(resId);
    }
};

export function removeFileFromContainer(resId, idx) {
    const res = OL.getResourceById(resId);
    if (res && res.files && confirm("Remove this document entry?")) {
        res.files.splice(idx, 1);
        OL.persist();
        OL.openResourceModal(resId);
    }
};

export function simulateUpload(resId, idx) {
    // Note: Actual PDF binary upload requires Firebase Storage.
    // For now, we prompt for a link (Google Drive/Dropbox).
    const url = prompt("Please enter the Google Drive or Dropbox link for this PDF:");
    if (url) {
        OL.updateContainerFile(resId, idx, 'url', url);
        OL.openResourceModal(resId);
    }
};

export async function addResourceComment(resId, isClientFacing = false) {
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

export function renderResourceMiniMaps(targetResId) {
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
export function renderMiniNode(res, status) {
    if (!res) return "";
    const isActive = status === 'active';
    const iconName = OL.getRegistryIcon(res.type);
    
    const bgTint = isActive ? 'rgba(251, 191, 36, 0.15)' : 'rgba(var(--text-rgb), 0.05)';
    const borderColor = isActive ? 'var(--accent)' : 'var(--line)';

    return `
        <div class="mini-node ${status} ${isMilestone ? 'is-milestone' : ''}" 
             onclick="event.stopPropagation(); OL.openResourceModal('${res.id}')"
             style="cursor:pointer; padding:8px; border-radius:8px; background:${bgTint}; border:1px solid ${borderColor}; min-width:120px; position:relative;">
            <div style="display:flex; flex-direction:column; align-items:center; gap:4px;">
                ${OL.getLucideSVG(iconName, 14, isActive ? 'var(--accent)' : 'currentColor')}
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

// HANDLE WOKRFLOW VISUALIZER / FULL SCREEN MODE
// Global Workspace Logic
export function goToResourceInMap(resId) {
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

export function navigateBack() {
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

export function trackNav(id, type, resId = null) {
    let history = JSON.parse(sessionStorage.getItem('ol_nav_history') || '[]');
    // Prevent duplicate entries if refreshing same item
    if (history.length > 0 && history[history.length - 1].id === id) return;
    
    history.push({ id, type, resId });
    if (history.length > 10) history.shift(); // Keep history lean
    sessionStorage.setItem('ol_nav_history', JSON.stringify(history));
};

export function clearNavHistory() {
    sessionStorage.removeItem('ol_nav_history');
    console.log("🧹 Navigation stack reset.");
};

// Filter for Signature resources within the project
export function filterSignatureSearch(resId, query) {
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
export function linkSignature(resId, sigId, sigName) {
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
export function previewEmailTemplate(resId) {
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
            <div style="line-height: 1.6; font-size: 15px; color:#222;">${res.emailBody || '...'}</div>
            ${signatureContent}
            <div style="margin-top: 40px; text-align: center; border-top: 1px solid #eee; padding-top: 20px;">
                <button class="btn small soft" style="color:black !important;" onclick="OL.openResourceModal('${resId}')">← Back to Editor</button>
            </div>
        </div>
    `;
    window.openModal(previewHtml);
};

export function copyToClipboard(text, btn) {
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

export function logResourceEdit(resId, field, oldVal, newVal) {
    const data = OL.getCurrentProjectData();
    const res = (data.resources || []).find(r => String(r.id) === String(resId));
    if (!res) return;
    if (!res.editHistory) res.editHistory = [];
    const user = state.adminMode ? (state.master?.adminName || 'Admin') : 'You';
    res.editHistory.unshift({
        id: 'eh-' + Date.now(),
        user,
        field,
        oldVal: oldVal ?? null,
        newVal: newVal ?? null,
        ts: Date.now()
    });
    // Keep last 50 entries only
    if (res.editHistory.length > 50) res.editHistory = res.editHistory.slice(0, 50);
};

export function handleResourceSave(id, field, value) {
    const data = OL.getCurrentProjectData();
    const res = data.resources.find(r => String(r.id) === String(id));
    
    if (res) {
        // 🌐 THE SAFETY SHIELD INTERCEPTOR
        // If the resource is global and an event forces a track lane shift on the root object,
        // short-circuit the execution to prevent it from vanishing from other workflows!
        if (res.isGlobal && (field === 'stageId' || field === 'workflowId')) {
            console.warn(`🛡️ Global Protection Guard: Aborted root mutation [${field}: ${value}] on resource "${res.name}". Workflow arrays handle this placement.`);
            
            // Still force a quick visual refresh to snap the card back into its correct track line if it visually moved
            if (window.location.hash.includes('visualizer')) {
                OL.renderVisualizer();
            }
            return; 
        }

        const oldVal = res[field];
        OL.logResourceEdit(id, field, oldVal, value);
        res[field] = value;
        
        OL.persist().then(() => {
            const modalOpen = document.getElementById('active-modal-box');
            const inspectorOpen = document.getElementById('v2-inspector-panel')?.classList.contains('open');
            const isVisualizer = window.location.hash.includes('visualizer');
            const isResources = window.location.hash.includes('resources');
            
            if (modalOpen) {
                // 🚀 Don't re-render modal for email body edits — it destroys the editor
                const emailFields = ['emailBody', 'emailFrom', 'emailToType', 'emailSubject'];
                if (!emailFields.includes(field)) {
                    OL.openResourceModal(id);
                }
            } else if (inspectorOpen && isVisualizer) {
                OL._fvOpenStepsList(id);
                if (field === 'stageId') setTimeout(() => OL.renderVisualizer(), 100);
            } else if (inspectorOpen && !isVisualizer) {
                OL.openInspector(id, null, 'cards');
            } else if (isResources) {
                renderResourceManager();
            } else if (isVisualizer) {
                OL.renderVisualizer();
            }
        });
    }
};

export function renderEditHistory(res) {
    const entries = res.editHistory || [];
    if (!entries.length) return `<div style="font-size:12px;color:var(--color-text-secondary);text-align:center;padding:30px 0;">No changes recorded yet.</div>`;

    const timeAgo = (ts) => {
        const diff = Date.now() - ts;
        const m = Math.floor(diff / 60000);
        const h = Math.floor(diff / 3600000);
        const d = Math.floor(diff / 86400000);
        if (m < 1) return 'just now';
        if (m < 60) return `${m}m ago`;
        if (h < 24) return `${h}h ago`;
        if (d < 7) return `${d}d ago`;
        return new Date(ts).toLocaleDateString([], {month:'short', day:'numeric'});
    };

    const fieldLabel = (f) => ({
        name: 'Name', type: 'Type', appId: 'App', appName: 'App',
        stageId: 'Stage', description: 'Description', externalUrl: 'External link',
        isArchived: 'Archived', dueDate: 'Due date'
    }[f] || f);

    return entries.map(e => {
        const initials = e.user.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
        const isYou = e.user === 'You' || e.user === 'Admin';
        const avatarBg = isYou ? '#E1F5EE' : '#E6F1FB';
        const avatarColor = isYou ? '#0F6E56' : '#185FA5';

        let changeHtml = '';
        if (e.field === 'isArchived') {
            changeHtml = e.newVal 
                ? `Resource <strong>archived</strong>` 
                : `Resource <strong>unarchived</strong>`;
        } else if (e.oldVal === null || e.oldVal === undefined || e.oldVal === '') {
            changeHtml = `<span style="color:var(--color-text-secondary)">${fieldLabel(e.field)}</span> set to <span style="color:#0F6E56;font-weight:500">${esc(String(e.newVal || ''))}</span>`;
        } else if (e.newVal === null || e.newVal === undefined || e.newVal === '') {
            changeHtml = `<span style="color:var(--color-text-secondary)">${fieldLabel(e.field)}</span> cleared`;
        } else {
            changeHtml = `
                <span style="color:var(--color-text-secondary)">${fieldLabel(e.field)}</span> changed from
                <span style="text-decoration:line-through;color:var(--color-text-secondary)">${esc(String(e.oldVal))}</span> to
                <span style="color:#0F6E56;font-weight:500">${esc(String(e.newVal))}</span>
            `;
        }

        return `
            <div style="padding:10px 0;border-bottom:0.5px solid var(--color-border-tertiary);display:flex;gap:10px;">
                <div style="width:24px;height:24px;border-radius:50%;background:${avatarBg};color:${avatarColor};
                            font-size:10px;font-weight:500;display:flex;align-items:center;justify-content:center;
                            flex-shrink:0;margin-top:1px;">
                    ${initials}
                </div>
                <div style="flex:1;min-width:0;">
                    <div style="font-size:11px;font-weight:500;margin-bottom:3px;">
                        ${esc(e.user)} 
                        <span style="font-size:10px;color:var(--color-text-secondary);font-weight:400;">${timeAgo(e.ts)}</span>
                    </div>
                    <div style="font-size:11px;line-height:1.5;">${changeHtml}</div>
                </div>
            </div>
        `;
    }).join('');
};

// 4. RESOURCE CARD & FOLDER RENDERERS
export function renderVaultRatesPage() {
  const container = document.getElementById("mainContent");
  if (!container) return;
    container.style.cssText = '';
    document.body.classList.remove('is-visualizer');

  document.body.classList.remove('is-visualizer', 'fs-mode-active');
  document.body.style.overflow = 'auto';
  document.documentElement.style.overflow = 'auto';

  const rates = state.master.rates || {};
  const registry = state.master.resourceTypes || [];
  const variables = rates.variables || {};

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

export function addRegistryType() {
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

export function updateResourcePricingData(targetId, varKey, value) {
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

export function renameResourceType(oldNameEncoded, newName, archetype, isEncoded = false) {
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
export async function pushToMaster(localResId) {
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

export function filterMasterResourceImport(query) {
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

export function importFromMaster() {
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

export function executeResourceImport(masterId) {
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

export async function universalDelete(id, type, options = {}) {
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

// ---- bridge: keep OL.*/window.* calls working until callers import directly ----
window.OL = window.OL || {};
Object.assign(window.OL, {
    selectResourceCard, updateResourceMeta, handleResourceHeaderBlur,
    handleModalSave, commitDraftToSystem, getDraftById, getResourceById,
    openResourceModal, _geRenderEmailPreview, _geToggleEmailBody,
    _geInsertDataTag, _geSanitizeEmailHtml, _geSaveEmailBody, promptEditLink,
    getResourceDatapoints, renderHierarchyTree, addFolderNode, updateTreeNode,
    removeTreeNode, handleTreeDragStart, handleTreeDrop, handleTreeDragOver,
    handleTreeDragLeave, handleConventionUpdate, updateContainerFile,
    addFileToContainer, removeFileFromContainer, simulateUpload,
    addResourceComment, renderResourceMiniMaps, goToResourceInMap,
    navigateBack, trackNav, clearNavHistory, filterSignatureSearch,
    linkSignature, previewEmailTemplate, copyToClipboard, logResourceEdit,
    handleResourceSave, renderEditHistory, addRegistryType,
    updateResourcePricingData, renameResourceType, pushToMaster,
    filterMasterResourceImport, importFromMaster, executeResourceImport,
    universalDelete
});
// Called bare from sections still living in app.js (and from
// features/resources-grid.js) — bridge onto window directly.
window.renderResourceCard = renderResourceCard;
window.renderVaultRatesPage = renderVaultRatesPage;
