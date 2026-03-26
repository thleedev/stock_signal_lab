import { describe, it, expect } from 'vitest'
import { calcSupplyAdditions } from './supply-score-additions'

describe('calcSupplyAdditions', () => {
  it('거래대금 300억 이상이면 +15', () => {
    expect(calcSupplyAdditions({ daily_trading_value: 35_000_000_000 })).toBe(15)
  })

  it('거래대금 100억~300억이면 +10', () => {
    expect(calcSupplyAdditions({ daily_trading_value: 15_000_000_000 })).toBe(10)
  })

  it('거래대금 100억 미만이면 0', () => {
    expect(calcSupplyAdditions({ daily_trading_value: 5_000_000_000 })).toBe(0)
  })

  it('거래대금 급증 2배 이상이면 +10', () => {
    expect(calcSupplyAdditions({
      daily_trading_value: 20_000_000_000,
      avg_trading_value_20d: 8_000_000_000,
    })).toBe(10 + 10)
  })

  it('거래대금 급증 1.5배이면 +5', () => {
    expect(calcSupplyAdditions({
      daily_trading_value: 15_000_000_000,
      avg_trading_value_20d: 9_000_000_000,
    })).toBe(10 + 5)
  })

  it('회전율 1~5%이면 +5', () => {
    expect(calcSupplyAdditions({ turnover_rate: 3 })).toBe(5)
  })

  it('회전율 5% 초과이면 0', () => {
    expect(calcSupplyAdditions({ turnover_rate: 7 })).toBe(0)
  })

  it('자사주 매입이면 +10', () => {
    expect(calcSupplyAdditions({ has_treasury_buyback: true })).toBe(10)
  })

  it('최대주주 지분 증가이면 +5', () => {
    expect(calcSupplyAdditions({ major_shareholder_delta: 2.5 })).toBe(5)
  })

  it('복합 점수 누적', () => {
    const result = calcSupplyAdditions({
      daily_trading_value: 35_000_000_000,
      avg_trading_value_20d: 15_000_000_000,
      turnover_rate: 3,
      has_treasury_buyback: true,
      major_shareholder_delta: 1,
    })
    expect(result).toBe(45)
  })
})
