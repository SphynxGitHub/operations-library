//======================= FEATURES / CONTENT IDEAS =======================//
// A star on an app update (Dashboard) or an Intel Library entry saves it here as material for a newsletter, blog post or
// social post. The Content Ideas page (Business Manager) lists them: tag the channels, set a status, add notes, copy the text.
// Table content_ideas (migration 2026_11j). Every failed database call is shown to the person; nothing reports success it did not get.

import { db, state, esc } from '../core/data.js';

const OL = (window.OL = window.OL || {});
const CHANNELS = [{ key: 'newsletter', label: 'Newsletter' }, { key: 'blog', label: 'Blog' }, { key: 'social', label: 'Social' }];
const STATUSES = [{ key: 'idea', label: 'Idea' }, { key: 'drafted', label: 'Drafted' }, { key: 'published', label: 'Published' }];
const ic = (name, size = 12) => `<i data-lucide="${name}" style="width:${size}px;height:${size}px;vertical-align:-2px;"></i>`;
const whoAmI = () => (typeof OL.getCurrentUserName === 'function' ? OL.getCurrentUserName() : '') || state.currentUser?.name || 'Sphynx Team';
const canUse = () => !window.IS_GUEST && (state.adminMode === true || state.teamMemberMode === true);
const fail = (msg) => { try { if (typeof OL.showToast === 'function') OL.showToast(msg); else alert(msg); } catch (e) { alert(msg); } };

OL.contentState = { rows: [], loaded: false, error: '', channel: '', status: '', q: '' };

OL.loadContentIdeas = async function () {
    const { data, error } = await db.from('content_ideas').select('*').order('created_at', { ascending: false }).limit(2000);
    if (error) { OL.contentState.error = `Content ideas could not be loaded: ${error.message}`; throw new Error(OL.contentState.error); }
    OL.contentState.rows = data || [];
    OL.contentState.loaded = true;
    OL.contentState.error = '';
};

OL.contentIdeaIsStarred = (type, key) => OL.contentState.rows.some((r) => r.source_type === type && r.source_key === key);

// Star button HTML. item: { type, key, title, details, sourceUrl, apps:[name] }; the item is looked up again by key on click.
OL.starButton = function (item) {
    if (!canUse()) return '';
    const on = OL.contentIdeaIsStarred(item.type, item.key);
    OL._starItems = OL._starItems || {};
    const id = `${item.type}:${item.key}`;
    OL._starItems[id] = item;
    return `<button type="button" class="btn tiny soft" title="${on ? 'Remove from content ideas' : 'Save as a content idea'}" onclick="event.stopPropagation(); OL.toggleContentIdea('${esc(id).replace(/'/g, '&#39;')}')" style="padding:2px 6px;">
        <i data-lucide="star" style="width:13px;height:13px;vertical-align:-2px;${on ? 'fill:#f5b942;color:#f5b942;' : ''}"></i></button>`;
};

OL.toggleContentIdea = async function (id) {
    const item = (OL._starItems || {})[id];
    if (!item) { fail('That item could not be found. Reload the page and try again.'); throw new Error('Unknown star item'); }
    try {
        if (!OL.contentState.loaded) await OL.loadContentIdeas();
        const existing = OL.contentState.rows.find((r) => r.source_type === item.type && r.source_key === item.key);
        if (existing) {
            const hasWork = (existing.channels || []).length || existing.status !== 'idea' || existing.notes;
            if (hasWork && !confirm('This idea has channels, a status or notes. Remove it anyway?')) return;
            const { error } = await db.from('content_ideas').delete().eq('id', existing.id);
            if (error) throw new Error(error.message);
            OL.contentState.rows = OL.contentState.rows.filter((r) => r.id !== existing.id);
        } else {
            const row = { title: item.title, details: item.details || null, source_type: item.type, source_key: item.key, source_url: item.sourceUrl || null,
                apps: (item.apps || []).map((n) => ({ name: n })), created_by: whoAmI() };
            const { data, error } = await db.from('content_ideas').insert(row).select().single();
            if (error) throw new Error(error.message);
            OL.contentState.rows.unshift(data);
        }
    } catch (e) { fail(`Content idea not saved: ${e.message}`); throw e; }
    if (typeof OL.dashRepaintModules === 'function') OL.dashRepaintModules();
    if (location.hash.startsWith('#/business/intel') && typeof OL._paintIntelLibrary === 'function') OL._paintIntelLibrary();
    if (location.hash.startsWith('#/business/content-ideas')) paint();
};

async function patch(id, fields) {
    const { data, error } = await db.from('content_ideas').update(fields).eq('id', id).select().single();
    if (error) { fail(`Not saved: ${error.message}`); throw new Error(error.message); }
    const i = OL.contentState.rows.findIndex((r) => r.id === id);
    if (i >= 0) OL.contentState.rows[i] = data;
}

OL.contentToggleChannel = async function (id, channel) {
    const r = OL.contentState.rows.find((x) => x.id === id);
    if (!r) throw new Error('Idea not found');
    const set = new Set(r.channels || []);
    set.has(channel) ? set.delete(channel) : set.add(channel);
    await patch(id, { channels: [...set] });
    paint();
};
OL.contentSetStatus = async function (id, status) { await patch(id, { status }); paint(); };
OL.contentSaveNotes = async function (id, notes) {
    const r = OL.contentState.rows.find((x) => x.id === id);
    if (r && (r.notes || '') === notes.trim()) return;
    await patch(id, { notes: notes.trim() || null });
};
OL.contentDelete = async function (id) {
    if (!confirm('Delete this content idea?')) return;
    const { error } = await db.from('content_ideas').delete().eq('id', id);
    if (error) { fail(`Not deleted: ${error.message}`); throw new Error(error.message); }
    OL.contentState.rows = OL.contentState.rows.filter((r) => r.id !== id);
    paint();
};
OL.contentCopy = async function (id) {
    const r = OL.contentState.rows.find((x) => x.id === id);
    if (!r) throw new Error('Idea not found');
    const text = [r.title, r.details, r.source_url ? `Source: ${r.source_url}` : '', r.notes ? `Notes: ${r.notes}` : ''].filter(Boolean).join('\n\n');
    try { await navigator.clipboard.writeText(text); } catch (e) { fail('Could not copy to the clipboard.'); throw e; }
    if (typeof OL.showToast === 'function') OL.showToast('Copied.');
};

OL.openContentIdeaModal = function () {
    window.openModal(`
        <div class="modal-head" style="display:flex; align-items:center; gap:12px;"><b style="flex:1;">Add content idea</b><button class="btn small soft" onclick="OL.closeModal()">Close</button></div>
        <div class="modal-body" style="width:min(1000px, 92vw);">
            <label class="tiny muted">Title</label><input id="ci-title" class="modal-input" style="width:100%;">
            <label class="tiny muted" style="margin-top:10px; display:block;">Details</label><textarea id="ci-details" class="modal-textarea" rows="6" style="width:100%;"></textarea>
            <div style="display:flex; gap:14px; margin-top:10px;">${CHANNELS.map((c) => `<label class="tiny" style="display:flex; gap:5px; align-items:center;"><input type="checkbox" class="ci-channel" value="${c.key}"> ${c.label}</label>`).join('')}</div>
            <div id="ci-error" class="tiny" style="color:#ef4444; margin-top:8px;"></div>
            <div style="margin-top:12px; text-align:right;"><button class="btn primary" onclick="OL.saveManualContentIdea()">Save</button></div>
        </div>`);
};
OL.saveManualContentIdea = async function () {
    const err = document.getElementById('ci-error');
    const title = document.getElementById('ci-title').value.trim();
    if (!title) { err.textContent = 'A title is required.'; return; }
    const channels = [...document.querySelectorAll('.ci-channel:checked')].map((c) => c.value);
    const { data, error } = await db.from('content_ideas').insert({ title, details: document.getElementById('ci-details').value.trim() || null, channels, source_type: 'manual', created_by: whoAmI() }).select().single();
    if (error) { err.textContent = `Not saved: ${error.message}`; throw new Error(error.message); }
    OL.contentState.rows.unshift(data);
    OL.closeModal();
    paint();
};

OL.setContentFilter = function (key, value) {
    OL.contentState[key] = value;
    paint();
    if (key === 'q') { const el = document.getElementById('ci-search'); if (el) { el.focus(); el.setSelectionRange(value.length, value.length); } }
};

function card(r) {
    const when = r.created_at ? new Date(r.created_at).toLocaleDateString([], { dateStyle: 'medium' }) : '';
    const from = r.source_type === 'app_update' ? 'App update' : r.source_type === 'intel' ? 'Intel Library' : 'Added by hand';
    return `<div class="card" style="padding:12px 14px;">
        <div style="display:flex; gap:12px; align-items:flex-start;">
            <div style="flex:1; min-width:0;">
                <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;"><span style="font-weight:700; font-size:14px;">${esc(r.title)}</span>
                    ${(r.apps || []).map((a) => `<span class="tiny" style="padding:1px 7px; border-radius:999px; border:1px solid var(--line);">${esc(a.name)}</span>`).join('')}</div>
                ${r.details ? `<div style="margin-top:6px; font-size:13px; white-space:pre-wrap; line-height:1.45;">${esc(r.details)}</div>` : ''}
                <div style="margin-top:6px; display:flex; gap:12px; align-items:center; flex-wrap:wrap;">
                    ${r.source_url ? `<a class="tiny" href="${esc(r.source_url)}" target="_blank" rel="noopener">Source</a>` : ''}
                    <span class="tiny muted">${esc(from)} · ${esc(r.created_by || '')} · ${esc(when)}</span></div>
                <div style="margin-top:8px; display:flex; gap:6px; flex-wrap:wrap; align-items:center;">
                    ${CHANNELS.map((c) => { const on = (r.channels || []).includes(c.key); return `<button class="btn tiny ${on ? 'primary' : 'soft'}" onclick="OL.contentToggleChannel('${esc(r.id)}','${c.key}')">${c.label}</button>`; }).join('')}
                    <select class="modal-input tiny" style="width:auto;" onchange="OL.contentSetStatus('${esc(r.id)}', this.value)">${STATUSES.map((s) => `<option value="${s.key}" ${r.status === s.key ? 'selected' : ''}>${s.label}</option>`).join('')}</select>
                </div>
                <textarea class="modal-textarea" rows="2" style="width:100%; margin-top:8px;" placeholder="Notes: angle, audience, draft link..." onblur="OL.contentSaveNotes('${esc(r.id)}', this.value)">${esc(r.notes || '')}</textarea>
            </div>
            <div style="display:flex; gap:6px;"><button class="btn tiny soft" onclick="OL.contentCopy('${esc(r.id)}')">${ic('copy', 11)} Copy</button><button class="btn tiny soft" onclick="OL.contentDelete('${esc(r.id)}')">Delete</button></div>
        </div></div>`;
}

function paint() {
    const main = document.getElementById('mainContent');
    if (!main) return;
    const st = OL.contentState;
    const q = st.q.trim().toLowerCase();
    const rows = st.rows.filter((r) => (!st.channel || (r.channels || []).includes(st.channel)) && (!st.status || r.status === st.status)
        && (!q || [r.title, r.details, r.notes, ...(r.apps || []).map((a) => a.name)].some((t) => String(t || '').toLowerCase().includes(q))));
    main.innerHTML = `
        <div class="section-header" style="display:flex; align-items:center; gap:12px;">
            ${ic('star', 24)}
            <div style="flex:1;"><h2 style="margin:0;">Content Ideas</h2>
                <div class="small muted subheader">Starred items for the newsletter, blog and social posts. ${st.rows.length} idea${st.rows.length === 1 ? '' : 's'}.</div></div>
            <div class="header-actions"><button class="btn primary" onclick="OL.openContentIdeaModal()">${ic('plus')} Add idea</button></div>
        </div>
        ${st.error ? `<div class="card" style="padding:12px 14px; margin:10px 0; border-color:#ef4444; color:#ef4444;">${esc(st.error)}</div>` : ''}
        <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin:12px 0;">
            <input id="ci-search" class="modal-input tiny" style="flex:1; min-width:200px; max-width:360px;" placeholder="Search ideas..." value="${esc(st.q)}" oninput="OL.setContentFilter('q', this.value)">
            <select class="modal-input tiny" style="width:auto;" onchange="OL.setContentFilter('channel', this.value)"><option value="">All channels</option>${CHANNELS.map((c) => `<option value="${c.key}" ${st.channel === c.key ? 'selected' : ''}>${c.label}</option>`).join('')}</select>
            <select class="modal-input tiny" style="width:auto;" onchange="OL.setContentFilter('status', this.value)"><option value="">All statuses</option>${STATUSES.map((s) => `<option value="${s.key}" ${st.status === s.key ? 'selected' : ''}>${s.label}</option>`).join('')}</select>
        </div>
        <div style="display:grid; gap:10px; grid-template-columns:minmax(0,1fr);">${rows.length ? rows.map(card).join('') : `<div class="muted" style="padding:24px; text-align:center;">${st.rows.length ? 'Nothing matches these filters.' : 'No content ideas yet. Click the star on an app update or an Intel Library entry, or add one by hand.'}</div>`}</div>`;
    if (window.lucide) window.lucide.createIcons();
}

OL.renderContentIdeas = async function () {
    const main = document.getElementById('mainContent');
    if (!main) return;
    main.style.cssText = '';
    document.body.classList.remove('is-visualizer');
    if (!OL.contentState.loaded) {
        main.innerHTML = `<div class="section-header"><h2 style="margin:0;">Content Ideas</h2></div><div class="muted" style="padding:20px;">Loading...</div>`;
        try { await OL.loadContentIdeas(); } catch (e) { console.error(e); }
    }
    paint();
};
