import Link from "next/link";
import { createServiceClient } from "@/lib/supabase";
import { PageLayout, PageHeader } from "@/components/ui";
import { getLastNWeekdays, getKstDayRange, getKstWeekRange } from "@/lib/date-utils";
import SignalColumns from "./signal-columns";
import { UnifiedAnalysisSection, type SignalMap } from "@/components/signals/UnifiedAnalysisSection";
import { extractSignalPrice } from "@/lib/signal-constants";
import { SignalFilterBar } from "./signal-filter-bar";
import type { WatchlistGroup } from "@/types/stock";

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
    : params.date === "week" ? "week"
    : params.date && last7.includes(params.date) ? params.date
    : last7[0];

  // 즐겨찾기 + 보유 + 관심그룹 → 두 탭 공통 사용
  const [{ data: favorites }, { data: watchlistItems }, { data: groupRows }, { data: groupStockRows }] = await Promise.all([
    supabase.from("favorite_stocks").select("symbol"),
    supabase.from("watchlist").select("symbol"),
    supabase.from("watchlist_groups").select("*").order("sort_order"),
    supabase.from("watchlist_group_stocks").select("group_id, symbol"),
  ]);
  const favoriteSymbols = (favorites ?? []).map((f: { symbol: string }) => f.symbol);
  const watchlistSymbols = (watchlistItems ?? []).map((w: { symbol: string }) => w.symbol);
  const groups: WatchlistGroup[] = groupRows ?? [];
  const symbolGroups: Record<string, string[]> = {};
  for (const r of groupStockRows ?? []) {
    if (!symbolGroups[r.symbol]) symbolGroups[r.symbol] = [];
    symbolGroups[r.symbol].push(r.group_id);
  }

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
    } else if (selectedDate === "week") {
      const range = getKstWeekRange();
      dateStart = range.start;
      dateEnd = range.end;
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

    // signal_time 우선, 없으면 timestamp 기준 내림차순 정렬
    // signal_time 없는 항목은 timestamp(스크래핑 시간)이 더 늦으므로 자연스럽게 위에 표시
    signals.sort((a, b) => {
      const timeA = new Date(a.signal_time || a.timestamp).getTime();
      const timeB = new Date(b.signal_time || b.timestamp).getTime();
      return timeB - timeA;
    });

    buySignals = signals.filter((s) => s.signal_type === "BUY" || s.signal_type === "BUY_FORECAST");
    sellSignals = signals.filter((s) => s.signal_type === "SELL" || s.signal_type === "SELL_COMPLETE");
  }

  // ── 종목분석 탭 ──────────────────────────────────────────
  const signalMap: SignalMap = {};

  if (activeTab === "analysis") {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const since30d = thirtyDaysAgo.toISOString();

    const { data: buySignals } = await supabase
      .from("signals")
      .select("symbol, source, signal_type, raw_data, timestamp")
      .in("signal_type", ["BUY", "BUY_FORECAST"])
      .in("source", ["lassi", "stockbot", "quant"])
      .gte("timestamp", since30d)
      .order("timestamp", { ascending: false });

    for (const sig of buySignals ?? []) {
      if (!sig.symbol) continue;
      const rd = sig.raw_data as Record<string, number> | null;
      const buyPrice =
        rd?.signal_price || rd?.recommend_price || rd?.buy_range_low || 0;
      if (buyPrice <= 0) continue;
      if (!signalMap[sig.symbol]) signalMap[sig.symbol] = {};
      if (!signalMap[sig.symbol][sig.source]) {
        signalMap[sig.symbol][sig.source] = {
          buyPrice,
          date: sig.timestamp,
        };
      }
    }
  }

  return (
    <PageLayout>
      <PageHeader
        title="AI 신호"
        subtitle={selectedDate === "all" ? "전체 기간" : selectedDate === "week" ? "이번주" : `${selectedDate} 기준`}
        action={
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
        }
      />

      {activeTab === "signals" && (
        <>
          <SignalFilterBar dates={last7} selectedDate={selectedDate} activeSource={activeSource} />
          <SignalColumns
            buySignals={buySignals}
            sellSignals={sellSignals}
            favoriteSymbols={favoriteSymbols}
            watchlistSymbols={watchlistSymbols}
            groups={groups}
            symbolGroups={symbolGroups}
          />
        </>
      )}

      {activeTab === "analysis" && (
        <UnifiedAnalysisSection
          signalMap={signalMap}
          favoriteSymbols={favoriteSymbols}
          watchlistSymbols={watchlistSymbols}
          groups={groups}
          symbolGroups={symbolGroups}
        />
      )}
    </PageLayout>
  );
}
