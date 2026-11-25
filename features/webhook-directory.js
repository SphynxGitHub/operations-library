// ============================================================
// WEBHOOK DIRECTORY
// A Zap step that POSTs to a Zapier catch-hook address starts another Zap. The Zapier export records the address on the
// posting step but does not say which Zap owns it, so there is nothing to match automatically. This screen lists every
// address, the steps that post to it, and lets you choose the Zap it starts once. The choice is kept on the project
// (webhookMap: address -> Zap card id), and every posting step gets a line to that Zap's trigger, now and after later imports.
//
// STORED ON THE PROJECT:
//   webhookPosts  { address: [ { zapId, stepId, zapName, stepTitle } ] }   rebuilt from the export on each import (collectWebhookPosts)
//   webhookMap    { address: cardId }                                      the choices made here
// LINES:  logic.out entries on the posting step, marked _hookdir, so a re-import's own hook lines are never touched by them.
// ============================================================
import { esc } from '../core/data.js';

const OL = window.OL || (window.OL = {});
const HOOK_URL = /hooks\.zapier\.com\/hooks\/catch\/\d+\/(\w+)/g;

// Every address the export's non-trigger steps post to: { address: [ { zapId, stepId, zapName, stepTitle } ] }
export function collectWebhookPosts(zaps) {
    const out = {};
    for (const z of zaps || []) {
        for (const s of z.steps || []) {
            if (s.role === 'trigger') continue;
            const seen = new Set();
            for (const m of s.mappings || []) {
                for (const hit of String(m && m.value != null ? m.value : '').matchAll(HOOK_URL)) {
                    if (seen.has(hit[1])) continue;
                    seen.add(hit[1]);
                    (out[hit[1]] = out[hit[1]] || []).push({ zapId: String(z.zapId), stepId: String(s.stepId), zapName: String(z.zapName || ''), stepTitle: String(s.title || s.action || '') });
                }
            }
        }
    }
    return out;
}

const data = () => OL.getCurrentProjectData();
const resources = () => (data().resources || data().localResources || []).filter((r) => r && !r.isDeleted);
const cardOfZap = (zapId) => resources().find((r) => r.type === 'Zap' && String(r.originalZapId) === String(zapId));
const stepOfZap = (card, stepId) => card && (card.steps || []).find((s) => s.zap && String(s.zap.stepId) === String(stepId));
const triggerOf = (card) => card && ((card.steps || []).find((s) => s.zap && s.zap.role === 'trigger') || (card.steps || [])[0]);
const clean = (n) => String(n || '').replace(/^\s*(?:⚡\s*)?/, '').trim();

// Zaps that can receive a hook: their first step is a webhook trigger
function receivers() {
    return resources().filter((r) => r.type === 'Zap' && !r.isArchived && (r.steps || []).some((s) => s.zap && s.zap.role === 'trigger' && /webhook/i.test(String(s.zap.app || s.appName || ''))))
        .sort((a, b) => clean(a.name).localeCompare(clean(b.name)));
}

let draft = {};            // address -> card id, edited on screen and kept on Save

function addresses() {
    const posts = data().webhookPosts || {};
    return Object.keys(posts).map((key) => ({
        key,
        callers: posts[key].map((c) => { const card = cardOfZap(c.zapId); return Object.assign({}, c, { card, step: stepOfZap(card, c.stepId) }); }),
    })).sort((a, b) => b.callers.length - a.callers.length || a.key.localeCompare(b.key));
}

// Put a line on every posting step to the trigger of the Zap its address starts. Lines made here carry _hookdir and are rebuilt each time.
export function applyWebhookLinks() {
    const d = data(); const map = d.webhookMap || {}; let added = 0;
    resources().filter((r) => r.type === 'Zap').forEach((r) => (r.steps || []).forEach((s) => { if (s.logic && Array.isArray(s.logic.out)) s.logic.out = s.logic.out.filter((l) => !l._hookdir); }));
    const posts = d.webhookPosts || {};
    Object.keys(map).forEach((key) => {
        const target = resources().find((r) => String(r.id) === String(map[key])); const trig = triggerOf(target);
        if (!target || !trig) return;
        (posts[key] || []).forEach((c) => {
            const card = cardOfZap(c.zapId); const step = stepOfZap(card, c.stepId);
            if (!step || String(card.id) === String(target.id)) return;
            const to = `${target.id}-${trig.id}`;
            step.logic = step.logic || { in: [], out: [] }; step.logic.out = step.logic.out || [];
            if (step.logic.out.some((l) => String(l.targetId) === to)) return;
            step.logic.out.push({ type: 'next', types: ['next'], targetId: to, rule: `Starts “${clean(target.name)}” (catch hook)`, loopLimit: '', delayValue: '', delayUnit: 'days', _auto: true, _hookdir: key });
            delete step.noAutoNext;
            added++;
        });
    });
    return added;
}

// ---------- the screen ----------
function counts() {
    const list = addresses(); const matched = list.filter((a) => draft[a.key]).length;
    return { total: list.length, matched, open: list.length - matched, steps: list.reduce((n, a) => n + a.callers.length, 0) };
}
function refresh() {
    const c = counts();
    const set = (id, t) => { const el = document.getElementById(id); if (el) el.textContent = t; };
    set('whd-matched', `${c.matched} matched`); set('whd-open', `${c.open} need a Zap`);
    document.querySelectorAll('[data-whd-row]').forEach((row) => { row.style.background = draft[row.getAttribute('data-whd-row')] ? '' : 'var(--bg-warning)'; });
}
export function webhookSet(key, cardId) { if (cardId) draft[key] = String(cardId); else delete draft[key]; refresh(); }
export function webhookSave() {
    OL.updateAndSync(() => { const d = data(); d.webhookMap = Object.assign({}, draft); OL.__whAdded = applyWebhookLinks(); });
    const n = OL.__whAdded || 0;
    if (OL.closeModal) OL.closeModal();
    if (typeof OL.renderVisualizer === 'function' && OL._fv) { try { OL.renderVisualizer(); } catch (e) { console.warn(e); } }
    alert(n ? `Saved. ${n} line${n === 1 ? '' : 's'} added to the map.` : 'Saved. No new lines were needed.');
}

export function openWebhookDirectory() {
    const d = data(); draft = Object.assign({}, d.webhookMap || {});
    const list = addresses(); const recv = receivers();
    if (!list.length) {
        window.openModal(`<div style="padding:24px;max-width:560px;"><h3 style="margin:0 0 8px;">Webhook directory</h3><p style="font-size:13px;color:var(--text-muted);line-height:1.5;">No webhook addresses are recorded for this project yet. Import the Zapier export file again (Integrations, Zapier) and they will be listed here.</p></div>`);
        return;
    }
    const c = counts();
    const opts = (key) => `<option value="">Choose a Zap</option>${recv.map((r) => `<option value="${esc(r.id)}" ${String(draft[key] || '') === String(r.id) ? 'selected' : ''}>${esc(clean(r.name))}</option>`).join('')}`;
    const rows = list.map((a) => {
        const names = a.callers.slice(0, 4).map((x) => `${esc(clean(x.zapName))}: ${esc(x.stepTitle)}${x.step ? '' : ' (not in this project)'}`).join('<br>');
        const more = a.callers.length > 4 ? `<br>and ${a.callers.length - 4} more` : '';
        return `<div data-whd-row="${esc(a.key)}" style="display:grid;grid-template-columns:110px 300px minmax(0,1fr);gap:14px;padding:10px 14px;border-top:1px solid var(--line, rgba(127,127,127,.25));align-items:start;${draft[a.key] ? '' : 'background:var(--bg-warning);'}">
            <span style="font-family:monospace;font-size:13px;">…/${esc(a.key)}/</span>
            <select class="modal-input" onchange="OL.webhookSet('${esc(a.key)}', this.value)">${opts(a.key)}</select>
            <div style="font-size:13px;line-height:1.5;">${a.callers.length} step${a.callers.length === 1 ? '' : 's'}<br><span style="color:var(--text-muted);">${names}${more}</span></div>
        </div>`;
    }).join('');
    window.openModal(`<div style="padding:20px 24px;width:min(1180px,92vw);max-width:100%;box-sizing:border-box;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px;"><i data-lucide="webhook" style="width:18px;height:18px;"></i><h3 style="margin:0;font-size:16px;">Webhook directory</h3><span style="margin-left:auto;font-size:13px;color:var(--text-muted);">${c.total} addresses, ${c.steps} posting steps</span></div>
        <p style="font-size:13px;color:var(--text-muted);margin:0 0 12px;line-height:1.5;">Pick which Zap each address starts. Every step that posts to it gets a line to that Zap’s trigger, now and on future imports.</p>
        <div style="display:flex;gap:8px;margin-bottom:12px;"><span id="whd-matched" style="font-size:12px;padding:3px 10px;border-radius:8px;background:var(--bg-success);color:var(--text-success);">${c.matched} matched</span><span id="whd-open" style="font-size:12px;padding:3px 10px;border-radius:8px;background:var(--bg-warning);color:var(--text-warning);">${c.open} need a Zap</span></div>
        <div style="border:1px solid var(--line, rgba(127,127,127,.25));border-radius:8px;overflow:hidden;max-height:62vh;overflow-y:auto;">
            <div style="display:grid;grid-template-columns:110px 300px minmax(0,1fr);gap:14px;padding:8px 14px;font-size:12px;color:var(--text-muted);background:var(--bg-neutral);position:sticky;top:0;"><span>Address</span><span>Starts this Zap</span><span>Started by these steps</span></div>
            ${rows}
        </div>
        <div style="display:flex;gap:10px;margin-top:14px;justify-content:flex-end;"><button class="btn soft" onclick="OL.closeModal()">Cancel</button><button class="btn primary" onclick="OL.webhookSave()">Save links</button></div>
    </div>`);
    if (window.lucide) lucide.createIcons();
}

Object.assign(OL, { openWebhookDirectory, webhookSet, webhookSave, applyWebhookLinks, collectWebhookPosts });
