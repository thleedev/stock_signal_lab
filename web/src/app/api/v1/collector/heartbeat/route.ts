import { NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { verifyCollectorKey, unauthorizedResponse } from '@/lib/auth';

interface HeartbeatBody {
  device_id?: string | null;
  status?: string | null;
  last_signal?: string | null;
  timestamp?: string | null;
  error_message?: string | null;
}

/**
 * POST /api/v1/collector/heartbeat — 수집기 상태 기록
 *
 * 수집기가 anon 키로 collector_heartbeats 에 직접 INSERT 하던 경로를 대신합니다.
 * 대시보드(web/src/app/collector/page.tsx)가 읽는 값이라 실패해도 수집 흐름을
 * 막지 않도록 수집기 쪽에서 fire-and-forget 으로 부릅니다.
 */
export async function POST(request: NextRequest) {
  if (!verifyCollectorKey(request)) {
    return unauthorizedResponse();
  }

  let body: HeartbeatBody;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  if (!body.device_id) {
    return Response.json({ error: 'device_id is required' }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { error } = await supabase.from('collector_heartbeats').insert({
    device_id: body.device_id,
    status: body.status ?? null,
    last_signal: body.last_signal ?? null,
    timestamp: body.timestamp ?? new Date().toISOString(),
    error_message: body.error_message ?? null,
  });

  if (error) {
    console.error('[collector/heartbeat] 기록 실패:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ ok: true });
}
