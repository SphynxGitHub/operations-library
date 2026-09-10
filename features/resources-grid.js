//======================= FEATURES / RESOURCES GRID =======================//
// Extracted from app.js "RESOURCES GRID SECTION" + "RESOURCE TYPES".
// Owns: the resources grid (master + per-client), filters, resource-type
// management, hierarchy selectors, and inline SOP step editing.
// Split from features/resources-modal.js purely for file size — the two
// call into each other (renderResourceManager <-> renderResourceCard)
// and rely on the window bridge to resolve that, same as other modules.

import { state, esc, uid, getActiveClient, persist } from '../core/data.js';

export function renderResourceManager() {
    OL.registerView(renderResourceManager);
    const container = document.getElementById("mainContent");
    const client = getActiveClient();
    const isVaultView = window.location.hash.startsWith('#/vault');

    if (!container) return;
    container.style.cssText = '';
    document.body.classList.remove('is-visualizer');
    
    // 🔓 FIX: Restore standard page scrolling
    document.body.classList.remove('is-visualizer', 'fs-mode-active');
    document.body.style.overflow = 'auto'; 

    const source = isVaultView ? (state.master.resources || []) : (client?.projectData?.localResources || []);
    
    // Data for dropdowns
    const types = [...new Set(source.map(r => r.type).filter(t => t && t !== 'Workflow'))].sort();
    const apps = [...new Set([
        // Direct app on resource
        ...source.map(r => r.appName).filter(Boolean),
        // Apps on steps within each resource
        ...source.flatMap(r => (r.steps || []).map(s => s.appName).filter(Boolean))
    ])].sort();
    const dataTags = state.master.datapoints?.filter(d => !d.isBundle) || [];
    const team = [...(state.master.teamMembers || []), ...(client?.projectData?.teamMembers || []), { name: 'Client 1' }, { name: 'Client 2' }];

    container.innerHTML = `
        <div class="section-header" style="display:flex; align-items:center; gap:12px;">
            <i data-lucide="database" style="width:28px; height:24px; color:var(--accent);"></i>
            <div style="flex:1;">
                <h2 style="margin:0;">${isVaultView ? 'Master Vault' : 'Project Library'}</h2>
                <div class="small muted subheader">Full technical catalog for ${esc(client?.meta.name || 'Global')}</div>
            </div>
            <div class="header-actions">
                ${state.adminMode ? `
                    <button class="btn small soft" onclick="OL.openResourceTypeManager()" style="display:flex; align-items:center; gap:6px;">
                        <i data-lucide="settings" style="width:14px; height:14px;"></i> Types
                    </button>` : ''}

                <button class="btn small ${state.showArchivedResources ? 'primary' : 'soft'}"
                        onclick="state.showArchivedResources = !state.showArchivedResources; renderResourceManager();"
                        style="display:flex;align-items:center;gap:6px;">
                    <i data-lucide="archive" style="width:14px;height:14px;"></i>
                    ${state.showArchivedResources ? 'Hide Archived' : 'Show Archived'}
                </button>
                
                ${OL.viewToggleBtn('resources', 'renderResourceManager')}
                
                <div class="dropdown-plus">
                    <button class="btn primary" onclick="OL.universalCreate('SOP')" style="display:flex; align-items:center; gap:6px;">
                        <i data-lucide="plus" style="width:16px; height:16px;"></i> New Resource
                    </button>
                    <div class="dropdown-content">
                        ${(state.master.resourceTypes || []).map(t => `
                            <a href="javascript:void(0)" onclick="OL.universalCreate('${t.type}')" style="display:flex; align-items:center; gap:8px;">
                                <i data-lucide="${OL.getRegistryIcon(t.type)}" style="width:14px; height:14px; opacity:0.7;"></i>
                                <span>New ${t.type}</span>
                            </a>
                        `).join('')}
                        <div class="divider"></div>
                        <a href="javascript:void(0)" onclick="OL.universalCreate('General')" style="display:flex; align-items:center; gap:8px;">
                            <i data-lucide="component" style="width:14px; height:14px; opacity:0.7;"></i>
                            <span>New General Resource</span>
                        </a>
                    </div>
                </div>

                <button class="btn primary" onclick="OL.bulkImportZaps()" style="display:flex; align-items:center; gap:6px;">
                    <i data-lucide="zap" style="width:14px; height:14px;"></i> Bulk Zaps
                </button>
                <button class="btn primary" onclick="OL.openImportHub()" style="display:flex; align-items:center; gap:6px;">
                    <i data-lucide="plug-2" style="width:14px; height:14px;"></i> Import Hub
                </button>
            </div>
        </div>

        <div class="v2-toolbar" style="margin: 20px 0; display: flex; gap: 10px; flex-wrap: wrap; background: rgba(255,255,255,0.03); padding: 15px; border-radius: 8px; border: 1px solid var(--line);">
            <div class="canvas-search-wrap" style="flex: 2; min-width: 250px; position:relative; display:flex; align-items:center;">
                <i data-lucide="search" style="position:absolute; left:12px; width:14px; height:14px; opacity:0.4;"></i>
                <input type="text" id="lib-filter-input" class="v2-search-input" 
                       placeholder="Search name, description, or notes..." 
                       style="padding-left:35px; width:100%;"
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

            <select id="lib-filter-scoped" class="tiny-select" onchange="OL.syncResourceLibraryFilters()">
                <option value="">All Scoping</option>
                <option value="scoped">Scoped ($)</option>
                <option value="unscoped">Unscoped</option>
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

            <button class="btn tiny danger soft" onclick="OL.clearResourceFilters()" style="display:flex; align-items:center; gap:4px;">
                <i data-lucide="filter-x" style="width:12px; height:12px;"></i> Clear
            </button>
        </div>

        <div id="resource-library-results"></div>
    `;

    // 🚀 THE REPAINT: Convert all tags to SVGs
    if (window.lucide) {
        window.lucide.createIcons();
    }

    OL.syncResourceLibraryFilters();
};

export function syncResourceLibraryFilters() {
    const container = document.getElementById('resource-library-results');
    if (!container) return;
    container.style.cssText = '';
    document.body.classList.remove('is-visualizer');

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
         if (!state.showArchivedResources && res.isArchived) return false;
        //if (res.type === 'Workflow') return false;

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

export function renderResourceGroups(container, items) {
    if (!state.showArchivedResources) {
        items = items.filter(r => !r.isArchived);
    }
    
    if (items.length === 0) {
        container.innerHTML = `<div class="empty-hint" style="padding: 100px; text-align: center; opacity: 0.5;">No resources matching your filters.</div>`;
        return;
    }

    const sphynxPinned  = items.filter(res => res.systemPinned);
    const adminPinned   = items.filter(res => res.adminPinned);
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
                <div style="border-bottom: 2px solid var(--accent); padding: 8px; background: rgba(var(--accent-rgb), 0.05); margin-bottom:12px; display:flex; align-items:center; gap:8px;">
                    <i data-lucide="gem" style="width:16px; height:16px; color: var(--accent);"></i>
                    <h3 style="margin:0; font-size:12px; color: var(--accent); letter-spacing:0.05em;">SPHYNX RESOURCES</h3>
                </div>
                ${OL.getViewMode('resources') === 'list' ? `
                    <div style="display:flex;flex-direction:column;gap:2px;">
                        ${sphynxPinned.map(res => OL._renderResourceListRow(res)).join('')}
                    </div>
                ` : `
                    <div class="cards-grid">${sphynxPinned.map(r => renderResourceCard(r)).join('')}</div>
                `}
            </div>` : ''}
        
        ${adminPinned.length ? `
            <div class="resource-group" style="margin-bottom: 30px;">
                <div style="border-bottom: 2px solid #94a3b8; padding: 8px; background: rgba(148, 163, 184, 0.05); margin-bottom:12px; display:flex; align-items:center; gap:8px;">
                    <i data-lucide="shield-check" style="width:16px; height:16px; color: #94a3b8;"></i>
                    <h3 style="margin:0; font-size:12px; color: #94a3b8;">ADMIN</h3>
                </div>
                ${OL.getViewMode('resources') === 'list' ? `
                    <div style="display:flex;flex-direction:column;gap:2px;">
                        ${adminPinned.map(res => OL._renderResourceListRow(res)).join('')}
                    </div>
                ` : `
                    <div class="cards-grid">${adminPinned.map(r => renderResourceCard(r)).join('')}</div>
                `}
            </div>` : ''}

            ${sortedTypes.map(type => `
                <div class="resource-group" style="margin-bottom: 40px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; border-bottom: 1px solid var(--accent); padding-bottom: 8px; margin-bottom:15px;">
                        <div style="display:flex; align-items:center; gap:10px;">
                            <i data-lucide="${OL.getRegistryIcon(type)}" style="width:18px; height:18px; color: var(--accent);"></i>
                            <h3 style="margin:0; font-size: 13px; text-transform: uppercase; color: var(--accent); letter-spacing: 0.1em;">
                                ${type}s
                            </h3>
                        </div>
                        <button class="btn tiny soft" onclick="OL.promptBulkReclassify('${type}')">Bulk Move</button>
                    </div>
                    ${OL.getViewMode('resources') === 'list' ? `
                        <div style="display:flex;flex-direction:column;gap:2px;">
                            ${grouped[type].sort((a, b) => a.name.localeCompare(b.name)).map(res => {
                                const scopeData = OL.getScopingDataForResource(res.id);
                                const statusColors = {'Do Now':'#38bdf8','Done':'#22c55e','Do Later':'#fbbf24',"Don't Do":'#ef4444'};
                                const statusColor = scopeData ? (statusColors[scopeData.status]||'var(--accent)') : 'transparent';
                                return `
                                    <div style="display:flex;align-items:center;gap:12px;padding:10px 16px;
                                                background:var(--panel-soft);border:1px solid var(--panel-border);
                                                border-left:3px solid ${statusColor};
                                                border-radius:8px;cursor:pointer;transition:border-color 0.2s;"
                                         onclick="OL.selectResourceCard('${res.id}')"
                                         onmouseover="this.style.borderColor='var(--accent)'"
                                         onmouseout="this.style.borderColor='var(--panel-border)'">
                                        <i data-lucide="${OL.getRegistryIcon(res.type)}" style="width:14px;height:14px;color:var(--accent);flex-shrink:0;"></i>
                                        <span style="font-weight:600;font-size:13px;flex:1;">${esc(res.name)}</span>
                                        <span style="font-size:10px;color:var(--text-muted);">${esc(res.type||'General')}</span>
                                        ${scopeData ? `<span class="pill tiny" style="background:${statusColor}22;color:${statusColor};border:1px solid ${statusColor}44;font-size:8px;">${esc(scopeData.status)}</span>` : ''}
                                        ${!res.isLocked ? `
                                            <button class="card-delete-btn" style="position:static;" onclick="event.stopPropagation();OL.universalDelete('${res.id}','resources')">
                                                <i data-lucide="x" style="width:12px;height:12px;"></i>
                                            </button>` : ''}
                                    </div>
                                `;
                            }).join('')}
                        </div>
                    ` : `
                        <div class="cards-grid">
                            ${grouped[type].sort((a, b) => a.name.localeCompare(b.name)).map(r => renderResourceCard(r)).join('')}
                        </div>
                    `}
                </div>
            `).join('')}
        </div>
    `;

    if (window.lucide) window.lucide.createIcons();
};

export function _renderResourceListRow(res) {
    const scopeData = OL.getScopingDataForResource(res.id);
    const statusColors = {'Do Now':'#38bdf8','Done':'#22c55e','Do Later':'#fbbf24',"Don't Do":'#ef4444'};
    const statusColor = scopeData ? (statusColors[scopeData.status]||'var(--accent)') : 'transparent';
    return `
        <div style="display:flex;align-items:center;gap:12px;padding:10px 16px;
                    background:var(--panel-soft);border:1px solid var(--panel-border);
                    border-left:3px solid ${statusColor};
                    border-radius:8px;cursor:pointer;transition:border-color 0.2s;
                    opacity:${res.isArchived ? '0.5' : '1'};"
             onclick="OL.selectResourceCard('${res.id}')"
             onmouseover="this.style.borderColor='var(--accent)'"
             onmouseout="this.style.borderColor='var(--panel-border)'">
            <i data-lucide="${OL.getRegistryIcon(res.type)}" style="width:14px;height:14px;color:var(--accent);flex-shrink:0;"></i>
            <span style="font-weight:600;font-size:13px;flex:1;">${esc(res.name)}</span>
            ${res.isArchived ? `<span class="pill tiny" style="background:rgba(107,114,128,0.1);color:var(--text-dim);border:1px solid #6b7280;font-size:8px;">📦 Archived</span>` : ''}
            <span style="font-size:10px;color:var(--text-muted);">${esc(res.type||'General')}</span>
            ${scopeData ? `<span class="pill tiny" style="background:${statusColor}22;color:${statusColor};border:1px solid ${statusColor}44;font-size:8px;">${esc(scopeData.status)}</span>` : ''}
            ${!res.isLocked ? `
                <button class="card-delete-btn" style="position:static;" 
                        onclick="event.stopPropagation();OL.universalDelete('${res.id}','resources')">
                    <i data-lucide="x" style="width:12px;height:12px;"></i>
                </button>` : ''}
        </div>
    `;
};

export function clearResourceFilters() {
    state.libSearch = "";
    state.libTypeFilter = "";
    // Reset inputs manually for immediate visual feedback
    document.getElementById('lib-filter-input').value = "";
    document.getElementById('lib-filter-type').selectedIndex = 0;
    document.getElementById('lib-filter-app').selectedIndex = 0;
    document.getElementById('lib-filter-data-tag').selectedIndex = 0;
    OL.syncResourceLibraryFilters();
};

export async function universalCreate(type, options = {}) {
    const { name: predefinedName, linkToWfId, insertIdx } = options;
    
    const name = predefinedName || prompt(`Enter ${type} Name:`);
    if (!name) return null;

    const context = OL.getCurrentContext();
    const client = getActiveClient();
    const timestamp = Date.now();
    const newId = context.isMaster ? `res-vlt-${timestamp}` : `local-prj-${timestamp}`;

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

    await OL.updateAndSync(() => {
        // 🛡️ Always push to the correct array directly
        if (context.isMaster) {
            if (!state.master.resources) state.master.resources = [];
            state.master.resources.push(newRes);
        } else if (client) {
            if (!client.projectData.localResources) client.projectData.localResources = [];
            client.projectData.localResources.push(newRes);
            // Keep the bridge in sync
            client.projectData.resources = client.projectData.localResources;
        }

        if (linkToWfId) {
            const wf = (context.isMaster ? state.master : client.projectData)
                .workflows?.find(w => String(w.id) === String(linkToWfId));
            if (wf) {
                if (!wf.steps) wf.steps = [];
                wf.steps.splice(insertIdx ?? wf.steps.length, 0, {
                    id: uid(),
                    resourceLinkId: newId
                });
            }
        }
    });

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
export function promptBulkReclassify(oldType) {
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

export function openResourceTypeManager() {
    const registry = state.master.resourceTypes || [];
    const masterFunctions = state.master.functions || [];
    const quickIcons = ["zap", "file-text", "mail", "calendar", "plug-2", "book-open", "home", "message-square", "wrench", "target", "bot", "trending-up", "folder", "table-2", "pen-tool", "clipboard-list", "database", "users", "star", "flag"];

    let html = `
        <div class="modal-head" style="display:flex; align-items:center; gap:12px;">
            <i data-lucide="settings" style="width:20px; height:20px; color:var(--accent);"></i>
            <div class="modal-title-text">Manage Resource Types</div>
        </div>
        <div class="modal-body">
            <p class="tiny muted" style="margin-bottom:20px;">
                Click an icon in the quick grid to assign it. Changes pull through to all resource cards immediately.
            </p>
            
            <div class="dp-manager-list" style="max-height:400px; overflow-y:auto;">
                ${registry.map(t => {
                    const encType = btoa(t.type);
                    const currentIcon = t.lucideIcon || 'settings';
                    return `
                    <div class="dp-manager-row type-editor-row" 
                         id="type-row-${t.typeKey}"
                         style="display:flex; align-items:center; gap:10px; padding:10px 0; border-bottom:1px solid var(--line);">
                        
                        <div id="type-icon-preview-${t.typeKey}"
                             style="width:32px; height:32px; display:flex; align-items:center; justify-content:center;
                                    background:rgba(var(--accent-rgb),0.1); border:1px solid var(--accent);
                                    border-radius:6px; flex-shrink:0; cursor:pointer;"
                             onclick="OL._openIconPicker('${t.typeKey}')">
                            <i data-lucide="${currentIcon}" style="width:16px; height:16px; color:var(--accent);"></i>
                        </div>

                        <span contenteditable="true" 
                              style="flex:1; font-weight:600; outline:none; font-size:13px;"
                              onblur="OL.renameResourceTypeFlat('${encType}', this.innerText)">
                            ${esc(t.type)}
                        </span>
                        
                        <select class="modal-input tiny" style="width:140px;"
                                onchange="OL.updateResourceTypeProp('${t.typeKey}', 'matchedFunctionId', this.value)">
                            <option value="">-- No Auto-Lock --</option>
                            ${masterFunctions.map(f => `
                                <option value="${f.id}" ${t.matchedFunctionId === f.id ? 'selected' : ''}>
                                    ${esc(f.name)}
                                </option>
                            `).join('')}
                        </select>

                        <button class="card-delete-btn" style="position:static;" 
                                onclick="OL.removeRegistryTypeByKey('${t.typeKey}')">
                            <i data-lucide="x" style="width:14px; height:14px;"></i>
                        </button>
                    </div>`;
                }).join('')}
            </div>

            <div style="margin-top:20px; padding-top:20px; border-top:1px solid var(--line);">
                <label class="modal-section-label">Add New Type</label>
                <div style="display:flex; gap:10px; margin-bottom:15px;">
                    <input type="text" id="new-type-icon" class="modal-input tiny" style="width:100px;" placeholder="Icon (e.g. zap)">
                    <input type="text" id="new-type-input" class="modal-input" style="flex:1;" placeholder="New Type Name...">
                    <button class="btn primary" onclick="OL.addNewResourceTypeFlat()">Add Type</button>
                </div>
                
                <div style="display:flex; flex-wrap:wrap; gap:6px;">
                    ${quickIcons.map(icon => `
                        <div style="cursor:pointer; padding:8px; background:var(--bg-card); border:1px solid var(--line); 
                                    border-radius:6px; display:flex; align-items:center; justify-content:center;
                                    transition:all 0.15s;"
                             title="${icon}"
                             onmouseover="this.style.borderColor='var(--accent)'; this.style.background='rgba(var(--accent-rgb),0.1)';"
                             onmouseout="this.style.borderColor='var(--line)'; this.style.background='var(--bg-card)';"
                             onclick="document.getElementById('new-type-icon').value='${icon}'; 
                                      const active = document.querySelector('.type-editor-row.icon-picker-active');
                                      if (active) {
                                          const key = active.id.replace('type-row-','');
                                          OL.updateResourceTypeProp(key, 'lucideIcon', '${icon}');
                                      }">
                            <i data-lucide="${icon}" style="width:14px; height:14px;"></i>
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>`;
    openModal(html);
    if (window.lucide) window.lucide.createIcons();
};

export function _openIconPicker(typeKey) {
    // Deactivate all rows
    document.querySelectorAll('.type-editor-row').forEach(r => r.classList.remove('icon-picker-active'));
    
    // Activate this row
    const row = document.getElementById(`type-row-${typeKey}`);
    if (row) {
        row.classList.add('icon-picker-active');
        row.style.background = 'rgba(var(--accent-rgb), 0.05)';
        row.style.borderRadius = '6px';
    }
};

export function renderHierarchySelectors(res, isVault) {
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

export function getAllIncomingLinks(targetResId, allResources) {
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

export function renderSopStepList(res) {
    const steps = res.steps || [];
    
    let html = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
            <label class="tiny muted bold uppercase" style="letter-spacing:1px; font-size:10px;">Step Sequence</label>
            <span class="tiny muted" style="font-size:9px; opacity:0.6;">💡 Drag items to re-order steps instantly</span>
        </div>
    `;

    if (steps.length === 0) {
        return html + `<div class="empty-hint p-10" style="text-align:center; opacity:0.5; font-size:11px; padding:20px;">No steps defined. Click Add Step to build your sequence.</div>`;
    }

    html += steps.map((step, idx) => {
        const outRules = (step.logic?.out || []).filter(l => l.targetId);
        const hasLinks = step.links?.length > 0;

        const icons = [];
        if (outRules.some(l => l.type === 'loop'))      icons.push('↺');
        if (outRules.some(l => l.type === 'delay'))     icons.push('⏱');
        if (outRules.some(l => l.type === 'condition') || outRules.length > 1) icons.push('◆');
        else if (outRules.length === 1 && !icons.length) icons.push('→');
        
        const logicIcon = icons.map(ic =>
            `<span class="pill tiny accent" style="font-size:8px; padding:1px 5px; background:rgba(61,217,197,0.1); color:#3dd9c5; border:1px solid rgba(61,217,197,0.2); font-weight:bold;">${ic}</span>`
        ).join('');

        return `
            <div style="margin-bottom:6px; border:1px solid var(--line); border-radius:6px; overflow:hidden;">
                <div class="v2-step-item sop-step-row"
                     draggable="true"
                     ondragstart="OL.handleStepDragStart(event, '${res.id}', ${idx})"
                     ondragover="event.preventDefault(); event.stopPropagation(); this.classList.add('drag-over')"
                     ondragleave="this.classList.remove('drag-over')"
                     ondrop="this.classList.remove('drag-over'); OL.handleStepDrop(event, '${res.id}', ${idx})"
                     style="display:flex; align-items:center; gap:10px; padding:10px 12px; user-select:none;">
                    
                    <span class="drag-handle" style="cursor:grab; opacity:0.3; font-size:14px;">⠿</span>
                    <div class="step-number-circle" style="width:20px; height:20px; font-size:10px; flex-shrink:0;
                         background:rgba(255,255,255,0.05); border:1px solid var(--line); color:var(--text-muted);
                         display:flex; align-items:center; justify-content:center; border-radius:50%; font-weight:bold;">
                        ${idx + 1}
                    </div>
                    
                    <div style="flex:1; min-width:0; cursor:pointer;"
                         onclick="event.stopPropagation(); OL.toggleInlineStepEditor('${res.id}', '${step.id}')">
                        <div class="bold" style="font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                            ${esc(step.name || 'Untitled Step')}
                        </div>
                        <div style="display:flex; gap:4px; align-items:center; margin-top:2px; flex-wrap:wrap;">
                            ${step.appName ? `<span class="tiny accent" style="font-size:9px;">${esc(step.appName)}</span>` : ''}
                            ${logicIcon}
                            ${hasLinks ? `<span class="pill tiny soft" style="font-size:7px; padding:0 3px;">
                                <i data-lucide="link-2" style="width:8px; height:8px;"></i>
                            </span>` : ''}
                        </div>
                    </div>
                    
                    <div style="display:flex; align-items:center; gap:6px; flex-shrink:0;">
                        <button class="btn tiny soft" onclick="event.stopPropagation(); OL.toggleInlineStepEditor('${res.id}', '${step.id}')"
                                style="font-size:10px; padding:3px 8px; display:flex; align-items:center; gap:4px;">
                            <i data-lucide="sliders-horizontal" style="width:11px; height:11px; opacity:0.6;"></i> Configure
                        </button>
                        <button onclick="event.stopPropagation(); OL.deleteStep('${res.id}','${step.id}')"
                                style="width:20px; height:20px; border:none; background:none; cursor:pointer;
                                       color:var(--text-muted); display:flex; align-items:center; justify-content:center;
                                       border-radius:4px; transition:all 0.15s;"
                                onmouseover="this.style.color='#ef4444'; this.style.background='rgba(239,68,68,0.05)';"
                                onmouseout="this.style.color='var(--text-muted)'; this.style.background='none';">
                            <i data-lucide="trash-2" style="width:12px; height:12px;"></i>
                        </button>
                    </div>
                </div>
                
                <div id="fvi-inline-step-editor-${step.id}" 
                     style="display:none; border-top:1px solid var(--line); padding:15px;"></div>
            </div>
        `;
    }).join('');

    return html;
};
export function toggleInlineStepEditor(resId, stepId) {
    const drawer = document.getElementById(`fvi-inline-step-editor-${stepId}`);
    if (!drawer) return;

    const isOpen = drawer.style.display === 'block';

    document.querySelectorAll('.inline-step-sub-drawer, [id^="fvi-inline-step-editor-"]').forEach(el => {
        if (el.id !== `fvi-inline-step-editor-${stepId}`) {
            el.style.display = 'none';
            el.innerHTML = '';
        }
    });

    if (isOpen) {
        drawer.style.display = 'none';
        drawer.innerHTML = '';
        return;
    }

    const data = OL.getCurrentProjectData();
    const res  = (data.resources || []).find(r => String(r.id) === String(resId));
    const step = res?.steps?.find(s => String(s.id) === String(stepId));
    if (!step) return;

    if (!step.logic) step.logic = { in: [], out: [] };
    if (!step.assignees) step.assignees = [];

    drawer.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:12px;">
            <div>
                <label class="modal-section-label">Move to resource</label>
                <select class="modal-input tiny" style="width:100%;"
                        onchange="if(this.value) OL.executeStepMove('${resId}', '${stepId}', this.value); this.value='';">
                    <option value="">— Keep in ${esc(res?.name || 'current resource')} —</option>
                    <optgroup label="Same stage">
                        ${(OL.getCurrentProjectData().resources || [])
                            .filter(r => String(r.id) !== String(resId) && r.stageId === res?.stageId)
                            .sort((a,b) => a.name.localeCompare(b.name))
                            .map(r => `<option value="${r.id}">${esc(r.name)} (${(r.steps||[]).length} steps)</option>`)
                            .join('')}
                    </optgroup>
                    <optgroup label="All resources">
                        ${(OL.getCurrentProjectData().resources || [])
                            .filter(r => String(r.id) !== String(resId) && r.stageId !== res?.stageId)
                            .sort((a,b) => a.name.localeCompare(b.name))
                            .map(r => `<option value="${r.id}">${esc(r.name)} (${(r.steps||[]).length} steps)</option>`)
                            .join('')}
                    </optgroup>
                </select>
            </div>
            <div>
                <label class="modal-section-label">Primary App</label>
                ${step.appId ? `
                    <div style="display:flex; align-items:center; justify-content:space-between; padding:6px 10px;
                                background:rgba(255,255,255,0.04); border:1px solid var(--line); border-radius:6px;">
                        <span style="font-size:12px;">
                            <i data-lucide="${a.type === 'person' ? 'user' : a.type === 'app' ? 'smartphone' : 'users'}" 
                           style="width:10px; height:10px;"></i>
                        ${esc(a.name)}</span>
                        <i data-lucide="x" class="is-clickable" style="width:12px; height:12px; opacity:0.4;"
                           onclick="event.stopPropagation(); OL.updateAppMetadataInline('${resId}', '${stepId}', null, null)"></i>
                    </div>
                ` : `
                    <div style="position:relative;">
                        <input type="text" class="modal-input tiny" style="width:100%; box-sizing:border-box; margin:0;"
                               placeholder="Search apps..."
                               onfocus="OL.filterInlineAppSearch('${resId}', '${stepId}', '')"
                               oninput="OL.filterInlineAppSearch('${resId}', '${stepId}', this.value)">
                        <div id="inline-app-results-${stepId}" class="search-results-overlay"></div>
                    </div>
                `}
            </div>
    
            <div>
                <label class="modal-section-label">Assigned To</label>
                <div style="display:flex; flex-wrap:wrap; gap:4px; margin-bottom:6px;">
                    ${step.assignees.length > 0 ? step.assignees.map((a, i) => `
                        <span class="pill tiny soft" style="display:inline-flex; align-items:center; gap:4px;">
                            ${esc(a.name)}
                            <b style="cursor:pointer; opacity:0.5;"
                               onclick="event.stopPropagation(); OL.removeInlineAssignee('${resId}', '${stepId}', ${i})">×</b>
                        </span>
                    `).join('') : ''}
                </div>
                <div style="position:relative;">
                    <input type="text" class="modal-input tiny" style="width:100%; box-sizing:border-box; margin:0;"
                           placeholder="Add assignee..."
                           onfocus="OL.filterInlineAssignmentSearch('${resId}', '${stepId}', '')"
                           oninput="OL.filterInlineAssignmentSearch('${resId}', '${stepId}', this.value)">
                    <div id="inline-assign-results-${stepId}" class="search-results-overlay"></div>
                </div>
            </div>
    
            <div style="display:flex; align-items:center; gap:10px;">
                <label class="modal-section-label" style="margin:0; white-space:nowrap;">Timing offset</label>
                <input type="number" class="modal-input tiny" style="width:60px; margin:0;" value="${step.timingValue || 0}"
                       onblur="OL.updateAtomicStep('${resId}', '${stepId}', 'timingValue', parseInt(this.value) || 0)">
                <span class="tiny muted">days after previous</span>
            </div>
    
            <div>
                <label class="modal-section-label">Outbound logic</label>
                <div style="display:flex; flex-direction:column; gap:6px;">
                    ${(step.logic.out || []).map((l, i) => OL.renderLogicBlock(resId, stepId, 'out', i, l, [])).join('')}
                </div>
                <button class="btn tiny soft" style="margin-top:6px; display:inline-flex; align-items:center; gap:4px;"
                        onclick="event.stopPropagation(); OL.addInlineStepLogic('${resId}', '${stepId}', 'out')">
                    <i data-lucide="plus" style="width:11px; height:11px;"></i> Add output path
                </button>
            </div>
    
        </div>
    `;
    drawer.style.display = 'block';
    if (window.lucide) lucide.createIcons();
};

export function filterInlineAppSearch(resId, stepId, query) {
    const overlay = document.getElementById(`inline-app-results-${stepId}`);
    if (!overlay) return;
    const q = (query || '').toLowerCase().trim();
    const client = getActiveClient();
    const matches = (client?.projectData?.localApps || []).filter(a => a.name.toLowerCase().includes(q));
    overlay.innerHTML = matches.length 
        ? matches.map(app => `
            <div class="search-result-item"
                 onmousedown="event.preventDefault(); OL.updateAppMetadataInline('${resId}', '${stepId}', '${app.id}', '${esc(app.name)}')">
                💻 ${esc(app.name)}
            </div>`).join('')
        : '<div class="p-10 tiny muted">No tools found.</div>';
    overlay.style.display = 'block';
};

export function filterInlineAssignmentSearch(resId, stepId, query) {
    const overlay = document.getElementById(`inline-assign-results-${stepId}`);
    if (!overlay) return;
    const q = (query || '').toLowerCase().trim();
    const matches = OL.getFilteredAssigneeOptions(q);
    overlay.innerHTML = matches.length
        ? matches.map(item => `
            <div class="search-result-item"
                 onmousedown="event.preventDefault(); OL.addInlineAssignee('${resId}', '${stepId}', '${item.id}', '${esc(item.name)}', '${item.type}')">
                ${item.icon} ${esc(item.name)}
            </div>`).join('')
        : '<div class="p-10 tiny muted">No matches found.</div>';
    overlay.style.display = 'block';
};

export function updateAppMetadataInline(resId, stepId, appId, appName) {
    const data = OL.getCurrentProjectData();
    const res  = (data.resources || []).find(r => String(r.id) === String(resId));
    const step = res?.steps?.find(s => String(s.id) === String(stepId));
    if (!step) return;
    step.appId   = appId;
    step.appName = appName;
    OL.persist();
    OL.toggleInlineStepEditor(resId, stepId);
    OL.toggleInlineStepEditor(resId, stepId);
};

export function addInlineAssignee(resId, stepId, assigneeId, assigneeName, type) {
    const data = OL.getCurrentProjectData();
    const res  = (data.resources || []).find(r => String(r.id) === String(resId));
    const step = res?.steps?.find(s => String(s.id) === String(stepId));
    if (!step) return;
    if (!step.assignees) step.assignees = [];
    if (!step.assignees.some(a => a.id === assigneeId)) {
        step.assignees.push({ id: assigneeId, name: assigneeName, type });
        OL.persist();
    }
    OL.toggleInlineStepEditor(resId, stepId);
    OL.toggleInlineStepEditor(resId, stepId);
};

export function removeInlineAssignee(resId, stepId, idx) {
    const data = OL.getCurrentProjectData();
    const res  = (data.resources || []).find(r => String(r.id) === String(resId));
    const step = res?.steps?.find(s => String(s.id) === String(stepId));
    if (!step?.assignees) return;
    step.assignees.splice(idx, 1);
    OL.persist();
    OL.toggleInlineStepEditor(resId, stepId);
    OL.toggleInlineStepEditor(resId, stepId);
};

export function addInlineStepLogic(resId, stepId, direction) {
    const data = OL.getCurrentProjectData();
    const res  = (data.resources || []).find(r => String(r.id) === String(resId));
    const step = res?.steps?.find(s => String(s.id) === String(stepId));
    if (!step) return;
    if (!step.logic) step.logic = { in: [], out: [] };
    step.logic[direction].push({ type: 'next', targetId: null, rule: '' });
    OL.persist();
    OL.toggleInlineStepEditor(resId, stepId);
    OL.toggleInlineStepEditor(resId, stepId);
};
        
export function deleteStep(resId, stepId) {
    if (!confirm('Delete this step?')) return;
    const data = OL.getCurrentProjectData();
    // Try both keys since your app uses localResources in some places
    const allRes = [...(data.resources || []), ...(data.localResources || [])];
    const res = allRes.find(r => String(r.id) === String(resId));
    if (!res) { console.error('Resource not found:', resId); return; }
    const before = res.steps?.length;
    res.steps = (res.steps || []).filter(s => String(s.id) !== String(stepId));
    console.log(`Deleted step ${stepId} from ${res.name}: ${before} → ${res.steps.length}`);
    OL.persist();
    OL.openResourceModal(resId);
};

export function addStepLogic(resId, stepId, dir) {
    const data = OL.getCurrentProjectData();
    const res  = (data.resources || []).find(r => String(r.id) === String(resId));
    const step = res?.steps?.find(s => String(s.id) === String(stepId));
    if (!step) return;
    if (!step.logic) step.logic = { in: [], out: [] };
    if (!step.logic[dir]) step.logic[dir] = [];

    // Auto-fill next sequential step as default target
    let defaultTargetId = '';
    if (dir === 'out') {
        const stepIdx = res.steps.indexOf(step);
        const nextStep = res.steps[stepIdx + 1];
        if (nextStep) defaultTargetId = `${resId}-${nextStep.id}`;
    }

    step.logic[dir].push({
        type: 'next',
        targetId: defaultTargetId,
        rule: '',
        loopLimit: '',
        delayValue: '',
        delayUnit: 'days'
    });

    OL.persist();
    OL._fvRefreshInspector(resId, stepId);
};

export function goToStepFromLibrary(resId, stepId) {
    // 1. Detect if we are currently in the Vault/Master view
    const isVaultMode = window.location.hash.includes('vault');
    
    // 2. Close the current Modal
    OL.closeModal();

    // 3. Set the Map focus in memory
    state.focusedResourceId = resId;
    sessionStorage.setItem('active_resource_id', resId);
    
    // 4. Save the return path so the "Back" button works later
    sessionStorage.setItem('map_return_path', window.location.hash.split('?')[0]);

    // 5. Navigate to the CORRECT Map based on context
    if (isVaultMode) {
        window.location.hash = '#/vault/visualizer';
    } else {
        window.location.hash = '#/visualizer';
    }

    // 6. Wait for the map to render, then snap to node and open sidebar
    setTimeout(() => {
        // Ensure the visualizer renders the correct context
        if (typeof OL.renderVisualizer === 'function') {
            OL.renderVisualizer(isVaultMode);
        }

        if (typeof OL.centerCanvasNode === 'function') {
            OL.centerCanvasNode(resId);
        }
        
        // Open the Inspector for the specific step
        OL.openInspector(resId, stepId);
    }, 150);
};

// 1. Add New Type
export function addNewResourceTypeFlat() {
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
export function renameResourceTypeFlat(oldNameEncoded, newName) {
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
export function updateResourceTypeProp(typeKey, prop, value) {
    const registry = state.master.resourceTypes || [];
    const entry = registry.find(t => t.typeKey === typeKey);
    if (entry) {
        entry[prop] = value;
        OL.persist();

        // Live update the icon preview in the modal if it's open
        if (prop === 'lucideIcon') {
            const preview = document.getElementById(`type-icon-preview-${typeKey}`);
            if (preview) {
                preview.innerHTML = `<i data-lucide="${value}" style="width:16px; height:16px; color:var(--accent);"></i>`;
                if (window.lucide) lucide.createIcons();
            }
            // Deactivate picker state
            document.querySelectorAll('.type-editor-row').forEach(r => {
                r.classList.remove('icon-picker-active');
                r.style.background = '';
                r.style.borderRadius = '';
            });
        }
    }
};

//4. Remove Type
export function removeRegistryTypeByKey(typeKey) {
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

export function closeResourceTypeManager() {
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

// ---- bridge: keep OL.*/window.* calls working until callers import directly ----
window.OL = window.OL || {};
Object.assign(window.OL, {
    syncResourceLibraryFilters, renderResourceGroups, _renderResourceListRow,
    clearResourceFilters, universalCreate, promptBulkReclassify,
    openResourceTypeManager, _openIconPicker, renderHierarchySelectors,
    toggleInlineStepEditor, filterInlineAppSearch, filterInlineAssignmentSearch,
    updateAppMetadataInline, addInlineAssignee, removeInlineAssignee,
    addInlineStepLogic, deleteStep, addStepLogic, goToStepFromLibrary,
    addNewResourceTypeFlat, renameResourceTypeFlat, updateResourceTypeProp,
    removeRegistryTypeByKey, closeResourceTypeManager
});
// Called bare from sections still living in app.js (and from
// features/resources-modal.js) — bridge onto window directly.
window.renderResourceManager = renderResourceManager;
window.getAllIncomingLinks = getAllIncomingLinks;
window.renderSopStepList = renderSopStepList;
