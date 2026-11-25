// "Used by" card for the resource modal: where a shared automation lives and what calls it.
//   - the workflows it is placed in (workflow.resourceIds)
//   - the other resources whose steps link to it, send a line to one of its steps, or jump to it ("See another process")
// Read-only; clicking a name opens that resource.
import { esc } from '../core/data.js';

const OL = window.OL || (window.OL = {});

OL.resourceUsedBy = function (res) {
    const d = OL.getCurrentProjectData();
    const all = (d.resources || []).filter((r) => r && !r.isDeleted && !r.isArchived && !r.mergedInto);
    const id = String(res.id);
    const stepIds = new Set((res.steps || []).map((s) => String(s.id)));
    const workflows = (d.workflows || []).filter((w) => (w.resourceIds || []).map(String).includes(id)).map((w) => w.name);
    const callers = new Map();
    const add = (r, how) => { const e = callers.get(String(r.id)) || { res: r, how: new Set() }; e.how.add(how); callers.set(String(r.id), e); };
    all.forEach((r) => {
        if (String(r.id) === id) return;
        (r.steps || []).forEach((s) => {
            if ((s.links || []).some((l) => String(l.id) === id)) add(r, 'links to it');
            if (((s.logic && s.logic.out) || []).some((o) => { const t = String(o.targetId || ''); return t === id || [...stepIds].some((sid) => t === `${id}-${sid}`); })) add(r, 'sends a line to it');
            const jumps = Array.isArray(s.jumps) ? s.jumps : (s.refResId ? [{ resId: s.refResId }] : []);
            if (jumps.some((j) => j && String(j.resId) === id)) add(r, 'jumps to it');
        });
    });
    return { workflows, callers: [...callers.values()] };
};

OL.usedBySectionHtml = function (res) {
    const u = OL.resourceUsedBy(res);
    if (!u.workflows.length && !u.callers.length) return '';
    const wfWord = (n) => `${n} workflow${n === 1 ? '' : 's'}`;
    const shown = u.callers.slice(0, 12);
    return `<div class="card-section">
        <label class="modal-section-label"><i data-lucide="share-2"></i> Used by</label>
        <div class="tiny muted" style="margin-bottom:8px;">Placed in ${wfWord(u.workflows.length)}${u.workflows.length ? `: ${esc(u.workflows.slice(0, 6).join(', '))}${u.workflows.length > 6 ? ` and ${u.workflows.length - 6} more` : ''}` : ''}. Called by ${u.callers.length} other resource${u.callers.length === 1 ? '' : 's'}.</div>
        ${shown.length ? `<div style="display:flex;flex-direction:column;gap:4px;">${shown.map((c) => `<div style="display:flex;gap:8px;align-items:baseline;">
            <a href="#" onclick="OL.openResourceModal('${esc(c.res.id)}');return false;" style="font-size:13px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(c.res.name)}</a>
            <span class="tiny muted" style="white-space:nowrap;">${esc([...c.how].join(', '))}</span></div>`).join('')}
        ${u.callers.length > shown.length ? `<div class="tiny muted">and ${u.callers.length - shown.length} more</div>` : ''}</div>` : ''}
    </div>`;
};
