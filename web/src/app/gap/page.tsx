import { createServiceClient } from "@/lib/supabase";
import GapClient from "./gap-client";

export const revalidate = 120;

export default async function GapPage() {
  const supabase = createServiceClient();

  // 1. 신호가 있는 종목의 BUY 신호 조회 (최근 30일)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const since30d = thirtyDaysAgo.toISOString();

  const { data: buySignals } = await supabase
    .from("signals")
    .select("symbol, name, source, signal_type, raw_data, timestamp")
    .in("signal_type", ["BUY", "BUY_FORECAST"])
    .in("source", ["lassi", "stockbot", "quant"])
    .gte("timestamp", since30d)
    .order("timestamp", { ascending: false });

  // 2. 소스별 최신 매수 신호 추출 (매수가는 raw_data 안에 있음)
  const signalMap: Record<string, Record<string, { price: number; date: string }>> = {};
  for (const sig of buySignals ?? []) {
    if (!sig.symbol) continue;
    const rd = sig.raw_data as Record<string, number> | null;
    const buyPrice = rd?.signal_price || rd?.recommend_price || rd?.buy_range_low || 0;
    if (buyPrice <= 0) continue;
    if (!signalMap[sig.symbol]) signalMap[sig.symbol] = {};
    if (!signalMap[sig.symbol][sig.source]) {
      signalMap[sig.symbol][sig.source] = {
        price: buyPrice,
        date: sig.timestamp,
      };
    }
  }

  const signalSymbols = Object.keys(signalMap);
  if (signalSymbols.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">GAP 추천</h1>
          <p className="text-sm text-[var(--muted)] mt-1">매수 신호 대비 현재가 Gap 분석</p>
        </div>
        <div className="card p-12 text-center text-[var(--muted)]">
          최근 30일 이내 매수 신호가 없습니다
        </div>
      </div>
    );
  }

  // 3. stock_cache + 즐겨찾기 + 포트 심볼 병렬 조회
  const [
    { data: stocks },
    { data: favorites },
    { data: watchlistItems },
  ] = await Promise.all([
    supabase.from("stock_cache")
      .select("symbol, name, market, current_price, price_change_pct, volume, market_cap, per")
      .in("symbol", signalSymbols).not("current_price", "is", null),
    supabase.from("favorite_stocks").select("symbol"),
    supabase.from("watchlist").select("symbol"),
  ]);

  const favSymbols = (favorites ?? []).map((f) => f.symbol);
  const watchlistSymbols = (watchlistItems ?? []).map((w) => w.symbol);

  // 4. Gap 계산 및 데이터 병합
  const gapStocks = (stocks ?? [])
    .map((stock) => {
      const signals = signalMap[stock.symbol] ?? {};
      const gaps: Array<{ source: string; buyPrice: number; gap: number; date: string }> = [];
      for (const [source, sig] of Object.entries(signals)) {
        if (stock.current_price && sig.price > 0) {
          const gap = ((stock.current_price - sig.price) / sig.price) * 100;
          gaps.push({ source, buyPrice: sig.price, gap, date: sig.date });
        }
      }
      gaps.sort((a, b) => a.gap - b.gap);
      const bestGap = gaps[0] ?? null;

      return {
        ...stock,
        gaps,
        bestGap,
      };
    })
    .filter((s) => s.bestGap !== null);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">GAP 추천</h1>
        <p className="text-sm text-[var(--muted)] mt-1">
          AI 매수신호 대비 현재가 하락 종목 · 저가 매수 기회 분석
        </p>
      </div>
      <GapClient
        stocks={gapStocks}
        favSymbols={favSymbols}
        watchlistSymbols={watchlistSymbols}
      />
    </div>
  );
}
