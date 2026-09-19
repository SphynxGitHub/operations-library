//======================= CORE / SECRETS =======================//
// Client API keys are no longer kept inside client projects. They live in secure storage (Supabase
// Vault) and only the backend can read them. This file is the app's side of that:
//   - storeSecret / removeSecret / hasSecret  send a key in, take it out, or ask "is one stored?"
//     (credentials-manage). The app can never read a key back.
//   - importFrom  asks the backend to use a stored key to pull workflow copies from an outside
//     service (integration-import), and returns what the service sent.
//   - secureEntry  moves a key that is still stored in plain text into secure storage.
// Every call carries the person's login; the backend refuses anyone who is not Sphynx staff.

const BASE = 'https://kexnnpwjerrnsmifauuo.supabase.co/functions/v1';

// Access entries that belong to the master registry (not a client project) use this id.
export const MASTER_ID = '_master';

function explain(result, status) {
    const OL = window.OL || {};
    if (result && (result.error === 'unauthorized' || result.error === 'forbidden') && typeof OL.sendAuthErrorMessage === 'function') {
        return OL.sendAuthErrorMessage(result);
    }
    if (result && result.message) return result.message;
    return `Request failed (HTTP ${status}).`;
}

async function post(fn, body) {
    const headers = { 'Content-Type': 'application/json', ...(await window.OL.getAuthHeaders()) };
    const response = await fetch(`${BASE}/${fn}`, { method: 'POST', headers, body: JSON.stringify(body) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
        const err = new Error(explain(result, response.status));
        err.code = result && result.error;
        throw err;
    }
    return result;
}

export async function storeSecret(clientId, entryId, secret) {
    return post('credentials-manage', { action: 'save', clientId, entryId, secret });
}
export async function removeSecret(clientId, entryId) {
    return post('credentials-manage', { action: 'clear', clientId, entryId });
}
export async function hasSecret(clientId, entryId) {
    const r = await post('credentials-manage', { action: 'has', clientId, entryId });
    return !!r.has;
}
export async function importFrom(service, clientId, entryId, extra = {}) {
    return post('integration-import', { service, clientId, entryId, ...extra });
}

// Moves one access entry's plain-text key into secure storage, clears it from the entry, and marks
// the entry as stored. Returns true if a key was moved. The caller saves the project afterwards.
export async function secureEntry(client, entry) {
    if (!entry || entry.secretSet || !String(entry.secret || '').trim()) return false;
    const clientId = (client && client.id) || MASTER_ID;
    const result = await storeSecret(clientId, entry.id, entry.secret);
    entry.secretSet = true;
    entry.secretHint = result.hint || '';
    entry.secretUpdatedAt = new Date().toISOString();
    entry.secret = '';
    return true;
}

window.OL = window.OL || {};
Object.assign(window.OL, { storeSecret, removeSecret, hasSecret, importFrom, secureEntry });
