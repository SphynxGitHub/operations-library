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
import { buildActivationPlan, DEFAULT_ASK_TEMPLATES } from '../../core/activation.js';

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

    const plan = buildActivationPlan({
        item, resources, requestType,
        resourceType: resources[0]?.type || '',
        askTemplates,
        client, roles: state.master.roles || [],
        assigneeByType: state.master.assigneeByType || {},   // assignee_by_type.sql — suggestAssignee falls back to role-matching when empty
        uid,
    });

    OL._activationReviewState = { clientId, itemId, requestType, resourceType: resources[0]?.type || '', askTemplates, plan };
    OL.renderActivationReviewStep();
};

function rowHTML(st, row) {
    const isAsk = row.kind === 'ask';
    return `
        <div style="display:flex; align-items:flex-start; gap:8px; padding:8px 10px; border:1px solid var(--line); border-radius:6px; margin-bottom:6px; ${row.included ? '' : 'opacity:0.5;'}">
            <input type="checkbox" ${row.included ? 'checked' : ''} style="margin-top:2px;" onchange="OL.toggleActivationPlanRow('${row.id}')">
            <div style="flex:1; min-width:0;">
                <div style="font-size:13px;">${esc(row.title)}${row.resourceName ? ` <span class="tiny muted">· ${esc(row.resourceName)}</span>` : ''}</div>
                ${isAsk && row.instructions ? `<div class="tiny muted" style="margin-top:2px;">${esc(row.instructions)}</div>` : ''}
                ${!isAsk ? `
                    <div style="margin-top:4px;">
                        <input type="text" class="tiny modal-input" value="${esc(row.assignee || '')}" placeholder="Assignee"
                               style="width:180px; padding:3px 6px;"
                               onchange="OL.setActivationRowAssignee('${row.id}', this.value)">
                    </div>
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
    // No re-render here — the input already shows what was typed, and
    // re-rendering while someone is still typing would steal focus.
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

OL.confirmActivationReview = function() {
    const st = OL._activationReviewState;
    if (!st) return;
    const clientId = st.clientId;

    updateAndSync(() => {
        const client = state.clients?.[clientId];
        const item = OL.findRequestItem ? OL.findRequestItem(client, st.itemId) : null;
        if (!client || !item) return;
        OL.commitRequestActivation(client, item, st.plan, { requestType: st.requestType, resourceType: st.resourceType });
    }, clientId);

    OL._activationReviewState = null;
    OL.closeModal();
};
