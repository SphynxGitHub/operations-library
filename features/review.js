//======================= FEATURES / REVIEW =======================//
// The screens for Project Conclusion and Review (the logic is in core/conclusion.js):
//   - a status line and buttons on each round in the scoping sheet
//   - the Notify client window: review dates, the email, the private checklist link and the PDF
//   - Close review
//
// When every request in a round has passed testing, the app records the conclusion date, sets the review
// dates, and gives the Communication role a "Notify client" task (see core/data.js, before a save).

import { state, esc, uid, db, getActiveClient, updateAndSync, loadFullClient } from '../core/data.js';
import { DEFAULT_TEST_TEMPLATES } from '../core/testing.js';
import {
    updateRoundStates, roundStatus, setReviewDates, startReview, closeReview, openWorkInRound,
    buildClientChecklist, reviewDefaults, reviewEndFor, roundKey,
} from '../core/conclusion.js';
import { isRoundApproved } from '../core/requests.js';
import { buildChecklistPdf } from '../core/checklist-pdf.js';
import { applyClientFeedback, feedbackNeedsUpdate } from '../core/review-feedback.js';

const PDF_LIB_URL = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/+esm';

const templatesInUse = () => (Array.isArray(state.master?.testTemplates) && state.master.testTemplates.length
    ? state.master.testTemplates : DEFAULT_TEST_TEMPLATES);
const closedNames = () => {
    const names = (typeof OL.getSystemStatuses === 'function' ? OL.getSystemStatuses() : []).filter((s) => s.isClosed).map((s) => s.name);
    return names.length ? names : ['Done'];
};

// today's date where the person is (not UTC), as YYYY-MM-DD
export function todayIso(now = new Date()) {
    const p = (n) => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

function contextFor() {
    return {
        templates: templatesInUse(), roles: state.master?.roles || [], closedNames: closedNames(),
        resourceFor: (item) => (item && item.resourceId && typeof OL.getResourceById === 'function' ? OL.getResourceById(item.resourceId) : null),
        uid, now: new Date().toISOString(), today: todayIso(), defaults: reviewDefaults(state.master),
    };
}

// Called by the app just before a project is saved (after the testing pass), so the notification task is saved with it.
export function updateRoundStatesFor(client) {
    return updateRoundStates(client, contextFor());
}

async function clientFor(clientId) {
    if (clientId && state.clients?.[clientId]) return (await loadFullClient(clientId).catch(() => null)) || state.clients[clientId];
    return getActiveClient();
}
function refreshScopingIfOpen() {
    if (typeof document !== 'undefined' && document.getElementById('scoping-search-input') && typeof window.renderScopingSheet === 'function') window.renderScopingSheet();
}

// ---------------- the status line on a round ----------------
export function roundStatusHtml(client, sheet, round, isCurrent = true) {
    if (!client || !sheet || !isRoundApproved(sheet, round)) return '';
    // A round that is not current shows a status only if it has been through review (for example "Review closed").
    if (!isCurrent && !client.projectData?.roundStates?.[roundKey(sheet.id, round)]) return '';
    const s = roundStatus(client, sheet, round, contextFor());
    if (s.kind === 'empty' || !s.text) return '';
    const isStaff = state.adminMode === true || state.teamMemberMode === true;
    const key = roundKey(sheet.id, round);
    const pill = (text, color) => `<span class="pill tiny" style="margin-left:8px; border:1px solid ${color}; color:${color};">${esc(text)}</span>`;
    const btn = (label, onclick) => `<button class="btn tiny soft" style="margin-left:6px;" onclick="${onclick}">${label}</button>`;
    if (s.kind === 'building' || s.kind === 'testing') return `<span class="tiny muted" style="margin-left:8px;">${esc(s.text)}</span>`;
    if (s.kind === 'ready_to_notify') return pill('✅ Passed testing', '#22c55e') + (isStaff ? btn('Notify client…', `OL.openReviewNotification('${esc(key)}', '${esc(client.id)}')`) : '');
    if (s.kind === 'in_review') {
        const cr = s.state && s.state.clientReview;
        const seen = cr && cr.total ? `<span class="tiny muted" style="margin-left:8px;">Client reviewed ${cr.reviewed}/${cr.total}${cr.failed ? `, ${cr.failed} issue${cr.failed === 1 ? '' : 's'}` : ''}</span>` : '';
        return pill(`📋 ${s.text}`, '#38bdf8') + seen + (isStaff ? btn('Close review', `OL.closeReviewFor('${esc(key)}', '${esc(client.id)}')`) : '');
    }
    if (s.kind === 'review_ended') return pill(`⏰ ${s.text}`, '#f59e0b') + (isStaff ? btn('Close review', `OL.closeReviewFor('${esc(key)}', '${esc(client.id)}')`) : '');
    if (s.kind === 'closed') return `<span class="tiny muted" style="margin-left:8px;">${esc(s.text)}</span>`;
    return '';
}

// ---------------- the review email ----------------
export function draftReviewEmail({ names, round, start, end, days, followUpEveryDays, link, senderName }) {
    const who = names && names.length ? (names.length === 1 ? names[0] : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1]) : 'there';
    return [
        `Hi ${who},`,
        `Round ${round} of your project is complete, and our team has tested every part of it. Your review period now begins, so you can try it out the way you would use it day to day.`,
        `Review period: ${start} to ${end} (${days} days)`,
        `HOW TO REVIEW\n1. Open your checklist: ${link}\n2. Go through each item and tick it off. The checklist is also attached as a PDF if you would rather print it.\n3. If something does not work or does not look right, reply to this email and tell us what you saw. We will fix it.\n4. If you would like something changed or added, tell us and we will scope it as a new request.`,
        `We will check in with you about every ${followUpEveryDays} days during the review. Once it ends, we will move on to the next round.`,
        `Best,\n${senderName || 'The Sphynx team'}`,
    ].join('\n\n');
}

const newToken = () => {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    let bin = '';
    bytes.forEach((b) => { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');   // 43 characters
};
const pageBase = () => window.location.href.split('#')[0].split('?')[0].replace(/[^/]*$/, '');
const checklistLink = (token) => `${pageBase()}checklist.html?t=${token}`;

async function loadPdfLib() {
    if (OL._pdfLibForTests) return OL._pdfLibForTests;
    const mod = await import(PDF_LIB_URL);
    return mod.jsPDF || (mod.default && mod.default.jsPDF) || mod.default;
}

function primaryContacts(client) {
    const members = (client?.projectData?.teamMembers || []).filter((m) => m && m.email);
    const primary = members.filter((m) => m.isPrimaryContact);
    return primary.length ? primary : members.slice(0, 1);
}
const firstName = (m) => String(m.name || '').trim().split(/\s+/)[0] || '';

export async function openReviewNotification(key, clientId) {
    const client = await clientFor(clientId);
    const st = client?.projectData?.roundStates?.[key];
    if (!st || st.status !== 'ready_to_notify') { alert('This round is not ready to notify, or the review has already started.'); return; }
    const sheet = (client.projectData.scopingSheets || []).find((s) => String(s.id ?? '') === st.sheetId);
    const checklist = buildClientChecklist(client, sheet, st.round, contextFor());
    const contacts = primaryContacts(client);
    const token = OL._reviewDraft && OL._reviewDraft.key === key ? OL._reviewDraft.token : newToken();
    OL._reviewDraft = { key, token, clientId: client.id };
    const sender = typeof OL.getCurrentUserName === 'function' ? OL.getCurrentUserName() : '';
    const message = draftReviewEmail({ names: contacts.map(firstName).filter(Boolean), round: st.round, start: st.reviewStart, end: st.reviewEnd,
        days: st.reviewDays, followUpEveryDays: st.followUpEveryDays, link: checklistLink(token), senderName: sender });
    const steps = checklist.sections.reduce((n, s) => n + s.steps.length, 0);
    openModal(`
        <style>
            .rv label { display:block !important; margin:0 0 4px !important; font-size:12px !important; }
            .rv input, .rv textarea { display:block !important; width:100% !important; box-sizing:border-box !important; font-size:13px !important; font-family:inherit !important; margin:0 !important; }
        </style>
        <div class="modal-head">
            <div class="modal-title-text">📨 Notify client: Round ${esc(st.round)} review</div>
            <div class="spacer"></div>
            <button class="btn small soft" onclick="OL.closeModal()">Close</button>
        </div>
        <div class="modal-body rv" style="max-width:820px; box-sizing:border-box;">
            <div class="tiny muted" style="margin-bottom:12px;">
                Every request in this round has passed testing (concluded ${esc(st.concludedAt)}). Check the dates, edit the email, and send.
                Sending starts the review and creates the check-in tasks. The client's checklist has ${steps} step${steps === 1 ? '' : 's'} in ${checklist.sections.length} section${checklist.sections.length === 1 ? '' : 's'}, with no results.
            </div>
            <div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap:10px; margin-bottom:6px;">
                <div><label class="tiny muted">Review starts</label><input id="rv-start" type="date" class="modal-input" value="${esc(st.reviewStart)}" oninput="OL.rvRecalc()"></div>
                <div><label class="tiny muted">Length (days)</label><input id="rv-days" type="number" min="1" class="modal-input" value="${esc(st.reviewDays)}" oninput="OL.rvRecalc()"></div>
                <div><label class="tiny muted">Check in every (days)</label><input id="rv-every" type="number" min="1" class="modal-input" value="${esc(st.followUpEveryDays)}" oninput="OL.rvRecalc()"></div>
            </div>
            <div id="rv-end" class="tiny muted" style="margin-bottom:12px;">Review ends ${esc(st.reviewEnd)}</div>
            <label class="tiny muted">To</label>
            <input id="rv-to" type="text" class="modal-input" style="margin-bottom:8px;" value="${esc(contacts.map((m) => m.email).join(', '))}" placeholder="Client contact email(s), comma-separated">
            <label class="tiny muted">Cc</label>
            <input id="rv-cc" type="text" class="modal-input" style="margin-bottom:8px;" placeholder="optional">
            <label class="tiny muted">Subject</label>
            <input id="rv-subject" type="text" class="modal-input" style="margin-bottom:8px;" value="${esc(`Round ${st.round} is ready for your review: ${client.meta?.name || ''}`)}">
            <label class="tiny muted">Message</label>
            <textarea id="rv-body" class="modal-input" rows="16" style="margin-bottom:6px;">${esc(message)}</textarea>
            <div class="tiny muted" style="margin-bottom:12px;">If you change the dates above, use "Refresh dates in the message" to update the text. The PDF is attached automatically.</div>
            <div style="display:flex; gap:10px; justify-content:flex-end;">
                <button class="btn soft" onclick="OL.rvRefreshMessage()">Refresh dates in the message</button>
                <button class="btn soft" onclick="OL.closeModal()">Cancel</button>
                <button id="rv-send" class="btn primary" onclick="OL.sendReviewNotification()">Send</button>
            </div>
        </div>`);
}

const val = (id) => document.getElementById(id)?.value ?? '';

export function rvRecalc() {
    const start = val('rv-start'), days = Number(val('rv-days'));
    const out = document.getElementById('rv-end');
    if (out) out.textContent = /^\d{4}-\d{2}-\d{2}$/.test(start) && days >= 1 ? `Review ends ${reviewEndFor(start, days)}` : 'Enter a start date and a length';
}

export function rvRefreshMessage() {
    const draft = OL._reviewDraft; if (!draft) return;
    const client = state.clients?.[draft.clientId]; const st = client?.projectData?.roundStates?.[draft.key]; if (!st) return;
    const start = val('rv-start'), days = Number(val('rv-days')), every = Number(val('rv-every'));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !(days >= 1) || !(every >= 1)) { alert('Enter a start date, a length and a check-in spacing first.'); return; }
    const names = primaryContacts(client).map(firstName).filter(Boolean);
    const sender = typeof OL.getCurrentUserName === 'function' ? OL.getCurrentUserName() : '';
    document.getElementById('rv-body').value = draftReviewEmail({ names, round: st.round, start, end: reviewEndFor(start, days), days, followUpEveryDays: every, link: checklistLink(draft.token), senderName: sender });
}

export async function sendReviewNotification() {
    const draft = OL._reviewDraft; if (!draft) return;
    const client = await clientFor(draft.clientId);
    const st = client?.projectData?.roundStates?.[draft.key];
    if (!st || st.status !== 'ready_to_notify') { alert('This review was already started.'); return; }
    const to = val('rv-to').trim(), cc = val('rv-cc').trim(), subject = val('rv-subject').trim(), body = val('rv-body');
    const start = val('rv-start'), days = Number(val('rv-days')), every = Number(val('rv-every'));
    if (!to || !subject || !body.trim()) { alert('To, subject and message are all required.'); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !(days >= 1) || !(every >= 1)) { alert('Enter a valid start date, review length and check-in spacing.'); return; }
    if (!body.includes(checklistLink(draft.token))) { if (!confirm('The message no longer contains the checklist link. Send it anyway?')) return; }

    const btn = document.getElementById('rv-send');
    const setBusy = (busy) => { if (btn) { btn.disabled = busy; btn.textContent = busy ? 'Sending...' : 'Send'; } };
    setBusy(true);
    const sheet = (client.projectData.scopingSheets || []).find((s) => String(s.id ?? '') === st.sheetId);
    const ctx = contextFor();
    const checklist = buildClientChecklist(client, sheet, st.round, ctx);
    const sender = typeof OL.getCurrentUserName === 'function' ? OL.getCurrentUserName() : '';
    const senderEmail = ((state.master?.sphynxTeam || []).find((m) => m.name === sender) || {}).email || state.master?.communications?.gmail?.email || '';
    const end = reviewEndFor(start, days);

    let pdfBase64;
    try {
        const JsPdf = await loadPdfLib();
        pdfBase64 = buildChecklistPdf(JsPdf, checklist, { reviewStart: start, reviewEnd: end, link: checklistLink(draft.token), preparedBy: 'Sphynx Automation' });
    } catch (err) {
        console.error('PDF failed:', err);
        setBusy(false); alert('Could not make the PDF, so nothing was sent. Check your connection and try again.'); return;
    }

    // publish the private page first, so the link works the moment the email arrives
    const { error: insertErr } = await db.from('client_checklists').insert({
        token: draft.token, client_id: client.id, client_name: client.meta?.name || '', round: st.round,
        review_start: start, review_end: end, contact_email: senderEmail || null, sections: checklist.sections,
    });
    if (insertErr) { console.error(insertErr); setBusy(false); alert(`Could not publish the checklist page (${insertErr.message}). Run 014_client_checklists.sql in Supabase, then try again. Nothing was sent.`); return; }

    const filename = `Testing checklist - Round ${st.round}.pdf`;
    const { ok } = await OL.sendGmailMessage({
        to, cc: cc || undefined, subject, body,
        attachments: [{ filename, mimeType: 'application/pdf', contentBase64: pdfBase64 }],
        linked_client_id: client.id, linked_task_id: st.notifyTaskId,
    });
    if (!ok) {
        await db.from('client_checklists').update({ revoked: true }).eq('token', draft.token);   // best effort: the link was never sent
        setBusy(false); return;
    }

    await updateAndSync(() => {
        setReviewDates(st, { start, days, followUpEveryDays: every });
        startReview(client, draft.key, { ...ctx, now: new Date().toISOString() }, { sentTo: to, checklistToken: draft.token });
    }, client.id);
    OL._reviewDraft = null;
    OL.closeModal();
    refreshScopingIfOpen();
}

// ---------------- closing a review ----------------
export async function closeReviewFor(key, clientId) {
    const client = await clientFor(clientId);
    const st = client?.projectData?.roundStates?.[key];
    if (!st || st.status !== 'in_review') return;
    const sheet = (client.projectData.scopingSheets || []).find((s) => String(s.id ?? '') === st.sheetId);
    const ctx = contextFor();
    const open = openWorkInRound(client, sheet, st.round, ctx).filter((t) => !t.reviewFollowUpKey);
    const warn = open.length ? `\n\n${open.length} task${open.length === 1 ? ' is' : 's are'} still open on this round's requests (for example "${open[0].title}"). Closing marks the requests Done anyway.` : '';
    if (!confirm(`Close the Round ${st.round} review? Its requests will be marked Done and the next round can start.${warn}`)) return;
    await updateAndSync(() => { closeReview(client, key, { ...ctx, now: new Date().toISOString() }); }, client.id);
    refreshScopingIfOpen();
}

// ---------------- the client's answers ----------------
// The client marks each step Pass or Fail on their private page. Every few minutes (and when the app opens) this
// reads the answers for reviews in progress, opens a task on the original request for each new Fail, and marks
// those answers as handled. Only staff sessions do this.
let pulling = false;
export async function pullClientReviewFeedback() {
    const result = { created: 0, updated: 0, projects: 0 };
    if (pulling || !(state.adminMode === true || state.teamMemberMode === true)) return result;
    const reviewing = Object.values(state.clients || {}).filter((c) => Object.values(c?.projectData?.roundStates || {}).some((st) => st && st.status === 'in_review' && st.checklistToken));
    if (!reviewing.length) return result;
    pulling = true;
    try {
        const tokens = reviewing.flatMap((c) => Object.values(c.projectData.roundStates).filter((st) => st.status === 'in_review' && st.checklistToken).map((st) => st.checklistToken));
        const { data: rows, error } = await db.from('client_checklist_results').select('*').in('token', tokens);
        if (error) { console.warn('Client review answers could not be read:', error.message); return result; }
        for (const client of reviewing) {
            if (!feedbackNeedsUpdate(client, rows || [])) continue;
            let applied = null;
            await updateAndSync(() => { applied = applyClientFeedback(client, rows || [], { ...contextFor(), now: new Date().toISOString() }); }, client.id);
            result.projects++; result.created += applied.created.length; result.updated += applied.updated.length;
            for (const h of applied.handled) {
                await db.from('client_checklist_results').update({ ingested_at: new Date().toISOString(), task_id: h.task_id }).eq('token', h.token).eq('step_id', h.step_id);
            }
        }
        if (result.projects) refreshScopingIfOpen();
    } catch (err) {
        console.warn('Client review check failed:', err);
    } finally {
        pulling = false;
    }
    return result;
}

window.OL = window.OL || {};
Object.assign(window.OL, { pullClientReviewFeedback, updateRoundStatesFor, roundStatusHtml, openReviewNotification, rvRecalc, rvRefreshMessage, sendReviewNotification, closeReviewFor });

// First check shortly after the app loads, then every few minutes while it is open.
if (typeof window !== 'undefined' && typeof setTimeout === 'function' && !window.__OL_NO_TIMERS__) {
    setTimeout(() => pullClientReviewFeedback(), 25 * 1000);
    setInterval(() => pullClientReviewFeedback(), 5 * 60 * 1000);
}
