// ============================================================
// GROUP VERSIONS
// Several Zaps that are versions of one flow (one per advisor, account...) get their matching steps put in consolidation
// groups all at once, so each set is drawn as one card on the map. Only step.stepGroup is set (the same field the step
// panel's "Add to a group" uses). Groups made here are marked (step._vgroup) so they can be removed again in one go.
// A step that was grouped by hand is never changed.
// ============================================================
import { esc } from '../core/data.js';

const OL = window.OL || (window.OL = {});
const clean = (n) => String(n || '').replace(/^\s*(?:⚡\s*)?/, '').trim();
const norm = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const nameOf = (s) => String(s.name || (s.zap && s.zap.summary) || 'Step').trim();
// what kind of step it is: app, action and role (names, accounts and settings differ between versions)
const kindOf = (s) => (s.zap ? `${String(s.zap.app || s.appName || '').replace(/@.*$/, '')}|${s.zap.action || ''}|${s.zap.role || ''}`.toLowerCase() : `name|${norm(nameOf(s))}`);
const usable = (card) => (card.steps || []).filter((s) => s && !s.isArchived && !s._hookHidden);

// Line two step lists up in order: same kind is required, the same name is preferred
function align(a, b) {
    const sc = (x, y) => (kindOf(x) !== kindOf(y) ? 0 : (norm(nameOf(x)) === norm(nameOf(y)) ? 3 : 2));
    const T = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
    for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) {
        const m = sc(a[i], b[j]);
        T[i][j] = Math.max(T[i + 1][j], T[i][j + 1], m ? m + T[i + 1][j + 1] : 0);
    }
    const pairs = []; let i = 0; let j = 0;
    while (i < a.length && j < b.length) {
        const m = sc(a[i], b[j]);
        if (m && T[i][j] === m + T[i + 1][j + 1]) { pairs.push([i, j]); i++; j++; } else if (T[i + 1][j] >= T[i][j + 1]) i++; else j++;
    }
    return pairs;
}

// One row per step of the longest version (the base), holding the matching step of each other version
export function planVersionGroups(cards) {
    const lists = cards.map((c) => ({ card: c, steps: usable(c) })).sort((x, y) => y.steps.length - x.steps.length);
    if (lists.length < 2) return { rows: [], unmatched: 0 };
    const base = lists[0];
    const rows = base.steps.map((s, i) => ({ pos: i + 1, title: nameOf(s), members: [{ card: base.card, step: s }] }));
    let unmatched = 0;
    lists.slice(1).forEach((l) => {
        const pairs = align(base.steps, l.steps);
        pairs.forEach(([i, j]) => rows[i].members.push({ card: l.card, step: l.steps[j] }));
        unmatched += l.steps.length - pairs.length;
    });
    unmatched += rows.filter((r) => r.members.length < 2).length;
    return { rows: rows.filter((r) => r.members.length > 1), unmatched };
}
const handGrouped = (s) => !!s.stepGroup && !s._vgroup;
export function applyVersionGroups(rows, label, allCards) {
    const taken = new Set(); allCards.forEach((c) => (c.steps || []).forEach((s) => { if (s.stepGroup) taken.add(s.stepGroup); }));
    let made = 0;
    rows.forEach((r) => {
        const mem = r.members.filter((m) => !handGrouped(m.step));
        if (mem.length < 2) return;
        const mine = new Set(mem.map((m) => m.step));
        const usedElsewhere = (n) => allCards.some((c) => (c.steps || []).some((s) => s.stepGroup === n && !mine.has(s)));
        const root = `${label} · ${r.pos}. ${r.title}`.slice(0, 76);
        let name = root; let k = 2;
        while (taken.has(name) && usedElsewhere(name)) name = `${root} (${k++})`;
        taken.add(name);
        mem.forEach((m) => { m.step.stepGroup = name; m.step._vgroup = true; });
        made++;
    });
    return made;
}
export function removeVersionGroups(cards) {
    let n = 0;
    cards.forEach((c) => (c.steps || []).forEach((s) => { if (s._vgroup) { delete s.stepGroup; delete s._vgroup; delete s.groupTitle; n++; } }));
    return n;
}
// Sets that look like versions: the same name apart from what follows the last " - ", or the same kinds of step in the same order
export function suggestVersionSets(cards) {
    const sets = new Map();
    const add = (k, c) => { (sets.get(k) || sets.set(k, []).get(k)).push(c); };
    cards.forEach((c) => {
        const code = clean(c.name).match(/^(\d{1,3}[A-Z])\b/i); if (code) add(`code:${code[1].toUpperCase()}`, c);
        const st = usable(c); if (st.length > 2) add(`shape:${st.map(kindOf).join('>')}`, c);
    });
    const seen = new Set(); const out = [];
    [...sets].filter(([, v]) => v.length > 1).forEach(([k, v]) => {
        const sig = v.map((c) => c.id).sort().join(','); if (seen.has(sig)) return; seen.add(sig);
        out.push({ label: k.startsWith('code:') ? k.slice(5) : clean(v[0].name).replace(/\s[-–(][^-–(]*$/, ''), cards: v });
    });
    return out.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
}

// ---------- the screen ----------
const data = () => OL.getCurrentProjectData();
const everyCard = () => (data().resources || data().localResources || []).filter((r) => r && !r.isDeleted);
const zapCards = () => everyCard().filter((r) => r.type === 'Zap' && !r.isArchived && (r.steps || []).length).sort((a, b) => clean(a.name).localeCompare(clean(b.name), undefined, { numeric: true }));
let picked = new Set(); let sets = []; let skip = new Set(); let label = '';
const chosen = () => zapCards().filter((c) => picked.has(String(c.id)));
const placesOf = (c) => (typeof OL.getPlacements === 'function' ? OL.getPlacements(c) : (c.placements || [])).map((p) => String(p.workflowId || '')).filter(Boolean);

function previewHtml() {
    const cards = chosen();
    if (cards.length < 2) return '<div class="tiny muted" style="padding:14px;">Pick two or more versions to see which steps match.</div>';
    const plan = planVersionGroups(cards);
    const common = cards.map(placesOf).reduce((a, b) => a.filter((x) => b.includes(x)));
    const warn = common.length ? '' : '<div style="padding:10px 14px;background:var(--bg-warning);color:var(--text-warning);font-size:12px;">These Zaps are not all in the same workflow. Steps only combine into one card when they are, so set Stage &amp; Workflow on them to match.</div>';
    const rows = plan.rows.map((r) => {
        const locked = r.members.filter((m) => handGrouped(m.step)).length;
        const ok = r.members.length - locked > 1;
        const names = r.members.map((m) => `${esc(clean(m.card.name))}: ${esc(nameOf(m.step))}${handGrouped(m.step) ? ' (already grouped by hand, left as is)' : ''}`).join('<br>');
        return `<label style="display:flex;gap:10px;padding:9px 14px;border-top:1px solid var(--line);align-items:flex-start;"><input type="checkbox" ${ok && !skip.has(r.pos) ? 'checked' : ''} ${ok ? '' : 'disabled'} onchange="OL.gvRow(${r.pos}, this.checked)"><span style="font-size:13px;line-height:1.5;"><b>${esc(r.title)}</b> &times;${r.members.length}<br><span class="muted" style="font-size:12px;">${names}</span></span></label>`;
    }).join('');
    return `${warn}<div class="tiny muted" style="padding:9px 14px;">${plan.rows.length} set${plan.rows.length === 1 ? '' : 's'} of matching steps. ${plan.unmatched} step${plan.unmatched === 1 ? ' has' : 's have'} no match and stay${plan.unmatched === 1 ? 's' : ''} separate. Untick any that should not combine.</div>${rows}`;
}
function listHtml() {
    return zapCards().map((c) => `<label data-gv-name="${esc(clean(c.name).toLowerCase())}" style="display:flex;gap:8px;padding:6px 10px;font-size:13px;line-height:1.4;"><input type="checkbox" ${picked.has(String(c.id)) ? 'checked' : ''} onchange="OL.gvPick('${esc(c.id)}', this.checked)"><span>${esc(clean(c.name))}</span></label>`).join('');
}
const paint = () => { const el = document.getElementById('gv-preview'); if (el) el.innerHTML = previewHtml(); };
const defaultLabel = () => { const c = chosen()[0]; if (!c) return ''; const m = clean(c.name).match(/^(\d{1,3}[A-Z])\b/i); return m ? m[1].toUpperCase() : clean(c.name).slice(0, 24); };
export function gvPick(id, on) { if (on) picked.add(String(id)); else picked.delete(String(id)); skip = new Set(); label = defaultLabel(); paint(); }
export function gvRow(pos, on) { if (on) skip.delete(pos); else skip.add(pos); }
export function gvSet(i) { picked = new Set(sets[i].cards.map((c) => String(c.id))); skip = new Set(); label = defaultLabel(); const l = document.getElementById('gv-list'); if (l) l.innerHTML = listHtml(); paint(); }
export function gvFilter(q) { const t = String(q || '').trim().toLowerCase(); document.querySelectorAll('[data-gv-name]').forEach((r) => { r.style.display = !t || r.getAttribute('data-gv-name').includes(t) ? 'flex' : 'none'; }); }
const redraw = () => { if (OL.closeModal) OL.closeModal(); if (typeof OL.renderVisualizer === 'function') OL.renderVisualizer(); };
export function gvApply() {
    const cards = chosen(); if (cards.length < 2) { alert('Pick two or more versions first.'); return; }
    const rows = planVersionGroups(cards).rows.filter((r) => !skip.has(r.pos));
    let made = 0;
    OL.updateAndSync(() => { made = applyVersionGroups(rows, label || defaultLabel(), everyCard()); });
    redraw(); alert(made ? `Grouped ${made} set${made === 1 ? '' : 's'} of steps.` : 'Nothing to group.');
}
export function gvUngroup() {
    const cards = chosen(); if (!cards.length) { alert('Pick the versions to ungroup first.'); return; }
    let n = 0;
    OL.updateAndSync(() => { n = removeVersionGroups(cards); });
    redraw(); alert(n ? `Removed ${n} step${n === 1 ? '' : 's'} from version groups.` : 'None of these steps were grouped with this button.');
}
export function openGroupVersions() {
    picked = new Set(); skip = new Set(); label = ''; sets = suggestVersionSets(zapCards());
    const chips = sets.map((s, i) => `<button type="button" class="btn tiny soft" onclick="OL.gvSet(${i})">${esc(s.label)} (${s.cards.length})</button>`).join('');
    window.openModal(`<div style="padding:20px 24px;width:min(1100px,92vw);max-width:100%;box-sizing:border-box;">
        <h3 style="margin:0 0 4px;font-size:16px;">Group versions</h3>
        <p class="muted" style="font-size:13px;margin:0 0 10px;">Pick the versions of one flow. Matching steps become one card each on the map.</p>
        ${chips ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;max-height:90px;overflow-y:auto;"><span class="tiny muted">Likely sets:</span>${chips}</div>` : ''}
        <div style="display:grid;grid-template-columns:320px minmax(0,1fr);gap:14px;">
          <div><input type="text" class="modal-input" placeholder="Filter Zaps" oninput="OL.gvFilter(this.value)" style="width:100%;box-sizing:border-box;margin-bottom:6px;"><div id="gv-list" style="max-height:52vh;overflow-y:auto;border:1px solid var(--line);border-radius:8px;">${listHtml()}</div></div>
          <div id="gv-preview" style="max-height:58vh;overflow-y:auto;border:1px solid var(--line);border-radius:8px;">${previewHtml()}</div>
        </div>
        <div style="display:flex;gap:10px;margin-top:14px;justify-content:flex-end;"><button class="btn soft" style="margin-right:auto;" onclick="OL.gvUngroup()">Ungroup these</button><button class="btn soft" onclick="OL.closeModal()">Cancel</button><button class="btn primary" onclick="OL.gvApply()">Group matching steps</button></div>
    </div>`);
}
Object.assign(OL, { openGroupVersions, gvPick, gvRow, gvSet, gvFilter, gvApply, gvUngroup });
