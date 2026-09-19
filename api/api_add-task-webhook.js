// POST /api/add-task-webhook
//
// Adds a task/deliverable to a client's workspace from an external system
// (Zapier, Make, a form tool, etc.). Mirrors the same task shape and
// defaulting rules the app itself uses when creating tasks — see
// features/tasks.js (OL.saveClientCreateTask) and features/business/tasks.js
// (OL.getSystemStatuses) for the in-app equivalents.
//
// Auth: shared secret via the `x-webhook-secret` header, checked against
// the TASK_WEBHOOK_SECRET env var. This endpoint writes data, so it can't
// be left open — set that env var in Vercel before using this.
//
// Required env vars (same ones the other /api webhooks use):
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   TASK_WEBHOOK_SECRET   (new — pick any long random string)

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function generateTaskId() {
  return 'tsk_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  const secret = req.headers['x-webhook-secret'];
  if (!secret || secret !== process.env.TASK_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized. Include a valid x-webhook-secret header.' });
  }

  const {
    clientId,
    clientName,
    title,
    description = '',
    assignee,
    status,
    dueDate = ''
  } = req.body || {};

  if (!title || typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: '`title` is required and must be a non-empty string.' });
  }
  if (!clientId && !clientName) {
    return res.status(400).json({ error: 'Provide either `clientId` or `clientName` to identify the project.' });
  }

  // Resolve the target client row. Prefer clientId (exact) when given;
  // fall back to a case-insensitive name match.
  let query = supabase.from('workspace_clients').select('id, meta, project_data');
  query = clientId ? query.eq('id', clientId) : query.ilike('meta->>name', clientName);
  const { data: rows, error: fetchErr } = await query;

  if (fetchErr) return res.status(500).json({ error: fetchErr.message });
  if (!rows || rows.length === 0) {
    return res.status(404).json({ error: 'No client matched clientId/clientName.' });
  }
  if (rows.length > 1) {
    return res.status(409).json({
      error: 'clientName matched more than one client — use clientId instead.',
      matches: rows.map(r => ({ id: r.id, name: r.meta?.name }))
    });
  }

  const client = rows[0];
  const projectData = client.project_data || {};
  if (!Array.isArray(projectData.clientTasks)) projectData.clientTasks = [];

  // Same partner-vs-Sphynx-client defaulting the app itself applies (see
  // features/tasks.js) — a client owned by a partner gets the generic
  // Pending/In Process/Complete pipeline and "Team Task" default, a direct
  // Sphynx client gets the Sphynx pipeline and "Sphynx Task" default.
  const isPartnerClient = !!client.meta?.partnerOwner;
  const resolvedAssignee = assignee || (isPartnerClient ? 'Team Task' : 'Sphynx Task');
  const resolvedStatus = status || (isPartnerClient ? 'Pending' : 'Pending Sphynx Action');

  const newTask = {
    id: generateTaskId(),
    title: title.trim(),
    name: title.trim(),
    description,
    status: resolvedStatus,
    assignee: resolvedAssignee,
    dueDate,
    isClientTask: resolvedAssignee !== 'Sphynx Task' && resolvedAssignee !== 'Team Task',
    loggedHours: 0,
    createdAt: new Date().toISOString(),
    createdBy: 'webhook'
  };

  projectData.clientTasks.unshift(newTask);

  const { error: updateErr } = await supabase
    .from('workspace_clients')
    .update({ project_data: projectData })
    .eq('id', client.id);

  if (updateErr) return res.status(500).json({ error: updateErr.message });

  return res.status(200).json({ status: 'created', clientId: client.id, task: newTask });
}
