//======================= CORE / REVIEW FEEDBACK =======================//
// The client marks each step of their checklist Pass or Fail on the private page. Each answer is saved
// (client_checklist_results). This turns the answers into work for the Sphynx team:
//   - every Fail becomes a task on the ORIGINAL request, for the Implementation role, with the client's note.
//     That flips the request from "Pending Client Review" to "Pending Sphynx Action" (see core/work-status.js),
//     and back again when the task is done. No Error is created.
//   - a Fail sent again for the same step, while its task is still open, adds the new note to that task
//     instead of opening a second one.
//   - the round keeps a count of how far the client has got, for the scoping sheet.
// Pure functions on the client project JSON and the answer rows.

import { isTaskClosed } from './work-status.js';
import { assigneeForRole } from './testing.js';

const inReview = (pd) => Object.values(pd?.roundStates || {}).filter((s) => s && s.status === 'in_review' && s.checklistToken);

// How many steps are in a review (all the steps of the round's testing checklists).
export function reviewStepTotal(pd, st) {
    return (pd?.testRuns || []).filter((r) => r.sheetId === st.sheetId && Number(r.round) === Number(st.round))
        .reduce((n, r) => n + (r.steps || []).length, 0);
}

function findStep(pd, st, stepId) {
    for (const run of pd?.testRuns || []) {
        if (run.sheetId !== st.sheetId || Number(run.round) !== Number(st.round)) continue;
        const step = (run.steps || []).find((s) => s.id === stepId);
        if (step) return { run, step };
    }
    return null;
}

export function clientReviewCounts(pd, st, rows) {
    const mine = (rows || []).filter((r) => r.token === st.checklistToken);
    return { total: reviewStepTotal(pd, st), reviewed: mine.length,
             passed: mine.filter((r) => r.result === 'pass').length, failed: mine.filter((r) => r.result === 'fail').length };
}

// Is there anything to do for this project: a new Fail, or a progress count that has moved?
export function feedbackNeedsUpdate(client, rows) {
    const pd = client?.projectData;
    return inReview(pd).some((st) => {
        const c = clientReviewCounts(pd, st, rows);
        const old = st.clientReview || {};
        if (c.total !== old.total || c.reviewed !== old.reviewed || c.passed !== old.passed || c.failed !== old.failed) return true;
        return (rows || []).some((r) => r.token === st.checklistToken && r.result === 'fail' && !r.ingested_at);
    });
}

// ctx: { roles, closedNames, uid, now }
// Returns { created: [taskIds], updated: [taskIds], handled: [{ token, step_id, task_id }] }. The caller marks
// each handled row in the database.
export function applyClientFeedback(client, rows, ctx) {
    const out = { created: [], updated: [], handled: [] };
    const pd = client?.projectData;
    if (!pd) return out;
    if (!Array.isArray(pd.clientTasks)) pd.clientTasks = [];
    const closed = ctx.closedNames && ctx.closedNames.length ? ctx.closedNames : ['Done'];
    const builder = assigneeForRole(client, ctx.roles, /implement/i);
    const date = String(ctx.now || '').slice(0, 10);

    inReview(pd).forEach((st) => {
        st.clientReview = { ...clientReviewCounts(pd, st, rows), updatedAt: ctx.now };

        (rows || []).filter((r) => r.token === st.checklistToken && r.result === 'fail' && !r.ingested_at).forEach((r) => {
            const found = findStep(pd, st, r.step_id);
            if (!found) { out.handled.push({ token: r.token, step_id: r.step_id, task_id: null }); return; }   // not one of ours: do not retry forever
            const { run, step } = found;
            const note = String(r.note || '').trim();

            const open = pd.clientTasks.find((t) => t.clientReviewToken === r.token && t.clientReviewStepId === r.step_id && !isTaskClosed(t, closed));
            if (open) {
                if (open.clientReviewNote !== note) {
                    open.description = `${open.description || ''}\n\nThe client wrote again (${date}): ${note}`;
                    open.clientReviewNote = note;
                    out.updated.push(open.id);
                }
                out.handled.push({ token: r.token, step_id: r.step_id, task_id: open.id });
                return;
            }

            const task = {
                id: ctx.uid(), title: `Client review: ${step.title} (${run.title})`, name: `Client review: ${step.title} (${run.title})`,
                description: [
                    `Your client reported a problem in their Round ${st.round} review.`,
                    `What they wrote: ${note}`,
                    `Step: ${step.title}`,
                    step.how ? `How to test it: ${step.how}` : '',
                    step.expected ? `Expected: ${step.expected}` : '',
                ].filter(Boolean).join('\n\n'),
                status: 'Pending Sphynx Action', assignee: builder, dueDate: '', isClientTask: false, loggedHours: 0, parentTaskId: null,
                createdBy: 'client-review', createdAt: ctx.now,
                requestLineItemId: run.itemId,                          // on the original request
                clientReviewToken: r.token, clientReviewStepId: r.step_id, clientReviewNote: note,
            };
            pd.clientTasks.unshift(task);
            out.created.push(task.id);
            out.handled.push({ token: r.token, step_id: r.step_id, task_id: task.id });
        });
    });
    return out;
}
