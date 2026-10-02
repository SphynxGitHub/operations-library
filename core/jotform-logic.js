//======================= CORE / JOTFORM LOGIC =======================//
// Turns what Jotform returns for a form's conditional logic into something a person can read and the form-logic map can draw.
// Pure functions: no database, no page.
//
// What Jotform returns (properties.conditions): a list of rules. Each has a type (field: show or hide questions, page: skip
// to a page or the end, email: send an email after submission, url: change the thank-you address, message: change the
// thank-you message), a link (Any / All of the terms), terms (what to check) and action (what to do), both as JSON text.
// The documentation names these fields but not the keys inside terms and action, so every key is read under the names it is
// known to use and anything not understood is kept as plain text instead of being dropped. A rule is never lost.
//
// Used by features/jotform-logic.js (loading it and drawing the map).

const parseMaybe = (v, fallback) => {
  if (v == null || v === '') return fallback;
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return fallback; }
};
const asList = (v) => {
  const p = parseMaybe(v, []);
  if (Array.isArray(p)) return p;
  if (p && typeof p === 'object') return Object.values(p);
  return [];
};
const first = (o, keys) => { for (const k of keys) { if (o && o[k] !== undefined && o[k] !== null && o[k] !== '') return o[k]; } return undefined; };
const clip = (s, n) => { const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

const OPERATORS = {
  equals: 'is', equal: 'is', is: 'is', notequals: 'is not', notequal: 'is not', isnot: 'is not',
  contains: 'contains', notcontains: 'does not contain', startswith: 'starts with', endswith: 'ends with',
  greaterthan: 'is more than', morethan: 'is more than', lessthan: 'is less than', greaterthanorequal: 'is at least', lessthanorequal: 'is at most',
  isfilled: 'is filled in', filled: 'is filled in', isempty: 'is empty', empty: 'is empty', notempty: 'is filled in',
  equaldate: 'is on', before: 'is before', after: 'is after', ischecked: 'is checked', isunchecked: 'is not checked',
};
const opText = (op) => OPERATORS[String(op || '').toLowerCase().replace(/[\s_-]/g, '')] || (op ? String(op) : 'matches');
const NO_VALUE_OPS = new Set(['is filled in', 'is empty', 'is checked', 'is not checked']);

const VERBS = {
  show: 'show', hide: 'hide', showmultiple: 'show', hidemultiple: 'hide', require: 'require', unrequire: 'make optional',
  enable: 'enable', disable: 'disable', enablemultiple: 'enable', disablemultiple: 'disable',
};

// questions: [{qid, type, text, name, order, options}] as the server sends them.
export function normalizeJotformLogic(raw) {
  const questions = Array.isArray(raw?.questions) ? raw.questions : [];
  const fields = {};
  questions.forEach((q) => { fields[String(q.qid)] = { label: clip(q.text || q.name || `Question ${q.qid}`, 70), type: q.type || '', options: q.options || '' }; });

  // Pages: each page break starts a new page; the first page is page 1.
  const pageBreaks = questions.filter((q) => /pagebreak/i.test(q.type || '')).sort((a, b) => (a.order || 0) - (b.order || 0));
  const pages = [{ n: 1, label: 'Page 1' }];
  pageBreaks.forEach((q, i) => pages.push({ n: i + 2, label: clip(q.text, 40) ? `Page ${i + 2}: ${clip(q.text, 40)}` : `Page ${i + 2}` }));
  const pageLabel = (target) => {
    const t = String(target ?? '').toLowerCase();
    if (!t) return '';
    if (t === 'end' || t === 'thankyou' || t === 'submit') return 'the end of the form';
    const m = t.match(/(\d+)/);
    if (m) { const p = pages.find((x) => x.n === Number(m[1])); return p ? p.label : `Page ${m[1]}`; }
    return String(target);
  };
  const fieldLabel = (id) => (fields[String(id)] ? fields[String(id)].label : `Question ${id}`);

  const rules = asList(raw?.conditions).map((c, i) => {
    const type = String(c?.type || 'field').toLowerCase();
    const kind = ['field', 'page', 'email', 'url', 'message'].includes(type) ? type : 'other';
    const link = String(c?.link || 'All').toLowerCase() === 'any' ? 'any' : 'all';

    const when = asList(c?.terms).map((t) => {
      const fid = first(t, ['field', 'fieldId', 'qid', 'id']);
      const op = first(t, ['operator', 'op']);
      const value = first(t, ['value', 'val', 'term']);
      const o = opText(op);
      return { field: fid != null ? String(fid) : '', fieldLabel: fid != null ? fieldLabel(fid) : 'A question', op: o, value: NO_VALUE_OPS.has(o) || value === undefined ? '' : clip(value, 60) };
    });

    const then = [];
    asList(c?.action).forEach((a) => {
      if (kind === 'page') {
        const target = first(a, ['skipTo', 'skip', 'page', 'target']);
        then.push({ verb: 'skip', targets: [], text: target !== undefined ? `Go to ${pageLabel(target)}` : 'Skip ahead' });
        return;
      }
      if (kind === 'email') {
        const em = first(a, ['email', 'emailId', 'id']);
        const to = first(a, ['to', 'recipient']);
        then.push({ verb: 'email', targets: [], text: em !== undefined ? `Send notification email${/^\d+$/.test(String(em)) ? ' #' + em : ': ' + clip(em, 50)}` : (to ? `Send an email to ${clip(to, 50)}` : 'Send an email') });
        return;
      }
      if (kind === 'url') { then.push({ verb: 'url', targets: [], text: `Send the person to ${clip(first(a, ['url', 'link', 'redirect']) ?? 'another address', 80)}` }); return; }
      if (kind === 'message') { then.push({ verb: 'message', targets: [], text: `Show this thank-you message: “${clip(first(a, ['message', 'text', 'content']) ?? '', 90)}”` }); return; }
      // show / hide / require ... questions
      const vis = String(first(a, ['visibility', 'action', 'type']) || '').toLowerCase().replace(/[\s_-]/g, '');
      const verb = VERBS[vis] || (vis || 'change');
      const ids = [];
      const one = first(a, ['field']);
      if (one != null) String(one).split(',').map((x) => x.trim()).filter(Boolean).forEach((x) => ids.push(x));
      const many = first(a, ['fields']);
      if (Array.isArray(many)) many.forEach((x) => ids.push(String(x)));
      else if (typeof many === 'string') many.split(',').map((x) => x.trim()).filter(Boolean).forEach((x) => ids.push(x));
      const targets = [...new Set(ids)].map(fieldLabel);
      if (targets.length) then.push({ verb, targets, text: `${verb} ${targets.length > 3 ? targets.slice(0, 3).join(', ') + ` and ${targets.length - 3} more` : targets.join(', ')}` });
      else then.push({ verb: 'other', targets: [], text: clip(JSON.stringify(a), 100) });
    });
    if (!then.length) then.push({ verb: 'other', targets: [], text: 'An action Jotform did not describe' });

    return { id: String(c?.id ?? i + 1), index: Number(c?.index) || i + 1, kind, link, disabled: String(c?.disabled || '') === '1', when, then };
  }).sort((a, b) => a.index - b.index);

  return { rules, pages, fieldCount: Object.keys(fields).length };
}

// A short stable fingerprint of the rules, so a re-pull can tell whether the logic changed.
export function logicFingerprint(norm) {
  const basis = JSON.stringify((norm?.rules || []).map((r) => [r.kind, r.link, r.disabled, r.when.map((w) => [w.fieldLabel, w.op, w.value]), r.then.map((t) => t.text)]));
  let h = 5381;
  for (let i = 0; i < basis.length; i++) h = ((h << 5) + h + basis.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export function summarizeLogic(norm) {
  const n = { field: 0, page: 0, email: 0, url: 0, message: 0, other: 0 };
  (norm?.rules || []).forEach((r) => { n[r.kind] = (n[r.kind] || 0) + 1; });
  const parts = [];
  if (n.field) parts.push(`${n.field} show/hide`);
  if (n.page) parts.push(`${n.page} page skip${n.page === 1 ? '' : 's'}`);
  if (n.email) parts.push(`${n.email} email${n.email === 1 ? '' : 's'}`);
  if (n.url || n.message) parts.push(`${n.url + n.message} thank-you change${n.url + n.message === 1 ? '' : 's'}`);
  if (n.other) parts.push(`${n.other} other`);
  return parts.join(' · ');
}
