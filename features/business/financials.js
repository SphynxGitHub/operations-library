import { esc, state } from '../../core/data.js';

OL.renderBusinessFinancials = function() {
    const main = document.getElementById("mainContent");
    if (!main) return;

    const clients = Object.values(state.clients || {});
    let allScopedItems = clients.flatMap(c => {
        const sheet = c.projectData?.scopingSheets?.[0];
        return (sheet?.lineItems || []).map(li => ({
            ...li,
            clientName: c.meta?.name || 'Client',
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
                        const res = typeof OL.getResourceById === 'function' ? OL.getResourceById(item.resourceId) : null;
                        const netValue = res && typeof OL.calculateRowFee === 'function' ? (OL.calculateRowFee(item, res) || 0) : 0;

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
