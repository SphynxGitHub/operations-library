//======================= FEATURES / FLOW VISUALIZER / WORKFLOWS =======================//
// Extracted from the "INFINITE GRID (V2 CONSOLIDATED)" section — the
// workflow and stage CRUD layer underneath the flow-map canvas. Rendering,
// drag/drop, connections, and the inspector panel are separate modules
// (not yet extracted) that call into these functions via the OL bridge.

import { state, getActiveClient, persist } from '../../core/data.js';

// ---- workflow CRUD ----

export function getWorkflows() {
    const data = OL.getCurrentProjectData();
    const isVault = window.location.hash.includes('vault');
    return isVault
        ? (state.master.workflows || [])
        : (data.workflows || []);
}

export function createWorkflow(name, stageId, color) {
    const client = getActiveClient();
    const isVault = window.location.hash.includes('vault');

    const wf = {
        id: 'wf-' + Date.now(),
        name: name || 'New Workflow',
        stageId: stageId || '',
        color: color || '#3dd9c5',
        resourceIds: [],
        description: ''
    };

    if (isVault) {
        if (!state.master.workflows) state.master.workflows = [];
        state.master.workflows.push(wf);
    } else if (client) {
        if (!client.projectData.workflows) client.projectData.workflows = [];
        client.projectData.workflows.push(wf);
    }

    persist();
    return wf;
}

export function renameWorkflow(wfId, name) {
    const wf = getWorkflows().find(w => w.id === wfId);
    if (!wf) return;
    wf.name = name.trim();
    persist();
}

export function deleteWorkflow(wfId) {
    if (!confirm('Delete this workflow? Resources will become unassigned.')) return;
    const data = OL.getCurrentProjectData();
    // Unassign all resources from this workflow
    (data.resources || []).forEach(r => {
        if (r.workflowId === wfId) r.workflowId = null;
    });
    data.workflows = (data.workflows || []).filter(w => w.id !== wfId);
    persist();
    OL.renderVisualizer();
}

export function addResourceToWorkflow(wfId, resId) {
    const data = OL.getCurrentProjectData();
    const wf  = (data.workflows || []).find(w => w.id === wfId);
    const res = (data.resources || []).find(r => String(r.id) === String(resId));
    if (!wf || !res) return;

    if (!wf.resourceIds) wf.resourceIds = [];
    if (!wf.resourceIds.includes(String(resId))) {
        wf.resourceIds.push(String(resId));
    }
    res.workflowId = wfId;
    persist();
}

export function removeResourceFromWorkflow(wfId, resId) {
    const data = OL.getCurrentProjectData();
    const wf = (data.workflows || []).find(w => String(w.id) === String(wfId));
    const res = (data.resources || []).find(r => String(r.id) === String(resId));

    if (!wf) return;

    wf.resourceIds = (wf.resourceIds || []).filter(id => String(id) !== String(resId));

    if (res) {
        const remainingWfs = (data.workflows || []).filter(w =>
            String(w.id) !== String(wfId) && (w.resourceIds || []).includes(String(resId))
        );

        if (remainingWfs.length === 0) {
            res.workflowId = null;
        } else {
            res.workflowId = remainingWfs[0].id;
        }
    }

    persist();
}

export function reorderWorkflowResources(wfId, fromIdx, toIdx) {
    const wf = getWorkflows().find(w => w.id === wfId);
    if (!wf || !wf.resourceIds) return;
    const [moved] = wf.resourceIds.splice(fromIdx, 1);
    wf.resourceIds.splice(toIdx, 0, moved);
    persist();
    OL.renderVisualizer();
}

// ---- UI wrappers (thin, but kept alongside the CRUD they call) ----

export function _fvCreateWorkflow(stageId) {
    const name = prompt('Workflow name:');
    if (!name?.trim()) return;

    const data = OL.getCurrentProjectData();
    console.log('Creating workflow for client:', getActiveClient()?.meta?.name);
    console.log('Current workflows:', data.workflows);
    console.log('stageId:', stageId);

    createWorkflow(name.trim(), stageId);
    OL.renderVisualizer();
}

export function _fvAddResourceToWorkflow(wfId) {
    const data = OL.getCurrentProjectData();
    const workflows = data.workflows || [];
    const wf = workflows.find(w => w.id === wfId);
    if (!wf) return;

    const assignedIds = new Set(workflows.flatMap(w => w.resourceIds || []));
    const available = (data.resources || []).filter(r =>
        r.stageId === wf.stageId && !assignedIds.has(String(r.id))
    );

    if (available.length === 0) {
        alert('No unassigned resources in this stage. Assign a resource to this stage first.');
        return;
    }

    const options = available.map((r, i) => `${i + 1}. ${r.name}`).join('\n');
    const choice = prompt(`Select resource to add:\n\n${options}\n\nEnter number:`);
    if (!choice) return;

    const idx = parseInt(choice) - 1;
    if (idx >= 0 && idx < available.length) {
        addResourceToWorkflow(wfId, available[idx].id);
        OL.renderVisualizer();
    }
}

// ---- stage CRUD ----

export async function insertStage(index) {
    const data = OL.getCurrentProjectData();

    const newStage = {
        id: 'stage-' + Date.now(),
        name: 'New Stage',
        width: 1000 // Legacy support
    };

    data.stages.splice(index, 0, newStage);

    await persist();

    OL.autoAlignNodes();
    console.log(`✨ Inserted new stage at index ${index}`);
}

export async function addStageBetween(index) {
    const name = prompt("Enter Stage Name:", "New Stage");
    if (!name) return;

    const client = getActiveClient();
    const isVault = window.location.hash.startsWith('#/vault');

    await OL.updateAndSync(() => {
        const newStage = {
            id: 'stage-' + Date.now(),
            name: name,
            width: 400
        };

        if (isVault) {
            if (!state.master.stages) state.master.stages = [];
            state.master.stages.splice(index, 0, newStage);
        } else if (client) {
            if (!client.projectData.stages) client.projectData.stages = [];
            client.projectData.stages.splice(index, 0, newStage);
        }
    });

    OL.renderVisualizer();
}

// NOTE: two independent deleteStage implementations existed in the
// original file under different names (_fvDeleteStage and deleteStage) —
// both kept as-is rather than merged, since different call sites use
// each one and reconciling them wasn't part of this extraction.

export function _fvDeleteStage(stageId) {
    const data = OL.getCurrentProjectData();
    const stage = (data.stages||[]).find(s => s.id === stageId);
    if (!stage) return;

    const resCount = (data.resources||[]).filter(r => r.stageId === stageId).length;
    const wfCount  = (data.workflows||[]).filter(w => w.stageId === stageId).length;

    const msg = resCount > 0 || wfCount > 0
        ? `Delete "${stage.name}"? ${resCount} resource(s) and ${wfCount} workflow(s) will become unassigned.`
        : `Delete stage "${stage.name}"?`;

    if (!confirm(msg)) return;

    (data.resources||[]).forEach(r => { if (r.stageId === stageId) r.stageId = null; });
    (data.workflows||[]).forEach(w => { if (w.stageId === stageId) w.stageId = null; });

    data.stages = data.stages.filter(s => s.id !== stageId);

    persist();
    OL.renderVisualizer();
}

export async function deleteStage(stageId) {
    const data = OL.getCurrentProjectData();
    const stages = data.stages || [];
    const resources = data.resources || [];

    const stageIdx = stages.findIndex(s => String(s.id) === String(stageId));

    if (stageIdx === -1) {
        console.error("❌ Delete failed: Stage ID not found in data.", stageId);
        return;
    }

    const stageName = stages[stageIdx].name;

    if (!confirm(`Permanently delete the "${stageName}" section? Any cards inside will be moved back to the Workbench.`)) return;

    resources.forEach(res => {
        if (String(res.stageId) === String(stageId)) {
            console.log(`📦 Unmapping resource: ${res.name}`);
            res.stageId = null;
            res.isGlobal = true;
            delete res.coords;
        }
    });

    stages.splice(stageIdx, 1);

    await persist();

    await OL.autoAlignNodes();

    OL.renderWorkbenchItemsOnly();

    console.log(`✅ Stage "${stageName}" deleted successfully.`);
}

export async function renameStage(stageId, newName) {
    const cleanName = newName.trim();
    if (!cleanName) return;

    const data = OL.getCurrentProjectData();
    const stage = data.stages.find(s => String(s.id) === String(stageId));

    if (stage) {
        stage.name = cleanName;

        await OL.updateAndSync(() => {
            console.log(`✅ Stage ${stageId} renamed to: ${cleanName}`);
        });

        const inputEl = document.querySelector(`input[onchange*="${stageId}"]`);
        if (inputEl) inputEl.value = cleanName;
    }
}

export async function moveStageIndex(fromIdx, toIdx) {
    const data = OL.getCurrentProjectData();
    const stages = data.stages || [];

    if (toIdx < 0 || toIdx >= stages.length) return;

    await OL.updateAndSync(() => {
        const [movedStage] = stages.splice(fromIdx, 1);
        stages.splice(toIdx, 0, movedStage);
        console.log(`🔀 Drawer Sync Complete: Shifted stage index ${fromIdx} ➔ ${toIdx}`);
    });

    if (typeof OL.autoAlignNodes === 'function') {
        OL.autoAlignNodes();
    } else {
        OL.renderVisualizer();
    }
}

// ---- bridge: keep OL.* calls working until callers import directly ----
window.OL = window.OL || {};
Object.assign(window.OL, {
    getWorkflows, createWorkflow, renameWorkflow, deleteWorkflow,
    addResourceToWorkflow, removeResourceFromWorkflow, reorderWorkflowResources,
    _fvCreateWorkflow, _fvAddResourceToWorkflow,
    insertStage, addStageBetween, _fvDeleteStage, deleteStage,
    renameStage, moveStageIndex
});
