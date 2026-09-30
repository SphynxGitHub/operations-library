//======================= FEATURES / BUSINESS / CLIENT FOLLOW-UP =======================//
// Opens the consolidated client follow-up task (core/client-work-rules.js) as a compose window, in the same
// shape as the meeting summary email: an editable draft on the left, a checklist of what's actually open on
// the right. Only checked items go into the email; nothing here changes any task's status — sending is just
// sending. The window itself (recipients, layout, signature, sending) is the shared one in
// features/business/compose-shared.js — this file supplies only the follow-up's own content: the wording from
// Automations > Templates & settings, the four generated sections and the open-items sidebar.
//
// The email lists task NAMES only — never descriptions. Review/confirmation items ("Pending Review/Confirmation")
// are their own section, separate from what the client owes us ("Waiting on {client}"). The Waiting on Sphynx /
// Waiting on Other sections carry the implementer's written status note instead, since that note is the point of
// them (see followUpEmailData in core/client-work-rules.js).
// A due date on the "Add a task" control is scheduling detail for whoever owns it, never shown in the email body
// (see core/meeting-summary.js's taskLine for the same rule on meeting summaries). Client tasks have no due dates
// of their own at all, so the "Ask the client" box here has no date field.
// "Mark followed up" (or the box ticked when sending) closes the follow-up task; it then stays done until the
// next follow-up is due (core/client-work-rules.js) instead of coming straight back.

import { state, esc, uid, updateAndSync } from '../../core/data.js';
import { getOlSettings, fillTemplate } from '../../core/ol-settings.js';
import { fillClosing } from './compose-shared.js';

const SECTION_LABELS = {
    clientAsks: (clientName) => `Waiting on ${clientName}`,
    pendingReview: () => 'Pending Review/Confirmation',
    sphynxStalled: () => 'Waiting on Sphynx',
    thirdPartyStalled: () => 'Waiting on Other',
};
const SECTION_ORDER = ['clientAsks', 'pendingReview', 'sphynxStalled', 'thirdPartyStalled'];

function firstName(full) {
    return String(full || '').trim().split(/\s+/)[0] || '';
}

// Wording comes from Automations > Templates & settings (clientFollowUp); {client} and {sender} fill in.
function followUpTemplate() { return getOlSettings().templates.clientFollowUp; }
function senderNameNow() { return typeof OL.getCurrentUserName === 'function' ? OL.getCurrentUserName() : ''; }
function warmIntro(clientName, contactName) {
    return `Hi ${contactName || 'there'},\n\n${fillTemplate(followUpTemplate().intro, { client: clientName, sender: senderNameNow() })}`;
}

// What one bullet says. NAMES ONLY for the client's own items and for review items — never the description. The
// stalled sections show the implementer's status note, which is the reason those items are listed at all.
function bulletFor(key, it) {
    if (key === 'clientAsks') return String(it.title || '').trim();
    if (key === 'pendingReview') return String(it.label || '').trim();
    return `${String(it.label || '').trim()}${it.note ? `: ${it.note}` : ''}`;
}

// The checked items of each section as {heading, lines}, skipping empty sections and repeated lines (two tasks on the
// same resource would otherwise list it twice now that descriptions no longer tell them apart).
function checkedSections(data, checked, clientName) {
    const out = [];
    SECTION_ORDER.forEach((key) => {
        const seen = new Set();
        const lines = (data[key] || []).filter((it) => checked[key]?.has(it.id))
            .map((it) => bulletFor(key, it)).filter((l) => l && !seen.has(l.toLowerCase()) && seen.add(l.toLowerCase()));
        if (lines.length) out.push({ heading: SECTION_LABELS[key](clientName), lines });
    });
    return out;
}

// Rebuilds the sections as plain text from whichever items are currently checked — the read-only preview below the
// editable message, and the plain-text copy of what gets sent. No due dates in here on purpose (see file header).
function sectionsText(data, checked, clientName) {
    return checkedSections(data, checked, clientName)
        .map((sec) => `${sec.heading}\n${sec.lines.map((l) => `• ${l}`).join('\n')}`).join('\n\n');
}

// The same sections as the email's HTML: a bold heading and real bullets per section (same look as the meeting
// summary's Next steps).
function sectionsHtml(data, checked, clientName) {
    return checkedSections(data, checked, clientName)
        .map((sec) => `<div style="margin:10px 0 0 0;"><b>${esc(sec.heading)}</b></div><ul style="margin:4px 0 0 0; padding-left:24px;">${sec.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`).join('');
}

function checklistSectionHtml(key, items, checked, clientName) {
    if (!items.length) return '';
    return `
        <div style="margin-bottom:14px;">
            <div class="tiny bold uppercase muted" style="margin-bottom:4px;">${esc(SECTION_LABELS[key](clientName))} (${items.length})</div>
            <div style="display:grid; gap:3px;">
                ${items.map((it) => `
                    <label style="display:flex !important; align-items:flex-start; gap:6px; padding:4px 6px; border-radius:4px; cursor:pointer; font-size:12px; margin:0 !important;" onmouseover="this.style.background='rgba(255,255,255,0.03)'" onmouseout="this.style.background='none'">
                        <input type="checkbox" style="margin-top:2px; width:auto !important; display:inline-block !important;" ${checked[key]?.has(it.id) ? 'checked' : ''} onchange="OL.cfToggle('${key}', '${esc(String(it.id))}', this.checked)">
                        <span style="flex:1; min-width:0;">
                            <span style="cursor:pointer;" onclick="event.preventDefault(); OL.openTaskInContext('${esc(OL._cfState.clientId)}', '${esc(String(it.id))}')">${esc(it.title || it.label || '')}</span>
                            ${(it.description || it.note) ? `<span class="muted"> — ${esc((it.description || it.note).slice(0, 90))}${(it.description || it.note).length > 90 ? '…' : ''}</span>` : ''}
                        </span>
                    </label>
                `).join('')}
            </div>
        </div>`;
}


function renderSidebar() {
    const box = document.getElementById('cf-sidebar-sections');
    if (!box) return;
    const st = OL._cfState;
    box.innerHTML = SECTION_ORDER.map((key) => checklistSectionHtml(key, st.data[key] || [], st.checked, st.clientName)).join('')
        || '<div class="tiny muted">Nothing open right now.</div>';
    if (window.lucide) lucide.createIcons();
    renderPreview();
}

function renderPreview() {
    const box = document.getElementById('cf-sections-preview');
    if (!box) return;
    const st = OL._cfState;
    const text = sectionsText(st.data, st.checked, st.clientName);
    box.textContent = text || 'Nothing checked — the email will just be the message above.';
}

OL.openClientFollowUpEmail = async function(clientId, taskId) {
    if (typeof OL.loadFullClient === 'function') await OL.loadFullClient(clientId);
    const client = state.clients?.[clientId];
    const task = client?.projectData?.clientTasks?.find((t) => t && t.id === taskId);
    if (!client || !task) return;

    const data = typeof OL.followUpEmailDataForId === 'function' ? OL.followUpEmailDataForId(clientId) : { clientAsks: [], pendingReview: [], sphynxStalled: [], thirdPartyStalled: [] };
    const contact = OL.greetingContact(client);
    const checked = {};
    SECTION_ORDER.forEach((key) => { checked[key] = new Set((data[key] || []).map((it) => it.id)); });   // everything starts checked

    const mine = new Set(OL.senderEmails().map((e) => e.toLowerCase()));
    OL._cfState = { clientId, taskId, client, task, data, checked, clientName: client.meta?.name || 'the project' };
    OL.initRecipients('cf', {
        to: contact?.email && !mine.has(contact.email.toLowerCase()) ? [contact.email] : [],
        directory: OL.personDirectory(client),
    });

    const st = OL._cfState;
    const intro = warmIntro(st.clientName, firstName(contact?.name));
    const closing = fillClosing(followUpTemplate().closing, { client: st.clientName, sender: senderNameNow() });
    const alreadyClosed = typeof OL.isClosedStatus === 'function' && OL.isClosedStatus(task.status);
    const followedUp = alreadyClosed && !!task.nextFollowUpDue;
    const everyDays = Number(state.master?.followUpEveryDays) || 3;

    const sidebarHtml = `
        <div class="bold tiny uppercase muted" style="margin-bottom:4px;">Open items</div>
        <div class="tiny muted" style="margin-bottom:10px;">Checked items are included in the email — by name only. Unchecking one here doesn't change it — it's just left out of this email.</div>

        <div style="border-bottom:1px solid var(--line); padding-bottom:10px; margin-bottom:10px;">
            <div class="tiny muted" style="margin-bottom:4px;">Ask the client for something new</div>
            <input id="cf-new-title" type="text" class="modal-input tiny" placeholder="What do you need?">
            <div style="margin-top:6px;">
                <select id="cf-new-kind" class="modal-input tiny">
                    <option value="document">Document</option>
                    <option value="review">Review / confirmation</option>
                    <option value="feedback">Feedback</option>
                </select>
            </div>
            <button type="button" class="btn tiny soft full-width" style="margin-top:6px;" onclick="OL.cfAddClientAsk()">+ Add</button>
        </div>

        <div id="cf-sidebar-sections"></div>`;

    const html = OL.composeShellHtml({
        prefix: 'cf',
        title: `✉️ Client follow-up — ${st.clientName}`,
        headBadgeHtml: followedUp ? `<span class="pill tiny soft" style="color:#22c55e; display:inline-flex; align-items:center; gap:4px; margin-left:10px;">✓ Followed up · next ${esc(OL.formatDayKey ? OL.formatDayKey(task.nextFollowUpDue || '', { month: 'short', day: 'numeric' }) : (task.nextFollowUpDue || ''))}</span>` : '',
        subject: fillTemplate(followUpTemplate().subject, { client: st.clientName, sender: senderNameNow() }),
        messageHtml: esc(intro).replace(/\n/g, '<br>'),
        middleHtml: `
            <div style="margin-bottom:14px;">
                <div class="tiny muted" style="margin-bottom:4px;">Checked items below, built from the sidebar — check or uncheck items there to change this</div>
                <pre id="cf-sections-preview" style="white-space:pre-wrap; margin:0; padding:12px; border:1px dashed var(--line); border-radius:6px; background:rgba(56,189,248,0.04); font-family:inherit; font-size:13px; line-height:1.55;"></pre>
            </div>`,
        closingHtml: esc(closing).replace(/\n/g, '<br>'),
        sidebarHtml, sidebarWidth: 340,
        footerLeftHtml: alreadyClosed ? '' : `
            <label class="tiny" style="display:flex !important; align-items:center; gap:6px; cursor:pointer; margin:0 !important;" title="Closes this follow-up. It comes back on its own if the client still has items open when the next one is due.">
                <input type="checkbox" id="cf-mark-done" checked style="width:auto !important; display:inline-block !important;"> Mark followed up after sending (next in ${everyDays} days)
            </label>`,
        footerButtonsHtml: alreadyClosed ? '' : `<button class="btn soft" onclick="OL.cfMarkFollowedUp()" title="Close this follow-up without sending an email (you called, for instance)">Mark followed up</button>`,
        sendAction: 'OL.cfSend()',
    });
    openModal(html);
    OL.renderAllRecipients('cf');
    renderSidebar();
};

OL.cfToggle = function(key, id, checked) {
    const st = OL._cfState;
    if (!st) return;
    if (checked) st.checked[key].add(id); else st.checked[key].delete(id);
    renderPreview();
};

// Adds a new client ask directly from the sidebar and includes it right away — the same shape saveAsks creates
// (features/scoping.js), just without the full "Ask client" window, and not tied to a specific request.
OL.cfAddClientAsk = async function() {
    const st = OL._cfState;
    if (!st) return;
    const title = (document.getElementById('cf-new-title')?.value || '').trim();
    if (!title) { alert('Say what you need.'); return; }
    const kind = document.getElementById('cf-new-kind')?.value || 'document';
    const statusFor = { document: 'Pending Client Document', review: 'Pending Client Review', feedback: 'Pending Client Feedback' };
    const now = new Date().toISOString();
    const task = {
        id: uid(), title, name: title, description: '', status: statusFor[kind] || 'Pending Client Document',
        assignee: 'Client Task', dueDate: '', isClientTask: true, loggedHours: 0, parentTaskId: null,
        createdBy: 'client-followup', createdAt: now, askKind: kind,
    };
    await updateAndSync(() => { st.client.projectData.clientTasks.unshift(task); }, st.clientId);

    // A review/confirmation ask goes in its own section, same as followUpEmailData files it (core/client-work-rules.js).
    if (kind === 'review') {
        st.data.pendingReview.unshift({ id: task.id, label: task.title, note: '' });
        st.checked.pendingReview.add(task.id);
    } else {
        st.data.clientAsks.unshift({ id: task.id, title: task.title, description: '' });
        st.checked.clientAsks.add(task.id);
    }

    const titleInput = document.getElementById('cf-new-title'); if (titleInput) titleInput.value = '';
    renderSidebar();
};

OL.cfSend = async function() {
    const st = OL._cfState;
    if (!st) return;
    const built = OL.collectCompose('cf', {
        sectionsHtml: sectionsHtml(st.data, st.checked, st.clientName),
        sectionsText: sectionsText(st.data, st.checked, st.clientName),
    });
    if (!built.to || !built.subject || !built.messageText.trim()) { alert('To, subject and message are all required.'); return; }

    const { ok } = await OL.sendCompose('cf', built, { linked_client_id: st.clientId, linked_task_id: st.taskId });
    if (!ok) return;

    // A record on the follow-up task itself — not a status change, just history. The consolidated follow-up
    // still opens and closes on its own rules (core/client-work-rules.js) based on what's actually open.
    await updateAndSync(() => {
        const t = st.client.projectData.clientTasks.find((x) => x.id === st.taskId);
        if (t) {
            (t.comments = t.comments || []).push({ id: uid(), author: 'System', text: `Follow-up email sent to ${built.to}${built.cc ? ` (cc ${built.cc})` : ''}.`, html: '', mentions: [], date: new Date().toISOString() });
        }
    }, st.clientId);

    const markDone = document.getElementById('cf-mark-done')?.checked;
    OL.closeModal();
    if (markDone) OL._cfCloseFollowUp(st.clientId, st.taskId);
};

// Closes the follow-up task through the same path as the status menu (so completion steps run). The save that
// follows parks it until the next follow-up is due.
OL._cfCloseFollowUp = function(clientId, taskId) {
    const closedName = ((typeof OL.getSystemStatuses === 'function' ? OL.getSystemStatuses() : []).find((s) => s.isClosed) || {}).name || 'Done';
    OL.updateGlobalTaskStatus(clientId, taskId, closedName);
};

OL.cfMarkFollowedUp = function() {
    const st = OL._cfState;
    if (!st) return;
    OL.closeModal();
    OL._cfCloseFollowUp(st.clientId, st.taskId);
};

Object.assign(window.OL, { openClientFollowUpEmail: OL.openClientFollowUpEmail, cfToggle: OL.cfToggle, cfAddClientAsk: OL.cfAddClientAsk, cfSend: OL.cfSend, cfMarkFollowedUp: OL.cfMarkFollowedUp });
