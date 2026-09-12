import { esc, uid, state, db, updateAndSync, getBusinessScopedClients } from '../../core/data.js';

const GMAIL_FEED_LIMIT = 150;

OL.commTabState = {
    activeTab: 'feed', // 'feed' | 'gmail' | 'quo'
    query: '',
    loading: false,
    showArchived: false,
    feedLoadedOnce: false
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

    // Auto-load the feed from Supabase once per session if connected and not yet loaded
    const isConnected = commsData.gmail?.connected || state.master?.googleConnected || false;
    if (isConnected && !OL.commTabState.feedLoadedOnce && !OL.commTabState.loading) {
        OL.commTabState.feedLoadedOnce = true;
        OL.loadGmailFeed().then(() => OL.renderBusinessCommunications());
    }

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
// 1. UNIFIED CLIENT FEED VIEW (GMAIL MESSAGES SYNCED INTO SUPABASE)
// -------------------------------------------------------------
OL.renderCommFeedView = function(commsData, clients) {
    const isConnected = commsData.gmail?.connected || state.master?.googleConnected || false;
    const allThreads = commsData.threads || [];
    const q = OL.commTabState.query.trim().toLowerCase();
    const threads = q ? allThreads.filter(m =>
        (m.sender || '').toLowerCase().includes(q) ||
        (m.subject || '').toLowerCase().includes(q) ||
        (m.snippet || '').toLowerCase().includes(q)
    ) : allThreads;

    return `
        <div class="card" style="padding: 20px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 20px; border-bottom: 1px solid var(--line); padding-bottom: 15px; flex-wrap:wrap; gap:10px;">
                <div style="display:flex; gap:10px; flex:1; max-width: 350px;">
                    <i data-lucide="search" style="width:16px;height:16px;color:var(--muted); margin-top:6px;"></i>
                    <input type="text" class="modal-input tiny" placeholder="Search communications..." value="${esc(OL.commTabState.query)}" oninput="OL.commTabState.query = this.value; OL.renderBusinessCommunications();">
                </div>
                <div style="display:flex; gap:12px; align-items:center;">
                    ${isConnected ? `
                        <button class="btn tiny ${OL.commTabState.showArchived ? 'primary' : 'soft'}" onclick="OL.toggleShowArchivedGmail()">
                            <i data-lucide="archive" style="width:12px;height:12px;"></i> ${OL.commTabState.showArchived ? 'Showing Archived' : 'Archived'}
                        </button>
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
                        <div>${isConnected ? (OL.commTabState.showArchived ? 'No archived emails.' : 'No recent client emails found. Click "Sync Gmail" above.') : 'Connect your Google account under Gmail Settings to stream real emails.'}</div>
                    </div>
                ` : threads.map(m => `
                    <div style="display:grid; grid-template-columns: 100px 200px 1fr 120px 130px; gap: 12px; padding: 12px; background: rgba(255,255,255,0.02); border: 1px solid var(--line); border-radius: 6px; align-items:center;">
                        <div>
                            <span class="pill tiny accent" style="font-weight:bold;">✉️ Gmail</span>
                        </div>
                        <div style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; cursor:pointer;" onclick="OL.openGmailMessageModal('${m.id}')"><strong>${esc(m.sender)}</strong></div>
                        <div style="overflow:hidden; cursor:pointer;" onclick="OL.openGmailMessageModal('${m.id}')">
                            <div style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(m.subject)}</div>
                            ${m.snippet ? `<div class="tiny muted" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(m.snippet)}</div>` : ''}
                            ${m.linked_task_id ? `
                                <span class="pill tiny soft" style="font-size:9px; margin-top:4px; display:inline-flex; align-items:center; gap:3px;"><i data-lucide="link" style="width:9px;height:9px;"></i> ${esc(OL.getLinkedTaskLabel(m))}</span>
                            ` : (m.linked_client_id ? `
                                <span class="pill tiny soft" style="font-size:9px; margin-top:4px; display:inline-flex; align-items:center; gap:3px;"><i data-lucide="folder" style="width:9px;height:9px;"></i> ${esc(state.clients[m.linked_client_id]?.meta?.name || 'Project')}</span>
                            ` : '')}
                        </div>
                        <div class="tiny muted monospace text-right">${m.date ? new Date(m.date).toLocaleDateString() : ''}</div>
                        <div style="display:flex; gap:6px; justify-content:flex-end;">
                            ${m.archived ? `
                                <button class="btn tiny soft" title="Move back to inbox" onclick="event.stopPropagation(); OL.unarchiveGmailMessage('${m.id}')"><i data-lucide="inbox" style="width:11px;height:11px;"></i></button>
                            ` : `
                                <button class="btn tiny soft" title="Archive" onclick="event.stopPropagation(); OL.archiveGmailMessage('${m.id}')"><i data-lucide="archive" style="width:11px;height:11px;"></i></button>
                            `}
                            <button class="btn tiny soft" title="Link to task" onclick="event.stopPropagation(); OL.openGmailLinkPicker('${m.id}')"><i data-lucide="link" style="width:11px;height:11px;"></i></button>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
};

OL.getLinkedTaskLabel = function(m) {
    const client = m.linked_client_id ? state.clients[m.linked_client_id] : null;
    const task = client?.projectData?.clientTasks?.find(t => t.id === m.linked_task_id);
    return task ? (task.title || task.name) : 'Linked task';
};

OL.toggleShowArchivedGmail = function() {
    OL.commTabState.showArchived = !OL.commTabState.showArchived;
    OL.loadGmailFeed().then(() => OL.renderBusinessCommunications());
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

// Loads the feed straight from the gmail_messages table (this is the
// durable store now — nothing Gmail-related lives in the big JSON state
// blob anymore, so this doesn't bloat every save).
OL.loadGmailFeed = async function() {
    const { data, error } = await db
        .from('gmail_messages')
        .select('id, sender, subject, snippet, date, linked_client_id, linked_task_id, archived')
        .eq('archived', OL.commTabState.showArchived)
        .order('date', { ascending: false })
        .limit(GMAIL_FEED_LIMIT);

    if (error) {
        console.error('Failed to load Gmail feed:', error.message);
        return;
    }

    if (!state.master) state.master = {};
    if (!state.master.communications) state.master.communications = {};
    state.master.communications.threads = data || [];
};

// Triggers an actual sync (imports anything new from the inbox into
// gmail_messages), then reloads the feed from the table.
OL.fetchLiveGmailMessages = async function() {
    if (OL.commTabState.loading) return; // Prevent concurrent loops
    OL.commTabState.loading = true;
    OL.renderBusinessCommunications();

    try {
        const response = await fetch("https://kexnnpwjerrnsmifauuo.supabase.co/functions/v1/get-gmail-messages");

        if (response.status === 401) {
            // Token expired and refresh failed — flip back to "disconnected" so
            // the Connect button reappears instead of silently doing nothing.
            updateAndSync(() => {
                if (state.master?.communications?.gmail) state.master.communications.gmail.connected = false;
                if (state.master) state.master.googleConnected = false;
            });
            return;
        }

        if (!response.ok) {
            console.warn("Gmail sync failed (HTTP " + response.status + ")");
            return;
        }

        const syncResult = await response.json();
        console.log(`Gmail sync: ${syncResult.importedCount ?? 0} new of ${syncResult.scannedCount ?? 0} scanned, ${syncResult.labeledCount ?? 0} labeled`);

        await OL.loadGmailFeed();
    } catch (err) {
        console.error("Error syncing Gmail:", err);
    } finally {
        OL.commTabState.loading = false;
        OL.renderBusinessCommunications();
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
    OL.commTabState.feedLoadedOnce = false;
    OL.renderBusinessCommunications();
};

// -------------------------------------------------------------
// ARCHIVE / UNARCHIVE — app-side by default (hides from the feed here).
// Archiving also best-effort removes it from your real Gmail inbox, since
// you said that's fine once you're done with something.
// -------------------------------------------------------------
OL.archiveGmailMessage = async function(id, alsoInGmail = true) {
    const { error } = await db.from('gmail_messages').update({ archived: true }).eq('id', id);
    if (error) { alert('Failed to archive: ' + error.message); return; }

    if (alsoInGmail) {
        fetch("https://kexnnpwjerrnsmifauuo.supabase.co/functions/v1/archive-gmail-message", {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id })
        }).catch(err => console.warn('Could not archive in Gmail (still archived in-app):', err));
    }

    await OL.loadGmailFeed();
    OL.renderBusinessCommunications();
};

OL.unarchiveGmailMessage = async function(id) {
    const { error } = await db.from('gmail_messages').update({ archived: false }).eq('id', id);
    if (error) { alert('Failed to move back to inbox: ' + error.message); return; }
    await OL.loadGmailFeed();
    OL.renderBusinessCommunications();
};

// -------------------------------------------------------------
// READ AN EMAIL — always pulled fresh from Supabase (works from the
// feed list or from a task's "Linked Emails" section either way).
// -------------------------------------------------------------
OL.openGmailMessageModal = async function(id) {
    const { data: m, error } = await db.from('gmail_messages').select('*').eq('id', id).single();
    if (error || !m) { alert('Could not load that email.'); return; }

    const linkLabel = m.linked_task_id ? OL.getLinkedTaskLabel(m) : '';

    const html = `
        <div class="modal-head">
            <div class="modal-title-text">✉️ ${esc(m.subject || 'No Subject')}</div>
            <button class="btn small soft" onclick="OL.closeModal()">Close</button>
        </div>
        <div class="modal-body" style="max-width:650px; width:100%;">
            <div class="tiny muted" style="margin-bottom:14px; display:flex; flex-direction:column; gap:2px;">
                <div><strong>From:</strong> ${esc(m.sender)}</div>
                <div><strong>Date:</strong> ${m.date ? new Date(m.date).toLocaleString() : 'Unknown'}</div>
            </div>

            <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:16px;">
                ${m.linked_task_id ? `
                    <span class="pill tiny soft" style="display:inline-flex; align-items:center; gap:4px;"><i data-lucide="link" style="width:11px;height:11px;"></i> Linked to: ${esc(linkLabel)}</span>
                ` : (m.linked_client_id ? `
                    <span class="pill tiny soft" style="display:inline-flex; align-items:center; gap:4px;"><i data-lucide="folder" style="width:11px;height:11px;"></i> ${esc(state.clients[m.linked_client_id]?.meta?.name || 'Project')} (auto-detected — not linked to a task yet)</span>
                ` : '')}
                <button class="btn tiny soft" onclick="OL.openGmailLinkPicker('${m.id}')">${m.linked_task_id ? 'Change Link' : 'Link to Task'}</button>
                ${m.archived ? `
                    <button class="btn tiny soft" onclick="OL.unarchiveGmailMessage('${m.id}'); OL.closeModal();">Move Back to Inbox</button>
                ` : `
                    <button class="btn tiny soft" onclick="OL.archiveGmailMessage('${m.id}'); OL.closeModal();">Archive</button>
                `}
            </div>

            <div style="white-space:pre-wrap; line-height:1.6; font-size:13px; max-height:420px; overflow:auto; border-top:1px solid var(--line); padding-top:14px;">
                ${esc(m.body || m.snippet || 'No preview available for this message.')}
            </div>
        </div>
    `;
    openModal(html);
    if (window.lucide) lucide.createIcons();
};
window.OL.openGmailMessageModal = OL.openGmailMessageModal;

// -------------------------------------------------------------
// LINK TO TASK
// -------------------------------------------------------------
OL.openGmailLinkPicker = async function(id) {
    const { data: m, error } = await db.from('gmail_messages').select('id, subject, linked_client_id, linked_task_id').eq('id', id).single();
    if (error || !m) { alert('Could not load that email.'); return; }

    OL._gmailLinkState = {
        emailId: id,
        clientId: m.linked_client_id || '',
        taskId: m.linked_task_id || '',
        clientQuery: '',
        taskQuery: '',
        creatingTask: false,
        newTaskTitle: ''
    };

    const html = `
        <div class="modal-head">
            <div class="modal-title-text">🔗 Link "${esc(m.subject || 'Email')}" to a Task</div>
            <button class="btn small soft" onclick="OL.closeModal()">Close</button>
        </div>
        <div class="modal-body" id="gmail-link-body" style="max-width:500px; width:100%;"></div>
    `;
    openModal(html);
    OL.renderGmailLinkStep();
};

OL.renderGmailLinkStep = function() {
    const st = OL._gmailLinkState;
    const container = document.getElementById('gmail-link-body');
    if (!container || !st) return;

    const selectedClient = st.clientId ? state.clients[st.clientId] : null;
    const clientQuery = (st.clientQuery || '').trim().toLowerCase();
    const clients = Object.values(state.clients || {});
    const filteredClients = clientQuery
        ? clients.filter(c => (c.meta?.name || '').toLowerCase().includes(clientQuery))
        : clients;

    const tasks = selectedClient?.projectData?.clientTasks || [];
    const taskQuery = (st.taskQuery || '').trim().toLowerCase();
    const filteredTasks = taskQuery
        ? tasks.filter(t => (t.title || t.name || '').toLowerCase().includes(taskQuery))
        : tasks;
    const selectedTask = st.taskId ? tasks.find(t => t.id === st.taskId) : null;

    container.innerHTML = `
        <div style="margin-bottom:14px;">
            <label class="tiny muted bold" style="display:block; margin-bottom:4px;">Client Project</label>
            ${selectedClient ? `
                <div style="display:flex; align-items:center; justify-content:space-between; padding:8px 10px; background:rgba(var(--accent-rgb), 0.06); border:1px solid var(--accent); border-radius:6px;">
                    <span class="tiny bold">${esc(selectedClient.meta?.name || 'Unnamed')}</span>
                    <button class="btn tiny soft" onclick="OL.setGmailLinkClient('')">Change</button>
                </div>
            ` : `
                <input type="text" class="modal-input tiny" placeholder="Search clients..." value="${esc(st.clientQuery || '')}" oninput="OL.setGmailLinkClientQuery(this.value)">
                <div style="max-height:160px; overflow:auto; margin-top:6px; display:grid; gap:4px;">
                    ${filteredClients.length ? filteredClients.map(c => `
                        <div class="tiny" style="padding:7px 10px; border:1px solid var(--line); border-radius:6px; cursor:pointer;" onclick="OL.setGmailLinkClient('${c.id}')">${esc(c.meta?.name || 'Unnamed')}</div>
                    `).join('') : `<div class="tiny muted" style="padding:8px;">No matching clients.</div>`}
                </div>
            `}
        </div>

        ${selectedClient ? `
        <div style="margin-bottom:16px;">
            <label class="tiny muted bold" style="display:block; margin-bottom:4px;">Task / Deliverable</label>
            ${selectedTask ? `
                <div style="display:flex; align-items:center; justify-content:space-between; padding:8px 10px; background:rgba(var(--accent-rgb), 0.06); border:1px solid var(--accent); border-radius:6px;">
                    <span class="tiny bold">${esc(selectedTask.title || selectedTask.name)}</span>
                    <button class="btn tiny soft" onclick="OL.setGmailLinkTask('')">Change</button>
                </div>
            ` : `
                <input type="text" class="modal-input tiny" placeholder="Search tasks..." value="${esc(st.taskQuery || '')}" oninput="OL.setGmailLinkTaskQuery(this.value)">
                <div style="max-height:160px; overflow:auto; margin-top:6px; display:grid; gap:4px;">
                    ${filteredTasks.length ? filteredTasks.map(t => `
                        <div class="tiny" style="padding:7px 10px; border:1px solid var(--line); border-radius:6px; cursor:pointer;" onclick="OL.setGmailLinkTask('${t.id}')">${esc(t.title || t.name)}</div>
                    `).join('') : `<div class="tiny muted" style="padding:8px;">No matching tasks.</div>`}
                </div>

                ${st.creatingTask ? `
                    <div style="margin-top:10px; padding:10px; border:1px dashed var(--accent); border-radius:6px;">
                        <input type="text" id="gmail-new-task-title" class="modal-input tiny" placeholder="New task title..." value="${esc(st.newTaskTitle || '')}" oninput="OL._gmailLinkState.newTaskTitle = this.value">
                        <div style="display:flex; gap:8px; margin-top:8px; justify-content:flex-end;">
                            <button class="btn tiny soft" onclick="OL.cancelGmailCreateTask()">Cancel</button>
                            <button class="btn tiny primary" onclick="OL.createAndLinkGmailTask()" style="font-weight:bold;">Create &amp; Link</button>
                        </div>
                    </div>
                ` : `
                    <button class="btn tiny soft" style="margin-top:8px; width:100%; display:flex; align-items:center; justify-content:center; gap:6px;" onclick="OL.startGmailCreateTask()">
                        <i data-lucide="plus" style="width:11px;height:11px;"></i> Create New Task
                    </button>
                `}
            `}
        </div>
        ` : ''}

        <div style="display:flex; justify-content:flex-end; gap:10px;">
            ${st.taskId ? `<button class="btn small danger" onclick="OL.unlinkGmailMessage()">Unlink</button>` : ''}
            <button class="btn small primary" onclick="OL.saveGmailLink()" style="font-weight:bold;" ${!st.taskId ? 'disabled' : ''}>Save Link</button>
        </div>
    `;
    if (window.lucide) lucide.createIcons();
};

OL.setGmailLinkClientQuery = function(value) {
    OL._gmailLinkState.clientQuery = value;
    OL.renderGmailLinkStep();
};

OL.setGmailLinkTaskQuery = function(value) {
    OL._gmailLinkState.taskQuery = value;
    OL.renderGmailLinkStep();
};

OL.setGmailLinkClient = function(id) {
    OL._gmailLinkState.clientId = id;
    OL._gmailLinkState.taskId = '';
    OL._gmailLinkState.taskQuery = '';
    OL._gmailLinkState.creatingTask = false;
    OL.renderGmailLinkStep();
};

OL.setGmailLinkTask = function(id) {
    OL._gmailLinkState.taskId = id;
    OL.renderGmailLinkStep();
};

OL.startGmailCreateTask = function() {
    OL._gmailLinkState.creatingTask = true;
    OL._gmailLinkState.newTaskTitle = '';
    OL.renderGmailLinkStep();
    setTimeout(() => document.getElementById('gmail-new-task-title')?.focus(), 0);
};

OL.cancelGmailCreateTask = function() {
    OL._gmailLinkState.creatingTask = false;
    OL.renderGmailLinkStep();
};

OL.createAndLinkGmailTask = async function() {
    const st = OL._gmailLinkState;
    const title = (st.newTaskTitle || '').trim();
    if (!title || !st.clientId) return;

    let newTaskId;
    await updateAndSync(() => {
        const client = state.clients[st.clientId];
        if (!client) return;
        if (!client.projectData) client.projectData = {};
        if (!client.projectData.clientTasks) client.projectData.clientTasks = [];
        newTaskId = uid();
        client.projectData.clientTasks.unshift({
            id: newTaskId,
            title, name: title,
            assignee: 'Sphynx Task',
            loggedHours: 0,
            createdAt: new Date().toISOString()
        });
    }, st.clientId);

    st.taskId = newTaskId;
    st.creatingTask = false;
    await OL.saveGmailLink();
};

OL.saveGmailLink = async function() {
    const st = OL._gmailLinkState;
    if (!st?.taskId) return;

    const { error } = await db.from('gmail_messages').update({
        linked_client_id: st.clientId,
        linked_task_id: st.taskId,
        archived: true // linking means you're done triaging it — out of the inbox feed
    }).eq('id', st.emailId);

    if (error) { alert('Failed to save link: ' + error.message); return; }

    // Best-effort: also archive in real Gmail, since you're fine with that once linked
    fetch("https://kexnnpwjerrnsmifauuo.supabase.co/functions/v1/archive-gmail-message", {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: st.emailId })
    }).catch(err => console.warn('Could not archive in Gmail (still linked + archived in-app):', err));

    OL.closeModal();
    await OL.loadGmailFeed();
    OL.renderBusinessCommunications();
};

OL.unlinkGmailMessage = async function() {
    const st = OL._gmailLinkState;
    if (!st) return;

    const { error } = await db.from('gmail_messages').update({ linked_client_id: null, linked_task_id: null }).eq('id', st.emailId);
    if (error) { alert('Failed to unlink: ' + error.message); return; }

    OL.closeModal();
    await OL.loadGmailFeed();
    OL.renderBusinessCommunications();
};

window.OL.renderBusinessCommunications = OL.renderBusinessCommunications;
