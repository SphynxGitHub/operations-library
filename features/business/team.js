import { esc, uid, state, db, updateAndSync } from '../../core/data.js';
import { getOlSettings } from '../../core/ol-settings.js';
import { standardDayHours } from '../../core/scheduling.js';

// ================= 🛡️ SPHYNX TEAM MANAGER (CARD LAYOUT) ================= //

OL.renderSphynxTeamPage = function() {
    const main = document.getElementById("mainContent");
    if (!main) return;

    if (!state.master) state.master = {};
    if (!state.master.sphynxTeam) {
        state.master.sphynxTeam = [
            { id: "tm-1", name: "Admin Owner", email: "admin@sphynx.agency", phone: "", role: "Master Admin", signature: "Admin Owner | Sphynx Agency", rate: 300 },
            { id: "tm-2", name: "Lead Developer", email: "dev@sphynx.agency", phone: "", role: "Developer", signature: "Development Team | Sphynx Agency", rate: 150 }
        ];
    }

    const team = state.master.sphynxTeam;

    main.innerHTML = `
        <div class="section-header">
            <div>
                <h2><i data-lucide="shield-check" style="width:24px;height:24px;vertical-align:sub;margin-right:8px;color:var(--accent);"></i>Sphynx Team & Access Manager</h2>
                <div class="small muted">Internal agency roster, signatures, role permissions, and system access</div>
            </div>
            <div class="header-actions">
                <button class="btn small primary" onclick="OL.openSphynxMemberModal()" style="display:flex; align-items:center; gap:6px; font-weight:bold;">
                    <i data-lucide="user-plus" style="width:14px;height:14px;"></i> Add Team Member
                </button>
            </div>
        </div>

        <!-- TEAM MEMBER CARDS GRID -->
        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 16px;">
            ${team.map(m => `
                <div class="card" style="padding: 20px; display: flex; flex-direction: column; justify-content: space-between; gap: 16px; background: rgba(255,255,255,0.02); border: 1px solid var(--line); border-radius: 8px;">
                    <div>
                        <!-- Header: Initials + Name + Role Badge -->
                        <div style="display:flex; align-items:center; gap:12px; margin-bottom:14px;">
                            <div style="width:44px; height:44px; border-radius:50%; background:var(--accent); color:#000; font-weight:800; display:flex; align-items:center; justify-content:center; font-size:15px; flex-shrink:0;">
                                ${esc(m.name.split(' ').map(n=>n[0]).join('').substring(0,2).toUpperCase())}
                            </div>
                            <div style="flex:1; min-width:0;">
                                <strong style="font-size:16px; color:var(--text); display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(m.name)}</strong>
                                <span class="pill tiny accent" style="font-size:10px; font-weight:bold; margin-top:2px;">${esc(m.role || 'Team Member')}</span>
                            </div>
                        </div>

                        <!-- Contact & Signature Info -->
                        <div style="display:grid; gap:8px; font-size:12px;" class="muted">
                            <div style="display:flex; align-items:center; gap:8px;">
                                <i data-lucide="mail" style="width:14px;height:14px;color:var(--accent); flex-shrink:0;"></i>
                                <a href="mailto:${esc(m.email)}" style="color:inherit; text-decoration:none; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(m.email || 'No email set')}</a>
                            </div>
                            ${m.phone ? `
                            <div style="display:flex; align-items:center; gap:8px;">
                                <i data-lucide="phone" style="width:14px;height:14px;color:var(--accent); flex-shrink:0;"></i>
                                <span>${esc(m.phone)}</span>
                            </div>` : ''}
                            <div style="display:flex; align-items:flex-start; gap:8px; background:rgba(0,0,0,0.15); padding:8px 10px; border-radius:6px; border:1px solid var(--line);">
                                <i data-lucide="pen-tool" style="width:14px;height:14px;color:var(--accent); flex-shrink:0; margin-top:2px;"></i>
                                <div>
                                    <strong class="tiny uppercase bold" style="display:block; font-size:9px; color:var(--muted);">Email Signature</strong>
                                    <span style="font-size:11px;" class="ol-richtext-view">${OL.signatureHtmlFor(m)}</span>                                 </div>                             </div>                         </div>                     </div>                      <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; font-size:11px;" class="muted">
                        <span style="display:flex; align-items:center; gap:6px; min-width:0;"><i data-lucide="calendar-clock" style="width:14px;height:14px;color:var(--accent); flex-shrink:0;"></i><span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(OL.memberScheduleSummary(m))}</span></span>
                        <button class="btn tiny soft" style="flex-shrink:0; font-size:10px; padding:3px 8px;" onclick="OL.openMemberAvailability('${m.id}')" title="Available hours per weekday and days off. Used by scheduling and the Calendar Availability view.">Availability</button>
                    </div>
                    <!-- Footer: Rate & Clean Horizontal Action Controls -->                     <div style="display:flex; align-items:center; justify-content:space-between; border-top:1px solid var(--line); padding-top:12px; margin-top:4px; gap:8px; flex-wrap:nowrap; overflow-x:auto;">                         
                        
                        <div style="display:flex; gap:6px; align-items:center; flex-shrink:0; margin-left:auto;">
                            ${window.FORCE_ADMIN && m.authUserId === state.currentUser?.id ? `
                                <span class="tiny bold" style="color:#48bb78; white-space:nowrap;" title="Your admin login is linked to this card">This is you</span>
                            ` : window.FORCE_ADMIN ? `
                                <button class="btn tiny soft" style="white-space:nowrap; font-size:10px; padding:3px 8px;" onclick="OL.linkMyAdminLoginToTeamMember('${m.id}')" title="Link your admin login to this card">
                                    Set Profile
                                </button>
                            ` : ''}
                            
                            ${m.authUserId
                                ? `<span class="tiny bold" style="color:#48bb78; white-space:nowrap;" title="Has logged in">Logged in</span>`
                                : (m.setupToken
                                    ? `<span class="tiny bold" style="color:#fbbf24; white-space:nowrap;" title="Setup link sent">Link sent</span>`
                                    : `<span class="tiny muted" style="white-space:nowrap;" title="No login set up">— No login</span>`)}
                            
                            <button class="btn tiny soft" onclick="OL.openTeamAccessModal('${m.id}')" title="Login & Permissions" style="padding:3px 8px; font-size:10px; display:inline-flex; align-items:center; gap:4px;">
                                <i data-lucide="key-round" style="width:11px;height:11px;"></i> Access
                            </button>
                            <button class="btn tiny soft icon-only" onclick="OL.openSphynxMemberModal('${m.id}')" title="Edit Member" style="padding:3px 6px;">
                                <i data-lucide="pencil" style="width:11px;height:11px;"></i>
                            </button>
                            <button class="btn tiny soft danger icon-only" onclick="OL.removeSphynxTeamMember('${m.id}')" title="Remove Member" style="padding:3px 6px;">
                                <i data-lucide="trash-2" style="width:11px;height:11px;"></i>
                            </button>
                        </div>
                    </div>
                </div>
            `).join('')}
        </div>
    `;

    requestAnimationFrame(() => {
        if (window.lucide) lucide.createIcons();
    });
};

// ➕ / ✏️ Member Add & Edit Modal
OL.openSphynxMemberModal = function(memberId = null) {
    const member = memberId ? state.master?.sphynxTeam?.find(m => m.id === memberId) : null;

    const content = `
        <div style="padding: 24px; max-width: 500px; width: 100%;" onclick="event.stopPropagation()">
            <div class="modal-header" style="display:flex; justify-content:space-between; align-items:center; border-bottom: 1px solid var(--line); padding-bottom: 12px; margin-bottom: 16px;">
                <h3 style="margin:0; display:flex; align-items:center; gap:8px;">
                    <i data-lucide="${member ? 'pencil' : 'user-plus'}" style="width:20px;height:20px;color:var(--accent);"></i>
                    ${member ? 'Edit Sphynx Team Member' : 'Add Sphynx Team Member'}
                </h3>
                <button class="btn tiny soft" onclick="OL.closeModal()">✕</button>
            </div>
            <form onsubmit="event.preventDefault(); OL.saveSphynxTeamMember('${memberId || ''}');">
                <div style="display:grid; gap:12px; margin-bottom:20px;">
                    <div>
                        <label class="bold tiny uppercase muted" style="display:block; margin-bottom:4px;">Full Name</label>
                        <input type="text" id="tm-name" class="modal-input tiny" value="${esc(member?.name || '')}" placeholder="e.g. Micah Porter" required style="width:100%;">
                    </div>
                    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
                        <div>
                            <label class="bold tiny uppercase muted" style="display:block; margin-bottom:4px;">Email Address</label>
                            <input type="email" id="tm-email" class="modal-input tiny" value="${esc(member?.email || '')}" placeholder="micah@sphynx.agency" required style="width:100%;">
                        </div>
                        <div>
                            <label class="bold tiny uppercase muted" style="display:block; margin-bottom:4px;">Phone Number</label>
                            <input type="text" id="tm-phone" class="modal-input tiny" value="${esc(member?.phone || '')}" placeholder="(555) 000-0000" style="width:100%;">
                        </div>
                    </div>
                    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
                        <div>
                            <label class="bold tiny uppercase muted" style="display:block; margin-bottom:4px;">System Role</label>
                            <select id="tm-role" class="modal-input tiny" style="width:100%;">
                                <option value="Master Admin" ${member?.role === 'Master Admin' ? 'selected' : ''}>Master Admin</option>
                                <option value="Senior Strategist" ${member?.role === 'Senior Strategist' ? 'selected' : ''}>Senior Strategist</option>
                                <option value="Developer" ${member?.role === 'Developer' ? 'selected' : ''}>Developer</option>
                                <option value="Account Manager" ${member?.role === 'Account Manager' ? 'selected' : ''}>Account Manager</option>
                            </select>
                        </div>
                        <div>
                            <label class="bold tiny uppercase muted" style="display:block; margin-bottom:4px;">Billing Rate ($/h)</label>
                            <input type="number" id="tm-rate" class="modal-input tiny" value="${member?.rate || 150}" style="width:100%;">
                        </div>
                    </div>
                    ${memberId ? OL.signaturePanelHtml('tm', { memberId, showInclude: false }) : `
                    <div class="tiny muted" style="padding:8px 10px; border:1px dashed var(--line); border-radius:6px;">Save the team member first, then come back to Edit to set their email signature. Until then a default made from their name and email is used.</div>`}
                </div>
                <div style="display:flex; justify-content:flex-end; gap:8px;">
                    <button type="button" class="btn tiny soft" onclick="OL.closeModal()">Cancel</button>
                    <button type="submit" class="btn tiny primary" style="font-weight:bold;">Save Team Member</button>
                </div>
            </form>
        </div>
    `;
    OL.showOverlayModal(content);
};

OL.saveSphynxTeamMember = function(memberId) {
    const name = document.getElementById('tm-name')?.value;
    const email = document.getElementById('tm-email')?.value;
    const phone = document.getElementById('tm-phone')?.value || '';
    const role = document.getElementById('tm-role')?.value || 'Senior Strategist';
    const rate = parseFloat(document.getElementById('tm-rate')?.value) || 150;

    if (!name || !email) return;

    updateAndSync(() => {
        if (!state.master) state.master = {};
        if (!state.master.sphynxTeam) state.master.sphynxTeam = [];

        if (memberId) {
            const m = state.master.sphynxTeam.find(item => item.id === memberId);
            if (m) {
                m.name = name;
                m.email = email;
                m.phone = phone;
                m.role = role;
                m.rate = rate;
            }
        } else {
            state.master.sphynxTeam.push({
                id: uid(),
                name: name,
                email: email,
                phone: phone,
                role: role,
                rate: rate,
                active: true,
                createdAt: new Date().toISOString()
            });
        }
    });

    OL.closeModal();
    OL.renderSphynxTeamPage();
};

OL.removeSphynxTeamMember = function(memberId) {
    if (!confirm("Are you sure you want to remove this team member?")) return;

    updateAndSync(() => {
        if (state.master?.sphynxTeam) {
            state.master.sphynxTeam = state.master.sphynxTeam.filter(m => m.id !== memberId);
        }
    });

    OL.renderSphynxTeamPage();
};

OL.openTeamAccessModal = function(memberId) {
    const member = state.master?.sphynxTeam?.find(m => m.id === memberId);
    if (!member) return;

    const tabs = OL.TEAM_PERMISSION_TABS || [];
    const perms = member.permissions || {};

    const loginStatusHTML = member.authUserId
        ? `<span style="color:#48bb78;">${esc(member.name)} has already logged in.</span>`
        : member.setupToken
            ? `<span style="color:#fbbf24;">Setup link generated, not claimed yet.</span>`
            : `<span class="muted">No login set up yet.</span>`;

    const content = `
        <div style="padding: 24px; max-width: 480px; width: 100%;" onclick="event.stopPropagation()">
            <div class="modal-header" style="display:flex; justify-content:space-between; align-items:center; border-bottom: 1px solid var(--line); padding-bottom: 12px; margin-bottom: 16px;">
                <h3 style="margin:0; display:flex; align-items:center; gap:8px;">
                    <i data-lucide="key-round" style="width:20px;height:20px;color:var(--accent);"></i>
                    Login & Access — ${esc(member.name)}
                </h3>
                <button class="btn tiny soft" onclick="OL.closeModal()">✕</button>
            </div>

            <div style="margin-bottom:20px; padding:12px; background:rgba(255,255,255,0.02); border:1px solid var(--line); border-radius:6px;">
                <div class="tiny" style="margin-bottom:8px;">${loginStatusHTML}</div>
                ${!member.authUserId ? `
                    <button class="btn tiny primary" onclick="OL.copyTeamSetupLink('${member.id}')" style="width:100%;">
                        ${member.setupToken ? 'Regenerate & Copy Setup Link' : 'Generate & Copy Setup Link'}
                    </button>
                    <div class="tiny muted" style="margin-top:6px;">Sends them to a page where they set their own password, using the email on file (${esc(member.email || 'no email set')}).</div>
                ` : ''}
            </div>

            <div style="margin-bottom:20px;">
                <label class="bold tiny uppercase muted" style="display:block; margin-bottom:8px;">Business Manager Access</label>
                <div class="tiny muted" style="margin-bottom:10px;">Which tabs this person can see and use once logged in. The Template Vault (master config) is always admin-only, regardless of these.</div>
                <div style="display:grid; gap:6px;">
                    ${tabs.map(t => `
                        <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
                            <input type="checkbox" id="tm-perm-${t.key}" ${perms[t.key] ? 'checked' : ''}>
                            <span class="tiny">${esc(t.label)}</span>
                        </label>
                    `).join('')}
                </div>
            </div>

            <div style="display:flex; justify-content:flex-end; gap:8px;">
                <button class="btn tiny soft" onclick="OL.closeModal()">Cancel</button>
                <button class="btn tiny primary" style="font-weight:bold;" onclick="OL.saveTeamMemberPermissions('${member.id}')">Save Access</button>
            </div>
        </div>
    `;
    OL.showOverlayModal(content);
};

OL.saveTeamMemberPermissions = function(memberId) {
    const tabs = OL.TEAM_PERMISSION_TABS || [];
    const permissions = {};
    tabs.forEach(t => {
        permissions[t.key] = !!document.getElementById(`tm-perm-${t.key}`)?.checked;
    });

    updateAndSync(() => {
        const m = state.master?.sphynxTeam?.find(item => item.id === memberId);
        if (m) m.permissions = permissions;
    });

    OL.closeModal();
    OL.renderSphynxTeamPage();
};

OL.linkMyAdminLoginToTeamMember = async function(memberId) {
    if (!window.FORCE_ADMIN) return;

    const { data: { session } } = await db.auth.getSession();
    if (!session) { alert('Your session could not be verified — try signing in again.'); return; }

    updateAndSync(() => {
        (state.master?.sphynxTeam || []).forEach(m => {
            if (m.authUserId === session.user.id) delete m.authUserId;
        });
        const target = state.master?.sphynxTeam?.find(m => m.id === memberId);
        if (target) target.authUserId = session.user.id;
    });

    const target = state.master?.sphynxTeam?.find(m => m.id === memberId);
    if (target && state.currentUser) {
        state.currentUser.name = target.name;
        state.currentUser.role = target.role || state.currentUser.role;
    }

    OL.renderSphynxTeamPage();
    if (typeof window.buildLayout === 'function') window.buildLayout();
};

window.OL.renderSphynxTeamPage = OL.renderSphynxTeamPage;

// ================= AVAILABLE HOURS & DAYS OFF ================= //
// member.schedule = { hours: { mon, tue, wed, thu, fri }, offDates: [{ id, from, to, note }] }
// Blank hours = the standard day (the roll-over limit, 7h); 0 = does not work that weekday. Read by core/scheduling.js,
// so auto-scheduling, the roll-over and the Calendar Availability view all follow it. Saved straight away (no Save button).
const SCHED_DAYS = [['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'], ['fri', 'Fri'], ['sat', 'Sat'], ['sun', 'Sun']];
const isWeekendDay = (k) => k === 'sat' || k === 'sun';
const fmtDay = (key) => { const [y, m, d] = String(key).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString([], { month: 'short', day: 'numeric' }); };
const fmtRange = (o) => (!o.to || o.to === o.from) ? fmtDay(o.from) : `${fmtDay(o.from)} – ${fmtDay(o.to)}`;
const localKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

OL.memberScheduleSummary = function(m) {
    const sched = m?.schedule || {};
    const custom = SCHED_DAYS.some(([k]) => sched.hours && sched.hours[k] !== undefined && sched.hours[k] !== null && sched.hours[k] !== '');
    const today = localKey(new Date());
    const upcoming = (sched.offDates || []).filter(o => o && o.from && String(o.to || o.from) >= today).sort((a, b) => String(a.from).localeCompare(String(b.from)));
    const parts = [custom ? 'Custom hours' : 'Standard hours'];
    if (upcoming.length) parts.push(`Off ${fmtRange(upcoming[0])}${upcoming.length > 1 ? ` +${upcoming.length - 1} more` : ''}`);
    return parts.join(' · ');
};

OL.openMemberAvailability = function(memberId) {
    const m = state.master?.sphynxTeam?.find(x => x.id === memberId);
    if (!m) return;
    const sched = m.schedule || {};
    const today = localKey(new Date());
    const off = (sched.offDates || []).slice().sort((a, b) => String(a.from).localeCompare(String(b.from)));
    const std = standardDayHours(getOlSettings().scheduling);

    OL.showOverlayModal(`
        <div style="padding:8px 12px; width:100%; box-sizing:border-box;" onclick="event.stopPropagation()">
            <div class="modal-header" style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--line); padding-bottom:12px; margin-bottom:16px;">
                <h3 style="margin:0; display:flex; align-items:center; gap:8px;"><i data-lucide="calendar-clock" style="width:20px;height:20px;color:var(--accent);"></i>Availability — ${esc(m.name)}</h3>
                <button class="btn tiny soft" onclick="OL.closeModal(); OL.renderSphynxTeamPage();">✕</button>
            </div>

            <div class="bold tiny uppercase muted" style="margin-bottom:6px;">Available hours per day</div>
            <div class="tiny muted" style="margin-bottom:8px;">Weekdays: leave blank for the standard ${std}h day, or use 0 for a day ${esc(m.name.split(' ')[0])} doesn't work. Weekends: blank means not working; enter hours to schedule on them. Fewer hours make a day fill up sooner: the Green / Yellow / Red cut-offs and the daily roll-over limit scale to match.</div>
            <div style="display:grid; grid-template-columns:repeat(7, minmax(0, 1fr)); gap:8px; margin-bottom:18px;">
                ${SCHED_DAYS.map(([k, label]) => `
                    <label class="tiny muted" style="display:grid; gap:3px; text-align:center;">${label}
                        <input type="number" min="0" max="24" step="0.5" class="modal-input tiny" style="width:100%; padding:4px 6px; text-align:center;" placeholder="${isWeekendDay(k) ? 'off' : std}"
                               value="${sched.hours && sched.hours[k] !== undefined && sched.hours[k] !== null ? esc(String(sched.hours[k])) : ''}"
                               onchange="OL.setMemberWeekdayHours('${m.id}', '${k}', this.value)">
                    </label>`).join('')}
            </div>

            <div class="bold tiny uppercase muted" style="margin-bottom:6px;">Days off</div>
            <div class="tiny muted" style="margin-bottom:8px;">Nothing is scheduled on these days, and tasks already due then move to the next day that fits.</div>
            <div style="display:grid; gap:6px; margin-bottom:10px;">
                ${off.map(o => `
                    <div style="display:flex; align-items:center; gap:8px; padding:6px 10px; border:1px solid var(--line); border-radius:6px; ${String(o.to || o.from) < today ? 'opacity:0.5;' : ''}">
                        <span style="flex:1; font-size:12px;">${esc(fmtRange(o))}${o.note ? ` <span class="tiny muted">· ${esc(o.note)}</span>` : ''}</span>
                        <button class="btn tiny soft danger icon-only" style="padding:2px 6px;" title="Remove" onclick="OL.removeMemberOffDates('${m.id}', '${esc(o.id)}')">✕</button>
                    </div>`).join('') || '<div class="tiny muted">No days off set.</div>'}
            </div>
            <div style="display:flex; gap:6px; align-items:flex-end; flex-wrap:wrap; padding-top:10px; border-top:1px solid var(--line);">
                <label class="tiny muted" style="display:grid; gap:3px;">From<input type="date" id="off-from" class="modal-input tiny" style="padding:4px 6px;"></label>
                <label class="tiny muted" style="display:grid; gap:3px;">To (optional)<input type="date" id="off-to" class="modal-input tiny" style="padding:4px 6px;"></label>
                <label class="tiny muted" style="display:grid; gap:3px; flex:1; min-width:100px;">Note<input type="text" id="off-note" class="modal-input tiny" placeholder="Vacation" style="padding:4px 6px;"></label>
                <button class="btn tiny primary" onclick="OL.addMemberOffDates('${m.id}')">Add</button>
            </div>
            <div style="display:flex; justify-content:flex-end; margin-top:16px;">
                <button class="btn tiny soft" onclick="OL.closeModal(); OL.renderSphynxTeamPage();">Done</button>
            </div>
        </div>
    `);
    if (window.lucide) lucide.createIcons();
};

OL.setMemberWeekdayHours = function(memberId, dayKey, value) {
    updateAndSync(() => {
        const m = state.master?.sphynxTeam?.find(x => x.id === memberId);
        if (!m) return;
        if (!m.schedule) m.schedule = {};
        if (!m.schedule.hours) m.schedule.hours = {};
        const raw = String(value ?? '').trim();
        const n = parseFloat(raw);
        if (raw === '' || !Number.isFinite(n)) delete m.schedule.hours[dayKey];          // blank = the standard day
        else m.schedule.hours[dayKey] = Math.min(24, Math.max(0, n));
    });
};

OL.addMemberOffDates = function(memberId) {
    const from = document.getElementById('off-from')?.value || '';
    let to = document.getElementById('off-to')?.value || '';
    const note = (document.getElementById('off-note')?.value || '').trim();
    if (!from) { alert('Pick the first day off.'); return; }
    if (!to || to < from) to = from;
    updateAndSync(() => {
        const m = state.master?.sphynxTeam?.find(x => x.id === memberId);
        if (!m) return;
        if (!m.schedule) m.schedule = {};
        m.schedule.offDates = [...(m.schedule.offDates || []), { id: uid(), from, to, note }];
    }).then(() => {
        OL.openMemberAvailability(memberId);
        // Tasks already due on those days move on right away (needs the Calendar module; harmless if it is not loaded).
        if (typeof OL.rollOverFullDays === 'function') OL.rollOverFullDays();
    });
};

OL.removeMemberOffDates = function(memberId, offId) {
    updateAndSync(() => {
        const m = state.master?.sphynxTeam?.find(x => x.id === memberId);
        if (m?.schedule?.offDates) m.schedule.offDates = m.schedule.offDates.filter(o => String(o.id) !== String(offId));
    }).then(() => OL.openMemberAvailability(memberId));
};
