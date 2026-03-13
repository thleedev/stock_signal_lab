"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useStockModal } from "@/contexts/stock-modal-context";
import { StockModalHeader } from "./StockModalHeader";
import { StockAiAnalysis, Signal } from "./StockAiAnalysis";
import { PortfolioManagementSection } from "./PortfolioManagementSection";
import { GroupManagementSection } from "./GroupManagementSection";
import dynamic from "next/dynamic";

const TradeModal = dynamic(
  () => import("@/app/my-portfolio/components/trade-modal").then((m) => m.TradeModal),
  { ssr: false }
);

interface Metrics {
  name: string;
  current_price: number;
  price_change: number;
  price_change_pct: number;
  per: number | null;
  pbr: number | null;
  roe: number | null;
  market_cap: number | null;
}

interface Portfolio {
  id: number;
  name: string;
  is_default: boolean;
}

interface Trade {
  id: string;
  portfolio_id: string;
  side: string;
  created_at: string;
}

interface Group {
  id: string;
  name: string;
}

export function StockDetailModal() {
  const { modal, closeStockModal } = useStockModal();
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [allGroups, setAllGroups] = useState<Group[]>([]);
  const [memberGroupIds, setMemberGroupIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [tradeModalOpen, setTradeModalOpen] = useState(false);
  const [tradePortfolioId, setTradePortfolioId] = useState<number | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);

  const fetchAll = useCallback(async (symbol: string) => {
    setLoading(true);
    setError(null);
    try {
      const [metricsRes, signalsRes, tradesRes, portfoliosRes, groupsRes] = await Promise.all([
        fetch(`/api/v1/stock/${symbol}/metrics`),
        fetch(`/api/v1/signals?symbol=${symbol}`),
        fetch(`/api/v1/user-portfolio/trades?symbol=${symbol}`),
        fetch(`/api/v1/user-portfolio`),
        fetch(`/api/v1/watchlist-groups`),
      ]);

      const [metricsData, signalsData, tradesData, portfoliosData, groupsData] = await Promise.all([
        metricsRes.ok ? metricsRes.json() : null,
        signalsRes.ok ? signalsRes.json() : [],
        tradesRes.ok ? tradesRes.json() : [],
        portfoliosRes.ok ? portfoliosRes.json() : { portfolios: [] },
        groupsRes.ok ? groupsRes.json() : [],
      ]);

      setMetrics(metricsData);
      setSignals(Array.isArray(signalsData) ? (signalsData as Signal[]) : ((signalsData?.signals ?? []) as Signal[]));
      setTrades(Array.isArray(tradesData) ? tradesData : (tradesData?.trades ?? []));
      setPortfolios(Array.isArray(portfoliosData) ? portfoliosData : (portfoliosData?.portfolios ?? []));

      const groups: Group[] = Array.isArray(groupsData) ? groupsData : (groupsData?.groups ?? []);
      setAllGroups(groups);

      const membershipResults = await Promise.all(
        groups.map(async (g) => {
          const res = await fetch(`/api/v1/watchlist-groups/${g.id}/stocks`);
          if (!res.ok) return null;
          const data = await res.json();
          const stocks: { symbol: string }[] = Array.isArray(data) ? data : (data?.stocks ?? []);
          const isMember = stocks.some((s) => s.symbol === symbol);
          return isMember ? g.id : null;
        })
      );
      setMemberGroupIds(membershipResults.filter((id): id is string => id !== null));
    } catch {
      setError("데이터를 불러오는 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (modal?.symbol) {
      fetchAll(modal.symbol);
    }
  }, [modal?.symbol, fetchAll]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeStockModal();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [closeStockModal]);

  if (!modal) return null;

  // 포트폴리오 멤버십 계산 (portfolio_id가 number일 수 있으므로 string 변환 후 비교)
  const memberPortfolioIds = new Set(
    trades
      .filter((t) => t.side === "BUY")
      .map((t) => String(t.portfolio_id))
  );
  const memberPortfolios = portfolios
    .filter((p) => memberPortfolioIds.has(String(p.id)))
    .map((p) => ({ id: String(p.id), name: p.name }));
  const memberGroups = allGroups.filter((g) => memberGroupIds.includes(g.id));
  const currentPrice = metrics?.current_price ?? 0;

  // PortfolioManagementSection용 포트 (id를 string으로 변환)
  const portfoliosForSection = portfolios.map((p) => ({
    id: String(p.id),
    name: p.name,
    is_default: p.is_default,
  }));

  // 트레이드도 portfolio_id를 string으로 정규화
  const tradesForSection: Trade[] = trades.map((t) => ({
    ...t,
    portfolio_id: String(t.portfolio_id),
  }));

  // TradeModal용 포트 (is_default 제외)
  const portfoliosForTradeModal = portfolios.filter((p) => !p.is_default);

  return (
    <>
      <div
        className="fixed inset-0 z-50 bg-black/60"
        onClick={closeStockModal}
      />

      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div
          ref={scrollRef}
          className="pointer-events-auto w-full max-w-2xl max-h-[90vh] flex flex-col bg-[var(--card)] rounded-xl shadow-2xl overflow-hidden"
        >
          <StockModalHeader
            symbol={modal.symbol}
            name={metrics?.name ?? modal.name ?? modal.symbol}
            currentPrice={currentPrice}
            changeAmount={metrics?.price_change ?? 0}
            changePct={metrics?.price_change_pct ?? 0}
            portfolios={memberPortfolios}
            groups={memberGroups}
            onClose={closeStockModal}
          />

          <div className="flex-1 overflow-y-auto">
            {loading && (
              <div className="p-6 space-y-4 animate-pulse">
                {/* 가격 표시 영역 */}
                <div className="space-y-2">
                  <div className="h-4 bg-[var(--muted)]/20 rounded w-3/4" />
                  <div className="h-4 bg-[var(--muted)]/20 rounded w-1/2" />
                </div>
                {/* 투자지표 그리드 */}
                <div className="grid grid-cols-3 gap-3 mt-4">
                  <div className="h-14 bg-[var(--muted)]/20 rounded-lg" />
                  <div className="h-14 bg-[var(--muted)]/20 rounded-lg" />
                  <div className="h-14 bg-[var(--muted)]/20 rounded-lg" />
                </div>
                {/* AI 분석 섹션 */}
                <div className="space-y-2 mt-2">
                  <div className="h-3 bg-[var(--muted)]/20 rounded w-full" />
                  <div className="h-3 bg-[var(--muted)]/20 rounded w-full" />
                  <div className="h-3 bg-[var(--muted)]/20 rounded w-3/4" />
                </div>
              </div>
            )}
            {error && (
              <div className="p-8 text-center">
                <p className="text-red-500 mb-3">{error}</p>
                <button
                  onClick={() => fetchAll(modal.symbol)}
                  className="text-sm px-3 py-1 rounded border border-[var(--border)] hover:bg-[var(--muted)]/10"
                >
                  재시도
                </button>
              </div>
            )}

            {!loading && !error && (
              <>
                {metrics && (
                  <div className="px-6 py-4 border-b border-[var(--border)]">
                    <h3 className="text-sm font-semibold text-[var(--muted)] uppercase tracking-wide mb-3">
                      투자지표
                    </h3>
                    <div className="grid grid-cols-3 gap-3 text-sm">
                      {[
                        { label: "PER", value: metrics.per?.toFixed(2) ?? "—" },
                        { label: "PBR", value: metrics.pbr?.toFixed(2) ?? "—" },
                        { label: "ROE", value: metrics.roe ? `${metrics.roe.toFixed(1)}%` : "—" },
                      ].map(({ label, value }) => (
                        <div key={label} className="bg-[var(--background)] rounded-lg p-2 text-center">
                          <p className="text-[var(--muted)] text-xs">{label}</p>
                          <p className="font-medium mt-0.5">{value}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <StockAiAnalysis
                  signals={signals}
                  currentPrice={currentPrice}
                />

                <PortfolioManagementSection
                  symbol={modal.symbol}
                  name={metrics?.name ?? modal.name ?? modal.symbol}
                  currentPrice={currentPrice}
                  portfolios={portfoliosForSection}
                  trades={tradesForSection}
                  onAddClick={(portfolioId) => {
                    setTradePortfolioId(Number(portfolioId));
                    setTradeModalOpen(true);
                  }}
                  onTradesChange={(newTrades) => setTrades(newTrades)}
                />

                <GroupManagementSection
                  symbol={modal.symbol}
                  name={metrics?.name ?? modal.name ?? modal.symbol}
                  allGroups={allGroups}
                  memberGroupIds={memberGroupIds}
                  onMembershipChange={setMemberGroupIds}
                />
              </>
            )}
          </div>

          <div className="border-t border-[var(--border)] px-6 py-3 flex gap-3">
            <button
              onClick={() => {
                setTradePortfolioId(null);
                setTradeModalOpen(true);
              }}
              className="flex-1 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90"
            >
              포트에 추가
            </button>
            <button
              onClick={() =>
                document.getElementById("group-section")?.scrollIntoView({ behavior: "smooth" })
              }
              className="flex-1 py-2 rounded-lg border border-[var(--border)] text-sm hover:bg-[var(--muted)]/10"
            >
              관심그룹 관리
            </button>
          </div>
        </div>
      </div>

      {tradeModalOpen && (
        <TradeModal
          mode="buy"
          isOpen={tradeModalOpen}
          onClose={() => setTradeModalOpen(false)}
          onSubmit={() => {
            setTradeModalOpen(false);
            fetchAll(modal.symbol);
          }}
          initialSymbol={modal.symbol}
          initialName={metrics?.name ?? modal.name ?? modal.symbol}
          initialPrice={currentPrice}
          portfolios={
            tradePortfolioId !== null
              ? portfoliosForTradeModal.filter((p) => p.id === tradePortfolioId)
              : portfoliosForTradeModal
          }
        />
      )}
    </>
  );
}
