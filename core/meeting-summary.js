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

// Open tasks that came out of this meeting, excluding the summary task itself and follow-ups.
export function tasksForEvent(tasks, eventId, closedNames) {
    const closed = Array.isArray(closedNames) && closedNames.length ? closedNames : ['Done'];
    return (tasks || []).filter(t => t
        && (String(t.linkedEventId) === String(eventId) || String(t.parentEventId) === String(eventId))
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

function tidySummary(text) {
    return String(text || '')
        .replace(/\r\n?/g, '\n')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function taskLine(task) {
    const who = task.assignee && !PLACEHOLDER_ASSIGNEES.includes(task.assignee) ? ` (${task.assignee})` : '';
    const due = formatDue(task.dueDate);
    return `• ${String(task.title || task.name || 'Task').trim()}${who}${due ? `, due ${due}` : ''}`;
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

// The message text as editor HTML, with the recording line already a real link, so what
// you see in the editor is what gets sent.
export function messageTextToHtml(text, recordingUrl) {
    const url = String(recordingUrl || '').trim();
    let html = escHtml(text).replace(/\n/g, '<br>');
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
    let html = escHtml(body);
    if (hasLine) html = html.replace(escHtml(RECORDING_LINE), `<a href="${escHtml(url)}">${escHtml(RECORDING_LINE)}</a>`);
    html = `<div style="font-family:Arial,Helvetica,sans-serif; font-size:14px; line-height:1.5;">${html.replace(/\n/g, '<br>')}</div>`;
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
    // Thanks / recording / summary intro, one per line (the recording line only when there is one).
    const intro = [
        `Thanks for taking the time to meet with us${meetingDate ? ` on ${meetingDate}` : ''}.`,
        ...(recordingUrl ? [`${RECORDING_LINE}.`] : []),
        'Below is a summary of what we covered and the next steps.',
    ].join('\n');
    const message = [
        `Hi ${joinNames(names) || 'there'},`,
        intro,
        `SUMMARY\n\n${tidySummary(input.summary)}`,
    ].join('\n\n');

    const nextSteps = nextStepsText(input.tasks, input.clientName);

    const closing = `Best,\n${String(input.senderName || '').trim() || 'The Sphynx team'}`;

    const date = shortDate(input.start);
    return {
        to: recipients.join(', '),
        recipients,
        greetingNames: names,
        subject: `${/^summary\b/i.test(String(input.title || '').trim()) ? '' : 'Summary: '}${String(input.title || 'Meeting').trim()}${date ? ` (${date})` : ''}`,
        message,
        nextSteps,
        closing,
        body: assembleBody({ message, nextSteps, closing }),
    };
}
