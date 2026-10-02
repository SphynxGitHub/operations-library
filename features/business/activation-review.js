//======================= FEATURES / ACTIVATION REVIEW =======================//
// The screen shown for a request that has just become Do Now in an approved
// round (see core/requests.js listNewActivations / OL.pendingRequestActivations
// in features/business/automations.js) but hasn't activated yet. Renders the
// plan core/activation.js's buildActivationPlan proposes — one
// implementation/revision task per resource (or one for the request itself,
// for a non-resource request like an audit), plus SOP ask-templates — lets
// someone edit it, then commits via OL.commitRequestActivation, which is the
// only place any of this actually gets written.
//
// Nothing here mutates client data directly except the final "Activate"
// click — everything before that only edits OL._activationReviewState.plan
// in memory, so backing out of the modal with no changes made is a no-op.

import { esc, uid, state, updateAndSync, loadFullClient } from '../../core/data.js';
import { requestResourceIds } from '../../core/request-pricing.js';
import { buildActivationPlan, DEFAULT_ASK_TEMPLATES, computeActivationOverrides, applySopUpdates } from '../../core/activation.js';
import { findFirstAvailableDate, dailyLoadHours, dayLoadTier, loadTier, maxTierFor, TIER_ORDER } from '../../core/scheduling.js';
import { getOlSettings } from '../../core/ol-settings.js';
import { getCurrentRound, isRoundApproved } from '../../core/requests.js';
import { isMaintenanceSheet } from '../../core/maintenance.js';

const resourceLookup = (client) => (id) =>
    (client?.projectData?.localResources || []).find((r) => r.id === id) || (state.master?.resources || []).find((r) => r.id === id) || null;

// Entry point — called from wherever pending activations are surfaced (a
// badge on the scoping sheet, a list of "N requests awaiting activation").
OL.openActivationReview = async function(clientId, itemId) {
    if (clientId) await loadFullClient(clientId).catch(() => null);
    const client = state.clients?.[clientId];
    if (!client) return;

    const item = OL.findRequestItem ? OL.findRequestItem(client, itemId) : null;
    if (!item) return;

    const lookup = resourceLookup(client);
    const resources = requestResourceIds(item).map((id) => lookup(id)).filter(Boolean);
    const requestType = item.requestType || 'build';
    const askTemplates = (state.master.askTemplates && state.master.askTemplates.length) ? state.master.askTemplates : DEFAULT_ASK_TEMPLATES;
    // Scoped to this client — calendar events are already client-linked
    // (features/business/calendar.js), and a task's own project is the
    // only pool that matters for its queued-hours load.
    const calendarEvents = (state.master?.googleCalendarEvents || []).filter((e) => e.linked_client_id === clientId);
    const existingTasks = client.projectData?.clientTasks || [];

    const plan = buildActivationPlan({
        item, resources, requestType,
        resourceType: resources[0]?.type || '',
        askTemplates,
        client, roles: state.master.roles || [],
        assigneeByType: state.master.assigneeByType || {},   // assignee_by_type.sql — suggestAssignee falls back to role-matching when empty
        uid, calendarEvents, existingTasks,
    });

    OL._activationReviewState = { clientId, itemId, requestType, resourceType: resources[0]?.type || '', askTemplates, plan, calendarEvents, existingTasks };
    OL.renderActivationReviewStep();
};

// ---- Why is (or isn't) a request waiting for activation? ------------------------------------------------------------
// OL.explainActivations() answers it for every request on every sheet of the open project, one line each, and prints
// the table to the browser console. Pure reading; nothing is changed.
export function explainActivationRows(client, masterResources = []) {
    const rows = [];
    const lookup = (id) => (client?.projectData?.localResources || []).find((r) => r.id === id) || (masterResources || []).find((r) => r.id === id) || null;
    (client?.projectData?.scopingSheets || []).forEach((sheet, idx) => {
        if (!sheet) return;
        const maint = isMaintenanceSheet(sheet);
        const real = (sheet.lineItems || []).filter((i) => i && typeof i === 'object' && i.id != null && String(i.id).trim() !== '');
        const named = (i) => !!String(i.name || '').trim() || !!(i.resourceId && lookup(i.resourceId));
        const current = getCurrentRound({ lineItems: real.filter(named), roundApprovals: sheet.roundApprovals, status: sheet.status });
        real.forEach((item) => {
            const status = String(item.status || '');
            const r = parseInt(item.round, 10);
            const round = Number.isFinite(r) && r >= 1 ? r : (status === 'Backlog' ? null : 1);
            let verdict;
            if (item.activatedAt) verdict = 'Already activated';
            else if (status === 'Backlog') verdict = 'In Backlog (round 0): give it a round first';
            else if (status !== 'Do Now') verdict = `Status is "${status || 'blank'}": only Do Now is activated`;
            else if (!named(item)) verdict = 'No name and no resource that can be found';
            else if (!isRoundApproved(sheet, round)) verdict = `Round ${round} is not Approved`;
            else if (current !== round) verdict = `Round ${current} comes first: it still has open Do Now requests`;
            else verdict = 'READY: should show under "awaiting activation review"';
            rows.push({ sheet: maint ? 'Maintenance queue' : (idx === 0 ? 'Scoping sheet' : `Sheet ${idx + 1}`), request: String(item.name || lookup(item.resourceId)?.name || item.id), status: status || '(blank)', round: round ?? '-', verdict });
        });
    });
    return rows;
}
OL.explainActivations = function() {
    const client = state.clients?.[state.activeClientId];
    if (!client) { console.warn('Open a project first.'); return []; }
    const rows = explainActivationRows(client, state.master?.resources || []);
    console.log(`Activation check for ${client.meta?.name || client.id}: ${rows.filter((r) => r.verdict.startsWith('READY')).length} ready of ${rows.length} requests`);
    console.table(rows);
    return rows;
};

// ---- Review a whole round, one request after another ---------------------------------------------------------------
// Approving a round (features/scoping.js setRoundApprovalStatus) opens the review for the first ready request;
// activating it opens the next, until none are left. Closing the window without activating stops the chain, and the
// rest stay on the scoping sheet's "awaiting activation review" list.
// Only the sheet whose round was approved: a Maintenance queue request is also "Do Now, round 1", but approving a
// working round on the scoping sheet has nothing to do with it.
const pendingForRound = (clientId, round, sheetId) => {
    const client = state.clients?.[clientId];
    if (!client || typeof OL.pendingRequestActivations !== 'function') return [];
    return OL.pendingRequestActivations(client, state.master?.resources || [])
        .filter((p) => (!round || p.round === round) && (sheetId === undefined || p.sheet?.id === sheetId));
};

OL.startActivationQueue = function(clientId, round, sheetId) {
    const pending = pendingForRound(clientId, round, sheetId);
    if (!pending.length) { OL._activationQueue = null; return 0; }
    OL._activationQueue = { clientId, round, sheetId, itemIds: pending.map((p) => String(p.item.id)) };
    if (typeof OL.showToast === 'function') OL.showToast(`Round ${round} approved. Reviewing ${pending.length} request${pending.length === 1 ? '' : 's'} for activation.`);
    OL.openActivationReview(clientId, pending[0].item.id);
    return pending.length;
};

// Called after a request is activated: open the next one in the same round's queue, if any is still waiting.
OL.openNextQueuedActivation = function(clientId, justDoneItemId) {
    const q = OL._activationQueue;
    if (!q || q.clientId !== clientId || !q.itemIds.includes(String(justDoneItemId))) return false;
    const stillWaiting = pendingForRound(clientId, q.round, q.sheetId).filter((p) => q.itemIds.includes(String(p.item.id)));
    if (!stillWaiting.length) { OL._activationQueue = null; if (typeof OL.showToast === 'function') OL.showToast(`Round ${q.round}: every ready request is activated.`); return false; }
    OL.openActivationReview(clientId, stillWaiting[0].item.id);
    return true;
};

// How busy the assignee is on a row's due date, before this row: meetings + tasks already due that day, plus the
// other included rows in this plan for the same person and day. The level (Green under 3h, Yellow 3h-3:59, Red 4h-4:59,
// Closed 5h+ — cut-offs are settings) is the same one the auto-slotter uses, and `over` says whether it is past what
// this client's status may use.
function rowLoad(st, row) {
    if (!st || row.kind !== 'implementation' || !row.assignee || !row.dueDate) return null;
    const day = String(row.dueDate).slice(0, 10);
    const base = dailyLoadHours(st.calendarEvents, st.existingTasks, row.assignee, day);
    const others = (st.plan || []).filter((r) => r !== row && r.included && r.kind === 'implementation' && r.assignee === row.assignee && String(r.dueDate || '').slice(0, 10) === day)
        .reduce((sum, r) => sum + (Number(r.estimatedHours) || 0), 0);
    const hours = base + others;
    const cfg = getOlSettings().scheduling;
    const level = loadTier(hours, cfg);
    const limit = maxTierFor(state.clients?.[st.clientId]?.meta?.status, cfg);
    return { hours, tier: dayLoadTier(hours, cfg), level, over: level === 'closed' || TIER_ORDER.indexOf(level) > TIER_ORDER.indexOf(limit), limit };
}

const LEVEL_STYLE = { green: ['#16a34a', 'Green'], yellow: ['#ca8a04', 'Yellow'], red: ['#ef4444', 'Red'], closed: ['#6b7280', 'Closed'] };

function rowHTML(st, row) {
    const isAsk = row.kind === 'ask';
    return `
        <div style="display:flex; align-items:flex-start; gap:8px; padding:8px 10px; border:1px solid var(--line); border-radius:6px; margin-bottom:6px; ${row.included ? '' : 'opacity:0.5;'}">
            <input type="checkbox" ${row.included ? 'checked' : ''} style="margin-top:2px;" onchange="OL.toggleActivationPlanRow('${row.id}')">
            <div style="flex:1; min-width:0;">
                <div style="font-size:13px;">${esc(row.title)}${row.resourceName ? ` <span class="tiny muted">· ${esc(row.resourceName)}</span>` : ''}</div>
                ${isAsk && row.instructions ? `<div class="tiny muted" style="margin-top:2px;">${esc(row.instructions)}</div>` : ''}
                ${!isAsk ? `
                    <div style="margin-top:4px; display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                        <input type="text" class="tiny modal-input" value="${esc(row.assignee || '')}" placeholder="Assignee"
                               style="width:160px; padding:3px 6px;"
                               onchange="OL.setActivationRowAssignee('${row.id}', this.value)">
                        <input type="date" class="tiny modal-input" value="${esc(row.dueDate || '')}"
                               style="width:150px; padding:3px 6px;"
                               onchange="OL.setActivationRowDueDate('${row.id}', this.value)">
                        <span class="tiny" style="color:${row.estimatedHours ? 'var(--text-muted, #94a3b8)' : 'inherit'};">${row.estimatedHours ? `est. ${row.estimatedHours}h` : ''}</span>
                    </div>
                    ${(() => { const l = rowLoad(st, row); if (!l || l.level === 'green') return ''; const [c, name] = LEVEL_STYLE[l.level]; return `<div class="tiny" style="color:${c}; margin-top:2px;"><b>${name}</b>: ${l.hours.toFixed(1)}h already booked that day${l.over ? ` — past what ${esc(state.clients?.[st.clientId]?.meta?.status || 'this client')} clients can be given (${LEVEL_STYLE[l.limit][1]} at most)` : ''}.</div>`; })()}
                    ${!row.dueDate && row.dueDateReason === 'no_capacity_in_window' ? `<div class="tiny" style="color:#ef4444; margin-top:2px;">No open slot found in the next ${getOlSettings().scheduling.windowDays} working days — ${esc(row.reviewer || 'a person')} needs to pick a date manually.</div>` : ''}
                ` : ''}
                ${isAsk && !row.templateId ? `<div class="tiny" style="color:#f0ad4e; margin-top:2px;">Not on the SOP — will be logged for review.</div>` : ''}
            </div>
        </div>
    `;
}

OL.renderActivationReviewStep = function() {
    const st = OL._activationReviewState;
    if (!st) return;
    const client = state.clients?.[st.clientId];
    if (!client) return;

    const implRows = st.plan.filter((r) => r.kind === 'implementation');
    const askRows = st.plan.filter((r) => r.kind === 'ask');
    const includedCount = st.plan.filter((r) => r.included).length;

    const content = `
        <div style="padding:20px; max-width:520px; width:100%;" onclick="event.stopPropagation()">
            <div class="modal-header" style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--line); padding-bottom:10px; margin-bottom:14px;">
                <h3 style="margin:0; font-size:15px;">Review before activating</h3>
                <button class="btn tiny soft" onclick="OL.closeModal()">✕</button>
            </div>

            <div class="tiny bold uppercase muted" style="margin-bottom:6px;">Implementation</div>
            <div style="margin-bottom:14px;">${implRows.map((r) => rowHTML(st, r)).join('') || '<div class="tiny muted">Nothing to build.</div>'}</div>

            <div class="tiny bold uppercase muted" style="margin-bottom:6px;">Before-phase (client asks)</div>
            <div style="margin-bottom:10px;">${askRows.map((r) => rowHTML(st, r)).join('') || '<div class="tiny muted">No client asks from the SOP.</div>'}</div>

            <button class="btn tiny soft" style="width:100%; margin-bottom:14px;" onclick="OL.addCustomActivationAsk()">+ Add a client ask not on the SOP</button>

            <div style="display:flex; justify-content:flex-end; gap:8px; border-top:1px solid var(--line); padding-top:12px;">
                <button class="btn tiny soft" onclick="OL.closeModal()">Cancel</button>
                <button class="btn tiny primary" ${includedCount ? '' : 'disabled'} onclick="OL.confirmActivationReview()">Activate with ${includedCount} task${includedCount === 1 ? '' : 's'}</button>
            </div>
        </div>
    `;
    OL.showOverlayModal(content);
};

OL.toggleActivationPlanRow = function(rowId) {
    const st = OL._activationReviewState;
    const row = st?.plan.find((r) => r.id === rowId);
    if (!row) return;
    row.included = !row.included;
    OL.reRenderPreservingFocus(() => OL.renderActivationReviewStep());
};

OL.setActivationRowAssignee = function(rowId, value) {
    const st = OL._activationReviewState;
    const row = st?.plan.find((r) => r.id === rowId);
    if (!row) return;
    row.assignee = value;
    // A different assignee has a different schedule — the old
    // auto-suggested date belonged to the previous person, so it's
    // recomputed here rather than left stale. This does need a re-render
    // (the date field's value changes), unlike a plain text edit.
    if (row.kind === 'implementation' && st) {
        const slot = findFirstAvailableDate({ calendarEvents: st.calendarEvents, tasks: st.existingTasks, assignee: value, estimatedHours: row.estimatedHours, clientStatus: state.clients?.[st.clientId]?.meta?.status, config: getOlSettings().scheduling });
        row.dueDate = slot.date;
        row.dueDateReason = slot.date ? null : slot.reason;
        row.reviewer = slot.date ? '' : (slot.reviewer || '');
        OL.reRenderPreservingFocus(() => OL.renderActivationReviewStep());
    }
};

OL.setActivationRowDueDate = function(rowId, value) {
    const st = OL._activationReviewState;
    const row = st?.plan.find((r) => r.id === rowId);
    if (!row) return;
    row.dueDate = value;
    row.dueDateReason = null;   // a manually picked date isn't "no capacity found" anymore, whatever it was before
    OL.reRenderPreservingFocus(() => OL.renderActivationReviewStep());   // the day's load flag depends on the date
};

// A manual addition — templateId stays null, which is exactly what
// core/activation.js's commitActivationPlan reads to log it as an SOP
// override for the periodic fold-back review.
OL.addCustomActivationAsk = function() {
    const st = OL._activationReviewState;
    if (!st) return;
    const title = prompt('What do you need from the client?');
    if (!title || !title.trim()) return;

    st.plan.push({
        id: uid(), kind: 'ask', templateId: null,
        title: title.trim(), instructions: '', askKind: 'document',
        resourceId: null, resourceName: '', assignee: null, included: true,
    });
    OL.renderActivationReviewStep();
};

// The SOP's current client-ask templates (the built-in starting set until an org saves its own).
const currentAskTemplates = () => (state.master?.askTemplates && state.master.askTemplates.length) ? state.master.askTemplates : DEFAULT_ASK_TEMPLATES;

// Commit the reviewed plan. If it differs from the SOP's client asks (an SOP ask unchecked, or an ask added
// that isn't on the SOP), ask first: apply that to future requests like this one, or just this once (Smart SOP
// Updates). With no differences it commits straight away.
OL.confirmActivationReview = function() {
    const st = OL._activationReviewState;
    if (!st) return;

    const overrides = computeActivationOverrides(st.plan, {
        requestType: st.requestType, resourceType: st.resourceType, askTemplates: currentAskTemplates(),
    });
    if (!overrides.length) { OL._commitActivationReview([]); return; }

    st.sopChanges = overrides.map((override) => ({ override, scope: 'once' }));
    OL.renderSopUpdatePrompt();
};

OL.renderSopUpdatePrompt = function() {
    const st = OL._activationReviewState;
    if (!st || !st.sopChanges) return;
    const scopeLabel = `${st.requestType || 'build'}${st.resourceType ? ' / ' + st.resourceType : ''}`;
    const rows = st.sopChanges.map((c, i) => {
        const o = c.override;
        const once = `<label style="display:flex; gap:6px; align-items:center; font-size:12px;"><input type="radio" name="sop-${i}" ${c.scope === 'once' ? 'checked' : ''} onchange="OL.setSopChangeScope(${i}, 'once')"> Just this once</label>`;
        const future = o.action === 'removed'
            ? `<label style="display:flex; gap:6px; align-items:center; font-size:12px;"><input type="radio" name="sop-${i}" ${c.scope === 'future' ? 'checked' : ''} onchange="OL.setSopChangeScope(${i}, 'future')"> Stop asking for this on future ${esc(scopeLabel)} requests</label>`
            : `<label style="display:flex; gap:6px; align-items:center; font-size:12px;"><input type="radio" name="sop-${i}" ${c.scope === 'future' ? 'checked' : ''} onchange="OL.setSopChangeScope(${i}, 'future')"> Add to the SOP for future ${esc(scopeLabel)} requests</label>`;
        return `
            <div style="padding:10px 12px; border:1px solid var(--line); border-radius:6px; margin-bottom:8px;">
                <div style="font-size:13px; margin-bottom:6px;">${o.action === 'removed' ? 'You left out' : 'You added'}: <strong>${esc(o.name || o.title || '')}</strong></div>
                <div style="display:flex; flex-direction:column; gap:4px;">${once}${future}</div>
            </div>`;
    }).join('');

    OL.showOverlayModal(`
        <div style="padding:20px; max-width:560px; width:100%;" onclick="event.stopPropagation()">
            <h3 style="margin:0 0 6px;">Update the SOP?</h3>
            <p class="tiny muted" style="margin:0 0 14px;">This plan differs from the SOP's client asks. Choose whether each change should apply to future requests like this one, or only to this request.</p>
            ${rows}
            <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:14px; border-top:1px solid var(--line); padding-top:12px;">
                <button class="btn tiny soft" onclick="OL.backToActivationReview()">Back</button>
                <button class="btn tiny primary" onclick="OL.finishActivationWithSopChoices()">Activate</button>
            </div>
        </div>`);
};

OL.setSopChangeScope = function(i, scope) {
    const c = OL._activationReviewState?.sopChanges?.[i];
    if (c) c.scope = scope;
};

OL.backToActivationReview = function() {
    if (OL._activationReviewState) OL._activationReviewState.sopChanges = null;
    OL.renderActivationReviewStep();
};

OL.finishActivationWithSopChoices = function() {
    const st = OL._activationReviewState;
    OL._commitActivationReview(st?.sopChanges || []);
};

// Creates the tasks, then applies any "future requests" choices to the SOP's ask templates (after the commit,
// so the commit still logs what differed from the SOP as it was).
OL._commitActivationReview = function(decisions) {
    const st = OL._activationReviewState;
    if (!st) return;
    const clientId = st.clientId;

    let buildTasks = [];
    updateAndSync(() => {
        const client = state.clients?.[clientId];
        const item = OL.findRequestItem ? OL.findRequestItem(client, st.itemId) : null;
        if (!client || !item) return;
        const committed = OL.commitRequestActivation(client, item, st.plan, { requestType: st.requestType, resourceType: st.resourceType });
        // The build (implementation) tasks just created — not the client asks.
        const made = new Set((committed && committed.createdTaskIds) || []);
        buildTasks = (client.projectData.clientTasks || []).filter((t) => made.has(t.id) && !t.askKind && !t.isClientTask).map((t) => ({ id: t.id, title: t.title || t.name }));

        if ((decisions || []).some((d) => d.scope === 'future')) {
            const base = (state.master.askTemplates && state.master.askTemplates.length) ? state.master.askTemplates : DEFAULT_ASK_TEMPLATES;
            state.master.askTemplates = applySopUpdates(base, decisions, { requestType: st.requestType, resourceType: st.resourceType, uid });
        }
    }, clientId).then(() => {
        // Anything already linked to the request from email rolls down onto the new build tasks.
        if (buildTasks.length && typeof OL.rollDownRequestLinks === 'function') return OL.rollDownRequestLinks(clientId, st.itemId, buildTasks);
    }).catch((e) => console.warn('Rolling links down failed:', e))
      .then(() => { try { OL.openNextQueuedActivation(clientId, st.itemId); } catch (e) { console.warn('Next activation did not open:', e); } });

    OL._activationReviewState = null;
    OL.closeModal();
};
