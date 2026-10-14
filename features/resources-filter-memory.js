// ================================================================================================
// FILE: features/resources-filter-memory.js
//
// WHAT IT DOES:   Remembers the Resources page filters (search, type, app, assignee, scoping, logic, party, updated,
//                 updated-since, and Show / Hide Archived) in this browser, per client (and per Vault), so they are
//                 still set after navigating away, opening a resource, or reloading. "Group by", "Then by" and the sort
//                 already remember themselves (resources-grid.js).
//
// HOW:            The page builds its filter controls fresh on every render, so this watches for them to appear, puts the
//                 saved values back, and re-runs the filter once. After that, every run of OL.syncResourceLibraryFilters
//                 saves what the controls hold (so clearing a filter is remembered too).
// ================================================================================================

import { state } from '../core/data.js';

const KEY = 'ol_resource_filters_v1';
const IDS = [
  'lib-filter-input', 'lib-filter-type', 'lib-filter-app', 'lib-filter-data-tag', 'lib-filter-assignee', 'lib-filter-scoped',
  'lib-filter-logic', 'lib-filter-scoping-status', 'lib-filter-party', 'lib-filter-updated', 'lib-filter-updated-since',
];

const scopeKey = () => `${state.activeClientId || 'none'}${window.location.hash.includes('vault') ? ':vault' : ''}`;
const readAll = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; } };
const writeAll = (all) => { try { localStorage.setItem(KEY, JSON.stringify(all)); } catch (e) { /* not remembered */ } };

function save() {
  const input = document.getElementById('lib-filter-input');
  if (!input || input.dataset.fmReady !== '1') return;   // the page's own first run (blank controls) must not overwrite what was saved
  const vals = {};
  IDS.forEach((id) => { const el = document.getElementById(id); if (el && el.value) vals[id] = el.value; });
  vals.showArchived = !!state.showArchivedResources;
  const all = readAll(); all[scopeKey()] = vals; writeAll(all);
}

let wrapped = false;
function wrapSync() {
  if (wrapped || !window.OL || typeof window.OL.syncResourceLibraryFilters !== 'function') return;
  const orig = window.OL.syncResourceLibraryFilters;
  window.OL.syncResourceLibraryFilters = function (...args) { const r = orig.apply(this, args); try { save(); } catch (e) { /* ignore */ } return r; };
  wrapped = true;
}

let queued = false;
function restoreWhenReady() {
  if (queued) return; queued = true;
  requestAnimationFrame(() => {
    queued = false;
    const input = document.getElementById('lib-filter-input');
    if (!input || input.dataset.fmReady === '1') return;
    wrapSync();
    const saved = readAll()[scopeKey()] || {};
    let changed = false;
    IDS.forEach((id) => {
      const el = document.getElementById(id); const v = saved[id];
      if (!el || !v) return;
      if (el.tagName === 'SELECT' && ![...el.options].some((o) => o.value === v)) return;   // that option no longer exists
      if (el.value !== v) { el.value = v; changed = true; }
    });
    if (saved['lib-filter-input']) state.libSearch = saved['lib-filter-input'];
    input.dataset.fmReady = '1';
    // Show / Hide Archived is a page-wide toggle that rebuilds the page, so it is put back before anything else
    if (typeof saved.showArchived === 'boolean' && !!state.showArchivedResources !== saved.showArchived && !window.__olFmArchived) {
      window.__olFmArchived = true;
      state.showArchivedResources = saved.showArchived;
      const re = window.OL && (window.OL.renderResourceManager || window.renderResourceManager);
      if (typeof re === 'function') { re(); return; }
    }
    if (changed && window.OL && typeof window.OL.syncResourceLibraryFilters === 'function') window.OL.syncResourceLibraryFilters();
  });
}

// the Show / Hide Archived button flips state, then rebuilds the page; remember the new value afterwards
document.addEventListener('click', (e) => {
  const b = e.target && e.target.closest && e.target.closest('button');
  if (b && /archived/i.test(b.textContent || '') && document.getElementById('lib-filter-input')) setTimeout(() => { const all = readAll(); const k = scopeKey(); all[k] = Object.assign({}, all[k], { showArchived: !!state.showArchivedResources }); writeAll(all); }, 0);
}, true);

new MutationObserver(restoreWhenReady).observe(document.body || document.documentElement, { childList: true, subtree: true });
restoreWhenReady();
