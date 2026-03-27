// 스냅샷 조회 + 수동 스냅샷 생성 API
// GET: session_id 또는 date 파라미터로 과거 스냅샷 조회
// POST: 수동 스냅샷 생성 트리거
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// ── 공통: 스냅샷 행을 응답 아이템으로 매핑 ─────────────────────────────────────
function mapRows(rows: Record<string, unknown>[]) {
  return rows.map((row) => ({
    ...((row.raw_data as Record<string, unknown>) ?? {}),
    symbol: row.symbol,
    name: row.name,
    market: row.market,
    current_price: row.current_price,
    score_total: row.score_total,
    grade: row.grade,
    characters: row.characters,
    recommendation: row.recommendation,
    signal_date: row.signal_date,
  }));
}

// Supabase 기본 1000행 제한 → 페이지네이션으로 전체 조회
async function fetchAllRows(
  supabase: ReturnType<typeof createServiceClient>,
  sessionId: number,
) {
  const allData: Record<string, unknown>[] = [];
  let offset = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await supabase
      .from('stock_ranking_snapshot')
      .select('*')
      .eq('session_id', sessionId)
      .order('score_total', { ascending: false })
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    if (!data?.length) break;
    allData.push(...data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return allData;
}

// ── GET: 스냅샷 조회 ────────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get('session_id');
  const date = searchParams.get('date');
  const model = searchParams.get('model') || 'standard';

  if (!sessionId && !date) {
    return NextResponse.json({ error: 'session_id 또는 date 파라미터 필요' }, { status: 400 });
  }

  const supabase = createServiceClient();

  // ── session_id로 직접 조회 ──
  if (sessionId) {
    const { data: session } = await supabase
      .from('snapshot_sessions')
      .select('*')
      .eq('id', Number(sessionId))
      .single();

    if (!session) {
      return NextResponse.json({ error: '세션을 찾을 수 없습니다' }, { status: 404 });
    }

    let allData: Record<string, unknown>[];
    try {
      allData = await fetchAllRows(supabase, Number(sessionId));
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }

    return NextResponse.json(
      {
        date: session.session_date,
        model: session.model,
        session_id: session.id,
        snapshot_time: session.session_time,
        trigger_type: session.trigger_type,
        items: mapRows(allData),
        total: allData.length,
      },
      { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } },
    );
  }

  // ── date 기반 조회 (하위 호환) — 해당 날짜의 최신 세션 ──
  const { data: latestSession } = await supabase
    .from('snapshot_sessions')
    .select('id, session_date, session_time, model, trigger_type')
    .eq('session_date', date!)
    .eq('model', model)
    .order('session_time', { ascending: false })
    .limit(1)
    .single();

  if (!latestSession) {
    return NextResponse.json(
      { date, model, session_id: null, snapshot_time: null, trigger_type: null, items: [], total: 0 },
      { headers: { 'Cache-Control': 'public, s-maxage=60' } },
    );
  }

  let allData: Record<string, unknown>[];
  try {
    allData = await fetchAllRows(supabase, latestSession.id);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  return NextResponse.json(
    {
      date,
      model,
      session_id: latestSession.id,
      snapshot_time: latestSession.session_time,
      trigger_type: latestSession.trigger_type,
      items: mapRows(allData),
      total: allData.length,
    },
    { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } },
  );
}

// ── POST: 수동 스냅샷 생성 ──────────────────────────────────────────────────────
export async function POST() {
  const supabase = createServiceClient();

  // 락 확인
  const { data: status } = await supabase
    .from('snapshot_update_status')
    .select('updating')
    .eq('id', 1)
    .single();

  if (status?.updating) {
    return NextResponse.json(
      { error: '스냅샷 업데이트가 이미 진행 중입니다' },
      { status: 409 },
    );
  }

  // 락 획득
  await supabase
    .from('snapshot_update_status')
    .update({ updating: true, model: 'manual' })
    .eq('id', 1);

  try {
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'http://localhost:3000';

    // 실시간 가격 갱신 (수동 스냅샷 시 최신 가격 보장)
    await fetch(`${baseUrl}/api/v1/prices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }).catch(() => {});

    // stock-ranking 호출 (refresh + snapshot)
    const res = await fetch(
      `${baseUrl}/api/v1/stock-ranking?refresh=true&snapshot=true&trigger_type=manual`,
      { headers: { 'Cache-Control': 'no-cache' } },
    );

    if (!res.ok) {
      return NextResponse.json(
        { error: `스냅샷 생성 실패 (${res.status})` },
        { status: 500 },
      );
    }

    return NextResponse.json({ status: 'completed' });
  } finally {
    // 락 해제
    await supabase
      .from('snapshot_update_status')
      .update({ updating: false, last_updated: new Date().toISOString() })
      .eq('id', 1);
  }
}
