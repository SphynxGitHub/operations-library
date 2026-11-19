//======================= CORE / THREE-WAY MERGE =======================//
// Used when a save finds that someone else saved the same project since this tab last read it. Instead of writing this tab's
// whole copy over theirs (which erased their comments and re-opened tasks they had finished), the two copies are combined,
// using the copy this tab last read from the database as the common starting point ("base").
//
//   base   = the project as this tab last read it from the database
//   mine   = this tab's copy, with the edits being saved now
//   theirs = the project as it is in the database now (the other person's save)
//
// Rules, applied at every level, down to each field:
//   - changed only by me            -> mine
//   - changed only by them          -> theirs  (so a task they completed stays completed)
//   - the same on both sides        -> that value
//   - lists of items that have an id (tasks, comments, resources, ...) are merged item by item: an item added on either side is
//     kept, an item deleted on one side is deleted unless the other side changed it (an edit beats a delete)
//   - lists of plain values (ids, names) are merged as sets: anything either side added is kept, anything either side removed goes
//   - the same field changed on both sides to different values -> mine (this save is the later one)
//   - a list of objects without ids can't be matched up -> mine (reported through onUnmergeable)

function isObj(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }

export function deepEqual(a, b) {
    if (a === b) return true;
    if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
        return true;
    }
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (const k of ka) {
        if (!Object.prototype.hasOwnProperty.call(b, k) || !deepEqual(a[k], b[k])) return false;
    }
    return true;
}

function idKeyed(arr) {
    if (!Array.isArray(arr)) return false;
    const seen = new Set();
    for (const it of arr) {
        if (!isObj(it) || it.id === undefined || it.id === null) return false;
        const k = String(it.id);
        if (seen.has(k)) return false;
        seen.add(k);
    }
    return true;
}

const isPrimitive = (x) => x === null || (typeof x !== 'object' && typeof x !== 'undefined');

export function merge3(base, mine, theirs, onUnmergeable) {
    if (deepEqual(mine, theirs)) return mine;
    if (deepEqual(base, mine)) return theirs;
    if (deepEqual(base, theirs)) return mine;
    // Both sides changed it, differently. A delete against an edit: the edit wins.
    if (mine === undefined) return theirs;
    if (theirs === undefined) return mine;

    if (isObj(mine) && isObj(theirs)) {
        const b = isObj(base) ? base : {};
        const out = {};
        const keys = new Set([...Object.keys(mine), ...Object.keys(theirs)]);
        keys.forEach((k) => {
            const v = merge3(b[k], mine[k], theirs[k], onUnmergeable);
            if (v !== undefined) out[k] = v;
        });
        return out;
    }

    if (Array.isArray(mine) && Array.isArray(theirs)) {
        const b = Array.isArray(base) ? base : [];
        if (idKeyed(mine) && idKeyed(theirs) && idKeyed(b)) {
            const bMap = new Map(b.map((x) => [String(x.id), x]));
            const mMap = new Map(mine.map((x) => [String(x.id), x]));
            const tMap = new Map(theirs.map((x) => [String(x.id), x]));
            const order = [...mine.map((x) => String(x.id)), ...theirs.map((x) => String(x.id)).filter((id) => !mMap.has(id))];
            const out = [];
            order.forEach((id) => {
                const item = merge3(bMap.get(id), mMap.get(id), tMap.get(id), onUnmergeable);
                if (item !== undefined) out.push(item);
            });
            return out;
        }
        if (mine.every(isPrimitive) && theirs.every(isPrimitive) && b.every(isPrimitive)) {
            const key = (x) => JSON.stringify(x);
            const inB = new Set(b.map(key)), inM = new Set(mine.map(key)), inT = new Set(theirs.map(key));
            const removed = new Set([...inB].filter((k) => !inM.has(k) || !inT.has(k)));
            const out = [];
            const seen = new Set();
            [...mine, ...theirs].forEach((x) => {
                const k = key(x);
                if (seen.has(k) || removed.has(k)) return;
                seen.add(k); out.push(x);
            });
            return out;
        }
        if (typeof onUnmergeable === 'function') onUnmergeable();
        return mine;
    }

    return mine;   // plain values changed to different things on both sides
}
