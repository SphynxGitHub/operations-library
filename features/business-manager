//=============DAILY DASHBOARD===============//

OL.renderDailyDashboard = function() {
    const main = document.getElementById("mainContent");
    if (!main) return;

    const clients = Object.values(state.clients || {});
    const allTasks = clients.flatMap(c => (c.projectData?.clientTasks || []).map(t => ({...t, clientName: c.meta.name, clientId: c.id})));
    const dueToday = allTasks.filter(t => t.status !== 'Done' && t.dueDate);

    main.innerHTML = `
        <div class="section-header">
            <div>
                <h2>☀️ Daily Command Dashboard</h2>
                <div class="small muted">Overview of operations, active tasks, and client communications</div>
            </div>
        </div>

        <div class="cards-grid" style="grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); margin-bottom: 25px;">
            <div class="card" style="padding: 15px;">
                <div class="tiny muted uppercase bold">Active Clients</div>
                <div style="font-size: 24px; font-weight: 900; color: var(--accent); margin-top: 5px;">${clients.length}</div>
            </div>
            <div class="card" style="padding: 15px;">
                <div class="tiny muted uppercase bold">Open Action Items</div>
                <div style="font-size: 24px; font-weight: 900; color: #38bdf8; margin-top: 5px;">${allTasks.filter(t => t.status !== 'Done').length}</div>
            </div>
            <div class="card" style="padding: 15px;">
                <div class="tiny muted uppercase bold">Due Today / Overdue</div>
                <div style="font-size: 24px; font-weight: 900; color: #ef4444; margin-top: 5px;">${dueToday.length}</div>
            </div>
        </div>

        <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 20px;">
            <div class="card" style="padding: 20px;">
                <h3>📋 High-Priority Task Stream</h3>
                <div style="margin-top: 15px;">
                    ${allTasks.filter(t => t.status !== 'Done').slice(0, 8).map(t => `
                        <div style="display:flex; justify-content:space-between; align-items:center; padding: 8px 0; border-bottom: 1px solid var(--line);">
                            <div>
                                <strong>${esc(t.title || t.name)}</strong>
                                <span class="pill tiny soft">${esc(t.clientName)}</span>
                            </div>
                            <span class="pill tiny accent">${esc(t.status || 'Pending')}</span>
                        </div>
                    `).join('') || '<div class="tiny muted">No pending tasks.</div>'}
                </div>
            </div>

            <div class="card" style="padding: 20px;">
                <h3>✉️ Communications & Sync</h3>
                <div class="tiny muted" style="margin-top: 10px;">Connect Gmail and Quo webhook integrations to stream messages directly here.</div>
                <button class="btn primary tiny" style="margin-top: 15px;" onclick="window.location.hash='#/business/communications'">Connect API</button>
            </div>
        </div>
    `;
    if (window.lucide) lucide.createIcons();
};

//=============GLOBAL TASK MANAGER===============//

OL.renderBusinessTaskManager = function() {
    const main = document.getElementById("mainContent");
    if (!main) return;

    const clients = Object.values(state.clients || {});
    // Pull every task across all clients into one master collection
    let masterTasks = clients.flatMap(c => 
        (c.projectData?.clientTasks || []).map(t => ({ ...t, clientName: c.meta.name, clientId: c.id }))
    );

    main.innerHTML = `
        <div class="section-header">
            <div>
                <h2>📋 Cross-Project Task Manager</h2>
                <div class="small muted">Consolidated view of all active deliverables across every client</div>
            </div>
            <div class="header-actions">
                <button class="btn small soft" onclick="OL.renderBusinessTaskManager()">🔄 Refresh</button>
            </div>
        </div>

        <div class="card" style="padding: 20px;">
            <div style="display: flex; gap: 10px; margin-bottom: 20px;">
                <input type="text" class="modal-input tiny" placeholder="Search tasks or clients..." oninput="OL.filterGlobalTasks(this.value)">
                <button class="btn tiny accent" onclick="OL.filterGlobalTaskStatus('All')">All</button>
                <button class="btn tiny soft" onclick="OL.filterGlobalTaskStatus('Pending')">Pending</button>
                <button class="btn tiny soft" onclick="OL.filterGlobalTaskStatus('In Progress')">In Progress</button>
                <button class="btn tiny soft" onclick="OL.filterGlobalTaskStatus('Done')">Done</button>
            </div>

            <div id="global-task-table">
                ${masterTasks.map(t => `
                    <div style="display:grid; grid-template-columns: 2fr 1fr 1fr 100px; gap: 10px; padding: 10px; border-bottom: 1px solid var(--line); align-items:center;">
                        <div>
                            <strong>${esc(t.title || t.name)}</strong>
                            <div class="tiny muted">${esc(t.clientName)}</div>
                        </div>
                        <div><span class="pill tiny soft">${esc(t.status || 'Pending')}</span></div>
                        <div class="tiny monospace">${t.dueDate ? new Date(t.dueDate).toLocaleDateString() : '—'}</div>
                        <button class="btn tiny primary" onclick="OL.switchClient('${t.clientId}'); setTimeout(()=>OL.openTaskModal('${t.id}', false), 200);">Open Task</button>
                    </div>
                `).join('') || '<div class="p-20 muted text-center">No tasks found across projects.</div>'}
            </div>
        </div>
    `;
    if (window.lucide) lucide.createIcons();
};

OL.filterGlobalTasks = function(query) {
    const q = (query || "").toLowerCase().trim();
    const rows = document.querySelectorAll('#global-task-table > div');
    rows.forEach(row => {
        const text = row.innerText.toLowerCase();
        row.style.display = text.includes(q) ? 'grid' : 'none';
    });
};

OL.filterGlobalTaskStatus = function(status) {
    const rows = document.querySelectorAll('#global-task-table > div');
    rows.forEach(row => {
        if (status === 'All') {
            row.style.display = 'grid';
        } else {
            const statusPill = row.querySelector('.pill');
            const currentStatus = statusPill ? statusPill.innerText.trim() : '';
            row.style.display = (currentStatus === status) ? 'grid' : 'none';
        }
    });
};

//=============FINANCIALS===============//

OL.renderBusinessFinancials = function() {
    const main = document.getElementById("mainContent");
    if (!main) return;

    const clients = Object.values(state.clients || {});
    let allScopedItems = clients.flatMap(c => {
        const sheet = c.projectData?.scopingSheets?.[0];
        return (sheet?.lineItems || []).map(li => ({
            ...li,
            clientName: c.meta.name,
            clientId: c.id
        }));
    });

    main.innerHTML = `
        <div class="section-header">
            <div>
                <h2>💰 Agency Financials & Scoped Work</h2>
                <div class="small muted">Track total gross, scoped deliverables, and approved revenue across all projects</div>
            </div>
        </div>

        <div class="card" style="padding: 20px;">
            <table class="matrix-table" style="width:100%;">
                <thead>
                    <tr>
                        <th style="text-align:left;">Client</th>
                        <th style="text-align:left;">Deliverable</th>
                        <th style="text-align:center;">Status</th>
                        <th style="text-align:center;">Party</th>
                        <th style="text-align:right;">Net Value</th>
                    </tr>
                </thead>
                <tbody>
                    ${allScopedItems.map(item => {
                        const res = OL.getResourceById(item.resourceId);
                        // 🎯 Calculate fee dynamically using your core pricing engine:
                        const netValue = res ? (OL.calculateRowFee(item, res) || 0) : 0;

                        return `
                            <tr>
                                <td><strong>${esc(item.clientName)}</strong></td>
                                <td>${esc(res?.name || item.name || 'Scoped Item')}</td>
                                <td style="text-align:center;"><span class="pill tiny soft">${esc(item.status || 'Do Now')}</span></td>
                                <td style="text-align:center;">${esc(item.responsibleParty || 'Sphynx')}</td>
                                <td style="text-align:right; font-weight:bold; color:var(--accent);">$${netValue.toLocaleString()}</td>
                            </tr>
                        `;
                    }).join('') || '<tr><td colspan="5" class="p-20 text-center muted">No scoped items found across projects.</td></tr>'}
                </tbody>
            </table>
        </div>
    `;
    if (window.lucide) lucide.createIcons();
};

//=============COMMUNICATIONS===============//

OL.renderBusinessCommunications = function() {
    const main = document.getElementById("mainContent");
    if (!main) return;
    main.innerHTML = `
        <div class="section-header">
            <div>
                <h2>✉️ Communications Center</h2>
                <div class="small muted">Connect Gmail API & Quo Webhook endpoints</div>
            </div>
        </div>
        <div class="card" style="padding: 30px; text-align: center;">
            <i data-lucide="mail" style="width: 48px; height: 48px; color: var(--accent); margin-bottom: 15px;"></i>
            <h3>API Integration Ready</h3>
            <p class="muted small" style="max-width: 400px; margin: 0 auto 20px auto;">
                Connect your OAuth tokens for Gmail or hook your Quo API credentials to manage all client threads from a single inbox.
            </p>
            <button class="btn primary">Configure API Keys</button>
        </div>
    `;
    if (window.lucide) lucide.createIcons();
};

//=============CALENDAR===============//

OL.renderBusinessCalendar = function() {
    const main = document.getElementById("mainContent");
    if (!main) return;
    main.innerHTML = `
        <div class="section-header">
            <div>
                <h2>📅 Unified Calendar</h2>
                <div class="small muted">Google Calendar API Synchronization</div>
            </div>
        </div>
        <div class="card" style="padding: 30px; text-align: center;">
            <i data-lucide="calendar" style="width: 48px; height: 48px; color: var(--accent); margin-bottom: 15px;"></i>
            <h3>Google Calendar Integration</h3>
            <p class="muted small" style="max-width: 400px; margin: 0 auto 20px auto;">
                Sync your Google Calendar to view milestone deadlines, client meetings, and scheduled releases.
            </p>
            <button class="btn primary">Connect Google Calendar</button>
        </div>
    `;
    if (window.lucide) lucide.createIcons();
};
