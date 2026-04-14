import type { ThemeBonusInput, ThemeBonusResult, ThemeTag } from '@/types/theme';

/**
 * 테마 모멘텀 보너스 계산 (순수 함수, DB 쿼리 없음)
 *
 * 계산 규칙:
 * - 수급 보너스: 가장 강한 테마의 momentum_score 기준 최대 +10점
 * - 주도주 보너스: 수급 +5, 추세 +3 추가
 * - 과열 테마: risk_deduction +5 (양수로 표현, 리스크 점수에서 감점)
 * - 테마 태그: 강도 순 정렬 후 최대 2개 반환
 */
export function calcThemeBonus(input: ThemeBonusInput): ThemeBonusResult {
  const { themes, is_leader } = input;

  // 테마 미소속 + 주도주 아닌 경우 모두 0 반환
  if (themes.length === 0 && !is_leader) {
    return {
      supply_bonus: 0,
      trend_bonus: 0,
      risk_deduction: 0,
      theme_tags: [],
      is_leader: false,
      is_hot_theme: false,
    };
  }

  // 가장 강한 테마의 momentum_score (null은 0으로 처리)
  const maxMomentum = themes.reduce((max, t) => {
    const score = t.momentum_score ?? 0;
    return score > max ? score : max;
  }, 0);

  // 테마 강도 기반 수급 보너스: momentum_score / 100 * 10 (최대 +10)
  const theme_supply_bonus = Math.round((maxMomentum / 100) * 10 * 10) / 10;
  // 주도주 수급 보너스 +5
  const leader_supply_bonus = is_leader ? 5 : 0;
  // 주도주 추세 보너스 +3
  const trend_bonus = is_leader ? 3 : 0;
  // 과열 테마 여부
  const is_hot_theme = themes.some((t) => t.is_hot);
  // 과열 테마 리스크 감점 +5 (양수로 표현)
  const risk_deduction = is_hot_theme ? 5 : 0;

  // 테마 태그: momentum_score 순 내림차순 정렬 후 최대 2개
  const theme_tags: ThemeTag[] = [...themes]
    .filter((t) => t.momentum_score !== null)
    .sort((a, b) => (b.momentum_score ?? 0) - (a.momentum_score ?? 0))
    .slice(0, 2)
    .map((t) => ({
      theme_id: t.theme_id,
      theme_name: t.theme_name,
      momentum_score: t.momentum_score ?? 0,
      is_hot: t.is_hot,
    }));

  return {
    supply_bonus: theme_supply_bonus + leader_supply_bonus,
    trend_bonus,
    risk_deduction,
    theme_tags,
    is_leader,
    is_hot_theme,
  };
}
