"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useStockModal } from "@/contexts/stock-modal-context";
import { StockModalHeader } from "./StockModalHeader";
import { StockAiAnalysis, Signal } from "./StockAiAnalysis";
import { PortfolioManagementSection } from "./PortfolioManagementSection";
import { GroupManagementSection } from "./GroupManagementSection";
import { usePriceRefresh } from "@/hooks/use-price-refresh";
import dynamic from "next/dynamic";

const TradeModal = dynamic(
  () => import("@/app/my-portfolio/components/trade-modal").then((m) => m.TradeModal),
  { ssr: false }
);

const StockChartSection = dynamic(
  () => import("@/components/charts/stock-chart-section"),
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
  eps: number | null;
  bps: number | null;
  market_cap: number | null;
  high_52w: number | null;
  low_52w: number | null;
  dividend_yield: number | null;
  volume: number | null;
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
  price: number;
  target_price: number | null;
  stop_price: number | null;
  buy_trade_id: string | null;
  created_at: string;
}

interface Group {
  id: string;
  name: string;
}

interface PriceData {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const PORTFOLIO_COLORS = ["#ef4444", "#8b5cf6", "#f59e0b", "#10b981", "#0ea5e9", "#ec4899"];

function formatMarketCap(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1e12) return `${(n / 1e12).toFixed(1)}조`;
  if (n >= 1e8) return `${(n / 1e8).toFixed(0)}억`;
  return `${n.toLocaleString()}원`;
}

export function StockDetailModal() {
  const { modal, closeStockModal } = useStockModal();
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [allGroups, setAllGroups] = useState<Group[]>([]);
  const [memberGroupIds, setMemberGroupIds] = useState<string[]>([]);
  const [dailyPrices, setDailyPrices] = useState<PriceData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [tradeModalOpen, setTradeModalOpen] = useState(false);
  const [tradePortfolioId, setTradePortfolioId] = useState<number | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);

  // 실시간 가격 갱신
  const { prices: livePrices } = usePriceRefresh(modal ? [modal.symbol] : []);
  const livePrice = modal ? livePrices[modal.symbol] : null;

  const currentPrice = livePrice?.current_price ?? metrics?.current_price ?? 0;
  const changeAmount = livePrice?.price_change ?? metrics?.price_change ?? 0;
  const changePct = livePrice?.price_change_pct ?? metrics?.price_change_pct ?? 0;

  const fetchAll = useCallback(async (symbol: string) => {
    setLoading(true);
    setError(null);
    try {
      const [metricsRes, signalsRes, tradesRes, portfoliosRes, groupsRes, dailyPricesRes] = await Promise.all([
        fetch(`/api/v1/stock/${symbol}/metrics`),
        fetch(`/api/v1/signals?symbol=${symbol}`),
        fetch(`/api/v1/user-portfolio/trades?symbol=${symbol}`),
        fetch(`/api/v1/user-portfolio`),
        fetch(`/api/v1/watchlist-groups`),
        fetch(`/api/v1/stock/${symbol}/daily-prices`),
      ]);

      const [metricsData, signalsData, tradesData, portfoliosData, groupsData, dailyPricesData] = await Promise.all([
        metricsRes.ok ? metricsRes.json() : null,
        signalsRes.ok ? signalsRes.json() : [],
        tradesRes.ok ? tradesRes.json() : [],
        portfoliosRes.ok ? portfoliosRes.json() : { portfolios: [] },
        groupsRes.ok ? groupsRes.json() : [],
        dailyPricesRes.ok ? dailyPricesRes.json() : [],
      ]);

      setMetrics(metricsData);
      setSignals(Array.isArray(signalsData) ? (signalsData as Signal[]) : ((signalsData?.signals ?? []) as Signal[]));
      setTrades(Array.isArray(tradesData) ? tradesData : (tradesData?.trades ?? []));
      setPortfolios(Array.isArray(portfoliosData) ? portfoliosData : (portfoliosData?.portfolios ?? []));
      const rawPrices = Array.isArray(dailyPricesData) ? dailyPricesData : [];
      setDailyPrices(rawPrices.sort((a: PriceData, b: PriceData) => a.date.localeCompare(b.date)));

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

  // 차트용 시그널 마커
  const signalMarkers = signals
    .map((s) => ({
      date: (s.timestamp || "").split("T")[0],
      type: s.signal_type as "BUY" | "BUY_FORECAST" | "SELL" | "SELL_COMPLETE",
      source: s.source,
    }))
    .filter((m) => m.date);

  const signalDates = [...new Set(signalMarkers.map((m) => m.date))];

  // 포트폴리오 오버레이 빌드 (미청산 BUY만 표시)
  const portfolioOverlays = portfolios
    .filter((p) => !p.is_default)
    .map((p, i) => {
      const portTrades = trades.filter((t) => String(t.portfolio_id) === String(p.id));
      const color = PORTFOLIO_COLORS[i % PORTFOLIO_COLORS.length];

      const markers = portTrades.map((t) => ({
        date: t.created_at.slice(0, 10),
        side: t.side as "BUY" | "SELL",
        price: t.price,
      }));

      const sellBuyIds = new Set(
        portTrades.filter((t) => t.side === "SELL").map((t) => String(t.buy_trade_id))
      );
      const openBuys = portTrades.filter(
        (t) => t.side === "BUY" && !sellBuyIds.has(String(t.id))
      );

      const priceLines: Array<{ price: number; label: string; style: "solid" | "dashed" }> = [];
      for (const buy of openBuys) {
        priceLines.push({ price: buy.price, label: `매수 ${buy.price.toLocaleString()}`, style: "solid" });
        if (buy.target_price) {
          priceLines.push({ price: buy.target_price, label: `목표 ${buy.target_price.toLocaleString()}`, style: "dashed" });
        }
        if (buy.stop_price) {
          priceLines.push({ price: buy.stop_price, label: `손절 ${buy.stop_price.toLocaleString()}`, style: "dashed" });
        }
      }

      return { portfolioName: p.name, color, markers, priceLines };
    })
    .filter((o) => o.markers.length > 0 || o.priceLines.length > 0);

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
            changeAmount={changeAmount}
            changePct={changePct}
            portfolios={memberPortfolios}
            groups={memberGroups}
            onClose={closeStockModal}
          />

          <div className="flex-1 overflow-y-auto">
            {loading && (
              <div className="p-6 space-y-4 animate-pulse">
                {/* 차트 스켈레톤 */}
                <div className="h-[300px] bg-[var(--muted)]/20 rounded-lg" />
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
                {/* 캔들차트 */}
                {dailyPrices.length > 0 && (
                  <div className="border-b border-[var(--border)]">
                    <StockChartSection
                      prices={dailyPrices}
                      signalDates={signalDates}
                      signalMarkers={signalMarkers}
                      portfolioOverlays={portfolioOverlays}
                      initialPeriod={30}
                    />
                  </div>
                )}

                {/* 투자지표 */}
                {metrics && (
                  <div className="px-6 py-4 border-b border-[var(--border)]">
                    <h3 className="text-sm font-semibold text-[var(--muted)] uppercase tracking-wide mb-3">
                      투자지표
                    </h3>
                    <div className="space-y-2 text-sm">
                      {/* Row 1: PER / PBR / ROE */}
                      <div className="grid grid-cols-3 gap-2">
                        {[
                          { label: "PER", value: metrics.per != null ? `${metrics.per.toFixed(2)}배` : "—" },
                          { label: "PBR", value: metrics.pbr != null ? `${metrics.pbr.toFixed(2)}배` : "—" },
                          { label: "ROE", value: metrics.roe != null ? `${metrics.roe.toFixed(1)}%` : "—" },
                        ].map(({ label, value }) => (
                          <div key={label} className="bg-[var(--background)] rounded-lg p-2 text-center">
                            <p className="text-[var(--muted)] text-xs">{label}</p>
                            <p className="font-medium mt-0.5">{value}</p>
                          </div>
                        ))}
                      </div>
                      {/* Row 2: EPS / BPS / 배당수익률 */}
                      <div className="grid grid-cols-3 gap-2">
                        {[
                          { label: "EPS", value: metrics.eps != null ? `${metrics.eps.toLocaleString()}원` : "—" },
                          { label: "BPS", value: metrics.bps != null ? `${metrics.bps.toLocaleString()}원` : "—" },
                          { label: "배당수익률", value: metrics.dividend_yield != null ? `${metrics.dividend_yield.toFixed(2)}%` : "—" },
                        ].map(({ label, value }) => (
                          <div key={label} className="bg-[var(--background)] rounded-lg p-2 text-center">
                            <p className="text-[var(--muted)] text-xs">{label}</p>
                            <p className="font-medium mt-0.5">{value}</p>
                          </div>
                        ))}
                      </div>
                      {/* Row 3: 시가총액 / 거래량 */}
                      <div className="grid grid-cols-2 gap-2">
                        {[
                          { label: "시가총액", value: formatMarketCap(metrics.market_cap) },
                          { label: "거래량", value: metrics.volume != null ? `${metrics.volume.toLocaleString()}주` : "—" },
                        ].map(({ label, value }) => (
                          <div key={label} className="bg-[var(--background)] rounded-lg p-2 text-center">
                            <p className="text-[var(--muted)] text-xs">{label}</p>
                            <p className="font-medium mt-0.5">{value}</p>
                          </div>
                        ))}
                      </div>
                      {/* Row 4: 52주 최고가 / 52주 최저가 */}
                      <div className="grid grid-cols-2 gap-2">
                        <div className="bg-[var(--background)] rounded-lg p-2 text-center">
                          <p className="text-[var(--muted)] text-xs">52주 최고가</p>
                          <p className="font-medium mt-0.5 text-red-500">
                            {metrics.high_52w != null ? `${metrics.high_52w.toLocaleString()}원` : "—"}
                          </p>
                        </div>
                        <div className="bg-[var(--background)] rounded-lg p-2 text-center">
                          <p className="text-[var(--muted)] text-xs">52주 최저가</p>
                          <p className="font-medium mt-0.5 text-blue-500">
                            {metrics.low_52w != null ? `${metrics.low_52w.toLocaleString()}원` : "—"}
                          </p>
                        </div>
                      </div>
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
                  onTradesChange={(newTrades) => setTrades(newTrades as Trade[])}
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
