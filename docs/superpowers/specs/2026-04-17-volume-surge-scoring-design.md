# Volume Surge Pre-Signal 스코어링 보완 설계

**날짜**: 2026-04-17  
**배경**: 한국정보통신(025770)처럼 4/14~4/15에 D등급이었으나 4/16 +30% 급등한 케이스를 사전 포착하지 못한 문제 해결

---

## 1. 문제 정의

### 실제 데이터 (025770)

| 날짜 | 종가 | 거래량비율 | 등락률 | 현재 등급 |
|------|------|-----------|--------|---------|
| 4/13 | 8,090 | 175% | 0% | - |
| 4/14 | 8,410 | **921%** | +3.96% | **필터 탈락** |
| 4/15 | 8,490 | **661%** | +0.95% | **D** |
| 4/16 | 11,030 | 1351% | **+29.9%** | — |

### DB 검증: 최근 3개월 급등 케이스 30건 분석

`T일 15%+ 급등` 종목 **전체**가 T-1, T-2 모두 거래량 3배 이상 폭증.
이 패턴의 선행 신뢰도가 매우 높음.

### 현재 시스템의 구조적 원인

1. **거래대금 절대값 필터** (`pre-filter.ts:83`)  
   `tradingValue < 200억 → 탈락`  
   소형주(한국정보통신 하루 거래대금 ~10억)는 거래량이 9배 터져도 구조적으로 탈락

2. **종가위치 필터** (`pre-filter.ts:88`)  
   `close_pos < 0.5 → 탈락`  
   세력 매집 시 막판 눌림으로 close_pos가 0.3~0.4대로 낮게 형성

3. **촉매 필수 조건** (`pre-filter.ts:97`)  
   `BUY신호 없음 AND 섹터 비강세 → 탈락`  
   거래량 폭증 자체를 촉매로 인정 안 함

4. **supply 기본값 0** (`short-term/supply-score.ts`)  
   외국인/기관 데이터 없는 소형주 → supply 점수 ~5점  
   18% 가중치 배분에서 1.1점밖에 기여 못함

5. **거래량 폭증 catalyst 항목 없음** (`short-term/catalyst-score.ts`)  
   AI 신호 신선도·섹터 모멘텀만 보고 거래량 이상 신호 미반영

---

## 2. 목표

- 4/14 (거래량 921% 단일 폭증): **D/필터탈락 → B (40+)**
- 4/15 (거래량 661%, 전날 868% 연속): **D → B (40+)**
- 급등 후 종목(4/16+): 리스크 감점으로 자연 하락

---

## 3. 설계

### 변경 1: pre-filter 거래대금 완화

**파일**: `web/src/lib/ai-recommendation/short-term/pre-filter.ts`

```typescript
// Before
if (tradingValue < 200_0000_0000) return { pass: false, reason: '거래대금 미달' };

// After
const volSurge = volumeRatio >= 300;  // 거래량 3배 이상
if (tradingValue < 200_0000_0000 && !volSurge) {
  return { pass: false, reason: '거래대금 미달' };
}
```

### 변경 2: pre-filter 종가위치 완화

**파일**: `web/src/lib/ai-recommendation/short-term/pre-filter.ts`

```typescript
// Before
const closePosMin = strongCatalyst ? 0.4 : 0.5;

// After
const closePosMin = volumeRatio >= 500 ? 0.3       // 대량 폭증 시 0.3
                  : strongCatalyst      ? 0.4       // 강한 촉매 시 0.4
                  : 0.5;                            // 기본
```

### 변경 3: pre-filter 촉매 조건에 거래량 추가

**파일**: `web/src/lib/ai-recommendation/short-term/pre-filter.ts`

```typescript
// Before
const hasCatalyst = daysSinceLastBuy <= 3 || sectorStrong;

// After
const hasCatalyst = daysSinceLastBuy <= 3 || sectorStrong || volumeRatio >= 300;
```

### 변경 4: supply_score 기본값 중립화

**파일**: `web/src/lib/ai-recommendation/short-term/supply-score.ts`

수급 데이터(외국인/기관 순매수)가 **완전히 없는** 경우에 한해 0점이 아닌 50점(중립) 반환.  
근거: 거래량 폭증 종목에서 매수자가 없을 수 없음. "모름"을 "최악"으로 처리하는 건 소형주 차별.

```typescript
// 수급 데이터 전혀 없을 때
if (!hasForeignData && !hasInstitutionData) {
  return { score: 50, label: '수급 데이터 없음 (중립)' };
}
```

### 변경 5: catalyst_score 거래량 폭증 항목 추가

**파일**: `web/src/lib/ai-recommendation/short-term/catalyst-score.ts`

`daily_prices`에서 T-1, T-2 거래량비율을 받아 폭증 패턴 점수화.

```typescript
// 거래량 폭증 패턴 스코어 (0~55점)
function calcVolumeSurgeScore(
  volRatioToday: number,   // 오늘 거래량 / 20일 평균
  volRatioT1: number,      // 전날 거래량 / 20일 평균
): number {
  // 양일 연속 대량 (가장 강한 매집 신호)
  if (volRatioToday >= 500 && volRatioT1 >= 500) return 55;
  // 오늘 초대량 + 전날 일부
  if (volRatioToday >= 700 && volRatioT1 >= 200) return 45;
  // 오늘 대량 단일
  if (volRatioToday >= 500) return 35;
  // 오늘 중량
  if (volRatioToday >= 300) return 20;
  // 기준 미달
  return 0;
}
```

catalyst_score 합산 시 기존 항목(신호 신선도, 섹터 모멘텀, 신호가 괴리)과 max 합산이 아닌 **별도 추가** (단, 전체 catalyst 최대 100점 cap).

---

## 4. 예상 점수 (025770 기준)

### 4/14 (거래량 921%, T-1 170%)

| 카테고리 | 현재 | 개선 후 |
|---------|------|--------|
| momentum | 53 | 53 |
| supply | 5 | **50** (중립) |
| catalyst | 0 | **45** (단일 대량 700%+) |
| valuation | 25 | 25 |
| **최종** | **D(필터탈락)** | **B(42점)** |

계산: `(53×28 + 50×18 + 45×27 + 25×12) / 85 - risk = 42.1`

### 4/15 (거래량 661%, T-1 868%)

| 카테고리 | 현재 | 개선 후 |
|---------|------|--------|
| momentum | 35 | 35 (가격 +0.95%) |
| supply | 5 | **50** (중립) |
| catalyst | 0 | **55** (양일 연속 500%+) |
| valuation | 25 | 25 |
| **최종** | **D** | **B(41점)** |

계산: `(35×28 + 50×18 + 55×27 + 25×12) / 85 - risk = 41.5`

---

## 5. 데이터 흐름 변경

현재 `short-term-momentum.ts`는 `stock_cache`에서 실시간 데이터를 가져오고, `daily_prices`에서 30일 OHLCV를 가져옴.

추가로 필요한 파생값:
```typescript
// short-term-momentum.ts에 추가
const volRatioToday = volume / avgVol20d * 100;
const volRatioT1 = prevVolume / avgVol20d * 100;
```

`avgVol20d`와 `prevVolume`은 이미 daily_prices 조회 결과에서 계산 가능.

---

## 6. 변경 파일 목록

| 파일 | 변경 내용 |
|------|---------|
| `web/src/lib/ai-recommendation/short-term/pre-filter.ts` | 거래대금·종가위치·촉매 조건 완화 (3곳) |
| `web/src/lib/ai-recommendation/short-term/supply-score.ts` | 수급 없음 시 기본값 0→50 |
| `web/src/lib/ai-recommendation/short-term/catalyst-score.ts` | 거래량 폭증 항목 추가 |
| `web/src/lib/ai-recommendation/short-term-momentum.ts` | volRatioT1 파생값 계산 추가, catalyst/supply에 전달 |

---

## 7. 리스크 및 고려사항

- **거짓 양성**: 거래량만 높고 급락하는 종목이 B등급에 진입할 수 있음.  
  → risk_score가 어느 정도 걸러주지만, 초기에는 모니터링 필요.
  
- **supply 중립값**: 수급 데이터 없는 모든 소형주가 supply 50점을 받게 됨.  
  → 거래량 조건 없이 무조건 50점 주는 게 아니라, vol_ratio가 의미있는 수준(100%+)일 때만 50 적용하는 세분화 가능.

- **4가지 스코어 유지**: catalyst 내부에 흡수하므로 UI·API 변경 없음.
