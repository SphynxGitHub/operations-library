import { esc, state, db, getActiveClient, getBusinessScopedClients } from '../../core/data.js';

OL.errorLogState = {
    statusFilter: 'open',   // 'open' | 'resolved' | 'all'
    clientFilter: '',
    serviceFilter: '',
    query: '',
    rows: [],
    services: [],
    loading: false,
    loadedOnce: false,
    loadedForScope: null,
    lockedClientId: null    // set when viewing from inside a specific client's project
};

// Re-render whichever mode is currently active (centralized vs client-locked)
OL._rerenderErrorLog = function() {
    if (OL.errorLogState.lockedClientId) OL.renderClientErrorLog();
    else OL.renderBusinessErrorLog();
};

OL.renderBusinessErrorLog = function() {
    OL.errorLogState.lockedClientId = null;
    OL._renderErrorLogShell('Error Tracking', 'Centralized log across every client project — Zapier failures, manual notes, and quirks');
};

OL.renderClientErrorLog = function() {
    const client = getActiveClient();
    if (!client) return;
    OL.errorLogState.lockedClientId = client.id;
    OL._renderErrorLogShell(`Error Tracking — ${client.meta?.name || 'Project'}`, 'Zapier failures, manual notes, and quirks for this project');
};

OL._renderErrorLogShell = function(title, subtitle) {
    const main = document.getElementById("mainContent");
    if (!main) return;

    const desiredScope = OL.errorLogState.lockedClientId || '__global';
    if ((!OL.errorLogState.loadedOnce || OL.errorLogState.loadedForScope !== desiredScope) && !OL.errorLogState.loading) {
        OL.errorLogState.loadedOnce = true;
        OL.errorLogState.loadedForScope = desiredScope;
        OL.loadErrorLog().then(() => OL._rerenderErrorLog());
    }

    const locked = !!OL.errorLogState.lockedClientId;
    const clients = getBusinessScopedClients();
    const rows = OL.errorLogState.rows;

    main.innerHTML = `
        <div class="section-header">
            <div>
                <h2><i data-lucide="alert-triangle" style="width:24px;height:24px;vertical-align:sub;margin-right:8px;color:var(--accent);"></i>${esc(title)}</h2>
                <div class="small muted">${esc(subtitle)}</div>
            </div>
            <div class="header-actions">
                <button class="btn small primary" onclick="OL.openAddErrorModal()">
                    <i data-lucide="plus" style="width:14px;height:14px;"></i> Add Error
                </button>
            </div>
        </div>

        <div class="card" style="padding:20px;">
            <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin-bottom:18px; border-bottom:1px solid var(--line); padding-bottom:15px;">
                <div style="display:flex; gap:8px;">
                    <button class="btn tiny ${OL.errorLogState.statusFilter === 'open' ? 'primary' : 'soft'}" onclick="OL.setErrorLogFilter('statusFilter', 'open')">Open</button>
                    <button class="btn tiny ${OL.errorLogState.statusFilter === 'resolved' ? 'primary' : 'soft'}" onclick="OL.setErrorLogFilter('statusFilter', 'resolved')">Resolved</button>
                    <button class="btn tiny ${OL.errorLogState.statusFilter === 'all' ? 'primary' : 'soft'}" onclick="OL.setErrorLogFilter('statusFilter', 'all')">All</button>
                </div>
                ${!locked ? `
                    <select class="modal-input tiny" style="width:180px;" onchange="OL.setErrorLogFilter('clientFilter', this.value)">
                        <option value="">All Clients</option>
                        <option value="__unassigned" ${OL.errorLogState.clientFilter === '__unassigned' ? 'selected' : ''}>Unassigned</option>
                        ${clients.map(c => `<option value="${c.id}" ${OL.errorLogState.clientFilter === c.id ? 'selected' : ''}>${esc(c.meta?.name || 'Unnamed')}</option>`).join('')}
                    </select>
                ` : ''}
                <select class="modal-input tiny" style="width:180px;" onchange="OL.setErrorLogFilter('serviceFilter', this.value)">
                    <option value="">All Services</option>
                    ${OL.errorLogState.services.map(s => `<option value="${esc(s)}" ${OL.errorLogState.serviceFilter === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}
                </select>
                <input type="text" class="modal-input tiny" style="flex:1; min-width:180px;" placeholder="Search title/message..." value="${esc(OL.errorLogState.query)}" oninput="OL.setErrorLogFilter('query', this.value)">
            </div>

            ${OL.errorLogState.loading ? `<div class="tiny muted" style="text-align:center; padding:30px;">Loading...</div>` : ''}

            ${(!OL.errorLogState.loading && rows.length === 0) ? `
                <div style="text-align:center; padding:40px; color:var(--muted);">
                    <i data-lucide="check-circle" style="width:36px;height:32px;margin-bottom:8px;opacity:0.5;"></i>
                    <div>No errors match these filters.</div>
                </div>
            ` : ''}

            <div style="display:grid; gap:10px;">
                ${rows.map(r => OL.renderErrorLogRow(r, clients, locked)).join('')}
            </div>
        </div>
    `;
    if (window.lucide) lucide.createIcons();
};

OL.renderErrorLogRow = function(r, clients, locked) {
    const sourceIcon = r.source === 'webhook' ? '🔗' : (r.source === 'email' ? '✉️' : '✍️');
    const occurred = r.occurred_at ? new Date(r.occurred_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '';

    return `
        <div class="card-section" style="border-color: var(--line); background: rgba(255,255,255,0.02);">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px; flex-wrap:wrap;">
                <div style="flex:1; min-width:220px;">
                    <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px; flex-wrap:wrap;">
                        <span class="tiny" title="${esc(r.source)}">${sourceIcon}</span>
                        <strong style="font-size:14px;">${esc(r.title || r.service || 'Untitled Error')}</strong>
                        ${r.outage ? `<span class="pill tiny" style="background:rgba(239,68,68,0.15); color:#ef4444;">Outage</span>` : ''}
                        ${r.occurrence_count && r.occurrence_count > 1 ? `<span class="pill tiny soft">×${r.occurrence_count}</span>` : ''}
                    </div>
                    <div class="tiny muted">${esc(occurred)}${r.service ? ` · ${esc(r.service)}` : ''}</div>
                </div>
                ${!locked ? `
                    <div style="min-width:160px;">
                        <select class="modal-input tiny" onchange="OL.assignErrorClient('${r.id}', this.value)">
                            <option value="">-- Unassigned --</option>
                            ${clients.map(c => `<option value="${c.id}" ${r.client_id === c.id ? 'selected' : ''}>${esc(c.meta?.name || 'Unnamed')}</option>`).join('')}
                        </select>
                    </div>
                ` : ''}
                <div>
                    <button class="btn tiny ${r.status === 'resolved' ? 'soft' : 'primary'}" onclick="OL.toggleErrorStatus('${r.id}', '${r.status === 'resolved' ? 'open' : 'resolved'}')">
                        ${r.status === 'resolved' ? '↩ Reopen' : '✓ Resolve'}
                    </button>
                </div>
            </div>

            <div style="margin-top:10px; font-size:12px; line-height:1.5; white-space:pre-wrap; background:rgba(255,255,255,0.02); border:1px solid var(--line); border-radius:6px; padding:8px 10px; cursor:pointer;" onclick="OL.openErrorDetailModal('${r.id}')" title="Click for full details and links">
                ${esc((r.message || '').length > 220 ? r.message.slice(0, 220) + '…' : (r.message || ''))}
            </div>

            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-top:10px;">
                <div>
                    <label class="tiny muted bold" style="display:block; margin-bottom:4px;">Cause</label>
                    <textarea class="modal-input tiny" rows="2" placeholder="What caused this?" onblur="OL.saveErrorField('${r.id}', 'cause', this.value)">${esc(r.cause || '')}</textarea>
                </div>
                <div>
                    <label class="tiny muted bold" style="display:block; margin-bottom:4px;">Resolution</label>
                    <textarea class="modal-input tiny" rows="2" placeholder="How was it fixed?" onblur="OL.saveErrorField('${r.id}', 'resolution', this.value)">${esc(r.resolution || '')}</textarea>
                </div>
            </div>
        </div>
    `;
};

OL.setErrorLogFilter = function(key, value) {
    OL.errorLogState[key] = value;
    OL.loadErrorLog().then(() => OL._rerenderErrorLog());
};

OL.loadErrorLog = async function() {
    OL.errorLogState.loading = true;

    let query = db.from('error_log').select('*');

    if (OL.errorLogState.lockedClientId) {
        query = query.eq('client_id', OL.errorLogState.lockedClientId);
    } else if (OL.errorLogState.clientFilter === '__unassigned') {
        query = query.is('client_id', null);
    } else if (OL.errorLogState.clientFilter) {
        query = query.eq('client_id', OL.errorLogState.clientFilter);
    }

    if (OL.errorLogState.statusFilter !== 'all') {
        query = query.eq('status', OL.errorLogState.statusFilter);
    }
    if (OL.errorLogState.serviceFilter) {
        query = query.eq('service', OL.errorLogState.serviceFilter);
    }
    if (OL.errorLogState.query.trim()) {
        const q = OL.errorLogState.query.trim();
        query = query.or(`title.ilike.%${q}%,message.ilike.%${q}%`);
    }

    const { data, error } = await query.order('occurred_at', { ascending: false }).limit(300);
    OL.errorLogState.loading = false;

    if (error) { console.error('Failed to load error log:', error.message); OL.errorLogState.rows = []; return; }
    OL.errorLogState.rows = data || [];

    // Populate the service filter dropdown from whatever's actually in the table
    const { data: serviceRows } = await db.from('error_log').select('service').not('service', 'is', null);
    OL.errorLogState.services = [...new Set((serviceRows || []).map(r => r.service).filter(Boolean))].sort();
};

OL.assignErrorClient = async function(id, clientId) {
    const { error } = await db.from('error_log').update({ client_id: clientId || null }).eq('id', id);
    if (error) { alert('Failed to assign client: ' + error.message); return; }
    const row = OL.errorLogState.rows.find(r => r.id === id);
    if (row) row.client_id = clientId || null;
};

OL.toggleErrorStatus = async function(id, newStatus) {
    const { error } = await db.from('error_log').update({ status: newStatus }).eq('id', id);
    if (error) { alert('Failed to update status: ' + error.message); return; }
    if (OL.errorLogState.statusFilter !== 'all') {
        // no longer matches the current filter — just reload
        await OL.loadErrorLog();
        OL._rerenderErrorLog();
    } else {
        const row = OL.errorLogState.rows.find(r => r.id === id);
        if (row) row.status = newStatus;
        OL._rerenderErrorLog();
    }
};

OL.saveErrorField = async function(id, field, value) {
    const { error } = await db.from('error_log').update({ [field]: value }).eq('id', id);
    if (error) { console.error(`Failed to save ${field}:`, error.message); return; }
    const row = OL.errorLogState.rows.find(r => r.id === id);
    if (row) row[field] = value;
};

// -------------------------------------------------------------
// DETAIL MODAL (full message + links)
// -------------------------------------------------------------
OL.openErrorDetailModal = function(id) {
    const r = OL.errorLogState.rows.find(x => x.id === id);
    if (!r) return;

    const html = `
        <div class="modal-head">
            <div class="modal-title-text">⚠️ ${esc(r.title || r.service || 'Error Detail')}</div>
            <button class="btn small soft" onclick="OL.closeModal()">Close</button>
        </div>
        <div class="modal-body" style="max-width:600px; width:100%;">
            <div class="tiny muted" style="margin-bottom:12px; display:flex; flex-direction:column; gap:2px;">
                <div><strong>Occurred:</strong> ${r.occurred_at ? new Date(r.occurred_at).toLocaleString() : 'Unknown'}</div>
                ${r.service ? `<div><strong>Service:</strong> ${esc(r.service)}</div>` : ''}
                ${r.root_id ? `<div><strong>Root ID:</strong> ${esc(r.root_id)}</div>` : ''}
                <div><strong>Source:</strong> ${esc(r.source)}</div>
            </div>
            <div style="white-space:pre-wrap; line-height:1.6; font-size:13px; border-top:1px solid var(--line); padding-top:12px; margin-bottom:14px;">
                ${esc(r.message || '')}
            </div>
            <div style="display:flex; gap:8px; flex-wrap:wrap;">
                ${r.history_link ? `<a href="${r.history_link}" target="_blank" class="btn tiny soft" style="text-decoration:none;">History Link</a>` : ''}
                ${r.zap_link ? `<a href="${r.zap_link}" target="_blank" class="btn tiny soft" style="text-decoration:none;">Zap Link</a>` : ''}
            </div>
        </div>
    `;
    openModal(html);
};
window.OL.openErrorDetailModal = OL.openErrorDetailModal;

// -------------------------------------------------------------
// MANUAL ADD
// -------------------------------------------------------------
OL.openAddErrorModal = function() {
    const locked = OL.errorLogState.lockedClientId;
    const lockedClientName = locked ? (state.clients[locked]?.meta?.name || 'This project') : null;
    const clients = getBusinessScopedClients();

    const html = `
        <div class="modal-head">
            <div class="modal-title-text">➕ Add Error / Quirk</div>
            <button class="btn small soft" onclick="OL.closeModal()">Close</button>
        </div>
        <div class="modal-body" style="max-width:500px; width:100%;">
            <div style="display:flex; flex-direction:column; gap:10px;">
                <div>
                    <label class="tiny muted bold">Client</label>
                    ${locked ? `
                        <input type="text" class="modal-input tiny" value="${esc(lockedClientName)}" disabled>
                    ` : `
                        <select id="add-error-client" class="modal-input tiny">
                            <option value="">-- Unassigned --</option>
                            ${clients.map(c => `<option value="${c.id}">${esc(c.meta?.name || 'Unnamed')}</option>`).join('')}
                        </select>
                    `}
                </div>
                <div>
                    <label class="tiny muted bold">Title</label>
                    <input type="text" id="add-error-title" class="modal-input tiny" placeholder="Short summary">
                </div>
                <div>
                    <label class="tiny muted bold">Service</label>
                    <input type="text" id="add-error-service" class="modal-input tiny" placeholder="e.g. RingCentral, Wealthbox">
                </div>
                <div>
                    <label class="tiny muted bold">Message *</label>
                    <textarea id="add-error-message" class="modal-input tiny" rows="3" placeholder="What happened?"></textarea>
                </div>
                <div>
                    <label class="tiny muted bold">Cause</label>
                    <textarea id="add-error-cause" class="modal-input tiny" rows="2"></textarea>
                </div>
                <div>
                    <label class="tiny muted bold">Resolution</label>
                    <textarea id="add-error-resolution" class="modal-input tiny" rows="2"></textarea>
                </div>
            </div>
            <div style="display:flex; justify-content:flex-end; margin-top:16px;">
                <button class="btn small primary" onclick="OL.saveManualError()" style="font-weight:bold;">Add Error</button>
            </div>
        </div>
    `;
    openModal(html);
};

OL.saveManualError = async function() {
    const message = document.getElementById('add-error-message')?.value.trim();
    if (!message) { alert('Message is required.'); return; }

    const row = {
        client_id: OL.errorLogState.lockedClientId || document.getElementById('add-error-client')?.value || null,
        source: 'manual',
        title: document.getElementById('add-error-title')?.value.trim() || null,
        service: document.getElementById('add-error-service')?.value.trim() || null,
        message,
        cause: document.getElementById('add-error-cause')?.value.trim() || null,
        resolution: document.getElementById('add-error-resolution')?.value.trim() || null,
        occurred_at: new Date().toISOString()
    };

    const { error } = await db.from('error_log').insert(row);
    if (error) { alert('Failed to add error: ' + error.message); return; }

    OL.closeModal();
    await OL.loadErrorLog();
    OL._rerenderErrorLog();
};

window.OL.renderBusinessErrorLog = OL.renderBusinessErrorLog;
window.OL.renderClientErrorLog = OL.renderClientErrorLog;
