import { esc, state, getBusinessScopedClients } from '../../core/data.js';

OL.financialsFilterState = OL.financialsFilterState || {
    query: '',
    statusFilter: 'all',      // 'all' | 'Do Now' | 'In Progress' | 'Done' | "Don't Do"
    partyFilter: 'all',       // 'all' | 'Sphynx' | 'Client'
    groupBy: 'none'           // 'none' | 'workspace' | 'status' | 'party'
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

    // Calculate Grand Total across all items
    const grandTotalNetValue = allScopedItems.reduce((sum, item) => {
        const res = typeof OL.getResourceById === 'function' ? OL.getResourceById(item.resourceId) : null;
        return sum + (res && typeof OL.calculateRowFee === 'function' ? (OL.calculateRowFee(item, res) || 0) : 0);
    }, 0);

    main.innerHTML = `
        <div class="section-header" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
            <div>
                <h2>💰 Agency Financials & Scoped Work</h2>
                <div class="small muted">Track total gross, scoped deliverables, and approved revenue across all projects</div>
            </div>
            
            <!-- GRAND TOTAL BAR -->
            <div class="pill accent" style="padding: 8px 14px; display: flex; gap: 16px; align-items: center; font-size: 13px; font-weight: bold;">
                <span>Total Items: <span style="color:var(--text);">${allScopedItems.length}</span></span>
                <span style="opacity: 0.3;">|</span>
                <span>Grand Total: <span style="color:var(--accent); font-size: 15px;">$${grandTotalNetValue.toLocaleString()}</span></span>
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
                ${OL.renderFinancialsTableGroups(allScopedItems)}
            </div>
        </div>
    `;
    if (window.lucide) lucide.createIcons();
};

OL.setFinancialsPartyFilter = function(party) {
    OL.financialsFilterState.partyFilter = party;
    OL.renderBusinessFinancials();
};

OL.setFinancialsGrouping = function(groupVal) {
    OL.financialsFilterState.groupBy = groupVal;
    OL.renderBusinessFinancials();
};

OL.renderFinancialsTableGroups = function(allScopedItems) {
    const query = (OL.financialsFilterState.query || '').toLowerCase();
    const partyFilter = OL.financialsFilterState.partyFilter;
    const groupBy = OL.financialsFilterState.groupBy;

    let filtered = allScopedItems.filter(item => {
        const res = typeof OL.getResourceById === 'function' ? OL.getResourceById(item.resourceId) : null;
        const deliverableName = res?.name || item.name || 'Scoped Item';

        const matchesQuery = !query || 
            deliverableName.toLowerCase().includes(query) || 
            (item.clientName || '').toLowerCase().includes(query) ||
            (item.responsibleParty || '').toLowerCase().includes(query) ||
            (item.status || '').toLowerCase().includes(query);

        if (!matchesQuery) return false;

        if (partyFilter !== 'all') {
            const party = (item.responsibleParty || 'Sphynx').toLowerCase();
            if (partyFilter === 'Sphynx' && !party.includes('sphynx')) return false;
            if (partyFilter === 'Client' && !party.includes('client')) return false;
        }

        return true;
    });

    if (filtered.length === 0) {
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
                                    ${esc(item.responsibleParty \vert{}\vert{} 'Sphynx')}                                 </td>                                 <td style="padding: 10px 12px; border-bottom: 1px solid var(--line); text-align: right; font-weight: bold; color: var(--accent);">$${netValue.toLocaleString()}</td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        </div>
    `;

    if (groupBy === 'none') {
        return renderTableMarkup(filtered);
    }

    // Handle Grouping & Calculate Per-Group Subtotals
    const groups = {};
    filtered.forEach(item => {
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
