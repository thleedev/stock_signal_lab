import { describe, it, expect } from 'vitest'
import { parseStockExtra } from './naver-stock-extra'

describe('parseStockExtra', () => {
  it('HTML에서 유통주식수를 파싱한다', () => {
    const html = `
      <table class="tb_type1">
        <tr><th>유통주식수</th><td>12,345,678</td></tr>
      </table>
    `
    const result = parseStockExtra(html)
    expect(result.floatShares).toBe(12345678)
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
