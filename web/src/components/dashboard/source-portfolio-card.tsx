import Link from "next/link";

const SOURCE_META: Record<string, { label: string; color: string; cardColor: string }> = {
  lassi: {
    label: "라씨매매",
    color: "text-red-400",
    cardColor: "bg-red-900/20 border-red-800/50",
  },
  stockbot: {
    label: "스톡봇",
    color: "text-green-400",
    cardColor: "bg-green-900/20 border-green-800/50",
  },
  quant: {
    label: "퀀트",
    color: "text-blue-400",
    cardColor: "bg-blue-900/20 border-blue-800/50",
  },
};

interface Props {
  source: "lassi" | "stockbot" | "quant";
  totalValue: number | null;
  holdingCount: number;
  returnPct: number | null;
}

export function SourcePortfolioCard({ source, totalValue, holdingCount, returnPct }: Props) {
  const meta = SOURCE_META[source];

  return (
    <Link
      href={`/portfolio/${source}`}
      className={`card p-4 border ${meta.cardColor} hover:brightness-110 transition-all cursor-pointer`}
    >
      <div className={`text-sm font-medium mb-2 ${meta.color}`}>{meta.label}</div>
      {returnPct !== null ? (
        <div className={`text-2xl font-bold ${returnPct >= 0 ? "text-red-400" : "text-blue-400"}`}>
          {returnPct >= 0 ? "+" : ""}{returnPct.toFixed(1)}%
        </div>
      ) : (
        <div className="text-2xl font-bold text-[var(--muted)]">-</div>
      )}
      <div className="text-sm text-[var(--muted)] mt-1">{holdingCount}종목 보유</div>
      <div className="text-xs text-[var(--muted)] mt-2">포트폴리오 →</div>
    </Link>
  );
}
