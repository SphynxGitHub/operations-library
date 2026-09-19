// ================= 📧 MEETING SUMMARY EMAIL =================
// When a meeting linked to a client has a Zoom summary, a "Meeting summary" task appears for
// the client's Communication role. Opening it (or the meeting) shows one window with the
// email and the meeting's REAL tasks side by side. The Next steps section of the email is
// generated from those tasks, so a change is made once, on the task: editing a title, owner
// or due date, adding a task, or deleting one updates the actual task immediately and the
// email follows. Sending emails everyone on the meeting except the sender, marks the meeting
// with the send date (calendar_events.summary_sent_at), links the sent email to the meeting
// through the existing send function, and completes the summary task.
//
// Needs 001_lifecycle_tables.sql (adds calendar_events.summary_sent_at).

import { db, state, esc, uid, loadFullClient, updateAndSync } from '../../core/data.js';
import { buildSummaryDraft, tasksForEvent, nextStepsText, assembleBody, greetingNames, joinNames } from '../../core/meeting-summary.js';

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

// Addresses that count as "you": the connected Gmail account, and the signed-in person's own
// address when they are on the Sphynx team list.
function senderEmails() {
    const emails = [state.master?.communications?.gmail?.email];
    const me = typeof OL.getCurrentUserName === 'function' ? OL.getCurrentUserName() : '';
    if (me) {
        (state.master?.sphynxTeam || []).forEach(m => { if (m.name === me && m.email) emails.push(m.email); });
    }
    return emails.filter(Boolean);
}

function dueTwoDaysAfter(startIso) {
    const d = new Date(startIso);
    if (Number.isNaN(d.getTime())) return '';
    d.setDate(d.getDate() + 2);
    return d.toISOString().slice(0, 10);
}

function makeSummaryTask(client, evt) {
    const title = `Meeting summary: ${evt.title || 'Meeting'}`;
    return {
        id: uid(),
        title,
        name: title,
        description: 'Review the Zoom summary and the action items from this meeting, edit the email, and send it to the attendees.',
        status: 'Pending Sphynx Action',
        assignee: communicationAssignee(client),
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
            .select('id, title, start, linked_client_id, summary_sent_at')
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

// ---- recipients: chips that show names from the team cards ----
// Each recipient is an email address shown as a chip. If the address belongs to someone on the
// Sphynx team or the client's team, the chip shows their name (hover for the address).
// Add people from the team list, or type any address. Sending uses the addresses.
const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
const emailsOf = (m) => [m.email, m.emailAddress, ...(Array.isArray(m.emails) ? m.emails : [])].filter(Boolean);

function personDirectory(client, evt) {
    const list = [];
    const seen = new Set();
    const add = (name, emails, group) => {
        emails.forEach((raw) => {
            const email = String(raw || '').trim();
            const key = email.toLowerCase();
            if (!EMAIL_RE.test(email) || seen.has(key)) return;
            seen.add(key);
            list.push({ name: name || '', email, group });
        });
    };
    (state.master?.sphynxTeam || []).forEach(m => add(m.name, emailsOf(m), 'Sphynx team'));
    (client.projectData?.teamMembers || []).forEach(m => add(m.name, emailsOf(m), `${client.meta?.name || 'Client'} team`));
    (evt.attendee_emails || []).forEach(e => add('', [e], 'On this meeting'));
    return list;
}

const RCPT_FIELDS = { to: 'To', cc: 'Cc' };
const sameEmail = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
const nameForEmail = (email) => (OL._msState.directory.find(p => sameEmail(p.email, email)) || {}).name || '';

function renderMsRecipients(field) {
    const st = OL._msState;
    const box = document.getElementById(`ms-${field}-box`);
    if (!box) return;
    const typed = document.getElementById(`ms-${field}-input`)?.value || '';

    const chips = st[field].map((email, i) => `
        <span title="${esc(email)}" style="display:inline-flex; align-items:center; gap:6px; padding:3px 6px 3px 10px; border-radius:999px; background:rgba(37,99,235,0.10); border:1px solid rgba(37,99,235,0.25); font-size:13px; line-height:1.3;">
            ${esc(nameForEmail(email) || email)}
            <button type="button" title="Remove" onclick="OL.msRemoveRecipient('${field}', ${i})"
                    style="border:none; background:transparent; cursor:pointer; padding:0 2px; font-size:13px; color:inherit; line-height:1;">✕</button>
        </span>`).join('');

    box.innerHTML = `
        <div style="position:relative; display:flex; flex-wrap:wrap; align-items:center; gap:6px; padding:6px 8px; border:1px solid var(--line); border-radius:12px; background:rgba(255,255,255,0.02);">
            ${chips}
            <input type="text" id="ms-${field}-input" autocomplete="off" placeholder="${st[field].length ? 'Add another…' : 'Type a name or email…'}"
                   style="display:inline-block !important; width:auto !important; flex:1 1 160px; min-width:140px; border:none !important; background:transparent !important; box-shadow:none !important; outline:none; padding:5px 2px !important; margin:0 !important;"
                   oninput="OL.msShowSuggestions('${field}')" onfocus="OL.msShowSuggestions('${field}')"
                   onkeydown="OL.msRecipientKey('${field}', event)" onblur="OL.msRecipientBlur('${field}')">
            <button type="button" class="btn tiny soft" style="flex:0 0 auto;" onmousedown="event.preventDefault(); OL.msShowSuggestions('${field}', true)">+ Team</button>
            <div id="ms-${field}-suggest" style="display:none; position:absolute; left:0; right:0; top:calc(100% + 4px); z-index:30; max-height:240px; overflow-y:auto; background:var(--bg-card, #ffffff); color:var(--text, inherit); border:1px solid var(--line); border-radius:10px; box-shadow:0 10px 24px rgba(0,0,0,0.18);"></div>
        </div>`;

    const input = document.getElementById(`ms-${field}-input`);
    if (input && typed) input.value = typed;
}

OL.msShowSuggestions = function(field, showAll) {
    const st = OL._msState;
    const panel = document.getElementById(`ms-${field}-suggest`);
    if (!st || !panel) return;
    const typed = (document.getElementById(`ms-${field}-input`)?.value || '').trim();
    const q = showAll ? '' : typed.toLowerCase();

    const matches = st.directory
        .filter(p => !st[field].some(e => sameEmail(e, p.email)))
        .filter(p => !q || `${p.name} ${p.email}`.toLowerCase().includes(q))
        .slice(0, 40);
    st.suggest = st.suggest || {};
    st.suggest[field] = matches;

    let html = '';
    let lastGroup = '';
    matches.forEach((p, i) => {
        if (p.group !== lastGroup) {
            html += `<div style="padding:6px 12px 2px; font-size:11px; text-transform:uppercase; letter-spacing:.04em; opacity:.6;">${esc(p.group)}</div>`;
            lastGroup = p.group;
        }
        html += `<div onmousedown="event.preventDefault(); OL.msPickRecipient('${field}', ${i})"
                      style="padding:7px 12px; cursor:pointer; font-size:13px;" onmouseover="this.style.background='rgba(37,99,235,0.08)'" onmouseout="this.style.background=''">
                    ${p.name ? `<strong>${esc(p.name)}</strong> <span style="opacity:.65;">${esc(p.email)}</span>` : esc(p.email)}
                 </div>`;
    });
    if (!matches.length) {
        html = `<div style="padding:8px 12px; font-size:13px; opacity:.75;">${EMAIL_RE.test(typed)
            ? `Press Enter to add <strong>${esc(typed)}</strong>`
            : (typed ? 'No one matches. Type a full email address and press Enter to add it.' : 'Everyone on the lists is already added.')}</div>`;
    }
    panel.innerHTML = html;
    panel.style.display = 'block';
};

const hideMsSuggestions = (field) => {
    const panel = document.getElementById(`ms-${field}-suggest`);
    if (panel) panel.style.display = 'none';
};

function addMsRecipient(field, email) {
    const st = OL._msState;
    const clean = String(email || '').trim();
    if (!EMAIL_RE.test(clean)) return false;
    if (st[field].some(e => sameEmail(e, clean))) return true;
    st[field].push(clean);
    return true;
}

OL.msAddRecipient = function(field, email) {
    if (!OL._msState || !RCPT_FIELDS[field]) return false;
    const ok = addMsRecipient(field, email);
    if (ok) renderMsRecipients(field);
    return ok;
};

OL.msRemoveRecipient = function(field, index) {
    const st = OL._msState;
    if (!st || !RCPT_FIELDS[field]) return;
    st[field].splice(index, 1);
    renderMsRecipients(field);
};

OL.msPickRecipient = function(field, index) {
    const st = OL._msState;
    const person = st?.suggest?.[field]?.[index];
    if (!person) return;
    addMsRecipient(field, person.email);
    const input = document.getElementById(`ms-${field}-input`);
    if (input) input.value = '';
    renderMsRecipients(field);
    document.getElementById(`ms-${field}-input`)?.focus?.();
    OL.msShowSuggestions(field);
};

// Adds whatever addresses are typed in the box. Returns { added, invalid }.
OL.msCommitRecipient = function(field) {
    const st = OL._msState;
    const input = document.getElementById(`ms-${field}-input`);
    if (!st || !input) return { added: 0, invalid: 0 };
    const tokens = String(input.value || '').split(/[,;\s]+/).filter(Boolean);
    let added = 0, invalid = 0;
    const left = [];
    tokens.forEach((t) => { if (addMsRecipient(field, t)) added++; else { invalid++; left.push(t); } });
    input.value = left.join(' ');
    if (added) renderMsRecipients(field);
    return { added, invalid };
};

OL.msRecipientKey = function(field, ev) {
    const st = OL._msState;
    if (!st) return;
    const input = document.getElementById(`ms-${field}-input`);
    if (ev.key === 'Enter' || ev.key === ',' || ev.key === ';') {
        ev.preventDefault();
        if (!String(input?.value || '').trim()) return;
        const { added, invalid } = OL.msCommitRecipient(field);
        if (!added && invalid) {
            // one obvious match from the list: take it
            const only = st.suggest?.[field];
            if (only && only.length === 1) { OL.msPickRecipient(field, 0); return; }
            alert('Enter a valid email address, or pick someone from the list.');
        }
    } else if (ev.key === 'Backspace' && !String(input?.value || '') && st[field].length) {
        st[field].pop();
        renderMsRecipients(field);
        document.getElementById(`ms-${field}-input`)?.focus?.();
    } else if (ev.key === 'Escape') {
        hideMsSuggestions(field);
    }
};

OL.msRecipientBlur = function(field) {
    setTimeout(() => { OL.msCommitRecipient(field); hideMsSuggestions(field); }, 150);
};

// The greeting is typed text, so it does not change by itself when recipients change.
OL.msRefreshGreeting = function() {
    const st = OL._msState;
    const box = document.getElementById('ms-message');
    if (!st || !box) return;
    const names = greetingNames(st.to, {
        sphynxEmails: (state.master?.sphynxTeam || []).map(m => m.email).filter(Boolean),
        people: st.directory.filter(p => p.name),
    });
    const lines = String(box.value || '').split('\n');
    const greeting = `Hi ${joinNames(names) || 'there'},`;
    if (/^hi\b/i.test(lines[0] || '')) lines[0] = greeting; else lines.unshift(greeting, '');
    box.value = lines.join('\n');
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

const msTasks = () => tasksForEvent(OL._msState.client.projectData.clientTasks, OL._msState.evt.id, closedStatusNames());

function renderMsTaskRows() {
    const st = OL._msState;
    const box = document.getElementById('ms-task-rows');
    if (!box) return;
    const tasks = msTasks();
    box.innerHTML = tasks.length ? tasks.map(t => {
        const title = t.title || t.name || '';
        const rowsNeeded = Math.min(8, Math.max(2, Math.ceil(title.length / 34)));
        return `
        <div class="ms-task-row" style="border:1px solid var(--line); border-radius:6px; padding:8px; margin-bottom:8px;">
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
        </div>`;
    }).join('')
        : '<div class="tiny muted" style="margin-bottom:8px;">No open tasks from this meeting yet.</div>';
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
    const text = nextStepsText(msTasks(), st.client.meta?.name || '');
    el.textContent = text || '(No next steps section: there are no open tasks from this meeting.)';
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
    const owner = ownerOf(assignee);
    await updateAndSync(() => {
        st.client.projectData.clientTasks.unshift({
            id: uid(), title, name: title,
            status: owner === 'client' ? 'Client Task' : 'Pending Sphynx Action',
            assignee, dueDate: '', isClientTask: owner === 'client',
            loggedHours: 0, parentTaskId: null, createdBy: 'meeting-summary', source: 'meeting-summary',
            createdAt: new Date().toISOString(),
            parentEventId: st.evt.id, linkedEventId: st.evt.id,
        });
    }, st.client.id);
    if (input) input.value = '';
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
    const read = (id) => document.getElementById(id)?.value ?? '';
    OL.msCommitRecipient('to');
    OL.msCommitRecipient('cc');
    const to = st.to.join(', ');
    const cc = st.cc.join(', ');
    const subject = read('ms-subject').trim();
    // The next steps are rebuilt from the tasks as they are right now.
    const nextSteps = nextStepsText(msTasks(), st.client.meta?.name || '');
    const body = assembleBody({ message: read('ms-message'), nextSteps, closing: read('ms-closing') });
    if (!to || !subject || !body.trim()) { alert('To, subject and message are all required.'); return; }

    const btn = document.getElementById('ms-send-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Sending...'; }

    const { ok } = await OL.sendGmailMessage({
        to, cc: cc || undefined, subject, body,
        linked_client_id: st.client.id, linked_event_id: st.evt.id, linked_task_id: st.task.id,
    });
    if (!ok) {
        if (btn) { btn.disabled = false; btn.textContent = 'Send'; }
        return;
    }

    const now = new Date().toISOString();
    const { error: stampErr } = await db.from('calendar_events').update({ summary_sent_at: now }).eq('id', st.evt.id);
    if (stampErr) console.warn('Could not record the summary send date:', stampErr.message);

    await updateAndSync(() => {
        const t = st.client.projectData.clientTasks.find(x => x.id === st.task.id);
        if (t) { t.status = 'Done'; t.completedAt = now; }
    }, st.client.id);

    OL.closeModal();
    if (OL._activeEventModalId === st.evt.id && typeof OL.openCalendarEventModal === 'function') {
        OL.openCalendarEventModal(st.evt.id);
    }
};

OL.openMeetingSummaryEmail = async function(eventId) {
    const { data: evt, error } = await db.from('calendar_events').select('*').eq('id', eventId).single();
    if (error || !evt) { alert('Could not load that meeting.'); return; }
    if (!String(evt.zoom_summary || '').trim()) { alert('This meeting has no Zoom summary yet.'); return; }
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

    const draft = buildSummaryDraft({
        title: evt.title,
        start: evt.start,
        summary: evt.zoom_summary,
        attendeeEmails: evt.attendee_emails || [],
        senderEmails: senderEmails(),
        senderName: typeof OL.getCurrentUserName === 'function' ? OL.getCurrentUserName() : '',
        sphynxEmails: (state.master?.sphynxTeam || []).map(m => m.email).filter(Boolean),
        people: client.projectData.teamMembers || [],
        tasks: [],                      // the window builds Next steps from the live tasks
        clientName: client.meta?.name || '',
        recordingUrl: evt.recording_url || '',
    });

    OL._msState = { evt, client, task, directory: personDirectory(client, evt), to: [...draft.recipients], cc: [], suggest: {} };

    const html = `
        <style>
            /* Set explicitly, so the window looks right whatever the app's default form styling is */
            .ms-layout label { display: block !important; margin: 0 0 4px !important; font-size: 12px !important; }
            .ms-layout input[type="text"], .ms-layout input[type="date"], .ms-layout select, .ms-layout textarea {
                display: block !important; width: 100% !important; box-sizing: border-box !important; margin: 0 !important;
                font-size: 13px !important; line-height: 1.45 !important; font-family: inherit !important;
            }
            .ms-layout textarea { resize: vertical; }
            .ms-layout pre { font-size: 13px !important; line-height: 1.55 !important; }
            .ms-layout .ms-task-row textarea { min-height: 56px; overflow: hidden; }
            @media (max-width: 900px) {
                .ms-layout { grid-template-columns: minmax(0, 1fr) !important; }
                .ms-layout aside { position: static !important; max-height: none !important; }
            }
        </style>
        <div class="modal-head">
            <div class="modal-title-text">✉️ Meeting summary email</div>
            <div class="spacer"></div>
            <button class="btn small soft" onclick="OL.closeModal()">Close</button>
        </div>
        <div class="modal-body" style="max-width:none; box-sizing:border-box;">
            <div class="ms-layout" style="box-sizing:border-box; max-width:100%; display:grid; grid-template-columns: minmax(0, 1fr) 360px; gap:20px; align-items:start;">

                <div style="min-width:0;">
                    <div style="margin-bottom:10px;">
                        <label class="tiny muted">To (everyone on the meeting except you)</label>
                        <div id="ms-to-box"></div>
                    </div>
                    <div style="margin-bottom:10px;">
                        <label class="tiny muted">Cc</label>
                        <div id="ms-cc-box"></div>
                    </div>
                    <label class="tiny muted">Subject</label>
                    <input id="ms-subject" type="text" class="modal-input" style="margin-bottom:12px;" value="${esc(draft.subject)}">

                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                        <label class="tiny muted" style="margin:0 !important;">Message</label>
                        <button type="button" class="btn tiny soft" onclick="OL.msRefreshGreeting()" title="Rewrites the first line to name the people in To">Update greeting from recipients</button>
                    </div>
                    <textarea id="ms-message" class="modal-input" rows="14" style="margin-bottom:10px;">${esc(draft.message)}</textarea>

                    <div style="margin-bottom:10px;">
                        <div class="tiny muted" style="margin-bottom:4px;">Next steps: built from the tasks in the sidebar, so change them there</div>
                        <pre id="ms-nextsteps-preview" style="white-space:pre-wrap; margin:0; padding:12px; border:1px dashed var(--line); border-radius:6px; background:rgba(56,189,248,0.04); font-family:inherit; font-size:13px; line-height:1.55;"></pre>
                    </div>

                    <label class="tiny muted">Closing</label>
                    <textarea id="ms-closing" class="modal-input" rows="4" style="margin-bottom:14px;">${esc(draft.closing)}</textarea>

                    <div style="display:flex; justify-content:flex-end; gap:10px;">
                        <button class="btn soft" onclick="OL.closeModal()">Cancel</button>
                        <button id="ms-send-btn" class="btn primary" onclick="OL.msSend()">Send</button>
                    </div>
                </div>

                <aside style="min-width:0; border:1px solid var(--line); border-radius:8px; padding:12px; background:rgba(56,189,248,0.03); position:sticky; top:0; max-height:calc(100vh - 150px); overflow-y:auto;">
                    <div class="bold tiny uppercase muted" style="margin-bottom:4px;">Tasks from this meeting</div>
                    <div class="tiny muted" style="margin-bottom:10px;">
                        These are the real tasks. Editing them here changes the tasks themselves, and the email follows.
                        Changes save as you make them.
                    </div>
                    <div id="ms-task-rows"></div>
                    <div style="border-top:1px solid var(--line); padding-top:10px; margin-top:4px;">
                        <input id="ms-new-task" type="text" class="modal-input tiny" style="width:100%; box-sizing:border-box;" placeholder="Add a task from this meeting…"
                               onkeydown="if(event.key==='Enter'){event.preventDefault(); OL.msAddTask();}">
                        <div style="display:grid; grid-template-columns: minmax(0,1fr) auto; gap:6px; margin-top:6px; align-items:center;">
                            <select id="ms-new-owner" class="modal-input tiny">${assigneeOptionsHtml(client, 'Sphynx Task')}</select>
                            <button type="button" class="btn tiny soft" onclick="OL.msAddTask()">+ Add task</button>
                        </div>
                    </div>
                </aside>

            </div>
        </div>
    `;
    openModal(html);
    renderMsRecipients('to');
    renderMsRecipients('cc');
    renderMsTaskRows();
};

window.OL = window.OL || {};
window.OL.checkMeetingSummaries = OL.checkMeetingSummaries;
window.OL.openMeetingSummaryEmail = OL.openMeetingSummaryEmail;
window.OL.msUpdateTask = OL.msUpdateTask;
window.OL.msAddTask = OL.msAddTask;
window.OL.msDeleteTask = OL.msDeleteTask;
window.OL.msSend = OL.msSend;
Object.assign(window.OL, {
    msShowSuggestions: OL.msShowSuggestions, msAddRecipient: OL.msAddRecipient, msRemoveRecipient: OL.msRemoveRecipient,
    msPickRecipient: OL.msPickRecipient, msCommitRecipient: OL.msCommitRecipient, msRecipientKey: OL.msRecipientKey,
    msRecipientBlur: OL.msRecipientBlur, msRefreshGreeting: OL.msRefreshGreeting
});

// First check shortly after load, then every few minutes while the app is open.
if (typeof window !== 'undefined' && typeof setTimeout === 'function') {
    setTimeout(() => OL.checkMeetingSummaries(), 20 * 1000);
    setInterval(() => OL.checkMeetingSummaries(), CHECK_EVERY_MS);
}
