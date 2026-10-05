//======================= CORE / WORKLOAD =======================//
// Everything that counts toward how busy someone is on a day, across ALL projects: every synced meeting (linked to
// a project or not) in the window, and the tasks of every project this session can see. Used by the Calendar
// Availability view and by the activation scheduler, so both agree.
//
// Projects that have not been opened yet are "meta only" (no tasks in memory), so they are loaded first —
// otherwise their tasks would silently count as zero.
import { state, db, isInBusinessScope, scopeQueryToBusinessClients, getBusinessScopedClients, loadFullClient } from './data.js';

const EVENT_COLUMNS = 'id, title, start, end, all_day, assignee, assignees, linked_client_id';

// Meetings starting in [from, to) — Date objects. Pages through results so a busy window is never cut at the
// database's default row limit.
export async function loadAllMeetings(from, to) {
    const rows = [];
    const PAGE = 1000;
    for (let offset = 0; offset < 10000; offset += PAGE) {
        const { data, error } = await scopeQueryToBusinessClients(db
            .from('calendar_events')
            .select(EVENT_COLUMNS)
            .gte('start', from.toISOString())
            .lt('start', to.toISOString()), 'linked_client_id')
            .order('start', { ascending: true })
            .range(offset, offset + PAGE - 1);
        if (error) { console.error('Failed to load meetings:', error.message); break; }
        (data || []).forEach((e) => { if (isInBusinessScope(e.linked_client_id)) rows.push(e); });
        if (!data || data.length < PAGE) break;
    }
    return rows;
}

// Every project's tasks, after making sure each project is actually loaded.
export async function loadAllTasks() {
    const clients = getBusinessScopedClients();
    const pending = clients.filter((c) => c && (c._metaOnly || !c.projectData));
    if (pending.length) await Promise.all(pending.map((c) => loadFullClient(c.id).catch(() => null)));
    return getBusinessScopedClients().flatMap((c) => c.projectData?.clientTasks || []);
}

// { events, tasks } for the window — the two inputs dailyLoadHours needs.
export async function loadWorkload(from, to) {
    const [events, tasks] = await Promise.all([loadAllMeetings(from, to), loadAllTasks()]);
    return { events, tasks };
}
