//======================= CORE / REQUESTS =======================//
// Mirrors each client's scoping line items (still stored in the client's
// project_data JSON) into the `requests` and `request_target` tables created
// by 001_lifecycle_tables.sql.
//
// The JSON stays the source of truth for now, so the scoping sheet keeps working
// exactly as before. This module only copies changes across after each save.
// It never throws into the app: if the tables are missing or blocked, it logs
// once and switches itself off for the session.
//
// Called from persist() in core/data.js, after a client saves successfully.

import { deriveWorkStatus, WORK_STATUS } from './work-status.js';

// Shown until the editable list loads from the request_types table.
export const DEFAULT_REQUEST_TYPES = [
    { key: 'build',        label: 'Build' },
    { key: 'revision',     label: 'Revision' },
    { key: 'audit',        label: 'Audit' },
    { key: 'troubleshoot', label: 'Troubleshoot' },
    { key: 'training',     label: 'Training' },
    { key: 'meeting',      label: 'Meeting' },
];

// Where a client's scoping sheet stands, from the go-ahead decision to approval.
export const SHEET_STATUSES = [
    'Awaiting Go-Ahead',
    'Drafting',
    'Presented',
    'Revising',
    'Confirming Final Scope',
    'Approved',
    'On Hold',
    'Declined',
];

// The current round is the first round that still has a Do Now item open.
// isReal lets callers ignore lines that are not really on the sheet.
export function getCurrentRound(sheet, isReal = () => true) {
    let current = null;
    (sheet?.lineItems || []).forEach((item) => {
        if (!item || typeof item !== 'object' || String(item.status || '') !== 'Do Now') return;
        if (!isReal(item)) return;
        const r = parseInt(item.round, 10);
        const round = Number.isFinite(r) && r >= 1 ? r : 1;
        if (current === null || round < current) current = round;
    });
    return current;
}

// True for a Do Now line in the current round of an approved sheet.
export function isActiveItem(sheet, item, isReal = () => true) {
    if (!sheet || sheet.status !== 'Approved' || !item || String(item.status || '') !== 'Do Now') return false;
    const current = getCurrentRound(sheet, isReal);
    const r = parseInt(item.round, 10);
    const round = Number.isFinite(r) && r >= 1 ? r : 1;
    return current !== null && round === current;
}

let requestTypes = DEFAULT_REQUEST_TYPES;
let typesRequested = false;
let disabled = false;
const lastSignature = {};   // clientId -> signature of the last mirrored state
const queue = {};           // clientId -> promise chain, so mirrors never overlap

export function getRequestTypes() {
    return requestTypes;
}

// ---- small helpers ----
const isBlank = (v) => v === undefined || v === null || String(v).trim() === '';

const toNum = (v) => {
    if (isBlank(v)) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};

const sameValue = (a, b) => {
    const aBlank = a === undefined || a === null;
    const bBlank = b === undefined || b === null;
    if (aBlank && bBlank) return true;
    if (aBlank || bBlank) return false;
    if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b);
    return a === b;
};

const sameNumber = (a, b) => {
    const x = toNum(a);
    const y = toNum(b);
    if (x === null && y === null) return true;
    if (x === null || y === null) return false;
    return x === y;
};

function chunk(list, size) {
    const out = [];
    for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
    return out;
}

function handleError(where, err) {
    const msg = String(err?.message || err || '');
    console.warn(`⚠️ Requests sync (${where}):`, msg);
    // Tables missing, or policies not applied yet: stop trying this session.
    if (/permission denied|row-level security|does not exist|42501|42P01/i.test(msg) ||
        ['42501', '42P01'].includes(err?.code)) {
        if (!disabled) {
            disabled = true;
            console.warn('⚠️ Requests sync switched off for this session. Run 001, 002 and 003 in Supabase, then reload.');
        }
    }
}

// ---- mapping: scoping line item -> request row ----
function mapDecision(status) {
    const s = String(status || '');
    if (s === 'Do Now') return 'do_now';
    if (s === 'Do Later') return 'do_later';
    if (/^Don.t Do$/i.test(s)) return 'dont_do';
    if (s === 'Done') return 'do_now';
    return null;
}

function mapParty(party) {
    const p = String(party || '').trim();
    if (!p || p === 'Sphynx') return 'sphynx';
    if (p === 'Joint') return 'joint';
    return 'client_team';   // any other value is the client's own company name
}

function findResource(client, masterResources, resourceId) {
    if (isBlank(resourceId)) return null;
    const local = (client.projectData?.localResources || []).find(r => r.id === resourceId);
    if (local) return local;
    return (masterResources || []).find(r => r.id === resourceId) || null;
}

// Requests that have just become active and have not yet had their activation rules run:
// Do Now lines in the current round of an approved sheet with no activatedAt stamp.
// The caller stamps activatedAt after firing, so each request activates once.
export function listNewActivations(client, masterResources) {
    const out = [];
    (client?.projectData?.scopingSheets || []).forEach((sheet) => {
        if (!sheet || sheet.status !== 'Approved') return;

        const real = [];
        (sheet.lineItems || []).forEach((item) => {
            if (!item || typeof item !== 'object' || isBlank(item.id)) return;
            const resource = findResource(client, masterResources, item.resourceId);
            const title = !isBlank(item.name) ? String(item.name).trim() : (resource?.name || '');
            if (title) real.push({ item, title });
        });

        const current = getCurrentRound({ lineItems: real.map(r => r.item) });
        if (current === null) return;

        real.forEach(({ item, title }) => {
            const r = parseInt(item.round, 10);
            const round = Number.isFinite(r) && r >= 1 ? r : 1;
            if (String(item.status || '') === 'Do Now' && round === current && !item.activatedAt) {
                out.push({ sheet, item, title, round });
            }
        });
    });
    return out;
}

// Role ids by name, for the role that currently holds a request.
function roleIdFor(roles, kind) {
    const pattern = kind === 'communication' ? /communicat/i : /implement/i;
    return (roles || []).find(r => pattern.test(String(r?.name || '')))?.id || null;
}

// Everything the requests table should hold for this client, from the JSON.
function buildDesired(client, masterResources, opts = {}) {
    const desired = [];
    const sheets = client.projectData?.scopingSheets || [];
    const tasks = client.projectData?.clientTasks || [];

    sheets.forEach((sheet) => {
        // Real lines only: a title (own name or its resource's) is required.
        const real = [];
        (sheet?.lineItems || []).forEach((item, idx) => {
            if (!item || typeof item !== 'object' || isBlank(item.id)) return;
            const resource = findResource(client, masterResources, item.resourceId);
            const title = !isBlank(item.name) ? String(item.name).trim() : (resource?.name || '');
            if (!title) return;   // empty shell: no name and the resource is gone
            real.push({ item, idx, resource, title });
        });

        // Only an approved sheet has an active round: its first round with a Do Now line open.
        const currentRound = sheet.status === 'Approved'
            ? getCurrentRound({ lineItems: real.map(r => r.item) })
            : null;

        real.forEach(({ item, idx, resource, title }) => {
            const status = String(item.status || '');
            const round = parseInt(item.round, 10);
            const roundNumber = Number.isFinite(round) && round >= 1 ? round : 1;

            const isActive = currentRound !== null && status === 'Do Now' && roundNumber === currentRound;
            // Work status only means something once a request is active.
            const derived = isActive ? deriveWorkStatus(item, tasks, { closedNames: opts.closedNames }) : null;

            desired.push({
                legacy: String(item.id),
                targetResourceId: resource ? String(item.resourceId) : null,
                explicitType: isBlank(item.requestType) ? null : String(item.requestType),
                isActive,
                workStatus: derived ? derived.status : null,
                roleId: derived && derived.role ? roleIdFor(opts.roles, derived.role) : null,
                row: {
                    title,
                    client_decision: mapDecision(status),
                    responsible_party: mapParty(item.responsibleParty),
                    sheet_id: isBlank(sheet.id) ? null : String(sheet.id),
                    round_number: roundNumber,
                    position: idx + 1,
                    estimated_hours: toNum(item.manualHours),
                    rate: toNum(item.rate),
                    units: toNum(item.units),
                    total: toNum(item.total),
                    discount_value: toNum(item.discountValue),
                    notes: isBlank(item.notes) ? null : String(item.notes),
                },
                status,
            });
        });
    });

    return desired;
}

// Fields the mirror owns. Anything else on a request (targets added later,
// assignments, derived work status set by the app) is left alone.
const NUMERIC_KEYS = new Set([
    'round_number', 'position', 'estimated_hours', 'rate', 'units', 'total', 'discount_value',
]);

const OWNED = [
    'request_type', 'title', 'client_decision', 'responsible_party', 'lifecycle',
    'work_status', 'current_role_id', 'sheet_id', 'round_number', 'position', 'estimated_hours',
    'rate', 'units', 'total', 'discount_value', 'notes',
];

function computeRow(d, existing) {
    const row = { ...d.row };

    // Type: an explicit choice on the sheet wins; otherwise keep what the row has.
    row.request_type = d.explicitType || existing?.request_type || 'build';

    // Lifecycle comes straight from the sheet: Done, Don't Do, active (a Do Now line in
    // the current round of an approved sheet), or otherwise scoped.
    if (d.status === 'Done') row.lifecycle = 'done';
    else if (/^Don.t Do$/i.test(d.status)) row.lifecycle = 'declined';
    else row.lifecycle = d.isActive ? 'active' : 'scoped';

    // Work status is derived from the tasks linked to the request, for active requests.
    if (d.status === 'Done') row.work_status = WORK_STATUS.DONE;
    else if (d.isActive && d.workStatus) row.work_status = d.workStatus;
    else row.work_status = WORK_STATUS.PENDING;
    row.current_role_id = d.isActive ? d.roleId : null;

    return row;
}

async function runInBatches(items, size, fn) {
    for (const group of chunk(items, size)) {
        await Promise.all(group.map(fn));
    }
}

async function loadTypesOnce(db) {
    if (typesRequested) return;
    typesRequested = true;
    try {
        const { data, error } = await db
            .from('request_types')
            .select('key, label, sort_order')
            .order('sort_order', { ascending: true });
        if (error) throw error;
        if (Array.isArray(data) && data.length) {
            requestTypes = data.map(t => ({ key: t.key, label: t.label }));
            if (typeof window !== 'undefined' && window.OL) window.OL.requestTypes = requestTypes;
        }
    } catch (e) {
        handleError('load request types', e);
    }
}

async function doMirror(db, client, opts) {
    await loadTypesOnce(db);
    if (disabled) return;

    const desired = buildDesired(client, opts.masterResources, opts);
    const signature = JSON.stringify(desired.map(d => [d.legacy, d.row, d.explicitType, d.status, d.isActive, d.workStatus, d.roleId, d.targetResourceId]));
    if (lastSignature[client.id] === signature) return;

    // 1. What exists already for this client (line-item requests only)
    const { data: existingRows, error: exErr } = await db
        .from('requests')
        .select(['id', 'legacy_line_item_id', 'source_type', ...OWNED].join(', '))
        .eq('client_id', client.id)
        .not('legacy_line_item_id', 'is', null)
        .range(0, 4999);
    if (exErr) throw exErr;

    const existingByLegacy = new Map((existingRows || []).map(r => [r.legacy_line_item_id, r]));
    const desiredLegacy = new Set(desired.map(d => d.legacy));

    // 2. Work out inserts, updates and deletes
    const toInsert = [];
    const toUpdate = [];
    for (const d of desired) {
        const existing = existingByLegacy.get(d.legacy);
        const row = computeRow(d, existing);
        if (!existing) {
            toInsert.push({
                client_id: client.id,
                legacy_line_item_id: d.legacy,
                source_type: 'scoping_import',
                ...row,
            });
        } else {
            const patch = {};
            for (const key of OWNED) {
                const equal = NUMERIC_KEYS.has(key)
                    ? sameNumber(existing[key], row[key])
                    : sameValue(existing[key], row[key]);
                if (!equal) patch[key] = row[key];
            }
            if (Object.keys(patch).length) toUpdate.push({ id: existing.id, patch });
        }
    }

    // Removed from the sheet. Guard: an empty sheet never wipes existing requests,
    // in case the client loaded incompletely.
    const toDelete = desired.length === 0 ? [] : (existingRows || [])
        .filter(r => r.source_type === 'scoping_import' && !desiredLegacy.has(r.legacy_line_item_id))
        .map(r => r.id);

    // 3. Apply
    const idByLegacy = new Map((existingRows || []).map(r => [r.legacy_line_item_id, r.id]));

    for (const group of chunk(toInsert, 100)) {
        const { data, error } = await db
            .from('requests')
            .insert(group)
            .select('id, legacy_line_item_id');
        if (error && error.code !== '23505') throw error;   // 23505 = already there (a parallel save)
        (data || []).forEach(r => idByLegacy.set(r.legacy_line_item_id, r.id));
    }

    await runInBatches(toUpdate, 10, async ({ id, patch }) => {
        const { error } = await db.from('requests').update(patch).eq('id', id);
        if (error) throw error;
    });

    for (const group of chunk(toDelete, 100)) {
        const { error } = await db.from('requests').delete().in('id', group);
        if (error) throw error;
    }

    // 4. Make sure each request points at its resource (adds only; never removes,
    //    so extra targets added elsewhere are safe)
    const wanted = desired
        .filter(d => d.targetResourceId && idByLegacy.get(d.legacy))
        .map(d => ({ request_id: idByLegacy.get(d.legacy), target_type: 'resource', target_id: d.targetResourceId }));

    if (wanted.length) {
        const have = new Set();
        for (const group of chunk([...new Set(wanted.map(w => w.request_id))], 100)) {
            const { data, error } = await db
                .from('request_target')
                .select('request_id, target_id')
                .eq('target_type', 'resource')
                .in('request_id', group);
            if (error) throw error;
            (data || []).forEach(t => have.add(`${t.request_id}|${t.target_id}`));
        }
        const missing = wanted.filter(w => !have.has(`${w.request_id}|${w.target_id}`));
        for (const group of chunk(missing, 100)) {
            const { error } = await db.from('request_target').insert(group);
            if (error && error.code !== '23505') throw error;
        }
    }

    lastSignature[client.id] = signature;
    if (toInsert.length || toUpdate.length || toDelete.length) {
        console.log(`🔁 Requests synced for ${client.id}: +${toInsert.length} ~${toUpdate.length} -${toDelete.length}`);
    }
}

// Public entry point. Safe to call without awaiting.
export function mirrorClientRequests(db, client, opts = {}) {
    if (disabled || !db || !client || !client.id) return Promise.resolve();
    if (opts.staff === false) return Promise.resolve();   // partners and clients do not write these tables
    if (!Array.isArray(client.projectData?.scopingSheets)) return Promise.resolve();

    const previous = queue[client.id] || Promise.resolve();
    const run = previous
        .then(() => doMirror(db, client, opts))
        .catch(err => handleError('mirror', err));
    queue[client.id] = run;
    return run;
}
