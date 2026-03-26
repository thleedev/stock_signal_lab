/**
 * DART OpenAPI 클라이언트
 * CB/BW 발행, 주요주주 현황, 감사의견, 자사주 취득, 재무성장률 데이터 조회
 *
 * 환경변수: DART_API_KEY (무료 tier, 하루 10K 요청 한도)
 */

const DART_BASE = 'https://opendart.fss.or.kr/api'

/** DART API 키를 환경변수에서 가져온다 */
function dartKey(): string {
  const key = process.env.DART_API_KEY
  if (!key) throw new Error('DART_API_KEY 환경변수가 설정되지 않았습니다')
  return key
}

// --- 타입 정의 ---

/** DART 공시 목록 항목 */
interface Disclosure {
  report_nm: string
  rcept_dt: string
}

/** DART fetchDartInfo 반환값 */
export interface DartStockInfo {
  /** 최근 6개월 내 CB/BW 발행 공시 여부 */
  has_recent_cbw: boolean
  /** 최대주주 지분율 (%) */
  major_shareholder_pct: number | null
  /** 최대주주 지분율 변동 (기말 - 기초, %p) */
  major_shareholder_delta: number | null
  /** 감사의견 (적정/한정/부적정/의견거절) */
  audit_opinion: string | null
  /** 최근 6개월 내 자사주 취득 공시 여부 */
  has_treasury_buyback: boolean
  /** 전년 대비 매출 성장률 (%) */
  revenue_growth_yoy: number | null
  /** 전년 대비 영업이익 성장률 (%) */
  operating_profit_growth_yoy: number | null
}

// --- 파서 (순수 함수, 테스트 가능) ---

/**
 * 공시 목록에서 CB(전환사채) 또는 BW(신주인수권부사채) 발행 여부를 반환한다.
 * @param disclosures DART 공시 목록
 */
export function parseCbBwFromDisclosures(disclosures: Disclosure[]): boolean {
  const keywords = ['전환사채', '신주인수권부사채', 'CB', 'BW']
  return disclosures.some((d) =>
    keywords.some((kw) => d.report_nm.includes(kw)),
  )
}

/**
 * 주요주주 현황 보고서에서 지분율과 변동값을 파싱한다.
 * @param data DART hyslrSttus API 응답의 list 항목
 */
export function parseMajorShareholderFromReport(data: {
  trmend_posesn_stock_qota_rt: string
  bsis_posesn_stock_qota_rt: string
}): { pct: number; delta: number } {
  const pct = parseFloat(data.trmend_posesn_stock_qota_rt)
  const prev = parseFloat(data.bsis_posesn_stock_qota_rt)
  return { pct, delta: pct - prev }
}

/**
 * 감사보고서에서 감사의견 문자열을 반환한다.
 * @param data DART irdsSttus API 응답의 list 항목
 */
export function parseAuditOpinion(data: { audit_opinion: string }): string {
  return data.audit_opinion
}

/**
 * 공시 목록에서 자사주 취득 공시 여부를 반환한다.
 * @param disclosures DART 공시 목록
 */
export function parseTreasuryBuyback(disclosures: Disclosure[]): boolean {
  const keywords = ['자기주식 취득', '자사주 취득', '자기주식취득']
  return disclosures.some((d) =>
    keywords.some((kw) => d.report_nm.includes(kw)),
  )
}

/**
 * 당기·전기 재무 데이터로 매출/영업이익 전년 대비 성장률(%)을 계산한다.
 * 이전 데이터가 없거나 0이면 null을 반환한다.
 */
export function parseFinancialGrowth(
  current: { revenue: number; operating_profit: number },
  previous: { revenue: number; operating_profit: number } | null,
): { revenueGrowth: number | null; operatingProfitGrowth: number | null } {
  if (!previous || previous.revenue === 0 || previous.operating_profit === 0) {
    return { revenueGrowth: null, operatingProfitGrowth: null }
  }
  return {
    revenueGrowth:
      ((current.revenue - previous.revenue) / Math.abs(previous.revenue)) * 100,
    operatingProfitGrowth:
      ((current.operating_profit - previous.operating_profit) /
        Math.abs(previous.operating_profit)) *
      100,
  }
}

// --- API 호출 ---

/**
 * DART OpenAPI에 GET 요청을 보내고 JSON을 반환한다.
 * @param path API 경로 (e.g. '/list')
 * @param params 쿼리 파라미터 (crtfc_key 제외)
 */
async function dartFetch(
  path: string,
  params: Record<string, string>,
): Promise<unknown> {
  const url = new URL(`${DART_BASE}${path}.json`)
  url.searchParams.set('crtfc_key', dartKey())
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v)
  }
  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(10000) })
  if (!res.ok) throw new Error(`DART API 오류: HTTP ${res.status}`)
  return res.json()
}

/**
 * DART 기업 코드로 4개 엔드포인트를 병렬 호출해 주요 지표를 집계한다.
 *
 * 조회 항목:
 * - 공시 목록 (CB/BW, 자사주 취득)
 * - 주요주주 현황 (최대주주 지분율/변동)
 * - 감사보고서 (감사의견)
 * - 재무제표 (매출·영업이익 성장률)
 *
 * @param corpCode DART 고유번호 (8자리, e.g. '00126380')
 */
export async function fetchDartInfo(corpCode: string): Promise<DartStockInfo> {
  // 조회 기간: 최근 6개월
  const sixMonthsAgo = new Date()
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)
  const bgn = sixMonthsAgo.toISOString().slice(0, 10).replace(/-/g, '')
  const end = new Date().toISOString().slice(0, 10).replace(/-/g, '')

  // 전년도 사업연도 기준
  const prevYear = String(new Date().getFullYear() - 1)
  const reprtCode = '11011' // 사업보고서

  // 4개 API 병렬 호출 (개별 실패 허용)
  const [disclosures, shareholder, audit, financials] = await Promise.allSettled([
    dartFetch('/list', {
      corp_code: corpCode,
      bgn_de: bgn,
      end_de: end,
      page_count: '100',
    }),
    dartFetch('/hyslrSttus', {
      corp_code: corpCode,
      bsns_year: prevYear,
      reprt_code: reprtCode,
    }),
    dartFetch('/irdsSttus', {
      corp_code: corpCode,
      bsns_year: prevYear,
      reprt_code: reprtCode,
    }),
    dartFetch('/fnlttSinglAcntAll', {
      corp_code: corpCode,
      bsns_year: prevYear,
      reprt_code: reprtCode,
      fs_div: 'CFS', // 연결재무제표
    }),
  ])

  // CB/BW 및 자사주 취득 공시 파싱
  let has_recent_cbw = false
  let has_treasury_buyback = false
  if (disclosures.status === 'fulfilled') {
    const list =
      ((disclosures.value as { list?: Disclosure[] }).list) ?? []
    has_recent_cbw = parseCbBwFromDisclosures(list)
    has_treasury_buyback = parseTreasuryBuyback(list)
  }

  // 주요주주 지분율 파싱
  let major_shareholder_pct: number | null = null
  let major_shareholder_delta: number | null = null
  if (shareholder.status === 'fulfilled') {
    const data = shareholder.value as {
      list?: Array<{
        trmend_posesn_stock_qota_rt: string
        bsis_posesn_stock_qota_rt: string
      }>
    }
    if (data.list?.[0]) {
      const parsed = parseMajorShareholderFromReport(data.list[0])
      major_shareholder_pct = parsed.pct
      major_shareholder_delta = parsed.delta
    }
  }

  // 감사의견 파싱
  let audit_opinion: string | null = null
  if (audit.status === 'fulfilled') {
    const data = audit.value as {
      list?: Array<{ audit_opinion: string }>
    }
    if (data.list?.[0]) {
      audit_opinion = parseAuditOpinion(data.list[0])
    }
  }

  // 매출·영업이익 성장률 파싱
  let revenue_growth_yoy: number | null = null
  let operating_profit_growth_yoy: number | null = null
  if (financials.status === 'fulfilled') {
    const data = financials.value as {
      list?: Array<{
        account_nm: string
        thstrm_amount: string
        frmtrm_amount: string
      }>
    }
    if (data.list) {
      const revenue = data.list.find(
        (r) => r.account_nm === '매출액' || r.account_nm === '수익(매출액)',
      )
      const op = data.list.find((r) => r.account_nm === '영업이익')
      if (revenue && op) {
        const cur = {
          revenue: parseInt(revenue.thstrm_amount?.replace(/,/g, '') || '0', 10),
          operating_profit: parseInt(op.thstrm_amount?.replace(/,/g, '') || '0', 10),
        }
        const prev = {
          revenue: parseInt(revenue.frmtrm_amount?.replace(/,/g, '') || '0', 10),
          operating_profit: parseInt(op.frmtrm_amount?.replace(/,/g, '') || '0', 10),
        }
        const growth = parseFinancialGrowth(cur, prev)
        revenue_growth_yoy = growth.revenueGrowth
        operating_profit_growth_yoy = growth.operatingProfitGrowth
      }
    }
  }

  return {
    has_recent_cbw,
    major_shareholder_pct,
    major_shareholder_delta,
    audit_opinion,
    has_treasury_buyback,
    revenue_growth_yoy,
    operating_profit_growth_yoy,
  }
}
