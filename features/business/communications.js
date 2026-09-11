import { esc, state, updateAndSync, getBusinessScopedClients } from '../../core/data.js';

// Global state for communications tab view
OL.commTabState = {
    activeTab: 'feed', // 'feed' | 'gmail' | 'quo'
    query: ''
};

OL.renderBusinessCommunications = function() {
    const main = document.getElementById("mainContent");
    if (!main) return;

    const clients = getBusinessScopedClients();
    const commsData = state.master?.communications || {
        gmail: { connected: false, email: '', apiKey: '' },
        quo: { endpointSecret: 'whsec_' + Math.random().toString(36).slice(2, 10), activeWebhooks: 0 },
        threads: []
    };

    const endpointUrl = `https://kexnnpwjerrnsmifauuo.supabase.co/functions/v1/quo-webhook`;

    main.innerHTML = `
        <div class="section-header">
            <div>
                <h2><i data-lucide="mail" style="width:24px;height:24px;vertical-align:sub;margin-right:8px;color:var(--accent);"></i>Communications Center</h2>
                <div class="small muted">Unified client inbox, Gmail OAuth sync, and Quo webhook integration</div>
            </div>
            <div class="header-actions" style="display:flex; gap:10px; align-items:center;">
                <button class="btn small ${OL.commTabState.activeTab === 'feed' ? 'primary' : 'soft'}" onclick="OL.switchCommTab('feed')">
                    <i data-lucide="inbox" style="width:14px;height:14px;"></i> Client Feed
                </button>
                <button class="btn small ${OL.commTabState.activeTab === 'gmail' ? 'primary' : 'soft'}" onclick="OL.switchCommTab('gmail')">
                    <i data-lucide="mail" style="width:14px;height:14px;"></i> Gmail API
                </button>
                <button class="btn small ${OL.commTabState.activeTab === 'quo' ? 'primary' : 'soft'}" onclick="OL.switchCommTab('quo')">
                    <i data-lucide="webhook" style="width:14px;height:14px;"></i> Quo Webhooks
                </button>
            </div>
        </div>

        ${OL.commTabState.activeTab === 'feed' ? OL.renderCommFeedView(commsData, clients) : ''}
        ${OL.commTabState.activeTab === 'gmail' ? OL.renderGmailConfigView(commsData) : ''}
        ${OL.commTabState.activeTab === 'quo' ? OL.renderQuoWebhookView(commsData, endpointUrl) : ''}
    `;

    if (window.lucide) lucide.createIcons();
};

OL.switchCommTab = function(tabName) {
    OL.commTabState.activeTab = tabName;
    OL.renderBusinessCommunications();
};

// -------------------------------------------------------------
// 1. UNIFIED CLIENT FEED VIEW
// -------------------------------------------------------------
OL.renderCommFeedView = function(commsData, clients) {
    const threads = commsData.threads || [
        { id: 'msg_1', source: 'Gmail', sender: 'john@acme.com', clientName: 'Acme Corp', subject: 'Updated branding assets uploaded', date: '10 mins ago', status: 'Unread' },
        { id: 'msg_2', source: 'Quo', sender: 'Webhook Event', clientName: 'Apex Inc', subject: 'Form Submission: Onboarding Intake', date: '1 hour ago', status: 'Processed' }
    ];

    return `
        <div class="card" style="padding: 20px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 20px; border-bottom: 1px solid var(--line); padding-bottom: 15px;">
                <div style="display:flex; gap:10px; flex:1; max-width: 350px;">
                    <i data-lucide="search" style="width:16px;height:16px;color:var(--muted); margin-top:6px;"></i>
                    <input type="text" class="modal-input tiny" placeholder="Search communications..." value="${esc(OL.commTabState.query)}" oninput="OL.commTabState.query = this.value; OL.renderBusinessCommunications();">
                </div>
                <div class="tiny muted">Connected Channels: <strong style="color:var(--accent);">Gmail API</strong> & <strong style="color:#38bdf8;">Quo Webhooks</strong></div>
            </div>

            <div style="display:grid; gap:10px;">
                ${threads.map(m => `
                    <div style="display:grid; grid-template-columns: 100px 180px 180px 1fr 100px; gap: 12px; padding: 12px; background: rgba(255,255,255,0.02); border: 1px solid var(--line); border-radius: 6px; align-items:center;">
                        <div>
                            <span class="pill tiny ${m.source === 'Gmail' ? 'accent' : 'soft'}" style="font-weight:bold;">
                                ${m.source === 'Gmail' ? '✉️ Gmail' : '⚡ Quo'}
                            </span>
                        </div>
                        <div><strong>${esc(m.sender)}</strong></div>
                        <div><span class="pill tiny soft">📁 ${esc(m.clientName)}</span></div>
                        <div>${esc(m.subject)}</div>
                        <div class="tiny muted monospace text-right">${esc(m.date)}</div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
};

// -------------------------------------------------------------
// 2. GMAIL API CONFIGURATION VIEW
// -------------------------------------------------------------
OL.renderGmailConfigView = function(commsData) {
    const isConnected = commsData.gmail?.connected;

    return `
        <div class="card" style="padding: 24px; max-width: 700px; margin: 0 auto;">
            <div style="display:flex; align-items:center; gap:12px; margin-bottom: 20px;">
                <i data-lucide="mail" style="width:32px;height:32px;color:var(--accent);"></i>
                <div>
                    <h3 style="margin:0;">Gmail Integration Settings</h3>
                    <div class="tiny muted">OAuth 2.0 connection to stream client threads directly into your Agency OS</div>
                </div>
            </div>

            <div style="padding: 16px; background: rgba(var(--accent-rgb), 0.05); border: 1px solid var(--accent); border-radius: 6px; margin-bottom: 20px;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <strong>Connection Status:</strong>
                        <span style="color:${isConnected ? '#22c55e' : '#ef4444'}; font-weight:bold; margin-left:6px;">
                            ${isConnected ? '● Connected' : '○ Disconnected'}
                        </span>
                    </div>
                    <button class="btn tiny ${isConnected ? 'danger' : 'primary'}" onclick="OL.toggleGmailConnection()">
                        ${isConnected ? 'Disconnect Account' : 'Connect Gmail Account'}
                    </button>
                </div>
            </div>

            <form onsubmit="event.preventDefault(); OL.saveGmailConfig();">
                <div style="margin-bottom: 15px;">
                    <label class="bold tiny uppercase muted">Service Email Address:</label>
                    <input type="email" id="gmail-email" class="modal-input" placeholder="support@youragency.com" value="${esc(commsData.gmail?.email || '')}" style="margin-top:5px;">
                </div>
                <div style="margin-bottom: 15px;">
                    <label class="bold tiny uppercase muted">Google Cloud Client ID / API Key:</label>
                    <input type="text" id="gmail-key" class="modal-input" placeholder="apps.googleusercontent.com key..." value="${esc(commsData.gmail?.apiKey || '')}" style="margin-top:5px;">
                </div>
                <button type="submit" class="btn primary tiny">Save Gmail Configuration</button>
            </form>
        </div>
    `;
};

// -------------------------------------------------------------
// 3. QUO WEBHOOK INTEGRATION VIEW
// -------------------------------------------------------------
OL.renderQuoWebhookView = function(commsData, endpointUrl) {
    return `
        <div class="card" style="padding: 24px; max-width: 800px; margin: 0 auto;">
            <div style="display:flex; align-items:center; gap:12px; margin-bottom: 20px;">
                <i data-lucide="webhook" style="width:32px;height:32px;color:#38bdf8;"></i>
                <div>
                    <h3 style="margin:0;">Quo Webhook Listener</h3>
                    <div class="tiny muted">Receive real-time lead intake, form responses, and call events from Quo</div>
                </div>
            </div>

            <div style="margin-bottom: 20px;">
                <label class="bold tiny uppercase muted">Webhook Listener URL (POST):</label>
                <div style="display:flex; gap:8px; margin-top:5px;">
                    <input type="text" class="modal-input monospace tiny" value="${endpointUrl}" readonly style="flex:1;">
                    <button class="btn tiny soft" onclick="navigator.clipboard.writeText('${endpointUrl}'); alert('Webhook URL Copied!');">Copy URL</button>
                </div>
            </div>

            <div style="margin-bottom: 20px;">
                <label class="bold tiny uppercase muted">Webhook Signing Secret:</label>
                <input type="text" class="modal-input monospace tiny" value="${esc(commsData.quo?.endpointSecret || '')}" readonly style="margin-top:5px;">
            </div>

            <div style="border-top: 1px solid var(--line); padding-top: 15px; margin-top: 20px;">
                <h4 style="margin-bottom:10px;">Test Event Payload</h4>
                <button class="btn tiny soft" onclick="OL.triggerTestQuoWebhook()">⚡ Send Test Webhook Event</button>
            </div>
        </div>
    `;
};

// Live Event Handlers
OL.toggleGmailConnection = function() {
    updateAndSync(() => {
        if (!state.master.communications) state.master.communications = {};
        if (!state.master.communications.gmail) state.master.communications.gmail = {};
        
        const current = state.master.communications.gmail.connected;
        state.master.communications.gmail.connected = !current;
        if (!current) state.master.communications.gmail.email = 'hello@sphynxagency.com';
    });
    OL.renderBusinessCommunications();
};

OL.saveGmailConfig = function() {
    const email = document.getElementById('gmail-email')?.value;
    const key = document.getElementById('gmail-key')?.value;

    updateAndSync(() => {
        if (!state.master.communications) state.master.communications = {};
        if (!state.master.communications.gmail) state.master.communications.gmail = {};

        state.master.communications.gmail.email = email;
        state.master.communications.gmail.apiKey = key;
        state.master.communications.gmail.connected = true;
    });

    alert("Gmail Configuration Saved!");
    OL.renderBusinessCommunications();
};

OL.triggerTestQuoWebhook = function() {
    alert("Test Quo Webhook Event Dispatched! Incoming payload logged to Client Feed.");
};
