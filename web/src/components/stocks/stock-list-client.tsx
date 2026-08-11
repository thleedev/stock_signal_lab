"use client";

import React, { useState, useCallback, useRef, useEffect, useMemo, memo } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { Star, Search, ArrowUpDown, ArrowUp, ArrowDown, Loader2, Briefcase, Pin, PinOff, GripVertical } from "lucide-react";
import { useGlobalPriceRefresh, type LivePriceMap } from "@/hooks/use-global-price-refresh";
import { useBatchRefresh } from "@/hooks/use-batch-refresh";
import { PriceUpdateBadge } from "@/components/common/price-update-badge";
import type { StockCache, SourceSignal } from "@/types/stock";
import type { WatchlistGroup } from "@/types/stock";
import { PageLayout, PageHeader, StackedList } from "@/components/ui";
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

const BUY_TYPES = new Set(["BUY", "BUY_FORECAST"]);

function hasBuySignal(stock: StockCache): boolean {
  if (!stock.signals) return false;
  const s = stock.signals;
  return BUY_TYPES.has(s.quant?.type ?? "") || BUY_TYPES.has(s.lassi?.type ?? "") || BUY_TYPES.has(s.stockbot?.type ?? "");
}

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
  market_cap: "market_cap",
  change: "price_change_pct",
  high90d: "high90d",
  change_1m: "change_1m",
  volume: "volume",
  per: "per",
  gap: "gap",
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


// 네이버 실시간 시세는 종목이 아직 체결 전이거나 데이터 결측일 때 volume·market_cap 을
// 0으로 반환하는 경우가 있어, 0은 신뢰하지 않고 기존 DB 값을 유지합니다.
// current_price·price_change·price_change_pct 는 0(보합)도 유효한 값이라 그대로 반영합니다.
function applyLivePrices(list: StockCache[], prices: LivePriceMap): StockCache[] {
  return list.map((stock) => {
    const live = prices[stock.symbol];
    if (!live) return stock;
    return {
      ...stock,
      current_price: live.current_price ?? stock.current_price,
      price_change: live.price_change ?? stock.price_change,
      price_change_pct: live.price_change_pct ?? stock.price_change_pct,
      volume: live.volume > 0 ? live.volume : stock.volume,
      market_cap: live.market_cap || stock.market_cap,
    };
  });
}

export default function StockListClient({ initialStocks, favorites, watchlistSymbols = [], lastPriceUpdate, groups: initialGroups, symbolGroups: initialSymbolGroups }: Props) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [query, setQuery] = useState(searchParams.get("q") || "");
  const [market, setMarket] = useState(searchParams.get("market") || "전체");
  const [sortBy, setSortBy] = useState(searchParams.get("sort") || "gap");
  const [sortDir, setSortDir] = useState<"asc" | "desc">(
    (searchParams.get("dir") as "asc" | "desc") || "asc"
  );
  const [signalFilter, setSignalFilter] = useState<"all" | "signal">(
    (searchParams.get("hasSignal") ? "signal" : searchParams.get("signal") as "all" | "signal") || "signal"
  );

  const initialMatchesServer = sortBy === "name" && sortDir === "asc" && market === "전체" && signalFilter === "all" && !query;
  const [stocks, setStocks] = useState<StockCache[]>(initialMatchesServer ? initialStocks : []);

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
  const [gapSource] = useState<SourceKey | "all">("all");

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

  const [pinFavorites, setPinFavorites] = useState<boolean>(true);
  const [pinMounted, setPinMounted] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("pinFavorites");
    if (stored === "false") setPinFavorites(false);
    setPinMounted(true);
  }, []);

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
    if (sortBy !== "gap") params.set("sort", sortBy);
    if (sortDir !== "asc") params.set("dir", sortDir);
    if (signalFilter !== "signal") params.set("signal", signalFilter);
    const qs = params.toString();
    const newUrl = qs ? `/stocks?${qs}` : "/stocks";
    router.replace(newUrl, { scroll: false });
  }, [query, market, sortBy, sortDir, signalFilter, router]);

  const fetchStocks = useCallback(
    async (pageNum: number, reset: boolean = false) => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        const isAllAtOnce = signalFilter === "signal" || sortBy === "gap";
        params.set("page", String(pageNum));
        params.set("limit", isAllAtOnce ? "1000" : "50");
        params.set("withSignals", "true");
        params.set("sortBy", SORT_MAP[sortBy] || "name");
        params.set("sortDir", sortDir);
        if (market !== "전체") params.set("market", market);
        if (query.trim()) params.set("q", query.trim());
        if (signalFilter === "signal") params.set("hasSignal", "true");

        const res = await fetch(`/api/v1/stocks?${params}`);
        if (!res.ok) return;
        const json = await res.json();
        const newData: StockCache[] = json.data ?? [];

        if (reset) {
          setStocks(applyLivePrices(newData, livePricesRef.current));
          setHasMore(pageNum < (json.totalPages ?? 1));
        } else {
          setStocks((prev) => {
            const existingSymbols = new Set(prev.map((s) => s.symbol));
            const dedupedNew = newData.filter((s) => !existingSymbols.has(s.symbol));
            return [...prev, ...applyLivePrices(dedupedNew, livePricesRef.current)];
          });
          setHasMore(pageNum < (json.totalPages ?? 1));
        }
      } catch (e) {
        console.error("[StockList] 종목 로딩 실패:", e);
      } finally {
        setLoading(false);
      }
    },
    [market, query, sortBy, sortDir, signalFilter]
  );

  // 검색어 변경 시 디바운스 리셋
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPage(1);
      fetchStocks(1, true);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  // 정렬/필터 변경 시 즉시 리셋 (디바운스 없이)
  const prevSortRef = useRef({ sortBy: "name", sortDir: "asc", market: "전체", signalFilter: "all" });
  useEffect(() => {
    const prev = prevSortRef.current;
    if (
      prev.sortBy === sortBy &&
      prev.sortDir === sortDir &&
      prev.market === market &&
      prev.signalFilter === signalFilter
    ) return;
    prevSortRef.current = { sortBy, sortDir, market, signalFilter };
    setStocks([]);
    setPage(1);
    setHasMore(true);
    fetchStocks(1, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortBy, sortDir, market, signalFilter]);

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

    // 신호 필터: 즐겨찾기도 클라이언트에서 필터 (API는 일반 종목만 필터)
    if (signalFilter === "signal") {
      return {
        favs: updatedFavs.filter(hasBuySignal),
        nonFavs,
      };
    }

    return { favs: updatedFavs, nonFavs };
  }, [stocks, stocksMap, favStocks, query, showSearchMode, activeTab, symGroups, signalFilter]);

  // 2단계: pinFavorites 적용 및 정렬
  // 가격 갱신 후에도 정렬 순서를 유지하기 위해 클라이언트에서 재정렬합니다.
  const sortFn = useCallback((a: StockCache, b: StockCache) => {
    let valA: string | number = 0;
    let valB: string | number = 0;
    switch (sortBy) {
      case "name":
        valA = a.name; valB = b.name; break;
      case "market_cap":
        valA = a.market_cap ?? 0; valB = b.market_cap ?? 0; break;
      case "change":
        valA = a.price_change_pct ?? 0; valB = b.price_change_pct ?? 0; break;
      case "high90d":
        valA = a.high_90d_pct ?? (sortDir === "asc" ? Infinity : -Infinity);
        valB = b.high_90d_pct ?? (sortDir === "asc" ? Infinity : -Infinity);
        break;
      case "volume":
        valA = a.volume ?? 0; valB = b.volume ?? 0; break;
      case "per":
        valA = a.per ?? 0; valB = b.per ?? 0; break;
      case "gap": {
        const gA = calcGap(a, gapSource);
        const gB = calcGap(b, gapSource);
        valA = gA?.gap ?? (sortDir === "asc" ? Infinity : -Infinity);
        valB = gB?.gap ?? (sortDir === "asc" ? Infinity : -Infinity);
        break;
      }
    }
    if (valA < valB) return sortDir === "asc" ? -1 : 1;
    if (valA > valB) return sortDir === "asc" ? 1 : -1;
    return 0;
  }, [sortBy, sortDir, gapSource]);

  const displayStocks = useMemo(() => {
    if (!pinMounted) {
      return { favs: [], nonFavs: stocks };
    }

    if (!pinFavorites) {
      // 즐겨찾기 고정 OFF: 전체 stocks를 클라이언트에서 재정렬
      const sorted = [...stocks].sort(sortFn);
      return { favs: [], nonFavs: sorted };
    }

    // 즐겨찾기 고정 ON: favs/nonFavs 각각 정렬
    const favs = [...mergedStocks.favs].sort(sortFn);
    const nonFavs = [...mergedStocks.nonFavs].sort(sortFn);

    return { favs, nonFavs };
  }, [stocks, mergedStocks, sortFn, pinFavorites, pinMounted]);

  // 모바일 카드(StackedList)용 목록 — 즐겨찾기 여부와 showHigh90d 를 함께 담아
  // 데스크톱 테이블의 같은 구간(favs/nonFavs)이 쓰는 조건을 그대로 따라갑니다.
  const combinedCardItems = useMemo<DisplayItem[]>(
    () => [
      ...displayStocks.favs.map((s) => ({ stock: s, isFav: true, showHigh90d: sortBy === "high90d" })),
      ...displayStocks.nonFavs.map((s) => ({
        stock: s,
        isFav: favSet.has(s.symbol),
        showHigh90d: sortBy === "high90d" || sortBy === "change_1m",
      })),
    ],
    [displayStocks, favSet, sortBy]
  );
  const favCardItems = useMemo<DisplayItem[]>(
    () =>
      mergedStocks.favs.map((s) => ({
        stock: s,
        isFav: true,
        showHigh90d: sortBy === "high90d" || sortBy === "change_1m",
      })),
    [mergedStocks, sortBy]
  );

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

  // 최근 fetch된 live price 캐시 (새 페이지 로드 시 적용)
  const livePricesRef = useRef<LivePriceMap>({});
  // 심볼별로 현재 캐시에 담긴 값이 "언제 기준"인지 기록합니다.
  const priceAsOfRef = useRef<Record<string, number>>({});

  /**
   * 가격을 병합합니다. 서로 다른 두 경로가 순서 보장 없이 같은 심볼을 덮어씁니다.
   * 하나는 마운트 직후 호출하는 네이버 실시간 시세(/api/v1/stocks/live-prices)이고
   * 다른 하나는 useGlobalPriceRefresh 의 stock_cache 전량 조회입니다. DB 응답이
   * 늦게 도착하면 방금 받은 실시간 시세가 캐시 값으로 되돌아가므로, 심볼별로
   * 더 최신 기준시각을 가진 값만 반영합니다. 네이버 시세는 응답 수신 시각을,
   * DB 값은 stock_cache 의 updated_at 을 기준시각으로 씁니다.
   */
  const applyPrices = useCallback((incoming: LivePriceMap, asOf: number) => {
    const accepted: LivePriceMap = {};
    for (const [symbol, price] of Object.entries(incoming)) {
      if ((priceAsOfRef.current[symbol] ?? 0) > asOf) continue;
      priceAsOfRef.current[symbol] = asOf;
      accepted[symbol] = price;
    }
    if (Object.keys(accepted).length === 0) return;
    livePricesRef.current = { ...livePricesRef.current, ...accepted };
    setStocks((prev) => applyLivePrices(prev, accepted));
    setFavStocks((prev) => applyLivePrices(prev, accepted));
  }, []);

  // 마운트 후 실시간 시세를 한 번 받아 livePricesRef 에 기록하고 DB 가격 위에 덮어씁니다.
  // 서버 렌더링에서 네이버 API 를 기다리지 않으므로 첫 페인트가 지연되지 않습니다.
  // applyPrices 를 그대로 재사용해 livePricesRef 캐시에 기록하므로, 이후
  // 정렬·필터 변경으로 fetchStocks 가 stocks 를 다시 채워도 이 캐시가 계속 적용됩니다.
  // 장중 여부는 이 라우트가 서버에서 다시 판정하므로(장외면 빈 prices 를 즉시 반환)
  // 클라이언트는 무조건 호출하고 응답만 신뢰합니다.
  useEffect(() => {
    let cancelled = false;

    fetch("/api/v1/stocks/live-prices")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (cancelled || !json?.marketOpen || !json?.prices) return;
        const prices = json.prices as LivePriceMap;
        if (Object.keys(prices).length === 0) return;
        applyPrices(prices, Date.now());
      })
      .catch((e) => console.error("[stocks] 실시간 시세 조회 실패:", e));

    return () => { cancelled = true; };
  }, [applyPrices]);

  const { refreshing, isStale, updateTime: priceUpdateTime, refresh: refreshPrices } =
    useGlobalPriceRefresh({
      onPricesRefreshed: applyPrices,
    });

  const { trigger: triggerRefresh, isRunning: batchRunning } = useBatchRefresh({
    onCompleted: refreshPrices,
  });


  // 테이블 헤더 JSX (재사용)
  const tableHeader = (
    <thead>
      <tr className="border-b border-[var(--border)] text-[var(--muted)] text-xs">
        <th className="px-2 py-3 text-left w-[52px]"></th>
        <th className="px-2 py-3 text-left">종목명</th>
        <th className="px-2 py-3 text-right w-[88px]">현재가</th>
        <th className="px-2 py-3 text-right w-[72px]">{sortBy === "high90d" || sortBy === "change_1m" ? "90일고점비" : "등락률"}</th>
        <th className="hidden sm:table-cell px-2 py-3 text-right w-[64px]">Gap</th>
        <th className="hidden md:table-cell px-2 py-3 text-left w-[72px]">코드</th>
        <th className="hidden md:table-cell px-2 py-3 text-right w-[88px]">거래량</th>
        <th className="hidden md:table-cell px-2 py-3 text-right w-[56px]">PER</th>
        <th className="hidden lg:table-cell px-1 py-3 text-center w-[60px]">알파캐치</th>
        <th className="hidden lg:table-cell px-1 py-3 text-center w-[60px]">라씨</th>
        <th className="hidden lg:table-cell px-1 py-3 text-center w-[68px]">스톡봇</th>
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
    <PageLayout>
      {/* 페이지 헤더 -- 제목 왼쪽, 갱신 버튼 오른쪽 */}
      <PageHeader
        title="종목"
        subtitle="관심종목 그룹 관리 및 전체 종목 조회"
        action={
          <PriceUpdateBadge
            priceUpdateLabel={priceUpdateTime}
            isStale={isStale}
            refreshing={refreshing}
            batchRunning={batchRunning}
            onRefresh={triggerRefresh}
          />
        }
      />

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

          <div className="flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--background)] px-1">
            <span className="text-[10px] text-[var(--muted)] font-medium px-1.5 shrink-0">시장</span>
            {["전체", "KOSPI", "KOSDAQ", "ETF"].map((m) => (
              <button
                key={m}
                onClick={() => setMarket(m)}
                className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  market === m
                    ? "bg-[var(--accent)] text-white"
                    : "text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--border)]"
                }`}
              >
                {m}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--background)] px-1">
            <span className="text-[10px] text-[var(--muted)] font-medium px-1.5 shrink-0">정렬</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="px-2 py-1.5 rounded-md text-xs font-medium bg-transparent text-[var(--foreground)] focus:outline-none appearance-none cursor-pointer"
            >
              <option value="name">이름</option>
              <option value="market_cap">시가총액</option>
              <option value="change">등락률</option>
              <option value="change_1m">1달등락</option>
              <option value="high90d">90일고점비</option>
              <option value="volume">거래량</option>
              <option value="per">PER</option>
              <option value="gap">Gap</option>
            </select>
            <button
              onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
              className="p-1.5 rounded-md text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--border)] transition-colors"
              title={sortDir === "asc" ? "오름차순" : "내림차순"}
            >
              {sortDir === "asc" ? <ArrowUp className="w-3.5 h-3.5" /> : <ArrowDown className="w-3.5 h-3.5" />}
            </button>
          </div>

          <div className="flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--background)] px-1">
            <span className="text-[10px] text-[var(--muted)] font-medium px-1.5 shrink-0">신호</span>
            {([["all", "전체"], ["signal", "신호"]] as const).map(([value, label]) => (
              <button
                key={value}
                onClick={() => setSignalFilter(value)}
                className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  signalFilter === value
                    ? "bg-[var(--accent)] text-white"
                    : "text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--border)]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 종목 리스트 */}
      {showSearchMode || showAllStocksMode ? (
        /* 검색/전체DB 뷰: 기존 무한스크롤 테이블 */
        <div className="card overflow-hidden">
          <StackedList
            items={combinedCardItems}
            keyOf={(item) => item.stock.symbol}
            breakpoint="lg"
            renderCard={(item) => (
              <StockCard
                stock={item.stock}
                isFav={item.isFav}
                gapSource={gapSource}
                isInPortfolio={portSet.has(item.stock.symbol)}
                showHigh90d={item.showHigh90d}
                onToggleFavorite={handleStarClick}
              />
            )}
            onItemClick={(item, e) => handleRowClick(e, item.stock)}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm table-fixed">
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
                          showHigh90d={sortBy === "high90d"}
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
                        isFav={favSet.has(stock.symbol)}
                        gapSource={gapSource}
                        isInPortfolio={portSet.has(stock.symbol)}
                        showHigh90d={sortBy === "high90d" || sortBy === "change_1m"}
                        onToggleFavorite={(s) => handleStarClick(s)}
                        onRowClick={handleRowClick}
                      />
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </StackedList>
          {combinedCardItems.length === 0 && !loading && (
            <div className="lg:hidden text-center py-12 text-[var(--muted)] text-sm">
              검색 결과가 없습니다
            </div>
          )}
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
            <StackedList
              items={favCardItems}
              keyOf={(item) => item.stock.symbol}
              breakpoint="lg"
              renderCard={(item) => (
                <StockCard
                  stock={item.stock}
                  isFav={item.isFav}
                  gapSource={gapSource}
                  isInPortfolio={portSet.has(item.stock.symbol)}
                  showHigh90d={item.showHigh90d}
                  onToggleFavorite={handleStarClick}
                />
              )}
              onItemClick={(item, e) => handleRowClick(e, item.stock)}
            >
              <div className="overflow-x-auto">
                <table className="w-full text-sm table-fixed">
                  {tableHeader}
                  <tbody className="divide-y divide-[var(--border)]">
                    {mergedStocks.favs.map((stock) => (
                      <StockRow
                        key={stock.symbol}
                        stock={stock}
                        isFav={true}
                        gapSource={gapSource}
                        isInPortfolio={portSet.has(stock.symbol)}
                        showHigh90d={sortBy === "high90d" || sortBy === "change_1m"}
                        onToggleFavorite={(s) => handleStarClick(s)}
                        onRowClick={handleRowClick}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </StackedList>
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
    </PageLayout>

    {/* DragOverlay -- must be inside DndContext */}
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
  showHigh90d: boolean;
  onToggleFavorite: (stock: StockCache) => void;
  onRowClick: (e: React.MouseEvent, stock: StockCache) => void;
}

const StockRow = memo(function StockRow({ stock, isFav, gapSource, isInPortfolio, showHigh90d, onToggleFavorite, onRowClick }: StockRowProps) {
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
      <td className="px-2 py-2.5 w-[52px]">
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
      <td className="px-2 py-2.5 overflow-hidden">
        <span className="font-medium block truncate">{stock.name}</span>
      </td>
      <td className={`px-2 py-2.5 text-right font-medium tabular-nums w-[88px] ${priceColor(stock.price_change)}`}>
        {formatNumber(stock.current_price)}
      </td>
      <td className={`px-2 py-2.5 text-right font-medium tabular-nums w-[72px] ${priceColor(showHigh90d ? stock.high_90d_pct : stock.price_change_pct)}`}>
        {formatPercent(showHigh90d ? stock.high_90d_pct : stock.price_change_pct)}
      </td>
      <td className="hidden sm:table-cell px-2 py-2.5 text-right tabular-nums w-[64px]">
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
      <td className="hidden md:table-cell px-2 py-2.5 text-[var(--muted)] text-xs w-[72px]">
        {stock.symbol}
      </td>
      <td className="hidden md:table-cell px-2 py-2.5 text-right text-[var(--muted)] tabular-nums w-[88px]">
        {formatNumber(stock.volume)}
      </td>
      <td className="hidden md:table-cell px-2 py-2.5 text-right text-[var(--muted)] tabular-nums w-[56px]">
        {stock.per != null ? stock.per.toFixed(1) : "-"}
      </td>
      <td className="hidden lg:table-cell px-1 py-2.5 text-center w-[60px]">
        <SignalBadge sig={signals.quant} source="quant" />
      </td>
      <td className="hidden lg:table-cell px-1 py-2.5 text-center w-[60px]">
        <SignalBadge sig={signals.lassi} source="lassi" />
      </td>
      <td className="hidden lg:table-cell px-1 py-2.5 text-center w-[68px]">
        <SignalBadge sig={signals.stockbot} source="stockbot" />
      </td>
    </tr>
  );
});

/** StackedList 카드 목록의 항목 하나 (종목 + 즐겨찾기 여부 + 정렬 기준에 따른 표시값 전환) */
interface DisplayItem {
  stock: StockCache;
  isFav: boolean;
  showHigh90d: boolean;
}

/** 신호 소스 라벨 + 배지 쌍. 신호가 없으면 자리를 차지하지 않도록 렌더링하지 않습니다. */
function CardSignal({ sig, source }: { sig: SourceSignal; source: SourceKey }) {
  if (!sig.type) return null;
  return (
    <div className="flex items-center gap-1">
      <span className="text-[var(--muted)]">{SOURCE_LABELS_SHORT[source]}</span>
      <SignalBadge sig={sig} source={source} />
    </div>
  );
}

/** 모바일 카드 (768px 또는 1024px 미만, StackedList breakpoint 참조). StockRow와 같은 표시 로직을 재사용합니다. */
interface StockCardProps {
  stock: StockCache;
  isFav: boolean;
  gapSource: SourceKey | "all";
  isInPortfolio: boolean;
  showHigh90d: boolean;
  onToggleFavorite: (stock: StockCache) => void;
}

const StockCard = memo(function StockCard({ stock, isFav, gapSource, isInPortfolio, showHigh90d, onToggleFavorite }: StockCardProps) {
  const gapResult = calcGap(stock, gapSource);
  const gap = gapResult?.gap ?? null;
  const signals = stock.signals ?? {
    lassi: { type: null, price: null },
    stockbot: { type: null, price: null },
    quant: { type: null, price: null },
  };

  const hasBottomRow =
    signals.quant?.type != null ||
    signals.lassi?.type != null ||
    signals.stockbot?.type != null ||
    gap != null ||
    stock.volume != null ||
    stock.per != null;

  return (
    <div className="flex flex-col gap-1.5">
      {/* 윗줄: 즐겨찾기, 종목명/코드, 현재가, 등락률 */}
      <div className="flex items-center gap-2">
        <button
          onClick={(e) => { e.stopPropagation(); onToggleFavorite(stock); }}
          className="p-0.5 hover:scale-110 transition-transform shrink-0"
        >
          <Star
            className={`w-4 h-4 ${
              isFav ? "text-yellow-400 fill-yellow-400" : "text-[var(--border)] hover:text-yellow-400"
            }`}
          />
        </button>
        {isInPortfolio && (
          <Briefcase className="w-3.5 h-3.5 text-emerald-400 fill-emerald-400/20 shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <span className="font-medium block truncate">{stock.name}</span>
          <span className="text-[10px] text-[var(--muted)]">{stock.symbol}</span>
        </div>
        <div className="text-right shrink-0">
          <div className={`font-medium tabular-nums ${priceColor(stock.price_change)}`}>
            {formatNumber(stock.current_price)}
          </div>
          <div className={`text-xs tabular-nums ${priceColor(showHigh90d ? stock.high_90d_pct : stock.price_change_pct)}`}>
            {showHigh90d && <span className="text-[9px] text-[var(--muted)] mr-1">90일고점비</span>}
            {formatPercent(showHigh90d ? stock.high_90d_pct : stock.price_change_pct)}
          </div>
        </div>
      </div>

      {/* 아랫줄: 알파캐치·라씨·스톡봇 신호, Gap, 거래량, PER — 값 없는 항목은 생략 */}
      {hasBottomRow && (
        <div className="flex items-center gap-3 flex-wrap pl-6 text-[10px]">
          <CardSignal sig={signals.quant} source="quant" />
          <CardSignal sig={signals.lassi} source="lassi" />
          <CardSignal sig={signals.stockbot} source="stockbot" />
          {gap != null && (
            <span className="text-[var(--muted)]">
              Gap{" "}
              <span className={gap >= 0 ? "text-red-400" : "text-blue-400"}>
                {gap >= 0 ? "+" : ""}{gap.toFixed(1)}%
              </span>
            </span>
          )}
          {stock.volume != null && (
            <span className="text-[var(--muted)]">거래량 {formatNumber(stock.volume)}</span>
          )}
          {stock.per != null && (
            <span className="text-[var(--muted)]">PER {stock.per.toFixed(1)}</span>
          )}
        </div>
      )}
    </div>
  );
});
