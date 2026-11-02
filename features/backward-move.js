//======================= FEATURES / BACKWARD MOVE PROMPT =======================//
// Shown whenever something moves backward (a resource back to In Process, a closed task reopened, a review marked
// Change requested). Asks what is changing, why, and, for "we caused it", the pattern behind it. When the move came
// from an email or a meeting recap, the answers are pre-filled from it and the quote is shown beside the form.
//
//   OL.openBackwardMovePrompt({
//       clientId, itemType, itemId, itemName, fromStatus, toStatus,
//       prefill: { what, whyCategory, askedBy, quote, date, sourceNoteId },
//       onSaved: (move) => {...}            // called after the move is saved; the caller then changes the status
//   })

import { esc, getCurrentUserName } from '../core/data.js';
import { WHY_CATEGORIES, PATTERN_TAGS, buildMovePrefill, validateMove, saveMove } from '../core/status-moves.js';

let ctx = null;

function paint() {
    const p = ctx.form;
    const why = WHY_CATEGORIES.map((c) => {
        const on = p.whyCategory === c.key;
        return `<div onclick="OL._bmSet('whyCategory','${c.key}')" style="display:flex;gap:12px;align-items:flex-start;padding:11px 14px;border:1px solid ${on ? '#2dd4bf' : 'var(--line)'};background:${on ? 'rgba(45,212,191,.10)' : 'transparent'};border-radius:10px;cursor:pointer;">
            <span style="width:16px;height:16px;border-radius:50%;flex:none;margin-top:2px;box-sizing:border-box;border:${on ? '5px solid #2dd4bf' : '2px solid #5b6b86'};"></span>
            <div><div style="font-weight:600;font-size:13.5px;">${esc(c.label)}</div><div class="muted" style="font-size:12.5px;">${esc(c.hint)}</div></div>
        </div>`;
    }).join('');
    const tags = p.whyCategory === 'we_caused_it' ? `
        <div>
            <label class="tiny bold uppercase muted" style="display:block;margin-bottom:6px;">Pattern</label>
            <div style="display:flex;flex-wrap:wrap;gap:6px;">${PATTERN_TAGS.map((t) =>
                `<span class="pill tiny ${p.patternTag === t ? '' : 'soft'}" onclick="OL._bmSet('patternTag','${esc(t).replace(/'/g, '&#39;')}')" style="${p.patternTag === t ? 'background:rgba(45,212,191,.14);color:#2dd4bf;' : ''}">${esc(t)}</span>`).join('')}</div>
        </div>` : '';
    const source = p.quote ? `
        <div style="flex:.8;min-width:0;display:flex;flex-direction:column;gap:8px;">
            <label class="tiny bold uppercase muted">From the ${esc(ctx.sourceLabel)}</label>
            <div style="border:1px solid var(--line);border-radius:10px;padding:12px 14px;font-style:italic;font-size:13.5px;line-height:1.6;">"${esc(p.quote)}"</div>
            <div class="tiny muted">${p.askedBy ? `Asked by ${esc(p.askedBy)}` : ''}${p.askedBy && p.date ? ' · ' : ''}${esc(p.date || '')}</div>
            <div class="tiny muted">The fields on the left were filled in from this. Change anything that is wrong.</div>
        </div>` : '';
    const html = `
    <div class="modal-head">
        <div class="modal-title-text"><i data-lucide="undo-2" style="width:16px;height:16px;vertical-align:sub;margin-right:6px;"></i>Move back: ${esc(ctx.itemName || '')}</div>
        <button class="btn small soft" onclick="OL.closeModal()">✕</button>
    </div>
    <div class="modal-body" style="width:100%;box-sizing:border-box;">
        <div class="muted" style="font-size:13px;margin-bottom:14px;">${esc(ctx.fromStatus || '')}${ctx.fromStatus && ctx.toStatus ? ' → ' : ''}<b>${esc(ctx.toStatus || '')}</b></div>
        <div style="display:flex;gap:24px;align-items:flex-start;">
            <div style="flex:1.2;min-width:0;display:flex;flex-direction:column;gap:14px;">
                <div>
                    <label class="tiny bold uppercase muted" style="display:block;margin-bottom:6px;">What is changing</label>
                    <textarea id="bm-what" class="modal-input" rows="3" style="width:100%;box-sizing:border-box;" oninput="OL._bmSet('what', this.value, true)">${esc(p.what)}</textarea>
                </div>
                <div>
                    <label class="tiny bold uppercase muted" style="display:block;margin-bottom:6px;">Why</label>
                    <div style="display:flex;flex-direction:column;gap:8px;">${why}</div>
                </div>
                ${tags}
                <div>
                    <label class="tiny bold uppercase muted" style="display:block;margin-bottom:6px;">Who asked</label>
                    <input id="bm-asked" class="modal-input" style="width:100%;box-sizing:border-box;" value="${esc(p.askedBy)}" oninput="OL._bmSet('askedBy', this.value, true)">
                </div>
            </div>
            ${source}
        </div>
        <div id="bm-problems" class="tiny" style="color:#f87171;margin-top:12px;min-height:16px;"></div>
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:8px;">
            <button class="btn soft" onclick="OL.closeModal()">Cancel</button>
            <button class="btn primary" onclick="OL._bmSave()">Move back and save note</button>
        </div>
    </div>`;
    if (document.querySelector('.modal-box.modal-wide')) document.querySelector('.modal-box.modal-wide').innerHTML = html;
    else OL.showOverlayModal(html, { wide: true });
    if (window.lucide) window.lucide.createIcons();
}

export function openBackwardMovePrompt(opts = {}) {
    ctx = {
        clientId: opts.clientId, itemType: opts.itemType || 'resource', itemId: opts.itemId, itemName: opts.itemName,
        fromStatus: opts.fromStatus, toStatus: opts.toStatus, onSaved: opts.onSaved,
        sourceLabel: opts.sourceLabel || 'email', form: buildMovePrefill(opts.prefill || {}),
    };
    paint();
}

// text fields update in place (no repaint, so typing keeps its place); choices repaint to show the selection.
export function _bmSet(key, value, quiet) {
    if (!ctx) return;
    ctx.form[key] = value;
    if (key === 'whyCategory' && value !== 'we_caused_it') ctx.form.patternTag = '';
    if (!quiet) paint();
}

export async function _bmSave() {
    if (!ctx) return;
    const problems = validateMove(ctx.form);
    const box = document.getElementById('bm-problems');
    if (problems.length) { if (box) box.textContent = problems.join(' '); return; }
    const move = await saveMove({
        clientId: ctx.clientId, itemType: ctx.itemType, itemId: ctx.itemId, fromStatus: ctx.fromStatus, toStatus: ctx.toStatus,
        what: ctx.form.what, whyCategory: ctx.form.whyCategory, patternTag: ctx.form.patternTag, askedBy: ctx.form.askedBy,
        sourceNoteId: ctx.form.sourceNoteId, movedBy: getCurrentUserName?.(),
    });
    // A failed save (table missing) must not trap the person: the move still goes ahead, with a warning.
    if (!move) console.warn('The move was not recorded in the history.');
    const done = ctx.onSaved;
    const saved = move || { what: ctx.form.what, why_category: ctx.form.whyCategory, pattern_tag: ctx.form.patternTag };
    ctx = null;
    OL.closeModal();
    if (typeof done === 'function') done(saved);
}

window.OL = window.OL || {};
Object.assign(window.OL, { openBackwardMovePrompt, _bmSet, _bmSave });
