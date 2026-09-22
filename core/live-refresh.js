//======================= CORE / LIVE REFRESH =======================//
// Keeps what's on screen current without a page refresh.
//
// 1. Your own changes: every save (persist) schedules a quiet re-render of
//    the page you're on, so counts, lists and badges catch up immediately
//    even when the code that made the change forgot to redraw.
// 2. Other people's changes: Supabase Realtime pushes row changes for the
//    project, email, calendar, error and team tables. A project someone
//    else edited is merged in (unless you have unsaved edits to that same
//    project, in which case yours win and are saved as usual), then the
//    page redraws. If Realtime isn't enabled for a table, a light poll
//    every 60 s and on returning to the tab covers it.
//
// Redraws never interrupt typing: if the cursor is in a field on the page,
// the redraw waits until you leave it. Scroll position is kept. The flow
// visualizer is never redrawn from here (it manages its own state).

import { db, state } from './data.js';

let timer = null;
let waitingForBlur = false;

function isEditing() {
    const el = document.activeElement;
    if (!el || el === document.body) return false;
    const main = document.getElementById('mainContent');
    if (!main || !main.contains(el)) return false; // typing in a modal is fine — modals aren't redrawn
    return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
}

function skipRoute() {
    const h = location.hash || '';
    return h.includes('visualizer');
}

// Loop guard: a page that saves while drawing would otherwise redraw
// itself forever. Saves made during a redraw are ignored, and if redraws
// keep firing with no user input (>5 in 10 s), auto-redraw pauses until
// the next click or keypress.
let redrawing = false;
let recent = [];
let paused = false;
['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, () => { paused = false; recent = []; }, true));

function redrawNow() {
    if (skipRoute() || paused) return;
    const now = Date.now();
    recent = recent.filter(t => now - t < 10000);
    if (recent.length >= 5) { paused = true; console.warn('Live refresh paused (page kept redrawing itself); resumes on your next click.'); return; }
    recent.push(now);
    if (isEditing()) {
        if (!waitingForBlur) {
            waitingForBlur = true;
            document.addEventListener('focusout', () => { waitingForBlur = false; scheduleViewRefresh(250); }, { once: true });
        }
        return;
    }
    const main = document.getElementById('mainContent');
    const scrollers = [main, document.scrollingElement, main?.parentElement].filter(Boolean).map(el => [el, el.scrollTop]);
    redrawing = true;
    try {
        if (typeof window.handleRoute === 'function') window.handleRoute();
    } catch (e) {
        console.warn('Live refresh redraw failed:', e);
    } finally {
        setTimeout(() => { redrawing = false; }, 0);
    }
    requestAnimationFrame(() => scrollers.forEach(([el, top]) => { el.scrollTop = top; }));
    OL.refreshNotificationBell?.();
}

export function scheduleViewRefresh(delay = 400) {
    if (redrawing) return;
    clearTimeout(timer);
    timer = setTimeout(redrawNow, delay);
}

// ---- merging other people's project changes ----
function hasLocalUnsaved(clientId) {
    return !!(window.saveTimeout && (state.dirtyClientIds?.has?.(clientId) || state.activeClientId === clientId)) || state.isSaving === true;
}

function mergeClientRow(row) {
    if (!row?.id) return false;
    const c = state.clients?.[row.id];
    if (!c) return false;               // not loaded in this tab; nothing to update
    if (c._metaOnly && row.meta) { c.meta = row.meta; return true; }
    if (hasLocalUnsaved(row.id)) return false;
    const incoming = JSON.stringify(row.project_data || {});
    if (incoming === JSON.stringify(c.projectData || {}) && JSON.stringify(row.meta || {}) === JSON.stringify(c.meta || {})) return false;
    if (row.project_data) c.projectData = row.project_data;
    if (row.meta) c.meta = row.meta;
    return true;
}

function mergeMasterRow(row) {
    if (!row) return false;
    let changed = false;
    if (Array.isArray(row.sphynx_team) && row.sphynx_team.length && !window.saveTimeout) {
        // Keep anything read locally but not yet saved (notification read marks).
        const localRead = {};
        (state.master.sphynxTeam || []).forEach(m => { localRead[m.id || m.name] = m.readNotificationIds || []; });
        row.sphynx_team.forEach(m => {
            const mine = localRead[m.id || m.name];
            if (mine?.length) m.readNotificationIds = [...new Set([...(m.readNotificationIds || []), ...mine])];
        });
        state.master.sphynxTeam = row.sphynx_team;
        changed = true;
    }
    return changed;
}

const CACHE_RESETS = {
    gmail_messages: () => { OL._dashboardEmailsCache = null; if (OL.commTabState) OL.commTabState.feedLoadedOnce = false; },
    calendar_events: () => { OL._dashboardEventsCache = null; },
    error_log: () => { OL._dashboardErrorsCache = null; }
};

let realtimeUp = false;
function startRealtime() {
    try {
        const ch = db.channel('ol-live');
        ch.on('postgres_changes', { event: '*', schema: 'public', table: 'workspace_clients' }, async (p) => {
            let row = p.new;
            // Big projects can exceed Realtime's message size, in which case
            // the change arrives without its data — fetch that one row.
            if (row?.id && !row.project_data && state.clients?.[row.id] && !state.clients[row.id]._metaOnly) {
                const { data } = await db.from('workspace_clients').select('id, meta, project_data').eq('id', row.id).maybeSingle();
                row = data || row;
            }
            if (mergeClientRow(row)) scheduleViewRefresh(600);
        });
        ch.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'workspace_masters' }, (p) => {
            if (mergeMasterRow(p.new)) scheduleViewRefresh(600);
        });
        Object.keys(CACHE_RESETS).forEach(table => {
            ch.on('postgres_changes', { event: '*', schema: 'public', table }, () => {
                CACHE_RESETS[table]();
                scheduleViewRefresh(1200); // batches bursts (a Gmail sync inserts many rows)
            });
        });
        ch.subscribe((status) => {
            realtimeUp = status === 'SUBSCRIBED';
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') console.warn('Live updates unavailable (falling back to polling):', status);
        });
    } catch (e) {
        console.warn('Realtime not available:', e);
    }
}

// ---- fallback poll (and on returning to the tab) ----
let polling = false;
async function poll() {
    if (polling || document.hidden) return;
    polling = true;
    try {
        const loadedIds = Object.keys(state.clients || {}).filter(id => state.clients[id] && !state.clients[id]._metaOnly);
        let changed = false;
        for (let i = 0; i < loadedIds.length; i += 25) {
            const { data } = await db.from('workspace_clients').select('id, meta, project_data').in('id', loadedIds.slice(i, i + 25));
            (data || []).forEach(row => { if (mergeClientRow(row)) changed = true; });
        }
        const { data: m } = await db.from('workspace_masters').select('sphynx_team').eq('id', 'main_state').maybeSingle();
        if (mergeMasterRow(m)) changed = true;
        if (changed) scheduleViewRefresh(300);
        else OL.refreshNotificationBell?.();
    } catch (e) {
        console.warn('Live refresh poll failed:', e?.message || e);
    } finally {
        polling = false;
    }
}

export function startLiveRefresh() {
    if (OL._liveRefreshStarted) return;
    OL._liveRefreshStarted = true;
    startRealtime();
    // Every minute without Realtime; every 3 minutes with it, as a safety net.
    let n = 0;
    setInterval(() => { n++; if (!realtimeUp || n % 3 === 0) poll(); }, 60 * 1000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
    window.addEventListener('focus', () => poll());
}

window.OL = window.OL || {};
Object.assign(window.OL, { scheduleViewRefresh, startLiveRefresh, _mergeMasterRow: mergeMasterRow });
