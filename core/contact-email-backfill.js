//======================= CORE / CONTACT EMAIL BACKFILL =======================//
// When a contact with a new email address is added to a project's Team tab (or an existing contact gets a new
// address), emails already imported from that address that aren't linked to a project are linked to it automatically.
// Before this, the Backfill button in Communications had to be pressed by hand.
//
// How it knows an address is new: each project remembers the addresses it has already been checked for
// (projectData.backfilledContactEmails). The first time a project is seen, its current addresses are recorded as the
// starting point and nothing is run, so opening the app never triggers a mass backfill.
//
// The matching itself runs on the server (supabase/functions/backfill-gmail-links) with participantsOnly, so it only
// uses Team tab addresses (never the project's name found in the subject or text), skips emails someone deliberately
// unlinked, and only links when exactly one project matches an address.

import { state } from './data.js';

const INTERNAL_DOMAIN = '@sphynxautomation.com';

const emailsOf = (pd) => (pd?.teamMembers || [])
    .map((m) => String(m && typeof m === 'object' ? m.email || '' : '').trim().toLowerCase())
    .filter((e) => e.includes('@') && !e.endsWith(INTERNAL_DOMAIN) && !e.includes('no-reply'));

// Called by persist() right before a save is queued. Returns [{ clientId, emails }] for addresses not seen before,
// or null. Records them as seen on the project so they are only ever backfilled once.
export function takeNewContactEmails() {
    if (window.IS_GUEST) return null;
    const ids = new Set([...(state.dirtyClientIds || []), state.activeClientId].filter(Boolean));
    const out = [];
    ids.forEach((id) => {
        const client = state.clients?.[id];
        const pd = client?.projectData;
        if (!pd || client._metaOnly || !Array.isArray(pd.teamMembers)) return;
        const emails = emailsOf(pd);
        if (!Array.isArray(pd.backfilledContactEmails)) { pd.backfilledContactEmails = [...new Set(emails)]; return; }   // first look: the starting point
        const fresh = [...new Set(emails)].filter((e) => !pd.backfilledContactEmails.includes(e));
        if (!fresh.length) return;
        pd.backfilledContactEmails.push(...fresh);
        out.push({ clientId: id, emails: fresh });
    });
    return out.length ? out : null;
}

// Runs after the save finishes (the server reads each project's Team tab from the database, so the new address has to be
// saved first).
export async function backfillForNewContacts(pending) {
    const OL = window.OL;
    if (!OL || typeof OL.getAuthHeaders !== 'function' || !Array.isArray(pending) || !pending.length) return;
    try {
        const response = await fetch('https://kexnnpwjerrnsmifauuo.supabase.co/functions/v1/backfill-gmail-links', {
            method: 'POST',
            headers: { ...(await OL.getAuthHeaders()), 'Content-Type': 'application/json' },
            body: JSON.stringify({ participantsOnly: true })
        });
        if (!response.ok) { console.warn('Contact email backfill skipped (HTTP ' + response.status + ').'); return; }
        const result = await response.json();
        if (result.error) { console.warn('Contact email backfill failed:', result.error); return; }
        const mine = pending.reduce((n, p) => n + (result.matchedByClient?.[p.clientId] || 0), 0);
        if (mine > 0) {
            if (typeof OL.showToast === 'function') OL.showToast(`Linked ${mine} existing email${mine === 1 ? '' : 's'} to ${mine === 1 ? 'this project' : 'the project'} from the new contact.`);
            if (typeof OL.loadGmailFeed === 'function') await OL.loadGmailFeed();
            if (typeof OL._refreshAfterGmailAction === 'function') OL._refreshAfterGmailAction();
        }
    } catch (e) {
        console.warn('Contact email backfill failed:', e);
    }
}

window.OL = window.OL || {};
Object.assign(window.OL, { takeNewContactEmails, backfillForNewContacts });
