//======================= FEATURES / ONBOARDING =======================//
// Guided setup wizard, launched from a persistent "Get Started" button so
// it's reachable at any time, not just on first login. Progress + answers
// live on the viewer's own client record (client.meta.onboarding) so the
// wizard can always be resumed or re-opened to review/edit later.
//
// PARTNER FLOW ONLY for now (10 steps below). The step machinery here is
// written to be reused for an admin/team-member flow later — see
// ONBOARDING_FLOWS.
//
// Several steps only create SHELLS (a placeholder record + a task to
// finish it) rather than fully-formed content — that's intentional per
// the spec ("we'll fill in the details later"). Those spots are marked.

import { state, esc, uid, getActiveClient, persist, updateAndSync } from '../core/data.js';

const DEFAULT_PARTNER_PIPELINE = ['Discovery', 'Onboarding', 'Initial Client', 'Ongoing Client', 'Former Prospect', 'Former Client'];

// Import-ready systems for Step 9 — matches the real importer keys wired
// up in features/integrations.js (System Importer Hub), so the API key
// captured here lines up with what that hub's sync functions expect.
const IMPORT_READY_SYSTEMS = [
    { id: 'wealthbox', name: 'Wealthbox' },
    { id: 'redtail', name: 'Redtail' },
    { id: 'calendly', name: 'Calendly' },
    { id: 'jotform', name: 'Jotform' },
    { id: 'ycbm', name: 'YouCanBook.me' },
    { id: 'activecampaign', name: 'ActiveCampaign' },
];

const ONBOARDING_FLOWS = {
    partner: [
        'yourInfo', 'yourTeam', 'appsUsed', 'pipelineStages',
        'runsComparisons', 'preloadAnalyses', 'otherAnalyses',
        'clientSOPs', 'resourceImports', 'clientProjects'
    ]
};

function getWizardClient() {
    // The wizard always operates on the viewer's own record — a partner
    // filling this out IS the active client in their session.
    return getActiveClient();
}

function getOnboardingState(client) {
    if (!client.meta.onboarding) {
        client.meta.onboarding = { flow: 'partner', stepIndex: 0, completed: false, answers: {} };
    }
    return client.meta.onboarding;
}

// ---- entry point: the "Get Started" button calls this, any time ----
export function openOnboardingWizard(startAtStep) {
    const client = getWizardClient();
    if (!client) return;

    const ob = getOnboardingState(client);
    if (typeof startAtStep === 'number') ob.stepIndex = startAtStep;

    renderOnboardingStep();
}

function currentFlow(client) {
    return ONBOARDING_FLOWS[client.meta.onboarding.flow] || ONBOARDING_FLOWS.partner;
}

function renderOnboardingStep() {
    const client = getWizardClient();
    if (!client) return;
    const ob = getOnboardingState(client);
    const flow = currentFlow(client);
    const stepKey = flow[ob.stepIndex];
    const total = flow.length;

    const stepRenderer = STEP_RENDERERS[stepKey];
    const bodyHtml = stepRenderer ? stepRenderer(client, ob) : `<p class="tiny muted">Step not found.</p>`;

    const html = `
        <div class="modal-head">
            <div class="modal-title-text">🚀 Get Started — Step ${ob.stepIndex + 1} of ${total}</div>
            <div class="spacer"></div>
            <button class="btn small soft" onclick="OL.closeModal()">Close</button>
        </div>
        <div class="modal-body" id="ol-onboarding-body">
            <div class="onboarding-progress" style="display:flex; gap:4px; margin-bottom:18px;">
                ${flow.map((_, i) => `
                    <div style="flex:1; height:4px; border-radius:2px; background:${i <= ob.stepIndex ? 'var(--accent)' : 'var(--panel-border)'};"></div>
                `).join('')}
            </div>
            ${bodyHtml}
            <div class="onboarding-nav" style="display:flex; justify-content:space-between; margin-top:24px; padding-top:16px; border-top:1px solid var(--panel-border);">
                <div>
                    ${ob.stepIndex > 0 ? `<button class="btn small soft" onclick="OL.onboardingBack()">Back</button>` : ''}
                </div>
                <div style="display:flex; gap:8px;">
                    ${STEP_SKIPPABLE[stepKey] ? `<button class="btn small soft" onclick="OL.onboardingNext(true)">Skip</button>` : ''}
                    <button class="btn small primary" onclick="OL.onboardingNext(false)">
                        ${ob.stepIndex === total - 1 ? 'Finish' : 'Next'}
                    </button>
                </div>
            </div>
        </div>
    `;
    openModal(html);
    if (window.lucide) window.lucide.createIcons();
}

export function onboardingBack() {
    const client = getWizardClient();
    if (!client) return;
    const ob = getOnboardingState(client);
    ob.stepIndex = Math.max(0, ob.stepIndex - 1);
    renderOnboardingStep();
}

export function onboardingNext(skipped) {
    const client = getWizardClient();
    if (!client) return;
    const ob = getOnboardingState(client);
    const flow = currentFlow(client);
    const stepKey = flow[ob.stepIndex];

    if (!skipped) {
        const committer = STEP_COMMITTERS[stepKey];
        if (committer) committer(client, ob);
    }

    if (ob.stepIndex >= flow.length - 1) {
        ob.completed = true;
        OL.markClientDirty(client.id);
        OL.persist().then(() => {
            OL.closeModal();
            if (typeof window.renderClientDashboard === 'function') window.renderClientDashboard();
            alert("You're all set! You can revisit Get Started any time from the header to review or add more.");
        });
        return;
    }

    let nextIndex = ob.stepIndex + 1;
    // Auto-skip "preload analyses" if they said they don't run comparisons.
    if (flow[nextIndex] === 'preloadAnalyses' && ob.answers.runsComparisons === false) {
        nextIndex += 1;
    }

    if (nextIndex >= flow.length) {
        ob.completed = true;
        OL.markClientDirty(client.id);
        OL.persist().then(() => {
            OL.closeModal();
            if (typeof window.renderClientDashboard === 'function') window.renderClientDashboard();
            alert("You're all set! You can revisit Get Started any time from the header to review or add more.");
        });
        return;
    }

    ob.stepIndex = nextIndex;
    OL.markClientDirty(client.id);
    OL.persist();
    renderOnboardingStep();
}

// Small helper for the repeating "add a row" steps (team, other analyses,
// SOPs, client projects) — reads whatever rows are currently in the DOM
// list so committers don't need to track a separate draft array.
function readRowInputs(containerId, fieldNames) {
    const container = document.getElementById(containerId);
    if (!container) return [];
    return Array.from(container.querySelectorAll('.ob-row')).map(row => {
        const entry = {};
        fieldNames.forEach(f => {
            const el = row.querySelector(`[data-field="${f}"]`);
            entry[f] = el ? el.value.trim() : '';
        });
        return entry;
    }).filter(entry => Object.values(entry).some(v => v));
}

function addOnboardingRow(containerId, rowHtml, wrapperClass) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const wrap = document.createElement('div');
    wrap.className = wrapperClass || 'ob-row';
    if (!wrapperClass) wrap.style.cssText = 'display:flex; gap:8px; margin-bottom:8px;';
    wrap.innerHTML = rowHtml;
    container.appendChild(wrap);
    if (window.lucide) window.lucide.createIcons();
}

// ============================= STEP 1: Your Info =============================
function renderYourInfoStep(client) {
    const you = (client.projectData.teamMembers || []).find(m => m.isPrimaryContact) || {};
    const initials = (you.name || '').split(' ').filter(Boolean).map(n => n[0]).join('').toUpperCase().substring(0, 2) || '👋';
    return `
        <div class="ob-avatar-row">
            <div class="ob-avatar-circle">${initials}</div>
            <p class="tiny muted" style="margin:0;">Let's start with you — this becomes your primary contact card.</p>
        </div>
        <div class="ob-field-grid">
            <div class="ob-field">
                <label>Your Name</label>
                <input type="text" id="ob-your-name" class="modal-input" value="${esc(you.name || '')}" placeholder="Jane Smith">
            </div>
            <div class="ob-field">
                <label>Your Email</label>
                <input type="email" id="ob-your-email" class="modal-input" value="${esc(you.email || '')}" placeholder="jane@example.com">
            </div>
            <div class="ob-field">
                <label>Your Phone</label>
                <input type="text" id="ob-your-phone" class="modal-input" value="${esc(you.phone || '')}" placeholder="(555) 555-5555">
            </div>
            <div class="ob-field">
                <label>Your Role</label>
                <input type="text" id="ob-your-role" class="modal-input" value="${esc(you.role || '')}" placeholder="Owner / Advisor / Ops Lead">
            </div>
        </div>
    `;
}
function commitYourInfoStep(client) {
    const name = document.getElementById('ob-your-name')?.value.trim();
    const email = document.getElementById('ob-your-email')?.value.trim();
    const phone = document.getElementById('ob-your-phone')?.value.trim();
    const role = document.getElementById('ob-your-role')?.value.trim();
    if (!name) return;

    if (!client.projectData.teamMembers) client.projectData.teamMembers = [];
    const members = client.projectData.teamMembers;

    // Match on the isPrimaryContact flag first; fall back to matching by
    // name+email so a re-run after a dropped save (flag lost, entry still
    // present) upserts the same person instead of creating a second one.
    let matches = members.filter(m =>
        m.isPrimaryContact ||
        (email && m.email && m.email.toLowerCase() === email.toLowerCase()) ||
        (!email && m.name && m.name.toLowerCase() === name.toLowerCase())
    );

    let you;
    if (matches.length) {
        you = matches[0];
        // Self-heal: if more than one row matched (an accidental duplicate
        // from an earlier run), collapse the rest instead of leaving them.
        if (matches.length > 1) {
            const toRemove = new Set(matches.slice(1).map(m => m.id));
            client.projectData.teamMembers = members.filter(m => !toRemove.has(m.id));
        }
    } else {
        you = { id: uid(), roles: [] };
        client.projectData.teamMembers.push(you);
    }

    you.isPrimaryContact = true;
    Object.assign(you, { name, email, phone, role });
}

// ============================= STEP 2: Your Team =============================
function renderYourTeamStep(client) {
    const members = (client.projectData.teamMembers || []).filter(m => !m.isPrimaryContact);
    const rowHtml = (m = {}) => `
        <div class="ob-field-grid">
            <div class="ob-field"><label>Name</label><input type="text" data-field="name" class="modal-input" value="${esc(m.name || '')}"></div>
            <div class="ob-field"><label>Email</label><input type="email" data-field="email" class="modal-input" value="${esc(m.email || '')}"></div>
            <div class="ob-field"><label>Phone</label><input type="text" data-field="phone" class="modal-input" value="${esc(m.phone || '')}"></div>
            <div class="ob-field"><label>Role</label><input type="text" data-field="role" class="modal-input" value="${esc(m.role || '')}"></div>
        </div>
        <button class="btn tiny soft ob-remove-row" onclick="this.closest('.ob-row').remove()"><i data-lucide="x" style="width:12px;height:12px;"></i></button>
    `;
    return `
        <p class="tiny muted" style="margin-bottom:14px;">Add the rest of your team — you're already added from the last step. You can always add more later from the Team tab.</p>
        <div id="ob-team-rows">
            ${members.length ? members.map(m => `<div class="ob-row ob-team-card">${rowHtml(m)}</div>`).join('') : `<div class="ob-row ob-team-card">${rowHtml()}</div>`}
        </div>
        <button class="btn small soft ob-add-more-btn" onclick="OL.onboardingAddRow('ob-team-rows', 'team')">+ Add team member</button>
    `;
}
function commitYourTeamStep(client) {
    const rows = readRowInputs('ob-team-rows', ['name', 'email', 'phone', 'role']);
    if (!client.projectData.teamMembers) client.projectData.teamMembers = [];

    const primary = client.projectData.teamMembers.find(m => m.isPrimaryContact);
    const isPrimaryRow = (row) =>
        primary && (
            (row.email && primary.email && row.email.toLowerCase() === primary.email.toLowerCase()) ||
            (!row.email && !primary.email && row.name.toLowerCase() === (primary.name || '').toLowerCase())
        );

    const existingNonPrimary = client.projectData.teamMembers.filter(m => !m.isPrimaryContact);
    let cursor = 0;
    rows.forEach(row => {
        if (!row.name) return;
        if (isPrimaryRow(row)) return; // skip re-adding yourself as a regular team member
        const existing = existingNonPrimary[cursor];
        cursor += 1;
        if (existing) {
            Object.assign(existing, row);
        } else {
            client.projectData.teamMembers.push({ id: uid(), roles: [], ...row });
        }
    });
}

// ============================= STEP 3: Apps Used =============================
function renderAppsUsedStep(client) {
    const localApps = client.projectData.localApps || [];
    const linkedRefIds = new Set(localApps.map(a => String(a.masterRefId)));
    const allFunctions = state.master.functions || [];
    const allApps = state.master.apps || [];

    // Group by the Function(s) each app is mapped to in the master vault
    // (app.functionIds), not app.category — category is mostly unset, but
    // every app should have at least one function like CRM/Scheduler/Email
    // Marketing linked from the Functions library.
    const grouped = {};
    const seenAppIds = new Set();
    allFunctions.forEach(fn => {
        const appsForFn = allApps.filter(a =>
            (a.functionIds || []).some(m => String(typeof m === 'string' ? m : m.id) === String(fn.id))
        );
        if (appsForFn.length) {
            grouped[fn.name] = appsForFn;
            appsForFn.forEach(a => seenAppIds.add(a.id));
        }
    });
    const unmapped = allApps.filter(a => !seenAppIds.has(a.id));
    if (unmapped.length) grouped['Other'] = unmapped;

    return `
        <p class="tiny muted" style="margin-bottom:14px;">Which applications does your team use? Click to select — we'll add them to your workspace.</p>
        <div id="ob-apps-groups">
            ${Object.keys(grouped).sort((a, b) => a === 'Other' ? 1 : b === 'Other' ? -1 : a.localeCompare(b)).map(fnName => `
                <span class="ob-pill-group-label">${esc(fnName)}</span>
                <div class="ob-pill-group">
                    ${grouped[fnName].map(app => `
                        <div class="ob-pill ${linkedRefIds.has(String(app.id)) ? 'selected' : ''}"
                             data-app-id="${app.id}" onclick="this.classList.toggle('selected')">
                            ${esc(app.name)}
                        </div>
                    `).join('')}
                </div>
            `).join('') || '<p class="tiny muted">No apps in your master vault yet — you can add these later from the Apps tab.</p>'}
        </div>
    `;
}
function commitAppsUsedStep(client) {
    const selected = Array.from(document.querySelectorAll('#ob-apps-groups .ob-pill.selected'));
    if (!client.projectData.localApps) client.projectData.localApps = [];
    const seenMasterIds = new Set();
    selected.forEach(pill => {
        const masterId = pill.getAttribute('data-app-id');
        if (seenMasterIds.has(masterId)) return; // an app can appear under multiple function groups
        seenMasterIds.add(masterId);
        const already = client.projectData.localApps.find(a => String(a.masterRefId) === String(masterId));
        if (already) return;
        // Reuse the same provisioning path the Apps tab uses — this is what
        // copies the app's linked Functions (functionIds) across and adds
        // them to client.sharedMasterIds so they actually show up under the
        // client's Functions tab. Pushing a bare localApps record (the old
        // behavior here) skipped that, so selected apps came in with no
        // functions attached.
        if (typeof OL.pushAppToClient === 'function') {
            OL.pushAppToClient(masterId, client.id);
        }
    });
}

// ============================= STEP 4: Pipeline Stages =============================
function renderPipelineStagesStep(client) {
    const current = (client.meta.pipelineStatuses && client.meta.pipelineStatuses.length)
        ? client.meta.pipelineStatuses
        : DEFAULT_PARTNER_PIPELINE;
    return `
        <p class="tiny muted" style="margin-bottom:14px;">
            When working with clients, what are the high-level stages of your client lifecycle?
            These become your pipeline filters on the client dashboard.
        </p>
        <div class="ob-chip-row" id="ob-pipeline-chips">
            ${current.map(stage => `
                <div class="ob-chip" data-stage="${esc(stage)}">
                    ${esc(stage)}
                    <button type="button" onclick="this.closest('.ob-chip').remove()">×</button>
                </div>
            `).join('')}
        </div>
        <div class="ob-chip-input-row">
            <input type="text" id="ob-pipeline-input" class="modal-input" placeholder="Add a stage and press Enter"
                   onkeydown="if(event.key==='Enter'){event.preventDefault(); OL.onboardingAddPipelineStage();}">
            <button class="btn small primary" type="button" onclick="OL.onboardingAddPipelineStage()">+ Add</button>
        </div>
    `;
}
export function onboardingAddPipelineStage() {
    const input = document.getElementById('ob-pipeline-input');
    const value = input?.value.trim();
    if (!value) return;
    const container = document.getElementById('ob-pipeline-chips');
    if (!container) return;
    if (Array.from(container.querySelectorAll('.ob-chip')).some(c => c.getAttribute('data-stage').toLowerCase() === value.toLowerCase())) {
        input.value = '';
        return;
    }
    const chip = document.createElement('div');
    chip.className = 'ob-chip';
    chip.setAttribute('data-stage', value);
    chip.innerHTML = `${esc(value)} <button type="button" onclick="this.closest('.ob-chip').remove()">×</button>`;
    container.appendChild(chip);
    input.value = '';
    input.focus();
}
function commitPipelineStagesStep(client) {
    const chips = Array.from(document.querySelectorAll('#ob-pipeline-chips .ob-chip'));
    const stages = chips.map(c => c.getAttribute('data-stage')).filter(Boolean);
    if (stages.length) client.meta.pipelineStatuses = stages;
}

// ============================= STEP 5: Runs Comparisons? =============================
function renderRunsComparisonsStep(client, ob) {
    const val = ob.answers.runsComparisons;
    return `
        <p class="tiny muted" style="margin-bottom:14px;">Do you run any software comparisons with your clients to help them choose the right application for their needs?</p>
        <div style="display:flex; gap:10px;">
            <label class="btn small ${val === true ? 'primary' : 'soft'}" style="cursor:pointer;">
                <input type="radio" name="ob-runs-comparisons" value="yes" ${val === true ? 'checked' : ''} style="display:none;" onclick="this.closest('label').parentElement.querySelectorAll('label').forEach(l=>l.className='btn small soft'); this.closest('label').className='btn small primary';"> Yes
            </label>
            <label class="btn small ${val === false ? 'primary' : 'soft'}" style="cursor:pointer;">
                <input type="radio" name="ob-runs-comparisons" value="no" ${val === false ? 'checked' : ''} style="display:none;" onclick="this.closest('label').parentElement.querySelectorAll('label').forEach(l=>l.className='btn small soft'); this.closest('label').className='btn small primary';"> No
            </label>
        </div>
    `;
}
function commitRunsComparisonsStep(client, ob) {
    const checked = document.querySelector('input[name="ob-runs-comparisons"]:checked');
    ob.answers.runsComparisons = checked ? checked.value === 'yes' : false;
}

// ============================= STEP 6: Preload Master Analyses =============================
function renderPreloadAnalysesStep(client) {
    const templates = state.master.analyses || [];
    const existingRefs = (client.projectData.localAnalyses || []).map(a => String(a.masterRefId)).filter(Boolean);
    return `
        <p class="tiny muted" style="margin-bottom:14px;">Choose any system comparisons you'd like preloaded into your workspace.</p>
        <div class="ob-pill-group" id="ob-preload-analyses">
            ${templates.length ? templates.map(t => {
                const already = existingRefs.includes(String(t.id));
                return `
                    <div class="ob-pill ${already ? 'selected' : ''}" data-analysis-id="${t.id}"
                         ${already ? '' : `onclick="this.classList.toggle('selected')"`}
                         style="${already ? 'opacity:0.6; cursor:default;' : ''}">
                        ${esc(t.name)}${already ? ' <span class="tiny">(added)</span>' : ''}
                    </div>
                `;
            }).join('') : '<p class="tiny muted">No master analyses available yet.</p>'}
        </div>
    `;
}
function commitPreloadAnalysesStep(client) {
    const existingRefs = (client.projectData.localAnalyses || []).map(a => String(a.masterRefId)).filter(Boolean);
    const selected = Array.from(document.querySelectorAll('#ob-preload-analyses .ob-pill.selected'))
        .filter(pill => !existingRefs.includes(pill.getAttribute('data-analysis-id')));
    selected.forEach(pill => {
        if (typeof OL.executeAnalysisImportById === 'function') {
            OL.executeAnalysisImportById(pill.getAttribute('data-analysis-id'));
        }
    });
}

// ============================= STEP 7: Other Analyses (shells) =============================
function renderOtherAnalysesStep(client) {
    const shellHtml = (name = '') => `
        <input type="text" data-field="name" class="modal-input ob-name-field" placeholder="e.g. Practice Management Software" value="${esc(name)}">
        <button class="btn tiny soft ob-remove-row" onclick="this.closest('.ob-row').remove()"><i data-lucide="x" style="width:12px;height:12px;"></i></button>
    `;
    return `
        <p class="tiny muted" style="margin-bottom:14px;">
            Are there any other comparisons not listed you'd like to create? We'll create a shell for each,
            plus a task to fill it in later.
        </p>
        <div id="ob-other-analyses-rows">
            <div class="ob-row ob-row-flex">${shellHtml()}</div>
        </div>
        <button class="btn small soft ob-add-more-btn" onclick="OL.onboardingAddRow('ob-other-analyses-rows', 'nameOnly')">+ Add another</button>
    `;
}
function commitOtherAnalysesStep(client) {
    const rows = readRowInputs('ob-other-analyses-rows', ['name']);
    if (!client.projectData.localAnalyses) client.projectData.localAnalyses = [];
    if (!client.projectData.clientTasks) client.projectData.clientTasks = [];

    rows.forEach(row => {
        if (!row.name) return;
        const id = 'anly-' + uid();
        client.projectData.localAnalyses.push({
            id, name: row.name, features: [], apps: [], categories: ['General'],
            createdDate: new Date().toISOString(), isShell: true
        });
        client.projectData.clientTasks.unshift({
            id: uid(), title: `Build out analysis: ${row.name}`, name: `Build out analysis: ${row.name}`,
            description: 'Shell created during Get Started onboarding — add apps/features to complete.',
            status: 'Pending', assignee: 'Sphynx Task', loggedHours: 0,
            createdAt: new Date().toISOString(), createdBy: 'onboarding', relatedAnalysisId: id
        });
    });
}

// ============================= STEP 8: Client-Facing SOPs (shells) =============================
function renderClientSOPsStep(client) {
    const shellHtml = (name = '') => `
        <input type="text" data-field="name" class="modal-input ob-name-field" placeholder="e.g. New Client Welcome Packet" value="${esc(name)}">
        <button class="btn tiny soft ob-remove-row" onclick="this.closest('.ob-row').remove()"><i data-lucide="x" style="width:12px;height:12px;"></i></button>
    `;
    return `
        <p class="tiny muted" style="margin-bottom:14px;">
            Do you want to create any client-facing SOPs? We'll create a shell for each, plus a task to fill it in later.
        </p>
        <div id="ob-sop-rows">
            <div class="ob-row ob-row-flex">${shellHtml()}</div>
        </div>
        <button class="btn small soft ob-add-more-btn" onclick="OL.onboardingAddRow('ob-sop-rows', 'nameOnly')">+ Add another</button>
    `;
}
function commitClientSOPsStep(client) {
    const rows = readRowInputs('ob-sop-rows', ['name']);
    if (!client.projectData.localSOPs) client.projectData.localSOPs = [];
    if (!client.projectData.clientTasks) client.projectData.clientTasks = [];

    rows.forEach(row => {
        if (!row.name) return;
        const id = 'sop-' + uid();
        client.projectData.localSOPs.push({
            id, name: row.name, steps: [], createdDate: new Date().toISOString(), isShell: true
        });
        client.projectData.clientTasks.unshift({
            id: uid(), title: `Write SOP: ${row.name}`, name: `Write SOP: ${row.name}`,
            description: 'Shell created during Get Started onboarding — add steps to complete.',
            status: 'Pending', assignee: 'Sphynx Task', loggedHours: 0,
            createdAt: new Date().toISOString(), createdBy: 'onboarding', relatedSOPId: id
        });
    });
}

// ============================= STEP 9: Resource Imports =============================
function renderResourceImportsStep(client) {
    const members = client.projectData.teamMembers || [];
    return `
        <p class="tiny muted" style="margin-bottom:14px;">
            Do you have template resources — forms, email campaigns, workflow documents, and the like — you'd like to import
            from another system? Click to select the ones you use; we'll store the API key against whoever's handling that
            import so it's ready to sync from the Resources tab's Importer Hub.
        </p>
        <div class="ob-pill-group" id="ob-import-pills">
            ${IMPORT_READY_SYSTEMS.map(sys => `
                <div class="ob-pill" data-system="${sys.id}"
                     onclick="this.classList.toggle('selected'); document.getElementById('ob-import-fields-${sys.id}').style.display = this.classList.contains('selected') ? 'block' : 'none';">
                    ${esc(sys.name)}
                </div>
            `).join('')}
        </div>
        <div id="ob-import-systems" style="margin-top:14px;">
            ${IMPORT_READY_SYSTEMS.map(sys => `
                <div id="ob-import-fields-${sys.id}" class="ob-team-card" style="display:none;">
                    <div class="ob-field-grid">
                        <div class="ob-field">
                            <label>${esc(sys.name)} API Key</label>
                            <input type="text" data-system-key="${sys.id}" class="modal-input" placeholder="API key">
                        </div>
                        <div class="ob-field">
                            <label>Link to Team Member</label>
                            <select data-system-member="${sys.id}" class="modal-input">
                                <option value="">Link to team member...</option>
                                ${members.map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}
                            </select>
                        </div>
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}
function commitResourceImportsStep(client) {
    const selected = Array.from(document.querySelectorAll('#ob-import-pills .ob-pill.selected'));
    if (!selected.length) return;
    if (!client.projectData.localApps) client.projectData.localApps = [];
    if (!client.projectData.accessRegistry) client.projectData.accessRegistry = [];

    selected.forEach(pill => {
        const sysId = pill.getAttribute('data-system');
        const sysName = IMPORT_READY_SYSTEMS.find(s => s.id === sysId)?.name || sysId;
        const apiKey = document.querySelector(`[data-system-key="${sysId}"]`)?.value.trim() || '';
        const memberId = document.querySelector(`[data-system-member="${sysId}"]`)?.value || '';

        // Shell app entry representing the external system, so it shows up
        // consistently in the access/credentials UI and lines up with what
        // OL.syncExternalIntegrations() looks for by app name.
        let app = client.projectData.localApps.find(a => a.importSourceId === sysId);
        if (!app) {
            app = { id: uid(), name: sysName, category: 'Import Source', importSourceId: sysId, clientTier: 'N/A', monthlyCost: 0 };
            client.projectData.localApps.push(app);
        }

        client.projectData.accessRegistry.push({
            id: 'acc_' + uid(), memberId: memberId || null, appId: app.id,
            level: 'API Key', secret: apiKey, pendingImport: true
        });
    });
}

// ============================= STEP 10: Client Projects (shells) =============================
function renderClientProjectsStep(client) {
    const stages = (client.meta.pipelineStatuses && client.meta.pipelineStatuses.length)
        ? client.meta.pipelineStatuses
        : DEFAULT_PARTNER_PIPELINE;
    const rowHtml = () => `
        <input type="text" data-field="name" class="modal-input ob-name-field" placeholder="Client / project name">
        <select data-field="status" class="modal-input ob-status-field">
            ${stages.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}
        </select>
        <button class="btn tiny soft ob-remove-row" onclick="this.closest('.ob-row').remove()"><i data-lucide="x" style="width:12px;height:12px;"></i></button>
    `;
    return `
        <p class="tiny muted" style="margin-bottom:14px;">
            Do you have any clients you'd like to create projects for? We'll create a shell for each, plus a task to finish setting it up.
        </p>
        <div id="ob-client-rows">
            <div class="ob-row ob-row-flex">${rowHtml()}</div>
        </div>
        <button class="btn small soft ob-add-more-btn" onclick="OL.onboardingAddRow('ob-client-rows', 'clientProject')">+ Add another</button>
    `;
}
function commitClientProjectsStep(client) {
    const rows = readRowInputs('ob-client-rows', ['name', 'status']);
    rows.forEach(row => {
        if (!row.name) return;
        const clientId = 'c-' + uid();
        state.clients[clientId] = {
            id: clientId,
            meta: {
                name: row.name,
                status: row.status || 'Discovery',
                partnerOwner: client.id,
                createdDate: new Date().toISOString(),
                createdByPartner: true
            },
            projectData: {
                localResources: [], localApps: [], localAnalyses: [], localSOPs: [],
                scopingSheets: [{ id: 'sheet-' + uid(), lineItems: [] }],
                localFunctions: [], stages: [], workflows: [],
                clientTasks: [{
                    id: uid(), title: `Finish setting up ${row.name}`, name: `Finish setting up ${row.name}`,
                    description: 'Shell created during Get Started onboarding — fill in project details to complete.',
                    status: 'Pending', assignee: 'Sphynx Task', loggedHours: 0,
                    createdAt: new Date().toISOString(), createdBy: 'onboarding'
                }]
            }
        };
        if (typeof OL.provisionSphynxTemplates === 'function') OL.provisionSphynxTemplates(clientId);
    });
}

// ---- add-row button dispatch (called from inline onclick) ----
export function onboardingAddRow(containerId, kind) {
    const rowsFor = {
        team: `
            <div class="ob-field-grid">
                <div class="ob-field"><label>Name</label><input type="text" data-field="name" class="modal-input"></div>
                <div class="ob-field"><label>Email</label><input type="email" data-field="email" class="modal-input"></div>
                <div class="ob-field"><label>Phone</label><input type="text" data-field="phone" class="modal-input"></div>
                <div class="ob-field"><label>Role</label><input type="text" data-field="role" class="modal-input"></div>
            </div>
            <button class="btn tiny soft ob-remove-row" onclick="this.closest('.ob-row').remove()"><i data-lucide="x" style="width:12px;height:12px;"></i></button>
        `,
        nameOnly: `
            <input type="text" data-field="name" class="modal-input ob-name-field" placeholder="Name">
            <button class="btn tiny soft ob-remove-row" onclick="this.closest('.ob-row').remove()"><i data-lucide="x" style="width:12px;height:12px;"></i></button>
        `,
        clientProject: (() => {
            const client = getWizardClient();
            const stages = (client?.meta.pipelineStatuses && client.meta.pipelineStatuses.length)
                ? client.meta.pipelineStatuses : DEFAULT_PARTNER_PIPELINE;
            return `
                <input type="text" data-field="name" class="modal-input ob-name-field" placeholder="Client / project name">
                <select data-field="status" class="modal-input ob-status-field">
                    ${stages.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}
                </select>
                <button class="btn tiny soft ob-remove-row" onclick="this.closest('.ob-row').remove()"><i data-lucide="x" style="width:12px;height:12px;"></i></button>
            `;
        })()
    };
    const wrapperClass = kind === 'team' ? 'ob-row ob-team-card' : 'ob-row ob-row-flex';
    addOnboardingRow(containerId, rowsFor[kind] || rowsFor.nameOnly, wrapperClass);
}

const STEP_RENDERERS = {
    yourInfo: renderYourInfoStep,
    yourTeam: renderYourTeamStep,
    appsUsed: renderAppsUsedStep,
    pipelineStages: renderPipelineStagesStep,
    runsComparisons: renderRunsComparisonsStep,
    preloadAnalyses: renderPreloadAnalysesStep,
    otherAnalyses: renderOtherAnalysesStep,
    clientSOPs: renderClientSOPsStep,
    resourceImports: renderResourceImportsStep,
    clientProjects: renderClientProjectsStep
};

const STEP_COMMITTERS = {
    yourInfo: commitYourInfoStep,
    yourTeam: commitYourTeamStep,
    appsUsed: commitAppsUsedStep,
    pipelineStages: commitPipelineStagesStep,
    runsComparisons: commitRunsComparisonsStep,
    preloadAnalyses: commitPreloadAnalysesStep,
    otherAnalyses: commitOtherAnalysesStep,
    clientSOPs: commitClientSOPsStep,
    resourceImports: commitResourceImportsStep,
    clientProjects: commitClientProjectsStep
};

// Steps that make sense to skip outright (not just answer "no" to).
const STEP_SKIPPABLE = {
    yourTeam: true, appsUsed: true, preloadAnalyses: true,
    otherAnalyses: true, clientSOPs: true, resourceImports: true, clientProjects: true
};

window.OL = window.OL || {};
Object.assign(window.OL, {
    openOnboardingWizard, onboardingBack, onboardingNext, onboardingAddRow, onboardingAddPipelineStage
});
