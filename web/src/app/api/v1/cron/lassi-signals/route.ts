import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import {
  collectLassiSignals,
  isLassiCollectionWindow,
  nowKstIso,
  toUpsertPayload,
} from '@/lib/thinkpool-lassi';
import { enrichSignalStocks } from '@/lib/signal-data-enricher';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DEVICE_ID = 'thinkpool-api';

/**
 * collector_heartbeats 에 수집 결과를 기록합니다.
 *
 * 설계 문서 10절은 씽크풀이 막혔을 때 thinkpool-api 하트비트로 조기 감지한다고 규정합니다.
 * 성공 경로에만 남기면 빈 목록 응답처럼 조용히 끊기는 장애를 놓치므로 실패·0건 경로에도 기록합니다.
 * 하트비트 insert 실패가 응답을 막지 않도록 오류는 로그로만 처리합니다.
 */
async function writeHeartbeat(status: 'active' | 'error', errorMessage?: string): Promise<void> {
  try {
    const supabase = createServiceClient();
    const { error } = await supabase.from('collector_heartbeats').insert({
      device_id: DEVICE_ID,
      status,
      last_signal: status === 'active' ? new Date().toISOString() : null,
      error_message: errorMessage ?? null,
    });
    if (error) {
      console.error('[cron/lassi-signals] heartbeat insert 오류:', error.message);
    }
  } catch (e) {
    console.error('[cron/lassi-signals] heartbeat insert 예외:', e);
  }
}

/**
 * GET|POST /api/v1/cron/lassi-signals
 *
 * 씽크풀 라씨 당일 매수/매도 전량을 수집해 upsert_signals_bulk 로 저장한다.
 * 인증: Authorization: Bearer {CRON_SECRET}
 *       (CRON_SECRET 미설정 시 로컬 수동 호출 허용 — market-events 와 동일)
 *
 * 쿼리:
 *   dry_run=1  — Thinkpool 조회·매핑만 하고 DB 쓰지 않음
 *   force=1    — 수집 시간대(KST 월~금 09:00~15:45) 가드를 건너뜀
 */
async function handle(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const force =
    request.nextUrl.searchParams.get('force') === '1' ||
    request.nextUrl.searchParams.get('force') === 'true';

  // 장중 15분 간격 배치가 시간대 밖에서 Thinkpool 을 반복 호출하지 않도록 막는다.
  if (!force) {
    const now = new Date();
    if (!isLassiCollectionWindow(now)) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: 'outside-collection-window',
        kst: nowKstIso(now),
      });
    }
  }

  const dryRun =
    request.nextUrl.searchParams.get('dry_run') === '1' ||
    request.nextUrl.searchParams.get('dry_run') === 'true';

  let collected;
  try {
    collected = await collectLassiSignals();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[cron/lassi-signals] fetch error:', message);
    if (!dryRun) await writeHeartbeat('error', `씽크풀 조회 실패: ${message}`);
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const { buy, sell, signals, collectedAt, batchId, staleDropped } = collected;
  const summary = {
    buy_count: buy.totalCount,
    sell_count: sell.totalCount,
    buy_list_len: buy.list.length,
    sell_list_len: sell.list.length,
    mapped: signals.length,
    stale_dropped: staleDropped,
    collected_at: collectedAt,
    batch_id: batchId,
  };

  if (signals.length === 0) {
    // 씽크풀이 401 대신 빈 목록을 주는 형태로 막힐 수 있어 0건은 이상 징후로 봅니다.
    if (!dryRun) {
      await writeHeartbeat(
        'error',
        `수집 0건 (buy=${buy.totalCount} sell=${sell.totalCount} stale_dropped=${staleDropped})`
      );
    }
    return NextResponse.json({ ok: true, dry_run: dryRun, upserted: 0, ...summary });
  }

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      dry_run: true,
      upserted: 0,
      sample: signals.slice(0, 3),
      ...summary,
    });
  }

  const supabase = createServiceClient();
  const payload = toUpsertPayload(signals, batchId, DEVICE_ID);

  const buySymbols = [
    ...new Set(
      signals.filter((s) => s.signal_type === 'BUY' && s.symbol).map((s) => s.symbol!)
    ),
  ];

  // 오늘(KST) 이미 저장된 lassi BUY 심볼을 upsert 직전에 한 번 조회합니다.
  // 범위 계산은 /api/v1/signals/today 와 동일하게 timestamp 로 거릅니다.
  const kstToday = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const knownBuySymbols = new Set<string>();
  let knownLookupOk = false;
  if (buySymbols.length > 0) {
    const { data: existingRows, error: existingError } = await supabase
      .from('signals')
      .select('symbol')
      .eq('source', 'lassi')
      .eq('signal_type', 'BUY')
      .gte('timestamp', `${kstToday}T00:00:00+09:00`)
      .lt('timestamp', `${kstToday}T23:59:59+09:00`);

    if (existingError) {
      console.error('[cron/lassi-signals] 기존 BUY 조회 오류:', existingError.message);
    } else {
      for (const row of existingRows ?? []) {
        if (row.symbol) knownBuySymbols.add(row.symbol as string);
      }
      knownLookupOk = true;
    }
  }

  const { error } = await supabase.rpc('upsert_signals_bulk', { payload });
  if (error) {
    console.error('[cron/lassi-signals] upsert error:', error.message);
    await writeHeartbeat('error', `upsert 실패: ${error.message}`);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await writeHeartbeat('active');

  // 이번에 처음 등장한 BUY 심볼만 보강합니다 (비동기).
  // 매 호출마다 전량을 보강하면 15분 간격 재호출로 네이버·KRX·DART 외부 요청이 하루 수천 건이 됩니다.
  // 기존 조회가 실패했다면 신규 여부를 판단할 근거가 없으므로 이번 회차는 보강을 건너뜁니다.
  const newBuySymbols = knownLookupOk
    ? buySymbols.filter((s) => !knownBuySymbols.has(s))
    : [];
  if (newBuySymbols.length > 0) {
    enrichSignalStocks(supabase, newBuySymbols).catch((e) =>
      console.error('[cron/lassi-signals] enrich error:', e)
    );
  }

  // AI 추천 재생성 트리거 (비동기)
  // 신규 BUY 심볼이 있을 때만 돌립니다. 변동이 없으면 15분마다 같은 추천을 다시 만들 뿐입니다.
  // force=1 은 full 배치의 step11 이며 step4(스코어링) 이전이라 낡은 점수로 만들어지므로,
  // 배치가 step5 에서 생성하도록 넘깁니다.
  const webappUrl =
    process.env.WEBAPP_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '');
  if (webappUrl && newBuySymbols.length > 0 && !force) {
    fetch(`${webappUrl}/api/v1/ai-recommendations/generate`, { method: 'POST' }).catch(
      () => {}
    );
  }

  return NextResponse.json({
    ok: true,
    dry_run: false,
    upserted: signals.length,
    enriched: newBuySymbols.length,
    ...summary,
  });
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
