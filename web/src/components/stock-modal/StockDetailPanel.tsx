"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useStockModal } from "@/contexts/stock-modal-context";
import type { StockRankItem } from "@/app/api/v1/stock-ranking/route";
import { usePriceRefresh } from "@/hooks/use-price-refresh";
import { PanelHeader } from "./PanelHeader";
import { UnifiedScoreCard } from "./UnifiedScoreCard";
import { MetricsGrid } from "./MetricsGrid";
import { ConsensusSection } from "./ConsensusSection";
import { DartInfoSection } from "./DartInfoSection";
import { PortfolioGroupAccordion } from "./PortfolioGroupAccordion";
import { ReturnTrendSection } from "./ReturnTrendSection";
import { SupplyDemandSection } from "./SupplyDemandSection";
import { TechnicalSignalSection } from "./TechnicalSignalSection";
import { ThemeBadges } from "@/components/signals/ThemeBadges";
import dynamic from "next/dynamic";
import { useScoreHistory } from "@/hooks/use-score-history";

// 차트 컴포넌트 — SSR 비활성화
const StockChartSection = dynamic(
  () => import("@/components/charts/stock-chart-section"),
  { ssr: false }
);

// 거래 모달 — SSR 비활성화
const TradeModal = dynamic(
  () => import("@/app/my-portfolio/components/trade-modal").then((m) => m.TradeModal),
  { ssr: false }
);

interface Signal {
  id: string;
  symbol: string;
  signal_type: string;
  source: string;
  timestamp: string;
  signal_price?: string | number;
  raw_data?: Record<string, unknown>;
}

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

interface PriceData {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * StockDetailPanel — 슬라이드 패널 형태의 주식 상세 정보 컨테이너
 * - 2컬럼 레이아웃 (좌: AI 분석, 우: 시장 데이터)
 * - 3단계 점진적 데이터 로딩 (Phase 1: metrics/signals/prices)
 * - 오버레이 클릭 및 ESC 키로 닫기 지원
 */
export function StockDetailPanel() {
  const { modal, closeStockModal } = useStockModal();
  const [isVisible, setIsVisible] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Phase 1 fetch 상태
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [dailyPrices, setDailyPrices] = useState<PriceData[]>([]);
  const [phase1Loading, setPhase1Loading] = useState(false);
  const [phase1Error, setPhase1Error] = useState<string | null>(null);

  // initialData 없을 때 랭킹 데이터 fallback
  const [rankingData, setRankingData] = useState<StockRankItem | null>(null);

  // 점수 추이
  const { history, fetchHistory } = useScoreHistory();

  // 거래 모달 상태
  const [tradeModalOpen, setTradeModalOpen] = useState(false);

  // 실시간 시세
  const { prices: livePrices } = usePriceRefresh(modal ? [modal.symbol] : []);
  const livePrice = modal ? livePrices[modal.symbol] : null;

  // 데이터 우선순위: livePrice > metrics > initialData
  const baseData = modal?.initialData ?? rankingData;
  // metrics로 빈 필드 보강 (stock_cache 미수집 종목 대응)
  const data = baseData && metrics ? {
    ...baseData,
    per: baseData.per ?? metrics.per ?? null,
    pbr: baseData.pbr ?? metrics.pbr ?? null,
    roe: baseData.roe ?? metrics.roe ?? null,
    high_52w: baseData.high_52w ?? metrics.high_52w ?? null,
    low_52w: baseData.low_52w ?? metrics.low_52w ?? null,
    dividend_yield: baseData.dividend_yield ?? metrics.dividend_yield ?? null,
    foreign_net_qty: baseData.foreign_net_qty ?? (metrics as unknown as Record<string, unknown>)?.foreign_net_qty as number | null ?? null,
    institution_net_qty: baseData.institution_net_qty ?? (metrics as unknown as Record<string, unknown>)?.institution_net_qty as number | null ?? null,
    current_price: metrics.current_price ?? baseData.current_price,
  } as StockRankItem : baseData;
  const currentPrice = livePrice?.current_price ?? metrics?.current_price ?? data?.current_price ?? 0;
  const changeAmount = livePrice?.price_change ?? metrics?.price_change ?? 0;
  const changePct = livePrice?.price_change_pct ?? metrics?.price_change_pct ?? data?.price_change_pct ?? 0;

  // 지표 병합 (metrics 우선, initialData fallback)
  const metricsData = {
    per: metrics?.per ?? data?.per ?? null,
    pbr: metrics?.pbr ?? data?.pbr ?? null,
    roe: metrics?.roe ?? data?.roe ?? null,
    eps: metrics?.eps ?? null,
    bps: metrics?.bps ?? null,
    dividend_yield: metrics?.dividend_yield ?? data?.dividend_yield ?? null,
    market_cap: metrics?.market_cap ?? data?.market_cap ?? null,
    volume: metrics?.volume ?? null,
    high_52w: metrics?.high_52w ?? data?.high_52w ?? null,
    low_52w: metrics?.low_52w ?? data?.low_52w ?? null,
  };

  // 슬라이드 애니메이션 처리
  useEffect(() => {
    if (modal) {
      requestAnimationFrame(() => setIsVisible(true));
    } else {
      setIsVisible(false);
    }
  }, [modal]);

  // Phase 1: metrics, signals, daily-prices 병렬 fetch
  const fetchPhase1 = useCallback(async (symbol: string, hasInitialData: boolean) => {
    setPhase1Loading(true);
    setPhase1Error(null);
    try {
      const fetches: Promise<Response>[] = [
        fetch(`/api/v1/stock/${symbol}/metrics`),
        fetch(`/api/v1/signals?symbol=${symbol}`),
        fetch(`/api/v1/stock/${symbol}/daily-prices`),
      ];

      // initialData 없을 때 단일 종목 경량 경로로 호출
      if (!hasInitialData) {
        fetches.push(fetch(`/api/v1/stock-ranking?symbol=${symbol}`));
      }

      const responses = await Promise.all(fetches);
      const [metricsRes, signalsRes, dailyPricesRes] = responses;

      const [metricsJson, signalsJson, dailyPricesJson] = await Promise.all([
        metricsRes.ok ? metricsRes.json() : null,
        signalsRes.ok ? signalsRes.json() : { signals: [] },
        dailyPricesRes.ok ? dailyPricesRes.json() : [],
      ]);

      if (metricsJson) setMetrics(metricsJson);

      const sigs = Array.isArray(signalsJson) ? signalsJson : (signalsJson?.signals ?? []);
      setSignals(sigs);

      const rawPrices = Array.isArray(dailyPricesJson) ? dailyPricesJson : [];
      // 날짜 오름차순 정렬
      setDailyPrices(rawPrices.sort((a: PriceData, b: PriceData) => a.date.localeCompare(b.date)));

      // initialData 없을 때 랭킹 데이터에서 해당 종목 추출
      if (!hasInitialData && responses[3]) {
        const rankingJson = await (responses[3].ok ? responses[3].json() : null);
        if (rankingJson?.items) {
          const item = rankingJson.items.find((i: StockRankItem) => i.symbol === symbol);
          if (item) setRankingData(item);
        }
      }
    } catch {
      setPhase1Error("데이터를 불러오는 중 오류가 발생했습니다.");
    } finally {
      setPhase1Loading(false);
    }
  }, []);

  // 종목 변경 시 상태 초기화 후 Phase 1 fetch
  useEffect(() => {
    if (modal?.symbol) {
      setMetrics(null);
      setSignals([]);
      setDailyPrices([]);
      setRankingData(null);
      setPhase1Error(null);
      fetchPhase1(modal.symbol, !!modal.initialData);
      fetchHistory(modal.symbol);
    }
  }, [modal?.symbol, modal?.initialData, fetchPhase1, fetchHistory]);

  // ESC 키로 패널 닫기
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeStockModal();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [closeStockModal]);

  // 애니메이션 후 닫기
  const handleClose = useCallback(() => {
    setIsVisible(false);
    setTimeout(closeStockModal, 300);
  }, [closeStockModal]);

  if (!modal) return null;

  const stockName = metrics?.name ?? modal.name ?? data?.name ?? modal.symbol;

  // 차트에 표시할 시그널 마커 생성
  const signalMarkers = signals
    .map((s) => ({
      date: (s.timestamp || "").split("T")[0],
      type: s.signal_type as "BUY" | "BUY_FORECAST" | "SELL" | "SELL_COMPLETE",
      source: s.source,
    }))
    .filter((m) => m.date);
  const signalDates = [...new Set(signalMarkers.map((m) => m.date))];

  return (
    <>
      {/* 반투명 오버레이 */}
      <div
        className={`fixed inset-0 z-50 bg-black/50 transition-opacity duration-300 ${isVisible ? "opacity-100" : "opacity-0"}`}
        onClick={handleClose}
      />

      {/* 슬라이드 패널 */}
      <div
        ref={panelRef}
        className={`fixed top-0 right-0 z-50 h-screen w-[85vw] max-w-[1200px] max-md:w-full bg-[var(--card)] shadow-2xl flex flex-col transition-transform duration-300 ease-out ${isVisible ? "translate-x-0" : "translate-x-full"}`}
      >
        <PanelHeader
          symbol={modal.symbol}
          name={stockName}
          currentPrice={currentPrice}
          changeAmount={changeAmount}
          changePct={changePct}
          grade={data?.score_total != null ? (data.score_total >= 90 ? 'A+' : data.score_total >= 80 ? 'A' : data.score_total >= 65 ? 'B+' : data.score_total >= 50 ? 'B' : data.score_total >= 35 ? 'C' : 'D') : undefined}
          recommendation={data?.score_total != null ? (data.score_total >= 90 ? '적극매수' : data.score_total >= 80 ? '매수' : data.score_total >= 65 ? '관심' : data.score_total >= 50 ? '보통' : data.score_total >= 35 ? '관망' : '주의') : undefined}
          onClose={handleClose}
        />

        {/* 테마/주도주 배지 */}
        {(data?.theme_tags?.length || data?.is_leader || data?.is_hot_theme) && (
          <div className="px-4 py-2 border-b border-[var(--border)]">
            <ThemeBadges
              theme_tags={data.theme_tags ?? []}
              is_leader={data.is_leader ?? false}
              is_hot_theme={data.is_hot_theme ?? false}
            />
          </div>
        )}

        {/* 2컬럼 바디 */}
        <div className="flex-1 overflow-hidden flex flex-col md:flex-row">
          {/* 좌측 컬럼: AI 분석 영역 */}
          <div className="md:w-[55%] overflow-y-auto border-r border-[var(--border)] max-md:border-r-0">
            {data ? (
              <UnifiedScoreCard data={data} history={history} />
            ) : phase1Loading ? (
              // 로딩 스켈레톤
              <div className="p-4 space-y-4 animate-pulse">
                <div className="h-20 bg-[var(--muted)]/20 rounded-xl" />
                <div className="h-36 bg-[var(--muted)]/20 rounded-xl" />
                <div className="h-48 bg-[var(--muted)]/20 rounded-xl" />
              </div>
            ) : (
              // 스코어 데이터 없음
              <div className="p-6 flex flex-col items-center justify-center gap-2 text-center text-[var(--muted)]">
                <span className="text-3xl">—</span>
                <p className="text-sm">스코어 데이터가 없습니다</p>
                <p className="text-xs opacity-60">채점 배치가 아직 실행되지 않았거나<br/>해당 종목이 분석 대상에 포함되지 않습니다</p>
              </div>
            )}
          </div>

          {/* 우측 컬럼: 시장 데이터 영역 */}
          <div className="md:w-[45%] overflow-y-auto">
            <div className="space-y-0 divide-y divide-[var(--border)]">
              {/* 주가 차트 */}
              {phase1Loading && dailyPrices.length === 0 ? (
                <div className="p-4 animate-pulse">
                  <div className="h-[250px] bg-[var(--muted)]/20 rounded-xl" />
                </div>
              ) : dailyPrices.length > 0 ? (
                <div>
                  <StockChartSection
                    prices={dailyPrices}
                    signalDates={signalDates}
                    signalMarkers={signalMarkers}
                    initialPeriod={30}
                  />
                </div>
              ) : null}

              {/* 주요 지표 그리드 */}
              <MetricsGrid data={metricsData} />

              {/* 수익률 추이 */}
              <ReturnTrendSection
                symbol={modal.symbol}
                currentPrice={currentPrice}
              />

              {/* 컨센서스 섹션 */}
              {data && <ConsensusSection data={data} currentPrice={currentPrice} />}

              {/* DART 공시 섹션 */}
              {data && <DartInfoSection data={data} />}

              {/* 수급 동향 */}
              {data && <SupplyDemandSection data={data} />}

              {/* 기술적 시그널 */}
              {data && (
                <TechnicalSignalSection
                  data={data}
                  signals={signals}
                  signalsLoading={phase1Loading}
                />
              )}

              {/* 에러 메시지 및 재시도 버튼 */}
              {phase1Error && (
                <div className="p-4 text-center">
                  <p className="text-[var(--danger)] mb-3 text-sm">{phase1Error}</p>
                  <button
                    onClick={() => fetchPhase1(modal.symbol, !!modal.initialData)}
                    className="text-sm px-3 py-1 rounded border border-[var(--border)] hover:bg-[var(--card-hover)]"
                  >
                    재시도
                  </button>
                </div>
              )}

              {/* 포트폴리오 그룹 아코디언 */}
              <PortfolioGroupAccordion
                symbol={modal.symbol}
                name={stockName}
                currentPrice={currentPrice}
                onAddClick={() => {
                  setTradeModalOpen(true);
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* 거래 모달 */}
      {tradeModalOpen && (
        <TradeModal
          mode="buy"
          isOpen={tradeModalOpen}
          onClose={() => setTradeModalOpen(false)}
          onSubmit={() => {
            setTradeModalOpen(false);
            fetchPhase1(modal.symbol, !!modal.initialData);
          }}
          initialSymbol={modal.symbol}
          initialName={stockName}
          initialPrice={currentPrice}
          portfolios={[]}
        />
      )}
    </>
  );
}
