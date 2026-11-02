//======================= CORE / REVIEWS =======================//
// A review is what was sent to the client for approval: the chosen tasks and resources, who sent it, who follows
// up (always the Communications role, even when someone else sent it), the dates, and how it ended.
//
//   draft -> sent -> approved | change_requested
//
// Closing a task means "my work is done". Review is a separate step ("Send for review") where the sender chooses
// what goes in. "Pending client review" is not a status stored on the task: it is derived from a sent review.
// Approved is its own end state, separate from Done.
//
// Pure functions first, then thin database calls that never throw into the app.

import { db, uid } from './data.js';
import { assigneeForRole } from './testing.js';

export const REVIEW_STATUSES = ['draft', 'sent', 'approved', 'change_requested'];
export const ITEM_OUTCOMES = ['pending', 'approved', 'change_requested'];

// Who follows up with the client for this project: the person in the Communications role.
export function followUpOwnerFor(client, roles, fallback = '') {
    return assigneeForRole(client, roles, /communicat/i, fallback);
}

// items: [{ type: 'task'|'resource'|'request', id }]
export function buildReview({ clientId, sheetId, round, sentBy, followUpOwner, items = [], summary, now } = {}) {
    const id = 'rv_' + uid().slice(3);
    const seen = new Set();
    const list = [];
    for (const it of items) {
        const key = `${it?.type}:${it?.id}`;
        if (!it || !it.id || !['task', 'resource', 'request'].includes(it.type) || seen.has(key)) continue;
        seen.add(key);
        list.push({ id: 'ri_' + uid().slice(3), review_id: id, item_type: it.type, item_id: String(it.id), outcome: 'pending', note: null, decided_at: null });
    }
    return {
        review: {
            id, client_id: String(clientId || ''), sheet_id: sheetId ? String(sheetId) : null,
            round: Number.isFinite(Number(round)) ? Number(round) : null,
            sent_by: sentBy || null, follow_up_owner: followUpOwner || null, status: 'draft',
            sent_at: null, sent_outside_ol: false, approved_at: null, change_requested_at: null,
            summary: summary || null, created_at: now || new Date().toISOString(),
        },
        items: list,
    };
}

// draft -> sent. outsideOl = it was already sent from Gmail and is only being recorded here.
export function markSent(review, { outsideOl = false, sentAt } = {}) {
    if (!review || review.status !== 'draft') return review;
    return { ...review, status: 'sent', sent_outside_ol: !!outsideOl, sent_at: sentAt || new Date().toISOString() };
}

// Record one item's outcome and work out where the whole review stands.
// Any change requested -> the review is change_requested. All approved -> approved. Otherwise it stays sent.
export function decideItem(review, items, itemId, outcome, { note, at } = {}) {
    if (!ITEM_OUTCOMES.includes(outcome) || outcome === 'pending') return { review, items };
    const when = at || new Date().toISOString();
    const nextItems = (items || []).map((it) => (it.id === itemId ? { ...it, outcome, note: note || it.note || null, decided_at: when } : it));
    return { review: rollUp(review, nextItems, when), items: nextItems };
}

export function approveAll(review, items, at) {
    const when = at || new Date().toISOString();
    const nextItems = (items || []).map((it) => (it.outcome === 'pending' ? { ...it, outcome: 'approved', decided_at: when } : it));
    return { review: rollUp(review, nextItems, when), items: nextItems };
}

function rollUp(review, items, when) {
    if (!review || review.status === 'draft' || !items.length) return review;
    if (items.some((i) => i.outcome === 'change_requested')) {
        return { ...review, status: 'change_requested', change_requested_at: review.change_requested_at || when, approved_at: null };
    }
    if (items.every((i) => i.outcome === 'approved')) return { ...review, status: 'approved', approved_at: when, change_requested_at: null };
    return { ...review, status: 'sent' };
}

// "Pending client review" is derived: a task or resource is pending when it sits in a sent review without an outcome.
export function isPendingClientReview(reviews, itemsByReview, itemType, itemId) {
    return (reviews || []).some((r) => r.status === 'sent'
        && (itemsByReview?.[r.id] || []).some((i) => i.item_type === itemType && String(i.item_id) === String(itemId) && i.outcome === 'pending'));
}

// Days since a review went out, for the "Day 5" chip and the "not yet sent" flag.
export function daysSince(iso, now = new Date()) {
    if (!iso) return null;
    return Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 86400000));
}

// Items that are done but not in any review, so the Communications person can be flagged after a set number of days.
export function readyButNotSent({ closedItems = [], reviews = [], itemsByReview = {}, minDays = 3, now = new Date() } = {}) {
    const inReview = new Set();
    for (const r of reviews) for (const i of itemsByReview[r.id] || []) inReview.add(`${i.item_type}:${i.item_id}`);
    return closedItems.filter((c) => !inReview.has(`${c.type}:${c.id}`) && (daysSince(c.closedAt, now) ?? 0) >= minDays);
}

// ---- database ------------------------------------------------------------------------------------------------
let tableOk = true;
const off = (e) => { if (tableOk) console.warn('Reviews are switched off for this session:', e?.message || e); tableOk = false; };

export async function saveReview(review, items) {
    if (!tableOk || !review?.id) return false;
    try {
        const r = await db.from('reviews').upsert(review);
        if (r.error) { off(r.error); return false; }
        if (items && items.length) {
            const i = await db.from('review_items').upsert(items);
            if (i.error) { off(i.error); return false; }
        }
        return true;
    } catch (e) { off(e); return false; }
}

export async function loadReviews(clientId) {
    if (!tableOk || !clientId) return { reviews: [], itemsByReview: {} };
    try {
        const r = await db.from('reviews').select('*').eq('client_id', String(clientId)).order('created_at', { ascending: false });
        if (r.error) { off(r.error); return { reviews: [], itemsByReview: {} }; }
        const reviews = r.data || [];
        if (!reviews.length) return { reviews, itemsByReview: {} };
        const i = await db.from('review_items').select('*').in('review_id', reviews.map((x) => x.id));
        if (i.error) { off(i.error); return { reviews, itemsByReview: {} }; }
        const itemsByReview = {};
        (i.data || []).forEach((it) => { (itemsByReview[it.review_id] = itemsByReview[it.review_id] || []).push(it); });
        return { reviews, itemsByReview };
    } catch (e) { off(e); return { reviews: [], itemsByReview: {} }; }
}
