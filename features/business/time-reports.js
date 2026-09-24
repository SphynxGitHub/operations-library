import { esc, state, getBusinessScopedClients } from '../../core/data.js';

// Global state for filtering and grouping time report entries
OL.timeReportFilterState = OL.timeReportFilterState || {
    filter: 'all',          // 'all' | 'billable' | 'non-billable'
    groupBy: 'none',        // 'none' | 'workspace' | 'assignee'
    datePreset: 'all_time', // 'all_time' | 'current_month' | 'last_month' | 'current_year' | 'last_year' | 'custom'
    startDate: '',
    endDate: '',
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

    const hourlyRate = state.master?.rates?.baseHourlyRate || 300;
    const { filteredTasks, totalLoggedHours, totalValue } = OL.getFilteredTimeReportData(masterTasks, hourlyRate);

    main.innerHTML = `
        <!-- HEADER TITLE ON ITS OWN LINE -->
        <div class="section-header" style="margin-bottom:12px;">
            <div>
                <h2 style="margin:0;"><i data-lucide="bar-chart-2" style="width:24px;height:24px;vertical-align:sub;margin-right:8px;color:var(--accent);"></i>Time & Reconciliation Audit</h2>
                <div class="small muted" style="margin-top:2px;">Itemized client time logs, scoping burn rates, and billable value tracking</div>
            </div>
            <button class="btn small soft" onclick="OL.openBillableRulesModal()" style="display:inline-flex; align-items:center; gap:6px;" title="Tasks are non-billable unless a rule or a manual toggle says otherwise">
                <i data-lucide="badge-dollar-sign" style="width:14px;height:14px;"></i> Billable Rules (Automations)
            </button>
        </div>

        <!-- TOTALS & DATE PRESETS BAR (ROW BELOW TITLE) -->
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-bottom:16px; background:var(--panel-soft); padding:10px 14px; border:1px solid var(--line); border-radius:8px;">
            
            <!-- DATE PRESETS & CUSTOM RANGE -->
            <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                <span class="tiny bold muted uppercase" style="margin-right:4px;">Period:</span>
                <button class="btn tiny ${OL.timeReportFilterState.datePreset === 'all_time' ? 'primary' : 'soft'}" onclick="OL.setTimeReportDatePreset('all_time')">All Time</button>
                <button class="btn tiny ${OL.timeReportFilterState.datePreset === 'current_month' ? 'primary' : 'soft'}" onclick="OL.setTimeReportDatePreset('current_month')">Current Month</button>
                <button class="btn tiny ${OL.timeReportFilterState.datePreset === 'last_month' ? 'primary' : 'soft'}" onclick="OL.setTimeReportDatePreset('last_month')">Last Month</button>
                <button class="btn tiny ${OL.timeReportFilterState.datePreset === 'current_year' ? 'primary' : 'soft'}" onclick="OL.setTimeReportDatePreset('current_year')">Current Year</button>
                <button class="btn tiny ${OL.timeReportFilterState.datePreset === 'last_year' ? 'primary' : 'soft'}" onclick="OL.setTimeReportDatePreset('last_year')">Last Year</button>
                <button class="btn tiny ${OL.timeReportFilterState.datePreset === 'custom' ? 'primary' : 'soft'}" onclick="OL.setTimeReportDatePreset('custom')">Custom</button>

                ${OL.timeReportFilterState.datePreset === 'custom' ? `
                    <div style="display:inline-flex; align-items:center; gap:4px; margin-left:6px; background:var(--panel-dark, #111); padding:2px 6px; border:1px solid var(--line); border-radius:4px;">
                        <span class="tiny muted">From:</span>
                        <input type="date" class="modal-input tiny" style="width:auto; padding:1px 3px;" 
                               value="${esc(OL.timeReportFilterState.startDate || '')}"
                               onchange="OL.timeReportFilterState.startDate = this.value; OL.renderBusinessTimeReports();">
                        <span class="tiny muted">To:</span>
                        <input type="date" class="modal-input tiny" style="width:auto; padding:1px 3px;" 
                               value="${esc(OL.timeReportFilterState.endDate || '')}"
                               onchange="OL.timeReportFilterState.endDate = this.value; OL.renderBusinessTimeReports();">
                    </div>
                ` : ''}
            </div>

            <!-- GRAND TOTAL BAR -->
            <div class="pill accent" style="padding: 6px 12px; display: flex; gap: 12px; align-items: center; font-size: 12px; font-weight: bold; flex-shrink:0;">
                <i data-lucide="clock" style="width:14px;height:14px;"></i>
                <span>Logged: <span style="color:var(--text);">${totalLoggedHours.toFixed(1)}h</span></span>
                <span style="opacity: 0.3;">|</span>
                <span>Grand Value: <span style="color:var(--accent); font-size: 14px;">$${totalValue.toLocaleString()}</span></span>
            </div>
        </div>

        <!-- FULL TABLE BREAKDOWN -->
        <div class="card" style="padding: 20px;">
            
            <!-- SEARCH, FILTER & GROUPING TOOLBAR -->
            <div style="display: flex; gap: 16px; align-items: center; justify-content: space-between; margin-bottom: 15px; padding-bottom: 15px; border-bottom: 1px solid var(--line); width: 100%; box-sizing: border-box;">
                
                <!-- Search Input - EXPANDS TO FILL AVAILABLE SPACE -->
                <div style="display: flex; gap: 8px; flex: 1; align-items: center;">
                    <i data-lucide="search" style="width:16px; height:16px; color:var(--muted); flex-shrink: 0;"></i>
                    <input type="text" 
                           class="modal-input tiny" 
                           placeholder="Filter time entries or deliverables..." 
                           id="time-report-search"
                           style="width: 100%; box-sizing: border-box;"
                           value="${esc(OL.timeReportFilterState.query || '')}"
                           oninput="OL.timeReportFilterState.query = this.value; OL.renderBusinessTimeReports();">
                </div>

                <!-- Billable Filters -->
                <div style="display:flex; gap:4px; align-items:center; flex-shrink:0;">
                    <span class="tiny muted uppercase bold" style="margin-right:4px;">Filter:</span>
                    <button class="btn tiny ${OL.timeReportFilterState.filter === 'all' ? 'primary' : 'soft'}" onclick="OL.setTimeReportFilter('all')">All</button>
                    <button class="btn tiny ${OL.timeReportFilterState.filter === 'billable' ? 'primary' : 'soft'}" onclick="OL.setTimeReportFilter('billable')">Billable</button>
                    <button class="btn tiny ${OL.timeReportFilterState.filter === 'non-billable' ? 'primary' : 'soft'}" onclick="OL.setTimeReportFilter('non-billable')">Non-Billable</button>
                </div>

                <!-- Grouping Controls -->
                <div style="display:flex; gap:4px; align-items:center; flex-shrink:0;">
                    <span class="tiny muted uppercase bold" style="margin-right:4px;">Group By:</span>
                    <button class="btn tiny ${OL.timeReportFilterState.groupBy === 'none' ? 'primary' : 'soft'}" onclick="OL.setTimeReportGrouping('none')">None</button>
                    <button class="btn tiny ${OL.timeReportFilterState.groupBy === 'workspace' ? 'primary' : 'soft'}" onclick="OL.setTimeReportGrouping('workspace')">Workspace</button>
                    <button class="btn tiny ${OL.timeReportFilterState.groupBy === 'assignee' ? 'primary' : 'soft'}" onclick="OL.setTimeReportGrouping('assignee')">Assignee</button>
                </div>
            </div>

            <div id="time-report-table-container">
                ${OL.renderTimeReportTableGroups(filteredTasks, hourlyRate)}
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
    `;

    requestAnimationFrame(() => {
        if (window.lucide) lucide.createIcons();
    });
};

OL.setTimeReportDatePreset = function(preset) {
    OL.timeReportFilterState.datePreset = preset;
    const now = new Date();

    if (preset === 'current_month') {
        const start = new Date(now.getFullYear(), now.getMonth(), 1);
        const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        OL.timeReportFilterState.startDate = start.toISOString().split('T')[0];
        OL.timeReportFilterState.endDate = end.toISOString().split('T')[0];
    } else if (preset === 'last_month') {
        const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const end = new Date(now.getFullYear(), now.getMonth(), 0);
        OL.timeReportFilterState.startDate = start.toISOString().split('T')[0];
        OL.timeReportFilterState.endDate = end.toISOString().split('T')[0];
    } else if (preset === 'current_year') {
        const start = new Date(now.getFullYear(), 0, 1);
        const end = new Date(now.getFullYear(), 11, 31);
        OL.timeReportFilterState.startDate = start.toISOString().split('T')[0];
        OL.timeReportFilterState.endDate = end.toISOString().split('T')[0];
    } else if (preset === 'last_year') {
        const start = new Date(now.getFullYear() - 1, 0, 1);
        const end = new Date(now.getFullYear() - 1, 11, 31);
        OL.timeReportFilterState.startDate = start.toISOString().split('T')[0];
        OL.timeReportFilterState.endDate = end.toISOString().split('T')[0];
    } else if (preset === 'all_time') {
        OL.timeReportFilterState.startDate = '';
        OL.timeReportFilterState.endDate = '';
    }

    OL.renderBusinessTimeReports();
};

OL.setTimeReportFilter = function(filterVal) {
    OL.timeReportFilterState.filter = filterVal;
    OL.renderBusinessTimeReports();
};

OL.setTimeReportGrouping = function(groupVal) {
    OL.timeReportFilterState.groupBy = groupVal;
    OL.renderBusinessTimeReports();
};

OL.getFilteredTimeReportData = function(masterTasks, hourlyRate) {
    const query = (OL.timeReportFilterState.query || '').toLowerCase();
    const filter = OL.timeReportFilterState.filter;
    const startDate = OL.timeReportFilterState.startDate ? new Date(OL.timeReportFilterState.startDate).getTime() : 0;
    const endDate = OL.timeReportFilterState.endDate ? new Date(OL.timeReportFilterState.endDate).getTime() + 86400000 : Infinity;

    const filteredTasks = masterTasks.filter(t => {
        const matchesQuery = !query || 
            (t.title || t.name || '').toLowerCase().includes(query) || 
            (t.clientName || '').toLowerCase().includes(query) ||
            (t.assignee || '').toLowerCase().includes(query);

        if (!matchesQuery) return false;

        // Billable filter
        const isBill = OL.isItemBillable(t);
        if (filter === 'billable' && !isBill) return false;
        if (filter === 'non-billable' && isBill) return false;

        // Date range filter
        if (OL.timeReportFilterState.datePreset !== 'all_time' && (t.createdAt || t.createdDate || t.date || t.completedDate)) {
            const itemTime = new Date(t.createdAt || t.createdDate || t.date || t.completedDate).getTime();
            if (itemTime < startDate || itemTime > endDate) return false;
        }

        return true;
    });

    const totalLoggedHours = filteredTasks.reduce((acc, t) => acc + t.loggedHours, 0);
    // Value counts billable time only (tasks are non-billable by default).
    const totalValue = filteredTasks.filter(t => OL.isItemBillable(t)).reduce((acc, t) => acc + t.loggedHours, 0) * hourlyRate;

    return { filteredTasks, totalLoggedHours, totalValue };
};

OL.renderTimeReportTableGroups = function(filteredTasks, hourlyRate) {
    const groupBy = OL.timeReportFilterState.groupBy;

    if (filteredTasks.length === 0) {
        return `<div class="p-20 muted text-center">No time entries found matching filter.</div>`;
    }

    const renderTableMarkup = (taskList) => `
        <div class="table-scroll-container" style="position: relative; max-height: 550px; overflow-y: auto; overflow-x: auto; border: 1px solid var(--line); border-radius: 8px;">
            <table style="width: 100%; border-collapse: separate; border-spacing: 0; text-align: left; font-size: 12px;">
                <thead>
                    <tr>
                        <th style="position: sticky; top: 0; z-index: 20; background: var(--panel-dark, #111); padding: 10px 12px; border-bottom: 2px solid var(--line); border-right: 1px solid var(--line); width: 32%;">DELIVERABLE / TASK</th>
                        <th style="position: sticky; top: 0; z-index: 20; background: var(--panel-dark, #111); padding: 10px 12px; border-bottom: 2px solid var(--line); border-right: 1px solid var(--line); width: 22%; text-align: center;">WORKSPACE</th>
                        <th style="position: sticky; top: 0; z-index: 20; background: var(--panel-dark, #111); padding: 10px 12px; border-bottom: 2px solid var(--line); border-right: 1px solid var(--line); width: 18%; text-align: center;">ASSIGNEE</th>
                        <th style="position: sticky; top: 0; z-index: 20; background: var(--panel-dark, #111); padding: 10px 12px; border-bottom: 2px solid var(--line); border-right: 1px solid var(--line); width: 12%; text-align: center;">STATUS</th>
                        <th style="position: sticky; top: 0; z-index: 20; background: var(--panel-dark, #111); padding: 10px 12px; border-bottom: 2px solid var(--line); border-right: 1px solid var(--line); width: 8%; text-align: right;">LOGGED</th>
                        <th style="position: sticky; top: 0; z-index: 20; background: var(--panel-dark, #111); padding: 10px 12px; border-bottom: 2px solid var(--line); border-right: 1px solid var(--line); width: 8%; text-align: right;">VALUE ($)</th>
                        <th style="position: sticky; top: 0; z-index: 20; background: var(--panel-dark, #111); padding: 10px 12px; border-bottom: 2px solid var(--line); width: 4%; text-align: center;">ACTION</th>
                    </tr>
                </thead>
                <tbody>
                    ${taskList.map(t => {
                        const hours = Number(t.loggedHours || t.hoursLogged || 0);
                        const val = hours * hourlyRate;
                        const assigneeName = String(t.assignee || 'Sphynx Task').replace(/^[👤👥💻]\s*/, '');

                        return `
                            <tr style="border-bottom: 1px solid var(--line);">
                                <td style="padding: 10px 12px; border-bottom: 1px solid var(--line); border-right: 1px solid var(--line); font-weight: 600;">
                                    ${esc(t.title || t.name)}${t.timeAuditNote ? `<div class="tiny muted" style="margin-top:2px;">📝 ${esc(t.timeAuditNote)}</div>` : ''}
                                </td>
                                <td style="padding: 10px 12px; border-bottom: 1px solid var(--line); border-right: 1px solid var(--line); text-align: center;">
                                    ${OL.renderProjectPill ? OL.renderProjectPill(t.clientId, t.clientName) : esc(t.clientName)}
                                </td>
                                <td style="padding: 10px 12px; border-bottom: 1px solid var(--line); border-right: 1px solid var(--line); text-align: center;">
                                    <span class="pill tiny soft" style="font-weight: 500;">${esc(assigneeName)}</span>
                                </td>
                                <td style="padding: 10px 12px; border-bottom: 1px solid var(--line); border-right: 1px solid var(--line); text-align: center;">
                                    <span class="pill tiny accent">${esc(t.status || 'Pending')}</span>
                                </td>
                                <td style="padding: 10px 12px; border-bottom: 1px solid var(--line); border-right: 1px solid var(--line); text-align: right; font-weight: bold;">
                                    ${hours.toFixed(2)}h                                 </td>                                 <td style="padding: 10px 12px; border-bottom: 1px solid var(--line); border-right: 1px solid var(--line); text-align: right; font-weight: bold; color: var(--accent);">                                     $${val.toLocaleString()}
                                </td>
                                <td style="padding: 10px 12px; border-bottom: 1px solid var(--line); text-align: center;">
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
        return renderTableMarkup(filteredTasks);
    }

    // Handle Grouping & Calculate Per-Group Subtotals
    const groups = {};
    filteredTasks.forEach(t => {
        const key = groupBy === 'workspace' ? (t.clientName || 'Other') : (t.assignee || 'Unassigned');
        if (!groups[key]) groups[key] = [];
        groups[key].push(t);
    });

    return Object.entries(groups).map(([groupTitle, groupTasks]) => {
        const groupHours = groupTasks.reduce((acc, t) => acc + t.loggedHours, 0);
        const groupSubtotal = groupHours * hourlyRate;

        return `
            <div style="margin-bottom: 24px;">
                <!-- PER-GROUP HEADER & SUBTOTAL BAR -->
                <div style="margin-bottom: 8px; padding-bottom: 6px; border-bottom: 1px solid var(--line); display:flex; justify-content:space-between; align-items:center;">
                    <div style="display:flex; align-items:center; gap:8px;">
                        <span class="tiny bold uppercase muted">${esc(groupTitle)}</span>
                        <span class="pill tiny soft">${groupTasks.length} entries</span>
                    </div>
                    <div class="tiny bold" style="color:var(--accent); display:flex; gap:12px;">
                        <span>Hours: ${groupHours.toFixed(1)}h</span>
                        <span>Value: $${groupSubtotal.toLocaleString()}</span>
                    </div>
                </div>
                ${renderTableMarkup(groupTasks)}
            </div>
        `;
    }).join('');
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


// -------------------------------------------------------------
// BILLABLE RULES — tasks are non-billable unless a rule here (or a manual
// $ toggle on the task) makes them billable. Client tasks never are.
// Stored on the master row (workspace_masters.billable_rules).
// -------------------------------------------------------------
// The editor now lives on the Automations page (Billable Rules tab). This
// keeps the Time Reports button working: it just goes there.
OL.openBillableRulesModal = function() {
    OL.automationTab = 'billable';
    if (!location.hash.includes('/automations')) location.hash = '#/vault/automations';
    else OL.renderAutomationBuilder();
};

// Inline panel used by the Automations page.
// Each rule: applies to tasks / events / both, one or more conditions that
// must ALL match, and the result (billable / non-billable). First match wins.
// Value boxes are dropdowns that depend on the chosen field, with "Custom…"
// for typing any value.
const lower = (v) => String(v ?? '').trim().toLowerCase();
OL._billableCustomOpen = OL._billableCustomOpen || {};   // "i-j" -> true while a Custom… box is open

OL._billableRuleAt = function(i) {
    const list = state.master.billableRules || [];
    // Old one-condition rules are upgraded in place the first time they're edited.
    if (list[i] && !Array.isArray(list[i].conditions)) list[i] = OL.normalizeBillableRule(list[i]);
    return list[i];
};

OL._renderBillableValueControl = function(i, j, c) {
    const opts = OL.billableFieldOptions ? OL.billableFieldOptions(c.field) : null;
    const key = `${i}-${j}`;
    const textBox = (val, handler, ph = 'value') =>
        `<input class="modal-input tiny" style="flex:1; min-width:140px;" value="${esc(val || '')}" placeholder="${ph}"
            onblur="${handler}" onkeydown="if(event.key==='Enter'){this.blur();}">`;

    // "contains" and fields with no known values: free text.
    if (c.op === 'contains' || !opts) {
        if (c.op === 'in') {
            return OL._renderBillableChips(i, j, c, null) + textBox('', `OL.addBillableCondValue(${i}, ${j}, this.value); this.value='';`, 'type a value, then Enter');
        }
        return textBox(c.value, `OL.setBillableCond(${i}, ${j}, 'value', this.value)`);
    }

    const labelFor = (v) => (opts.find((o) => o.value === v)?.label ?? v);

    if (c.op === 'in') {
        const chosen = c.values || [];
        const remaining = opts.filter((o) => !chosen.includes(o.value));
        return `
            ${OL._renderBillableChips(i, j, c, labelFor)}
            <select class="modal-input tiny" style="width:auto;" onchange="OL.onBillableMultiSelect(${i}, ${j}, this.value)">
                <option value="">+ Add value…</option>
                ${remaining.map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('')}
                <option value="__custom__">Custom…</option>
            </select>
            ${OL._billableCustomOpen[key] ? textBox('', `OL.addBillableCondValue(${i}, ${j}, this.value); OL._billableCustomOpen['${key}'] = false; OL._saveBillableRules(false);`, 'custom value, then Enter') : ''}`;
    }

    const isCustom = OL._billableCustomOpen[key] || (!!c.value && !opts.some((o) => lower(o.value) === lower(c.value)));
    return `
        <select class="modal-input tiny" style="width:auto; max-width:240px;" onchange="OL.onBillableValueSelect(${i}, ${j}, this.value)">
            <option value="" ${!c.value && !isCustom ? 'selected' : ''}>Select…</option>
            ${opts.map((o) => `<option value="${esc(o.value)}" ${!isCustom && lower(o.value) === lower(c.value) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
            <option value="__custom__" ${isCustom ? 'selected' : ''}>Custom…</option>
        </select>
        ${isCustom ? textBox(c.value, `OL.setBillableCond(${i}, ${j}, 'value', this.value)`, 'custom value') : ''}`;
};
OL._renderBillableChips = function(i, j, c, labelFor) {
    return (c.values || []).map((v, k) => `
        <span class="pill tiny" style="display:inline-flex; align-items:center; gap:4px; padding:2px 8px; border:1px solid var(--line); border-radius:10px;">
            ${esc(labelFor ? labelFor(v) : v)}
            <span style="cursor:pointer; color:var(--muted);" title="Remove" onclick="OL.removeBillableCondValue(${i}, ${j}, ${k})">✕</span>
        </span>`).join('');
};

OL.renderBillableRulesPanel = function() {
    if (!state.master.billableRules) state.master.billableRules = [];
    const rules = state.master.billableRules.map((r) => OL.normalizeBillableRule(r));
    const defs = OL.BILLABLE_FIELD_DEFS || {};
    const ops = OL.BILLABLE_RULE_OPS || {};
    const canSave = !!state.masterHasBillableRules;
    const appliesLabel = { tasks: 'Tasks', events: 'Calendar events', both: 'Tasks & events' };

    return `
        <div class="card" style="padding:16px; margin-top:16px;">
            <div class="small" style="line-height:1.6; margin-bottom:12px;">
                How billable status is decided, in order:
                <ol style="margin:6px 0 0 18px; padding:0;">
                    <li><strong>Client tasks are never billable</strong> (assigned to "Client Task" or one of the client's people).</li>
                    <li>A manual <strong>$</strong> toggle on a task or event wins over everything below.</li>
                    <li>The first rule below that applies and whose conditions <strong>all</strong> match.</li>
                    <li>Everything else is non-billable.</li>
                </ol>
                <div class="tiny muted" style="margin-top:6px;">For tasks, <em>Meeting category</em> is the category of the meeting the task came from.</div>
            </div>
            ${canSave ? '' : `<div class="tiny" style="padding:8px 10px; margin-bottom:12px; border:1px solid #f59e0b; color:#f59e0b; border-radius:6px;">Run the <code>billable_rules</code> migration first — rules can't be saved until that column exists.</div>`}
            <div style="display:grid; gap:8px; margin-bottom:12px;">
                ${rules.length ? rules.map((r, i) => {
                    const allowed = OL.billableFieldsForAppliesTo(r.appliesTo);
                    return `
                    <div style="padding:10px; border:1px solid var(--line); border-radius:6px; display:grid; gap:6px;">
                        <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                            <span class="tiny muted" style="width:18px;">${i + 1}.</span>
                            <span class="tiny muted">For</span>
                            <select class="modal-input tiny" style="width:auto;" onchange="OL.setBillableRuleProp(${i}, 'appliesTo', this.value)">
                                ${Object.entries(appliesLabel).map(([k, l]) => `<option value="${k}" ${r.appliesTo === k ? 'selected' : ''}>${l}</option>`).join('')}
                            </select>
                            <span class="tiny muted">→</span>
                            <select class="modal-input tiny" style="width:auto;" onchange="OL.setBillableRuleProp(${i}, 'billable', this.value === 'true')">
                                <option value="true" ${r.billable ? 'selected' : ''}>Billable</option>
                                <option value="false" ${!r.billable ? 'selected' : ''}>Non-billable</option>
                            </select>
                            <span style="flex:1;"></span>
                            <button class="btn tiny soft" title="Move up" ${i === 0 ? 'disabled' : ''} onclick="OL.moveBillableRule(${i}, -1)">↑</button>
                            <button class="btn tiny soft" title="Move down" ${i === rules.length - 1 ? 'disabled' : ''} onclick="OL.moveBillableRule(${i}, 1)">↓</button>
                            <button class="btn tiny soft" style="color:#ef4444;" title="Delete rule" onclick="OL.removeBillableRule(${i})">✕</button>
                        </div>
                        ${r.conditions.map((c, j) => {
                            const fieldKeys = allowed.includes(c.field) ? allowed : [...allowed, c.field];
                            const notApplicable = !allowed.includes(c.field);
                            return `
                            <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap; padding-left:24px;">
                                <span class="tiny muted" style="width:30px;">${j === 0 ? 'If' : 'and'}</span>
                                <select class="modal-input tiny" style="width:auto;" onchange="OL.setBillableCond(${i}, ${j}, 'field', this.value)">
                                    ${fieldKeys.map((k) => `<option value="${k}" ${c.field === k ? 'selected' : ''}>${esc(defs[k]?.label || k)}${allowed.includes(k) ? '' : ' (tasks only)'}</option>`).join('')}
                                </select>
                                <select class="modal-input tiny" style="width:auto;" onchange="OL.setBillableCond(${i}, ${j}, 'op', this.value)">
                                    ${Object.entries(ops).map(([k, l]) => `<option value="${k}" ${(c.op || 'equals') === k ? 'selected' : ''}>${l}</option>`).join('')}
                                </select>
                                ${OL._renderBillableValueControl(i, j, c)}
                                ${r.conditions.length > 1 ? `<button class="btn tiny soft" title="Remove condition" onclick="OL.removeBillableCond(${i}, ${j})">✕</button>` : ''}
                            </div>
                            ${notApplicable ? `<div class="tiny" style="padding-left:60px; color:#f59e0b;">This field only exists on tasks, so this rule will never match an event.</div>` : ''}
                            ${defs[c.field]?.hint ? `<div class="tiny muted" style="padding-left:60px;">${esc(defs[c.field].hint)}</div>` : ''}`;
                        }).join('')}
                        <div style="padding-left:24px;"><button class="btn tiny soft" onclick="OL.addBillableCond(${i})">+ And…</button></div>
                    </div>`;
                }).join('') : `<div class="tiny muted">No rules — everything is non-billable unless toggled by hand.</div>`}
            </div>
            <button class="btn tiny primary" onclick="OL.addBillableRule()"><i data-lucide="plus" style="width:11px;height:11px;"></i> Add Rule</button>
            <div class="tiny muted" style="margin-top:14px;">Examples: <em>Tasks & events · Meeting category is Coaching Call → Billable</em> · <em>Tasks · Task type is Sphynx Task and Project status is any of Ongoing Maintenance, Ad Hoc Maintenance → Billable</em> · <em>Tasks · Title contains internal → Non-billable</em></div>
        </div>`;
};

// rulesChanged=false for UI-only re-renders (opening a Custom… box).
OL._saveBillableRules = function(rulesChanged = true) {
    if (rulesChanged) {
        OL.persist();
        if (OL.scheduleEventBillableSweep) OL.scheduleEventBillableSweep();
    }
    if (typeof OL.renderAutomationBuilder === 'function' && location.hash.includes('automations')) OL.renderAutomationBuilder();
};
OL.addBillableRule = function() {
    state.master.billableRules.push({ id: 'br-' + Date.now(), appliesTo: 'tasks', billable: true, conditions: [{ field: 'taskType', op: 'equals', value: '' }] });
    OL._saveBillableRules();
};
OL.setBillableRuleProp = function(i, key, value) {
    const r = OL._billableRuleAt(i);
    if (!r || r[key] === value) return;
    r[key] = value;
    OL._saveBillableRules();
};
OL.addBillableCond = function(i) {
    const r = OL._billableRuleAt(i);
    if (!r) return;
    const field = OL.billableFieldsForAppliesTo(r.appliesTo)[0] || 'title';
    r.conditions.push({ field, op: 'equals', value: '' });
    OL._saveBillableRules();
};
OL.removeBillableCond = function(i, j) {
    const r = OL._billableRuleAt(i);
    if (!r || r.conditions.length <= 1) return;
    r.conditions.splice(j, 1);
    OL._billableCustomOpen = {};
    OL._saveBillableRules();
};
OL.setBillableCond = function(i, j, key, value) {
    const r = OL._billableRuleAt(i);
    const c = r?.conditions?.[j];
    if (!c) return;
    value = typeof value === 'string' ? value.trim() : value;
    if (c[key] === value) return;
    c[key] = value;
    if (key === 'field') {                       // new field: its old value no longer fits
        c.value = ''; c.values = [];
        OL._billableCustomOpen[`${i}-${j}`] = false;
    }
    if (key === 'op') {                          // carry the value(s) across is / is any of
        if (value === 'in') { c.values = c.values?.length ? c.values : (c.value ? [c.value] : []); }
        else if (!c.value && c.values?.length) c.value = c.values[0];
    }
    OL._saveBillableRules();
};
OL.onBillableValueSelect = function(i, j, value) {
    if (value === '__custom__') {
        OL._billableCustomOpen[`${i}-${j}`] = true;
        const c = OL._billableRuleAt(i)?.conditions?.[j];
        if (c) c.value = '';
        OL._saveBillableRules(false);
        return;
    }
    OL._billableCustomOpen[`${i}-${j}`] = false;
    OL.setBillableCond(i, j, 'value', value);
};
OL.onBillableMultiSelect = function(i, j, value) {
    if (!value) return;
    if (value === '__custom__') { OL._billableCustomOpen[`${i}-${j}`] = true; OL._saveBillableRules(false); return; }
    OL.addBillableCondValue(i, j, value);
};
OL.addBillableCondValue = function(i, j, value) {
    const c = OL._billableRuleAt(i)?.conditions?.[j];
    const v = String(value || '').trim();
    if (!c || !v) return;
    c.values = c.values || [];
    if (c.values.some((x) => lower(x) === lower(v))) return;
    c.values.push(v);
    OL._saveBillableRules();
};
OL.removeBillableCondValue = function(i, j, k) {
    const c = OL._billableRuleAt(i)?.conditions?.[j];
    if (!c?.values) return;
    c.values.splice(k, 1);
    OL._saveBillableRules();
};
OL.removeBillableRule = function(i) {
    state.master.billableRules.splice(i, 1);
    OL._billableCustomOpen = {};
    OL._saveBillableRules();
};
OL.moveBillableRule = function(i, dir) {
    const list = state.master.billableRules;
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    OL._billableCustomOpen = {};
    OL._saveBillableRules();
};
