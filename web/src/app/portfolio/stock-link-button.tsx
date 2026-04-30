"use client";

import { useStockModal } from "@/contexts/stock-modal-context";
import { calcGrade } from "@/lib/unified-scoring/types";

interface Props {
  symbol: string;
  name: string;
  quantity: number;
  price: number;
  score?: number | null;
}

function getGradeStyle(score: number): { badge: string; label: string } {
  if (score >= 90) return { badge: "bg-red-600 text-white",       label: "적극매수" };
  if (score >= 80) return { badge: "bg-red-500 text-white",       label: "매수"     };
  if (score >= 65) return { badge: "bg-orange-400 text-white",    label: "관심"     };
  if (score >= 50) return { badge: "bg-yellow-400 text-gray-900", label: "보통"     };
  if (score >= 35) return { badge: "bg-gray-400 text-white",      label: "관망"     };
  return                   { badge: "bg-gray-600 text-gray-200",  label: "주의"     };
}

export function StockLinkButton({ symbol, name, quantity, price, score }: Props) {
  const { openStockModal } = useStockModal();
  const hasScore = typeof score === "number";
  const gradeStyle = hasScore ? getGradeStyle(score!) : null;
  const grade = hasScore ? calcGrade(score!) : null;

  return (
    <button
      onClick={() => openStockModal(symbol, name)}
      className="w-full flex items-center justify-between px-4 py-3 hover:bg-[var(--card-hover)] transition-colors text-left gap-3"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium truncate">{name}</span>
          {gradeStyle && grade && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold tabular-nums ${gradeStyle.badge}`}>
              {grade} · {Math.round(score!)} · {gradeStyle.label}
            </span>
          )}
        </div>
        <div className="text-xs text-[var(--muted)] mt-0.5">
          {symbol} · {quantity}주
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className="text-sm font-medium">
          {price.toLocaleString()}원
        </div>
        <div className="text-xs text-[var(--muted)]">
          매수가
        </div>
      </div>
    </button>
  );
}
