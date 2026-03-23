"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { LayoutList, Grid3X3, Layers, Briefcase } from "lucide-react";
import StockActionMenu from "@/components/common/stock-action-menu";
import type { WatchlistGroup } from "@/types/stock";
import { SourceBadge, SignalBadge } from "@/components/ui";

type Signal = Record<string, string>;

function SignalCard({
  signal,
  isFavorite,
  isInPortfolio,
  onClick,
}: {
  signal: Signal;
  isFavorite: boolean;
  isInPortfolio: boolean;
  onClick: (e: React.MouseEvent) => void;
}) {
  const isBuy = ["BUY", "BUY_FORECAST"].includes(signal.signal_type);

  return (
    <div
      onClick={onClick}
      className="px-4 py-3 flex items-center gap-3 hover:bg-[var(--card-hover)] transition-colors flex-wrap cursor-pointer"
    >
      {/* 신호 타입 */}
      <SignalBadge type={signal.signal_type} />

      {/* 소스 배지 */}
      <SourceBadge source={signal.source as "lassi" | "stockbot" | "quant"} />

      {/* 즐겨찾기/포트 표시 */}
      {isFavorite && <span className="text-yellow-500 text-sm">★</span>}
      {isInPortfolio && <Briefcase className="w-3.5 h-3.5 text-emerald-400 fill-emerald-400/20" />}

      {/* 종목명 + 코드 */}
      <span className="font-medium">{signal.name}</span>
      <span className="text-xs text-[var(--muted)]">{signal.symbol}</span>

      {/* 매수가/매도가 */}
      {signal.signal_price && (
        <span className={`text-sm font-medium ${isBuy ? "text-red-400" : "text-blue-400"}`}>
          <span className="text-[10px] text-[var(--muted)] mr-0.5">{isBuy ? "매수가" : "매도가"}</span>
          {Number(signal.signal_price).toLocaleString()}원
        </span>
      )}

      {/* 시간 (signal_time 우선, 없으면 timestamp 폴백) */}
      <span className="ml-auto text-xs text-[var(--muted)]">
        {new Date(signal.signal_time || signal.timestamp).toLocaleTimeString("ko-KR", {
          hour: "2-digit",
          minute: "2-digit",
        })}
      </span>
    </div>
  );
}

function SignalList({
  signals,
  favSet,
  portSet,
  emptyMessage,
  onSignalClick,
}: {
  signals: Signal[];
  favSet: Set<string>;
  portSet: Set<string>;
  emptyMessage: string;
  onSignalClick: (e: React.MouseEvent, signal: Signal) => void;
}) {
  if (signals.length === 0) {
    return (
      <div className="p-8 text-center text-[var(--muted)]">{emptyMessage}</div>
    );
  }

  return (
    <div className="divide-y divide-[var(--border)]">
      {signals.map((s) => (
        <SignalCard
          key={s.id}
          signal={s}
          isFavorite={favSet.has(s.symbol)}
          isInPortfolio={portSet.has(s.symbol)}
          onClick={(e) => onSignalClick(e, s)}
        />
      ))}
    </div>
  );
}

// 신호를 소스+시장별로 그룹핑하는 유틸
function useGroupedSignals(signals: Signal[]) {
  return useMemo(() => {
    const sourceMap: Record<string, Record<string, Signal[]>> = {};
    const seen = new Set<string>();

    for (const sig of signals) {
      const key = `${sig.source}_${sig.symbol}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const source = sig.source || "기타";
      const market = sig.market || "기타";
      if (!sourceMap[source]) sourceMap[source] = {};
      if (!sourceMap[source][market]) sourceMap[source][market] = [];
      sourceMap[source][market].push(sig);
    }

    return sourceMap;
  }, [signals]);
}

// 섹터별(소스+시장) 요약 뷰
function SectorSummaryView({
  buySignals,
  sellSignals,
  onStockClick,
}: {
  buySignals: Signal[];
  sellSignals: Signal[];
  onStockClick: (e: React.MouseEvent, signal: Signal) => void;
}) {
  const buyGrouped = useGroupedSignals(buySignals);
  const sellGrouped = useGroupedSignals(sellSignals);

  const sourceOrder = ["lassi", "stockbot", "quant"];
  const marketOrder = ["KOSPI", "KOSDAQ", "ETF", "기타"];

  const allSources = [...new Set([...Object.keys(buyGrouped), ...Object.keys(sellGrouped)])];
  const sortedSources = allSources.sort(
    (a, b) => (sourceOrder.indexOf(a) === -1 ? 99 : sourceOrder.indexOf(a)) -
              (sourceOrder.indexOf(b) === -1 ? 99 : sourceOrder.indexOf(b))
  );

  if (buySignals.length === 0 && sellSignals.length === 0) {
    return (
      <div className="card p-8 text-center text-[var(--muted)]">
        신호가 없습니다
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {sortedSources.map((source) => {
        const buyMarkets = buyGrouped[source] || {};
        const sellMarkets = sellGrouped[source] || {};
        const buyCount = Object.values(buyMarkets).reduce((sum, arr) => sum + arr.length, 0);
        const sellCount = Object.values(sellMarkets).reduce((sum, arr) => sum + arr.length, 0);

        const allMarkets = [...new Set([...Object.keys(buyMarkets), ...Object.keys(sellMarkets)])];
        const sortedMarkets = allMarkets.sort(
          (a, b) => (marketOrder.indexOf(a) === -1 ? 99 : marketOrder.indexOf(a)) -
                    (marketOrder.indexOf(b) === -1 ? 99 : marketOrder.indexOf(b))
        );

        return (
          <div key={source} className="card overflow-hidden">
            {/* 소스 헤더 */}
            <div className={`px-4 py-2.5 flex items-center gap-2 border-b border-[var(--border)] ${
              source === "lassi" ? "bg-red-900/10" :
              source === "stockbot" ? "bg-green-900/10" :
              source === "quant" ? "bg-blue-900/10" : ""
            }`}>
              <SourceBadge source={source as "lassi" | "stockbot" | "quant"} />
              <span className="text-xs text-[var(--muted)]">
                매수 {buyCount} / 매도 {sellCount}
              </span>
            </div>

            {/* 시장별 종목 */}
            <div className="p-4 space-y-3">
              {sortedMarkets.map((market) => {
                const buyStocks = buyMarkets[market] || [];
                const sellStocks = sellMarkets[market] || [];
                return (
                  <div key={market}>
                    <div className="text-xs text-[var(--muted)] mb-1.5 font-medium">{market}</div>
                    {buyStocks.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-1.5">
                        {buyStocks.map((sig) => (
                          <button
                            key={sig.symbol}
                            onClick={(e) => onStockClick(e, sig)}
                            className="px-2.5 py-1 rounded-md text-sm bg-red-900/15 hover:bg-red-900/30 text-red-400 border border-red-800/30 transition-colors cursor-pointer"
                          >
                            {sig.name}
                          </button>
                        ))}
                      </div>
                    )}
                    {sellStocks.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {sellStocks.map((sig) => (
                          <button
                            key={sig.symbol}
                            onClick={(e) => onStockClick(e, sig)}
                            className="px-2.5 py-1 rounded-md text-sm bg-blue-900/15 hover:bg-blue-900/30 text-blue-400 border border-blue-800/30 transition-colors cursor-pointer"
                          >
                            {sig.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// 업종별 요약 뷰
function IndustrySummaryView({
  buySignals,
  sellSignals,
  onStockClick,
}: {
  buySignals: Signal[];
  sellSignals: Signal[];
  onStockClick: (e: React.MouseEvent, signal: Signal) => void;
}) {
  const grouped = useMemo(() => {
    const sectorMap: Record<string, { buy: Signal[]; sell: Signal[] }> = {};
    const seen = new Set<string>();

    for (const sig of buySignals) {
      const key = `buy_${sig.symbol}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const sector = sig.sector || "기타";
      if (!sectorMap[sector]) sectorMap[sector] = { buy: [], sell: [] };
      sectorMap[sector].buy.push(sig);
    }
    for (const sig of sellSignals) {
      const key = `sell_${sig.symbol}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const sector = sig.sector || "기타";
      if (!sectorMap[sector]) sectorMap[sector] = { buy: [], sell: [] };
      sectorMap[sector].sell.push(sig);
    }

    return sectorMap;
  }, [buySignals, sellSignals]);

  // 종목 수 기준 내림차순, "기타"는 마지막
  const sortedSectors = Object.keys(grouped).sort((a, b) => {
    if (a === "기타") return 1;
    if (b === "기타") return -1;
    const countA = grouped[a].buy.length + grouped[a].sell.length;
    const countB = grouped[b].buy.length + grouped[b].sell.length;
    return countB - countA;
  });

  if (buySignals.length === 0 && sellSignals.length === 0) {
    return (
      <div className="card p-8 text-center text-[var(--muted)]">
        신호가 없습니다
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {sortedSectors.map((sector) => {
        const { buy, sell } = grouped[sector];
        return (
          <div key={sector} className="card overflow-hidden">
            {/* 업종 헤더 */}
            <div className="px-4 py-2.5 flex items-center gap-2 border-b border-[var(--border)] bg-[var(--card)]">
              <span className="text-sm font-semibold">{sector}</span>
              <span className="text-xs text-[var(--muted)]">
                {buy.length > 0 && <span className="text-red-400">매수 {buy.length}</span>}
                {buy.length > 0 && sell.length > 0 && " / "}
                {sell.length > 0 && <span className="text-blue-400">매도 {sell.length}</span>}
              </span>
            </div>

            <div className="p-3 space-y-2">
              {buy.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {buy.map((sig) => (
                    <button
                      key={sig.symbol}
                      onClick={(e) => onStockClick(e, sig)}
                      className="px-2.5 py-1 rounded-md text-sm bg-red-900/15 hover:bg-red-900/30 text-red-400 border border-red-800/30 transition-colors cursor-pointer"
                    >
                      {sig.name}
                    </button>
                  ))}
                </div>
              )}
              {sell.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {sell.map((sig) => (
                    <button
                      key={sig.symbol}
                      onClick={(e) => onStockClick(e, sig)}
                      className="px-2.5 py-1 rounded-md text-sm bg-blue-900/15 hover:bg-blue-900/30 text-blue-400 border border-blue-800/30 transition-colors cursor-pointer"
                    >
                      {sig.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function SignalColumns({
  buySignals,
  sellSignals,
  favoriteSymbols,
  watchlistSymbols = [],
  groups: initialGroups = [],
  symbolGroups: initialSymbolGroups = {},
}: {
  buySignals: Signal[];
  sellSignals: Signal[];
  favoriteSymbols: string[];
  watchlistSymbols?: string[];
  groups?: WatchlistGroup[];
  symbolGroups?: Record<string, string[]>;
}) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"buy" | "sell">("buy");
  const [viewMode, setViewMode] = useState<"list" | "summary" | "industry">("list");
  const [favSet, setFavSet] = useState(() => new Set(favoriteSymbols));
  const [portSet] = useState(() => new Set(watchlistSymbols));
  const [groups] = useState<WatchlistGroup[]>(initialGroups);
  const [symGroups, setSymGroups] = useState<Record<string, string[]>>(initialSymbolGroups);
  const [actionMenu, setActionMenu] = useState<{
    signal: Signal;
    position: { x: number; y: number };
  } | null>(null);

  // 장중 60초마다 서버 데이터 자동 새로고침
  useEffect(() => {
    const interval = setInterval(() => {
      const now = new Date();
      const kstHour = (now.getUTCHours() + 9) % 24;
      const day = now.getDay();
      if (day >= 1 && day <= 5 && kstHour >= 9 && kstHour < 16) {
        router.refresh();
      }
    }, 60_000);
    return () => clearInterval(interval);
  }, [router]);

  const handleSignalClick = useCallback((e: React.MouseEvent, signal: Signal) => {
    setActionMenu({
      signal,
      position: {
        x: Math.min(e.clientX, window.innerWidth - 220),
        y: Math.min(e.clientY, window.innerHeight - 250),
      },
    });
  }, []);

  const handleToggleFavorite = useCallback(() => {
    if (!actionMenu) return;
    const { symbol, name } = actionMenu.signal;
    const isFav = favSet.has(symbol);

    if (isFav) {
      // 모든 그룹에서 제거
      const groupIds = symGroups[symbol] ?? [];
      groupIds.forEach((gid) => {
        fetch(`/api/v1/watchlist-groups/${gid}/stocks/${symbol}`, { method: "DELETE" });
      });
      setFavSet((prev) => { const n = new Set(prev); n.delete(symbol); return n; });
      setSymGroups((prev) => { const next = { ...prev }; delete next[symbol]; return next; });
    } else {
      // 커스텀 그룹 없으면 기본 그룹 자동 추가
      const defaultGroup = groups.find((g) => g.is_default);
      if (defaultGroup) {
        fetch(`/api/v1/watchlist-groups/${defaultGroup.id}/stocks`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol, name }),
        });
        setSymGroups((prev) => ({ ...prev, [symbol]: [defaultGroup.id] }));
      }
      setFavSet((prev) => new Set([...prev, symbol]));
    }
    setActionMenu(null);
  }, [actionMenu, favSet, symGroups, groups]);

  const handleGroupToggle = useCallback(async (group: WatchlistGroup) => {
    if (!actionMenu) return;
    const { symbol, name } = actionMenu.signal;
    const currentGroups = symGroups[symbol] ?? [];
    const inGroup = currentGroups.includes(group.id);

    // 낙관적 업데이트
    if (inGroup) {
      const newGroups = currentGroups.filter((id) => id !== group.id);
      setSymGroups((prev) => ({ ...prev, [symbol]: newGroups }));
      if (newGroups.length === 0) {
        setFavSet((prev) => { const n = new Set(prev); n.delete(symbol); return n; });
      }
    } else {
      setSymGroups((prev) => ({ ...prev, [symbol]: [...currentGroups, group.id] }));
      setFavSet((prev) => new Set([...prev, symbol]));
    }

    try {
      if (inGroup) {
        const res = await fetch(`/api/v1/watchlist-groups/${group.id}/stocks/${symbol}`, { method: "DELETE" });
        if (!res.ok) throw new Error("DELETE 실패");
      } else {
        const res = await fetch(`/api/v1/watchlist-groups/${group.id}/stocks`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol, name }),
        });
        if (!res.ok && res.status !== 409) throw new Error("POST 실패");
      }
    } catch (e) {
      console.error("[handleGroupToggle] 실패, 롤백:", e);
      // 롤백
      setSymGroups((prev) => ({ ...prev, [symbol]: currentGroups }));
      if (!inGroup) {
        if (currentGroups.length === 0) setFavSet((prev) => { const n = new Set(prev); n.delete(symbol); return n; });
      } else {
        setFavSet((prev) => new Set([...prev, symbol]));
      }
    }
  }, [actionMenu, symGroups]);

  return (
    <>
      {/* 뷰 모드 전환 */}
      <div className="flex justify-end gap-1">
        <button
          onClick={() => setViewMode("list")}
          className={`p-2 rounded-lg transition-colors ${
            viewMode === "list"
              ? "bg-[var(--accent)] text-white"
              : "bg-[var(--card)] text-[var(--muted)] hover:text-[var(--foreground)]"
          }`}
          title="상세 보기"
        >
          <LayoutList className="w-4 h-4" />
        </button>
        <button
          onClick={() => setViewMode("summary")}
          className={`p-2 rounded-lg transition-colors ${
            viewMode === "summary"
              ? "bg-[var(--accent)] text-white"
              : "bg-[var(--card)] text-[var(--muted)] hover:text-[var(--foreground)]"
          }`}
          title="소스별 요약"
        >
          <Grid3X3 className="w-4 h-4" />
        </button>
        <button
          onClick={() => setViewMode("industry")}
          className={`p-2 rounded-lg transition-colors ${
            viewMode === "industry"
              ? "bg-[var(--accent)] text-white"
              : "bg-[var(--card)] text-[var(--muted)] hover:text-[var(--foreground)]"
          }`}
          title="업종별 요약"
        >
          <Layers className="w-4 h-4" />
        </button>
      </div>

      {/* 요약 뷰 */}
      {viewMode === "summary" ? (
        <SectorSummaryView buySignals={buySignals} sellSignals={sellSignals} onStockClick={handleSignalClick} />
      ) : viewMode === "industry" ? (
        <IndustrySummaryView buySignals={buySignals} sellSignals={sellSignals} onStockClick={handleSignalClick} />
      ) : (
      <>
      {/* 모바일: 탭 전환 */}
      <div className="md:hidden">
        <div className="flex border-b border-[var(--border)] mb-4">
          <button
            onClick={() => setActiveTab("buy")}
            className={`flex-1 py-3 text-sm font-semibold text-center transition-colors ${
              activeTab === "buy"
                ? "text-red-400 border-b-2 border-red-400"
                : "text-[var(--muted)] hover:text-[var(--foreground)]"
            }`}
          >
            매수 신호
            <span className="ml-1.5 text-xs opacity-70">
              ({buySignals.length})
            </span>
          </button>
          <button
            onClick={() => setActiveTab("sell")}
            className={`flex-1 py-3 text-sm font-semibold text-center transition-colors ${
              activeTab === "sell"
                ? "text-blue-400 border-b-2 border-blue-400"
                : "text-[var(--muted)] hover:text-[var(--foreground)]"
            }`}
          >
            매도 신호
            <span className="ml-1.5 text-xs opacity-70">
              ({sellSignals.length})
            </span>
          </button>
        </div>

        <div className="card">
          {activeTab === "buy" ? (
            <SignalList
              signals={buySignals}
              favSet={favSet}
              portSet={portSet}
              emptyMessage="매수 신호가 없습니다"
              onSignalClick={handleSignalClick}
            />
          ) : (
            <SignalList
              signals={sellSignals}
              favSet={favSet}
              portSet={portSet}
              emptyMessage="매도 신호가 없습니다"
              onSignalClick={handleSignalClick}
            />
          )}
        </div>

        <div className="text-sm text-[var(--muted)] text-right mt-2">
          {activeTab === "buy"
            ? `매수 ${buySignals.length}건`
            : `매도 ${sellSignals.length}건`}
        </div>
      </div>

      {/* 데스크톱: 2컬럼 */}
      <div className="hidden md:grid md:grid-cols-2 md:gap-6">
        {/* 매수 컬럼 */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-lg font-semibold text-red-400">매수 신호</h2>
            <span className="text-xs text-[var(--muted)]">
              {buySignals.length}건
            </span>
          </div>
          <div className="card">
            <SignalList
              signals={buySignals}
              favSet={favSet}
              portSet={portSet}
              emptyMessage="매수 신호가 없습니다"
              onSignalClick={handleSignalClick}
            />
          </div>
        </div>

        {/* 매도 컬럼 */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-lg font-semibold text-blue-400">매도 신호</h2>
            <span className="text-xs text-[var(--muted)]">
              {sellSignals.length}건
            </span>
          </div>
          <div className="card">
            <SignalList
              signals={sellSignals}
              favSet={favSet}
              portSet={portSet}
              emptyMessage="매도 신호가 없습니다"
              onSignalClick={handleSignalClick}
            />
          </div>
        </div>
      </div>

      {/* 데스크톱 총 건수 */}
      <div className="hidden md:block text-sm text-[var(--muted)] text-right">
        총 {buySignals.length + sellSignals.length}건 (매수{" "}
        {buySignals.length} / 매도 {sellSignals.length})
      </div>
    </>
      )}

      {/* 종목 액션 메뉴 */}
      {actionMenu && (
        <StockActionMenu
          symbol={actionMenu.signal.symbol}
          name={actionMenu.signal.name}
          currentPrice={actionMenu.signal.signal_price ? Number(actionMenu.signal.signal_price) : undefined}
          isOpen={true}
          onClose={() => setActionMenu(null)}
          position={actionMenu.position}
          isFavorite={favSet.has(actionMenu.signal.symbol)}
          isInPortfolio={portSet.has(actionMenu.signal.symbol)}
          onToggleFavorite={handleToggleFavorite}
          groups={groups}
          symbolGroupIds={symGroups[actionMenu.signal.symbol] ?? []}
          onGroupToggle={handleGroupToggle}
        />
      )}
    </>
  );
}
