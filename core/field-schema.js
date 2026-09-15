//======================= CORE / FIELD SCHEMA =======================//
// Global, object-type-agnostic building blocks for "programmable fields":
// a registry of field types, generic render/read helpers for them, and a
// conditional-logic evaluator. Built for Resources and How-To Guides first,
// but nothing here is specific to either — the whole point is that Forms
// (or anything else) can reuse the same field types and the same
// conditional-logic engine later without duplicating this.
//
// A "field" is just: { id, type, label, config } where config is
// type-specific (e.g. radio options, checklist items). A "condition" is:
// { fieldId, op, value } — evaluated against a plain { [fieldId]: value }
// map, so it works the same whether those values come from a resource's
// custom fields, a how-to guide's blocks, or eventually a form response.

import { esc, uid } from './data.js';

// ---- FIELD TYPE REGISTRY ----
// icon = lucide icon name, shown in the Type Manager's "add a field" picker.
export const FIELD_TYPES = {
    short_text:       { label: 'Short Text',        icon: 'type' },
    textarea:         { label: 'Text Area',          icon: 'align-left' },
    radio:            { label: 'Radio (single choice)', icon: 'circle-dot' },
    checklist:        { label: 'Checklist',          icon: 'check-square' },
    linked_resources: { label: 'Linked Resources',   icon: 'link' },
    linked_howto:     { label: 'Linked How-To Guides', icon: 'book-open' },
    linked_tasks:     { label: 'Linked Tasks',        icon: 'clipboard-list' },
    flow_map_preview: { label: 'Flow Map Preview',    icon: 'git-branch' }
};

export function newFieldId() { return 'fld-' + uid(); }

// ---- CONDITIONAL LOGIC ----
// Supported ops: equals, not_equals, contains (substring/array-includes),
// is_empty, is_not_empty. `values` is { [fieldId]: value }.
export const CONDITION_OPS = {
    equals:        { label: 'is' },
    not_equals:    { label: 'is not' },
    contains:      { label: 'contains' },
    is_empty:      { label: 'is empty' },
    is_not_empty:  { label: 'is not empty' }
};

export function evaluateCondition(condition, values) {
    if (!condition || !condition.fieldId) return true; // no condition set = always show
    const actual = values ? values[condition.fieldId] : undefined;

    switch (condition.op) {
        case 'equals': return String(actual ?? '') === String(condition.value ?? '');
        case 'not_equals': return String(actual ?? '') !== String(condition.value ?? '');
        case 'contains':
            if (Array.isArray(actual)) return actual.map(String).includes(String(condition.value ?? ''));
            return String(actual ?? '').toLowerCase().includes(String(condition.value ?? '').toLowerCase());
        case 'is_empty':
            return actual === undefined || actual === null || actual === '' || (Array.isArray(actual) && actual.length === 0);
        case 'is_not_empty':
            return !(actual === undefined || actual === null || actual === '' || (Array.isArray(actual) && actual.length === 0));
        default: return true;
    }
}

// Renders a small inline editor for a condition, scoped to a set of
// "possible source fields" (usually every OTHER field on the same object,
// so a field can't condition on itself). onChangeAttr is the JS expression
// string to run on change — caller wires it to whatever saves the condition
// back onto the object it belongs to (a resource's custom field def, a
// how-to block, etc.) since that storage differs per object type.
export function renderConditionEditor(condition, possibleFields, onChangeExpr) {
    const c = condition || {};
    return `
        <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center; padding:8px; background:rgba(255,255,255,0.02); border:1px solid var(--line); border-radius:6px;">
            <span class="tiny muted">Show only if</span>
            <select class="modal-input tiny" style="width:auto;" onchange="${onChangeExpr.replace(/__PART__/g, "'fieldId', this.value")}">
                <option value="">(always show)</option>
                ${possibleFields.map(f => `<option value="${f.id}" ${c.fieldId === f.id ? 'selected' : ''}>${esc(f.label || f.id)}</option>`).join('')}
            </select>
            ${c.fieldId ? `
                <select class="modal-input tiny" style="width:auto;" onchange="${onChangeExpr.replace(/__PART__/g, "'op', this.value")}">
                    ${Object.entries(CONDITION_OPS).map(([op, def]) => `<option value="${op}" ${c.op === op ? 'selected' : ''}>${esc(def.label)}</option>`).join('')}
                </select>
                ${(c.op === 'equals' || c.op === 'not_equals' || c.op === 'contains') ? `
                    <input type="text" class="modal-input tiny" style="width:120px;" placeholder="value" value="${esc(c.value || '')}"
                           onblur="${onChangeExpr.replace(/__PART__/g, "'value', this.value")}">
                ` : ''}
            ` : ''}
        </div>
    `;
}

// ---- GENERIC FIELD EDITOR RENDER ----
// Renders the INPUT for a field (for filling it out), not its config/admin
// form (the Type Manager renders that separately — see field-type-manager.js).
// saveExpr is a JS expression string with __VALUE__ where the new value goes;
// caller supplies it since where/how a value gets saved differs per object
// (a resource's fieldValues map vs. a how-to block's data, etc.)
export function renderFieldInput(field, value, saveExpr) {
    const v = value ?? (field.type === 'checklist' || field.type === 'linked_resources' || field.type === 'linked_howto' || field.type === 'linked_tasks' ? [] : '');

    switch (field.type) {
        case 'short_text':
            return `<input type="text" class="modal-input tiny" value="${esc(v)}" placeholder="${esc(field.config?.placeholder || '')}"
                           onblur="${saveExpr.replace('__VALUE__', 'this.value')}">`;

        case 'textarea':
            return `<textarea class="modal-input tiny" rows="3" style="width:100%; box-sizing:border-box;" placeholder="${esc(field.config?.placeholder || '')}"
                              onblur="${saveExpr.replace('__VALUE__', 'this.value')}">${esc(v)}</textarea>`;

        case 'radio':
            return `<div style="display:flex; flex-direction:column; gap:6px;">
                ${(field.config?.options || []).map(opt => `
                    <label style="display:flex; align-items:center; gap:6px; font-size:12px; cursor:pointer;">
                        <input type="radio" name="field-${field.id}" value="${esc(opt)}" ${v === opt ? 'checked' : ''}
                               onchange="${saveExpr.replace('__VALUE__', `'${esc(opt).replace(/'/g, "\\'")}'`)}">
                        ${esc(opt)}
                    </label>
                `).join('') || '<div class="tiny muted">No options configured for this field yet.</div>'}
            </div>`;

        case 'checklist': {
            const checked = new Set(Array.isArray(v) ? v : []);
            return `<div style="display:flex; flex-direction:column; gap:6px;">
                ${(field.config?.items || []).map(item => `
                    <label style="display:flex; align-items:center; gap:6px; font-size:12px; cursor:pointer;">
                        <input type="checkbox" ${checked.has(item) ? 'checked' : ''}
                               onchange="${saveExpr.replace('__VALUE__', `OL._toggleFieldChecklistItem(${esc(JSON.stringify([...checked]))}, ${esc(JSON.stringify(item))}, this.checked)`)}">
                        ${esc(item)}
                    </label>
                `).join('') || '<div class="tiny muted">No checklist items configured for this field yet.</div>'}
            </div>`;
        }

        // linked_resources / linked_howto / linked_tasks: these render a
        // summary of currently-linked items plus a note that the actual
        // link/unlink search UI is wired per object type (the same pattern
        // resources-modal.js and how-to.js already use for their own
        // built-in linking — see OL.toggleHTResource / filterTaskHowToSearch
        // for the reference implementation this is meant to reuse).
        case 'linked_resources':
        case 'linked_howto':
        case 'linked_tasks':
            return `<div class="tiny muted">${(Array.isArray(v) ? v.length : 0)} linked — managed via the search box below.</div>`;

        case 'flow_map_preview':
            return `<div class="tiny muted" style="padding:10px; border:1px dashed var(--line); border-radius:6px; text-align:center;">Flow map preview — coming soon.</div>`;

        default:
            return `<div class="tiny muted">Unknown field type: ${esc(field.type)}</div>`;
    }
}

OL._toggleFieldChecklistItem = function(currentArr, item, isChecked) {
    const set = new Set(currentArr);
    if (isChecked) set.add(item); else set.delete(item);
    return [...set];
};

window.OL = window.OL || {};
Object.assign(window.OL, { _toggleFieldChecklistItem: OL._toggleFieldChecklistItem });
