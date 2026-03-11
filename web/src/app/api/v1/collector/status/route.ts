import { createServiceClient } from '@/lib/supabase';

// GET /api/v1/collector/status — 수집기 연결 상태
export async function GET() {
  const supabase = createServiceClient();

  // 최근 heartbeat (기기별 최신 1건)
  const { data: heartbeats, error } = await supabase
    .from('collector_heartbeats')
    .select('*')
    .order('timestamp', { ascending: false })
    .limit(10);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  // 기기별 최신 상태만 추출
  const deviceMap = new Map<string, (typeof heartbeats)[0]>();
  for (const hb of heartbeats || []) {
    if (!deviceMap.has(hb.device_id)) {
      deviceMap.set(hb.device_id, hb);
    }
  }

  const devices = Array.from(deviceMap.values()).map((hb) => {
    const lastSeen = new Date(hb.timestamp);
    const diffMs = Date.now() - lastSeen.getTime();
    const isOnline = diffMs < 10 * 60 * 1000; // 10분 이내면 online

    return {
      device_id: hb.device_id,
      status: isOnline ? 'online' : 'offline',
      last_seen: hb.timestamp,
      last_signal: hb.last_signal,
      error_message: hb.error_message,
      minutes_ago: Math.floor(diffMs / 60000),
    };
  });

  return Response.json({ devices });
}
