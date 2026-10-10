//======================= CORE / LAST-UPDATED STAMPS FOR RESOURCES AND STEPS =======================//
// Resources and the steps inside them get "updatedAt" / "updatedBy" automatically, without touching the dozens of
// places that edit them. Each resource and step keeps a short fingerprint of its own content ("sig"). Whenever the
// app saves (persist()), anything whose content no longer matches its fingerprint is stamped with the current time
// and person, and the fingerprint is refreshed.
//
// - Existing data is NOT stamped on first sight: a resource or step with no fingerprint yet just gets one, so
//   nothing claims to have been "updated today" simply because this feature shipped. Its date fills in on its next
//   real edit.
// - A resource's fingerprint covers its steps too, so editing a step also bumps the resource. A step's covers only
//   itself (updatedAt / updatedBy / sig are ignored in both).
// - The stamp fields are skipped when comparing, so stamping never triggers another stamp.
import { state, getCurrentUserName } from './data.js';

const SKIP = new Set(['updatedAt', 'updatedBy', 'sig']);

// Small, stable string hash (djb2). Collisions are harmless: worst case a real edit is not stamped.
function hashOf(value) {
    const s = JSON.stringify(value, (k, v) => (SKIP.has(k) ? undefined : v)) || '';
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36) + s.length.toString(36);
}

// Stamps one list of resources. Returns how many resources/steps were stamped.
export function stampResourceList(list, who = getCurrentUserName(), nowIso = new Date().toISOString()) {
    if (!Array.isArray(list)) return 0;
    let stamped = 0;
    list.forEach((res) => {
        if (!res || typeof res !== 'object') return;
        (Array.isArray(res.steps) ? res.steps : []).forEach((step) => {
            if (!step || typeof step !== 'object') return;
            const sig = hashOf(step);
            if (!step.sig) { step.sig = sig; return; }
            if (step.sig !== sig) { step.sig = sig; step.updatedAt = nowIso; step.updatedBy = who; stamped++; }
        });
        const sig = hashOf(res);
        if (!res.sig) { res.sig = sig; return; }
        if (res.sig !== sig) { res.sig = sig; res.updatedAt = nowIso; res.updatedBy = who; stamped++; }
    });
    return stamped;
}

// The active project plus any project queued as dirty, and the master resource list if there is one.
export function stampChangedResources() {
    try {
        const ids = new Set([state.activeClientId, ...(state.dirtyClientIds || [])].filter(Boolean));
        let n = 0;
        ids.forEach((id) => { n += stampResourceList(state.clients?.[id]?.projectData?.localResources); });
        if (Array.isArray(state.master?.resources)) n += stampResourceList(state.master.resources);
        return n;
    } catch (e) { return 0; }
}

// ---- display helpers ----
const DAY = 86400000;
export function updatedInfo(item, staleDays = 90) {
    const t = Date.parse(item?.updatedAt || '');
    if (Number.isNaN(t)) return null;
    const days = Math.floor((Date.now() - t) / DAY);
    const when = days <= 0 ? 'today' : days === 1 ? 'yesterday' : days < 30 ? `${days}d ago` : days < 365 ? `${Math.floor(days / 30)}mo ago` : `${Math.floor(days / 365)}y ago`;
    const full = new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
    return { when, days, stale: days >= staleDays, title: `Last updated ${full}${item.updatedBy ? ` by ${item.updatedBy}` : ''}`, by: item.updatedBy || '' };
}

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// A small "Updated 3d ago" pill; amber once it has gone 90+ days without a change. Resources and steps never edited since
// stamping began show a muted "No edit date yet" only when asked (showUnknown).
export function updatedPillHtml(item, { staleDays = 90, showUnknown = false, withName = false } = {}) {
    const info = updatedInfo(item, staleDays);
    if (!info) return showUnknown ? `<span class="pill tiny" style="font-size:8px;padding:1px 5px;opacity:.45;white-space:nowrap;" title="No edit date recorded yet. It fills in the next time this is changed.">No edit date yet</span>` : '';
    const c = info.stale ? '#f59e0b' : '#94a3b8';
    return `<span class="pill tiny" style="font-size:8px;font-weight:600;padding:1px 5px;white-space:nowrap;background:${c}22;color:${c};border:1px solid ${c}44;" title="${esc(info.title)}${info.stale ? ' (not touched in 90+ days)' : ''}">${info.stale ? '⚠ ' : ''}Updated ${esc(info.when)}${withName && info.by ? ` · ${esc(info.by.split(' ')[0])}` : ''}</span>`;
}

if (typeof OL !== 'undefined') {
    OL.updatedPillHtml = updatedPillHtml;
    OL.updatedInfo = updatedInfo;
    OL.stampChangedResources = stampChangedResources;
}
