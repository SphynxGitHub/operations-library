//======================= FEATURES / MAINTENANCE =======================//
// Two tabs for clients in maintenance (the logic is in core/maintenance.js):
//   Maintenance & Hours   the annual plan period (Ongoing Maintenance only) and the hours grants it holds
//   Client Requests       plain requests, no round, served first come, first served (Ongoing Maintenance only)
// Plan periods and grants are rows in the database; client requests are lines on a second, always-approved
// scoping sheet, so their tasks, statuses, tags and the dashboard work as for any request.

import { state, esc, uid, db, getActiveClient, persist } from '../core/data.js';
import { getRequestTypes } from '../core/requests.js';
import { deriveWorkStatus, WORK_STATUS_LABELS } from '../core/work-status.js';
import { assigneeForRole } from '../core/testing.js';
import {
    maintenanceMode, ONGOING, ADHOC, periodProgress, planStartPeriod, planEditPeriod, planClosePeriod, planAdHocPurchase,
    ensureMaintenanceSheet, maintenanceSheetOf, buildMaintenanceRequest, maintenanceRequests, requestAgeDays, REQUEST_SOURCES,
    validDate, addDaysIso, daysBetween, periodDue, maintenanceTabAllowed,
    MAINTENANCE_TIERS, tierByTitle, tierForHours, periodTierTitle, periodTimeEntries, summarizePeriodTime,
    allocateHours, entryKey,
} from '../core/maintenance.js';
import { isClientTask, isTaskBillableForHours, stampBillableFor } from '../core/billable.js';
import { markClientDirty } from '../core/data.js';

export function todayIso(now = new Date()) {
    const p = (n) => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}
const niceDate = (iso) => (iso ? new Date(`${String(iso).slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '');
const hoursText = (n) => `${Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })} h`;
const SOURCE_LABEL = Object.fromEntries(REQUEST_SOURCES.map((s) => [s.key, s.label]));
const GRANT_LABEL = { plan_allotment: 'Plan allotment', courtesy_carryover: 'Courtesy carryover', ad_hoc_purchase: 'Ad hoc purchase' };

// ---------------- the database side ----------------
OL._maint = OL._maint || {};

export async function loadMaintenanceData(clientId) {
    const slot = OL._maint[clientId] = OL._maint[clientId] || { periods: [], grants: [], loaded: false };
    slot.loading = true;
    try {
        const [p, g] = await Promise.all([
            db.from('maintenance_plan_period').select('*').eq('client_id', clientId).order('start_date', { ascending: false }),
            db.from('hours_grant').select('*').eq('client_id', clientId).order('expires_on', { ascending: true }),
        ]);
        if (p.error) throw p.error;
        if (g.error) throw g.error;
        slot.periods = p.data || []; slot.grants = g.data || []; slot.error = '';
        slot.loadedAt = Date.now();
    } catch (err) {
        slot.error = err.message || 'Could not load';
    } finally {
        slot.loaded = true; slot.loading = false;
    }
    return slot;
}

const friendly = (err) => (err && err.code === '23505' ? 'That would duplicate something that already exists (a client can have only one active plan period). Reload and try again.' : (err?.message || 'Something went wrong.'));

async function writeAll(steps) {
    for (const step of steps) {
        const { error } = await step();
        if (error) return error;
    }
    return null;
}

export async function savePeriodStart(clientId, { start, allotment, renewing }) {
    const plan = planStartPeriod({ clientId, start, allotment, renewing });
    if (plan.error) return { error: plan.error };
    const { data, error } = await db.from('maintenance_plan_period').insert(plan.period).select('id').single();
    if (error) return { error: friendly(error) };
    if (plan.grant) {
        const g = await db.from('hours_grant').insert({ ...plan.grant, period_id: data.id });
        if (g.error) return { error: friendly(g.error) };
    }
    return { ok: true };
}

export async function savePeriodEdit(period, grants, patch) {
    const plan = planEditPeriod({ period, grants, patch });
    if (plan.error) return { error: plan.error };
    const error = await writeAll([
        () => db.from('maintenance_plan_period').update(plan.periodUpdate).eq('id', period.id),
        ...plan.grantUpdates.map((u) => () => db.from('hours_grant').update(u.patch).eq('id', u.id)),
        ...(plan.newAllotment ? [() => db.from('hours_grant').insert(plan.newAllotment)] : []),
    ]);
    return error ? { error: friendly(error) } : { ok: true };
}

export async function savePeriodClose(period, opts) {
    const plan = planClosePeriod({ period, ...opts });
    const error = await writeAll([() => db.from('maintenance_plan_period').update(plan.periodUpdate).eq('id', period.id)]);
    if (error) return { error: friendly(error) };
    if (plan.carryover) { const c = await db.from('hours_grant').insert(plan.carryover); if (c.error) return { error: friendly(c.error) }; }
    if (plan.next && !plan.next.error) {
        const n = await db.from('maintenance_plan_period').insert(plan.next.period).select('id').single();
        if (n.error) return { error: friendly(n.error) };
        if (plan.next.grant) { const g = await db.from('hours_grant').insert({ ...plan.next.grant, period_id: n.data.id }); if (g.error) return { error: friendly(g.error) }; }
    } else if (plan.next && plan.next.error) return { error: plan.next.error };
    return { ok: true };
}

export async function saveAdHoc(clientId, opts) {
    const plan = planAdHocPurchase({ clientId, ...opts });
    if (plan.error) return { error: plan.error };
    const { error } = await db.from('hours_grant').insert(plan.grant);
    return error ? { error: friendly(error) } : { ok: true };
}

// ---------------- Maintenance & Hours ----------------
// Clients can read this page; managing periods and purchases is for Sphynx staff and partners.
const canManage = () => !(window.OL?.isClientLogin && window.OL.isClientLogin());
const slotFor = (clientId) => OL._maint[clientId] || { periods: [], grants: [], loaded: false };
const val = (id) => document.getElementById(id)?.value ?? '';
const checked = (id) => !!document.getElementById(id)?.checked;

const GRANT_COLOR = { plan_allotment: '#22c55e', courtesy_carryover: '#60a5fa', ad_hoc_purchase: '#a78bfa' };
const durText = (min) => { const a = Math.abs(Math.round(min)); const h = Math.floor(a / 60), m = a % 60; return (min < 0 ? '−' : '') + (h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`); };
const grantShort = (g) => `${GRANT_LABEL[g.source] || g.source} · ${hoursText(g.hours_granted)}${g.source === 'plan_allotment' ? '' : ` · exp ${niceDate(g.expires_on)}`}`;

// ---------------- the hours ledger ----------------
// Every time entry on the client's own Sphynx work (client tasks excluded) across the dates any grant covers, and
// which grant each billable hour comes out of (core/maintenance.js allocateHours). Staff resolve billable status
// live; a client login uses what staff last saved on the task.
function ledgerFor(client, slot) {
    const today = todayIso();
    const tasks = client.projectData?.clientTasks || [];
    const grants = slot.grants || [];
    const allocations = {};
    tasks.forEach((t) => { if (t && t.hoursGrantId && grants.some((g) => String(g.id) === String(t.hoursGrantId))) allocations[t.id] = t.hoursGrantId; });
    const days = grants.flatMap((g) => [String(g.granted_on).slice(0, 10), String(g.expires_on).slice(0, 10)]).filter(Boolean).sort();
    const opts = { include: (t) => !isClientTask(t, client), isBillable: (t) => isTaskBillableForHours(t, client) };
    const entries = days.length ? periodTimeEntries(tasks, { start_date: days[0], due_date: days[days.length - 1] > today ? days[days.length - 1] : today }, opts) : [];
    const alloc = allocateHours({ entries, grants, allocations });
    const active = slot.periods.find((p) => p.status === 'active');
    // Hours available now: this period's allotment, plus carryovers and purchases that haven't expired.
    const current = grants.filter((g) => g.status !== 'expired' && String(g.expires_on).slice(0, 10) >= today
        && (g.source !== 'plan_allotment' || (active && g.period_id === active.id)))
        .sort((a, b) => (a.source === 'plan_allotment' ? 0 : 1) - (b.source === 'plan_allotment' ? 0 : 1) || String(a.expires_on).localeCompare(String(b.expires_on)));
    return { entries, alloc, allocations, current, opts, tasks };
}
const usedHoursOf = (ledger, g) => Math.round(((ledger.alloc.usedMinutes[g.id] || 0) / 60) * 100) / 100;
const allocatedCount = (ledger, g) => Object.values(ledger.allocations).filter((id) => String(id) === String(g.id)).length;

// The tracking bar: one segment per grant available now (allotment, carryover, ad hoc), each filled by what's used.
function hoursBarHtml(ledger, { nonBillableHours = 0 } = {}) {
    const gs = ledger.current;
    if (!gs.length) return `<div class="tiny muted" style="margin-top:12px;">No hours available right now.${canManage() ? ' Add an ad hoc purchase or start a plan period.' : ''}</div>`;
    const total = gs.reduce((s, g) => s + Number(g.hours_granted || 0), 0);
    const used = gs.reduce((s, g) => s + usedHoursOf(ledger, g), 0);
    const left = Math.round((total - used) * 100) / 100;
    const over = left < 0;
    const pct = total > 0 ? Math.round((used / total) * 100) : 0;
    const segs = gs.map((g) => {
        const h = Number(g.hours_granted || 0); const u = usedHoursOf(ledger, g);
        const fill = h > 0 ? Math.min(100, Math.round((u / h) * 100)) : 0;
        const color = u > h ? '#ef4444' : GRANT_COLOR[g.source] || '#22c55e';
        return `<div title="${esc(grantShort(g))}: ${esc(hoursText(u))} used" style="flex:${Math.max(h, 0.01)}; height:100%; background:rgba(148,163,184,0.25); position:relative;"><div style="height:100%; width:${fill}%; background:${color};"></div></div>`;
    }).join('<div style="width:2px; background:var(--panel, #0b0f17);"></div>');
    const legend = gs.map((g) => {
        const u = usedHoursOf(ledger, g); const h = Number(g.hours_granted || 0); const n = allocatedCount(ledger, g);
        return `<span style="display:inline-flex; align-items:center; gap:5px; margin-right:14px;"><span style="width:8px; height:8px; border-radius:2px; background:${GRANT_COLOR[g.source] || '#22c55e'};"></span>${esc(GRANT_LABEL[g.source] || g.source)} <strong style="color:${u > h ? '#ef4444' : 'var(--text)'};">${esc(hoursText(u))} of ${esc(hoursText(h))}</strong>${g.source !== 'plan_allotment' ? ` <span class="muted">· expires ${esc(niceDate(g.expires_on))}</span>` : ''}${n ? ` <span class="muted">· ${n} task${n === 1 ? '' : 's'}</span>` : ''}</span>`;
    }).join('');
    return `
        <div class="tiny bold" style="margin:12px 0 6px; color:${over ? '#ef4444' : 'var(--text)'};">${esc(hoursText(used))} of ${esc(hoursText(total))} used (${pct}%) · ${over ? `<strong>${esc(hoursText(-left))} over</strong>` : `${esc(hoursText(left))} left`}${nonBillableHours > 0 ? `<span class="muted" style="font-weight:400;"> · ${esc(hoursText(nonBillableHours))} non-billable, not counted</span>` : ''}</div>
        <div style="display:flex; height:10px; border-radius:6px; overflow:hidden; margin:0 0 6px;">${segs}</div>
        <div class="tiny muted" style="margin-bottom:6px; line-height:1.9;">${legend}</div>
        ${ledger.alloc.unfundedMinutes > 0 ? `<div class="tiny" style="color:#f59e0b; margin-bottom:6px;">${esc(durText(ledger.alloc.unfundedMinutes))} of billable time falls outside every grant's dates.</div>` : ''}`;
}

function grantsTableHtml(slot, ledger) {
    const today = todayIso();
    if (!slot.grants.length) return '<div class="tiny muted">No hours grants yet.</div>';
    const rows = slot.grants.map((g) => {
        const left = daysBetween(today, g.expires_on);
        const soon = g.status === 'active' && left >= 0 && left <= 30;
        const statusColor = g.status === 'active' ? '#22c55e' : g.status === 'used_up' ? '#94a3b8' : '#ef4444';
        const u = usedHoursOf(ledger, g); const h = Number(g.hours_granted || 0); const n = allocatedCount(ledger, g);
        return `<tr>
            <td>${esc(GRANT_LABEL[g.source] || g.source)}${g.note ? `<div class="tiny muted">${esc(g.note)}</div>` : ''}</td>
            <td style="text-align:right;">${esc(hoursText(h))}</td>
            <td style="text-align:right; ${u > h ? 'color:#ef4444; font-weight:600;' : ''}">${esc(hoursText(u))}</td>
            <td>${esc(niceDate(g.granted_on))}</td>
            <td style="${soon ? 'color:#f59e0b; font-weight:600;' : ''}">${esc(niceDate(g.expires_on))}${g.status === 'active' ? ` <span class="tiny muted">${left >= 0 ? `${left} day${left === 1 ? '' : 's'} left` : 'past'}</span>` : ''}</td>
            <td><span class="pill tiny" style="border:1px solid ${statusColor}; color:${statusColor};">${esc(g.status.replace('_', ' '))}</span>${Number(g.hours_expired) > 0 ? `<div class="tiny muted">${esc(hoursText(g.hours_expired))} written off</div>` : ''}</td>
            <td style="text-align:right;">${g.source === 'plan_allotment' ? '' : canManage()
                ? `<button class="btn tiny soft" onclick="OL.openGrantTasksModal('${esc(g.id)}')" title="Tasks whose time comes out of this grant">Tasks${n ? ` (${n})` : ''}…</button>`
                : (n ? `<span class="tiny muted">${n} task${n === 1 ? '' : 's'}</span>` : '')}</td>
        </tr>`;
    }).join('');
    return `<div style="overflow-x:auto;"><table class="data-table" style="width:100%; font-size:12px; border-collapse:collapse;">
        <thead><tr style="text-align:left;" class="tiny muted uppercase"><th>Source</th><th style="text-align:right;">Granted</th><th style="text-align:right;">Used</th><th>Granted on</th><th>Expires</th><th>Status</th><th></th></tr></thead>
        <tbody>${rows}</tbody></table></div>
        <div class="tiny muted" style="margin-top:6px;">Billable time comes out of the plan allotment first, then other hours, soonest to expire first. A carryover or purchase with tasks set aside for it is held for those tasks.</div>`;
}

// Itemized log for a window (the current plan period, or for ad hoc clients the life of their active purchases).
function hoursLogHtml(client, ledger, window, heading) {
    const entries = ledger.entries.filter((e) => e.date >= window.start_date && e.date <= window.due_date);
    const filter = OL._maintLogFilter || 'billable';
    const shown = entries.filter((e) => filter === 'all' || (filter === 'billable' ? e.billable : !e.billable));
    const { billableHours, nonBillableHours } = summarizePeriodTime(entries);
    const grantsById = new Map((OL._maint[client.id]?.grants || []).map((g) => [String(g.id), g]));
    const pickable = ledger.current.filter((g) => g.source !== 'plan_allotment');
    const btn = (key, label) => `<button class="btn tiny ${filter === key ? 'primary' : 'soft'}" onclick="OL._maintLogFilter='${key}'; OL.renderMaintenancePage()">${label}</button>`;
    const countedAgainst = (e) => {
        if (!e.billable) return '<span class="muted">—</span>';
        const parts = (ledger.alloc.charges[entryKey(e)] || []).map((c) => {
            const g = grantsById.get(String(c.grantId));
            return `<span style="color:${c.over ? '#ef4444' : GRANT_COLOR[g?.source] || 'inherit'};">${esc(GRANT_LABEL[g?.source] || 'Grant')}${c.over ? ' (over)' : ''}</span>`;
        });
        const label = parts.length ? parts.join(' + ') : '<span style="color:#f59e0b;">No grant covers this date</span>';
        if (!canManage() || !pickable.length) return label;
        const cur = String(ledger.allocations[e.taskId] || '');
        // Choosing a grant here sets it for the whole task, so all its time comes out of that grant.
        return `<div>${label}</div><select class="modal-input tiny" style="margin-top:3px; padding:1px 4px; width:auto; max-width:190px;" onclick="event.stopPropagation()" onchange="OL.setTaskHoursGrant('${esc(e.taskId)}', this.value)" title="Which hours this task's time comes out of">
            <option value="" ${cur ? '' : 'selected'}>Auto</option>
            ${pickable.map((g) => `<option value="${esc(g.id)}" ${cur === String(g.id) ? 'selected' : ''}>${esc(grantShort(g))}</option>`).join('')}
        </select>`;
    };
    const rows = shown.map((e) => `<tr style="border-top:1px solid var(--line); cursor:pointer; vertical-align:top;" onclick="OL.openTaskInContext && OL.openTaskInContext('${esc(client.id)}', '${esc(e.taskId)}')">
            <td style="white-space:nowrap; padding:6px 8px 6px 0;">${esc(niceDate(e.date))}</td>
            <td style="padding:6px 8px 6px 0;">${esc(e.title)}${e.note ? `<div class="tiny muted">${esc(e.note)}</div>` : ''}</td>
            <td style="padding:6px 8px 6px 0;" class="muted">${esc(e.by)}</td>
            <td style="text-align:right; white-space:nowrap; padding:6px 8px 6px 0;">${esc(durText(e.minutes))}</td>
            <td style="padding:6px 8px 6px 0;"><span class="pill tiny" style="border:1px solid ${e.billable ? '#22c55e' : '#94a3b8'}; color:${e.billable ? '#22c55e' : '#94a3b8'};">${e.billable ? 'Billable' : 'Non-billable'}</span></td>
            <td style="padding:6px 0;" class="tiny">${countedAgainst(e)}</td>
        </tr>`).join('');
    return `
        <div class="card" style="padding:16px; margin-top:16px;">
            <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:10px;">
                <div>
                    <h3 style="margin:0;">${esc(heading)}</h3>
                    <div class="tiny muted">${esc(niceDate(window.start_date))} to ${esc(niceDate(window.due_date))} · <strong style="color:var(--text);">${esc(hoursText(billableHours))}</strong> billable (counted) · ${esc(hoursText(nonBillableHours))} non-billable</div>
                </div>
                <div style="display:flex; gap:6px;">${btn('billable', 'Billable')}${btn('non-billable', 'Non-billable')}${btn('all', `All (${entries.length})`)}</div>
            </div>
            ${shown.length ? `<div style="overflow-x:auto;"><table style="width:100%; font-size:12px; border-collapse:collapse;">
                <thead><tr style="text-align:left;" class="tiny muted uppercase"><th>Date</th><th>Task</th><th>By</th><th style="text-align:right;">Time</th><th></th><th>Counted against</th></tr></thead>
                <tbody>${rows}</tbody></table></div>`
            : `<div class="tiny muted">${entries.length ? 'Nothing in this filter.' : 'No time logged in this window yet.'}</div>`}
        </div>`;
}

function periodCardHtml(client, slot, ledger) {
    const active = slot.periods.find((p) => p.status === 'active');
    const today = todayIso();
    if (!active) {
        return `
            <div class="card" style="padding:16px; border-left:3px solid #f59e0b;">
                <div class="bold">No active plan period</div>
                ${canManage() ? `<div class="tiny muted" style="margin:4px 0 10px;">Ongoing Maintenance runs in annual plan periods, each with its hours allotment. Start one to give the client its hours.</div>
                <button class="btn primary" onclick="OL.openStartPeriodModal()">Start a plan period</button>` : `<div class="tiny muted" style="margin-top:4px;">Your next plan period hasn't started yet.</div>`}
                ${ledger.current.length ? hoursBarHtml(ledger) : ''}
            </div>`;
    }
    const pr = periodProgress(active, today);
    const allot = slot.grants.filter((g) => g.period_id === active.id && g.source === 'plan_allotment').reduce((s, g) => s + Number(g.hours_granted), 0);
    const tier = periodTierTitle(active, allot);
    const { nonBillableHours } = summarizePeriodTime(ledger.entries.filter((e) => e.date >= active.start_date && e.date <= active.due_date));
    return `
        <div class="card" style="padding:16px;">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px; flex-wrap:wrap;">
                <div>
                    <div class="tiny muted uppercase bold">Current plan period</div>
                    <div style="font-size:16px; font-weight:700; margin:2px 0;">${esc(niceDate(active.start_date))} to ${esc(niceDate(active.due_date))}</div>
                    <div class="tiny muted">${tier ? `<span class="pill tiny soft" style="margin-right:6px;">${esc(tier)}</span>` : ''}${esc(hoursText(allot))} allotment</div>
                </div>
                ${canManage() ? `<div style="display:flex; gap:8px; align-items:center;">
                    <label class="tiny" style="display:flex; align-items:center; gap:6px; cursor:pointer;" title="Renewing clients get a 6 month carryover instead of 3">
                        <input type="checkbox" ${active.renewing ? 'checked' : ''} onchange="OL.setPeriodRenewing('${esc(active.id)}', this.checked)"> Renewing
                    </label>
                    <button class="btn tiny soft" onclick="OL.openEditPeriodModal('${esc(active.id)}')">Edit</button>
                    <button class="btn tiny primary" onclick="OL.openClosePeriodModal('${esc(active.id)}')">Close period…</button>
                </div>` : ''}
            </div>
            ${hoursBarHtml(ledger, { nonBillableHours })}
            <div class="tiny" style="color:${pr.overdue ? '#ef4444' : 'var(--muted)'};">${pr.notStarted ? 'Starts ' + esc(niceDate(active.start_date)) : pr.overdue ? `This period ended ${-pr.daysLeft} day${pr.daysLeft === -1 ? '' : 's'} ago. Close it, and renew if the client is continuing.` : `${pr.daysLeft} day${pr.daysLeft === 1 ? '' : 's'} left in the period (ends ${esc(niceDate(active.due_date))})`}</div>
        </div>`;
}

function adHocCardHtml(ledger) {
    return `
        <div class="card" style="padding:16px;"><div class="bold">Ad Hoc Maintenance</div>
            <div class="tiny muted" style="margin-top:4px;">There are no plan periods. Hours are bought as needed and expire one year after purchase.</div>
            ${hoursBarHtml(ledger, { nonBillableHours: summarizePeriodTime(ledger.entries.filter((e) => e.date >= adHocWindow(ledger).start_date)).nonBillableHours })}
        </div>`;
}
// Ad hoc clients: the log covers the life of the hours available now (earliest purchase still active, to today).
const adHocWindow = (ledger) => {
    const starts = ledger.current.map((g) => String(g.granted_on).slice(0, 10)).sort();
    return { start_date: starts[0] || todayIso(), due_date: todayIso() };
};

export function renderMaintenancePage() {
    const main = document.getElementById('mainContent');
    const client = getActiveClient();
    if (!main) return;
    if (!client) { main.innerHTML = '<div class="card" style="padding:20px;">Pick a client first.</div>'; return; }
    const mode = maintenanceMode(client);
    if (mode === null) {
        main.innerHTML = `<div class="section-header"><h2>🛠 Maintenance &amp; Hours</h2></div>
            <div class="card" style="padding:20px;">${canManage()
                ? `This client's pipeline label is "${esc(client.meta?.status || 'not set')}". Set it to <strong>Ongoing Maintenance</strong> or <strong>Ad Hoc Maintenance</strong> to manage plan periods and hours here.`
                : 'There is no maintenance plan on this project.'}</div>`;
        return;
    }
    const slot = slotFor(client.id);
    const activePeriod = slot.periods.find((p) => p.status === 'active');
    // Staff: save each task's current billable status so the client's view of this tab counts the same hours.
    if (canManage() && !window.IS_GUEST && stampBillableFor(client)) { markClientDirty(client.id); OL.persist?.(); }
    // Load on first view, and again when the copy on screen is over 30 s old, so hours added from
    // another login or tab show up without a full page reload.
    const stale = slot.loaded && Date.now() - (slot.loadedAt || 0) > 30000;
    if ((!slot.loaded || stale) && !slot.loading) loadMaintenanceData(client.id).then(() => renderMaintenancePage());
    const periods = slot.periods;
    const history = periods.filter((p) => p.status !== 'active');
    const ledger = slot.loaded && !slot.error ? ledgerFor(client, slot) : null;
    const body = !slot.loaded ? '<div class="tiny muted">Loading...</div>' : slot.error ? `<div class="card" style="padding:16px; border-left:3px solid #ef4444;">Could not load the maintenance data: ${esc(slot.error)}</div>` : `
        ${mode === ONGOING
            ? periodCardHtml(client, slot, ledger) + (activePeriod ? hoursLogHtml(client, ledger, activePeriod, 'Hours log · this period') : '')
            : adHocCardHtml(ledger) + (ledger.current.length ? hoursLogHtml(client, ledger, adHocWindow(ledger), 'Hours log · active purchases') : '')}
        <div class="card" style="padding:16px; margin-top:16px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                <h3 style="margin:0;">Hours grants</h3>
                ${canManage() ? `<button class="btn tiny soft" onclick="OL.openAdHocPurchaseModal()">+ Ad hoc purchase</button>` : ''}
            </div>
            ${grantsTableHtml(slot, ledger)}
        </div>
        ${mode === ONGOING && history.length ? `
        <div class="card" style="padding:16px; margin-top:16px;"><h3 style="margin:0 0 10px;">Earlier plan periods</h3>
            ${history.map((p) => `<div style="display:flex; justify-content:space-between; padding:6px 0; border-top:1px solid var(--line);" class="tiny"><span>${esc(niceDate(p.start_date))} to ${esc(niceDate(p.due_date))}${p.tier ? ` · ${esc(p.tier)}` : ''}</span><span class="muted">${esc(p.status)}${p.renewing ? ' · renewing' : ''}</span></div>`).join('')}
        </div>` : ''}`;
    main.innerHTML = `
        <div class="section-header"><div><h2>🛠 Maintenance &amp; Hours</h2>
            <div class="small muted">${esc(client.meta?.name || '')} · <span class="pill tiny soft">${mode === ONGOING ? 'Ongoing Maintenance' : 'Ad Hoc Maintenance'}</span></div></div></div>
        ${body}`;
    if (window.lucide) window.lucide.createIcons();
}

// ---------------- setting tasks aside for a grant ----------------
// Stored on the task as hoursGrantId. All of the task's billable time inside the grant's dates comes out of it.
async function saveTaskGrants(client, changes) {
    const tasks = client.projectData?.clientTasks || [];
    changes.forEach(({ taskId, grantId }) => {
        const t = tasks.find((x) => String(x.id) === String(taskId));
        if (!t) return;
        if (grantId) t.hoursGrantId = grantId; else delete t.hoursGrantId;
    });
    markClientDirty(client.id);
    await persist();
}
export async function setTaskHoursGrant(taskId, grantId) {
    const client = getActiveClient(); if (!client || !canManage()) return;
    await saveTaskGrants(client, [{ taskId, grantId: grantId || null }]);
    redraw();
}
export function openGrantTasksModal(grantId) {
    const client = getActiveClient(); if (!client || !canManage()) return;
    const slot = slotFor(client.id);
    const grant = slot.grants.find((g) => String(g.id) === String(grantId)); if (!grant) return;
    const grantsById = new Map(slot.grants.map((g) => [String(g.id), g]));
    const closed = new Set(closedNames());
    const tasks = (client.projectData?.clientTasks || []).filter((t) => t && !isClientTask(t, client))
        .sort((a, b) => (closed.has(String(a.status)) ? 1 : 0) - (closed.has(String(b.status)) ? 1 : 0) || String(a.title || a.name || '').localeCompare(String(b.title || b.name || '')));
    const rows = tasks.map((t) => {
        const other = t.hoursGrantId && String(t.hoursGrantId) !== String(grantId) ? grantsById.get(String(t.hoursGrantId)) : null;
        const title = t.title || t.name || 'Untitled task';
        return `<label class="tiny gt-row" data-q="${esc(title.toLowerCase())}" style="display:flex; align-items:center; gap:8px; padding:5px 2px; border-top:1px solid var(--line);">
            <input type="checkbox" class="gt-box" value="${esc(t.id)}" ${String(t.hoursGrantId || '') === String(grantId) ? 'checked' : ''}>
            <span style="flex:1;">${esc(title)}${closed.has(String(t.status)) ? ' <span class="muted">(done)</span>' : ''}${other ? `<div class="muted">now: ${esc(grantShort(other))}</div>` : ''}</span>
            <span class="muted">${esc(durText(Math.round(Number(t.loggedHours || t.hoursLogged || 0) * 60)))}</span>
        </label>`;
    }).join('');
    openModal(`${modalHead(`Tasks for this ${esc((GRANT_LABEL[grant.source] || 'grant').toLowerCase())}`)}<div class="modal-body" style="padding-top:14px;">
        <p class="tiny muted" style="margin-bottom:10px;">${esc(grantShort(grant))} (${esc(niceDate(grant.granted_on))} to ${esc(niceDate(grant.expires_on))}). Billable time on the ticked tasks, logged between those dates, comes out of these hours instead of the plan allotment. A grant with tasks ticked is held for them.</p>
        <input type="text" class="modal-input" placeholder="Filter tasks…" style="margin-bottom:8px;" oninput="const q=this.value.toLowerCase(); document.querySelectorAll('.gt-row').forEach(r => r.style.display = r.dataset.q.includes(q) ? '' : 'none')">
        <div style="max-height:340px; overflow-y:auto;">${rows || '<div class="tiny muted">No tasks on this project.</div>'}</div>
        <button class="btn primary" style="width:100%; justify-content:center; margin-top:12px;" onclick="OL.submitGrantTasks('${esc(grantId)}')">Save</button></div>`);
}
export async function submitGrantTasks(grantId) {
    const client = getActiveClient(); if (!client) return;
    const changes = [];
    document.querySelectorAll('.gt-box').forEach((box) => {
        const t = (client.projectData?.clientTasks || []).find((x) => String(x.id) === box.value);
        if (!t) return;
        const mine = String(t.hoursGrantId || '') === String(grantId);
        if (box.checked && !mine) changes.push({ taskId: t.id, grantId });
        if (!box.checked && mine) changes.push({ taskId: t.id, grantId: null });
    });
    if (changes.length) await saveTaskGrants(client, changes);
    OL.closeModal(); redraw();
}

const redraw = () => { if (document.getElementById('mainContent') && String(window.location.hash).includes('maintenance')) renderMaintenancePage(); };
async function reloadAndRedraw(clientId) { await loadMaintenanceData(clientId); redraw(); }
const modalHead = (title) => `<div class="modal-head" style="display:flex; justify-content:space-between; align-items:center; padding-bottom:12px; border-bottom:1px solid var(--line);"><div class="modal-title-text" style="font-weight:700; font-size:16px;">${title}</div><button class="btn small soft" onclick="OL.closeModal()">Cancel</button></div>`;
const field = (label, inner) => `<div style="display:flex; flex-direction:column; gap:4px; margin-bottom:12px;"><label class="tiny muted" style="font-size:10px; font-weight:600;">${label}</label>${inner}</div>`;

// Tier dropdown: picking a tier fills its hours; typing hours that match a tier selects it, anything else is Custom.
function tierSelectHtml(selId, hoursId, current) {
    const opts = [`<option value="">Custom (enter hours)</option>`, ...MAINTENANCE_TIERS.map((t) =>
        `<option value="${esc(t.title)}" ${t.title === current ? 'selected' : ''}>${esc(t.title)} · ${esc(hoursText(t.hours))}</option>`)];
    return `<select id="${selId}" class="modal-input" onchange="OL.maintTierPicked('${selId}', '${hoursId}')">${opts.join('')}</select>`;
}
const hoursOnInput = (selId, hoursId) => `oninput="OL.maintHoursTyped('${selId}', '${hoursId}')"`;
export function maintTierPicked(selId, hoursId) {
    const t = tierByTitle(val(selId)); const h = document.getElementById(hoursId);
    if (t && h) h.value = t.hours;
}
export function maintHoursTyped(selId, hoursId) {
    const sel = document.getElementById(selId); if (!sel) return;
    const t = tierForHours(val(hoursId));
    // A tier sold at a custom number of hours keeps its title; only switch when the hours match a different tier.
    if (t) sel.value = t.title;
}

export function openStartPeriodModal() {
    const client = getActiveClient(); if (!client) return;
    const start = todayIso();
    openModal(`${modalHead('Start a plan period')}<div class="modal-body" style="padding-top:14px;">
        <p class="tiny muted" style="margin-bottom:14px;">A plan period lasts one calendar year. Its hours allotment becomes an hours grant that expires when the period ends.</p>
        ${field('Start date', `<input id="pp-start" type="date" class="modal-input" value="${start}" oninput="OL.ppRecalc()">`)}
        <div id="pp-due" class="tiny muted" style="margin:-6px 0 12px;">Ends ${esc(niceDate(periodDue(start)))}</div>
        ${field('Tier', tierSelectHtml('pp-tier', 'pp-allot', ''))}
        ${field('Hours allotment', `<input id="pp-allot" type="number" min="0" step="0.25" class="modal-input" placeholder="e.g. 24" ${hoursOnInput('pp-tier', 'pp-allot')}>`)}
        <label class="tiny" style="display:flex; align-items:center; gap:6px; margin-bottom:16px;"><input id="pp-renew" type="checkbox"> The client is renewing</label>
        <button class="btn primary" style="width:100%; justify-content:center;" onclick="OL.submitStartPeriod()">Start period</button></div>`);
}
export function ppRecalc() {
    const s = val('pp-start'); const el = document.getElementById('pp-due');
    if (el) el.textContent = validDate(s) ? `Ends ${niceDate(periodDue(s))}` : 'Enter a valid start date';
}
export async function submitStartPeriod() {
    const client = getActiveClient(); if (!client) return;
    const res = await savePeriodStart(client.id, { start: val('pp-start'), allotment: val('pp-allot'), renewing: checked('pp-renew'), tier: val('pp-tier') });
    if (res.error) { alert(res.error); return; }
    OL.closeModal(); await reloadAndRedraw(client.id);
}

function findPeriod(periodId) { const client = getActiveClient(); return { client, period: slotFor(client?.id).periods.find((p) => p.id === periodId), grants: slotFor(client?.id).grants }; }

export function openEditPeriodModal(periodId) {
    const { period, grants } = findPeriod(periodId); if (!period) return;
    const allot = grants.filter((g) => g.period_id === period.id && g.source === 'plan_allotment').reduce((s, g) => s + Number(g.hours_granted), 0);
    openModal(`${modalHead('Edit plan period')}<div class="modal-body" style="padding-top:14px;">
        ${field('Start date', `<input id="pe-start" type="date" class="modal-input" value="${esc(period.start_date)}">`)}
        ${field('Due date', `<input id="pe-due" type="date" class="modal-input" value="${esc(period.due_date)}">`)}
        ${field('Tier', tierSelectHtml('pe-tier', 'pe-allot', periodTierTitle(period, allot)))}
        ${field('Hours allotment', `<input id="pe-allot" type="number" min="0" step="0.25" class="modal-input" value="${allot || ''}" ${hoursOnInput('pe-tier', 'pe-allot')}>`)}
        <div class="tiny muted" style="margin-bottom:14px;">Changing the dates or hours updates the allotment grant, and any unused carryover from this period.</div>
        <button class="btn primary" style="width:100%; justify-content:center;" onclick="OL.submitEditPeriod('${esc(periodId)}')">Save</button></div>`);
}
export async function submitEditPeriod(periodId) {
    const { client, period, grants } = findPeriod(periodId); if (!period) return;
    const patch = { start_date: val('pe-start'), due_date: val('pe-due'), tier: val('pe-tier') };
    if (val('pe-allot') !== '') patch.allotment = val('pe-allot');
    const res = await savePeriodEdit(period, grants, patch);
    if (res.error) { alert(res.error); return; }
    OL.closeModal(); await reloadAndRedraw(client.id);
}
export async function setPeriodRenewing(periodId, isRenewing) {
    const { client, period, grants } = findPeriod(periodId); if (!period) return;
    const res = await savePeriodEdit(period, grants, { renewing: !!isRenewing });
    if (res.error) alert(res.error);
    await reloadAndRedraw(client.id);
}

export function openClosePeriodModal(periodId) {
    const { period } = findPeriod(periodId); if (!period) return;
    const next = addDaysIso(period.due_date, 1);
    openModal(`${modalHead('Close plan period')}<div class="modal-body" style="padding-top:14px;">
        <p class="tiny muted" style="margin-bottom:14px;">Closing ends the period ${esc(niceDate(period.start_date))} to ${esc(niceDate(period.due_date))}. Unused hours can be extended as a courtesy carryover, which expires ${period.renewing ? '6' : '3'} months after the period ends${period.renewing ? ' (the client is renewing)' : ' (not renewing)'}.</p>
        ${field('Hours to carry over (optional)', `<input id="pc-carry" type="number" min="0" step="0.25" class="modal-input" placeholder="0">`)}
        <label class="tiny" style="display:flex; align-items:center; gap:6px; margin-bottom:10px;"><input id="pc-next" type="checkbox" onchange="document.getElementById('pc-next-box').style.display = this.checked ? 'block' : 'none'"> Start the next period on ${esc(niceDate(next))}</label>
        <div id="pc-next-box" style="display:none; margin-bottom:12px;">
            ${field('Next period tier', tierSelectHtml('pc-tier', 'pc-allot', ''))}
            ${field('Next period hours allotment', `<input id="pc-allot" type="number" min="0" step="0.25" class="modal-input" placeholder="e.g. 24" ${hoursOnInput('pc-tier', 'pc-allot')}>`)}
            <label class="tiny" style="display:flex; align-items:center; gap:6px;"><input id="pc-renew" type="checkbox"> Mark the next period as renewing</label>
        </div>
        <button class="btn primary" style="width:100%; justify-content:center;" onclick="OL.submitClosePeriod('${esc(periodId)}')">Close period</button></div>`);
}
export async function submitClosePeriod(periodId) {
    const { client, period } = findPeriod(periodId); if (!period) return;
    const res = await savePeriodClose(period, { carryoverHours: val('pc-carry'), renewNext: checked('pc-next'), nextAllotment: val('pc-allot'), nextRenewing: checked('pc-renew'), nextTier: val('pc-tier') });
    if (res.error) { alert(res.error); return; }
    OL.closeModal(); await reloadAndRedraw(client.id);
}

export function openAdHocPurchaseModal() {
    const client = getActiveClient(); if (!client) return;
    openModal(`${modalHead('Ad hoc purchase')}<div class="modal-body" style="padding-top:14px;">
        <p class="tiny muted" style="margin-bottom:14px;">Hours bought as needed. They expire one year after the purchase date.</p>
        ${field('Hours', `<input id="ah-hours" type="number" min="0" step="0.25" class="modal-input" placeholder="e.g. 10">`)}
        ${field('Purchase date', `<input id="ah-date" type="date" class="modal-input" value="${todayIso()}">`)}
        ${field('Note (optional)', `<input id="ah-note" type="text" class="modal-input" placeholder="e.g. Invoice 1042">`)}
        <button class="btn primary" style="width:100%; justify-content:center;" onclick="OL.submitAdHocPurchase()">Add hours</button></div>`);
}
export async function submitAdHocPurchase() {
    const client = getActiveClient(); if (!client) return;
    const res = await saveAdHoc(client.id, { hours: val('ah-hours'), purchasedOn: val('ah-date'), note: val('ah-note') });
    if (res.error) { alert(res.error); return; }
    OL.closeModal(); await reloadAndRedraw(client.id);
}

// ---------------- Client Requests ----------------
function closedNames() {
    const names = (typeof OL.getSystemStatuses === 'function' ? OL.getSystemStatuses() : []).filter((s) => s.isClosed).map((s) => s.name);
    return names.length ? names : ['Done'];
}

function requestRowHtml(client, item, position, today) {
    const w = deriveWorkStatus(item, client.projectData.clientTasks || [], { closedNames: closedNames() });
    const holder = w.role ? assigneeForRole(client, state.master?.roles || [], w.role === 'communication' ? /communicat/i : w.role === 'testing' ? /test/i : /implement/i, '') : '';
    const done = String(item.status || '') === 'Done';
    const color = done ? '#94a3b8' : w.status === 'pending_sphynx_action' ? '#64c6a2' : '#f59e0b';
    const age = requestAgeDays(item, today);
    const type = String(item.requestType || 'revision');
    const bar = typeof OL.requestTasksRowHtml === 'function' ? OL.requestTasksRowHtml(client, item, { editAction: 'OL.openMaintenanceRequestModal' }) : '';
    return `
        <div style="border-bottom:1px solid var(--line); ${done ? 'opacity:0.65;' : ''}">
            <div style="display:flex; align-items:center; gap:10px; padding:10px 12px; cursor:pointer;" onclick="OL.openMaintenanceRequestModal('${esc(item.id)}')">
                <div style="width:22px; text-align:center; color:var(--muted); font-weight:700;" title="${done ? 'Finished' : 'Place in the queue'}">${done ? '✓' : position}</div>
                <div style="flex:1; min-width:0;">
                    <strong style="display:block; font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(item.name || 'Request')}</strong>
                    <div class="tiny muted">${esc(type.charAt(0).toUpperCase() + type.slice(1))} · ${esc(SOURCE_LABEL[item.source] || 'Other')}${item.reporter ? ' · ' + esc(item.reporter) : ''} · received ${esc(niceDate(item.receivedAt))}${done ? '' : ` (${age} day${age === 1 ? '' : 's'} ago)`}</div>
                </div>
                ${holder ? `<span class="tiny muted" style="flex-shrink:0;">${esc(holder)}</span>` : ''}
                <span class="pill tiny" style="flex-shrink:0; border:1px solid ${color}; color:${color};">${esc(WORK_STATUS_LABELS[w.status] || w.status)}</span>
            </div>
            ${bar}
        </div>`;
}

export function renderClientRequests() {
    const main = document.getElementById('mainContent');
    const client = getActiveClient();
    if (!main) return;
    if (!client) { main.innerHTML = '<div class="card" style="padding:20px;">Pick a client first.</div>'; return; }

    const pd = client.projectData || {};

    // 1. All items across all scoping sheets
    const scopedItems = (pd.scopingSheets || []).flatMap(s => s?.lineItems || []);
    const scopedIds = new Set(scopedItems.map(i => String(i.id)));
    const scopedResourceIds = new Set(scopedItems.map(i => String(i.resourceId)).filter(Boolean));

    // 2. Standalone requests not on a scoping sheet
    const standaloneRequests = (pd.clientRequests || []).filter(r => !scopedIds.has(String(r.id)));

   // 3. Local resources not yet on a scoping sheet (always marked as Done)
    const unscopedResources = (pd.localResources || [])
        .filter(r => !scopedResourceIds.has(String(r.id)))
        .map(r => ({
            id: r.id,
            resourceId: r.id,
            name: r.name,
            requestType: r.type || 'build',
            status: 'Done'
        }));

    const allItems = [...scopedItems, ...standaloneRequests, ...unscopedResources];

    const openItems = allItems.filter(i => String(i.status || '') !== 'Done');
    const doneItems = allItems.filter(i => String(i.status || '') === 'Done');

    const today = todayIso();
    const showDone = !!OL._showDoneClientRequests;

    main.innerHTML = `
        <div class="section-header" style="display:flex; justify-content:space-between; align-items:flex-start;">
            <div><h2>📥 Client Requests</h2><div class="small muted">${esc(client.meta?.name || '')} · served first come, first served</div></div>
            <button class="btn primary" onclick="OL.openMaintenanceRequestModal()">+ Add request</button>
        </div>
        <div class="card" style="padding:0; overflow:hidden;">
            <div class="tiny bold uppercase muted" style="padding:10px 12px; border-bottom:1px solid var(--line);">Open (${openItems.length})</div>
            ${openItems.length ? openItems.map((item, i) => requestRowHtml(client, item, i + 1, today)).join('') : '<div class="tiny muted" style="padding:16px;">Nothing waiting. New requests from email, the portal, a meeting or a call go here.</div>'}
        </div>
        ${doneItems.length ? `
        <div class="card" style="padding:0; overflow:hidden; margin-top:16px;">
            <div class="tiny bold uppercase muted" style="padding:10px 12px; cursor:pointer;" onclick="OL._showDoneClientRequests = !OL._showDoneClientRequests; OL.renderClientRequests()">${showDone ? '▾' : '▸'} Finished (${doneItems.length})</div>${showDone ? doneItems.map((item) => requestRowHtml(client, item, '', today)).join('') : ''}
        </div>` : ''}`;

    if (window.lucide) window.lucide.createIcons();
}

export function openMaintenanceRequestModal(itemId) {
    const client = getActiveClient(); if (!client) return;
    const sheet = maintenanceSheetOf(client.projectData);
    const item = itemId ? sheet?.lineItems?.find((i) => String(i.id) === String(itemId)) : null;
    const isEdit = !!item;
    const done = String(item?.status || '') === 'Done';
    const opt = (v, l, cur) => `<option value="${esc(v)}" ${String(cur) === String(v) ? 'selected' : ''}>${esc(l)}</option>`;
    const covered = new Set((item?.resourceIds || []).map(String));
    const resources = (client.projectData?.localResources || []).filter((r) => r && !String(r.id).startsWith('step-'));
    openModal(`${modalHead(isEdit ? '✏️ Edit client request' : '➕ Add client request')}
        <div class="modal-body" style="padding-top:14px;">
            ${field('Title', `<input id="mr-title" type="text" class="modal-input" placeholder="e.g. Intake form redirect loops" value="${esc(item?.name || '')}" autofocus>`)}
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
                ${field('Type', `<select id="mr-type" class="modal-input">${getRequestTypes().map((t) => opt(t.key, t.label, item?.requestType || 'revision')).join('')}</select>`)}
                ${field('Came in by', `<select id="mr-source" class="modal-input">${REQUEST_SOURCES.map((s) => opt(s.key, s.label, item?.source || 'email')).join('')}</select>`)}
                ${field('Reported by', `<input id="mr-reporter" type="text" class="modal-input" placeholder="Name or email" value="${esc(item?.reporter || '')}">`)}
                ${field('Received', `<input id="mr-received" type="date" class="modal-input" value="${esc(item?.receivedAt || todayIso())}">`)}
            </div>
            ${resources.length ? field('Resources it touches (optional)', `<div style="max-height:130px; overflow-y:auto; border:1px solid var(--line); border-radius:6px; padding:6px 8px;">
                ${resources.map((r) => `<label class="tiny" style="display:flex; align-items:center; gap:6px; padding:2px 0;"><input type="checkbox" class="mr-res" value="${esc(r.id)}" ${covered.has(String(r.id)) ? 'checked' : ''}> ${esc(r.name || 'Untitled')}${r.type ? ` <span class="muted">(${esc(r.type)})</span>` : ''}</label>`).join('')}</div>`) : ''}
            ${field('Notes (optional)', `<textarea id="mr-notes" class="modal-input" rows="3">${esc(item?.notes || '')}</textarea>`)}
            ${isEdit && OL.renderDependencySection ? OL.renderDependencySection(client.id, 'request', item.id) : ''}
            ${isEdit && OL.renderRollupSection ? OL.renderRollupSection(client.id, 'request', item.id) : ''}
            <div style="display:flex; gap:10px; flex-wrap:wrap;">
                <button class="btn primary" style="flex:1; justify-content:center;" onclick="OL.saveMaintenanceRequest(${itemId ? `'${esc(itemId)}'` : 'null'})">${isEdit ? 'Save' : 'Add to the queue'}</button>
                ${isEdit ? `<button class="btn soft" onclick="OL.setMaintenanceRequestDone('${esc(itemId)}', ${done ? 'false' : 'true'})">${done ? 'Reopen' : 'Mark done'}</button>
                <button class="btn soft" style="color:#ef4444;" onclick="OL.deleteMaintenanceRequest('${esc(itemId)}')">Delete</button>` : ''}
            </div>
        </div>`);
    if (isEdit && OL.hydrateRollupSection) OL.hydrateRollupSection(client.id, 'request', item.id);
    if (isEdit) OL.setComposeContext?.({ kind: 'request', clientId: client.id, id: item.id });
}

function readRequestForm() {
    return {
        title: val('mr-title'), requestType: val('mr-type') || 'revision', source: val('mr-source') || 'manual', reporter: val('mr-reporter'),
        receivedAt: val('mr-received'), notes: val('mr-notes'),
        resourceIds: Array.from(document.querySelectorAll('.mr-res')).filter((c) => c.checked).map((c) => c.value),
    };
}

export async function saveMaintenanceRequest(itemId) {
    const client = getActiveClient(); if (!client) return;
    const form = readRequestForm();
    if (!form.title.trim()) { alert('Give the request a title.'); return; }
    const sheet = ensureMaintenanceSheet(client.projectData);
    const existing = itemId ? sheet.lineItems.find((i) => String(i.id) === String(itemId)) : null;
    const built = buildMaintenanceRequest({ ...form, id: existing?.id, resourceId: existing?.resourceId, status: existing?.status }, { uid, now: new Date().toISOString() });
    if (existing) {
        Object.assign(existing, { name: built.name, requestType: built.requestType, source: built.source, reporter: built.reporter, notes: built.notes, receivedAt: built.receivedAt });
        if (built.resourceIds) existing.resourceIds = built.resourceIds; else delete existing.resourceIds;
    } else {
        sheet.lineItems.push(built);
    }
    await persist();
    OL.closeModal();
    renderClientRequests();
}

export async function setMaintenanceRequestDone(itemId, isDone) {
    const client = getActiveClient();
    const item = maintenanceSheetOf(client?.projectData)?.lineItems?.find((i) => String(i.id) === String(itemId));
    if (!item) return;
    if (isDone) { item.status = 'Done'; item.doneAt = todayIso(); } else { item.status = 'Do Now'; delete item.doneAt; }
    await persist();
    OL.closeModal();
    renderClientRequests();
}

export async function deleteMaintenanceRequest(itemId) {
    const client = getActiveClient();
    const sheet = maintenanceSheetOf(client?.projectData);
    if (!sheet || !confirm('Delete this request? Its tasks stay, but they are no longer linked to a request.')) return;
    sheet.lineItems = sheet.lineItems.filter((i) => String(i.id) !== String(itemId));
    await persist();
    OL.closeModal();
    renderClientRequests();
}

window.OL = window.OL || {};
Object.assign(window.OL, {
    renderMaintenancePage, renderClientRequests, loadMaintenanceData,
    openStartPeriodModal, ppRecalc, maintTierPicked, maintHoursTyped, setTaskHoursGrant, openGrantTasksModal, submitGrantTasks, submitStartPeriod, openEditPeriodModal, submitEditPeriod, setPeriodRenewing,
    openClosePeriodModal, submitClosePeriod, openAdHocPurchaseModal, submitAdHocPurchase,
    openMaintenanceRequestModal, saveMaintenanceRequest, setMaintenanceRequestDone, deleteMaintenanceRequest,
    maintenanceTabAllowed,
});
