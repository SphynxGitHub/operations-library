//======================= FEATURES / TIME AND BILLING =======================//
// Screens and hooks for core/time-billing.js:
//   - a bucket (billable, included allowance, rework, goodwill, needs review) on every time entry, changeable from the
//     task's Time Log, with edits kept in an audit trail
//   - the tweak allowance meter for the current round, shown beside "Logged" on the client task tab
//   - the welcome-back prompt for a timer that was left running (keep all, trim to the last activity, or trim to a time)
//
// It adds to the existing timer and Time Log (features/business/tasks.js) without replacing them.

import { state, esc, updateAndSync, getCurrentUserName } from '../core/data.js';
import { roundStatusOf } from '../core/requests.js';
import { getRequestPriceBreakdown } from './scoping.js';
import {
    BUCKETS, totalsByBucket, tweakAllowanceHours, allowanceExpiry, allowanceStatus, editEntry, confirmEntry,
    timerNeedsWelcomeBack, clampEnd, timerEntry,
} from '../core/time-billing.js';

const ACTIVITY_KEY = 'ol_last_activity';
const fmtDur = (m) => { const a = Math.abs(Math.round(m)); const h = Math.floor(a / 60), mm = a % 60; return h ? `${h}h ${String(mm).padStart(2, '0')}m` : `${mm}m`; };
const bucketOf = (k) => BUCKETS.find((b) => b.key === k);

function findTask(taskId) {
    for (const client of Object.values(state.clients || {})) {
        const task = (client?.projectData?.clientTasks || []).find((t) => t && String(t.id) === String(taskId));
        if (task) return { client, task };
    }
    return { client: null, task: null };
}

// ---- carry the bucket on new entries ------------------------------------------------------------------------------
function wrapRecordEntry() {
    const original = OL.recordTaskTimeEntry;
    if (typeof original !== 'function' || original._tb) return;
    OL.recordTaskTimeEntry = function (task, hours, meta = {}) {
        const before = Array.isArray(task?.timeLog) ? task.timeLog.length : 0;
        original.call(this, task, hours, meta);
        const entry = task?.timeLog?.[before];
        if (entry && Array.isArray(task.timeLog) && task.timeLog.length > before) {
            if (meta.bucket) entry.bucket = meta.bucket;
            if (meta.needsReview) { entry.needsReview = true; entry.bucket = 'needs_review'; }
        }
    };
    OL.recordTaskTimeEntry._tb = true;
}

// ---- the bucket panel under the Time Log --------------------------------------------------------------------------
function bucketPanelHtml(task) {
    const entries = Array.isArray(task?.timeLog) ? task.timeLog.slice().sort((a, b) => new Date(b.end || b.start || 0) - new Date(a.end || a.start || 0)) : [];
    if (!entries.length) return '';
    const totals = totalsByBucket(entries);
    const pills = BUCKETS.filter((b) => totals[b.key] > 0)
        .map((b) => `<span class="pill tiny" style="background:${b.color}22;color:${b.color};border:1px solid transparent;cursor:default;">${esc(b.label)} ${fmtDur(totals[b.key])}</span>`).join('');
    const unassigned = totals.unassigned > 0 ? `<span class="pill tiny soft" style="cursor:default;">No bucket ${fmtDur(totals.unassigned)}</span>` : '';
    const rows = entries.map((e) => {
        const key = e.needsReview ? 'needs_review' : (e.bucket || '');
        const opts = `<option value="">No bucket</option>` + BUCKETS.map((b) => `<option value="${b.key}" ${key === b.key ? 'selected' : ''}>${esc(b.label)}</option>`).join('');
        const day = e.end || e.start ? new Date(e.end || e.start).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
        return `<div style="display:flex;gap:8px;align-items:center;padding:5px 0;border-top:1px solid var(--line);">
            <span class="tiny muted" style="width:52px;">${esc(day)}</span>
            <span class="tiny" style="width:64px;font-weight:600;">${fmtDur(e.minutes)}</span>
            <select class="modal-input tiny" style="width:190px;" onchange="OL.tbSetBucket('${esc(String(task.id))}','${esc(String(e.id))}', this.value)">${opts}</select>
            <span class="tiny muted" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(e.note || '')}</span>
            ${Array.isArray(e.audit) && e.audit.length ? `<span class="pill tiny soft" title="${esc(e.audit.map((a) => `${a.by || ''}: ${a.field} ${a.from} → ${a.to}${a.reason ? ` (${a.reason})` : ''}`).join('\n'))}" style="cursor:default;">Edited</span>` : ''}
            ${e.needsReview ? `<button class="btn tiny soft" onclick="OL.tbConfirm('${esc(String(task.id))}','${esc(String(e.id))}')">Confirm as billable</button>` : ''}
            <button class="btn tiny soft" onclick="OL.tbOpenEdit('${esc(String(task.id))}','${esc(String(e.id))}')">Edit</button>
        </div>`;
    }).join('');
    return `<div style="margin-bottom:20px;background:rgba(255,255,255,0.02);padding:14px;border-radius:6px;border:1px solid var(--line);">
        <label class="bold tiny uppercase muted" style="display:block;margin-bottom:8px;"><i data-lucide="split" style="width:12px;height:12px;vertical-align:sub;"></i> Where the time belongs</label>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;">${pills}${unassigned}</div>${rows}
        <div class="tiny muted" style="margin-top:8px;">Time marked "Needs review" stays out of billable totals until you confirm it. Every change is kept in the entry's history.</div>
    </div>`;
}

function wrapTimeLogHtml() {
    const original = OL.renderTaskTimeLogHTML;
    if (typeof original !== 'function' || original._tb) return;
    OL.renderTaskTimeLogHTML = function (task) { return original.call(this, task) + bucketPanelHtml(task); };
    OL.renderTaskTimeLogHTML._tb = true;
}

function saveEdit(taskId, entryId, changes) {
    const { client, task } = findTask(taskId);
    if (!task) return;
    updateAndSync(() => {
        const entry = (task.timeLog || []).find((e) => String(e.id) === String(entryId));
        if (!entry) return;
        const before = Number(entry.minutes) || 0;
        editEntry(entry, changes, getCurrentUserName());
        const delta = (Number(entry.minutes) || 0) - before;
        if (delta) { task.loggedHours = Math.max(0, (Number(task.loggedHours || task.hoursLogged || 0)) + delta / 60); task.hoursLogged = task.loggedHours; }
    }, client?.id);
    OL.refreshTaskView?.();
    if (document.getElementById('active-modal-box') && changes.minutes === undefined) OL.openTaskInContext?.(client?.id, taskId);
}

export function tbSetBucket(taskId, entryId, bucket) { saveEdit(taskId, entryId, { bucket, reason: 'Bucket changed' }); }
export function tbConfirm(taskId, entryId) {
    const { client, task } = findTask(taskId);
    const entry = (task?.timeLog || []).find((e) => String(e.id) === String(entryId));
    if (!entry) return;
    updateAndSync(() => { confirmEntry(entry, 'billable', getCurrentUserName()); }, client?.id);
    OL.refreshTaskView?.();
}

export function tbOpenEdit(taskId, entryId) {
    const { task } = findTask(taskId);
    const e = (task?.timeLog || []).find((x) => String(x.id) === String(entryId));
    if (!e) return;
    const html = `
    <div class="modal-head"><div class="modal-title-text"><i data-lucide="pencil" style="width:16px;height:16px;vertical-align:sub;margin-right:6px;"></i>Edit time entry</div>
        <button class="btn small soft" onclick="OL.closeModal()">✕</button></div>
    <div class="modal-body" style="width:100%;box-sizing:border-box;">
        <div style="display:flex;gap:24px;align-items:flex-start;">
            <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:12px;">
                <div><label class="tiny bold uppercase muted" style="display:block;margin-bottom:6px;">Minutes</label>
                    <input id="tb-min" type="number" min="0" class="modal-input" style="width:100%;box-sizing:border-box;" value="${Number(e.minutes) || 0}"></div>
                <div><label class="tiny bold uppercase muted" style="display:block;margin-bottom:6px;">Bucket</label>
                    <select id="tb-bucket" class="modal-input" style="width:100%;box-sizing:border-box;"><option value="">No bucket</option>${BUCKETS.map((b) => `<option value="${b.key}" ${(e.needsReview ? 'needs_review' : e.bucket) === b.key ? 'selected' : ''}>${esc(b.label)}</option>`).join('')}</select></div>
            </div>
            <div style="flex:1.2;min-width:0;display:flex;flex-direction:column;gap:12px;">
                <div><label class="tiny bold uppercase muted" style="display:block;margin-bottom:6px;">Note</label>
                    <input id="tb-note" class="modal-input" style="width:100%;box-sizing:border-box;" value="${esc(e.note || '')}"></div>
                <div><label class="tiny bold uppercase muted" style="display:block;margin-bottom:6px;">Reason for the change (kept in the history)</label>
                    <textarea id="tb-reason" class="modal-input" rows="3" style="width:100%;box-sizing:border-box;" placeholder="e.g. Timer ran past the end of the day"></textarea></div>
            </div>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px;">
            <button class="btn soft" onclick="OL.closeModal()">Cancel</button>
            <button class="btn primary" onclick="OL.tbSaveEdit('${esc(String(taskId))}','${esc(String(entryId))}')">Save</button>
        </div>
    </div>`;
    OL.showOverlayModal(html, { wide: true });
    if (window.lucide) window.lucide.createIcons();
}

export function tbSaveEdit(taskId, entryId) {
    saveEdit(taskId, entryId, {
        minutes: Number(document.getElementById('tb-min')?.value) || 0, bucket: document.getElementById('tb-bucket')?.value ?? '',
        note: document.getElementById('tb-note')?.value ?? '', reason: document.getElementById('tb-reason')?.value || '',
    });
    OL.closeModal?.();
}

// ---- the tweak allowance meter ------------------------------------------------------------------------------------
// The current round is the highest numbered round that is Approved. Its fee comes from the same pricing the scoping
// sheet uses, so it only works for the project that is open on screen.
function currentAllowance(client) {
    try {
        let best = null;
        (client?.projectData?.scopingSheets || []).forEach((sheet) => {
            if (!sheet || sheet.kind === 'maintenance' || sheet.id === 'maintenance') return;
            const rounds = new Set((sheet.lineItems || []).filter((i) => i && i.round !== undefined && i.round !== null && i.round !== '').map((i) => String(i.round)));
            rounds.forEach((r) => {
                if (roundStatusOf(sheet, r) !== 'Approved') return;
                if (!best || Number(r) > Number(best.round)) best = { sheet, round: r };
            });
        });
        if (!best) return null;
        const items = (best.sheet.lineItems || []).filter((i) => i && String(i.round) === best.round && i.status === 'Do Now');
        const fee = items.reduce((sum, i) => sum + (Number(getRequestPriceBreakdown(i)?.gross) || 0), 0);
        const rate = client.projectData.customBaseRate || state.master?.rates?.baseHourlyRate || 300;
        const startedAt = best.sheet.roundApprovals?.[best.round]?.statusChangedAt || '';
        const entries = (client.projectData.clientTasks || []).flatMap((t) => t?.timeLog || [])
            .filter((e) => !startedAt || String(e.end || e.start || '') >= startedAt);
        const hours = tweakAllowanceHours(fee, rate);
        const expires = allowanceExpiry(startedAt);
        const today = new Date().toISOString().slice(0, 10);
        return { round: best.round, hours, expires, ...allowanceStatus({ allowanceHours: hours, entries, expiresDay: expires, today }) };
    } catch (e) { console.warn('Tweak allowance unavailable:', e); return null; }
}

export function allowancePillHtml(client) {
    const a = currentAllowance(client);
    if (!a) return '';
    const hot = a.usedPct >= 80;
    const color = a.expired ? '#9aa7bd' : hot ? '#f5b942' : '#2dd4bf';
    const title = `Round ${a.round}: the larger of 10% of the round's fee (as hours) or 30 minutes. Only "they are asking for more" draws on it.${a.expires ? ` Valid until ${a.expires}.` : ''}`;
    return `<div class="pill tiny" title="${esc(title)}" style="background:${color}22;color:${color};border:1px solid transparent;cursor:default;display:flex;align-items:center;gap:6px;font-weight:bold;">
        <i data-lucide="gauge" style="width:14px;height:14px;"></i> Tweak allowance: ${(a.usedMin / 60).toFixed(1)} of ${a.hours.toFixed(1)} h${a.expired ? ' (expired)' : ''}</div>`;
}

// ---- the welcome-back prompt --------------------------------------------------------------------------------------
function startHeartbeat() {
    let last = 0;
    const beat = () => { const now = Date.now(); if (now - last < 30000) return; last = now; try { localStorage.setItem(ACTIVITY_KEY, String(now)); } catch (e) { /* ignore */ } };
    ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach((ev) => window.addEventListener(ev, beat, { passive: true }));
    beat();
}

let pending = null;      // the forgotten timer being asked about

function wrapRestore() {
    const original = OL.restoreActiveTaskTimer;
    if (typeof original !== 'function' || original._tb) return;
    OL.restoreActiveTaskTimer = function () {
        let saved = null;
        try { saved = JSON.parse(localStorage.getItem(OL._TIMER_STORAGE_KEY) || 'null'); } catch (e) { /* ignore */ }
        if (saved?.taskId && saved.startTime && timerNeedsWelcomeBack(saved.startTime, Date.now())) {
            const { task } = findTask(saved.taskId);
            if (task) { let lastActive = 0; try { lastActive = Number(localStorage.getItem(ACTIVITY_KEY)) || 0; } catch (e) { /* ignore */ } pending = { ...saved, lastActive }; return paintWelcomeBack(); }
        }
        return original.call(this);
    };
    OL.restoreActiveTaskTimer._tb = true;
}

const localInput = (ms) => { const d = new Date(ms); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };

function paintWelcomeBack() {
    const { task } = findTask(pending.taskId);
    const now = Date.now();
    const elapsedMin = Math.round((now - pending.startTime) / 60000);
    const canTrim = pending.lastActive > pending.startTime;
    const lastLabel = canTrim ? new Date(pending.lastActive).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '';
    const html = `
    <div class="modal-head"><div class="modal-title-text"><i data-lucide="timer-off" style="width:16px;height:16px;vertical-align:sub;margin-right:6px;color:#f5b942;"></i>Welcome back</div></div>
    <div class="modal-body" style="width:100%;box-sizing:border-box;">
        <div style="display:flex;gap:24px;align-items:flex-start;">
            <div style="flex:1;min-width:0;font-size:14px;line-height:1.6;">Your timer on <b>${esc(task?.title || task?.name || 'a task')}</b> was still running for <b>${fmtDur(elapsedMin)}</b>.
                ${canTrim ? `You were last active at <b>${esc(lastLabel)}</b>.` : ''}
                <div class="tiny muted" style="margin-top:10px;">Time you keep in full is saved as "Needs review" and stays out of billable totals until you confirm it.</div></div>
            <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:8px;">
                <button class="btn soft" onclick="OL.tbWelcome('keep')">Keep all ${fmtDur(elapsedMin)}</button>
                ${canTrim ? `<button class="btn primary" onclick="OL.tbWelcome('last')">Trim to ${esc(lastLabel)} (${fmtDur(Math.round((pending.lastActive - pending.startTime) / 60000))})</button>` : ''}
                <div style="display:flex;gap:8px;align-items:center;"><input type="datetime-local" id="tb-trim" class="modal-input" style="flex:1;" value="${localInput(canTrim ? pending.lastActive : now)}">
                    <button class="btn soft" onclick="OL.tbWelcome('pick')">Trim to this time</button></div>
                <button class="btn soft" onclick="OL.tbWelcome('discard')">Discard this timer</button>
            </div>
        </div>
    </div>`;
    OL.showOverlayModal(html, { wide: true });
    if (window.lucide) window.lucide.createIcons();
}

export function tbWelcome(choice) {
    if (!pending) return;
    const { client, task } = findTask(pending.taskId);
    const startMs = pending.startTime, now = Date.now();
    let endMs = null, kept = false;
    if (choice === 'keep') { endMs = now; kept = true; }
    else if (choice === 'last') endMs = clampEnd(startMs, pending.lastActive, now);
    else if (choice === 'pick') endMs = clampEnd(startMs, new Date(document.getElementById('tb-trim')?.value || '').getTime() || now, now);
    if (task && endMs !== null) {
        const entry = timerEntry({ startMs, endMs, by: getCurrentUserName(), kept, note: kept ? 'Timer left running' : 'Timer trimmed after being left running' });
        if (entry.minutes > 0) {
            updateAndSync(() => {
                if (!Array.isArray(task.timeLog)) task.timeLog = [];
                task.timeLog.push({ id: 'tl-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), ...entry });
                task.loggedHours = Number(task.loggedHours || task.hoursLogged || 0) + entry.minutes / 60;
                task.hoursLogged = task.loggedHours;
            }, client?.id);
        }
    }
    try { OL._clearPersistedTimer?.(); } catch (e) { /* ignore */ }
    pending = null;
    OL.closeModal?.();
    OL.refreshTaskView?.();
}

function init() {
    wrapRecordEntry(); wrapTimeLogHtml(); wrapRestore(); startHeartbeat();
}
// The task modules finish loading after this one; wrap once they have.
if (typeof window !== 'undefined') {
    window.OL = window.OL || {};
    Object.assign(window.OL, { tbSetBucket, tbConfirm, tbOpenEdit, tbSaveEdit, tbWelcome, allowancePillHtml });
    init();                 // now if the task code is already loaded, and again once everything has finished loading
    setTimeout(init, 0);
}
