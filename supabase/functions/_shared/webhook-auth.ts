// Shared-secret check for the functions that OTHER SYSTEMS call (Zapier, Make, Zoom):
// error-webhook, add-task-webhook, resource-webhook, add-zoom-summary-webhook.
// Those callers have no Sphynx login, so they prove themselves with a secret sent in a header:
//     x-webhook-secret: <the value of the WEBHOOK_SECRET function secret>
//
// It can be switched on in two steps so nothing stops working the day you deploy it:
//   1. WEBHOOK_ENFORCE is not "true": a call without the right secret is still allowed, but is written
//      to the function log as "UNAUTHENTICATED webhook call". Use this while you add the header to each
//      Zap, then watch the log until those lines stop.
//   2. WEBHOOK_ENFORCE = "true": a call without the right secret gets 401 and nothing happens.
// If enforcing is on but WEBHOOK_SECRET is missing, every call is refused (503) rather than let through.
// Pure logic, so it can be tested on its own.

import { safeEqual } from "./auth.ts";

export type WebhookCheck =
  | { ok: true; authenticated: boolean }
  | { ok: false; status: 401 | 503; error: "unauthorized" | "misconfigured"; message: string };

export function checkWebhookSecret(
  req: Request,
  env: { secret?: string | null; enforce?: string | null },
  functionName = "webhook",
): WebhookCheck {
  const secret = env.secret || "";
  const enforcing = String(env.enforce || "").toLowerCase() === "true";
  const sent = (req.headers.get("x-webhook-secret") || "").trim();

  if (secret && sent && safeEqual(sent, secret)) return { ok: true, authenticated: true };

  if (enforcing) {
    if (!secret) {
      return { ok: false, status: 503, error: "misconfigured", message: "This webhook is set to require a secret, but no WEBHOOK_SECRET is configured." };
    }
    return { ok: false, status: 401, error: "unauthorized", message: "Missing or wrong x-webhook-secret header." };
  }

  console.warn(`UNAUTHENTICATED webhook call to ${functionName} allowed, because WEBHOOK_ENFORCE is not "true". Add the x-webhook-secret header to the sender, then turn enforcing on.`);
  return { ok: true, authenticated: false };
}
