"use client";

import { useState, useCallback } from "react";
import { PortfolioManagementSection } from "./PortfolioManagementSection";
import { GroupManagementSection } from "./GroupManagementSection";

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

interface Portfolio {
  id: string;
  name: string;
  is_default: boolean;
}

interface Group {
  id: string;
  name: string;
}

interface Props {
  symbol: string;
  name: string;
  currentPrice: number;
  onAddClick: (portfolioId: string, portfolioName: string) => void;
}

export function PortfolioGroupAccordion({ symbol, name, currentPrice, onAddClick }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [allGroups, setAllGroups] = useState<Group[]>([]);
  const [memberGroupIds, setMemberGroupIds] = useState<string[]>([]);

  const fetchData = useCallback(async () => {
    if (loaded) return;
    setLoading(true);
    try {
      const [portfoliosRes, tradesRes, groupsRes] = await Promise.all([
        fetch("/api/v1/user-portfolio"),
        fetch(`/api/v1/user-portfolio/trades?symbol=${symbol}`),
        fetch("/api/v1/watchlist-groups"),
      ]);

      const [portfoliosData, tradesData, groupsData] = await Promise.all([
        portfoliosRes.ok ? portfoliosRes.json() : { portfolios: [] },
        tradesRes.ok ? tradesRes.json() : { trades: [] },
        groupsRes.ok ? groupsRes.json() : { groups: [] },
      ]);

      const ports: Portfolio[] = (Array.isArray(portfoliosData) ? portfoliosData : (portfoliosData?.portfolios ?? [])).map(
        (p: { id: number; name: string; is_default: boolean }) => ({ id: String(p.id), name: p.name, is_default: p.is_default })
      );
      setPortfolios(ports);

      const rawTrades = Array.isArray(tradesData) ? tradesData : (tradesData?.trades ?? []);
      setTrades(rawTrades.map((t: Trade) => ({ ...t, portfolio_id: String(t.portfolio_id) })));

      const groups: Group[] = Array.isArray(groupsData) ? groupsData : (groupsData?.groups ?? []);
      setAllGroups(groups);

      const membershipResults = await Promise.all(
        groups.map(async (g) => {
          const res = await fetch(`/api/v1/watchlist-groups/${g.id}/stocks`);
          if (!res.ok) return null;
          const data = await res.json();
          const stocks: { symbol: string }[] = Array.isArray(data) ? data : (data?.stocks ?? []);
          return stocks.some((s) => s.symbol === symbol) ? g.id : null;
        })
      );
      setMemberGroupIds(membershipResults.filter((id): id is string => id !== null));
      setLoaded(true);
    } catch {
      // silently fail — show empty state
    } finally {
      setLoading(false);
    }
  }, [symbol, loaded]);

  const handleToggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !loaded) fetchData();
  };

  return (
    <div className="border-t border-[var(--border)]">
      <button
        onClick={handleToggle}
        className="w-full flex items-center justify-between p-4 text-sm font-medium hover:bg-[var(--card-hover)] transition-colors"
      >
        <span>포트폴리오 / 관심그룹</span>
        <span className="text-[var(--muted)]">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div>
          {loading ? (
            <div className="p-4 space-y-2 animate-pulse">
              <div className="h-8 bg-[var(--muted)]/20 rounded" />
              <div className="h-8 bg-[var(--muted)]/20 rounded" />
              <div className="h-8 bg-[var(--muted)]/20 rounded" />
            </div>
          ) : (
            <>
              <PortfolioManagementSection
                symbol={symbol}
                name={name}
                currentPrice={currentPrice}
                portfolios={portfolios}
                trades={trades}
                onAddClick={onAddClick}
                onTradesChange={(newTrades) => setTrades(newTrades as Trade[])}
              />
              <GroupManagementSection
                symbol={symbol}
                name={name}
                allGroups={allGroups}
                memberGroupIds={memberGroupIds}
                onMembershipChange={setMemberGroupIds}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}
