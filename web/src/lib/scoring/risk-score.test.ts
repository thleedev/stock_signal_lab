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

  it('최대주주 지분율 15%이면 -20 반환 (standard)', () => {
    const result = calcRiskScore({ major_shareholder_pct: 15 }, 'standard')
    expect(result).toBe(-20)
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

  it('복합 감점 누적', () => {
    const result = calcRiskScore({
      has_recent_cbw: true,
      major_shareholder_pct: 15,
      daily_trading_value: 2_000_000_000,
    }, 'standard')
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
