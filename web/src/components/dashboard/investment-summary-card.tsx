import Link from "next/link";
import { Briefcase } from "lucide-react";

interface Props {
  count: number;
}

export function InvestmentSummaryCard({ count }: Props) {
  return (
    <Link
      href="/investment"
      className="card p-4 hover:border-[var(--accent)] transition-colors cursor-pointer"
    >
      <div className="flex items-center gap-1.5 mb-3">
        <Briefcase className="w-4 h-4 text-[var(--muted)]" />
        <span className="text-sm font-semibold">투자 현황</span>
      </div>
      <div className="text-3xl font-bold mt-1">{count}</div>
      <div className="text-sm text-[var(--muted)] mt-1">보유 종목</div>
      <div className="text-xs text-[var(--muted)] mt-3">관리 →</div>
    </Link>
  );
}
