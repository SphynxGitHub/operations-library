//======================= FEATURES / FLOW VISUALIZER / CORE =======================//
// Extracted from app.js "INFINITE GRID (V2 CONSOLIDATED)" section — the
// entire remaining flow-map subsystem after workflows.js was split out
// earlier (workflow/stage CRUD). This one module covers rendering
// (flowchart/list/steps views, card builder), drag-and-drop, SVG
// connections, the docked inspector panel (step/logic/assignment
// editing — the single largest piece), and the "Power Add" quick-add
// slash-command system.
//
// Given the size (156 functions), this was pulled as one verified,
// contiguous module rather than several scattered ones — the code here
// is too internally interlinked (rendering calls drag handlers calls
// inspector calls connections...) to split cleanly without much higher
// risk of missing a cross-reference. Can be split further later if
// wanted, now that it's a known-working baseline.
//
// A few things intentionally left untouched rather than converted to
// exports, since nothing outside this module ever references them
// without the OL. prefix: OL._fvTypes, OL._fvGetType, OL.quickAddState,
// OL.isSavingStep, OL.state.v2.viewDepth. These still work exactly as
// before — they just remain plain assignments onto the global OL object.

import { state, esc, val, uid, getActiveClient, persist } from '../../core/data.js';

//===========================INFINITE GRID (V2 CONSOLIDATED)===========================
state.v2 = {
    zoom: 1,
    pan: { x: 0, y: 0 },
    activeDragId: null,
    selectedNodes: new Set(),
    expandedNodes: new Set(),
    isDraggingNode: false,
    trayTypeFilter: 'All'
};

// Simple global listener to clear selection when clicking the background
document.addEventListener('mousedown', (e) => {
    if (e.target.id === 'v2-canvas' || e.target.id === 'v2-node-layer'|| e.target.id === 'v2-canvas-scroll-wrap') {
        state.v2.selectedNodes.clear();
        OL.renderVisualizer(); // Re-render to clear blue borders
        OL.closeInspector();
    }
});

document.addEventListener('mousedown', (e) => {
    // Only fire on the flowchart canvas background or swimlane empty space
    const isCanvasBg = e.target.id === 'fv-canvas-wrap' 
                    || e.target.id === 'fv-canvas'
                    || e.target.classList.contains('fv-swimlane')
                    || e.target.id === 'fv-lanes-container';
    
    if (isCanvasBg) {
        OL.closeInspectorPanel();
        document.querySelectorAll('.fv-card.selected, .fv-step-card.selected')
            .forEach(el => el.classList.remove('selected'));
    }
});

const FLOW_COLUMN_VW = 22;   // Width of one card (22% of viewport)
const FLOW_GAP_VW = 3;      // Gap between columns (3% of viewport)
const FLOW_SPINE_X_VW = 50;  // The center of the screen

export function initWBMotion(e, id) {
    const canvas = document.getElementById('v2-canvas');
    const zoom = OL.state.v2.zoom || 1;
    const data = OL.getCurrentProjectData(); 
    const resources = data.resources; 
    const stages = data.stages;
    
    const res = resources.find(r => String(r.id) === String(id));
    if (!res) return;

    let isResizingLane = false; 
    let pendingWidthChange = null;
    let pendingStageIdx = null;

    let indicator = document.getElementById('drag-indicator');
    if (!indicator) {
        indicator = document.createElement('div');
        indicator.id = 'drag-indicator';
        document.body.appendChild(indicator);
    }
    
    indicator.style.display = 'block';
    indicator.style.zIndex = '99999'; 
    indicator.style.opacity = '1';

    const el = document.getElementById(`v2-node-${id}`);
    if (el) el.classList.add('is-dragging-ghost');

    const onMove = (mE) => {
        indicator.style.left = `${mE.clientX - 7}px`;
        indicator.style.top = `${mE.clientY - 7}px`;
        indicator.style.position = 'fixed';

        const rect = canvas.getBoundingClientRect();
        const mouseCanvasX = (mE.clientX - rect.left) / zoom;

        // Legacy lane resizing logic (Optional: keep or remove)
        if (mE.clientY < 150) { 
            let accX = 40; 
            const laneElements = document.querySelectorAll('.v2-lane-section:not(.start-trigger)');
            
            laneElements.forEach((laneEl, idx) => {
                const stage = stages[idx];
                if (!stage) return;
                const w = stage.width || 320;
                const isNearLine = mouseCanvasX > (accX + w - 30) && mouseCanvasX < (accX + w + 30);
                
                if (isNearLine) {
                    isResizingLane = true;
                    pendingStageIdx = idx;
                    const newWidth = Math.max(300, mouseCanvasX - accX);
                    pendingWidthChange = newWidth;
                    laneEl.style.width = `${newWidth}px`;
                }
                accX += w;
            });
        }
    };

    const onUp = async (uE) => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        
        indicator.style.display = 'none';
        if (el) el.classList.remove('is-dragging-ghost');

        if (isResizingLane && pendingStageIdx !== null) {
            await OL.updateAndSync(() => {
                stages[pendingStageIdx].width = pendingWidthChange;
            });
            isResizingLane = false;
            OL.renderVisualizer();
            return;
        }

        el.style.display = 'none';
        const dropPointEl = document.elementFromPoint(uE.clientX, uE.clientY);
        el.style.display = 'block';

        const stepRow = dropPointEl?.closest('.v2-step-item');
        const targetCardEl = dropPointEl?.closest('.v2-node-card');
        const isOverTopShelf = dropPointEl?.closest('#global-shelf');
        const isOverWorkbench = dropPointEl?.closest('#v2-workbench-sidebar');
        const vw = window.innerWidth / 100;
        const rect = canvas.getBoundingClientRect();
        const canvasX = (uE.clientX - rect.left) / zoom;
        const canvasY = (uE.clientY - rect.top) / zoom;
        
        // 🧲 Magnetic Column Snap
        const droppedXvw = canvasX / vw;
        const colStep = FLOW_COLUMN_VW + FLOW_GAP_VW;
        res.layoutCol = Math.round((droppedXvw - FLOW_SPINE_X_VW) / colStep);

        // --- Step Linking ---
        if (stepRow && targetCardEl && targetCardEl.id !== `v2-node-${res.id}`) {
            const targetId = targetCardEl.id.replace('v2-node-', '');
            const targetRes = resources.find(r => String(r.id) === String(targetId));
            const stepIdAttr = stepRow.getAttribute('data-step-id');
            const stepUniqueId = stepIdAttr ? stepIdAttr.split('-').pop() : null;
            const step = (targetRes.steps || []).find(s => String(s.id) === String(stepUniqueId));

            if (step) {
                if (!step.links) step.links = [];
                step.links.push({ id: res.id, name: res.name, type: res.type });
                await OL.persist();
                OL.renderVisualizer();
                return;
            }
        }

        // --- Merge Logic ---
        if (targetCardEl && targetCardEl.id !== `v2-node-${res.id}` && !isOverTopShelf && !isOverWorkbench) {
            const targetId = targetCardEl.id.replace('v2-node-', '');
            const targetRes = resources.find(r => String(r.id) === String(targetId));

            if (targetRes && confirm(`Merge steps from "${res.name}" into "${targetRes.name}"?`)) {
                await OL.updateAndSync(() => {
                    const stepsToMove = JSON.parse(JSON.stringify(res.steps || []));
                    targetRes.steps = [...(targetRes.steps || []), ...stepsToMove].filter(Boolean);
                    const resIdx = resources.findIndex(r => String(r.id) === String(res.id));
                    if (resIdx > -1) resources.splice(resIdx, 1);
                    OL.refreshFamilyNaming(targetRes, resources);
                    OL.syncLogicPorts();
                });
                OL.renderVisualizer();
                return;
            }
        }

        // --- Shelf / Workspace or Stage Drop ---
        if (isOverTopShelf || isOverWorkbench) {
            await OL.updateAndSync(() => {
                res.isGlobal = true;
                res.isTopShelf = !!isOverTopShelf;
                res.stageId = null;
                delete res.coords;
            });
        } else {
            // 📍 Vertical Stage Detection
            const sortedStages = [...stages].sort((a, b) => (b.yPos || 0) - (a.yPos || 0));
            const targetStage = sortedStages.find(s => canvasY >= (s.yPos || 0)) || stages[0];

            res.stageId = targetStage.id;
            res.coords = { x: Math.round(canvasX), y: Math.round(canvasY) };
            res.isGlobal = false;
            res.isTopShelf = false;
        }

        await OL.updateAndSync(() => { 
            OL.autoAlignNodes(); 
            if (OL.drawConnections) OL.drawConnections();
        });

        OL.renderVisualizer();
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
};
    
// Add this near your other event listeners
window.addEventListener('resize', () => {
    if (window.location.hash.includes('visualizer')) {
        // Debounce this if you want to be extra performant
        clearTimeout(window.resizeSnapTimer);
        window.resizeSnapSnapTimer = setTimeout(() => {
            OL.autoAlignNodes();
        }, 200);
    }
});

export async function handleCanvasDrop(e) {
    // 🛑 STOP BOTH BROWSER ACTIONS AND ELEMENT OVERLAPS FROM FIRING MULTIPLE DROPS
    e.preventDefault();
    e.stopPropagation();
    
    const canvas = document.getElementById('v2-canvas') || document.getElementById('fv-canvas');
    if (!canvas) return;
    
    const zoom = (state.v2 && state.v2.zoom) || (OL._fv && OL._fv.zoom) || 1;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / zoom;
    const y = (e.clientY - rect.top) / zoom;

    const dragId = e.dataTransfer.getData('application/fv-resource') || e.dataTransfer.getData('text/plain');
    if (!dragId) return;

    const data = OL.getCurrentProjectData();
    const res = data.resources.find(r => String(r.id) === String(dragId));
    if (!res) return;

    // 🎯 1. FIND THE TARGET WORKFLOW AND STAGE DIRECTLY BENEATH THE MOUSE CURSOR
    let targetStageId = null;
    let targetWorkflowId = null;

    const elementsUnderCursor = document.elementsFromPoint(e.clientX, e.clientY);
    for (const el of elementsUnderCursor) {
        const wfGroup = el.closest('.fv-list-workflow-group');
        const stageLane = el.closest('.fv-list-stage') || el.closest('[data-stage-id]');
        
        if (wfGroup && wfGroup.id) {
            targetWorkflowId = wfGroup.id.replace('fv-workflow-group-', ''); 
        }
        if (stageLane) {
            targetStageId = stageLane.id ? stageLane.id.replace('fv-list-stage-', '') : stageLane.getAttribute('data-stage-id');
        }
        if (targetStageId || targetWorkflowId) break;
    }

    if (targetWorkflowId && !targetStageId) {
        const matchingWf = (data.workflows || []).find(w => String(w.id) === String(targetWorkflowId));
        if (matchingWf) targetStageId = matchingWf.stageId;
    }

    // Capture the origin workflow context that we bundled during DragStart
    const sourceWfId = e.dataTransfer.getData('application/fv-context-wf') || OL._fv._draggingContextWfId;

    // 🎯 2. PROCESS ENGINES BASED ON GLOBAL BLUEPRINT STATUS
    if (res.isGlobal === true) {
        // 🌐 GLOBAL ARTIFACT RULES: ABSOLUTELY ZERO ROOT PROPERTY MUTATIONS ALLOWED
        // We do NOT write to res.stageId or res.workflowId. This leaves old map copies alone!
        
        if (targetWorkflowId) {
            const targetWf = (data.workflows || []).find(w => String(w.id) === String(targetWorkflowId));
            if (targetWf) {
                if (!targetWf.resourceIds) targetWf.resourceIds = [];
                
                // Add to the new workflow sequence array
                if (!targetWf.resourceIds.includes(String(res.id))) {
                    targetWf.resourceIds.push(String(res.id));
                }
            }
            console.log(`🌐 Global stamped safely onto Workflow Array: ${targetWorkflowId}`);
        }
    } else {
        // 🏠 LOCAL ARTIFACT RULES: STANDARD SINGLE-INSTANCE MOVE
        // Clean out its tracking reference from its old workflow array lane
        if (sourceWfId && String(sourceWfId) !== String(targetWorkflowId)) {
            const oldWf = (data.workflows || []).find(w => String(w.id) === String(sourceWfId));
            if (oldWf && oldWf.resourceIds) {
                oldWf.resourceIds = oldWf.resourceIds.filter(id => String(id) !== String(res.id));
            }
        }

        // Standard root property mutations for local files
        res.stageId = targetStageId || res.stageId || null;
        res.workflowId = targetWorkflowId || null;
        res.coords = { x: Math.round(x - 110), y: Math.round(y - 20) };

        if (targetWorkflowId) {
            const targetWf = (data.workflows || []).find(w => String(w.id) === String(targetWorkflowId));
            if (targetWf) {
                if (!targetWf.resourceIds) targetWf.resourceIds = [];
                if (!targetWf.resourceIds.includes(String(res.id))) {
                    targetWf.resourceIds.push(String(res.id));
                }
            }
        }
    }

    res.isTopShelf = false;
    res.isDeleted = false;

    await OL.persist();
    OL.renderVisualizer(); 
};

export async function autoAlignNodes() {
    const data = OL.getCurrentProjectData();
    const resources = data.resources || [];
    const stages = data.stages || [];
    const vw = window.innerWidth / 100;
    const depth = OL.state.v2.viewDepth;
    
    const VERTICAL_GAP = 40;
    let currentY = 100; // Starting point at the top of the map

    stages.forEach((stage) => {
        stage.yPos = currentY;
        currentY += 80;

        // 🚀 THE BIG SWITCH: Get either Resources or individual Steps
        let nodesToAlign = [];
        const stageResources = resources.filter(r => String(r.stageId) === String(stage.id) && !r.isGlobal);

        if (depth === 'step') {
            // Flatten all steps into a single list for this stage
            stageResources.forEach(res => {
                res.steps.forEach((step, idx) => {
                    nodesToAlign.push({
                        ...step,
                        parentId: res.id,
                        parentName: res.name,
                        parentType: res.type,
                        stepIdx: idx,
                        // Maintain the user's manual vertical preference
                        sortY: (res.coords?.y || 0) + (idx * 50) 
                    });
                });
            });
        } else {
            nodesToAlign = stageResources.map(r => ({ ...r, sortY: r.coords?.y || 0 }));
        }

        nodesToAlign.sort((a, b) => a.sortY - b.sortY);

        let stageHeightAccumulator = 0;
        nodesToAlign.forEach(node => {
            // Logic to calculate xPosPx based on node.layoutCol or parent's layoutCol...
            // Logic to calculate yPos based on currentY + stageHeightAccumulator...
            
            // If it's a step, we save its coords to a temp state for drawing lines
            // If it's a resource, we update res.coords directly.
        });
        
        currentY += Math.max(stageHeightAccumulator, 150) + 100;
    });
    await OL.persist();
    OL.renderVisualizer();
     if (OL.drawConnections) OL.drawConnections();
};

export function getCurrentProjectData() {
    const hash = window.location.hash || "#/";
    const isVault = hash.startsWith('#/vault');
    
    if (isVault) {
        if (!state.master.stages) state.master.stages = [];
        if (!state.master.resources) state.master.resources = [];
        if (!state.master.workflows) state.master.workflows = [];
        return state.master; 
    } else {
        const client = getActiveClient();
        if (!client || !client.projectData) return { stages: [], resources: [], workflows: [] };

        const pd = client.projectData;

        // 🩺 AUTOMATIC SANITIZATION: Force proper arrays on the LIVE reference
        if (!pd.stages) pd.stages = [];
        if (!pd.localResources) pd.localResources = [];
        
        // 🚑 THE TYPO BRIDGE: Heal 'workfows' vs 'workflows' on the fly
        if (pd.workfows && !pd.workflows) {
            pd.workflows = pd.workfows;
        }
        if (!pd.workflows) pd.workflows = [];

        // 🎯 THE COMPATIBILITY BRIDGE
        // We attach a live reference link of .localResources to .resources 
        // so the layout engine finds exactly what it's hunting for.
        pd.resources = pd.localResources;

        // 🏗️ DAFUALT WORKFLOW GEN: If they have stages but no workflows, 
        // auto-build a placeholder workflow so their cards don't vanish from Swimlanes
        if (pd.stages.length > 0 && pd.workflows.length === 0) {
            pd.stages.forEach(stage => {
                const hasWf = pd.workflows.some(w => w.stageId === stage.id);
                if (!hasWf) {
                    pd.workflows.push({
                        id: 'wf-auto-' + stage.id,
                        name: `Main ${stage.name} Process`,
                        stageId: stage.id,
                        resourceIds: pd.localResources
                            .filter(r => r.stageId === stage.id)
                            .map(r => String(r.id))
                    });
                }
            });
        }

        return pd; // Return the exact reference object so background edits persist!
    }
};

// 🛡️ Global Logic Menu Closer
document.addEventListener('mousedown', (e) => {
    // If the click is NOT on a logic badge or inside a logic menu, hide all menus
    if (!e.target.closest('.v2-logic-badge') && !e.target.closest('.v2-logic-menu')) {
        document.querySelectorAll('.v2-logic-menu').forEach(m => m.style.display = 'none');
    }
});

OL.state.v2.viewDepth = 'resource'; // Options: 'resource' (current) or 'step' (broken out)

// ── TYPE CONFIG ───────────────────────────────────────────
OL._fvTypes = {
  'Workflow':       { color: '#1b2d3f', abbr: 'WF' },
  'Zap':            { color: '#ff4a00', abbr: 'ZP' },
  'Email Campaign': { color: '#3dd9c5', abbr: 'EM' },
  'Form':           { color: '#f5b800', abbr: 'FO' },
  'Task':           { color: '#6b7280', abbr: 'TK' },
  'Calendar':       { color: '#7c3aed', abbr: 'CA' },
  'Decision':       { color: '#f5b800', abbr: '?' },
  'General':        { color: '#6b7280', abbr: '•' },
};
OL._fvGetType = t => OL._fvTypes[t] || { color: '#6b7280', abbr: (t||'?').substring(0,2).toUpperCase() };

export function _fvNormalizeStepCoords() {
    const data = OL.getCurrentProjectData();
    (data.resources || []).forEach(res => {
        (res.steps || []).forEach(step => {
            // Don't set 0,0 — leave null so _fvComputeLayout handles it
            if (!step.coords) step.coords = null;
            if (step.pinned === undefined) step.pinned = false;
        });
    });
};

// Returns explicit logic.out links if any targetId is set; otherwise a synthetic
// implicit link to the next sequential step in the same resource.
export function _fvGetEffectiveOut(step, res) {
    const explicit = (step.logic?.out || []).filter(l => l.targetId);
    if (explicit.length > 0) return explicit;
    const steps = res.steps || [];
    const idx = steps.indexOf(step);
    if (idx === -1 || idx >= steps.length - 1) return [];
    const nextStep = steps[idx + 1];
    return [{ type: 'next', types: ['next'], targetId: `${res.id}-${nextStep.id}`, _implicit: true }];
};

// Computes per-step layout info for a single resource.
// Main-path steps (not branch targets): colOffset=0, sequential rows.
// Branch targets (reached via condition/loop/delay): colOffset≥1, same row as parent.
export function _fvLayoutResource(res) {
    const steps = res.steps || [];

    // Find which steps are branch targets and who their parent is
    const branchOf = {}; // stepId → parentStepId
    steps.forEach(step => {
        (step.logic?.out || []).forEach(link => {
            if (!link.targetId) return;
            const lastH  = link.targetId.lastIndexOf('-');
            const tResId = link.targetId.substring(0, lastH);
            if (String(tResId) !== String(res.id)) return;
            const tStepId = link.targetId.substring(lastH + 1);
            const types   = link.types || [link.type || 'next'];
            if (types.some(t => ['condition', 'loop', 'delay'].includes(t)) && !branchOf[tStepId]) {
                branchOf[tStepId] = step.id;
            }
        });
    });

    const layout   = {};   // stepId → {colOffset, row, parentId}
    const parentRow = {};  // stepId → row index (for branch alignment)
    let mainRow = 0;

    // Main-path steps in array order
    steps.forEach(step => {
        if (branchOf[step.id]) return;
        layout[step.id]    = { colOffset: 0, row: mainRow, parentId: null };
        parentRow[step.id] = mainRow;
        mainRow++;
    });

    // Branch steps: same row as parent, colOffset > 0
    const rowBranchCount = {};
    steps.forEach(step => {
        const parentId = branchOf[step.id];
        if (!parentId) return;
        const pRow = parentRow[parentId] ?? 0;
        rowBranchCount[pRow] = (rowBranchCount[pRow] || 0) + 1;
        layout[step.id] = { colOffset: rowBranchCount[pRow], row: pRow, parentId };
    });

    return layout;
};

// Persist sequential next-step links for any step that has no outbound link defined.
// Safe to call on every render — skips steps that already have logic.out set.
export function _fvAutoLinkSteps(resources) {
    let changed = false;
    (resources || []).forEach(res => {
        (res.steps || []).forEach((step, idx) => {
            if (!step.logic) step.logic = { in: [], out: [] };
            if (!step.logic.out) step.logic.out = [];
            if (!step.logic.in)  step.logic.in  = [];
            const hasOut = step.logic.out.some(l => l.targetId);
            if (hasOut) return;
            const nextStep = (res.steps || [])[idx + 1];
            if (!nextStep) return;
            step.logic.out.push({
                type: 'next', types: ['next'],
                targetId: `${res.id}-${nextStep.id}`,
                rule: '', loopLimit: '', delayValue: '', delayUnit: 'days'
            });
            changed = true;
        });
    });
    if (changed) OL.persist();
    return changed;
};
// ── SHARED STATE ─────────────────────────────────────────
if (!OL._fv) OL._fv = {
    layout: sessionStorage.getItem('fv_layout') || 'flowchart',
    zoom: 1,
    showConnections: true,
    stageFilter: '',
    globalsExpanded: false,
    searchMatches: [], searchIdx: -1,
    snapToGrid: false, gridSize: 20,
    _searchQuery: '',
    railCollapsed: sessionStorage.getItem('fv_rail_collapsed') === 'true',
};

// ── MAIN ENTRY ────────────────────────────────────────────
export function renderVisualizer() {
  const wasOpen = OL._fv._lastInspectorResId;
  const mainArea = document.getElementById('mainContent');
  if (!mainArea) return;

  document.body.classList.add('is-visualizer');
  mainArea.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden;padding:0;';

  const client    = getActiveClient();
  const data      = OL.getCurrentProjectData();
  const stages    = data.stages || [];
  const resources = (data.resources || []).filter(r => !r.isDeleted && !r.isLocked);

  if (!OL._fv) OL._fv = {
        layout: sessionStorage.getItem('fv_layout') || 'flowchart', zoom: 1,
        showConnections: true, stageFilter: '',
        globalsExpanded: false,
        searchMatches: [], searchIdx: -1,
        snapToGrid: false, gridSize: 20,
        _searchQuery: '',
    };
    
  // Run DAG layout for flowchart view only — steps view does its own positioning
  if (OL._fv.layout !== 'steps') {
    OL._fvNormalizeStepCoords();
    OL._fvComputeLayout(resources, OL._fv.stageFilter);
  }

  mainArea.innerHTML = `
    <div id="fv-shell">

      <!-- TOPBAR -->
      <div id="fv-topbar">
        <div class="fv-breadcrumb">
          <span>${client ? esc(client.meta.name) : 'Workspace'}</span>
          <span class="fv-sep">/</span>
          <span class="fv-current">Flow Map</span>
        </div>
        <div class="fv-spacer"></div>

        <button class="fv-btn fv-icon"
                onclick="OL._fv.railCollapsed = !OL._fv.railCollapsed; 
                 sessionStorage.setItem('fv_rail_collapsed', OL._fv.railCollapsed); 
                 OL.renderVisualizer();"
                title="${OL._fv.railCollapsed ? 'Expand panel' : 'Collapse panel'}">
            <i data-lucide="${OL._fv.railCollapsed ? 'panel-left-open' : 'panel-left-close'}"></i>
        </button>

        <div class="fv-search-wrap">
          <i data-lucide="search" style="width:13px;height:13px;color:var(--text-muted);flex-shrink:0;"></i>
          <input id="fv-search" type="text"
                 placeholder="Search steps…"
                 value="${esc(OL._fv._searchQuery || '')}"
                 oninput="OL.fvSearch(this.value)"
                 autocomplete="off">
        </div>
        <div id="fv-search-nav"
             style="display:${OL._fv.searchMatches?.length ? 'flex' : 'none'};align-items:center;gap:4px;">
          <button class="fv-btn fv-icon" onclick="OL.fvPrevMatch()">
            <i data-lucide="chevron-left"></i>
          </button>
          <span id="fv-match-count"
                style="font-size:11px;color:var(--text-muted);min-width:32px;text-align:center;"></span>
          <button class="fv-btn fv-icon" onclick="OL.fvNextMatch()">
            <i data-lucide="chevron-right"></i>
          </button>
          <button class="fv-btn fv-icon" onclick="OL.fvClearSearch()">
            <i data-lucide="x"></i>
          </button>
          <button class="fv-toggle-btn ${OL._fv.showArchived ? 'on' : ''}"
                    onclick="OL._fv.showArchived = !OL._fv.showArchived; OL.renderVisualizer();">
              📦 ${OL._fv.showArchived ? 'Hide Archived' : 'Show Archived'}
            </button>
        </div>

        <div class="fv-divider"></div>

        <!-- Layout switcher -->
        <div class="fv-layout-toggle-group" style="display: inline-flex; background: rgba(255,255,255,0.03); border: 1px solid var(--line); border-radius: 8px; padding: 2px; gap: 2px;">
            <button class="fv-layout-btn ${OL._fv.layout === 'flowchart' ? 'active' : ''}" 
                    style="display: flex; align-items: center; gap: 6px; padding: 5px 10px; border: none; font-size: 11px; font-weight: 600; font-family: inherit; border-radius: 6px; cursor: pointer; transition: all 0.15s; 
                           background: ${OL._fv.layout === 'flowchart' ? 'rgba(61,217,197,0.15)' : 'transparent'}; 
                           color: ${OL._fv.layout === 'flowchart' ? 'var(--accent)' : 'var(--text-muted)'};"
                    onclick="OL._fv.layout = 'flowchart'; sessionStorage.setItem('fv_layout', 'flowchart'); OL.renderVisualizer();"
                    title="Swimlanes View">
                <i data-lucide="columns-3" style="width: 13px; height: 13px;"></i>
                <span>Swimlanes</span>
            </button>
        
            <button class="fv-layout-btn ${OL._fv.layout === 'steps' ? 'active' : ''}" 
                    style="display: flex; align-items: center; gap: 6px; padding: 5px 10px; border: none; font-size: 11px; font-weight: 600; font-family: inherit; border-radius: 6px; cursor: pointer; transition: all 0.15s; 
                           background: ${OL._fv.layout === 'steps' ? 'rgba(61,217,197,0.15)' : 'transparent'}; 
                           color: ${OL._fv.layout === 'steps' ? 'var(--accent)' : 'var(--text-muted)'};"
                    onclick="OL._fv.layout = 'steps'; sessionStorage.setItem('fv_layout', 'steps'); OL.renderVisualizer();"
                    title="Steps View">
                <i data-lucide="hexagon" style="width: 13px; height: 13px;"></i>
                <span>Steps</span>
            </button>
        
            <button class="fv-layout-btn ${OL._fv.layout === 'list' ? 'active' : ''}" 
                    style="display: flex; align-items: center; gap: 6px; padding: 5px 10px; border: none; font-size: 11px; font-weight: 600; font-family: inherit; border-radius: 6px; cursor: pointer; transition: all 0.15s; 
                           background: ${OL._fv.layout === 'list' ? 'rgba(61,217,197,0.15)' : 'transparent'}; 
                           color: ${OL._fv.layout === 'list' ? 'var(--accent)' : 'var(--text-muted)'};"
                    onclick="OL._fv.layout = 'list'; sessionStorage.setItem('fv_layout', 'list'); OL.renderVisualizer();"
                    title="List View">
                <i data-lucide="list" style="width: 13px; height: 13px;"></i>
                <span>List</span>
            </button> 
        </div>

        <!-- Stage filter -->
        <select id="fv-stage-filter" class="fv-select"
                onchange="OL._fv.stageFilter = this.value; OL.renderVisualizer();">
          <option value="">All stages & workflows</option>
          ${stages.map(s => {
            const stageWorkflows = (OL.getWorkflows() || []).filter(w => w.stageId === s.id);
            const stageSelected  = OL._fv.stageFilter === `stage-${s.id}`;
            return `
              <option value="stage-${esc(s.id)}" ${stageSelected ? 'selected' : ''}>
                ${esc(s.name)}
              </option>
              ${stageWorkflows.map(wf => `
                <option value="${esc(wf.id)}" ${OL._fv.stageFilter === wf.id ? 'selected' : ''}>
                  &nbsp;&nbsp;↳ ${esc(wf.name)}
                </option>
              `).join('')}
            `;
          }).join('')}
        </select>

        <!-- Globals toggle (flowchart only) -->
        ${OL._fv.layout === 'flowchart' ? `
          <button class="fv-toggle-btn ${OL._fv.globalsExpanded ? 'on' : ''}"
                  onclick="OL._fv.globalsExpanded=!OL._fv.globalsExpanded; OL.renderVisualizer();">
            <i data-lucide="globe"></i>
            Globals ${OL._fv.globalsExpanded ? 'On' : 'Off'}
          </button>
        ` : ''}

        <!-- Steps view controls -->
        ${OL._fv.layout === 'steps' ? `
          <button class="fv-toggle-btn ${OL._fv.snapToGrid ? 'on' : ''}"
                  onclick="OL._fv.snapToGrid=!OL._fv.snapToGrid; OL.renderVisualizer();"
                  title="Snap to grid">
            <i data-lucide="grid"></i>
            Grid ${OL._fv.snapToGrid ? 'On' : 'Off'}
          </button>

          <!-- Tidy dropdown -->
          <div style="position:relative;display:inline-flex;">
            <button class="fv-btn" onclick="OL._fvTidy('global')"
                    title="Tidy layout (respects pinned)">
              <i data-lucide="align-justify"></i> Tidy
            </button>
            <button class="fv-btn fv-icon" style="border-left:none;border-radius:0 8px 8px 0;padding:7px 6px;"
                    onclick="OL._fvShowTidyMenu(event)">
              <i data-lucide="chevron-down"></i>
            </button>
          </div>
        ` : ''}

        <div class="fv-divider"></div>

        <!-- Step Expand button-->
        ${OL._fv.layout === 'flowchart' ? `
          <button class="fv-toggle-btn ${OL._fv.stepsExpanded ? 'on' : ''}"
                  onclick="OL._fv.stepsExpanded=!OL._fv.stepsExpanded; OL.renderVisualizer();"
                  title="Show steps inside cards">
            <i data-lucide="list"></i>
            Steps ${OL._fv.stepsExpanded ? 'On' : 'Off'}
          </button>
        ` : ''}

        <!-- Zoom -->
        <button class="fv-btn fv-icon" onclick="OL.fvZoom(-0.12)">
          <i data-lucide="minus"></i>
        </button>
        <span id="fv-zoom-label"
              style="font-size:11px;font-weight:600;color:var(--text-dim);min-width:38px;text-align:center;">
          ${Math.round((OL._fv.zoom||1)*100)}%
        </span>
        <button class="fv-btn fv-icon" onclick="OL.fvZoom(0.12)">
          <i data-lucide="plus"></i>
        </button>
      </div>

        <div class="fv-divider"></div>
        <div style="position:relative;display:inline-flex;">
            <button class="fv-btn" style="gap:6px;"
                    id="fv-print-btn"
                    onclick="OL._fvTogglePrintMenu()">
                <i data-lucide="printer" style="width:13px;height:13px;"></i>
                Export PDF
            </button>
            <div id="fv-print-menu" style="
                display:none;position:absolute;top:calc(100% + 6px);right:0;
                background:var(--panel);border:1px solid var(--panel-border);
                border-radius:10px;padding:6px;z-index:100;min-width:160px;
                box-shadow:0 8px 24px rgba(0,0,0,0.3);">
                ${[
                    { view:'flowchart', icon:'columns-3',   label:'Swimlanes' },
                    { view:'list',      icon:'list',         label:'List View' },
                    { view:'steps',     icon:'hexagon',      label:'Steps View' },
                ].map(v => `
                    <div onmousedown="event.preventDefault();OL.printFlowMap('${v.view}');document.getElementById('fv-print-menu').style.display='none';"
                         style="display:flex;align-items:center;gap:10px;padding:9px 12px;
                                border-radius:7px;cursor:pointer;transition:background 0.12s;"
                         onmouseover="this.style.background='var(--panel-soft)'"
                         onmouseout="this.style.background='transparent'">
                        <i data-lucide="${v.icon}" style="width:13px;height:13px;color:var(--accent);flex-shrink:0;"></i>
                        <span style="font-size:12px;font-weight:600;color:var(--text-main);">${v.label}</span>
                    </div>
                `).join('')}
            </div>
        </div>

      <!-- BODY -->
      <div id="fv-body">

        <!-- Workbench icon rail -->
        <div id="fv-wb-rail"
             ondragover="event.preventDefault(); this.style.background='rgba(61,217,197,0.15)';"
             ondragleave="this.style.background='';"
             ondrop="event.preventDefault(); this.style.background=''; 
                     const id=event.dataTransfer.getData('application/fv-resource'); 
                     if(id) OL._fvUnmapResource(id);">
        
            <div class="fv-wb-icon ${OL._fv._wbTab==='flows' ?'active':''}"
                  onclick="OL._fvToggleWb('flows')" title="Flows">
              <i data-lucide="workflow"></i>
            </div>
            <div class="fv-wb-icon ${OL._fv._wbTab==='assets' ?'active':''}"
                  onclick="OL._fvToggleWb('assets')" title="Assets">
              <i data-lucide="database"></i>
            </div>
            <div class="fv-wb-icon ${OL._fv._wbTab==='guides' ?'active':''}"
                  onclick="OL._fvToggleWb('guides')" title="Guides">
              <i data-lucide="book-open"></i>
            </div>
            <div class="fv-wb-icon ${OL._fv._wbTab==='data' ?'active':''}"
                  onclick="OL._fvToggleWb('data')" title="Data">
              <i data-lucide="tag"></i>
            </div>
        </div>
        <!-- Workbench drawer -->
        <div id="fv-wb-drawer" class="${OL._fv._wbTab ? 'open' : ''}"
             ondragover="event.preventDefault(); event.stopPropagation(); this.style.background='rgba(61,217,197,0.08)';"
             ondragleave="if(!this.contains(event.relatedTarget)){this.style.background='';}"
             ondrop="OL._fvHandleDrawerDrop(event)"">
          <div class="fv-wb-header">
            <span class="fv-wb-title">${OL._fv._wbTab ? OL._fv._wbTab.charAt(0).toUpperCase() + OL._fv._wbTab.slice(1) : ''}</span>
            <button class="fv-btn fv-icon" onclick="OL._fvToggleWb(null)">
              <i data-lucide="x"></i>
            </button>
          </div>
          <div id="fv-wb-content"></div>
        </div>

        <!-- Lane rail (flowchart + list only) -->
        ${OL._fv.layout !== 'steps' ? `
          <div id="fv-lane-rail"></div>
        ` : ''}

        <!-- Main canvas -->
        <div id="fv-canvas-wrap"
             onclick="OL._fvHandleCanvasClick(event)">
          <div id="fv-canvas">
            <svg id="fv-svg-layer"></svg>
            <div id="fv-content"></div>
          </div>
        </div>

      </div>
    </div>
  `;
    
   const realInspector = document.getElementById('inspector-panel');
    if (realInspector) {
      realInspector.id = 'v2-inspector-panel';
      // Ensure inspector-content exists inside it
      if (!document.getElementById('inspector-content')) {
        const scrollContent = realInspector.querySelector('.inspector-scroll-content');
        if (scrollContent) {
          scrollContent.innerHTML = '<div id="inspector-content"></div>';
        }
      }
    }

  if (window.lucide) lucide.createIcons();

  // Render content based on layout
  if (OL._fv.layout === 'flowchart') {
    OL._fvRenderFlowchart(stages, resources);
  } else if (OL._fv.layout === 'steps') {
    OL._fvRenderSteps(resources);
  } else {
    OL._fvRenderList(stages, resources);
  }

  // Populate workbench if open
  if (OL._fv._wbTab) OL._fvPopulateWb(OL._fv._wbTab, resources);

  // Setup interactions
  OL._fvSetupZoom();
  if (OL._fv.layout !== 'steps') {
    OL._fvSyncRailHeights();
    OL._fvSetupRailScroll();
  }

 if (wasOpen) {
    requestAnimationFrame(() => {
        OL._fvOpenStepsList(wasOpen);
    });
  }
};

export function _fvTogglePrintMenu() {
    const menu = document.getElementById('fv-print-menu');
    if (!menu) return;
    const isOpen = menu.style.display === 'block';
    menu.style.display = isOpen ? 'none' : 'block';
    if (!isOpen) {
        setTimeout(() => {
            document.addEventListener('click', function closePrintMenu(e) {
                const btn = document.getElementById('fv-print-btn');
                if (!menu.contains(e.target) && btn && !btn.contains(e.target)) {
                    menu.style.display = 'none';
                    document.removeEventListener('click', closePrintMenu);
                }
            });
        }, 50);
    }
};

export function _fvHandleDrawerDrop(event) {
    event.preventDefault();
    event.stopPropagation();
    const drawer = event.currentTarget;
    drawer.style.background = '';
    const resId = event.dataTransfer.getData('application/fv-resource') 
               || event.dataTransfer.getData('text/plain');
    if (resId) OL._fvUnmapResource(resId);
};

export function _fvRenderFlowchart(stages, resources) {
  const body = document.getElementById('fv-body');
  if (!body) return;

  // Remove any previous rail/canvas before injecting fresh ones
  ['fv-lane-rail', 'fv-canvas-wrap'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.remove();
  });

  const html = OL._fvBuildFlowchartShell(stages, resources);
  const temp = document.createElement('div');
  temp.innerHTML = html;

  // Just append — inspector is now in the grid, not in fv-body
  while (temp.firstChild) {
    body.appendChild(temp.firstChild);
  }

  if (window.lucide) lucide.createIcons();
  OL._fvSyncRailHeights();
  OL._fvSetupRailScroll();
};

export function _fvRenderList(stages, resources) {
  const body = document.getElementById('fv-body');
  if (!body) return;

  // Remove previous content
  ['fv-list-wrap', 'fv-lane-rail', 'fv-canvas-wrap'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.remove();
  });

  const html = OL._fvBuildListShell(stages, resources);
  const temp = document.createElement('div');
  temp.innerHTML = html;

  while (temp.firstChild) {
    body.appendChild(temp.firstChild);
  }

  if (window.lucide) lucide.createIcons();
};

// ══════════════════════════════════════════════
// FLOWCHART VIEW
// ══════════════════════════════════════════════

export function _fvBuildFlowchartShell(stages, resources) {
  const data      = OL.getCurrentProjectData();
  if (!data.workflows) data.workflows = [];
  const workflows = data.workflows;
  const filter    = OL._fv.stageFilter || '';
  const expanded  = OL._fv.globalsExpanded || false;

  const globalResources = resources.filter(r => r.isGlobal);
  const globalIds       = new Set(globalResources.map(r => String(r.id)));

  // Build global stage count map
  const globalStageCount = {};
  globalResources.forEach(gr => {
    globalStageCount[String(gr.id)] = 0;
    stages.forEach(s => {
      const stageRes = resources.filter(r => r.stageId === s.id && !globalIds.has(String(r.id)));
      const referenced = stageRes.some(r =>
        (r.steps||[]).some(step =>
          (step.logic?.out||[]).some(out => {
            const lastH = String(out.targetId||'').lastIndexOf('-');
            return lastH !== -1 && out.targetId.substring(0, lastH) === String(gr.id);
          })
        )
      );
      if (referenced) globalStageCount[String(gr.id)]++;
    });
  });

  // Determine which stages/workflows to show based on filter
  // filter can be 'stage-{id}' or 'wf-{id}' or ''
  const isWfFilter    = filter.startsWith('wf-');
  const isStageFilter = filter.startsWith('stage-');
  const filteredWfId  = isWfFilter ? filter : null;
  const filteredStageId = isStageFilter ? filter.replace('stage-', '') : null;

  let railHtml  = '';
  let lanesHtml = '';
  let globalCardNum = 0;

  // ── COLORS for workflows ─────────────────────────────
  const WF_COLORS = [
    '#3dd9c5','#7c3aed','#f97316','#38bdf8',
    '#a78bfa','#fb923c','#10b981','#f43f5e'
  ];

  const displayStages = [...stages];

  displayStages.forEach((stage, si) => {
    if (filteredStageId && stage.id !== filteredStageId) return;

    // Get workflows for this stage
    const stageWorkflows = workflows.filter(w => w.stageId === stage.id);

    // Get unassigned resources for this stage
    const assignedResIds = new Set(
      stageWorkflows.flatMap(w => w.resourceIds || [])
    );
    const unassignedRes = resources.filter(r =>
      r.stageId === stage.id &&
      !globalIds.has(String(r.id)) &&
      !assignedResIds.has(String(r.id))
    );

    // Skip stage if wf filter and no matching workflow
    if (filteredWfId) {
      const hasMatchingWf = stageWorkflows.some(w => w.id === filteredWfId);
      if (!hasMatchingWf) return;
    }

    // ── RAIL: Stage header ───────────────────────────────
    railHtml += `
      <div class="fv-rail-stage-group"
           draggable="true"
           ondragstart="OL._fvRailDragStart(event, 'stage', '${stage.id}')"
           ondragover="event.preventDefault(); this.classList.add('fv-rail-drag-over')"
           ondragleave="this.classList.remove('fv-rail-drag-over')"
           ondrop="this.classList.remove('fv-rail-drag-over'); OL._fvRailDrop(event, 'stage', '${stage.id}')">
        <div style="padding:8px 10px 3px;display:flex;align-items:center;gap:6px;cursor:grab;">
          <span style="opacity:0.2;font-size:12px;">⠿</span>
          <span contenteditable="true"
                style="font-size:9px;font-weight:700;text-transform:uppercase;
                       letter-spacing:0.1em;color:rgba(255,255,255,0.25);
                       outline:none;flex:1;"
                onblur="OL._fvEditStageName('${stage.id}', this.innerText.trim())">
            ${esc(stage.name)}
          </span>
        </div>
    `;
    // ── RAIL: Workflow entries ───────────────────────────
    stageWorkflows.forEach((wf, wfi) => {
      if (filteredWfId && wf.id !== filteredWfId) return;
      const wfColor  = wf.color || WF_COLORS[wfi % WF_COLORS.length];
      const isActive = OL._fv.stageFilter === wf.id;
      const wfRes    = (wf.resourceIds || [])
        .map(id => resources.find(r => String(r.id) === id))
        .filter(Boolean);
        
        railHtml += `
          <div class="fv-rail-wf-item"
               draggable="true"
               ondragstart="OL._fvRailDragStart(event, 'workflow', '${wf.id}', '${stage.id}')"
               ondragover="event.preventDefault(); event.stopPropagation(); this.classList.add('fv-rail-drag-over')"
               ondragleave="this.classList.remove('fv-rail-drag-over')"
               ondrop="event.stopPropagation(); this.classList.remove('fv-rail-drag-over'); OL._fvRailDrop(event, 'workflow', '${wf.id}', '${stage.id}')"
               style="padding:5px 10px 5px 16px;display:flex;align-items:center;gap:6px;cursor:grab;
                      border-left:3px solid ${isActive ? wfColor : 'transparent'};
                      background:${isActive ? `${wfColor}15` : 'transparent'};">
            <span style="opacity:0.2;font-size:11px;">⠿</span>
            <div style="width:8px;height:8px;border-radius:50%;background:${wfColor};flex-shrink:0;"></div>
            <span style="font-size:10px;font-weight:500;color:${isActive ? wfColor : 'rgba(255,255,255,0.5)'};flex:1;
                         white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"
                  onclick="OL._fv.stageFilter='${wf.id}';OL.renderVisualizer();">
              ${esc(wf.name)}
            </span>
            <span style="font-size:9px;color:rgba(255,255,255,0.2);">${wfRes.length}</span>
          </div>
        `;

      // Rail: resources within workflow
      wfRes.forEach(res => {
        const tc = OL._fvGetType(res.type);
        railHtml += `
          <div style="padding:3px 10px 3px 22px;display:flex;align-items:center;gap:5px;
                      cursor:pointer;transition:background 0.12s;"
               onclick="OL._fvOpenStepsList('${res.id}')"
               onmouseover="this.style.background='rgba(255,255,255,0.03)'"
               onmouseout="this.style.background='transparent'">
            <div style="width:5px;height:5px;border-radius:50%;
                        background:${tc.color};flex-shrink:0;"></div>
            <span style="font-size:10px;color:rgba(255,255,255,0.3);
                         white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
              ${esc(res.name.substring(0, 18))}
            </span>
          </div>
        `;
      });
    });

    // Rail: unassigned
    if (unassignedRes.length > 0 && !filteredWfId) {
      railHtml += `
        <div style="padding:5px 10px;display:flex;align-items:center;gap:6px;opacity:0.5;">
          <div style="width:8px;height:8px;border-radius:50%;
                      background:#6b7280;flex-shrink:0;"></div>
          <span style="font-size:10px;color:rgba(255,255,255,0.3);">
            Unassigned
          </span>
          <span style="font-size:9px;color:rgba(255,255,255,0.2);">
            ${unassignedRes.length}
          </span>
        </div>
      `;
    }
    railHtml += `</div>`; // close fv-rail-stage-group
      
    // ── CANVAS: Stage header ─────────────────────────────
    lanesHtml += `
      <div style="padding:8px 16px;background:var(--panel);
                  border-bottom:0.5px solid var(--panel-border);
                  display:flex;align-items:center;gap:8px;
                  position:sticky;top:0;z-index:10;">
        <div style="width:20px;height:20px;border-radius:5px;
                    background:#3dd9c5;color:var(--panel);font-size:9px;
                    font-weight:700;display:flex;align-items:center;
                    justify-content:center;flex-shrink:0;">
          ${si + 1}
        </div>
        <span contenteditable="true"
              style="font-size:12px;font-weight:500;color:var(--text-main);outline:none;
                     border-bottom:1px dashed transparent;transition:border-color 0.2s;"
              onfocus="this.style.borderColor='#3dd9c5'"
              onblur="this.style.borderColor='transparent';OL._fvEditStageName('${stage.id}', this.innerText.trim())">
          ${esc(stage.name)}
        </span>
        <div style="display:flex;align-items:center;gap:4px;margin-left:auto;">
          <button onclick="OL._fvCreateWorkflow('${stage.id}')"
                  style="display:inline-flex;align-items:center;gap:4px;padding:4px 8px;
                         border-radius:6px;border:0.5px solid var(--panel-border);background:var(--panel-soft);
                         color:var(--text-dim);font-size:10px;cursor:pointer;">
            <i data-lucide="plus" style="width:10px;height:10px;"></i> Workflow
          </button>
          <button onclick="OL.addStageBetween(${si})"
                  style="display:inline-flex;align-items:center;gap:4px;padding:4px 8px;
                         border-radius:6px;border:0.5px solid var(--panel-border);background:var(--panel-soft);
                         color:var(--text-dim);font-size:10px;cursor:pointer;"
                  title="Add stage before">
            <i data-lucide="plus-circle" style="width:10px;height:10px;"></i>
          </button>
          <button onclick="OL._fvEditStageName('${stage.id}')"
                  style="display:inline-flex;align-items:center;gap:4px;padding:4px 8px;
                         border-radius:6px;border:0.5px solid var(--panel-border);background:var(--panel-soft);
                         color:var(--text-dim);font-size:10px;cursor:pointer;"
                  title="Rename stage">
            <i data-lucide="pencil" style="width:10px;height:10px;"></i>
          </button>
          <button onclick="OL._fvDeleteStage('${stage.id}')"
                  style="display:inline-flex;align-items:center;gap:4px;padding:4px 8px;
                         border-radius:6px;border:0.5px solid rgba(239,68,68,0.3);
                         background:rgba(239,68,68,0.06);
                         color:#ef4444;font-size:10px;cursor:pointer;"
                  title="Delete stage">
            <i data-lucide="trash-2" style="width:10px;height:10px;"></i>
          </button>
        </div>
      </div>
    `;

    // ── CANVAS: Workflow swimlanes ───────────────────────
    stageWorkflows.forEach((wf, wfi) => {
      if (filteredWfId && wf.id !== filteredWfId) return;
      const wfColor = wf.color || WF_COLORS[wfi % WF_COLORS.length];
      const wfRes   = (wf.resourceIds || [])
        .map(id => resources.find(r => String(r.id) === id))
        .filter(Boolean);

      // Build globals for this workflow's resources
      const wfGlobals = globalResources.filter(gr =>
        wfRes.some(r =>
          (r.steps||[]).some(step =>
            (step.logic?.out||[]).some(out => {
              const lastH = String(out.targetId||'').lastIndexOf('-');
              return lastH !== -1 && out.targetId.substring(0, lastH) === String(gr.id);
            })
          )
        )
      );

      const cardsHtml = wfRes.map((res, idx) => {
            globalCardNum++;
            return `
                <div class="fv-card-slot"
                     ondragover="event.preventDefault(); event.stopPropagation();
                                 this.classList.add('fv-insert-before');"
                     ondragleave="this.classList.remove('fv-insert-before')"
                     ondrop="this.classList.remove('fv-insert-before');
                             OL._fvDropAtIndex(event, '${stage.id}', '${wf.id}', ${idx});"
                     style="position:relative;">
                    ${OL._fvBuildCard(res, globalCardNum, false, 0)}
                </div>
            `;
        }).join('') + `
            <div class="fv-card-slot"
                 ondragover="event.preventDefault(); event.stopPropagation();
                             this.classList.add('fv-insert-before');"
                 ondragleave="this.classList.remove('fv-insert-before')"
                 ondrop="this.classList.remove('fv-insert-before');
                         OL._fvDropAtIndex(event, '${stage.id}', '${wf.id}', ${wfRes.length});"
                 style="position:relative;min-width:20px;min-height:80px;flex-shrink:0;">
            </div>
        `;

      const globalsHtml = expanded ? wfGlobals.map(gr => {
        globalCardNum++;
        return OL._fvBuildCard(gr, globalCardNum, true, globalStageCount[String(gr.id)] || 1);
      }).join('') : wfGlobals.map(gr => {
        const tc = OL._fvGetType(gr.type);
        const stageCount = globalStageCount[String(gr.id)] || 1;
        return `
          <div class="fv-global-chip"
               onclick="OL.openInspector('${gr.id}', null, 'cards')"
               title="${esc(gr.name)} — used in ${stageCount} workflow${stageCount !== 1 ? 's' : ''}">
            <div class="fv-global-chip-icon" style="background:${tc.color};">${tc.abbr}</div>
            <span>${esc(gr.name.substring(0, 20))}</span>
            <span class="fv-global-chip-count">×${stageCount}</span>
          </div>
        `;
      }).join('');

      lanesHtml += `
        <div class="fv-swimlane" id="fv-lane-${wf.id}"
             data-stage-id="${stage.id}"
             data-wf-id="${wf.id}"
             onclick="OL._fvHandleCanvasClick(event)"
             ondragover="OL._fvLaneDragOver(event)"
             ondragleave="OL._fvLaneDragLeave(event)"
             ondrop="OL._fvLaneDrop(event, '${stage.id}', '${wf.id}')">
            <div style="display:flex;align-items:center;gap:8px;width:100%;
                        margin-bottom:10px;padding-bottom:8px;
                        border-bottom:0.5px solid var(--line);">
                <div style="width:10px;height:10px;border-radius:50%;
                            background:${wfColor};flex-shrink:0;"></div>
                <span contenteditable="true"
                      style="font-size:11px;font-weight:500;color:var(--text-dim);outline:none;"
                      onblur="OL.renameWorkflow('${wf.id}', this.innerText.trim())">
                    ${esc(wf.name)}
                </span>
                <span style="font-size:10px;color:var(--text-muted);">
                    ${wfRes.length} resource${wfRes.length !== 1 ? 's' : ''}
                </span>
                <button class="fv-btn" style="margin-left:auto;font-size:9px;padding:2px 6px;"
                        onclick="event.stopPropagation(); OL._fvAddResourceToWorkflow('${wf.id}')">
                    <i data-lucide="plus" style="width:10px;height:10px;"></i> Add Resource
                </button>
                <button class="fv-btn" style="font-size:9px;padding:2px 6px;color:#ef4444;"
                        onclick="event.stopPropagation(); OL.deleteWorkflow('${wf.id}')">
                    <i data-lucide="trash-2" style="width:10px;height:10px;"></i>
                </button>
            </div>
            <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-start;">
                ${cardsHtml}
                ${globalsHtml}
            </div>
            ${(wfRes.length === 0 && wfGlobals.length === 0) ? `
                <div style="font-size:11px;color:var(--text-muted);font-style:italic;
                            border:1px dashed var(--panel-border);border-radius:8px;
                            text-align:center;padding:20px;
                            pointer-events:none;">
                    Drag resources here or click + Add
                </div>
            ` : ''}
        </div>
    `;
    });

    // ── CANVAS: Unassigned resources ─────────────────────
    if (unassignedRes.length > 0 && !filteredWfId) {
      lanesHtml += `
        <div class="fv-swimlane" id="fv-lane-unassigned-${stage.id}"
             data-stage-id="${stage.id}"
             style="opacity:0.7;"
             ondragover="OL._fvLaneDragOver(event)"
             ondragleave="OL._fvLaneDragLeave(event)"
             ondrop="OL._fvLaneDrop(event, '${stage.id}', null)">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
            <div style="width:8px;height:8px;border-radius:50%;
                        background:var(--text-muted);flex-shrink:0;"></div>
            <span style="font-size:11px;color:var(--text-muted);">Unassigned</span>
            <span style="font-size:10px;color:var(--line);">
              ${unassignedRes.length} resource${unassignedRes.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div style="display:flex;gap:10px;flex-wrap:wrap;">
            ${unassignedRes.map(res => {
              globalCardNum++;
              return OL._fvBuildCard(res, globalCardNum, false, 0);
            }).join('')}
          </div>
        </div>
      `;
    }
  });

  // ── ADD STAGE AT END ─────────────────────────────────
  const railCollapsed = OL._fv.railCollapsed;

  return `
    <div id="fv-lane-rail"
         style="width:${railCollapsed ? '32px' : '140px'};
                min-width:${railCollapsed ? '32px' : '140px'};
                transition:width 0.25s ease, min-width 0.25s ease;
                overflow:hidden;">
        ${railCollapsed ? `
            <div style="display:flex;flex-direction:column;align-items:center;
                        padding:8px 0;gap:4px;">
                <button onclick="OL._fv.railCollapsed=false;OL.renderVisualizer();"
                        style="width:24px;height:24px;border:none;
                               background:rgba(255,255,255,0.08);
                               border-radius:6px;cursor:pointer;
                               color:rgba(255,255,255,0.4);
                               display:flex;align-items:center;justify-content:center;
                               margin-bottom:6px;">
                    <i data-lucide="panel-left-open" style="width:13px;height:13px;"></i>
                </button>
                ${displayStages.flatMap(stage => {
                    const stageWorkflows = workflows.filter(w => w.stageId === stage.id);
                    return stageWorkflows.map((wf, wfi) => {
                        const wfColor = wf.color || WF_COLORS[wfi % WF_COLORS.length];
                        return `
                            <div title="${esc(wf.name)}"
                                 onclick="OL._fv.stageFilter='${wf.id}';OL._fv.railCollapsed=false;OL.renderVisualizer();"
                                 style="width:10px;height:10px;border-radius:50%;
                                        background:${wfColor};cursor:pointer;flex-shrink:0;
                                        transition:transform 0.15s;"
                                 onmouseover="this.style.transform='scale(1.4)'"
                                 onmouseout="this.style.transform='scale(1)'">
                            </div>
                        `;
                    });
                }).join('')}
                <div title="Unassigned"
                     style="width:8px;height:8px;border-radius:50%;
                            background:#6b7280;opacity:0.4;margin-top:4px;">
                </div>
            </div>
        ` : `
            ${railHtml}
            <div style="padding:8px 10px;">
                <button class="fv-lane-action-btn"
                        style="width:100%;justify-content:center;opacity:0.5;"
                        onclick="OL.addStageBetween(${displayStages.length})"
                        title="Add stage at end">
                    <i data-lucide="plus"></i>
                </button>
            </div>
        `}
    </div>
    <div id="fv-canvas-wrap"
         onclick="OL._fvHandleCanvasClick(event)">
        <div id="fv-canvas">
            <svg id="fv-svg-layer"></svg>
            <div id="fv-lanes-container">${lanesHtml}</div>
        </div>
    </div>
  `;
};

    OL._fvRailDragStart = function(e, type, id, parentId) {
    e.stopPropagation();
    e.dataTransfer.setData('fv-rail-type', type);
    e.dataTransfer.setData('fv-rail-id', id);
    if (parentId) e.dataTransfer.setData('fv-rail-parent', parentId);
    e.dataTransfer.effectAllowed = 'move';
};

export async function _fvDropAtIndex(e, targetStageId, targetWfId, targetIndex) {
    if (e) {
        e.preventDefault();
        e.stopPropagation();
    }

    const dragId = e.dataTransfer.getData('application/fv-resource') || e.dataTransfer.getData('text/plain');
    if (!dragId) return;

    const data = OL.getCurrentProjectData();
    const res = data.resources.find(r => String(r.id) === String(dragId));
    if (!res) return;

    // Grab the origin workflow context that we bundled during DragStart
    const sourceWfId = e.dataTransfer.getData('application/fv-context-wf') || OL._fv._draggingContextWfId;

    // 🎯 THE GLOBAL SAFETY SHIELD:
    if (res.isGlobal === true) {
        // 🌐 GLOBAL BLUEPRINT CLONE RULES:
        // Absolute zero root property mutations allowed. We don't touch res.workflowId.
        
        // 1. Remove the instance link from the old workflow array it was dragged out of
        if (sourceWfId && String(sourceWfId) !== String(targetWfId)) {
            const oldWf = (data.workflows || []).find(w => String(w.id) === String(sourceWfId));
            if (oldWf && oldWf.resourceIds) {
                oldWf.resourceIds = oldWf.resourceIds.filter(id => String(id) !== String(res.id));
            }
        }

        // 2. Inject it into the new workflow array index cleanly
        const targetWf = (data.workflows || []).find(w => String(w.id) === String(targetWfId));
        if (targetWf) {
            if (!targetWf.resourceIds) targetWf.resourceIds = [];
            
            // Remove it first if it somehow exists to prevent internal dupes in the same list
            targetWf.resourceIds = targetWf.resourceIds.filter(id => String(id) !== String(res.id));
            
            // Insert it precisely at the specific index it was dropped onto in the lane sequence!
            targetWf.resourceIds.splice(targetIndex, 0, String(res.id));
        }
        
        console.log(`🌐 Global instance safely spliced into Workflow ${targetWfId} at index ${targetIndex}`);
    } else {
        // 🏠 LOCAL ASSET behavior (Original Physical Move Logic)
        if (sourceWfId && String(sourceWfId) !== String(targetWfId)) {
            const oldWf = (data.workflows || []).find(w => String(w.id) === String(sourceWfId));
            if (oldWf && oldWf.resourceIds) {
                oldWf.resourceIds = oldWf.resourceIds.filter(id => String(id) !== String(res.id));
            }
        }

        // Standard local assignment shifts
        res.workflowId = targetWfId;
        res.stageId = targetStageId;

        const targetWf = (data.workflows || []).find(w => String(w.id) === String(targetWfId));
        if (targetWf) {
            if (!targetWf.resourceIds) targetWf.resourceIds = [];
            targetWf.resourceIds = targetWf.resourceIds.filter(id => String(id) !== String(res.id));
            targetWf.resourceIds.splice(targetIndex, 0, String(res.id));
        }
    }

    await OL.persist();
    OL.renderVisualizer();
};

export function _fvRailDrop(e, targetType, targetId, targetParentId) {
    e.preventDefault();
    e.stopPropagation();

    const type     = e.dataTransfer.getData('fv-rail-type');
    const dragId   = e.dataTransfer.getData('fv-rail-id');
    const parentId = e.dataTransfer.getData('fv-rail-parent');

    if (dragId === targetId) return;

    const data = OL.getCurrentProjectData();

    if (type === 'stage' && targetType === 'stage') {
        // Reorder stages
        const stages = data.stages;
        const fromIdx = stages.findIndex(s => s.id === dragId);
        const toIdx   = stages.findIndex(s => s.id === targetId);
        if (fromIdx === -1 || toIdx === -1) return;
        const [moved] = stages.splice(fromIdx, 1);
        stages.splice(toIdx, 0, moved);
    } 
    else if (type === 'workflow' && targetType === 'workflow') {
        // Reorder workflows within same stage
        if (parentId !== targetParentId) {
            // Move workflow to different stage
            const wf = data.workflows.find(w => w.id === dragId);
            if (wf) wf.stageId = targetParentId;
        }
        const workflows = data.workflows.filter(w => w.stageId === (targetParentId || parentId));
        const fromIdx = workflows.findIndex(w => w.id === dragId);
        const toIdx   = workflows.findIndex(w => w.id === targetId);
        if (fromIdx === -1 || toIdx === -1) return;
        // Apply reorder to the main array
        const allWfs = data.workflows;
        const fromGlobal = allWfs.findIndex(w => w.id === dragId);
        const toGlobal   = allWfs.findIndex(w => w.id === targetId);
        const [moved] = allWfs.splice(fromGlobal, 1);
        allWfs.splice(toGlobal, 0, moved);
    }

    OL.persist();
    OL.renderVisualizer();
};

export function _fvLaneDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    const lane = e.currentTarget;
    lane.style.background = 'rgba(61,217,197,0.06)';
    lane.style.outline = '2px dashed #3dd9c5';
    lane.style.outlineOffset = '-4px';
};

export function _fvLaneDragLeave(e) {
    e.stopPropagation();
    const lane = e.currentTarget;
    if (!lane.contains(e.relatedTarget)) {
        lane.style.background = '';
        lane.style.outline = '';
    }
};

export function _fvLaneDrop(event, stageId, wfId) {
    event.preventDefault();
    event.stopPropagation();

    // Clear highlights
    document.querySelectorAll('.fv-swimlane').forEach(el => {
        el.style.background = '';
        el.style.outline = '';
    });

    // Try both data keys — canvas cards use application/fv-resource,
    // workbench items also use application/fv-resource
    const resId = event.dataTransfer.getData('application/fv-resource') ||
                  event.dataTransfer.getData('text/plain');

    if (!resId) { console.warn('No resId in drop'); return; }

    const data = OL.getCurrentProjectData();
    const res  = (data.resources||[]).find(r => String(r.id) === String(resId));
    if (!res) { console.warn('Resource not found:', resId); return; }

    const wrap       = document.getElementById('fv-canvas-wrap');
    const scrollTop  = wrap?.scrollTop  || 0;
    const scrollLeft = wrap?.scrollLeft || 0;

    // Assign stage
    res.stageId = stageId;

    // Assign workflow
    if (wfId && wfId !== 'null') {
        OL.addResourceToWorkflow(wfId, resId);
    } else {
        // Dropped on unassigned — remove from any existing workflow
        const prevWf = (data.workflows||[]).find(w =>
            (w.resourceIds||[]).includes(String(resId))
        );
        if (prevWf) OL.removeResourceFromWorkflow(prevWf.id, resId);
    }

    OL.persist();
    OL.renderVisualizer();

    requestAnimationFrame(() => {
        const newWrap = document.getElementById('fv-canvas-wrap');
        if (newWrap) {
            newWrap.scrollTop  = scrollTop;
            newWrap.scrollLeft = scrollLeft;
        }
    });
};

export function _fvComputeLayout(resources, stageFilter) {
  const allSteps = [];
  const stepMap  = {};

  const workflows = OL.getWorkflows() || [];
  const orderedIds = workflows.flatMap(w => w.resourceIds || []);

  const sortedResources = [
    ...orderedIds
        .map(id => resources.find(r => String(r.id) === String(id)))
        .filter(Boolean),
    ...resources.filter(r => !orderedIds.map(String).includes(String(r.id)))
  ];

  sortedResources.forEach(res => {
    if (stageFilter && res.stageId !== stageFilter) return;
    (res.steps || []).forEach((step, idx) => {
      const fullId = `${res.id}-${step.id}`;
      const entry  = { step, res, fullId, col: -1, row: -1 };
      allSteps.push(entry);
      stepMap[fullId] = entry;
    });
  });
    
  if (allSteps.length === 0) return;

  // Build adjacency from logic.out
  const outEdges = {}; // fullId → [fullId]
  const inDegree = {}; // fullId → count
  allSteps.forEach(e => {
    outEdges[e.fullId] = [];
    inDegree[e.fullId] = 0;
  });

  allSteps.forEach(({ step, res }) => {
    const fromId = `${res.id}-${step.id}`;
    OL._fvGetEffectiveOut(step, res).forEach(out => {
      if (!out.targetId) return;
      const lastH = String(out.targetId).lastIndexOf('-');
      if (lastH === -1) return;
      const tResId  = out.targetId.substring(0, lastH);
      const tStepId = out.targetId.substring(lastH + 1);
      // Find matching step
      const toEntry = allSteps.find(e =>
        String(e.res.id) === String(tResId) &&
        String(e.step.id) === String(tStepId)
      );
      if (toEntry && outEdges[fromId]) {
        outEdges[fromId].push(toEntry.fullId);
        inDegree[toEntry.fullId] = (inDegree[toEntry.fullId] || 0) + 1;
      }
    });
  });

  // Kahn's algorithm — assign columns (depth layers)
  const queue = allSteps
    .filter(e => (inDegree[e.fullId] || 0) === 0)
    .map(e => ({ id: e.fullId, col: 0 }));

  const visited = new Set();
  while (queue.length > 0) {
    const { id, col } = queue.shift();
    if (visited.has(id)) continue;
    visited.add(id);
    const entry = stepMap[id];
    if (entry) entry.col = Math.max(entry.col, col);
    (outEdges[id] || []).forEach(toId => {
      queue.push({ id: toId, col: col + 1 });
    });
  }

  // Any steps not reached (disconnected) get their own columns
  // grouped by resource
  let maxCol = Math.max(...allSteps.map(e => e.col), 0);
  const resColMap = {};
  allSteps.forEach(e => {
    if (e.col === -1) {
      if (resColMap[e.res.id] === undefined) {
        resColMap[e.res.id] = ++maxCol;
      }
      e.col = resColMap[e.res.id];
    }
  });
    
  // Assign rows within each column
  const colRows = {};
  allSteps
      .sort((a, b) => {
          if (a.col !== b.col) return a.col - b.col;
          if (a.res.id !== b.res.id) return String(a.res.id).localeCompare(String(b.res.id));
          return (a.res.steps||[]).indexOf(a.step) - (b.res.steps||[]).indexOf(b.step);
      })
      .forEach(e => {
          const key = String(e.col);
          if (colRows[key] === undefined) colRows[key] = 0;
          e.row = colRows[key]++;
      });

  // Convert col/row to pixel coords
  const COL_W = 200; // horizontal spacing between columns
  const ROW_H = 200; // vertical spacing between rows
  const PAD_X = 60;
  const PAD_Y = 60;

  allSteps.forEach(({ step, col, row }) => {
    // Only update if not pinned
    if (!step.pinned) {
      step.coords = {
        x: PAD_X + col * COL_W,
        y: PAD_Y + row * ROW_H,
      };
    }
  });
};

export function getLucideSVG(name, size = 12, color = 'currentColor') {
    const icons = {
        'zap':        `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
        'file-text':  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>`,
        'mail':       `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>`,
        'calendar':   `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
        'book-open':  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>`,
        'pen-tool':   `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 19 7-7 3 3-7 7-3-3z"/><path d="m18 13-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="m2 2 7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>`,
        'folder':     `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,
        'table-2':    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/></svg>`,
        'link-2':     `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 7h3a5 5 0 0 1 5 5 5 5 0 0 1-5 5h-3m-6 0H6a5 5 0 0 1-5-5 5 5 0 0 1 5-5h3"/><line x1="8" y1="12" x2="16" y2="12"/></svg>`,
        'settings':   `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
        'globe':      `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
        'clipboard-list': `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><line x1="12" y1="11" x2="16" y2="11"/><line x1="12" y1="16" x2="16" y2="16"/><line x1="8" y1="11" x2="8.01" y2="11"/><line x1="8" y1="16" x2="8.01" y2="16"/></svg>`,
        'chevron-up':   `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>`,
        'chevron-down': `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`,
        'user':         `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
        'users':        `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
        'smartphone':   `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>`,
        'target':       `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>`,
        'database':     `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>`,
        'archive':      `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>`,
        'corner-right-up': `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="10 9 15 4 20 9"/><path d="M4 20h7a4 4 0 0 0 4-4V4"/></svg>`,
        'circle-dollar-sign': `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 18V6"/></svg>`,
    };
    return icons[name] || icons['settings'];
};

// ── CARD BUILDER (shared between regular + expanded globals) ──
export function _fvBuildCard(res, num, isGlobal, globalStageCount) {
  const tc = OL._fvGetType(res.type);
  const stepCount = (res.steps || []).length;
  const hasLogic = (res.steps || []).some(s => (s.logic?.out || []).some(l => l.targetId));
  const isExpanded = OL._fv.stepsExpanded || OL._fv._expandedCards?.has(res.id);
    
  const tags = (res.steps || []).slice(0, 2)
    .map(s => `<span class="fv-card-tag">${esc((s.name||'').substring(0,16))}</span>`)
    .join('');
    
  const relTypeConfig = {
    triggers:   '#f59e0b',
    requires:   '#38bdf8',
    produces:   '#10b981',
    references: '#a78bfa',
  };

  const linkedAssets = (res.steps || [])
    .flatMap(s => s.links || [])
    .filter((l, i, arr) => arr.findIndex(x => x.id === l.id) === i);

  const assetIconsHtml = linkedAssets.length > 0 ? `
    <div style="display:flex; gap:4px; flex-wrap:wrap; margin-top:6px;">
        ${linkedAssets.map(link => {
            const color = relTypeConfig[link.relType] || 'var(--accent)';
            return `
                <div title="${esc(link.relType ? link.relType + ': ' : '')}${esc(link.name)}"
                     onclick="event.stopPropagation(); OL.openInspector('${link.id}', null, 'cards')"
                     style="width:22px; height:22px; border-radius:4px; cursor:pointer;
                            background:${color}18; border:1px solid ${color}44;
                            display:flex; align-items:center; justify-content:center;
                            transition:all 0.15s;"
                     onmouseover="this.style.borderColor='${color}'; this.style.background='${color}30';"
                     onmouseout="this.style.borderColor='${color}44'; this.style.background='${color}18';">
                    ${OL.getLucideSVG(OL.getRegistryIcon(link.type), 12, color)}
                </div>
            `;
        }).join('')}
    </div>
  ` : '';
    
  const logicTypes = new Set((res.steps || []).flatMap(s => 
    (s.logic?.out || []).filter(l => l.targetId).map(l => l.type || 'next')
  ));
  const logicBadge = logicTypes.size === 0 ? '' :
    logicTypes.has('loop')      ? '↺' :
    logicTypes.has('delay')     ? '⏱' :
    logicTypes.has('condition') ? '◆' :
    logicTypes.size > 0          ? '→' : '';

  const stepsPreview = (isExpanded && stepCount > 0) ? `
    <div class="fv-card-steps-preview">
      ${(res.steps || []).map((s, i) => {
        const appLabel  = s.appName
          ? `<span class="fv-card-step-app">${esc(s.appName.substring(0,10))}</span>`
          : '';
        const stepOut = (s.logic?.out || []).filter(l => l.targetId);
        const stepLogicIcon = stepOut.length === 0 ? '' :
            stepOut.some(l => l.type === 'loop')      ? '↺' :
            stepOut.some(l => l.type === 'delay')     ? '⏱' :
            stepOut.some(l => l.type === 'condition') ? '◆' :
            stepOut.length > 1                         ? '◆' : '→';
        const logicIcon = stepLogicIcon 
          ? `<span style="color:var(--accent);font-size:9px;font-weight:700;">${stepLogicIcon}</span>` 
          : '';
        return `
          <div class="fv-card-step-row"
               onclick="event.stopPropagation(); OL.openInspector('${res.id}','${s.id}');">
            <span class="fv-card-step-num-sm">${i+1}</span>
            <span class="fv-card-step-name">${esc(s.name || 'Unnamed')}</span>
            ${appLabel}
            ${logicIcon}
          </div>
        `;
      }).join('')}
    </div>
  ` : '';

  const scopeData = OL.isResourceInScope(res.id);
  const scopeColors = {
      'Do Now':    '#38bdf8',
      'Done':      '#22c55e', 
      'Do Later':  '#fbbf24',
      "Don't Do":  '#ef4444'
  };
  const scopeColor = scopeData ? (scopeColors[scopeData.status] || 'var(--accent)') : null;

  const renderAsGlobalCard = isGlobal === true || res.isGlobal === true;
    
  return `
    <div class="fv-card ${renderAsGlobalCard ? 'is-global' : ''}"
         id="fv-card-${res.id}-${res.workflowId || 'unassigned'}"
         data-res-id="${res.id}"
         data-stage-id="${res.stageId || '__none__'}"
         data-workflow-id="${res.workflowId || ''}"
         draggable="true"
         ondragstart="OL._fvCardDragStart(event, '${res.id}')"
         ondragend="OL._fvCardDragEnd(event)"
         onclick="event.stopPropagation();
                  document.querySelectorAll('.fv-card.selected').forEach(e=>e.classList.remove('selected'));
                  this.classList.add('selected');
                  OL._fvOpenStepsList('${res.id}');">

      <div class="fv-card-accent" style="background:${tc.color};"></div>

      <div class="fv-card-body">
        <div class="fv-card-type-row">
          <div class="fv-card-type-icon" style="background:${tc.color};">
                ${OL.getLucideSVG(OL.getRegistryIcon(res.type), 11, 'var(--panel)')}
            </div>
          <span class="fv-card-type-label" style="color:${tc.color};">${esc(res.type||'General')}</span>
          <span class="fv-card-step-num">${num}</span>
        </div>
        <div class="fv-card-name">${esc(res.name)}</div>
        ${tags ? `<div class="fv-card-tags" style="margin-bottom:4px;">${tags}</div>` : ''}
        ${assetIconsHtml}
      </div>

      <div class="fv-card-footer">
            <span class="fv-step-count-btn"
                  onclick="event.stopPropagation(); OL._fvToggleCardSteps('${res.id}');"
                  title="Toggle steps">
                ${OL.getLucideSVG(isExpanded ? 'chevron-up' : 'chevron-down', 10, 'currentColor')}
                ${stepCount} step${stepCount!==1?'s':''}
            </span>
            <div style="display:flex;gap:4px;align-items:center;">
                ${scopeColor ? `
                    <div title="${esc(scopeData.status)} · ${esc(scopeData.responsibleParty || 'TBD')}"
                         onclick="event.stopPropagation(); 
                                  state.scopingFilterActive = true; 
                                  state.scopingTargetId = '${res.id}';
                                  window.location.hash = '#/scoping-sheet';"
                         style="display:flex; align-items:center; justify-content:center;
                                width:18px; height:18px; border-radius:4px; cursor:pointer;
                                background:${scopeColor}18; border:1px solid ${scopeColor}44;
                                transition:all 0.15s;"
                         onmouseover="this.style.borderColor='${scopeColor}'; this.style.background='${scopeColor}30';"
                         onmouseout="this.style.borderColor='${scopeColor}44'; this.style.background='${scopeColor}18';">
                        ${OL.getLucideSVG('circle-dollar-sign', 10, scopeColor)}
                    </div>
                ` : ''}
                ${renderAsGlobalCard ? `<span class="fv-global-card-badge">🌐 ×${globalStageCount}</span>` : ''}
                    <button onclick="event.stopPropagation();
                                     OL.handleResourceSave('${res.id}','isGlobal',${!renderAsGlobalCard});
                                     OL.renderVisualizer();"
                            title="${renderAsGlobalCard ? 'Remove global' : 'Set as global'}"
                            style="width:18px;height:18px;border:none;background:none;cursor:pointer;
                                   display:flex;align-items:center;justify-content:center;border-radius:4px;
                                   color:${renderAsGlobalCard ? '#7c3aed' : 'var(--text-muted)'};transition:color 0.15s;"
                            onmouseover="this.style.color='#7c3aed'"
                            onmouseout="this.style.color='${renderAsGlobalCard ? '#7c3aed' : '#d1d5db'}'">
                        ${OL.getLucideSVG('globe', 10, renderAsGlobalCard ? '#7c3aed' : 'var(--text-muted)')}
                    </button>
                ${logicBadge ? `
                    <span style="font-size:9px;padding:2px 5px;border-radius:99px;
                                 background:var(--accent-glow);color:var(--accent);
                                 font-weight:700;">${logicBadge}</span>
                ` : ''}
            </div>
        </div>
      ${stepsPreview}
    </div>
  `;
};

export function _fvCardDragStart(e, resId) {
    if (!e || !e.dataTransfer) return;

    // 🎯 Captures the exact, unique card element instance sitting under your mouse cursor
    const cardElement = e.target.closest('.fv-card');
    
    // Read the true workflow lane context string straight out of the HTML dataset we stamped
    const contextWfId = cardElement ? (cardElement.getAttribute('data-workflow-id') || '') : '';

    // Bind data layers to the drag event payload securely
    e.dataTransfer.clearData();
    e.dataTransfer.setData('text/plain', String(resId));
    e.dataTransfer.setData('application/fv-resource', String(resId));
    e.dataTransfer.setData('application/fv-source', 'canvas'); 
    
    // 🚀 THE FIX: This transfers the correct container context to the workbench drop area cleanly!
    e.dataTransfer.setData('application/fv-context-wf', String(contextWfId));
    e.dataTransfer.effectAllowed = 'move';

    // Apply visual fade classes targeting the correct clicked instance copy
    requestAnimationFrame(() => {
        if (cardElement) cardElement.classList.add('fv-dragging');
    });

    OL._fv._draggingResId = resId;
    OL._fv._draggingContextWfId = contextWfId;
    console.log(`🧲 Drag started for resource ${resId} out of lane context: "${contextWfId}"`);
};

export function _fvCardDragEnd(e) {
    // 🎯 THE FIX: Query via class selectors so it doesn't crash on multi-instance global cards!
    document.querySelectorAll('.fv-card.fv-dragging').forEach(el => {
        el.classList.remove('fv-dragging');
    });

    OL._fv._draggingResId = null;
    OL._fv._draggingContextWfId = null;

    // Clear all swimlane tracking styles safely
    document.querySelectorAll('.fv-swimlane').forEach(el => {
        if (el && el.style) {
            el.style.background = '';
            el.style.outline = '';
        }
    });
};

export function _fvToggleCardSteps(resId) {
  if (!OL._fv._expandedCards) OL._fv._expandedCards = new Set();

  if (OL._fv._expandedCards.has(resId)) {
    OL._fv._expandedCards.delete(resId);
  } else {
    OL._fv._expandedCards.add(resId);
  }

  // Surgical re-render of just this card
  const data = OL.getCurrentProjectData();
  const resources = (data.resources || []).filter(r => !r.isDeleted && !r.isLocked  && (OL._fv.showArchived || !r.isArchived));
  const res = resources.find(r => String(r.id) === resId);
  if (!res) return;

  const cardEl = document.getElementById(`fv-card-${resId}`);
  if (!cardEl) return;

  const isExpanded = OL._fv._expandedCards.has(resId);
  const tc = OL._fvGetType(res.type);

  // Just update the steps preview section
  let preview = cardEl.querySelector('.fv-card-steps-preview');
  if (isExpanded && (res.steps || []).length > 0) {
    if (!preview) {
      preview = document.createElement('div');
      preview.className = 'fv-card-steps-preview';
      cardEl.querySelector('.fv-card-body').appendChild(preview);
    }
    preview.innerHTML = (res.steps || []).map((s, i) => {
      const appLabel  = s.appName ? `<span class="fv-card-step-app">${esc(s.appName.substring(0,10))}</span>` : '';
      const logicIcon = (s.logic?.out||[]).some(l=>l.targetId)
        ? `<span style="color:#3dd9c5;font-size:9px;font-weight:700;">λ</span>` : '';
      return `
        <div class="fv-card-step-row"
             onclick="event.stopPropagation(); OL.openInspector('${res.id}','${s.id}');">
          <span class="fv-card-step-num-sm">${i+1}</span>
          <span class="fv-card-step-name">${esc(s.name||'Unnamed')}</span>
          ${appLabel}${logicIcon}
        </div>
      `;
    }).join('');
  } else if (preview) {
    preview.remove();
  }

  // Update chevron
  const countBtn = cardEl.querySelector('.fv-step-count-btn');
  if (countBtn) {
    const icon = countBtn.querySelector('i');
    if (icon) {
      icon.setAttribute('data-lucide', isExpanded ? 'chevron-up' : 'chevron-down');
      if (window.lucide) lucide.createIcons();
    }
  }

  // Re-sync rail heights since card height changed
  OL._fvSyncRailHeights();
};

export function _fvRenderSteps(resources) {
  const canvas    = document.getElementById('fv-content');
  const svg       = document.getElementById('fv-svg-layer');
  const data      = OL.getCurrentProjectData();
  const stages    = data.stages || [];
  const wfAll     = OL.getWorkflows() || [];
  const STEP_GAP  = 14;

  if (!canvas || !svg) return;
  canvas.innerHTML = '';

  // Persist which consolidated cards are open across re-renders
  if (!OL._fv.expandedGroups) OL._fv.expandedGroups = new Set();

  const stageFilter = OL._fv.stageFilter || '';

  // ── Stage → Workflow → Resources (unassigned resources not shown) ────────────
  const stageGroups = [];
  stages.forEach(stage => {
    if (stageFilter && String(stage.id) !== String(stageFilter)) return;
    const stageWfs = wfAll.filter(w => String(w.stageId) === String(stage.id));
    const wfGroups = [];
    stageWfs.forEach(wf => {
      const wfRes = (wf.resourceIds || [])
        .map(id => resources.find(r => String(r.id) === String(id)))
        .filter(r => r && !r.isGlobal && (r.steps || []).length > 0);
      if (wfRes.length > 0) wfGroups.push({ workflow: wf, resources: wfRes });
    });
    if (wfGroups.length > 0) stageGroups.push({ stage, wfGroups });
  });

  OL._fvAutoLinkSteps(resources);

  const CARD_W    = 180;
  const COL_GAP   = 52;
  const ZONE_PAD  = 20;
  const ZONE_HDR  = 22;   // stage label height
  const WF_PAD    = 14;   // padding inside workflow sub-zone
  const WF_HDR    = 26;   // workflow sub-zone label height
  const RES_HDR   = 28;   // resource column header height
  const STAGE_GAP = 48;
  const WF_GAP    = 20;
  const PAD_X     = 48;
  const PAD_Y     = 36;
  const EST_STEP  = 100;
  const CONSOL_H  = 44;   // estimated collapsed consolidated card height

  const allActiveResources = [];
  const stageMeta = [];
  let currentY = PAD_Y;

  // ── Helper: build merged flow sequence for a workflow group ──────────────────
  // Returns [{type:'columns', sections:[{res,steps:[]}]}, {type:'consolidated', groupName, members:[{res,step}]}, ...]
  function buildMergedFlow(wfRes) {
    // Find consolidated groups (stepGroup appearing in >1 resource)
    const groupMap = {};
    wfRes.forEach(res => {
      (res.steps || []).forEach(step => {
        if (!step.stepGroup) return;
        if (!groupMap[step.stepGroup]) groupMap[step.stepGroup] = [];
        groupMap[step.stepGroup].push({ res, step });
      });
    });
    const consolidatedGroups = {};
    Object.entries(groupMap).forEach(([g, members]) => {
      if (members.length > 1) consolidatedGroups[g] = members;
    });
    const consolidatedIds = new Set(
      Object.values(consolidatedGroups).flat().map(m => String(m.step.id))
    );

    if (Object.keys(consolidatedGroups).length === 0) {
      // No consolidation — single columns section
      return {
        consolidatedGroups,
        sequence: [{ type: 'columns', sections: wfRes.map(res => ({ res, steps: res.steps || [] })) }]
      };
    }

    // Build per-resource annotated flow
    const perResFlow = wfRes.map(res => {
      const flow = [];
      const seenGroups = new Set();
      (res.steps || []).forEach(step => {
        if (consolidatedIds.has(String(step.id))) {
          const g = Object.entries(consolidatedGroups).find(([, ms]) =>
            ms.some(m => String(m.step.id) === String(step.id))
          )?.[0];
          if (g && !seenGroups.has(g)) { seenGroups.add(g); flow.push({ type: 'consolidated', group: g }); }
        } else {
          flow.push({ type: 'step', step });
        }
      });
      return flow;
    });

    // Determine group ordering by min position across resources
    const groupOrder = Object.keys(consolidatedGroups).sort((a, b) => {
      const posA = Math.min(...perResFlow.map(f => { const i = f.findIndex(x => x.type === 'consolidated' && x.group === a); return i === -1 ? Infinity : i; }));
      const posB = Math.min(...perResFlow.map(f => { const i = f.findIndex(x => x.type === 'consolidated' && x.group === b); return i === -1 ? Infinity : i; }));
      return posA - posB;
    });

    // Build merged sequence
    const sequence = [];
    const ptrs = wfRes.map(() => 0);

    groupOrder.forEach(group => {
      // Collect steps before this group from each resource
      const sections = wfRes.map((res, ri) => {
        const steps = [];
        while (ptrs[ri] < perResFlow[ri].length &&
               !(perResFlow[ri][ptrs[ri]].type === 'consolidated' && perResFlow[ri][ptrs[ri]].group === group)) {
          if (perResFlow[ri][ptrs[ri]].type === 'step') steps.push(perResFlow[ri][ptrs[ri]].step);
          ptrs[ri]++;
        }
        if (ptrs[ri] < perResFlow[ri].length) ptrs[ri]++; // skip the group marker
        return { res, steps };
      });
      if (sections.some(s => s.steps.length > 0)) sequence.push({ type: 'columns', sections });
      sequence.push({ type: 'consolidated', groupName: group, members: consolidatedGroups[group] });
    });

    // Remaining steps after last group
    const trailing = wfRes.map((res, ri) => {
      const steps = [];
      while (ptrs[ri] < perResFlow[ri].length) {
        if (perResFlow[ri][ptrs[ri]].type === 'step') steps.push(perResFlow[ri][ptrs[ri]].step);
        ptrs[ri]++;
      }
      return { res, steps };
    });
    if (trailing.some(s => s.steps.length > 0)) sequence.push({ type: 'columns', sections: trailing });

    return { consolidatedGroups, sequence };
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  stageGroups.forEach(({ stage, wfGroups }) => {
    const stageTop = currentY;
    let stageBgEl = null, stageLblEl = null;

    if (stage) {
      stageBgEl = document.createElement('div');
      stageBgEl.style.cssText = `position:absolute;left:${PAD_X - 16}px;top:${stageTop}px;
        width:200px;height:100px;border-radius:14px;
        background:rgba(255,255,255,0.016);border:1px solid rgba(255,255,255,0.05);
        pointer-events:none;`;
      canvas.appendChild(stageBgEl);

      stageLblEl = document.createElement('div');
      stageLblEl.style.cssText = `position:absolute;left:${PAD_X}px;top:${stageTop + 10}px;
        font-size:8px;font-weight:800;letter-spacing:0.11em;text-transform:uppercase;
        color:var(--text-muted);opacity:0.4;white-space:nowrap;overflow:hidden;
        text-overflow:ellipsis;max-width:260px;cursor:default;`;
      stageLblEl.textContent = stage.name;
      stageLblEl.title = stage.name;
      canvas.appendChild(stageLblEl);
    }

    const stageContentTop = stageTop + ZONE_PAD + (stage ? ZONE_HDR : 0);
    let wfY = stageContentTop;
    const wfMetaList = [];

    wfGroups.forEach(({ workflow, resources: wfRes }) => {
      const { sequence } = buildMergedFlow(wfRes);

      // Compute x positions for each resource
      const resLayouts = new Map();
      const resBaseX   = new Map();
      let cumX = PAD_X;
      wfRes.forEach(r => {
        const rLayout = OL._fvLayoutResource(r);
        resLayouts.set(r, rLayout);
        resBaseX.set(r, cumX);
        const maxOff = Math.max(0, ...Object.values(rLayout).map(l => l.colOffset));
        cumX += (1 + maxOff) * (CARD_W + COL_GAP);
      });
      const wfWidth = Math.max(cumX - PAD_X - COL_GAP + 28, 60);
      const wfRight = PAD_X + wfWidth;

      // Workflow sub-zone background
      const wfBgEl = document.createElement('div');
      wfBgEl.style.cssText = `position:absolute;left:${PAD_X - 10}px;top:${wfY}px;
        width:${wfWidth + 4}px;height:100px;border-radius:10px;
        background:rgba(255,255,255,0.01);border:1px solid rgba(255,255,255,0.038);
        pointer-events:none;`;
      canvas.appendChild(wfBgEl);

      const wfLblEl = document.createElement('div');
      wfLblEl.style.cssText = `position:absolute;left:${PAD_X}px;top:${wfY + 9}px;
        font-size:9px;font-weight:700;letter-spacing:0.07em;text-transform:uppercase;
        color:var(--accent);opacity:0.55;white-space:nowrap;overflow:hidden;
        text-overflow:ellipsis;max-width:${wfWidth - 10}px;cursor:default;`;
      wfLblEl.textContent = workflow.name;
      wfLblEl.title = workflow.name;
      canvas.appendChild(wfLblEl);

      const wfContentTop = wfY + WF_PAD + WF_HDR;

      // Resource headers
      const resMeta = [];
      wfRes.forEach(res => {
        allActiveResources.push(res);
        const tc   = OL._fvGetType(res.type);
        const colX = resBaseX.get(res);
        const hdrEl = document.createElement('div');
        hdrEl.style.cssText = `position:absolute;left:${colX}px;top:${wfContentTop + 2}px;
          width:${CARD_W}px;display:flex;align-items:center;gap:5px;`;
        hdrEl.innerHTML = `
          <div style="width:7px;height:7px;border-radius:50%;background:${tc.color};flex-shrink:0;"></div>
          <span title="${esc(res.name)}"
                style="font-size:10px;font-weight:700;color:${tc.color};text-transform:uppercase;
                       letter-spacing:0.06em;white-space:nowrap;overflow:hidden;
                       text-overflow:ellipsis;max-width:${CARD_W - 20}px;">${esc(res.name)}</span>`;
        canvas.appendChild(hdrEl);
        resMeta.push({ res, hdrEl, layout: resLayouts.get(res), colX });
      });

      const colY0 = wfContentTop + RES_HDR;

      // Render each sequence item
      const seqMeta = []; // for measurement pass
      let estY = colY0;

      sequence.forEach((item, seqIdx) => {
        if (item.type === 'columns') {
          const sectionCards = [];
          item.sections.forEach(({ res, steps }) => {
            const tc     = OL._fvGetType(res.type);
            const layout = resLayouts.get(res);
            const colX   = resBaseX.get(res);
            steps.forEach((step, idx) => {
              const li = layout[step.id] || { colOffset: 0, row: idx };
              const x  = colX + li.colOffset * (CARD_W + COL_GAP);
              const y  = estY + idx * (EST_STEP + STEP_GAP);
              step.coords = { x, y };

              const appBadge = step.appName
                ? `<span class="fv-step-badge" style="background:var(--accent-glow);color:var(--accent);">${esc(step.appName.substring(0,12))}</span>`
                : '';
              const assigneeBadges = (step.assignees || []).slice(0, 2).map(a =>
                `<span class="fv-step-badge" style="background:rgba(255,255,255,0.06);color:var(--text-dim);">${esc((a.name||'').substring(0,12))}</span>`
              ).join('');
              const groupTag = step.stepGroup
                ? `<span class="fv-step-group-tag">${esc(step.stepGroup)}</span>`
                : '';

              const div = document.createElement('div');
              div.className = 'fv-step-card';
              div.id = `fv-step-${res.id}-${step.id}`;
              div.dataset.resId  = res.id;
              div.dataset.stepId = step.id;
              div.style.left = x + 'px';
              div.style.top  = y + 'px';
              div.innerHTML = `
                <button class="fv-pin-btn ${step.pinned?'pinned':''}" title="${step.pinned?'Unpin':'Pin'}"
                        onclick="event.stopPropagation();OL._fvTogglePin('${res.id}','${step.id}')">
                  ${OL.getLucideSVG(step.pinned?'pin':'pin-off',10,'currentColor')}
                </button>
                <div class="fv-step-card-accent" style="background:${tc.color};"></div>
                <div class="fv-step-card-body" onclick="event.stopPropagation();OL._fvSelectStep('${res.id}','${step.id}')">
                  <div style="display:flex;align-items:flex-start;gap:7px;">
                    <span style="flex-shrink:0;width:18px;height:18px;border-radius:50%;
                                 background:${tc.color}22;color:${tc.color};border:1px solid ${tc.color}44;
                                 font-size:9px;font-weight:800;display:flex;
                                 align-items:center;justify-content:center;margin-top:1px;">${idx+1}</span>
                    <div style="min-width:0;flex:1;">
                      <div class="fv-step-name">${esc(step.name||'Unnamed Step')}</div>
                      <div class="fv-step-badges" style="margin-top:4px;">${appBadge}${assigneeBadges}${groupTag}</div>
                    </div>
                  </div>
                </div>
                <div class="fv-port fv-port-top"    id="port-top-${res.id}-${step.id}"
                     onmousedown="event.stopPropagation();OL._fvStartConnection(event,'${res.id}','${step.id}','top')"></div>
                <div class="fv-port fv-port-bottom" id="port-bottom-${res.id}-${step.id}"
                     onmousedown="event.stopPropagation();OL._fvStartConnection(event,'${res.id}','${step.id}','bottom')"></div>
                <div class="fv-port fv-port-left"   id="port-left-${res.id}-${step.id}"
                     onmousedown="event.stopPropagation();OL._fvStartConnection(event,'${res.id}','${step.id}','left')"></div>
                <div class="fv-port fv-port-right"  id="port-right-${res.id}-${step.id}"
                     onmousedown="event.stopPropagation();OL._fvStartConnection(event,'${res.id}','${step.id}','right')"></div>`;
              OL._fvSetupCardDrag(div, res.id, step.id);
              canvas.appendChild(div);
              sectionCards.push({ res, step, el: div, idx });
            });
          });
          const estH = Math.max(...item.sections.map(s => s.steps.length), 1) * (EST_STEP + STEP_GAP);
          seqMeta.push({ type: 'columns', sectionCards, estH });
          estY += estH;

        } else if (item.type === 'consolidated') {
          const { groupName, members } = item;
          // Center a standard-width card under the member resource columns
          const memberResources = [...new Set(members.map(m => m.res))];
          const memberXs = memberResources.map(r => resBaseX.get(r)).filter(x => x !== undefined);
          const spanLeft  = memberXs.length ? Math.min(...memberXs) : PAD_X;
          const spanRight = memberXs.length ? Math.max(...memberXs) + CARD_W : PAD_X + wfWidth;
          const consolCenterX = (spanLeft + spanRight) / 2;
          const cardW   = CARD_W;
          const cardX   = Math.round(consolCenterX - cardW / 2);
          const cardY   = estY;

          // Use first member's type color and step name — all members share the same step
          const consolTc   = OL._fvGetType(members[0].res.type);
          const consolName = members[0].step.name || 'Unnamed Step';
          const consolApp  = members[0].step.appName || '';

          const consolEl = document.createElement('div');
          consolEl.className = 'fv-step-card';
          consolEl.id = `fv-consol-${String(groupName).replace(/\W+/g,'-')}`;
          consolEl.style.cssText = `left:${cardX}px;top:${cardY}px;width:${cardW}px;`;
          const isExpanded = OL._fv.expandedGroups.has(groupName);
          consolEl.innerHTML = `
            <div class="fv-step-card-accent" style="background:${consolTc.color};"></div>
            <div class="fv-step-card-body fv-consol-header" data-group="${esc(groupName)}"
                 onclick="OL._fvToggleConsolidated(this)" style="cursor:pointer;">
              <div style="display:flex;align-items:flex-start;gap:7px;">
                <span style="flex-shrink:0;width:18px;height:18px;border-radius:50%;
                             background:${consolTc.color}22;color:${consolTc.color};
                             border:1px solid ${consolTc.color}44;
                             font-size:9px;display:flex;align-items:center;
                             justify-content:center;margin-top:1px;">
                  ${OL.getLucideSVG('git-merge',9,'currentColor')}
                </span>
                <div style="min-width:0;flex:1;">
                  <div class="fv-step-name">${esc(consolName)}</div>
                  <div class="fv-step-badges" style="margin-top:4px;">
                    ${consolApp ? `<span class="fv-step-badge" style="background:var(--accent-glow);color:var(--accent);">${esc(consolApp.substring(0,12))}</span>` : ''}
                    <span class="fv-step-badge" style="background:${consolTc.color}22;color:${consolTc.color};">×${members.length}</span>
                    ${OL.getLucideSVG(isExpanded ? 'chevron-up' : 'chevron-down',10,'var(--text-muted)')}
                  </div>
                </div>
              </div>
            </div>
            <div class="fv-consol-body" style="display:${isExpanded ? 'flex' : 'none'};">
              ${members.map(m => {
                const tc = OL._fvGetType(m.res.type);
                const appBadge = m.step.appName
                  ? `<span class="fv-step-badge" style="background:var(--accent-glow);color:var(--accent);margin-top:4px;">${esc(m.step.appName.substring(0,14))}</span>`
                  : '';
                return `<div class="fv-consol-instance" style="cursor:pointer;"
                            onclick="event.stopPropagation();OL._fvSelectStep('${m.res.id}','${m.step.id}')">
                  <div style="font-size:9px;font-weight:700;color:${tc.color};text-transform:uppercase;letter-spacing:0.04em;margin-bottom:3px;">${esc(m.res.name)}</div>
                  <div style="font-size:11px;color:var(--text-main);line-height:1.3;">${esc(m.step.name||'Unnamed Step')}</div>
                  ${appBadge}
                </div>`;
              }).join('')}
            </div>`;
          canvas.appendChild(consolEl);

          // Invisible anchor divs so _fvDrawStepConnections can find consolidated member steps.
          // data-consol-card-id lets drawConnections use the real card rect when this is the SOURCE.
          const consolAnchors = [];
          members.forEach(m => {
            const anchor = document.createElement('div');
            anchor.id = `fv-step-${m.res.id}-${m.step.id}`;
            anchor.dataset.consolCardId = consolEl.id;
            anchor.style.cssText = `position:absolute;left:${Math.round(consolCenterX - 1)}px;top:${cardY}px;width:2px;height:1px;pointer-events:none;opacity:0;`;
            canvas.appendChild(anchor);
            consolAnchors.push(anchor);
          });

          members.forEach(m => { m.step.coords = { x: cardX, y: cardY }; });
          seqMeta.push({ type: 'consolidated', el: consolEl, members, cardX, cardW, consolCenterX, estH: CONSOL_H, anchors: consolAnchors });
          estY += CONSOL_H + STEP_GAP;
        }
      });

      const estWfH = WF_PAD + WF_HDR + RES_HDR + estY - colY0 + WF_PAD;
      wfMetaList.push({ wfBgEl, wfLblEl, resMeta, seqMeta, wfContentTop, colY0, wfWidth });
      wfY += estWfH + WF_GAP;
    });

    stageMeta.push({ stageBgEl, stageLblEl, stage, stageTop, wfMetaList });
    currentY = wfY + STAGE_GAP;
  });

  // ── Measurement pass ─────────────────────────────────────────────────────────
  requestAnimationFrame(() => {
    let curStageY = PAD_Y;

    stageMeta.forEach(({ stageBgEl, stageLblEl, stage, stageTop, wfMetaList }) => {
      if (stageLblEl) stageLblEl.style.top = (curStageY + 10) + 'px';
      if (stageBgEl)  stageBgEl.style.top  = curStageY + 'px';

      let wfY = curStageY + ZONE_PAD + (stage ? ZONE_HDR : 0);
      let stageBottom = wfY;

      wfMetaList.forEach(({ wfBgEl, wfLblEl, resMeta, seqMeta, wfContentTop, colY0, wfWidth }) => {
        const wfTop     = wfY;
        const actualColY = wfTop + WF_PAD + WF_HDR + RES_HDR;

        if (wfLblEl) wfLblEl.style.top = (wfTop + 9) + 'px';
        if (wfBgEl)  wfBgEl.style.top  = wfTop + 'px';
        resMeta.forEach(({ hdrEl }) => { hdrEl.style.top = (wfTop + WF_PAD + WF_HDR + 2) + 'px'; });

        let y = actualColY;
        let wfBottom = actualColY;

        seqMeta.forEach(item => {
          if (item.type === 'columns') {
            // Group cards by resource
            const byRes = new Map();
            item.sectionCards.forEach(sc => {
              if (!byRes.has(sc.res)) byRes.set(sc.res, []);
              byRes.get(sc.res).push(sc);
            });

            // Build lookup: 'resId-stepId' → card, for steps in this section only
            const cardByKey = new Map();
            item.sectionCards.forEach(sc => {
              cardByKey.set(`${sc.res.id}-${sc.step.id}`, sc);
            });

            // Pass 1: compute natural (independent) Y for each card via simple stacking
            const naturalTopY = new Map(); // el → top Y from simple stacking
            byRes.forEach(cards => {
              let ry = y;
              cards.forEach(({ el }) => { naturalTopY.set(el, ry); ry += el.offsetHeight + STEP_GAP; });
            });

            // Pass 2: for each cross-resource outbound link within this section,
            // record the minimum Y (source bottom) the target card must sit at
            const minY = new Map(); // el → minimum allowed top Y
            item.sectionCards.forEach(sc => {
              (sc.step.logic?.out || []).forEach(link => {
                if (!link.targetId || link._implicit) return;
                const targetCard = cardByKey.get(String(link.targetId));
                if (!targetCard || targetCard.res === sc.res) return; // same resource, skip
                const srcBottom = naturalTopY.get(sc.el) + sc.el.offsetHeight;
                const prev = minY.get(targetCard.el) || 0;
                minY.set(targetCard.el, Math.max(prev, srcBottom));
              });
            });

            // Pass 3: position each column, honouring minY constraints as steps are stacked
            let maxBottom = y;
            byRes.forEach(cards => {
              let ry = y;
              cards.forEach(({ step, el }) => {
                const constraint = minY.get(el);
                if (constraint !== undefined && constraint > ry) ry = constraint;
                if (!step.pinned) { el.style.top = ry + 'px'; step.coords.y = ry; }
                ry += el.offsetHeight + STEP_GAP;
              });
              maxBottom = Math.max(maxBottom, ry - STEP_GAP);
            });

            y = maxBottom + STEP_GAP;
            wfBottom = Math.max(wfBottom, maxBottom);

          } else if (item.type === 'consolidated') {
            item.el.style.top = y + 'px';
            // Keep anchor divs aligned to top-center of card for arrow targeting
            item.anchors.forEach(anchor => {
              anchor.style.top  = y + 'px';
              anchor.style.left = Math.round(item.consolCenterX - 1) + 'px';
            });
            item.members.forEach(m => { m.step.coords.y = y; });
            y += item.el.offsetHeight + STEP_GAP * 2;
            wfBottom = Math.max(wfBottom, y - STEP_GAP);
          }
        });

        const actualWfH = wfBottom - wfTop + WF_PAD * 2;
        if (wfBgEl) wfBgEl.style.height = actualWfH + 'px';
        stageBottom = Math.max(stageBottom, wfBottom + WF_PAD * 2);
        wfY = wfTop + actualWfH + WF_GAP;
      });

      const actualStageH = stageBottom - curStageY + ZONE_PAD;
      if (stageBgEl) {
        stageBgEl.style.height = actualStageH + 'px';
        // Width: widest workflow
        const maxWfW = Math.max(...wfMetaList.map(w => w.wfWidth), 100);
        stageBgEl.style.width = (maxWfW + 20) + 'px';
      }
      curStageY += actualStageH + STAGE_GAP;
    });

    const allCards = Array.from(canvas.querySelectorAll('.fv-step-card'));
    const maxX = Math.max(...allCards.map(el => (parseFloat(el.style.left)||0) + (parseFloat(el.style.width)||CARD_W)), 800);
    const maxY = Math.max(...allCards.map(el => (parseFloat(el.style.top)||0) + el.offsetHeight + 60), 600);
    canvas.style.width  = (maxX + PAD_X) + 'px';
    canvas.style.height = maxY + 'px';

    OL._fvDrawStepConnections(allActiveResources);
  });
};

export function _fvToggleConsolidated(headerEl) {
  const groupName = headerEl.dataset.group;
  if (!groupName) return;
  if (!OL._fv.expandedGroups) OL._fv.expandedGroups = new Set();
  if (OL._fv.expandedGroups.has(groupName)) {
    OL._fv.expandedGroups.delete(groupName);
  } else {
    OL._fv.expandedGroups.add(groupName);
  }
  // Re-render so the measurement pass uses the correct expanded card height
  // and repositions all cards below it correctly
  OL.renderVisualizer();
};

// Set or clear a step's consolidation group
export function _fvSetStepGroup(resId, stepId, groupName) {
  const data = OL.getCurrentProjectData();
  const res  = (data.localResources || data.resources || []).find(r => String(r.id) === String(resId));
  if (!res) return;
  const step = (res.steps || []).find(s => String(s.id) === String(stepId));
  if (!step) return;
  step.stepGroup = groupName ? groupName.trim() : undefined;
  OL.persist();
  OL.renderVisualizer();
};

// Draw connections between step cards
export function _fvDrawStepConnections(resources) {
  const svg    = document.getElementById('fv-svg-layer');
  const canvas = document.getElementById('fv-content');
  if (!svg || !canvas) return;

  const cRect = canvas.getBoundingClientRect();

  svg.innerHTML = `
    <defs>
      <marker id="fv-arr" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
        <path d="M0,0 L8,3 L0,6 Z" fill="#3dd9c5"/>
      </marker>
      <marker id="fv-arr-no" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
        <path d="M0,0 L8,3 L0,6 Z" fill="#d4472a"/>
      </marker>
    </defs>
    <g id="fv-lines"></g>
  `;

  svg.style.width  = canvas.style.width;
  svg.style.height = canvas.style.height;

  if (!OL._fv.showConnections) return;

  const group = document.getElementById('fv-lines');

  resources.forEach(sourceRes => {
    (sourceRes.steps || []).forEach((sourceStep, sourceIdx) => {
      OL._fvGetEffectiveOut(sourceStep, sourceRes).forEach(outRule => {
        if (!outRule.targetId) return;

        // Skip implicit synthetic fallbacks — real links drawn below
        if (outRule._implicit) return;

        const lastH = String(outRule.targetId).lastIndexOf('-');
        if (lastH === -1) return;
        const tResId  = outRule.targetId.substring(0, lastH);
        const tStepId = outRule.targetId.substring(lastH + 1);

        const fromElRaw = document.getElementById(`fv-step-${sourceRes.id}-${sourceStep.id}`);
        // If fromEl is a consolidated anchor (tiny proxy div), use the real card for exit coords
        const fromEl = (fromElRaw?.dataset.consolCardId && document.getElementById(fromElRaw.dataset.consolCardId)) || fromElRaw;
        const toEl   = document.getElementById(
          `fv-step-${tResId}-${tStepId}` ||
          // fallback: find by resId + step index if id-based lookup fails
          Array.from(document.querySelectorAll(`[data-res-id="${tResId}"]`))
            .find(el => el.dataset.stepId === tStepId)?.id
        );

        if (!fromEl || !toEl) return;

        const fRect = fromEl.getBoundingClientRect();
        const tRect = toEl.getBoundingClientRect();

        // Determine best anchor based on relative positions
        const fx_center = fRect.left - cRect.left + fRect.width / 2;
        const fy_center = fRect.top  - cRect.top  + fRect.height / 2;
        const tx_center = tRect.left - cRect.left  + tRect.width / 2;
        const ty_center = tRect.top  - cRect.top   + tRect.height / 2;

        const dx = tx_center - fx_center;
        const dy = ty_center - fy_center;
        const isCrossResource = String(tResId) !== String(sourceRes.id);

        let fx, fy, tx, ty, isVert;
        if (isCrossResource) {
          // Cross-resource: always exit from bottom or right (never top/left) to read as "forward"
          if (dx > 0) {
            // Target is to the right — exit right, enter left
            fx = fRect.right - cRect.left; fy = fy_center;
            tx = tRect.left  - cRect.left; ty = ty_center;
            isVert = false;
          } else {
            // Target is below (or same column) — exit bottom, enter top
            fx = fx_center; fy = fRect.bottom - cRect.top;
            tx = tx_center; ty = tRect.top    - cRect.top;
            isVert = true;
          }
        } else if (Math.abs(dy) >= Math.abs(dx)) {
          // Same resource, primarily vertical
          if (dy > 0) {
            fx = fx_center; fy = fRect.bottom - cRect.top;
            tx = tx_center; ty = tRect.top    - cRect.top;
          } else {
            fx = fx_center; fy = fRect.top    - cRect.top;
            tx = tx_center; ty = tRect.bottom - cRect.top;
          }
          isVert = true;
        } else {
          // Same resource, primarily horizontal
          if (dx > 0) {
            fx = fRect.right - cRect.left; fy = fy_center;
            tx = tRect.left  - cRect.left; ty = ty_center;
          } else {
            fx = fRect.left  - cRect.left; fy = fy_center;
            tx = tRect.right - cRect.left; ty = ty_center;
          }
          isVert = false;
        }

        const tension = Math.max(50, Math.abs(isVert ? dy : dx) * 0.4);
        const cp1x = isVert ? fx : fx + (dx > 0 ?  tension : -tension);
        const cp1y = isVert ? fy + (dy > 0 ?  tension : -tension) : fy;
        const cp2x = isVert ? tx : tx + (dx > 0 ? -tension :  tension);
        const cp2y = isVert ? ty + (dy > 0 ? -tension :  tension) : ty;

        const d = `M ${fx} ${fy} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${tx} ${ty}`;

        const isNo   = outRule.type === 'no' || outRule.rule?.toLowerCase().includes('no');
        const isLoop     = outRule.type === 'loop';
        const isImplicit = !!outRule._implicit;
        const color      = isImplicit ? '#3dd9c5' : isLoop ? '#f5b800' : isNo ? '#d4472a' : '#3dd9c5';

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', d);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', color);
        path.setAttribute('stroke-width', isImplicit ? '1' : '1.5');
        path.setAttribute('stroke-opacity', isImplicit ? '0.3' : '0.7');
        path.setAttribute('marker-end', isNo ? 'url(#fv-arr-no)' : 'url(#fv-arr)');
        if (isImplicit) path.setAttribute('stroke-dasharray', '4,4');
        else if (isNo || isLoop) path.setAttribute('stroke-dasharray', '5,3');
        group.appendChild(path);

        // Logic icon on line midpoint (implicit links get no icon)
        const hasRule  = !isImplicit && outRule.rule?.trim();
        const hasDelay = !isImplicit && (outRule.type === 'delay' || parseInt(outRule.delayValue) > 0);
        const iconChar = isLoop ? '↺' : hasDelay ? '⏱' : hasRule ? 'λ' : null;

        if (iconChar) {
          // Find midpoint of bezier curve
          const mx = (fx + tx) / 2;
          const my = (fy + ty) / 2;

          const bg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          bg.setAttribute('cx', mx); bg.setAttribute('cy', my); bg.setAttribute('r', '10');
          bg.setAttribute('fill', '#fff');
          bg.setAttribute('stroke', color); bg.setAttribute('stroke-width', '1.5');
          group.appendChild(bg);

          const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          txt.setAttribute('x', mx); txt.setAttribute('y', my + 4);
          txt.setAttribute('text-anchor', 'middle');
          txt.setAttribute('font-size', iconChar === 'λ' ? '11' : '10');
          txt.setAttribute('font-weight', '700');
          txt.setAttribute('fill', color);
          txt.setAttribute('font-family', 'DM Sans, sans-serif');
          txt.setAttribute('pointer-events', 'none');
          txt.textContent = iconChar;
          group.appendChild(txt);

          // Tooltip on hover showing the rule/delay
          if (hasRule || hasDelay) {
            const label = hasDelay
              ? `⏱ ${outRule.delayValue || '?'} ${outRule.delayUnit || 'days'}`
              : outRule.rule;
            bg.setAttribute('title', label);
            bg.style.cursor = 'help';
          }
        }
      });
    });
  });
};

export function _fvSetupCardDrag(el, resId, stepId) {
  let startX, startY, startLeft, startTop, hasMoved = false;

  el.addEventListener('mousedown', e => {
    // Don't drag if clicking interactive elements
    if (e.target.closest('.fv-pin-btn, .fv-res-tidy-btn, .fv-port, .fv-step-card-body')) return;
    e.preventDefault();
    e.stopPropagation();

    startX    = e.clientX;
    startY    = e.clientY;
    startLeft = parseFloat(el.style.left) || 0;
    startTop  = parseFloat(el.style.top)  || 0;
    hasMoved  = false;

    const zoom = OL._fv.zoom || 1;

    const onMove = e => {
      const dx = (e.clientX - startX) / zoom;
      const dy = (e.clientY - startY) / zoom;

      if (!hasMoved && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
        hasMoved = true;
        el.classList.add('is-dragging');
      }
      if (!hasMoved) return;

      let newX = startLeft + dx;
      let newY = startTop  + dy;

      // Snap to grid
      if (OL._fv.snapToGrid) {
        const g = OL._fv.gridSize || 20;
        newX = Math.round(newX / g) * g;
        newY = Math.round(newY / g) * g;
      }

      newX = Math.max(0, newX);
      newY = Math.max(0, newY);

      el.style.left = newX + 'px';
      el.style.top  = newY + 'px';

      // Redraw connections live
      const data = OL.getCurrentProjectData();
      const resources = (data.resources||[]).filter(r=>!r.isDeleted&&!r.isLocked);
      OL._fvDrawStepConnections(resources);
    };

    const onUp = async () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup',   onUp);
      el.classList.remove('is-dragging');

      if (!hasMoved) return;

      // Save coords and auto-pin
      const data = OL.getCurrentProjectData();
      const res  = (data.resources||[]).find(r => String(r.id) === String(resId));
      const step = res?.steps?.find(s => String(s.id) === String(stepId));

      if (step) {
        step.coords = {
          x: parseFloat(el.style.left) || 0,
          y: parseFloat(el.style.top)  || 0,
        };
        step.pinned = true; // Auto-pin on first drag
        el.classList.add('is-pinned');

        // Update pin button
        const pinBtn = el.querySelector('.fv-pin-btn');
        if (pinBtn) {
          pinBtn.classList.add('pinned');
          pinBtn.title = 'Unpin (allow auto-layout)';
          pinBtn.innerHTML = '<i data-lucide="pin"></i>';
          if (window.lucide) lucide.createIcons();
        }

        await OL.persist();
      }
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup',   onUp);
  });
};

// ── STAGE NAME EDITING ────────────────────────────────────
export function _fvEditStageName(stageId, name) {
    const data  = OL.getCurrentProjectData();
    const stage = (data.stages || []).find(s => String(s.id) === String(stageId));
    if (!stage) return;

    if (name && name.trim()) {
        // Called from contenteditable onblur — just save
        stage.name = name.trim();
        OL.persist();
        // No re-render needed — contenteditable already shows the new name
    } else if (!name) {
        // Called from pencil button — show prompt
        const newName = prompt('Stage name:', stage.name);
        if (!newName?.trim()) return;
        stage.name = newName.trim();
        OL.persist();
        OL.renderVisualizer();
    }
};

// ── JUMP TO LANE ─────────────────────────────────────────
export function _fvJumpToLane(stageId) {
  const lane = document.getElementById(`fv-lane-${stageId}`);
  if (!lane) return;
  lane.scrollIntoView({ behavior: 'smooth', block: 'start' });
  // Flash highlight
  lane.style.transition = 'background 0.2s';
  lane.style.background = 'rgba(61,217,197,0.08)';
  setTimeout(() => { lane.style.background = ''; }, 1200);
};

// Sync rail label heights to their matching swimlane
export function _fvSyncRailHeights() {
  requestAnimationFrame(() => {
    const data = OL.getCurrentProjectData();
    const stages = [
      ...(data.stages || []),
      { id: '__none__', name: 'Unassigned' }
    ];

    stages.forEach(stage => {
      const lane = document.getElementById(`fv-lane-${stage.id}`);
      const rail = document.getElementById(`fv-rail-${stage.id}`);
      if (lane && rail) {
        // +1 for the border-bottom
        const h = lane.offsetHeight + 1;
        rail.style.height    = h + 'px';
        rail.style.minHeight = h + 'px';
      }
    });

    // Draw connections after heights settle
    const resources = (data.resources || [])
      .filter(r => !r.isDeleted && !r.isLocked);
    OL._fvDrawConnections(resources);

    if (window.lucide) lucide.createIcons();
  });
};

// Draw SVG connection lines
export function _fvDrawConnections(resources) {
  const svg    = document.getElementById('fv-svg-layer');
  const canvas = document.getElementById('fv-canvas');
  if (!svg || !canvas) return;

  svg.innerHTML = `
    <defs>
      <marker id="fv-arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
        <path d="M0,0 L8,3 L0,6 Z" fill="#3dd9c5" opacity="0.9"/>
      </marker>
      <marker id="fv-arrow-cross" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
        <path d="M0,0 L8,3 L0,6 Z" fill="#d4472a" opacity="0.8"/>
      </marker>
      <marker id="fv-arrow-global" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
        <path d="M0,0 L8,3 L0,6 Z" fill="#7c3aed" opacity="0.8"/>
      </marker>
    </defs>
    <g id="fv-lines"></g>
  `;

  if (!OL._fv.showConnections) return;

  svg.setAttribute('width',  canvas.scrollWidth  || 2000);
  svg.setAttribute('height', canvas.scrollHeight || 2000);
  svg.style.width  = (canvas.scrollWidth  || 2000) + 'px';
  svg.style.height = (canvas.scrollHeight || 2000) + 'px';

  const group = document.getElementById('fv-lines');
  const canvasRect = canvas.getBoundingClientRect();
  const globalIds = new Set(
    (resources || []).filter(r => r.isGlobal).map(r => String(r.id))
  );

  (resources || []).forEach(sourceRes => {
    (sourceRes.steps || []).forEach(step => {
      (step.logic?.out || []).forEach(outRule => {
        if (!outRule.targetId) return;

        const lastH = String(outRule.targetId).lastIndexOf('-');
        if (lastH === -1) return;
        const targetResId = outRule.targetId.substring(0, lastH);
        if (targetResId === String(sourceRes.id)) return; // skip same-card

        const fromEl = document.getElementById(`fv-card-${sourceRes.id}`);
        const toEl   = document.getElementById(`fv-card-${targetResId}`);
        if (!fromEl || !toEl) return;

        const fRect = fromEl.getBoundingClientRect();
        const tRect = toEl.getBoundingClientRect();

        const fx = fRect.left - canvasRect.left + fRect.width / 2;
        const fy = fRect.top  - canvasRect.top  + fRect.height;
        const tx = tRect.left - canvasRect.left  + tRect.width / 2;
        const ty = tRect.top  - canvasRect.top;

        const isGlobalLink = globalIds.has(String(sourceRes.id)) || globalIds.has(targetResId);
        const isCross = fromEl.dataset.stageId !== toEl.dataset.stageId;
        const isLoop  = outRule.type === 'loop';

        const color  = isGlobalLink ? '#7c3aed' : isLoop ? '#f5b800' : isCross ? '#d4472a' : '#3dd9c5';
        const marker = isGlobalLink ? 'url(#fv-arrow-global)' : isCross ? 'url(#fv-arrow-cross)' : 'url(#fv-arrow)';
        const tension = Math.max(40, Math.abs(ty - fy) * 0.45);

        const d = isCross
          ? `M ${fx} ${fy} C ${fx} ${fy+tension}, ${tx} ${ty-tension}, ${tx} ${ty}`
          : `M ${fx} ${fy-fRect.height/2} C ${fx+60} ${fy-fRect.height/2}, ${tx-60} ${ty+tRect.height/2}, ${tx} ${ty+tRect.height/2}`;

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', d);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', color);
        path.setAttribute('stroke-width', '1.5');
        path.setAttribute('stroke-opacity', '0.6');
        path.setAttribute('marker-end', marker);
        path.setAttribute('data-from', sourceRes.id);
        path.setAttribute('data-to', targetResId);
        if (isCross || isGlobalLink) path.setAttribute('stroke-dasharray', '5,3');
        group.appendChild(path);
      });
    });
  });
};

// Highlight global connections on hover
export function _fvHighlightGlobalConnections(resId, on) {
  document.querySelectorAll(`[data-from="${resId}"], [data-to="${resId}"]`).forEach(path => {
    path.setAttribute('stroke-opacity', on ? '1' : '0.6');
    path.setAttribute('stroke-width',   on ? '2.5' : '1.5');
  });
  document.querySelectorAll('.fv-card').forEach(card => {
    const id = card.dataset.resId;
    const isConnected = document.querySelector(`[data-from="${resId}"][data-to="${id}"], [data-from="${id}"][data-to="${resId}"]`);
    if (id !== resId) {
      card.classList.toggle('global-hover', on && !!isConnected);
      card.classList.toggle('dimmed', on && !isConnected);
    }
  });
};

// TIDY FUNCTIONS

export async function _fvTidy(scope, resourceId) {
  const data      = OL.getCurrentProjectData();
  const resources = (data.resources||[]).filter(r=>!r.isDeleted&&!r.isLocked);

  if (scope === 'global') {
    resources.forEach(res => {
      (res.steps||[]).forEach(step => {
        if (!step.pinned) step.coords = null;
      });
    });
  } else if (scope === 'force') {
    resources.forEach(res => {
      (res.steps||[]).forEach(step => {
        step.pinned = false;
        step.coords = null;
      });
    });
  } else if (scope === 'stage') {
    const stageId = resourceId;
    resources
      .filter(r => r.stageId === stageId)
      .forEach(res => {
        (res.steps||[]).forEach(step => {
          if (!step.pinned) step.coords = null;
        });
      });
  } else if (scope === 'resource') {
    const res = resources.find(r => String(r.id) === String(resourceId));
    if (res) {
      (res.steps||[]).forEach(step => {
        step.pinned = false;
        step.coords = null;
      });
    }
  }

  OL._fvNormalizeStepCoords();
  OL._fvComputeLayout(resources, OL._fv.stageFilter);
  await OL.persist();
  OL.renderVisualizer();
};

export function _fvShowTidyMenu(e) {
  e.stopPropagation();
  const existing = document.getElementById('fv-tidy-menu');
  if (existing) { existing.remove(); return; }

  const btn    = e.currentTarget;
  const rect   = btn.getBoundingClientRect();
  const stages = OL.getCurrentProjectData().stages || [];

  const menu = document.createElement('div');
  menu.id = 'fv-tidy-menu';
  menu.style.cssText = `
    position:fixed; top:${rect.bottom+4}px; left:${rect.left}px;
    background:var(--panel); border:1px solid var(--panel-border); border-radius:8px;
    box-shadow:0 4px 16px rgba(0,0,0,0.1); z-index:1000;
    min-width:200px; overflow:hidden;
  `;

  const items = [
    { label: 'Tidy All (respect pinned)', action: `OL._fvTidy('global')` },
    { label: 'Force Tidy All', action: `OL._fvTidy('force')`, danger: true },
    { label: '─────────────────', divider: true },
    ...stages.map(s => ({
      label: `Tidy: ${s.name}`,
      action: `OL._fvTidy('stage','${s.id}')`,
    })),
  ];

  items.forEach(item => {
    if (item.divider) {
      const d = document.createElement('div');
      d.style.cssText = 'padding:4px 12px;font-size:10px;color:var(--line);';
      d.textContent = item.label;
      menu.appendChild(d);
      return;
    }
    const el = document.createElement('div');
    el.style.cssText = `
      padding:9px 14px; font-size:12px; cursor:pointer;
      color:${item.danger ? '#d4472a' : '#374151'};
      transition:background 0.1s;
    `;
    el.textContent = item.label;
    el.onmouseenter = () => el.style.background = '#f5f6f8';
    el.onmouseleave = () => el.style.background = '';
    el.onclick = () => { menu.remove(); eval(item.action); };
    menu.appendChild(el);
  });

  document.body.appendChild(menu);
  setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 10);
};

export async function _fvTogglePin(resId, stepId) {
  const data = OL.getCurrentProjectData();
  const res  = (data.resources||[]).find(r => String(r.id) === String(resId));
  const step = res?.steps?.find(s => String(s.id) === String(stepId));
  if (!step) return;

  step.pinned = !step.pinned;
  await OL.persist();

  // Surgical update — just update the pin button without full re-render
  const card = document.getElementById(`fv-step-${resId}-${stepId}`);
  if (card) {
    const btn = card.querySelector('.fv-pin-btn');
    if (btn) {
      btn.classList.toggle('pinned', step.pinned);
      btn.title = step.pinned ? 'Unpin (allow auto-layout)' : 'Pin (manual position)';
      btn.innerHTML = `<i data-lucide="${step.pinned ? 'pin' : 'pin-off'}"></i>`;
      if (window.lucide) lucide.createIcons();
    }
    card.classList.toggle('is-pinned', step.pinned);
  }
};

// WORKBENCH PANEL

export function _fvToggleWb(tab) {
  OL._fv._wbTab = OL._fv._wbTab === tab ? null : tab;
    if (state.us) {
        state.ui.sidebarSearchQuery = "";
    }
    if (typeof OL.syncResourceLibraryFilters === 'function') {
        OL.syncResourceLibraryFilters();
    }
  OL.renderVisualizer();
};

export function _fvPopulateWb(tab, resources) {
    const content = document.getElementById('fv-wb-content');
    if (!content) return;
    const drawer = document.getElementById('fv-wb-drawer');
    if (drawer) {
        drawer.ondragover = (e) => {
            e.preventDefault();
            drawer.style.background = 'rgba(61,217,197,0.08)';
            drawer.style.borderLeft = '2px solid #3dd9c5';
        };
        drawer.ondragleave = () => {
            drawer.style.background = '';
            drawer.style.borderLeft = '';
        };
        drawer.ondrop = (e) => {
            e.preventDefault();
            drawer.style.background = '';
            drawer.style.borderLeft = '';
            const resId = e.dataTransfer.getData('application/fv-resource') || 
                          e.dataTransfer.getData('text/plain');
            if (resId) OL._fvUnmapResource(resId);
        };
    }

    const client       = getActiveClient();
    const data         = OL.getCurrentProjectData();
    const masterGuides = state.master?.howToLibrary || [];
    const localGuides  = client?.projectData?.localHowTo || [];
    const datapoints   = state.master?.datapoints || [];

    let allItems = [];

    if (tab === 'flows') {
        allItems = resources.filter(r => 
            ['Workflow','Zap','Email Campaign'].includes(r.type) &&
            !r.isArchived && (!r.stageId || r.isGlobal)
        );
    } else if (tab === 'assets') {
        allItems = resources.filter(r => 
            !['Workflow','Zap','Email Campaign'].includes(r.type) &&
            !r.isArchived && (!r.stageId || r.isGlobal)
        );
    } else if (tab === 'guides') {
        // Only show client-facing guides in the workbench
        allItems = [...masterGuides, ...localGuides].filter(g => g.isShared === true);
    } else if (tab === 'data') {
        allItems = datapoints;
    }

    const searchId = `fv-wb-search-${tab}`;
    const listId   = `fv-wb-items-${tab}`;

    content.innerHTML = `
        <div style="padding:8px 8px 4px;">
            <input type="text" id="${searchId}"
                   placeholder="Search..."
                   oninput="OL._fvFilterWb('${tab}')"
                   style="width:100%;padding:6px 8px;border:1px solid rgba(255,255,255,0.1);
                          border-radius:6px;background:rgba(0,0,0,0.2);color:#fff;
                          font-size:11px;outline:none;box-sizing:border-box;font-family:inherit;">
        </div>
        <div id="${listId}">
            ${OL._fvRenderWbItems(allItems, tab)}
        </div>
    `;

    if (window.lucide) lucide.createIcons();
};

export function _fvRenderWbItems(items, tab) {
    if (!items.length) return `<div style="padding:20px; text-align:center; color:var(--text-muted); font-size:12px; font-style:italic;">No ${tab} found</div>`;
    
    const data = OL.getCurrentProjectData();
    const resources = data.resources || [];

    return items.map((item, idx) => {
        const tc     = OL._fvGetType(item.type);
        const name   = item.name || item.title || 'Unnamed';
        const isData = tab === 'data';
        
        // 🎯 RENDER LOGIC FOR STAGES TRAY CARDS
        if (tab === 'stages') {
            const stageResCount = resources.filter(r => String(r.stageId) === String(item.id)).length;
            
            return `
                <div class="fv-wb-item fv-stage-sort-row"
                     draggable="true"
                     data-id="${item.id}"
                     data-stage-idx="${idx}"
                     id="stage-sort-row-${item.id}"
                     ondragstart="OL.handleStageSortDragStart(event, ${idx})"
                     ondragover="event.preventDefault(); this.style.borderTop='2px solid var(--accent)';"
                     ondragleave="this.style.borderTop='';"
                     ondrop="OL.handleStageSortDrop(event, ${idx})"
                     style="display:flex; align-items:center; gap:10px; padding:10px 12px; border-bottom:1px solid var(--line); cursor:grab;">
                    
                    <div class="fv-wb-item-icon" style="background:rgba(61,217,197,0.1); color:var(--accent); font-weight:bold; font-size:10px; width:24px; height:24px; border-radius:4px; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                        #${idx + 1}
                    </div>
                    
                    <div class="fv-wb-item-info" style="flex:1; min-width:0;">
                        <input type="text" value="${esc(name)}" 
                               style="background:transparent; border:none; color:white; font-size:12px; font-weight:600; width:100%; outline:none; padding:0; margin:0;"
                               onchange="OL.renameStage('${item.id}', this.value)">
                        <div style="font-size:9px; color:var(--text-muted); margin-top:2px;">
                            ${stageResCount} Resource${stageResCount !== 1 ? 's' : ''}
                        </div>
                    </div>

                    <div style="display:flex; gap:2px; align-items:center; flex-shrink:0;">
                        <button class="btn-icon-tiny" title="Move Up" onclick="event.stopPropagation(); OL.moveStageIndex(${idx}, ${idx - 1})" ${idx === 0 ? 'disabled style="opacity:0.2; cursor:not-allowed;"' : ''}>▲</button>
                        <button class="btn-icon-tiny" title="Move Down" onclick="event.stopPropagation(); OL.moveStageIndex(${idx}, ${idx + 1})" ${idx === items.length - 1 ? 'disabled style="opacity:0.2; cursor:not-allowed;"' : ''}>▼</button>
                        <button onclick="event.stopPropagation(); OL.deleteStage('${item.id}')"
                                style="border:none; background:none; cursor:pointer; color:var(--text-muted); display:flex; align-items:center; justify-content:center; padding:2px; margin-left:4px;">
                            <i data-lucide="trash-2" style="width:12px; height:12px;"></i>
                        </button>
                    </div>
                </div>
            `;
        }

        // Standard return path fallback loops for assets/flows
        return `
            <div class="fv-wb-item"
                 draggable="true"
                 data-id="${item.id}"
                 data-type="${tab}"
                 ondragstart="OL._fvWbDragStart(event,'${item.id}','${tab}')"
                 onclick="OL.openInspector('${item.id}', null, 'cards')"
                 style="cursor:grab;${item.isGlobal ? 'border:1.5px solid #7c3aed;box-shadow:0 0 0 1px rgba(124,58,237,0.15);' : ''}">
                <div class="fv-wb-item-icon"
                     style="background:${isData ? 'rgba(124,58,237,0.1)' : tc.color+'18'};
                            color:${isData ? '#7c3aed' : tc.color};">
                    ${isData ? '🏷' : tc.abbr}
                </div>
                <div class="fv-wb-item-info">
                    <div class="fv-wb-item-name">${esc(name.substring(0,24))}</div>
                    ${!isData ? `<div class="fv-wb-item-type">${esc(item.type||'')}</div>` : ''}
                </div>
               <div style="margin-left:auto;display:flex;align-items:center;gap:4px;">
                    ${item.isGlobal ? OL.getLucideSVG('globe', 10, '#7c3aed') : ''}
                    <span style="color:rgba(255,255,255,0.2);font-size:10px;">⠿</span>
                </div>
            </div>
        `;
    }).join('');
    
    if (window.lucide) lucide.createIcons();
};

export function _fvFilterWb(tab) {
    const input = document.getElementById(`fv-wb-search-${tab}`);
    const q = (input?.value || '').toLowerCase().trim();
    const data = OL.getCurrentProjectData();
    const resources = (data.resources || []).filter(r => !r.isDeleted && !r.isLocked);
    const client = getActiveClient();

    let items = [];
    if (tab === 'flows') {
        items = resources.filter(r =>
            ['Workflow','Zap','Email Campaign'].includes(r.type) &&
            !r.isArchived && (!r.stageId || r.isGlobal)
        );
    } else if (tab === 'assets') {
        items = resources.filter(r =>
            !['Workflow','Zap','Email Campaign'].includes(r.type) &&
            !r.isArchived && (!r.stageId || r.isGlobal)
        );
    } else if (tab === 'guides') {
        items = [...(state.master?.howToLibrary || []), ...(client?.projectData?.localHowTo || [])];
    } else if (tab === 'data') {
        items = state.master?.datapoints || [];
    }

    if (q) items = items.filter(i => (i.name || i.title || '').toLowerCase().includes(q));

    const list = document.getElementById(`fv-wb-items-${tab}`);
    if (list) list.innerHTML = OL._fvRenderWbItems(items, tab);
};

export function _fvWbDragStart(e, id, type) {
  e.dataTransfer.setData('application/fv-resource', id);
  e.dataTransfer.setData('application/fv-tab', type);
  e.dataTransfer.effectAllowed = 'move';
  // Visual feedback
  e.currentTarget.style.opacity = '0.4';
  e.currentTarget.addEventListener('dragend', () => {
    e.currentTarget.style.opacity = '1';
  }, { once: true });
};

// RAIL SCROLL AND CANVAS CLICK
export function _fvSetupRailScroll() {
  const wrap = document.getElementById('fv-canvas-wrap');
  const rail = document.getElementById('fv-lane-rail');
  if (!wrap || !rail) return;

  wrap.addEventListener('scroll', () => {
    rail.scrollTop = wrap.scrollTop;
  }, { passive: true });
};

export async function _fvUnmapResource(resId, contextWorkflowId = null) {
    const data = OL.getCurrentProjectData();
    const res = (data.resources || []).find(r => String(r.id) === String(resId));
    if (!res) return;

    console.group(`🧼 Unmapping Resource: ${res.name}`);

    // 🎯 IF WE KNOW EXACTLY WHICH WORKFLOW TRAY IT CAME FROM
    if (contextWorkflowId) {
        const wf = (data.workflows || []).find(w => String(w.id) === String(contextWorkflowId));
        if (wf && wf.resourceIds) {
            wf.resourceIds = wf.resourceIds.filter(id => String(id) !== String(resId));
            console.log(`❌ Removed instance reference from Workflow array: ${contextWorkflowId}`);
        }
    } 
    // 🔍 FALLBACK: If dragged to the sidebar rail and contextWorkflowId wasn't passed,
    // look up which workflow currently holds it under the cursor
    else {
        (data.workflows || []).forEach(wf => {
            if (wf.resourceIds && wf.resourceIds.includes(String(resId))) {
                // If it's global, we only want to drop it from the workflow we are interacting with.
                // For safety in a global drag-to-rail fallback without context, we check if it matches the current view state.
                if (!res.isGlobal || String(wf.id) === String(OL._fv.activeWorkflowId)) {
                    wf.resourceIds = wf.resourceIds.filter(id => String(id) !== String(resId));
                }
            }
        });
    }

    // 🏠 LOCAL MECHANICS ONLY: Global master attributes remain completely untouched!
    if (!res.isGlobal) {
        res.stageId = null;
        res.workflowId = null;
        if (res.coords) delete res.coords;
        console.log("🧹 Local asset wiped clean from root properties.");
    }

    console.groupEnd();

    await OL.persist();
    OL.renderVisualizer();
};

export function _fvHandleCanvasClick(e) {
    const isCard      = e.target.closest('.fv-card, .fv-step-card, .fv-list-item, .fv-card-footer, .fv-card-body, .fv-card-steps-preview');
    const isBtn       = e.target.closest('button, select, input, a, textarea, label');
    const isInspector = e.target.closest('#v2-inspector-panel, #inspector-panel');
    const isWb        = e.target.closest('#fv-wb-rail, #fv-wb-drawer');
    const isLaneRail  = e.target.closest('#fv-lane-rail');
    const isTopbar    = e.target.closest('#fv-topbar');

    if (isCard || isBtn || isInspector || isWb || isLaneRail || isTopbar) return;

    document.querySelectorAll('.fv-card.selected, .fv-step-card.selected, .fv-list-item.selected')
        .forEach(el => el.classList.remove('selected'));

    OL.closeInspectorPanel();
};

export function closeInspectorPanel() {
    OL._fv._lastInspectorResId = null;

    const panel = document.getElementById('v2-inspector-panel') || document.getElementById('inspector-panel');
    if (panel) {
        panel.classList.remove('open');
        panel.id = 'inspector-panel';
        panel.style.width = '0';
        panel.style.minWidth = '0';
    }

    const layout = document.querySelector('.three-pane-layout');
    if (layout) {
        const sidebarCollapsed = document.querySelector('.sidebar.collapsed');
        const leftCol = sidebarCollapsed ? '65px' : '240px';
        layout.style.gridTemplateColumns = `${leftCol} 1fr 0px`;
    }
};

export function _fvSelectStep(resId, stepId) {
  document.querySelectorAll('.fv-step-card.selected').forEach(el => el.classList.remove('selected'));
  const card = document.getElementById(`fv-step-${resId}-${stepId}`);
  if (card) card.classList.add('selected');
  OL.openInspector(resId, stepId);
};

// ══════════════════════════════════════════════
// LIST VIEW
// ══════════════════════════════════════════════

export function _fvBuildListShell(stages, resources) {
    window._fvRenderedStepRegistry = new Set();
    const filter = OL._fv.stageFilter;
    const globalIds = new Set(resources.filter(r => r.isGlobal).map(r => String(r.id)));
    const workflows = OL.getWorkflows() || [];

    const displayStages = [...stages];

    const stagesHtml = displayStages.map((stage, si) => {
        // Handle explicit stage filtering context paths
        if (filter && filter.startsWith('stage-') && stage.id !== filter.replace('stage-', '')) return '';
        
        // Handle specific workflow context paths
        if (filter && !filter.startsWith('stage-') && filter !== '') {
            const activeWf = workflows.find(w => w.id === filter);
            if (!activeWf || activeWf.stageId !== stage.id) return '';
        }

        // Get workflows explicitly tied to this structural stage index lane
        const stageWorkflows = workflows.filter(w => w.stageId === stage.id);
        
        // 🎯 TRACK RENDERED GLOBAL ASSETS
        // Keep a running record of any global resource ID that successfully renders inside an active workflow group
        const globalsRenderedInWorkflows = new Set();

        let stageWorkflowsHtml = '';
        let totalStageStepsCount = 0;

        // 🏢 1. GROUP AND RENDER WORKFLOW BUCKETS UNDER STAGE
        stageWorkflows.forEach(wf => {
            if (filter && !filter.startsWith('stage-') && filter !== '' && wf.id !== filter) return;

            // THE MULTI-INSTANCE BRIDGE:
            const wfResources = (wf.resourceIds || [])
                .map(id => {
                    const found = resources.find(r => String(r.id) === id);
                    if (!found) return null;
                    
                    if (found.isGlobal) {
                        globalsRenderedInWorkflows.add(String(found.id));
                        return {
                            ...found,
                            stageId: stage.id,
                            workflowId: wf.id,
                            isGlobalInstanceCopy: true
                        };
                    }
                    return found;
                })
                .filter(r => r && (OL._fv.showArchived || !r.isArchived));

            if (wfResources.length === 0) return;

            // Map out steps nested directly within this workflow bucket container
            const wfStepsContentHtml = wfResources.map(res => {
                const steps = (res.steps || []).filter(s => OL._fv.showArchived || !s.isArchived);
                totalStageStepsCount += steps.length;
                
                return steps.map((step, idx) => {
                    // 🎯 PASS WORKFLOW CONTEXT IF IT'S A GLOBAL CLONE INSTANCE
                    // This tells the step renderer to append a unique suffix to the HTML IDs 
                    // (e.g., id="step-${step.id}-${wf.id}") so different copies stay isolated.
                    const contextWfId = res.isGlobalInstanceCopy ? wf.id : null;
                    
                    return OL._fvRenderListStep(
                        step, 
                        res, 
                        idx, 
                        globalIds, 
                        resources, 
                        0, 
                        new Set(), 
                        contextWfId // 🚀 Added parameter passing
                    );
                }).join('');
            }).join('');

            stageWorkflowsHtml += `
                <div class="fv-list-workflow-group" 
                     id="fv-workflow-group-${wf.id}" 
                     ondragover="event.preventDefault();"
                     ondrop="OL.handleCanvasDrop(event);"
                     style="margin-top: 12px; margin-bottom: 15px; padding-left: 10px; border-left: 2px solid var(--accent);">
                     
                    <div style="display:flex; align-items:center; gap:6px; margin-bottom:10px; opacity:0.7;">
                        <i data-lucide="workflow" style="width:12px; height:12px; color:var(--accent);"></i>
                        <span style="font-size:11px; font-weight:700; text-transform:uppercase; color:var(--text-muted); letter-spacing:0.05em;">
                            Process: ${esc(wf.name)}
                        </span>
                    </div>
                    ${wfStepsContentHtml}
                </div>
            `;
        });
        
        // 🏢 2. RENDER UNASSIGNED COMPONENT CORES UNDER STAGE
        // 🎯 THE SURGICAL DE-DUPLICATION FILTER
        // A resource qualifies for the fallback bottom tray if it belongs to this stage,
        // is NOT assigned to a local workflow sequence, and has NOT already been rendered as a global instance copy.
        const assignedResIds = new Set(stageWorkflows.flatMap(w => w.resourceIds || []));
        const unassignedResources = resources.filter(r => 
            r.stageId === stage.id && 
            !assignedResIds.has(String(r.id)) && 
            !globalsRenderedInWorkflows.has(String(r.id))
        );

        if (unassignedResources.length > 0 && (!filter || filter.startsWith('stage-'))) {
            const unassignedStepsContentHtml = unassignedResources.map(res => {
                const steps = (res.steps || []).filter(s => OL._fv.showArchived || !s.isArchived);
                totalStageStepsCount += steps.length;
                
                return steps.map((step, idx) => 
                    OL._fvRenderListStep(step, res, idx, globalIds, resources, 0, new Set())
                ).join('');
            }).join('');

            stageWorkflowsHtml += `
                <div class="fv-list-workflow-group unassigned" style="margin-top: 12px; margin-bottom: 15px; padding-left: 10px; border-left: 2px dashed #6b7280;">
                    <div style="display:flex; align-items:center; gap:6px; margin-bottom:10px; opacity:0.5;">
                        <i data-lucide="help-circle" style="width:12px; height:12px;"></i>
                        <span style="font-size:11px; font-weight:700; text-transform:uppercase; color:var(--text-muted); letter-spacing:0.05em;">
                            Unassigned Resources
                        </span>
                    </div>
                    ${unassignedStepsContentHtml}
                </div>
            `;
        }

        if (totalStageStepsCount === 0) return '';

        return `
            <div style="display:flex; align-items:center; gap:8px; padding:4px 0;">
                <button class="fv-btn" style="padding:2px 8px; font-size:10px; opacity:0.5;" onclick="OL.addStageBetween(${si})">
                    <i data-lucide="plus" style="width:10px; height:10px;"></i> Add Stage
                </button>
                <div style="flex:1; height:1px; background:var(--line);"></div>
            </div>
            <div class="fv-list-stage" id="fv-list-stage-${stage.id}">
                <div class="fv-list-stage-header" style="display:flex; align-items:center; gap:10px; background:var(--panel-soft); padding:8px 12px; border-radius:6px;">
                    <div class="fv-list-stage-num" style="background:var(--accent); color:black; font-weight:bold; width:20px; height:20px; border-radius:4px; display:flex; align-items:center; justify-content:center; font-size:11px;">${si + 1}</div>
                    <div class="fv-list-stage-name" style="font-weight:bold; font-size:14px; color:var(--text-main);">${esc(stage.name)}</div>
                    <div class="fv-list-stage-line" style="flex:1; height:1px; background:var(--line); margin:0 10px;"></div>
                    <div class="fv-list-stage-count" style="font-size:11px; color:var(--text-muted); font-weight:500;">${totalStageStepsCount} steps</div>
                    
                    <button class="fv-btn" style="padding:3px 8px; font-size:10px;"
                            onclick="document.querySelectorAll('#fv-list-stage-${stage.id} [id^=fv-substeps-]').forEach(el=>el.style.display='none');
                                     document.querySelectorAll('#fv-list-stage-${stage.id} .fv-substep-toggle').forEach(b=>b.textContent='+');">
                        Collapse
                    </button>
                    <button class="fv-btn" style="padding:3px 8px; font-size:10px;"
                            onclick="document.querySelectorAll('#fv-list-stage-${stage.id} [id^=fv-substeps-]').forEach(el=>el.style.display='block');
                                     document.querySelectorAll('#fv-list-stage-${stage.id} .fv-substep-toggle').forEach(b=>b.textContent='-');">
                        Expand
                    </button>
                </div>
                <div style="padding:5px 0 15px 0;">
                    ${stageWorkflowsHtml}
                </div>
            </div>
        `;
    }).join('');

    return `
        <div id="fv-list-wrap" onclick="OL._fvHandleCanvasClick(event)" style="padding:20px; max-height:100%; overflow-y:auto;">
            ${stagesHtml || `
                <div class="fv-loading-state" style="text-align:center; padding:100px; opacity:0.5;">
                    <i data-lucide="inbox" style="width:32px; height:32px; margin-bottom:10px;"></i>
                    <div>No stages or steps found. Assign resources to workflows to generate data fields.</div>
                </div>`}
        </div>
    `;
};

export function _fvOpenStepsList(resId) {
  OL._fv._lastInspectorResId = resId;
  const data   = OL.getCurrentProjectData();
  const res    = (data.resources||[]).find(r => String(r.id) === resId);
  if (!res) return;

  // Ensure correct panel ID in visualizer context
  const rawPanel = document.getElementById('inspector-panel');
  if (rawPanel && !document.getElementById('v2-inspector-panel')) {
      rawPanel.id = 'v2-inspector-panel';
  }
  const panel = document.getElementById('v2-inspector-panel');
  if (!panel) return;

  // Always get content RELATIVE to panel to avoid stale references
  let content = panel.querySelector('#inspector-content');
  if (!content) {
      const scrollWrap = panel.querySelector('.inspector-scroll-content');
      if (scrollWrap) {
          content = document.createElement('div');
          content.id = 'inspector-content';
          scrollWrap.innerHTML = '';
          scrollWrap.appendChild(content);
      }
  }
  if (!content) return;

  content.innerHTML = '';
    console.group('🔍 Inspector Debug');
    console.log('resId:', resId);
    console.log('res found:', !!res);
    console.log('panel el:', panel);
    console.log('panel.id:', panel?.id);
    console.log('panel has open class:', panel?.classList.contains('open'));
    console.log('panel width:', panel?.style.width);
    console.log('panel offsetWidth:', panel?.offsetWidth);
    console.log('content el:', content);
    console.log('content parent:', content?.parentElement);
    console.log('content in DOM:', document.contains(content));
    console.log('panel in DOM:', document.contains(panel));
    console.groupEnd();

  panel.classList.add('open');
    panel.style.width = '';
  panel.style.minWidth = '';

  const layout = document.querySelector('.three-pane-layout');
  if (layout) {
      const sidebarCollapsed = document.querySelector('.sidebar.collapsed');
      const leftCol = sidebarCollapsed ? '65px' : '240px';
      layout.style.gridTemplateColumns = `${leftCol} 1fr 380px`;
  }

  const tc     = OL._fvGetType(res.type);
  const stages = data.stages || [];
  const client = getActiveClient();

  if (!OL._fv._stepsOpen) OL._fv._stepsOpen = {};
  if (OL._fv._stepsOpen[resId] === undefined) OL._fv._stepsOpen[resId] = true;
  const stepsOpen = OL._fv._stepsOpen[resId];
  const stageName = stages.find(s => s.id === res.stageId)?.name || '';

  // ── APP SECTION ──────────────────────────────────────
  const rawType    = String(res.type || 'General');
  const typeDef    = (state.master?.resourceTypes||[])
    .find(t => t.type.toLowerCase() === rawType.toLowerCase());
  const isZap      = rawType.toLowerCase() === 'zap';
  const autoApp    = (!isZap && typeDef?.matchedFunctionId)
    ? OL.getAppByFunction?.(rawType) : null;

  const appSection = isZap
    ? `<div class="fvi-value muted">Multi-app automation.</div>`
    : res.appId
      ? `<div style="display:flex;align-items:center;gap:6px;">
           <div style="display:flex;align-items:center;gap:6px;flex:1;
                       padding:7px 10px;border:1px solid var(--panel-border);
                       border-radius:8px;background:var(--panel-soft);">
             <span style="font-size:12px;font-weight:500;color:var(--text-main);">
               ${esc(res.appName||'')}
             </span>
           </div>
           <button onclick="OL.handleResourceSave('${res.id}','appId',null);
                            OL.handleResourceSave('${res.id}','appName',null);"
                   style="padding:7px;border:1px solid var(--panel-border);border-radius:8px;
                          background:var(--panel);cursor:pointer;color:var(--text-muted);
                          transition:color 0.15s;">
             <i data-lucide="x" style="width:12px;height:12px;"></i>
           </button>
         </div>`
      : `<div style="position:relative;">
           <input type="text" class="fvi-input"
                  placeholder="Search apps…"
                  onfocus="OL.filterAppSearch('${res.id}',null,true,'')"
                  oninput="OL.filterAppSearch('${res.id}',null,true,this.value)">
           <div id="res-app-results" class="search-results-overlay"></div>
         </div>`;

  // ── STEPS LIST ───────────────────────────────────────
  const stepsList = (res.steps||[]).length > 0
    ? (res.steps).map((s, i) => {
        const assigneeBadges = (s.assignees||[]).map(a =>
          `<span class="fvi-badge fvi-badge-gray">${esc(a.name||'')}</span>`
        ).join('');
        const appBadge = s.appName
          ? `<span class="fvi-badge fvi-badge-blue">${esc(s.appName)}</span>`
          : '';
        const stepOut = (s.logic?.out || []).filter(l => l.targetId);
        const icons = [];
        if (stepOut.some(l => l.type === 'loop'))      icons.push('↺');
        if (stepOut.some(l => l.type === 'delay'))     icons.push('⏱');
        if (stepOut.some(l => l.type === 'condition') || stepOut.length > 1) icons.push('◆');
        else if (stepOut.length === 1 && !icons.length) icons.push('→');
        const logicIcon = icons.map(ic =>
            `<span class="fvi-badge" style="background:var(--accent-glow);color:var(--accent);">${ic}</span>`
        ).join('');
        const hasBadges = s.appName || (s.assignees||[]).length > 0 || icons.length > 0;

        return `
          <div class="fvi-step-row v2-step-item"
               draggable="true"
               ondragstart="OL.handleStepDragStart(event, '${res.id}', ${i})"
               ondragover="event.preventDefault(); event.stopPropagation(); this.classList.add('drag-over')"
               ondragleave="this.classList.remove('drag-over')"
               ondrop="this.classList.remove('drag-over'); OL.handleStepDrop(event, '${res.id}', ${i})"
               style="cursor:default;">
            <span class="drag-handle"
                  style="cursor:grab;opacity:0.2;flex-shrink:0;font-size:14px;
                         padding-right:4px;user-select:none;">⠿</span>
            <div class="fvi-step-num" style="background:${tc.color}18;color:${tc.color};">
              ${i+1}
            </div>
            <div style="flex:1;min-width:0;cursor:pointer;"
                 onclick="event.stopPropagation(); OL.openInspector('${res.id}','${s.id}')">
              <div class="fvi-step-name">${esc(s.name||'Unnamed Step')}</div>
              ${hasBadges ? `
                <div style="display:flex;flex-wrap:wrap;gap:3px;margin-top:4px;">
                  ${appBadge}${assigneeBadges}${logicIcon}
                </div>` : ''}
            </div>
            <div style="display:flex;align-items:center;gap:4px;flex-shrink:0;">
              <i data-lucide="chevron-right"
                 style="width:11px;height:11px;color:var(--line);cursor:pointer;"
                 onclick="event.stopPropagation(); OL.openInspector('${res.id}','${s.id}')"></i>
              <button onclick="event.stopPropagation(); OL.deleteStep('${res.id}','${s.id}')"
                      style="width:16px;height:16px;border:none;background:none;cursor:pointer;
                             color:var(--line);display:flex;align-items:center;justify-content:center;
                             border-radius:4px;padding:0;transition:color 0.15s;"
                      onmouseover="this.style.color='#ef4444'"
                      onmouseout="this.style.color='var(--line)'"
                      title="Delete step">
                <i data-lucide="x" style="width:10px;height:10px;pointer-events:none;"></i>
              </button>
            </div>
          </div>
        `;
      }).join('')
    : `<div style="padding:16px;text-align:center;color:var(--text-muted);
                   font-size:11px;font-style:italic;">
         No steps yet
       </div>`;

  // ── FULL PANEL ───────────────────────────────────────
  content.innerHTML = `
    <div class="fvi-panel">

      <!-- HEADER -->
      <div class="fvi-header">
        <div class="fvi-header-icon" style="background:${tc.color}18;color:${tc.color};">
          ${tc.abbr}
        </div>
        <div style="flex:1;min-width:0;">
          <textarea class="fvi-name-input"
                    onblur="OL.handleResourceSave('${res.id}','name',this.value)"
                    rows="1"
                    oninput="this.style.height='auto';this.style.height=this.scrollHeight+'px';"
          >${esc(res.name)}</textarea>
          <div class="fvi-header-meta">
            <span style="color:${tc.color};font-weight:700;">${esc(res.type||'')}</span>
            <span class="fvi-meta-sep">·</span>
            <span>${(res.steps||[]).length} step${(res.steps||[]).length!==1?'s':''}</span>
            ${stageName ? `<span class="fvi-meta-sep">·</span><span>${esc(stageName)}</span>` : ''}
          </div>
        </div>
        <button class="fvi-add-step-btn"
                onclick="event.stopPropagation(); OL._fvOpenStepCanvas('${res.id}')">
            <i data-lucide="workflow" style="width:11px;height:11px;"></i>
            Flow
        </button>
      </div>

      <!-- PRIMARY APP -->
      <div class="fvi-section">
        <div class="fvi-label">
          <i data-lucide="smartphone" style="width:11px;height:11px;"></i>
          Primary Application
        </div>
        ${appSection}
      </div>

      <!-- STAGE -->
      <div class="fvi-section">
        <div class="fvi-label">
            <i data-lucide="map-pin" style="width:11px;height:11px;"></i>
            Stage & Workflow
        </div>
        <select class="fvi-select"
                onchange="OL._fvAssignStageAndWorkflow('${res.id}', this.value)">
            <option value="">— Unassigned —</option>
            ${stages.map(s => {
                const stageWorkflows = (OL.getWorkflows()||[]).filter(w => w.stageId === s.id);
                const stageVal = `stage:${s.id}`;
                const stageSelected = res.stageId === s.id && !res.workflowId;
                return `
                    <option value="${stageVal}" ${stageSelected ? 'selected' : ''}>
                        ${esc(s.name)}
                    </option>
                    ${stageWorkflows.map(wf => {
                        const wfSelected = res.workflowId === wf.id;
                        return `
                            <option value="wf:${wf.id}:${s.id}" ${wfSelected ? 'selected' : ''}>
                                &nbsp;&nbsp;↳ ${esc(wf.name)}
                            </option>
                        `;
                    }).join('')}
                `;
            }).join('')}
        </select>
    </div>

      <!-- CLASSIFICATION -->
      <div class="fvi-section">
        <div class="fvi-label">
          <i data-lucide="folder" style="width:11px;height:11px;"></i>
          Classification
        </div>
        <select class="fvi-select"
                onchange="OL.handleResourceSave('${res.id}','type',this.value)">
          <option value="General" ${res.type==='General'?'selected':''}>General</option>
          ${(state.master?.resourceTypes||[]).map(t =>
            `<option value="${esc(t.type)}"
                     ${res.type===t.type?'selected':''}>
               ${esc(t.type)}
             </option>`
          ).join('')}
        </select>
      </div>

      <!-- EXTERNAL LINK -->
      <div class="fvi-section">
        <div class="fvi-label">
          <i data-lucide="link" style="width:11px;height:11px;"></i>
          ${isZap ? 'Zapier Link' : 'External Link'}
        </div>
        <input type="url" class="fvi-input"
               placeholder="https://…"
               value="${esc(res.externalLink||'')}"
               onblur="OL.handleResourceSave('${res.id}','externalLink',this.value)">
      </div>

      <!-- STEPS -->
      <div class="fvi-section" style="padding-bottom:0;">
        <div class="fvi-label fvi-label-row">
          <span style="display:flex;align-items:center;gap:5px;">
            <i data-lucide="list" style="width:11px;height:11px;"></i>
            Steps
          </span>
          <div style="display:flex;align-items:center;gap:6px;margin-left:auto;">
            <button class="fvi-add-step-btn"
                    onclick="event.stopPropagation(); OL.addNewStepToCard('${res.id}')">
              <i data-lucide="plus" style="width:11px;height:11px;"></i>
              Add
            </button>
            <button class="fvi-toggle-steps-btn"
                    onclick="OL._fvToggleStepsPanel('${res.id}')"
                    title="${stepsOpen ? 'Collapse steps' : 'Expand steps'}">
              <i data-lucide="${stepsOpen ? 'chevron-up' : 'chevron-down'}"
                 style="width:12px;height:12px;"></i>
            </button>
          </div>
        </div>
        <div id="fvi-steps-list-${res.id}"
             style="display:${stepsOpen ? 'block' : 'none'};">
          ${stepsList}
        </div>
      </div>

      <!-- DESCRIPTION -->
      <div class="fvi-section">
        <div class="fvi-label">
          <i data-lucide="file-text" style="width:11px;height:11px;"></i>
          Description
        </div>
        <textarea class="fvi-textarea"
                  placeholder="Notes…"
                  onblur="OL.handleResourceSave('${res.id}','description',this.value)"
        >${esc(res.description||'')}</textarea>
      </div>

    </div>
  `;

  if (window.lucide) lucide.createIcons();

    // 2. Fix textarea height AFTER paint
  requestAnimationFrame(() => {
    const nameInput = content.querySelector('.fvi-name-input');
    if (nameInput) {
      nameInput.style.height = 'auto';
      nameInput.style.height = nameInput.scrollHeight + 'px';
    }
    if (window.lucide) lucide.createIcons();
  });
};

export function _fvAssignStageAndWorkflow(resId, value) {
    const data = OL.getCurrentProjectData();
    const res  = (data.resources || []).find(r => String(r.id) === String(resId));
    if (!res) return;

    console.group(`🎯 Re-assigning Lane Context for: ${res.name}`);

    if (!value) {
        // Option selected is Unassigned
        res.stageId = null;
        res.workflowId = null;
        res.isGlobal = true;
        delete res.coords;
    } 
    else if (value.startsWith('stage:')) {
        // Raw Stage lane selected (not assigned to a specific workflow process track)
        const targetStageId = value.replace('stage:', '');
        res.stageId = targetStageId;
        res.workflowId = null;
        res.isGlobal = false;
    } 
    else if (value.startsWith('wf:')) {
        // Nested Workflow Process track selected
        const [, wfId, targetStageId] = value.split(':');
        res.stageId = targetStageId;
        res.workflowId = wfId;
        res.isGlobal = false;
        
        // Push the resource ID directly into the workflow structure array if missing
        const targetWf = (data.workflows || []).find(w => String(w.id) === String(wfId));
        if (targetWf) {
            if (!targetWf.resourceIds) targetWf.resourceIds = [];
            if (!targetWf.resourceIds.includes(String(resId))) {
                targetWf.resourceIds.push(String(resId));
            }
        }
    }

    console.groupEnd();

    // Persist to Firestore and snap layouts back into place safely
    OL.persist().then(() => {
        if (typeof OL.autoAlignNodes === 'function') OL.autoAlignNodes();
        if (typeof OL.syncLogicPorts === 'function') OL.syncLogicPorts();
        
        // Re-render open side views cleanly
        OL._fvOpenStepsList(resId);
    });
};

export function _fvOpenStepCanvas(resId, breadcrumb) {
    const data      = OL.getCurrentProjectData();
    const resources = data.resources || [];
    const res       = resources.find(r => String(r.id) === String(resId));
    if (!res) return;

    const tc     = OL._fvGetType(res.type);
    const steps  = res.steps || [];
    const trail  = breadcrumb || [];

    // Save scroll position
    const canvasWrap = document.getElementById('fv-canvas-wrap');
    const scrollTop  = canvasWrap?.scrollTop  || 0;
    const scrollLeft = canvasWrap?.scrollLeft || 0;

    // Build step cards top to bottom, branches to the right
    const CARD_W  = 180;
    const CARD_H  = 100;
    const GAP_X   = 80;
    const GAP_Y   = 40;
    const PAD     = 40;

    // Use _fvLayoutResource (same logic as main steps canvas) to assign row/colOffset
    const layout = OL._fvLayoutResource(res);

    // Convert layout rows → y positions using actual array order for main-path steps
    const rowY = {};
    let y = PAD;
    steps.forEach((step, idx) => {
        const li = layout[step.id];
        if (!li || li.colOffset !== 0) return; // branch — skip
        rowY[li.row] = y;
        y += CARD_H + GAP_Y;
    });

    // Build posMap: main-path steps in column 0, branches to the right
    const posMap = {};
    steps.forEach((step, idx) => {
        const li = layout[step.id] || { colOffset: 0, row: idx };
        posMap[String(step.id)] = {
            x: PAD + li.colOffset * (CARD_W + GAP_X),
            y: rowY[li.row] !== undefined ? rowY[li.row] : PAD + idx * (CARD_H + GAP_Y),
        };
    });

    // Calculate canvas size
    const maxX = Math.max(...Object.values(posMap).map(p => p.x), 0) + CARD_W + PAD;
    const maxY = Math.max(...Object.values(posMap).map(p => p.y), 0) + CARD_H + PAD;

    // Build SVG arrows
    let svgArrows = '';
    steps.forEach(s => {
        const fromPos = posMap[String(s.id)];
        if (!fromPos) return;
        (s.logic?.out || []).filter(l => l.targetId).forEach(rule => {
            const lastH   = String(rule.targetId).lastIndexOf('-');
            const tResId  = rule.targetId.substring(0, lastH);
            const tStepId = rule.targetId.substring(lastH + 1);
            const toPos   = posMap[tStepId];
            
            // 🎯 CONTEXT MATCH CORRECTION:
            // If the target step exists within our local posMap structure array, use it.
            // If not, we scan via tracking contexts to resolve cross-card references.
            if (!toPos) return;

            const isCross = String(tResId) !== String(resId);
            const isVertical = toPos.y > fromPos.y + CARD_H / 2;
            let x1, y1, x2, y2, pathD;
            if (isVertical) {
                // Bottom-center to top-center (vertical next-step arrow)
                x1 = fromPos.x + CARD_W / 2; y1 = fromPos.y + CARD_H;
                x2 = toPos.x   + CARD_W / 2; y2 = toPos.y;
                const mid = (y1 + y2) / 2;
                pathD = `M${x1},${y1} C${x1},${mid} ${x2},${mid} ${x2},${y2}`;
            } else {
                // Right-center to left-center (horizontal branch arrow)
                x1 = fromPos.x + CARD_W; y1 = fromPos.y + CARD_H / 2;
                x2 = toPos.x;            y2 = toPos.y   + CARD_H / 2;
                pathD = `M${x1},${y1} C${x1 + 40},${y1} ${x2 - 40},${y2} ${x2},${y2}`;
            }

            const color = isCross ? '#a78bfa' :
                rule.type === 'condition' ? '#f5b800' :
                rule.type === 'loop'      ? '#f97316' :
                rule.type === 'delay'     ? '#7c3aed' : '#3dd9c5';

            const dash = isCross ? '6,3' :
                rule.type === 'condition' ? '4,3' : 'none';

            svgArrows += `
                <path d="${pathD}"
                      fill="none" stroke="${color}" stroke-width="1.5"
                      ${dash !== 'none' ? `stroke-dasharray="${dash}"` : ''}
                      opacity="0.7"/>
                <circle cx="${x2}" cy="${y2}" r="3" fill="${color}" opacity="0.7"/>
            `;

            // Label for conditions/delays/loops
            if (rule.type && rule.type !== 'next') {
                const mx = isVertical ? x1 : (x1 + x2) / 2;
                const my = isVertical ? (y1 + y2) / 2 - 8 : (y1 + y2) / 2 - 8;
                const label = rule.type === 'condition' ? `If: ${(rule.rule||'').substring(0,20)}` :
                              rule.type === 'delay'     ? `⏱ ${rule.delayValue||'?'} ${rule.delayUnit||'days'}` :
                              rule.type === 'loop'      ? `↺ ${rule.loopLimit||''}` : '';
                if (label) svgArrows += `
                    <rect x="${mx - 30}" y="${my - 8}" width="60" height="14"
                          rx="3" fill="white" opacity="0.9"/>
                    <text x="${mx}" y="${my + 2}" text-anchor="middle"
                          font-size="8" fill="${color}" font-family="inherit">
                        ${esc(label.substring(0, 18))}
                    </text>
                `;
            }
        });
    });

    // Build step cards
    const cardsHtml = steps.map(s => {
        const pos = posMap[String(s.id)];
        if (!pos) return '';

        const outRules   = (s.logic?.out || []).filter(l => l.targetId);
        const crossLinks = outRules.filter(rule => {
            const lastH  = String(rule.targetId).lastIndexOf('-');
            const tResId = rule.targetId.substring(0, lastH);
            return String(tResId) !== String(resId);
        });

        // Ghost cards for cross-resource connections
        const ghostsHtml = crossLinks.map(rule => {
            const lastH   = String(rule.targetId).lastIndexOf('-');
            const tResId  = rule.targetId.substring(0, lastH);
            const tStepId = rule.targetId.substring(lastH + 1);
            const tRes    = resources.find(r => String(r.id) === tResId);
            const tStep   = tRes?.steps?.find(st => String(st.id) === tStepId);
            if (!tRes || !tStep) return '';

            const ghostX = pos.x + CARD_W + GAP_X;
            const ghostY = pos.y;

            return `
                <div style="position:absolute;left:${ghostX}px;top:${ghostY}px;
                            width:${CARD_W}px;
                            background:var(--panel-soft);border:1.5px dashed #a78bfa;
                            border-radius:10px;padding:10px;
                            opacity:0.75;cursor:pointer;"
                     onclick="OL._fvOpenStepCanvas('${tResId}', ${JSON.stringify([...trail, {resId, name: res.name}])})">
                    <div style="font-size:8px;font-weight:700;text-transform:uppercase;
                                letter-spacing:0.06em;color:#a78bfa;margin-bottom:4px;">
                        🌐 ${esc(tRes.name.substring(0, 16))}
                    </div>
                    <div style="font-size:11px;font-weight:500;color:var(--text-dim);
                                line-height:1.3;">
                        ${esc(tStep.name || 'Unnamed')}
                    </div>
                    <div style="font-size:9px;color:#a78bfa;margin-top:6px;">
                        Switch context →
                    </div>
                </div>
            `;
        }).join('');

        const icons = [];
        if (outRules.some(l => l.type === 'loop'))      icons.push('↺');
        if (outRules.some(l => l.type === 'delay'))     icons.push('⏱');
        if (outRules.some(l => l.type === 'condition')) icons.push('◆');

        // 🎯 UNIQUE ELEMENT REGISTRY: Match contextual id identifiers per copy on step layout canvas
        const stepContainerHtmlId = res.workflowId ? `fvi-step-${s.id}-${res.workflowId}` : `fvi-step-${s.id}`;

        return `
            ${ghostsHtml}
            <div style="position:absolute;left:${pos.x}px;top:${pos.y}px;
                        width:${CARD_W}px;
                        background:var(--panel);border:1.5px solid #e5e7eb;
                        border-radius:10px;overflow:hidden;cursor:pointer;
                        box-shadow:0 1px 3px rgba(0,0,0,0.06);
                        transition:border-color 0.15s,box-shadow 0.15s;"
                 id="${stepContainerHtmlId}"
                 onmouseover="this.style.borderColor='#3dd9c5';this.style.boxShadow='0 4px 14px rgba(61,217,197,0.2)'"
                 onmouseout="this.style.borderColor='#e5e7eb';this.style.boxShadow='0 1px 3px rgba(0,0,0,0.06)'"
                 onclick="OL.openInspector('${res.id}','${s.id}')">
                <div style="height:3px;background:${tc.color};"></div>
                <div style="padding:8px 10px;">
                    <div style="font-size:9px;font-weight:700;text-transform:uppercase;
                                letter-spacing:0.06em;color:${tc.color};margin-bottom:4px;">
                        ${tc.abbr} · ${String(steps.indexOf(s) + 1).padStart(2,'0')}
                    </div>
                    <div style="font-size:12px;font-weight:500;color:var(--text-main);
                                line-height:1.35;margin-bottom:6px;">
                        ${esc(s.name || 'Unnamed Step')}
                    </div>
                    <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;">
                        ${s.appName ? `<span style="font-size:9px;padding:1px 5px;border-radius:99px;
                                                    background:#f5f6f8;color:var(--text-dim);">${esc(s.appName)}</span>` : ''}
                        ${icons.map(ic => `<span style="font-size:9px;padding:1px 5px;border-radius:99px;
                                                    background:var(--accent-glow);color:var(--accent);
                                                    font-weight:700;">${ic}</span>`).join('')}
                    </div>
                </div>
            </div>
        `;
    }).join('');

    // Breadcrumb trail
    const breadcrumbHtml = trail.length > 0 ? `
        <div style="position:sticky;top:0;z-index:20;background:var(--panel);
                    border-bottom:0.5px solid var(--panel-border);padding:8px 16px;
                    display:flex;align-items:center;gap:6px;font-size:11px;">
            <span onclick="OL.renderVisualizer()"
                  style="color:var(--text-muted);cursor:pointer;">
                <i data-lucide="layout-dashboard" style="width:11px;height:11px;"></i> Map
            </span>
            ${trail.map((t, i) => `
                <span style="color:var(--line);">›</span>
                <span onclick="OL._fvOpenStepCanvas('${t.resId}', ${JSON.stringify(trail.slice(0,i))})"
                      style="color:#3dd9c5;cursor:pointer;">
                    ${esc(t.name)}
                </span>
            `).join('')}
            <span style="color:var(--line);">›</span>
            <span style="color:var(--text-main);font-weight:500;">${esc(res.name)}</span>
            <button onclick="OL.renderVisualizer()"
                    class="fv-btn fv-icon" style="margin-left:auto;">
                <i data-lucide="x" style="width:12px;height:12px;"></i>
            </button>
        </div>
    ` : `
        <div style="position:sticky;top:0;z-index:20;background:var(--panel);
                    border-bottom:0.5px solid var(--panel-border);padding:8px 16px;
                    display:flex;align-items:center;gap:8px;">
            <button onclick="OL.renderVisualizer()" class="fv-btn" style="font-size:11px;">
                <i data-lucide="arrow-left" style="width:12px;height:12px;"></i> Back to map
            </button>
            <div style="width:8px;height:8px;border-radius:50%;background:${tc.color};"></div>
            <span style="font-size:13px;font-weight:500;color:var(--text-main);">${esc(res.name)}</span>
            <span style="font-size:11px;color:var(--text-muted);">${steps.length} steps</span>
            <button onclick="OL.addNewStepToCard('${res.id}')"
                    class="fv-btn" style="margin-left:auto;font-size:11px;">
                <i data-lucide="plus" style="width:12px;height:12px;"></i> Add Step
            </button>
        </div>
    `;

    // Replace main canvas content
    const mainArea = document.getElementById('mainContent');
    if (!mainArea) return;

    mainArea.innerHTML = `
        <div style="display:flex;flex-direction:column;height:100%;overflow:hidden;">
            ${breadcrumbHtml}
            <div style="flex:1;overflow:auto;position:relative;background:#f5f6f8;">
                <div style="position:relative;width:${maxX}px;height:${maxY}px;min-width:100%;min-height:100%;">
                    <svg style="position:absolute;top:0;left:0;width:100%;height:100%;
                                pointer-events:none;overflow:visible;">
                        <defs>
                            <marker id="sc-arrow" markerWidth="6" markerHeight="6"
                                    refX="5" refY="3" orient="auto">
                                <path d="M0,0 L0,6 L6,3 z" fill="#3dd9c5" opacity="0.7"/>
                            </marker>
                        </defs>
                        ${svgArrows}
                    </svg>
                    ${cardsHtml}
                </div>
            </div>
        </div>
    `;

    if (window.lucide) lucide.createIcons();
};

// Toggle steps list open/closed without full re-render
export function _fvToggleStepsPanel(resId) {
  if (!OL._fv._stepsOpen) OL._fv._stepsOpen = {};
  OL._fv._stepsOpen[resId] = !OL._fv._stepsOpen[resId];
  const isOpen = OL._fv._stepsOpen[resId];

  const list = document.getElementById(`fvi-steps-list-${resId}`);
  if (list) list.style.display = isOpen ? 'block' : 'none';

  // Update chevron
  const btn = list?.previousElementSibling?.querySelector('.fvi-toggle-steps-btn i');
  if (btn) {
    btn.setAttribute('data-lucide', isOpen ? 'chevron-up' : 'chevron-down');
    if (window.lucide) lucide.createIcons();
  }
};

export function _fvRenderListStep(step, res, stepIdx, globalIds, allResources, depth, visited, contextWfId = null) {
    // Guard against infinite recursion and excessive depth
    if (depth > 5) return '';
    if (!visited) visited = new Set();
    
    // 🎯 UNIQUE REGISTRY KEYS FOR GLOBAL COPIES
    // We add the context ID string to the tracking key so the anti-duplication shield 
    // treats separate workflow tracks as completely independent lane instances.
    const stepKey = contextWfId ? `${res.id}-${step.id}-${contextWfId}` : `${res.id}-${step.id}`;
    if (visited.has(stepKey)) return '';
    visited.add(stepKey);

    const tc = OL._fvGetType(res.type);
    const isGlobal      = globalIds.has(String(res.id));
    const isDecision    = (step.logic?.out || []).filter(l => l.targetId).length > 1;
    const hasLoop       = (step.logic?.out || []).some(l => l.type === 'loop');
    const isConditional = isDecision || (step.logic?.out || []).some(l => l.rule?.trim());
    
    const outRules = (step.logic?.out || []).filter(l => {
        if (!l.targetId) return false;
        if (OL._fv.showArchived) return true;
        const lastH  = String(l.targetId).lastIndexOf('-');
        const tResId = l.targetId.substring(0, lastH);
        const tRes   = allResources.find(r => String(r.id) === String(tResId));
        return !tRes?.isArchived;
    });

    // 🎯 CONTEXT-AWARE HOOK IDENTIFIERS
    const collapseId = contextWfId ? `fv-substeps-${step.id}-${contextWfId}` : `fv-substeps-${step.id}`;
    const resBadgeBg = tc.color + '18';
    
    const resBadge = `<span class="fv-list-res-badge"
        style="background:${resBadgeBg};color:${tc.color};border:1px solid ${tc.color}30;cursor:pointer;"
        onclick="event.stopPropagation();
                 document.querySelectorAll('.fv-list-item.selected').forEach(e=>e.classList.remove('selected'));
                 OL._fvOpenStepsList('${res.id}');">
        ${tc.abbr} ${esc(res.name.substring(0, 14))}
      </span>`;

    let inlineRoutingBadgesHtml = '';
    let nestedBranchesHtml = '';
    let hasNesting = false;
    
    const isIndentedChild = depth > 0;

    outRules.forEach(rule => {
        const lastH   = String(rule.targetId).lastIndexOf('-');
        const tResId  = rule.targetId.substring(0, lastH);
        const tStepId = rule.targetId.substring(lastH + 1);
        const tRes    = allResources.find(r => String(r.id) === String(tResId));
        const tStep   = tRes?.steps?.find(s => String(s.id) === String(tStepId));
        if (!tRes || !tStep) return;

        const nextSequentialStep = res.steps[stepIdx + 1];
        const isSubsequentLocalStep = (String(tResId) === String(res.id)) && nextSequentialStep && (String(tStepId) === String(nextSequentialStep.id));

        const isLoop  = rule.type === 'loop';
        const isDelay = rule.type === 'delay';
        const isCond  = rule.type === 'condition' || (rule.rule && rule.rule.trim().length > 0);
        
        const targetLabel = `${tRes.name.substring(0,12)} › ${tStep.name || 'Step'}`;
        
        // 🎯 TARGET CLONE COPIES IN SCROLL JUMPS
        // If the current step lives in a workflow context lane, ensure the smooth-scrolling target
        // looks for its neighboring step copy inside that exact same layout track!
        const jumpTargetHtmlId = contextWfId ? `fv-list-step-${tStepId}-${contextWfId}` : `fv-list-step-${tStepId}`;

        // 🔀 PATH A: Structural Conditional Cascading
        if (isCond) {
            hasNesting = true;
            const ruleText = rule.rule && rule.rule.trim() ? rule.rule.trim() : 'Conditional';

            if (!window._fvRenderedStepRegistry) window._fvRenderedStepRegistry = new Set();
            window._fvRenderedStepRegistry.add(stepKey);

            nestedBranchesHtml += `
                <div class="fv-list-branch" style="margin-top: 6px; position: relative;">
                    <div class="fv-branch-label" style="color:#10b981; display:flex; align-items:center; gap:6px; font-size:11px; font-weight:700; letter-spacing:0.02em; padding-left: ${28 + (depth * 12)}px; margin-bottom: 4px;">
                        <i data-lucide="git-commit" style="width:12px; height:12px; color:#10b981;"></i> 
                        <span>IF: ${esc(ruleText.toUpperCase())}</span>
                    </div>
                    ${OL._fvRenderListStep(tStep, tRes, tRes.steps.indexOf(tStep), globalIds, allResources, depth + 1, visited, contextWfId)}
                </div>`;
        } 
        // 🔀 PATH B: Flat Inline Badge Indicators (Loops, Delays, Jumps)
        else if (isLoop || isDelay || !isSubsequentLocalStep) {
            let badgeStyle = "background:rgba(255,255,255,0.03); color:var(--text-muted); border:1px solid var(--line);";
            let badgeText = `➔ Jump: ${targetLabel}`;
            let clickAction = '';

            if (!isSubsequentLocalStep) {
                clickAction = `onclick="event.stopPropagation(); const targetRow = document.getElementById('${jumpTargetHtmlId}'); if(targetRow) { targetRow.scrollIntoView({ behavior: 'smooth', block: 'center' }); document.querySelectorAll('.fv-list-item.selected').forEach(e=>e.classList.remove('selected')); targetRow.classList.add('selected'); targetRow.style.outline='2px solid var(--accent)'; setTimeout(()=>targetRow.style.outline='',1500); }"`;
            }

            if (isLoop) {
                badgeStyle = "background:rgba(245,184,0,0.06); color:#f5b800; border:1px solid rgba(245,184,0,0.2);";
                badgeText = `Loop${rule.loopLimit ? ` (${rule.loopLimit})` : ''} ➔ ${targetLabel}`;
            } else if (isDelay) {
                badgeStyle = "background:rgba(167,139,250,0.06); color:#a78bfa; border:1px solid rgba(167,139,250,0.2);";
                badgeText = `Delay: ${rule.delayValue || '?'} ${rule.delayUnit || 'days'} ➔ ${targetLabel}`;
            } else if (!isSubsequentLocalStep) {
                badgeStyle = "background:rgba(56,189,248,0.08); color:#38bdf8; border:1px solid rgba(56,189,248,0.25); cursor:pointer;";
                badgeText = `🔀 Skip To: ${targetLabel} ➔`;
            }

            if (rule.rule && rule.rule.trim() && !isCond) {
                badgeText = `[If: "${rule.rule.trim()}"] ${badgeText}`;
            }

            inlineRoutingBadgesHtml += `
                <span class="pill tiny split-jump-badge" ${clickAction} style="display:inline-flex; align-items:center; gap:4px; font-size:9px; font-weight:700; padding:2px 6px; border-radius:4px; ${badgeStyle}">
                    ${esc(badgeText)}
                </span>`;
        }
    });

    // 🛡️ THE ANTI-DUPLICATION SHIELD:
    if (!isIndentedChild && window._fvRenderedStepRegistry && window._fvRenderedStepRegistry.has(stepKey)) {
        return ''; 
    }

    const tags = [
        isGlobal ? `<span class="fv-list-tag global">🌐 Global</span>` : '',
        hasLoop   ? `<span class="fv-list-tag loop">↺ Loop</span>`      : '',
        (isDecision) ? `<span class="fv-list-tag conditional">◆ Decision</span>` : '',
        (isConditional && !isDecision) ? `<span class="fv-list-tag conditional">◆ Conditional</span>` : ''
    ].filter(Boolean).join('');

    // 🎯 CONTEXT-ISOLATED INTERACTION SURFACE
    const customRowElementHtmlId = contextWfId ? `fv-list-step-${step.id}-${contextWfId}` : `fv-list-step-${step.id}`;

    return `
    <div style="margin-bottom: 4px; margin-left:${isIndentedChild ? '24px' : '0px'};">
      <div class="fv-list-row" style="${isIndentedChild ? 'border-left: 2px dashed rgba(61,217,197,0.25); padding-left: 12px;' : ''}">
        <div class="fv-tree-connector"></div>
        <div class="fv-list-item ${isDecision ? 'is-decision' : ''} ${isGlobal ? 'is-global' : ''}"
             id="${customRowElementHtmlId}"
             data-step-id="${step.id}"
             data-res-id="${res.id}"
             data-context-wf-id="${contextWfId || ''}"
             draggable="true"
             ondragstart="event.stopPropagation(); OL.handleStepDragStart(event, '${res.id}', ${res.steps.indexOf(step)})"
             ondragover="event.preventDefault(); event.stopPropagation(); this.classList.add('drag-over')"
             ondragleave="this.classList.remove('drag-over')"
             ondrop="event.stopPropagation(); this.classList.remove('drag-over'); OL.handleStepDrop(event, '${res.id}', ${res.steps.indexOf(step)})"
             onclick="event.stopPropagation();
                      document.querySelectorAll('.fv-list-item.selected').forEach(e=>e.classList.remove('selected'));
                      this.classList.add('selected');
                      OL.openInspector('${res.id}', '${step.id}');">
          <span class="drag-handle" style="cursor:grab; opacity:0.25; flex-shrink:0; padding-right:4px; font-size:14px;">⠿</span>
          <div class="fv-list-type-dot" style="background:${tc.color}; margin-top:5px;"></div>
          
          <div style="display:flex; flex-direction:column; gap:1px; flex:1; min-width:0;">
              <span class="fv-list-step-name ${isDecision ? 'decision-name' : ''}" style="font-weight:600; font-size:13px; color:var(--text-main);">${esc(step.name || 'Unnamed Step')}</span>
              
              ${inlineRoutingBadgesHtml ? `<div style="display:flex; flex-wrap:wrap; gap:4px; margin-top:4px;">${inlineRoutingBadgesHtml}</div>` : ''}
          </div>

          ${tags}
          ${resBadge}
          ${hasNesting ? `
            <span class="fv-substep-toggle"
                      onclick="event.stopPropagation();
                               const el=document.getElementById('${collapseId}');
                               const collapsed=el.style.display==='none';
                               el.style.display=collapsed?'block':'none';
                               this.textContent=collapsed?'−':'+';
                               this.title=collapsed?'Collapse':'Expand';"
                      title="Collapse"
                      style="margin-left:auto; flex-shrink:0; width:18px; height:18px;
                             border-radius:4px; background:rgba(255,255,255,0.03); border:1px solid var(--line);
                             display:flex; align-items:center; justify-content:center;
                             font-size:11px; font-weight:700; color:var(--text-muted); cursor:pointer;
                             line-height:1;">−</span>
            ` : ''}
        </div>
      </div>
      ${hasNesting ? `<div id="${collapseId}">${nestedBranchesHtml}</div>` : ''}
    </div>
  `;
};

// ══════════════════════════════════════════════
// SHARED CONTROLS
// ══════════════════════════════════════════════

export function fvSearch(query) {
  OL._fv._searchQuery = query;
  const q   = (query || '').toLowerCase().trim();
  const nav = document.getElementById('fv-search-nav');

  if (OL._fv.layout === 'flowchart') {
    document.querySelectorAll('.fv-card').forEach(el => el.classList.remove('search-match','search-active','dimmed'));
  } else {
    document.querySelectorAll('.fv-list-item').forEach(el => el.classList.remove('search-match','dimmed'));
  }

  if (!q) {
    OL._fv.searchMatches = []; OL._fv.searchIdx = -1;
    if (nav) nav.style.display = 'none';
    return;
  }

  const data = OL.getCurrentProjectData();
  const resources = (data.resources || []).filter(r => !r.isDeleted && !r.isLocked);

  let matches = [];
  if (OL._fv.layout === 'flowchart') {
    matches = resources
      .filter(r => (r.name||'').toLowerCase().includes(q) || (r.type||'').toLowerCase().includes(q))
      .map(r => ({ type: 'card', id: r.id }));
    document.querySelectorAll('.fv-card').forEach(el => {
      const hit = matches.some(m => m.id === el.dataset.resId);
      el.classList.toggle('search-match', hit);
      el.classList.toggle('dimmed', !hit);
    });
  } else {
    resources.forEach(r => {
      (r.steps || []).forEach(s => {
        if ((s.name||'').toLowerCase().includes(q) || (r.name||'').toLowerCase().includes(q)) {
          matches.push({ type: 'step', id: s.id, resId: r.id });
        }
      });
    });
    document.querySelectorAll('.fv-list-item').forEach(el => {
      const hit = matches.some(m => m.id === el.dataset.stepId);
      el.classList.toggle('search-match', hit);
      el.classList.toggle('dimmed', !hit);
    });
  }

  OL._fv.searchMatches = matches;
  OL._fv.searchIdx = matches.length > 0 ? 0 : -1;

  if (nav) nav.style.display = matches.length ? 'flex' : 'none';
  if (matches.length) OL.fvActivateMatch();

  const count = document.getElementById('fv-match-count');
  if (count) count.textContent = matches.length ? `1/${matches.length}` : '0/0';
};

export function fvNextMatch() {
  if (!OL._fv.searchMatches?.length) return;
  OL._fv.searchIdx = (OL._fv.searchIdx + 1) % OL._fv.searchMatches.length;
  OL.fvActivateMatch();
};
export function fvPrevMatch() {
  if (!OL._fv.searchMatches?.length) return;
  OL._fv.searchIdx = (OL._fv.searchIdx - 1 + OL._fv.searchMatches.length) % OL._fv.searchMatches.length;
  OL.fvActivateMatch();
};
export function fvActivateMatch() {
  const match = OL._fv.searchMatches[OL._fv.searchIdx];
  if (!match) return;

  const sel = OL._fv.layout === 'flowchart'
    ? document.getElementById(`fv-card-${match.id}`)
    : document.getElementById(`fv-list-step-${match.id}`);

  document.querySelectorAll('.fv-card.search-active, .fv-list-item.search-active')
    .forEach(el => el.classList.remove('search-active'));

  if (sel) {
    sel.classList.add('search-active');
    sel.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
  }
  const count = document.getElementById('fv-match-count');
  if (count) count.textContent = `${OL._fv.searchIdx + 1}/${OL._fv.searchMatches.length}`;
};
export function fvClearSearch() {
  OL._fv._searchQuery = '';
  const input = document.getElementById('fv-search');
  if (input) input.value = '';
  OL.fvSearch('');
};

export function fvToggleConnections() {
  OL._fv.showConnections = !OL._fv.showConnections;
  const data = OL.getCurrentProjectData();
  const resources = (data.resources || []).filter(r => !r.isDeleted && !r.isLocked);
  OL._fvDrawConnections(resources);
  // Re-render just the button
  const btn = document.getElementById('fv-conn-btn');
  if (btn) btn.classList.toggle('fv-active', OL._fv.showConnections);
};

export function _fvSetupZoom() {
  const wrap = document.getElementById('fv-canvas-wrap');
  if (!wrap) return;
  wrap.addEventListener('wheel', e => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    OL.fvZoom(e.deltaY > 0 ? -0.08 : 0.08);
  }, { passive: false });
};

export function fvZoom(delta) {
  OL._fv.zoom = Math.min(2, Math.max(0.3, (OL._fv.zoom || 1) + delta));
  const canvas = document.getElementById('fv-canvas');
  if (canvas) { canvas.style.transform = `scale(${OL._fv.zoom})`; canvas.style.transformOrigin = 'top left'; }
  const label = document.getElementById('fv-zoom-label');
  if (label) label.textContent = Math.round(OL._fv.zoom * 100) + '%';
};

export function handleSidebarSearch(e) {
    const val = e.target.value;
    
    // 1. Update the global state immediately
    state.ui.sidebarSearchQuery = val;
    
    // 2. ONLY render the items, do NOT call OL.renderVisualizer()
    // This prevents the map, stages, and toolbar from flashing/resetting
    OL.renderWorkbenchItemsOnly();
    
    // 3. Force focus back just in case the browser tried to blur it
    e.target.focus();
};

export function getStepIcon(step) {
    if (!step.links || step.links.length === 0) return 'circle'; // Generic dot
    
    const linked = step.links.map(l => ({
        ...l,
        res: OL.getResourceById(l.id)
    }));

    const check = (str) => {
        const s = str.toLowerCase();
        return linked.some(l => 
            l.type?.toLowerCase().includes(s) || 
            l.res?.type?.toLowerCase().includes(s) ||
            l.name?.toLowerCase().includes(s)
        );
    };

    // Return Lucide Icon Slugs
    if (check('email')) return 'mail';
    if (check('form')) return 'file-text';
    if (check('event') || check('scheduler')) return 'calendar';
    if (check('guide') || check('sop')) return 'book-open';
    if (check('signature') || check('sig-')) return 'pen-tool';
    
    if (check('zap') || check('automation')) return 'zap';
    if (check('database') || check('sheet')) return 'table-2';
    if (check('legal') || check('contract')) return 'file-signature';
    if (check('folder') || check('file')) return 'folder';
    if (check('video') || check('recording')) return 'video';
    if (check('payment') || check('invoice')) return 'banknote';

    return 'link'; 
};

export function renderWorkbenchTabs() {
    const tabs = [
        { id: 'flows', label: 'Flows', icon: 'workflow', color: 'var(--accent)' },
        { id: 'assets', label: 'Assets', icon: 'database', color: '#38bdf8' },
        { id: 'guides', label: 'Guides', icon: 'book-open', color: '#fbbf24' },
        { id: 'data', label: 'Data', icon: 'tag', color: '#a78bfa' }
    ];

    return `
        <div class="workbench-header" style="background: rgba(0,0,0,0.3); border-bottom: 1px solid var(--line);">
            <div class="workbench-tab-bar" style="display: flex;">
                ${tabs.map(t => `
                    <div class="wb-tab ${state.ui.activeWorkbenchTab === t.id ? 'active' : ''}" 
                        onclick="OL.switchWorkbenchTab('${t.id}')" 
                        style="flex:1; padding: 12px 5px; text-align:center; cursor:pointer; 
                                border-bottom: 2px solid ${state.ui.activeWorkbenchTab === t.id ? t.color : 'transparent'};
                                color: ${state.ui.activeWorkbenchTab === t.id ? t.color : 'var(--text-dim)'};
                                display: flex; flex-direction: column; align-items: center; gap: 4px;">
                        
                        <i data-lucide="${t.icon}" style="width:14px; height:14px;"></i>
                        <span style="font-size:9px; font-weight:bold;">${t.label.toUpperCase()}</span>
                    </div>
                `).join('')}
            </div>
            
            <div class="sidebar-search-wrap" style="padding: 10px; border-top: 1px solid rgba(255,255,255,0.05); display: flex; flex-direction: column; gap: 8px;">
                <input type="text" id="sidebar-search-input" 
                  placeholder="Search ${state.ui.activeWorkbenchTab}..." 
                  value="${state.ui.sidebarSearchQuery || ''}"
                  oninput="OL.handleSidebarSearch(event)"
                  autocomplete="off"
                  style="width: 100%; background: rgba(0,0,0,0.2); border: 1px solid var(--line); color: white; padding: 6px 10px; border-radius: 4px; font-size: 11px;">
                
                <div id="sidebar-sub-filter-container">
                    ${state.ui.activeWorkbenchTab === 'assets' ? OL.renderSidebarTypeFilter() : ''}
                </div>
            </div>
        </div>
    `;
};

if (state.v2.hideLinkedAssets === undefined) state.v2.hideLinkedAssets = false;

export function renderSidebarTypeFilter() {
    const activeTab = state.ui.activeWorkbenchTab;
    const hideLinked = state.v2.hideLinkedAssets;
    
    // 🛡️ Guard: Only show filters for Assets and Guides
    if (activeTab !== 'assets' && activeTab !== 'guides') return '';

    // Only show the type dropdown if we are on the Assets tab
    let typeDropdown = '';
    if (activeTab === 'assets') {
        const data = OL.getCurrentProjectData();
        const resources = data.resources || [];
        const types = [...new Set(resources.filter(r => !['Workflow', 'Zap', 'Email Campaign'].includes(r.type)).map(r => r.type))].filter(Boolean).sort();
        
        typeDropdown = `
            <select class="modal-input tiny" 
                    onchange="state.v2.trayTypeFilter = this.value; OL.renderWorkbenchItemsOnly();" 
                    style="margin:0; background: rgba(0,0,0,0.2); border-color: var(--line); font-size: 10px; color: white; width: 100%;">
                <option value="All">All Asset Types</option>
                ${types.map(t => `<option value="${t}" ${state.v2.trayTypeFilter === t ? 'selected' : ''}>${t}</option>`).join('')}
            </select>
        `;
    }

    // 🏗️ The Wrapper: This now returns for both Assets AND Guides
    return `
        <div style="display: flex; flex-direction: column; gap: 8px; padding-top: 4px;">
            ${typeDropdown}
            <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; user-select: none; padding-left: 2px;">
                <input type="checkbox" ${hideLinked ? 'checked' : ''} 
                       onchange="state.v2.hideLinkedAssets = this.checked; OL.renderWorkbenchItemsOnly();"
                       style="width: 12px; height: 12px; cursor: pointer;">
                <span class="tiny muted" style="font-size: 9px; text-transform: uppercase; font-weight: bold; letter-spacing: 0.5px;">
                    Hide Already Linked
                </span>
            </label>
        </div>
    `;
};

export function renderWorkbenchItemsOnly() {
    const workbenchContents = document.getElementById('workbench-contents');
    if (!workbenchContents) return;

    const activeTab = state.ui.activeWorkbenchTab || 'flows';
    const query = (state.ui.sidebarSearchQuery || "").toLowerCase();
    const data = OL.getCurrentProjectData();
    const resources = (data.resources || []).filter(r => !r.isDeleted && !r.isLocked);

    // 🕵️ BUILD LINKED SET
    const linkedIds = new Set();
    resources.forEach(res => {
        (res.steps || []).forEach(step => {
            (step.links || []).forEach(link => linkedIds.add(String(link.id)));
            if (step.howToIds) step.howToIds.forEach(id => linkedIds.add(String(id)));
        });
    });

    let items = [];
    if (activeTab === 'flows') {
        items = resources.filter(r => ['Workflow', 'Zap', 'Email Campaign'].includes(r.type) && !r.coords);
    } else if (activeTab === 'assets') {
        items = resources.filter(r => !['Workflow', 'Zap', 'Email Campaign'].includes(r.type) && !r.coords);
    } else if (activeTab === 'guides') {
        items = [...(state.master.howToLibrary || []), ...(getActiveClient()?.projectData?.localHowTo || [])];
    } else if (activeTab === 'data') {
        const client = getActiveClient();
        items = client?.projectData?.localDatapoints?.length 
            ? client.projectData.localDatapoints 
            : (state.master.datapoints || []);
    }

    if (query.trim()) {
        items = items.filter(i => (i.name || i.title || "").toLowerCase().includes(query.trim()));
    }

    workbenchContents.innerHTML = '';
    
    items.forEach(item => {
        const div = document.createElement('div');
        div.id = `wb-node-${item.id}`;
        div.className = activeTab === 'data' ? 'data-tag-draggable' : 'v2-node-card on-shelf';
        div.draggable = true;
        
        div.addEventListener('dragstart', (e) => {
            if (activeTab === 'data') {
                e.dataTransfer.setData("application/sphynx-type", "datapoint");
                e.dataTransfer.setData("application/sphynx-id", item.id);
            } else {
                e.dataTransfer.setData('text/plain', item.id);
                e.dataTransfer.effectAllowed = "move";
            }
            e.target.style.opacity = "0.5";
        });

        div.addEventListener('dragend', (e) => { e.target.style.opacity = "1"; });

        // 🎯 FIXED: Icon Resolution using 'item' instead of 'res'
        let iconName = "";
        if (activeTab === 'data') {
            iconName = item.isBundle ? "package" : "tag";
        } else {
            // Using the registry helper we updated earlier
            iconName = OL.getRegistryIcon(item.type);
        }

        div.innerHTML = `
            <div class="v2-node-header" style="pointer-events: none;">
                <div class="header-row-content" style="display:flex; align-items:center;">
                    <i data-lucide="${iconName}" style="width:14px; height:14px; margin-right:8px; color: var(--accent); flex-shrink:0;"></i>
                    <b class="res-name-text" style="font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                        ${esc(item.name || item.title)}
                    </b>
                </div>
            </div>`;
            
        workbenchContents.appendChild(div);
    });

    // 🚀 THE REPAINT TRIGGER
    if (window.lucide) {
        window.lucide.createIcons();
    }
};

export function switchWorkbenchTab(tabId) {
    // 1. Update the logical state
    state.ui.activeWorkbenchTab = tabId;
    
    // 2. 🚀 SURGICAL CSS UPDATE: Update tab highlights without a full redraw
    const tabs = document.querySelectorAll('.wb-tab');
    tabs.forEach(tab => {
        // We look for the function call inside the onclick to identify the tab
        if (tab.getAttribute('onclick').includes(`'${tabId}'`)) {
            tab.classList.add('active');
            // Force the specific styling you defined in renderWorkbenchTabs
            tab.style.color = "var(--accent)"; 
            tab.style.borderBottom = "2px solid var(--accent)";
        } else {
            tab.classList.remove('active');
            tab.style.color = "var(--text-dim)";
            tab.style.borderBottom = "2px solid transparent";
        }
    });

    // 3. Update the sidebar sub-filters (important for the Assets checkbox)
    const filterContainer = document.getElementById('sidebar-sub-filter-container');
    if (filterContainer) {
        filterContainer.innerHTML = OL.renderSidebarTypeFilter();
    }

    // 4. Refresh the list content
    OL.renderWorkbenchItemsOnly();
};

OL.switchWorkbenchTab(state.ui.activeWorkbenchTab);

// DRAG ASSET/GUIDE
export function handleAssetDragStart(e, id, type) {
    e.dataTransfer.setData("application/sphynx-type", type); // 'asset' or 'guide'
    e.dataTransfer.setData("application/sphynx-id", id);
    e.dataTransfer.effectAllowed = "link";
};

// DRAG DATAPOINT
export function handleDataDragStart(e, id) {
    e.dataTransfer.setData("application/sphynx-type", "datapoint");
    e.dataTransfer.setData("application/sphynx-id", id);
};

// STEP DROP ZONE HANDLER (Update your existing Step HTML to include this)
// ondrop="OL.handleUniversalDropOnStep(event, '${res.id}', '${step.id}')"
export async function handleUniversalDropOnStep(e, resId, stepId) {
    e.preventDefault();
    const type = e.dataTransfer.getData("application/sphynx-type");
    const id = e.dataTransfer.getData("application/sphynx-id");

    const data = OL.getCurrentProjectData();
    const res = data.resources.find(r => String(r.id) === String(resId));
    const step = res?.steps?.find(s => String(s.id) === String(stepId));
    
    if (!step) return;

    await OL.updateAndSync(() => {
        if (type === 'datapoint') {
            if (!step.datapoints) step.datapoints = [];
            const dp = state.master.datapoints.find(d => d.id === id);
            
            if (dp.isBundle) {
                // Expand bundle and add all children
                dp.childIds.forEach(childId => {
                    const child = state.master.datapoints.find(c => c.id === childId);
                    if (child && !step.datapoints.some(existing => existing.id === child.id)) {
                        step.datapoints.push(child);
                    }
                });
            } else {
                if (!step.datapoints.some(existing => existing.id === id)) {
                    step.datapoints.push(dp);
                }
            }
            console.log(`🏷️ Mapped data to step: ${step.name}`);
        }
    });

    OL.renderVisualizer();
};

export function renderTrayContent(isVault, query = "", typeFilter = "All") {
};

document.addEventListener('mousedown', function(e) {
    const badge = e.target.closest('.action-duplicate');
    if (badge) {
        // 🛑 KILL THE EVENT IMMEDIATELY
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        const resId = badge.getAttribute('data-id');
        console.log("🚀 Manual Intercept: Duplicating", resId);
        
        // Trigger the duplicate function
        OL.duplicateResourceV2(resId);
    }
}, true); // 🎯 The 'true' is critical: it uses 'Capture' phase to catch the click first

// Global to track the dragged index
state.draggingStepIdx = null;

export function renderFocusControls() {
    let scopeBtn = document.getElementById('exit-focus-btn');
    
    // 1. If no focus, remove the button and stop
    if (!OL.focusedResourceId) {
        if (scopeBtn) scopeBtn.remove();
        return;
    }

    // 2. Determine destination text
    const savedPath = sessionStorage.getItem('map_return_path') || "/scoping-sheet";
    const destinationName = savedPath.includes('resources') ? 'Library' : 'Scope';

    // 3. Create button if it doesn't exist
    if (!scopeBtn) {
        scopeBtn = document.createElement('button');
        scopeBtn.id = 'exit-focus-btn';
        document.body.appendChild(scopeBtn);
    }

    // 4. Update Button Content & Action
    scopeBtn.innerHTML = `⬅️ Back to ${destinationName}`;
    scopeBtn.style.display = 'block';
    
    scopeBtn.onclick = () => {
        const savedPath = sessionStorage.getItem('map_return_path') || "/scoping-sheet";
        
        // 1. Reset Focus State
        OL.focusedResourceId = null;
        sessionStorage.removeItem('active_resource_id');
        sessionStorage.removeItem('map_return_path');

        // 2. Nuke the Map Container (Instant)
        const mainArea = document.getElementById('mainContent');
        if (mainArea) mainArea.innerHTML = ''; 

        // 3. Update the URL (Silent)
        window.location.hash = savedPath;

        // 4. 🚀 THE "INSTANT SWAP"
        // We check the path and call the specific "Render" function for that page
        if (savedPath.includes('scoping-sheet')) {
            if (typeof OL.renderScopingSheet === 'function') {
                OL.renderScopingSheet(); 
            } else if (typeof OL.renderScope === 'function') {
                OL.renderScope();
            } else {
                window.location.reload(); // Fallback if name is unknown
            }
        } else if (savedPath.includes('resources')) {
            if (typeof OL.renderResources === 'function') {
                OL.renderResources();
            } else if (typeof OL.showResources === 'function') {
                OL.showResources();
            } else {
                window.location.reload();
            }
        }

        scopeBtn.remove();
    };
        
    // 🛑 REMOVED: The self-calling line that was causing the crash
};

export function exitVisualFocus() {
    // 1. Clear the focus variable
    OL.focusedResourceId = null;

    // 2. Re-render the map (this removes the .node-dimmed classes)
    OL.renderVisualizer();

    // 3. Hide the focus controls
    OL.renderFocusControls();

    // 4. Optional: If you want to literally switch 'Views' back to a list
    // if (typeof OL.setView === 'function') OL.setView('scope');
};

export async function addNewResourceToCanvas() {
    const data = OL.getCurrentProjectData();
    const stages = data.stages || [];
    if (stages.length === 0) return alert("Please create a stage first.");

    // 1. Calculate Viewport Center
    const scrollWrap = document.getElementById('v2-canvas-scroll-wrap');
    const zoom = state.v2.zoom || 1;
    
    const centerX = (scrollWrap.scrollLeft + (scrollWrap.offsetWidth / 2)) / zoom;
    const centerY = (scrollWrap.scrollTop + (scrollWrap.offsetHeight / 2)) / zoom;

    // 2. Identify the target Stage (Lane) based on centerX
    let targetStage = stages[0];
    let accX = 0;
    for (let s of stages) {
        const w = s.width || 320;
        if (centerX >= accX && centerX <= accX + w) {
            targetStage = s;
            break;
        }
        accX += w;
    }

    // 3. Define Step ID and Resource ID
    const newResId = 'res-' + Date.now();
    const initialStepId = uid();

    // 4. Create the Resource Object
    const newRes = {
        id: newResId,
        name: "New Resource", // Default placeholder
        type: "General",
        stageId: targetStage.id,
        isGlobal: false,
        isExpanded: true,
        coords: { x: centerX - 140, y: centerY - 50 },
        steps: [{ 
            id: initialStepId, 
            name: "Initial Step", 
            logic: { in: [], out: [] } 
        }],
        createdDate: new Date().toISOString()
    };

    // 5. Save and Prep the UI
    await OL.updateAndSync(() => {
        data.resources.push(newRes);
        // Clear old highlights and set this as the single active match
        state.canvasMatches = [newResId];
        state.currentCanvasMatchIdx = 0;
    });

    // 6. Refresh the Canvas
    OL.renderVisualizer();
    
    // 7. SURGICAL HANDOFF: Scroll, Pulse, and Inspect
    setTimeout(() => {
        const el = document.getElementById(`v2-node-${newResId}`);
        if (el) {
            el.classList.add('search-focus');
            el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
            
            // 🚀 OPEN INSPECTOR IMMEDIATELY
            // We pass the newResId and null to open the card-level metadata inspector
            //OL.openInspector(newResId, null, 'cards');
            OL._fvOpenStepsList('${res.id}')

            // ⌨️ BONUS: Auto-focus the name field in the inspector if it exists
            const nameInput = document.getElementById('modal-res-name');
            if (nameInput) {
                nameInput.select(); // Select the "New Resource" text so they can just type over it
            }
        }
    }, 150);
};

export function toggleLogicMenu(id) {
    const target = document.getElementById(`logic-menu-${id}`);
    const isAlreadyOpen = target.style.display === 'block';

    // Close all other open menus
    document.querySelectorAll('.v2-logic-menu').forEach(m => m.style.display = 'none');

    // Toggle the clicked one
    if (target) {
        target.style.display = isAlreadyOpen ? 'none' : 'block';
    }
};

export function setTraceMode(startId, direction) {
    if (!startId) {
        state.v2.activeTrace = null;
        state.v2.highlightedIds = [];
        OL.renderVisualizer();
        return;
    }

    // 🚀 THE FIX: Get the freshest data directly from the state
    const currentData = OL.getCurrentProjectData();
    const resources = currentData.resources || [];
    
    const highlighted = new Set();
    const rootId = String(startId);
    highlighted.add(rootId);

    console.log(`🚀 STARTING CRAWL: ${direction} from ${rootId}`);
    console.log(`Total resources in pool: ${resources.length}`);

    function crawl(currentId) {
        // Force string comparison for the ID
        const res = resources.find(r => String(r.id) === String(currentId));
        
        if (!res) {
            console.warn(`⚠️ Crawler lost: Could not find ${currentId} among ${resources.length} resources.`);
            // Debug: Log the first resource ID to see the format difference
            if (resources.length > 0) console.log("Sample Resource ID in data:", resources[0].id);
            return;
        }

        const steps = res.steps || [];
        steps.forEach((step, sIdx) => {
            // Check 'out' for trace-end, 'in' for trace-start
            const logicPool = (direction === 'trace-end') ? (step.logic?.out || []) : (step.logic?.in || []);
            
            logicPool.forEach(link => {
                // Determine property name based on direction
                const rawTarget = (direction === 'trace-end') ? link.targetId : link.sourceId;
                
                if (rawTarget) {
                    // Standardize ID: "local-prj-123-step_0" -> "local-prj-123"
                    const idParts = String(rawTarget).split('-');
                    if (idParts.length > 1) idParts.pop();
                    const cleanedId = idParts.join('-');

                    if (cleanedId && !highlighted.has(cleanedId)) {
                        console.log(`✅ Connection found: ${currentId} -> ${cleanedId}`);
                        highlighted.add(cleanedId);
                        crawl(cleanedId); // Recurse
                    }
                }
            });
        });
    }

    crawl(rootId);

    // Update global state
    state.v2.activeTrace = { resId: rootId, mode: direction };
    state.v2.highlightedIds = Array.from(highlighted);

    console.log("🏁 FINAL HIGHLIGHTED SET:", state.v2.highlightedIds);

    OL.renderVisualizer();
    if (OL.drawConnections) OL.drawConnections();
};

export function handleStepDragStart(e, resId, index) {
    state.draggingStepResId = resId;
    state.draggingStepIdx = index;
    e.dataTransfer.effectAllowed = 'move';

    // Fix: list view uses .fv-list-item, not .v2-step-item
    const row = e.target.closest('.fv-list-item') || e.target.closest('.v2-step-item');
    if (row) row.classList.add('is-dragging');
};

export function handleStepDragOver(e) {
    e.preventDefault(); 
    const item = e.currentTarget.closest('.v2-step-item');
    if (item && !item.classList.contains('is-dragging')) {
        item.classList.add('drag-over');
    }
};

export function handleStepDragLeave(e) {
    const item = e.currentTarget.closest('.v2-step-item');
    if (item) item.classList.remove('drag-over');
};

export async function handleStepDrop(e, targetResId, droppedOnIdx) {
    e.preventDefault();
    e.stopPropagation();
    
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));

    const sourceStepResId = state.draggingStepResId;
    const draggedStepIdx = state.draggingStepIdx;
    
    let sourceResId = null;
    try {
        const resourceData = JSON.parse(e.dataTransfer.getData('application/json') || '{}');
        sourceResId = resourceData.id;
    } catch(err) {
        sourceResId = e.dataTransfer.getData('text/plain');
    }

    // --- CASE 1: INTERNAL STEP REORDER ---
    if (sourceStepResId === targetResId && draggedStepIdx !== null) {
        if (draggedStepIdx === droppedOnIdx) return;
        
        const res = OL.getResourceById(targetResId);
        if (!res || !res.steps) return;
        
        const [movedStep] = res.steps.splice(draggedStepIdx, 1);
        res.steps.splice(droppedOnIdx, 0, movedStep);
        
        await OL.persist();
    
        if (document.getElementById('active-modal-box')) {
            const stepListContainer = document.getElementById('sop-step-list');
            if (stepListContainer) {
                stepListContainer.innerHTML = window.renderSopStepList(res);
            } else {
                OL.openResourceModal(targetResId);
            }
        } else {
            // Covers both inspector and list view
            OL.renderVisualizer();
        }
        return;
    }
    // --- 🔵 CASE 2: EXTERNAL RESOURCE DROP ---
    if (sourceResId && sourceResId !== targetResId) {
        
        // 🎯 LOGIC SPLIT: Did they drop on a STEP or the HEADER?
        if (droppedOnIdx !== null) {
            // 🔗 LINK LOGIC (Dropped specifically on a step row)
            const sourceRes = OL.getResourceById(sourceResId);
            const targetRes = OL.getResourceById(targetResId);
            const step = targetRes.steps[droppedOnIdx];

            if (confirm(`Link "${sourceRes.name}" to step: "${step.name}"?`)) {
                if (!step.links) step.links = [];
                step.links.push({ id: sourceRes.id, name: sourceRes.name, type: sourceRes.type });
                await OL.persist();
                OL.renderVisualizer();
            }
        } else {
            // 🏛️ MERGE LOGIC (Dropped on the card header/empty space)
            const sourceRes = OL.getResourceById(sourceResId);
            const targetRes = OL.getResourceById(targetResId);

            if (confirm(`MERGE: Move all steps from "${sourceRes.name}" into "${targetRes.name}"?`)) {
                targetRes.steps = [...(targetRes.steps || []), ...(sourceRes.steps || [])];
                sourceRes.coords = null; // Send back to tray or delete
                await OL.persist();
                OL.renderVisualizer();
            }
        }
    }
};

export function save() {
    // 💾 Push the current master state into the browser's local cache
    localStorage.setItem('OL_FS_TEST', JSON.stringify(this.state));
    console.log("💾 State Cached");
};

export function getPartNumberHtml(res) {
    // 🎯 THE FIX: If res.originId doesn't exist (it's the Master), use its own ID
    const searchId = res.originId || res.id;
    if (!searchId) return '';

    const data = OL.getCurrentProjectData();
    const resources = data.resources || [];

    // Filter map resources that point back to this Master/Origin
    const family = resources.filter(r => 
        String(r.originId) === String(searchId) || 
        String(r.masterRefId) === String(searchId)
    );
    
    // If it hasn't been placed on the map, don't show the badge
    if (family.length === 0) return '';

    // If we are on the map, show "1/3". If we are in the List, just show the Total "3"
    const isMapNode = !!res.originId; 

    if (isMapNode) {
        const sortedFamily = family.sort((a, b) => (a.coords?.y || 0) - (b.coords?.y || 0));
        const index = sortedFamily.findIndex(r => r.id === res.id) + 1;
        return `
            <span class="v2-card-part" 
                  onclick="event.stopPropagation(); OL.highlightFamily('${searchId}')"
                  title="Part ${index} of ${family.length}">
                ${index}/${family.length}
            </span>
        `;
    } else {
        // 🏠 List View: Just show the family total count (the "Family Number")
        return `
            <span class="v2-card-part family-badge" 
                  onclick="event.stopPropagation(); OL.highlightFamily('${res.id}')"
                  style="cursor: pointer; background: rgba(var(--accent-rgb), 0.1); border: 1px solid var(--accent); color: var(--accent);"
                  title="Total instances on map. Click to highlight.">
                ${family.length}
            </span>
        `;
    }
};

export function toggleMasterExpand(forceExpand = null) {
    const data = OL.getCurrentProjectData();
    if (!data.resources) return;

    // Determine target state: 
    // If forceExpand is provided (true/false), use it. 
    // Otherwise, toggle based on the first resource's current state.
    const currentState = data.resources[0]?.isExpanded || false;
    const newState = forceExpand !== null ? forceExpand : !currentState;

    data.resources.forEach(res => {
        res.isExpanded = newState;
    });

    // 🚀 Update and Redraw
    OL.save(data);
    OL.renderVisualizer(); // Re-renders nodes
    
    // Crucial: Redraw connections since card heights just changed!
    setTimeout(() => {
        OL.drawConnections();
    }, 50); 
};

export function closeModal() {
    window.isMatrixActive = false;
    const quickInput = document.getElementById('quick-step-input');
 
    if (quickInput && quickInput.value.trim().length > 2) {
        const resId = quickInput.getAttribute('data-res-id');
        const valToSave = quickInput.value;
        quickInput.value = "";
        console.log("💾 Auto-saving draft before close...");
        OL.commitQuickStep(resId, valToSave);
        return;
    }
 
    const layer = document.getElementById('modal-layer');
    if (layer) {
        layer.style.display = 'none';
        layer.innerHTML = '';
    }
 
    OL.isSavingStep = false;
    OL.quickAddState = {
        name: "", app: "", appId: null,
        assignee: [], links: [], target: null,
        delay: 0, note: "", rule: ""
    };
 
    const hash = window.location.hash;
 
    // 🎯 Preserve scroll position across the refresh, whichever branch below fires.
    const scrollHost = document.getElementById('mainContent');
    const savedScrollTop = scrollHost ? scrollHost.scrollTop : 0;
    const restoreScroll = () => {
        requestAnimationFrame(() => {
            const host = document.getElementById('mainContent');
            if (host) host.scrollTop = savedScrollTop;
        });
    };
 
    if (hash.includes('resources')) {
        if (typeof renderResourceManager === "function") renderResourceManager();
        restoreScroll();
    }
    else if (hash.includes('applications') || hash.includes('apps')) {
        if (typeof renderAppsGrid === "function") renderAppsGrid();
        restoreScroll();
    }
    // 🚀 THE FIX: this branch was missing entirely, so Functions-page modal
    // closes fell through to the heavy window.handleRoute() path below.
    else if (hash.includes('functions')) {
        if (typeof renderFunctionsGrid === "function") renderFunctionsGrid();
        restoreScroll();
    }
    else if (hash.includes('analyze')) {
        if (typeof renderAnalysisModule === "function") renderAnalysisModule();
        restoreScroll();
    }
    else if (hash.includes('visualizer')) {
        if (typeof OL.renderVisualizer === "function") OL.renderVisualizer();
    }
    else {
        window.handleRoute();
    }
};

export function addNewStepToCard(resId) {
    const data = OL.getCurrentProjectData();
    const res = data.resources.find(r => String(r.id) === String(resId));
    const functionMappings = data.functions || {};
    
    // 🚀 1. PRE-DETERMINE THE ASSIGNEE
    let autoAssigneeObj = null; 

    if (res) {
        const rawType = typeof res.type === 'object' ? res.type.label : res.type;
        const resType = String(rawType || '').toLowerCase();
        const functionMappings = data.functions || {};

        let foundName = null;

        // 1. Determine the Name
        if (resType.includes('zap')) {
            foundName = "Zapier";
        } else if (resType.includes('scheduler') || resType.includes('scheduling')) {
            foundName = functionMappings["Scheduling"];
        } else if (resType.includes('form') || resType.includes('gathering')) {
            foundName = functionMappings["Data Gathering"];
        } else if (resType.includes('database')) {
            foundName = functionMappings["Database"];
        } else if (resType.includes('email')) {
            foundName = functionMappings["Email Marketing"];
        }

        // 2. Wrap the Name in the required Object Structure
        if (foundName) {
            autoAssigneeObj = { 
                name: String(foundName), 
                type: "app", 
                id: `auto-${Date.now()}` // Gives it a unique key for React/Lists
            };
        }
    }

    // 🚀 2. INITIALIZE STATE WITH THE AUTO-ASSIGNEE
    OL.quickAddState = { 
        name: "", 
        app: "", 
        appId: null, 
        assignee: autoAssigneeObj ? [autoAssigneeObj] : [],
        links: [], 
        target: null, 
        delay: 0, 
        note: "", 
        rule: "" 
    };

    const dockedPanel = document.getElementById('v2-inspector-panel') || document.getElementById('inspector-panel');    
    const launchedFromInspector = !!(dockedPanel && dockedPanel.classList.contains('open') && window.location.hash.includes('visualizer'));    
    OL._quickAddOrigin = launchedFromInspector ? 'inspector' : 'modal';

    const html = `
        <div id="quick-add-modal"> 
            <div class="modal-head">
                <div class="modal-title-text">⚡ Power Add Step</div>
                ${autoAssigneeObj ? `<div style="font-size:10px; color:var(--accent); margin-top:4px;">Auto-assigning to: ${autoAssigneeObj.name}</div>` : ''}
            </div>
            <div class="modal-body" style="position:relative;">
                <div id="quick-add-container">
                    <input type="text" id="quick-step-input" data-res-id="${resId}" class="modal-input" 
                           placeholder="Task Name /..."
                           autocomplete="off"
                           oninput="OL.handleQuickAddInput(event, '${resId}')"
                           onkeydown="OL.handleQuickAddKeys(event, '${resId}')"
                           style="font-size: 16px; padding: 15px; border: 2px solid var(--accent); width:100%;">
                    
                    <div id="slash-menu" class="slash-menu"></div>
                </div>
                <div id="step-preview-zone" style="margin-top:15px; display:none; background: rgba(0,0,0,0.2); border: 1px solid var(--line); padding: 15px; border-radius: 8px;"></div>
            </div>
        </div>
    `;
    openModal(html);
    setTimeout(() => document.getElementById('quick-step-input').focus(), 100);
};

export function parseStepInput(rawText) {
    // 🏷️ Mapping Synonyms to Fields
    const config = {
        assignee: ['assign', 'who', 'owner', '@'],
        delay:    ['delay', 'wait', 'after', 'pause'],
        dueDate:  ['due', 'date', 'by', 'deadline'],
        app:      ['app', 'tool', 'via', 'using'],
        note:     ['note', 'desc', 'info', 'details'],
        rule:     ['rule', 'if', 'logic', 'when']
    };

    const parts = rawText.split('/');
    const taskName = parts[0].trim();
    
    let result = {
        name: taskName || "New Step",
        appName: null,
        assigneeName: null,
        timingValue: 0,
        dueDate: null,
        notes: "",
        rule: ""
    };

    parts.slice(1).forEach(part => {
        const lowerPart = part.toLowerCase().trim();
        
        // Check which field this "shortcut" belongs to
        for (const [field, keywords] of Object.entries(config)) {
            const match = keywords.find(k => lowerPart.startsWith(k));
            if (match) {
                const content = part.substring(part.indexOf(':') + 1).trim();
                if (field === 'assignee') result.assigneeName = content;
                if (field === 'delay')    result.timingValue = parseInt(content) || 0;
                if (field === 'dueDate')  result.dueDate = content;
                if (field === 'app')      result.appName = content;
                if (field === 'note')     result.notes = content;
                if (field === 'rule')     result.rule = content;
            }
        }
    });

    return result;
};

export function handleQuickAddInput(e, resId) {
    const inputEl = e.target;
    const val = inputEl.value; 
    const menu = document.getElementById('slash-menu');
    
    // 1. Get the Apps from the REAL source
    const client = getActiveClient();
    const projectApps = client?.projectData?.localApps || [];

    // 2. Sync State Name
    OL.quickAddState.name = val;

    // 🔍 3. DYNAMIC APP SCANNING (Using localApps)
    let detectedApp = null;

    if (val.trim().length > 2) {
        projectApps.forEach(app => {
            const appName = app.name || "";
            if (!appName) return;

            const searchStr = val.toLowerCase();
            const targetApp = appName.toLowerCase();

            // Match if the typed text contains the app name
            if (searchStr.includes(targetApp)) {
                detectedApp = app;
            }
        });
    }

    if (detectedApp) {
        OL.quickAddState.app = detectedApp.name;
        OL.quickAddState.appId = detectedApp.id || null;
        console.log("✅ Sync Match Found:", detectedApp.name);
    } else {
        // Only clear if no slash command or previous detection is active
        // This prevents flickering while typing
        if (!val.includes('/app:')) {
            OL.quickAddState.app = "";
            OL.quickAddState.appId = null;
        }
    }

    // ⚡ 4. SLASH MENU LOGIC
    const lastSlashIndex = val.lastIndexOf('/');
    if (lastSlashIndex !== -1) {
        const query = val.substring(lastSlashIndex + 1);
        if (query.includes(':')) {
            const parts = query.split(':');
            const command = parts[0].toLowerCase().trim();
            const paramQuery = parts[1] ? parts[1].trim() : ""; 
            
            const subTypeMap = {
                'assign': 'team', 'who': 'team', 'app': 'apps', 'tool': 'apps'
            };
            
            const subType = subTypeMap[command];
            if (subType && typeof OL.showSubMenu === 'function') {
                OL.showSubMenu(subType, paramQuery.toLowerCase()); 
            }
        } else if (typeof OL.showSlashMenu === 'function') {
            OL.showSlashMenu(query.toLowerCase().trim(), resId);
        }
    } else if (menu) {
        menu.style.display = 'none';
    }

    // 🚀 5. THE UI REFRESH
    if (typeof OL.updateQuickAddPreview === 'function') {
        OL.updateQuickAddPreview();
    }
};

export function updateQuickAddPreview() {
    const preview = document.getElementById('step-preview-zone');
    if (!preview) return;

    const state = OL.quickAddState;
    const data = OL.getCurrentProjectData();
    
    // 🔍 Find the actual app object to get its icon
    const appObj = (data.apps || []).find(a => a.name === state.app || a.id === state.appId);
    const iconHtml = appObj?.icon ? `<img src="${appObj.icon}" style="width:16px; height:16px; margin-right:8px;">` : '🛠️';

    if (state.name || state.app || state.assignee.length > 0) {
        preview.style.display = 'block';
        
        // Build the Preview HTML
        preview.innerHTML = `
            <div style="display:flex; align-items:center; gap:10px;">
                <div style="flex-shrink:0;">${iconHtml}</div>
                <div style="flex-grow:1;">
                    <div style="font-weight:bold; color:white;">${state.name || 'Untitled Task'}</div>
                    <div style="font-size:11px; color:var(--text-dim);">
                        App: <span style="color:var(--accent);">${state.app || 'Auto'}</span> | 
                        Who: <span style="color:var(--accent);">${state.assignee.map(a => a.name).join(', ') || 'Unassigned'}</span>
                    </div>
                </div>
            </div>
        `;
    } else {
        preview.style.display = 'none';
    }
};

export function showSlashMenu(query, resId) {
    const menu = document.getElementById('slash-menu');
    const options = [
        { label: 'Assignee', key: 'Assign:', icon: '👨‍💼', sub: 'team' },
        { label: 'Application', key: 'App:', icon: '💻', sub: 'apps' },
        { label: 'Delay', key: 'Delay:', icon: '⏱', sub: null },
        { label: 'Note', key: 'Note:', icon: '📝', sub: null },
        { label: 'Due Date', key: 'Due:', icon: '📅', sub: 'due' }, // ✨ New Option
        { label: 'Rules', key: 'Rule:', icon: 'λ', sub: 'logic' },
        { label: 'Link Assets', key: 'Link:', icon: '🔗', sub: 'links' },
        { label: 'Target Resource', key: 'Target:', icon: '🎯', sub: 'target' }
    ];

    const filtered = options.filter(o => o.label.toLowerCase().includes(query.toLowerCase()));
    
    if (filtered.length > 0) {
        menu.innerHTML = filtered.map((o, i) => `
            <div class="slash-option ${i === 0 ? 'selected' : ''}" 
                 data-label="${o.key}" 
                 data-sub="${o.sub || ''}"
                 onmousedown="event.preventDefault(); OL.selectMenuOption('${o.key}', '${o.sub || ''}')">
                <span>${o.icon} ${o.label}</span>
            </div>
        `).join('');
        menu.style.display = 'block';
    } else {
        menu.style.display = 'none';
    }
};

export function insertCommand(key, subType) {
    const input = document.getElementById('quick-step-input');
    if (!input) return;

    const val = input.value;
    const lastSlash = val.lastIndexOf('/');
    
    // Insert the command (e.g., /App:)
    input.value = val.substring(0, lastSlash + 1) + key + " ";
    
    // Hide the level-1 menu
    document.getElementById('slash-menu').style.display = 'none';
    input.focus();

    // 🚀 FORCE RE-SCAN: This triggers handleQuickAddInput again immediately
    const inputEvent = new Event('input', { bubbles: true });
    input.dispatchEvent(inputEvent);
};

export function handleQuickAddKeys(e, resId) {
    const menu = document.getElementById('slash-menu');
    const isMenuVisible = menu && menu.style.display === 'block';
    const input = e.target;
    
    if (isMenuVisible) {
        const options = menu.querySelectorAll('.slash-option');
        if (options.length === 0) return; // Nothing to select

        let activeIdx = Array.from(options).findIndex(opt => opt.classList.contains('selected'));

        if (e.key === 'Enter' || e.key === 'Tab') {
            e.preventDefault();
            e.stopImmediatePropagation(); // 🛑 Stop modal from saving
            
            // Default to first option if none highlighted
            const selectedIdx = activeIdx >= 0 ? activeIdx : 0;
            const selectedEl = options[selectedIdx];

            if (selectedEl) {
                // 🕵️ Instead of firing the mouse event, we look at the data we stored
                const label = selectedEl.getAttribute('data-label');
                const sub = selectedEl.getAttribute('data-sub');
                OL.selectMenuOption(label, sub);
            }
            return false;
        }

        // 1. Navigation
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            e.stopImmediatePropagation();
            
            if (activeIdx >= 0) options[activeIdx].classList.remove('selected');
            
            if (e.key === 'ArrowDown') activeIdx = (activeIdx + 1) % options.length;
            else activeIdx = (activeIdx - 1 + options.length) % options.length;
            
            options[activeIdx].classList.add('selected');
            options[activeIdx].scrollIntoView({ block: 'nearest' });
            return false;
        }

        // 2. 🎯 THE FIX: Enter / Tab / Right Arrow
        if (e.key === 'Enter' || e.key === 'Tab' || e.key === 'ArrowRight') {
            e.preventDefault();
            e.stopImmediatePropagation();
            
            // If nothing is highlighted, grab the first available option
            const selected = (activeIdx >= 0) ? options[activeIdx] : options[0];
            
            if (selected) {
                // Trigger the mousedown logic
                selected.onmousedown(); 
            }
            return false;
        }

        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopImmediatePropagation();
            menu.style.display = 'none';
            return false;
        }
    }

    // 🏁 3. Standard Step Commit (Only if menu is hidden)
    if (e.key === 'Enter' && !e.shiftKey) {
        const val = input.value;
        const lastSlash = val.lastIndexOf('/');

        if (lastSlash !== -1) {
            const cmdPart = val.substring(lastSlash + 1);
            if (cmdPart.includes(':')) {
                // We are mid-command! 
                e.preventDefault();
                e.stopImmediatePropagation();

                const parts = cmdPart.split(':');
                const cmd = parts[0].toLowerCase().trim();
                const content = parts.slice(1).join(':').trim(); // Join in case they typed colons in a note

                if (content.length > 0) {
                    // 💾 Save to state (Mapping synonyms)
                    if (cmd === 'delay' || cmd === 'wait') OL.quickAddState.delay = content;
                    if (cmd === 'note' || cmd === 'desc' || cmd === 'description') OL.quickAddState.note = content;
                    if (cmd === 'due' || cmd === 'date') OL.quickAddState.due = content;
                    if (cmd === 'rule' || cmd === 'if') OL.quickAddState.rule = content;
                    
                    // 🧹 Clear the command from input, keep the base task name
                    input.value = val.substring(0, lastSlash).trim() + " ";
                    
                    // 🔄 FORCE REFRESH PREVIEW
                    OL.updateStepPreview(input.value);
                    return false;
                }
            }
        }
        
        // Final Save Step (Only if no slash command was found above)
        OL.commitQuickStep(resId);
    }
};

export function updateStepPreview(val) {
    const previewZone = document.getElementById('step-preview-zone');
    if (!previewZone) return;

    const taskName = (val || "").split('/')[0].trim();
    const s = OL.quickAddState;

    // 1. Check if we have anything to show
    const hasData = taskName || s.app || s.assignee || s.delay || s.note || s.rule || s.due;
    
    if (!hasData) {
        previewZone.style.display = 'none';
        return;
    }

    previewZone.style.display = 'block';
    previewZone.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 8px;">
            <div style="font-size: 13px; color: var(--accent); font-weight: bold; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 5px;">
                ${taskName || '<span style="opacity:0.5">Untitled Action...</span>'}
            </div>
            
            <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                ${s.app ? `<span class="pill status-primary">💻 ${s.app}</span>` : ''}
                ${(s.assignee || []).map(a => `
                    <span class="pill vault-gold" style="font-size: 10px;">👨‍💼 ${a.name}</span> `).join('')}
                ${s.delay ? `<span class="pill">⏱ ${s.delay}</span>` : ''}
                ${s.due ? `<span class="pill" style="border: 1px solid #ff4757; color: #ff4757;">📅 ${s.due}</span>` : ''}
                ${s.rule ? `<span class="pill" style="border: 1px solid var(--warning); color: var(--warning);">λ ${s.rule}</span>` : ''}
            </div>

            ${s.note ? `
                <div style="font-size: 11px; background: rgba(255,255,255,0.05); padding: 8px; border-radius: 4px; color: #000; font-style: italic; border-left: 2px solid var(--accent);">
                    " ${s.note} "
                </div>
            ` : ''}
        </div>
    `;
};

export function showSubMenu(subType, filterQuery = "") {
    const menu = document.getElementById('slash-menu');
    if (!menu) return;

    const q = (filterQuery || "").toLowerCase().trim();
    let menuHtml = "";

    // 1. SELECT DATA BASED ON TYPE
    switch (subType) {
        case 'team':
            const matches = OL.getFilteredAssigneeOptions(q);
            menuHtml = `<div class="search-category-label">Assign to... (Multi-select)</div>`;
            menuHtml += `
                <div class="slash-option exit-option" style="border-bottom: 1px solid var(--line); color: var(--accent); font-weight:bold;" 
                     onmousedown="event.preventDefault(); OL.exitSubMenu()">
                    <span>✅ Done Selecting</span>
                </div>
            `;
            menuHtml += matches.map((item) => {
                const isSelected = (OL.quickAddState.assignee || []).some(a => a.id === item.id);
                return `
                    <div class="slash-option ${isSelected ? 'active' : ''}" 
                         onmousedown="event.preventDefault(); OL.selectMultiAssignee('${item.id}', '${esc(item.name)}', '${item.type}')">
                        <span>${item.icon} ${esc(item.name)}</span>
                        ${isSelected ? '<span class="tiny" style="margin-left:auto;">✅</span>' : ''}
                    </div>
                `;
            }).join('');
            break;

        case 'due':
            const dueOptions = [
                { label: 'Same Day', icon: '⚡' },
                { label: '+1 Day', icon: '🌅' },
                { label: '+2 Days', icon: '📅' },
                { label: '+1 Week', icon: '🗓️' },
                { label: 'Immediate', icon: '🚀' }
            ];
            menuHtml = `<div class="search-category-label">Select Due Offset...</div>`;
            menuHtml += dueOptions.filter(o => o.label.toLowerCase().includes(q)).map(o => `
                <div class="slash-option" onmousedown="event.preventDefault(); OL.selectMenuOption('${o.label}')">
                    <span>${o.icon} ${o.label}</span>
                </div>
            `).join('');
            break;

        case 'apps':
            const client = getActiveClient();
            const apps = (client?.projectData?.localApps || []).filter(a => a.name.toLowerCase().includes(q));
            menuHtml = `<div class="search-category-label">Select Application...</div>`;
            menuHtml += apps.map(a => `
                <div class="slash-option" onmousedown="event.preventDefault(); OL.selectMenuOption('${esc(a.name)}', null, '${a.id}')">
                    <span>💻 ${esc(a.name)}</span>
                </div>
            `).join('');
            break;

        case 'logic':
            const logicOptions = [
                { label: 'If Approved', icon: 'λ' }, 
                { label: 'If Rejected', icon: 'λ' }, 
                { label: 'On Success', icon: 'λ' }
            ];
            menuHtml = `<div class="search-category-label">Select Logic Rule...</div>`;
            menuHtml += logicOptions.filter(o => o.label.toLowerCase().includes(q)).map(o => `
                <div class="slash-option" onmousedown="event.preventDefault(); OL.selectMenuOption('${o.label}')">
                    <span>${o.icon} ${o.label}</span>
                </div>
            `).join('');
            break;
        
        // Inside OL.showSubMenu switch statement:

        case 'links': // 📖 Guides & Assets
            const clientData = getActiveClient();
            const allRes = [...(state.master.resources || []), ...(clientData?.projectData?.localResources || [])];
            const allSOPs = [...(state.master.howToLibrary || []), ...(clientData?.projectData?.localHowTo || [])];
            
            // Combine and filter
            const linkMatches = [...allRes, ...allSOPs].filter(item => item.name.toLowerCase().includes(q));

            menuHtml = `<div class="search-category-label">Link Assets/SOPs (Multi)</div>`;
            menuHtml += linkMatches.map(item => {
                const isSelected = (OL.quickAddState.links || []).some(l => l.id === item.id);
                const icon = item.type === 'SOP' || item.content !== undefined ? '📖' : '💻';
                return `
                    <div class="slash-option ${isSelected ? 'active' : ''}" 
                        onmousedown="event.preventDefault(); OL.selectMultiLink('${item.id}', '${esc(item.name)}', '${item.type || 'sop'}')">
                        <span>${icon} ${esc(item.name)}</span>
                        ${isSelected ? '<span class="tiny">✅</span>' : ''}
                    </div>
                `;
            }).join('');
            break;

        case 'target': // 🎯 The "Milestone" Resource
            const data = OL.getCurrentProjectData();
            const targetMatches = (data.resources || []).filter(r => r.name.toLowerCase().includes(q));

            menuHtml = `<div class="search-category-label">Set Target Resource (Milestone)</div>`;
            menuHtml += targetMatches.map(r => `
                <div class="slash-option" onmousedown="event.preventDefault(); OL.selectTargetResource('${r.id}', '${esc(r.name)}')">
                    <span>🎯 ${esc(r.name)}</span>
                </div>
            `).join('');
            break;
    }

    // 2. RENDER OR HIDE
    if (menuHtml && menuHtml.length > 50) { // Safety check to ensure we didn't just render a label
        menu.innerHTML = menuHtml;
        menu.style.display = 'block';
    } else {
        menu.style.display = 'none';
    }
};

export function selectMultiLink(id, name, type) {
    if (!OL.quickAddState.links) OL.quickAddState.links = [];
    const idx = OL.quickAddState.links.findIndex(l => l.id === id);
    if (idx === -1) OL.quickAddState.links.push({ id, name, type });
    else OL.quickAddState.links.splice(idx, 1);
    
    OL.updateStepPreview(document.getElementById('quick-step-input').value);
    OL.showSubMenu('links', ''); 
};

export function selectTargetResource(id, name) {
    OL.quickAddState.target = { id, name };
    OL.exitSubMenu(); // Targets are usually single-select, so we auto-exit
};

export function selectMultiAssignee(id, name, type) {
    if (!Array.isArray(OL.quickAddState.assignee)) OL.quickAddState.assignee = [];
    
    const idx = OL.quickAddState.assignee.findIndex(a => a.id === id);
    if (idx === -1) {
        OL.quickAddState.assignee.push({ id, name, type });
    } else {
        OL.quickAddState.assignee.splice(idx, 1);
    }

    const input = document.getElementById('quick-step-input');
    
    // 🛡️ Guard against the null error
    if (input) {
        OL.updateStepPreview(input.value);
        
        // Use a tiny timeout or animation frame to let the click event finish
        // before forcing focus back into the box.
        requestAnimationFrame(() => {
            if (input) input.focus();
        });
    }

    // Refresh the submenu so checkmarks appear/disappear instantly
    OL.showSubMenu('team', ''); 
};

export function exitSubMenu() {
    const input = document.getElementById('quick-step-input');
    const menu = document.getElementById('slash-menu');
    if (!input) return;

    const val = input.value;
    const lastSlash = val.lastIndexOf('/');

    // 🧹 Strip the command part but keep the base task name
    // e.g., "Send Invoice /Assign: " -> "Send Invoice "
    if (lastSlash !== -1) {
        input.value = val.substring(0, lastSlash).trim() + " ";
    }

    if (menu) menu.style.display = 'none';
    input.focus();
    
    // Refresh the preview one last time
    OL.updateStepPreview(input.value);
};

export function completeSubMenuValue(value) {
    const input = document.getElementById('quick-step-input');
    const val = input.value;
    
    // Find where the last command started
    const lastColon = val.lastIndexOf(':');
    
    // Construct new value: Everything up to the colon + the selected value
    input.value = val.substring(0, lastColon + 1) + " " + value + " ";
    
    document.getElementById('slash-menu').style.display = 'none';
    input.focus();
    OL.updateStepPreview(input.value);
};

// 📦 A temporary object to hold our draft step data
OL.quickAddState = { name: "", app: "", assignee: "", delay: 0 };

export function selectMenuOption(label, subType = null, appId = null) {
    const input = document.getElementById('quick-step-input');
    if (!input) return;

    const val = input.value;
    const lastSlash = val.lastIndexOf('/');
    const isCommandStart = label.endsWith(':');

    if (isCommandStart) {
        input.value = val.substring(0, lastSlash).trim() + " /" + label + " ";
        document.getElementById('slash-menu').style.display = 'none';
        input.focus();
        if (subType && subType !== 'null' && subType !== '') {
            input.dispatchEvent(new Event('input', { bubbles: true }));
        } else {
            OL.updateStepPreview(input.value);
        }
    } 
    else {
        const commandText = val.substring(lastSlash); 
        
        // 🎯 THE FIX: Capture the ID for the Inspector
        if (commandText.includes('App:')) {
            OL.quickAddState.app = label;
            OL.quickAddState.appId = appId; 
        }
        
        // Existing mappings...
        if (commandText.includes('Assign:')) OL.quickAddState.assignee = label; // Handled by selectMultiAssignee usually
        if (commandText.includes('Delay:')) OL.quickAddState.delay = label;
        if (commandText.includes('Due:')) OL.quickAddState.due = label;
        if (commandText.includes('Note:')) OL.quickAddState.note = label;
        if (commandText.includes('Rule:')) OL.quickAddState.rule = label;

        input.value = val.substring(0, lastSlash).trim() + " ";
        document.getElementById('slash-menu').style.display = 'none';
        input.focus();
        OL.updateStepPreview(input.value);
    }
};

OL.isSavingStep = false; // Global flag


export async function commitQuickStep(resId) {
    if (OL.isSavingStep) return;
 
    const input = document.getElementById('quick-step-input');
    if (!input) return;
 
    const taskName = input.value.split('/')[0].trim();
    const s = OL.quickAddState;
 
    if (!taskName && !s.note) {
        OL.isSavingStep = false;
        OL.closeModal();
        return;
    }
 
    OL.isSavingStep = true;
    input.value = "";
 
    let succeeded = false;
 
    try {
        const newStep = {
            id: "step_" + Date.now(),
            name: taskName || "Untitled Action",
            appId: s.appId || null,
            appName: s.app || null,
            assignees: Array.isArray(s.assignee) ? s.assignee : [],
            description: s.note || "",
            timingValue: parseInt(s.delay) || 0,
            timingType: 'after_prev',
            dueDate: s.due || null,
            rule: s.rule || "",
            logic: { in: [], out: [] },
            links: s.links || [],
            targetResourceId: s.target?.id || null,
            targetResourceName: s.target?.name || null,
        };
 
        const client = getActiveClient();
        const isVault = window.location.hash.includes('vault');
        const resourcePool = isVault ? state.master.resources : client.projectData.localResources;
        const resource = resourcePool.find(r => String(r.id) === String(resId));
 
        if (resource) {
            if (!resource.steps) resource.steps = [];
            resource.steps.push(newStep);
            resource.isExpanded = true;
 
            await OL.persist();
            if (window.location.hash.includes('visualizer')) OL.renderVisualizer();
            succeeded = true;
        }
    } catch (err) {
        console.error("❌ Power Add Sync Failure:", err);
    } finally {
        OL.isSavingStep = false;
 
        // 🚀 THE FIX: go back to the Resource Modal you were already in,
        // instead of routing away to the underlying page.
        const modalLayer = document.getElementById('modal-layer');
        if (modalLayer) {
            modalLayer.style.display = 'none';
            modalLayer.innerHTML = '';
        }
        const cameFromInspector = OL._quickAddOrigin === 'inspector';        
        OL._quickAddOrigin = null;
        if (succeeded && resId) {
            if (cameFromInspector && window.location.hash.includes('visualizer')) {                
                OL._fvOpenStepsList(resId);            
            } else {                
                // Not returning to the docked Inspector — make sure it isn't                
                // left open behind the modal from an earlier Visualizer visit.                
                const dockedPanel = document.getElementById('v2-inspector-panel') || document.getElementById('inspector-panel');                
                if (dockedPanel) dockedPanel.classList.remove('open');               
                OL.openResourceModal(resId);            
            }        
        } else {
            OL.closeModal();
        }
    }
};

export function updateStepName(resId, stepIdx, newName) {
    const data = OL.getCurrentProjectData();
    const res = data.resources.find(r => String(r.id) === String(resId));
    const step = res?.steps?.[stepIdx];

    if (step) {
        step.name = newName || 'Untitled Step';
        
        // 💾 Save change (Surgical update, no need to re-align)
        OL.persist();
        
        // 🚀 SURGICAL DOM UPDATE: Update the step text on the canvas directly
        // to avoid a full re-render while the user is typing in the inspector.
        const stepEl = document.querySelector(`[data-step-id="${resId}-${stepIdx}"] span`);
        if (stepEl) stepEl.innerText = `• ${step.name}`;
    }
};

export function deleteStep(resId, stepId) {
    const data = OL.getCurrentProjectData();
    const res = (data.resources || []).find(r => String(r.id) === String(resId));
    if (!res) return;

    const step = (res.steps || []).find(s => String(s.id) === String(stepId));
    if (!step) return;

    if (!confirm(`Delete step "${step.name}"? This will also remove any logic links connected to it.`)) return;

    // 1. Cleanup: remove all logic links pointing to this step
    const fullId = `${resId}-${stepId}`;
    (data.resources || []).forEach(r => {
        (r.steps || []).forEach(s => {
            if (s.logic?.out) s.logic.out = s.logic.out.filter(l => l.targetId !== fullId);
            if (s.logic?.in)  s.logic.in  = s.logic.in.filter(l => l.sourceId !== fullId);
        });
    });

    // 2. Delete the step
    res.steps = res.steps.filter(s => String(s.id) !== String(stepId));

    // 3. Persist and go back to resource view
    OL.persist();
    OL._fvOpenStepsList(resId);
};

export function toggleSteps(id) {
    // 🎯 1. Use the context-aware helper
    const data = OL.getCurrentProjectData();
    const res = data.resources.find(r => String(r.id) === String(id));
    
    if (res) {
        // 🔄 2. Toggle state
        res.isExpanded = !res.isExpanded;
        
        // 💾 3. Persist change
        OL.save(); 

        // 📏 4. Re-calculate spacing
        // We pass 'false' because we only want to fix the Y-gap, 
        // not move cards to different columns.
        OL.autoAlignNodes(false); 
        
        // ⚡ 5. Urgent Connection Refresh
        // Since the card height changed, logic ports moved.
        // 50ms gives the browser enough time to finish the render layout.
        setTimeout(() => {
            if (typeof OL.drawConnections === 'function') {
                OL.drawConnections();
            }
        }, 50);
    }
};

export function splitCardAtStep(resourceId, stepIndex) {
    // 🎯 1. Get correct context (fixes currentData is not defined)
    const data = OL.getCurrentProjectData(); 
    const resources = data.resources;
    
    const originalRes = resources.find(r => String(r.id) === String(resourceId));
    if (!originalRes || !originalRes.steps) return;

    // Ensure we track the family lineage
    if (!originalRes.originId) originalRes.originId = originalRes.id;

    // ✂️ 2. IDENTIFY AND MOVE STEPS
    const movedSteps = originalRes.steps.splice(stepIndex + 1).filter(s => s !== null);
    if (movedSteps.length === 0) return;
    const newId = 'r' + Date.now();

    // 🚀 3. THE REPAIR MAPPING
    // We need to tell the world that [OldID]-StepX is now [NewID]-StepY
    const repairMap = {};
    movedSteps.forEach((step, i) => {
        const oldFullId = `${originalRes.id}-${stepIndex + 1 + i}`;
        const newFullId = `${newId}-${i}`;
        repairMap[oldFullId] = newFullId;
    });

    // 🚀 4. UPDATE GLOBAL CONNECTIONS
    // Scan every card to update any logic links pointing to the moved steps
    resources.forEach(res => {
        res.steps?.forEach(step => {
            ['in', 'out'].forEach(dir => {
                const key = dir === 'out' ? 'targetId' : 'sourceId';
                step.logic?.[dir]?.forEach(link => {
                    if (repairMap[link[key]]) {
                        console.log(`🛠️ Repairing Link: ${link[key]} -> ${repairMap[link[key]]}`);
                        link[key] = repairMap[link[key]];
                    }
                });
            });
        });
    });

    // 🏗️ 5. CREATE THE NEW CARD
    const newCard = {
        id: newId,
        originId: originalRes.originId,
        name: originalRes.name, // Will be updated by refreshFamilyNaming
        type: originalRes.type,
        stageId: originalRes.stageId,
        isGlobal: false,
        isExpanded: true,
        _col: originalRes._col || 0,
        // Position it slightly below the original
        coords: { 
            x: originalRes.coords.x, 
            y: originalRes.coords.y + (originalRes.isExpanded ? 150 : 80) 
        },
        steps: movedSteps
    };

    resources.push(newCard);
    
    // 🏷️ 6. REFRESH FAMILY NAMING
    // This ensures both cards get their (1/2) and (2/2) badges immediately
    if (typeof OL.refreshFamilyNaming === 'function') {
        OL.refreshFamilyNaming(newCard, resources);
    }

    // 🏁 7. SYNC & SAVE
    this.syncLogicPorts(); 
    this.save();
    this.autoAlignNodes(false); 
};

export function highlightFamily(originId) {
    const data = OL.getCurrentProjectData();
    const resources = data.resources || [];

    const nodeLayer = document.getElementById('v2-node-layer');
    const mainContent = document.getElementById('mainContent');
    const activeLayer = nodeLayer || mainContent;

    if (!activeLayer) return;

    // Toggle Off
    if (activeLayer.classList.contains('canvas-dimmed')) {
        activeLayer.classList.remove('canvas-dimmed');
        document.querySelectorAll('.family-focus').forEach(el => el.classList.remove('family-focus'));
        return;
    }

    // Toggle On
    activeLayer.classList.add('canvas-dimmed');
    
    // 🔍 Find the Family
    resources.forEach(res => {
        const isMatch = String(res.originId) === String(originId) || 
                        String(res.masterRefId) === String(originId) || 
                        String(res.id) === String(originId);

        if (isMatch) {
            // Check for Map Node OR Resource Card
            const el = document.getElementById(`v2-node-${res.id}`) || 
                       document.getElementById(`res-card-${res.id}`); // 👈 Matches your renderResourceCard ID
            
            if (el) el.classList.add('family-focus');
        }
    });

    const clearFocus = (e) => {
        if (['v2-canvas', 'v2-node-layer', 'mainContent'].includes(e.target.id)) {
            activeLayer.classList.remove('canvas-dimmed');
            document.querySelectorAll('.family-focus').forEach(el => el.classList.remove('family-focus'));
            window.removeEventListener('mousedown', clearFocus);
        }
    };
    window.addEventListener('mousedown', clearFocus);
};

export async function toggleScopingStatus(resId) {
    const client = getActiveClient();
    if (!client || !client.projectData) return;

    // 1. Data Logic (Same as before)
    const sheet = client.projectData.scopingSheets?.[0] || { lineItems: [] };
    const targetId = String(resId);
    const existingItem = OL.isResourceInScope(targetId);

    // 🚀 2. Instant UI Flip (Detects badge on ANY page)
    const badges = document.querySelectorAll(`[id="badge-${targetId}"], [oncontextmenu*="${targetId}"]`);
    badges.forEach(badgeEl => {
        if (existingItem) {
            badgeEl.classList.replace('is-on', 'is-off');
        } else {
            badgeEl.classList.replace('is-off', 'is-on');
        }
    });

    // 3. Update the Array
    if (existingItem) {
        client.projectData.scopingSheets[0].lineItems = sheet.lineItems.filter(item => String(item.resourceId) !== targetId);
    } else {
        const res = OL.getResourceById(targetId);
        client.projectData.scopingSheets[0].lineItems.push({
            id: `li-${Date.now()}`,
            resourceId: targetId,
            name: res?.name || "New Resource",
            rate: 0, units: 0, total: 0
        });
    }

    // 4. Persist
    await OL.persist(); 
    
    // 5. Smart Refresh: Only re-render the heavy stuff if we are on that page
    const currentHash = window.location.hash;
    if (currentHash.includes('visualizer')) {
        OL.renderVisualizer(); 
    } else if (currentHash.includes('resources')) {
        // If you have a specific refresh for the resources table, call it here
        // OL.renderResourcesPage(); 
    }
};

export function getAppByFunction(resourceType) {
    const data = OL.getCurrentProjectData();
    const master = state.master || {};
    const apps = (data.localApps && data.localApps.length > 0) ? data.localApps : (master.apps || []);
    
    // 🔍 Find the Type Definition in your registry
    const typeDef = (master.resourceTypes || []).find(t => t.type.toLowerCase() === String(resourceType).toLowerCase());
    
    // If there's no mapping set in the Resource Manager, we stop here
    const targetFunctionId = typeDef ? typeDef.matchedFunctionId : null;
    if (!targetFunctionId) return null;

    // 🎯 Find the app that is PRIMARY for this specific Function ID
    return apps.find(a => {
        return (a.functionIds || []).some(f => 
            String(f.id || f) === targetFunctionId && f.status === 'primary'
        );
    }) || apps.find(a => {
        // Fallback: Just any app that has this function mapped
        return (a.functionIds || []).some(f => String(f.id || f) === targetFunctionId);
    });
};

export function getResourceIcon(type) {
    const registry = (state.master && state.master.resourceTypes) ? state.master.resourceTypes : [];
    const match = registry.find(t => t.type.toLowerCase() === String(type).toLowerCase());
    return match ? match.icon : '📄'; // Fallback to a page icon
};

// 🔍 Open Inspector
export function openInspector(resId = null, stepTarget = null, mode = 'steps') {
    const onVisualizer = window.location.hash.includes('visualizer');
 
    // 🚀 THE FIX: outside the Visualizer, "open inspector" for a resource
    // should just open the normal full Resource Modal — the docked 380px
    // panel only makes sense alongside the flow-map canvas.
    if (!onVisualizer) {
        if (resId && stepTarget === null) {
            return OL.openResourceModal(resId);
        }
        if (resId && stepTarget !== null) {
            // Step-level deep link from outside the visualizer: open the
            // resource modal — there's no flow-map canvas to dock next to.
            return OL.openResourceModal(resId);
        }
        return;
    }
    
    const panel = document.getElementById('v2-inspector-panel') || document.getElementById('inspector-panel');
    const content = document.getElementById('inspector-content');
    if (!panel || !content) return;
 
    // 🎯 RESTORE INTERNAL SCROLL LAYER VISIBILITY
    panel.style.overflow = '';
    const scrollContent = panel.querySelector('.inspector-scroll-content');
    if (scrollContent) {
        scrollContent.style.display = 'block'; // Bring it back to life!
    }

    // 🎯 Get Context Data
    const data = OL.getCurrentProjectData();
    const resources = data.resources || [];
    panel.classList.add('open');

    // Force grid open
    const layout = document.querySelector('.three-pane-layout');
    if (layout) {
        const sidebarCollapsed = document.querySelector('.sidebar.collapsed');
        const leftCol = sidebarCollapsed ? '65px' : '240px';
        layout.style.gridTemplateColumns = `${leftCol} 1fr 380px`;
    }

    try {
        OL._buildInspectorContent(resId, stepTarget, mode, panel, content, data, resources);
    } catch (err) {
        console.error("❌ Inspector render failed:", err);
        content.innerHTML = `
            <div style="padding:24px;color:#ef4444;font-size:12px;line-height:1.6;">
                <strong>Inspector failed to render.</strong><br>
                ${esc(err.message || String(err))}
                <div style="margin-top:10px;opacity:0.6;font-size:10px;">
                    Check the browser console for the full stack trace.
                </div>
            </div>`;
    }
};

export function _buildInspectorContent(resId, stepTarget, mode, panel, content, data, resources) {
    // 📑 2. STEP DETAIL MODE
    // 🚀 FIX: Using stepTarget to check against null
    if (resId && stepTarget !== null) { 
        const res = resources.find(r => String(r.id) === String(resId));
        if (!res) return;

        // 🧠 HYBRID LOOKUP: Hunt by ID first, fallback to Index if numeric
        let step = res.steps.find(s => String(s.id) === String(stepTarget));
        if (!step && isFinite(stepTarget)) {
            step = res.steps[stepTarget];
        }
        
        if (!step) {
            console.error("❌ Inspector Error: Step not found", resId, stepTarget);
            content.innerHTML = `<div class="muted-notice" style="padding:40px; text-align:center; opacity:0.5;">Step not found: ${stepTarget}</div>`;
            return;
        }

        // 🔢 CALCULATE THE DYNAMIC INDEX (For the UI Label)
        const currentIdx = res.steps.indexOf(step);
        
        // 🛡️ Data Safety
        if (!step.logic) step.logic = { in: [], out: [] };
        if (!step.assignees) step.assignees = [];
        
        const allOptions = this.getAllStepOptions();

        content.innerHTML = `
            <div class="breadcrumb" onclick="OL._fvOpenStepsList('${resId}')"
                 style="display:flex;align-items:center;gap:4px;cursor:pointer;">
                <i data-lucide="arrow-left" style="width:10px;height:10px;"></i> Back to Resource
            </div>
            
            <div class="inspector-header">
                <div class="section-label">EDIT STEP ${currentIdx + 1}</div>
                <input type="text" class="inspector-name-input" 
                      value="${esc(step.name)}" 
                      onblur="OL.updateAtomicStep('${resId}', '${step.id}', 'name', this.value)"
                      placeholder="Step Name">
                <button onclick="OL.deleteStep('${resId}','${step.id}')"
                        style="padding:4px 8px;border-radius:6px;font-size:10px;cursor:pointer;
                               border:1px solid rgba(239,68,68,0.3);background:rgba(239,68,68,0.06);
                               color:#ef4444;flex-shrink:0;">
                    Delete step
                </button>
                <button onclick="event.preventDefault(); event.stopPropagation(); 
                                 OL.handleResourceSave('${res.id}', 'isArchived', ${!res.isArchived}); 
                                 renderResourceManager();"
                        title="${res.isArchived ? 'Unarchive' : 'Archive'}"
                        style="color:${res.isArchived ? '#ef4444' : 'var(--text-muted)'};">
                    <i data-lucide="archive" style="width:12px;height:12px;"></i>
                </button>
            </div>

            <div class="inspector-body">
                <div class="inspector-section">
                    <div class="section-label">
                        <i data-lucide="corner-right-up" style="width:11px;height:11px;"></i>
                        Move to resource
                    </div>
                    <select class="fvi-select"
                            onchange="if(this.value) OL.executeStepMove('${resId}', '${step.id}', this.value); this.value='';">
                        <option value="">— Keep in ${esc(res.name)} —</option>
                        <optgroup label="Same stage">
                            ${(OL.getCurrentProjectData().resources || [])
                                .filter(r => String(r.id) !== String(resId) && r.stageId === res.stageId)
                                .sort((a,b) => a.name.localeCompare(b.name))
                                .map(r => `<option value="${r.id}">${esc(r.name)} (${(r.steps||[]).length} steps)</option>`)
                                .join('')}
                        </optgroup>
                        <optgroup label="All resources">
                            ${(OL.getCurrentProjectData().resources || [])
                                .filter(r => String(r.id) !== String(resId) && r.stageId !== res.stageId)
                                .sort((a,b) => a.name.localeCompare(b.name))
                                .map(r => `<option value="${r.id}">${esc(r.name)} (${(r.steps||[]).length} steps)</option>`)
                                .join('')}
                        </optgroup>
                    </select>
                </div>
                
                <div class="inspector-section">
                    <div class="section-label">
                        <i data-lucide="arrow-down-to-line" style="width:11px;height:11px;"></i> INPUT CONDITIONS
                    </div>
                    ${step.logic.in.map((l, i) => OL.renderLogicBlock(resId, step.id, 'in', i, l, allOptions)).join('')}
                </div>

                <div class="inspector-section">
                    <label class="section-label">
                        <i data-lucide="notebook-pen" style="width:11px;height:11px;"></i> INTERNAL NOTES
                    </label>
                    <textarea class="modal-textarea" style="min-height:60px;"
                              onblur="OL.updateAtomicStep('${resId}', '${step.id}', 'description', this.value)">${esc(step.description || '')}</textarea>
                </div>

                <div class="inspector-section">
                    <label class="section-label">
                        <i data-lucide="target" style="width:11px;height:11px;"></i> RELATIONAL TARGET (MILESTONE)
                    </label>
                    ${step.targetResourceId ? `
                        <div class="pill accent" style="display:flex; justify-content:space-between; align-items:center; background:rgba(var(--accent-rgb), 0.1); border:1px solid var(--accent);">
                            <span style="display:flex;align-items:center;gap:4px;">
                                <i data-lucide="target" style="width:10px;height:10px;"></i>
                                ${esc(step.targetResourceName)}
                            </span>
                            <b class="is-clickable" style="opacity:0.5;" onclick="OL.setStepTargetResource('${resId}', '${step.id}', null, null)">×</b>
                        </div>
                    ` : `
                        <div class="search-map-container">
                            <input type="text" class="modal-input tiny" placeholder="Search Milestones..." 
                                  onfocus="OL.filterTargetSearch('${resId}', '${step.id}', '')"
                                  oninput="OL.filterTargetSearch('${resId}', '${step.id}', this.value)">
                            <div id="target-search-results" class="search-results-overlay"></div>
                        </div>
                    `}
                </div>

                <div class="inspector-section">
                    <label class="section-label">
                        <i data-lucide="users" style="width:11px;height:11px;"></i> ASSIGNEES (WHO?)
                    </label>
                    <div class="pill-display" style="display:flex; flex-wrap:wrap; gap:4px; margin-bottom:8px;">
                        ${step.assignees.length > 0 ? step.assignees.map((a, idx) => `
                            <span style="display:inline-flex;align-items:center;gap:5px;
                                         padding:3px 8px;border-radius:99px;font-size:10px;font-weight:600;
                                         background:var(--accent-glow);color:var(--accent);
                                         border:1px solid rgba(61,217,197,0.3);">
                                <i data-lucide="${a.type==='person' ? 'user' : a.type==='role' ? 'users' : 'smartphone'}" 
                                   style="width:10px;height:10px;"></i>
                                ${esc(a.name)}
                                <span onclick="OL.removeAssignee('${resId}','${step.id}',${idx})"
                                      style="opacity:0.5;cursor:pointer;margin-left:2px;font-size:12px;line-height:1;">×</span>
                            </span>
                        `).join('') : '<div class="tiny muted italic" style="padding: 5px;">Unassigned</div>'}
                    </div>
                    <div class="search-map-container">
                        <input type="text" class="modal-input tiny" placeholder="Add Person, Role, or App..."
                               onfocus="OL.filterAssignmentSearch('${resId}', '${step.id}', false, '')"
                               oninput="OL.filterAssignmentSearch('${resId}', '${step.id}', false, this.value)">
                        <div id="assignment-search-results" class="search-results-overlay"></div>
                    </div>
                </div>

                <div class="inspector-section">
                    <label class="section-label">
                        <i data-lucide="smartphone" style="width:11px;height:11px;"></i> PRIMARY APPLICATION (TOOL)
                    </label>
                    ${step.appId ? `
                        <div class="pill-display" style="margin-bottom:8px;">
                            <span style="display:inline-flex;align-items:center;gap:5px;
                                         padding:3px 8px;border-radius:99px;font-size:10px;font-weight:600;
                                         background:var(--accent-glow);color:var(--accent);
                                         border:1px solid rgba(61,217,197,0.3);">
                                <i data-lucide="smartphone" style="width:10px;height:10px;"></i>
                                ${esc(step.appName)}
                                <span onclick="OL.removeAppFromStep('${resId}','${step.id}')"
                                      style="opacity:0.5;cursor:pointer;margin-left:2px;font-size:12px;line-height:1;">×</span>
                            </span>
                        </div>
                    ` : `
                        <div class="search-map-container">
                            <input type="text" class="modal-input tiny" placeholder="Link Application..." 
                                  onfocus="OL.filterAppSearch('${resId}', '${step.id}', '')"
                                  oninput="OL.filterAppSearch('${resId}', '${step.id}', this.value)">
                            <div id="app-search-results" class="search-results-overlay"></div>
                        </div>
                    `}
                </div>

                <div class="inspector-section">
                    <label class="section-label">
                        <i data-lucide="git-merge" style="width:11px;height:11px;"></i> CONSOLIDATION GROUP
                    </label>
                    ${step.stepGroup ? `
                        <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
                            <span style="display:inline-flex;align-items:center;gap:5px;
                                         padding:3px 10px;border-radius:99px;font-size:10px;font-weight:600;
                                         background:var(--accent-glow);color:var(--accent);
                                         border:1px solid rgba(61,217,197,0.3);">
                                ${esc(step.stepGroup)}
                                <span onclick="OL._fvSetStepGroup('${resId}','${step.id}',null)"
                                      style="opacity:0.5;cursor:pointer;margin-left:2px;font-size:12px;line-height:1;"
                                      title="Remove from group">×</span>
                            </span>
                        </div>
                        <input type="text" class="modal-input tiny" placeholder="Rename group…"
                               value="${esc(step.stepGroup)}"
                               onblur="if(this.value.trim()) OL._fvSetStepGroup('${resId}','${step.id}',this.value)"
                               onkeydown="if(event.key==='Enter'){this.blur();}">
                    ` : `
                        <div class="tiny muted italic" style="padding:4px 0 6px;">Not grouped</div>
                        <input type="text" class="modal-input tiny" placeholder="Assign to group…"
                               onblur="if(this.value.trim()) OL._fvSetStepGroup('${resId}','${step.id}',this.value)"
                               onkeydown="if(event.key==='Enter'){this.blur();}">
                        <div class="tiny muted" style="margin-top:4px;opacity:0.6;">
                            Steps with the same group name across resources consolidate into one card in the visualizer.
                        </div>
                    `}
                </div>

                <div class="inspector-section">
                    <label class="section-label">
                        <i data-lucide="link-2" style="width:11px;height:11px;"></i> ATTACHED GUIDES & ASSETS
                    </label>
                    <div id="step-resources-list-${step.id}" style="margin-bottom:8px;">
                        ${renderStepResources(resId, step)}
                    </div>
                    <div class="search-map-container">
                        <input type="text" class="modal-input tiny" placeholder="+ Link Resource or SOP..." 
                               onfocus="OL.filterResourceSearch('${resId}', '${step.id}', this.value)"
                               oninput="OL.filterResourceSearch('${resId}', '${step.id}', this.value)">
                        <div id="resource-results-${step.id}" class="search-results-overlay"></div>
                    </div>
                </div>

                <div class="inspector-section">
                    <label class="section-label">
                        <i data-lucide="calendar-clock" style="width:11px;height:11px;"></i> DYNAMIC SCHEDULING
                    </label>
                    <div style="display:flex; gap:8px; align-items:center;">
                        <input type="number" class="modal-input tiny" style="width:50px;" 
                               value="${step.timingValue || 0}" 
                               onblur="OL.updateAtomicStep('${resId}', '${step.id}', 'timingValue', this.value)">
                        <select class="modal-input tiny" style="flex:1;" 
                                onchange="OL.updateAtomicStep('${resId}', '${step.id}', 'timingType', this.value)">
                            <option value="after_prev" ${step.timingType === 'after_prev' ? 'selected' : ''}>Days after Previous</option>
                            <option value="after_start" ${step.timingType === 'after_start' ? 'selected' : ''}>Days after Project Start</option>
                            <option value="manual" ${step.timingType === 'manual' ? 'selected' : ''}>Fixed Date</option>
                        </select>
                    </div>
                    ${step.timingType === 'manual' ? `
                        <input type="date" class="modal-input tiny" style="margin-top:8px;"
                               value="${step.fixedDate || ''}"
                               onchange="OL.updateAtomicStep('${resId}', '${step.id}', 'fixedDate', this.value)">
                    ` : ''}
                </div>

                <div class="inspector-section">
                  <div class="section-label">
                    <i data-lucide="arrow-up-from-line" style="width:11px;height:11px;"></i> NEXT STEP
                </div>
                
                  ${(step.logic?.out || []).map((l, i) => {
                    const targetId = l.targetId || '';
                    let targetLabel = '— Select target —';
                    if (targetId) {
                      const lastH  = targetId.lastIndexOf('-');
                      const tResId = targetId.substring(0, lastH);
                      const tStepId = targetId.substring(lastH + 1);
                      const tRes  = (OL.getCurrentProjectData().resources||[]).find(r => String(r.id) === tResId);
                      const tStep = tRes?.steps?.find(s => String(s.id) === tStepId);
                      if (tRes && tStep) targetLabel = `${esc(tRes.name)} › ${esc(tStep.name||'Step')}`;
                    }
                    return `
                      <div style="background:var(--panel-soft);border:1px solid var(--panel-border);border-radius:8px;
                                  padding:10px 12px;margin-bottom:8px;">
                
                        <div style="display:flex;gap:4px;margin-bottom:8px;flex-wrap:wrap;">
                          ${[
                            { key:'next',      label:'Next',  icon:'arrow-right' },
                            { key:'condition', label:'If',    icon:'git-branch'  },
                            { key:'loop',      label:'Loop',  icon:'repeat'      },
                            { key:'delay',     label:'Delay', icon:'clock'       },
                          ].map(t => {
                            const types = (l.types || [l.type || 'next']);
                            const isOn  = types.includes(t.key);
                            return `
                              <span onclick="event.stopPropagation(); OL._fvToggleLogicType('${resId}','${step.id}',${i},'${t.key}')"
                                    style="display:inline-flex;align-items:center;gap:4px;
                                           font-size:9px;font-weight:700;padding:3px 9px;border-radius:99px;
                                           cursor:pointer;text-transform:uppercase;letter-spacing:0.05em;
                                           background:${isOn ? 'var(--accent)' : 'var(--panel-soft)'};
                                           color:${isOn ? 'var(--panel)' : 'var(--text-muted)'};
                                           border:1px solid ${isOn ? 'var(--accent)' : 'var(--panel-border)'};">
                                <i data-lucide="${t.icon}" style="width:10px;height:10px;pointer-events:none;"></i>
                                ${t.label}
                              </span>
                            `;
                          }).join('')}
                        </div>
                
                        <div style="position:relative;margin-bottom:${l.type==='condition'||l.type==='delay' ? '8px' : '0'};">
                          <div onclick="OL._fvOpenTargetPicker('${resId}','${step.id}',${i})"
                               style="padding:7px 10px;border:1px solid var(--panel-border);border-radius:8px;
                                      font-size:11px;color:${targetId ? 'var(--text-main)' : 'var(--text-muted)'};
                                      background:var(--panel);cursor:pointer;display:flex;
                                      align-items:center;justify-content:space-between;">
                            <span>${targetLabel}</span>
                            <i data-lucide="chevron-down" style="width:12px;height:12px;color:var(--text-muted);"></i>
                          </div>
                          <div id="target-picker-${resId}-${step.id}-${i}"
                               class="search-results-overlay" style="display:none;max-height:200px;overflow-y:auto;"></div>
                        </div>
                
                        ${(l.types||[l.type||'next']).includes('condition') ? `
                            <div style="margin-top:6px;">
                                <label style="font-size:9px;color:var(--text-muted);text-transform:uppercase;
                                               letter-spacing:0.06em;display:flex;align-items:center;gap:4px;margin-bottom:4px;">
                                    <i data-lucide="git-branch" style="width:9px;height:9px;"></i> Condition
                                </label>
                                <input type="text" class="fvi-input"
                                       placeholder="e.g. If approved..."
                                       value="${esc(l.rule||'')}"
                                       onblur="OL.updateStepLogic('${resId}','${step.id}','out',${i},'rule',this.value)">
                            </div>
                        ` : ''}
                        
                        ${(l.types||[l.type||'next']).includes('delay') ? `
                            <div style="margin-top:6px;">
                                <label style="font-size:9px;color:var(--text-muted);text-transform:uppercase;
                                               letter-spacing:0.06em;display:flex;align-items:center;gap:4px;margin-bottom:4px;">
                                    <i data-lucide="clock" style="width:9px;height:9px;"></i> Delay
                                </label>
                                <div style="display:flex;gap:6px;align-items:center;">
                                    <input type="number" class="fvi-input" style="width:70px;"
                                           placeholder="0"
                                           value="${esc(String(l.delayValue||''))}"
                                           onblur="OL.updateStepLogic('${resId}','${step.id}','out',${i},'delayValue',this.value)">
                                    <select class="fvi-select" style="flex:1;"
                                            onchange="OL.updateStepLogic('${resId}','${step.id}','out',${i},'delayUnit',this.value)">
                                        <option value="hours" ${l.delayUnit==='hours'?'selected':''}>Hours</option>
                                        <option value="days"  ${l.delayUnit==='days' ?'selected':''}>Days</option>
                                        <option value="weeks" ${l.delayUnit==='weeks'?'selected':''}>Weeks</option>
                                    </select>
                                </div>
                            </div>
                        ` : ''}
                        
                        ${(l.types||[l.type||'next']).includes('loop') ? `
                            <div style="margin-top:6px;">
                                <label style="font-size:9px;color:var(--text-muted);text-transform:uppercase;
                                               letter-spacing:0.06em;display:flex;align-items:center;gap:4px;margin-bottom:4px;">
                                    <i data-lucide="repeat" style="width:9px;height:9px;"></i> Loop limit
                                </label>
                                <input type="text" class="fvi-input"
                                       placeholder="e.g. 3 times, or leave blank for infinite"
                                       value="${esc(l.loopLimit||'')}"
                                       onblur="OL.updateStepLogic('${resId}','${step.id}','out',${i},'loopLimit',this.value)">
                            </div>
                        ` : ''}
                    
                        <button onclick="OL.removeStepLogic('${resId}','${step.id}','out',${i})"
                                style="margin-top:8px;width:100%;background:none;border:none;
                                       color:#ef4444;font-size:10px;cursor:pointer;
                                       text-align:left;padding:0;font-family:inherit;">
                          Remove
                        </button>
                      </div>
                    `;
                  }).join('')}
                
                  <button onclick="OL.addStepLogic('${resId}', '${step.id}', 'out')"
                          class="fvi-add-step-btn" style="margin-top:4px;">
                    + Add Output
                  </button>
                </div>

                <div class="inspector-section">
                    <label class="section-label">
                        <i data-lucide="tag" style="width:11px;height:11px;"></i> DATA REQUIREMENTS (INPUT/OUTPUT)
                    </label>
                    <div class="pill-display" style="display:flex; flex-wrap:wrap; gap:4px; margin-bottom:8px;">
                        ${step.datapoints && step.datapoints.length > 0 
                            ? OL.renderDataTagPills(resId, step.id, step.datapoints) 
                            : '<div class="tiny muted italic">No data mapped. Drag tags from sidebar to add.</div>'}
                    </div>
                    
                    <div class="data-drop-zone-hint" 
                        ondragover="event.preventDefault(); this.style.borderColor='var(--accent)';" 
                        ondragleave="this.style.borderColor='transparent';"
                        ondrop="OL.handleUniversalDropOnStep(event, '${resId}', '${step.id}')"
                        style="border: 1px dashed transparent; border-radius: 4px; padding: 5px; text-align: center; transition: 0.2s;">
                        <small class="tiny muted" style="font-size: 8px;">Drop tags here to map</small>
                    </div>
                </div>
            </div>
        `;
        if (window.lucide) window.lucide.createIcons();
        return;
    }
    // 📑 3. RESOURCE (CARD) DETAIL MODE
if (mode === 'cards' && resId) {
    const res = resources.find(r => String(r.id) === String(resId));
    if (!res) return;

    const rawType = String(res.type || 'General');
    const resTypeLower = rawType.toLowerCase();
    
    // 1. Resolve Auto-Mapping from Registry
    const typeDef = (state.master.resourceTypes || []).find(t => t.type.toLowerCase() === resTypeLower);
    const isLockedType = !!(typeDef && typeDef.matchedFunctionId);
    const isZap = resTypeLower === 'zap';
    const autoApp = (isLockedType && !isZap) ? OL.getAppByFunction(rawType, res.matchedFunctionId) : null;

    // 🎯 2. THE OVERRIDE PROTECTION
    // Only auto-assign if the field is currently EMPTY.
    if (autoApp && !res.appId) {
        console.log(`🤖 Inspector auto-assigning ${autoApp.name}`);
        res.appId = autoApp.id;
        res.appName = autoApp.name;
        OL.handleResourceSave(res.id, 'appId', autoApp.id);
        OL.handleResourceSave(res.id, 'appName', autoApp.name);
    }

    // 3. Determine UI state for the override badge
    const isManualOverride = res.appId && autoApp && String(res.appId) !== String(autoApp.id);

    content.innerHTML = `
        <div class="inspector-header">
            <div class="section-label">EDIT RESOURCE</div>
            <textarea id="modal-res-name" class="inspector-name-input res-name-auto" 
                onblur="OL.handleResourceSave('${res.id}', 'name', this.value)">${esc(res.name)}</textarea>
        </div>

        <div class="inspector-body">
            <div class="inspector-section no-border">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                    <label class="section-label" style="margin:0;">
                        <i data-lucide="smartphone" style="width:11px;height:11px;"></i> PRIMARY APPLICATION
                    </label>
                    ${isManualOverride ? '<span class="tiny accent bold" style="font-size:8px; letter-spacing:0.5px;">CUSTOM OVERRIDE</span>' : ''}
                </div>

                <div id="res-app-pill-${res.id}" class="pill-display">
                    ${isZap ? `
                        <div class="tiny muted italic">Multi-app automation.</div>
                    ` : (res.appId ? `
                        <div class="pill ${isManualOverride ? 'accent' : 'primary'}" 
                             style="display:flex; justify-content:space-between; align-items:center; width:100%;">
                            <span class="pill-text">
                                ${isManualOverride ? '✏️' : '🤖'} ${esc(res.appName)}
                            </span>
                            <b class="is-clickable pill-remove" 
                               title="Clear and Revert"
                               style="padding: 2px 6px; opacity: 0.5;"
                               onclick="OL.handleResourceSave('${res.id}', 'appId', null); OL.handleResourceSave('${res.id}', 'appName', null); OL.openInspector('${res.id}', null, 'cards');">
                               ×
                            </b>
                        </div>
                    ` : `
                        <div class="search-map-container">
                            <input type="text" class="modal-input tiny" placeholder="Search App Registry..."
                                   onfocus="OL.filterAppSearch('${res.id}', null, true, '')"
                                   oninput="OL.filterAppSearch('${res.id}', null, true, this.value)">
                            <div id="res-app-results" class="search-results-overlay"></div>
                        </div>
                    `)}
                </div>
            </div>

            ${isLockedType && !autoApp && !isZap ? `
                <div class="inspector-section no-border">
                    <div class="pill warning">
                        <span class="pill-text">⚠️ No Primary tool found for this function in the Registry.</span>
                    </div>
                </div>
            ` : ''}

                <div class="inspector-section no-border">
                    <label class="section-label">
                        <i data-lucide="link-2" style="width:11px;height:11px;"></i> EXTERNAL LINK
                    </label>
                    <input type="url" class="modal-input tiny" placeholder="https://..." value="${esc(res.externalLink || '')}" onblur="OL.handleResourceSave('${res.id}', 'externalLink', this.value)">
                </div>

                ${!isZap ? `
                <div class="inspector-section no-border">
                    <label class="section-label">
                        <i data-lucide="users" style="width:11px;height:11px;"></i> RESOURCE ASSIGNEE(S)
                    </label>
                    <div id="res-assignee-pills-${res.id}" class="pill-display assignee-row">
                        ${(res.assignees || []).length > 0 ? res.assignees.map((a, idx) => `
                            <span style="display:inline-flex;align-items:center;gap:5px;
                                         padding:3px 8px;border-radius:99px;font-size:10px;font-weight:600;
                                         background:var(--accent-glow);color:var(--accent);
                                         border:1px solid rgba(61,217,197,0.3);">
                                <i data-lucide="${a.type === 'person' ? 'user' : 'users'}" style="width:10px;height:10px;"></i>
                                ${esc(a.name)}
                                <span onclick="OL.removeResourceAssignee('${res.id}', ${idx})"
                                      style="opacity:0.5;cursor:pointer;margin-left:2px;font-size:12px;line-height:1;">×</span>
                            </span>
                        `).join('') : '<div class="tiny muted italic">Unassigned</div>'}
                    </div>
                    <div class="search-map-container">
                        <input type="text" class="modal-input tiny" placeholder="Search People or Roles..." onfocus="OL.filterAssignmentSearch('${res.id}', null, true, '')" oninput="OL.filterAssignmentSearch('${res.id}', null, true, this.value)">
                        <div id="res-assignment-results" class="search-results-overlay"></div>
                    </div>
                </div>
                ` : ''}

                <div class="inspector-section no-border">
                    <label class="section-label">
                        <i data-lucide="calendar" style="width:11px;height:11px;"></i> DUE DATE
                    </label>
                    <input type="date" class="modal-input tiny" value="${res.dueDate || ''}" onchange="OL.handleResourceSave('${res.id}', 'dueDate', this.value)">
                </div>

                <div class="inspector-section" style="position: relative; width: 100%;">
                    <label class="section-label" style="display: flex; align-items: center; gap: 6px; font-weight: 700; margin-bottom: 6px;">
                        <i data-lucide="milestone" style="width:11px; height:11px;"></i> STAGE & WORKFLOW
                    </label>
                    
                    <div class="fv-custom-select-trigger" 
                         onclick="event.stopPropagation(); const menu = this.nextElementSibling; menu.style.display = menu.style.display === 'block' ? 'none' : 'block';"
                         style="display: flex; align-items: center; justify-content: space-between; width: 100%; box-sizing: border-box; padding: 6px 12px; background:var(--panel); border:1px solid var(--panel-border); color:var(--text-main); border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; min-height: 32px; user-select: none;">
                        <span>
                            ${(function() {
                                if (!res.stageId && !res.workflowId) return 'Unassigned (Workbench Side-Tray)';
                                const projectData = OL.getCurrentProjectData();
                                if (res.workflowId) {
                                    const wf = (projectData.workflows || []).find(w => String(w.id) === String(res.workflowId));
                                    return wf ? `Workflow: ${esc(wf.name)}` : 'Select Location...';
                                }
                                const stg = (projectData.stages || []).find(s => String(s.id) === String(res.stageId));
                                return stg ? `Stage: ${esc(stg.name)}` : 'Select Location...';
                            })()}
                        </span>
                        <i data-lucide="chevron-down" style="width: 14px; height: 14px; opacity: 0.6; color:var(--text-dim);"></i>
                    </div>
                
                    <div class="fv-custom-select-menu" 
                         style="display: none; position: absolute; top: 100%; left: 0; width: 100%; z-index: 100; background:var(--panel); border:1px solid var(--panel-border); border-radius: 6px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -1px rgba(0,0,0,0.06); max-height: 250px; overflow-y: auto; margin-top: 4px; box-sizing: border-box;">
                        
                        <div class="fv-custom-option" 
                             style="padding: 8px 12px; font-size: 11px; font-weight: 700; color: #ef4444; cursor: pointer; border-bottom: 1px solid #f3f4f6;"
                             onclick="
                                 OL.handleResourceSave('${res.id}', 'stageId', '');
                                 OL.handleResourceSave('${res.id}', 'workflowId', '');
                                 OL._fvOpenStepsList('${res.id}');
                                 this.parentElement.style.display = 'none';
                             "
                             onmouseover="this.style.background='rgba(239,68,68,0.08)';"
                             onmouseout="this.style.background='transparent';">
                             Remove Assignment (Workbench Side-Tray)
                        </div>
                
                        ${(function() {
                            const projectData = OL.getCurrentProjectData();
                            const currentStages = projectData.stages || [];
                            const currentWorkflows = projectData.workflows || [];
                            
                            return currentStages.map(s => {
                                const stageWorkflows = currentWorkflows.filter(w => String(w.stageId) === String(s.id));
                                
                                return `
                                    <div class="fv-custom-option stage-header-row" 
                                         style="padding: 8px 12px; font-size: 11px; font-weight: 700; color:var(--text-main); background:var(--panel-dark); border-bottom: 1px solid #f3f4f6; display: flex; align-items: center; gap: 4px; cursor: pointer;"
                                         onclick="
                                             OL.handleResourceSave('${res.id}', 'stageId', '${s.id}');
                                             OL.handleResourceSave('${res.id}', 'workflowId', '');
                                             OL._fvOpenStepsList('${res.id}');
                                             this.parentElement.style.display = 'none';
                                         "
                                         onmouseover="this.style.background='var(--panel-soft)';"
                                         onmouseout="this.style.background='var(--panel-dark)';">
                                         <i data-lucide="folder" style="width:12px; height:12px; color:var(--text-dim);"></i>
                                         <span>STAGE: ${esc(s.name.toUpperCase())}</span>
                                    </div>
                                    
                                    ${stageWorkflows.map(wf => `
                                        <div class="fv-custom-option workflow-item-row" 
                                             style="padding: 8px 12px 8px 24px; font-size: 12px; font-weight: 500; color:var(--text-main); cursor: pointer; border-bottom: 1px solid #f9fafb; display: flex; align-items: center; gap: 4px; transition: background 0.1s;"
                                             onclick="
                                                 OL.handleResourceSave('${res.id}', 'stageId', '${s.id}');
                                                 OL.handleResourceSave('${res.id}', 'workflowId', '${wf.id}');
                                                 OL._fvOpenStepsList('${res.id}');
                                                 this.parentElement.style.display = 'none';
                                             "
                                             onmouseover="this.style.background='rgba(61,217,197,0.08)'; this.style.color='#0d9488';"
                                             onmouseout="this.style.background='transparent'; this.style.color='var(--text-main)';">
                                             <i data-lucide="git-commit" style="width:12px; height:12px; opacity: 0.5;"></i>
                                             <span>${esc(wf.name)}</span>
                                        </div>
                                    `).join('')}
                                `;
                            }).join('');
                        })()}
                    </div>
                </div>
                
                <script>
                    // Global auto-dismiss framework listener loop
                    document.addEventListener('click', function() {
                        document.querySelectorAll('.fv-custom-select-menu').forEach(el => el.style.display = 'none');
                    });
                </script>

                <div class="inspector-section">
                    <label class="section-label">
                        <i data-lucide="folder" style="width:11px;height:11px;"></i> CLASSIFICATION
                    </label>
                    <div style="display:flex;gap:8px;align-items:center;">
                        <select class="modal-input tiny" onchange="OL.handleResourceSave('${res.id}', 'type', this.value); OL.openInspector('${res.id}', null, 'cards');">
                            <option value="General" ${res.type === 'General' ? 'selected' : ''}>General</option>
                            ${(state.master.resourceTypes || []).map(t => `<option value="${esc(t.type)}" ${res.type === t.type ? 'selected' : ''}>${esc(t.type)}</option>`).join('')}
                        </select>
                        <button onclick="event.preventDefault(); event.stopPropagation(); 
                                         OL.handleResourceSave('${res.id}', 'isArchived', ${!res.isArchived}); 
                                         renderResourceManager();"
                                title="${res.isArchived ? 'Unarchive' : 'Archive'}"
                                style="color:${res.isArchived ? '#ef4444' : 'var(--text-muted)'};">
                            <i data-lucide="archive" style="width:12px;height:12px;"></i>
                        </button>
                    </div>
                </div>

                <div class="inspector-section">
                    <label class="section-label">
                        <i data-lucide="globe" style="width:11px;height:11px;"></i> VISIBILITY
                    </label>
                    <div style="display:flex;align-items:center;gap:8px;">
                        <button onclick="OL.handleResourceSave('${res.id}', 'isGlobal', ${!res.isGlobal}); OL.openInspector('${res.id}', null, 'cards');"
                                style="padding:4px 10px;border-radius:99px;font-size:11px;font-weight:600;cursor:pointer;
                                       border:1px solid ${res.isGlobal ? '#3dd9c5' : 'var(--panel-border)'};
                                       background:${res.isGlobal ? 'rgba(61,217,197,0.1)' : 'var(--panel-soft)'};
                                       color:${res.isGlobal ? '#3dd9c5' : 'var(--text-muted)'};">
                            🌐 ${res.isGlobal ? 'Global (click to unset)' : 'Set as Global'}
                        </button>
                    </div>
                </div>

                <div class="inspector-section">
                    <label class="section-label">
                        <i data-lucide="file-text" style="width:11px;height:11px;"></i> DESCRIPTION
                    </label>
                    <textarea class="modal-textarea res-desc-input" placeholder="Notes..." onblur="OL.handleResourceSave('${res.id}', 'description', this.value)">${esc(res.description || '')}</textarea>
                </div>
            </div>
        `;
        if (window.lucide) window.lucide.createIcons();
        return;
    }

    content.innerHTML = `<div class="muted-notice">Select a card or step to inspect.</div>`;
    if (window.lucide) window.lucide.createIcons();
}; 

export function executeStepMove(fromResId, stepId, toResId) {
    const data = OL.getCurrentProjectData();
    const fromRes = data.resources.find(r => String(r.id) === String(fromResId));
    const toRes   = data.resources.find(r => String(r.id) === String(toResId));
    if (!fromRes || !toRes) return;

    const stepIdx = (fromRes.steps || []).findIndex(s => String(s.id) === String(stepId));
    if (stepIdx === -1) return;

    const [movedStep] = fromRes.steps.splice(stepIdx, 1);
    if (!toRes.steps) toRes.steps = [];
    toRes.steps.push(movedStep);

    OL.persist();

    // Refresh whichever view is active
    const modalOpen = document.getElementById('modal-layer')?.style.display === 'flex';
    if (modalOpen) {
        OL.openResourceModal(fromResId);
    } else {
        OL._fvOpenStepsList(fromResId);
    }
};

export function _fvToggleLogicType(resId, stepId, idx, type) {
    const data = OL.getCurrentProjectData();
    const res  = (data.resources||[]).find(r => String(r.id) === resId);
    const step = res?.steps?.find(s => String(s.id) === stepId);
    if (!step?.logic?.out?.[idx]) return;

    const rule = step.logic.out[idx];
    if (!rule.types) rule.types = [rule.type || 'next'];

    const pos = rule.types.indexOf(type);
    if (pos === -1) {
        rule.types.push(type);
    } else {
        rule.types.splice(pos, 1);
        if (rule.types.length === 0) rule.types = ['next'];
    }
    // Keep legacy type field in sync with first type
    rule.type = rule.types[0];

    OL.persist();
    OL._fvRefreshInspector(resId, stepId);
};

export function _fvOpenTargetPicker(resId, stepId, idx) {
    const pickerId = `target-picker-${resId}-${stepId}-${idx}`;
    const picker   = document.getElementById(pickerId);
    if (!picker) return;

    const isOpen = picker.style.display === 'block';
    document.querySelectorAll('.search-results-overlay').forEach(el => el.style.display = 'none');
    if (isOpen) return;

    const data      = OL.getCurrentProjectData();
    const resources = (data.resources||[]).filter(r => !r.isDeleted && !r.isLocked);

    const buildList = (q) => {
        let html = '';
        resources.forEach(res => {
            if (!(res.steps||[]).length) return;
            const steps = res.steps.filter(s => 
                !q || 
                (s.name||'').toLowerCase().includes(q) || 
                res.name.toLowerCase().includes(q)
            );
            if (!steps.length) return;
            html += `<div style="padding:6px 10px;font-size:9px;font-weight:700;
                                 text-transform:uppercase;letter-spacing:0.08em;
                                 color:var(--text-muted);background:var(--panel-soft);">
                       ${esc(res.name)}
                     </div>`;
            steps.forEach(s => {
                const fullId = `${res.id}-${s.id}`;
                html += `<div class="search-result-item"
                              onmousedown="OL.updateStepTarget('${resId}','${stepId}','out',${idx},'${fullId}')">
                           ${esc(s.name || 'Unnamed Step')}
                         </div>`;
            });
        });
        return html || '<div class="search-result-item muted">No steps found.</div>';
    };

    picker.innerHTML = `
        <div style="padding:8px;border-bottom:1px solid #e5e7eb;position:sticky;top:0;background:var(--panel);z-index:1;">
            <input type="text" class="fvi-input" placeholder="Search steps..."
                   style="margin:0;"
                   oninput="document.getElementById('${pickerId}-list').innerHTML = 
                       (function(q){ 
                           ${resources.map(res => '').join('')}
                       })(this.value.toLowerCase().trim())"
                   autofocus>
        </div>
        <div id="${pickerId}-list">${buildList('')}</div>
    `;

    // Wire up the search properly after render
    const input = picker.querySelector('input');
    if (input) {
        input.addEventListener('input', () => {
            const list = document.getElementById(`${pickerId}-list`);
            if (list) list.innerHTML = buildList(input.value.toLowerCase().trim());
        });
        setTimeout(() => input.focus(), 50);
    }

    picker.style.display = 'block';
};

export function renderStepResources(resId, step) {
    const links = step.links || [];
    if (links.length === 0) return '<div class="tiny muted" style="padding:5px;opacity:0.6;">No linked items.</div>';
    
    return links.map((link, idx) => {
        const isSOP = link.type === 'sop' || link.type === 'guide';
        const icon = isSOP ? 'book-open' : 'database';
        const openAction = isSOP ? `OL.openGuideEditor('${link.id}')` : `OL.openResourceModal('${link.id}')`;
        const deleteAction = `event.stopPropagation(); OL.removeStepLink('${resId}', '${step.id}', ${idx})`;

        return `
            <span onclick="${openAction}"
                  style="display:inline-flex;align-items:center;gap:5px;
                         padding:3px 8px;border-radius:99px;font-size:10px;font-weight:600;
                         background:var(--accent-glow);color:var(--accent);
                         border:1px solid rgba(61,217,197,0.3);
                         cursor:pointer;margin-bottom:4px;margin-right:4px;">
                <i data-lucide="${icon}" style="width:10px;height:10px;pointer-events:none;"></i>
                <span style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                    ${esc(link.name)}
                </span>
                <span onclick="${deleteAction}"
                      style="opacity:0.5;cursor:pointer;margin-left:2px;font-size:12px;line-height:1;">×</span>
            </span>
        `;
    }).join('');
};

export function updateAtomicStep(resId, stepId, field, value) {
    const data = OL.getCurrentProjectData(); 
    const projectResources = data.resources || [];
    
    let targetRes = projectResources.find(r => String(r.id) === String(resId));
    if (!targetRes) {
        targetRes = (state.master?.resources || []).find(r => String(r.id) === String(resId));
    }
    if (!targetRes?.steps) return;

    const step = targetRes.steps.find(s => String(s.id) === String(stepId));
    if (!step) return;

    step[field] = value;
    OL.persist();

    // Surgical DOM updates — no full re-render
    if (field === 'name') {
        // Update step name in list view if visible
        const stepRow = document.getElementById(`fv-list-step-${stepId}`);
        if (stepRow) {
            const nameEl = stepRow.querySelector('.fv-list-step-name');
            if (nameEl) nameEl.textContent = value;
        }
        // Update step in inspector steps list
        const fviRow = document.querySelector(`[onclick*="'${stepId}'"] .fvi-step-name`);
        if (fviRow) fviRow.textContent = value;
        // Update card in flowchart if visible
        const cardStep = document.querySelector(`.fv-card-step-name[data-step-id="${stepId}"]`);
        if (cardStep) cardStep.textContent = value;
    }
    // For all other fields, refresh just the inspector content
    // preserving scroll position
    else {
        OL._fvRefreshInspector(resId, stepId);
    }
};

// Add this helper:
export function _fvRefreshInspector(resId, stepId) {
    // Save scroll position
    const scrollContent = document.querySelector('.inspector-scroll-content');
    const scrollTop = scrollContent?.scrollTop || 0;
    
    // Re-render inspector content only
    OL.openInspector(resId, stepId);
    
    // Restore scroll
    requestAnimationFrame(() => {
        const newScrollContent = document.querySelector('.inspector-scroll-content');
        if (newScrollContent) newScrollContent.scrollTop = scrollTop;
    });
};

export function filterAppSearch(parentId, stepId, arg3, arg4) {
    // Two calling conventions exist in the codebase:
    //   (parentId, stepId, query)                  → step-level search, results in #app-search-results
    //   (parentId, stepId, isResourceLevel, query)  → resource-level search, results in #res-app-results
    let query, isResourceLevel;
    if (arg4 !== undefined) {
        isResourceLevel = !!arg3;
        query = arg4;
    } else {
        isResourceLevel = false;
        query = arg3;
    }
 
    const resultsId = isResourceLevel ? 'res-app-results' : 'app-search-results';
    const resultsOverlay = document.getElementById(resultsId);
    if (!resultsOverlay) return;
 
    const q = String(query || "").toLowerCase().trim();
    const client = getActiveClient();
    const localApps = client?.projectData?.localApps || [];
    const matches = localApps.filter(a => a.name.toLowerCase().includes(q));
 
    if (matches.length === 0) {
        resultsOverlay.innerHTML = `<div class="p-10 tiny muted">No apps found.</div>`;
        resultsOverlay.style.display = 'block';
        return;
    }
 
    const selectFn = isResourceLevel ? 'OL.selectAppForResource' : 'OL.selectAppForStep';
 
    resultsOverlay.innerHTML = matches.map(app => `
        <div class="search-result-item"
             style="cursor: pointer; padding: 8px; border-bottom: 1px solid var(--line);"
             onmousedown="event.preventDefault(); event.stopPropagation(); ${selectFn}('${parentId}', '${stepId}', '${app.id}', '${esc(app.name)}');">
            <div style="display:flex; align-items:center; gap:8px;">
                <span>💻</span>
                <div>${esc(app.name)}</div>
            </div>
        </div>
    `).join('');
 
    resultsOverlay.style.display = 'block';
};
 
// 🚀 NEW: resource-level counterpart to the existing OL.selectAppForStep.
// This didn't exist before — the resource-level search had nothing to call
// even if it had worked.
export async function selectAppForResource(resId, _unused, appId, appName) {
    const overlay = document.getElementById('res-app-results');
    if (overlay) overlay.style.display = 'none';
 
    // OL.handleResourceSave already persists and refreshes whichever view
    // (modal / inspector / grid) is currently showing this resource.
    OL.handleResourceSave(resId, 'appId', appId);
    OL.handleResourceSave(resId, 'appName', appName);
};
 
export async function selectAppForStep(parentId, stepId, appId, appName) {
    const res = OL.getResourceById(parentId);
    if (!res) return;
    const step = (res.steps || []).find(s => String(s.id) === String(stepId));
    if (!step) return;

    // 1. Update data
    step.appId   = appId;
    step.appName = appName;

    // 2. Hide overlay immediately
    const overlay = document.getElementById('app-search-results');
    if (overlay) overlay.style.display = 'none';

    // 3. Persist
    OL.persist();

    // 4. Re-render inspector with correct argument order
    OL.openInspector(parentId, stepId);
};

export async function removeAppFromStep(resId, stepId) {
    const res = OL.getResourceById(resId);
    if (!res) return;

    const step = (res.steps || []).find(s => String(s.id) === String(stepId));
    if (step) {
        // Clear the linkage data
        step.appId = null;
        step.appName = null;
        
        await OL.persist();
        
        // 🔄 Force re-render of the inspector to hide the pill and show the search box
        console.log("🔄 App removed. Re-rendering inspector.");
        OL._fvRefreshInspector(resId, stepId);
    }
};

export function getFilteredAssigneeOptions(query) {
    const q = (query || "").toLowerCase().trim();
    const client = getActiveClient();
    
    // 1. Define Virtual & Global Options
    const virtualOptions = [
        { id: 'any-team', name: 'Any Team Member', type: 'role', icon: '👥' },
        { id: 'all-client', name: 'Any Client', type: 'role', icon: '🏠' },
        { id: 'role-client-1', name: 'Client 1', type: 'role', icon: '👨‍💼' },
        { id: 'role-client-2', name: 'Client 2', type: 'role', icon: '👨‍💼' },
        { id: 'role-coi', name: 'COI', type: 'role', icon: '👨‍💼' },
        { id: 'role-sphynx', name: 'Sphynx', type: 'role', icon: '👩‍🎤' }
    ];

    // 2. Gather Dynamic Data
    const masterRoles = (state.master.roles || []).map(r => ({ id: r.id, name: r.name, type: 'role', icon: '🎭' }));
    const clientRoles = (client?.projectData?.roles || []).map(r => ({ id: r.id, name: r.name, type: 'role', icon: '🎭' }));
    
    // Extract roles defined within the team member objects themselves
    const teamList = [...(state.master.teamMembers || []), ...(client?.projectData?.teamMembers || [])];
    const inlineRoles = [...new Set(teamList.flatMap(m => m.roles || []))].map(r => ({ id: `role-${r}`, name: r, type: 'role', icon: '🎭' }));

    const people = teamList.map(m => ({ id: m.id, name: m.name, type: 'person', icon: '👨‍💼' }));
    const apps = (client?.projectData?.localApps || []).map(a => ({ id: a.id, name: a.name, type: 'app', icon: '💻' }));

    // 3. Combine and Filter
    const all = [...virtualOptions, ...masterRoles, ...clientRoles, ...inlineRoles, ...people, ...apps];
    
    // Deduplicate by name (in case a role is in multiple lists)
    const unique = Array.from(new Map(all.map(item => [item.name.toLowerCase(), item])).values());

    return unique.filter(item => item.name.toLowerCase().includes(q));
};

export function filterAssignmentSearch(parentId, stepId, isResource, query) {
    const resultsOverlay = document.getElementById('assignment-search-results');
    if (!resultsOverlay) return;

    const q = (query || "").toLowerCase().trim();
    if (!q && !document.activeElement.matches(':focus')) {
        resultsOverlay.style.display = 'none';
        return;
    }

    const matches = OL.getFilteredAssigneeOptions(q);

    if (matches.length === 0) {
        resultsOverlay.innerHTML = `<div class="p-10 tiny muted">No matches found.</div>`;
        resultsOverlay.style.display = 'block';
        return;
    }

    // Group by type for the labels
    const groups = {
        role: { label: 'Roles & Clients', items: [] },
        person: { label: 'Team Members', items: [] },
        app: { label: 'Applications', items: [] }
    };

    matches.forEach(opt => groups[opt.type].items.push(opt));

    let html = '';
    Object.values(groups).forEach(g => {
        if (g.items.length === 0) return;
        html += `<div class="search-category-label">${g.label}</div>`;
        html += g.items.map(item => `
            <div class="search-result-item" onmousedown="event.preventDefault(); OL.executeAssignment('${parentId}', '${stepId}', false, '${item.id}', '${esc(item.name)}', '${item.type}')">
                ${item.icon} ${esc(item.name)}
            </div>
        `).join('');
    });

    resultsOverlay.innerHTML = html;
    resultsOverlay.style.display = 'block';
};

export async function executeAssignment(parentId, stepId, isResource, assigneeId, assigneeName, type) {
    const res = OL.getResourceById(parentId);
    if (!res) return;

    const step = (res.steps || []).find(s => String(s.id) === String(stepId));
    if (step) {
        // Initialize as array if it doesn't exist
        if (!step.assignees) step.assignees = [];

        // Prevent duplicate assignments
        const exists = step.assignees.some(a => a.id === assigneeId);
        if (!exists) {
            step.assignees.push({
                id: assigneeId,
                name: assigneeName,
                type: type
            });
            await OL.persist();
        }
        
        // Clear search and refresh
        const overlay = document.getElementById('assignment-search-results');
        if (overlay) overlay.style.display = 'none';
        OL.openInspector(parentId, stepId);
    }
    // Add this line to the end of window.OL.executeAssignment
    const searchInput = document.querySelector('.inspector-section input[placeholder*="Add Person"]');
    if (searchInput) {
        searchInput.value = '';
        searchInput.focus(); // Keep focus if you want to add multiple people quickly
    }
};

export async function removeAssignee(parentId, stepId, index) {
    const res = OL.getResourceById(parentId);
    const step = res?.steps?.find(s => String(s.id) === String(stepId));
    if (step && step.assignees) {
        step.assignees.splice(index, 1);
        await OL.persist();
        OL.openInspector(parentId, stepId);
    }
};

state.filterMatches = [];
state.canvasMatches = [];
state.currentCanvasMatchIdx = -1;

// Add this inside your toolbar initialization or global scope
document.addEventListener('keydown', (e) => {
    const searchInput = document.getElementById('canvas-filter-input');
    
    // If the user hits 'Enter' while inside the search box...
    if (e.key === 'Enter' && document.activeElement === searchInput) {
        e.preventDefault();
        OL.centerNextCanvasMatch(); // The cycling function we built earlier
    }
});

// 1. Filter Resources for the Target/Milestone search
export function filterTargetSearch(resId, stepId, query) {
    const resultsOverlay = document.getElementById('target-search-results');
    if (!resultsOverlay) return;

    const q = (query || "").toLowerCase().trim();
    const data = OL.getCurrentProjectData();
    // Show all resources except the one we are currently inside
    const matches = (data.resources || []).filter(r => 
        String(r.id) !== String(resId) && r.name.toLowerCase().includes(q)
    );

    if (matches.length === 0) {
        resultsOverlay.innerHTML = `<div class="p-10 tiny muted">No matching resources found.</div>`;
        resultsOverlay.style.display = 'block';
        return;
    }

    resultsOverlay.innerHTML = matches.map(r => `
        <div class="search-result-item" onmousedown="event.preventDefault(); OL.setStepTargetResource('${resId}', '${stepId}', '${r.id}', '${esc(r.name)}')">
            🎯 ${esc(r.name)}
        </div>
    `).join('');
    
    resultsOverlay.style.display = 'block';
};

// 2. Set the Milestone Target
export async function setStepTargetResource(resId, stepId, targetId, targetName) {
    const res = OL.getResourceById(resId);
    const step = res?.steps?.find(s => String(s.id) === String(stepId));
    
    if (step) {
        step.targetResourceId = targetId;
        step.targetResourceName = targetName;
        await OL.persist();
        
        // Hide overlay and refresh inspector
        const overlay = document.getElementById('target-search-results');
        if (overlay) overlay.style.display = 'none';
        OL._fvRefreshInspector(resId, stepId);
    }
};

export function filterResourceSearch(resId, stepId, query) {
    const resultsOverlay = document.getElementById(`resource-results-${stepId}`);
    if (!resultsOverlay) return;
    const q = (query || "").toLowerCase().trim();
    if (!q) {
        resultsOverlay.style.display = 'none';
        return;
    }
    const client = getActiveClient();
    
    const allResources = [...(state.master.resources || []), ...(client?.projectData?.localResources || [])];
    const filteredRes = allResources.filter(r => r.id !== resId && r.name.toLowerCase().includes(q));
    const allHowTos = [...(state.master.howToLibrary || []), ...(client?.projectData?.localHowTo || [])];
    const filteredHowTos = allHowTos.filter(h => h.name.toLowerCase().includes(q));

    if (!filteredRes.length && !filteredHowTos.length) {
        resultsOverlay.innerHTML = `<div class="p-10 tiny muted">No matches found.</div>`;
        resultsOverlay.style.display = 'block';
        return;
    }

    let html = '';

    if (filteredRes.length) {
        html += `<div class="search-category-label">Project Assets</div>`;
        html += filteredRes.map(r => `
            <div class="search-result-item" style="display:flex; align-items:center; gap:8px;"
                 onmousedown="event.preventDefault(); OL.addLinkToStep('${resId}', '${stepId}', '${r.id}', '${esc(r.name)}', '${esc(r.type)}')">
                ${OL.getLucideSVG(OL.getRegistryIcon(r.type), 13, 'var(--accent)')}
                ${esc(r.name)}
            </div>`).join('');
    }

    if (filteredHowTos.length) {
        html += `<div class="search-category-label">How-To Guides</div>`;
        html += filteredHowTos.map(h => `
            <div class="search-result-item" style="display:flex; align-items:center; gap:8px;"
                 onmousedown="event.preventDefault(); OL.addLinkToStep('${resId}', '${stepId}', '${h.id}', '${esc(h.name)}', 'SOP')">
                ${OL.getLucideSVG('book-open', 13, 'var(--accent)')}
                ${esc(h.name)}
            </div>`).join('');
    }

    resultsOverlay.innerHTML = html;
    resultsOverlay.style.display = 'block';
};

export function toggleFilterMenu(e) {
    if (e) e.stopPropagation();
    const menu = document.getElementById('v2-filter-submenu');
    const btn = document.getElementById('filter-menu-btn');
    
    const isShowing = menu.style.display === 'flex';
    
    menu.style.display = isShowing ? 'none' : 'flex';
    btn.classList.toggle('active', !isShowing);
};

export function syncCanvasFilters() {
    const query = document.getElementById('canvas-filter-input')?.value.toLowerCase().trim() || "";
    const statusF = document.getElementById('filter-scoped')?.value || ""; 
    const typeF = document.getElementById('filter-type')?.value || "";
    const appF = document.getElementById('filter-app')?.value || "";
    const assigneeF = document.getElementById('filter-assignee')?.value || "";
    const dataTagF = document.getElementById('filter-data-tag')?.value || "";

    state.canvasMatches = [];
    const nodes = document.querySelectorAll('.v2-node-card');
    
    // 💡 Determine if we are actively filtering right now
    const isFiltering = !!(query || statusF || typeF || appF || assigneeF || dataTagF);

    nodes.forEach(node => {
        const resId = node.id.replace('v2-node-', '');
        const res = OL.getResourceById(resId);
        if (!res) return;

        // --- CRITERIA CHECKS ---
        const matchesQuery = !query || res.name.toLowerCase().includes(query);
        const matchesType = !typeF || res.type === typeF;
        const matchesApp = !appF || (res.steps || []).some(s => s.appName === appF);
        // Update this specific block inside OL.syncCanvasFilters

        const matchesAssignee = !assigneeF || (res.steps || []).some(s => {
            // 🛡️ THE SHIELD: If step is null or undefined, skip it safely
            if (!s) return false; 

            // 1. Check the new 'assignees' array (Multi-select)
            const inArray = Array.isArray(s.assignees) && s.assignees.some(a => {
                if (!a) return false;
                return (a.name || a) === assigneeF;
            });
            
            // 2. Check the legacy 'assigneeName' string (as a fallback)
            const isLegacyMatch = s.assigneeName === assigneeF;

            return inArray || isLegacyMatch;
        });
         

        // 🚀 STATUS CHECK (Scoped vs Unscoped)
        let matchesStatus = true;
        const isInScope = !!OL.isResourceInScope(resId);
        if (statusF === "scoped") matchesStatus = isInScope;
        if (statusF === "unscoped") matchesStatus = !isInScope;

        const matchesDataTag = !dataTagF || (res.steps || []).some(s => 
            (s.datapoints || []).some(d => d.id === dataTagF)
        );

        // --- FINAL DECISION ---
        const isMatch = matchesQuery && matchesType && matchesApp && matchesAssignee 
        && matchesStatus && matchesDataTag;

        if (isMatch) {
            node.classList.remove('node-dimmed', 'filter-hidden'); // Ensure it's visible
            node.classList.add('search-match');
            
            // Only add to navigation if it's on the canvas
            if (node.closest('#v2-node-layer')) {
                state.canvasMatches.push(node.id);
            }
        } else {
            node.classList.remove('search-match', 'search-active');
            // 🚀 If we are filtering, DIM the non-matches. If not, reset them.
            if (isFiltering) {
                node.classList.add('node-dimmed');
            } else {
                node.classList.remove('node-dimmed');
            }
        }
    });

    // --- UI COUNTER & NAV ---
    const nav = document.getElementById('search-nav-controls');
    const countLabel = document.getElementById('canvas-match-count');

    if (isFiltering && state.canvasMatches.length > 0) {
        nav.classList.add('is-visible');
        if (state.currentCanvasMatchIdx === -1) state.currentCanvasMatchIdx = 0;
        countLabel.innerText = `${state.currentCanvasMatchIdx + 1}/${state.canvasMatches.length}`;
    } else {
        nav.classList.remove('is-visible');
    }

    // Update lines (which now handle dimming internally)
    if (window.OL.drawConnections) OL.drawConnections();
};

export function centerNextCanvasMatch() {
    if (state.canvasMatches.length === 0) return;

    // Cycle through indices
    state.currentCanvasMatchIdx = (state.currentCanvasMatchIdx + 1) % state.canvasMatches.length;
    const targetId = state.canvasMatches[state.currentCanvasMatchIdx];
    
    document.getElementById('canvas-match-count').innerText = 
        `${state.currentCanvasMatchIdx + 1}/${state.canvasMatches.length}`;

    OL.centerCanvasNode(targetId);
};

export function centerPrevCanvasMatch() {
    if (!state.canvasMatches || state.canvasMatches.length === 0) return;

    state.currentCanvasMatchIdx--;
    if (state.currentCanvasMatchIdx < 0) {
        state.currentCanvasMatchIdx = state.canvasMatches.length - 1;
    }
    
    const targetId = state.canvasMatches[state.currentCanvasMatchIdx];
    
    // Update UI Counter
    const countLabel = document.getElementById('canvas-match-count');
    if (countLabel) {
        countLabel.innerText = `${state.currentCanvasMatchIdx + 1}/${state.canvasMatches.length}`;
    }

    OL.centerCanvasNode(targetId);
};

export function centerCanvasNode(nodeId) {
    let nodeEl = document.getElementById(nodeId) || document.getElementById(`v2-node-${nodeId}`);
    
    if (!nodeEl) {
        console.warn("❌ Centering failed: Could not find element with ID", nodeId);
        return;
    }
    // 1. 🔍 THE AUTO-OPEN CHECK
    // Check if the node is inside a tray/sidebar
    const workbench = document.getElementById('v2-workbench-sidebar');
    const shelf = document.getElementById('global-shelf');

    // 1. 🔍 THE AUTO-OPEN CHECK
    const viewport = document.getElementById('v2-viewport');

    // Workbench Check
    if (nodeEl.closest('#v2-workbench-sidebar')) {
        if (viewport.classList.contains('tray-closed')) {
            OL.toggleWorkbenchTray();
        }
    }

    // 🚀 ADDED: Global Shelf Check
    if (nodeEl.closest('#global-shelf')) {
        const shelf = document.getElementById('global-shelf');
        // If you have a specific class or style that hides the shelf, toggle it here
        // Example: if (shelf.style.display === 'none') shelf.style.display = 'block';
        
        // Smooth scroll to the item in the shelf list
        nodeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    // If it's in the workbench, make sure the workbench is open
    if (nodeEl.closest('#v2-workbench-sidebar')) {
        if (viewport.classList.contains('tray-closed')) {
            console.log("📂 Auto-opening Workbench for search match...");
            OL.toggleWorkbenchTray(); // Use your existing toggle function
        }
    }
    
    // 2. 🎯 SNAP TO CENTER (Only if it's on the Canvas)
    if (nodeEl.closest('#v2-node-layer')) {
        const nodeX = parseFloat(nodeEl.style.left) || 0;
        const nodeY = parseFloat(nodeEl.style.top) || 0;
        const viewW = viewport ? viewport.offsetWidth : window.innerWidth;
        const viewH = viewport ? viewport.offsetHeight : window.innerHeight;

        const moveX = (viewW / 2) - (nodeX + (nodeEl.offsetWidth / 2));
        const moveY = (viewH / 2) - (nodeY + (nodeEl.offsetHeight / 2));

        const layer = document.getElementById('v2-node-layer');
        if (layer) {
            layer.style.transition = "transform 0.5s cubic-bezier(0.2, 0.8, 0.2, 1)";
            layer.style.transform = `translate(${moveX}px, ${moveY}px)`;
        }
    } else {
        // 💫 If it's in a sidebar, just wiggle/highlight it since we can't "center" it
        nodeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    // 3. ✨ VISUAL FOCUS
    document.querySelectorAll('.v2-node-card').forEach(n => n.classList.remove('search-focus'));
    nodeEl.classList.add('search-focus');
};

export function refreshFilterDropdowns() {
    const client = getActiveClient();
    const apps = client?.projectData?.localApps || [];
    const team = [
        ...(state.master.teamMembers || []), 
        ...(client?.projectData?.teamMembers || []),
        { name: 'Client 1' }, { name: 'Client 2' } // Include your Ghost Roles
    ];

    const appSelect = document.getElementById('filter-app');
    const assigneeSelect = document.getElementById('filter-assignee');

    if (appSelect) {
        appSelect.innerHTML = `<option value="">All Apps</option>` + 
            apps.map(a => `<option value="${esc(a.name)}">${esc(a.name)}</option>`).join('');
    }

    if (assigneeSelect) {
        assigneeSelect.innerHTML = `<option value="">All Owners</option>` + 
            team.map(t => `<option value="${esc(t.name)}">${esc(t.name)}</option>`).join('');
    }
};

export function clearAllFilters() {
    // 1. 📝 CLEAR THE INPUTS
    const searchInput = document.getElementById('canvas-filter-input');
    if (searchInput) searchInput.value = "";
    
    const selects = document.querySelectorAll('#v2-filter-submenu select');
    selects.forEach(select => { select.selectedIndex = 0; });

    // 2. 🚀 REMOVE ALL CSS CLASSES
    const allNodes = document.querySelectorAll('.v2-node-card');
    allNodes.forEach(node => {
        node.classList.remove('search-match', 'search-active', 'filter-hidden', 'node-dimmed', 'search-focus');
    });

    // 3. 🗺️ RESET NAVIGATION & UI
    state.canvasMatches = [];
    state.currentCanvasMatchIdx = -1;
    
    // Reset the "1/5" counter text
    const countLabel = document.getElementById('canvas-match-count');
    if (countLabel) countLabel.innerText = "0/0";

    // Hide the navigation row
    const nav = document.getElementById('search-nav-controls');
    if (nav) nav.classList.remove('is-visible');

    // Reset the "active filter" count pill on the main button
    const countPill = document.getElementById('active-filter-count');
    if (countPill) {
        countPill.innerText = "0";
        countPill.style.display = 'none';
    }

    // Close the submenu if open
    const filterMenu = document.getElementById('v2-filter-submenu');
    if (filterMenu) filterMenu.style.display = 'none';
    const filterBtn = document.getElementById('filter-menu-btn');
    if (filterBtn) filterBtn.classList.remove('active');

    // 4. 🔗 RESTORE CONNECTIONS
    document.querySelectorAll('#v2-connections path').forEach(path => {
        path.style.opacity = "0.7";
    });

    // 5. 🔄 FINAL SYNC
    OL.syncCanvasFilters(); 
    console.log("✨ Canvas and Search Bar fully reset.");

    // 6. 🚀 RESET SCROLL & VIEWPORT POSITION
    const nodeLayer = document.getElementById('v2-node-layer');
    const stageLayer = document.getElementById('v2-stage-layer');
    const lineGroup = document.getElementById('line-group');

    if (nodeLayer) {
        nodeLayer.classList.remove('canvas-dimmed');
        // Reset the CSS translation (centering) applied during search
        nodeLayer.style.transform = "translate(0, 0)"; 
        nodeLayer.style.transition = "transform 0.3s ease"; // Smooth snap back
    }

    if (stageLayer) {
        stageLayer.style.transform = "translate(0, 0)";
        stageLayer.style.transition = "transform 0.3s ease";
    }

    // 🔗 Restore all connection lines to full visibility
    if (lineGroup) {
        const paths = lineGroup.querySelectorAll('path');
        paths.forEach(p => {
            p.style.opacity = "0.7"; // Your default opacity
            p.style.strokeWidth = "2px";
        });
    }

    // Reset the "active trace" logic so highlight flows disappear
    state.v2.activeTrace = null;
    state.v2.highlightedIds = [];

    // Trigger one final redraw of the visualizer to snap everything into place
    OL.renderVisualizer();
};

export async function addLinkToStep(resId, stepId, linkId, linkName, type) {
    const res = OL.getResourceById(resId);
    if (!res) return;
    const step = (res.steps || []).find(s => String(s.id) === String(stepId));
    if (!step) return;

    if (step.links?.some(l => l.id === linkId)) return; // already linked

    const relType = await OL.promptLinkType(linkName);
    if (!relType) return; // user cancelled

    if (!step.links) step.links = [];
    step.links.push({ id: linkId, name: linkName, type, relType });

    await OL.persist();

    const overlay = document.getElementById(`resource-results-${stepId}`);
    if (overlay) overlay.style.display = 'none';

    OL._fvRefreshInspector(resId, stepId);
};

export function promptLinkType(name) {
    return new Promise(resolve => {
        const id = 'link-type-picker-' + Date.now();
        const html = `
            <div class="modal-head">
                <div class="modal-title-text">How is "${esc(name)}" used?</div>
            </div>
            <div class="modal-body">
                <div style="display:flex; flex-direction:column; gap:8px;">
                    ${[
                        { key: 'triggers',  icon: 'zap',           label: 'Triggers',  desc: 'This step fires or sends this asset',        color: '#f59e0b' },
                        { key: 'requires',  icon: 'arrow-down-to-line', label: 'Requires',  desc: 'This step needs this asset to run',          color: '#38bdf8' },
                        { key: 'produces',  icon: 'arrow-up-from-line', label: 'Produces',  desc: 'This step creates or outputs this asset',    color: '#10b981' },
                        { key: 'references',icon: 'link-2',        label: 'References', desc: 'This step refers to or reads from this asset', color: '#a78bfa' },
                    ].map(t => `
                        <div onclick="window._resolveLinkType('${t.key}')"
                             style="display:flex; align-items:center; gap:12px; padding:12px;
                                    border:1px solid var(--line); border-radius:8px; cursor:pointer;
                                    transition:all 0.15s;"
                             onmouseover="this.style.borderColor='${t.color}'; this.style.background='${t.color}18';"
                             onmouseout="this.style.borderColor='var(--line)'; this.style.background='transparent';">
                            <div style="width:32px; height:32px; border-radius:6px; flex-shrink:0;
                                        background:${t.color}18; border:1px solid ${t.color}44;
                                        display:flex; align-items:center; justify-content:center;">
                                <i data-lucide="${t.icon}" style="width:16px; height:16px; color:${t.color};"></i>
                            </div>
                            <div>
                                <div style="font-weight:600; font-size:13px;">${t.label}</div>
                                <div class="tiny muted">${t.desc}</div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
        window._resolveLinkType = (val) => {
            delete window._resolveLinkType;
            OL.closeModal();
            resolve(val);
        };
        openModal(html);
        if (window.lucide) lucide.createIcons();
    });
};

export async function removeStepLink(resId, stepId, linkIdx) {
    const res = OL.getResourceById(resId);
    if (!res) return;

    // Find the specific step
    const step = (res.steps || []).find(s => String(s.id) === String(stepId));
    
    if (step && step.links) {
        // Remove the item at the specific index
        step.links.splice(linkIdx, 1);
        
        // Save state
        await OL.persist();
        
        // 🔄 Immediate UI Refresh
        console.log("🗑️ Attachment removed from step:", stepId);
        OL._fvRefreshInspector(resId, stepId);
    }
};

export function renderLogicBlock(resId, stepId, dir, i, logic, allOptions) {
    const myFullId = `${resId}-${stepId}`; 
    const targetId = dir === 'out' ? (logic.targetId || "") : (logic.sourceId || "");
    const isReadOnly = dir === 'in';
    
    let displayLabel = '-- Select Step --';

    if (targetId) {
        if (targetId === myFullId) {
            displayLabel = '[Current Step / Loopback]';
        } else {
            // 🚀 THE FIX: Robust Parsing for IDs with multiple hyphens
            // This finds the LAST hyphen to separate Resource ID from Step ID
            const lastHyphenIdx = String(targetId).lastIndexOf('-');
            const tResId = targetId.substring(0, lastHyphenIdx);
            const tStepId = targetId.substring(lastHyphenIdx + 1);
            
            const data = OL.getCurrentProjectData();
            const targetRes = data.resources.find(r => String(r.id) === String(tResId));
            
            if (targetRes) {
                // Find by unique ID string
                const targetStep = (targetRes.steps || []).find(s => String(s.id) === String(tStepId));
                
                // Fallback: If it's old index-based data
                const finalStep = targetStep || targetRes.steps[parseInt(tStepId)];
                
                const locationPrefix = targetRes.isTopShelf ? '🏛️ ' : (targetRes.isGlobal ? '🛠️ ' : '📍 ');
                displayLabel = `${locationPrefix}${targetRes.name} > ${finalStep?.name || 'Unnamed Step'}`;
            } else {
                displayLabel = '⚠️ Missing Resource';
            }
        }
    }

    const isLoop = (logic.type === 'loop') || (String(targetId) === String(myFullId));
    const isNextStep = logic.type === 'next';
    const isDelay = logic.type === 'delay';

    return `
        <div class="logic-item ${isReadOnly ? 'is-readonly' : ''}" 
             style="border-left: 3px solid ${isLoop ? 'var(--warning)' : (dir === 'out' ? 'var(--accent)' : '#4a90e2')}; 
                    padding: 12px; margin-bottom: 10px; position: relative; background: rgba(255,255,255,0.03); border-radius: 6px;">
            
            <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:6px; gap: 8px;">
                <div style="flex-grow: 1;">
                    <div class="section-label tiny" style="margin-bottom: 4px; color: ${isReadOnly ? 'var(--text-muted)' : 'var(--text-main)'}; font-weight: bold; letter-spacing: 0.5px;">
                        ${dir === 'out' ? '📤 OUTGOING OUTPUT' : '📥 INCOMING INPUT'} ${isReadOnly ? '🔒' : ''}
                    </div>

                    ${dir === 'out' ? `
                        <select class="modal-input tiny" style="margin:0; height:24px;" onchange="OL.updateStepLogic('${resId}', '${stepId}', '${dir}', ${i}, 'type', this.value)">
                            <option value="next" ${isNextStep ? 'selected' : ''}>➔ Next Step</option>
                            <option value="link" ${!isLoop ? 'selected' : ''}>Standard Link</option>
                            <option value="loop" ${isLoop ? 'selected' : ''}>🔄 Loop/Repeat</option>
                            <option value="delay" ${isDelay ? 'selected' : ''}>⏱︎ Wait For</option>
                        </select>
                    ` : ''}
                </div>

                ${!isReadOnly ? `
                    <button class="logic-delete-btn" onclick="OL.removeStepLogic('${resId}', '${stepId}', '${dir}', ${i})" title="Remove Rule">×</button>
                ` : ''}
            </div>

            <div style="background: rgba(0,0,0,0.2); padding: 6px 8px; border-radius: 4px; margin-bottom: 8px; display: flex; align-items: center; justify-content: space-between; border: 1px solid var(--line);">
                <span style="font-size: 10px; color: var(--text-main);">${esc(displayLabel)}</span>
                ${targetId ? `<button class="logic-jump-btn" onclick="OL.centerCanvasNode('${String(targetId).split('-')[0]}')" title="Jump to Card">🎯</button>` : ''}
            </div>

            <input class="modal-input tiny" value="${esc(logic.rule || '')}" 
                   ${isReadOnly ? 'readonly' : ''}
                   placeholder="${isReadOnly ? 'No condition' : 'Condition (e.g. If Approved)'}" 
                   style="width: 100%; margin-bottom: 8px; ${isReadOnly ? 'border-color: transparent; background: transparent; pointer-events: none; opacity: 0.6;' : ''}"
                   onblur="OL.updateStepLogic('${resId}', '${stepId}', '${dir}', ${i}, 'rule', this.value)">
            
            ${!isReadOnly ? `
                <div class="search-map-container" style="position:relative;">
                    <input type="text" class="modal-input tiny" 
                           placeholder="🔍 Search target resource/step..." 
                           onfocus="OL.filterLogicTargetSearch('${resId}', '${stepId}', '${dir}', ${i}, '')"
                           oninput="OL.filterLogicTargetSearch('${resId}', '${stepId}', '${dir}', ${i}, this.value)">
                    <div id="logic-search-results-${resId}-${stepId}-${i}" class="search-results-overlay" style="max-height: 200px; overflow-y: auto;"></div>
                </div>
            ` : ''}

            ${isLoop && dir === 'out' ? `
                <div style="margin-top:10px; padding-top: 8px; border-top: 1px dashed rgba(255,255,255,0.1);">
                    <div class="section-label" style="font-size:8px; color: var(--warning);">LOOP LIMIT / EXIT CRITERIA</div>
                    <input class="modal-input tiny" value="${esc(logic.loopLimit || '')}" 
                           placeholder="e.g. 3 times..." 
                           style="border-style:dashed; color: var(--warning); border-color: var(--warning);"
                           onblur="OL.updateStepLogic('${resId}', '${stepId}', '${dir}', ${i}, 'loopLimit', this.value)">
                </div>
            ` : ''}
        </div>
    `;
};

export function filterLogicTargetSearch(resId, stepId, dir, logicIdx, query) {
    const listEl = document.getElementById(`logic-search-results-${resId}-${stepId}-${logicIdx}`);
    if (!listEl) return;

    const q = (query || "").toLowerCase().trim();
    const data = OL.getCurrentProjectData();
    const resources = data.resources || [];
    const myFullId = `${resId}-${stepId}`;

    // 1. Get all resources that actually have steps defined
    const activeResources = resources.filter(res => (res.steps || []).length > 0);

    let html = "";

    activeResources.forEach(res => {
        // Identify physical location
        const familyPrefix = res.isTopShelf ? '🏛️ [SHELF] ' : (res.isGlobal ? '🛠️ [WORKBENCH] ' : '📍 [CANVAS] ');
        
        // Filter steps within this resource
        const matchedSteps = res.steps.filter((s, idx) => {
            return res.name.toLowerCase().includes(q) || (s.name || "").toLowerCase().includes(q);
        });

        if (matchedSteps.length > 0) {
            html += `<div class="search-category-label" style="background: rgba(var(--accent-rgb), 0.1); color: var(--accent); padding: 4px 8px; font-size: 10px; margin-top: 5px; border-radius: 4px; font-weight:bold;">${familyPrefix}${esc(res.name)}</div>`;

            matchedSteps.forEach((s) => {
                // Construct the ID: [ResourceID]-[StepID]
                const targetFullId = `${res.id}-${s.id}`; 
                const stepName = s.name || `Unnamed Step`;
                const isSelf = targetFullId === myFullId;

                html += `
                    <div class="search-result-item" 
                        style="padding-left: 20px; font-size: 11px; display: flex; justify-content: space-between; align-items:center;"
                        onmousedown="event.preventDefault(); OL.updateStepTarget('${resId}', '${stepId}', '${dir}', ${logicIdx}, '${targetFullId}')">
                        <span>• ${esc(stepName)}</span>
                        ${isSelf ? '<span style="font-size:8px; background:var(--warning); color:black; padding:1px 4px; border-radius:3px;">LOOP</span>' : ''}
                    </div>
                `;
            });
        }
    });

    listEl.innerHTML = html || '<div class="search-result-item muted">No matches found.</div>';
    listEl.style.display = 'block';

    // Auto-close overlay when clicking elsewhere
    const closeListener = (e) => {
        if (!listEl.contains(e.target) && e.target.tagName !== 'INPUT') {
            listEl.style.display = 'none';
            document.removeEventListener('mousedown', closeListener);
        }
    };
    document.addEventListener('mousedown', closeListener);
};

export function getAllStepOptions() {
    const data = OL.getCurrentProjectData();
    const resources = data.resources || [];
    const stages = data.stages || [];
    let options = [];

    // 1. Filter out Resources that have 0 steps first
    const activeResources = resources.filter(res => res.steps && res.steps.length > 0);

    stages.forEach(stage => {
        // 2. Find only resources that belong to this stage AND have steps
        const stageResources = activeResources.filter(r => r.stageId === stage.id);
        
        // 🚀 THE FIX: If this stage has no resources with steps, skip the stage header entirely
        if (stageResources.length === 0) return;

        // 📂 Add the STAGE header
        options.push({ id: 'header', label: `📂 ${stage.name.toUpperCase()}`, isHeader: true });

        stageResources.forEach(res => {
            const family = activeResources.filter(r => r.originId === res.originId);
            const partNum = family.length > 1 ? ` (${family.findIndex(r => r.id === res.id) + 1}/${family.length})` : '';
            
            // 📦 Add the RESOURCE (Indented level 1)
            options.push({ id: 'header', label: `\u00A0\u00A0📦 ${res.name}${partNum}`, isHeader: true });

            // ⚡ Add the STEPS (Indented level 2)
            res.steps.forEach((step, idx) => {
                options.push({
                    id: `${res.id}-${idx}`,
                    label: `\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0• ${step.name || 'Step ' + (idx + 1)}`
                });
            });
        });
    });

    return options;
};

// ➕ Add Logic to a Step
export function addStepLogic(resId, stepId, direction) {
    const data = OL.getCurrentProjectData();
    const res = data.resources.find(r => String(r.id) === String(resId));
    if (!res) return;

    const step = res.steps.find(s => String(s.id) === String(stepId));
    if (!step) return;

    // 1. Initialize logic if it doesn't exist
    if (!step.logic) step.logic = { in: [], out: [] };
    
    // 2. Push a clean new logic object
    step.logic[direction].push({
        condition: "If...",
        targetId: null,
        action: "Go to Step"
    });

    // 3. CRITICAL: Persist the change and then re-open the inspector to show it
    OL.persist().then(() => {
        OL.openInspector(resId, stepId, 'steps');
        console.log(`✅ Logic added to ${direction} for step ${stepId}`);
    });
};

// 💾 Update Logic Value (Rule or Target)
export async function updateStepLogic(resId, stepTarget, direction, logicIdx, field, value) {
    const data = OL.getCurrentProjectData();
    const res = data.resources.find(r => String(r.id) === String(resId));
    
    // 🎯 FIX: ID-Aware lookup
    let step = res?.steps.find(s => String(s.id) === String(stepTarget));
    if (!step && isFinite(stepTarget)) step = res?.steps[stepTarget];
    
    if (step && step.logic?.[direction]?.[parseInt(logicIdx)]) {
        step.logic[direction][parseInt(logicIdx)][field] = value;

        OL.syncLogicPorts();
        await OL.persist(); 
        
        // Use requestAnimationFrame for smooth line updates
        requestAnimationFrame(() => {
            if (typeof OL.drawConnections === 'function') OL.drawConnections();
        });
    }
};

export async function removeStepLogic(resId, stepTarget, direction, logicIdx) {
    const data = OL.getCurrentProjectData();
    const resources = data.resources || [];
    const res = resources.find(r => String(r.id) === String(resId));
    
    // 🎯 ID-Aware lookup
    let step = res?.steps.find(s => String(s.id) === String(stepTarget));
    if (!step && isFinite(stepTarget)) step = res?.steps[stepTarget];

    if (!step || !step.logic) return;

    // 1. 🔍 IDENTIFY THE PARTNER before deleting
    const itemToRemove = step.logic[direction][logicIdx];
    const myFullId = `${resId}-${step.id}`;
    
    // If we're deleting an Output, the partner is the TargetId. 
    // If we're deleting an Input, the partner is the SourceId.
    const partnerFullId = direction === 'out' ? itemToRemove.targetId : itemToRemove.sourceId;

    if (partnerFullId) {
        const lastHyphen = String(partnerFullId).lastIndexOf('-');
        const pResId = partnerFullId.substring(0, lastHyphen);
        const pStepId = partnerFullId.substring(lastHyphen + 1);
        
        const partnerRes = resources.find(r => String(r.id) === String(pResId));
        const partnerStep = partnerRes?.steps.find(s => String(s.id) === String(pStepId));

        if (partnerStep && partnerStep.logic) {
            // 🧹 Clean the mirror side
            if (direction === 'out') {
                // We are 'Out', so remove the 'In' from the target
                partnerStep.logic.in = (partnerStep.logic.in || []).filter(l => l.sourceId !== myFullId);
            } else {
                // We are 'In', so remove the 'Out' from the source
                partnerStep.logic.out = (partnerStep.logic.out || []).filter(l => l.targetId !== myFullId);
            }
        }
    }

    // 2. 🔥 DELETE THE LOCAL RULE
    step.logic[direction].splice(logicIdx, 1);
    
    // 3. 💾 PERSIST & REFRESH
    await OL.persist(); 
    
    // Draw connections to clear the lines from the map
    if (typeof OL.drawConnections === 'function') OL.drawConnections();
    
    // Refresh the inspector to show the rule is gone
    OL.openInspector(resId, step.id); 
    console.log(`🧹 Ghost link removed from ${partnerFullId}`);
};

export async function updateStepTarget(resId, stepId, direction, logicIdx, newPartnerFullId) {
    const data = OL.getCurrentProjectData();
    const res = data.resources.find(r => String(r.id) === String(resId));
    if (!res) return;

    // 🎯 1. FIND THE STEP BY ID (Not Index)
    // This ensures we are saving to the correct step even if the list order changed
    const step = res.steps.find(s => String(s.id) === String(stepId));
    if (!step || !step.logic) {
        console.error("❌ Step logic block not found for stepId:", stepId);
        return;
    }

    const item = step.logic[direction][parseInt(logicIdx)];
    const myFullId = `${res.id}-${stepId}`;

    console.log(`🔗 Saving Logic: [${direction}] at index ${logicIdx} set to target ${newPartnerFullId}`);

    if (direction === 'out') {
        item.targetId = String(newPartnerFullId);
        // Automatic Loop Detection
        item.type = (newPartnerFullId === myFullId) ? 'loop' : 'link';
    } else {
        item.sourceId = String(newPartnerFullId);
    }

    // 💾 2. PERSIST
    OL.syncLogicPorts(); 
    await OL.persist();
    
    // 🧹 3. UI CLEANUP
    // Close the specific search overlay
    const overlay = document.getElementById(`logic-search-results-${resId}-${stepId}-${logicIdx}`);
    if (overlay) overlay.style.display = 'none';

    // 🔄 4. REFRESH
    // Pass the unique stepId back to the inspector
    OL.openInspector(resId, stepId, 'steps');
    
    if (window.location.hash.includes('visualizer')) {
        OL.drawConnections();
    }
};

export function syncLogicPorts() {
    const data = OL.getCurrentProjectData();
    const resources = data.resources || [];

    // 1. Wipe all 'In' arrays to rebuild from 'Out' rules
    resources.forEach(res => {
        (res.steps || []).forEach(step => {
            if (step.logic) step.logic.in = []; 
        });
    });

    // 2. Rebuild 'In' links based on 'Out' rules
    resources.forEach(sourceRes => {
        sourceRes.steps?.forEach((step) => {
            if (!step.logic?.out) return;

            // Filter out rules that might have become invalid
            step.logic.out = step.logic.out.filter(outRule => {
                if (!outRule.targetId) return true; // Keep empty rules for editing

                // 🚀 ROBUST PARSING (Matches renderLogicBlock)
                const lastHyphenIdx = String(outRule.targetId).lastIndexOf('-');
                if (lastHyphenIdx === -1) return false; // Invalid format

                const tResId = outRule.targetId.substring(0, lastHyphenIdx);
                const tStepId = outRule.targetId.substring(lastHyphenIdx + 1);
                
                const targetRes = resources.find(r => String(r.id) === String(tResId));
                if (!targetRes) return false; // Resource deleted? Drop the link.

                // Find step by ID or Index
                const targetStep = (targetRes.steps || []).find(s => String(s.id) === String(tStepId)) 
                                   || targetRes.steps[parseInt(tStepId)];

                if (targetStep) {
                    // It exists! Create the mirrored 'In' rule
                    if (!targetStep.logic) targetStep.logic = { in: [], out: [] };
                    targetStep.logic.in.push({
                        sourceId: `${sourceRes.id}-${step.id}`,
                        rule: outRule.rule || "",
                        type: outRule.type || "link"
                    });
                    return true;
                }
                
                return false; // Step deleted? Drop the link.
            });
        });
    });
};

export function updateStepLink(resId, stepIdx, direction, logicIdx, newTargetId) {
    const data = OL.getCurrentProjectData();
    const resources = data.resources || [];

    const res = resources.find(r => String(r.id) === String(resId));
    const step = res?.steps?.[stepIdx];
    if (!step || !step.logic) return;

    const oldLogic = step.logic[direction][logicIdx];
    const oldTargetId = direction === 'out' ? oldLogic.targetId : oldLogic.sourceId;

    // 1. Clean up the "Old" partner
    if (oldTargetId) {
        this.clearMirrorLink(`${resId}-${stepIdx}`, oldTargetId);
    }

    // 2. Set the "New" link
    if (direction === 'out') {
        oldLogic.targetId = newTargetId;
    } else {
        oldLogic.sourceId = newTargetId;
    }

    // 3. Create the "New" mirror
    if (newTargetId) {
        this.createMirrorLink(`${resId}-${stepIdx}`, newTargetId, direction, oldLogic.rule);
    }

    OL.save();
    this.drawConnections();
    this.openInspector(resId, stepIdx); 
};

export function createMirrorLink(myFullId, partnerFullId, myDirection, myRule) {
    if (myFullId === partnerFullId) return; 

    const data = OL.getCurrentProjectData();
    const resources = data.resources || [];

    const [pResId, pStepIdx] = partnerFullId.split('-');
    const partnerRes = resources.find(r => String(r.id) === String(pResId));
    const partnerStep = partnerRes?.steps?.[parseInt(pStepIdx)];
    
    if (!partnerStep) return;
    if (!partnerStep.logic) partnerStep.logic = { in: [], out: [] };

    const pDir = myDirection === 'out' ? 'in' : 'out';
    const key = pDir === 'in' ? 'sourceId' : 'targetId';

    // Add mirror link if it doesn't exist
    if (!partnerStep.logic[pDir].some(l => l[key] === myFullId)) {
        partnerStep.logic[pDir].push({ [key]: myFullId, rule: myRule, type: 'link' });
    }
};

export function clearMirrorLink(myFullId, partnerFullId) {
    if (myFullId === partnerFullId) return; 

    const data = OL.getCurrentProjectData();
    const resources = data.resources || [];

    const [pResId, pStepIdx] = partnerFullId.split('-');
    const pRes = resources.find(r => String(r.id) === String(pResId));
    const pStep = pRes?.steps?.[parseInt(pStepIdx)];

    if (pStep && pStep.logic) {
        pStep.logic.in = pStep.logic.in.filter(l => l.sourceId !== myFullId);
        pStep.logic.out = pStep.logic.out.filter(l => l.targetId !== myFullId);
    }
};

// Helper to find the X/Y of a card's edge
export function getCardConnectionPoint(resId, stepId, side) {
    const nodeEl = document.getElementById(`v2-node-${resId}`);
    const svgEl = document.getElementById('v2-connections');
    if (!nodeEl || !svgEl) return { x: 0, y: 0 };

    const stepFullId = String(stepId).includes(resId) ? stepId : `${resId}-${stepId}`;
    
    // 1. Identify specific port
    const isIntake = (side === 'left' || side === 'top');
    const portId = isIntake ? `port-in-${stepFullId}` : `port-out-${stepFullId}`;
    
    // 🔍 Try Icon -> then Step Row -> then Card Node
    let targetEl = document.getElementById(portId) || 
                   document.querySelector(`[data-step-id="${stepFullId}"]`) || 
                   nodeEl;

    const isIcon = targetEl.classList.contains('step-logic-icon');
    const isStaticShelf = !!targetEl.closest('#global-shelf');
    
    // 2. Get Geometry
    const rect = targetEl.getBoundingClientRect();
    const svgRect = svgEl.getBoundingClientRect();
    const zoom = isStaticShelf ? 1 : (OL.state.v2.zoom || 1);

    // 📐 THE PRECISION MATH
    // Calculate Y: Always the vertical center of the element
    const y = (rect.top - svgRect.top + (rect.height / 2)) / zoom;
    
    // Calculate X: 
    let x;
    if (isIcon) {
        // If it's the λ icon, we DO want the center of that tiny circle
        x = (rect.left - svgRect.left + (rect.width / 2)) / zoom;
    } else {
        // 🎯 THE FIX: If we fell back to the Row or Card, use the EXTERIOR EDGES
        if (side === 'left' || side === 'top') {
            x = (rect.left - svgRect.left) / zoom; // Flush Left
        } else {
            x = (rect.right - svgRect.left) / zoom; // Flush Right
        }
    }

    return { x, y };
};

export function drawConnections() {
    const svg = document.getElementById('v2-connections');
    const lineGroup = document.getElementById('line-group');
    const shelfLineGroup = document.getElementById('shelf-line-group');
    const shelfEl = document.getElementById('global-shelf');
    if (!svg || !lineGroup) return;

    // 🧹 1. RESET
    lineGroup.innerHTML = ''; 
    if (shelfLineGroup) shelfLineGroup.innerHTML = '';

    // 🕵️ 2. DATA LOAD
    const data = OL.getCurrentProjectData();
    const resources = data?.resources || []; 
    const trace = state.v2?.activeTrace;
    const highlightedIds = (state.v2?.highlightedIds || []).map(id => String(id));
    const zoom = state.v2.zoom || 1;

    if (trace && !trace.resId && !trace.mode) return;

    // 🔄 3. MAIN LOOP
    resources.forEach(sourceRes => {
        if (!sourceRes || !sourceRes.steps) return;
        const sourceResId = String(sourceRes.id); 
        const sourceEl = document.getElementById(`v2-node-${sourceResId}`);
        if (sourceEl && sourceEl.classList.contains('filter-hidden')) return;

        sourceRes.steps.forEach((step) => {
            if (!step.logic?.out) return;

            step.logic.out.forEach(outLogic => {
                if (!outLogic?.targetId) return;

                // 🚀 ROBUST PARSER (Correctly handles multiple hyphens)
                const targetFullId = String(outLogic.targetId);
                const lastHyphen = targetFullId.lastIndexOf('-');
                if (lastHyphen === -1) return; // Malformed ID

                const targetResId = targetFullId.substring(0, lastHyphen);
                const targetStepId = targetFullId.substring(lastHyphen + 1);

                let shouldDraw = false;

                // --- 🚦 TRACE RULES ---
                const hasTrace = !!(trace && trace.mode && trace.resId);

                if (hasTrace) {
                    const mode = trace.mode;
                    const focusId = String(trace.resId);

                    // 📥 INPUTS: Draw if the target is our focused card
                    if (mode === 'in' && targetResId === focusId) {
                        shouldDraw = true;
                    }
                    // 📤 OUTPUTS: Draw if the source is our focused card
                    else if (mode === 'out' && sourceResId === focusId) {
                        shouldDraw = true;
                    }
                    // ↔️ BOTH: Draw if either side matches
                    else if (mode === 'both' && (sourceResId === focusId || targetResId === focusId)) {
                        shouldDraw = true;
                    }
                    // ⏪⏩ RECURSIVE FLOWS: Draw if both IDs are in the pre-calculated highlight list
                    else if ((mode === 'trace-start' || mode === 'trace-end') && 
                            highlightedIds.includes(sourceResId) && 
                            highlightedIds.includes(targetResId)) {
                        shouldDraw = true;
                    }
                } else {
                    // Keep it clean if no trace is active
                    shouldDraw = false;
                }

                if (shouldDraw) {
                    const targetRes = resources.find(r => String(r.id) === targetResId);
                    const targetEl = document.getElementById(`v2-node-${targetResId}`);
                    
                    if (!targetRes || (targetEl && targetEl.classList.contains('filter-hidden'))) return;

                    let start, end, sSide, tSide;

                    // 📐 4. PORT LOGIC
                    const isSourceTrulyGlobal = (!!sourceRes.isGlobal || !!sourceRes.isTopShelf) && !sourceRes.coords;
                    const isTargetTrulyGlobal = (!!targetRes.isGlobal || !!targetRes.isTopShelf) && !targetRes.coords;

                    if (isSourceTrulyGlobal && !isTargetTrulyGlobal) {
                        tSide = 'top';
                        end = OL.getCardConnectionPoint(targetRes.id, targetStepId, tSide);
                        const sRect = sourceEl.getBoundingClientRect();
                        const svgRect = svg.getBoundingClientRect();
                        const visualMidX = sRect.left + (sRect.width / 2);
                        start = { x: (visualMidX - svgRect.left) / zoom, y: 0 };
                    } 
                    else if (!isSourceTrulyGlobal && isTargetTrulyGlobal) {
                        sSide = 'top';
                        start = OL.getCardConnectionPoint(sourceRes.id, step.id, sSide);
                        const tRect = targetEl.getBoundingClientRect();
                        const svgRect = svg.getBoundingClientRect();
                        const visualMidX = tRect.left + (tRect.width / 2);
                        end = { x: (visualMidX - svgRect.left) / zoom, y: 0 };
                    } 
                    else if (targetRes.coords && sourceRes.coords) {
                        const dx = targetRes.coords.x - sourceRes.coords.x;
                        const isVertical = Math.abs(dx) < 150; 
                        sSide = isVertical ? 'right' : (dx > 0 ? 'right' : 'left');
                        tSide = isVertical ? 'right' : (dx > 0 ? 'left' : 'right');

                        start = OL.getCardConnectionPoint(sourceRes.id, step.id, sSide);
                        end = OL.getCardConnectionPoint(targetResId, targetStepId, tSide);
                    }

                    // 🎢 5. DRAW PATH
                    if (start && end) {
                        let targetX = end.x, targetY = end.y;
                        const gap = 15; 
                        if (tSide === 'left') targetX -= gap;
                        if (tSide === 'right') targetX += gap;
                        if (tSide === 'top') targetY -= gap;
                        if (tSide === 'bottom') targetY += gap;

                        let d;
                        const absDx = Math.abs(targetX - start.x);
                        const absDy = Math.abs(targetY - start.y);

                        if (isSourceTrulyGlobal || isTargetTrulyGlobal) {
                            // Shelf curves: Horizontal start, vertical drop
                            const midY = (start.y + targetY) / 2;
                            d = `M ${start.x} ${start.y} C ${start.x} ${midY}, ${targetX} ${midY}, ${targetX} ${targetY}`;
                        } 
                        else if (sSide === tSide) {
                            // Same-side "C" curve (e.g. Loop)
                            const sweep = Math.min(100, absDy * 0.4 + 40); 
                            const direction = (sSide === 'right') ? 1 : -1;
                            d = `M ${start.x} ${start.y} C ${start.x + (sweep * direction)} ${start.y}, ${targetX + (sweep * direction)} ${targetY}, ${targetX} ${targetY}`;
                        } 
                        else {
                            // 🌊 Standard S-Curve (The one in your screenshot)
                            // 🎯 THE FIX: Force CP1.y to match start.y and CP2.y to match targetY
                            // This makes the line "plug in" horizontally to the icon.
                            const tension = Math.max(50, Math.min(absDx * 0.7, 180));
                            
                            const cp1x = start.x + (sSide === 'right' ? tension : -tension);
                            const cp2x = targetX + (tSide === 'right' ? tension : -tension);
                            
                            // We use start.y for CP1 and targetY for CP2 to prevent the "diagonal dive"
                            d = `M ${start.x} ${start.y} 
                                C ${cp1x} ${start.y}, 
                                  ${cp2x} ${targetY}, 
                                  ${targetX} ${targetY}`;
                        }
                        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                        path.setAttribute('d', d);
                        path.setAttribute('fill', 'none');
                        path.setAttribute('marker-end', 'url(#arrowhead)');
                        
                        const isGlobalLink = isSourceTrulyGlobal || isTargetTrulyGlobal;
                        path.setAttribute('stroke', isGlobalLink ? 'var(--text-dim)' : (outLogic.type === 'loop' ? 'var(--warning)' : 'var(--accent)'));
                        if (isGlobalLink) path.setAttribute('stroke-dasharray', '5,5');
                        
                        lineGroup.appendChild(path);

                        if (outLogic.rule?.trim()) {
                            try {
                                // 📏 Calculate the actual midpoint of the curved path
                                const pathLength = path.getTotalLength();
                                const midPoint = path.getPointAtLength(pathLength / 2);
                                
                                OL.drawLogicIcon(lineGroup, midPoint.x, midPoint.y, outLogic.rule, outLogic.type === 'loop', outLogic.loopLimit || '');
                            } catch (e) {
                                // Fallback for non-rendered paths
                                OL.drawLogicIcon(lineGroup, (start.x + targetX)/2, (start.y + targetY)/2, outLogic.rule, outLogic.type === 'loop', outLogic.loopLimit || '');
                            }
                        }
                    }
                }
            });
        });
    });
};

// 🚀 THE FIX: Attach to document so it works even if the element is rendered later
document.addEventListener('scroll', (e) => {
    if (e.target && e.target.id === 'v2-canvas-scroll-wrap') {
        // Use requestAnimationFrame to keep the lines buttery smooth during scroll
        requestAnimationFrame(() => {
            if (typeof OL.drawConnections === 'function') {
                OL.drawConnections();
            }
        });
    }
}, true); // 'true' enables Capture mode, which is required for scroll events to bubble up

export function drawLogicIcon(group, x, y, rule, isLoop = false, limit = '') {
    if (type === 'next' && !rule) return; // Don't draw bubbles for plain arrows

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', `logic-gate-container ${isLoop ? 'is-loop-gate' : ''}`);
    g.setAttribute('pointer-events', 'all'); // 🎯 Force hover detection
    g.style.cursor = 'pointer';
    
    // 1. The Rule Label (Hover Reveal)
    const labelGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    labelGroup.setAttribute('class', 'logic-rule-label');
    
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    
    text.setAttribute('x', x);
    text.setAttribute('y', y - 22);
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('fill', 'var(--text-main)');
    text.setAttribute('font-size', '10px');
    text.textContent = rule;

    const textWidth = rule.length * 6 + 20;
    rect.setAttribute('x', x - textWidth / 2); 
    rect.setAttribute('y', y - 35);
    rect.setAttribute('width', textWidth);
    rect.setAttribute('height', '20');
    rect.setAttribute('rx', '4');
    rect.setAttribute('fill', 'var(--bg-card)');
    rect.setAttribute('stroke', isLoop ? 'var(--warning)' : 'var(--accent)');
    
    labelGroup.appendChild(rect);
    labelGroup.appendChild(text);

    // 2. The Main Icon Circle
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', x);
    circle.setAttribute('cy', y);
    circle.setAttribute('r', '8');
    circle.setAttribute('fill', 'var(--bg-panel)');
    circle.setAttribute('stroke', isLoop ? 'var(--warning)' : 'var(--accent)');

    const iconText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    iconText.setAttribute('x', x);
    iconText.setAttribute('y', y + 4); 
    iconText.setAttribute('text-anchor', 'middle');
    iconText.setAttribute('fill', isLoop ? 'var(--warning)' : 'var(--accent)');
    iconText.setAttribute('font-size', isLoop ? '12px' : '9px');
    iconText.style.pointerEvents = 'none';
    iconText.textContent = isLoop ? '↺' : 'λ';

    // 🚀 3. THE LOOP LIMIT BADGE (Visible by default)
    if (isLoop && limit) {
        const badgeG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        const bRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        const bText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        
        const bWidth = limit.length * 5 + 8;
        bRect.setAttribute('x', x + 10);
        bRect.setAttribute('y', y - 6);
        bRect.setAttribute('width', bWidth);
        bRect.setAttribute('height', '12');
        bRect.setAttribute('rx', '6');
        bRect.setAttribute('fill', 'var(--warning)');
        
        bText.setAttribute('x', x + 10 + bWidth / 2);
        bText.setAttribute('y', y + 3);
        bText.setAttribute('text-anchor', 'middle');
        bText.setAttribute('fill', '#000');
        bText.setAttribute('font-size', '8px');
        bText.setAttribute('font-weight', 'bold');
        bText.textContent = limit;
        
        badgeG.appendChild(bRect);
        badgeG.appendChild(bText);
        g.appendChild(badgeG);
    }

    g.appendChild(labelGroup);
    g.appendChild(circle);
    g.appendChild(iconText);
    group.appendChild(g);
};

export function zoom(delta) {
    const canvas = document.getElementById('v2-canvas');
    if (!canvas) return;

    // 1. Calculate new zoom level
    let newZoom = (state.v2.zoom || 1) + delta;
    
    // 2. Clamp values (0.2x min, 2.0x max)
    if (newZoom < 0.2) newZoom = 0.2;
    if (newZoom > 2.0) newZoom = 2.0;

    // 3. Update State
    state.v2.zoom = newZoom;

    // 4. Apply to DOM immediately for smoothness
    // Note: We include the pan coordinates so zooming doesn't reset your position
    const { x, y } = state.v2.pan || { x: 0, y: 0 };
    canvas.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${newZoom})`;
    
    console.log(`🔍 Zoom Level: ${Math.round(newZoom * 100)}%`);
};

export function refreshFamilyNaming(targetRes, resources) {
    if (!targetRes || !resources) return;

    // 1. Get the 'Base Name' by stripping any existing (1/2) suffixes
    const baseName = targetRes.name.replace(/\s\(\d+\/\d+\)$/, "").trim();
    
    // 2. Find all current parts on the canvas that share this base name within the provided resource array
    const family = resources.filter(r => {
        const rBase = r.name.replace(/\s\(\d+\/\d+\)$/, "").trim();
        return rBase === baseName;
    }).sort((a, b) => (a.coords?.y || 0) - (b.coords?.y || 0));

    // 3. Re-assign the counters based on the new current total
    if (family.length <= 1) {
        family[0].name = baseName;
    } else {
        family.forEach((member, i) => {
            member.name = `${baseName} (${i + 1}/${family.length})`;
        });
    }
};

export async function duplicateResourceV2(resourceId) {
    // 🛡️ Secondary shield against bubbling
    if (window.event) {
        window.event.stopPropagation();
        window.event.preventDefault();
    }

    const isVault = window.location.hash.includes('vault');
    const client = getActiveClient();
    
    // 1. Resolve Data Source
    let source = isVault ? state.master.resources : client?.projectData?.localResources;
    if (!source) return console.error("❌ Source array not found");

    // 2. Find Original
    const original = source.find(r => String(r.id) === String(resourceId));
    if (!original) return console.error("❌ Original not found");

    // 3. Clone and Save
    await OL.updateAndSync(() => {
        const clone = JSON.parse(JSON.stringify(original));
        const timestamp = Date.now();
        
        clone.id = (isVault ? 'res-vlt-' : 'local-prj-') + timestamp;
        clone.name = original.name.replace(/\s\(\d+\/\d+\)$/, "").replace(" (Copy)", "") + " (Copy)";
        
        // Offset so it's not hidden behind the original
        if (clone.coords) {
            clone.coords.x += 50;
            clone.coords.y += 50;
        }

        // Wipe instance-specific flags
        delete clone.masterRefId; 
        
        source.push(clone);
        console.log("✅ Duplicated to:", clone.id);
    });

    // 4. Force UI to Draw
    OL.renderVisualizer();
};

export function toggleWorkbenchTray() {
    const viewport = document.getElementById('v2-viewport');
    if (!viewport) return;

    // 1. Force a boolean check. If it's undefined, assume it's currently OPEN (true)
    if (state.ui.sidebarOpen === undefined) {
        state.ui.sidebarOpen = true;
    }

    // 2. Flip the state
    state.ui.sidebarOpen = !state.ui.sidebarOpen;

    // 3. Update the DOM immediately
    if (state.ui.sidebarOpen) {
        viewport.classList.remove('tray-closed');
    } else {
        viewport.classList.add('tray-closed');
    }

    // 4. Update the Button Icon if you have one
    const btn = document.querySelector('.v2-tray-toggle-btn');
    if (btn) btn.innerHTML = state.ui.sidebarOpen ? '🔳' : '⬜';
};

// hashchange listener already registered near the top of the file

// 🛑 GLOBAL REFRESH SHIELD
// This stops the browser from navigating if a drop fails or is mishandled
['dragover', 'drop'].forEach(eventName => {
    window.addEventListener(eventName, e => {
        e.preventDefault();
        e.stopPropagation();
    }, false);
});

// ---- bridge: keep OL.*/window.* calls working until callers import directly ----
window.OL = window.OL || {};
Object.assign(window.OL, {
    initWBMotion, handleCanvasDrop, autoAlignNodes, getCurrentProjectData,
    _fvNormalizeStepCoords, _fvGetEffectiveOut, _fvLayoutResource, _fvAutoLinkSteps,
    renderVisualizer, _fvTogglePrintMenu, _fvHandleDrawerDrop, _fvRenderFlowchart,
    _fvRenderList, _fvBuildFlowchartShell, _fvDropAtIndex, _fvRailDrop,
    _fvLaneDragOver, _fvLaneDragLeave, _fvLaneDrop, _fvComputeLayout,
    getLucideSVG, _fvBuildCard, _fvCardDragStart, _fvCardDragEnd,
    _fvToggleCardSteps, _fvRenderSteps, _fvToggleConsolidated, _fvSetStepGroup,
    _fvDrawStepConnections, _fvSetupCardDrag, _fvEditStageName, _fvJumpToLane,
    _fvSyncRailHeights, _fvDrawConnections, _fvHighlightGlobalConnections, _fvTidy,
    _fvShowTidyMenu, _fvTogglePin, _fvToggleWb, _fvPopulateWb,
    _fvRenderWbItems, _fvFilterWb, _fvWbDragStart, _fvSetupRailScroll,
    _fvUnmapResource, _fvHandleCanvasClick, closeInspectorPanel, _fvSelectStep,
    _fvBuildListShell, _fvOpenStepsList, _fvAssignStageAndWorkflow, _fvOpenStepCanvas,
    _fvToggleStepsPanel, _fvRenderListStep, fvSearch, fvNextMatch,
    fvPrevMatch, fvActivateMatch, fvClearSearch, fvToggleConnections,
    _fvSetupZoom, fvZoom, handleSidebarSearch, getStepIcon,
    renderWorkbenchTabs, renderSidebarTypeFilter, renderWorkbenchItemsOnly, switchWorkbenchTab,
    handleAssetDragStart, handleDataDragStart, handleUniversalDropOnStep, renderTrayContent,
    renderFocusControls, exitVisualFocus, addNewResourceToCanvas, toggleLogicMenu,
    setTraceMode, handleStepDragStart, handleStepDragOver, handleStepDragLeave,
    handleStepDrop, save, getPartNumberHtml, toggleMasterExpand,
    closeModal, addNewStepToCard, parseStepInput, handleQuickAddInput,
    updateQuickAddPreview, showSlashMenu, insertCommand, handleQuickAddKeys,
    updateStepPreview, showSubMenu, selectMultiLink, selectTargetResource,
    selectMultiAssignee, exitSubMenu, completeSubMenuValue, selectMenuOption,
    commitQuickStep, updateStepName, deleteStep, toggleSteps,
    splitCardAtStep, highlightFamily, toggleScopingStatus, getAppByFunction,
    getResourceIcon, openInspector, _buildInspectorContent, executeStepMove,
    _fvToggleLogicType, _fvOpenTargetPicker, renderStepResources, updateAtomicStep,
    _fvRefreshInspector, filterAppSearch, selectAppForResource, selectAppForStep,
    removeAppFromStep, getFilteredAssigneeOptions, filterAssignmentSearch, executeAssignment,
    removeAssignee, filterTargetSearch, setStepTargetResource, filterResourceSearch,
    toggleFilterMenu, syncCanvasFilters, centerNextCanvasMatch, centerPrevCanvasMatch,
    centerCanvasNode, refreshFilterDropdowns, clearAllFilters, addLinkToStep,
    promptLinkType, removeStepLink, renderLogicBlock, filterLogicTargetSearch,
    getAllStepOptions, addStepLogic, updateStepLogic, removeStepLogic,
    updateStepTarget, syncLogicPorts, updateStepLink, createMirrorLink,
    clearMirrorLink, getCardConnectionPoint, drawConnections, drawLogicIcon,
    zoom, refreshFamilyNaming, duplicateResourceV2, toggleWorkbenchTray
});
// Called bare from app.js's router — bridge onto window directly.
window.renderVisualizer = renderVisualizer;
