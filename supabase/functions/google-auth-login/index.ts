// ================================================================================================
// FUNCTION: google-auth-login
//
// WHAT IT DOES:   Starts Connect Google Account. It sends the browser to Google's
//                 permission screen, asking for: read mail, send mail, change mail
//                 (archive, restore, Trash, labels), Google Calendar, and the account
//                 email. Google then returns to google-auth-callback, which stores the
//                 connection.
//
// CALLED BY:      The Connect Google Account button in Gmail Settings.
//
// WHO CAN CALL:   Anyone, on purpose: it is a page redirect with no login header, and
//                 it only starts Google's own sign-in. Protecting it needs a different
//                 approach and is still to do.
//
// READS/CHANGES:  Nothing in the database. It only redirects.
//
// NEEDS:          The GOOGLE_CLIENT_ID and GOOGLE_REDIRECT_URI secrets. Any permission
//                 added here only takes effect after the Google account is
//                 reconnected, and must also be listed on the consent screen in Google
//                 Cloud Console.
//
// CHANGED FROM THE ORIGINAL: Added the gmail.modify permission, which archive,
//                            restore, delete and auto-labeling need.
// ================================================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

serve(async () => {
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const redirectUri = Deno.env.get("GOOGLE_REDIRECT_URI");

  const scopes = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    // Needed to archive, restore and delete (move to Trash) mail, and to add labels. Without it Gmail
    // answers "insufficient authentication scopes" for those. Connecting again is what grants it.
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/userinfo.email"
  ];

  // Scopes MUST be space-separated
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
    `client_id=${clientId}` +
    `&redirect_uri=${encodeURIComponent(redirectUri!)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent(scopes.join(" "))}` + 
    `&access_type=offline` +
    `&prompt=consent`;

  return Response.redirect(authUrl, 302);
});
