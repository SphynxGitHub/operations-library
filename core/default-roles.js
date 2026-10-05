//======================= CORE / DEFAULT ROLES FOR NEW PROJECTS =======================//
// A new project starts with the same default person per role (project > Role Defaults, client.projectData.roleAssignments):
// the people come from Templates & settings > "Default people for new projects" (olSettings.newProjectRoles, keyed by
// role NAME so it survives custom role ids). A setting can be a full name ("Arielle Minicozzi") or just a first name
// ("Anthony") when only one team member has it. A role with no setting, or a name that matches nobody on the Sphynx
// Team, is left unassigned. Pure apart from reading settings and the roster.
import { state, uid } from './data.js';
import { getOlSettings } from './ol-settings.js';

const DEFAULT_ROLES = [
    { id: 'role-sales', name: 'Sales' }, { id: 'role-scoping', name: 'Scoping' }, { id: 'role-implementation', name: 'Implementation' },
    { id: 'role-testing', name: 'Testing' }, { id: 'role-communication', name: 'Communication' },
];

// The master role list (same one the Comp Roles window edits), or the built-in five before it has been touched.
export const roleList = () => (state?.master?.roles && state.master.roles.length ? state.master.roles : DEFAULT_ROLES);

// A setting to the roster member it means: exact full name first, else a first name only one member has.
export function resolveTeamMember(name, team = state?.master?.sphynxTeam || []) {
    const n = String(name || '').trim().toLowerCase();
    if (!n) return null;
    const exact = team.filter((m) => String(m?.name || '').trim().toLowerCase() === n);
    if (exact.length === 1) return exact[0];
    if (exact.length > 1) return null;
    const first = team.filter((m) => String(m?.name || '').trim().toLowerCase().split(/\s+/)[0] === n);
    return first.length === 1 ? first[0] : null;
}

// Fills the project's role defaults. Never replaces a role that already has someone. Returns how many it set.
export function applyNewProjectRoles(client, { roles = roleList(), settings = getOlSettings().newProjectRoles || {}, team } = {}) {
    if (!client) return 0;
    if (!client.projectData) client.projectData = {};
    if (!Array.isArray(client.projectData.roleAssignments)) client.projectData.roleAssignments = [];
    let set = 0;
    roles.forEach((role) => {
        const key = Object.keys(settings).find((k) => k.trim().toLowerCase() === String(role.name || '').trim().toLowerCase());
        const person = key ? resolveTeamMember(settings[key], team) : null;
        if (!person) return;
        const existing = client.projectData.roleAssignments.find((a) => a.roleId === role.id);
        if (existing && String(existing.memberName || '').trim()) return;
        if (existing) existing.memberName = person.name;
        else client.projectData.roleAssignments.push({ id: uid(), roleId: role.id, memberName: person.name });
        set++;
    });
    return set;
}

if (typeof OL !== 'undefined') OL.applyNewProjectRoles = (client) => applyNewProjectRoles(client);
