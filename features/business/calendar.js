import { esc, state, db, updateAndSync } from '../../core/data.js';

const CALENDAR_PAGE_SIZE = 150;

OL.calendarState = {
    loading: false,
    view: 'list',        // 'list' | 'grid'
    filter: 'upcoming',  // 'upcoming' | 'past' | 'all'
    limit: CALENDAR_PAGE_SIZE,
    loadedOnce: false,
    gridMonth: (() => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d; })()
};

OL.renderBusinessCalendar = function() {
    const main = document.getElementById("mainContent");
    if (!main) return;

    const commsData = state.master?.communications || {};
    const isConnected = commsData.gmail?.connected || state.master?.googleConnected || false;
    const events = state.master?.googleCalendarEvents || [];

    // Auto-load once per session if connected and nothing loaded yet
    if (isConnected && !OL.calendarState.loadedOnce && !OL.calendarState.loading) {
        OL.calendarState.loadedOnce = true;
        OL.loadCalendarEvents().then(() => OL.renderBusinessCalendar());
    }

    main.innerHTML = `
        <div class="section-header">
            <div>
                <h2><i data-lucide="calendar" style="width:24px;height:24px;vertical-align:sub;margin-right:8px;color:var(--accent);"></i>Unified Calendar</h2>
                <div class="small muted">Google Calendar sync — upcoming & historical events</div>
            </div>
            <div class="header-actions" style="display:flex; gap:10px; align-items:center;">
                ${isConnected ? `
                    <button class="btn small soft" onclick="OL.openManageCalendarsModal()">
                        <i data-lucide="calendar-plus" style="width:14px;height:14px;"></i> Manage Calendars
                    </button>
                    <button class="btn small soft" onclick="OL.fetchLiveGoogleCalendar()" ${OL.calendarState.loading ? 'disabled' : ''}>
                        <i data-lucide="refresh-cw" style="width:14px;height:14px;${OL.calendarState.loading ? 'animation: spin 1s linear infinite;' : ''}"></i>
                        ${OL.calendarState.loading ? 'Syncing...' : 'Sync Calendar'}
                    </button>
                ` : `
                    <button class="btn small primary" onclick="OL.initiateGoogleAuth()">
                        <i data-lucide="log-in" style="width:14px;height:14px;"></i> Connect Google Account
                    </button>
                `}
            </div>
        </div>

        ${!isConnected ? `
            <div class="card" style="padding: 40px; text-align: center; max-width: 600px; margin: 20px auto;">
                <i data-lucide="calendar" style="width: 48px; height: 48px; color: var(--accent); margin-bottom: 15px;"></i>
                <h3>Google Calendar Integration</h3>
                <p class="muted small" style="max-width: 440px; margin: 0 auto 20px auto;">
                    Sync your Google Calendar to view milestone deadlines, client meetings, and scheduled deliverables directly inside your Agency OS.
                </p>
                <button class="btn primary" onclick="OL.initiateGoogleAuth()" style="display:inline-flex; align-items:center; gap:8px;">
                    <i data-lucide="log-in" style="width:16px;height:16px;"></i> Connect Google Calendar
                </button>
            </div>
        ` : `
            <div class="card" style="padding: 20px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 20px; border-bottom: 1px solid var(--line); padding-bottom: 15px; flex-wrap:wrap; gap:12px;">
                    <div style="display:flex; gap:8px;">
                        <button class="btn tiny ${OL.calendarState.filter === 'upcoming' ? 'primary' : 'soft'}" onclick="OL.setCalendarFilter('upcoming')">Upcoming</button>
                        <button class="btn tiny ${OL.calendarState.filter === 'past' ? 'primary' : 'soft'}" onclick="OL.setCalendarFilter('past')">Past</button>
                        <button class="btn tiny ${OL.calendarState.filter === 'all' ? 'primary' : 'soft'}" onclick="OL.setCalendarFilter('all')">All</button>
                    </div>
                    <div style="display:flex; gap:8px; align-items:center;">
                        <div class="tiny muted" style="margin-right:4px;">Account: <strong style="color:#22c55e;">● Connected</strong></div>
                        <button class="btn tiny ${OL.calendarState.view === 'list' ? 'primary' : 'soft'}" onclick="OL.setCalendarView('list')">
                            <i data-lucide="list" style="width:12px;height:12px;"></i> List
                        </button>
                        <button class="btn tiny ${OL.calendarState.view === 'grid' ? 'primary' : 'soft'}" onclick="OL.setCalendarView('grid')">
                            <i data-lucide="calendar-days" style="width:12px;height:12px;"></i> Calendar
                        </button>
                    </div>
                </div>

                ${OL.calendarState.view === 'grid' ? OL.renderCalendarGrid(events) : OL.renderCalendarList(events)}
            </div>
        `}
    `;

    if (window.lucide) lucide.createIcons();
};

// -------------------------------------------------------------
// LIST VIEW — grouped by date
// -------------------------------------------------------------
OL.renderCalendarList = function(events) {
    if (events.length === 0) {
        return `
            <div style="text-align:center; padding: 40px; color: var(--muted);">
                <i data-lucide="calendar-off" style="width:36px;height:32px;margin-bottom:8px;opacity:0.5;"></i>
                <div>No ${OL.calendarState.filter === 'past' ? 'past' : OL.calendarState.filter === 'all' ? '' : 'upcoming'} events found. Click "Sync Calendar" above to refresh.</div>
            </div>
        `;
    }

    // Group consecutive events by calendar date
    const groups = [];
    let currentKey = null;
    events.forEach(evt => {
        const d = new Date(evt.start);
        const key = d.toDateString();
        if (key !== currentKey) {
            groups.push({ key, date: d, items: [] });
            currentKey = key;
        }
        groups[groups.length - 1].items.push(evt);
    });

    const todayKey = new Date().toDateString();

    return `
        <div style="display:flex; flex-direction:column; gap:18px;">
            ${groups.map(g => `
                <div>
                    <div class="tiny bold uppercase muted" style="margin-bottom:8px; padding-bottom:6px; border-bottom:1px solid var(--line); display:flex; align-items:center; gap:8px;">
                        ${g.date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                        ${g.key === todayKey ? `<span class="pill tiny accent">Today</span>` : ''}
                    </div>
                    <div style="display:grid; gap:8px;">
                        ${g.items.map(evt => OL.renderCalendarEventRow(evt)).join('')}
                    </div>
                </div>
            `).join('')}
        </div>
        ${events.length >= OL.calendarState.limit ? `
            <div style="text-align:center; margin-top:18px;">
                <button class="btn tiny soft" onclick="OL.loadMoreCalendarEvents()">Load More</button>
            </div>
        ` : ''}
    `;
};

OL.renderCalendarEventRow = function(evt) {
    const timeLabel = evt.all_day
        ? 'All Day'
        : new Date(evt.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const projectName = evt.linked_client_id ? (state.clients[evt.linked_client_id]?.meta?.name || 'Project') : '';
    const showCalendarBadge = (state.master?.syncedCalendarIds || []).length > 1 && evt.calendar_summary;

    return `
        <div style="display:grid; grid-template-columns: 100px 1fr 140px; gap: 16px; padding: 12px 14px; background: rgba(255,255,255,0.02); border: 1px solid var(--line); border-radius: 6px; align-items:center; cursor:pointer;" onclick="OL.openCalendarEventModal('${evt.id}')">
            <div>
                <span class="pill tiny accent" style="font-weight:bold;">🕐 ${esc(timeLabel)}</span>
            </div>
            <div style="overflow:hidden;">
                <strong style="display:block; font-size:14px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(evt.title)}</strong>
                <div class="tiny muted" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                    ${showCalendarBadge ? `🗓️ ${esc(evt.calendar_summary)}` : ''}
                    ${evt.location ? ` ${showCalendarBadge ? '·' : ''} 📍 ${esc(evt.location)}` : ''}
                    ${projectName ? ` ${(evt.location || showCalendarBadge) ? '·' : ''} 📁 ${esc(projectName)}` : ''}
                </div>
            </div>
            <div class="text-right">
                ${evt.link ? `
                    <a href="${evt.link}" target="_blank" class="btn tiny soft" style="text-decoration:none; display:inline-flex; align-items:center; gap:4px;" onclick="event.stopPropagation();">
                        Open <i data-lucide="external-link" style="width:12px;height:12px;"></i>
                    </a>
                ` : ''}
            </div>
        </div>
    `;
};

OL.setCalendarFilter = function(filter) {
    OL.calendarState.filter = filter;
    OL.calendarState.limit = CALENDAR_PAGE_SIZE;
    OL.loadCalendarEvents().then(() => OL.renderBusinessCalendar());
};

OL.setCalendarView = function(view) {
    OL.calendarState.view = view;
    if (view === 'grid') {
        OL.loadCalendarGridMonth().then(() => OL.renderBusinessCalendar());
    } else {
        OL.renderBusinessCalendar();
    }
};

OL.loadMoreCalendarEvents = function() {
    OL.calendarState.limit += CALENDAR_PAGE_SIZE;
    OL.loadCalendarEvents().then(() => OL.renderBusinessCalendar());
};

// -------------------------------------------------------------
// GRID (MONTH) VIEW
// -------------------------------------------------------------
OL.renderCalendarGrid = function() {
    const month = OL.calendarState.gridMonth;
    const year = month.getFullYear();
    const monthIdx = month.getMonth();
    const firstOfMonth = new Date(year, monthIdx, 1);
    const firstCell = new Date(firstOfMonth);
    firstCell.setDate(firstCell.getDate() - firstCell.getDay()); // back up to Sunday

    const events = OL._calendarGridEvents || [];
    const eventsByDay = {};
    events.forEach(evt => {
        const key = new Date(evt.start).toDateString();
        if (!eventsByDay[key]) eventsByDay[key] = [];
        eventsByDay[key].push(evt);
    });

    const todayKey = new Date().toDateString();
    const cells = [];
    for (let i = 0; i < 42; i++) {
        const d = new Date(firstCell);
        d.setDate(d.getDate() + i);
        cells.push(d);
    }

    return `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
            <button class="btn tiny soft" onclick="OL.shiftCalendarGridMonth(-1)"><i data-lucide="chevron-left" style="width:14px;height:14px;"></i></button>
            <strong style="font-size:14px;">${month.toLocaleDateString([], { month: 'long', year: 'numeric' })}</strong>
            <button class="btn tiny soft" onclick="OL.shiftCalendarGridMonth(1)"><i data-lucide="chevron-right" style="width:14px;height:14px;"></i></button>
        </div>
        <div style="display:grid; grid-template-columns: repeat(7, 1fr); gap:1px; background:var(--line); border:1px solid var(--line); border-radius:6px; overflow:hidden;">
            ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => `
                <div class="tiny bold muted uppercase" style="background:rgba(255,255,255,0.03); padding:6px; text-align:center;">${d}</div>
            `).join('')}
            ${cells.map(d => {
                const key = d.toDateString();
                const inMonth = d.getMonth() === monthIdx;
                const dayEvents = eventsByDay[key] || [];
                const visible = dayEvents.slice(0, 3);
                const overflow = dayEvents.length - visible.length;
                return `
                    <div style="min-height:90px; padding:5px; opacity:${inMonth ? '1' : '0.4'};">
                        <div class="tiny ${key === todayKey ? 'bold' : ''}" style="margin-bottom:4px; ${key === todayKey ? 'color:var(--accent);' : ''}">${d.getDate()}</div>
                        <div style="display:grid; gap:2px;">
                            ${visible.map(evt => `
                                <div class="tiny" style="background:rgba(var(--accent-rgb),0.15); border-radius:3px; padding:2px 4px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; cursor:pointer;" onclick="OL.openCalendarEventModal('${evt.id}')" title="${esc(evt.title)}">${esc(evt.title)}</div>
                            `).join('')}
                            ${overflow > 0 ? `<div class="tiny muted">+${overflow} more</div>` : ''}
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
    `;
};

OL.shiftCalendarGridMonth = function(delta) {
    const m = new Date(OL.calendarState.gridMonth);
    m.setMonth(m.getMonth() + delta);
    OL.calendarState.gridMonth = m;
    OL.loadCalendarGridMonth().then(() => OL.renderBusinessCalendar());
};

OL.loadCalendarGridMonth = async function() {
    const start = OL.calendarState.gridMonth;
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);

    const { data, error } = await db
        .from('calendar_events')
        .select('id, title, start, end, all_day, location, link, linked_client_id, calendar_summary')
        .gte('start', start.toISOString())
        .lt('start', end.toISOString())
        .order('start', { ascending: true });

    if (error) { console.error('Failed to load calendar month:', error.message); return; }
    OL._calendarGridEvents = data || [];
};

// -------------------------------------------------------------
// LOAD (LIST VIEW) FROM SUPABASE
// -------------------------------------------------------------
OL.loadCalendarEvents = async function() {
    let query = db.from('calendar_events').select('id, title, start, end, all_day, location, link, linked_client_id, calendar_summary');

    const nowIso = new Date().toISOString();
    if (OL.calendarState.filter === 'upcoming') {
        query = query.gte('start', nowIso).order('start', { ascending: true });
    } else if (OL.calendarState.filter === 'past') {
        query = query.lt('start', nowIso).order('start', { ascending: false });
    } else {
        query = query.order('start', { ascending: true });
    }

    const { data, error } = await query.limit(OL.calendarState.limit);
    if (error) { console.error('Failed to load calendar events:', error.message); return; }

    if (!state.master) state.master = {};
    // "Past" is fetched newest-first for the query, but should still read
    // chronologically within the list — re-sort ascending for display either way.
    state.master.googleCalendarEvents = (data || []).slice().sort((a, b) => new Date(a.start) - new Date(b.start));
};

// -------------------------------------------------------------
// EVENT DETAIL MODAL
// -------------------------------------------------------------
OL.openCalendarEventModal = async function(id) {
    const { data: evt, error } = await db.from('calendar_events').select('*').eq('id', id).single();
    if (error || !evt) { alert('Could not load that event.'); return; }

    const projectName = evt.linked_client_id ? (state.clients[evt.linked_client_id]?.meta?.name || 'Project') : '';
    const showCalendarBadge = (state.master?.syncedCalendarIds || []).length > 1 && evt.calendar_summary;
    const startLabel = evt.all_day
        ? new Date(evt.start).toLocaleDateString([], { dateStyle: 'medium' })
        : new Date(evt.start).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
    const endLabel = evt.end && !evt.all_day ? new Date(evt.end).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';

    const html = `
        <div class="modal-head">
            <div class="modal-title-text">📅 ${esc(evt.title || 'Untitled Event')}</div>
            <button class="btn small soft" onclick="OL.closeModal()">Close</button>
        </div>
        <div class="modal-body" style="max-width:550px; width:100%;">
            <div class="tiny muted" style="margin-bottom:14px; display:flex; flex-direction:column; gap:4px;">
                <div><strong>When:</strong> ${esc(startLabel)}${endLabel ? ` – ${esc(endLabel)}` : ''}</div>
                ${evt.location ? `<div><strong>Where:</strong> ${esc(evt.location)}</div>` : ''}
                ${showCalendarBadge ? `<div><strong>Calendar:</strong> ${esc(evt.calendar_summary)}</div>` : ''}
                ${projectName ? `<div><strong>Project:</strong> <span class="pill tiny soft">📁 ${esc(projectName)}</span></div>` : ''}
            </div>
            ${evt.description ? `
                <div style="white-space:pre-wrap; line-height:1.6; font-size:13px; max-height:300px; overflow:auto; border-top:1px solid var(--line); padding-top:14px; margin-bottom:14px;">
                    ${esc(evt.description)}
                </div>
            ` : ''}
            ${evt.link ? `
                <a href="${evt.link}" target="_blank" class="btn small soft" style="text-decoration:none; display:inline-flex; align-items:center; gap:6px;">
                    Open in Google Calendar <i data-lucide="external-link" style="width:12px;height:12px;"></i>
                </a>
            ` : ''}
        </div>
    `;
    openModal(html);
    if (window.lucide) lucide.createIcons();
};
window.OL.openCalendarEventModal = OL.openCalendarEventModal;

// -------------------------------------------------------------
// LIVE GOOGLE CALENDAR SYNC
// -------------------------------------------------------------
OL.fetchLiveGoogleCalendar = async function() {
    if (OL.calendarState.loading) return; // Prevent concurrent loops
    OL.calendarState.loading = true;
    OL.renderBusinessCalendar();

    try {
        const response = await fetch("https://kexnnpwjerrnsmifauuo.supabase.co/functions/v1/get-calendar-events");

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
            console.warn("Calendar sync failed (HTTP " + response.status + ")");
            return;
        }

        const syncResult = await response.json();
        console.log(`Calendar sync: ${syncResult.newCount ?? 0} new of ${syncResult.syncedCount ?? 0} scanned`);

        await OL.loadCalendarEvents();
        if (OL.calendarState.view === 'grid') await OL.loadCalendarGridMonth();

        // Run task-creation automation rules for any newly-matched events —
        // this is what syncs meeting time to a client's timesheet.
        await OL.processCalendarAutomations();
    } catch (err) {
        console.error("Failed to fetch Google Calendar events:", err);
    } finally {
        OL.calendarState.loading = false;
        OL.renderBusinessCalendar();
    }
};

// -------------------------------------------------------------
// AUTOMATION HOOKUP — turns matched calendar events into tasks per your
// Automation Rules (trigger: "Calendar event syncs"). Guarded by
// automation_processed so re-syncing the same event never re-fires rules.
// -------------------------------------------------------------
OL.processCalendarAutomations = async function() {
    const { data, error } = await db
        .from('calendar_events')
        .select('id, title, start, end, all_day, linked_client_id')
        .eq('automation_processed', false)
        .not('linked_client_id', 'is', null);

    if (error) { console.error('Failed to load unprocessed calendar events:', error.message); return; }
    if (!data || !data.length) return;

    const processedIds = [];

    await updateAndSync(() => {
        data.forEach(evt => {
            const client = state.clients[evt.linked_client_id];
            if (!client) return; // client no longer exists locally — leave unprocessed, will retry next sync

            const durationHours = (!evt.all_day && evt.start && evt.end)
                ? Math.round(((new Date(evt.end) - new Date(evt.start)) / 3600000) * 100) / 100
                : null;

            if (typeof OL.runAutomationRules === 'function') {
                OL.runAutomationRules('calendar_event_synced', {
                    eventTitle: evt.title,
                    title: evt.title,
                    resourceName: evt.title,
                    durationHours,
                    client
                });
            }

            if (!state.dirtyClientIds) state.dirtyClientIds = new Set();
            state.dirtyClientIds.add(client.id);
            processedIds.push(evt.id);
        });
    });

    if (processedIds.length) {
        const { error: updateError } = await db.from('calendar_events').update({ automation_processed: true }).in('id', processedIds);
        if (updateError) console.error('Failed to mark calendar events as processed:', updateError.message);
    }
};

window.OL.renderBusinessCalendar = OL.renderBusinessCalendar;

// -------------------------------------------------------------
// MANAGE CALENDARS — pick which Google Calendars to sync
// -------------------------------------------------------------
OL.openManageCalendarsModal = async function() {
    const html = `
        <div class="modal-head">
            <div class="modal-title-text">🗓️ Manage Calendars</div>
            <button class="btn small soft" onclick="OL.closeModal()">Close</button>
        </div>
        <div class="modal-body" id="manage-calendars-body" style="max-width:450px; width:100%;">
            <div class="tiny muted">Loading your Google Calendars...</div>
        </div>
    `;
    openModal(html);

    try {
        const response = await fetch("https://kexnnpwjerrnsmifauuo.supabase.co/functions/v1/list-google-calendars");
        const container = document.getElementById('manage-calendars-body');
        if (!container) return; // modal closed already

        if (response.status === 401) {
            container.innerHTML = `<div class="tiny" style="color:#ef4444;">Your Google connection expired — reconnect it from Gmail Settings, then try again.</div>`;
            return;
        }
        if (!response.ok) {
            let detail = '';
            try { detail = (await response.json())?.message || ''; } catch (e) { /* body wasn't JSON */ }
            container.innerHTML = `
                <div class="tiny" style="color:#ef4444; margin-bottom:6px;">Could not load your calendars (HTTP ${response.status}).</div>
                ${detail ? `<div class="tiny muted" style="font-family:monospace; white-space:pre-wrap;">${esc(detail)}</div>` : ''}
            `;
            console.error('list-google-calendars failed:', response.status, detail);
            return;
        }

        const data = await response.json();
        const calendars = data.calendars || [];
        const currentIds = (state.master?.syncedCalendarIds || []);
        // First time configuring: default to just the primary calendar, since
        // that matches the pre-multi-calendar behavior.
        const selected = new Set(currentIds.length > 0 ? currentIds : calendars.filter(c => c.primary).map(c => c.id));

        OL._manageCalendarsSelection = selected;

        const mine = calendars.filter(c => c.accessRole === 'owner');
        const others = calendars.filter(c => c.accessRole !== 'owner');

        const calendarRow = (c) => `
            <label style="display:flex; align-items:center; gap:8px; font-size:12px; cursor:pointer; padding:8px 10px; border:1px solid var(--line); border-radius:6px;">
                <input type="checkbox" ${selected.has(c.id) ? 'checked' : ''} onchange="OL.toggleManageCalendarSelection('${esc(c.id).replace(/'/g, "\\'")}', this.checked)">
                ${esc(c.summary)}${c.primary ? ` <span class="pill tiny soft" style="font-size:9px;">Primary</span>` : ''}
            </label>
        `;

        container.innerHTML = `
            <p class="tiny muted" style="margin-bottom:12px;">Choose which calendars to sync into the app. Syncing more calendars pulls in more events on your next "Sync Calendar."</p>
            <div style="max-height:320px; overflow:auto; margin-bottom:16px;">
                ${mine.length ? `
                    <div class="tiny bold uppercase muted" style="margin-bottom:6px;">My Calendars</div>
                    <div style="display:grid; gap:8px; margin-bottom:${others.length ? '16px' : '0'};">
                        ${mine.map(calendarRow).join('')}
                    </div>
                ` : ''}
                ${others.length ? `
                    <div class="tiny bold uppercase muted" style="margin-bottom:6px;">Other Calendars</div>
                    <div style="display:grid; gap:8px;">
                        ${others.map(calendarRow).join('')}
                    </div>
                ` : ''}
            </div>
            <div style="display:flex; justify-content:flex-end;">
                <button class="btn small primary" onclick="OL.saveManageCalendarsSelection()" style="font-weight:bold;">Save & Sync</button>
            </div>
        `;
    } catch (err) {
        const container = document.getElementById('manage-calendars-body');
        if (container) container.innerHTML = `<div class="tiny" style="color:#ef4444;">Something went wrong loading your calendars.</div>`;
        console.error('Failed to load calendar list:', err);
    }
};

OL.toggleManageCalendarSelection = function(calendarId, checked) {
    if (!OL._manageCalendarsSelection) return;
    if (checked) OL._manageCalendarsSelection.add(calendarId);
    else OL._manageCalendarsSelection.delete(calendarId);
};

OL.saveManageCalendarsSelection = async function() {
    const selected = [...(OL._manageCalendarsSelection || [])];
    if (selected.length === 0) { alert('Pick at least one calendar to sync.'); return; }

    await updateAndSync(() => {
        if (!state.master) state.master = {};
        state.master.syncedCalendarIds = selected;
    });

    // updateAndSync's own persist is debounced (1.5s) so the sync below could
    // otherwise fire before the new selection actually lands in Supabase —
    // write it immediately here so get-calendar-events reads the right list.
    const { error } = await db.from('workspace_masters').update({ synced_calendar_ids: selected }).eq('id', 'main_state');
    if (error) console.error('Failed to save calendar selection immediately (debounced save will still catch it):', error.message);

    OL.closeModal();
    OL.fetchLiveGoogleCalendar();
};
