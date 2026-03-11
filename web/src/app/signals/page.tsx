import { createServiceClient } from "@/lib/supabase";
import SignalColumns from "./signal-columns";

const SOURCE_LABELS: Record<string, string> = {
  lassi: "라씨매매",
  stockbot: "스톡봇",
  quant: "퀀트",
};

export const dynamic = "force-dynamic";

export default async function SignalsPage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string }>;
}) {
  const params = await searchParams;
  const activeSource = params.source || "all";
  const supabase = createServiceClient();

  // 한국 시간 기준 오늘
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const today = kst.toISOString().slice(0, 10);

  // 오늘 신호 전체 조회
  let query = supabase
    .from("signals")
    .select("*")
    .gte("timestamp", `${today}T00:00:00+09:00`)
    .lt("timestamp", `${today}T23:59:59+09:00`)
    .order("timestamp", { ascending: false });

  if (activeSource !== "all") {
    query = query.eq("source", activeSource);
  }

  const { data: rawSignals } = await query;

  // "..." 포함된 이름을 stock_cache에서 풀네임으로 대체 + 시장 정보
  const signalSymbols = [...new Set((rawSignals || []).map((s: Record<string, string>) => s.symbol))];
  let nameMap: Record<string, string> = {};
  let marketMap: Record<string, string> = {};
  let sectorMap: Record<string, string> = {};
  if (signalSymbols.length > 0) {
    const { data: stockNames } = await supabase
      .from("stock_cache")
      .select("symbol, name, market")
      .in("symbol", signalSymbols);
    if (stockNames) {
      nameMap = Object.fromEntries(stockNames.map((s) => [s.symbol, s.name]));
      marketMap = Object.fromEntries(stockNames.map((s) => [s.symbol, s.market || "기타"]));
    }
    // 업종 정보
    const { data: stockInfos } = await supabase
      .from("stock_info")
      .select("symbol, sector")
      .in("symbol", signalSymbols)
      .not("sector", "is", null);
    if (stockInfos) {
      sectorMap = Object.fromEntries(stockInfos.map((s) => [s.symbol, s.sector]));
    }
  }
  // stock_cache에 이름이 있으면 항상 우선 사용
  const signals = (rawSignals || []).map((s: Record<string, string>) => ({
    ...s,
    name: nameMap[s.symbol] || s.name || s.symbol,
    market: marketMap[s.symbol] || "기타",
    sector: sectorMap[s.symbol] || "기타",
  }));

  // 즐겨찾기 목록 조회
  const { data: favorites } = await supabase
    .from("favorite_stocks")
    .select("symbol");

  const favoriteSymbols = (favorites || []).map(
    (f: { symbol: string }) => f.symbol
  );

  // 포트 종목 심볼 (팝업 메뉴용)
  const { data: watchlistItems } = await supabase
    .from("watchlist")
    .select("symbol");
  const watchlistSymbols = (watchlistItems ?? []).map((w) => w.symbol);

  // 매수/매도 분리
  const buySignals = (signals || []).filter(
    (s: Record<string, string>) =>
      s.signal_type === "BUY" || s.signal_type === "BUY_FORECAST"
  );
  const sellSignals = (signals || []).filter(
    (s: Record<string, string>) =>
      s.signal_type === "SELL" || s.signal_type === "SELL_COMPLETE"
  );

  const sources = ["all", "lassi", "stockbot", "quant"] as const;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">오늘의 신호</h1>
        <p className="text-sm text-[var(--muted)] mt-1">{today} 기준</p>
      </div>

      {/* 소스 탭 */}
      <div className="flex gap-2">
        {sources.map((src) => (
          <a
            key={src}
            href={src === "all" ? "/signals" : `/signals?source=${src}`}
            className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
              activeSource === src
                ? "bg-[var(--accent)] text-white border-[var(--accent)]"
                : "bg-[var(--card)] text-[var(--muted)] border-[var(--border)] hover:bg-[var(--card-hover)]"
            }`}
          >
            {src === "all" ? "전체" : SOURCE_LABELS[src]}
          </a>
        ))}
      </div>

      {/* 매수/매도 2컬럼 */}
      <SignalColumns
        buySignals={buySignals}
        sellSignals={sellSignals}
        favoriteSymbols={favoriteSymbols}
        watchlistSymbols={watchlistSymbols}
      />
    </div>
  );
}
