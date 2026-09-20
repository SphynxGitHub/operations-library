import { esc, state, getBusinessScopedClients } from '../../core/data.js';

// Global state for filtering and grouping time report entries
OL.timeReportFilterState = OL.timeReportFilterState || {
    filter: 'all',      // 'all' | 'billable' | 'non-billable'
    groupBy: 'none',    // 'none' | 'workspace' | 'assignee' | 'date'
    query: ''
};

//============= RECONCILIATION HELPERS =============//

OL.getClientReconciliationMetrics = function(clientId) {
    const client = state.clients?.[clientId];
    if (!client) return { scopedHours: 0, scopedValue: 0, loggedHours: 0, hourlyRate: 300, remainingHours: 0, remainingValue: 0, burnRate: 0 };

    const hourlyRate = state.master?.rates?.baseHourlyRate || 300;
    const sheet = client.projectData?.scopingSheets?.[0];
    const lineItems = sheet?.lineItems || [];
    let scopedHours = 0;
    let scopedValue = 0;

    lineItems.forEach(item => {
        const res = typeof OL.getResourceById === 'function' ? OL.getResourceById(item.resourceId) : null;
        const rowVal = res && typeof OL.calculateRowFee === 'function' ? OL.calculateRowFee(item, res) : (item.total || 0);
        scopedValue += rowVal;
        const itemHours = item.hours || (rowVal ? rowVal / hourlyRate : 0);
        scopedHours += itemHours;
    });

    const tasks = client.projectData?.clientTasks || [];
    const loggedHours = tasks.reduce((sum, t) => sum + Number(t.loggedHours || t.hoursLogged || 0), 0);

    const remainingHours = scopedHours - loggedHours;
    const usedValue = loggedHours * hourlyRate;
    const remainingValue = scopedValue - usedValue;
    const burnRate = scopedHours > 0 ? Math.min(Math.round((loggedHours / scopedHours) * 100), 999) : 0;

    return { scopedHours, scopedValue, loggedHours, hourlyRate, usedValue, remainingHours, remainingValue, burnRate };
};

//============= FULL-PAGE VIEW (#/business/time-reports) =============//

OL.renderBusinessTimeReports = function() {
    const main = document.getElementById("mainContent");
    if (!main) return;

    const clients = getBusinessScopedClients();
    
    // Aggregate tasks from all clients
    let masterTasks = clients.flatMap(c => 
        (c.projectData?.clientTasks || []).map(t => ({
            ...t,
            clientName: c.meta?.name || 'Unknown Client',
            clientId: c.id,
            assignee: t.assignee || (t.isClientTask ? 'Client Task' : 'Sphynx Task'),
            loggedHours: Number(t.loggedHours || t.hoursLogged || 0)
        }))
    );

    const totalLoggedHours = masterTasks.reduce((acc, t) => acc + t.loggedHours, 0);
    const hourlyRate = state.master?.rates?.baseHourlyRate || 300;
    const totalValue = totalLoggedHours * hourlyRate;

    main.innerHTML = `
        <div class="section-header">
            <div>
                <h2><i data-lucide="bar-chart-2" style="width:24px;height:24px;vertical-align:sub;margin-right:8px;color:var(--accent);"></i>Time & Reconciliation Audit</h2>
                <div class="small muted">Itemized client time logs, scoping burn rates, and billable value tracking</div>
            </div>
            <div class="header-actions" style="display:flex; gap:10px; align-items:center;">
                <div class="pill tiny accent" style="font-weight: bold; display:flex; align-items:center; gap:6px;">
                    <i data-lucide="clock" style="width:14px;height:14px;"></i> Logged: ${totalLoggedHours.toFixed(1)}h ($${totalValue.toLocaleString()})
                </div>
                <button class="btn small soft" onclick="OL.renderBusinessTimeReports()" style="display:flex; align-items:center; gap:6px;">
                    <i data-lucide="rotate-cw" style="width:14px;height:14px;"></i> Refresh
                </button>
            </div>
        </div>

        <!-- GLOBAL RECONCILIATION CARDS -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin-bottom: 20px;">
            ${clients.map(c => {
                const m = OL.getClientReconciliationMetrics(c.id);
                return `
                    <div class="card" style="padding: 14px; cursor:pointer;" onclick="OL.openTimeReportModal('${c.id}')" title="Click for Itemized Client Audit">
                        <div style="font-weight:bold; font-size:12px; margin-bottom:4px; display:flex; justify-content:space-between;">
                            <span>📁 ${esc(c.meta?.name || c.id)}</span>
                            <span class="tiny muted">${m.burnRate}% Scoped</span>
                        </div>
                        <div style="font-size: 18px; font-weight: 900; color: ${m.remainingHours < 0 ? '#ef4444' : 'var(--accent)'};">
                            ${m.loggedHours.toFixed(1)}h <span class="tiny muted" style="font-weight:normal;">/ ${m.scopedHours.toFixed(1)}h</span>
                        </div>
                        <div class="tiny muted" style="margin-top:2px;">
                            Balance: <strong style="color:${m.remainingHours < 0 ? '#ef4444' : '#22c55e'}">$${m.remainingValue.toLocaleString()}</strong>
                        </div>
                    </div>
                `;
            }).join('')}
        </div>

        <!-- FULL TABLE BREAKDOWN -->
        <div class="card" style="padding: 20px;">
            
            <!-- SEARCH & FILTER / GROUPING TOOLBAR -->
            <div style="display: flex; gap: 12px; align-items: center; justify-content: space-between; margin-bottom: 15px; padding-bottom: 15px; border-bottom: 1px solid var(--line); flex-wrap: wrap;">
                
                <div style="display: flex; gap: 8px; flex: 1; min-width: 220px; align-items:center;">
                    <i data-lucide="search" style="width:16px;height:16px;color:var(--muted);"></i>
                    <input type="text" 
                           class="modal-input tiny" 
                           placeholder="Filter time entries or deliverables..." 
                           id="time-report-search"
                           value="${esc(OL.timeReportFilterState.query || '')}"
                           oninput="OL.timeReportFilterState.query = this.value; OL.renderBusinessTimeReports();">
                </div>

                <!-- Billable Filters -->
                <div style="display:flex; gap:4px; align-items:center;">
                    <span class="tiny muted uppercase bold" style="margin-right:4px;">Filter:</span>
                    <button class="btn tiny ${OL.timeReportFilterState.filter === 'all' ? 'primary' : 'soft'}" onclick="OL.setTimeReportFilter('all')">All</button>
                    <button class="btn tiny ${OL.timeReportFilterState.filter === 'billable' ? 'primary' : 'soft'}" onclick="OL.setTimeReportFilter('billable')">Billable</button>
                    <button class="btn tiny ${OL.timeReportFilterState.filter === 'non-billable' ? 'primary' : 'soft'}" onclick="OL.setTimeReportFilter('non-billable')">Non-Billable</button>
                </div>

                <!-- Grouping Controls -->
                <div style="display:flex; gap:4px; align-items:center;">
                    <span class="tiny muted uppercase bold" style="margin-right:4px;">Group By:</span>
                    <button class="btn tiny ${OL.timeReportFilterState.groupBy === 'none' ? 'primary' : 'soft'}" onclick="OL.setTimeReportGrouping('none')">None</button>
                    <button class="btn tiny ${OL.timeReportFilterState.groupBy === 'workspace' ? 'primary' : 'soft'}" onclick="OL.setTimeReportGrouping('workspace')">Workspace</button>
                    <button class="btn tiny ${OL.timeReportFilterState.groupBy === 'assignee' ? 'primary' : 'soft'}" onclick="OL.setTimeReportGrouping('assignee')">Assignee</button>
                </div>
            </div>

            <div id="time-report-table-container">
                ${OL.renderTimeReportTableGroups(masterTasks, hourlyRate)}
            </div>
        </div>
    `;

    requestAnimationFrame(() => {
        if (window.lucide) lucide.createIcons();
    });
};

OL.setTimeReportFilter = function(filterVal) {
    OL.timeReportFilterState.filter = filterVal;
    OL.renderBusinessTimeReports();
};

OL.setTimeReportGrouping = function(groupVal) {
    OL.timeReportFilterState.groupBy = groupVal;
    OL.renderBusinessTimeReports();
};

OL.renderTimeReportTableGroups = function(allTasks, hourlyRate) {
    const query = (OL.timeReportFilterState.query || '').toLowerCase();
    const filter = OL.timeReportFilterState.filter;
    const groupBy = OL.timeReportFilterState.groupBy;

    let filtered = allTasks.filter(t => {
        const matchesQuery = !query || 
            (t.title || t.name || '').toLowerCase().includes(query) || 
            (t.clientName || '').toLowerCase().includes(query) ||
            (t.assignee || '').toLowerCase().includes(query);

        if (!matchesQuery) return false;

        if (filter === 'billable') return t.billable !== false;
        if (filter === 'non-billable') return t.billable === false;
        return true;
    });

    if (filtered.length === 0) {
        return `<div class="p-20 muted text-center">No time entries found matching filter.</div>`;
    }

    // Single container table with sticky header pinned to table top
    const renderTableMarkup = (taskList) => `
        <div class="table-scroll-container" style="position: relative; max-height: 550px; overflow-y: auto; border: 1px solid var(--line); border-radius: 8px;">
            <table class="matrix-table" style="width: 100%; border-collapse: collapse; text-align: left; font-size: 12px;">
                <thead style="position: sticky; top: 0; z-index: 10; background: var(--panel-dark, #111); border-bottom: 2px solid var(--line);">
                    <tr>
                        <th style="padding: 10px 12px; border-right: 1px solid var(--line); width: 32%;">DELIVERABLE / TASK</th>
                        <th style="padding: 10px 12px; border-right: 1px solid var(--line); width: 22%; text-align: center;">WORKSPACE</th>
                        <th style="padding: 10px 12px; border-right: 1px solid var(--line); width: 18%; text-align: center;">ASSIGNEE</th>
                        <th style="padding: 10px 12px; border-right: 1px solid var(--line); width: 12%; text-align: center;">STATUS</th>
                        <th style="padding: 10px 12px; border-right: 1px solid var(--line); width: 8%; text-align: right;">LOGGED</th>
                        <th style="padding: 10px 12px; border-right: 1px solid var(--line); width: 8%; text-align: right;">VALUE ($)</th>
                        <th style="padding: 10px 12px; width: 4%; text-align: center;">ACTION</th>
                    </tr>
                </thead>
                <tbody>
                    ${taskList.map(t => {
                        const hours = Number(t.loggedHours || t.hoursLogged || 0);
                        const val = hours * hourlyRate;
                        const assigneeName = String(t.assignee || 'Sphynx Task').replace(/^[👤👥💻]\s*/, '');

                        return `
                            <tr style="border-bottom: 1px solid var(--line);">
                                <td style="padding: 10px 12px; border-right: 1px solid var(--line); font-weight: 600;">
                                    ${esc(t.title || t.name)}${t.timeAuditNote ? `<div class="tiny muted" style="margin-top:2px;">📝 ${esc(t.timeAuditNote)}</div>` : ''}
                                </td>
                                <td style="padding: 10px 12px; border-right: 1px solid var(--line); text-align: center;">
                                    ${OL.renderProjectPill ? OL.renderProjectPill(t.clientId, t.clientName) : esc(t.clientName)}
                                </td>
                                <!-- Removed Assignee Emoji -->
                                <td style="padding: 10px 12px; border-right: 1px solid var(--line); text-align: center;">
                                    <span class="pill tiny soft" style="font-weight: 500;">${esc(assigneeName)}</span>
                                </td>
                                <td style="padding: 10px 12px; border-right: 1px solid var(--line); text-align: center;">
                                    <span class="pill tiny accent">${esc(t.status || 'Pending')}</span>
                                </td>
                                <td style="padding: 10px 12px; border-right: 1px solid var(--line); text-align: right; font-weight: bold;">
                                    ${hours.toFixed(2)}h                                 </td>                                 <td style="padding: 10px 12px; border-right: 1px solid var(--line); text-align: right; font-weight: bold; color: var(--accent);">                                     $${val.toLocaleString()}
                                </td>
                                <!-- Clean pencil button with no 'Edit Log' text -->
                                <td style="padding: 10px 12px; text-align: center;">
                                    <button class="btn tiny soft icon-only" title="Edit Log" onclick="OL.openEditTaskTimeModal('${t.clientId}', '${t.id}')">
                                        <i data-lucide="pencil" style="width:12px; height:12px;"></i>
                                    </button>
                                </td>
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

    // Handle Grouping
    const groups = {};
    filtered.forEach(t => {
        const key = groupBy === 'workspace' ? (t.clientName || 'Other') : (t.assignee || 'Unassigned');
        if (!groups[key]) groups[key] = [];
        groups[key].push(t);
    });

    return Object.entries(groups).map(([groupTitle, groupTasks]) => `
        <div style="margin-bottom: 24px;">
            <div class="tiny bold uppercase muted" style="margin-bottom: 8px; padding-bottom: 4px; border-bottom: 1px solid var(--line); display:flex; align-items:center; gap:8px;">
                <span>${esc(groupTitle)}</span>
                <span class="pill tiny soft">${groupTasks.length} entries</span>
            </div>
            ${renderTableMarkup(groupTasks)}
        </div>
    `).join('');
};

//============= POP-UP MODAL (For Quick Audits in Task Manager) =============//

OL.renderClientReportView = function(clientId) {
    const client = state.clients?.[clientId];
    if (!client) return `<div class="muted p-20 text-center">No client selected.</div>`;

    const metrics = OL.getClientReconciliationMetrics(clientId);
    const tasks = client.projectData?.clientTasks || [];

    return `
        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 25px;">
            <div class="card" style="padding: 12px; text-align: center;">
                <div class="tiny muted uppercase bold">Paid Scoped Hours</div>
                <div style="font-size: 20px; font-weight: 900; color: #38bdf8; margin-top: 4px;">${metrics.scopedHours.toFixed(1)}h</div>
                <div class="tiny muted">$${metrics.scopedValue.toLocaleString()} Gross</div>
            </div>
            <div class="card" style="padding: 12px; text-align: center;">
                <div class="tiny muted uppercase bold">Logged Hours Used</div>
                <div style="font-size: 20px; font-weight: 900; color: var(--accent); margin-top: 4px;">${metrics.loggedHours.toFixed(1)}h</div>
                <div class="tiny muted">$${metrics.usedValue.toLocaleString()} Value</div>
            </div>
            <div class="card" style="padding: 12px; text-align: center;">
                <div class="tiny muted uppercase bold">Remaining Hours</div>
                <div style="font-size: 20px; font-weight: 900; color: ${metrics.remainingHours < 0 ? '#ef4444' : '#22c55e'}; margin-top: 4px;">${metrics.remainingHours.toFixed(1)}h</div>
                <div class="tiny muted">$${metrics.remainingValue.toLocaleString()} Balance</div>
            </div>
            <div class="card" style="padding: 12px; text-align: center;">
                <div class="tiny muted uppercase bold">Scoping Burn Rate</div>
                <div style="font-size: 20px; font-weight: 900; color: ${metrics.burnRate > 100 ? '#ef4444' : 'var(--accent)'}; margin-top: 4px;">${metrics.burnRate}%</div>
                <div class="tiny muted">${metrics.burnRate > 100 ? 'Over Scoped' : 'On Track'}</div>
            </div>
        </div>

        <h4>📋 Task Itemization & Time Audit</h4>
        <div class="table-scroll-container" style="position: relative; max-height: 400px; overflow-y: auto; border: 1px solid var(--line); border-radius: 8px; margin-top: 10px;">
            <table class="matrix-table" style="width:100%; border-collapse: collapse; font-size:12px;">
                <thead style="position: sticky; top: 0; z-index: 10; background: var(--panel-dark, #111); border-bottom: 2px solid var(--line);">
                    <tr>
                        <th style="padding:10px 12px; border-right:1px solid var(--line); text-align:left;">DELIVERABLE / TASK</th>
                        <th style="padding:10px 12px; border-right:1px solid var(--line); text-align:center;">ASSIGNEE</th>
                        <th style="padding:10px 12px; border-right:1px solid var(--line); text-align:center;">STATUS</th>
                        <th style="padding:10px 12px; border-right:1px solid var(--line); text-align:right;">LOGGED</th>
                        <th style="padding:10px 12px; border-right:1px solid var(--line); text-align:right;">VALUE ($)</th>
                        <th style="padding:10px 12px; text-align:center;">ACTION</th>
                    </tr>
                </thead>
                <tbody>
                    ${tasks.map(t => {
                        const hours = Number(t.loggedHours || t.hoursLogged || 0);
                        const val = hours * metrics.hourlyRate;
                        const assigneeName = String(t.assignee || 'Sphynx Task').replace(/^[👤👥💻]\s*/, '');
                        return `
                            <tr style="border-bottom:1px solid var(--line);">
                                <td style="padding:10px 12px; border-right:1px solid var(--line);"><strong>${esc(t.title || t.name)}</strong></td>
                                <td style="padding:10px 12px; border-right:1px solid var(--line); text-align:center;">
                                    <span class="pill tiny soft">${esc(assigneeName)}</span>
                                </td>
                                <td style="padding:10px 12px; border-right:1px solid var(--line); text-align:center;">
                                    <span class="pill tiny accent">${esc(t.status || 'Pending')}</span>
                                </td>
                                <td style="padding:10px 12px; border-right:1px solid var(--line); text-align:right; font-weight:bold;">${hours.toFixed(2)}h</td>                                 <td style="padding:10px 12px; border-right:1px solid var(--line); text-align:right; font-weight:bold; color:var(--accent);">$${val.toLocaleString()}</td>
                                <td style="padding:10px 12px; text-align:center;">
                                    <button class="btn tiny soft icon-only" title="Edit Log" onclick="OL.openEditTaskTimeModal('${clientId}', '${t.id}')">
                                        <i data-lucide="pencil" style="width:12px; height:12px;"></i>
                                    </button>
                                </td>
                            </tr>
                        `;
                    }).join('') || '<tr><td colspan="6" class="muted text-center p-20">No tasks logged for this client yet.</td></tr>'}
                </tbody>
            </table>
        </div>
    `;
};

OL.openTimeReportModal = function(selectedClientId) {
    const clients = getBusinessScopedClients();
    const targetClientId = selectedClientId || (clients[0]?.id || '');
    
    const content = `
        <div style="padding: 20px; max-width: 900px; width: 100%;" onclick="event.stopPropagation()">
            <div class="modal-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 20px; border-bottom: 1px solid var(--line); padding-bottom: 12px;">
                <h3 style="margin:0; display:flex; align-items:center; gap:8px;">
                    <i data-lucide="bar-chart-2" style="width:20px;height:20px;color:var(--accent);"></i>
                    Time Reconciliation & Client Reports
                </h3>
                <button class="btn tiny soft" onclick="OL.closeTimeReportModal()" style="font-weight:bold;">✕</button>
            </div>

            <div style="display: flex; gap: 12px; align-items: center; margin-bottom: 20px;">
                <label class="bold tiny uppercase muted">Select Client:</label>
                <select class="modal-input tiny" style="width: 250px;" onchange="OL.openTimeReportModal(this.value)">
                    ${clients.map(c => `<option value="${c.id}" ${c.id === targetClientId ? 'selected' : ''}>${esc(c.meta?.name || c.id)}</option>`).join('')}
                </select>
                <button class="btn tiny primary" onclick="OL.exportClientTimeReportCSV('${targetClientId}')" style="display:inline-flex; align-items:center; gap:4px;">
                    <i data-lucide="download" style="width:12px;height:12px;"></i> Export CSV Report
                </button>
            </div>

            <div id="reconciliation-report-content">
                ${OL.renderClientReportView(targetClientId)}
            </div>
        </div>
    `;

    if (typeof window.openModal === 'function') {
        window.openModal(content);
        
        requestAnimationFrame(() => {
            const layer = document.getElementById("modal-layer");
            const overlay = document.getElementById("modal-overlay");
            const dismissHandler = (e) => {
                if (e.target === layer || e.target === overlay) {
                    OL.closeTimeReportModal();
                }
            };
            if (layer) layer.onclick = dismissHandler;
            if (overlay) overlay.onclick = dismissHandler;
            if (window.lucide) lucide.createIcons();
        });
    }
};

OL.closeTimeReportModal = function() {
    const layer = document.getElementById("modal-layer");
    if (layer) { layer.style.display = "none"; layer.innerHTML = ""; layer.onclick = null; }
    const overlay = document.getElementById("modal-overlay");
    if (overlay) { overlay.style.display = "none"; overlay.innerHTML = ""; overlay.onclick = null; }
};
