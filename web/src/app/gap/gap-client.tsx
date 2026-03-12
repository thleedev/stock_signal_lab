"use client";

import { useState, useMemo, useCallback } from "react";
import { ArrowUpDown, RefreshCw } from "lucide-react";
import StockActionMenu from "@/components/common/stock-action-menu";
import { usePriceRefresh } from "@/hooks/use-price-refresh";

const SOURCE_LABELS: Record<string, string> = {
  quant: "퀀트",
  lassi: "라씨",
  stockbot: "스톡봇",
};

const SOURCE_DOTS: Record<string, string> = {
  quant: "bg-blue-400",
  lassi: "bg-red-400",
  stockbot: "bg-green-400",
};

interface GapInfo {
  source: string;
  buyPrice: number;
  gap: number;
  date: string;
}

interface GapStock {
  symbol: string;
  name: string;
  market: string;
  current_price: number | null;
  price_change_pct: number | null;
  volume: number | null;
  market_cap: number | null;
  per: number | null;
  gaps: GapInfo[];
  bestGap: GapInfo | null;
}

interface Props {
  stocks: GapStock[];
  favSymbols: string[];
  watchlistSymbols: string[];
}

type FilterType = "all" | "positive" | "negative";
type SourceFilter = "all" | "quant" | "lassi" | "stockbot";
type MarketFilter = "전체" | "KOSPI" | "KOSDAQ";

function formatNumber(n: number | null): string {
  if (n == null) return "-";
  return n.toLocaleString("ko-KR");
}

export default function GapClient({ stocks: initialStocks, favSymbols, watchlistSymbols }: Props) {
  const [stocks] = useState(initialStocks);
  const [gapFilter, setGapFilter] = useState<FilterType>("negative");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [marketFilter, setMarketFilter] = useState<MarketFilter>("전체");
  const [sortField, setSortField] = useState<"gap" | "volume" | "market_cap">("gap");
  const [favSet] = useState(() => new Set(favSymbols));
  const [portSet] = useState(() => new Set(watchlistSymbols));
  const [priceLoading, setPriceLoading] = useState(false);
  const [actionMenu, setActionMenu] = useState<{
    stock: GapStock;
    position: { x: number; y: number };
  } | null>(null);

  // 자동 가격 폴링 (60초 간격)
  const allSymbols = useMemo(() => stocks.map((s) => s.symbol), [stocks]);
  const { prices: livePrices, refresh: refreshLivePrices, loading: liveLoading } = usePriceRefresh(allSymbols);

  // 라이브 가격이 반영된 종목 데이터 (파생 상태)
  const stocksWithLivePrices = useMemo(() => {
    if (Object.keys(livePrices).length === 0) return stocks;
    return stocks.map((stock) => {
      const live = livePrices[stock.symbol];
      if (!live?.current_price || live.current_price === stock.current_price) return stock;
      const newPrice = live.current_price;
      const newGaps = stock.gaps.map((g) => ({
        ...g,
        gap: ((newPrice - g.buyPrice) / g.buyPrice) * 100,
      }));
      newGaps.sort((a, b) => a.gap - b.gap);
      return {
        ...stock,
        current_price: newPrice,
        price_change_pct: live.price_change_pct ?? stock.price_change_pct,
        volume: live.volume ?? stock.volume,
        gaps: newGaps,
        bestGap: newGaps[0] ?? stock.bestGap,
      };
    });
  }, [stocks, livePrices]);

  // 수동 가격 갱신: POST로 서버 캐시 강제 갱신 → 훅의 refresh로 라이브 가격 재조회
  const refreshPrices = useCallback(async () => {
    if (priceLoading || liveLoading) return;
    setPriceLoading(true);
    try {
      await fetch("/api/v1/prices", { method: "POST" });
      await refreshLivePrices();
    } catch (e) {
      console.error("[GapClient] 가격 갱신 실패:", e);
    } finally {
      setPriceLoading(false);
    }
  }, [priceLoading, liveLoading, refreshLivePrices]);

  const filteredStocks = useMemo(() => {
    return stocksWithLivePrices
      .map((stock) => {
        // 소스 필터에 맞는 gap 선택
        let activeGap: GapInfo | null = null;
        if (sourceFilter === "all") {
          activeGap = stock.bestGap;
        } else {
          activeGap = stock.gaps.find((g) => g.source === sourceFilter) ?? null;
        }
        return { ...stock, activeGap };
      })
      .filter((s) => {
        if (!s.activeGap) return false;
        if (gapFilter === "positive" && s.activeGap.gap < 0) return false;
        if (gapFilter === "negative" && s.activeGap.gap >= 0) return false;
        if (marketFilter !== "전체" && s.market !== marketFilter) return false;
        return true;
      })
      .sort((a, b) => {
        if (sortField === "gap") {
          return (a.activeGap?.gap ?? 999) - (b.activeGap?.gap ?? 999);
        }
        if (sortField === "volume") {
          return (b.volume ?? 0) - (a.volume ?? 0);
        }
        return (b.market_cap ?? 0) - (a.market_cap ?? 0);
      });
  }, [stocksWithLivePrices, gapFilter, sourceFilter, marketFilter, sortField]);

  const handleRowClick = useCallback((e: React.MouseEvent, stock: GapStock) => {
    if ((e.target as HTMLElement).closest("button")) return;
    setActionMenu({
      stock,
      position: {
        x: Math.min(e.clientX, window.innerWidth - 220),
        y: Math.min(e.clientY, window.innerHeight - 250),
      },
    });
  }, []);

  return (
    <div className="space-y-4">
      {/* 실시간 가격 상태 */}
      <div className="flex items-center justify-end gap-2">
        {priceLoading && (
          <span className="text-xs text-yellow-400">
            현재가 갱신 중...
          </span>
        )}
        <button
          onClick={refreshPrices}
          disabled={priceLoading}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--card)] border border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)] transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${priceLoading ? "animate-spin" : ""}`} />
          현재가 갱신
        </button>
      </div>
      {/* 필터 바 */}
      <div className="card p-4">
        <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
          {/* Gap 방향 */}
          <div className="flex gap-1">
            {([
              { key: "negative", label: "매수가↓" },
              { key: "all", label: "전체" },
              { key: "positive", label: "매수가↑" },
            ] as const).map((f) => (
              <button
                key={f.key}
                onClick={() => setGapFilter(f.key)}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  gapFilter === f.key
                    ? "bg-[var(--accent)] text-white"
                    : "bg-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)]"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* AI 소스 필터 */}
          <div className="flex gap-1">
            {([
              { key: "all", label: "전체AI" },
              { key: "quant", label: "퀀트" },
              { key: "lassi", label: "라씨" },
              { key: "stockbot", label: "스톡봇" },
            ] as const).map((f) => (
              <button
                key={f.key}
                onClick={() => setSourceFilter(f.key)}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  sourceFilter === f.key
                    ? "bg-[var(--accent)] text-white"
                    : "bg-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)]"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* 시장 필터 */}
          <div className="flex gap-1">
            {(["전체", "KOSPI", "KOSDAQ"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMarketFilter(m)}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  marketFilter === m
                    ? "bg-[var(--accent)] text-white"
                    : "bg-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)]"
                }`}
              >
                {m}
              </button>
            ))}
          </div>

          {/* 정렬 */}
          <div className="relative">
            <ArrowUpDown className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--muted)]" />
            <select
              value={sortField}
              onChange={(e) => setSortField(e.target.value as typeof sortField)}
              className="pl-9 pr-8 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-sm text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)] appearance-none cursor-pointer"
            >
              <option value="gap">Gap순</option>
              <option value="volume">거래량순</option>
              <option value="market_cap">시가총액순</option>
            </select>
          </div>
        </div>
      </div>

      {/* 결과 카운트 */}
      <div className="text-sm text-[var(--muted)]">
        {filteredStocks.length}개 종목
      </div>

      {/* 테이블 */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-[var(--muted)] text-xs">
                <th className="px-3 py-3 text-left">종목명</th>
                <th className="px-3 py-3 text-left">코드</th>
                <th className="px-3 py-3 text-right">현재가</th>
                <th className="px-3 py-3 text-right">등락률</th>
                <th className="px-3 py-3 text-right">매수가</th>
                <th className="px-3 py-3 text-right">Gap</th>
                <th className="px-3 py-3 text-center">AI소스</th>
                <th className="px-3 py-3 text-right">거래량</th>
                <th className="px-3 py-3 text-right">PER</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {filteredStocks.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-[var(--muted)]">
                    조건에 맞는 종목이 없습니다
                  </td>
                </tr>
              ) : (
                filteredStocks.map((stock) => {
                  const ag = stock.activeGap;
                  return (
                    <tr
                      key={stock.symbol}
                      onClick={(e) => handleRowClick(e, stock)}
                      className="hover:bg-[var(--card-hover)] transition-colors cursor-pointer"
                    >
                      <td className="px-3 py-2.5">
                        <span className="font-medium">{stock.name}</span>
                      </td>
                      <td className="px-3 py-2.5 text-[var(--muted)] text-xs">
                        {stock.symbol}
                      </td>
                      <td className={`px-3 py-2.5 text-right font-medium tabular-nums ${
                        (stock.price_change_pct ?? 0) > 0 ? "text-red-400" : (stock.price_change_pct ?? 0) < 0 ? "text-blue-400" : ""
                      }`}>
                        {formatNumber(stock.current_price)}
                      </td>
                      <td className={`px-3 py-2.5 text-right tabular-nums ${
                        (stock.price_change_pct ?? 0) > 0 ? "text-red-400" : (stock.price_change_pct ?? 0) < 0 ? "text-blue-400" : ""
                      }`}>
                        {stock.price_change_pct != null
                          ? `${stock.price_change_pct > 0 ? "+" : ""}${stock.price_change_pct.toFixed(2)}%`
                          : "-"}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-[var(--muted)]">
                        {ag ? formatNumber(ag.buyPrice) : "-"}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {ag ? (
                          <span className={`text-xs font-bold ${ag.gap >= 0 ? "text-red-400" : "text-blue-400"}`}>
                            {ag.gap >= 0 ? "+" : ""}{ag.gap.toFixed(1)}%
                          </span>
                        ) : "-"}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        {ag && (
                          <div className="flex items-center justify-center gap-1">
                            <span className={`w-2 h-2 rounded-full ${SOURCE_DOTS[ag.source] ?? "bg-gray-400"}`} />
                            <span className="text-xs text-[var(--muted)]">
                              {SOURCE_LABELS[ag.source] ?? ag.source}
                            </span>
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right text-[var(--muted)] tabular-nums">
                        {formatNumber(stock.volume)}
                      </td>
                      <td className="px-3 py-2.5 text-right text-[var(--muted)] tabular-nums">
                        {stock.per != null ? stock.per.toFixed(1) : "-"}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 종목 액션 메뉴 */}
      {actionMenu && (
        <StockActionMenu
          symbol={actionMenu.stock.symbol}
          name={actionMenu.stock.name}
          currentPrice={actionMenu.stock.current_price}
          isOpen={true}
          onClose={() => setActionMenu(null)}
          position={actionMenu.position}
          isFavorite={favSet.has(actionMenu.stock.symbol)}
          isInPortfolio={portSet.has(actionMenu.stock.symbol)}
        />
      )}
    </div>
  );
}
