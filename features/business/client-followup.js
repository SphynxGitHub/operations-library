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
import { greetingNames, joinNames, tidyEmailHtml } from '../../core/meeting-summary.js';
import { getOlSettings, fillTemplate } from '../../core/ol-settings.js';

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

// Wording comes from Automations > Templates & settings (clientFollowUp); {client} and {sender} fill in.
function followUpTemplate() { return getOlSettings().templates.clientFollowUp; }
function senderNameNow() { return typeof OL.getCurrentUserName === 'function' ? OL.getCurrentUserName() : ''; }
function warmIntro(clientName, contactName) {
    return `Hi ${contactName || 'there'},\n\n${fillTemplate(followUpTemplate().intro, { client: clientName, sender: senderNameNow() })}`;
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


// ---- recipients: chips that show names from the team cards (same behaviour as the meeting summary email) ----
const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
const RCPT_FIELDS = { to: 'To', cc: 'Cc' };
const sameEmail = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
const emailsOf = (m) => [m.email, m.emailAddress, ...(Array.isArray(m.emails) ? m.emails : [])].filter(Boolean);
const nameForEmail = (email) => (OL._cfState.directory.find((p) => sameEmail(p.email, email)) || {}).name || '';

// Addresses that count as "you": the connected Gmail account and the signed-in person's own address.
function senderEmails() {
    const emails = [state.master?.communications?.gmail?.email];
    const me = typeof OL.getCurrentUserName === 'function' ? OL.getCurrentUserName() : '';
    if (me) (state.master?.sphynxTeam || []).forEach((m) => { if (m.name === me && m.email) emails.push(m.email); });
    return emails.filter(Boolean);
}

function personDirectory(client) {
    const list = [];
    const seen = new Set();
    const add = (name, emails, group) => emails.forEach((raw) => {
        const email = String(raw || '').trim();
        const key = email.toLowerCase();
        if (!EMAIL_RE.test(email) || seen.has(key)) return;
        seen.add(key);
        list.push({ name: name || '', email, group });
    });
    (client?.projectData?.teamMembers || []).forEach((m) => add(m.name, emailsOf(m), `${client.meta?.name || 'Client'} team`));
    (state.master?.sphynxTeam || []).forEach((m) => add(m.name, emailsOf(m), 'Sphynx team'));
    return list;
}

function renderCfRecipients(field) {
    const st = OL._cfState;
    const box = document.getElementById(`cf-${field}-box`);
    if (!box) return;
    const typed = document.getElementById(`cf-${field}-input`)?.value || '';
    const chips = st[field].map((email, i) => `
        <span title="${esc(email)}" style="display:inline-flex; align-items:center; gap:6px; padding:3px 6px 3px 10px; border-radius:999px; background:rgba(37,99,235,0.10); border:1px solid rgba(37,99,235,0.25); font-size:13px; line-height:1.3;">
            ${esc(nameForEmail(email) || email)}
            <button type="button" title="Remove" onclick="OL.cfRemoveRecipient('${field}', ${i})"
                    style="border:none; background:transparent; cursor:pointer; padding:0 2px; font-size:13px; color:inherit; line-height:1;">✕</button>
        </span>`).join('');
    box.innerHTML = `
        <div style="position:relative; display:flex; flex-wrap:wrap; align-items:center; gap:6px; padding:6px 8px; border:1px solid var(--line); border-radius:12px; background:rgba(255,255,255,0.02);">
            ${chips}
            <input type="text" id="cf-${field}-input" autocomplete="off" placeholder="${st[field].length ? 'Add another…' : 'Type a name or email…'}"
                   style="display:inline-block !important; width:auto !important; flex:1 1 160px; min-width:140px; border:none !important; background:transparent !important; box-shadow:none !important; outline:none; padding:5px 2px !important; margin:0 !important;"
                   oninput="OL.cfShowSuggestions('${field}')" onfocus="OL.cfShowSuggestions('${field}')"
                   onkeydown="OL.cfRecipientKey('${field}', event)" onblur="OL.cfRecipientBlur('${field}')">
            <button type="button" class="btn tiny soft" style="flex:0 0 auto;" onmousedown="event.preventDefault(); OL.cfShowSuggestions('${field}', true)">+ Team</button>
            <div id="cf-${field}-suggest" style="display:none; position:absolute; left:0; right:0; top:calc(100% + 4px); z-index:30; max-height:240px; overflow-y:auto; background:var(--bg-card, #ffffff); color:var(--text, inherit); border:1px solid var(--line); border-radius:10px; box-shadow:0 10px 24px rgba(0,0,0,0.18);"></div>
        </div>`;
    const input = document.getElementById(`cf-${field}-input`);
    if (input && typed) input.value = typed;
}

OL.cfShowSuggestions = function(field, showAll) {
    const st = OL._cfState;
    const panel = document.getElementById(`cf-${field}-suggest`);
    if (!st || !panel) return;
    const typed = (document.getElementById(`cf-${field}-input`)?.value || '').trim();
    const q = showAll ? '' : typed.toLowerCase();
    const matches = st.directory
        .filter((p) => !st[field].some((e) => sameEmail(e, p.email)))
        .filter((p) => !q || `${p.name} ${p.email}`.toLowerCase().includes(q))
        .slice(0, 40);
    st.suggest[field] = matches;
    let html = '', lastGroup = '';
    matches.forEach((p, i) => {
        if (p.group !== lastGroup) {
            html += `<div style="padding:6px 12px 2px; font-size:11px; text-transform:uppercase; letter-spacing:.04em; opacity:.6;">${esc(p.group)}</div>`;
            lastGroup = p.group;
        }
        html += `<div onmousedown="event.preventDefault(); OL.cfPickRecipient('${field}', ${i})"
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

const hideCfSuggestions = (field) => { const p = document.getElementById(`cf-${field}-suggest`); if (p) p.style.display = 'none'; };

function addCfRecipient(field, email) {
    const st = OL._cfState;
    const clean = String(email || '').trim();
    if (!EMAIL_RE.test(clean)) return false;
    if (st[field].some((e) => sameEmail(e, clean))) return true;
    st[field].push(clean);
    return true;
}

OL.cfRemoveRecipient = function(field, index) {
    const st = OL._cfState;
    if (!st || !RCPT_FIELDS[field]) return;
    st[field].splice(index, 1);
    renderCfRecipients(field);
};

OL.cfPickRecipient = function(field, index) {
    const st = OL._cfState;
    const person = st?.suggest?.[field]?.[index];
    if (!person) return;
    addCfRecipient(field, person.email);
    const input = document.getElementById(`cf-${field}-input`);
    if (input) input.value = '';
    renderCfRecipients(field);
    document.getElementById(`cf-${field}-input`)?.focus?.();
    OL.cfShowSuggestions(field);
};

OL.cfCommitRecipient = function(field) {
    const st = OL._cfState;
    const input = document.getElementById(`cf-${field}-input`);
    if (!st || !input) return { added: 0, invalid: 0 };
    const tokens = String(input.value || '').split(/[,;\s]+/).filter(Boolean);
    let added = 0, invalid = 0;
    const left = [];
    tokens.forEach((t) => { if (addCfRecipient(field, t)) added++; else { invalid++; left.push(t); } });
    input.value = left.join(' ');
    if (added) renderCfRecipients(field);
    return { added, invalid };
};

OL.cfRecipientKey = function(field, ev) {
    const st = OL._cfState;
    if (!st) return;
    const input = document.getElementById(`cf-${field}-input`);
    if (ev.key === 'Enter' || ev.key === ',' || ev.key === ';') {
        ev.preventDefault();
        if (!String(input?.value || '').trim()) return;
        const { added, invalid } = OL.cfCommitRecipient(field);
        if (!added && invalid) {
            const only = st.suggest?.[field];
            if (only && only.length === 1) { OL.cfPickRecipient(field, 0); return; }
            alert('Enter a valid email address, or pick someone from the list.');
        }
    } else if (ev.key === 'Backspace' && !String(input?.value || '') && st[field].length) {
        st[field].pop();
        renderCfRecipients(field);
        document.getElementById(`cf-${field}-input`)?.focus?.();
    } else if (ev.key === 'Escape') {
        hideCfSuggestions(field);
    }
};

OL.cfRecipientBlur = function(field) {
    setTimeout(() => { OL.cfCommitRecipient(field); hideCfSuggestions(field); }, 150);
};

// The greeting is typed text, so it doesn't change by itself when recipients change.
OL.cfRefreshGreeting = function() {
    const st = OL._cfState;
    const box = document.getElementById('cf-message');
    if (!st || !box) return;
    const names = greetingNames(st.to, {
        sphynxEmails: (state.master?.sphynxTeam || []).map((m) => m.email).filter(Boolean),
        people: st.directory.filter((p) => p.name),
    });
    const greeting = esc(`Hi ${joinNames(names) || 'there'},`);
    const html = box.innerHTML;
    const m = html.match(/^((?:\s|<(?:div|p|span|b|strong|i|em|u)[^>]*>)*)\s*hi\b[^<]*/i);
    box.innerHTML = m ? m[1] + greeting + html.slice(m[0].length) : `${greeting}<br><br>${html}`;
};

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

    const mine = new Set(senderEmails().map((e) => e.toLowerCase()));
    OL._cfState = {
        clientId, taskId, client, task, data, checked,
        clientName: client.meta?.name || 'the project',
        directory: personDirectory(client), suggest: {},
        to: contact?.email && !mine.has(contact.email.toLowerCase()) ? [contact.email] : [], cc: [],
    };

    const st = OL._cfState;
    const intro = warmIntro(st.clientName, firstName(contact?.name));
    const myName = typeof OL.getCurrentUserName === 'function' ? OL.getCurrentUserName() : '';
    const closing = fillTemplate(followUpTemplate().closing, { client: st.clientName, sender: myName }).replace(/,\n$/, ',');   // no name -> no dangling blank line
    const alreadyClosed = typeof OL.isClosedStatus === 'function' && OL.isClosedStatus(task.status);
    const followedUp = alreadyClosed && !!task.nextFollowUpDue;
    const everyDays = Number(state.master?.followUpEveryDays) || 3;

    const html = `
        <style>
            /* Same explicit form styling as the meeting summary window */
            .cf-layout label { display: block !important; margin: 0 0 4px !important; font-size: 12px !important; }
            .cf-layout input[type="text"], .cf-layout select, .cf-layout textarea {
                display: block !important; width: 100% !important; box-sizing: border-box !important; margin: 0 !important;
                font-size: 13px !important; line-height: 1.45 !important; font-family: inherit !important;
            }
            .cf-layout pre { font-size: 13px !important; line-height: 1.55 !important; }
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
                    <div style="margin-bottom:10px;">
                        <label class="tiny muted">To</label>
                        <div id="cf-to-box"></div>
                    </div>
                    <div style="margin-bottom:10px;">
                        <label class="tiny muted">Cc</label>
                        <div id="cf-cc-box"></div>
                    </div>

                    <label class="tiny muted">Subject</label>
                    <input id="cf-subject" type="text" class="modal-input" style="margin-bottom:12px;" value="${esc(fillTemplate(followUpTemplate().subject, { client: st.clientName, sender: myName }))}">

                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                        <label class="tiny muted" style="margin:0 !important;">Message</label>
                        <button type="button" class="btn tiny soft" onclick="OL.cfRefreshGreeting()" title="Rewrites the first line to name the people in To">Update greeting from recipients</button>
                    </div>
                    <div style="margin-bottom:10px;">${OL.renderRichTextField({ id: 'cf-message', html: esc(intro).replace(/\n/g, '<br>'), minHeight: 200, grow: true, emailTools: true, imageMaxWidth: 600 })}</div>

                    <div style="margin-bottom:14px;">
                        <div class="tiny muted" style="margin-bottom:4px;">Checked items below, built from the sidebar — check or uncheck items there to change this</div>
                        <pre id="cf-sections-preview" style="white-space:pre-wrap; margin:0; padding:12px; border:1px dashed var(--line); border-radius:6px; background:rgba(56,189,248,0.04); font-family:inherit; font-size:13px; line-height:1.55;"></pre>
                    </div>

                    <label class="tiny muted">Closing</label>
                    <div style="margin-bottom:14px;">${OL.renderRichTextField({ id: 'cf-closing', html: esc(closing).replace(/\n/g, '<br>'), minHeight: 70, grow: true, emailTools: true, imageMaxWidth: 600 })}</div>

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
    renderCfRecipients('to');
    renderCfRecipients('cc');
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
    OL.cfCommitRecipient('to');
    OL.cfCommitRecipient('cc');
    const to = st.to.join(', ');
    const cc = st.cc.join(', ');
    const subject = (document.getElementById('cf-subject')?.value || '').trim();
    const messageHtml = OL.sanitizeCommentHtml(document.getElementById('cf-message')?.innerHTML || '', { images: true });
    const messageText = OL.htmlToPlainTextWithLinks ? OL.htmlToPlainTextWithLinks(messageHtml) : messageHtml.replace(/<[^>]+>/g, '');
    const closingHtml = OL.sanitizeCommentHtml(document.getElementById('cf-closing')?.innerHTML || '', { images: true });
    const closingText = OL.htmlToPlainTextWithLinks ? OL.htmlToPlainTextWithLinks(closingHtml) : closingHtml.replace(/<[^>]+>/g, '');
    const sections = sectionsText(st.data, st.checked, st.clientName);
    const body = [messageText, sections, closingText].map((s) => String(s || '').trim()).filter(Boolean).join('\n\n');
    const bodyHtml = tidyEmailHtml([messageHtml, sections ? esc(sections).replace(/\n/g, '<br>') : '', closingHtml].filter((s) => String(s).trim()).join('<br><br>'));

    if (!to || !subject || !messageText.trim()) { alert('To, subject and message are all required.'); return; }

    const btn = document.getElementById('cf-send-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Sending...'; }

    const { ok } = await OL.sendGmailMessage({ to, cc: cc || undefined, subject, body, bodyHtml, linked_client_id: st.clientId, linked_task_id: st.taskId });
    if (!ok) { if (btn) { btn.disabled = false; btn.textContent = 'Send'; } return; }

    // A record on the follow-up task itself — not a status change, just history. The consolidated follow-up
    // still opens and closes on its own rules (core/client-work-rules.js) based on what's actually open.
    await updateAndSync(() => {
        const t = st.client.projectData.clientTasks.find((x) => x.id === st.taskId);
        if (t) {
            (t.comments = t.comments || []).push({ id: uid(), author: 'System', text: `Follow-up email sent to ${to}${cc ? ` (cc ${cc})` : ''}.`, html: '', mentions: [], date: new Date().toISOString() });
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

Object.assign(window.OL, { openClientFollowUpEmail: OL.openClientFollowUpEmail, cfToggle: OL.cfToggle, cfAddClientAsk: OL.cfAddClientAsk, cfSend: OL.cfSend, cfMarkFollowedUp: OL.cfMarkFollowedUp,
    cfShowSuggestions: OL.cfShowSuggestions, cfRemoveRecipient: OL.cfRemoveRecipient, cfPickRecipient: OL.cfPickRecipient,
    cfCommitRecipient: OL.cfCommitRecipient, cfRecipientKey: OL.cfRecipientKey, cfRecipientBlur: OL.cfRecipientBlur, cfRefreshGreeting: OL.cfRefreshGreeting });
