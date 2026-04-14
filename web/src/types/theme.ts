// web/src/types/theme.ts

/** UI에서 추천 카드에 표시하는 테마 태그 */
export interface ThemeTag {
  theme_id: string;
  theme_name: string;
  momentum_score: number;
  is_hot: boolean;
}

/** calcThemeBonus() 입력 */
export interface ThemeBonusInput {
  /** 해당 종목이 속한 테마 목록 (theme_stocks → stock_themes join) */
  themes: Array<{
    theme_id: string;
    theme_name: string;
    momentum_score: number | null;
    is_hot: boolean;
  }>;
  /** theme_stocks.is_leader */
  is_leader: boolean;
}

/** calcThemeBonus() 출력 */
export interface ThemeBonusResult {
  /** 수급 점수에 가산할 점수 (테마 강도 최대 +10 + 주도주 +5) */
  supply_bonus: number;
  /** 추세/촉매 점수에 가산할 점수 (주도주 +3) */
  trend_bonus: number;
  /** 리스크 점수에 추가 감점 (과열 테마 +5, 양수로 표현) */
  risk_deduction: number;
  /** UI용 테마 태그 (강도 순 최대 2개) */
  theme_tags: ThemeTag[];
  is_leader: boolean;
  is_hot_theme: boolean;
}
