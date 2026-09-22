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
} from '../core/maintenance.js';

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
const slotFor = (clientId) => OL._maint[clientId] || { periods: [], grants: [], loaded: false };
const val = (id) => document.getElementById(id)?.value ?? '';
const checked = (id) => !!document.getElementById(id)?.checked;

function grantsTableHtml(slot) {
    const today = todayIso();
    if (!slot.grants.length) return '<div class="tiny muted">No hours grants yet.</div>';
    const rows = slot.grants.map((g) => {
        const left = daysBetween(today, g.expires_on);
        const soon = g.status === 'active' && left >= 0 && left <= 30;
        const statusColor = g.status === 'active' ? '#22c55e' : g.status === 'used_up' ? '#94a3b8' : '#ef4444';
        return `<tr>
            <td>${esc(GRANT_LABEL[g.source] || g.source)}${g.note ? `<div class="tiny muted">${esc(g.note)}</div>` : ''}</td>
            <td style="text-align:right;">${esc(hoursText(g.hours_granted))}</td>
            <td>${esc(niceDate(g.granted_on))}</td>
            <td style="${soon ? 'color:#f59e0b; font-weight:600;' : ''}">${esc(niceDate(g.expires_on))}${g.status === 'active' ? ` <span class="tiny muted">${left >= 0 ? `${left} day${left === 1 ? '' : 's'} left` : 'past'}</span>` : ''}</td>
            <td><span class="pill tiny" style="border:1px solid ${statusColor}; color:${statusColor};">${esc(g.status.replace('_', ' '))}</span>${Number(g.hours_expired) > 0 ? `<div class="tiny muted">${esc(hoursText(g.hours_expired))} written off</div>` : ''}</td>
        </tr>`;
    }).join('');
    return `<div style="overflow-x:auto;"><table class="data-table" style="width:100%; font-size:12px; border-collapse:collapse;">
        <thead><tr style="text-align:left;" class="tiny muted uppercase"><th>Source</th><th style="text-align:right;">Granted</th><th>Granted on</th><th>Expires</th><th>Status</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
        <div class="tiny muted" style="margin-top:6px;">Hours used against each grant will show here once time is logged against maintenance.</div>`;
}

function periodCardHtml(client, slot) {
    const active = slot.periods.find((p) => p.status === 'active');
    const today = todayIso();
    if (!active) {
        return `
            <div class="card" style="padding:16px; border-left:3px solid #f59e0b;">
                <div class="bold">No active plan period</div>
                <div class="tiny muted" style="margin:4px 0 10px;">Ongoing Maintenance runs in annual plan periods, each with its hours allotment. Start one to give the client its hours.</div>
                <button class="btn primary" onclick="OL.openStartPeriodModal()">Start a plan period</button>
            </div>`;
    }
    const pr = periodProgress(active, today);
    const allot = slot.grants.filter((g) => g.period_id === active.id && g.source === 'plan_allotment').reduce((s, g) => s + Number(g.hours_granted), 0);
    const barColor = pr.overdue ? '#ef4444' : pr.daysLeft <= 30 ? '#f59e0b' : '#22c55e';
    return `
        <div class="card" style="padding:16px;">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px; flex-wrap:wrap;">
                <div>
                    <div class="tiny muted uppercase bold">Current plan period</div>
                    <div style="font-size:16px; font-weight:700; margin:2px 0;">${esc(niceDate(active.start_date))} to ${esc(niceDate(active.due_date))}</div>
                    <div class="tiny muted">${esc(hoursText(allot))} allotment</div>
                </div>
                <div style="display:flex; gap:8px; align-items:center;">
                    <label class="tiny" style="display:flex; align-items:center; gap:6px; cursor:pointer;" title="Renewing clients get a 6 month carryover instead of 3">
                        <input type="checkbox" ${active.renewing ? 'checked' : ''} onchange="OL.setPeriodRenewing('${esc(active.id)}', this.checked)"> Renewing
                    </label>
                    <button class="btn tiny soft" onclick="OL.openEditPeriodModal('${esc(active.id)}')">Edit</button>
                    <button class="btn tiny primary" onclick="OL.openClosePeriodModal('${esc(active.id)}')">Close period…</button>
                </div>
            </div>
            <div style="height:8px; border-radius:6px; background:rgba(148,163,184,0.25); overflow:hidden; margin:12px 0 6px;"><div style="height:100%; width:${pr.pct}%; background:${barColor};"></div></div>
            <div class="tiny" style="color:${pr.overdue ? '#ef4444' : 'var(--muted)'};">${pr.notStarted ? 'Starts ' + esc(niceDate(active.start_date)) : pr.overdue ? `This period ended ${-pr.daysLeft} day${pr.daysLeft === -1 ? '' : 's'} ago. Close it, and renew if the client is continuing.` : `${pr.daysLeft} day${pr.daysLeft === 1 ? '' : 's'} left (${pr.pct}% through the year)`}</div>
        </div>`;
}

export function renderMaintenancePage() {
    const main = document.getElementById('mainContent');
    const client = getActiveClient();
    if (!main) return;
    if (!client) { main.innerHTML = '<div class="card" style="padding:20px;">Pick a client first.</div>'; return; }
    const mode = maintenanceMode(client);
    if (mode === null) {
        main.innerHTML = `<div class="section-header"><h2>🛠 Maintenance &amp; Hours</h2></div>
            <div class="card" style="padding:20px;">This client's pipeline label is "${esc(client.meta?.status || 'not set')}". Set it to <strong>Ongoing Maintenance</strong> or <strong>Ad Hoc Maintenance</strong> to manage plan periods and hours here.</div>`;
        return;
    }
    const slot = slotFor(client.id);
    if (!slot.loaded && !slot.loading) loadMaintenanceData(client.id).then(() => renderMaintenancePage());
    const periods = slot.periods;
    const history = periods.filter((p) => p.status !== 'active');
    const body = !slot.loaded ? '<div class="tiny muted">Loading...</div>' : slot.error ? `<div class="card" style="padding:16px; border-left:3px solid #ef4444;">Could not load the maintenance data: ${esc(slot.error)}</div>` : `
        ${mode === ONGOING ? periodCardHtml(client, slot) : `
            <div class="card" style="padding:16px;"><div class="bold">Ad Hoc Maintenance</div>
            <div class="tiny muted" style="margin-top:4px;">There are no plan periods. Hours are bought as needed and expire one year after purchase.</div></div>`}
        <div class="card" style="padding:16px; margin-top:16px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                <h3 style="margin:0;">Hours grants</h3>
                <button class="btn tiny soft" onclick="OL.openAdHocPurchaseModal()">+ Ad hoc purchase</button>
            </div>
            ${grantsTableHtml(slot)}
        </div>
        ${mode === ONGOING && history.length ? `
        <div class="card" style="padding:16px; margin-top:16px;"><h3 style="margin:0 0 10px;">Earlier plan periods</h3>
            ${history.map((p) => `<div style="display:flex; justify-content:space-between; padding:6px 0; border-top:1px solid var(--line);" class="tiny"><span>${esc(niceDate(p.start_date))} to ${esc(niceDate(p.due_date))}</span><span class="muted">${esc(p.status)}${p.renewing ? ' · renewing' : ''}</span></div>`).join('')}
        </div>` : ''}`;
    main.innerHTML = `
        <div class="section-header"><div><h2>🛠 Maintenance &amp; Hours</h2>
            <div class="small muted">${esc(client.meta?.name || '')} · <span class="pill tiny soft">${mode === ONGOING ? 'Ongoing Maintenance' : 'Ad Hoc Maintenance'}</span></div></div></div>
        ${body}`;
    if (window.lucide) window.lucide.createIcons();
}

const redraw = () => { if (document.getElementById('mainContent') && String(window.location.hash).includes('maintenance')) renderMaintenancePage(); };
async function reloadAndRedraw(clientId) { await loadMaintenanceData(clientId); redraw(); }
const modalHead = (title) => `<div class="modal-head" style="display:flex; justify-content:space-between; align-items:center; padding-bottom:12px; border-bottom:1px solid var(--line);"><div class="modal-title-text" style="font-weight:700; font-size:16px;">${title}</div><button class="btn small soft" onclick="OL.closeModal()">Cancel</button></div>`;
const field = (label, inner) => `<div style="display:flex; flex-direction:column; gap:4px; margin-bottom:12px;"><label class="tiny muted" style="font-size:10px; font-weight:600;">${label}</label>${inner}</div>`;

export function openStartPeriodModal() {
    const client = getActiveClient(); if (!client) return;
    const start = todayIso();
    openModal(`${modalHead('Start a plan period')}<div class="modal-body" style="padding-top:14px;">
        <p class="tiny muted" style="margin-bottom:14px;">A plan period lasts one calendar year. Its hours allotment becomes an hours grant that expires when the period ends.</p>
        ${field('Start date', `<input id="pp-start" type="date" class="modal-input" value="${start}" oninput="OL.ppRecalc()">`)}
        <div id="pp-due" class="tiny muted" style="margin:-6px 0 12px;">Ends ${esc(niceDate(periodDue(start)))}</div>
        ${field('Hours allotment', `<input id="pp-allot" type="number" min="0" step="0.25" class="modal-input" placeholder="e.g. 40">`)}
        <label class="tiny" style="display:flex; align-items:center; gap:6px; margin-bottom:16px;"><input id="pp-renew" type="checkbox"> The client is renewing</label>
        <button class="btn primary" style="width:100%; justify-content:center;" onclick="OL.submitStartPeriod()">Start period</button></div>`);
}
export function ppRecalc() {
    const s = val('pp-start'); const el = document.getElementById('pp-due');
    if (el) el.textContent = validDate(s) ? `Ends ${niceDate(periodDue(s))}` : 'Enter a valid start date';
}
export async function submitStartPeriod() {
    const client = getActiveClient(); if (!client) return;
    const res = await savePeriodStart(client.id, { start: val('pp-start'), allotment: val('pp-allot'), renewing: checked('pp-renew') });
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
        ${field('Hours allotment', `<input id="pe-allot" type="number" min="0" step="0.25" class="modal-input" value="${allot || ''}">`)}
        <div class="tiny muted" style="margin-bottom:14px;">Changing the dates or hours updates the allotment grant, and any unused carryover from this period.</div>
        <button class="btn primary" style="width:100%; justify-content:center;" onclick="OL.submitEditPeriod('${esc(periodId)}')">Save</button></div>`);
}
export async function submitEditPeriod(periodId) {
    const { client, period, grants } = findPeriod(periodId); if (!period) return;
    const patch = { start_date: val('pe-start'), due_date: val('pe-due') };
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
            ${field('Next period hours allotment', `<input id="pc-allot" type="number" min="0" step="0.25" class="modal-input" placeholder="e.g. 40">`)}
            <label class="tiny" style="display:flex; align-items:center; gap:6px;"><input id="pc-renew" type="checkbox"> Mark the next period as renewing</label>
        </div>
        <button class="btn primary" style="width:100%; justify-content:center;" onclick="OL.submitClosePeriod('${esc(periodId)}')">Close period</button></div>`);
}
export async function submitClosePeriod(periodId) {
    const { client, period } = findPeriod(periodId); if (!period) return;
    const res = await savePeriodClose(period, { carryoverHours: val('pc-carry'), renewNext: checked('pc-next'), nextAllotment: val('pc-allot'), nextRenewing: checked('pc-renew') });
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
            <div style="display:flex; gap:10px; flex-wrap:wrap;">
                <button class="btn primary" style="flex:1; justify-content:center;" onclick="OL.saveMaintenanceRequest(${itemId ? `'${esc(itemId)}'` : 'null'})">${isEdit ? 'Save' : 'Add to the queue'}</button>
                ${isEdit ? `<button class="btn soft" onclick="OL.setMaintenanceRequestDone('${esc(itemId)}', ${done ? 'false' : 'true'})">${done ? 'Reopen' : 'Mark done'}</button>
                <button class="btn soft" style="color:#ef4444;" onclick="OL.deleteMaintenanceRequest('${esc(itemId)}')">Delete</button>` : ''}
            </div>
        </div>`);
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
    openStartPeriodModal, ppRecalc, submitStartPeriod, openEditPeriodModal, submitEditPeriod, setPeriodRenewing,
    openClosePeriodModal, submitClosePeriod, openAdHocPurchaseModal, submitAdHocPurchase,
    openMaintenanceRequestModal, saveMaintenanceRequest, setMaintenanceRequestDone, deleteMaintenanceRequest,
    maintenanceTabAllowed,
});
