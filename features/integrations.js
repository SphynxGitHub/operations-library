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

import { state, esc, uid, getActiveClient, persist, loadFullClient, markClientDirty, db } from '../core/data.js';
import { createZapImport } from './zap-import-ui.js';
import {
    parseClickUpMinutes, parseClickUpDate, parseClickUpAssignees, parseClickUpBillable, applyImportedTime, guessClientFromFileName,
} from '../core/clickup-import.js';
import { importFrom, secureEntry } from '../core/secrets.js';
import { reconcileExternal, logExternalPull, tieExternalToZaps, EXTERNAL_SOURCES } from '../core/external-sync.js';
import { getOlSettings } from '../core/ol-settings.js';

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

// Time, date, assignee and billable parsing live in core/clickup-import.js.

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
            <div class="modal-title-text">Import ClickUp CSV</div>
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
                    startDate: guessColumn(fields, ['Start Date']),
                    // The task's own time, never the "Rolled Up" column (that repeats the subtasks' time on the parent).
                    timeSpent: fields.find(f => /^(time spent|time tracked|time logged)$/i.test(f.trim())) || guessColumn(fields.filter(f => !/rolled/i.test(f)), ['Time Spent', 'Time Tracked', 'Time Logged']),
                    billable: guessColumn(fields, ['Billable']),
                    comments: guessColumn(fields, ['Comments']),
                    description: guessColumn(fields, ['Description', 'Task Content', 'Content']),
                    parentId: guessColumn(fields, ['Parent ID', 'Parent'])
                },
                routingColumn: '',
                routingMap: {},
                targetMode: 'single',
                // A per-client export is named after the client (e.g. "..._Mason_Associates_LLC.csv").
                targetClientId: guessClientFromFileName(file.name, Object.values(state.clients || {})) || state.activeClientId || '',
                onlyWithTime: true,
                markNewDone: true
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
                ${fieldSelectHTML(st, 'startDate', 'Start Date (dates the time if no due date)')}
                ${fieldSelectHTML(st, 'timeSpent', 'Time Spent (own time, not Rolled Up)')}
                ${fieldSelectHTML(st, 'billable', 'Billable')}
                ${fieldSelectHTML(st, 'comments', 'Comments')}
                ${fieldSelectHTML(st, 'description', 'Description')}
                ${fieldSelectHTML(st, 'parentId', 'Parent Task ID (subtasks)')}
            </div>
        </div>

        ${renderTargetSection(st)}

        <div class="card" style="padding:14px; margin-top:16px;">
            <label class="tiny" style="display:flex; align-items:center; gap:6px; margin-bottom:6px;">
                <input type="checkbox" ${st.onlyWithTime ? 'checked' : ''} onchange="OL._clickupImportState.onlyWithTime = this.checked; OL.renderClickUpImportStep()">
                Only import rows that have time logged
            </label>
            <label class="tiny" style="display:flex; align-items:center; gap:6px;">
                <input type="checkbox" ${st.markNewDone ? 'checked' : ''} onchange="OL._clickupImportState.markNewDone = this.checked">
                Mark new tasks as Done when the file has no status (historical work)
            </label>
            <div id="clickup-time-summary" class="tiny" style="margin-top:10px;">${clickUpTimeSummaryHTML(st)}</div>
        </div>

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
    const el = document.getElementById('clickup-time-summary');
    if (el) el.innerHTML = clickUpTimeSummaryHTML(OL._clickupImportState);
}

// What the time mapping will bring in, so it can be checked against ClickUp before running.
function rowDate(st, row) {
    const m = st.mapping;
    return (m.dueDate ? parseClickUpDate(row[m.dueDate]) : '') || (m.startDate ? parseClickUpDate(row[m.startDate]) : '');
}
function clickUpTimeSummaryHTML(st) {
    const m = st.mapping;
    if (!m.timeSpent) return '<span class="muted">No time column mapped: tasks import without time.</span>';
    const timed = st.rows.filter(r => parseClickUpMinutes(r[m.timeSpent]) > 0);
    const total = timed.reduce((sum, r) => sum + parseClickUpMinutes(r[m.timeSpent]), 0);
    const undated = timed.filter(r => !rowDate(st, r));
    const undatedMin = undated.reduce((sum, r) => sum + parseClickUpMinutes(r[m.timeSpent]), 0);
    const fmt = (min) => `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m`;
    const dates = timed.map(r => rowDate(st, r)).filter(Boolean).sort();
    return `<strong>${timed.length}</strong> row${timed.length === 1 ? '' : 's'} with time, <strong>${fmt(total)}</strong> total`
        + (dates.length ? ` <span class="muted">(${esc(dates[0])} to ${esc(dates[dates.length - 1])})</span>` : '')
        + (undated.length ? `<div class="muted" style="margin-top:4px;">${undated.length} of them (${fmt(undatedMin)}) have no due or start date, so their time won't count toward any maintenance plan period: ${undated.slice(0, 5).map(r => esc(r[m.title] || '')).join(', ')}${undated.length > 5 ? '…' : ''}</div>` : '')
        + (st.onlyWithTime ? `<div class="muted" style="margin-top:4px;">${st.rows.length - timed.length} rows without time will be skipped.</div>` : '');
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

    let created = 0, updated = 0, skipped = 0, noTime = 0, minutesIn = 0;
    const idMapByClient = {};      // clientId -> { clickupTaskId -> ourTaskId }
    const pendingParents = [];     // { clientId, ourTaskId, clickupParentId }
    const touched = new Set();

    // Make sure every target project is fully loaded first, so the import adds to its tasks instead of
    // starting from an empty list.
    const targets = st.targetMode === 'single' ? [st.targetClientId] : [...new Set(Object.values(st.routingMap || {}).filter(Boolean))];
    for (const id of targets) await loadFullClient(id);

    st.rows.forEach(row => {
        let clientId = st.targetClientId;
        if (st.targetMode === 'auto') {
            const routeVal = (row[st.routingColumn] || '').trim();
            clientId = st.routingMap[routeVal] || '';
        }
        if (!clientId || !state.clients[clientId]) { skipped++; return; }

        const title = (row[m.title] || '').trim();
        if (!title) { skipped++; return; }

        const minutes = m.timeSpent ? parseClickUpMinutes(row[m.timeSpent]) : 0;
        if (st.onlyWithTime && m.timeSpent && minutes <= 0) { noTime++; return; }

        const client = state.clients[clientId];
        if (!client.projectData) client.projectData = {};
        if (!client.projectData.clientTasks) client.projectData.clientTasks = [];

        const clickupId = m.taskId ? (row[m.taskId] || '').trim() : '';
        const externalId = clickupId ? `cu-${clickupId}` : '';
        const assignees = m.assignee ? parseClickUpAssignees(row[m.assignee]) : [];
        const dueDate = m.dueDate ? parseClickUpDate(row[m.dueDate]) : '';
        const startDate = m.startDate ? parseClickUpDate(row[m.startDate]) : '';

        const taskData = {
            title, name: title,
            assignee: assignees[0] || 'Sphynx Task',
            dueDate,
            description: m.description ? (row[m.description] || '').trim() : '',
            source: 'clickup'
        };
        if (m.comments) taskData.clickupComments = parseClickUpComments(row[m.comments]);
        if (startDate) taskData.startDate = startDate;
        const statusVal = m.status ? (row[m.status] || '').trim() : '';
        if (statusVal) taskData.status = statusVal;
        const billable = m.billable ? parseClickUpBillable(row[m.billable]) : null;
        if (billable !== null) taskData.billable = billable;
        if (externalId) taskData.externalId = externalId;

        let taskObj = externalId ? client.projectData.clientTasks.find(t => t.externalId === externalId) : null;
        if (taskObj) {
            Object.assign(taskObj, taskData);
            updated++;
        } else {
            // Dated from ClickUp so reports filtered by date put it in the right month, not the import day.
            const when = startDate || dueDate;
            taskObj = {
                id: uid(), createdAt: when ? `${when}T12:00:00` : new Date().toISOString(), isClientTask: false,
                ...(st.markNewDone && !statusVal ? { status: 'Done', ...(when ? { completedAt: `${dueDate || startDate}T12:00:00` } : {}) } : {}),
                ...taskData
            };
            client.projectData.clientTasks.push(taskObj);
            created++;
        }

        if (m.timeSpent) {
            applyImportedTime(taskObj, { clickupId: clickupId || taskObj.id, minutes, date: dueDate || startDate, by: assignees.join(', ') });
            minutesIn += minutes;
        }
        touched.add(clientId);

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

    touched.forEach(id => markClientDirty(id));      // persist() only saves the open project unless told otherwise
    await OL.persist();
    OL.closeModal();
    if (typeof window.renderClientTaskManager === 'function' && state.activeClientId) window.renderClientTaskManager();
    const h = Math.floor(minutesIn / 60), mm = minutesIn % 60;
    alert(`ClickUp Import Complete\nCreated: ${created}\nUpdated: ${updated}\nTime imported: ${h}h ${String(mm).padStart(2, '0')}m`
        + (noTime ? `\nSkipped (no time logged): ${noTime}` : '') + (skipped ? `\nSkipped (unmapped/blank): ${skipped}` : ''));
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
        name: String(zap.zapName || '').replace(/^⚡\s*/, '').trim(),
        source: 'zapier',
        steps: transformedSteps,
        isExpanded: true
    };
};

export function bulkImportZaps(isMaster = false) {
    const activeId = state.activeClientId;
    const client = state.clients[activeId];
    if (!client && !isMaster) return alert("No active project.");

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

    const rawData = prompt(`LOGIC-PRESERVING SYNC\nTarget: ${client.meta?.name}\n\nPaste JSON:`);
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
            processedZap.name = String(zapData.zapName || '').replace(/^⚡\s*/, '').trim();
            processedZap.source = 'zapier';

            // 🎯 4. LOGIC & POSITION GRAFTING
            const existingIndex = library.findIndex(r => 
                r.type === 'Zap' && (String(r.originalZapId) === String(zapData.zapId) || String(r.name || '').replace(/^⚡\s*/, '').toLowerCase() === processedZap.name.toLowerCase())
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
        
        alert(`Sync Complete! Positions, Connections (Logic), and Tags were preserved.`);
    } catch (e) {
        console.error("🔥 Sync Error:", e);
    }
};

// ---- Pulling from outside services ---------------------------------------------------------------------------
// Every importer below turns what its service returned into cards and hands them to commitPull, which merges them into
// the project's library by the service's own id (core/external-sync.js): positions, lanes, notes and links added by hand
// stay, renames are renames, items the service no longer has are flagged (not deleted), and the cards are tied to the
// Zap steps that use them. Each importer returns that summary.
const needsSetup = (msg) => Object.assign(new Error(msg), { skip: true });   // an automatic pull never asks questions: it skips

function refreshAfterPull(client) {
    setTimeout(() => {
        try {
            if (state.activeClientId !== client.id) return;
            if (typeof OL.syncResourceLibraryFilters === 'function') OL.syncResourceLibraryFilters();
            // only redraw a page that is actually on screen
            if (document.getElementById('resource-library-results') && typeof OL.renderResourceManager === 'function') OL.renderResourceManager(client);
            if (window.location.hash.includes('visualizer') && typeof OL.renderVisualizer === 'function') OL.renderVisualizer(false);
        } catch (e) { console.warn('Redraw after a pull failed:', e); }
    }, 150);
}

function commitPull(client, source, items, extra = {}) {
    if (!client.projectData.localResources) client.projectData.localResources = [];
    const summary = reconcileExternal(client.projectData.localResources, source, items);
    (extra.logicChanged || []).forEach((n) => { if (!summary.changed.includes(n)) summary.changed.push(n); });   // a form whose logic changed counts as changed
    logExternalPull(client.projectData, summary);
    tieExternalToZaps(client.projectData.localResources);
    markClientDirty(client.id);
    refreshAfterPull(client);
    return summary;
}

const placeholderStep = (source, id, name, appName) => ({ id: `${source}-${id}-s0`, name, appName });

export async function syncWealthbox(client, opts = {}) {
    const wbCreds = findRegistryEntry(client, APP_NAME_HINTS.wealthbox);
    if (!hasKey(wbCreds)) throw new Error("Wealthbox API Key not found in Credentials.");
    await secureEntry(client, wbCreds);   // a key still in plain text moves to secure storage first

    const result = await importFrom('wealthbox', client.id, wbCreds.id);
    const templates = result.workflow_templates || [];

    const items = templates.map((wf) => ({
        externalId: wf.id, name: wf.name, type: 'Workflow', category: 'Flows', archetype: 'Multi-Level',
        steps: (wf.workflow_steps || []).length
            ? wf.workflow_steps.map((s, idx) => ({ id: `wb-${wf.id}-s${idx}`, name: s.name, description: s.description || '', appName: 'Wealthbox' }))
            : [placeholderStep('wb', wf.id, 'Workflow Template', 'Wealthbox')],
    }));
    return commitPull(client, 'wealthbox', items);
};

// Names saved before the emoji clean-up carry a prefix such as "Cal: " with a symbol in front. Matching ignores it, and
// cleanLegacyResourceNames() removes it from saved cards (keeping which service the card came from in .source).
const LEGACY_NAME_PREFIX = /^(?:(?:\u26A1)\uFE0F?|(?:[\u{1F300}-\u{1FAFF}][\uFE0F\u200D]*\s*)(?:cal|form|ac|ml|wb|ycbm|rt|ps):)\s*/iu;
const LEGACY_SOURCE = { cal: 'calendly', form: 'jotform', ac: 'activecampaign', ml: 'mailerlite', wb: 'wealthbox', ycbm: 'ycbm', rt: 'redtail', ps: 'processstreet' };
export function cleanLegacyResourceNames(client) {
    const list = client?.projectData?.localResources;
    if (!Array.isArray(list)) return 0;
    let n = 0;
    list.forEach((r) => {
        if (!r || typeof r.name !== 'string') return;
        const m = r.name.match(/^[\u{1F300}-\u{1FAFF}][\uFE0F\u200D]*\s*(cal|form|ac|ml|wb|ycbm|rt|ps):\s*/iu);
        if (m) { if (!r.source) r.source = LEGACY_SOURCE[m[1].toLowerCase()]; r.name = r.name.slice(m[0].length).trim(); n++; return; }
        if (/^\u26A1\uFE0F?\s*/u.test(r.name) && r.type === 'Zap') { if (!r.source) r.source = 'zapier'; r.name = r.name.replace(/^\u26A1\uFE0F?\s*/u, '').trim(); n++; }
    });
    return n;
}

export function upsertExternalResource(client, data) {
    if (!client.projectData.localResources) client.projectData.localResources = [];
    const library = client.projectData.localResources;
    
    // 🎯 REFINED MATCHING LOGIC
    // We check: 1. External ID (Best), 2. Name Match, 3. Clean Name Match (ignoring icons)
    const stripLegacy = (n) => String(n || '').toLowerCase().replace(LEGACY_NAME_PREFIX, '').trim();
    const existingIdx = library.findIndex(r => {
        const matchId = (r.externalId && data.externalId && String(r.externalId) === String(data.externalId));
        if (matchId) return true;
        // Names are plain now, so two services can hold a workflow with the same name. Only match by name inside one source.
        const sameSource = !r.source || !data.source || r.source === data.source;
        return sameSource && r.type === data.type && stripLegacy(r.name) === stripLegacy(data.name);
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

// ---- The Importer Hub -------------------------------------------------------------------------------------
// Every service the OL can pull from, grouped. `creds` is the app name the access registry is searched for.
const HUB_GROUPS = [
    { title: 'CRM workflows', items: [
        { key: 'wealthbox', name: 'Wealthbox', desc: 'Workflow templates', icon: 'network', creds: 'wealthbox' },
        { key: 'redtail', name: 'Redtail', desc: 'CRM workflow templates', icon: 'contact', creds: 'redtail' },
    ] },
    { title: 'Forms and scheduling', items: [
        { key: 'jotform', name: 'Jotform', desc: 'Active forms', icon: 'file-text', creds: 'jotform' },
        { key: 'calendly', name: 'Calendly', desc: 'Event types', icon: 'calendar-clock', creds: 'calendly' },
        { key: 'ycbm', name: 'YouCanBook.me', desc: 'Booking profiles', icon: 'calendar-check', creds: 'youcanbookme' },
    ] },
    { title: 'Email automation', items: [
        { key: 'activecampaign', name: 'ActiveCampaign', desc: 'Automations', icon: 'mail', creds: 'activecampaign' },
        { key: 'mailerlite', name: 'MailerLite', desc: 'Sequences', icon: 'send', creds: 'mailerlite' },
    ] },
    { title: 'Checklists and tasks', items: [
        { key: 'processstreet', name: 'Process Street', desc: 'Checklists', icon: 'list-checks', creds: 'processstreet' },
        { key: 'clickup', name: 'ClickUp', desc: 'Task import (CSV)', icon: 'square-check-big', csv: true },
    ] },
];
const HUB_LABEL = Object.fromEntries(HUB_GROUPS.flatMap((g) => g.items).map((i) => [i.key, i.name]));

function timeAgo(iso) {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return '';
    const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
    if (mins < 2) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 36) return `${hrs} hr ago`;
    return `${Math.round(hrs / 24)} days ago`;
}

const SYNC_FN = {
    wealthbox: (c, o) => syncWealthbox(c, o), redtail: (c, o) => syncRedtail(c, o), jotform: (c, o) => importJotform(c, o),
    calendly: (c, o) => importCalendly(c, o), ycbm: (c, o) => importYCBM(c, o), activecampaign: (c, o) => importActiveCampaign(c, o),
    mailerlite: (c, o) => importMailerLite(c, o), processstreet: (c, o) => syncProcessStreet(c, o),
};
const emptySummary = (key) => ({ source: key, total: 0, added: [], renamed: [], changed: [], missing: [], restored: [], emptyPull: false });
const changeCount = (s) => (s ? s.added.length + s.renamed.length + s.changed.length + s.missing.length + s.restored.length : 0);

function describeSummary(label, s) {
    if (!s) return `${label}: nothing to pull.`;
    const bits = [];
    if (s.added.length) bits.push(`${s.added.length} new`);
    if (s.renamed.length + s.changed.length) bits.push(`${s.renamed.length + s.changed.length} changed`);
    if (s.missing.length) bits.push(`${s.missing.length} removed upstream`);
    if (s.restored.length) bits.push(`${s.restored.length} back`);
    if (s.emptyPull) bits.push('the service returned nothing, so nothing was flagged');
    return `${label}: ${s.total} item${s.total === 1 ? '' : 's'}${bits.length ? ' · ' + bits.join(', ') : ' · no changes'}`;
}

function recordSyncError(client, key, e) {
    const pd = client.projectData; pd.integrationSync = pd.integrationSync || {};
    pd.integrationSync[key] = { ...(pd.integrationSync[key] || {}), error: String(e?.message || e).slice(0, 200), errorAt: new Date().toISOString() };
    markClientDirty(client.id);
}

// Runs one service for one project. Returns the summary of what changed.
async function runOneSync(client, key, opts = {}) {
    const fn = SYNC_FN[key];
    if (!fn) throw new Error(`Unknown service: ${key}`);
    const r = await fn(client, opts);
    return (r && typeof r === 'object') ? r : emptySummary(key);
}

const hasPulledBefore = (client, key) => {
    const cfg = EXTERNAL_SOURCES[key] || { legacyPrefixes: [] };
    return (client.projectData?.localResources || []).some((r) => r && (r.source === key || (!r.source && cfg.legacyPrefixes.some((p) => String(r.id || '').startsWith(p)))));
};

// 📡 THE SYNC ORCHESTRATOR (one service, from a tile in the hub): runs it, records when, and reports in the hub.
export async function syncExternalIntegrations(serviceKey) {
    const client = getActiveClient();
    if (!client) { OL._importHub = { ...(OL._importHub || {}), note: { kind: 'error', text: 'No active project selected.' } }; return openImportHub(); }
    if (OL._importHub?.busy) return;

    OL._importHub = { busy: serviceKey, note: null };
    openImportHub();
    try {
        const key = serviceKey === 'process-street' ? 'processstreet' : serviceKey;
        const summary = await runOneSync(client, key, {});
        await persist();
        OL._importHub = { busy: null, note: { kind: 'ok', text: describeSummary(HUB_LABEL[key] || key, summary) } };
    } catch (e) {
        console.error(`${serviceKey} sync error:`, e);
        recordSyncError(client, serviceKey, e);
        OL._importHub = { busy: null, note: { kind: 'error', text: `${HUB_LABEL[serviceKey] || serviceKey}: ${e.message || 'sync failed'}` } };
    }
    openImportHub();
};

// Every connected service, one after another ("Sync all" in the hub).
export async function syncAllIntegrations() {
    const client = getActiveClient();
    if (!client || OL._importHub?.busy) return;
    OL._importHub = { busy: 'all', note: null };
    openImportHub();
    const lines = []; let failed = 0;
    for (const g of HUB_GROUPS) for (const it of g.items) {
        if (it.csv || !hasKey(getCredsForApp(client, it.creds))) continue;
        try { lines.push(describeSummary(it.name, await runOneSync(client, it.key, {}))); }
        catch (e) { failed++; recordSyncError(client, it.key, e); lines.push(`${it.name}: ${e.skip ? 'needs setup (' + e.message + ')' : (e.message || 'failed')}`); }
    }
    try { await persist(); } catch (e) { console.warn('Save after Sync all failed:', e); }
    OL._importHub = { busy: null, note: { kind: failed ? 'error' : 'ok', text: lines.length ? lines.join('\n') : 'No service has an API key in Credentials yet.' } };
    openImportHub();
};

// ---- Automatic pulling ---------------------------------------------------------------------------------------
// When a project is opened (and once an hour while it stays open), every connected service that has been pulled before and
// is older than the interval in Automations > Templates & settings is pulled again, quietly. A service never pulled stays a
// deliberate first click. A failure is remembered (shown in the hub) and not retried for six hours; a service that needs a
// question answered (an account email, an API URL) is skipped. It runs in this browser on the open project, so what it
// writes is saved the same way as any edit.
const AUTO_RETRY_AFTER_ERROR_MS = 6 * 3600 * 1000;
export async function autoPullIntegrations(client) {
    try {
        if (!client || !client.projectData || client._metaOnly || window.IS_GUEST) return null;
        if (!(state.adminMode === true || state.teamMemberMode === true)) return null;
        if (state.activeClientId !== client.id) return null;
        if (OL._autoPull?.running || OL._importHub?.busy) return null;
        const cfg = getOlSettings().integrations || {};
        if (cfg.autoPull === false) return null;
        const everyMs = Math.max(1, Number(cfg.everyHours) || 24) * 3600 * 1000;
        const synced = client.projectData.integrationSync || {};
        const nowMs = Date.now();

        OL._autoPull = { running: true };
        const results = [];
        for (const g of HUB_GROUPS) for (const it of g.items) {
            if (it.csv || !hasKey(getCredsForApp(client, it.creds))) continue;
            const last = synced[it.key] || {};
            if (!last.at && !hasPulledBefore(client, it.key)) continue;                      // the first pull is a deliberate click
            if (last.at && nowMs - Date.parse(last.at) < everyMs) continue;                   // pulled recently
            if (last.errorAt && nowMs - Date.parse(last.errorAt) < AUTO_RETRY_AFTER_ERROR_MS) continue;
            try { results.push(await runOneSync(client, it.key, { auto: true })); }
            catch (e) { if (!e.skip) { console.warn(`Automatic ${it.name} pull failed:`, e); recordSyncError(client, it.key, e); } }
        }
        if (results.length || Object.values(client.projectData.integrationSync || {}).some((v) => v && v.errorAt)) { markClientDirty(client.id); await persist(); }
        const changed = results.filter((s) => changeCount(s));
        if (changed.length && typeof OL.showToast === 'function') OL.showToast(`Updated from your services. ${changed.map((s) => describeSummary(EXTERNAL_SOURCES[s.source]?.label || s.source, s)).join(' | ')}`);
        return results;
    } catch (e) {
        console.warn('Automatic pull stopped:', e);
        return null;
    } finally { OL._autoPull = null; }
}

OL.autoPullActiveClient = () => { const c = getActiveClient(); if (c) return autoPullIntegrations(c); };
if (typeof window !== 'undefined' && typeof setInterval === 'function') setInterval(() => { OL.autoPullActiveClient(); }, 60 * 60 * 1000);

export function openImportHub() {
    const client = getActiveClient();
    const st = OL._importHub || {};
    const pd = client?.projectData || {};
    const synced = pd.integrationSync || {};
    const connectedAny = client ? HUB_GROUPS.some((g) => g.items.some((it) => !it.csv && hasKey(getCredsForApp(client, it.creds)))) : false;

    const tile = (it) => {
        const entry = it.creds && client ? getCredsForApp(client, it.creds) : null;
        const connected = it.csv ? true : hasKey(entry);
        const last = synced[it.key];
        const busy = st.busy === it.key || st.busy === 'all';
        const status = busy ? 'Syncing...'
            : it.csv ? 'Upload a ClickUp export'
            : !connected ? 'Add the API key in Credentials'
            : last && last.error && (!last.at || Date.parse(last.errorAt || 0) > Date.parse(last.at)) ? `Last attempt failed ${timeAgo(last.errorAt)}: ${last.error}`
            : last && last.at ? `Last synced ${timeAgo(last.at)}${Number.isFinite(last.count) ? ` · ${last.count} items` : ''}${last.missing ? ` · ${last.missing} removed upstream` : ''}`
            : hasPulledBefore(client, it.key) ? 'Pulled before · will refresh automatically'
            : 'Connected · not synced yet';
        const action = it.csv ? "OL.openClickUpImportModal()" : `OL.syncExternalIntegrations('${it.key}')`;
        return `
            <button type="button" class="ih-tile${connected ? '' : ' is-off'}${busy ? ' is-busy' : ''}" ${st.busy ? 'disabled' : ''} onclick="${action}">
                <span class="ih-icon"><i data-lucide="${it.icon}"></i></span>
                <span class="ih-name">${esc(it.name)}</span>
                <span class="ih-desc">${esc(it.desc)}</span>
                <span class="ih-status">${esc(status)}</span>
            </button>`;
    };

    // What changed in the last pulls, and which Zap steps point at something that was not found.
    const log = (pd.integrationLog || []).slice(0, 6);
    const logHtml = log.length ? `
        <div class="ih-group">
            <div class="ih-group-title">Recent changes</div>
            <div class="ih-log">${log.map((e) => {
                const label = EXTERNAL_SOURCES[e.source]?.label || e.source;
                const parts = [];
                if (e.added?.length) parts.push(`new: ${e.added.slice(0, 3).map(esc).join(', ')}${e.added.length > 3 ? ` +${e.added.length - 3}` : ''}`);
                if (e.renamed?.length) parts.push(`renamed: ${e.renamed.slice(0, 2).map((r) => `${esc(r.from)} to ${esc(r.to)}`).join(', ')}`);
                if (e.changed?.length) parts.push(`changed: ${e.changed.slice(0, 3).map(esc).join(', ')}`);
                if (e.missing?.length) parts.push(`removed upstream: ${e.missing.slice(0, 3).map(esc).join(', ')}`);
                if (e.restored?.length) parts.push(`back: ${e.restored.slice(0, 3).map(esc).join(', ')}`);
                return `<div class="ih-log-row"><span class="ih-log-when">${esc(timeAgo(e.at))}</span><span class="ih-log-src">${esc(label)}</span><span>${parts.join(' · ')}</span></div>`;
            }).join('')}</div>
        </div>` : '';

    const issues = (pd.localResources || []).filter((r) => r && r.type === 'Zap' && r.zapMeta?.externalIssues?.length)
        .flatMap((z) => z.zapMeta.externalIssues.map((i) => ({ zap: z.name, ...i })));
    const issueHtml = issues.length ? `
        <div class="ih-group">
            <div class="ih-group-title">Zaps pointing at something to check (${issues.length})</div>
            <div class="ih-log">${issues.slice(0, 8).map((i) => `<div class="ih-log-row"><span class="ih-log-src">${esc(i.zap)}</span><span>${esc(i.step)} uses ${esc(EXTERNAL_SOURCES[i.source]?.label || i.source)} “${esc(i.label)}”: ${i.state === 'removed_upstream' ? 'removed from the service' : i.state === 'not_pulled' ? 'that service has not been pulled yet' : 'not found in the last pull'}</span></div>`).join('')}${issues.length > 8 ? `<div class="tiny muted" style="padding:4px 0;">and ${issues.length - 8} more</div>` : ''}</div>
        </div>` : '';

    const html = `
        <div class="modal-head">
            <div class="modal-title-text">System Importer Hub</div>
            <div class="spacer"></div>
            ${connectedAny ? `<button class="btn small primary" ${st.busy ? 'disabled' : ''} onclick="OL.syncAllIntegrations()">${st.busy === 'all' ? 'Syncing...' : 'Sync all'}</button>` : ''}
            <button class="btn small soft" onclick="OL._importHub = null; OL.closeModal()">Close</button>
        </div>
        <div class="modal-body">
            <p class="tiny muted ih-lede">Pull live data from your connected services into ${client ? `<strong>${esc(client.meta?.name || 'this project')}</strong>` : 'the active project'}. Services already pulled once refresh by themselves when the project is opened. Keys are read from the project's Credentials and never leave the server.</p>
            ${st.note ? `<div class="ih-note ih-note-${st.note.kind}" style="white-space:pre-line;">${esc(st.note.text)}</div>` : ''}
            ${HUB_GROUPS.map((g) => `
                <div class="ih-group">
                    <div class="ih-group-title">${g.title}</div>
                    <div class="ih-grid">${g.items.map(tile).join('')}</div>
                </div>`).join('')}
            ${issueHtml}
            ${logHtml}
        </div>
    `;
    openModal(html);
};

export async function importCalendly(client, opts = {}) {
    const creds = OL.getCredsForApp(client, 'calendly');
    if (!hasKey(creds)) throw new Error("Calendly API Key missing in Credentials.");
    await secureEntry(client, creds);

    const data = await importFrom('calendly', client.id, creds.id);
    const events = data.collection || [];

    const items = events.map((ev) => {
        const externalId = String(ev.uri || '').split('/').pop();
        return {
            externalId, name: ev.name, type: 'Event', externalUrl: ev.scheduling_url,
            description: ev.description || "Calendly Event Type",
            steps: [{ id: `cal-${externalId}-s0`, name: "Client Schedules Appointment", appName: "Calendly" }],
        };
    }).filter((i) => i.externalId);
    return commitPull(client, 'calendly', items);
};

export async function importYCBM(client, opts = {}) {
    const creds = OL.getCredsForApp(client, 'youcanbookme');
    if (!hasKey(creds)) throw new Error("YCBM API Key missing in App Credentials.");

    // The account email is kept in the entry's username field (it is not a secret), or asked for once.
    let email = creds.username;
    if (!email || email.trim() === "") {
        if (opts.auto) throw needsSetup('The YouCanBook.me account email has not been entered yet.');
        email = prompt("Please enter your YouCanBookMe account email:");
        if (!email) return null; // User cancelled
        creds.username = email.trim();
        OL.persist();
    }
    await secureEntry(client, creds);

    // The backend combines the email and the stored key into the login YouCanBookMe expects.
    const profiles = await importFrom('ycbm', client.id, creds.id, { email: email.trim() });

    const items = (profiles || []).map((p) => ({
        externalId: p.id, name: p.title, type: 'Event', externalUrl: `https://${p.subdomain}.youcanbook.me`,
        steps: [{ id: `ycbm-${p.id}-s0`, name: "Customer Schedules via YCBM", appName: "YouCanBookMe" }],
    }));
    return commitPull(client, 'ycbm', items);
};

export async function importActiveCampaign(client, opts = {}) {
    const creds = OL.getCredsForApp(client, 'activecampaign');
    if (!hasKey(creds)) throw new Error("ActiveCampaign API Key missing in Credentials.");

    // The Base URL is kept in the entry's username field (not a secret), or asked for once.
    let baseUrl = creds.username;
    if (!baseUrl || !baseUrl.includes('http')) {
        if (opts.auto) throw needsSetup('The ActiveCampaign API URL has not been entered yet.');
        baseUrl = prompt("Please enter your ActiveCampaign API URL (e.g., https://accountname.api-us1.com):");
        if (!baseUrl) return null;
        baseUrl = baseUrl.trim().replace(/\/$/, "");
        creds.username = baseUrl;
        OL.persist();
    }
    await secureEntry(client, creds);

    const data = await importFrom('activecampaign', client.id, creds.id, { baseUrl });
    const autos = data.automations || [];

    const items = autos.map((auto) => ({
        externalId: auto.id, name: auto.name, type: 'Email Campaign', archetype: 'Multi-Level',
        steps: [
            { id: `ac-${auto.id}-s0`, name: "Trigger: " + (auto.enter_trigger || "Start"), appName: "ActiveCampaign" },
            { id: `ac-${auto.id}-s1`, name: "Automation Flow Sequence", appName: "ActiveCampaign" },
        ],
    }));
    return commitPull(client, 'activecampaign', items);
};

export async function importMailerLite(client, opts = {}) {
    const creds = OL.getCredsForApp(client, 'mailerlite');
    if (!hasKey(creds)) throw new Error("MailerLite API Key missing.");
    await secureEntry(client, creds);

    const data = await importFrom('mailerlite', client.id, creds.id);
    const automations = data.data || [];

    const items = automations.map((auto) => ({
        externalId: auto.id, name: auto.name, type: 'Email Campaign', archetype: 'Multi-Level',
        steps: [
            { id: `ml-${auto.id}-s0`, name: "Trigger: " + (auto.trigger_type || "Subscriber Joins"), appName: "MailerLite" },
            { id: `ml-${auto.id}-s1`, name: "Automation Flow", appName: "MailerLite" },
        ],
    }));
    return commitPull(client, 'mailerlite', items);
};

export async function importJotform(client, opts = {}) {
    const creds = OL.getCredsForApp(client, 'jotform');
    if (!hasKey(creds)) throw new Error("Jotform API Key missing.");
    await secureEntry(client, creds);

    const data = await importFrom('jotform', client.id, creds.id);
    const forms = data.content || data.data || (Array.isArray(data) ? data : []);

    const items = forms.map((form) => ({
        externalId: form.id, name: form.title, type: 'Form', externalUrl: `https://www.jotform.com/form/${form.id}`,
        steps: [{ id: `jf-${form.id}-s0`, name: "User Submits Form", appName: "Jotform" }],
    }));
    const summary = commitPull(client, 'jotform', items);
    // Forms whose logic was loaded before: read again, and say which changed (features/jotform-logic.js)
    try {
        if (typeof OL.refreshLoadedFormLogic === 'function') {
            const logicChanged = await OL.refreshLoadedFormLogic(client, opts.auto ? 10 : 30);
            if (logicChanged.length) {
                logicChanged.forEach((n) => { if (!summary.changed.includes(n)) summary.changed.push(n); });
                logExternalPull(client.projectData, { ...summary, added: [], renamed: [], changed: logicChanged.map((n) => `${n} (form logic)`), missing: [], restored: [] });
            }
        }
    } catch (e) { console.warn('Form logic refresh skipped:', e); }
    return summary;
};

export async function syncProcessStreet(client, opts = {}) {
    const targetClient = client || OL.state.clients[OL.state.activeClientId];
    const psCreds = findRegistryEntry(targetClient, APP_NAME_HINTS.processstreet);
    if (!hasKey(psCreds)) throw new Error("Process Street API Key missing in Credentials.");
    await secureEntry(targetClient, psCreds);

    // The backend pages through the workflows and returns them all.
    const psData = await importFrom('processstreet', targetClient.id, psCreds.id);
    const all = psData.items || psData.workflows || [];
    if (all.length === 0 && (targetClient.projectData.localResources || []).some((r) => r.source === 'processstreet')) {
        throw new Error("Process Street returned 0 workflows. Nothing was changed. Verify your account has 'Active' workflows.");
    }

    const items = all.map((wf) => ({
        externalId: wf.id, name: wf.name, type: 'Checklist', category: 'Flows',
        steps: [placeholderStep('ps', wf.id, 'Checklist Template', 'Process Street')],
    }));
    return commitPull(targetClient, 'processstreet', items);
};

export async function syncRedtail(client, opts = {}) {
    const targetClient = client || OL.state.clients[OL.state.activeClientId];
    if (!targetClient || !targetClient.projectData) return null;

    const rtCreds = findRegistryEntry(targetClient, APP_NAME_HINTS.redtail);
    if (!hasKey(rtCreds)) throw new Error("Redtail API Key missing in Credentials.");
    await secureEntry(targetClient, rtCreds);

    // The service answers in pages; collect them all before touching anything, so a failure part-way changes nothing.
    let all = [];
    let page = 1;
    let totalPages = 1;
    do {
        const result = await importFrom('redtail', targetClient.id, rtCreds.id, { page });
        all = all.concat(result.workflow_templates || []);
        totalPages = result.total_pages || 1;
        page++;
    } while (page <= totalPages);

    const items = all.filter((wf) => wf && wf.id != null).map((wf) => ({
        externalId: wf.id, name: wf.name, type: 'Workflow', category: 'Flows', archetype: 'Multi-Level',
        steps: [placeholderStep('redtail', wf.id, 'Workflow Template', 'Redtail')],
    }));
    return commitPull(targetClient, 'redtail', items);
};

// Which access entry holds the key for an outside system: the entry whose app name matches, preferring
// one that actually has a key (stored securely, or still in plain text from before secure storage).
const APP_NAME_HINTS = {
    wealthbox: ['wealthbox'], redtail: ['redtail'], calendly: ['calendly'], mailerlite: ['mailerlite'],
    jotform: ['jotform'], activecampaign: ['activecampaign', 'active campaign'],
    youcanbookme: ['youcanbook', 'ycbm'], ycbm: ['youcanbook', 'ycbm'],
    processstreet: ['processstreet', 'process street']
};
function findRegistryEntry(client, hints) {
    const registry = client?.projectData?.accessRegistry || [];
    const apps = client?.projectData?.localApps || [];
    const matches = registry.filter((r) => {
        const name = (apps.find((a) => a.id === r.appId)?.name || '').toLowerCase();
        return hints.some((h) => name.includes(h));
    });
    return matches.find((r) => r.secretSet || String(r.secret || '').trim()) || matches[0] || null;
}
const hasKey = (entry) => !!(entry && (entry.secretSet || String(entry.secret || '').trim()));

export function getCredsForApp(client, appSlug) {
    return findRegistryEntry(client, APP_NAME_HINTS[appSlug] || [String(appSlug || '').toLowerCase()]);
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
            const arrow = types.includes('condition') ? '◆' : types.includes('loop') ? '↺' : types.includes('delay') ? '◷' : '→';
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

// ---- Zap import window (the logic lives in zap-import-ui.js and zap-import-core.js) ----
const zapImport = createZapImport({
    state, esc, uid, persist, markClientDirty, db,
    getUserName: () => (typeof OL.getCurrentUserName === 'function' ? OL.getCurrentUserName() : ''),
    openModal: (html) => window.openModal(html),
    closeModal: () => OL.closeModal(),
    afterApply: () => {
        if (typeof OL.syncLogicPorts === 'function') OL.syncLogicPorts();
        if (typeof OL.renderVisualizer === 'function') OL.renderVisualizer(false);
        if (typeof OL.renderWorkbenchItemsOnly === 'function') OL.renderWorkbenchItemsOnly();
    },
});

// ---- bridge: keep OL.* calls working until callers import directly ----
window.OL = window.OL || {};
Object.assign(window.OL, zapImport.api);
Object.assign(window.OL, {
    processZapLogic, bulkImportZaps, syncWealthbox, openImportHub,
    upsertExternalResource, cleanLegacyResourceNames, syncExternalIntegrations, importCalendly,
    importYCBM, importActiveCampaign, importMailerLite, importJotform,
    syncProcessStreet, syncRedtail, syncAllIntegrations, autoPullIntegrations, getCredsForApp, printFlowMap,
    _printIcon, _printFlowchartHtml, _printCard, _printListHtml, _printStepsHtml,
    openClickUpImportModal, handleClickUpCSVFile, renderClickUpImportStep,
    setClickUpMapping, setClickUpTargetMode, setClickUpTargetClient,
    setClickUpRoutingColumn, setClickUpRoutingMapByIndex, runClickUpImport
});
