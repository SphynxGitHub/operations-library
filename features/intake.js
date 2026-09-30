//======================= FEATURES / INTAKE QUESTIONNAIRE =======================//
// The Introductory Questionnaire a new client answers before work starts (firm information, branding, the software
// they use, how they work today, what they'd like fixed), built into the app as the first step of client onboarding.
// It follows the same step-by-step wizard pattern as the partner "Get Started" flow (features/onboarding.js) and
// uses its styling, but is its own module: answers live on the CLIENT PROJECT (client.projectData.intake), so staff
// can fill it in with the client on a call and a client with a portal login can fill it in themselves.
//
// Everything on the questionnaire is described by INTAKE_STEPS below — adding or rewording a question is a one-line
// change there, and the wizard, the summary page and the printout all follow.
//
// The software questions do real work. Each one is tied to a Function (CRM, Calendar, ...) by name; the client picks
// from the apps already in the Master Library for that function (or types one that isn't there). Those become the
// project's Applications, mapped to their functions the same way the Apps tab does it — so the tech answers turn
// straight into the app library instead of being re-typed. Choosing an app never removes one that was added before.
//
// Three steps write into resources every project already has, rather than keeping a second copy:
//   Naming Conventions  (household + folder naming patterns)   ← "Naming conventions" step
//   Folder Hierarchy    (the client folder tree)                ← "Folder structure" step (adds folders, never removes)
//   Compliance Documents (the list of firm documents + links)   ← "Compliance documents" step, advisory firms only
//
// Sharing how the firm works today (the "Connect your systems" step):
//   API keys  For the systems the app can already sync (Redtail, Wealthbox, Calendly, ...) — detected from the software
//             answers — the client can paste a key. It goes straight to secure storage (Supabase Vault) through the same
//             access entries the Credentials section uses; the questionnaire's saved answers never contain a key, only
//             "a key is stored". Only Sphynx staff can store a key, so a client filling this in themselves is pointed
//             to the PDF option instead.
//   PDFs      Workflow documents are uploaded to the client's Drive folder ("Workflow Documents") and listed on the
//             questionnaire. For a CRM firm this is the alternative to sharing a key.
//
// Not here yet (deliberately): a public link a prospect can open without logging in. That needs a table and a
// function on the server side, which is a separate piece of work.

import { state, esc, uid, getActiveClient } from '../core/data.js';
import { provisionMasterAppInto } from './apps.js';
import { storeSecret } from '../core/secrets.js';

// The outside systems the app can already pull workflows / setup from (supabase/functions/_shared/integrations.ts).
// `hints` are matched against the software the client named. `extra` is a second thing that system's importer needs.
const SYNC_SYSTEMS = [
    { id: 'redtail', name: 'Redtail', hints: ['redtail'], crm: true, pulls: 'your workflow templates' },
    { id: 'wealthbox', name: 'Wealthbox', hints: ['wealthbox'], crm: true, pulls: 'your workflow templates' },
    { id: 'calendly', name: 'Calendly', hints: ['calendly'], pulls: 'your event types' },
    { id: 'jotform', name: 'Jotform', hints: ['jotform'], pulls: 'your forms' },
    { id: 'activecampaign', name: 'ActiveCampaign', hints: ['activecampaign', 'active campaign'], pulls: 'your automations', extra: { label: 'ActiveCampaign API URL', placeholder: 'https://youraccount.api-us1.com' } },
    { id: 'mailerlite', name: 'MailerLite', hints: ['mailerlite'], pulls: 'your automations' },
    { id: 'ycbm', name: 'YouCanBook.me', hints: ['youcanbook', 'ycbm'], pulls: 'your booking pages', extra: { label: 'YouCanBook.me account email', placeholder: 'you@firm.com' } },
    { id: 'processstreet', name: 'Process Street', hints: ['processstreet', 'process street'], pulls: 'your workflows and their tasks' },
];
// Every piece of software the client named, lowercased: apps picked from the Master Library, typed names, and the
// "other software" list. `keys` limits it to particular questions (e.g. only the scheduling answer).
function softwareNames(answers, keys) {
    const out = [];
    INTAKE_STEPS.flatMap((st) => st.questions).forEach((q) => {
        if (keys && !keys.includes(q.key)) return;
        const a = answers[q.key];
        if (q.type === 'apps' && a && typeof a === 'object') {
            (a.apps || []).forEach((id) => out.push((state.master?.apps || []).find((m) => String(m.id) === String(id))?.name || ''));
            String(a.other || '').split(/[,\n;]+/).forEach((n) => out.push(n));
        } else if (q.addAsApps && typeof a === 'string') out.push(...a.split(/[\n;]+/));
    });
    return out.map((n) => n.trim().toLowerCase()).filter(Boolean);
}
const namedAny = (answers, hint, keys) => softwareNames(answers, keys).some((n) => n.includes(hint));

// The sync-capable systems the client named anywhere in the software answers.
function detectSyncSystems(answers) {
    const hay = softwareNames(answers).join(' | ');
    return SYNC_SYSTEMS.filter((sys) => sys.hints.some((h) => hay.includes(h)));
}
const canStoreKeys = () => state.adminMode === true || state.teamMemberMode === true;

// Follow-ups that only make sense for certain software combinations. Each answer is saved as a note on that application's
// card (Applications tab), as a line "Intake · <what>: <answer>", so it is there when someone opens the app later.
//   when(answers) -> should this be asked?     note.hints -> which application card(s) get the note
//   note.fromQuestion -> instead, every app the client picked for that question (minus note.exclude)
const FOLLOWUPS = [
    { key: 'fuDocusignSchwab', type: 'yesno', label: 'Is your DocuSign hosted through Schwab?',
      when: (a) => namedAny(a, 'schwab') && namedAny(a, 'docusign'), note: { hints: ['docusign'], what: 'Hosted through Schwab' } },
    { key: 'fuOncehubZapier', type: 'yesno', label: 'Is your OnceHub connected to Zapier?',
      when: (a) => namedAny(a, 'oncehub'), note: { hints: ['oncehub'], what: 'Connected to Zapier' } },
    { key: 'fuSchedulerConnects', type: 'multi', options: ['Zoom', 'Google Calendar', 'Outlook', 'None of these'],
      label: 'Which of these is your scheduling software connected to?',
      when: (a) => softwareNames(a, ['scheduling']).some((n) => !n.includes('oncehub')),
      note: { fromQuestion: 'scheduling', exclude: ['oncehub'], what: 'Connected to' } },
    { key: 'fuRetriever', type: 'yesno', label: 'Is RetrieverCloud set up?',
      when: (a) => namedAny(a, 'redtail'), note: { hints: ['redtail'], what: 'RetrieverCloud set up' } },
    { key: 'fuWealthboxCalendar', type: 'yesno', label: 'Is Wealthbox > Calendar sync set up?',
      when: (a) => namedAny(a, 'wealthbox'), note: { hints: ['wealthbox'], what: 'Wealthbox > Calendar sync set up' } },
];

// The documents an advisory firm usually keeps. `name` is what is stored on the Compliance Documents resource (the same
// short names it starts with, so nothing doubles up); `label` is what the person reads.
const COMPLIANCE_DOCS = [
    { name: 'ADV', label: 'Form ADV (Part 2A / 2B brochure)' },
    { name: 'CRS', label: 'Form CRS (client relationship summary)' },
    { name: 'Privacy Policy', label: 'Privacy policy' },
    { name: 'Code of Ethics', label: 'Code of ethics' },
    { name: 'Compliance Manual', label: 'Compliance manual / written policies and procedures' },
    { name: 'Advisory Agreement', label: 'Client advisory agreement' },
    { name: 'Investment Policy Statement', label: 'Investment policy statement (IPS) template' },
    { name: 'Business Continuity Plan', label: 'Business continuity plan' },
    { name: 'Cybersecurity Policy', label: 'Cybersecurity / information security policy' },
];

const resourceNamed = (client, name) => (client?.projectData?.localResources || []).find((r) => r && r.name === name) || null;
const namingValue = (client, section, key) => resourceNamed(client, 'Naming Conventions')?.data?.[section]?.[key] || '';

// The folder tree is nested {id, name, children}. The per-client folder is the node named {folderNamingConventions}.
const BRIDGE_NAME = '{folderNamingConventions}';
function treeOf(client) { return resourceNamed(client, 'Folder Hierarchy')?.tree || null; }
function findNode(nodes, pred) {
    for (const n of nodes || []) { if (pred(n)) return n; const hit = findNode(n.children, pred); if (hit) return hit; }
    return null;
}
const folderRootName = (client) => treeOf(client)?.[0]?.name || 'Clients';
function folderSubText(client) {
    const tree = treeOf(client);
    const bridge = tree ? findNode(tree, (n) => n.name === BRIDGE_NAME) : null;
    const lines = [];
    const walk = (nodes, depth) => (nodes || []).forEach((n) => { lines.push(`${'  '.repeat(depth)}${n.name}`); walk(n.children, depth + 1); });
    walk(bridge?.children, 0);
    return lines.join('\n');
}
// "Tax\n  Returns\nEstate" -> nested nodes. Indent = two spaces (or a tab) per level; bullets are ignored.
function parseFolderLines(text) {
    const root = { children: [] };
    const stack = [{ depth: -1, node: root }];
    String(text || '').split(/\r?\n/).forEach((raw) => {
        const name = raw.replace(/^[\s\-*•]+/, '').trim();
        if (!name) return;
        const indent = (raw.match(/^[ \t]*/)[0] || '').replace(/\t/g, '  ').length;
        const depth = Math.floor(indent / 2);
        while (stack.length > 1 && stack[stack.length - 1].depth >= depth) stack.pop();
        const node = { id: 'f-' + uid(), name, children: [] };
        stack[stack.length - 1].node.children.push(node);
        stack.push({ depth, node });
    });
    return root.children;
}
// Adds what is missing, matching by name at each level; never renames or deletes an existing folder.
function mergeFolders(existing, incoming) {
    let added = 0;
    incoming.forEach((inc) => {
        const hit = existing.find((e) => String(e.name).trim().toLowerCase() === inc.name.toLowerCase());
        if (hit) { if (!hit.children) hit.children = []; added += mergeFolders(hit.children, inc.children); }
        else { existing.push(inc); added += 1 + countNodes(inc.children); }
    });
    return added;
}
const countNodes = (nodes) => (nodes || []).reduce((n, x) => n + 1 + countNodes(x.children), 0);

// ---- the questions ---------------------------------------------------------------------------------------------
// type: text | textarea | number | select | yesno | apps
//   apps  -> pick from Master Library apps whose Function name matches `fn`, plus "Other" and "Don't currently use"
//   docs  -> a checklist of standard documents, each with a link
//   prefill: (client) => text — starts the box with what the project already has
//   showIf: (answers) => bool — a follow-up (or, on a step, the whole step) that only appears for some answers
const INTAKE_STEPS = [
    { key: 'contact', title: 'About you', intro: 'Who is filling this in.', questions: [
        { key: 'name', label: 'Name', type: 'text', prefill: 'name' },
        { key: 'email', label: 'Email', type: 'text', prefill: 'email' },
    ] },
    { key: 'firm', title: 'Firm information', questions: [
        { key: 'industry', label: 'Industry', type: 'select', options: ['Financial Advising', 'Accounting / Tax', 'Insurance', 'Other'] },
        { key: 'role', label: 'Role', type: 'text', hint: 'For example: advisor, owner, operations.' },
        { key: 'advisorCount', label: 'How many advisors work on your team that would be involved in or impacted by our work together?', type: 'number' },
        { key: 'primaryContact', label: 'Who will be the primary point of contact for our work together? This is the person who will reach an internal consensus with your team and then communicate final decisions with us.', type: 'text' },
        { key: 'taxPrep', label: 'Do you offer tax preparation services?', type: 'yesno' },
        { key: 'surgeMeetings', label: 'Do you consolidate your client meetings at specific point(s) of the year (surge-type meetings)?', type: 'yesno' },
        { key: 'meetingBlocks', label: 'What are the approximate dates of your meeting block(s)?', type: 'textarea', showIf: (a) => a.surgeMeetings === 'Yes' },
        { key: 'constraints', label: 'Are there any known constraints that may impact our timeline of working together? For example: planned vacations, peak times, work retreats / conferences, etc.', type: 'yesno' },
        { key: 'constraintsDetail', label: 'Please describe them.', type: 'textarea', showIf: (a) => a.constraints === 'Yes' },
    ] },
    { key: 'branding', title: 'Branding', questions: [
        { key: 'logoMethod', label: 'How would you like to provide your logo?', type: 'select', options: ['Upload an image', 'Link to a file', 'Send it later'] },
        { key: 'logoLink', label: 'Link to your logo', type: 'text', showIf: (a) => a.logoMethod === 'Link to a file', hint: 'A shared Drive / Dropbox link is fine.' },
    ] },
    { key: 'techComms', title: 'Technology: marketing, communication and scheduling', questions: [
        { key: 'leadGen', label: 'What lead generation service do you use?', type: 'apps', fn: /lead/i },
        { key: 'website', label: 'What website platform do you use?', type: 'apps', fn: /web ?site|\bcms\b|web ?builder/i },
        { key: 'officeSuite', label: 'What office suite do you use?', type: 'apps', fn: /office|suite|productivity/i },
        { key: 'emailSoftware', label: 'What email software do you use?', type: 'apps', fn: /^e-?mail\b(?!.*(market|campaign))/i },
        { key: 'phoneText', label: 'What phone / text system do you use?', type: 'apps', fn: /phone|sms|text|dialer|voip/i },
        { key: 'virtualMeeting', label: 'What virtual meeting software do you use?', type: 'apps', fn: /meeting|video|conferenc|webinar/i },
        { key: 'calendar', label: 'What calendar software do you use?', type: 'apps', fn: /calendar/i },
        { key: 'scheduling', label: 'What scheduling software do you use?', type: 'apps', fn: /schedul|booking/i },
    ] },
    { key: 'techClients', title: 'Technology: clients, notes and workflow', questions: [
        { key: 'crm', label: 'What CRM software do you use?', type: 'apps', fn: /crm/i },
        { key: 'notesProcess', label: 'What is your process for taking notes during meetings? For example, do you use an AI notetaking software? Write notes by hand? Etc.', type: 'textarea' },
        { key: 'notesStorage', label: 'Where do you store notes?', type: 'apps', fn: /note/i },
        { key: 'transcription', label: 'What voice transcription software do you use?', type: 'apps', fn: /transcri|note ?tak/i },
        { key: 'forms', label: 'What data gathering / form software do you use?', type: 'apps', fn: /form|survey|data gather/i },
        { key: 'docStorage', label: 'Where do you store client documents?', type: 'apps', fn: /storage|document|drive|file/i },
        { key: 'emailMarketing', label: 'What email marketing software do you use?', type: 'apps', fn: /marketing|campaign|newsletter/i },
        { key: 'workflow', label: 'What workflow / project management software do you use?', type: 'apps', fn: /workflow|project/i },
        { key: 'tasks', label: 'What task management software do you use?', type: 'apps', fn: /task/i },
        { key: 'esign', label: 'What e-signature software do you use?', type: 'apps', fn: /sign/i },
        { key: 'passwords', label: 'What password manager do you use?', type: 'apps', fn: /password|vault/i },
        { key: 'zapier', label: 'Do you use Zapier?', type: 'yesno' },
    ] },
    { key: 'techFinance', title: 'Technology: planning, billing and investments', questions: [
        { key: 'billing', label: 'What billing / invoicing software do you use?', type: 'apps', fn: /billing|invoic|payment/i },
        { key: 'planning', label: 'What financial planning software do you use?', type: 'apps', fn: /planning/i },
        { key: 'risk', label: 'What risk tolerance software do you use?', type: 'apps', fn: /risk/i },
        { key: 'aggregation', label: 'What data aggregation / portfolio analytics software do you use?', type: 'apps', fn: /aggregat|portfolio|analytics|reporting/i },
        { key: 'custodian', label: 'What custodian or TAMP do you use?', type: 'apps', fn: /custod|tamp/i },
        { key: 'otherSoftware', label: 'Please list any other software you use (if applicable).', type: 'textarea', hint: 'One per line is fine. Each one is added to your applications.', addAsApps: true },
    ] },
    { key: 'connect', title: 'Share how your firm works today', intro: 'The fastest way for us to see your existing workflows. Do whichever is easiest — connect the system, or upload your written workflows as PDFs. Both is even better.', questions: [
        { key: 'systemKeys', label: 'Connect your systems', type: 'keys' },
        { key: 'workflowFiles', label: 'Upload workflow documents (PDF)', type: 'files', hint: 'Checklists, process outlines, onboarding steps, meeting prep — anything written down. PDF only, up to 10 MB each.' },
        { key: 'workflowNote', label: 'No documents? Describe your main workflows in a few lines.', type: 'textarea', hint: 'For example: what happens from a booked intro meeting to a signed client.' },
    ] },
    { key: 'followups', title: 'A few follow-up questions', intro: 'Based on the software you told us about.',
      showIf: (a) => FOLLOWUPS.some((f) => f.when(a)),
      questions: FOLLOWUPS.map((f) => ({ key: f.key, label: f.label, type: f.type, options: f.options, showIf: f.when })) },
    { key: 'naming', title: 'Naming conventions', intro: 'How you name things today, so what we build follows your existing habits. Use the pattern, not a real client — for example "Last, First".', questions: [
        { key: 'nameHhIndividual', label: 'Household name in your CRM — an individual client', type: 'text', prefill: (c) => namingValue(c, 'household', 'individual') },
        { key: 'nameHhJointSame', label: 'Household name — a couple who share a last name', type: 'text', prefill: (c) => namingValue(c, 'household', 'jointSame') },
        { key: 'nameHhJointDiff', label: 'Household name — a couple with different last names', type: 'text', prefill: (c) => namingValue(c, 'household', 'jointDiff') },
        { key: 'nameFoIndividual', label: 'Client folder name — an individual client', type: 'text', prefill: (c) => namingValue(c, 'folders', 'individual') },
        { key: 'nameFoJointSame', label: 'Client folder name — a couple who share a last name', type: 'text', prefill: (c) => namingValue(c, 'folders', 'jointSame') },
        { key: 'nameFoJointDiff', label: 'Client folder name — a couple with different last names', type: 'text', prefill: (c) => namingValue(c, 'folders', 'jointDiff') },
        { key: 'nameFiles', label: 'How are individual files named? (optional)', type: 'text', hint: 'For example: "2026-08-24 – Last, First – Meeting notes".' },
    ] },
    { key: 'folders', title: 'Folder structure', intro: 'Where client files live and what is inside each client\'s folder.', questions: [
        { key: 'folderRoot', label: 'What is the top-level folder that holds all client folders called?', type: 'text', prefill: (c) => folderRootName(c) },
        { key: 'folderSub', label: 'Which folders do you keep inside each client\'s folder?', type: 'textarea', tall: true, prefill: (c) => folderSubText(c),
          hint: 'One per line. Indent a line with two spaces to put it inside the folder above it. Folders you list are added to the project\'s Folder Hierarchy; nothing already there is removed.' },
        { key: 'folderWhere', label: 'Where do these folders live?', type: 'select', options: ['Google Drive', 'Dropbox', 'OneDrive / SharePoint', 'Inside our CRM', 'Other'] },
    ] },
    { key: 'compliance', title: 'Compliance documents', intro: 'Tick the documents your firm has and paste a link to each if you can. We keep them together on the project.',
      showIf: (a) => /advis/i.test(String(a.industry || '')), questions: [
        { key: 'complianceDocs', label: 'Which of these does your firm have?', type: 'docs', docs: COMPLIANCE_DOCS },
        { key: 'complianceOwner', label: 'Who looks after compliance for your firm (a person, or an outside compliance consultant)?', type: 'text' },
    ] },
    { key: 'feedback', title: 'What works and what doesn\'t', questions: [
        { key: 'likesDislikes', label: 'Of the software listed, are there any features they have that you really like? Any you dislike or find inefficient? Anything you wish you had?', type: 'textarea', tall: true },
    ] },
    { key: 'process', title: 'Process information', questions: [
        { key: 'writtenProcesses', label: 'Do you have written process outlines?', type: 'yesno' },
        { key: 'anythingElse', label: 'Is there anything else we should know about your firm, processes or technology?', type: 'textarea', tall: true },
    ] },
];

// Every question's key is where its answer is saved, so two questions sharing one would silently overwrite each other.
(() => {
    const seen = new Set();
    INTAKE_STEPS.flatMap((st) => st.questions).forEach((q) => { if (seen.has(q.key)) console.error(`Intake: duplicate question key "${q.key}"`); seen.add(q.key); });
})();

const $ = (id) => document.getElementById(id);
// A question can start with what the project already holds (a name pattern, the folder list). 'name'/'email' are the
// primary contact's.
const prefillFor = (q, client) => (typeof q.prefill === 'function' ? q.prefill(client)
    : q.prefill === 'name' ? primaryContactOf(client).name : q.prefill === 'email' ? primaryContactOf(client).email : '');
const isBlank = (v) => v === undefined || v === null || String(v).trim() === '';
const fnName = (f) => String(f?.name || '');

// ---- data ------------------------------------------------------------------------------------------------------
function intakeOf(client) {
    if (!client.projectData) client.projectData = {};
    if (!client.projectData.intake) client.projectData.intake = { answers: {}, stepIndex: 0, completed: false, startedAt: new Date().toISOString() };
    return client.projectData.intake;
}

function primaryContactOf(client) {
    const team = client?.projectData?.teamMembers || [];
    return team.find((m) => m.isPrimaryContact) || team[0] || {};
}

// Master Library apps whose Function(s) match a question's `fn` pattern, alphabetically.
function appOptionsFor(q) {
    if (!q.fn) return [];
    const fnIds = new Set((state.master?.functions || []).filter((f) => q.fn.test(fnName(f))).map((f) => String(f.id)));
    if (!fnIds.size) return [];
    return (state.master?.apps || [])
        .filter((a) => (a.functionIds || []).some((m) => fnIds.has(String(typeof m === 'string' ? m : m.id))))
        .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}
const primaryFunctionIdFor = (q) => {
    const f = (state.master?.functions || []).find((x) => q.fn && q.fn.test(fnName(x)));
    return f ? String(f.id) : '';
};

// ---- wizard ----------------------------------------------------------------------------------------------------
// A step can be hidden by an earlier answer (Compliance documents only shows for an advisory firm).
const stepVisible = (step, answers) => !step.showIf || step.showIf(answers);
const visibleStepIndexes = (answers) => INTAKE_STEPS.map((_, i) => i).filter((i) => stepVisible(INTAKE_STEPS[i], answers));
function stepNeighbor(ob, dir) {
    const v = visibleStepIndexes(ob.answers);
    return dir > 0 ? (v.find((i) => i > ob.stepIndex) ?? null) : ([...v].reverse().find((i) => i < ob.stepIndex) ?? null);
}

export function openIntakeWizard(startAtStep) {
    const client = getActiveClient();
    if (!client) { alert('Open a project first.'); return; }
    const ob = intakeOf(client);
    if (typeof startAtStep === 'number') ob.stepIndex = Math.max(0, Math.min(INTAKE_STEPS.length - 1, startAtStep));
    if (!stepVisible(INTAKE_STEPS[ob.stepIndex], ob.answers)) ob.stepIndex = stepNeighbor(ob, 1) ?? stepNeighbor(ob, -1) ?? 0;
    renderStep();
}

function questionHtml(q, answers, client) {
    if (q.showIf && !q.showIf(answers)) return '';
    const v = answers[q.key];
    const id = `iq-${q.key}`;
    const label = `<label>${esc(q.label)}</label>${q.hint ? `<div class="tiny muted" style="margin-bottom:4px;">${esc(q.hint)}</div>` : ''}`;
    let input = '';
    if (q.type === 'text') {
        const pre = isBlank(v) && q.prefill ? prefillFor(q, client) : v;
        input = `<input type="text" id="${id}" class="modal-input" value="${esc(pre || '')}">`;
    } else if (q.type === 'number') {
        input = `<input type="number" min="0" id="${id}" class="modal-input" value="${esc(v ?? '')}">`;
    } else if (q.type === 'textarea') {
        input = `<textarea id="${id}" class="modal-input" rows="${q.tall ? 8 : 3}">${esc(isBlank(v) && q.prefill ? prefillFor(q, client) : (v || ''))}</textarea>`;
    } else if (q.type === 'select') {
        input = `<select id="${id}" class="modal-input" onchange="OL.intakeRefresh()"><option value="">Select…</option>${q.options.map((o) => `<option ${v === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    } else if (q.type === 'yesno') {
        input = `<div class="ob-pill-group" id="${id}">${['Yes', 'No'].map((o) => `<div class="ob-pill ${v === o ? 'selected' : ''}" data-val="${o}" onclick="OL.intakePickYesNo('${q.key}', '${o}')">${o}</div>`).join('')}</div>`;
    } else if (q.type === 'apps') {
        const a = v && typeof v === 'object' ? v : { apps: [], other: '', none: false };
        const picked = new Set((a.apps || []).map(String));
        const opts = appOptionsFor(q);
        input = `
            <div id="${id}">
                ${opts.length ? `<div class="ob-pill-group" style="margin-bottom:8px;">${opts.map((app) => `<div class="ob-pill ${picked.has(String(app.id)) ? 'selected' : ''}" data-app-id="${esc(String(app.id))}" onclick="this.classList.toggle('selected'); document.getElementById('${id}-none').checked = false;">${esc(app.name)}</div>`).join('')}</div>` : ''}
                <input type="text" id="${id}-other" class="modal-input" placeholder="${opts.length ? 'Something else? Type it here (separate several with commas)' : 'Type the name (separate several with commas)'}" value="${esc(a.other || '')}">
                <label class="tiny" style="display:flex; align-items:center; gap:6px; margin-top:6px; cursor:pointer; text-transform:none; letter-spacing:0; font-weight:400;"><input type="checkbox" id="${id}-none" ${a.none ? 'checked' : ''}> Don't currently use</label>
            </div>`;
    }
    else if (q.type === 'multi') {
        const picked = new Set(Array.isArray(v) ? v : []);
        input = `<div class="ob-pill-group" id="${id}">${q.options.map((o) => `<div class="ob-pill ${picked.has(o) ? 'selected' : ''}" data-val="${esc(o)}" onclick="this.classList.toggle('selected')">${esc(o)}</div>`).join('')}</div>`;
    }
    else if (q.type === 'keys') {
        const st = answers.systemKeys && typeof answers.systemKeys === 'object' ? answers.systemKeys : { extra: [], stored: {} };
        const shown = [...new Set([...detectSyncSystems(answers).map((x) => x.id), ...(st.extra || [])])].map((id) => SYNC_SYSTEMS.find((x) => x.id === id)).filter(Boolean);
        const addable = SYNC_SYSTEMS.filter((x) => !shown.some((y) => y.id === x.id));
        const can = canStoreKeys();
        input = `
            <div id="${id}">
                ${shown.length ? '' : '<div class="tiny muted" style="margin-bottom:8px;">None of the software you named is one we can connect to directly. You can still upload PDFs below, or add a system here.</div>'}
                ${shown.map((sys) => `
                    <div style="border:1px solid var(--line); border-radius:8px; padding:12px; margin-bottom:10px;">
                        <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
                            <strong>${esc(sys.name)}</strong>
                            ${st.stored?.[sys.id] ? `<span class="pill tiny soft" style="color:#22c55e;">✓ Key stored${st.stored[sys.id].hint ? ` (${esc(st.stored[sys.id].hint)})` : ''}</span>` : ''}
                        </div>
                        <div class="tiny muted" style="margin:4px 0 8px;">We can read ${esc(sys.pulls)} straight from ${esc(sys.name)} with an API key.${sys.crm ? ' Prefer not to share a key? Upload PDFs of your workflows below instead.' : ''}</div>
                        ${can ? `
                            ${sys.extra ? `<input type="text" data-sys-extra="${sys.id}" class="modal-input" style="margin-bottom:6px;" placeholder="${esc(sys.extra.label)} — ${esc(sys.extra.placeholder)}">` : ''}
                            <input type="password" autocomplete="new-password" data-sys-key="${sys.id}" class="modal-input" placeholder="${st.stored?.[sys.id] ? 'Paste a new key to replace the stored one' : `${sys.name} API key`}">
                            <div class="tiny muted" style="margin-top:4px;">Stored securely and never shown again. It is not saved with the questionnaire answers.</div>`
                        : `<div class="tiny" style="padding:6px 8px; border:1px dashed var(--line); border-radius:6px;">Your Sphynx contact will collect this key with you securely, so there is nothing to paste here.</div>`}
                    </div>`).join('')}
                ${addable.length ? `<select class="modal-input tiny" style="max-width:320px;" onchange="OL.intakeAddSystem(this.value)"><option value="">+ Connect another system…</option>${addable.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select>` : ''}
            </div>`;
    } else if (q.type === 'files') {
        const list = Array.isArray(answers.workflowFiles) ? answers.workflowFiles : [];
        input = `
            <div id="${id}">
                ${list.map((f, i) => `<div style="display:flex; align-items:center; gap:8px; padding:6px 8px; border:1px solid var(--line); border-radius:6px; margin-bottom:6px; font-size:13px;">
                    <span style="flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis;">📄 ${f.url ? `<a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.name)}</a>` : esc(f.name)}</span>
                    <button class="btn tiny soft" title="Removes it from this list only; the file stays in Drive" onclick="OL.intakeRemoveFile(${i})">✕</button></div>`).join('')}
                <label class="btn small soft" style="cursor:pointer; display:inline-flex !important; align-items:center; gap:6px; text-transform:none; letter-spacing:0; margin:0;">Choose PDF files…
                    <input type="file" accept="application/pdf,.pdf" multiple style="display:none !important;" onchange="OL.intakeUploadFiles(this.files); this.value='';">
                </label>
                <span id="${id}-status" class="tiny muted" style="margin-left:8px;"></span>
            </div>`;
    } else if (q.type === 'docs') {
        const a = v && typeof v === 'object' ? v : { have: {}, urls: {}, other: '' };
        input = `
            <div id="${id}">
                ${q.docs.map((d, i) => `
                    <div style="display:grid; grid-template-columns: minmax(0,1.2fr) minmax(0,1fr); gap:10px; align-items:center; padding:6px 0; border-bottom:1px dashed var(--line);">
                        <label style="display:flex; align-items:center; gap:8px; cursor:pointer; text-transform:none; letter-spacing:0; font-weight:400; font-size:13px; margin:0;">
                            <input type="checkbox" data-doc="${esc(d.name)}" ${a.have?.[d.name] ? 'checked' : ''}> ${esc(d.label)}
                        </label>
                        <input type="text" class="modal-input tiny" data-doc-url="${esc(d.name)}" placeholder="Link (optional)" value="${esc(a.urls?.[d.name] || '')}">
                    </div>`).join('')}
                <input type="text" id="${id}-other" class="modal-input" style="margin-top:8px;" placeholder="Any others? (separate with commas)" value="${esc(a.other || '')}">
            </div>`;
    }
    return `<div class="ob-field ob-field-full" style="margin-bottom:14px;">${label}${input}</div>`;
}

function renderStep() {
    const client = getActiveClient(); if (!client) return;
    const ob = intakeOf(client);
    const step = INTAKE_STEPS[ob.stepIndex];
    const vis = visibleStepIndexes(ob.answers);
    const pos = Math.max(0, vis.indexOf(ob.stepIndex));
    const last = stepNeighbor(ob, 1) === null;
    openModal(`
        <div class="modal-head">
            <div class="modal-title-text">📝 Intake questionnaire — ${esc(client.meta?.name || '')} · Step ${pos + 1} of ${vis.length}</div>
            <div class="spacer"></div>
            <button class="btn small soft" onclick="OL.intakeSaveAndClose()">Save &amp; close</button>
        </div>
        <div class="modal-body" id="intake-body" style="max-width:760px;">
            <div style="display:flex; gap:4px; margin-bottom:18px;">${vis.map((_, i) => `<div style="flex:1; height:4px; border-radius:2px; background:${i <= pos ? 'var(--accent)' : 'var(--panel-border)'};"></div>`).join('')}</div>
            <h3 style="margin:0 0 4px;">${esc(step.title)}</h3>
            ${step.intro ? `<p class="tiny muted" style="margin:0 0 14px;">${esc(step.intro)}</p>` : '<div style="height:10px;"></div>'}
            <div id="intake-questions">${step.questions.map((q) => questionHtml(q, ob.answers, client)).join('')}</div>
            <div style="display:flex; justify-content:space-between; margin-top:24px; padding-top:16px; border-top:1px solid var(--panel-border);">
                <div>${stepNeighbor(ob, -1) !== null ? '<button class="btn small soft" onclick="OL.intakeBack()">Back</button>' : ''}</div>
                <button class="btn small primary" onclick="OL.intakeNext()">${last ? 'Finish' : 'Next'}</button>
            </div>
        </div>`);
    if (window.lucide) window.lucide.createIcons();
}

// Reads the questions on screen into the saved answers (a question that is hidden right now keeps its old answer).
function readStep(client) {
    const ob = intakeOf(client);
    const step = INTAKE_STEPS[ob.stepIndex];
    step.questions.forEach((q) => {
        if (q.showIf && !$(`iq-${q.key}`) && !$(`iq-${q.key}-other`)) return;
        const el = $(`iq-${q.key}`);
        if (!el && q.type !== 'apps') return;
        if (q.type === 'text' || q.type === 'textarea' || q.type === 'select') ob.answers[q.key] = el.value.trim();
        else if (q.type === 'number') ob.answers[q.key] = el.value === '' ? '' : Number(el.value);
        else if (q.type === 'yesno') { const sel = el.querySelector('.ob-pill.selected'); ob.answers[q.key] = sel ? sel.getAttribute('data-val') : ''; }
        else if (q.type === 'multi') {
            const picks = Array.from(el.querySelectorAll('.ob-pill.selected')).map((p) => p.getAttribute('data-val'));
            ob.answers[q.key] = picks.includes('None of these') && picks.length > 1 ? picks.filter((x) => x !== 'None of these') : picks;
        }
        else if (q.type === 'docs') {
            const have = {}, urls = {};
            el.querySelectorAll('input[data-doc]').forEach((c) => { have[c.getAttribute('data-doc')] = c.checked; });
            el.querySelectorAll('input[data-doc-url]').forEach((u) => { if (u.value.trim()) urls[u.getAttribute('data-doc-url')] = u.value.trim(); });
            ob.answers[q.key] = { have, urls, other: ($(`${q.key ? 'iq-' + q.key : ''}-other`)?.value || '').trim() };
        }
        else if (q.type === 'apps') {
            const none = !!$(`iq-${q.key}-none`)?.checked;
            ob.answers[q.key] = {
                apps: none ? [] : Array.from(el.querySelectorAll('.ob-pill.selected')).map((p) => p.getAttribute('data-app-id')),
                other: none ? '' : ($(`iq-${q.key}-other`)?.value || '').trim(), none,
            };
        }
    });
}

// Adding the client's software to the project. Idempotent: an app already on the project (by Master Library link or by
// name) is left as it is, and nothing is ever removed.
export function applyIntakeApps(client) {
    const ob = intakeOf(client);
    const pd = client.projectData;
    if (!Array.isArray(pd.localApps)) pd.localApps = [];
    const have = (name, masterId) => pd.localApps.some((a) => (masterId && String(a.masterRefId) === String(masterId)) || String(a.name || '').trim().toLowerCase() === String(name).trim().toLowerCase());
    const masterByName = (name) => (state.master?.apps || []).find((a) => String(a.name || '').trim().toLowerCase() === String(name).trim().toLowerCase());
    let added = 0;
    const addNamed = (rawName, fnId) => {
        const name = String(rawName || '').trim();
        if (!name || /^(none|n\/a|don'?t currently use)$/i.test(name)) return;
        const master = masterByName(name);
        if (have(name, master?.id)) return;
        if (master) { provisionMasterAppInto(client, master); added++; return; }
        pd.localApps.push({
            id: 'local-app-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7), name, notes: '',
            functionIds: fnId ? [{ id: fnId, status: 'available' }] : [], capabilities: [],
        });
        if (fnId) { if (!client.sharedMasterIds) client.sharedMasterIds = []; if (!client.sharedMasterIds.map(String).includes(fnId)) client.sharedMasterIds.push(fnId); }
        added++;
    };
    INTAKE_STEPS.flatMap((s) => s.questions).forEach((q) => {
        const a = ob.answers[q.key];
        if (q.type === 'apps' && a && typeof a === 'object') {
            (a.apps || []).forEach((id) => {
                const master = (state.master?.apps || []).find((m) => String(m.id) === String(id));
                if (master && !have(master.name, master.id)) { provisionMasterAppInto(client, master); added++; }
            });
            String(a.other || '').split(/[,\n;]+/).forEach((n) => addNamed(n, primaryFunctionIdFor(q)));
        } else if (q.addAsApps && typeof a === 'string') {
            a.split(/[\n;]+/).forEach((line) => addNamed(line.replace(/\(.*?\)/g, ''), ''));
        }
    });
    return added;
}

// The person who filled it in becomes the project's primary contact if the project has none yet.
function applyIntakeContact(client) {
    const a = intakeOf(client).answers;
    if (isBlank(a.name) && isBlank(a.email)) return;
    const pd = client.projectData;
    if (!Array.isArray(pd.teamMembers)) pd.teamMembers = [];
    const same = pd.teamMembers.find((m) => (a.email && m.email && m.email.toLowerCase() === a.email.toLowerCase()));
    if (same) return;
    pd.teamMembers.push({ id: uid(), name: a.name || '', email: a.email || '', phone: '', role: a.role || '', roles: [], isPrimaryContact: !pd.teamMembers.some((m) => m.isPrimaryContact) });
}

async function saveNow(client) {
    if (typeof OL.markClientDirty === 'function') OL.markClientDirty(client.id);
    if (typeof OL.persist === 'function') await OL.persist();
}

// ---- writing the naming / folder / compliance answers into the project's own resources ----------------------------
function ensureReferenceResources(client) {
    const need = ['Naming Conventions', 'Folder Hierarchy', 'Compliance Documents'];
    if (need.some((n) => !resourceNamed(client, n)) && typeof OL.provisionSphynxTemplates === 'function') OL.provisionSphynxTemplates(client.id);
}
const NAMING_KEYS = [
    ['household', 'individual', 'nameHhIndividual'], ['household', 'jointSame', 'nameHhJointSame'], ['household', 'jointDiff', 'nameHhJointDiff'],
    ['folders', 'individual', 'nameFoIndividual'], ['folders', 'jointSame', 'nameFoJointSame'], ['folders', 'jointDiff', 'nameFoJointDiff'],
];
export function applyIntakeFiles(client) {
    const a = intakeOf(client).answers;
    const out = { naming: 0, folders: 0, docs: 0 };
    ensureReferenceResources(client);

    const naming = resourceNamed(client, 'Naming Conventions');
    if (naming) {
        if (!naming.data) naming.data = {};
        NAMING_KEYS.forEach(([section, key, qKey]) => {
            const v = String(a[qKey] || '').trim();
            if (!v || (naming.data[section]?.[key] || '') === v) return;
            if (!naming.data[section]) naming.data[section] = {};
            naming.data[section][key] = v; out.naming++;
        });
    }

    const tree = treeOf(client);
    if (tree && tree.length) {
        const root = tree[0];
        const rootName = String(a.folderRoot || '').trim();
        if (rootName && root.name !== rootName) { root.name = rootName; out.folders++; }
        const bridge = findNode(tree, (n) => n.name === BRIDGE_NAME);
        if (!root.children) root.children = [];
        out.folders += mergeFolders(bridge ? (bridge.children || (bridge.children = [])) : root.children, parseFolderLines(a.folderSub));
    }

    // Compliance documents apply to advisory firms only (the step is hidden for anyone else).
    const docsQ = a.complianceDocs;
    const compliance = resourceNamed(client, 'Compliance Documents');
    if (compliance && docsQ && typeof docsQ === 'object' && /advis/i.test(String(a.industry || ''))) {
        if (!Array.isArray(compliance.files)) compliance.files = [];
        const find = (name) => compliance.files.find((f) => String(f.name || '').trim().toLowerCase() === name.trim().toLowerCase());
        const add = (name, url) => {
            const hit = find(name);
            if (hit) { if (url && !hit.url) { hit.url = url; out.docs++; } return; }
            compliance.files.push({ name, url: url || '', id: uid() }); out.docs++;
        };
        COMPLIANCE_DOCS.forEach((d) => { if (docsQ.have?.[d.name]) add(d.name, docsQ.urls?.[d.name] || ''); });
        String(docsQ.other || '').split(/[,\n;]+/).map((x) => x.trim()).filter(Boolean).forEach((n) => add(n, ''));
    }
    return out;
}

// ---- follow-up answers → notes on the application cards --------------------------------------------------------------
// One line per follow-up, "Intake · <what>: <answer>". Running again replaces that line rather than adding another, and
// notes someone wrote on the card by hand are left alone.
function setIntakeNote(app, what, value) {
    const prefix = `Intake · ${what}:`;
    const lines = String(app.notes || '').split('\n').filter((l) => !l.startsWith(prefix));
    lines.push(`${prefix} ${value}`);
    const next = lines.filter((l) => l.trim()).join('\n');
    if (next === String(app.notes || '')) return false;
    app.notes = next;
    return true;
}
export function applyIntakeNotes(client) {
    const a = intakeOf(client).answers;
    const localApps = client.projectData?.localApps || [];
    const byName = (test) => localApps.filter((x) => !x.isHidden && test(String(x.name || '').toLowerCase()));
    let changed = 0;
    FOLLOWUPS.filter((f) => f.when(a)).forEach((f) => {
        const v = a[f.key];
        const value = Array.isArray(v) ? v.join(', ') : String(v || '');
        if (!value) return;
        let targets = [];
        if (f.note.fromQuestion) {
            const picked = softwareNames(a, [f.note.fromQuestion]).filter((n) => !(f.note.exclude || []).some((e) => n.includes(e)));
            targets = byName((n) => picked.some((p) => n.includes(p) || p.includes(n)));
        } else targets = byName((n) => f.note.hints.some((h) => n.includes(h)));
        targets.forEach((app) => { if (setIntakeNote(app, f.note.what, value)) changed++; });
    });
    return changed;
}

// Everything the answers can put into the project. Idempotent and additive: safe to run again after editing answers.
export function applyIntakeToProject(client) {
    applyIntakeContact(client);
    const apps = applyIntakeApps(client);
    const notes = applyIntakeNotes(client);
    return { apps, notes, ...applyIntakeFiles(client) };
}
const summaryLine = (r) => [
    r.apps && `${r.apps} application${r.apps === 1 ? '' : 's'}`, r.notes && `${r.notes} application note${r.notes === 1 ? '' : 's'}`, r.naming && `${r.naming} naming pattern${r.naming === 1 ? '' : 's'}`,
    r.folders && `${r.folders} folder change${r.folders === 1 ? '' : 's'}`, r.docs && `${r.docs} compliance document${r.docs === 1 ? '' : 's'}`,
].filter(Boolean).join(', ');

// ---- API keys: straight to secure storage --------------------------------------------------------------------------
// Finds (or makes) the access entry that holds a system's key, so it shows up in the project's Credentials section and
// is what the Import Hub looks for. The key itself never touches the questionnaire answers.
function accessEntryFor(client, sys, extraValue) {
    const pd = client.projectData;
    if (!Array.isArray(pd.localApps)) pd.localApps = [];
    if (!Array.isArray(pd.accessRegistry)) pd.accessRegistry = [];
    const hit = (a) => sys.hints.some((h) => String(a.name || '').toLowerCase().includes(h));
    let app = pd.localApps.find(hit);
    if (!app) {
        const master = (state.master?.apps || []).find(hit);
        app = master ? provisionMasterAppInto(client, master)
            : (pd.localApps.push({ id: uid(), name: sys.name, category: 'Import Source', importSourceId: sys.id, notes: 'Added from the intake questionnaire', functionIds: [], capabilities: [] }), pd.localApps[pd.localApps.length - 1]);
    }
    let entry = pd.accessRegistry.find((r) => r.appId === app.id && r.level === 'API Key');
    if (!entry) { entry = { id: 'acc_' + uid(), memberId: null, appId: app.id, level: 'API Key', secret: '' }; pd.accessRegistry.push(entry); }
    entry.pendingImport = true;
    if (extraValue) entry.username = extraValue;
    return entry;
}

// Stores any keys typed on the current step. Returns false (and says why) if one could not be stored, so the person
// stays on the step with what they typed rather than losing it.
async function commitKeys(client) {
    const box = $('iq-systemKeys');
    if (!box) return true;
    const ob = intakeOf(client);
    const st = ob.answers.systemKeys = ob.answers.systemKeys && typeof ob.answers.systemKeys === 'object' ? ob.answers.systemKeys : { extra: [], stored: {} };
    if (!st.stored) st.stored = {};
    const problems = [];
    for (const input of Array.from(box.querySelectorAll('input[data-sys-key]'))) {
        const key = input.value.trim();
        if (!key) continue;
        const id = input.getAttribute('data-sys-key');
        const sys = SYNC_SYSTEMS.find((x) => x.id === id);
        const extra = (box.querySelector(`input[data-sys-extra="${id}"]`)?.value || '').trim();
        if (sys.extra && !extra && !(client.projectData.accessRegistry || []).some((r) => r.username && (client.projectData.localApps || []).some((a) => a.id === r.appId && sys.hints.some((h) => String(a.name || '').toLowerCase().includes(h))))) {
            problems.push(`${sys.name}: ${sys.extra.label} is needed with the key.`); continue;
        }
        try {
            const entry = accessEntryFor(client, sys, extra);
            const r = await storeSecret(client.id, entry.id, key);
            entry.secretSet = true; entry.secretHint = r.hint || ''; entry.secretUpdatedAt = new Date().toISOString(); entry.secret = '';
            st.stored[id] = { hint: r.hint || '', at: entry.secretUpdatedAt };
            input.value = '';
        } catch (e) { problems.push(`${sys.name}: ${e.message}`); }
    }
    if (problems.length) { alert(`Could not store:\n${problems.join('\n')}\n\nWhat you typed is still there — fix it and try again.`); return false; }
    return true;
}

export function intakeAddSystem(id) {
    const client = getActiveClient(); if (!client || !id) return;
    readStep(client);
    const st = intakeOf(client).answers.systemKeys = intakeOf(client).answers.systemKeys || { extra: [], stored: {} };
    st.extra = [...new Set([...(st.extra || []), id])];
    renderStep();
}

// ---- workflow PDFs → the client's Drive folder --------------------------------------------------------------------------
export async function intakeUploadFiles(fileList) {
    const client = getActiveClient(); if (!client) return;
    readStep(client);
    const ob = intakeOf(client);
    if (!Array.isArray(ob.answers.workflowFiles)) ob.answers.workflowFiles = [];
    const status = $('iq-workflowFiles-status');
    for (const file of Array.from(fileList || [])) {
        if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') { alert(`${file.name}: only PDF files can be uploaded here.`); continue; }
        if (file.size > 10 * 1024 * 1024) { alert(`${file.name} is over 10 MB.`); continue; }
        if (status) status.textContent = `Uploading ${file.name}…`;
        try {
            const r = await OL.uploadFileToDrive(client.id, file, 'Workflow Documents');
            if (r) ob.answers.workflowFiles.push({ name: file.name, url: r.webViewLink || '', fileId: r.fileId || '', at: new Date().toISOString() });
        } catch (e) { /* uploadFileToDrive already told the person */ }
    }
    await saveNow(client);
    renderStep();
}
export async function intakeRemoveFile(i) {
    const client = getActiveClient(); if (!client) return;
    readStep(client);
    const list = intakeOf(client).answers.workflowFiles;
    if (Array.isArray(list)) list.splice(i, 1);
    await saveNow(client);
    renderStep();
}

export async function intakeNext() {
    const client = getActiveClient(); if (!client) return;
    const ob = intakeOf(client);
    readStep(client);
    if (!(await commitKeys(client))) return;
    const next = stepNeighbor(ob, 1);
    if (next === null) {
        ob.completed = true; ob.completedAt = new Date().toISOString();
        const r = applyIntakeToProject(client);
        await saveNow(client);
        OL.closeModal();
        renderIntakePage();
        const line = summaryLine(r);
        alert(`Thank you.${line ? ` Added to this project from your answers: ${line}.` : ''}`);
        return;
    }
    ob.stepIndex = next;
    await saveNow(client);
    renderStep();
}
export async function intakeBack() {
    const client = getActiveClient(); if (!client) return;
    const ob = intakeOf(client);
    readStep(client);
    if (!(await commitKeys(client))) return;
    ob.stepIndex = stepNeighbor(ob, -1) ?? ob.stepIndex;
    await saveNow(client);
    renderStep();
}
export async function intakeSaveAndClose() {
    const client = getActiveClient(); if (!client) return;
    readStep(client);
    if (!(await commitKeys(client))) return;
    await saveNow(client);
    OL.closeModal();
    renderIntakePage();
}
// A yes/no choice can reveal a follow-up question, so re-draw the step after keeping what is typed so far.
export function intakePickYesNo(key, val) {
    const client = getActiveClient(); if (!client) return;
    readStep(client);
    intakeOf(client).answers[key] = val;
    renderStep();
}
export function intakeRefresh() {
    const client = getActiveClient(); if (!client) return;
    readStep(client);
    renderStep();
}

// ---- the page: status, start/resume, and the answers as a document -------------------------------------------------
function answerText(q, v, answers = {}) {
    if (q.type === 'multi') return Array.isArray(v) ? v.join(', ') : '';
    if (q.type === 'keys') {
        const stored = answers.systemKeys?.stored || {};
        return Object.keys(stored).map((id) => `${SYNC_SYSTEMS.find((x) => x.id === id)?.name || id}: key stored securely`).join('\n');
    }
    if (q.type === 'files') return (Array.isArray(answers.workflowFiles) ? answers.workflowFiles : []).map((f) => f.name).join('\n');
    if (q.type === 'docs') {
        if (!v || typeof v !== 'object') return '';
        const have = COMPLIANCE_DOCS.filter((d) => v.have?.[d.name]).map((d) => `${d.label}${v.urls?.[d.name] ? ` — ${v.urls[d.name]}` : ''}`);
        return [...have, ...(v.other ? [v.other] : [])].join('\n');
    }
    if (q.type === 'apps') {
        if (!v || typeof v !== 'object') return '';
        if (v.none) return "Don't currently use";
        const names = (v.apps || []).map((id) => (state.master?.apps || []).find((a) => String(a.id) === String(id))?.name).filter(Boolean);
        return [...names, ...(v.other ? [v.other] : [])].join(', ');
    }
    return isBlank(v) ? '' : String(v);
}

function summaryHtml(client, ob) {
    return INTAKE_STEPS.filter((step) => stepVisible(step, ob.answers)).map((step) => {
        const rows = step.questions.filter((q) => !(q.showIf && !q.showIf(ob.answers)))
            .map((q) => ({ q, text: answerText(q, ob.answers[q.key], ob.answers) }));
        return `
            <div style="margin-bottom:22px; break-inside:avoid;">
                <h3 style="margin:0 0 8px; padding-bottom:6px; border-bottom:1px solid var(--line);">${esc(step.title)}</h3>
                ${rows.map(({ q, text }) => `
                    <div style="margin-bottom:10px;">
                        <div style="font-weight:700; font-size:13px;">${esc(q.label)}</div>
                        <div style="font-size:13px; white-space:pre-wrap; ${text ? '' : 'opacity:.45; font-style:italic;'}">${text ? esc(text) : 'Not answered'}</div>
                    </div>`).join('')}
            </div>`;
    }).join('');
}

export function renderIntakePage() {
    const container = $('mainContent');
    const client = getActiveClient();
    if (!container) return;
    if (!client) { container.innerHTML = '<div class="empty-hint">Open a project to see its intake questionnaire.</div>'; return; }
    const ob = intakeOf(client);
    const shownQs = INTAKE_STEPS.filter((st) => stepVisible(st, ob.answers)).flatMap((st) => st.questions).filter((q) => !(q.showIf && !q.showIf(ob.answers)));
    const answered = shownQs.filter((q) => !isBlank(answerText(q, ob.answers[q.key], ob.answers))).length;
    const total = shownQs.length;
    container.innerHTML = `
        <div class="section-header">
            <div>
                <h2>Intake Questionnaire</h2>
                <div class="small muted">${esc(client.meta?.name || '')} · ${ob.completed ? `Completed ${esc(String(ob.completedAt || '').slice(0, 10))}` : `${answered} of ${total} answered`}</div>
            </div>
            <div class="header-actions">
                ${ob.completed ? `<button class="btn small soft" onclick="OL.intakeApplyApps()" title="Add anything new in the answers to this project: applications, naming patterns, folders and compliance documents. Nothing already there is removed.">Apply answers to project</button>` : ''}
                <button class="btn small soft" onclick="OL.printIntake(true)" title="An empty copy of the questionnaire to send someone to fill in on paper">Blank form</button>
                <button class="btn small soft" onclick="OL.printIntake()" title="Opens the print dialog — choose Save as PDF there. Only answered questions are included.">Print / Save PDF</button>
                <button class="btn small primary" onclick="OL.openIntakeWizard(${ob.completed ? 0 : ob.stepIndex})">${ob.completed ? 'Review / edit answers' : (answered ? 'Resume' : 'Start questionnaire')}</button>
            </div>
        </div>
        <div class="card" style="padding:24px; max-width:860px;">${summaryHtml(client, ob)}</div>`;
    if (window.lucide) window.lucide.createIcons();
}

export async function intakeApplyApps() {
    const client = getActiveClient(); if (!client) return;
    const line = summaryLine(applyIntakeToProject(client));
    await saveNow(client);
    alert(line ? `Added to this project: ${line}.` : 'Everything in the answers is already in the project.');
}


// ---- printing / saving as PDF ------------------------------------------------------------------------------------
// Builds a standalone document (no sidebar or buttons) in the same way the How-To guide and the scoping sheet print, and
// opens the browser's print dialog in a hidden frame — "Save as PDF" there gives a text PDF that can be searched and
// copied from. Two versions: the answers (unanswered questions are left out, as on the Jotform PDF) and a BLANK form to
// send someone to fill in on paper. API keys never appear on either: the answers version only says a key is stored.
const escHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const PRINT_CSS = `
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Inter', 'Helvetica Neue', Arial, sans-serif; font-size: 11.5px; line-height: 1.5; color: #0f172a; background: #fff; padding: 0 4px; }
@page { size: letter portrait; margin: 16mm 15mm 18mm; @bottom-right { content: counter(page) " / " counter(pages); font-size: 9px; color: #94a3b8; } }
.doc-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 20px; border-bottom: 2px solid #0f172a; padding-bottom: 12px; margin-bottom: 14px; }
.brand { font-size: 17px; font-weight: 300; letter-spacing: 0.32em; color: #14b8a6; }
.brand small { display: block; font-size: 7px; letter-spacing: 0.5em; color: #0f172a; font-weight: 600; margin-top: 2px; }
.doc-title { text-align: right; }
.doc-title h1 { font-size: 21px; font-weight: 800; }
.doc-title .sub { font-size: 10.5px; color: #64748b; margin-top: 2px; }
.who { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 24px; padding-bottom: 12px; border-bottom: 1px solid #cbd5e1; margin-bottom: 4px; }
.who .k { font-weight: 700; font-size: 10px; text-transform: uppercase; letter-spacing: .04em; color: #475569; }
.section { margin-top: 16px; }
.section h2 { font-size: 15px; font-weight: 800; padding-bottom: 5px; border-bottom: 1px solid #94a3b8; margin-bottom: 9px; break-after: avoid; page-break-after: avoid; }
.section .note { font-size: 10px; color: #64748b; margin: -4px 0 8px; font-style: italic; }
.q { margin-bottom: 9px; break-inside: avoid; page-break-inside: avoid; }
.q .l { font-weight: 700; font-size: 11.5px; break-after: avoid; page-break-after: avoid; }
.q .a { color: #334155; white-space: pre-wrap; overflow-wrap: anywhere; margin-top: 1px; }
.q .a a { color: #0369a1; }
.chip { display: inline-block; background: #e2e8f0; color: #334155; padding: 2px 9px; border-radius: 4px; font-size: 11px; margin: 2px 4px 0 0; }
ul.list { margin: 2px 0 0 16px; }
ul.list li { margin: 1px 0; }
.q.long .a { border-left: 3px solid #e2e8f0; padding-left: 9px; }
/* blank form */
.line { border-bottom: 1px solid #94a3b8; height: 20px; margin-top: 4px; }
.box { border: 1px solid #94a3b8; border-radius: 3px; margin-top: 4px; }
.opts { margin-top: 3px; } .opts span { display: inline-block; margin-right: 16px; }
.hint { font-size: 10px; color: #64748b; font-weight: 400; }
.foot { margin-top: 18px; padding-top: 8px; border-top: 1px solid #e2e8f0; font-size: 9.5px; color: #94a3b8; }
@media print { .q, .section h2 { -webkit-print-color-adjust: exact; print-color-adjust: exact; } .chip { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
`;

function printAnswerHtml(q, answers) {
    const v = answers[q.key];
    if (q.type === 'multi') return Array.isArray(v) && v.length ? v.map((x) => `<span class="chip">${escHtml(x)}</span>`).join('') : '';
    if (q.type === 'yesno') return v ? `<span class="chip">${escHtml(v)}</span>` : '';
    if (q.type === 'select') return v ? `<span class="chip">${escHtml(v)}</span>` : '';
    if (q.type === 'apps') {
        if (!v || typeof v !== 'object') return '';
        if (v.none) return `<span class="chip">Don't currently use</span>`;
        const names = (v.apps || []).map((id) => (state.master?.apps || []).find((a) => String(a.id) === String(id))?.name).filter(Boolean);
        return [...names, ...String(v.other || '').split(/[,\n;]+/).map((x) => x.trim()).filter(Boolean)].map((n) => `<span class="chip">${escHtml(n)}</span>`).join('');
    }
    if (q.type === 'keys') {
        const stored = answers.systemKeys?.stored || {};
        const names = Object.keys(stored).map((id) => SYNC_SYSTEMS.find((x) => x.id === id)?.name || id);
        return names.length ? `<ul class="list">${names.map((n) => `<li>${escHtml(n)} — API access shared (the key itself is stored securely and is not shown)</li>`).join('')}</ul>` : '';
    }
    if (q.type === 'files') {
        const list = Array.isArray(answers.workflowFiles) ? answers.workflowFiles : [];
        return list.length ? `<ul class="list">${list.map((f) => `<li>${f.url ? `<a href="${escHtml(f.url)}">${escHtml(f.name)}</a>` : escHtml(f.name)}</li>`).join('')}</ul>` : '';
    }
    if (q.type === 'docs') {
        if (!v || typeof v !== 'object') return '';
        const rows = COMPLIANCE_DOCS.filter((d) => v.have?.[d.name]).map((d) => `<li>${escHtml(d.label)}${v.urls?.[d.name] ? ` — <a href="${escHtml(v.urls[d.name])}">${escHtml(v.urls[d.name])}</a>` : ''}</li>`);
        String(v.other || '').split(/[,\n;]+/).map((x) => x.trim()).filter(Boolean).forEach((o) => rows.push(`<li>${escHtml(o)}</li>`));
        return rows.length ? `<ul class="list">${rows.join('')}</ul>` : '';
    }
    return isBlank(v) ? '' : escHtml(v).replace(/\n/g, '<br>');
}

function printBlankHtml(q) {
    if (q.type === 'keys') return '';                          // never on paper
    if (q.type === 'files') return '<div class="hint">Attach any workflow documents (PDF) when you return this form.</div>';
    if (q.type === 'yesno') return '<div class="opts"><span>☐ Yes</span><span>☐ No</span></div>';
    if (q.type === 'multi') return `<div class="opts">${q.options.map((o) => `<span>☐ ${escHtml(o)}</span>`).join('')}</div>`;
    if (q.type === 'select') return `<div class="opts">${q.options.map((o) => `<span>☐ ${escHtml(o)}</span>`).join('')}</div>`;
    if (q.type === 'docs') return `<div class="opts">${q.docs.map((d) => `<div>☐ ${escHtml(d.label)} <span class="hint">link: ____________________</span></div>`).join('')}<div class="line"></div></div>`;
    if (q.type === 'textarea') return `<div class="box" style="height:${q.tall ? 120 : 56}px;"></div>`;
    return '<div class="line"></div>';
}

export function buildIntakePrintHtml(client, ob, { blank = false } = {}) {
    const a = ob.answers || {};
    const when = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '');
    const date = when(blank ? new Date().toISOString() : (ob.completedAt || new Date().toISOString()));
    const name = client?.meta?.name || '';
    // The contact step is the Name / Email block under the header, so it isn't repeated as a section.
    const sections = INTAKE_STEPS.filter((st) => st.key !== 'contact' && (blank || stepVisible(st, a))).map((step) => {
        const qs = step.questions.filter((q) => blank || !(q.showIf && !q.showIf(a)));
        const body = qs.map((q) => {
            if (blank) {
                const inner = printBlankHtml(q);
                if (!inner && q.type === 'keys') return '';
                return `<div class="q"><div class="l">${escHtml(q.label)}${q.hint ? ` <span class="hint">${escHtml(q.hint)}</span>` : ''}${q.showIf ? ' <span class="hint">(if it applies)</span>' : ''}</div>${inner}</div>`;
            }
            const ans = printAnswerHtml(q, a);
            if (!ans) return '';                               // unanswered questions are left off, like the Jotform PDF
            return `<div class="q ${q.type === 'textarea' && String(a[q.key] || '').length > 200 ? 'long' : ''}"><div class="l">${escHtml(q.label)}</div><div class="a">${ans}</div></div>`;
        }).filter(Boolean).join('');
        if (!body) return '';
        const note = blank && step.showIf ? '<div class="note">Advisory firms only.</div>' : '';
        return `<div class="section"><h2>${escHtml(step.title)}</h2>${note}${body}</div>`;
    }).join('');

    const contact = primaryContactOf(client);
    const who = blank ? `<div><div class="k">Name</div><div class="line"></div></div><div><div class="k">Email</div><div class="line"></div></div>`
        : `<div><div class="k">Name</div><div>${escHtml(a.name || contact.name || '')}</div></div><div><div class="k">Email</div><div>${escHtml(a.email || contact.email || '')}</div></div>`;
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escHtml(`Introductory Questionnaire${name && !blank ? ' — ' + name : ''}`)}</title><style>${PRINT_CSS}</style></head><body>
<div class="doc-head">
  <div class="brand">SPHYNX<small>AUTOMATION</small></div>
  <div class="doc-title"><h1>Introductory Questionnaire</h1><div class="sub">${escHtml(blank ? 'Please complete and return' : [name, date].filter(Boolean).join(' · '))}</div></div>
</div>
<div class="who">${who}</div>
${sections || '<p style="margin-top:20px;color:#64748b;">Nothing has been answered yet.</p>'}
<div class="foot">${escHtml(blank ? 'Sphynx Automation' : `${name ? name + ' · ' : ''}Introductory Questionnaire · ${ob.completed ? 'Completed' : 'In progress'} ${date}`)}</div>
</body></html>`;
}

// Opens the print dialog from a hidden frame (not a popup, so popup blockers can't stop it).
export function printIntake(blank = false) {
    const client = getActiveClient(); if (!client) return;
    const html = buildIntakePrintHtml(client, intakeOf(client), { blank });
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed; right:0; bottom:0; width:0; height:0; border:0;';
    document.body.appendChild(frame);
    const doc = frame.contentWindow.document;
    doc.open(); doc.write(html); doc.close();
    const go = () => { try { frame.contentWindow.focus(); frame.contentWindow.print(); } finally { setTimeout(() => frame.remove(), 60000); } };
    setTimeout(go, 400);    // let fonts and images settle
}

window.OL = window.OL || {};
Object.assign(window.OL, { printIntake, openIntakeWizard, intakeNext, intakeBack, intakeSaveAndClose, intakePickYesNo, intakeRefresh, renderIntakePage, intakeApplyApps, intakeAddSystem, intakeUploadFiles, intakeRemoveFile });
