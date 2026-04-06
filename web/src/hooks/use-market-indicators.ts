'use client';

import { useState, useEffect } from 'react';
import { getSupabase } from '@/lib/supabase';

// market_indicators 테이블의 단일 행 타입
export interface MarketIndicator {
  indicator_type: string;
  value: number;
  updated_at: string;
}

/**
 * market_indicators 테이블에서 모든 지표를 조회하는 훅
 * indicator_type 기준 오름차순 정렬
 */
export function useMarketIndicators() {
  const [indicators, setIndicators] = useState<MarketIndicator[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = getSupabase();
    supabase
      .from('market_indicators')
      .select('indicator_type, value, updated_at')
      .order('indicator_type')
      .then(({ data }) => {
        setIndicators((data ?? []) as MarketIndicator[]);
        setLoading(false);
      });
  }, []);

  return { indicators, loading };
}
