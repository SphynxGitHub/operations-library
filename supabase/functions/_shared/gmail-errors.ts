// Reading Gmail's error answers.

// Gmail answers 403 both when the connected account has not granted the app enough permission
// (a "scope") and for other reasons such as rate limits. Only the first one means "reconnect Google".
export function isInsufficientScope(errorText: string): boolean {
  return /ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficientPermissions|insufficient authentication scopes/i.test(String(errorText || ""));
}

export const INSUFFICIENT_SCOPE_MESSAGE =
  "Google has not given this app permission to change your mail yet. Reconnect the Google account (Gmail Settings, then Connect Google Account) to grant it.";
