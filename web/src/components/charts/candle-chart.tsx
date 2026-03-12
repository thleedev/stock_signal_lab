"use client";

import { useEffect, useRef } from "react";
import { createChart, type IChartApi, type CandlestickData, type Time } from "lightweight-charts";

interface PriceData {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface SignalMarker {
  date: string;
  type: "BUY" | "BUY_FORECAST" | "SELL" | "SELL_COMPLETE";
  source: string;
}

const SOURCE_SHORT: Record<string, string> = {
  lassi: "라",
  stockbot: "봇",
  quant: "퀀",
};

export interface PortfolioOverlay {
  portfolioName: string;
  color: string;
  markers: Array<{
    date: string;
    side: "BUY" | "SELL";
    price: number;
  }>;
  priceLines: Array<{
    price: number;
    label: string;
    style: "solid" | "dashed";
  }>;
}

interface Props {
  data: PriceData[];
  signalDates?: Set<string>;
  signalMarkers?: SignalMarker[];
  portfolioOverlays?: PortfolioOverlay[];
  height?: number;
}

export default function CandleChart({ data, signalDates, signalMarkers, portfolioOverlays, height = 300 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!containerRef.current || data.length === 0) return;

    const chart = createChart(containerRef.current, {
      height,
      layout: {
        background: { color: "transparent" },
        textColor: "#94a3b8",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "rgba(30, 41, 59, 0.5)" },
        horzLines: { color: "rgba(30, 41, 59, 0.5)" },
      },
      crosshair: {
        mode: 0,
      },
      rightPriceScale: {
        borderColor: "#1e293b",
      },
      timeScale: {
        borderColor: "#1e293b",
        timeVisible: false,
      },
    });

    chartRef.current = chart;

    const candleSeries = chart.addCandlestickSeries({
      upColor: "#dc2626",
      downColor: "#2563eb",
      borderUpColor: "#dc2626",
      borderDownColor: "#2563eb",
      wickUpColor: "#dc2626",
      wickDownColor: "#2563eb",
    });

    const candleData: CandlestickData<Time>[] = data.map((d) => ({
      time: d.date as Time,
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
    }));

    candleSeries.setData(candleData);

    // 매수/매도 마커
    if (signalMarkers && signalMarkers.length > 0) {
      const dateSet = new Set(data.map((d) => d.date));
      const markers = signalMarkers
        .filter((m) => dateSet.has(m.date))
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((m) => {
          const isBuy = m.type === "BUY" || m.type === "BUY_FORECAST";
          return {
            time: m.date as Time,
            position: isBuy ? ("belowBar" as const) : ("aboveBar" as const),
            color: isBuy ? "#ef4444" : "#3b82f6",
            shape: isBuy ? ("arrowUp" as const) : ("arrowDown" as const),
            text: SOURCE_SHORT[m.source] || m.source.charAt(0),
          };
        });
      candleSeries.setMarkers(markers);
    } else if (signalDates && signalDates.size > 0) {
      // fallback: 단순 날짜 마커
      const markers = data
        .filter((d) => signalDates.has(d.date))
        .map((d) => ({
          time: d.date as Time,
          position: "belowBar" as const,
          color: "#eab308",
          shape: "circle" as const,
          text: "",
        }));
      candleSeries.setMarkers(markers);
    }

    // portfolioOverlays 마커 + 프라이스 라인
    if (portfolioOverlays && portfolioOverlays.length > 0) {
      const dateSet = new Set(data.map((d) => d.date));
      const portMarkers = portfolioOverlays.flatMap((overlay) =>
        overlay.markers
          .filter((m) => dateSet.has(m.date))
          .map((m) => ({
            time: m.date as Time,
            position: m.side === "BUY" ? ("belowBar" as const) : ("aboveBar" as const),
            color: overlay.color,
            shape: m.side === "BUY" ? ("arrowUp" as const) : ("arrowDown" as const),
            text: `${overlay.portfolioName} ${m.side === "BUY" ? "매수" : "매도"}`,
          }))
      );

      // 기존 마커가 있으면 합치기
      if (portMarkers.length > 0) {
        // Re-get existing markers and merge
        const existingMarkers = signalMarkers
          ? signalMarkers
              .filter((m) => dateSet.has(m.date))
              .sort((a, b) => a.date.localeCompare(b.date))
              .map((m) => {
                const isBuy = m.type === "BUY" || m.type === "BUY_FORECAST";
                return {
                  time: m.date as Time,
                  position: isBuy ? ("belowBar" as const) : ("aboveBar" as const),
                  color: isBuy ? "#ef4444" : "#3b82f6",
                  shape: isBuy ? ("arrowUp" as const) : ("arrowDown" as const),
                  text: SOURCE_SHORT[m.source] || m.source.charAt(0),
                };
              })
          : [];

        const allMarkers = [...existingMarkers, ...portMarkers].sort((a, b) =>
          (a.time as string) > (b.time as string) ? 1 : -1
        );
        candleSeries.setMarkers(allMarkers);
      }

      // 프라이스 라인 추가
      for (const overlay of portfolioOverlays) {
        for (const pl of overlay.priceLines) {
          candleSeries.createPriceLine({
            price: pl.price,
            color: overlay.color,
            lineWidth: pl.style === "solid" ? 2 : 1,
            lineStyle: pl.style === "solid" ? 0 : 2,
            axisLabelVisible: true,
            title: pl.label,
          });
        }
      }
    }

    // 거래량
    const volumeSeries = chart.addHistogramSeries({
      color: "#334155",
      priceFormat: { type: "volume" as const },
      priceScaleId: "volume",
    });

    chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    volumeSeries.setData(
      data.map((d) => ({
        time: d.date as Time,
        value: d.volume,
        color: d.close >= d.open ? "rgba(220, 38, 38, 0.3)" : "rgba(37, 99, 235, 0.3)",
      }))
    );

    chart.timeScale().fitContent();

    const handleResize = () => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    };

    const observer = new ResizeObserver(handleResize);
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [data, signalDates, signalMarkers, portfolioOverlays, height]);

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center text-[var(--muted)]" style={{ height }}>
        시세 데이터가 없습니다
      </div>
    );
  }

  return <div ref={containerRef} />;
}
