"use client";

import { useState, useCallback } from "react";
import StockPriceHeader from "./stock-price-header";
import StockPortfolioOverlay from "./stock-portfolio-overlay";
import StockChartSection from "@/components/charts/stock-chart-section";
import type { PortfolioOverlay } from "@/components/charts/candle-chart";
import type { SignalMarker } from "@/components/charts/stock-chart-section";

interface PriceData {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface Props {
  symbol: string;
  stockName: string;
  currentPrice: number | null;
  priceChange: number;
  priceChangePct: string;
  priceDate: string;
  prices: PriceData[];
  signalDates: string[];
  signalMarkers: SignalMarker[];
}

export default function StockDetailClient({
  symbol,
  stockName,
  currentPrice,
  priceChange,
  priceChangePct,
  priceDate,
  prices,
  signalDates,
  signalMarkers,
}: Props) {
  const [overlays, setOverlays] = useState<PortfolioOverlay[]>([]);
  const [showBuyModal, setShowBuyModal] = useState(false);

  const handleOverlaysChange = useCallback((newOverlays: PortfolioOverlay[]) => {
    setOverlays(newOverlays);
  }, []);

  return (
    <>
      <StockPriceHeader
        symbol={symbol}
        initialPrice={currentPrice}
        initialChange={priceChange}
        initialChangePct={priceChangePct}
        priceDate={priceDate}
        onBuyClick={() => setShowBuyModal(true)}
      />

      <div className="mt-6">
        <StockPortfolioOverlay
          symbol={symbol}
          stockName={stockName}
          currentPrice={currentPrice}
          onOverlaysChange={handleOverlaysChange}
          showBuyModal={showBuyModal}
          onBuyModalClose={() => setShowBuyModal(false)}
        />
        <StockChartSection
          prices={prices}
          signalDates={signalDates}
          signalMarkers={signalMarkers}
          portfolioOverlays={overlays}
        />
      </div>
    </>
  );
}
