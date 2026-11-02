//======================= FEATURES / CLIENT REVIEW =======================//
// The panel at the top of the client task tab:
//   - Pending client review: reviews that were sent and are waiting on the client, with Approved and Change requested
//   - Recently closed: tasks closed in the last 7 days (up to 10), so a late change does not mean switching the filter
//   - Send for review: choose what goes to the client (closing a task only means "my work is done")
//
// The rules and data are in core/reviews.js and core/status-moves.js. Tasks keep their own status: Approved is a
// closed status of its own (see OL.getSystemStatuses), Change requested moves the task back to Pending Sphynx Action
// after the move-back prompt, and "pending client review" is worked out from a sent review, not stored on the task.

import { state, esc, uid, updateAndSync, getCurrentUserName } from '../core/data.js';
import { isTaskClosed } from '../core/work-status.js';
import {
    buildReview, markSent, decideItem, approveAll, followUpOwnerFor, daysSince, saveReview, loadReviews,
} from '../core/reviews.js';
import { saveNote } from '../core/captures.js';
import { SCOPING_OUTCOMES, isPreClient } from '../core/lead-rules.js';

const RECENT_DAYS = 7;
const RECENT_MAX = 10;
const cache = {};          // clientId -> { reviews, itemsByReview, loaded }
let dlg = null;            // the Send for review dialog's state

const closedNames = () => {
    const names = (OL.getSystemStatuses ? OL.getSystemStatuses() : []).filter((s) => s.isClosed).map((s) => s.name);
    return names.length ? names : ['Done'];
};
const clientOf = (id) => state.clients?.[id];
const taskOf = (client, id) => (client?.projectData?.clientTasks || []).find((t) => String(t.id) === String(id));
const dayLabel = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};
const titleOf = (t) => t?.title || t?.name || 'Untitled task';

// Tasks that are done and Sphynx's own, newest first.
function closedTasks(client) {
    const names = closedNames();
    return (client?.projectData?.clientTasks || [])
        .filter((t) => t && !t.consolidatedFollowUp && isTaskClosed(t, names))
        .sort((a, b) => String(b.completedAt || '').localeCompare(String(a.completedAt || '')));
}

// The review (if any) that a task is in, with that item's outcome. Latest review wins.
function reviewStateOf(clientId, taskId) {
    const c = cache[clientId];
    if (!c) return null;
    for (const r of c.reviews) {
        const it = (c.itemsByReview[r.id] || []).find((i) => i.item_type === 'task' && String(i.item_id) === String(taskId));
        if (it) return { review: r, item: it };
    }
    return null;
}

const chip = (text, color) => `<span class="pill tiny" style="background:${color}22;color:${color};border:1px solid transparent;cursor:default;">${esc(text)}</span>`;

function recentRowHtml(client, t) {
    const rs = reviewStateOf(client.id, t.id);
    let state_ = '';
    if (t.status === 'Approved' || rs?.item?.outcome === 'approved') state_ = chip('Approved', '#22c55e');
    else if (rs?.review?.status === 'sent' && rs.item.outcome === 'pending') state_ = chip('Pending client review', '#a78bfa');
    return `
    <div style="display:flex;gap:12px;align-items:center;padding:8px 0;border-bottom:1px solid var(--line);">
        <i data-lucide="circle-check" style="width:15px;height:15px;color:#299764;flex:none;"></i>
        <div style="flex:1;min-width:0;"><div style="font-weight:600;font-size:13px;overflow-wrap:anywhere;">${esc(titleOf(t))}</div>
            <div class="tiny muted">Closed ${esc(dayLabel(t.completedAt) || 'recently')}${t.assignee ? ` · ${esc(t.assignee)}` : ''}</div></div>
        ${state_}
        <button class="btn tiny soft" onclick="OL.crAddFollowUp('${esc(client.id)}','${esc(String(t.id))}')" style="display:inline-flex;gap:5px;align-items:center;"><i data-lucide="plus" style="width:12px;height:12px;"></i>Add follow-up task</button>
        ${window.OL?.aiHistoryButtonHtml?.(client.id, t.id) || ''}
        <button class="btn tiny soft" onclick="OL.crReopen('${esc(client.id)}','${esc(String(t.id))}')" style="display:inline-flex;gap:5px;align-items:center;"><i data-lucide="undo-2" style="width:12px;height:12px;"></i>Reopen</button>
    </div>`;
}

function pendingReviewHtml(client) {
    const c = cache[client.id];
    const sent = (c?.reviews || []).filter((r) => r.status === 'sent' || r.status === 'change_requested');
    const blocks = sent.map((r) => {
        const items = (c.itemsByReview[r.id] || []);
        const open = items.filter((i) => i.outcome === 'pending');
        if (!open.length && r.status !== 'change_requested') return '';
        const rows = items.map((i) => {
            const t = i.item_type === 'task' ? taskOf(client, i.item_id) : null;
            const name = t ? titleOf(t) : `${i.item_type} ${i.item_id}`;
            const right = i.outcome === 'pending'
                ? `<button class="btn tiny primary" onclick="OL.crDecide('${esc(client.id)}','${esc(r.id)}','${esc(i.id)}','approved')">Approved</button>
                   <button class="btn tiny soft" onclick="OL.crDecide('${esc(client.id)}','${esc(r.id)}','${esc(i.id)}','change_requested')">Change requested</button>`
                : chip(i.outcome === 'approved' ? 'Approved' : 'Change requested', i.outcome === 'approved' ? '#22c55e' : '#f5b942');
            return `<div style="display:flex;gap:10px;align-items:center;padding:6px 0;border-bottom:1px solid var(--line);">
                <div style="flex:1;min-width:0;font-size:13px;overflow-wrap:anywhere;">${esc(name)}</div>${right}</div>`;
        }).join('');
        const day = daysSince(r.sent_at);
        return `<div style="border:1px solid var(--line);border-radius:10px;padding:10px 14px;margin-bottom:10px;">
            <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:4px;">
                <b style="font-size:13px;">Sent ${esc(dayLabel(r.sent_at))}${r.sent_by ? ` by ${esc(r.sent_by)}` : ''}</b>
                ${day !== null ? chip(`Day ${day}`, '#a78bfa') : ''}
                ${r.sent_outside_ol ? chip('Sent outside OL', '#9aa7bd') : ''}
                <span class="tiny muted">Follow-up: ${esc(r.follow_up_owner || 'not set')}</span>
                ${open.length > 1 ? `<button class="btn tiny soft" style="margin-left:auto;" onclick="OL.crApproveAll('${esc(client.id)}','${esc(r.id)}')">Approve all</button>` : ''}
            </div>${rows}</div>`;
    }).join('');
    if (!blocks.trim()) return '';
    return `<div style="margin-bottom:16px;">
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;"><i data-lucide="send" style="width:15px;height:15px;color:#a78bfa;"></i><b style="font-size:14px;">Pending client review</b></div>${blocks}</div>`;
}

// Shown only while a project is still in Discovery: the lead tasks, and the outcome of an intro call.
function leadStripHtml(client) {
    if (!isPreClient(client)) return '';
    const names = closedNames();
    const tasks = client.projectData?.clientTasks || [];
    const has = (kind) => tasks.some((t) => t && t.leadTaskKind === kind && !isTaskClosed(t, names));
    const intro = tasks.find((t) => t && t.introCallEventId && !isTaskClosed(t, names) && !t.scopingOutcome);
    const btn = (kind, label, icon) => `<button class="btn tiny soft" ${has(kind) ? 'disabled title="Already open"' : ''} onclick="OL.crLeadTask('${esc(client.id)}','${kind}')" style="display:inline-flex;gap:5px;align-items:center;"><i data-lucide="${icon}" style="width:12px;height:12px;"></i>${label}</button>`;
    const outcome = intro ? `
        <select class="modal-input tiny" style="width:auto;" onchange="OL.crIntroOutcome('${esc(client.id)}','${esc(String(intro.id))}', this.value)">
            <option value="">Intro call outcome...</option>${SCOPING_OUTCOMES.map((o) => `<option value="${o.key}">${esc(o.label)}</option>`).join('')}
        </select>` : '';
    return `<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid var(--line);">
        <i data-lucide="user-plus" style="width:15px;height:15px;color:var(--accent);"></i><b style="font-size:14px;">Lead</b>
        <span class="tiny muted">Still in Discovery. A task is the record of what is owed.</span>
        <span style="margin-left:auto;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">${outcome}${btn('prepare_quote', 'Prepare quote', 'file-text')}${btn('offer_paid_scoping', 'Offer paid scoping', 'search')}</span></div>`;
}

export function crLeadTask(clientId, kind) {
    updateAndSync(() => { OL.createLeadTaskFor?.(clientId, kind); }, clientId);
    window.renderClientTaskManager?.();
}

// Records what the intro call led to and creates the matching lead task.
export function crIntroOutcome(clientId, taskId, key) {
    const o = SCOPING_OUTCOMES.find((x) => x.key === key);
    if (!o) return;
    updateAndSync(() => {
        const t = taskOf(clientOf(clientId), taskId);
        if (t) { t.scopingOutcome = o.key; t.scopingOutcomeAt = new Date().toISOString(); }
        if (o.task) OL.createLeadTaskFor?.(clientId, o.task);
    }, clientId);
    window.renderClientTaskManager?.();
}

export function clientReviewPanelHtml(client) {
    if (!client) return '';
    const now = new Date();
    const recent = closedTasks(client).filter((t) => (daysSince(t.completedAt, now) ?? 0) <= RECENT_DAYS || !t.completedAt).slice(0, RECENT_MAX);
    const sendable = sendableTasks(client);
    return `
    <div class="card" style="padding:16px 20px;margin-bottom:20px;">
        ${window.OL?.aiClientToolsHtml?.(client) || ''}
        ${leadStripHtml(client)}
        ${pendingReviewHtml(client)}
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;">
            <i data-lucide="history" style="width:15px;height:15px;color:var(--accent);"></i><b style="font-size:14px;">Recently closed</b>
            <span class="tiny muted">last ${RECENT_DAYS} days</span>
            <button class="btn tiny primary" style="margin-left:auto;display:inline-flex;gap:6px;align-items:center;" ${sendable.length ? '' : 'disabled'}
                    onclick="OL.crOpenSend('${esc(client.id)}')"><i data-lucide="send" style="width:13px;height:13px;"></i>Send for review${sendable.length ? ` (${sendable.length})` : ''}</button>
        </div>
        ${recent.length ? recent.map((t) => recentRowHtml(client, t)).join('') : '<div class="tiny muted" style="padding:8px 0;">Nothing closed in the last week.</div>'}
    </div>`;
}

// Loads this project's reviews, then repaints just the panel.
export async function loadClientReviewPanel(clientId, force) {
    if (cache[clientId]?.loaded && !force) return;     // already loaded; actions keep the cache current
    const data = await loadReviews(clientId);
    cache[clientId] = { ...data, loaded: true };
    paintPanel(clientId);
}

function paintPanel(clientId) {
    const el = document.getElementById('client-review-panel');
    const client = clientOf(clientId);
    if (!el || !client || state.activeClientId !== clientId) return;
    el.innerHTML = clientReviewPanelHtml(client);
    if (window.lucide) window.lucide.createIcons();
}

// ---- add follow-up / reopen -------------------------------------------------------------------------------------
export function crAddFollowUp(clientId, taskId) {
    const title = prompt('Follow-up task title:', `Follow-up: ${titleOf(taskOf(clientOf(clientId), taskId))}`);
    if (!title || !title.trim()) return;
    updateAndSync(() => {
        const client = clientOf(clientId);
        const src = taskOf(client, taskId);
        if (!client || !src) return;
        const t = {
            id: uid(), title: title.trim(), name: title.trim(), status: 'Pending Sphynx Action', assignee: src.assignee || 'Sphynx Task',
            dueDate: '', isClientTask: false, loggedHours: 0, createdAt: new Date().toISOString(),
            links: JSON.parse(JSON.stringify(src.links || [])),       // same request and resources as the task it follows
        };
        (client.projectData.clientTasks = client.projectData.clientTasks || []).unshift(t);
    }, clientId);
    window.renderClientTaskManager?.();
}

export function crReopen(clientId, taskId) {
    const client = clientOf(clientId);
    const t = taskOf(client, taskId);
    if (!t) return;
    OL.openBackwardMovePrompt({
        clientId, itemType: 'task', itemId: taskId, itemName: titleOf(t), fromStatus: t.status, toStatus: 'Pending Sphynx Action',
        onSaved: (move) => reopenTask(clientId, taskId, move),
    });
}

function reopenTask(clientId, taskId, move) {
    updateAndSync(() => {
        const t = taskOf(clientOf(clientId), taskId);
        if (!t) return;
        t.status = 'Pending Sphynx Action'; t.completedAt = ''; delete t.approvedAt;
    }, clientId);
    // Keep the reason with the task, and take it out of any review that is still waiting on the client.
    saveNote({ clientId, taskId, author: getCurrentUserName(), type: 'system', visibility: 'team', sourceKind: 'manual',
               body: `Moved back: ${move.what || ''} (${String(move.why_category || '').replace(/_/g, ' ')}${move.pattern_tag ? `, ${move.pattern_tag}` : ''})` });
    window.renderClientTaskManager?.();
}

// ---- deciding on a review -------------------------------------------------------------------------------------
async function applyDecision(clientId, reviewId, itemId, outcome) {
    const c = cache[clientId];
    const review = c?.reviews.find((r) => r.id === reviewId);
    if (!review) return;
    const { review: nextReview, items } = decideItem(review, c.itemsByReview[reviewId] || [], itemId, outcome);
    c.reviews = c.reviews.map((r) => (r.id === reviewId ? nextReview : r));
    c.itemsByReview[reviewId] = items;
    await saveReview(nextReview, items.filter((i) => i.id === itemId));
    paintPanel(clientId);
}

export function crDecide(clientId, reviewId, itemId, outcome) {
    const c = cache[clientId];
    const item = (c?.itemsByReview[reviewId] || []).find((i) => i.id === itemId);
    if (!item) return;
    const client = clientOf(clientId);
    const t = item.item_type === 'task' ? taskOf(client, item.item_id) : null;
    if (outcome === 'approved') {
        if (t) updateAndSync(() => { const x = taskOf(clientOf(clientId), t.id); if (x) { x.status = 'Approved'; x.approvedAt = new Date().toISOString(); } }, clientId);
        applyDecision(clientId, reviewId, itemId, 'approved');
        window.renderClientTaskManager?.();
        return;
    }
    // Change requested: ask what and why, move it back, and keep the reason on the task.
    OL.openBackwardMovePrompt({
        clientId, itemType: item.item_type, itemId: item.item_id, itemName: t ? titleOf(t) : `${item.item_type} ${item.item_id}`,
        fromStatus: 'Pending client review', toStatus: 'Pending Sphynx Action', prefill: { whyCategory: 'asking_for_more' },
        onSaved: (move) => {
            if (t) reopenTask(clientId, t.id, move);
            applyDecision(clientId, reviewId, itemId, 'change_requested');
        },
    });
}

export async function crApproveAll(clientId, reviewId) {
    const c = cache[clientId];
    const review = c?.reviews.find((r) => r.id === reviewId);
    if (!review) return;
    const { review: nextReview, items } = approveAll(review, c.itemsByReview[reviewId] || []);
    updateAndSync(() => {
        const client = clientOf(clientId);
        items.filter((i) => i.item_type === 'task' && i.outcome === 'approved').forEach((i) => {
            const x = taskOf(client, i.item_id);
            if (x && x.status !== 'Approved') { x.status = 'Approved'; x.approvedAt = new Date().toISOString(); }
        });
    }, clientId);
    c.reviews = c.reviews.map((r) => (r.id === reviewId ? nextReview : r));
    c.itemsByReview[reviewId] = items;
    await saveReview(nextReview, items);
    window.renderClientTaskManager?.();
}

// ---- Send for review ------------------------------------------------------------------------------------------
// Closed tasks that are not already waiting on, or approved by, the client.
function sendableTasks(client) {
    const c = cache[client.id];
    const inReview = new Set();
    (c?.reviews || []).forEach((r) => { if (r.status !== 'draft') (c.itemsByReview[r.id] || []).forEach((i) => { if (i.outcome !== 'change_requested') inReview.add(`${i.item_type}:${i.item_id}`); }); });
    return closedTasks(client).filter((t) => t.status !== 'Approved' && !t.approvedAt && !inReview.has(`task:${t.id}`));
}

function paintSend() {
    const client = clientOf(dlg.clientId);
    const list = sendableTasks(client);
    const owner = followUpOwnerFor(client, state.master?.roles || [], '');
    const rows = list.map((t) => `
        <label style="display:flex;gap:10px;align-items:center;padding:8px 0;border-bottom:1px solid var(--line);cursor:pointer;">
            <input type="checkbox" ${dlg.picked.has(String(t.id)) ? 'checked' : ''} onchange="OL.crTogglePick('${esc(String(t.id))}')">
            <span style="flex:1;font-size:13px;overflow-wrap:anywhere;">${esc(titleOf(t))}</span>
            <span class="tiny muted">Closed ${esc(dayLabel(t.completedAt) || 'recently')}</span>
        </label>`).join('');
    const html = `
    <div class="modal-head"><div class="modal-title-text"><i data-lucide="send" style="width:16px;height:16px;vertical-align:sub;margin-right:6px;"></i>Send for review: ${esc(client.meta?.name || '')}</div>
        <button class="btn small soft" onclick="OL.closeModal()">✕</button></div>
    <div class="modal-body" style="width:100%;box-sizing:border-box;">
        <div style="display:flex;gap:24px;align-items:flex-start;">
            <div style="flex:1.3;min-width:0;">
                <label class="tiny bold uppercase muted" style="display:block;margin-bottom:6px;">What goes to the client</label>
                ${rows || '<div class="tiny muted">There is nothing closed that has not already been sent.</div>'}
            </div>
            <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:12px;">
                <div><label class="tiny bold uppercase muted" style="display:block;margin-bottom:6px;">Note for the review (optional)</label>
                    <textarea class="modal-input" rows="4" style="width:100%;box-sizing:border-box;" oninput="OL.crSetSummary(this.value)">${esc(dlg.summary)}</textarea></div>
                <label style="display:flex;gap:8px;align-items:flex-start;font-size:13px;cursor:pointer;">
                    <input type="checkbox" ${dlg.outside ? 'checked' : ''} onchange="OL.crSetOutside(this.checked)">
                    <span>I already sent this request by email. Only record it here.</span></label>
                <div class="tiny muted">Sent by ${esc(getCurrentUserName())}. Follow-up with the client stays with ${esc(owner || 'the Communications role (none assigned on this project)')}, whoever sends it.</div>
            </div>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px;">
            <button class="btn soft" onclick="OL.closeModal()">Cancel</button>
            <button class="btn primary" ${dlg.picked.size ? '' : 'disabled'} onclick="OL.crSend()">Mark ${dlg.picked.size} as sent for review</button>
        </div>
    </div>`;
    if (document.querySelector('.modal-box.modal-wide')) document.querySelector('.modal-box.modal-wide').innerHTML = html;
    else OL.showOverlayModal(html, { wide: true });
    if (window.lucide) window.lucide.createIcons();
}

export function crOpenSend(clientId) {
    const client = clientOf(clientId);
    const list = sendableTasks(client);
    // Start with everything closed in the last week ticked; older ones are there to add by hand.
    const picked = new Set(list.filter((t) => (daysSince(t.completedAt) ?? 0) <= RECENT_DAYS).map((t) => String(t.id)));
    dlg = { clientId, picked, summary: '', outside: false };
    paintSend();
}
export function crTogglePick(id) { if (!dlg) return; dlg.picked.has(id) ? dlg.picked.delete(id) : dlg.picked.add(id); paintSend(); }
export function crSetSummary(v) { if (dlg) dlg.summary = v; }
export function crSetOutside(v) { if (dlg) dlg.outside = !!v; }

export async function crSend() {
    if (!dlg || !dlg.picked.size) return;
    const { clientId } = dlg;
    const client = clientOf(clientId);
    const owner = followUpOwnerFor(client, state.master?.roles || [], '');
    const built = buildReview({
        clientId, sentBy: getCurrentUserName(), followUpOwner: owner, summary: dlg.summary.trim(),
        items: [...dlg.picked].map((id) => ({ type: 'task', id })),
    });
    const review = markSent(built.review, { outsideOl: dlg.outside });
    const ok = await saveReview(review, built.items);
    dlg = null;
    OL.closeModal();
    if (!ok) { alert('The review could not be saved. Run the Step 1 database migration first, then try again.'); return; }
    const c = cache[clientId] || (cache[clientId] = { reviews: [], itemsByReview: {}, loaded: true });
    c.reviews = [review, ...c.reviews];
    c.itemsByReview[review.id] = built.items;
    paintPanel(clientId);
}

window.OL = window.OL || {};
Object.assign(window.OL, {
    clientReviewPanelHtml, loadClientReviewPanel,
    crLeadTask, crIntroOutcome, crAddFollowUp, crReopen, crDecide, crApproveAll, crOpenSend, crTogglePick, crSetSummary, crSetOutside, crSend,
});
