//======================= CORE / MEETING SUMMARY =======================//
// Builds the draft of the meeting summary email from a meeting's Zoom summary and the
// tasks created from its action items. Pure functions: no database, no page.
// The draft is plain text, because the app's send function sends plain text.
//
// Layout
//   Hi <names of the non-Sphynx attendees>,
//   <intro paragraph>
//   Here is the recording of our session   only when a recording link exists
//                                           (a hyperlink in the sent email)
//   SUMMARY            the Zoom summary
//   NEXT STEPS         open tasks from the meeting, grouped Sphynx / client
//   Best, <sender>

import { taskAssignees } from './task-assignees.js';
import { linksForTask } from './task-links.js';
const PLACEHOLDER_ASSIGNEES = ['Sphynx Task', 'Client Task'];

const lower = (v) => String(v || '').trim().toLowerCase();

// "Alicia Schonberger, CFP®, CDFA®" -> "Alicia"
export function firstNameFromFullName(name) {
    const first = String(name || '').trim().split(/[\s,]+/)[0] || '';
    return /^[A-Za-z][A-Za-z'’.-]*$/.test(first) ? first : '';
}

// "alicia.schonberger@firm.com" -> "Alicia"; anything that does not look like a name -> ''
export function firstNameFromEmail(email) {
    const local = String(email || '').split('@')[0] || '';
    const token = local.split(/[._+\-]/)[0] || '';
    if (token.length < 2 || !/^[A-Za-z]+$/.test(token)) return '';
    return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
}

export function joinNames(names) {
    const list = (names || []).filter(Boolean);
    if (list.length === 0) return '';
    if (list.length === 1) return list[0];
    return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

// Everyone who was on the meeting except the sender, once each. The sender can be one address
// or several (the connected Gmail account and the signed-in person's own address).
export function recipientsFor(attendeeEmails, senderEmail) {
    const senders = new Set((Array.isArray(senderEmail) ? senderEmail : [senderEmail]).map(lower).filter(Boolean));
    const seen = new Set();
    const out = [];
    (attendeeEmails || []).forEach((raw) => {
        const email = String(raw || '').trim();
        const key = lower(email);
        if (!key || !key.includes('@') || senders.has(key) || seen.has(key)) return;
        seen.add(key);
        out.push(email);
    });
    return out;
}

// The first names for the greeting: recipients who are not Sphynx team members.
export function greetingNames(recipients, { sphynxEmails = [], people = [] } = {}) {
    const sphynx = new Set((sphynxEmails || []).map(lower));
    const byEmail = new Map((people || [])
        .filter(p => p && (p.email || p.emailAddress))
        .map(p => [lower(p.email || p.emailAddress), p.name]));

    const names = [];
    (recipients || []).forEach((email) => {
        if (sphynx.has(lower(email))) return;
        const name = firstNameFromFullName(byEmail.get(lower(email))) || firstNameFromEmail(email);
        if (name && !names.includes(name)) names.push(name);
    });
    return names;
}

// Tasks tied to this meeting in any way (its event, or a request linked to it), open or closed, without the
// summary task itself and the client follow-up.
function tiedToEvent(t, eventId) {
    return !!t && [t.linkedEventId, t.parentEventId].some((id) => id != null && String(id) === String(eventId))
        && !t.meetingSummaryEventId && t.askKind !== 'follow_up';
}

// What Zoom recorded for this meeting that is not a task now: the action items stored on the meeting, plus the lines of
// the summary's own "Next steps" list, each once. A task made from one of them counts whether it is open or done, so
// finished work is never offered again; an item whose task was deleted is offered again.
export function zoomItemsNotYetTasks({ summary, actionItems, tasks, eventId }) {
    const known = new Set((tasks || []).filter((t) => tiedToEvent(t, eventId)).map((t) => String(t.title || t.name || '').trim().toLowerCase()));
    const seen = new Set();
    const out = [];
    [...(Array.isArray(actionItems) ? actionItems : []).map((x) => String(x || '').trim()), ...splitNextStepsSection(summary).items].forEach((item) => {
        const key = String(item || '').trim().toLowerCase();
        if (!key || known.has(key) || seen.has(key)) return;
        seen.add(key);
        out.push(String(item).trim());
    });
    return out;
}

// Tasks from this meeting that are already closed (so the list of open ones leaves them out).
export function closedTasksForEvent(tasks, eventId, closedNames) {
    const closed = Array.isArray(closedNames) && closedNames.length ? closedNames : ['Done'];
    return (tasks || []).filter((t) => tiedToEvent(t, eventId) && closed.includes(String(t.status || '')));
}

// Open tasks that came out of this meeting, excluding the summary task itself and follow-ups.
// opts.requestIds: ids of the requests linked to this meeting. A task linked to one of those requests (task.links[],
// or the older requestLineItemId) came out of the same meeting, even when it was never stamped with the event itself.
export function tasksForEvent(tasks, eventId, closedNames, opts = {}) {
    const closed = Array.isArray(closedNames) && closedNames.length ? closedNames : ['Done'];
    const requestIds = new Set((opts.requestIds || []).map(String));
    const viaRequest = (t) => requestIds.size > 0 && linksForTask(t).some((l) => requestIds.has(String(l.requestId)));
    return (tasks || []).filter(t => t
        && (String(t.linkedEventId) === String(eventId) || String(t.parentEventId) === String(eventId) || viaRequest(t))
        && !t.meetingSummaryEventId
        && t.askKind !== 'follow_up'
        && !closed.includes(String(t.status || '')));
}

function formatDue(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    if (!m) return '';
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[Number(m[2]) - 1]} ${Number(m[3])}`;
}

function formatMeetingDate(startIso) {
    const d = new Date(startIso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

function shortDate(startIso) {
    const d = new Date(startIso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Zoom's own summary ends with a "Next steps" list (the sync adds one when Zoom sends it separately), and the email
// has its own NEXT STEPS section built from the meeting's linked tasks. Showing both says everything twice, so the
// SUMMARY part of the email drops the summary's version — the stored summary is left whole.
//
// A section is a line that is only the label ("Next steps", "Next steps:", "## Next steps", "**Action items**",
// "Follow-ups"), plus what belongs to it: the paragraph right below, or a whole list of bullets. It ends at the
// first line that is neither blank nor a bullet, so whatever comes after (a new heading, another paragraph) stays.
const NEXT_STEPS_LABEL = /^\s*(?:#{1,6}\s*)?(?:\*\*|__)?\s*(?:next\s+steps?|action\s+items?|follow[\s-]?ups?)\s*(?:\*\*|__)?\s*:?\s*(?:\*\*|__)?\s*$/i;
const BULLET_LINE = /^\s*(?:[-*•▪◦‣–—]|\d+[.)])\s+\S/;

// Splits Zoom's summary into what stays in the SUMMARY and the lines of its "Next steps" section.
// Returns { kept, items }: kept is the summary without that section, items are its lines as plain text (one per
// bullet or line, a bullet's indented continuation joined onto it).
export function splitNextStepsSection(text) {
    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    const items = [];
    const take = (line, listy) => {
        if (BULLET_LINE.test(line)) items.push(line.replace(/^\s*(?:[-*•▪◦‣–—]|\d+[.)])\s+/, '').trim());
        else if (listy && /^\s+\S/.test(line) && items.length) items[items.length - 1] += ' ' + line.trim();
        else if (line.trim()) items.push(line.trim());
    };
    for (let i = 0; i < lines.length; i++) {
        if (!NEXT_STEPS_LABEL.test(lines[i])) { out.push(lines[i]); continue; }

        i++;
        while (i < lines.length && !lines[i].trim()) i++;               // blank lines under the heading
        if (i < lines.length) {
            const listy = BULLET_LINE.test(lines[i]);
            while (i < lines.length && lines[i].trim()) {                 // the block right below the heading
                if (listy && !BULLET_LINE.test(lines[i]) && !/^\s+\S/.test(lines[i])) break;   // (indented lines continue a bullet)
                take(lines[i], listy);
                i++;
            }
            if (listy) {                                                  // a bulleted list can be split by blank lines
                for (;;) {
                    let j = i;
                    while (j < lines.length && !lines[j].trim()) j++;
                    if (j < lines.length && BULLET_LINE.test(lines[j])) {
                        i = j;
                        while (i < lines.length && lines[i].trim() && (BULLET_LINE.test(lines[i]) || /^\s+\S/.test(lines[i]))) { take(lines[i], true); i++; }
                    } else break;
                }
            }
        }
        i--;   // the loop's own i++ moves to the first line that was kept
    }
    return { kept: out.join('\n'), items };
}

export function stripNextStepsSection(text) {
    return splitNextStepsSection(text).kept;
}

function tidySummary(text) {
    const original = String(text || '');
    const stripped = stripNextStepsSection(original);
    // A summary that was nothing but next steps would leave an empty SUMMARY; keep the prompt instead.
    return tidySummaryText(stripped.trim() || !original.trim() ? stripped : '(Add a short summary of the meeting here.)');
}

function tidySummaryText(text) {
    return String(text || '')
        .replace(/\r\n?/g, '\n')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

// Due dates are scheduling detail for whoever owns the task, not something the client needs in the email body —
// they're set from the Add task control, not shown in this bullet.
function taskLine(task) {
    const names = taskAssignees(task).filter(n => !PLACEHOLDER_ASSIGNEES.includes(n));
    const who = names.length ? ` (${names.join(', ')})` : '';
    return `• ${String(task.title || task.name || 'Task').trim()}${who}`;
}

// The Next steps section as text, generated from the tasks (never typed by hand).
export function nextStepsText(tasks, clientName) {
    const sphynxTasks = (tasks || []).filter(t => t.isClientTask !== true);
    const clientTasks = (tasks || []).filter(t => t.isClientTask === true);
    if (!sphynxTasks.length && !clientTasks.length) return '';
    const blocks = [];
    if (sphynxTasks.length) blocks.push(`Sphynx\n${sphynxTasks.map(taskLine).join('\n')}`);
    if (clientTasks.length) blocks.push(`${clientName || 'Client'}\n${clientTasks.map(taskLine).join('\n')}`);
    return `NEXT STEPS\n\n${blocks.join('\n\n')}`;
}

// The Next steps section as the email's HTML: a bold heading, a bold label for each group, real bullets. Built from
// the same tasks as nextStepsText, so the preview, the plain-text copy and the sent email always agree.
export function nextStepsHtml(tasks, clientName) {
    const sphynxTasks = (tasks || []).filter(t => t.isClientTask !== true);
    const clientTasks = (tasks || []).filter(t => t.isClientTask === true);
    if (!sphynxTasks.length && !clientTasks.length) return '';
    const label = (t) => {
        const names = taskAssignees(t).filter(n => !PLACEHOLDER_ASSIGNEES.includes(n));
        return `${escHtml(String(t.title || t.name || 'Task').trim())}${names.length ? ` (${escHtml(names.join(', '))})` : ''}`;
    };
    const group = (name, list) => `<div style="margin:10px 0 0 0;"><b>${escHtml(name)}</b></div><ul style="margin:4px 0 0 0; padding-left:24px;">${list.map(t => `<li>${label(t)}</li>`).join('')}</ul>`;
    return `<div><b>NEXT STEPS</b></div>${sphynxTasks.length ? group('Sphynx', sphynxTasks) : ''}${clientTasks.length ? group(clientName || 'Client', clientTasks) : ''}`;
}

// Joins the three parts of the email with a blank line between, skipping empty ones.
export function assembleBody({ message, nextSteps, closing }) {
    return [message, nextSteps, closing]
        .map(part => String(part || '').trim())
        .filter(Boolean)
        .join('\n\n');
}

// The recording line. In the sent email this exact text becomes a link to the recording;
// the plain-text copy gets the address after it.
export const RECORDING_LINE = 'Here is the recording of our session';

const escHtml = (v) => String(v || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// A heading line: only capital letters, spaces and a little punctuation ("SUMMARY", "HELPFUL RESOURCES", "NEXT STEPS").
// Headings are bold by default, wherever they appear in the message.
const HEADING_LINE = /^[A-Z][A-Z0-9 &/,'’-]{2,}$/;
const isHeadingLine = (line) => HEADING_LINE.test(String(line || '').trim()) && /[A-Z]{2}/.test(line);
const linesToHtml = (text) => String(text || '').split('\n')
    .map((line) => (isHeadingLine(line) ? `<b>${escHtml(line.trim())}</b>` : escHtml(line))).join('<br>');

// The message text as editor HTML, with the recording line already a real link, so what
// you see in the editor is what gets sent.
export function messageTextToHtml(text, recordingUrl) {
    const url = String(recordingUrl || '').trim();
    let html = linesToHtml(text);
    if (url && /^https?:\/\//i.test(url)) html = html.replace(escHtml(RECORDING_LINE), `<a href="${escHtml(url)}">${escHtml(RECORDING_LINE)}</a>`);
    return html;
}

// The finished email in both forms. If the recording line was deleted from the message,
// no link is added anywhere.
// Returns { text, html }.
export function renderEmailBodies(body, recordingUrl) {
    const url = String(recordingUrl || '').trim();
    const hasLine = !!url && /^https?:\/\//i.test(url) && String(body || '').includes(RECORDING_LINE);
    // (a trailing period is dropped in the text copy so it can't end up inside the address)
    const text = hasLine ? String(body).replace(new RegExp(`${RECORDING_LINE}\\.?`), `${RECORDING_LINE}: ${url}`) : String(body || '');
    let html = linesToHtml(body);
    if (hasLine) html = html.replace(escHtml(RECORDING_LINE), `<a href="${escHtml(url)}">${escHtml(RECORDING_LINE)}</a>`);
    html = `<div style="font-family:Arial,Helvetica,sans-serif; font-size:14px; line-height:1.5;">${html}</div>`;
    return { text, html };
}

// input: { title, start, summary, attendeeEmails, senderEmail (or senderEmails), senderName, sphynxEmails,
//          people: [{ name, email }], tasks (already filtered to this meeting), clientName, recordingUrl }
// Returns the pieces separately so the window can edit the message and closing as text while
// the next steps stay tied to the real tasks: { to, recipients, subject, message, nextSteps, closing, body }.
export function buildSummaryDraft(input) {
    const recipients = recipientsFor(input.attendeeEmails, input.senderEmails || input.senderEmail);
    const names = greetingNames(recipients, { sphynxEmails: input.sphynxEmails, people: input.people });
    const meetingDate = formatMeetingDate(input.start);

    const recordingUrl = String(input.recordingUrl || '').trim();
    // The thanks and the "below is a summary" sentence read as one paragraph (no line break between them); the
    // recording line, when there is one, follows on its own line.
    // The wording comes from settings (input.templates = the meetingSummary block of Automations > Templates &
    // settings) when given; the literals here are only the fallback. {date}, {title} and {sender} fill in.
    const tpl = input.templates || {};
    const senderName = String(input.senderName || '').trim() || 'The Sphynx team';
    const tvars = { date: meetingDate, title: String(input.title || 'Meeting').trim(), sender: senderName };
    const fillT = (text) => String(text)
        .replace(/\s+on \{date\}/g, tvars.date ? ` on ${tvars.date}` : '')
        .replace(/\{(\w+)\}/g, (m, k) => (k in tvars ? tvars[k] : m));
    const intro = [
        fillT(tpl.intro || 'Thanks for taking the time to meet with us on {date}. Below is a summary of what we covered and the next steps.'),
        ...(recordingUrl ? [`${RECORDING_LINE}.`] : []),
    ].join('\n');
    // One line break under a header, not a blank line: the summary starts right beneath SUMMARY.
    const message = [
        `Hi ${joinNames(names) || 'there'},`,
        intro,
        `SUMMARY\n${tidySummary(input.summary)}`,
    ].join('\n\n');

    const nextSteps = nextStepsText(input.tasks, input.clientName);

    const closing = fillT(tpl.closing || 'Best,\n{sender}');

    const date = shortDate(input.start);
    return {
        to: recipients.join(', '),
        recipients,
        greetingNames: names,
        subject: fillT((tpl.subject || 'Summary: {title} ({date})').replace(/\{date\}/g, date))
            .replace(/\s*\(\s*\)/g, '')                        // no date -> no empty brackets
            .replace(/^Summary:\s*(?=summary\b)/i, ''),          // the title already says Summary
        message,
        nextSteps,
        closing,
        body: assembleBody({ message, nextSteps, closing }),
    };
}

// Spacing for the email that goes out, whatever the editor produced: no blank line between a heading and what is
// under it, no stray line breaks in front of a list, and lists with a small, even margin.
export function tidyEmailHtml(html) {
    const BR = '(?:<br\\s*\\/?>\\s*)';
    let out = String(html || '');
    // a bold heading followed by two or more line breaks -> one
    out = out.replace(new RegExp(`(<(b|strong)>\\s*[A-Z][A-Z0-9 &/,'’-]{2,}\\s*<\\/\\2>)${BR}{2,}`, 'g'), '$1<br>');
    // line breaks right before a list are the list's own gap, not extra
    out = out.replace(new RegExp(`${BR}+(?=<(?:ul|ol)\\b)`, 'gi'), '');
    // lists without their own style get a small even margin (the editor's clean-up strips styles from them)
    out = out.replace(/<(ul|ol)(?![^>]*\bstyle=)([^>]*)>/gi, '<$1 style="margin:6px 0 10px 0; padding-left:24px;"$2>');
    return out;
}
