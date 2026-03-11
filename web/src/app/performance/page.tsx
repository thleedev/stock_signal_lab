import { createServiceClient } from "@/lib/supabase";
import { PORTFOLIO_CONFIG } from "@/lib/strategy-engine";

const SOURCE_LABELS: Record<string, string> = {
  lassi: "🔴 라씨매매",
  stockbot: "🟢 스톡봇",
  quant: "🔵 퀀트",
};

export const dynamic = "force-dynamic";

export default async function PerformancePage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const params = await searchParams;
  const period = params.period ?? "30d";
  const supabase = createServiceClient();

  const days = parseInt(period) || 30;
  const dateFrom = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

  // 최신 포트폴리오 스냅샷 (소스×전략)
  const { data: snapshots } = await supabase
    .from("portfolio_snapshots")
    .select("*")
    .gte("date", dateFrom)
    .order("date", { ascending: false });

  // 최신 값만 추출 (소스×전략 조합)
  const latest = new Map<string, typeof snapshots extends (infer T)[] | null ? T : never>();
  for (const s of snapshots ?? []) {
    const key = `${s.source}_${s.execution_type}`;
    if (!latest.has(key)) latest.set(key, s);
  }

  // 통합 스냅샷
  const { data: combined } = await supabase
    .from("combined_portfolio_snapshots")
    .select("*")
    .gte("date", dateFrom)
    .order("date", { ascending: false });

  const latestCombined = new Map<string, typeof combined extends (infer T)[] | null ? T : never>();
  for (const c of combined ?? []) {
    if (!latestCombined.has(c.execution_type)) latestCombined.set(c.execution_type, c);
  }

  // 일간 통계
  const { data: stats } = await supabase
    .from("daily_signal_stats")
    .select("*")
    .gte("date", dateFrom)
    .order("date", { ascending: false });

  // 소스별 통계 집계
  const sourceStats = new Map<string, {
    totalSignals: number;
    hitRate: number;
    avgReturn: number;
    realized: number;
    count: number;
  }>();

  for (const s of stats ?? []) {
    const key = `${s.source}_${s.execution_type}`;
    const prev = sourceStats.get(key) ?? {
      totalSignals: 0, hitRate: 0, avgReturn: 0, realized: 0, count: 0,
    };
    prev.totalSignals += s.total_signals ?? 0;
    prev.hitRate += s.hit_rate ?? 0;
    prev.avgReturn += s.avg_return ?? 0;
    prev.realized += s.realized_trades ?? 0;
    prev.count++;
    sourceStats.set(key, prev);
  }

  const initial = PORTFOLIO_CONFIG.CASH_PER_STRATEGY;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">전략 성과 비교</h1>
        <p className="text-sm text-[var(--muted)] mt-1">일시매매 vs 분할매매 크로스 비교</p>
      </div>

      {/* 기간 선택 */}
      <div className="flex gap-2">
        {["7d", "30d", "90d"].map((p) => (
          <a
            key={p}
            href={`/performance?period=${p}`}
            className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
              period === p
                ? "bg-[var(--accent)] text-white border-[var(--accent)]"
                : "bg-[var(--card)] text-[var(--muted)] border-[var(--border)] hover:bg-[var(--card-hover)]"
            }`}
          >
            {p === "7d" ? "7일" : p === "30d" ? "30일" : "90일"}
          </a>
        ))}
      </div>

      {/* 통합 일시 vs 분할 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {(["lump", "split"] as const).map((et) => {
          const c = latestCombined.get(et);
          const val = c?.total_value ?? initial * 3;
          const ret = c?.cumulative_return_pct ?? 0;
          return (
            <div key={et} className="card p-5">
              <div className="text-sm font-medium text-[var(--muted)]">
                {et === "lump" ? "일시매매 (통합)" : "분할매매 (통합)"}
              </div>
              <div className="text-3xl font-bold mt-2">{val.toLocaleString()}원</div>
              <div className={`text-lg font-medium mt-1 ${ret >= 0 ? "price-up" : "price-down"}`}>
                {ret >= 0 ? "+" : ""}{ret}%
              </div>
            </div>
          );
        })}
      </div>

      {/* AI별 × 전략별 성과 테이블 */}
      <div className="card overflow-hidden">
        <div className="p-4 border-b border-[var(--border)]">
          <h2 className="font-semibold">AI × 전략별 성과</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[var(--background)] text-[var(--muted)]">
                <th className="text-left px-4 py-3 font-medium">AI 소스</th>
                <th className="text-right px-4 py-3 font-medium">일시매매</th>
                <th className="text-right px-4 py-3 font-medium">분할매매</th>
                <th className="text-right px-4 py-3 font-medium">차이</th>
                <th className="text-right px-4 py-3 font-medium">총 신호</th>
                <th className="text-right px-4 py-3 font-medium">완결 거래</th>
                <th className="text-right px-4 py-3 font-medium">적중률</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {(["lassi", "stockbot", "quant"] as const).map((src) => {
                const lump = latest.get(`${src}_lump`);
                const split = latest.get(`${src}_split`);
                const lumpRet = lump?.cumulative_return_pct ?? 0;
                const splitRet = split?.cumulative_return_pct ?? 0;
                const diff = splitRet - lumpRet;

                const lumpStats = sourceStats.get(`${src}_lump`);
                const splitStats = sourceStats.get(`${src}_split`);
                const signals = (lumpStats?.totalSignals ?? 0);
                const realized = (lumpStats?.realized ?? 0) + (splitStats?.realized ?? 0);
                const avgHit = lumpStats?.count
                  ? (lumpStats.hitRate / lumpStats.count)
                  : 0;

                return (
                  <tr key={src} className="hover:bg-[var(--card-hover)]">
                    <td className="px-4 py-3 font-medium">{SOURCE_LABELS[src]}</td>
                    <td className={`px-4 py-3 text-right font-medium ${lumpRet >= 0 ? "price-up" : "price-down"}`}>
                      {lumpRet >= 0 ? "+" : ""}{lumpRet}%
                    </td>
                    <td className={`px-4 py-3 text-right font-medium ${splitRet >= 0 ? "price-up" : "price-down"}`}>
                      {splitRet >= 0 ? "+" : ""}{splitRet}%
                    </td>
                    <td className={`px-4 py-3 text-right text-xs ${diff > 0 ? "text-green-600" : diff < 0 ? "text-orange-600" : "text-[var(--muted)]"}`}>
                      {diff > 0 ? "분할 +" : diff < 0 ? "일시 +" : ""}{Math.abs(diff).toFixed(1)}%p
                    </td>
                    <td className="px-4 py-3 text-right">{signals}</td>
                    <td className="px-4 py-3 text-right">{realized}</td>
                    <td className="px-4 py-3 text-right">{avgHit.toFixed(1)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 수익률 추이 비교 */}
      {combined && combined.length > 1 && (
        <div className="card p-4">
          <h2 className="font-semibold mb-3">통합 수익률 추이 (일시 vs 분할)</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {(["lump", "split"] as const).map((et) => {
              const data = combined.filter((c) => c.execution_type === et);
              return (
                <div key={et}>
                  <div className="text-xs text-[var(--muted)] mb-2">
                    {et === "lump" ? "일시매매" : "분할매매"}
                  </div>
                  <div className="flex items-end gap-0.5 h-20">
                    {data.map((d) => {
                      const val = d.cumulative_return_pct ?? 0;
                      const maxAbs = Math.max(...data.map((x) => Math.abs(x.cumulative_return_pct ?? 0)), 1);
                      const height = Math.abs(val) / maxAbs * 100;
                      return (
                        <div key={d.date} className="flex-1 flex flex-col items-center justify-end h-full" title={`${d.date}: ${val}%`}>
                          <div
                            className={`w-full rounded-t ${val >= 0 ? "bg-red-300" : "bg-blue-300"}`}
                            style={{ height: `${Math.max(height, 2)}%` }}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
