# AI신호 날짜조회 + 일간리포트 AI분석 강화 설계

## 개요

AI신호 탭에 과거 날짜 조회 기능을 추가하고, 일간 리포트를 30년차 애널리스트 수준의 상세 AI 분석 리포트로 강화한다. 외국인/기관/개인 매매동향 데이터를 KIS OpenAPI로 수집하여 리포트에 포함한다.

## 설계 결정 사항

- AI신호 탭: 독립 확장 (리포트 페이지와 통합하지 않음)
- 일간 리포트: 기존 cron 확장 방식
- 매매동향 데이터: KIS OpenAPI 우선, 네이버 금융 스크래핑 폴백
- AI 프로바이더: Gemini만 사용, 추상화 레이어로 확장 가능하게
- 리포트 생성: 장 마감 후(15:30 KST) 하루 1회
- 수집기(Android): 변경 없음 (가격 데이터 이미 전송 중)

---

## 섹션 1: AI신호 탭 과거 날짜 조회 + 가격 표시

### 1-1. 날짜 선택기 추가

**파일:** `app/signals/page.tsx`

- `searchParams`에 `date` 파라미터 추가
- 기본값: 오늘 (KST)
- `?date=2026-03-10` 형태로 과거 조회
- 과거 날짜: 제목 "2026-03-10의 신호"로 변경
- 장중 자동 새로고침: 오늘 날짜일 때만 동작 → `SignalColumns`에 `isToday` prop 추가
- **ISR 캐싱 전략**: 과거 날짜(`date !== today`)는 `revalidate`를 길게(86400초/1일) 설정. 오늘 날짜는 기존 30초 유지. `generateStaticParams`는 사용하지 않고 동적 렌더링으로 처리.

### 1-2. DateSelector 공용 컴포넌트

**파일:** `components/common/date-selector.tsx` (신규)

- 최근 7일 빠른 선택 버튼
- 달력 아이콘 클릭 → 달력 피커 펼침 (더 과거 날짜 선택)
- `/signals`와 `/reports` 모두에서 재사용
- Props: `selectedDate`, `basePath`, `quickDays`(기본 7), `preserveParams?: Record<string, string>` (기존 쿼리 파라미터 보존)
- **쿼리 파라미터 보존**: 날짜 변경 시 기존 `source` 등 다른 파라미터를 URL에 유지. 소스 탭 링크도 현재 `date` 파라미터를 보존하도록 `page.tsx`에서 수정.
- **날짜 범위 정책**: signals/reports 모두 최대 90일 전까지 조회 가능. 주말/공휴일 선택 시 데이터 없음 안내 ("해당 날짜에 수집된 신호가 없습니다") 표시. 달력에서 미래 날짜 선택 비활성화.

### 1-3. 가격 정보 표시 강화

**파일:** `app/signals/signal-columns.tsx`

현재 `signal_price`만 표시 → `raw_data`에서 소스별 추가 가격 정보 추출:

| 소스 | 추가 표시 필드 |
|------|----------------|
| Quant 매수완료 | `buy_price`, `stop_loss_price` |
| Quant 매수예고 | `ai_rise_prob`, `price_attractiveness` |
| Quant 매도완료 | `sell_price`, `return_pct` |
| Stockbot | `recommend_price`, `buy_range_low~high`, `target_price`, `stop_loss_price` |
| Lassi | `signal_price` (기존 유지) |

---

## 섹션 2: 일간 리포트 AI 분석 강화

### 2-1. AI 프로바이더 추상화 레이어

**디렉토리:** `lib/ai/`

```
lib/ai/
├── types.ts     — AIProvider 인터페이스, AIRequest, AIResponse 타입
├── gemini.ts    — Gemini 구현체 (기존 로직 이관)
└── index.ts     — getAIProvider(name) 팩토리 함수
```

**AIProvider 인터페이스:**
```typescript
interface AIProvider {
  name: string;
  generateReport(prompt: string, options?: GenerateOptions): Promise<string>;
}

interface GenerateOptions {
  temperature?: number;
  maxTokens?: number;
}
```

현재는 Gemini만 구현. 추후 OpenAI 등 추가 시 `lib/ai/openai.ts` 생성 후 팩토리에 등록.

### 2-2. 리포트 프롬프트 강화

**파일:** `app/api/v1/cron/daily-report/route.ts`

현재 4섹션 × 2-3문장 → **7섹션 상세 리포트**:

| # | 섹션 | 내용 | 분량 |
|---|------|------|------|
| 1 | 시장 종합 진단 | KOSPI/KOSDAQ 흐름, 글로벌 지표 해석 | 2-3 문단 |
| 2 | AI 매매신호 분석 | 소스별 신호 특성, 매수/매도 비율, 업종 집중도 | 2-3 문단 |
| 3 | 주목 종목 상세 | 다중 소스 추천 종목별 가격·업종·테마 분석 | 종목당 1문단 |
| 4 | 투자자별 매매동향 | 외국인/기관/개인 순매수·순매도 상위, 수급 해석 | 2-3 문단 |
| 5 | 업종 동향 | 매수신호 집중 업종, 매도신호 집중 업종 분석 | 1-2 문단 |
| 6 | 리스크 점검 | VIX, 환율, 금리 등 위험 요소 평가 | 1-2 문단 |
| 7 | 애널리스트 종합 의견 | 30년차 관점의 투자 전략, 포지션 제안 | 2-3 문단 |

**프롬프트 변경:**
- 페르소나: "30년 경력 한국 주식시장 수석 애널리스트"
- `maxOutputTokens`: 1024 → 4096
- `temperature`: 0.7 → 0.5
- `export const maxDuration = 120` 추가 (KIS API + Gemini 4096토큰 생성 시간 확보)

**프롬프트에 추가되는 데이터:**
- 투자자별 매매동향 (외국인/기관/개인 순매수·순매도 금액 + 상위 종목)
- 신호 종목의 업종 분류 정보
- 신호 종목의 가격 정보 (raw_data에서 추출)

### 2-3. AI 리포트 저장 구조 변경

**스키마 변경:** `daily_report_summary` 테이블에 `ai_report_sections JSONB` 컬럼 추가

기존 `ai_summary TEXT` 컬럼은 하위 호환을 위해 유지하되, 새 리포트는 `ai_report_sections`에 구조화된 JSON으로 저장:

```typescript
interface ReportSections {
  sections: {
    id: string;           // "market-overview", "signal-analysis", etc.
    title: string;        // "시장 종합 진단"
    content: string;      // 마크다운 본문
    icon?: string;        // 섹션 아이콘
  }[];
  generated_at: string;
  provider: string;       // "gemini"
  model: string;          // "gemini-2.0-flash"
}
```

AI 응답을 `## 섹션제목` 기준으로 파싱하여 구조화 후 저장. `ai_summary`에는 전체 텍스트도 병렬 저장 (하위 호환).

**DB 마이그레이션:**
```sql
ALTER TABLE daily_report_summary
  ADD COLUMN ai_report_sections JSONB;
```

### 2-4. 리포트 UI 리뉴얼

**파일:** `app/reports/page.tsx`

- 각 섹션을 접이식(collapsible) 카드로 표시 (`ai_report_sections` JSONB에서 읽음)
- 시장점수 시각화 (색상 코드 바)
- 주목 종목: 가격 정보 포함 카드 형태
- 매매동향: `investor_trends` 테이블에서 외국인/기관/개인 순매수·순매도 금액 시각화
- 날짜 선택기: `DateSelector` 컴포넌트 재사용
- 폴백: `ai_report_sections`가 없는 과거 리포트는 기존 `ai_summary` 텍스트로 표시

---

## 섹션 3: 외국인/기관/개인 매매동향 데이터

### 3-1. KIS OpenAPI 연동

기존 `lib/kis-api.ts`의 KIS 클라이언트(OAuth 토큰 발급/갱신)를 재사용하여 투자자별 매매동향 함수 추가.

**파일:** `lib/kis-api.ts` (기존 파일 확장)

**KIS API 투자자별 매매동향:**
- 시장 전체 투자자 순매수 집계: TR ID `FHKST03010100` (`/uapi/domestic-stock/v1/quotations/inquire-investor`)
  - 외국인/기관/개인 매수·매도·순매수 금액 (KOSPI/KOSDAQ 전체)
- 종목별 투자자 매매 순위: TR ID `FHKST03010200` 또는 네이버 API 폴백
  - 외국인/기관 순매수 상위 종목 리스트

> **참고:** 구현 시 KIS OpenAPI 포털에서 TR ID별 실제 응답 필드를 검증해야 함. 종목별 순위 데이터가 KIS API에서 직접 제공되지 않을 경우, 시장 전체 집계는 KIS API로, 종목별 순위는 네이버 API로 분리 조회.

**환경변수:** 기존 `KIS_APP_KEY`, `KIS_APP_SECRET`, `KIS_ACCOUNT_NO` 재사용.

### 3-2. 폴백 스크래핑

**파일:** `lib/kis/fallback-scraper.ts` (신규)

- KIS API 호출 실패 시 네이버 금융 모바일 API에서 투자자별 매매동향 조회
- 기존 `lib/naver-stock-api.ts`는 전종목 시세 조회 전용이므로 별도 파일로 분리 (투자자 매매동향은 다른 API 엔드포인트)
- 네이버 모바일 API에서 JSON 제공 여부 우선 확인, 불가 시 HTML 파싱

### 3-3. 매매동향 DB 테이블

**테이블:** `investor_trends` (신규)

```sql
CREATE TABLE investor_trends (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  market VARCHAR(10),           -- KOSPI, KOSDAQ
  investor_type VARCHAR(20),    -- foreign, institution, individual
  buy_amount BIGINT,
  sell_amount BIGINT,
  net_amount BIGINT,
  top_buy_stocks JSONB,         -- [{symbol, name, amount}]
  top_sell_stocks JSONB,        -- [{symbol, name, amount}]
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(date, market, investor_type)
);
```

### 3-4. Cron 연동

**파일:** `app/api/v1/cron/daily-report/route.ts`

장 마감 15:30 KST cron 실행 순서:
1. KIS API로 매매동향 수집 → `investor_trends` 저장 (실패 시 네이버 폴백)
2. 기존 신호 집계 + 시장 지표 조회
3. 매매동향 데이터를 AI 프롬프트에 포함
4. AI 리포트 생성 (7섹션 상세)
5. `daily_report_summary`에 저장 (`ai_report_sections` JSONB + `ai_summary` TEXT 둘 다)

---

## 데이터 흐름

```
[장중 09:00~15:30]
  Android Collector → signals 테이블 (raw_data에 가격 포함)

[장 마감 15:30 KST - Cron]
  1. KIS API → investor_trends 테이블 (폴백: 네이버 스크래핑)
  2. signals + market_indicators + investor_trends 집계
  3. AI Provider(Gemini) → 7섹션 상세 리포트 생성
  4. daily_report_summary 테이블에 저장 (ai_report_sections JSONB)

[사용자 조회]
  /signals?date=2026-03-10&source=lassi → 해당 날짜 신호 + 가격 표시
  /reports?date=2026-03-10 → 해당 날짜 상세 리포트 (접이식 섹션)
```

## 파일 변경/생성 요약

| 구분 | 파일 | 작업 |
|------|------|------|
| 신규 | `components/common/date-selector.tsx` | 날짜 선택기 (7일 버튼 + 달력) |
| 신규 | `lib/ai/types.ts` | AI 프로바이더 인터페이스 |
| 신규 | `lib/ai/gemini.ts` | Gemini 구현체 |
| 신규 | `lib/ai/index.ts` | 팩토리 함수 |
| 신규 | `lib/kis/fallback-scraper.ts` | 네이버 폴백 스크래핑 |
| 수정 | `lib/kis-api.ts` | 투자자별 매매동향 함수 추가 |
| 수정 | `app/signals/page.tsx` | date 파라미터, 날짜 선택기, ISR 전략, 소스 탭 날짜 보존 |
| 수정 | `app/signals/signal-columns.tsx` | 가격 상세 표시 강화, isToday prop |
| 수정 | `app/reports/page.tsx` | 구조화된 리포트 UI, 접이식 섹션, 매매동향 시각화 |
| 수정 | `app/api/v1/cron/daily-report/route.ts` | 매매동향 + AI 프롬프트 강화 + maxDuration |
| DB | `investor_trends` 테이블 | 신규 생성 |
| DB | `daily_report_summary` 테이블 | `ai_report_sections JSONB` 컬럼 추가 |

## 범위 외

- ChatGPT/OpenAI 연동 (추상화만 해두고 구현은 추후)
- 실시간 매매동향 (장중 업데이트 없음, 장 마감 후 1회)
- Android 수집기 변경 (가격 데이터 이미 전송 중)
