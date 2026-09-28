//======================= CORE / ROLL DOWN LINKS =======================//
// When a request is activated and its build tasks are created, everything already linked to the request from
// email rolls down onto those tasks: each excerpt and attachment linked to the request, and the whole email if it
// was linked to the request as a whole. Copies are added (never moved), each remembering what it came from
// (rolledDownFrom) so it isn't added twice, is removed along with the original, and isn't listed twice on the
// request. Pure functions on an email's piece_links array.

// pieceLinks: the email's piece_links. message: { id, subject, linked_request_id }.
// tasks: [{ id, title }]. Returns { pieceLinks, added } — the new array and how many copies were made.
export function rollDownPieceLinks(pieceLinks, message, requestId, tasks, ctx) {
    const list = Array.isArray(pieceLinks) ? [...pieceLinks] : [];
    const rid = String(requestId);
    const have = new Set(list.filter((l) => l && l.rolledDownFrom).map((l) => `${l.rolledDownFrom}|${l.targetId}`));
    let added = 0;
    const copy = (fromKey, base, task) => {
        if (have.has(`${fromKey}|${task.id}`)) return;
        list.push({
            ...base, id: ctx.uid(), targetType: 'task', targetId: String(task.id), targetLabel: task.title || 'Task',
            createdAt: ctx.now, rolledDownFrom: fromKey,
        });
        have.add(`${fromKey}|${task.id}`); added++;
    };

    (Array.isArray(pieceLinks) ? pieceLinks : []).forEach((l) => {
        if (!l || l.rolledDownFrom || l.targetType !== 'request' || String(l.targetId) !== rid) return;
        const base = { kind: l.kind || 'excerpt', text: l.text || '', note: l.note || '' };
        if (l.attachmentPath) base.attachmentPath = l.attachmentPath;
        if (l.attachmentName) base.attachmentName = l.attachmentName;
        (tasks || []).forEach((t) => copy(l.id, base, t));
    });

    // The email linked to the request as a whole (not through an excerpt).
    if (message && String(message.linked_request_id || '') === rid) {
        (tasks || []).forEach((t) => copy(`email:${message.id}`, { kind: 'email', text: message.subject || 'Email', note: '' }, t));
    }
    return { pieceLinks: list, added };
}

// Removing a link also removes the copies that were rolled down from it.
export function removePieceLink(pieceLinks, linkId) {
    return (Array.isArray(pieceLinks) ? pieceLinks : []).filter((l) => l && l.id !== linkId && l.rolledDownFrom !== linkId);
}
