import { signIn, signOut, getSession, loadTasks, loadProfile, saveEntry, recentEntries, store } from './api.js';
import { PORTAL_URL } from './config.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let tasks = [];
let selected = null;
let clockTimer = null;
let profile = null;

function show(id) { ['login', 'app'].forEach((x) => $(x).classList.toggle('hidden', x !== id)); }

async function boot() {
  const s = await getSession();
  if (!s) { show('login'); $('who').textContent = ''; return; }
  show('app');
  try { profile = await loadProfile(); $('who').textContent = profile.name; } catch (e) { handleErr(e); }
  await renderRunning();
  await refreshTasks(false);
  await renderRecent();
  chrome.runtime.sendMessage({ type: 'flush' }).catch(() => {});
}

function handleErr(e) {
  if (String(e?.message) === 'signed_out') { show('login'); return; }
  $('app-err').textContent = e?.message || String(e);
}

// ---- tasks ----
async function refreshTasks(force) {
  try { tasks = await loadTasks(force); renderResults(); }
  catch (e) { handleErr(e); $('results').innerHTML = '<div class="muted">Could not load tasks.</div>'; }
}

function renderResults() {
  const q = $('search').value.trim().toLowerCase();
  const mineOnly = $('mine').checked;
  const me = (profile?.name || '').toLowerCase();
  let list = tasks.filter((t) => !q || t.title.toLowerCase().includes(q) || t.clientName.toLowerCase().includes(q));
  if (mineOnly && me) {
    const mine = list.filter((t) => t.assignee.toLowerCase() === me || t.assignee === 'Sphynx Task');
    if (mine.length || !q) list = mine;
  }
  list = list.slice(0, 60);
  $('results').innerHTML = list.length ? list.map((t, i) => `
      <div class="task ${selected && selected.taskId === t.taskId ? 'sel' : ''}" data-i="${i}">
        <div>${esc(t.title)}</div>
        <div class="p">${esc(t.clientName)}${t.status ? ' · ' + esc(t.status) : ''}${t.dueDate ? ' · due ' + esc(String(t.dueDate).slice(0, 10)) : ''}</div>
      </div>`).join('') : '<div class="muted">No matching open tasks.</div>';
  [...$('results').querySelectorAll('.task')].forEach((el) => el.addEventListener('click', () => {
    selected = list[Number(el.dataset.i)];
    $('start').disabled = false; $('log-manual').disabled = false;
    renderResults();
  }));
}

// ---- running timer ----
async function renderRunning() {
  const running = await store.get('running');
  $('running').classList.toggle('hidden', !running);
  $('picker').classList.toggle('hidden', !!running);
  clearInterval(clockTimer);
  if (!running) return;
  $('run-title').textContent = running.title;
  $('run-project').textContent = running.clientName;
  $('run-note').value = running.note || '';
  const tick = () => {
    const s = Math.floor((Date.now() - running.startedAt) / 1000);
    $('clock').textContent = `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };
  tick(); clockTimer = setInterval(tick, 1000);
}

async function start() {
  if (!selected) return;
  await store.set('running', { ...selected, startedAt: Date.now(), note: '' });
  chrome.runtime.sendMessage({ type: 'refreshBadge' }).catch(() => {});
  await renderRunning();
}

async function stop() {
  const running = await store.get('running');
  if (!running) return;
  const trim = Math.max(0, Number($('trim').value) || 0);
  const endedAt = Date.now() - trim * 60000;
  const minutes = Math.round((endedAt - running.startedAt) / 60000);
  if (minutes < 1) {
    if (!confirm('Less than a minute — discard instead of logging?')) return;
    return discard(true);
  }
  if (minutes > 10 * 60 && !confirm(`That's ${(minutes / 60).toFixed(1)} hours. Log it all?`)) return;
  const entry = {
    client_id: running.clientId, task_id: running.taskId, task_title: running.title,
    started_at: new Date(running.startedAt).toISOString(), ended_at: new Date(endedAt).toISOString(),
    minutes, note: $('run-note').value.trim() || null
  };
  try { await saveEntry(entry); }
  catch (e) {
    // Keep it and retry in the background — never lose time.
    const q = (await store.get('pendingEntries')) || [];
    q.push(entry); await store.set('pendingEntries', q);
    $('app-err').textContent = `Saved offline (${e.message}); it will upload automatically.`;
  }
  await store.del('running');
  $('trim').value = 0;
  chrome.runtime.sendMessage({ type: 'refreshBadge' }).catch(() => {});
  await renderRunning();
  await renderRecent();
}

async function discard(skipConfirm) {
  if (!skipConfirm && !confirm('Discard this timer without logging?')) return;
  await store.del('running');
  chrome.runtime.sendMessage({ type: 'refreshBadge' }).catch(() => {});
  await renderRunning();
}

async function logManual() {
  if (!selected) return;
  const minutes = (Number($('man-h').value) || 0) * 60 + (Number($('man-m').value) || 0);
  if (minutes < 1) { $('app-err').textContent = 'Enter some time first.'; return; }
  const now = new Date();
  try {
    await saveEntry({ client_id: selected.clientId, task_id: selected.taskId, task_title: selected.title,
      started_at: new Date(now - minutes * 60000).toISOString(), ended_at: now.toISOString(), minutes, note: $('man-note').value.trim() || null });
    $('man-h').value = ''; $('man-m').value = ''; $('man-note').value = '';
    await renderRecent();
  } catch (e) { handleErr(e); }
}

async function renderRecent() {
  try {
    const rows = await recentEntries();
    const pending = (await store.get('pendingEntries')) || [];
    $('recent').innerHTML = [
      ...pending.map((e) => `<div class="entry"><span>${esc(e.task_title)}</span><span>${e.minutes}m · waiting to upload</span></div>`),
      ...(rows || []).map((e) => `<div class="entry"><span>${esc(e.task_title)}</span><span>${e.minutes}m · ${e.applied ? 'on task ✓' : 'syncing to task…'}</span></div>`)
    ].join('') || '<div class="muted">Nothing logged yet.</div>';
  } catch (e) { handleErr(e); }
}

// ---- wiring ----
$('signin').addEventListener('click', async () => {
  $('login-err').textContent = '';
  try { await signIn($('email').value.trim(), $('password').value); await boot(); }
  catch (e) { $('login-err').textContent = e.message; }
});
$('password').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('signin').click(); });
$('signout').addEventListener('click', async () => { await signOut(); boot(); });
$('search').addEventListener('input', renderResults);
$('mine').addEventListener('change', renderResults);
$('reload').addEventListener('click', () => refreshTasks(true));
$('start').addEventListener('click', start);
$('stop').addEventListener('click', stop);
$('discard').addEventListener('click', () => discard(false));
$('log-manual').addEventListener('click', logManual);
$('run-note').addEventListener('change', async () => {
  const r = await store.get('running'); if (r) { r.note = $('run-note').value; await store.set('running', r); }
});
$('open-portal').addEventListener('click', () => chrome.tabs.create({ url: PORTAL_URL }));

boot();
