OL.renderBusinessCommunications = function() {
    const main = document.getElementById("mainContent");
    if (!main) return;
    main.innerHTML = `
        <div class="section-header">
            <div>
                <h2>✉️ Communications Center</h2>
                <div class="small muted">Connect Gmail API & Quo Webhook endpoints</div>
            </div>
        </div>
        <div class="card" style="padding: 30px; text-align: center;">
            <i data-lucide="mail" style="width: 48px; height: 48px; color: var(--accent); margin-bottom: 15px;"></i>
            <h3>API Integration Ready</h3>
            <p class="muted small" style="max-width: 400px; margin: 0 auto 20px auto;">
                Connect your OAuth tokens for Gmail or hook your Quo API credentials to manage all client threads from a single inbox.
            </p>
            <button class="btn primary">Configure API Keys</button>
        </div>
    `;
    if (window.lucide) lucide.createIcons();
};
