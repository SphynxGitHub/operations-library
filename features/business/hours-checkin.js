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

// The list as lines (bullets) plus an optional footnote. Maintenance: tier, period start and end, hours used and remaining
// across every block available. Prepaid coaching: hours paid, used and remaining. Hours carry an asterisk when part of
// them is carried over from the last plan period.
function figures(sum) {
    if (!sum) return { lines: ['No plan hours are set up for this project yet.'], footnote: '' };
    const star = !sum.coaching && sum.carryoverHours > 0 ? '*' : '';
    const lines = [];
    if (sum.coaching) {
        lines.push(`Hours Paid: ${hoursText(sum.total)}`);
    } else {
        if (sum.tier) lines.push(`Subscription Tier: ${sum.tier}`);
        if (sum.periodStart) lines.push(`Subscription Start Date: ${niceDate(sum.periodStart)}`);
        if (sum.periodEnd) lines.push(`Subscription Expiration Date: ${niceDate(sum.periodEnd)}`);
    }
    lines.push(`Hours Used: ${hoursText(sum.used)}${star}`);
    lines.push(sum.remaining >= 0 ? `Hours Remaining: ${hoursText(sum.remaining)}${star}` : `Hours Over: ${hoursText(-sum.remaining)}${star}`);
    // Courtesy hours rolled over from the last plan period: how many, how many are still unused, and when they expire.
    const left = Math.max(0, Math.round((sum.carryoverHours - sum.carryoverUsed) * 1000) / 1000);
    const footnote = star
        ? `*Includes ${hoursText(sum.carryoverHours)} of courtesy hours rolled over from your previous plan period (${hoursText(left)} still unused${sum.carryoverExpires ? `; they expire ${niceDate(sum.carryoverExpires)}` : ''}).`
        : '';
    return { lines, footnote };
}
const figuresText = (f) => f.lines.map((l) => `* ${l}`).join('\n') + (f.footnote ? `\n\n${f.footnote}` : '');
const figuresHtml = (f) => `<ul style="margin:6px 0 0 0; padding-left:24px;">${f.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>${f.footnote ? `<div style="margin-top:8px;">${esc(f.footnote)}</div>` : ''}`;
// Text with [words](https://address) links, as safe HTML.
const withLinks = (text) => esc(text).replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (m, label, url) => `<a href="${url}" target="_blank" rel="noopener">${label}</a>`).replace(/\n/g, '<br>');

OL.openHoursCheckInEmail = async function(clientId, taskId) {
    try {
        if (typeof OL.loadFullClient === 'function') await OL.loadFullClient(clientId);
        const client = state.clients?.[clientId];
        const task = client?.projectData?.clientTasks?.find((t) => t && t.id === taskId);
        if (!client || !task) throw new Error('Hours check-in: the project or task could not be found.');
        if (typeof OL.maintenanceHoursSummary !== 'function') throw new Error('Hours check-in: the maintenance hours module is not loaded.');
        const sum = await OL.maintenanceHoursSummary(client);
        const fig = figures(sum);

        const contact = OL.greetingContact(client);
        const mine = new Set(OL.senderEmails().map((e) => e.toLowerCase()));
        const clientName = client.meta?.name || 'the project';
        const t = getOlSettings().templates.hoursCheckIn;
        const vars = { client: clientName, sender: senderNameNow(), month: new Date().toLocaleDateString('en-US', { month: 'long' }) };
        OL._hcState = { clientId, taskId, client, clientName, fig };
        OL.initRecipients('hc', {
            to: contact?.email && !mine.has(contact.email.toLowerCase()) ? [contact.email] : [],
            directory: OL.personDirectory(client),
        });
        const intro = `Hi ${firstName(contact?.name) || 'there'},\n\n${fillTemplate(t.intro, vars)}`;
        const closing = fillClosing(t.closing, vars);
        const notes = fillTemplate(t.notes, vars);
        const alreadyClosed = typeof OL.isClosedStatus === 'function' && OL.isClosedStatus(task.status);

        openModal(OL.composeShellHtml({
            prefix: 'hc',
            title: `Monthly hours check-in — ${clientName}`,
            subject: fillTemplate(t.subject, vars),
            messageHtml: esc(intro).replace(/\n/g, '<br>'),
            middleHtml: `<div style="margin-bottom:14px;">
                <div class="tiny muted" style="margin-bottom:4px;">Hours, filled in from Maintenance &amp; Hours</div>
                <pre style="white-space:pre-wrap; margin:0; padding:12px; border:1px dashed var(--line); border-radius:6px; background:rgba(56,189,248,0.04); font-family:inherit; font-size:13px; line-height:1.55;">${esc(figuresText(fig))}</pre></div>`,
            closingHtml: `${withLinks(notes)}<br><br>${esc(closing).replace(/\n/g, '<br>')}`,
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
    const built = OL.collectCompose('hc', { sectionsHtml: figuresHtml(st.fig), sectionsText: figuresText(st.fig) });
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
