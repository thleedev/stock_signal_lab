import { NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { verifyCollectorKey, unauthorizedResponse } from '@/lib/auth';

interface AlphaCatchHoldingInput {
  symbol: string;
  name: string;
  return_pct?: number | null;
  close_price?: number | null;
  avg_buy_price?: number | null;
  bought_at?: string | null;
}

interface PutBody {
  holdings: AlphaCatchHoldingInput[];
}

// PUT /api/v1/holdings/alphacatch — 알파캐치 보유 종목 전체 덮어쓰기
export async function PUT(request: NextRequest) {
  if (!verifyCollectorKey(request)) {
    return unauthorizedResponse();
  }

  const body = (await request.json()) as PutBody;
  if (!body.holdings || !Array.isArray(body.holdings)) {
    return Response.json({ error: 'holdings array is required' }, { status: 400 });
  }

  const supabase = createServiceClient();
  const capturedAt = new Date().toISOString();

  const rows = body.holdings
    .filter((h) => h.symbol && h.name)
    .map((h) => ({
      symbol: h.symbol,
      name: h.name,
      return_pct: h.return_pct ?? null,
      close_price: h.close_price ?? null,
      avg_buy_price: h.avg_buy_price ?? null,
      bought_at: h.bought_at ?? null,
      captured_at: capturedAt,
    }));

  const { error: deleteError } = await supabase
    .from('alphacatch_holdings')
    .delete()
    .neq('symbol', '');
  if (deleteError) {
    return Response.json({ error: deleteError.message }, { status: 500 });
  }

  if (rows.length === 0) {
    return Response.json({ inserted: 0, captured_at: capturedAt });
  }

  const { error: insertError } = await supabase.from('alphacatch_holdings').insert(rows);
  if (insertError) {
    return Response.json({ error: insertError.message }, { status: 500 });
  }

  return Response.json({ inserted: rows.length, captured_at: capturedAt });
}

// GET /api/v1/holdings/alphacatch — 보유 종목 조회 (포트폴리오 페이지용)
export async function GET() {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('alphacatch_holdings')
    .select('*')
    .order('return_pct', { ascending: false, nullsFirst: false });

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ holdings: data ?? [] });
}
