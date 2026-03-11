import { createServiceClient } from "@/lib/supabase";

const SOURCE_COLORS: Record<string, string> = {
  lassi: "bg-red-900/30 text-red-400 border-red-800/50",
  stockbot: "bg-green-900/30 text-green-400 border-green-800/50",
  quant: "bg-blue-900/30 text-blue-400 border-blue-800/50",
};

const SOURCE_LABELS: Record<string, string> = {
  lassi: "라씨매매",
  stockbot: "스톡봇",
  quant: "퀀트",
};

const SIGNAL_TYPE_LABELS: Record<string, string> = {
  BUY: "매수",
  BUY_FORECAST: "매수예고",
  SELL: "매도",
  SELL_COMPLETE: "매도완료",
  HOLD: "보유중",
};

export const dynamic = "force-dynamic";

function getLastNDays(n: number): string[] {
  const days: string[] = [];
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  for (let i = 0; i < n; i++) {
    const d = new Date(kst.getTime() - i * 86400000);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

function formatDateLabel(dateStr: string): string {
  const [, m, d] = dateStr.split("-");
  const date = new Date(dateStr + "T00:00:00+09:00");
  const weekday = ["일", "월", "화", "수", "목", "금", "토"][date.getDay()];
  return `${parseInt(m)}/${parseInt(d)}(${weekday})`;
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const params = await searchParams;
  const last7 = getLastNDays(7);
  const selectedDate = params.date && last7.includes(params.date) ? params.date : last7[0];
  const supabase = createServiceClient();

  const dateStart = `${selectedDate}T00:00:00+09:00`;
  const dateEnd = `${selectedDate}T23:59:59+09:00`;

  // 신호 조회
  const { data: signals } = await supabase
    .from("signals")
    .select("*")
    .gte("timestamp", dateStart)
    .lt("timestamp", dateEnd)
    .order("timestamp", { ascending: false });

  // MMS 원문 조회
  const { data: mmsMessages } = await supabase
    .from("mms_raw_messages")
    .select("*")
    .gte("created_at", dateStart)
    .lt("created_at", dateEnd)
    .order("created_at", { ascending: false });

  // 일간 통계 조회
  const { data: dailyStats } = await supabase
    .from("daily_signal_stats")
    .select("*")
    .eq("date", selectedDate);

  // 소스별 신호 집계
  const sourceCounts: Record<string, { buy: number; sell: number; total: number }> = {
    lassi: { buy: 0, sell: 0, total: 0 },
    stockbot: { buy: 0, sell: 0, total: 0 },
    quant: { buy: 0, sell: 0, total: 0 },
  };

  for (const s of signals ?? []) {
    const src = s.source as string;
    if (!sourceCounts[src]) continue;
    sourceCounts[src].total++;
    if (["BUY", "BUY_FORECAST"].includes(s.signal_type)) {
      sourceCounts[src].buy++;
    } else {
      sourceCounts[src].sell++;
    }
  }

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div>
        <h1 className="text-2xl font-bold">일간 리포트</h1>
        <p className="text-sm text-[var(--muted)] mt-1">{selectedDate} 기준</p>
      </div>

      {/* 날짜 선택 */}
      <div className="flex gap-2 flex-wrap">
        {last7.map((date) => (
          <a
            key={date}
            href={`/reports?date=${date}`}
            className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
              selectedDate === date
                ? "bg-[var(--accent)] text-white border-[var(--accent)]"
                : "bg-[var(--card)] text-[var(--muted)] border-[var(--border)] hover:bg-[var(--card-hover)]"
            }`}
          >
            {formatDateLabel(date)}
          </a>
        ))}
      </div>

      {/* 소스별 요약 카드 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {(["lassi", "stockbot", "quant"] as const).map((src) => {
          const c = sourceCounts[src];
          return (
            <div
              key={src}
              className="card p-5"
            >
              <div className="flex items-center gap-2 mb-3">
                <span
                  className={`text-xs px-2 py-0.5 rounded border font-medium ${SOURCE_COLORS[src]}`}
                >
                  {SOURCE_LABELS[src]}
                </span>
              </div>
              <div className="text-3xl font-bold">{c.total}</div>
              <div className="text-sm text-[var(--muted)] mt-1">건</div>
              <div className="flex gap-4 mt-3 text-sm">
                <div>
                  <span className="price-up font-medium">매수 {c.buy}</span>
                </div>
                <div>
                  <span className="price-down font-medium">매도 {c.sell}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* 신호 목록 */}
      <div className="card">
        <div className="p-4 border-b border-[var(--border)]">
          <h2 className="font-semibold">신호 목록</h2>
          <p className="text-xs text-[var(--muted)] mt-0.5">
            총 {(signals ?? []).length}건
          </p>
        </div>
        {(signals ?? []).length === 0 ? (
          <div className="p-8 text-center text-[var(--muted)]">
            해당 날짜에 수집된 신호가 없습니다
          </div>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {(signals ?? []).map((s: Record<string, string>) => (
              <div
                key={s.id}
                className="px-4 py-3 flex items-center gap-3 hover:bg-[var(--card-hover)] transition-colors"
              >
                <span
                  className={`text-xs px-2 py-0.5 rounded font-medium whitespace-nowrap ${
                    ["BUY", "BUY_FORECAST"].includes(s.signal_type)
                      ? "bg-red-900/30 text-red-400"
                      : "bg-blue-900/30 text-blue-400"
                  }`}
                >
                  {SIGNAL_TYPE_LABELS[s.signal_type] || s.signal_type}
                </span>
                <span
                  className={`text-xs px-1.5 py-0.5 rounded border whitespace-nowrap ${SOURCE_COLORS[s.source]}`}
                >
                  {SOURCE_LABELS[s.source] || s.source}
                </span>
                <span className="font-medium">{s.name}</span>
                <span className="text-xs text-[var(--muted)]">{s.symbol}</span>
                {s.signal_price && (
                  <span className="text-sm text-[var(--foreground)]">
                    {Number(s.signal_price).toLocaleString()}원
                  </span>
                )}
                <span className="ml-auto text-xs text-[var(--muted)]">
                  {new Date(s.timestamp).toLocaleTimeString("ko-KR", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* MMS 원문 */}
      <div className="card">
        <div className="p-4 border-b border-[var(--border)]">
          <h2 className="font-semibold">MMS 원문</h2>
          <p className="text-xs text-[var(--muted)] mt-0.5">
            총 {(mmsMessages ?? []).length}건
          </p>
        </div>
        {(mmsMessages ?? []).length === 0 ? (
          <div className="p-8 text-center text-[var(--muted)]">
            해당 날짜에 수신된 MMS가 없습니다
          </div>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {(mmsMessages ?? []).map(
              (msg: Record<string, string>, idx: number) => (
                <div key={msg.id ?? idx} className="px-4 py-3">
                  <div className="flex items-center gap-2 mb-2">
                    {msg.sender && (
                      <span className="text-xs font-medium bg-[var(--card-hover)] text-[var(--foreground)] px-2 py-0.5 rounded">
                        {msg.sender}
                      </span>
                    )}
                    {msg.source && (
                      <span
                        className={`text-xs px-1.5 py-0.5 rounded border ${SOURCE_COLORS[msg.source] ?? "bg-gray-800/30 text-gray-400 border-gray-700/50"}`}
                      >
                        {SOURCE_LABELS[msg.source] ?? msg.source}
                      </span>
                    )}
                    <span className="ml-auto text-xs text-[var(--muted)]">
                      {new Date(msg.created_at).toLocaleTimeString("ko-KR", {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}
                    </span>
                  </div>
                  <pre className="text-sm text-[var(--foreground)] whitespace-pre-wrap break-words font-sans leading-relaxed">
                    {msg.body}
                  </pre>
                </div>
              )
            )}
          </div>
        )}
      </div>

      {/* 일간 통계 */}
      {dailyStats && dailyStats.length > 0 && (
        <div className="card">
          <div className="p-4 border-b border-[var(--border)]">
            <h2 className="font-semibold">일간 통계</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[var(--background)] text-[var(--muted)]">
                  <th className="text-left px-4 py-3 font-medium">소스</th>
                  <th className="text-left px-4 py-3 font-medium">전략</th>
                  <th className="text-right px-4 py-3 font-medium">총 신호</th>
                  <th className="text-right px-4 py-3 font-medium">완결 거래</th>
                  <th className="text-right px-4 py-3 font-medium">적중률</th>
                  <th className="text-right px-4 py-3 font-medium">평균 수익률</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {dailyStats.map(
                  (
                    stat: Record<string, string | number | null>,
                    idx: number
                  ) => (
                    <tr key={idx} className="hover:bg-[var(--card-hover)]">
                      <td className="px-4 py-3 font-medium">
                        {SOURCE_LABELS[stat.source as string] ??
                          (stat.source as string)}
                      </td>
                      <td className="px-4 py-3">
                        {stat.execution_type === "lump"
                          ? "일시매매"
                          : stat.execution_type === "split"
                            ? "분할매매"
                            : (stat.execution_type as string)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {stat.total_signals ?? 0}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {stat.realized_trades ?? 0}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {stat.hit_rate != null
                          ? `${Number(stat.hit_rate).toFixed(1)}%`
                          : "-"}
                      </td>
                      <td
                        className={`px-4 py-3 text-right font-medium ${
                          Number(stat.avg_return ?? 0) >= 0
                            ? "price-up"
                            : "price-down"
                        }`}
                      >
                        {stat.avg_return != null
                          ? `${Number(stat.avg_return) >= 0 ? "+" : ""}${Number(stat.avg_return).toFixed(2)}%`
                          : "-"}
                      </td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
