"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, X, Plus, Pencil, Check } from "lucide-react";
import type { StockCache, WatchlistItem } from "@/types/stock";
import { usePriceRefresh } from "@/hooks/use-price-refresh";

interface Props {
  initialWatchlist: WatchlistItem[];
  stockData: Record<string, StockCache>;
}

interface SearchResult {
  symbol: string;
  name: string;
  market: string;
  current_price?: number | null;
}

function formatNumber(n: number | null): string {
  if (n == null) return "-";
  return n.toLocaleString("ko-KR");
}

function formatPercent(n: number | null): string {
  if (n == null) return "-";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function priceColor(change: number | null): string {
  if (change == null || change === 0) return "text-[var(--foreground)]";
  return change > 0 ? "text-red-400" : "text-blue-400";
}

type EditField = "buy_price" | "stop_loss_price" | "target_price";

export default function InvestmentClient({
  initialWatchlist,
  stockData,
}: Props) {
  const router = useRouter();
  const [watchlist, setWatchlist] = useState(initialWatchlist);

  const symbols = useMemo(() => watchlist.map((w) => w.symbol), [watchlist]);
  const { prices: livePrices } = usePriceRefresh(symbols);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // 인라인 편집 상태
  const [editing, setEditing] = useState<{ symbol: string; field: EditField } | null>(null);
  const [editValue, setEditValue] = useState("");

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSearch = useCallback((value: string) => {
    setSearchQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!value.trim()) {
      setSearchResults([]);
      setShowDropdown(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await fetch(`/api/v1/stocks?q=${encodeURIComponent(value.trim())}`);
        if (res.ok) {
          const data = await res.json();
          setSearchResults(data.data ?? data ?? []);
          setShowDropdown(true);
        }
      } catch {
        // ignore
      } finally {
        setIsSearching(false);
      }
    }, 300);
  }, []);

  const addToWatchlist = useCallback(
    async (result: SearchResult) => {
      if (watchlist.some((w) => w.symbol === result.symbol)) {
        setShowDropdown(false);
        setSearchQuery("");
        return;
      }

      const currentPrice = result.current_price ?? null;
      const buyPrice = currentPrice;
      const stopLoss = currentPrice ? Math.round(currentPrice * 0.9) : null;
      const target = currentPrice ? Math.round(currentPrice * 1.1) : null;

      try {
        await fetch("/api/v1/watchlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            symbol: result.symbol,
            name: result.name,
            buy_price: buyPrice,
            stop_loss_price: stopLoss,
            target_price: target,
          }),
        });

        const newItem: WatchlistItem = {
          id: crypto.randomUUID(),
          symbol: result.symbol,
          name: result.name,
          added_at: new Date().toISOString(),
          memo: null,
          sort_order: watchlist.length,
          buy_price: buyPrice,
          stop_loss_price: stopLoss,
          target_price: target,
        };

        setWatchlist((prev) => [...prev, newItem]);
        setSearchQuery("");
        setShowDropdown(false);
        router.refresh();
      } catch {
        // ignore
      }
    },
    [watchlist, router]
  );

  const removeFromWatchlist = useCallback(
    async (symbol: string) => {
      try {
        await fetch(`/api/v1/watchlist?symbol=${encodeURIComponent(symbol)}`, {
          method: "DELETE",
        });
        setWatchlist((prev) => prev.filter((w) => w.symbol !== symbol));
        router.refresh();
      } catch {
        // ignore
      }
    },
    [router]
  );

  const startEdit = useCallback((symbol: string, field: EditField, currentValue: number | null) => {
    setEditing({ symbol, field });
    setEditValue(currentValue != null ? String(currentValue) : "");
  }, []);

  const saveEdit = useCallback(async () => {
    if (!editing) return;
    const parsedPrice = editValue.trim() ? parseInt(editValue.trim(), 10) : null;

    try {
      await fetch("/api/v1/watchlist", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: editing.symbol, [editing.field]: parsedPrice }),
      });

      setWatchlist((prev) =>
        prev.map((w) =>
          w.symbol === editing.symbol ? { ...w, [editing.field]: parsedPrice } : w
        )
      );
    } catch {
      // ignore
    } finally {
      setEditing(null);
      setEditValue("");
    }
  }, [editing, editValue]);

  const renderEditablePrice = (
    item: WatchlistItem,
    field: EditField,
    label: string,
    colorClass?: string
  ) => {
    const value = item[field];
    const isEditing = editing?.symbol === item.symbol && editing?.field === field;

    if (isEditing) {
      const buyPrice = item.buy_price;
      const pctButtons = [-10, -5, 5, 10];

      return (
        <div className="relative">
          <div className="flex items-center gap-0.5 justify-end">
            <input
              type="number"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveEdit();
                if (e.key === "Escape") { setEditing(null); setEditValue(""); }
              }}
              autoFocus
              className="w-20 px-1.5 py-0.5 rounded border border-[var(--accent)] bg-[var(--background)] text-xs text-right text-[var(--foreground)] focus:outline-none"
              placeholder={label}
              onClick={(e) => e.preventDefault()}
            />
            <button
              onClick={(e) => { e.preventDefault(); saveEdit(); }}
              className="p-0.5 rounded text-green-400 hover:bg-green-900/20"
            >
              <Check className="w-3 h-3" />
            </button>
          </div>
          {buyPrice != null && field !== "buy_price" && (
            <div className="absolute right-0 top-full mt-1 flex gap-0.5 z-10">
              {pctButtons.map((pct) => (
                <button
                  key={pct}
                  onClick={(e) => {
                    e.preventDefault();
                    setEditValue(String(Math.round(buyPrice * (1 + pct / 100))));
                  }}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-medium border transition-colors ${
                    pct > 0
                      ? "border-red-800 text-red-400 hover:bg-red-900/30"
                      : "border-blue-800 text-blue-400 hover:bg-blue-900/30"
                  } bg-[var(--card)]`}
                >
                  {pct > 0 ? "+" : ""}{pct}%
                </button>
              ))}
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="flex items-center gap-0.5 justify-end group/edit">
        <span className={`tabular-nums ${colorClass ?? ""}`}>
          {value != null ? formatNumber(value) : "-"}
        </span>
        <button
          onClick={(e) => { e.preventDefault(); startEdit(item.symbol, field, value); }}
          className="p-0.5 rounded text-[var(--muted)] hover:text-[var(--accent)] opacity-0 group-hover/edit:opacity-100 transition-opacity"
        >
          <Pencil className="w-2.5 h-2.5" />
        </button>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* 검색 바 */}
      <div className="card p-4" ref={dropdownRef}>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--muted)]" />
          <input
            type="text"
            placeholder="종목명 또는 코드 검색하여 추가"
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            onFocus={() => { if (searchResults.length > 0) setShowDropdown(true); }}
            className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-[var(--border)] bg-[var(--background)] text-sm text-[var(--foreground)] placeholder:text-[var(--muted)] focus:outline-none focus:border-[var(--accent)]"
          />
          {isSearching && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-[var(--muted)] border-t-transparent rounded-full animate-spin" />
          )}

          {showDropdown && searchResults.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 rounded-lg border border-[var(--border)] bg-[var(--card)] shadow-xl z-50 max-h-64 overflow-y-auto">
              {searchResults.map((result) => {
                const alreadyAdded = watchlist.some((w) => w.symbol === result.symbol);
                return (
                  <button
                    key={result.symbol}
                    onClick={() => addToWatchlist(result)}
                    disabled={alreadyAdded}
                    className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-[var(--card-hover)] transition-colors text-left disabled:opacity-50"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{result.name}</div>
                      <div className="text-xs text-[var(--muted)]">
                        {result.symbol} · {result.market}
                        {result.current_price ? ` · ${result.current_price.toLocaleString()}원` : ""}
                      </div>
                    </div>
                    {alreadyAdded ? (
                      <span className="text-xs text-[var(--muted)]">추가됨</span>
                    ) : (
                      <Plus className="w-4 h-4 text-[var(--accent)]" />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* 종목 테이블 */}
      {watchlist.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="text-[var(--muted)] text-lg mb-2">포트 종목을 추가해주세요</div>
          <p className="text-sm text-[var(--border)]">위 검색창에서 종목을 검색하여 추가할 수 있습니다</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-[var(--muted)] text-xs">
                  <th className="px-3 py-3 text-left">종목명</th>
                  <th className="px-3 py-3 text-left">코드</th>
                  <th className="px-3 py-3 text-right">현재가</th>
                  <th className="px-3 py-3 text-right">등락률</th>
                  <th className="px-3 py-3 text-right">구매가</th>
                  <th className="px-3 py-3 text-right">손절가</th>
                  <th className="px-3 py-3 text-right">목표가</th>
                  <th className="px-3 py-3 text-right">수익률</th>
                  <th className="px-3 py-3 text-center w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {watchlist.map((item) => {
                  const stock = stockData[item.symbol];
                  const live = livePrices[item.symbol];
                  const currentPrice = live?.current_price ?? stock?.current_price;
                  const change = live?.price_change_pct ?? stock?.price_change_pct;
                  const buyPrice = item.buy_price;
                  const profitPct =
                    buyPrice && currentPrice
                      ? ((currentPrice - buyPrice) / buyPrice) * 100
                      : null;

                  // 손절가/목표가 근접 경고
                  const stopLoss = item.stop_loss_price;
                  const target = item.target_price;
                  const nearStopLoss =
                    stopLoss && currentPrice ? currentPrice <= stopLoss : false;
                  const nearTarget =
                    target && currentPrice ? currentPrice >= target : false;

                  return (
                    <tr
                      key={item.symbol}
                      className={`hover:bg-[var(--card-hover)] transition-colors group ${
                        nearStopLoss ? "bg-blue-900/10" : nearTarget ? "bg-red-900/10" : ""
                      }`}
                    >
                      <td className="px-3 py-2.5">
                        <Link href={`/stock/${item.symbol}`} className="font-medium hover:text-[var(--accent)]">
                          {item.name}
                        </Link>
                      </td>
                      <td className="px-3 py-2.5 text-[var(--muted)] text-xs">
                        {item.symbol}
                      </td>
                      <td className={`px-3 py-2.5 text-right font-medium tabular-nums ${priceColor(live?.price_change ?? stock?.price_change ?? null)}`}>
                        {formatNumber(currentPrice ?? null)}
                      </td>
                      <td className={`px-3 py-2.5 text-right font-medium tabular-nums ${priceColor(change ?? null)}`}>
                        {formatPercent(change ?? null)}
                      </td>
                      <td className="px-3 py-2.5 text-right text-sm">
                        {renderEditablePrice(item, "buy_price", "구매가")}
                      </td>
                      <td className="px-3 py-2.5 text-right text-sm">
                        {renderEditablePrice(
                          item,
                          "stop_loss_price",
                          "손절가",
                          nearStopLoss ? "text-blue-400 font-semibold" : "text-[var(--muted)]"
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right text-sm">
                        {renderEditablePrice(
                          item,
                          "target_price",
                          "목표가",
                          nearTarget ? "text-red-400 font-semibold" : "text-[var(--muted)]"
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {profitPct != null ? (
                          <span className={`text-sm font-semibold ${profitPct >= 0 ? "text-red-400" : "text-blue-400"}`}>
                            {profitPct >= 0 ? "+" : ""}{profitPct.toFixed(2)}%
                          </span>
                        ) : (
                          <span className="text-xs text-[var(--border)]">-</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <button
                          onClick={() => removeFromWatchlist(item.symbol)}
                          className="p-1 rounded-lg text-[var(--muted)] hover:text-red-400 hover:bg-red-900/20 transition-colors opacity-0 group-hover:opacity-100"
                          title="삭제"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="text-center py-3 text-xs text-[var(--muted)]">
            총 {watchlist.length}개 종목
          </div>
        </div>
      )}
    </div>
  );
}
