//======================= CORE / WORK STATUS =======================//
// Derives where a request stands from the tasks linked to it. Pure functions:
// no database, no page. Used by the requests sync (core/requests.js) and the
// scoping sheet.
//
// Tasks link to a request through two fields on the task (client project JSON):
//   requestLineItemId  the scoping line item the task belongs to
//   isBlocker          true if work on the request cannot continue without it
//   askKind            'review' | 'document' | 'feedback' | 'third_party' for something
//                      asked of the client or a third party, 'follow_up' for the
//                      Communication follow-up, and empty for Sphynx's own steps
//
// Rules
//   * No open asks                          -> Pending Sphynx Action (Implementation)
//   * Open asks and EVERY one is a blocker  -> Waiting (Communication)
//   * Open asks, some not blockers          -> stays Pending Sphynx Action, unless the
//                                              request has step tasks and none are open,
//                                              in which case there is nothing left for
//                                              Sphynx to do and it waits
//   * Waiting is "on Client" if any open ask is for the client, else "on Third Party"

export const WORK_STATUS = {
    PENDING: 'pending_sphynx_action',
    WAITING_CLIENT: 'waiting_on_client',
    WAITING_THIRD: 'waiting_on_third_party',
    IN_TESTING: 'in_testing',                  // Sphynx is testing it
    CLIENT_REVIEW: 'pending_client_review',    // the client is reviewing it
    DONE: 'done',
};

export const WORK_STATUS_LABELS = {
    pending_sphynx_action: 'Pending Sphynx Action',
    waiting_on_client: 'Waiting on Client',
    waiting_on_third_party: 'Waiting on Third Party',
    blocked: 'Blocked',
    in_testing: 'In Testing',
    pending_client_review: 'Pending Client Review',
    done: 'Done',
};

// What the "Ask client" form offers, and the task status each kind gets.
export const ASK_KINDS = {
    review:      { label: 'Client review',   taskStatus: 'Pending Client Review',       owner: 'client' },
    document:    { label: 'Client document', taskStatus: 'Pending Client Document',     owner: 'client' },
    feedback:    { label: 'Client feedback', taskStatus: 'Pending Client Feedback',     owner: 'client' },
    third_party: { label: 'Third party',     taskStatus: 'Pending Third Party Support', owner: 'third_party' },
};

const ASK_KEYS = Object.keys(ASK_KINDS);

export function isTaskClosed(task, closedNames) {
    const names = Array.isArray(closedNames) && closedNames.length ? closedNames : ['Done'];
    return !!task && names.includes(String(task.status || ''));
}

export function tasksForItem(tasks, itemId) {
    return (tasks || []).filter(t => t && t.requestLineItemId !== undefined && t.requestLineItemId !== null
        && String(t.requestLineItemId) === String(itemId));
}

// Which testing phase a request is in, from the client project: 'review' while its round is in the client's
// review, 'testing' once it has a testing checklist, otherwise null (still being built).
export function testingPhaseFor(pd, sheetId, item, round) {
    if (!pd || !item) return null;
    const st = pd.roundStates && pd.roundStates[`${sheetId ?? ''}:${round}`];
    if (st && st.status === 'in_review') return 'review';
    const hasRun = (pd.testRuns || []).some((r) => r && r.itemId === String(item.id) && r.sheetId === String(sheetId ?? ''));
    return hasRun ? 'testing' : null;
}

// Testing works the opposite way round to building. While building, a request is "Pending Sphynx Action" and
// flips to waiting when something is asked of the client. While testing it is "In Testing" (or, in the client's
// review, "Pending Client Review") and flips back to "Pending Sphynx Action" as soon as there is work for Sphynx
// to do (a fix task from a failed step), then returns to testing or review when that work is done.
// opts.phase is 'testing' or 'review' (see testingPhaseFor).
export function deriveWorkStatus(item, tasks, opts = {}) {
    const closedNames = Array.isArray(opts.closedNames) && opts.closedNames.length ? opts.closedNames : ['Done'];
    const empty = { status: WORK_STATUS.PENDING, role: 'implementation', openAsks: 0, openBlockers: 0, waitingOn: null, stepsTotal: 0, stepsDone: 0 };

    if (!item) return empty;
    if (String(item.status || '') === 'Done') {
        return { ...empty, status: WORK_STATUS.DONE, role: null };
    }

    const linked = tasksForItem(tasks, item.id);
    const openAsks = linked.filter(t => ASK_KEYS.includes(t.askKind) && !isTaskClosed(t, closedNames));
    const openBlockers = openAsks.filter(t => t.isBlocker).length;

    const steps = linked.filter(t => !t.askKind);                 // Sphynx's own step tasks
    const openSteps = steps.filter(t => !isTaskClosed(t, closedNames));
    const progress = { stepsTotal: steps.length, stepsDone: steps.length - openSteps.length };

    if (openAsks.length === 0) {
        if (opts.phase && openSteps.length === 0) {
            const review = opts.phase === 'review';
            return { ...empty, status: review ? WORK_STATUS.CLIENT_REVIEW : WORK_STATUS.IN_TESTING, role: review ? 'communication' : 'testing', ...progress };
        }
        return { ...empty, ...progress };
    }
    const allBlockers = openBlockers === openAsks.length;
    const nothingLeftForSphynx = steps.length > 0 && openSteps.length === 0;

    if (!allBlockers && !nothingLeftForSphynx) {
        return { ...empty, openAsks: openAsks.length, openBlockers, ...progress };
    }

    const waitingOn = openAsks.some(t => t.askKind !== 'third_party') ? 'client' : 'third_party';
    return {
        status: waitingOn === 'client' ? WORK_STATUS.WAITING_CLIENT : WORK_STATUS.WAITING_THIRD,
        role: 'communication',
        openAsks: openAsks.length,
        openBlockers,
        waitingOn,
        ...progress,
    };
}
