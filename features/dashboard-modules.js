//======================= FEATURES / DASHBOARD MODULES =======================//
// Optional modules on the global dashboard (the numbers come from core/dashboard-modules.js). Each person chooses which
// are shown; the choice is remembered in this browser for that person. A "team meeting" preset turns on the set used
// when the team looks at the dashboard together.
//
// The dashboard (features/business/dashboard.js) calls OL.dashboardModulesHtml() where the modules go, and
// OL.loadDashboardModules() after drawing, which loads the review data and repaints just this area.

import { state, esc, db, getCurrentUserName } from '../core/data.js';
import { roundStatusOf } from '../core/requests.js';
import { isClientWaitingStatus } from '../core/work-status.js';
import { memberDayHours, dailyLoadHours, workdayGoneHours } from '../core/scheduling.js';
import {
    MODULES, DEFAULT_ON, TEAM_PRESET, weekDays, availabilityGrid, pendingReviewRollup, readyNotSent, leadsWaiting,
    followUpsDue, waitingByAge, hoursBlocksNearing, reviewsEnding,
} from '../core/dashboard-modules.js';

const view = { mode: 'week', offset: 0 };          // the Availability module
let reviewData = null;                              // { reviews, itemsByReview, reviewedTaskIds, at } once loaded

const todayStr = () => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const closedNames = () => { const n = (OL.getSystemStatuses ? OL.getSystemStatuses() : []).filter((s) => s.isClosed).map((s) => s.name); return n.length ? n : ['Done']; };
const loadedClients = () => Object.values(state.clients || {}).filter((c) => c && c.projectData && !c._metaOnly);

// ---- who sees what ----------------------------------------------------------------------------------------------
const storeKey = () => `ol_dash_modules_v1:${getCurrentUserName() || 'me'}`;
function enabled() {
    try { const v = JSON.parse(localStorage.getItem(storeKey()) || 'null'); if (Array.isArray(v)) return v.filter((k) => MODULES.some((m) => m.key === k)); } catch (e) { /* use the default */ }
    return DEFAULT_ON.slice();
}
function setEnabled(list) { try { localStorage.setItem(storeKey(), JSON.stringify(list)); } catch (e) { /* not saved this time */ } }

// ---- small pieces -----------------------------------------------------------------------------------------------
const chip = (text, color) => `<span class="pill tiny" style="background:${color}22;color:${color};border:1px solid transparent;cursor:default;white-space:nowrap;">${esc(text)}</span>`;
const row = (client, clientId, sub, right) => `
    <div onclick="OL.switchClient && OL.switchClient('${esc(String(clientId))}')" style="display:flex;gap:10px;align-items:center;padding:6px 0;border-bottom:1px solid var(--line);cursor:pointer;">
        <div style="flex:1;min-width:0;"><div style="font-weight:600;font-size:13px;overflow-wrap:anywhere;">${esc(client)}</div><div class="tiny muted">${esc(sub)}</div></div>${right || ''}</div>`;
const empty = (t) => `<div class="tiny muted" style="padding:6px 0;">${esc(t)}</div>`;
function card(m, count, body, extra = '') {
    return `<div class="card" style="padding:14px 16px;min-width:0;">
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;">
            <i data-lucide="${m.icon}" style="width:16px;height:16px;color:var(--accent);"></i><b style="font-size:14px;">${esc(m.label)}</b>
            ${count !== '' ? `<span class="pill tiny soft" style="cursor:default;">${esc(String(count))}</span>` : ''}${extra}</div>${body}</div>`;
}

// ---- availability ----------------------------------------------------------------------------------------------
function availabilityBody() {
    const people = (state.master?.sphynxTeam || []).map((m) => m.name).filter(Boolean);
    if (!people.length) return { count: '', body: empty('No team members yet.'), extra: '' };
    const events = OL._dashboardEventsCache || [];
    const tasks = loadedClients().flatMap((c) => c.projectData.clientTasks || []);
    const today = todayStr();
    const days = view.mode === 'today' ? [today] : weekDays(today, view.offset);
    const grid = availabilityGrid({
        people, days,
        capacityFor: (n, d) => memberDayHours(n, d) - workdayGoneHours(events, n, d),   // today: minus the time already gone
        loadFor: (n, d) => dailyLoadHours(events, tasks, n, d),
    });
    const label = (d) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
    const colour = (h) => (h <= 0 ? '#f87171' : h <= 2 ? '#f5b942' : '#2dd4bf');
    const seg = `<span style="display:inline-flex;border:1px solid var(--line);border-radius:8px;overflow:hidden;font-size:12px;margin-left:auto;">
        <span onclick="OL.dashAvail('mode','today')" style="padding:3px 10px;cursor:pointer;${view.mode === 'today' ? 'background:rgba(45,212,191,.14);color:#2dd4bf;font-weight:600;' : ''}">Today</span>
        <span onclick="OL.dashAvail('mode','week')" style="padding:3px 10px;cursor:pointer;${view.mode === 'week' ? 'background:rgba(45,212,191,.14);color:#2dd4bf;font-weight:600;' : ''}">Week</span></span>`;
    const nav = view.mode === 'week' ? `<button class="btn tiny soft" onclick="OL.dashAvail('offset',${view.offset - 1})">‹</button>
        <button class="btn tiny soft" onclick="OL.dashAvail('offset',0)">This week</button><button class="btn tiny soft" onclick="OL.dashAvail('offset',${view.offset + 1})">›</button>` : '';
    const head = `<div style="display:flex;gap:6px;align-items:center;font-size:11.5px;" class="muted"><span style="width:110px;flex:none;"></span>${days.map((d) => `<span style="flex:1;text-align:center;${d === today ? 'color:#2dd4bf;font-weight:700;' : ''}">${esc(label(d))}</span>`).join('')}${view.mode === 'week' ? '<span style="width:54px;text-align:right;">Week</span>' : ''}</div>`;
    const rows = grid.map((g) => `<div style="display:flex;gap:6px;align-items:center;font-size:13px;margin-top:6px;"><span style="width:110px;flex:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(g.name)}</span>
        ${g.days.map((c) => `<span style="flex:1;text-align:center;background:${colour(c.free)}22;color:${colour(c.free)};border-radius:7px;padding:4px 0;font-size:12.5px;font-weight:600;">${c.free} h</span>`).join('')}
        ${view.mode === 'week' ? `<span class="muted" style="width:54px;text-align:right;">${g.total} h</span>` : ''}</div>`).join('');
    return { count: '', body: `<div style="display:flex;gap:6px;align-items:center;margin-bottom:8px;">${nav}</div>${head}${rows}<div class="tiny muted" style="margin-top:8px;">Hours free after meetings and scheduled tasks. Days off and part-days come from each person's schedule.</div>`, extra: seg };
}

export function dashAvail(key, value) { view[key] = value; if (key === 'mode') view.offset = 0; paint(); }

// ---- the other modules ------------------------------------------------------------------------------------------
function bodyFor(key) {
    const clients = loadedClients();
    const today = todayStr();
    const base = { clients, closedNames: closedNames(), today };
    if (key === 'availability') return availabilityBody();
    if (key === 'pending_review') {
        if (!reviewData) return { count: '', body: empty('Loading...'), extra: '' };
        const byId = Object.fromEntries(clients.map((c) => [c.id, c]));
        const rows = pendingReviewRollup({ reviews: reviewData.reviews, itemsByReview: reviewData.itemsByReview, clientsById: byId, today });
        const stale = readyNotSent({ ...base, reviewedTaskIds: reviewData.reviewedTaskIds });
        const body = (rows.map((r) => row(r.client, r.clientId, `${r.open} waiting${r.sentBy ? ` · sent by ${r.sentBy}` : ''}${r.followUpOwner ? ` · follow-up ${r.followUpOwner}` : ''}`, r.age !== null ? chip(`Day ${r.age}`, '#a78bfa') : '')).join('')
            + stale.map((s) => row(s.client, s.clientId, `${s.count} closed item${s.count === 1 ? '' : 's'} not sent for review`, chip(`${s.age} days`, '#f5b942'))).join('')) || empty('Nothing waiting on a client review.');
        return { count: rows.length + stale.length, body, extra: '' };
    }
    if (key === 'leads') {
        const list = leadsWaiting({ ...base, roundStatusOf });
        return { count: list.length, extra: '', body: list.map((l) => row(l.client, l.clientId, `${l.what} · waiting on ${l.waitingOn === 'us' ? 'us' : 'the client'}${l.waitingOn === 'us' ? ` · ${l.age} day${l.age === 1 ? '' : 's'}` : ''}`, l.late ? chip('Late', '#f87171') : l.waitingOn === 'us' ? chip('On time', '#2dd4bf') : '')).join('') || empty('No leads waiting.') };
    }
    if (key === 'follow_ups') {
        const list = followUpsDue(base);
        return { count: list.length, extra: '', body: list.map((f) => row(f.client, f.clientId, `${f.owner || 'Unassigned'} · due ${f.due}`, f.overdueDays ? chip(`Overdue ${f.overdueDays}d`, '#f87171') : '')).join('') || empty('No follow-ups due in the next 5 days.') };
    }
    if (key === 'waiting_age') {
        const list = waitingByAge({ ...base, isClientWaiting: isClientWaitingStatus });
        return { count: list.length, extra: '', body: list.map((w) => row(w.client, w.clientId, `${w.count} item${w.count === 1 ? '' : 's'} waiting`, chip(`Oldest ${w.oldest}d`, w.oldest >= 10 ? '#f87171' : '#f5b942'))).join('') || empty('Nothing has waited 3 days or more.') };
    }
    if (key === 'hours_blocks') {
        const list = hoursBlocksNearing(base);
        return { count: list.length, extra: '', body: list.map((h) => row(h.client, h.clientId, 'Hours block reminder is open', chip(`${h.pct}%`, h.pct >= 95 ? '#f87171' : '#f5b942'))).join('') || empty('No hours block needs attention.') };
    }
    if (key === 'reviews_ending') {
        const list = reviewsEnding(base);
        return { count: list.length, extra: '', body: list.map((r) => row(r.client, r.clientId, `Round ${r.round} · ends ${r.ends}`, chip(r.daysLeft < 0 ? 'Ended' : `${r.daysLeft}d left`, r.daysLeft <= 2 ? '#f87171' : '#f5b942'))).join('') || empty('No review period ends in the next 7 days.') };
    }
    return { count: '', body: '', extra: '' };
}

// Which tile is open (click again to close). Kept for the session only.
let openKey = '';
// The four headline numbers from the dashboard (Active Clients, ...) so they sit in the same row as the module tiles.
let stats = [];
export function dashSetStats(list) { stats = Array.isArray(list) ? list : []; }
function statTile(st) {
    return `<div style="width:128px;height:112px;flex:none;padding:10px 10px 8px;border-radius:12px;display:flex;flex-direction:column;justify-content:space-between;background:var(--panel);border:1px solid var(--line);">
        <span style="height:16px;"></span>
        <span style="font-size:30px;font-weight:700;line-height:1;color:${st.color || 'inherit'};">${esc(String(st.value))}</span>
        <span style="font-size:11px;line-height:1.2;opacity:.8;">${esc(st.label)}</span></div>`;
}
export function dashTile(key) { openKey = openKey === key ? '' : key; paint(); }

// One small square: icon, a big count, the name. It turns amber when something is waiting and shows an outline when open.
function tile(m, b) {
    const open = openKey === m.key;
    const n = b.count === '' ? null : Number(b.count);
    const hot = n !== null && Number.isFinite(n) && n > 0;
    return `<button type="button" onclick="OL.dashTile('${esc(m.key)}')" title="${esc(m.label)}" aria-expanded="${open}"
        style="width:128px;height:112px;flex:none;padding:10px 10px 8px;border-radius:12px;cursor:pointer;text-align:left;display:flex;flex-direction:column;justify-content:space-between;
               background:var(--panel);color:inherit;font:inherit;border:1px solid ${open ? 'var(--accent)' : 'var(--line)'};${open ? 'box-shadow:0 0 0 1px var(--accent);' : ''}">
        <span style="display:flex;align-items:center;justify-content:space-between;"><i data-lucide="${m.icon}" style="width:16px;height:16px;color:var(--accent);"></i>
            <i data-lucide="${open ? 'chevron-up' : 'chevron-down'}" style="width:13px;height:13px;opacity:.6;"></i></span>
        <span style="font-size:30px;font-weight:700;line-height:1;color:${hot ? '#f5b942' : 'inherit'};">${n === null ? '...' : esc(String(b.count))}</span>
        <span style="font-size:11px;line-height:1.2;opacity:.8;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;">${esc(m.label)}</span></button>`;
}

export function dashboardModulesHtml() {
    const on = enabled();
    const list = MODULES.filter((m) => on.includes(m.key));
    if (openKey && !list.some((m) => m.key === openKey)) openKey = '';
    const avail = list.find((m) => m.key === 'availability');
    const others = list.filter((m) => m.key !== 'availability').map((m) => ({ m, b: bodyFor(m.key) }));
    const openOne = others.find((x) => x.m.key === openKey);
    const availHtml = avail ? (() => { const b = bodyFor('availability'); return `<div style="margin-bottom:14px;">${card(avail, b.count, b.body, b.extra)}</div>`; })() : '';
    const tiles = (others.length || stats.length) ? `<div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:${openOne ? '12px' : '25px'};">${stats.map(statTile).join('')}${others.map((x) => tile(x.m, x.b)).join('')}</div>` : '';
    const opened = openOne ? `<div style="margin-bottom:25px;">${card(openOne.m, openOne.b.count, openOne.b.body, `<button class="btn tiny soft" style="margin-left:auto;" onclick="OL.dashTile('${esc(openOne.m.key)}')">Close</button>`)}</div>` : '';
    return `
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;">
        <b style="font-size:14px;">Modules</b><span class="tiny muted">Shown for you. Click a square to open it.</span>
        <span style="margin-left:auto;display:flex;gap:8px;">
            <button class="btn tiny soft" onclick="OL.dashModulesPreset()" style="display:inline-flex;gap:5px;align-items:center;"><i data-lucide="users" style="width:12px;height:12px;"></i>Team meeting preset</button>
            <button class="btn tiny soft" onclick="OL.dashModulesOpen()" style="display:inline-flex;gap:5px;align-items:center;"><i data-lucide="layout-grid" style="width:12px;height:12px;"></i>Customize</button></span></div>
    ${list.length || stats.length ? `${availHtml}${tiles}${opened}` : '<div class="tiny muted" style="margin-bottom:25px;">No modules are switched on.</div>'}`;
}

function paint() {
    const el = document.getElementById('dashboard-modules');
    if (!el) return;
    el.innerHTML = dashboardModulesHtml();
    if (window.lucide) window.lucide.createIcons();
}

// Loads the sent reviews (and which tasks are in any review) for every project, then repaints the modules.
export async function loadDashboardModules() {
    paint();
    if (!enabled().includes('pending_review') || (reviewData && Date.now() - reviewData.at < 60000)) return;
    try {
        const r = await db.from('reviews').select('id, client_id, status, sent_at, sent_by, follow_up_owner').order('created_at', { ascending: false }).limit(500);
        if (r.error) throw r.error;
        const reviews = r.data || [];
        const i = reviews.length ? await db.from('review_items').select('review_id, item_type, item_id, outcome').in('review_id', reviews.map((x) => x.id)) : { data: [] };
        if (i.error) throw i.error;
        const itemsByReview = {};
        const reviewedTaskIds = new Set();
        const clientOfReview = Object.fromEntries(reviews.map((x) => [x.id, x.client_id]));
        (i.data || []).forEach((it) => {
            (itemsByReview[it.review_id] = itemsByReview[it.review_id] || []).push(it);
            if (it.item_type === 'task' && it.outcome !== 'change_requested') reviewedTaskIds.add(`${clientOfReview[it.review_id]}:${it.item_id}`);
        });
        reviewData = { reviews, itemsByReview, reviewedTaskIds, at: Date.now() };
    } catch (e) {
        console.warn('Review data for the dashboard is unavailable (run the Step 1 migration?):', e?.message || e);
        reviewData = { reviews: [], itemsByReview: {}, reviewedTaskIds: new Set(), at: Date.now() };
    }
    paint();
}

// ---- customizing ------------------------------------------------------------------------------------------------
export function dashModulesPreset() { setEnabled(TEAM_PRESET.slice()); loadDashboardModules(); }
export function dashModuleToggle(key) {
    const on = enabled();
    setEnabled(on.includes(key) ? on.filter((k) => k !== key) : [...on, key]);
    dashModulesOpen(); loadDashboardModules();
}
export function dashModulesOpen() {
    const on = enabled();
    const rows = MODULES.map((m) => `
        <div onclick="OL.dashModuleToggle('${m.key}')" style="display:flex;gap:12px;align-items:center;padding:10px 0;border-bottom:1px solid var(--line);cursor:pointer;">
            <i data-lucide="${m.icon}" style="width:16px;height:16px;color:var(--accent);"></i><span style="flex:1;font-size:14px;">${esc(m.label)}${m.team ? ' <span class="tiny muted">· in the team meeting preset</span>' : ''}</span>
            <span style="width:34px;height:20px;border-radius:999px;background:${on.includes(m.key) ? '#2dd4bf' : 'transparent'};border:1px solid ${on.includes(m.key) ? '#2dd4bf' : '#3a4a66'};position:relative;display:inline-block;">
                <span style="position:absolute;top:2px;${on.includes(m.key) ? 'right' : 'left'}:2px;width:14px;height:14px;border-radius:50%;background:${on.includes(m.key) ? '#04201c' : '#9aa7bd'};"></span></span></div>`).join('');
    const html = `
    <div class="modal-head"><div class="modal-title-text"><i data-lucide="layout-grid" style="width:16px;height:16px;vertical-align:sub;margin-right:6px;"></i>Dashboard modules</div>
        <button class="btn small soft" onclick="OL.closeModal()">✕</button></div>
    <div class="modal-body" style="width:100%;box-sizing:border-box;">${rows}
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px;">
            <button class="btn soft" onclick="OL.dashModulesPreset(); OL.dashModulesOpen();">Team meeting preset</button>
            <button class="btn primary" onclick="OL.closeModal()">Done</button></div></div>`;
    if (document.querySelector('.modal-box.modal-wide')) document.querySelector('.modal-box.modal-wide').innerHTML = html;
    else OL.showOverlayModal(html, { wide: true });
    if (window.lucide) window.lucide.createIcons();
}

window.OL = window.OL || {};
Object.assign(window.OL, { dashSetStats, dashTile, dashboardModulesHtml, loadDashboardModules, dashAvail, dashModulesPreset, dashModuleToggle, dashModulesOpen });
