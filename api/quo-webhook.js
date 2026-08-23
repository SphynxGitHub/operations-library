import { createClient } from '@supabase/supabase-secret'; // Backend Service Role

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { from_phone, message_body, message_id, timestamp } = req.body;
  const cleanPhone = from_phone.replace(/\D/g, '');

  // Match phone to client
  const { data: client } = await supabase
    .from('client_profiles')
    .select('id')
    .ilike('phone', `%${cleanPhone.slice(-10)}%`)
    .single();

  if (!client) {
    return res.status(404).json({ error: 'Client profile not found' });
  }

  // Log SMS activity
  const { error } = await supabase.from('activity_logs').insert({
    client_id: client.id,
    integration_type: 'quo',
    external_id: message_id,
    title: 'SMS Received',
    metadata: { body: message_body, raw_phone: from_phone },
    activity_timestamp: new Date(timestamp).toISOString()
  });

  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ status: 'logged' });
}
