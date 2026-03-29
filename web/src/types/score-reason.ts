// web/src/types/score-reason.ts

/** 각 점수 항목의 산출 근거 */
export interface ScoreReason {
  /** 조건명 (예: "골든크로스") */
  label: string;
  /** 기여 점수 — 정규화 후 값 (예: +7.7). 감점이면 음수 */
  points: number;
  /** 수치 근거 (예: "5일선 12,340 > 20일선 12,100") */
  detail: string;
  /** 조건 충족 여부 */
  met: boolean;
}

/** 정규화된 점수 + 근거를 반환하는 모든 스코어 모듈의 공통 인터페이스 */
export interface NormalizedScoreBase {
  /** 원점수 (모듈별 고유 범위) */
  rawScore: number;
  /** 정규화 점수 (0~100) */
  normalizedScore: number;
  /** 산출 근거 목록 */
  reasons: ScoreReason[];
}
