"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BarChart3 } from "lucide-react";

interface PortfolioItem {
  id: number;
  name: string;
  count: number;
}

interface SummaryData {
  total_count: number;
  portfolio_count: number;
  portfolios: PortfolioItem[];
}

export function VirtualPortfolioSection() {
  const [data, setData] = useState<SummaryData | null>(null);

  useEffect(() => {
    fetch("/api/v1/user-portfolio/summary")
      .then((r) => r.json())
      .then((json) => setData(json))
      .catch(() => null);
  }, []);

  return (
    <Link
      href="/my-portfolio"
      className="card p-4 hover:border-[var(--accent)] transition-colors cursor-pointer"
    >
      <div className="flex items-center gap-1.5 mb-3">
        <BarChart3 className="w-4 h-4 text-[var(--muted)]" />
        <span className="text-sm font-semibold">가상 포트폴리오</span>
      </div>

      {data === null ? (
        <div className="text-[var(--muted)] text-sm">로딩 중...</div>
      ) : (
        <>
          <div className="text-3xl font-bold">{data.total_count}</div>
          <div className="text-sm text-[var(--muted)] mt-1">오픈 포지션</div>
          {data.portfolios.length > 0 && (
            <div className="mt-3 space-y-1">
              {data.portfolios.slice(0, 3).map((p) => (
                <div key={p.id} className="flex items-center justify-between text-xs text-[var(--muted)]">
                  <span className="truncate">{p.name}</span>
                  <span>{p.count}종목</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <div className="text-xs text-[var(--muted)] mt-3">관리 →</div>
    </Link>
  );
}
