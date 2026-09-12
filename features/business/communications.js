import { esc, state, updateAndSync, getBusinessScopedClients } from '../../core/data.js';

OL.commTabState = {
    activeTab: 'feed', // 'feed' | 'gmail' | 'quo'
    query: '',
    loading: false
};

OL.renderBusinessCommunications = function() {
    const main = document.getElementById("mainContent");
    if (!main) return;

    // Check URL parameters for OAuth return
    OL.checkGoogleAuthReturn();

    const clients = getBusinessScopedClients();
    const commsData = state.master?.communications || {
        gmail: { connected: false, email: '' },
        quo: { endpointSecret: 'whsec_' + Math.random().toString(36).slice(2, 10) },
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
                    <i data-lucide="mail" style="width:14px;height:14px;"></i> Gmail Settings
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
// 1. UNIFIED CLIENT FEED VIEW (LIVE GMAIL THREADS)
// -------------------------------------------------------------
OL.renderCommFeedView = function(commsData, clients) {
    const isConnected = commsData.gmail?.connected;
    const threads = commsData.threads || [];

    return `
        <div class="card" style="padding: 20px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 20px; border-bottom: 1px solid var(--line); padding-bottom: 15px;">
                <div style="display:flex; gap:10px; flex:1; max-width: 350px;">
                    <i data-lucide="search" style="width:16px;height:16px;color:var(--muted); margin-top:6px;"></i>
                    <input type="text" class="modal-input tiny" placeholder="Search communications..." value="${esc(OL.commTabState.query)}" oninput="OL.commTabState.query = this.value; OL.renderBusinessCommunications();">
                </div>
                <div style="display:flex; gap:12px; align-items:center;">
                    ${isConnected ? `
                        <button class="btn tiny soft" onclick="OL.fetchLiveGmailMessages()" ${OL.commTabState.loading ? 'disabled' : ''}>
                            <i data-lucide="refresh-cw" style="width:12px;height:12px;${OL.commTabState.loading ? 'animation: spin 1s linear infinite;' : ''}"></i> 
                            ${OL.commTabState.loading ? 'Syncing...' : 'Sync Gmail'}
                        </button>
                    ` : ''}
                    <div class="tiny muted">Channels: <strong style="color:${isConnected ? '#22c55e' : 'var(--muted)'};">${isConnected ? '● Gmail Active' : '○ Gmail Offline'}</strong></div>
                </div>
            </div>

            <div style="display:grid; gap:10px;">
                ${threads.length === 0 ? `
                    <div style="text-align:center; padding: 40px; color: var(--muted);">
                        <i data-lucide="inbox" style="width:36px;height:32px;margin-bottom:8px;opacity:0.5;"></i>
                        <div>${isConnected ? 'No recent client emails found. Click "Sync Gmail" above.' : 'Connect your Google account under Gmail Settings to stream real emails.'}</div>
                    </div>
                ` : threads.map(m => `
                    <div style="display:grid; grid-template-columns: 100px 200px 160px 1fr 120px; gap: 12px; padding: 12px; background: rgba(255,255,255,0.02); border: 1px solid var(--line); border-radius: 6px; align-items:center;">
                        <div>
                            <span class="pill tiny ${m.source === 'Gmail' ? 'accent' : 'soft'}" style="font-weight:bold;">
                                ${m.source === 'Gmail' ? '✉️ Gmail' : '⚡ Quo'}
                            </span>
                        </div>
                        <div style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;"><strong>${esc(m.sender)}</strong></div>
                        <div><span class="pill tiny soft">📁 ${esc(m.clientName || 'General')}</span></div>
                        <div style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(m.subject)}</div>
                        <div class="tiny muted monospace text-right">${esc(m.date)}</div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
};

// -------------------------------------------------------------
// 2. GMAIL OAUTH SETTINGS VIEW (NO EXTRA INPUT FIELDS)
// -------------------------------------------------------------
OL.renderGmailConfigView = function(commsData) {
    const isConnected = commsData.gmail?.connected;

    return `
        <div class="card" style="padding: 24px; max-width: 650px; margin: 0 auto;">
            <div style="display:flex; align-items:center; gap:12px; margin-bottom: 20px;">
                <i data-lucide="mail" style="width:32px;height:32px;color:var(--accent);"></i>
                <div>
                    <h3 style="margin:0;">Gmail Integration</h3>
                    <div class="tiny muted">OAuth 2.0 direct connection</div>
                </div>
            </div>

            <div style="padding: 20px; background: rgba(255,255,255,0.02); border: 1px solid var(--line); border-radius: 8px;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <strong style="font-size:14px;">Status:</strong>
                        <span style="color:${isConnected ? '#22c55e' : '#ef4444'}; font-weight:bold; margin-left:8px;">
                            ${isConnected ? '● Connected' : '○ Disconnected'}
                        </span>
                        ${commsData.gmail?.email ? `<div class="tiny muted" style="margin-top:4px;">Account: <strong>${esc(commsData.gmail.email)}</strong></div>` : ''}
                    </div>
                    ${isConnected ? `
                        <button class="btn tiny danger" onclick="OL.disconnectGmailAccount()">Disconnect</button>
                    ` : `
                        <button class="btn small primary" onclick="OL.initiateGoogleAuth()" style="display:flex; align-items:center; gap:8px;">
                            <i data-lucide="log-in" style="width:14px;height:14px;"></i> Connect Google Account
                        </button>
                    `}
                </div>
            </div>
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
                    <div class="tiny muted">Receive real-time lead intake and form events</div>
                </div>
            </div>

            <div style="margin-bottom: 20px;">
                <label class="bold tiny uppercase muted">Webhook Endpoint URL (POST):</label>
                <div style="display:flex; gap:8px; margin-top:5px;">
                    <input type="text" class="modal-input monospace tiny" value="${endpointUrl}" readonly style="flex:1;">
                    <button class="btn tiny soft" onclick="navigator.clipboard.writeText('${endpointUrl}'); alert('Webhook URL Copied!');">Copy URL</button>
                </div>
            </div>
        </div>
    `;
};

// -------------------------------------------------------------
// LIVE GMAIL FETCH & ACTIONS
// -------------------------------------------------------------
OL.initiateGoogleAuth = function() {
    window.location.href = "https://kexnnpwjerrnsmifauuo.supabase.co/functions/v1/google-auth-login";
};

OL.checkGoogleAuthReturn = function() {
    const urlParams = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.split('?')[1] || '');

    const isConnected = urlParams.get('connected') === 'true' || hashParams.get('connected') === 'true';

    if (isConnected) {
        updateAndSync(() => {
            if (!state.master) state.master = {};
            if (!state.master.communications) state.master.communications = {};
            if (!state.master.communications.gmail) state.master.communications.gmail = {};

            state.master.communications.gmail.connected = true;
            state.master.googleConnected = true;
        });

        // Clean query parameters from address bar without reloading
        window.history.replaceState({}, document.title, window.location.pathname + window.location.hash);

        // Auto-fetch both Live Feeds
        if (typeof OL.fetchLiveGmailMessages === 'function') OL.fetchLiveGmailMessages();
        if (typeof OL.fetchLiveGoogleCalendar === 'function') OL.fetchLiveGoogleCalendar();
    }
};

OL.fetchLiveGmailMessages = async function() {
    if (OL.commTabState.loading) return; // Prevent concurrent loops
    OL.commTabState.loading = true;

    try {
        const response = await fetch("https://kexnnpwjerrnsmifauuo.supabase.co/functions/v1/get-gmail-messages");

        if (response.status === 401) {
            // Token expired and refresh failed — flip back to "disconnected" so
            // the Connect button reappears instead of silently doing nothing.
            updateAndSync(() => {
                if (state.master?.communications?.gmail) state.master.communications.gmail.connected = false;
                if (state.master) state.master.googleConnected = false;
            });
            OL.renderBusinessCommunications();
            return;
        }

        if (!response.ok) {
            console.warn("Gmail function endpoint not available yet (HTTP " + response.status + ")");
            return;
        }

        const data = await response.json();
        if (data.threads) {
            updateAndSync(() => {
                if (!state.master) state.master = {};
                if (!state.master.communications) state.master.communications = {};
                state.master.communications.threads = data.threads;
            });
            OL.renderBusinessCommunications(); // Only re-render on success!
        }
    } catch (err) {
        console.error("Error fetching Gmail messages:", err);
    } finally {
        OL.commTabState.loading = false;
    }
};

OL.disconnectGmailAccount = function() {
    if (!confirm("Disconnect Google Account?")) return;
    updateAndSync(() => {
        if (state.master?.communications?.gmail) {
            state.master.communications.gmail.connected = false;
            state.master.communications.threads = [];
        }
    });
    OL.renderBusinessCommunications();
};

window.OL.renderBusinessCommunications = OL.renderBusinessCommunications;
