// 종목별 스냅샷 히스토리 API
// 특정 종목의 시간순 스냅샷 이력을 반환합니다.
// 쿼리 파라미터: symbol (필수), model (선택, 기본값 'standard'), limit (선택, 기본값 30, 최대 100)
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get('symbol');
  const model = searchParams.get('model') || 'standard';
  const limitParam = parseInt(searchParams.get('limit') ?? '30', 10);
  const limit = Math.min(Math.max(1, isNaN(limitParam) ? 30 : limitParam), 100);

  if (!symbol) {
    return NextResponse.json({ error: 'symbol 파라미터 필요' }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('stock_ranking_snapshot')
    .select(`
      session_id,
      current_price,
      score_total,
      grade,
      snapshot_time,
      snapshot_sessions!inner (
        id,
        session_date,
        session_time,
        trigger_type
      )
    `)
    .eq('symbol', symbol)
    .eq('model', model)
    .order('snapshot_time', { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const items = (data ?? []).map((row) => {
    const session = row.snapshot_sessions as unknown as {
      id: number;
      session_date: string;
      session_time: string;
      trigger_type: string;
    };
    return {
      session_id: row.session_id,
      session_date: session.session_date,
      session_time: session.session_time,
      trigger_type: session.trigger_type,
      snapshot_price: row.current_price,
      grade: row.grade,
      score_total: row.score_total,
    };
  });

  return NextResponse.json(
    { symbol, model, items },
    {
      headers: { 'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=300' },
    },
  );
}
