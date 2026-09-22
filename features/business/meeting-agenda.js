// ================= 🗒️ MEETING AGENDA =================
// Prep the next meeting ahead of time. Every calendar event can carry an
// agenda (calendar_events.agenda = { items: [...], notes, sentAt }):
//   items: { id, text, done, source?: { kind: 'task'|'request'|'error'|'carryover', id } }
// "Suggest items" gathers what's actually open for that project — things
// waiting on the client, overdue work, requests in the current round, open
// errors, and anything left unchecked on the previous meeting's agenda —
// so prep is picking, not remembering. It shows in the event window
// (upcoming meetings first), and can be emailed to attendees beforehand.
// Needs the agenda column (migrations/2026_09_ol_fixes.sql).

import { db, state, esc, uid, loadFullClient } from '../../core/data.js';

OL._agendaCache = {}; // eventId -> { evt, agenda }

const emptyAgenda = () => ({ items: [], notes: '', sentAt: null });

async function loadAgenda(eventId) {
    const { data, error } = await db.from('calendar_events')
        .select('id, title, start, linked_client_id, attendee_emails, agenda')
        .eq('id', eventId).maybeSingle();
    if (error) {
        if (/agenda/.test(error.message || '')) return { missingColumn: true };
        throw error;
    }
    const agenda = { ...emptyAgenda(), ...(data?.agenda || {}) };
    OL._agendaCache[eventId] = { evt: data, agenda };
    return OL._agendaCache[eventId];
}

async function saveAgenda(eventId) {
    const entry = OL._agendaCache[eventId];
    if (!entry) return;
    const { error } = await db.from('calendar_events').update({ agenda: entry.agenda }).eq('id', eventId);
    if (error) alert('Could not save the agenda: ' + error.message);
}

// ---- suggestions ----
async function buildSuggestions(entry) {
    const { evt, agenda } = entry;
    const out = [];
    const have = new Set(agenda.items.map(i => i.source ? `${i.source.kind}:${i.source.id}` : 'txt:' + i.text.toLowerCase()));
    const push = (group, text, source) => {
        const key = source ? `${source.kind}:${source.id}` : 'txt:' + text.toLowerCase();
        if (!have.has(key) && !out.some(o => o.key === key)) out.push({ group, text, source, key });
    };
    if (!evt?.linked_client_id) return out;

    const client = await loadFullClient(evt.linked_client_id).catch(() => state.clients?.[evt.linked_client_id]);
    const pd = client?.projectData || {};
    const today = OL.localDateStr();
    const closed = new Set((OL.getSystemStatuses ? OL.getSystemStatuses() : []).filter(s => s.isClosed).map(s => s.name).concat(['Done']));
    const openTasks = (pd.clientTasks || []).filter(t => !closed.has(t.status));

    // 1. Carry-over: unchecked items from this project's previous agenda.
    const { data: prev } = await db.from('calendar_events')
        .select('id, title, start, agenda')
        .eq('linked_client_id', evt.linked_client_id)
        .lt('start', evt.start)
        .not('agenda', 'is', null)
        .order('start', { ascending: false })
        .limit(1);
    (prev?.[0]?.agenda?.items || []).filter(i => !i.done).forEach(i =>
        push(`Left open last meeting (${new Date(prev[0].start).toLocaleDateString()})`, i.text, i.source || { kind: 'carryover', id: i.id }));

    // 2. Waiting on the client.
    openTasks.filter(t => OL.computeIsClientTask ? OL.computeIsClientTask(t.assignee) || t.isClientTask : t.isClientTask)
        .forEach(t => push('Waiting on the client', `${t.title || t.name}${t.dueDate ? ` (due ${OL.formatDayKey(OL.localDayKey(t.dueDate), { month: 'short', day: 'numeric' })})` : ''}`, { kind: 'task', id: t.id }));
    openTasks.filter(t => /pending client/i.test(t.status || '') && !t.isClientTask)
        .forEach(t => push('Waiting on the client', `${t.title || t.name} — ${t.status}`, { kind: 'task', id: t.id }));

    // 3. Overdue / due before the meeting (our side).
    const meetingDay = OL.localDayKey(evt.start);
    openTasks.filter(t => t.dueDate && OL.localDayKey(t.dueDate) <= meetingDay && !(OL.computeIsClientTask && OL.computeIsClientTask(t.assignee)))
        .forEach(t => push(OL.localDayKey(t.dueDate) < today ? 'Overdue (our side)' : 'Due before this meeting', t.title || t.name, { kind: 'task', id: t.id }));

    // 4. Requests active this round.
    (OL.listProjectRequests ? OL.listProjectRequests(client) : [])
        .filter(r => r.status === 'Do Now')
        .forEach(r => push('Requests in progress', OL.requestItemTitle ? OL.requestItemTitle(client, r) : (r.name || 'Request'), { kind: 'request', id: r.id }));

    // 5. Open errors.
    const { data: errs } = await db.from('error_log').select('id, title, message, service').eq('client_id', evt.linked_client_id).neq('status', 'resolved').limit(10);
    (errs || []).forEach(e => push('Open errors', `${e.service ? e.service + ': ' : ''}${e.title || String(e.message || '').slice(0, 80)}`, { kind: 'error', id: e.id }));

    return out;
}

// ---- rendering (inside the event window) ----
export function renderAgendaPlaceholder(evt) {
    return `<div id="agenda-section-${esc(evt.id)}" style="margin-bottom:20px;"></div>`;
}

OL.renderAgendaSection = async function(eventId) {
    const box = document.getElementById(`agenda-section-${eventId}`);
    if (!box) return;
    let entry;
    try { entry = await loadAgenda(eventId); } catch (e) { box.innerHTML = `<div class="tiny muted">Agenda unavailable: ${esc(e.message)}</div>`; return; }
    if (entry.missingColumn) { box.innerHTML = `<div class="tiny muted">Run the agenda migration to enable meeting agendas.</div>`; return; }
    const { evt, agenda } = entry;
    const isUpcoming = new Date(evt.start) > new Date();
    const sugg = OL._agendaSuggestions?.[eventId];

    box.innerHTML = `
    <div style="background:rgba(100,198,162,0.04); padding:14px; border-radius:6px; border:1px solid rgba(100,198,162,0.3);">
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px; flex-wrap:wrap;">
            <i data-lucide="list-checks" style="width:13px;height:13px;color:#64c6a2;"></i>
            <label class="bold tiny uppercase muted" style="margin:0;">Agenda</label>
            <span class="pill tiny soft" style="font-size:9px;">${agenda.items.length} item${agenda.items.length === 1 ? '' : 's'}</span>
            ${agenda.sentAt ? `<span class="tiny muted">Sent ${esc(new Date(agenda.sentAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }))}</span>` : ''}
            <div style="margin-left:auto; display:flex; gap:6px;">
                ${evt.linked_client_id ? `<button class="btn tiny soft" onclick="OL.suggestAgendaItems('${esc(eventId)}')"><i data-lucide="sparkles" style="width:11px;height:11px;"></i> Suggest items</button>` : ''}
                ${isUpcoming && agenda.items.length ? `<button class="btn tiny primary" onclick="OL.emailAgenda('${esc(eventId)}')">✉️ Email agenda</button>` : ''}
            </div>
        </div>
        ${!evt.linked_client_id ? `<div class="tiny muted" style="margin-bottom:6px;">Link this meeting to a project to get suggested items.</div>` : ''}
        <div style="display:grid; gap:3px; margin-bottom:8px;">
            ${agenda.items.length ? agenda.items.map((it, i) => `
                <div style="display:flex; align-items:center; gap:6px; padding:3px 4px;">
                    <input type="checkbox" ${it.done ? 'checked' : ''} title="Covered" onchange="OL.toggleAgendaItem('${esc(eventId)}', ${i})">
                    <span class="tiny" style="flex:1; ${it.done ? 'text-decoration:line-through; opacity:0.6;' : ''} ${it.source?.kind === 'task' ? 'cursor:pointer;' : ''}"
                          ${it.source?.kind === 'task' ? `onclick="OL.openTaskInContext('${esc(evt.linked_client_id || '')}', '${esc(String(it.source.id))}')"` : ''}>${esc(it.text)}</span>
                    <button class="btn tiny soft" style="padding:0 4px;" title="Move up" ${i === 0 ? 'disabled' : ''} onclick="OL.moveAgendaItem('${esc(eventId)}', ${i}, -1)">↑</button>
                    <button class="btn tiny soft" style="padding:0 4px;" onclick="OL.removeAgendaItem('${esc(eventId)}', ${i})">✕</button>
                </div>`).join('') : '<span class="tiny muted">No items yet.</span>'}
        </div>
        <input type="text" class="modal-input tiny" style="width:100%;" placeholder="+ Add an agenda item and press Enter"
               onkeydown="if(event.key==='Enter' && this.value.trim()){ OL.addAgendaItem('${esc(eventId)}', this.value.trim()); this.value=''; }">
        ${sugg ? `
            <div style="margin-top:10px; padding-top:8px; border-top:1px dashed var(--line);">
                ${sugg.length ? `
                    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:4px;">
                        <span class="tiny bold">Suggestions</span>
                        <button class="btn tiny soft" onclick="OL.addAllAgendaSuggestions('${esc(eventId)}')">Add all</button>
                    </div>
                    ${[...new Set(sugg.map(s => s.group))].map(g => `
                        <div class="tiny muted uppercase" style="margin:6px 0 2px; font-size:9px;">${esc(g)}</div>
                        ${sugg.map((s, i) => s.group === g ? `
                            <div class="tiny" style="display:flex; align-items:center; gap:6px; padding:2px 4px;">
                                <button class="btn tiny soft" style="padding:0 5px;" onclick="OL.addAgendaSuggestion('${esc(eventId)}', ${i})">+</button>
                                <span>${esc(s.text)}</span>
                            </div>` : '').join('')}
                    `).join('')}
                ` : '<span class="tiny muted">Nothing open for this project — nice.</span>'}
            </div>` : ''}
        <div style="margin-top:10px;">
            <label class="tiny muted bold" style="display:block; margin-bottom:2px;">Prep notes (internal)</label>
            <textarea class="modal-input tiny" rows="2" style="width:100%; box-sizing:border-box;" placeholder="Anything to remember going in…"
                      onblur="OL.setAgendaNotes('${esc(eventId)}', this.value)">${esc(agenda.notes || '')}</textarea>
        </div>
    </div>`;
    if (window.lucide) lucide.createIcons();
};

const mutate = async (eventId, fn) => {
    const entry = OL._agendaCache[eventId];
    if (!entry) return;
    fn(entry.agenda);
    await saveAgenda(eventId);
    OL.renderAgendaSection(eventId);
};

OL.addAgendaItem = (eventId, text, source) => mutate(eventId, a => a.items.push({ id: uid(), text, done: false, ...(source ? { source } : {}) }));
OL.toggleAgendaItem = (eventId, i) => mutate(eventId, a => { a.items[i].done = !a.items[i].done; });
OL.removeAgendaItem = (eventId, i) => mutate(eventId, a => { a.items.splice(i, 1); });
OL.moveAgendaItem = (eventId, i, d) => mutate(eventId, a => { const j = i + d; if (j >= 0 && j < a.items.length) [a.items[i], a.items[j]] = [a.items[j], a.items[i]]; });
OL.setAgendaNotes = (eventId, notes) => {
    const entry = OL._agendaCache[eventId];
    if (!entry || (entry.agenda.notes || '') === notes) return;
    entry.agenda.notes = notes;
    saveAgenda(eventId);
};

OL._agendaSuggestions = {};
OL.suggestAgendaItems = async function(eventId) {
    const entry = OL._agendaCache[eventId];
    if (!entry) return;
    OL._agendaSuggestions[eventId] = await buildSuggestions(entry);
    OL.renderAgendaSection(eventId);
};
OL.addAgendaSuggestion = async function(eventId, i) {
    const s = OL._agendaSuggestions[eventId]?.[i];
    if (!s) return;
    OL._agendaSuggestions[eventId].splice(i, 1);
    await OL.addAgendaItem(eventId, s.text, s.source);
};
OL.addAllAgendaSuggestions = async function(eventId) {
    const list = OL._agendaSuggestions[eventId] || [];
    OL._agendaSuggestions[eventId] = [];
    await mutate(eventId, a => list.forEach(s => a.items.push({ id: uid(), text: s.text, done: false, ...(s.source ? { source: s.source } : {}) })));
};

// Opens the normal compose window pre-filled with the agenda for everyone
// on the invite (except you), linked to the meeting.
OL.emailAgenda = function(eventId) {
    const entry = OL._agendaCache[eventId];
    if (!entry) return;
    const { evt, agenda } = entry;
    const mine = new Set([state.master?.communications?.gmail?.email, ...(state.master?.sphynxTeam || []).map(m => m.email)].filter(Boolean).map(e => e.toLowerCase()));
    const to = (evt.attendee_emails || []).filter(e => !mine.has(String(e).toLowerCase())).join(', ');
    const when = new Date(evt.start).toLocaleString([], { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    const bodyHtml = `<p>Hi,</p><p>Here's what I'd like to cover on ${esc(when)}:</p><ol>${agenda.items.filter(i => !i.done).map(i => `<li>${esc(i.text)}</li>`).join('')}</ol><p>Let me know if there's anything you'd like to add.</p>`;
    OL.closeModal?.();
    OL.openComposeEmailModal({
        title: '✉️ Email agenda',
        to,
        subject: `Agenda: ${evt.title || 'our meeting'}`,
        bodyHtml,
        linked_client_id: evt.linked_client_id,
        linked_event_id: evt.id,
        onSent: async () => {
            entry.agenda.sentAt = new Date().toISOString();
            await saveAgenda(eventId);
            OL.openCalendarEventModal?.(eventId);
        }
    });
};

Object.assign(window.OL, { renderAgendaPlaceholder });
