import { calcRSI, calcSMA } from '@/lib/ai-recommendation/technical-score';
import type { DailyPrice } from '@/lib/ai-recommendation/technical-score';
import { ALL_CONDITIONS } from './types';
import type { ConditionResult } from './types';

export type { DailyPrice };

export interface ConditionInput {
  prices: DailyPrice[];
  high52w: number | null;
  low52w: number | null;
  foreignNet: number | null;
  institutionNet: number | null;
  foreignStreak: number | null;
  institutionStreak: number | null;
  currentVolume: number | null;
  avgVolume20d: number | null;
  per: number | null;
  forwardPer: number | null;
  pbr: number | null;
  roe: number | null;
  targetPrice: number | null;
  currentPrice: number | null;
  investOpinion: number | null;
  rsi: number | null;
  pct5d: number;
  shortSellRatio: number | null;
}

/** 숫자를 한국어 형식으로 포맷 (반올림 후 천단위 구분) */
function fmt(n: number): string {
  return Math.round(n).toLocaleString('ko-KR');
}

/**
 * 12개 체크리스트 조건을 평가하여 결과 배열을 반환합니다.
 * ALL_CONDITIONS 순서에 맞게 정확히 12개 결과를 반환합니다.
 */
export function evaluateConditions(input: ConditionInput): ConditionResult[] {
  const closes = input.prices.map((p) => p.close);

  // RSI 계산 (입력값 우선, 없으면 직접 계산)
  const rsiValue: number | null = input.rsi !== null ? input.rsi : calcRSI(closes);

  return ALL_CONDITIONS.map((def): ConditionResult => {
    const base = { id: def.id, label: def.label, category: def.category };

    switch (def.id) {
      // ── 추세 조건 ──

      case 'ma_aligned': {
        if (input.prices.length < 20) {
          return { ...base, met: false, detail: '데이터 없음', na: true };
        }
        const sma5 = calcSMA(closes, 5);
        const sma20 = calcSMA(closes, 20);
        if (input.prices.length < 60) {
          // 60개 미만이면 5일/20일만 부분 비교
          const latest5 = sma5[sma5.length - 1];
          const latest20 = sma20[sma20.length - 1];
          return {
            ...base,
            met: false,
            detail: `5일 ${fmt(latest5)}, 20일 ${fmt(latest20)} (60일 데이터 부족)`,
            na: true,
          };
        }
        const sma60 = calcSMA(closes, 60);
        const latest5 = sma5[sma5.length - 1];
        const latest20 = sma20[sma20.length - 1];
        const latest60 = sma60[sma60.length - 1];
        const met = latest5 > latest20 && latest20 > latest60;
        return {
          ...base,
          met,
          detail: met
            ? `5일 ${fmt(latest5)} > 20일 ${fmt(latest20)} > 60일 ${fmt(latest60)}`
            : `5일 ${fmt(latest5)}, 20일 ${fmt(latest20)}, 60일 ${fmt(latest60)} (정배열 미달)`,
          na: false,
        };
      }

      case 'rsi_buy_zone': {
        if (rsiValue === null) {
          return { ...base, met: false, detail: '데이터 없음', na: true };
        }
        const met = rsiValue >= 30 && rsiValue <= 50;
        return {
          ...base,
          met,
          detail: `RSI ${Math.round(rsiValue)} (${met ? '매수구간 30~50' : '구간 밖'})`,
          na: false,
        };
      }

      case 'macd_golden': {
        if (input.prices.length < 35) {
          return { ...base, met: false, detail: '데이터 없음', na: true };
        }
        // 5일선이 20일선 상향 돌파 (최근 3일 내) — technical-score와 동일 로직
        const sma5 = calcSMA(closes, 5);
        const sma20 = calcSMA(closes, 20);
        let goldenCross = false;
        if (sma5.length >= 4 && sma20.length >= 4) {
          const offset = sma5.length - sma20.length;
          for (let i = Math.max(1, sma20.length - 3); i < sma20.length; i++) {
            const i5 = i + offset;
            if (i5 >= 1 && i5 < sma5.length) {
              if (sma5[i5 - 1] <= sma20[i - 1] && sma5[i5] > sma20[i]) {
                goldenCross = true;
                break;
              }
            }
          }
        }
        const s5 = sma5.length > 0 ? sma5[sma5.length - 1] : 0;
        const s20 = sma20.length > 0 ? sma20[sma20.length - 1] : 0;
        return {
          ...base,
          met: goldenCross,
          detail: goldenCross
            ? `5일선 ${fmt(s5)} > 20일선 ${fmt(s20)} (골든크로스 발생)`
            : `5일선 ${fmt(s5)} ≤ 20일선 ${fmt(s20)} (골든크로스 미발생)`,
          na: false,
        };
      }

      // ── 수급 조건 ──

      case 'foreign_buy': {
        if (input.foreignNet === null) {
          return { ...base, met: false, detail: '데이터 없음', na: true };
        }
        const met = input.foreignNet > 0;
        const streakStr =
          input.foreignStreak !== null
            ? ` (${input.foreignStreak > 0 ? `+${input.foreignStreak}일 연속` : `${input.foreignStreak}일 연속`})`
            : '';
        return {
          ...base,
          met,
          detail: `외국인 순매수 ${fmt(input.foreignNet)}주${streakStr}`,
          na: false,
        };
      }

      case 'institution_buy': {
        if (input.institutionNet === null) {
          return { ...base, met: false, detail: '데이터 없음', na: true };
        }
        const met = input.institutionNet > 0;
        const streakStr =
          input.institutionStreak !== null
            ? ` (${input.institutionStreak > 0 ? `+${input.institutionStreak}일 연속` : `${input.institutionStreak}일 연속`})`
            : '';
        return {
          ...base,
          met,
          detail: `기관 순매수 ${fmt(input.institutionNet)}주${streakStr}`,
          na: false,
        };
      }

      case 'volume_active': {
        if (input.currentVolume === null || input.avgVolume20d === null || input.avgVolume20d === 0) {
          return { ...base, met: false, detail: '데이터 없음', na: true };
        }
        const ratio = input.currentVolume / input.avgVolume20d;
        const met = ratio >= 1.5;
        return {
          ...base,
          met,
          detail: `거래량 ${fmt(input.currentVolume)}주 (20일 평균 대비 ${Math.round(ratio * 10) / 10}배${met ? ' — 활성' : ''})`,
          na: false,
        };
      }

      // ── 밸류에이션 조건 ──

      case 'per_fair': {
        if (input.forwardPer === null && input.per === null) {
          return { ...base, met: false, detail: '데이터 없음', na: true };
        }
        if (input.forwardPer !== null && input.forwardPer > 0) {
          const met = input.forwardPer < 15;
          return {
            ...base,
            met,
            detail: `선행 PER ${Math.round(input.forwardPer * 10) / 10}배 (기준 15배 미만${met ? ' — 적정' : ''})`,
            na: false,
          };
        }
        if (input.per === null || input.per <= 0) {
          return { ...base, met: false, detail: `PER ${input.forwardPer ?? input.per}배 (적자/음수)`, na: false };
        }
        // forwardPer 없거나 음수면 trailing PER < 12
        const met = input.per < 12;
        return {
          ...base,
          met,
          detail: `PER ${Math.round(input.per! * 10) / 10}배 (선행 PER 없음, 기준 12배 미만${met ? ' — 적정' : ''})`,
          na: false,
        };
      }

      case 'target_upside': {
        if (input.targetPrice === null || input.currentPrice === null || input.currentPrice === 0) {
          return { ...base, met: false, detail: '데이터 없음', na: true };
        }
        const upside = (input.targetPrice - input.currentPrice) / input.currentPrice;
        const upsidePct = Math.round(upside * 1000) / 10;
        const met = upside >= 0.15;
        return {
          ...base,
          met,
          detail: `목표주가 ${fmt(input.targetPrice)}원, 현재가 ${fmt(input.currentPrice)}원 (괴리율 +${upsidePct}%${met ? ' — 기준 15% 이상' : ''})`,
          na: false,
        };
      }

      case 'roe_good': {
        if (input.roe === null) {
          return { ...base, met: false, detail: '데이터 없음', na: true };
        }
        const met = input.roe > 10;
        return {
          ...base,
          met,
          detail: `ROE ${Math.round(input.roe * 10) / 10}% (기준 10% 초과${met ? ' — 양호' : ''})`,
          na: false,
        };
      }

      // ── 리스크 조건 (역방향) ──

      case 'no_overbought': {
        if (rsiValue === null) {
          return { ...base, met: false, detail: '데이터 없음', na: true };
        }
        const met = rsiValue < 70;
        return {
          ...base,
          met,
          detail: `RSI ${Math.round(rsiValue)} (${met ? '과매수 아님' : '과매수 구간 70 이상'})`,
          na: false,
        };
      }

      case 'no_surge': {
        // pct5d는 항상 제공되므로 na 없음
        const met = input.pct5d < 15;
        return {
          ...base,
          met,
          detail: `5일 등락률 ${Math.round(input.pct5d * 10) / 10}% (${met ? '급등 없음' : '급등 주의 15% 이상'})`,
          na: false,
        };
      }

      case 'no_smart_exit': {
        if (input.foreignNet === null && input.institutionNet === null) {
          return { ...base, met: false, detail: '데이터 없음', na: true };
        }
        // 외국인·기관 모두 순매도인 경우만 이탈로 판정
        const bothSelling =
          (input.foreignNet !== null ? input.foreignNet < 0 : false) &&
          (input.institutionNet !== null ? input.institutionNet < 0 : false);
        const met = !bothSelling;
        const fStr = input.foreignNet !== null ? `외국인 ${fmt(input.foreignNet)}주` : '외국인 N/A';
        const iStr = input.institutionNet !== null ? `기관 ${fmt(input.institutionNet)}주` : '기관 N/A';
        return {
          ...base,
          met,
          detail: `${fStr}, ${iStr}${bothSelling ? ' — 동반 이탈' : ''}`,
          na: false,
        };
      }

      default:
        return { ...base, met: false, detail: '알 수 없는 조건', na: true };
    }
  });
}
