import { db } from './core/data.js';

// Already signed in? Skip straight to the app.
const { data: { session } } = await db.auth.getSession();
if (session) window.location.href = 'index.html';

const form = document.getElementById('loginForm');
const errorEl = document.getElementById('loginError');

// Back from the confirmation email. If Supabase signed them in on the way back, the session check
// above has already sent them into the app. If the link had already been used or had expired, Supabase
// says so in the address (#error_description=...), so show that instead of a false "confirmed".
const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
const linkError = hashParams.get('error_description') || hashParams.get('error');
if (linkError) {
    const expired = /expired|invalid/i.test(linkError) || hashParams.get('error_code') === 'otp_expired';
    errorEl.textContent = expired
        ? 'That confirmation link has already been used or has expired. If you clicked it before, your email is probably already confirmed: try signing in below. If sign-in says the email is not confirmed, ask Sphynx for a new setup link.'
        : `The confirmation link didn't work: ${linkError}. Try signing in below, or ask Sphynx for a new setup link.`;
    errorEl.style.display = 'block';
    history.replaceState(null, '', window.location.pathname);
} else if (new URLSearchParams(window.location.search).get('confirmed')) {
    errorEl.textContent = 'Email confirmed. Sign in with the password you just created.';
    errorEl.style.color = '#22c55e';
    errorEl.style.display = 'block';
}

// Sent here from an old ?access=... share link, which no longer opens a workspace.
if (new URLSearchParams(window.location.search).get('legacy')) {
    errorEl.textContent = 'That old share link no longer works. Sign in below, or ask Sphynx for a new login link.';
    errorEl.style.display = 'block';
}

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.style.display = 'none';

    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;

    const { error } = await db.auth.signInWithPassword({ email, password });
    if (error) {
        errorEl.textContent = error.message;
        errorEl.style.display = 'block';
        return;
    }

    window.location.href = 'index.html';
});
