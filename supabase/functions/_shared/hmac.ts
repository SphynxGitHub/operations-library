// Signs a run id so the Zap can prove its answer belongs to a real, pending AI run. No secret needs to be stored in Zapier:
// the token is made per run by ol-ai (sent to the Zap in the request) and checked by ol-ai-callback.
export async function runToken(runId: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(runId));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
