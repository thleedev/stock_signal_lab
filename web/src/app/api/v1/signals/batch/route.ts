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
    // signal_price를 top-level 컬럼에 저장 (트리거가 NEW.signal_price로 참조)
    signal_price: s.signal_price ?? null,
    signal_time: s.signal_time ?? null,
    batch_id: body.batch_id || null,
    is_fallback: s.is_fallback ?? false,
    raw_data: {
      ...s.raw_data,
      ...(s.signal_price != null ? { signal_price: s.signal_price } : {}),
      ...(s.time_group ? { time_group: s.time_group } : {}),
    },
    device_id: body.device_id || null,
  }));

  // BUY_FORECAST → BUY 전환: 퀀트 매수(BUY) 신호가 들어오면
  // 동일 종목의 가장 최근 매수예고(BUY_FORECAST)를 BUY로 업데이트
  const buySignals = body.signals.filter(
    (s) => s.signal_type === 'BUY' && s.symbol && s.source === 'quant'
  );
  const upgradedSymbols = new Set<string>();
  for (const buy of buySignals) {
    // 가장 최근 BUY_FORECAST 조회
    const { data: forecast } = await supabase
      .from('signals')
      .select('id, raw_data')
      .eq('symbol', buy.symbol!)
      .eq('source', 'quant')
      .eq('signal_type', 'BUY_FORECAST')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (forecast) {
      await supabase
        .from('signals')
        .update({
          signal_type: 'BUY',
          timestamp: buy.timestamp,
          signal_price: buy.signal_price ?? null,
          raw_data: {
            ...(forecast.raw_data as Record<string, unknown> || {}),
            ...(buy.raw_data || {}),
            ...(buy.signal_price != null ? { signal_price: buy.signal_price } : {}),
            upgraded_from: 'BUY_FORECAST',
          },
        })
        .eq('id', forecast.id);
      upgradedSymbols.add(buy.symbol!);
    }
  }

  // BUY_FORECAST→BUY 전환된 종목은 중복 INSERT 방지를 위해 제외
  const finalRows = rows.filter(
    (r) => !(r.signal_type === 'BUY' && r.source === 'quant' && upgradedSymbols.has(r.symbol ?? ''))
  );

  // KST 오늘 날짜 범위 계산
  const nowUtc = new Date();
  const kstNow = new Date(nowUtc.getTime() + 9 * 60 * 60 * 1000);
  const kstDateStr = kstNow.toISOString().slice(0, 10); // "YYYY-MM-DD"
  const todayKstStart = `${kstDateStr}T00:00:00+09:00`;
  const nextKstDay = new Date(kstNow);
  nextKstDay.setUTCDate(nextKstDay.getUTCDate() + 1);
  const tomorrowKstStart = `${nextKstDay.toISOString().slice(0, 10)}T00:00:00+09:00`;

  // signal_time 유무에 따라 분리
  const rowsWithTime = finalRows.filter((r) => r.signal_time != null);
  const rowsWithoutTime = finalRows.filter((r) => r.signal_time == null);

  const data: { id: string }[] = [];
  let insertError: unknown = null;

  // 1) signal_time이 있는 행:
  //    오늘 KST 범위 내 동일 (symbol, source, signal_type, signal_time=null) 행을 UPDATE
  //    매칭 없으면 upsert INSERT (UNIQUE constraint로 완전 중복 방지)
  for (const row of rowsWithTime) {
    if (row.symbol) {
      const { data: updated } = await supabase
        .from('signals')
        .update({
          signal_time: row.signal_time,
          signal_price: row.signal_price,
          raw_data: row.raw_data,
        })
        .eq('symbol', row.symbol)
        .eq('source', row.source)
        .eq('signal_type', row.signal_type)
        .is('signal_time', null)
        .gte('timestamp', todayKstStart)
        .lt('timestamp', tomorrowKstStart)
        .select('id')
        .limit(1);

      if (updated && updated.length > 0) {
        data.push(...updated);
        continue; // UPDATE 성공 → INSERT 건너뜀
      }
    }

    // UPDATE 대상 없음 → INSERT (UNIQUE constraint로 완전 중복 방지)
    const { data: inserted, error: insertErr } = await supabase
      .from('signals')
      .upsert(row, { onConflict: 'symbol,source,signal_type,signal_time', ignoreDuplicates: true })
      .select('id');
    if (insertErr) insertError = insertErr;
    if (inserted) data.push(...inserted);
  }

  // 2) signal_time이 null인 행:
  //    오늘 KST 범위 내 동일 (symbol, source, signal_type, signal_time=null) 이미 존재하면 중복 → 건너뜀
  for (const row of rowsWithoutTime) {
    if (row.symbol) {
      const { data: existing } = await supabase
        .from('signals')
        .select('id')
        .eq('symbol', row.symbol)
        .eq('source', row.source)
        .eq('signal_type', row.signal_type)
        .is('signal_time', null)
        .gte('timestamp', todayKstStart)
        .lt('timestamp', tomorrowKstStart)
        .limit(1);

      if (existing && existing.length > 0) continue; // 중복 → 건너뜀
    }

    const { data: inserted, error: insertErr } = await supabase
      .from('signals')
      .insert(row)
      .select('id');
    if (insertErr) insertError = insertErr;
    if (inserted) data.push(...inserted);
  }

  if (insertError) {
    console.error('signals insert error:', insertError);
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

  // 장중 시세 갱신 트리거 (비동기, 10분 디바운스는 intraday 내부에서 처리)
  triggerIntradayRefresh().catch(() => {});

  return Response.json({
    success: true,
    inserted: data?.length ?? 0,
    batch_id: body.batch_id,
  });
}

/**
 * 장중 시세 갱신 트리거 (fire-and-forget)
 */
async function triggerIntradayRefresh() {
  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'http://localhost:3000';
  await fetch(`${baseUrl}/api/v1/cron/intraday-prices`, {
    signal: AbortSignal.timeout(5000),
  }).catch(() => {});
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
      signal_time: input.signal_time ?? null,
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
