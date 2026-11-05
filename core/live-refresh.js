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
// visualizer and the how-to guide editor are never redrawn from here (they manage their own state).

import { db, state, ensureProjectLists, isEchoOfOwnSave, noteRowVersion } from './data.js';
import { keepLocalBlobs } from './resource-blobs.js';

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
    if (h.includes('visualizer')) return true;
    // The how-to guide editor takes over the whole page without changing the URL (features/how-to.js,
    // openGuideEditor). A route redraw would throw the guide away and drop back to the library — which is what
    // happened on every save, poll and return to the tab. Like the visualizer, it manages its own state.
    return !!document.getElementById('ge-shell');
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
    return !!(window.saveTimeout && (state.dirtyClientIds?.has?.(clientId) || state.activeClientId === clientId)) || state.isSaving === true || state.persistInFlight === true;
}

function mergeClientRow(row) {
    if (!row?.id) return false;
    const c = state.clients?.[row.id];
    if (!c) return false;               // not loaded in this tab; nothing to update
    if (c._metaOnly && row.meta) { c.meta = row.meta; return true; }
    if (hasLocalUnsaved(row.id)) return false;
    // A row that is just one of our own earlier saves coming back (late realtime echo, or a poll that started before a newer save)
    // is older than what is in memory; applying it would bring back anything deleted since.
    if (row.project_data && isEchoOfOwnSave(row.id, row.project_data)) return false;
    // Normalise the incoming copy the same way loading does, so a project that is merely missing empty lists in the
    // database doesn't look "changed" against the in-memory copy (which has them) on every check.
    // A saved project row no longer carries the heavy resource fields (resource_blobs); keep the ones this tab has loaded.
    const incomingData = row.project_data ? keepLocalBlobs(c.projectData, ensureProjectLists({ ...row.project_data })) : null;
    const incoming = JSON.stringify(incomingData || {});
    if (incoming === JSON.stringify(c.projectData || {}) && JSON.stringify(row.meta || {}) === JSON.stringify(c.meta || {})) return false;
    if (incomingData) c.projectData = incomingData;
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
        const applyClientRow = (row) => {
            const merged = mergeClientRow(row);
            if (row?.id && !hasLocalUnsaved(row.id)) noteRowVersion(row.id, row.updated_at);   // so the background check does not fetch it again
            if (merged) scheduleViewRefresh(600);
        };
        // Big projects can exceed Realtime's message size, in which case the change arrives without its data and the project has to be
        // fetched. Someone editing saves every couple of seconds, and every open tab fetched the whole project each time. Now each tab
        // fetches a project at most once per 8 seconds (after the changes stop arriving), and not at all while the tab is in the
        // background: coming back to the tab runs the "which projects changed" check, which fetches only what is out of date.
        const pendingFetch = {};
        const fetchLater = (id) => {
            clearTimeout(pendingFetch[id]);
            pendingFetch[id] = setTimeout(async () => {
                delete pendingFetch[id];
                if (document.hidden) { lastPollAt = 0; return; }   // makes the check on returning to the tab run straight away
                // Ask only "when did this project last change?" first (a few bytes). If it is the version this tab already has
                // (its own save, or one it already downloaded) there is nothing to fetch. Projects over 1 MB always arrive here
                // without their data, so without this check every save re-downloaded the whole project in every open tab.
                const known = (window.OL && window.OL._rowVersions) || {};
                try {
                    const { data: stamp, error: stampErr } = await db.from('workspace_clients').select('id, updated_at').eq('id', id).maybeSingle();
                    if (!stampErr && stamp?.updated_at && known[id] === stamp.updated_at) return;
                } catch (e) { /* fall through to the full fetch */ }
                const { data } = await db.from('workspace_clients').select('id, meta, project_data, updated_at').eq('id', id).maybeSingle();
                if (data) applyClientRow(data);
            }, 8000);
        };
        ch.on('postgres_changes', { event: '*', schema: 'public', table: 'workspace_clients' }, (p) => {
            const row = p.new;
            if (row?.id && !row.project_data && state.clients?.[row.id] && !state.clients[row.id]._metaOnly) { fetchLater(row.id); return; }
            applyClientRow(row);
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
            OL._liveRealtimeUp = realtimeUp;   // read by the notification poll, which skips its own download of every project while this is on
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') console.warn('Live updates unavailable (falling back to polling):', status);
        });
    } catch (e) {
        console.warn('Realtime not available:', e);
    }
}

// ---- fallback poll (and on returning to the tab) ----
let polling = false;
let lastPollAt = 0;
async function poll(fromFocus = false) {
    if (polling || document.hidden) return;
    // coming back to the tab or clicking into the window re-downloaded every loaded project each time; once in two minutes is plenty
    // While live updates are connected the projects are already kept current by them, so this is only a safety net, and each run
    // downloads every loaded project in full: coming back to the tab only re-checks after 15 minutes then (2 minutes without live updates).
    if (fromFocus && Date.now() - lastPollAt < (realtimeUp ? 15 : 2) * 60 * 1000) return;
    lastPollAt = Date.now();
    polling = true;
    try {
        const loadedIds = Object.keys(state.clients || {}).filter(id => state.clients[id] && !state.clients[id]._metaOnly);
        let changed = false;
        // Ask the database only when each project last changed (a few KB), then download just the ones that did. If that is not
        // possible (the updated_at column from the 2026_11e migration is not there yet), every loaded project is downloaded as before.
        let toFetch = loadedIds;
        const known = (window.OL && window.OL._rowVersions) || {};
        if (loadedIds.length && Object.keys(known).length) {
            const stamps = [];
            let stampErr = null;
            for (let i = 0; i < loadedIds.length && !stampErr; i += 100) {
                const { data, error } = await db.from('workspace_clients').select('id, updated_at').in('id', loadedIds.slice(i, i + 100));
                if (error) stampErr = error; else stamps.push(...(data || []));
            }
            if (!stampErr && stamps.every(r => r.updated_at)) {
                toFetch = stamps.filter(r => known[r.id] !== r.updated_at).map(r => r.id);
            }
        }
        for (let i = 0; i < toFetch.length; i += 25) {
            const { data } = await db.from('workspace_clients').select('id, meta, project_data, updated_at').in('id', toFetch.slice(i, i + 25));
            (data || []).forEach(row => {
                if (mergeClientRow(row)) changed = true;
                if (!hasLocalUnsaved(row.id)) noteRowVersion(row.id, row.updated_at);
            });
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
    // Every minute without Realtime; every 15 minutes with it, as a safety net (it used to be every 3: each run downloads every
    // project in full, for every open tab, which added up to most of the database egress).
    let n = 0;
    setInterval(() => { n++; if (!realtimeUp || n % 15 === 0) poll(); }, 60 * 1000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(true); });
    window.addEventListener('focus', () => poll(true));
}

window.OL = window.OL || {};
Object.assign(window.OL, { scheduleViewRefresh, startLiveRefresh, _mergeMasterRow: mergeMasterRow });
