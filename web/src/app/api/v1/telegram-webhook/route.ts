import { NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;

// ── Telegram 타입 ────────────────────────────────────────────
interface TelegramUpdate {
  message?: TelegramMessage;
  channel_post?: TelegramMessage;
}

interface TelegramMessage {
  message_id: number;
  date: number;           // Unix timestamp (메시지 수신 시각)
  forward_date?: number;  // 원본 게시 시각 (포워딩된 경우)
  text?: string;
  caption?: string;
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
  // 신호가 아닌 메시지 스킵
  const skipPatterns = [
    '포트폴리오 리포트',
    '주간 인사이트',
    '프리즘 시뮬레이터',
    '⚠️ 포트폴리오 조정',
    '매도 시그널',    // 시나리오 섹션
    '보유 지속 조건',
    '핵심 가격대',
    '매매 이력 통계',
    '용어 안내',
  ];
  if (skipPatterns.some(p => text.includes(p))) return null;

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  // 원본 발행 시각 우선, 없으면 수신 시각 사용
  const timestamp = new Date((forwardDate ?? messageDate) * 1000).toISOString();

  // ── BUY: "신규 매수: 종목명(심볼)" ──────────────────────────
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

  // ── SELL: "매도: 종목명(심볼)" ──────────────────────────────
  // "⚠️ 포트폴리오 조정:" 과 구분하기 위해 앞에 조정 없는 경우만
  const sellLine = lines.find(l => /^[\s\S]*매도:\s/.test(l) && !l.includes('조정') && !l.includes('시그널'));
  if (sellLine) {
    const afterColon = sellLine.split('매도:')[1]?.trim();
    const parsed = afterColon ? parseNameSymbol(afterColon) : null;
    if (!parsed) return null;

    const sellPriceStr = extractLineValue(lines, '매도가:');
    const signal_price = sellPriceStr ? parsePrice(sellPriceStr) : null;

    const raw_data: Record<string, unknown> = { signal_price };
    const buyPriceStr  = extractLineValue(lines, '매수가:');
    const returnStr    = extractLineValue(lines, '수익률:');
    const holdingStr   = extractLineValue(lines, '보유기간:');
    if (buyPriceStr) raw_data.buy_price    = parsePrice(buyPriceStr);
    if (returnStr)   raw_data.return_pct   = returnStr;
    if (holdingStr)  raw_data.holding_days = holdingStr;

    return { ...parsed, signal_type: 'SELL', signal_price, raw_data, timestamp };
  }

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

  const parsed = parsePrizmMessage(text, message.date, message.forward_date);
  if (!parsed) return Response.json({ ok: true });

  // 2. Supabase upsert_signals_bulk RPC 호출 (기존 Android와 동일 경로)
  const supabase = createServiceClient();
  const { error } = await supabase.rpc('upsert_signals_bulk', {
    payload: [{
      timestamp:   parsed.timestamp,
      symbol:      parsed.symbol,
      name:        parsed.name,
      signal_type: parsed.signal_type,
      signal_price: parsed.signal_price,
      signal_time: null,
      source:      'prizm',
      batch_id:    null,
      is_fallback: false,
      raw_data:    parsed.raw_data,
      device_id:   'telegram-webhook',
    }],
  });

  if (error) {
    console.error('[telegram-webhook] upsert error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ ok: true });
}
