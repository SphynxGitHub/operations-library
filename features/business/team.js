import { esc, uid, state, updateAndSync } from '../../core/data.js';

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
        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px;">
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
                                    <span style="font-size:11px; font-style:italic;">${esc(m.signature || 'No email signature set')}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Footer: Rate & Action Buttons -->
                    <div style="display:flex; align-items:center; justify-content:space-between; border-top:1px solid var(--line); padding-top:12px; margin-top:4px;">
                        <span class="pill tiny soft monospace" style="font-size:11px;">
                            $${m.rate || 150}/hr
                        </span>
                        <div style="display:flex; gap:6px;">
                            <button class="btn tiny soft" onclick="OL.openSphynxMemberModal('${m.id}')" title="Edit Member">
                                <i data-lucide="pencil" style="width:12px;height:12px;"></i> Edit
                            </button>
                            <button class="btn tiny soft danger" onclick="OL.removeSphynxTeamMember('${m.id}')" title="Remove Member">
                                <i data-lucide="trash-2" style="width:12px;height:12px;"></i>
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
                    <div>
                        <label class="bold tiny uppercase muted" style="display:block; margin-bottom:4px;">Email Signature Text</label>
                        <textarea id="tm-signature" class="modal-input tiny" placeholder="Micah Porter | Senior Strategist at Sphynx Agency" style="width:100%; height:60px;">${esc(member?.signature || '')}</textarea>
                    </div>
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
    const signature = document.getElementById('tm-signature')?.value || '';

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
                m.signature = signature;
            }
        } else {
            state.master.sphynxTeam.push({
                id: uid(),
                name: name,
                email: email,
                phone: phone,
                role: role,
                rate: rate,
                signature: signature,
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

window.OL.renderSphynxTeamPage = OL.renderSphynxTeamPage;
