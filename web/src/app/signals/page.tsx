import Link from "next/link";
import { createServiceClient } from "@/lib/supabase";
import { PageLayout, PageHeader } from "@/components/ui";
import { getLastNWeekdays, getKstDayRange, getKstWeekRange } from "@/lib/date-utils";
import SignalColumns from "./signal-columns";
import { extractSignalPrice } from "@/lib/signal-constants";
import { SignalFilterBar } from "./signal-filter-bar";
import RecommendationView from "@/components/signals/RecommendationView";
import type { WatchlistGroup } from "@/types/stock";

export const dynamic = 'force-dynamic';

export default async function SignalsPage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string; date?: string; tab?: string }>;
}) {
  const params = await searchParams;
  const activeSource = params.source || "all";
  const activeTab = params.tab === "stock-analysis" ? "stock-analysis" : "signals";
  const supabase = createServiceClient();

  const last7 = getLastNWeekdays(7);

  // date가 명시되지 않은 경우 오늘 신호 유무 확인 → 없으면 신호전체를 기본으로
  const isDateAuto = !params.date;
  let defaultDateMode: 'today' | 'signal_all' = 'today';
  if (isDateAuto) {
    const todayRange = getKstDayRange(last7[0]);
    const { count } = await supabase
      .from("signals")
      .select("*", { count: "exact", head: true })
      .not("symbol", "is", null)
      .gte("timestamp", todayRange.start)
      .lte("timestamp", todayRange.end);
    if (!count || count === 0) defaultDateMode = 'signal_all';
  }

  const selectedDate =
    params.date === "all" ? "all"
    : params.date === "week" ? "week"
    : params.date && last7.includes(params.date) ? params.date
    : defaultDateMode === 'signal_all' ? "all"
    : last7[0];

  // 즐겨찾기 + 보유 + 관심그룹 + 가격 업데이트 시간 → 두 탭 공통 사용
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
      .not("symbol", "is", null)
      .gte("timestamp", dateStart)
      .lte("timestamp", dateEnd)
      .order("timestamp", { ascending: false });
    if (activeSource !== "all") query = query.eq("source", activeSource);

    const { data: rawSignals } = await query;

    const signalSymbols = [...new Set((rawSignals || []).map((s: Record<string, string>) => s.symbol))];
    let nameMap: Record<string, string> = {};
    let marketMap: Record<string, string> = {};
    let sectorMap: Record<string, string> = {};
    let activeSellSymbols = new Set<string>();
    if (signalSymbols.length > 0) {
      const [{ data: stockNames }, { data: stockInfos }] = await Promise.all([
        supabase.from("stock_cache").select("symbol, name, market, has_active_sell").in("symbol", signalSymbols),
        supabase.from("stock_info").select("symbol, name, sector").in("symbol", signalSymbols),
      ]);
      if (stockNames) {
        nameMap = Object.fromEntries(stockNames.map((s) => [s.symbol, s.name]));
        marketMap = Object.fromEntries(stockNames.map((s) => [s.symbol, s.market || "기타"]));
        // 현재 상태가 SELL인 종목 집합 (BUY 신호 필터링에 사용)
        activeSellSymbols = new Set(
          stockNames.filter((s) => s.has_active_sell === true).map((s) => s.symbol)
        );
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

    buySignals = signals.filter((s) =>
      (s.signal_type === "BUY" || s.signal_type === "BUY_FORECAST") &&
      !activeSellSymbols.has(s.symbol)
    );
    sellSignals = signals.filter((s) => s.signal_type === "SELL" || s.signal_type === "SELL_COMPLETE");
  }


  return (
    <PageLayout>
      {activeTab === "signals" ? (
        <>
          <PageHeader
            title="AI 신호"
            subtitle={selectedDate === "all" ? "전체 기간" : selectedDate === "week" ? "이번주" : `${selectedDate} 기준`}
            action={
              <div className="flex gap-1 rounded-lg border border-[var(--border)] p-1 bg-[var(--card)]">
                <span className="px-3 py-1.5 text-sm font-medium rounded-md bg-[var(--accent)] text-white">
                  AI 신호
                </span>
                <Link
                  href="/signals?tab=stock-analysis"
                  className="px-3 py-1.5 text-sm font-medium rounded-md transition-colors text-[var(--muted)] hover:text-[var(--text)]"
                >
                  종목분석
                </Link>
              </div>
            }
          />
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
      ) : (
        <RecommendationView
          initialDateMode={defaultDateMode}
          favoriteSymbols={favoriteSymbols}
          watchlistSymbols={watchlistSymbols}
          groups={groups}
          symbolGroups={symbolGroups}
        />
      )}
    </PageLayout>
  );
}
