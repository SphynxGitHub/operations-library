//======================= FEATURES / APP PRICING IMPORT =======================//
// Two admin tools on the Master App Vault:
//   Export app list  - downloads every master app (id, name, current tiers) so pricing can be researched outside the portal.
//   Import pricing   - takes a JSON file of researched pricing, shows what would change per app, and writes only the rows
//                      that are ticked. Nothing is saved until "Apply selected".
//
// Import format:  { "apps": [ { "id": "(optional)", "name": "Jotform", "sourceUrl": "https://...", "checkedAt": "YYYY-MM-DD",
//                   "tiers": [ { "name": "Bronze (per user)", "price": 39, "notes": "optional" } ] } ] }
// "price" is US dollars per month, per user where the vendor prices per user (say so in the tier name).

import { state, esc } from '../core/data.js';

const OL = (window.OL = window.OL || {});
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
let pending = [];   // rows being reviewed: { app, proposed, sourceUrl, checkedAt, before, selected }

function masterApps() {
    const apps = state.master?.apps;
    if (!Array.isArray(apps) || !apps.length) throw new Error('The Master App library is not loaded.');
    return apps;
}

OL.exportAppPricingList = function () {
    const apps = masterApps();
    const payload = { exportedAt: new Date().toISOString(), apps: apps.map((a) => ({ id: a.id, name: a.name || '', category: a.category || '', tiers: (a.pricingTiers || []).map((t) => ({ name: t.name, price: t.price })) })) };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'master-app-list.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
};

function parseImport(text) {
    let data;
    try { data = JSON.parse(text); } catch (e) { throw new Error(`That is not valid JSON: ${e.message}`); }
    const list = Array.isArray(data) ? data : data?.apps;
    if (!Array.isArray(list) || !list.length) throw new Error('Expected {"apps":[...]} with at least one app.');
    const apps = masterApps();
    return list.map((r, i) => {
        if (!r || !r.name) throw new Error(`Row ${i + 1} has no app name.`);
        if (!Array.isArray(r.tiers)) throw new Error(`${r.name}: "tiers" must be a list.`);
        const proposed = r.tiers.map((t, j) => {
            const price = Number(t.price);
            if (!t.name || !Number.isFinite(price) || price < 0) throw new Error(`${r.name}, tier ${j + 1}: needs a name and a price of 0 or more.`);
            return { name: String(t.name), price, ...(t.notes ? { notes: String(t.notes) } : {}) };
        });
        const app = apps.find((a) => r.id && String(a.id) === String(r.id)) || apps.find((a) => norm(a.name) === norm(r.name));
        const before = app ? (app.pricingTiers || []).map((t) => `${t.name}: $${t.price}`) : [];
        const after = proposed.map((t) => `${t.name}: $${t.price}`);
        const same = before.join('|') === after.join('|');
        return { app, name: r.name, proposed, sourceUrl: r.sourceUrl || '', checkedAt: r.checkedAt || '', before, after, same, selected: !!app && !same };
    });
}

function renderReview() {
    const el = document.getElementById('pricing-import-review');
    if (!el) return;
    el.innerHTML = `
        <table style="width:100%; border-collapse:collapse; font-size:12px;">
            <thead><tr style="text-align:left;" class="tiny muted"><th style="width:28px;"></th><th>App</th><th>Current tiers</th><th>Proposed tiers</th><th>Source</th></tr></thead>
            <tbody>${pending.map((r, i) => `
                <tr style="border-top:1px solid var(--line); vertical-align:top; ${r.app ? '' : 'opacity:.6;'}">
                    <td><input type="checkbox" ${r.selected ? 'checked' : ''} ${r.app ? '' : 'disabled'} onchange="OL.pricingImportToggle(${i}, this.checked)"></td>
                    <td><b>${esc(r.name)}</b>${r.app ? '' : '<div class="tiny" style="color:#ef4444;">Not found in Master Apps</div>'}${r.same ? '<div class="tiny muted">No change</div>' : ''}</td>
                    <td>${r.before.length ? r.before.map(esc).join('<br>') : '<span class="muted">None</span>'}</td>
                    <td>${r.after.length ? r.after.map(esc).join('<br>') : '<span class="muted">None</span>'}</td>
                    <td>${r.sourceUrl ? `<a href="${esc(r.sourceUrl)}" target="_blank" rel="noopener">Source</a>` : '<span class="muted">None</span>'}<div class="tiny muted">${esc(r.checkedAt)}</div></td>
                </tr>`).join('')}</tbody>
        </table>
        <div style="display:flex; gap:8px; align-items:center; margin-top:12px;">
            <span class="tiny muted">${pending.filter((r) => r.selected).length} selected. Ticked apps have their tiers replaced; unticked apps are left alone.</span>
            <button class="btn primary" style="margin-left:auto;" onclick="OL.pricingImportApply()">Apply selected</button>
        </div>`;
}

OL.openAppPricingImport = function () {
    pending = [];
    window.openModal(`
        <div class="modal-head" style="display:flex; align-items:center; gap:12px;">
            <b style="flex:1;">Import app pricing</b><button class="btn small soft" onclick="OL.closeModal()">Close</button>
        </div>
        <div class="modal-body" style="width:min(1100px, 92vw);">
            <div style="display:flex; gap:12px; align-items:flex-start;">
                <div style="flex:1; min-width:0;">
                    <label class="tiny muted">Paste the pricing JSON, or choose the file</label>
                    <textarea id="pricing-import-text" class="modal-textarea" rows="8" style="width:100%;" placeholder='{"apps":[{"name":"Jotform","sourceUrl":"https://...","checkedAt":"2026-11-19","tiers":[{"name":"Bronze","price":39}]}]}'></textarea>
                    <div style="display:flex; gap:8px; margin-top:8px; align-items:center;">
                        <input type="file" id="pricing-import-file" accept=".json,application/json" onchange="OL.pricingImportFile(this)">
                        <button class="btn small soft" onclick="OL.pricingImportLoadRepo()">Load latest researched pricing</button>
                        <button class="btn small soft" style="margin-left:auto;" onclick="OL.pricingImportPreview()">Review changes</button>
                    </div>
                    <div id="pricing-import-error" class="tiny" style="color:#ef4444; margin-top:6px;"></div>
                </div>
            </div>
            <div id="pricing-import-review" style="margin-top:16px;"></div>
        </div>`);
};

OL.pricingImportFile = function (input) {
    const f = input.files && input.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onerror = () => { document.getElementById('pricing-import-error').textContent = 'The file could not be read.'; };
    r.onload = () => { document.getElementById('pricing-import-text').value = String(r.result || ''); OL.pricingImportPreview(); };
    r.readAsText(f);
};

OL.pricingImportLoadRepo = async function () {
    const err = document.getElementById('pricing-import-error');
    err.textContent = '';
    try {
        const r = await fetch(`app-updates/pricing-backfill.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!r.ok) throw new Error(`The researched pricing file could not be loaded (${r.status}).`);
        const d = await r.json();
        const apps = (d.apps || []).filter((a) => Array.isArray(a.tiers) && a.tiers.length);
        if (!apps.length) throw new Error('The researched pricing file has no apps with tiers yet.');
        document.getElementById('pricing-import-text').value = JSON.stringify({ apps }, null, 2);
        OL.pricingImportPreview();
    } catch (e) { err.textContent = e.message; throw e; }
};

OL.pricingImportPreview = function () {
    const err = document.getElementById('pricing-import-error');
    err.textContent = '';
    try { pending = parseImport(document.getElementById('pricing-import-text').value); renderReview(); }
    catch (e) { pending = []; document.getElementById('pricing-import-review').innerHTML = ''; err.textContent = e.message; }
};

OL.pricingImportToggle = function (i, on) { if (pending[i]) { pending[i].selected = !!on; renderReview(); } };

OL.pricingImportApply = async function () {
    const err = document.getElementById('pricing-import-error');
    err.textContent = '';
    const rows = pending.filter((r) => r.selected && r.app);
    if (!rows.length) { err.textContent = 'Nothing is selected.'; return; }
    const undo = rows.map((r) => ({ app: r.app, tiers: r.app.pricingTiers, url: r.app.pricingSourceUrl, at: r.app.pricingCheckedAt }));
    try {
        rows.forEach((r) => {
            r.app.pricingTiers = JSON.parse(JSON.stringify(r.proposed));
            if (r.sourceUrl) r.app.pricingSourceUrl = r.sourceUrl;
            if (r.checkedAt) r.app.pricingCheckedAt = r.checkedAt;
        });
        await OL.persist();
    } catch (e) {
        undo.forEach((u) => { u.app.pricingTiers = u.tiers; u.app.pricingSourceUrl = u.url; u.app.pricingCheckedAt = u.at; });
        err.textContent = `Not saved: ${e.message || e}`;
        throw e;
    }
    if (typeof OL.closeModal === 'function') OL.closeModal();
    if (typeof OL.refreshActiveView === 'function') OL.refreshActiveView();
    if (typeof OL.showToast === 'function') OL.showToast(`Pricing applied to ${rows.length} app${rows.length === 1 ? '' : 's'}. A red notice will appear if the save fails.`);
};
