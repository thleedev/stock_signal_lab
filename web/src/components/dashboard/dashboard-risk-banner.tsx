import Link from "next/link";
import { Shield, AlertTriangle, XCircle, Skull } from "lucide-react";

interface Props {
  riskIndex: number;
}

function getRiskLevel(index: number): {
  label: string;
  color: string;
  bgColor: string;
  borderColor: string;
  Icon: React.ElementType;
} {
  if (index <= 25) return {
    label: "안전",
    color: "text-emerald-400",
    bgColor: "bg-emerald-900/20",
    borderColor: "border-emerald-800/50",
    Icon: Shield,
  };
  if (index <= 50) return {
    label: "주의",
    color: "text-yellow-400",
    bgColor: "bg-yellow-900/20",
    borderColor: "border-yellow-800/50",
    Icon: AlertTriangle,
  };
  if (index <= 75) return {
    label: "위험",
    color: "text-orange-400",
    bgColor: "bg-orange-900/20",
    borderColor: "border-orange-800/50",
    Icon: XCircle,
  };
  return {
    label: "극위험",
    color: "text-red-400",
    bgColor: "bg-red-900/20",
    borderColor: "border-red-800/50",
    Icon: Skull,
  };
}

export function DashboardRiskBanner({ riskIndex }: Props) {
  const risk = getRiskLevel(riskIndex);
  const { Icon } = risk;

  return (
    <Link
      href="/market"
      className={`block card p-4 border ${risk.bgColor} ${risk.borderColor} hover:brightness-110 transition-all cursor-pointer`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Icon className={`w-6 h-6 ${risk.color}`} />
          <div>
            <div className="text-xs text-[var(--muted)]">투자 시황 위험도</div>
            <div className={`text-lg font-bold ${risk.color}`}>{risk.label}</div>
          </div>
        </div>
        <div className="text-right">
          <div className={`text-4xl font-bold ${risk.color}`}>{Math.round(riskIndex)}</div>
          <div className="text-xs text-[var(--muted)] mt-0.5">/ 100 · 상세 보기 →</div>
        </div>
      </div>
    </Link>
  );
}
