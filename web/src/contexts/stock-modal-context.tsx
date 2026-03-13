"use client";

import { createContext, useContext, useState, useCallback, ReactNode } from "react";
import { StockDetailModal } from "@/components/stock-modal/StockDetailModal";

interface StockModalState {
  symbol: string;
  name: string;
}

interface StockModalContextValue {
  modal: StockModalState | null;
  openStockModal: (symbol: string, name?: string) => void;
  closeStockModal: () => void;
}

const StockModalContext = createContext<StockModalContextValue | null>(null);

export function StockModalProvider({ children }: { children: ReactNode }) {
  const [modal, setModal] = useState<StockModalState | null>(null);

  const openStockModal = useCallback((symbol: string, name = "") => {
    setModal({ symbol, name });
  }, []);

  const closeStockModal = useCallback(() => {
    setModal(null);
  }, []);

  return (
    <StockModalContext.Provider value={{ modal, openStockModal, closeStockModal }}>
      {children}
      <StockDetailModal />
    </StockModalContext.Provider>
  );
}

export function useStockModal() {
  const ctx = useContext(StockModalContext);
  if (!ctx) throw new Error("useStockModal must be used within StockModalProvider");
  return ctx;
}
