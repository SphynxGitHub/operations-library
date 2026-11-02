//======================= FEATURES / SUGGESTION CARD =======================//
// One reusable card for every suggestion the system makes from an email or a meeting recap. It shows the quoted
// passage, the type, the target it was matched to, the confidence, and the actions that fit. A suggestion is only
// ever a suggestion: nothing changes until a person picks an action. Each pick is recorded in the suggestion log.
//
// Features register what each action does:
//   OL.registerSuggestionHandler('change', { move_back: (s) => {...}, add_note: (s) => {...} })
// and render cards with:
//   OL.suggestionCardHtml(s)   s = { id, logId, n, type, quote, confidence, rows: [[label, html]], actions: [{ key, label, icon, primary }] }
//
// Types and their usual actions (the card does not enforce these; the feature that makes the suggestion chooses):
//   change         Move back to In Process, Add as note, More (create new, change target), Dismiss
//   approval       Mark Approved, Add as note, Dismiss
//   holding_reply  Move due date, Add as note, Dismiss
//   item_received  Close ask and attach, Add as note, Dismiss

import { esc, getCurrentUserName } from '../core/data.js';
import { recordOutcome } from '../core/suggestion-log.js';

export const SUGGESTION_TYPE_LABELS = {
    change: 'Change', approval: 'Approval', holding_reply: 'Holding reply', item_received: 'Item received',
    new_request: 'New request', note: 'Note',
};
const TYPE_COLORS = {
    change: '#f5b942', approval: '#2dd4bf', holding_reply: '#60a5fa', item_received: '#a78bfa', new_request: '#f5b942', note: '#9aa7bd',
};
const CONFIDENCE_LABEL = { high: 'High confidence', medium: 'Medium confidence', low: 'Low confidence' };

// What each action means for the log. Anything not listed counts as accepted.
const OUTCOME_FOR_ACTION = { dismiss: 'dismissed', change_target: 'edited', edit: 'edited' };

const handlers = {};      // type -> { actionKey: fn(suggestion) }
const live = {};          // card id -> suggestion, so a click can find it again

export function registerSuggestionHandler(type, actions) {
    handlers[type] = Object.assign(handlers[type] || {}, actions || {});
}

export function suggestionCardHtml(s) {
    if (!s || !s.id) return '';
    live[s.id] = s;
    const color = TYPE_COLORS[s.type] || '#9aa7bd';
    const rows = (s.rows || []).map(([k, v]) =>
        `<div style="font-size:13px;"><span class="muted">${esc(k)}</span> ${v}</div>`).join('');
    const actions = (s.actions || []).map((a) =>
        `<button class="btn tiny ${a.primary ? 'primary' : 'soft'}" onclick="OL.suggestionAction('${esc(s.id)}','${esc(a.key)}')" style="display:inline-flex;align-items:center;gap:6px;">`
        + `${a.icon ? `<i data-lucide="${esc(a.icon)}" style="width:13px;height:13px;"></i>` : ''}${esc(a.label)}</button>`).join('');
    return `
    <div id="sg-card-${esc(s.id)}" style="border:1px solid var(--line);border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:8px;background:var(--panel);">
        <div style="display:flex;align-items:center;gap:8px;">
            ${s.n ? `<span style="width:22px;height:22px;border-radius:50%;background:rgba(45,212,191,.14);color:#2dd4bf;display:inline-flex;align-items:center;justify-content:center;font-weight:700;font-size:12px;">${esc(s.n)}</span>` : ''}
            <span class="pill tiny" style="background:${color}22;color:${color};border:1px solid transparent;cursor:default;">${esc(SUGGESTION_TYPE_LABELS[s.type] || s.type)}</span>
            <span style="margin-left:auto;" class="pill tiny soft">${esc(CONFIDENCE_LABEL[s.confidence] || '')}</span>
        </div>
        ${s.quote ? `<div style="border-left:3px solid var(--line);padding:2px 0 2px 10px;font-size:13px;font-style:italic;" class="muted">"${esc(s.quote)}"</div>` : ''}
        ${rows ? `<div style="display:flex;flex-direction:column;gap:3px;">${rows}</div>` : ''}
        <div style="display:flex;gap:8px;flex-wrap:wrap;">${actions}</div>
    </div>`;
}

// Runs the feature's handler, logs what the person chose, and removes the card when the handler says it is done.
// A handler returns false to keep the card (for example when its own dialog was cancelled).
export async function suggestionAction(cardId, actionKey) {
    const s = live[cardId];
    if (!s) return;
    const fn = handlers[s.type]?.[actionKey];
    let result = true;
    try {
        if (typeof fn === 'function') result = await fn(s);
        else if (actionKey !== 'dismiss') { console.warn(`No handler for ${s.type}/${actionKey}`); return; }
    } catch (e) {
        console.error('Suggestion action failed:', e);
        alert('That did not work. Nothing was changed.');
        return;
    }
    if (result === false) return;
    if (s.logId) recordOutcome(s.logId, OUTCOME_FOR_ACTION[actionKey] || 'accepted', { decidedBy: getCurrentUserName?.() });
    delete live[cardId];
    const el = document.getElementById('sg-card-' + cardId);
    if (el) el.remove();
}

window.OL = window.OL || {};
Object.assign(window.OL, { suggestionCardHtml, suggestionAction, registerSuggestionHandler });
