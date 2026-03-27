// 스냅샷 세션 목록 조회 API
// snapshot_sessions 테이블에서 세션 목록을 반환합니다.
// 쿼리 파라미터: date (선택, YYYY-MM-DD, 없으면 최근 30일), model (선택, 기본값 'standard')
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get('date');
  const model = searchParams.get('model') || 'standard';

  const supabase = createServiceClient();

  let query = supabase
    .from('snapshot_sessions')
    .select('id, session_date, session_time, model, trigger_type, total_count')
    .eq('model', model)
    .order('session_time', { ascending: true });

  if (date) {
    // 특정 날짜 필터
    query = query.eq('session_date', date);
  } else {
    // 최근 30일
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    query = query.gte('session_date', thirtyDaysAgo.toISOString().split('T')[0]);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(
    { sessions: data ?? [] },
    {
      headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120' },
    },
  );
}
