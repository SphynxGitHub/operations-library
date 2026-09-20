import { esc, state, getBusinessScopedClients } from '../../core/data.js';

OL.financialsFilterState = OL.financialsFilterState || {
    query: '',
    statusFilter: 'all',      // 'all' | 'Do Now' | 'In Progress' | 'Done' | "Don't Do"
    partyFilter: 'all',       // 'all' | 'Sphynx' | 'Client'
    groupBy: 'none',          // 'none' | 'workspace' | 'status' | 'party'
    datePreset: 'all_time',   // 'all_time' | 'current_month' | 'last_month' | 'current_year' | 'last_year' | 'custom'
    startDate: '',
    endDate: ''
};

OL.renderBusinessFinancials = function() {
    const main = document.getElementById("mainContent");
    if (!main) return;

    const clients = getBusinessScopedClients();
    let allScopedItems = clients.flatMap(c => {
        const sheet = c.projectData?.scopingSheets?.[0];
        return (sheet?.lineItems || []).map(li => ({
            ...li,
            clientName: c.meta?.name || 'Client',
            clientId: c.id
        }));
    });

    // Apply active date filter parameters to derive grand total & list items accurately
    const { filteredItems, totalValue } = OL.getFilteredFinancialsData(allScopedItems);

    main.innerHTML = `
        <!-- HEADER TITLE ON ITS OWN LINE -->
        <div class="section-header" style="margin-bottom:12px;">
            <div>
                <h2 style="margin:0;"><i data-lucide="dollar-sign" style="width:24px;height:24px;vertical-align:sub;margin-right:8px;color:var(--accent);"></i>Agency Financials & Scoped Work</h2>
                <div class="small muted" style="margin-top:2px;">Track total gross, scoped deliverables, and approved revenue across all projects</div>
            </div>
        </div>

        <!-- TOTALS & DATE PRESETS BAR (ROW BELOW TITLE) -->
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-bottom:16px; background:var(--panel-soft); padding:10px 14px; border:1px solid var(--line); border-radius:8px;">
            
            <!-- DATE PRESETS & CUSTOM RANGE -->
            <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                <span class="tiny bold muted uppercase" style="margin-right:4px;">Period:</span>
                <button class="btn tiny ${OL.financialsFilterState.datePreset === 'all_time' ? 'primary' : 'soft'}" onclick="OL.setFinancialsDatePreset('all_time')">All Time</button>
                <button class="btn tiny ${OL.financialsFilterState.datePreset === 'current_month' ? 'primary' : 'soft'}" onclick="OL.setFinancialsDatePreset('current_month')">Current Month</button>
                <button class="btn tiny ${OL.financialsFilterState.datePreset === 'last_month' ? 'primary' : 'soft'}" onclick="OL.setFinancialsDatePreset('last_month')">Last Month</button>
                <button class="btn tiny ${OL.financialsFilterState.datePreset === 'current_year' ? 'primary' : 'soft'}" onclick="OL.setFinancialsDatePreset('current_year')">Current Year</button>
                <button class="btn tiny ${OL.financialsFilterState.datePreset === 'last_year' ? 'primary' : 'soft'}" onclick="OL.setFinancialsDatePreset('last_year')">Last Year</button>
                <button class="btn tiny ${OL.financialsFilterState.datePreset === 'custom' ? 'primary' : 'soft'}" onclick="OL.setFinancialsDatePreset('custom')">Custom</button>

                ${OL.financialsFilterState.datePreset === 'custom' ? `
                    <div style="display:inline-flex; align-items:center; gap:4px; margin-left:6px; background:var(--panel-dark, #111); padding:2px 6px; border:1px solid var(--line); border-radius:4px;">
                        <span class="tiny muted">From:</span>
                        <input type="date" class="modal-input tiny" style="width:auto; padding:1px 3px;" 
                               value="${esc(OL.financialsFilterState.startDate || '')}"
                               onchange="OL.financialsFilterState.startDate = this.value; OL.renderBusinessFinancials();">
                        <span class="tiny muted">To:</span>
                        <input type="date" class="modal-input tiny" style="width:auto; padding:1px 3px;" 
                               value="${esc(OL.financialsFilterState.endDate || '')}"
                               onchange="OL.financialsFilterState.endDate = this.value; OL.renderBusinessFinancials();">
                    </div>
                ` : ''}
            </div>

            <!-- GRAND TOTAL BAR -->
            <div class="pill accent" style="padding: 6px 12px; display: flex; gap: 12px; align-items: center; font-size: 12px; font-weight: bold; flex-shrink:0;">
                <span>Scoped Items: <span style="color:var(--text);">${filteredItems.length}</span></span>
                <span style="opacity: 0.3;">|</span>
                <span>Grand Total: <span style="color:var(--accent); font-size: 14px;">$${totalValue.toLocaleString()}</span></span>
            </div>
        </div>

        <div class="card" style="padding: 20px;">
            <!-- SEARCH, FILTER & GROUPING TOOLBAR -->
            <div style="display: flex; gap: 16px; align-items: center; justify-content: space-between; margin-bottom: 15px; padding-bottom: 15px; border-bottom: 1px solid var(--line); width: 100%; box-sizing: border-box;">
                
                <!-- Search Input - EXPANDS TO FILL AVAILABLE SPACE -->
                <div style="display: flex; gap: 8px; flex: 1; align-items: center;">
                    <i data-lucide="search" style="width:16px; height:16px; color:var(--muted); flex-shrink: 0;"></i>
                    <input type="text" 
                           class="modal-input tiny" 
                           placeholder="Search deliverables, clients, or parties..." 
                           id="financials-search"
                           style="width: 100%; box-sizing: border-box;"
                           value="${esc(OL.financialsFilterState.query || '')}"
                           oninput="OL.financialsFilterState.query = this.value; OL.renderBusinessFinancials();">
                </div>

                <!-- Party Filters -->
                <div style="display:flex; gap:4px; align-items:center; flex-shrink:0;">
                    <span class="tiny muted uppercase bold" style="margin-right:4px;">Party:</span>
                    <button class="btn tiny ${OL.financialsFilterState.partyFilter === 'all' ? 'primary' : 'soft'}" onclick="OL.setFinancialsPartyFilter('all')">All</button>
                    <button class="btn tiny ${OL.financialsFilterState.partyFilter === 'Sphynx' ? 'primary' : 'soft'}" onclick="OL.setFinancialsPartyFilter('Sphynx')">Sphynx</button>
                    <button class="btn tiny ${OL.financialsFilterState.partyFilter === 'Client' ? 'primary' : 'soft'}" onclick="OL.setFinancialsPartyFilter('Client')">Client</button>
                </div>

                <!-- Grouping Controls -->
                <div style="display:flex; gap:4px; align-items:center; flex-shrink:0;">
                    <span class="tiny muted uppercase bold" style="margin-right:4px;">Group By:</span>
                    <button class="btn tiny ${OL.financialsFilterState.groupBy === 'none' ? 'primary' : 'soft'}" onclick="OL.setFinancialsGrouping('none')">None</button>
                    <button class="btn tiny ${OL.financialsFilterState.groupBy === 'workspace' ? 'primary' : 'soft'}" onclick="OL.setFinancialsGrouping('workspace')">Workspace</button>
                    <button class="btn tiny ${OL.financialsFilterState.groupBy === 'status' ? 'primary' : 'soft'}" onclick="OL.setFinancialsGrouping('status')">Status</button>
                    <button class="btn tiny ${OL.financialsFilterState.groupBy === 'party' ? 'primary' : 'soft'}" onclick="OL.setFinancialsGrouping('party')">Party</button>
                </div>
            </div>

            <div id="financials-table-container">
                ${OL.renderFinancialsTableGroups(filteredItems)}
            </div>
        </div>
    `;
    if (window.lucide) lucide.createIcons();
};

OL.setFinancialsDatePreset = function(preset) {
    OL.financialsFilterState.datePreset = preset;
    const now = new Date();

    if (preset === 'current_month') {
        const start = new Date(now.getFullYear(), now.getMonth(), 1);
        const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        OL.financialsFilterState.startDate = start.toISOString().split('T')[0];
        OL.financialsFilterState.endDate = end.toISOString().split('T')[0];
    } else if (preset === 'last_month') {
        const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const end = new Date(now.getFullYear(), now.getMonth(), 0);
        OL.financialsFilterState.startDate = start.toISOString().split('T')[0];
        OL.financialsFilterState.endDate = end.toISOString().split('T')[0];
    } else if (preset === 'current_year') {
        const start = new Date(now.getFullYear(), 0, 1);
        const end = new Date(now.getFullYear(), 11, 31);
        OL.financialsFilterState.startDate = start.toISOString().split('T')[0];
        OL.financialsFilterState.endDate = end.toISOString().split('T')[0];
    } else if (preset === 'last_year') {
        const start = new Date(now.getFullYear() - 1, 0, 1);
        const end = new Date(now.getFullYear() - 1, 11, 31);
        OL.financialsFilterState.startDate = start.toISOString().split('T')[0];
        OL.financialsFilterState.endDate = end.toISOString().split('T')[0];
    } else if (preset === 'all_time') {
        OL.financialsFilterState.startDate = '';
        OL.financialsFilterState.endDate = '';
    }

    OL.renderBusinessFinancials();
};

OL.setFinancialsPartyFilter = function(party) {
    OL.financialsFilterState.partyFilter = party;
    OL.renderBusinessFinancials();
};

OL.setFinancialsGrouping = function(groupVal) {
    OL.financialsFilterState.groupBy = groupVal;
    OL.renderBusinessFinancials();
};

OL.getFilteredFinancialsData = function(allScopedItems) {
    const query = (OL.financialsFilterState.query || '').toLowerCase();
    const partyFilter = OL.financialsFilterState.partyFilter;
    const startDate = OL.financialsFilterState.startDate ? new Date(OL.financialsFilterState.startDate).getTime() : 0;
    const endDate = OL.financialsFilterState.endDate ? new Date(OL.financialsFilterState.endDate).getTime() + 86400000 : Infinity;

    const filteredItems = allScopedItems.filter(item => {
        const res = typeof OL.getResourceById === 'function' ? OL.getResourceById(item.resourceId) : null;
        const deliverableName = res?.name || item.name || 'Scoped Item';

        // Search match
        const matchesQuery = !query || 
            deliverableName.toLowerCase().includes(query) || 
            (item.clientName || '').toLowerCase().includes(query) ||
            (item.responsibleParty || '').toLowerCase().includes(query) ||
            (item.status || '').toLowerCase().includes(query);

        if (!matchesQuery) return false;

        // Party filter
        if (partyFilter !== 'all') {
            const party = (item.responsibleParty || 'Sphynx').toLowerCase();
            if (partyFilter === 'Sphynx' && !party.includes('sphynx')) return false;
            if (partyFilter === 'Client' && !party.includes('client')) return false;
        }

        // Date range filter
        if (OL.financialsFilterState.datePreset !== 'all_time' && (item.createdAt || item.createdDate || item.date)) {
            const itemTime = new Date(item.createdAt || item.createdDate || item.date).getTime();
            if (itemTime < startDate || itemTime > endDate) return false;
        }

        return true;
    });

    const totalValue = filteredItems.reduce((sum, item) => {
        const res = typeof OL.getResourceById === 'function' ? OL.getResourceById(item.resourceId) : null;
        return sum + (res && typeof OL.calculateRowFee === 'function' ? (OL.calculateRowFee(item, res) || 0) : 0);
    }, 0);

    return { filteredItems, totalValue };
};

OL.renderFinancialsTableGroups = function(filteredItems) {
    const groupBy = OL.financialsFilterState.groupBy;

    if (filteredItems.length === 0) {
        return `<div class="p-20 muted text-center">No scoped items found matching filter.</div>`;
    }

    const renderTableMarkup = (itemList) => `
        <div class="table-scroll-container" style="position: relative; max-height: 550px; overflow-y: auto; overflow-x: auto; border: 1px solid var(--line); border-radius: 8px;">
            <table style="width: 100%; border-collapse: separate; border-spacing: 0; text-align: left; font-size: 12px;">
                <thead>
                    <tr>
                        <th style="position: sticky; top: 0; z-index: 20; background: var(--panel-dark, #111); padding: 10px 12px; border-bottom: 2px solid var(--line); border-right: 1px solid var(--line); width: 25%;">Client</th>
                        <th style="position: sticky; top: 0; z-index: 20; background: var(--panel-dark, #111); padding: 10px 12px; border-bottom: 2px solid var(--line); border-right: 1px solid var(--line); width: 35%;">Deliverable</th>
                        <th style="position: sticky; top: 0; z-index: 20; background: var(--panel-dark, #111); padding: 10px 12px; border-bottom: 2px solid var(--line); border-right: 1px solid var(--line); width: 15%; text-align: center;">Status</th>
                        <th style="position: sticky; top: 0; z-index: 20; background: var(--panel-dark, #111); padding: 10px 12px; border-bottom: 2px solid var(--line); border-right: 1px solid var(--line); width: 15%; text-align: center;">Party</th>
                        <th style="position: sticky; top: 0; z-index: 20; background: var(--panel-dark, #111); padding: 10px 12px; border-bottom: 2px solid var(--line); width: 10%; text-align: right;">Net Value</th>
                    </tr>
                </thead>
                <tbody>
                    ${itemList.map(item => {
                        const res = typeof OL.getResourceById === 'function' ? OL.getResourceById(item.resourceId) : null;
                        const netValue = res && typeof OL.calculateRowFee === 'function' ? (OL.calculateRowFee(item, res) || 0) : 0;

                        return `
                            <tr style="border-bottom: 1px solid var(--line);">
                                <td style="padding: 10px 12px; border-bottom: 1px solid var(--line); border-right: 1px solid var(--line);"><strong>${esc(item.clientName)}</strong></td>
                                <td style="padding: 10px 12px; border-bottom: 1px solid var(--line); border-right: 1px solid var(--line);">${esc(res?.name || item.name || 'Scoped Item')}</td>
                                <td style="padding: 10px 12px; border-bottom: 1px solid var(--line); border-right: 1px solid var(--line); text-align: center;">
                                    <span class="pill tiny soft">${esc(item.status || 'Do Now')}</span>
                                </td>
                                <td style="padding: 10px 12px; border-bottom: 1px solid var(--line); border-right: 1px solid var(--line); text-align: center;">
                                    ${esc(item.responsibleParty || 'Sphynx')}                                 
                                </td>                                 
                                <td style="padding: 10px 12px; border-bottom: 1px solid var(--line); text-align: right; font-weight: bold; color: var(--accent);">$${netValue.toLocaleString()}</td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        </div>
    `;

    if (groupBy === 'none') {
        return renderTableMarkup(filteredItems);
    }

    // Handle Grouping & Calculate Per-Group Subtotals
    const groups = {};
    filteredItems.forEach(item => {
        let key = 'Other';
        if (groupBy === 'workspace') key = item.clientName || 'Other Workspace';
        if (groupBy === 'status') key = item.status || 'Unspecified Status';
        if (groupBy === 'party') key = item.responsibleParty || 'Sphynx';

        if (!groups[key]) groups[key] = [];
        groups[key].push(item);
    });

    return Object.entries(groups).map(([groupTitle, groupItems]) => {
        const groupSubtotal = groupItems.reduce((sum, item) => {
            const res = typeof OL.getResourceById === 'function' ? OL.getResourceById(item.resourceId) : null;
            return sum + (res && typeof OL.calculateRowFee === 'function' ? (OL.calculateRowFee(item, res) || 0) : 0);
        }, 0);

        return `
            <div style="margin-bottom: 24px;">
                <!-- PER-GROUP HEADER & SUBTOTAL BAR -->
                <div style="margin-bottom: 8px; padding-bottom: 6px; border-bottom: 1px solid var(--line); display:flex; justify-content:space-between; align-items:center;">
                    <div style="display:flex; align-items:center; gap:8px;">
                        <span class="tiny bold uppercase muted">${esc(groupTitle)}</span>
                        <span class="pill tiny soft">${groupItems.length} items</span>
                    </div>
                    <div class="tiny bold" style="color:var(--accent);">
                        Subtotal: $${groupSubtotal.toLocaleString()}
                    </div>
                </div>
                ${renderTableMarkup(groupItems)}
            </div>
        `;
    }).join('');
};
