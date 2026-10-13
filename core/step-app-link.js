import { state } from './data.js';

// Zapier imports give every step an app NAME (step.appName) but never an app LINK (step.appId), and the Zap card
// itself carries no app, so the flow map's "Primary application" and the app filters found nothing. This links each
// unlinked step to the project's (or master) app of the same name. Names are compared with case, spaces, punctuation
// and Zapier's "API / V2" suffixes ignored, so "Google Sheets" matches "GoogleSheetsV2CLIAPI".
const plain = (n) => String(n || '').toLowerCase().replace(/cliapi|api$/g, '').replace(/v\d+$/g, '').replace(/[^a-z0-9]/g, '');
// "Code by Zapier", "Zapier Code" and a bare "Code" step all name the same tool, as do "Webhooks by Zapier" / "Zapier Webhook".
const norm = (n) => {
    const t = String(n || '').toLowerCase();
    if (!t.includes('zapier')) return plain(t);
    const rest = plain(t.replace(/\bby\s+zapier\b/g, ' ').replace(/zapier/g, ' ')).replace(/s$/, '');
    return rest ? `zapier:${rest}` : plain(t);
};

function appIndex(client) {
    const list = [...(client?.projectData?.localApps || []), ...(state.master?.apps || [])].filter((a) => a && a.name);
    const map = new Map();
    list.forEach((a) => { const k = norm(a.name); if (k && !map.has(k)) map.set(k, a); });
    return { map, keys: [...map.keys()] };
}

function findApp(idx, name) {
    const k = norm(name);
    if (!k || k === 'system') return null;
    if (idx.map.has(k)) return idx.map.get(k);
    // Zapier's own tools arrive as a bare name ("Code", "Email", "Formatter", "Web Hook") but live in the library as
    // "Zapier Code", "Email by Zapier", "Webhooks by Zapier"...: try those spellings before anything looser.
    if (!k.startsWith('zapier:')) {
        const alt = `zapier:${k.replace(/s$/, '')}`;
        if (idx.map.has(alt)) return idx.map.get(alt);
    }
    if (k.length < 4) return null;
    const hit = idx.keys.filter((x) => x.length >= 4 && (x.startsWith(k) || k.startsWith(x)));
    return hit.length === 1 ? idx.map.get(hit[0]) : null;   // only when it is unambiguous
}

// Returns how many steps were linked.
export function autoLinkStepApps(client, resource) {
    if (!client || !resource || !Array.isArray(resource.steps)) return 0;
    const idx = appIndex(client);
    let n = 0;
    resource.steps.forEach((s) => {
        if (!s || s.appId || !s.appName) return;
        const app = findApp(idx, s.appName);
        if (app) { s.appId = app.id; s.appName = app.name; n++; }
    });
    return n;
}

export function autoLinkAllStepApps(clientId) {
    const client = state.clients?.[clientId];
    let n = 0;
    (client?.projectData?.localResources || []).forEach((r) => { n += autoLinkStepApps(client, r); });
    return n;
}

window.OL = window.OL || {};
Object.assign(window.OL, { autoLinkStepApps, autoLinkAllStepApps });
