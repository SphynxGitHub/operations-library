// ============================================================
// VERSIONS: same-name resources that are "versions" for different people.
//   - A group is explicit (res.versionGroup + res.versionLabel, set by "Link as versions" in the resource modal)
//     or computed (the Calendly-slug grouping from the Resources tab, via OL.resourceInfo).
//   - The flow map has a person switcher: with a person picked, only that person's version of each group
//     is drawn (a group with no version for that person is left alone). Nothing is deleted or moved.
// ============================================================
import { esc, uid, getActiveClient } from '../../core/data.js';

const OL = window.OL || (window.OL = {});
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const live = (r) => r && !r.isDeleted && !r.isArchived && !r.mergedInto;

OL.versionGroups = function (list) {
    const all = list || (OL.getCurrentProjectData().resources || []);
    const byKey = {};
    all.filter(live).forEach((r) => {
        let key = r.versionGroup ? `g:${r.versionGroup}` : '';
        let label = r.versionLabel || '';
        if (!key && typeof OL.resourceInfo === 'function') {
            const i = OL.resourceInfo(r);
            if (i && i.versionKey) { key = `c:${i.versionKey}`; label = i.versionLabel || ''; }
        }
        if (key) (byKey[key] = byKey[key] || []).push({ r, label });
    });
    const map = new Map();
    Object.entries(byKey).forEach(([key, arr]) => {
        if (arr.length < 2) return;
        const members = arr.map((a) => a.r);
        arr.forEach((a) => map.set(String(a.r.id), { key, label: a.label, members, labels: arr.map((x) => x.label), explicit: key.startsWith('g:') }));
    });
    return map;
};

const personKey = () => `ol-fv-person-${(getActiveClient() || {}).id || ''}`;
OL.fvPerson = () => { try { return localStorage.getItem(personKey()) || ''; } catch (e) { return ''; } };
OL.fvSetPerson = function (p) {
    try { localStorage.setItem(personKey(), p || ''); } catch (e) { /* the pick just won't be remembered */ }
    if (typeof OL.renderVisualizer === 'function') OL.renderVisualizer();
};
OL.fvPeople = (groups) => [...new Set([...groups.values()].flatMap((g) => g.labels).filter(Boolean))].sort((a, b) => a.localeCompare(b));

// the resources the map should draw
OL.fvVisibleResources = function (resources) {
    const person = norm(OL.fvPerson());
    OL._fvHiddenVersionCount = 0;
    if (!person) return resources;
    const groups = OL.versionGroups(resources);
    if (!groups.size) return resources;
    const hidden = new Set(); const done = new Set();
    groups.forEach((g) => {
        if (done.has(g.key)) return; done.add(g.key);
        const keep = g.members.find((m) => norm(groups.get(String(m.id)).label) === person);
        if (!keep) return;                                   // nobody's version for this person: show them all
        g.members.forEach((m) => { if (m !== keep) hidden.add(String(m.id)); });
    });
    OL._fvHiddenVersionCount = hidden.size;
    return hidden.size ? resources.filter((r) => !hidden.has(String(r.id))) : resources;
};

OL.fvPersonSwitcherHtml = function (resources) {
    const groups = OL.versionGroups(resources);
    const people = OL.fvPeople(groups);
    if (!people.length) return '';
    const cur = OL.fvPerson();
    const hid = OL._fvHiddenVersionCount || 0;
    return `<div style="display:inline-flex;align-items:center;gap:6px;" title="Same-name resources are versions for different people. Pick a person to show only their version.">
        <i data-lucide="users" style="width:13px;height:13px;color:var(--text-muted);"></i>
        <select class="modal-input tiny" style="height:28px;padding:0 8px;min-width:130px;" onchange="OL.fvSetPerson(this.value)" aria-label="Show versions for">
            <option value="">All people</option>
            ${people.map((p) => `<option value="${esc(p)}" ${norm(p) === norm(cur) ? 'selected' : ''}>${esc(p)}</option>`).join('')}
        </select>
        ${cur && hid ? `<span class="tiny muted" style="white-space:nowrap;">${hid} other version${hid === 1 ? '' : 's'} hidden</span>` : ''}
    </div>`;
};

// a small "Kyle · 1 of 3" tag on each version card on the map
OL.fvWrapCardBuilder = function () {
    if (OL._fvBuildCardRaw || typeof OL._fvBuildCard !== 'function') return;
    OL._fvBuildCardRaw = OL._fvBuildCard;
    OL._fvBuildCard = function (res, ...rest) {
        const html = OL._fvBuildCardRaw(res, ...rest);
        try {
            if (!res || OL._fvGroupsCache == null) { OL._fvGroupsCache = OL.versionGroups(); setTimeout(() => { OL._fvGroupsCache = null; }, 0); }
            const g = OL._fvGroupsCache.get(String(res.id));
            if (!g) return html;
            const tag = `<span class="fv-card-source" title="One of ${g.members.length} versions of this resource">${esc(g.label || 'Version')} · ${g.members.indexOf(res) + 1} of ${g.members.length}</span>`;
            return html.replace('<span class="fv-card-step-num">', `${tag}<span class="fv-card-step-num">`);
        } catch (e) { console.error('Version tag failed', e); return html; }
    };
};

// ---------- linking ----------
OL.versionLink = async function (resId, otherId) {
    if (!resId || !otherId || String(resId) === String(otherId)) throw new Error('Pick two different resources to link.');
    await OL.updateAndSync(() => {
        const res = (OL.getCurrentProjectData().resources || []);
        const a = res.find((r) => String(r.id) === String(resId)); const b = res.find((r) => String(r.id) === String(otherId));
        if (!a || !b) throw new Error('Link as versions: a resource was not found.');
        const gid = a.versionGroup || b.versionGroup || uid();
        a.versionGroup = gid; b.versionGroup = gid;
    });
    OL.openResourceModal(resId);
};
OL.versionSetLabel = async function (resId, label) {
    await OL.updateAndSync(() => {
        const r = (OL.getCurrentProjectData().resources || []).find((x) => String(x.id) === String(resId));
        if (!r) throw new Error('Version label: resource not found.');
        r.versionLabel = String(label || '').trim();
    });
};
OL.versionUnlink = async function (resId) {
    await OL.updateAndSync(() => {
        const res = OL.getCurrentProjectData().resources || [];
        const r = res.find((x) => String(x.id) === String(resId));
        if (!r) throw new Error('Unlink: resource not found.');
        const gid = r.versionGroup; delete r.versionGroup; delete r.versionLabel;
        if (gid) { const left = res.filter((x) => x.versionGroup === gid); if (left.length === 1) { delete left[0].versionGroup; delete left[0].versionLabel; } }
    });
    OL.openResourceModal(resId);
};

// the "Versions" card in the resource modal
OL.versionsSectionHtml = function (res) {
    const groups = OL.versionGroups();
    const g = groups.get(String(res.id));
    const all = (OL.getCurrentProjectData().resources || []).filter(live);
    const taken = new Set([...groups.keys()]);
    const cands = all.filter((r) => String(r.id) !== String(res.id) && r.type === res.type && !(taken.has(String(r.id)) && !(g && g.members.includes(r))) && norm(r.name) === norm(res.name));
    if (!g && !cands.length) return '';
    return `<div class="card-section">
        <label class="modal-section-label"><i data-lucide="users"></i> Versions</label>
        ${g ? `<div class="tiny muted" style="margin-bottom:8px;">${g.members.length} versions of this resource, one per person. The flow map's person switcher uses these names.</div>
        <div style="display:flex;flex-direction:column;gap:6px;">
        ${g.members.map((m) => {
            const lab = groups.get(String(m.id)).label;
            const here = String(m.id) === String(res.id);
            return `<div style="display:flex;align-items:center;gap:8px;">
                <input class="modal-input tiny" style="width:160px;" placeholder="Person" value="${esc(lab)}" ${g.explicit ? '' : 'disabled title="Named automatically from the Calendly link"'}
                       onblur="OL.versionSetLabel('${esc(m.id)}', this.value).catch(e => alert(e.message))">
                <span class="tiny" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${here ? 'This resource' : `<a href="#" onclick="OL.openResourceModal('${esc(m.id)}');return false;">${esc(m.name)}</a>`}</span>
                ${g.explicit ? `<button class="btn tiny soft" onclick="OL.versionUnlink('${esc(m.id)}').catch(e => alert(e.message))">Unlink</button>` : ''}
            </div>`; }).join('')}
        </div>` : `<div class="tiny muted" style="margin-bottom:8px;">${cands.length} other resource${cands.length === 1 ? '' : 's'} with this same name. If they are versions for different people, link them.</div>`}
        ${cands.length ? `<div style="display:flex;gap:8px;margin-top:10px;">
            <select id="ver-link-${esc(res.id)}" class="modal-input tiny" style="flex:1;"><option value="">Link another same-name resource…</option>
                ${cands.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}${c.externalUrl ? ' · ' + esc(String(c.externalUrl).replace(/^https?:\/\/(www\.)?/, '').slice(0, 40)) : ''}</option>`).join('')}
            </select>
            <button class="btn tiny soft" onclick="const v=document.getElementById('ver-link-${esc(res.id)}').value; if(v) OL.versionLink('${esc(res.id)}', v).catch(e => alert(e.message));">Link as versions</button>
        </div>` : ''}
    </div>`;
};
