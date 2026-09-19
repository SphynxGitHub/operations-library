//======================= CORE / TESTING =======================//
// Testing checklists, built one request at a time.
//
// As soon as a request's own steps are done, a checklist for THAT request is made and a task is
// handed to whoever holds the Testing role, so testing starts while the rest of the round is
// still being built. Pure functions on the client project JSON: no database, no page.
//
// Where things live (in client.projectData):
//   testRuns[]   one per tested request:
//                { id, sheetId, itemId, round, title, requestType, resourceName, status, createdAt,
//                  testTaskId, passedAt, steps: [{ id, title, how, expected, result, note, by, at,
//                                                   fixTaskId, retest }] }
//   clientTasks  the Testing task (testRunId) and any fix tasks (fixForTestRunId).
//   The fix tasks link to the request (requestLineItemId) so they show as open work on it; the
//   Testing task deliberately does not, so it never counts as one of the request's build steps.
// Templates (the steps to test) live in the master registry as testTemplates.

import { getCurrentRound } from './requests.js';
import { deriveWorkStatus, isTaskClosed, tasksForItem } from './work-status.js';

export const TEST_RESULTS = { PASS: 'pass', FAIL: 'fail', SKIP: 'skip' };
export const TESTABLE_TYPES = ['build', 'revision', 'audit', 'troubleshoot'];   // training and meetings are not tested

// A starting set, used until you save your own under Test templates. Steps are "title | how | expected".
const steps = (lines) => lines.map(([title, how, expected]) => ({ title, how, expected }));
export const DEFAULT_TEST_TEMPLATES = [
    { id: 'tt-zap', name: 'Zap', requestTypes: ['build', 'revision'], resourceTypes: ['zap', 'zapier', 'automation'], fallback: false, steps: steps([
        ['Trigger it with a test record', 'Run {resource} with a realistic test record', 'It runs without errors'],
        ['Check every step ran', 'Open the Zap history and expand each step', 'Every step shows success with the expected data'],
        ['Check the result in the destination app', 'Open the app the Zap writes to', 'The record, note or task is there and correct'],
        ['Confirm error alerts reach the right person', 'Read the error step, or force a failure', 'The right person is notified'],
    ]) },
    { id: 'tt-form', name: 'Form', requestTypes: ['build', 'revision'], resourceTypes: ['form', 'jotform', 'intake'], fallback: false, steps: steps([
        ['Submit it with realistic data', 'Fill in {resource} as a client would', 'The submission goes through'],
        ['Check every field and required setting', 'Try leaving required fields empty, and every option', 'Required fields are enforced and every option works'],
        ['Check the confirmation', 'Look at the message or redirect after submitting', 'The right message or page appears'],
        ['Confirm the submission lands where it should', 'Look in the destination (CRM, sheet, inbox)', 'The submission is there and complete'],
        ['Check the notification emails', 'Open the emails the form sends', 'Right people, right content'],
    ]) },
    { id: 'tt-email', name: 'Email', requestTypes: ['build', 'revision'], resourceTypes: ['email', 'campaign', 'newsletter'], fallback: false, steps: steps([
        ['Send a test to yourself', 'Send {resource} to your own address', 'It arrives'],
        ['Check subject, preview text and merge fields', 'Read the delivered email', 'Nothing is blank or shows a raw field name'],
        ['Click every link', 'Click each link in the email', 'Every link goes to the right place'],
        ['Check sender and reply-to', 'Look at who it is from and where replies go', 'Both are correct'],
    ]) },
    { id: 'tt-event', name: 'Event or scheduler', requestTypes: ['build', 'revision'], resourceTypes: ['event', 'calendly', 'scheduler', 'booking', 'youcanbookme'], fallback: false, steps: steps([
        ['Schedule a test booking', 'Book {resource} as a client would', 'The booking goes through'],
        ['Check the confirmation email and reminders', 'Open the emails it sends', 'They arrive with the right details'],
        ['Check the questions and fields', 'Look at every question on the booking page', 'They match what was requested'],
        ['Check the calendar invite and meeting link', 'Open the invite', 'The time, attendees and meeting link are right'],
        ['Test cancel and reschedule', 'Cancel one booking and move another', 'Both work and update the calendar'],
    ]) },
    { id: 'tt-revision', name: 'Revision', requestTypes: ['revision'], resourceTypes: [], fallback: false, steps: steps([
        ['Confirm the change works', 'Test the specific change that was requested in {request}', 'It behaves as requested'],
        ['Spot-check related items', 'Check the things next to it that should not have changed', 'Nothing else changed'],
    ]) },
    { id: 'tt-audit', name: 'Audit', requestTypes: ['audit'], resourceTypes: [], fallback: false, steps: steps([
        ['Confirm the findings document was reviewed', 'Check that the write-up for {request} was reviewed', 'It was reviewed, with any follow-ups noted'],
    ]) },
    { id: 'tt-troubleshoot', name: 'Troubleshoot', requestTypes: ['troubleshoot'], resourceTypes: [], fallback: false, steps: steps([
        ['Confirm the problem is fixed', 'Repeat what went wrong in {request}', 'It now works'],
        ['Check for side effects', 'Look at what the fix could have touched', 'Nothing else broke'],
    ]) },
    { id: 'tt-general', name: 'General (anything else)', requestTypes: ['build', 'revision'], resourceTypes: [], fallback: true, steps: steps([
        ['Run it end to end', 'Use {resource} the way it will really be used', 'It works from start to finish'],
        ['Confirm the result matches the request', 'Compare it with what was asked for in {request}', 'It matches'],
    ]) },
];

const lc = (v) => String(v ?? '').toLowerCase();
const isBlank = (v) => v === undefined || v === null || String(v).trim() === '';
const fill = (text, vars) => String(text ?? '').replace(/\{(resource|request)\}/g, (_, k) => vars[k] || '');

// ---- which templates apply ----
export function templateApplies(t, requestType, resourceType) {
    if (!t) return false;
    const types = (t.requestTypes || []).map(lc);
    if (types.length && !types.includes(lc(requestType))) return false;
    const resTypes = (t.resourceTypes || []).map(lc);
    if (resTypes.length === 0) return true;
    const rt = lc(resourceType);
    return !!rt && resTypes.some((x) => rt.includes(x) || x.includes(rt));
}

// Templates for a request: the ones that match its resource type, plus any that only look at the request type.
// The general "fallback" template is used only when nothing matched the resource type.
export function pickTemplates(templates, requestType, resourceType) {
    const list = (templates || []).filter((t) => t && Array.isArray(t.steps) && t.steps.length);
    const applies = list.filter((t) => !t.fallback && templateApplies(t, requestType, resourceType));
    const specific = applies.filter((t) => (t.resourceTypes || []).length > 0);
    const typeOnly = applies.filter((t) => (t.resourceTypes || []).length === 0);
    const picked = [...specific, ...typeOnly];
    if (specific.length === 0) picked.push(...list.filter((t) => t.fallback && templateApplies(t, requestType, resourceType)));
    return picked;
}

export function buildRun({ item, sheetId, round, title, resourceName, requestType, templates, resourceType, uid, now }) {
    const picked = pickTemplates(templates, requestType, resourceType);
    const vars = { resource: resourceName || title, request: title };
    const out = [];
    picked.forEach((t) => (t.steps || []).forEach((s) => {
        if (isBlank(s.title)) return;
        out.push({ id: uid(), title: fill(s.title, vars), how: fill(s.how, vars), expected: fill(s.expected, vars),
                   result: '', note: '', by: '', at: '', fixTaskId: '', retest: false });
    }));
    if (!out.length) return null;
    return { id: uid(), sheetId: String(sheetId ?? ''), itemId: String(item.id), round, title, requestType, resourceName: resourceName || '',
             status: 'open', createdAt: now, testTaskId: '', passedAt: '', steps: out };
}

// ---- progress and status ----
export function runProgress(run) {
    const s = (run && run.steps) || [];
    const count = (r) => s.filter((x) => x.result === r).length;
    return { total: s.length, passed: count(TEST_RESULTS.PASS), failed: count(TEST_RESULTS.FAIL), skipped: count(TEST_RESULTS.SKIP),
             pending: s.filter((x) => !x.result).length };
}
export function runStatusOf(run) {
    const p = runProgress(run);
    if (p.failed > 0) return 'needs_fix';
    if (p.total > 0 && p.pending === 0) return 'passed';
    return 'open';
}

export function recordResult(run, stepId, result, { note, by, now } = {}) {
    const step = (run?.steps || []).find((s) => s.id === stepId);
    if (!step) return null;
    if (result !== '' && !Object.values(TEST_RESULTS).includes(result)) return null;
    step.result = result;
    if (note !== undefined) step.note = String(note);
    step.by = result ? (by || '') : '';
    step.at = result ? (now || '') : '';
    step.retest = false;
    run.status = runStatusOf(run);
    return step;
}

// ---- readiness ----
// Ready when its own steps are all done and nothing is being asked of anyone, or when someone marked it ready.
export function isReadyForTesting(item, tasks, closedNames) {
    if (!item) return false;
    if (item.readyForTestingAt) return true;
    const w = deriveWorkStatus(item, tasks, { closedNames });
    return w.stepsTotal > 0 && w.stepsDone === w.stepsTotal && w.openAsks === 0;
}

const titleOf = (item, resource) => (!isBlank(item?.name) ? String(item.name).trim() : (resource?.name || ''));

export function assigneeForRole(client, roles, pattern, fallback = 'Sphynx Task') {
    const role = (roles || []).find((r) => pattern.test(String(r?.name || '')));
    const a = role ? (client?.projectData?.roleAssignments || []).find((x) => x.roleId === role.id) : null;
    return (a && a.memberName) || fallback;
}

export function markReadyForTesting(client, itemId, now) {
    for (const sheet of client?.projectData?.scopingSheets || []) {
        const item = (sheet.lineItems || []).find((i) => i && String(i.id) === String(itemId));
        if (item) { item.readyForTestingAt = now || new Date().toISOString(); return item; }
    }
    return null;
}

// ---- the main pass, run before each save ----
// ctx: { templates, roles, closedNames, resourceFor(item) -> resource|null, uid, now }
// Returns what it did, so the caller can tell the person.
export function updateTestRuns(client, ctx) {
    const result = { created: [], fixTasks: [], retests: [], passed: [], reopened: [] };
    const pd = client?.projectData;
    if (!pd) return result;
    if (!Array.isArray(pd.testRuns)) pd.testRuns = [];
    if (!Array.isArray(pd.clientTasks)) pd.clientTasks = [];
    const closed = (ctx.closedNames && ctx.closedNames.length) ? ctx.closedNames : ['Done'];
    const closedName = closed[0];
    const now = ctx.now || new Date().toISOString();
    const templates = ctx.templates || DEFAULT_TEST_TEMPLATES;
    const testerName = assigneeForRole(client, ctx.roles, /test/i);
    const builderName = assigneeForRole(client, ctx.roles, /implement/i);

    // 1. a request whose steps are done gets its own checklist and a Testing task
    (pd.scopingSheets || []).forEach((sheet) => {
        if (!sheet || sheet.status !== 'Approved') return;
        const real = (sheet.lineItems || []).filter((item) => item && typeof item === 'object' && !isBlank(item.id) && titleOf(item, ctx.resourceFor(item)));
        const current = getCurrentRound({ lineItems: real });
        if (current === null) return;

        real.forEach((item) => {
            if (String(item.status || '') !== 'Do Now') return;
            const r = parseInt(item.round, 10);
            const round = Number.isFinite(r) && r >= 1 ? r : 1;
            if (round !== current) return;
            const requestType = isBlank(item.requestType) ? 'build' : String(item.requestType);
            if (!TESTABLE_TYPES.includes(requestType)) return;
            if (pd.testRuns.some((run) => run.itemId === String(item.id) && run.sheetId === String(sheet.id ?? ''))) return;
            if (!isReadyForTesting(item, pd.clientTasks, closed)) return;

            const resource = ctx.resourceFor(item);
            const title = titleOf(item, resource);
            const run = buildRun({ item, sheetId: sheet.id, round, title, resourceName: resource?.name || '', requestType,
                                   templates, resourceType: resource?.type || '', uid: ctx.uid, now });
            if (!run) return;

            const task = {
                id: ctx.uid(), title: `Test: ${title}`, name: `Test: ${title}`,
                description: 'This request is ready. Open the checklist and mark each step Pass, Fail or Skipped. A failed step creates a fix task.',
                status: 'Pending Sphynx Action', assignee: testerName, dueDate: '', isClientTask: false, loggedHours: 0,
                parentTaskId: null, createdBy: 'testing', createdAt: now, testRunId: run.id, testForItemId: String(item.id),
            };
            run.testTaskId = task.id;
            pd.clientTasks.unshift(task);
            pd.testRuns.push(run);
            item.testingStartedAt = now;
            result.created.push(run.id);
        });
    });

    // 2. every run: fix tasks for failed steps, retests once a fix is done, and the Testing task follows the run
    pd.testRuns.forEach((run) => {
        (run.steps || []).forEach((step) => {
            if (step.result === TEST_RESULTS.FAIL && !step.fixTaskId) {
                const fix = {
                    id: ctx.uid(), title: `Fix: ${step.title} (${run.title})`, name: `Fix: ${step.title} (${run.title})`,
                    description: [step.note ? `Tester's note: ${step.note}` : '', step.how ? `How it was tested: ${step.how}` : '', step.expected ? `Expected: ${step.expected}` : ''].filter(Boolean).join('\n'),
                    status: 'Pending Sphynx Action', assignee: builderName, dueDate: '', isClientTask: false, loggedHours: 0,
                    parentTaskId: null, createdBy: 'testing', createdAt: now,
                    requestLineItemId: run.itemId, fixForTestRunId: run.id, fixForStepId: step.id,
                };
                pd.clientTasks.unshift(fix);
                step.fixTaskId = fix.id;
                result.fixTasks.push(fix.id);
            } else if (step.result === TEST_RESULTS.FAIL && step.fixTaskId) {
                const fix = pd.clientTasks.find((t) => t.id === step.fixTaskId);
                if (fix && isTaskClosed(fix, closed)) {
                    step.previousNote = step.note;
                    step.result = ''; step.by = ''; step.at = ''; step.fixTaskId = ''; step.retest = true;
                    result.retests.push(step.id);
                }
            }
        });

        const status = runStatusOf(run);
        run.status = status;
        const task = pd.clientTasks.find((t) => t.id === run.testTaskId);
        if (status === 'passed') {
            if (!run.passedAt) { run.passedAt = now; result.passed.push(run.id); }
            if (task && !isTaskClosed(task, closed)) { task.status = closedName; task.completedAt = now; }
        } else {
            if (run.passedAt) run.passedAt = '';
            if (task && isTaskClosed(task, closed)) { task.status = 'Pending Sphynx Action'; task.completedAt = ''; result.reopened.push(run.id); }
        }
    });

    return result;
}

export function runForItem(client, itemId, sheetId) {
    return (client?.projectData?.testRuns || []).find((r) => r.itemId === String(itemId) && (sheetId === undefined || r.sheetId === String(sheetId ?? ''))) || null;
}
export const testRunById = (client, runId) => (client?.projectData?.testRuns || []).find((r) => r.id === runId) || null;
