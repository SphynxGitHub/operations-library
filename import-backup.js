import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // Use Service Role Key for full write privileges
);

async function importBackup() {
  // Read local backup file
  const rawData = fs.readFileSync('./backup.json', 'utf8');
  const backupData = JSON.parse(rawData);

  console.log('🚀 Starting import to Supabase...');

  // 1. Insert Master Configuration
  const { error: masterErr } = await supabase.from('workspace_masters').insert({
    exported_at: backupData._exportedAt,
    version: backupData._version,
    rates: backupData.master?.rates || {},
    resource_types: backupData.master?.resourceTypes || [],
    datapoints: backupData.master?.datapoints || []
  });

  if (masterErr) console.error('Error inserting Master Data:', masterErr.message);
  else console.log('✅ Master configuration imported.');

  // 2. Insert Clients & Project Entities
  for (const client of backupData.clients || []) {
    console.log(`📦 Processing Client: ${client._id}`);

    await supabase.from('workspace_clients').upsert({
      id: client._id,
      public_token: client.publicToken
    });

    const project = client.projectData || {};

    // 2a. Insert Pipeline Stages
    if (project.stages?.length) {
      const stageRecords = project.stages.map((stg) => ({
        id: stg.id,
        client_id: client._id,
        name: stg.name,
        y_pos: stg.yPos,
        width: stg.width,
        stage_order: stg.order || 0
      }));
      await supabase.from('workspace_stages').upsert(stageRecords);
      console.log(`  └─ Inserted ${stageRecords.length} stages.`);
    }

    // 2b. Insert Team Members
    if (project.teamMembers?.length) {
      const teamRecords = project.teamMembers.map((tm) => ({
        id: tm.id,
        client_id: client._id,
        name: tm.name,
        roles: tm.roles || [],
        created_at: tm.createdDate ? new Date(tm.createdDate).toISOString() : null
      }));
      await supabase.from('team_members').upsert(teamRecords);
      console.log(`  └─ Inserted ${teamRecords.length} team members.`);
    }

    // 2c. Insert Resources & Workflows
    if (project.localResources?.length) {
      const resourceRecords = project.localResources.map((res) => ({
        id: res.id,
        client_id: client._id,
        stage_id: res.stageId || null,
        workflow_id: res.workflowId || null,
        name: res.name || 'Untitled Resource',
        type: res.type || null,
        archetype: res.archetype || null,
        app_name: res.appName || null,
        app_id: res.appId || null,
        external_link: res.externalLink || null,
        is_global: !!res.isGlobal,
        is_archived: !!res.isArchived,
        steps: res.steps || []
      }));
      await supabase.from('workspace_resources').upsert(resourceRecords);
      console.log(`  └─ Inserted ${resourceRecords.length} workflows/resources.`);
    }
  }

  console.log('🎉 Migration finished successfully!');
}

importBackup();
