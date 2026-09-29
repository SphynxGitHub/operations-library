//======================= CORE / TASK ASSIGNEES =======================//
// A task can have several assignees. `task.assignee` stays the PRIMARY (first) person, so everything written
// before this existed, and any screen that only knows one name, keeps working. `task.assignees` holds the full
// list, and is only stored when there is more than one person.
//
// "Sphynx Task" / "Client Task" are buckets, not people, so they never sit beside a named person: choosing one
// replaces everyone, and choosing a person removes the bucket.

const GENERIC = ['sphynx task', 'sphynx', 'client task', 'client'];
const clean = (v) => String(v == null ? '' : v).trim();

export const isGenericAssignee = (name) => GENERIC.includes(clean(name).toLowerCase());

// Everyone on the task, primary first. If something else changed `assignee` directly and left `assignees`
// behind (older code paths do), the stale list is ignored and the primary wins.
export function taskAssignees(task) {
    const primary = clean(task?.assignee);
    const list = Array.isArray(task?.assignees) ? task.assignees.map(clean).filter(Boolean) : [];
    if (list.length && (!primary || list[0] === primary)) return [...new Set(list)];
    return primary ? [primary] : [];
}

// The list after clicking `name` in the picker.
export function toggledAssignees(current, name) {
    const n = clean(name);
    if (!n) return current.slice();
    if (isGenericAssignee(n)) return [n];
    const named = current.filter((a) => !isGenericAssignee(a));
    const i = named.indexOf(n);
    if (i >= 0) named.splice(i, 1); else named.push(n);
    return named.length ? named : ['Sphynx Task'];
}

// Writes the list onto the task. A task is a client task only when NOBODY on it is Sphynx or a vendor.
// Returns { list, added } where `added` are the people who were not on it before.
export function applyTaskAssignees(task, names, isClientPerson) {
    const before = taskAssignees(task);
    let list = [...new Set((Array.isArray(names) ? names : [names]).map(clean).filter(Boolean))];
    if (list.some(isGenericAssignee) && list.length > 1) {
        const named = list.filter((a) => !isGenericAssignee(a));
        list = named.length ? named : [list[list.length - 1]];
    }
    if (!list.length) list = ['Sphynx Task'];

    task.assignee = list[0];
    if (list.length > 1) task.assignees = list; else delete task.assignees;
    const fn = typeof isClientPerson === 'function' ? isClientPerson : (window.OL?.computeIsClientTask || (() => false));
    task.isClientTask = list.every((a) => fn(a));
    return { list, added: list.filter((a) => !before.includes(a)) };
}

if (typeof window !== 'undefined') {
window.OL = window.OL || {};
Object.assign(window.OL, { getTaskAssignees: taskAssignees, isGenericAssignee, toggledTaskAssignees: toggledAssignees, applyTaskAssignees });
}
