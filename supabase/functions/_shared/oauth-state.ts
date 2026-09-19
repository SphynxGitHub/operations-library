// A signed "state" value for the Connect Google Account and Connect Zoom flows.
//
// Why: the connect flows end at a callback that saves whoever just signed in with Google or Zoom
// as THE connected account. Without a check, anyone could start the flow with their own account
// and replace yours. So the flow now starts only for a signed-in Sphynx person, the start step
// hands out a signed state, and the callback refuses anything that does not carry a valid one.
//
// The state is: base64url(json) + "." + base64url(HMAC-SHA256). It names the provider (so a Zoom
// state cannot be used on the Google callback), the person who started it, and an expiry.
// The signing key is derived from the project's service role key, which never leaves the server.
// Pure code (Web Crypto only), so it can be tested on its own.

export type Provider = "google" | "zoom";
export const STATE_LIFETIME_MS = 10 * 60 * 1000;

const enc = new TextEncoder();

function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(text: string): Uint8Array {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return await crypto.subtle.importKey("raw", enc.encode("oauth-state-v1:" + secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function signState(secret: string, provider: Provider, userId: string, now = Date.now()): Promise<string> {
  if (!secret) throw new Error("No signing secret available");
  const payload = { p: provider, u: userId, exp: now + STATE_LIFETIME_MS, n: crypto.randomUUID() };
  const body = b64urlEncode(enc.encode(JSON.stringify(payload)));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(body)));
  return `${body}.${b64urlEncode(sig)}`;
}

export type StateCheck = { ok: true; userId: string } | { ok: false; reason: "missing" | "malformed" | "bad_signature" | "wrong_provider" | "expired" };

export async function verifyState(secret: string, state: string | null | undefined, provider: Provider, now = Date.now()): Promise<StateCheck> {
  if (!state) return { ok: false, reason: "missing" };
  const parts = String(state).split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: "malformed" };
  let sig: Uint8Array;
  let payload: any;
  try {
    sig = b64urlDecode(parts[1]);
    payload = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[0])));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  const valid = await crypto.subtle.verify("HMAC", await hmacKey(secret), sig, enc.encode(parts[0]));
  if (!valid) return { ok: false, reason: "bad_signature" };
  if (payload?.p !== provider) return { ok: false, reason: "wrong_provider" };
  if (typeof payload?.exp !== "number" || now > payload.exp) return { ok: false, reason: "expired" };
  return { ok: true, userId: String(payload.u || "") };
}
