'use client';

import { useState, useCallback, useEffect } from 'react';
import { RefreshCw, Settings, AlertTriangle, ChevronDown, RotateCcw } from 'lucide-react';
import {
  AiRecommendation,
  AiRecommendationWeights,
  AiRecommendationResponse,
  DEFAULT_WEIGHTS,
} from '@/types/ai-recommendation';

const WEIGHT_STORAGE_KEY = 'ai-recommendation-weights';

function loadWeights(): AiRecommendationWeights {
  try {
    const stored = localStorage.getItem(WEIGHT_STORAGE_KEY);
    if (stored) return JSON.parse(stored) as AiRecommendationWeights;
  } catch {}
  return DEFAULT_WEIGHTS;
}

function saveWeights(w: AiRecommendationWeights) {
  try {
    localStorage.setItem(WEIGHT_STORAGE_KEY, JSON.stringify(w));
  } catch {}
}

function ScoreBar({ score, max = 100 }: { score: number; max?: number }) {
  const pct = Math.max(0, Math.min(100, (score / max) * 100));
  const color =
    score >= 70 ? 'bg-green-500' : score >= 50 ? 'bg-blue-500' : 'bg-gray-400';
  return (
    <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
      <div
        className={`${color} h-2 rounded-full transition-all`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function Badge({
  label,
  variant,
}: {
  label: string;
  variant: 'green' | 'red' | 'gray' | 'orange';
}) {
  const cls = {
    green: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
    red: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
    gray: 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
    orange: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
  }[variant];
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${cls}`}
    >
      {label}
    </span>
  );
}

function RecommendationCard({ item }: { item: AiRecommendation }) {
  const isWarning = item.double_top;
  return (
    <div
      className={`rounded-lg border p-4 ${
        isWarning
          ? 'border-orange-400 bg-orange-50 dark:bg-orange-950/20'
          : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'
      }`}
    >
      {isWarning && (
        <div className="flex items-center gap-1 text-orange-600 dark:text-orange-400 text-xs font-medium mb-2">
          <AlertTriangle className="w-3 h-3" />
          <span>쌍봉 패턴 감지 — 주의 필요</span>
        </div>
      )}

      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold text-blue-600 dark:text-blue-400">
            #{item.rank}
          </span>
          <div>
            <div className="font-semibold text-sm">{item.name ?? item.symbol}</div>
            <div className="text-xs text-gray-500">{item.symbol}</div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-xl font-bold">{item.total_score.toFixed(1)}</div>
          <div className="text-xs text-gray-500">/ 100점</div>
        </div>
      </div>

      <ScoreBar score={item.total_score} />

      <div className="grid grid-cols-4 gap-1 mt-3 text-center">
        {[
          { label: '신호강도', score: item.signal_score, max: 30 },
          { label: '기술적', score: item.technical_score, max: 30 },
          { label: '밸류', score: item.valuation_score, max: 20 },
          { label: '수급', score: item.supply_score, max: 20 },
        ].map(({ label, score, max }) => (
          <div key={label} className="bg-gray-50 dark:bg-gray-700/50 rounded p-1">
            <div className="text-xs text-gray-500">{label}</div>
            <div className="text-sm font-semibold">
              {score !== null ? score.toFixed(1) : '-'}
              <span className="text-xs text-gray-400">/{max}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-1 mt-3">
        {item.golden_cross && <Badge label="✅ 골든크로스" variant="green" />}
        {item.bollinger_bottom && <Badge label="✅ 볼린저 하단 복귀" variant="green" />}
        {item.phoenix_pattern && <Badge label="✅ 불새패턴" variant="green" />}
        {item.macd_cross && <Badge label="✅ MACD 골든크로스" variant="green" />}
        {item.volume_surge && <Badge label="✅ 거래량 급증" variant="green" />}
        {item.week52_low_near && <Badge label="✅ 52주 저점 근처" variant="green" />}
        {item.rsi !== null && item.rsi >= 30 && item.rsi <= 50 && (
          <Badge label={`✅ RSI ${item.rsi.toFixed(0)}`} variant="green" />
        )}
        {item.pbr !== null && item.pbr > 0 && item.pbr < 1.0 && (
          <Badge label={`✅ PBR ${item.pbr.toFixed(2)}`} variant="green" />
        )}
        {item.per !== null && item.per > 0 && item.per < 10 && (
          <Badge label={`✅ PER ${item.per.toFixed(1)}`} variant="green" />
        )}
        {item.roe !== null && item.roe > 10 && (
          <Badge label={`✅ ROE ${item.roe.toFixed(1)}%`} variant="green" />
        )}
        {item.volume_vs_sector && (
          <Badge label="✅ 섹터 거래대금 급증" variant="green" />
        )}
        {item.foreign_buying && <Badge label="✅ 외국인 순매수" variant="green" />}
        {item.institution_buying && <Badge label="✅ 기관 순매수" variant="green" />}
        {item.low_short_sell && <Badge label="✅ 공매도 낮음" variant="green" />}
        {item.double_top && <Badge label="⚠️ 쌍봉 (-8점)" variant="orange" />}
        {!item.foreign_buying && !item.institution_buying && !item.volume_vs_sector && !item.low_short_sell && (
          <Badge label="수급 미집계" variant="gray" />
        )}
      </div>
    </div>
  );
}

function WeightPanel({
  weights,
  onChange,
  onReset,
}: {
  weights: AiRecommendationWeights;
  onChange: (w: AiRecommendationWeights) => void;
  onReset: () => void;
}) {
  const total = weights.signal + weights.technical + weights.valuation + weights.supply;
  const isValid = Math.abs(total - 100) <= 0.01;

  const handleChange = (key: keyof AiRecommendationWeights, val: number) => {
    onChange({ ...weights, [key]: val });
  };

  const items: { key: keyof AiRecommendationWeights; label: string }[] = [
    { key: 'signal', label: '신호강도' },
    { key: 'technical', label: '기술적 분석' },
    { key: 'valuation', label: '밸류에이션' },
    { key: 'supply', label: '수급' },
  ];

  return (
    <div className="mt-3 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg border border-gray-200 dark:border-gray-600">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium">가중치 설정</span>
        <button
          onClick={onReset}
          className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
        >
          <RotateCcw className="w-3 h-3" />
          기본값 복원 (30/30/20/20)
        </button>
      </div>
      <div className="space-y-2">
        {items.map(({ key, label }) => (
          <div key={key} className="flex items-center gap-3">
            <span className="text-xs w-20 text-gray-600 dark:text-gray-400">{label}</span>
            <input
              type="range"
              min={0}
              max={100}
              step={10}
              value={weights[key]}
              onChange={(e) => handleChange(key, parseInt(e.target.value))}
              className="flex-1"
            />
            <span className="text-xs w-8 text-right font-mono">{weights[key]}%</span>
          </div>
        ))}
      </div>
      <div
        className={`text-xs mt-2 font-medium ${
          isValid ? 'text-green-600 dark:text-green-400' : 'text-red-500'
        }`}
      >
        합계: {total}% {!isValid && '⚠️ 합계가 100이어야 합니다'}
      </div>
    </div>
  );
}

interface Props {
  initialData: AiRecommendationResponse | null;
}

export function AiRecommendationSection({ initialData }: Props) {
  const [data, setData] = useState<AiRecommendationResponse | null>(initialData);
  const [limit, setLimit] = useState(5);
  const [loading, setLoading] = useState(false);
  const [showWeights, setShowWeights] = useState(false);
  // localStorage는 SSR에서 접근 불가 → useEffect에서 초기화
  const [weights, setWeights] = useState<AiRecommendationWeights>(DEFAULT_WEIGHTS);

  const refresh = useCallback(
    async (newWeights?: AiRecommendationWeights, newLimit?: number) => {
      setLoading(true);
      try {
        const w = newWeights ?? weights;
        const l = newLimit ?? limit;
        const res = await fetch('/api/v1/ai-recommendations/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ limit: l, weights: w }),
        });
        if (res.ok) {
          const json = (await res.json()) as AiRecommendationResponse;
          setData(json);
        }
      } finally {
        setLoading(false);
      }
    },
    [weights, limit]
  );

  useEffect(() => {
    const saved = loadWeights();
    setWeights(saved);
    // 초기 데이터가 없으면 자동으로 생성 트리거 (Lazy Generation 클라이언트 위임)
    if (!initialData || initialData.recommendations.length === 0) {
      refresh(saved);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleWeightsChange = (w: AiRecommendationWeights) => {
    setWeights(w);
    saveWeights(w);
  };

  const handleWeightsApply = () => {
    const total = weights.signal + weights.technical + weights.valuation + weights.supply;
    if (Math.abs(total - 100) <= 0.01) {
      refresh(weights);
    }
  };

  const handleLimitChange = (newLimit: number) => {
    setLimit(newLimit);
    refresh(weights, newLimit);
  };

  const displayed = data?.recommendations?.slice(0, limit) ?? [];

  return (
    <div className="mb-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <div>
          <h2 className="text-base font-bold">🏆 오늘의 AI 추천</h2>
          {data && data.recommendations.length > 0 && (
            <p className="text-xs text-gray-500 mt-0.5">
              오늘 BUY 신호 {data.total_candidates}종목 중 상위 {displayed.length}종목
              {data.generated_at && (
                <>
                  {' '}•{' '}
                  생성:{' '}
                  {new Date(data.generated_at).toLocaleTimeString('ko-KR', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </>
              )}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* 종목 수 선택 */}
          <div className="flex items-center gap-0.5 border rounded px-1.5 py-1 text-sm dark:border-gray-600">
            {[3, 5, 10].map((n) => (
              <button
                key={n}
                onClick={() => handleLimitChange(n)}
                className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                  limit === n
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
          {/* 가중치 설정 */}
          <button
            onClick={() => setShowWeights((v) => !v)}
            className="flex items-center gap-1 text-xs px-2 py-1.5 border rounded dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            <Settings className="w-3 h-3" />
            가중치
            <ChevronDown
              className={`w-3 h-3 transition-transform ${showWeights ? 'rotate-180' : ''}`}
            />
          </button>
          {/* 새로고침 */}
          <button
            onClick={() => refresh()}
            disabled={loading}
            className="flex items-center gap-1 text-xs px-2 py-1.5 border rounded dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
            {loading ? '계산 중...' : '새로고침'}
          </button>
        </div>
      </div>

      {/* 가중치 패널 */}
      {showWeights && (
        <div>
          <WeightPanel
            weights={weights}
            onChange={handleWeightsChange}
            onReset={() => {
              handleWeightsChange(DEFAULT_WEIGHTS);
            }}
          />
          <button
            onClick={handleWeightsApply}
            disabled={
              loading ||
              Math.abs(
                weights.signal + weights.technical + weights.valuation + weights.supply - 100
              ) > 0.01
            }
            className="mt-2 w-full text-xs py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            이 가중치로 재계산
          </button>
        </div>
      )}

      {/* needs_refresh 알림 */}
      {data?.needs_refresh && (
        <div className="flex items-center justify-between p-2 mt-2 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-300 dark:border-yellow-700 rounded text-xs text-yellow-700 dark:text-yellow-300">
          <span>📡 신호 {data.total_candidates}개 감지 — 새로운 종목이 추가되었습니다</span>
          <button onClick={() => refresh()} className="underline font-medium ml-2">
            새로고침
          </button>
        </div>
      )}

      {/* 추천 카드 목록 */}
      <div className="mt-3 space-y-3">
        {loading && (
          <div className="text-center py-8 text-gray-400 text-sm">
            <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" />
            점수 계산 중...
          </div>
        )}
        {!loading && displayed.length === 0 && (
          <div className="text-center py-8 text-gray-400 text-sm border border-dashed border-gray-200 dark:border-gray-700 rounded-lg">
            오늘 BUY 신호 종목이 없거나 아직 집계 중입니다.
          </div>
        )}
        {!loading &&
          displayed.map((item) => <RecommendationCard key={item.symbol} item={item} />)}
      </div>
    </div>
  );
}
