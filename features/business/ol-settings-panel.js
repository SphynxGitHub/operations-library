// ================= ⚙️ TEMPLATES & SETTINGS (Automations tab) =================
// Where the wording and numbers that used to be hard-coded are edited: the meeting-summary and client-follow-up
// emails, the working-round follow-up task, the intro-call task, the scheduling levels, and which Master Library
// sections can be linked from an email. Stored by core/ol-settings.js (workspace_masters.ol_settings).

import { esc, state, updateAndSync } from '../../core/data.js';
import { getOlSettings, DEFAULT_OL_SETTINGS } from '../../core/ol-settings.js';

const TIER_OPTIONS = [['green', 'Green'], ['yellow', 'Yellow'], ['red', 'Red']];

// A setting stored as a first name ("Arielle") shows as the matching roster member.
const resolveMember = (name) => {
    const n = String(name || '').trim().toLowerCase();
    if (!n) return '';
    const hit = (state.master?.sphynxTeam || []).find((m) => String(m.name || '').toLowerCase() === n) || (state.master?.sphynxTeam || []).find((m) => String(m.name || '').toLowerCase().startsWith(n + ' '));
    return hit ? hit.name : name;
};
const teamNames = () => (state.master?.sphynxTeam || []).map((m) => m.name).filter(Boolean);

function librarySections() {
    const names = new Set((state.master?.resourceTypes || []).map((t) => t.type).filter(Boolean));
    (state.master?.functions || []).forEach((r) => { if (r?.type) names.add(r.type); });
    return [...names].sort((a, b) => a.localeCompare(b));
}

const field = (label, inner, hint) => `<div style="margin-bottom:10px;"><label class="tiny muted" style="display:block; font-size:11px; font-weight:600; margin-bottom:3px;">${label}</label>${inner}${hint ? `<div class="tiny muted" style="margin-top:2px;">${hint}</div>` : ''}</div>`;
const text = (id, v) => `<input id="${id}" type="text" class="modal-input" value="${esc(v ?? '')}">`;
const area = (id, v, rows = 3) => `<textarea id="${id}" class="modal-input" rows="${rows}" style="font-family:inherit;">${esc(v ?? '')}</textarea>`;
const numIn = (id, v, w = 90) => `<input id="${id}" type="number" min="0" step="0.5" class="modal-input" style="width:${w}px;" value="${esc(v ?? '')}">`;
const check = (id, on, label) => `<label style="display:flex; align-items:center; gap:6px; font-size:12px;"><input id="${id}" type="checkbox" ${on ? 'checked' : ''}> ${label}</label>`;
const personSelect = (id, current, blankLabel) => {
    const names = teamNames();
    const all = current && !names.includes(current) ? [...names, current] : names;
    return `<select id="${id}" class="modal-input os-select"><option value="">${blankLabel}</option>${all.map((n) => `<option value="${esc(n)}" ${n === current ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>`;
};
const tierSelect = (id, current) => `<select id="${id}" class="modal-input" style="width:120px;">${TIER_OPTIONS.map(([k, l]) => `<option value="${k}" ${k === current ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
const section = (title, sub, body) => `<div class="card" style="padding:16px 18px; margin-bottom:14px;"><div style="font-weight:700; font-size:14px;">${title}</div><div class="tiny muted" style="margin:2px 0 12px;">${sub}</div>${body}</div>`;

const PANEL_STYLE = `<style>
    .os-panel { max-width: 860px; }
    .os-panel input[type="text"], .os-panel textarea, .os-panel select.os-wide {
        display: block !important; width: 100% !important; box-sizing: border-box !important; margin: 0 !important;
        font-size: 13px !important; line-height: 1.45 !important; font-family: inherit !important;
    }
    .os-panel textarea { resize: vertical; min-height: 64px; }
    .os-panel input[type="number"] { box-sizing: border-box; }
    .os-panel select.os-select { min-width: 220px; max-width: 100%; }
    .os-panel .os-row { display: flex; gap: 16px; flex-wrap: wrap; align-items: flex-start; }
    .os-panel .os-row > div { flex: 0 0 auto; }
</style>`;

OL.renderOlSettingsPanel = function() {
    const s = getOlSettings();
    const t = s.templates, d = s.draftingFollowUp, ic = s.introCall, sc = s.scheduling, zr = s.zapRepull, ig = s.integrations;
    const linkable = new Set(s.emailLinkableResourceTypes || []);
    const banner = state.masterHasOlSettings ? '' : `<div class="card" style="padding:12px 16px; margin-bottom:14px; border:1px solid #f59e0b;"><b>One-time setup needed.</b> <span class="small">Run <code>supabase/migrations/2026_10_ol_settings.sql</code> in the Supabase SQL editor. Until then the defaults below are used and changes here cannot be saved.</span></div>`;

    return `
        ${PANEL_STYLE}<div class="os-panel">
        ${banner}
        ${section('Meeting summary email', 'The email that goes out after a meeting. The summary and the next steps are filled in from the meeting and its tasks; this is the wording around them.',
            field('Subject', text('os-ms-subject', t.meetingSummary.subject), 'Fills in: {title} {date}') +
            field('Opening line', area('os-ms-intro', t.meetingSummary.intro), 'Fills in: {date} {title} {sender}. If a meeting has no date, " on {date}" drops out by itself.') +
            field('Closing', area('os-ms-closing', t.meetingSummary.closing, 2), 'Your signature is added under the closing and carries your name, so {sender} fills in blank when a signature is attached.'))}

        ${section('Client follow-up email', 'The consolidated "checking in on open items" email sent from the Client follow-up task.',
            field('Subject', text('os-cf-subject', t.clientFollowUp.subject), 'Fills in: {client} {sender}') +
            field('Opening line', area('os-cf-intro', t.clientFollowUp.intro), 'Comes right after "Hi [first name],". Fills in: {client} {sender}') +
            field('Closing', area('os-cf-closing', t.clientFollowUp.closing, 2), 'Your signature is added under the closing and carries your name, so {sender} fills in blank when a signature is attached. Also fills in: {client}'))}

        ${section('Working rounds left in Drafting', 'When a working round sits in Drafting too long, a task is created to follow up with the client or change the round\'s status (Approved, Declined or On Hold) to record the outcome.',
            `<div style="margin-bottom:10px;">${check('os-df-enabled', d.enabled !== false, 'Create these follow-up tasks')}</div>` +
            `<div class="os-row">${field('After (days in Drafting)', numIn('os-df-after', d.afterDays))}${field('Then again every (days)', numIn('os-df-repeat', d.repeatEveryDays), 'Only once the previous task is closed.')}</div>` +
            field('Task title', text('os-df-title', d.taskTitle), 'Fills in: {round} {client} {days}') +
            field('Task description', area('os-df-desc', d.taskDescription), 'Fills in: {round} {client} {days}') +
            field('Assigned to', personSelect('os-df-assignee', d.assignee, 'The project\'s Communications person'))) }

        ${section('Zap export re-pull (Ongoing Maintenance)', 'Keeps each Ongoing Maintenance client\'s flow map current. A task to pull a fresh Zap JSON export is created once for each client already on the plan, once when a client is onboarded, and each time a new plan period starts.',
            `<div style="margin-bottom:10px;">${check('os-zr-enabled', zr.enabled !== false, 'Create these re-pull tasks')}</div>` +
            field('Task title', text('os-zr-title', zr.taskTitle), 'Fills in: {client} {reason}') +
            field('Task description', area('os-zr-desc', zr.taskDescription), 'Fills in: {client} {reason}') +
            `<div class="os-row">${field('Due (days from creation)', numIn('os-zr-due', zr.dueInDays), 'For a new plan period, the task is due on its start date if that is later.')}` +
            `${field('Assigned to', personSelect('os-zr-assignee', zr.assignee, 'The project\'s Communications person'))}</div>`)}

        ${section('Outside services (auto-pull)', 'Calendly, Wealthbox, Redtail, Jotform, ActiveCampaign, MailerLite, YouCanBook.me and Process Street. A service already pulled once in a project is pulled again by itself when that project is opened, so the flow map keeps up with changes made in those apps. A first pull is always a click in the Importer Hub.',
            `<div style="margin-bottom:10px;">${check('os-ig-enabled', ig.autoPull !== false, 'Refresh connected services automatically')}</div>` +
            `<div class="os-row">${field('Refresh when older than (hours)', numIn('os-ig-hours', ig.everyHours), 'Checked when a project is opened, and once an hour while it stays open.')}</div>`)}

        ${section('Intro calls', 'A calendar event matched to a project whose title contains one of the words below gets a review task ahead of the call.',
            `<div style="margin-bottom:10px;">${check('os-ic-enabled', ic.enabled !== false, 'Create a review task for intro calls')}</div>` +
            field('Title contains (comma separated)', text('os-ic-words', ic.titleKeywords)) +
            `<div class="os-row">${field('Days before the call', numIn('os-ic-days', ic.daysBefore), 'Due that many days ahead (today, if that has already passed).')}</div>` +
            field('Task title', text('os-ic-title', ic.taskTitle)) +
            field('Assigned to', personSelect('os-ic-assignee', ic.assignee, 'Sphynx Task (no one in particular)')))}

        ${section('Scheduling levels', 'How busy a day is, from meetings plus tasks already due that day. When a task is given a date automatically, it goes on the first day whose level the client is allowed to use — the same rule on every day it checks, today or later.',
            `<div class="os-row">${field('Green: under (hours)', numIn('os-sc-green', sc.greenUnderHours))}${field('Yellow: under (hours)', numIn('os-sc-yellow', sc.yellowUnderHours))}${field('Red: under (hours)', numIn('os-sc-red', sc.redUnderHours), 'This many hours or more = Closed (gray). Never used.')}</div>` +
            `<div style="font-weight:600; font-size:12px; margin:6px 0;">Busiest a day can already be for a task to be placed on it</div>` +
            `<div class="os-row">` +
                field('Ongoing Maintenance clients', tierSelect('os-sc-om', sc.maxTierByStatus['Ongoing Maintenance'] || sc.maxTierDefault)) +
                field('White Glove clients', tierSelect('os-sc-wg', sc.maxTierByStatus['White Glove'] || sc.maxTierDefault)) +
                field('Everyone else', tierSelect('os-sc-other', sc.maxTierDefault)) +
            `</div>` +
            `<div class="os-row">${field('Look ahead (working days)', numIn('os-sc-window', sc.windowDays), 'Starts today, then each next day.')}` +
                field('Move tasks to a later day once a day reaches (hours)', numIn('os-sc-roll', sc.rollOverHours), 'Meetings + tasks. The newest not-started tasks on that day move on until it is back under. 0 = off.') +
                field('Most hours of one task per day', numIn('os-sc-maxday', sc.maxHoursPerDay), 'A task estimated longer than this is spread over several working days, this many hours each. 0 = never split.') +
                field('Follow-up task estimate (hours)', numIn('os-sc-fuhrs', sc.followUpEstimateHours), 'Used for follow-up tasks that have no estimate of their own. Other tasks without one count 1h.') +
                field('Fee per estimated hour ($)', numIn('os-sc-feehr', sc.feePerEstimatedHour), 'A task\'s estimated hours = its fee ÷ this. Set 200 against a higher billing rate for a buffer.') +
                field('If nothing fits, ask', personSelect('os-sc-reviewer', sc.reviewer, 'The person the task is assigned to'), 'They pick the date by hand.') +
                field('…or, if it has no named person', personSelect('os-sc-fallback', resolveMember(sc.fallbackReviewer), 'No one'), 'Used when the task is assigned to "Sphynx Task" or no one.') + `</div>`)}

        ${section('Email links from the Master Library', 'Which Master Library sections can be linked when writing an email ("From Master Library" in the compose window). Only resources in the ticked sections are offered.',
            librarySections().length
                ? `<div style="display:grid; grid-template-columns:repeat(auto-fill,minmax(180px,1fr)); gap:6px;">${librarySections().map((name) => `<label style="display:flex; align-items:center; gap:6px; font-size:12px;"><input type="checkbox" class="os-link-type" data-type="${esc(name)}" ${linkable.has(name) ? 'checked' : ''}> ${esc(name)}</label>`).join('')}</div>`
                : '<div class="tiny muted">No Master Library sections yet.</div>')}

        <div style="display:flex; gap:10px; align-items:center;">
            <button class="btn primary" onclick="OL.saveOlSettings()">Save settings</button>
            <button class="btn soft" onclick="OL.resetOlSettings()" title="Puts every wording and number on this tab back to the original">Reset everything to the defaults</button>
            <span id="os-status" class="tiny muted"></span>
        </div>
        </div>`;
};

OL.saveOlSettings = function() {
    const v = (id) => document.getElementById(id)?.value ?? '';
    const on = (id) => !!document.getElementById(id)?.checked;
    const num = (id, fallback) => { const n = parseFloat(v(id)); return Number.isFinite(n) && n >= 0 ? n : fallback; };
    const d = DEFAULT_OL_SETTINGS;
    const cur = getOlSettings();

    const green = num('os-sc-green', d.scheduling.greenUnderHours), yellow = num('os-sc-yellow', d.scheduling.yellowUnderHours), red = num('os-sc-red', d.scheduling.redUnderHours);
    if (!(green < yellow && yellow < red)) { alert('The levels need to go up: Green hours < Yellow hours < Red hours.'); return; }
    if (!state.masterHasOlSettings) { alert('Run the ol_settings migration first — settings cannot be saved until that column exists.'); return; }

    const next = {
        templates: {
            meetingSummary: { subject: v('os-ms-subject'), intro: v('os-ms-intro'), closing: v('os-ms-closing') },
            clientFollowUp: { subject: v('os-cf-subject'), intro: v('os-cf-intro'), closing: v('os-cf-closing') },
        },
        draftingFollowUp: {
            enabled: on('os-df-enabled'), afterDays: Math.max(1, num('os-df-after', d.draftingFollowUp.afterDays)), repeatEveryDays: Math.max(1, num('os-df-repeat', d.draftingFollowUp.repeatEveryDays)),
            taskTitle: v('os-df-title'), taskDescription: v('os-df-desc'), assignee: v('os-df-assignee'),
        },
        integrations: { autoPull: on('os-ig-enabled'), everyHours: Math.max(1, Math.round(num('os-ig-hours', d.integrations.everyHours))) },
        zapRepull: { enabled: on('os-zr-enabled'), taskTitle: v('os-zr-title'), taskDescription: v('os-zr-desc'), dueInDays: Math.round(num('os-zr-due', d.zapRepull.dueInDays)), assignee: v('os-zr-assignee') },
        introCall: { enabled: on('os-ic-enabled'), titleKeywords: v('os-ic-words'), daysBefore: num('os-ic-days', d.introCall.daysBefore), taskTitle: v('os-ic-title'), assignee: v('os-ic-assignee') },
        scheduling: {
            greenUnderHours: green, yellowUnderHours: yellow, redUnderHours: red,
            maxTierByStatus: { ...(cur.scheduling.maxTierByStatus || {}), 'Ongoing Maintenance': v('os-sc-om'), 'White Glove': v('os-sc-wg') },
            maxTierDefault: v('os-sc-other'),
            feePerEstimatedHour: Math.max(0, num('os-sc-feehr', d.scheduling.feePerEstimatedHour)),
            followUpEstimateHours: Math.max(0, num('os-sc-fuhrs', d.scheduling.followUpEstimateHours)),
            maxHoursPerDay: Math.max(0, num('os-sc-maxday', d.scheduling.maxHoursPerDay)),
            rollOverHours: Math.max(0, num('os-sc-roll', d.scheduling.rollOverHours)),
            windowDays: Math.max(1, Math.round(num('os-sc-window', d.scheduling.windowDays))), reviewer: v('os-sc-reviewer'), fallbackReviewer: v('os-sc-fallback'),
        },
        emailLinkableResourceTypes: [...document.querySelectorAll('.os-link-type:checked')].map((el) => el.dataset.type),
    };
    updateAndSync(() => { state.master.olSettings = next; });
    const status = document.getElementById('os-status');
    if (status) status.textContent = 'Saved.';
};

OL.resetOlSettings = function() {
    if (!confirm('Put every wording and number on this tab back to the original defaults?')) return;
    updateAndSync(() => { state.master.olSettings = {}; });
    OL.renderAutomationBuilder();
};
