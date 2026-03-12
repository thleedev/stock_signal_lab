"use client";

import { useCallback } from "react";

interface Props {
  basePrice: number;
  value: number;
  onChange: (price: number) => void;
  presets: number[];
  sliderRange: [number, number];
  label: string;
  color?: "red" | "blue" | "green";
  optional?: boolean;
}

export function PriceSliderInput({
  basePrice,
  value,
  onChange,
  presets,
  sliderRange,
  label,
  color = "green",
  optional = false,
}: Props) {
  const pctFromBase = basePrice > 0 ? ((value - basePrice) / basePrice) * 100 : 0;

  const colorMap = {
    red: { bg: "bg-red-50", border: "border-red-200", text: "text-red-600", slider: "accent-red-500" },
    blue: { bg: "bg-blue-50", border: "border-blue-200", text: "text-blue-600", slider: "accent-blue-500" },
    green: { bg: "bg-green-50", border: "border-green-200", text: "text-green-600", slider: "accent-green-500" },
  };
  const c = colorMap[color];

  const handleSlider = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const pct = parseFloat(e.target.value);
      onChange(Math.round(basePrice * (1 + pct / 100)));
    },
    [basePrice, onChange]
  );

  const handlePreset = useCallback(
    (pct: number) => {
      if (pct === 0) {
        onChange(basePrice);
      } else {
        onChange(Math.round(basePrice * (1 + pct / 100)));
      }
    },
    [basePrice, onChange]
  );

  const handleDirectInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value.replace(/[^0-9]/g, "");
      if (raw) onChange(parseInt(raw, 10));
    },
    [onChange]
  );

  const formatPrice = (p: number) => p.toLocaleString("ko-KR");

  return (
    <div className="mb-3">
      <div className="flex justify-between items-center mb-1">
        <span className="text-xs text-gray-400">
          {label} {optional && <span className="text-gray-300">(선택)</span>}
        </span>
        <span className={`text-xs ${c.text}`}>
          {pctFromBase >= 0 ? "+" : ""}{pctFromBase.toFixed(1)}%
        </span>
      </div>

      <input
        type="text"
        value={formatPrice(value)}
        onChange={handleDirectInput}
        className={`w-full text-center text-lg font-bold border ${c.border} rounded-lg p-2 mb-2`}
      />

      <input
        type="range"
        min={sliderRange[0]}
        max={sliderRange[1]}
        step={0.5}
        value={pctFromBase}
        onChange={handleSlider}
        className={`w-full mb-2 ${c.slider}`}
      />

      <div className="flex gap-1 justify-center">
        {presets.map((pct) => {
          const isActive = Math.abs(pctFromBase - pct) < 0.5;
          const btnLabel = pct === 0 ? "현재가" : `${pct > 0 ? "+" : ""}${pct}%`;
          return (
            <button
              key={pct}
              onClick={() => handlePreset(pct)}
              className={`px-2 py-1 rounded text-xs ${
                isActive
                  ? `${c.bg} ${c.text} font-bold border ${c.border}`
                  : "bg-gray-100 text-gray-500 hover:bg-gray-200"
              }`}
            >
              {btnLabel}
            </button>
          );
        })}
      </div>
    </div>
  );
}
