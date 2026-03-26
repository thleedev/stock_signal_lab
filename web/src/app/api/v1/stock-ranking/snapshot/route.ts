// 과거 스냅샷 조회 API
// stock_ranking_snapshot 테이블에서 특정 날짜의 가장 최신 스냅샷을 반환합니다.
// 쿼리 파라미터: date (필수, YYYY-MM-DD), model (선택, 기본값 'standard')
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get('date');
  const model = searchParams.get('model') || 'standard';

  if (!date) {
    return NextResponse.json({ error: 'date 파라미터 필요' }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('stock_ranking_snapshot')
    .select('*')
    .eq('snapshot_date', date)
    .eq('model', model)
    .order('score_total', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // 해당 날짜의 마감 스냅샷 (가장 늦은 snapshot_time 기준으로 필터링)
  const latestTime = data?.length
    ? data.reduce(
        (max, r) =>
          new Date(r.snapshot_time as string) > new Date(max)
            ? (r.snapshot_time as string)
            : max,
        data[0].snapshot_time as string,
      )
    : null;

  const items = data?.filter((r) => r.snapshot_time === latestTime) ?? [];

  return NextResponse.json(
    {
      date,
      model,
      snapshot_time: latestTime,
      items: items.map((row) => ({
        ...((row.raw_data as Record<string, unknown>) ?? {}),
        symbol: row.symbol,
        name: row.name,
        market: row.market,
        current_price: row.current_price,
        score_total: row.score_total,
        grade: row.grade,
        characters: row.characters,
        recommendation: row.recommendation,
        signal_date: row.signal_date,
      })),
      total: items.length,
    },
    {
      headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' },
    },
  );
}
