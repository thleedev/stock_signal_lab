"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, X, Plus, TrendingUp, TrendingDown, GripVertical, Pencil, Check } from "lucide-react";
import type { StockCache, WatchlistItem } from "@/types/stock";

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

const SIGNAL_COLORS: Record<string, string> = {
  BUY: "bg-red-900/50 text-red-400 border-red-700",
  BUY_FORECAST: "bg-red-900/30 text-red-300 border-red-800",
  SELL: "bg-blue-900/50 text-blue-400 border-blue-700",
  SELL_COMPLETE: "bg-blue-900/30 text-blue-300 border-blue-800",
};

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

function formatMarketCap(n: number | null): string {
  if (n == null) return "-";
  if (n >= 1_0000_0000_0000) {
    return `${(n / 1_0000_0000_0000).toFixed(1)}조`;
  }
  if (n >= 1_0000_0000) {
    return `${(n / 1_0000_0000).toFixed(0)}억`;
  }
  return formatNumber(n);
}

export default function InvestmentClient({
  initialWatchlist,
  stockData,
}: Props) {
  const router = useRouter();
  const [watchlist, setWatchlist] = useState(initialWatchlist);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const [buyPriceInput, setBuyPriceInput] = useState("");
  const [editingBuyPrice, setEditingBuyPrice] = useState<string | null>(null);
  const [editBuyPriceValue, setEditBuyPriceValue] = useState("");

  // 외부 클릭으로 드롭다운 닫기
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
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
        const res = await fetch(
          `/api/v1/stocks?q=${encodeURIComponent(value.trim())}`
        );
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
      // 이미 있는지 확인
      if (watchlist.some((w) => w.symbol === result.symbol)) {
        setShowDropdown(false);
        setSearchQuery("");
        return;
      }

      const parsedBuyPrice = buyPriceInput.trim()
        ? parseInt(buyPriceInput.trim(), 10)
        : (result.current_price ?? null);

      try {
        await fetch("/api/v1/watchlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            symbol: result.symbol,
            name: result.name,
            buy_price: parsedBuyPrice,
          }),
        });

        const newItem: WatchlistItem = {
          id: crypto.randomUUID(),
          symbol: result.symbol,
          name: result.name,
          added_at: new Date().toISOString(),
          memo: null,
          sort_order: watchlist.length,
          buy_price: parsedBuyPrice,
        };

        setWatchlist((prev) => [...prev, newItem]);
        setSearchQuery("");
        setBuyPriceInput("");
        setShowDropdown(false);
        router.refresh();
      } catch {
        // ignore
      }
    },
    [watchlist, router, buyPriceInput]
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

  const updateBuyPrice = useCallback(
    async (symbol: string) => {
      const parsedPrice = editBuyPriceValue.trim() ? parseInt(editBuyPriceValue.trim(), 10) : null;

      try {
        await fetch("/api/v1/watchlist", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol, buy_price: parsedPrice }),
        });

        setWatchlist((prev) =>
          prev.map((w) =>
            w.symbol === symbol ? { ...w, buy_price: parsedPrice } : w
          )
        );
        setEditingBuyPrice(null);
        setEditBuyPriceValue("");
      } catch {
        // ignore
      }
    },
    [editBuyPriceValue]
  );

  const handleDragEnd = useCallback(() => {
    if (dragIdx !== null && dragOverIdx !== null && dragIdx !== dragOverIdx) {
      setWatchlist((prev) => {
        const updated = [...prev];
        const [moved] = updated.splice(dragIdx, 1);
        updated.splice(dragOverIdx, 0, moved);
        // 서버에 순서 업데이트
        const ordered = updated.map((item, i) => ({ symbol: item.symbol, sort_order: i }));
        fetch("/api/v1/watchlist/reorder", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: ordered }),
        }).catch(() => {});
        return updated;
      });
    }
    setDragIdx(null);
    setDragOverIdx(null);
  }, [dragIdx, dragOverIdx]);

  return (
    <div className="space-y-6">
      {/* 검색 바 + 구매가 입력 */}
      <div className="card p-4" ref={dropdownRef}>
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--muted)]" />
            <input
              type="text"
              placeholder="종목명 또는 코드 검색"
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              onFocus={() => {
                if (searchResults.length > 0) setShowDropdown(true);
              }}
              className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-[var(--border)] bg-[var(--background)] text-sm text-[var(--foreground)] placeholder:text-[var(--muted)] focus:outline-none focus:border-[var(--accent)]"
            />
            {isSearching && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-[var(--muted)] border-t-transparent rounded-full animate-spin" />
            )}

            {/* 자동완성 드롭다운 */}
            {showDropdown && searchResults.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 rounded-lg border border-[var(--border)] bg-[var(--card)] shadow-xl z-50 max-h-64 overflow-y-auto">
                {searchResults.map((result) => {
                  const alreadyAdded = watchlist.some(
                    (w) => w.symbol === result.symbol
                  );
                  return (
                    <button
                      key={result.symbol}
                      onClick={() => addToWatchlist(result)}
                      disabled={alreadyAdded}
                      className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-[var(--card-hover)] transition-colors text-left disabled:opacity-50"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">
                          {result.name}
                        </div>
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
          <input
            type="number"
            placeholder="구매가"
            value={buyPriceInput}
            onChange={(e) => setBuyPriceInput(e.target.value)}
            className="w-28 px-3 py-2.5 rounded-lg border border-[var(--border)] bg-[var(--background)] text-sm text-[var(--foreground)] placeholder:text-[var(--muted)] focus:outline-none focus:border-[var(--accent)] text-right"
          />
        </div>
      </div>

      {/* 워치리스트 카드 목록 */}
      {watchlist.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="text-[var(--muted)] text-lg mb-2">
            포트 종목을 추가해주세요
          </div>
          <p className="text-sm text-[var(--border)]">
            위 검색창에서 종목을 검색하여 추가할 수 있습니다
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {watchlist.map((item, idx) => {
            const stock = stockData[item.symbol];
            const change = stock?.price_change_pct;
            const currentPrice = stock?.current_price;
            const buyPrice = item.buy_price;
            const profitPct = buyPrice && currentPrice
              ? ((currentPrice - buyPrice) / buyPrice) * 100
              : null;

            return (
              <div
                key={item.symbol}
                draggable
                onDragStart={() => setDragIdx(idx)}
                onDragOver={(e) => { e.preventDefault(); setDragOverIdx(idx); }}
                onDragEnd={handleDragEnd}
                className={`card hover:bg-[var(--card-hover)] transition-colors group ${
                  dragOverIdx === idx && dragIdx !== idx ? "border-[var(--accent)] border-dashed" : ""
                }`}
              >
                <div className="flex items-start gap-2 p-4">
                  {/* 드래그 핸들 */}
                  <div className="pt-1 cursor-grab active:cursor-grabbing text-[var(--muted)] opacity-0 group-hover:opacity-100 transition-opacity">
                    <GripVertical className="w-4 h-4" />
                  </div>
                  {/* 메인 콘텐츠 - 클릭 시 상세 페이지 이동 */}
                  <Link
                    href={`/stock/${item.symbol}`}
                    className="flex-1 min-w-0"
                  >
                    <div className="flex items-center gap-3 mb-3">
                      <div>
                        <h3 className="font-semibold text-base">
                          {item.name}
                        </h3>
                        <span className="text-xs text-[var(--muted)]">
                          {item.symbol}
                          {stock?.market ? ` · ${stock.market}` : ""}
                        </span>
                      </div>
                      {/* 가격 정보 */}
                      {stock && (
                        <div className="ml-auto text-right">
                          <div
                            className={`text-lg font-bold ${priceColor(stock.price_change)}`}
                          >
                            {formatNumber(stock.current_price)}
                            <span className="text-xs ml-1">원</span>
                          </div>
                          <div
                            className={`text-sm font-medium flex items-center justify-end gap-1 ${priceColor(change ?? null)}`}
                          >
                            {change != null && change > 0 && (
                              <TrendingUp className="w-3.5 h-3.5" />
                            )}
                            {change != null && change < 0 && (
                              <TrendingDown className="w-3.5 h-3.5" />
                            )}
                            {formatPercent(change ?? null)}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* 지표 그리드 */}
                    {stock && (
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-2">
                        <div>
                          <span className="text-xs text-[var(--muted)]">
                            PER
                          </span>
                          <div className="text-sm font-medium">
                            {stock.per != null ? stock.per.toFixed(1) : "-"}
                          </div>
                        </div>
                        <div>
                          <span className="text-xs text-[var(--muted)]">
                            PBR
                          </span>
                          <div className="text-sm font-medium">
                            {stock.pbr != null ? stock.pbr.toFixed(2) : "-"}
                          </div>
                        </div>
                        <div>
                          <span className="text-xs text-[var(--muted)]">
                            ROE
                          </span>
                          <div className="text-sm font-medium">
                            {stock.roe != null
                              ? `${stock.roe.toFixed(1)}%`
                              : "-"}
                          </div>
                        </div>
                        <div>
                          <span className="text-xs text-[var(--muted)]">
                            시가총액
                          </span>
                          <div className="text-sm font-medium">
                            {formatMarketCap(stock.market_cap)}
                          </div>
                        </div>
                        <div>
                          <span className="text-xs text-[var(--muted)]">
                            52주 최고
                          </span>
                          <div className="text-sm font-medium text-red-400">
                            {formatNumber(stock.high_52w)}
                          </div>
                        </div>
                        <div>
                          <span className="text-xs text-[var(--muted)]">
                            52주 최저
                          </span>
                          <div className="text-sm font-medium text-blue-400">
                            {formatNumber(stock.low_52w)}
                          </div>
                        </div>
                        {stock.latest_signal_type && (
                          <div className="col-span-2 sm:col-span-2">
                            <span className="text-xs text-[var(--muted)]">
                              AI신호
                            </span>
                            <div className="mt-0.5">
                              <span
                                className={`inline-block text-xs px-2 py-0.5 rounded border ${
                                  SIGNAL_COLORS[stock.latest_signal_type] ??
                                  "bg-gray-800 text-gray-400 border-gray-700"
                                }`}
                              >
                                {stock.latest_signal_type}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </Link>

                  {/* 구매가 & 수익률 + 삭제 버튼 */}
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    {/* 구매가 인라인 편집 */}
                    <div className="flex items-center gap-1">
                      {editingBuyPrice === item.symbol ? (
                        <>
                          <input
                            type="number"
                            value={editBuyPriceValue}
                            onChange={(e) => setEditBuyPriceValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") updateBuyPrice(item.symbol);
                              if (e.key === "Escape") {
                                setEditingBuyPrice(null);
                                setEditBuyPriceValue("");
                              }
                            }}
                            autoFocus
                            className="w-24 px-2 py-1 rounded border border-[var(--accent)] bg-[var(--background)] text-sm text-right text-[var(--foreground)] focus:outline-none"
                            placeholder="구매가"
                            onClick={(e) => e.stopPropagation()}
                          />
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              updateBuyPrice(item.symbol);
                            }}
                            className="p-1 rounded text-green-400 hover:bg-green-900/20"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                        </>
                      ) : (
                        <>
                          <div className="text-right">
                            <span className="text-xs text-[var(--muted)]">구매가 </span>
                            <span className="text-sm font-medium">
                              {buyPrice != null ? `${formatNumber(buyPrice)}원` : "-"}
                            </span>
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingBuyPrice(item.symbol);
                              setEditBuyPriceValue(buyPrice != null ? String(buyPrice) : "");
                            }}
                            className="p-1 rounded text-[var(--muted)] hover:text-[var(--accent)] hover:bg-[var(--accent)]/10 opacity-0 group-hover:opacity-100 transition-opacity"
                            title="구매가 수정"
                          >
                            <Pencil className="w-3 h-3" />
                          </button>
                        </>
                      )}
                    </div>

                    {/* 수익률 */}
                    {profitPct != null && (
                      <div className={`text-sm font-semibold ${profitPct >= 0 ? "text-red-400" : "text-blue-400"}`}>
                        {profitPct >= 0 ? "+" : ""}{profitPct.toFixed(2)}%
                      </div>
                    )}

                    {/* 삭제 버튼 */}
                    <button
                      onClick={() => removeFromWatchlist(item.symbol)}
                      className="p-1.5 rounded-lg text-[var(--muted)] hover:text-red-400 hover:bg-red-900/20 transition-colors opacity-0 group-hover:opacity-100"
                      title="삭제"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
