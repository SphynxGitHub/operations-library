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
//
// MERGE (the "Merge into another resource" button) goes further and retires the old resource completely:
//   steps         old steps are matched to new steps by name, then by position; every path, jump and "entered from" that
//                 pointed at an old step now points at its match. A connection placed by POSITION (no name match) carries
//                 reviewFrom = { resId, resName, stepId, stepName, newResId } and shows "Needs review" until it is approved
//                 or removed (see reviewItems / approveReview / removeReview).
//   outgoing      paths that leave an old step for another process are copied to the matching new step when that step is a
//                 dead end.
//   placement     the new resource takes the old one's stage, workflow(s), slot in the workflow and canvas position,
//                 unless it is already placed.
//   linked items  requests (line items), tasks, how-to guides, and (best effort) linked emails and error-log rows.
//   old resource  archived, with mergedInto = the new id, and a note is added to the new resource.
// If a place already points at the new resource, the old reference is removed instead of creating a duplicate, and a
// reference that would end up pointing at its own resource is dropped.
// ================================================================================================

import { esc, getActiveClient, db, uid } from '../core/data.js';
import { rawSyncJumps, rawRemoveJump } from './flow-visualizer/references.js';
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


// step matching + what else moves, shown once a target is chosen (merge only)
function mappingHtml(oldRes, target) {
    if (!oldRes) return '';
    const c = linkedCounts(oldRes.id);
    const moves = [`${c.paths} connection${c.paths === 1 ? '' : 's'} from other resources`, `${c.requests} request${c.requests === 1 ? '' : 's'}`, `${c.tasks} task${c.tasks === 1 ? '' : 's'}`, `${c.guides} guide${c.guides === 1 ? '' : 's'}`, 'its place on the flow map', 'linked emails and error-log rows'].join(', ');
    let steps = '';
    if (target) {
        const map = planStepMap(oldRes, target, dlg.overrides);
        const refd = referencedOldSteps(oldRes);
        const opts = (sel) => `<option value="" ${sel === '' ? 'selected' : ''}>Top of ${esc(target.name || 'the new resource')} (no step)</option>` + stepsOf(target).map((ns, i) => `<option value="${esc(ns.id)}" ${same(sel, ns.id) ? 'selected' : ''}>${i + 1}. ${esc(ns.name || 'Unnamed step')}</option>`).join('');
        const label = { name: 'Same name', position: 'By position, will need review', chosen: 'Chosen by you, will need review', none: 'No step' };
        steps = refd.length ? `<div class="modal-section-label" style="margin:14px 0 8px;">MATCH STEPS <span class="pill tiny soft">${refd.length}</span></div>
            <div class="tiny muted" style="margin-bottom:6px;">Connections into these steps are moved to the step you pick. Steps matched by position are flagged for review until you approve or remove them.</div>
            ${refd.map((os) => { const m = map[os.id] || { newStepId: '', how: 'none' }; return `<div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) auto;gap:10px;align-items:center;padding:6px 0;border-bottom:1px solid var(--line);font-size:12px;">
                <span>${esc(os.name || 'Unnamed step')}</span>
                <select class="modal-input tiny" onchange="OL.rmMapStep('${esc(os.id)}', this.value)">${opts(m.newStepId)}</select>
                <span class="pill tiny soft">${esc(label[m.how] || '')}</span></div>`; }).join('')}`
            : `<div class="tiny muted" style="margin-top:12px;">Nothing points at a specific step of ${esc(oldRes.name || 'this resource')}, so no step matching is needed.</div>`;
    }
    const typeNote = target && norm(target.type) !== norm(oldRes.type) ? `<div class="tiny" style="margin-top:10px;display:flex;gap:6px;align-items:flex-start;">${icon('alert-triangle', 13)} <span>These are different types (${esc(oldRes.type || 'none')} and ${esc(target.type || 'none')}). Collateral takes the new type; form-answer paths that depended on the old form's fields will not match.</span></div>` : '';
    return `<div style="margin-top:14px;border-top:1px solid var(--line);padding-top:6px;">
        <div class="tiny muted" style="margin-top:8px;">Also moves: ${esc(moves)}.</div>${typeNote}${steps}</div>`;
}

function extraResultHtml({ full, rows }) {
    const l = [];
    l.push(`${full.repointed} flow connection${full.repointed === 1 ? '' : 's'} repointed${full.copied ? `, ${full.copied} carried over from the old steps` : ''}.`);
    if (full.placed) l.push('The new resource took the old one\\u2019s place on the flow map.');
    l.push(`${full.requests} request${full.requests === 1 ? '' : 's'}, ${full.tasks} task${full.tasks === 1 ? '' : 's'} and ${full.guides} guide${full.guides === 1 ? '' : 's'} moved over.`);
    if (rows.emails || rows.errors) l.push(`${rows.emails} linked email${rows.emails === 1 ? '' : 's'} and ${rows.errors} error-log row${rows.errors === 1 ? '' : 's'} moved over.`);
    if (rows.failed) l.push('Linked emails or error-log rows could not all be updated; re-link any that are missing.');
    if (full.dropped) l.push(`${full.dropped} connection${full.dropped === 1 ? '' : 's'} had no step to land on and ${full.dropped === 1 ? 'was' : 'were'} removed${full.unmapped.length ? ': ' + full.unmapped.slice(0, 5).join('; ') : ''}.`);
    const flag = full.flagged ? `<div style="display:flex;gap:6px;align-items:flex-start;margin-top:10px;font-size:13px;">${icon('alert-triangle', 14)} <span>${full.flagged} connection${full.flagged === 1 ? '' : 's'} placed by position ${full.flagged === 1 ? 'is' : 'are'} flagged "Needs review" on the new resource until you approve or remove ${full.flagged === 1 ? 'it' : 'them'}.</span></div>` : '';
    return `<ul class="tiny muted" style="margin:10px 0 0 18px;font-size:13px;line-height:1.6;">${l.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>${flag}`;
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
            ${dlg.extra ? extraResultHtml(dlg.extra) : ''}
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
        ${global ? mappingHtml(old, target) : ''}
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
    dlg = { oldId: String(oldId), scopeResId: scopeResId ? String(scopeResId) : null, newId: '', q: '', archive: !scopeResId, result: null, archived: false, overrides: {}, extra: null };
    paintDialog();
}
export const openMergeResource = (resId) => openReplaceCollateral(resId, null);

function rmChoose(id) {
    if (!dlg) return;
    dlg.newId = same(dlg.newId, id) ? '' : String(id);
    dlg.overrides = {};
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
    let stats = null; let archived = false; let full = null;
    await OL().updateAndSync(() => {
        if (scopeResId) { stats = applyReplace(oldId, newId, { scopeResId }); return; }
        full = applyFullMerge(oldId, newId, { overrides: dlg.overrides, archive: dlg.archive });
        stats = full.collateral;
        archived = !!dlg.archive;
    }, client && client.id);
    if (full) {
        const target = cards().find((r) => same(r.id, newId));
        dlg.extra = { full, rows: await moveLinkedRows(oldId, newId, target && target.name) };
    }
    dlg.result = stats || { changed: 0, merged: 0, dropped: 0, skipped: 0 };
    dlg.archived = archived;
    paintDialog();
}
function rmMapStep(oldStepId, value) { if (!dlg) return; dlg.overrides[oldStepId] = value; paintDialog(); }

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
    openReplaceCollateral, openMergeResource, rmChoose, rmSearch, rmArchive, rmApply, rmFinish, rmMapStep,
    rmApproveReview: approveReview, rmRemoveReview: removeReview, rmApproveAllReview: approveAllReview, rmReviewSectionHtml: reviewSectionHtml, rmReviewItems: reviewItems,
    collateralUses, applyCollateralReplace: applyReplace
});


// =================================================================================================================
// FULL MERGE: steps, flow map, placement, linked items
// =================================================================================================================
const stepsOf = (r) => ((r && r.steps) || []).filter((x) => x);
const norm = (v) => String(v || '').trim().toLowerCase().replace(/\s+/g, ' ');
const pdata = () => project();

// old step id -> { newStepId, how: 'name' | 'position' | 'none' }. `overrides` = { oldStepId: newStepId | '' } from the dialog.
export function planStepMap(oldRes, newRes, overrides = {}) {
    const oldSteps = stepsOf(oldRes); const newSteps = stepsOf(newRes);
    const map = {}; const taken = new Set();
    oldSteps.forEach((os) => {                                      // 1. same name
        const hit = newSteps.find((ns) => !taken.has(String(ns.id)) && norm(ns.name) && norm(ns.name) === norm(os.name));
        if (hit) { taken.add(String(hit.id)); map[os.id] = { newStepId: String(hit.id), how: 'name' }; }
    });
    oldSteps.forEach((os, i) => {                                   // 2. same position (clamped to the last step)
        if (map[os.id]) return;
        if (!newSteps.length) { map[os.id] = { newStepId: '', how: 'none' }; return; }
        map[os.id] = { newStepId: String(newSteps[Math.min(i, newSteps.length - 1)].id), how: 'position' };
    });
    Object.keys(overrides || {}).forEach((k) => {                   // 3. what the person chose in the dialog
        if (!map[k]) return;
        const v = overrides[k];
        if (v === undefined) return;
        if (v === '') map[k] = { newStepId: '', how: 'none', chosen: true };
        else if (newSteps.some((ns) => same(ns.id, v))) map[k] = { newStepId: String(v), how: (map[k].newStepId === String(v) && map[k].how === 'name') ? 'name' : 'chosen', chosen: true };
    });
    return map;
}

// Steps of the old resource that something points at (so the dialog only asks about those).
export function referencedOldSteps(oldRes) {
    const ids = new Set(); const pre = `${oldRes.id}-`;
    cards().forEach((r) => {
        if (same(r.id, oldRes.id)) return;
        stepsOf(r).forEach((st) => {
            ((st.logic && st.logic.out) || []).forEach((l) => { if (l && String(l.targetId || '').startsWith(pre)) ids.add(String(l.targetId).slice(pre.length)); });
            ((st.logic && st.logic.in) || []).forEach((l) => { if (l && String(l.sourceId || '').startsWith(pre)) ids.add(String(l.sourceId).slice(pre.length)); });
            ((Array.isArray(st.jumps) ? st.jumps : []).concat(st.refResId && !Array.isArray(st.jumps) ? [{ resId: st.refResId, stepId: st.refStepId }] : [])).forEach((j) => { if (j && same(j.resId, oldRes.id) && j.stepId) ids.add(String(j.stepId)); });
        });
    });
    return stepsOf(oldRes).filter((s) => ids.has(String(s.id)));
}

// counts for the dialog and the summary: what else is tied to the old resource
export function linkedCounts(oldId) {
    const pd = pdata(); const o = String(oldId); const c = { paths: 0, requests: 0, tasks: 0, guides: 0 };
    const pre = `${o}-`;
    cards().forEach((r) => { if (same(r.id, o)) return; stepsOf(r).forEach((st) => {
        c.paths += ((st.logic && st.logic.out) || []).filter((l) => l && String(l.targetId || '').startsWith(pre)).length;
        c.paths += (Array.isArray(st.jumps) ? st.jumps : []).filter((j) => j && same(j.resId, o)).length;
    }); });
    (pd.scopingSheets || []).forEach((sh) => (sh && sh.lineItems || []).forEach((it) => { if (same(it.resourceId, o) || (Array.isArray(it.resourceIds) && it.resourceIds.map(String).includes(o))) c.requests++; }));
    (pd.clientTasks || []).forEach((t) => { if (taskMentions(t, o)) c.tasks++; });
    howToLists(pd).forEach((list) => list.forEach((g) => { if (g && Array.isArray(g.resourceIds) && g.resourceIds.map(String).includes(o)) c.guides++; }));
    return c;
}
const howToLists = (pd) => [pd.localHowTo || [], ...(pd === (window.OL && window.OL.getCurrentProjectData && window.OL.getCurrentProjectData()) && pd.howToLibrary ? [pd.howToLibrary] : [])];
const taskMentions = (t, o) => !!t && (same(t.resourceId, o) || (Array.isArray(t.resourceIds) && t.resourceIds.map(String).includes(o)) || (Array.isArray(t.links) && t.links.some((l) => l && Array.isArray(l.resourceIds) && l.resourceIds.map(String).includes(o))));
const swapIds = (arr, o, n) => [...new Set(arr.map((x) => (same(x, o) ? String(n) : x)))];

// Mutates project data. Returns stats; flagged connections carry reviewFrom.
export function applyFullMerge(oldId, newId, { overrides = {}, archive = true } = {}) {
    const pd = pdata(); const all = cards();
    const oldRes = all.find((r) => same(r.id, oldId)); const newRes = all.find((r) => same(r.id, newId));
    const st = { collateral: null, repointed: 0, flagged: 0, dropped: 0, copied: 0, requests: 0, tasks: 0, guides: 0, placed: false, unmapped: [] };
    if (!oldRes || !newRes || same(oldId, newId)) return st;
    const map = planStepMap(oldRes, newRes, overrides);
    const pre = `${oldId}-`;
    const stepName = (id) => { const s = stepsOf(oldRes).find((x) => same(x.id, id)); return s ? (s.name || 'Unnamed step') : 'a step'; };
    const flagOf = (oldStepId) => ({ resId: String(oldId), resName: oldRes.name || 'Old resource', stepId: String(oldStepId), stepName: stepName(oldStepId), newResId: String(newId) });
    // where an old step id lands: { id, flag } ; flag = the review marker when it was placed by position or by hand
    const land = (oldStepId) => {
        const m = map[oldStepId];
        if (!m) return { id: '', flag: flagOf(oldStepId) };
        return { id: m.newStepId, flag: m.how === 'name' ? null : flagOf(oldStepId) };
    };
    const stampFlag = (entry, f) => { if (f) { entry.reviewFrom = f; st.flagged++; } };

    // 1. collateral everywhere
    st.collateral = applyReplace(oldId, newId, {});

    // 2. paths, jumps and "entered from" that point at the old resource (the old resource's own steps are handled in 3)
    all.forEach((r) => {
        if (same(r.id, oldId)) return;
        stepsOf(r).forEach((step) => {
            if (step.logic && Array.isArray(step.logic.out)) {
                step.logic.out = step.logic.out.filter((l) => {
                    if (!l || !String(l.targetId || '').startsWith(pre)) return true;
                    const to = land(String(l.targetId).slice(pre.length));
                    if (!to.id) { st.dropped++; st.unmapped.push(`${r.name || 'Untitled'} › ${step.name || 'step'}`); return false; }
                    l.targetId = `${newId}-${to.id}`; st.repointed++; stampFlag(l, to.flag); return true;
                });
            }
            if (step.logic && Array.isArray(step.logic.in)) {
                step.logic.in = step.logic.in.filter((l) => {
                    if (!l || !String(l.sourceId || '').startsWith(pre)) return true;
                    const from = land(String(l.sourceId).slice(pre.length));
                    if (!from.id) { st.dropped++; return false; }
                    l.sourceId = `${newId}-${from.id}`; st.repointed++; stampFlag(l, from.flag); return true;
                });
            }
            if (Array.isArray(step.jumps)) {
                let touched = false;
                step.jumps.forEach((j) => {
                    if (!j || !same(j.resId, oldId)) return;
                    touched = true; j.resId = String(newId);
                    if (j.stepId) { const to = land(String(j.stepId)); j.stepId = to.id || ''; stampFlag(j, to.flag); }
                    st.repointed++;
                });
                if (touched) rawSyncJumps(step);
            } else if (step.refResId && same(step.refResId, oldId)) {
                step.refResId = String(newId);
                if (step.refStepId) { const to = land(String(step.refStepId)); if (to.id) step.refStepId = to.id; else delete step.refStepId; }
                st.repointed++;
            }
            if (step.targetResourceId && same(step.targetResourceId, oldId)) { step.targetResourceId = String(newId); step.targetResourceName = newRes.name || step.targetResourceName; st.repointed++; }
        });
    });

    // 3. paths that LEAVE an old step for somewhere else are carried to the matching new step when that step is a dead end
    stepsOf(oldRes).forEach((os) => {
        const m = map[os.id]; if (!m || !m.newStepId) return;
        const ns = stepsOf(newRes).find((x) => same(x.id, m.newStepId)); if (!ns) return;
        const hasOut = ((ns.logic && ns.logic.out) || []).some((l) => l && l.targetId) || (Array.isArray(ns.jumps) && ns.jumps.length) || ns.refResId;
        if (hasOut) return;
        const flag = m.how === 'name' ? null : flagOf(os.id);
        const outs = ((os.logic && os.logic.out) || []).filter((l) => l && l.targetId && !String(l.targetId).startsWith(pre));
        const jumps = (Array.isArray(os.jumps) ? os.jumps : []).filter((j) => j && j.resId && !same(j.resId, oldId));
        if (!outs.length && !jumps.length) return;
        if (!ns.logic) ns.logic = { in: [], out: [] };
        if (!Array.isArray(ns.logic.out)) ns.logic.out = [];
        outs.forEach((l) => { const c = JSON.parse(JSON.stringify(l)); stampFlag(c, flag); ns.logic.out.push(c); st.copied++; });
        if (jumps.length) {
            if (!Array.isArray(ns.jumps)) ns.jumps = [];
            jumps.forEach((j) => { const c = JSON.parse(JSON.stringify(j)); c.id = 'j' + uid().toString().slice(-6) + Math.random().toString(36).slice(2, 5); stampFlag(c, flag); ns.jumps.push(c); st.copied++; });
            rawSyncJumps(ns);
        }
    });

    // 4. placement on the flow map
    const O = OL();
    const wfs = pd.workflows || [];
    const wasIn = wfs.filter((w) => (w.resourceIds || []).map(String).includes(String(oldId))).map((w) => ({ w, idx: (w.resourceIds || []).map(String).indexOf(String(oldId)) }));
    const newPlaced = (typeof O.getPlacements === 'function' ? O.getPlacements(newRes).length : 0) || newRes.stageId || wfs.some((w) => (w.resourceIds || []).map(String).includes(String(newId)));
    if (!newPlaced) {
        const oldPl = typeof O.getPlacements === 'function' ? O.getPlacements(oldRes).map((p) => ({ ...p, id: undefined })) : [];
        if (typeof O.setPlacements === 'function' && oldPl.length) O.setPlacements(newId, oldPl);
        else { newRes.stageId = oldRes.stageId || null; newRes.workflowId = oldRes.workflowId || null; wasIn.forEach(({ w }) => { w.resourceIds = w.resourceIds || []; if (!w.resourceIds.map(String).includes(String(newId))) w.resourceIds.push(String(newId)); }); }
        // same slot in the workflow as the old one had
        wasIn.forEach(({ w, idx }) => { const ids = (w.resourceIds || []).map(String); const at = ids.indexOf(String(newId)); if (at > -1 && idx > -1 && at !== idx) { const [x] = w.resourceIds.splice(at, 1); w.resourceIds.splice(Math.min(idx, w.resourceIds.length), 0, x); } });
        if (oldRes.coords && !newRes.coords) newRes.coords = JSON.parse(JSON.stringify(oldRes.coords));
        st.placed = true;
    }

    // 5. linked items
    (pd.scopingSheets || []).forEach((sh) => (sh && sh.lineItems || []).forEach((it) => {
        let hit = false;
        if (same(it.resourceId, oldId)) { it.resourceId = String(newId); hit = true; }
        if (Array.isArray(it.resourceIds) && it.resourceIds.map(String).includes(String(oldId))) { it.resourceIds = swapIds(it.resourceIds, oldId, newId); hit = true; }
        if (hit) st.requests++;
    }));
    (pd.clientTasks || []).forEach((t) => {
        if (!taskMentions(t, String(oldId))) return;
        if (same(t.resourceId, oldId)) t.resourceId = String(newId);
        if (Array.isArray(t.resourceIds)) t.resourceIds = swapIds(t.resourceIds, oldId, newId);
        (t.links || []).forEach((l) => { if (l && Array.isArray(l.resourceIds)) l.resourceIds = swapIds(l.resourceIds, oldId, newId); });
        st.tasks++;
    });
    howToLists(pd).forEach((list) => list.forEach((g) => { if (g && Array.isArray(g.resourceIds) && g.resourceIds.map(String).includes(String(oldId))) { g.resourceIds = swapIds(g.resourceIds, oldId, newId); st.guides++; } }));

    // 6. retire the old one, leave a trail on the new one
    if (!Array.isArray(newRes.comments)) newRes.comments = [];
    newRes.comments.push({ id: uid(), author: (O.getCurrentUserName ? O.getCurrentUserName() : '') || 'Sphynx Team', date: new Date().toISOString(),
        text: `Merged from "${oldRes.name || 'Untitled'}": ${st.repointed} connection${st.repointed === 1 ? '' : 's'} repointed, ${st.flagged} to review.` });
    if (archive) {
        wfs.forEach((w) => { w.resourceIds = (w.resourceIds || []).filter((x) => !same(x, oldId)); });
        oldRes.isArchived = true; oldRes.mergedInto = String(newId);
    }
    return st;
}

// best effort: rows that live in the database rather than in the project data
export async function moveLinkedRows(oldId, newId, newName) {
    const client = getActiveClient(); const out = { emails: 0, errors: 0, failed: false };
    if (!client || !client.id || !db || String(window.location.hash || '').startsWith('#/vault')) return out;
    try {
        const g = await db.from('gmail_messages').update({ linked_resource_id: String(newId) }).eq('linked_resource_id', String(oldId)).eq('linked_client_id', client.id).select('id');
        if (g && !g.error) out.emails = (g.data || []).length; else out.failed = true;
        const e = await db.from('error_log').update({ resource_id: String(newId), resource_name: newName || null }).eq('resource_id', String(oldId)).eq('client_id', client.id).select('id');
        if (e && !e.error) out.errors = (e.data || []).length; else out.failed = true;
    } catch (err) { out.failed = true; }
    return out;
}

// ---- connections waiting for a person to look at them --------------------------------------------------------------
// [{ res, step, kind: 'out'|'in'|'jump', ref, from }] ; resId limits to merges into that resource
export function reviewItems(resId = null) {
    const out = [];
    cards().forEach((r) => stepsOf(r).forEach((step) => {
        ((step.logic && step.logic.out) || []).forEach((l) => { if (l && l.reviewFrom && (!resId || same(l.reviewFrom.newResId, resId))) out.push({ res: r, step, kind: 'out', ref: l, from: l.reviewFrom }); });
        ((step.logic && step.logic.in) || []).forEach((l) => { if (l && l.reviewFrom && (!resId || same(l.reviewFrom.newResId, resId))) out.push({ res: r, step, kind: 'in', ref: l, from: l.reviewFrom }); });
        (Array.isArray(step.jumps) ? step.jumps : []).forEach((j) => { if (j && j.reviewFrom && (!resId || same(j.reviewFrom.newResId, resId))) out.push({ res: r, step, kind: 'jump', ref: j, from: j.reviewFrom }); });
    }));
    return out;
}
const reviewKey = (it) => `${it.res.id}|${it.step.id}|${it.kind}|${it.kind === 'jump' ? it.ref.id : (it.kind === 'out' ? it.ref.targetId : it.ref.sourceId)}`;
function findReview(key) { return reviewItems().find((it) => reviewKey(it) === key) || null; }
async function reviewDone(back) {
    const client = getActiveClient();
    await OL().updateAndSync(() => {}, client && client.id);
    if (document.getElementById('fv-content') || document.getElementById('fv-canvas-wrap')) { try { OL().renderVisualizer(); } catch (e) { /* redraws next open */ } }
    if (back && OL().openResourceModal) OL().openResourceModal(back);
}
async function approveReview(key, back) { const it = findReview(key); if (!it) return; delete it.ref.reviewFrom; await reviewDone(back); }
async function removeReview(key, back) {
    const it = findReview(key); if (!it) return;
    if (it.kind === 'out') it.step.logic.out = it.step.logic.out.filter((l) => l !== it.ref);
    else if (it.kind === 'in') it.step.logic.in = it.step.logic.in.filter((l) => l !== it.ref);
    else rawRemoveJump(it.step, it.ref.id);
    await reviewDone(back);
}
async function approveAllReview(resId) { reviewItems(resId).forEach((it) => { delete it.ref.reviewFrom; }); await reviewDone(resId); }

const destOf = (it) => {
    const id = it.kind === 'out' ? it.ref.targetId : (it.kind === 'in' ? it.ref.sourceId : `${it.ref.resId}-${it.ref.stepId || ''}`);
    const r = cards().find((x) => String(id).startsWith(`${x.id}-`));
    const s = r && stepsOf(r).find((x) => String(id) === `${r.id}-${x.id}`);
    return r ? `${r.name || 'Untitled'}${s ? ` › ${s.name || 'step'}` : ' (top)'}` : 'a process';
};

// The "Needs review" block for the resource modal (empty string when nothing is waiting).
export function reviewSectionHtml(resId) {
    const items = reviewItems(resId); if (!items.length) return '';
    const rows = items.map((it) => {
        const k = esc(reviewKey(it)).replace(/'/g, '&#39;');
        const verb = it.kind === 'in' ? 'is entered from' : 'leads to';
        return `<div style="display:flex;align-items:center;gap:12px;padding:10px 14px;border:1px solid var(--line);border-radius:8px;background:var(--panel-soft);">
            <div style="flex:1;min-width:0;">
                <div style="font-size:13px;line-height:1.4;">${esc(it.res.name || 'Untitled')} › ${esc(it.step.name || 'Unnamed step')} ${verb} ${esc(destOf(it))}</div>
                <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">Was: ${esc(it.from.resName)} › ${esc(it.from.stepName)} (placed by position, no step with that name)</div>
            </div>
            <button class="btn tiny soft" style="display:flex;align-items:center;gap:6px;" onclick="OL.goToStepFromLibrary('${esc(it.res.id)}','${esc(it.step.id)}')">${icon('mouse-pointer-2', 12)} View on map</button>
            <button class="btn tiny primary" style="display:flex;align-items:center;gap:6px;" onclick="OL.rmApproveReview('${k}','${esc(resId)}')">${icon('check', 12)} Approve</button>
            <button class="btn tiny soft" style="display:flex;align-items:center;gap:6px;" onclick="OL.rmRemoveReview('${k}','${esc(resId)}')">${icon('trash-2', 12)} Remove</button>
        </div>`;
    }).join('');
    return `<div class="card-section" style="margin-top:20px;border-top:1px solid var(--line);padding-top:15px;">
        <label class="modal-section-label" style="display:flex;align-items:center;gap:6px;">${icon('alert-triangle', 14)} NEEDS REVIEW <span class="pill tiny soft">${items.length}</span></label>
        <div class="tiny muted" style="margin:4px 0 8px;">These connections were moved here from a merged resource and placed by position. Approve each one, or remove it.</div>
        <div style="display:flex;flex-direction:column;gap:8px;">${rows}</div>
        ${items.length > 1 ? `<div style="margin-top:10px;"><button class="btn tiny soft" onclick="OL.rmApproveAllReview('${esc(resId)}')">Approve all</button></div>` : ''}
    </div>`;
}
