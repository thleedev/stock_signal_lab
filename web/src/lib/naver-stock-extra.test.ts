import { describe, it, expect } from 'vitest'
import { parseStockExtra } from './naver-stock-extra'

describe('parseStockExtra', () => {
  it('HTML에서 상장주식수를 파싱한다', () => {
    const html = `
      <th scope="row">상장주식수</th>
      <td><em>5,919,637,922</em></td>
    `
    const result = parseStockExtra(html)
    expect(result.floatShares).toBe(5919637922)
  })

  it('관리종목 마크를 감지한다', () => {
    const html = `<span class="spt_con4">관리종목</span>`
    const result = parseStockExtra(html)
    expect(result.isManaged).toBe(true)
  })

  it('관리종목이 아닌 경우 false', () => {
    const html = `<div>일반 종목</div>`
    const result = parseStockExtra(html)
    expect(result.isManaged).toBe(false)
  })

  it('유통주식수가 없으면 null', () => {
    const html = `<div>데이터 없음</div>`
    const result = parseStockExtra(html)
    expect(result.floatShares).toBeNull()
  })
})
