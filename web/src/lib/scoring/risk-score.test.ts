import { describe, it, expect } from 'vitest'
import { calcRiskScore } from './risk-score'

describe('calcRiskScore', () => {
  it('관리종목이면 -100 반환', () => {
    const result = calcRiskScore({ is_managed: true })
    expect(result).toBe(-100)
  })

  it('감사의견 비적정이면 -80 반환', () => {
    const result = calcRiskScore({ audit_opinion: '한정' })
    expect(result).toBe(-80)
  })

  it('CB/BW 최근 발행이면 -30 반환 (standard)', () => {
    const result = calcRiskScore({ has_recent_cbw: true }, 'standard')
    expect(result).toBe(-30)
  })

  it('CB/BW 최근 발행이면 -20 반환 (short_term)', () => {
    const result = calcRiskScore({ has_recent_cbw: true }, 'short_term')
    expect(result).toBe(-20)
  })

  it('소형주(3000억 미만) 지분율 5%이면 -20 (standard)', () => {
    const result = calcRiskScore({ major_shareholder_pct: 5, market_cap: 1000 }, 'standard')
    expect(result).toBe(-20)
  })

  it('소형주 지분율 12%이면 감점 없음', () => {
    const result = calcRiskScore({ major_shareholder_pct: 12, market_cap: 1000 })
    expect(result).toBe(0)
  })

  it('중형주(3000억~1조) 지분율 3%이면 -20 (standard)', () => {
    const result = calcRiskScore({ major_shareholder_pct: 3, market_cap: 5000 }, 'standard')
    expect(result).toBe(-20)
  })

  it('중형주 지분율 8%이면 감점 없음', () => {
    const result = calcRiskScore({ major_shareholder_pct: 8, market_cap: 5000 })
    expect(result).toBe(0)
  })

  it('대형주(1조 이상) 지분율 5%이면 감점 없음', () => {
    const result = calcRiskScore({ major_shareholder_pct: 5, market_cap: 20000 })
    expect(result).toBe(0)
  })

  it('최대주주 지분 감소이면 -10 반환', () => {
    const result = calcRiskScore({ major_shareholder_delta: -3 })
    expect(result).toBe(-10)
  })

  it('거래대금 20억이면 -25 반환 (standard)', () => {
    const result = calcRiskScore({ daily_trading_value: 2_000_000_000 }, 'standard')
    expect(result).toBe(-25)
  })

  it('20일 평균 거래대금 40억이면 -15 반환 (standard)', () => {
    const result = calcRiskScore({ avg_trading_value_20d: 4_000_000_000 }, 'standard')
    expect(result).toBe(-15)
  })

  it('회전율 12%이면 -10 반환', () => {
    const result = calcRiskScore({ turnover_rate: 12 })
    expect(result).toBe(-10)
  })

  it('복합 감점 누적 (소형주)', () => {
    const result = calcRiskScore({
      has_recent_cbw: true,
      major_shareholder_pct: 5,
      market_cap: 500,
      daily_trading_value: 2_000_000_000,
    }, 'standard')
    // -30 (CB/BW) + -20 (지분율<10%) + -25 (거래대금<30억) = -75
    expect(result).toBe(-75)
  })

  it('리스크 없으면 0 반환', () => {
    const result = calcRiskScore({
      major_shareholder_pct: 30,
      daily_trading_value: 50_000_000_000,
      avg_trading_value_20d: 40_000_000_000,
      turnover_rate: 3,
    })
    expect(result).toBe(0)
  })
})
