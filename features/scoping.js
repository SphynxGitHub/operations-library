//======================= FEATURES / SCOPING =======================//
// Extracted from app.js "SCOPING AND PRICING SECTION" + "SCOPING-TASKS
// OVERLAP" (no clean boundary between them, so combined into one module
// same as with analysis.js earlier).
// Owns: the scoping sheet (line items, rounds, team multipliers,
// discounts), the pricing-rate "folder" modal, and scoping-item
// dependency management.

import { state, esc, getActiveClient, persist } from '../core/data.js';

export function getScopingWorkflowContext() {
    const workflowId = state.focusedWorkflowId;
    if (!workflowId) return null;

    const workflow = OL.getResourceById(workflowId);
    if (!workflow) return null;

    const stepCount = (workflow.steps || []).length;
    const assets = (workflow.steps || []).map(s => OL.getResourceById(s.resourceLinkId)).filter(Boolean);
    
    // Count types (e.g., 3 Emails, 2 Zaps)
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
    // 🚩 CLAIM THE ENGINE: Tell Sync that Scoping is the ONLY active view
    if (typeof OL.registerView === 'function') {
        OL.registerView(() => renderScopingSheet());
    }

    OL.registerView(renderScopingSheet); // Set the legacy reference too

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

    // 1. INITIALIZE DATA STRUCTURES
    if (!client.projectData) client.projectData = {};
    if (!client.projectData.localResources) client.projectData.localResources = [];
    if (!client.projectData.scopingSheets) {
        client.projectData.scopingSheets = [{ id: "initial", lineItems: [] }];
    }

    const sheet = client.projectData.scopingSheets[0];
    const baseRate = client.projectData.customBaseRate || state.master.rates.baseHourlyRate || 300;
    const showUnits = !!state.ui?.showScopingUnits;
    const wfContext = OL.getScopingWorkflowContext();
    
    // 🚀 FILTER STATE INITIALIZATION
    const q = (state.scopingSearch || "").toLowerCase();
    const typeF = state.scopingTypeFilter || "All";
    const statusF = state.scopingStatusFilter || "All";
    const partyF = state.scopingPartyFilter || "All";

    // 2. ADVANCED FILTERING LOGIC
    const filteredItems = sheet.lineItems.filter(item => {
        // 🎯 Now this will work because focusId is pulled from the URL
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


    // 3. DATA FOR DROPDOWNS (Pulled from full list so you can always see options)
    const availableTypes = [...new Set(sheet.lineItems.map(i => OL.getResourceById(i.resourceId)?.type))].filter(Boolean).sort();
    const availableParties = [...new Set(sheet.lineItems.map(i => i.responsibleParty))].filter(Boolean).sort();

    // 4. DYNAMIC ROUND GROUPING (🚀 FIXED: Now uses filteredItems)
    const roundGroups = {};
    filteredItems.forEach((item) => {
        const r = parseInt(item.round, 10) || 1;
        if (!roundGroups[r]) roundGroups[r] = [];
        roundGroups[r].push(item);
    });

    // Sort the round numbers numerically
    const sortedRoundKeys = Object.keys(roundGroups)
        .map((n) => parseInt(n, 10))
        .sort((a, b) => a - b);

    // 5. RENDER HTML
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
            
            ${(state.adminMode || window.location.search.includes('admin=')) ? `
                <button class="btn small soft" onclick="OL.universalCreate('SOP')" style="display:flex; align-items:center; gap:6px;">
                    <i data-lucide="plus" style="width:14px; height:14px;"></i> New Resource
                </button>
                <button class="btn primary" onclick="OL.addResourceToScope()" style="display:flex; align-items:center; gap:6px;">
                    <i data-lucide="library" style="width:14px; height:14px;"></i> Add From Library
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
                    roundGroups[r], // 🚀 Now contains only filtered items for this round
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

    // 💰 TRIGGER TOTALS
    // Note: Totals usually reflect the FULL project, not just filtered results. 
    // If you want totals to change with the filters, pass filteredItems here instead.
    renderGrandTotals(sheet.lineItems, baseRate);
    
    if (window.lucide) {
        window.lucide.createIcons();
    }
};

// 2. RENDER ROUND GROUPS
// CHANGE THIS:
export function renderRoundGroup(roundName, items, baseRate, showUnits, clientName, roundNum) {
    const client = getActiveClient();
    const sheet = client.projectData.scopingSheets[0];
    
    // 🚩 1. INITIALIZE ALL VARIABLES (Prevents ReferenceErrors)
    let roundGrossValue = 0;   // Sticker Price total
    let billableSubtotal = 0;  // Pre-discount billable total
    let roundDeductionAmt = 0; // The discount amount for this round
    let finalRoundNet = 0;     // The final number in the right column
    let totalRoundSavings = 0; // The "Disc" column total

    // 🔄 2. CALCULATION LOOP
    items.forEach(item => {
        const res = OL.getResourceById(item.resourceId);
        if (!res) return;

        // Calculate Gross (Always)
        const itemStickerPrice = OL.calculateBaseFeeWithMultiplier(item, res) || 0;
        roundGrossValue += itemStickerPrice;

        // Calculate Net (Only if Do Now + Billable Party)
        const status = String(item.status || "").toLowerCase().trim();
        const party = String(item.responsibleParty || "").toLowerCase().trim();
        
        if (status === 'do now' && (party === 'sphynx' || party === 'joint')) {
            billableSubtotal += (OL.calculateRowFee(item, res) || 0);
        }
    });

    // 💸 3. ROUND DISCOUNT CALCULATION
    const rKey = String(roundNum);
    if (sheet.roundDiscounts && sheet.roundDiscounts[rKey]) {
        const rDisc = sheet.roundDiscounts[rKey];
        const discVal = parseFloat(rDisc.value) || 0;
        
        roundDeductionAmt = (rDisc.type === '%') 
            ? Math.round(billableSubtotal * (discVal / 100)) 
            : discVal;
    }

    // 🏁 4. FINAL ROUND TOTALS
    finalRoundNet = billableSubtotal - roundDeductionAmt;
    totalRoundSavings = roundGrossValue - finalRoundNet;

    // 🎨 5. RENDER ROWS
    const rows = items.map((item, idx) => renderScopingRow(item, idx, showUnits)).join("");

    // 🖼️ 6. RETURN HTML
    return `
        <div class="round-section" style="margin-bottom: 25px; border: 1px solid var(--panel-border); border-radius: 8px; overflow: hidden;">
            <div class="grid-row round-header-row" style="background: rgba(56, 189, 248, 0.1); border-bottom: 1px solid var(--accent);">
                <div class="col-expand">
                    <strong style="color: var(--accent); text-transform: uppercase; font-size: 11px;">${esc(roundName)}</strong>
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

// Function to calculate the "Sticker Price" before line-item discounts
export function calculateBaseFeeWithMultiplier(item, resource) {
    if (!item) return 0;
    const vars = state.master.rates.variables || {};
    
    // Merge template data and local overrides
    let calcData = { ...(resource?.data || {}), ...(item.data || {}) };
    
    let baseAmount = 0;
    let hasTechnicalData = false;

    // Calculate via technical variables
    Object.entries(calcData).forEach(([varId, count]) => {
        const v = vars[varId];
        const numCount = parseFloat(count) || 0;
        if (v && numCount > 0 && v.applyTo === resource?.type) {
            baseAmount += numCount * (parseFloat(v.value) || 0);
            hasTechnicalData = true;
        }
    });

    // Fallback to hourly if no technical units exist
    if (!hasTechnicalData) {
        const client = getActiveClient();
        const baseRate = client?.projectData?.customBaseRate || state.master.rates.baseHourlyRate || 300;
        baseAmount = (parseFloat(item.manualHours) || 0) * baseRate;
    }

    // Apply Team Multiplier
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


// 3. RENDER SCOPING ROW / UPDATE ROW
export function renderScopingRow(item, idx, showUnits) {
    const client = getActiveClient();
    
    // 1. Resolve Resource using the robust helper
    const res = OL.getResourceById(item.resourceId);
    const isAdmin = state.adminMode === true;

    // 🛡️ SAFETY CHECK: Handle deleted/missing resources
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

    // 2. Financial Calculations
    const status = (item.status || "").toLowerCase();
    const party = (item.responsibleParty || "").toLowerCase();

    const isBillable = party === 'sphynx' || party === 'joint';
    const isCounted = status === 'do now' && isBillable;

    const gross = OL.calculateBaseFeeWithMultiplier(item, res);
    const net = isCounted ? OL.calculateRowFee(item, res) : gross; 
    const discountAmt = gross - net;

    const combinedData = { ...(res.data || {}), ...(item.data || {}) };
    const unitsHtml = showUnits ? OL.renderUnitBadges(combinedData, res) : "";

    const projectTeam = client?.projectData?.teamMembers || [];
    const mode = (item.teamMode || 'everyone').toLowerCase();

    // 3. Team UI Logic
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

    // Refresh Lucide icons after DOM insertion
    setTimeout(() => { if (window.lucide) window.lucide.createIcons(); }, 0);

    return `
        <div class="grid-row ${isTarget ? 'surgical-focus-row' : ''}" style="border-bottom: 1px solid var(--line); padding: 8px 10px;">
        <div class="col-expand">
            <div class="row-title is-clickable" style="display:flex; align-items:center; gap:6px;" onclick="OL.openResourceModal('${item.id}')">
                ${OL.getLucideSVG(OL.getRegistryIcon(res.type), 13, 'var(--accent)')}
                ${esc(res.name || "Manual Item")}
            </div>
            ${res.description ? `<div class="row-note">${esc(res.description)}</div>` : ""}
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

// Helper to quickly switch modes from the modal
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
    
    // 1. Try to find by strict ID (the li- ID)
    let item = sheet.lineItems.find(i => String(i.id) === String(itemId));

    // 2. FALLBACK: If not found, user might have passed a Resource ID
    if (!item) {
        console.warn("⚠️ li-ID not found, searching via Resource ID:", itemId);
        item = sheet.lineItems.find(i => String(i.resourceId) === String(itemId));
    }

    if (item) {
        console.log(`✅ Item Resolved. Updating ${field} to:`, value);

        if (field === 'round') {
            item.round = parseInt(value, 10) || 1;
        } else {
            item[field] = value;
        }

        // Save and Re-render
        OL.persist(); 
        window.renderScopingSheet();
    } else {
        console.error("❌ CRITICAL: Item completely missing from sheet.", itemId);
        console.log("Available Sheet Items:", sheet.lineItems);
    }
};

// 4. HANDLE UNIT BADGE SHOW/HIDE BUTTON AND TAGS
export function toggleScopingUnits() {
  if (!state.ui) state.ui = {};
  state.ui.showScopingUnits = !state.ui.showScopingUnits;

  OL.persist();
  renderScopingSheet();
};

// 74. HARDENED UNIT BADGE RENDERER
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

// 5. ADD ITEM TO SCOPING SHEET FROM MASTER LIBRARY
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
                       onfocus="OL.filterResourceForScope('')"  // 🚀 THE FIX: Opens list immediately
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

    console.log(`🗑️ Attempting to remove item at index: ${index}`);

    // 🚀 THE SHIELD: Use updateAndSync to ensure Firebase saves the deletion
    await OL.updateAndSync(() => {
        if (index > -1 && index < sheet.lineItems.length) {
            const removed = sheet.lineItems.splice(index, 1);
            console.log("✅ Successfully removed item:", removed[0]);
        } else {
            console.error("❌ Removal failed: Index out of bounds", index);
        }
    });

    // Refresh the UI
    renderScopingSheet();
};

export async function removeFromScopeByID(lineItemId) {
    if (!confirm("Remove this specific item from project scope?")) return;
    
    const client = getActiveClient();
    if (!client || !client.projectData.scopingSheets) return;

    const sheet = client.projectData.scopingSheets[0];

    // 🚀 THE FIX: Find the actual index of the item with this specific ID
    const actualIndex = sheet.lineItems.findIndex(i => String(i.id) === String(lineItemId));

    if (actualIndex > -1) {
        console.log(`🗑️ Removing specific item ID: ${lineItemId} found at database index: ${actualIndex}`);
        
        await OL.updateAndSync(() => {
            sheet.lineItems.splice(actualIndex, 1);
        });

        // 🔄 Surgical UI Update
        renderScopingSheet();
    } else {
        console.error("❌ Could not find item ID in database:", lineItemId);
        alert("Error: Item not found in database. Please refresh.");
    }
};

OL.getScopingDataForResource = function(resId) {
    const client = getActiveClient();
    if (!client?.projectData?.scopingSheets?.[0]) return null;
    const sheet = client.projectData.scopingSheets[0];
    return sheet.lineItems.find(item => String(item.resourceId) === String(resId));
};


export function filterResourceForScope(query) {
    const listEl = document.getElementById("scope-search-results");
    if (!listEl) return;

    const q = (query || "").toLowerCase().trim();
    const client = getActiveClient();
    
    // 1. Get current IDs already on the scoping sheet to hide them
    const existingIds = (client?.projectData?.scopingSheets?.[0]?.lineItems || []).map(i => i.resourceId);

    // 2. Identify and Tag Sources
    const masterSource = (state.master.resources || []).map(r => ({ ...r, origin: 'Master' }));
    const localSource = (client?.projectData?.localResources || []).map(r => ({ ...r, origin: 'Local' }));
    
    // 🚀 THE DEDUPLICATION FIX:
    // Create a list of IDs that are already "cloned" into the local project
    const localMasterRefs = localSource.map(r => r.masterRefId);
    
    // Filter the Master source so it only shows items NOT yet cloned locally
    const filteredMaster = masterSource.filter(m => !localMasterRefs.includes(m.id));

    // Combine local items with only the "un-cloned" master items
    const combined = [...localSource, ...filteredMaster];

    // 3. Filter for search term OR surgical match
    const matches = combined.filter((res) => {
        // 🚀 SURGICAL OVERRIDE: If we are coming from a badge click
        if (state.scopingFilterActive && state.scopingTargetId) {
            return String(res.id) === String(state.scopingTargetId);
        }

        // Standard behavior for normal searching
        const nameMatch = res.name.toLowerCase().includes(q);
        const alreadyInScope = existingIds.includes(res.id);
        return nameMatch && !alreadyInScope;
    });

    // 4. Split into Groups for rendering
    const masterMatches = matches.filter(m => m.origin === 'Master').sort((a,b) => a.name.localeCompare(b.name));
    const localMatches = matches.filter(m => m.origin === 'Local').sort((a,b) => a.name.localeCompare(b.name));

    let html = "";

    // 🏗️ Render Local Group (Items already in project library)
    if (localMatches.length > 0) {
        html += `<div class="search-group-header">📍 Available in Project</div>`;
        html += localMatches.map(res => renderResourceSearchResult(res, 'local')).join('');
    }

    // 🏛️ Render Master Group (Standard templates not yet used in this project)
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

    // 🚀 STEP 1: Handle Auto-Cloning to Library
    if (resId.startsWith('res-vlt-')) {
        const template = state.master.resources.find(r => r.id === resId);
        if (template) {
            // Check if we already have this specific master item in our local project
            const existingLocal = (client.projectData.localResources || [])
                .find(r => r.masterRefId === resId);

            if (existingLocal) {
                finalResourceId = existingLocal.id;
            } else {
                // DEEP CLONE: Make a permanent project-specific copy
                const newRes = JSON.parse(JSON.stringify(template));
                newRes.id = 'local-prj-' + Date.now() + Math.random().toString(36).substr(2, 5);
                newRes.masterRefId = resId; // Essential for the "Sync" logic
                
                if (!client.projectData.localResources) client.projectData.localResources = [];
                client.projectData.localResources.push(newRes);
                finalResourceId = newRes.id;
            }
        }
    }

    // 🚀 STEP 2: Add to Scoping Sheet
    const newItem = {
        id: 'li-' + Date.now(),
        resourceId: finalResourceId, 
        status: "Do Now",
        responsibleParty: "Sphynx",
        round: 1,
        teamMode: "everyone", 
        teamIds: [],
        data: {},
        manualHours: 0,
        dependencies: [],
    };

    if (!client.projectData.scopingSheets) client.projectData.scopingSheets = [{id: 'initial', lineItems: []}];
    client.projectData.scopingSheets[0].lineItems.push(newItem);

    // 🚀 STEP 3: PERSIST BOTH ARRAYS
    await OL.persist();
    
    OL.closeModal();
    renderScopingSheet(); 
};

// 6. ADD CUSTOM ITEM TO SCOPING SHEET

// 7. STATUS AND RESPONSIBLE PARTY

// 8. TEAM ASSIGNMENT FOR SCOPING ITEM
export function cycleTeamMode(itemId) {
    const client = getActiveClient();
    const item = client.projectData.scopingSheets[0].lineItems.find(i => i.id === itemId);
    if (!item) return;

    // Define the cycle: everyone -> individual -> global -> back to everyone
    const modes = ['everyone', 'individual', 'global'];
    let currentIdx = modes.indexOf(item.teamMode || 'everyone');
    item.teamMode = modes[(currentIdx + 1) % modes.length];

    OL.persist();
    renderScopingSheet();
};

// 9. MULTIPLIER DISPLAY
export function getMultiplierDisplay(item) {
  const client = getActiveClient();
  const rate = parseFloat(state.master.rates.teamMultiplier) || 1.1;
  
  // 🚀 HARDENING: Force lowercase and provide strict fallback
  const mode = (item.teamMode || "everyone").toLowerCase();

  if (mode === "global") {
    return `<span class="text-dim">1.00x</span>`;
  }

  let count = 0;
  // Check for 'individual' OR if there are specific IDs present
  if (mode === "individual" || (item.teamIds && item.teamIds.length > 0)) {
    count = (item.teamIds || []).length;
  } else {
    count = (client?.projectData?.teamMembers || []).length || 1;
  }
  
  // ✅ THE FORMULA: 1 + ((count - 1) * (rate - 1))
  // If rate is 1.1, (rate - 1) is 0.1
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

// 10. FEE CALCULATION
// Net Calculation (Line Item Level)
export function calculateRowFee(item, resource) {
    const gross = OL.calculateBaseFeeWithMultiplier(item, resource);
    return OL.applyDiscount(gross, item.discountValue, item.discountType);
};

// 11. GRAND TOTALS SUMMARY
export function renderGrandTotals(lineItems, baseRate) {
    const area = document.getElementById("grand-totals-area");
    const client = getActiveClient();
    const sheet = client?.projectData?.scopingSheets?.[0];
    const isAdmin = state.adminMode === true;

    if (!area || !client || !sheet) return;

    let totalGross = 0; // 🚀 Include EVERYTHING
    let netAfterLineItems = 0; // 💸 Only billable "Do Now"

    lineItems.forEach(item => {
        const res = OL.getResourceById(item.resourceId);
        if (!res) return;

        // 1. Calculate Gross (Total potential value regardless of status/party)
        const itemGross = OL.calculateBaseFeeWithMultiplier(item, res);
        totalGross += itemGross

        // 2. Calculate Net (Only "Do Now" and billable parties)
        const status = (item.status || "").toLowerCase();
        const party = (item.responsibleParty || "").toLowerCase();
        
        const isDoNow = status === 'do now';
        const isBillable = party === 'sphynx' || party === 'joint';

        // 2. Calculate Net (Only items we are actually charging for)
        if (isDoNow && isBillable) {
            netAfterLineItems += OL.calculateRowFee(item, res);
        }
    });

    // 3. Subtract Adjustments/Discounts from the Net
   let netAfterRounds = netAfterLineItems;
    if (sheet.roundDiscounts) {
        Object.keys(sheet.roundDiscounts).forEach(rNum => {
            const rDisc = sheet.roundDiscounts[rNum];
            // Filter only "Do Now" items in this round to calculate the discount basis
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

    // The "Adjustments" display shows the gap between Gross and Final Net
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

// 12. DISCOUNT MANAGEMENT
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

  // Build rounds with billable items only
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
    const rKey = String(id); // Force string key
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

  // Refresh both contexts safely
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

  // "$"
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
        applyTo: typeKey, // Match exactly what the folder is using
        archetype: "Base",
    };

    OL.persist();
    
    // 1. Refresh the Modal to show the new row
    OL.openTypeDetailModal(typeKey); 
    
    // 2. 🚀 Refresh the Background Page to update the "X variables defined" count on the card
    renderVaultRatesPage(); 
};

export async function updateVarRate(key, field, val) {
    if (!state.master.rates.variables[key]) return;
 
    state.master.rates.variables[key][field] = field === 'value' ? parseFloat(val) || 0 : val.trim();
 
    // Supabase has no dot-notation partial update — write back the whole rates object,
    // same pattern OL.persist() already uses for master data.
    const { error } = await window.db
        .from('workspace_masters')
        .update({ rates: state.master.rates })
        .eq('id', 'main_state');
 
    if (error) {
        console.error('❌ Rate save failed:', error.message);
        return;
    }
    console.log('✅ Variable saved:', key, field, val);
};

export function removeScopingVariable(varKey, typeKey) {
    if (!confirm("Are you sure you want to delete this pricing variable? This will remove it from all resources using this type.")) return;

    if (state.master.rates.variables && state.master.rates.variables[varKey]) {
        // 1. Delete from data
        delete state.master.rates.variables[varKey];
        
        OL.persist();

        // 2. Refresh the background grid (the folder cards)
        if (window.location.hash.includes('vault/rates')) {
            renderVaultRatesPage();
        }

        // 3. Refresh the modal to show the updated list
        OL.openTypeDetailModal(typeKey);
        
        console.log(`🗑️ Variable ${varKey} removed.`);
    }
};

//======================= SCOPING-TASKS OVERLAP ========================//

export function renderDependencyRow(dep, parentId) {
    const client = getActiveClient();
    const isTask = dep.type === 'task';
    
    // 🎯 Resolve the object
    let obj = isTask 
        ? (client?.projectData?.clientTasks || []).find(t => t.id === dep.id)
        : OL.getResourceById(dep.id);

    const icon = isTask ? OL.getLucideSVG('clipboard-list', 14, 'currentColor') : OL.getLucideSVG(OL.getRegistryIcon(obj?.type), 14, 'currentColor');
    
    // 🎯 Navigation Logic
    const clickAction = isTask 
        ? `OL.openTaskModal('${dep.id}', false)` 
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
        // --- TASK MODE ---
        matches = (client?.projectData?.clientTasks || []).filter(t => 
            !existingIds.includes(t.id) && t.name.toLowerCase().includes(q)
        );
        html = matches.map(t => `
            <div class="search-result-item" onmousedown="OL.addDependency('${currentResId}', '${t.id}', 'task')">
                <span>📋 ${esc(t.name)}</span>
            </div>
        `).join('');

        // Quick Create Task only
        if (q.length > 0 && !matches.some(m => m.name.toLowerCase() === q)) {
            html += `<div class="search-result-item create-action" onmousedown="OL.createAndLinkTaskDependency('${currentResId}', '${esc(query)}')">
                <span class="pill tiny accent">+ CREATE TASK</span> "${esc(query)}"
            </div>`;
        }
    } else {
        // --- RESOURCE MODE ---
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

    const taskId = 'tk-' + Date.now(); // Use your task prefix
    const newTask = {
        id: taskId,
        name: taskName,
        status: "Pending", // 🎯 Critical for showing up in "Active" lists
        description: "",
        appIds: [],
        howToIds: [],
        assigneeIds: [],
        createdDate: new Date().toISOString()
    };

    await OL.updateAndSync(() => {
        // 🎯 SAVE TO THE CORRECT ARRAY
        if (!client.projectData.clientTasks) client.projectData.clientTasks = [];
        client.projectData.clientTasks.push(newTask);

        // Link to the current resource
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

    // 🚀 AUTO-OPEN: Open the task immediately for editing
    OL.openTaskModal(taskId, false); 
    
    // Refresh background if needed
    if (typeof renderChecklistModule === 'function') renderChecklistModule();
};

export async function addDependency(resId, depId, type) {
    const res = OL.getResourceById(resId);
    if (!res) return;

    if (!res.dependencies) res.dependencies = [];
    
    // Check for circular dependency (simple 1-level check)
    const depTarget = OL.getResourceById(depId);
    if (depTarget?.dependencies?.some(d => d.id === resId)) {
        alert("🚫 Circular Dependency detected! This item already depends on the current one.");
        return;
    }

    res.dependencies.push({
        id: depId,
        type: type, // 'resource' or 'step'
        addedDate: new Date().toISOString()
    });

    await OL.persist();
    OL.openResourceModal(resId); // Refresh modal
};

export async function removeDependencyById(resId, depId) {
    const res = OL.getResourceById(resId);
    if (res && res.dependencies) {
        res.dependencies = res.dependencies.filter(d => d.id !== depId);
        await OL.persist();
        OL.openResourceModal(resId);
    }
};


// ---- bridge: keep OL.*/window.* calls working until callers import directly ----
window.OL = window.OL || {};
Object.assign(window.OL, {
    getScopingWorkflowContext, renderRoundGroup, calculateBaseFeeWithMultiplier,
    openTeamAssignmentModal, setTeamMode, updateLineItem, toggleScopingUnits,
    renderUnitBadges, addResourceToScope, removeFromScope, removeFromScopeByID,
    filterResourceForScope, executeScopeAdd, cycleTeamMode, getMultiplierDisplay,
    calculateRowFee, renderGrandTotals, renderDiscountInput, openDiscountManager,
    updateDiscount, refreshDiscountManagerUI, applyDiscount, clearAllDiscounts,
    openTypeDetailModal, createNewVarForType, updateVarRate, removeScopingVariable,
    getDependencyStatus, openDependencyManager, filterDependencySearch,
    createAndLinkTaskDependency, addDependency, removeDependencyById
});
// Called bare from sections still living in app.js — bridge onto window.
window.renderScopingSheet = renderScopingSheet;
