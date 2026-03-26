import { describe, it, expect } from 'vitest'
import {
  parseCbBwFromDisclosures,
  parseMajorShareholderFromReport,
  parseAuditOpinion,
  parseTreasuryBuyback,
  parseFinancialGrowth,
} from './dart-api'

describe('parseCbBwFromDisclosures', () => {
  it('CB 관련 공시가 있으면 true', () => {
    const disclosures = [
      { report_nm: '전환사채권 발행결정', rcept_dt: '20260101' },
    ]
    expect(parseCbBwFromDisclosures(disclosures)).toBe(true)
  })

  it('BW 관련 공시가 있으면 true', () => {
    const disclosures = [
      { report_nm: '신주인수권부사채 발행결정', rcept_dt: '20260101' },
    ]
    expect(parseCbBwFromDisclosures(disclosures)).toBe(true)
  })

  it('관련 없는 공시만 있으면 false', () => {
    const disclosures = [
      { report_nm: '주주총회 소집결의', rcept_dt: '20260101' },
    ]
    expect(parseCbBwFromDisclosures(disclosures)).toBe(false)
  })
})

describe('parseMajorShareholderFromReport', () => {
  it('지분율과 변동을 파싱한다', () => {
    const data = { trmend_posesn_stock_qota_rt: '25.30', bsis_posesn_stock_qota_rt: '23.10' }
    const result = parseMajorShareholderFromReport(data)
    expect(result.pct).toBeCloseTo(25.3)
    expect(result.delta).toBeCloseTo(2.2)
  })
})

describe('parseAuditOpinion', () => {
  it('적정 의견을 파싱한다', () => {
    expect(parseAuditOpinion({ audit_opinion: '적정' })).toBe('적정')
  })

  it('한정 의견을 파싱한다', () => {
    expect(parseAuditOpinion({ audit_opinion: '한정' })).toBe('한정')
  })
})

describe('parseTreasuryBuyback', () => {
  it('자사주 매입 공시가 있으면 true', () => {
    const disclosures = [
      { report_nm: '자기주식 취득결정', rcept_dt: '20260301' },
    ]
    expect(parseTreasuryBuyback(disclosures)).toBe(true)
  })

  it('없으면 false', () => {
    expect(parseTreasuryBuyback([])).toBe(false)
  })
})

describe('parseFinancialGrowth', () => {
  it('매출/영업이익 성장률을 계산한다', () => {
    const current = { revenue: 1000, operating_profit: 200 }
    const previous = { revenue: 800, operating_profit: 150 }
    const result = parseFinancialGrowth(current, previous)
    expect(result.revenueGrowth).toBeCloseTo(25)
    expect(result.operatingProfitGrowth).toBeCloseTo(33.33, 1)
  })

  it('이전 데이터 없으면 null', () => {
    const result = parseFinancialGrowth({ revenue: 1000, operating_profit: 200 }, null)
    expect(result.revenueGrowth).toBeNull()
    expect(result.operatingProfitGrowth).toBeNull()
  })
})
