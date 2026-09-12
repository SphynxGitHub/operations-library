// ================= 🤖 AUTOMATION ENGINE + BUILDER =================
// Generic trigger -> condition(s) -> action rule engine.
//
// Rule shape (stored in state.master.automationRules):
// {
//   id, name, enabled: true,
//   trigger: 'task_status_change' | 'scoping_status_change',
//   conditions: [ { field, op: 'equals'|'not_equals', value } ],  // AND'd
//   action: {
//     type: 'create_task',
//     titleTemplate: 'Implementation: {resourceName}',
//     assignee: 'Sphynx Task',
//     status: 'Pending Sphynx Action',
//     dueInDays: null | number,
//     asSubtask: false
//   }
// }
//
// Context fields available to conditions/templates, by trigger:
//   task_status_change:    newStatus, previousStatus, assignee, title, resourceName
//   scoping_status_change:  field, newValue, previousValue, status, party, resourceName

import { esc, uid, state, updateAndSync } from '../../core/data.js';

const TASK_STATUS_FIELDS = [
    { key: 'newStatus', label: 'New Status' },
    { key: 'previousStatus', label: 'Previous Status' },
    { key: 'assignee', label: 'Assignee' }
];

const SCOPING_STATUS_FIELDS = [
    { key: 'field', label: 'Field Changed (status / party)' },
    { key: 'newValue', label: 'New Value' },
    { key: 'previousValue', label: 'Previous Value' },
    { key: 'status', label: 'Line Item Status' },
    { key: 'party', label: 'Billable Party' }
];

const CALENDAR_EVENT_FIELDS = [
    { key: 'eventTitle', label: 'Event Title' }
];

OL.getAutomationConditionFields = function(trigger) {
    if (trigger === 'scoping_status_change') return SCOPING_STATUS_FIELDS;
    if (trigger === 'calendar_event_synced') return CALENDAR_EVENT_FIELDS;
    return TASK_STATUS_FIELDS;
};

// Fields whose value is a known, enumerable set get a dropdown instead of
// free text — mainly status fields (pulled from the real status pipeline)
// and assignee. Everything else (responsibleParty, arbitrary field names)
// stays free text since it isn't reliably enumerable at the master level.
OL.getAutomationConditionValueOptions = function(field) {
    if (['newStatus', 'previousStatus', 'status'].includes(field)) {
        return (OL.getSystemStatuses ? OL.getSystemStatuses() : []).map(s => s.name);
    }
    if (field === 'assignee') {
        const opts = ['Sphynx Task', 'Client Task'];
        (state.master?.sphynxTeam || []).forEach(m => opts.push(m.name));
        (OL.thirdPartyAssignees || []).forEach(tp => opts.push(tp));
        return opts;
    }
    return null; // signals free text
};

OL.renderAutomationConditionValueControl = function(field, currentValue) {
    const options = OL.getAutomationConditionValueOptions(field);
    if (options) {
        return `<select class="modal-input tiny cond-value">
            <option value="">Select...</option>
            ${options.map(v => `<option value="${esc(v)}" ${currentValue === v ? 'selected' : ''}>${esc(v)}</option>`).join('')}
        </select>`;
    }
    return `<input type="text" class="modal-input tiny cond-value" placeholder="value" value="${esc(currentValue || '')}">`;
};

// Fired when a condition row's field selector changes — swaps the value
// cell between a dropdown and free text as appropriate for the new field.
OL.onAutomationConditionFieldChange = function(selectEl) {
    const row = selectEl.closest('.automation-condition-row');
    const valueCell = row?.querySelector('.cond-value-cell');
    if (valueCell) valueCell.innerHTML = OL.renderAutomationConditionValueControl(selectEl.value, '');
};

// ---- ENGINE: called from the hook points in tasks.js / scoping.js ----
// IMPORTANT: this must be called from *inside* an updateAndSync mutationFn
// so any tasks it creates are captured in the same dirty/persist cycle.
OL.runAutomationRules = function(triggerType, ctx) {
    const rules = (state.master.automationRules || []).filter(r => r.enabled && r.trigger === triggerType);

    rules.forEach(rule => {
        const conditions = rule.conditions || [];
        const matches = conditions.every(c => {
            const actual = ctx[c.field];
            const actualStr = (actual === undefined || actual === null) ? '' : String(actual);
            const expected = String(c.value ?? '');
            if (c.op === 'not_equals') return actualStr !== expected;
            if (c.op === 'contains') return actualStr.toLowerCase().includes(expected.toLowerCase());
            return actualStr === expected;
        });

        if (matches) {
            try {
                OL.executeAutomationAction(rule, ctx);
            } catch (e) {
                console.error(`🤖 Automation "${rule.name}" failed to run:`, e);
            }
        }
    });
};

OL.executeAutomationAction = function(rule, ctx) {
    const action = rule.action || {};
    const client = ctx.client;
    if (!client) return;
    if (!client.projectData) client.projectData = {};
    if (!client.projectData.clientTasks) client.projectData.clientTasks = [];

    if (action.type === 'apply_blueprint') {
        const blueprint = (state.master.taskBlueprints || []).find(b => b.id === action.blueprintId);
        if (!blueprint) {
            console.warn(`🤖 Automation "${rule.name}" references a blueprint that no longer exists.`);
            return;
        }
        if (typeof OL.buildTaskFromBlueprint !== 'function') return;

        const newTask = OL.buildTaskFromBlueprint(blueprint, client, {
            resourceName: ctx.resourceName,
            title: ctx.title,
            asSubtask: action.asSubtask,
            task: ctx.task,
            dueInDaysOverride: (action.dueInDays === undefined || action.dueInDays === null || action.dueInDays === '') ? undefined : action.dueInDays,
            automationRuleId: rule.id
        });

        client.projectData.clientTasks.unshift(newTask);
        console.log(`🤖 Automation "${rule.name}" applied blueprint "${blueprint.title}" for ${client.meta?.name || client.id}`);
        return;
    }

    if (action.type === 'apply_sop') {
        const sop = (state.master.sops || []).find(s => s.id === action.sopId);
        if (!sop) {
            console.warn(`🤖 Automation "${rule.name}" references an SOP that no longer exists.`);
            return;
        }
        if (typeof OL.createTasksFromSop !== 'function') return;

        const itemCount = (typeof OL.resolveSopItems === 'function' ? OL.resolveSopItems(sop) : []).length;
        if (itemCount === 0) {
            console.warn(`🤖 Automation "${rule.name}" fired an empty SOP "${sop.name}" — nothing to create.`);
            return;
        }

        const createdTasks = OL.createTasksFromSop(sop, client, {
            resourceName: ctx.resourceName,
            title: ctx.title,
            asSubtask: action.asSubtask,
            task: ctx.task,
            dueInDaysOverride: (action.dueInDays === undefined || action.dueInDays === null || action.dueInDays === '') ? undefined : action.dueInDays,
            automationRuleId: rule.id
        });

        console.log(`🤖 Automation "${rule.name}" applied SOP "${sop.name}" (${createdTasks.length} tasks) for ${client.meta?.name || client.id}`);
        return;
    }

    if (action.type !== 'create_task') return;

    const fill = (str) => String(str || '')
        .replace(/\{resourceName\}/g, ctx.resourceName || '')
        .replace(/\{taskTitle\}/g, ctx.title || '')
        .replace(/\{clientName\}/g, client.meta?.name || '')
        .replace(/\{eventTitle\}/g, ctx.eventTitle || '');

    let dueDate = '';
    if (action.dueInDays !== undefined && action.dueInDays !== null && action.dueInDays !== '') {
        const d = new Date();
        d.setDate(d.getDate() + Number(action.dueInDays));
        dueDate = d.toISOString().slice(0, 10);
    }

    const assignee = action.assignee || 'Sphynx Task';
    const title = fill(action.titleTemplate) || 'Automated Task';
    const loggedHours = (action.logDurationAsHours && typeof ctx.durationHours === 'number') ? ctx.durationHours : 0;

    const newTask = {
        id: uid(),
        title,
        name: title,
        status: action.status || 'Pending Sphynx Action',
        assignee,
        dueDate,
        isClientTask: (assignee !== 'Sphynx Task' && !(OL.thirdPartyAssignees || []).includes(assignee)),
        loggedHours,
        parentTaskId: (action.asSubtask && ctx.task) ? ctx.task.id : null,
        createdBy: 'automation',
        automationRuleId: rule.id,
        createdAt: new Date().toISOString()
    };

    client.projectData.clientTasks.unshift(newTask);
    console.log(`🤖 Automation "${rule.name}" created task "${title}" for ${client.meta?.name || client.id}`);
};

// ---- BUILDER UI ----
OL.renderAutomationBuilder = function() {
    const main = document.getElementById("mainContent");
    if (!main) return;

    const rules = state.master.automationRules || [];

    main.innerHTML = `
        <div class="section-header" style="display:flex; justify-content:space-between; align-items:center;">
            <div>
                <h2><i data-lucide="zap" style="width:22px;height:22px;vertical-align:sub;margin-right:8px;color:var(--accent);"></i>Automation Rules</h2>
                <div class="small muted">When something happens, automatically create a follow-up task.</div>
            </div>
            <button class="btn small primary" onclick="OL.openAutomationRuleModal()" style="display:flex; align-items:center; gap:6px;">
                <i data-lucide="plus" style="width:14px;height:14px;"></i> New Rule
            </button>
        </div>

        <div style="display:flex; flex-direction:column; gap:10px; margin-top:16px;">
            ${rules.length === 0 ? `
                <div class="card" style="padding:24px; text-align:center;">
                    <p class="muted small">No automation rules yet. Click "New Rule" to create one — e.g. "When a scoping item is set to Do Now + Sphynx, create an Implementation task."</p>
                </div>
            ` : rules.map(rule => `
                <div class="card" style="padding:14px 16px; display:flex; justify-content:space-between; align-items:center; gap:12px;">
                    <div style="flex:1; min-width:0;">
                        <div style="display:flex; align-items:center; gap:8px;">
                            <span class="pill tiny ${rule.enabled ? 'accent' : 'soft'}">${rule.enabled ? 'ON' : 'OFF'}</span>
                            <strong style="font-size:13px;">${esc(rule.name || 'Untitled Rule')}</strong>
                        </div>
                        <div class="tiny muted" style="margin-top:4px;">
                            When <b>${rule.trigger === 'scoping_status_change' ? 'a scoping item changes' : (rule.trigger === 'calendar_event_synced' ? 'a calendar event syncs' : 'a task status changes')}</b>
                            ${(rule.conditions || []).length ? ' and ' + rule.conditions.map(c => `<code>${esc(c.field)} ${c.op === 'not_equals' ? '≠' : (c.op === 'contains' ? 'contains' : '=')} ${esc(c.value)}</code>`).join(' and ') : ''}
                            → ${rule.action?.type === 'apply_blueprint'
                                ? `apply blueprint <code>${esc((state.master.taskBlueprints || []).find(b => b.id === rule.action.blueprintId)?.title || '(deleted blueprint)')}</code>`
                                : rule.action?.type === 'apply_sop'
                                    ? `apply SOP <code>${esc((state.master.sops || []).find(s => s.id === rule.action.sopId)?.name || '(deleted SOP)')}</code>`
                                    : `create task <code>${esc(rule.action?.titleTemplate || '')}</code>`}
                            ${rule.action?.asSubtask ? ' <span class="tiny">(as sub-task)</span>' : ''}
                        </div>
                    </div>
                    <div style="display:flex; gap:6px; flex-shrink:0;">
                        <button class="btn tiny soft" onclick="OL.toggleAutomationRule('${rule.id}')">${rule.enabled ? 'Disable' : 'Enable'}</button>
                        <button class="btn tiny soft" onclick="OL.openAutomationRuleModal('${rule.id}')">Edit</button>
                        <button class="btn tiny" style="background:#ef4444;color:white;" onclick="OL.deleteAutomationRule('${rule.id}')">Delete</button>
                    </div>
                </div>
            `).join('')}
        </div>
    `;
    if (window.lucide) lucide.createIcons();
};

OL.openAutomationRuleModal = function(ruleId) {
    const rules = state.master.automationRules || [];
    const rule = ruleId ? rules.find(r => r.id === ruleId) : null;

    const trigger = rule?.trigger || 'task_status_change';
    const conditions = rule?.conditions || [];
    const action = rule?.action || { type: 'create_task', titleTemplate: '', assignee: 'Sphynx Task', status: 'Pending Sphynx Action', dueInDays: '', asSubtask: false };

    const fieldOptions = (selectedField, trig) => OL.getAutomationConditionFields(trig).map(f =>
        `<option value="${f.key}" ${selectedField === f.key ? 'selected' : ''}>${f.label}</option>`
    ).join('');

    const conditionRowHtml = (c = { field: '', op: 'equals', value: '' }, idx) => `
        <div class="automation-condition-row" data-idx="${idx}" style="display:grid; grid-template-columns: 1fr 90px 1fr auto; gap:6px; margin-bottom:6px; align-items:center;">
            <select class="modal-input tiny cond-field" onchange="OL.onAutomationConditionFieldChange(this)">${fieldOptions(c.field, trigger)}</select>
            <select class="modal-input tiny cond-op">
                <option value="equals" ${(!c.op || c.op === 'equals') ? 'selected' : ''}>is</option>
                <option value="not_equals" ${c.op === 'not_equals' ? 'selected' : ''}>is not</option>
                <option value="contains" ${c.op === 'contains' ? 'selected' : ''}>contains</option>
            </select>
            <span class="cond-value-cell">${OL.renderAutomationConditionValueControl(c.field, c.value)}</span>
            <button type="button" class="btn tiny soft" onclick="this.closest('.automation-condition-row').remove()">✕</button>
        </div>
    `;

    const html = `
        <div class="modal-head">
            <div class="modal-title-text">${rule ? 'Edit' : 'New'} Automation Rule</div>
            <div class="spacer"></div>
            <button class="btn small soft" onclick="OL.closeModal()">Close</button>
        </div>
        <div class="modal-body">
            <label class="modal-section-label">Rule Name</label>
            <input type="text" id="auto-rule-name" class="modal-input" value="${esc(rule?.name || '')}" placeholder="e.g. Kick off implementation on Do Now + Sphynx">

            <label class="modal-section-label">Trigger</label>
            <select id="auto-rule-trigger" class="modal-input" onchange="OL.refreshAutomationConditionFields()">
                <option value="task_status_change" ${trigger === 'task_status_change' ? 'selected' : ''}>Task status changes</option>
                <option value="scoping_status_change" ${trigger === 'scoping_status_change' ? 'selected' : ''}>Scoping line item status/party changes</option>
                <option value="calendar_event_synced" ${trigger === 'calendar_event_synced' ? 'selected' : ''}>Calendar event syncs</option>
            </select>

            <label class="modal-section-label">Conditions (all must match)</label>
            <div id="auto-rule-conditions">
                ${conditions.length ? conditions.map((c, i) => conditionRowHtml(c, i)).join('') : conditionRowHtml(undefined, 0)}
            </div>
            <button type="button" class="btn tiny soft" onclick="OL.addAutomationConditionRow()">+ Add Condition</button>

            <label class="modal-section-label" style="margin-top:16px;">Action</label>
            <div class="card-section">
                <label class="tiny muted uppercase bold">Action Type</label>
                <select id="auto-action-type" class="modal-input tiny" style="margin-bottom:10px;" onchange="OL.refreshAutomationActionFields()">
                    <option value="create_task" ${!action.type || action.type === 'create_task' ? 'selected' : ''}>Create a freeform task</option>
                    <option value="apply_blueprint" ${action.type === 'apply_blueprint' ? 'selected' : ''}>Apply a Master Task blueprint</option>
                    <option value="apply_sop" ${action.type === 'apply_sop' ? 'selected' : ''}>Apply an SOP (multiple blueprints)</option>
                </select>

                <div id="auto-action-freeform" style="${action.type === 'apply_blueprint' ? 'display:none;' : ''}">
                    <label class="tiny muted uppercase bold">Title (use {resourceName}, {taskTitle}, {clientName}, {eventTitle})</label>
                    <input type="text" id="auto-action-title" class="modal-input tiny" value="${esc(action.titleTemplate || '')}" placeholder="Implementation: {resourceName}" style="margin-bottom:8px;">

                    <div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap:8px;">
                        <div>
                            <label class="tiny muted uppercase bold">Assignee</label>
                            <select id="auto-action-assignee" class="modal-input tiny">
                                <option value="Sphynx Task" ${(!action.assignee || action.assignee === 'Sphynx Task') ? 'selected' : ''}>Sphynx Task</option>
                                <option value="Client Task" ${action.assignee === 'Client Task' ? 'selected' : ''}>Client Task</option>
                                ${(state.master?.sphynxTeam || []).length ? `
                                    <optgroup label="Sphynx Team">
                                        ${state.master.sphynxTeam.map(m => `<option value="${esc(m.name)}" ${action.assignee === m.name ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}
                                    </optgroup>
                                ` : ''}
                                <optgroup label="Vendors / 3rd Party">
                                    ${(OL.thirdPartyAssignees || []).map(tp => `<option value="${esc(tp)}" ${action.assignee === tp ? 'selected' : ''}>${esc(tp)}</option>`).join('')}
                                </optgroup>
                            </select>
                        </div>
                        <div>
                            <label class="tiny muted uppercase bold">Status</label>
                            <select id="auto-action-status" class="modal-input tiny">
                                ${(OL.getSystemStatuses ? OL.getSystemStatuses() : []).map(s => `<option value="${esc(s.name)}" ${(action.status === s.name || (!action.status && s.name === 'Pending Sphynx Action')) ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
                            </select>
                        </div>
                        <div>
                            <label class="tiny muted uppercase bold">Due In (days)</label>
                            <input type="number" id="auto-action-due" class="modal-input tiny" value="${esc(action.dueInDays ?? '')}" placeholder="e.g. 3">
                        </div>
                    </div>

                    <label style="display:flex; align-items:center; gap:8px; font-size:11px; margin-top:10px; cursor:pointer;">
                        <input type="checkbox" id="auto-action-log-duration" ${action.logDurationAsHours ? 'checked' : ''}>
                        Log the calendar event's duration as time worked on this task (syncs to the client's timesheet — calendar triggers only)
                    </label>
                </div>

                <div id="auto-action-blueprint" style="${action.type === 'apply_blueprint' ? '' : 'display:none;'}">
                    <label class="tiny muted uppercase bold">Blueprint</label>
                    <select id="auto-action-blueprint-id" class="modal-input tiny" style="margin-bottom:8px;">
                        <option value="">Select a Master Task blueprint...</option>
                        ${(state.master.taskBlueprints || []).map(bp => `<option value="${bp.id}" ${action.blueprintId === bp.id ? 'selected' : ''}>${esc(bp.title)}</option>`).join('')}
                    </select>
                    <label class="tiny muted uppercase bold">Due In (days) — leave blank to use the blueprint's own default</label>
                    <input type="number" id="auto-action-blueprint-due" class="modal-input tiny" value="${esc(action.type === 'apply_blueprint' ? (action.dueInDays ?? '') : '')}" placeholder="optional override">
                </div>

                <div id="auto-action-sop" style="${action.type === 'apply_sop' ? '' : 'display:none;'}">
                    <label class="tiny muted uppercase bold">SOP</label>
                    <select id="auto-action-sop-id" class="modal-input tiny" style="margin-bottom:8px;">
                        <option value="">Select an SOP...</option>
                        ${(state.master.sops || []).map(sop => `<option value="${sop.id}" ${action.sopId === sop.id ? 'selected' : ''}>${esc(sop.name)} (${(sop.blueprintIds || []).length} tasks)</option>`).join('')}
                    </select>
                    <label class="tiny muted uppercase bold">Due In (days) override — applies to every task in the SOP; leave blank to use each blueprint's own default</label>
                    <input type="number" id="auto-action-sop-due" class="modal-input tiny" value="${esc(action.type === 'apply_sop' ? (action.dueInDays ?? '') : '')}" placeholder="optional override">
                </div>

                <label style="display:flex; align-items:center; gap:8px; font-size:11px; margin-top:10px; cursor:pointer;">
                    <input type="checkbox" id="auto-action-subtask" ${action.asSubtask ? 'checked' : ''}>
                    Create as a sub-task nested under the task that triggered this rule (task triggers only)
                </label>
            </div>

            <label style="display:flex; align-items:center; gap:8px; font-size:12px; margin-top:14px; cursor:pointer;">
                <input type="checkbox" id="auto-rule-enabled" ${rule?.enabled !== false ? 'checked' : ''}>
                Rule enabled
            </label>

            <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:20px;">
                <button class="btn soft" onclick="OL.closeModal()">Cancel</button>
                <button class="btn primary" onclick="OL.saveAutomationRule('${rule?.id || ''}')">Save Rule</button>
            </div>
        </div>
    `;
    openModal(html);
    window._automationRuleTrigger = trigger;
};

OL.addAutomationConditionRow = function() {
    const container = document.getElementById('auto-rule-conditions');
    if (!container) return;
    const idx = container.children.length;
    const trigger = document.getElementById('auto-rule-trigger')?.value || 'task_status_change';
    const wrapper = document.createElement('div');
    wrapper.innerHTML = `
        <div class="automation-condition-row" data-idx="${idx}" style="display:grid; grid-template-columns: 1fr 90px 1fr auto; gap:6px; margin-bottom:6px; align-items:center;">
            <select class="modal-input tiny cond-field" onchange="OL.onAutomationConditionFieldChange(this)">${OL.getAutomationConditionFields(trigger).map(f => `<option value="${f.key}">${f.label}</option>`).join('')}</select>
            <select class="modal-input tiny cond-op">
                <option value="equals">is</option>
                <option value="not_equals">is not</option>
                <option value="contains">contains</option>
            </select>
            <span class="cond-value-cell">${OL.renderAutomationConditionValueControl('', '')}</span>
            <button type="button" class="btn tiny soft" onclick="this.closest('.automation-condition-row').remove()">✕</button>
        </div>
    `;
    container.appendChild(wrapper.firstElementChild);
};

OL.refreshAutomationConditionFields = function() {
    const trigger = document.getElementById('auto-rule-trigger')?.value || 'task_status_change';
    document.querySelectorAll('#auto-rule-conditions .automation-condition-row').forEach(row => {
        const sel = row.querySelector('.cond-field');
        if (!sel) return;
        const current = sel.value;
        sel.innerHTML = OL.getAutomationConditionFields(trigger).map(f => `<option value="${f.key}">${f.label}</option>`).join('');
        sel.value = current; // keep selection if the new trigger happens to share that field name
        OL.onAutomationConditionFieldChange(sel); // field set may differ per trigger — refresh the value control too
    });
};

OL.refreshAutomationActionFields = function() {
    const type = document.getElementById('auto-action-type')?.value || 'create_task';
    const freeformEl = document.getElementById('auto-action-freeform');
    const blueprintEl = document.getElementById('auto-action-blueprint');
    const sopEl = document.getElementById('auto-action-sop');
    if (freeformEl) freeformEl.style.display = type === 'create_task' ? '' : 'none';
    if (blueprintEl) blueprintEl.style.display = type === 'apply_blueprint' ? '' : 'none';
    if (sopEl) sopEl.style.display = type === 'apply_sop' ? '' : 'none';
};

OL.saveAutomationRule = function(ruleId) {
    const name = document.getElementById('auto-rule-name')?.value?.trim();
    const trigger = document.getElementById('auto-rule-trigger')?.value || 'task_status_change';
    const enabled = document.getElementById('auto-rule-enabled')?.checked !== false;

    if (!name) { alert('Give the rule a name first.'); return; }

    const conditions = Array.from(document.querySelectorAll('#auto-rule-conditions .automation-condition-row')).map(row => ({
        field: row.querySelector('.cond-field')?.value,
        op: row.querySelector('.cond-op')?.value || 'equals',
        value: row.querySelector('.cond-value')?.value || ''
    })).filter(c => c.field);

    const actionType = document.getElementById('auto-action-type')?.value || 'create_task';
    const asSubtask = !!document.getElementById('auto-action-subtask')?.checked;

    let action;
    if (actionType === 'apply_blueprint') {
        const blueprintId = document.getElementById('auto-action-blueprint-id')?.value || '';
        if (!blueprintId) { alert('Pick a Master Task blueprint for this action.'); return; }
        const dueRaw = document.getElementById('auto-action-blueprint-due')?.value;
        action = {
            type: 'apply_blueprint',
            blueprintId,
            dueInDays: dueRaw === '' || dueRaw === undefined ? null : Number(dueRaw),
            asSubtask
        };
    } else if (actionType === 'apply_sop') {
        const sopId = document.getElementById('auto-action-sop-id')?.value || '';
        if (!sopId) { alert('Pick an SOP for this action.'); return; }
        const dueRaw = document.getElementById('auto-action-sop-due')?.value;
        action = {
            type: 'apply_sop',
            sopId,
            dueInDays: dueRaw === '' || dueRaw === undefined ? null : Number(dueRaw),
            asSubtask
        };
    } else {
        action = {
            type: 'create_task',
            titleTemplate: document.getElementById('auto-action-title')?.value || '',
            assignee: document.getElementById('auto-action-assignee')?.value || 'Sphynx Task',
            status: document.getElementById('auto-action-status')?.value || 'Pending Sphynx Action',
            dueInDays: document.getElementById('auto-action-due')?.value === '' ? null : Number(document.getElementById('auto-action-due')?.value),
            asSubtask,
            logDurationAsHours: !!document.getElementById('auto-action-log-duration')?.checked
        };
    }

    updateAndSync(() => {
        if (!state.master.automationRules) state.master.automationRules = [];
        if (ruleId) {
            const existing = state.master.automationRules.find(r => r.id === ruleId);
            if (existing) {
                Object.assign(existing, { name, trigger, conditions, action, enabled });
            }
        } else {
            state.master.automationRules.push({
                id: uid(),
                name, trigger, conditions, action, enabled,
                createdAt: new Date().toISOString()
            });
        }
    });

    OL.closeModal();
    OL.renderAutomationBuilder();
};

OL.toggleAutomationRule = function(ruleId) {
    updateAndSync(() => {
        const rule = (state.master.automationRules || []).find(r => r.id === ruleId);
        if (rule) rule.enabled = !rule.enabled;
    });
    OL.renderAutomationBuilder();
};

OL.deleteAutomationRule = function(ruleId) {
    if (!confirm('Delete this automation rule? Tasks it already created will stay in place.')) return;
    updateAndSync(() => {
        state.master.automationRules = (state.master.automationRules || []).filter(r => r.id !== ruleId);
    });
    OL.renderAutomationBuilder();
};

// ---- bridge: keep OL.* calls working until callers import directly ----
window.OL = window.OL || {};
Object.assign(window.OL, {
    getAutomationConditionFields: OL.getAutomationConditionFields,
    runAutomationRules: OL.runAutomationRules,
    executeAutomationAction: OL.executeAutomationAction,
    renderAutomationBuilder: OL.renderAutomationBuilder,
    openAutomationRuleModal: OL.openAutomationRuleModal,
    addAutomationConditionRow: OL.addAutomationConditionRow,
    refreshAutomationConditionFields: OL.refreshAutomationConditionFields,
    saveAutomationRule: OL.saveAutomationRule,
    toggleAutomationRule: OL.toggleAutomationRule,
    deleteAutomationRule: OL.deleteAutomationRule
});
