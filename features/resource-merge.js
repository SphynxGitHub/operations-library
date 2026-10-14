// ================================================================================================
// FILE: features/resource-merge.js
//
// WHAT IT DOES:   Replace one library resource with another wherever it is used as collateral, or merge it into the
//                 other one for good. Typical case: two copies of the same email template or form exist, one gets
//                 retired, and everything that pointed at the old one should now point at the kept one.
//
// TWO WAYS IN     1. "Replace" on a row of a resource's Collateral > Uses list: swaps that one piece of collateral on
//                    THIS resource only (its steps, its card callouts, its dependencies).
//                 2. "Merge into another resource" on a resource's Collateral section: swaps it everywhere in the
//                    project, and can archive the old one afterwards.
//
// WHAT IS REPOINTED (all inside the current project data, nothing in the database schema changes):
//   step.callouts[].libId        collateral chips on a step           (name and kind follow the new resource)
//   step.links[].id              collateral attached the older way
//   res.callouts[].libId         callouts on the card itself
//   res.emailAttachments[].libId attachments on an email template
//   res.dependencies[].id        "Uses" resources (type 'resource')
//   res.blockedBy[].id           "Blocked by" resources (kind 'resource')
//   trig.libId                   path triggers (logic.out / jumps) that name a piece of collateral
// If a place already points at the new resource, the old reference is removed instead of creating a duplicate, and a
// reference that would end up pointing at its own resource is dropped.
// ================================================================================================

import { esc, getActiveClient } from '../core/data.js';
import { calloutKindForType } from './flow-visualizer/callouts.js';
import { groupResources, groupsHtml, resourceSearchText, filterGroupsDom } from '../core/resource-groups.js';

const OL = () => window.OL;
const project = () => (OL().getCurrentProjectData ? OL().getCurrentProjectData() : { resources: [] }) || { resources: [] };
const cards = () => (project().resources || project().localResources || []).filter((r) => r && !r.isDeleted);
const same = (a, b) => a !== undefined && a !== null && b !== undefined && b !== null && String(a) === String(b);
const icon = (name, size = 14) => `<i data-lucide="${name}" style="width:${size}px;height:${size}px;display:inline-block;vertical-align:middle;"></i>`;
const stepLabel = (res, st) => `${res.name || 'Untitled'} — ${st.name || 'Unnamed step'}`;

// ---- walking every place a resource can be referenced as collateral ------------------------------------------------
// visit(place) gets { res, step|null, where, ... } and may return nothing; the walk is shared by the count and the swap.
function walk(oldId, scopeResId, handlers) {
    cards().forEach((res) => {
        if (scopeResId && !same(res.id, scopeResId)) return;
        (res.steps || []).forEach((st) => {
            if (!st) return;
            handlers.stepCallouts && handlers.stepCallouts(res, st, oldId);
            handlers.stepLinks && handlers.stepLinks(res, st, oldId);
            handlers.stepTriggers && handlers.stepTriggers(res, st, oldId);
        });
        handlers.cardCallouts && handlers.cardCallouts(res, oldId);
        handlers.attachments && handlers.attachments(res, oldId);
        handlers.dependencies && handlers.dependencies(res, oldId);
    });
}

const trigsOf = (st) => [
    ...(((st.logic && st.logic.out) || []).map((l) => l && l.trig)),
    ...((Array.isArray(st.jumps) ? st.jumps : []).map((j) => j && j.trig))
].filter((t) => t && typeof t === 'object');

// What would change: [{ res, step, label, where }] for the preview list and the count.
export function collateralUses(oldId, scopeResId = null) {
    const out = [];
    walk(oldId, scopeResId, {
        stepCallouts: (res, st) => (st.callouts || []).forEach((c) => { if (c && same(c.libId, oldId)) out.push({ res, step: st, label: stepLabel(res, st), where: 'Step collateral' }); }),
        stepLinks: (res, st) => (st.links || []).forEach((l) => { if (l && same(l.id, oldId)) out.push({ res, step: st, label: stepLabel(res, st), where: 'Step link' }); }),
        stepTriggers: (res, st) => trigsOf(st).forEach((t) => { if (same(t.libId, oldId)) out.push({ res, step: st, label: stepLabel(res, st), where: 'Path trigger' }); }),
        cardCallouts: (res) => (res.callouts || []).forEach((c) => { if (c && same(c.libId, oldId)) out.push({ res, step: null, label: res.name || 'Untitled', where: 'Card collateral' }); }),
        attachments: (res) => (res.emailAttachments || []).forEach((a) => { if (a && same(a.libId, oldId)) out.push({ res, step: null, label: res.name || 'Untitled', where: 'Email attachment' }); }),
        dependencies: (res) => {
            (res.dependencies || []).forEach((d) => { if (d && (d.type === 'resource' || !d.type) && same(d.id, oldId)) out.push({ res, step: null, label: res.name || 'Untitled', where: 'Uses' }); });
            (res.blockedBy || []).forEach((d) => { if (d && d.kind === 'resource' && same(d.id, oldId)) out.push({ res, step: null, label: res.name || 'Untitled', where: 'Blocked by' }); });
        }
    });
    return out;
}

// ---- the swap ------------------------------------------------------------------------------------------------------
// Mutates project data only; the caller persists. Returns { changed, merged, dropped, skipped }.
//   changed = repointed, merged = old one removed because the place already had the new one, dropped = would have pointed at itself
export function applyReplace(oldId, newId, { scopeResId = null } = {}) {
    const target = cards().find((r) => same(r.id, newId));
    const stats = { changed: 0, merged: 0, dropped: 0, skipped: 0 };
    if (!target || same(oldId, newId)) return stats;
    const newKind = calloutKindForType(target.type);

    // one list of {libId/id} holders -> repoint, or remove when redundant. `idOf`/`setNew` adapt the three list shapes.
    const fixList = (res, list, matches, idOf, setNew, extraKeep = () => false) => {
        if (!Array.isArray(list)) return list;
        const next = [];
        list.forEach((item) => {
            if (!item || !matches(item)) { next.push(item); return; }
            if (same(res.id, newId)) { stats.dropped++; return; }                       // a resource cannot use itself
            const dupe = list.some((o) => o !== item && matches(o) === false && same(idOf(o), newId)) || next.some((o) => o && same(idOf(o), newId));
            if (dupe) { stats.merged++; return; }
            setNew(item); stats.changed++; next.push(item);
        });
        return next;
    };

    walk(oldId, scopeResId, {
        stepCallouts: (res, st) => {
            if (!Array.isArray(st.callouts) || !st.callouts.some((c) => c && same(c.libId, oldId))) return;
            const alreadyHas = (st.callouts.find((c) => c && same(c.libId, newId)) || (st.links || []).find((l) => l && same(l.id, newId)));
            const survivor = st.callouts.find((c) => c && same(c.libId, newId));
            const removedIds = {};
            const next = [];
            st.callouts.forEach((c) => {
                if (!c || !same(c.libId, oldId)) { next.push(c); return; }
                if (same(res.id, newId)) { stats.dropped++; removedIds[c.id] = survivor ? survivor.id : ''; return; }
                if (alreadyHas || next.some((o) => o && same(o.libId, newId))) { stats.merged++; removedIds[c.id] = (survivor || next.find((o) => o && same(o.libId, newId)) || {}).id || ''; return; }
                c.libId = String(newId); c.name = target.name || c.name;
                if (newKind) c.kind = newKind;
                stats.changed++; next.push(c);
            });
            st.callouts = next;
            // a path trigger that named a removed chip follows the chip that stayed
            if (Object.keys(removedIds).length) trigsOf(st).forEach((t) => { if (t.assetId && Object.prototype.hasOwnProperty.call(removedIds, t.assetId)) { t.assetId = removedIds[t.assetId]; if (!t.assetId) t.libId = ''; } });
        },
        stepLinks: (res, st) => {
            if (!Array.isArray(st.links)) return;
            const hasCallout = (st.callouts || []).some((c) => c && same(c.libId, newId));
            const next = [];
            st.links.forEach((l) => {
                if (!l || !same(l.id, oldId)) { next.push(l); return; }
                if (same(res.id, newId)) { stats.dropped++; return; }
                if (hasCallout || next.some((o) => o && same(o.id, newId)) || st.links.some((o) => o && o !== l && same(o.id, newId))) { stats.merged++; return; }
                l.id = String(newId); l.name = target.name || l.name; l.type = target.type || l.type;
                stats.changed++; next.push(l);
            });
            st.links = next;
        },
        stepTriggers: (res, st) => trigsOf(st).forEach((t) => { if (same(t.libId, oldId)) { t.libId = String(newId); stats.changed++; } }),
        cardCallouts: (res) => { res.callouts = fixList(res, res.callouts, (c) => same(c.libId, oldId), (c) => c.libId, (c) => { c.libId = String(newId); c.name = target.name || c.name; if (newKind) c.kind = newKind; }); },
        attachments: (res) => { res.emailAttachments = fixList(res, res.emailAttachments, (a) => same(a.libId, oldId), (a) => a.libId, (a) => { a.libId = String(newId); a.name = target.name || a.name; }); },
        dependencies: (res) => {
            if (Array.isArray(res.dependencies)) {
                // a dependency that would loop back (the new resource already depends on this one) is left alone and reported
                const loops = (target.dependencies || []).some((d) => d && same(d.id, res.id));
                if (loops && res.dependencies.some((d) => d && same(d.id, oldId))) { stats.skipped++; }
                else res.dependencies = fixList(res, res.dependencies, (d) => (d.type === 'resource' || !d.type) && same(d.id, oldId), (d) => d.id, (d) => { d.id = String(newId); });
            }
            if (Array.isArray(res.blockedBy)) res.blockedBy = fixList(res, res.blockedBy, (d) => d.kind === 'resource' && same(d.id, oldId), (d) => d.id, (d) => { d.id = String(newId); });
        }
    });
    return stats;
}

// ---- the dialog ----------------------------------------------------------------------------------------------------
let dlg = null;

const summaryLine = (s) => {
    const parts = [];
    if (s.changed) parts.push(`${s.changed} repointed`);
    if (s.merged) parts.push(`${s.merged} already had the new one, so the old link was removed`);
    if (s.dropped) parts.push(`${s.dropped} dropped because they would have pointed at their own resource`);
    if (s.skipped) parts.push(`${s.skipped} left alone to avoid a circular dependency`);
    return parts.length ? parts.join('; ') + '.' : 'Nothing needed changing.';
};

function candidates() {
    return cards().filter((r) => !same(r.id, dlg.oldId) && !r.isArchived && !String(r.id).startsWith('reqline-'));
}

function paintList() {
    const box = document.getElementById('rm-list');
    if (!box) return;
    const groups = groupResources(candidates(), '');
    box.innerHTML = groupsHtml(groups, (r) => `
        <div class="rm-pick" onclick="OL.rmChoose('${esc(r.id)}')"
             style="display:flex;align-items:center;gap:10px;padding:8px 12px;border:1px solid ${same(dlg.newId, r.id) ? 'var(--accent)' : 'var(--line)'};border-radius:8px;cursor:pointer;background:${same(dlg.newId, r.id) ? 'var(--panel-soft)' : 'transparent'};">
            ${OL().getLucideSVG(OL().getRegistryIcon(r.type), 14, 'var(--accent)')}
            <span style="flex:1;min-width:0;font-size:13px;">${esc(r.name || 'Untitled')}</span>
            ${same(dlg.newId, r.id) ? icon('check', 14) : ''}
        </div>`, { query: dlg.q || '', open: true, searchTextFor: (r) => resourceSearchText(r) });
    filterGroupsDom(box, dlg.q || '');
    if (window.lucide) window.lucide.createIcons();
}

function paintDialog() {
    const old = cards().find((r) => same(r.id, dlg.oldId));
    const uses = collateralUses(dlg.oldId, dlg.scopeResId);
    const target = dlg.newId ? cards().find((r) => same(r.id, dlg.newId)) : null;
    const global = !dlg.scopeResId;
    const scopeRes = dlg.scopeResId ? cards().find((r) => same(r.id, dlg.scopeResId)) : null;
    const title = global ? 'Merge into another resource' : 'Replace collateral';
    const sub = global
        ? `Every place in this project that uses <b>${esc(old ? old.name : 'this resource')}</b> will use the one you pick instead.`
        : `On <b>${esc(scopeRes ? scopeRes.name : 'this resource')}</b>, <b>${esc(old ? old.name : 'this collateral')}</b> will be swapped for the one you pick. Other resources are not touched.`;

    let body;
    if (dlg.result) {
        body = `<div style="padding:20px 4px;">
            <div style="display:flex;align-items:center;gap:8px;font-size:14px;font-weight:600;">${icon('check-circle', 18)} Done</div>
            <div class="tiny muted" style="margin-top:8px;font-size:13px;">${esc(summaryLine(dlg.result))}${dlg.archived ? ' The old resource was archived.' : ''}</div>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px;"><button class="btn primary" onclick="OL.rmFinish()">Close</button></div>`;
    } else {
        const rows = uses.slice(0, 60).map((u) => `
            <div style="display:flex;gap:10px;padding:6px 0;border-bottom:1px solid var(--line);font-size:12px;">
                <span style="flex:1;min-width:0;">${esc(u.label)}</span>
                <span class="pill tiny soft" style="flex:0 0 auto;">${esc(u.where)}</span>
            </div>`).join('');
        body = `
        <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:20px;margin-top:14px;">
            <div>
                <div class="modal-section-label" style="margin-bottom:8px;">${global ? 'USED IN' : 'WILL CHANGE'} <span class="pill tiny soft">${uses.length}</span></div>
                <div style="max-height:46vh;overflow:auto;">${rows || '<div class="tiny muted" style="padding:6px 0;">No places found.</div>'}${uses.length > 60 ? `<div class="tiny muted" style="padding:6px 0;">and ${uses.length - 60} more</div>` : ''}</div>
            </div>
            <div>
                <div class="modal-section-label" style="margin-bottom:8px;">REPLACE WITH</div>
                <div style="position:relative;display:flex;align-items:center;margin-bottom:8px;">
                    <span style="position:absolute;left:10px;opacity:0.5;">${icon('search', 12)}</span>
                    <input id="rm-search" type="text" class="modal-input tiny" style="padding-left:30px;width:100%;" placeholder="Search the library..." value="${esc(dlg.q || '')}" oninput="OL.rmSearch(this.value)">
                </div>
                <div id="rm-list" style="max-height:40vh;overflow:auto;"></div>
            </div>
        </div>
        ${global ? `<label style="display:flex;align-items:center;gap:8px;margin-top:14px;font-size:13px;cursor:pointer;">
            <input type="checkbox" ${dlg.archive ? 'checked' : ''} onchange="OL.rmArchive(this.checked)"> Archive <b>${esc(old ? old.name : 'the old resource')}</b> afterwards (it can be restored)
        </label>` : ''}
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px;">
            <button class="btn soft" onclick="OL.rmFinish(true)">Cancel</button>
            <button class="btn primary" ${target && uses.length ? '' : 'disabled'} onclick="OL.rmApply()">${target ? `${global ? 'Merge' : 'Replace'} with ${esc(target.name || 'Untitled')}` : (global ? 'Merge' : 'Replace')}</button>
        </div>`;
    }

    const html = `<div style="width:100%;">
        <div style="display:flex;align-items:center;gap:8px;"><div class="modal-title-text" style="font-weight:700;font-size:16px;flex:1;">${icon(global ? 'merge' : 'replace', 16)} ${title}</div>
            <button class="btn tiny soft" onclick="OL.rmFinish(true)" aria-label="Close">${icon('x', 12)}</button></div>
        <div class="tiny muted" style="margin-top:6px;font-size:12px;">${sub}</div>
        ${body}
    </div>`;
    OL().showOverlayModal(html, { wide: true });
    // keep clicks inside the dialog from closing it (the overlay closes on click)
    const box = document.querySelector('#modal-layer .modal-box');
    if (box) box.onclick = (e) => e.stopPropagation();
    if (!dlg.result) paintList();
    if (window.lucide) window.lucide.createIcons();
}

export function openReplaceCollateral(oldId, scopeResId = null) {
    if (!oldId) return;
    dlg = { oldId: String(oldId), scopeResId: scopeResId ? String(scopeResId) : null, newId: '', q: '', archive: !scopeResId, result: null, archived: false };
    paintDialog();
}
export const openMergeResource = (resId) => openReplaceCollateral(resId, null);

function rmChoose(id) {
    if (!dlg) return;
    dlg.newId = same(dlg.newId, id) ? '' : String(id);
    // repaint the whole dialog so the confirm button label follows, but keep the search box content and focus
    paintDialog();
    const s = document.getElementById('rm-search'); if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
}
function rmSearch(v) { if (!dlg) return; dlg.q = v; filterGroupsDom(document.getElementById('rm-list'), v); }
function rmArchive(on) { if (dlg) dlg.archive = !!on; }

async function rmApply() {
    if (!dlg || !dlg.newId) return;
    const { oldId, newId, scopeResId } = dlg;
    const client = getActiveClient();
    let stats = null; let archived = false;
    await OL().updateAndSync(() => {
        stats = applyReplace(oldId, newId, { scopeResId });
        if (!scopeResId && dlg.archive) {
            const old = cards().find((r) => same(r.id, oldId));
            if (old) { old.isArchived = true; old.mergedInto = String(newId); archived = true; }
        }
    }, client && client.id);
    dlg.result = stats || { changed: 0, merged: 0, dropped: 0, skipped: 0 };
    dlg.archived = archived;
    paintDialog();
}

function rmFinish(cancel) {
    const ctx = dlg; dlg = null;
    OL().closeModal();
    if (cancel || !ctx) return;
    if (document.getElementById('fv-content') || document.getElementById('fv-canvas-wrap')) { try { OL().renderVisualizer(); } catch (e) { /* the map redraws on next open */ } }
    // back to the resource the person started from (the old one is archived after a merge, so open the kept one then)
    const back = ctx.scopeResId || (ctx.archived ? ctx.newId : ctx.oldId);
    if (back && OL().openResourceModal) OL().openResourceModal(back);
}

Object.assign(window.OL, {
    openReplaceCollateral, openMergeResource, rmChoose, rmSearch, rmArchive, rmApply, rmFinish,
    collateralUses, applyCollateralReplace: applyReplace
});
