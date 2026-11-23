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
import { isOngoing } from '../core/maintenance.js';
import { memberDayHours, dailyLoadHours, workdayGoneHours } from '../core/scheduling.js';
import {
    MODULES, DEFAULT_ON, TEAM_PRESET, easternDay, rollingDays, monthWeeks, availabilityGrid, pendingReviewRollup, readyNotSent, leadsWaiting,
    followUpsDue, waitingByAge, hoursBlocksNearing, reviewsEnding, plansExpiring,
} from '../core/dashboard-modules.js';

const view = { mode: 'week', offset: 0 };          // the Availability module: 'today', 'week' (a rolling 5 working days from today) or 'month'
const MAX_WEEK_OFFSET = 8, MAX_MONTH_OFFSET = 1;   // the dashboard's calendar events only reach about 60 days ahead
let planPeriods = null;                             // { rows, at }: every maintenance_plan_period row, once loaded
let appUpdates = null;                              // { items, updatedAt, actions, actionsError, showHandled } from app-updates/digest.json, or { error }
const updKey = (i) => `${i.app}|${i.date}|${String(i.summary || '').slice(0, 80)}`;   // same key the star button uses
// ---- app updates: connection suggestions ------------------------------------------------------------------------
// Names that are also everyday words. They are still scanned, but only on an exact-case match ("Box", not "box").
// Other ways an update may name an app on the list.
const APP_ALIASES = {
    'Google Workspace': ['Google Docs', 'Google Sheets', 'Google Slides', 'Google Drive', 'Google Calendar', 'Gmail', 'Google Forms'],
    'Office 365': ['Microsoft 365', 'Outlook', 'Microsoft Outlook', 'Microsoft Excel', 'Microsoft Word'],
    'Microsoft Teams': ['MS Teams'],
    'Fireflies.ai': ['Fireflies'],
    'Hazel (Altruist AI platform for advisors)': ['Hazel'],
    'SSG (custodian)': ['SSG'],
    'Zoom Phone': [],
};
const AMBIGUOUS_APP_NAMES = new Set(['kit', 'wave', 'box', 'monday', 'allo', 'quo', 'keeper', 'wix', 'wealth', 'notion', 'levitate', 'fathom', 'granola', 'canva', 'loom', 'slack']);
const APP_NAME_CLEAN = (n) => String(n || '').replace(/\s*\(.*?\)\s*/g, ' ').trim();
const escRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// One entry per app the dashboard knows: { name, re }. Built from the watchlist plus the Master Library apps.
function buildAppMatchers(watchNames) {
    const byName = new Map();
    const add = (raw) => {
        const name = APP_NAME_CLEAN(raw);
        if (name.length < 3 || byName.has(name.toLowerCase())) return;
        const terms = [name, ...(APP_ALIASES[raw] || APP_ALIASES[name] || [])];
        const mk = (list, flags) => list.length ? new RegExp(`(^|[^A-Za-z0-9])(${list.sort((a, b) => b.length - a.length).map(escRe).join('|')})(?![A-Za-z0-9])`, flags) : null;
        const loose = mk(terms.filter((t) => !AMBIGUOUS_APP_NAMES.has(t.toLowerCase())), 'i');
        const exact = mk(terms.filter((t) => AMBIGUOUS_APP_NAMES.has(t.toLowerCase())), '');
        byName.set(name.toLowerCase(), { name, test: (text) => !!((loose && loose.test(text)) || (exact && exact.test(text))) });
    };
    (watchNames || []).forEach(add);
    (state.master?.apps || []).forEach((a) => a && a.name && add(a.name));
    return [...byName.values()];
}

// For one update: the other apps its text names, and a possible connection between its app and each of them.
function connectionSuggestions(item, matchers) {
    const self = APP_NAME_CLEAN(item.app).toLowerCase();
    const text = String(item.summary || '');
    const mentionsLink = /integrat|connect|sync|\bAPI\b|webhook|native|import|export/i.test(text);
    const out = [];
    matchers.forEach((m) => {
        if (m.name.toLowerCase() === self || self.includes(m.name.toLowerCase()) || m.name.toLowerCase().includes(self)) return;
        if (!m.test(text)) return;
        const viaZapier = !/zapier/i.test(item.app + ' ' + m.name);
        out.push({ a: APP_NAME_CLEAN(item.app), b: m.name, how: mentionsLink ? 'update mentions an integration' : viaZapier ? 'possible via Zapier' : 'possible direct connection' });
    });
    return out;
}

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
    const today = easternDay();                         // rolls over at midnight Eastern; see the timer at the bottom
    availabilityDay = today;
    const month = view.mode === 'month' ? monthWeeks(today, view.offset) : null;
    const days = view.mode === 'today' ? [today] : month ? month.weeks.flat() : rollingDays(today, view.offset);
    const grid = availabilityGrid({
        people, days,
        capacityFor: (n, d) => (d < today ? 0 : memberDayHours(n, d) - workdayGoneHours(events, n, d)),   // a past day has nothing left to give; today: minus the time already gone
        loadFor: (n, d) => dailyLoadHours(events, tasks, n, d),
    });
    const short = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
    const label = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', timeZone: 'UTC' });
    const colour = (h) => (h <= 0 ? '#f87171' : h <= 2 ? '#f5b942' : '#2dd4bf');
    // Columns: one per day, or one per week in the month view (each week's free hours added up; coloured by the daily average).
    const cols = month
        ? month.weeks.map((w) => ({ title: w.length > 1 ? `${short(w[0])}–${short(w[w.length - 1])}` : short(w[0]), days: w, now: w.includes(today) }))
        : days.map((d) => ({ title: label(d), days: [d], now: d === today }));
    const seg1 = (key, text) => `<span onclick="OL.dashAvail('mode','${key}')" style="padding:3px 10px;cursor:pointer;${view.mode === key ? 'background:rgba(45,212,191,.14);color:#2dd4bf;font-weight:600;' : ''}">${text}</span>`;
    const seg = `<span style="display:inline-flex;border:1px solid var(--line);border-radius:8px;overflow:hidden;font-size:12px;margin-left:auto;">${seg1('today', 'Today')}${seg1('week', 'Week')}${seg1('month', 'Month')}</span>`;
    const maxOffset = view.mode === 'month' ? MAX_MONTH_OFFSET : MAX_WEEK_OFFSET;
    const nav = view.mode === 'today' ? '' : `<button class="btn tiny soft" ${view.offset <= 0 ? 'disabled' : ''} onclick="OL.dashAvail('offset',${view.offset - 1})">‹</button>
        <button class="btn tiny soft" onclick="OL.dashAvail('offset',0)">${month ? (view.offset === 0 ? 'This month' : esc(month.label)) : (view.offset === 0 ? 'Next 5 days' : `${esc(short(days[0]))} – ${esc(short(days[days.length - 1]))}`)}</button>
        <button class="btn tiny soft" ${view.offset >= maxOffset ? 'disabled' : ''} onclick="OL.dashAvail('offset',${view.offset + 1})">›</button>${month && view.offset !== 0 ? '' : month ? `<span class="tiny muted" style="margin-left:4px;">${esc(month.label)}</span>` : ''}`;
    const showTotal = view.mode !== 'today';
    const head = `<div style="display:flex;gap:6px;align-items:center;font-size:11.5px;" class="muted"><span style="width:110px;flex:none;"></span>${cols.map((c) => `<span style="flex:1;text-align:center;${c.now ? 'color:#2dd4bf;font-weight:700;' : ''}">${esc(c.title)}</span>`).join('')}${showTotal ? '<span style="width:54px;text-align:right;">Total</span>' : ''}</div>`;
    const rows = grid.map((g) => {
        const byDay = new Map(g.days.map((c) => [c.day, c.free]));
        const cells = cols.map((c) => {
            const free = Math.round(c.days.reduce((t, d) => t + (byDay.get(d) || 0), 0) * 10) / 10;
            return { free, tone: free / c.days.length };
        });
        return `<div style="display:flex;gap:6px;align-items:center;font-size:13px;margin-top:6px;"><span style="width:110px;flex:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(g.name)}</span>
        ${cells.map((c) => `<span style="flex:1;text-align:center;background:${colour(c.tone)}22;color:${colour(c.tone)};border-radius:7px;padding:4px 0;font-size:12.5px;font-weight:600;">${c.free} h</span>`).join('')}
        ${showTotal ? `<span class="muted" style="width:54px;text-align:right;">${g.total} h</span>` : ''}</div>`;
    }).join('');
    const note = month ? 'Hours free per week, after meetings and scheduled tasks. Days already past count as zero.' : 'Hours free after meetings and scheduled tasks.';
    return { count: '', body: `<div style="display:flex;gap:6px;align-items:center;margin-bottom:8px;">${nav}</div>${head}${rows}<div class="tiny muted" style="margin-top:8px;">${note} Days off and part-days come from each person's schedule.</div>`, extra: seg };
}

export function dashAvail(key, value) { view[key] = value; if (key === 'mode') view.offset = 0; paint(); }

// The table is a rolling window from today, so it has to move on by itself when the day changes at midnight Eastern, even if the
// dashboard is left open overnight. Checked every 30 seconds (also catches a computer waking from sleep).
let availabilityDay = '';
if (typeof setInterval === 'function' && typeof document !== 'undefined') {
    setInterval(() => { if (availabilityDay && easternDay() !== availabilityDay) { availabilityDay = easternDay(); paint(); } }, 30 * 1000);
}

// ---- the other modules ------------------------------------------------------------------------------------------
function bodyFor(key) {
    const clients = loadedClients();
    const today = todayStr();
    const base = { clients, closedNames: closedNames(), today };
    if (key === 'availability') return availabilityBody();
    if (key === 'open_requests') {
        if (typeof OL.getDashboardRequestItems !== 'function') throw new Error('Open requests module: OL.getDashboardRequestItems is not available.');
        const list = OL.getDashboardRequestItems().slice().sort((x, y) => (x.dueDate || '9999').localeCompare(y.dueDate || '9999') || String(x.clientName).localeCompare(String(y.clientName)));
        const tone = (w) => (w === 'in_testing' ? '#38bdf8' : w === 'pending_sphynx_action' ? '#64c6a2' : '#f59e0b');
        const type = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : '');
        return { count: list.length, extra: '', body: list.map((r) => row(r.title, r.clientId,
            [r.clientName, r.isMaintenance ? 'Maintenance' : '', type(r.requestType), r.isMaintenance ? '' : `Round ${r.round}`, r.assignee || 'Unassigned', r.stepsTotal ? `${r.stepsDone}/${r.stepsTotal} steps` : ''].filter(Boolean).join(' · '),
            `${r.isMaintenance ? chip('Maintenance', '#a78bfa') + ' ' : ''}${chip(r.status, tone(r.workStatus))}`)).join('') || empty('No open requests.') };
    }
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
    if (key === 'plans_expiring') {
        if (!planPeriods) return { count: '', body: empty('Loading...'), extra: '' };
        const list = plansExpiring({ clients, periods: planPeriods.rows, today, isOngoing });
        return { count: list.length, extra: '', body: list.map((p) => row(p.client, p.clientId,
            p.overdue ? `${p.tier ? `${p.tier} · ` : ''}ended ${p.ends} · marked Renewing, no new plan added` : `${p.tier ? `${p.tier} · ` : ''}ends ${p.ends}`,
            p.overdue ? chip(`Overdue ${p.overdueDays}d`, '#f87171')
                : `${chip(p.renewing ? 'Renewing' : 'Not renewing', p.renewing ? '#2dd4bf' : '#f5b942')} ${chip(p.daysLeft === 0 ? 'Today' : `${p.daysLeft}d left`, p.daysLeft <= 14 ? '#f87171' : '#f5b942')}`)).join('')
            || empty('No plan ends in the next 60 days and no renewal is overdue.') };
    }
    if (key === 'app_updates') {
        if (!appUpdates) return { count: '', body: empty('Loading...'), extra: '' };
        if (appUpdates.error) return { count: '', body: `<div class="tiny" style="color:#ef4444;padding:6px 0;">${esc(appUpdates.error)}</div>`, extra: '' };
        const staff = !window.IS_GUEST && (state.adminMode === true || state.teamMemberMode === true);
        const acts = appUpdates.actions || {};
        const all = appUpdates.items;
        const handled = all.filter((i) => acts[updKey(i)]);
        const items = appUpdates.showHandled ? all : all.filter((i) => !acts[updKey(i)]);
        const stamp = appUpdates.updatedAt ? `<span class="tiny muted" style="margin-left:auto;">Last scan ${esc(String(appUpdates.updatedAt).slice(0, 10))}</span>` : '';
        const kindColor = { pricing: '#f5b942', feature: '#2dd4bf', release: '#60a5fa', other: '#94a3b8' };
        const btn = (label, icon, fn, idx, title) => `<button type="button" class="btn tiny soft" title="${esc(title)}" onclick="event.stopPropagation();OL.${fn}(${idx})" style="display:inline-flex;gap:4px;align-items:center;"><i data-lucide="${icon}" style="width:11px;height:11px;"></i>${label}</button>`;
        const matchers = buildAppMatchers(appUpdates.watchNames);
        const body = items.map((i) => {
            const idx = all.indexOf(i), a = acts[updKey(i)];
            const actions = !staff ? '' : a
                ? `<span class="tiny muted">${a.action === 'intel' ? 'In Intel Library' : 'Dismissed'}${a.acted_by ? ` by ${esc(a.acted_by)}` : ''}</span> ${btn('Restore', 'rotate-ccw', 'dashUpdateRestore', idx, 'Put this back in the feed')}`
                : `${btn('Add to intel', 'lightbulb', 'dashUpdateToIntel', idx, 'Save this to the Intel Library')} ${btn('Dismiss', 'x', 'dashUpdateDismiss', idx, 'Hide this update')}`;
            const conns = connectionSuggestions(i, matchers);
            const connHtml = !conns.length ? '' : `<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:4px;"><span class="tiny muted">Possible connections:</span>${conns.slice(0, 6).map((c, k) => staff
                ? `<button type="button" class="btn tiny soft" title="${esc(c.how)}. Save to the Intel Library." onclick="event.stopPropagation();OL.dashUpdateConnectionToIntel(${idx},${k})" style="display:inline-flex;gap:4px;align-items:center;"><i data-lucide="link-2" style="width:11px;height:11px;"></i>${esc(c.a)} &harr; ${esc(c.b)}</button>`
                : `<span class="tiny" title="${esc(c.how)}">${esc(c.a)} &harr; ${esc(c.b)}</span>`).join('')}${conns.length > 6 ? `<span class="tiny muted">+${conns.length - 6} more</span>` : ''}</div>`;
            return `<div style="padding:7px 0;border-bottom:1px solid var(--line);${a ? 'opacity:.6;' : ''}">
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;"><b style="font-size:13px;">${esc(i.app || '')}</b>${chip(i.kind || 'other', kindColor[i.kind] || kindColor.other)}<span class="tiny muted">${esc(i.date || '')}</span><span style="margin-left:auto;">${OL.starButton ? OL.starButton({ type: 'app_update', key: updKey(i), title: `${i.app}: ${i.summary}`, details: i.summary, sourceUrl: i.sourceUrl, apps: [i.app] }) : ''}</span></div>
            <div style="font-size:13px;overflow-wrap:anywhere;">${esc(i.summary || '')}</div>
            ${connHtml}
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:3px;">${i.sourceUrl ? `<a class="tiny" href="${esc(i.sourceUrl)}" target="_blank" rel="noopener">Source</a><span class="tiny muted"> · checked ${esc(i.checkedAt || '')}</span>` : ''}<span style="margin-left:auto;display:inline-flex;gap:6px;align-items:center;">${actions}</span></div></div>`;
        }).join('');
        const note = appUpdates.actionsError ? `<div class="tiny" style="color:#f59e0b;padding:4px 0;">Dismiss and Add to intel are not saving yet: ${esc(appUpdates.actionsError)} (run migration 2026_11k_app_update_actions.sql in Supabase).</div>` : '';
        const wnote = appUpdates.watchlistError ? `<div class="tiny" style="color:#f59e0b;padding:4px 0;">Connection suggestions are using Master Library apps only: ${esc(appUpdates.watchlistError)}.</div>` : '';
        const toggle = handled.length ? `<div style="padding:6px 0;"><a class="tiny" href="#" onclick="event.preventDefault();OL.dashUpdateToggleHandled()">${appUpdates.showHandled ? 'Hide' : 'Show'} ${handled.length} handled</a></div>` : '';
        return { count: all.length - handled.length, extra: stamp, body: note + wnote + (body || empty(all.length && !items.length ? 'Everything has been dismissed or added to intel.' : appUpdates.updatedAt ? 'No changes found in the last scan.' : 'No scan has run yet.')) + toggle };
    }
    return { count: '', body: '', extra: '' };
}

// Which tile is open (click again to close). Kept for the session only.
let openKey = '';
// The four headline numbers from the dashboard (Active Clients, ...) so they sit in the same row as the module tiles.
let stats = [];
export function dashSetStats(list) { stats = Array.isArray(list) ? list : []; }
function statTile(st) {
    const open = !!st.key && openKey === st.key;
    const inner = `<span style="display:flex;align-items:center;justify-content:flex-end;height:16px;">${st.key ? `<i data-lucide="${open ? 'chevron-up' : 'chevron-down'}" style="width:13px;height:13px;opacity:.6;"></i>` : ''}</span>
        <span style="font-size:30px;font-weight:700;line-height:1;color:${st.color || 'inherit'};">${esc(String(st.value))}</span>
        <span style="font-size:11px;line-height:1.2;opacity:.8;">${esc(st.label)}</span>`;
    const base = `width:128px;height:112px;flex:none;padding:10px 10px 8px;border-radius:12px;display:flex;flex-direction:column;justify-content:space-between;background:var(--panel);border:1px solid ${open ? 'var(--accent)' : 'var(--line)'};${open ? 'box-shadow:0 0 0 1px var(--accent);' : ''}`;
    return st.key
        ? `<button type="button" onclick="OL.dashTile('${esc(st.key)}')" title="${esc(st.label)}" aria-expanded="${open}" style="${base}cursor:pointer;text-align:left;color:inherit;font:inherit;">${inner}</button>`
        : `<div style="${base}">${inner}</div>`;
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
    if (openKey && !list.some((m) => m.key === openKey) && !stats.some((st) => st.key === openKey)) openKey = '';
    const avail = list.find((m) => m.key === 'availability');
    const others = list.filter((m) => m.key !== 'availability').map((m) => ({ m, b: bodyFor(m.key) }));
    // A headline number can open its own list too (Active Requests); it is not one of the switchable modules.
    const statOpenDef = { key: 'open_requests', label: 'Active requests', icon: 'git-pull-request' };
    const statOpen = stats.find((st) => st.key && st.key === openKey) ? statOpenDef : null;
    const openOne = statOpen ? { m: statOpen, b: bodyFor('open_requests') } : others.find((x) => x.m.key === openKey);
    const availHtml = avail ? (() => { const b = bodyFor('availability'); return `<div style="margin-bottom:14px;">${card(avail, b.count, b.body, b.extra)}</div>`; })() : '';
    const tiles = (others.length || stats.length) ? `<div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:${openOne ? '12px' : '25px'};">${stats.map(statTile).join('')}${others.map((x) => tile(x.m, x.b)).join('')}</div>` : '';
    const opened = openOne ? `<div style="margin-bottom:25px;">${card(openOne.m, openOne.b.count, openOne.b.body, `<button class="btn tiny soft" style="margin-left:auto;" onclick="OL.dashTile('${esc(openOne.m.key)}')">Close</button>`)}</div>` : '';
    return `
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;">
        <b style="font-size:14px;">Modules</b><span class="tiny muted">Shown for you. Click a square to open it.</span>
        <span style="margin-left:auto;display:flex;gap:8px;">
            <button class="btn tiny soft" onclick="OL.dashModulesPreset()" style="display:inline-flex;gap:5px;align-items:center;"><i data-lucide="users" style="width:12px;height:12px;"></i>Team meeting preset</button>
            <button class="btn tiny soft" onclick="OL.dashOnlyMePreset()" style="display:inline-flex;gap:5px;align-items:center;"><i data-lucide="user" style="width:12px;height:12px;"></i>Only Me</button>
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
async function loadAppUpdates() {
    if (!enabled().includes('app_updates') || (appUpdates && !appUpdates.error && Date.now() - appUpdates.at < 300000)) return;
    try {
        const r = await fetch(`app-updates/digest.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!r.ok) throw new Error(`App updates digest could not be loaded (${r.status}).`);
        const d = await r.json();
        if (!d || !Array.isArray(d.items)) throw new Error('App updates digest is not in the expected format.');
        const items = d.items.slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))).slice(0, 80);
        const prev = appUpdates && !appUpdates.error ? appUpdates : {};
        appUpdates = { items, updatedAt: d.updatedAt || null, at: Date.now(), actions: prev.actions || {}, actionsError: '', showHandled: !!prev.showHandled };
        appUpdates.watchlistError = '';
        try {
            const wr = await fetch(`app-updates/watchlist.json?t=${Date.now()}`, { cache: 'no-store' });
            if (!wr.ok) throw new Error(`watchlist.json could not be loaded (${wr.status})`);
            const w = await wr.json();
            if (!w || !Array.isArray(w.apps)) throw new Error('watchlist.json is not in the expected format');
            appUpdates.watchNames = w.apps.map((x) => x.name).filter(Boolean);
        } catch (e) { appUpdates.watchlistError = e?.message || String(e); appUpdates.watchNames = []; }
        try {
            const a = await db.from('app_update_actions').select('*').limit(5000);
            if (a.error) throw a.error;
            appUpdates.actions = Object.fromEntries((a.data || []).map((x) => [x.key, x]));
        } catch (e) { appUpdates.actionsError = e?.message || String(e); }
        try { if (OL.loadContentIdeas && !OL.contentState.loaded) await OL.loadContentIdeas(); } catch (e) { console.error(e); }
    } catch (e) { appUpdates = { error: e.message, at: Date.now() }; }
    paint();
}

export async function loadDashboardModules() {
    paint();
    loadPlanPeriods();
    loadAppUpdates();
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

// The plan periods for every project (needed in full to tell renewed from overdue), for the "Maintenance plans expiring" card. Read once a minute at most, and only when the card is on.
async function loadPlanPeriods() {
    if (!enabled().includes('plans_expiring') || (planPeriods && Date.now() - planPeriods.at < 60000)) return;
    try {
        const r = await db.from('maintenance_plan_period').select('*');      // every period: an overdue renewal is a closed or ended one with nothing after it
        if (r.error) throw r.error;
        planPeriods = { rows: r.data || [], at: Date.now() };
    } catch (e) {
        console.warn('Plan periods for the dashboard are unavailable:', e?.message || e);
        planPeriods = { rows: [], at: Date.now() };
    }
    paint();
}

// ---- customizing ------------------------------------------------------------------------------------------------
export function dashModulesPreset() {
    setEnabled(TEAM_PRESET.slice());
    loadDashboardModules();
    if (typeof OL.applyTeamMeetingTaskFilters === 'function') OL.applyTeamMeetingTaskFilters();   // also sets the task list: next 2 weeks, everyone, grouped by client
}
// Back to a personal view: the default modules and the task list for just the signed-in person (next 2 weeks + no due date, by due date).
export function dashOnlyMePreset() {
    if (typeof OL.applyOnlyMeTaskFilters !== 'function') throw new Error('Only Me preset: OL.applyOnlyMeTaskFilters is not loaded.');
    setEnabled(DEFAULT_ON.slice());
    OL.applyOnlyMeTaskFilters();      // throws if there is no signed-in user, before anything repaints
    loadDashboardModules();
}
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
            <button class="btn soft" onclick="OL.dashOnlyMePreset(); OL.dashModulesOpen();">Only Me</button>
            <button class="btn primary" onclick="OL.closeModal()">Done</button></div></div>`;
    if (document.querySelector('.modal-box.modal-wide')) document.querySelector('.modal-box.modal-wide').innerHTML = html;
    else OL.showOverlayModal(html, { wide: true });
    if (window.lucide) window.lucide.createIcons();
}

// ---- app updates: dismiss / add to the Intel Library ------------------------------------------------------------
async function saveUpdateAction(i, action, intelId) {
    const row = { key: updKey(i), action, intel_id: intelId || null, acted_by: getCurrentUserName() || null, acted_at: new Date().toISOString() };
    const r = await db.from('app_update_actions').upsert(row).select('*');
    if (r.error || !r.data || !r.data.length) { alert(`Could not save that: ${r.error ? r.error.message : 'nothing was saved (you may not have permission)'}`); return false; }
    appUpdates.actions[row.key] = r.data[0];
    paint();
    return true;
}
OL.dashUpdateDismiss = async (idx) => { const i = appUpdates?.items?.[idx]; if (i) await saveUpdateAction(i, 'dismissed'); };
OL.dashUpdateRestore = async (idx) => {
    const i = appUpdates?.items?.[idx]; if (!i) return;
    const r = await db.from('app_update_actions').delete().eq('key', updKey(i));
    if (r.error) { alert(`Could not restore that: ${r.error.message}`); return; }
    delete appUpdates.actions[updKey(i)];
    paint();
};
OL.dashUpdateToggleHandled = () => { if (appUpdates) { appUpdates.showHandled = !appUpdates.showHandled; paint(); } };
OL.dashUpdateToIntel = (idx) => {
    const i = appUpdates?.items?.[idx];
    if (!i) return;
    if (typeof OL.openIntelModal !== 'function') { alert('The Intel Library is not loaded. Reload the page and try again.'); return; }
    const name = String(i.app || '').trim();
    const match = (state.master?.apps || []).find((a) => a && String(a.name || '').trim().toLowerCase() === name.toLowerCase());
    OL.openIntelModal(null, {
        kind: 'note', title: `${name}: ${String(i.summary || '').split(/(?<=[.!?])\s/)[0].slice(0, 110)}`,
        details: [i.summary, i.sourceUrl ? `Source: ${i.sourceUrl}` : '', i.date ? `Date: ${i.date}` : ''].filter(Boolean).join('\n\n'),
        apps: name ? [{ id: match ? match.id : null, name: match ? match.name : name }] : [],
        source_type: 'manual', source_id: `appupdate:${updKey(i)}`,
    });
};
OL.dashUpdateConnectionToIntel = (idx, k) => {
    const i = appUpdates?.items?.[idx];
    if (!i) return;
    if (typeof OL.openIntelModal !== 'function') { alert('The Intel Library is not loaded. Reload the page and try again.'); return; }
    const c = connectionSuggestions(i, buildAppMatchers(appUpdates.watchNames))[k];
    if (!c) return;
    const find = (n) => (state.master?.apps || []).find((a) => a && APP_NAME_CLEAN(a.name).toLowerCase() === n.toLowerCase());
    const ref = (n) => { const m = find(n); return { id: m ? m.id : null, name: m ? m.name : n }; };
    OL.openIntelModal(null, {
        kind: 'note', title: `Connection: ${c.a} and ${c.b}`,
        details: [`Possible connection (${c.how}).`, `From the ${i.app} update: ${i.summary}`, i.sourceUrl ? `Source: ${i.sourceUrl}` : ''].filter(Boolean).join('\n\n'),
        apps: [ref(c.a), ref(c.b)],
        source_type: 'manual', source_id: `appconn:${updKey(i)}:${c.b}`,
    });
};
// Called by the Intel Library after a new entry is saved: if it came from an app update, mark that update as added.
OL.onIntelSaved = async (entry, source) => {
    const sid = source?.source_id || '';
    if (!sid.startsWith('appupdate:') || !appUpdates || appUpdates.error) return;
    const i = appUpdates.items.find((x) => updKey(x) === sid.slice('appupdate:'.length));
    if (i) await saveUpdateAction(i, 'intel', entry.id);
};

window.OL = window.OL || {};
Object.assign(window.OL, { dashRepaintModules: () => paint(), dashSetStats, dashTile, dashboardModulesHtml, loadDashboardModules, dashAvail, dashModulesPreset, dashOnlyMePreset, dashModuleToggle, dashModulesOpen });
