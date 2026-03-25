import { NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { verifyCollectorKey, unauthorizedResponse } from '@/lib/auth';
import { SignalBatchRequest, Signal } from '@/types/signal';
import { processSignal } from '@/lib/strategy-engine';
import { sendSignalNotification } from '@/lib/fcm';
import { enrichSignalStocks } from '@/lib/signal-data-enricher';

// POST /api/v1/signals/batch — 수집기에서 신호 일괄 수신
export async function POST(request: NextRequest) {
  if (!verifyCollectorKey(request)) {
    return unauthorizedResponse();
  }

  const body: SignalBatchRequest = await request.json();

  if (!body.signals || !Array.isArray(body.signals) || body.signals.length === 0) {
    return Response.json({ error: 'signals array is required' }, { status: 400 });
  }

  const supabase = createServiceClient();

  // 신호 데이터를 DB 형식으로 변환
  const rows = body.signals.map((s) => ({
    timestamp: s.timestamp,
    symbol: s.symbol || null,
    name: s.name,
    signal_type: s.signal_type,
    source: s.source,
    batch_id: body.batch_id || null,
    is_fallback: s.is_fallback ?? false,
    raw_data: {
      ...s.raw_data,
      ...(s.signal_price != null ? { signal_price: s.signal_price } : {}),
      ...(s.time_group ? { time_group: s.time_group } : {}),
    },
    device_id: body.device_id || null,
  }));

  // upsert with ignoreDuplicates: UNIQUE constraint(idx_signals_dedup)에
  // 걸리는 중복 행은 무시하고 나머지만 INSERT
  const { data, error } = await supabase
    .from('signals')
    .upsert(rows, { onConflict: 'symbol,source,signal_type,signal_time', ignoreDuplicates: true })
    .select('id');

  if (error) {
    console.error('signals insert error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }

  // heartbeat 업데이트
  if (body.device_id) {
    await supabase.from('collector_heartbeats').insert({
      device_id: body.device_id,
      status: 'active',
      last_signal: new Date().toISOString(),
    });
  }

  // 전략 엔진: 신호별로 일시/분할 매매 시뮬레이션 (비동기 — 응답 차단하지 않음)
  if (data && data.length > 0) {
    const insertedIds = data.map((d) => d.id);
    processSignalsBatch(supabase, insertedIds).catch((e) =>
      console.error('[strategy-engine] batch processing error:', e)
    );
  }

  // FCM 푸시 알림 전송 (비동기 — 응답 차단하지 않음)
  sendSignalNotifications(body.signals, data).catch((e) =>
    console.error('[fcm] notification error:', e)
  );

  // 수급/일봉/forward 사전 조회 (비동기 — 응답 차단하지 않음)
  // 신호 종목의 데이터를 미리 확보하여 종목분석 점수 정확도 보장
  const signalSymbols = body.signals
    .filter((s) => s.symbol && (s.signal_type === 'BUY' || s.signal_type === 'BUY_FORECAST'))
    .map((s) => s.symbol!);
  if (signalSymbols.length > 0) {
    enrichSignalStocks(supabase, signalSymbols).catch((e) =>
      console.error('[signal-enricher] enrichment error:', e)
    );
  }

  return Response.json({
    success: true,
    inserted: data?.length ?? 0,
    batch_id: body.batch_id,
  });
}

/**
 * 전략 엔진에 신호 전달 (비동기)
 */
async function processSignalsBatch(
  supabase: ReturnType<typeof createServiceClient>,
  signalIds: string[]
) {
  const { data: signals } = await supabase
    .from('signals')
    .select('*')
    .in('id', signalIds);

  if (!signals) return;

  let lumpCount = 0;
  let splitCount = 0;

  for (const signal of signals as Signal[]) {
    try {
      const result = await processSignal(supabase, signal);
      if (result.lump) lumpCount++;
      if (result.split) splitCount++;
    } catch (e) {
      console.error(`[strategy-engine] signal ${signal.id} error:`, e);
    }
  }

}

/**
 * 삽입된 신호에 대해 FCM 푸시 알림 전송 (비동기, fire-and-forget)
 */
async function sendSignalNotifications(
  inputSignals: SignalBatchRequest['signals'],
  insertedData: { id: string }[] | null
) {
  if (!insertedData || insertedData.length === 0) return;

  // 삽입된 ID와 입력 신호를 매핑하여 Signal 객체 구성
  for (let i = 0; i < insertedData.length && i < inputSignals.length; i++) {
    const input = inputSignals[i];
    const inserted = insertedData[i];

    const signal: Signal = {
      id: inserted.id,
      created_at: new Date().toISOString(),
      timestamp: input.timestamp,
      symbol: input.symbol || null,
      name: input.name,
      signal_type: input.signal_type,
      source: input.source,
      batch_id: null,
      is_fallback: input.is_fallback ?? false,
      raw_data: input.raw_data || null,
      device_id: null,
    };

    try {
      await sendSignalNotification(signal);
    } catch (e) {
      console.error(`[fcm] signal ${signal.id} notification error:`, e);
    }
  }
}
