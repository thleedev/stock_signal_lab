/** 소스 레이블 — 전체 이름 (reports, signals 페이지 등 여유 있는 UI) */
export const SOURCE_LABELS: Record<string, string> = {
  lassi: "라씨매매",
  stockbot: "스톡봇",
  quant: "퀀트",
};

/** 소스 레이블 — 축약형 (테이블 배지 등 공간이 좁은 UI) */
export const SOURCE_LABELS_SHORT: Record<string, string> = {
  lassi: "라씨",
  stockbot: "스톡봇",
  quant: "퀀트",
};

/** 소스별 도트 색상 클래스 (포트폴리오 등 작은 인디케이터) */
export const SOURCE_DOTS: Record<string, string> = {
  lassi: "bg-red-400",
  stockbot: "bg-green-400",
  quant: "bg-blue-400",
};

/** 소스별 카드 배경 색상 클래스 (카드/영역 배경용) */
export const SOURCE_CARD_COLORS: Record<string, { card: string; text: string; borderColor: string }> = {
  lassi: { card: "border-red-800/50 bg-red-900/30", text: "text-red-400", borderColor: "border-red-700" },
  stockbot: { card: "border-green-800/50 bg-green-900/30", text: "text-green-400", borderColor: "border-green-700" },
  quant: { card: "border-blue-800/50 bg-blue-900/30", text: "text-blue-400", borderColor: "border-blue-700" },
};

/** 소스별 배지 색상 클래스 */
export const SOURCE_COLORS: Record<string, string> = {
  lassi: "bg-red-900/30 text-red-400 border-red-800/50",
  stockbot: "bg-green-900/30 text-green-400 border-green-800/50",
  quant: "bg-blue-900/30 text-blue-400 border-blue-800/50",
};

/** 신호 타입 레이블 */
export const SIGNAL_TYPE_LABELS: Record<string, string> = {
  BUY: "매수",
  BUY_FORECAST: "매수예고",
  SELL: "매도",
  SELL_COMPLETE: "매도완료",
};

/** 신호 타입 배지 색상 클래스 */
export const SIGNAL_COLORS: Record<string, string> = {
  BUY: "bg-red-900/50 text-red-400 border-red-700",
  BUY_FORECAST: "bg-red-900/30 text-red-300 border-red-800",
  SELL: "bg-blue-900/50 text-blue-400 border-blue-700",
  SELL_COMPLETE: "bg-blue-900/30 text-blue-300 border-blue-800",
};

/** BUY 계열 신호 타입 */
export const BUY_SIGNAL_TYPES = ["BUY", "BUY_FORECAST"] as const;

/** 소스 레이블 — 이모지 포함 (performance 페이지 등 강조 UI) */
export const SOURCE_LABELS_EMOJI: Record<string, string> = {
  lassi: "🔴 라씨매매",
  stockbot: "🟢 스톡봇",
  quant: "🔵 퀀트",
};

/** raw_data JSONB에서 신호 가격 추출 */
export function extractSignalPrice(rawData: Record<string, unknown> | null): number | null {
  if (!rawData) return null;
  const fields = ['signal_price', 'recommend_price', 'buy_price', 'sell_price', 'price', 'current_price'] as const;
  for (const field of fields) {
    const val = rawData[field] as number | undefined;
    if (val && val > 0) return val;
  }
  return null;
}
