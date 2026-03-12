"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import Link from "next/link";
import { Star, Search, ArrowUpDown, Loader2, Briefcase } from "lucide-react";
import type { StockCache, SourceSignal } from "@/types/stock";
import StockActionMenu from "@/components/common/stock-action-menu";

interface Props {
  initialStocks: StockCache[];
  favorites: StockCache[];
  watchlistSymbols?: string[];
  lastPriceUpdate?: string | null;
  favGroups?: Record<string, string>;
}

const SIGNAL_COLORS: Record<string, string> = {
  BUY: "bg-red-900/50 text-red-400 border-red-700",
  BUY_FORECAST: "bg-red-900/30 text-red-300 border-red-800",
  SELL: "bg-blue-900/50 text-blue-400 border-blue-700",
  SELL_COMPLETE: "bg-blue-900/30 text-blue-300 border-blue-800",
};

const SIGNAL_LABELS: Record<string, string> = {
  BUY: "매수",
  BUY_FORECAST: "매수예고",
  SELL: "매도",
  SELL_COMPLETE: "매도완료",
};

const SOURCE_LABELS: Record<string, string> = {
  quant: "퀀트",
  lassi: "라씨",
  stockbot: "스톡봇",
};

function formatNumber(n: number | null): string {
  if (n == null) return "-";
  return n.toLocaleString("ko-KR");
}

function formatPercent(n: number | null): string {
  if (n == null) return "-";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function priceColor(change: number | null): string {
  if (change == null || change === 0) return "text-[var(--foreground)]";
  return change > 0 ? "text-red-400" : "text-blue-400";
}

type SourceKey = "quant" | "lassi" | "stockbot";

/** Gap 계산: (현재가 - 매수가) / 매수가 * 100
 * prioritySource: 특정 AI 우선 또는 "all"이면 모든 소스 중 최소 Gap */
function calcGap(stock: StockCache, prioritySource: SourceKey | "all" = "all"): { gap: number; source: string } | null {
  if (!stock.current_price || !stock.signals) return null;

  const candidates: { gap: number; source: string }[] = [];
  const sources: SourceKey[] = prioritySource === "all"
    ? ["quant", "lassi", "stockbot"]
    : [prioritySource];

  for (const src of sources) {
    const sig = stock.signals[src];
    if (sig?.type && (sig.type === "BUY" || sig.type === "BUY_FORECAST") && sig.price && sig.price > 0) {
      candidates.push({
        gap: ((stock.current_price - sig.price) / sig.price) * 100,
        source: src,
      });
    }
  }

  if (candidates.length === 0) return null;
  // 가장 작은 gap (매수가에 가까운) 반환
  candidates.sort((a, b) => a.gap - b.gap);
  return candidates[0];
}

const SORT_MAP: Record<string, string> = {
  name: "name",
  change: "price_change_pct",
  volume: "volume",
  per: "per",
  gap: "name", // gap은 클라이언트 정렬이지만 서버 fallback용
};

function SignalBadge({ sig, source }: { sig: SourceSignal; source: string }) {
  if (!sig.type) {
    return <span className="text-[10px] text-[var(--border)]">-</span>;
  }
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span
        className={`inline-block text-[10px] leading-tight px-1.5 py-0.5 rounded border whitespace-nowrap ${
          SIGNAL_COLORS[sig.type] ?? "bg-gray-800 text-gray-400 border-gray-700"
        }`}
        title={`${SOURCE_LABELS[source]} ${sig.type}`}
      >
        {SIGNAL_LABELS[sig.type] ?? sig.type}
      </span>
      {sig.price != null && sig.price > 0 && (
        <span className="text-[10px] text-[var(--muted)] tabular-nums">
          {formatNumber(sig.price)}
        </span>
      )}
    </div>
  );
}

export default function StockListClient({ initialStocks, favorites, watchlistSymbols = [], lastPriceUpdate, favGroups = {} }: Props) {
  const [stocks, setStocks] = useState<StockCache[]>(initialStocks);
  const [query, setQuery] = useState("");
  const [market, setMarket] = useState("전체");
  const [sortBy, setSortBy] = useState("name");
  const [favSet, setFavSet] = useState<Set<string>>(
    () => new Set(favorites.map((f) => f.symbol))
  );
  const [favStocks, setFavStocks] = useState<StockCache[]>(favorites);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [portSet, setPortSet] = useState<Set<string>>(() => new Set(watchlistSymbols));
  const [gapSource, setGapSource] = useState<SourceKey | "all">("all");
  const [favGroupFilter, setFavGroupFilter] = useState<string | null>(null);

  // 그룹 목록
  const favGroupList = useMemo(() => {
    const set = new Set<string>();
    for (const v of Object.values(favGroups)) set.add(v);
    return Array.from(set).sort();
  }, [favGroups]);
  const [actionMenu, setActionMenu] = useState<{
    stock: StockCache;
    position: { x: number; y: number };
  } | null>(null);

  const fetchStocks = useCallback(
    async (pageNum: number, reset: boolean = false) => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        params.set("page", String(pageNum));
        params.set("limit", "50");
        params.set("withSignals", "true");

        // gap 정렬은 서버에서 지원하지 않으므로 name 기준으로 가져옴
        const serverSort = sortBy === "gap" ? "name" : (SORT_MAP[sortBy] || "name");
        params.set("sortBy", serverSort);
        if (sortBy === "change" || sortBy === "volume") params.set("sortDir", "desc");
        if (market !== "전체") params.set("market", market);
        if (query.trim()) params.set("q", query.trim());

        const res = await fetch(`/api/v1/stocks?${params}`);
        if (!res.ok) return;
        const json = await res.json();
        const newData: StockCache[] = json.data ?? [];

        if (reset) {
          setStocks(newData);
        } else {
          setStocks((prev) => [...prev, ...newData]);
        }
        setHasMore(pageNum < (json.totalPages ?? 1));
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    },
    [market, query, sortBy]
  );

  // 필터/정렬 변경 시 리셋
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPage(1);
      fetchStocks(1, true);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [market, query, sortBy, fetchStocks]);

  // IntersectionObserver for infinite scroll
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loading) {
          const nextPage = page + 1;
          setPage(nextPage);
          fetchStocks(nextPage);
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loading, page, fetchStocks]);

  const toggleFavorite = useCallback(
    async (stock: StockCache) => {
      const isFav = favSet.has(stock.symbol);
      const newSet = new Set(favSet);

      if (isFav) {
        newSet.delete(stock.symbol);
        setFavStocks((prev) => prev.filter((s) => s.symbol !== stock.symbol));
        fetch(`/api/v1/favorites/${stock.symbol}`, { method: "DELETE" });
      } else {
        newSet.add(stock.symbol);
        setFavStocks((prev) => [...prev, stock]);
        fetch("/api/v1/favorites", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol: stock.symbol, name: stock.name }),
        });
      }

      setFavSet(newSet);
    },
    [favSet]
  );

  // 즐겨찾기 상단 고정 + 일반 종목 (즐겨찾기 제외) 결합
  const displayStocks = useMemo(() => {
    // 즐겨찾기 종목 (favStocks 기반, 하지만 실시간 데이터는 stocks에서 갱신)
    const favSymbols = new Set(favStocks.map((f) => f.symbol));
    const updatedFavs = favStocks.map((fav) => {
      const updated = stocks.find((s) => s.symbol === fav.symbol);
      return updated ?? fav;
    });
    // 그룹 필터 적용
    const filteredFavs = favGroupFilter
      ? updatedFavs.filter((f) => (favGroups[f.symbol] || "기본") === favGroupFilter)
      : updatedFavs;

    // 일반 종목 (즐겨찾기 제외)
    const nonFavs = favGroupFilter
      ? [] // 그룹 필터 시 즐겨찾기만 표시
      : stocks.filter((s) => !favSymbols.has(s.symbol));

    // gap 정렬이면 클라이언트에서 정렬 (매수가 < 현재가인 것 우선)
    if (sortBy === "gap") {
      const sortByGap = (a: StockCache, b: StockCache) => {
        const gapA = calcGap(a, gapSource);
        const gapB = calcGap(b, gapSource);
        if (gapA == null && gapB == null) return 0;
        if (gapA == null) return 1;
        if (gapB == null) return -1;
        const aPos = gapA.gap > 0;
        const bPos = gapB.gap > 0;
        if (aPos && !bPos) return -1;
        if (!aPos && bPos) return 1;
        return gapA.gap - gapB.gap;
      };
      filteredFavs.sort(sortByGap);
      nonFavs.sort(sortByGap);
    }

    return { favs: filteredFavs, nonFavs };
  }, [stocks, favStocks, sortBy, gapSource, favGroupFilter, favGroups]);

  const handleRowClick = useCallback((e: React.MouseEvent, stock: StockCache) => {
    // 즐겨찾기 버튼 클릭은 무시
    if ((e.target as HTMLElement).closest("button")) return;
    setActionMenu({
      stock,
      position: { x: Math.min(e.clientX, window.innerWidth - 220), y: Math.min(e.clientY, window.innerHeight - 250) },
    });
  }, []);

  const renderRow = (stock: StockCache, isFav: boolean) => {
    const gapResult = calcGap(stock, gapSource);
    const gap = gapResult?.gap ?? null;
    const gapSrc = gapResult?.source ?? null;
    const signals = stock.signals ?? {
      lassi: { type: null, price: null },
      stockbot: { type: null, price: null },
      quant: { type: null, price: null },
    };

    return (
      <tr
        key={stock.symbol}
        onClick={(e) => handleRowClick(e, stock)}
        className={`hover:bg-[var(--card-hover)] transition-colors cursor-pointer ${
          isFav ? "bg-yellow-900/5" : ""
        }`}
      >
        <td className="px-3 py-2.5">
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => toggleFavorite(stock)}
              className="p-0.5 hover:scale-110 transition-transform"
            >
              <Star
                className={`w-4 h-4 ${
                  isFav
                    ? "text-yellow-400 fill-yellow-400"
                    : "text-[var(--border)] hover:text-yellow-400"
                }`}
              />
            </button>
            {portSet.has(stock.symbol) && (
              <Briefcase className="w-3.5 h-3.5 text-emerald-400 fill-emerald-400/20" />
            )}
          </div>
        </td>
        <td className="px-3 py-2.5">
          <span className="font-medium">{stock.name}</span>
        </td>
        <td className="px-3 py-2.5 text-[var(--muted)] text-xs">
          {stock.symbol}
        </td>
        <td
          className={`px-3 py-2.5 text-right font-medium tabular-nums ${priceColor(stock.price_change)}`}
        >
          {formatNumber(stock.current_price)}
        </td>
        <td
          className={`px-3 py-2.5 text-right font-medium tabular-nums ${priceColor(stock.price_change_pct)}`}
        >
          {formatPercent(stock.price_change_pct)}
        </td>
        <td className="px-3 py-2.5 text-right text-[var(--muted)] tabular-nums">
          {formatNumber(stock.volume)}
        </td>
        <td className="px-3 py-2.5 text-right text-[var(--muted)] tabular-nums">
          {stock.per != null ? stock.per.toFixed(1) : "-"}
        </td>
        {/* 퀀트 */}
        <td className="px-2 py-2.5 text-center">
          <SignalBadge sig={signals.quant} source="quant" />
        </td>
        {/* 라씨 */}
        <td className="px-2 py-2.5 text-center">
          <SignalBadge sig={signals.lassi} source="lassi" />
        </td>
        {/* 스톡봇 */}
        <td className="px-2 py-2.5 text-center">
          <SignalBadge sig={signals.stockbot} source="stockbot" />
        </td>
        {/* Gap */}
        <td className="px-3 py-2.5 text-right tabular-nums">
          {gap != null ? (
            <div className="flex flex-col items-end gap-0.5">
              <span className={`text-xs font-medium ${gap >= 0 ? "text-red-400" : "text-blue-400"}`}>
                {gap >= 0 ? "+" : ""}{gap.toFixed(1)}%
              </span>
              {gapSrc && (
                <span className="text-[9px] text-[var(--muted)]">
                  {SOURCE_LABELS[gapSrc] ?? gapSrc}
                </span>
              )}
            </div>
          ) : (
            <span className="text-xs text-[var(--border)]">-</span>
          )}
        </td>
      </tr>
    );
  };

  // 가격 업데이트 시간 포맷
  const priceUpdateLabel = useMemo(() => {
    if (!lastPriceUpdate) return null;
    const d = new Date(lastPriceUpdate);
    const now = new Date();
    const diffMin = Math.floor((now.getTime() - d.getTime()) / 60000);
    if (diffMin < 1) return "가격 업데이트 완료";
    if (diffMin < 60) return `${diffMin}분 전 업데이트`;
    return `${d.toLocaleDateString("ko-KR")} ${d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })} 업데이트`;
  }, [lastPriceUpdate]);

  return (
    <div className="space-y-4">
      {/* 가격 업데이트 상태 */}
      {priceUpdateLabel && (
        <div className={`text-xs text-right ${priceUpdateLabel.includes("완료") ? "text-green-400" : "text-[var(--muted)]"}`}>
          {priceUpdateLabel}
        </div>
      )}
      {/* 필터 바 */}
      <div className="card p-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--muted)]" />
            <input
              type="text"
              placeholder="종목명/코드 검색"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-sm text-[var(--foreground)] placeholder:text-[var(--muted)] focus:outline-none focus:border-[var(--accent)]"
            />
          </div>

          <div className="flex gap-1">
            {["전체", "KOSPI", "KOSDAQ", "ETF"].map((m) => (
              <button
                key={m}
                onClick={() => setMarket(m)}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  market === m
                    ? "bg-[var(--accent)] text-white"
                    : "bg-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)]"
                }`}
              >
                {m}
              </button>
            ))}
          </div>

          <div className="relative">
            <ArrowUpDown className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--muted)]" />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="pl-9 pr-8 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-sm text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)] appearance-none cursor-pointer"
            >
              <option value="name">이름순</option>
              <option value="change">등락률순</option>
              <option value="volume">거래량순</option>
              <option value="per">PER순</option>
              <option value="gap">Gap순</option>
            </select>
          </div>

          {/* Gap AI소스 우선순위 */}
          <select
            value={gapSource}
            onChange={(e) => setGapSource(e.target.value as SourceKey | "all")}
            className="px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-sm text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)] appearance-none cursor-pointer"
            title="Gap 기준 AI"
          >
            <option value="all">Gap: 전체AI</option>
            <option value="quant">Gap: 퀀트</option>
            <option value="lassi">Gap: 라씨</option>
            <option value="stockbot">Gap: 스톡봇</option>
          </select>

          {/* 즐겨찾기 그룹 필터 */}
          {favGroupList.length > 0 && (
            <select
              value={favGroupFilter ?? ""}
              onChange={(e) => setFavGroupFilter(e.target.value || null)}
              className="px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-sm text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)] appearance-none cursor-pointer"
              title="즐겨찾기 그룹"
            >
              <option value="">그룹: 전체</option>
              {favGroupList.map((g) => (
                <option key={g} value={g}>그룹: {g}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* 종목 테이블 */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-[var(--muted)] text-xs">
                <th className="px-3 py-3 text-left w-10"></th>
                <th className="px-3 py-3 text-left">종목명</th>
                <th className="px-3 py-3 text-left">코드</th>
                <th className="px-3 py-3 text-right">현재가</th>
                <th className="px-3 py-3 text-right">등락률</th>
                <th className="px-3 py-3 text-right">거래량</th>
                <th className="px-3 py-3 text-right">PER</th>
                <th className="px-2 py-3 text-center" title="퀀트 신호">
                  <span className="inline-flex items-center gap-0.5">
                    퀀트
                  </span>
                </th>
                <th className="px-2 py-3 text-center" title="라씨 신호">
                  <span className="inline-flex items-center gap-0.5">
                    라씨
                  </span>
                </th>
                <th className="px-2 py-3 text-center" title="스톡봇 신호">
                  <span className="inline-flex items-center gap-0.5">
                    스톡봇
                  </span>
                </th>
                <th className="px-3 py-3 text-right">Gap</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {/* 즐겨찾기 종목 상단 고정 */}
              {displayStocks.favs.length > 0 && (
                <>
                  {displayStocks.favs.map((stock) => renderRow(stock, true))}
                  {/* 구분선 */}
                  <tr>
                    <td colSpan={11} className="px-0 py-0">
                      <div className="border-b-2 border-yellow-600/30" />
                    </td>
                  </tr>
                </>
              )}
              {/* 일반 종목 */}
              {displayStocks.nonFavs.length === 0 &&
              displayStocks.favs.length === 0 &&
              !loading ? (
                <tr>
                  <td
                    colSpan={11}
                    className="px-4 py-12 text-center text-[var(--muted)]"
                  >
                    검색 결과가 없습니다
                  </td>
                </tr>
              ) : (
                displayStocks.nonFavs.map((stock) => renderRow(stock, false))
              )}
            </tbody>
          </table>
        </div>

        {/* 무한 스크롤 센티널 */}
        <div ref={sentinelRef} className="h-4" />
        {loading && (
          <div className="flex justify-center py-4">
            <Loader2 className="w-5 h-5 animate-spin text-[var(--muted)]" />
          </div>
        )}
        {!hasMore && stocks.length > 0 && (
          <div className="text-center py-3 text-xs text-[var(--muted)]">
            총 {stocks.length}개 종목
          </div>
        )}
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
          onToggleFavorite={() => {
            toggleFavorite(actionMenu.stock);
            setActionMenu(null);
          }}
        />
      )}
    </div>
  );
}
