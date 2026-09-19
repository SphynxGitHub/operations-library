import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { event, payload } = req.body;

  if (event === 'meeting.ended') {
    const { id, topic, duration, host_email, start_time } = payload.object;

    // Match client via meeting participant/topic or context payload
    const { data: client } = await supabase
      .from('client_profiles')
      .select('id')
      .eq('email', payload.object.client_email || '')
      .single();

    if (client) {
      await supabase.from('activity_logs').insert({
        client_id: client.id,
        integration_type: 'zoom',
        external_id: String(id),
        title: `Zoom Meeting: ${topic}`,
        billable: true,
        billable_duration_minutes: duration, // Actual call time logged
        metadata: { start_time, duration_minutes: duration, host_email },
        activity_timestamp: start_time
      });
    }
  }

  return res.status(200).json({ status: 'received' });
}
