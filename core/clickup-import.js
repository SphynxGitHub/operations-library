//======================= CORE / CLICKUP IMPORT =======================//
// Pure helpers for the ClickUp CSV import (features/integrations.js). No DOM, no state.
//
// Time: each ClickUp row's logged time becomes ONE itemized time entry on the task (id "cu-time-<ClickUp task id>"),
// dated by the task's due date, else its start date. Re-importing the same file replaces that entry instead of
// adding to it, and time logged in the portal since is kept. Rows with no date get an undated entry, which counts
// in the task's total but not in any maintenance plan period.

const blank = (v) => v === undefined || v === null || String(v).trim() === '';
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const pad = (n) => String(n).padStart(2, '0');

// "24m", "1h 5m", "37h 25m", "1:30", "90s", or raw milliseconds -> minutes (rounded).
export function parseClickUpMinutes(raw) {
    if (blank(raw)) return 0;
    const s = String(raw).trim();
    const units = [...s.matchAll(/(\d+(?:\.\d+)?)\s*(h|hr|hrs|hours?|m|min|mins|minutes?|s|sec|secs|seconds?)\b/gi)];
    if (units.length) {
        let min = 0;
        units.forEach(([, n, u]) => {
            const v = parseFloat(n) || 0;
            const k = u[0].toLowerCase();
            min += k === 'h' ? v * 60 : k === 'm' ? v : v / 60;
        });
        return Math.round(min);
    }
    const hm = s.match(/^(\d+):(\d{2})(?::(\d{2}))?$/);
    if (hm) return Math.round(parseInt(hm[1], 10) * 60 + parseInt(hm[2], 10) + (parseInt(hm[3] || '0', 10) / 60));
    const n = Number(s.replace(/,/g, ''));
    if (!Number.isNaN(n)) return Math.round(n / 60000);          // ClickUp's raw time fields are milliseconds
    return 0;
}
export const parseClickUpTimeToHours = (raw) => Math.round((parseClickUpMinutes(raw) / 60) * 100) / 100;

// "Friday, September 24th 2021, 12:29:00 am -04:00", "Monday, May 30th 2022", "2024-09-04", epoch ms -> "YYYY-MM-DD".
// Written dates keep the day ClickUp shows (no timezone shift).
export function parseClickUpDate(raw) {
    if (blank(raw)) return '';
    const s = String(raw).trim();
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const named = s.match(/([A-Za-z]{3,})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/);
    if (named) {
        const mi = MONTHS.findIndex((m) => m.startsWith(named[1].toLowerCase().slice(0, 3)));
        const day = parseInt(named[2], 10);
        if (mi > -1 && day >= 1 && day <= 31) return `${named[3]}-${pad(mi + 1)}-${pad(day)}`;
    }
    if (/^\d+$/.test(s)) {
        const d = new Date(s.length <= 10 ? Number(s) * 1000 : Number(s));
        if (!Number.isNaN(d.getTime())) return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    return '';
}

// "[Arielle Minicozzi, Anthony Schorling]" -> ["Arielle Minicozzi", "Anthony Schorling"]
export function parseClickUpAssignees(raw) {
    if (blank(raw)) return [];
    return String(raw).replace(/^\s*\[|\]\s*$/g, '').split(',').map((a) => a.trim()).filter(Boolean);
}

// 1 / yes / true -> true; 0 / no / false -> false; anything else (blank) -> null, which leaves it to the Billable Rules.
export function parseClickUpBillable(raw) {
    if (blank(raw)) return null;
    const s = String(raw).trim().toLowerCase();
    if (['1', '1.0', 'true', 'yes', 'y', 'billable'].includes(s)) return true;
    if (['0', '0.0', 'false', 'no', 'n', 'non-billable'].includes(s)) return false;
    return null;
}

export const importedTimeEntryId = (clickupId) => `cu-time-${clickupId}`;

// Put the imported time on a task as one entry, replacing any earlier import of the same row.
// Earlier versions of the importer wrote loggedHours with no entry; that amount (the task's un-itemized time)
// is treated as the previous import so it is replaced, not doubled.
export function applyImportedTime(task, { clickupId, minutes, date = '', by = '' }) {
    if (!task) return { changed: false, deltaMinutes: 0 };
    if (!Array.isArray(task.timeLog)) task.timeLog = [];
    const entryId = importedTimeEntryId(clickupId);
    const totalMin = Math.round(Number(task.loggedHours || task.hoursLogged || 0) * 60);
    const idx = task.timeLog.findIndex((e) => e && e.id === entryId);
    let previous = 0;
    if (idx > -1) {
        previous = Number(task.timeLog[idx].minutes) || 0;
        task.timeLog.splice(idx, 1);
    } else if (task.source === 'clickup') {
        const itemized = task.timeLog.reduce((s, e) => s + (Number(e?.minutes) || 0), 0);
        previous = Math.max(0, totalMin - itemized);
    }
    const mins = Math.max(0, Math.round(Number(minutes) || 0));
    if (mins > 0) {
        task.timeLog.push({
            id: entryId, by: by || 'ClickUp import', minutes: mins,
            start: null, end: date ? `${date}T12:00:00` : null,           // local noon, so the day never shifts
            note: date ? 'Imported from ClickUp' : 'Imported from ClickUp (no date in the export)', source: 'clickup',
        });
    }
    const newTotal = Math.max(0, totalMin - previous + mins);
    task.loggedHours = Math.round((newTotal / 60) * 10000) / 10000;
    task.hoursLogged = task.loggedHours;
    return { changed: mins !== previous || idx === -1, deltaMinutes: mins - previous };
}

// Best-guess client for a file named like "...Active_Clients_-_Mason_Associates_LLC.csv": the longest client name
// found in the file name.
export function guessClientFromFileName(fileName, clients) {
    const norm = (v) => String(v || '').toLowerCase().replace(/\.csv$/i, '').replace(/[^a-z0-9]+/g, ' ').trim();
    const f = ` ${norm(fileName)} `;
    let best = null;
    (clients || []).forEach((c) => {
        const n = norm(c?.meta?.name);
        if (n.length >= 3 && f.includes(` ${n} `) && (!best || n.length > norm(best.meta?.name).length)) best = c;
    });
    return best ? best.id : '';
}
