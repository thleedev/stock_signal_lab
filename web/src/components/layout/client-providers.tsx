"use client";

import { ReactNode } from "react";
import { StockModalProvider } from "@/contexts/stock-modal-context";

export function ClientProviders({ children }: { children: ReactNode }) {
  return <StockModalProvider>{children}</StockModalProvider>;
}
