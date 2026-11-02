//======================= CORE / EMAIL CLEAN =======================//
// Keeps only the NEW text of an email, with no AI: quoted earlier messages, forwarded headers and the signature are cut.
// This is what stops the same request being flagged again in every reply of a thread. Also verifies that a quote the AI
// returned really appears in the email.

const CUT_LINES = [
    /^\s*On .{5,200}wrote:\s*$/i,
    /^\s*On .{5,200}$/i,                                   // first line of a wrapped "On ... wrote:"
    /^\s*-{2,}\s*Original Message\s*-{2,}\s*$/i,
    /^\s*-{2,}\s*Forwarded message\s*-{2,}\s*$/i,
    /^\s*_{5,}\s*$/,
    /^\s*From:\s.+$/i,
    /^\s*Sent from my .+$/i,
    /^\s*Get Outlook for .+$/i,
    /^\s*--\s*$/,
];

export function cleanEmailBody(text) {
    const lines = String(text || '').replace(/\r/g, '').split('\n');
    const out = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/^\s*On .{5,200}$/i.test(line) && !/wrote:\s*$/i.test(line)) {
            // only a cut when the next line finishes it ("... wrote:")
            if (!/wrote:\s*$/i.test(lines[i + 1] || '')) { out.push(line); continue; }
            break;
        }
        if (CUT_LINES.some((re, idx) => idx !== 1 && re.test(line))) break;
        if (/^\s*>/.test(line)) continue;
        out.push(line);
    }
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

const norm = (s) => String(s || '').toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();
// True when the quote is in the text (ignoring case, spacing and curly quotes).
export function quoteExists(quote, text) {
    const q = norm(quote);
    return q.length >= 4 && norm(text).includes(q);
}
