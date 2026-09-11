import { esc, state, updateAndSync } from '../../core/data.js';

OL.calendarState = {
    loading: false
};

OL.renderBusinessCalendar = function() {
    const main = document.getElementById("mainContent");
    if (!main) return;

    const commsData = state.master?.communications || {};
    const isConnected = commsData.gmail?.connected || state.master?.googleConnected || false;
    const events = state.master?.googleCalendarEvents || [];

    // Auto-fetch calendar events if connected and feed is empty
    if (isConnected && events.length === 0 && !OL.calendarState.loading) {
        OL.fetchLiveGoogleCalendar();
    }

    main.innerHTML = `
        <div class="section-header">
            <div>
                <h2><i data-lucide="calendar" style="width:24px;height:24px;vertical-align:sub;margin-right:8px;color:var(--accent);"></i>Unified Calendar</h2>
                <div class="small muted">Google Calendar API Synchronization & Scheduling</div>
            </div>
            <div class="header-actions" style="display:flex; gap:10px; align-items:center;">
                ${isConnected ? `
                    <button class="btn small soft" onclick="OL.fetchLiveGoogleCalendar()" ${OL.calendarState.loading ? 'disabled' : ''}>
                        <i data-lucide="refresh-cw" style="width:14px;height:14px;${OL.calendarState.loading ? 'animation: spin 1s linear infinite;' : ''}"></i>
                        ${OL.calendarState.loading ? 'Syncing...' : 'Sync Calendar'}
                    </button>
                ` : `
                    <button class="btn small primary" onclick="OL.initiateGoogleAuth()">
                        <i data-lucide="log-in" style="width:14px;height:14px;"></i> Connect Google Account
                    </button>
                `}
            </div>
        </div>

        ${!isConnected ? `
            <div class="card" style="padding: 40px; text-align: center; max-width: 600px; margin: 20px auto;">
                <i data-lucide="calendar" style="width: 48px; height: 48px; color: var(--accent); margin-bottom: 15px;"></i>
                <h3>Google Calendar Integration</h3>
                <p class="muted small" style="max-width: 440px; margin: 0 auto 20px auto;">
                    Sync your Google Calendar to view milestone deadlines, client meetings, and scheduled deliverables directly inside your Agency OS.
                </p>
                <button class="btn primary" onclick="OL.initiateGoogleAuth()" style="display:inline-flex; align-items:center; gap:8px;">
                    <i data-lucide="log-in" style="width:16px;height:16px;"></i> Connect Google Calendar
                </button>
            </div>
        ` : `
            <div class="card" style="padding: 20px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 20px; border-bottom: 1px solid var(--line); padding-bottom: 15px;">
                    <strong style="font-size:15px;">Upcoming Google Calendar Events</strong>
                    <div class="tiny muted">Account: <strong style="color:#22c55e;">● Connected</strong></div>
                </div>

                <div style="display:grid; gap:12px;">
                    ${events.length === 0 ? `
                        <div style="text-align:center; padding: 40px; color: var(--muted);">
                            <i data-lucide="calendar-off" style="width:36px;height:32px;margin-bottom:8px;opacity:0.5;"></i>
                            <div>No upcoming Google Calendar events found. Click "Sync Calendar" above to refresh.</div>
                        </div>
                    ` : events.map(evt => {
                        const startDate = evt.start ? new Date(evt.start).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'All Day';
                        return `
                            <div style="display:grid; grid-template-columns: 200px 1fr 140px; gap: 16px; padding: 14px; background: rgba(255,255,255,0.02); border: 1px solid var(--line); border-radius: 6px; align-items:center;">
                                <div>
                                    <span class="pill tiny accent" style="font-weight:bold;">
                                        📅 ${esc(startDate)}
                                    </span>
                                </div>
                                <div>
                                    <strong style="display:block; font-size:14px; margin-bottom:2px;">${esc(evt.title)}</strong>
                                    ${evt.location ? `<div class="tiny muted">📍 ${esc(evt.location)}</div>` : ''}
                                </div>
                                <div class="text-right">
                                    ${evt.link ? `
                                        <a href="${evt.link}" target="_blank" class="btn tiny soft" style="text-decoration:none; display:inline-flex; align-items:center; gap:4px;">
                                            Open <i data-lucide="external-link" style="width:12px;height:12px;"></i>
                                        </a>
                                    ` : ''}
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `}
    `;

    if (window.lucide) lucide.createIcons();
};

// -------------------------------------------------------------
// LIVE GOOGLE CALENDAR FETCH API
// -------------------------------------------------------------
OL.fetchLiveGoogleCalendar = async function() {
    OL.calendarState.loading = true;
    OL.renderBusinessCalendar();

    try {
        const response = await fetch("https://kexnnpwjerrnsmifauuo.supabase.co/functions/v1/get-calendar-events");
        const data = await response.json();

        if (data.events) {
            updateAndSync(() => {
                if (!state.master) state.master = {};
                state.master.googleCalendarEvents = data.events;
            });
        } else if (data.error) {
            console.warn("Google Calendar Sync Notice:", data.error);
        }
    } catch (err) {
        console.error("Failed to fetch Google Calendar events:", err);
    } finally {
        OL.calendarState.loading = false;
        OL.renderBusinessCalendar();
    }
};

window.OL.renderBusinessCalendar = OL.renderBusinessCalendar;
