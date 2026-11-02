//======================= CORE / AI FLAGS =======================//
// Every AI feature has a mode and starts "off". shadow = it runs quietly and only logs what it would have suggested,
// so it can be compared with what people did. suggest = it shows suggestions for a person to approve.
// Nothing here ever changes work by itself. Modes live in the org settings (olSettings.ai), edited from the AI panel.

export const AI_MODES = ['off', 'shadow', 'suggest'];

export const AI_FEATURES = [
    { key: 'recap',         label: 'Meeting recap items',        help: 'Matches the Recap Items section of a Zoom summary to resources, requests and tasks, and checks action items for duplicates.', shadow: false },
    { key: 'email',         label: 'Email suggestions',          help: 'Reads only the new text of a client email and suggests requests, changes or notes. Shadow mode logs silently for about two weeks.', shadow: true },
    { key: 'email_review',  label: 'Review requests in Gmail',   help: 'Notices when a review request was sent from Gmail instead of the app and offers to record it.', shadow: true },
    { key: 'holding_reply', label: 'Holding-reply due dates',    help: 'When a client says "I will send it Friday", suggests moving the follow-up to the day after.', shadow: true },
    { key: 'test_scenarios', label: 'Testing scenarios',         help: 'Drafts scenarios, sample data and expected results from the scope outline and build details.', shadow: false },
    { key: 'suggested_asks', label: 'Suggested asks',            help: 'Lists what is likely to be needed from the client before and after scoping.', shadow: false },
    { key: 'lead_intent',   label: 'Lead intent reading',        help: 'Reads a lead email as quote wanted, paid scoping, intro call or unclear.', shadow: true },
    { key: 'howto',         label: 'How-to guides',              help: 'Drafts the client how-to guide and onboarding / offboarding templates after testing passes.', shadow: false },
    { key: 'ask_notes',     label: 'Ask anything (notes search)', help: 'Search all notes by question, and optionally have the AI answer from the best matches with the notes cited.', shadow: false },
    { key: 'history',       label: 'Resource history entries',   help: 'Drafts a history entry for the resource when a task closes.', shadow: false },
];
export const AI_FEATURE_KEYS = AI_FEATURES.map((f) => f.key);

export function aiModes(settings) {
    const saved = (settings && settings.ai) || {};
    const out = {};
    AI_FEATURES.forEach((f) => {
        const m = saved[f.key];
        out[f.key] = AI_MODES.includes(m) && (m !== 'shadow' || f.shadow) ? m : 'off';
    });
    return out;
}
export const aiMode = (settings, key) => aiModes(settings)[key] || 'off';
export const aiIsOn = (settings, key) => aiMode(settings, key) !== 'off';
export const aiShowsSuggestions = (settings, key) => aiMode(settings, key) === 'suggest';
