import { db } from './core/data.js';

// Already signed in? Skip straight to the app.
const { data: { session } } = await db.auth.getSession();
if (session) window.location.href = 'index.html';

const form = document.getElementById('loginForm');
const errorEl = document.getElementById('loginError');

// Back from the confirmation email. If Supabase signed them in on the way back, the session check
// above has already sent them into the app; otherwise ask them to sign in.
if (new URLSearchParams(window.location.search).get('confirmed')) {
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
