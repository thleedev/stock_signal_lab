import Link from "next/link";
import { SOURCE_CARD_COLORS, SOURCE_LABELS } from "@/lib/signal-constants";

interface Props {
  source: "lassi" | "stockbot" | "quant";
  buy: number;
  sell: number;
  total: number;
}

export function SignalSummaryCard({ source, buy, sell, total }: Props) {
  const colors = SOURCE_CARD_COLORS[source];

  return (
    <Link
      href={`/signals?source=${source}`}
      className={`card p-4 border ${colors.card} hover:brightness-110 transition-all cursor-pointer`}
    >
      <div className={`text-sm font-medium mb-2 ${colors.text}`}>
        {SOURCE_LABELS[source]}
      </div>
      <div className={`text-3xl font-bold ${colors.text}`}>{total}</div>
      <div className="text-sm mt-1 text-[var(--muted)]">
        매수 {buy} / 매도 {sell}
      </div>
      <div className="text-xs text-[var(--muted)] mt-2">신호 보기 →</div>
    </Link>
  );
}
