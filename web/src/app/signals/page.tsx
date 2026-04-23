import Link from "next/link";
import { createServiceClient } from "@/lib/supabase";
import { PageLayout, PageHeader } from "@/components/ui";
import { getLastNWeekdays, getKstDayRange, getLastNDaysRange } from "@/lib/date-utils";
import { getEffectiveThemeDate, fetchThemeMap } from "@/lib/theme-utils";
import SignalColumns from "./signal-columns";
import { extractSignalPrice } from "@/lib/signal-constants";
import { SignalFilterBar } from "./signal-filter-bar";
import RecommendationView from "@/components/signals/RecommendationView";
import { HotThemesBanner } from "@/components/signals/HotThemesBanner";
import { CollectingBanner } from "@/components/signals/CollectingBanner";
import type { WatchlistGroup } from "@/types/stock";

export const dynamic = 'force-dynamic';

export default async function SignalsPage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string; date?: string; tab?: string; theme?: string; leader?: string }>;
}) {
  const params = await searchParams;
  const activeSource = params.source || "all";
  const activeTab = params.tab === "stock-analysis" ? "stock-analysis" : "signals";
  const activeTheme = params.theme || "all";
  const leaderOnly = params.leader === "1";
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
  let buySignals: (Record<string, string> & { is_leader?: boolean })[] = [];
  let sellSignals: (Record<string, string> & { is_leader?: boolean })[] = [];

  if (activeTab === "signals") {
    if (selectedDate === "all") {
      // ── 전체 모드: 현재 BUY/SELL 상태 종목 전체 (stock_cache 기반, 기간 무관, 페이지네이션) ──
      const PAGE = 1000;

      // BUY 상태 전체 수집
      const activeBuyRows: Record<string, unknown>[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data } = await supabase
          .from("stock_cache")
          .select("symbol, name, market, latest_signal_date, latest_signal_type, latest_signal_price")
          .eq("has_active_sell", false)
          .not("latest_signal_date", "is", null)
          .order("latest_signal_date", { ascending: false })
          .range(from, from + PAGE - 1);
        if (!data || data.length === 0) break;
        activeBuyRows.push(...data);
        if (data.length < PAGE) break;
      }

      // SELL 상태 전체 수집
      const activeSellRows: Record<string, unknown>[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data } = await supabase
          .from("stock_cache")
          .select("symbol, name, market, latest_sell_date")
          .eq("has_active_sell", true)
          .not("latest_sell_date", "is", null)
          .order("latest_sell_date", { ascending: false })
          .range(from, from + PAGE - 1);
        if (!data || data.length === 0) break;
        activeSellRows.push(...data);
        if (data.length < PAGE) break;
      }

      const toSignal = (s: Record<string, unknown>, type: "buy" | "sell") => ({
        symbol: s.symbol as string,
        name: (s.name as string) || (s.symbol as string),
        market: (s.market as string) || "기타",
        signal_type: type === "buy" ? ((s.latest_signal_type as string) || "BUY") : "SELL",
        source: "",
        timestamp: (type === "buy" ? s.latest_signal_date : s.latest_sell_date) as string,
        signal_price: s.latest_signal_price ? String(s.latest_signal_price) : "",
        sector: "",
      });

      buySignals  = activeBuyRows.map((s) => toSignal(s, "buy"));
      sellSignals = activeSellRows.map((s) => toSignal(s, "sell"));

    } else {
      // ── 날짜 범위 모드: 오늘 / 최근7일 / 특정일 ──
      const range = selectedDate === "week"
        ? getLastNDaysRange(7)
        : getKstDayRange(selectedDate);

      let query = supabase
        .from("signals")
        .select("*")
        .not("symbol", "is", null)
        .gte("timestamp", range.start)
        .lte("timestamp", range.end)
        .order("timestamp", { ascending: false });
      if (activeSource !== "all") query = query.eq("source", activeSource);

      const { data: rawSignals } = await query;

      const signalSymbols = [...new Set((rawSignals || []).map((s: Record<string, string>) => s.symbol))];
      let nameMap: Record<string, string> = {};
      let marketMap: Record<string, string> = {};
      let sectorMap: Record<string, string> = {};
      let leaderMap: Record<string, boolean> = {};
      let themeTagsMap: Record<string, { theme_id: string; theme_name: string; momentum_score: number; is_hot: boolean }[]> = {};
      let activeSellSymbols = new Set<string>();
      if (signalSymbols.length > 0) {
        const todayKst = last7[0];
        const [{ data: stockNames }, { data: stockInfos }] = await Promise.all([
          supabase.from("stock_cache").select("symbol, name, market, has_active_sell").in("symbol", signalSymbols),
          supabase.from("stock_info").select("symbol, name, sector").in("symbol", signalSymbols),
        ]);
        if (stockNames) {
          nameMap = Object.fromEntries(stockNames.map((s) => [s.symbol, s.name]));
          marketMap = Object.fromEntries(stockNames.map((s) => [s.symbol, s.market || "기타"]));
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
        // 테마 데이터 (오늘 없으면 최근 날짜 fallback)
        const effectiveThemeDate = await getEffectiveThemeDate(supabase, todayKst);
        const themeMap = await fetchThemeMap(supabase, signalSymbols, effectiveThemeDate);
        for (const [sym, info] of themeMap) {
          leaderMap[sym] = info.is_leader;
          themeTagsMap[sym] = info.theme_tags;
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
          is_leader: leaderMap[s.symbol as string] ?? false,
          is_hot_theme: (themeTagsMap[s.symbol as string] ?? []).some(t => t.is_hot),
          theme_tags: themeTagsMap[s.symbol as string] ?? [],
          ...(signalPrice !== null ? { signal_price: String(signalPrice) } : {}),
        } as unknown as Record<string, string> & { is_leader?: boolean; is_hot_theme?: boolean; theme_tags?: { theme_id: string; theme_name: string; momentum_score: number; is_hot: boolean }[] };
      });

      signals.sort((a, b) => {
        const timeA = new Date((a.signal_time || a.timestamp) as string).getTime();
        const timeB = new Date((b.signal_time || b.timestamp) as string).getTime();
        return timeB - timeA;
      });

      buySignals = signals.filter((s) =>
        (s.signal_type === "BUY" || s.signal_type === "BUY_FORECAST") &&
        !activeSellSymbols.has(s.symbol as string)
      );
      sellSignals = signals.filter((s) => s.signal_type === "SELL" || s.signal_type === "SELL_COMPLETE");
    } // end else (날짜 범위 모드)
  } // end if (activeTab === "signals")


  return (
    <PageLayout>
      {activeTab === "signals" ? (
        <>
          <PageHeader
            title="AI 신호"
            subtitle={selectedDate === "all" ? "현재 BUY 상태 전체" : selectedDate === "week" ? "최근 7일" : `${selectedDate} 기준`}
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
          <CollectingBanner />

          {/* 필터 한 줄: 날짜·소스·주도주 */}
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <SignalFilterBar dates={last7} selectedDate={selectedDate} activeSource={activeSource} />
            <Link
              href={`/signals?source=${activeSource}&date=${selectedDate}${leaderOnly ? "" : "&leader=1"}`}
              className={`rounded px-2.5 py-1.5 text-xs font-medium border whitespace-nowrap ${
                leaderOnly
                  ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/40"
                  : "bg-[var(--card)] text-[var(--muted)] border-[var(--border)]"
              }`}
            >
              👑 주도주만
            </Link>
          </div>

          {/* 핫 테마 배너 */}
          <HotThemesBanner />

          <SignalColumns
            buySignals={
              leaderOnly
                ? buySignals.filter((s) => (s as Record<string, unknown>).is_leader === true)
                : buySignals
            }
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
