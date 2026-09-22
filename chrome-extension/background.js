// Keeps the toolbar badge showing elapsed minutes, retries entries that
// couldn't be saved (offline, signed out), and nudges you when you've gone
// idle with a timer still running.
import { store, saveEntry } from './api.js';
import { IDLE_REMINDER_MINUTES } from './config.js';

const fmt = (mins) => (mins >= 60 ? `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, '0')}` : `${mins}m`);

export async function refreshBadge() {
  const running = await store.get('running');
  if (!running) { await chrome.action.setBadgeText({ text: '' }); return; }
  const mins = Math.floor((Date.now() - running.startedAt) / 60000);
  await chrome.action.setBadgeBackgroundColor({ color: '#64c6a2' });
  await chrome.action.setBadgeText({ text: fmt(mins).slice(0, 4) });
}

async function flushQueue() {
  const queue = (await store.get('pendingEntries')) || [];
  if (!queue.length) return;
  const left = [];
  for (const e of queue) {
    try { await saveEntry(e); } catch { left.push(e); }
  }
  await store.set('pendingEntries', left);
}

chrome.runtime.onInstalled.addListener(() => chrome.alarms.create('tick', { periodInMinutes: 1 }));
chrome.runtime.onStartup.addListener(() => chrome.alarms.create('tick', { periodInMinutes: 1 }));
chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name !== 'tick') return;
  await refreshBadge();
  await flushQueue();
});

chrome.idle.setDetectionInterval(Math.max(60, IDLE_REMINDER_MINUTES * 60));
chrome.idle.onStateChanged.addListener(async (st) => {
  if (st !== 'idle' && st !== 'locked') return;
  const running = await store.get('running');
  if (!running) return;
  chrome.notifications.create('ol-idle', {
    type: 'basic', iconUrl: 'icons/icon128.png',
    title: 'Timer still running',
    message: `You've been away ${IDLE_REMINDER_MINUTES}+ minutes. "${running.title}" is still timing — open the extension to stop or trim it.`
  });
});

chrome.runtime.onMessage.addListener((msg, _s, reply) => {
  if (msg?.type === 'refreshBadge') refreshBadge().then(() => reply(true));
  if (msg?.type === 'flush') flushQueue().then(() => reply(true));
  return true;
});
