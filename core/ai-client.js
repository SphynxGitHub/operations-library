//======================= CORE / AI CLIENT =======================//
// The browser's one way to ask for AI help: it calls the ol-ai Supabase function (which cleans secrets first, runs Claude,
// and logs the run). Honors each feature's mode. Never throws: on any problem it returns { ok:false } so the app carries on
// exactly as if the AI feature did not exist.

import { db, state } from './data.js';
import { getOlSettings } from './ol-settings.js';
import { aiMode } from './ai-flags.js';

const FEATURE_FOR_TASK = { recap_match: 'recap', recap_from_summary: 'recap', email_classify: 'email', email_review_sent: 'email_review', holding_reply: 'holding_reply',
    test_scenarios: 'test_scenarios', suggested_asks: 'suggested_asks', lead_intent: 'lead_intent', howto_guide: 'howto', history_entry: 'history', ask_notes: 'ask_notes' };

export const featureMode = (feature) => aiMode(getOlSettings(state?.master), feature);

// ctx: { clientId, sourceKind, sourceId }. force: run even when the feature is off (only the AI panel's "Try it" uses this).
export async function runAi(task, payload, ctx = {}, { force = false } = {}) {
    const feature = FEATURE_FOR_TASK[task];
    const mode = feature ? featureMode(feature) : 'off';
    if (mode === 'off' && !force) return { ok: false, off: true, mode };
    try {
        const { data, error } = await db.functions.invoke('ol-ai', { body: { task, payload, mode: mode === 'shadow' ? 'shadow' : 'suggest', ctx } });
        if (error || !data || data.error) return { ok: false, mode, error: data?.message || data?.error || error?.message || 'The AI could not answer.' };
        return { ok: true, mode, shadow: mode === 'shadow', result: data.result, runId: data.runId, secretsRemoved: Number(data.secretsRemoved) || 0 };
    } catch (e) { return { ok: false, mode, error: String(e?.message || e) }; }
}
