//======================= FEATURES / FIELD TYPE MANAGER =======================//
// Lets you program which fields show up on a resource type — instead of the
// fixed set that's hardcoded into openResourceModal. New custom fields
// render in their own section there (see the "Custom Fields" block wired
// into features/resources-modal.js), separate from the existing hardcoded
// sections so nothing already working is touched.
//
// OL.openTypeDetailModal / OL.openResourceTypeManager were referenced from
// the Scoping Variable Library screen (the "⚙️ Types" button, and clicking
// a type card) but were never actually implemented — this fills that gap,
// scoped to custom-field management. Rate-variable management for a type
// (the other half of what that screen implied) isn't rebuilt here.

import { state, esc, uid } from '../core/data.js';
import { FIELD_TYPES, CONDITION_OPS, newFieldId, renderConditionEditor } from '../core/field-schema.js';

OL.openResourceTypeManager = function() {
    const registry = state.master.resourceTypes || [];
    const html = `
        <div class="modal-head">
            <div class="modal-title-text">⚙️ Resource Types</div>
            <div class="spacer"></div>
            <button class="btn small soft" onclick="OL.closeModal()">Close</button>
        </div>
        <div class="modal-body">
            <p class="tiny muted" style="margin-bottom:12px;">Pick a type to manage its custom fields.</p>
            <div style="display:grid; gap:6px;">
                ${registry.map(t => `
                    <div class="tiny" style="display:flex; justify-content:space-between; align-items:center; padding:8px 10px; border:1px solid var(--line); border-radius:6px; cursor:pointer;" onclick="OL.openTypeDetailModal('${esc(t.type)}')">
                        <span>📁 ${esc(t.type)}</span>
                        <span class="pill tiny soft">${(t.customFields || []).length} custom field${(t.customFields || []).length === 1 ? '' : 's'}</span>
                    </div>
                `).join('') || `<div class="tiny muted">No resource types yet.</div>`}
            </div>
        </div>
    `;
    openModal(html);
};

OL.openTypeDetailModal = function(typeName) {
    const typeDef = (state.master.resourceTypes || []).find(t => t.type === typeName);
    if (!typeDef) return;
    if (!typeDef.customFields) typeDef.customFields = [];

    const fields = typeDef.customFields;

    const html = `
        <div class="modal-head">
            <div class="modal-title-text">📁 ${esc(typeName)} — Custom Fields</div>
            <div class="spacer"></div>
            <button class="btn small soft" onclick="OL.closeModal()">Close</button>
        </div>
        <div class="modal-body" style="max-width:640px; width:100%;">
            <p class="tiny muted" style="margin-bottom:12px;">These render in a "Custom Fields" section on every resource of this type. Order here is the order they show in.</p>

            <div id="type-fields-list" style="display:flex; flex-direction:column; gap:10px; margin-bottom:16px;">
                ${OL._renderTypeFieldsList(typeName)}
            </div>

            <div style="display:flex; gap:6px; align-items:center;">
                <select id="new-field-type-picker" class="modal-input tiny" style="flex:1;">
                    ${Object.entries(FIELD_TYPES).map(([key, def]) => `<option value="${key}">${esc(def.label)}</option>`).join('')}
                </select>
                <button class="btn tiny primary" onclick="OL.addCustomFieldToType('${esc(typeName)}', document.getElementById('new-field-type-picker').value)">
                    <i data-lucide="plus" style="width:12px;height:12px;"></i> Add Field
                </button>
            </div>
        </div>
    `;
    openModal(html);
    if (window.lucide) window.lucide.createIcons();
};

OL._renderTypeFieldsList = function(typeName) {
    const typeDef = (state.master.resourceTypes || []).find(t => t.type === typeName);
    const fields = typeDef?.customFields || [];

    if (!fields.length) return `<div class="tiny muted" style="padding:10px; text-align:center; border:1px dashed var(--line); border-radius:6px;">No custom fields yet — add one below.</div>`;

    return fields.map((f, idx) => {
        const otherFields = fields.filter(other => other.id !== f.id);
        const typeMeta = FIELD_TYPES[f.type] || { label: f.type, icon: 'circle' };
        const configHtml = OL._renderFieldConfigEditor(typeName, f);

        return `
            <div style="border:1px solid var(--line); border-radius:8px; padding:10px 12px; background:rgba(255,255,255,0.02);">
                <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
                    <i data-lucide="${typeMeta.icon}" style="width:13px;height:13px;color:var(--accent);flex-shrink:0;"></i>
                    <input type="text" class="modal-input tiny" style="flex:1;" placeholder="Field label..." value="${esc(f.label || '')}"
                           onblur="OL.updateCustomFieldMeta('${esc(typeName)}', '${f.id}', 'label', this.value)">
                    <span class="pill tiny soft" style="flex-shrink:0;">${esc(typeMeta.label)}</span>
                    <div style="display:flex; gap:2px; flex-shrink:0;">
                        <button class="btn tiny soft" title="Move up" ${idx === 0 ? 'disabled' : ''} onclick="OL.moveCustomField('${esc(typeName)}', '${f.id}', -1)"><i data-lucide="chevron-up" style="width:11px;height:11px;pointer-events:none;"></i></button>
                        <button class="btn tiny soft" title="Move down" ${idx === fields.length - 1 ? 'disabled' : ''} onclick="OL.moveCustomField('${esc(typeName)}', '${f.id}', 1)"><i data-lucide="chevron-down" style="width:11px;height:11px;pointer-events:none;"></i></button>
                        <button class="btn tiny soft" title="Remove" onclick="OL.removeCustomFieldFromType('${esc(typeName)}', '${f.id}')"><i data-lucide="x" style="width:11px;height:11px;pointer-events:none;"></i></button>
                    </div>
                </div>
                ${configHtml}
                ${otherFields.length ? renderConditionEditor(
                    f.condition,
                    otherFields,
                    `OL.updateCustomFieldCondition('${esc(typeName)}', '${f.id}', __PART__)`
                ) : ''}
            </div>
        `;
    }).join('');
};

// Type-specific admin config: radio/checklist need an editable options list;
// other types have nothing extra to configure beyond the label.
OL._renderFieldConfigEditor = function(typeName, field) {
    if (field.type === 'radio' || field.type === 'checklist') {
        const items = field.config?.options || field.config?.items || [];
        const configKey = field.type === 'radio' ? 'options' : 'items';
        return `
            <div style="margin-bottom:8px;">
                <label class="tiny muted" style="display:block; margin-bottom:4px;">${field.type === 'radio' ? 'Options' : 'Checklist items'} (one per line)</label>
                <textarea class="modal-input tiny" rows="3" style="width:100%; box-sizing:border-box;"
                          onblur="OL.updateCustomFieldConfigList('${esc(typeName)}', '${field.id}', '${configKey}', this.value)">${esc(items.join('\n'))}</textarea>
            </div>
        `;
    }
    if (field.type === 'short_text' || field.type === 'textarea') {
        return `
            <div style="margin-bottom:8px;">
                <input type="text" class="modal-input tiny" placeholder="Placeholder text (optional)" value="${esc(field.config?.placeholder || '')}"
                       onblur="OL.updateCustomFieldConfig('${esc(typeName)}', '${field.id}', 'placeholder', this.value)">
            </div>
        `;
    }
    return ''; // linked_* and flow_map_preview have nothing to configure here
};

OL.addCustomFieldToType = function(typeName, fieldType) {
    const typeDef = (state.master.resourceTypes || []).find(t => t.type === typeName);
    if (!typeDef) return;
    if (!typeDef.customFields) typeDef.customFields = [];

    typeDef.customFields.push({
        id: newFieldId(),
        type: fieldType,
        label: FIELD_TYPES[fieldType]?.label || fieldType,
        config: {},
        condition: null
    });

    OL.persist();
    OL._refreshTypeFieldsList(typeName);
};

OL.removeCustomFieldFromType = function(typeName, fieldId) {
    const typeDef = (state.master.resourceTypes || []).find(t => t.type === typeName);
    if (!typeDef) return;
    typeDef.customFields = (typeDef.customFields || []).filter(f => f.id !== fieldId);
    // A removed field can't be a condition source anymore — clear any other
    // field's condition that pointed at it, so nothing silently references
    // a field that no longer exists.
    (typeDef.customFields || []).forEach(f => { if (f.condition?.fieldId === fieldId) f.condition = null; });

    OL.persist();
    OL._refreshTypeFieldsList(typeName);
};

OL.moveCustomField = function(typeName, fieldId, direction) {
    const typeDef = (state.master.resourceTypes || []).find(t => t.type === typeName);
    if (!typeDef?.customFields) return;
    const idx = typeDef.customFields.findIndex(f => f.id === fieldId);
    const newIdx = idx + direction;
    if (idx === -1 || newIdx < 0 || newIdx >= typeDef.customFields.length) return;
    const [moved] = typeDef.customFields.splice(idx, 1);
    typeDef.customFields.splice(newIdx, 0, moved);

    OL.persist();
    OL._refreshTypeFieldsList(typeName);
};

OL.updateCustomFieldMeta = function(typeName, fieldId, key, value) {
    const typeDef = (state.master.resourceTypes || []).find(t => t.type === typeName);
    const field = typeDef?.customFields?.find(f => f.id === fieldId);
    if (!field) return;
    field[key] = value;
    OL.persist();
};

OL.updateCustomFieldConfig = function(typeName, fieldId, key, value) {
    const typeDef = (state.master.resourceTypes || []).find(t => t.type === typeName);
    const field = typeDef?.customFields?.find(f => f.id === fieldId);
    if (!field) return;
    if (!field.config) field.config = {};
    field.config[key] = value;
    OL.persist();
};

OL.updateCustomFieldConfigList = function(typeName, fieldId, key, rawText) {
    const list = (rawText || '').split('\n').map(s => s.trim()).filter(Boolean);
    OL.updateCustomFieldConfig(typeName, fieldId, key, list);
    OL._refreshTypeFieldsList(typeName); // so linked radio/checklist inputs elsewhere reflect the new list immediately
};

OL.updateCustomFieldCondition = function(typeName, fieldId, part, value) {
    const typeDef = (state.master.resourceTypes || []).find(t => t.type === typeName);
    const field = typeDef?.customFields?.find(f => f.id === fieldId);
    if (!field) return;
    if (!field.condition) field.condition = { fieldId: '', op: 'equals', value: '' };
    field.condition[part] = value;
    if (part === 'fieldId' && !value) field.condition = null; // "(always show)" clears the whole condition

    OL.persist();
    OL._refreshTypeFieldsList(typeName);
};

OL._refreshTypeFieldsList = function(typeName) {
    const container = document.getElementById('type-fields-list');
    if (!container) return;
    container.innerHTML = OL._renderTypeFieldsList(typeName);
    if (window.lucide) window.lucide.createIcons();
};

window.OL = window.OL || {};
Object.assign(window.OL, {
    openResourceTypeManager: OL.openResourceTypeManager,
    openTypeDetailModal: OL.openTypeDetailModal,
    addCustomFieldToType: OL.addCustomFieldToType,
    removeCustomFieldFromType: OL.removeCustomFieldFromType,
    moveCustomField: OL.moveCustomField,
    updateCustomFieldMeta: OL.updateCustomFieldMeta,
    updateCustomFieldConfig: OL.updateCustomFieldConfig,
    updateCustomFieldConfigList: OL.updateCustomFieldConfigList,
    updateCustomFieldCondition: OL.updateCustomFieldCondition
});
