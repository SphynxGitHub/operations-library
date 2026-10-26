//======================= FEATURES / RESOURCES MODAL =======================//
// Extracted from app.js "RESOURCE CARD AND MODAL".
// Owns: the resource detail modal — the biggest single piece of the app
// (hierarchy tree, email template editor, file containers, edit history,
// signature linking, master push/import, universal delete) — plus the
// vault rates page, which was tucked in at the tail of this section in
// the original file.
// Companion to features/resources-grid.js (see that file's header note
// about the circular renderResourceManager <-> renderResourceCard calls).

import { state, esc, num, uid, getActiveClient, persist, db, decodeEntities } from '../core/data.js';
import { evaluateCondition, renderFieldInput } from '../core/field-schema.js';
import { renderDependencyRow } from './scoping.js';
import { RESOURCE_STATUSES, RESOURCE_STATUS_COLORS, normalizeResourceStatus } from '../core/resource-status.js';

// A resource's own status: Pending, In Process, Built or In Review (core/resource-status.js). Pending when it is
// created; In Process / Built / In Review follow its requests and tasks automatically, and can also be set by hand.
// This is separate from the request's own Do Now / Do Later / Don't Do / Done and from task statuses.
OL.openEditResourceStatusDropdown = function(event, resourceId) {
    const data = OL.getCurrentProjectData();
    const res = data?.resources?.find(r => String(r.id) === String(resourceId));
    if (OL.isReferenceResource(res)) return;   // references have no status
    const popover = OL.createPopoverContainer(event);
    const currentStatus = normalizeResourceStatus(res?.status);

    popover.innerHTML = `
        <div class="tiny bold uppercase muted" style="margin-bottom:6px; padding:2px 4px;">Update Status</div>
        <div style="display:grid; gap:4px; max-height:260px; overflow-y:auto;">
            ${RESOURCE_STATUSES.map(name => `
                <button class="btn tiny soft"
                        style="display:flex; align-items:center; gap:8px; width:100%; text-align:left; justify-content:flex-start; padding:6px 8px; ${currentStatus === name ? 'border:1px solid var(--accent); background:rgba(var(--accent-rgb),0.1);' : ''}"
                        onclick="OL.handleResourceSave('${resourceId}', 'status', '${esc(name)}'); OL.closePopoverDropdown();">
                    <span style="width:8px; height:8px; border-radius:50%; background:${RESOURCE_STATUS_COLORS[name]}; flex-shrink:0;"></span>
                    <span style="flex:1;">${esc(name)}</span>
                    ${currentStatus === name ? '<i data-lucide="check" style="width:12px;height:12px;color:var(--accent);"></i>' : ''}
                </button>
            `).join('')}
        </div>
    `;
    if (window.lucide) lucide.createIcons();
};

// A description as it should appear on screen and in the PDF: formatting kept (bold, italics, lists, links, line
// breaks) when it has any, cleaned by the app's shared sanitizer, and plain text shown as plain text with its
// line breaks. Returns HTML that is safe to place in a page.
OL.resourceDescriptionHtml = function(text) {
    const raw = String(text ?? '').trim();
    if (!raw) return '';
    const hasMarkup = /<\/?[a-z][a-z0-9]*(\s[^>]*)?\/?>/i.test(raw);
    if (hasMarkup && typeof OL.sanitizeCommentHtml === 'function') return OL.sanitizeCommentHtml(raw);
    return esc(raw).replace(/\r?\n/g, '<br>');
};

// Small shared pill so the card/list renderers below don't each duplicate
// the color lookup and click wiring.
// References (the old "Admin" type, and anything pinned into the References section) are
// look-up material, not work, so they have no status.
OL.isReferenceResource = function(res) {
    return !!res && (res.type === 'Reference' || res.type === 'Admin' || !!res.systemPinned || !!res.adminPinned);
};

OL.renderResourceStatusPill = function(res) {
    if (OL.isReferenceResource(res)) return '';
    const statusName = normalizeResourceStatus(res.status);
    const color = RESOURCE_STATUS_COLORS[statusName] || 'var(--accent)';
    return `<span class="pill tiny" style="background:${color}22; color:${color}; border:1px solid ${color}44; font-size:8px; font-weight:bold; padding:2px 6px; cursor:pointer; white-space:nowrap;" onclick="event.stopPropagation(); OL.openEditResourceStatusDropdown(event, '${res.id}')" title="Click to change status">${esc(statusName)}</span>`;
};

export function renderResourceCard(res, opts = {}) {
    if (!res) return "";
    const compact = !!opts.compact;
    
    // 1. Resolve Live Scoping Data
    const scopeData = OL.getScopingDataForResource(res.id);
    const isMaster = String(res.id || "").startsWith("res-vlt-") || !!res.masterRefId;
    const isActive = state.focusedResourceId === res.id;

    // 2. Map Status to Colors
    const statusColors = { 
        'Do Now': '#38bdf8',    // Cyan
        'Done': '#22c55e',      // Green
        'Do Later': '#fbbf24',  // Amber
        "Don't Do": '#ef4444',  // Red
        'Default': 'var(--color-scoping)' 
    };
    
    const statusColor = scopeData ? (statusColors[scopeData.status] || statusColors.Default) : 'transparent';

    // 3. Family Numbering
    const numberingHtml = OL.getPartNumberHtml ? OL.getPartNumberHtml(res) : '';

    const tagStyle = isMaster 
        ? "background: var(--accent); color: #000;" 
        : "background: var(--panel-border); color: var(--text-dim); border: 1px solid var(--line);";

    return `
        <div class="card is-clickable ${compact ? 'small' : ''} ${scopeData ? 'is-priced' : ''} ${isActive ? 'is-active' : ''}" 
             id="res-card-${res.id}"
             onclick="OL.selectResourceCard('${res.id}')"
             style="${scopeData ? `border-left: 4px solid ${statusColor} !important;` : ''} opacity:${res.isArchived ? '0.5' : '1'}; padding: 10px; display: flex; flex-direction: column; justify-content: space-between; gap: 8px;">
            
            <!-- Header: Text-wrapping Title & Actions -->
            <div class="card-header" style="display:flex; justify-content: space-between; align-items: flex-start; gap: 6px;">
                ${opts.selectable ? `<input type="checkbox" data-res-sel="${esc(res.id)}" ${OL.bulkResourceSelection?.[res.id] ? 'checked' : ''} style="margin-top:2px; flex-shrink:0;"
                       onclick="event.stopPropagation()" onchange="OL.toggleResourceSelect('${esc(res.id)}', this.checked)" title="Select for bulk update">` : ''}
                <div class="card-title" style="flex:1; font-weight:600; font-size: 12px; line-height: 1.35; word-break: break-word; white-space: normal;">
                    ${esc(res.name || "Unnamed")}
                </div>
                
                <!-- Action Controls -->
                <div class="card-actions" style="display:flex; align-items:center; gap:3px; flex-shrink:0;">
                    ${(!isMaster && getActiveClient()?.meta?.status === 'Partner') ? `
                        <button class="card-delete-btn" onclick="event.stopPropagation(); OL.openPushLocalItemToClientModal('resource', '${res.id}')" title="Push to a client" style="position:static; padding:2px;">
                            <i data-lucide="send" style="width:11px;height:11px;"></i>
                        </button>
                    ` : ''}
                    <button class="card-delete-btn" onclick="event.stopPropagation(); OL.duplicateResourceV2('${res.id}');" title="Duplicate (with all its steps)" style="position:static; padding:2px;">
                        <i data-lucide="copy" style="width:11px;height:11px;"></i>
                    </button>
                    <button class="card-delete-btn" 
                            onclick="event.stopPropagation(); OL.handleResourceSave('${res.id}', 'isArchived', ${!res.isArchived}); renderResourceManager();"
                            title="${res.isArchived ? 'Unarchive' : 'Archive'}"
                            style="position:static; padding:2px; color:${res.isArchived ? '#ef4444' : 'var(--text-muted)'};">
                        <i data-lucide="${res.isArchived ? 'archive-restore' : 'archive'}" style="width:11px;height:11px;"></i>
                    </button>
                    ${res.isLocked ? '' : `<button class="card-delete-btn" style="position:static; padding:2px;" onclick="event.stopPropagation(); OL.universalDelete('${res.id}', 'resources')">×</button>`}
                </div>
            </div>

            <!-- Middle: Wrapping Tags & Badges -->
            <div class="card-badges" style="display:flex; flex-wrap:wrap; align-items:center; gap:4px; margin-top: 2px;">
                ${numberingHtml}
                ${OL.renderResourceStatusPill(res)}
                ${typeof OL.resourceTagsHtml === 'function' ? OL.resourceTagsHtml(res) : ''}
                ${typeof OL.updatedPillHtml === 'function' ? OL.updatedPillHtml(res, { showUnknown: false, withName: true }) : ''}
                <span class="vault-tag" style="${tagStyle} padding: 1px 5px; font-size: 7.5px; border-radius: 3px; font-weight: bold;">
                    ${isMaster ? 'MASTER' : 'LOCAL'}
                </span>
                ${res.isArchived ? `<span style="font-size:7.5px;font-weight:700;padding:1px 5px;border-radius:3px;background:rgba(239,68,68,0.1);color:#ef4444;border:1px solid rgba(239,68,68,0.3);">Archived</span>` : ''}
            </div>

            <!-- Footer: Base Meta & Scoping Info -->
            <div class="card-body" style="margin-top: auto; padding-top: 4px; border-top: 1px solid rgba(255,255,255,0.05);">
                <div style="display:flex; justify-content:space-between; align-items:flex-end; gap:6px;">
                    <div>
                        <div class="tiny accent bold uppercase" style="font-size: 7.5px; letter-spacing: 0.5px; opacity: 0.8;">
                            ${esc(res.archetype || "Base")}
                        </div>
                        <div class="tiny muted" style="font-size:9.5px; opacity:0.6; display:flex; align-items:center; gap:3px;">
                            ${OL.getLucideSVG(OL.getRegistryIcon(res.type), 10, 'currentColor')}
                            ${esc(res.type || 'General')}
                        </div>
                    </div>

                    ${scopeData ? `
                    <div style="display:flex; flex-direction:column; align-items:flex-end; gap:2px;">
                        <div class="pill tiny" style="background:${statusColor}22; color:${statusColor}; border:1px solid${statusColor}44; font-size:7.5px; font-weight:bold; padding: 1px 4px;">
                            ${(scopeData.status || "PENDING").toUpperCase()}
                        </div>
                        <div class="tiny muted bold" style="font-size: 7.5px; opacity: 0.5; display:flex; align-items:center; gap:2px;">
                            <i data-lucide="user" style="width:8px; height:8px;"></i>
                            ${esc(scopeData.responsibleParty || 'TBD')}
                        </div>
                    </div>
                ` : `
                    <div class="tiny muted italic" style="font-size: 7.5px; opacity: 0.3;">Not Scoped</div>
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

    // 1b. Request-only scoping lines (meetings, training, audits with no library
    // resource) carry a synthetic 'reqline-' id. Resolve them from the sheet so fee
    // maths and reports treat them like any other line.
    if (cleanId.startsWith('reqline-')) {
        if (isVault) return null;
        for (const sh of (client?.projectData?.scopingSheets || [])) {
            const li = (sh.lineItems || []).find(i => String(i.resourceId) === cleanId);
            if (li) {
                return {
                    id: cleanId,
                    name: li.name || 'Request',
                    type: 'Request',
                    description: li.notes || '',
                    data: {},
                    isRequestLine: true
                };
            }
        }
        return null;
    }

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
    if (!state.v2) state.v2 = {}; 
    if (!state.v2.activeCommentTab || state.v2.activeCommentTab === 'internal' || state.v2.activeCommentTab === 'client') state.v2.activeCommentTab = 'comments';
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
        lineItem = sheet?.lineItems?.find(i => String(i.id) === String(targetId));
        const lookupId = lineItem ? lineItem.resourceId : targetId;
        res = OL.getResourceById(lookupId);
    }

    if (!res) return;
    // the external link lives in one field, externalUrl; a link saved by the old sidebar field is carried across
    if (res.externalLink !== undefined) {
        if (!res.externalUrl && res.externalLink) res.externalUrl = res.externalLink;
        delete res.externalLink;
        OL.persist();
    }
    const activeData = lineItem || res;

    // 🧠 2. AUTO-MAPPING LOGIC (The New Brain)
    const rawType = String(res.type || 'General');
    const typeDef = (state.master.resourceTypes || []).find(t => t.type.toLowerCase() === rawType.toLowerCase());

    const isLockedByType = !!(typeDef && typeDef.matchedFunctionId);
    const isLockedByManual = !!res.matchedFunctionId;
    const isZap = rawType.toLowerCase() === 'zap';
    const isNaming = res.name === "Naming Conventions";
    const isHierarchy = res.name === "Folder Hierarchy";
    // Naming Conventions was provisioned with isContainer: true, which used
    // to route it into the Compliance Documents file list instead of its own
    // naming form. Container-ness only means "file list" for other resources.
    const isCompliance = res.name === "Compliance Documents" || (res.isContainer && !isNaming && !isHierarchy);
    const hierarchyRes = isNaming
        ? (getActiveClient()?.projectData?.localResources || []).find(r => r.name === "Folder Hierarchy") || null
        : null;
    if (isNaming || isHierarchy) OL.repairNamingAndHierarchyTemplates(getActiveClient());

    const allowedWorkflowTypes = ['workflow', 'zap', 'email campaign'];
    const showWorkflowSteps = allowedWorkflowTypes.includes(String(res.type || '').toLowerCase());

    // 1. Identify what the "Standard" tool should be
    const autoApp = (isLockedByType || isLockedByManual) && !isZap ? OL.getAppByFunction(rawType, res.matchedFunctionId) : null;

    // 🎯 2. THE OVERRIDE PROTECTION
    // We ONLY auto-assign if the field is currently EMPTY. 
    // If you manually picked an app, res.appId is no longer null, so this block is skipped.
    if (autoApp && !res.appId) {
        console.log(`🤖 Auto-assigning ${autoApp.name} to ${res.name}`);
        // 🐛 FIX: this was calling OL.handleResourceSave(), which — despite
        // this being explicitly meant as a silent background save — always
        // schedules a "refresh whatever's showing" callback once persist()
        // completes. Since persist() is debounced up to 1.5s, that callback
        // frequently fired well after the user had already closed this
        // modal and moved on, forcibly re-rendering the resources grid
        // back into view (and, depending on what filters were still set
        // from earlier, sometimes empty). res.appId/appName are already
        // set on the live object below, so all that's actually needed here
        // is to log it and persist — no refresh, silent means silent.
        OL.logResourceEdit(res.id, 'appId', res.appId, autoApp.id);
        OL.logResourceEdit(res.id, 'appName', res.appName, autoApp.name);
        res.appId = autoApp.id;
        res.appName = autoApp.name;
        OL.persist();
    }

    // 3. Determine UI state for the pill
    const isManualOverride = res.appId && autoApp && String(res.appId) !== String(autoApp.id);
        
        // 🚀 THE SIMPLIFIED CHECK
    // 1. Is the user an admin? (Checks both state and URL)
    const userIsAdmin = state.adminMode === true;

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
                ${[...new Set([...(state.master.resourceTypes || []).map(t => t.type), res.type].filter(t => t && t !== 'General'))].map(t => `
                    <option value="${esc(t)}" ${res.type === t ? "selected" : ""}>${esc(t)}</option>
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
            Back to Flow
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
            badge = `<span style="color:#ff9f43;font-size:9px;margin-left:5px;font-weight:bold;">AUTO</span>`;
        
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
            badge = `<span style="color:#ff9f43;font-size:9px;margin-left:5px;font-weight:bold;">AUTO</span>`;
        
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
    const linkedSOPs = (OL.masterGuidesFor ? OL.masterGuidesFor(getActiveClient()) : (state.master.howToLibrary || [])).filter(ht => 
        (ht.resourceIds || []).includes(res.masterRefId || res.id)
    );
    
    // --- COLLATERAL: everything this resource points at (linked resources, guides, and what its steps use) ---
    const splitRef = (ref) => { const i = OL._refSplitIdx ? OL._refSplitIdx(String(ref)) : String(ref).lastIndexOf('-'); return i === -1 ? [String(ref), ''] : [String(ref).substring(0, i), String(ref).substring(i + 1)]; };
    const findRes = (id) => allResources.find((r) => String(r.id) === String(id));
    const collateralSeen = new Set((resDeps || []).map((d) => String(d.id || d.resourceId || '')));
    const collateralRows = [];
    (res.steps || []).forEach((st, i) => {
        const refs = [...(st.links || []).map((l) => ({ id: l.id, name: l.name, type: l.type })),
                      ...(st.callouts || []).filter((c) => c && c.libId).map((c) => ({ id: c.libId, name: c.name, type: c.kind }))];
        refs.forEach((ref) => {
            const key = String(ref.id);
            if (!ref.id || key === String(res.id) || collateralSeen.has(key)) return;
            collateralSeen.add(key);
            const target = findRes(ref.id);
            collateralRows.push({ id: ref.id, name: (target && target.name) || ref.name || 'Resource', type: (target && target.type) || ref.type || 'Resource', note: `Step ${i + 1}: ${st.name || 'Unnamed step'}`, open: !!target, replaceable: !((st.links || []).some((l) => l && String(l.id) === key && /^(sop|guide)$/i.test(l.type || '')) ) });
        });
    });
    const collateralRowHtml = (r) => `
        <div style="display:flex;align-items:center;gap:12px;padding:10px 14px;border:1px solid var(--line);border-radius:8px;background:var(--panel-soft);${r.open ? 'cursor:pointer;' : ''}"
             ${r.open ? `onclick="OL.openResourceModal('${esc(r.id)}')"` : ''}>
            ${OL.getLucideSVG(OL.getRegistryIcon(r.type), 14, 'var(--accent)')}
            <div style="flex:1;min-width:0;">
                <div style="font-size:13px;line-height:1.4;">${esc(r.name)}</div>
                <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">${esc(r.note)}</div>
            </div>
            <span class="pill tiny soft" style="flex:0 0 auto;">${esc(String(r.type).toUpperCase())}</span>
            ${r.replaceable ? `<button class="btn tiny soft" style="flex:0 0 auto;display:flex;align-items:center;gap:6px;" title="Swap this collateral for another resource on this card" onclick="event.stopPropagation();OL.openReplaceCollateral('${esc(r.id)}','${esc(res.id)}')">
                <i data-lucide="replace" style="width:12px;height:12px;"></i> Replace
            </button>` : ''}
        </div>`;
    const guideRows = linkedSOPs.map((sop) => ({ id: sop.id, name: sop.name, type: 'Guide', note: 'Master guide', open: false }));

    // where this resource is used: every resource with a step that has it as collateral (or an email that attaches it)
    const referencedIn = [];
    allResources.forEach((other) => {
        if (!other || String(other.id) === String(res.id)) return;
        (other.steps || []).forEach((st, i) => {
            const hit = (st.callouts || []).some((c) => c && String(c.libId) === String(res.id)) || (st.links || []).some((l) => l && String(l.id) === String(res.id));
            if (hit) referencedIn.push({ parent: other, step: st, label: `Step ${i + 1}: ${st.name || 'Unnamed step'}` });
        });
        if ((other.emailAttachments || []).some((a) => a && String(a.libId) === String(res.id))) referencedIn.push({ parent: other, step: null, label: 'Attached to this email' });
    });
    const referencedRowHtml = (r) => `
        <div style="display:flex;align-items:center;gap:12px;padding:10px 14px;border:1px solid var(--line);border-radius:8px;background:var(--panel-soft);cursor:pointer;"
             onclick="OL.openResourceModal('${esc(r.parent.id)}')">
            ${OL.getLucideSVG(OL.getRegistryIcon(r.parent.type), 14, 'var(--accent)')}
            <div style="flex:1;min-width:0;">
                <div style="font-size:13px;line-height:1.4;">${esc(r.parent.name)}</div>
                <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">${esc(r.label)}</div>
            </div>
            <span class="pill tiny soft" style="flex:0 0 auto;">${esc(String(r.parent.type || 'Resource').toUpperCase())}</span>
            ${r.step ? `<button class="btn tiny soft" style="flex:0 0 auto;display:flex;align-items:center;gap:6px;" onclick="event.stopPropagation();OL.goToStepFromLibrary('${esc(r.parent.id)}','${esc(r.step.id)}')">
                <i data-lucide="mouse-pointer-2" style="width:12px;height:12px;"></i> View on map
            </button>` : ''}
        </div>`;
    const subLabel = (text, n) => `<div style="font-size:11px;font-weight:700;letter-spacing:0.06em;color:var(--text-muted);margin:14px 0 8px;">${text}${n === undefined ? '' : ` <span class="pill tiny soft">${n}</span>`}</div>`;

    const mergeReviewHtml = typeof OL.rmReviewSectionHtml === 'function' ? OL.rmReviewSectionHtml(res.id) : '';
    const collateralHtml = mergeReviewHtml + `
    <div class="card-section" style="margin-top:20px; border-top: 1px solid var(--line); padding-top:15px;">
        <label class="modal-section-label" style="display:flex; align-items:center; gap:6px;">
            <i data-lucide="paperclip" style="width:14px; height:14px;"></i> COLLATERAL
        </label>
        <div style="display:flex;align-items:center;gap:10px;margin:4px 0 0;">
            <div class="tiny muted" style="flex:1;">What this resource uses, and where it is used.</div>
            <button class="btn tiny soft" style="display:flex;align-items:center;gap:6px;" title="Use another resource everywhere this one is used" onclick="OL.openMergeResource('${esc(res.id)}')">
                <i data-lucide="merge" style="width:12px;height:12px;"></i> Merge into another resource
            </button>
        </div>
        ${subLabel('USES', resDeps.length + collateralRows.length + guideRows.length)}
        <div class="dp-manager-list" id="res-dependency-list">
            ${resDeps.map((dep) => renderDependencyRow(dep, res.id)).join('')}
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:${resDeps.length ? '8' : '0'}px;">
            ${[...collateralRows, ...guideRows].map(collateralRowHtml).join('')}
            ${(resDeps.length + collateralRows.length + guideRows.length) ? '' : '<div class="tiny muted" style="padding:6px 0;">No collateral yet.</div>'}
        </div>
        <div class="search-map-container" style="margin-top:12px; position:relative; display:flex; align-items:center;">
            <i data-lucide="search" style="position:absolute; left:10px; width:12px; height:12px; opacity:0.4;"></i>
            <input type="text" class="modal-input tiny" style="padding-left:30px;" placeholder="Add collateral from the library..."
                   onfocus="OL.filterDependencySearch('${res.id}', 'resource', '')"
                   oninput="OL.filterDependencySearch('${res.id}', 'resource', this.value)">
            <div id="res-dep-results" class="search-results-overlay"></div>
        </div>
        ${subLabel('REFERENCED IN', referencedIn.length)}
        <div style="display:flex;flex-direction:column;gap:8px;">
            ${referencedIn.length ? referencedIn.map(referencedRowHtml).join('') : '<div class="tiny muted" style="padding:6px 0;">Not used anywhere yet.</div>'}
        </div>
    </div>`;

    // --- PATHS: where this resource's steps lead (outbound) and what leads into it (inbound), as on the flow map sidebar ---
    const outboundPaths = [];
    const inboundPaths = [];
    const ruleBadge = (rule) => {
        const parts = [];
        if (rule.type === 'delay' || parseInt(rule.delayValue) > 0) parts.push(`Wait ${rule.delayValue || '?'} ${rule.delayUnit || 'days'}`);
        if (rule.type === 'loop') parts.push(`Loop${rule.loopLimit ? ` (${rule.loopLimit}x)` : ''}`);
        if (rule.rule && String(rule.rule).trim()) parts.push(`If: ${String(rule.rule).trim()}`);
        else if (rule.type === 'condition') parts.push('Conditional');
        return parts;
    };
    (res.steps || []).forEach((st, i) => {
        (st.logic?.out || []).filter((r) => r && r.targetId).forEach((rule) => {
            const [tResId, tStepId] = splitRef(rule.targetId);
            const tRes = findRes(tResId);
            const tStep = tRes && (tRes.steps || []).find((x) => String(x.id) === String(tStepId));
            if (!tRes || !tStep) return;
            const badge = ruleBadge(rule);
            if (String(tResId) === String(res.id) && !badge.length) return;   // plain step-to-step flow inside this resource is the steps list
            outboundPaths.push({ fromLabel: `Step ${i + 1}: ${st.name || 'Unnamed step'}`, toRes: tRes, toStep: tStep, badge, jumpRes: tResId, jumpStep: tStepId });
        });
    });
    allResources.forEach((other) => {
        if (String(other.id) === String(res.id)) return;
        (other.steps || []).forEach((st, i) => (st.logic?.out || []).filter((r) => r && r.targetId).forEach((rule) => {
            const [tResId, tStepId] = splitRef(rule.targetId);
            if (String(tResId) !== String(res.id)) return;
            const tStep = (res.steps || []).find((x) => String(x.id) === String(tStepId));
            inboundPaths.push({ fromRes: other, fromStep: st, fromIdx: i, toStep: tStep, badge: ruleBadge(rule), jumpRes: other.id, jumpStep: st.id });
        }));
    });
    const pathRowHtml = (title, sub, badge, jumpRes, jumpStep) => `
        <div style="display:flex;align-items:center;gap:12px;padding:10px 14px;border:1px solid var(--line);border-radius:8px;background:var(--panel-soft);">
            <div style="flex:1;min-width:0;">
                <div style="font-size:13px;line-height:1.4;">${esc(title)}</div>
                <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">${esc(sub)}</div>
                ${badge.length ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;">${badge.map((b) => `<span class="pill tiny" style="background:rgba(245,184,0,0.08);color:#f5b800;border:1px solid rgba(245,184,0,0.25);">${esc(b)}</span>`).join('')}</div>` : ''}
            </div>
            <button class="btn tiny soft" style="flex:0 0 auto;display:flex;align-items:center;gap:6px;" onclick="event.stopPropagation();OL.goToStepFromLibrary('${esc(String(jumpRes))}','${esc(String(jumpStep))}')">
                <i data-lucide="mouse-pointer-2" style="width:12px;height:12px;"></i> View on map
            </button>
        </div>`;
    const pathGroup = (label, rows) => `
        <div style="margin-top:12px;">
            <div style="font-size:11px;font-weight:700;letter-spacing:0.06em;color:var(--text-muted);margin-bottom:8px;">${label} <span class="pill tiny soft">${rows.length}</span></div>
            <div style="display:flex;flex-direction:column;gap:8px;">${rows.length ? rows.join('') : '<div class="tiny muted">None.</div>'}</div>
        </div>`;
    const pathsHtml = `
    <div class="card-section" style="margin-top:20px; border-top: 1px solid var(--line); padding-top:15px;">
        <label class="modal-section-label" style="display:flex; align-items:center; gap:6px;">
            <i data-lucide="git-branch" style="width:14px; height:14px;"></i> PATHS
        </label>
        <div class="tiny muted" style="margin:4px 0 0;">Paths to and from other resources, and any step that waits, loops or branches. Edit them on the flow map.</div>
        ${pathGroup('INBOUND', inboundPaths.map((p) => pathRowHtml(`${p.fromRes.name}`, `Step ${p.fromIdx + 1}: ${p.fromStep.name || 'Unnamed step'}${p.toStep ? `  →  enters at ${p.toStep.name || 'a step'}` : ''}`, p.badge, p.jumpRes, p.jumpStep)))}
        ${pathGroup('OUTBOUND', outboundPaths.map((p) => pathRowHtml(`${p.toRes.name}`, `From ${p.fromLabel}  →  ${p.toStep.name || 'Unnamed step'}`, p.badge, p.jumpRes, p.jumpStep)))}
    </div>`;

  //------- SCOPING STATUS ---------//

  // Inside OL.openResourceModal...
  const activeTab = state.v2?.activeCommentTab || 'comments';
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
              ${commentToolbarHtml(res.id)}
              <textarea id="new-comment-input-${res.id}" class="modal-textarea" 
                        placeholder="Type a ${activeTab === 'client' ? 'message to the team' : 'private note'}..." 
                        style="min-height: 60px; margin-bottom: 8px; font-size: 11px; text-align:left;"></textarea>
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
    // --- DATA TAGS (forms) ---
    // The fields a form collects, as data tags. They live on the form's steps (the same tags the flow map shows), so adding or
    // removing one here and there is the same change. A form always shows the section; any other resource shows it once it has tags.
    const formTags = [];
    (res.steps || []).forEach((st) => (st.datapoints || []).forEach((d) => { if (d && !formTags.some((x) => x.id === d.id)) formTags.push(d); }));
    const showDataTags = true;   // any card can carry data tags (an email's merge fields, a spreadsheet's columns, a form's fields)
    const tagPool = (client?.projectData?.localDatapoints?.length ? client.projectData.localDatapoints : (state.master.datapoints || []));
    const tagChoices = tagPool.filter((d) => d && !formTags.some((x) => x.id === d.id));
    const tagGroups = tagChoices.reduce((g, d) => { const c = d.category || 'Other'; (g[c] = g[c] || []).push(d); return g; }, {});
    const dataTagsHtml = showDataTags ? `
        <div class="card-section" style="margin-top:20px;">
            <label class="modal-section-label" style="display:flex;align-items:center;gap:6px;">
                <i data-lucide="tags" style="width:14px;height:14px;"></i> DATA TAGS
                <span class="pill tiny soft">${formTags.length}</span>
                ${/\b(forms?|questionnaires?)\b/.test(resType) ? `<span style="flex:1;"></span><button type="button" class="btn tiny primary" onclick="OL.openFormBuilder('${esc(res.id)}')"><i data-lucide="file-text" style="width:11px;height:11px;"></i> Form builder</button>` : ''}
            </label>
            <div class="tiny muted" style="margin:4px 0 8px;">${/\b(forms?|questionnaires?)\b/.test(resType) ? 'The fields this form collects' : 'The data this resource uses or collects'}${(res.formFields || []).length ? (res.source ? `, as ${esc(res.source)} reports them (refreshed on each pull)` : ', as set in the form builder') : ''}.</div>
            <div style="display:flex;flex-direction:column;gap:5px;margin-bottom:10px;">
                ${(() => {
                    const fields = res.formFields || [];
                    const rank = (d) => { const i = fields.findIndex((f) => String(f.tagId) === String(d.id)); return i < 0 ? 999 : i; };
                    const rows = [...formTags].sort((a, b) => rank(a) - rank(b));
                    if (!rows.length) return '<span class="tiny muted">No data tags yet.</span>';
                    return rows.map((d) => {
                        const f = fields.find((x) => String(x.tagId) === String(d.id));
                        return `<div style="padding:6px 10px;border:1px solid var(--line);border-radius:6px;background:var(--panel-soft);">
                            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                                <i data-lucide="tag" style="width:11px;height:11px;color:#a78bfa;flex:0 0 auto;"></i>
                                <span style="font-size:10.5px;font-weight:500;line-height:1.35;flex:1;min-width:0;overflow-wrap:anywhere;">${esc(f ? f.label : d.name)}</span>
                                ${f ? `<span class="pill tiny soft" style="font-size:9px;padding:0 6px;">${esc(String(f.type || 'text').replace(/_/g, ' '))}</span>` : ''}
                                ${f && f.required ? '<span class="pill tiny" style="font-size:9px;padding:0 6px;color:#f5b800;border:1px solid rgba(245,184,0,0.3);">required</span>' : ''}
                                <b class="is-clickable" title="Remove this tag" style="opacity:0.5;padding:0 4px;font-size:14px;" onclick="OL.removeResourceDataTag('${esc(res.id)}','${esc(d.id)}')">×</b>
                            </div>
                            ${f && (f.options || []).length ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:5px;padding-left:16px;">${f.options.map((o) => `<span class="pill tiny" style="border:1px solid var(--line);font-size:9px;padding:0 6px;">${esc(o)}</span>`).join('')}</div>` : ''}
                        </div>`;
                    }).join('');
                })()}
            </div>
            ${tagChoices.length ? `
            <select class="modal-input tiny" style="width:100%;" onchange="if(this.value) OL.addResourceDataTag('${esc(res.id)}', this.value)">
                <option value="">Add a data tag...</option>
                ${Object.keys(tagGroups).sort().map((c) => `<optgroup label="${esc(c)}">${tagGroups[c].map((d) => `<option value="${esc(d.id)}">${esc(d.name)}${d.isBundle ? ' (bundle)' : ''}</option>`).join('')}</optgroup>`).join('')}
            </select>` : ''}
        </div>` : '';

    // --- FORM LOGIC (forms read from Jotform keep their rules on the card) ---
    const fl = res.formLogic;
    const ruleLine = (r) => {
        const cond = (r.when || []).length ? r.when.map((w) => `${w.fieldLabel} ${w.op}${w.value ? ` "${w.value}"` : ''}`).join(r.link === 'any' ? ' OR ' : ' AND ') : 'Always';
        return `<div style="padding:6px 10px;border:1px solid var(--line);border-radius:6px;background:var(--panel-soft);font-size:10.5px;line-height:1.5;${r.disabled ? 'opacity:0.55;' : ''}">
            <span style="color:var(--text-muted);font-weight:700;">IF</span> ${esc(cond)}
            <span style="color:var(--text-muted);font-weight:700;margin-left:4px;">THEN</span> ${esc((r.then || []).map((t) => t.text).join('; '))}
            ${r.disabled ? '<span class="pill tiny soft" style="font-size:9px;padding:0 6px;margin-left:4px;">off in Jotform</span>' : ''}
        </div>`;
    };
    const formLogicHtml = fl ? `
        <div class="card-section" style="margin-top:20px;">
            <label class="modal-section-label" style="display:flex;align-items:center;gap:6px;">
                <i data-lucide="git-fork" style="width:14px;height:14px;"></i> FORM LOGIC
                <span class="pill tiny soft">${(fl.rules || []).length}</span>
            </label>
            <div class="tiny muted" style="margin:4px 0 8px;">The form's conditional rules, as ${esc(res.source || 'the service')} has them. Edit them there; they refresh on each pull.</div>
            <div style="display:flex;flex-direction:column;gap:5px;margin-bottom:8px;">
                ${(fl.rules || []).length ? fl.rules.map(ruleLine).join('') : '<span class="tiny muted">No conditional logic: everyone sees every question.</span>'}
            </div>
            ${typeof OL.openJotformLogicMap === 'function' && (fl.rules || []).length ? `<button class="btn tiny soft" onclick="OL.openJotformLogicMap('${esc(res.id)}')">Open the logic map</button>` : ''}
        </div>` : '';

    // --- STEPS (types without the inline editor) ---
    // Steps are edited on the flow map, where the full step editor is. Here they are listed, with a way across.
    const stepSummaryHtml = (!showWorkflowSteps && (res.steps || []).length) ? `
        <div class="card-section" style="margin-top:20px;">
            <label class="modal-section-label" style="display:flex;align-items:center;gap:6px;">
                <i data-lucide="list" style="width:14px;height:14px;"></i> STEPS
                <span class="pill tiny soft">${(res.steps || []).length}</span>
            </label>
            <div style="display:flex;flex-direction:column;gap:8px;margin:12px 0 16px;">
                ${(res.steps || []).map((st, i) => `
                    <div style="display:flex;align-items:center;gap:12px;padding:10px 14px;border:1px solid var(--line);border-radius:8px;background:var(--panel-soft);">
                        <span style="flex:0 0 24px;height:24px;border-radius:50%;background:var(--accent);color:#000;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;">${i + 1}</span>
                        <span style="flex:1;min-width:0;font-size:13px;line-height:1.4;">${esc(st.name || 'Unnamed step')}</span>
                        ${st.appName ? `<span class="pill tiny soft" style="flex:0 0 auto;">${esc(st.appName)}</span>` : ''}
                    </div>`).join('')}
            </div>
            <button class="btn tiny primary" onclick="OL.goToResourceInMap('${res.id}')" style="display:flex;align-items:center;gap:6px;">
                <i data-lucide="mouse-pointer-2" style="width:12px;height:12px;"></i> Edit steps on the flow map
            </button>
        </div>` : '';

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
                              data-original="${esc(res.description || '')}"
                              onblur="const v=this.value; if(v !== this.dataset.original) OL.handleResourceSave('${res.id}', 'description', v);">${esc(res.description || '')}</textarea>
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
                            <select class="modal-input tiny" onchange="OL.handleResourceSave('${res.id}', 'emailFrom', this.value); document.getElementById('email-from-custom-${res.id}').style.display = this.value === 'custom' ? 'block' : 'none';">
                                <option value="">Select Sender...</option>
                                ${(client?.projectData?.teamMembers || []).length ? `<optgroup label="Team">${(client?.projectData?.teamMembers || []).map(m => `
                                    <option value="${m.id}" ${res.emailFrom === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</optgroup>` : ''}
                                <optgroup label="Application">
                                    <option value="app" ${res.emailFrom === 'app' ? 'selected' : ''}>${esc(res.appName || 'The primary app')}${res.appName ? ' (sent by the app)' : ' (set a primary app first)'}</option>
                                </optgroup>
                                <option value="custom" ${res.emailFrom === 'custom' ? 'selected' : ''}>Custom...</option>
                            </select>
                            <input type="text" id="email-from-custom-${res.id}" class="modal-input tiny" style="margin-top:6px;display:${res.emailFrom === 'custom' ? 'block' : 'none'};"
                                   placeholder="Who or what sends it (e.g. the custodian's system)" value="${esc(res.emailFromCustom || '')}"
                                   onblur="OL.handleResourceSave('${res.id}', 'emailFromCustom', this.value)">
                        </div>
                        <div>
                            <label class="tiny muted bold" style="display:flex;align-items:center;gap:4px;margin-bottom:4px;">
                                <i data-lucide="users" style="width:10px;height:10px;"></i> TO
                            </label>
                            <select class="modal-input tiny" onchange="OL.handleResourceSave('${res.id}', 'emailToType', this.value); document.getElementById('email-to-custom-${res.id}').style.display = this.value === 'custom' ? 'block' : 'none';">
                                <option value="">Select Recipient...</option>
                                <optgroup label="Clients">
                                    ${['Lead/Client', 'Household', 'Client 1', 'Client 2'].map(v => `<option value="${v}" ${res.emailToType === v ? 'selected' : ''}>${v}</option>`).join('')}
                                    <option value="COI" ${res.emailToType === 'COI' ? 'selected' : ''}>COI (Professional)</option>
                                </optgroup>
                                ${(client?.projectData?.teamMembers || []).length ? `<optgroup label="Team">${(client?.projectData?.teamMembers || []).map(m => `
                                    <option value="tm:${m.id}" ${res.emailToType === 'tm:' + m.id ? 'selected' : ''}>${esc(m.name)}${m.isPrimaryContact ? ' (designated contact)' : ''}</option>`).join('')}</optgroup>` : ''}
                                <option value="custom" ${res.emailToType === 'custom' ? 'selected' : ''}>Custom...</option>
                            </select>
                            <input type="text" id="email-to-custom-${res.id}" class="modal-input tiny" style="margin-top:6px;display:${res.emailToType === 'custom' ? 'block' : 'none'};"
                                   placeholder="Who receives it (e.g. the transfer agent)" value="${esc(res.emailToCustom || '')}"
                                   onblur="OL.handleResourceSave('${res.id}', 'emailToCustom', this.value)">
                        </div>
                    </div>
        
                    <!-- SUBJECT full width -->
                    <div style="margin-bottom:12px;">
                        <label class="tiny muted bold" style="display:block;margin-bottom:4px;">SUBJECT LINE</label>
                        <input type="text" class="modal-input" style="width:100%;"
                               placeholder="Enter email subject..."
                               value="${esc(res.emailSubject || '')}"
                               data-original="${esc(res.emailSubject || '')}"
                               onblur="const v=this.value; if(v !== this.dataset.original) OL.handleResourceSave('${res.id}', 'emailSubject', v);">
                    </div>
        
                    <!-- ATTACHMENTS -->
                    <div style="margin-bottom:12px;">
                        <label class="tiny muted bold" style="display:flex;align-items:center;gap:4px;margin-bottom:4px;">
                            <i data-lucide="paperclip" style="width:10px;height:10px;"></i> ATTACHMENTS
                        </label>
                        ${(res.emailAttachments || []).length ? `<div style="display:flex;flex-direction:column;gap:5px;margin-bottom:6px;">${(res.emailAttachments || []).map((a) => `
                            <div style="display:flex;align-items:center;gap:6px;padding:5px 10px;border:1px solid var(--line);border-radius:6px;background:var(--panel-soft);font-size:10.5px;">
                                <i data-lucide="${a.kind === 'resource' ? 'file-text' : (a.kind === 'generated' ? 'file-cog' : 'paperclip')}" style="width:11px;height:11px;flex:0 0 auto;"></i>
                                <span style="flex:1;min-width:0;overflow-wrap:anywhere;">${esc(a.name)}</span>
                                <span class="pill tiny soft" style="font-size:9px;padding:0 6px;">${a.kind === 'resource' ? 'from library' : (a.kind === 'generated' ? 'generated' : 'custom')}</span>
                                <b class="is-clickable" title="Remove" style="opacity:0.5;padding:0 4px;" onclick="OL.removeEmailAttachment('${res.id}','${esc(a.id)}')">×</b>
                            </div>`).join('')}</div>` : '<div class="tiny muted" style="margin-bottom:6px;">No attachments.</div>'}
                        <select class="modal-input tiny" onchange="if(this.value){ OL.addEmailAttachment('${res.id}', this.value); }">
                            <option value="">Add an attachment...</option>
                            <option value="generated">PDF generated by ${esc(res.appName || 'the app')} (submission or confirmation)</option>
                            <option value="custom">Other file (name it)...</option>
                            ${(() => {
                                const lib = (client?.projectData?.localResources || []).filter((r) => r && r.id !== res.id && !r.isArchived && !r.archived && !r.isDeleted && /doc|pdf|agreement|contract|sheet|guide|form|brochure|letter|folder|file/i.test(String(r.type || '')));
                                return lib.length ? `<optgroup label="From the library">${lib.slice(0, 200).map((r) => `<option value="res:${esc(r.id)}">${esc(r.name)} (${esc(r.type)})</option>`).join('')}</optgroup>` : '';
                            })()}
                        </select>
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
                    <div id="email-body-preview-${res.id}" class="ol-email-body"
                         title="Click to edit"
                         onclick="if(!event.target.closest('a,.pill,button')) OL._geToggleEmailBody('${res.id}', 'rich');"
                         style="background:rgba(0,0,0,0.15);border:1px solid var(--line);border-radius:6px;
                                padding:12px;font-size:12px;line-height:1.6;color:var(--text-main);
                                min-height:80px;width:100%;cursor:text;">
                        ${OL._geRenderEmailPreview(res.emailBody || '', [
                            ...(client?.projectData?.localDatapoints?.length 
                                ? client.projectData.localDatapoints 
                                : (state.master.datapoints || [])),
                            ...OL.getResourceDatapoints()
                        ], client)}
                    </div>
                    <textarea id="email-body-edit-${res.id}"
                              class="modal-textarea"
                              style="display:none;min-height:240px;width:100%;box-sizing:border-box;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;"
                              placeholder="Paste or write the email HTML...">${esc(res.emailBody || '')}</textarea>
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
                ${dataTagsHtml}
                ${formLogicHtml}
                ${collateralHtml}
                ${pathsHtml}
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
                    <i data-lucide="link" style="width:14px;height:14px;"></i> ${isZap ? 'Zapier Link' : 'External Link'}
                </label>
                <input type="url" class="modal-input tiny" placeholder="https://..." value="${esc(res.externalUrl || '')}"
                       data-original="${esc(res.externalUrl || '')}"
                       onblur="const v=this.value.trim(); if(v !== this.dataset.original) OL.handleResourceSave('${res.id}', 'externalUrl', v);">
            </div>

           <div class="card-section" style="margin-top:20px;">
                <label class="modal-section-label" style="display:flex;align-items:center;gap:6px;">
                    <i data-lucide="align-start-vertical" style="width:14px;height:14px;"></i>
                    Where it sits on the map
                </label>
                ${OL.placementsEditor ? OL.placementsEditor(res.id) : ''}
            </div>
                        
            <div class="card-section" style="margin-top:20px;">
                <label class="modal-section-label" style="display:flex;align-items:center;gap:6px;">
                    <i data-lucide="fingerprint" style="width:14px;height:14px;"></i> Description & Access Notes
                </label>
                <textarea class="modal-textarea"
                          placeholder="Enter login details, account purpose, or specific access instructions..."
                          style="min-height:80px;font-size:12px;width:100%;"
                          data-original="${esc(res.description || '')}"
                              onblur="const v=this.value; if(v !== this.dataset.original) OL.handleResourceSave('${res.id}', 'description', v);">${esc(res.description || '')}</textarea>
            </div>
        
            ${dataTagsHtml}
            ${formLogicHtml}

            ${stepSummaryHtml}

            ${showWorkflowSteps ? `
                <div class="card-section" style="margin-top:20px;">
                    <label class="modal-section-label" style="display:flex;align-items:center;gap:6px;">
                        <i data-lucide="git-branch" style="width:14px;height:14px;"></i> WORKFLOW STEPS
                    </label>
                    <div style="display:flex;gap:8px;margin-bottom:10px;">
                        <button class="btn tiny primary" onclick="OL.goToResourceInMap('${res.id}')" style="display:flex;align-items:center;gap:6px;">
                            <i data-lucide="mouse-pointer-2" style="width:12px;height:12px;"></i> Edit on flow map
                        </button>
                        <button class="btn tiny primary" onclick="OL.addNewStepToCard('${res.id}')" style="display:flex;align-items:center;gap:6px;">
                            <i data-lucide="plus" style="width:12px;height:12px;"></i> Add Step
                        </button>
                    </div>
                    <div id="sop-step-list">${renderSopStepList(res)}</div>
                </div>
            ` : ''}
        
            ${collateralHtml}
            ${containerHtml}
        
            ${pathsHtml}
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
                     onblur="this.style.borderColor='transparent'; const v=this.innerText.trim(); if(v && v !== '${esc(res.name || '').replace(/'/g, "\\'")}') OL.handleResourceSave('${res.id}','name',v);">
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
                ${!isVaultMode ? `
                <button onclick="OL.setResourceBuildState('${res.id}', '${res.isShell ? 'built' : 'planned'}')"
                        title="${res.isShell ? 'Planned: not built yet. Click to mark it built.' : 'Built. Click to mark it planned again.'}"
                        style="padding:4px 10px;border-radius:99px;font-size:11px;font-weight:600;cursor:pointer;
                               display:flex;align-items:center;gap:4px;
                               border:1px solid ${res.isShell ? '#f59e0b' : 'var(--panel-border)'};
                               background:${res.isShell ? 'rgba(245,158,11,0.1)' : 'var(--panel-soft)'};
                               color:${res.isShell ? '#f59e0b' : 'var(--text-muted)'};">
                    <i data-lucide="${res.isShell ? 'hammer' : 'check-circle'}" style="width:11px;height:11px;"></i>
                    ${res.isShell ? 'Planned' : 'Built'}
                </button>` : ''}
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
    
            <!-- Sidebar: the same comment box tasks use (rich text, @mentions, edit/delete, "Client can view"), plus edit history -->
            <aside style="flex:1;display:flex;flex-direction:column;border-left:1px solid var(--line);min-width:0; height:100%;">
                ${(typeof OL.toFilePull === 'function' && !OL.isClientViewer?.() && !window.IS_GUEST) ? `<button class="btn tiny soft" style="margin:8px 10px 0;" onclick="OL.toFilePull('${esc(getActiveClient()?.id || '')}', '${esc(String(res.id))}')" title="Open the To File queue for this project and file open items into this resource"><i data-lucide="folder-input" style="width:12px;height:12px;vertical-align:-2px;"></i> Pull from queue</button>` : ''}
                <div style="display:flex;border-bottom:1px solid var(--line);">
                    <div onclick="state.v2.activeCommentTab='comments';OL.openResourceModal('${res.id}')"
                         style="flex:1;padding:10px 4px;text-align:center;font-size:10px;font-weight:700;
                                cursor:pointer;${activeTab!=='history' ? 'color:var(--accent);border-bottom:2px solid var(--accent);' : 'opacity:0.5'}">
                        COMMENTS
                    </div>
                    <div onclick="state.v2.activeCommentTab='history';OL.openResourceModal('${res.id}')"
                         style="flex:1;padding:10px 4px;text-align:center;font-size:10px;font-weight:700;
                                cursor:pointer;${activeTab==='history' ? 'color:var(--accent);border-bottom:2px solid var(--accent);' : 'opacity:0.5'}">
                        EDIT HISTORY
                    </div>
                </div>

                <div style="flex:1;overflow-y:auto;padding:14px;min-width:0;">
                    ${activeTab === 'history' ? OL.renderEditHistory(res) : `
                        <div id="task-comments-sidebar-${res.id}" style="min-width:0;">
                            ${OL._findCommentHost && typeof OL.renderTaskCommentsSidebarHTML === 'function' ? OL.renderTaskCommentsSidebarHTML(getActiveClient(), res) : ''}
                        </div>
                        ${isGuest ? '' : `
                        <div style="margin-top:14px;">
                            <label class="bold tiny uppercase muted" style="display:block; margin-bottom:6px;"><i data-lucide="mail" style="width:12px;height:12px;vertical-align:sub;"></i> Linked Emails</label>
                            <div id="resource-notes-email-rows"></div>
                        </div>`}
                    `}
                </div>
            </aside>
        </div>

        ${OL._renderResourceCustomFieldsSection(res, typeDef)}
    `;
    
    openModal(html);
    if (activeTab !== 'history' && !isGuest) OL.loadLinkedEmailsIntoResourceNotes(res.id);
    if (OL.hydrateRollupSection && getActiveClient()) OL.hydrateRollupSection(getActiveClient().id, 'resource', res.id);
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

// -------------------------------------------------------------
// CUSTOM FIELDS — additive section, driven by typeDef.customFields (see
// features/field-type-manager.js for how those get defined). Rendered as
// its own block below the existing hardcoded sections rather than woven
// into them, so nothing already working here is touched by this.
// -------------------------------------------------------------
OL._renderResourceCustomFieldsSection = function(res, typeDef) {
    const fields = typeDef?.customFields || [];
    if (!fields.length) return '';

    if (!res.fieldValues) res.fieldValues = {};
    const values = res.fieldValues;

    return `
        <div style="margin-top:20px; padding:16px; border:1px solid var(--line); border-radius:8px; background:rgba(255,255,255,0.01);">
            <label class="modal-section-label" style="margin-top:0; display:flex; align-items:center; gap:6px;">
                <i data-lucide="sliders-horizontal" style="width:13px;height:13px;"></i> Custom Fields
            </label>
            <div style="display:flex; flex-direction:column; gap:14px; margin-top:10px;">
                ${fields
                    .filter(f => evaluateCondition(f.condition, values))
                    .map(f => `
                        <div>
                            <label class="tiny muted bold" style="display:block; margin-bottom:5px;">${esc(f.label || f.id)}</label>
                            ${renderFieldInput(f, values[f.id], `OL.saveResourceFieldValue('${res.id}', '${f.id}', __VALUE__)`)}
                            ${OL._isLinkedFieldType(f.type) ? OL._renderCustomFieldLinker(res, f) : ''}
                        </div>
                    `).join('')}
            </div>
        </div>
    `;
};

OL._isLinkedFieldType = function(type) {
    return type === 'linked_resources' || type === 'linked_howto' || type === 'linked_tasks';
};

OL._renderCustomFieldLinker = function(res, field) {
    return `
        <input type="text" class="modal-input tiny" style="margin-top:6px;" placeholder="Search to link..."
               oninput="OL.filterCustomFieldLinkSearch('${res.id}', '${field.id}', '${field.type}', this.value)">
        <div id="custom-field-link-results-${res.id}-${field.id}" style="max-height:120px; overflow:auto; margin-top:4px;"></div>
    `;
};

// Pools mirror what the app's own built-in linkers already search —
// state.master.resources/howToLibrary for the vault-scoped ones, the
// active client's clientTasks for tasks (custom fields live on a resource,
// which always belongs to one client, so tasks don't need cross-client
// search the way the Gmail linker's did).
OL._customFieldLinkPool = function(fieldType) {
    if (fieldType === 'linked_resources') return (state.master.resources || []).map(r => ({ id: r.id, label: r.name }));
    if (fieldType === 'linked_howto') return (OL.masterGuidesFor ? OL.masterGuidesFor(getActiveClient()) : (state.master.howToLibrary || [])).map(h => ({ id: h.id, label: h.name }));
    if (fieldType === 'linked_tasks') {
        const client = getActiveClient();
        return (client?.projectData?.clientTasks || []).map(t => ({ id: t.id, label: t.title || t.name }));
    }
    return [];
};

OL.filterCustomFieldLinkSearch = function(resId, fieldId, fieldType, query) {
    const listEl = document.getElementById(`custom-field-link-results-${resId}-${fieldId}`);
    if (!listEl) return;

    const res = OL.getResourceById(resId);
    const existing = new Set((res?.fieldValues?.[fieldId]) || []);
    const q = (query || '').toLowerCase().trim();

    const matches = OL._customFieldLinkPool(fieldType).filter(item =>
        (item.label || '').toLowerCase().includes(q) && !existing.has(item.id)
    );

    listEl.innerHTML = matches.map(item => `
        <div class="search-result-item" onmousedown="OL.toggleCustomFieldLink('${resId}', '${fieldId}', '${item.id}')">${esc(item.label || 'Untitled')}</div>
    `).join('') || `<div class="search-result-item muted">No matches.</div>`;
};

OL.toggleCustomFieldLink = function(resId, fieldId, targetId) {
    const res = OL.getResourceById(resId);
    if (!res) return;
    if (!res.fieldValues) res.fieldValues = {};
    if (!res.fieldValues[fieldId]) res.fieldValues[fieldId] = [];

    const arr = res.fieldValues[fieldId];
    const idx = arr.indexOf(targetId);
    if (idx === -1) arr.push(targetId); else arr.splice(idx, 1);

    OL.handleResourceSave(resId, 'fieldValues', res.fieldValues);
    OL.openResourceModal(resId);
};

OL.saveResourceFieldValue = function(resId, fieldId, value) {
    const res = OL.getResourceById(resId);
    if (!res) return;
    if (!res.fieldValues) res.fieldValues = {};
    res.fieldValues[fieldId] = value;
    OL.handleResourceSave(resId, 'fieldValues', res.fieldValues);
};

// Email HTML comes with its own fixed widths (a 600px table, a logo image wider than the dialog), which used to spill out of
// the body box and over the rest of the dialog. Everything inside an email body box is held to the width of that box.
if (typeof document !== 'undefined' && !document.getElementById('ol-email-body-css')) {
    const st = document.createElement('style');
    st.id = 'ol-email-body-css';
    st.textContent = `
      .ol-email-body { max-width:100%; box-sizing:border-box; overflow:auto; overflow-wrap:anywhere; contain:layout paint; }
      .ol-email-body * { max-width:100% !important; box-sizing:border-box; }
      .ol-email-body img { height:auto !important; }
      .ol-email-body[contenteditable="true"] { cursor:text; }
    `;
    document.head.appendChild(st);
}

export function _geRenderEmailPreview(value, datapoints, client) {
    if (!value) return '<span style="opacity:0.45;font-style:italic;">No body yet. Click here to type or paste the email.</span>';
    
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
            richEl.className = 'ol-email-body';
            richEl.style.cssText = 'min-height:240px;width:100%;padding:12px;border:1px solid var(--line);border-radius:6px;font-size:12px;line-height:1.6;outline:none;background:rgba(0,0,0,0.1);';
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

// Adds a data tag (or a bundle's tags) to a form. They go on the form's first step; a form with no steps gets one.
export async function addEmailAttachment(resId, value) {
    const res = OL.getResourceById(resId);
    if (!res || !value) return;
    const client = getActiveClient();
    let entry = null;
    if (value === 'generated') entry = { kind: 'generated', name: `PDF generated by ${res.appName || 'the app'}` };
    else if (value === 'custom') {
        const name = window.prompt('Name the attachment (for example: Account application, signed)');
        if (!name || !name.trim()) { OL.openResourceModal(resId); return; }
        entry = { kind: 'custom', name: name.trim().slice(0, 120) };
    } else if (String(value).startsWith('res:')) {
        const lib = OL.getResourceById(String(value).slice(4));
        if (!lib) return;
        entry = { kind: 'resource', name: lib.name, libId: lib.id };
    }
    if (!entry) return;
    await OL.updateAndSync(() => {
        if (!Array.isArray(res.emailAttachments)) res.emailAttachments = [];
        if (!res.emailAttachments.some((a) => a.kind === entry.kind && a.name === entry.name)) res.emailAttachments.push({ id: 'att-' + Date.now(), ...entry });
    }, client?.id);
    OL.openResourceModal(resId);
}

export async function removeEmailAttachment(resId, attId) {
    const res = OL.getResourceById(resId);
    if (!res) return;
    await OL.updateAndSync(() => { res.emailAttachments = (res.emailAttachments || []).filter((a) => String(a.id) !== String(attId)); }, getActiveClient()?.id);
    OL.openResourceModal(resId);
}

export async function addResourceDataTag(resId, tagId) {
    const res = OL.getResourceById(resId);
    if (!res || !tagId) return;
    const client = getActiveClient();
    const pool = [...(client?.projectData?.localDatapoints || []), ...(state.master.datapoints || [])];
    const tag = pool.find((d) => String(d.id) === String(tagId));
    if (!tag) return;
    const add = tag.isBundle ? (tag.childIds || []).map((id) => pool.find((d) => String(d.id) === String(id))).filter(Boolean) : [tag];
    await OL.updateAndSync(() => {
        if (!Array.isArray(res.steps)) res.steps = [];
        if (!res.steps.length) res.steps.push({ id: 'step_' + Date.now(), name: /\b(forms?|questionnaires?)\b/i.test(String(res.type || '')) ? 'Form completed' : 'Data used', appName: res.appName || '', datapoints: [] });
        const step = res.steps[0];
        if (!Array.isArray(step.datapoints)) step.datapoints = [];
        add.forEach((d) => {
            if (!res.steps.some((st) => (st.datapoints || []).some((x) => x.id === d.id))) step.datapoints.push(d);
        });
    }, client?.id);
    OL.openResourceModal(resId);
};

export async function removeResourceDataTag(resId, tagId) {
    const res = OL.getResourceById(resId);
    if (!res) return;
    await OL.updateAndSync(() => {
        (res.steps || []).forEach((st) => { if (Array.isArray(st.datapoints)) st.datapoints = st.datapoints.filter((d) => String(d.id) !== String(tagId)); });
    }, getActiveClient()?.id);
    OL.openResourceModal(resId);
};

export function handleConventionUpdate(resId, section, key, value) {
    const res = OL.getResourceById(resId);
    if (res) {
        if (!res.data) res.data = {};
        if (!res.data[section]) res.data[section] = {};
        if ((res.data[section][key] || '') === value.trim()) return;
        const clientId = getActiveClient()?.id;
        OL.updateAndSync(() => { res.data[section][key] = value.trim(); }, clientId);
        console.log(`✅ Naming Convention Saved: ${section} -> ${key}`);
    }
};

// Older projects got the folder tree on "Naming Conventions" (and none on
// "Folder Hierarchy"), plus an empty naming form. Moves the tree to where it
// belongs and fills any blank naming fields with the standard defaults.
// Safe to call repeatedly; only saves when something actually changed.
export const NAMING_DEFAULTS = {
    household: { individual: 'Last, First', jointSame: 'Last, First & Spouse First', jointDiff: 'Last, First & Spouse Last, Spouse First' },
    folders:   { individual: 'Last, First', jointSame: 'Last, First & Spouse First', jointDiff: 'Last & Spouse Last' }
};
OL.repairNamingAndHierarchyTemplates = function(client) {
    const list = client?.projectData?.localResources;
    if (!list) return;
    const naming = list.find(r => r.name === "Naming Conventions");
    const hierarchy = list.find(r => r.name === "Folder Hierarchy");
    let changed = false;
    if (naming?.tree && hierarchy && !(hierarchy.tree && hierarchy.tree.length)) {
        hierarchy.tree = naming.tree; delete naming.tree; changed = true;
    }
    if (naming) {
        if (naming.isContainer) { delete naming.isContainer; changed = true; }
        if (!naming.data) naming.data = {};
        for (const [sec, fields] of Object.entries(NAMING_DEFAULTS)) {
            if (!naming.data[sec]) naming.data[sec] = {};
            for (const [k, v] of Object.entries(fields)) {
                if (!naming.data[sec][k]) { naming.data[sec][k] = v; changed = true; }
            }
        }
    }
    if (changed) OL.updateAndSync(() => {}, client.id);
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

// Minimal markdown-ish formatting for comments: **bold**, *italic*, "- " bullets, line breaks.
function formatCommentText(text) {
    let html = esc(text || '');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    html = html.replace(/^- (.+)$/gm, '&bull; $1');
    html = html.replace(/\n/g, '<br>');
    return html;
}

// Renders comments left-aligned with fixed-width author/date columns and a
// wrapping body column, for both the desktop sidebar and mobile-tab variants
// of the resource modal.
function renderCommentsList(res, activeTab) {
    const comments = (res.comments || []).filter(c => activeTab === 'client' ? c.isClientFacing : !c.isClientFacing);
    const rowsHtml = comments.map(c => `
        <div style="display:flex; gap:10px; padding:10px 0; border-bottom:1px solid var(--line); align-items:flex-start; text-align:left;">
            <div style="flex-shrink:0; width:100px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                <div class="tiny bold">${esc(c.author || 'Unknown')}</div>
            </div>
            <div style="flex-shrink:0; width:80px;">
                <div class="tiny muted">${c.timestamp ? new Date(c.timestamp).toLocaleDateString([], { dateStyle: 'short' }) : ''}</div>
            </div>
            <div style="flex:1; min-width:0;">
                <div class="tiny" style="white-space:normal; overflow-wrap:break-word; line-height:1.5; text-align:left;">${formatCommentText(c.text)}</div>
            </div>
        </div>
    `).join('');

    if (activeTab === 'internal') {
        // Emails linked to this resource (gmail_messages.linked_resource_id)
        // load in async right after the modal opens (see
        // OL.loadLinkedEmailsIntoResourceNotes) and get appended into
        // #resource-notes-email-rows below — comments render immediately
        // without waiting on that fetch.
        return `
            <div id="resource-notes-comment-rows">${rowsHtml}</div>
            <div id="resource-notes-email-rows"></div>
            ${!comments.length ? `<div id="resource-notes-empty" class="tiny muted" style="text-align:center; padding:20px;">No internal notes yet.</div>` : ''}
        `;
    }

    return rowsHtml || `<div class="tiny muted" style="text-align:center; padding:20px;">No comments yet.</div>`;
}

// Fetches emails linked to this resource and appends them into the
// Internal Notes list (id="resource-notes-email-rows", written by
// renderCommentsList above) — additive, doesn't touch how regular
// comments render. Only called for the internal tab; client-facing
// comments and edit history don't show linked emails.
OL.loadLinkedEmailsIntoResourceNotes = async function(resId) {
    const container = document.getElementById('resource-notes-email-rows');
    if (!container) return; // wrong tab, or modal closed before this resolved

    const { data, error } = await db
        .from('gmail_messages')
        .select('id, sender, subject, snippet, date')
        .eq('linked_resource_id', resId)
        .order('date', { ascending: false });

    if (error || !data || !data.length) return;

    const emptyMsg = document.getElementById('resource-notes-empty');
    if (emptyMsg) emptyMsg.remove();

    container.innerHTML = data.map(m => {
        // Show a clean display name instead of the raw "Name <email>" header
        // value (OL._parseSenderHeader already exists for exactly this, in
        // features/business/communications.js).
        const parsedSender = OL._parseSenderHeader ? OL._parseSenderHeader(m.sender) : null;
        const senderName = parsedSender?.name || m.sender || 'Unknown';

        return `
        <div style="display:flex; gap:10px; padding:10px 0; border-bottom:1px solid var(--line); align-items:flex-start; text-align:left; cursor:pointer;"
             onclick="OL.openGmailMessageModal('${m.id}')">
            <i data-lucide="mail" style="width:13px;height:13px;color:var(--accent);flex-shrink:0;margin-top:2px;"></i>
            <div style="flex:1; min-width:0;">
                <div style="display:flex; justify-content:space-between; align-items:baseline; gap:8px; margin-bottom:3px;">
                    <span class="tiny bold" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(senderName)}</span>
                    <span style="display:flex; align-items:center; gap:6px; flex-shrink:0;">
                        <span class="tiny muted">${m.date ? new Date(m.date).toLocaleDateString([], { dateStyle: 'short' }) : ''}</span>
                        <button class="btn tiny soft" style="padding:1px 4px;" title="Unlink this email from the resource" onclick="event.stopPropagation(); OL.unlinkEmailFromResource('${resId}', '${m.id}')"><i data-lucide="unlink" style="width:10px;height:10px;"></i></button>
                    </span>
                </div>
                <div class="tiny bold" style="margin-bottom:2px;">${esc(m.subject || 'No Subject')}</div>
                ${m.snippet ? `<div class="tiny muted" style="line-height:1.4; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;">${esc(decodeEntities(m.snippet))}</div>` : ''}
            </div>
        </div>
    `;
    }).join('');
    if (window.lucide) window.lucide.createIcons();
};

OL.unlinkEmailFromResource = async function(resId, messageId) {
    if (!confirm('Unlink this email from the resource?')) return;
    const { error } = await db.from('gmail_messages').update({ linked_resource_id: null, link_locked: true }).eq('id', messageId);
    if (error) { alert('Failed to unlink: ' + error.message); return; }
    const row = document.querySelector(`#resource-notes-email-rows [onclick*="${messageId}"]`);
    if (row) row.remove();
};

// Wraps the current textarea selection in a markdown-style marker (or
// prefixes each selected line, for bullets) — used by the formatting toolbar.
export function wrapCommentSelection(resId, marker) {
    const ta = document.getElementById(`new-comment-input-${resId}`);
    if (!ta) return;
    const start = ta.selectionStart, end = ta.selectionEnd;
    const selected = ta.value.slice(start, end);

    if (marker === '- ') {
        const lines = (selected || 'list item').split('\n').map(l => `- ${l}`).join('\n');
        ta.value = ta.value.slice(0, start) + lines + ta.value.slice(end);
        ta.focus();
        ta.selectionStart = start;
        ta.selectionEnd = start + lines.length;
        return;
    }

    const text = selected || 'text';
    ta.value = ta.value.slice(0, start) + marker + text + marker + ta.value.slice(end);
    ta.focus();
    ta.selectionStart = start + marker.length;
    ta.selectionEnd = start + marker.length + text.length;
}

function commentToolbarHtml(resId) {
    return `
        <div style="display:flex; gap:4px; margin-bottom:6px;">
            <button type="button" class="btn tiny soft" style="font-weight:bold; padding:2px 8px;" title="Bold" onclick="OL.wrapCommentSelection('${resId}', '**')">B</button>
            <button type="button" class="btn tiny soft" style="font-style:italic; padding:2px 8px;" title="Italic" onclick="OL.wrapCommentSelection('${resId}', '*')">i</button>
            <button type="button" class="btn tiny soft" style="padding:2px 8px;" title="Bullet list" onclick="OL.wrapCommentSelection('${resId}', '- ')">&bull; List</button>
        </div>
    `;
}

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
        isClientFacing: isClientFacing // Visibility Flag
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
            <label class="modal-section-label">RELATIONSHIP MAP</label>
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
        returnPath = currentHash.replace(/^#/, '').split('?')[0] || "/resources";   // keeps /vault/resources when in the master library
    } else if (currentHash.includes('scoping-sheet')) {
        returnPath = "/scoping-sheet";
    }

    // 2. Save it to session storage so it survives the view change
    sessionStorage.setItem('map_return_path', returnPath);

    // 3. Close the modal and go to the real map route (the same way the library's step jump does)
    const isVaultMode = currentHash.includes('vault');
    // remember which resource to reopen, and where the page was scrolled, when "Back to Library" is clicked
    sessionStorage.setItem('map_return_resource', String(resId));
    sessionStorage.setItem('map_return_scroll', String((document.getElementById('mainContent') || {}).scrollTop || 0));
    sessionStorage.setItem('map_return_winscroll', String(window.scrollY || 0));

    OL.closeModal();
    OL.focusedResourceId = String(resId);
    state.focusedResourceId = String(resId);
    sessionStorage.setItem('active_resource_id', String(resId));

    const target = isVaultMode ? '#/vault/visualizer' : '#/visualizer';
    if (window.location.hash.split('?')[0] !== target) window.location.hash = target;

    // 4. Wait for the map to draw (the route change renders it), then centre the card and open its panel. A card with no
    // stage is not drawn on the map, but its panel (with Stage & Workflow) still opens so it can be placed.
    const safeId = (window.CSS && CSS.escape) ? CSS.escape(String(resId)) : String(resId).replace(/["\\]/g, '\\$&');
    let tries = 0;
    const open = () => {
        const drawn = document.getElementById('fv-canvas-wrap') && document.getElementById('inspector-content');
        if (!drawn && tries++ < 30) {
            if (tries === 8 && typeof OL.renderVisualizer === 'function') OL.renderVisualizer(isVaultMode);   // the route did not draw it: draw it
            return setTimeout(open, 100);
        }
        const onCanvas = document.querySelector(`.fv-card[data-res-id="${safeId}"]`) || document.getElementById(`v2-node-${resId}`);
        // open the side panel properly (it is closed when the map first draws), then centre the card
        if (typeof OL.openInspector === 'function') OL.openInspector(String(resId), null, 'cards');
        else if (typeof OL._fvOpenStepsList === 'function') OL._fvOpenStepsList(String(resId));
        if (onCanvas && typeof OL.centerCanvasNode === 'function') setTimeout(() => OL.centerCanvasNode(resId), 120);
        if (typeof OL.renderFocusControls === 'function') OL.renderFocusControls();
    };
    setTimeout(open, 150);
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
            ${esc(s.name)}
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
    const team = client?.projectData?.teamMembers || [];
    const sender = team.find(m => m.id === res.emailFrom);
    const fromLabel = sender ? sender.name : (res.emailFrom === 'app' ? (res.appName || 'The app') : (res.emailFrom === 'custom' ? (res.emailFromCustom || 'Custom sender') : ''));
    const toMember = String(res.emailToType || '').startsWith('tm:') ? team.find(m => m.id === String(res.emailToType).slice(3)) : null;
    const toLabel = toMember ? toMember.name : (res.emailToType === 'custom' ? (res.emailToCustom || 'Custom recipient') : (res.emailToType || 'Recipient'));
    const signatureContent = !sender && fromLabel ? '' : sender?.signature 
        ? `<div style="margin-top:20px; border-top:1px solid #eee; padding-top:15px; color:#555; font-style: normal;">${esc(sender.signature).replace(/\n/g, '<br>')}</div>` 
        : `<div class="tiny muted italic" style="margin-top:20px; color:#999;">(No signature defined for ${sender?.name || 'this sender'})</div>`;

    const previewHtml = `
        <div class="modal-head">
            <div class="modal-title-text">Email Preview</div>
        </div>
        <div class="modal-body" style="background: #fff; color: #333; padding: 40px; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; border-radius: 0 0 8px 8px;">
            <div style="border-bottom: 1px solid #eee; padding-bottom: 15px; margin-bottom: 20px; font-size: 13px;">
                ${fromLabel ? `<div style="margin-bottom:5px;"><b style="color:#888;">From:</b> ${esc(fromLabel)}</div>` : ''}
                <div style="margin-bottom:5px;"><b style="color:#888;">To:</b> ${esc(toLabel)}</div>
                ${(res.emailAttachments || []).length ? `<div style="margin-bottom:5px;"><b style="color:#888;">Attached:</b> ${(res.emailAttachments || []).map((a) => esc(a.name)).join(', ')}</div>` : ''}
                <div><b style="color:#888;">Subject:</b> ${esc(res.emailSubject || '(No Subject)')}</div>
            </div>
            <div class="ol-email-body" style="line-height: 1.6; font-size: 15px; color:#222;">${res.emailBody || '...'}</div>
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
        btn.innerText = "Copied!";
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
            // 🐛 FIX: this fires after persist()'s debounce (up to 1.5s later,
            // by which point the user may well have closed the modal and
            // moved on entirely). It used to check the URL hash alone
            // ("does it still say resources?") — but that's true on lots of
            // hashes and doesn't confirm the resources grid is actually
            // what's on screen. When it wasn't (user had navigated away),
            // this force-rebuilt the resources page over whatever they'd
            // navigated to. Checking for the grid's own DOM anchor instead
            // means we only re-render when it's genuinely still visible.
            const resourcesPageVisible = !!document.getElementById('resource-library-results');
            
            if (modalOpen) {
                // 🚀 Don't re-render modal for email body edits — it destroys the editor
                const emailFields = ['emailBody', 'emailFrom', 'emailToType', 'emailSubject', 'emailFromCustom', 'emailToCustom'];
                if (!emailFields.includes(field)) {
                    OL.openResourceModal(id);
                }
            } else if (inspectorOpen && isVisualizer) {
                OL._fvOpenStepsList(id);
                if (field === 'stageId') setTimeout(() => OL.renderVisualizer(), 100);
            } else if (inspectorOpen && !isVisualizer) {
                OL.openInspector(id, null, 'cards');
            } else if (resourcesPageVisible) {
                // 🐛 FIX: was renderResourceManager() — a full teardown and
                // rebuild of the whole page (toolbar, filter dropdowns and
                // all), which resets scroll position and anything the user
                // had typed/selected in the filters since this save was
                // kicked off. Refreshing just the results within the
                // existing toolbar is enough to reflect the saved change
                // and far less disruptive if this fires a while after the
                // interaction that triggered it.
                OL.syncResourceLibraryFilters();
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
                <h2>Scoping Variable Library</h2>
                <div class="small muted">Manage technical pricing per Resource Type</div>
            </div>
            <div class="header-actions">
                <button class="btn small soft" onclick="OL.openResourceTypeManager()">Types</button>
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
                            <div class="card-title" style="text-transform: uppercase; color: var(--accent);">${esc(type.type)}</div>
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
    let targetObj = sheet?.lineItems?.find(i => i.id === targetId);

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
    `Renamed type: "${oldName}" -> "${cleanNewName}" in ${archetype}`,
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
                <span>${esc(res.name)}</span>
                <span class="pill tiny soft">${esc(res.type)}</span>
            </div>
        </div>
    `).join('') || `<div class="search-result-item muted">${q ? 'No matches' : 'All resources imported'}</div>`;
};

export function importFromMaster() {
    const html = `
        <div class="modal-head">
            <div class="modal-title-text">Import Master Resource</div>
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
          alert("This is a required Sphynx system resource and cannot be removed.");
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
        ? `PERMANENT VAULT DELETE: "${label}"\n\nThis removes the source for ALL projects. This cannot be undone.`
        : `Delete "${label}" from this project?`;

    if (isFunction && isVaultRoute) confirmMsg = `WARNING: This will permanently remove the "${label}" Master Function from the Vault registry. Proceed?`;
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
    handleTreeDragLeave, handleConventionUpdate, addResourceDataTag, removeResourceDataTag, addEmailAttachment, removeEmailAttachment, updateContainerFile,
    addFileToContainer, removeFileFromContainer, simulateUpload,
    addResourceComment, wrapCommentSelection, renderResourceMiniMaps, goToResourceInMap,
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

// build stamp: type OL.build in the browser console to see which version of each file is running
(window.OL = window.OL || {}).build = Object.assign(window.OL.build || {}, { resourcesModal: '2026-10-13.o' });
