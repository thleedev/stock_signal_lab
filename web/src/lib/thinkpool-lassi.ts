/**
 * 씽크풀 라씨매매신호 API 클라이언트
 *
 * 영웅문 접근성 스크래핑 대신 공개(조사 시점) Thinkpool API로
 * 당일 매수/매도 전량 목록을 수집한다.
 *
 * GET https://api.thinkpool.com/signal/{B|S}/signalTodayBuySellList
 */

import { randomUUID } from 'crypto';
import type { SignalInput, SignalType } from '@/types/signal';

const BASE = 'https://api.thinkpool.com/signal';
const DEFAULT_TIMEOUT_MS = 15_000;

export type ThinkpoolTradeFlag = 'B' | 'S';

export interface ThinkpoolLassiItem {
  stockCode: string;
  stockName: string;
  tradeDttm: string;
  elapsedTmTx: string;
  tradePrice: number;
  profitRate: number;
}

export interface ThinkpoolLassiListResponse {
  totalCount: number;
  list: ThinkpoolLassiItem[];
}

export interface FetchLassiOptions {
  /** fetch 타임아웃 ms (기본 15초) */
  timeoutMs?: number;
  /** 테스트용 fetch 주입 */
  fetchImpl?: typeof fetch;
  /** 테스트용 수집 시각 주입 (기본 현재 시각) */
  now?: Date;
}

export interface CollectLassiResult {
  buy: ThinkpoolLassiListResponse;
  sell: ThinkpoolLassiListResponse;
  signals: SignalInput[];
  collectedAt: string;
  batchId: string;
  /** 수집일과 tradeDttm 날짜가 달라 제외한 건수 */
  staleDropped: number;
}

const FLAG_TO_TYPE: Record<ThinkpoolTradeFlag, SignalType> = {
  B: 'BUY',
  S: 'SELL',
};

/**
 * tradeDttm `YYYYMMDDHHmmss` → ISO-8601 KST (`+09:00`)
 */
export function parseTradeDttm(tradeDttm: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(tradeDttm.trim());
  if (!m) {
    throw new Error(`Invalid tradeDttm: ${tradeDttm}`);
  }
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+09:00`;
}

/** 현재 시각을 Asia/Seoul 오프셋 ISO 문자열로 */
export function nowKstIso(date = new Date()): string {
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const mo = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(kst.getUTCDate()).padStart(2, '0');
  const h = String(kst.getUTCHours()).padStart(2, '0');
  const mi = String(kst.getUTCMinutes()).padStart(2, '0');
  const s = String(kst.getUTCSeconds()).padStart(2, '0');
  return `${y}-${mo}-${d}T${h}:${mi}:${s}+09:00`;
}

/** 수집 허용 시간대 (KST 09:00:00 ~ 15:45:00, 자정 기준 초) */
const WINDOW_START_SEC = 9 * 3600;
const WINDOW_END_SEC = 15 * 3600 + 45 * 60;

/**
 * KST 기준 라씨 수집 시간대인지 판정한다.
 *
 * 라씨 신호는 정규장에서만 발생하므로 장 종료 후 반복 호출은 같은 데이터를 다시 받을 뿐이다.
 * 월~금 09:00:00 이상 15:45:00 이하이면 true 이며 경계값은 양쪽 모두 포함한다.
 */
export function isLassiCollectionWindow(date: Date = new Date()): boolean {
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);

  const day = kst.getUTCDay();
  if (day === 0 || day === 6) return false; // 일·토

  const sec = kst.getUTCHours() * 3600 + kst.getUTCMinutes() * 60 + kst.getUTCSeconds();
  return sec >= WINDOW_START_SEC && sec <= WINDOW_END_SEC;
}

/**
 * tradeDttm 의 KST 날짜가 수집 시각의 KST 날짜와 같은지 판정합니다.
 *
 * `signals` 의 UNIQUE 키는 `signal_date_kst(timestamp)` 이고 timestamp 에는 수집 시각이 들어갑니다.
 * 공휴일에 force=1 로 수집하면 씽크풀이 직전 거래일 목록을 그대로 반환할 수 있는데,
 * 그대로 저장하면 전 거래일 신호가 휴장일자 신규 행으로 복제됩니다.
 * 형식이 깨진 tradeDttm 도 날짜를 확인할 수 없으므로 false 로 판정해 제외합니다.
 *
 * @param collectedAtKstIso `nowKstIso()` 형식(`YYYY-MM-DDTHH:mm:ss+09:00`)의 수집 시각
 */
export function isSameKstTradeDate(tradeDttm: string, collectedAtKstIso: string): boolean {
  if (typeof tradeDttm !== 'string') return false;
  const m = /^(\d{4})(\d{2})(\d{2})\d{6}$/.exec(tradeDttm.trim());
  if (!m) return false;
  return `${m[1]}-${m[2]}-${m[3]}` === collectedAtKstIso.slice(0, 10);
}

export function mapLassiItem(
  item: ThinkpoolLassiItem,
  flag: ThinkpoolTradeFlag,
  collectedAt: string
): SignalInput {
  const signalTime = parseTradeDttm(item.tradeDttm);
  const price =
    typeof item.tradePrice === 'number' && Number.isFinite(item.tradePrice)
      ? Math.round(item.tradePrice)
      : null;

  return {
    timestamp: collectedAt,
    symbol: item.stockCode,
    name: item.stockName,
    signal_type: FLAG_TO_TYPE[flag],
    signal_price: price,
    signal_time: signalTime,
    source: 'lassi',
    is_fallback: false,
    raw_data: {
      provider: 'thinkpool',
      tradeFlag: flag,
      tradeDttm: item.tradeDttm,
      elapsedTmTx: item.elapsedTmTx,
      profitRate: item.profitRate,
      signal_price: price,
    },
  };
}

function assertListResponse(data: unknown, flag: ThinkpoolTradeFlag): ThinkpoolLassiListResponse {
  if (!data || typeof data !== 'object') {
    throw new Error(`Thinkpool ${flag}: invalid JSON body`);
  }
  const body = data as Record<string, unknown>;
  if (typeof body.totalCount !== 'number' || !Array.isArray(body.list)) {
    throw new Error(`Thinkpool ${flag}: missing totalCount/list`);
  }
  return { totalCount: body.totalCount, list: body.list as ThinkpoolLassiItem[] };
}

/**
 * 매수 또는 매도 전량 목록 조회
 */
export async function fetchLassiList(
  flag: ThinkpoolTradeFlag,
  options: FetchLassiOptions = {}
): Promise<ThinkpoolLassiListResponse> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url = `${BASE}/${flag}/signalTodayBuySellList`;

  const res = await fetchImpl(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Origin: 'https://m.thinkpool.com',
      Referer: 'https://m.thinkpool.com/signal',
      'User-Agent': 'DashboardStock-LassiCollector/1.0',
    },
    signal: AbortSignal.timeout(timeoutMs),
    cache: 'no-store',
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Thinkpool ${flag} HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = assertListResponse(await res.json(), flag);

  if (data.totalCount !== data.list.length) {
    console.warn(
      `[thinkpool-lassi] ${flag} totalCount=${data.totalCount} list.length=${data.list.length} mismatch`
    );
  }

  return data;
}

/**
 * B/S 병렬 수집 후 SignalInput[] 로 변환
 *
 * 수집일과 거래일이 다른 항목은 전 거래일 신호의 복제 삽입을 막기 위해 제외합니다.
 */
export async function collectLassiSignals(
  options: FetchLassiOptions = {}
): Promise<CollectLassiResult> {
  const collectedAt = nowKstIso(options.now);
  const batchId = randomUUID();

  const [buy, sell] = await Promise.all([
    fetchLassiList('B', options),
    fetchLassiList('S', options),
  ]);

  let staleDropped = 0;
  const isFresh = (item: ThinkpoolLassiItem): boolean => {
    const fresh = isSameKstTradeDate(item.tradeDttm, collectedAt);
    if (!fresh) staleDropped += 1;
    return fresh;
  };

  const signals: SignalInput[] = [
    ...buy.list.filter(isFresh).map((item) => mapLassiItem(item, 'B', collectedAt)),
    ...sell.list.filter(isFresh).map((item) => mapLassiItem(item, 'S', collectedAt)),
  ];

  if (staleDropped > 0) {
    console.warn(
      `[thinkpool-lassi] 수집일(${collectedAt.slice(0, 10)}) 과 거래일이 다른 ${staleDropped}건을 제외했습니다`
    );
  }

  return { buy, sell, signals, collectedAt, batchId, staleDropped };
}

/** RPC / batch API 용 payload 행 */
export function toUpsertPayload(
  signals: SignalInput[],
  batchId: string,
  deviceId = 'thinkpool-api'
): Record<string, unknown>[] {
  return signals.map((s) => ({
    timestamp: s.timestamp,
    symbol: s.symbol ?? null,
    name: s.name,
    signal_type: s.signal_type,
    signal_price: s.signal_price ?? null,
    signal_time: s.signal_time ?? null,
    source: s.source,
    batch_id: batchId,
    is_fallback: s.is_fallback ?? false,
    raw_data: s.raw_data ?? null,
    device_id: deviceId,
  }));
}
