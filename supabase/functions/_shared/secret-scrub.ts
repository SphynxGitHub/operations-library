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

// What follows a label is only treated as a secret when it looks like one. "The API key is full scope and inherits the
// permissions of the account" is a sentence ABOUT a key, not a key. A value is left alone when it starts like prose
// (full, the, required, ...) or when it is a long line whose first word is a plain word. Otherwise the line is removed.
const PROSE_START = new Set<string>(['a','an','the','this','that','these','those','it','its','is','are','was','be','been','not','no','never','only','also','just','still','full','read','write','read-only','readonly','limited','scoped','scope','required','requires','optional','needed','missing','expired','expires','invalid','valid','wrong','correct','working','broken','stored','saved','shown','hidden','visible','tied','linked','attached','used','set','created','generated','found','available','different','same','unique','shared','private','public','sensitive','secret','like','as','in','on','at','to','for','from','with','by','of','and','or','but','if','when','what','how','why','which','who','used','case-sensitive','long','short','safe','secure']);
function looksLikeSecret(value: unknown): boolean {
    const v = String(value || '').trim();
    if (!v) return false;
    const words = v.split(/\s+/);
    const first = words[0].replace(/^["'`(]+|["'`).,;!?]+$/g, '');
    if (PROSE_START.has(first.toLowerCase())) return false;
    const hasDigitOrSymbol = /[\d_@#$%^&*+=!~\\/|<>-]/.test(first) && first.length >= 3;
    if (hasDigitOrSymbol) return true;
    if (words.length > 4) return false;   // a plain word followed by a long sentence is prose
    return true;                           // short and plain ("password is blue horse"): remove it, better safe
}

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

    text = text.replace(LABELLED, (m: string, label: string, value: string) => { if (!looksLikeSecret(value)) return m; removed += 1; return `${label}${REMOVED}`; });

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
