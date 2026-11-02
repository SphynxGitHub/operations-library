// supabase/functions/_shared/secret-scrub.ts  (same rules as core/secret-scrub.js; keep them in step)
// Clients sometimes email passwords or API keys. This removes them from text BEFORE it is sent to the AI and
// BEFORE it is stored. It is rules only (no AI) and errs on the side of removing too much.
//
// scrubSecrets(text) -> { text, removed }   removed = how many places were replaced with "[secret removed]"
//

export const REMOVED = '[secret removed]';

// "password: abc", "pw is abc", "api key - abc", "token=abc", "login password is: abc". Everything after the
// label up to the end of the line is treated as the secret.
const LABELLED = /\b((?:my\s+|the\s+|new\s+|temp(?:orary)?\s+)?(?:pass(?:word|phrase|code)?|pwd|pw|passwd|api[\s_-]?key|apikey|secret(?:[\s_-]?key)?|access[\s_-]?token|auth[\s_-]?token|bearer|token|client[\s_-]?secret|private[\s_-]?key|pin)\b(?:\s+(?:is|are|was)\s*:?\s*|\s*[=:]\s*|\s+[-–—]\s+))(?!\[secret removed\])(\S[^\r\n]*)/gi;

// Well-known key shapes, wherever they appear.
const PREFIXED = [
    /\bsk-[A-Za-z0-9_-]{16,}\b/g,                    // OpenAI / Anthropic style
    /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{12,}\b/g, // Stripe
    /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,             // Slack
    /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,               // GitHub
    /\bAKIA[0-9A-Z]{16}\b/g,                         // AWS access key id
    /\bAIza[0-9A-Za-z_-]{30,}\b/g,                   // Google API key
    /\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, // JWT
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
];

// A long unbroken run that looks random: 24+ characters of letters and digits that mixes both, or 32+ hex.
const LONG_RANDOM = /\b(?=[A-Za-z0-9+/_=-]{24,}\b)(?=[A-Za-z0-9+/_=-]*[A-Za-z])(?=[A-Za-z0-9+/_=-]*\d)[A-Za-z0-9+/_=-]{24,}\b/g;
const LONG_HEX = /\b[0-9a-fA-F]{32,}\b/g;

// Links and file names are long but harmless, so skip anything that sits inside a URL or an email address.
function isInsideLinkOrEmail(text: string, start: number, end: number): boolean {
    const before = text.slice(Math.max(0, start - 200), start);
    const after = text.slice(end, end + 1);
    const lastSpace = Math.max(before.lastIndexOf(' '), before.lastIndexOf('\n'), before.lastIndexOf('\t'));
    const token = before.slice(lastSpace + 1);
    return /^(?:https?:\/\/|www\.)/i.test(token) || /@/.test(token) || after === '@';
}

export function scrubSecrets(input: unknown): { text: string; removed: number } {
    let text = String(input ?? '');
    let removed = 0;

    text = text.replace(LABELLED, (_m: string, label: string) => { removed += 1; return `${label}${REMOVED}`; });

    for (const re of PREFIXED) {
        text = text.replace(re, () => { removed += 1; return REMOVED; });
    }

    for (const re of [LONG_RANDOM, LONG_HEX]) {
        text = text.replace(re, (m: string, offset: number, whole: string) => {
            if (isInsideLinkOrEmail(whole, offset, offset + m.length)) return m;
            removed += 1;
            return REMOVED;
        });
    }

    return { text, removed };
}
