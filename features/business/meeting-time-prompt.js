//======================= FEATURES / BUSINESS / MEETING TIME PROMPT =======================//
// After a meeting that is linked to a client project ends, ask whoever was on it how long it really took, so the
// time on the client's hours log is right. Two ways a meeting's time gets set, whichever comes first:
//
//   Zoom      the Zoom sync (supabase/functions/sync-zoom-meetings) works out the elapsed time from the
//             scheduled start to Zoom's actual end and logs it on the event (logged_hours_source = 'zoom'). No
//             prompt is needed for those.
//   Prompt    for everything else (not a Zoom meeting, or Zoom has not reported an end within ZOOM_WAIT_MIN
//             minutes of it finishing) a small window asks for the time, pre-filled with the scheduled length.
//
// Who is asked: the people assigned to the meeting; a meeting with nobody assigned goes to the admin. A time that
// was set by hand (or confirmed here) is never changed by Zoom afterwards. "Don't ask again" leaves the scheduled
// length in place for that meeting.
// Needs the 2026_10 migration (logged_hours_source, zoom_elapsed_hours, time_prompt_skipped). Without it nothing is asked.

import { state, esc, db } from '../../core/data.js';

const ZOOM_WAIT_MIN = 30;           // how long to wait for Zoom to report the real end before asking
const LOOKBACK_HOURS = 72;          // meetings that ended longer ago than this are not asked about
const CHECK_EVERY_MS = 2 * 60 * 1000;
const OVERLAY_ID = 'meeting-time-prompt';
const SNOOZE_MS = 60 * 60 * 1000;

const COLS = 'id, title, start, end, all_day, location, link, description, linked_client_id, assignee, assignees, logged_hours, duration_hours_snapshot, logged_hours_source, zoom_meeting_id, zoom_elapsed_hours, time_prompt_skipped';
const isZoom = (e) => !!e.zoom_meeting_id || /zoom\.us\/j\//i.test(`${e.location || ''} ${e.link || ''} ${e.description || ''}`);
const snoozed = () => { try { return JSON.parse(localStorage.getItem('ol_mtp_snooze') || '{}'); } catch (_) { return {}; } };
const setSnooze = (id) => { try { const m = snoozed(); m[id] = Date.now() + SNOOZE_MS; Object.keys(m).forEach((k) => { if (m[k] < Date.now()) delete m[k]; }); localStorage.setItem('ol_mtp_snooze', JSON.stringify(m)); } catch (_) {} };
const hoursBetween = (a, b) => Math.max(0, (new Date(b) - new Date(a)) / 3600000);
const fmt3 = (n) => (Math.round(Number(n || 0) * 1000) / 1000).toFixed(3);

function isForMe(evt) {
    const names = (evt.assignees?.length ? evt.assignees : (evt.assignee ? [evt.assignee] : [])).map((n) => String(n).trim().toLowerCase());
    const me = String(OL.getCurrentUserName?.() || '').trim().toLowerCase();
    if (!names.length) return !!state.adminMode;
    return !!me && names.some((n) => n === me || n.includes(me) || me.includes(n));
}

async function findDue() {
    if (window.IS_GUEST || (OL.isClientLogin && OL.isClientLogin())) return null;
    if (!state.clients || !Object.keys(state.clients).length) return null;
    const nowMs = Date.now();
    const since = new Date(nowMs - LOOKBACK_HOURS * 3600000).toISOString();
    const { data, error } = await db.from('calendar_events').select(COLS)
        .not('linked_client_id', 'is', null).eq('all_day', false)
        .gte('end', since).lte('end', new Date(nowMs).toISOString())
        .order('end', { ascending: true }).limit(60);
    if (error || !data) return null;                         // migration not run yet: ask nothing
    const snz = snoozed();
    return data.find((e) => {
        if (e.time_prompt_skipped) return false;
        if (e.logged_hours_source === 'zoom' || e.logged_hours_source === 'manual') return false;
        if (!state.clients[e.linked_client_id]) return false;
        if ((snz[e.id] || 0) > nowMs) return false;
        if (isZoom(e) && !e.zoom_elapsed_hours && nowMs - new Date(e.end).getTime() < ZOOM_WAIT_MIN * 60000) return false;   // give Zoom time
        return isForMe(e);
    }) || null;
}

OL.checkMeetingTimePrompts = async function () {
    if (OL._mtpBusy || document.getElementById(OVERLAY_ID)) return;
    const layer = document.getElementById('modal-layer');
    if (layer && layer.style.display === 'flex') return;     // don't interrupt something the person is in the middle of
    OL._mtpBusy = true;
    try {
        const evt = await findDue();
        if (evt) OL.openMeetingTimePrompt(evt);
    } catch (e) { console.warn('Meeting time prompt check failed:', e); } finally { OL._mtpBusy = false; }
};

OL.openMeetingTimePrompt = function (evt) {
    document.getElementById(OVERLAY_ID)?.remove();
    OL._mtpEvent = evt;
    const client = state.clients?.[evt.linked_client_id];
    const scheduled = hoursBetween(evt.start, evt.end);
    const suggested = evt.zoom_elapsed_hours ? Number(evt.zoom_elapsed_hours) : scheduled;
    const t = (v) => new Date(v).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const day = new Date(evt.start).toLocaleDateString([], { dateStyle: 'medium' });
    const wrap = document.createElement('div');
    wrap.id = OVERLAY_ID;
    wrap.style.cssText = 'position:fixed; inset:0; z-index:20000; display:flex; align-items:center; justify-content:center; background:rgba(2,6,23,0.6);';
    wrap.onclick = () => OL.meetingTimeSnooze();
    wrap.innerHTML = `
        <div class="card" style="max-width:440px; width:92vw; padding:20px; cursor:default;" onclick="event.stopPropagation();">
            <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px; font-weight:bold;">
                <i data-lucide="clock" style="width:16px;height:16px;color:var(--accent);"></i> How long was this meeting?
            </div>
            <div class="small" style="margin-bottom:12px; line-height:1.5;"><strong>${esc(evt.title || 'Meeting')}</strong>${client ? ` · ${esc(client.meta?.name || '')}` : ''}
                <div class="tiny muted">${esc(day)}, ${esc(t(evt.start))} to ${esc(t(evt.end))} scheduled (${fmt3(scheduled)} h)${evt.zoom_elapsed_hours ? ` · Zoom says ${fmt3(evt.zoom_elapsed_hours)} h` : ''}</div></div>
            <label class="tiny muted" for="mtp-hours">Hours to log</label>
            <input id="mtp-hours" type="number" step="0.001" min="0" class="modal-input" style="width:100%; margin:4px 0 8px;" value="${fmt3(suggested)}"
                   onkeydown="if(event.key==='Enter'){ event.preventDefault(); OL.meetingTimeSave(); }">
            <div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:6px;">
                <button class="btn tiny soft" onclick="document.getElementById('mtp-hours').value='${fmt3(scheduled)}'">As scheduled</button>
                <button class="btn tiny soft" onclick="const i=document.getElementById('mtp-hours'); i.value=(Math.round((parseFloat(i.value||0)+0.25)*1000)/1000).toFixed(3)">+15 min</button>
                <button class="btn tiny soft" onclick="const i=document.getElementById('mtp-hours'); i.value=Math.max(0,Math.round((parseFloat(i.value||0)-0.25)*1000)/1000).toFixed(3)">−15 min</button>
            </div>
            <div class="tiny muted">Counts toward the client's hours log. Leave it as scheduled if that is right.</div>
            <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-top:16px;">
                <button class="btn tiny soft" onclick="OL.meetingTimeSkip()" title="Keep the scheduled length and stop asking about this meeting">Don't ask again</button>
                <div style="display:flex; gap:8px;">
                    <button class="btn small soft" onclick="OL.meetingTimeSnooze()">Not now</button>
                    <button class="btn small primary" style="font-weight:bold;" onclick="OL.meetingTimeSave()">Log time</button>
                </div>
            </div>
        </div>`;
    document.body.appendChild(wrap);
    if (window.lucide) lucide.createIcons();
    document.getElementById('mtp-hours')?.select();
};

const closePrompt = () => { document.getElementById(OVERLAY_ID)?.remove(); OL._mtpEvent = null; };

OL.meetingTimeSnooze = function () { if (OL._mtpEvent) setSnooze(OL._mtpEvent.id); closePrompt(); };

OL.meetingTimeSkip = async function () {
    const evt = OL._mtpEvent; if (!evt) return;
    await db.from('calendar_events').update({ time_prompt_skipped: true }).eq('id', evt.id);
    closePrompt();
};

OL.meetingTimeSave = async function () {
    const evt = OL._mtpEvent; if (!evt) return;
    const hours = Math.max(0, Math.round((parseFloat(document.getElementById('mtp-hours')?.value) || 0) * 1000) / 1000);
    const { error } = await db.from('calendar_events').update({ logged_hours: hours, logged_hours_source: 'manual', time_prompt_skipped: true }).eq('id', evt.id);
    if (error) { alert('Could not save the time: ' + error.message); return; }
    [state.master?.googleCalendarEvents, OL._calendarGridEvents, OL._dashboardEventsCache].forEach((list) => {
        const e = (list || []).find((x) => x.id === evt.id);
        if (e) { e.logged_hours = hours; e.logged_hours_source = 'manual'; }
    });
    // The hours log on that client's Maintenance & Hours / Time Log tab reads these; make it reload.
    if (OL._maint?.[evt.linked_client_id]) OL._maint[evt.linked_client_id].loadedAt = 0;
    closePrompt();
    if (location.hash.includes('#/maintenance') && typeof OL.renderMaintenancePage === 'function') OL.renderMaintenancePage();
};

if (!OL._mtpTimer) {
    OL._mtpTimer = setInterval(() => OL.checkMeetingTimePrompts(), CHECK_EVERY_MS);
    setTimeout(() => OL.checkMeetingTimePrompts(), 20000);
}
