import { createServiceClient } from "@/lib/supabase";
import { DateSelector } from "@/components/common/date-selector";
import { getLastNDays } from "@/lib/date-utils";

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

const SECTION_ICONS: Record<string, string> = {
  "시장 동향 종합": "📊",
  "AI 매매신호 분석": "🤖",
  "주목 종목": "🔍",
  "투자자 동향": "💰",
  "섹터 분석": "🏭",
  "리스크 평가": "⚠️",
  "전략 제안": "🎯",
};

export const revalidate = 60;

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

  const [
    { data: signals },
    { data: mmsMessages },
    { data: reportSummary },
    { data: dailyStats },
  ] = await Promise.all([
    supabase.from("signals").select("*")
      .gte("timestamp", dateStart).lt("timestamp", dateEnd)
      .order("timestamp", { ascending: false }),
    supabase.from("mms_raw_messages").select("*")
      .gte("created_at", dateStart).lt("created_at", dateEnd)
      .order("created_at", { ascending: false }),
    supabase.from("daily_report_summary")
      .select("ai_summary, market_score")
      .eq("date", selectedDate).single(),
    supabase.from("daily_signal_stats").select("*").eq("date", selectedDate),
  ]);

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

  // AI 요약을 섹션별로 파싱
  const aiSections = parseAiSections(reportSummary?.ai_summary);

  // 투자자 동향 데이터 (investor_trends 컬럼이 있는 경우)
  const rawReport = reportSummary as Record<string, unknown> | null;
  const trends = (rawReport?.investor_trends ?? null) as {
    kospi?: { foreign_net: number; institution_net: number; individual_net: number };
    kosdaq?: { foreign_net: number; institution_net: number; individual_net: number };
  } | null;

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div>
        <h1 className="text-2xl font-bold">일간 리포트</h1>
        <p className="text-sm text-[var(--muted)] mt-1">{selectedDate} 기준</p>
      </div>

      {/* 날짜 선택 */}
      <DateSelector basePath="/reports" selectedDate={selectedDate} />

      {/* 소스별 요약 카드 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {(["lassi", "stockbot", "quant"] as const).map((src) => {
          const c = sourceCounts[src];
          return (
            <div key={src} className="card p-5">
              <div className="flex items-center gap-2 mb-3">
                <span className={`text-xs px-2 py-0.5 rounded border font-medium ${SOURCE_COLORS[src]}`}>
                  {SOURCE_LABELS[src]}
                </span>
              </div>
              <div className="text-3xl font-bold">{c.total}</div>
              <div className="text-sm text-[var(--muted)] mt-1">건</div>
              <div className="flex gap-4 mt-3 text-sm">
                <span className="price-up font-medium">매수 {c.buy}</span>
                <span className="price-down font-medium">매도 {c.sell}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* 투자자 매매동향 */}
      {trends && (trends.kospi || trends.kosdaq) && (
        <div className="card">
          <div className="p-4 border-b border-[var(--border)] flex items-center gap-2">
            <span className="text-lg">💰</span>
            <h2 className="font-semibold">투자자 매매동향</h2>
          </div>
          <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-6">
            {trends.kospi && <TrendTable market="KOSPI" data={trends.kospi} />}
            {trends.kosdaq && <TrendTable market="KOSDAQ" data={trends.kosdaq} />}
          </div>
        </div>
      )}

      {/* AI 일간 분석 - 섹션별 */}
      {aiSections.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <span className="text-lg">🤖</span>
            <h2 className="text-xl font-bold">AI 일간 분석</h2>
            {reportSummary?.market_score != null && (
              <span className={`ml-auto text-sm font-medium px-3 py-1 rounded-lg ${
                Number(reportSummary.market_score) >= 60
                  ? "bg-green-900/30 text-green-400"
                  : Number(reportSummary.market_score) >= 40
                    ? "bg-yellow-900/30 text-yellow-400"
                    : "bg-red-900/30 text-red-400"
              }`}>
                시장점수 {Number(reportSummary.market_score).toFixed(0)}점
              </span>
            )}
          </div>
          {aiSections.map((section, i) => (
            <div key={i} className="card">
              <div className="p-4 border-b border-[var(--border)] flex items-center gap-2">
                <span className="text-base">{SECTION_ICONS[section.title] || "📋"}</span>
                <h3 className="font-semibold">{section.title}</h3>
              </div>
              <div className="p-5 text-sm text-[var(--muted)] leading-relaxed space-y-2">
                {section.lines.map((line, j) => {
                  if (line.startsWith('- ') || line.startsWith('* ')) {
                    return <div key={j} className="pl-3 border-l-2 border-[var(--border)]">{line.slice(2)}</div>;
                  }
                  if (line.startsWith('**') && line.endsWith('**')) {
                    return <p key={j} className="font-semibold text-[var(--foreground)]">{line.slice(2, -2)}</p>;
                  }
                  return <p key={j}>{renderBold(line)}</p>;
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 기존 텍스트 AI 요약 (새 포맷이 아닌 경우) */}
      {reportSummary?.ai_summary && aiSections.length === 0 && (
        <div className="card">
          <div className="p-4 border-b border-[var(--border)] flex items-center gap-2">
            <span className="text-lg">🤖</span>
            <h2 className="font-semibold">AI 일간 분석</h2>
          </div>
          <div className="p-5 prose prose-invert prose-sm max-w-none
            [&>h2]:text-base [&>h2]:font-semibold [&>h2]:text-[var(--foreground)] [&>h2]:mt-4 [&>h2]:mb-2
            [&>p]:text-[var(--muted)] [&>p]:leading-relaxed [&>p]:mb-3">
            {reportSummary.ai_summary.split('\n').map((line: string, i: number) => {
              if (line.startsWith('## ')) return <h2 key={i}>{line.replace('## ', '')}</h2>;
              if (line.trim() === '') return null;
              return <p key={i}>{line}</p>;
            })}
          </div>
        </div>
      )}

      {/* 신호 목록 */}
      <div className="card">
        <div className="p-4 border-b border-[var(--border)]">
          <h2 className="font-semibold">신호 목록</h2>
          <p className="text-xs text-[var(--muted)] mt-0.5">총 {(signals ?? []).length}건</p>
        </div>
        {(signals ?? []).length === 0 ? (
          <div className="p-8 text-center text-[var(--muted)]">해당 날짜에 수집된 신호가 없습니다</div>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {(signals ?? []).map((s: Record<string, string>) => (
              <div key={s.id} className="px-4 py-3 flex items-center gap-3 hover:bg-[var(--card-hover)] transition-colors">
                <span className={`text-xs px-2 py-0.5 rounded font-medium whitespace-nowrap ${
                  ["BUY", "BUY_FORECAST"].includes(s.signal_type)
                    ? "bg-red-900/30 text-red-400"
                    : "bg-blue-900/30 text-blue-400"
                }`}>
                  {SIGNAL_TYPE_LABELS[s.signal_type] || s.signal_type}
                </span>
                <span className={`text-xs px-1.5 py-0.5 rounded border whitespace-nowrap ${SOURCE_COLORS[s.source]}`}>
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
                  {new Date(s.timestamp).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}
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
          <p className="text-xs text-[var(--muted)] mt-0.5">총 {(mmsMessages ?? []).length}건</p>
        </div>
        {(mmsMessages ?? []).length === 0 ? (
          <div className="p-8 text-center text-[var(--muted)]">해당 날짜에 수신된 MMS가 없습니다</div>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {(mmsMessages ?? []).map((msg: Record<string, string>, idx: number) => (
              <div key={msg.id ?? idx} className="px-4 py-3">
                <div className="flex items-center gap-2 mb-2">
                  {msg.sender && (
                    <span className="text-xs font-medium bg-[var(--card-hover)] text-[var(--foreground)] px-2 py-0.5 rounded">
                      {msg.sender}
                    </span>
                  )}
                  {msg.source && (
                    <span className={`text-xs px-1.5 py-0.5 rounded border ${SOURCE_COLORS[msg.source] ?? "bg-gray-800/30 text-gray-400 border-gray-700/50"}`}>
                      {SOURCE_LABELS[msg.source] ?? msg.source}
                    </span>
                  )}
                  <span className="ml-auto text-xs text-[var(--muted)]">
                    {new Date(msg.created_at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </span>
                </div>
                <pre className="text-sm text-[var(--foreground)] whitespace-pre-wrap break-words font-sans leading-relaxed">
                  {msg.body}
                </pre>
              </div>
            ))}
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
                {dailyStats.map((stat: Record<string, string | number | null>, idx: number) => (
                  <tr key={idx} className="hover:bg-[var(--card-hover)]">
                    <td className="px-4 py-3 font-medium">
                      {SOURCE_LABELS[stat.source as string] ?? (stat.source as string)}
                    </td>
                    <td className="px-4 py-3">
                      {stat.execution_type === "lump" ? "일시매매"
                        : stat.execution_type === "split" ? "분할매매"
                        : (stat.execution_type as string)}
                    </td>
                    <td className="px-4 py-3 text-right">{stat.total_signals ?? 0}</td>
                    <td className="px-4 py-3 text-right">{stat.realized_trades ?? 0}</td>
                    <td className="px-4 py-3 text-right">
                      {stat.hit_rate != null ? `${Number(stat.hit_rate).toFixed(1)}%` : "-"}
                    </td>
                    <td className={`px-4 py-3 text-right font-medium ${
                      Number(stat.avg_return ?? 0) >= 0 ? "price-up" : "price-down"
                    }`}>
                      {stat.avg_return != null
                        ? `${Number(stat.avg_return) >= 0 ? "+" : ""}${Number(stat.avg_return).toFixed(2)}%`
                        : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 헬퍼 ─────────────────────────────────────────────

function parseAiSections(text: string | null | undefined): { title: string; lines: string[] }[] {
  if (!text) return [];
  const sections: { title: string; lines: string[] }[] = [];
  let current: { title: string; lines: string[] } | null = null;

  for (const line of text.split('\n')) {
    if (line.startsWith('## ')) {
      if (current) sections.push(current);
      current = { title: line.replace('## ', '').trim(), lines: [] };
    } else if (current && line.trim()) {
      current.lines.push(line.trim());
    }
  }
  if (current && current.lines.length > 0) sections.push(current);

  return sections;
}

function renderBold(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="text-[var(--foreground)]">{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}

function TrendTable({ market, data }: {
  market: string;
  data: { foreign_net: number; institution_net: number; individual_net: number };
}) {
  const rows = [
    { label: "외국인", value: data.foreign_net },
    { label: "기관", value: data.institution_net },
    { label: "개인", value: data.individual_net },
  ];

  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.value)), 1);

  return (
    <div>
      <h3 className="font-semibold text-sm mb-3">{market}</h3>
      <div className="space-y-3">
        {rows.map((row) => {
          const pct = Math.abs(row.value) / maxAbs * 100;
          const isPositive = row.value >= 0;
          return (
            <div key={row.label}>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-[var(--muted)]">{row.label}</span>
                <span className={isPositive ? "price-up font-medium" : "price-down font-medium"}>
                  {isPositive ? "순매수" : "순매도"} {Math.abs(row.value).toLocaleString()}주
                </span>
              </div>
              <div className="h-2 rounded-full bg-[#1e293b] overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    isPositive ? "bg-red-500" : "bg-blue-500"
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
