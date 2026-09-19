//======================= FEATURES / TESTING =======================//
// The screens for per-request testing (the logic is in core/testing.js):
//   - the checklist window: a request's steps, each marked Pass, Fail or Skipped, with a note
//   - a badge and buttons on each active request in the scoping sheet
//   - the Test templates editor (the steps used for each kind of request or resource)
//
// A checklist is made automatically as each request's steps are done (see core/data.js, before a save),
// so the tester can start without waiting for the rest of the round.

import { state, esc, uid, getActiveClient, updateAndSync, persist, loadFullClient } from '../core/data.js';
import {
    updateTestRuns, recordResult, markReadyForTesting, runForItem, testRunById, runProgress,
    DEFAULT_TEST_TEMPLATES, TEST_RESULTS, TESTABLE_TYPES,
} from '../core/testing.js';

const templatesInUse = () => (Array.isArray(state.master?.testTemplates) && state.master.testTemplates.length
    ? state.master.testTemplates : DEFAULT_TEST_TEMPLATES);

const closedNames = () => {
    const names = (typeof OL.getSystemStatuses === 'function' ? OL.getSystemStatuses() : []).filter((s) => s.isClosed).map((s) => s.name);
    return names.length ? names : ['Done'];
};

function contextFor(client) {
    return {
        templates: templatesInUse(),
        roles: state.master?.roles || [],
        closedNames: closedNames(),
        resourceFor: (item) => (item && item.resourceId && typeof OL.getResourceById === 'function' ? OL.getResourceById(item.resourceId) : null),
        uid,
        now: new Date().toISOString(),
    };
}

// Called by the app just before a project is saved, so new checklists and fix tasks are saved with it.
export function updateTestRunsFor(client) {
    return updateTestRuns(client, contextFor(client));
}

const currentUser = () => (typeof OL.getCurrentUserName === 'function' ? OL.getCurrentUserName() : '') || 'Someone';

async function clientFor(clientId) {
    if (clientId && state.clients?.[clientId]) {
        const full = await loadFullClient(clientId).catch(() => null);
        return full || state.clients[clientId];
    }
    return getActiveClient();
}

function refreshScopingIfOpen() {
    if (typeof document !== 'undefined' && document.getElementById('scoping-search-input') && typeof window.renderScopingSheet === 'function') {
        window.renderScopingSheet();
    }
}

// ---------------- the checklist window ----------------
const RESULT_STYLE = {
    pass: { label: 'Pass', color: '#22c55e' },
    fail: { label: 'Fail', color: '#ef4444' },
    skip: { label: 'Skip', color: '#94a3b8' },
};

function stepHtml(run, step, i, clientId, tasks) {
    const btn = (result) => {
        const on = step.result === result;
        const c = RESULT_STYLE[result].color;
        return `<button type="button" class="btn tiny ${on ? 'primary' : 'soft'}" style="${on ? `background:${c}; border-color:${c}; color:#fff;` : ''}"
                        onclick="OL.setTestResult('${run.id}', '${step.id}', '${result}', '${clientId}')">${RESULT_STYLE[result].label}</button>`;
    };
    const fixTask = step.fixTaskId ? tasks.find((t) => t.id === step.fixTaskId) : null;
    return `
        <div style="border:1px solid var(--line); border-radius:8px; padding:12px; margin-bottom:10px;">
            <div style="display:flex; justify-content:space-between; gap:10px; align-items:flex-start;">
                <div>
                    <div class="bold">${i + 1}. ${esc(step.title)}
                        ${step.retest ? `<span class="pill tiny" style="margin-left:6px; border:1px solid #f59e0b; color:#f59e0b;">Retest: fixed since it failed</span>` : ''}
                    </div>
                    ${step.how ? `<div class="tiny muted" style="margin-top:4px;"><strong>How:</strong> ${esc(step.how)}</div>` : ''}
                    ${step.expected ? `<div class="tiny muted"><strong>Expected:</strong> ${esc(step.expected)}</div>` : ''}
                    ${step.retest && step.previousNote ? `<div class="tiny" style="margin-top:4px; color:#f59e0b;">It failed before: ${esc(step.previousNote)}</div>` : ''}
                </div>
                <div style="display:flex; gap:6px; flex:0 0 auto;">
                    ${btn('pass')}${btn('fail')}${btn('skip')}
                    ${step.result ? `<button type="button" class="btn tiny soft" title="Clear this result" onclick="OL.setTestResult('${run.id}', '${step.id}', '', '${clientId}')">✕</button>` : ''}
                </div>
            </div>
            <textarea class="modal-input tiny" rows="2" style="margin-top:8px; width:100%; box-sizing:border-box;" placeholder="Note (what you saw, or what went wrong)"
                      onchange="OL.setTestNote('${run.id}', '${step.id}', this.value, '${clientId}')">${esc(step.note || '')}</textarea>
            ${step.result === 'fail' && fixTask ? `<div class="tiny" style="margin-top:6px; color:#ef4444;">A fix task was created for ${esc(fixTask.assignee || 'Sphynx')}${isClosedTask(fixTask) ? ' (done: it will come back for retest)' : ''}.</div>` : ''}
            ${step.result ? `<div class="tiny muted" style="margin-top:4px;">${esc(RESULT_STYLE[step.result].label)} by ${esc(step.by || 'someone')}${step.at ? ' on ' + esc(String(step.at).slice(0, 10)) : ''}</div>` : ''}
        </div>`;
}
const isClosedTask = (t) => closedNames().includes(String(t.status || ''));

export async function openTestRun(runId, clientId) {
    const client = await clientFor(clientId);
    const run = testRunById(client, runId);
    if (!run) { alert('That checklist could not be found.'); return; }
    OL._testRunOpen = { runId, clientId: client.id };
    const p = runProgress(run);
    const tasks = client.projectData.clientTasks || [];
    const done = p.passed + p.skipped;
    const pct = p.total ? Math.round((done / p.total) * 100) : 0;
    const statusPill = run.status === 'passed'
        ? `<span class="pill tiny" style="border:1px solid #22c55e; color:#22c55e;">✅ Passed</span>`
        : run.status === 'needs_fix'
            ? `<span class="pill tiny" style="border:1px solid #ef4444; color:#ef4444;">Needs a fix</span>`
            : `<span class="pill tiny" style="border:1px solid #f59e0b; color:#f59e0b;">In testing</span>`;
    openModal(`
        <div class="modal-head">
            <div class="modal-title-text">🧪 Test: ${esc(run.title)}</div>
            <div class="spacer"></div>
            <button class="btn small soft" onclick="OL.closeModal()">Close</button>
        </div>
        <div class="modal-body" style="max-width:820px; box-sizing:border-box;">
            <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-bottom:8px;">
                ${statusPill}
                <span class="tiny muted">${esc(run.requestType)}${run.resourceName ? ' · ' + esc(run.resourceName) : ''} · round ${esc(run.round)}</span>
            </div>
            <div style="height:8px; border-radius:6px; background:rgba(148,163,184,0.25); overflow:hidden; margin-bottom:6px;">
                <div style="height:100%; width:${pct}%; background:#22c55e;"></div>
            </div>
            <div class="tiny muted" style="margin-bottom:14px;">${done} of ${p.total} done${p.failed ? `, ${p.failed} failed` : ''}${p.pending ? `, ${p.pending} left` : ''}</div>
            ${(run.steps || []).map((s, i) => stepHtml(run, s, i, client.id, tasks)).join('')}
        </div>`);
}

async function mutate(clientId, fn) {
    const client = await clientFor(clientId);
    if (!client) return null;
    await updateAndSync(() => { fn(client); updateTestRunsFor(client); }, client.id);
    return client;
}

export async function setTestResult(runId, stepId, result, clientId) {
    const before = await clientFor(clientId);
    const run = testRunById(before, runId);
    const step = run?.steps?.find((s) => s.id === stepId);
    if (!step) return;
    let note;
    if (result === TEST_RESULTS.FAIL && !String(step.note || '').trim()) {
        const answer = prompt('What went wrong? This goes on the fix task so the builder knows what to change.');
        if (answer === null) return;          // cancelled: nothing is marked failed
        note = answer.trim();
    }
    const client = await mutate(clientId, (c) => {
        recordResult(testRunById(c, runId), stepId, result, { note, by: currentUser(), now: new Date().toISOString() });
    });
    if (client) { await openTestRun(runId, client.id); refreshScopingIfOpen(); }
}

export async function setTestNote(runId, stepId, note, clientId) {
    await mutate(clientId, (c) => {
        const step = testRunById(c, runId)?.steps?.find((s) => s.id === stepId);
        if (step) step.note = String(note || '');
    });
}

export async function markReady(itemId) {
    const client = getActiveClient();
    if (!client) return;
    await updateAndSync(() => { markReadyForTesting(client, itemId); updateTestRunsFor(client); }, client.id);
    refreshScopingIfOpen();
}

// ---------------- scoping sheet: badge and buttons on an active request ----------------
export function testBadgeHtml(client, item, canAct) {
    if (!client || !item) return '';
    const requestType = String(item.requestType || 'build');
    if (!TESTABLE_TYPES.includes(requestType)) return '';
    const run = runForItem(client, item.id);
    if (run) {
        const p = runProgress(run);
        const color = run.status === 'passed' ? '#22c55e' : run.status === 'needs_fix' ? '#ef4444' : '#38bdf8';
        const text = run.status === 'passed' ? '✅ Tested' : `🧪 Testing ${p.passed + p.skipped}/${p.total}${p.failed ? `, ${p.failed} failed` : ''}`;
        return `<span class="pill tiny" style="border:1px solid ${color}; color:${color};">${text}</span>
                <button class="btn tiny soft" onclick="OL.openTestRun('${run.id}', '${esc(client.id)}')">Open checklist</button>`;
    }
    return canAct ? `<button class="btn tiny soft" title="Start testing this request now" onclick="OL.markReadyForTesting('${esc(item.id)}')">Ready for testing</button>` : '';
}

// ---------------- Test templates ----------------
const stepsToText = (steps) => (steps || []).map((s) => [s.title, s.how || '', s.expected || ''].join(' | ')).join('\n');
const textToSteps = (text) => String(text || '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const [title, how, expected] = l.split('|').map((x) => (x || '').trim());
    return { title, how: how || '', expected: expected || '' };
}).filter((s) => s.title);
const csv = (v) => String(v || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);

export function openTestTemplates() {
    const list = templatesInUse().map((t) => JSON.parse(JSON.stringify(t)));
    OL._testTemplateDraft = list;
    const usingDefaults = !(Array.isArray(state.master?.testTemplates) && state.master.testTemplates.length);
    const canSave = state.masterHasTestTemplates !== false;
    openModal(`
        <div class="modal-head">
            <div class="modal-title-text">🧪 Test templates</div>
            <div class="spacer"></div>
            <button class="btn small soft" onclick="OL.closeModal()">Close</button>
        </div>
        <div class="modal-body" style="max-width:900px; box-sizing:border-box;">
            <div class="tiny muted" style="margin-bottom:10px;">
                These are the steps a tester works through. A request gets the templates that match its type and its resource's type
                (for example, a Zap build gets "Zap"). "General" is used only when nothing else matches a build or revision.
                One step per line, written as <code>title | how to test | expected result</code>. Use {resource} and {request} to insert names.
                ${usingDefaults ? '<br><strong>You are using the starter set.</strong> Save to keep your own version.' : ''}
                ${canSave ? '' : '<br><strong style="color:#ef4444;">Templates cannot be saved yet: run 013_test_templates.sql in Supabase, then reload.</strong>'}
            </div>
            <div id="tt-list">${list.map((t, i) => templateEditorHtml(t, i)).join('')}</div>
            <div style="display:flex; gap:8px; margin-top:8px;">
                <button class="btn tiny soft" onclick="OL.addTestTemplate()">+ Add a template</button>
                <button class="btn tiny soft" onclick="OL.resetTestTemplates()">Reset to the starter set</button>
                <div class="spacer" style="flex:1;"></div>
                <button class="btn primary" ${canSave ? '' : 'disabled'} onclick="OL.saveTestTemplates()">Save</button>
            </div>
        </div>`);
}

function templateEditorHtml(t, i) {
    return `
        <div class="tt-card" data-i="${i}" style="border:1px solid var(--line); border-radius:8px; padding:10px; margin-bottom:10px;">
            <div style="display:grid; grid-template-columns: 1.2fr 1fr 1fr auto auto; gap:8px; align-items:center;">
                <input class="modal-input tiny tt-name" placeholder="Name" value="${esc(t.name || '')}">
                <input class="modal-input tiny tt-req" placeholder="Request types: build, revision" value="${esc((t.requestTypes || []).join(', '))}">
                <input class="modal-input tiny tt-res" placeholder="Resource types: zap, form" value="${esc((t.resourceTypes || []).join(', '))}">
                <label class="tiny" style="white-space:nowrap;"><input type="checkbox" class="tt-fallback" ${t.fallback ? 'checked' : ''}> General</label>
                <button class="btn tiny soft" title="Remove this template" onclick="OL.removeTestTemplate(${i})">✕</button>
            </div>
            <textarea class="modal-input tiny tt-steps" rows="${Math.max(3, (t.steps || []).length + 1)}" style="margin-top:8px; width:100%; box-sizing:border-box; font-family:monospace;"
                      placeholder="title | how to test | expected result">${esc(stepsToText(t.steps))}</textarea>
        </div>`;
}

function readDraft() {
    return Array.from(document.querySelectorAll('.tt-card')).map((card, i) => ({
        id: (OL._testTemplateDraft?.[i]?.id) || ('tt-' + uid()),
        name: card.querySelector('.tt-name').value.trim() || 'Untitled',
        requestTypes: csv(card.querySelector('.tt-req').value),
        resourceTypes: csv(card.querySelector('.tt-res').value),
        fallback: card.querySelector('.tt-fallback').checked,
        steps: textToSteps(card.querySelector('.tt-steps').value),
    }));
}
const redraw = (list) => { OL._testTemplateDraft = list; document.getElementById('tt-list').innerHTML = list.map((t, i) => templateEditorHtml(t, i)).join(''); };

export function addTestTemplate() {
    const list = readDraft();
    list.push({ id: 'tt-' + uid(), name: 'New template', requestTypes: ['build'], resourceTypes: [], fallback: false, steps: [{ title: 'First step', how: '', expected: '' }] });
    redraw(list);
}
export function removeTestTemplate(i) {
    const list = readDraft(); list.splice(i, 1); redraw(list);
}
export function resetTestTemplates() {
    if (confirm('Replace everything here with the starter set?')) redraw(JSON.parse(JSON.stringify(DEFAULT_TEST_TEMPLATES)));
}
export function saveTestTemplates() {
    if (state.masterHasTestTemplates === false) { alert('Run 013_test_templates.sql in Supabase first, then reload.'); return; }
    const list = readDraft().filter((t) => t.steps.length);
    state.master.testTemplates = list;
    persist();
    OL.closeModal();
    alert(`Saved ${list.length} test template${list.length === 1 ? '' : 's'}. They apply to checklists made from now on.`);
}

window.OL = window.OL || {};
Object.assign(window.OL, {
    updateTestRunsFor, openTestRun, setTestResult, setTestNote, markReadyForTesting: markReady, testBadgeHtml,
    openTestTemplates, addTestTemplate, removeTestTemplate, resetTestTemplates, saveTestTemplates,
});
