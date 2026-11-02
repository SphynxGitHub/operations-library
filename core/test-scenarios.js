//======================= CORE / TEST SCENARIOS =======================//
// A testing checklist as a list of scenarios. Each has steps, sample data, and SEPARATE expected results, each marked
// pass or fail with a note. A failed expected result becomes a fix task; the fix is retested against the same scenario.
// kind: path (expected branch), edge (expected edge case), unexpected (input nobody planned for).
// Pure functions; the AI only drafts scenarios (normalizeGenerated), a person reviews them.

export const SCENARIO_KINDS = { path: 'Expected path', edge: 'Edge case', unexpected: 'Unexpected input' };
const rid = (p) => p + '_' + Math.random().toString(36).slice(2, 9);
const text = (v, n = 400) => String(v ?? '').trim().slice(0, n);

export function newScenario({ title, kind = 'path', steps = [], sampleData = {}, expected = [], clientVisible = false, source = 'manual' } = {}) {
    return {
        id: rid('scn'), title: text(title, 200), kind: SCENARIO_KINDS[kind] ? kind : 'path',
        steps: (steps || []).map((s) => text(s)).filter(Boolean),
        sampleData: sampleData && typeof sampleData === 'object' ? sampleData : {},
        expected: (expected || []).map((e) => newExpected(typeof e === 'string' ? e : e?.text)).filter((e) => e.text),
        note: '', evidence: '', clientVisible: !!clientVisible, source, retestOf: null,
    };
}
export const newExpected = (t) => ({ id: rid('exp'), text: text(t), result: '', note: '' });

export function setResult(scenario, expectedId, result, note = '') {
    const e = (scenario.expected || []).find((x) => x.id === expectedId);
    if (!e || !['pass', 'fail', ''].includes(result)) return scenario;
    e.result = result; if (note !== undefined) e.note = text(note, 1000);
    return scenario;
}

// pass = every expected passed; fail = any failed; pending = otherwise
export function scenarioStatus(scenario) {
    const ex = scenario?.expected || [];
    if (!ex.length) return 'pending';
    if (ex.some((e) => e.result === 'fail')) return 'fail';
    return ex.every((e) => e.result === 'pass') ? 'pass' : 'pending';
}
export function runSummary(scenarios) {
    const list = scenarios || [];
    const c = { pass: 0, fail: 0, pending: 0 };
    list.forEach((s) => { c[scenarioStatus(s)]++; });
    return { total: list.length, ...c, done: list.length > 0 && c.pending === 0, clean: list.length > 0 && c.fail === 0 && c.pending === 0 };
}

// One fix task per failed expected result that does not already have one. existing: tasks with scenarioId + expectedId.
export function fixTasksFor(scenarios, existing = []) {
    const have = new Set((existing || []).filter((t) => t && t.fixForExpectedId).map((t) => t.fixForExpectedId));
    const out = [];
    (scenarios || []).forEach((s) => (s.expected || []).forEach((e) => {
        if (e.result !== 'fail' || have.has(e.id)) return;
        out.push({ title: `Fix: ${s.title}`, instructions: `Expected: ${e.text}${e.note ? `\nWhat happened: ${e.note}` : ''}\nSample data: ${JSON.stringify(s.sampleData)}\nRetest against the same scenario once fixed.`,
                   fixForScenarioId: s.id, fixForExpectedId: e.id });
    }));
    return out;
}
// After a fix, the same expected result goes back to untested.
export function resetForRetest(scenario, expectedId) {
    const e = (scenario.expected || []).find((x) => x.id === expectedId);
    if (e) { e.note = e.note ? `Previously failed: ${e.note}` : ''; e.result = ''; }
    return scenario;
}

// Plain-language subset for the client: only scenarios marked for the client, expected paths, no sample-data internals.
export function clientVersion(scenarios) {
    return (scenarios || []).filter((s) => s.clientVisible && s.kind === 'path').map((s) => ({
        id: s.id, title: s.title, steps: s.steps, expected: (s.expected || []).map((e) => ({ id: e.id, text: e.text, result: e.result, note: e.note })),
    }));
}

// What the AI returns -> scenarios, nothing trusted: capped counts, text only, kinds checked.
export function normalizeGenerated(ai) {
    const list = Array.isArray(ai?.scenarios) ? ai.scenarios : Array.isArray(ai) ? ai : [];
    return list.slice(0, 40).map((s) => newScenario({
        title: s?.title, kind: s?.kind, steps: Array.isArray(s?.steps) ? s.steps.slice(0, 20) : [],
        sampleData: s?.sampleData && typeof s.sampleData === 'object' && !Array.isArray(s.sampleData) ? Object.fromEntries(Object.entries(s.sampleData).slice(0, 20).map(([k, v]) => [text(k, 60), text(v, 200)])) : {},
        expected: Array.isArray(s?.expected) ? s.expected.slice(0, 12) : [], clientVisible: !!s?.clientVisible, source: 'ai',
    })).filter((s) => s.title && s.expected.length);
}

// Seeds the library from a past checklist (items like { text, done } or strings): one scenario per item, one expected result.
export function fromChecklist(items) {
    return (items || []).map((it) => (typeof it === 'string' ? it : it?.text || it?.title || '')).map((t) => text(t, 200)).filter(Boolean)
        .map((t) => newScenario({ title: t, kind: 'path', steps: [t], expected: [`${t} works as intended`], source: 'checklist' }));
}
