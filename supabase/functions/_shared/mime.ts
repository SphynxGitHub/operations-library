// Builds the raw email message the Gmail API sends. Pure code: no network, no Deno APIs, so it
// can be tested on its own.
//
// Plain messages come out exactly as before. When attachments are given, the message becomes
// multipart/mixed: the text as one part and each file as its own base64 part.

export type AttachmentInput = { filename?: string; mimeType?: string; contentBase64?: string };
export type Attachment = { filename: string; mimeType: string; base64: string; bytes: number };

export const MAX_ATTACHMENTS = 5;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;   // 10 MB each
export const MAX_TOTAL_ATTACHMENT_BYTES = 15 * 1024 * 1024;
// Only document and image types. This endpoint should never be a way to send arbitrary files.
export const ALLOWED_MIME_TYPES = [
  "application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp", "text/plain", "text/csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",   // .docx
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",         // .xlsx
  "application/vnd.openxmlformats-officedocument.presentationml.presentation", // .pptx
  "application/msword", "application/vnd.ms-excel"
];

// Line breaks in a header value would let a caller add headers of their own (for example a
// hidden Bcc), so they are removed. Control characters go too.
export function sanitizeHeaderValue(value: unknown): string {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s{2,}/g, " ").trim();
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64UrlEncode(str: string): string {
  return bytesToBase64(new TextEncoder().encode(str)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Subject headers must be ASCII: anything else is wrapped as an RFC 2047 encoded word.
export function encodeSubjectIfNeeded(subject: string): string {
  if (/^[\x00-\x7F]*$/.test(subject)) return subject;
  return `=?UTF-8?B?${bytesToBase64(new TextEncoder().encode(subject))}?=`;
}

// Base64 in lines of 76 characters, as email requires.
export function wrapBase64(b64: string): string {
  return (b64.match(/.{1,76}/g) || []).join("\r\n");
}

function cleanFilename(name: string | undefined): string {
  const base = String(name ?? "").split(/[\\/]/).pop() || "";
  const cleaned = base.replace(/[\u0000-\u001f\u007f"\\;]+/g, "").trim().slice(0, 120);
  return cleaned || "attachment";
}

// Returns the cleaned attachments, or an error message to send back with a 400.
export function validateAttachments(input: unknown): { attachments: Attachment[] } | { error: string } {
  if (input === undefined || input === null) return { attachments: [] };
  if (!Array.isArray(input)) return { error: "attachments must be a list" };
  if (input.length > MAX_ATTACHMENTS) return { error: `at most ${MAX_ATTACHMENTS} attachments` };

  const out: Attachment[] = [];
  let total = 0;
  for (const raw of input as AttachmentInput[]) {
    const mimeType = String(raw?.mimeType || "application/pdf").toLowerCase().trim();
    if (!ALLOWED_MIME_TYPES.includes(mimeType)) return { error: `attachment type ${mimeType} is not allowed` };

    // accept a data URI too: data:application/pdf;base64,....
    const b64 = String(raw?.contentBase64 || "").replace(/^data:[^,]*,/, "").replace(/\s+/g, "");
    if (!b64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64) || b64.length % 4 !== 0) return { error: "attachment content is not valid base64" };

    const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
    const bytes = (b64.length / 4) * 3 - padding;
    if (bytes > MAX_ATTACHMENT_BYTES) return { error: "an attachment is over 10 MB" };
    total += bytes;
    if (total > MAX_TOTAL_ATTACHMENT_BYTES) return { error: "attachments total more than 15 MB" };

    out.push({ filename: cleanFilename(raw?.filename), mimeType, base64: b64, bytes });
  }
  return { attachments: out };
}

// filename="report.pdf"; filename*=UTF-8''percent-encoded  (the second form carries non-ASCII names)
function dispositionFor(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, "_");
  const star = encodeURIComponent(filename).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
  return `attachment; filename="${ascii}"; filename*=UTF-8''${star}`;
}

export type MessageInput = {
  from: string; to: string; cc?: string | null; bcc?: string | null; subject: string; body: string;
  html?: string | null;   // when given, sent as multipart/alternative (plain text + HTML)
  inReplyTo?: string | null; references?: string | null; attachments?: Attachment[];
  boundary?: string;
};

// The text part(s): plain only (unchanged), or plain + HTML as alternatives.
function bodyPart(m: MessageInput, altBoundary: string): { header: string; content: string } {
  const b64 = (t: string) => wrapBase64(bytesToBase64(new TextEncoder().encode(t)));
  if (!m.html) {
    return { header: `Content-Type: text/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: base64`, content: b64(m.body) };
  }
  const html = `<!DOCTYPE html><html><body style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#222;">${m.html}</body></html>`;
  return {
    header: `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
    content:
      `--${altBoundary}\r\nContent-Type: text/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64(m.body)}\r\n` +
      `--${altBoundary}\r\nContent-Type: text/html; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64(html)}\r\n` +
      `--${altBoundary}--`
  };
}

export function buildRawMessage(m: MessageInput): string {
  const attachments = m.attachments || [];
  const boundary = m.boundary || `sphynx-${crypto.randomUUID().replace(/-/g, "")}`;
  const altBoundary = `${boundary}-alt`;
  if (m.html) {
    // HTML messages always use the part-based layout below.
    const headers = [
      `From: ${sanitizeHeaderValue(m.from)}`,
      `To: ${sanitizeHeaderValue(m.to)}`,
      ...(m.cc ? [`Cc: ${sanitizeHeaderValue(m.cc)}`] : []),
      ...(m.bcc ? [`Bcc: ${sanitizeHeaderValue(m.bcc)}`] : []),
      `Subject: ${encodeSubjectIfNeeded(sanitizeHeaderValue(m.subject))}`,
      `MIME-Version: 1.0`,
    ];
    if (m.inReplyTo) headers.push(`In-Reply-To: ${sanitizeHeaderValue(m.inReplyTo)}`);
    if (m.references) headers.push(`References: ${sanitizeHeaderValue(m.references)}`);
    const bp = bodyPart(m, altBoundary);
    if (attachments.length === 0) {
      return headers.join("\r\n") + "\r\n" + bp.header + "\r\n\r\n" + bp.content + "\r\n";
    }
    const parts = [`--${boundary}\r\n${bp.header}\r\n\r\n${bp.content}`];
    for (const a of attachments) {
      const asciiName = a.filename.replace(/[^\x20-\x7E]/g, "_");
      parts.push(
        `--${boundary}\r\n` +
        `Content-Type: ${a.mimeType}; name="${asciiName}"\r\n` +
        `Content-Disposition: ${dispositionFor(a.filename)}\r\n` +
        `Content-Transfer-Encoding: base64\r\n\r\n` +
        wrapBase64(a.base64)
      );
    }
    return headers.join("\r\n") + `\r\nContent-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n` + parts.join("\r\n") + `\r\n--${boundary}--\r\n`;
  }

  const contentType = attachments.length === 0
    ? `Content-Type: text/plain; charset="UTF-8"`
    : `Content-Type: multipart/mixed; boundary="${boundary}"`;

  // same header order as the original function
  const headers = [
    `From: ${sanitizeHeaderValue(m.from)}`,
    `To: ${sanitizeHeaderValue(m.to)}`,
    ...(m.cc ? [`Cc: ${sanitizeHeaderValue(m.cc)}`] : []),
    ...(m.bcc ? [`Bcc: ${sanitizeHeaderValue(m.bcc)}`] : []),
    `Subject: ${encodeSubjectIfNeeded(sanitizeHeaderValue(m.subject))}`,
    contentType,
    `MIME-Version: 1.0`,
  ];
  if (m.inReplyTo) headers.push(`In-Reply-To: ${sanitizeHeaderValue(m.inReplyTo)}`);
  if (m.references) headers.push(`References: ${sanitizeHeaderValue(m.references)}`);

  if (attachments.length === 0) {
    return headers.join("\r\n") + "\r\n\r\n" + m.body;   // unchanged from the original function
  }

  const parts: string[] = [];
  parts.push(
    `--${boundary}\r\n` +
    `Content-Type: text/plain; charset="UTF-8"\r\n` +
    `Content-Transfer-Encoding: base64\r\n\r\n` +
    wrapBase64(bytesToBase64(new TextEncoder().encode(m.body)))
  );
  for (const a of attachments) {
    const asciiName = a.filename.replace(/[^\x20-\x7E]/g, "_");
    parts.push(
      `--${boundary}\r\n` +
      `Content-Type: ${a.mimeType}; name="${asciiName}"\r\n` +
      `Content-Disposition: ${dispositionFor(a.filename)}\r\n` +
      `Content-Transfer-Encoding: base64\r\n\r\n` +
      wrapBase64(a.base64)
    );
  }
  return headers.join("\r\n") + "\r\n\r\n" + parts.join("\r\n") + `\r\n--${boundary}--\r\n`;
}
