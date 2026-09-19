import { esc, state, db, updateAndSync, uid } from '../../core/data.js';

const CALENDAR_PAGE_SIZE = 150;
const CALL_TYPES = ['Follow Up Call', 'Coaching Call', 'Introductory Call', 'General Call'];

OL.calendarState = {
    loading: false,
    view: 'list',            // 'list' | 'calendar'
    calendarSubView: 'month', // 'month' | 'week' | 'day'
    filter: 'upcoming',
    groupBy: 'date',
    callTypeFilter: 'all',
    clientFilter: '',
    limit: CALENDAR_PAGE_SIZE,
    loadedOnce: false,
    gridMonth: (() => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d; })()
};

// -------------------------------------------------------------
// AUTO TIME-TRACKING
// -------------------------------------------------------------
OL.recalculateEventLoggedHours = function(evt) {
    if (!evt.start || !evt.end || evt.all_day) return null;
    const durationHours = Math.max(0, (new Date(evt.end) - new Date(evt.start)) / 3600000);
    const snapshot = Number(evt.duration_hours_snapshot || 0);
    if (Math.abs(durationHours - snapshot) < 0.01) return null;
    return { logged_hours: Math.round(durationHours * 100) / 100, duration_hours_snapshot: Math.round(durationHours * 100) / 100 };
};

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

    OL.checkZoomAuthReturn();

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
                    ${state.master?.zoomConnected ? `
                        <button class="btn small soft" onclick="OL.fetchLiveZoomMeetings()" ${OL.calendarState.zoomSyncing ? 'disabled' : ''} title="Pull recent Zoom AI Companion meeting summaries and match them to calendar events">
                            <i data-lucide="video" style="width:14px;height:14px;${OL.calendarState.zoomSyncing ? 'animation: spin 1s linear infinite;' : ''}"></i>
                            ${OL.calendarState.zoomSyncing ? 'Syncing Zoom...' : 'Sync Zoom'}
                        </button>
                    ` : `
                        <button class="btn small soft" onclick="OL.initiateZoomAuth()">
                            <i data-lucide="video" style="width:14px;height:14px;"></i> Connect Zoom
                        </button>
                    `}
                    <button class="btn small soft" onclick="OL.backfillEventAssigneesFromAttendees()" ${OL._backfillingAssignees ? 'disabled' : ''} title="Auto-assign every unassigned event from its attendee list, where the attendee matches a known Sphynx Team member or client contact">
                        <i data-lucide="wand-2" style="width:14px;height:14px;"></i>
                        ${OL._backfillingAssignees ? 'Backfilling...' : 'Backfill Assignees'}
                    </button>
                    <button class="btn small soft" onclick="OL.backfillCalendarProjectLinks()" ${OL._backfillingCalendarLinks ? 'disabled' : ''} title="Re-check every unlinked event against each project's current Team tab and title/description — catches events synced before a matching attendee was added to a project, or where a former ambiguous match has since resolved to one project">
                        <i data-lucide="link-2" style="width:14px;height:14px;"></i>
                        ${OL._backfillingCalendarLinks ? 'Backfilling...' : 'Backfill Project Links'}
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
                        
                        <!-- Primary View Switcher -->
                        <button class="btn tiny ${OL.calendarState.view === 'list' ? 'primary' : 'soft'}" onclick="OL.setCalendarView('list')">
                            <i data-lucide="list" style="width:12px;height:12px;"></i> List
                        </button>
                        <button class="btn tiny ${OL.calendarState.view === 'calendar' ? 'primary' : 'soft'}" onclick="OL.setCalendarView('calendar')">
                            <i data-lucide="calendar-days" style="width:12px;height:12px;"></i> Calendar
                        </button>
                    
                        <!-- Sub-View Controls (Only visible when Calendar view is selected) -->
                        ${OL.calendarState.view === 'calendar' ? `
                            <div style="display:flex; background:rgba(255,255,255,0.05); border:1px solid var(--line); border-radius:6px; padding:2px; margin-left:6px;">
                                <button class="btn tiny ${OL.calendarState.calendarSubView === 'month' ? 'primary' : 'ghost'}" style="padding:2px 8px; font-size:11px;" onclick="OL.setCalendarSubView('month')">Month</button>
                                <button class="btn tiny ${OL.calendarState.calendarSubView === 'week' ? 'primary' : 'ghost'}" style="padding:2px 8px; font-size:11px;" onclick="OL.setCalendarSubView('week')">Week</button>
                                <button class="btn tiny ${OL.calendarState.calendarSubView === 'day' ? 'primary' : 'ghost'}" style="padding:2px 8px; font-size:11px;" onclick="OL.setCalendarSubView('day')">Day</button>
                            </div>
                        ` : ''}
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

                ${OL.calendarState.view === 'list' ? OL.renderCalendarFilterBar() : ''}

                ${OL.calendarState.view === 'list' 
                    ? OL.renderCalendarList(OL.applyCalendarFilters(events)) 
                    : (OL.calendarState.calendarSubView === 'week' 
                        ? OL.renderCalendarWeek() 
                        : OL.calendarState.calendarSubView === 'day' 
                            ? OL.renderCalendarDay() 
                            : OL.renderCalendarGrid())}
            </div>
        `}
    `;

    if (window.lucide) lucide.createIcons();
};

// -------------------------------------------------------------
// FILTER BAR WITH SEARCHABLE PROJECT PICKER
// -------------------------------------------------------------
OL.renderCalendarFilterBar = function() {
    return `
        <div style="display:flex; flex-wrap:wrap; gap:14px; align-items:center; margin-bottom:16px; padding-bottom:14px; border-bottom:1px solid var(--line);">
            <div style="display:flex; flex-wrap:wrap; gap:6px; align-items:center;">
                <span class="tiny muted uppercase bold" style="margin-right:2px;">Type:</span>
                <button class="btn tiny ${OL.calendarState.callTypeFilter === 'all' ? 'primary' : 'soft'}" onclick="OL.setCalendarCallTypeFilter('all')">All</button>
                ${CALL_TYPES.map(t => `
                    <button class="btn tiny ${OL.calendarState.callTypeFilter === t ? 'primary' : 'soft'}" onclick="OL.setCalendarCallTypeFilter('${t}')">${esc(t)}</button>
                `).join('')}
                <button class="btn tiny ${OL.calendarState.callTypeFilter === 'uncategorized' ? 'primary' : 'soft'}" onclick="OL.setCalendarCallTypeFilter('uncategorized')">Other</button>
            </div>

            <div style="display:flex; gap:6px; align-items:center;">
                <span class="tiny muted uppercase bold" style="flex-shrink:0;">Project:</span>
                ${typeof OL.renderSearchableClientPicker === 'function' ? OL.renderSearchableClientPicker({
                    id: 'calendar-project-filter',
                    value: OL.calendarState.clientFilter || '',
                    placeholder: 'All Projects...',
                    includeGeneral: false,
                    onSelectFn: 'OL.onCalendarProjectFilterSelected',
                    style: 'min-width:180px;'
                }) : `
                    <select class="modal-input tiny" style="width:auto;" onchange="OL.setCalendarClientFilter(this.value)">
                        <option value="">All Projects</option>
                        <option value="__unlinked__">Unlinked</option>
                        ${Object.values(state.clients || {}).map(c => `<option value="${c.id}">${esc(c.meta?.name || c.id)}</option>`).join('')}
                    </select>
                `}
            </div>

            <div style="display:flex; gap:6px; align-items:center; margin-left:auto;">
                <span class="tiny muted uppercase bold">Group By:</span>
                <button class="btn tiny ${OL.calendarState.groupBy === 'date' ? 'primary' : 'soft'}" onclick="OL.setCalendarGroupBy('date')">Date</button>
                <button class="btn tiny ${OL.calendarState.groupBy === 'project' ? 'primary' : 'soft'}" onclick="OL.setCalendarGroupBy('project')">Project</button>
                <button class="btn tiny ${OL.calendarState.groupBy === 'type' ? 'primary' : 'soft'}" onclick="OL.setCalendarGroupBy('type')">Type</button>
            </div>
        </div>
    `;
};

OL.onCalendarProjectFilterSelected = function(pickerId, clientId, clientName) {
    if (typeof OL._onSearchableClientSelected === 'function') {
        OL._onSearchableClientSelected(pickerId, clientId, clientName);
    }
    OL.setCalendarClientFilter(clientId);
};

OL.applyCalendarFilters = function(events) {
    return events.filter(evt => {
        if (OL.calendarState.callTypeFilter === 'uncategorized') {
            if (evt.call_type) return false;
        } else if (OL.calendarState.callTypeFilter !== 'all') {
            if (evt.call_type !== OL.calendarState.callTypeFilter) return false;
        }

        if (OL.calendarState.clientFilter === '__unlinked__') {
            if (evt.linked_client_id) return false;
        } else if (OL.calendarState.clientFilter) {
            if (evt.linked_client_id !== OL.calendarState.clientFilter) return false;
        }

        return true;
    });
};

OL.setCalendarCallTypeFilter = function(value) {
    OL.calendarState.callTypeFilter = value;
    OL.renderBusinessCalendar();
};

OL.setCalendarClientFilter = function(value) {
    OL.calendarState.clientFilter = value;
    OL.renderBusinessCalendar();
};

OL.setCalendarGroupBy = function(value) {
    OL.calendarState.groupBy = value;
    OL.renderBusinessCalendar();
};

// -------------------------------------------------------------
// LIST VIEW
// -------------------------------------------------------------
OL.renderCalendarList = function(events) {
    if (events.length === 0) {
        return `
            <div style="text-align:center; padding: 40px; color: var(--muted);">
                <i data-lucide="calendar-off" style="width:36px;height:32px;margin-bottom:8px;opacity:0.5;"></i>
                <div>No ${OL.calendarState.filter === 'past' ? 'past' : OL.calendarState.filter === 'all' ? '' : 'upcoming'} events found${OL.calendarState.callTypeFilter !== 'all' || OL.calendarState.clientFilter ? ' matching these filters' : ''}. ${OL.calendarState.callTypeFilter === 'all' && !OL.calendarState.clientFilter ? 'Click "Sync Calendar" above to refresh.' : ''}</div>
            </div>
        `;
    }

    const groupBy = OL.calendarState.groupBy || 'date';
    const groups = [];

    if (groupBy === 'project') {
        const byClient = new Map();
        events.forEach(evt => {
            const key = evt.linked_client_id || '__unlinked__';
            if (!byClient.has(key)) byClient.set(key, []);
            byClient.get(key).push(evt);
        });
        [...byClient.entries()]
            .sort(([a], [b]) => {
                const nameA = a === '__unlinked__' ? '\uffff' : (state.clients[a]?.meta?.name || '');
                const nameB = b === '__unlinked__' ? '\uffff' : (state.clients[b]?.meta?.name || '');
                return nameA.localeCompare(nameB);
            })
            .forEach(([key, items]) => {
                groups.push({ label: key === '__unlinked__' ? 'Unlinked' : (state.clients[key]?.meta?.name || 'Project'), items });
            });
    } else if (groupBy === 'type') {
        const byType = new Map();
        events.forEach(evt => {
            const key = evt.call_type || 'Other';
            if (!byType.has(key)) byType.set(key, []);
            byType.get(key).push(evt);
        });
        const order = [...CALL_TYPES, 'Other'];
        order.forEach(key => { if (byType.has(key)) groups.push({ label: key, items: byType.get(key) }); });
    } else {
        let currentKey = null;
        events.forEach(evt => {
            const d = new Date(evt.start);
            const key = d.toDateString();
            if (key !== currentKey) {
                groups.push({ label: d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }), isToday: key === new Date().toDateString(), items: [] });
                currentKey = key;
            }
            groups[groups.length - 1].items.push(evt);
        });
    }

    return `
        <div style="display:flex; flex-direction:column; gap:18px;">
            ${groups.map(g => `
                <div>
                    <div class="tiny bold uppercase muted" style="margin-bottom:8px; padding-bottom:6px; border-bottom:1px solid var(--line); display:flex; align-items:center; gap:8px;">
                        ${esc(g.label)} <span class="pill tiny soft" style="font-size:9px;">${g.items.length}</span>
                        ${g.isToday ? `<span class="pill tiny accent">Today</span>` : ''}
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
// EVENT ROW
// -------------------------------------------------------------
OL.renderEventRowHTML = function(evt) {
    const assigneeList = evt.assignees?.length ? evt.assignees : (evt.assignee ? [evt.assignee] : []);
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

            <div onclick="event.stopPropagation();" style="flex-shrink:0;">
                <span class="pill tiny soft" 
                      style="font-size:10px; cursor:pointer; background:rgba(56,189,248,0.12); color:var(--accent); font-weight:600; padding:2px 6px; border-radius:10px;"
                      onclick="OL.openEditEventCallTypeDropdown(event, '${evt.id}')"
                      title="Change Call Category">
                    ${esc(evt.call_type || 'Uncategorized')}
                </span>
            </div>
            
            ${projectName ? `
                <div style="flex-shrink:0;" onclick="event.stopPropagation();">
                    ${OL.renderProjectPill(evt.linked_client_id, projectName)}
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

                <div onclick="event.stopPropagation();" style="display:flex; justify-content:center; align-items:center;">
                    <div title="Assignees: ${esc(assigneeList.join(', ') || 'Unassigned')}"
                         style="display:flex; cursor:pointer;"
                         onclick="OL.openEditEventAssigneeDropdown(event, '${evt.id}')">
                        ${assigneeList.length ? assigneeList.slice(0, 3).map((name, i) => {
                            const { avatarBg, avatarColor, avatarContent } = OL.computeAssigneeAvatar ? OL.computeAssigneeAvatar(name) : { avatarBg: '#38bdf8', avatarColor: '#000', avatarContent: name.substring(0, 2).toUpperCase() };
                            return `<div style="width:24px; height:24px; border-radius:50%; background:${avatarBg}; color:${avatarColor}; font-size:10px; font-weight:bold; display:flex; align-items:center; justify-content:center; border:2px solid var(--panel-bg); margin-left:${i > 0 ? '-8px' : '0'};">${avatarContent}</div>`;
                        }).join('') : `<div style="width:24px; height:24px; border-radius:50%; background:rgba(148,163,184,0.15); color:var(--muted); font-size:10px; font-weight:bold; display:flex; align-items:center; justify-content:center;">?</div>`}
                        ${assigneeList.length > 3 ? `<div style="width:24px; height:24px; border-radius:50%; background:rgba(148,163,184,0.2); color:var(--muted); font-size:9px; font-weight:bold; display:flex; align-items:center; justify-content:center; border:2px solid var(--panel-bg); margin-left:-8px;">+${assigneeList.length - 3}</div>` : ''}
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
                <div class="tiny" style="display:flex; gap:6px; align-items:flex-start; margin-bottom:6px;">
                    <i data-lucide="message-square" style="width:10px;height:10px; color:#38bdf8; flex-shrink:0; margin-top:3px;"></i>
                    <strong style="flex-shrink:0;">${esc(c.author || 'Someone')}</strong>
                    <span class="muted" style="font-size:10px; flex-shrink:0;">${c.date ? esc(new Date(c.date).toLocaleDateString([], { dateStyle: 'medium' })) : ''}</span>
                    <span style="flex:1; min-width:0; white-space:normal; overflow-wrap:break-word; line-height:1.4;">${OL.renderCommentTextWithMentions ? OL.renderCommentTextWithMentions(c.text) : esc(c.text)}</span>
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
    if (view === 'calendar') {
        OL.loadCalendarGridMonth().then(() => OL.renderBusinessCalendar());
    } else {
        OL.renderBusinessCalendar();
    }
};

OL.setCalendarSubView = function(subView) {
    OL.calendarState.calendarSubView = subView;
    if (OL.calendarState.view !== 'calendar') {
        OL.calendarState.view = 'calendar';
    }

    // Set anchor date to today for Week/Day view if navigating from Month view
    if (subView === 'week' || subView === 'day') {
        OL.calendarState.gridMonth = new Date();
    } else if (subView === 'month') {
        const d = new Date();
        d.setDate(1);
        d.setHours(0, 0, 0, 0);
        OL.calendarState.gridMonth = d;
    }

    OL.loadCalendarGridMonth().then(() => OL.renderBusinessCalendar());
};

OL.loadMoreCalendarEvents = function() {
    OL.calendarState.limit += CALENDAR_PAGE_SIZE;
    OL.loadCalendarEvents().then(() => OL.renderBusinessCalendar());
};

// -------------------------------------------------------------
// GRID VIEW
// -------------------------------------------------------------
OL.renderCalendarGrid = function() {
    const month = OL.calendarState.gridMonth;
    const year = month.getFullYear();
    const monthIdx = month.getMonth();
    const firstOfMonth = new Date(year, monthIdx, 1);
    const firstCell = new Date(firstOfMonth);
    firstCell.setDate(firstCell.getDate() - firstCell.getDay());

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
    const anchor = new Date(OL.calendarState.gridMonth);
    let start, end;

    if (OL.calendarState.calendarSubView === 'day') {
        // Start of day to end of day
        start = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate(), 0, 0, 0);
        end = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate(), 23, 59, 59);
    } else if (OL.calendarState.calendarSubView === 'week') {
        // Start of Sunday to end of Saturday
        const dayOfWeek = anchor.getDay();
        start = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() - dayOfWeek, 0, 0, 0);
        end = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + (6 - dayOfWeek), 23, 59, 59);
    } else {
        // Full month (plus padding for grid overhang)
        start = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
        end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1);
    }

    const { data, error } = await db
        .from('calendar_events')
        .select('id, title, start, end, all_day, location, link, linked_client_id, calendar_summary, assignee, assignees, attendee_emails, billable, logged_hours, duration_hours_snapshot, comments, call_type')
        .gte('start', start.toISOString())
        .lte('start', end.toISOString())
        .order('start', { ascending: true });

    if (error) { 
        console.error('Failed to load calendar events:', error.message); 
        return; 
    }
    
    OL._calendarGridEvents = data || [];
    await OL.applyEventTimeRecalculation(OL._calendarGridEvents);
};

// -------------------------------------------------------------
// LOAD LIST VIEW FROM SUPABASE
// -------------------------------------------------------------
OL.loadCalendarEvents = async function() {
    let query = db.from('calendar_events').select('id, title, start, end, all_day, location, link, linked_client_id, calendar_summary, assignee, assignees, attendee_emails, billable, logged_hours, duration_hours_snapshot, comments, call_type');

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
    state.master.googleCalendarEvents = (data || []).slice().sort((a, b) => new Date(a.start) - new Date(b.start));
    await OL.applyEventTimeRecalculation(state.master.googleCalendarEvents);
};

// -------------------------------------------------------------
// EVENT DETAIL MODAL
// -------------------------------------------------------------
OL.formatEventDescription = function(text) {
    if (!text) return '';
    
    const isHtml = /<[a-z][\s\S]*>/i.test(text);

    if (isHtml) {
        const tempContainer = document.createElement('div');
        tempContainer.innerHTML = text;
        tempContainer.querySelectorAll('a').forEach(a => {
            a.setAttribute('target', '_blank');
            a.setAttribute('rel', 'noopener noreferrer');
            a.style.color = 'var(--accent)';
        });
        return tempContainer.innerHTML;
    }

    const escaped = esc(text);
    const withLinks = escaped.replace(/(https?:\/\/[^\s<]+)/g, url => `<a href="${url}" target="_blank" rel="noopener noreferrer" style="color:var(--accent);">${url}</a>`);

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

    const formatLocation = (loc) => {
        if (!loc) return '';
        const trimmed = loc.trim();
        const urlMatch = trimmed.match(/(https?:\/\/[^\s<]+)/i);
        if (urlMatch) {
            const url = urlMatch[0];
            return `<a href="${url}" target="_blank" rel="noopener noreferrer" style="color:var(--accent); word-break:break-all; text-decoration:underline;">${esc(trimmed)}</a>`;
        }
        return esc(trimmed);
    };

    const attendeeListHTML = (Array.isArray(evt.attendee_emails) && evt.attendee_emails.length > 0)
        ? evt.attendee_emails.map(email => OL.renderContactPillOrPrompt(email, { clientId: evt.linked_client_id })).join(' ')
        : '<span class="muted">None listed</span>';
    
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
                            <span onclick="event.stopPropagation();">${OL.renderProjectPill(evt.linked_client_id, projectName)}</span>
                        ` : ''}
                        <div id="calendar-event-project-picker-${evt.id}">${OL.renderCalendarEventProjectPicker(evt)}</div>
                        <span class="pill tiny soft" style="font-weight:bold; cursor:pointer; display:inline-flex; align-items:center; gap:4px;"
                              onclick="OL.openEditEventAssigneeDropdown(event, '${evt.id}')">
                            <i data-lucide="pencil" style="width:10px;height:10px;"></i> Assignees: ${esc((evt.assignees?.length ? evt.assignees : (evt.assignee ? [evt.assignee] : [])).join(', ') || 'Unassigned')}
                        </span>
                        <span title="${evt.billable === false ? 'Non-billable — click to mark billable' : 'Billable — click to mark non-billable'}"
                              style="cursor:pointer; font-size:11px; font-weight:bold; padding:3px 8px; border-radius:10px; ${evt.billable === false ? 'background:rgba(148,163,184,0.15); color:var(--muted);' : 'background:rgba(34,197,94,0.15); color:#22c55e;'}"
                              onclick="OL.toggleEventBillable('${evt.id}')">
                            ${evt.billable === false ? '⊘ Non-billable' : '$ Billable'}
                        </span>
                        <span class="pill tiny" style="font-weight:bold; padding:3px 8px; border-radius:10px; cursor:pointer; background:${evt.call_type ? 'rgba(56,189,248,0.15)' : 'rgba(148,163,184,0.15)'}; color:${evt.call_type ? 'var(--accent)' : 'var(--muted)'}; border:1px solid var(--line);"
                              onclick="OL.openEditEventCallTypeDropdown(event, '${evt.id}')">
                            ${esc(evt.call_type || 'Uncategorized')}
                        </span>
                    </div>

                    <div style="display:grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 20px; background:rgba(0,0,0,0.15); padding:14px; border-radius:6px; border:1px solid var(--line);" class="tiny">
                        <div><strong class="muted">When:</strong> ${esc(startLabel)}${endLabel ? ` – ${esc(endLabel)}` : ''}</div>
                        <div>
                            <strong class="muted">Logged Time:</strong> <span style="color:var(--accent); font-weight:bold;">${Number(evt.logged_hours || 0).toFixed(1)}h</span>
                            <span class="tiny muted">(auto from duration)</span>
                            <button class="btn tiny soft" onclick="OL.openEditEventTimeModal('${evt.id}')" style="padding:2px 5px; margin-left:4px;"><i data-lucide="pencil" style="width:10px;height:10px;"></i></button>
                        </div>
                        <div style="grid-column: span 2; display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                            <strong class="muted">Attendees:</strong> ${attendeeListHTML}
                        </div>
                        ${evt.location ? `<div style="grid-column: span 2; overflow-wrap:anywhere;"><strong class="muted">Where:</strong> ${formatLocation(evt.location)}</div>` : ''}
                        ${showCalendarBadge ? `<div style="grid-column: span 2;"><strong class="muted">Calendar:</strong> ${esc(evt.calendar_summary)}</div>` : ''}
                    </div>

                    ${evt.description ? `
                        <div style="margin-bottom: 20px; background: rgba(255,255,255,0.02); padding: 14px; border-radius: 6px; border:1px solid var(--line);">
                            <label class="bold tiny uppercase muted" style="display:block; margin-bottom:6px;">Description</label>
                            <div id="event-desc-${evt.id}" style="font-size:13px; line-height:1.5; color:var(--text); overflow-wrap: break-word; max-height:160px; overflow:hidden;">${OL.formatEventDescription(evt.description)}</div>
                            <button id="event-desc-toggle-${evt.id}" class="btn tiny soft" style="display:none; margin-top:8px;" onclick="OL.toggleEventDescription('${evt.id}')">Show more</button>
                        </div>
                    ` : ''}

                    ${evt.zoom_summary ? `
                        <div style="margin-bottom: 20px; background: rgba(37,99,235,0.05); padding: 14px; border-radius: 6px; border:1px solid rgba(37,99,235,0.25);">
                            <label class="bold tiny uppercase muted" style="display:flex; align-items:center; gap:6px; margin-bottom:6px;">
                                <i data-lucide="video" style="width:12px;height:12px;color:#38bdf8;"></i> Zoom Summary
                            </label>
                            <div style="font-size:13px; line-height:1.5; color:var(--text); white-space:pre-wrap; overflow-wrap:break-word;">${OL.formatEventDescription(evt.zoom_summary)}</div>
                            ${evt.linked_client_id ? `
                                <div style="margin-top:12px; display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
                                    <button class="btn tiny primary" onclick="OL.openMeetingSummaryEmail('${evt.id}')">✉️ ${evt.summary_sent_at ? 'Resend' : 'Prepare'} summary email</button>
                                    ${evt.summary_sent_at ? `<span class="tiny muted">Sent ${new Date(evt.summary_sent_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span>` : ''}
                                </div>
                            ` : ''}
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

    // Only show the "Show more" toggle when the description actually
    // overflows the collapsed height -- a short one-liner shouldn't get a
    // button that does nothing when clicked. Has to run after the modal is
    // in the DOM (scrollHeight isn't meaningful before layout happens).
    if (evt.description) {
        const descEl = document.getElementById(`event-desc-${evt.id}`);
        const toggleBtn = document.getElementById(`event-desc-toggle-${evt.id}`);
        if (descEl && toggleBtn && descEl.scrollHeight > descEl.clientHeight + 2) {
            toggleBtn.style.display = 'inline-flex';
        }
    }
};

window.OL.openCalendarEventModal = OL.openCalendarEventModal;

OL.toggleEventDescription = function(eventId) {
    const descEl = document.getElementById(`event-desc-${eventId}`);
    const toggleBtn = document.getElementById(`event-desc-toggle-${eventId}`);
    if (!descEl || !toggleBtn) return;

    const isExpanded = descEl.style.maxHeight === 'none';
    descEl.style.maxHeight = isExpanded ? '160px' : 'none';
    descEl.style.overflow = isExpanded ? 'hidden' : 'visible';
    toggleBtn.textContent = isExpanded ? 'Show more' : 'Show less';
};

// -------------------------------------------------------------
// EVENT COMMENTS SIDEBAR
// -------------------------------------------------------------
OL.renderEventCommentsSidebarHTML = function(evt) {
    const own = (evt.comments || []).map(c => ({ ...c, _own: true }));
    const client = evt.linked_client_id ? state.clients[evt.linked_client_id] : null;
    const childTasks = (client?.projectData?.clientTasks || []).filter(t => t.parentEventId === evt.id);
    const rolledUp = childTasks.flatMap(t => (t.comments || []).map(c => ({ ...c, _fromTask: t.title || t.name, _taskId: t.id })));
    const all = [...own, ...rolledUp].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

    return `
        <label class="bold tiny uppercase muted" style="display:block; margin-bottom:8px;">
            <i data-lucide="message-square" style="width:12px;height:12px;vertical-align:sub;"></i> Comments
        </label>

        <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:12px;">
            <div class="tiny muted" style="display:flex; align-items:center; gap:6px;">
                Posting as <strong>${typeof OL.renderContactPillOrPrompt === 'function' ? OL.renderContactPillOrPrompt(OL.getCurrentUserName ? OL.getCurrentUserName() : 'Sphynx Team') : esc(OL.getCurrentUserName ? OL.getCurrentUserName() : 'Sphynx Team')}</strong>
            </div>
            <textarea id="task-comment-input-evt-${evt.id}" class="modal-input tiny" rows="3" placeholder="Add a comment... use @ to tag someone" style="width:100%; box-sizing:border-box;"
                      oninput="OL.handleCommentMentionInput(this, 'evt-${evt.id}')"
                      onkeydown="OL.handleCommentMentionKeydown(event, 'evt-${evt.id}')"></textarea>
            <div id="comment-mention-dropdown-evt-${evt.id}"></div>
            <button class="btn tiny primary" style="align-self:flex-end;" onclick="OL.addEventComment('${evt.id}')">
                <i data-lucide="send" style="width:12px;height:12px;"></i> Post
            </button>
        </div>

        <div style="display:grid; gap:8px; max-height:420px; overflow:auto; min-width:0;">
            ${all.length ? all.map(c => {
                if (c._own && OL._editingEventCommentId === c.id) {
                    return `
                    <div style="background: rgba(255,255,255,0.02); padding:10px; border-radius:6px; border:1px solid var(--accent); min-width:0;">
                        <div class="tiny muted bold" style="margin-bottom:4px;">Editing comment</div>
                        <textarea id="event-comment-edit-editor-${c.id}" class="modal-input tiny" rows="3" style="width:100%; box-sizing:border-box;">${esc(c.text || '')}</textarea>
                        <div style="display:flex; justify-content:flex-end; gap:6px; margin-top:6px;">
                            <button class="btn tiny soft" onclick="OL.cancelEditEventComment('${evt.id}')">Cancel</button>
                            <button class="btn tiny primary" onclick="OL.saveEditedEventComment('${evt.id}', '${c.id}')">Save</button>
                        </div>
                    </div>
                    `;
                }

                const authorDisplay = typeof OL.renderContactPillOrPrompt === 'function' && c.author
                    ? OL.renderContactPillOrPrompt(c.author, { clientId: evt.linked_client_id })
                    : esc(c.author || 'Unknown');

                const currentUserName = OL.getCurrentUserName ? OL.getCurrentUserName() : 'Sphynx Team';
                const isMentioned = (c.mentions || []).some(m => m.name === currentUserName);
                const alreadyViewed = (c.viewedBy || []).some(v => v.name === currentUserName);
                const viewedNames = (c.viewedBy || []).map(v => v.name);
                const viewedClickArgs = c._fromTask ? `'${evt.id}', '${c.id}', '${c._taskId}'` : `'${evt.id}', '${c.id}'`;

                return `
                <div style="background: rgba(255,255,255,0.02); padding:10px; border-radius:6px; border:1px solid var(--line); min-width:0;">
                    <div class="tiny muted bold" style="margin-bottom:4px; display:flex; justify-content:space-between; align-items:center; gap:8px;">
                        <span style="display:inline-flex; align-items:center; gap:4px; flex-wrap:wrap;">
                            ${authorDisplay}
                            ${c._fromTask ? ` <span class="pill tiny soft" style="font-size:9px; margin-left:4px; cursor:pointer;" onclick="OL.closeModal(); OL.openTaskInContext('${evt.linked_client_id}', '${c._taskId}')" title="From task: ${esc(c._fromTask)}"><i data-lucide="check-square" style="width:9px;height:9px;"></i> ${esc(c._fromTask)}</span>` : ''}
                            ${c.editedDate ? ' <span class="tiny muted" style="font-style:italic;">(edited)</span>' : ''}
                        </span>
                        <span style="display:flex; align-items:center; gap:8px; flex-shrink:0;">
                            <span>${c.date ? esc(new Date(c.date).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })) : ''}</span>
                            ${c._own ? `
                                <button class="btn tiny soft" style="padding:2px 4px;" title="Edit comment" onclick="OL.startEditEventComment('${evt.id}', '${c.id}')"><i data-lucide="pencil" style="width:10px;height:10px;"></i></button>
                                <button class="btn tiny soft" style="padding:2px 4px; color:#ef4444;" title="Delete comment" onclick="OL.deleteEventComment('${evt.id}', '${c.id}')"><i data-lucide="trash-2" style="width:10px;height:10px;"></i></button>
                            ` : ''}
                        </span>
                    </div>
                    <div class="tiny" style="line-height:1.5; white-space:pre-wrap; overflow-wrap:break-word; word-break:break-word;">${OL.renderCommentTextWithMentions ? OL.renderCommentTextWithMentions(c.text, c.html) : esc(c.text)}</div>
                    ${isMentioned && !alreadyViewed ? `
                        <label class="tiny" style="display:flex; align-items:center; gap:5px; margin-top:6px; cursor:pointer; color:var(--accent);">
                            <input type="checkbox" onclick="OL.markEventCommentViewed(${viewedClickArgs})" style="cursor:pointer; margin:0;">
                            You were tagged — mark as viewed
                        </label>
                    ` : ''}
                    ${viewedNames.length ? `
                        <div class="tiny muted" style="margin-top:4px; font-style:italic;">${esc(viewedNames.join(', '))} viewed this comment</div>
                    ` : ''}
                </div>
                `;
            }).join('') : `<div class="tiny muted">No comments yet.</div>`}
        </div>
    `;
};

OL._editingEventCommentId = null;

OL.markEventCommentViewed = async function(eventId, commentId, taskId) {
    const currentUserName = OL.getCurrentUserName ? OL.getCurrentUserName() : 'Sphynx Team';

    if (taskId) {
        // This comment actually lives on a child task, just rolled up onto
        // the event's thread for display — update it at its real home.
        const evt = (state.master?.googleCalendarEvents || []).find(e => e.id === eventId) || (OL._calendarGridEvents || []).find(e => e.id === eventId);
        const clientId = evt?.linked_client_id;
        if (clientId) {
            await updateAndSync(() => {
                const client = state.clients?.[clientId];
                const task = client?.projectData?.clientTasks?.find(t => String(t.id) === String(taskId));
                const comment = task?.comments?.find(c => c.id === commentId);
                if (comment) {
                    if (!comment.viewedBy) comment.viewedBy = [];
                    if (!comment.viewedBy.some(v => v.name === currentUserName)) {
                        comment.viewedBy.push({ name: currentUserName, date: new Date().toISOString() });
                    }
                }
            }, clientId);
        }
    } else {
        // Comment lives directly on this event.
        const { data: current, error: fetchErr } = await db.from('calendar_events').select('comments').eq('id', eventId).single();
        if (fetchErr) { alert('Failed to load comment: ' + fetchErr.message); return; }

        const comments = (current?.comments || []).map(c => {
            if (c.id !== commentId) return c;
            const viewedBy = c.viewedBy || [];
            if (viewedBy.some(v => v.name === currentUserName)) return c;
            return { ...c, viewedBy: [...viewedBy, { name: currentUserName, date: new Date().toISOString() }] };
        });

        const { error } = await db.from('calendar_events').update({ comments }).eq('id', eventId);
        if (error) { alert('Failed to save: ' + error.message); return; }

        [state.master?.googleCalendarEvents, OL._calendarGridEvents].forEach(list => {
            const e = (list || []).find(e => e.id === eventId);
            if (e) e.comments = comments;
        });
    }

    if (OL._activeEventModalId === eventId) OL.openCalendarEventModal(eventId);
};

OL.startEditEventComment = function(eventId, commentId) {
    OL._editingEventCommentId = commentId;
    if (OL._activeEventModalId === eventId) OL.openCalendarEventModal(eventId);
};

OL.cancelEditEventComment = function(eventId) {
    OL._editingEventCommentId = null;
    if (OL._activeEventModalId === eventId) OL.openCalendarEventModal(eventId);
};

OL.saveEditedEventComment = async function(eventId, commentId) {
    const editor = document.getElementById(`event-comment-edit-editor-${commentId}`);
    if (!editor) return;
    const text = (editor.value || '').trim();
    if (!text) { alert('Comment can\'t be empty — delete it instead if you want it gone.'); return; }

    const { data: current, error: fetchErr } = await db.from('calendar_events').select('comments').eq('id', eventId).single();
    if (fetchErr) { alert('Failed to load comment: ' + fetchErr.message); return; }

    const comments = (current?.comments || []).map(c =>
        c.id === commentId
            ? { ...c, text, mentions: OL.extractMentions ? OL.extractMentions(text) : c.mentions, editedDate: new Date().toISOString() }
            : c
    );

    const { error } = await db.from('calendar_events').update({ comments }).eq('id', eventId);
    if (error) { alert('Failed to save comment: ' + error.message); return; }

    [state.master?.googleCalendarEvents, OL._calendarGridEvents].forEach(list => {
        const evt = (list || []).find(e => e.id === eventId);
        if (evt) evt.comments = comments;
    });

    OL._editingEventCommentId = null;
    if (OL._activeEventModalId === eventId) OL.openCalendarEventModal(eventId);
};

OL.deleteEventComment = async function(eventId, commentId) {
    if (!confirm('Delete this comment? This can\'t be undone.')) return;

    const { data: current, error: fetchErr } = await db.from('calendar_events').select('comments').eq('id', eventId).single();
    if (fetchErr) { alert('Failed to load comment: ' + fetchErr.message); return; }

    const comments = (current?.comments || []).filter(c => c.id !== commentId);

    const { error } = await db.from('calendar_events').update({ comments }).eq('id', eventId);
    if (error) { alert('Failed to delete comment: ' + error.message); return; }

    [state.master?.googleCalendarEvents, OL._calendarGridEvents].forEach(list => {
        const evt = (list || []).find(e => e.id === eventId);
        if (evt) evt.comments = comments;
    });

    if (OL._activeEventModalId === eventId) OL.openCalendarEventModal(eventId);
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

// Manually link (or unlink) a calendar event to a project. Auto-linking
// (see get-calendar-events / backfill-calendar-links) only ever links when
// exactly one project matches — by design, to avoid guessing wrong — so
// any event with no attendee/text match, or an AMBIGUOUS match across two+
// projects, needs a human to pick. This is that picker.
//
// Search-as-you-type instead of a plain <select> — matches the picker used
// elsewhere (the Gmail message linking modal's Project field). A single
// shared object rather than keying by event id: only one event modal is
// ever open at a time, same pattern as OL._editingEventCommentId etc.
OL._calendarProjectPicker = { query: '', focused: false };

OL.renderCalendarEventProjectPicker = function(evt) {
    const pp = OL._calendarProjectPicker;

    if (evt.linked_client_id) {
        // The project badge next to this already shows the name and links
        // to the workspace — this just needs to offer changing it, same as
        // "Change" does in the Gmail link picker (clears the selection,
        // which drops back into the search box below).
        return `
            <div id="calendar-event-project-picker-${evt.id}">
                <button class="btn tiny soft" onclick="OL.setCalendarEventClient('${evt.id}', '')">Change project</button>
            </div>
        `;
    }

    const q = (pp.query || '').toLowerCase().trim();
    const filtered = Object.values(state.clients || {})
        .filter(c => c?.meta?.name)
        .filter(c => !q || c.meta.name.toLowerCase().includes(q))
        .sort((a, b) => (a.meta.name || '').localeCompare(b.meta.name || ''))
        .slice(0, 30);

    return `
        <div id="calendar-event-project-picker-${evt.id}" style="min-width:200px; position:relative;">
            <input type="text" id="calendar-event-project-search-${evt.id}" class="modal-input tiny" style="width:100%; box-sizing:border-box;"
                   placeholder="Search projects to link..." value="${esc(pp.query || '')}"
                   onfocus="OL.setCalendarEventProjectFocus('${evt.id}', true)"
                   oninput="OL.setCalendarEventProjectQuery('${evt.id}', this.value)">
            ${pp.focused ? `
                <div style="max-height:160px; overflow:auto; margin-top:4px; display:grid; gap:3px; position:absolute; top:100%; left:0; right:0; z-index:20; background:var(--bg-card, #1e293b); border:1px solid var(--line); border-radius:6px; padding:4px; box-shadow:0 4px 12px rgba(0,0,0,0.3);">
                    ${filtered.length ? filtered.map(c => `
                        <div class="tiny" style="padding:6px 8px; border-radius:5px; cursor:pointer;" onmouseover="this.style.background='rgba(255,255,255,0.06)'" onmouseout="this.style.background='transparent'" onmousedown="OL.setCalendarEventClient('${evt.id}', '${c.id}')">${esc(c.meta.name)}</div>
                    `).join('') : `<div class="tiny muted" style="padding:6px;">No matching projects.</div>`}
                </div>
            ` : ''}
        </div>
    `;
};

OL._findLiveCalendarEvent = function(eventId) {
    return (state.master?.googleCalendarEvents || []).find(e => e.id === eventId)
        || (OL._calendarGridEvents || []).find(e => e.id === eventId);
};

OL.setCalendarEventProjectFocus = function(eventId, value) {
    OL._calendarProjectPicker.focused = value;
    const evt = OL._findLiveCalendarEvent(eventId);
    const container = document.getElementById(`calendar-event-project-picker-${eventId}`);
    if (evt && container) {
        container.outerHTML = OL.renderCalendarEventProjectPicker(evt);
        if (window.lucide) lucide.createIcons();
    }
};

OL.setCalendarEventProjectQuery = function(eventId, value) {
    OL._calendarProjectPicker.query = value;
    const evt = OL._findLiveCalendarEvent(eventId);
    if (!evt) return;
    // Re-rendering on every keystroke destroys and recreates the input —
    // reRenderPreservingFocus (see communications.js) restores focus and
    // cursor position by element id afterward, same fix as the earlier
    // Gmail-link-fields-losing-focus-while-typing bug.
    OL.reRenderPreservingFocus(() => {
        const container = document.getElementById(`calendar-event-project-picker-${eventId}`);
        if (container) {
            container.outerHTML = OL.renderCalendarEventProjectPicker(evt);
            if (window.lucide) lucide.createIcons();
        }
    });
};

OL.setCalendarEventClient = async function(eventId, clientId) {
    const { error } = await db.from('calendar_events').update({ linked_client_id: clientId || null }).eq('id', eventId);
    if (error) { alert('Failed to update project link: ' + error.message); return; }

    [state.master?.googleCalendarEvents, OL._calendarGridEvents].forEach(list => {
        const e = (list || []).find(e => e.id === eventId);
        if (e) e.linked_client_id = clientId || null;
    });

    OL._calendarProjectPicker = { query: '', focused: false };

    if (OL._activeEventModalId === eventId) OL.openCalendarEventModal(eventId);
    else OL.refreshTaskView();
};

// -------------------------------------------------------------
// MULTI-ASSIGNEE DROPDOWN WITH FALLBACK ROSTER
// -------------------------------------------------------------
OL.openEditEventAssigneeDropdown = function(event, id) {
    const evt = (OL._calendarGridEvents || []).find(e => e.id === id)
        || (state.master?.googleCalendarEvents || []).find(e => e.id === id);
    const current = evt?.assignees?.length ? evt.assignees : (evt?.assignee ? [evt.assignee] : []);

    const defaultRoster = [
        { name: "Admin Owner" },
        { name: "Lead Developer" }
    ];
    const team = (state.master?.sphynxTeam && state.master.sphynxTeam.length > 0)
        ? state.master.sphynxTeam
        : defaultRoster;

    const popover = OL.createPopoverContainer(event);
    popover.innerHTML = `
        <div class="tiny bold uppercase muted" style="margin-bottom:6px; padding:2px 4px;">Assign Event (multiple OK)</div>
        ${(evt?.attendee_emails || []).length ? `
            <button class="btn tiny primary" style="width:100%; margin-bottom:6px;" onclick="OL.autoAssignEventFromAttendees('${id}'); OL.closePopoverDropdown();">
                <i data-lucide="wand-2" style="width:11px;height:11px;"></i> Auto-assign from attendees
            </button>
        ` : ''}
        <div style="display:grid; gap:4px; max-height:260px; overflow-y:auto;">
            ${team.map(m => `
                <button class="btn tiny ${current.includes(m.name) ? 'primary' : 'soft'}" style="text-align:left; display:flex; align-items:center; gap:6px;" onclick="OL.toggleEventAssignee('${id}', '${esc(m.name)}')">
                    ${current.includes(m.name) ? '<i data-lucide="check" style="width:11px;height:11px;"></i>' : ''} ${esc(m.name)}
                </button>
            `).join('')}
        </div>
        <button class="btn tiny soft" style="width:100%; margin-top:8px;" onclick="OL.closePopoverDropdown()">Done</button>
    `;
    if (window.lucide) lucide.createIcons();
};

OL.openEditEventCallTypeDropdown = function(event, id) {
    const evt = (OL._calendarGridEvents || []).find(e => e.id === id)
        || (state.master?.googleCalendarEvents || []).find(e => e.id === id);

    const popover = OL.createPopoverContainer(event);
    popover.innerHTML = `
        <div class="tiny bold uppercase muted" style="margin-bottom:6px; padding:2px 4px;">Call Category</div>
        <div style="display:grid; gap:4px;">
            <button class="btn tiny ${!evt?.call_type ? 'primary' : 'soft'}" style="text-align:left; display:flex; align-items:center; gap:6px;" onclick="OL.setEventCallType('${id}', ''); OL.closePopoverDropdown();">
                ${!evt?.call_type ? '<i data-lucide="check" style="width:11px;height:11px;"></i>' : ''} Uncategorized
            </button>
            ${CALL_TYPES.map(type => `
                <button class="btn tiny ${evt?.call_type === type ? 'primary' : 'soft'}" style="text-align:left; display:flex; align-items:center; gap:6px;" onclick="OL.setEventCallType('${id}', '${esc(type)}'); OL.closePopoverDropdown();">
                    ${evt?.call_type === type ? '<i data-lucide="check" style="width:11px;height:11px;"></i>' : ''} ${esc(type)}
                </button>
            `).join('')}
        </div>
        <div class="tiny bold uppercase muted" style="margin:8px 0 6px; padding:2px 4px; border-top:1px solid var(--line); padding-top:8px;">Dashboard Visibility</div>
        <button class="btn tiny ${evt?.hidden_from_dashboard ? 'primary' : 'soft'}" style="text-align:left; display:flex; align-items:center; gap:6px; width:100%;" onclick="OL.setEventDashboardHidden('${id}', ${!evt?.hidden_from_dashboard}); OL.closePopoverDropdown();">
            <i data-lucide="${evt?.hidden_from_dashboard ? 'eye-off' : 'eye'}" style="width:11px;height:11px;"></i>
            ${evt?.hidden_from_dashboard ? 'Hidden from Dashboard — click to unhide' : 'Hide from Dashboard'}
        </button>
    `;
    if (window.lucide) lucide.createIcons();
};

OL.setEventCallType = async function(id, callType) {
    const { error } = await db.from('calendar_events').update({ call_type: callType || null }).eq('id', id);
    if (error) { alert('Failed to update call category: ' + error.message); return; }

    [state.master?.googleCalendarEvents, OL._calendarGridEvents].forEach(list => {
        const e = (list || []).find(e => e.id === id);
        if (e) e.call_type = callType || null;
    });

    if (OL._activeEventModalId === id) OL.openCalendarEventModal(id);
    else OL.refreshTaskView();
};

// Excludes an event from the Daily Dashboard's activity feed without
// affecting it anywhere else (still shows normally on the Calendar page,
// still counts toward billing/call-type reporting). Separate flag from
// call_type on purpose — call_type is real reporting data used elsewhere,
// so a fake "Hidden" category there would muddy it.
OL.setEventDashboardHidden = async function(id, hidden) {
    const { error } = await db.from('calendar_events').update({ hidden_from_dashboard: hidden }).eq('id', id);
    if (error) { alert('Failed to update: ' + error.message); return; }

    [state.master?.googleCalendarEvents, OL._calendarGridEvents].forEach(list => {
        const e = (list || []).find(e => e.id === id);
        if (e) e.hidden_from_dashboard = hidden;
    });

    // The Dashboard keeps its own separate cache filtered server-side at
    // load time — force it to refetch so a newly-hidden event actually
    // disappears (or a newly-unhidden one reappears) without a manual reload.
    OL._dashboardEventsCache = null;

    if (OL._activeEventModalId === id) OL.openCalendarEventModal(id);
    else OL.refreshTaskView();
};

OL.toggleEventAssignee = async function(id, name) {
    const evt = (OL._calendarGridEvents || []).find(e => e.id === id)
        || (state.master?.googleCalendarEvents || []).find(e => e.id === id);
    const current = evt?.assignees?.length ? [...evt.assignees] : (evt?.assignee ? [evt.assignee] : []);
    const next = current.includes(name) ? current.filter(n => n !== name) : [...current, name];

    const { error } = await db.from('calendar_events').update({ assignees: next, assignee: next[0] || null }).eq('id', id);
    if (error) { alert('Failed to update: ' + error.message); return; }

    [state.master?.googleCalendarEvents, OL._calendarGridEvents].forEach(list => {
        const e = (list || []).find(e => e.id === id);
        if (e) { e.assignees = next; e.assignee = next[0] || null; }
    });
    if (OL._activeEventModalId === id) OL.openCalendarEventModal(id);
    else OL.refreshTaskView();
};

// -------------------------------------------------------------
// AUTO-ASSIGN FROM ATTENDEES
// -------------------------------------------------------------
OL.autoAssignEventFromAttendees = async function(id) {
    const evt = (OL._calendarGridEvents || []).find(e => e.id === id)
        || (state.master?.googleCalendarEvents || []).find(e => e.id === id);
    if (!evt) return;

    const attendees = evt.attendee_emails || [];
    if (!attendees.length) {
        alert("This event has no attendees on file (Google didn't report any, or it's an event with no other guests).");
        return;
    }

    const roster = state.master?.sphynxTeam || [];
    const matchedNames = new Set(evt.assignees?.length ? evt.assignees : (evt.assignee ? [evt.assignee] : []));
    const unmatched = [];

    attendees.forEach(a => {
        const email = (typeof a === 'string' ? a : a.email || '').toLowerCase().trim();
        if (!email) return;

        const staffMatch = roster.find(m => (m.email || '').toLowerCase() === email);
        if (staffMatch) { matchedNames.add(staffMatch.name); return; }

        const isKnownClientContact = Object.values(state.clients || {}).some(c =>
            (c.projectData?.teamMembers || []).some(tm => (tm.email || '').toLowerCase() === email)
        );
        if (!isKnownClientContact) unmatched.push(typeof a === 'string' ? { email } : a);
    });

    const nextAssignees = [...matchedNames];
    const { error } = await db.from('calendar_events').update({ assignees: nextAssignees, assignee: nextAssignees[0] || null }).eq('id', id);
    if (error) { alert('Failed to save assignees: ' + error.message); return; }

    [state.master?.googleCalendarEvents, OL._calendarGridEvents].forEach(list => {
        const e = (list || []).find(e => e.id === id);
        if (e) { e.assignees = nextAssignees; e.assignee = nextAssignees[0] || null; }
    });

    for (const person of unmatched) {
        const label = person.name ? `${person.name} (${person.email})` : person.email;
        if (!confirm(`"${label}" isn't a Sphynx team member or an existing client contact. Create a new client record for them?`)) continue;

        const defaultName = person.name || person.email.split('@')[0];
        const projectName = prompt('Project / client name:', defaultName);
        if (!projectName || !projectName.trim()) continue;

        const newClientId = 'c-' + uid();
        state.clients[newClientId] = {
            id: newClientId,
            meta: { name: projectName.trim(), status: 'Discovery', createdDate: new Date().toISOString() },
            projectData: {
                teamMembers: [{ id: uid(), name: person.name || projectName.trim(), email: person.email, isPrimaryContact: true, roles: [] }],
                localResources: [], localApps: [], localAnalyses: [], clientTasks: [],
                scopingSheets: [{ id: 'sheet-' + uid(), lineItems: [] }]
            }
        };
        OL.markClientDirty(newClientId);
    }

    if (unmatched.length) await OL.persist();
    if (OL._activeEventModalId === id) OL.openCalendarEventModal(id);
    else OL.refreshTaskView();
};

// -------------------------------------------------------------
// BULK BACKFILL
// -------------------------------------------------------------
OL.backfillCalendarProjectLinks = async function() {
    if (OL._backfillingCalendarLinks) return;
    OL._backfillingCalendarLinks = true;
    OL.renderBusinessCalendar();

    try {
        const response = await fetch("https://kexnnpwjerrnsmifauuo.supabase.co/functions/v1/backfill-calendar-links", { method: "POST", headers: await OL.getAuthHeaders() });
        const refusal = await OL.functionRefusal(response);
        if (refusal) { alert(OL.sendAuthErrorMessage(refusal)); return; }
        if (!response.ok) {
            let detail = '';
            try { detail = (await response.json())?.error || ''; } catch (e) { /* non-json */ }
            alert('Backfill failed' + (detail ? ': ' + detail : ' (see console for details).'));
            console.error('Calendar link backfill failed:', response.status, detail);
            return;
        }

        const result = await response.json();
        console.log('Calendar project link backfill:', result);
        alert(
            `Scanned ${result.scannedCount ?? 0} unlinked events — linked ${result.matchedCount ?? 0}.` +
            (result.stillAmbiguousCount ? ` ${result.stillAmbiguousCount} still match more than one project — link those manually from the event.` : '') +
            (result.note ? ` ${result.note}` : '')
        );

        await OL.loadCalendarEvents();
        if (OL.calendarState.view === 'grid') await OL.loadCalendarGridMonth();
    } catch (err) {
        console.error('Failed to backfill calendar project links:', err);
        alert('Backfill failed — see console for details.');
    } finally {
        OL._backfillingCalendarLinks = false;
        OL.renderBusinessCalendar();
    }
};

OL.backfillEventAssigneesFromAttendees = async function() {
    if (OL._backfillingAssignees) return;
    OL._backfillingAssignees = true;
    OL.renderBusinessCalendar();

    try {
        const { data: rows, error } = await db.from('calendar_events')
            .select('id, assignee, assignees, attendee_emails');

        if (error) { alert('Failed to load events: ' + error.message); return; }

        const unassignedRows = (rows || []).filter(r => {
            const hasAttendees = Array.isArray(r.attendee_emails) && r.attendee_emails.length > 0;
            const hasAssignees = (Array.isArray(r.assignees) && r.assignees.length > 0) || !!r.assignee;
            return hasAttendees && !hasAssignees;
        });

        if (!unassignedRows.length) { 
            alert('Nothing to backfill — every event with attendees already has an assignee.'); 
            return; 
        }

        const roster = state.master?.sphynxTeam || [];
        let updatedCount = 0;
        let noMatchCount = 0;
        const updates = [];

        unassignedRows.forEach(evt => {
            const currentAssignees = Array.isArray(evt.assignees) ? evt.assignees : (evt.assignee ? [evt.assignee] : []);
            const existing = new Set(currentAssignees);
            let matchedAny = false;

            const attendeeEmails = Array.isArray(evt.attendee_emails) ? evt.attendee_emails : [];
            attendeeEmails.forEach(email => {
                const cleanEmail = (typeof email === 'string' ? email : email?.email || '').toLowerCase().trim();
                if (!cleanEmail) return;

                const staffMatch = roster.find(m => (m.email || '').toLowerCase() === cleanEmail);
                if (staffMatch) { existing.add(staffMatch.name); matchedAny = true; }
            });

            if (matchedAny) {
                const nextAssignees = Array.from(existing);
                updates.push({ id: evt.id, assignees: nextAssignees, assignee: nextAssignees[0] || null });
                updatedCount++;
            } else {
                noMatchCount++;
            }
        });

        for (const u of updates) {
            const { error: updateErr } = await db.from('calendar_events')
                .update({ assignees: u.assignees, assignee: u.assignee })
                .eq('id', u.id);

            if (updateErr) {
                console.error(`Failed to backfill event ${u.id}:`, updateErr.message);
                continue;
            }

            [state.master?.googleCalendarEvents, OL._calendarGridEvents].forEach(list => {
                const e = (list || []).find(e => e.id === u.id);
                if (e) { e.assignees = u.assignees; e.assignee = u.assignee; }
            });
        }

        alert(`Backfilled ${updatedCount} event${updatedCount === 1 ? '' : 's'} from attendee matches.` +
            (noMatchCount ? ` ${noMatchCount} event${noMatchCount === 1 ? '' : 's'} had attendees but none matched a Sphynx Team member — use "Auto-assign from attendees" on those individually to also get the create-a-client prompt.` : ''));
    } finally {
        OL._backfillingAssignees = false;
        OL.renderBusinessCalendar();
    }
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
    if (OL.calendarState.loading) return;
    OL.calendarState.loading = true;
    OL.renderBusinessCalendar();

    try {
        const response = await fetch("https://kexnnpwjerrnsmifauuo.supabase.co/functions/v1/get-calendar-events", { headers: await OL.getAuthHeaders() });

        // Refused because this person is not signed in (or not allowed): that says nothing about the
        // Google connection, so leave the "connected" state alone.
        const refusal = await OL.functionRefusal(response);
        if (refusal) {
            console.warn("Calendar sync refused: " + OL.sendAuthErrorMessage(refusal));
            return;
        }

        if (response.status === 401) {
            updateAndSync(() => {
                if (state.master?.communications?.gmail) state.master.communications.gmail.connected = false;
                if (state.master) state.master.googleConnected = false;
            });
            return;
        }

        if (!response.ok) {
            let detail = '';
            try { detail = (await response.json())?.message || ''; } catch (e) { /* non-json */ }
            console.warn("Calendar sync failed (HTTP " + response.status + ")" + (detail ? ": " + detail : ""));
            return;
        }

        const syncResult = await response.json();
        console.log(`Calendar sync: ${syncResult.newCount ?? 0} new of ${syncResult.syncedCount ?? 0} scanned`);

        await OL.loadCalendarEvents();
        if (OL.calendarState.view === 'grid') await OL.loadCalendarGridMonth();

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
// DIRECT ZOOM SYNC
// Replaces the old add-zoom-summary-webhook flow (external system posts to
// a URL with an eventId you had to look up by hand). This pulls recent
// meeting summaries straight from Zoom and matches them to calendar events
// itself — see supabase/functions/sync-zoom-meetings for the matching and
// action-item-extraction logic.
// -------------------------------------------------------------
// Connect Zoom. The start function needs a signed-in admin: the app asks it for the Zoom address
// (which carries a signed "state" that the callback checks), then goes there.
OL.initiateZoomAuth = async function() {
    try {
        const response = await fetch("https://kexnnpwjerrnsmifauuo.supabase.co/functions/v1/zoom-auth-login", {
            headers: await OL.getAuthHeaders()
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.url) {
            alert(result.error === 'unauthorized' || result.error === 'forbidden'
                ? OL.sendAuthErrorMessage(result)
                : (result.message || 'Could not start the Zoom connection.'));
            return;
        }
        window.location.href = result.url;
    } catch (err) {
        console.error('Could not start the Zoom connection:', err);
        alert('Could not start the Zoom connection — see console for details.');
    }
};

OL.checkZoomAuthReturn = function() {
    if (OL._zoomAuthReturnHandled) return;

    const urlParams = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.split('?')[1] || '');
    const isConnected = urlParams.get('zoom_connected') === 'true' || hashParams.get('zoom_connected') === 'true';

    if (isConnected) {
        OL._zoomAuthReturnHandled = true;

        updateAndSync(() => {
            if (!state.master) state.master = {};
            state.master.zoomConnected = true;
        });

        const hashPath = window.location.hash.split('?')[0];
        window.history.replaceState({}, document.title, window.location.pathname + hashPath);

        OL.fetchLiveZoomMeetings();
    }
};

OL.fetchLiveZoomMeetings = async function() {
    if (OL.calendarState.zoomSyncing) return;
    OL.calendarState.zoomSyncing = true;
    OL.renderBusinessCalendar();

    try {
        const response = await fetch("https://kexnnpwjerrnsmifauuo.supabase.co/functions/v1/sync-zoom-meetings", { method: "POST", headers: await OL.getAuthHeaders() });

        // Refused because this person is not signed in (or not allowed): that says nothing about the
        // Zoom connection, so leave the "connected" state alone.
        const refusal = await OL.functionRefusal(response);
        if (refusal) {
            console.warn("Zoom sync refused: " + OL.sendAuthErrorMessage(refusal));
            return;
        }

        if (response.status === 401) {
            updateAndSync(() => { if (state.master) state.master.zoomConnected = false; });
            return;
        }

        if (!response.ok) {
            let detail = '';
            try { detail = (await response.json())?.message || ''; } catch (e) { /* non-json */ }
            console.warn("Zoom sync failed (HTTP " + response.status + ")" + (detail ? ": " + detail : ""));
            return;
        }

        const syncResult = await response.json();
        console.log(`Zoom sync: scanned ${syncResult.scannedEvents ?? 0} Zoom-linked events, ${syncResult.summariesPostedCount ?? 0} summaries posted, ${syncResult.tasksCreatedCount ?? 0} action-item tasks created, ${syncResult.noSummaryYetCount ?? 0} not ready yet, ${syncResult.otherErrorCount ?? 0} other errors`, syncResult);

        // Summaries/tasks are written straight to Supabase by the sync
        // function, not through this client's local state -- reload from
        // the DB so the calendar and any open client workspaces pick them up.
        await OL.loadCalendarEvents();
        if (OL.calendarState.view === 'grid') await OL.loadCalendarGridMonth();
        if (typeof OL.loadClientList === 'function') await OL.loadClientList();
    } catch (err) {
        console.error("Failed to sync Zoom meetings:", err);
    } finally {
        OL.calendarState.zoomSyncing = false;
        OL.renderBusinessCalendar();
    }
};

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
            if (!client) return;

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
// AUTO-SYNC
// -------------------------------------------------------------
OL._calendarAutoSyncTimer = null;
OL.startCalendarAutoSync = function(intervalMs = 5 * 60 * 1000) {
    if (OL._calendarAutoSyncTimer) return;
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
// MANAGE CALENDARS
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
        const response = await fetch("https://kexnnpwjerrnsmifauuo.supabase.co/functions/v1/list-google-calendars", { headers: await OL.getAuthHeaders() });
        const container = document.getElementById('manage-calendars-body');
        if (!container) return;

        const refusal = await OL.functionRefusal(response);
        if (refusal) {
            container.innerHTML = `<div class="tiny" style="color:#ef4444;">${esc(OL.sendAuthErrorMessage(refusal))}</div>`;
            return;
        }

        if (response.status === 401) {
            container.innerHTML = `<div class="tiny" style="color:#ef4444;">Your Google connection expired — reconnect it from Gmail Settings, then try again.</div>`;
            return;
        }
        if (!response.ok) {
            let detail = '';
            try { detail = (await response.json())?.message || ''; } catch (e) { /* non-json */ }
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

    const previouslySynced = state.master?.syncedCalendarIds || [];
    const removedCalendarIds = previouslySynced.filter(id => !selected.includes(id));

    await updateAndSync(() => {
        if (!state.master) state.master = {};
        state.master.syncedCalendarIds = selected;
    });

    const { error } = await db.from('workspace_masters').update({ synced_calendar_ids: selected }).eq('id', 'main_state');
    if (error) console.error('Failed to save calendar selection immediately:', error.message);

    if (removedCalendarIds.length) {
        const { error: cleanupError } = await db.from('calendar_events').delete().in('calendar_id', removedCalendarIds);
        if (cleanupError) console.error('Failed to clear events from removed calendar(s):', cleanupError.message);
        else {
            [state.master?.googleCalendarEvents, OL._calendarGridEvents].forEach(list => {
                if (!Array.isArray(list)) return;
                for (let i = list.length - 1; i >= 0; i--) {
                    if (removedCalendarIds.includes(list[i].calendar_id)) list.splice(i, 1);
                }
            });
        }
    }

    OL.closeModal();
    OL.fetchLiveGoogleCalendar();
};

// -------------------------------------------------------------
// WEEK VIEW
// -------------------------------------------------------------
OL.renderCalendarWeek = function() {
    const anchorDate = new Date(OL.calendarState.gridMonth);
    const dayOfWeek = anchorDate.getDay();
    
    // Calculate Sunday of the current week
    const startOfWeek = new Date(anchorDate);
    startOfWeek.setDate(anchorDate.getDate() - dayOfWeek);

    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const events = OL._calendarGridEvents || [];

    const eventsByDay = {};
    events.forEach(evt => {
        const key = new Date(evt.start).toDateString();
        if (!eventsByDay[key]) eventsByDay[key] = [];
        eventsByDay[key].push(evt);
    });

    const todayStr = new Date().toDateString();

    return `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
            <button class="btn tiny soft" onclick="OL.shiftCalendarWeek(-1)"><i data-lucide="chevron-left"></i> Prev Week</button>
            <strong style="font-size:14px;">Week of ${startOfWeek.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}</strong>
            <button class="btn tiny soft" onclick="OL.shiftCalendarWeek(1)">Next Week <i data-lucide="chevron-right"></i></button>
        </div>
        <div style="display:grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap:1px; background:var(--line); border:1px solid var(--line); border-radius:6px; overflow:hidden; width:100%; box-sizing:border-box;">
            ${[0,1,2,3,4,5,6].map(i => {
                const d = new Date(startOfWeek);
                d.setDate(d.getDate() + i);
                const key = d.toDateString();
                const isToday = key === todayStr;
                const dayEvents = eventsByDay[key] || [];
                return `
                    <div style="min-height:280px; min-width:0; padding:4px; background:var(--panel-soft, rgba(255,255,255,0.02)); overflow:hidden; ${isToday ? 'border-top:2px solid var(--accent);' : ''}">
                        <div class="tiny bold muted" style="text-align:center; border-bottom:1px solid var(--line); padding-bottom:4px; margin-bottom:6px; font-size:11px;">
                            ${dayNames[d.getDay()]} <span style="${isToday ? 'color:var(--accent); font-weight:bold;' : 'color:var(--text);'}">${d.getDate()}</span>
                        </div>
                        <div style="display:grid; gap:4px;">
                            ${dayEvents.map(evt => `
                                <div class="tiny" 
                                     style="background:rgba(var(--accent-rgb),0.15); border-left:2px solid var(--accent); border-radius:3px; padding:3px 4px; cursor:pointer; min-width:0; overflow:hidden;" 
                                     onclick="OL.openCalendarEventModal('${evt.id}')" 
                                     title="${esc(evt.title)}">
                                    <div style="font-weight:bold; font-size:10px; line-height:1.2; word-break:break-word; white-space:normal; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;">
                                        ${esc(evt.title)}
                                    </div>
                                    <div style="font-size:8.5px; opacity:0.75; margin-top:2px;">
                                        ${new Date(evt.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
    `;
};

OL.shiftCalendarWeek = function(deltaWeeks) {
    const d = new Date(OL.calendarState.gridMonth);
    d.setDate(d.getDate() + (deltaWeeks * 7));
    OL.calendarState.gridMonth = d;
    OL.loadCalendarGridMonth().then(() => OL.renderBusinessCalendar());
};

OL.shiftCalendarDay = function(deltaDays) {
    const d = new Date(OL.calendarState.gridMonth);
    d.setDate(d.getDate() + deltaDays);
    OL.calendarState.gridMonth = d;
    OL.loadCalendarGridMonth().then(() => OL.renderBusinessCalendar());
};

// -------------------------------------------------------------
// DAY VIEW
// -------------------------------------------------------------
OL.renderCalendarDay = function() {
    const day = new Date(OL.calendarState.gridMonth);
    const key = day.toDateString();
    
    // Match events against local date string
    const dayEvents = (OL._calendarGridEvents || []).filter(e => {
        return new Date(e.start).toDateString() === key;
    });

    return `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
            <button class="btn tiny soft" onclick="OL.shiftCalendarDay(-1)"><i data-lucide="chevron-left"></i> Prev Day</button>
            <strong style="font-size:14px;">${day.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</strong>
            <button class="btn tiny soft" onclick="OL.shiftCalendarDay(1)">Next Day <i data-lucide="chevron-right"></i></button>
        </div>
        <div style="display:grid; gap:8px;">
            ${dayEvents.length ? dayEvents.map(evt => OL.renderCalendarEventRow(evt)).join('') : '<div class="tiny muted" style="padding:20px; text-align:center;">No events scheduled for this day.</div>'}
        </div>
    `;
};
