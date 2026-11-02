//======================= CORE / LEAD INTENT =======================//
// What a lead is asking for: quote, paid scoping, intro call, or unclear. A plain keyword reading is always available;
// the AI reading is checked against it and anything shaky becomes "unclear". It only suggests a lead task, never creates one.

export const INTENTS = ['quote', 'paid_scoping', 'intro_call', 'unclear'];
export const INTENT_LABEL = { quote: 'Wants a quote', paid_scoping: 'Wants paid scoping', intro_call: 'Wants an intro call', unclear: 'Unclear' };
export const INTENT_TASK_KIND = { quote: 'prepare_quote', paid_scoping: 'offer_paid_scoping', intro_call: null, unclear: null };

const RULES = [
    ['paid_scoping', /\b(paid (scoping|discovery|assessment)|scoping (session|engagement|call)|discovery (session|engagement)|audit first|assessment first)\b/i],
    ['quote', /\b(quote|proposal|estimate|pricing|how much|cost (for|to)|ballpark|price)\b/i],
    ['intro_call', /\b(intro(ductory)? call|introduction call|quick call|get on a call|hop on a call|chat sometime|schedule a (call|meeting)|book a (call|time)|discovery call)\b/i],
];
export function localIntent(text) {
    const t = String(text || '');
    const hits = RULES.filter(([, re]) => re.test(t)).map(([k]) => k);
    if (hits.length === 1) return { intent: hits[0], confidence: 'medium', source: 'rules' };
    if (hits.length > 1) return { intent: hits.includes('paid_scoping') ? 'paid_scoping' : hits.includes('quote') ? 'quote' : hits[0], confidence: 'low', source: 'rules' };
    return { intent: 'unclear', confidence: 'low', source: 'rules' };
}

export function normalizeIntent(ai, emailText = '') {
    const intent = INTENTS.includes(ai?.intent) ? ai.intent : 'unclear';
    const confidence = ['low', 'medium', 'high'].includes(ai?.confidence) ? ai.confidence : 'low';
    const quote = String(ai?.quote || '').slice(0, 400);
    const quoteOk = !quote || String(emailText).toLowerCase().replace(/\s+/g, ' ').includes(quote.toLowerCase().replace(/\s+/g, ' '));
    // Unclear when the AI is unsure, or its quote is not in the email.
    if (intent !== 'unclear' && (confidence === 'low' || !quoteOk)) return { intent: 'unclear', confidence: 'low', quote: '', source: 'ai', wasIntent: intent };
    return { intent, confidence, quote, source: 'ai' };
}
// Both readings: when they disagree the answer is unclear and the person decides.
export function combineIntent(ai, local) {
    if (!ai) return local;
    if (local.intent !== 'unclear' && ai.intent !== 'unclear' && local.intent !== ai.intent) return { ...ai, intent: 'unclear', confidence: 'low', disagreed: [local.intent, ai.intent] };
    return ai.intent === 'unclear' && local.intent !== 'unclear' ? { ...local, source: 'rules' } : ai;
}
