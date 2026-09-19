//======================= FEATURES / DATA MANAGER =======================//
// Extracted from app.js "DATAPOINTS" section.
// Owns: the master/local datapoint + bundle library, the data detail
// modal, bundle drag-and-drop mapping, and per-step data tag pills.

import { state, esc, getActiveClient, persist } from '../core/data.js';

export function renderGlobalDataManager() {
    OL.registerView(renderGlobalDataManager);
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

    if (window.lucide) {
        window.lucide.createIcons();
    }
}

export function openMasterDataImporter() {
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
}

export function filterMasterDataImport(query) {
    const listEl = document.getElementById("master-data-import-results");
    if (!listEl) return;

    const q = (query || "").toLowerCase().trim();
    const client = getActiveClient();

    const localIds = (client?.projectData?.localDatapoints || []).map(d => d.masterRefId || d.id);

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
}

export async function executeDataImport(masterId) {
    const client = getActiveClient();
    const template = state.master.datapoints.find(d => d.id === masterId);
    if (!client || !template) return;

    await OL.updateAndSync(() => {
        const newTag = JSON.parse(JSON.stringify(template));

        newTag.masterRefId = masterId;
        newTag.id = (newTag.isBundle ? 'local-bundle-' : 'local-dp-') + Date.now();

        if (!client.projectData.localDatapoints) client.projectData.localDatapoints = [];
        client.projectData.localDatapoints.push(newTag);

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
    renderGlobalDataManager();
    console.log(`✅ Imported Master Data: ${template.name}`);
}

export function renderDataRow(dp, allBundles) {
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

export function renderBundleRow(bn, allFields) {
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

export function openDataDetailModal(id) {
    const client = getActiveClient();
    const sourcePool = [...(state.master.datapoints || []), ...(client?.projectData?.localDatapoints || [])];
    const dp = sourcePool.find(d => String(d.id) === String(id));

    if (!dp) return console.error("❌ Data Tag not found:", id);

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
}

export function renderDataFlowMiniMap(dataId) {
    const client = getActiveClient();
    const resources = client?.projectData?.localResources || [];
    const nodes = [];

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
}

export function addNewDatapoint(isBundle = false) {
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

    persist();
    renderGlobalDataManager();
}

export function updateMasterDatapoint(index, field, value) {
    if (value === 'new') {
        const newCat = prompt("Enter new category name:");
        value = newCat || 'General';
    }

    state.master.datapoints[index][field] = value;
    persist();
    renderGlobalDataManager();
    OL.renderWorkbenchItemsOnly();
}

export function deleteMasterDatapointById(id) {
    if (!confirm("Permanently delete this item?")) return;
    state.master.datapoints = state.master.datapoints.filter(d => d.id !== id);
    persist();
    renderGlobalDataManager();
}

export function editBundle(bundleId) {
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
}

export function toggleDpInBundle(bundleId, dpId) {
    const bundle = state.master.datapoints.find(d => d.id === bundleId);
    if (!bundle.childIds) bundle.childIds = [];

    const idx = bundle.childIds.indexOf(dpId);
    if (idx === -1) bundle.childIds.push(dpId);
    else bundle.childIds.splice(idx, 1);

    persist();
    editBundle(bundleId);
}

export async function removeStepDatapoint(resId, stepId, idx) {
    const data = OL.getCurrentProjectData();
    const res = data.resources.find(r => String(r.id) === String(resId));
    const step = res?.steps?.find(s => String(s.id) === String(stepId));

    if (step && step.datapoints) {
        step.datapoints.splice(idx, 1);
        await persist();
        OL._fvRefreshInspector(resId, stepId);
        OL.renderVisualizer();
    }
}

export function renderDataTagPills(resId, stepId, datapoints) {
    const client = getActiveClient();
    return datapoints.map((dp, idx) => {
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
}

export function traceDataLineage(dataId) {
    if (!dataId) return OL.setTraceMode(null, null);

    const client = getActiveClient();
    const resources = client.projectData.localResources;

    const pathIds = resources.filter(res =>
        (res.steps || []).some(s => (s.datapoints || []).some(d => d.id === dataId))
    ).map(r => String(r.id));

    state.v2.activeTrace = { mode: 'data-trace', resId: dataId };
    state.v2.highlightedIds = pathIds;

    OL.renderVisualizer();
}

export function handleFieldDragStart(e, fieldId) {
    e.dataTransfer.setData("application/sphynx-field-id", fieldId);
    e.currentTarget.style.opacity = '0.4';
}

export function handleBundleDragOver(e) {
    e.preventDefault();
    const zone = e.currentTarget;
    zone.style.borderColor = 'var(--accent)';
    zone.style.background = 'rgba(var(--accent-rgb), 0.05)';
}

export function handleBundleDragLeave(e) {
    const zone = e.currentTarget;
    zone.style.borderColor = 'var(--line)';
    zone.style.background = 'rgba(255,255,255,0.02)';
}

export async function handleFieldDropOnBundle(e, bundleId) {
    e.preventDefault();
    handleBundleDragLeave(e);

    const fieldId = e.dataTransfer.getData("application/sphynx-field-id");
    if (!fieldId) return;

    const bundle = state.master.datapoints.find(d => d.id === bundleId);
    if (bundle) {
        if (!bundle.childIds) bundle.childIds = [];
        if (!bundle.childIds.includes(fieldId)) {
            bundle.childIds.push(fieldId);
            await persist();
            renderGlobalDataManager();
            console.log(`🔗 Linked ${fieldId} to Bundle ${bundleId}`);
        }
    }
}

export async function removeFieldFromBundle(bundleId, fieldId) {
    const bundle = state.master.datapoints.find(d => d.id === bundleId);
    if (bundle && bundle.childIds) {
        bundle.childIds = bundle.childIds.filter(id => id !== fieldId);
        await persist();
        renderGlobalDataManager();
    }
}

// ---- bridge: keep OL.*/window.* calls working until callers import directly ----
window.OL = window.OL || {};
Object.assign(window.OL, {
    renderGlobalDataManager, openMasterDataImporter, filterMasterDataImport,
    executeDataImport, renderDataRow, renderBundleRow, openDataDetailModal,
    renderDataFlowMiniMap, addNewDatapoint, updateMasterDatapoint,
    deleteMasterDatapointById, editBundle, toggleDpInBundle, removeStepDatapoint,
    renderDataTagPills, traceDataLineage, handleFieldDragStart, handleBundleDragOver,
    handleBundleDragLeave, handleFieldDropOnBundle, removeFieldFromBundle
});
