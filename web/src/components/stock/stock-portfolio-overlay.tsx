"use client";

import { useState, useEffect, useCallback } from "react";
import { TradeModal } from "@/app/my-portfolio/components/trade-modal";
import type { PortfolioOverlay } from "@/components/charts/candle-chart";

const PORTFOLIO_COLORS = ["#ef4444", "#8b5cf6", "#f59e0b", "#10b981", "#0ea5e9", "#ec4899"];

interface Portfolio {
  id: number;
  name: string;
  is_default: boolean;
  sort_order: number;
}

interface Trade {
  id: number;
  portfolio_id: number;
  symbol: string;
  side: "BUY" | "SELL";
  price: number;
  target_price: number | null;
  stop_price: number | null;
  created_at: string;
  buy_trade_id: number | null;
}

interface Props {
  symbol: string;
  stockName: string;
  currentPrice: number | null;
  onOverlaysChange?: (overlays: PortfolioOverlay[]) => void;
}

export default function StockPortfolioOverlay({
  symbol,
  stockName,
  currentPrice,
  onOverlaysChange,
}: Props) {
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [checkedPortIds, setCheckedPortIds] = useState<Set<number>>(new Set());
  const [tradeModalOpen, setTradeModalOpen] = useState(false);

  useEffect(() => {
    fetch("/api/v1/user-portfolio")
      .then((r) => r.json())
      .then((d) => setPortfolios(d.portfolios ?? []));
  }, []);

  useEffect(() => {
    fetch(`/api/v1/user-portfolio/trades?symbol=${symbol}`)
      .then((r) => r.json())
      .then((d) => setTrades(d.trades ?? []));
  }, [symbol]);

  const togglePortfolio = (id: number) => {
    setCheckedPortIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // 체크된 포트의 오버레이 데이터 빌드
  useEffect(() => {
    if (!onOverlaysChange) return;

    const overlays: PortfolioOverlay[] = portfolios
      .filter((p) => checkedPortIds.has(p.id))
      .map((p, i) => {
        const portTrades = trades.filter((t) => t.portfolio_id === p.id);
        const color = PORTFOLIO_COLORS[i % PORTFOLIO_COLORS.length];

        const markers = portTrades.map((t) => ({
          date: t.created_at.slice(0, 10),
          side: t.side,
          price: t.price,
        }));

        // 미청산 BUY의 매수가/목표가/손절가 프라이스 라인
        const sellBuyIds = new Set(portTrades.filter((t) => t.side === "SELL").map((t) => t.buy_trade_id));
        const openBuys = portTrades.filter((t) => t.side === "BUY" && !sellBuyIds.has(t.id));

        const priceLines: PortfolioOverlay["priceLines"] = [];
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
      });

    onOverlaysChange(overlays);
  }, [checkedPortIds, portfolios, trades, onOverlaysChange]);

  const userPorts = portfolios.filter((p) => !p.is_default);

  if (userPorts.length === 0) return null;

  return (
    <>
      {/* 포트 체크박스 */}
      <div className="flex gap-3 p-2 bg-[var(--card)] rounded-lg mb-2 flex-wrap">
        {userPorts.map((p, i) => (
          <label key={p.id} className="flex items-center gap-1 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={checkedPortIds.has(p.id)}
              onChange={() => togglePortfolio(p.id)}
            />
            <span style={{ color: PORTFOLIO_COLORS[i % PORTFOLIO_COLORS.length] }} className="font-semibold">
              {p.name}
            </span>
          </label>
        ))}
      </div>

      {/* 매수 모달 */}
      <TradeModal
        mode="buy"
        isOpen={tradeModalOpen}
        onClose={() => {
          setTradeModalOpen(false);
        }}
        onSubmit={() => {
          // 거래 후 trades 재조회
          fetch(`/api/v1/user-portfolio/trades?symbol=${symbol}`)
            .then((r) => r.json())
            .then((d) => setTrades(d.trades ?? []));
        }}
        initialSymbol={symbol}
        initialName={stockName}
        initialPrice={currentPrice ?? undefined}
        portfolios={portfolios}
      />
    </>
  );
}
