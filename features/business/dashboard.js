import { esc, state } from '../../core/data.js';

OL.renderDailyDashboard = function() {
    const main = document.getElementById("mainContent");
    if (!main) return;

    const clients = Object.values(state.clients || {});
    const allTasks = clients.flatMap(c => (c.projectData?.clientTasks || []).map(t => ({...t, clientName: c.meta?.name || 'Client', clientId: c.id})));
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
