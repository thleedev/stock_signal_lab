"use client";

import { useState } from "react";

interface Trade {
  id: string;
  portfolio_id: string;
  side: string;
  created_at: string;
}

interface Portfolio {
  id: string;
  name: string;
  is_default: boolean;
}

interface Props {
  symbol: string;
  name: string;
  currentPrice: number;
  portfolios: Portfolio[];
  trades: Trade[];            // GET /api/v1/user-portfolio/trades?symbol=X 결과
  onAddClick: (portfolioId: string, portfolioName: string) => void;  // TradeModal 오픈 콜백
  onTradesChange: (trades: Trade[]) => void;  // 삭제 후 상위 상태 갱신
}

export function PortfolioManagementSection({
  symbol, portfolios, trades, onAddClick, onTradesChange,
}: Props) {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  // 포트별 BUY 거래 목록 (최신순 정렬)
  const tradesByPortfolio = (portfolioId: string) =>
    trades
      .filter((t) => t.portfolio_id === portfolioId && t.side === "BUY")
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const handleDelete = async (portfolioId: string) => {
    const portTrades = tradesByPortfolio(portfolioId);
    if (portTrades.length === 0) return;

    const latestTradeId = portTrades[0].id;
    setDeletingId(latestTradeId);
    try {
      const res = await fetch(
        `/api/v1/user-portfolio/trades?trade_id=${latestTradeId}`,
        { method: "DELETE" }
      );
      if (res.status === 409) {
        alert("이미 거래 완료된 종목입니다.");
        return;
      }
      if (!res.ok) throw new Error("삭제 실패");
      onTradesChange(trades.filter((t) => t.id !== latestTradeId));
      setConfirmId(null);
    } catch {
      alert("삭제 중 오류가 발생했습니다.");
    } finally {
      setDeletingId(null);
    }
  };

  // symbol은 향후 확장 시 사용 가능하도록 유지
  void symbol;

  return (
    <div id="portfolio-section" className="px-6 py-4 border-b border-[var(--border)]">
      <h3 className="text-sm font-semibold text-[var(--muted)] uppercase tracking-wide mb-3">
        포트폴리오
      </h3>
      <ul className="space-y-2">
        {portfolios.map((port) => {
          const portTrades = tradesByPortfolio(port.id);
          const count = portTrades.length;
          const inPort = count > 0;

          return (
            <li key={port.id} className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className={`text-sm ${inPort ? "font-medium" : "text-[var(--muted)]"}`}>
                  {inPort ? "✓" : "✗"} {port.name}
                  {count > 1 && (
                    <span className="ml-1 text-xs text-[var(--muted)]">({count}건)</span>
                  )}
                </span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => onAddClick(port.id, port.name)}
                  className="text-xs px-2 py-1 rounded border border-[var(--border)] hover:bg-[var(--muted)]/10"
                >
                  추가
                </button>
                {inPort && (
                  <>
                    {confirmId === port.id ? (
                      <>
                        <button
                          onClick={() => handleDelete(port.id)}
                          disabled={!!deletingId}
                          className="text-xs px-2 py-1 rounded bg-red-500 text-white hover:bg-red-600 disabled:opacity-50"
                        >
                          확인
                        </button>
                        <button
                          onClick={() => setConfirmId(null)}
                          className="text-xs px-2 py-1 rounded border border-[var(--border)] hover:bg-[var(--muted)]/10"
                        >
                          취소
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => setConfirmId(port.id)}
                        className="text-xs px-2 py-1 rounded border border-red-300 text-red-600 hover:bg-red-50"
                      >
                        삭제
                      </button>
                    )}
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
