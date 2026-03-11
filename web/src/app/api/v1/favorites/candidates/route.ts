import { createServiceClient } from '@/lib/supabase';

// GET /api/v1/favorites/candidates — 즐겨찾기 후보
// 최근 7일 라씨매매 신호 종목 중 즐겨찾기 미등록 목록
export async function GET() {
  const supabase = createServiceClient();

  // 7일 전 날짜
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // 최근 라씨매매 신호에서 유니크 종목 추출
  const { data: signals, error: signalsErr } = await supabase
    .from('signals')
    .select('symbol, name')
    .eq('source', 'lassi')
    .not('symbol', 'is', null)
    .gte('timestamp', sevenDaysAgo)
    .order('timestamp', { ascending: false });

  if (signalsErr) {
    return Response.json({ error: signalsErr.message }, { status: 500 });
  }

  // 현재 즐겨찾기 목록
  const { data: favorites, error: favErr } = await supabase
    .from('favorite_stocks')
    .select('symbol');

  if (favErr) {
    return Response.json({ error: favErr.message }, { status: 500 });
  }

  const favSymbols = new Set(favorites?.map((f) => f.symbol) ?? []);

  // 즐겨찾기에 없는 종목만 추출 (중복 제거)
  const seen = new Set<string>();
  const candidates: { symbol: string; name: string }[] = [];

  for (const s of signals || []) {
    if (s.symbol && !favSymbols.has(s.symbol) && !seen.has(s.symbol)) {
      seen.add(s.symbol);
      candidates.push({ symbol: s.symbol, name: s.name });
    }
  }

  return Response.json({ candidates });
}
