// web/src/lib/unified-scoring/presets.ts
import type { StylePreset, StyleId, StyleWeights, CustomPreset } from './types';

export const STYLE_PRESETS: StylePreset[] = [
  {
    id: 'balanced',
    name: '균형형',
    description: '모든 요소를 골고루 평가',
    weights: { signalTech: 22, supply: 22, valueGrowth: 22, momentum: 19, risk: 15 },
  },
  {
    id: 'supply',
    name: '수급 추종형',
    description: '외국인·기관 매수 흐름 추종',
    weights: { signalTech: 15, supply: 35, valueGrowth: 10, momentum: 25, risk: 15 },
  },
  {
    id: 'value',
    name: '가치투자형',
    description: '저평가 + 이익성장 중심',
    weights: { signalTech: 10, supply: 12, valueGrowth: 53, momentum: 10, risk: 15 },
  },
  {
    id: 'momentum',
    name: '단기 모멘텀형',
    description: '단타/스윙 트레이딩',
    weights: { signalTech: 20, supply: 20, valueGrowth: 5, momentum: 40, risk: 15 },
  },
  {
    id: 'contrarian',
    name: '역발상 과매도형',
    description: '바닥 포착 + 수급 전환',
    weights: { signalTech: 35, supply: 25, valueGrowth: 15, momentum: 10, risk: 15 },
  },
];

export function getPreset(id: StyleId): StylePreset {
  return STYLE_PRESETS.find(p => p.id === id) ?? STYLE_PRESETS[0];
}

/** 역발상 과매도형인지 확인 */
export function isContrarianStyle(styleId: string): boolean {
  return styleId === 'contrarian';
}

/** 가중치 유효성 검증 */
export function validateWeights(w: StyleWeights): boolean {
  const sum = w.signalTech + w.supply + w.valueGrowth + w.momentum + w.risk;
  return sum === 100 && w.risk >= 10 && w.risk <= 20;
}

// ── localStorage 커스텀 프리셋 관리 ──

const STORAGE_KEY = 'unified-analysis-custom-presets';
const MAX_PRESETS = 10;

export function loadCustomPresets(): CustomPreset[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveCustomPreset(preset: CustomPreset): CustomPreset[] {
  const presets = loadCustomPresets();
  const idx = presets.findIndex(p => p.id === preset.id);
  if (idx >= 0) {
    presets[idx] = preset;
  } else {
    if (presets.length >= MAX_PRESETS) throw new Error('최대 10개까지 저장 가능합니다');
    presets.push(preset);
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  return presets;
}

export function deleteCustomPreset(id: string): CustomPreset[] {
  const presets = loadCustomPresets().filter(p => p.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  return presets;
}
