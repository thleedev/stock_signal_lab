-- stock_scores에 score_reversal 컬럼 추가
-- score_momentum: 가격 모멘텀 (추세 지속력)
-- score_reversal: 기술적 반전 신호 (과매도 회복, 볼린저 하단 반등 등) — contrarian 스타일 전용

ALTER TABLE stock_scores ADD COLUMN IF NOT EXISTS score_reversal integer DEFAULT 0;
