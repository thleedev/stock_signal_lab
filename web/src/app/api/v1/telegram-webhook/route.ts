import { NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;

// ── Telegram 타입 ────────────────────────────────────────────
interface TelegramUpdate {
  message?: TelegramMessage;
  channel_post?: TelegramMessage;
}

interface TelegramChat {
  id: number;
  username?: string;
  title?: string;
  type: string;
}

interface TelegramMessage {
  message_id: number;
  date: number;              // Unix timestamp (메시지 수신 시각)
  forward_date?: number;     // 원본 게시 시각 (포워딩된 경우)
  forward_from_chat?: TelegramChat; // 채널/그룹에서 포워딩된 경우 원본 채널 정보
  text?: string;
  caption?: string;
}

// PRIZM 신호로 처리할 조건:
// 1) @stock_ai_ko 채널에서 포워딩된 메시지
// 2) 텍스트에 #프리즘인사이트 해시태그 포함
const PRIZM_SOURCE_USERNAME = 'stock_ai_ko';
const PRIZM_HASHTAG = '#프리즘인사이트';

function isPrizmMessage(message: TelegramMessage): boolean {
  const text = message.text ?? message.caption ?? '';
  const fromPrizm = message.forward_from_chat?.username === PRIZM_SOURCE_USERNAME;
  const hasHashtag = text.includes(PRIZM_HASHTAG);
  return fromPrizm || hasHashtag;
}

// ── 파싱 헬퍼 ───────────────────────────────────────────────
function parsePrice(str: string): number | null {
  const cleaned = str.replace(/[^0-9]/g, '');
  return cleaned ? parseInt(cleaned, 10) : null;
}

function parseNameSymbol(str: string): { name: string; symbol: string } | null {
  // "한화에어로스페이스(012450)" 형태 파싱
  const match = str.match(/(.+?)\((\d{4,6}|[A-Z]{1,5})\)/);
  if (!match) return null;
  return { name: match[1].trim(), symbol: match[2].trim() };
}

function extractLineValue(lines: string[], prefix: string): string | null {
  const line = lines.find(l => l.startsWith(prefix));
  if (!line) return null;
  return line.slice(prefix.length).trim();
}

// ── PRIZM 메시지 파서 ────────────────────────────────────────
interface ParsedSignal {
  name: string;
  symbol: string;
  signal_type: 'BUY' | 'SELL';
  signal_price: number | null;
  raw_data: Record<string, unknown>;
  timestamp: string; // ISO8601
}

function parsePrizmMessage(text: string, messageDate: number, forwardDate?: number): ParsedSignal | null {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  // 원본 발행 시각 우선, 없으면 수신 시각 사용
  const timestamp = new Date((forwardDate ?? messageDate) * 1000).toISOString();

  // ── BUY: "신규 매수: 종목명(심볼)" ──────────────────────────
  // 메시지 안에 매매 시나리오·시뮬레이터 섹션이 함께 포함되므로
  // skipPatterns 대신 신호 식별자를 먼저 찾아 처리
  const buyLine = lines.find(l => l.includes('신규 매수:'));
  if (buyLine) {
    const afterColon = buyLine.split('신규 매수:')[1]?.trim();
    const parsed = afterColon ? parseNameSymbol(afterColon) : null;
    if (!parsed) return null;

    const buyPriceStr = extractLineValue(lines, '매수가:');
    const signal_price = buyPriceStr ? parsePrice(buyPriceStr) : null;

    const raw_data: Record<string, unknown> = { signal_price };
    const targetStr = extractLineValue(lines, '목표가:');
    const stopStr   = extractLineValue(lines, '손절가:');
    const period    = extractLineValue(lines, '투자기간:');
    const sector    = extractLineValue(lines, '산업군:');
    if (targetStr) raw_data.target_price = parsePrice(targetStr);
    if (stopStr)   raw_data.stop_loss    = parsePrice(stopStr);
    if (period)    raw_data.period       = period;
    if (sector)    raw_data.sector       = sector;

    return { ...parsed, signal_type: 'BUY', signal_price, raw_data, timestamp };
  }

  // ── SELL: trim 후 "매도: 종목명(심볼)" 으로 시작하는 줄 ────────
  // "⚠️ 포트폴리오 조정:", "🔔 매도 시그널:" 와 구분하기 위해
  // trim 후 정확히 "매도: " 로 시작하고 종목(심볼) 패턴이 있는 줄만 선택
  const sellLine = lines.find(l =>
    /^매도:\s/.test(l) && parseNameSymbol(l.replace(/^매도:\s*/, '')) !== null
  );
  if (sellLine) {
    const afterColon = sellLine.replace(/^매도:\s*/, '').trim();
    const parsed = parseNameSymbol(afterColon);
    if (!parsed) return null;

    const sellPriceStr = extractLineValue(lines, '매도가:');
    const signal_price = sellPriceStr ? parsePrice(sellPriceStr) : null;

    const raw_data: Record<string, unknown> = { signal_price };
    const buyPriceStr = extractLineValue(lines, '매수가:');
    const returnStr   = extractLineValue(lines, '수익률:');
    const holdingStr  = extractLineValue(lines, '보유기간:');
    if (buyPriceStr) raw_data.buy_price    = parsePrice(buyPriceStr);
    if (returnStr)   raw_data.return_pct   = returnStr;
    if (holdingStr)  raw_data.holding_days = holdingStr;

    return { ...parsed, signal_type: 'SELL', signal_price, raw_data, timestamp };
  }

  // BUY/SELL 식별자 없음 → 포트폴리오 리포트, 주간 인사이트, 조정 등 → 스킵
  return null;
}

// ── Route Handler ────────────────────────────────────────────
export async function POST(request: NextRequest) {
  // 1. Secret token 검증
  if (WEBHOOK_SECRET) {
    const secretHeader = request.headers.get('x-telegram-bot-api-secret-token');
    if (secretHeader !== WEBHOOK_SECRET) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const update: TelegramUpdate = await request.json();
  const message = update.message ?? update.channel_post;
  if (!message) return Response.json({ ok: true });

  const text = message.text ?? message.caption ?? '';
  if (!text) return Response.json({ ok: true });

  const supabase = createServiceClient();

  // ── Android 배치 신호 ────────────────────────────────────────
  // Android collector → sender bot → 전용 그룹 → webhook
  if (text.trimStart().startsWith('[SIGNAL_BATCH]')) {
    try {
      const jsonStr = text.replace(/^\[SIGNAL_BATCH\]\n/, '');
      const batch = JSON.parse(jsonStr) as {
        batch_id: string;
        device_id: string;
        signals: Record<string, unknown>[];
      };

      if (!batch.signals?.length) return Response.json({ ok: true });

      const payload = batch.signals.map(s => ({
        ...s,
        batch_id:  batch.batch_id,
        device_id: batch.device_id,
      }));

      const { error } = await supabase.rpc('upsert_signals_bulk', { payload });
      if (error) {
        console.error('[telegram-webhook] android upsert error:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
      }

      // AI 추천 생성 트리거
      const webappUrl = process.env.WEBAPP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? '';
      if (webappUrl) {
        fetch(`${webappUrl}/api/v1/ai-recommendations/generate`, { method: 'POST' })
          .catch(() => {/* 비동기 트리거, 실패 무시 */});
      }

      return Response.json({ ok: true });
    } catch (e) {
      console.error('[telegram-webhook] android parse error:', e);
      return Response.json({ error: 'parse error' }, { status: 400 });
    }
  }

  // ── PRIZM 신호 ───────────────────────────────────────────────
  // @stock_ai_ko 포워딩이거나 #프리즘인사이트 태그만 처리
  if (!isPrizmMessage(message)) return Response.json({ ok: true });

  const parsed = parsePrizmMessage(text, message.date, message.forward_date);
  if (!parsed) return Response.json({ ok: true });

  const { error } = await supabase.rpc('upsert_signals_bulk', {
    payload: [{
      timestamp:    parsed.timestamp,
      symbol:       parsed.symbol,
      name:         parsed.name,
      signal_type:  parsed.signal_type,
      signal_price: parsed.signal_price,
      signal_time:  null,
      source:       'prizm',
      batch_id:     null,
      is_fallback:  false,
      raw_data:     parsed.raw_data,
      device_id:    'telegram-webhook',
    }],
  });

  if (error) {
    console.error('[telegram-webhook] prizm upsert error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ ok: true });
}
