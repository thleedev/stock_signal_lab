import Link from "next/link";

const SOURCE_COLORS: Record<string, { card: string; text: string }> = {
  lassi: { card: "bg-red-900/30 border-red-800/50", text: "text-red-400" },
  stockbot: { card: "bg-green-900/30 border-green-800/50", text: "text-green-400" },
  quant: { card: "bg-blue-900/30 border-blue-800/50", text: "text-blue-400" },
};

const SOURCE_LABELS: Record<string, string> = {
  lassi: "라씨매매",
  stockbot: "스톡봇",
  quant: "퀀트",
};

interface Props {
  source: "lassi" | "stockbot" | "quant";
  buy: number;
  sell: number;
  total: number;
}

export function SignalSummaryCard({ source, buy, sell, total }: Props) {
  const colors = SOURCE_COLORS[source];

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
