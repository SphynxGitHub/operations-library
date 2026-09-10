import { esc, uid, state, updateAndSync } from '../../core/data.js';

// ================= 🛡️ SPHYNX TEAM & CREDENTIALS PAGE ================= //

OL.renderSphynxTeamPage = function() {
    const main = document.getElementById("mainContent");
    if (!main) return;

    if (!state.master) state.master = {};
    if (!state.master.sphynxTeam) {
        state.master.sphynxTeam = [
            { id: "tm-1", name: "Admin Owner", email: "admin@sphynx.agency", role: "Master Admin", rate: 300, active: true },
            { id: "tm-2", name: "Lead Developer", email: "dev@sphynx.agency", role: "Developer", rate: 150, active: true }
        ];
    }

    const team = state.master.sphynxTeam;

    main.innerHTML = `
        <div class="section-header">
            <div>
                <h2><i data-lucide="shield-check" style="width:24px;height:24px;vertical-align:sub;margin-right:8px;color:var(--accent);"></i>Sphynx Team & Credentials Manager</h2>
                <div class="small muted">Administer agency team members, role permissions, hourly cost rates, and portal credentials</div>
            </div>
            <div class="header-actions">
                <button class="btn small primary" onclick="OL.openAddSphynxMemberModal()" style="display:flex; align-items:center; gap:6px; font-weight:bold;">
                    <i data-lucide="user-plus" style="width:14px;height:14px;"></i> Add Team Member
                </button>
            </div>
        </div>

        <div class="card" style="padding: 20px;">
            <div style="display:grid; gap:12px;">
                ${team.map(m => `
                    <div style="display:flex; align-items:center; justify-content:space-between; gap:16px; padding:14px 18px; background:rgba(255,255,255,0.02); border:1px solid var(--line); border-radius:8px;">
                        <div style="display:flex; align-items:center; gap:14px;">
                            <div style="width:40px; height:40px; border-radius:50%; background:var(--accent); color:#000; font-weight:800; display:flex; align-items:center; justify-content:center; font-size:14px;">
                                ${esc(m.name.split(' ').map(n=>n[0]).join('').substring(0,2).toUpperCase())}
                            </div>
                            <div>
                                <strong style="font-size:15px; display:block; color:var(--text);">${esc(m.name)}</strong>
                                <span class="tiny muted">${esc(m.email)} • <span style="color:var(--accent); font-weight:bold;">${esc(m.role)}</span></span>
                            </div>
                        </div>

                        <div style="display:flex; align-items:center; gap:12px;">
                            <span class="pill tiny soft monospace" style="font-size:11px; padding:4px 8px;">
                                $${m.rate || 150}/hr
                            </span>
                            <button class="btn tiny soft" onclick="OL.openEditSphynxMemberModal('${m.id}')" style="display:flex; align-items:center; gap:4px;">
                                <i data-lucide="key-round" style="width:12px;height:12px;"></i> Credentials
                            </button>
                            <button class="btn tiny soft danger" onclick="OL.removeSphynxTeamMember('${m.id}')" title="Remove Member">
                                <i data-lucide="trash-2" style="width:12px;height:12px;"></i>
                            </button>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;

    requestAnimationFrame(() => {
        if (window.lucide) lucide.createIcons();
    });
};

// ➕ Modal: Add Team Member
OL.openAddSphynxMemberModal = function() {
    const content = `
        <div style="padding: 24px; max-width: 480px; width: 100%;" onclick="event.stopPropagation()">
            <div class="modal-header" style="display:flex; justify-content:space-between; align-items:center; border-bottom: 1px solid var(--line); padding-bottom: 12px; margin-bottom: 16px;">
                <h3 style="margin:0; display:flex; align-items:center; gap:8px;">
                    <i data-lucide="user-plus" style="width:20px;height:20px;color:var(--accent);"></i> Add Team Member
                </h3>
                <button class="btn tiny soft" onclick="OL.closeModal()">✕</button>
            </div>
            <form onsubmit="event.preventDefault(); OL.saveNewSphynxTeamMember();">
                <div style="display:grid; gap:12px; margin-bottom:20px;">
                    <div>
                        <label class="bold tiny uppercase muted" style="display:block; margin-bottom:4px;">Full Name</label>
                        <input type="text" id="new-tm-name" class="modal-input tiny" placeholder="e.g. Micah Porter" required style="width:100%;">
                    </div>
                    <div>
                        <label class="bold tiny uppercase muted" style="display:block; margin-bottom:4px;">Email Address</label>
                        <input type="email" id="new-tm-email" class="modal-input tiny" placeholder="micah@sphynx.agency" required style="width:100%;">
                    </div>
                    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
                        <div>
                            <label class="bold tiny uppercase muted" style="display:block; margin-bottom:4px;">System Role</label>
                            <select id="new-tm-role" class="modal-input tiny" style="width:100%;">
                                <option value="Master Admin">Master Admin</option>
                                <option value="Senior Strategist">Senior Strategist</option>
                                <option value="Developer">Developer</option>
                                <option value="Account Manager">Account Manager</option>
                            </select>
                        </div>
                        <div>
                            <label class="bold tiny uppercase muted" style="display:block; margin-bottom:4px;">Cost Rate ($/h)</label>
                            <input type="number" id="new-tm-rate" class="modal-input tiny" value="150" style="width:100%;">
                        </div>
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

OL.saveNewSphynxTeamMember = function() {
    const name = document.getElementById('new-tm-name')?.value;
    const email = document.getElementById('new-tm-email')?.value;
    const role = document.getElementById('new-tm-role')?.value || 'Senior Strategist';
    const rate = parseFloat(document.getElementById('new-tm-rate')?.value) || 150;

    if (!name || !email) return;

    updateAndSync(() => {
        if (!state.master) state.master = {};
        if (!state.master.sphynxTeam) state.master.sphynxTeam = [];

        state.master.sphynxTeam.push({
            id: uid(),
            name: name,
            email: email,
            role: role,
            rate: rate,
            active: true,
            createdAt: new Date().toISOString()
        });
    });

    OL.closeModal();
    OL.renderSphynxTeamPage();
};

// 🔑 Modal: Edit Credentials & Role
OL.openEditSphynxMemberModal = function(memberId) {
    const member = state.master?.sphynxTeam?.find(m => m.id === memberId);
    if (!member) return;

    const content = `
        <div style="padding: 24px; max-width: 480px; width: 100%;" onclick="event.stopPropagation()">
            <div class="modal-header" style="display:flex; justify-content:space-between; align-items:center; border-bottom: 1px solid var(--line); padding-bottom: 12px; margin-bottom: 16px;">
                <h3 style="margin:0; display:flex; align-items:center; gap:8px;">
                    <i data-lucide="key-round" style="width:20px;height:20px;color:var(--accent);"></i> Member Access & Credentials
                </h3>
                <button class="btn tiny soft" onclick="OL.closeModal()">✕</button>
            </div>
            <form onsubmit="event.preventDefault(); OL.saveSphynxMemberEdit('${member.id}');">
                <div style="display:grid; gap:12px; margin-bottom:20px;">
                    <div>
                        <label class="bold tiny uppercase muted" style="display:block; margin-bottom:4px;">Full Name</label>
                        <input type="text" id="edit-tm-name" class="modal-input tiny" value="${esc(member.name)}" required style="width:100%;">
                    </div>
                    <div>
                        <label class="bold tiny uppercase muted" style="display:block; margin-bottom:4px;">Email Address</label>
                        <input type="email" id="edit-tm-email" class="modal-input tiny" value="${esc(member.email)}" required style="width:100%;">
                    </div>
                    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
                        <div>
                            <label class="bold tiny uppercase muted" style="display:block; margin-bottom:4px;">System Role</label>
                            <select id="edit-tm-role" class="modal-input tiny" style="width:100%;">
                                <option value="Master Admin" ${member.role === 'Master Admin' ? 'selected' : ''}>Master Admin</option>
                                <option value="Senior Strategist" ${member.role === 'Senior Strategist' ? 'selected' : ''}>Senior Strategist</option>
                                <option value="Developer" ${member.role === 'Developer' ? 'selected' : ''}>Developer</option>
                                <option value="Account Manager" ${member.role === 'Account Manager' ? 'selected' : ''}>Account Manager</option>
                            </select>
                        </div>
                        <div>
                            <label class="bold tiny uppercase muted" style="display:block; margin-bottom:4px;">Cost Rate ($/h)</label>
                            <input type="number" id="edit-tm-rate" class="modal-input tiny" value="${member.rate || 150}" style="width:100%;">
                        </div>
                    </div>
                </div>
                <div style="display:flex; justify-content:flex-end; gap:8px;">
                    <button type="button" class="btn tiny soft" onclick="OL.closeModal()">Cancel</button>
                    <button type="submit" class="btn tiny primary" style="font-weight:bold;">Update Credentials</button>
                </div>
            </form>
        </div>
    `;
    OL.showOverlayModal(content);
};

OL.saveSphynxMemberEdit = function(memberId) {
    updateAndSync(() => {
        const member = state.master?.sphynxTeam?.find(m => m.id === memberId);
        if (member) {
            member.name = document.getElementById('edit-tm-name')?.value || member.name;
            member.email = document.getElementById('edit-tm-email')?.value || member.email;
            member.role = document.getElementById('edit-tm-role')?.value || member.role;
            member.rate = parseFloat(document.getElementById('edit-tm-rate')?.value) || member.rate;
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
