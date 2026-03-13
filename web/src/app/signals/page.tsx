import Link from "next/link";
import { createServiceClient } from "@/lib/supabase";
import { DateSelector } from "@/components/common/date-selector";
import { getLastNWeekdays, getKstDayRange } from "@/lib/date-utils";
import SignalColumns from "./signal-columns";
import { StockRankingSection } from "@/components/signals/StockRankingSection";
import { SOURCE_LABELS, extractSignalPrice } from "@/lib/signal-constants";

export const revalidate = 30;

export default async function SignalsPage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string; date?: string; tab?: string }>;
}) {
  const params = await searchParams;
  const activeSource = params.source || "all";
  const activeTab = params.tab === "analysis" ? "analysis" : "signals";
  const supabase = createServiceClient();

  const last7 = getLastNWeekdays(7);
  const selectedDate =
    params.date === "all" ? "all"
    : params.date && last7.includes(params.date) ? params.date
    : last7[0];

  // 즐겨찾기 + 보유 → 두 탭 공통 사용
  const [{ data: favorites }, { data: watchlistItems }] = await Promise.all([
    supabase.from("favorite_stocks").select("symbol"),
    supabase.from("watchlist").select("symbol"),
  ]);
  const favoriteSymbols = (favorites ?? []).map((f: { symbol: string }) => f.symbol);
  const watchlistSymbols = (watchlistItems ?? []).map((w: { symbol: string }) => w.symbol);

  // ── AI 신호 탭 ──────────────────────────────────────────
  let buySignals: Record<string, string>[] = [];
  let sellSignals: Record<string, string>[] = [];

  if (activeTab === "signals") {
    let dateStart: string, dateEnd: string;
    if (selectedDate === "all") {
      const oldest = last7[last7.length - 1];
      const newest = last7[0];
      dateStart = `${oldest}T00:00:00+09:00`;
      dateEnd = `${newest}T23:59:59+09:00`;
    } else {
      const range = getKstDayRange(selectedDate);
      dateStart = range.start;
      dateEnd = range.end;
    }
    let query = supabase
      .from("signals")
      .select("*")
      .gte("timestamp", dateStart)
      .lte("timestamp", dateEnd)
      .order("timestamp", { ascending: false });
    if (activeSource !== "all") query = query.eq("source", activeSource);

    const { data: rawSignals } = await query;

    const signalSymbols = [...new Set((rawSignals || []).map((s: Record<string, string>) => s.symbol))];
    let nameMap: Record<string, string> = {};
    let marketMap: Record<string, string> = {};
    let sectorMap: Record<string, string> = {};
    if (signalSymbols.length > 0) {
      const [{ data: stockNames }, { data: stockInfos }] = await Promise.all([
        supabase.from("stock_cache").select("symbol, name, market").in("symbol", signalSymbols),
        supabase.from("stock_info").select("symbol, name, sector").in("symbol", signalSymbols),
      ]);
      if (stockNames) {
        nameMap = Object.fromEntries(stockNames.map((s) => [s.symbol, s.name]));
        marketMap = Object.fromEntries(stockNames.map((s) => [s.symbol, s.market || "기타"]));
      }
      if (stockInfos) {
        sectorMap = Object.fromEntries(stockInfos.map((s) => [s.symbol, s.sector]));
        for (const s of stockInfos) {
          if (!nameMap[s.symbol] && s.name) nameMap[s.symbol] = s.name;
        }
      }
    }
    const signals = (rawSignals || []).map((s: Record<string, unknown>) => {
      const rawData = s.raw_data as Record<string, unknown> | null;
      const signalPrice = extractSignalPrice(rawData);
      return {
        ...s,
        name: nameMap[s.symbol as string] || (s.name as string) || (s.symbol as string),
        market: marketMap[s.symbol as string] || "기타",
        sector: sectorMap[s.symbol as string] || "기타",
        ...(signalPrice !== null ? { signal_price: String(signalPrice) } : {}),
      } as Record<string, string>;
    });
    buySignals = signals.filter((s) => s.signal_type === "BUY" || s.signal_type === "BUY_FORECAST");
    sellSignals = signals.filter((s) => s.signal_type === "SELL" || s.signal_type === "SELL_COMPLETE");
  }

  const sources = ["all", "lassi", "stockbot", "quant"] as const;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">AI 신호</h1>
          <p className="text-sm text-[var(--muted)] mt-1">{selectedDate === "all" ? "전체 기간" : `${selectedDate} 기준`}</p>
        </div>
        <div className="flex gap-1 rounded-lg border border-[var(--border)] p-1 bg-[var(--card)]">
          <Link
            href="/signals"
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
              activeTab === "signals"
                ? "bg-[var(--accent)] text-white"
                : "text-[var(--muted)] hover:text-[var(--text)]"
            }`}
          >
            AI 신호
          </Link>
          <Link
            href="/signals?tab=analysis"
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
              activeTab === "analysis"
                ? "bg-[var(--accent)] text-white"
                : "text-[var(--muted)] hover:text-[var(--text)]"
            }`}
          >
            종목분석
          </Link>
        </div>
      </div>

      {activeTab === "signals" && (
        <>
          <DateSelector basePath="/signals" selectedDate={selectedDate} weekdaysOnly includeAll />
          <div className="flex gap-2">
            {sources.map((src) => {
              const p = new URLSearchParams();
              if (selectedDate !== last7[0]) p.set("date", selectedDate);
              if (src !== "all") p.set("source", src);
              const qs = p.toString();
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
          <SignalColumns
            buySignals={buySignals}
            sellSignals={sellSignals}
            favoriteSymbols={favoriteSymbols}
            watchlistSymbols={watchlistSymbols}
          />
        </>
      )}

      {activeTab === "analysis" && (
        <StockRankingSection
          favoriteSymbols={favoriteSymbols}
          watchlistSymbols={watchlistSymbols}
        />
      )}
    </div>
  );
}
