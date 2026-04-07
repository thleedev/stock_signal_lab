/**
 * 초단기 모멘텀 추천 - 1차 필터 (pre-filter)
 *
 * 스코어링 전에 명백히 부적격한 종목을 제거한다.
 * 통과 조건:
 *   - 등락률: >= +0.5% AND < +8%
 *   - 거래대금: >= 200억
 *   - 종가 위치: >= 0.5 (고가=저가 시 1.0 간주)
 *   - 수급: 외국인/기관 중 1개 이상 순매수
 *   - 과열: 3일 누적 +20% 초과 제외
 *   - 촉매: 최근 3일 내 BUY 신호 또는 당일 섹터 강세
 */

export interface PreFilterInput {
  /** 당일 등락률 (%) */
  priceChangePct: number;
  /** 당일 거래대금 (원) */
  tradingValue: number;
  /** (종가-저가)/(고가-저가), 0~1 범위 */
  closePosition: number;
  /** 당일 고가 */
  highPrice: number;
  /** 당일 저가 */
  lowPrice: number;
  /** 외국인 순매수 (주 수, null 허용) */
  foreignNet: number | null;
  /** 기관 순매수 (주 수, null 허용) */
  institutionNet: number | null;
  /** 마지막 BUY 신호로부터 경과일 */
  daysSinceLastBuy: number;
  /** 당일 섹터 강세 여부 */
  sectorStrong: boolean;
  /** 3거래일 누적 등락률 (%) */
  cumReturn3d: number;
  /** 당일 OHLCV 데이터 존재 여부 (false면 거래대금/종가위치 필터 완화) */
  hasTodayCandle?: boolean;
  /** 오늘 BUY 소스 수 (0~3, 촉매 강도 판단용) */
  todayBuySources?: number;
}

export interface PreFilterResult {
  /** 필터 통과 여부 */
  passed: boolean;
  /** 탈락 사유 목록 (통과 시 빈 배열) */
  reasons: string[];
}

/** 최소 거래대금 기준: 200억 원 */
const TRADING_VALUE_MIN = 200_0000_0000;

/**
 * 1차 필터를 적용하여 종목의 초단기 모멘텀 후보 자격을 판정한다.
 *
 * @param input - 필터 입력 데이터
 * @returns 통과 여부 및 탈락 사유
 */
export function applyPreFilter(input: PreFilterInput): PreFilterResult {
  const reasons: string[] = [];

  // 종가위치: 고가=저가(상한가/하한가) 시 1.0 간주
  const closePos =
    input.highPrice === input.lowPrice ? 1.0 : input.closePosition;

  const hasCandle = input.hasTodayCandle !== false;

  // 촉매 강도 판단: BUY 소스 2개 이상 또는 섹터 강세이면 "강한 촉매"
  const strongCatalyst = (input.todayBuySources ?? 0) >= 2 || input.sectorStrong;

  // 1. 등락률 범위 검증
  //    - 강한 촉매 시: -1% 이상이면 통과 (아직 안 오른 종목도 포함)
  //    - 당일 신호 존재 시: 0% 이상 허용 (신호 직후 미반응 = 최적 진입 타이밍)
  //    - 기본: +0.5% 이상
  //    - 상한: 8% 미만 (공통)
  if (hasCandle) {
    const signalToday = (input.todayBuySources ?? 0) >= 1;
    const lowerBound = strongCatalyst ? -1 : signalToday ? 0 : 0.5;
    if (input.priceChangePct < lowerBound || input.priceChangePct >= 8) {
      reasons.push('등락률 범위 미달');
    }
  }

  // 2. 거래대금 검증 (200억 고정 — 유동성 리스크 방지)
  if (hasCandle && input.tradingValue < TRADING_VALUE_MIN) {
    reasons.push('거래대금 미달');
  }

  // 3. 종가 위치 검증 — 강한 촉매 시 0.4로 완화 (0.3은 음봉전환 리스크)
  const closePosMin = strongCatalyst ? 0.4 : 0.5;
  if (hasCandle && closePos < closePosMin) {
    reasons.push('종가위치 미달');
  }

  // 4. 수급 검증 (외국인/기관 중 1개 이상 순매수)
  //    수급 데이터가 null이면 (장중/데이터 부족) 통과시킴
  const hasForeignBuy = (input.foreignNet ?? 0) > 0;
  const hasInstitutionBuy = (input.institutionNet ?? 0) > 0;
  const supplyDataExists = input.foreignNet !== null || input.institutionNet !== null;
  if (supplyDataExists && !hasForeignBuy && !hasInstitutionBuy) {
    reasons.push('수급 미달');
  }

  // 5. 과열 검증 (3일 누적 +20% 초과 제외)
  if (input.cumReturn3d > 20) {
    reasons.push('과열');
  }

  // 6. 촉매 검증 (최근 3일 내 BUY 신호 또는 섹터 강세)
  const hasCatalyst = input.daysSinceLastBuy <= 3 || input.sectorStrong;
  if (!hasCatalyst) {
    reasons.push('촉매 미달');
  }

  return { passed: reasons.length === 0, reasons };
}
