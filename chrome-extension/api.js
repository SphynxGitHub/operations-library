// Tiny Supabase client (no bundler, no remote code — MV3 doesn't allow it).
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const store = {
  get: (k) => chrome.storage.local.get(k).then((r) => r[k]),
  set: (k, v) => chrome.storage.local.set({ [k]: v }),
  del: (k) => chrome.storage.local.remove(k)
};
export { store };

async function authCall(grant, body) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=${grant}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error_description || data.msg || data.message || `Sign-in failed (${res.status})`);
  const session = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + (data.expires_in || 3600) * 1000,
    user: { id: data.user?.id, email: data.user?.email }
  };
  await store.set('session', session);
  return session;
}

export const signIn = (email, password) => authCall('password', { email, password });
export async function signOut() { await store.del('session'); await store.del('profile'); await store.del('taskCache'); }

export async function getSession() {
  const s = await store.get('session');
  if (!s) return null;
  if (Date.now() < s.expires_at - 60_000) return s;
  try { return await authCall('refresh_token', { refresh_token: s.refresh_token }); }
  catch { await store.del('session'); return null; }
}

export async function rest(path, { method = 'GET', body, headers = {} } = {}) {
  const s = await getSession();
  if (!s) throw new Error('signed_out');
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${s.access_token}`, 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined
  });
  if (res.status === 401) throw new Error('signed_out');
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.message || `Request failed (${res.status})`);
  return data;
}

// Your name as the portal knows it (Sphynx Team card), for the time log.
export async function loadProfile() {
  const cached = await store.get('profile');
  if (cached) return cached;
  const s = await getSession();
  const rows = await rest('workspace_masters?id=eq.main_state&select=sphynx_team');
  const team = rows?.[0]?.sphynx_team || [];
  const me = team.find((m) => m && m.authUserId === s.user.id);
  const profile = { name: me?.name || s.user.email, email: s.user.email };
  await store.set('profile', profile);
  return profile;
}

// Open tasks across projects (only the task list is pulled, not whole projects).
export async function loadTasks(force = false) {
  const cache = await store.get('taskCache');
  if (!force && cache && Date.now() - cache.at < 5 * 60_000) return cache.list;
  const rows = await rest('workspace_clients?select=id,meta,tasks:project_data->clientTasks');
  const closed = /^(done|completed|closed|cancelled|canceled)$/i;
  const list = [];
  (rows || []).forEach((c) => {
    (Array.isArray(c.tasks) ? c.tasks : []).forEach((t) => {
      if (!t || !t.id || closed.test(String(t.status || ''))) return;
      list.push({ clientId: c.id, clientName: c.meta?.name || 'Project', taskId: t.id, title: t.title || t.name || 'Task', assignee: t.assignee || '', status: t.status || '', dueDate: t.dueDate || '' });
    });
  });
  await store.set('taskCache', { at: Date.now(), list });
  return list;
}

export async function saveEntry(entry) {
  const s = await getSession();
  const profile = await loadProfile();
  return rest('time_entries', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: { ...entry, user_id: s.user.id, user_name: profile.name, source: 'chrome_extension' }
  });
}

export async function recentEntries() {
  const s = await getSession();
  return rest(`time_entries?user_id=eq.${s.user.id}&select=id,task_title,client_id,minutes,started_at,applied,note&order=created_at.desc&limit=8`);
}
