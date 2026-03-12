import Link from "next/link";
import { createServiceClient } from "@/lib/supabase";
import { DateSelector } from "@/components/common/date-selector";
import { getLastNDays } from "@/lib/date-utils";
import SignalColumns from "./signal-columns";

const SOURCE_LABELS: Record<string, string> = {
  lassi: "라씨매매",
  stockbot: "스톡봇",
  quant: "퀀트",
};

export const revalidate = 30;

export default async function SignalsPage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string; date?: string }>;
}) {
  const params = await searchParams;
  const activeSource = params.source || "all";
  const supabase = createServiceClient();

  // 날짜: searchParams에서 가져오거나 KST 오늘
  const last7 = getLastNDays(7);
  const selectedDate = params.date && last7.includes(params.date) ? params.date : last7[0];
  const today = selectedDate;

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

  // 1단계: 신호 쿼리 + 독립 쿼리 병렬 실행
  const [
    { data: rawSignals },
    { data: favorites },
    { data: watchlistItems },
  ] = await Promise.all([
    query,
    supabase.from("favorite_stocks").select("symbol"),
    supabase.from("watchlist").select("symbol"),
  ]);

  const favoriteSymbols = (favorites || []).map(
    (f: { symbol: string }) => f.symbol
  );
  const watchlistSymbols = (watchlistItems ?? []).map((w) => w.symbol);

  // 2단계: rawSignals에 의존하는 쿼리 (stock_cache + stock_info 병렬)
  const signalSymbols = [...new Set((rawSignals || []).map((s: Record<string, string>) => s.symbol))];
  let nameMap: Record<string, string> = {};
  let marketMap: Record<string, string> = {};
  let sectorMap: Record<string, string> = {};
  if (signalSymbols.length > 0) {
    const [{ data: stockNames }, { data: stockInfos }] = await Promise.all([
      supabase.from("stock_cache").select("symbol, name, market").in("symbol", signalSymbols),
      supabase.from("stock_info").select("symbol, sector").in("symbol", signalSymbols).not("sector", "is", null),
    ]);
    if (stockNames) {
      nameMap = Object.fromEntries(stockNames.map((s) => [s.symbol, s.name]));
      marketMap = Object.fromEntries(stockNames.map((s) => [s.symbol, s.market || "기타"]));
    }
    if (stockInfos) {
      sectorMap = Object.fromEntries(stockInfos.map((s) => [s.symbol, s.sector]));
    }
  }
  const signals = (rawSignals || []).map((s: Record<string, string>) => ({
    ...s,
    name: nameMap[s.symbol] || s.name || s.symbol,
    market: marketMap[s.symbol] || "기타",
    sector: sectorMap[s.symbol] || "기타",
  }));

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
        <h1 className="text-2xl font-bold">AI 신호</h1>
        <p className="text-sm text-[var(--muted)] mt-1">{selectedDate} 기준</p>
      </div>

      {/* 날짜 선택 */}
      <DateSelector basePath="/signals" selectedDate={selectedDate} />

      {/* 소스 탭 */}
      <div className="flex gap-2">
        {sources.map((src) => {
          const params = new URLSearchParams();
          if (selectedDate !== last7[0]) params.set("date", selectedDate);
          if (src !== "all") params.set("source", src);
          const qs = params.toString();
          return (
            <Link
              key={src}
              href={qs ? `/signals?${qs}` : "/signals"}
              className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                activeSource === src
                  ? "bg-[var(--accent)] text-white border-[var(--accent)]"
                  : "bg-[var(--card)] text-[var(--muted)] border-[var(--border)] hover:bg-[var(--card-hover)]"
              }`}
            >
              {src === "all" ? "전체" : SOURCE_LABELS[src]}
            </Link>
          );
        })}
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
