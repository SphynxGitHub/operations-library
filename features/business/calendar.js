OL.renderBusinessCalendar = function() {
    const main = document.getElementById("mainContent");
    if (!main) return;
    main.innerHTML = `
        <div class="section-header">
            <div>
                <h2>📅 Unified Calendar</h2>
                <div class="small muted">Google Calendar API Synchronization</div>
            </div>
        </div>
        <div class="card" style="padding: 30px; text-align: center;">
            <i data-lucide="calendar" style="width: 48px; height: 48px; color: var(--accent); margin-bottom: 15px;"></i>
            <h3>Google Calendar Integration</h3>
            <p class="muted small" style="max-width: 400px; margin: 0 auto 20px auto;">
                Sync your Google Calendar to view milestone deadlines, client meetings, and scheduled releases.
            </p>
            <button class="btn primary">Connect Google Calendar</button>
        </div>
    `;
    if (window.lucide) lucide.createIcons();
};
