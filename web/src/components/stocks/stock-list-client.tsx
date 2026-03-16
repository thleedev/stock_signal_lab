"use client";

import React, { useState, useCallback, useRef, useEffect, useMemo, memo } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { Star, Search, ArrowUpDown, Loader2, Briefcase, RefreshCw, Pin, PinOff, GripVertical } from "lucide-react";
import type { StockCache, SourceSignal } from "@/types/stock";
import type { WatchlistGroup } from "@/types/stock";
import { SOURCE_LABELS_SHORT, SIGNAL_COLORS, SIGNAL_TYPE_LABELS } from "@/lib/signal-constants";
import StockActionMenu from "@/components/common/stock-action-menu";
import WatchlistGroupTabs, { type TabId } from "@/components/stocks/watchlist-group-tabs";
import GroupSelectPopup from "@/components/stocks/group-select-popup";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import GroupDropZone from "@/components/stocks/group-drop-zone";

interface Props {
  initialStocks: StockCache[];
  favorites: StockCache[];
  watchlistSymbols?: string[];
  lastPriceUpdate?: string | null;
  groups: WatchlistGroup[];               // watchlist_groups 목록
  symbolGroups: Record<string, string[]>; // symbol → group_id[]
  hasFavorites: boolean;                  // 즐겨찾기 존재 여부 (진입 탭 결정용)
}


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
        title={`${SOURCE_LABELS_SHORT[source]} ${sig.type}`}
      >
        {SIGNAL_TYPE_LABELS[sig.type] ?? sig.type}
      </span>
      {sig.price != null && sig.price > 0 && (
        <span className="text-[10px] text-[var(--muted)] tabular-nums">
          {formatNumber(sig.price)}
        </span>
      )}
    </div>
  );
}

type LivePriceMap = Record<string, { current_price: number; price_change: number; price_change_pct: number; volume: number; market_cap: number }>;

function applyLivePrices(list: StockCache[], prices: LivePriceMap): StockCache[] {
  return list.map((stock) => {
    const live = prices[stock.symbol];
    if (!live) return stock;
    return {
      ...stock,
      current_price: live.current_price ?? stock.current_price,
      price_change: live.price_change ?? stock.price_change,
      price_change_pct: live.price_change_pct ?? stock.price_change_pct,
      volume: live.volume ?? stock.volume,
      market_cap: live.market_cap ?? stock.market_cap,
    };
  });
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

  const [pinFavorites, setPinFavorites] = useState<boolean>(
    () =>
      typeof window !== "undefined"
        ? localStorage.getItem("pinFavorites") !== "false"
        : true
  );

  const handlePinToggle = useCallback(() => {
    setPinFavorites((prev) => {
      const next = !prev;
      localStorage.setItem("pinFavorites", String(next));
      return next;
    });
  }, []);

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
          setStocks(applyLivePrices(newData, livePricesRef.current));
        } else {
          setStocks((prev) => {
            const existingSymbols = new Set(prev.map((s) => s.symbol));
            const dedupedNew = newData.filter((s) => !existingSymbols.has(s.symbol));
            return [...prev, ...applyLivePrices(dedupedNew, livePricesRef.current)];
          });
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

  // query가 있으면 전체 DB 검색 모드, 없으면 탭 관심종목 모드
  const showSearchMode = query.trim().length > 0;

  // 성능 최적화: stocks를 Map으로 변환하여 O(1) 조회
  const stocksMap = useMemo(() => new Map(stocks.map((s) => [s.symbol, s])), [stocks]);

  // 1단계: 즐겨찾기/일반 종목 병합 (탭 + 검색어 필터링)
  const mergedStocks = useMemo(() => {
    const q = query.trim().toLowerCase();

    // 현재 탭 기준 즐겨찾기 선택
    const baseFavs =
      activeTab === "all"
        ? favStocks // 전체탭: 모든 즐겨찾기
        : favStocks.filter((s) => (symGroups[s.symbol] ?? []).includes(activeTab)); // 그룹탭

    // 검색어가 있으면 이름/심볼로 즐겨찾기 필터링
    const filteredFavs =
      showSearchMode && q
        ? baseFavs.filter(
            (s) =>
              s.name.toLowerCase().includes(q) ||
              s.symbol.toLowerCase().includes(q)
          )
        : baseFavs;

    // 최신 가격 데이터로 즐겨찾기 업데이트 (Map으로 O(n) 조회)
    const updatedFavs = filteredFavs.map((fav) => stocksMap.get(fav.symbol) ?? fav);
    const favSymbols = new Set(filteredFavs.map((f) => f.symbol));
    const nonFavs = stocks.filter((s) => !favSymbols.has(s.symbol));

    return { favs: updatedFavs, nonFavs };
  }, [stocks, stocksMap, favStocks, query, showSearchMode, activeTab, symGroups]);

  // 2단계: 정렬 + pinFavorites 적용
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

    // pinFavorites=false이고 전체탭(DB 뷰)일 때: favs/nonFavs 혼합
    if (!pinFavorites && activeTab === "all") {
      const combined = [...favs, ...nonFavs];
      return { favs: [], nonFavs: combined };
    }

    return { favs, nonFavs };
  }, [mergedStocks, sortBy, gapSource, pinFavorites, activeTab]);

  // 전체탭은 항상 전체DB 뷰, 또는 관심종목 없고 query 없을 때
  const showAllStocksMode = activeTab === "all" || (favSet.size === 0 && !showSearchMode);

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

  // GroupSelectPopup 토글 핸들러 (낙관적 업데이트)
  const handleGroupToggle = useCallback(
    async (group: WatchlistGroup, stockOverride?: StockCache) => {
      const stock = stockOverride ?? groupPopup?.stock;
      if (!stock) return;

      // 롤백용 스냅샷
      const prevSymGroups = symGroups;
      const prevFavSet = new Set(favSet);
      const prevFavStocks = [...favStocks];

      const currentGroups = symGroups[stock.symbol] ?? [];
      const inGroup = currentGroups.includes(group.id);

      // 낙관적 업데이트 먼저 (API 호출 전에 UI 즉시 반영)
      if (inGroup) {
        const newGroups = currentGroups.filter((id) => id !== group.id);
        setSymGroups((prev) => ({ ...prev, [stock.symbol]: newGroups }));
        if (newGroups.length === 0) {
          setFavSet((prev) => { const n = new Set(prev); n.delete(stock.symbol); return n; });
          setFavStocks((prev) => prev.filter((s) => s.symbol !== stock.symbol));
        }
      } else {
        setSymGroups((prev) => ({ ...prev, [stock.symbol]: [...currentGroups, group.id] }));
        if (!favSet.has(stock.symbol)) {
          setFavSet((prev) => new Set([...prev, stock.symbol]));
          setFavStocks((prev) => [...prev, stock]);
        }
      }

      // API 호출 (실패 시 롤백)
      try {
        if (inGroup) {
          const res = await fetch(
            `/api/v1/watchlist-groups/${group.id}/stocks/${stock.symbol}`,
            { method: "DELETE" }
          );
          if (!res.ok) throw new Error("DELETE 실패");
        } else {
          const res = await fetch(`/api/v1/watchlist-groups/${group.id}/stocks`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ symbol: stock.symbol, name: stock.name }),
          });
          // 409(이미 존재)는 무시
          if (!res.ok && res.status !== 409) throw new Error("POST 실패");
        }
      } catch (e) {
        console.error("[handleGroupToggle] API 실패, 롤백:", e);
        setSymGroups(prevSymGroups);
        setFavSet(prevFavSet);
        setFavStocks(prevFavStocks);
      }
    },
    [groupPopup, symGroups, favSet, favStocks]
  );

  const [draggingStock, setDraggingStock] = useState<StockCache | null>(null);

  const stockSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const handleStockDragStart = useCallback((event: DragStartEvent) => {
    const stock = [...favStocks, ...stocks].find((s) => s.symbol === event.active.id);
    if (stock) setDraggingStock(stock);
  }, [favStocks, stocks]);

  const handleStockDragEnd = useCallback((event: DragEndEvent) => {
    const { over } = event;
    setDraggingStock(null);
    if (!over || !draggingStock) return;
    const targetGroup = groups.find((g) => g.id === over.id);
    if (!targetGroup) return;
    handleGroupToggle(targetGroup, draggingStock);
  }, [draggingStock, groups, handleGroupToggle]);

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

  const handleGroupRename = useCallback(async (group: WatchlistGroup, newName: string) => {
    const res = await fetch(`/api/v1/watchlist-groups/${group.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName }),
    });
    if (!res.ok) {
      const json = await res.json();
      throw new Error(json.error ?? "그룹명 변경 실패");
    }
    setGroups((prev) =>
      prev.map((g) => (g.id === group.id ? { ...g, name: newName } : g))
    );
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
  const favStocksRef = useRef(favStocks);
  favStocksRef.current = favStocks;
  // 최근 fetch된 live price 캐시 (새 페이지 로드 시 적용)
  const livePricesRef = useRef<Record<string, { current_price: number; price_change: number; price_change_pct: number; volume: number; market_cap: number }>>({});

  const refreshPrices = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await fetch("/api/v1/prices", { method: "POST" });

      // stocks + favStocks 전체 심볼 수집
      const allSymbols = [
        ...stocksRef.current.map((s) => s.symbol),
        ...favStocksRef.current.map((s) => s.symbol),
      ];
      const uniqueSymbols = [...new Set(allSymbols)];
      const CHUNK = 200;
      const allPrices: typeof livePricesRef.current = {};

      await Promise.all(
        Array.from({ length: Math.ceil(uniqueSymbols.length / CHUNK) }, (_, i) => {
          const chunk = uniqueSymbols.slice(i * CHUNK, (i + 1) * CHUNK);
          return fetch(`/api/v1/prices?symbols=${chunk.join(",")}&live=true`)
            .then((r) => r.json())
            .then(({ data }) => { if (data) Object.assign(allPrices, data); });
        })
      );

      livePricesRef.current = { ...livePricesRef.current, ...allPrices };
      setStocks((prev) => applyLivePrices(prev, allPrices));
      setFavStocks((prev) => applyLivePrices(prev, allPrices));
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
        <th className="hidden md:table-cell px-3 py-3 text-left">코드</th>
        <th className="px-3 py-3 text-right">현재가</th>
        <th className="px-3 py-3 text-right">등락률</th>
        <th className="hidden md:table-cell px-3 py-3 text-right">거래량</th>
        <th className="hidden md:table-cell px-3 py-3 text-right">PER</th>
        <th className="hidden lg:table-cell px-2 py-3 text-center">퀀트</th>
        <th className="hidden lg:table-cell px-2 py-3 text-center">라씨</th>
        <th className="hidden lg:table-cell px-2 py-3 text-center">스톡봇</th>
        <th className="hidden lg:table-cell px-3 py-3 text-right">Gap</th>
      </tr>
    </thead>
  );

  return (
    <DndContext
      id="stock-dnd"
      sensors={stockSensors}
      onDragStart={handleStockDragStart}
      onDragEnd={handleStockDragEnd}
    >
    <div className="space-y-4">
      {/* 페이지 헤더 — 제목 왼쪽, 갱신 버튼 오른쪽 */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">종목</h1>
          <p className="text-sm text-[var(--muted)] mt-1">관심종목 그룹 관리 및 전체 종목 조회</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 pt-1">
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
      </div>

      {/* 그룹 탭 바 */}
      <WatchlistGroupTabs
        groups={groups}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onGroupAdd={handleGroupAdd}
        onGroupDelete={handleGroupDelete}
        onGroupsReorder={handleGroupsReorder}
        onGroupRename={handleGroupRename}
        pinFavorites={pinFavorites}
        onPinToggle={handlePinToggle}
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
        mergedStocks.favs.length === 0 ? (
          <div className="text-center py-16 text-[var(--muted)] text-sm">
            {showSearchMode
              ? "검색 결과가 없습니다"
              : "이 그룹에 관심종목이 없습니다. ★를 클릭해 추가하세요."}
          </div>
        ) : (
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                {tableHeader}
                <tbody className="divide-y divide-[var(--border)]">
                  {mergedStocks.favs.map((stock) => (
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
          groups={groups}
          symbolGroupIds={symGroups[actionMenu.stock.symbol] ?? []}
          onGroupToggle={(group) => { if (actionMenu) handleGroupToggle(group, actionMenu.stock); }}
        />
      )}
    </div>

    {/* DragOverlay — must be inside DndContext */}
    <DragOverlay>
      {draggingStock && (
        <div className="bg-[var(--card)] border border-[#6366f1] rounded-lg px-4 py-2.5 shadow-2xl text-sm font-medium">
          {draggingStock.name}
          <span className="ml-2 text-xs text-[var(--muted)]">{draggingStock.symbol}</span>
        </div>
      )}
    </DragOverlay>

    {/* GroupDropZone — 드래그 중일 때만 렌더 */}
    {draggingStock && (
      <GroupDropZone
        groups={groups}
        draggingSymbol={draggingStock.symbol}
        symGroups={symGroups}
      />
    )}
    </DndContext>
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
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: stock.symbol });
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
      ref={setNodeRef}
      onClick={(e) => onRowClick(e, stock)}
      className={`hover:bg-[var(--card-hover)] transition-colors cursor-pointer ${
        isFav ? "bg-yellow-900/5" : ""
      } ${isDragging ? "opacity-30" : ""}`}
    >
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-0.5">
          {/* Drag handle */}
          <span
            {...attributes}
            {...listeners}
            className="cursor-grab active:cursor-grabbing p-0.5 text-[var(--border)] hover:text-[var(--muted)] touch-none"
            onClick={(e) => e.stopPropagation()}
          >
            <GripVertical className="w-3.5 h-3.5" />
          </span>
          {/* 즐겨찾기 버튼 */}
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
      <td className="px-3 py-2.5 max-w-[8rem] sm:max-w-[12rem] md:max-w-none">
        <span className="font-medium block truncate">{stock.name}</span>
      </td>
      <td className="hidden md:table-cell px-3 py-2.5 text-[var(--muted)] text-xs">
        {stock.symbol}
      </td>
      <td className={`px-3 py-2.5 text-right font-medium tabular-nums ${priceColor(stock.price_change)}`}>
        {formatNumber(stock.current_price)}
      </td>
      <td className={`px-3 py-2.5 text-right font-medium tabular-nums ${priceColor(stock.price_change_pct)}`}>
        {formatPercent(stock.price_change_pct)}
      </td>
      <td className="hidden md:table-cell px-3 py-2.5 text-right text-[var(--muted)] tabular-nums">
        {formatNumber(stock.volume)}
      </td>
      <td className="hidden md:table-cell px-3 py-2.5 text-right text-[var(--muted)] tabular-nums">
        {stock.per != null ? stock.per.toFixed(1) : "-"}
      </td>
      <td className="hidden lg:table-cell px-2 py-2.5 text-center">
        <SignalBadge sig={signals.quant} source="quant" />
      </td>
      <td className="hidden lg:table-cell px-2 py-2.5 text-center">
        <SignalBadge sig={signals.lassi} source="lassi" />
      </td>
      <td className="hidden lg:table-cell px-2 py-2.5 text-center">
        <SignalBadge sig={signals.stockbot} source="stockbot" />
      </td>
      <td className="hidden lg:table-cell px-3 py-2.5 text-right tabular-nums">
        {gap != null ? (
          <div className="flex flex-col items-end gap-0.5">
            <span className={`text-xs font-medium ${gap >= 0 ? "text-red-400" : "text-blue-400"}`}>
              {gap >= 0 ? "+" : ""}{gap.toFixed(1)}%
            </span>
            {gapSrc && (
              <span className="text-[9px] text-[var(--muted)]">
                {SOURCE_LABELS_SHORT[gapSrc] ?? gapSrc}
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
