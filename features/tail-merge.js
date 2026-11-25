// ============================================================
// REPEATED TAILS
// A lookup that falls back (search by name, then by email, then by phone) usually ends each "found" path with the same steps
// copied again. On the flow map those copies are drawn once: the first copy stays, the later ones are hidden, and the step
// before each hidden copy gets its line to the first. Nothing is deleted; the Zap's own view still lists every step.
// Worked out fresh on every draw (flags and lines made here are removed first), and switched on or off from the map's toolbar.
// ============================================================
const OL = window.OL || (window.OL = {});
const TAIL_MIN = 3;

export const fvMergeTailsOn = () => { try { return localStorage.getItem('fv_merge_tails') !== '0'; } catch (e) { return true; } };
export function fvToggleMergeTails() { try { localStorage.setItem('fv_merge_tails', fvMergeTailsOn() ? '0' : '1'); } catch (e) { /* not remembered */ } OL.renderVisualizer(); }

const sig = (s) => `${String(s.name || s.title || '').trim().toLowerCase()}|${String((s.zap && s.zap.app) || s.appName || '').toLowerCase()}`;

export function mergeRepeatedTails(resources) {
    const all = (OL.getCurrentProjectData() || {}).resources || [];
    all.forEach((r) => (r.steps || []).forEach((s) => {
        if (s._tmHidden) { delete s._tmHidden; if (!s._hookHidden) delete s.hideOnMap; }
        if (s.logic && Array.isArray(s.logic.out)) s.logic.out = s.logic.out.filter((l) => !l._tm);
    }));
    if (!fvMergeTailsOn()) return 0;
    let merged = 0;
    all.filter((r) => r && r.type === 'Zap' && !r.isDeleted).forEach((res) => {
        const steps = res.steps || []; if (steps.length < TAIL_MIN * 2) return;
        const idx = new Map(steps.map((s, i) => [String(s.id), i]));
        const pre = `${res.id}-`;
        const outsOf = (s) => ((s.logic && s.logic.out) || []).filter((l) => l && l.targetId && String(l.targetId).startsWith(pre));
        const nextOf = (s) => { const o = outsOf(s); return o.length === 1 && idx.has(String(o[0].targetId).slice(pre.length)) ? steps[idx.get(String(o[0].targetId).slice(pre.length))] : null; };
        const chain = (s) => { const out = [s]; const seen = new Set([String(s.id)]); let n = nextOf(s); while (n && !seen.has(String(n.id))) { out.push(n); seen.add(String(n.id)); n = nextOf(n); } return out; };
        const ends = (c) => outsOf(c[c.length - 1]).length === 0;
        const taken = new Set();
        for (let b = 1; b < steps.length; b++) {
            const sb = steps[b]; if (taken.has(String(sb.id)) || sb.hideOnMap) continue;
            const cb = chain(sb); if (cb.length < TAIL_MIN || !ends(cb)) continue;
            for (let a = 0; a < b; a++) {
                const sa = steps[a]; if (taken.has(String(sa.id))) continue;
                const ca = chain(sa);
                if (ca.length !== cb.length || !ends(ca) || ca.some((x, i) => sig(x) !== sig(cb[i]) || cb.includes(x))) continue;
                const preds = steps.filter((p) => !cb.includes(p) && outsOf(p).some((l) => String(l.targetId) === `${pre}${sb.id}`));
                if (!preds.length) break;
                preds.forEach((p) => {
                    const old = outsOf(p).find((l) => String(l.targetId) === `${pre}${sb.id}`);
                    p.logic.out.push({ type: (old && old.type) || 'next', types: (old && old.types) || ['next'], targetId: `${pre}${sa.id}`, rule: (old && old.rule) || '', loopLimit: '', delayValue: '', delayUnit: 'days', _auto: true, _tm: 1 });
                });
                cb.forEach((x) => { taken.add(String(x.id)); if (!x.hideOnMap) { x.hideOnMap = true; x._tmHidden = true; } });
                merged++;
                break;
            }
        }
    });
    return merged;
}
OL.fvMergeTails = mergeRepeatedTails; OL.fvMergeTailsOn = fvMergeTailsOn; OL.fvToggleMergeTails = fvToggleMergeTails;
