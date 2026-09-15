import { esc, state, db, updateAndSync, uid } from '../../core/data.js';

const CALENDAR_PAGE_SIZE = 150;

OL.calendarState = {
    loading: false,
    view: 'list',        // 'list' | 'grid'
    filter: 'upcoming',  // 'upcoming' | 'past' | 'all'
    limit: CALENDAR_PAGE_SIZE,
    loadedOnce: false,
    gridMonth: (() => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d; })()
};

// -------------------------------------------------------------
// AUTO TIME-TRACKING — an event's logged hours default to its actual
// duration. A manual edit (OL.setEventLoggedHours) sticks until the
// event's duration itself changes (a reschedule), at which point it
// recalculates fresh — duration_hours_snapshot is what's compared each
// load to know whether that's happened.
// -------------------------------------------------------------
OL.recalculateEventLoggedHours = function(evt) {
    if (!evt.start || !evt.end || evt.all_day) return null;
    const durationHours = Math.max(0, (new Date(evt.end) - new Date(evt.start)) / 3600000);
    const snapshot = Number(evt.duration_hours_snapshot || 0);
    if (Math.abs(durationHours - snapshot) < 0.01) return null; // duration hasn't changed since last calc
    return { logged_hours: Math.round(durationHours * 100) / 100, duration_hours_snapshot: Math.round(durationHours * 100) / 100 };
};

// Applies the above across a batch of freshly-loaded events, writing any
// that need recalculating back to Supabase and updating them in place —
// same pattern as OL.autoLinkGmailMessagesToTasks.
OL.applyEventTimeRecalculation = async function(events) {
    const updates = [];
    events.forEach(evt => {
        const change = OL.recalculateEventLoggedHours(evt);
        if (change) { Object.assign(evt, change); updates.push({ id: evt.id, ...change }); }
    });
    if (!updates.length) return;
    await Promise.all(updates.map(u =>
        db.from('calendar_events').update({ logged_hours: u.logged_hours, duration_hours_snapshot: u.duration_hours_snapshot }).eq('id', u.id)
    ));
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

                ${OL.calendarState.lastSyncSummary ? `
                    <div class="tiny muted" style="margin-bottom:14px;">
                        Last sync: ${OL.calendarState.lastSyncSummary.syncedCount ?? 0} event(s) scanned across ${OL.calendarState.lastSyncSummary.calendarsScanned ?? '?'} calendar(s), ${OL.calendarState.lastSyncSummary.newCount ?? 0} new.
                        ${(OL.calendarState.lastSyncSummary.perCalendar || []).length ? `
                            <div style="margin-top:4px; display:grid; gap:2px;">
                                ${OL.calendarState.lastSyncSummary.perCalendar.map(c => `
                                    <div>— ${esc(c.summary)}: ${c.error ? `<span style="color:#ef4444;">error — ${esc(c.error)}</span>` : `${c.rawCount} event(s)`}</div>
                                `).join('')}
                            </div>
                        ` : ''}
                    </div>
                ` : ''}

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
    return OL.renderEventRowHTML(evt);
};

// -------------------------------------------------------------
// EVENT ROW — deliberately mirrors OL.renderTaskRowHTML (Cross-Project
// Task Engine) so events look and feel like the same kind of card: same
// container, project tag, billable toggle, assignee avatar. Differences,
// per spec: a static calendar icon instead of a status dot/checkbox (no
// "completed" concept for events yet), no resource-tag line, and the
// "due date" slot shows the actual event time instead of an editable
// date field (rescheduling happens in Google Calendar, not here).
// -------------------------------------------------------------
OL.renderEventRowHTML = function(evt) {
    const { avatarBg, avatarColor, avatarContent } = OL.computeAssigneeAvatar(evt.assignee);
    const projectName = evt.linked_client_id ? (state.clients[evt.linked_client_id]?.meta?.name || 'Project') : '';
    const timeLabel = evt.all_day
        ? new Date(evt.start).toLocaleDateString([], { dateStyle: 'medium' })
        : `${new Date(evt.start).toLocaleDateString([], { dateStyle: 'medium' })}, ${new Date(evt.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    const commentCount = (evt.comments || []).length;
    const isExpanded = !!OL.expandedCommentCards[`evt-${evt.id}`];

    const rowHTML = `
    <div class="task-row-card" style="display:flex; flex-direction:column; gap:6px; padding:10px 14px; background:rgba(56,189,248,0.03); border-bottom:1px solid var(--line); border-radius:4px; cursor:pointer;"
         onclick="OL.openCalendarEventModal('${evt.id}')">
        <div style="display:flex; align-items:center; gap:10px; width:100%;">
            <div style="display:flex; align-items:center;" title="Calendar Event">
                <i data-lucide="calendar" style="width:14px;height:14px; color:#38bdf8;"></i>
            </div>

            <div style="font-weight:600; font-size:13px; color:var(--text); flex:1; min-width:0; max-width:100%; overflow:hidden; display:flex; align-items:center; gap:6px; line-height:1.3;" title="${esc(evt.title || '')}">
                <span style="display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;">${esc(evt.title || 'Untitled Event')}</span>
                ${commentCount ? `
                    <span class="pill tiny soft" style="cursor:pointer; font-size:10px; display:inline-flex; align-items:center; gap:3px; flex-shrink:0;"
                          onclick="event.stopPropagation(); OL.toggleExpandedTaskComments('evt-${evt.id}')" title="${isExpanded ? 'Hide comments' : 'Show all comments'}">
                        <i data-lucide="message-square" style="width:10px;height:10px; pointer-events:none;"></i> ${commentCount}
                    </span>
                ` : ''}
            </div>

            ${projectName ? `
                <div style="flex-shrink:0;">
                    <span class="client-link-badge pill tiny soft" style="cursor:pointer; text-decoration:none; font-weight:600; padding:2px 8px; border-radius:4px; display:inline-flex; align-items:center; gap:5px; font-size:11px;"
                          onclick="event.stopPropagation(); OL.navigateToClientProject('${evt.linked_client_id}')" title="Jump to Workspace">
                        <i data-lucide="folder" style="width:12px;height:12px; pointer-events:none;"></i> ${esc(projectName)}
                    </span>
                </div>
            ` : ''}
        </div>

        <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; padding-top:4px; border-top:1px dashed rgba(255,255,255,0.04);">
            <div style="display:flex; align-items:center; gap:12px;">
                <span class="pill tiny soft" style="font-size:10px; display:inline-flex; align-items:center; gap:4px;">
                    <i data-lucide="clock" style="width:11px;height:11px;"></i> ${esc(timeLabel)}
                </span>
            </div>

            <div style="display:flex; align-items:center; gap:10px;">
                <div onclick="event.stopPropagation();" style="display:flex; align-items:center; gap:4px;">
                    <span class="tiny monospace bold" style="color:var(--accent); font-size:11px;" title="Auto-tracked from event duration">${Number(evt.logged_hours || 0).toFixed(1)}h</span>
                    <button class="btn tiny soft" title="Edit Logged Time" onclick="OL.openEditEventTimeModal('${evt.id}')" style="display:inline-flex; align-items:center; justify-content:center; padding:3px 5px;">
                        <i data-lucide="pencil" style="width:11px;height:11px; pointer-events:none;"></i>
                    </button>
                </div>

                <div onclick="event.stopPropagation();" style="display:flex; align-items:center;">
                    <span title="${evt.billable === false ? 'Non-billable — click to mark billable' : 'Billable — click to mark non-billable'}"
                          style="cursor:pointer; font-size:10px; font-weight:bold; padding:2px 6px; border-radius:10px; ${evt.billable === false ? 'background:rgba(148,163,184,0.15); color:var(--muted);' : 'background:rgba(34,197,94,0.15); color:#22c55e;'}"
                          onclick="OL.toggleEventBillable('${evt.id}')">
                        ${evt.billable === false ? '⊘ $' : '$'}
                    </span>
                </div>

                <div onclick="event.stopPropagation();" style="display:flex; justify-content:center; position:relative;">
                    <div title="Assignee: ${esc(evt.assignee || 'Unassigned')}"
                         style="width:24px; height:24px; border-radius:50%; background:${avatarBg}; color:${avatarColor}; font-size:10px; font-weight:bold; display:flex; align-items:center; justify-content:center; cursor:pointer;"
                         onclick="OL.openEditEventAssigneeDropdown(event, '${evt.id}')">
                        ${avatarContent}
                    </div>
                </div>
            </div>
        </div>
    </div>
    `;

    if (!isExpanded || !commentCount) return rowHTML;

    const sorted = [...(evt.comments || [])].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
    const subrow = `
        <div style="margin: -2px 0 6px 20px; padding:8px 12px; border-left:2px solid #38bdf8; background:rgba(56,189,248,0.05); border-radius:0 6px 6px 0; cursor:pointer;" onclick="OL.openCalendarEventModal('${evt.id}')">
            ${sorted.map(c => `
                <div class="tiny" style="display:flex; gap:6px; align-items:baseline; margin-bottom:2px;">
                    <i data-lucide="message-square" style="width:10px;height:10px; color:#38bdf8; flex-shrink:0;"></i>
                    <strong>${esc(c.author || 'Someone')}</strong>
                    <span class="muted" style="font-size:10px;">${c.date ? esc(new Date(c.date).toLocaleDateString([], { dateStyle: 'medium' })) : ''}</span>
                    <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${OL.renderCommentTextWithMentions ? OL.renderCommentTextWithMentions(c.text) : esc(c.text)}</span>
                </div>
            `).join('')}
        </div>
    `;
    return rowHTML + subrow;
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
        .select('id, title, start, end, all_day, location, link, linked_client_id, calendar_summary, assignee, billable, logged_hours, duration_hours_snapshot, comments')
        .gte('start', start.toISOString())
        .lt('start', end.toISOString())
        .order('start', { ascending: true });

    if (error) { console.error('Failed to load calendar month:', error.message); return; }
    OL._calendarGridEvents = data || [];
    await OL.applyEventTimeRecalculation(OL._calendarGridEvents);
};

// -------------------------------------------------------------
// LOAD (LIST VIEW) FROM SUPABASE
// -------------------------------------------------------------
OL.loadCalendarEvents = async function() {
    let query = db.from('calendar_events').select('id, title, start, end, all_day, location, link, linked_client_id, calendar_summary, assignee, billable, logged_hours, duration_hours_snapshot, comments');

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
    await OL.applyEventTimeRecalculation(state.master.googleCalendarEvents);
};

// -------------------------------------------------------------
// EVENT DETAIL MODAL
// -------------------------------------------------------------
// -------------------------------------------------------------
// SAFE DESCRIPTION FORMATTING — Google Calendar descriptions come back as
// plain text from the API (no HTML), which is why long ones read as a
// dense unbroken block. Rather than injecting raw HTML (these come from
// external invites — real XSS risk), this escapes everything first, then
// turns URLs into clickable links, doubles up on line breaks so
// paragraphs get real spacing, and renders "- "/"* " lines as a list —
// the actual readability problems, addressed safely.
// -------------------------------------------------------------
OL.formatEventDescription = function(text) {
    if (!text) return '';
    const escaped = esc(text);
    const withLinks = escaped.replace(/(https?:\/\/[^\s<]+)/g, url => `<a href="${url}" target="_blank" style="color:var(--accent);">${url}</a>`);

    const lines = withLinks.split('\n');
    let html = '';
    let inList = false;
    lines.forEach(line => {
        const trimmed = line.trim();
        const isBullet = /^[-*]\s+/.test(trimmed);
        if (isBullet) {
            if (!inList) { html += '<ul style="margin:6px 0; padding-left:20px;">'; inList = true; }
            html += `<li style="margin-bottom:3px;">${trimmed.replace(/^[-*]\s+/, '')}</li>`;
        } else {
            if (inList) { html += '</ul>'; inList = false; }
            html += trimmed ? `<div style="margin-bottom:6px;">${trimmed}</div>` : '<div style="height:8px;"></div>';
        }
    });
    if (inList) html += '</ul>';
    return html;
};

OL.openCalendarEventModal = async function(id) {
    const { data: evt, error } = await db.from('calendar_events').select('*').eq('id', id).single();
    if (error || !evt) { alert('Could not load that event.'); return; }

    OL._activeEventModalId = id;

    const projectName = evt.linked_client_id ? (state.clients[evt.linked_client_id]?.meta?.name || 'Project') : '';
    const showCalendarBadge = (state.master?.syncedCalendarIds || []).length > 1 && evt.calendar_summary;
    const startLabel = evt.all_day
        ? new Date(evt.start).toLocaleDateString([], { dateStyle: 'medium' })
        : new Date(evt.start).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
    const endLabel = evt.end && !evt.all_day ? new Date(evt.end).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';

    const html = `
        <div style="padding: 24px; max-width: 820px; width: 100%;" onclick="event.stopPropagation()">
            <div class="modal-header" style="display:flex; justify-content:space-between; align-items:center; border-bottom: 1px solid var(--line); padding-bottom: 14px; margin-bottom: 20px;">
                <div style="display:flex; align-items:center; gap:10px; flex:1; min-width:0;">
                    <i data-lucide="calendar" style="width:22px;height:22px;color:#38bdf8; flex-shrink:0;"></i>
                    <h3 style="margin:0; font-size:18px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(evt.title || 'Untitled Event')}</h3>
                </div>
                <button class="btn tiny soft" onclick="OL.closeModal()" style="font-weight:bold; font-size:14px; flex-shrink:0; margin-left:10px;">✕</button>
            </div>

            <div style="display:grid; grid-template-columns: 1.6fr 1fr; gap:24px; align-items:start;">
                <div style="min-width:0;">
                    <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-bottom: 20px;">
                        ${projectName ? `
                            <span class="client-link-badge pill tiny soft" style="font-weight:600; display:inline-flex; align-items:center; gap:4px; cursor:pointer;"
                                  onclick="OL.closeModal(); OL.navigateToClientProject('${evt.linked_client_id}')" title="Jump to Workspace">
                                <i data-lucide="folder" style="width:12px;height:12px; pointer-events:none;"></i> ${esc(projectName)}
                            </span>
                        ` : ''}
                        <span class="pill tiny soft" style="font-weight:bold; cursor:pointer; display:inline-flex; align-items:center; gap:4px;"
                              onclick="OL.openEditEventAssigneeDropdown(event, '${evt.id}')">
                            <i data-lucide="pencil" style="width:10px;height:10px;"></i> Assignee: ${esc(evt.assignee || 'Unassigned')}
                        </span>
                        <span title="${evt.billable === false ? 'Non-billable — click to mark billable' : 'Billable — click to mark non-billable'}"
                              style="cursor:pointer; font-size:11px; font-weight:bold; padding:3px 8px; border-radius:10px; ${evt.billable === false ? 'background:rgba(148,163,184,0.15); color:var(--muted);' : 'background:rgba(34,197,94,0.15); color:#22c55e;'}"
                              onclick="OL.toggleEventBillable('${evt.id}')">
                            ${evt.billable === false ? '⊘ Non-billable' : '$ Billable'}
                        </span>
                    </div>

                    <div style="display:grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 20px; background:rgba(0,0,0,0.15); padding:14px; border-radius:6px; border:1px solid var(--line);" class="tiny">
                        <div><strong class="muted">When:</strong> ${esc(startLabel)}${endLabel ? ` – ${esc(endLabel)}` : ''}</div>
                        <div>
                            <strong class="muted">Logged Time:</strong> <span style="color:var(--accent); font-weight:bold;">${Number(evt.logged_hours || 0).toFixed(1)}h</span>
                            <span class="tiny muted">(auto from duration)</span>
                            <button class="btn tiny soft" onclick="OL.openEditEventTimeModal('${evt.id}')" style="padding:2px 5px; margin-left:4px;"><i data-lucide="pencil" style="width:10px;height:10px;"></i></button>
                        </div>
                        ${evt.location ? `<div><strong class="muted">Where:</strong> ${esc(evt.location)}</div>` : ''}
                        ${showCalendarBadge ? `<div><strong class="muted">Calendar:</strong> ${esc(evt.calendar_summary)}</div>` : ''}
                    </div>

                    ${evt.description ? `
                        <div style="margin-bottom: 20px; background: rgba(255,255,255,0.02); padding: 14px; border-radius: 6px; border:1px solid var(--line);">
                            <label class="bold tiny uppercase muted" style="display:block; margin-bottom:6px;">Description</label>
                            <div style="font-size:13px; line-height:1.5; color:var(--text);">${OL.formatEventDescription(evt.description)}</div>
                        </div>
                    ` : ''}

                    ${evt.link ? `
                        <a href="${evt.link}" target="_blank" class="btn tiny soft" style="text-decoration:none; display:inline-flex; align-items:center; gap:6px;">
                            Open in Google Calendar <i data-lucide="external-link" style="width:12px;height:12px;"></i>
                        </a>
                    ` : ''}
                </div>

                <div id="event-comments-sidebar-${evt.id}" style="border-left:1px solid var(--line); padding-left:20px; min-width:0;">
                    ${OL.renderEventCommentsSidebarHTML(evt)}
                </div>
            </div>
        </div>
    `;
    OL.showOverlayModal(html);
};
window.OL.openCalendarEventModal = OL.openCalendarEventModal;

// -------------------------------------------------------------
// EVENT COMMENTS — the event's own comments plus a merged, read-only
// roll-up of comments from any task whose parentEventId points here
// (tagged with which task each came from — reply from the task itself,
// same pattern as the resource roll-up in features/resources-modal.js).
// -------------------------------------------------------------
OL.renderEventCommentsSidebarHTML = function(evt) {
    const own = (evt.comments || []).map(c => ({ ...c }));
    const client = evt.linked_client_id ? state.clients[evt.linked_client_id] : null;
    const childTasks = (client?.projectData?.clientTasks || []).filter(t => t.parentEventId === evt.id);
    const rolledUp = childTasks.flatMap(t => (t.comments || []).map(c => ({ ...c, _fromTask: t.title || t.name, _taskId: t.id })));
    const all = [...own, ...rolledUp].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

    return `
        <label class="bold tiny uppercase muted" style="display:block; margin-bottom:8px;">
            <i data-lucide="message-square" style="width:12px;height:12px;vertical-align:sub;"></i> Comments
        </label>

        <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:12px;">
            <div class="tiny muted">Posting as <strong>${esc(OL.getCurrentUserName ? OL.getCurrentUserName() : 'Sphynx Team')}</strong></div>
            <textarea id="task-comment-input-evt-${evt.id}" class="modal-input tiny" rows="3" placeholder="Add a comment... use @ to tag someone" style="width:100%; box-sizing:border-box;"
                      oninput="OL.handleCommentMentionInput(this, 'evt-${evt.id}')"
                      onkeydown="OL.handleCommentMentionKeydown(event, 'evt-${evt.id}')"></textarea>
            <div id="comment-mention-dropdown-evt-${evt.id}"></div>
            <button class="btn tiny primary" style="align-self:flex-end;" onclick="OL.addEventComment('${evt.id}')">
                <i data-lucide="send" style="width:12px;height:12px;"></i> Post
            </button>
        </div>

        <div style="display:grid; gap:8px; max-height:420px; overflow:auto;">
            ${all.length ? all.map(c => `
                <div style="background: rgba(255,255,255,0.02); padding:10px; border-radius:6px; border:1px solid var(--line);">
                    <div class="tiny muted bold" style="margin-bottom:4px; display:flex; justify-content:space-between; gap:8px;">
                        <span>${esc(c.author || 'Unknown')}${c._fromTask ? ` <span class="pill tiny soft" style="font-size:9px; margin-left:4px; cursor:pointer;" onclick="OL.closeModal(); OL.openTaskInContext('${evt.linked_client_id}', '${c._taskId}')" title="From task: ${esc(c._fromTask)}"><i data-lucide="check-square" style="width:9px;height:9px;"></i> ${esc(c._fromTask)}</span>` : ''}</span>
                        <span>${c.date ? esc(new Date(c.date).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })) : ''}</span>
                    </div>
                    <div class="tiny" style="line-height:1.5; white-space:pre-wrap;">${OL.renderCommentTextWithMentions ? OL.renderCommentTextWithMentions(c.text) : esc(c.text)}</div>
                </div>
            `).join('') : `<div class="tiny muted">No comments yet.</div>`}
        </div>
    `;
};

OL.addEventComment = async function(eventId) {
    const textEl = document.getElementById(`task-comment-input-evt-${eventId}`);
    const text = (textEl?.value || '').trim();
    if (!text) return;
    const author = (OL.getCurrentUserName ? OL.getCurrentUserName() : '') || 'Sphynx Team';
    const mentions = OL.extractMentions ? OL.extractMentions(text) : [];

    const { data: current } = await db.from('calendar_events').select('comments').eq('id', eventId).single();
    const comments = [...(current?.comments || []), { id: uid(), author, text, mentions, date: new Date().toISOString() }];

    const { error } = await db.from('calendar_events').update({ comments }).eq('id', eventId);
    if (error) { alert('Failed to post comment: ' + error.message); return; }

    // Reflect in whichever cached list is showing, then re-render the modal
    [state.master?.googleCalendarEvents, OL._calendarGridEvents].forEach(list => {
        const evt = (list || []).find(e => e.id === eventId);
        if (evt) evt.comments = comments;
    });

    OL.openCalendarEventModal(eventId);
};

OL.toggleEventBillable = async function(id) {
    const list = state.master?.googleCalendarEvents || [];
    const evt = list.find(e => e.id === id) || (OL._calendarGridEvents || []).find(e => e.id === id);
    const newValue = evt ? (evt.billable === false ? true : false) : true;

    const { error } = await db.from('calendar_events').update({ billable: newValue }).eq('id', id);
    if (error) { alert('Failed to update: ' + error.message); return; }

    [state.master?.googleCalendarEvents, OL._calendarGridEvents].forEach(list => {
        const e = (list || []).find(e => e.id === id);
        if (e) e.billable = newValue;
    });
    if (OL._activeEventModalId === id) OL.openCalendarEventModal(id);
    else OL.refreshTaskView();
};

OL.openEditEventAssigneeDropdown = function(event, id) {
    const popover = OL.createPopoverContainer(event);
    popover.innerHTML = `
        <div class="tiny bold uppercase muted" style="margin-bottom:6px; padding:2px 4px;">Assign Event</div>
        <div style="display:grid; gap:4px; max-height:260px; overflow-y:auto;">
            <button class="btn tiny soft" style="text-align:left;" onclick="OL.setEventAssignee('${id}', ''); OL.closePopoverDropdown();">Unassigned</button>
            ${(state.master?.sphynxTeam || []).map(m => `
                <button class="btn tiny soft" style="text-align:left;" onclick="OL.setEventAssignee('${id}', '${esc(m.name)}'); OL.closePopoverDropdown();">${esc(m.name)}</button>
            `).join('')}
        </div>
    `;
    if (window.lucide) lucide.createIcons();
};

OL.setEventAssignee = async function(id, name) {
    const { error } = await db.from('calendar_events').update({ assignee: name || null }).eq('id', id);
    if (error) { alert('Failed to update: ' + error.message); return; }

    [state.master?.googleCalendarEvents, OL._calendarGridEvents].forEach(list => {
        const e = (list || []).find(e => e.id === id);
        if (e) e.assignee = name || null;
    });
    if (OL._activeEventModalId === id) OL.openCalendarEventModal(id);
    else OL.refreshTaskView();
};

OL.openEditEventTimeModal = function(id) {
    const list = state.master?.googleCalendarEvents || [];
    const evt = list.find(e => e.id === id) || (OL._calendarGridEvents || []).find(e => e.id === id);
    if (!evt) return;

    const content = `
        <div style="padding: 20px; max-width: 320px; width: 100%;" onclick="event.stopPropagation()">
            <h3 style="margin:0 0 12px; font-size:15px;">Edit Logged Time</h3>
            <p class="tiny muted" style="margin-bottom:10px;">Overrides the auto-tracked duration. Resets automatically if this event is rescheduled.</p>
            <input type="number" step="0.25" min="0" id="event-hours-input" class="modal-input tiny" value="${Number(evt.logged_hours || 0).toFixed(2)}" style="width:100%; margin-bottom:12px;">
            <div style="display:flex; justify-content:flex-end; gap:8px;">
                <button class="btn tiny soft" onclick="OL.closeModal(); OL.openCalendarEventModal('${id}')">Cancel</button>
                <button class="btn tiny primary" onclick="OL.setEventLoggedHours('${id}', document.getElementById('event-hours-input').value)">Save</button>
            </div>
        </div>
    `;
    OL.showOverlayModal(content);
};

OL.setEventLoggedHours = async function(id, hoursValue) {
    const hours = Math.max(0, parseFloat(hoursValue) || 0);
    const { error } = await db.from('calendar_events').update({ logged_hours: hours }).eq('id', id);
    if (error) { alert('Failed to update: ' + error.message); return; }

    [state.master?.googleCalendarEvents, OL._calendarGridEvents].forEach(list => {
        const e = (list || []).find(e => e.id === id);
        if (e) e.logged_hours = hours;
    });
    OL._activeEventModalId = id;
    OL.openCalendarEventModal(id);
};

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
            let detail = '';
            try { detail = (await response.json())?.message || ''; } catch (e) { /* body wasn't JSON */ }
            console.warn("Calendar sync failed (HTTP " + response.status + ")" + (detail ? ": " + detail : ""));
            return;
        }

        const syncResult = await response.json();
        console.log(`Calendar sync: ${syncResult.newCount ?? 0} new of ${syncResult.syncedCount ?? 0} scanned`);

        await OL.loadCalendarEvents();
        if (OL.calendarState.view === 'grid') await OL.loadCalendarGridMonth();

        // Run task-creation automation rules for any newly-matched events —
        // this is what syncs meeting time to a client's timesheet.
        await OL.processCalendarAutomations();

        OL.calendarState.lastSyncSummary = syncResult;
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
// AUTO-SYNC — periodically re-runs the same sync fetchLiveGoogleCalendar()
// does, so events update without a manual "Sync Calendar" click while a
// tab is open. Only fires while Google is connected, and skips a tick if a
// sync (manual or auto) is already in flight. Complements the server-side
// pg_cron job (see supabase/migrations/auto_sync_cron.sql), which keeps
// calendar_events fresh even when no tab is open at all.
// -------------------------------------------------------------
OL._calendarAutoSyncTimer = null;
OL.startCalendarAutoSync = function(intervalMs = 5 * 60 * 1000) {
    if (OL._calendarAutoSyncTimer) return; // already running, don't stack timers
    OL._calendarAutoSyncTimer = setInterval(() => {
        const isConnected = state.master?.communications?.gmail?.connected || state.master?.googleConnected || false;
        if (!isConnected || OL.calendarState.loading) return;
        OL.fetchLiveGoogleCalendar();
    }, intervalMs);
};

OL.stopCalendarAutoSync = function() {
    if (OL._calendarAutoSyncTimer) clearInterval(OL._calendarAutoSyncTimer);
    OL._calendarAutoSyncTimer = null;
};

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
