//======================= FEATURES / HOW-TO =======================//
// Extracted from app.js "HOW TO SECTION" + "HOW-TO RESOURCES OVERLAP" +
// "HOW-TO TASKS OVERLAP" + "HOW TO SCOPING OVERLAP" (all combined, no
// clean boundaries between them — same pattern as analysis.js/scoping.js).
// Owns: the How-To/SOP library grid, the block-based guide editor (text,
// checklist, image, and resource-link blocks), and How-To's overlap
// points with apps, resources, tasks, and scoping requirements.

import { state, esc, getActiveClient, persist } from '../core/data.js';

export function renderHowToLibrary() {
    OL.registerView(renderHowToLibrary);
    const container = document.getElementById("mainContent");
    const client = getActiveClient();
    const hash = window.location.hash;

    if (!container) return;
    container.style.cssText = '';
    document.body.classList.remove('is-visualizer');

    const isAdmin = window.FORCE_ADMIN === true;
    const isVaultView = hash.startsWith('#/vault');

    // 1. Data Selection (Master + Project Local)
    const masterLibrary = state.master.howToLibrary || [];
    const localLibrary = (client && client.projectData.localHowTo) || [];
    
    const visibleGuides = isVaultView 
        ? masterLibrary 
        : [...masterLibrary.filter(ht => (client?.sharedMasterIds || []).includes(ht.id)), ...localLibrary];

    container.innerHTML = `
        <div class="section-header" style="display: flex !important; align-items: center; gap: 12px; visibility: visible !important; opacity: 1 !important;">
            <i data-lucide="library" style="width: 28px; height: 24px; color: var(--accent);"></i>
            <div style="flex: 1;">
                <h2 style="margin:0;">${isVaultView ? 'Master SOP Vault' : 'Project Instructions'}</h2>
                <div class="small muted">${isVaultView ? 'Global Standards' : `Custom guides for ${esc(client?.meta?.name)}`}</div>
            </div>
            
            <div class="header-actions" style="display: flex !important; gap: 10px !important; align-items: center;">
                ${isVaultView && isAdmin ? `
                    <button class="btn primary" style="background: var(--accent) !important; color: black !important; font-weight: bold; display: flex; align-items: center; gap: 6px;" 
                            onclick="OL.openHowToEditorModal()">
                        <i data-lucide="plus" style="width: 14px; height: 14px;"></i> Create Master SOP
                    </button>
                    ${OL.viewToggleBtn('howto', 'renderHowToLibrary')}
                ` : ''}

                ${!isVaultView ? `
                    <button class="btn small soft" style="display: flex; align-items: center; gap: 6px;" 
                            onclick="OL.openLocalHowToEditor()">
                        <i data-lucide="plus" style="width: 14px; height: 14px;"></i> Local SOP
                    </button>
                    ${isAdmin ? `
                        <button class="btn primary" style="background: var(--accent) !important; color: black !important; display: flex; align-items: center; gap: 6px;" 
                                onclick="OL.importHowToToProject()">
                            <i data-lucide="download-cloud" style="width: 14px; height: 14px;"></i> Import Master
                        </button>` : ''}
                ` : ''}
            </div>
        </div>
        ${OL.getViewMode('howto') === 'list' ? `
            <div style="display:flex;flex-direction:column;gap:2px;margin-top:10px;">
                ${visibleGuides.map(ht => `
                    <div style="display:flex;align-items:center;gap:12px;padding:10px 16px;
                                background:var(--panel-soft);border:1px solid var(--panel-border);
                                border-radius:8px;cursor:pointer;transition:border-color 0.2s;"
                         onclick="OL.openGuideEditor('${ht.id}')"
                         onmouseover="this.style.borderColor='var(--accent)'"
                         onmouseout="this.style.borderColor='var(--panel-border)'">
                        <i data-lucide="book-open" style="width:14px;height:14px;color:var(--accent);flex-shrink:0;"></i>
                        <div style="flex:1;min-width:0;">
                            <div style="font-weight:600;font-size:13px;">${esc(ht.name||'Untitled SOP')}</div>
                            ${ht.summary ? `<div style="font-size:10px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(ht.summary)}</div>` : ''}
                        </div>
                        <span class="pill tiny ${String(ht.id).includes('local') ? 'soft' : 'vault'}" style="font-size:8px;">
                            ${String(ht.id).includes('local') ? 'LOCAL' : 'MASTER'}
                        </span>
                        <button class="card-delete-btn" style="position:static;" onclick="event.stopPropagation();OL.deleteSOP('${client?.id}','${ht.id}')">
                            <i data-lucide="x" style="width:12px;height:12px;"></i>
                        </button>
                    </div>
                `).join('')}
            </div>
        ` : `
        <div class="cards-grid" style="margin-top: 20px;">
            ${visibleGuides.map(ht => renderHowToCard(client?.id, ht, !isVaultView)).join('')}
            ${visibleGuides.length === 0 ? '<div class="empty-hint" style="grid-column: 1/-1; text-align: center; padding: 60px; opacity: 0.5;">No guides found in this library.</div>' : ''}
        </div>
        `}
    `;

    // 🚀 THE REPAINT
    if (window.lucide) {
        window.lucide.createIcons();
    }
};

// 2. RENDER HOW TO CARDS
export function renderHowToCard(clientId, ht, isClientView) {
    const client = state.clients[clientId];
    const isAdmin = window.FORCE_ADMIN === true;
    
    const isVaultView = window.location.hash.includes('vault');
    const isLocal = String(ht.id).includes('local');
    const isMaster = !isLocal;
    const canDelete = isAdmin || isLocal;
    const isShared = client?.sharedMasterIds?.includes(ht.id);

    return `
        <div class="card hover-trigger ${isMaster ? (isShared ? 'is-shared' : 'is-private') : 'is-local'}" 
             style="cursor: pointer; position: relative;" 
             onclick="OL.openGuideEditor('${ht.id}')">

            <div class="card-header" style="display:flex; justify-content:space-between; align-items:flex-start;">
                <div style="display:flex; align-items:center; gap:8px;">
                    <i data-lucide="book-open" style="width:14px; height:14px; color:var(--accent); opacity:0.8;"></i>
                    <div class="card-title ht-card-title-${ht.id}">${esc(ht.name || 'Untitled SOP')}</div>
                </div>

                ${canDelete ? `
                <button class="card-delete-btn" 
                        style="position:static;"
                        title="${isVaultView ? 'Delete Master Source' : (isMaster ? 'Remove from Client View' : 'Delete Permanently')}" 
                        onclick="event.stopPropagation(); OL.deleteSOP('${clientId}', '${ht.id}')">
                    <i data-lucide="x" style="width:14px; height:14px;"></i>
                </button>
                ` : ''}
            </div>
            
            <div class="card-body" style="padding-top: 12px;">
                <div style="display: flex; gap: 6px; align-items: center; margin-bottom: 10px;">
                    <span class="pill tiny ${isMaster ? 'vault' : 'local'}" style="font-size: 8px; letter-spacing: 0.05em; display:flex; align-items:center; gap:4px;">
                        <i data-lucide="${isMaster ? 'shield-check' : 'map-pin'}" style="width:10px; height:10px;"></i>
                        ${isMaster ? 'MASTER' : 'LOCAL'}
                    </span>

                    ${!isClientView && isMaster ? `
                        <span class="pill tiny ${isShared ? 'accent' : 'soft'}" 
                              style="font-size: 8px; cursor: pointer; display:flex; align-items:center; gap:4px;"
                              onclick="event.stopPropagation(); OL.toggleSOPSharing('${clientId}', '${ht.id}')">
                            <i data-lucide="${isShared ? 'globe' : 'lock'}" style="width:10px; height:10px;"></i>
                            ${isShared ? 'Client-Facing' : 'Internal-Only'}
                        </span>
                    ` : ''}
                </div>
                <p class="small muted" style="display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.4; font-size: 11px;">
                    ${esc(ht.summary || 'No summary provided.')}
                </p>
            </div>
        </div>
    `;
}

export function openGuideEditor(htId, draftObj = null) {
    const mainArea = document.getElementById('mainContent');
    if (!mainArea) return;

    document.body.classList.add('is-visualizer');
    mainArea.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden;padding:0;';

    const hash = window.location.hash;
    const isVaultMode = hash.includes('vault');
    const client = getActiveClient();

    // 1. Resolve guide
    let ht = draftObj;
    if (!ht) ht = (state.master.howToLibrary || []).find(h => h.id === htId);
    if (!ht && client) ht = (client.projectData.localHowTo || []).find(h => h.id === htId);
    if (!ht) return;

    // 2. Migrate legacy content to blocks
    if (!ht.blocks) {
        ht.blocks = [];
        if (ht.content && ht.content.trim()) {
            ht.blocks.push({
                id: 'blk-' + Date.now(),
                type: 'text',
                data: { html: ht.content }
            });
        }
        // don't delete ht.content yet — keep as fallback
    }

    const isAdmin = window.FORCE_ADMIN === true;
    const isLocal = String(ht.id).includes('local');
    const canEdit = isAdmin || isLocal || String(htId).startsWith('draft');

    OL._ge = { htId: ht.id, canEdit };

    mainArea.innerHTML = `
        <div id="ge-shell" style="display:flex;flex-direction:column;height:100%;overflow:hidden;background:var(--bg);">

            <!-- TOPBAR -->
            <div id="ge-topbar" style="
                display:flex;align-items:center;gap:10px;
                padding:10px 20px;flex-shrink:0;
                background:var(--panel);border-bottom:1px solid var(--panel-border);
                min-height:56px;">

                <button class="fv-btn" onclick="OL.closeGuideEditor()" style="gap:6px;">
                    <i data-lucide="arrow-left" style="width:13px;height:13px;"></i>
                    Back
                </button>

                <div style="width:1px;height:20px;background:var(--panel-border);"></div>

                <i data-lucide="book-open" style="width:16px;height:16px;color:var(--accent);flex-shrink:0;"></i>
                <input type="text"
                       id="ge-title-input"
                       value="${esc(ht.name || '')}"
                       placeholder="Guide title..."
                       ${!canEdit ? 'readonly' : ''}
                       style="background:transparent;border:none;outline:none;font-size:16px;
                              font-weight:700;color:var(--text-main);flex:1;font-family:inherit;"
                       onblur="OL._geSaveField('name', this.value)">

                <div style="flex:1;"></div>

                ${canEdit ? `
                    <div style="position:relative;">
                        <button class="fv-btn" id="ge-add-block-btn"
                                onclick="OL._geToggleBlockMenu()"
                                style="gap:6px;background:var(--accent);color:#000;border-color:var(--accent);font-weight:700;">
                            <i data-lucide="plus" style="width:13px;height:13px;"></i>
                            Add Block
                        </button>
                        <div id="ge-block-menu" style="
                            display:none;position:absolute;top:calc(100% + 6px);right:0;
                            background:var(--panel);border:1px solid var(--panel-border);
                            border-radius:10px;padding:6px;z-index:100;min-width:180px;
                            box-shadow:0 8px 24px rgba(0,0,0,0.3);">
                            ${[
                                { type:'text',      icon:'align-left',   label:'Text / HTML' },
                                { type:'checklist', icon:'check-square', label:'Checklist' },
                                { type:'image',     icon:'image',        label:'Image' },
                                { type:'resource',  icon:'link',         label:'Resource Link' },
                            ].map(b => `
                                <div onclick="OL._geAddBlock('${b.type}'); OL._geToggleBlockMenu();"
                                     style="display:flex;align-items:center;gap:10px;padding:9px 12px;
                                            border-radius:7px;cursor:pointer;transition:background 0.12s;"
                                     onmouseover="this.style.background='var(--panel-soft)'"
                                     onmouseout="this.style.background='transparent'">
                                    <i data-lucide="${b.icon}" style="width:13px;height:13px;color:var(--accent);flex-shrink:0;"></i>
                                    <span style="font-size:12px;font-weight:600;color:var(--text-main);">${b.label}</span>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                ` : ''}

                <button class="fv-btn" onclick="OL.closeGuideEditor()"
                        style="background:var(--panel-soft);color:var(--text-dim);">
                    <i data-lucide="x" style="width:13px;height:13px;"></i>
                </button>
            </div>

            <!-- BODY -->
            <div id="ge-body" style="display:flex;flex:1;overflow:hidden;">

                <!-- EDITOR COLUMN -->
                <div id="ge-editor" style="
                    flex:1;overflow-y:auto;padding:40px;
                    display:flex;flex-direction:column;gap:12px;
                    max-width:860px;margin:0 auto;width:100%;">

                    <!-- Summary -->
                    <input type="text"
                           placeholder="One-sentence summary..."
                           value="${esc(ht.summary || '')}"
                           ${!canEdit ? 'readonly' : ''}
                           style="background:transparent;border:none;border-bottom:1px solid var(--panel-border);
                                  outline:none;font-size:13px;color:var(--text-dim);padding:4px 0;
                                  font-family:inherit;width:100%;"
                           onblur="OL._geSaveField('summary', this.value)">

                    <div style="height:1px;background:var(--panel-border);margin:8px 0;"></div>

                    <!-- BLOCKS -->
                    <div id="ge-blocks-container">
                        ${OL._geRenderAllBlocks(ht)}
                    </div>

                    ${canEdit ? `
                        <div style="position:relative;margin-top:8px;">
                            <div onmousedown="event.preventDefault(); 
                                             const m=this.nextElementSibling; 
                                             m.style.display=m.style.display==='block'?'none':'block';"
                                 style="border:1px dashed var(--panel-border);border-radius:10px;
                                        padding:20px;text-align:center;cursor:pointer;
                                        color:var(--text-muted);font-size:12px;transition:all 0.15s;"
                                 onmouseover="this.style.borderColor='var(--accent)';this.style.color='var(--accent)'"
                                 onmouseout="this.style.borderColor='var(--panel-border)';this.style.color='var(--text-muted)'">
                                <i data-lucide="plus-circle" style="width:16px;height:16px;display:block;margin:0 auto 6px;"></i>
                                Add a block
                            </div>
                            <div style="display:none;position:absolute;top:calc(100% + 6px);left:50%;
                                        transform:translateX(-50%);background:var(--panel);
                                        border:1px solid var(--panel-border);border-radius:10px;
                                        padding:6px;z-index:100;min-width:180px;
                                        box-shadow:0 8px 24px rgba(0,0,0,0.3);">
                                ${[
                                    { type:'text',      icon:'align-left',   label:'Text / HTML' },
                                    { type:'checklist', icon:'check-square', label:'Checklist' },
                                    { type:'image',     icon:'image',        label:'Image' },
                                    { type:'resource',  icon:'link',         label:'Resource Link' },
                                ].map(b => `
                                    <div onmousedown="event.preventDefault(); OL._geAddBlock('${b.type}'); this.closest('[style*=position]').style.display='none';"
                                         style="display:flex;align-items:center;gap:10px;padding:9px 12px;
                                                border-radius:7px;cursor:pointer;transition:background 0.12s;"
                                         onmouseover="this.style.background='var(--panel-soft)'"
                                         onmouseout="this.style.background='transparent'">
                                        <i data-lucide="${b.icon}" style="width:13px;height:13px;color:var(--accent);flex-shrink:0;"></i>
                                        <span style="font-size:12px;font-weight:600;color:var(--text-main);">${b.label}</span>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    ` : ''}
                </div>

                <!-- RIGHT SIDEBAR (metadata) -->
                <div id="ge-sidebar" style="
                    width:260px;flex-shrink:0;
                    border-left:1px solid var(--panel-border);
                    background:var(--panel-soft);
                    overflow-y:auto;padding:20px;
                    display:flex;flex-direction:column;gap:16px;">

                    <!-- Video -->
                    <div>
                        <div style="font-size:9px;font-weight:700;text-transform:uppercase;
                                    letter-spacing:0.1em;color:var(--text-muted);margin-bottom:6px;
                                    display:flex;align-items:center;gap:5px;">
                            <i data-lucide="video" style="width:11px;height:11px;"></i> Training Video
                        </div>
                        <input type="text" class="fvi-input"
                               placeholder="YouTube / Loom / Vimeo URL"
                               value="${esc(ht.videoUrl || '')}"
                               ${!canEdit ? 'readonly' : ''}
                               onblur="OL._geSaveField('videoUrl', this.value); OL._geRefreshVideoPreview(this.value);">
                        <div id="ge-video-preview" style="margin-top:8px;">
                            ${ht.videoUrl ? OL.parseVideoEmbed(ht.videoUrl) : ''}
                        </div>
                    </div>

                    <!-- Category -->
                    <div>
                        <div style="font-size:9px;font-weight:700;text-transform:uppercase;
                                    letter-spacing:0.1em;color:var(--text-muted);margin-bottom:6px;
                                    display:flex;align-items:center;gap:5px;">
                            <i data-lucide="folder" style="width:11px;height:11px;"></i> Category
                        </div>
                        <input type="text" class="fvi-input"
                               value="${esc(ht.category || 'General')}"
                               ${!canEdit ? 'readonly' : ''}
                               onblur="OL._geSaveField('category', this.value)">
                    </div>

                    <!-- Related Apps -->
                    <div>
                        <div style="font-size:9px;font-weight:700;text-transform:uppercase;
                                    letter-spacing:0.1em;color:var(--text-muted);margin-bottom:6px;
                                    display:flex;align-items:center;gap:5px;">
                            <i data-lucide="smartphone" style="width:11px;height:11px;"></i> Related Apps
                        </div>
                        <div id="ge-app-pills" style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px;">
                            ${OL._geRenderAppPills(ht)}
                        </div>
                        ${canEdit ? `
                            <div style="position:relative;">
                                <input type="text" class="fvi-input" placeholder="Search apps..."
                                       onfocus="OL._geFilterAppSearch('${ht.id}','')"
                                       oninput="OL._geFilterAppSearch('${ht.id}',this.value)">
                                <div id="ge-app-results" class="search-results-overlay" style="position:absolute;z-index:50;width:100%;"></div>
                            </div>
                        ` : ''}
                    </div>
                </div>
            </div>
        </div>
    `;

    if (window.lucide) lucide.createIcons();

    // Close block menu on outside click
    document.addEventListener('click', OL._geOutsideClick);
};

export function _geOutsideClick(e) {
    const menu = document.getElementById('ge-block-menu');
    const btn  = document.getElementById('ge-add-block-btn');
    if (menu && !menu.contains(e.target) && btn && !btn.contains(e.target)) {
        menu.style.display = 'none';
    }
};

export function closeGuideEditor() {
    document.removeEventListener('click', OL._geOutsideClick);
    document.body.classList.remove('is-visualizer');
    const mainArea = document.getElementById('mainContent');
    if (mainArea) mainArea.style.cssText = '';
    renderHowToLibrary();
};

// ── BLOCK MENU TOGGLE ──────────────────────────────
export function _geToggleBlockMenu() {
    const menu = document.getElementById('ge-block-menu');
    if (!menu) return;
    menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
};

// ── SAVE FIELD ─────────────────────────────────────
export function _geSaveField(field, value) {
    const { htId } = OL._ge;
    OL.handleHowToSave(htId, field, value);
};

// ── RESOLVE GUIDE ──────────────────────────────────
export function _geGetHt() {
    const { htId } = OL._ge;
    const client = getActiveClient();
    return (state.master.howToLibrary || []).find(h => h.id === htId)
        || (client?.projectData?.localHowTo || []).find(h => h.id === htId);
};

// ── SAVE BLOCKS ────────────────────────────────────
export function _geSaveBlocks() {
    const ht = OL._geGetHt();
    if (!ht) return;
    OL.persist();
};

// ── ADD BLOCK ──────────────────────────────────────
export function _geAddBlock(type) {
    const ht = OL._geGetHt();
    if (!ht) return;
    if (!ht.blocks) ht.blocks = [];

    const id = 'blk-' + Date.now();
    const defaults = {
        text:      { html: '' },
        checklist: { items: [] },
        image:     { url: '', caption: '' },
        resource:  { resourceId: null, resourceName: '', note: '' },
    };

    ht.blocks.push({ id, type, data: defaults[type] || {} });
    OL.persist();

    // Re-render just the blocks container
    const container = document.getElementById('ge-blocks-container');
    if (container) {
        container.innerHTML = OL._geRenderAllBlocks(ht);
        if (window.lucide) lucide.createIcons();
        // Focus new block
        requestAnimationFrame(() => {
            const newBlock = document.getElementById(`ge-blk-${id}`);
            if (newBlock) {
                newBlock.scrollIntoView({ behavior: 'smooth', block: 'center' });
                const input = newBlock.querySelector('textarea, input[type="text"]');
                if (input) input.focus();
            }
        });
    }
};

// ── DELETE BLOCK ───────────────────────────────────
export function _geDeleteBlock(blockId) {
    const ht = OL._geGetHt();
    if (!ht) return;
    ht.blocks = (ht.blocks || []).filter(b => b.id !== blockId);
    OL.persist();
    const container = document.getElementById('ge-blocks-container');
    if (container) {
        container.innerHTML = OL._geRenderAllBlocks(ht);
        if (window.lucide) lucide.createIcons();
    }
};

// ── MOVE BLOCK ─────────────────────────────────────
export function _geMoveBlock(blockId, dir) {
    const ht = OL._geGetHt();
    if (!ht || !ht.blocks) return;
    const idx = ht.blocks.findIndex(b => b.id === blockId);
    if (idx === -1) return;
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= ht.blocks.length) return;
    const tmp = ht.blocks[idx];
    ht.blocks[idx] = ht.blocks[newIdx];
    ht.blocks[newIdx] = tmp;
    OL.persist();
    const container = document.getElementById('ge-blocks-container');
    if (container) {
        container.innerHTML = OL._geRenderAllBlocks(ht);
        if (window.lucide) lucide.createIcons();
    }
};

// ── RENDER ALL BLOCKS ──────────────────────────────
export function _geRenderAllBlocks(ht) {
    const blocks = ht.blocks || [];
    if (!blocks.length) {
        return `<div style="text-align:center;padding:60px 20px;color:var(--text-muted);font-size:12px;opacity:0.6;">
            No blocks yet — click <strong>Add Block</strong> above to get started.
        </div>`;
    }
    return blocks.map((b, i) => OL._geRenderBlock(b, i, blocks.length)).join('');
};

// ── RENDER SINGLE BLOCK ────────────────────────────
export function _geRenderBlock(block, idx, total) {
    const { canEdit } = OL._ge || {};
    const controls = canEdit ? `
        <div class="ge-block-controls" style="
            position:absolute;top:10px;right:10px;
            display:none;align-items:center;gap:4px;z-index:10;">
            <button onclick="OL._geMoveBlock('${block.id}', -1)"
                    title="Move up" ${idx === 0 ? 'disabled' : ''}
                    style="width:24px;height:24px;border:1px solid var(--panel-border);
                           background:var(--panel-soft);border-radius:5px;cursor:pointer;
                           color:var(--text-dim);display:flex;align-items:center;justify-content:center;
                           opacity:${idx === 0 ? '0.3' : '1'};">
                <i data-lucide="chevron-up" style="width:11px;height:11px;pointer-events:none;"></i>
            </button>
            <button onclick="OL._geMoveBlock('${block.id}', 1)"
                    title="Move down" ${idx === total-1 ? 'disabled' : ''}
                    style="width:24px;height:24px;border:1px solid var(--panel-border);
                           background:var(--panel-soft);border-radius:5px;cursor:pointer;
                           color:var(--text-dim);display:flex;align-items:center;justify-content:center;
                           opacity:${idx === total-1 ? '0.3' : '1'};">
                <i data-lucide="chevron-down" style="width:11px;height:11px;pointer-events:none;"></i>
            </button>
            <button onclick="OL._geDeleteBlock('${block.id}')"
                    title="Delete block"
                    style="width:24px;height:24px;border:1px solid rgba(239,68,68,0.3);
                           background:rgba(239,68,68,0.06);border-radius:5px;cursor:pointer;
                           color:#ef4444;display:flex;align-items:center;justify-content:center;">
                <i data-lucide="trash-2" style="width:11px;height:11px;pointer-events:none;"></i>
            </button>
        </div>
    ` : '';

    const inner = OL._geRenderBlockInner(block, canEdit);

    return `
        <div id="ge-blk-${block.id}"
             class="ge-block"
             style="position:relative;background:var(--panel);border:1px solid var(--panel-border);
                    border-radius:10px;padding:18px 20px;transition:border-color 0.15s;"
             onmouseenter="const c=this.querySelector('.ge-block-controls'); if(c) c.style.display='flex';"
             onmouseleave="const c=this.querySelector('.ge-block-controls'); if(c) c.style.display='none';">
            ${controls}
            ${inner}
        </div>
    `;
};

// ── RENDER BLOCK INNER BY TYPE ─────────────────────
export function _geRenderBlockInner(block, canEdit) {
    switch (block.type) {

        case 'text':
            return `
                <div style="display:flex;align-items:center;gap:6px;margin-bottom:10px;">
                    <i data-lucide="align-left" style="width:12px;height:12px;color:var(--accent);"></i>
                    <span style="font-size:9px;font-weight:700;text-transform:uppercase;
                                 letter-spacing:0.1em;color:var(--text-muted);">Text</span>
                </div>
                ${canEdit ? `
                    <textarea
                        style="width:100%;min-height:100px;background:var(--panel-soft);
                               border:1px solid var(--panel-border);border-radius:8px;
                               color:var(--text-main);font-size:13px;line-height:1.6;
                               padding:10px 12px;font-family:inherit;resize:vertical;outline:none;
                               transition:border-color 0.15s;box-sizing:border-box;"
                        onfocus="this.style.borderColor='var(--accent)'"
                        onblur="this.style.borderColor='var(--panel-border)';
                                OL._geUpdateBlockData('${block.id}', {html: this.value})"
                        placeholder="Type text or paste HTML..."
                    >${block.data.html || ''}</textarea>
                    <div style="font-size:9px;color:var(--text-muted);margin-top:4px;opacity:0.6;">
                        HTML is supported — paste rich content freely.
                    </div>
                ` : `
                    <div style="font-size:13px;line-height:1.7;color:var(--text-main);">
                        ${block.data.html || '<em style="opacity:0.4;">Empty text block</em>'}
                    </div>
                `}
            `;

        case 'checklist':
            const items = block.data.items || [];
            return `
                <div style="display:flex;align-items:center;gap:6px;margin-bottom:10px;">
                    <i data-lucide="check-square" style="width:12px;height:12px;color:var(--accent);"></i>
                    <span style="font-size:9px;font-weight:700;text-transform:uppercase;
                                 letter-spacing:0.1em;color:var(--text-muted);">Checklist</span>
                </div>
                <div id="ge-cl-${block.id}" style="display:flex;flex-direction:column;gap:4px;">
                    ${items.map((item, i) => OL._geRenderChecklistItem(block.id, item, i)).join('')}
                </div>
                ${canEdit ? `
                    <button onclick="OL._geAddChecklistItem('${block.id}')"
                            style="display:flex;align-items:center;gap:6px;margin-top:8px;
                                   background:none;border:1px dashed var(--panel-border);
                                   border-radius:7px;padding:6px 12px;cursor:pointer;
                                   color:var(--text-muted);font-size:11px;font-family:inherit;
                                   width:100%;transition:all 0.15s;"
                            onmouseover="this.style.borderColor='var(--accent)';this.style.color='var(--accent)'"
                            onmouseout="this.style.borderColor='var(--panel-border)';this.style.color='var(--text-muted)'">
                        <i data-lucide="plus" style="width:11px;height:11px;pointer-events:none;"></i>
                        Add item
                    </button>
                ` : ''}
            `;

        case 'image':
            return `
                <div style="display:flex;align-items:center;gap:6px;margin-bottom:10px;">
                    <i data-lucide="image" style="width:12px;height:12px;color:var(--accent);"></i>
                    <span style="font-size:9px;font-weight:700;text-transform:uppercase;
                                 letter-spacing:0.1em;color:var(--text-muted);">Image</span>
                </div>
                ${canEdit ? `
                    <input type="text" class="fvi-input" style="margin-bottom:8px;"
                           placeholder="Paste image URL..."
                           value="${esc(block.data.url || '')}"
                           onblur="OL._geUpdateBlockData('${block.id}', {url: this.value, caption: document.getElementById('ge-img-cap-${block.id}')?.value || ''});
                                   OL._geRefreshImageBlock('${block.id}', this.value)">
                ` : ''}
                <div id="ge-img-preview-${block.id}">
                    ${block.data.url ? `
                        <img src="${esc(block.data.url)}" alt=""
                             style="width:100%;border-radius:8px;border:1px solid var(--panel-border);display:block;">
                    ` : `
                        <div style="background:var(--panel-soft);border:1px dashed var(--panel-border);
                                    border-radius:8px;padding:30px;text-align:center;
                                    color:var(--text-muted);font-size:12px;">
                            <i data-lucide="image" style="width:24px;height:24px;margin-bottom:8px;display:block;margin:0 auto 8px;opacity:0.4;"></i>
                            No image URL set
                        </div>
                    `}
                </div>
                <input type="text" id="ge-img-cap-${block.id}"
                       class="fvi-input" style="margin-top:8px;"
                       placeholder="Caption (optional)..."
                       value="${esc(block.data.caption || '')}"
                       ${!canEdit ? 'readonly' : ''}
                       onblur="OL._geUpdateBlockData('${block.id}', {url: document.querySelector('#ge-blk-${block.id} input[type=text]')?.value || '${esc(block.data.url || '')}', caption: this.value})">
                ${block.data.caption ? `
                    <div style="font-size:11px;color:var(--text-muted);margin-top:4px;font-style:italic;">
                        ${esc(block.data.caption)}
                    </div>
                ` : ''}
            `;

        case 'resource':
            return `
                <div style="display:flex;align-items:center;gap:6px;margin-bottom:10px;">
                    <i data-lucide="link" style="width:12px;height:12px;color:var(--accent);"></i>
                    <span style="font-size:9px;font-weight:700;text-transform:uppercase;
                                 letter-spacing:0.1em;color:var(--text-muted);">Resource Link</span>
                </div>
                ${block.data.resourceId ? `
                    <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;
                                background:var(--panel-soft);border:1px solid var(--panel-border);
                                border-radius:8px;cursor:pointer;"
                         onclick="OL.openResourceModal('${block.data.resourceId}')">
                        <i data-lucide="workflow" style="width:14px;height:14px;color:var(--accent);flex-shrink:0;"></i>
                        <div style="flex:1;">
                            <div style="font-weight:600;font-size:12px;color:var(--text-main);">
                                ${esc(block.data.resourceName || 'Linked Resource')}
                            </div>
                            ${block.data.note ? `
                                <div style="font-size:10px;color:var(--text-muted);margin-top:2px;">
                                    ${esc(block.data.note)}
                                </div>
                            ` : ''}
                        </div>
                        <i data-lucide="chevron-right" style="width:13px;height:13px;color:var(--text-muted);"></i>
                        ${canEdit ? `
                            <button onclick="event.stopPropagation();OL._geUpdateBlockData('${block.id}',{resourceId:null,resourceName:'',note:''})"
                                    style="background:none;border:none;color:var(--text-muted);cursor:pointer;padding:2px;">
                                <i data-lucide="x" style="width:12px;height:12px;pointer-events:none;"></i>
                            </button>
                        ` : ''}
                    </div>
                ` : (canEdit ? `
                    <div style="position:relative;">
                        <input type="text" class="fvi-input"
                               placeholder="Search resources..."
                               onfocus="OL._geFilterResourceSearch('${block.id}', '')"
                               oninput="OL._geFilterResourceSearch('${block.id}', this.value)">
                        <div id="ge-res-results-${block.id}"
                             class="search-results-overlay"
                             style="position:absolute;z-index:50;width:100%;"></div>
                    </div>
                    <input type="text" class="fvi-input" style="margin-top:6px;"
                           placeholder="Note about this resource (optional)..."
                           id="ge-res-note-${block.id}"
                           onblur="OL._geUpdateBlockData('${block.id}', {note: this.value})">
                ` : `
                    <div style="color:var(--text-muted);font-size:12px;font-style:italic;">No resource linked.</div>
                `)}
            `;

        default:
            return `<div style="color:var(--text-muted);font-size:12px;">Unknown block type: ${block.type}</div>`;
    }
};

// ── CHECKLIST ITEM ─────────────────────────────────
export function _geRenderChecklistItem(blockId, item, idx) {
    const { canEdit } = OL._ge || {};
    return `
        <div id="ge-cli-${item.id}" style="display:flex;align-items:center;gap:8px;
             padding:6px 8px;border-radius:7px;transition:background 0.12s;"
             onmouseover="this.style.background='var(--panel-soft)'"
             onmouseout="this.style.background='transparent'">
            <input type="checkbox"
                   ${item.checked ? 'checked' : ''}
                   onchange="OL._geToggleChecklistItem('${blockId}', '${item.id}', this.checked)"
                   style="width:15px;height:15px;cursor:pointer;flex-shrink:0;accent-color:var(--accent);">
            ${canEdit ? `
                <input type="text"
                       value="${esc(item.text || '')}"
                       placeholder="Checklist item..."
                       style="flex:1;background:transparent;border:none;outline:none;
                              font-size:13px;color:${item.checked ? 'var(--text-muted)' : 'var(--text-main)'};
                              font-family:inherit;text-decoration:${item.checked ? 'line-through' : 'none'};"
                       onblur="OL._geUpdateChecklistItem('${blockId}', '${item.id}', 'text', this.value)"
                       onkeydown="if(event.key==='Enter'){event.preventDefault();OL._geAddChecklistItem('${blockId}');}
                                  if(event.key==='Backspace'&&this.value===''){event.preventDefault();OL._geDeleteChecklistItem('${blockId}','${item.id}');}">
                <button onclick="OL._geDeleteChecklistItem('${blockId}', '${item.id}')"
                        style="background:none;border:none;cursor:pointer;
                               color:var(--text-muted);padding:2px;opacity:0;transition:opacity 0.15s;"
                        onmouseenter="this.style.opacity='1';this.style.color='#ef4444'"
                        onmouseleave="this.style.opacity='0'">
                    <i data-lucide="x" style="width:11px;height:11px;pointer-events:none;"></i>
                </button>
            ` : `
                <span style="flex:1;font-size:13px;
                             color:${item.checked ? 'var(--text-muted)' : 'var(--text-main)'};
                             text-decoration:${item.checked ? 'line-through' : 'none'};">
                    ${esc(item.text || '')}
                </span>
            `}
        </div>
    `;
};

// ── CHECKLIST OPERATIONS ───────────────────────────
export function _geAddChecklistItem(blockId) {
    const ht = OL._geGetHt();
    if (!ht) return;
    const block = (ht.blocks || []).find(b => b.id === blockId);
    if (!block) return;
    if (!block.data.items) block.data.items = [];
    const newItem = { id: 'cli-' + Date.now(), text: '', checked: false };
    block.data.items.push(newItem);
    OL.persist();

    const container = document.getElementById(`ge-cl-${blockId}`);
    if (container) {
        container.innerHTML = (block.data.items || [])
            .map((item, i) => OL._geRenderChecklistItem(blockId, item, i))
            .join('');
        if (window.lucide) lucide.createIcons();
        requestAnimationFrame(() => {
            const newInput = document.getElementById(`ge-cli-${newItem.id}`)
                ?.querySelector('input[type=text]');
            if (newInput) newInput.focus();
        });
    }
};

export function _geToggleChecklistItem(blockId, itemId, checked) {
    const ht = OL._geGetHt();
    const block = (ht?.blocks || []).find(b => b.id === blockId);
    const item = (block?.data?.items || []).find(i => i.id === itemId);
    if (item) { item.checked = checked; OL.persist(); }

    // Update styling without full re-render
    const row = document.getElementById(`ge-cli-${itemId}`);
    if (row) {
        const input = row.querySelector('input[type=text]');
        const span  = row.querySelector('span');
        const el = input || span;
        if (el) {
            el.style.color = checked ? 'var(--text-muted)' : 'var(--text-main)';
            el.style.textDecoration = checked ? 'line-through' : 'none';
        }
    }
};

export function _geUpdateChecklistItem(blockId, itemId, field, value) {
    const ht = OL._geGetHt();
    const block = (ht?.blocks || []).find(b => b.id === blockId);
    const item = (block?.data?.items || []).find(i => i.id === itemId);
    if (item) { item[field] = value; OL.persist(); }
};

export function _geDeleteChecklistItem(blockId, itemId) {
    const ht = OL._geGetHt();
    const block = (ht?.blocks || []).find(b => b.id === blockId);
    if (!block) return;
    block.data.items = (block.data.items || []).filter(i => i.id !== itemId);
    OL.persist();

    const container = document.getElementById(`ge-cl-${blockId}`);
    if (container) {
        container.innerHTML = (block.data.items || [])
            .map((item, i) => OL._geRenderChecklistItem(blockId, item, i))
            .join('');
        if (window.lucide) lucide.createIcons();
    }
};

// ── UPDATE BLOCK DATA ──────────────────────────────
export function _geUpdateBlockData(blockId, newData) {
    const ht = OL._geGetHt();
    const block = (ht?.blocks || []).find(b => b.id === blockId);
    if (!block) return;
    Object.assign(block.data, newData);
    OL.persist();

    // Re-render just this block's inner content
    const blockEl = document.getElementById(`ge-blk-${blockId}`);
    if (blockEl) {
        const inner = blockEl.querySelector('.ge-block-inner');
        if (inner) {
            inner.innerHTML = OL._geRenderBlockInner(block, OL._ge?.canEdit);
            if (window.lucide) lucide.createIcons();
        }
    }
};

// ── IMAGE PREVIEW REFRESH ──────────────────────────
export function _geRefreshImageBlock(blockId, url) {
    const preview = document.getElementById(`ge-img-preview-${blockId}`);
    if (!preview) return;
    preview.innerHTML = url
        ? `<img src="${esc(url)}" alt="" style="width:100%;border-radius:8px;border:1px solid var(--panel-border);display:block;">`
        : `<div style="background:var(--panel-soft);border:1px dashed var(--panel-border);border-radius:8px;padding:30px;text-align:center;color:var(--text-muted);font-size:12px;">No image URL set</div>`;
};

// ── VIDEO PREVIEW REFRESH ──────────────────────────
export function _geRefreshVideoPreview(url) {
    const preview = document.getElementById('ge-video-preview');
    if (!preview) return;
    preview.innerHTML = url ? OL.parseVideoEmbed(url) : '';
};

// ── APP PILLS ──────────────────────────────────────
export function _geRenderAppPills(ht) {
    const client = getActiveClient();
    const allApps = [...(state.master.apps || []), ...(client?.projectData?.localApps || [])];
    return (ht.appIds || []).map(appId => {
        const app = allApps.find(a => a.id === appId);
        if (!app) return '';
        return `
            <span style="display:inline-flex;align-items:center;gap:5px;padding:3px 8px;
                         border-radius:99px;font-size:10px;font-weight:600;
                         background:var(--accent-glow);color:var(--accent);
                         border:1px solid rgba(56,189,248,0.3);">
                ${esc(app.name)}
                <span onclick="OL.toggleHTApp('${ht.id}','${appId}');
                               document.getElementById('ge-app-pills').innerHTML=OL._geRenderAppPills(OL._geGetHt());
                               if(window.lucide)lucide.createIcons();"
                      style="opacity:0.5;cursor:pointer;font-size:12px;line-height:1;">×</span>
            </span>
        `;
    }).join('');
};

export function _geFilterAppSearch(htId, query) {
    const listEl = document.getElementById('ge-app-results');
    if (!listEl) return;
    const q = (query || '').toLowerCase();
    const client = getActiveClient();
    const ht = OL._geGetHt();
    const currentIds = ht?.appIds || [];
    const allApps = [...(state.master.apps || []), ...(client?.projectData?.localApps || [])];
    const matches = allApps.filter(a => a.name.toLowerCase().includes(q) && !currentIds.includes(a.id));

    listEl.innerHTML = matches.slice(0, 8).map(app => `
        <div class="search-result-item"
             onmousedown="OL.toggleHTApp('${htId}','${app.id}');
                          document.getElementById('ge-app-pills').innerHTML=OL._geRenderAppPills(OL._geGetHt());
                          if(window.lucide)lucide.createIcons();
                          document.getElementById('ge-app-results').innerHTML='';">
            ${esc(app.name)}
        </div>
    `).join('') || '<div class="search-result-item" style="opacity:0.5;">No matches</div>';
};

// ── RESOURCE SEARCH ────────────────────────────────
export function _geFilterResourceSearch(blockId, query) {
    const listEl = document.getElementById(`ge-res-results-${blockId}`);
    if (!listEl) return;
    const q = (query || '').toLowerCase();
    const client = getActiveClient();
    const resources = (client?.projectData?.resources || []).filter(r =>
        !r.isArchived && r.name.toLowerCase().includes(q)
    );

    listEl.innerHTML = resources.slice(0, 8).map(res => `
        <div class="search-result-item"
             onmousedown="OL._geSetResourceBlock('${blockId}', '${res.id}', '${esc(res.name)}')">
            ${esc(res.name)}
            <span style="font-size:9px;color:var(--text-muted);margin-left:6px;">${esc(res.type || '')}</span>
        </div>
    `).join('') || '<div class="search-result-item" style="opacity:0.5;">No resources found</div>';
};

export function _geSetResourceBlock(blockId, resId, resName) {
    const ht = OL._geGetHt();
    const block = (ht?.blocks || []).find(b => b.id === blockId);
    if (!block) return;

    const note = document.getElementById(`ge-res-note-${blockId}`)?.value || '';
    block.data = { resourceId: resId, resourceName: resName, note };
    OL.persist();

    // Re-render just this block
    const blockEl = document.getElementById(`ge-blk-${blockId}`);
    if (blockEl) {
        blockEl.innerHTML = (OL._ge?.canEdit ? `
            <div class="ge-block-controls" style="position:absolute;top:10px;right:10px;display:none;align-items:center;gap:4px;z-index:10;">
                <button onclick="OL._geDeleteBlock('${blockId}')"
                        style="width:24px;height:24px;border:1px solid rgba(239,68,68,0.3);background:rgba(239,68,68,0.06);border-radius:5px;cursor:pointer;color:#ef4444;display:flex;align-items:center;justify-content:center;">
                    <i data-lucide="trash-2" style="width:11px;height:11px;pointer-events:none;"></i>
                </button>
            </div>
        ` : '') + OL._geRenderBlockInner(block, OL._ge?.canEdit);
        if (window.lucide) lucide.createIcons();
    }
};

export function getProjectsSharingSOP(sopId) {
    return Object.values(state.clients || {}).filter(client => 
        (client.sharedMasterIds || []).includes(sopId)
    ).map(client => ({
        id: client.id,
        name: client.meta?.name || 'Unnamed Client'
    }));
};

export function openLocalHowToEditor() {
    const client = getActiveClient();
    if (!client) return;
    const draftId = 'draft-local-ht-' + Date.now();
    const draftHowTo = { id: draftId, name: '', summary: '', content: '', blocks: [], isDraft: true, isLocal: true };
    // Save draft first
    if (!client.projectData.localHowTo) client.projectData.localHowTo = [];
    client.projectData.localHowTo.push(draftHowTo);
    OL.openGuideEditor(draftId);
};

export function openHowToEditorModal() {
    const draftId = 'draft-ht-' + Date.now();
    const draftHowTo = { id: draftId, name: '', summary: '', content: '', blocks: [], isDraft: true };
    if (!state.master.howToLibrary) state.master.howToLibrary = [];
    state.master.howToLibrary.push(draftHowTo);
    OL.openGuideEditor(draftId);
};

export function promoteLocalSOPToMaster(localId) {
    const client = getActiveClient();
    const localSOP = client?.projectData?.localHowTo?.find(h => h.id === localId);

    if (!localSOP) return;
    if (!confirm(`Standardize "${localSOP.name}"? This will add it to the Global Vault for all future projects.`)) return;

    // 1. Create the Master Copy
    const masterId = 'ht-vlt-' + Date.now();
    const masterCopy = {
        ...JSON.parse(JSON.stringify(localSOP)), 
        id: masterId,
        scope: 'global',
        createdDate: new Date().toISOString()
    };

    // 2. Add to Global Library
    if (!state.master.howToLibrary) state.master.howToLibrary = [];
    state.master.howToLibrary.push(masterCopy);

    // 3. Remove Local copy and replace with Shared Master link
    client.projectData.localHowTo = client.projectData.localHowTo.filter(h => h.id !== localId);
    if (!client.sharedMasterIds) client.sharedMasterIds = [];
    client.sharedMasterIds.push(masterId);

    OL.persist();
    OL.closeModal();
    renderHowToLibrary(); // Refresh grid to show new status
    
    alert(`🚀 "${localSOP.name}" is now a Master Template!`);
};

export function renderHTRequirements(ht) {
    const requirements = ht.requirements || [];
    const masterFunctions = (state.master?.functions || []);
    const allGuides = (state.master.howToLibrary || []);

    return requirements.map((req, idx) => `
        <div class="dp-manager-row" style="flex-direction:column; gap:8px; background:rgba(var(--accent-rgb), 0.05); padding:12px; margin-bottom:10px; border-left:3px solid var(--accent);">
            <div style="display:flex; gap:10px; align-items:center;">
                <input type="text" class="modal-input tiny" style="flex:2;" placeholder="Action Name (e.g. Provide Login)" 
                       value="${esc(req.actionName || '')}" onblur="OL.updateHTReq('${ht.id}', ${idx}, 'actionName', this.value)">
                
                <select class="tiny-select" style="flex:1;" onchange="OL.updateHTReq('${ht.id}', ${idx}, 'targetId', this.value)">
                    <option value="">-- Target Function --</option>
                    ${masterFunctions.map(f => `<option value="${f.id}" ${req.targetId === f.id ? 'selected' : ''}>⚙️ ${esc(f.name)}</option>`).join('')}
                </select>
                <button class="card-delete-btn" style="position:static;" onclick="OL.removeHTRequirement('${ht.id}', ${idx})">×</button>
            </div>
            
            <div style="display:flex; gap:10px; align-items:center;">
                <select class="tiny-select" style="flex:1;" onchange="OL.updateHTReq('${ht.id}', ${idx}, 'clientGuideId', this.value)">
                    <option value="">-- Client Helper Guide (SOP) --</option>
                    ${allGuides.filter(g => g.id !== ht.id).map(g => `<option value="${g.id}" ${req.clientGuideId === g.id ? 'selected' : ''}>📖 ${esc(g.name)}</option>`).join('')}
                </select>
                <input type="text" class="modal-input tiny" style="flex:1;" placeholder="Instructions for client..." 
                       value="${esc(req.description || '')}" onblur="OL.updateHTReq('${ht.id}', ${idx}, 'description', this.value)">
            </div>
        </div>
    `).join('') || '<div class="empty-hint">No structured requirements defined.</div>';
}

// HOW TO AND APP OVERLAP
export function toggleHTApp(htId, appId) {
    const client = getActiveClient();
    let ht = state.master.howToLibrary.find(h => h.id === htId);
    
    if (!ht && client && client.projectData.localHowTo) {
        ht = client.projectData.localHowTo.find(h => h.id === htId);
    }

    if (!ht) return;
    
    if (!ht.appIds) ht.appIds = [];
    const idx = ht.appIds.indexOf(appId);
    
    if (idx === -1) ht.appIds.push(appId);
    else ht.appIds.splice(idx, 1);
    
    OL.persist();
    OL.openGuideEditor(htId);
};

export function filterHTAppSearch(htId, query) {
    const listEl = document.getElementById("ht-app-search-results");
    if (!listEl) return;
    const q = (query || "").toLowerCase();
    const client = getActiveClient();
    
    // 1. Resolve current guide (to avoid linking to itself)
    let currentHt = state.master.howToLibrary.find(h => h.id === htId) || 
                   (client?.projectData?.localHowTo || []).find(h => h.id === htId);

    const currentAppIds = currentHt ? (currentHt.appIds || []) : [];

    // 🚀 2. THE MERGE: Combine Global Master Apps/SOPs with Local Project Apps/SOPs
    const masterApps = state.master.apps || [];
    const localApps = client?.projectData?.localApps || [];
    const allAvailableApps = [...masterApps, ...localApps];

    // 3. Filter based on query and exclude what's already linked
    const matches = allAvailableApps.filter(a => 
        a.name.toLowerCase().includes(q) && 
        !currentAppIds.includes(a.id)
    );
    
    // 4. Render results
    listEl.innerHTML = matches.map(app => `
        <div class="search-result-item" onmousedown="OL.toggleHTApp('${htId}', '${app.id}')">
            ${String(app.id).includes('local') ? '📍' : '🏛️'} ${esc(app.name)}
        </div>
    `).join('') || '<div class="search-result-item muted">No matching items found</div>';
};

export function parseVideoEmbed(url) {
    if (!url) return "";
    
    // YouTube logic
    const ytMatch = url.match(/(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    if (ytMatch) return `<iframe width="100%" height="315" src="https://www.youtube.com/embed/${ytMatch[1]}" frameborder="0" allowfullscreen></iframe>`;
    
    // Loom logic
    const loomMatch = url.match(/(?:https?:\/\/)?(?:www\.)?loom\.com\/share\/([a-zA-Z0-9]+)/);
    if (loomMatch) return `<div style="position: relative; padding-bottom: 56.25%; height: 0;"><iframe src="https://www.loom.com/embed/${loomMatch[1]}" frameborder="0" webkitallowfullscreen mozallowfullscreen allowfullscreen style="position: absolute; top: 0; left: 0; width: 100%; height: 100%;"></iframe></div>`;

    // Vimeo logic
    const vimeoMatch = url.match(/(?:https?:\/\/)?(?:www\.)?vimeo\.com\/(\d+)/);
    if (vimeoMatch) return `<iframe src="https://player.vimeo.com/video/${vimeoMatch[1]}" width="100%" height="315" frameborder="0" allow="autoplay; fullscreen" allowfullscreen></iframe>`;

    return `<div class="p-10 tiny warn">Unrecognized video format. Please use Loom, YouTube, or Vimeo.</div>`;
};

// Toggle a resource ID in the guide's resourceIds array
export function toggleHTResource(htId, resId) {
    const client = getActiveClient();
    
    // 🚀 THE FIX: Find the target SOP in Master OR Local
    let ht = (state.master.howToLibrary || []).find(h => h.id === htId);
    if (!ht && client && client.projectData.localHowTo) {
        ht = client.projectData.localHowTo.find(h => h.id === htId);
    }

    if (!ht) return;
    
    if (!ht.resourceIds) ht.resourceIds = [];
    const idx = ht.resourceIds.indexOf(resId);
    
    if (idx === -1) {
        ht.resourceIds.push(resId);
    } else {
        ht.resourceIds.splice(idx, 1);
    }
    
    OL.persist(); // This will now save the modified object in whichever array it lives in
    OL.openGuideEditor(htId); 
};

// Filter the master resource library for the search dropdown
export function filterHTResourceSearch(htId, query) {
    const listEl = document.getElementById("ht-resource-search-results");
    if (!listEl) return;
    const q = (query || "").toLowerCase();
    const ht = (state.master.howToLibrary || []).find(h => h.id === htId);
    
    const availableResources = (state.master.resources || []).filter(res => 
        res.name.toLowerCase().includes(q) && 
        !(ht.resourceIds || []).includes(res.id)
    );
    
    listEl.innerHTML = availableResources.map(res => `
        <div class="search-result-item" onmousedown="OL.toggleHTResource('${htId}', '${res.id}')">
            🛠️ ${esc(res.name)}
        </div>
    `).join('') || '<div class="search-result-item muted">No resources found</div>';
};

// 4. HANDLE STATUS / EDITING
export function toggleSOPSharing(clientId, htId) {
    const client = state.clients[clientId];
    if (!client) return;

    const idx = client.sharedMasterIds.indexOf(htId);
    if (idx === -1) {
        client.sharedMasterIds.push(htId);
    } else {
        client.sharedMasterIds.splice(idx, 1);
    }

    OL.persist();
    renderResourceLibrary(); // Refresh view
};

// 5. HANDLE EDIT or REMOVE HOW TO

// 🚀 REAL-TIME SURGICAL SYNC
export function syncHowToName(htId, newName) {
    const cardTitles = document.querySelectorAll(`.ht-card-title-${htId}`);
    cardTitles.forEach(el => {
        el.innerText = newName;
    });
};

// UPDATED SAVE LOGIC
export function handleHowToSave(id, field, value) {
    const client = getActiveClient();
    const cleanVal = (typeof value === 'string') ? value.trim() : value;
    const isVaultMode = window.location.hash.includes('vault');
    
    // 1. Resolve Target
    let ht = state.master.howToLibrary.find(h => h.id === id);
    if (!ht && client) {
        ht = (client.projectData.localHowTo || []).find(h => h.id === id);
    }

    // 🚀 NEW: Initialize MASTER SOP if it's a new draft in the Vault
    if (!ht && isVaultMode && (id.startsWith('draft') || id.startsWith('vlt'))) {
        const newMaster = { 
            id: id, 
            name: "", 
            content: "", 
            category: "General",
            scope: "internal", // Default to internal/private
            appIds: [],
            resourceIds: []
        };
        state.master.howToLibrary.push(newMaster);
        ht = newMaster;
        renderHowToLibrary();
        console.log("🏛️ New Master SOP Initialized in Vault");
    }

    // 🚀 EXISTING: Initialize LOCAL SOP if it's a new local draft
    if (!ht && id.includes('local') && client) {
        if (!client.projectData.localHowTo) client.projectData.localHowTo = [];
        const newLocal = { 
            id: id, 
            name: "", 
            content: "", 
            category: "General",
            appIds: [],
            resourceIds: []
        };
        client.projectData.localHowTo.push(newLocal);
        ht = newLocal;
        renderHowToLibrary();
        console.log("📍 New Local SOP Initialized in Project Data");
    }

    if (ht) {
        ht[field] = cleanVal;

        // 🔒 TERMINOLOGY SYNC: If scope becomes internal, revoke client sharing
        if (field === 'scope' && cleanVal === 'internal') {
            Object.values(state.clients).forEach(c => {
                if (c.sharedMasterIds) {
                    c.sharedMasterIds = c.sharedMasterIds.filter(mid => mid !== id);
                }
            });
            console.log("🔒 Revoked sharing for internal guide.");
        }

        OL.persist();
        
        // 🔄 Surgical UI Sync for name
        if (field === 'name') {
            document.querySelectorAll(`.ht-card-title-${id}`).forEach(el => el.innerText = cleanVal || "New SOP");
        }
    } else {
        console.error("❌ SAVE FAILED: No SOP or Client Context found for ID:", id);
    }
};

export function deleteSOP(clientId, htId) {
    const isVaultView = window.location.hash.includes('vault');
    const isLocal = String(htId).includes('local');
    const client = state.clients[clientId];
    
    // 1. Backlink Check (Only for permanent deletes)
    if (isVaultView || isLocal) {
        const backlinks = OL.getSOPBacklinks(htId);
        if (backlinks.length > 0) {
            const resNames = [...new Set(backlinks.map(b => b.resName))].join(', ');
            if (!confirm(`⚠️ WARNING: This SOP is mapped to: ${resNames}.\n\nDeleting the SOURCE will break these links. Proceed?`)) return;
        }
    }

    // 2. Resolve Guide Name
    let guide;
    if (isLocal && client) {
        guide = (client.projectData.localHowTo || []).find(h => h.id === htId);
    } else {
        guide = (state.master.howToLibrary || []).find(h => h.id === htId);
    }
    if (!guide) return;

    // 3. Contextual Execution
    if (isVaultView) {
        // --- MASTER VAULT DELETE ---
        if (!confirm(`⚠️ PERMANENT VAULT DELETE: "${guide.name}"\n\nThis removes the source file for ALL projects. This cannot be undone.`)) return;
        
        state.master.howToLibrary = (state.master.howToLibrary || []).filter(h => h.id !== htId);
        // Scrub the ID from every single client's shared list
        Object.values(state.clients).forEach(c => {
            if (c.sharedMasterIds) c.sharedMasterIds = c.sharedMasterIds.filter(id => id !== htId);
        });
        console.log("🗑️ Master Source Deleted:", htId);

    } else if (isLocal) {
        // --- LOCAL PROJECT DELETE ---
        if (!confirm(`Delete local SOP "${guide.name}"?`)) return;
        if (client) {
            client.projectData.localHowTo = client.projectData.localHowTo.filter(h => h.id !== htId);
        }
        console.log("🗑️ Local SOP Deleted:", htId);

    } else {
        // --- MASTER UNLINK (Revoke Access) ---
        if (!confirm(`Remove "${guide.name}" from this project?\n\nThe guide will remain safe in your Master Vault.`)) return;
        if (client && client.sharedMasterIds) {
            client.sharedMasterIds = client.sharedMasterIds.filter(id => id !== htId);
        }
        console.log("🔒 Master SOP Unlinked from Client:", clientId);
    }

    // 4. Finalize
    OL.persist();
    renderHowToLibrary();
};

// 6. HANDLE SYNCING TO MASTER AND VICE VERSA
export function importHowToToProject() {
    const html = `
        <div class="modal-head">
            <div class="modal-title-text">📚 Link Master SOP</div>
            <div class="spacer"></div>
            <button class="btn small soft" onclick="OL.closeModal()">Cancel</button>
        </div>
        <div class="modal-body">
            <div class="search-map-container">
                <input type="text" class="modal-input" 
                       placeholder="Click to view guides..." 
                       onfocus="OL.filterMasterHowToImport('')"
                       oninput="OL.filterMasterHowToImport(this.value)" 
                       autofocus>
                <div id="master-howto-import-results" class="search-results-overlay" style="margin-top:10px;"></div>
            </div>
        </div>
    `;
    openModal(html);
};

export function filterMasterHowToImport(query) {
    const listEl = document.getElementById("master-howto-import-results");
    if (!listEl) return;

    const q = (query || "").toLowerCase().trim();
    const client = getActiveClient();
    const alreadyShared = client?.sharedMasterIds || [];

    const available = (state.master.howToLibrary || []).filter(ht => 
        ht.name.toLowerCase().includes(q) && !alreadyShared.includes(ht.id)
    );

    listEl.innerHTML = available.map(ht => `
        <div class="search-result-item" onmousedown="OL.toggleSOPSharing('${client.id}', '${ht.id}'); OL.closeModal();">
            📖 ${esc(ht.name)}
        </div>
    `).join('') || `<div class="search-result-item muted">No unlinked guides found.</div>`;
};

//=======================HOW-TO RESOURCES OVERLAP ====================//
export function getSOPBacklinks(sopId) {
    const client = getActiveClient();
    const allResources = [...(state.master.resources || []), ...(client?.projectData?.localResources || [])];
    const links = [];

    allResources.forEach(res => {
        // Check Triggers
        (res.triggers || []).forEach((trig, idx) => {
            if ((trig.links || []).some(l => String(l.id) === String(sopId))) {
                links.push({ resId: res.id, resName: res.name, context: 'Trigger', detail: trig.name });
            }
        });
        // Check Steps
        (res.steps || []).forEach(step => {
            if ((step.links || []).some(l => String(l.id) === String(sopId))) {
                links.push({ resId: res.id, resName: res.name, context: 'Step', detail: step.text });
            }
        });
    });
    return links;
};

//======================= HOW-TO TASKS OVERLAP ========================//

export function filterTaskHowToSearch(taskId, query, isVault) {
    const container = document.getElementById('task-howto-results');
    if (!container) return;
    container.style.cssText = '';
    document.body.classList.remove('is-visualizer');

    const client = getActiveClient();
    const q = (query || "").toLowerCase().trim();
    
    // 1. Resolve current task to find existing links
    const task = isVault 
        ? state.master.taskBlueprints.find(t => t.id === taskId)
        : client?.projectData?.clientTasks.find(t => t.id === taskId);
    
    const existingIds = task?.howToIds || [];

    // 2. Filter available guides (exclude existing)
    const results = (state.master.howToLibrary || []).filter(guide => {
        const matches = (guide.name || "").toLowerCase().includes(q);
        const alreadyLinked = existingIds.includes(guide.id);
        return matches && !alreadyLinked;
    });

    if (results.length === 0) {
        container.innerHTML = `<div class="search-result-item muted">No unlinked guides found.</div>`;
        return;
    }

    container.innerHTML = results.map(guide => `
        <div class="search-result-item is-clickable" 
             onmousedown="OL.toggleTaskHowTo(event, '${taskId}', '${guide.id}', ${isVault})">
            📖 ${esc(guide.name)}
        </div>
    `).join('');
};

export function toggleTaskHowTo(event, taskId, howToId, isVault) {
    if (event) event.stopPropagation();
    const client = getActiveClient();
    
    let task = isVault 
        ? state.master.taskBlueprints.find(t => t.id === taskId)
        : client?.projectData?.clientTasks.find(t => t.id === taskId);

    const guide = (state.master.howToLibrary || []).find(g => g.id === howToId);

    if (task && guide) {
        if (!task.howToIds) task.howToIds = [];
        const idx = task.howToIds.indexOf(howToId);
        
        if (idx === -1) {
            // 🚀 LINKING: Add ID and Sync Content
            task.howToIds.push(howToId);
            
            // Append Prework and Items Needed to the task description
            const syncNotice = `\n\n--- Linked SOP: ${guide.name} ---`;
            const itemsText = guide.itemsNeeded ? `\n📦 Items Needed: ${guide.itemsNeeded}` : "";
            const preworkText = guide.prework ? `\n⚡ Required Prework: ${guide.prework}` : "";
            
            task.description = (task.description || "") + syncNotice + itemsText + preworkText;
        } else {
            // UNLINKING: Remove ID
            task.howToIds.splice(idx, 1);
        }
        
        OL.persist();
        OL.openTaskModal(taskId, isVault); 
    }
};

// Add a new empty requirement object to a guide
export function addHTRequirement(htId) {
    const ht = (state.master.howToLibrary || []).find(h => h.id === htId);
    if (!ht) return;

    // Initialize the requirements array if it doesn't exist
    if (!ht.requirements) ht.requirements = [];

    // Push a new requirement structure
    ht.requirements.push({
        actionName: "",
        targetType: "function", // Default to function-based resolution
        targetId: "",           // Will hold the Function ID
        clientGuideId: "",      // Will hold the Helper SOP ID
        description: ""
    });

    OL.persist(); // Sync to storage
    OL.openGuideEditor(htId); // Refresh the modal to show the new row
};

export function updateHTReq(htId, index, field, value) {
    const ht = (state.master.howToLibrary || []).find(h => h.id === htId);
    if (!ht || !ht.requirements || !ht.requirements[index]) return;

    ht.requirements[index][field] = value;

    // We persist, but we don't necessarily need to re-open the modal 
    // for text inputs to avoid losing focus, unless it's a dropdown change.
    OL.persist();
    
    if (field === 'targetId' || field === 'clientGuideId') {
        OL.openGuideEditor(htId);
    }
};

// Remove a requirement from the list
export function removeHTRequirement(htId, index) {
    const ht = (state.master.howToLibrary || []).find(h => h.id === htId);
    if (!ht || !ht.requirements) return;

    ht.requirements.splice(index, 1);
    
    OL.persist();
    OL.openGuideEditor(htId);
};

// =========================HOW TO SCOPING OVERLAP=====================================
export function resolveRequirementTarget(requirement) {
    const client = getActiveClient();
    if (requirement.targetType === 'app') return requirement.targetId;

    if (requirement.targetType === 'function') {
        // Find the client's app that is the "Primary" for this function
        const localApps = client.projectData.localApps || [];
        const primaryApp = localApps.find(app => 
            app.functionIds?.some(m => (m.id === requirement.targetId && m.status === 'primary'))
        );
        return primaryApp ? primaryApp.id : null;
    }
    return null;
};

export function deployRequirementsFromResource(resourceId) {
    const client = getActiveClient();
    // Find the Master Guide linked to this Resource
    const guide = (state.master.howToLibrary || []).find(ht => (ht.resourceIds || []).includes(resourceId));
    
    if (!guide || !guide.requirements || guide.requirements.length === 0) return;

    guide.requirements.forEach(req => {
        // Resolve the target App by looking for the "Primary" mapping for the Function
        const targetAppId = OL.resolveRequirementTarget(req);
        const allApps = [...state.master.apps, ...(client.projectData.localApps || [])];
        const targetAppName = allApps.find(a => a.id === targetAppId)?.name || "System";

        const newTask = {
            id: 'tm-' + Date.now() + Math.random().toString(36).substr(2, 5),
            name: `${req.actionName || 'Requirement'} (${targetAppName})`,
            description: req.description || `Required for ${guide.name} implementation.`,
            status: "Pending",
            appIds: targetAppId ? [targetAppId] : [],
            howToIds: req.clientGuideId ? [req.clientGuideId] : [], // Attach the Helper Guide
            createdDate: new Date().toISOString()
        };

        if (!client.projectData.clientTasks) client.projectData.clientTasks = [];
        client.projectData.clientTasks.push(newTask);
    });
    
    OL.persist();
};


// ---- appended from "TASK RESOURCE OVERLAP" (never extracted the first
// time around) — SOP-to-resource linking, misnamed section header
// notwithstanding. The third function that used to live in this section,
// deployRequirementsFromResource, is NOT re-added here: it's a dead
// duplicate of the copy already above (the one that actually ran, being
// the later definition in the original file) — see the note near the
// top of this file's history for the same pattern as openImportHub.

export function filterResourceSOPLinker(resId, query) {
    const listEl = document.getElementById("res-sop-linker-results");
    if (!listEl) return;
    const q = (query || "").toLowerCase();

    const availableSOPs = (state.master.howToLibrary || []).filter(ht => {
        const isMatch = ht.name.toLowerCase().includes(q);
        const isNotLinked = !(ht.resourceIds || []).includes(resId);
        return isMatch && isNotLinked;
    });

    listEl.innerHTML = availableSOPs.map(sop => `
        <div class="search-result-item" onmousedown="OL.toggleSOPToResource('${sop.id}', '${resId}')">
            📖 ${esc(sop.name)}
        </div>
    `).join('') || '<div class="search-result-item muted">No unlinked SOPs found</div>';
}

export function toggleSOPToResource(sopId, resId) {
    const sop = state.master.howToLibrary.find(h => h.id === sopId);
    if (!sop) return;

    if (!sop.resourceIds) sop.resourceIds = [];
    const idx = sop.resourceIds.indexOf(resId);

    if (idx === -1) {
        sop.resourceIds.push(resId);
    } else {
        sop.resourceIds.splice(idx, 1);
    }

    persist();
    OL.openResourceModal(resId);
}

// ---- bridge: keep OL.*/window.* calls working until callers import directly ----
window.OL = window.OL || {};
Object.assign(window.OL, {
    filterResourceSOPLinker, toggleSOPToResource,
    openGuideEditor, closeGuideEditor, getProjectsSharingSOP, openLocalHowToEditor,
    openHowToEditorModal, promoteLocalSOPToMaster, toggleHTApp, filterHTAppSearch,
    parseVideoEmbed, toggleHTResource, filterHTResourceSearch, toggleSOPSharing,
    syncHowToName, handleHowToSave, deleteSOP, importHowToToProject,
    filterMasterHowToImport, getSOPBacklinks, filterTaskHowToSearch, toggleTaskHowTo,
    addHTRequirement, updateHTReq, removeHTRequirement, resolveRequirementTarget,
    deployRequirementsFromResource,
    _geOutsideClick, _geToggleBlockMenu, _geSaveField, _geGetHt, _geSaveBlocks,
    _geAddBlock, _geDeleteBlock, _geMoveBlock, _geRenderAllBlocks, _geRenderBlock,
    _geRenderBlockInner, _geRenderChecklistItem, _geAddChecklistItem,
    _geToggleChecklistItem, _geUpdateChecklistItem, _geDeleteChecklistItem,
    _geUpdateBlockData, _geRefreshImageBlock, _geRefreshVideoPreview,
    _geRenderAppPills, _geFilterAppSearch, _geFilterResourceSearch, _geSetResourceBlock
});
// Called bare from sections still living in app.js — bridge onto window.
window.renderHowToLibrary = renderHowToLibrary;
