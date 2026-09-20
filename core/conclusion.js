//======================= CORE / CONCLUSION =======================//
// Project Conclusion and Review for a round, on the client project JSON. Pure functions.
//
//   building  -> the round's requests are still being built or tested
//   ready_to_notify  every request has passed testing (or needs none). The conclusion date is recorded,
//                    the review dates are set to the defaults, and a "Notify client" task goes to the
//                    Communication role.
//   in_review        the client was notified; the review runs from its start date to its end date,
//                    with a follow-up task every few days
//   closed           the review was closed: the round's requests are marked Done, so the next round can start
//
// While a round is in testing or review its requests stay "Do Now", so it stays the current round and
// the next round cannot start early.
//
// State lives in client.projectData.roundStates[`${sheetId}:${round}`]:
//   { key, sheetId, round, status, concludedAt, reviewStart, reviewEnd, reviewDays, followUpEveryDays,
//     notifyTaskId, checklistToken, sentAt, sentTo, followUpTaskIds, closedAt }

import { getCurrentRound } from './requests.js';
import { isTaskClosed } from './work-status.js';
import { TESTABLE_TYPES, isReadyForTesting, assigneeForRole, pickTemplates, DEFAULT_TEST_TEMPLATES } from './testing.js';

export const REVIEW_DEFAULTS = { days: 30, followUpEveryDays: 10 };
export const roundKey = (sheetId, round) => `${sheetId ?? ''}:${round}`;

// ---- dates (YYYY-MM-DD strings; noon UTC so the weekday never shifts) ----
const parse = (iso) => new Date(`${String(iso).slice(0, 10)}T12:00:00Z`);
const fmt = (d) => d.toISOString().slice(0, 10);
export const addDaysIso = (iso, n) => { const d = parse(iso); d.setUTCDate(d.getUTCDate() + Number(n)); return fmt(d); };
export const weekdayOf = (iso) => parse(iso).getUTCDay();   // 0 Sunday ... 6 Saturday

// The first Monday or Wednesday AFTER the conclusion date.
export function nextReviewStart(concludedIso, weekdays = [1, 3]) {
    let d = addDaysIso(concludedIso, 1);
    for (let i = 0; i < 8; i++) { if (weekdays.includes(weekdayOf(d))) return d; d = addDaysIso(d, 1); }
    return addDaysIso(concludedIso, 1);
}
export const reviewEndFor = (startIso, days) => addDaysIso(startIso, Number(days));

// A follow-up every N days from the start, up to and including the end date.
export function followUpDates(startIso, endIso, everyDays) {
    const every = Number(everyDays);
    if (!Number.isFinite(every) || every < 1) return [];
    const out = [];
    for (let d = addDaysIso(startIso, every); d <= endIso; d = addDaysIso(d, every)) out.push(d);
    return out;
}

export function reviewDefaults(master) {
    const r = master?.reviewDefaults || {};
    const days = Number(r.days), every = Number(r.followUpEveryDays);
    return { days: Number.isFinite(days) && days >= 1 ? days : REVIEW_DEFAULTS.days,
             followUpEveryDays: Number.isFinite(every) && every >= 1 ? every : REVIEW_DEFAULTS.followUpEveryDays };
}

const isBlank = (v) => v === undefined || v === null || String(v).trim() === '';
const titleOf = (item, resource) => (!isBlank(item?.name) ? String(item.name).trim() : (resource?.name || ''));
const roundOf = (item) => { const r = parseInt(item?.round, 10); return Number.isFinite(r) && r >= 1 ? r : 1; };

export function roundItems(sheet, round, ctx) {
    return (sheet?.lineItems || []).filter((item) => item && typeof item === 'object' && !isBlank(item.id)
        && titleOf(item, ctx.resourceFor(item)) && String(item.status || '') === 'Do Now' && roundOf(item) === Number(round));
}

// Where each request in the round stands. A request is complete when it has passed testing, or needs no
// testing (a meeting, training, or a type with no matching template) and its own steps are done.
export function roundProgress(client, sheet, round, ctx) {
    const pd = client?.projectData || {};
    const closed = ctx.closedNames && ctx.closedNames.length ? ctx.closedNames : ['Done'];
    const templates = ctx.templates || DEFAULT_TEST_TEMPLATES;
    const out = { total: 0, complete: 0, building: 0, testing: 0, needsFix: 0 };
    roundItems(sheet, round, ctx).forEach((item) => {
        out.total++;
        const type = isBlank(item.requestType) ? 'build' : String(item.requestType);
        const resource = ctx.resourceFor(item);
        const needsRun = TESTABLE_TYPES.includes(type) && pickTemplates(templates, type, resource?.type || '').length > 0;
        if (needsRun) {
            const run = (pd.testRuns || []).find((r) => r.itemId === String(item.id) && r.sheetId === String(sheet.id ?? ''));
            if (!run) out.building++;
            else if (run.status === 'passed') out.complete++;
            else if (run.status === 'needs_fix') out.needsFix++;
            else out.testing++;
        } else if (isReadyForTesting(item, pd.clientTasks || [], closed)) out.complete++;
        else out.building++;
    });
    return out;
}

// What the client's copy of the checklist holds: every tested request in the round, steps only,
// with no results, notes or internal names. Each step keeps its id (an opaque code) so the client's Pass or Fail
// can be matched back to the step. Kept separate from Sphynx's tested copy.
export function buildClientChecklist(client, sheet, round, ctx) {
    const pd = client?.projectData || {};
    const sections = [];
    roundItems(sheet, round, ctx).forEach((item) => {
        const run = (pd.testRuns || []).find((r) => r.itemId === String(item.id) && r.sheetId === String(sheet.id ?? ''));
        if (!run) return;
        sections.push({
            title: run.title, requestType: run.requestType, resourceName: run.resourceName || '',
            steps: (run.steps || []).map((s) => ({ id: s.id, title: s.title, how: s.how || '', expected: s.expected || '' })),
        });
    });
    return { clientName: client?.meta?.name || '', round: Number(round), sections };
}

// ---- the pass, run before each save ----
// ctx: { templates, roles, closedNames, resourceFor(item), uid, now, today (YYYY-MM-DD), defaults }
export function updateRoundStates(client, ctx) {
    const result = { ready: [], cancelled: [] };
    const pd = client?.projectData;
    if (!pd) return result;
    if (!pd.roundStates || typeof pd.roundStates !== 'object') pd.roundStates = {};
    if (!Array.isArray(pd.clientTasks)) pd.clientTasks = [];
    const closed = ctx.closedNames && ctx.closedNames.length ? ctx.closedNames : ['Done'];
    const defaults = ctx.defaults || REVIEW_DEFAULTS;

    (pd.scopingSheets || []).forEach((sheet) => {
        if (!sheet || sheet.status !== 'Approved') return;
        if (sheet.kind === 'maintenance' || sheet.id === 'maintenance') return;   // client requests are plain: no testing checklist, no round review
        const real = (sheet.lineItems || []).filter((i) => i && typeof i === 'object' && !isBlank(i.id) && titleOf(i, ctx.resourceFor(i)));
        const current = getCurrentRound({ lineItems: real });
        if (current === null) return;

        const key = roundKey(sheet.id, current);
        const st = pd.roundStates[key];
        const prog = roundProgress(client, sheet, current, ctx);
        const complete = prog.total > 0 && prog.complete === prog.total;

        if (!st && complete) {
            const start = nextReviewStart(ctx.today);
            const task = {
                id: ctx.uid(), title: `Notify client: Round ${current} review`, name: `Notify client: Round ${current} review`,
                description: 'Every request in this round has passed testing. Open the notification, check the review dates, and send the client the review instructions with the link to the testing checklist.',
                status: 'Pending Sphynx Action', assignee: assigneeForRole(client, ctx.roles, /communicat/i), dueDate: ctx.today,
                isClientTask: false, loggedHours: 0, parentTaskId: null, createdBy: 'conclusion', createdAt: ctx.now, reviewNotifyKey: key,
            };
            pd.clientTasks.unshift(task);
            pd.roundStates[key] = {
                key, sheetId: String(sheet.id ?? ''), round: current, status: 'ready_to_notify', concludedAt: ctx.today,
                reviewStart: start, reviewDays: defaults.days, followUpEveryDays: defaults.followUpEveryDays,
                reviewEnd: reviewEndFor(start, defaults.days), notifyTaskId: task.id, checklistToken: '', sentAt: '', sentTo: '',
                followUpTaskIds: [], closedAt: '',
            };
            result.ready.push(key);
        } else if (st && st.status === 'ready_to_notify' && !complete) {
            // testing was reopened (a failed step, or a new request in the round): withdraw the notification
            const task = pd.clientTasks.find((t) => t.id === st.notifyTaskId);
            if (task && !isTaskClosed(task, closed)) { task.status = closed[0]; task.cancelledAt = ctx.now; task.completedAt = ''; }
            delete pd.roundStates[key];
            result.cancelled.push(key);
        }
    });
    return result;
}

export function setReviewDates(state, { start, days, followUpEveryDays }) {
    if (!state || state.status !== 'ready_to_notify') return false;
    if (start && /^\d{4}-\d{2}-\d{2}$/.test(start)) state.reviewStart = start;
    if (Number(days) >= 1) state.reviewDays = Number(days);
    if (Number(followUpEveryDays) >= 1) state.followUpEveryDays = Number(followUpEveryDays);
    state.reviewEnd = reviewEndFor(state.reviewStart, state.reviewDays);
    return true;
}

// The client has been told: the review begins. Follow-up tasks are created for the Communication role.
export function startReview(client, key, ctx, { sentTo = '', checklistToken = '' } = {}) {
    const pd = client?.projectData;
    const st = pd?.roundStates?.[key];
    if (!st || st.status !== 'ready_to_notify') return null;
    const closed = ctx.closedNames && ctx.closedNames.length ? ctx.closedNames : ['Done'];
    st.status = 'in_review';
    st.sentAt = ctx.now; st.sentTo = sentTo; if (checklistToken) st.checklistToken = checklistToken;
    const notify = pd.clientTasks.find((t) => t.id === st.notifyTaskId);
    if (notify && !isTaskClosed(notify, closed)) { notify.status = closed[0]; notify.completedAt = ctx.now; }
    const assignee = assigneeForRole(client, ctx.roles, /communicat/i);
    st.followUpTaskIds = followUpDates(st.reviewStart, st.reviewEnd, st.followUpEveryDays).map((date, i) => {
        const day = (i + 1) * Number(st.followUpEveryDays);
        const task = {
            id: ctx.uid(), title: `Review check-in: Round ${st.round} (day ${day})`, name: `Review check-in: Round ${st.round} (day ${day})`,
            description: `Follow up with the client on their Round ${st.round} review (ends ${st.reviewEnd}). Ask what they have found, and log any problem as a revision task on the original request.`,
            status: 'Pending Sphynx Action', assignee, dueDate: date, isClientTask: false, loggedHours: 0, parentTaskId: null,
            createdBy: 'conclusion', createdAt: ctx.now, reviewFollowUpKey: key,
        };
        pd.clientTasks.unshift(task);
        return task.id;
    });
    return st;
}

// Work still open on the round's requests (for a warning before closing).
export function openWorkInRound(client, sheet, round, ctx) {
    const closed = ctx.closedNames && ctx.closedNames.length ? ctx.closedNames : ['Done'];
    const ids = new Set(roundItems(sheet, round, ctx).map((i) => String(i.id)));
    return (client?.projectData?.clientTasks || []).filter((t) => t && ids.has(String(t.requestLineItemId)) && !isTaskClosed(t, closed));
}

// Closing the review marks the round's requests Done, which makes the next round current.
export function closeReview(client, key, ctx) {
    const pd = client?.projectData;
    const st = pd?.roundStates?.[key];
    if (!st || st.status !== 'in_review') return null;
    const sheet = (pd.scopingSheets || []).find((s) => String(s.id ?? '') === st.sheetId);
    const closed = ctx.closedNames && ctx.closedNames.length ? ctx.closedNames : ['Done'];
    let marked = 0;
    roundItems(sheet, st.round, ctx).forEach((item) => { item.status = 'Done'; item.doneAt = ctx.now; marked++; });
    (st.followUpTaskIds || []).forEach((id) => {
        const t = pd.clientTasks.find((x) => x.id === id);
        if (t && !isTaskClosed(t, closed)) { t.status = closed[0]; t.completedAt = ctx.now; t.cancelledAt = ctx.now; }
    });
    st.status = 'closed'; st.closedAt = ctx.now;
    return { state: st, marked };
}

// One line about where a round stands, for the scoping sheet.
export function roundStatus(client, sheet, round, ctx) {
    const st = client?.projectData?.roundStates?.[roundKey(sheet?.id, round)];
    if (st) {
        if (st.status === 'closed') return { kind: 'closed', text: 'Review closed', state: st };
        if (st.status === 'in_review') {
            const ended = ctx.today > st.reviewEnd;
            return { kind: ended ? 'review_ended' : 'in_review', text: ended ? `Review ended ${st.reviewEnd}` : `In review ${st.reviewStart} to ${st.reviewEnd}`, state: st };
        }
        return { kind: 'ready_to_notify', text: 'Passed testing: notify the client', state: st };
    }
    const p = roundProgress(client, sheet, round, ctx);
    if (!p.total) return { kind: 'empty', text: '', progress: p };
    if (p.testing + p.needsFix > 0) return { kind: 'testing', text: `Testing ${p.complete}/${p.total} requests`, progress: p };
    return { kind: 'building', text: `${p.complete}/${p.total} requests tested or ready`, progress: p };
}
