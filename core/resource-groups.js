//======================= CORE / RESOURCE GROUPS =======================//
// One way to show a long list of resources wherever a person has to pick one (the request window, linking an email,
// linking highlighted email text, attaching Master Library links to an email): grouped by type — Zap, Form, Email... —
// each group a collapsible section with a count, items in name order, and search that looks at the name, the type and
// the description. Pure functions plus two small HTML/DOM helpers, so every picker groups and searches the same way.

const isBlank = (v) => v === undefined || v === null || String(v).trim() === '';
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plain = (html) => String(html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ');

export const OTHER_GROUP = 'Other';

// The group a resource belongs in: its type, else its category, else "Other".
export function resourceGroupLabel(r) {
    const t = String(r?.type || r?.category || '').trim();
    return t || OTHER_GROUP;
}

// Everything a search looks through, lowercased. `extra` adds text the caller knows about (a project name, say).
export function resourceSearchText(r, extra = '') {
    return [r?.name, resourceGroupLabel(r), r?.description ? plain(r.description) : '', r?.emailSubject, extra]
        .filter((x) => !isBlank(x)).join(' ').toLowerCase();
}

// Every word typed has to appear somewhere ("zap intake" finds the Intake zap, not every zap).
export function matchesQuery(text, query) {
    const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
    return words.every((w) => text.includes(w));
}

// list -> [{ label, items }]. Groups run A-Z with "Other" last; items run A-Z by name.
//   opts.extra(r) -> extra searchable text     opts.keepOrder -> leave items in the order given
export function groupResources(list, query = '', opts = {}) {
    const groups = new Map();
    (list || []).forEach((r) => {
        if (!r) return;
        if (!isBlank(query) && !matchesQuery(resourceSearchText(r, opts.extra ? opts.extra(r) : ''), query)) return;
        const label = resourceGroupLabel(r);
        if (!groups.has(label)) groups.set(label, []);
        groups.get(label).push(r);
    });
    return [...groups.entries()]
        .sort(([a], [b]) => (a === OTHER_GROUP) - (b === OTHER_GROUP) || a.localeCompare(b))
        .map(([label, items]) => ({ label, items: opts.keepOrder ? items : items.slice().sort((x, y) => String(x.name || '').localeCompare(String(y.name || ''))) }));
}
export const flattenGroups = (groups) => groups.flatMap((g) => g.items);

// The groups as collapsible sections. itemHtml(resource, indexInTheFlatList) draws one row. Sections start open when
// something is being searched, when there is only one, or when the whole list is short.
export function groupsHtml(groups, itemHtml, { query = '', open: forceOpen, empty = 'No matching resources.', searchTextFor } = {}) {
    const total = groups.reduce((n, g) => n + g.items.length, 0);
    if (!total) return `<div class="tiny muted rg-empty" style="padding:8px;">${esc(empty)}</div>`;
    const open = forceOpen !== undefined ? forceOpen : (!isBlank(query) || groups.length === 1 || total <= 12);
    let i = 0;
    return groups.map((g) => `
        <details class="rg" ${open ? 'open' : ''} style="margin-bottom:6px;">
            <summary class="tiny bold" style="cursor:pointer; padding:4px 2px; user-select:none;">${esc(g.label)} <span class="muted" style="font-weight:400;">(${g.items.length})</span></summary>
            <div style="display:grid; gap:3px; margin:2px 0 4px 8px;">
                ${g.items.map((r) => `<div class="rg-item" ${searchTextFor ? `data-rg-search="${esc(searchTextFor(r))}"` : ''}>${itemHtml(r, i++)}</div>`).join('')}
            </div>
        </details>`).join('');
}

// Filters an already-drawn grouped list in place (no redraw, so nothing typed elsewhere in the window is lost). Rows need
// data-rg-search (see searchTextFor above). Sections with no match hide; while searching, matching sections open.
export function filterGroupsDom(root, query) {
    if (!root) return;
    const searching = !isBlank(query);
    let shown = 0;
    root.querySelectorAll('details.rg').forEach((d) => {
        let any = 0;
        d.querySelectorAll('.rg-item').forEach((row) => {
            const hit = matchesQuery(row.getAttribute('data-rg-search') || '', query);
            row.style.display = hit ? '' : 'none';
            if (hit) any++;
        });
        d.style.display = any ? '' : 'none';
        if (searching && any) d.open = true;
        shown += any;
    });
    let note = root.querySelector('.rg-none');
    if (!shown && root.querySelector('details.rg')) {
        if (!note) { note = root.ownerDocument.createElement('div'); note.className = 'tiny muted rg-none'; note.style.padding = '8px'; note.textContent = 'No matching resources.'; root.appendChild(note); }
    } else if (note) note.remove();
}
