//======================= FEATURES / AI FEATURES =======================//
// The screens for every AI feature. Each one is off until it is switched on in Templates & settings > AI features, and the
// AI only ever suggests: a person picks every action. All calls go through core/ai-client.js (the ol-ai function, which
// removes passwords and keys first). Features:
//   1 Meetings        Recap Items matched to targets, action items checked against open tasks (OL.aiMeetingRecap)
//   2 Email           shadow logging, "Suggest links", lead intent, holding replies, review requests sent from Gmail
//   3 Testing         scenarios with sample data and separate expected results (OL.openScenarios)
//   4 Suggested asks  before / after scoping, learning from the suggestion log (OL.openSuggestedAsks)
//   5 How-to guides   (OL.openHowTo)           6 Resource history at task close (OL.aiHistoryDraft)

import { esc, state, db, uid, updateAndSync, getCurrentUserName } from '../core/data.js';
import { isAdmin } from '../core/auth.js';
import { isTaskClosed } from '../core/work-status.js';
import { AI_FEATURES, aiModes } from '../core/ai-flags.js';
import { getOlSettings } from '../core/ol-settings.js';
import { runAi, featureMode } from '../core/ai-client.js';
import { parseRecapItems, checkActionItems } from '../core/recap-items.js';
import { cleanEmailBody, quoteExists } from '../core/email-clean.js';
import { saveNote } from '../core/captures.js';
import { logSuggestion, logManual, recordOutcome, accuracyFor } from '../core/suggestion-log.js';
import { scrubSecrets } from '../core/secret-scrub.js';
import { shadowCoverage } from '../core/ai-compare.js';
import { INTENT_LABEL, INTENT_TASK_KIND, localIntent, normalizeIntent, combineIntent } from '../core/lead-intent.js';
import { isPreClient } from '../core/lead-rules.js';
import * as SC from '../core/test-scenarios.js';
import { normalizeAsks, withoutAlreadyAsked, learnFromLog, applyLearning, asksEmailDraft } from '../core/suggested-asks.js';

const OL = (window.OL = window.OL || {});
const el = (id) => document.getElementById(id);
const today = () => new Date().toISOString().slice(0, 10);
const closedNames = () => { const n = (OL.getSystemStatuses ? OL.getSystemStatuses() : []).filter((s) => s.isClosed).map((s) => s.name); return n.length ? n : ['Done']; };
const clientOf = (id) => state.clients?.[id];
const stripHtml = (h) => (OL._stripHtmlForPreview ? OL._stripHtmlForPreview(h) : String(h || '').replace(/<[^>]+>/g, ' '));
const firstName = () => String(getCurrentUserName?.() || '').trim().split(/\s+/)[0].toLowerCase();
const seesSecretFlag = () => ['arielle', 'anthony'].includes(firstName());
const icon = (n, s = 13) => `<i data-lucide="${n}" style="width:${s}px;height:${s}px;"></i>`;
const refreshIcons = () => { try { window.lucide?.createIcons(); } catch (_) { /* icons are decoration */ } };
const modal = (html) => { if (typeof OL.showOverlayModal === 'function') OL.showOverlayModal(`<div style="width:100%;">${html}</div>`, { wide: true }); else window.openModal?.(html); refreshIcons(); };

const NO_AI = (r) => (r?.off ? 'This AI feature is switched off in Templates & settings.' : (r?.error || 'The AI could not answer. Nothing was changed.'));

// ================================================================================================================
// Settings section (Templates & settings) and the numbers
// ================================================================================================================
OL.aiSectionHtml = function () {
    if (!isAdmin()) return '';
    const modes = aiModes(getOlSettings());
    const rows = AI_FEATURES.map((f) => `
        <div style="display:flex;gap:12px;align-items:center;padding:8px 0;border-bottom:1px solid var(--line);">
            <div style="flex:1;min-width:0;"><div style="font-weight:600;font-size:13px;">${esc(f.label)}</div><div class="tiny muted">${esc(f.help)}</div></div>
            <select class="modal-input" style="width:130px;" onchange="OL.setAiMode('${f.key}', this.value)">
                <option value="off" ${modes[f.key] === 'off' ? 'selected' : ''}>Off</option>
                ${f.shadow ? `<option value="shadow" ${modes[f.key] === 'shadow' ? 'selected' : ''}>Shadow (log only)</option>` : ''}
                <option value="suggest" ${modes[f.key] === 'suggest' ? 'selected' : ''}>Suggest</option>
            </select>
        </div>`).join('');
    return `<div class="card" style="padding:16px 18px; margin-bottom:14px;">
        <div style="font-weight:700; font-size:14px;">AI features</div>
        <div class="tiny muted" style="margin:2px 0 8px;">Each starts Off. Shadow runs quietly and only logs, so it can be compared with what people did. Suggest shows suggestions to approve. Changes here save at once. Passwords and keys are removed before anything reaches the AI.</div>
        ${rows}
        <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;">
            <button class="btn tiny soft" onclick="OL.openNoteSearch()">${icon('search')} Search all notes</button>
            <button class="btn tiny soft" onclick="OL.openAiNumbers()">${icon('bar-chart-3')} See the numbers</button>
            <button class="btn tiny soft" onclick="OL.aiScrubStoredEmails()">${icon('shield-check')} Remove passwords and keys from saved emails</button>
        </div></div>`;
};

OL.setAiMode = function (key, mode) {
    if (!state.masterHasOlSettings) { alert('Run the ol_settings migration first, settings cannot be saved until that column exists.'); return; }
    const cur = state.master?.olSettings || {};
    updateAndSync(() => { state.master.olSettings = { ...cur, ai: { ...(cur.ai || {}), [key]: mode } }; });
};

OL.openAiNumbers = async function () {
    modal('<div class="card" style="padding:20px;">Loading…</div>');
    const since = new Date(Date.now() - 60 * 86400000).toISOString();
    let runs = [];
    try { const { data } = await db.from('ai_runs').select('id,feature,mode,source_id,output,secrets_removed,error,created_at').gte('created_at', since).order('created_at', { ascending: false }).limit(1500); runs = data || []; } catch (_) { /* table missing */ }
    const types = ['change', 'approval', 'holding_reply', 'item_received', 'new_request', 'note'];
    const acc = {}; for (const t of types) acc[t] = await accuracyFor(t, since);
    const emailRuns = runs.filter((r) => r.feature === 'email' && r.mode === 'shadow' && r.source_id);
    let cov = null;
    if (emailRuns.length) {
        const ids = [...new Set(emailRuns.map((r) => r.source_id))].slice(0, 400);
        try { const { data } = await db.from('gmail_messages').select('id,suggestions,piece_links').in('id', ids); cov = shadowCoverage(emailRuns, data || []); } catch (_) { /* skip */ }
    }
    const per = AI_FEATURES.map((f) => {
        const rs = runs.filter((r) => r.feature === f.key);
        return `<tr><td>${esc(f.label)}</td><td>${aiModes(getOlSettings())[f.key]}</td><td>${rs.length}</td><td>${rs.filter((r) => r.error).length}</td><td>${rs.reduce((s, r) => s + (r.secrets_removed || 0), 0)}</td></tr>`;
    }).join('');
    const accRows = types.filter((t) => acc[t]?.total).map((t) => `<tr><td>${esc(t)}</td><td>${acc[t].total}</td><td>${acc[t].accepted}</td><td>${acc[t].edited}</td><td>${acc[t].dismissed}</td><td>${acc[t].manual}</td><td>${acc[t].acceptRate ?? ''}%</td></tr>`).join('');
    modal(`<div class="card" style="padding:20px;max-width:none;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;"><b style="font-size:15px;">AI numbers, last 60 days</b><button class="btn tiny soft" style="margin-left:auto;" onclick="OL.closeModal()">Close</button></div>
        <table class="tiny" style="width:100%;border-collapse:collapse;"><thead><tr style="text-align:left;"><th>Feature</th><th>Mode</th><th>Runs</th><th>Errors</th><th>Secrets removed</th></tr></thead><tbody>${per}</tbody></table>
        <div id="ai-grad"></div>
        <div style="margin-top:14px;font-weight:600;font-size:13px;">Email shadow mode: compared with what you linked</div>
        ${cov ? `<div class="tiny" style="margin-top:4px;">${cov.emails} emails. It found ${cov.covered} of the ${cov.covered + cov.missed} things you linked${cov.coverage !== null ? ` (${cov.coverage}%)` : ''}, missed ${cov.missed}, and suggested ${cov.extra} you did not link (possible false flags).</div>` : '<div class="tiny muted" style="margin-top:4px;">No shadow runs on emails yet.</div>'}
        <div style="margin-top:14px;font-weight:600;font-size:13px;">Suggestions, by what people did</div>
        ${accRows ? `<table class="tiny" style="width:100%;border-collapse:collapse;margin-top:4px;"><thead><tr style="text-align:left;"><th>Type</th><th>Decided</th><th>Accepted</th><th>Edited</th><th>Dismissed</th><th>Added by hand</th><th>Kept</th></tr></thead><tbody>${accRows}</tbody></table>` : '<div class="tiny muted" style="margin-top:4px;">Nothing decided yet.</div>'}
        <div class="tiny muted" style="margin-top:12px;">Move to the next phase when most suggestions are accepted unchanged and you are not adding things by hand that it missed.</div></div>`);
    OL.aiGraduationFill?.();
};

// One-time cleanup: the saved copies of emails (text and html) lose any password or key.
OL.aiScrubStoredEmails = async function () {
    if (!isAdmin()) return;
    if (!confirm('Replace passwords and keys found in saved email copies with "[secret removed]"? The emails in Gmail are not touched.')) return;
    let fixed = 0, scanned = 0, from = 0;
    const scrubHtml = (h) => String(h).replace(/>([^<]+)</g, (_m, t) => '>' + scrubSecrets(t).text + '<');
    for (;;) {
        const { data, error } = await db.from('gmail_messages').select('id,body,body_html,snippet').order('id').range(from, from + 199);
        if (error || !data || !data.length) { if (error) alert('Could not read saved emails: ' + error.message); break; }
        for (const m of data) {
            scanned++;
            const body = scrubSecrets(m.body || ''), snip = scrubSecrets(m.snippet || '');
            const html = m.body_html ? scrubHtml(m.body_html) : m.body_html;
            if (body.removed || snip.removed || html !== m.body_html) {
                const { error: e2 } = await db.from('gmail_messages').update({ body: body.text, snippet: snip.text, body_html: html }).eq('id', m.id);
                if (!e2) fixed++;
            }
        }
        if (data.length < 200) break;
        from += 200;
    }
    alert(`Checked ${scanned} saved emails; cleaned ${fixed}. Delete the originals from the inbox yourself, OL cannot do that.`);
};

// ================================================================================================================
// Shared: suggestion cards
// ================================================================================================================
const noteHandler = async (s) => {
    const p = s.payload || {}, t = p.target || null;
    const res = await saveNote({
        clientId: p.clientId, taskId: t?.type === 'task' ? t.id : null, requestId: t?.type === 'request' ? t.id : null, resourceId: t?.type === 'resource' ? t.id : null,
        author: getCurrentUserName?.(), type: p.sourceKind === 'gmail_message' ? 'email' : 'meeting', visibility: 'team', body: p.text,
        sourceKind: p.sourceKind, sourceId: p.sourceId,
    });
    if (!res.note) { alert('Notes could not be saved right now. Nothing was changed.'); return false; }
    return true;
};
// "Link" means a note on the target for a meeting, and a saved excerpt link for an email.
const linkHandler = (s) => (s.payload?.sourceKind === 'gmail_message' ? emailLink(s) : noteHandler(s));
const registerNotes = () => ['change', 'approval', 'new_request', 'note', 'holding_reply', 'item_received']
    .forEach((t) => OL.registerSuggestionHandler?.(t, { add_note: noteHandler, link: linkHandler, change_target: emailPick }));

function cardFor(base) {
    const { target, type, quote, confidence, payload } = base;
    const actions = [];
    if (target) actions.push({ key: 'link', label: `Link to ${target.label}`, icon: 'link', primary: true });
    actions.push({ key: 'add_note', label: target ? 'Add as note' : 'Add as note on the project', icon: 'sticky-note' });
    if (base.extraActions) actions.push(...base.extraActions);
    if (!target && base.canChoose) actions.push({ key: 'change_target', label: 'Choose target…', icon: 'target' });
    actions.push({ key: 'dismiss', label: 'Dismiss', icon: 'x' });
    return {
        id: 'ai_' + uid().slice(3), logId: base.logId, n: base.n, type, quote, confidence,
        rows: [target ? ['Matched to', `<b>${esc(target.label)}</b> <span class="muted">(${esc(target.type)})</span>`] : ['Matched to', '<span class="muted">nothing yet</span>'], ...(base.rows || [])],
        actions, payload: { ...payload, target },
    };
}

// ================================================================================================================
// 1. Meetings: Recap Items and duplicate check
// ================================================================================================================
OL.aiMeetingRecap = async function ({ evt, client, actionItems }) {
    const box = el('ms-ai-recap');
    const mode = featureMode('recap');
    if (!box || mode === 'off' || !client) return;
    registerNotes();

    // Action items checked against open tasks, no AI.
    const names = closedNames();
    const tasks = (client.projectData?.clientTasks || []).filter((t) => t && !t.consolidatedFollowUp).map((t) => ({
        id: t.id, title: t.title || t.name || '', instructions: t.description || '', closed: isTaskClosed(t, names), closedAt: t.completedAt }));
    const dups = checkActionItems(actionItems || [], tasks, today()).filter((d) => d.level !== 'none' || d.recentlyCompleted);
    const dupHtml = dups.length ? `<div style="border:1px solid var(--line);border-radius:8px;padding:8px 10px;margin-bottom:10px;font-size:12px;">
        <div class="bold tiny uppercase muted" style="margin-bottom:4px;">Action items that may already exist</div>
        ${dups.map((d, i) => `<div style="margin-bottom:6px;"><div>${esc(d.text)}</div>
            ${d.match ? `<div class="tiny muted">${d.level === 'strong' ? 'Matches' : 'May match'} task: <b>${esc(d.match.title)}</b></div>
                <button class="btn tiny ${d.level === 'strong' ? 'primary' : 'soft'}" onclick="OL.aiDupNote('${esc(client.id)}','${esc(String(d.match.taskId))}',${i},'${esc(String(evt.id))}')">Add as a note on that task instead</button>` : ''}
            ${d.recentlyCompleted ? `<div class="tiny muted">Recently completed: ${esc(d.recentlyCompleted.title)}. This is treated as new work.</div>` : ''}</div>`).join('')}</div>` : '';
    OL._aiDups = dups;

    const entries = parseRecapItems(evt.zoom_summary);
    box.innerHTML = `${dupHtml}<div class="bold tiny uppercase muted" style="margin-bottom:4px;">Recap items</div><div id="ms-ai-recap-cards" class="tiny muted">${entries.length ? 'Matching…' : 'No Recap Items section in this summary.'}</div>`;
    refreshIcons();
    if (!entries.length) return;

    const items = OL._openItemsForClassification ? OL._openItemsForClassification(client.id) : [];
    const res = await runAi('recap_match', { entries: entries.map((e, i) => ({ id: 'e' + i, type: e.word, text: e.text, hint: e.targetHint })), items }, { clientId: client.id, sourceKind: 'calendar_event', sourceId: evt.id });
    const out = el('ms-ai-recap-cards');
    if (!out) return;
    if (!res.ok) { out.textContent = NO_AI(res); return; }
    if (res.shadow) { out.textContent = 'Shadow mode: logged, nothing shown.'; return; }

    const byId = new Map((res.result?.matches || []).map((m) => [String(m.entryId), m]));
    const known = new Map(items.map((i) => [String(i.id), i]));
    const cards = [], unmatched = [];
    for (let i = 0; i < entries.length; i++) {
        const e = entries[i], m = byId.get('e' + i) || {};
        const t = m.targetId && known.get(String(m.targetId)) ? known.get(String(m.targetId)) : null;
        const type = e.type === 'new_request' && t ? 'change' : (['change', 'approval', 'new_request', 'note'].includes(m.type) ? m.type : e.type);
        if (!t && (type === 'new_request' || type === 'change')) { unmatched.push(e); }
        const logId = await logSuggestion({ clientId: client.id, sourceKind: 'calendar_event', sourceId: evt.id, type, quote: e.text, targetKind: t?.type, targetId: t?.id, confidence: m.confidence, secretsRemoved: res.secretsRemoved });
        cards.push(cardFor({ n: i + 1, logId, type, quote: e.text, confidence: m.confidence || 'low', target: t ? { type: t.type, id: t.id, label: t.label } : null,
            rows: m.restates ? [['Note', 'Restates something already recorded, so adding it as a note is the default.']] : [],
            payload: { clientId: client.id, text: `${e.text} (meeting ${String(evt.start || '').slice(0, 10)})`, sourceKind: 'calendar_event', sourceId: evt.id } }));
    }
    out.className = '';
    out.innerHTML = `<div style="display:flex;flex-direction:column;gap:8px;">${cards.map((c) => OL.suggestionCardHtml(c)).join('')}</div>
        ${unmatched.length ? `<details style="margin-top:8px;"><summary class="tiny muted">Possible unrecorded requests (${unmatched.length})</summary><ul class="tiny">${unmatched.map((u) => `<li>${esc(u.text)}</li>`).join('')}</ul></details>` : ''}`;
    refreshIcons();
};

OL.aiDupNote = async function (clientId, taskId, idx, eventId) {
    const d = (OL._aiDups || [])[idx];
    if (!d) return;
    const res = await saveNote({ clientId, taskId, author: getCurrentUserName?.(), type: 'meeting', visibility: 'team', body: `${d.text} (from meeting ${today()})`, sourceKind: 'calendar_event', sourceId: eventId });
    if (!res.note) { alert('The note could not be saved. Nothing was changed.'); return; }
    logSuggestion({ clientId, sourceKind: 'calendar_event', sourceId: eventId, type: 'note', quote: d.text, targetKind: 'task', targetId: taskId, confidence: d.level === 'strong' ? 'high' : 'medium' })
        .then((id) => id && recordOutcome(id, 'accepted', { decidedBy: getCurrentUserName?.() }));
    alert('Added as a note on that task. Remember to leave this item out when you create tasks from the meeting.');
};

// ================================================================================================================
// 2. Email: shadow mode, Suggest links, lead intent, holding replies, review requests sent from Gmail
// ================================================================================================================
const weAre = (sender) => { const mine = (OL.senderEmails ? OL.senderEmails() : []).map((e) => String(e).toLowerCase()); const s = String(sender || '').toLowerCase(); return mine.some((e) => s.includes(e)) || s.includes('@sphynxautomation.com'); };
const HOLDING_HINT = /\b(by|on|until|next|this|end of)\s+(mon|tue|wed|thu|fri|sat|sun|week|month|tomorrow)|\bget (it|that|them|this) (to|back to) you|\bsend (it|that|them) (over|by|on)|\bneed (a few|some) (more )?(days|time)|\bhaven'?t had time\b/i;

OL.aiEmailShadow = function (m, bodyText) {
    if (!m || !m.linked_client_id && featureMode('lead_intent') !== 'shadow') return;
    const ours = weAre(m.sender);
    const ctx = { clientId: m.linked_client_id, sourceKind: 'gmail_message', sourceId: m.id };
    const text = cleanEmailBody(bodyText);
    if (!text) return;
    if (!ours && featureMode('email') === 'shadow') {
        runAi('email_classify', { text, items: OL._openItemsForClassification ? OL._openItemsForClassification(m.linked_client_id) : [], flagged: (m.suggestions || []).map((s) => s.text) }, ctx);
    }
    if (!ours && featureMode('holding_reply') === 'shadow' && HOLDING_HINT.test(text)) runAi('holding_reply', { text, today: today() }, ctx);
    if (!ours && featureMode('lead_intent') === 'shadow' && (!m.linked_client_id || isPreClient(clientOf(m.linked_client_id)))) runAi('lead_intent', { text }, ctx);
    if (ours && featureMode('email_review') === 'shadow' && m.linked_client_id) runAi('email_review_sent', { text, items: closedItemsFor(m.linked_client_id) }, ctx);
};

function closedItemsFor(clientId) {
    const c = clientOf(clientId); const names = closedNames();
    return (c?.projectData?.clientTasks || []).filter((t) => t && isTaskClosed(t, names) && t.status !== 'Approved').slice(0, 60).map((t) => ({ id: String(t.id), label: t.title || t.name || 'Task' }));
}

const autoDone = new Map();
OL.aiEmailMount = function (m, container) {
    if (!m) return;
    let host = el('gmail-ai-suggestions');
    if (!host) { host = document.createElement('div'); host.id = 'gmail-ai-suggestions'; container.insertAdjacentElement('afterend', host); }
    const ours = weAre(m.sender);
    const parts = [];
    if (/\[secret removed\]/i.test(`${m.body || ''}${m.snippet || ''}`) && seesSecretFlag()) {
        parts.push(`<div style="border:1px solid #f87171;border-radius:8px;padding:8px 10px;margin-bottom:10px;font-size:12px;">
            <div style="font-weight:700;color:#f87171;">A password or key was removed from this email</div>
            <div class="tiny muted" style="margin:3px 0 6px;">OL keeps a cleaned copy only. The original is still in the inbox, so delete it there.</div>
            <button class="btn tiny soft" onclick="OL.aiCopyCredentialReply()">${icon('copy')} Copy a reply asking them to use 1Password</button></div>`);
    }
    if (!ours && featureMode('email') === 'suggest') parts.push(`<div style="margin-bottom:10px;"><button class="btn tiny soft" onclick="OL.aiSuggestLinks('${esc(m.id)}')">${icon('sparkles')} Suggest links</button></div>`);
    host.innerHTML = `${parts.join('')}<div id="gmail-ai-cards" style="display:flex;flex-direction:column;gap:8px;margin-bottom:10px;"></div>`;
    refreshIcons();
    if (!autoDone.has(m.id)) { autoDone.set(m.id, true); OL.aiAutoLink?.(m); aiEmailAuto(m).catch((e) => console.warn('AI email check skipped:', e)); }
};

OL.aiCopyCredentialReply = function () {
    const msg = 'Thanks for sending that over. For your security, please do not email passwords or keys. Could you share them through our 1Password link instead? We will send you one. Once it is shared, please delete the earlier email as well.';
    navigator.clipboard?.writeText(msg).then(() => alert('Copied. Paste it into a reply.'), () => prompt('Copy this reply:', msg));
};

// Things that appear on their own when an email is opened (each only when its feature is on in Suggest mode).
async function aiEmailAuto(m) {
    const ours = weAre(m.sender);
    const text = cleanEmailBody(stripHtml(m.body || m.snippet || ''));
    if (!text) return;
    const ctx = { clientId: m.linked_client_id, sourceKind: 'gmail_message', sourceId: m.id };
    const cards = [];
    registerNotes();
    OL.registerSuggestionHandler?.('holding_reply', { move_due: moveDueHandler });
    OL.registerSuggestionHandler?.('item_received', { open_review: (s) => { OL.crOpenSend?.(s.payload.clientId); return true; } });
    OL.registerSuggestionHandler?.('new_request', { start_task: leadTaskHandler });

    if (!ours && featureMode('lead_intent') === 'suggest' && (!m.linked_client_id || isPreClient(clientOf(m.linked_client_id)))) {
        const r = await runAi('lead_intent', { text }, ctx);
        if (r.ok && !r.shadow) {
            const ai = normalizeIntent(r.result, text), local = localIntent(text), best = combineIntent(ai, local);
            const kind = INTENT_TASK_KIND[best.intent];
            const logId = await logSuggestion({ clientId: m.linked_client_id, sourceKind: 'gmail_message', sourceId: m.id, type: 'new_request', quote: best.quote || text.slice(0, 160), confidence: best.confidence, secretsRemoved: r.secretsRemoved });
            cards.push(cardFor({ logId, type: 'new_request', quote: best.quote || '', confidence: best.confidence, target: null,
                rows: [['Reads as', `<b>${esc(INTENT_LABEL[best.intent])}</b>${best.disagreed ? ' <span class="muted">(readings disagreed, please check)</span>' : ''}`]],
                extraActions: kind && m.linked_client_id ? [{ key: 'start_task', label: kind === 'prepare_quote' ? 'Create "Prepare quote" task' : 'Create "Offer paid scoping" task', icon: 'file-text', primary: true }] : [],
                payload: { clientId: m.linked_client_id, text: best.quote || text.slice(0, 200), sourceKind: 'gmail_message', sourceId: m.id, leadKind: kind } }));
        }
    }
    if (!ours && m.linked_client_id && featureMode('holding_reply') === 'suggest' && HOLDING_HINT.test(text)) {
        const r = await runAi('holding_reply', { text, today: today() }, ctx);
        if (r.ok && !r.shadow && r.result?.isHoldingReply && quoteExists(r.result.quote, text)) {
            const due = r.result.statedDate && /^\d{4}-\d{2}-\d{2}$/.test(r.result.statedDate) ? addDays(r.result.statedDate, 1) : addDays(today(), 3);
            const logId = await logSuggestion({ clientId: m.linked_client_id, sourceKind: 'gmail_message', sourceId: m.id, type: 'holding_reply', quote: r.result.quote, confidence: r.result.confidence, secretsRemoved: r.secretsRemoved });
            cards.push(cardFor({ logId, type: 'holding_reply', quote: r.result.quote, confidence: r.result.confidence || 'low', target: null,
                rows: [['Move the client follow-up to', `<b>${esc(due)}</b> <span class="muted">${r.result.statedDate ? '(the day after their stated date)' : '(3 days from this reply)'}</span>`]],
                extraActions: [{ key: 'move_due', label: `Move follow-up to ${due}`, icon: 'calendar', primary: true }],
                payload: { clientId: m.linked_client_id, text: r.result.quote, due, sourceKind: 'gmail_message', sourceId: m.id } }));
        }
    }
    if (ours && m.linked_client_id && featureMode('email_review') === 'suggest') {
        const items = closedItemsFor(m.linked_client_id);
        if (items.length) {
            const r = await runAi('email_review_sent', { text, items }, ctx);
            if (r.ok && !r.shadow && r.result?.isReviewRequest) {
                const ids = new Set(items.map((i) => i.id)), hit = (r.result.itemIds || []).filter((i) => ids.has(String(i)));
                const logId = await logSuggestion({ clientId: m.linked_client_id, sourceKind: 'gmail_message', sourceId: m.id, type: 'item_received', quote: r.result.quote, confidence: r.result.confidence, secretsRemoved: r.secretsRemoved });
                cards.push(cardFor({ logId, type: 'item_received', quote: r.result.quote || '', confidence: r.result.confidence || 'low', target: null,
                    rows: [['Looks like', `A review request${hit.length ? ` covering ${hit.length} closed item${hit.length === 1 ? '' : 's'}` : ''}, sent outside OL`]],
                    extraActions: [{ key: 'open_review', label: 'Record it as sent for review', icon: 'send', primary: true }],
                    payload: { clientId: m.linked_client_id, text: r.result.quote || '', sourceKind: 'gmail_message', sourceId: m.id } }));
            }
        }
    }
    const host = el('gmail-ai-cards');
    if (host && cards.length) { host.insertAdjacentHTML('afterbegin', cards.map((c) => OL.suggestionCardHtml(c)).join('')); refreshIcons(); }
}

function addDays(day, n) { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

const moveDueHandler = async (s) => {
    const p = s.payload, c = clientOf(p.clientId);
    const t = (c?.projectData?.clientTasks || []).find((x) => x && x.consolidatedFollowUp && !isTaskClosed(x, closedNames()));
    if (!t) { alert('There is no open client follow-up task to move.'); return false; }
    await updateAndSync(() => { t.dueDate = p.due; }, p.clientId);
    return true;
};
const leadTaskHandler = async (s) => {
    const p = s.payload;
    if (!p.leadKind || !p.clientId) return false;
    await updateAndSync(() => { OL.createLeadTaskFor?.(p.clientId, p.leadKind); }, p.clientId);
    return true;
};

OL.aiSuggestLinks = async function (messageId) {
    const host = el('gmail-ai-cards');
    if (host) host.innerHTML = '<div class="tiny muted">Reading the new text of this email…</div>';
    const { data: m } = await db.from('gmail_messages').select('id,body,snippet,linked_client_id,sender,suggestions').eq('id', messageId).single();
    if (!m) return;
    const text = cleanEmailBody(stripHtml(m.body || m.snippet || ''));
    if (!text) { if (host) host.innerHTML = '<div class="tiny muted">No new text to read in this email.</div>'; return; }
    const items = OL._openItemsForClassification ? OL._openItemsForClassification(m.linked_client_id) : [];
    const r = await runAi('email_classify', { text, items, flagged: (m.suggestions || []).map((s) => s.text) }, { clientId: m.linked_client_id, sourceKind: 'gmail_message', sourceId: m.id });
    if (!r.ok) { if (host) host.innerHTML = `<div class="tiny muted">${esc(NO_AI(r))}</div>`; return; }
    const known = new Map(items.map((i) => [String(i.id), i]));
    const list = (r.result?.suggestions || []).filter((s) => s && quoteExists(s.quote, text)).slice(0, 8);
    registerNotes();
    const cards = [];
    for (let i = 0; i < list.length; i++) {
        const s = list[i], t = s.targetId && known.get(String(s.targetId)) ? known.get(String(s.targetId)) : null;
        const type = ['change', 'approval', 'new_request', 'note'].includes(s.suggestedType) ? s.suggestedType : 'new_request';
        const logId = await logSuggestion({ clientId: m.linked_client_id, sourceKind: 'gmail_message', sourceId: m.id, type, quote: s.quote, targetKind: t?.type, targetId: t?.id, confidence: s.confidence, secretsRemoved: r.secretsRemoved });
        cards.push(cardFor({ n: i + 1, logId, type, quote: s.quote, confidence: s.confidence || 'low', target: t ? { type: t.type, id: t.id, label: t.label } : null, canChoose: true,
            rows: s.restatesFlagged ? [['Note', 'Restates something already flagged, so adding it as a note is the default.']] : [],
            payload: { clientId: m.linked_client_id, text: s.quote, sourceKind: 'gmail_message', sourceId: m.id, messageId: m.id } }));
    }
    if (host) host.innerHTML = cards.length ? cards.map((c) => OL.suggestionCardHtml(c)).join('') : '<div class="tiny muted">Nothing in the new text of this email looks like a request or change.</div>';
    refreshIcons();
};
const emailLink = async (s) => {
    const p = s.payload, t = p.target;
    if (!t) return false;
    const { data: m } = await db.from('gmail_messages').select('piece_links').eq('id', p.messageId).single();
    const links = Array.isArray(m?.piece_links) ? m.piece_links.slice() : [];
    links.push({ id: 'pl-' + uid(), kind: 'excerpt', text: p.text, note: '', targetType: t.type, targetId: t.id, targetLabel: t.label, createdAt: new Date().toISOString() });
    const { error } = await db.from('gmail_messages').update({ piece_links: links }).eq('id', p.messageId);
    if (error) { alert('Could not link that. Nothing was changed.'); return false; }
    return true;
};
const emailPick = (s) => { OL.openExcerptLinkPicker?.(s.payload.messageId, s.payload.text); return true; };

// ================================================================================================================
// Client tools strip (Suggested asks, Test scenarios, How-to guide) and history button
// ================================================================================================================
OL.aiClientToolsHtml = function (client) {
    const on = (k) => featureMode(k) === 'suggest';
    const btn = (label, ic, fn) => `<button class="btn tiny soft" onclick="${fn}('${esc(client.id)}')" style="display:inline-flex;gap:5px;align-items:center;">${icon(ic, 12)}${label}</button>`;
    const b = [on('suggested_asks') && btn('Suggested asks', 'list-checks', 'OL.openSuggestedAsks'), on('test_scenarios') && btn('Test scenarios', 'flask-conical', 'OL.openScenarios'), on('howto') && btn('How-to guide', 'book-open', 'OL.openHowTo')].filter(Boolean);
    const sc = client.projectData?.testScenarios;
    if (!b.length && !(sc && sc.length)) return '';
    const b2 = b.length ? b : [btn('Test scenarios', 'flask-conical', 'OL.openScenarios')];
    return `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px;"><span class="tiny muted" style="display:inline-flex;gap:5px;align-items:center;">${icon('sparkles', 12)}AI tools</span>${b2.join('')}</div>`;
};
OL.aiHistoryButtonHtml = function (clientId, taskId) {
    if (featureMode('history') !== 'suggest') return '';
    return `<button class="btn tiny soft" onclick="OL.aiHistoryDraft('${esc(clientId)}','${esc(String(taskId))}')" style="display:inline-flex;gap:5px;align-items:center;">${icon('history', 12)}History entry</button>`;
};

const scopeText = (c) => ((c?.projectData?.scopingSheets || []).flatMap((s) => s?.lineItems || [])).slice(0, 80)
    .map((i) => `${i.name || i.title || i.description || 'Item'}${i.description && i.name ? ': ' + i.description : ''}`).join('\n');
const buildDetails = (c) => (c?.projectData?.localResources || []).filter((r) => r && !r.isArchived && !r.archived).slice(0, 60)
    .map((r) => `${r.name} (${r.type || 'resource'})${r.description ? ': ' + String(r.description).slice(0, 300) : ''}${r.notes ? ' | ' + String(r.notes).slice(0, 300) : ''}`).join('\n');

// ================================================================================================================
// 3. Testing scenarios
// ================================================================================================================
const scList = (c) => { if (!Array.isArray(c.projectData.testScenarios)) c.projectData.testScenarios = []; return c.projectData.testScenarios; };
const save = (clientId, fn) => updateAndSync(fn, clientId);

OL.openScenarios = function (clientId) { renderScenarios(clientId); };
function renderScenarios(clientId) {
    const c = clientOf(clientId); if (!c?.projectData) return;
    const list = c.projectData.testScenarios || [];
    const sum = SC.runSummary(list.filter((s) => s.reviewed !== false));
    const chip = (st) => `<span class="pill tiny" style="background:${st === 'pass' ? '#22c55e22;color:#22c55e' : st === 'fail' ? '#f8717122;color:#f87171' : '#9aa7bd22;color:#9aa7bd'};border:1px solid transparent;cursor:default;">${st === 'pass' ? 'Pass' : st === 'fail' ? 'Fail' : 'Not run'}</span>`;
    const card = (s) => {
        const draft = s.source === 'ai' && s.reviewed === false;
        return `<div style="border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin-bottom:10px;${draft ? 'border-style:dashed;' : ''}">
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;"><b style="font-size:13px;">${esc(s.title)}</b><span class="pill tiny soft" style="cursor:default;">${esc(SC.SCENARIO_KINDS[s.kind])}</span>${draft ? '' : chip(SC.scenarioStatus(s))}
                <label class="tiny muted" style="margin-left:auto;display:flex;gap:4px;align-items:center;"><input type="checkbox" ${s.clientVisible ? 'checked' : ''} onchange="OL.scSet('${esc(clientId)}','${esc(s.id)}','clientVisible',this.checked)"> Show to client</label>
                ${draft ? `<button class="btn tiny primary" onclick="OL.scKeep('${esc(clientId)}','${esc(s.id)}',true)">Keep</button><button class="btn tiny soft" onclick="OL.scKeep('${esc(clientId)}','${esc(s.id)}',false)">Remove</button>` : `<button class="btn tiny soft" onclick="OL.scKeep('${esc(clientId)}','${esc(s.id)}',false)">Delete</button>`}</div>
            ${s.steps.length ? `<ol class="tiny" style="margin:6px 0 6px 18px;padding:0;">${s.steps.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>` : ''}
            ${Object.keys(s.sampleData).length ? `<div class="tiny muted" style="margin-bottom:6px;">Sample data: ${Object.entries(s.sampleData).map(([k, v]) => `<b>${esc(k)}</b> ${esc(v)}`).join(' · ')}</div>` : ''}
            ${s.expected.map((e) => `<div style="display:flex;gap:8px;align-items:center;padding:4px 0;border-top:1px solid var(--line);">
                <div style="flex:1;min-width:0;font-size:12px;">${esc(e.text)}</div>
                <input class="modal-input tiny" style="width:200px;" placeholder="Note" value="${esc(e.note)}" onchange="OL.scNote('${esc(clientId)}','${esc(s.id)}','${esc(e.id)}',this.value)">
                <button class="btn tiny ${e.result === 'pass' ? 'primary' : 'soft'}" onclick="OL.scResult('${esc(clientId)}','${esc(s.id)}','${esc(e.id)}','pass')">Pass</button>
                <button class="btn tiny ${e.result === 'fail' ? 'primary' : 'soft'}" style="${e.result === 'fail' ? 'background:#f87171;border-color:#f87171;' : ''}" onclick="OL.scResult('${esc(clientId)}','${esc(s.id)}','${esc(e.id)}','fail')">Fail</button>
                ${e.result === 'fail' ? `<button class="btn tiny soft" onclick="OL.scRetest('${esc(clientId)}','${esc(s.id)}','${esc(e.id)}')">Retest</button>` : ''}</div>`).join('')}
            <input class="modal-input tiny" style="width:100%;box-sizing:border-box;margin-top:6px;" placeholder="Evidence or link" value="${esc(s.evidence)}" onchange="OL.scSet('${esc(clientId)}','${esc(s.id)}','evidence',this.value)"></div>`;
    };
    modal(`<div class="card" style="padding:18px 20px;max-width:none;">
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px;"><b style="font-size:15px;">Test scenarios: ${esc(c.meta?.name || '')}</b>
            <span class="tiny muted">${sum.pass} pass · ${sum.fail} fail · ${sum.pending} not run</span>
            <span style="margin-left:auto;display:flex;gap:8px;flex-wrap:wrap;">
                ${featureMode('test_scenarios') !== 'off' ? `<button class="btn tiny primary" onclick="OL.scDraft('${esc(clientId)}')">${icon('sparkles')} Draft with AI</button>` : ''}
                <button class="btn tiny soft" onclick="OL.scAdd('${esc(clientId)}')">${icon('plus')} Add scenario</button>
                <button class="btn tiny soft" onclick="OL.scFromChecklist('${esc(clientId)}')">${icon('list')} Add from the old checklist</button>
                <button class="btn tiny soft" onclick="OL.scFixTasks('${esc(clientId)}')">${icon('wrench')} Create fix tasks</button>
                <button class="btn tiny soft" onclick="OL.scClientCopy('${esc(clientId)}')">${icon('copy')} Copy client version</button>
                <button class="btn tiny soft" onclick="OL.closeModal()">Close</button></span></div>
        <div id="sc-status" class="tiny muted" style="margin-bottom:8px;"></div>
        ${list.length ? list.map(card).join('') : '<div class="tiny muted">No scenarios yet. Add one, or draft them from the scope.</div>'}</div>`);
}
const scFind = (clientId, id) => scList(clientOf(clientId)).find((s) => s.id === id);
OL.scSet = (cid, id, f, v) => save(cid, () => { const s = scFind(cid, id); if (s) s[f] = v; });
OL.scNote = (cid, id, eid, v) => save(cid, () => { const e = scFind(cid, id)?.expected.find((x) => x.id === eid); if (e) e.note = v; });
OL.scResult = async (cid, id, eid, r) => { await save(cid, () => { const s = scFind(cid, id); if (s) SC.setResult(s, eid, scFind(cid, id).expected.find((x) => x.id === eid)?.result === r ? '' : r); }); renderScenarios(cid); };
OL.scRetest = async (cid, id, eid) => { await save(cid, () => { const s = scFind(cid, id); if (s) SC.resetForRetest(s, eid); }); renderScenarios(cid); };
OL.scKeep = async (cid, id, keep) => { await save(cid, () => { const l = scList(clientOf(cid)); const s = l.find((x) => x.id === id); if (!s) return; if (keep) s.reviewed = true; else l.splice(l.indexOf(s), 1); }); renderScenarios(cid); };
OL.scAdd = async (cid) => {
    const title = prompt('What is this scenario? (for example: Contact found, filter met)'); if (!title) return;
    const exp = prompt('What should happen? Separate several expected results with a semicolon.'); if (!exp) return;
    const kind = (prompt('Kind: path, edge or unexpected', 'path') || 'path').trim();
    await save(cid, () => scList(clientOf(cid)).push(SC.newScenario({ title, kind, steps: [], expected: exp.split(';').map((x) => x.trim()).filter(Boolean) })));
    renderScenarios(cid);
};
OL.scFromChecklist = async (cid) => {
    const c = clientOf(cid);
    const old = (c.projectData.testChecklist || c.projectData.testingChecklist || []).map((x) => (typeof x === 'string' ? x : x?.text || x?.title || ''));
    if (!old.filter(Boolean).length) { alert('This project has no earlier checklist items to turn into scenarios.'); return; }
    await save(cid, () => scList(c).push(...SC.fromChecklist(old)));
    renderScenarios(cid);
};
OL.scDraft = async (cid) => {
    const c = clientOf(cid); const st = el('sc-status'); if (st) st.textContent = 'Drafting scenarios from the scope and build details…';
    const r = await runAi('test_scenarios', { scope: scopeText(c), buildDetails: buildDetails(c), clientName: c.meta?.name || '' }, { clientId: cid, sourceKind: 'scoping', sourceId: cid }, {});
    if (!r.ok || r.shadow) { if (st) st.textContent = NO_AI(r); return; }
    const made = SC.normalizeGenerated(r.result).map((s) => ({ ...s, reviewed: false }));
    if (!made.length) { if (st) st.textContent = 'The AI did not return usable scenarios.'; return; }
    await save(cid, () => scList(c).push(...made));
    renderScenarios(cid);
};
OL.scFixTasks = async (cid) => {
    const c = clientOf(cid); const tasks = SC.fixTasksFor(scList(c), c.projectData.clientTasks);
    if (!tasks.length) { alert('No failed results without a fix task.'); return; }
    await save(cid, () => {
        const now = new Date().toISOString();
        tasks.forEach((t) => c.projectData.clientTasks.unshift({ id: uid(), title: t.title, name: t.title, description: t.instructions, status: 'Pending Sphynx Action', assignee: 'Sphynx Task', dueDate: '', isClientTask: false, loggedHours: 0, parentTaskId: null, createdBy: 'test-scenarios', createdAt: now, fixForScenarioId: t.fixForScenarioId, fixForExpectedId: t.fixForExpectedId }));
    });
    alert(`${tasks.length} fix task${tasks.length === 1 ? '' : 's'} created.`);
};
OL.scClientCopy = (cid) => {
    const v = SC.clientVersion(scList(clientOf(cid)));
    if (!v.length) { alert('Tick "Show to client" on expected-path scenarios first.'); return; }
    const text = v.map((s, i) => `${i + 1}. ${s.title}\n${s.steps.map((x) => `   - ${x}`).join('\n')}${s.steps.length ? '\n' : ''}   Expected:\n${s.expected.map((e) => `   [ ] ${e.text}`).join('\n')}`).join('\n\n');
    navigator.clipboard?.writeText(text).then(() => alert('Copied.'), () => prompt('Copy this:', text));
};

// ================================================================================================================
// 4. Suggested asks
// ================================================================================================================
OL.openSuggestedAsks = async function (clientId, stage = 'before_scoping') {
    const c = clientOf(clientId); if (!c?.projectData) return;
    modal('<div class="card" style="padding:20px;">Working out what we are likely to need…</div>');
    const asked = (c.projectData.clientTasks || []).filter((t) => t && t.isClientTask).map((t) => t.title || t.name);
    const similar = Object.values(state.clients || {}).filter((o) => o && o.id !== clientId && o.projectData).slice(0, 25)
        .map((o) => ({ resources: (o.projectData.localResources || []).slice(0, 8).map((r) => r.type || r.name), asked: (o.projectData.clientTasks || []).filter((t) => t && t.isClientTask && t.askKind).slice(0, 10).map((t) => t.title || t.name) }));
    const blueprints = (state.master?.taskBlueprints || []).slice(0, 40).map((b) => ({ name: b.name || b.title, tasks: (b.tasks || b.steps || []).slice(0, 8).map((t) => t.title || t.name || t) }));
    let log = [];
    try { const { data } = await db.from('suggestion_log').select('quote,status').eq('source_kind', 'suggested_ask').limit(800); log = (data || []).map((r) => ({ label: r.quote, status: r.status })); } catch (_) { /* skip */ }
    const r = await runAi('suggested_asks', { stage, scope: scopeText(c), resources: buildDetails(c), blueprints, similarProjects: similar, alreadyAsked: asked }, { clientId, sourceKind: 'scoping', sourceId: clientId });
    if (!r.ok || r.shadow) { modal(`<div class="card" style="padding:20px;">${esc(NO_AI(r))} <button class="btn tiny soft" onclick="OL.closeModal()">Close</button></div>`); return; }
    const asks = applyLearning(withoutAlreadyAsked(normalizeAsks(r.result), asked), learnFromLog(log));
    const logIds = await Promise.all(asks.map((a) => logSuggestion({ clientId, sourceKind: 'suggested_ask', sourceId: clientId, type: 'new_request', quote: a.label, confidence: a.fromMissingLater ? 'high' : 'medium', secretsRemoved: r.secretsRemoved })));
    OL._aiAsks = { clientId, asks: asks.map((a, i) => ({ ...a, logId: logIds[i], on: true, original: a.label })), manual: [] };
    renderAsks();
};
function renderAsks() {
    const st = OL._aiAsks; if (!st) return;
    const row = (a, i) => `<div style="display:flex;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid var(--line);">
        <input type="checkbox" ${a.on ? 'checked' : ''} onchange="OL._aiAsks.asks[${i}].on=this.checked">
        <div style="flex:1;min-width:0;"><input class="modal-input" style="width:100%;box-sizing:border-box;" value="${esc(a.label)}" onchange="OL._aiAsks.asks[${i}].label=this.value">
            ${a.why ? `<div class="tiny muted">${esc(a.why)}${a.fromMissingLater ? ' · was missing on similar projects' : ''}</div>` : ''}</div></div>`;
    modal(`<div class="card" style="padding:18px 20px;max-width:none;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;"><b style="font-size:15px;">Suggested asks</b><span class="tiny muted">Untick or edit. Nothing is created or sent until you choose.</span><button class="btn tiny soft" style="margin-left:auto;" onclick="OL.closeModal()">Close</button></div>
        ${st.asks.length ? st.asks.map(row).join('') : '<div class="tiny muted">Nothing new to ask for right now.</div>'}
        <div style="display:flex;gap:8px;margin-top:10px;"><input id="ask-add" class="modal-input" style="flex:1;" placeholder="Add one yourself…"><button class="btn tiny soft" onclick="OL.aiAskAdd()">Add</button></div>
        <div style="display:flex;gap:8px;margin-top:12px;"><button class="btn primary" onclick="OL.aiAsksAccept()">Create as client asks and draft the email</button></div>
        <textarea id="ask-email" class="modal-input" rows="9" style="display:none;width:100%;box-sizing:border-box;margin-top:12px;font-family:inherit;"></textarea>
        <div id="ask-email-note" class="tiny muted" style="display:none;margin-top:4px;">Created. The Communications role sends this email, then the asks feed the client follow-up.</div></div>`);
}
OL.aiAskAdd = function () {
    const st = OL._aiAsks, v = el('ask-add')?.value.trim(); if (!st || !v) return;
    st.asks.push({ label: v, why: '', on: true, logId: null, manual: true }); renderAsks();
};
OL.aiAsksAccept = async function () {
    const st = OL._aiAsks; if (!st) return;
    const c = clientOf(st.clientId), chosen = st.asks.filter((a) => a.on && a.label.trim());
    if (!chosen.length) { alert('Nothing is ticked.'); return; }
    const now = new Date().toISOString();
    await updateAndSync(() => chosen.forEach((a) => c.projectData.clientTasks.unshift({ id: uid(), title: a.label.trim(), name: a.label.trim(), description: a.why || '', status: 'Client Task', assignee: 'Client Task', dueDate: '', isClientTask: true, loggedHours: 0, parentTaskId: null, createdBy: 'suggested-asks', createdAt: now, askKind: 'document' })), st.clientId);
    // What people did with each suggestion goes in the log, so the list improves.
    for (const a of st.asks) {
        if (a.manual) await logManual({ clientId: st.clientId, sourceKind: 'suggested_ask', sourceId: st.clientId, type: 'new_request', quote: a.label, decidedBy: getCurrentUserName?.() });
        else if (a.logId) await recordOutcome(a.logId, !a.on ? 'dismissed' : (a.label !== a.original && a.original ? 'edited' : 'accepted'), { decidedBy: getCurrentUserName?.() });
    }
    const draft = asksEmailDraft(chosen, { clientFirstName: (c.meta?.contactName || '').split(' ')[0], senderName: '' });
    const ta = el('ask-email'); if (ta) { ta.value = `Subject: ${draft.subject}\n\n${draft.body}`; ta.style.display = 'block'; }
    const n = el('ask-email-note'); if (n) n.style.display = 'block';
};

// ================================================================================================================
// 5. How-to guides   6. Resource history entries
// ================================================================================================================
OL.openHowTo = async function (clientId) {
    const c = clientOf(clientId); if (!c?.projectData) return;
    const existing = c.projectData.howToGuide;
    const team = (c.projectData.teamMembers || []).length || 1;
    modal('<div class="card" style="padding:20px;">Drafting the guide from the scope and build details…</div>');
    let g = existing;
    if (!g) {
        const r = await runAi('howto_guide', { scope: scopeText(c), buildDetails: buildDetails(c), teamSize: team, clientName: c.meta?.name || '' }, { clientId, sourceKind: 'scoping', sourceId: clientId });
        if (!r.ok || r.shadow) { modal(`<div class="card" style="padding:20px;">${esc(NO_AI(r))} <button class="btn tiny soft" onclick="OL.closeModal()">Close</button></div>`); return; }
        const x = r.result || {}, gg = x.guide || {};
        const str = (v) => String(v || '').slice(0, 6000);
        const list = (v) => (Array.isArray(v) ? v.slice(0, 30).map((s) => String(s).slice(0, 300)).join('\n') : '');
        g = { built: str(gg.built), daily: str(gg.daily), safeChanges: str(gg.safeChanges), contact: str(gg.contact), onboarding: team > 1 ? list(x.onboarding) : '', offboarding: team > 1 ? list(x.offboarding) : '', reviewed: false, draftedAt: new Date().toISOString() };
    }
    OL._aiHowTo = { clientId, g };
    const f = (k, label, rows = 5) => `<label class="tiny muted" style="display:block;margin-top:10px;font-weight:600;">${label}</label><textarea class="modal-input" rows="${rows}" style="width:100%;box-sizing:border-box;font-family:inherit;" onchange="OL._aiHowTo.g.${k}=this.value">${esc(g[k] || '')}</textarea>`;
    modal(`<div class="card" style="padding:18px 20px;max-width:none;">
        <div style="display:flex;gap:8px;align-items:center;"><b style="font-size:15px;">How-to guide: ${esc(c.meta?.name || '')}</b><span class="tiny muted">A person reviews it before it is shared.</span><button class="btn tiny soft" style="margin-left:auto;" onclick="OL.closeModal()">Close</button></div>
        ${f('built', 'What was built')}${f('daily', 'How to use it day to day')}${f('safeChanges', 'How to add or change things safely')}${f('contact', 'Who to contact', 2)}
        ${team > 1 ? f('onboarding', 'Onboarding template (one step per line)') + f('offboarding', 'Offboarding template (one step per line)') : '<div class="tiny muted" style="margin-top:10px;">Single-member firm: onboarding and offboarding templates are not applicable.</div>'}
        <div style="display:flex;gap:8px;margin-top:14px;"><button class="btn primary" onclick="OL.aiHowToSave(true)">Save as reviewed</button><button class="btn soft" onclick="OL.aiHowToSave(false)">Save as draft</button><button class="btn soft" onclick="OL.aiHowToCopy()">Copy</button></div></div>`);
};
OL.aiHowToSave = async function (reviewed) {
    const st = OL._aiHowTo; if (!st) return;
    await updateAndSync(() => { clientOf(st.clientId).projectData.howToGuide = { ...st.g, reviewed, reviewedBy: reviewed ? getCurrentUserName?.() : null, reviewedAt: reviewed ? new Date().toISOString() : null }; }, st.clientId);
    alert(reviewed ? 'Saved as reviewed.' : 'Saved as a draft.');
};
OL.aiHowToCopy = function () {
    const g = OL._aiHowTo?.g; if (!g) return;
    const text = [['What was built', g.built], ['How to use it day to day', g.daily], ['How to add or change things safely', g.safeChanges], ['Who to contact', g.contact], ['Onboarding', g.onboarding], ['Offboarding', g.offboarding]].filter(([, v]) => v).map(([h, v]) => `${h}\n${v}`).join('\n\n');
    navigator.clipboard?.writeText(text).then(() => alert('Copied.'), () => prompt('Copy this:', text));
};

OL.aiHistoryDraft = async function (clientId, taskId) {
    const c = clientOf(clientId); const t = (c?.projectData?.clientTasks || []).find((x) => String(x.id) === String(taskId)); if (!t) return;
    const comments = (t.comments || []).slice(-15).map((x) => stripHtml(x.text || x.html || ''));
    const r = await runAi('history_entry', { task: { title: t.title || t.name, description: t.description || '' }, comments }, { clientId, sourceKind: 'task', sourceId: String(taskId) });
    if (!r.ok || r.shadow) { alert(NO_AI(r)); return; }
    const entry = String(r.result?.entry || '').slice(0, 800);
    if (!entry) { alert('The AI did not return an entry.'); return; }
    const final = prompt('Edit the history entry, then press OK to save it on the resource:', entry);
    const logId = await logSuggestion({ clientId, sourceKind: 'task', sourceId: String(taskId), type: 'note', quote: entry, targetKind: 'resource', targetId: t.resourceId, confidence: r.result?.confidence, secretsRemoved: r.secretsRemoved });
    if (final === null || !final.trim()) { if (logId) recordOutcome(logId, 'dismissed', { decidedBy: getCurrentUserName?.() }); return; }
    const res = await saveNote({ clientId, taskId: String(taskId), resourceId: t.resourceId || null, author: getCurrentUserName?.(), type: 'system', visibility: 'team', body: final.trim(), sourceKind: 'history_draft', sourceId: String(taskId) });
    if (logId) recordOutcome(logId, res.note ? (final.trim() === entry ? 'accepted' : 'edited') : 'dismissed', { decidedBy: getCurrentUserName?.() });
    alert(res.note ? (t.resourceId ? 'Saved on the resource.' : 'Saved on the task (it has no linked resource).') : 'Notes could not be saved right now.');
};
