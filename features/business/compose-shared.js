//======================= FEATURES / BUSINESS / COMPOSE (SHARED) =======================//
// Everything the email windows have in common, in one place. Each window (the main Compose / Reply window, the
// meeting summary email, the client follow-up email, the round-review notification) supplies only its TEMPLATE
// CONTENT — the subject, the opening message, any generated section, the closing, what sits in its sidebar and what
// happens after sending. Everything else is built here so the windows look and behave the same:
//
//   Signature    One signature per Sphynx team member (their card on the Sphynx Team page), used by every window.
//                Resolved in one order — the rich signature saved on the card, else the plain-text signature typed on
//                the card, else a default made from the card. Same include box, preview and "Edit my signature" in
//                every window (signaturePanelHtml), same block appended to every email (signatureParts).
//   Recipients   To / Cc (/ Bcc) chips that show names from the team cards, with a picker for the Sphynx team and the
//                project's people, or any typed address (initRecipients, recipientBoxHtml, getRecipients).
//   Layout       One stylesheet and one window shell (composeShellHtml): head, To/Cc, Subject, Message, an optional
//                generated middle section, an optional Closing, the signature, and the Send row, with an optional
//                sidebar. A window's DOM ids are all `${prefix}-…` (cf = client follow-up, ms = meeting summary,
//                rv = review notification, compose = the main window), so windows can be open at the same time.
//   Assembly     assembleEmail puts the parts together in the one standard order and returns the HTML and plain-text
//                versions; sendCompose sends them through the app's Gmail send function.
//
// Adding a new email window = call composeShellHtml with its content, initRecipients, and assembleEmail + sendCompose
// on Send. Nothing else to copy.

import { state, esc, updateAndSync } from '../../core/data.js';
import { greetingNames, joinNames, tidyEmailHtml } from '../../core/meeting-summary.js';
import { fillTemplate } from '../../core/ol-settings.js';

window.OL = window.OL || {};

const $ = (id) => document.getElementById(id);
const sanitize = (html) => (typeof OL.sanitizeCommentHtml === 'function' ? OL.sanitizeCommentHtml(html, { images: true }) : String(html || ''));
const toText = (html) => (typeof OL.htmlToPlainTextWithLinks === 'function' ? OL.htmlToPlainTextWithLinks(html)
    : typeof OL.htmlToPlainText === 'function' ? OL.htmlToPlainText(html) : String(html || '').replace(/<[^>]+>/g, ''));
const currentUserName = () => (typeof OL.getCurrentUserName === 'function' ? OL.getCurrentUserName() : (state.currentUser?.name || ''));

// ================================================================================================
// SIGNATURE
// ================================================================================================

export function myTeamCard() {
    const me = currentUserName();
    return (state.master?.sphynxTeam || []).find((m) => m.name === me) || null;
}

// The one place a signature is worked out. Order: the rich signature saved on the team card; else the plain-text
// signature typed on the card (Sphynx Team page); else a default built from the card's name, title and email.
export function signatureHtmlFor(card) {
    if (!card) return '';
    if (String(card.emailSignatureHtml || '').trim()) return sanitize(card.emailSignatureHtml);
    if (String(card.signature || '').trim()) return esc(String(card.signature).trim()).replace(/\r?\n/g, '<br>');
    return [`<strong>${esc(card.name || '')}</strong>`, card.title || card.role ? esc(card.title || card.role) : '', 'Sphynx Automation', card.email ? esc(card.email) : '']
        .filter(Boolean).join('<br>');
}
export const getMySignatureHtml = () => signatureHtmlFor(myTeamCard());

// The signature as it goes at the end of an email: { html, text }, both empty when it is switched off or there is none.
export function signatureParts(include = true, card = myTeamCard()) {
    const sig = include ? signatureHtmlFor(card) : '';
    if (!sig) return { html: '', text: '' };
    const plain = typeof OL.htmlToPlainText === 'function' ? OL.htmlToPlainText(sig) : sig.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '');
    return { html: `<div class="gmail_signature" style="color:#555;">--<br>${sig}</div>`, text: `--\n${plain}` };
}

// A template's closing wording ("Best,\n{sender}"). The signature carries the sender's name, so {sender} fills in as
// blank whenever a signature is going to be attached — older saved templates end in "{sender}" and would otherwise
// print the name twice — and the empty line that leaves behind is dropped.
export function fillClosing(text, vars = {}) {
    const hasSignature = !!signatureHtmlFor(myTeamCard());
    return fillTemplate(text, { ...vars, sender: hasSignature ? '' : (vars.sender || '') }).replace(/\s+$/, '');
}

// Saving from any editor goes through here, so the rich and plain versions on the card never drift apart.
export function saveSignatureFor(card, html) {
    if (!card) return false;
    const clean = sanitize(html);
    updateAndSync(() => {
        card.emailSignatureHtml = clean;
        card.signature = typeof OL.htmlToPlainText === 'function' ? OL.htmlToPlainText(clean) : clean.replace(/<[^>]+>/g, '');
    });
    return true;
}

// Which team card a signature panel is about: the signed-in person's (compose windows), or a specific member's
// (the Sphynx Team page passes memberId).
OL._sigCtx = OL._sigCtx || {};
const cardFor = (prefix) => {
    const memberId = OL._sigCtx[prefix]?.memberId;
    return memberId ? ((state.master?.sphynxTeam || []).find((m) => m.id === memberId) || null) : myTeamCard();
};

export function signatureIncluded(prefix) {
    const el = $(`${prefix}-sig-on`);
    return el ? el.checked : true;
}

// opts: { memberId, showInclude (default true) } — with memberId the panel edits that member's signature and has no
// include box (used on the Sphynx Team page).
export function signaturePanelHtml(prefix, opts = {}) {
    OL._sigCtx[prefix] = { memberId: opts.memberId || null };
    const showInclude = opts.showInclude !== false;
    return `
        <div id="${prefix}-sig-panel" style="padding:8px 10px; border:1px dashed var(--line); border-radius:6px; margin:0 0 10px 0;">
            <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
                ${showInclude ? `<label class="tiny" style="display:flex !important; align-items:center; gap:6px; cursor:pointer; margin:0 !important;">
                    <input type="checkbox" id="${prefix}-sig-on" checked style="width:auto !important; display:inline-block !important;" onchange="OL.sigRefresh('${prefix}')">
                    <span class="bold">Signature</span>
                </label>` : '<span class="tiny bold">Email signature</span>'}
                <button type="button" class="btn tiny soft" onclick="OL.sigEdit('${prefix}')">${opts.memberId ? 'Edit signature' : 'Edit my signature'}</button>
            </div>
            <div id="${prefix}-sig-preview" class="tiny muted ol-richtext-view" style="margin-top:6px;">${signaturePreviewInner(prefix)}</div>
        </div>`;
}

function signaturePreviewInner(prefix) {
    const card = cardFor(prefix);
    const on = signatureIncluded(prefix);
    if (!on) return '<em>Not included.</em>';
    const sig = signatureHtmlFor(card);
    return sig || '<em>No team card found for the signed-in account — add yourself on the Sphynx Team page to get a signature.</em>';
}

OL.sigRefresh = function(prefix) {
    const box = $(`${prefix}-sig-preview`);
    if (box) box.innerHTML = signaturePreviewInner(prefix);
};
OL.sigEdit = function(prefix) {
    const card = cardFor(prefix);
    const box = $(`${prefix}-sig-preview`);
    if (!card || !box) { alert('There is no Sphynx Team card for this account yet, so there is nowhere to save a signature. Add the person on the Sphynx Team page first.'); return; }
    box.innerHTML = `
        ${OL.renderRichTextField({ id: `${prefix}-sig-editor`, html: signatureHtmlFor(card), minHeight: 80, emailTools: true, imageMaxWidth: 300 })}
        <div style="display:flex; justify-content:flex-end; gap:6px; margin-top:4px;">
            <button type="button" class="btn tiny soft" onclick="OL.sigRefresh('${prefix}')">Cancel</button>
            <button type="button" class="btn tiny primary" onclick="OL.sigSave('${prefix}')">Save signature</button>
        </div>`;
    if (window.lucide) lucide.createIcons();
};
OL.sigSave = function(prefix) {
    const ed = $(`${prefix}-sig-editor`);
    if (!ed || !saveSignatureFor(cardFor(prefix), ed.innerHTML)) return;
    OL.sigRefresh(prefix);
    // Edited from the Sphynx Team page: refresh the cards behind the window so they show the new signature.
    if (OL._sigCtx[prefix]?.memberId && typeof OL.renderSphynxTeamPage === 'function') OL.renderSphynxTeamPage();
};

// ================================================================================================
// RECIPIENTS
// ================================================================================================

const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
const FIELD_LABELS = { to: 'To', cc: 'Cc', bcc: 'Bcc' };
const sameEmail = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
const emailsOf = (m) => [m.email, m.emailAddress, ...(Array.isArray(m.emails) ? m.emails : [])].filter(Boolean);

OL._rcpt = OL._rcpt || {};

// Addresses that count as "you": the connected Gmail account and the signed-in person's own address.
export function senderEmails() {
    const emails = [state.master?.communications?.gmail?.email];
    const me = currentUserName();
    if (me) (state.master?.sphynxTeam || []).forEach((m) => { if (m.name === me && m.email) emails.push(m.email); });
    return emails.filter(Boolean);
}

// The people offered in the picker, grouped: the project's people, then the Sphynx team, then any `extraGroups`
// ([label, [emails]] — e.g. who is on a meeting; only addresses not already listed by name). With no project, every
// project's people are offered.
export function personDirectory(client, extraGroups = []) {
    const list = [];
    const seen = new Set();
    const add = (name, emails, group) => emails.forEach((raw) => {
        const email = String(raw || '').trim();
        const key = email.toLowerCase();
        if (!EMAIL_RE.test(email) || seen.has(key)) return;
        seen.add(key);
        list.push({ name: name || '', email, group });
    });
    // People with names go in first, so an address that is also in an extra group keeps its name.
    const clients = client ? [client] : Object.values(state.clients || {}).filter((c) => c?.meta?.name);
    clients.forEach((c) => (c?.projectData?.teamMembers || []).forEach((m) => add(m.name, emailsOf(m), `${c.meta?.name || 'Client'} team`)));
    (state.master?.sphynxTeam || []).forEach((m) => add(m.name, emailsOf(m), 'Sphynx team'));
    extraGroups.forEach(([label, emails]) => (emails || []).forEach((e) => add('', [e], label)));
    return list;
}

// Who a project's email is addressed to: the primary contact, else the first team member with an email.
export function greetingContact(client) {
    const team = client?.projectData?.teamMembers || [];
    return team.find((m) => m.isPrimaryContact && m.email) || team.find((m) => m.email) || null;
}

// opts: { to: [], cc: [], bcc: [], directory: [], onChange: fn(prefix) } — call before the window's HTML is shown or
// straight after; then call renderRecipients for each field once the HTML is in the page.
export function initRecipients(prefix, opts = {}) {
    OL._rcpt[prefix] = {
        to: [...(opts.to || [])], cc: [...(opts.cc || [])], bcc: [...(opts.bcc || [])],
        directory: opts.directory || [], suggest: {}, onChange: typeof opts.onChange === 'function' ? opts.onChange : null,
    };
    return OL._rcpt[prefix];
}

export function recipientBoxHtml(prefix, field, label) {
    return `<div style="margin-bottom:10px;"><label class="tiny muted">${esc(label || FIELD_LABELS[field])}</label><div id="${prefix}-${field}-box"></div></div>`;
}

const nameForEmail = (prefix, email) => ((OL._rcpt[prefix]?.directory || []).find((p) => sameEmail(p.email, email)) || {}).name || '';
const changed = (prefix) => { try { OL._rcpt[prefix]?.onChange?.(prefix); } catch (e) { console.warn('Recipient change handler failed:', e); } };

export function renderRecipients(prefix, field) {
    const st = OL._rcpt[prefix];
    const box = $(`${prefix}-${field}-box`);
    if (!st || !box) return;
    const typed = $(`${prefix}-${field}-input`)?.value || '';
    const chips = st[field].map((email, i) => `
        <span title="${esc(email)}" style="display:inline-flex; align-items:center; gap:6px; padding:3px 6px 3px 10px; border-radius:999px; background:rgba(37,99,235,0.10); border:1px solid rgba(37,99,235,0.25); font-size:13px; line-height:1.3;">
            ${esc(nameForEmail(prefix, email) || email)}
            <button type="button" title="Remove" onclick="OL.rcptRemove('${prefix}', '${field}', ${i})"
                    style="border:none; background:transparent; cursor:pointer; padding:0 2px; font-size:13px; color:inherit; line-height:1;">✕</button>
        </span>`).join('');
    box.innerHTML = `
        <div style="position:relative; display:flex; flex-wrap:wrap; align-items:center; gap:6px; padding:6px 8px; border:1px solid var(--line); border-radius:12px; background:rgba(255,255,255,0.02);">
            ${chips}
            <input type="text" id="${prefix}-${field}-input" autocomplete="off" placeholder="${st[field].length ? 'Add another…' : 'Type a name or email…'}"
                   style="display:inline-block !important; width:auto !important; flex:1 1 160px; min-width:140px; border:none !important; background:transparent !important; box-shadow:none !important; outline:none; padding:5px 2px !important; margin:0 !important;"
                   oninput="OL.rcptShow('${prefix}', '${field}')" onfocus="OL.rcptShow('${prefix}', '${field}')"
                   onkeydown="OL.rcptKey('${prefix}', '${field}', event)" onblur="OL.rcptBlur('${prefix}', '${field}')">
            <button type="button" class="btn tiny soft" style="flex:0 0 auto;" onmousedown="event.preventDefault(); OL.rcptShow('${prefix}', '${field}', true)">+ Team</button>
            <div id="${prefix}-${field}-suggest" style="display:none; position:absolute; left:0; right:0; top:calc(100% + 4px); z-index:30; max-height:240px; overflow-y:auto; background:var(--bg-card, #ffffff); color:var(--text, inherit); border:1px solid var(--line); border-radius:10px; box-shadow:0 10px 24px rgba(0,0,0,0.18);"></div>
        </div>`;
    const input = $(`${prefix}-${field}-input`);
    if (input && typed) input.value = typed;
}

const hideSuggestions = (prefix, field) => { const p = $(`${prefix}-${field}-suggest`); if (p) p.style.display = 'none'; };

// Adds one address to a field. Returns false for something that is not an email address.
export function addRecipient(prefix, field, email) {
    const st = OL._rcpt[prefix];
    const clean = String(email || '').trim();
    if (!st || !st[field] || !EMAIL_RE.test(clean)) return false;
    if (!st[field].some((e) => sameEmail(e, clean))) { st[field].push(clean); changed(prefix); }
    if ($(`${prefix}-${field}-box`)) renderRecipients(prefix, field);
    return true;
}

// { to, cc, bcc } as the comma-separated strings the send function takes, plus the raw lists.
export function getRecipients(prefix) {
    const st = OL._rcpt[prefix] || { to: [], cc: [], bcc: [] };
    return { to: st.to.join(', '), cc: st.cc.join(', '), bcc: st.bcc.join(', '), toList: [...st.to], ccList: [...st.cc], bccList: [...st.bcc] };
}

// Turns whatever is typed but not yet a chip into chips (called before sending and when a field loses focus).
export function commitRecipients(prefix, fields) {
    const st = OL._rcpt[prefix];
    if (!st) return;
    (fields || ['to', 'cc', 'bcc']).forEach((field) => {
        const input = $(`${prefix}-${field}-input`);
        if (!input) return;
        const tokens = String(input.value || '').split(/[,;\s]+/).filter(Boolean);
        let added = 0;
        const left = [];
        tokens.forEach((t) => {
            const clean = t.trim();
            if (EMAIL_RE.test(clean)) { if (!st[field].some((e) => sameEmail(e, clean))) st[field].push(clean); added++; } else left.push(t);
        });
        input.value = left.join(' ');
        if (added) { renderRecipients(prefix, field); changed(prefix); }
    });
}

OL.rcptShow = function(prefix, field, showAll) {
    const st = OL._rcpt[prefix];
    const panel = $(`${prefix}-${field}-suggest`);
    if (!st || !panel) return;
    const typed = ($(`${prefix}-${field}-input`)?.value || '').trim();
    const q = showAll ? '' : typed.toLowerCase();
    const matches = st.directory
        .filter((p) => !st[field].some((e) => sameEmail(e, p.email)))
        .filter((p) => !q || `${p.name} ${p.email}`.toLowerCase().includes(q))
        .slice(0, 40);
    st.suggest[field] = matches;
    let html = '', lastGroup = '';
    matches.forEach((p, i) => {
        if (p.group !== lastGroup) {
            html += `<div style="padding:6px 12px 2px; font-size:11px; text-transform:uppercase; letter-spacing:.04em; opacity:.6;">${esc(p.group)}</div>`;
            lastGroup = p.group;
        }
        html += `<div onmousedown="event.preventDefault(); OL.rcptPick('${prefix}', '${field}', ${i})"
                      style="padding:7px 12px; cursor:pointer; font-size:13px;" onmouseover="this.style.background='rgba(37,99,235,0.08)'" onmouseout="this.style.background=''">
                    ${p.name ? `<strong>${esc(p.name)}</strong> <span style="opacity:.65;">${esc(p.email)}</span>` : esc(p.email)}
                 </div>`;
    });
    if (!matches.length) {
        html = `<div style="padding:8px 12px; font-size:13px; opacity:.75;">${EMAIL_RE.test(typed)
            ? `Press Enter to add <strong>${esc(typed)}</strong>`
            : (typed ? 'No one matches. Type a full email address and press Enter to add it.' : 'Everyone on the lists is already added.')}</div>`;
    }
    panel.innerHTML = html;
    panel.style.display = 'block';
};
OL.rcptRemove = function(prefix, field, index) {
    const st = OL._rcpt[prefix];
    if (!st || !st[field]) return;
    st[field].splice(index, 1);
    renderRecipients(prefix, field);
    changed(prefix);
};
OL.rcptPick = function(prefix, field, index) {
    const st = OL._rcpt[prefix];
    const person = st?.suggest?.[field]?.[index];
    if (!person) return;
    addRecipient(prefix, field, person.email);
    const input = $(`${prefix}-${field}-input`);
    if (input) input.value = '';
    $(`${prefix}-${field}-input`)?.focus?.();
    OL.rcptShow(prefix, field);
};
OL.rcptKey = function(prefix, field, ev) {
    const st = OL._rcpt[prefix];
    if (!st) return;
    const input = $(`${prefix}-${field}-input`);
    if (ev.key === 'Enter' || ev.key === ',' || ev.key === ';') {
        ev.preventDefault();
        if (!String(input?.value || '').trim()) return;
        const before = st[field].length;
        commitRecipients(prefix, [field]);
        if (String(input?.value || '').trim() && st[field].length === before) {
            const only = st.suggest?.[field];
            if (only && only.length === 1) { OL.rcptPick(prefix, field, 0); return; }
            alert('Enter a valid email address, or pick someone from the list.');
        }
    } else if (ev.key === 'Backspace' && !String(input?.value || '') && st[field].length) {
        st[field].pop();
        renderRecipients(prefix, field);
        changed(prefix);
        $(`${prefix}-${field}-input`)?.focus?.();
    } else if (ev.key === 'Escape') {
        hideSuggestions(prefix, field);
    }
};
OL.rcptBlur = function(prefix, field) {
    setTimeout(() => { commitRecipients(prefix, [field]); hideSuggestions(prefix, field); }, 150);
};

// The greeting is typed text, so it does not change by itself when the recipients change. This rewrites the first
// "Hi …," line of the message to name the people in To and leaves the rest (formatting, images, links) alone.
OL.composeRefreshGreeting = function(prefix) {
    const st = OL._rcpt[prefix];
    const box = $(`${prefix}-message`);
    if (!st || !box) return;
    const names = greetingNames(st.to, {
        sphynxEmails: (state.master?.sphynxTeam || []).map((m) => m.email).filter(Boolean),
        people: st.directory.filter((p) => p.name),
    });
    const greeting = esc(`Hi ${joinNames(names) || 'there'},`);
    const html = box.innerHTML;
    const m = html.match(/^((?:\s|<(?:div|p|span|b|strong|i|em|u)[^>]*>)*)\s*hi\b[^<]*/i);
    box.innerHTML = m ? m[1] + greeting + html.slice(m[0].length) : `${greeting}<br><br>${html}`;
};

// ================================================================================================
// LAYOUT
// ================================================================================================

export function composeStyles() {
    return `<style>
        /* One explicit stylesheet for every email window, so they look right whatever the app's default form styling is */
        .ol-compose label { display: block !important; margin: 0 0 4px !important; font-size: 12px !important; }
        .ol-compose input[type="text"], .ol-compose input[type="email"], .ol-compose input[type="date"], .ol-compose input[type="number"],
        .ol-compose select, .ol-compose textarea {
            display: block !important; width: 100% !important; box-sizing: border-box !important; margin: 0 !important;
            font-size: 13px !important; line-height: 1.45 !important; font-family: inherit !important;
        }
        .ol-compose textarea { resize: vertical; }
        .ol-compose pre { font-size: 13px !important; line-height: 1.55 !important; }
        .ol-compose-layout { display: grid; grid-template-columns: minmax(0, 1fr) var(--ol-compose-side, 340px); gap: 20px; align-items: start; box-sizing: border-box; max-width: 100%; }
        .ol-compose-layout.single { grid-template-columns: minmax(0, 1fr); }
        @media (max-width: 900px) {
            .ol-compose-layout { grid-template-columns: minmax(0, 1fr) !important; }
            .ol-compose-layout aside { position: static !important; max-height: none !important; }
        }
    </style>`;
}

// c: {
//   prefix, title, headBadgeHtml, headExtraHtml, closeAction ('OL.closeModal()'),
//   introHtml     — a note above the form (review window)
//   topHtml       — template-specific fields above the recipients (review dates)
//   fromHtml      — a "From …" line (main window)
//   toLabel, ccLabel, showBcc, recipientsExtraHtml (e.g. "suggested people" buttons)
//   subject
//   greeting      — false to hide the "Update greeting from recipients" button (default: shown)
//   messageHtml, messageMinHeight, messageToolbarHtml (e.g. the template picker), messageLabel
//   middleHtml    — a generated section shown under the message (Next steps, open items)
//   closingHtml   — undefined = no Closing field; a string (even '') = show one
//   signature     — false to leave the signature panel out (default: shown)
//   belowHtml     — extra sections under the signature (attachments, project link)
//   sidebarHtml, sidebarWidth
//   footerLeftHtml, footerButtonsHtml (before Cancel), sendAction, sendLabel
//   maxWidth      — width of the single-column window (default 820px)
// }
export function composeShellHtml(c) {
    const p = c.prefix;
    const close = c.closeAction || 'OL.closeModal()';
    const hasSidebar = !!c.sidebarHtml;
    const closing = c.closingHtml !== undefined && c.closingHtml !== null;
    return `
        ${composeStyles()}
        <div class="modal-head">
            <div class="modal-title-text">${esc(c.title || 'Email')}</div>
            ${c.headBadgeHtml || ''}
            <div class="spacer"></div>
            ${c.headExtraHtml || ''}
            <button class="btn small soft" onclick="${close}">Close</button>
        </div>
        <div class="modal-body ol-compose" style="max-width:${hasSidebar ? 'none' : (c.maxWidth || '820px')}; width:100%; box-sizing:border-box;">
            ${c.introHtml || ''}
            <div class="ol-compose-layout ${hasSidebar ? '' : 'single'}" ${c.sidebarWidth ? `style="--ol-compose-side:${Number(c.sidebarWidth)}px;"` : ''}>
                <div style="min-width:0;">
                    ${c.topHtml || ''}
                    ${c.fromHtml || ''}
                    ${recipientBoxHtml(p, 'to', c.toLabel)}
                    ${recipientBoxHtml(p, 'cc', c.ccLabel)}
                    ${c.showBcc ? recipientBoxHtml(p, 'bcc') : ''}
                    ${c.recipientsExtraHtml || ''}

                    <label class="tiny muted">Subject</label>
                    <input id="${p}-subject" type="text" class="modal-input" style="margin-bottom:12px;" value="${esc(c.subject || '')}">

                    <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:4px;">
                        <label class="tiny muted" style="margin:0 !important;">${esc(c.messageLabel || 'Message')}</label>
                        <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
                            ${c.messageToolbarHtml || ''}
                            ${c.greeting === false ? '' : `<button type="button" class="btn tiny soft" onclick="OL.composeRefreshGreeting('${p}')" title="Rewrites the first line to name the people in To">Update greeting from recipients</button>`}
                        </div>
                    </div>
                    <div style="margin-bottom:10px;">${OL.renderRichTextField({ id: `${p}-message`, html: c.messageHtml || '', minHeight: c.messageMinHeight || 200, grow: true, placeholder: c.messagePlaceholder || '', emailTools: true, imageMaxWidth: 600 })}</div>

                    ${c.middleHtml || ''}

                    ${closing ? `<label class="tiny muted">Closing</label>
                    <div style="margin-bottom:14px;">${OL.renderRichTextField({ id: `${p}-closing`, html: c.closingHtml, minHeight: 70, grow: true, emailTools: true, imageMaxWidth: 600 })}</div>` : ''}

                    ${c.signature === false ? '' : signaturePanelHtml(p)}

                    ${c.belowHtml || ''}

                    <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap; margin-top:14px;">
                        <div>${c.footerLeftHtml || ''}</div>
                        <div style="display:flex; justify-content:flex-end; gap:10px; flex-wrap:wrap;">
                            ${c.footerButtonsHtml || ''}
                            <button class="btn soft" onclick="${close}">Cancel</button>
                            <button id="${p}-send-btn" class="btn primary" onclick="${c.sendAction || ''}">${c.sendLabel || 'Send'}</button>
                        </div>
                    </div>
                </div>
                ${hasSidebar ? `<aside style="min-width:0; border:1px solid var(--line); border-radius:8px; padding:12px; background:rgba(56,189,248,0.03); position:sticky; top:0; max-height:calc(100vh - 150px); overflow-y:auto;">${c.sidebarHtml}</aside>` : ''}
            </div>
        </div>`;
}

// Shows the recipient chips once the window's HTML is in the page.
export function renderAllRecipients(prefix, fields = ['to', 'cc']) {
    fields.forEach((f) => renderRecipients(prefix, f));
}

// ================================================================================================
// ASSEMBLY AND SENDING
// ================================================================================================

// Puts an email together in the one standard order: message, generated section(s), closing, files/extra, signature,
// then a quoted original. Each part is optional. Returns the HTML and plain-text versions.
//   parts: { messageHtml, sectionsHtml, sectionsText, closingHtml, extraHtml, extraText, signature: {html, text},
//            quotedHtml, quotedText }
//   opts:  { gap } — what goes between HTML parts (default a blank line; the main window's parts carry their own margins)
export function assembleEmail(parts = {}, opts = {}) {
    const gap = opts.gap === undefined ? '<br><br>' : opts.gap;
    const messageText = toText(parts.messageHtml || '');
    const closingText = parts.closingHtml ? toText(parts.closingHtml) : '';
    const sig = parts.signature || { html: '', text: '' };
    const body = [parts.messageHtml, parts.sectionsHtml, parts.closingHtml, parts.extraHtml]
        .filter((s) => String(s || '').trim()).join(gap);
    const html = tidyEmailHtml(body) + (sig.html ? `<br>${sig.html}` : '') + (parts.quotedHtml || '');
    const text = [messageText, parts.sectionsText, closingText, parts.extraText, sig.text, parts.quotedText]
        .map((s) => String(s || '').trim()).filter(Boolean).join('\n\n');
    return { html, text, messageText, closingText };
}

// Reads a window built with composeShellHtml: recipients, subject, message and closing (both cleaned), and the
// signature choice — and returns them with the assembled email. Windows with their own generated section pass it in.
export function collectCompose(prefix, extra = {}, opts = {}) {
    commitRecipients(prefix);
    const r = getRecipients(prefix);
    const messageHtml = sanitize($(`${prefix}-message`)?.innerHTML || '');
    const closingHtml = $(`${prefix}-closing`) ? sanitize($(`${prefix}-closing`).innerHTML) : '';
    const signature = signatureParts(signatureIncluded(prefix));
    const built = assembleEmail({ messageHtml, closingHtml, signature, ...extra }, opts);
    return {
        to: r.to, cc: r.cc, bcc: r.bcc, subject: ($(`${prefix}-subject`)?.value || '').trim(),
        messageHtml, closingHtml, signature, body: built.text, bodyHtml: built.html, messageText: built.messageText, closingText: built.closingText,
    };
}

// Sends through the app's Gmail send function (same alerts as every window) and handles the Send button.
// `payload` is anything beyond the standard fields: linked_client_id, attachments, threadId, ...
export async function sendCompose(prefix, built, payload = {}) {
    const btn = $(`${prefix}-send-btn`);
    // Remember the button's own wording the first time, so a window that already set it to "Sending..." (while it
    // prepared an attachment, say) still gets the right label back if the send fails.
    if (btn && !btn.dataset.label) btn.dataset.label = btn.innerHTML;
    const label = btn ? (btn.dataset.label || 'Send') : 'Send';
    if (btn) { btn.disabled = true; btn.textContent = 'Sending...'; }
    const { ok, result } = await OL.sendGmailMessage({
        to: built.to, cc: built.cc || undefined, bcc: built.bcc || undefined, subject: built.subject,
        body: built.body, bodyHtml: built.bodyHtml, ...payload,
    });
    if (!ok && btn) { btn.disabled = false; btn.innerHTML = label; }
    return { ok, result };
}

Object.assign(window.OL, {
    myTeamCard, signatureHtmlFor, getMySignatureHtml, signatureParts, fillClosing, saveSignatureFor, signatureIncluded, signaturePanelHtml,
    senderEmails, personDirectory, greetingContact, initRecipients, recipientBoxHtml, renderRecipients, renderAllRecipients,
    addRecipient, getRecipients, commitRecipients, composeStyles, composeShellHtml, assembleEmail, collectCompose, sendCompose,
    _myTeamCard: myTeamCard,   // the name the main window used before this module existed
});
