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

// One pass per map render: id -> person label, for every resource that is a version of another.
// (Built once so drawing the map stays fast; the cards just look their label up.)
OL.fvBuildVersionLabels = function (resources) {
    // The version groups only change when a name, link, archive flag or explicit link changes, so they are rebuilt only then.
    // (Rebuilding them costs a pass over the whole library, and the map is redrawn after every edit.)
    const sig = (resources || []).map((r) => `${r.id}|${r.name}|${r.isArchived ? 1 : 0}|${r.versionGroup || ''}|${r.versionLabel || ''}|${r.externalUrl || ''}`).join('\n');
    if (OL._fvGroupsSig !== sig || !OL._fvGroups) {
        const labels = new Map();
        const groups = {};
        (resources || []).forEach((r) => {
            if (!live(r)) return;
            let label = r.versionGroup ? (r.versionLabel || '') : '';
            let key = r.versionGroup ? `g:${r.versionGroup}` : '';
            if (!r.versionGroup && typeof OL.resourceInfo === 'function') { const i = OL.resourceInfo(r); if (i && i.versionKey) { label = i.versionLabel || ''; key = `c:${i.versionKey}`; } else return; }
            else if (!r.versionGroup) return;
            labels.set(String(r.id), label || 'Version');
            (groups[key] = groups[key] || []).push({ id: String(r.id), label: label || 'Version' });
        });
        OL._fvVersionLabels = labels;
        OL._fvGroups = Object.values(groups).filter((arr) => arr.length > 1);
        OL._fvGroupsSig = sig;
    }
    // A group with only one version on the map is drawn as one card for all of them: "N versions" instead of a person's name.
    const placed = new Set();
    ((OL.getCurrentProjectData() || {}).workflows || []).forEach((w) => (w.resourceIds || []).forEach((id) => placed.add(String(id))));
    const stacks = new Map();
    OL._fvGroups.forEach((arr) => {
        const onMap = arr.filter((a) => placed.has(a.id));
        if (onMap.length === 1) stacks.set(onMap[0].id, { count: arr.length, names: arr.map((a) => a.label) });
    });
    OL._fvVersionStacks = stacks;
    return OL._fvVersionLabels;
};

// the person tag on each version card on the map, same idea as the Resources tab
OL.fvWrapCardBuilder = function () {
    if (OL._fvBuildCardRaw || typeof OL._fvBuildCard !== 'function') return;
    OL._fvBuildCardRaw = OL._fvBuildCard;
    OL._fvBuildCard = function (res, ...rest) {
        const html = OL._fvBuildCardRaw(res, ...rest);
        const label = OL._fvVersionLabels && res ? OL._fvVersionLabels.get(String(res.id)) : '';
        if (!label) return html;
        const stack = OL._fvVersionStacks && OL._fvVersionStacks.get(String(res.id));
        const tag = stack
            ? `<span class="fv-card-source fv-card-person" title="${esc(stack.count)} versions, one per person: ${esc(stack.names.join(', '))}"><i data-lucide="users" style="width:9px;height:9px;"></i> ${esc(stack.count)} versions</span>`
            : `<span class="fv-card-source fv-card-person" title="This is ${esc(label)}'s version of this resource"><i data-lucide="user" style="width:9px;height:9px;"></i> ${esc(label)}</span>`;
        return html.replace('<span class="fv-card-step-num">', `${tag}<span class="fv-card-step-num">`);
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
