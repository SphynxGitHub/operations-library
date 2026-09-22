//======================= FEATURES / NOTIFICATIONS =======================//
// In-app + email notifications for two event types: a new tagged comment
// (@mention) and a new task assignment. Preferences live per-person on
// their Sphynx team roster entry (state.master.sphynxTeam[i]) so they
// persist the same way everything else on that roster already does.
//
// In-app notifications are NOT a separately stored log — they're computed
// on demand from the same comment/assignment data the task views already
// use (see features/business/tasks.js's mention system), with a
// read-tracking id list per person so "unread" is derivable rather than
// double-stored.
//
// Email delivery has no backend to actually send through yet (this repo
// has no mail-sending endpoint). Rather than pretend to send, matching
// events get queued to state.master.emailNotificationQueue as a visible
// stub — wire OL.notifyEvent()'s queue push to a real sender later.

import { esc, uid, state, db } from '../core/data.js';

function getMyTeamRecord() {
    if (!state.master) state.master = {};
    if (!state.master.sphynxTeam) state.master.sphynxTeam = [];
    const me = state.currentUser;
    if (!me) return null;
    return state.master.sphynxTeam.find(m => m.id === me.id) ||
           state.master.sphynxTeam.find(m => (m.name || '').toLowerCase() === (me.name || '').toLowerCase()) ||
           null;
}

function ensureNotificationPrefs(member) {
    if (!member.notificationPrefs) {
        member.notificationPrefs = {
            inApp: { newComment: true, newAssignment: true },
            email: { newComment: false, newAssignment: true },
            desktop: { newComment: false, newAssignment: false }
        };
    }
    if (!member.notificationPrefs.desktop) {
        member.notificationPrefs.desktop = { newComment: false, newAssignment: false };
    }
    if (!member.readNotificationIds) member.readNotificationIds = [];
    return member.notificationPrefs;
}

export function openNotificationSettingsModal() {
    const member = getMyTeamRecord();
    if (!member) {
        alert("Notification settings are tied to a Sphynx Team roster entry — this login isn't matched to one.");
        return;
    }
    const prefs = ensureNotificationPrefs(member);
    const permission = (typeof Notification !== 'undefined') ? Notification.permission : 'unsupported';

    const row = (label, key) => `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 0; border-bottom:1px solid var(--panel-border);">
            <span class="tiny">${label}</span>
            <div style="display:flex; gap:16px;">
                <label class="tiny muted" style="display:flex; align-items:center; gap:6px; cursor:pointer;">
                    <input type="checkbox" ${prefs.inApp[key] ? 'checked' : ''} onchange="OL.toggleNotificationPref('inApp', '${key}', this.checked)"> In-App
                </label>
                <label class="tiny muted" style="display:flex; align-items:center; gap:6px; cursor:pointer;">
                    <input type="checkbox" ${prefs.email[key] ? 'checked' : ''} onchange="OL.toggleNotificationPref('email', '${key}', this.checked)"> Email
                </label>
                <label class="tiny muted" style="display:flex; align-items:center; gap:6px; cursor:pointer;">
                    <input type="checkbox" ${prefs.desktop[key] ? 'checked' : ''} onchange="OL.toggleNotificationPref('desktop', '${key}', this.checked)"> Desktop
                </label>
            </div>
        </div>
    `;

    const html = `
        <div class="modal-head">
            <div class="modal-title-text">Notification Settings</div>
            <div class="spacer"></div>
            <button class="btn small soft" onclick="OL.closeModal()">Close</button>
        </div>
        <div class="modal-body">
            <p class="tiny muted" style="margin-bottom:6px;">Choose how you want to hear about activity that involves you, ${esc(member.name)}.</p>
            ${row('New tagged comment (@mention)', 'newComment')}
            ${row('New task assigned to you', 'newAssignment')}
            <p class="tiny muted" style="margin-top:14px;">Email delivery isn't wired to a mail sender yet — enabling it queues the message so it's ready once one is connected.</p>
            ${permission === 'unsupported' ? `
                <p class="tiny muted" style="margin-top:6px;">This browser doesn't support desktop notifications.</p>
            ` : permission === 'denied' ? `
                <p class="tiny" style="margin-top:6px; color:#ef4444;">Desktop notifications are blocked in this browser's site settings — allow them there to use this.</p>
            ` : permission === 'default' ? `
                <div style="margin-top:8px;">
                    <button class="btn tiny soft" onclick="OL.requestDesktopNotificationPermission()">Enable browser permission for Desktop alerts</button>
                </div>
            ` : `
                <p class="tiny muted" style="margin-top:6px;">Desktop notifications only fire while this app is open in a browser tab (no permission needed further — it's already granted).</p>
            `}
        </div>
    `;
    openModal(html);
    if (window.lucide) window.lucide.createIcons();
}

export function requestDesktopNotificationPermission() {
    if (typeof Notification === 'undefined') return;
    Notification.requestPermission().then(() => openNotificationSettingsModal());
}

export function toggleNotificationPref(channel, key, value) {
    const member = getMyTeamRecord();
    if (!member) return;
    const prefs = ensureNotificationPrefs(member);
    prefs[channel][key] = value;
    if (channel === 'desktop' && value && typeof Notification !== 'undefined' && Notification.permission === 'default') {
        Notification.requestPermission();
    }
    OL.persist();
}

// ---- computing "my" notifications from source data ----
export function getMyNotifications() {
    const member = getMyTeamRecord();
    const myName = (state.currentUser?.name || '').toLowerCase();
    if (!member || !myName) return [];
    const readIds = new Set(member.readNotificationIds || []);
    const items = [];

    Object.values(state.clients || {}).forEach(client => {
        (client.projectData?.clientTasks || []).forEach(task => {
            (task.comments || []).forEach(c => {
                const mentioned = (c.mentions || []).some(m => (m.name || '').toLowerCase() === myName);
                if (!mentioned) return;
                const id = `comment:${client.id}:${task.id}:${c.id}`;
                items.push({
                    id, type: 'newComment', date: c.date,
                    text: `${c.author || 'Someone'} mentioned you on "${task.title || task.name}"`,
                    clientId: client.id, taskId: task.id,
                    read: readIds.has(id)
                });
            });
            if ((task.assignee || '').toLowerCase() === myName) {
                const id = `assign:${client.id}:${task.id}`;
                items.push({
                    id, type: 'newAssignment', date: task.createdAt || task.dueDate || new Date().toISOString(),
                    text: `You were assigned "${task.title || task.name}"`,
                    clientId: client.id, taskId: task.id,
                    read: readIds.has(id)
                });
            }
        });
    });

    return items.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
}

export function getUnreadNotificationCount() {
    return getMyNotifications().filter(n => !n.read).length;
}

export function markNotificationRead(id) {
    const member = getMyTeamRecord();
    if (!member) return;
    if (!member.readNotificationIds) member.readNotificationIds = [];
    if (!member.readNotificationIds.includes(id)) member.readNotificationIds.push(id);
    OL.persist();
}

export function markAllNotificationsRead() {
    const member = getMyTeamRecord();
    if (!member) return;
    member.readNotificationIds = getMyNotifications().map(n => n.id);
    OL.persist();
    openNotificationsModal();
}

// ---- New / Previously Viewed tabs + type filter (mirrors the dashboard's
// multi-select Types popover — OL.openDashboardTypesPopover in
// features/business/dashboard.js) ----
OL.notificationsPanelState = OL.notificationsPanelState || { tab: 'new', types: ['newComment', 'newAssignment'] };
const NOTIF_TYPE_LABELS = { newComment: 'Comments (mentions)', newAssignment: 'Assignments' };

export function renderNotificationsModalBody() {
    const all = getMyNotifications();
    const st = OL.notificationsPanelState;
    const newCount = all.filter(n => !n.read).length;
    const viewedCount = all.filter(n => n.read).length;
    const filtered = all.filter(n => (st.tab === 'new' ? !n.read : n.read) && st.types.includes(n.type));

    return `
        <div style="display:flex; align-items:center; gap:6px; margin-bottom:10px; border-bottom:1px solid var(--panel-border); padding-bottom:8px;">
            <button class="btn tiny ${st.tab === 'new' ? 'primary' : 'soft'}" onclick="OL.setNotificationsPanelTab('new')">New${newCount ? ` (${newCount})` : ''}</button>
            <button class="btn tiny ${st.tab === 'viewed' ? 'primary' : 'soft'}" onclick="OL.setNotificationsPanelTab('viewed')">Previously Viewed${viewedCount ? ` (${viewedCount})` : ''}</button>
            <div class="spacer"></div>
            <button class="btn tiny soft" onclick="OL.openNotificationTypesPopover(event)">
                <i data-lucide="filter" style="width:11px;height:11px;"></i> Type
            </button>
        </div>
        ${st.tab === 'new' && filtered.length ? `
            <div style="display:flex; justify-content:flex-end; margin-bottom:8px;">
                <button class="btn tiny soft" onclick="OL.markAllNotificationsRead()">Mark all read</button>
            </div>
        ` : ''}
        ${filtered.length ? filtered.map(n => `
            <div onclick="OL.markNotificationRead('${n.id}'); OL.closeModal(); if (typeof OL.openTaskInContext === 'function') OL.openTaskInContext('${n.clientId}', '${n.taskId}');"
                 style="padding:10px; border-radius:8px; margin-bottom:6px; cursor:pointer; background:${n.read ? 'transparent' : 'rgba(var(--accent-rgb),0.08)'}; border:1px solid var(--panel-border);">
                <div class="tiny" style="display:flex; align-items:center; gap:6px;">
                    <i data-lucide="${n.type === 'newComment' ? 'at-sign' : 'user-plus'}" style="width:12px;height:12px;color:var(--accent);"></i>
                    ${esc(n.text)}
                </div>
                <div class="tiny muted" style="margin-top:2px;">${n.date ? esc(new Date(n.date).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })) : ''}</div>
            </div>
        `).join('') : `<p class="tiny muted">${st.tab === 'new' ? 'Nothing new right now.' : 'Nothing viewed yet.'}</p>`}
    `;
}

function refreshNotificationsModalBody() {
    const body = document.getElementById('notifications-modal-body');
    if (!body) return;
    body.innerHTML = renderNotificationsModalBody();
    if (window.lucide) window.lucide.createIcons();
}

export function setNotificationsPanelTab(tab) {
    OL.notificationsPanelState.tab = tab;
    refreshNotificationsModalBody();
}

export function openNotificationTypesPopover(event) {
    const popover = OL.createPopoverContainer(event);
    const selected = OL.notificationsPanelState.types;

    popover.innerHTML = `
        <div class="tiny bold uppercase muted" style="margin-bottom:6px; padding:2px 4px;">Notification Type</div>
        <div style="display:grid; gap:2px; min-width:180px;">
            ${Object.entries(NOTIF_TYPE_LABELS).map(([key, label]) => `
                <label style="display:flex; align-items:center; gap:6px; padding:5px 6px; cursor:pointer;" onclick="event.stopPropagation();">
                    <input type="checkbox" ${selected.includes(key) ? 'checked' : ''} onclick="OL.toggleNotificationTypeFilter(event, '${key}')">
                    <span class="tiny">${label}</span>
                </label>
            `).join('')}
        </div>
    `;
    if (window.lucide) window.lucide.createIcons();
}

export function toggleNotificationTypeFilter(event, key) {
    event.stopPropagation();
    const list = OL.notificationsPanelState.types;
    const idx = list.indexOf(key);
    if (idx === -1) list.push(key); else list.splice(idx, 1);
    refreshNotificationsModalBody();
}

export function openNotificationsModal() {
    const html = `
        <div class="modal-head">
            <div class="modal-title-text">Notifications</div>
            <div class="spacer"></div>
            <button class="btn tiny soft" onclick="OL.openNotificationSettingsModal()" title="Settings"><i data-lucide="settings" style="width:13px;height:13px;"></i></button>
            <button class="btn small soft" onclick="OL.closeModal()">Close</button>
        </div>
        <div class="modal-body" id="notifications-modal-body" style="width:100%;">
            ${renderNotificationsModalBody()}
        </div>
    `;
    openModal(html);
    if (window.lucide) window.lucide.createIcons();
}

// Bell button — lives in the sidebar next to the Global Registry / Home
// link (see app.js). Unread count as a badge. Wrapped in a stable
// #ol-notification-bell-slot in app.js so the polling loop below can
// refresh just this element without a full page re-render.
export function renderNotificationBell() {
    const count = getUnreadNotificationCount();
    return `
        <button class="btn tiny soft" onclick="OL.openNotificationsModal()" title="Notifications" style="position:relative; display:inline-flex; align-items:center; gap:4px;">
            <i data-lucide="bell" style="width:13px;height:13px;"></i>
            ${count > 0 ? `<span style="position:absolute; top:-4px; right:-4px; background:#ef4444; color:#fff; font-size:9px; font-weight:800; border-radius:999px; min-width:14px; height:14px; display:flex; align-items:center; justify-content:center; padding:0 3px;">${count > 9 ? '9+' : count}</span>` : ''}
        </button>
    `;
}

export function refreshNotificationBell() {
    const slot = document.getElementById('ol-notification-bell-slot');
    if (!slot) return;
    slot.innerHTML = renderNotificationBell();
    if (window.lucide) window.lucide.createIcons();
}

// ---- email delivery stub ----
if (!state.master) state.master = {};
if (!state.master.emailNotificationQueue) state.master.emailNotificationQueue = [];

// targetMemberOrName: either a sphynxTeam member object, or a name string
// to look up against the roster (so callers can pass task.assignee as-is).
export function notifyEvent(type, targetMemberOrName, payload) {
    const roster = state.master.sphynxTeam || [];
    const member = typeof targetMemberOrName === 'string'
        ? roster.find(m => (m.name || '').toLowerCase() === targetMemberOrName.toLowerCase())
        : targetMemberOrName;
    if (!member) return;

    const prefs = ensureNotificationPrefs(member);
    if (!prefs.email[type]) return;

    state.master.emailNotificationQueue.push({
        id: uid(),
        to: member.email,
        type,
        subject: payload.subject,
        body: payload.body,
        queuedAt: new Date().toISOString()
    });
    console.log(`📧 [stub] Would email ${member.email}: "${payload.subject}" — no mail sender is wired up yet, so this just queues to state.master.emailNotificationQueue.`);
}

// ---- desktop (OS-level) notifications ----
// There's no realtime push in this app (no websocket/edge-function
// backend) — a browser tab only knows about a mention or assignment made
// in someone ELSE's session once it re-fetches from Supabase. So desktop
// alerts work via a lightweight poll: every 45s, pull just the project
// data + team roster back down, recompute "my notifications", and fire an
// OS notification for anything that's newly unread since the last poll.
// This only fires while the app is open in a tab — there's no push when
// the browser itself is closed.
let pollingStarted = false;
let seenUnreadIds = null; // null until first poll seeds it, so startup doesn't spam old unread items

function fireDesktopNotification(n) {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    try {
        const notif = new Notification('Operations Library', { body: n.text });
        notif.onclick = () => {
            window.focus();
            if (typeof OL.openTaskInContext === 'function') OL.openTaskInContext(n.clientId, n.taskId);
        };
    } catch (e) {
        console.warn('Desktop notification failed:', e);
    }
}

async function pollForNotifications() {
    try {
        const { data: clientsData } = await db.from('workspace_clients').select('id, project_data');
        (clientsData || []).forEach(row => {
            const client = state.clients?.[row.id];
            if (client) client.projectData = row.project_data || client.projectData;
        });

        const { data: masterRow } = await db.from('workspace_masters').select('sphynx_team').eq('id', 'main_state').maybeSingle();
        if (Array.isArray(masterRow?.sphynx_team) && masterRow.sphynx_team.length) {
            state.master.sphynxTeam = masterRow.sphynx_team;
            // Same staleness issue as sync() in core/data.js — keep a live
            // session's permissions current without requiring a re-login.
            if (typeof OL.reconcileCurrentUserPermissions === 'function' && OL.reconcileCurrentUserPermissions()) {
                if (typeof window.buildLayout === 'function') window.buildLayout();
            }
        }
    } catch (e) {
        console.warn('Notification poll failed (will retry next interval):', e);
        return;
    }

    const member = getMyTeamRecord();
    if (!member) return;
    const prefs = ensureNotificationPrefs(member);
    const notifications = getMyNotifications();
    const unread = notifications.filter(n => !n.read);

    if (seenUnreadIds === null) {
        // First poll after load: seed silently, don't fire alerts for
        // things that were already sitting unread before this tab opened.
        seenUnreadIds = new Set(unread.map(n => n.id));
    } else {
        unread.forEach(n => {
            if (seenUnreadIds.has(n.id)) return;
            seenUnreadIds.add(n.id);
            if (prefs.desktop[n.type]) fireDesktopNotification(n);
        });
    }

    refreshNotificationBell();
}

// Call once after login/init (see app.js). Safe to call more than once —
// only the first call actually starts the interval.
export function startNotificationPolling(intervalMs = 45000) {
    if (pollingStarted) return;
    pollingStarted = true;
    pollForNotifications();
    setInterval(pollForNotifications, intervalMs);
}

window.OL = window.OL || {};
Object.assign(window.OL, {
    openNotificationSettingsModal, requestDesktopNotificationPermission, toggleNotificationPref,
    getMyNotifications, getUnreadNotificationCount, markNotificationRead, markAllNotificationsRead,
    openNotificationsModal, renderNotificationBell, refreshNotificationBell, notifyEvent,
    startNotificationPolling, renderNotificationsModalBody, setNotificationsPanelTab,
    openNotificationTypesPopover, toggleNotificationTypeFilter
});
