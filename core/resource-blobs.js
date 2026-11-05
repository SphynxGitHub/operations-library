// Heavy fields inside each resource live in their own table (public.resource_blobs, migrations/2026_11f), one row per
// resource, so a project row downloads small and the heavy parts are read only when a project is opened.
// This file is only pure helpers (no database calls); the loading and saving is in core/data.js.

export const BLOB_FIELDS = ['editHistory', 'emailBody', 'formDetails', 'formLogic', 'formFields'];

// Same JSON text regardless of key order (jsonb hands keys back re-ordered).
export function canonicalJson(v) {
    const norm = (x) => {
        if (Array.isArray(x)) return x.map(norm);
        if (x && typeof x === 'object') { const o = {}; Object.keys(x).sort().forEach((k) => { o[k] = norm(x[k]); }); return o; }
        return x;
    };
    return JSON.stringify(norm(v));
}

// { field: value } for the heavy fields a resource currently has.
export function pickBlobs(res) {
    const out = {};
    BLOB_FIELDS.forEach((f) => { if (res && res[f] !== undefined) out[f] = res[f]; });
    return out;
}

// Splits project data into the slim copy that is saved on the project row and the heavy fields per resource.
// Never changes its input. Returns { slim, rows: [{ id, blobs }] }; rows includes every resource that has any heavy field.
export function splitBlobs(projectData) {
    const rows = [];
    const list = Array.isArray(projectData?.localResources) ? projectData.localResources : null;
    if (!list) return { slim: projectData, rows };
    const slimList = list.map((res) => {
        if (!res || typeof res !== 'object') return res;
        const blobs = pickBlobs(res);
        if (!Object.keys(blobs).length) return res;
        if (res.id != null) rows.push({ id: String(res.id), blobs });
        const copy = { ...res };
        BLOB_FIELDS.forEach((f) => { delete copy[f]; });
        return copy;
    });
    return { slim: { ...projectData, localResources: slimList }, rows };
}

// A project row that arrives without the heavy fields (someone else's save) must not wipe the ones this tab already loaded.
// Copies them from the tab's current resources onto the incoming ones (matched by id), only where the incoming copy has none.
export function keepLocalBlobs(currentData, incomingData) {
    const cur = Array.isArray(currentData?.localResources) ? currentData.localResources : null;
    const inc = Array.isArray(incomingData?.localResources) ? incomingData.localResources : null;
    if (!cur || !inc) return incomingData;
    const byId = new Map();
    cur.forEach((r) => { if (r && r.id != null) byId.set(String(r.id), r); });
    incomingData.localResources = inc.map((r) => {
        if (!r || r.id == null) return r;
        const old = byId.get(String(r.id));
        if (!old) return r;
        let copy = null;
        BLOB_FIELDS.forEach((f) => {
            if (r[f] === undefined && old[f] !== undefined) { if (!copy) copy = { ...r }; copy[f] = old[f]; }
        });
        return copy || r;
    });
    return incomingData;
}
