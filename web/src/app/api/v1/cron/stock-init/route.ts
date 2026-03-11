import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();

  // stock_info 테이블에서 종목 기본 정보 가져와서 stock_cache에 초기화
  const { data: stockInfos, error } = await supabase
    .from('stock_info')
    .select('symbol, name, market');

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!stockInfos || stockInfos.length === 0) {
    return NextResponse.json({ error: 'No stock_info data found' }, { status: 404 });
  }

  // 배치로 stock_cache upsert
  const BATCH_SIZE = 500;
  let inserted = 0;

  for (let i = 0; i < stockInfos.length; i += BATCH_SIZE) {
    const batch = stockInfos.slice(i, i + BATCH_SIZE).map((s) => ({
      symbol: s.symbol,
      name: s.name,
      market: s.market || 'KOSPI',
    }));

    const { error: upsertError } = await supabase
      .from('stock_cache')
      .upsert(batch, { onConflict: 'symbol', ignoreDuplicates: true });

    if (!upsertError) {
      inserted += batch.length;
    }
  }

  return NextResponse.json({
    success: true,
    total: stockInfos.length,
    inserted,
  });
}
