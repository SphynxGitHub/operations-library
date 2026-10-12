// ================================================================================================
// FILE: features/flow-visualizer/step-schedule.js
//
// WHAT IT DOES:   "Dynamic scheduling" on a step: when the step happens. Two choices:
//
//   Specific date   something that comes round again, so it is not tied to a year. "Repeats" picks which kind:
//                     every year    a month, or a month and day ("Every March", "Every March 15"); a year can be typed in the
//                                   optional "Only in the year" box to make it a one-off
//                     every month   the same day each month ("Every month on the 15th", or "on the last day")
//                     every week    a day of the week ("Every Monday")
//   Dynamic         four selections, read left to right as a sentence:
//                     [ # ]  [ minutes | hours | days | weeks | months ]  [ before | after | later ]  [ target ]
//                   target is only asked for before / after:
//                     the previous step  |  a specific step (any step in any process)  |  custom (your own words, e.g. "the kickoff call")
//                   "later" has no target: "3 days later".
//
// STORED AS:      step.schedule = { mode: 'date'|'dynamic', repeat ('yearly'|'monthly'|'weekly'), month (1-12), day (1-31; yearly: 0 = the whole month; monthly: -1 = the last day),
//                   weekday (0 = Sunday ... 6 = Saturday), year ('' = every year),
//                   amount, unit, direction, target: 'prev'|'step'|'custom',
//                   targetResId, targetStepId, customLabel }
//                 The older fields are kept in step with it (timingType: after_prev / after_start / manual, timingValue in
//                 days, fixedDate when a year is set), and a step that only has those is read as the matching schedule.
//
// USED BY:        the step editor on the flow map (features/flow-visualizer/core.js) and the inline step editor in the
//                 resources list (features/resources-grid.js): both call OL.fvSchedEditor(resId, step).
// ================================================================================================

import { esc } from '../../core/data.js';

const OL = () => window.OL;
const project = () => (OL().getCurrentProjectData ? OL().getCurrentProjectData() : { resources: [] }) || { resources: [] };
const allRes = () => (project().resources || project().localResources || []).filter((r) => r && !r.isDeleted);
const resById = (id) => allRes().find((r) => String(r.id) === String(id));
const stepOf = (res, id) => ((res && res.steps) || []).find((s) => String(s.id) === String(id));

export const UNITS = ['minutes', 'hours', 'days', 'weeks', 'months'];
export const DIRECTIONS = ['before', 'after', 'later'];
const TARGETS = [['prev', 'the previous step'], ['step', 'a specific step'], ['custom', 'custom']];
const TO_DAYS = { minutes: 1 / 1440, hours: 1 / 24, days: 1, weeks: 7, months: 30 };

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ordinal = (n) => `${n}${[11, 12, 13].includes(n % 100) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th')}`;
const DAYS_IN = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];      // February allows the 29th: the date comes round every year
// "2026-11-02" -> { month: 11, day: 2, year: 2026 }
function fromIso(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || ''));
  return m ? { month: Number(m[2]), day: Number(m[3]), year: Number(m[1]) } : { month: 0, day: 0, year: '' };
}

// the schedule a step has, whichever way it was stored
export function scheduleOf(step) {
  const base = { mode: 'dynamic', repeat: 'yearly', month: 0, day: 0, weekday: 1, year: '', amount: 0, unit: 'days', direction: 'after', target: 'prev', targetResId: '', targetStepId: '', customLabel: '' };
  if (!step) return base;
  if (step.schedule && typeof step.schedule === 'object') {
    const sc = { ...base, ...step.schedule };
    if (sc.mode === 'date' && !sc.month && sc.date) Object.assign(sc, fromIso(sc.date));   // saved by the first version, which kept a full date
    return sc;
  }
  // older steps: timingType + timingValue (days) + fixedDate
  if (step.timingType === 'manual') return { ...base, mode: 'date', ...fromIso(step.fixedDate) };
  const n = Number(step.timingValue) || 0;
  if (step.timingType === 'after_start') return { ...base, amount: Math.abs(n), direction: n < 0 ? 'before' : 'after', target: 'custom', customLabel: 'Project start' };
  return { ...base, amount: Math.abs(n), direction: n < 0 ? 'before' : 'after' };
}

// "2 days after the previous step"
export function scheduleText(step, resId) {
  const sc = scheduleOf(step);
  if (sc.mode === 'date') {
    if (sc.repeat === 'weekly') return `Every ${WEEKDAYS[sc.weekday] || 'week'}`;
    if (sc.repeat === 'monthly') return !sc.day ? 'Every month: pick a day' : sc.day === -1 ? 'Every month on the last day' : `Every month on the ${ordinal(sc.day)}`;
    if (!sc.month) return 'No month chosen yet';
    const when = `${MONTHS[sc.month - 1]}${sc.day ? ` ${sc.day}` : ''}`;
    return sc.year ? `${when}, ${sc.year} only` : `Every ${when}`;
  }
  const n = Number(sc.amount) || 0;
  const unit = n === 1 ? sc.unit.replace(/s$/, '') : sc.unit;
  const head = `${n} ${unit}`;
  if (sc.direction === 'later') return `${head} later`;
  let to = 'the previous step';
  if (sc.target === 'step') {
    const t = sc.targetStepId ? stepOf(resById(sc.targetResId || resId), sc.targetStepId) : null;
    to = t ? `“${t.name || 'a step'}”` : '(pick a step)';
  } else if (sc.target === 'custom') to = sc.customLabel ? sc.customLabel : '(say what)';
  return `${head} ${sc.direction} ${to}`;
}

// keep the older fields equal to the new schedule, for anything that still reads them
function mirrorLegacy(step, sc) {
  if (sc.mode === 'date') {
    step.timingType = 'manual'; step.timingValue = 0;
    // the old field holds a full date, so it only has a value when a year was given
    step.fixedDate = sc.repeat === 'yearly' && sc.month && sc.day && sc.year ? `${sc.year}-${String(sc.month).padStart(2, '0')}-${String(sc.day).padStart(2, '0')}` : '';
    return;
  }
  delete step.fixedDate;
  const fromStart = sc.direction === 'after' && sc.target === 'custom' && /project\s*start/i.test(sc.customLabel || '');
  step.timingType = fromStart ? 'after_start' : 'after_prev';
  const days = Math.round((Number(sc.amount) || 0) * (TO_DAYS[sc.unit] || 1));
  step.timingValue = sc.direction === 'before' ? -days : days;
}

// ---- the editor --------------------------------------------------------------------------------------------------
const sel = 'class="modal-input tiny" style="margin:0;min-width:0;"';
function stepOptions(resId, step, sc) {
  const groups = allRes().filter((r) => (r.steps || []).length && !r.isArchived).map((r) => {
    const opts = r.steps.filter((x) => x && !x.isArchived && !(String(r.id) === String(resId) && String(x.id) === String(step.id)))
      .map((x, i) => { const v = `${r.id}|${x.id}`; const on = String(sc.targetResId || resId) === String(r.id) && String(sc.targetStepId) === String(x.id); return `<option value="${esc(v)}" ${on ? 'selected' : ''}>${i + 1}. ${esc(x.name || 'Unnamed step')}</option>`; }).join('');
    return opts ? `<optgroup label="${esc(r.name || 'Untitled')}${String(r.id) === String(resId) ? ' (this process)' : ''}">${opts}</optgroup>` : '';
  }).join('');
  return `<option value="">Pick a step...</option>${groups}`;
}

function innerHtml(resId, step) {
  const sc = scheduleOf(step); const r = esc(resId), s = esc(step.id);
  const set = (field, expr = 'this.value') => `OL.fvSchedSet('${r}','${s}','${field}', ${expr})`;
  const seg = (mode, label) => `<button type="button" class="btn tiny ${sc.mode === mode ? 'primary' : 'soft'}" style="flex:1;" onclick="${set('mode', `'${mode}'`)}">${label}</button>`;
  let body;
  if (sc.mode === 'date') {
    const rep = (k, l) => `<option value="${k}" ${sc.repeat === k ? 'selected' : ''}>${l}</option>`;
    const picker = `<select ${sel.replace('margin:0;', 'margin:0 0 8px;width:100%;')} onchange="${set('repeat')}" aria-label="Repeats">${rep('yearly', 'Every year')}${rep('monthly', 'Every month')}${rep('weekly', 'Every week')}</select>`;
    let fields;
    if (sc.repeat === 'weekly') {
      fields = `<select ${sel.replace('margin:0;', 'margin:0;width:100%;')} onchange="${set('weekday')}" aria-label="Day of the week">${WEEKDAYS.map((w, i) => `<option value="${i}" ${sc.weekday === i ? 'selected' : ''}>${w}</option>`).join('')}</select>`;
    } else if (sc.repeat === 'monthly') {
      fields = `<select ${sel.replace('margin:0;', 'margin:0;width:100%;')} onchange="${set('day')}" aria-label="Day of the month"><option value="0">Pick a day...</option>${Array.from({ length: 31 }, (_, i) => `<option value="${i + 1}" ${sc.day === i + 1 ? 'selected' : ''}>the ${ordinal(i + 1)}</option>`).join('')}<option value="-1" ${sc.day === -1 ? 'selected' : ''}>the last day</option></select>
        <div class="tiny muted" style="margin-top:6px;">In a shorter month, a late day (the 31st) falls on that month's last day.</div>`;
    } else {
      const maxDay = sc.month ? DAYS_IN[sc.month - 1] : 31;
      fields = `
      <div style="display:grid;grid-template-columns:minmax(0,1fr) 92px;gap:8px;">
        <select ${sel} onchange="${set('month')}" aria-label="Month"><option value="0">Pick a month...</option>${MONTHS.map((m, i) => `<option value="${i + 1}" ${sc.month === i + 1 ? 'selected' : ''}>${m}</option>`).join('')}</select>
        <select ${sel} onchange="${set('day')}" aria-label="Day" ${sc.month ? '' : 'disabled'}><option value="0">Any day</option>${Array.from({ length: maxDay }, (_, i) => `<option value="${i + 1}" ${sc.day === i + 1 ? 'selected' : ''}>${i + 1}</option>`).join('')}</select>
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin-top:8px;">
        <span class="tiny muted" style="white-space:nowrap;">Only in the year</span>
        <input type="number" class="modal-input tiny" style="margin:0;width:112px;min-width:0;" min="2000" max="2100" step="1" value="${esc(sc.year)}" placeholder="every year" onchange="${set('year')}" aria-label="Only in this year (optional)">
      </div>`;
    }
    body = picker + fields;
  } else {
    const later = sc.direction === 'later';
    body = `
      <div style="display:grid;grid-template-columns:72px minmax(0,1fr);gap:8px;margin-bottom:8px;">
        <input type="number" min="0" step="1" class="modal-input tiny" style="margin:0;min-width:0;" value="${esc(sc.amount)}" onchange="${set('amount')}" aria-label="How many">
        <select ${sel} onchange="${set('unit')}" aria-label="Unit">${UNITS.map((u) => `<option value="${u}" ${sc.unit === u ? 'selected' : ''}>${u}</option>`).join('')}</select>
      </div>
      <div style="display:grid;grid-template-columns:${later ? 'minmax(0,1fr)' : '110px minmax(0,1fr)'};gap:8px;">
        <select ${sel} onchange="${set('direction')}" aria-label="Before, after or later">${DIRECTIONS.map((d) => `<option value="${d}" ${sc.direction === d ? 'selected' : ''}>${d}</option>`).join('')}</select>
        ${later ? '' : `<select ${sel} onchange="${set('target')}" aria-label="Relative to">${TARGETS.map(([k, l]) => `<option value="${k}" ${sc.target === k ? 'selected' : ''}>${l}</option>`).join('')}</select>`}
      </div>
      ${!later && sc.target === 'step' ? `<select ${sel.replace('margin:0;', 'margin:8px 0 0;width:100%;')} onchange="${set('targetStep')}" aria-label="Which step">${stepOptions(resId, step, sc)}</select>` : ''}
      ${!later && sc.target === 'custom' ? `<input type="text" class="modal-input tiny" style="margin:8px 0 0;width:100%;box-sizing:border-box;" maxlength="120" value="${esc(sc.customLabel)}" placeholder="e.g. the kickoff call, project start, month end" onchange="${set('customLabel')}">` : ''}`;
  }
  return `<div style="display:flex;gap:6px;margin-bottom:8px;">${seg('date', 'Specific date')}${seg('dynamic', 'Dynamic')}</div>${body}
    <div class="tiny muted" style="margin-top:8px;">Reads as: <b>${esc(scheduleText(step, resId))}</b></div>`;
}

export function scheduleEditor(resId, step) {
  return `<div class="fv-sched" id="fv-sched-${esc(step.id)}">${innerHtml(resId, step)}</div>`;
}

// field: mode | repeat | weekday | month | day | year | amount | unit | direction | target | targetStep ("resId|stepId") | customLabel
export function setSchedule(resId, stepId, field, value) {
  const step = stepOf(resById(resId), stepId); if (!step) return;
  const sc = { ...scheduleOf(step) };
  if (field === 'mode') sc.mode = value === 'date' ? 'date' : 'dynamic';
  else if (field === 'repeat') { sc.repeat = ['yearly', 'monthly', 'weekly'].includes(value) ? value : 'yearly'; sc.day = 0; }
  else if (field === 'weekday') sc.weekday = Math.min(6, Math.max(0, parseInt(value, 10) || 0));
  else if (field === 'month') { sc.month = Math.min(12, Math.max(0, parseInt(value, 10) || 0)); if (!sc.month) sc.day = 0; else if (sc.day > DAYS_IN[sc.month - 1]) sc.day = DAYS_IN[sc.month - 1]; }
  else if (field === 'day') {
    const d = parseInt(value, 10) || 0;
    if (sc.repeat === 'monthly') sc.day = d === -1 ? -1 : Math.min(31, Math.max(0, d));
    else sc.day = sc.month ? Math.min(DAYS_IN[sc.month - 1], Math.max(0, d)) : 0;
  }
  else if (field === 'year') { const y = parseInt(value, 10); sc.year = y >= 2000 && y <= 2100 ? y : ''; }
  else if (field === 'amount') sc.amount = Math.max(0, Math.round((Number(value) || 0) * 100) / 100);
  else if (field === 'unit') sc.unit = UNITS.includes(value) ? value : 'days';
  else if (field === 'direction') sc.direction = DIRECTIONS.includes(value) ? value : 'after';
  else if (field === 'target') { sc.target = TARGETS.some(([k]) => k === value) ? value : 'prev'; }
  else if (field === 'targetStep') { const [rid, sid] = String(value || '').split('|'); sc.targetResId = rid || ''; sc.targetStepId = sid || ''; }
  else if (field === 'customLabel') sc.customLabel = String(value || '').trim().slice(0, 120);
  step.schedule = sc;
  mirrorLegacy(step, sc);
  OL().persist();
  // redraw just this section: the choices shown depend on the earlier ones
  document.querySelectorAll(`#fv-sched-${CSS.escape(String(stepId))}`).forEach((el) => { el.innerHTML = innerHtml(resId, step); });
}

window.OL = window.OL || {};
Object.assign(window.OL, { fvSchedEditor: scheduleEditor, fvSchedSet: setSchedule, fvSchedText: scheduleText, fvScheduleOf: scheduleOf });
