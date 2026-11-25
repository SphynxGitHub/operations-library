// ============================================================
// SHORT FILTER TEXT
// A condition on a line ("Find Contact by Email" id exists AND "hook_v2" primaryPhone exists) is long to read on the map. This
// turns it into the few words that matter (Found And Primary phone found). Only the label changes: hovering still shows the original.
// Anything it cannot read is returned exactly as it was.
// ============================================================
const OPS = ['does not exist', 'exists', 'is exactly', 'is not exactly', 'is not', 'does not contain', 'contains', 'starts with', 'ends with', 'is greater than', 'is less than', 'is empty', 'is not empty', 'is true', 'is false'];
const CLAUSE = new RegExp(`^["\\u201c](.+)["\\u201d]\\s+(.+?)\\s+(${OPS.map((o) => o.replace(/ /g, '\\s+')).join('|')})(?:\\s+(.*))?$`, 'i');

const cap = (x) => x.charAt(0).toUpperCase() + x.slice(1);
const pretty = (f) => {
    const w = String(f).trim().replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Za-z])(\d)/g, '$1 $2').replace(/_/g, ' ');
    return cap(w.split(' ').map((x, i) => (/^id$/i.test(x) ? 'ID' : (i ? x.toLowerCase() : x))).join(' ').replace(/^(\S+) ID$/i, (m, a) => `${cap(a.toLowerCase())} ID`));
};

// split on a joiner at the top level only (not inside brackets)
function splitTop(s, word) {
    const out = []; let depth = 0, last = 0;
    const re = new RegExp(`\\s${word}\\s`, 'g'); let m;
    const depthAt = (i) => { let d = 0; for (let k = 0; k < i; k++) { if (s[k] === '(') d++; else if (s[k] === ')') d--; } return d; };
    while ((m = re.exec(s))) { depth = depthAt(m.index); if (depth === 0) { out.push(s.slice(last, m.index)); last = m.index + m[0].length; } }
    out.push(s.slice(last));
    return out.length > 1 ? out : null;
}
const unwrap = (s) => { const t = s.trim(); if (t[0] !== '(' || t[t.length - 1] !== ')') return t; let d = 0; for (let i = 0; i < t.length; i++) { if (t[i] === '(') d++; else if (t[i] === ')') { d--; if (d === 0 && i < t.length - 1) return t; } } return t.slice(1, -1).trim(); };

function clause(text, first, negated) {
    const m = text.trim().match(CLAUSE); if (!m) return null;
    const field = m[2].trim(); const op = m[3].toLowerCase().replace(/\s+/g, ' '); const val = (m[4] || '').trim(); const f = pretty(field);
    if (op === 'exists') return /^id$/i.test(field) ? 'Found' : `${f} found`;
    if (op === 'does not exist') return /^id$/i.test(field) ? 'Not found' : `${f} not found`;
    if (op === 'is exactly') return `${f} ${negated && first ? '!=' : '='} ${val}`;
    if (op === 'is not' || op === 'is not exactly') return `${f} != ${val}`;
    if (op === 'contains') return /^advisor$/i.test(field) && val === ',' ? (first ? 'Several advisors' : '= Joint Call') : `${f} contains ${val}`;
    if (op === 'does not contain') return `${f} lacks ${val}`;
    if (op === 'starts with') return `${f} starts ${val}`;
    if (op === 'ends with') return `${f} ends ${val}`;
    if (op === 'is greater than') return `${f} > ${val}`;
    if (op === 'is less than') return `${f} < ${val}`;
    if (op === 'is empty') return `${f} empty`;
    if (op === 'is not empty') return `${f} filled`;
    return `${f} ${op.replace('is ', '')}`;
}

function expr(s, negated, first = true) {
    const t = unwrap(s);
    const ors = splitTop(t, 'OR');
    if (ors) { const p = ors.map((x) => expr(x, false, true)); return p.every(Boolean) ? p.map((x, i) => (/ (And|Or) /.test(x) && !x.startsWith('(') ? `(${x})` : x)).join(' Or ') : null; }
    const ands = splitTop(t, 'AND');
    if (ands) { const p = ands.map((x, i) => expr(x, negated && i === 0, i === 0)); return p.every(Boolean) ? p.map((x, i) => (i && !/^=/.test(x) ? x : x)).join(' And ') : null; }
    const n = t.match(/^NOT\s*\((.*)\)$/i);
    if (n) { const inner = n[1]; const simple = !splitTop(unwrap(inner), 'OR'); const r = expr(inner, true); return r ? (simple && /^[^()]*$/.test(unwrap(inner)) && /!=|= /.test(r) ? r : `Not (${r})`) : null; }
    return clause(t, first, negated);
}

export function shortRule(rule) {
    const t = String(rule || '').trim(); if (!t) return t;
    try { return expr(t, false) || t; } catch (e) { return t; }
}
