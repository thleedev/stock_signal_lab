"use client";

import { useState, useCallback } from "react";
import { Search, X, Plus, TrendingUp, TrendingDown } from "lucide-react";
import { PageLayout, PageHeader } from "@/components/ui";

interface StockData {
  symbol: string;
  name: string;
  current_price: number | null;
  price_change_pct: number | null;
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

const METRICS = [
  { key: "current_price", label: "현재가", unit: "원", format: "number" },
  { key: "price_change_pct", label: "등락률", unit: "%", format: "pct" },
  { key: "per", label: "PER", unit: "배", format: "fixed1" },
  { key: "pbr", label: "PBR", unit: "배", format: "fixed2" },
  { key: "roe", label: "ROE", unit: "%", format: "fixed1" },
  { key: "eps", label: "EPS", unit: "원", format: "number" },
  { key: "bps", label: "BPS", unit: "원", format: "number" },
  { key: "market_cap", label: "시가총액", unit: "", format: "cap" },
  { key: "high_52w", label: "52주 최고", unit: "원", format: "number" },
  { key: "low_52w", label: "52주 최저", unit: "원", format: "number" },
  { key: "dividend_yield", label: "배당수익률", unit: "%", format: "fixed2" },
  { key: "volume", label: "거래량", unit: "주", format: "number" },
] as const;

function formatValue(value: number | null, format: string): string {
  if (value == null) return "-";
  switch (format) {
    case "number":
      return Number(value).toLocaleString();
    case "pct":
      return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
    case "fixed1":
      return value.toFixed(1);
    case "fixed2":
      return value.toFixed(2);
    case "cap":
      if (value >= 1_0000_0000_0000) return `${(value / 1_0000_0000_0000).toFixed(1)}조`;
      if (value >= 1_0000_0000) return `${(value / 1_0000_0000).toFixed(0)}억`;
      return Number(value).toLocaleString() + "원";
    default:
      return String(value);
  }
}

export default function CompareClient() {
  const [stocks, setStocks] = useState<StockData[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Array<{ symbol: string; name: string }>>([]);
  const [searching, setSearching] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const searchStocks = useCallback(async (q: string) => {
    if (q.length < 1) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      const res = await fetch(`/api/v1/stocks?q=${encodeURIComponent(q)}&limit=10`);
      if (res.ok) {
        const json = await res.json();
        setSearchResults((json.data ?? []).map((s: { symbol: string; name: string }) => ({
          symbol: s.symbol,
          name: s.name,
        })));
      }
    } catch (e) {
      console.error("[Compare] 검색 실패:", e);
    }
    setSearching(false);
  }, []);

  const addStock = useCallback(async (symbol: string) => {
    if (stocks.length >= 3 || stocks.some((s) => s.symbol === symbol)) return;
    setLoading(true);
    setSearchQuery("");
    setSearchResults([]);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/v1/stocks/${symbol}/realtime`);
      if (res.ok) {
        const data = await res.json();
        setStocks((prev) => [...prev, data]);
      } else {
        setErrorMsg("종목 데이터를 불러올 수 없습니다");
      }
    } catch (e) {
      console.error("[Compare] 종목 추가 실패:", e);
      setErrorMsg("종목 데이터를 불러올 수 없습니다");
    }
    setLoading(false);
  }, [stocks]);

  const removeStock = useCallback((symbol: string) => {
    setStocks((prev) => prev.filter((s) => s.symbol !== symbol));
  }, []);

  return (
    <PageLayout>
      <PageHeader title="종목 비교" subtitle="2~3개 종목의 차트와 투자지표를 비교 분석" />

      {errorMsg && (
        <div className="bg-red-900/20 border border-red-800/50 text-red-400 text-sm px-4 py-2 rounded-lg">
          {errorMsg}
        </div>
      )}

      {/* 종목 추가 */}
      {stocks.length < 3 && (
        <div className="card p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--muted)]" />
            <input
              type="text"
              placeholder="비교할 종목 검색 (최대 3개)"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                searchStocks(e.target.value);
              }}
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-sm"
            />
            {searchResults.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-[var(--card)] border border-[var(--border)] rounded-lg shadow-xl z-10 max-h-60 overflow-auto">
                {searchResults.map((r) => (
                  <button
                    key={r.symbol}
                    onClick={() => addStock(r.symbol)}
                    disabled={stocks.some((s) => s.symbol === r.symbol)}
                    className="w-full text-left px-4 py-2.5 text-sm hover:bg-[var(--card-hover)] transition-colors flex items-center gap-2 disabled:opacity-50"
                  >
                    <Plus className="w-3.5 h-3.5 text-[var(--muted)]" />
                    <span className="font-medium">{r.name}</span>
                    <span className="text-xs text-[var(--muted)]">{r.symbol}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {loading && <p className="text-xs text-[var(--muted)] mt-2">로딩 중...</p>}
        </div>
      )}

      {/* 선택된 종목 헤더 */}
      {stocks.length > 0 && (
        <div className={`grid gap-4 grid-cols-1 ${stocks.length >= 2 ? "md:grid-cols-2" : ""} ${stocks.length >= 3 ? "lg:grid-cols-3" : ""}`}>
          {stocks.map((stock) => (
            <div key={stock.symbol} className="card p-4">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <div className="font-bold text-lg">{stock.name}</div>
                  <div className="text-xs text-[var(--muted)]">{stock.symbol}</div>
                </div>
                <button
                  onClick={() => removeStock(stock.symbol)}
                  className="p-1 hover:bg-[var(--card-hover)] rounded"
                >
                  <X className="w-4 h-4 text-[var(--muted)]" />
                </button>
              </div>
              {stock.current_price && (
                <div className="flex items-baseline gap-2">
                  <span className="text-xl font-bold">
                    {Number(stock.current_price).toLocaleString()}원
                  </span>
                  {stock.price_change_pct != null && (
                    <span className={`text-sm font-medium flex items-center gap-0.5 ${
                      stock.price_change_pct >= 0 ? "text-red-400" : "text-blue-400"
                    }`}>
                      {stock.price_change_pct >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                      {stock.price_change_pct >= 0 ? "+" : ""}{stock.price_change_pct.toFixed(2)}%
                    </span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 비교 테이블 */}
      {stocks.length >= 2 && (
        <div className="card overflow-hidden">
          <div className="p-4 border-b border-[var(--border)]">
            <h2 className="font-semibold">투자지표 비교</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[var(--background)]">
                  <th className="text-left px-4 py-3 font-medium text-[var(--muted)]">지표</th>
                  {stocks.map((s) => (
                    <th key={s.symbol} className="text-right px-4 py-3 font-medium">
                      {s.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {METRICS.map((metric) => {
                  const values = stocks.map((s) => (s as unknown as Record<string, unknown>)[metric.key] as number | null);
                  const numericValues = values.filter((v) => v != null) as number[];
                  const best = metric.key === "price_change_pct" || metric.key === "roe" || metric.key === "dividend_yield"
                    ? Math.max(...numericValues)
                    : metric.key === "per" || metric.key === "pbr"
                      ? Math.min(...numericValues.filter((v) => v > 0))
                      : null;

                  return (
                    <tr key={metric.key} className="hover:bg-[var(--card-hover)]">
                      <td className="px-4 py-3 text-[var(--muted)] font-medium">{metric.label}</td>
                      {values.map((val, i) => {
                        const isBest = best != null && val === best && numericValues.length > 1;
                        return (
                          <td
                            key={stocks[i].symbol}
                            className={`px-4 py-3 text-right tabular-nums ${
                              isBest ? "text-emerald-400 font-bold" : ""
                            } ${
                              metric.key === "price_change_pct" && val != null
                                ? val >= 0 ? "text-red-400" : "text-blue-400"
                                : ""
                            }`}
                          >
                            {formatValue(val, metric.format)}
                            {val != null && metric.unit && (
                              <span className="text-xs text-[var(--muted)] ml-0.5">{metric.unit}</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {stocks.length === 0 && (
        <div className="card p-12 text-center text-[var(--muted)]">
          종목을 검색하여 추가하면 투자지표를 비교할 수 있습니다
        </div>
      )}

      {stocks.length === 1 && (
        <div className="card p-8 text-center text-[var(--muted)]">
          비교할 종목을 1개 더 추가해주세요
        </div>
      )}
    </PageLayout>
  );
}
