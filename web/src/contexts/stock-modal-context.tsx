"use client";

import { createContext, useContext, useState, useCallback, ReactNode } from "react";
import { StockDetailPanel } from "@/components/stock-modal/StockDetailPanel";
import type { StockRankItem } from "@/app/api/v1/stock-ranking/route";
import type { ShortTermDisplayScores } from "@/components/stock-modal/AiOpinionCard";

interface StockModalState {
  symbol: string;
  name: string;
  initialData?: StockRankItem;
  /** 점수 표시 모드: 종목추천(standard) / 단기추천(short_term) */
  scoreMode?: 'standard' | 'short_term';
  /** 단기추천 점수 (scoreMode='short_term'일 때) */
  shortTermScores?: ShortTermDisplayScores;
}

interface StockModalContextValue {
  modal: StockModalState | null;
  openStockModal: (symbol: string, name?: string, initialData?: StockRankItem, scoreMode?: 'standard' | 'short_term', shortTermScores?: ShortTermDisplayScores) => void;
  closeStockModal: () => void;
}

const StockModalContext = createContext<StockModalContextValue | null>(null);

export function StockModalProvider({ children }: { children: ReactNode }) {
  const [modal, setModal] = useState<StockModalState | null>(null);

  const openStockModal = useCallback(
    (symbol: string, name = "", initialData?: StockRankItem, scoreMode?: 'standard' | 'short_term', shortTermScores?: ShortTermDisplayScores) => {
      setModal({ symbol, name, initialData, scoreMode, shortTermScores });
    },
    []
  );

  const closeStockModal = useCallback(() => {
    setModal(null);
  }, []);

  return (
    <StockModalContext.Provider value={{ modal, openStockModal, closeStockModal }}>
      {children}
      <StockDetailPanel />
    </StockModalContext.Provider>
  );
}

export function useStockModal() {
  const ctx = useContext(StockModalContext);
  if (!ctx) throw new Error("useStockModal must be used within StockModalProvider");
  return ctx;
}
