import { NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { verifyCollectorKey, unauthorizedResponse } from '@/lib/auth';

interface SignalTimeInput {
  symbol?: string | null;
  source?: string | null;
  signal_type?: string | null;
  signal_time?: string | null;
}

/**
 * POST /api/v1/collector/signal-times — 이미 저장된 신호의 signal_time 채우기
 *
 * 수집기가 anon 키로 signals 에 직접 PATCH 하던 경로를 대신합니다
 * (SignalApiClient.updateSignalTimes). 키움 SMS 로 먼저 들어온 신호는 절대시각이
 * 없어 signal_time 이 null 인데, 라씨 화면 수집이 나중에 그 값을 알아냅니다.
 *
 * 대상 조건은 수집기가 쓰던 것과 같습니다.
 *   같은 symbol·source·signal_type + signal_time IS NULL
 *   + timestamp 가 신호시각 ±2시간 이내
 * 시각 범위를 두는 이유는 같은 종목이 여러 날 반복될 때 엉뚱한 날 행을 덮지 않기
 * 위해서입니다. 이미 채워진 행은 건드리지 않습니다.
 */
export async function POST(request: NextRequest) {
  if (!verifyCollectorKey(request)) {
    return unauthorizedResponse();
  }

  let signals: SignalTimeInput[];
  try {
    ({ signals } = await request.json());
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  if (!Array.isArray(signals)) {
    return Response.json({ error: 'signals array is required' }, { status: 400 });
  }

  const supabase = createServiceClient();
  let updated = 0;
  let skipped = 0;

  for (const s of signals) {
    if (!s.symbol || !s.source || !s.signal_type || !s.signal_time) {
      skipped++;
      continue;
    }

    const at = new Date(s.signal_time);
    if (Number.isNaN(at.getTime())) {
      skipped++;
      continue;
    }
    const from = new Date(at.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const to = new Date(at.getTime() + 2 * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from('signals')
      .update({ signal_time: s.signal_time })
      .eq('symbol', s.symbol)
      .eq('source', s.source)
      .eq('signal_type', s.signal_type)
      .is('signal_time', null)
      .gte('timestamp', from)
      .lte('timestamp', to)
      .select('id');

    if (error) {
      console.error(`[collector/signal-times] ${s.symbol} 갱신 실패:`, error.message);
      skipped++;
      continue;
    }
    updated += data?.length ?? 0;
  }

  return Response.json({ updated, skipped, total: signals.length });
}
