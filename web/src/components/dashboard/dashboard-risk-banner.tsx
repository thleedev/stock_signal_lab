import Link from "next/link";
import { Shield, AlertTriangle, XCircle, Skull, HelpCircle } from "lucide-react";

interface Props {
  /** null 이면 지표 커버리지 미달로 산출 불가(cron/market-score/route.ts 참고) */
  riskIndex: number | null;
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
  // 지표 커버리지 미달로 크론이 risk_index 를 저장하지 않은 날(null).
  // 0 으로 대체해 렌더링하면 파이프라인이 죽은 상태와 시장이 가장
  // 안전한 상태가 똑같이 초록 "안전"으로 보인다 — /market 배너에서
  // 고친 것과 같은 결함이라 여기서도 별도 중립 상태로 분리한다.
  if (riskIndex == null) {
    return (
      <Link
        href="/market"
        className="block card p-4 border border-[var(--border)] hover:brightness-110 transition-all cursor-pointer"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <HelpCircle className="w-6 h-6 text-[var(--muted)]" />
            <div>
              <div className="text-xs text-[var(--muted)]">투자 시황 위험도</div>
              <div className="text-lg font-bold text-[var(--muted)]">산출 불가</div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-[var(--muted)]">지표 결손 · 상세 보기 →</div>
          </div>
        </div>
      </Link>
    );
  }

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
