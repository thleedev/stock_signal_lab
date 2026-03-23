"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useStockModal } from "@/contexts/stock-modal-context";
import { Search, X, Plus, Pencil, Check, BarChart3 } from "lucide-react";
import { usePriceRefresh } from "@/hooks/use-price-refresh";
import { PageLayout, PageHeader } from "@/components/ui";
import { PortfolioTabs } from "./components/portfolio-tabs";
import { TradeModal } from "./components/trade-modal";
import { PerformanceChart } from "./components/performance-chart";

interface Portfolio {
  id: number;
  name: string;
  is_default: boolean;
  sort_order: number;
}

interface Holding {
  trade_id: number;
  portfolio_id: number;
  symbol: string;
  name: string;
  buy_price: number;
  current_price: number;
  return_pct: number;
  target_price: number | null;
  stop_price: number | null;
  status: string;
  note: string | null;
  bought_at: string;
  latest_signal: { type: string; source: string; date: string } | null;
}

interface Summary {
  current_return_pct: number;
  total_return_pct: number;
  holding_count: number;
  completed_trade_count: number;
}

interface SearchResult {
  symbol: string;
  name: string;
  market: string;
  current_price?: number | null;
}

type EditField = "target_price" | "stop_price";

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

export default function MyPortfolioPage() {
  const { openStockModal } = useStockModal();

  // 포트 상태
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [activePortfolioId, setActivePortfolioId] = useState<number | null>(null);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [summary, setSummary] = useState<Summary>({ current_return_pct: 0, total_return_pct: 0, holding_count: 0, completed_trade_count: 0 });

  // 실시간 가격
  const symbols = useMemo(() => holdings.map((h) => h.symbol), [holdings]);
  const { prices: livePrices } = usePriceRefresh(symbols);

  // 검색 상태
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // 인라인 편집 상태
  const [editing, setEditing] = useState<{ tradeId: number; field: EditField } | null>(null);
  const [editValue, setEditValue] = useState("");

  // TradeModal 상태
  const [tradeModalOpen, setTradeModalOpen] = useState(false);
  const [tradeMode, setTradeMode] = useState<"buy" | "sell">("buy");
  const [tradeInitial, setTradeInitial] = useState<{ symbol?: string; name?: string; price?: number; buyTradeId?: number }>({});

  // 종목 제거 확인 모달
  const [removeTarget, setRemoveTarget] = useState<Holding | null>(null);
  const [sellPrice, setSellPrice] = useState("");

  // 성과 비교 팝업
  const [showPerformance, setShowPerformance] = useState(false);

  // 드롭다운 외부 클릭 닫기
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // 포트 목록 조회
  const fetchPortfolios = useCallback(async () => {
    const res = await fetch("/api/v1/user-portfolio");
    const data = await res.json();
    setPortfolios(data.portfolios ?? []);
  }, []);

  // 보유 종목 조회
  const fetchHoldings = useCallback(async () => {
    const params = activePortfolioId ? `?portfolio_id=${activePortfolioId}` : "";
    const res = await fetch(`/api/v1/user-portfolio/holdings${params}`);
    const data = await res.json();
    setHoldings(data.holdings ?? []);
    setSummary(data.summary ?? { current_return_pct: 0, total_return_pct: 0, holding_count: 0, completed_trade_count: 0 });
  }, [activePortfolioId]);

  useEffect(() => { fetchPortfolios(); }, [fetchPortfolios]);
  useEffect(() => { fetchHoldings(); }, [fetchHoldings]);

  // 검색
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
      } catch (e) {
        console.error("[MyPortfolio]", e);
      } finally {
        setIsSearching(false);
      }
    }, 300);
  }, []);

  // 종목 선택 → TradeModal 열기
  const handleSelectStock = useCallback((result: SearchResult) => {
    setTradeInitial({
      symbol: result.symbol,
      name: result.name,
      price: result.current_price ?? undefined,
    });
    setTradeMode("buy");
    setTradeModalOpen(true);
    setShowDropdown(false);
    setSearchQuery("");
  }, []);

  // 종목 제거 모달 열기 (X 버튼)
  const handleRemoveClick = useCallback((holding: Holding) => {
    const live = livePrices[holding.symbol];
    const currentPrice = live?.current_price ?? holding.current_price;
    // 거래세 0.20% + 수수료 0.015% ≈ 0.25% 차감
    const netPrice = Math.round(currentPrice * (1 - 0.0025));
    setSellPrice(String(netPrice));
    setRemoveTarget(holding);
  }, [livePrices]);

  // 거래 완료 (매도 처리)
  const handleSellComplete = useCallback(async () => {
    if (!removeTarget) return;
    const price = parseInt(sellPrice, 10);
    if (!price || price <= 0) return;
    try {
      await fetch("/api/v1/user-portfolio/trades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          portfolio_id: removeTarget.portfolio_id,
          symbol: removeTarget.symbol,
          name: removeTarget.name,
          side: "SELL",
          price,
          buy_trade_id: removeTarget.trade_id,
        }),
      });
      fetchHoldings();
    } catch (e) {
      console.error("[MyPortfolio] 매도 실패:", e);
    } finally {
      setRemoveTarget(null);
    }
  }, [removeTarget, sellPrice, fetchHoldings]);

  // 단순 삭제 (거래 기록 없이 제거)
  const handleSimpleDelete = useCallback(async () => {
    if (!removeTarget) return;
    try {
      await fetch(`/api/v1/user-portfolio/trades?trade_id=${removeTarget.trade_id}`, {
        method: "DELETE",
      });
      fetchHoldings();
    } catch (e) {
      console.error("[MyPortfolio] 삭제 실패:", e);
    } finally {
      setRemoveTarget(null);
    }
  }, [removeTarget, fetchHoldings]);

  // 종목 → 다른 포트 이동 (드래그앤드롭)
  const handleMoveStock = useCallback(async (tradeId: number, toPortfolioId: number) => {
    try {
      await fetch("/api/v1/user-portfolio/trades", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trade_id: tradeId, portfolio_id: toPortfolioId }),
      });
      fetchHoldings();
    } catch (e) {
      console.error("[MyPortfolio] 포트 이동 실패:", e);
    }
  }, [fetchHoldings]);

  // 인라인 편집
  const startEdit = useCallback((tradeId: number, field: EditField, currentValue: number | null) => {
    setEditing({ tradeId, field });
    setEditValue(currentValue != null ? String(currentValue) : "");
  }, []);

  const saveEdit = useCallback(async () => {
    if (!editing) return;
    const parsedPrice = editValue.trim() ? parseInt(editValue.trim(), 10) : null;

    try {
      await fetch("/api/v1/user-portfolio/trades", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trade_id: editing.tradeId, [editing.field]: parsedPrice }),
      });

      setHoldings((prev) =>
        prev.map((h) =>
          h.trade_id === editing.tradeId ? { ...h, [editing.field]: parsedPrice } : h
        )
      );
    } catch (e) {
      console.error("[MyPortfolio] 저장 실패:", e);
    } finally {
      setEditing(null);
      setEditValue("");
    }
  }, [editing, editValue]);

  // 편집 가능한 가격 렌더링
  const renderEditablePrice = (
    holding: Holding,
    field: EditField,
    label: string,
    colorClass?: string
  ) => {
    const value = holding[field];
    const isEditing = editing?.tradeId === holding.trade_id && editing?.field === field;

    if (isEditing) {
      const buyPrice = holding.buy_price;
      const pctButtons = field === "target_price" ? [5, 10, 15, 20] : [-3, -5, -7, -10];

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
        </div>
      );
    }

    return (
      <div className="flex items-center gap-0.5 justify-end group/edit">
        <span className={`tabular-nums ${colorClass ?? ""}`}>
          {value != null ? formatNumber(value) : "-"}
        </span>
        <button
          onClick={(e) => { e.preventDefault(); startEdit(holding.trade_id, field, value); }}
          className="p-0.5 rounded text-[var(--muted)] hover:text-[var(--accent)] opacity-0 group-hover/edit:opacity-100 transition-opacity"
        >
          <Pencil className="w-2.5 h-2.5" />
        </button>
      </div>
    );
  };

  const isCurrentPositive = summary.current_return_pct >= 0;
  const isTotalPositive = summary.total_return_pct >= 0;

  return (
    <PageLayout>
      {/* 헤더 + 요약 */}
      <PageHeader
        title="포트 종목"
        subtitle="포트폴리오 관리"
        action={
          <div className="flex items-center gap-5">
            <div className="text-right">
              <div className="text-[10px] text-[var(--muted)]">현재수익률</div>
              <div className={`text-lg font-bold tabular-nums ${isCurrentPositive ? "text-red-400" : "text-blue-400"}`}>
                {isCurrentPositive ? "+" : ""}{summary.current_return_pct.toFixed(1)}%
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] text-[var(--muted)]">총수익률</div>
              <div className={`text-lg font-bold tabular-nums ${isTotalPositive ? "text-red-400" : "text-blue-400"}`}>
                {isTotalPositive ? "+" : ""}{summary.total_return_pct.toFixed(1)}%
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] text-[var(--muted)]">보유 종목</div>
              <div className="text-lg font-bold">{summary.holding_count}</div>
            </div>
            <div className="text-right">
              <div className="text-[10px] text-[var(--muted)]">완료 거래</div>
              <div className="text-lg font-bold">{summary.completed_trade_count}</div>
            </div>
            <button
              onClick={() => setShowPerformance(true)}
              className="p-2 rounded-lg bg-[var(--card)] border border-[var(--border)] hover:border-[var(--accent)] transition-colors"
              title="포트 성과 비교"
            >
              <BarChart3 className="w-4 h-4 text-[var(--muted)]" />
            </button>
          </div>
        }
      />

      {/* 포트 탭 */}
      <div className="card overflow-hidden">
        <PortfolioTabs
          portfolios={portfolios}
          activeId={activePortfolioId}
          onSelect={setActivePortfolioId}
          onPortfoliosChange={fetchPortfolios}
          onMoveStock={handleMoveStock}
        />
      </div>

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
                const alreadyAdded = holdings.some((h) => h.symbol === result.symbol);
                return (
                  <button
                    key={result.symbol}
                    onClick={() => handleSelectStock(result)}
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

      {/* 보유 종목 테이블 */}
      {holdings.length === 0 ? (
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
                  <th className="hidden md:table-cell px-3 py-3 text-left">코드</th>
                  <th className="px-3 py-3 text-right">현재가</th>
                  <th className="px-3 py-3 text-right">등락률</th>
                  <th className="hidden sm:table-cell px-3 py-3 text-right">매수가</th>
                  <th className="hidden md:table-cell px-3 py-3 text-right">손절가</th>
                  <th className="hidden md:table-cell px-3 py-3 text-right">목표가</th>
                  <th className="px-3 py-3 text-right">수익률</th>
                  <th className="px-3 py-3 text-center w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {holdings.map((h) => {
                  const live = livePrices[h.symbol];
                  const currentPrice = live?.current_price ?? h.current_price;
                  const change = live?.price_change_pct ?? null;
                  const profitPct = ((currentPrice - h.buy_price) / h.buy_price) * 100;

                  const nearStopLoss = h.stop_price && currentPrice ? currentPrice <= h.stop_price : false;
                  const nearTarget = h.target_price && currentPrice ? currentPrice >= h.target_price : false;

                  const hasSellSignal =
                    h.latest_signal &&
                    (h.latest_signal.type === "SELL" || h.latest_signal.type === "SELL_COMPLETE");

                  return (
                    <tr
                      key={h.trade_id}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/trade-id", String(h.trade_id));
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      className={`hover:bg-[var(--card-hover)] transition-colors group cursor-grab active:cursor-grabbing ${
                        nearStopLoss ? "bg-blue-900/10" : nearTarget ? "bg-red-900/10" : ""
                      }`}
                    >
                      <td className="px-3 py-2.5">
                        <button
                          onClick={() => openStockModal(h.symbol, h.name)}
                          className="font-medium hover:text-[var(--accent)] text-left"
                        >
                          {h.name} {hasSellSignal && "⚠️"}
                        </button>
                        {hasSellSignal && (
                          <div className="text-[10px] text-amber-400">AI 매도신호</div>
                        )}
                      </td>
                      <td className="hidden md:table-cell px-3 py-2.5 text-[var(--muted)] text-xs">
                        {h.symbol}
                      </td>
                      <td className={`px-3 py-2.5 text-right font-medium tabular-nums ${priceColor(live?.price_change ?? null)}`}>
                        {formatNumber(currentPrice)}
                      </td>
                      <td className={`px-3 py-2.5 text-right font-medium tabular-nums ${priceColor(change)}`}>
                        {formatPercent(change)}
                      </td>
                      <td className="hidden sm:table-cell px-3 py-2.5 text-right tabular-nums">
                        {formatNumber(h.buy_price)}
                      </td>
                      <td className="hidden md:table-cell px-3 py-2.5 text-right text-sm">
                        {renderEditablePrice(
                          h,
                          "stop_price",
                          "손절가",
                          nearStopLoss ? "text-blue-400 font-semibold" : "text-[var(--muted)]"
                        )}
                      </td>
                      <td className="hidden md:table-cell px-3 py-2.5 text-right text-sm">
                        {renderEditablePrice(
                          h,
                          "target_price",
                          "목표가",
                          nearTarget ? "text-red-400 font-semibold" : "text-[var(--muted)]"
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        <span className={`text-sm font-semibold ${profitPct >= 0 ? "text-red-400" : "text-blue-400"}`}>
                          {profitPct >= 0 ? "+" : ""}{profitPct.toFixed(2)}%
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <button
                          onClick={() => handleRemoveClick(h)}
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
            총 {holdings.length}개 종목
          </div>
        </div>
      )}

      {/* 종목 제거 확인 모달 */}
      {removeTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl shadow-2xl w-full max-w-xs mx-4 p-5">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-base font-bold">{removeTarget.name}</h3>
              <button onClick={() => setRemoveTarget(null)} className="p-1 rounded hover:bg-[var(--card-hover)]">
                <X className="w-4 h-4 text-[var(--muted)]" />
              </button>
            </div>

            <div className="text-xs text-[var(--muted)] mb-1">
              매도가 (세금·수수료 0.25% 차감)
            </div>
            <input
              type="number"
              value={sellPrice}
              onChange={(e) => setSellPrice(e.target.value)}
              className="w-full border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] rounded-lg px-3 py-2 text-sm mb-4 focus:outline-none focus:border-[var(--accent)] tabular-nums"
            />

            <div className="flex gap-2">
              <button
                onClick={handleSellComplete}
                className="flex-1 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors"
              >
                거래 완료
              </button>
              <button
                onClick={handleSimpleDelete}
                className="flex-1 py-2.5 rounded-lg bg-[var(--card-hover)] hover:bg-[var(--border)] text-[var(--foreground)] text-sm font-semibold transition-colors"
              >
                단순 삭제
              </button>
            </div>

            <p className="text-[10px] text-[var(--muted)] mt-2 text-center">
              거래 완료: 매도 기록 저장 · 단순 삭제: 기록 없이 제거
            </p>
          </div>
        </div>
      )}

      {/* TradeModal */}
      <TradeModal
        mode={tradeMode}
        isOpen={tradeModalOpen}
        onClose={() => setTradeModalOpen(false)}
        onSubmit={fetchHoldings}
        initialSymbol={tradeInitial.symbol}
        initialName={tradeInitial.name}
        initialPrice={tradeInitial.price}
        buyTradeId={tradeInitial.buyTradeId}
        portfolios={portfolios}
      />

      {/* 포트 성과 비교 팝업 */}
      {showPerformance && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl shadow-2xl w-full max-w-2xl mx-4 max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-center px-4 pt-4">
              <h2 className="text-lg font-bold">포트 성과 비교</h2>
              <button
                onClick={() => setShowPerformance(false)}
                className="p-1 rounded hover:bg-[var(--card-hover)]"
              >
                <X className="w-4 h-4 text-[var(--muted)]" />
              </button>
            </div>
            <PerformanceChart portfolioId={activePortfolioId ?? undefined} />
          </div>
        </div>
      )}
    </PageLayout>
  );
}
