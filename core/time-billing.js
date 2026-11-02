//======================= CORE / TIME AND BILLING =======================//
// Every time entry says where it belongs (its bucket), can be fixed from the task with an audit trail, and a timer
// that was left running is caught instead of becoming a surprise on the invoice. Pure functions.
//
// Buckets
//   billable     billed to the client
//   allowance    a small tweak covered by the round's tweak allowance
//   rework       we caused it: not billed, and not taken from the allowance
//   goodwill     extra time we chose not to charge for, tracked separately
//   needs_review a forgotten or auto-stopped timer: kept out of billable totals until someone confirms it
//
// Tweak allowance: the larger of 10% of the round's fee (as hours at the project's rate) or a 30-minute floor.
// Only "they are asking for more" draws on it. When it is used up, later asks need an estimate first.

export const BUCKETS = [
    { key: 'billable',     label: 'Billable',               color: '#2dd4bf' },
    { key: 'allowance',    label: 'Included allowance',     color: '#f5b942' },
    { key: 'rework',       label: 'Rework (we caused it)',  color: '#f87171' },
    { key: 'goodwill',     label: 'Goodwill',               color: '#a78bfa' },
    { key: 'needs_review', label: 'Needs review',           color: '#f5b942' },
];
export const BUCKET_KEYS = BUCKETS.map((b) => b.key);

export const ALLOWANCE_PERCENT = 10;
export const ALLOWANCE_FLOOR_HOURS = 0.5;
export const ALLOWANCE_VALID_DAYS = 30;
export const TIMER_WELCOME_BACK_HOURS = 2;          // a timer that has run this long gets the welcome-back prompt

// Hours covered by the allowance for a round with this fee, at this hourly rate.
export function tweakAllowanceHours(roundFee, hourlyRate) {
    const fee = Number(roundFee) || 0, rate = Number(hourlyRate) || 0;
    const byFee = rate > 0 ? (fee * ALLOWANCE_PERCENT / 100) / rate : 0;
    return Math.round(Math.max(byFee, ALLOWANCE_FLOOR_HOURS) * 10) / 10;
}

export function allowanceExpiry(roundStartedIso, days = ALLOWANCE_VALID_DAYS) {
    if (!roundStartedIso) return '';
    const d = new Date(roundStartedIso);
    if (Number.isNaN(d.getTime())) return '';
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

// entries: time log entries from any tasks. Minutes by bucket; needs_review stays out of the billable total.
export function totalsByBucket(entries) {
    const out = { billable: 0, allowance: 0, rework: 0, goodwill: 0, needs_review: 0, unassigned: 0 };
    (entries || []).forEach((e) => {
        const m = Number(e?.minutes) || 0;
        if (e?.needsReview || e?.bucket === 'needs_review') out.needs_review += m;
        else if (BUCKET_KEYS.includes(e?.bucket)) out[e.bucket] += m;
        else out.unassigned += m;
    });
    return out;
}

// { totalMin, usedMin, leftMin, expired, usedPct } for the meter.
export function allowanceStatus({ allowanceHours, entries, expiresDay, today }) {
    const totalMin = Math.round((Number(allowanceHours) || 0) * 60);
    const usedMin = totalsByBucket(entries).allowance;
    return {
        totalMin, usedMin, leftMin: Math.max(0, totalMin - usedMin),
        expired: !!(expiresDay && today && today > expiresDay),
        usedPct: totalMin ? Math.min(100, Math.round((usedMin / totalMin) * 100)) : 0,
    };
}

// Which bucket to suggest for time spent because of a move back. A person can change it.
//   we_caused_it -> rework;  asking_for_more -> allowance while some is left (else billable);  world_changed -> billable
export function suggestBucket({ whyCategory, minutes = 0, allowanceLeftMin = 0, allowanceExpired = false } = {}) {
    if (whyCategory === 'we_caused_it') return 'rework';
    if (whyCategory === 'asking_for_more') return !allowanceExpired && allowanceLeftMin >= minutes && allowanceLeftMin > 0 ? 'allowance' : 'billable';
    return 'billable';
}

// ---- edits with an audit trail ------------------------------------------------------------------------------------
// Changes minutes, bucket or note on one entry and records who changed what. Returns the entry.
export function editEntry(entry, changes = {}, by = '', now = new Date().toISOString()) {
    if (!entry) return entry;
    if (!Array.isArray(entry.audit)) entry.audit = [];
    const apply = (field, value) => {
        if (value === undefined || String(entry[field] ?? '') === String(value ?? '')) return;
        entry.audit.push({ at: now, by, field, from: entry[field] ?? null, to: value ?? null, reason: changes.reason || '' });
        entry[field] = value;
    };
    if (changes.minutes !== undefined) apply('minutes', Math.max(0, Math.round(Number(changes.minutes) || 0)));
    if (changes.bucket !== undefined && (BUCKET_KEYS.includes(changes.bucket) || changes.bucket === '')) {
        apply('bucket', changes.bucket);
        if (changes.bucket !== 'needs_review' && entry.needsReview) { entry.audit.push({ at: now, by, field: 'needsReview', from: true, to: false, reason: changes.reason || '' }); entry.needsReview = false; }
    }
    if (changes.note !== undefined) apply('note', changes.note);
    return entry;
}

// Confirms a flagged entry as it is (or in a bucket), taking it out of "needs review".
export function confirmEntry(entry, bucket = 'billable', by = '', now) {
    if (!entry) return entry;
    return editEntry(entry, { bucket, reason: 'Confirmed after review' }, by, now);
}

// ---- forgotten timers ---------------------------------------------------------------------------------------------
// A running timer's elapsed seconds, and whether it has run long enough to ask the person about it.
export const timerNeedsWelcomeBack = (startMs, nowMs, limitHours = TIMER_WELCOME_BACK_HOURS) => (nowMs - startMs) / 3600000 >= limitHours;

// The end time to trim to: never before the start, never after now.
export function clampEnd(startMs, endMs, nowMs) {
    return Math.min(Math.max(endMs, startMs), nowMs);
}

// Time entry for a timer that was stopped at endMs. kept = the person kept everything -> flagged for review.
export function timerEntry({ startMs, endMs, by, kept = false, note = '' }) {
    const minutes = Math.max(0, Math.round((endMs - startMs) / 60000));
    return {
        by, minutes, start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString(), note, source: 'timer',
        bucket: kept ? 'needs_review' : '', needsReview: !!kept,
    };
}
