//======================= FEATURES / BUSINESS / CLIENT FOLLOW-UP =======================//
// Opens the consolidated client follow-up task (core/client-work-rules.js) as a compose window, in the same
// shape as the meeting summary email: an editable draft on the left, a checklist of what's actually open on
// the right. Only checked items go into the email; nothing here changes any task's status — sending is just
// sending. A due date on the "Add a task" control is scheduling detail for whoever owns it, never shown in
// the email body itself (see core/meeting-summary.js's taskLine for the same rule on meeting summaries).
// Client tasks have no due dates of their own at all, so the "Ask the client" box here has no date field.
// "Mark followed up" (or the box ticked when sending) closes the follow-up task; it then stays done until the
// next follow-up is due (core/client-work-rules.js) instead of coming straight back.

import { state, esc, uid, db, updateAndSync } from '../../core/data.js';

const SECTION_LABELS = {
    clientAsks: (clientName) => `Waiting on ${clientName}`,
    pendingReview: () => 'Pending Client Review',
    sphynxStalled: () => 'Waiting on Sphynx',
    thirdPartyStalled: () => 'Waiting on Other',
};
const SECTION_ORDER = ['clientAsks', 'pendingReview', 'sphynxStalled', 'thirdPartyStalled'];

function firstName(full) {
    return String(full || '').trim().split(/\s+/)[0] || '';
}

// Who this is addressed to: the client's primary contact, else the first team member with an email.
function greetingContact(client) {
    const team = client?.projectData?.teamMembers || [];
    const primary = team.find((m) => m.isPrimaryContact && m.email) || team.find((m) => m.email);
    return primary || null;
}

function warmIntro(clientName, contactName) {
    return `Hi ${contactName || 'there'},\n\nTouching base with you regarding the open items on your project. Please see below:`;
}

// Rebuilds the four sections as plain text from whichever items are currently checked — the read-only preview
// below the editable message, same pattern as the meeting summary's Next Steps preview, and what actually gets
// sent. No due dates in here on purpose (see file header).
function sectionsText(data, checked, clientName) {
    const blocks = [];
    SECTION_ORDER.forEach((key) => {
        const items = (data[key] || []).filter((it) => checked[key]?.has(it.id));
        if (!items.length) return;
        const lines = items.map((it) => key === 'clientAsks'
            ? `• ${it.title}${it.description ? `: ${it.description}` : ''}`
            : `• ${it.label}${it.note ? `: ${it.note}` : ''}`);
        blocks.push(`${SECTION_LABELS[key](clientName)}\n${lines.join('\n')}`);
    });
    return blocks.join('\n\n');
}

function checklistSectionHtml(key, items, checked, clientName) {
    if (!items.length) return '';
    return `
        <div style="margin-bottom:14px;">
            <div class="tiny bold uppercase muted" style="margin-bottom:4px;">${esc(SECTION_LABELS[key](clientName))} (${items.length})</div>
            <div style="display:grid; gap:3px;">
                ${items.map((it) => `
                    <label style="display:flex; align-items:flex-start; gap:6px; padding:4px 6px; border-radius:4px; cursor:pointer; font-size:12px;" onmouseover="this.style.background='rgba(255,255,255,0.03)'" onmouseout="this.style.background='none'">
                        <input type="checkbox" style="margin-top:2px;" ${checked[key]?.has(it.id) ? 'checked' : ''} onchange="OL.cfToggle('${key}', '${esc(String(it.id))}', this.checked)">
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
    const contact = greetingContact(client);
    const checked = {};
    SECTION_ORDER.forEach((key) => { checked[key] = new Set((data[key] || []).map((it) => it.id)); });   // everything starts checked

    OL._cfState = {
        clientId, taskId, client, task, data, checked,
        clientName: client.meta?.name || 'the project',
        to: contact?.email || '', toName: contact?.name || '',
    };

    const st = OL._cfState;
    const intro = warmIntro(st.clientName, firstName(contact?.name));
    const alreadyClosed = typeof OL.isClosedStatus === 'function' && OL.isClosedStatus(task.status);
    const followedUp = alreadyClosed && !!task.nextFollowUpDue;
    const everyDays = Number(state.master?.followUpEveryDays) || 3;

    const html = `
        <style>
            .cf-layout { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 20px; align-items: start; }
            @media (max-width: 900px) { .cf-layout { grid-template-columns: minmax(0, 1fr) !important; } .cf-layout aside { position: static !important; max-height: none !important; } }
        </style>
        <div class="modal-head">
            <div class="modal-title-text">✉️ Client follow-up — ${esc(st.clientName)}</div>
            ${followedUp ? `<span class="pill tiny soft" style="color:#22c55e; display:inline-flex; align-items:center; gap:4px; margin-left:10px;">✓ Followed up · next ${esc(OL.formatDayKey ? OL.formatDayKey(task.nextFollowUpDue || '', { month: 'short', day: 'numeric' }) : (task.nextFollowUpDue || ''))}</span>` : ''}
            <div class="spacer"></div>
            <button class="btn small soft" onclick="OL.closeModal()">Close</button>
        </div>
        <div class="modal-body" style="max-width:none; box-sizing:border-box;">
            <div class="cf-layout">
                <div style="min-width:0;">
                    <label class="tiny muted">To</label>
                    <input id="cf-to" type="text" class="modal-input" style="margin-bottom:10px;" value="${esc(st.to)}" placeholder="name@example.com">

                    <label class="tiny muted">Subject</label>
                    <input id="cf-subject" type="text" class="modal-input" style="margin-bottom:12px;" value="${esc(st.clientName)} — checking in on open items">

                    <label class="tiny muted">Message</label>
                    <div style="margin-bottom:10px;">${OL.renderRichTextField({ id: 'cf-message', html: esc(intro).replace(/\n/g, '<br>'), minHeight: 140, emailTools: true, imageMaxWidth: 600 })}</div>

                    <div style="margin-bottom:14px;">
                        <div class="tiny muted" style="margin-bottom:4px;">Checked items below, built from the sidebar — check or uncheck items there to change this</div>
                        <pre id="cf-sections-preview" style="white-space:pre-wrap; margin:0; padding:12px; border:1px dashed var(--line); border-radius:6px; background:rgba(56,189,248,0.04); font-family:inherit; font-size:13px; line-height:1.55;"></pre>
                    </div>

                    <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap;">
                        ${alreadyClosed ? '<span></span>' : `
                        <label class="tiny" style="display:flex; align-items:center; gap:6px; cursor:pointer;" title="Closes this follow-up. It comes back on its own if the client still has items open when the next one is due.">
                            <input type="checkbox" id="cf-mark-done" checked> Mark followed up after sending (next in ${everyDays} days)
                        </label>`}
                        <div style="display:flex; justify-content:flex-end; gap:10px;">
                            ${alreadyClosed ? '' : `<button class="btn soft" onclick="OL.cfMarkFollowedUp()" title="Close this follow-up without sending an email (you called, for instance)">Mark followed up</button>`}
                            <button class="btn soft" onclick="OL.closeModal()">Cancel</button>
                            <button id="cf-send-btn" class="btn primary" onclick="OL.cfSend()">Send</button>
                        </div>
                    </div>
                </div>

                <aside style="min-width:0; border:1px solid var(--line); border-radius:8px; padding:12px; background:rgba(56,189,248,0.03); position:sticky; top:0; max-height:calc(100vh - 150px); overflow-y:auto;">
                    <div class="bold tiny uppercase muted" style="margin-bottom:4px;">Open items</div>
                    <div class="tiny muted" style="margin-bottom:10px;">Checked items are included in the email. Unchecking one here doesn't change it — it's just left out of this email.</div>

                    <div style="border-bottom:1px solid var(--line); padding-bottom:10px; margin-bottom:10px;">
                        <div class="tiny muted" style="margin-bottom:4px;">Ask the client for something new</div>
                        <input id="cf-new-title" type="text" class="modal-input tiny" style="width:100%; box-sizing:border-box;" placeholder="What do you need?">
                        <div style="margin-top:6px;">
                            <select id="cf-new-kind" class="modal-input tiny" style="width:100%;">
                                <option value="document">Document</option>
                                <option value="review">Review</option>
                                <option value="feedback">Feedback</option>
                            </select>
                        </div>
                        <button type="button" class="btn tiny soft full-width" style="margin-top:6px;" onclick="OL.cfAddClientAsk()">+ Add</button>
                    </div>

                    <div id="cf-sidebar-sections"></div>
                </aside>
            </div>
        </div>
    `;
    openModal(html);
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

    st.data.clientAsks.unshift({ id: task.id, title: task.title, description: '' });
    st.checked.clientAsks.add(task.id);

    const titleInput = document.getElementById('cf-new-title'); if (titleInput) titleInput.value = '';
    renderSidebar();
};

OL.cfSend = async function() {
    const st = OL._cfState;
    if (!st) return;
    const to = (document.getElementById('cf-to')?.value || '').trim();
    const subject = (document.getElementById('cf-subject')?.value || '').trim();
    const messageHtml = OL.sanitizeCommentHtml(document.getElementById('cf-message')?.innerHTML || '', { images: true });
    const messageText = OL.htmlToPlainTextWithLinks ? OL.htmlToPlainTextWithLinks(messageHtml) : messageHtml.replace(/<[^>]+>/g, '');
    const sections = sectionsText(st.data, st.checked, st.clientName);
    const body = [messageText, sections].map((s) => String(s || '').trim()).filter(Boolean).join('\n\n');
    const bodyHtml = [messageHtml, sections ? esc(sections).replace(/\n/g, '<br>') : ''].filter((s) => String(s).trim()).join('<br><br>');

    if (!to || !subject || !messageText.trim()) { alert('To, subject and message are all required.'); return; }

    const btn = document.getElementById('cf-send-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Sending...'; }

    const { ok } = await OL.sendGmailMessage({ to, subject, body, bodyHtml, linked_client_id: st.clientId, linked_task_id: st.taskId });
    if (!ok) { if (btn) { btn.disabled = false; btn.textContent = 'Send'; } return; }

    // A record on the follow-up task itself — not a status change, just history. The consolidated follow-up
    // still opens and closes on its own rules (core/client-work-rules.js) based on what's actually open.
    await updateAndSync(() => {
        const t = st.client.projectData.clientTasks.find((x) => x.id === st.taskId);
        if (t) {
            (t.comments = t.comments || []).push({ id: uid(), author: 'System', text: `Follow-up email sent to ${to}.`, html: '', mentions: [], date: new Date().toISOString() });
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
