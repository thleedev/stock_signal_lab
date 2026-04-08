import { createServiceClient } from '@/lib/supabase';

// GET /api/v1/signals/today — 오늘의 신호 (소스별 그룹)
export async function GET() {
  const supabase = createServiceClient();

  // 한국 시간 기준 오늘
  const now = new Date();
  const kstOffset = 9 * 60 * 60 * 1000;
  const kstNow = new Date(now.getTime() + kstOffset);
  const today = kstNow.toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from('signals')
    .select('*')
    .gte('timestamp', `${today}T00:00:00+09:00`)
    .lt('timestamp', `${today}T23:59:59+09:00`)
    .order('timestamp', { ascending: false });

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  // 소스별 그룹
  const grouped: Record<string, typeof data> = { lassi: [], stockbot: [], quant: [], prizm: [] };
  const counts: Record<string, { total: number; buy: number; sell: number }> = {
    lassi: { total: 0, buy: 0, sell: 0 },
    stockbot: { total: 0, buy: 0, sell: 0 },
    quant: { total: 0, buy: 0, sell: 0 },
    prizm: { total: 0, buy: 0, sell: 0 },
  };

  for (const signal of data || []) {
    const src = signal.source as string;
    if (grouped[src]) {
      grouped[src].push(signal);
      counts[src].total++;
      if (['BUY', 'BUY_FORECAST'].includes(signal.signal_type)) {
        counts[src].buy++;
      } else if (['SELL', 'SELL_COMPLETE'].includes(signal.signal_type)) {
        counts[src].sell++;
      }
    }
  }

  return Response.json({
    date: today,
    signals: grouped,
    counts,
    total: data?.length ?? 0,
  }, {
    headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60' },
  });
}
