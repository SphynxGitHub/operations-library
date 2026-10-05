//======================= CORE / OL SETTINGS =======================//
// One place for the wording and numbers that used to be hard-coded: the meeting-summary and client-follow-up
// emails, the working-round follow-up task, the intro-call task, the scheduling thresholds, and which Master
// Library sections may be linked from an email. Stored as one object on the master row (workspace_masters.
// ol_settings, see migrations/2026_10_ol_settings.sql), edited on Automations > Templates & settings
// (features/business/ol-settings-panel.js). Anything the org has not changed falls back to DEFAULT_OL_SETTINGS,
// so nothing changes until someone edits it.

import { state } from './data.js';

export const DEFAULT_OL_SETTINGS = {
    templates: {
        // {date} = the meeting date, {title} = the meeting title, {sender} = whoever is sending. The sender's signature
        // (Sphynx Team page) is added under every email and carries their name, so closings are just the sign-off word.
        meetingSummary: {
            subject: 'Summary: {title} ({date})',
            intro: 'Thanks for taking the time to meet with us on {date}. Below is a summary of what we covered and the next steps.',
            closing: 'Best,',
        },
        // {client} = the project name, {sender} = whoever is sending.
        clientFollowUp: {
            subject: '{client} — checking in on open items',
            intro: 'Touching base with you regarding the open items on your project. Please see below:',
            closing: 'Thank you,',
        },
    },
    // A working round that sits in Drafting this long gets a task to follow up with the client or change its status.
    draftingFollowUp: {
        enabled: true,
        afterDays: 7,
        repeatEveryDays: 7,
        taskTitle: 'Follow up on {round}: {client}',
        taskDescription: '{round} has been in Drafting for {days} days. Follow up with the client, or change the round\'s status to Approved, Declined or On Hold to record the outcome.',
        assignee: '',   // blank = the project's Communications person, else the general Sphynx task pool
    },
    // Ongoing Maintenance clients get a task to re-pull the Zap JSON export: once for each client already on the plan, once
    // when a client is onboarded, and each time a new plan period starts. {client} = the project name, {reason} = why now.
    zapRepull: {
        enabled: true,
        taskTitle: 'Re-pull Zap JSON export: {client}',
        taskDescription: 'Pull a fresh Zap JSON export from Zapier and import it (Import Zaps) so the flow map matches what is live. {reason}',
        dueInDays: 7,
        assignee: '',   // blank = the project's Communications person, else the general Sphynx task pool
    },
    // Outside services (Calendly, Wealthbox, Redtail, Jotform...): a project's connected services that have been pulled once
    // are pulled again by themselves, when the project is opened, after this many hours.
    integrations: {
        autoPull: true,
        everyHours: 24,
    },
    introCall: {
        enabled: true,
        titleKeywords: 'intro call',        // comma separated; a calendar event whose title contains any of these
        daysBefore: 2,
        taskTitle: 'Review Intro Call Questionnaire and Notes',
        assignee: 'Anthony',
    },
    scheduling: {
        // A day's booked hours (meetings + tasks already due) put it in a level:
        //   Green = under 3h   Yellow = 3h to 3:59   Red = 4h to 4:59   Closed (gray) = 5h or more
        greenUnderHours: 3,
        yellowUnderHours: 4,
        redUnderHours: 5,
        // The fullest level a day may already be in for a task to be placed on it — for the client's status, on
        // EVERY day the automation checks (today and any later day). Closed is never allowed.
        maxTierByStatus: { 'Ongoing Maintenance': 'red', 'White Glove': 'yellow' },
        maxTierDefault: 'green',
        // Estimated hours for a task = its fee / this number (the buffer is built in). 0 = fall back to 1h per task.
        feePerEstimatedHour: 200,
        // The most hours of ONE task counted on a single day. A task estimated longer than this is spread over several
        // working days, this many hours each (the last day gets what is left). 0 = never split.
        maxHoursPerDay: 2,
        // Once a person's total for a day (meetings + tasks) reaches this many hours, tasks on that day move to a later day
        // until it is back under. Meetings never move. 0 = off.
        rollOverHours: 7,
        windowDays: 14,       // working days to look ahead (today, then the next day, and so on) before handing it to a person
        // When nothing fits, who is asked to place it by hand: this person if set; otherwise whoever the task is
        // assigned to (approving their own task); otherwise the fallback.
        reviewer: '',
        fallbackReviewer: 'Arielle',
    },
    // Master Library sections (resource types) whose resources may be linked from an email. Empty = none.
    emailLinkableResourceTypes: [],
};

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
function merge(base, over) {
    if (!isObj(base)) return over === undefined ? base : over;
    const out = { ...base };
    if (isObj(over)) Object.keys(over).forEach((k) => { out[k] = isObj(base[k]) ? merge(base[k], over[k]) : (over[k] === undefined ? base[k] : over[k]); });
    return out;
}

export function getOlSettings(master = state?.master) {
    return merge(DEFAULT_OL_SETTINGS, master?.olSettings || {});
}

// {name} placeholders. Unknown ones are left as typed so a typo is visible rather than silently blank.
export function fillTemplate(text, vars = {}) {
    return String(text ?? '').replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k] ?? '') : m));
}
