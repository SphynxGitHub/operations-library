//======================= FEATURES / INTEGRATIONS =======================//
// Extracted from app.js "IMPORT ZAP AUDIT" section (unlabeled in the
// original — starts at the "// IMPORT ZAP AUDIT" comment and runs
// through the PDF/print export functions at the tail of the file, which
// were grouped in here since nothing else referenced them either).
// Owns: Zap JSON import, and external service syncs (Wealthbox, Jotform,
// Calendly, ActiveCampaign, MailerLite, YouCanBookMe, Redtail, Process
// Street), plus the Flow Map PDF export.
//
// NOTE: a genuine bug was found and fixed during this extraction — the
// original file had OL.openImportHub defined TWICE. The first (simpler)
// version was always silently overwritten by the second (with Redtail/
// Process Street) at runtime, so only the second was ever live. Keeping
// both here would be a hard SyntaxError in a real ES module (duplicate
// export), so the dead first definition was dropped — this changes
// nothing about actual behavior, since it never ran anyway.

import { state, esc, uid, getActiveClient, persist } from '../core/data.js';

//======================= CLICKUP CSV IMPORT =======================//
// One-way import of ClickUp tasks (+ comments + tracked time) from a
// CSV export. Uses the *Workspace* export (Settings > Import/Export >
// Export), not a plain List/Table view export — only the workspace
// export includes Comments and rolled-up Time Spent as columns.
// Column names aren't hardcoded: the user maps CSV columns to OL
// fields in the modal, since exports vary by workspace/custom fields.

function guessColumn(fields, candidates) {
    const lower = fields.map(f => f.toLowerCase());
    for (const c of candidates) {
        const idx = lower.indexOf(c.toLowerCase());
        if (idx > -1) return fields[idx];
    }
    for (const c of candidates) {
        const idx = lower.findIndex(f => f.includes(c.toLowerCase()));
        if (idx > -1) return fields[idx];
    }
    return '';
}

function parseClickUpTimeToHours(raw) {
    if (!raw) return 0;
    const s = String(raw).trim();
    if (!s) return 0;
    let m = s.match(/(\d+)\s*h(?:ours?)?\s*(?:(\d+)\s*m)?/i);
    if (m) {
        const h = parseInt(m[1], 10) || 0;
        const min = parseInt(m[2], 10) || 0;
        return +(h + min / 60).toFixed(2);
    }
    m = s.match(/^(\d+):(\d{2})$/);
    if (m) return +(parseInt(m[1], 10) + parseInt(m[2], 10) / 60).toFixed(2);
    const n = Number(s.replace(/,/g, ''));
    // ClickUp's raw/unformatted time fields are milliseconds.
    if (!isNaN(n)) return +(n / 3600000).toFixed(2);
    return 0;
}

function parseClickUpDate(raw) {
    if (!raw) return '';
    const s = String(raw).trim();
    if (!s) return '';
    if (/^\d+$/.test(s)) {
        const n = Number(s);
        const ms = s.length <= 10 ? n * 1000 : n; // seconds vs ms epoch
        const d = new Date(ms);
        if (!isNaN(d)) return d.toISOString().slice(0, 10);
    }
    const d = new Date(s);
    if (!isNaN(d)) return d.toISOString().slice(0, 10);
    return '';
}

function parseClickUpComments(raw) {
    if (!raw) return [];
    const s = String(raw).trim();
    if (!s) return [];
    try {
        const parsed = JSON.parse(s);
        if (Array.isArray(parsed)) {
            return parsed.map(c => (typeof c === 'string') ? { author: '', date: '', text: c } : {
                author: c.user || c.author || c.username || '',
                date: c.date || c.created || c.time || '',
                text: c.text || c.comment || c.content || JSON.stringify(c)
            });
        }
    } catch (e) { /* not JSON — fall through and keep it as one raw blob */ }
    return [{ author: '', date: '', text: s }];
}

function fieldSelectHTML(st, key, label) {
    const opts = ['<option value="">-- None --</option>']
        .concat(st.fields.map(f => `<option value="${esc(f)}" ${st.mapping[key] === f ? 'selected' : ''}>${esc(f)}</option>`));
    return `<div style="display:flex; flex-direction:column; gap:4px;">
        <label class="tiny muted bold">${label}</label>
        <select class="modal-input tiny" onchange="OL.setClickUpMapping('${key}', this.value)">${opts.join('')}</select>
    </div>`;
}

function renderRoutingMapTable(st) {
    const values = [...new Set(st.rows.map(r => (r[st.routingColumn] || '').trim()).filter(Boolean))];
    st.routingValues = values;
    const clients = Object.values(state.clients || {});
    return `
    <div style="margin-top:12px; display:grid; gap:6px; max-height:220px; overflow:auto;">
        ${values.map((v, i) => {
            if (st.routingMap[v] === undefined) {
                const guess = clients.find(c => {
                    const n = (c.meta?.name || '').toLowerCase();
                    return n && (n.includes(v.toLowerCase()) || v.toLowerCase().includes(n));
                });
                st.routingMap[v] = guess ? guess.id : '';
            }
            return `<div style="display:flex; align-items:center; gap:8px;">
                <span class="tiny" style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${esc(v)}">${esc(v)}</span>
                <select class="modal-input tiny" style="width:200px;" onchange="OL.setClickUpRoutingMapByIndex(${i}, this.value)">
                    <option value="">-- Skip --</option>
                    ${clients.map(c => `<option value="${c.id}" ${st.routingMap[v] === c.id ? 'selected' : ''}>${esc(c.meta?.name || 'Unnamed')}</option>`).join('')}
                </select>
            </div>`;
        }).join('')}
    </div>`;
}

function renderTargetSection(st) {
    const clients = Object.values(state.clients || {});
    const clientOptions = clients.map(c => `<option value="${c.id}" ${st.targetClientId === c.id ? 'selected' : ''}>${esc(c.meta?.name || 'Unnamed')}</option>`).join('');
    return `
    <div class="card" style="padding:14px; margin-top:16px;">
        <label class="tiny muted bold" style="display:block; margin-bottom:8px;">Where should these tasks go?</label>
        <label class="tiny" style="display:flex; align-items:center; gap:6px; margin-bottom:8px;">
            <input type="radio" name="cu-target-mode" value="single" ${st.targetMode === 'single' ? 'checked' : ''} onchange="OL.setClickUpTargetMode('single')">
            Import all rows into one project:
        </label>
        <select class="modal-input tiny" style="margin-left:22px; margin-bottom:10px; width: calc(100% - 22px);" onchange="OL.setClickUpTargetClient(this.value)" ${st.targetMode !== 'single' ? 'disabled' : ''}>
            <option value="">-- Select a client --</option>
            ${clientOptions}
        </select>
        <label class="tiny" style="display:flex; align-items:center; gap:6px;">
            <input type="radio" name="cu-target-mode" value="auto" ${st.targetMode === 'auto' ? 'checked' : ''} onchange="OL.setClickUpTargetMode('auto')">
            Auto-route by a column (e.g. List / Folder / Space name):
        </label>
        <select class="modal-input tiny" style="margin-left:22px; width: calc(100% - 22px);" onchange="OL.setClickUpRoutingColumn(this.value)" ${st.targetMode !== 'auto' ? 'disabled' : ''}>
            <option value="">-- Select column --</option>
            ${st.fields.map(f => `<option value="${esc(f)}" ${st.routingColumn === f ? 'selected' : ''}>${esc(f)}</option>`).join('')}
        </select>
        ${st.targetMode === 'auto' && st.routingColumn ? renderRoutingMapTable(st) : ''}
    </div>`;
}

export function openClickUpImportModal() {
    OL._clickupImportState = null;
    const html = `
        <div class="modal-head">
            <div class="modal-title-text">📥 Import ClickUp CSV</div>
            <button class="btn small soft" onclick="OL.closeModal()">Close</button>
        </div>
        <div class="modal-body" id="clickup-import-body">
            <p class="tiny muted" style="margin-bottom:14px;">
                In ClickUp, use the <strong>Workspace</strong> export (Settings → Import/Export → Export), not a plain List export —
                only the workspace export includes Comments and Time Spent as columns. Upload the CSV below.
            </p>
            <input type="file" id="clickup-csv-file" accept=".csv" class="modal-input tiny" onchange="OL.handleClickUpCSVFile(this)">
            <div id="clickup-import-preview" style="margin-top:16px;"></div>
        </div>
    `;
    openModal(html);
}

export function handleClickUpCSVFile(inputEl) {
    const file = inputEl.files?.[0];
    if (!file) return;
    if (typeof Papa === 'undefined') {
        alert('CSV parser did not load — refresh the page and try again.');
        return;
    }
    Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
            const fields = results.meta.fields || [];
            const rows = results.data || [];
            if (!rows.length) { alert('No rows found in that file.'); return; }
            OL._clickupImportState = {
                fileName: file.name,
                fields,
                rows,
                mapping: {
                    taskId: guessColumn(fields, ['Task ID', 'ID']),
                    title: guessColumn(fields, ['Task Name', 'Name']),
                    status: guessColumn(fields, ['Status']),
                    assignee: guessColumn(fields, ['Assignees', 'Assignee']),
                    dueDate: guessColumn(fields, ['Due Date']),
                    timeSpent: guessColumn(fields, ['Time Spent', 'Time Tracked', 'Time Logged']),
                    comments: guessColumn(fields, ['Comments']),
                    description: guessColumn(fields, ['Description', 'Task Content', 'Content']),
                    parentId: guessColumn(fields, ['Parent ID', 'Parent'])
                },
                routingColumn: '',
                routingMap: {},
                targetMode: 'single',
                targetClientId: state.activeClientId || ''
            };
            OL.renderClickUpImportStep();
        },
        error: (err) => alert('Could not read CSV: ' + err.message)
    });
}

export function renderClickUpImportStep() {
    const st = OL._clickupImportState;
    const container = document.getElementById('clickup-import-body');
    if (!container || !st) return;

    container.innerHTML = `
        <div class="tiny muted" style="margin-bottom:10px;">${esc(st.fileName)} — ${st.rows.length} rows detected</div>

        <div class="card" style="padding:14px;">
            <label class="tiny muted bold" style="display:block; margin-bottom:10px;">Map your CSV columns:</label>
            <div style="display:grid; grid-template-columns: repeat(2, 1fr); gap:10px;">
                ${fieldSelectHTML(st, 'title', 'Task Title *')}
                ${fieldSelectHTML(st, 'taskId', 'ClickUp Task ID (safe re-import)')}
                ${fieldSelectHTML(st, 'status', 'Status')}
                ${fieldSelectHTML(st, 'assignee', 'Assignee')}
                ${fieldSelectHTML(st, 'dueDate', 'Due Date')}
                ${fieldSelectHTML(st, 'timeSpent', 'Time Spent (Tracked Time)')}
                ${fieldSelectHTML(st, 'comments', 'Comments')}
                ${fieldSelectHTML(st, 'description', 'Description')}
                ${fieldSelectHTML(st, 'parentId', 'Parent Task ID (subtasks)')}
            </div>
        </div>

        ${renderTargetSection(st)}

        <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:18px;">
            <button class="btn small soft" onclick="OL.closeModal()">Cancel</button>
            <button class="btn small primary" onclick="OL.runClickUpImport()" style="font-weight:bold;">Run Import</button>
        </div>
    `;
    requestAnimationFrame(() => { if (window.lucide) lucide.createIcons(); });
}

export function setClickUpMapping(key, value) {
    if (!OL._clickupImportState) return;
    OL._clickupImportState.mapping[key] = value;
}

export function setClickUpTargetMode(mode) {
    if (!OL._clickupImportState) return;
    OL._clickupImportState.targetMode = mode;
    OL.renderClickUpImportStep();
}

export function setClickUpTargetClient(id) {
    if (!OL._clickupImportState) return;
    OL._clickupImportState.targetClientId = id;
}

export function setClickUpRoutingColumn(col) {
    if (!OL._clickupImportState) return;
    OL._clickupImportState.routingColumn = col;
    OL._clickupImportState.routingMap = {};
    OL.renderClickUpImportStep();
}

export function setClickUpRoutingMapByIndex(i, clientId) {
    const st = OL._clickupImportState;
    if (!st) return;
    const v = st.routingValues[i];
    st.routingMap[v] = clientId;
}

export async function runClickUpImport() {
    const st = OL._clickupImportState;
    if (!st) return;
    const m = st.mapping;
    if (!m.title) { alert('Please map a Task Title column.'); return; }
    if (st.targetMode === 'single' && !st.targetClientId) { alert('Please select a target client project.'); return; }
    if (st.targetMode === 'auto' && !st.routingColumn) { alert('Please select a routing column.'); return; }

    let created = 0, updated = 0, skipped = 0;
    const idMapByClient = {};      // clientId -> { clickupTaskId -> ourTaskId }
    const pendingParents = [];     // { clientId, ourTaskId, clickupParentId }

    st.rows.forEach(row => {
        let clientId = st.targetClientId;
        if (st.targetMode === 'auto') {
            const routeVal = (row[st.routingColumn] || '').trim();
            clientId = st.routingMap[routeVal] || '';
        }
        if (!clientId || !state.clients[clientId]) { skipped++; return; }

        const client = state.clients[clientId];
        if (!client.projectData) client.projectData = {};
        if (!client.projectData.clientTasks) client.projectData.clientTasks = [];

        const title = (row[m.title] || '').trim();
        if (!title) { skipped++; return; }

        const clickupId = m.taskId ? (row[m.taskId] || '').trim() : '';
        const externalId = clickupId ? `cu-${clickupId}` : '';

        const taskData = {
            title, name: title,
            assignee: m.assignee ? ((row[m.assignee] || '').split(',')[0].trim() || 'Sphynx Task') : 'Sphynx Task',
            dueDate: m.dueDate ? parseClickUpDate(row[m.dueDate]) : '',
            loggedHours: m.timeSpent ? parseClickUpTimeToHours(row[m.timeSpent]) : 0,
            clickupComments: m.comments ? parseClickUpComments(row[m.comments]) : [],
            description: m.description ? (row[m.description] || '').trim() : '',
            source: 'clickup'
        };
        const statusVal = m.status ? (row[m.status] || '').trim() : '';
        if (statusVal) taskData.status = statusVal;
        if (externalId) taskData.externalId = externalId;

        let taskObj;
        if (externalId) {
            const existingIdx = client.projectData.clientTasks.findIndex(t => t.externalId === externalId);
            if (existingIdx > -1) {
                taskObj = client.projectData.clientTasks[existingIdx];
                Object.assign(taskObj, taskData);
                updated++;
            } else {
                taskObj = { id: uid(), createdAt: new Date().toISOString(), isClientTask: false, ...taskData };
                client.projectData.clientTasks.push(taskObj);
                created++;
            }
        } else {
            taskObj = { id: uid(), createdAt: new Date().toISOString(), isClientTask: false, ...taskData };
            client.projectData.clientTasks.push(taskObj);
            created++;
        }

        if (clickupId) {
            if (!idMapByClient[clientId]) idMapByClient[clientId] = {};
            idMapByClient[clientId][clickupId] = taskObj.id;
        }

        const clickupParentId = m.parentId ? (row[m.parentId] || '').trim() : '';
        if (clickupParentId) pendingParents.push({ clientId, ourTaskId: taskObj.id, clickupParentId });
    });

    pendingParents.forEach(({ clientId, ourTaskId, clickupParentId }) => {
        const map = idMapByClient[clientId];
        const parentOurId = map && map[clickupParentId];
        if (parentOurId && parentOurId !== ourTaskId) {
            const client = state.clients[clientId];
            const t = client.projectData.clientTasks.find(t => t.id === ourTaskId);
            if (t) t.parentTaskId = parentOurId;
        }
    });

    await OL.persist();
    OL.closeModal();
    if (typeof window.renderClientTaskManager === 'function' && state.activeClientId) window.renderClientTaskManager();
    alert(`✅ ClickUp Import Complete\nCreated: ${created}\nUpdated: ${updated}\nSkipped (unmapped/blank): ${skipped}`);
}

export function processZapLogic(zap, isMaster = false) {
    const client = getActiveClient();
    const library = isMaster ? state.master.resources : client.projectData.localResources;
    const dataLibrary = isMaster ? state.master.datapoints : (client.projectData.localDatapoints || []);

    const transformedSteps = zap.steps.map((s, i) => {
        const cleanAppName = s.app ? s.app.split('@')[0].replace(/CLIAPI|V\d+|V\d+CLIAPI/g, '').replace(/([A-Z])/g, ' $1').trim() : "System";
        const stepLinks = [];
        const stepDatapoints = [];

        if (s.mappings) {
            s.mappings.forEach(m => {
                const fieldLower = (m.label || m.field || "").toLowerCase();
                const idFields = ['spreadsheet', 'folder', 'file', 'form', 'board', 'database'];

                // 🏗️ INFRASTRUCTURE DISCOVERY
                if (idFields.some(f => fieldLower.includes(f)) && m.value && !m.value.includes('{{')) {
                    let existingRes = library.find(r => r.externalUrl && r.externalUrl.includes(m.value));
                    if (!existingRes) {
                        let genUrl = fieldLower.includes('folder') ? `https://drive.google.com/drive/u/1/folders/${m.value}` : `https://docs.google.com/spreadsheets/d/${m.value}`;
                        existingRes = {
                            id: (isMaster ? 'res-vlt-' : 'local-prj-') + Date.now() + Math.random().toString(36).substr(2, 5),
                            name: `[Discovered] ${m.field}: ${m.value.substring(0, 8)}...`,
                            type: fieldLower.includes('folder') ? 'Folder' : 'Spreadsheet',
                            externalUrl: genUrl,
                            isGlobal: true, coords: null, stageId: null
                        };
                        library.push(existingRes);
                    }
                    stepLinks.push({ id: existingRes.id, name: existingRes.name, type: existingRes.type });
                }

                // 🏷️ DATA TAG DISCOVERY
                if (m.value && m.value.includes('{{')) {
                    const rawName = m.label || m.field || "Unknown";
                    const cleanName = rawName.replace(/_/g, ' ').trim();
                    let tag = dataLibrary.find(d => d.name.toLowerCase() === cleanName.toLowerCase());
                    if (!tag) {
                        tag = { id: 'dp-' + Date.now() + Math.random().toString(36).substr(2, 5), name: cleanName, category: 'Auto-Discovered' };
                        dataLibrary.push(tag);
                    }
                    if (!stepDatapoints.some(d => d.id === tag.id)) stepDatapoints.push(tag);
                }
            });
        }

        return {
            id: "step_" + Date.now() + "_" + i,
            name: s.title || "Untitled Step",
            appName: cleanAppName,
            assignees: (i === 0) ? [{ id: 'role-client', name: 'Any Client', type: 'role' }] : [{ id: 'zap-auto', name: 'Zapier', type: 'app' }],
            logic: { in: [], out: [] },
            links: stepLinks,
            datapoints: stepDatapoints
        };
    });

    return {
        id: (isMaster ? 'res-vlt-' : 'local-prj-') + Date.now() + Math.random().toString(36).substr(2, 5),
        type: 'Zap',
        archetype: 'Multi-Step',
        name: `⚡ ${zap.zapName}`,
        steps: transformedSteps,
        isExpanded: true
    };
};

export function bulkImportZaps(isMaster = false) {
    const activeId = state.activeClientId;
    const client = state.clients[activeId];
    if (!client && !isMaster) return alert("❌ No active project.");

    const zapierRobotMap = {
        "app115533": "Wealthbox",
        "app235438": "Orion",
        "app223706": "CurrentClient",
        "schedule": "Zapier Scheduler",
        "zapierlooping": "Zapier Looping",
        "filterapi": "Zapier Filter",
        "codeapi": "Zapier Code",
        "engineapi": "Zapier Engine",
        "storage": "Zapier Storage",
        "slackapi": "Slack",
        "googlemakersuite": "Google Maker Suite",
        "smsapi" : "Zapier SMS"
    };

    const projectApps = (client.projectData?.localApps || [])
        .sort((a, b) => {
            const nameA = typeof a === 'string' ? a : (a.name || a.label || "");
            const nameB = typeof b === 'string' ? b : (b.name || b.label || "");
            return nameB.length - nameA.length;
        });

    const library = isMaster ? state.master.resources : client.projectData.localResources;
    const destinationName = isMaster ? "MASTER VAULT" : `PROJECT: ${client.meta?.name}`;

    const rawData = prompt(`🔄 LOGIC-PRESERVING SYNC\nTarget: ${client.meta?.name}\n\nPaste JSON:`);
    if (!rawData) return;

    try {
        const zapArray = JSON.parse(rawData);
        
        zapArray.forEach((zapData) => {
            const stepIdMap = []; 

            // 1. PRE-CLEAN
            if (zapData.steps) {
                zapData.steps.forEach((step, sIdx) => {
                    let incoming = step.app.split('@')[0].replace(/CLIAPI|V\d+/g, '').toLowerCase().trim();
                    if (zapierRobotMap[incoming]) incoming = zapierRobotMap[incoming].toLowerCase();

                    const matchedApp = projectApps.find(pApp => {
                        const pName = typeof pApp === 'string' ? pApp : (pApp.name || pApp.label || "");
                        const pClean = pName.toLowerCase().replace(/\s/g, '');
                        return incoming === pClean || new RegExp(`\\b${incoming}\\b`, 'i').test(pName);
                    });

                    if (matchedApp) {
                        step.app = typeof matchedApp === 'string' ? matchedApp : matchedApp.name;
                        step.appId = typeof matchedApp === 'string' ? null : matchedApp.id;
                        stepIdMap[sIdx] = { name: step.app, id: step.appId };
                    }
                });
            }

            // 2. PROCESS LOGIC
            const processedZap = OL.processZapLogic(zapData, isMaster);
            
            // 3. RE-INJECT APP IDs
            processedZap.steps.forEach((pStep, pIdx) => {
                if (stepIdMap[pIdx]) {
                    pStep.appId = stepIdMap[pIdx].id;
                    pStep.appName = stepIdMap[pIdx].name;
                }
            });

            processedZap.originalZapId = zapData.zapId;
            processedZap.name = `⚡ ${zapData.zapName.replace(/^⚡\s*/, '').trim()}`;

            // 🎯 4. LOGIC & POSITION GRAFTING
            const existingIndex = library.findIndex(r => 
                r.type === 'Zap' && (String(r.originalZapId) === String(zapData.zapId) || r.name.toLowerCase() === processedZap.name.toLowerCase())
            );

            if (existingIndex !== -1) {
                const oldZap = library[existingIndex];
                
                // Copy Card Meta
                processedZap.id = oldZap.id; 
                processedZap.coords = oldZap.coords;
                processedZap.stageId = oldZap.stageId;
                processedZap.isGlobal = oldZap.isGlobal;
                processedZap.isTopShelf = oldZap.isTopShelf;
                processedZap._col = oldZap._col;

                // 🧠 DEEP STEP RECOVERY: Restore Logic Links and Data Tags
                processedZap.steps.forEach(newStep => {
                    // Find the matching step in the old version by name
                    const oldStep = (oldZap.steps || []).find(s => s.name === newStep.name);
                    
                    if (oldStep) {
                        // Restore the lines (Logic)
                        if (oldStep.logic) {
                            newStep.logic = JSON.parse(JSON.stringify(oldStep.logic));
                        }
                        // Restore the purple tags (Datapoints)
                        if (oldStep.datapoints) {
                            newStep.datapoints = JSON.parse(JSON.stringify(oldStep.datapoints));
                        }
                        // Restore internal ID so incoming links from other cards don't break
                        newStep.id = oldStep.id; 
                    }
                });

                library[existingIndex] = processedZap;
            } else {
                library.unshift(processedZap);
            }
        });

        // 5. Final UI Sync
        OL.syncLogicPorts(); // Forces all "Inbound" links to recalculate
        OL.persist();
        OL.renderVisualizer(isMaster);
        OL.renderWorkbenchItemsOnly();
        
        alert(`✅ Sync Complete! Positions, Connections (Logic), and Tags were preserved.`);
    } catch (e) {
        console.error("🔥 Sync Error:", e);
    }
};

export async function syncWealthbox(client) {
    // 1. Find Wealthbox Credentials in the Access Registry
    const registry = client.projectData.accessRegistry || [];
    const wbCreds = registry.find(r => {
        const app = client.projectData.localApps.find(a => a.id === r.appId);
        return app?.name.toLowerCase().includes('wealthbox');
    });

    if (!wbCreds || !wbCreds.secret) {
        throw new Error("Wealthbox API Key not found in Credentials section.");
    }

    const apiKey = wbCreds.secret;

    // 2. Fetch Workflow Templates from Wealthbox
    const cloudUrl = `https://us-central1-operations-library-d2fee.cloudfunctions.net/syncWealthboxProxy?apiKey=${apiKey}`;

    console.log("📡 Calling Firebase Middleman...");
    
    const response = await fetch(cloudUrl);

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Middleman Error: ${errorText}`);
    }
    
    const result = await response.json();
    const templates = result.workflow_templates || [];

    console.log(`📥 Wealthbox: Found ${templates.length} templates.`);

    // 3. Process each template into your Library
    templates.forEach(wf => {
        const resourceData = {
            id: `wb-${wf.id}`,
            externalId: wf.id,
            name: `🕸️ WB: ${wf.name}`,
            type: 'Workflow',  
            visible: true, 
            category: 'Flows',
            archetype: 'Multi-Level',
            
            // 🎯 TYPO FIXED: Was 'isExpannded'
            isExpanded: true, 

            steps: (wf.workflow_steps || []).map((s, idx) => ({
                id: `wb-step-${wf.id}-${idx}`,
                name: s.name,
                description: s.description || "",
                appName: 'Wealthbox'
            }))
        };

        // 🎯 ADD THIS: Register with the system so it "sticks"
        OL.upsertExternalResource(client, resourceData);
    
        // 🟢 Save to localResources
        if (!client.projectData.localResources) client.projectData.localResources = [];
        
        const idx = client.projectData.localResources.findIndex(r => r.id === resourceData.id);
        if (idx > -1) {
            client.projectData.localResources[idx] = resourceData;
        } else {
            client.projectData.localResources.push(resourceData);
        }
    });
    console.log(`✅ Wealthbox sync complete: ${templates.length} templates.`);

    // 🎯 THE STICKY FIX: 
    // We use a small timeout (100ms) to ensure the Data Layer is finished 
    // before we scream at the UI Layer to wake up.
    setTimeout(() => {
        const activeId = OL.state.activeClientId;
        const clientObj = OL.state.clients[activeId];
        
        // 1. Ensure the metadata is forced (matching your console logic)
        if (clientObj && clientObj.projectData.localResources) {
            clientObj.projectData.localResources.forEach(res => {
                if (res.name && res.name.includes('WB:')) {
                    res.type = 'Workflow';
                    res.visible = true;
                    res.category = 'Flows';
                }
            });
        }

        // 2. Reset Search State
        OL.state.libSearch = ""; 

        // 3. Trigger the internal filters
        if (typeof OL.syncResourceLibraryFilters === 'function') {
            OL.syncResourceLibraryFilters();
        }

        // 4. Force the render (Use BOTH potential names to be safe)
        if (typeof OL.renderResourceManager === 'function') {
            OL.renderResourceManager(clientObj);
        } else if (typeof OL.renderLibrary === 'function') {
            OL.renderLibrary(clientObj);
        }

        // 5. Force the HTML search bar to unlock
        const input = document.getElementById('lib-filter-input');
        if (input) {
            input.disabled = false;
            input.style.pointerEvents = 'auto';
            input.style.opacity = '1';
        }

        console.log("🔓 Search bar auto-unlocked via Timeout.");
    }, 100);

    return templates.length;
};


export function upsertExternalResource(client, data) {
    if (!client.projectData.localResources) client.projectData.localResources = [];
    const library = client.projectData.localResources;
    
    // 🎯 REFINED MATCHING LOGIC
    // We check: 1. External ID (Best), 2. Name Match, 3. Clean Name Match (ignoring icons)
    const existingIdx = library.findIndex(r => {
        const matchId = (r.externalId && data.externalId && String(r.externalId) === String(data.externalId));
        const matchExactName = r.name.toLowerCase() === data.name.toLowerCase();
        
        // Handle "Imported" prefixes (e.g., matching "My Form" with "📄 Form: My Form")
        const cleanR = r.name.toLowerCase().replace(/^(📅 cal:|📄 form:|📧 ac:|🕸️ wb:)\s*/, '').trim();
        const cleanD = data.name.toLowerCase().replace(/^(📅 cal:|📄 form:|📧 ac:|🕸️ wb:)\s*/, '').trim();
        const matchCleanName = cleanR === cleanD;

        return matchId || matchExactName || matchCleanName;
    });

    if (existingIdx !== -1) {
        const old = library[existingIdx];
        console.log(`♻️ Grafting update onto: ${old.name}`);
        
        // 🧠 DEEP STEP PRESERVATION
        // If the imported data has steps, we try to preserve local edits (like descriptions or logic)
        if (data.steps && old.steps) {
            data.steps.forEach(newStep => {
                const oldStep = old.steps.find(os => os.name === newStep.name);
                if (oldStep) {
                    // Carry over logic and user-written descriptions from the existing card
                    newStep.logic = oldStep.logic || { in: [], out: [] };
                    newStep.description = oldStep.description || newStep.description;
                    newStep.id = oldStep.id; // Keep internal ID to prevent line breakage
                }
            });
        }

        // 🧬 UPDATE OBJECT
        library[existingIdx] = { 
            ...old, 
            ...data, 
            id: old.id,           // Never change the system ID
            coords: old.coords,   // Keep on Map
            stageId: old.stageId, // Keep in Lane
            layoutCol: old.layoutCol, // Keep in Column
            isGlobal: old.isGlobal,
            isExpanded: old.isExpanded ?? true
        };
    } else {
        // ✨ NEW DISCOVERY: Assign a formatted ID based on type
        console.log(`✨ New asset discovered: ${data.name}`);
        const prefix = data.id?.split('-')[0] || 'ext';
        data.id = `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
        
        // Initial setup for the Workbench
        data.isGlobal = true; 
        data.isExpanded = true;
        
        library.push(data);
    }
};

// 📡 THE SYNC ORCHESTRATOR
export async function syncExternalIntegrations(serviceKey) {
    const client = getActiveClient();
    if (!client) return alert("❌ No active project selected.");

    const btn = event?.target;
    const originalText = btn ? btn.innerText : "";
    if (btn) { btn.innerText = "⏳ Syncing..."; btn.disabled = true; }

    try {
        console.group(`📡 Syncing: ${serviceKey}`);
        let count = 0;

        switch(serviceKey) {
            case 'wealthbox':
                count = await OL.syncWealthbox(client);
                break;
            case 'jotform':
                count = await OL.importJotform(client);
                break;
            case 'calendly':
                count = await OL.importCalendly(client);
                break;
            case 'activecampaign':
                count = await OL.importActiveCampaign(client);
                break;
            case 'mailerlite':
                count = await OL.importMailerLite(client);
                break;
            case 'ycbm':
                count = await OL.importYCBM(client);
                break;
            case 'redtail': // 🎯 ADDED
                count = await OL.syncRedtail(client);
                break;
            case 'processstreet': // 🎯 ADDED
            case 'process-street':
                count = await OL.syncProcessStreet(client);
                break;
        }

        await OL.persist();
        if (window.location.hash.includes('visualizer')) OL.renderVisualizer();
        alert(`✅ Sync Successful!\n- ${serviceKey.toUpperCase()}: ${count} items updated.`);

    } catch (e) {
        console.error(`🔥 ${serviceKey} Sync Error:`, e);
        alert(`Sync Failed: ${e.message}`);
    } finally {
        if (btn) { btn.innerText = originalText; btn.disabled = false; }
        console.groupEnd();
    }
};

export function openImportHub() {
    const html = `
        <div class="modal-head">
            <div class="modal-title-text">🔌 System Importer Hub</div>
            <button class="btn small soft" onclick="OL.closeModal()">Close</button>
        </div>
        <div class="modal-body">
            <p class="tiny muted" style="margin-bottom: 20px;">
                Select a service to sync live data into your Workbench.
            </p>
            
            <div class="cards-grid" style="grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 15px;">
                
                <div class="card is-clickable import-card" onclick="OL.syncExternalIntegrations('wealthbox')">
                    <div style="font-size: 24px; margin-bottom: 10px;">🕸️</div>
                    <div class="bold">Wealthbox</div>
                    <div class="tiny muted">Sync Workflows</div>
                </div>

                <div class="card is-clickable import-card" onclick="OL.syncExternalIntegrations('jotform')">
                    <div style="font-size: 24px; margin-bottom: 10px;">📄</div>
                    <div class="bold">Jotform</div>
                    <div class="tiny muted">Sync Active Forms</div>
                </div>

                <div class="card is-clickable import-card" onclick="OL.syncExternalIntegrations('calendly')">
                    <div style="font-size: 24px; margin-bottom: 10px;">📅</div>
                    <div class="bold">Calendly</div>
                    <div class="tiny muted">Sync Event Types</div>
                </div>

                <div class="card is-clickable import-card" onclick="OL.syncExternalIntegrations('activecampaign')">
                    <div style="font-size: 24px; margin-bottom: 10px;">📧</div>
                    <div class="bold">ActiveCampaign</div>
                    <div class="tiny muted">Sync Automations</div>
                </div>

                <div class="card is-clickable import-card" onclick="OL.syncExternalIntegrations('mailerlite')">
                    <div style="font-size: 24px; margin-bottom: 10px;">⚡</div>
                    <div class="bold">MailerLite</div>
                    <div class="tiny muted">Sync Sequences</div>
                </div>

                <div class="card is-clickable import-card" onclick="OL.syncExternalIntegrations('ycbm')">
                    <div style="font-size: 24px; margin-bottom: 10px;">🗓️</div>
                    <div class="bold">YouCanBook.me</div>
                    <div class="tiny muted">Sync Booking Profiles</div>
                </div>

                <div class="card is-clickable import-card" onclick="OL.syncRedtail(OL.activeClient)">
                    <div style="font-size: 24px; margin-bottom: 10px;">🔴</div>
                    <div class="bold">Redtail</div>
                    <div class="tiny muted">Sync CRM Workflows</div>
                </div>
                
                <div class="card is-clickable import-card" onclick="OL.syncExternalIntegrations('processstreet')">
                    <div style="font-size: 24px; margin-bottom: 10px;">🏁</div>
                    <div class="bold">Process Street</div>
                    <div class="tiny muted">Sync Checklists</div>
                </div>

                <div class="card is-clickable import-card" onclick="OL.openClickUpImportModal()">
                    <div style="font-size: 24px; margin-bottom: 10px;">✅</div>
                    <div class="bold">ClickUp</div>
                    <div class="tiny muted">Import Tasks (CSV)</div>
                </div>

            </div>
        </div>
    `;
    openModal(html);
};

export async function importCalendly(client) {
    const creds = OL.getCredsForApp(client, 'calendly');
    if (!creds?.secret) throw new Error("Calendly API Key missing in Credentials (Secret field).");

    // 🎯 The exact URL you provided
    const url = `https://us-central1-operations-library-d2fee.cloudfunctions.net/calendlyProxy?apiKey=${creds.secret}`;

    console.log("📡 Fetching from Calendly Proxy...");
    const response = await fetch(url);

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`Proxy Error: ${err}`);
    }

    const data = await response.json();
    const events = data.collection || [];

    events.forEach(ev => {
        const externalId = ev.uri.split('/').pop(); 
        
        OL.upsertExternalResource(client, {
            id: `cal-${externalId}`,
            externalId: externalId,
            name: `📅 Cal: ${ev.name}`,
            type: 'Event',
            externalUrl: ev.scheduling_url,
            description: ev.description || "Calendly Event Type",
            steps: [{ 
                id: uid(), 
                name: "Client Schedules Appointment", 
                appName: "Calendly" 
            }]
        });
    });

    return events.length;
};

export async function importYCBM(client) {
    const creds = OL.getCredsForApp(client, 'youcanbookme');
    if (!creds?.secret) throw new Error("YCBM API Key missing in App Credentials.");

    // 1. Get the email from the username field, or prompt the user
    let email = creds.username;
    if (!email || email.trim() === "") {
        email = prompt("Please enter your YouCanBookMe account email:");
        if (!email) return 0; // User cancelled

        // Optional: Save it back to the project so it's remembered
        creds.username = email.trim();
        OL.persist(); 
    }

    let authKey = creds.secret;

    // 2. Encode to Base64 (email:api_key)
    // We check if it's already encoded; if it starts with 'ak_', it definitely isn't.
    if (authKey.startsWith('ak_')) {
        authKey = btoa(`${email.trim()}:${authKey.trim()}`);
    }

    const url = `https://us-central1-operations-library-d2fee.cloudfunctions.net/ycbmProxy?apiKey=${authKey}`;

    console.log("📡 Fetching from YCBM Proxy...");
    const response = await fetch(url);
    
    if (!response.ok) {
        const err = await response.text();
        throw new Error(`YCBM Error: ${err}`);
    }

    const profiles = await response.json();
    
    profiles.forEach(p => {
        OL.upsertExternalResource(client, {
            externalId: p.id,
            name: `🗓️ YCBM: ${p.title}`,
            type: 'Event',
            externalUrl: `https://${p.subdomain}.youcanbook.me`,
            steps: [{ id: uid(), name: "Customer Schedules via YCBM", appName: "YouCanBookMe" }]
        });
    });

    return profiles.length;
};

export async function importActiveCampaign(client) {
    const creds = OL.getCredsForApp(client, 'activecampaign');
    if (!creds?.secret) throw new Error("ActiveCampaign API Key missing in Secret field.");

    // 1. Handle the Base URL (Prompt if missing)
    let baseUrl = creds.username; // We'll store the URL in the 'username' slot
    if (!baseUrl || !baseUrl.includes('http')) {
        baseUrl = prompt("Please enter your ActiveCampaign API URL (e.g., https://accountname.api-us1.com):");
        if (!baseUrl) return 0;
        
        // Sanitize: remove trailing slashes
        baseUrl = baseUrl.trim().replace(/\/$/, "");
        creds.username = baseUrl;
        OL.persist();
    }

    // 2. Use your Firebase v2 Proxy
    // 🎯 REPLACE 'acproxy-xxx' with your actual Firebase URL from the console
    const proxyUrl = `https://us-central1-operations-library-d2fee.cloudfunctions.net/acProxy`; 
    const finalUrl = `${proxyUrl}/?apiKey=${creds.secret}&baseUrl=${encodeURIComponent(baseUrl)}`;

    console.log("📡 Syncing ActiveCampaign Automations...");
    const response = await fetch(finalUrl);
    
    if (!response.ok) {
        const errTxt = await response.text();
        throw new Error(`AC Proxy Error: ${errTxt}`);
    }

    const data = await response.json();
    const autos = data.automations || [];

    autos.forEach(auto => {
        OL.upsertExternalResource(client, {
            id: `ac-${auto.id}`,
            externalId: auto.id,
            name: `📧 AC: ${auto.name}`,
            type: 'Email Campaign',
            archetype: 'Multi-Level',
            steps: [
                { id: uid(), name: "Trigger: " + (auto.enter_trigger || "Start"), appName: "ActiveCampaign" },
                { id: uid(), name: "Automation Flow Sequence", appName: "ActiveCampaign" }
            ]
        });
    });

    return autos.length;
};

export async function importMailerLite(client) {
    const creds = OL.getCredsForApp(client, 'mailerlite');
    if (!creds?.secret) throw new Error("MailerLite API Key missing.");

    const url = `https://us-central1-operations-library-d2fee.cloudfunctions.net/mailerliteProxy?apiKey=${creds.secret}`;
    const response = await fetch(url);
    const data = await response.json();
    const automations = data.data || [];

    automations.forEach(auto => {
        OL.upsertExternalResource(client, {
            externalId: auto.id,
            name: `📧 ML: ${auto.name}`,
            type: 'Email Campaign',
            archetype: 'Multi-Level',
            steps: [
                { id: uid(), name: "Trigger: " + (auto.trigger_type || "Subscriber Joins"), appName: "MailerLite" },
                { id: uid(), name: "Automation Flow", appName: "MailerLite" }
            ]
        });
    });
    return automations.length;
};

export async function importJotform(client) {
    const creds = OL.getCredsForApp(client, 'jotform');
    if (!creds?.secret) throw new Error("Jotform API Key missing.");

    // Ensure the URL is EXACT
    const url = `https://us-central1-operations-library-d2fee.cloudfunctions.net/jotformProxy?apiKey=${creds.secret}`;

    try {
        const response = await fetch(url, {
            method: 'GET',
            mode: 'cors', // Explicitly ask for CORS
            headers: { 'Accept': 'application/json' }
        });

        if (!response.ok) {
            const errTxt = await response.text();
            throw new Error(`Jotform Proxy Error (${response.status}): ${errTxt}`);
        }

        const data = await response.json();
        const forms = data.content || data.data || (Array.isArray(data) ? data : []);

        forms.forEach(form => {
            OL.upsertExternalResource(client, {
                id: `jf-${form.id}`,
                externalId: form.id,
                name: `📄 Form: ${form.title}`,
                type: 'Form',
                externalUrl: `https://www.jotform.com/form/${form.id}`,
                steps: [{ id: uid(), name: "User Submits Form", appName: "Jotform" }]
            });
        });
        return forms.length;
    } catch (err) {
        console.error("Fetch Interruption:", err);
        throw err;
    }
};

export async function syncProcessStreet(client) {
    console.log("🚀 Starting Process Street v1.1 Sync...");
    const targetClient = client || OL.state.clients[OL.state.activeClientId];
    
    try {
        const registry = targetClient.projectData.accessRegistry || [];
        const psCreds = registry.find(r => {
            const app = targetClient.projectData.localApps.find(a => a.id === r.appId);
            const name = app?.name || "";
            return name.toLowerCase().includes('processstreet') || name.toLowerCase().includes('process street');
        });

        if (!psCreds?.secret) {
            alert("Missing Process Street API Key in Registry.");
            return;
        }

        let allWorkflows = [];
        // The API defaults to 20 results and uses a 'links' object for the next page
        let nextUrl = `https://us-central1-operations-library-d2fee.cloudfunctions.net/processStreetProxy?apiKey=${psCreds.secret}`;

        console.log("📡 Fetching Workflows...");

        while (nextUrl) {
            const res = await fetch(nextUrl);
            const data = await res.json();
            
            // 🎯 THE FIX: v1.1 uses 'workflows' instead of 'items'
            const pageWorkflows = data.workflows || [];
            allWorkflows = allWorkflows.concat(pageWorkflows);
            
            console.log(`📥 Received ${pageWorkflows.length} workflows...`);

            // Check for pagination in the 'links' section
            const nextLink = data.links?.find(l => l.rel === 'next' || l.name === 'next');
            if (nextLink && nextLink.href) {
                // Construct the next proxy URL
                nextUrl = `https://us-central1-operations-library-d2fee.cloudfunctions.net/processStreetProxy?apiKey=${psCreds.secret}&next=${encodeURIComponent(nextLink.href)}`;
            } else {
                nextUrl = null;
            }
        }

        console.log(`✅ Total Collected: ${allWorkflows.length} workflows.`);

        if (allWorkflows.length === 0) {
            alert("Process Street returned 0 workflows. Verify your account has 'Active' workflows.");
            return;
        }

        // 🧹 Wipe and Rebuild
        targetClient.projectData.localResources = (targetClient.projectData.localResources || [])
            .filter(r => !r.id.startsWith('ps-'));

        allWorkflows.forEach((wf, i) => {
            targetClient.projectData.localResources.push({
                id: `ps-workflow-${wf.id}-${i}`,
                externalId: wf.id,
                name: `🏁 PS: ${wf.name}`,
                type: 'Checklist',
                visible: true,
                category: 'Flows',
                isExpanded: true,
                steps: [] // We can fetch tasks later if needed
            });
        });

        if (typeof OL.persist === 'function') OL.persist();

        setTimeout(() => {
            const activeId = OL.state.activeClientId;
            if (OL.state.clients[activeId]) {
                OL.state.clients[activeId].projectData.localResources = targetClient.projectData.localResources;
            }
            if (typeof OL.syncResourceLibraryFilters === 'function') OL.syncResourceLibraryFilters();
            if (typeof OL.renderResourceManager === 'function') OL.renderResourceManager(targetClient);
        }, 300);

        alert(`🎉 Success! Synced ${allWorkflows.length} Process Street workflows.`);

    } catch (e) {
        console.error("🔥 PS v1.1 Sync Error:", e);
        alert("Sync Failed: " + e.message);
    }
};

// Renamed to 'syncRedtail' to break the cache
export async function syncRedtail(client) {
    const targetClient = client || OL.state.clients[OL.state.activeClientId];
    if (!targetClient || !targetClient.projectData) return;

    try {
        const registry = targetClient.projectData.accessRegistry || [];
        const rtCreds = registry.find(r => {
            const app = targetClient.projectData.localApps.find(a => a.id === r.appId);
            return app?.name.toLowerCase().includes('redtail');
        });

        if (!rtCreds || !rtCreds.secret) throw new Error("Credentials missing.");

        const authString = rtCreds.secret;
        let allTemplates = [];
        let currentPage = 1;
        let totalPages = 1;

        console.log("📡 Starting Paginated Sync...");

        // 🎯 THE PAGINATION LOOP
        do {
            const url = `https://us-central1-operations-library-d2fee.cloudfunctions.net/redtailProxy?apiKey=${encodeURIComponent(authString)}&page=${currentPage}`;
            
            const response = await fetch(url);
            const result = await response.json();
            
            const pageTemplates = result.workflow_templates || [];
            allTemplates = allTemplates.concat(pageTemplates);
            
            // Update total pages from the API response
            totalPages = result.total_pages || 1;
            console.log(`📥 Received Page ${currentPage} of ${totalPages} (${pageTemplates.length} items)`);
            
            currentPage++;
        } while (currentPage <= totalPages);

       console.log(`✅ Total Templates Collected: ${allTemplates.length}`);

        // 1. Clear out old Redtail entries first to start fresh
        if (!targetClient.projectData.localResources) targetClient.projectData.localResources = [];
        targetClient.projectData.localResources = targetClient.projectData.localResources.filter(r => !r.id.startsWith('rt-'));

        console.log("🧹 Cleared old Redtail references. Re-building from 61 items...");

        allTemplates.forEach((wf, index) => {
            // 🎯 THE FIX: Force a unique ID using the Redtail ID + Index
            // This prevents the system from "merging" 61 items into 3.
            const uniqueId = `rt-workflow-${wf.id || index}-${index}`;

            const resourceData = {
                id: uniqueId,
                externalId: wf.id,
                name: `🔴 RT: ${wf.name}`,
                type: 'Workflow',
                visible: true,
                category: 'Flows',
                isExpanded: true,
                workflowId: null,
                archetype: 'Multi-Level',
                steps: [{ id: `step-${uniqueId}`, name: "Workflow Template", appName: 'Redtail' }]
            };

            // 🟢 Push directly to the array - bypassing any 'upsert' logic that might be bugged
            targetClient.projectData.localResources.push(resourceData);
        });

        console.log(`💾 Array count before persist: ${targetClient.projectData.localResources.length}`);

        // 🎯 THE LOCK: Ensure the system writes this array to the DB
        if (typeof OL.persist === 'function') OL.persist();

        // 🎯 UI RECOVERY: Force the render
        setTimeout(() => {
            if (typeof OL.syncResourceLibraryFilters === 'function') OL.syncResourceLibraryFilters();
            
            if (typeof OL.renderResourceManager === 'function') {
                OL.renderResourceManager(targetClient);
            }
            
            // Final Verification Check
            const finalCount = targetClient.projectData.localResources.filter(r => r.id.startsWith('rt-')).length;
            console.log(`🏁 Final verification: ${finalCount} Redtail items in memory.`);
            
            if(finalCount < 61) {
                console.error("⚠️ ALERT: Something is still stripping the array during persist!");
            }
        }, 300);
        
    } catch (e) {
        console.error("🔥 Sync Failed:", e);
    }
};

export function getCredsForApp(client, appSlug) {
    // 🎯 SAFETY CHECK: If projectData is missing, the app isn't initialized
    if (typeof projectData === 'undefined' || !projectData) {
        console.error("❌ Database not loaded. Please wait a second and try again.");
        return null;
    }
    
    if (!client || !client.externalIntegrations) return null;
    return client.externalIntegrations.find(i => i.appSlug === appSlug);
};

export function printFlowMap(view) {
    const client = getActiveClient();
    const data   = OL.getCurrentProjectData();
    const stages    = data.stages || [];
    const resources = (data.resources || []).filter(r => !r.isDeleted && !r.isLocked && !r.isArchived);
    const workflows = data.workflows || [];

    const clientName = client?.meta?.name || 'Flow Map';
    const viewLabel  = { flowchart: 'Swimlanes', list: 'List', steps: 'Steps' }[view] || view;
    const date       = new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });

    let bodyHtml = '';

    if (view === 'flowchart') {
        bodyHtml = OL._printFlowchartHtml(stages, resources, workflows);
    } else if (view === 'list') {
        bodyHtml = OL._printListHtml(stages, resources, workflows);
    } else if (view === 'steps') {
        bodyHtml = OL._printStepsHtml(stages, resources, workflows);
    }

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${clientName} — Flow Map (${viewLabel})</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Inter', -apple-system, sans-serif; font-size: 11px;
       color: #1b2d3f; background: #fff; padding: 32px; }

/* ── HEADER ── */
.print-header { display: flex; justify-content: space-between; align-items: flex-end;
                border-bottom: 2px solid #0f172a; padding-bottom: 12px; margin-bottom: 28px; }
.print-header-title { font-size: 20px; font-weight: 800; color: #0f172a; }
.print-header-sub { font-size: 11px; color: #64748b; margin-top: 3px; }
.print-header-meta { text-align: right; font-size: 10px; color: #94a3b8; }

/* ── STAGE HEADER ── */
.stage-header { display: flex; align-items: center; gap: 8px;
                margin: 28px 0 12px; padding-bottom: 8px;
                border-bottom: 1.5px solid #e5e7eb; }
.stage-num { width: 22px; height: 22px; border-radius: 5px; background: #3dd9c5;
             color: #fff; font-size: 10px; font-weight: 800;
             display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.stage-name { font-size: 13px; font-weight: 700; color: #0f172a; }
.stage-count { font-size: 10px; color: #94a3b8; margin-left: auto; }

/* ── WORKFLOW LABEL ── */
.wf-label { display: flex; align-items: center; gap: 6px;
            margin: 12px 0 8px; padding: 4px 0; }
.wf-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.wf-name { font-size: 10px; font-weight: 700; text-transform: uppercase;
           letter-spacing: 0.06em; color: #6b7280; }

/* ── SWIMLANES VIEW ── */
.swimlane-cards { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }

.resource-card { width: 220px; border: 1px solid #e5e7eb; border-radius: 10px;
                 overflow: hidden; page-break-inside: avoid; break-inside: avoid;
                 background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
.card-accent { height: 4px; width: 100%; }
.card-body { padding: 9px 11px 10px; }
.card-type-row { display: flex; align-items: center; gap: 5px; margin-bottom: 5px; }
.card-type-badge { padding: 1px 5px; border-radius: 3px; font-size: 8px;
                   font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; }
.card-name { font-size: 11px; font-weight: 700; color: #0f172a;
             line-height: 1.35; margin-bottom: 6px; }
.card-meta { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 5px; }
.card-meta-pill { font-size: 9px; padding: 1px 6px; border-radius: 99px;
                  background: #f1f5f9; color: #475569; border: 1px solid #e2e8f0; }
.card-steps { border-top: 1px solid #f1f5f9; margin-top: 6px; padding-top: 5px; }
.card-step { display: flex; align-items: flex-start; gap: 5px;
             padding: 3px 0; font-size: 9px; color: #374151; }
.card-step-num { width: 14px; height: 14px; border-radius: 99px; background: #f1f5f9;
                 font-size: 8px; font-weight: 700; color: #94a3b8; display: flex;
                 align-items: center; justify-content: center; flex-shrink: 0; }
.card-step-name { flex: 1; line-height: 1.3; }
.card-step-app { font-size: 8px; color: #0284c7; }
.card-step-logic { font-size: 8px; color: #7c3aed; font-weight: 700; }
.card-step-assignees { font-size: 8px; color: #64748b; }
.card-step-desc { font-size: 8px; color: #94a3b8; font-style: italic;
                  margin-top: 2px; line-height: 1.3; }

/* ── LIST VIEW ── */
.list-step-row { display: flex; align-items: flex-start; gap: 8px;
                 padding: 7px 10px; border: 1px solid #e5e7eb;
                 border-radius: 7px; margin-bottom: 4px;
                 page-break-inside: avoid; break-inside: avoid; }
.list-type-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; margin-top: 3px; }
.list-step-name { font-size: 11px; font-weight: 600; color: #0f172a; flex: 1; }
.list-step-meta { font-size: 9px; color: #64748b; margin-top: 2px; }
.list-step-branch { padding-left: 20px; border-left: 2px solid #e5e7eb; margin-left: 12px; margin-bottom: 4px; }
.list-branch-label { font-size: 8px; font-weight: 800; text-transform: uppercase;
                     color: #94a3b8; padding: 3px 0 4px 6px; }

/* ── STEPS VIEW (grouped by resource) ── */
.res-section { margin-bottom: 24px; page-break-inside: avoid; }
.res-section-header { display: flex; align-items: center; gap: 8px;
                      padding: 8px 12px; border-radius: 8px; margin-bottom: 8px; }
.res-section-name { font-size: 12px; font-weight: 700; color: #0f172a; }
.res-section-type { font-size: 9px; font-weight: 700; text-transform: uppercase;
                    letter-spacing: 0.06em; }
.step-row { display: flex; align-items: flex-start; gap: 8px;
            padding: 8px 12px; border: 1px solid #e5e7eb;
            border-radius: 8px; margin-bottom: 4px;
            page-break-inside: avoid; break-inside: avoid; }
.step-num { width: 20px; height: 20px; border-radius: 99px;
            font-size: 9px; font-weight: 800; display: flex;
            align-items: center; justify-content: center; flex-shrink: 0; }
.step-content { flex: 1; }
.step-name { font-size: 11px; font-weight: 600; color: #0f172a; margin-bottom: 3px; }
.step-details { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 3px; }
.step-detail-pill { font-size: 9px; padding: 1px 6px; border-radius: 99px; border: 1px solid; }
.step-app-pill { background: rgba(2,132,199,0.08); color: #0284c7; border-color: rgba(2,132,199,0.2); }
.step-assignee-pill { background: rgba(56,189,248,0.08); color: #0369a1; border-color: rgba(56,189,248,0.2); }
.step-logic-pill { background: rgba(124,58,237,0.08); color: #7c3aed; border-color: rgba(124,58,237,0.2); }
.step-desc { font-size: 9px; color: #64748b; margin-top: 4px; line-height: 1.4; font-style: italic; }
.logic-out { font-size: 9px; color: #7c3aed; margin-top: 3px; }
.logic-out-item { display: flex; align-items: center; gap: 4px; margin-top: 2px; }
.logic-arrow { color: #94a3b8; }

@media print {
  body { padding: 20px; }
  .stage-header { break-before: auto; }
  .res-section { break-inside: avoid; }
}
</style>
</head>
<body>
<div class="print-header">
    <div>
        <div class="print-header-title">${clientName}</div>
        <div class="print-header-sub">Flow Map — ${viewLabel} View</div>
    </div>
    <div class="print-header-meta">
        Generated ${date}<br>
        ${resources.length} resources · ${stages.length} stages
    </div>
</div>
${bodyHtml}
</body>
</html>`;

    // Open in new window and trigger print
    const win = window.open('', '_blank', 'width=1000,height=800');
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 800);
};

// ── FLOWCHART (SWIMLANES) ──────────────────────────
export function _printIcon(name, size = 10) {
    const icons = {
        'smartphone': '<path d="M17 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2z"/><line x1="12" y1="18" x2="12.01" y2="18"/>',
        'user':       '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
        'clock':      '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
        'repeat':     '<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
        'git-branch': '<line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
        'arrow-right':'<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>',
    };
    const path = icons[name] || '';
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;margin-right:3px;">${path}</svg>`;
};

export function _printFlowchartHtml(stages, resources, workflows) {
    const WF_COLORS = ['#3dd9c5','#7c3aed','#f97316','#38bdf8','#a78bfa','#fb923c','#10b981','#f43f5e'];
    let html = '';
    stages.forEach((stage, si) => {
        const stageWfs  = workflows.filter(w => w.stageId === stage.id);
        const assignedIds = new Set(stageWfs.flatMap(w => w.resourceIds || []));
        const unassigned  = resources.filter(r => r.stageId === stage.id && !assignedIds.has(String(r.id)));
        const totalCards  = stageWfs.reduce((a, w) => a + (w.resourceIds || []).length, 0) + unassigned.length;
        if (totalCards === 0) return;
        html += `<div class="stage-header">
            <div class="stage-num">${si + 1}</div>
            <div class="stage-name">${esc(stage.name)}</div>
            <div class="stage-count">${totalCards} resource${totalCards !== 1 ? 's' : ''}</div>
        </div>`;
        stageWfs.forEach((wf, wfi) => {
            const wfColor = wf.color || WF_COLORS[wfi % WF_COLORS.length];
            const wfRes = (wf.resourceIds || [])
                .map(id => resources.find(r => String(r.id) === id))
                .filter(Boolean);
            if (!wfRes.length) return;
            html += `<div class="wf-label">
                <div class="wf-dot" style="background:${wfColor};"></div>
                <div class="wf-name">${esc(wf.name)}</div>
            </div>
            <div class="swimlane-cards">
                ${wfRes.map(res => OL._printCard(res, resources)).join('')}
            </div>`;
        });
        if (unassigned.length) {
            html += `<div class="wf-label">
                <div class="wf-dot" style="background:#9ca3af;"></div>
                <div class="wf-name">Unassigned</div>
            </div>
            <div class="swimlane-cards">
                ${unassigned.map(res => OL._printCard(res, resources)).join('')}
            </div>`;
        }
    });
    return html;
};

export function _printCard(res, allResources) {
    const tc = OL._fvGetType(res.type);
    const steps = (res.steps || []).filter(s => !s.isArchived);
    const assignees = (res.assignees || []).map(a => esc(a.name)).join(', ');
    const appName = res.appName || '';

    return `<div class="resource-card">
        <div class="card-accent" style="background:${tc.color};"></div>
        <div class="card-body">
            <div class="card-type-row">
                <span class="card-type-badge" style="background:${tc.color}18;color:${tc.color};">
                    ${esc(res.type || 'General')}
                </span>
            </div>
            <div class="card-name">${esc(res.name)}</div>
            ${appName || assignees ? `
                <div class="card-meta">
                    ${appName ? `<span class="card-meta-pill">${OL._printIcon('smartphone')} ${esc(appName)}</span>` : ''}
                    ${assignees ? `<span class="card-meta-pill">${OL._printIcon('user')} ${assignees}</span>` : ''}
                </div>
            ` : ''}
            ${steps.length ? `
                <div class="card-steps">
                    ${steps.map((s, i) => {
                        const stepAssignees = (s.assignees || []).map(a => a.name).join(', ');
                        const logicOuts = (s.logic?.out || []).filter(l => l.targetId || l.type === 'delay');

                        const logicLines = logicOuts.map(l => {
                            const types = l.types || [l.type || 'next'];

                            if (types.includes('delay')) {
                                const amt   = l.delayAmount || l.amount || '';
                                const unit  = l.delayUnit  || l.unit   || 'days';
                                const label = l.rule || l.label || '';
                                return `<div class="card-step-logic-out">${OL._printIcon('clock')} Delay ${amt ? amt + ' ' + unit : unit}${label ? ' — ' + esc(label) : ''}</div>`;
                            }

                            if (types.includes('loop')) {
                                const label = l.rule || l.label || l.loopOver || '';
                                return `<div class="card-step-logic-out">${OL._printIcon('repeat')} Loop${label ? ' <em>' + esc(label) + '</em>' : ''}</div>`;
                            }

                            if (types.includes('condition')) {
                                const rule = l.rule || l.label || '';
                                const lastH = String(l.targetId || '').lastIndexOf('-');
                                let targetLabel = '';
                                if (lastH !== -1) {
                                    const tRes  = (allResources || []).find(r => String(r.id) === l.targetId.substring(0, lastH));
                                    const tStep = tRes?.steps?.find(s2 => String(s2.id) === l.targetId.substring(lastH + 1));
                                    if (tStep) targetLabel = ' → ' + esc(tStep.name);
                                    else if (tRes) targetLabel = ' → ' + esc(tRes.name);
                                }
                                return `<div class="card-step-logic-out">${OL._printIcon('git-branch')} ${rule ? '<em>' + esc(rule) + '</em>' : 'If condition'}${targetLabel}</div>`;
                            }

                            const label = l.rule || l.label || '';
                            return label ? `<div class="card-step-logic-out">${OL._printIcon('arrow-right')} ${esc(label)}</div>` : '';
                        }).filter(Boolean).join('');

                        return `<div class="card-step">
                            <div class="card-step-num">${i + 1}</div>
                            <div style="flex:1;">
                                <div class="card-step-name">${esc(s.name || 'Unnamed')}</div>
                                ${s.appName ? `<div class="card-step-app">${OL._printIcon('smartphone')} ${esc(s.appName)}</div>` : ''}
                                ${stepAssignees ? `<div class="card-step-assignees">${OL._printIcon('user')} ${stepAssignees}</div>` : ''}
                                ${logicLines}
                            </div>
                        </div>`;
                    }).join('')}
                </div>
            ` : ''}
        </div>
    </div>`;
};

// ── LIST VIEW ──────────────────────────────────────
export function _printListHtml(stages, resources, workflows) {
    let html = '';
    const renderedSteps = new Set();

    const renderStep = (step, res, depth) => {
        if (renderedSteps.has(step.id)) return '';
        renderedSteps.add(step.id);
        const tc = OL._fvGetType(res.type);
        const assignees = (step.assignees || []).map(a => a.name).join(', ');
        const logic = (step.logic?.out || []).filter(l => l.targetId);
        const conditions = logic.filter(l => (l.types||[l.type||'next']).includes('condition'));
        const indent = depth > 0 ? `padding-left:${depth * 20}px;` : '';

        let out = `<div class="list-step-row" style="${indent}">
            <div class="list-type-dot" style="background:${tc.color};"></div>
            <div style="flex:1;">
                <div class="list-step-name">${esc(step.name || 'Unnamed')}</div>
                <div class="list-step-meta">
                    ${esc(res.name)}
                    ${step.appName ? ` · ${esc(step.appName)}` : ''}
                    ${assignees ? ` · ${assignees}` : ''}
                </div>
            </div>
        </div>`;

        conditions.forEach(cond => {
            const lastH = String(cond.targetId || '').lastIndexOf('-');
            if (lastH === -1) return;
            const tResId  = cond.targetId.substring(0, lastH);
            const tStepId = cond.targetId.substring(lastH + 1);
            const tRes  = resources.find(r => String(r.id) === tResId);
            const tStep = tRes?.steps?.find(s => String(s.id) === tStepId);
            if (tRes && tStep) {
                out += `<div class="list-step-branch">
                    <div class="list-branch-label">◆ ${esc(cond.rule || 'If condition')}</div>
                    ${renderStep(tStep, tRes, depth + 1)}
                </div>`;
            }
        });

        return out;
    };

    const WF_COLORS = ['#3dd9c5','#7c3aed','#f97316','#38bdf8','#a78bfa','#fb923c','#10b981','#f43f5e'];

    stages.forEach((stage, si) => {
        const stageWfs    = workflows.filter(w => w.stageId === stage.id);
        const assignedIds = new Set(stageWfs.flatMap(w => w.resourceIds || []));
        const unassigned  = resources.filter(r => r.stageId === stage.id && !assignedIds.has(String(r.id)));

        // Check if stage has any content before rendering header
        const hasContent = stageWfs.some(wf => (wf.resourceIds || []).some(id => {
            const res = resources.find(r => String(r.id) === id);
            return res && (res.steps || []).some(s => !s.isArchived);
        })) || unassigned.some(r => (r.steps || []).some(s => !s.isArchived));
        if (!hasContent) return;

        html += `<div class="stage-header">
            <div class="stage-num">${si + 1}</div>
            <div class="stage-name">${esc(stage.name)}</div>
        </div>`;

        stageWfs.forEach((wf, wfi) => {
            const wfColor = wf.color || WF_COLORS[wfi % WF_COLORS.length];
            const wfRes = (wf.resourceIds || [])
                .map(id => resources.find(r => String(r.id) === id))
                .filter(Boolean);

            let wfStepsHtml = '';
            wfRes.forEach(res => {
                (res.steps || []).filter(s => !s.isArchived)
                    .forEach(s => { wfStepsHtml += renderStep(s, res, 0); });
            });

            if (!wfStepsHtml) return;

            html += `<div class="wf-label">
                <div class="wf-dot" style="background:${wfColor};"></div>
                <div class="wf-name">${esc(wf.name)}</div>
            </div>
            ${wfStepsHtml}`;
        });

        let unassignedHtml = '';
        unassigned.forEach(res => {
            (res.steps || []).filter(s => !s.isArchived)
                .forEach(s => { unassignedHtml += renderStep(s, res, 0); });
        });

        if (unassignedHtml) {
            html += `<div class="wf-label">
                <div class="wf-dot" style="background:#9ca3af;"></div>
                <div class="wf-name">Unassigned</div>
            </div>
            ${unassignedHtml}`;
        }
    });

    return html;
};

// ── STEPS VIEW (resources as side-by-side columns per workflow, mirroring the visualizer) ──
export function _printStepsHtml(stages, resources, workflows) {
    let html = '';
    const WF_COLORS = ['#3dd9c5','#7c3aed','#f97316','#38bdf8','#a78bfa','#fb923c','#10b981','#f43f5e'];

    // Build one step row for a column
    const stepRowHtml = (s, i, res, allResources) => {
        const tc = OL._fvGetType(res.type);
        const assignees = (s.assignees || []).map(a => esc(a.name)).join(', ');
        const logic = (s.logic?.out || []).filter(l => l.targetId && !l._implicit);
        const crossLinks = logic.map(l => {
            const lastH = String(l.targetId || '').lastIndexOf('-');
            if (lastH === -1) return '';
            const tResId = l.targetId.substring(0, lastH);
            if (String(tResId) === String(res.id)) return ''; // same-resource next step, skip
            const tRes  = allResources.find(r => String(r.id) === tResId);
            const tStep = tRes?.steps?.find(s2 => String(s2.id) === l.targetId.substring(lastH + 1));
            if (!tRes || !tStep) return '';
            const types = l.types || [l.type || 'next'];
            const arrow = types.includes('condition') ? '◆' : types.includes('loop') ? '↺' : types.includes('delay') ? '⏱' : '→';
            const rule  = l.rule ? `<em>${esc(l.rule)}</em>: ` : '';
            return `<div style="font-size:8px;color:#7c3aed;margin-top:2px;">${arrow} ${rule}${esc(tRes.name)}</div>`;
        }).filter(Boolean).join('');

        return `<div style="padding:6px 9px;border-bottom:1px solid #f1f5f9;display:flex;gap:6px;align-items:flex-start;break-inside:avoid;">
            <div style="width:17px;height:17px;border-radius:50%;background:${tc.color}18;color:${tc.color};
                        font-size:8px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px;">${i + 1}</div>
            <div style="flex:1;min-width:0;">
                <div style="font-size:10px;font-weight:600;color:#0f172a;line-height:1.35;">${esc(s.name || 'Unnamed')}</div>
                ${s.appName ? `<div style="font-size:8px;color:#0284c7;margin-top:1px;">${esc(s.appName)}</div>` : ''}
                ${assignees ? `<div style="font-size:8px;color:#64748b;margin-top:1px;">${esc(assignees)}</div>` : ''}
                ${crossLinks}
            </div>
        </div>`;
    };

    stages.forEach((stage, si) => {
        const stageWfs = workflows.filter(w => w.stageId === stage.id);
        const assignedIds = new Set(stageWfs.flatMap(w => w.resourceIds || []));
        const hasContent = stageWfs.some(wf =>
            (wf.resourceIds || []).some(id => {
                const r = resources.find(r => String(r.id) === id);
                return r && (r.steps || []).some(s => !s.isArchived);
            })
        );
        if (!hasContent) return;

        html += `<div class="stage-header" style="break-before:auto;">
            <div class="stage-num">${si + 1}</div>
            <div class="stage-name">${esc(stage.name)}</div>
        </div>`;

        stageWfs.forEach((wf, wfi) => {
            const wfColor = wf.color || WF_COLORS[wfi % WF_COLORS.length];
            const wfRes = (wf.resourceIds || [])
                .map(id => resources.find(r => String(r.id) === id))
                .filter(r => r && (r.steps || []).some(s => !s.isArchived));
            if (!wfRes.length) return;

            html += `<div class="wf-label">
                <div class="wf-dot" style="background:${wfColor};"></div>
                <div class="wf-name">${esc(wf.name)}</div>
            </div>
            <div style="display:flex;gap:10px;align-items:flex-start;margin-bottom:20px;break-inside:avoid;">`;

            wfRes.forEach(res => {
                const steps = (res.steps || []).filter(s => !s.isArchived);
                const tc = OL._fvGetType(res.type);
                html += `<div style="flex:1;min-width:0;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;break-inside:avoid;">
                    <div style="padding:7px 9px;background:${tc.color}12;border-bottom:2px solid ${tc.color};">
                        <div style="font-size:8px;font-weight:800;text-transform:uppercase;letter-spacing:0.06em;color:${tc.color};">${esc(res.type || 'General')}</div>
                        <div style="font-size:11px;font-weight:700;color:#0f172a;margin-top:1px;line-height:1.2;">${esc(res.name)}</div>
                        ${res.appName ? `<div style="font-size:8px;color:#0284c7;margin-top:2px;">${esc(res.appName)}</div>` : ''}
                    </div>
                    ${steps.map((s, i) => stepRowHtml(s, i, res, resources)).join('')}
                </div>`;
            });

            html += `</div>`; // close flex row
        });

        // Unassigned resources for this stage
        const unassigned = resources.filter(r => r.stageId === stage.id && !assignedIds.has(String(r.id)) && (r.steps || []).some(s => !s.isArchived));
        if (unassigned.length) {
            html += `<div class="wf-label"><div class="wf-dot" style="background:#9ca3af;"></div><div class="wf-name">Unassigned</div></div>
            <div style="display:flex;gap:10px;align-items:flex-start;margin-bottom:20px;break-inside:avoid;">`;
            unassigned.forEach(res => {
                const steps = (res.steps || []).filter(s => !s.isArchived);
                const tc = OL._fvGetType(res.type);
                html += `<div style="flex:1;min-width:0;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;break-inside:avoid;">
                    <div style="padding:7px 9px;background:${tc.color}12;border-bottom:2px solid ${tc.color};">
                        <div style="font-size:8px;font-weight:800;text-transform:uppercase;letter-spacing:0.06em;color:${tc.color};">${esc(res.type || 'General')}</div>
                        <div style="font-size:11px;font-weight:700;color:#0f172a;margin-top:1px;">${esc(res.name)}</div>
                    </div>
                    ${steps.map((s, i) => stepRowHtml(s, i, res, resources)).join('')}
                </div>`;
            });
            html += `</div>`;
        }
    });

    return html;
};

// ---- bridge: keep OL.* calls working until callers import directly ----
window.OL = window.OL || {};
Object.assign(window.OL, {
    processZapLogic, bulkImportZaps, syncWealthbox, openImportHub,
    upsertExternalResource, syncExternalIntegrations, importCalendly,
    importYCBM, importActiveCampaign, importMailerLite, importJotform,
    syncProcessStreet, syncRedtail, getCredsForApp, printFlowMap,
    _printIcon, _printFlowchartHtml, _printCard, _printListHtml, _printStepsHtml,
    openClickUpImportModal, handleClickUpCSVFile, renderClickUpImportStep,
    setClickUpMapping, setClickUpTargetMode, setClickUpTargetClient,
    setClickUpRoutingColumn, setClickUpRoutingMapByIndex, runClickUpImport
});
