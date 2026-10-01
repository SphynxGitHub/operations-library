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
    updateRoundStates, roundStatus, setReviewDates, startReview, closeReview, openWorkInRound, extendReview, reviewStartAt,
    buildClientChecklist, reviewDefaults, reviewEndFor, roundKey, REVIEW_MODES, reviewModeFor, setReviewPeriod,
} from '../core/conclusion.js';
import { isRoundApproved } from '../core/requests.js';
import { buildChecklistPdf } from '../core/checklist-pdf.js';
import { applyClientFeedback, feedbackNeedsUpdate, applyClientApproval } from '../core/review-feedback.js';

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
        resourceForId: (id) => (id && typeof OL.getResourceById === 'function' ? OL.getResourceById(id) : null),
        uid, now: new Date().toISOString(), today: todayIso(), defaults: reviewDefaults(state.master), master: state.master,
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
    const html = roundStatusHtmlInner(client, sheet, round, isCurrent);
    if (!html || !(state.adminMode === true || state.teamMemberMode === true)) return html;
    const st = client?.projectData?.roundStates?.[roundKey(sheet.id, round)];
    if (st && st.status === 'closed') return html;
    const mode = reviewModeFor(client, state.master, st);
    return html + `<button class="btn tiny soft" style="margin-left:6px;" title="How this project wraps up a round: ${esc(REVIEW_MODES[mode].label)}" onclick="OL.openReviewSettings('${esc(client.id)}')"><i data-lucide="settings-2" style="width:11px;height:11px;vertical-align:sub;"></i> ${esc(REVIEW_MODES[mode].short)}</button>`;
}
function roundStatusHtmlInner(client, sheet, round, isCurrent = true) {
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
    if (s.kind === 'ready_to_notify') {
        const none = s.state && s.state.mode === 'none';
        return pill('✅ Passed testing', '#22c55e') + (isStaff
            ? (none ? btn('Close round', `OL.closeReviewFor('${esc(key)}', '${esc(client.id)}')`) : '')
              + btn(none ? 'Send client the checklist…' : 'Notify client…', `OL.openReviewNotification('${esc(key)}', '${esc(client.id)}')`)
              + (none ? '' : btn('Close without client review', `OL.closeReviewFor('${esc(key)}', '${esc(client.id)}')`))
            : '');
    }
    if (s.kind === 'in_review') {
        const cr = s.state && s.state.clientReview;
        const allPassed = !!(cr && cr.total && cr.reviewed >= cr.total && !cr.failed);
        const approved = s.state && s.state.clientApprovedAt;
        const seen = approved
            ? pill(`✅ Client approved ${String(s.state.clientApprovedAt).slice(0, 10)}`, '#22c55e')
            : cr && cr.total
            ? (allPassed
                ? pill('✅ Client passed every step', '#22c55e')
                : `<span class="tiny muted" style="margin-left:8px;">Client reviewed ${cr.reviewed}/${cr.total}${cr.failed ? `, ${cr.failed} issue${cr.failed === 1 ? '' : 's'}` : ''}</span>`)
            : '';
        return pill(`📋 ${s.text}`, '#38bdf8') + seen + (isStaff ? btn('Edit dates…', `OL.editReviewDatesFor('${esc(key)}', '${esc(client.id)}')`) + btn('Close review', `OL.closeReviewFor('${esc(key)}', '${esc(client.id)}')`) : '');
    }
    if (s.kind === 'review_ended') return pill(`⏰ ${s.text}`, '#f59e0b') + (isStaff ? btn('Extend 10 days', `OL.extendReviewFor('${esc(key)}', '${esc(client.id)}')`) + btn('Edit dates…', `OL.editReviewDatesFor('${esc(key)}', '${esc(client.id)}')`) + btn('Close review', `OL.closeReviewFor('${esc(key)}', '${esc(client.id)}')`) : '');
    if (s.kind === 'closed') return `<span class="tiny muted" style="margin-left:8px;">${esc(s.text)}</span>`;
    return '';
}

// ---------------- the review email ----------------
export function draftReviewEmail({ names, round, start, end, days, followUpEveryDays, link, senderName, signatureAttached, mode }) {
    const who = names && names.length ? (names.length === 1 ? names[0] : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1]) : 'there';
    if (mode === 'checklist') {
        return [
            `Hi ${who},`,
            `Round ${round} of your project is complete, and our team has tested every part of it. We have put together a checklist so you can try it out the way you would use it day to day.`,
            `HOW TO USE THE CHECKLIST\n1. Open your checklist: ${link}\n2. Go through each item and tick it off. The checklist is also attached as a PDF if you would rather print it.\n3. If something does not work or does not look right, reply to this email and tell us what you saw. We will fix it.\n4. If you would like something changed or added, tell us and we will scope it as a new request.`,
            signatureAttached ? 'Best,' : `Best,\n${senderName || 'The Sphynx team'}`,
        ].join('\n\n');
    }
    return [
        `Hi ${who},`,
        `Round ${round} of your project is complete, and our team has tested every part of it. Your review period now begins, so you can try it out the way you would use it day to day.`,
        `Review period: ${start} to ${end} (${days} days)`,
        `HOW TO REVIEW\n1. Open your checklist: ${link}\n2. Go through each item and tick it off. The checklist is also attached as a PDF if you would rather print it.\n3. If something does not work or does not look right, reply to this email and tell us what you saw. We will fix it.\n4. If you would like something changed or added, tell us and we will scope it as a new request.`,
        `We will check in with you about every ${followUpEveryDays} days during the review. Once it ends, we will move on to the next round.`,
        // the sender's signature (added when the email is sent) carries their name, so it isn't repeated here
        signatureAttached ? 'Best,' : `Best,\n${senderName || 'The Sphynx team'}`,
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
    // The window offers a dated review period or the checklist alone; a round set to "no client review" starts on the
    // checklist-only choice here (that is what sending the client anything from it means).
    const mode0 = st.mode === 'timeline' ? 'timeline' : (st.mode === 'checklist' || st.mode === 'none' ? 'checklist' : reviewModeFor(client, state.master, null) === 'timeline' ? 'timeline' : 'checklist');
    // The review starts from when this goes out: today if it's before noon on a Monday or Wednesday, else the
    // next Monday or Wednesday. The person can still change the date below.
    if (mode0 === 'timeline') {
        const d = reviewDefaults(state.master);
        setReviewDates(st, { mode: 'timeline', start: reviewStartAt(new Date()), days: Number(st.reviewDays) >= 1 ? st.reviewDays : d.days, followUpEveryDays: Number(st.followUpEveryDays) >= 1 ? st.followUpEveryDays : d.followUpEveryDays });
    }
    const checklist = buildClientChecklist(client, sheet, st.round, contextFor());
    const contacts = primaryContacts(client);
    const token = OL._reviewDraft && OL._reviewDraft.key === key ? OL._reviewDraft.token : newToken();
    OL._reviewDraft = { key, token, clientId: client.id };
    const sender = typeof OL.getCurrentUserName === 'function' ? OL.getCurrentUserName() : '';
    const signatureAttached = !!OL.signatureHtmlFor(OL.myTeamCard());
    const message = draftReviewEmail({ names: contacts.map(firstName).filter(Boolean), round: st.round, start: st.reviewStart, end: st.reviewEnd,
        days: st.reviewDays, followUpEveryDays: st.followUpEveryDays, link: checklistLink(token), senderName: sender, signatureAttached, mode: mode0 });
    const steps = checklist.sections.reduce((n, s) => n + s.steps.length, 0);
    OL.initRecipients('rv', { to: contacts.map((m) => m.email).filter(Boolean), directory: OL.personDirectory(client) });
    openModal(OL.composeShellHtml({
        prefix: 'rv',
        title: `📨 Notify client: Round ${st.round} review`,
        introHtml: `<div class="tiny muted" style="margin-bottom:12px;">
                Every request in this round has passed testing (concluded ${esc(st.concludedAt)}). Choose the review type, check the dates, edit the email, and send.
                Sending starts the review (and creates the check-in tasks, for a review period). The client's checklist has ${steps} step${steps === 1 ? '' : 's'} in ${checklist.sections.length} section${checklist.sections.length === 1 ? '' : 's'}, with no results.
            </div>`,
        topHtml: `
            <div style="margin-bottom:10px;">
                <label class="tiny muted">Review type</label>
                <select id="rv-mode" class="modal-input" onchange="OL.rvModeChanged()">
                    <option value="timeline" ${mode0 === 'timeline' ? 'selected' : ''}>${esc(REVIEW_MODES.timeline.label)}</option>
                    <option value="checklist" ${mode0 === 'checklist' ? 'selected' : ''}>${esc(REVIEW_MODES.checklist.label)}</option>
                </select>
            </div>
            <div id="rv-dates" style="display:${mode0 === 'timeline' ? 'block' : 'none'};">
            <div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap:10px; margin-bottom:6px;">
                <div><label class="tiny muted">Review starts</label><input id="rv-start" type="date" class="modal-input" value="${esc(st.reviewStart)}" oninput="OL.rvRecalc()"></div>
                <div><label class="tiny muted">Length (days)</label><input id="rv-days" type="number" min="1" class="modal-input" value="${esc(st.reviewDays)}" oninput="OL.rvRecalc()"></div>
                <div><label class="tiny muted">Check in every (days)</label><input id="rv-every" type="number" min="1" class="modal-input" value="${esc(st.followUpEveryDays)}" oninput="OL.rvRecalc()"></div>
            </div>
            <div id="rv-end" class="tiny muted" style="margin-bottom:12px;">Review ends ${esc(st.reviewEnd)}</div>
            </div>
            <label class="tiny" style="display:flex !important; align-items:center; gap:6px; cursor:pointer; margin:0 0 12px !important;"><input type="checkbox" id="rv-make-default" style="width:auto !important; display:inline-block !important;"> Use this review type for this project from now on</label>`,
        subject: `Round ${st.round} is ready for your review: ${client.meta?.name || ''}`,
        messageHtml: OL.plainTextToLinkedHtml(message), messageMinHeight: 300,
        middleHtml: '<div class="tiny muted" style="margin-bottom:12px;">If you change the dates above, use "Refresh dates in the message" to update the text. The PDF is attached automatically.</div>',
        footerButtonsHtml: '<button class="btn soft" onclick="OL.rvRefreshMessage()">Refresh dates in the message</button>',
        sendAction: 'OL.sendReviewNotification()', maxWidth: '820px',
    }));
    OL.renderAllRecipients('rv');
    if (window.lucide) lucide.createIcons();
}

const val = (id) => document.getElementById(id)?.value ?? '';

export function rvModeChanged() {
    const mode = val('rv-mode') || 'timeline';
    const box = document.getElementById('rv-dates');
    if (box) box.style.display = mode === 'timeline' ? 'block' : 'none';
    OL.rvRefreshMessage();
}

export function rvRecalc() {
    const start = val('rv-start'), days = Number(val('rv-days'));
    const out = document.getElementById('rv-end');
    if (out) out.textContent = /^\d{4}-\d{2}-\d{2}$/.test(start) && days >= 1 ? `Review ends ${reviewEndFor(start, days)}` : 'Enter a start date and a length';
}

export function rvRefreshMessage() {
    const draft = OL._reviewDraft; if (!draft) return;
    const client = state.clients?.[draft.clientId]; const st = client?.projectData?.roundStates?.[draft.key]; if (!st) return;
    const mode = val('rv-mode') || 'timeline';
    const start = val('rv-start'), days = Number(val('rv-days')), every = Number(val('rv-every'));
    if (mode === 'timeline' && (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !(days >= 1) || !(every >= 1))) { alert('Enter a start date, a length and a check-in spacing first.'); return; }
    const names = primaryContacts(client).map(firstName).filter(Boolean);
    const sender = typeof OL.getCurrentUserName === 'function' ? OL.getCurrentUserName() : '';
    const ed = document.getElementById('rv-message');
    if (ed) ed.innerHTML = OL.plainTextToLinkedHtml(draftReviewEmail({ names, round: st.round, start, end: mode === 'timeline' ? reviewEndFor(start, days) : '', days, followUpEveryDays: every, link: checklistLink(draft.token), senderName: sender, signatureAttached: !!OL.signatureHtmlFor(OL.myTeamCard()), mode }));
}

export async function sendReviewNotification() {
    const draft = OL._reviewDraft; if (!draft) return;
    const client = await clientFor(draft.clientId);
    const st = client?.projectData?.roundStates?.[draft.key];
    if (!st || st.status !== 'ready_to_notify') { alert('This review was already started.'); return; }
    const built = OL.collectCompose('rv');
    const { to, cc, subject } = built;
    const mode = val('rv-mode') || 'timeline';
    const dated = mode === 'timeline';
    const start = dated ? val('rv-start') : '', days = dated ? Number(val('rv-days')) : 0, every = dated ? Number(val('rv-every')) : 0;
    if (!to || !subject || !built.messageText.trim()) { alert('To, subject and message are all required.'); return; }
    if (dated && (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !(days >= 1) || !(every >= 1))) { alert('Enter a valid start date, review length and check-in spacing.'); return; }
    if (!built.messageText.includes(checklistLink(draft.token))) { if (!confirm('The message no longer contains the checklist link. Send it anyway?')) return; }

    const btn = document.getElementById('rv-send');
    const setBusy = (busy) => { if (btn) { btn.disabled = busy; btn.textContent = busy ? 'Sending...' : 'Send'; } };
    setBusy(true);
    const sheet = (client.projectData.scopingSheets || []).find((s) => String(s.id ?? '') === st.sheetId);
    const ctx = contextFor();
    const checklist = buildClientChecklist(client, sheet, st.round, ctx);
    const sender = typeof OL.getCurrentUserName === 'function' ? OL.getCurrentUserName() : '';
    const senderEmail = ((state.master?.sphynxTeam || []).find((m) => m.name === sender) || {}).email || state.master?.communications?.gmail?.email || '';
    const end = dated ? reviewEndFor(start, days) : '';

    let pdfBase64;
    try {
        const JsPdf = await loadPdfLib();
        pdfBase64 = buildChecklistPdf(JsPdf, checklist, { reviewStart: dated ? start : '', reviewEnd: dated ? end : '', link: checklistLink(draft.token), preparedBy: 'Sphynx Automation' });
    } catch (err) {
        console.error('PDF failed:', err);
        setBusy(false); alert('Could not make the PDF, so nothing was sent. Check your connection and try again.'); return;
    }

    // publish the private page first, so the link works the moment the email arrives
    const { error: insertErr } = await db.from('client_checklists').insert({
        token: draft.token, client_id: client.id, client_name: client.meta?.name || '', round: st.round,
        review_start: dated ? start : null, review_end: dated ? end : null, contact_email: senderEmail || null, sections: checklist.sections,
    });
    if (insertErr) {
        console.error(insertErr);
        setBusy(false);
        const needsMigration = !dated && /null value|not-null|violates/i.test(insertErr.message || '');
        alert(needsMigration
            ? `The checklist page can't be saved without review dates yet (${insertErr.message}). Run 2026_10_checklist_optional_review_dates.sql in Supabase, then try again. Nothing was sent.`
            : `Could not publish the checklist page (${insertErr.message}). Run 014_client_checklists.sql in Supabase, then try again. Nothing was sent.`);
        return;
    }

    const filename = `Testing checklist - Round ${st.round}.pdf`;
    const { ok } = await OL.sendCompose('rv', built, {
        attachments: [{ filename, mimeType: 'application/pdf', contentBase64: pdfBase64 }],
        linked_client_id: client.id, linked_task_id: st.notifyTaskId,
    });
    if (!ok) {
        await db.from('client_checklists').update({ revoked: true }).eq('token', draft.token);   // best effort: the link was never sent
        setBusy(false); return;
    }

    await updateAndSync(() => {
        setReviewDates(st, { mode, start, days, followUpEveryDays: every });
        startReview(client, draft.key, { ...ctx, now: new Date().toISOString() }, { sentTo: to, checklistToken: draft.token });
        if (document.getElementById('rv-make-default')?.checked) {
            if (!client.projectData.reviewSettings) client.projectData.reviewSettings = {};
            client.projectData.reviewSettings.mode = mode;
        }
    }, client.id);
    OL._reviewDraft = null;
    OL.closeModal();
    refreshScopingIfOpen();
}

// ---------------- closing a review ----------------
export async function closeReviewFor(key, clientId) {
    const client = await clientFor(clientId);
    const st = client?.projectData?.roundStates?.[key];
    if (!st || (st.status !== 'in_review' && st.status !== 'ready_to_notify')) return;
    const withoutReview = st.status === 'ready_to_notify';   // passed testing, nothing sent to the client
    const sheet = (client.projectData.scopingSheets || []).find((s) => String(s.id ?? '') === st.sheetId);
    const ctx = contextFor();
    const open = openWorkInRound(client, sheet, st.round, ctx).filter((t) => !t.reviewFollowUpKey && t.id !== st.notifyTaskId);
    const warn = open.length ? `\n\n${open.length} task${open.length === 1 ? ' is' : 's are'} still open on this round's requests (for example "${open[0].title}"). Closing marks the requests Done anyway.` : '';
    if (!confirm(`${withoutReview ? `Close Round ${st.round} without a client review? The client is not sent anything.` : `Close the Round ${st.round} review?`} Its requests will be marked Done and the next round can start.${warn}`)) return;
    await updateAndSync(() => {
        closeReview(client, key, { ...ctx, now: new Date().toISOString() });
        // Four quarterly check-ins follow a closed round (unless the client is on Ongoing Maintenance).
        if (typeof OL.createQuarterlyCheckInFor === 'function') OL.createQuarterlyCheckInFor(client);
    }, client.id);
    refreshScopingIfOpen();
}

// ---------------- extending a review ----------------
export async function extendReviewFor(key, clientId) {
    const client = await clientFor(clientId);
    const st = client?.projectData?.roundStates?.[key];
    if (!st || st.status !== 'in_review') return;
    const ans = prompt(`Extend the Round ${st.round} review by how many days? (currently ends ${st.reviewEnd})`, '10');
    if (ans === null) return;
    const days = parseInt(ans, 10);
    if (!(days >= 1)) { alert('Enter a number of days.'); return; }
    const note = prompt('Reason (optional, kept in the log):', '') || '';
    await updateAndSync(() => { extendReview(client, key, { ...contextFor(), now: new Date().toISOString() }, days, note); }, client.id);
    await syncChecklistDates(client.projectData.roundStates[key]);
    refreshScopingIfOpen();
}

// The client's checklist page keeps its own copy of the review dates (client_checklists). Best effort: a failure
// here never blocks the change, it just leaves the page showing the old dates.
async function syncChecklistDates(st) {
    if (!st || !st.checklistToken) return;
    try {
        const { error } = await db.from('client_checklists').update({ review_start: st.reviewStart || null, review_end: st.reviewEnd || null }).eq('token', st.checklistToken);
        if (error) console.warn('Could not update the dates on the client checklist page:', error.message);
    } catch (e) { console.warn('Could not update the dates on the client checklist page:', e); }
}

// ---------------- setting a running review's dates by hand ----------------
export async function editReviewDatesFor(key, clientId) {
    const client = await clientFor(clientId);
    const st = client?.projectData?.roundStates?.[key];
    if (!st || st.status !== 'in_review') return;
    OL._reviewEdit = { key, clientId: client.id };
    const undated = !st.reviewEnd;
    openModal(`<div class="modal-head"><div class="modal-title-text"><i data-lucide="calendar-range" style="width:16px;height:16px;vertical-align:sub;margin-right:6px;"></i>Round ${esc(st.round)} review dates</div><div class="spacer"></div><button class="btn small soft" onclick="OL.closeModal()">Cancel</button></div>
        <div class="modal-body" style="max-width:460px; width:100%;">
            <p class="tiny muted" style="margin-bottom:12px;">Set any dates. Upcoming check-in tasks are replaced to match; check-ins already done are kept. The client's checklist page is updated too.</p>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:10px;">
                <div><label class="tiny muted">Review starts</label><input id="re-start" type="date" class="modal-input" value="${esc(st.reviewStart || todayIso())}"></div>
                <div><label class="tiny muted">Review ends</label><input id="re-end" type="date" class="modal-input" value="${esc(st.reviewEnd || '')}"></div>
            </div>
            <div style="margin-bottom:10px;"><label class="tiny muted">Check in every (days), 0 for no check-ins</label><input id="re-every" type="number" min="0" class="modal-input" value="${esc(Number(st.followUpEveryDays) || 0)}"></div>
            <div style="margin-bottom:14px;"><label class="tiny muted">Reason (optional, kept in the log)</label><input id="re-note" type="text" class="modal-input"></div>
            ${undated ? '<div class="tiny muted" style="margin-bottom:12px;">This round has no review period. Enter an end date to give it one.</div>' : ''}
            <div style="display:flex; justify-content:space-between; gap:8px; flex-wrap:wrap;">
                ${undated ? '<span></span>' : '<button class="btn small soft" onclick="OL.saveReviewDates(true)" title="Keep the checklist open with no dates and no check-ins">Remove the review period</button>'}
                <button class="btn small primary" style="font-weight:bold;" onclick="OL.saveReviewDates(false)">Save dates</button>
            </div>
        </div>`);
    if (window.lucide) lucide.createIcons();
}

export async function saveReviewDates(removePeriod) {
    const ed = OL._reviewEdit; if (!ed) return;
    const client = await clientFor(ed.clientId);
    const key = ed.key;
    const start = val('re-start'), end = removePeriod ? '' : val('re-end'), every = removePeriod ? 0 : val('re-every'), note = val('re-note');
    if (!removePeriod && !end) { alert('Enter an end date, or use "Remove the review period".'); return; }
    let res;
    await updateAndSync(() => { res = setReviewPeriod(client, key, { ...contextFor(), now: new Date().toISOString() }, { start, end, everyDays: every, note }); }, client.id);
    if (res && res.error) { alert(res.error); return; }
    await syncChecklistDates(client.projectData.roundStates[key]);
    OL._reviewEdit = null;
    OL.closeModal();
    refreshScopingIfOpen();
}

// ---------------- how this project wraps up a round ----------------
export function openReviewSettings(clientId) {
    const client = state.clients?.[clientId]; if (!client) return;
    const cur = reviewModeFor(client, state.master, null);
    OL._reviewSettingsFor = clientId;
    openModal(`<div class="modal-head"><div class="modal-title-text"><i data-lucide="settings-2" style="width:16px;height:16px;vertical-align:sub;margin-right:6px;"></i>Review settings: ${esc(client.meta?.name || 'Project')}</div><div class="spacer"></div><button class="btn small soft" onclick="OL.closeModal()">Cancel</button></div>
        <div class="modal-body" style="max-width:520px; width:100%;">
            <p class="tiny muted" style="margin-bottom:12px;">What happens once every request in a round has passed testing. This is the project's default; each round can still be changed when you notify the client.</p>
            ${Object.entries(REVIEW_MODES).map(([k, m]) => `
            <label style="display:flex !important; align-items:flex-start; gap:8px; padding:8px 10px; border:1px solid var(--line); border-radius:6px; margin-bottom:6px; cursor:pointer;">
                <input type="radio" name="rs-mode" value="${k}" ${k === cur ? 'checked' : ''} style="width:auto !important; margin-top:3px;">
                <span><strong>${esc(m.short)}</strong><br><span class="tiny muted">${esc(m.label)}</span></span>
            </label>`).join('')}
            <div style="display:flex; justify-content:flex-end; margin-top:12px;"><button class="btn small primary" style="font-weight:bold;" onclick="OL.saveReviewSettings()">Save</button></div>
        </div>`);
    if (window.lucide) lucide.createIcons();
}

export async function saveReviewSettings() {
    const clientId = OL._reviewSettingsFor; const client = state.clients?.[clientId]; if (!client) return;
    const mode = document.querySelector('input[name="rs-mode"]:checked')?.value;
    if (!REVIEW_MODES[mode]) return;
    await updateAndSync(() => {
        if (!client.projectData.reviewSettings) client.projectData.reviewSettings = {};
        client.projectData.reviewSettings.mode = mode;
        // A round already waiting to be notified follows the new default (one that was already sent is left alone).
        Object.values(client.projectData.roundStates || {}).forEach((st) => {
            if (st && st.status === 'ready_to_notify') { st.mode = mode; setReviewDates(st, { mode, start: reviewStartAt(new Date()), days: reviewDefaults(state.master).days, followUpEveryDays: reviewDefaults(state.master).followUpEveryDays }); }
        });
    }, clientId);
    OL.closeModal();
    refreshScopingIfOpen();
}

// Maintenance clients: create an internal testing checklist (and Testing task) for each client request.
export async function setTestClientRequests(clientId, on) {
    const client = state.clients?.[clientId]; if (!client) return;
    await updateAndSync(() => {
        if (!client.projectData.reviewSettings) client.projectData.reviewSettings = {};
        client.projectData.reviewSettings.testClientRequests = !!on;
    }, clientId);
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
        // The client's overall approval (client_checklists.approved_at). Read on its own so everything else keeps
        // working before the column exists.
        let approvals = [];
        try {
            const ap = await db.from('client_checklists').select('token, approved_at').in('token', tokens);
            if (!ap.error) approvals = ap.data || [];
        } catch (e) { /* approval not switched on yet */ }
        for (const client of reviewing) {
            let approvalChanged = [];
            await updateAndSync(() => { approvalChanged = applyClientApproval(client, approvals, { ...contextFor(), now: new Date().toISOString() }); }, client.id);
            if (approvalChanged.length) { result.projects++; refreshScopingIfOpen(); }
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
Object.assign(window.OL, { editReviewDatesFor, saveReviewDates, openReviewSettings, saveReviewSettings, setTestClientRequests, rvModeChanged, extendReviewFor, pullClientReviewFeedback, updateRoundStatesFor, roundStatusHtml, openReviewNotification, rvRecalc, rvRefreshMessage, sendReviewNotification, closeReviewFor });

// First check shortly after the app loads, then every few minutes while it is open.
if (typeof window !== 'undefined' && typeof setTimeout === 'function' && !window.__OL_NO_TIMERS__) {
    setTimeout(() => pullClientReviewFeedback(), 25 * 1000);
    setInterval(() => pullClientReviewFeedback(), 5 * 60 * 1000);
}
