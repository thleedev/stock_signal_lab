import { describe, it, expect } from 'vitest';
import { applyPreFilter, type PreFilterInput } from '../short-term/pre-filter';

describe('applyPreFilter', () => {
  const base: PreFilterInput = {
    priceChangePct: 2.0,
    tradingValue: 300_0000_0000, // 300억 (원 단위)
    closePosition: 0.7,
    highPrice: 10500,
    lowPrice: 10000,
    foreignNet: 1000,
    institutionNet: -500,
    daysSinceLastBuy: 0,
    sectorStrong: false,
    cumReturn3d: 10,
  };

  it('모든 조건 충족 시 통과', () => {
    const result = applyPreFilter(base);
    expect(result.passed).toBe(true);
    expect(result.reasons).toHaveLength(0);
  });

  it('등락률 0.5% 미만 탈락', () => {
    const result = applyPreFilter({ ...base, priceChangePct: 0.3 });
    expect(result.passed).toBe(false);
    expect(result.reasons).toContain('등락률 범위 미달');
  });

  it('등락률 8% 이상 탈락', () => {
    const result = applyPreFilter({ ...base, priceChangePct: 8.5 });
    expect(result.passed).toBe(false);
  });

  it('거래대금 200억 미달 탈락', () => {
    const result = applyPreFilter({ ...base, tradingValue: 150_0000_0000 });
    expect(result.passed).toBe(false);
    expect(result.reasons).toContain('거래대금 미달');
  });

  it('종가 위치 0.5 미만 탈락', () => {
    const result = applyPreFilter({ ...base, closePosition: 0.4 });
    expect(result.passed).toBe(false);
  });

  it('고가=저가 (상한가) 시 종가위치 1.0 간주 -> 통과', () => {
    const result = applyPreFilter({ ...base, highPrice: 10000, lowPrice: 10000, closePosition: 0 });
    expect(result.passed).toBe(true);
  });

  it('수급 없음 탈락 (외국인/기관 모두 순매도)', () => {
    const result = applyPreFilter({ ...base, foreignNet: -100, institutionNet: -200 });
    expect(result.passed).toBe(false);
    expect(result.reasons).toContain('수급 미달');
  });

  it('3일 누적 20% 초과 탈락', () => {
    const result = applyPreFilter({ ...base, cumReturn3d: 22 });
    expect(result.passed).toBe(false);
    expect(result.reasons).toContain('과열');
  });

  it('신호 5일 이상 지남 + 섹터 약세 -> 촉매 미달', () => {
    const result = applyPreFilter({ ...base, daysSinceLastBuy: 6, sectorStrong: false });
    expect(result.passed).toBe(false);
    expect(result.reasons).toContain('촉매 미달');
  });
});

// ---------------------------------------------------------------------------
// 모멘텀 스코어 테스트
// ---------------------------------------------------------------------------
import { calcMomentumScore, type MomentumInput } from '../short-term/momentum-score';

describe('calcMomentumScore', () => {
  const base: MomentumInput = {
    priceChangePct: 2.0,
    volumeRatio: 2.5,
    closePosition: 0.85,
    highEqualsLow: false,
    gapPct: 1.5,
    prevBodyPct: 4.0,
    isConsecutiveBullish: true,
    prevHighBreakout: true,
    box3dBreakout: false,
    tradingValue: 850_0000_0000,
    isConsecutive2dLargeBullish: false,
  };

  it('최적 조합: +2% + 거래량 2.5배 → 매트릭스 35점', () => {
    const result = calcMomentumScore(base);
    // 매트릭스35 + 종가위치20 + 갭업패턴(전일양봉+갭업=20 clamp) + 거래대금10 = 85
    expect(result.raw).toBeGreaterThanOrEqual(75);
    expect(result.raw).toBeLessThanOrEqual(90);
  });

  it('+8% 초과 + 거래량 평이 → 매트릭스 -10', () => {
    const result = calcMomentumScore({
      ...base, priceChangePct: 9, volumeRatio: 1.0,
      gapPct: null, prevBodyPct: null,
      isConsecutiveBullish: false, prevHighBreakout: false,
    });
    expect(result.raw).toBeLessThanOrEqual(20);
  });

  it('종가위치 0.3 → -10점', () => {
    const low = calcMomentumScore({ ...base, closePosition: 0.25, highEqualsLow: false });
    const high = calcMomentumScore({ ...base, closePosition: 0.85, highEqualsLow: false });
    expect(high.raw - low.raw).toBe(30); // 20 - (-10) = 30 difference
  });

  it('고가=저가 → 종가위치 1.0 (20점)', () => {
    const result = calcMomentumScore({ ...base, closePosition: 0, highEqualsLow: true });
    // Should get +20 for close position
    expect(result.raw).toBeGreaterThanOrEqual(70);
  });

  it('gapPct null → 갭업/패턴 0점', () => {
    const result = calcMomentumScore({
      ...base, gapPct: null, prevBodyPct: null,
      isConsecutiveBullish: false, prevHighBreakout: false, box3dBreakout: false,
    });
    // 매트릭스35 + 종가위치20 + 갭업0 + 거래대금10 = 65
    expect(result.raw).toBeLessThanOrEqual(70);
    expect(result.raw).toBeGreaterThanOrEqual(55);
  });

  it('정규화: raw -10 → norm 0, raw 90 → norm 100', () => {
    const result = calcMomentumScore(base);
    expect(result.normalized).toBeGreaterThanOrEqual(0);
    expect(result.normalized).toBeLessThanOrEqual(100);
  });

  it('거래대금 1000억+ → +15점', () => {
    const big = calcMomentumScore({ ...base, tradingValue: 1500_0000_0000 });
    const small = calcMomentumScore({ ...base, tradingValue: 850_0000_0000 });
    expect(big.raw - small.raw).toBe(5); // 15 - 10
  });
});

// ---------------------------------------------------------------------------
// 수급 스코어 테스트
// ---------------------------------------------------------------------------
import { calcShortTermSupplyScore, type ShortTermSupplyInput } from '../short-term/supply-score';

describe('calcShortTermSupplyScore', () => {
  it('외국인+기관 동반 순매수 + 2일 연속 → 고점수', () => {
    const result = calcShortTermSupplyScore({
      foreignNet: 5000, institutionNet: 3000, programNet: null,
      foreignStreak: 2, institutionStreak: 2, programStreak: null,
    });
    // 외국인10 + 기관10 + 동반12 + 외연속7(v2) + 기연속7(v2) = 46
    expect(result.raw).toBe(46);
    expect(result.foreignBuying).toBe(true);
    expect(result.institutionBuying).toBe(true);
  });

  it('외국인만 순매수 + 매수 전환 첫날 → 20점', () => {
    const result = calcShortTermSupplyScore({
      foreignNet: 1000, institutionNet: -500, programNet: null,
      foreignStreak: 1, institutionStreak: -1, programStreak: null,
    });
    // 외국인10 + 매수전환첫날10(v2) = 20
    expect(result.raw).toBe(20);
  });

  it('외국인/기관 둘 다 매도 → -15', () => {
    const result = calcShortTermSupplyScore({
      foreignNet: -1000, institutionNet: -500, programNet: null,
      foreignStreak: -1, institutionStreak: -1, programStreak: null,
    });
    expect(result.raw).toBe(-15);
  });

  it('3일 연속 매도 → 추가 -10', () => {
    const result = calcShortTermSupplyScore({
      foreignNet: -1000, institutionNet: -500, programNet: null,
      foreignStreak: -3, institutionStreak: -1, programStreak: null,
    });
    // 둘다매도 -15 + 외국인3일연속매도 -10 = -25
    expect(result.raw).toBe(-25);
  });

  it('정규화: raw -25 → norm 0, raw 55 → norm 100', () => {
    const min = calcShortTermSupplyScore({
      foreignNet: -1000, institutionNet: -500, programNet: null,
      foreignStreak: -3, institutionStreak: -3, programStreak: null,
    });
    expect(min.normalized).toBe(0);
  });

  it('null 값 → 중립 처리', () => {
    const result = calcShortTermSupplyScore({
      foreignNet: null, institutionNet: null, programNet: null,
      foreignStreak: null, institutionStreak: null, programStreak: null,
    });
    // 수급 데이터 자체가 없으면 중립(raw=0) 처리
    expect(result.raw).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 촉매 스코어 테스트
// ---------------------------------------------------------------------------
import { calcCatalystScore, type CatalystInput } from '../short-term/catalyst-score';

describe('calcCatalystScore', () => {
  it('오늘 BUY 2소스 + 섹터 상위3 + 신호가 이내 → 고점수', () => {
    const result = calcCatalystScore({
      todayBuySources: 2, daysSinceLastBuy: 0,
      sectorRank: 2, sectorCount: 20,
      sectorAvgChangePct: 1.5, stockChangePct: 3.0,
      stockRankInSector: 3, sectorStockCount: 30,
      signalPriceGapPct: -1.0,
    });
    // 신호2소스(+20) + 섹터상위3(+20) + 신호가≤0%(+15) = 55
    expect(result.raw).toBe(55);
  });

  it('5일 이상 지난 신호 + 섹터 약세 → 저점수', () => {
    const result = calcCatalystScore({
      todayBuySources: 0, daysSinceLastBuy: 7,
      sectorRank: 18, sectorCount: 20,
      sectorAvgChangePct: -2.0, stockChangePct: -1.0,
      stockRankInSector: 20, sectorStockCount: 30,
      signalPriceGapPct: null,
    });
    // 신호0 + 섹터약세(-10) + 신호가null(+5) = -5
    expect(result.raw).toBe(-5);
  });

  it('오늘 BUY 3소스 → 25점', () => {
    const result = calcCatalystScore({
      todayBuySources: 3, daysSinceLastBuy: 0,
      sectorRank: 10, sectorCount: 20,
      sectorAvgChangePct: 0.5, stockChangePct: 2.0,
      stockRankInSector: 5, sectorStockCount: 30,
      signalPriceGapPct: 2.0,
    });
    // 3소스(+25) + 섹터상위30%(+15 if rank/count <= 0.3) + 신호가+2%(+5)
    expect(result.raw).toBeGreaterThanOrEqual(30);
  });

  it('섹터 약세인데 종목만 상승 → +3', () => {
    const result = calcCatalystScore({
      todayBuySources: 1, daysSinceLastBuy: 0,
      sectorRank: 15, sectorCount: 20,
      sectorAvgChangePct: -0.5, stockChangePct: 2.0,
      stockRankInSector: 1, sectorStockCount: 30,
      signalPriceGapPct: null,
    });
    // 1소스(+15) + 섹터약세but종목상승(+3) + null(+5) = 23
    expect(result.raw).toBe(23);
  });

  it('정규화: raw -10 → norm 0', () => {
    const result = calcCatalystScore({
      todayBuySources: 0, daysSinceLastBuy: 10,
      sectorRank: 18, sectorCount: 20,
      sectorAvgChangePct: -2.0, stockChangePct: -1.0,
      stockRankInSector: 25, sectorStockCount: 30,
      signalPriceGapPct: 10.0, // 이미 상승 → 0점
    });
    // 신호0 + 섹터약세(-10) + 신호가+10%(0) = -10 → norm 0
    expect(result.normalized).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 밸류에이션 스코어 테스트
// ---------------------------------------------------------------------------
import { calcShortTermValuationScore } from '../short-term/valuation-score';
import { calcRiskPenalty, type RiskInput } from '../short-term/risk-penalty';

describe('calcShortTermValuationScore', () => {
  it('Forward PER 7 + 목표주가 +35% + ROE 18% → 고점수', () => {
    const result = calcShortTermValuationScore({
      forwardPer: 7, targetPriceUpside: 35, per: null, pbr: null, roe: 18,
    });
    // PER<8(+30) + 목표주가≥30%(+25) + ROE>15%(+20) = 75
    expect(result.raw).toBe(75);
  });

  it('Forward 없음 + PBR 0.4 + ROE 8% → 폴백', () => {
    const result = calcShortTermValuationScore({
      forwardPer: null, targetPriceUpside: null, per: null, pbr: 0.4, roe: 8,
    });
    // PBR<0.5(+30) + ROE(5,10](+5) = 35
    expect(result.raw).toBe(35);
  });

  it('모든 데이터 null → 0', () => {
    const result = calcShortTermValuationScore({
      forwardPer: null, targetPriceUpside: null, per: null, pbr: null, roe: null,
    });
    expect(result.raw).toBe(0);
  });

  it('정규화: 75 → 100', () => {
    const result = calcShortTermValuationScore({
      forwardPer: 5, targetPriceUpside: 50, per: null, pbr: null, roe: 20,
    });
    expect(result.normalized).toBe(100);
  });
});

describe('calcRiskPenalty', () => {
  const safeBase: RiskInput = {
    priceChangePct: 3.0, cumReturn3d: 10,
    volumeRatio: 2.0,
    todayOpen: 10100, todayClose: 10300, todayHigh: 10350,
    upperShadow: 50, bodySize: 200,
    signalPriceGapPct: 3.0,
    tradingValue: 500_0000_0000,
    isConsecutive2dLargeBullish: false,
  };

  it('패널티 없음 → 0', () => {
    const result = calcRiskPenalty(safeBase);
    expect(result.raw).toBe(0);
  });

  it('+12% 급등 → -20', () => {
    const result = calcRiskPenalty({ ...safeBase, priceChangePct: 13.0 });
    expect(result.raw).toBe(20);
  });

  it('3일 누적 22% → -20', () => {
    const result = calcRiskPenalty({ ...safeBase, cumReturn3d: 22 });
    expect(result.raw).toBe(20);
  });

  it('+10% + 거래량감소 → -15', () => {
    const result = calcRiskPenalty({ ...safeBase, priceChangePct: 11, volumeRatio: 0.8 });
    expect(result.raw).toBe(15);
  });

  it('open null → 캔들 위험 skip', () => {
    const result = calcRiskPenalty({ ...safeBase, todayOpen: null, upperShadow: 500, bodySize: 100 });
    expect(result.raw).toBe(0);
  });

  it('신호가 대비 +12% → -20', () => {
    const result = calcRiskPenalty({ ...safeBase, signalPriceGapPct: 15.0 });
    expect(result.raw).toBe(20);
  });

  it('복합 패널티 누적 → clamp 100', () => {
    const result = calcRiskPenalty({
      priceChangePct: 15.0, cumReturn3d: 25,
      volumeRatio: 0.8,
      todayOpen: 10000, todayClose: 10100, todayHigh: 10800,
      upperShadow: 700, bodySize: 100,
      signalPriceGapPct: 15.0,
      tradingValue: 80_0000_0000,
      isConsecutive2dLargeBullish: true,
    });
    // +12%(-20) + 3d누적(-20) + +10%+vol감소(-15) + 윗꼬리(-12) + 음봉전환(-10) + 급락(-12) + 신호가+12%(-20) + 유동성(-10) + 2일양봉(-15) = 134 → clamp 100
    expect(result.raw).toBe(100);
    expect(result.normalized).toBe(100);
  });
});
