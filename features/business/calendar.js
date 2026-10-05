import { esc, state, db, updateAndSync, uid, isInBusinessScope, scopeQueryToBusinessClients } from '../../core/data.js';
import { meetingHoursForDay, queuedTaskHoursForDay, loadTier, maxTierFor, TIER_ORDER } from '../../core/scheduling.js';
import { isGenericAssignee } from '../../core/task-assignees.js';
import { loadWorkload } from '../../core/workload.js';
import { getOlSettings } from '../../core/ol-settings.js';
import { MEETING_CATEGORIES, eventBillableFromRules, syncEventBillableFromRules } from '../../core/billable.js';

const CALENDAR_PAGE_SIZE = 150;
// One list, shared with the Billable Rules "Meeting category" field.
const CALL_TYPES = MEETING_CATEGORIES;

OL.calendarState = {
    loading: false,
    view: localStorage.getItem('calendar_view') || 'list',
    calendarSubView: localStorage.getItem('calendar_sub_view') || 'month',
    filter: 'upcoming',
    groupBy: 'date',
    callTypeFilter: 'all',
    clientFilter: '',
    limit: CALENDAR_PAGE_SIZE,
    loadedOnce: false,
    gridMonth: (() => {
        const subView = localStorage.getItem('calendar_sub_view') || 'month';
        const d = new Date();
        if (subView === 'month') {
            d.setDate(1);
            d.setHours(0, 0, 0, 0);
        }
        return d;
    })()
};

// -------------------------------------------------------------
// AUTO TIME-TRACKING
// -------------------------------------------------------------
OL.recalculateEventLoggedHours = function(evt) {
    if (!evt.start || !evt.end || evt.all_day) return null;
    const durationHours = Math.max(0, (new Date(evt.end) - new Date(evt.start)) / 3600000);
    const snapshot = Number(evt.duration_hours_snapshot || 0);
    if (Math.abs(durationHours - snapshot) < 0.01) return null;
    return { logged_hours: Math.round(durationHours * 1000) / 1000, duration_hours_snapshot: Math.round(durationHours * 1000) / 1000 };
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
            // A rescheduled meeting goes back to its scheduled length (best effort: needs the 2026_10 migration).
            .then(() => db.from('calendar_events').update({ logged_hours_source: 'scheduled', time_prompt_skipped: false }).eq('id', u.id).then(() => {}, () => {}))
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
        
        // Always load list events AND grid month events if initialized directly into Calendar view
        const loadPromise = (OL.calendarState.view === 'calendar')
            ? Promise.all([OL.loadCalendarEvents(), OL.calendarState.calendarSubView === 'availability' ? OL.loadAvailabilityEvents() : OL.loadCalendarGridMonth()])
            : OL.loadCalendarEvents();

        loadPromise.then(() => OL.renderBusinessCalendar());
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
                    <button class="btn small primary" onclick="OL.openNewMeetingModal()" title="Create a meeting on the connected Google Calendar and invite people">
                        <i data-lucide="calendar-plus" style="width:14px;height:14px;"></i> New meeting
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
                        ${state.adminMode === true ? `
                        <button class="btn small soft" onclick="OL.initiateZoomAuth()" title="Open Zoom's permission screen again — needed after adding new permissions (scopes) to the Zoom app">
                            <i data-lucide="key-round" style="width:14px;height:14px;"></i> Reconnect Zoom
                        </button>` : ''}
                    ` : `
                        <button class="btn small soft" onclick="OL.initiateZoomAuth()">
                            <i data-lucide="video" style="width:14px;height:14px;"></i> Connect Zoom
                        </button>
                    `}
                    <button class="btn small soft" onclick="OL.backfillEventAssigneesFromAttendees()" ${OL._backfillingAssignees ? 'disabled' : ''} title="Add every Sphynx Team member on each event&#39;s attendee list as an assignee (never removes anyone)">
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
                                <button class="btn tiny ${OL.calendarState.calendarSubView === 'availability' ? 'primary' : 'ghost'}" style="padding:2px 8px; font-size:11px;" onclick="OL.setCalendarSubView('availability')" title="Which days can take a new project, by how booked each person is">Availability</button>
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
                    : (OL.calendarState.calendarSubView === 'availability'
                        ? OL.renderCalendarAvailability()
                    : OL.calendarState.calendarSubView === 'week' 
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
                    <span class="tiny monospace bold" style="color:var(--accent); font-size:11px;" title="Auto-tracked from event duration">${Number(evt.logged_hours || 0).toFixed(2)}h</span>
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
                            const { avatarBg, avatarColor, avatarContent, avatarBorder } = OL.computeAssigneeAvatar ? OL.computeAssigneeAvatar(name) : { avatarBg: '#38bdf8', avatarColor: '#000', avatarContent: name.substring(0, 2).toUpperCase() };
                            return `<div style="width:24px; height:24px; border-radius:50%; background:${avatarBg}; color:${avatarColor}; font-size:10px; font-weight:bold; display:flex; align-items:center; justify-content:center; border:2px solid ${avatarBorder || 'var(--panel-bg)'}; box-sizing:border-box; margin-left:${i > 0 ? '-8px' : '0'};">${avatarContent}</div>`;
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
    localStorage.setItem('calendar_view', view);

    if (view === 'calendar') {
        (OL.calendarState.calendarSubView === 'availability' ? OL.loadAvailabilityEvents() : OL.loadCalendarGridMonth()).then(() => OL.renderBusinessCalendar());
    } else {
        OL.renderBusinessCalendar();
    }
};

OL.setCalendarSubView = function(subView) {
    OL.calendarState.calendarSubView = subView;
    localStorage.setItem('calendar_sub_view', subView);

    if (OL.calendarState.view !== 'calendar') {
        OL.calendarState.view = 'calendar';
        localStorage.setItem('calendar_view', 'calendar');
    }

    // Set anchor date to today for Week/Day view, or 1st of month for Month view
    if (subView === 'week' || subView === 'day') {
        OL.calendarState.gridMonth = new Date();
    } else if (subView === 'month') {
        const d = new Date();
        d.setDate(1);
        d.setHours(0, 0, 0, 0);
        OL.calendarState.gridMonth = d;
    }

    if (subView === 'availability') {
        OL.calendarState.availStart = null;   // back to this week
        OL.loadAvailabilityEvents().then(() => OL.renderBusinessCalendar());
        return;
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

    const { data, error } = await scopeQueryToBusinessClients(db
        .from('calendar_events')
        .select('id, title, start, end, all_day, location, link, linked_client_id, calendar_summary, assignee, assignees, attendee_emails, billable, logged_hours, duration_hours_snapshot, comments, call_type')
        .gte('start', start.toISOString())
        .lte('start', end.toISOString()), 'linked_client_id')
        .order('start', { ascending: true });

    if (error) { 
        console.error('Failed to load calendar events:', error.message); 
        return; 
    }
    
    OL._calendarGridEvents = (data || []).filter(e => isInBusinessScope(e.linked_client_id));
    await OL.applyEventTimeRecalculation(OL._calendarGridEvents);
    // Events nobody toggled by hand follow the Billable Rules.
    await syncEventBillableFromRules(OL._calendarGridEvents);
};

// -------------------------------------------------------------
// LOAD LIST VIEW FROM SUPABASE
// -------------------------------------------------------------
OL.loadCalendarEvents = async function() {
    let query = scopeQueryToBusinessClients(db.from('calendar_events').select('id, title, start, end, all_day, location, link, linked_client_id, calendar_summary, assignee, assignees, attendee_emails, billable, logged_hours, duration_hours_snapshot, comments, call_type'), 'linked_client_id');

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
    // Sort direction must match the filter: "past" was already fetched
    // newest-first from Supabase (order('start', {ascending:false}) above),
    // but this always re-sorted ascending afterward regardless of filter,
    // silently flipping "Past" back to oldest-first every time.
    const sortDir = OL.calendarState.filter === 'past' ? -1 : 1;
    state.master.googleCalendarEvents = (data || []).filter(e => isInBusinessScope(e.linked_client_id)).sort((a, b) => sortDir * (new Date(a.start) - new Date(b.start)));
    await OL.applyEventTimeRecalculation(state.master.googleCalendarEvents);
    // Events nobody toggled by hand follow the Billable Rules.
    await syncEventBillableFromRules(state.master.googleCalendarEvents);
};


// -------------------------------------------------------------
// AVAILABILITY VIEW — which days can take a new project
// -------------------------------------------------------------
// Uses the SAME numbers and cut-offs as the activation auto-scheduler (core/scheduling.js + Templates & settings):
// a person's day = meetings + tasks already due that day (all projects), put into Green / Yellow / Red / Closed (gray).
// A day is "open" for a project status when at least one named person is at or under the level that status may use
// (Ongoing Maintenance up to Red, White Glove up to Yellow, everyone else Green by default).
const AVAIL_WEEKS = 4;
const LEVEL_STYLE = {
    green:  { color: '#16a34a', label: 'Green' },
    yellow: { color: '#ca8a04', label: 'Yellow' },
    red:    { color: '#ef4444', label: 'Red' },
    closed: { color: '#6b7280', label: 'Closed' }
};

const availMonday = (d) => {
    const m = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
    return m;
};
const availKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

OL.loadAvailabilityEvents = async function() {
    const start = OL.calendarState.availStart ? new Date(OL.calendarState.availStart) : availMonday(new Date());
    const end = new Date(start); end.setDate(end.getDate() + AVAIL_WEEKS * 7);
    // Every meeting in the window and every project's tasks (opening projects that were not loaded yet).
    const load = await loadWorkload(start, end);
    OL._availabilityEvents = load.events;
    OL._availabilityTasks = load.tasks;
};

OL.shiftAvailability = function(deltaWeeks) {
    const cur = OL.calendarState.availStart ? new Date(OL.calendarState.availStart) : availMonday(new Date());
    cur.setDate(cur.getDate() + deltaWeeks * 7);
    OL.calendarState.availStart = cur;
    OL.loadAvailabilityEvents().then(() => OL.renderBusinessCalendar());
};

OL.availabilityToday = function() {
    OL.calendarState.availStart = null;
    OL.loadAvailabilityEvents().then(() => OL.renderBusinessCalendar());
};

OL.renderCalendarAvailability = function() {
    const cfg = getOlSettings().scheduling;
    const start = OL.calendarState.availStart ? new Date(OL.calendarState.availStart) : availMonday(new Date());
    const todayKey = availKey(new Date());

    const people = (state.master?.sphynxTeam || []).map(m => String(m.name || '').trim()).filter(n => n && !isGenericAssignee(n));
    const events = OL._availabilityEvents || [];
    const tasks = OL._availabilityTasks || [];

    // The statuses that have their own limit, then everyone else.
    const buckets = [
        ...Object.keys(cfg.maxTierByStatus || {}).map(st => ({ label: st, limit: maxTierFor(st, cfg) })),
        { label: 'Everyone else', limit: maxTierFor('', cfg) }
    ];
    const limitName = (t) => LEVEL_STYLE[t]?.label || t;
    const idx = (t) => TIER_ORDER.indexOf(t);

    const rangeLabel = (() => {
        const end = new Date(start); end.setDate(end.getDate() + AVAIL_WEEKS * 7 - 3);
        return `${start.toLocaleDateString([], { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}`;
    })();

    const legend = ['green', 'yellow', 'red', 'closed'].map(t => {
        const range = t === 'green' ? `under ${cfg.greenUnderHours}h`
            : t === 'yellow' ? `${cfg.greenUnderHours}h–${cfg.yellowUnderHours}h`
            : t === 'red' ? `${cfg.yellowUnderHours}h–${cfg.redUnderHours}h`
            : `${cfg.redUnderHours}h+`;
        return `<span style="display:inline-flex; align-items:center; gap:5px;"><span style="width:10px; height:10px; border-radius:50%; background:${LEVEL_STYLE[t].color};"></span>${LEVEL_STYLE[t].label} <span class="muted">${range}</span></span>`;
    }).join('');

    const rules = buckets.map(b => `<span><b>${esc(b.label)}</b>: up to ${limitName(b.limit)}</span>`).join(' &nbsp;·&nbsp; ');

    const weeks = [];
    for (let w = 0; w < AVAIL_WEEKS; w++) {
        const days = [];
        for (let i = 0; i < 5; i++) { const d = new Date(start); d.setDate(d.getDate() + w * 7 + i); days.push(d); }
        weeks.push(days);
    }

    const cell = (d) => {
        const key = availKey(d);
        const past = key < todayKey;
        const isToday = key === todayKey;
        const rows = people.map(name => {
            const meet = meetingHoursForDay(events, name, key);
            const queued = queuedTaskHoursForDay(tasks, name, key);
            const hours = meet + queued;
            const tier = loadTier(hours, cfg);
            return { name, hours, meet, queued, tier };
        });
        const open = buckets.map(b => ({ label: b.label, ok: rows.some(r => r.tier !== 'closed' && idx(r.tier) <= idx(b.limit)) }));
        const best = rows.length ? rows.reduce((a, r) => (idx(r.tier) < idx(a) ? r.tier : a), 'closed') : 'closed';
        const edge = LEVEL_STYLE[best].color;
        return `
            <div style="min-width:0; padding:6px; background:var(--panel-soft, rgba(255,255,255,0.02)); border-top:3px solid ${past ? 'var(--line)' : edge}; opacity:${past ? 0.5 : 1};">
                <div class="tiny bold" style="margin-bottom:5px; ${isToday ? 'color:var(--accent);' : ''}">${d.toLocaleDateString([], { weekday: 'short' })} ${d.getDate()}</div>
                <div style="display:grid; gap:2px; margin-bottom:6px;">
                    ${rows.map(r => `
                        <div class="tiny" title="${esc(r.name)}: ${r.meet.toFixed(1)}h meetings + ${r.queued.toFixed(1)}h tasks = ${r.hours.toFixed(1)}h (${LEVEL_STYLE[r.tier].label})" style="display:flex; align-items:center; gap:5px; min-width:0;">
                            <span style="width:9px; height:9px; border-radius:50%; flex:none; background:${LEVEL_STYLE[r.tier].color};"></span>
                            <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1;">${esc(r.name.split(' ')[0])}</span>
                            <span class="muted">${r.hours.toFixed(1)}h</span>
                        </div>`).join('') || '<div class="tiny muted">No team members</div>'}
                </div>
                ${past ? '' : `
                <div class="tiny" style="border-top:1px solid var(--line); padding-top:4px; display:grid; gap:1px;">
                    ${open.map(o => `<div style="color:${o.ok ? '#16a34a' : '#6b7280'};">${o.ok ? '✓' : '✕'} ${esc(o.label)}</div>`).join('')}
                </div>`}
            </div>`;
    };

    return `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; flex-wrap:wrap; gap:8px;">
            <div style="display:flex; gap:6px;">
                <button class="btn tiny soft" onclick="OL.shiftAvailability(-1)"><i data-lucide="chevron-left"></i> Prev</button>
                <button class="btn tiny soft" onclick="OL.availabilityToday()">This week</button>
            </div>
            <strong style="font-size:14px;">Availability for new projects · ${rangeLabel}</strong>
            <button class="btn tiny soft" onclick="OL.shiftAvailability(1)">Next <i data-lucide="chevron-right"></i></button>
        </div>
        <div class="tiny" style="display:flex; gap:14px; flex-wrap:wrap; margin-bottom:6px;">${legend}</div>
        <div class="tiny muted" style="margin-bottom:12px;">A project can be given a day when at least one person on it is at or under the level its status allows — ${rules}. Hours are meetings plus tasks already due, across all projects. Cut-offs and limits are set in Automations → Templates &amp; settings.</div>
        <div style="display:grid; gap:10px;">
            ${weeks.map(days => `
                <div style="display:grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap:1px; background:var(--line); border:1px solid var(--line); border-radius:6px; overflow:hidden;">
                    ${days.map(cell).join('')}
                </div>`).join('')}
        </div>
    `;
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

                    ${evt.linked_client_id && new Date(evt.start) < new Date() ? `
                        <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin:-6px 0 18px; padding:10px 12px; border:1px solid rgba(37,99,235,0.3); background:rgba(37,99,235,0.05); border-radius:8px;">
                            <button class="btn small primary" onclick="OL.openMeetingSummaryEmail('${evt.id}')">${evt.summary_sent_at ? 'Resend' : 'Prepare'} summary email</button>
                            <button class="btn small soft" onclick="OL.openContextCompose()" title="Blank email about this meeting (stays open over this window)">New email</button>
                            ${evt.summary_sent_at ? `<span class="tiny muted">Sent ${new Date(evt.summary_sent_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span>` : ''}
                            <span class="tiny muted" style="margin-left:auto;">${OL.zoomStatusLine ? OL.zoomStatusLine(evt) : ''}</span>
                            <button class="btn tiny soft" title="Look this meeting up in Zoom again (summary, action items, recording → Drive)" onclick="OL.recheckZoomForEvent('${evt.id}')"><i data-lucide="refresh-cw" style="width:11px;height:11px;"></i> Re-check Zoom</button>
                        </div>
                    ` : ''}

                    <div style="display:grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 20px; background:rgba(0,0,0,0.15); padding:14px; border-radius:6px; border:1px solid var(--line);" class="tiny">
                        <div><strong class="muted">When:</strong> ${esc(startLabel)}${endLabel ? ` – ${esc(endLabel)}` : ''}</div>
                        <div>
                            <strong class="muted">Logged Time:</strong> <span style="color:var(--accent); font-weight:bold;">${Number(evt.logged_hours || 0).toFixed(2)}h</span>
                            <span class="tiny muted">${evt.logged_hours_source === 'zoom' ? `(from Zoom: scheduled start to actual end${evt.zoom_actual_end ? ', ended ' + esc(new Date(evt.zoom_actual_end).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })) : ''})` : evt.logged_hours_source === 'manual' ? '(set by hand)' : '(auto from duration)'}</span>
                            <button class="btn tiny soft" onclick="OL.openEditEventTimeModal('${evt.id}')" style="padding:2px 5px; margin-left:4px;"><i data-lucide="pencil" style="width:10px;height:10px;"></i></button>
                        </div>
                        <div style="grid-column: span 2; display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                            <strong class="muted">Attendees:</strong> ${attendeeListHTML}
                        </div>
                        ${evt.location ? `<div style="grid-column: span 2; overflow-wrap:anywhere;"><strong class="muted">Where:</strong> ${formatLocation(evt.location)}</div>` : ''}
                        ${showCalendarBadge ? `<div style="grid-column: span 2;"><strong class="muted">Calendar:</strong> ${esc(evt.calendar_summary)}</div>` : ''}
                    </div>

                    ${OL.renderAgendaPlaceholder ? OL.renderAgendaPlaceholder(evt) : ''}

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
    OL.setComposeContext?.({ kind: 'event', clientId: evt.linked_client_id || null, id: evt.id, title: evt.title, attendees: evt.attendee_emails || [] });
    if (OL.renderAgendaSection) OL.renderAgendaSection(evt.id);
    // Handles the (rare) case of reopening this modal for a different
    // unlinked event while the shared picker singleton was already left in
    // its "focused" state from a previous event's modal — makes sure the
    // results list has real coordinates instead of defaulting to 0,0.
    if (!evt.linked_client_id && OL._calendarProjectPicker.focused) {
        OL._positionCalendarEventProjectResults(evt.id);
    }

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
        const evt = (state.master?.googleCalendarEvents || []).find(e => e.id === eventId) || (OL._calendarGridEvents || []).find(e => e.id === eventId) || (OL._dashboardEventsCache || []).find(e => e.id === eventId);
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

        [state.master?.googleCalendarEvents, OL._calendarGridEvents, OL._dashboardEventsCache].forEach(list => {
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

    [state.master?.googleCalendarEvents, OL._calendarGridEvents, OL._dashboardEventsCache].forEach(list => {
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

    [state.master?.googleCalendarEvents, OL._calendarGridEvents, OL._dashboardEventsCache].forEach(list => {
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

    [state.master?.googleCalendarEvents, OL._calendarGridEvents, OL._dashboardEventsCache].forEach(list => {
        const evt = (list || []).find(e => e.id === eventId);
        if (evt) evt.comments = comments;
    });

    OL.openCalendarEventModal(eventId);
};

OL.toggleEventBillable = async function(id) {
    const list = state.master?.googleCalendarEvents || [];
    const evt = list.find(e => e.id === id) || (OL._calendarGridEvents || []).find(e => e.id === id) || (OL._dashboardEventsCache || []).find(e => e.id === id);
    const newValue = evt ? (evt.billable === false ? true : false) : true;

    // billable_manual: a person chose this, so a later call-type change
    // won't flip it back to the default.
    let { error } = await db.from('calendar_events').update({ billable: newValue, billable_manual: true }).eq('id', id);
    if (error && /billable_manual/.test(error.message || '')) ({ error } = await db.from('calendar_events').update({ billable: newValue }).eq('id', id));
    if (error) { alert('Failed to update: ' + error.message); return; }

    [state.master?.googleCalendarEvents, OL._calendarGridEvents, OL._dashboardEventsCache].forEach(list => {
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
    const allMatches = Object.values(state.clients || {})
        .filter(c => c?.meta?.name)
        .filter(c => !q || c.meta.name.toLowerCase().includes(q))
        .sort((a, b) => (a.meta.name || '').localeCompare(b.meta.name || ''));
    // Was hard-capped at 30 regardless of query — with the workspace's full
    // client count well above that, an empty/short search silently dropped
    // everything past the 30th name alphabetically (which is what made the
    // list look "cut off" at a specific client, rather than actually
    // showing every match). 200 comfortably covers the real client count
    // with room to grow; the cap now only matters for a genuinely blank
    // search, and shrinks itself the moment you type anything to narrow it.
    const filtered = allMatches.slice(0, 200);

    return `
        <div id="calendar-event-project-picker-${evt.id}" style="min-width:200px; position:relative;">
            <input type="text" id="calendar-event-project-search-${evt.id}" class="modal-input tiny" style="width:100%; box-sizing:border-box;"
                   placeholder="Search projects to link..." value="${esc(pp.query || '')}"
                   onfocus="OL.setCalendarEventProjectFocus('${evt.id}', true)"
                   oninput="OL.setCalendarEventProjectQuery('${evt.id}', this.value)">
            ${pp.focused ? `
                <div id="calendar-event-project-results-${evt.id}" style="max-height:160px; overflow:auto; margin-top:4px; display:grid; gap:3px; position:fixed; z-index:2000; background:var(--bg-card, #1e293b); border:1px solid var(--line); border-radius:6px; padding:4px; box-shadow:0 4px 12px rgba(0,0,0,0.3);">
                    ${filtered.length ? filtered.map(c => `
                        <div class="tiny" style="padding:6px 8px; border-radius:5px; cursor:pointer;" onmouseover="this.style.background='rgba(255,255,255,0.06)'" onmouseout="this.style.background='transparent'" onmousedown="OL.setCalendarEventClient('${evt.id}', '${c.id}')">${esc(c.meta.name)}</div>
                    `).join('') : `<div class="tiny muted" style="padding:6px;">No matching projects.</div>`}
                    ${allMatches.length > filtered.length ? `<div class="tiny muted" style="padding:6px; text-align:center;">+${allMatches.length - filtered.length} more — keep typing to narrow it down</div>` : ''}
                </div>
            ` : ''}
        </div>
    `;
};

// The results list above is position:fixed (not the old position:absolute
// anchored inside this container) because it lives inside the event
// modal's .modal-box, which sets overflow-y:auto — an absolutely
// positioned list there was getting silently clipped by the modal's scroll
// box once it had more than a few matches, which looked like the list was
// "cut off" partway through rather than actually showing all matches.
// Called right after render (both here on open and from the focus/query
// re-renders above) to position it from the input's live screen rect.
OL._positionCalendarEventProjectResults = function(eventId) {
    const input = document.getElementById(`calendar-event-project-search-${eventId}`);
    const results = document.getElementById(`calendar-event-project-results-${eventId}`);
    if (!input || !results) return;
    const rect = input.getBoundingClientRect();
    results.style.left = rect.left + 'px';
    results.style.width = rect.width + 'px';
    results.style.top = (rect.bottom + 4) + 'px';
};

OL._findLiveCalendarEvent = function(eventId) {
    return (state.master?.googleCalendarEvents || []).find(e => e.id === eventId)
        || (OL._calendarGridEvents || []).find(e => e.id === eventId) || (OL._dashboardEventsCache || []).find(e => e.id === eventId);
};

OL.setCalendarEventProjectFocus = function(eventId, value) {
    // Guards against a re-render loop: every keystroke's oninput handler
    // (setCalendarEventProjectQuery, below) also re-renders and re-focuses
    // this input, and that programmatic focus() fires a native 'focus'
    // event, which used to re-enter this function and re-render a SECOND
    // time before the first render had restored the cursor position —
    // corrupting it on every keystroke (typing looked reversed, since the
    // cursor kept getting reset instead of staying after the new
    // character). Once already in the requested focused state, this is
    // exactly that echo, not a real focus change, so it's a no-op.
    if (OL._calendarProjectPicker.focused === value) return;
    OL._calendarProjectPicker.focused = value;
    const evt = OL._findLiveCalendarEvent(eventId);
    const container = document.getElementById(`calendar-event-project-picker-${eventId}`);
    if (evt && container) {
        // Was a plain outerHTML replace with no focus restoration — the
        // input you just clicked into (which is what fired this focus
        // handler in the first place) got destroyed and rebuilt as a new,
        // unfocused element, so the search box never actually became
        // typeable. Same reRenderPreservingFocus fix already used by
        // setCalendarEventProjectQuery below.
        OL.reRenderPreservingFocus(() => {
            container.outerHTML = OL.renderCalendarEventProjectPicker(evt);
            if (window.lucide) lucide.createIcons();
        });
        OL._positionCalendarEventProjectResults(eventId);
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
    OL._positionCalendarEventProjectResults(eventId);
};

OL.setCalendarEventClient = async function(eventId, clientId) {
    const { error } = await db.from('calendar_events').update({ linked_client_id: clientId || null }).eq('id', eventId);
    if (error) { alert('Failed to update project link: ' + error.message); return; }

    [state.master?.googleCalendarEvents, OL._calendarGridEvents, OL._dashboardEventsCache].forEach(list => {
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
    const evt = (OL._calendarGridEvents || []).find(e => e.id === id) || (OL._dashboardEventsCache || []).find(e => e.id === id)
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
    const evt = (OL._calendarGridEvents || []).find(e => e.id === id) || (OL._dashboardEventsCache || []).find(e => e.id === id)
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
    // The billable flag follows the Billable Rules for the new category,
    // unless someone set billable by hand. call_type_manual stops the
    // calendar sync from re-guessing the category over this choice.
    const { data: cur } = await db.from('calendar_events').select('id, title, linked_client_id, assignee, billable_manual').eq('id', id).maybeSingle();
    const patch = { call_type: callType || null, call_type_manual: true };
    if (cur && !cur.billable_manual) patch.billable = eventBillableFromRules({ ...cur, call_type: callType || null });
    let { error } = await db.from('calendar_events').update(patch).eq('id', id);
    if (error && /call_type_manual/.test(error.message || '')) {
        delete patch.call_type_manual;
        ({ error } = await db.from('calendar_events').update(patch).eq('id', id));
    }
    if (error) { alert('Failed to update call category: ' + error.message); return; }

    [state.master?.googleCalendarEvents, OL._calendarGridEvents, OL._dashboardEventsCache].forEach(list => {
        const e = (list || []).find(e => e.id === id);
        if (e) { e.call_type = callType || null; if ('billable' in patch) e.billable = patch.billable; }
    });
    if (window.OL._eventCallTypeCache) window.OL._eventCallTypeCache[id] = { id, call_type: callType || null };

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

    [state.master?.googleCalendarEvents, OL._calendarGridEvents, OL._dashboardEventsCache].forEach(list => {
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
    const evt = (OL._calendarGridEvents || []).find(e => e.id === id) || (OL._dashboardEventsCache || []).find(e => e.id === id)
        || (state.master?.googleCalendarEvents || []).find(e => e.id === id);
    const current = evt?.assignees?.length ? [...evt.assignees] : (evt?.assignee ? [evt.assignee] : []);
    const next = current.includes(name) ? current.filter(n => n !== name) : [...current, name];

    const { error } = await db.from('calendar_events').update({ assignees: next, assignee: next[0] || null }).eq('id', id);
    if (error) { alert('Failed to update: ' + error.message); return; }

    [state.master?.googleCalendarEvents, OL._calendarGridEvents, OL._dashboardEventsCache].forEach(list => {
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
    const evt = (OL._calendarGridEvents || []).find(e => e.id === id) || (OL._dashboardEventsCache || []).find(e => e.id === id)
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

    [state.master?.googleCalendarEvents, OL._calendarGridEvents, OL._dashboardEventsCache].forEach(list => {
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

// Adds every Sphynx Team member found in an event's attendees to its
// assignees. Additive: it never removes anyone, and it now also fills in
// events that already had ONE assignee (previously those were skipped, so
// a meeting with three of us only ever showed the first).
OL.backfillEventAssigneesFromAttendees = async function() {
    if (OL._backfillingAssignees) return;
    OL._backfillingAssignees = true;
    OL.renderBusinessCalendar();

    try {
        // Page through everything (a single select stops at 1,000 rows).
        const rows = [];
        const PAGE = 1000;
        for (let from = 0; ; from += PAGE) {
            const { data, error } = await db.from('calendar_events')
                .select('id, assignee, assignees, attendee_emails')
                .order('id')
                .range(from, from + PAGE - 1);
            if (error) { alert('Failed to load events: ' + error.message); return; }
            rows.push(...(data || []));
            if (!data || data.length < PAGE) break;
        }

        // Every address a team member might be invited under.
        const roster = state.master?.sphynxTeam || [];
        const byEmail = new Map();
        roster.forEach(m => {
            [m.email, ...(Array.isArray(m.emails) ? m.emails : []), ...(Array.isArray(m.altEmails) ? m.altEmails : [])]
                .map(e => String(e || '').toLowerCase().trim()).filter(Boolean)
                .forEach(e => { if (m.name) byEmail.set(e, m.name); });
        });

        let updatedCount = 0, addedPeople = 0;
        const updates = [];
        rows.forEach(evt => {
            const attendeeEmails = Array.isArray(evt.attendee_emails) ? evt.attendee_emails : [];
            if (!attendeeEmails.length) return;
            const hasList = Array.isArray(evt.assignees) && evt.assignees.length > 0;
            const current = hasList ? evt.assignees : (evt.assignee ? [evt.assignee] : []);
            const next = [...current];
            attendeeEmails.forEach(raw => {
                const email = (typeof raw === 'string' ? raw : raw?.email || '').toLowerCase().trim();
                const name = email && byEmail.get(email);
                if (name && !next.includes(name)) next.push(name);
            });
            // Also repairs rows whose list was wiped but still have the single assignee.
            if (next.length > current.length || (!hasList && next.length > 0)) {
                addedPeople += next.length - current.length;
                updates.push({ id: evt.id, assignees: next, assignee: next[0] || null });
                updatedCount++;
            }
        });

        if (!updates.length) {
            alert('Nothing to backfill: every event already has all its Sphynx Team attendees assigned.');
            return;
        }

        let failed = 0;
        for (const u of updates) {
            const { error: updateErr } = await db.from('calendar_events')
                .update({ assignees: u.assignees, assignee: u.assignee })
                .eq('id', u.id);
            if (updateErr) { failed++; console.error(`Failed to backfill event ${u.id}:`, updateErr.message); continue; }
            [state.master?.googleCalendarEvents, OL._calendarGridEvents, OL._dashboardEventsCache].forEach(list => {
                const e = (list || []).find(e => e.id === u.id);
                if (e) { e.assignees = u.assignees; e.assignee = u.assignee; }
            });
        }

        const ok = updatedCount - failed;
        alert(`Updated ${ok} event${ok === 1 ? '' : 's'}, adding ${addedPeople} assignee${addedPeople === 1 ? '' : 's'} from attendee lists.` +
            (failed ? ` ${failed} failed to save (see console).` : ''));
    } finally {
        OL._backfillingAssignees = false;
        OL.renderBusinessCalendar();
    }
};

OL.openEditEventTimeModal = function(id) {
    const list = state.master?.googleCalendarEvents || [];
    const evt = list.find(e => e.id === id) || (OL._calendarGridEvents || []).find(e => e.id === id) || (OL._dashboardEventsCache || []).find(e => e.id === id);
    if (!evt) return;

    const content = `
        <div style="padding: 20px; max-width: 320px; width: 100%;" onclick="event.stopPropagation()">
            <h3 style="margin:0 0 12px; font-size:15px;">Edit Logged Time</h3>
            <p class="tiny muted" style="margin-bottom:10px;">Overrides the auto-tracked duration. Resets automatically if this event is rescheduled.</p>
            <input type="number" step="0.01" min="0" id="event-hours-input" class="modal-input tiny" value="${Number(evt.logged_hours || 0).toFixed(3)}" style="width:100%; margin-bottom:12px;">
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
    // Set by hand: the Zoom sync never replaces it (best effort: needs the 2026_10 migration).
    await db.from('calendar_events').update({ logged_hours_source: 'manual', time_prompt_skipped: true }).eq('id', id).then(() => {}, () => {});

    [state.master?.googleCalendarEvents, OL._calendarGridEvents, OL._dashboardEventsCache].forEach(list => {
        const e = (list || []).find(e => e.id === id);
        if (e) e.logged_hours = hours;
    });
    OL._activeEventModalId = id;
    OL.openCalendarEventModal(id);
};

// -------------------------------------------------------------
// LIVE GOOGLE CALENDAR SYNC
// -------------------------------------------------------------
// ---------------- New meeting, created here ----------------
// Creates a Zoom meeting (when ticked) and then the event on the connected Google Calendar with the Zoom link in it
// (Google sends the invitations), then syncs the calendar so
// it shows up like any other meeting and is matched to its project by the guests' emails. Picking a project just
// fills in that project's contacts as guests. The calendar it goes on is the first one being synced (else the
// account's main calendar).
OL.openNewMeetingModal = function(prefill = {}) {
    const clients = Object.values(state.clients || {}).filter((c) => c?.meta?.status !== 'Partner').sort((a, b) => String(a.meta?.name || '').localeCompare(String(b.meta?.name || '')));
    const nextHour = new Date(Date.now() + 3600000); nextHour.setMinutes(0, 0, 0);
    const pad = (n) => String(n).padStart(2, '0');
    const dateVal = prefill.date || `${nextHour.getFullYear()}-${pad(nextHour.getMonth() + 1)}-${pad(nextHour.getDate())}`;
    const timeVal = prefill.time || `${pad(nextHour.getHours())}:00`;
    const field = (label, inner) => `<div style="display:flex; flex-direction:column; gap:4px; margin-bottom:12px;"><label class="tiny muted" style="font-size:10px; font-weight:600;">${label}</label>${inner}</div>`;
    OL._newMeeting = { guests: [] };
    openModal(`
        <div class="modal-head"><div class="modal-title-text">New meeting</div><div class="spacer"></div>
            <button class="btn small soft" onclick="OL.closeModal()">Cancel</button></div>
        <div class="modal-body" style="max-width:560px;">
            ${field('Title', '<input id="nm-title" type="text" class="modal-input" placeholder="e.g. Intake form review" autofocus>')}
            <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:12px;">
                ${field('Date', `<input id="nm-date" type="date" class="modal-input" value="${dateVal}">`)}
                ${field('Start', `<input id="nm-time" type="time" class="modal-input" value="${timeVal}">`)}
                ${field('Length', `<select id="nm-length" class="modal-input">${[15, 30, 45, 60, 90, 120].map((m) => `<option value="${m}" ${m === 30 ? 'selected' : ''}>${m} minutes</option>`).join('')}</select>`)}
            </div>
            ${field('Project (fills in their contacts as guests)', `<select id="nm-client" class="modal-input" onchange="OL.newMeetingPickClient(this.value)"><option value="">None</option>${clients.map((c) => `<option value="${esc(c.id)}">${esc(c.meta?.name || c.id)}</option>`).join('')}</select>`)}
            ${field('Guests', `<div id="nm-guests" style="display:flex; flex-wrap:wrap; gap:6px; margin-bottom:4px;"></div>
                <div style="display:flex; gap:6px;"><input id="nm-guest-input" type="email" class="modal-input tiny" style="flex:1;" placeholder="Add an email and press Enter" onkeydown="if(event.key==='Enter'){event.preventDefault(); OL.newMeetingAddGuest();}">
                <button type="button" class="btn tiny soft" onclick="OL.newMeetingAddGuest()">Add</button></div>`)}
            ${field('Notes (optional)', '<textarea id="nm-notes" class="modal-input" rows="3"></textarea>')}
            <label style="display:flex; align-items:center; gap:6px; font-size:12px; margin-bottom:14px;"><input id="nm-zoom" type="checkbox" checked> Create a Zoom meeting and put the link in the invite</label>
            <div id="nm-status" class="tiny muted" style="margin-bottom:8px;"></div>
            <div style="display:flex; justify-content:flex-end; gap:10px;">
                <button class="btn soft" onclick="OL.closeModal()">Cancel</button>
                <button id="nm-save" class="btn primary" onclick="OL.saveNewMeeting()">Create and invite</button>
            </div>
        </div>`);
    OL.renderNewMeetingGuests();
};

OL.renderNewMeetingGuests = function() {
    const box = document.getElementById('nm-guests');
    if (!box) return;
    const g = OL._newMeeting.guests;
    box.innerHTML = g.length ? g.map((e, i) => `<span class="pill tiny soft" style="display:inline-flex; align-items:center; gap:6px;">${esc(e)}<span style="cursor:pointer;" onclick="OL.newMeetingRemoveGuest(${i})">✕</span></span>`).join('') : '<span class="tiny muted">No guests yet.</span>';
};
OL.newMeetingAddGuest = function() {
    const input = document.getElementById('nm-guest-input');
    const email = String(input?.value || '').trim().toLowerCase();
    if (!email) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { alert('That email address does not look right.'); return; }
    if (!OL._newMeeting.guests.includes(email)) OL._newMeeting.guests.push(email);
    input.value = '';
    OL.renderNewMeetingGuests();
};
OL.newMeetingRemoveGuest = function(i) { OL._newMeeting.guests.splice(i, 1); OL.renderNewMeetingGuests(); };
OL.newMeetingPickClient = function(clientId) {
    const client = state.clients?.[clientId];
    if (!client) return;
    (client.projectData?.teamMembers || []).filter((m) => m.email).forEach((m) => {
        const e = String(m.email).toLowerCase();
        if (!OL._newMeeting.guests.includes(e)) OL._newMeeting.guests.push(e);
    });
    OL.renderNewMeetingGuests();
};

OL.saveNewMeeting = async function() {
    const val = (id) => document.getElementById(id)?.value || '';
    const title = val('nm-title').trim(), date = val('nm-date'), time = val('nm-time');
    if (!title) { alert('Give the meeting a title.'); return; }
    if (!date || !time) { alert('Pick a date and start time.'); return; }
    const pending = String(val('nm-guest-input')).trim();
    if (pending) OL.newMeetingAddGuest();
    const status = document.getElementById('nm-status'), btn = document.getElementById('nm-save');
    if (btn) btn.disabled = true;
    if (status) status.textContent = 'Creating the meeting...';
    try {
        // Zoom first: the invite that goes out has to carry the join link, so a Zoom problem is reported before
        // anything is put on the calendar.
        let zoom = null;
        if (document.getElementById('nm-zoom')?.checked) {
            if (status) status.textContent = 'Creating the Zoom meeting...';
            const zres = await fetch('https://kexnnpwjerrnsmifauuo.supabase.co/functions/v1/create-zoom-meeting', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(await OL.getAuthHeaders()) },
                body: JSON.stringify({ title, start: `${date}T${time}`, durationMinutes: Number(val('nm-length')) || 30,
                    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, agenda: val('nm-notes') }),
            });
            const zbody = await zres.json().catch(() => ({}));
            if (!zres.ok || !zbody.joinUrl) {
                if (status) {
                    status.textContent = zbody.message || 'Could not create the Zoom meeting, so nothing was scheduled.';
                    if (zbody.error === 'insufficient_scope' || zbody.error === 'reauth_required') {
                        const b = document.createElement('button');
                        b.type = 'button'; b.className = 'btn tiny soft'; b.style.marginLeft = '8px'; b.textContent = 'Reconnect Zoom';
                        b.onclick = () => OL.initiateZoomAuth();
                        status.appendChild(b);
                    }
                }
                if (btn) btn.disabled = false;
                return;
            }
            zoom = zbody;
            if (status) status.textContent = 'Adding it to the calendar...';
        }
        const res = await fetch('https://kexnnpwjerrnsmifauuo.supabase.co/functions/v1/create-calendar-event', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(await OL.getAuthHeaders()) },
            body: JSON.stringify({
                title, start: `${date}T${time}`, durationMinutes: Number(val('nm-length')) || 30,
                timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, calendarId: (state.master?.syncedCalendarIds || [])[0] || 'primary',
                attendees: OL._newMeeting.guests, description: val('nm-notes'), joinUrl: zoom?.joinUrl || undefined, joinInfo: zoom ? `Join Zoom Meeting: ${zoom.joinUrl}${zoom.meetingId ? `\nMeeting ID: ${zoom.meetingId}` : ''}${zoom.passcode ? `\nPasscode: ${zoom.passcode}` : ''}` : undefined,
            }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) { if (status) status.textContent = body.message || 'Could not create the meeting.'; if (btn) btn.disabled = false; return; }
        OL.closeModal();
        await OL.fetchLiveGoogleCalendar();   // bring it in, matched to its project like any other meeting
    } catch (err) {
        if (status) status.textContent = 'Could not reach the server. Please try again.';
        if (btn) btn.disabled = false;
    }
};

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
        console.log(`Zoom sync: scanned ${syncResult.scannedEvents ?? 0} Zoom-linked events, ${syncResult.summariesPostedCount ?? 0} summaries posted, ${syncResult.actionItemsFound ?? 0} action items found, ${syncResult.recordingsToDrive ?? 0} recordings + ${syncResult.summariesToDrive ?? 0} summaries saved to Drive, ${syncResult.noSummaryYetCount ?? 0} not ready yet, ${syncResult.otherErrorCount ?? 0} other errors`, syncResult);

        // Action items are stored on the events; turn them into tasks here
        // (through the app's own save), then reload the calendar.
        if (typeof OL.materializeZoomActionItems === 'function') await OL.materializeZoomActionItems();
        if (syncResult.driveErrors) console.warn(`${syncResult.driveErrors} Zoom Drive export(s) failed — they retry on the next sync.`);
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

// One-line Zoom state for a meeting, so a missing summary/recording is
// visible (and explainable) instead of silently absent.
OL.zoomStatusLine = function(evt) {
    const bits = [];
    if (!evt.zoom_meeting_id) bits.push('Zoom: no meeting matched yet');
    else {
        bits.push(evt.zoom_summary ? 'Summary ✓' : (evt.zoom_summary_processed ? 'Summary: none from Zoom' : 'Summary: waiting on Zoom'));
        const n = Array.isArray(evt.zoom_action_items) ? evt.zoom_action_items.length : 0;
        if (evt.zoom_summary) bits.push(`${n} action item${n === 1 ? '' : 's'}${n && evt.zoom_tasks_created ? ' → tasks ✓' : ''}`);
        bits.push(evt.zoom_recording_status === 'saved'
            ? (evt.zoom_recording_drive_url ? `<a href="${esc(evt.zoom_recording_drive_url)}" target="_blank" rel="noopener">Recording in Drive ✓</a>` : 'Recording in Drive ✓')
            : evt.zoom_recording_status === 'none' ? 'No recording' : 'Recording: pending');
        if (evt.zoom_recording_url) bits.push(`<a href="${esc(evt.zoom_recording_url)}" target="_blank" rel="noopener">Zoom link</a>`);
    }
    const line = bits.map(b => b.startsWith('<a ') ? b : esc(b)).join(' · ');
    return evt.zoom_drive_error ? `${line}<br><span style="color:#ef4444;" title="Last Drive export error">${esc(evt.zoom_drive_error)}</span>` : line;
};

// Clears this meeting's Zoom flags and runs the sync now, then reports
// exactly what happened for it.
// Scoped to ONE meeting. It only re-opens what's still missing for that
// meeting: it never resets zoom_tasks_created (so action items that already
// became tasks are never re-added, even if you renamed or deleted them),
// never resets a recording already saved to Drive, and never re-exports a
// summary already in Drive (that made duplicate files).
OL.recheckZoomForEvent = async function(eventId) {
    const { data: cur, error: readErr } = await db.from('calendar_events')
        .select('zoom_recording_status').eq('id', eventId).maybeSingle();
    if (readErr) { alert('Could not read this meeting: ' + readErr.message); return; }
    const reset = { zoom_summary_processed: false };
    if (cur?.zoom_recording_status !== 'saved') reset.zoom_recording_status = null;
    const { error } = await db.from('calendar_events').update(reset).eq('id', eventId);
    if (error) { alert('Could not reset this meeting: ' + error.message); return; }
    try {
        const res = await fetch('https://kexnnpwjerrnsmifauuo.supabase.co/functions/v1/sync-zoom-meetings', {
            method: 'POST', headers: { 'Content-Type': 'application/json', ...(await OL.getAuthHeaders()) }, body: JSON.stringify({ eventId })
        });
        const r = await res.json().catch(() => ({}));
        if (!res.ok) { alert('Zoom sync failed: ' + (r.message || res.status)); return; }
        // Only this meeting's action items — not every meeting's.
        if (typeof OL.materializeZoomActionItems === 'function') await OL.materializeZoomActionItems({ eventId });
        if (!r.eventReport) {
            // The server is running an older sync that ignores single-meeting
            // re-checks, so there's nothing meeting-specific to report.
            alert([
                'The Zoom sync on the server is an older version that can\'t re-check a single meeting.',
                'Redeploy the sync-zoom-meetings function (Supabase → Edge Functions), then click Re-check Zoom again.',
                '',
                `What it did return: ${r.summariesPostedCount ?? 0} summaries, ${r.recordingsToDrive ?? 0} recordings to Drive, ${r.driveErrors ?? 0} Drive errors.`
            ].join('\n'));
            OL.openCalendarEventModal(eventId);
            return;
        }
        const d = r.eventReport;
        alert([
            'Zoom re-check for this meeting:',
            `• Zoom meeting: ${d.meetingId ? d.meetingId + (d.matchedBy ? ` (matched by ${d.matchedBy})` : '') : 'not identified (see notes below)'}`,
            `• Summary: ${d.summary || 'not checked'}`,
            `• Action items: ${d.actionItems ?? 0}`,
            `• Recording: ${d.recording || 'not checked'}`,
            ...(d.notes || []).map(n => '• ' + n)
        ].join('\n'));
    } catch (e) {
        alert('Zoom sync failed: ' + e.message);
    }
    OL.openCalendarEventModal(eventId);
};

// An intro call on the calendar gets a review task ahead of it (Automations > Templates & settings > Intro calls):
// due N days before the call (today if that has already passed), assigned to the person set there. Matches on the
// event title, once per event, and only for events matched to a project. Runs inside the updateAndSync in
// processCalendarAutomations.
OL.createIntroCallReviewTask = function(client, evt) {
    const cfg = getOlSettings().introCall;
    if (!cfg || cfg.enabled === false || !client || !evt?.start) return null;
    const words = String(cfg.titleKeywords || '').split(',').map((w) => w.trim().toLowerCase()).filter(Boolean);
    const title = String(evt.title || '').toLowerCase();
    if (!words.length || !words.some((w) => title.includes(w))) return null;
    if (!client.projectData) client.projectData = {};
    if (!client.projectData.clientTasks) client.projectData.clientTasks = [];
    if (client.projectData.clientTasks.some((t) => t && t.introCallEventId === evt.id)) return null;

    const callDay = new Date(evt.start);
    const due = new Date(callDay.getFullYear(), callDay.getMonth(), callDay.getDate() - (Number(cfg.daysBefore) || 0));
    const now = new Date(); const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const pad = (n) => String(n).padStart(2, '0');
    const d = due < today ? today : due;
    const dueDate = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const name = String(cfg.taskTitle || '').trim() || 'Review Intro Call Questionnaire and Notes';
    const wanted = String(cfg.assignee || '').trim().toLowerCase();
    const member = (state.master?.sphynxTeam || []).find((m) => wanted && String(m.name || '').toLowerCase().includes(wanted));
    const assignee = member?.name || cfg.assignee || 'Sphynx Task';
    const task = {
        id: uid(), title: name, name, status: 'Pending Sphynx Action', assignee, dueDate,
        description: `Intro call: ${evt.title} (${callDay.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}).`,
        isClientTask: OL.computeIsClientTask ? OL.computeIsClientTask(assignee) : false,
        loggedHours: 0, timeLog: [], parentTaskId: null, createdBy: 'automation', createdAt: now.toISOString(),
        introCallEventId: evt.id,
    };
    client.projectData.clientTasks.unshift(task);
    return task;
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
                ? Math.round(((new Date(evt.end) - new Date(evt.start)) / 3600000) * 1000) / 1000
                : null;

            OL.createIntroCallReviewTask(client, evt);

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
            <div class="modal-title-text">Manage Calendars</div>
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
            [state.master?.googleCalendarEvents, OL._calendarGridEvents, OL._dashboardEventsCache].forEach(list => {
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
