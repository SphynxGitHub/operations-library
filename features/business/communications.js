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
// FOCUS-PRESERVING RE-RENDER — several search boxes here re-render their
// whole container on every keystroke (oninput), which was wiping the
// input's focus and cursor position after each letter typed. This
// remembers which element (by id) had focus and where the cursor was,
// runs the render, then restores both — so typing feels normal again.
// -------------------------------------------------------------
OL.reRenderPreservingFocus = function(renderFn) {
    const active = document.activeElement;
    const id = active && active.id;
    const start = active && typeof active.selectionStart === 'number' ? active.selectionStart : null;
    const end = active && typeof active.selectionEnd === 'number' ? active.selectionEnd : null;

    renderFn();

    if (!id) return;
    const el = document.getElementById(id);
    if (!el) return;
    el.focus();
    if (start !== null && typeof el.setSelectionRange === 'function') {
        try { el.setSelectionRange(start, end); } catch (e) { /* not a text-selectable input, ignore */ }
    }
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
                    <input type="text" id="comm-search-input" class="modal-input tiny" placeholder="Search communications..." value="${esc(OL.commTabState.query)}" oninput="const v=this.value; OL.reRenderPreservingFocus(() => { OL.commTabState.query = v; OL.renderBusinessCommunications(); });">
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
                            ` : (m.linked_resource_id ? `
                                <span class="pill tiny soft" style="font-size:9px; margin-top:4px; display:inline-flex; align-items:center; gap:3px;"><i data-lucide="database" style="width:9px;height:9px;"></i> ${esc(OL.getLinkedResourceLabel(m))}</span>
                            ` : (m.linked_client_id ? `
                                <span class="pill tiny soft" style="font-size:9px; margin-top:4px; display:inline-flex; align-items:center; gap:3px;"><i data-lucide="folder" style="width:9px;height:9px;"></i> ${esc(state.clients[m.linked_client_id]?.meta?.name || 'Project')}</span>
                            ` : ''))}
                        </div>
                        <div class="tiny muted monospace text-right">${m.date ? new Date(m.date).toLocaleDateString() : ''}</div>
                        <div style="display:flex; gap:6px; justify-content:flex-end;">
                            ${m.archived ? `
                                <button class="btn tiny soft" title="Move back to inbox" onclick="event.stopPropagation(); OL.unarchiveGmailMessage('${m.id}')"><i data-lucide="inbox" style="width:11px;height:11px;"></i></button>
                            ` : `
                                <button class="btn tiny soft" title="Archive" onclick="event.stopPropagation(); OL.archiveGmailMessage('${m.id}')"><i data-lucide="archive" style="width:11px;height:11px;"></i></button>
                            `}
                            <button class="btn tiny soft" title="Link to project/resource/task" onclick="event.stopPropagation(); OL.openGmailMessageModal('${m.id}')"><i data-lucide="link" style="width:11px;height:11px;"></i></button>
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

OL.getLinkedResourceLabel = function(m) {
    const client = m.linked_client_id ? state.clients[m.linked_client_id] : null;
    const resource = client?.projectData?.localResources?.find(r => r.id === m.linked_resource_id);
    return resource ? resource.name : 'Linked resource';
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
    // Guard against re-processing: renderBusinessCommunications calls this on
    // every render, and fetchLiveGmailMessages/fetchLiveGoogleCalendar both
    // re-render when they finish — so without a one-time guard, and combined
    // with the hash-cleanup bug below, this was firing an infinite sync loop.
    if (OL._googleAuthReturnHandled) return;

    const urlParams = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.split('?')[1] || '');

    const isConnected = urlParams.get('connected') === 'true' || hashParams.get('connected') === 'true';

    if (isConnected) {
        OL._googleAuthReturnHandled = true;

        updateAndSync(() => {
            if (!state.master) state.master = {};
            if (!state.master.communications) state.master.communications = {};
            if (!state.master.communications.gmail) state.master.communications.gmail = {};

            state.master.communications.gmail.connected = true;
            state.master.googleConnected = true;
        });

        // Clean the address bar without reloading. The redirect puts
        // "connected=true" INSIDE the hash (e.g. "#/business/communications
        // ?connected=true"), not in the page's real query string — stripping
        // only window.location.search (the old behavior) left it sitting in
        // the hash forever, which is what caused the loop above.
        const hashPath = window.location.hash.split('?')[0];
        window.history.replaceState({}, document.title, window.location.pathname + hashPath);

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
        .select('id, sender, subject, snippet, date, linked_client_id, linked_task_id, linked_resource_id, archived, participants')
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

    await OL.autoLinkGmailMessagesToTasks();
};

// -------------------------------------------------------------
// AUTO-LINK TO TASK — an email is already matched to a client at import
// time (server-side, via that project's Team tab emails — see
// supabase/functions/get-gmail-messages). This goes one step further: if
// exactly one OPEN task in that client is assigned to someone whose email
// appears among the message's participants (From/To/Cc), link the email
// to that task automatically. Zero or multiple candidate tasks are left
// alone for manual linking via the existing "Link to Task" button —
// ambiguous matches never get guessed.
// -------------------------------------------------------------
OL.autoLinkGmailMessagesToTasks = async function() {
    const threads = state.master?.communications?.threads || [];
    const candidates = threads.filter(m => m.linked_client_id && !m.linked_task_id && !m.archived && (m.participants || []).length);
    if (!candidates.length) return;

    const updates = [];
    for (const m of candidates) {
        const client = state.clients?.[m.linked_client_id];
        if (!client) continue;

        const emailByAssignee = OL.buildAssigneeEmailMap(client);
        const participants = (m.participants || []).map(p => p.toLowerCase());

        const openTasks = (client.projectData?.clientTasks || []).filter(t => t.status !== 'Done');
        const matches = openTasks.filter(t => {
            const assigneeEmail = emailByAssignee[(t.assignee || '').toLowerCase()];
            return assigneeEmail && participants.includes(assigneeEmail);
        });

        if (matches.length === 1) {
            const matchedResource = OL._findResourceForTask(m.linked_client_id, matches[0]);
            updates.push({ id: m.id, taskId: matches[0].id, resourceId: matchedResource ? matchedResource.id : null });
        }
    }

    if (!updates.length) return;

    await Promise.all(updates.map(u =>
        db.from('gmail_messages').update({ linked_task_id: u.taskId, linked_resource_id: u.resourceId }).eq('id', u.id)
    ));

    // Reflect immediately so the caller's next render shows the link
    // without needing a second round-trip.
    updates.forEach(u => {
        const m = threads.find(t => t.id === u.id);
        if (m) { m.linked_task_id = u.taskId; m.linked_resource_id = u.resourceId; }
    });
};

// Lowercased assignee-name -> email, drawn from the same two rosters the
// assignee picker itself uses (OL.openEditTaskAssigneeDropdown): the
// internal Sphynx team, and this client's own Team tab.
OL.buildAssigneeEmailMap = function(client) {
    const map = {};
    (state.master?.sphynxTeam || []).forEach(m => {
        if (m.name && m.email) map[m.name.toLowerCase()] = m.email.toLowerCase();
    });
    const clientTeam = client?.projectData?.team || client?.projectData?.teamMembers || [];
    clientTeam.forEach(m => {
        if (typeof m === 'string' || !m.name || !m.email) return;
        map[m.name.toLowerCase()] = m.email.toLowerCase();
    });
    return map;
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

// -------------------------------------------------------------
// AUTO-SYNC — periodically re-runs the same sync fetchLiveGmailMessages()
// does, so the feed updates without a manual "Sync Gmail" click while a
// tab is open. Only fires while Gmail is connected, and skips a tick if a
// sync (manual or auto) is already in flight. Complements the server-side
// pg_cron job (see supabase/migrations/auto_sync_cron.sql), which keeps
// gmail_messages fresh even when no tab is open at all.
// -------------------------------------------------------------
OL._gmailAutoSyncTimer = null;
OL.startGmailAutoSync = function(intervalMs = 5 * 60 * 1000) {
    if (OL._gmailAutoSyncTimer) return; // already running, don't stack timers
    OL._gmailAutoSyncTimer = setInterval(() => {
        const isConnected = state.master?.communications?.gmail?.connected || state.master?.googleConnected || false;
        if (!isConnected || OL.commTabState.loading) return;
        OL.fetchLiveGmailMessages();
    }, intervalMs);
};

OL.stopGmailAutoSync = function() {
    if (OL._gmailAutoSyncTimer) clearInterval(OL._gmailAutoSyncTimer);
    OL._gmailAutoSyncTimer = null;
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
// Defensive cleanup for already-imported rows: extractPlainTextBody() in
// get-gmail-messages used to let raw HTML source through for single-part
// text/html messages (Calendly notifications and similar). That's fixed
// server-side for anything synced going forward, but emails already sitting
// in the table still have raw HTML baked into their stored body — this
// strips tags/entities client-side as a fallback so old rows render
// correctly too, without needing a full resync.
OL._looksLikeHtml = function(text) {
    return /<[a-z][\s\S]*>/i.test(text || '');
};

OL._stripHtmlForPreview = function(text) {
    if (!OL._looksLikeHtml(text)) return text || '';
    const tmp = document.createElement('div');
    tmp.innerHTML = text;
    return (tmp.textContent || tmp.innerText || '').replace(/\s+/g, ' ').trim();
};

OL.openGmailMessageModal = async function(id) {
    const { data: m, error } = await db.from('gmail_messages').select('*').eq('id', id).single();
    if (error || !m) { alert('Could not load that email.'); return; }

    OL._gmailLinkState = {
        emailId: id,
        sender: m.sender || '', // kept for the "add sender as team member?" prompt on manual link
        clientId: m.linked_client_id || '',
        resourceId: m.linked_resource_id || '',
        taskId: m.linked_task_id || '',
        eventId: m.linked_event_id || '',
        clientQuery: '',
        resourceQuery: '',
        taskQuery: '',
        eventQuery: '',
        // 🚀 THE FIX: lists stay hidden until the search box is actually
        // focused, instead of dumping every project/resource/task/event on
        // screen immediately.
        clientFocused: false,
        resourceFocused: false,
        taskFocused: false,
        eventFocused: false,
        eventResults: [], // live Supabase search results (events aren't all loaded client-side)
        creatingTask: false,
        newTaskTitle: ''
    };

    const html = `
        <div class="modal-head">
            <div class="modal-title-text">✉️ ${esc(m.subject || 'No Subject')}</div>
            <button class="btn small soft" onclick="OL.closeModal()">Close</button>
        </div>
        <div class="modal-body" style="max-width:900px; width:100%;">
            <div class="tiny muted" style="margin-bottom:14px; display:flex; flex-direction:column; gap:2px;">
                <div><strong>From:</strong> ${esc(m.sender)}</div>
                <div><strong>Date:</strong> ${m.date ? new Date(m.date).toLocaleString() : 'Unknown'}</div>
            </div>

            <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:16px;">
                ${m.archived ? `
                    <button class="btn tiny soft" onclick="OL.unarchiveGmailMessage('${m.id}'); OL.closeModal();">Move Back to Inbox</button>
                ` : `
                    <button class="btn tiny soft" onclick="OL.archiveGmailMessage('${m.id}'); OL.closeModal();">Archive</button>
                `}
            </div>

            <div style="display:grid; grid-template-columns: 1.4fr 1fr; gap:24px; align-items:start;">
                <div style="white-space:pre-wrap; line-height:1.6; font-size:13px; max-height:460px; overflow:auto; border-top:1px solid var(--line); padding-top:14px; min-width:0;">
                    ${esc(OL._stripHtmlForPreview(m.body) || m.snippet || 'No preview available for this message.')}
                </div>

                <div style="border-left:1px solid var(--line); padding-left:20px; min-width:0;">
                    <label class="bold tiny uppercase muted" style="display:block; margin-bottom:8px;">
                        <i data-lucide="link" style="width:12px;height:12px;vertical-align:sub;"></i> Link to Project / Resource / Task / Event
                    </label>
                    <div id="gmail-link-body"></div>
                </div>
            </div>
        </div>
    `;
    OL._gmailLinkSelectedEvent = null; // resolved just below if this email already has a linked event

    openModal(html);
    OL.renderGmailLinkStep();

    if (m.linked_event_id) {
        const { data: evt } = await db.from('calendar_events').select('id, title, start, description').eq('id', m.linked_event_id).maybeSingle();
        if (evt && OL._gmailLinkState?.emailId === id) {
            OL._gmailLinkSelectedEvent = evt;
            OL.renderGmailLinkStep();
        }
    }
};
window.OL.openGmailMessageModal = OL.openGmailMessageModal;

// -------------------------------------------------------------
// LINK TO PROJECT / RESOURCE / TASK — three independent selections,
// rendered inline in the email modal above (not a separate modal).
// Picking a Resource or a Task (searchable across all clients if no
// project is chosen yet) auto-fills the Project. Picking a Task also
// auto-fills Resource by matching the task's resourceName against that
// project's resource list. Picking Project alone doesn't touch the other
// two. Changing Project clears Resource/Task (they belong to whichever
// project was previously selected).
// -------------------------------------------------------------
OL._allClientResourcesFlat = function() {
    return Object.values(state.clients || {}).flatMap(c =>
        (c.projectData?.localResources || []).map(r => ({ ...r, _clientId: c.id, _clientName: c.meta?.name || 'Unnamed' }))
    );
};

OL._allClientTasksFlat = function() {
    return Object.values(state.clients || {}).flatMap(c =>
        (c.projectData?.clientTasks || []).map(t => ({ ...t, _clientId: c.id, _clientName: c.meta?.name || 'Unnamed' }))
    );
};

// Best-effort match of a task's resourceName against a project's actual
// resource list — same convention OL.getDashboardMasterTasks/tasks.js
// already use for resourceName (a free-text label, not a foreign key).
OL._findResourceForTask = function(clientId, task) {
    const label = (task?.resourceName || task?.category || '').trim().toLowerCase();
    if (!label) return null;
    const client = state.clients?.[clientId];
    const resources = client?.projectData?.localResources || [];
    return resources.find(r => (r.name || '').trim().toLowerCase() === label) || null;
};

OL.renderGmailLinkStep = function() {
    const st = OL._gmailLinkState;
    const container = document.getElementById('gmail-link-body');
    if (!container || !st) return;

    const selectedClient = st.clientId ? state.clients[st.clientId] : null;

    // ---- Project ----
    const clientQuery = (st.clientQuery || '').trim().toLowerCase();
    const clients = Object.values(state.clients || {});
    const filteredClients = clientQuery
        ? clients.filter(c => (c.meta?.name || '').toLowerCase().includes(clientQuery))
        : clients;

    // ---- Resource (scoped to project if one's picked, else global) ----
    const resourceQuery = (st.resourceQuery || '').trim().toLowerCase();
    const resourcePool = selectedClient
        ? (selectedClient.projectData?.localResources || []).map(r => ({ ...r, _clientId: st.clientId, _clientName: selectedClient.meta?.name }))
        : OL._allClientResourcesFlat();
    const filteredResources = resourceQuery
        ? resourcePool.filter(r => (r.name || '').toLowerCase().includes(resourceQuery))
        : resourcePool;
    const selectedResource = st.resourceId
        ? (selectedClient?.projectData?.localResources || []).find(r => r.id === st.resourceId)
            || OL._allClientResourcesFlat().find(r => r.id === st.resourceId)
        : null;

    // ---- Task (scoped to project if one's picked, else global) ----
    const taskQuery = (st.taskQuery || '').trim().toLowerCase();
    const taskPool = selectedClient
        ? (selectedClient.projectData?.clientTasks || []).map(t => ({ ...t, _clientId: st.clientId, _clientName: selectedClient.meta?.name }))
        : OL._allClientTasksFlat();
    const filteredTasks = taskQuery
        ? taskPool.filter(t => (t.title || t.name || '').toLowerCase().includes(taskQuery))
        : taskPool;
    const selectedTask = st.taskId
        ? (selectedClient?.projectData?.clientTasks || []).find(t => t.id === st.taskId)
            || OL._allClientTasksFlat().find(t => t.id === st.taskId)
        : null;

    // ---- Event (not all loaded client-side — searched live against Supabase
    // by OL.setGmailLinkEventQuery below; st.eventResults holds the latest hits) ----
    const selectedEvent = st.eventId ? OL._gmailLinkSelectedEvent : null;

    const canLink = !!(st.clientId || st.resourceId || st.taskId || st.eventId);

    container.innerHTML = `
        <div style="margin-bottom:14px;">
            <label class="tiny muted bold" style="display:block; margin-bottom:4px;">Project</label>
            ${selectedClient ? `
                <div style="display:flex; align-items:center; justify-content:space-between; padding:8px 10px; background:rgba(var(--accent-rgb), 0.06); border:1px solid var(--accent); border-radius:6px;">
                    <span class="tiny bold">${esc(selectedClient.meta?.name || 'Unnamed')}</span>
                    <button class="btn tiny soft" onclick="OL.setGmailLinkClient('')">Change</button>
                </div>
            ` : `
                <input type="text" id="gmail-link-client-search" class="modal-input tiny" placeholder="Search projects..." value="${esc(st.clientQuery || '')}"
                       onfocus="OL.setGmailLinkFocus('clientFocused', true)" oninput="OL.setGmailLinkClientQuery(this.value)">
                ${st.clientFocused ? `
                    <div style="max-height:140px; overflow:auto; margin-top:6px; display:grid; gap:4px;">
                        ${filteredClients.length ? filteredClients.map(c => `
                            <div class="tiny" style="padding:7px 10px; border:1px solid var(--line); border-radius:6px; cursor:pointer;" onmousedown="OL.setGmailLinkClient('${c.id}')">${esc(c.meta?.name || 'Unnamed')}</div>
                        `).join('') : `<div class="tiny muted" style="padding:8px;">No matching projects.</div>`}
                    </div>
                ` : ''}
            `}
        </div>

        <div style="margin-bottom:14px;">
            <label class="tiny muted bold" style="display:block; margin-bottom:4px;">Resource / Deliverable</label>
            ${selectedResource ? `
                <div style="display:flex; align-items:center; justify-content:space-between; padding:8px 10px; background:rgba(var(--accent-rgb), 0.06); border:1px solid var(--accent); border-radius:6px;">
                    <span class="tiny bold">${esc(selectedResource.name)}${!selectedClient ? ` <span class="pill tiny soft" style="font-size:9px;">${esc(selectedResource._clientName || '')}</span>` : ''}</span>
                    <button class="btn tiny soft" onclick="OL.setGmailLinkResource('')">Change</button>
                </div>
            ` : `
                <input type="text" id="gmail-link-resource-search" class="modal-input tiny" placeholder="Search resources...${selectedClient ? '' : ' (all projects)'}" value="${esc(st.resourceQuery || '')}"
                       onfocus="OL.setGmailLinkFocus('resourceFocused', true)" oninput="OL.setGmailLinkResourceQuery(this.value)">
                ${st.resourceFocused ? `
                    <div style="max-height:140px; overflow:auto; margin-top:6px; display:grid; gap:4px;">
                        ${filteredResources.length ? filteredResources.map(r => `
                            <div class="tiny" style="padding:7px 10px; border:1px solid var(--line); border-radius:6px; cursor:pointer; display:flex; justify-content:space-between; gap:8px;" onmousedown="OL.setGmailLinkResource('${r.id}', '${r._clientId}')">
                                <span>${esc(r.name)}</span>
                                ${!selectedClient ? `<span class="pill tiny soft" style="font-size:9px; flex-shrink:0;">${esc(r._clientName || '')}</span>` : ''}
                            </div>
                        `).join('') : `<div class="tiny muted" style="padding:8px;">No matching resources.</div>`}
                    </div>
                ` : ''}
            `}
        </div>

        <div style="margin-bottom:14px;">
            <label class="tiny muted bold" style="display:block; margin-bottom:4px;">Task</label>
            ${selectedTask ? `
                <div style="display:flex; align-items:center; justify-content:space-between; padding:8px 10px; background:rgba(var(--accent-rgb), 0.06); border:1px solid var(--accent); border-radius:6px;">
                    <span class="tiny bold">${esc(selectedTask.title || selectedTask.name)}${!selectedClient ? ` <span class="pill tiny soft" style="font-size:9px;">${esc(selectedTask._clientName || '')}</span>` : ''}</span>
                    <button class="btn tiny soft" onclick="OL.setGmailLinkTask('')">Change</button>
                </div>
            ` : `
                <input type="text" id="gmail-link-task-search" class="modal-input tiny" placeholder="Search tasks...${selectedClient ? '' : ' (all projects)'}" value="${esc(st.taskQuery || '')}"
                       onfocus="OL.setGmailLinkFocus('taskFocused', true)" oninput="OL.setGmailLinkTaskQuery(this.value)">
                ${st.taskFocused ? `
                    <div style="max-height:140px; overflow:auto; margin-top:6px; display:grid; gap:4px;">
                        ${filteredTasks.length ? filteredTasks.map(t => `
                            <div class="tiny" style="padding:7px 10px; border:1px solid var(--line); border-radius:6px; cursor:pointer; display:flex; justify-content:space-between; gap:8px;" onmousedown="OL.setGmailLinkTask('${t.id}', '${t._clientId}')">
                                <span>${esc(t.title || t.name)}</span>
                                ${!selectedClient ? `<span class="pill tiny soft" style="font-size:9px; flex-shrink:0;">${esc(t._clientName || '')}</span>` : ''}
                            </div>
                        `).join('') : `<div class="tiny muted" style="padding:8px;">No matching tasks.</div>`}
                    </div>

                    ${selectedClient ? (st.creatingTask ? `
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
                    `) : `<div class="tiny muted" style="margin-top:6px;">Pick a project first to create a new task.</div>`}
                ` : ''}
            `}
        </div>

        <div style="margin-bottom:16px;">
            <label class="tiny muted bold" style="display:block; margin-bottom:4px;">Event</label>
            ${selectedEvent ? `
                <div style="display:flex; align-items:center; justify-content:space-between; padding:8px 10px; background:rgba(var(--accent-rgb), 0.06); border:1px solid var(--accent); border-radius:6px;">
                    <span class="tiny bold">${esc(selectedEvent.title)}${selectedEvent.start ? ` <span class="tiny muted">· ${esc(new Date(selectedEvent.start).toLocaleDateString())}</span>` : ''}</span>
                    <button class="btn tiny soft" onclick="OL.setGmailLinkEvent('')">Change</button>
                </div>
            ` : `
                <input type="text" id="gmail-link-event-search" class="modal-input tiny" placeholder="Search calendar events..." value="${esc(st.eventQuery || '')}"
                       onfocus="OL.setGmailLinkFocus('eventFocused', true)" oninput="OL.setGmailLinkEventQuery(this.value)">
                ${st.eventFocused ? `
                    <div style="max-height:140px; overflow:auto; margin-top:6px; display:grid; gap:4px;">
                        ${st.eventResults.length ? st.eventResults.map(e => `
                            <div class="tiny" style="padding:7px 10px; border:1px solid var(--line); border-radius:6px; cursor:pointer;" onmousedown="OL.setGmailLinkEvent('${esc(e.id).replace(/'/g, "\\'")}')">
                                <div>${esc(e.title)}</div>
                                ${e.start ? `<div class="tiny muted" style="margin-top:1px;">${esc(new Date(e.start).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }))}</div>` : ''}
                            </div>
                        `).join('') : `<div class="tiny muted" style="padding:8px;">${(st.eventQuery || '').trim() ? 'No matching events.' : 'Type to search events...'}</div>`}
                    </div>
                ` : ''}
            `}
        </div>

        <div style="display:flex; justify-content:flex-end; gap:10px;">
            ${(st.clientId || st.resourceId || st.taskId || st.eventId) ? `<button class="btn small danger" onclick="OL.unlinkGmailMessage()">Unlink</button>` : ''}
            <button class="btn small primary" onclick="OL.saveGmailLink()" style="font-weight:bold;" ${!canLink ? 'disabled' : ''}>Save Link</button>
        </div>
    `;
    if (window.lucide) lucide.createIcons();
};

// Shared by all four search boxes — flips the corresponding *Focused flag
// so its results list appears, without touching the query itself.
OL.setGmailLinkFocus = function(flagName, value) {
    if (OL._gmailLinkState[flagName] === value) return; // already showing — don't re-render mid-keystroke
    OL._gmailLinkState[flagName] = value;
    OL.renderGmailLinkStep();
};

OL.setGmailLinkClientQuery = function(value) {
    OL.reRenderPreservingFocus(() => {
        OL._gmailLinkState.clientQuery = value;
        OL._gmailLinkState.clientFocused = true;
        OL.renderGmailLinkStep();
    });
};

OL.setGmailLinkResourceQuery = function(value) {
    OL.reRenderPreservingFocus(() => {
        OL._gmailLinkState.resourceQuery = value;
        OL._gmailLinkState.resourceFocused = true;
        OL.renderGmailLinkStep();
    });
};

OL.setGmailLinkTaskQuery = function(value) {
    OL.reRenderPreservingFocus(() => {
        OL._gmailLinkState.taskQuery = value;
        OL._gmailLinkState.taskFocused = true;
        OL.renderGmailLinkStep();
    });
};

// Events aren't all loaded client-side (see OL.loadCalendarEvents — it's
// paginated/filtered), so this searches Supabase directly rather than
// filtering an in-memory pool like the other three. Debounced since it's
// a live query per keystroke otherwise.
OL.setGmailLinkEventQuery = function(value) {
    OL.reRenderPreservingFocus(() => {
        OL._gmailLinkState.eventQuery = value;
        OL._gmailLinkState.eventFocused = true;
        OL.renderGmailLinkStep();
    });

    clearTimeout(OL._gmailLinkEventSearchTimer);
    const q = (value || '').trim();
    if (!q) { OL._gmailLinkState.eventResults = []; OL.renderGmailLinkStep(); return; }

    OL._gmailLinkEventSearchTimer = setTimeout(async () => {
        const { data, error } = await db.from('calendar_events')
            .select('id, title, start, description')
            .ilike('title', `%${q}%`)
            .order('start', { ascending: false })
            .limit(20);
        if (error) { console.error('Event search failed:', error.message); return; }
        // Query may have moved on while this was in flight — only apply if still current.
        if ((OL._gmailLinkState.eventQuery || '').trim() === q) {
            OL._gmailLinkState.eventResults = data || [];
            OL.renderGmailLinkStep();
        }
    }, 300);
};

// Changing the project invalidates any resource/task picked under the
// previous one, so both get cleared.
OL.setGmailLinkClient = function(id) {
    OL._gmailLinkState.clientId = id;
    OL._gmailLinkState.clientFocused = false;
    OL._gmailLinkState.resourceId = '';
    OL._gmailLinkState.resourceQuery = '';
    OL._gmailLinkState.resourceFocused = false;
    OL._gmailLinkState.taskId = '';
    OL._gmailLinkState.taskQuery = '';
    OL._gmailLinkState.taskFocused = false;
    OL._gmailLinkState.creatingTask = false;
    OL.renderGmailLinkStep();
};

// Picking a resource auto-fills Project if it wasn't already set —
// Task is left alone (a resource doesn't imply one specific task).
OL.setGmailLinkResource = function(id, clientId) {
    OL._gmailLinkState.resourceId = id;
    OL._gmailLinkState.resourceFocused = false;
    if (id && clientId && !OL._gmailLinkState.clientId) {
        OL._gmailLinkState.clientId = clientId;
    }
    OL.renderGmailLinkStep();
};

// Picking a task auto-fills Project (if unset) and Resource, by matching
// the task's resourceName against that project's resource list.
OL.setGmailLinkTask = function(id, clientId) {
    OL._gmailLinkState.taskId = id;
    OL._gmailLinkState.taskFocused = false;
    if (!id) { OL.renderGmailLinkStep(); return; }

    const resolvedClientId = OL._gmailLinkState.clientId || clientId;
    if (resolvedClientId && !OL._gmailLinkState.clientId) {
        OL._gmailLinkState.clientId = resolvedClientId;
    }

    const client = state.clients?.[resolvedClientId];
    const task = client?.projectData?.clientTasks?.find(t => t.id === id)
        || OL._allClientTasksFlat().find(t => t.id === id);
    const matchedResource = resolvedClientId && task ? OL._findResourceForTask(resolvedClientId, task) : null;
    if (matchedResource) OL._gmailLinkState.resourceId = matchedResource.id;

    OL.renderGmailLinkStep();
};

// Event is independent of Project/Resource/Task — an email can be tied to
// a specific calendar event without implying a client (e.g. a scheduling
// notification before there's even a project). Looks the event up from the
// last search results rather than round-tripping it through an HTML
// attribute (event titles can contain quotes/apostrophes, which would
// break out of an inline onmousedown string).
OL.setGmailLinkEvent = function(id) {
    OL._gmailLinkState.eventId = id;
    OL._gmailLinkState.eventFocused = false;
    OL._gmailLinkSelectedEvent = id
        ? (OL._gmailLinkState.eventResults || []).find(e => e.id === id) || OL._gmailLinkSelectedEvent
        : null;
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
    if (!st || !(st.clientId || st.resourceId || st.taskId || st.eventId)) return;

    const { error } = await db.from('gmail_messages').update({
        linked_client_id: st.clientId || null,
        linked_resource_id: st.resourceId || null,
        linked_task_id: st.taskId || null,
        linked_event_id: st.eventId || null
        // 🚀 THE FIX: linking no longer auto-archives. Archiving and
        // linking are separate decisions — use the Archive button for that.
    }).eq('id', st.emailId);

    if (error) { alert('Failed to save link: ' + error.message); return; }

    // Manually linking to a project (as opposed to auto-linking, which
    // never runs this function at all) is a signal the sender belongs on
    // that project's Team tab — offer to add them if they're not already
    // there, so future emails from the same address auto-link too.
    if (st.clientId) await OL._maybePromptAddSenderToTeam(st.clientId, st.sender);

    OL.closeModal();
    await OL.loadGmailFeed();
    OL.renderBusinessCommunications();
};

// Parses a Gmail "From" header value like `Name <name@domain.com>` (or a
// bare address with no display name) into { name, email }.
OL._parseSenderHeader = function(sender) {
    const raw = (sender || '').trim();
    const match = raw.match(/^(.*?)<([^<>]+)>\s*$/);
    if (match) {
        const name = match[1].trim().replace(/^"|"$/g, '');
        const email = match[2].trim().toLowerCase();
        return { name: name || email, email };
    }
    // No angle brackets — either a bare address, or just a display name
    // with no address at all (nothing to add in that case).
    const bareEmailMatch = raw.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
    return bareEmailMatch ? { name: bareEmailMatch[0], email: bareEmailMatch[0].toLowerCase() } : null;
};

OL._maybePromptAddSenderToTeam = async function(clientId, senderHeader) {
    const parsed = OL._parseSenderHeader(senderHeader);
    if (!parsed?.email) return; // couldn't find an address to offer

    const client = state.clients?.[clientId];
    if (!client) return;
    if (!client.projectData) client.projectData = {};
    const members = client.projectData.teamMembers || [];
    const alreadyOnTeam = members.some(m => (m.email || '').trim().toLowerCase() === parsed.email);
    if (alreadyOnTeam) return;

    const clientName = client.meta?.name || 'this project';
    const add = confirm(`Add ${parsed.name}${parsed.name !== parsed.email ? ` (${parsed.email})` : ''} to ${clientName}'s Team tab?\n\nThis lets future emails and calendar events from this address auto-link to the project.`);
    if (!add) return;

    await updateAndSync(() => {
        if (!client.projectData.teamMembers) client.projectData.teamMembers = [];
        client.projectData.teamMembers.push({
            id: 'tm-' + Date.now(),
            name: parsed.name,
            email: parsed.email,
            roles: [],
            createdDate: new Date().toISOString()
        });
    }, clientId);
};

OL.unlinkGmailMessage = async function() {
    const st = OL._gmailLinkState;
    if (!st) return;

    const { error } = await db.from('gmail_messages').update({ linked_client_id: null, linked_resource_id: null, linked_task_id: null, linked_event_id: null }).eq('id', st.emailId);
    if (error) { alert('Failed to unlink: ' + error.message); return; }

    OL.closeModal();
    await OL.loadGmailFeed();
    OL.renderBusinessCommunications();
};

window.OL.renderBusinessCommunications = OL.renderBusinessCommunications;
