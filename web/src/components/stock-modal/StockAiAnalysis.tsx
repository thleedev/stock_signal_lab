"use client";

export interface Signal {
  id: string;
  symbol: string;
  signal_type: string;
  source: string;
  timestamp: string;
  signal_price?: string | number;
  raw_data?: Record<string, unknown>;
}

interface Props {
  signals: Signal[];
  currentPrice: number;
}

const BADGE_LABELS: Record<string, string> = {
  golden_cross: "골든크로스",
  bollinger_bottom: "볼린저하단",
  phoenix_pattern: "피닉스패턴",
  volume_surge: "거래량급등",
};

const SOURCE_LABELS: Record<string, string> = {
  lassi: "라씨매매",
  stockbot: "스톡봇",
  quant: "퀀트",
};

export function StockAiAnalysis({ signals, currentPrice }: Props) {
  const latestBuy = signals.find(
    (s) => s.signal_type === "BUY" || s.signal_type === "BUY_FORECAST"
  );

  const getSignalPrice = (s: Signal): number => {
    // signal_price는 최상위 필드로 존재 (string 또는 number)
    if (s.signal_price !== undefined && s.signal_price !== null) {
      const val = Number(s.signal_price);
      if (!isNaN(val)) return val;
    }
    // fallback: raw_data 내부 필드
    const rd = s.raw_data ?? {};
    return Number(rd.signal_price ?? rd.recommend_price ?? rd.buy_range_low ?? 0) || 0;
  };

  const latestBuyPrice = latestBuy ? getSignalPrice(latestBuy) : 0;
  const gapPct = latestBuyPrice > 0
    ? ((currentPrice - latestBuyPrice) / latestBuyPrice) * 100
    : null;

  const badges: string[] = [];
  if (latestBuy?.raw_data) {
    Object.keys(BADGE_LABELS).forEach((key) => {
      if (latestBuy.raw_data![key]) badges.push(key);
    });
  }

  // AI 추천 점수: 신호 횟수 기반 프록시 점수
  const signalCount = signals.length;
  const buyCount = signals.filter(
    (s) => s.signal_type === "BUY" || s.signal_type === "BUY_FORECAST"
  ).length;

  return (
    <div className="px-6 py-4 border-b border-[var(--border)]">
      <h3 className="text-sm font-semibold text-[var(--muted)] uppercase tracking-wide mb-3">
        AI 신호 &amp; 분석
      </h3>

      {/* AI 추천 점수 */}
      <div className="flex items-center gap-3 mb-3 p-2.5 rounded-lg bg-[var(--background)]">
        <div className="text-center">
          <p className="text-[10px] text-[var(--muted)] mb-0.5">신호 횟수</p>
          <p className="text-lg font-bold tabular-nums">{signalCount}<span className="text-xs font-normal text-[var(--muted)] ml-0.5">건</span></p>
        </div>
        <div className="w-px h-8 bg-[var(--border)]" />
        <div className="text-center">
          <p className="text-[10px] text-[var(--muted)] mb-0.5">매수 신호</p>
          <p className="text-lg font-bold tabular-nums text-red-500">{buyCount}<span className="text-xs font-normal text-[var(--muted)] ml-0.5">건</span></p>
        </div>
        {signalCount > 0 && (
          <>
            <div className="w-px h-8 bg-[var(--border)]" />
            <div className="text-center">
              <p className="text-[10px] text-[var(--muted)] mb-0.5">매수 비율</p>
              <p className="text-lg font-bold tabular-nums text-blue-500">
                {Math.round((buyCount / signalCount) * 100)}<span className="text-xs font-normal text-[var(--muted)] ml-0.5">%</span>
              </p>
            </div>
          </>
        )}
      </div>

      {badges.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {badges.map((key) => (
            <span
              key={key}
              className="px-2 py-0.5 text-xs rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300"
            >
              {BADGE_LABELS[key]}
            </span>
          ))}
        </div>
      )}

      {gapPct !== null && (
        <div className="mb-3 text-sm">
          <span className="text-[var(--muted)]">매수신호 대비 GAP: </span>
          <span className={`font-medium ${gapPct >= 0 ? "text-red-500" : "text-blue-500"}`}>
            {gapPct >= 0 ? "+" : ""}{gapPct.toFixed(1)}%
          </span>
          <span className="text-[var(--muted)] ml-1 text-xs">
            (신호가 {latestBuyPrice.toLocaleString()}원)
          </span>
        </div>
      )}

      {signals.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">신호 이력이 없습니다.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[var(--muted)] border-b border-[var(--border)]">
                <th className="pb-1 font-normal">날짜</th>
                <th className="pb-1 font-normal">소스</th>
                <th className="pb-1 font-normal">타입</th>
                <th className="pb-1 font-normal text-right">가격</th>
              </tr>
            </thead>
            <tbody>
              {signals.slice(0, 20).map((s) => (
                <tr key={s.id} className="border-b border-[var(--border)]/50">
                  <td className="py-1.5 text-[var(--muted)] text-xs">
                    {new Date(s.timestamp).toLocaleDateString("ko-KR")}
                  </td>
                  <td className="py-1.5 text-xs">
                    {SOURCE_LABELS[s.source] ?? s.source}
                  </td>
                  <td className="py-1.5">
                    <span className={`text-xs font-medium ${
                      s.signal_type.startsWith("BUY") ? "text-red-500" : "text-blue-500"
                    }`}>
                      {s.signal_type}
                    </span>
                  </td>
                  <td className="py-1.5 text-right">
                    {getSignalPrice(s) > 0 ? `${getSignalPrice(s).toLocaleString()}원` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
