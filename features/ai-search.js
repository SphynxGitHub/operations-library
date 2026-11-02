//======================= FEATURES / AI SEARCH AND GRADUATION =======================//
// (1) Ask anything: search every saved note by question. Works with no AI (word match); with "Ask anything" switched on,
//     the AI also writes an answer from the best matches and cites them. (2) Graduation: a suggestion type that has earned it
//     (core/graduation.js) can link emails by itself once an admin approves. Auto-links are logged and one click undoes them.

import { esc, state, db, uid, updateAndSync, getCurrentUserName } from '../core/data.js';
import { isAdmin } from '../core/auth.js';
import { getOlSettings } from '../core/ol-settings.js';
import { runAi, featureMode } from '../core/ai-client.js';
import { rankNotes, snippet, checkAnswer } from '../core/note-search.js';
import { eligibility, GRAD_TYPES, GRAD_MIN_DECIDED, GRAD_MIN_RATE, mayAutoLink } from '../core/graduation.js';
import { cleanEmailBody, quoteExists } from '../core/email-clean.js';
import { logSuggestion, recordOutcome } from '../core/suggestion-log.js';

const OL = (window.OL = window.OL || {});
const el = (id) => document.getElementById(id);
const modal = (html) => { if (typeof OL.showOverlayModal === 'function') OL.showOverlayModal(`<div style="width:100%;">${html}</div>`, { wide: true }); else window.openModal?.(html); try { window.lucide?.createIcons(); } catch (_) { /* decoration */ } };

// ---- Ask anything -------------------------------------------------------------------------------------------------
OL.openNoteSearch = function (clientId = '') {
    const clients = Object.values(state.clients || {}).filter((c) => c?.meta?.name).sort((a, b) => a.meta.name.localeCompare(b.meta.name));
    modal(`<div class="card" style="padding:18px 20px;max-width:none;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;"><b style="font-size:15px;">Search all notes</b><button class="btn tiny soft" style="margin-left:auto;" onclick="OL.closeModal()">Close</button></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <input id="ns-q" class="modal-input" style="flex:1;min-width:240px;" placeholder="Ask a question, e.g. which logo does the confirmation email use?" onkeydown="if(event.key==='Enter')OL.runNoteSearch()">
            <select id="ns-client" class="modal-input" style="width:200px;"><option value="">All projects</option>${clients.map((c) => `<option value="${esc(c.id)}" ${c.id === clientId ? 'selected' : ''}>${esc(c.meta.name)}</option>`).join('')}</select>
            <button class="btn primary" onclick="OL.runNoteSearch()">Search</button></div>
        <div id="ns-out" class="tiny muted" style="margin-top:12px;">Searches the notes saved from emails, meetings and task comments.</div></div>`);
};

OL.runNoteSearch = async function () {
    const q = (el('ns-q')?.value || '').trim(), cid = el('ns-client')?.value || '', out = el('ns-out');
    if (!q || !out) return;
    out.textContent = 'Searching…';
    let query = db.from('capture_notes').select('id,client_id,task_id,request_id,resource_id,author,type,body,source_kind,source_url,created_at,visibility').neq('visibility', 'client').order('created_at', { ascending: false }).limit(3000);
    if (cid) query = query.eq('client_id', cid);
    const { data, error } = await query;
    if (error) { out.textContent = 'Notes could not be searched right now.'; return; }
    const hits = rankNotes(q, data || []);
    if (!hits.length) { out.textContent = 'No notes match those words.'; return; }
    const nameOf = (id) => state.clients?.[id]?.meta?.name || 'Project';
    let answerHtml = '';
    if (featureMode('ask_notes') === 'suggest') {
        out.textContent = 'Reading the best matches…';
        const given = hits.slice(0, 10).map((h) => ({ id: h.note.id, date: String(h.note.created_at || '').slice(0, 10), project: nameOf(h.note.client_id), text: String(h.note.body || '').slice(0, 1500) }));
        const r = await runAi('ask_notes', { question: q, notes: given }, { clientId: cid || null, sourceKind: 'note_search', sourceId: null });
        if (r.ok && !r.shadow) {
            const a = checkAnswer(r.result, given);
            answerHtml = a.answer && a.citations.length
                ? `<div style="border:1px solid var(--line);border-radius:10px;padding:10px 14px;margin-bottom:12px;"><div class="bold tiny uppercase muted" style="margin-bottom:4px;">Answer from your notes</div><div style="font-size:13px;line-height:1.5;">${esc(a.answer)}</div><div class="tiny muted" style="margin-top:4px;">Based on ${a.citations.length} note${a.citations.length === 1 ? '' : 's'}, marked below.</div></div>`
                : '<div class="tiny muted" style="margin-bottom:10px;">The notes do not clearly answer that. The closest matches are below.</div>';
            OL._nsCited = new Set(a.citations);
        }
    }
    const cited = OL._nsCited || new Set(); OL._nsCited = null;
    out.className = ''; out.style.color = '';
    out.innerHTML = answerHtml + hits.map((h) => `<div style="padding:8px 0;border-bottom:1px solid var(--line);">
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;"><b style="font-size:12px;">${esc(nameOf(h.note.client_id))}</b>
            <span class="tiny muted">${esc(String(h.note.created_at || '').slice(0, 10))}${h.note.author ? ` · ${esc(h.note.author)}` : ''} · ${esc(h.note.type || 'note')}</span>
            ${cited.has(h.note.id) ? '<span class="pill tiny" style="background:rgba(45,212,191,.14);color:#2dd4bf;border:1px solid transparent;cursor:default;">Used in the answer</span>' : ''}
            ${h.note.source_url ? `<a class="tiny" href="${esc(h.note.source_url)}" target="_blank" rel="noopener">Source</a>` : ''}</div>
        <div style="font-size:13px;margin-top:2px;">${esc(snippet(h.note.body, q))}</div></div>`).join('');
};

// ---- Graduation ---------------------------------------------------------------------------------------------------
// Shown inside "See the numbers".
OL.aiGraduationFill = async function () {
    const host = el('ai-grad'); if (!host) return;
    let rows = [];
    try { const { data } = await db.from('suggestion_log').select('suggestion_type,confidence,status').eq('source_kind', 'gmail_message').limit(5000); rows = data || []; } catch (_) { /* skip */ }
    const grad = getOlSettings().aiGraduated || {};
    const line = (t) => {
        const e = eligibility(rows, t), g = grad[t];
        return `<tr><td>${esc(t)}</td><td>${e.decided}</td><td>${e.rate ?? ''}${e.rate !== null ? '%' : ''}</td>
            <td>${g ? `Linking by itself (approved by ${esc(g.by)}) <button class="btn tiny soft" onclick="OL.aiGraduate('${t}', false)">Turn off</button>`
                : e.eligible ? (isAdmin() ? `<button class="btn tiny primary" onclick="OL.aiGraduate('${t}', true)">Approve linking by itself</button>` : 'Ready, needs an admin to approve')
                : `<span class="muted">Needs ${esc(e.needs)}</span>`}</td></tr>`;
    };
    host.innerHTML = `<div style="margin-top:14px;font-weight:600;font-size:13px;">Linking by itself</div>
        <div class="tiny muted" style="margin:2px 0 4px;">A type can link emails without a click only after ${GRAD_MIN_DECIDED} decided high-confidence suggestions with ${GRAD_MIN_RATE}% or more accepted unchanged, and an admin approves. Only high-confidence matches with a real target link, each is logged, and you can undo it.</div>
        <table class="tiny" style="width:100%;border-collapse:collapse;"><thead><tr style="text-align:left;"><th>Type</th><th>Decided (high)</th><th>Accepted unchanged</th><th></th></tr></thead><tbody>${GRAD_TYPES.map(line).join('')}</tbody></table>`;
};
OL.aiGraduate = function (type, on) {
    if (!isAdmin()) return;
    if (on && !confirm(`Let "${type}" suggestions that are high confidence and matched to an item link by themselves? Each one is logged and can be undone.`)) return;
    const cur = state.master?.olSettings || {}, g = { ...(cur.aiGraduated || {}) };
    if (on) g[type] = { by: getCurrentUserName?.() || 'admin', at: new Date().toISOString() }; else delete g[type];
    updateAndSync(() => { state.master.olSettings = { ...cur, aiGraduated: g }; });
    setTimeout(() => OL.aiGraduationFill(), 300);
};

// An opened client email: approved types link their high-confidence matches themselves, shown with an Undo.
const doneAuto = new Set();
OL.aiAutoLink = async function (m) {
    const settings = getOlSettings();
    if (!m || doneAuto.has(m.id) || !m.linked_client_id || featureMode('email') !== 'suggest' || !Object.keys(settings.aiGraduated || {}).length) return;
    doneAuto.add(m.id);
    const ours = (OL.senderEmails ? OL.senderEmails() : []).some((e) => String(m.sender || '').toLowerCase().includes(String(e).toLowerCase()));
    if (ours) return;
    const text = cleanEmailBody((OL._stripHtmlForPreview ? OL._stripHtmlForPreview(m.body || m.snippet || '') : String(m.body || m.snippet || '')));
    if (!text) return;
    const items = OL._openItemsForClassification ? OL._openItemsForClassification(m.linked_client_id) : [];
    const known = new Map(items.map((i) => [String(i.id), i]));
    const r = await runAi('email_classify', { text, items, flagged: (m.suggestions || []).map((s) => s.text) }, { clientId: m.linked_client_id, sourceKind: 'gmail_message', sourceId: m.id });
    if (!r.ok || r.shadow) return;
    const made = [];
    for (const s of (r.result?.suggestions || []).slice(0, 8)) {
        const t = s.targetId && known.get(String(s.targetId));
        const type = ['change', 'approval', 'new_request', 'note'].includes(s.suggestedType) ? s.suggestedType : 'new_request';
        if (!t || s.restatesFlagged || !quoteExists(s.quote, text) || !mayAutoLink(settings, { type, confidence: s.confidence, target: t })) continue;
        const linkId = 'pl-' + uid();
        const { data: row } = await db.from('gmail_messages').select('piece_links').eq('id', m.id).single();
        const links = Array.isArray(row?.piece_links) ? row.piece_links.slice() : [];
        links.push({ id: linkId, kind: 'excerpt', text: s.quote, note: 'Linked automatically', targetType: t.type, targetId: t.id, targetLabel: t.label, createdAt: new Date().toISOString(), auto: true });
        const { error } = await db.from('gmail_messages').update({ piece_links: links }).eq('id', m.id);
        if (error) continue;
        const logId = await logSuggestion({ clientId: m.linked_client_id, sourceKind: 'gmail_message', sourceId: m.id, type, quote: s.quote, targetKind: t.type, targetId: t.id, confidence: 'high', secretsRemoved: r.secretsRemoved });
        if (logId) recordOutcome(logId, 'accepted', { decidedBy: 'auto' });
        made.push({ linkId, logId, quote: s.quote, label: t.label });
    }
    const host = el('gmail-ai-cards');
    if (host && made.length) host.insertAdjacentHTML('afterbegin', made.map((x) => `<div id="auto-${esc(x.linkId)}" style="border:1px solid #2dd4bf;border-radius:10px;padding:8px 12px;font-size:12px;display:flex;gap:8px;align-items:center;">
        <div style="flex:1;min-width:0;"><b>Linked automatically</b> to ${esc(x.label)}<div class="muted" style="font-style:italic;">"${esc(x.quote)}"</div></div>
        <button class="btn tiny soft" onclick="OL.aiUndoAutoLink('${esc(m.id)}','${esc(x.linkId)}','${esc(x.logId || '')}')">Undo</button></div>`).join(''));
};
OL.aiUndoAutoLink = async function (messageId, linkId, logId) {
    const { data: row } = await db.from('gmail_messages').select('piece_links').eq('id', messageId).single();
    const links = (row?.piece_links || []).filter((l) => l.id !== linkId);
    const { error } = await db.from('gmail_messages').update({ piece_links: links }).eq('id', messageId);
    if (error) { alert('Could not undo that.'); return; }
    if (logId) recordOutcome(logId, 'dismissed', { decidedBy: getCurrentUserName?.() });   // an undone auto-link counts against its accuracy
    el('auto-' + linkId)?.remove();
};
