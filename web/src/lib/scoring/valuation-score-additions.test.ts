import { describe, it, expect } from 'vitest'
import { calcValuationAdditions } from './valuation-score-additions'

describe('calcValuationAdditions', () => {
  it('매출 성장률 25%이면 +10', () => {
    expect(calcValuationAdditions({ revenue_growth_yoy: 25 })).toBe(10)
  })

  it('매출 성장률 10%이면 +5', () => {
    expect(calcValuationAdditions({ revenue_growth_yoy: 10 })).toBe(5)
  })

  it('매출 성장률 3%이면 0', () => {
    expect(calcValuationAdditions({ revenue_growth_yoy: 3 })).toBe(0)
  })

  it('매출 역성장이면 -5', () => {
    expect(calcValuationAdditions({ revenue_growth_yoy: -10 })).toBe(-5)
  })

  it('영업이익 성장률 30%이면 +10', () => {
    expect(calcValuationAdditions({ operating_profit_growth_yoy: 30 })).toBe(10)
  })

  it('복합 가산', () => {
    const result = calcValuationAdditions({
      revenue_growth_yoy: 25,
      operating_profit_growth_yoy: 25,
    })
    expect(result).toBe(20)
  })

  it('null이면 0', () => {
    expect(calcValuationAdditions({})).toBe(0)
  })
})
