"use client";

import type { StockRankItem } from "@/app/api/v1/stock-ranking/route";
import { SOURCE_LABELS, SIGNAL_TYPE_LABELS } from "@/lib/signal-constants";

interface Signal {
  id: string;
  symbol: string;
  signal_type: string;
  source: string;
  timestamp: string;
  signal_price?: string | number;
  raw_data?: Record<string, unknown>;
}

interface Props {
  data: StockRankItem;
  signals: Signal[];
  signalsLoading: boolean;
}

/** 기술적 패턴 키 → 한국어 레이블 */
const PATTERN_LABELS: Record<string, string> = {
  golden_cross: "골든크로스",
  bollinger_bottom: "볼린저하단",
  phoenix_pattern: "피닉스패턴",
  macd_cross: "MACD크로스",
  volume_surge: "거래량급등",
  week52_low_near: "52주저가근접",
  double_top: "쌍봉",
  disparity_rebound: "이격도반등",
  volume_breakout: "거래량돌파",
  consecutive_drop_rebound: "연속하락반등",
};

/** 신호 가격 추출 — signal_price 필드 우선, 없으면 raw_data에서 폴백 */
function getSignalPrice(s: Signal): number {
  if (s.signal_price !== undefined && s.signal_price !== null) {
    const val = Number(s.signal_price);
    if (!isNaN(val)) return val;
  }
  const rd = s.raw_data ?? {};
  return Number(rd.signal_price ?? rd.recommend_price ?? rd.buy_range_low ?? 0) || 0;
}

/**
 * 기술적 시그널 섹션
 * - RSI 게이지 바 (과매도/중립/과매수 색상 구분)
 * - 활성 기술적 패턴 배지
 * - 신호 이력 테이블 (최대 20건)
 */
export function TechnicalSignalSection({ data, signals, signalsLoading }: Props) {
  // ai 필드 제거 — RSI/패턴 데이터 없음
  const rsi: number | null = null;
  const activePatterns: string[] = [];

  // RSI 수치에 따른 게이지 색상 결정
  const rsiColor =
    rsi == null ? "bg-[var(--muted)]" :
    rsi <= 30 ? "bg-[var(--sell)]" :
    rsi >= 70 ? "bg-[var(--buy)]" :
    "bg-[var(--warning)]";

  // RSI 상태 레이블
  const rsiLabel =
    rsi == null ? "" :
    rsi <= 30 ? "과매도" :
    rsi >= 70 ? "과매수" :
    "중립";

  // 사용되지 않는 변수 참조 방지
  void rsiColor; void rsiLabel; void activePatterns;

  return (
    <div className="p-4 space-y-3">
      <h3 className="text-lg font-semibold">기술적 시그널</h3>

      {/* 기술적 지표 데이터 없음 안내 */}
      <p className="text-sm text-[var(--muted)]">기술적 지표 데이터 없음</p>

      {/* 신호 이력 테이블 */}
      <div className="mt-2">
        <h4 className="text-sm font-medium text-[var(--muted)] mb-2">신호 이력</h4>
        {signalsLoading ? (
          /* 로딩 스켈레톤 */
          <div className="space-y-2 animate-pulse">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-6 bg-[var(--muted)]/20 rounded" />
            ))}
          </div>
        ) : signals.length === 0 ? (
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
                    {/* 날짜 */}
                    <td className="py-1.5 text-[var(--muted)] text-xs">
                      {new Date(s.timestamp).toLocaleDateString("ko-KR")}
                    </td>
                    {/* 소스 */}
                    <td className="py-1.5 text-xs">
                      {SOURCE_LABELS[s.source] ?? s.source}
                    </td>
                    {/* 신호 타입 */}
                    <td className="py-1.5">
                      <span
                        className={`text-xs font-medium ${
                          s.signal_type.startsWith("BUY")
                            ? "text-[var(--buy)]"
                            : "text-[var(--sell)]"
                        }`}
                      >
                        {SIGNAL_TYPE_LABELS[s.signal_type] ?? s.signal_type}
                      </span>
                    </td>
                    {/* 신호 가격 */}
                    <td className="py-1.5 text-right text-xs tabular-nums">
                      {getSignalPrice(s) > 0
                        ? `${getSignalPrice(s).toLocaleString()}원`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
