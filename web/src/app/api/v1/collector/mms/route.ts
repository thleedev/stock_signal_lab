import { NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { verifyCollectorKey, unauthorizedResponse } from '@/lib/auth';

interface MmsBody {
  sender?: string | null;
  source?: string | null;
  body?: string | null;
  device_id?: string | null;
}

/**
 * POST /api/v1/collector/mms — SMS·MMS 원문 저장
 *
 * 수집기가 anon 키로 mms_raw_messages 에 직접 INSERT 하던 경로를 대신합니다.
 * 파싱 실패를 사후에 추적하려고 원문을 그대로 보관합니다.
 */
export async function POST(request: NextRequest) {
  if (!verifyCollectorKey(request)) {
    return unauthorizedResponse();
  }

  let payload: MmsBody;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  if (!payload.body) {
    return Response.json({ error: 'body is required' }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { error } = await supabase.from('mms_raw_messages').insert({
    sender: payload.sender ?? null,
    source: payload.source ?? null,
    body: payload.body,
    device_id: payload.device_id ?? null,
  });

  if (error) {
    console.error('[collector/mms] 저장 실패:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ ok: true });
}
