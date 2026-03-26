"use client";

import { createContext, useContext, useState, useCallback, ReactNode } from "react";
import { StockDetailModal } from "@/components/stock-modal/StockDetailModal";
import type { StockRankItem } from "@/app/api/v1/stock-ranking/route";

interface StockModalState {
  symbol: string;
  name: string;
  initialData?: StockRankItem;
}

interface StockModalContextValue {
  modal: StockModalState | null;
  openStockModal: (symbol: string, name?: string, initialData?: StockRankItem) => void;
  closeStockModal: () => void;
}

const StockModalContext = createContext<StockModalContextValue | null>(null);

export function StockModalProvider({ children }: { children: ReactNode }) {
  const [modal, setModal] = useState<StockModalState | null>(null);

  const openStockModal = useCallback(
    (symbol: string, name = "", initialData?: StockRankItem) => {
      setModal({ symbol, name, initialData });
    },
    []
  );

  const closeStockModal = useCallback(() => {
    setModal(null);
  }, []);

  return (
    <StockModalContext.Provider value={{ modal, openStockModal, closeStockModal }}>
      {children}
      {/* StockDetailPanel은 Task 6에서 연결 — 지금은 기존 StockDetailModal 유지 */}
      <StockDetailModal />
    </StockModalContext.Provider>
  );
}

export function useStockModal() {
  const ctx = useContext(StockModalContext);
  if (!ctx) throw new Error("useStockModal must be used within StockModalProvider");
  return ctx;
}
