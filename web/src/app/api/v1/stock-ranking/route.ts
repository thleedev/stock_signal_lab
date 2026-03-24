import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export interface StockRankItem {
  symbol: string;
  name: string;
  market: string;
  current_price: number | null;
  price_change_pct: number | null;
  per: number | null;
  pbr: number | null;
  roe: number | null;
  foreign_net_qty: number | null;
  institution_net_qty: number | null;
  short_sell_ratio: number | null;
  short_sell_updated_at: string | null;
  signal_count_30d: number | null;
  latest_signal_type: string | null;
  latest_signal_date: string | null;
  high_52w: number | null;
  low_52w: number | null;
  // 기본 점수 (stock_cache 기반)
  score_total: number;
  score_valuation: number;
  score_supply: number;
  score_signal: number;
  score_momentum: number;
  // AI 추천 데이터 (ai_recommendations 있는 경우)
  ai?: {
    total_score: number;
    signal_score: number;
    technical_score: number;
    valuation_score: number;
    supply_score: number;
    rsi: number | null;
    golden_cross: boolean;
    bollinger_bottom: boolean;
    phoenix_pattern: boolean;
    macd_cross: boolean;
    volume_surge: boolean;
    week52_low_near: boolean;
    double_top: boolean;
    foreign_buying: boolean;
    institution_buying: boolean;
    volume_vs_sector: boolean;
    low_short_sell: boolean;
  };
}

/**
 * 각 카테고리 0~100 정규화 점수 산출 (애널리스트 관점)
 *
 * - score_valuation (0~100): 저평가 매력도 (PER·PBR·ROE 복합)
 * - score_supply    (0~100): 수급 동향 (외국인·기관·공매도)
 * - score_signal    (0~100): AI 신호 신뢰도 (빈도 + 최근성)
 * - score_momentum  (0~100): 기술적 모멘텀 (가격위치 + 등락률, 과열시 감점)
 */
function calcScore(
  stock: Omit<StockRankItem, 'score_total' | 'score_valuation' | 'score_supply' | 'score_signal' | 'score_momentum' | 'ai'>,
  todayStr: string
) {
  // ── 밸류에이션 (0~100) ──
  // PER: 업종 평균 대비 저평가 여부, PBR: 자산가치 대비, ROE: 수익성
  let vPer = 0, vPbr = 0, vRoe = 0;
  if (stock.per !== null && stock.per > 0) {
    if (stock.per < 5) vPer = 35;
    else if (stock.per < 8) vPer = 28;
    else if (stock.per < 12) vPer = 18;
    else if (stock.per < 15) vPer = 8;
    else if (stock.per < 20) vPer = 3;
  }
  if (stock.pbr !== null && stock.pbr > 0) {
    if (stock.pbr < 0.3) vPbr = 35;
    else if (stock.pbr < 0.5) vPbr = 30;
    else if (stock.pbr < 0.8) vPbr = 20;
    else if (stock.pbr < 1.0) vPbr = 10;
    else if (stock.pbr < 1.5) vPbr = 3;
  }
  if (stock.roe !== null) {
    if (stock.roe > 25) vRoe = 30;
    else if (stock.roe > 20) vRoe = 25;
    else if (stock.roe > 15) vRoe = 20;
    else if (stock.roe > 10) vRoe = 12;
    else if (stock.roe > 5) vRoe = 5;
  }
  const score_valuation = Math.min(100, vPer + vPbr + vRoe);

  // ── 수급 (0~100) ──
  // 외국인/기관 순매수는 가장 강력한 상승 시그널
  let score_supply = 0;
  const foreignBuying = stock.foreign_net_qty !== null && stock.foreign_net_qty > 0;
  const instBuying = stock.institution_net_qty !== null && stock.institution_net_qty > 0;
  if (foreignBuying) score_supply += 30;
  if (instBuying) score_supply += 30;
  if (foreignBuying && instBuying) score_supply += 20; // 동반매수: 매우 강력한 시그널
  const shortSellFresh = stock.short_sell_updated_at?.slice(0, 10) === todayStr;
  if (shortSellFresh && stock.short_sell_ratio !== null && stock.short_sell_ratio >= 0) {
    if (stock.short_sell_ratio < 0.5) score_supply += 20;
    else if (stock.short_sell_ratio < 1) score_supply += 10;
  }

  // ── 신호 신뢰도 (0~100) ──
  // 반복 추천 + 최근일수록 신뢰도 높음
  let score_signal = 0;
  const cnt = stock.signal_count_30d ?? 0;
  if (cnt >= 5) score_signal += 50;       // 매우 빈번: 높은 확신
  else if (cnt >= 3) score_signal += 40;
  else if (cnt >= 2) score_signal += 25;
  else if (cnt >= 1) score_signal += 15;
  if (stock.latest_signal_type === 'BUY' || stock.latest_signal_type === 'BUY_FORECAST') {
    if (stock.latest_signal_date) {
      const days = (new Date(todayStr).getTime() - new Date(stock.latest_signal_date).getTime()) / 86400000;
      if (days <= 1) score_signal += 50;   // 오늘/어제: 최고 신뢰
      else if (days <= 3) score_signal += 35;
      else if (days <= 7) score_signal += 15;
    }
  }
  score_signal = Math.min(100, score_signal);

  // ── 기술/모멘텀 (0~100) ──
  // 52주 저점 대비 위치(반등 초기 유리) + 단기 등락률(과열 감점)
  let score_momentum = 0;

  // 52주 저점 대비 위치: 저점 근처일수록 반등 기대
  if (stock.current_price && stock.low_52w && stock.low_52w > 0) {
    const ratio = stock.current_price / stock.low_52w;
    if (ratio >= 0.95 && ratio <= 1.05) score_momentum += 40;       // 52주 저점 근접: 반등 기대
    else if (ratio > 1.05 && ratio <= 1.15) score_momentum += 30;   // 저점 이탈 초기
    else if (ratio > 1.15 && ratio <= 1.3) score_momentum += 20;    // 상승 추세 진입
    else if (ratio > 1.3 && ratio <= 1.5) score_momentum += 10;     // 상승 중반
  }

  // 52주 고점 대비: 고점 근처는 저항 예상
  if (stock.current_price && stock.high_52w && stock.high_52w > 0) {
    const highRatio = stock.current_price / stock.high_52w;
    if (highRatio > 0.95) score_momentum -= 10;   // 52주 고점 근접: 저항 감점
  }

  // 단기 등락률: 상승 초입에 가점, 과열에 감점
  if (stock.price_change_pct !== null) {
    const pct = stock.price_change_pct;
    if (pct >= 1 && pct < 3) score_momentum += 30;       // 완만 상승: 진입 적기
    else if (pct >= 3 && pct < 5) score_momentum += 40;   // 상승 초입: 최적 모멘텀
    else if (pct >= 5 && pct < 10) score_momentum += 25;  // 상승 진행
    else if (pct >= 10 && pct < 15) score_momentum += 10; // 강한 상승
    else if (pct >= 15 && pct < 25) score_momentum -= 5;  // 과열 주의
    else if (pct >= 25) score_momentum -= 20;              // 극단적 급등: 강한 감점
    else if (pct >= 0 && pct < 1) score_momentum += 15;   // 보합~미약 상승
    else if (pct < 0 && pct > -3) score_momentum += 5;    // 소폭 하락: 눌림목 가능
  }
  score_momentum = Math.max(0, Math.min(100, score_momentum));

  // total은 균등 평균 (클라이언트에서 가중치 적용하므로 여기선 단순 평균)
  const score_total = Math.round((score_valuation + score_supply + score_signal + score_momentum) / 4);
  return { score_total, score_valuation, score_supply, score_signal, score_momentum };
}

function kstDayRange(dateStr: string) {
  return {
    start: `${dateStr}T00:00:00+09:00`,
    end: `${dateStr}T23:59:59+09:00`,
  };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    // 페이지네이션은 클라이언트에서 처리 — 서버는 전체 반환
    const page = 1;
    const limit = 99999;
    const q = searchParams.get('q')?.trim().toLowerCase() ?? '';
    const market = searchParams.get('market') ?? 'all';

    const supabase = createServiceClient();
    const now = new Date();
    const todayStr = new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const dateParam = searchParams.get('date');
    const showAll = !dateParam || dateParam === 'all';
    const showWeek = dateParam === 'week';
    const showSignalAll = dateParam === 'signal_all'; // 신호전체: 최근 30일 신호 있는 종목

    // 이번주(월~오늘) 범위 계산
    const weekStart = (() => {
      const day = now.getUTCDay(); // UTC 기준 요일 (KST +9h 반영된 now)
      const kstDay = new Date(now.getTime() + 9 * 60 * 60 * 1000).getDay();
      const daysFromMonday = kstDay === 0 ? 6 : kstDay - 1;
      return new Date(now.getTime() + 9 * 60 * 60 * 1000 - daysFromMonday * 86400000)
        .toISOString().slice(0, 10);
    })();

    const dateStr = showAll || showWeek || showSignalAll ? todayStr : dateParam;

    // ── 날짜 지정 시: 해당 날짜/기간 BUY 신호 심볼 먼저 조회
    let dateSymbols: Set<string> | null = null;
    // 선택된 날짜의 실제 신호 날짜 (stock_cache.latest_signal_date 대체)
    const dateSignalMap = new Map<string, string>();
    if (!showAll && !showSignalAll) {
      const start = showWeek ? `${weekStart}T00:00:00+09:00` : kstDayRange(dateStr).start;
      const end = showWeek ? `${todayStr}T23:59:59+09:00` : kstDayRange(dateStr).end;
      const { data: sigRows } = await supabase
        .from('signals')
        .select('symbol, timestamp')
        .gte('timestamp', start)
        .lte('timestamp', end)
        .in('signal_type', ['BUY', 'BUY_FORECAST'])
        .order('timestamp', { ascending: false });
      if (sigRows && sigRows.length > 0) {
        dateSymbols = new Set<string>();
        for (const r of sigRows) {
          const sym = r.symbol as string;
          dateSymbols.add(sym);
          // 해당 날짜의 가장 최근 BUY 신호 시각 저장
          if (!dateSignalMap.has(sym)) {
            dateSignalMap.set(sym, r.timestamp as string);
          }
        }
      } else {
        // 해당 날짜/기간 신호 없음 → 빈 결과 반환
        return NextResponse.json({ items: [], total: 0, page, limit, today: todayStr });
      }
    }

    // ── stock_cache + ai_recommendations 병렬 조회
    const allRows: Record<string, unknown>[] = [];
    let from = 0;

    const aiSelect = 'symbol, total_score, signal_score, technical_score, valuation_score, supply_score, rsi, golden_cross, bollinger_bottom, phoenix_pattern, macd_cross, volume_surge, week52_low_near, double_top, foreign_buying, institution_buying, volume_vs_sector, low_short_sell';
    const [, aiRecsResult] = await Promise.all([
      (async () => {
        while (true) {
          let query = supabase
            .from('stock_cache')
            .select('symbol, name, market, current_price, price_change_pct, per, pbr, roe, foreign_net_qty, institution_net_qty, short_sell_ratio, short_sell_updated_at, signal_count_30d, latest_signal_type, latest_signal_date, high_52w, low_52w')
            .not('current_price', 'is', null)
            .range(from, from + 999);
          if (market !== 'all') query = query.eq('market', market);
          if (showSignalAll) query = query.gt('signal_count_30d', 0);
          const { data } = await query;
          if (!data || data.length === 0) break;
          allRows.push(...data);
          if (data.length < 1000) break;
          from += 1000;
        }
      })(),
      supabase
        .from('ai_recommendations')
        .select(aiSelect)
        .eq('date', todayStr),
    ]);

    const aiRecMap = new Map(
      (aiRecsResult.data ?? []).map((r) => [r.symbol as string, r])
    );

    // ── 점수 계산 + ai 병합 + 날짜 필터
    const scored: StockRankItem[] = allRows
      .filter((r) => r.symbol && r.name)
      .filter((r) => !dateSymbols || dateSymbols.has(r.symbol as string))
      .map((r) => {
        const base = r as Omit<StockRankItem, 'score_total' | 'score_valuation' | 'score_supply' | 'score_signal' | 'score_momentum' | 'ai'>;
        // 선택된 날짜의 실제 BUY 신호 날짜로 덮어쓰기 (stock_cache 전체 신호 기준 → 해당 날짜 BUY 기준)
        const dateSig = dateSignalMap.get(base.symbol);
        if (dateSig) {
          base.latest_signal_date = dateSig;
          base.latest_signal_type = 'BUY';
        }
        const scores = calcScore(base, todayStr);
        const aiRec = aiRecMap.get(base.symbol);
        const item: StockRankItem = { ...base, ...scores };
        if (aiRec) {
          item.ai = {
            total_score: aiRec.total_score ?? 0,
            signal_score: aiRec.signal_score ?? 0,
            technical_score: aiRec.technical_score ?? 0,
            valuation_score: aiRec.valuation_score ?? 0,
            supply_score: aiRec.supply_score ?? 0,
            rsi: aiRec.rsi ?? null,
            golden_cross: aiRec.golden_cross ?? false,
            bollinger_bottom: aiRec.bollinger_bottom ?? false,
            phoenix_pattern: aiRec.phoenix_pattern ?? false,
            macd_cross: aiRec.macd_cross ?? false,
            volume_surge: aiRec.volume_surge ?? false,
            week52_low_near: aiRec.week52_low_near ?? false,
            double_top: aiRec.double_top ?? false,
            foreign_buying: aiRec.foreign_buying ?? false,
            institution_buying: aiRec.institution_buying ?? false,
            volume_vs_sector: aiRec.volume_vs_sector ?? false,
            low_short_sell: aiRec.low_short_sell ?? false,
          };
        }
        return item;
      });

    // ── 검색 필터
    const filtered = q
      ? scored.filter((s) => s.name?.toLowerCase().includes(q) || s.symbol?.toLowerCase().includes(q))
      : scored;

    // ── 정렬: AI 우선, 그 다음 score_total 내림차순
    filtered.sort((a, b) => {
      const aHasAi = a.ai ? 1 : 0;
      const bHasAi = b.ai ? 1 : 0;
      if (aHasAi !== bHasAi) return bHasAi - aHasAi;
      return b.score_total - a.score_total;
    });

    const total = filtered.length;
    const offset = (page - 1) * limit;
    const items = filtered.slice(offset, offset + limit);

    return NextResponse.json({ items, total, page, limit, today: todayStr });
  } catch (e) {
    console.error('[stock-ranking]', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
