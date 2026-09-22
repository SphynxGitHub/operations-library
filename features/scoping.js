//======================= FEATURES / SCOPING =======================//
// Extracted from app.js "SCOPING AND PRICING SECTION" + "SCOPING-TASKS
// OVERLAP" (no clean boundary between them, so combined into one module
// same as with analysis.js earlier).
// Owns: the scoping sheet (line items, rounds, team multipliers,
// discounts), the pricing-rate "folder" modal, and scoping-item
// dependency management.

import { state, esc, uid, getActiveClient, persist } from '../core/data.js';
import { getRequestTypes, getCurrentRound, isActiveItem, isRoundApproved, SHEET_STATUSES } from '../core/requests.js';
import { deriveWorkStatus, testingPhaseFor, WORK_STATUS_LABELS, ASK_KINDS } from '../core/work-status.js';
import { requestResourceIds, teamMultiplier, priceRequest } from '../core/request-pricing.js';

// Names of task statuses that count as finished (falls back to Done).
function closedStatusNames() {
    const names = (typeof OL.getSystemStatuses === 'function' ? OL.getSystemStatuses() : [])
        .filter(st => st.isClosed).map(st => st.name);
    return names.length ? names : ['Done'];
}

export function getScopingDataForResource(resId) {
    const client = getActiveClient();
    if (!client?.projectData?.scopingSheets?.[0]) return null;
    const sheet = client.projectData.scopingSheets[0];
    return sheet.lineItems.find(item => String(item.resourceId) === String(resId));
}

export function isResourceInScope(resId) {
    return getScopingDataForResource(resId);
}

export function getScopingWorkflowContext() {
    const workflowId = state.focusedWorkflowId;
    if (!workflowId) return null;

    const workflow = OL.getResourceById(workflowId);
    if (!workflow) return null;

    const stepCount = (workflow.steps || []).length;
    const assets = (workflow.steps || []).map(s => OL.getResourceById(s.resourceLinkId)).filter(Boolean);
    
    const typeCounts = assets.reduce((acc, a) => {
        acc[a.type] = (acc[a.type] || 0) + 1;
        return acc;
    }, {});

    const typeSummary = Object.entries(typeCounts)
        .map(([type, count]) => `${count} ${type}${count > 1 ? 's' : ''}`)
        .join(', ');

    return {
        name: workflow.name,
        summary: typeSummary || "No assets mapped yet",
        count: stepCount
    };
};

// 1. RENDER SCOPING SHEET TABLE
export function renderScopingSheet() {
    if (typeof OL.registerView === 'function') {
        OL.registerView(() => renderScopingSheet());
    }

    OL.registerView(renderScopingSheet);

    const urlParams = new URLSearchParams(window.location.hash.split('?')[1]);
    const focusId = urlParams.get('focus');
    
    if (focusId) {
        state.scopingFilterActive = true;
        state.scopingTargetId = focusId;
    }

    const container = document.getElementById("mainContent");
    const client = getActiveClient();
    const isAdmin = state.adminMode === true;
    
    if (!container || !client) return;
    container.style.cssText = '';
    document.body.classList.remove('is-visualizer');

    if (!client.projectData) client.projectData = {};
    if (!client.projectData.localResources) client.projectData.localResources = [];
    if (!client.projectData.scopingSheets) {
        client.projectData.scopingSheets = [{ id: "initial", lineItems: [] }];
    }

    const sheet = client.projectData.scopingSheets[0];
    const baseRate = client.projectData.customBaseRate || state.master.rates.baseHourlyRate || 300;
    const showUnits = !!state.ui?.showScopingUnits;
    const wfContext = OL.getScopingWorkflowContext();
    
    const q = (state.scopingSearch || "").toLowerCase();
    const typeF = state.scopingTypeFilter || "All";
    const statusF = state.scopingStatusFilter || "All";
    const partyF = state.scopingPartyFilter || "All";

    const filteredItems = sheet.lineItems.filter(item => {
        if (state.scopingFilterActive && state.scopingTargetId) {
            return String(item.resourceId) === String(state.scopingTargetId);
        }

        const res = OL.getResourceById(item.resourceId);
        if (!res) return false;

        const matchesSearch = res.name.toLowerCase().includes(q) || (res.description || "").toLowerCase().includes(q);
        const matchesType = typeF === "All" || res.type === typeF;
        const matchesStatus = statusF === "All" || item.status === statusF;
        const matchesParty = partyF === "All" || item.responsibleParty === partyF;

        return matchesSearch && matchesType;
    });

    const availableTypes = [...new Set(sheet.lineItems.map(i => OL.getResourceById(i.resourceId)?.type))].filter(Boolean).sort();
    const availableParties = [...new Set(sheet.lineItems.map(i => i.responsibleParty))].filter(Boolean).sort();

    const roundGroups = {};
    filteredItems.forEach((item) => {
        const r = parseInt(item.round, 10) || 1;
        if (!roundGroups[r]) roundGroups[r] = [];
        roundGroups[r].push(item);
    });

    const sortedRoundKeys = Object.keys(roundGroups)
        .map((n) => parseInt(n, 10))
        .sort((a, b) => a - b);

    container.innerHTML = `
    <div class="section-header" style="display:flex; align-items:center; gap:12px;">
        <i data-lucide="table-properties" style="width:28px; height:24px; color:var(--accent);"></i>
        <div style="flex:1;">
            <h2 style="margin:0;">${esc(client.meta.name)} Scoping Sheet</h2>
        </div>
        <div class="header-actions">
            <button class="btn small soft" onclick="OL.toggleScopingUnits()" style="display:flex; align-items:center; gap:6px;">
                <i data-lucide="${showUnits ? "eye-off" : "eye"}" style="width:14px; height:14px;"></i>
                ${showUnits ? "Hide Units" : "Show Units"}
            </button>
            
            ${state.adminMode === true ? `
                <button class="btn small soft" onclick="OL.universalCreate('SOP')" style="display:flex; align-items:center; gap:6px;">
                    <i data-lucide="plus" style="width:14px; height:14px;"></i> New Resource
                </button>
                <button class="btn primary" onclick="OL.addResourceToScope()" style="display:flex; align-items:center; gap:6px;">
                    <i data-lucide="library" style="width:14px; height:14px;"></i> Add From Library
                </button>
                <button class="btn small soft" onclick="OL.openRequestLineModal()" style="display:flex; align-items:center; gap:6px;">
                    <i data-lucide="plus" style="width:14px; height:14px;"></i> Add Request
                </button>
            ` : ''}
        </div>
    </div>

    ${state.scopingFilterActive ? `
        <div style="display: flex; gap: 10px; margin-bottom: 20px;">
            <button class="btn primary" style="display:flex; align-items:center; gap:6px;"
                    onclick="state.scopingFilterActive = false; state.scopingTargetId = null; location.hash='#/scoping-sheet';">
                <i data-lucide="arrow-left" style="width:14px; height:14px;"></i> Show Full Scoping Sheet
            </button>
            <button class="btn soft" style="display:flex; align-items:center; gap:6px;"
                    onclick="state.scopingFilterActive = false; state.scopingTargetId = null; location.hash='#/visualizer';">
                <i data-lucide="map" style="width:14px; height:14px;"></i> Back to Flow Map
            </button>
        </div>
    ` : ''}

    ${wfContext ? `
        <div class="workflow-context-widget" 
             style="background: rgba(56, 189, 248, 0.05); border: 1px solid rgba(56, 189, 248, 0.2); padding: 12px 15px; border-radius: 8px; margin-bottom: 25px; display: flex; align-items: center; gap: 15px;">
            <i data-lucide="workflow" style="width:24px; height:24px; color:var(--accent);"></i>
            <div style="flex: 1;">
                <div class="tiny accent bold uppercase" style="font-size: 9px; letter-spacing: 0.05em;">Active Mapping Context</div>
                <div style="font-weight: bold; color: white; font-size: 14px;">${esc(wfContext.name)}</div>
                <div class="tiny muted">${wfContext.summary}</div>
            </div>
            <button class="btn tiny primary" onclick="location.hash='#/visualizer'" style="display:flex; align-items:center; gap:6px;">
                View Map <i data-lucide="chevron-right" style="width:12px; height:12px;"></i>
            </button>
        </div>
    ` : ''}

    ${state.scopingFilterActive ? `
        <div class="filter-banner" 
             style="background: rgba(16, 185, 129, 0.1); border: 1px solid #10b981; padding: 12px 20px; border-radius: 8px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center;">
            <div>
                <span class="tiny accent bold uppercase" style="display:block; font-size:9px;">Surgical View Active</span>
                <span style="color: white; font-weight: bold;">📍 Showing scoped details for linked resource</span>
            </div>
            <button class="btn tiny primary" 
                    onclick="state.scopingFilterActive = false; state.scopingTargetId = null; renderScopingSheet()">
                Show Full Sheet
            </button>
        </div>
    ` : ''}
    
    <div class="toolbar" style="display:grid; grid-template-columns: 2fr 1fr 1fr 1fr; gap:10px; margin-bottom: 20px; background: rgba(255,255,255,0.03); padding: 12px; border-radius: 8px; border: 1px solid var(--line);">
        <input type="text" id="scoping-search-input" class="modal-input tiny" 
               placeholder="Search..." value="${state.scopingSearch || ''}"
               oninput="state.scopingSearch = this.value; renderScopingSheet(); OL.refocus('scoping-search-input')">
        
        <select class="modal-input tiny" onchange="state.scopingTypeFilter = this.value; renderScopingSheet()">
            <option value="All">All Types</option>
            ${availableTypes.map(t => `<option value="${t}" ${typeF === t ? 'selected' : ''}>${t}</option>`).join('')}
        </select>

        <select class="modal-input tiny" onchange="state.scopingStatusFilter = this.value; renderScopingSheet()">
            <option value="All">All Statuses</option>
            ${['Do Now', 'Do Later', 'Done'].map(s => `<option value="${s}" ${statusF === s ? 'selected' : ''}>${s}</option>`).join('')}
        </select>

        <select class="modal-input tiny" onchange="state.scopingPartyFilter = this.value; renderScopingSheet()">
            <option value="All">All Parties</option>
            ${availableParties.map(p => `<option value="${p}" ${partyF === p ? 'selected' : ''}>${p}</option>`).join('')}
        </select>
    </div>

    <div class="scoping-grid">
        <div class="grid-row grid-header">
            <div class="col-expand">Deliverable</div>
            <div class="col-status">Status</div>
            <div class="col-team">Versions Multiplier</div>
            <div class="col-gross" style="text-align:center;">Gross</div>
            <div class="col-discount" style="text-align:center;">Disc</div> 
            <div class="col-numeric" style="text-align:right;">Net</div>
            <div class="col-actions"></div>
        </div>
    </div>

    <div class="rounds-container">
        ${sortedRoundKeys.length > 0 
            ? sortedRoundKeys.map((r) =>
                renderRoundGroup(
                    `Round ${r}`,
                    roundGroups[r],
                    baseRate,
                    showUnits,
                    client.meta.name,
                    r
                )
            ).join("")
            : `<div class="p-40 muted italic text-center">No items match your current filters.</div>`
        }
    </div>

    <div id="grand-totals-area"></div>
    `;

    renderGrandTotals(sheet.lineItems, baseRate);
    
    if (window.lucide) {
        window.lucide.createIcons();
    }
};

// 2. RENDER ROUND GROUPS
export function renderRoundGroup(roundName, items, baseRate, showUnits, clientName, roundNum) {
    const client = getActiveClient();
    const sheet = client.projectData.scopingSheets[0];
    
    let roundGrossValue = 0;
    let billableSubtotal = 0;
    let roundDeductionAmt = 0;
    let finalRoundNet = 0;
    let totalRoundSavings = 0;

    items.forEach(item => {
        const res = OL.getResourceById(item.resourceId);
        if (!res) return;

        const itemStickerPrice = OL.calculateBaseFeeWithMultiplier(item, res) || 0;
        roundGrossValue += itemStickerPrice;

        const status = String(item.status || "").toLowerCase().trim();
        const party = String(item.responsibleParty || "").toLowerCase().trim();
        
        if (status === 'do now' && (party === 'sphynx' || party === 'joint')) {
            billableSubtotal += (OL.calculateRowFee(item, res) || 0);
        }
    });

    const rKey = String(roundNum);
    if (sheet.roundDiscounts && sheet.roundDiscounts[rKey]) {
        const rDisc = sheet.roundDiscounts[rKey];
        const discVal = parseFloat(rDisc.value) || 0;
        
        roundDeductionAmt = (rDisc.type === '%') 
            ? Math.round(billableSubtotal * (discVal / 100)) 
            : discVal;
    }

    finalRoundNet = billableSubtotal - roundDeductionAmt;
    totalRoundSavings = roundGrossValue - finalRoundNet;

    const rows = items.map((item, idx) => renderScopingRow(item, idx, showUnits)).join("");

    // getCurrentRound now gates on each round's own approval (isRoundApproved)
    // internally, so the old "&& sheet.status === 'Approved'" prefix here
    // would double-gate against the legacy sheet-wide flag specifically —
    // dropped in favor of letting each round's own status decide.
    const isCurrentRound = getCurrentRound(sheet, i => !!OL.getResourceById(i.resourceId)) === Number(roundNum);
    const roundApprovalStatus = sheet.roundApprovals?.[String(roundNum)]?.status || sheet.status || '';
    const roundIsAdmin = state.adminMode === true;

    return `
        <div class="round-section" style="margin-bottom: 25px; border: 1px solid var(--panel-border); border-radius: 8px; overflow: hidden;">
            <div class="grid-row round-header-row" style="background: rgba(56, 189, 248, 0.1); border-bottom: 1px solid var(--accent);">
                <div class="col-expand">
                    <strong style="color: var(--accent); text-transform: uppercase; font-size: 11px;">${esc(roundName)}</strong>
                    ${isCurrentRound ? '<span class="pill tiny accent" style="margin-left:8px;">Current</span>' : ''}
                    ${roundIsAdmin ? `
                        <select class="tiny-select" style="width:auto; margin-left:8px;" title="Approval status for this round"
                                onchange="OL.setRoundApprovalStatus(${Number(roundNum)}, this.value)">
                            <option value="">Round status…</option>
                            ${SHEET_STATUSES.map(st => `<option value="${esc(st)}" ${roundApprovalStatus === st ? 'selected' : ''}>${esc(st)}</option>`).join('')}
                        </select>
                    ` : (roundApprovalStatus ? `<span class="pill tiny ${roundApprovalStatus === 'Approved' ? 'accent' : 'soft'}" style="margin-left:8px;">${esc(roundApprovalStatus)}</span>` : '')}
                    ${typeof OL.roundStatusHtml === 'function' ? OL.roundStatusHtml(client, sheet, roundNum, isCurrentRound) : ''}
                </div>
                <div class="col-status"></div>
                <div class="col-team"></div>
                
                <div class="col-gross tiny muted bold" style="text-align:center; line-height: 1.1;">
                    $${roundGrossValue.toLocaleString()}
                </div>
                
                <div class="col-discount tiny accent bold" style="text-align:center; line-height: 1.1;">
                    -$${totalRoundSavings.toLocaleString()}
                </div>
                
                <div class="col-numeric bold" style="font-size: 12px; text-align:right; line-height: 1.1;">
                    $${finalRoundNet.toLocaleString()}
                </div>
                
                <div class="col-actions"></div>
            </div>
            <div class="round-grid">${rows}</div>
        </div>
    `;
    if (window.lucide) {
        window.lucide.createIcons();
    }
};

function resolveResourceForItem(item, id) {
    const owner = Object.values(state.clients || {}).find(c => (c?.projectData?.scopingSheets || []).some(sh => (sh?.lineItems || []).includes(item))) || getActiveClient();
    return (owner?.projectData?.localResources || []).find(r => String(r.id) === String(id))
        || (state.master?.resources || []).find(r => String(r.id) === String(id))
        || OL.getResourceById(id) || null;
}

export function getRequestPriceBreakdown(item, primary) {
    const client = getActiveClient();
    const rates = state.master.rates || {};
    const resources = requestResourceIds(item).map((id, i) => (i === 0 ? (primary || OL.getResourceById(id)) : resolveResourceForItem(item, id)));
    return priceRequest(item, resources, {
        vars: rates.variables || {},
        baseRate: client?.projectData?.customBaseRate || rates.baseHourlyRate || 300,
        multiplier: teamMultiplier(item, { rate: rates.teamMultiplier, teamCount: (client?.projectData?.teamMembers || []).length || 1 }),
    });
}

export function calculateBaseFeeWithMultiplier(item, resource) {
    if (!item) return 0;
    if (requestResourceIds(item).length > 1) return getRequestPriceBreakdown(item, resource).gross;
    const vars = state.master.rates.variables || {};
    
    let calcData = { ...(resource?.data || {}), ...(item.data || {}) };
    
    let baseAmount = 0;
    let hasTechnicalData = false;

    Object.entries(calcData).forEach(([varId, count]) => {
        const v = vars[varId];
        const numCount = parseFloat(count) || 0;
        if (v && numCount > 0 && v.applyTo === resource?.type) {
            baseAmount += numCount * (parseFloat(v.value) || 0);
            hasTechnicalData = true;
        }
    });

    if (!hasTechnicalData) {
        const client = getActiveClient();
        const baseRate = client?.projectData?.customBaseRate || state.master.rates.baseHourlyRate || 300;
        baseAmount = (parseFloat(item.manualHours) || 0) * baseRate;
    }

    let multiplier = 1.0;
    const mode = (item.teamMode || 'everyone').toLowerCase();
    if (mode !== 'global') {
        const rate = parseFloat(state.master.rates.teamMultiplier) || 1.1;
        const inc = rate - 1;
        const count = mode === 'individual' ? (item.teamIds || []).length : (getActiveClient()?.projectData?.teamMembers || []).length || 1;
        multiplier = 1 + (Math.max(0, count - 1) * inc);
    }

    return Math.round(baseAmount * multiplier);
};

export function renderScopingRow(item, idx, showUnits) {
    const base = renderScopingRowBase(item, idx, showUnits);
    const extra = typeof OL.requestTasksRowHtml === 'function' ? OL.requestTasksRowHtml(getActiveClient(), item) : '';
    return base + extra;
}

function renderScopingRowBase(item, idx, showUnits) {
    const client = getActiveClient();
    const res = OL.getResourceById(item.resourceId);
    const isAdmin = state.adminMode === true;

    if (!res) {
        return `
            <div class="grid-row" style="opacity: 0.6; background: rgba(255,0,0,0.05); padding: 8px 10px;">
                <div class="col-expand">
                    <div class="row-title text-danger" style="display:flex; align-items:center; gap:6px;">
                        <i data-lucide="alert-triangle" style="width:14px; height:14px; color:#ef4444;"></i>
                        Missing Resource
                    </div>
                    <div class="tiny muted">Item: ${item.id}</div>
                </div>
                <div class="col-status">N/A</div>
                <div class="col-team">N/A</div>
                <div class="col-gross">N/A</div>
                <div class="col-discount">—</div>
                <div class="col-numeric">$0</div>
                <div class="col-actions">
                    ${isAdmin ? `
                        <button class="card-delete-btn" style="opacity: 0.3; display:flex; align-items:center; justify-center;" onclick="OL.removeFromScopeByID('${item.id}')">
                            <i data-lucide="x" style="width:14px; height:14px;"></i>
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
    }

    const typeIcon = OL.getRegistryIcon(res.type);

    const status = (item.status || "").toLowerCase();
    const party = (item.responsibleParty || "").toLowerCase();

    const isBillable = party === 'sphynx' || party === 'joint';
    const isCounted = status === 'do now' && isBillable;

    const gross = OL.calculateBaseFeeWithMultiplier(item, res);
    const net = isCounted ? OL.calculateRowFee(item, res) : gross; 
    const discountAmt = gross - net;

    const combinedData = { ...(res.data || {}), ...(item.data || {}) };
    const unitsHtml = showUnits ? OL.renderUnitBadges(combinedData, res) : "";
    const requestHoursHtml = res.isRequestLine
        ? `<div class="tiny muted">${parseFloat(item.manualHours) || 0}h estimated</div>`
        : "";

    const sheetForStatus = client?.projectData?.scopingSheets?.[0];
    const isActiveRow = isActiveItem(sheetForStatus, item, i => !!OL.getResourceById(i.resourceId));
    let workHtml = '';
    if (isActiveRow) {
        const round = Math.max(parseInt(item.round, 10) || 1, 1);
        const phase = testingPhaseFor(client?.projectData, sheetForStatus.id, item, round);
        const w = deriveWorkStatus(item, client?.projectData?.clientTasks || [], { closedNames: closedStatusNames(), phase });
        const waiting = w.status !== 'pending_sphynx_action';
        const color = w.status === 'in_testing' ? '#38bdf8' : waiting ? '#f59e0b' : '#64c6a2';
        workHtml = `
            <div class="tiny" style="margin-top:4px; display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                <span class="pill tiny" style="border:1px solid ${color}; color:${color};">${esc(WORK_STATUS_LABELS[w.status] || w.status)}</span>
                ${w.stepsTotal ? `<span class="muted">${w.stepsDone}/${w.stepsTotal} steps</span>` : ''}
                ${w.openAsks ? `<span class="muted">${w.openAsks} open ask${w.openAsks === 1 ? '' : 's'}${w.openBlockers ? `, ${w.openBlockers} blocking` : ''}</span>` : ''}
                ${isAdmin ? `<button class="btn tiny soft" onclick="OL.openAskModal('${item.id}')">Ask client…</button>` : ''}
                ${typeof OL.testBadgeHtml === 'function' ? OL.testBadgeHtml(client, item, isAdmin) : ''}
            </div>`;
    }
    const typeSelectHtml = `
        <select class="tiny-select" style="width:auto; max-width:120px;" title="Request type"
                onchange="OL.updateLineItem('${item.id}', 'requestType', this.value)">
            ${getRequestTypes().map(t => `<option value="${esc(t.key)}" ${(item.requestType || 'build') === t.key ? "selected" : ""}>${esc(t.label)}</option>`).join('')}
        </select>`;
    const titleClick = res.isRequestLine
        ? `OL.openRequestLineModal('${item.id}')`
        : `OL.openResourceModal('${item.id}')`;

    const projectTeam = client?.projectData?.teamMembers || [];
    const mode = (item.teamMode || 'everyone').toLowerCase();

    let hoverText = '';
    let teamLabel = '';
    let btnIcon = `<i data-lucide="users" style="width:14px; height:14px;"></i>`;
    let btnClass = 'soft';
    const multiplierHtml = `<span class="multiplier-tag">${OL.getMultiplierDisplay(item)}</span>`;

    if (mode === 'global') {
        teamLabel = '<span class="tiny muted italic">Global Item</span>';
        hoverText = "Applies to the entire project scope";
        btnIcon = `<i data-lucide="globe" style="width:14px; height:14px;"></i>`;
        btnClass = 'accent';
    } else if (mode === 'individual') {
        const selectedIds = item.teamIds || []; 
        const selectedCount = selectedIds.length;
        btnIcon = `<i data-lucide="user" style="width:14px; height:14px;"></i>`;
        btnClass = 'primary';
        const names = selectedIds
            .map(id => projectTeam.find(tm => tm.id === id)?.name || "Unknown")
            .filter(n => n !== "Unknown");

        if (selectedCount > 0) {
            teamLabel = `<span class="tiny muted">Individuals (${selectedCount})</span>`;
            hoverText = names.join(", ");
        } else {
            teamLabel = '<span class="tiny danger">No members!</span>';
            hoverText = "Click to assign team members";
        }
    } else {
        const totalCount = projectTeam.length;
        teamLabel = `<span class="tiny muted">Everyone (${totalCount})</span>`;
        hoverText = projectTeam.map(tm => tm.name).join(", ");
    }

    const teamBtnAttr = isAdmin 
    ? `onclick="OL.openTeamAssignmentModal('${item.id}')" class="btn tiny ${btnClass}" style="display:inline-flex; align-items:center; justify-content:center; padding: 4px 6px;"` 
    : `class="btn tiny ${btnClass}" style="cursor: default; pointer-events: none; opacity: 0.9; display:inline-flex; align-items:center; justify-content:center; padding: 4px 6px;"`;

    const isTarget = state.scopingFilterActive && String(item.resourceId) === String(state.scopingTargetId);

    setTimeout(() => { if (window.lucide) window.lucide.createIcons(); }, 0);

    return `
        <div class="grid-row ${isTarget ? 'surgical-focus-row' : ''}" style="border-bottom: 1px solid var(--line); padding: 8px 10px;">
        <div class="col-expand">
            <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                <div class="row-title is-clickable" style="display:flex; align-items:center; gap:6px;" onclick="${titleClick}">
                    ${OL.getLucideSVG(OL.getRegistryIcon(res.type), 13, 'var(--accent)')}
                    ${esc(res.name || "Manual Item")}
                </div>
                ${typeSelectHtml}
                <button class="btn tiny soft" onclick="OL.openRequestDetailDrawer(getActiveClient(), OL.getScopingLineItemById('${item.id}'))" style="margin-left:auto; display:inline-flex; align-items:center; gap:4px;">
                    <i data-lucide="sliders" style="width:11px;height:11px;"></i> Details
                </button>
            </div>
            ${res.description ? `<div class="row-note">${esc(res.description)}</div>` : ""}
            ${requestHoursHtml}
            ${workHtml}
            ${unitsHtml}
        </div>
      
        <div class="col-status">
            <select class="tiny-select" onchange="OL.updateLineItem('${item.id}', 'status', this.value)">
            <option value="Do Now" ${item.status === "Do Now" ? "selected" : ""}>Do Now</option>
            <option value="Do Later" ${item.status === "Do Later" ? "selected" : ""}>Do Later</option>
            <option value="Don't Do" ${item.status === "Don't Do" ? "selected" : ""}>Don't Do</option>
            <option value="Done" ${item.status === "Done" ? "selected" : ""}>Done</option>
            </select>
            <select class="tiny-select" style="margin-top:4px" onchange="OL.updateLineItem('${item.id}', 'responsibleParty', this.value)">
            <option value="Sphynx" ${item.responsibleParty === "Sphynx" ? "selected" : ""}>Sphynx</option>
            <option value="${esc(client.meta.name)}" ${item.responsibleParty === client.meta.name ? "selected" : ""}>${esc(client.meta.name)}</option>
            <option value="Joint" ${item.responsibleParty === "Joint" ? "selected" : ""}>Joint</option>
            </select>
        </div>

        <div class="col-team">
            <div style="display:flex; flex-direction:column; gap:4px;" title="${esc(hoverText)}">
                <div style="display:flex; align-items:center; gap:6px;">
                    <button ${teamBtnAttr}>
                        ${btnIcon}
                    </button>
                    
                    <div class="pills-row" 
                        ${isAdmin ? `onclick="OL.openTeamAssignmentModal('${item.id}')" style="cursor:pointer;"` : `style="cursor:default;"`}>
                        ${teamLabel}
                    </div>
                </div>
                <div style="padding-left: 34px;">
                    ${multiplierHtml}
                </div>
            </div>
        </div>
        
        <div class="col-gross tiny muted" style="text-align:center;">
            $${gross.toLocaleString()}
        </div>

        <div class="col-discount">
            ${discountAmt > 0 ? `
                <span class="tiny muted" onclick="OL.openDiscountManager()" style="padding: 2px 4px; font-size: 9px;">
                    -$${discountAmt.toLocaleString()}
                </span>
            ` : '<span class="tiny muted" style="opacity:0.2;">—</span>'}
        </div>

        <div class="col-numeric">
            <div class="bold" style="font-size: 13px;">$${net.toLocaleString()}</div>
        </div>

        <div class="col-actions">
            ${isAdmin ? `
                <button class="card-delete-btn" style="opacity: 0.3; display:flex; align-items:center; justify-content:center;" onclick="OL.removeFromScopeByID('${item.id}')">
                    <i data-lucide="x" style="width:14px; height:14px;"></i>
                </button>
            ` : ''}
        </div>
    </div>
  `;
}

export function openTeamAssignmentModal(itemId) {
    const client = getActiveClient();
    const item = client.projectData.scopingSheets[0].lineItems.find(i => i.id === itemId);
    const team = client.projectData.teamMembers || [];

    if (!item.teamIds) item.teamIds = [];

    let html = `
        <div class="modal-head">
            <div class="modal-title-text">👥 Assign Team to Item</div>
            <button class="btn small soft" onclick="OL.closeModal()">Done</button>
        </div>
        <div class="modal-body">
            <p class="tiny muted" style="margin-bottom:15px;">
                Selecting individual members will apply a multiplier based on the group size.
            </p>
            <div class="dp-manager-list">
                ${team.map(m => {
                    const isAssigned = item.teamIds.includes(m.id);
                    return `
                        <div class="dp-manager-row is-clickable" 
                             style="display:flex; justify-content:space-between; align-items:center; padding:10px; border-bottom:1px solid var(--line);"
                             onclick="OL.toggleTeamAssignment('${itemId}', '${m.id}')">
                            <div style="display:flex; align-items:center; gap:10px;">
                                <span>${isAssigned ? '✅' : '⬜'}</span>
                                <span style="${isAssigned ? 'font-weight:bold; color:var(--accent);' : ''}">${esc(m.name)}</span>
                            </div>
                            <span class="tiny muted uppercase">${esc(m.roles?.[0] || 'Member')}</span>
                        </div>
                    `;
                }).join('')}
                ${team.length === 0 ? '<div class="empty-hint">No project team members found. Add them in the Team tab first.</div>' : ''}
            </div>
            
            <div style="margin-top:20px; padding-top:15px; border-top:1px solid var(--line); display:flex; gap:10px;">
                <button class="btn tiny soft flex-1" onclick="OL.setTeamMode('${itemId}', 'everyone')">Apply to Everyone</button>
                <button class="btn tiny soft flex-1" onclick="OL.setTeamMode('${itemId}', 'global')">Mark as Global (1x)</button>
            </div>
        </div>
    `;
    openModal(html);
};

export function setTeamMode(itemId, mode) {
    const client = getActiveClient();
    const item = client.projectData.scopingSheets[0].lineItems.find(i => i.id === itemId);
    if (item) {
        item.teamMode = mode;
        if (mode === 'everyone') item.teamIds = []; 
        OL.persist();
        OL.closeModal();
        renderScopingSheet();
    }
};

export function updateLineItem(itemId, field, value) {
    const client = getActiveClient();
    const sheet = client.projectData.scopingSheets[0];
    
    let item = sheet.lineItems.find(i => String(i.id) === String(itemId));

    if (!item) {
        console.warn("⚠️ li-ID not found, searching via Resource ID:", itemId);
        item = sheet.lineItems.find(i => String(i.resourceId) === String(itemId));
    }

    if (item) {
        const previousValue = item[field];

        if (field === 'round') {
            item.round = parseInt(value, 10) || 1;
        } else {
            item[field] = value;
        }

        if ((field === 'status' || field === 'responsibleParty') && typeof OL.runAutomationRules === 'function') {
            const resource = typeof OL.getResourceById === 'function' ? OL.getResourceById(item.resourceId) : null;
            OL.runAutomationRules('scoping_status_change', {
                clientId: client.id, client,
                field,
                newValue: value,
                previousValue,
                status: item.status,
                party: item.responsibleParty,
                resourceName: resource?.name || ''
            });
        }

        OL.persist(); 
        window.renderScopingSheet();
    }
};

export function toggleScopingUnits() {
  if (!state.ui) state.ui = {};
  state.ui.showScopingUnits = !state.ui.showScopingUnits;

  OL.persist();
  renderScopingSheet();
};

export function renderUnitBadges(dataObject, res) {
    if (!state.ui?.showScopingUnits) return "";
    if (!dataObject || Object.keys(dataObject).length === 0) return "";

    const vars = state.master.rates.variables || {};
    const normalize = (s) => String(s || "").toLowerCase().replace(/\s+/g, "").trim();
    const resTypeKey = normalize(res?.type);

    const badges = Object.entries(dataObject)
        .filter(([varId, count]) => {
            const v = vars[varId];
            return v && count > 0 && normalize(v.applyTo) === resTypeKey;
        })
        .map(([varId, count]) => {
            const v = vars[varId];
            return `<span class="unit-tag">${count} ${esc(v.label)}</span>`;
        })
        .join("");

    return badges ? `<div class="unit-badge-container">${badges}</div>` : "";
};

export function addResourceToScope() {
    const html = `
        <div class="modal-head">
            <div class="modal-title-text">🔎 Add Resource to Scope</div>
            <div class="spacer"></div>
            <button class="btn small soft" onclick="OL.closeModal()">Cancel</button>
        </div>
        <div class="modal-body">
            <div class="search-map-container">
                <input type="text" class="modal-input" 
                       placeholder="Click to view library or search..." 
                       onfocus="OL.filterResourceForScope('')" 
                       oninput="OL.filterResourceForScope(this.value)" 
                       autofocus>
                <div id="scope-search-results" class="search-results-overlay" style="margin-top:15px;"></div>
            </div>
        </div>
    `;
    openModal(html);
};

export async function removeFromScope(indexStr) {
    if (!confirm("Remove this item from project scope?")) return;
    
    const client = getActiveClient();
    if (!client || !client.projectData.scopingSheets) return;

    const index = parseInt(indexStr, 10);
    const sheet = client.projectData.scopingSheets[0];

    await OL.updateAndSync(() => {
        if (index > -1 && index < sheet.lineItems.length) {
            sheet.lineItems.splice(index, 1);
        }
    });

    renderScopingSheet();
};

export async function removeFromScopeByID(lineItemId) {
    if (!confirm("Remove this specific item from project scope?")) return;
    
    const client = getActiveClient();
    if (!client || !client.projectData.scopingSheets) return;

    const sheet = client.projectData.scopingSheets[0];
    const actualIndex = sheet.lineItems.findIndex(i => String(i.id) === String(lineItemId));

    if (actualIndex > -1) {
        await OL.updateAndSync(() => {
            sheet.lineItems.splice(actualIndex, 1);
        });

        renderScopingSheet();
    }
};

export function filterResourceForScope(query) {
    const listEl = document.getElementById("scope-search-results");
    if (!listEl) return;

    const q = (query || "").toLowerCase().trim();
    const client = getActiveClient();
    
    const existingIds = (client?.projectData?.scopingSheets?.[0]?.lineItems || []).map(i => i.resourceId);

    const masterSource = (state.master.resources || []).map(r => ({ ...r, origin: 'Master' }));
    const localSource = (client?.projectData?.localResources || []).map(r => ({ ...r, origin: 'Local' }));
    
    const localMasterRefs = localSource.map(r => r.masterRefId);
    const filteredMaster = masterSource.filter(m => !localMasterRefs.includes(m.id));

    const combined = [...localSource, ...filteredMaster];

    const matches = combined.filter((res) => {
        if (state.scopingFilterActive && state.scopingTargetId) {
            return String(res.id) === String(state.scopingTargetId);
        }

        const nameMatch = res.name.toLowerCase().includes(q);
        const alreadyInScope = existingIds.includes(res.id);
        return nameMatch && !alreadyInScope;
    });

    const masterMatches = matches.filter(m => m.origin === 'Master').sort((a,b) => a.name.localeCompare(b.name));
    const localMatches = matches.filter(m => m.origin === 'Local').sort((a,b) => a.name.localeCompare(b.name));

    let html = "";

    if (localMatches.length > 0) {
        html += `<div class="search-group-header">📍 Available in Project</div>`;
        html += localMatches.map(res => renderResourceSearchResult(res, 'local')).join('');
    }

    if (masterMatches.length > 0) {
        html += `<div class="search-group-header" style="margin-top:10px;">🏛️ Master Vault Standards</div>`;
        html += masterMatches.map(res => renderResourceSearchResult(res, 'vault')).join('');
    }

    if (matches.length === 0) {
        html = `<div class="search-result-item muted">No unlinked resources match "${esc(query)}"</div>`;
    }

    listEl.innerHTML = html;
};

export function renderResourceSearchResult(res, tagClass) {
    return `
        <div class="search-result-item" onmousedown="OL.executeScopeAdd('${res.id}')">
            <div style="display:flex; justify-content:space-between; align-items:center; width: 100%;">
                <div style="display:flex; align-items:center; gap:8px;">
                    <span>🛠️</span>
                    <div>
                        <div style="font-size: 13px; font-weight: 500;">${esc(res.name)}</div>
                        <div class="tiny muted">${esc(res.type || "General")}</div>
                    </div>
                </div>
                <span class="pill tiny ${tagClass}">${tagClass.toUpperCase()}</span>
            </div>
        </div>
    `;
}

export async function executeScopeAdd(resId) {
    const client = getActiveClient();
    if (!client) return;

    let finalResourceId = resId;

    if (resId.startsWith('res-vlt-')) {
        const template = state.master.resources.find(r => r.id === resId);
        if (template) {
            const existingLocal = (client.projectData.localResources || [])
                .find(r => r.masterRefId === resId);

            if (existingLocal) {
                finalResourceId = existingLocal.id;
            } else {
                const newRes = JSON.parse(JSON.stringify(template));
                newRes.id = 'local-prj-' + Date.now() + Math.random().toString(36).substr(2, 5);
                newRes.masterRefId = resId;
                
                if (!client.projectData.localResources) client.projectData.localResources = [];
                client.projectData.localResources.push(newRes);
                finalResourceId = newRes.id;
            }
        }
    }

    const addedRes = (client.projectData.localResources || []).find(r => r.id === finalResourceId)
        || (state.master.resources || []).find(r => r.id === finalResourceId);
    const isEventType = String(addedRes?.type || '').toLowerCase() === 'event';

    const newItem = {
        id: 'li-' + Date.now(),
        resourceId: finalResourceId, 
        status: "Do Now",
        responsibleParty: isEventType ? (client.meta?.name || "Client") : "Sphynx",
        round: 1,
        teamMode: "everyone", 
        teamIds: [],
        data: {},
        manualHours: 0,
        dependencies: [],
    };

    if (!client.projectData.scopingSheets) client.projectData.scopingSheets = [{id: 'initial', lineItems: []}];
    client.projectData.scopingSheets[0].lineItems.push(newItem);

    await OL.persist();
    
    OL.closeModal();
    renderScopingSheet(); 
};

export function cycleTeamMode(itemId) {
    const client = getActiveClient();
    const item = client.projectData.scopingSheets[0].lineItems.find(i => i.id === itemId);
    if (!item) return;

    const modes = ['everyone', 'individual', 'global'];
    let currentIdx = modes.indexOf(item.teamMode || 'everyone');
    item.teamMode = modes[(currentIdx + 1) % modes.length];

    OL.persist();
    renderScopingSheet();
};

export function getMultiplierDisplay(item) {
  const client = getActiveClient();
  const rate = parseFloat(state.master.rates.teamMultiplier) || 1.1;
  
  const mode = (item.teamMode || "everyone").toLowerCase();

  if (mode === "global") {
    return `<span class="text-dim">1.00x</span>`;
  }

  let count = 0;
  if (mode === "individual" || (item.teamIds && item.teamIds.length > 0)) {
    count = (item.teamIds || []).length;
  } else {
    count = (client?.projectData?.teamMembers || []).length || 1;
  }
  
  const incrementalRate = rate - 1;
  const additionalMembers = Math.max(0, count - 1);
  const displayMult = 1 + additionalMembers * incrementalRate;
  const isIncremented = additionalMembers > 0;
  const color = isIncremented ? "var(--accent)" : "var(--text-dim)";

  return `
    <span style="color: ${color}; font-weight: ${isIncremented ? "600" : "400"};">
        ${displayMult.toFixed(2)}x
    </span>
  `;
};

export function calculateRowFee(item, resource) {
    const gross = OL.calculateBaseFeeWithMultiplier(item, resource);
    return OL.applyDiscount(gross, item.discountValue, item.discountType);
};

export function renderGrandTotals(lineItems, baseRate) {
    const area = document.getElementById("grand-totals-area");
    const client = getActiveClient();
    const sheet = client?.projectData?.scopingSheets?.[0];
    const isAdmin = state.adminMode === true;

    if (!area || !client || !sheet) return;

    let totalGross = 0;
    let netAfterLineItems = 0;

    lineItems.forEach(item => {
        const res = OL.getResourceById(item.resourceId);
        if (!res) return;

        const itemGross = OL.calculateBaseFeeWithMultiplier(item, res);
        totalGross += itemGross

        const status = (item.status || "").toLowerCase();
        const party = (item.responsibleParty || "").toLowerCase();
        
        const isDoNow = status === 'do now';
        const isBillable = party === 'sphynx' || party === 'joint';

        if (isDoNow && isBillable) {
            netAfterLineItems += OL.calculateRowFee(item, res);
        }
    });

   let netAfterRounds = netAfterLineItems;
    if (sheet.roundDiscounts) {
        Object.keys(sheet.roundDiscounts).forEach(rNum => {
            const rDisc = sheet.roundDiscounts[rNum];
            const roundItems = lineItems.filter(i => 
                String(i.round) === String(rNum) && 
                (i.status || "").toLowerCase() === 'do now'
            );
            
            const roundSubtotal = roundItems.reduce((s, i) => {
                const r = OL.getResourceById(i.resourceId);
                return s + (r ? OL.calculateRowFee(i, r) : 0);
            }, 0);
            
            const rDeduct = rDisc.type === '%' 
                ? Math.round(roundSubtotal * (parseFloat(rDisc.value) / 100)) 
                : parseFloat(rDisc.value) || 0;
            netAfterRounds -= rDeduct;
        });
    }

    const gVal = client.projectData.totalDiscountValue || 0;
    const gType = client.projectData.totalDiscountType || '$';
    const globalAdjustment = gType === '%' ? Math.round(netAfterRounds * (gVal / 100)) : Math.min(netAfterRounds, gVal);
    const finalApproved = netAfterRounds - globalAdjustment;

    const totalAdjustments = totalGross - finalApproved;

    area.innerHTML = `
    <div class="grand-totals-bar">
      <div class="grand-actions">
        <button class="btn tiny soft" onclick="OL.printScopingSheet()">🖨️ PDF</button>
        ${isAdmin ? `<button class="btn tiny accent" onclick="OL.openDiscountManager()">🏷️ Adjustments</button>` : ''}
      </div>

      <div class="total-item-gross">
        <div class="tiny muted uppercase bold">Gross Value</div>
        <div style="font-size: 14px; font-weight: 600;">$${totalGross.toLocaleString()}</div>
      </div>

      <div class="total-item-disc">
        <div class="tiny accent uppercase bold">Adjustments</div>
        <div class="accent" style="font-size: 14px; font-weight: 600;">-$${totalAdjustments.toLocaleString()}</div>
      </div>

      <div class="total-item-net">
        <div class="tiny muted uppercase bold" style="color: var(--accent);">Final Approved</div>
        <div style="font-size: 22px; font-weight: 900; line-height: 1;">$${finalApproved.toLocaleString()}</div>
      </div>
    </div>`;
};

export function renderDiscountInput(level, id, value, type) {
  return `
    <div class="discount-control">
      <input type="number" class="tiny-input"
        value="${Number(value) || 0}"
        oninput="OL.updateDiscount('${level}', '${id}', 'value', this.value)">
      <div class="toggle-group">
        <button class="toggle-btn ${type === "$" ? "active" : ""}"
          onclick="OL.updateDiscount('${level}', '${id}', 'type', '$')">$</button>
        <button class="toggle-btn ${type === "%" ? "active" : ""}"
          onclick="OL.updateDiscount('${level}', '${id}', 'type', '%')">%</button>
      </div>
    </div>
  `;
};

export function openDiscountManager() {
  const client = getActiveClient();
  const sheet = client?.projectData?.scopingSheets?.[0];
  if (!client || !sheet) return;

  const allRes = [
    ...(state.master.resources || []),
    ...(client.projectData.localResources || []),
  ];

  const rounds = {};
  sheet.lineItems.forEach((item) => {
    if (
      item.status === "Do Now" &&
      (item.responsibleParty === "Sphynx" || item.responsibleParty === "Joint")
    ) {
      const r = item.round || 1;
      if (!rounds[r]) rounds[r] = [];
      rounds[r].push(item);
    }
  });

  let html = `
    <div class="modal-head">
      <div class="modal-title-text">💰 Financial Adjustments</div>
      <button class="btn tiny soft"
        onclick="if(confirm('Clear all discounts?')) OL.clearAllDiscounts()">
        🔄 Reset
      </button>
    </div>

    <div class="modal-body" style="max-height:75vh; overflow:auto;">
  `;

  Object.keys(rounds)
    .sort((a, b) => a - b)
    .forEach((rNum) => {
      const items = rounds[rNum];
      let roundGross = 0;
      let itemDeductions = 0;

      html += `
      <div class="card-section" style="margin-bottom:25px;">
        <label class="modal-section-label">ROUND ${rNum}</label>
    `;

      items.forEach((item) => {
        const res = allRes.find((r) => r.id === item.resourceId);
        const gross = OL.calculateBaseFeeWithMultiplier(item, res);
        const net = OL.calculateRowFee(item, res);
        const deduct = gross - net;

        roundGross += gross;
        itemDeductions += deduct;

        html += `
        <div class="discount-row">
          <div class="tiny">${esc(res?.name || "Manual Item")}</div>
          <div class="tiny muted">$${gross.toLocaleString()}</div>
          ${renderDiscountInput(
            "item",
            item.id,
            item.discountValue || 0,
            item.discountType || "$",
          )}
        </div>
      `;
      });

      const rDisc = sheet.roundDiscounts?.[rNum] || { value: 0, type: "$" };
      const netAfterItems = roundGross - itemDeductions;

      html += `
        <div class="divider"></div>

        <div class="discount-row">
          <span class="tiny muted">Item Discounts</span>
          <span class="tiny accent">-$${itemDeductions.toLocaleString()}</span>
        </div>

        <div class="discount-row">
          <span class="tiny muted">Round Discount</span>
          ${renderDiscountInput("round", rNum, rDisc.value, rDisc.type)}
        </div>
      </div>
    `;
    });

  const gVal = client.projectData.totalDiscountValue || 0;
  const gType = client.projectData.totalDiscountType || "$";

  html += `
      <div class="card-section">
        <label class="modal-section-label">GLOBAL DISCOUNT</label>
        ${renderDiscountInput("total", "global", gVal, gType)}
      </div>
    </div>

    <div class="modal-foot">
      <button class="btn primary full"
        onclick="OL.closeModal(); renderScopingSheet();">
        Apply Adjustments
      </button>
    </div>
  `;

  openModal(html);
};

export function updateDiscount(level, id, field, value) {
  const client = getActiveClient();
  const sheet = client?.projectData?.scopingSheets?.[0];
  if (!client || !sheet) return;

  if (level === "item") {
    const item = sheet.lineItems.find((i) => i.id === id);
    if (!item) return;
    if (field === "value") item.discountValue = parseFloat(value) || 0;
    if (field === "type") item.discountType = value;
  }

  if (level === "round") {
    if (!sheet.roundDiscounts) sheet.roundDiscounts = {};
    const rKey = String(id);
    if (!sheet.roundDiscounts[rKey]) {
        sheet.roundDiscounts[rKey] = { value: 0, type: "$" };
    }
    if (field === "value")
      sheet.roundDiscounts[id].value = parseFloat(value) || 0;
    if (field === "type") sheet.roundDiscounts[id].type = value;
  }

  if (level === "total") {
    if (field === "value")
      client.projectData.totalDiscountValue = parseFloat(value) || 0;
    if (field === "type") client.projectData.totalDiscountType = value;
  }

  OL.persist();

  OL.refreshDiscountManagerUI();
  renderScopingSheet();
};

export function refreshDiscountManagerUI() {
  const client = getActiveClient();
  const sheet = client?.projectData?.scopingSheets?.[0];
  if (!client || !sheet) return;

  const allRes = [
    ...(state.master.resources || []),
    ...(client.projectData.localResources || []),
  ];

  let gross = 0;
  let deductions = 0;

  sheet.lineItems.forEach((item) => {
    if (
      item.status !== "Do Now" ||
      (item.responsibleParty !== "Sphynx" && item.responsibleParty !== "Joint")
    )
      return;

    const res = allRes.find((r) => r.id === item.resourceId);
    const g = OL.calculateBaseFeeWithMultiplier(item, res);
    const n = OL.calculateRowFee(item, res);

    gross += g;
    deductions += g - n;
  });

  const netPreGlobal = gross - deductions;
  const gVal = client.projectData.totalDiscountValue || 0;
  const gType = client.projectData.totalDiscountType || "$";
  const gDeduct =
    gType === "%"
      ? Math.round(netPreGlobal * (gVal / 100))
      : Math.min(netPreGlobal, gVal);

  const final = gross - deductions - gDeduct;

  const elGross = document.getElementById("summary-gross-total");
  const elDeduct = document.getElementById("summary-total-deductions");
  const elFinal = document.getElementById("summary-final-total");

  if (elGross) elGross.textContent = `$${gross.toLocaleString()}`;
  if (elDeduct)
    elDeduct.textContent = `-$${(deductions + gDeduct).toLocaleString()}`;
  if (elFinal) elFinal.textContent = `$${final.toLocaleString()}`;
};

export function applyDiscount(amount, value, type) {
  const v = parseFloat(value) || 0;
  if (v <= 0) return amount;

  if (type === "%") {
    return Math.round(amount * (1 - v / 100));
  }

  return Math.max(0, Math.round(amount - v));
};

export function clearAllDiscounts() {
  const client = getActiveClient();
  const sheet = client?.projectData?.scopingSheets?.[0];
  if (!client || !sheet) return;

  client.projectData.totalDiscountValue = 0;
  client.projectData.totalDiscountType = "$";
  sheet.roundDiscounts = {};

  sheet.lineItems.forEach((item) => {
    delete item.discountValue;
    delete item.discountType;
  });

  OL.persist();
  renderScopingSheet();
};

// 13. PRICING FOLDER MODAL
export function openTypeDetailModal(typeKey) {
  const registry = state.master.resourceTypes || [];
  const typeData = registry.find(
    (r) => r.type === typeKey || r.typeKey === typeKey,
  );
  const variables = state.master.rates.variables || {};
  const relevantVars = Object.entries(variables).filter(
    ([_, v]) => v.applyTo === typeKey,
  );

  const html = `
        <div class="modal-head">
            <div class="modal-title-text">⚙️ Pricing Folder: ${esc(typeData?.type || typeKey)}</div>
        </div>
        <div class="modal-body">
            <label class="modal-section-label">Active Rates</label>
            <div class="dp-manager-list" style="margin-bottom: 25px;">
                ${relevantVars.map(([key, v]) => `
                    <div class="dp-manager-row" style="display:flex; align-items:center; gap:12px; padding: 10px 10px; border-bottom: 1px solid var(--line);">
                        <div style="flex:1">
                            <div contenteditable="true" 
                                class="bold" 
                                style="cursor: text; outline:none;"
                                onblur="OL.updateVarRate('${key}', 'label', this.innerText)">
                                ${esc(v.label)}
                            </div>
                            <div class="tiny muted" style="font-family: monospace; opacity: 0.5;">ID: ${key}</div>
                        </div>
                        
                        <div style="display:flex; align-items:center; gap:8px;">
                            <div style="display:flex; align-items:center; background: rgba(255,255,255,0.05); padding: 2px 8px; border-radius: 4px; border: 1px solid var(--line);">
                                <span class="tiny muted" style="margin-right:4px;">$</span>
                                <input type="number" class="modal-input tiny" value="${v.value}" 
                                      style="width:60px; border:none; background:transparent; color: white; text-align:right;"
                                      onblur="OL.updateVarRate('${key}', 'value', this.value)">
                            </div>
                            
                            <button class="card-delete-btn" 
                                    style="position:static; opacity: 0.3;" 
                                    onmouseover="this.style.opacity=1" 
                                    onmouseout="this.style.opacity=0.3"
                                    onclick="OL.removeScopingVariable('${key}', '${typeKey}')">
                                ×
                            </button>
                        </div>
                    </div>
                `).join("")}
                ${relevantVars.length === 0 ? '<div class="empty-hint">No variables yet.</div>' : ""}
            </div>

            <label class="modal-section-label">Create New Variable</label>
            <div class="search-map-container">
                <input type="text" class="modal-input" placeholder="Enter label (e.g. Per Segment)..." 
                       onkeydown="if(event.key==='Enter'){ OL.createNewVarForType(this.value, '${typeKey}'); this.value=''; }">
                <div class="tiny muted" style="margin-top:5px;">Press Enter to save.</div>
            </div>
        </div>
    `;
  openModal(html);
};

export function createNewVarForType(label, typeKey) {
    const safeTypeKey = (typeKey || "general").toLowerCase().trim();
    const varKey = label.toLowerCase().replace(/[^a-z0-9]+/g, "") + "_" + Date.now().toString().slice(-4);
    
    if (!state.master.rates.variables) state.master.rates.variables = {};

    state.master.rates.variables[varKey] = {
        label,
        value: 0,
        applyTo: typeKey,
        archetype: "Base",
    };

    OL.persist();
    OL.openTypeDetailModal(typeKey); 
    renderVaultRatesPage(); 
};

export async function updateVarRate(key, field, val) {
    if (!state.master.rates.variables[key]) return;
 
    state.master.rates.variables[key][field] = field === 'value' ? parseFloat(val) || 0 : val.trim();
 
    const { error } = await window.db
        .from('workspace_masters')
        .update({ rates: state.master.rates })
        .eq('id', 'main_state');
 
    if (error) {
        console.error('❌ Rate save failed:', error.message);
        return;
    }
};

export function removeScopingVariable(varKey, typeKey) {
    if (!confirm("Are you sure you want to delete this pricing variable? This will remove it from all resources using this type.")) return;

    if (state.master.rates.variables && state.master.rates.variables[varKey]) {
        delete state.master.rates.variables[varKey];
        OL.persist();

        if (window.location.hash.includes('vault/rates')) {
            renderVaultRatesPage();
        }

        OL.openTypeDetailModal(typeKey);
    }
};

//======================= SCOPING-TASKS OVERLAP ========================//

export function renderDependencyRow(dep, parentId) {
    const client = getActiveClient();
    const isTask = dep.type === 'task';
    
    let obj = isTask 
        ? (client?.projectData?.clientTasks || []).find(t => t.id === dep.id)
        : OL.getResourceById(dep.id);

    const icon = isTask ? OL.getLucideSVG('clipboard-list', 14, 'currentColor') : OL.getLucideSVG(OL.getRegistryIcon(obj?.type), 14, 'currentColor');
    
    const clickAction = isTask
        ? `OL.openTaskInContext('${client?.id}', '${dep.id}')`
        : `OL.openResourceModal('${dep.id}')`;

    return `
        <div class="dp-manager-row" style="display:flex; justify-content:space-between; align-items:center; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.03);">
            <div style="display:flex; align-items:center; gap:8px; cursor:pointer; flex:1;" onclick="${clickAction}">
                <span style="font-size:12px;">${icon}</span>
                <div style="display:flex; flex-direction:column;">
                    <span style="font-size:11px; font-weight:bold; color: ${isTask ? 'var(--text-main)' : 'var(--accent)'}">${esc(obj?.name || "Deleted Item")}</span>
                    <span style="font-size:8px; opacity:0.5; text-transform:uppercase;">${isTask ? (obj?.status || 'Pending') : (obj?.type || 'Resource')}</span>
                </div>
            </div>
            <button class="card-delete-btn" style="position:static; opacity:0.4;" onclick="OL.removeDependencyById('${parentId}', '${dep.id}')">×</button>
        </div>
    `;
}

export function getDependencyStatus(item, allItems) {
    if (!item.dependencies || item.dependencies.length === 0) return 'ready';
    
    const blockedBy = [];
    item.dependencies.forEach(depId => {
        const depItem = allItems.find(i => i.id === depId);
        if (depItem && depItem.status !== 'Done') {
            const res = OL.getResourceById(depItem.resourceId);
            blockedBy.push(res?.name || "Required Task");
        }
    });

    return blockedBy.length > 0 ? { status: 'blocked', list: blockedBy } : { status: 'ready' };
};

export function openDependencyManager(lineItemId) {
    const client = getActiveClient();
    const sheet = client.projectData.scopingSheets[0];
    const targetItem = sheet.lineItems.find(i => i.id === lineItemId);
    const targetRes = OL.getResourceById(targetItem.resourceId);

    const html = `
        <div class="modal-head">
            <div class="modal-title-text">🔗 Manage Dependencies for: ${esc(targetRes?.name)}</div>
            <button class="btn small soft" onclick="OL.closeModal()">Close</button>
        </div>
        <div class="modal-body">
            <label class="modal-section-label">Active Dependencies</label>
            <div class="dp-manager-list" style="margin-bottom: 20px;">
                ${(targetItem.dependencies || []).map(depId => {
                    const depItem = sheet.lineItems.find(i => i.id === depId);
                    const depRes = OL.getResourceById(depItem?.resourceId);
                    return `
                        <div class="dp-manager-row" style="display:flex; justify-content:space-between; align-items:center;">
                            <span>🎯 ${esc(depRes?.name || "Unknown Item")}</span>
                            <button class="btn-icon-tiny" onclick="OL.toggleDependency('${lineItemId}', '${depId}')">×</button>
                        </div>
                    `;
                }).join('') || '<div class="tiny muted">No dependencies set.</div>'}
            </div>

            <label class="modal-section-label">Add Dependency (Search project items)</label>
            <div class="search-map-container">
                <input type="text" class="modal-input" placeholder="Search other scoped items..."
                       oninput="OL.filterDependencySearch('${lineItemId}', this.value)">
                <div id="dep-search-results" class="search-results-overlay"></div>
            </div>
        </div>
    `;
    openModal(html);
};

export function filterDependencySearch(currentResId, mode, query) {
    const targetElId = mode === 'task' ? "task-dep-results" : "res-dep-results";
    const listEl = document.getElementById(targetElId);
    if (!listEl) return;

    const q = (query || "").toLowerCase().trim();
    const client = getActiveClient();
    const currentRes = OL.getResourceById(currentResId);
    const existingIds = (currentRes.dependencies || []).map(d => d.id);

    let matches = [];
    let html = "";

    if (mode === 'task') {
        matches = (client?.projectData?.clientTasks || []).filter(t => 
            !existingIds.includes(t.id) && t.name.toLowerCase().includes(q)
        );
        html = matches.map(t => `
            <div class="search-result-item" onmousedown="OL.addDependency('${currentResId}', '${t.id}', 'task')">
                <span>📋 ${esc(t.name)}</span>
            </div>
        `).join('');

        if (q.length > 0 && !matches.some(m => m.name.toLowerCase() === q)) {
            html += `<div class="search-result-item create-action" onmousedown="OL.createAndLinkTaskDependency('${currentResId}', '${esc(query)}')">
                <span class="pill tiny accent">+ CREATE TASK</span> "${esc(query)}"
            </div>`;
        }
    } else {
        const data = OL.getCurrentProjectData();
        matches = (data.resources || []).filter(r => 
            String(r.id) !== String(currentResId) && !existingIds.includes(r.id) && r.name.toLowerCase().includes(q)
        );
        html = matches.map(r => `
            <div class="search-result-item" onmousedown="OL.addDependency('${currentResId}', '${r.id}', 'resource')">
                <span style="display:flex; align-items:center; gap:6px;">
                    ${OL.getLucideSVG(OL.getRegistryIcon(r.type), 13, 'var(--accent)')}
                    ${esc(r.name)}
                </span>
            </div>
        `).join('');
    }

    listEl.innerHTML = html || '<div class="search-result-item muted">No matches found.</div>';
    listEl.style.display = 'block';
};

export async function createAndLinkTaskDependency(resId, taskName) {
    const client = getActiveClient();
    if (!client) return;

    const taskId = 'tk-' + Date.now();
    const newTask = {
        id: taskId,
        name: taskName,
        status: "Pending",
        description: "",
        appIds: [],
        howToIds: [],
        assigneeIds: [],
        createdDate: new Date().toISOString()
    };

    await OL.updateAndSync(() => {
        if (!client.projectData.clientTasks) client.projectData.clientTasks = [];
        client.projectData.clientTasks.push(newTask);

        const res = OL.getResourceById(resId);
        if (res) {
            if (!res.dependencies) res.dependencies = [];
            res.dependencies.push({
                id: taskId,
                type: 'task',
                addedDate: new Date().toISOString()
            });
        }
    });

    OL.openTaskInContext(client.id, taskId);
    
    if (typeof renderClientTaskManager === 'function') renderClientTaskManager();
};

export async function addDependency(resId, depId, type) {
    const res = OL.getResourceById(resId);
    if (!res) return;

    if (!res.dependencies) res.dependencies = [];
    
    const depTarget = OL.getResourceById(depId);
    if (depTarget?.dependencies?.some(d => d.id === resId)) {
        alert("🚫 Circular Dependency detected! This item already depends on the current one.");
        return;
    }

    res.dependencies.push({
        id: depId,
        type: type,
        addedDate: new Date().toISOString()
    });

    await OL.persist();
    OL.openResourceModal(resId);
};

export async function removeDependencyById(resId, depId) {
    const res = OL.getResourceById(resId);
    if (res && res.dependencies) {
        res.dependencies = res.dependencies.filter(d => d.id !== depId);
        await OL.persist();
        OL.openResourceModal(resId);
    }
};

export function getScopingLineItemById(itemId) {
    const client = getActiveClient();
    const sheet = client?.projectData?.scopingSheets?.[0];
    return sheet?.lineItems?.find(i => String(i.id) === String(itemId)) || null;
}

export function openRequestDetailDrawer(client, req) {
  if (!client || !req) return;
  
  const attachedFiles = req.driveFiles || [];

  const html = `
    <div class="modal-head" style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--line); padding-bottom:12px;">
      <div class="modal-title-text" style="font-weight:700; font-size:16px;">📋 Request Details: ${esc(req.actionName || 'Scoping Item')}</div>
      <button class="btn tiny soft" onclick="OL.closeModal()">✕</button>
    </div>

    <div class="modal-body" style="padding-top:16px; max-width:820px; width:100%;">
      
      <!-- DESCRIPTION / SCOPING NOTES -->
      <div style="margin-bottom: 20px; background: rgba(255,255,255,0.02); padding: 14px; border-radius: 6px; border:1px solid var(--line);">
        <label class="bold tiny uppercase muted" style="display:block; margin-bottom:6px;">Scoping Details & Instructions:</label>
        <textarea class="modal-input tiny" style="width: 100%; box-sizing:border-box; font-size:13px; line-height:1.5; resize:vertical;" rows="3"
                  placeholder="Add details for client request..."
                  onblur="OL.updateRequestDescription('${client.id}', '${req.id}', this.value)">${esc(req.description || '')}</textarea>
      </div>

      <!-- DRIVE ATTACHMENTS -->
      <div style="margin-bottom: 20px; background: rgba(255,255,255,0.02); padding: 14px; border-radius: 6px; border:1px solid var(--line);">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <label class="bold tiny uppercase muted" style="margin:0;">Attached Drive Files (${attachedFiles.length}):</label>
          <label class="btn tiny soft" style="cursor:pointer; display:inline-flex; align-items:center; gap:4px; font-size:10px;">
            <i data-lucide="upload-cloud" style="width:11px;height:11px;color:var(--accent);"></i> Upload File to Drive
            <input type="file" style="display:none;" onchange="
              const file = this.files[0];
              if (file) {
                OL.uploadFileToDrive('${client.id}', file, 'Task Attachments').then(res => {
                  if (res?.webViewLink) {
                    OL.updateAndSync(() => {
                      const sheet = state.clients['${client.id}']?.projectData?.scopingSheets?.[0];
                      const item = sheet?.lineItems?.find(i => i.id === '${req.id}');
                      if (item) {
                        if (!item.driveFiles) item.driveFiles = [];
                        item.driveFiles.push({ name: file.name, url: res.webViewLink });
                      }
                    }, '${client.id}');
                    OL.openRequestDetailDrawer(state.clients['${client.id}'], OL.getScopingLineItemById('${req.id}'));
                  }
                });
              }
            ">
          </label>
        </div>

        ${attachedFiles.length ? `
          <div style="display:flex; flex-direction:column; gap:6px;">
            ${attachedFiles.map(fileObj => `
              <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(0,0,0,0.15); padding:6px 10px; border-radius:4px;">
                <span class="tiny bold" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(fileObj.name)}</span>
                <a href="${esc(fileObj.url)}" target="_blank" rel="noopener noreferrer" class="btn tiny primary" style="display:inline-flex; align-items:center; gap:4px; text-decoration:none; font-weight:bold;">
                  <i data-lucide="external-link" style="width:11px;height:11px;"></i> Open in Drive
                </a>
              </div>
            `).join('')}
          </div>
        ` : `<div class="tiny muted">No files attached to this request yet.</div>`}
      </div>

      <!-- LINKED EMAILS FOR REQUESTS -->
      <div style="margin-bottom: 20px; min-width: 0; width: 100%; overflow-x: hidden;">
        <label class="bold tiny uppercase muted" style="display:block; margin-bottom:8px;">
          <i data-lucide="mail" style="width:12px;height:12px;vertical-align:sub;"></i> Linked Emails
        </label>
        <div id="linked-request-emails-list" class="tiny muted" style="min-width:0; width:100%; box-sizing:border-box; overflow-x:hidden;">Loading linked emails…</div>
      </div>

      <!-- COMMENTS SIDEBAR / THREAD -->
      <div id="request-comments-container">
        ${OL.renderTaskCommentsSidebarHTML(client, req)}
      </div>
    </div>
  `;

  openModal(html);
  OL.loadLinkedEmailsForRequest(req.id);
  if (window.lucide) lucide.createIcons();
};

export function updateRequestDescription(clientId, reqId, newDesc) {
    const client = state.clients[clientId];
    const sheet = client?.projectData?.scopingSheets?.[0];
    const item = sheet?.lineItems?.find(i => String(i.id) === String(reqId));
    if (item) {
        OL.updateAndSync(() => {
            item.description = newDesc.trim();
        }, clientId);
    }
}

export async function loadLinkedEmailsForRequest(requestId) {
  const container = document.getElementById('linked-request-emails-list');
  if (!container) return;

  const { data, error } = await db
    .from('gmail_messages')
    .select('id, sender, subject, snippet, date, note, body')
    .eq('linked_request_id', requestId)
    .order('date', { ascending: false });

  if (error || !data || !data.length) {
    container.innerHTML = `<span class="tiny muted">No linked emails found for this request.</span>`;
    return;
  }

  container.innerHTML = `
    <div style="display:grid; gap:6px; min-width:0; width:100%; box-sizing:border-box;">
        ${data.map(m => `
            <div style="padding:8px; background:rgba(255,255,255,0.02); border:1px solid var(--line); border-radius:6px; min-width:0; width:100%; box-sizing:border-box; overflow-x:hidden;">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px; cursor:pointer;" onclick="OL.openGmailMessageModal('${m.id}')">
                    <div style="min-width:0; flex:1; overflow-wrap:anywhere; word-break:break-word;">
                        <strong style="display:block; overflow-wrap:anywhere; word-break:break-word;">${esc(m.subject || 'No Subject')}</strong>
                        <div class="muted" style="overflow-wrap:anywhere; word-break:break-word;">${esc(m.sender)}${m.date ? ` · ${new Date(m.date).toLocaleDateString()}` : ''}</div>
                    </div>
                    <i data-lucide="external-link" style="width:12px;height:12px; flex-shrink:0; margin-top:2px; color:var(--muted);"></i>
                </div>
            </div>
        `).join('')}
    </div>
  `;
  if (window.lucide) lucide.createIcons();
};

export function openRequestLineModal(itemId) {
    const client = getActiveClient();
    if (!client) return;

    const sheet = client.projectData?.scopingSheets?.[0];
    const item = itemId ? sheet?.lineItems?.find(i => String(i.id) === String(itemId)) : null;
    const isEdit = !!item;
    const clientName = client.meta?.name || 'Client';

    const isReqLine = !item || String(item.resourceId || '').startsWith('reqline-');
    const typeKey = item?.requestType || (isReqLine ? 'meeting' : 'build');
    const shownTitle = item?.name || (!isReqLine ? (OL.getResourceById(item.resourceId)?.name || '') : '');
    const status = item?.status || 'Do Now';
    const party = item?.responsibleParty || 'Sphynx';

    const opt = (value, label, current) =>
        `<option value="${esc(value)}" ${String(current) === String(value) ? 'selected' : ''}>${esc(label)}</option>`;

    const html = `
        <div class="modal-head" style="display:flex; justify-content:space-between; align-items:center; padding-bottom:12px; border-bottom:1px solid var(--line);">
            <div class="modal-title-text" style="font-weight:700; font-size:16px;">${isEdit ? '✏️ Edit Request' : '➕ Add Request'}</div>
            <button class="btn small soft" onclick="OL.closeModal()">Cancel</button>
        </div>
        <div class="modal-body" style="padding-top:14px;">
            <p class="tiny muted" style="margin-bottom:16px; font-size:11px; line-height:1.4;">
                ${isEdit && requestResourceIds(item).filter(id => !String(id).startsWith('reqline-')).length
                    ? 'A request can cover one or more resources. Its fee is the total of what it covers; set the units on each resource.'
                    : 'For work with no library resource, like a training session, an audit or a working meeting. Its fee is estimated hours x your base rate, or plan the resources it will cover once it is saved.'}
            </p>

            <div style="display:flex; flex-direction:column; gap:4px; margin-bottom:12px;">
                <label class="tiny muted" style="font-size:10px; font-weight:600;">Title</label>
                <input id="rq-title" type="text" class="modal-input" 
                       placeholder="e.g. Calendly audit" value="${esc(shownTitle)}" autofocus>
            </div>

            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px; margin-bottom:12px;">
                <div style="display:flex; flex-direction:column; gap:4px;">
                    <label class="tiny muted" style="font-size:10px; font-weight:600;">Type</label>
                    <select id="rq-type" class="modal-input">
                        ${getRequestTypes().map(t => opt(t.key, t.label, typeKey)).join('')}
                    </select>
                </div>
                <div style="display:flex; flex-direction:column; gap:4px;">
                    <label class="tiny muted" style="font-size:10px; font-weight:600;">Estimated hours</label>
                    <input id="rq-hours" type="number" min="0" step="0.25" class="modal-input"
                           value="${item ? (parseFloat(item.manualHours) || 0) : ''}" placeholder="0">
                </div>
                <div style="display:flex; flex-direction:column; gap:4px;">
                    <label class="tiny muted" style="font-size:10px; font-weight:600;">Client decision</label>
                    <select id="rq-status" class="modal-input">
                        ${['Do Now', 'Do Later'].map(s => opt(s, s, status)).join('')}
                        ${status === 'Done' || status === "Don't Do" ? opt(status, status, status) : ''}
                    </select>
                </div>
                <div style="display:flex; flex-direction:column; gap:4px;">
                    <label class="tiny muted" style="font-size:10px; font-weight:600;">Responsible party</label>
                    <select id="rq-party" class="modal-input">
                        ${opt('Sphynx', 'Sphynx', party)}
                        ${opt(clientName, clientName, party)}
                        ${opt('Joint', 'Joint', party)}
                    </select>
                </div>
                <div style="display:flex; flex-direction:column; gap:4px;">
                    <label class="tiny muted" style="font-size:10px; font-weight:600;">Round</label>
                    <input id="rq-round" type="number" min="1" step="1" class="modal-input"
                           value="${parseInt(item?.round, 10) || 1}">
                </div>
            </div>

            ${isEdit && typeof OL.requestResourcesSectionHtml === 'function' ? OL.requestResourcesSectionHtml(client, item) : ''}

            <div style="display:flex; flex-direction:column; gap:4px; margin-bottom:16px;">
                <label class="tiny muted" style="font-size:10px; font-weight:600;">Notes (optional)</label>
                <textarea id="rq-notes" class="modal-input" rows="3">${esc(item?.notes || '')}</textarea>
            </div>

            ${isEdit && typeof OL.requestTasksPanelHtml === 'function' ? `
                <div style="display:flex; flex-direction:column; gap:4px; margin-bottom:16px;">
                    <label class="tiny muted" style="font-size:10px; font-weight:600;">Tasks</label>
                    ${OL.requestTasksPanelHtml(client, item) || '<div class="tiny muted">No tasks yet.</div>'}
                </div>` : ''}

            <div style="display:flex; gap:10px;">
                <button class="btn primary" style="width:100%; justify-content:center;" onclick="OL.saveRequestLine(${itemId ? `'${itemId}'` : 'null'})">
                    ${isEdit ? 'Save' : 'Add to sheet'}
                </button>
            </div>
        </div>
    `;
    openModal(html);
}

export function applyRequestFormToItem(item) {
    if (!document.getElementById('rq-title')) return item;
    const read = (id) => document.getElementById(id)?.value ?? '';
    const title = read('rq-title').trim();
    Object.assign(item, {
        ...(title ? { name: title } : {}),
        requestType: read('rq-type') || item.requestType || 'meeting',
        notes: read('rq-notes').trim(),
        status: read('rq-status') || item.status || 'Do Now',
        responsibleParty: read('rq-party') || item.responsibleParty || 'Sphynx',
        round: Math.max(1, parseInt(read('rq-round'), 10) || 1),
        manualHours: Math.max(0, parseFloat(read('rq-hours')) || 0),
    });
    return item;
}

export async function saveRequestLine(itemId) {
    const client = getActiveClient();
    if (!client) return;

    if (!client.projectData.scopingSheets) {
        client.projectData.scopingSheets = [{ id: 'initial', lineItems: [] }];
    }
    const sheet = client.projectData.scopingSheets[0];
    if (!sheet.lineItems) sheet.lineItems = [];

    const title = (document.getElementById('rq-title')?.value ?? '').trim();
    if (!title) {
        alert('Give the request a title.');
        return;
    }

    let item = itemId ? sheet.lineItems.find(i => String(i.id) === String(itemId)) : null;
    if (!item) {
        item = {
            id: 'li-' + Date.now(),
            resourceId: 'reqline-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            teamMode: 'everyone',
            teamIds: [],
            data: {},
            dependencies: [],
        };
        sheet.lineItems.push(item);
    }

    applyRequestFormToItem(item);

    await OL.persist();
    OL.closeModal();
    renderScopingSheet();
}

export async function setSheetStatus(newStatus) {
    const client = getActiveClient();
    const sheet = client?.projectData?.scopingSheets?.[0];
    if (!client || !sheet) return;

    const previous = sheet.status || '';
    const next = newStatus || '';
    if (next === previous) return;

    await OL.updateAndSync(() => {
        const now = new Date().toISOString();
        sheet.status = next;
        sheet.statusChangedAt = now;
        if (next === 'Approved') sheet.approvedAt = now;

        if (typeof OL.runAutomationRules === 'function') {
            OL.runAutomationRules('scoping_sheet_status_change', {
                clientId: client.id,
                client,
                sheetStatus: next,
                previousSheetStatus: previous,
                resourceName: '',
                title: ''
            });
        }
    });

    renderScopingSheet();
}

// Approval, per round — see core/requests.js isRoundApproved for why this
// exists separately from setSheetStatus: a round with no explicit entry of
// its own inherits the legacy sheet-wide status, so existing approved
// sheets keep behaving the same; setting a round's status here from now on
// is what actually gates whether Sphynx work on that round is unlocked.
export async function setRoundApprovalStatus(round, newStatus) {
    const client = getActiveClient();
    const sheet = client?.projectData?.scopingSheets?.[0];
    if (!client || !sheet) return;

    const key = String(round);
    const previous = sheet.roundApprovals?.[key]?.status || sheet.status || '';
    const next = newStatus || '';
    if (next === previous) return;

    await OL.updateAndSync(() => {
        const now = new Date().toISOString();
        if (!sheet.roundApprovals) sheet.roundApprovals = {};
        sheet.roundApprovals[key] = {
            status: next,
            statusChangedAt: now,
            approvedAt: next === 'Approved' ? now : (sheet.roundApprovals[key]?.approvedAt || null),
        };

        if (typeof OL.runAutomationRules === 'function') {
            OL.runAutomationRules('scoping_round_status_change', {
                clientId: client.id,
                client,
                round: Number(round),
                roundStatus: next,
                previousRoundStatus: previous,
                resourceName: '',
                title: ''
            });
        }
    });

    renderScopingSheet();
}

function communicationAssignee(client) {
    const role = (state.master?.roles || []).find(r => /communicat/i.test(String(r?.name || '')));
    const assignment = role ? (client.projectData?.roleAssignments || []).find(a => a.roleId === role.id) : null;
    return (assignment && assignment.memberName) || 'Sphynx Task';
}

function askAssigneeOptions(client, kind) {
    if (kind === 'third_party') {
        const list = OL.thirdPartyAssignees || [];
        return list.length ? list : ['Third party'];
    }
    const team = (client.projectData?.teamMembers || []).map(m => m.name).filter(Boolean);
    return ['Client Task', ...team];
}

function askLineHtml() {
    return `
        <div class="ask-line" style="display:grid; grid-template-columns: 1fr auto 130px auto; gap:8px; align-items:center; margin-bottom:8px;">
            <input type="text" class="modal-input tiny ask-title" placeholder="What do you need? e.g. Logo file">
            <label class="tiny muted" style="display:flex; align-items:center; gap:4px; white-space:nowrap;" title="Work can't continue without this">
                <input type="checkbox" class="ask-blocker" checked> Blocker
            </label>
            <input type="date" class="modal-input tiny ask-due">
            <button type="button" class="btn tiny soft" onclick="this.closest('.ask-line').remove()">✕</button>
        </div>`;
}

export function openAskModal(itemId) {
    const client = getActiveClient();
    const sheet = client?.projectData?.scopingSheets?.[0];
    const item = sheet?.lineItems?.find(i => String(i.id) === String(itemId));
    if (!client || !item) return;

    const label = item.name || OL.getResourceById(item.resourceId)?.name || 'this item';
    const kindOptions = Object.entries(ASK_KINDS)
        .map(([key, k]) => `<option value="${key}">${esc(k.label)}</option>`).join('');
    const assigneeOptions = askAssigneeOptions(client, 'review')
        .map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');

    const html = `
        <div class="modal-head">
            <div class="modal-title-text">📨 Ask client</div>
            <div class="spacer"></div>
            <button class="btn small soft" onclick="OL.closeModal()">Cancel</button>
        </div>
        <div class="modal-body">
            <p class="tiny muted" style="margin-bottom:12px;">
                What is <b>${esc(label)}</b> waiting on? Each line becomes a task linked to this request.
                Tick <b>Blocker</b> if work can't continue without it. If every open ask is a blocker,
                the request shows as waiting and a follow-up task is created.
            </p>

            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-bottom:12px;">
                <div>
                    <label class="tiny muted">Kind of ask</label>
                    <select id="ask-kind" class="modal-input" onchange="OL.refreshAskAssignees()">${kindOptions}</select>
                </div>
                <div>
                    <label class="tiny muted">Assign to</label>
                    <select id="ask-assignee" class="modal-input">${assigneeOptions}</select>
                </div>
            </div>

            <div id="ask-lines">${askLineHtml()}${askLineHtml()}</div>
            <button type="button" class="btn tiny soft" onclick="OL.addAskLine()">+ Add another</button>

            <div style="display:flex; gap:10px; margin-top:16px;">
                <button class="btn primary flex-1" onclick="OL.saveAsks('${item.id}')">Create tasks</button>
            </div>
        </div>
    `;
    openModal(html);
}

export function addAskLine() {
    const box = document.getElementById('ask-lines');
    if (!box) return;
    const wrapper = document.createElement('div');
    wrapper.innerHTML = askLineHtml();
    box.appendChild(wrapper.firstElementChild);
}

export function refreshAskAssignees() {
    const client = getActiveClient();
    const kind = document.getElementById('ask-kind')?.value || 'review';
    const select = document.getElementById('ask-assignee');
    if (!client || !select) return;
    select.innerHTML = askAssigneeOptions(client, kind)
        .map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
}

export async function saveAsks(itemId) {
    const client = getActiveClient();
    const sheet = client?.projectData?.scopingSheets?.[0];
    const item = sheet?.lineItems?.find(i => String(i.id) === String(itemId));
    if (!client || !item) return;

    const kind = document.getElementById('ask-kind')?.value || 'review';
    const kindInfo = ASK_KINDS[kind] || ASK_KINDS.review;
    const assignee = document.getElementById('ask-assignee')?.value || (kind === 'third_party' ? 'Third party' : 'Client Task');

    const lines = Array.from(document.querySelectorAll('.ask-line')).map(row => ({
        title: (row.querySelector('.ask-title')?.value || '').trim(),
        blocker: !!row.querySelector('.ask-blocker')?.checked,
        due: row.querySelector('.ask-due')?.value || '',
    })).filter(l => l.title);

    if (!lines.length) {
        alert('Add at least one thing you need.');
        return;
    }

    const label = item.name || OL.getResourceById(item.resourceId)?.name || 'this item';
    const isThirdParty = kindInfo.owner === 'third_party';
    const now = new Date().toISOString();
    const dueDates = lines.map(l => l.due).filter(Boolean).sort();

    await OL.updateAndSync(() => {
        if (!client.projectData.clientTasks) client.projectData.clientTasks = [];

        const asks = lines.map(l => ({
            id: uid(),
            title: l.title,
            name: l.title,
            description: `For: ${label}`,
            status: kindInfo.taskStatus,
            assignee,
            dueDate: l.due,
            isClientTask: !isThirdParty,
            loggedHours: 0,
            parentTaskId: null,
            createdBy: 'request-ask',
            createdAt: now,
            requestLineItemId: item.id,
            isBlocker: l.blocker,
            askKind: kind,
        }));

        const followUpTitle = isThirdParty ? `Follow up with ${assignee}: ${label}` : `Follow up with client: ${label}`;
        const followUp = {
            id: uid(),
            title: followUpTitle,
            name: followUpTitle,
            description: `Waiting on ${lines.length} item${lines.length === 1 ? '' : 's'}: ${lines.map(l => l.title).join('; ')}`,
            status: 'Needs Follow Up',
            assignee: communicationAssignee(client),
            dueDate: dueDates[0] || '',
            isClientTask: false,
            loggedHours: 0,
            parentTaskId: null,
            createdBy: 'request-ask',
            createdAt: now,
            requestLineItemId: item.id,
            isBlocker: false,
            askKind: 'follow_up',
        };

        client.projectData.clientTasks.unshift(followUp, ...asks);
    });

    OL.closeModal();
    renderScopingSheet();
}

window.OL = window.OL || {};
Object.assign(window.OL, {
    getScopingDataForResource, isResourceInScope, getScopingWorkflowContext, renderRoundGroup, calculateBaseFeeWithMultiplier,
    openTeamAssignmentModal, setTeamMode, updateLineItem, toggleScopingUnits,
    renderUnitBadges, addResourceToScope, removeFromScope, removeFromScopeByID,
    filterResourceForScope, executeScopeAdd, cycleTeamMode, getMultiplierDisplay,
    calculateRowFee, renderGrandTotals, renderDiscountInput, openDiscountManager,
    updateDiscount, refreshDiscountManagerUI, applyDiscount, clearAllDiscounts,
    openTypeDetailModal, createNewVarForType, updateVarRate, removeScopingVariable,
    getDependencyStatus, openDependencyManager, filterDependencySearch,
    createAndLinkTaskDependency, addDependency, removeDependencyById,
    openRequestLineModal, saveRequestLine, applyRequestFormToItem, getRequestPriceBreakdown, setSheetStatus,
    setRoundApprovalStatus,
    openAskModal, addAskLine, refreshAskAssignees, saveAsks,
    getScopingLineItemById, openRequestDetailDrawer, updateRequestDescription, loadLinkedEmailsForRequest
});

window.renderScopingSheet = renderScopingSheet;
