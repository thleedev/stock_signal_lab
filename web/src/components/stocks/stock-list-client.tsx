"use client";

import React, { useState, useCallback, useRef, useEffect, useMemo, memo } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { Star, Search, ArrowUpDown, Loader2, Briefcase, RefreshCw } from "lucide-react";
import type { StockCache, SourceSignal } from "@/types/stock";
import type { WatchlistGroup } from "@/types/stock";
import StockActionMenu from "@/components/common/stock-action-menu";
import WatchlistGroupTabs, { type TabId } from "@/components/stocks/watchlist-group-tabs";
import GroupSelectPopup from "@/components/stocks/group-select-popup";

interface Props {
  initialStocks: StockCache[];
  favorites: StockCache[];
  watchlistSymbols?: string[];
  lastPriceUpdate?: string | null;
  groups: WatchlistGroup[];               // watchlist_groups 목록
  symbolGroups: Record<string, string[]>; // symbol → group_id[]
  hasFavorites: boolean;                  // 즐겨찾기 존재 여부 (진입 탭 결정용)
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
  candidates.sort((a, b) => a.gap - b.gap);
  return candidates[0];
}

const SORT_MAP: Record<string, string> = {
  name: "name",
  change: "price_change_pct",
  volume: "volume",
  per: "per",
  gap: "name",
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

export default function StockListClient({ initialStocks, favorites, watchlistSymbols = [], lastPriceUpdate, groups: initialGroups, symbolGroups: initialSymbolGroups }: Props) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [stocks, setStocks] = useState<StockCache[]>(initialStocks);
  const [query, setQuery] = useState(searchParams.get("q") || "");
  const [market, setMarket] = useState(searchParams.get("market") || "전체");
  const [sortBy, setSortBy] = useState(searchParams.get("sort") || "name");
  const [favSet, setFavSet] = useState<Set<string>>(
    () => new Set(favorites.map((f) => f.symbol))
  );
  const [favStocks, setFavStocks] = useState<StockCache[]>(favorites);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [portSet] = useState<Set<string>>(() => new Set(watchlistSymbols));
  const [gapSource, setGapSource] = useState<SourceKey | "all">("all");

  // 그룹 관련 상태
  const [groups, setGroups] = useState<WatchlistGroup[]>(initialGroups);
  const [symGroups, setSymGroups] = useState<Record<string, string[]>>(initialSymbolGroups);
  const [activeTab, setActiveTab] = useState<TabId>("all");

  // GroupSelectPopup 상태
  const [groupPopup, setGroupPopup] = useState<{
    stock: StockCache;
    position: { x: number; y: number };
  } | null>(null);

  const [actionMenu, setActionMenu] = useState<{
    stock: StockCache;
    position: { x: number; y: number };
  } | null>(null);

  // URL searchParams 동기화
  useEffect(() => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (market !== "전체") params.set("market", market);
    if (sortBy !== "name") params.set("sort", sortBy);
    const qs = params.toString();
    const newUrl = qs ? `/stocks?${qs}` : "/stocks";
    router.replace(newUrl, { scroll: false });
  }, [query, market, sortBy, router]);

  const fetchStocks = useCallback(
    async (pageNum: number, reset: boolean = false) => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        params.set("page", String(pageNum));
        params.set("limit", "50");
        params.set("withSignals", "true");

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
      } catch (e) {
        console.error("[StockList] 종목 로딩 실패:", e);
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

  // 1단계: 즐겨찾기/일반 종목 병합 (정렬과 무관)
  const mergedStocks = useMemo(() => {
    const favSymbols = new Set(favStocks.map((f) => f.symbol));
    const updatedFavs = favStocks.map((fav) => {
      const updated = stocks.find((s) => s.symbol === fav.symbol);
      return updated ?? fav;
    });
    const nonFavs = stocks.filter((s) => !favSymbols.has(s.symbol));
    return { favs: updatedFavs, nonFavs };
  }, [stocks, favStocks]);

  // 2단계: 정렬 + gap 사전 계산
  const displayStocks = useMemo(() => {
    const favs = [...mergedStocks.favs];
    const nonFavs = [...mergedStocks.nonFavs];

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
      favs.sort(sortByGap);
      nonFavs.sort(sortByGap);
    }

    return { favs, nonFavs };
  }, [mergedStocks, sortBy, gapSource]);

  // 현재 탭에 표시할 관심종목 (query 없을 때)
  const tabFavorites = useMemo(() => {
    if (activeTab === "all") {
      // [전체] = 모든 관심종목 dedup
      const seen = new Set<string>();
      return favStocks.filter((s) => {
        if (seen.has(s.symbol)) return false;
        seen.add(s.symbol);
        return true;
      });
    }
    // 특정 그룹 = 해당 그룹에 속한 관심종목만
    return favStocks.filter((s) => (symGroups[s.symbol] ?? []).includes(activeTab));
  }, [activeTab, favStocks, symGroups]);

  // query가 있으면 전체 DB 검색 모드, 없으면 탭 관심종목 모드
  const showSearchMode = query.trim().length > 0;

  // 관심종목 없고 query 없으면 전체DB 뷰
  const showAllStocksMode = favSet.size === 0 && !showSearchMode;

  // ★ 버튼 클릭 핸들러
  const handleStarClick = useCallback(
    (stock: StockCache, e?: React.MouseEvent) => {
      const position = e?.currentTarget
        ? (() => {
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            return { x: rect.left, y: rect.bottom + 4 };
          })()
        : { x: Math.round(window.innerWidth / 2) - 80, y: Math.round(window.innerHeight / 2) };

      if (favSet.has(stock.symbol)) {
        // 즐겨찾기 해제 — 모든 그룹에서 제거
        const groupIds = symGroups[stock.symbol] ?? [];
        groupIds.forEach((gid) => {
          fetch(`/api/v1/watchlist-groups/${gid}/stocks/${stock.symbol}`, { method: "DELETE" });
        });
        const newSet = new Set(favSet);
        newSet.delete(stock.symbol);
        setFavSet(newSet);
        setFavStocks((prev) => prev.filter((s) => s.symbol !== stock.symbol));
        setSymGroups((prev) => { const next = { ...prev }; delete next[stock.symbol]; return next; });
        return;
      }

      // 그룹이 기본 1개만 → 기본 그룹 자동 추가
      const customGroups = groups.filter((g) => !g.is_default);
      if (customGroups.length === 0) {
        const defaultGroup = groups.find((g) => g.is_default);
        if (defaultGroup) {
          fetch(`/api/v1/watchlist-groups/${defaultGroup.id}/stocks`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ symbol: stock.symbol, name: stock.name }),
          });
          const newSet = new Set(favSet);
          newSet.add(stock.symbol);
          setFavSet(newSet);
          setFavStocks((prev) => [...prev, stock]);
          setSymGroups((prev) => ({
            ...prev,
            [stock.symbol]: [defaultGroup.id],
          }));
        }
        return;
      }

      // 다중 그룹 → 팝업 표시
      setGroupPopup({ stock, position });
    },
    [favSet, symGroups, groups]
  );

  // GroupSelectPopup 토글 핸들러
  const handleGroupToggle = useCallback(
    async (group: WatchlistGroup, stockOverride?: StockCache) => {
      const stock = stockOverride ?? groupPopup?.stock;
      if (!stock) return;
      const currentGroups = symGroups[stock.symbol] ?? [];
      const inGroup = currentGroups.includes(group.id);

      if (inGroup) {
        await fetch(`/api/v1/watchlist-groups/${group.id}/stocks/${stock.symbol}`, { method: "DELETE" });
        const newGroups = currentGroups.filter((id) => id !== group.id);
        setSymGroups((prev) => ({ ...prev, [stock.symbol]: newGroups }));
        if (newGroups.length === 0) {
          const newSet = new Set(favSet);
          newSet.delete(stock.symbol);
          setFavSet(newSet);
          setFavStocks((prev) => prev.filter((s) => s.symbol !== stock.symbol));
        }
      } else {
        await fetch(`/api/v1/watchlist-groups/${group.id}/stocks`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol: stock.symbol, name: stock.name }),
        });
        setSymGroups((prev) => ({ ...prev, [stock.symbol]: [...currentGroups, group.id] }));
        if (!favSet.has(stock.symbol)) {
          const newSet = new Set(favSet);
          newSet.add(stock.symbol);
          setFavSet(newSet);
          setFavStocks((prev) => [...prev, stock]);
        }
      }
    },
    [groupPopup, symGroups, favSet]
  );

  const handleGroupAdd = useCallback(async (name: string) => {
    const res = await fetch("/api/v1/watchlist-groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      const json = await res.json();
      throw new Error(json.error ?? "그룹 생성 실패");
    }
    const { group } = await res.json();
    setGroups((prev) => [...prev, group]);
  }, []);

  const handleGroupDelete = useCallback(async (group: WatchlistGroup) => {
    if (!confirm(`"${group.name}" 그룹을 삭제할까요?\n그룹 내 종목이 다른 그룹에 없으면 즐겨찾기에서도 해제됩니다.`)) return;
    const res = await fetch(`/api/v1/watchlist-groups/${group.id}`, { method: "DELETE" });
    if (!res.ok) return;
    setGroups((prev) => prev.filter((g) => g.id !== group.id));
    const removedSymbols: string[] = [];
    const nextSymGroups = { ...symGroups };
    for (const sym of Object.keys(nextSymGroups)) {
      nextSymGroups[sym] = nextSymGroups[sym].filter((id) => id !== group.id);
      if (nextSymGroups[sym].length === 0) {
        delete nextSymGroups[sym];
        removedSymbols.push(sym);
      }
    }
    setSymGroups(nextSymGroups);
    if (removedSymbols.length > 0) {
      setFavSet((fSet) => { const n = new Set(fSet); removedSymbols.forEach((s) => n.delete(s)); return n; });
      setFavStocks((fs) => fs.filter((s) => !removedSymbols.includes(s.symbol)));
    }
    if (activeTab === group.id) setActiveTab("all");
  }, [activeTab, symGroups]);

  const reorderDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleGroupsReorder = useCallback((ids: string[]) => {
    setGroups((prev) => {
      const defaultGrp = prev.find((g) => g.is_default);
      const custom = ids.map((id) => prev.find((g) => g.id === id)!).filter(Boolean);
      return defaultGrp ? [defaultGrp, ...custom] : custom;
    });
    if (reorderDebounceRef.current) clearTimeout(reorderDebounceRef.current);
    reorderDebounceRef.current = setTimeout(() => {
      fetch("/api/v1/watchlist-groups/reorder", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
    }, 500);
  }, []);

  const handleRowClick = useCallback((e: React.MouseEvent, stock: StockCache) => {
    if ((e.target as HTMLElement).closest("button")) return;
    setActionMenu({
      stock,
      position: { x: Math.min(e.clientX, window.innerWidth - 220), y: Math.min(e.clientY, window.innerHeight - 250) },
    });
  }, []);

  // 가격 업데이트 상태 + 갱신
  const [updateTime, setUpdateTime] = useState(lastPriceUpdate);
  const [refreshing, setRefreshing] = useState(false);

  const isStale = useMemo(() => {
    if (!updateTime) return true;
    const diffMin = (Date.now() - new Date(updateTime).getTime()) / 60000;
    return diffMin >= 5;
  }, [updateTime]);

  const priceUpdateLabel = useMemo(() => {
    if (!updateTime) return null;
    const d = new Date(updateTime);
    const now = new Date();
    const diffMin = Math.floor((now.getTime() - d.getTime()) / 60000);
    if (diffMin < 1) return "방금 업데이트";
    if (diffMin < 60) return `${diffMin}분 전 업데이트`;
    return `${d.toLocaleDateString("ko-KR")} ${d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })} 업데이트`;
  }, [updateTime]);

  const stocksRef = useRef(stocks);
  stocksRef.current = stocks;

  const refreshPrices = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await fetch("/api/v1/prices", { method: "POST" });
      const symbols = stocksRef.current.map((s) => s.symbol);
      const CHUNK = 200;
      const allPrices: Record<string, { current_price: number; price_change: number; price_change_pct: number; volume: number; market_cap: number }> = {};

      await Promise.all(
        Array.from({ length: Math.ceil(symbols.length / CHUNK) }, (_, i) => {
          const chunk = symbols.slice(i * CHUNK, (i + 1) * CHUNK);
          return fetch(`/api/v1/prices?symbols=${chunk.join(",")}&live=true`)
            .then((r) => r.json())
            .then(({ data }) => { if (data) Object.assign(allPrices, data); });
        })
      );

      setStocks((prev) =>
        prev.map((stock) => {
          const live = allPrices[stock.symbol];
          if (!live) return stock;
          return {
            ...stock,
            current_price: live.current_price ?? stock.current_price,
            price_change: live.price_change ?? stock.price_change,
            price_change_pct: live.price_change_pct ?? stock.price_change_pct,
            volume: live.volume ?? stock.volume,
            market_cap: live.market_cap ?? stock.market_cap,
          };
        })
      );
      setUpdateTime(new Date().toISOString());
    } finally {
      setRefreshing(false);
    }
  }, [refreshing]);

  useEffect(() => {
    if (isStale) {
      refreshPrices();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 테이블 헤더 JSX (재사용)
  const tableHeader = (
    <thead>
      <tr className="border-b border-[var(--border)] text-[var(--muted)] text-xs">
        <th className="px-3 py-3 text-left w-10"></th>
        <th className="px-3 py-3 text-left">종목명</th>
        <th className="px-3 py-3 text-left">코드</th>
        <th className="px-3 py-3 text-right">현재가</th>
        <th className="px-3 py-3 text-right">등락률</th>
        <th className="px-3 py-3 text-right">거래량</th>
        <th className="px-3 py-3 text-right">PER</th>
        <th className="px-2 py-3 text-center">퀀트</th>
        <th className="px-2 py-3 text-center">라씨</th>
        <th className="px-2 py-3 text-center">스톡봇</th>
        <th className="px-3 py-3 text-right">Gap</th>
      </tr>
    </thead>
  );

  return (
    <div className="space-y-4">
      {/* 가격 업데이트 상태 + 갱신 버튼 */}
      <div className="flex items-center justify-end gap-2">
        {priceUpdateLabel && (
          <span className={`text-xs ${isStale ? "text-yellow-400" : "text-[var(--muted)]"}`}>
            {priceUpdateLabel}
          </span>
        )}
        <button
          onClick={refreshPrices}
          disabled={refreshing}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-[var(--card)] border border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)] transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3 h-3 ${refreshing ? "animate-spin" : ""}`} />
          갱신
        </button>
      </div>

      {/* 그룹 탭 바 */}
      <WatchlistGroupTabs
        groups={groups}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onGroupAdd={handleGroupAdd}
        onGroupDelete={handleGroupDelete}
        onGroupsReorder={handleGroupsReorder}
      />

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
        </div>
      </div>

      {/* 종목 리스트 */}
      {showSearchMode || showAllStocksMode ? (
        /* 검색/전체DB 뷰: 기존 무한스크롤 테이블 */
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              {tableHeader}
              <tbody className="divide-y divide-[var(--border)]">
                {displayStocks.favs.length > 0 && (
                  <>
                    {displayStocks.favs.map((stock) => (
                      <StockRow
                        key={stock.symbol}
                        stock={stock}
                        isFav={true}
                        gapSource={gapSource}
                        isInPortfolio={portSet.has(stock.symbol)}
                        onToggleFavorite={(s) => handleStarClick(s)}
                        onRowClick={handleRowClick}
                      />
                    ))}
                    <tr>
                      <td colSpan={11} className="px-0 py-0">
                        <div className="border-b-2 border-yellow-600/30" />
                      </td>
                    </tr>
                  </>
                )}
                {displayStocks.nonFavs.length === 0 && displayStocks.favs.length === 0 && !loading ? (
                  <tr>
                    <td colSpan={11} className="px-4 py-12 text-center text-[var(--muted)]">
                      검색 결과가 없습니다
                    </td>
                  </tr>
                ) : (
                  displayStocks.nonFavs.map((stock) => (
                    <StockRow
                      key={stock.symbol}
                      stock={stock}
                      isFav={false}
                      gapSource={gapSource}
                      isInPortfolio={portSet.has(stock.symbol)}
                      onToggleFavorite={(s) => handleStarClick(s)}
                      onRowClick={handleRowClick}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
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
      ) : (
        /* 탭 관심종목 뷰 */
        tabFavorites.length === 0 ? (
          <div className="text-center py-16 text-[var(--muted)] text-sm">
            이 그룹에 관심종목이 없습니다. ★를 클릭해 추가하세요.
          </div>
        ) : (
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                {tableHeader}
                <tbody className="divide-y divide-[var(--border)]">
                  {tabFavorites.map((stock) => (
                    <StockRow
                      key={stock.symbol}
                      stock={stock}
                      isFav={true}
                      gapSource={gapSource}
                      isInPortfolio={portSet.has(stock.symbol)}
                      onToggleFavorite={(s) => handleStarClick(s)}
                      onRowClick={handleRowClick}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}

      {/* GroupSelectPopup */}
      {groupPopup && (
        <GroupSelectPopup
          groups={groups}
          selectedGroupIds={new Set(symGroups[groupPopup.stock.symbol] ?? [])}
          onToggle={handleGroupToggle}
          onClose={() => setGroupPopup(null)}
          position={groupPopup.position}
        />
      )}

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
          onToggleFavorite={() => actionMenu && handleStarClick(actionMenu.stock)}
        />
      )}
    </div>
  );
}

/** 메모이제이션된 테이블 행 컴포넌트 */
interface StockRowProps {
  stock: StockCache;
  isFav: boolean;
  gapSource: SourceKey | "all";
  isInPortfolio: boolean;
  onToggleFavorite: (stock: StockCache) => void;
  onRowClick: (e: React.MouseEvent, stock: StockCache) => void;
}

const StockRow = memo(function StockRow({ stock, isFav, gapSource, isInPortfolio, onToggleFavorite, onRowClick }: StockRowProps) {
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
      onClick={(e) => onRowClick(e, stock)}
      className={`hover:bg-[var(--card-hover)] transition-colors cursor-pointer ${
        isFav ? "bg-yellow-900/5" : ""
      }`}
    >
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-0.5">
          <button
            onClick={(e) => { e.stopPropagation(); onToggleFavorite(stock); }}
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
          {isInPortfolio && (
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
      <td className={`px-3 py-2.5 text-right font-medium tabular-nums ${priceColor(stock.price_change)}`}>
        {formatNumber(stock.current_price)}
      </td>
      <td className={`px-3 py-2.5 text-right font-medium tabular-nums ${priceColor(stock.price_change_pct)}`}>
        {formatPercent(stock.price_change_pct)}
      </td>
      <td className="px-3 py-2.5 text-right text-[var(--muted)] tabular-nums">
        {formatNumber(stock.volume)}
      </td>
      <td className="px-3 py-2.5 text-right text-[var(--muted)] tabular-nums">
        {stock.per != null ? stock.per.toFixed(1) : "-"}
      </td>
      <td className="px-2 py-2.5 text-center">
        <SignalBadge sig={signals.quant} source="quant" />
      </td>
      <td className="px-2 py-2.5 text-center">
        <SignalBadge sig={signals.lassi} source="lassi" />
      </td>
      <td className="px-2 py-2.5 text-center">
        <SignalBadge sig={signals.stockbot} source="stockbot" />
      </td>
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
});
