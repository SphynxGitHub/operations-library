//======================= FEATURES / BUSINESS / MEETING TIME PROMPT =======================//
// After a meeting that is linked to a client project ends, ask whoever was on it how long it really took, so the
// time on the client's hours log is right. Two ways a meeting's time gets set, whichever comes first:
//
//   Zoom      the Zoom sync (supabase/functions/sync-zoom-meetings) works out the elapsed time from the
//             scheduled start to Zoom's actual end and logs it on the event (logged_hours_source = 'zoom'). No
//             prompt is needed for those.
//   Prompt    for everything else (not a Zoom meeting, or Zoom has not reported an end within ZOOM_WAIT_MIN
//             minutes of it finishing) a small window asks for the time as hours and minutes, or as the time the
//             meeting actually ended (same day), pre-filled with the best length known. Time runs from the
//             scheduled start to that end, the same way the Zoom figure does.
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

// Asks the Zoom sync about just this meeting, then re-reads it. Falls back to the event as it was if Zoom says nothing.
async function refreshFromZoom(evt) {
    try {
        await fetch('https://kexnnpwjerrnsmifauuo.supabase.co/functions/v1/sync-zoom-meetings', {
            method: 'POST', headers: { ...(await OL.getAuthHeaders()), 'Content-Type': 'application/json' }, body: JSON.stringify({ eventId: evt.id }),
        });
        const { data } = await db.from('calendar_events').select(COLS).eq('id', evt.id).maybeSingle();
        if (data) { if (data.logged_hours_source === 'zoom' || data.logged_hours_source === 'manual') return null; return data; }
    } catch (e) { console.warn('Zoom check for meeting time failed:', e); }
    return evt;
}

OL.checkMeetingTimePrompts = async function () {
    if (OL._mtpBusy || document.getElementById(OVERLAY_ID)) return;
    const layer = document.getElementById('modal-layer');
    if (layer && layer.style.display === 'flex') return;     // don't interrupt something the person is in the middle of
    OL._mtpBusy = true;
    try {
        let evt = await findDue();
        if (evt && isZoom(evt) && !evt.zoom_elapsed_hours) evt = await refreshFromZoom(evt);   // ask Zoom for the real length first
        if (evt) OL.openMeetingTimePrompt(evt);
    } catch (e) { console.warn('Meeting time prompt check failed:', e); } finally { OL._mtpBusy = false; }
};

const pad2 = (n) => String(n).padStart(2, '0');
const hhmm = (d) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const durLabel = (min) => { const h = Math.floor(min / 60), m = min % 60; return h ? `${h}h ${pad2(m)}m` : `${m}m`; };

OL.openMeetingTimePrompt = function (evt) {
    document.getElementById(OVERLAY_ID)?.remove();
    OL._mtpEvent = evt;
    OL._mtpDirty = false;
    const client = state.clients?.[evt.linked_client_id];
    const scheduled = hoursBetween(evt.start, evt.end);
    const suggested = evt.zoom_elapsed_hours ? Number(evt.zoom_elapsed_hours) : scheduled;
    OL._mtpSuggestedHours = suggested;
    const startD = new Date(evt.start);
    const t = (v) => new Date(v).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const day = startD.toLocaleDateString([], { dateStyle: 'medium' });
    const mins = Math.round(suggested * 60);
    const endD = new Date(startD.getTime() + mins * 60000);
    const wrap = document.createElement('div');
    wrap.id = OVERLAY_ID;
    wrap.style.cssText = 'position:fixed; inset:0; z-index:20000; display:flex; align-items:center; justify-content:center; background:rgba(2,6,23,0.6);';
    wrap.onclick = () => OL.meetingTimeSnooze();
    wrap.innerHTML = `
        <div class="card" style="max-width:460px; width:92vw; padding:20px; cursor:default;" onclick="event.stopPropagation();">
            <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px; font-weight:bold;">
                <i data-lucide="clock" style="width:16px;height:16px;color:var(--accent);"></i> How long was this meeting?
            </div>
            <div class="small" style="margin-bottom:12px; line-height:1.5;"><strong>${esc(evt.title || 'Meeting')}</strong>${client ? ` · ${esc(client.meta?.name || '')}` : ''}
                <div class="tiny muted">${esc(day)} · scheduled ${esc(t(evt.start))} to ${esc(t(evt.end))} (${esc(durLabel(Math.round(scheduled * 60)))})${evt.zoom_elapsed_hours ? ` · Zoom says it ran ${esc(durLabel(mins))}` : isZoom(evt) ? ' · Zoom has not reported when it ended' : ''}</div></div>

            <div style="display:flex; gap:12px; align-items:flex-end; flex-wrap:wrap;">
                <div>
                    <div class="tiny muted" style="margin-bottom:4px;">Length</div>
                    <div style="display:flex; align-items:center; gap:4px;">
                        <input id="mtp-h" type="number" min="0" step="1" class="modal-input" style="width:64px;" value="${Math.floor(mins / 60)}" oninput="OL.mtpFromLength()">
                        <span class="tiny muted">h</span>
                        <input id="mtp-m" type="number" min="0" max="59" step="1" class="modal-input" style="width:64px;" value="${mins % 60}" oninput="OL.mtpFromLength()">
                        <span class="tiny muted">min</span>
                    </div>
                </div>
                <div class="tiny muted" style="padding-bottom:10px;">and / or</div>
                <div>
                    <div class="tiny muted" style="margin-bottom:4px;">Actual end time (${esc(startD.toLocaleDateString([], { month: 'short', day: 'numeric' }))})</div>
                    <input id="mtp-end" type="time" class="modal-input" style="width:130px;" value="${hhmm(endD)}" oninput="OL.mtpFromEnd()">
                </div>
            </div>
            <div id="mtp-readout" class="tiny" style="margin-top:8px; min-height:16px;"></div>
            <div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:6px;">
                <button class="btn tiny soft" onclick="OL.mtpSetMinutes(${Math.round(scheduled * 60)})">As scheduled</button>
                ${evt.zoom_elapsed_hours ? `<button class="btn tiny soft" onclick="OL.mtpSetMinutes(${mins})">Zoom's time</button>` : ''}
            </div>
            <div class="tiny muted" style="margin-top:8px;">Time runs from the scheduled start. Change either the length or the end time and the other follows. It counts toward the client's hours log.</div>
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
    OL.mtpReadout();
    document.getElementById('mtp-h')?.select();
};

// Minutes currently entered, from the length boxes.
const lengthMinutes = () => Math.max(0, Math.round((parseFloat(document.getElementById('mtp-h')?.value) || 0) * 60 + (parseFloat(document.getElementById('mtp-m')?.value) || 0)));
const setLength = (min) => { const h = document.getElementById('mtp-h'), m = document.getElementById('mtp-m'); if (h) h.value = Math.floor(min / 60); if (m) m.value = min % 60; };
const setEndFromMinutes = (min) => { const e = document.getElementById('mtp-end'); if (e && OL._mtpEvent) e.value = hhmm(new Date(new Date(OL._mtpEvent.start).getTime() + min * 60000)); };

// Minutes from the scheduled start to the end time typed, same calendar day; null if empty or not after the start.
function endMinutes() {
    const evt = OL._mtpEvent; const v = document.getElementById('mtp-end')?.value;
    if (!evt || !v) return null;
    const startD = new Date(evt.start); const [hh, mm] = v.split(':').map(Number);
    const endD = new Date(startD.getFullYear(), startD.getMonth(), startD.getDate(), hh, mm, 0, 0);
    const min = Math.round((endD - startD) / 60000);
    return min > 0 ? min : null;
}

OL.mtpReadout = function () {
    const el = document.getElementById('mtp-readout'); const evt = OL._mtpEvent; if (!el || !evt) return;
    const min = lengthMinutes();
    const endD = new Date(new Date(evt.start).getTime() + min * 60000);
    const crossed = !sameDay(endD, new Date(evt.start));
    el.style.color = min <= 0 || crossed ? '#f59e0b' : 'var(--text)';
    el.textContent = min <= 0 ? 'Enter a length or an end time after the start.'
        : `Logs ${durLabel(min)} (${(Math.round(min / 60 * 1000) / 1000).toFixed(3)} h)${crossed ? ' · that ends the next day, check the length' : ''}`;
};
OL.mtpFromLength = function () { OL._mtpDirty = true; setEndFromMinutes(lengthMinutes()); OL.mtpReadout(); };
OL.mtpFromEnd = function () { OL._mtpDirty = true; const m = endMinutes(); if (m !== null) setLength(m); OL.mtpReadout(); };
OL.mtpSetMinutes = function (min) { OL._mtpDirty = true; setLength(min); setEndFromMinutes(min); OL.mtpReadout(); };

const closePrompt = () => { document.getElementById(OVERLAY_ID)?.remove(); OL._mtpEvent = null; };

OL.meetingTimeSnooze = function () { if (OL._mtpEvent) setSnooze(OL._mtpEvent.id); closePrompt(); };

OL.meetingTimeSkip = async function () {
    const evt = OL._mtpEvent; if (!evt) return;
    await db.from('calendar_events').update({ time_prompt_skipped: true }).eq('id', evt.id);
    closePrompt();
};

OL.meetingTimeSave = async function () {
    const evt = OL._mtpEvent; if (!evt) return;
    const min = lengthMinutes();
    if (min <= 0) { alert('Enter how long the meeting ran, or the time it ended.'); return; }
    // Untouched: keep Zoom's / the scheduled figure exactly instead of rounding it to the minute.
    const hours = OL._mtpDirty ? Math.round(min / 60 * 1000) / 1000 : Math.round(OL._mtpSuggestedHours * 1000) / 1000;
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
