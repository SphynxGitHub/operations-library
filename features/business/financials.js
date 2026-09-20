import { esc, state, getBusinessScopedClients } from '../../core/data.js';

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

    main.innerHTML = `
        <div class="section-header">
            <div>
                <h2>💰 Agency Financials & Scoped Work</h2>
                <div class="small muted">Track total gross, scoped deliverables, and approved revenue across all projects</div>
            </div>
        </div>

        <div class="card" style="padding: 20px;">
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
                        ${allScopedItems.map(item => {
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
                                        ${esc(item.responsibleParty || 'Sphynx')}                                     </td>                                     <td style="padding: 10px 12px; border-bottom: 1px solid var(--line); text-align: right; font-weight: bold; color: var(--accent);">$${netValue.toLocaleString()}</td>
                                </tr>
                            `;
                        }).join('') || '<tr><td colspan="5" class="p-20 text-center muted">No scoped items found across projects.</td></tr>'}
                    </tbody>
                </table>
            </div>
        </div>
    `;
    if (window.lucide) lucide.createIcons();
};
