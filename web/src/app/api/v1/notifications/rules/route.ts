import { NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

// GET /api/v1/notifications/rules — 알림 규칙 목록
export async function GET() {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from('notification_rules')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ rules: data });
}

// POST /api/v1/notifications/rules — 알림 규칙 생성/수정
export async function POST(request: NextRequest) {
  const body = await request.json();

  if (typeof body.enabled !== 'boolean') {
    return Response.json(
      { error: 'enabled (boolean) is required' },
      { status: 400 }
    );
  }

  // conditions JSONB 구성
  const conditions: Record<string, string> = {};
  if (body.source) conditions.source = body.source;
  if (body.signal_type) conditions.signal_type = body.signal_type;

  const supabase = createServiceClient();

  // 동일한 조건의 규칙이 있으면 업데이트, 없으면 생성
  // 먼저 동일 조건 검색
  const { data: existing } = await supabase
    .from('notification_rules')
    .select('id')
    .eq('conditions', conditions)
    .maybeSingle();

  let data;
  let error;

  if (existing) {
    // 기존 규칙 업데이트
    const result = await supabase
      .from('notification_rules')
      .update({ active: body.enabled })
      .eq('id', existing.id)
      .select()
      .single();
    data = result.data;
    error = result.error;
  } else {
    // 새 규칙 생성
    const result = await supabase
      .from('notification_rules')
      .insert({
        conditions,
        active: body.enabled,
      })
      .select()
      .single();
    data = result.data;
    error = result.error;
  }

  if (error) {
    console.error('notification_rules upsert error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ rule: data }, { status: 201 });
}
