"use client";

/** 종목 상세 패널 상단 헤더 — 종목명, 심볼, 현재가, 등락, 등급 배지 표시 */

/** 등급별 배경·글자색 매핑 */
const GRADE_COLORS: Record<string, string> = {
  "A+": "bg-red-500 text-white",
  A: "bg-red-400 text-white",
  "B+": "bg-orange-500 text-white",
  B: "bg-orange-400 text-white",
  C: "bg-yellow-500 text-black",
  D: "bg-[var(--muted)] text-black",
};

interface Props {
  symbol: string;
  name: string;
  currentPrice: number;
  changeAmount: number;
  changePct: number;
  grade?: string;
  recommendation?: string;
  onClose: () => void;
}

export function PanelHeader({
  symbol,
  name,
  currentPrice,
  changeAmount,
  changePct,
  grade,
  recommendation,
  onClose,
}: Props) {
  const isUp = changeAmount >= 0;

  return (
    <div className="sticky top-0 z-10 bg-[var(--card)] border-b border-[var(--border)] px-4 py-3">
      <div className="flex items-start justify-between">
        <div>
          {/* 종목명, 심볼, 등급 배지, 추천 텍스트 */}
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold">{name}</h2>
            <span className="text-sm text-[var(--muted)]">{symbol}</span>
            {grade && (
              <span
                className={`px-1.5 py-0.5 text-xs font-bold rounded ${
                  GRADE_COLORS[grade] ?? "bg-[var(--muted)] text-black"
                }`}
              >
                {grade}
              </span>
            )}
            {recommendation && (
              <span className="text-xs text-[var(--muted)]">{recommendation}</span>
            )}
          </div>

          {/* 현재가 및 등락 */}
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-2xl font-bold">
              {currentPrice.toLocaleString()}원
            </span>
            <span
              className={`text-sm font-medium ${
                isUp ? "text-[var(--buy)]" : "text-[var(--sell)]"
              }`}
            >
              {isUp ? "▲" : "▼"} {Math.abs(changeAmount).toLocaleString()}
              ({isUp ? "+" : ""}
              {changePct.toFixed(2)}%)
            </span>
          </div>
        </div>

        {/* 닫기 버튼 */}
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-[var(--card-hover)] text-[var(--muted)] text-xl leading-none"
          aria-label="닫기"
        >
          ×
        </button>
      </div>
    </div>
  );
}
