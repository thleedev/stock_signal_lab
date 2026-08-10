/** 소스 레이블 — 전체 이름 (reports, signals 페이지 등 여유 있는 UI) */
export const SOURCE_LABELS: Record<string, string> = {
  lassi: "라씨매매",
  stockbot: "스톡봇",
  quant: "알파캐치",
  prizm: "프리즘",
};

/** 소스 레이블 — 축약형 (테이블 배지 등 공간이 좁은 UI) */
export const SOURCE_LABELS_SHORT: Record<string, string> = {
  lassi: "라씨",
  stockbot: "스톡봇",
  quant: "알파캐치",
  prizm: "프리즘",
};

/** 소스별 도트 색상 클래스 (포트폴리오 등 작은 인디케이터) */
export const SOURCE_DOTS: Record<string, string> = {
  lassi: "bg-red-400",
  stockbot: "bg-green-400",
  quant: "bg-blue-400",
  prizm: "bg-purple-400",
};

/** 소스별 카드 배경 색상 클래스 (카드/영역 배경용) */
export const SOURCE_CARD_COLORS: Record<string, { card: string; text: string; borderColor: string }> = {
  lassi: { card: "border-red-800/50 bg-red-900/30", text: "text-red-400", borderColor: "border-red-700" },
  stockbot: { card: "border-green-800/50 bg-green-900/30", text: "text-green-400", borderColor: "border-green-700" },
  quant: { card: "border-blue-800/50 bg-blue-900/30", text: "text-blue-400", borderColor: "border-blue-700" },
  prizm: { card: "border-purple-800/50 bg-purple-900/30", text: "text-purple-400", borderColor: "border-purple-700" },
};

/** 소스별 배지 색상 클래스 */
export const SOURCE_COLORS: Record<string, string> = {
  lassi: "bg-red-900/30 text-red-400 border-red-800/50",
  stockbot: "bg-green-900/30 text-green-400 border-green-800/50",
  quant: "bg-blue-900/30 text-blue-400 border-blue-800/50",
  prizm: "bg-purple-900/30 text-purple-400 border-purple-800/50",
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
  quant: "🔵 알파캐치",
  prizm: "🟣 프리즘",
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

/** stock_cache 기반 활성 신호 원본 행 */
export type ActiveSignalRow = {
  symbol: string;
  name?: string | null;
  market?: string | null;
  latest_signal_date?: string | null;
  latest_signal_type?: string | null;
  latest_signal_price?: number | null;
  latest_sell_date?: string | null;
};

/** SignalColumns 가 소비하는 신호 형태 */
export type ActiveSignal = {
  symbol: string;
  name: string;
  market: string;
  signal_type: string;
  source: string;
  timestamp: string;
  signal_price: string;
  sector: string;
};

/**
 * stock_cache 행을 활성 신호로 변환합니다.
 *
 * 페이지의 최초 200행과 API 의 이어받기 행이 같은 형태여야 하므로
 * 양쪽 모두 이 함수를 사용합니다. source·sector 가 빈 문자열인 것은
 * stock_cache 에 해당 정보가 없기 때문이며 기존 동작과 같습니다.
 */
export function toActiveSignal(row: ActiveSignalRow, type: 'buy' | 'sell'): ActiveSignal {
  const price = row.latest_signal_price;
  return {
    symbol: row.symbol,
    name: row.name || row.symbol,
    market: row.market || '기타',
    signal_type: type === 'buy' ? row.latest_signal_type || 'BUY' : 'SELL',
    source: '',
    timestamp: (type === 'buy' ? row.latest_signal_date : row.latest_sell_date) ?? '',
    signal_price: type === 'buy' && price !== null && price !== undefined ? String(price) : '',
    sector: '',
  };
}
