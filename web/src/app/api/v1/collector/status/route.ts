import { createServiceClient } from '@/lib/supabase';

// GET /api/v1/collector/status — 수집기 연결 상태
export async function GET() {
  const supabase = createServiceClient();

  // 기기별 최신 heartbeat 1건 뷰(078)
  // 행수 제한으로 읽으면 하트비트가 잦은 기기가 나머지를 밀어내므로 뷰로 조회합니다.
  const { data: heartbeats, error } = await supabase
    .from('collector_devices_latest')
    .select('*')
    .order('timestamp', { ascending: false });

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  const devices = (heartbeats || []).map((hb) => {
    const lastSeen = new Date(hb.timestamp);
    const diffMs = Date.now() - lastSeen.getTime();
    // thinkpool-api 는 장중 15분 간격으로 하트비트를 남기므로 임계가 10분이면 항상 오프라인으로 보입니다.
    const isOnline = diffMs < 20 * 60 * 1000;

    return {
      device_id: hb.device_id,
      status: isOnline ? 'online' : 'offline',
      last_seen: hb.timestamp,
      last_signal: hb.last_signal,
      // 수집기가 보낸 status. error_message 는 정상 실행의 요약 문구로도 쓰이므로
      // 오류 여부는 이 값으로 판정해야 합니다.
      last_status: hb.status ?? null,
      error_message: hb.error_message,
      minutes_ago: Math.floor(diffMs / 60000),
    };
  });

  return Response.json({ devices });
}
