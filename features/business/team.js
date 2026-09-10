// ================= 🛡️ SPHYNX TEAM & ACCESS MANAGER ================= //

OL.openSphynxTeamManagerModal = function() {
    if (!state.master) state.master = {};
    if (!state.master.sphynxTeam) {
        state.master.sphynxTeam = [
            { id: "tm-1", name: "Admin Owner", email: "admin@sphynx.agency", role: "Master Admin", rate: 300, active: true },
            { id: "tm-2", name: "Lead Developer", email: "dev@sphynx.agency", role: "Developer", rate: 150, active: true }
        ];
    }

    const team = state.master.sphynxTeam;

    const content = `
        <div style="padding: 24px; max-width: 700px; width: 100%;" onclick="event.stopPropagation()">
            <div class="modal-header" style="display:flex; justify-content:space-between; align-items:center; border-bottom: 1px solid var(--line); padding-bottom: 14px; margin-bottom: 20px;">
                <h3 style="margin:0; display:flex; align-items:center; gap:10px;">
                    <i data-lucide="shield-check" style="width:22px;height:22px;color:var(--accent);"></i>
                    Sphynx Team & Login Credentials Manager
                </h3>
                <button class="btn tiny soft" onclick="OL.closeModal()" style="font-weight:bold;">✕</button>
            </div>

            <div class="modal-body">
                <div class="tiny muted" style="margin-bottom: 15px;">
                    Administer internal Sphynx agency team members, role permissions, hourly cost rates, and system portal access.
                </div>

                <!-- Active Team Table -->
                <div style="display:grid; gap:8px; margin-bottom: 20px; max-height: 280px; overflow-y: auto;">
                    ${team.map(m => `
                        <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; padding:10px 14px; background:rgba(255,255,255,0.02); border:1px solid var(--line); border-radius:6px;">
                            <div style="display:flex; align-items:center; gap:10px;">
                                <div style="width:30px; height:30px; border-radius:50%; background:var(--accent); color:#000; font-weight:bold; display:flex; align-items:center; justify-content:center; font-size:11px;">
                                    ${esc(m.name.split(' ').map(n=>n[0]).join('').substring(0,2).toUpperCase())}
                                </div>
                                <div>
                                    <strong style="font-size:13px; display:block;">${esc(m.name)}</strong>
                                    <span class="tiny muted">${esc(m.email)} • <span style="color:var(--accent); font-weight:bold;">${esc(m.role)}</span></span>
                                </div>
                            </div>

                            <div style="display:flex; align-items:center; gap:10px;">
                                <span class="tiny monospace" style="background:rgba(255,255,255,0.05); padding:2px 6px; border-radius:4px;">
                                    $${m.rate || 150}/hr
                                </span>
                                <button class="btn tiny soft danger" onclick="OL.removeSphynxTeamMember('${m.id}')" title="Remove Member">
                                    <i data-lucide="trash-2" style="width:12px;height:12px;"></i>
                                </button>
                            </div>
                        </div>
                    `).join('')}
                </div>

                <!-- Add New Member Form -->
                <form onsubmit="event.preventDefault(); OL.addSphynxTeamMember();" style="display:grid; grid-template-columns: 1.5fr 2fr 1.2fr 100px 90px; gap:8px; align-items:center; padding-top:15px; border-top:1px solid var(--line);">
                    <input type="text" id="new-tm-name" class="modal-input tiny" placeholder="Full Name" required>
                    <input type="email" id="new-tm-email" class="modal-input tiny" placeholder="Email Address" required>
                    <select id="new-tm-role" class="modal-input tiny">
                        <option value="Master Admin">Master Admin</option>
                        <option value="Senior Strategist">Senior Strategist</option>
                        <option value="Developer">Developer</option>
                        <option value="Account Manager">Account Manager</option>
                    </select>
                    <input type="number" id="new-tm-rate" class="modal-input tiny" placeholder="Rate $/h" value="150">
                    <button type="submit" class="btn tiny primary" style="font-weight:bold; height:100%;">
                        <i data-lucide="user-plus" style="width:12px;height:12px;"></i> Add
                    </button>
                </form>
            </div>
        </div>
    `;

    OL.showOverlayModal(content);
};

OL.addSphynxTeamMember = function() {
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

    OL.openSphynxTeamManagerModal();
    OL.renderBusinessTaskManager();
};

OL.removeSphynxTeamMember = function(memberId) {
    if (!confirm("Are you sure you want to remove this team member?")) return;

    updateAndSync(() => {
        if (state.master?.sphynxTeam) {
            state.master.sphynxTeam = state.master.sphynxTeam.filter(m => m.id !== memberId);
        }
    });

    OL.openSphynxTeamManagerModal();
    OL.renderBusinessTaskManager();
};
