# 스코어링 시스템 전면 재설계 - 피처 분해 계획서

## 개요
30년차 애널리스트 관점 분석 기반, 스코어링 시스템의 7가지 핵심 문제 해결을 위한 전면 재설계.

## 레이어별 작업 분해

### 1. DB 레이어 (db-engineer)
- `supabase/migrations/072_scoring_redesign.sql`
  - `stock_scores` 테이블: `score_catalyst NUMERIC DEFAULT 0`, `market_multiplier NUMERIC DEFAULT 1.0` 추가
  - `ai_recommendations` 테이블: `catalyst_norm NUMERIC DEFAULT 0`, `market_multiplier NUMERIC DEFAULT 1.0` 추가

### 2. API/Logic 레이어 (api-engineer)
변경 파일 14개:
- **타입**: `web/src/types/ai-recommendation.ts` (WEIGHTS_BY_TIER, catalyst 타입, SHORT_TERM_WEIGHTS)
- **신규**: `web/src/lib/ai-recommendation/catalyst-score.ts` (catalyst score 모듈)
- **수정**: 
  - `supply-score.ts` (streak 단조화)
  - `technical-score.ts` (볼린저중복, 거래량3단계, 주봉추세, 낙폭반등, 52주콤보)
  - `valuation-score.ts` (목표주가/의견 제거, value trap, 복합저평가)
  - `earnings-momentum-score.ts` (목표주가/의견 제거)
  - `index.ts` (supply freshness, catalyst 통합, market multiplier, combo bonus)
  - `short-term/supply-score.ts` (streak 전환포착 우선)
  - `scoring/supply-strength.ts` (streak 단조화)
  - `scoring/composite-score.ts` (새 가중치, catalyst 통합)
- **테스트 업데이트**: 변경된 인터페이스에 맞게 모든 *.test.ts 파일 수정

### 3. Frontend 레이어 (frontend-engineer)
변경 파일 4개:
- `UnifiedScoreCard.tsx` (축 라벨 변경, supply freshness 점선, market badge)
- `AnalysisHoverCard.tsx` (축 라벨 변경)
- `StockAnalysisSection.tsx` (미니바 라벨 변경)
- `AiOpinionCard.tsx` (catalyst 항목 추가, 기존 signal -> catalyst 변환)

## 의존성 그래프
```
DB (072_scoring_redesign.sql)
  |
  +---> API/Logic (14파일) ------+
  |                              |
  +---> Frontend (4파일) --------+
                                 |
                            정합성 검증
```

## 핵심 참고사항
- `market_indicators` 테이블은 `kospi_change_pct` 단일 컬럼이 아닌 `indicator_type='KOSPI'` + `change_pct` 구조
- `market_indicators`의 조회 쿼리는 `.eq('indicator_type', 'KOSPI')` 필터 필요
- short_term 모델의 supply 가중치: 23→12 (DEFAULT_SHORT_TERM_WEIGHTS)
- 기존 theme-bonus.ts는 변경 없음
