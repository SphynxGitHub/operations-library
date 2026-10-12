import { esc, uid, state, db, updateAndSync, getBusinessScopedClients, scopeQueryToBusinessClients } from '../../core/data.js';
import { linksForTask } from '../../core/task-links.js';
import { requestResourceIds } from '../../core/request-pricing.js';

// ============================================================================
// TO FILE QUEUE
// Linked email excerpts / attachments, task + request comments and task files that have not been filed to a resource
// yet. Status lives on the item itself (fileStatus: undefined = Open, 'filed', 'dismissed', 'kept'), so no schema
// change is needed: email items keep it inside gmail_messages.piece_links (jsonb), the rest inside project data.
// ============================================================================

const ic = (n) => `<i data-lucide="${n}" style="width:13px;height:13px;vertical-align:-2px;"></i>`;
const dayStr = (d) => { try { return new Date(d).toISOString().slice(0, 10); } catch (e) { return ''; } };
const daysAgo = (n) => dayStr(Date.now() - n * 86400000);
const TAGS = ['Change', 'Decision', 'Question', 'FYI'];
const TYPE_LABEL = { email: 'Whole email', excerpt: 'Email excerpt', attachment: 'Attachment', comment: 'Comment', file: 'Task file' };
const TYPE_ICON = { email: 'mail', excerpt: 'quote', attachment: 'paperclip', comment: 'message-square', file: 'file' };

OL.toFileState = OL.toFileState || {
    emails: [], loadedEmails: false, loading: false,
    items: [],
    f: { status: 'open', client: '', request: '', type: '', from: daysAgo(30), q: '' },
    selected: new Set(),
    dlg: null,
};

const S = () => OL.toFileState;
// Automatic housekeeping comments written by the work rules: nothing to file.
const isAutoComment = (cm) => /^\s*(closed automatically|due date\b.*\b(removed|restored)\b|all the related client tasks are complete)/i.test(String(cm?.text || ''));

async function ensureEmails() {
    const st = S();
    if (st.loadedEmails) return;
    // Whole-email links (the older linked_* columns) are included too. Their filing state lives in file_status /
    // filed_to (see the 2026_10_to_file_whole_emails.sql migration); without it only excerpts and attachments show.
    const base = 'id, subject, snippet, sender, date, linked_client_id, linked_task_id, linked_resource_id, linked_request_id, linked_event_id, piece_links';
    const run = (cols, orFilter) => scopeQueryToBusinessClients(db.from('gmail_messages').select(cols)
        .not('linked_client_id', 'is', null).or(orFilter).order('date', { ascending: false }).limit(2000));
    const anyLink = 'piece_links.not.is.null,linked_task_id.not.is.null,linked_resource_id.not.is.null,linked_request_id.not.is.null,linked_event_id.not.is.null';
    let res = await run(`${base}, file_status, filed_to`, anyLink);
    st.wholeOk = !res.error;
    if (res.error) res = await run(base, 'piece_links.not.is.null');
    st.emails = (res.data || []).filter((m) => (Array.isArray(m.piece_links) && m.piece_links.length) || (st.wholeOk && (m.linked_task_id || m.linked_resource_id || m.linked_request_id || m.linked_event_id)));
    st.loadedEmails = true;
}

async function ensureClientsLoaded() {
    const ids = getBusinessScopedClients().map((c) => c.id)
        .filter((id) => { const c = state.clients?.[id]; return !c || c._metaOnly || !c.projectData; });
    const only = S().f.client;
    const need = only ? ids.filter((id) => id === only) : ids;
    for (let i = 0; i < need.length; i += 5) {
        await Promise.all(need.slice(i, i + 5).map((id) => (OL.loadFullClient ? OL.loadFullClient(id).catch(() => {}) : null)));
    }
}

function requestsForResource(client, resId) {
    const out = [];
    (client?.projectData?.scopingSheets || []).forEach((sh) => (sh?.lineItems || []).forEach((it) => {
        if (requestResourceIds(it).includes(String(resId))) out.push(String(it.id));
    }));
    return out;
}

function buildItems() {
    const items = [];
    const clients = getBusinessScopedClients();
    const clientName = (id) => state.clients?.[id]?.meta?.name || id;
    // Email pieces
    S().emails.forEach((m) => {
        const client = state.clients?.[m.linked_client_id];
        if (S().wholeOk && (m.linked_task_id || m.linked_resource_id || m.linked_request_id || m.linked_event_id)) {
            let wr = [];
            if (m.linked_request_id) wr.push(String(m.linked_request_id));
            if (m.linked_task_id) { const t = (client?.projectData?.clientTasks || []).find((x) => String(x.id) === String(m.linked_task_id)); if (t) linksForTask(t).forEach((x) => x.requestId && wr.push(String(x.requestId))); }
            if (m.linked_resource_id) wr = wr.concat(requestsForResource(client, m.linked_resource_id));
            items.push({ key: `w:${m.id}`, src: 'email', whole: true, msgId: m.id, pieceIds: [], clientId: m.linked_client_id, requestIds: [...new Set(wr)], type: 'email',
                text: `${m.subject || '(no subject)'}${m.snippet ? ` — ${m.snippet}` : ''}`, from: m.subject || '(no subject)', author: m.sender, date: m.date,
                status: m.file_status || 'open', filedTo: m.filed_to || '' });
        }
        const grouped = new Map();   // one entry per excerpt / attachment, however many targets it is linked to
        (m.piece_links || []).forEach((l) => {
            if (!l || !l.id) return;
            let reqs = [];
            if (l.targetType === 'request') reqs = [String(l.targetId)];
            else if (l.targetType === 'task') {
                const t = (client?.projectData?.clientTasks || []).find((x) => String(x.id) === String(l.targetId));
                reqs = t ? linksForTask(t).map((x) => String(x.requestId)).filter(Boolean) : [];
            } else if (l.targetType === 'resource') reqs = requestsForResource(client, l.targetId);
            const isAtt = l.kind === 'attachment';
            const gk = isAtt ? `a|${l.attachmentPath || l.text}` : `x|${String(l.text || '').replace(/\s+/g, ' ').trim().toLowerCase()}`;
            const prev = grouped.get(gk);
            if (prev) {
                prev.pieceIds.push(l.id);
                reqs.forEach((r) => { if (!prev.requestIds.includes(r)) prev.requestIds.push(r); });
                if (!(l.fileStatus) ) { prev.status = 'open'; prev.filedTo = ''; }
                return;
            }
            const item = {
                key: `e:${m.id}:${l.id}`, src: 'email', attPath: isAtt ? l.attachmentPath : '', msgId: m.id, pieceId: l.id, pieceIds: [l.id], clientId: m.linked_client_id, requestIds: reqs,
                type: isAtt ? 'attachment' : 'excerpt',
                text: isAtt ? (l.text || String(l.attachmentPath || '').split('/').pop()) : (l.text || ''),
                from: m.subject || '(no subject)', date: l.createdAt || m.date, status: l.fileStatus || 'open', filedTo: l.filedTo || '',
            };
            grouped.set(gk, item); items.push(item);
        });
    });
    // Comments + files from project data
    const fileSeen = new Map();
    clients.forEach((c) => {
        const pd = c.projectData; if (!pd) return;
        (pd.clientTasks || []).forEach((t) => {
            if (!t) return;
            const reqs = linksForTask(t).map((x) => String(x.requestId)).filter(Boolean);
            if (typeof OL._findCommentHost === 'function' && Array.isArray(t.comments) && t.comments.length) OL._findCommentHost(c, t.id);
            (t.comments || []).forEach((cm) => {
                if (!cm?.id || !String(cm.text || '').trim() || cm.system || isAutoComment(cm)) return;
                items.push({ key: `c:${t.id}:${cm.id}`, src: 'comment', hostId: t.id, commentId: cm.id, clientId: c.id, requestIds: reqs, type: 'comment',
                    html: cm.html, text: cm.text, from: `Task: ${t.title || t.name || ''}`, date: cm.date, author: cm.author, status: cm.fileStatus || 'open', filedTo: cm.filedTo || '' });
            });
            (t.driveFiles || []).forEach((f) => {
                if (!f?.id) return;
                const fk = `${c.id}|${f.url || f.name}`;
                const seenF = fileSeen.get(fk);
                if (seenF) {
                    seenF.refs.push({ hostId: t.id, fileId: f.id });
                    reqs.forEach((r) => { if (!seenF.requestIds.includes(r)) seenF.requestIds.push(r); });
                    if (!f.fileStatus) { seenF.status = 'open'; seenF.filedTo = ''; }
                    return;
                }
                const fi = ({ key: `f:${t.id}:${f.id}`, src: 'file', refs: [{ hostId: t.id, fileId: f.id }], hostId: t.id, fileId: f.id, clientId: c.id, requestIds: reqs, type: 'file',
                    text: f.name || 'File', url: f.url, from: `Task: ${t.title || t.name || ''}`, date: f.addedAt || f.date || t.createdAt, status: f.fileStatus || 'open', filedTo: f.filedTo || '' });
                fileSeen.set(fk, fi); items.push(fi);
            });
        });
        (pd.scopingSheets || []).forEach((sh) => (sh?.lineItems || []).forEach((it) => {
            if (!it) return;
            if (typeof OL._findCommentHost === 'function' && Array.isArray(it.comments) && it.comments.length) OL._findCommentHost(c, it.id);
            (it.comments || []).forEach((cm) => {
                if (!cm?.id || !String(cm.text || '').trim() || cm.system || isAutoComment(cm)) return;
                items.push({ key: `c:${it.id}:${cm.id}`, src: 'comment', hostId: it.id, commentId: cm.id, clientId: c.id, requestIds: [String(it.id)], type: 'comment',
                    html: cm.html, text: cm.text, from: `Request: ${OL.requestItemTitle ? OL.requestItemTitle(c, it) : (it.title || it.name || '')}`, date: cm.date, author: cm.author, status: cm.fileStatus || 'open', filedTo: cm.filedTo || '' });
            });
        }));
    });
    items.forEach((i) => { i.clientName = clientName(i.clientId); });
    S().items = items;
}

function visible() {
    const f = S().f; const q = f.q.trim().toLowerCase();
    return S().items.filter((i) => {
        if (f.status !== 'all' && i.status !== f.status && !(f.status === 'dismissed' && i.status === 'kept')) return false;
        if (f.client && i.clientId !== f.client) return false;
        if (f.request && !i.requestIds.includes(f.request)) return false;
        if (f.type && i.type !== f.type) return false;
        if (f.from && dayStr(i.date) && dayStr(i.date) < f.from) return false;
        if (q && !(`${i.text} ${i.from} ${i.clientName}`.toLowerCase().includes(q))) return false;
        return true;
    }).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
}

OL.renderToFileQueue = async function() {
    const main = document.getElementById('mainContent'); if (!main) return;
    const st = S();
    if (!st.loading && !st.rendered) {
        st.loading = true;
        main.innerHTML = `<div class="p-20 muted text-center">Loading the queue…</div>`;
        try { await ensureEmails(); await ensureClientsLoaded(); buildItems(); } catch (e) { console.warn('To file load failed', e); }
        st.loading = false; st.rendered = true;
    }
    OL._paintToFile();
};

OL.reloadToFile = async function() {
    const st = S(); st.loadedEmails = false; st.rendered = false; st.selected = new Set();
    OL.renderToFileQueue();
};

OL._paintToFile = function() {
    const main = document.getElementById('mainContent'); if (!main) return;
    const st = S(); const f = st.f;
    buildItems();
    const list = visible();
    const clients = getBusinessScopedClients().slice().sort((a, b) => String(a.meta?.name || '').localeCompare(String(b.meta?.name || '')));
    const client = f.client ? state.clients?.[f.client] : null;
    const reqOpts = [];
    if (client) (client.projectData?.scopingSheets || []).forEach((sh) => (sh?.lineItems || []).forEach((it) => reqOpts.push({ id: String(it.id), title: OL.requestItemTitle ? OL.requestItemTitle(client, it) : (it.title || it.name || '') })));
    const sel = (v, cur) => (String(v) === String(cur) ? 'selected' : '');
    const counts = { open: 0, filed: 0, dismissed: 0 };
    st.items.forEach((i) => { counts[i.status === 'kept' ? 'dismissed' : i.status] = (counts[i.status === 'kept' ? 'dismissed' : i.status] || 0) + 1; });
    const nSel = [...st.selected].filter((k) => list.some((i) => i.key === k)).length;
    const row = (i) => {
        const reqNames = (state.clients?.[i.clientId] && i.requestIds.length)
            ? i.requestIds.map((id) => { const c = state.clients[i.clientId]; const it = OL.findRequestItem ? OL.findRequestItem(c, id) : null; return it ? (OL.requestItemTitle ? OL.requestItemTitle(c, it) : it.title) : ''; }).filter(Boolean) : [];
        const badge = i.status === 'filed' ? `<span class="pill tiny soft" style="background:rgba(41,151,100,.2);">Filed</span>` : i.status === 'dismissed' ? `<span class="pill tiny soft">Dismissed</span>` : i.status === 'kept' ? `<span class="pill tiny soft">Kept on request</span>` : '';
        return `<div class="card" style="padding:10px 12px; display:grid; grid-template-columns:auto minmax(0,1fr) auto; gap:12px; align-items:start;">
            <input type="checkbox" ${st.selected.has(i.key) ? 'checked' : ''} onchange="OL.toFileToggle('${esc(i.key)}', this.checked)" style="margin-top:3px;">
            <div style="min-width:0;">
                <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center; margin-bottom:4px;">
                    <span class="pill tiny soft" style="cursor:pointer;" onclick="OL.navigateToClientProject('${esc(i.clientId)}')">${esc(i.clientName)}</span>
                    <span class="pill tiny soft">${ic(TYPE_ICON[i.type])} ${TYPE_LABEL[i.type]}</span>
                    ${reqNames.map((n) => `<span class="pill tiny soft">${ic('git-pull-request')} ${esc(n)}</span>`).join('')}
                    ${badge}
                    <span class="muted tiny">${esc(dayStr(i.date))}${i.author ? ' · ' + esc(i.author) : ''} · ${esc(i.from)}</span>
                </div>
                <div style="${i.html ? '' : 'white-space:pre-wrap;'} overflow-wrap:anywhere; font-size:13px; ${i.type === 'excerpt' ? 'border-left:3px solid var(--accent); padding-left:8px;' : ''}">${bodyHtml(i)}</div>
                <div style="display:flex; gap:10px; margin-top:6px; flex-wrap:wrap;">
                    ${i.src === 'email' ? `<a href="javascript:void(0)" class="tiny" onclick="OL.openGmailMessageModal('${esc(i.msgId)}')">${ic('mail-open')} Open full thread</a>` : ''}
                    ${i.type === 'attachment' && i.attPath ? `<a href="javascript:void(0)" class="tiny" onclick="OL.toFilePreview('${esc(i.key)}')">${ic('eye')} Preview</a>` : ''}
                    ${i.type === 'file' && i.url ? `<a href="${esc(i.url)}" target="_blank" rel="noopener" class="tiny">${ic('external-link')} Open file</a>` : ''}
                </div>
                ${i.filedTo ? `<div class="muted tiny" style="margin-top:4px;">Filed to ${esc(i.filedTo)}</div>` : ''}
            </div>
            <div style="display:flex; gap:6px;">
                ${i.status === 'open' ? `<button class="btn tiny primary" onclick="OL.toFileOpenDialog(['${esc(i.key)}'])">File</button><button class="btn tiny soft" onclick="OL.toFileDismiss(['${esc(i.key)}'])">Dismiss</button>`
                    : `<button class="btn tiny soft" onclick="OL.toFileReopen(['${esc(i.key)}'])">Reopen</button>`}
            </div>
        </div>`;
    };
    main.innerHTML = `
    <div style="width:100%; box-sizing:border-box;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; gap:10px; flex-wrap:wrap;">
            <h2 style="margin:0;">To File</h2>
            <button class="btn tiny soft" onclick="OL.reloadToFile()">${ic('refresh-cw')} Refresh</button>
        </div>
        <div class="muted tiny" style="margin-bottom:12px;">Linked email excerpts, attachments, comments and task files that haven't been filed to a resource yet. ${counts.open} open · ${counts.filed} filed · ${counts.dismissed} dismissed</div>
        <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:12px;">
            <select class="modal-input" style="width:auto;" onchange="OL.toFileSetFilter('status', this.value)">
                <option value="open" ${sel('open', f.status)}>Open</option><option value="filed" ${sel('filed', f.status)}>Filed</option>
                <option value="dismissed" ${sel('dismissed', f.status)}>Dismissed</option><option value="all" ${sel('all', f.status)}>All</option></select>
            <select class="modal-input" style="width:auto; max-width:240px;" onchange="OL.toFileSetFilter('client', this.value)">
                <option value="">All projects</option>${clients.map((c) => `<option value="${esc(c.id)}" ${sel(c.id, f.client)}>${esc(c.meta?.name || c.id)}</option>`).join('')}</select>
            <select class="modal-input" style="width:auto; max-width:260px;" ${client ? '' : 'disabled'} onchange="OL.toFileSetFilter('request', this.value)">
                <option value="">${client ? 'All requests' : 'Pick a project for requests'}</option>${reqOpts.map((r) => `<option value="${esc(r.id)}" ${sel(r.id, f.request)}>${esc(r.title)}</option>`).join('')}</select>
            <select class="modal-input" style="width:auto;" onchange="OL.toFileSetFilter('type', this.value)">
                <option value="">All types</option>${Object.keys(TYPE_LABEL).map((k) => `<option value="${k}" ${sel(k, f.type)}>${TYPE_LABEL[k]}</option>`).join('')}</select>
            <label class="muted tiny" style="display:flex; align-items:center; gap:6px;">Since <input type="date" class="modal-input" style="width:auto;" value="${esc(f.from)}" onchange="OL.toFileSetFilter('from', this.value)"></label>
            <input class="modal-input" style="flex:1; min-width:180px;" placeholder="Search…" value="${esc(f.q)}" oninput="OL.toFileSearch(this.value)">
        </div>
        <div style="display:flex; gap:8px; align-items:center; margin-bottom:10px; flex-wrap:wrap;">
            <label class="tiny" style="display:flex; align-items:center; gap:6px;"><input type="checkbox" onchange="OL.toFileSelectAll(this.checked)" ${nSel && nSel === list.length ? 'checked' : ''}> Select all (${list.length})</label>
            ${nSel ? `<span class="muted tiny">${nSel} selected</span>
                <button class="btn tiny primary" onclick="OL.toFileOpenDialog()">${ic('folder-input')} File to resources…</button>
                <button class="btn tiny soft" onclick="OL.toFileMakeTasks()">${ic('check-square')} Turn into tasks</button>
                <button class="btn tiny soft" onclick="OL.toFileKeep()">Keep on request only</button>
                <button class="btn tiny soft" onclick="OL.toFileDismiss()">Dismiss</button>` : ''}
        </div>
        <div style="display:grid; gap:8px;">${list.length ? list.map(row).join('') : `<div class="p-20 muted text-center">Nothing here for these filters.</div>`}</div>
    </div>`;
    if (window.lucide) window.lucide.createIcons();
};

// Plain text with links made clickable; comments written with the rich editor keep their own links.
const linkify = (t) => esc(t).replace(/(https?:\/\/[^\s<]+)/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`);
function bodyHtml(i) {
    if (i.html && typeof OL.sanitizeCommentHtml === 'function') return OL.sanitizeCommentHtml(i.html).replace(/<a /g, '<a target="_blank" rel="noopener" ');
    const t = String(i.text);
    return linkify(t.slice(0, 900)) + (t.length > 900 ? '…' : '');
}

OL.toFilePreview = async function(key) {
    const i = S().items.find((x) => x.key === key); if (!i?.attPath) return;
    const url = await OL.getGmailAttachmentUrl(i.attPath); if (!url) return;
    const ext = String(i.attPath).split('.').pop().toLowerCase();
    const name = esc(i.text || i.attPath.split('/').pop());
    const body = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext) ? `<img src="${esc(url)}" style="max-width:100%; max-height:75vh; display:block; margin:0 auto;">`
        : ext === 'pdf' ? `<iframe src="${esc(url)}" style="width:100%; height:75vh; border:1px solid var(--line); border-radius:6px;"></iframe>`
        : `<div class="muted" style="padding:30px; text-align:center;">No inline preview for .${esc(ext)} files. Use Open to view or download it.</div>`;
    OL.showOverlayModal(`<div style="width:100%; box-sizing:border-box;"><div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; gap:10px;"><h3 style="margin:0; overflow-wrap:anywhere;">${name}</h3>
        <div style="display:flex; gap:8px;"><a class="btn tiny soft" href="${esc(url)}" target="_blank" rel="noopener">Open</a><button class="btn tiny soft" onclick="OL.closeModal()">Close</button></div></div>${body}</div>`, { wide: true });
};

let _searchT;
OL.toFileSearch = (v) => { S().f.q = v; clearTimeout(_searchT); _searchT = setTimeout(() => { OL._paintToFile(); const el = document.querySelector('#mainContent input[placeholder="Search…"]'); if (el) { el.focus(); el.setSelectionRange(v.length, v.length); } }, 250); };
OL.toFileSetFilter = async function(k, v) {
    const f = S().f; f[k] = v;
    if (k === 'client') { f.request = ''; if (v) { await ensureClientsLoaded(); } }
    OL._paintToFile();
};
OL.toFileToggle = (key, on) => { on ? S().selected.add(key) : S().selected.delete(key); OL._paintToFile(); };
OL.toFileSelectAll = (on) => { const s = S(); visible().forEach((i) => { on ? s.selected.add(i.key) : s.selected.delete(i.key); }); OL._paintToFile(); };

const itemsFor = (keys) => { const set = new Set(keys || [...S().selected]); return S().items.filter((i) => set.has(i.key)); };

// Write a status onto the underlying record.
async function setStatus(items, status, filedTo) {
    const patch = (o) => { if (status === 'open') { delete o.fileStatus; delete o.filedTo; delete o.filedAt; } else { o.fileStatus = status; o.filedAt = new Date().toISOString(); if (filedTo) o.filedTo = filedTo; } };
    // Emails: one read-modify-write per message.
    const byMsg = {};
    items.filter((i) => i.src === 'email').forEach((i) => { (byMsg[i.msgId] = byMsg[i.msgId] || []).push(i); });
    for (const [msgId, arr] of Object.entries(byMsg)) {
        const whole = arr.find((i) => i.whole);
        if (whole) {
            await db.from('gmail_messages').update({ file_status: status === 'open' ? null : status, filed_to: status === 'open' ? null : (filedTo || null) }).eq('id', msgId);
            const cachedW = S().emails.find((e) => e.id === msgId); if (cachedW) { cachedW.file_status = status === 'open' ? null : status; cachedW.filed_to = filedTo || null; }
            if (arr.length === 1) continue;
        }
        const { data: m } = await db.from('gmail_messages').select('piece_links').eq('id', msgId).single();
        const links = (m?.piece_links || []).map((l) => { if (arr.some((i) => (i.pieceIds || []).includes(l.id))) { const c = { ...l }; patch(c); return c; } return l; });
        await db.from('gmail_messages').update({ piece_links: links }).eq('id', msgId);
        const cached = S().emails.find((e) => e.id === msgId); if (cached) cached.piece_links = links;
    }
    const byClient = {};
    items.filter((i) => i.src !== 'email').forEach((i) => { (byClient[i.clientId] = byClient[i.clientId] || []).push(i); });
    for (const [clientId, arr] of Object.entries(byClient)) {
        updateAndSync(() => {
            arr.forEach((i) => {
                const host = OL._findCommentHost(clientId, i.hostId); if (!host) return;
                if (i.src === 'comment') { const obj = (host.comments || []).find((c) => c.id === i.commentId); if (obj) patch(obj); return; }
                (i.refs || [{ hostId: i.hostId, fileId: i.fileId }]).forEach((r) => {
                    const h = OL._findCommentHost(clientId, r.hostId);
                    const obj = (h?.driveFiles || []).find((f) => f.id === r.fileId); if (obj) patch(obj);
                });
            });
        }, clientId);
    }
}

async function afterChange() { S().selected = new Set(); OL._paintToFile(); }

OL.toFileDismiss = async function(keys) { const it = itemsFor(keys).filter((i) => i.status === 'open'); await setStatus(it, 'dismissed'); afterChange(); };
OL.toFileKeep = async function(keys) { const it = itemsFor(keys).filter((i) => i.status === 'open'); await setStatus(it, 'kept'); afterChange(); };
OL.toFileReopen = async function(keys) { await setStatus(itemsFor(keys), 'open'); afterChange(); };

OL.toFileMakeTasks = async function(keys) {
    const items = itemsFor(keys).filter((i) => i.status === 'open'); if (!items.length) return;
    const who = (OL.getCurrentUserName ? OL.getCurrentUserName() : '') || 'Arielle Minicozzi';
    const byClient = {};
    items.forEach((i) => { (byClient[i.clientId] = byClient[i.clientId] || []).push(i); });
    for (const [clientId, arr] of Object.entries(byClient)) {
        updateAndSync(() => {
            const pd = state.clients?.[clientId]?.projectData; if (!pd) return;
            if (!Array.isArray(pd.clientTasks)) pd.clientTasks = [];
            arr.forEach((i) => {
                const title = String(i.text).replace(/\s+/g, ' ').trim().slice(0, 80) || 'Follow up';
                pd.clientTasks.unshift({ id: uid(), title, name: title, description: `From ${TYPE_LABEL[i.type].toLowerCase()} (${i.from}):\n${i.text}`,
                    status: 'Pending Sphynx Action', assignee: who, dueDate: '', isClientTask: false, loggedHours: 0, parentTaskId: null,
                    createdAt: new Date().toISOString(), links: i.requestIds.map((rid) => ({ requestId: rid, resourceIds: [] })) });
            });
        }, clientId);
    }
    await setStatus(items, 'filed', 'a new task');
    afterChange();
};

// ---------------------------------------------------------------- filing dialog
OL.toFileOpenDialog = function(keys) {
    const items = itemsFor(keys).filter((i) => i.status === 'open'); if (!items.length) return;
    const clientIds = [...new Set(items.map((i) => i.clientId))];
    if (clientIds.length > 1) { alert('The selected items are from different projects. Filter to one project first, then file them together.'); return; }
    const client = state.clients?.[clientIds[0]];
    const resources = (client?.projectData?.localResources || []).filter(Boolean);
    const pre = new Set();
    items.forEach((i) => i.requestIds.forEach((rid) => {
        const it = OL.findRequestItem ? OL.findRequestItem(client, rid) : null;
        requestResourceIds(it).forEach((id) => pre.add(String(id)));
    }));
    S().dlg = { keys: items.map((i) => i.key), clientId: clientIds[0], chosen: pre, q: '', app: '', rtype: '', tag: '' };
    OL._paintToFileDialog();
};

OL._paintToFileDialog = function() {
    const d = S().dlg; if (!d) return;
    const client = state.clients?.[d.clientId];
    const all = (client?.projectData?.localResources || []).filter(Boolean);
    const apps = [...new Set(all.map((r) => r.appName).filter(Boolean))].sort();
    const rtypes = [...new Set(all.map((r) => r.type).filter(Boolean))].sort();
    const q = d.q.trim().toLowerCase();
    const list = all.filter((r) => (!d.app || r.appName === d.app) && (!d.rtype || r.type === d.rtype) && (!q || `${r.name || ''} ${r.appName || ''} ${r.type || ''}`.toLowerCase().includes(q)));
    const items = itemsFor(d.keys);
    const html = `<div style="width:100%; box-sizing:border-box;">
        <h3 style="margin:0 0 6px;">File ${items.length} item${items.length > 1 ? 's' : ''} to resources</h3>
        <div class="muted tiny" style="margin-bottom:10px;">Each item is added as a comment on every resource you tick, then marked Filed. The request's own resources are ticked for you.</div>
        <div style="display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1.4fr); gap:16px;">
            <div style="max-height:55vh; overflow:auto; display:grid; gap:6px; align-content:start;">
                ${items.map((i) => `<div class="card" style="padding:8px 10px; font-size:12px; overflow-wrap:anywhere;"><span class="muted tiny">${TYPE_LABEL[i.type]}</span><div>${esc(String(i.text).slice(0, 260))}</div></div>`).join('')}
            </div>
            <div>
                <div style="display:flex; gap:8px; margin-bottom:8px; flex-wrap:wrap;">
                    <input class="modal-input" style="flex:1; min-width:140px;" placeholder="Search resources…" value="${esc(d.q)}" oninput="OL.toFileDlg('q', this.value)">
                    <select class="modal-input" style="width:auto;" onchange="OL.toFileDlg('app', this.value)"><option value="">All apps</option>${apps.map((a) => `<option ${a === d.app ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select>
                    <select class="modal-input" style="width:auto;" onchange="OL.toFileDlg('rtype', this.value)"><option value="">All types</option>${rtypes.map((t) => `<option ${t === d.rtype ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
                    <select class="modal-input" style="width:auto;" onchange="OL.toFileDlg('tag', this.value)"><option value="">No tag</option>${TAGS.map((t) => `<option ${t === d.tag ? 'selected' : ''}>${t}</option>`).join('')}</select>
                </div>
                <div style="border:1px solid var(--line); border-radius:6px; padding:8px; margin-bottom:8px;">
                    ${d.newOpen ? `<div class="tiny muted" style="margin-bottom:4px;">New resource (required: name and type)</div>
                    <div style="display:flex; gap:6px; flex-wrap:wrap;">
                        <input id="tf-new-name" class="modal-input" style="flex:2; min-width:160px;" placeholder="Name, e.g. Intake form" value="${esc(d.newName || '')}" oninput="OL.toFileDlgNew('newName', this.value)">
                        <select id="tf-new-type" class="modal-input" style="flex:1; min-width:120px;" onchange="OL.toFileDlgNew('newType', this.value)"><option value="">Type…</option>${newTypeList().map((t) => `<option ${t === d.newType ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
                        <select class="modal-input" style="flex:1; min-width:120px;" onchange="OL.toFileDlgNew('newApp', this.value)"><option value="">App (optional)</option>${apps.map((a) => `<option ${a === d.newApp ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select>
                    </div>
                    <label class="tiny" style="display:flex; gap:6px; align-items:center; margin-top:6px;"><input type="checkbox" ${d.newLink === false ? '' : 'checked'} onchange="OL.toFileDlgNew('newLink', this.checked)"> Also add it to the request${items.some((i) => i.requestIds.length) ? '' : ' (these items have no request)'}</label>
                    <div style="display:flex; gap:6px; margin-top:6px;"><button class="btn tiny primary" onclick="OL.toFileCreateResource()">Create and tick it</button><button class="btn tiny soft" onclick="OL.toFileDlgNew('newOpen', false)">Cancel</button></div>`
                    : `<button class="btn tiny soft" onclick="OL.toFileDlgNew('newOpen', true)">${ic('plus')} New resource</button>`}
                </div>
                ${d.app ? `<button class="btn tiny soft" style="margin-bottom:8px;" onclick="OL.toFileDlgApp()">${ic('check-check')} Tick every ${esc(d.app)} resource</button>` : ''}
                <div style="max-height:46vh; overflow:auto; display:grid; gap:4px;">
                    ${list.map((r) => `<label style="display:flex; gap:8px; align-items:center; padding:6px 8px; border:1px solid var(--line); border-radius:6px; cursor:pointer;">
                        <input type="checkbox" ${d.chosen.has(String(r.id)) ? 'checked' : ''} onchange="OL.toFileDlgPick('${esc(r.id)}', this.checked)">
                        <span style="flex:1; min-width:0; overflow-wrap:anywhere;">${esc(r.name || 'Untitled')}</span>
                        ${r.appName ? `<span class="pill tiny soft">${esc(r.appName)}</span>` : ''}${r.type ? `<span class="pill tiny soft">${esc(r.type)}</span>` : ''}
                    </label>`).join('') || `<div class="muted tiny p-20">No resources match.</div>`}
                </div>
            </div>
        </div>
        <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:14px;">
            <button class="btn soft" onclick="OL.closeModal()">Cancel</button>
            <button class="btn primary" ${d.chosen.size ? '' : 'disabled'} onclick="OL.toFileDoFile()">File to ${d.chosen.size} resource${d.chosen.size === 1 ? '' : 's'}</button>
        </div></div>`;
    if (document.querySelector('.modal-box.modal-wide')) {
        const box = document.querySelector('.modal-box.modal-wide'); box.innerHTML = html;
    } else OL.showOverlayModal(html, { wide: true });
    if (window.lucide) window.lucide.createIcons();
};

function newTypeList() {
    const t = (state.master?.resourceTypes || []).map((x) => x.type).filter(Boolean);
    return t.length ? t : ['Zap', 'Form', 'Scheduler Event', 'Workflow', 'Reference', 'General'];
}
OL.toFileDlgNew = (k, v) => { const d = S().dlg; d[k] = v; if (k === 'newOpen' || k === 'newLink') OL._paintToFileDialog(); };
OL.toFileCreateResource = function() {
    const d = S().dlg; const name = String(d.newName || '').trim();
    if (!name) { alert('Give the resource a name.'); return; }
    if (!d.newType) { alert('Pick a type for the resource.'); return; }
    const id = `local-prj-${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const items = itemsFor(d.keys);
    updateAndSync(() => {
        const client = state.clients?.[d.clientId]; if (!client?.projectData) return;
        if (!Array.isArray(client.projectData.localResources)) client.projectData.localResources = [];
        client.projectData.localResources.push({ id, name, type: d.newType, archetype: 'Base', integration: null, data: {}, steps: [], triggers: [],
            createdDate: new Date().toISOString(), isShell: true, ...(d.newApp ? { appName: d.newApp } : {}) });
        if (d.newLink !== false) {
            const rids = new Set(items.flatMap((i) => i.requestIds));
            (client.projectData.scopingSheets || []).forEach((sh) => (sh?.lineItems || []).forEach((it) => {
                if (rids.has(String(it.id))) it.resourceIds = [...requestResourceIds(it), id];
            }));
        }
    }, d.clientId);
    d.chosen.add(id); d.newOpen = false; d.newName = ''; d.newType = ''; d.newApp = '';
    OL._paintToFileDialog();
};

OL.toFileDlg = (k, v) => { S().dlg[k] = v; if (k === 'q') { clearTimeout(_searchT); _searchT = setTimeout(() => { OL._paintToFileDialog(); const el = document.querySelector('.modal-wide input[placeholder="Search resources…"]'); if (el) { el.focus(); el.setSelectionRange(v.length, v.length); } }, 200); } else OL._paintToFileDialog(); };
OL.toFileDlgPick = (id, on) => { const d = S().dlg; on ? d.chosen.add(String(id)) : d.chosen.delete(String(id)); OL._paintToFileDialog(); };
OL.toFileDlgApp = () => {
    const d = S().dlg; const client = state.clients?.[d.clientId];
    (client?.projectData?.localResources || []).filter((r) => r && r.appName === d.app).forEach((r) => d.chosen.add(String(r.id)));
    OL._paintToFileDialog();
};

OL.toFileDoFile = async function() {
    const d = S().dlg; if (!d || !d.chosen.size) return;
    const items = itemsFor(d.keys);
    const author = (OL.getCurrentUserName ? OL.getCurrentUserName() : '') || 'Sphynx Team';
    const names = [];
    updateAndSync(() => {
        const client = state.clients?.[d.clientId];
        d.chosen.forEach((rid) => {
            const res = OL._findCommentHost(client, rid); if (!res) return;
            names.push(res.name || 'resource');
            if (!Array.isArray(res.comments)) res.comments = [];
            items.forEach((i) => {
                const body = `${d.tag ? `[${d.tag}] ` : ''}${i.text}\n— filed from ${TYPE_LABEL[i.type].toLowerCase()} (${i.from}, ${dayStr(i.date)})`;
                const html = i.html && typeof OL.sanitizeCommentHtml === 'function'
                    ? `${d.tag ? `<b>[${esc(d.tag)}]</b> ` : ''}${OL.sanitizeCommentHtml(i.html)}<div class="muted">— filed from ${esc(TYPE_LABEL[i.type].toLowerCase())} (${esc(i.from)}, ${dayStr(i.date)})</div>` : undefined;
                res.comments.push({ id: uid(), author, text: body, ...(html ? { html } : {}), date: new Date().toISOString(), filedFrom: i.key });
            });
        });
    }, d.clientId);
    await setStatus(items, 'filed', names.join(', '));
    S().dlg = null;
    OL.closeModal?.();
    afterChange();
};
