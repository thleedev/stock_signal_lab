# ETF 신호 기반 시장 센티먼트 지표

## 개요

투자시황 페이지에 ETF 매수/매도 신호를 기반으로 시장 및 섹터별 센티먼트를 표시하는 기능.
레버리지/인버스 ETF의 보유 상태로 시장 방향성을 판단하고, 시가총액 가중치로 정규화한다.

## 데이터 소스

- **signals 테이블**: 라씨매매(`lassi`) 소스만 사용
- **stock_cache 테이블**: 시가총액(`market_cap`) 조회 (symbol이 null이면 조회 생략, 0.1 폴백)
- 신호 타입 매핑:
  - 매수 판정: `BUY`만 (BUY_FORECAST 제외)
  - 매도 판정: `SELL`, `SELL_COMPLETE` 모두
- 보유 판정: 해당 종목의 최신 신호가 BUY이면 "보유 중" (기간 제한 없음)

### ETF 식별

signals에서 종목명(`name`)에 ETF 브랜드 키워드가 포함된 것만 필터:
`KODEX`, `TIGER`, `KBSTAR`, `ARIRANG`, `SOL`, `HANARO`, `ACE`, `KOSEF`, `PLUS`

## ETF 자동 분류 로직

### 유형 감지

종목명(`name`) 키워드 기반:

| 유형 | 키워드 | 조건 | 유형가중치 |
|------|--------|------|-----------|
| 레버리지 | `레버리지`, `2X` | `인버스` 미포함 | 2 |
| 인버스 | `인버스`, `곰` | — | 2 |
| 일반 ETF | `KODEX`, `TIGER`, `KBSTAR`, `ARIRANG`, `SOL`, `HANARO` 등 | 위 키워드 없음 | 1 |

### 진영 분류

- **강세(bull)**: 레버리지 + 일반 ETF
- **약세(bear)**: 인버스

### 섹터 추출

종목명에서 ETF 브랜드와 유형 키워드를 제거한 나머지가 섹터명:

- `KODEX 방산레버리지` → 섹터: **방산**, 유형: 레버리지
- `TIGER 반도체인버스2X` → 섹터: **반도체**, 유형: 인버스
- `KODEX 레버리지` / `KODEX 200` → 이름에 "200" 또는 순수 "레버리지" → 섹터: **KOSPI**
- `KODEX 코스닥150레버리지` / `KODEX 코스닥150` → "150" 포함 → 섹터: **KOSDAQ**

### 수동 매핑 오버라이드

localStorage `etf-sector-overrides` 키에 저장. API 응답을 클라이언트에서 오버라이드 적용 후 렌더링.

```typescript
interface EtfOverrides {
  [etfName: string]: {
    sector?: string;        // 섹터 이동
    side?: 'bull' | 'bear'; // 진영 변경
    excluded?: boolean;     // 계산에서 제외
  };
  __sectorRenames?: {       // 섹터명 변경
    [autoName: string]: string;
  };
}
```

## 정규화: 진영별 합산 + 시가총액 비율 가중

### 비율 계산 (진영 내 합 = 1.0)

각 진영(강세/약세) 내에서 ETF들의 비율을 합이 1.0이 되도록 정규화:

```
1. 진영 내 시총 없는 ETF 수 = n_unknown
2. 시총 없는 ETF 비율 = 각 0.1
3. 시총 있는 ETF들의 비율 풀 = 1.0 - (0.1 × n_unknown)
   (비율 풀이 0 이하가 되면 모든 ETF에 균등 비율 부여: 1.0 / 전체수)
4. 시총 있는 ETF 비율 = 비율풀 × (자기 시총 / 시총 있는 ETF 총시총)
```

특수 케이스:
- **모두 시총 없음**: 비율 = 1.0 / ETF 수 (균등 분배)
- **모두 시총 있음**: 비율 = 자기 시총 / 총시총
- **n_unknown이 너무 많아 비율풀 ≤ 0**: 균등 비율 1.0 / 전체수

### 최종 가중치 계산

```
최종가중치 = ETF유형가중치(1 or 2) × 비율
```

### 센티먼트 계산

```
강세_점수 = SUM(보유 중인 강세 ETF 최종가중치들) // 없으면 0
약세_점수 = SUM(보유 중인 약세 ETF 최종가중치들) // 없으면 0
순_센티먼트 = 강세_점수 - 약세_점수
```

### 판정 기준

| 순_센티먼트 범위 | 판정 | 색상 |
|-----------------|------|------|
| >= +1.0 | 강한 긍정 | emerald |
| +0.1 ~ +1.0 | 긍정 | green |
| 0 (둘 다 보유) | 주의 | yellow |
| 0 (둘 다 미보유) | 중립 | gray |
| -0.1 ~ -1.0 | 부정 | orange |
| <= -1.0 | 강한 부정 | red |

## API 설계

### `GET /api/v1/market-indicators/etf-sentiment`

**쿼리:**
1. signals에서 라씨매매 소스, BUY/SELL 타입의 ETF 신호 전체 조회
2. 종목별로 최신 신호 기준 보유 여부 판정
3. stock_cache에서 시가총액 조회
4. 섹터별 분류 → 정규화 → 센티먼트 계산

**응답:**
```typescript
interface EtfSentimentResponse {
  sectors: Record<string, SectorSentiment>;
  overallSentiment: number;
  overallLabel: string;
  updatedAt: string;
}

interface SectorSentiment {
  label: string;
  bullScore: number;
  bearScore: number;
  netSentiment: number;
  sentiment: 'strong_positive' | 'positive' | 'caution' | 'negative' | 'strong_negative' | 'neutral';
  hasActivePositions: boolean;  // bullScore > 0 || bearScore > 0 (주의 vs 중립 구분)
  etfs: EtfSignalInfo[];
}

interface EtfSignalInfo {
  name: string;
  symbol: string | null;
  type: 'leverage' | 'inverse' | 'normal';
  weight: number;
  finalWeight: number;
  side: 'bull' | 'bear';
  held: boolean;
  marketCap: number | null;
  lastSignalDate: string;
  lastSignalType: string;
}
```

## UI 구성

### 투자시황 페이지 내 새 섹션: "ETF 신호 기반 시장 센티먼트"

위치: "지표별 위험 현황" 섹션과 "최근 30일 위험 지수 추이" 사이

#### 1. 전체 센티먼트 배너
- `overallSentiment` = 모든 섹터의 `netSentiment` 단순 평균
- 기존 RiskAlertBanner와 유사한 스타일, 다른 색상 체계

#### 2. 섹터별 카드 목록
- 각 섹터: 이름 + 센티먼트 배지 + 강세/약세 점수 바
- 클릭하면 펼쳐져서 개별 ETF 상세 표시 (종목명, 유형, 보유여부, 시총, 마지막 신호일)
- 센티먼트 순으로 정렬 (강한부정 → 강한긍정)

#### 3. 섹터 매핑 관리 모달

진입: 섹션 제목 옆 설정(톱니) 버튼 클릭 → 모달 오픈

**모달 구성:**

- **ETF 목록 테이블**: 자동 감지된 모든 ETF를 섹터별 그룹으로 표시
  - 각 행: ETF명 | 자동감지 유형(레버리지/인버스/일반) | 자동감지 섹터 | 진영(강세/약세)
  - **제외 토글**: 특정 ETF를 센티먼트 계산에서 제외/포함
  - **섹터 이동**: 드롭다운으로 다른 섹터 선택 또는 새 섹터명 직접 입력
  - **진영 변경**: 강세↔약세 토글 (자동 감지 오버라이드)
- **섹터명 변경**: 섹터 그룹 헤더 클릭 시 인라인 편집
- **초기화 버튼**: 모든 오버라이드 제거, 자동 감지로 복귀
- 저장: localStorage `etf-sector-overrides`
- 오버라이드된 항목은 시각적으로 구분 (배지 또는 아이콘)

## 파일 구조

| 파일 | 역할 |
|------|------|
| `web/src/lib/etf-sentiment.ts` | ETF 분류, 정규화, 센티먼트 계산 로직 |
| `web/src/app/api/v1/market-indicators/etf-sentiment/route.ts` | API 엔드포인트 |
| `web/src/components/market/etf-sentiment-section.tsx` | 센티먼트 섹션 UI |
| `web/src/components/market/etf-override-modal.tsx` | 섹터 매핑 관리 모달 |
| `web/src/components/market/market-client.tsx` | 기존 페이지에 섹션 통합 |

## 캐싱 및 에러 처리

- API 응답에 `Cache-Control: max-age=300` (5분 캐시)
- signals 쿼리 실패 시 빈 sectors 반환 (`{}`)
- ETF 신호가 전혀 없으면 섹션 자체를 숨김
- symbol이 null인 신호는 시총 조회 생략, 폴백 가중치 0.1 적용
