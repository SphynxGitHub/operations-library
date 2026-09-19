// Shared by get-gmail-messages and get-calendar-events.
//
// The original functions read `access_token` straight from
// `google_auth_tokens` and called Google with it directly. Google access
// tokens expire ~1 hour after login, and nothing was ever refreshing them
// using the stored `refresh_token` — so any sync more than ~an hour after
// the last "Connect Google Account" click would silently fail. This is why
// it worked right after connecting and then looked "disconnected" later.

export class GoogleAuthError extends Error {}

export async function getFreshGoogleAccessToken(supabase: any): Promise<string> {
  const { data: tokenData, error: dbError } = await supabase
    .from("google_auth_tokens")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(1)
    .single();

  if (dbError || !tokenData) {
    throw new GoogleAuthError("No connected Google account. Please reconnect.");
  }

  const expiresAtMs = tokenData.expires_at ? new Date(tokenData.expires_at).getTime() : 0;
  const bufferMs = 60 * 1000; // refresh a little early to avoid edge-of-expiry 401s
  const isExpired = !expiresAtMs || (Date.now() + bufferMs) >= expiresAtMs;

  if (!isExpired) {
    return tokenData.access_token as string;
  }

  if (!tokenData.refresh_token) {
    throw new GoogleAuthError("Google token expired and there's no refresh token stored. Please reconnect.");
  }

  const clientId = Deno.env.get("GOOGLE_CLIENT_ID")!;
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET")!;

  const refreshRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: tokenData.refresh_token,
      grant_type: "refresh_token",
    }),
  });

  const refreshed = await refreshRes.json();

  if (refreshed.error) {
    // The refresh token itself is dead (revoked, expired, or scopes changed) --
    // the only fix at that point is clicking "Connect Google Account" again.
    throw new GoogleAuthError(
      `Google refresh failed (${refreshed.error}): ${refreshed.error_description || "please reconnect the Google account."}`
    );
  }

  const newAccessToken = refreshed.access_token as string;
  const newExpiresAt = new Date(Date.now() + (refreshed.expires_in ?? 3600) * 1000).toISOString();

  const { error: updateError } = await supabase
    .from("google_auth_tokens")
    .update({
      access_token: newAccessToken,
      expires_at: newExpiresAt,
      // Google only sends a new refresh_token occasionally -- keep the old one otherwise
      ...(refreshed.refresh_token ? { refresh_token: refreshed.refresh_token } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("email", tokenData.email);

  if (updateError) {
    // Not fatal for this request -- we still have a valid token in hand -- but
    // worth knowing about, since it means next call will refresh again unnecessarily.
    console.error("Failed to persist refreshed Google token:", updateError);
  }

  return newAccessToken;
}
