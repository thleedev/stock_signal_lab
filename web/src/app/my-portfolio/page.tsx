"use client";

import { useState, useEffect, useCallback } from "react";
import { PortfolioTabs } from "./components/portfolio-tabs";
import { PortfolioSummary } from "./components/portfolio-summary";
import { HoldingsTable, type Holding } from "./components/holdings-table";
import { TradeModal } from "./components/trade-modal";
import { PerformanceChart } from "./components/performance-chart";

interface Portfolio {
  id: number;
  name: string;
  is_default: boolean;
  sort_order: number;
}

interface Summary {
  total_return_pct: number;
  holding_count: number;
  completed_trade_count: number;
}

export default function MyPortfolioPage() {
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [activePortfolioId, setActivePortfolioId] = useState<number | null>(null);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [summary, setSummary] = useState<Summary>({ total_return_pct: 0, holding_count: 0, completed_trade_count: 0 });

  // 모달 상태
  const [tradeModalOpen, setTradeModalOpen] = useState(false);
  const [tradeMode, setTradeMode] = useState<"buy" | "sell">("buy");
  const [sellTarget, setSellTarget] = useState<Holding | null>(null);

  const fetchPortfolios = useCallback(async () => {
    const res = await fetch("/api/v1/user-portfolio");
    const data = await res.json();
    setPortfolios(data.portfolios ?? []);
  }, []);

  const fetchHoldings = useCallback(async () => {
    const params = activePortfolioId ? `?portfolio_id=${activePortfolioId}` : "";
    const res = await fetch(`/api/v1/user-portfolio/holdings${params}`);
    const data = await res.json();
    setHoldings(data.holdings ?? []);
    setSummary(data.summary ?? { total_return_pct: 0, holding_count: 0, completed_trade_count: 0 });
  }, [activePortfolioId]);

  useEffect(() => { fetchPortfolios(); }, [fetchPortfolios]);
  useEffect(() => { fetchHoldings(); }, [fetchHoldings]);

  const handleSell = (holding: Holding) => {
    setSellTarget(holding);
    setTradeMode("sell");
    setTradeModalOpen(true);
  };

  const handleBuy = () => {
    setSellTarget(null);
    setTradeMode("buy");
    setTradeModalOpen(true);
  };

  return (
    <div className="min-h-screen bg-white">
      {/* 탭 바 */}
      <PortfolioTabs
        portfolios={portfolios}
        activeId={activePortfolioId}
        onSelect={setActivePortfolioId}
        onPortfoliosChange={fetchPortfolios}
      />

      {/* 요약 카드 */}
      <PortfolioSummary
        totalReturnPct={summary.total_return_pct}
        holdingCount={summary.holding_count}
        completedTradeCount={summary.completed_trade_count}
      />

      {/* 보유 종목 테이블 */}
      <div className="px-4">
        <HoldingsTable holdings={holdings} onSell={handleSell} />
      </div>

      {/* 하단 버튼 */}
      <div className="flex gap-2 p-4">
        <button
          onClick={handleBuy}
          className="flex-1 bg-red-500 text-white py-2.5 rounded-lg text-sm font-semibold"
        >
          + 종목 매수
        </button>
        <a
          href="#performance"
          className="flex-1 bg-blue-500 text-white py-2.5 rounded-lg text-sm font-semibold text-center"
        >
          📊 포트 비교
        </a>
      </div>

      {/* 포트 성과 비교 차트 */}
      <PerformanceChart portfolioId={activePortfolioId ?? undefined} />

      {/* 매수/매도 모달 */}
      <TradeModal
        mode={tradeMode}
        isOpen={tradeModalOpen}
        onClose={() => setTradeModalOpen(false)}
        onSubmit={fetchHoldings}
        initialSymbol={sellTarget?.symbol}
        initialName={sellTarget?.name}
        initialPrice={sellTarget?.current_price}
        buyTradeId={sellTarget?.trade_id}
        portfolios={portfolios}
      />
    </div>
  );
}
