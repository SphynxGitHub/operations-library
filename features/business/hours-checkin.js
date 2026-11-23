//======================= FEATURES / BUSINESS / MONTHLY HOURS CHECK-IN EMAIL =======================//
// Opens the "Monthly hours check-in" maintenance task (recurrenceTag 'monthly-touch-base', made in
// core/client-work-rules.js) as a drafted email, the same compose window the client follow-up uses
// (features/business/compose-shared.js). The plan's hours are filled in from Maintenance & Hours; the wording
// around them comes from Automations > Templates & settings (hoursCheckIn).
// Sending logs a note on the task and, when ticked, closes it, which starts next month's check-in (core/recurrence.js).
// Nothing is guessed: if the hours cannot be loaded the window does not open, and the error is shown.

import { state, esc, uid, updateAndSync } from '../../core/data.js';
import { getOlSettings, fillTemplate } from '../../core/ol-settings.js';
import { fillClosing } from './compose-shared.js';

const niceDate = (iso) => (iso ? new Date(`${String(iso).slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '');
const hoursText = (n) => `${Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })} hours`;
const senderNameNow = () => (typeof OL.getCurrentUserName === 'function' ? OL.getCurrentUserName() : '');
const firstName = (full) => String(full || '').trim().split(/\s+/)[0] || '';

// The figures as lines of text, or one line saying why there are none.
function figureLines(sum) {
    if (!sum) return ['No plan hours are set up for this project yet.'];
    const lines = [];
    if (sum.periodStart && sum.periodEnd) lines.push(`Plan period: ${niceDate(sum.periodStart)} to ${niceDate(sum.periodEnd)}`);
    lines.push(`Hours used: ${hoursText(sum.used)} of ${hoursText(sum.total)}`);
    lines.push(sum.remaining >= 0 ? `Hours remaining: ${hoursText(sum.remaining)}` : `Hours over: ${hoursText(-sum.remaining)}`);
    if (sum.blockEnds) lines.push(`These hours run through ${niceDate(sum.blockEnds)}`);
    return lines;
}
const figuresText = (lines) => lines.join('\n');
const figuresHtml = (lines) => `<ul style="margin:6px 0 0 0; padding-left:24px;">${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`;

OL.openHoursCheckInEmail = async function(clientId, taskId) {
    try {
        if (typeof OL.loadFullClient === 'function') await OL.loadFullClient(clientId);
        const client = state.clients?.[clientId];
        const task = client?.projectData?.clientTasks?.find((t) => t && t.id === taskId);
        if (!client || !task) throw new Error('Hours check-in: the project or task could not be found.');
        if (typeof OL.maintenanceHoursSummary !== 'function') throw new Error('Hours check-in: the maintenance hours module is not loaded.');
        const sum = await OL.maintenanceHoursSummary(client);
        const lines = figureLines(sum);

        const contact = OL.greetingContact(client);
        const mine = new Set(OL.senderEmails().map((e) => e.toLowerCase()));
        const clientName = client.meta?.name || 'the project';
        const t = getOlSettings().templates.hoursCheckIn;
        const vars = { client: clientName, sender: senderNameNow() };
        OL._hcState = { clientId, taskId, client, clientName, lines };
        OL.initRecipients('hc', {
            to: contact?.email && !mine.has(contact.email.toLowerCase()) ? [contact.email] : [],
            directory: OL.personDirectory(client),
        });
        const intro = `Hi ${firstName(contact?.name) || 'there'},\n\n${fillTemplate(t.intro, vars)}`;
        const closing = fillClosing(t.closing, vars);
        const alreadyClosed = typeof OL.isClosedStatus === 'function' && OL.isClosedStatus(task.status);

        openModal(OL.composeShellHtml({
            prefix: 'hc',
            title: `Monthly hours check-in — ${clientName}`,
            subject: fillTemplate(t.subject, vars),
            messageHtml: esc(intro).replace(/\n/g, '<br>'),
            middleHtml: `<div style="margin-bottom:14px;">
                <div class="tiny muted" style="margin-bottom:4px;">Hours, filled in from Maintenance &amp; Hours</div>
                <pre style="white-space:pre-wrap; margin:0; padding:12px; border:1px dashed var(--line); border-radius:6px; background:rgba(56,189,248,0.04); font-family:inherit; font-size:13px; line-height:1.55;">${esc(figuresText(lines))}</pre></div>`,
            closingHtml: esc(closing).replace(/\n/g, '<br>'),
            footerLeftHtml: alreadyClosed ? '' : `<label class="tiny" style="display:flex !important; align-items:center; gap:6px; cursor:pointer; margin:0 !important;" title="Closes this check-in. Next month's one is created automatically.">
                <input type="checkbox" id="hc-mark-done" checked style="width:auto !important; display:inline-block !important;"> Mark checked in after sending</label>`,
            footerButtonsHtml: `<button class="btn soft" onclick="OL.hcOpenTask()" title="Open the task itself to log time or add notes">Task details</button>
                ${alreadyClosed ? '' : `<button class="btn soft" onclick="OL.hcMarkDone()" title="Close this check-in without sending an email (you called, for instance)">Mark checked in</button>`}`,
            sendAction: 'OL.hcSend()',
        }));
        OL.renderAllRecipients('hc');
    } catch (e) {
        console.error(e);
        alert(`Could not open the hours check-in email: ${e?.message || e}`);
    }
};

OL.hcSend = async function() {
    const st = OL._hcState;
    if (!st) throw new Error('Hours check-in: the email window is no longer open.');
    const built = OL.collectCompose('hc', { sectionsHtml: figuresHtml(st.lines), sectionsText: figuresText(st.lines) });
    if (!built.to || !built.subject || !built.messageText.trim()) { alert('To, subject and message are all required.'); return; }
    const { ok } = await OL.sendCompose('hc', built, { linked_client_id: st.clientId, linked_task_id: st.taskId });
    if (!ok) return;
    await updateAndSync(() => {
        const t = st.client.projectData.clientTasks.find((x) => x.id === st.taskId);
        if (!t) throw new Error('Hours check-in: the task disappeared before the note could be saved.');
        (t.comments = t.comments || []).push({ id: uid(), author: 'System', text: `Hours check-in email sent to ${built.to}${built.cc ? ` (cc ${built.cc})` : ''}.`, html: '', mentions: [], date: new Date().toISOString() });
    }, st.clientId);
    const markDone = document.getElementById('hc-mark-done')?.checked;
    OL.closeModal();
    if (markDone) OL._cfCloseFollowUp(st.clientId, st.taskId, '');
};

OL.hcMarkDone = function() {
    const st = OL._hcState;
    if (!st) throw new Error('Hours check-in: the email window is no longer open.');
    OL.closeModal();
    OL._cfCloseFollowUp(st.clientId, st.taskId, '');
};

OL.hcOpenTask = function() {
    const st = OL._hcState;
    if (!st) throw new Error('Hours check-in: the email window is no longer open.');
    OL.closeModal();
    if (typeof window.openTaskModal !== 'function') throw new Error('The task window is not available.');
    window.openTaskModal(st.taskId, false, st.clientId);
};
