# 종목분석 통합 설계

> 종목추천 + 단기추천 + 체크리스트를 "종목분석" 단일 탭으로 통합하고,
> 트레이딩 스타일 프리셋으로 가중치를 조절하며,
> 모든 가용 데이터를 활용하는 통합 스코어링 엔진을 구축한다.

---

## 1. 현황 및 문제

### 현재 구조
- **종목추천** (`?tab=analysis`): 6모듈 AI 스코어링 (signal, technical, valuation, supply, earnings_momentum, risk)
- **단기추천** (`?tab=short-term`): 5모듈 단기 스코어링 (momentum, supply, catalyst, valuation, risk)
- **체크리스트** (`?tab=checklist`): 12개 조건 기반 등급 (trend 3, supply 3, valuation 3, risk 3)

### 문제점
1. 3개 탭 간 화면 전환이 느리고 같은 종목을 비교하기 어려움
2. 동일 데이터를 3개 시스템이 각각 다른 방식으로 평가 → 점수 불일치
3. DB에 수집된 데이터 중 미활용 항목 존재 (`roe_estimated`, `forward_eps`, earnings growth null 하드코딩)
4. 종목 상세 패널에서 `AiOpinionCard`, `SupplyDemandSection`, `TechnicalSignalSection`이 점수 정보를 중복 표시

---

## 2. 통합 스코어링 엔진

### 2.1 4대 카테고리 + 리스크 감점

모든 점수는 0~100으로 정규화. 리스크는 감점 방식.

| 대분류 | 포함 모듈 | 한줄 의미 | 데이터 소스 |
|---|---|---|---|
| **신호·기술** | AI 신호 스코어 + 기술적 트렌드 스코어 | "사야 할 타이밍인가?" | `signals`, `daily_prices`, `stock_cache` (signal_count_30d, latest_signal_price) |
| **수급** | 외국인/기관 수급 + 거래량/거래대금 + 회전율 + 공매도 + 자사주/대주주 | "돈이 들어오고 있는가?" | `stock_cache` (foreign/institution net, 5d, streak, float_shares, short_sell_ratio), `stock_dart_info` (has_treasury_buyback, major_shareholder_delta) |
| **가치·성장** | 밸류에이션 + 이익모멘텀 | "싼가? 성장하는가?" | `stock_cache` (per, forward_per, forward_eps, pbr, roe, roe_estimated, eps, bps, dividend_yield, target_price, invest_opinion), `stock_dart_info` (revenue_growth_yoy, operating_profit_growth_yoy) |
| **모멘텀** | 단기 가격 모멘텀 + 섹터 상대강도 | "지금 올라가고 있는가?" | `daily_prices`, `stock_cache` (price_change_pct, volume) |
| **리스크** (감점) | 과매수/급등/이격도/수급이탈 + DART 리스크 | "위험 요소는?" | `daily_prices`, `stock_cache` (is_managed), `stock_dart_info` (has_recent_cbw, audit_opinion, major_shareholder_pct) |

### 2.2 각 카테고리 세부 스코어링

#### 신호·기술 (0~100)

**AI 신호 파트** (0~40):
- 30일 BUY 신호 수: 0건 0점 → 3건+ 20점
- 소스 다양성(멀티소스 보너스): 2소스 +5, 3소스 +10
- 현재가 vs 신호가 갭: 갭 ≤ -5% (저평가) +10, 갭 > +15% (이미 올라감) -5
- 신호 최근성: 3일 이내 +5, 7일 이내 +3

**기술 트렌드 파트** (0~60):
- SMA 정배열 (5>20>60): +12 (체크리스트 `ma_aligned` 통합)
- RSI 구간: 30~50 +10 (체크리스트 `rsi_buy_zone` 통합), 50~70 +5
- MACD 골든크로스: +10 (체크리스트 `macd_golden` 통합)
- 볼린저 밴드 하단 근접: +8
- 52주 위치 (티어별 차등): 하위 30% +8 (대형), 하위 50% +6 (중소형)
- 봉패턴 (피닉스, 더블바텀 등): 각 +5~8
- 이격도 반등, 거래량돌파: 각 +5
- 연속하락 반등: +5

**역발상 과매도형 보정**: RSI < 30을 +15로 상향, 볼린저 하단 이탈을 +12로 상향, 이격도 과매도를 +10 가점. 프리셋 가중치와 별도로 카테고리 내부 점수 산출 시 스타일에 따라 보정.

#### 수급 (0~100)

- 외국인 순매수 당일: > 0이면 최대 +15 (시총 대비 비율. 체크리스트 `foreign_buy` 통합)
- 기관 순매수 당일: > 0이면 최대 +15 (체크리스트 `institution_buy` 통합)
- 외국인 5일 누적: 연속 순매수 시 최대 +10
- 기관 5일 누적: 연속 순매수 시 최대 +10
- 외국인 연속매수일: 3일+ → +5, 5일+ → +8
- 기관 연속매수일: 동일
- 거래량 활성: 현재거래량 ≥ 20일평균 × 1.5 → +8 (체크리스트 `volume_active` 통합)
- 거래대금: 50억+ → +3, 100억+ → +5
- 회전율: float_shares 대비 → 최대 +5
- 공매도비율: 낮을수록 가점, 높으면 감점 (±5)
- 자사주 매입: +5 (`stock_dart_info.has_treasury_buyback`)
- 대주주 지분 변동: 증가 +3, 감소 -3 (`stock_dart_info.major_shareholder_delta`)

**역발상 과매도형 보정**: 외국인/기관 매도→매수 전환(streak가 음수→양수)을 +15 보너스.

#### 가치·성장 (0~100)

**밸류에이션 파트** (0~55):
- Forward PER: < 10 → +12, < 15 → +8, < 20 → +4 (체크리스트 `per_fair` 통합)
- Trailing PER: forward 없을 때 대체. < 12 → +10
- PBR: < 1 → +8, < 1.5 → +5
- ROE: > 15% → +10, > 10% → +7 (체크리스트 `roe_good` 통합)
- ROE 예상 (`roe_estimated`): trailing ROE보다 높으면 +5 (개선 전망)
- 배당수익률: > 3% → +5, > 5% → +8
- 목표가 괴리: ≥ 15% → +8, ≥ 30% → +12 (체크리스트 `target_upside` 통합)
- 투자의견: 매수 +3, 중립 0, 매도 -3
- PEG: < 1 → +5 (대형/중형주만, EPS성장률 필요)

**이익성장 파트** (0~45):
- EPS 성장률 (Forward vs Trailing): > 20% → +12, > 10% → +8 (`forward_eps`, `eps` 활용)
- 매출 성장률 YoY: > 15% → +10, > 5% → +5 (`stock_dart_info.revenue_growth_yoy` — 기존 null 제거)
- 영업이익 성장률 YoY: > 20% → +12, > 10% → +8 (`stock_dart_info.operating_profit_growth_yoy` — 기존 null 제거)
- 목표가 상향 추세: `invest_opinion` 개선 시 +5
- ROE 개선: `roe_estimated` > `roe` 시 +5

#### 모멘텀 (0~100)

- 일간 등락률: +3% 이상 → +15, +1~3% → +10, 0~1% → +5
- 3일 누적 수익률: > 5% → +12, > 2% → +8
- 거래량 비율 (vs 20일 평균): > 3x → +15, > 2x → +10, > 1.5x → +7
- 종가 위치 (당일 고저 대비): 상위 30% → +10
- 캔들 패턴 (양봉, 갭업 등): 각 +5
- 박스 돌파: +10
- 섹터 상대 강도: 섹터 내 상위 20% → +10, 상위 50% → +5
- 섹터 평균 대비 초과수익: > 2% → +8

#### 리스크 감점 (0~100, 감점으로 적용)

**기술적 과열** (최대 -40):
- RSI > 70: -15 (체크리스트 `no_overbought` 통합)
- 5일 수익률 > 15%: -15 (체크리스트 `no_surge` 통합)
- 이격도 과열 (20일 SMA 대비 > 10%): -10
- 볼린저 상단 이탈: -5
- 더블탑 패턴: -5

**수급 이탈** (최대 -25):
- 외국인+기관 동시 순매도: -15 (체크리스트 `no_smart_exit` 통합)
- 외국인 5일 연속 매도: -10
- 프로그램 대량 매도: -5

**DART 리스크** (최대 -35):
- 관리종목: -20 (`stock_cache.is_managed`)
- CB/BW 발행: -15 (`stock_dart_info.has_recent_cbw`)
- 감사의견 비적정: -30 (`stock_dart_info.audit_opinion`)
- 대주주 지분율 < 20%: -5 (`stock_dart_info.major_shareholder_pct`)

### 2.3 최종 점수 계산

```
categoryScores = {
  signalTech: normalize(신호·기술 raw, 0, 100),
  supply:     normalize(수급 raw, 0, 100),
  valueGrowth: normalize(가치·성장 raw, 0, 100),
  momentum:   normalize(모멘텀 raw, 0, 100),
  risk:       normalize(리스크 raw, 0, 100)
}

weights = selectedPreset.weights  // { signalTech: 22, supply: 22, valueGrowth: 22, momentum: 19, risk: 15 }

positiveBase = (signalTech × w.signalTech + supply × w.supply + valueGrowth × w.valueGrowth + momentum × w.momentum) / (100 - w.risk)
totalScore = max(0, min(positiveBase - risk × (w.risk / 100), 100))
```

### 2.4 등급 체계

| 등급 | 점수 범위 |
|---|---|
| A+ | 85~100 |
| A | 70~84 |
| B+ | 55~69 |
| B | 40~54 |
| C | 25~39 |
| D | 0~24 |

### 2.5 체크리스트 통합

기존 12개 체크리스트 조건은 삭제하지 않음. 각 조건의 평가 결과(`met`, `detail`, `na`)는 해당 카테고리의 `ScoreReason` 항목으로 자연스럽게 포함됨.

| 체크리스트 조건 | 통합 카테고리 | ScoreReason으로의 매핑 |
|---|---|---|
| `ma_aligned` (이평정배열) | 신호·기술 | `{ label: "이평 정배열", points: 12, met: true/false }` |
| `rsi_buy_zone` (RSI 매수구간) | 신호·기술 | `{ label: "RSI 매수구간 (30-50)", points: 10, met }` |
| `macd_golden` (MACD 골든크로스) | 신호·기술 | `{ label: "MACD 골든크로스", points: 10, met }` |
| `foreign_buy` (외국인 순매수) | 수급 | `{ label: "외국인 순매수", points: 15, met }` |
| `institution_buy` (기관 순매수) | 수급 | `{ label: "기관 순매수", points: 15, met }` |
| `volume_active` (거래량 활성) | 수급 | `{ label: "거래량 활성 (1.5x)", points: 8, met }` |
| `per_fair` (PER 적정) | 가치·성장 | `{ label: "PER 적정 (<15)", points: 12, met }` |
| `target_upside` (목표주가 괴리) | 가치·성장 | `{ label: "목표가 괴리 (≥15%)", points: 8, met }` |
| `roe_good` (ROE 양호) | 가치·성장 | `{ label: "ROE 양호 (>10%)", points: 7, met }` |
| `no_overbought` (과매수 없음) | 리스크 | `{ label: "과매수 없음 (RSI<70)", points: -15, met }` |
| `no_surge` (급등 없음) | 리스크 | `{ label: "급등 없음 (5일<15%)", points: -15, met }` |
| `no_smart_exit` (스마트머니 이탈 없음) | 리스크 | `{ label: "스마트머니 이탈 없음", points: -15, met }` |

### 2.6 미사용 데이터 신규 활용

| 데이터 | 테이블.컬럼 | 활용 방식 |
|---|---|---|
| `roe_estimated` | `stock_cache.roe_estimated` | 가치·성장: ROE 개선 전망 가점 (+5) |
| `forward_eps` | `stock_cache.forward_eps` | 가치·성장: EPS 성장률 계산 (forward_eps / eps - 1) |
| `eps` | `stock_cache.eps` | 가치·성장: PEG 계산, EPS 성장률 기준 |
| `bps` | `stock_cache.bps` | 가치·성장: PBR 검증 (current_price / bps) |
| `revenue_growth_yoy` | `stock_dart_info` | 가치·성장: 매출성장 가점 (기존 null → 실제 연결) |
| `operating_profit_growth_yoy` | `stock_dart_info` | 가치·성장: 영업이익성장 가점 (기존 null → 실제 연결) |

---

## 3. 트레이딩 스타일 프리셋

### 3.1 프리셋 정의

5개 기본 프리셋. 가중치 합계는 항상 100.

| 프리셋 | 신호·기술 | 수급 | 가치·성장 | 모멘텀 | 리스크 | 특성 |
|---|---|---|---|---|---|---|
| **균형형** (기본) | 20 | 20 | 20 | 20 | 15 | 모든 요소 골고루 |
| **수급 추종형** | 15 | 35 | 10 | 25 | 15 | 외국인/기관 따라가기 |
| **가치투자형** | 10 | 12 | 53 | 10 | 15 | 저평가 + 이익성장 |
| **단기 모멘텀형** | 20 | 20 | 5 | 40 | 15 | 단타/스윙 |
| **역발상 과매도형** | 35 | 25 | 15 | 10 | 15 | 바닥 포착 + 수급 전환 |

### 3.2 역발상 과매도형 내부 보정

이 프리셋 선택 시, 신호·기술 카테고리 내부에서 과매도 지표의 점수 배점이 변경됨:
- RSI < 30: 기본 0점 → **+15점**
- 볼린저 하단 이탈: 기본 +8 → **+12점**
- 이격도 하락 (20일 SMA 대비 < -5%): 기본 0점 → **+10점**
- 연속하락 5일+: 기본 0점 → **+8점**

수급 카테고리에서 전환 보정:
- 외국인 streak 음수→양수 전환: **+15점** 보너스
- 기관 streak 음수→양수 전환: **+15점** 보너스

### 3.3 커스텀 프리셋

- `localStorage`에 저장: `unified-analysis-custom-presets`
- 구조: `{ id: string, name: string, weights: { signalTech, supply, valueGrowth, momentum, risk } }[]`
- 최대 10개
- 제약: 리스크 가중치는 10~20 범위, 나머지 4개 합계 = 100 - 리스크 가중치
- UI: 4개 슬라이더 (연동 — 하나 올리면 나머지가 비례 감소)

---

## 4. UI 설계

### 4.1 탭 구조 변경

`/signals` 페이지 내부 탭:
- **AI 신호** (기존 유지)
- **종목분석** (신규 — `?tab=analysis`로 통합)

기존 `?tab=short-term`, `?tab=checklist` URL은 `?tab=analysis`로 리다이렉트.

### 4.2 종목분석 탭 레이아웃

#### 상단 컨트롤 바

```
┌─────────────────────────────────────────────────────────┐
│ [균형형 ▾]  [KOSPI ▾] [오늘 ▾] [검색...]               │
│                                                         │
│ (커스텀 편집 시)                                         │
│ 신호·기술 ████░░ 22   수급 ████░░ 22                    │
│ 가치·성장 ████░░ 22   모멘텀 ███░░░ 19  리스크 ██░ 15   │
│ [저장] [취소]                                           │
└─────────────────────────────────────────────────────────┘
```

- 스타일 드롭다운: 5개 기본 프리셋 + 구분선 + 커스텀 목록 + "새 스타일 만들기"
- 슬라이더: "새 스타일 만들기" 또는 커스텀 항목 클릭 시 표시
- 필터: 시장(전체/KOSPI/KOSDAQ), 날짜모드(오늘/신호전체/전체), 검색

#### 종목 리스트

각 행 구조:
```
┌──┬──────────┬────────┬───────┬────────────────────┬────────────────┬────┐
│# │ 종목명    │ 현재가  │ 등락률 │ ████████░░ 78점    │ ▪▪▪▪ 미니바4개  │ A  │
└──┴──────────┴────────┴───────┴────────────────────┴────────────────┴────┘
```

- 순위: 1, 2, 3...
- 총점 바: 0~100 가로 프로그레스바, 색상 (D:회색, C:노랑, B:초록, A:파랑, A+:보라)
- 4대분류 미니바: 4개의 작은 가로바 (각 카테고리 색상 고정: 신호·기술=파랑, 수급=초록, 가치·성장=노랑, 모멘텀=빨강)
- 등급 뱃지: A+/A/B+/B/C/D
- 정렬: 총점순(기본), 이름순, 등락률순

#### 호버 툴팁

종목 행에 마우스오버 시 300ms 딜레이 후 표시:

```
┌─────────────────────────────────────────┐
│  [4축 레이더 차트]    [7일 점수 추이]   │
│   신호·기술 72                          │
│  /        \         ──/\──/\──          │
│ 모멘텀58  수급85                        │
│  \        /         리스크: -12         │
│   가치65                                │
├─────────────────────────────────────────┤
│ ✓이평정배열 ✓RSI매수 ✗MACD ✓외국인     │
│ ✓기관매수 ✓거래량 ✓PER적정 ✓목표가     │
│ ✓ROE양호 ✓과매수無 ✗급등無 ✓이탈無     │
│ 9/12 충족                               │
└─────────────────────────────────────────┘
```

- 좌측: 4축 레이더 차트 (recharts `RadarChart`)
- 우측 상단: 최근 7일 총점 추이 미니 라인차트 (스냅샷 데이터 활용)
- 우측 중단: 리스크 감점 수치
- 하단: 12개 체크리스트 조건 충족/미충족 아이콘 + 총 충족 수

### 4.3 종목 상세 패널 재구성

기존 `StockDetailPanel` 2컬럼 레이아웃에서 좌측 컬럼 변경:

#### 삭제 대상
- `AiOpinionCard` → `UnifiedScoreCard`로 교체
- `SupplyDemandSection` → `UnifiedScoreCard` 수급 카테고리 펼침에 통합
- `TechnicalSignalSection` → `UnifiedScoreCard` 신호·기술 카테고리 펼침에 통합

#### 유지 대상
- `PanelHeader` (종목명, 현재가, 등락률, 등급배지)
- 주가 차트 (`StockChartSection`)
- `MetricsGrid` (원시 투자지표 참조용)
- `ReturnTrendSection` (수익률 추이)
- `ConsensusSection` (컨센서스)
- `DartInfoSection` (DART 공시)
- `PortfolioGroupAccordion` (포트폴리오/관심그룹)

#### `UnifiedScoreCard` 구조

좌측 컬럼 최상단에 배치:

```
┌─────────────────────────────────────────┐
│ 총점 78점  등급 A  적용 스타일: 균형형  │
│ ████████████████████░░░░░ 78/100        │
├─────────────────────────────────────────┤
│ [4축 레이더 차트]    [7일 점수 추이]    │
│                      리스크: -12점      │
├─────────────────────────────────────────┤
│ ▸ 신호·기술  72점  (가중 ×22% = 15.8)  │
│   펼치면:                               │
│   ┌───────────────────────────────────┐ │
│   │ ✓ 이평 정배열         +12점       │ │
│   │ ✓ RSI 매수구간 (42)   +10점       │ │
│   │ ✗ MACD 골든크로스      +0점       │ │
│   │ ✓ 볼린저 하단 근접     +8점       │ │
│   │ ✓ 30일 BUY 3건        +20점       │ │
│   │ ✓ 멀티소스 (2)        +5점        │ │
│   │ ✓ 신호가 대비 -3%     +10점       │ │
│   │ ...                               │ │
│   │ 원점수: 72/100                    │ │
│   └───────────────────────────────────┘ │
│                                         │
│ ▸ 수급      85점  (가중 ×22% = 18.7)  │
│   펼치면:                               │
│   ┌───────────────────────────────────┐ │
│   │ ✓ 외국인 순매수 +15,230주  +15점  │ │
│   │ ✓ 기관 순매수 +8,100주    +12점   │ │
│   │   외국인 5일 누적: +52,000주      │ │
│   │   기관 연속매수: 3일째     +5점   │ │
│   │ ✓ 거래량 활성 (2.1x)      +8점   │ │
│   │   거래대금: 127억          +5점   │ │
│   │   공매도비율: 2.1%         +3점   │ │
│   │ ...                               │ │
│   └───────────────────────────────────┘ │
│                                         │
│ ▸ 가치·성장  65점  (가중 ×22% = 14.3) │
│ ▸ 모멘텀    58점  (가중 ×19% = 11.0)  │
│ ▸ 리스크    -12점 (가중 ×15%)          │
│   펼치면: 감점 항목 리스트              │
├─────────────────────────────────────────┤
│ 체크리스트  9/12 충족                   │
│ ┌─ 트렌드 ──────────────────┐          │
│ │ ✓ 이평정배열  ✓ RSI매수    │          │
│ │ ✗ MACD골든                 │          │
│ ├─ 수급 ────────────────────┤          │
│ │ ✓ 외국인  ✓ 기관  ✓ 거래량 │          │
│ ├─ 밸류에이션 ──────────────┤          │
│ │ ✓ PER적정  ✓ 목표가  ✓ ROE │          │
│ ├─ 리스크 ──────────────────┤          │
│ │ ✓ 과매수無  ✗ 급등無  ✓ 이탈│          │
│ └───────────────────────────┘          │
│ 최종 계산:                              │
│ (72×22 + 85×22 + 65×22 + 58×19) / 85   │
│ = 70.6 − 12×0.15 = 78.0               │
└─────────────────────────────────────────┘
```

---

## 5. 데이터 흐름

### 5.1 API 변경

#### 기존 API 수정: `GET /api/v1/stock-ranking`

- 기존 `calcScore()` 인라인 함수 → `calcUnifiedScore()` 모듈로 교체
- 파라미터 추가: `style=balanced|supply|value|momentum|contrarian` (기본: balanced)
- 응답에 `categories: { signalTech, supply, valueGrowth, momentum, risk }` 추가
- 응답에 `reasons: Record<CategoryKey, ScoreReason[]>` 추가
- 응답에 `checklist: ConditionResult[]` 추가
- `mode=checklist` 파라미터 삭제 (체크리스트가 기본 응답에 통합)

#### 기존 API 수정: `POST /api/v1/ai-recommendations/generate`

- `model_type='standard'` 오케스트레이터에서 `stock_dart_info` 테이블 조회 추가
- `EarningsMomentumInput`의 `revenueGrowthYoy`, `operatingProfitGrowthYoy`에 실제 데이터 연결
- 신규 통합 스코어링 엔진 호출로 변경

#### 스냅샷 호환

- `stock_ranking_snapshot`에 신규 카테고리 점수 저장
- 기존 `score_signal`, `score_trend`, `score_valuation`, `score_supply` 컬럼을 `score_signal_tech`, `score_supply`, `score_value_growth`, `score_momentum`으로 매핑

### 5.2 프론트엔드 데이터 흐름

```
종목분석 탭 마운트
  → useUnifiedRanking(style, date, market) 훅
    → GET /api/v1/stock-ranking?style={style}&date={date}&market={market}
    → 응답: StockAnalysisItem[] (총점 + 4카테고리 + 체크리스트 포함)
  → 종목 리스트 렌더링

종목 호버
  → 캐시된 StockAnalysisItem에서 레이더/체크리스트 즉시 표시
  → 점수 추이: useScoreHistory(symbol) → 스냅샷 세션 데이터

종목 클릭 → StockDetailPanel
  → UnifiedScoreCard에 StockAnalysisItem 전달
  → 카테고리 펼침 시 reasons 배열에서 ScoreReason 렌더링
```

---

## 6. 파일 변경 계획

### 신규 생성

| 파일 | 역할 |
|---|---|
| `web/src/lib/unified-scoring/engine.ts` | 통합 스코어링 엔진 메인 |
| `web/src/lib/unified-scoring/signal-tech-score.ts` | 신호·기술 카테고리 |
| `web/src/lib/unified-scoring/supply-score.ts` | 수급 카테고리 |
| `web/src/lib/unified-scoring/value-growth-score.ts` | 가치·성장 카테고리 |
| `web/src/lib/unified-scoring/momentum-score.ts` | 모멘텀 카테고리 |
| `web/src/lib/unified-scoring/risk-score.ts` | 리스크 감점 |
| `web/src/lib/unified-scoring/presets.ts` | 프리셋 정의 + 스타일별 보정 로직 |
| `web/src/lib/unified-scoring/types.ts` | 통합 스코어링 타입 정의 |
| `web/src/components/signals/StockAnalysisSection.tsx` | 종목분석 탭 메인 컴포넌트 |
| `web/src/components/signals/StyleSelector.tsx` | 스타일 드롭다운 + 슬라이더 |
| `web/src/components/signals/AnalysisHoverCard.tsx` | 호버 툴팁 (레이더+추이+체크리스트) |
| `web/src/components/stock-modal/UnifiedScoreCard.tsx` | 상세 패널 점수 카드 |
| `web/src/hooks/use-unified-ranking.ts` | 통합 랭킹 데이터 훅 |
| `web/src/hooks/use-score-history.ts` | 점수 추이 데이터 훅 |

### 수정 대상

| 파일 | 변경 내용 |
|---|---|
| `web/src/app/signals/page.tsx` | 탭 구조 변경 (3탭 → 2탭), 데이터 fetch 통합 |
| `web/src/components/signals/RecommendationView.tsx` | 탭 스위처 변경, 신규 컴포넌트 연결 |
| `web/src/app/api/v1/stock-ranking/route.ts` | `calcScore` → `calcUnifiedScore` 교체, 응답 구조 확장 |
| `web/src/components/stock-modal/StockDetailPanel.tsx` | AiOpinionCard/SupplyDemand/TechnicalSignal 제거, UnifiedScoreCard 추가 |
| `web/src/contexts/stock-modal-context.tsx` | scoreMode 제거 (단일 모드), categories 데이터 전달 |
| `web/src/lib/ai-recommendation/index.ts` | `stock_dart_info` 조회 추가, earnings growth null 제거 |

### 삭제 후보 (통합 완료 후)

| 파일 | 이유 |
|---|---|
| `web/src/components/signals/ShortTermRecommendationSection.tsx` | 종목분석에 통합 |
| `web/src/components/signals/ChecklistSection.tsx` | 종목분석에 통합 |
| `web/src/hooks/use-checklist-ranking.ts` | use-unified-ranking으로 대체 |
| `web/src/lib/checklist-recommendation/` | 체크리스트 조건 평가는 unified-scoring에 통합 |
| `web/src/components/stock-modal/AiOpinionCard.tsx` | UnifiedScoreCard로 대체 |
| `web/src/components/stock-modal/SupplyDemandSection.tsx` | UnifiedScoreCard에 통합 |
| `web/src/components/stock-modal/TechnicalSignalSection.tsx` | UnifiedScoreCard에 통합 |

---

## 7. 제약사항

- 리스크 가중치: 10~20 범위 고정
- 커스텀 프리셋: 최대 10개 (localStorage)
- 호버 툴팁: 300ms 딜레이, 추가 API 호출 없음 (캐시된 데이터 사용)
- 점수 추이: 스냅샷 세션 데이터 기반 (최대 7일)
- 역발상 과매도형 내부 보정은 서버 사이드에서 `style` 파라미터로 처리
  