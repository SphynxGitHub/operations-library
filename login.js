import { db } from './core/data.js';

// Already signed in? Skip straight to the app.
const { data: { session } } = await db.auth.getSession();
if (session) window.location.href = 'index.html';

const form = document.getElementById('loginForm');
const errorEl = document.getElementById('loginError');

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
