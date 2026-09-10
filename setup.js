import { db } from './core/data.js';

const params = new URLSearchParams(window.location.search);
const token = params.get('token');
const shell = document.getElementById('setupShell');
const form = document.getElementById('setupForm');
const errorEl = document.getElementById('setupError');

if (!token) {
    shell.innerHTML = '<p>This setup link is missing its token — ask for a fresh invite link.</p>';
} else {
    // Prefill the email that was set when the link was generated, if any.
    const { data: prefillEmail } = await db.rpc('get_setup_email', { p_token: token });
    if (prefillEmail) {
        document.getElementById('email').value = prefillEmail;
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        errorEl.style.display = 'none';

        const email = document.getElementById('email').value.trim();
        const password = document.getElementById('password').value;
        const confirmPassword = document.getElementById('confirmPassword').value;

        if (password !== confirmPassword) {
            errorEl.textContent = "Passwords don't match.";
            errorEl.style.display = 'block';
            return;
        }

        const { data: signUpData, error: signUpError } = await db.auth.signUp({ email, password });
        if (signUpError) {
            errorEl.textContent = signUpError.message;
            errorEl.style.display = 'block';
            return;
        }

        const { error: claimError } = await db.rpc('claim_client_setup', {
            p_token: token,
            p_auth_user_id: signUpData.user.id
        });

        if (claimError) {
            errorEl.textContent = 'Account created, but the setup link could not be claimed: ' + claimError.message + '. Contact support rather than retrying.';
            errorEl.style.display = 'block';
            return;
        }

        const { data: { session } } = await db.auth.getSession();
        if (session) {
            window.location.href = 'index.html';
        } else {
            shell.innerHTML = '<p>Account created! Check your email to confirm it, then <a href="login.html">sign in</a>.</p>';
        }
    });
}
