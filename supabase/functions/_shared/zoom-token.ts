// Shared by sync-zoom-meetings. Mirrors _shared/google-token.ts: Zoom
// access tokens expire quickly (1 hour), so every call refreshes using the
// stored refresh_token if the current one is expired or close to it.

export class ZoomAuthError extends Error {}

export async function getFreshZoomAccessToken(supabase: any): Promise<string> {
  const { data: tokenData, error: dbError } = await supabase
    .from("zoom_auth_tokens")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(1)
    .single();

  if (dbError || !tokenData) {
    throw new ZoomAuthError("No connected Zoom account. Please reconnect.");
  }

  const expiresAtMs = tokenData.expires_at ? new Date(tokenData.expires_at).getTime() : 0;
  const bufferMs = 60 * 1000; // refresh a little early to avoid edge-of-expiry 401s
  const isExpired = !expiresAtMs || (Date.now() + bufferMs) >= expiresAtMs;

  if (!isExpired) {
    return tokenData.access_token as string;
  }

  const clientId = Deno.env.get("ZOOM_CLIENT_ID")!;
  const clientSecret = Deno.env.get("ZOOM_CLIENT_SECRET")!;
  const basicAuth = btoa(`${clientId}:${clientSecret}`);

  const refreshRes = await fetch("https://zoom.us/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basicAuth}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokenData.refresh_token,
    }),
  });

  const refreshed = await refreshRes.json();

  if (refreshed.error) {
    // Refresh token itself is dead (revoked/expired) -- only fix is
    // clicking "Connect Zoom Account" again.
    throw new ZoomAuthError(
      `Zoom refresh failed (${refreshed.error}): ${refreshed.reason || "please reconnect the Zoom account."}`
    );
  }

  const newAccessToken = refreshed.access_token as string;
  const newExpiresAt = new Date(Date.now() + (refreshed.expires_in ?? 3600) * 1000).toISOString();

  const { error: updateError } = await supabase
    .from("zoom_auth_tokens")
    .update({
      access_token: newAccessToken,
      // Zoom rotates the refresh token on every refresh -- always store the new one.
      refresh_token: refreshed.refresh_token ?? tokenData.refresh_token,
      expires_at: newExpiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq("email", tokenData.email);

  if (updateError) {
    console.error("Failed to persist refreshed Zoom token:", updateError);
  }

  return newAccessToken;
}
