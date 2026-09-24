//======================= CORE / PREVIEW ("VIEW AS") =======================//
// Lets an admin see exactly what a client or partner sees when they log in.
//
// How it works
//   - The admin clicks "Preview" on a project. That opens this app in a NEW TAB with
//     ?preview=<projectId>. The admin's own tab is untouched.
//   - In the new tab the admin stays signed in as themselves, but core/auth.js sets up the
//     app exactly as if that project's own login had just signed in (same flags, same
//     limited view of the master registry, same project scoping). All the existing
//     "what does a client/partner get to see" rules therefore run unchanged.
//   - The preview is READ-ONLY. Every write to the database goes through the guard below,
//     which refuses it. The admin's real permissions would otherwise let a stray click in
//     the preview edit a real client's data.
//   - The project id is kept in sessionStorage, so reloading the preview tab stays in the
//     preview, and closing the tab ends it. Nothing is stored on the server.
//
// This file must not import anything from data.js: data.js imports it (for the fetch
// guard), and a cycle would break module loading.

const STORAGE_KEY = 'ol_preview_as';
const PARAM = 'preview';

// The real fetch, captured before we (maybe) replace window.fetch below.
export const realFetch = window.fetch.bind(window);

let target = null;   // { clientId } while this tab is a preview tab
let info = null;     // { name, kind } once the preview session has been set up

// ---- read the target from the URL / this tab's sessionStorage (runs once, on load) ----
(function readTarget() {
    try {
        const url = new URL(window.location.href);
        const fromUrl = url.searchParams.get(PARAM);
        if (fromUrl) {
            sessionStorage.setItem(STORAGE_KEY, fromUrl);
            url.searchParams.delete(PARAM);
            // Drop the parameter from the address bar; sessionStorage remembers it for this tab.
            history.replaceState(null, '', url.pathname + url.search + url.hash);
        }
        const stored = sessionStorage.getItem(STORAGE_KEY);
        if (stored) target = { clientId: stored };
    } catch (e) { /* storage blocked: no preview, normal app */ }
})();

export const isPreviewActive = () => !!target;
export const getPreviewTarget = () => target;

// Called when the target turns out to be unusable (not an admin, project missing).
export function clearPreviewTarget() {
    target = null;
    info = null;
    try { sessionStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
    document.getElementById('ol-preview-banner')?.remove();
    document.getElementById('ol-preview-frame')?.remove();
}

// ---- the read-only guard ----
// Reads (GET/HEAD) always pass. Anything else is refused, except the few POSTs that only read
// or that keep the admin's own sign-in alive.
const ALLOWED_NON_READS = [
    /\/auth\/v1\/token/,                          // session refresh
    /\/rest\/v1\/rpc\/ol_master_for_clients/,     // the limited master registry a client/partner gets
];

let lastNotice = 0;
export function notifyPreviewBlocked() {
    const now = Date.now();
    if (now - lastNotice < 15000) return;         // one notice at a time, not one per blocked call
    lastNotice = now;
    const el = document.createElement('div');
    el.textContent = 'Preview is read-only, so that change was not saved.';
    el.style.cssText = 'position:fixed;bottom:64px;left:50%;transform:translateX(-50%);z-index:100001;' +
        'background:#1f2937;color:#fde68a;border:1px solid #fbbf24;padding:8px 14px;border-radius:8px;' +
        'font-size:12px;box-shadow:0 10px 25px -5px rgba(0,0,0,.5);';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 4000);
}

export function previewFetchGuard(fetchImpl, input, init) {
    if (!target) return fetchImpl(input, init);

    const isRequest = typeof Request !== 'undefined' && input instanceof Request;
    const method = String((init && init.method) || (isRequest && input.method) || 'GET').toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return fetchImpl(input, init);

    const url = String(isRequest ? input.url : (input && input.url) || input);
    if (ALLOWED_NON_READS.some((rx) => rx.test(url))) return fetchImpl(input, init);

    notifyPreviewBlocked();
    return Promise.resolve(new Response(
        JSON.stringify({ message: 'Preview is read-only, so this change was not saved.', code: 'preview_read_only' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
    ));
}

// Plain fetch() calls elsewhere in the app (edge functions) are covered too.
if (target) window.fetch = (input, init) => previewFetchGuard(realFetch, input, init);

// ---- start / stop ----
export function startPreview(clientId) {
    if (!clientId) return;
    const base = `${window.location.origin}${window.location.pathname}`;
    const url = `${base}?${PARAM}=${encodeURIComponent(clientId)}`;
    // noopener: the new tab starts with clean session storage and can't reach back into this one.
    window.open(url, '_blank', 'noopener');
}

export function exitPreview() {
    try { sessionStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
    const home = `${window.location.origin}${window.location.pathname}`;
    window.close();                                   // works for a tab opened by startPreview()
    setTimeout(() => { window.location.href = home; }, 150);   // still here: opened by hand, go back to the admin view
}

// ---- banner ----
export function mountPreviewBanner(details) {
    info = details;
    if (document.getElementById('ol-preview-banner')) return;

    const frame = document.createElement('div');
    frame.id = 'ol-preview-frame';
    frame.style.cssText = 'position:fixed;inset:0;border:3px solid #fbbf24;pointer-events:none;z-index:99998;';

    const bar = document.createElement('div');
    bar.id = 'ol-preview-banner';
    bar.style.cssText = 'position:fixed;bottom:14px;left:50%;transform:translateX(-50%);z-index:100000;' +
        'display:flex;align-items:center;gap:12px;background:#fbbf24;color:#111;padding:8px 8px 8px 16px;' +
        'border-radius:999px;font-size:12px;font-weight:600;box-shadow:0 10px 25px -5px rgba(0,0,0,.5);';
    const label = document.createElement('span');
    label.textContent = `Previewing as ${info.name} (${info.kind}) · read-only`;
    const btn = document.createElement('button');
    btn.textContent = 'Exit preview';
    btn.style.cssText = 'background:#111;color:#fbbf24;border:none;border-radius:999px;padding:6px 12px;font-size:12px;font-weight:700;cursor:pointer;';
    btn.addEventListener('click', exitPreview);
    bar.append(label, btn);

    document.body.append(frame, bar);
    document.title = `Preview: ${info.name}`;
}

// ---- bridge for inline onclick handlers ----
window.OL = window.OL || {};
Object.assign(window.OL, { startPreview, exitPreview, isPreviewSession: isPreviewActive });
