// ================= 📧 MEETING SUMMARY EMAIL =================
// When a meeting linked to a client has a Zoom summary, a "Meeting after-action" task appears for
// whoever from the team was on the meeting (the project's Communication person, if they attended). Opening it (or the meeting) shows one window with the
// email and the meeting's REAL tasks side by side. The Next steps section of the email is
// generated from those tasks, so a change is made once, on the task: editing a title, owner
// or due date, adding a task, or deleting one updates the actual task immediately and the
// email follows. Sending emails everyone on the meeting except the sender, marks the meeting
// with the send date (calendar_events.summary_sent_at), links the sent email to the meeting
// through the existing send function, and completes the summary task.
//
// Needs 001_lifecycle_tables.sql (adds calendar_events.summary_sent_at).

import { db, state, esc, uid, loadFullClient, updateAndSync } from '../../core/data.js';
import { addLink } from '../../core/task-links.js';
import { getOlSettings } from '../../core/ol-settings.js';
import { buildSummaryDraft, splitActionItemOwner, tasksForEvent, nextStepsText, nextStepsHtml, messageTextToHtml, zoomItemsNotYetTasks, closedTasksForEvent } from '../../core/meeting-summary.js';
import { fillClosing } from './compose-shared.js';

const LOOKBACK_DAYS = 7;          // only meetings this recent get a task automatically
const CHECK_EVERY_MS = 5 * 60 * 1000;

const closedStatusNames = () => {
    const names = (typeof OL.getSystemStatuses === 'function' ? OL.getSystemStatuses() : [])
        .filter(s => s.isClosed).map(s => s.name);
    return names.length ? names : ['Done'];
};

// The Communication role's person on this project, else the generic Sphynx task.
function communicationAssignee(client) {
    const role = (state.master?.roles || []).find(r => /communicat/i.test(String(r?.name || '')));
    const assignment = role ? (client.projectData?.roleAssignments || []).find(a => a.roleId === role.id) : null;
    return (assignment && assignment.memberName) || 'Sphynx Task';
}

// Who from the team was on the meeting (the event's assignee and assignees, kept to people on the team roster).
function meetingAttendees(evt) {
    const roster = (state.master?.sphynxTeam || []).map(m => m.name);
    const names = [...(Array.isArray(evt?.assignees) ? evt.assignees : []), evt?.assignee].filter(Boolean);
    return [...new Set(names)].filter(n => roster.includes(n));
}

// The summary goes to the project's Communication person only when they were on the meeting. Otherwise it goes to someone who
// was (the first team member on the event); with nobody on the event, the generic Sphynx task.
function summaryAssignee(client, evt) {
    const attendees = meetingAttendees(evt);
    const comm = communicationAssignee(client);
    if (attendees.includes(comm)) return comm;
    return attendees[0] || 'Sphynx Task';
}

function dueTwoDaysAfter(startIso) {
    const d = new Date(startIso);
    if (Number.isNaN(d.getTime())) return '';
    d.setDate(d.getDate() + 2);
    return d.toISOString().slice(0, 10);
}

function makeSummaryTask(client, evt) {
    const title = `Meeting after-action: ${evt.title || 'Meeting'}`;
    return {
        id: uid(),
        title,
        name: title,
        description: 'Go through this meeting: create tasks from its Zoom action items (or skip them, or add them as notes on existing tasks), log any requests, then edit the follow-up email and send it to the attendees.',
        status: 'Pending Sphynx Action',
        assignee: summaryAssignee(client, evt),
        dueDate: dueTwoDaysAfter(evt.start),
        isClientTask: false,
        loggedHours: 0,
        parentTaskId: null,
        createdBy: 'meeting-summary',
        createdAt: new Date().toISOString(),
        meetingSummaryEventId: evt.id,
        parentEventId: evt.id,
        linkedEventId: evt.id,
    };
}

// ---- Zoom action items -> real tasks ----
// sync-zoom-meetings stores each meeting's action items on the event
// (calendar_events.zoom_action_items) instead of writing tasks into the
// project itself. Creating them here, through the app's normal save,
// means they can't be overwritten by an open tab's older copy, and a
// meeting that gets linked to a project AFTER its summary arrived still
// gets its tasks (previously those were skipped forever).
let materializing = false;
// Pass { eventId } to limit it to one meeting (the Re-check Zoom button);
// with no argument it handles every meeting still waiting for tasks.
// Off: action items are no longer turned into tasks automatically. They wait in the meeting's after-action window, where each
// one gets its own Create task / Skip / Add as a note choice. Set this to true to bring the old create-everything step back.
const AUTO_CREATE_ZOOM_TASKS = false;
OL.materializeZoomActionItems = async function(opts = {}) {
    if (!AUTO_CREATE_ZOOM_TASKS) return 0;
    const onlyEventId = opts?.eventId ? String(opts.eventId) : null;
    if (materializing) return 0;
    materializing = true;
    let created = 0;
    try {
        if (!state.isCloudSynced) return 0;
        if (!(state.adminMode === true || state.teamMemberMode === true)) return 0;
        let q = db.from('calendar_events')
            .select('id, title, start, linked_client_id, zoom_action_items')
            .eq('zoom_tasks_created', false)
            .not('linked_client_id', 'is', null)
            .eq('zoom_summary_processed', true);
        q = onlyEventId ? q.eq('id', onlyEventId) : q.limit(50);
        const { data: events, error } = await q;
        if (error) { if (!/zoom_tasks_created|zoom_action_items/.test(error.message || '')) console.warn('Zoom action item check failed:', error.message); return 0; }

        const done = [];
        for (const evt of events || []) {
            const items = (Array.isArray(evt.zoom_action_items) ? evt.zoom_action_items : []).map(x => String(x || '').trim()).filter(Boolean);
            const client = await loadFullClient(evt.linked_client_id);
            if (!client?.projectData) continue;
            if (!client.projectData.clientTasks) client.projectData.clientTasks = [];
            // Never duplicate: skip titles already created from this meeting.
            // Any task tied to this meeting counts (older syncs didn't tag
            // source), and if Zoom tasks already exist for this meeting,
            // nothing more is added — a re-worded summary shouldn't spawn
            // a second set.
            const fromThisMeeting = client.projectData.clientTasks.filter(t =>
                [t.linkedEventId, t.parentEventId, t.meetingSummaryEventId].some(id => id != null && String(id) === String(evt.id)));
            const alreadyHasZoomTasks = fromThisMeeting.some(t => t.source === 'zoom_summary' || t.createdBy === 'zoom-sync');
            const have = new Set(fromThisMeeting.map(t => (t.title || t.name || '').trim().toLowerCase()));
            const toAdd = alreadyHasZoomTasks ? [] : items.filter(i => !have.has(i.toLowerCase()));
            if (toAdd.length) {
                await updateAndSync(() => {
                    toAdd.forEach(item => client.projectData.clientTasks.unshift({
                        id: uid(), title: item, name: item,
                        status: 'Pending Sphynx Action', assignee: 'Sphynx Task', dueDate: dueTwoDaysAfter(evt.start),
                        isClientTask: false, loggedHours: 0, createdAt: new Date().toISOString(),
                        linkedEventId: evt.id, parentEventId: evt.id, source: 'zoom_summary'
                    }));
                }, evt.linked_client_id);
                created += toAdd.length;
            }
            done.push(evt.id);
        }
        if (done.length) await db.from('calendar_events').update({ zoom_tasks_created: true }).in('id', done);
        if (created) console.log(`🎥 Created ${created} task${created === 1 ? '' : 's'} from Zoom action items.`);
    } catch (err) {
        console.warn('Zoom action item check failed:', err?.message || err);
    } finally {
        materializing = false;
    }
    return created;
};

// ---- background Zoom sync (replaces clicking "Sync Zoom") ----
// Runs the sync function quietly every 10 minutes while a staff member has
// the app open (the ol_sync_zoom cron job covers the rest of the time),
// then turns any new action items into tasks. Doesn't re-render whatever
// page you're on.
const ZOOM_SYNC_EVERY_MS = 10 * 60 * 1000;
let zoomSyncing = false;
OL.backgroundZoomSync = async function() {
    if (zoomSyncing) return;
    if (!state.isCloudSynced || !(state.adminMode === true || state.teamMemberMode === true)) return;
    if (state.master?.zoomConnected === false) return;
    zoomSyncing = true;
    try {
        const res = await fetch('https://kexnnpwjerrnsmifauuo.supabase.co/functions/v1/sync-zoom-meetings', { method: 'POST', headers: await OL.getAuthHeaders() });
        const result = await res.json().catch(() => ({}));
        if (res.ok) {
            if (result.summariesPostedCount || result.recordingsToDrive || result.summariesToDrive) console.log('🎥 Zoom auto-sync:', result);
            if (result.driveErrors) console.warn(`Zoom auto-sync: ${result.driveErrors} Drive export(s) failed — will retry next run.`);
        } else if (res.status !== 401 && res.status !== 403) {
            console.warn('Zoom auto-sync failed:', result.message || res.status);
        }
    } catch (e) {
        console.warn('Zoom auto-sync failed:', e?.message || e);
    } finally {
        zoomSyncing = false;
    }
    await OL.materializeZoomActionItems();
    if (location.hash.includes('calendar') && typeof OL.loadCalendarEvents === 'function') {
        await OL.loadCalendarEvents();
        OL.renderBusinessCalendar?.();
    }
};

// ---- Time from the Chrome extension -> task logged time ----
// The extension writes time_entries rows; this adds each one to its task's
// loggedHours through the app's normal save and marks it applied, so an
// entry is counted exactly once.
let applyingTime = false;
OL.applyExtensionTimeEntries = async function() {
    if (applyingTime) return 0;
    if (!state.isCloudSynced || !(state.adminMode === true || state.teamMemberMode === true)) return 0;
    applyingTime = true;
    let applied = 0;
    try {
        const { data, error } = await db.from('time_entries').select('*').eq('applied', false).order('created_at').limit(100);
        if (error) { if (!/time_entries/.test(error.message || '')) console.warn('Time entry check failed:', error.message); return 0; }
        const byClient = {};
        (data || []).forEach(e => (byClient[e.client_id] = byClient[e.client_id] || []).push(e));
        for (const [clientId, entries] of Object.entries(byClient)) {
            const client = await loadFullClient(clientId);
            const tasks = client?.projectData?.clientTasks;
            if (!tasks) continue;
            const ok = [];
            await updateAndSync(() => {
                entries.forEach(e => {
                    const t = tasks.find(x => String(x.id) === String(e.task_id));
                    if (!t) return;
                    const hrs = Number(e.minutes) / 60;
                    t.loggedHours = Number(t.loggedHours || t.hoursLogged || 0) + hrs;
                    t.hoursLogged = t.loggedHours;
                    if (!Array.isArray(t.timeLog)) t.timeLog = [];
                    t.timeLog.push({ id: e.id, by: e.user_name || '', minutes: Number(e.minutes), start: e.started_at, end: e.ended_at, note: e.note || '', source: e.source });
                    ok.push(e.id);
                });
            }, clientId);
            if (ok.length) {
                await db.from('time_entries').update({ applied: true, applied_at: new Date().toISOString() }).in('id', ok);
                applied += ok.length;
            }
        }
        if (applied) { console.log(`⏱ Applied ${applied} time entr${applied === 1 ? 'y' : 'ies'} from the Chrome extension.`); OL.refreshTaskView?.(); }
    } catch (err) {
        console.warn('Time entry check failed:', err?.message || err);
    } finally {
        applyingTime = false;
    }
    return applied;
};

// ---- background check: create the summary task once a summary exists ----
let checking = false;

OL.checkMeetingSummaries = async function() {
    if (checking) return 0;
    checking = true;
    let created = 0;
    try {
        if (!state.isCloudSynced) return 0;
        if (!(state.adminMode === true || state.teamMemberMode === true)) return 0;

        const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
        const { data: events, error } = await db
            .from('calendar_events')
            .select('id, title, start, linked_client_id, summary_sent_at, assignee, assignees')
            .not('zoom_summary', 'is', null)
            .neq('zoom_summary', '')
            .not('linked_client_id', 'is', null)
            .is('summary_sent_at', null)
            .gte('start', since)
            .limit(200);
        if (error) throw error;

        const byClient = {};
        (events || []).forEach(e => { (byClient[e.linked_client_id] = byClient[e.linked_client_id] || []).push(e); });

        for (const [clientId, list] of Object.entries(byClient)) {
            const client = await loadFullClient(clientId);
            if (!client || !client.projectData) continue;
            if (!client.projectData.clientTasks) client.projectData.clientTasks = [];

            const have = new Set(client.projectData.clientTasks.map(t => t.meetingSummaryEventId).filter(Boolean));
            const missing = list.filter(e => !have.has(e.id));
            if (!missing.length) continue;

            await updateAndSync(() => {
                missing.forEach(evt => client.projectData.clientTasks.unshift(makeSummaryTask(client, evt)));
            }, clientId);
            created += missing.length;
        }
        if (created) console.log(`📧 Created ${created} meeting summary task${created === 1 ? '' : 's'}.`);
    } catch (err) {
        console.warn('Meeting summary check failed:', err?.message || err);
    } finally {
        checking = false;
    }
    return created;
};

// ---- the window: email text on one side, the real tasks on the other ----
// Who owns a task, from its assignee: Sphynx (the generic task or a team member), a third
// party, or the client (the generic client task or one of the client's people).
function ownerOf(assignee) {
    if (assignee === 'Sphynx Task') return 'sphynx';
    if ((state.master?.sphynxTeam || []).some(m => m.name === assignee)) return 'sphynx';
    if ((OL.thirdPartyAssignees || []).includes(assignee)) return 'third_party';
    return 'client';
}

function assigneeOptionsHtml(client, current) {
    const opt = (v) => `<option value="${esc(v)}" ${v === current ? 'selected' : ''}>${esc(v)}</option>`;
    const team = (state.master?.sphynxTeam || []).map(m => m.name).filter(Boolean);
    const clientPeople = (client.projectData?.teamMembers || []).map(m => m.name).filter(Boolean);
    const thirdParty = OL.thirdPartyAssignees || [];
    const known = new Set(['Sphynx Task', 'Client Task', ...team, ...clientPeople, ...thirdParty]);
    return `
        <optgroup label="Sphynx">${['Sphynx Task', ...team].map(opt).join('')}</optgroup>
        <optgroup label="${esc(client.meta?.name || 'Client')}">${['Client Task', ...clientPeople].map(opt).join('')}</optgroup>
        ${thirdParty.length ? `<optgroup label="Third parties">${thirdParty.map(opt).join('')}</optgroup>` : ''}
        ${current && !known.has(current) ? `<optgroup label="Current">${opt(current)}</optgroup>` : ''}`;
}

// Tasks from this meeting are included by default; ANY other open task on
// the project can be ticked in too (reminders from earlier meetings, work
// waiting on the client, etc.). st.excluded / st.included hold the choices.
// Requests linked to this meeting: a task linked to one of them came out of the same meeting.
const requestIdsForMeeting = () => (OL._msState.client.projectData.scopingSheets || [])
    .flatMap(sh => sh?.lineItems || [])
    .filter(i => i && String(i.linkedEventId || '') === String(OL._msState.evt.id))
    .map(i => String(i.id));
const meetingTasks = () => tasksForEvent(OL._msState.client.projectData.clientTasks, OL._msState.evt.id, closedStatusNames(), { requestIds: requestIdsForMeeting() });
const otherOpenTasks = () => {
    const st = OL._msState;
    const closed = new Set(closedStatusNames());
    const fromMeeting = new Set(meetingTasks().map(t => String(t.id)));
    return (st.client.projectData.clientTasks || []).filter(t => t && !closed.has(String(t.status || '')) && !fromMeeting.has(String(t.id))
        && !t.meetingSummaryEventId && String(t.id) !== String(st.task?.id));
};
const msTasks = () => {
    const st = OL._msState;
    const ex = st.excluded || new Set();
    const inc = st.included || new Set();
    return sortByNextStepsOrder([
        ...meetingTasks().filter(t => !ex.has(String(t.id))),
        ...otherOpenTasks().filter(t => inc.has(String(t.id)))
    ]);
};

// The order of the tasks in Next steps. It is kept on the summary task (nextStepsOrder: a list of task ids); tasks not in
// the list (new ones) follow in their usual order. Within the email the Sphynx and client groups keep their own order.
function sortByNextStepsOrder(list) {
    const order = (OL._msState?.task?.nextStepsOrder || []).map(String);
    if (!order.length) return list;
    const rank = (t) => { const i = order.indexOf(String(t.id)); return i === -1 ? order.length : i; };
    return list.map((t, i) => ({ t, i })).sort((a, b) => (rank(a.t) - rank(b.t)) || (a.i - b.i)).map(x => x.t);
}

OL.msMoveTask = async function(taskId, dir) {
    const st = OL._msState;
    if (!st) return;
    const ids = msTasks().map(t => String(t.id));
    const i = ids.indexOf(String(taskId));
    const j = i + (dir < 0 ? -1 : 1);
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await updateAndSync(() => {
        const t = st.client.projectData.clientTasks.find(x => x.id === st.task.id) || st.task;
        const rest = (t.nextStepsOrder || []).map(String).filter(id => !ids.includes(id));
        t.nextStepsOrder = [...ids, ...rest];
        st.task.nextStepsOrder = t.nextStepsOrder;
    }, st.client.id);
    renderMsTaskRows();
};

function renderMsReorder() {
    const el = document.getElementById('ms-reorder');
    if (!el) return;
    const tasks = msTasks();
    if (tasks.length < 2) { el.innerHTML = ''; return; }
    const arrow = (id, dir, icon, off) => `<button type="button" class="btn tiny soft" style="padding:1px 5px; ${off ? 'opacity:.3; pointer-events:none;' : ''}" title="Move ${dir < 0 ? 'up' : 'down'}" onclick="OL.msMoveTask('${esc(String(id))}', ${dir})"><i data-lucide="${icon}" style="width:12px;height:12px;"></i></button>`;
    const wasOpen = el.querySelector('details')?.open;
    el.innerHTML = `<details ${wasOpen ? 'open' : ''} style="margin-top:8px;"><summary class="tiny muted" style="cursor:pointer;">Reorder next steps</summary>
        <div style="margin-top:6px;">${tasks.map((t, i) => `<div style="display:flex; align-items:center; gap:6px; padding:3px 0; border-bottom:1px solid var(--line);">
            <div style="flex:1; min-width:0; font-size:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${esc(t.title || t.name || '')}">${esc(t.title || t.name || '')}</div>
            ${arrow(t.id, -1, 'arrow-up', i === 0)}${arrow(t.id, 1, 'arrow-down', i === tasks.length - 1)}</div>`).join('')}</div></details>`;
    if (window.lucide) lucide.createIcons();
}

OL.msToggleInclude = function(taskId, on, fromMeeting) {
    const st = OL._msState;
    if (!st) return;
    st.excluded = st.excluded || new Set();
    st.included = st.included || new Set();
    const id = String(taskId);
    if (fromMeeting) { if (on) st.excluded.delete(id); else st.excluded.add(id); }
    else { if (on) st.included.add(id); else st.included.delete(id); }
    renderMsNextSteps();
    renderMsOtherTasks();
};

OL.msSetOtherFilter = function(q) {
    OL._msState.otherFilter = q;
    OL.reRenderPreservingFocus ? OL.reRenderPreservingFocus(renderMsOtherTasks) : renderMsOtherTasks();
};

function renderMsOtherTasks() {
    const st = OL._msState;
    const box = document.getElementById('ms-other-tasks');
    if (!box) return;
    const q = String(st.otherFilter || '').trim().toLowerCase();
    const inc = st.included || new Set();
    const today = OL.localDateStr ? OL.localDateStr() : new Date().toISOString().slice(0, 10);
    const list = otherOpenTasks().filter(t => !q || `${t.title || t.name} ${t.assignee || ''}`.toLowerCase().includes(q));
    // client-owned and overdue first — the usual things worth a reminder
    list.sort((a, b) => (ownerOf(b.assignee) === 'client') - (ownerOf(a.assignee) === 'client') || String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999')));
    box.innerHTML = list.length ? list.map(t => {
        const due = t.dueDate ? String(t.dueDate).slice(0, 10) : '';
        const overdue = due && due < today;
        return `
        <label style="display:flex !important; align-items:flex-start; gap:6px; padding:5px 4px; border-bottom:1px dashed var(--line); cursor:pointer; font-size:12px !important; margin:0 !important;">
            <input type="checkbox" style="width:auto !important; display:inline-block !important; margin-top:2px !important;" ${inc.has(String(t.id)) ? 'checked' : ''} onchange="OL.msToggleInclude('${esc(String(t.id))}', this.checked, false)">
            <span style="flex:1; min-width:0;">${esc(t.title || t.name || 'Task')}
                <span style="display:block; opacity:.65; font-size:11px;">${esc(t.assignee || 'Unassigned')}${due ? ` · <span style="${overdue ? 'color:#ef4444; font-weight:700;' : ''}">${overdue ? 'overdue ' : 'due '}${esc(due)}</span>` : ''}${t.linkedEventId && String(t.linkedEventId) !== String(st.evt.id) ? ' · from another meeting' : ''}</span>
            </span>
        </label>`;
    }).join('') : `<div class="tiny muted">${q ? 'No matches.' : 'No other open tasks on this project.'}</div>`;
}

// A hint for one action item: does the wording sound like the client asking for new work or a fix? Uses the same
// phrase matcher as email suggestions (communications.js), and only ever shows a chip — nothing is created
// until someone clicks New request or Revision. Items for the client to do, and ones already turned into a
// request, get no hint.
function requestHintFor(task) {
    if (!task || task.madeRequestId || task.isClientTask || typeof OL._classifyEmailCandidatesLocally !== 'function') return null;
    const title = String(task.title || task.name || '');
    if (title.length < 8) return null;
    const hit = OL._classifyEmailCandidatesLocally(title, [])[0];
    return hit && (hit.suggestedType === 'revision' || hit.suggestedType === 'new_request') ? hit.suggestedType : null;
}

// What Zoom recorded for this meeting (its action items, and the summary's own next steps list) that is not a task
// now. The email drops that list from SUMMARY (its NEXT STEPS comes from tasks), so an item with no task would be
// missing from the email altogether. Tasks made from this meeting, done or not, are not offered again; ones that were
// deleted are.
// Items you chose to skip (or filed as a note on an existing task) are kept on the project, per meeting, and not offered again.
const zoomItemKey = (item) => String(item || '').trim().toLowerCase();
function zoomNextStepsNotYetTasks() {
    const st = OL._msState;
    const skipped = new Set((st.client.projectData.dismissedZoomItems || []).filter(d => String(d.eventId) === String(st.evt.id)).map(d => d.key));
    return zoomItemsNotYetTasks({
        summary: st.evt.zoom_summary || '', actionItems: st.evt.zoom_action_items,
        tasks: st.client.projectData.clientTasks || [], eventId: st.evt.id,
    }).filter(item => !skipped.has(zoomItemKey(item)));
}

// One task from one of Zoom's action items, only when you choose to. The rest stay listed until you create, skip or file them.
OL.msCreateTaskFromItem = async function(idx) {
    const st = OL._msState;
    const item = (OL._msZoomItems || [])[idx];
    if (!st || !item) return;
    // "Ally: Update the SOP" becomes "Update the SOP" for Ally (a client task), "Arielle: ..." a Sphynx task for Arielle.
    const who = splitActionItemOwner(item, {
        team: (state.master?.sphynxTeam || []).map(m => m.name).filter(Boolean),
        clientPeople: (st.client.projectData?.teamMembers || []).map(m => m.name).filter(Boolean),
        attendees: meetingAttendees(st.evt), eventTitle: st.evt.title,
    });
    const isClient = who.owner === 'client';
    await updateAndSync(() => {
        st.client.projectData.clientTasks.unshift({
            id: uid(), title: who.title, name: who.title, zoomItem: item,
            status: isClient ? 'Client Task' : 'Pending Sphynx Action', assignee: who.assignee, dueDate: dueTwoDaysAfter(st.evt.start),
            isClientTask: isClient, loggedHours: 0, createdAt: new Date().toISOString(),
            linkedEventId: st.evt.id, parentEventId: st.evt.id, source: 'zoom_summary'
        });
    }, st.client.id);
    renderMsTaskRows();
};

// Leaves an item out for good (not a task, not wanted in the email). Used by Skip, and when an item is filed as a note.
async function dismissZoomItem(item) {
    const st = OL._msState;
    if (!st || !item) return;
    await updateAndSync(() => {
        const pd = st.client.projectData;
        if (!Array.isArray(pd.dismissedZoomItems)) pd.dismissedZoomItems = [];
        const key = zoomItemKey(item);
        if (!pd.dismissedZoomItems.some(d => String(d.eventId) === String(st.evt.id) && d.key === key)) pd.dismissedZoomItems.push({ eventId: st.evt.id, key });
    }, st.client.id);
    renderMsTaskRows();
}
OL.msSkipZoomItem = (idx) => dismissZoomItem((OL._msZoomItems || [])[idx]);
OL.msDismissZoomText = (eventId, text) => (OL._msState && String(OL._msState.evt.id) === String(eventId) ? dismissZoomItem(text) : null);

function zoomItemsBoxHtml() {
    const items = zoomNextStepsNotYetTasks();
    OL._msZoomItems = items;
    if (!items.length) return '';
    return `
        <div style="border:1px solid #f59e0b; border-radius:6px; padding:8px; margin-bottom:8px; font-size:12px;">
            <div class="bold" style="color:#f59e0b; margin-bottom:6px;">Zoom recorded ${items.length} action item${items.length === 1 ? '' : 's'} for this meeting that ${items.length === 1 ? "isn't a task" : "aren't tasks"} now</div>
            ${items.map((i, n) => `<div style="padding:6px 0; border-top:1px solid var(--line);">
                <div style="margin-bottom:4px;">${esc(i)}</div>
                <div style="display:flex; gap:6px;">
                    <button type="button" class="btn tiny primary" onclick="OL.msCreateTaskFromItem(${n})">Create task</button>
                    <button type="button" class="btn tiny soft" onclick="OL.msSkipZoomItem(${n})" title="Leave this out: no task, and it isn't offered again">Skip</button>
                </div></div>`).join('')}
            <div class="tiny muted" style="margin-top:4px;">Only items that become tasks appear in the email's next steps.</div>
        </div>`;
}

// Tasks from this meeting that are done: the list above only shows open ones, so say so rather than show nothing.
function closedTasksNoteHtml() {
    const st = OL._msState;
    const list = closedTasksForEvent(st.client.projectData.clientTasks, st.evt.id, closedStatusNames());
    if (!list.length) return '';
    return `<div class="tiny muted" style="margin-bottom:8px;">${list.length} task${list.length === 1 ? '' : 's'} from this meeting ${list.length === 1 ? 'is' : 'are'} already done, so ${list.length === 1 ? "it isn't" : "they aren't"} listed: ${list.map(t => esc(t.title || t.name || 'Task')).join('; ')}. The email's NEXT STEPS only covers open tasks. Reopen ${list.length === 1 ? 'it' : 'any'} in the Tasks tab to include ${list.length === 1 ? 'it' : 'them'}.</div>`;
}

function renderMsTaskRows() {
    const st = OL._msState;
    const box = document.getElementById('ms-task-rows');
    if (!box) return;
    const tasks = sortByNextStepsOrder(meetingTasks());
    const zoomBox = zoomItemsBoxHtml();
    const closedNote = closedTasksNoteHtml();
    const emptyNote = closedNote || (zoomBox ? '' : `<div class="tiny muted" style="margin-bottom:8px;">No open task is tied to this meeting, and Zoom's summary has no next steps of its own. A task belongs here when it came from this meeting's Zoom action items, was added below, or is marked as part of this meeting. Add one below, or tick tasks from "Other open tasks" to include them.</div>`);
    box.innerHTML = zoomBox + (tasks.length ? tasks.map(t => {
        const title = t.title || t.name || '';
        const rowsNeeded = Math.min(8, Math.max(2, Math.ceil(title.length / 34)));
        return `
        <div class="ms-task-row" style="border:1px solid var(--line); border-radius:6px; padding:8px; margin-bottom:8px; ${(st.excluded || new Set()).has(String(t.id)) ? 'opacity:.55;' : ''}">
            <label style="display:flex !important; align-items:center; gap:6px; font-size:11px !important; margin:0 0 4px !important; cursor:pointer;">
                <input type="checkbox" style="width:auto !important; display:inline-block !important;" ${(st.excluded || new Set()).has(String(t.id)) ? '' : 'checked'} onchange="OL.msToggleInclude('${esc(String(t.id))}', this.checked, true); this.closest('.ms-task-row').style.opacity = this.checked ? 1 : .55;">
                Include in summary
            </label>
            <textarea class="modal-input tiny" rows="${rowsNeeded}" style="resize:vertical;"
                      oninput="this.style.height='auto'; this.style.height=this.scrollHeight+'px';"
                      onchange="OL.msUpdateTask('${t.id}', 'title', this.value)">${esc(title)}</textarea>
            <select class="modal-input tiny" style="margin-top:6px !important;" onchange="OL.msUpdateTask('${t.id}', 'assignee', this.value)">
                ${assigneeOptionsHtml(st.client, t.assignee || (t.isClientTask ? 'Client Task' : 'Sphynx Task'))}
            </select>
            <div style="display:grid; grid-template-columns: minmax(0,1fr) auto; gap:6px; margin-top:6px; align-items:center;">
                <input type="date" class="modal-input tiny" value="${esc(String(t.dueDate || '').slice(0, 10))}"
                       onchange="OL.msUpdateTask('${t.id}', 'dueDate', this.value)">
                <button type="button" class="btn tiny soft" title="Delete this task" onclick="OL.msDeleteTask('${t.id}')">✕</button>
            </div>
            ${t.madeRequestId
                ? `<div class="tiny" style="margin-top:6px; color:#64c6a2;">✓ Also added as a ${esc(t.madeRequestType || 'request')} in Pending on the Scoping Sheet</div>`
                : (() => {
                    const hint = requestHintFor(t);
                    return `<div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap; margin-top:6px;">
                        ${hint ? `<span class="pill tiny" style="border:1px solid #f59e0b; color:#f59e0b;">Looks like a ${hint === 'revision' ? 'revision' : 'new request'}</span>` : `<span class="tiny muted">Client is asking for something new?</span>`}
                        <button type="button" class="btn tiny ${hint === 'new_request' ? 'primary' : 'soft'}" title="Adds it to Pending on the Scoping Sheet as a new request" onclick="OL.msMakeRequest('${t.id}', 'build')">New request</button>
                        <button type="button" class="btn tiny ${hint === 'revision' ? 'primary' : 'soft'}" title="Adds it to Pending on the Scoping Sheet as a revision" onclick="OL.msMakeRequest('${t.id}', 'revision')">Revision</button>
                   </div>`;
                })()}
        </div>`;
    }).join('')
        : emptyNote);
    // size each title box to its text so long titles are fully visible
    if (typeof box.querySelectorAll === 'function') {
        box.querySelectorAll('textarea').forEach(ta => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; });
    }
    renderMsNextSteps();
}

function renderMsNextSteps() {
    const st = OL._msState;
    const el = document.getElementById('ms-nextsteps-preview');
    if (!el) return;
    const html = nextStepsHtml(msTasks(), st.client.meta?.name || '');
    el.innerHTML = html || '<span class="muted">(No next steps section: nothing is ticked "Include in summary".)</span>';
    renderMsReorder();
}

OL.msUpdateTask = async function(taskId, field, value) {
    const st = OL._msState;
    if (!st) return;
    await updateAndSync(() => {
        const t = st.client.projectData.clientTasks.find(x => x.id === taskId);
        if (!t) return;
        if (field === 'title') {
            const title = String(value || '').trim();
            if (title) { t.title = title; t.name = title; }
        } else if (field === 'dueDate') {
            t.dueDate = value || '';
        } else if (field === 'assignee') {
            const owner = ownerOf(value);
            t.assignee = value;
            t.isClientTask = owner === 'client';
            // keep the status in step with who now owns it
            if (owner === 'client' && t.status === 'Pending Sphynx Action') t.status = 'Client Task';
            if (owner !== 'client' && t.status === 'Client Task') t.status = 'Pending Sphynx Action';
        }
    }, st.client.id);
    renderMsNextSteps();
};

OL.msAddTask = async function() {
    const st = OL._msState;
    if (!st) return;
    const input = document.getElementById('ms-new-task');
    const title = String(input?.value || '').trim();
    if (!title) return;
    const assignee = document.getElementById('ms-new-owner')?.value || 'Sphynx Task';
    const dueDate = document.getElementById('ms-new-due')?.value || '';
    const owner = ownerOf(assignee);
    await updateAndSync(() => {
        st.client.projectData.clientTasks.unshift({
            id: uid(), title, name: title,
            status: owner === 'client' ? 'Client Task' : 'Pending Sphynx Action',
            assignee, dueDate, isClientTask: owner === 'client',
            loggedHours: 0, parentTaskId: null, createdBy: 'meeting-summary', source: 'meeting-summary',
            createdAt: new Date().toISOString(),
            parentEventId: st.evt.id, linkedEventId: st.evt.id,
        });
    }, st.client.id);
    if (input) input.value = '';
    const dueInput = document.getElementById('ms-new-due'); if (dueInput) dueInput.value = '';
    renderMsTaskRows();
};

// An action item that is really the client asking for work: adds it to Pending on the Scoping Sheet as a new
// request or a revision, and links the task to it so the two stay connected. The task stays in this meeting's
// Next steps. Nothing is scheduled or priced until someone moves it into a round.
OL.msMakeRequest = async function(taskId, type) {
    const st = OL._msState;
    if (!st) return;
    const t = st.client.projectData.clientTasks.find(x => x.id === taskId);
    if (!t || t.madeRequestId) return;
    const title = String(t.title || t.name || '').trim();
    const label = type === 'revision' ? 'revision' : 'new request';
    if (!confirm(`Add "${title}" to Pending on the Scoping Sheet as a ${label}?`)) return;
    await updateAndSync(() => {
        const pd = st.client.projectData;
        if (!Array.isArray(pd.scopingSheets)) pd.scopingSheets = [];
        let sheet = pd.scopingSheets.find(sh => sh && sh.kind !== 'maintenance' && sh.id !== 'maintenance');
        if (!sheet) { sheet = { id: 'initial', lineItems: [] }; pd.scopingSheets.unshift(sheet); }
        if (!Array.isArray(sheet.lineItems)) sheet.lineItems = [];
        const when = st.evt.start ? new Date(st.evt.start).toLocaleDateString() : '';
        const item = {
            id: 'li-' + Date.now(),
            resourceId: 'reqline-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            name: title,
            requestType: type === 'revision' ? 'revision' : 'build',
            status: 'Backlog', responsibleParty: 'Sphynx', round: null,
            teamMode: 'everyone', teamIds: [], data: {}, manualHours: 0, dependencies: [],
            notes: `From the meeting "${st.evt.title || 'Meeting'}"${when ? ' on ' + when : ''}.`,
        };
        sheet.lineItems.push(item);
        addLink(t, item.id, []);
        t.madeRequestId = item.id;
        t.madeRequestType = label;
    }, st.client.id);
    renderMsTaskRows();
};

OL.msDeleteTask = async function(taskId) {
    const st = OL._msState;
    if (!st) return;
    const t = st.client.projectData.clientTasks.find(x => x.id === taskId);
    if (!t) return;
    if (!confirm(`Delete the task "${t.title || t.name}"? This removes the task itself, not only the email line.`)) return;
    await updateAndSync(() => {
        st.client.projectData.clientTasks = st.client.projectData.clientTasks.filter(x => x.id !== taskId);
    }, st.client.id);
    renderMsTaskRows();
};

OL.msSend = async function() {
    const st = OL._msState;
    if (!st) return;
    // The next steps are rebuilt from the tasks as they are right now.
    const clientName = st.client.meta?.name || '';
    const nextSteps = nextStepsText(msTasks(), clientName);
    const built = OL.collectCompose('ms', { sectionsHtml: nextStepsHtml(msTasks(), clientName), sectionsText: nextSteps });
    if (!built.to || !built.subject || ![built.messageText, nextSteps, built.closingText].join('').trim()) { alert('To, subject and message are all required.'); return; }
    if (!nextSteps && !confirm('This email has no NEXT STEPS section, because no task from this meeting is ticked \"Include in summary\".\n\nSend it without one?')) return;

    const { ok } = await OL.sendCompose('ms', built, {
        linked_client_id: st.client.id, linked_event_id: st.evt.id, linked_task_id: st.task.id,
    });
    if (!ok) return;
    clearTimeout(msDraftTimer);
    msClearDraft(st.evt.id);   // sent: the saved draft is no longer needed

    const now = new Date().toISOString();
    const { error: stampErr } = await db.from('calendar_events').update({ summary_sent_at: now }).eq('id', st.evt.id);
    if (stampErr) console.warn('Could not record the summary send date:', stampErr.message);

    await updateAndSync(() => {
        const t = st.client.projectData.clientTasks.find(x => x.id === st.task.id);
        if (t) { t.status = 'Done'; t.completedAt = now; }
    }, st.client.id);

    OL.msBack();
};

// Leaves the full page (the event and its summary email are one page) and goes back to what was behind it.
OL.msBack = function() {
    OL.closeFullPage();
    OL._activeEventModalId = null;
};

// ---- Draft kept between visits ----
// Whatever is edited in the summary email (recipients, subject, message, closing) is kept in this browser, per meeting, as
// it is typed, and comes back the next time the meeting's summary is opened (after a refresh, or after leaving to come
// back later). It is cleared when the email is sent or when "Reset to default" is used. Kept in the browser on purpose:
// saving it to the database on every pause would send the whole project back and forth.
const msDraftKey = (eventId) => `ol-ms-draft-${eventId}`;
const msLoadDraft = (eventId) => { try { const v = JSON.parse(localStorage.getItem(msDraftKey(eventId)) || 'null'); return v && typeof v === 'object' ? v : null; } catch (_) { return null; } };
const msClearDraft = (eventId) => { try { localStorage.removeItem(msDraftKey(eventId)); } catch (_) {} };
let msDraftTimer = null;
const msSaveDraftNow = () => {
    const st = OL._msState;
    if (!st || !document.getElementById('ms-message')) return;
    try {
        const r = OL.getRecipients ? OL.getRecipients('ms') : null;
        localStorage.setItem(msDraftKey(st.evt.id), JSON.stringify({
            to: r?.toList || [], cc: r?.ccList || [], bcc: r?.bccList || [],
            subject: document.getElementById('ms-subject')?.value || '',
            messageHtml: document.getElementById('ms-message')?.innerHTML || '',
            closingHtml: document.getElementById('ms-closing')?.innerHTML || '',
            savedAt: Date.now(),
        }));
    } catch (_) { /* storage full or blocked: the draft just isn't kept */ }
};
const msQueueDraftSave = () => { clearTimeout(msDraftTimer); msDraftTimer = setTimeout(msSaveDraftNow, 500); };
OL.msResetDraft = function() {
    const st = OL._msState;
    if (!st) return;
    if (!confirm('Throw away your edits to this email and go back to the default text?')) return;
    msClearDraft(st.evt.id);
    OL.openMeetingSummaryEmail(st.evt.id);
};

OL.openMeetingSummaryEmail = async function(eventId) {
    const { data: evt, error } = await db.from('calendar_events').select('*').eq('id', eventId).single();
    if (error || !evt) { alert('Could not load that meeting.'); return; }
    if (!evt.linked_client_id) { alert('Link this meeting to a client first, so the summary can be filed with them.'); return; }

    const client = await loadFullClient(evt.linked_client_id);
    if (!client || !client.projectData) { alert('Could not load that client.'); return; }
    if (!client.projectData.clientTasks) client.projectData.clientTasks = [];

    let task = client.projectData.clientTasks.find(t => t.meetingSummaryEventId === evt.id);
    if (!task) {
        await updateAndSync(() => {
            task = makeSummaryTask(client, evt);
            client.projectData.clientTasks.unshift(task);
        }, client.id);
    }

    // Coaching clients with prepaid hours get a paid / used / left line in the closing.
    let prepaidHours = null;
    try { if (typeof OL.prepaidHoursSummary === 'function') prepaidHours = await OL.prepaidHoursSummary(client); }
    catch (e) { console.warn('Prepaid hours line skipped:', e); }

    const draft = buildSummaryDraft({
        prepaidHours,
        title: evt.title,
        start: evt.start,
        summary: evt.zoom_summary || '(Add a short summary of the meeting here.)',
        attendeeEmails: evt.attendee_emails || [],
        senderEmails: OL.senderEmails(),
        signatureAttached: !!OL.signatureHtmlFor(OL.myTeamCard()),   // the signature carries the name, so the closing doesn't repeat it
        senderName: typeof OL.getCurrentUserName === 'function' ? OL.getCurrentUserName() : '',
        sphynxEmails: (state.master?.sphynxTeam || []).map(m => m.email).filter(Boolean),
        people: client.projectData.teamMembers || [],
        tasks: [],                      // the window builds Next steps from the live tasks
        clientName: client.meta?.name || '',
        recordingUrl: evt.zoom_recording_drive_url || '',
        templates: getOlSettings().templates.meetingSummary,   // wording from Automations > Templates & settings
    });

    OL._msState = { recordingUrl: evt.zoom_recording_drive_url || '', evt, client, task };
    const savedDraft = msLoadDraft(evt.id);
    OL.initRecipients('ms', { to: savedDraft?.to || draft.recipients, cc: savedDraft?.cc || [], bcc: savedDraft?.bcc || [], onChange: msQueueDraftSave, directory: OL.personDirectory(client, [['On this meeting', evt.attendee_emails || []]]) });

    const sidebarHtml = `
        <style>.ms-task-row textarea { min-height: 56px; overflow: hidden; }</style>
        <div id="ms-ai-recap"></div>
        ${evt.linked_client_id && typeof OL.clientOpenItemsSidebarHtml === 'function' ? OL.clientOpenItemsSidebarHtml(evt.linked_client_id) : ''}
        <div class="bold tiny uppercase muted" style="margin-bottom:4px;">Tasks from this meeting</div>
        <div class="tiny muted" style="margin-bottom:10px;">
            These are the real tasks. Editing them here changes the tasks themselves, and the email follows.
            Changes save as you make them.
        </div>
        <div id="ms-task-rows"></div>
        <div style="border-top:1px solid var(--line); padding-top:10px; margin-top:4px;">
            <input id="ms-new-task" type="text" class="modal-input tiny" style="width:100%; box-sizing:border-box;" placeholder="Add a task from this meeting…"
                   onkeydown="if(event.key==='Enter'){event.preventDefault(); OL.msAddTask();}">
            <div style="display:grid; grid-template-columns: minmax(0,1fr) auto auto; gap:6px; margin-top:6px; align-items:center;">
                <select id="ms-new-owner" class="modal-input tiny">${assigneeOptionsHtml(client, 'Sphynx Task')}</select>
                <input id="ms-new-due" type="date" class="modal-input tiny" style="width:auto !important;" title="Due date — not shown in the email, just scheduling">
                <button type="button" class="btn tiny soft" onclick="OL.msAddTask()">+ Add task</button>
            </div>
        </div>
        <div style="border-top:1px solid var(--line); padding-top:10px; margin-top:12px;">
            <div class="bold tiny uppercase muted" style="margin-bottom:4px;">Other open tasks on this project</div>
            <div class="tiny muted" style="margin-bottom:6px;">Tick any to remind people of them in Next steps — from earlier meetings or anywhere else.</div>
            <input type="text" class="modal-input tiny" placeholder="Filter…" oninput="OL.msSetOtherFilter(this.value)" style="margin-bottom:6px !important;">
            <div id="ms-other-tasks"></div>
        </div>`;

    const eventParts = OL.eventPageParts ? OL.eventPageParts(evt) : { introHtml: '', commentsHtml: '' };
    OL.closeModal();   // the calendar event window, if that is where this was opened from
    OL.openFullPage(OL.composeShellHtml({
        prefix: 'ms',
        page: true, backLabel: 'Back', closeAction: 'OL.msBack()',
        title: evt.title || 'Meeting',
        introHtml: `${eventParts.introHtml}<div style="display:flex; align-items:center; gap:10px; margin:0 0 8px;"><div class="bold tiny uppercase muted">Summary email</div>${savedDraft ? `<div class="tiny muted">Your edits are saved as you type. <a href="#" onclick="event.preventDefault(); OL.msResetDraft();">Reset to default</a></div>` : `<div class="tiny muted">Edits are saved as you type.</div>`}</div>`,
        belowHtml: eventParts.commentsHtml,
        toLabel: 'To (everyone on the meeting except you)',
        subject: savedDraft?.subject || draft.subject,
        messageHtml: savedDraft?.messageHtml || messageTextToHtml(draft.message, OL._msState.recordingUrl), messageMinHeight: 260,
        middleHtml: `
            <div style="margin-bottom:10px;">
                <div class="tiny muted" style="margin-bottom:4px;">Next steps: built from the tasks in the sidebar, so change them there</div>
                <div id="ms-nextsteps-preview" style="margin:0; padding:12px; border:1px dashed var(--line); border-radius:6px; background:rgba(56,189,248,0.04); font-family:inherit; font-size:13px; line-height:1.55;"></div>
                <div id="ms-reorder"></div>
            </div>`,
        closingHtml: savedDraft?.closingHtml || messageTextToHtml(draft.closing, ''),
        sidebarHtml, sidebarWidth: 560,
        sendAction: 'OL.msSend()',
    }));
    if (window.lucide) lucide.createIcons();
    OL.renderAllRecipients('ms');
    {
        const layer = document.getElementById('ol-fullpage');
        if (layer) {
            if (OL._msDraftListener) layer.removeEventListener('input', OL._msDraftListener);
            OL._msDraftListener = (e) => { if (e.target && ['ms-subject', 'ms-message', 'ms-closing'].includes(e.target.id) || e.target?.closest?.('#ms-message, #ms-closing')) msQueueDraftSave(); };
            layer.addEventListener('input', OL._msDraftListener);
        }
    }
    renderMsTaskRows();
    renderMsOtherTasks();
    OL.eventPageAfterRender?.(evt);
    // The recap uses the saved answer when there is one. It only asks the AI by itself the first time, and not at all for a meeting
    // whose summary has already been sent (the Run / Re-run button is there for that).
    try { OL.aiMeetingRecap?.({ evt, client, actionItems: zoomNextStepsNotYetTasks(), auto: !evt.summary_sent_at }); } catch (e) { console.warn('Recap items skipped:', e); }
};

window.OL = window.OL || {};
window.OL.checkMeetingSummaries = OL.checkMeetingSummaries;
window.OL.materializeZoomActionItems = OL.materializeZoomActionItems;
window.OL.backgroundZoomSync = OL.backgroundZoomSync;
window.OL.applyExtensionTimeEntries = OL.applyExtensionTimeEntries;
window.OL.openMeetingSummaryEmail = OL.openMeetingSummaryEmail;
window.OL.msUpdateTask = OL.msUpdateTask;
window.OL.msAddTask = OL.msAddTask;
window.OL.msMakeRequest = OL.msMakeRequest;
window.OL.msDeleteTask = OL.msDeleteTask;
window.OL.msSend = OL.msSend;
window.OL.msBack = OL.msBack;
window.OL.msResetDraft = OL.msResetDraft;
window.OL.msMoveTask = OL.msMoveTask;
window.OL.msCreateTaskFromItem = OL.msCreateTaskFromItem;
window.OL.msSkipZoomItem = OL.msSkipZoomItem;
window.OL.msDismissZoomText = OL.msDismissZoomText;
window.OL.msToggleInclude = OL.msToggleInclude;
window.OL.msSetOtherFilter = OL.msSetOtherFilter;

// First check shortly after load, then every few minutes while the app is open.
if (typeof window !== 'undefined' && typeof setTimeout === 'function') {
    setTimeout(() => OL.checkMeetingSummaries(), 20 * 1000);
    setInterval(() => OL.checkMeetingSummaries(), CHECK_EVERY_MS);
    setTimeout(() => OL.backgroundZoomSync(), 45 * 1000);
    setTimeout(() => OL.applyExtensionTimeEntries(), 15 * 1000);
    setInterval(() => OL.applyExtensionTimeEntries(), 2 * 60 * 1000);
    setInterval(() => OL.backgroundZoomSync(), ZOOM_SYNC_EVERY_MS);
}
