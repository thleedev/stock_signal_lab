"use client";

import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { PriceSliderInput } from "./price-slider-input";
import { PortfolioSelector } from "./portfolio-selector";

interface Portfolio {
  id: number;
  name: string;
  is_default: boolean;
}

interface Props {
  mode: "buy" | "sell";
  isOpen: boolean;
  onClose: () => void;
  onSubmit: () => void;
  initialSymbol?: string;
  initialName?: string;
  initialPrice?: number;
  buyTradeId?: number;
  portfolios: Portfolio[];
}

export function TradeModal({
  mode,
  isOpen,
  onClose,
  onSubmit,
  initialSymbol,
  initialName,
  initialPrice,
  buyTradeId,
  portfolios,
}: Props) {
  const [symbol, setSymbol] = useState(initialSymbol ?? "");
  const [stockName, setStockName] = useState(initialName ?? "");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Array<{ symbol: string; name: string; current_price: number }>>([]);

  const [price, setPrice] = useState(initialPrice ?? 0);
  const [targetPrice, setTargetPrice] = useState(0);
  const [stopPrice, setStopPrice] = useState(0);
  const [selectedPortfolioId, setSelectedPortfolioId] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Reset all state when modal opens
  useEffect(() => {
    if (!isOpen) return;
    setNote("");
    setSearchQuery("");
    setSearchResults([]);
    // "전체" (기본 포트)는 뷰 전용 → 비기본 포트 중 첫 번째 자동 선택
    const userPorts = portfolios.filter((p) => !p.is_default);
    setSelectedPortfolioId(userPorts[0]?.id ?? null);

    if (initialPrice) {
      setPrice(initialPrice);
      setTargetPrice(Math.round(initialPrice * 1.10));
      setStopPrice(Math.round(initialPrice * 0.95));
    } else {
      setPrice(0);
      setTargetPrice(0);
      setStopPrice(0);
    }
    if (initialSymbol) {
      setSymbol(initialSymbol);
      setStockName(initialName ?? "");
      // initialPrice 없으면 현재가 조회
      if (!initialPrice) {
        fetch(`/api/v1/user-portfolio/search?q=${encodeURIComponent(initialSymbol)}`)
          .then((r) => r.json())
          .then((data) => {
            const match = (data.stocks ?? []).find((s: { symbol: string }) => s.symbol === initialSymbol);
            if (match?.current_price) {
              setPrice(match.current_price);
              setTargetPrice(Math.round(match.current_price * 1.10));
              setStopPrice(Math.round(match.current_price * 0.95));
            }
          })
          .catch(() => {});
      }
    } else {
      setSymbol("");
      setStockName("");
    }
  }, [isOpen, initialPrice, initialSymbol, initialName, portfolios]);

  const handleSearch = async (query: string) => {
    setSearchQuery(query);
    if (query.length < 2) {
      setSearchResults([]);
      return;
    }
    try {
      const res = await fetch(`/api/v1/user-portfolio/search?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      setSearchResults(data.stocks ?? []);
    } catch {
      setSearchResults([]);
    }
  };

  const selectStock = (stock: { symbol: string; name: string; current_price: number }) => {
    setSymbol(stock.symbol);
    setStockName(stock.name);
    setPrice(stock.current_price);
    setTargetPrice(Math.round(stock.current_price * 1.10));
    setStopPrice(Math.round(stock.current_price * 0.95));
    setSearchQuery("");
    setSearchResults([]);
  };

  const handleSubmit = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);

    try {
      const body: Record<string, unknown> = {
        portfolio_id: selectedPortfolioId,
        symbol,
        name: stockName,
        side: mode.toUpperCase(),
        price,
      };

      if (mode === "buy") {
        if (targetPrice > 0) body.target_price = targetPrice;
        if (stopPrice > 0) body.stop_price = stopPrice;
      }
      if (mode === "sell") {
        body.buy_trade_id = buyTradeId;
      }
      if (note.trim()) body.note = note.trim();

      const res = await fetch("/api/v1/user-portfolio/trades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json();
        alert(err.error ?? "오류가 발생했습니다");
        return;
      }

      onSubmit();
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl shadow-2xl w-full max-w-sm mx-4 max-h-[90vh] overflow-y-auto p-5">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-bold text-[var(--foreground)]">
            {mode === "buy" ? "포트에 추가" : "종목 매도"}
          </h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--card-hover)]">
            <X className="w-4 h-4 text-[var(--muted)]" />
          </button>
        </div>

        {/* Stock search (buy mode, no initial symbol) */}
        {mode === "buy" && !initialSymbol && (
          <div className="mb-4">
            <div className="text-xs text-[var(--muted)] mb-1">종목 검색</div>
            <input
              type="text"
              value={symbol ? `${stockName} (${symbol})` : searchQuery}
              onChange={(e) => {
                if (symbol) {
                  setSymbol("");
                  setStockName("");
                }
                handleSearch(e.target.value);
              }}
              placeholder="종목명 또는 종목코드"
              className="w-full border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] rounded-lg px-3 py-2.5 text-sm placeholder:text-[var(--muted)] focus:outline-none focus:border-[var(--accent)]"
            />
            {searchResults.length > 0 && (
              <div className="border border-[var(--border)] bg-[var(--card)] rounded-lg mt-1 max-h-32 overflow-y-auto shadow-xl">
                {searchResults.slice(0, 5).map((stock) => (
                  <button
                    key={stock.symbol}
                    onClick={() => selectStock(stock)}
                    className="w-full text-left px-3 py-2.5 text-sm hover:bg-[var(--card-hover)] border-b border-[var(--border)] last:border-0 transition-colors"
                  >
                    <span className="font-medium">{stock.name}</span>
                    <span className="text-[var(--muted)]"> ({stock.symbol})</span>
                    <span className="text-[var(--muted)]"> — {stock.current_price?.toLocaleString()}원</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Stock display (auto-filled or sell mode) */}
        {(initialSymbol || mode === "sell") && symbol && (
          <div className="mb-4 px-3 py-2.5 bg-[var(--background)] rounded-lg text-sm border border-[var(--border)]">
            <span className="font-medium">{stockName}</span>
            <span className="text-[var(--muted)]"> ({symbol})</span>
          </div>
        )}

        {/* Price inputs */}
        {price > 0 && (
          <>
            <PriceSliderInput
              basePrice={initialPrice ?? price}
              value={price}
              onChange={setPrice}
              presets={[-10, -5, 0, 5, 10]}
              sliderRange={[-15, 15]}
              label={mode === "buy" ? "현재가" : "매도가"}
              color="green"
            />

            {mode === "buy" && (
              <>
                <PriceSliderInput
                  basePrice={price}
                  value={targetPrice}
                  onChange={setTargetPrice}
                  presets={[5, 10, 15, 20, 30]}
                  sliderRange={[5, 30]}
                  label="목표가"
                  color="red"
                  optional
                />
                <PriceSliderInput
                  basePrice={price}
                  value={stopPrice}
                  onChange={setStopPrice}
                  presets={[-3, -5, -7, -10, -15]}
                  sliderRange={[-20, -3]}
                  label="손절가"
                  color="blue"
                  optional
                />
              </>
            )}
          </>
        )}

        {/* Portfolio selector (buy mode) */}
        {mode === "buy" && (
          <div className="mb-3">
            {portfolios.filter((p) => !p.is_default).length > 0 ? (
              <PortfolioSelector
                portfolios={portfolios}
                selectedId={selectedPortfolioId}
                onChange={setSelectedPortfolioId}
              />
            ) : (
              <div className="text-xs text-amber-400 bg-amber-900/20 border border-amber-800/30 rounded-lg px-3 py-2">
                포트를 먼저 생성해주세요. (포트 종목 탭에서 + 버튼)
              </div>
            )}
          </div>
        )}

        {/* Memo */}
        <div className="mb-4">
          <div className="text-xs text-[var(--muted)] mb-1">매매 메모 (선택)</div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="매매 이유, AI 신호 참고 사항 등..."
            className="w-full border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] rounded-lg px-3 py-2 text-sm h-16 resize-none placeholder:text-[var(--muted)] focus:outline-none focus:border-[var(--accent)]"
          />
        </div>

        {/* Submit button */}
        <button
          onClick={handleSubmit}
          disabled={isSubmitting || !symbol || !price || (mode === "buy" && !selectedPortfolioId)}
          className={`w-full py-3 rounded-lg text-white font-semibold text-sm transition-colors ${
            mode === "buy"
              ? "bg-red-600 hover:bg-red-700 disabled:bg-red-900/50 disabled:text-red-300"
              : "bg-blue-600 hover:bg-blue-700 disabled:bg-blue-900/50 disabled:text-blue-300"
          }`}
        >
          {isSubmitting ? "처리 중..." : mode === "buy" ? "추가 확인" : "매도 확인"}
        </button>
      </div>
    </div>
  );
}
