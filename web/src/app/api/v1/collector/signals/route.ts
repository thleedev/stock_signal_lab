import { NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { verifyCollectorKey, unauthorizedResponse } from '@/lib/auth';

/**
 * POST /api/v1/collector/signals — 수집기 신호 일괄 저장
 *
 * 수집기가 anon 키로 /rest/v1/rpc/upsert_signals_bulk 를 직접 부르던 경로를 대신합니다.
 * 서버가 service_role 로 같은 RPC 를 호출하므로 중복 처리 규칙은 그대로입니다.
 * (같은 종목·소스·타입은 KST 하루 한 행, 충돌 시 signal_time 만 COALESCE 병합)
 *
 * /api/v1/signals/batch 와 달리 BUY_FORECAST 승격이나 FCM 알림을 하지 않습니다.
 * 수집기 기존 동작을 그대로 옮기는 것이 목적입니다.
 */
export async function POST(request: NextRequest) {
  if (!verifyCollectorKey(request)) {
    return unauthorizedResponse();
  }

  let payload: unknown;
  try {
    ({ payload } = await request.json());
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  if (!Array.isArray(payload)) {
    return Response.json({ error: 'payload array is required' }, { status: 400 });
  }
  if (payload.length === 0) {
    return Response.json({ inserted: 0 });
  }

  const supabase = createServiceClient();
  const { error } = await supabase.rpc('upsert_signals_bulk', { payload });

  if (error) {
    console.error('[collector/signals] upsert 실패:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ inserted: payload.length });
}
