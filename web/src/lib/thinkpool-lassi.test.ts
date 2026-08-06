import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';
import {
  collectLassiSignals,
  isLassiCollectionWindow,
  isSameKstTradeDate,
  mapLassiItem,
  parseTradeDttm,
  nowKstIso,
  toUpsertPayload,
  type ThinkpoolLassiListResponse,
} from './thinkpool-lassi';

const docsDir = path.resolve(__dirname, '../../../docs');

function loadFixture(name: string): ThinkpoolLassiListResponse {
  const raw = readFileSync(path.join(docsDir, name), 'utf-8');
  return JSON.parse(raw) as ThinkpoolLassiListResponse;
}

describe('parseTradeDttm', () => {
  it('YYYYMMDDHHmmss 를 KST ISO 로 변환한다', () => {
    expect(parseTradeDttm('20260803150000')).toBe('2026-08-03T15:00:00+09:00');
    expect(parseTradeDttm('20260803092000')).toBe('2026-08-03T09:20:00+09:00');
  });

  it('잘못된 형식이면 에러', () => {
    expect(() => parseTradeDttm('2026-08-03')).toThrow(/Invalid tradeDttm/);
  });
});

describe('nowKstIso', () => {
  it('+09:00 오프셋을 붙인다', () => {
    expect(nowKstIso()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/);
  });
});

describe('isLassiCollectionWindow', () => {
  // 실행 머신 로컬 타임존에 의존하지 않도록 Date 는 UTC 리터럴(`Z`)로만 만든다.
  // UTC + 9시간 = KST 이며 2026-08-06 은 목요일, 08-08 은 토요일, 08-09 는 일요일이다.

  it('평일 09:00 직전은 false', () => {
    // KST 2026-08-06(목) 08:59:59
    expect(isLassiCollectionWindow(new Date('2026-08-05T23:59:59Z'))).toBe(false);
  });

  it('평일 09:00:00 경계는 true', () => {
    // KST 2026-08-06(목) 09:00:00
    expect(isLassiCollectionWindow(new Date('2026-08-06T00:00:00Z'))).toBe(true);
  });

  it('평일 장중은 true', () => {
    // KST 2026-08-06(목) 12:00:00
    expect(isLassiCollectionWindow(new Date('2026-08-06T03:00:00Z'))).toBe(true);
  });

  it('평일 15:45:00 경계는 true', () => {
    // KST 2026-08-06(목) 15:45:00
    expect(isLassiCollectionWindow(new Date('2026-08-06T06:45:00Z'))).toBe(true);
  });

  it('평일 15:45:01 은 false', () => {
    // KST 2026-08-06(목) 15:45:01
    expect(isLassiCollectionWindow(new Date('2026-08-06T06:45:01Z'))).toBe(false);
  });

  it('평일 16:10 은 false', () => {
    // KST 2026-08-06(목) 16:10:00 — full 배치 시점이라 force=1 로만 수집한다.
    expect(isLassiCollectionWindow(new Date('2026-08-06T07:10:00Z'))).toBe(false);
  });

  it('토요일 장중 시각도 false', () => {
    // KST 2026-08-08(토) 12:00:00
    expect(isLassiCollectionWindow(new Date('2026-08-08T03:00:00Z'))).toBe(false);
  });

  it('일요일 장중 시각도 false', () => {
    // KST 2026-08-09(일) 12:00:00
    expect(isLassiCollectionWindow(new Date('2026-08-09T03:00:00Z'))).toBe(false);
  });
});

describe('isSameKstTradeDate', () => {
  it('거래일과 수집일이 같으면 true', () => {
    expect(isSameKstTradeDate('20260803150000', '2026-08-03T16:00:00+09:00')).toBe(true);
  });

  it('수집일 자정 직후여도 날짜만 같으면 true', () => {
    expect(isSameKstTradeDate('20260803090500', '2026-08-03T00:00:01+09:00')).toBe(true);
  });

  it('직전 거래일 신호는 false — 휴장일 복제 삽입을 막는다', () => {
    expect(isSameKstTradeDate('20260803150000', '2026-08-06T09:15:00+09:00')).toBe(false);
  });

  it('형식이 깨진 tradeDttm 은 false', () => {
    expect(isSameKstTradeDate('2026-08-03', '2026-08-03T16:00:00+09:00')).toBe(false);
    expect(isSameKstTradeDate('', '2026-08-03T16:00:00+09:00')).toBe(false);
  });
});

describe('mapLassiItem (실측 fixture)', () => {
  const buy = loadFixture('B_signalTodayBuySellList.json');
  const sell = loadFixture('S_signalTodayBuySellList.json');

  it('B fixture totalCount 와 list 길이가 일치한다', () => {
    expect(buy.totalCount).toBe(buy.list.length);
    expect(buy.totalCount).toBeGreaterThan(0);
  });

  it('S fixture totalCount 와 list 길이가 일치한다', () => {
    expect(sell.totalCount).toBe(sell.list.length);
    expect(sell.totalCount).toBeGreaterThan(0);
  });

  it('매수 항목을 SignalInput 으로 매핑한다', () => {
    const item = buy.list[0];
    const s = mapLassiItem(item, 'B', '2026-08-03T16:00:00+09:00');
    expect(s.source).toBe('lassi');
    expect(s.signal_type).toBe('BUY');
    expect(s.symbol).toBe(item.stockCode);
    expect(s.name).toBe(item.stockName);
    expect(s.signal_price).toBe(Math.round(item.tradePrice));
    expect(s.signal_time).toBe(parseTradeDttm(item.tradeDttm));
    expect(s.is_fallback).toBe(false);
    expect(s.raw_data?.provider).toBe('thinkpool');
    expect(s.raw_data?.tradeFlag).toBe('B');
  });

  it('매도 항목을 SignalInput 으로 매핑한다', () => {
    const item = sell.list[0];
    const s = mapLassiItem(item, 'S', '2026-08-03T16:00:00+09:00');
    expect(s.signal_type).toBe('SELL');
    expect(s.symbol).toBe(item.stockCode);
    expect(s.signal_time).toBe(parseTradeDttm(item.tradeDttm));
  });

  it('전량 매핑 후 심볼·타입이 유효하다', () => {
    const collectedAt = '2026-08-03T16:00:00+09:00';
    const signals = [
      ...buy.list.map((i) => mapLassiItem(i, 'B', collectedAt)),
      ...sell.list.map((i) => mapLassiItem(i, 'S', collectedAt)),
    ];
    expect(signals).toHaveLength(buy.list.length + sell.list.length);
    for (const s of signals) {
      // Thinkpool 이 간헐적으로 비숫자 코드를 줄 수 있음 (예: 0144M0) — 그대로 보존
      expect(s.symbol).toMatch(/^[0-9A-Za-z]{6}$/);
      expect(['BUY', 'SELL']).toContain(s.signal_type);
      expect(s.signal_time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(s.signal_price == null || Number.isInteger(s.signal_price)).toBe(true);
    }
  });
});

describe('toUpsertPayload', () => {
  it('RPC 행에 batch_id·device_id 를 붙인다', () => {
    const item = loadFixture('S_signalTodayBuySellList.json').list[0];
    const signal = mapLassiItem(item, 'S', '2026-08-03T16:00:00+09:00');
    const rows = toUpsertPayload([signal], '00000000-0000-4000-8000-000000000001');
    expect(rows).toHaveLength(1);
    expect(rows[0].batch_id).toBe('00000000-0000-4000-8000-000000000001');
    expect(rows[0].device_id).toBe('thinkpool-api');
    expect(rows[0].source).toBe('lassi');
    expect(rows[0].signal_type).toBe('SELL');
  });
});

describe('collectLassiSignals', () => {
  // fixture 의 tradeDttm 은 모두 20260803 이므로 수집 시각을 KST 2026-08-03 으로 고정한다.
  // Date 는 로컬 타임존에 의존하지 않도록 UTC 리터럴(`Z`)로만 만든다. UTC + 9시간 = KST.
  const fixtureNow = new Date('2026-08-03T01:00:00Z'); // KST 2026-08-03 10:00

  it('B/S 를 병렬 fetch 해 합친다', async () => {
    const buy = loadFixture('B_signalTodayBuySellList.json');
    const sell = loadFixture('S_signalTodayBuySellList.json');

    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.includes('/B/') ? buy : sell;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const result = await collectLassiSignals({ fetchImpl, now: fixtureNow });
    expect(result.staleDropped).toBe(0);
    expect(result.buy.totalCount).toBe(buy.totalCount);
    expect(result.sell.totalCount).toBe(sell.totalCount);
    expect(result.signals).toHaveLength(buy.list.length + sell.list.length);
    expect(result.batchId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('수집일과 거래일이 다르면 전량 제외하고 staleDropped 로 센다', async () => {
    // 공휴일에 force=1 로 돌면 씽크풀이 직전 거래일 목록을 그대로 반환할 수 있다.
    const buy = loadFixture('B_signalTodayBuySellList.json');
    const sell = loadFixture('S_signalTodayBuySellList.json');

    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.includes('/B/') ? buy : sell;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    // KST 2026-08-06 10:00 — fixture 거래일(2026-08-03) 과 다르다.
    const result = await collectLassiSignals({
      fetchImpl,
      now: new Date('2026-08-06T01:00:00Z'),
    });

    expect(result.signals).toHaveLength(0);
    expect(result.staleDropped).toBe(buy.list.length + sell.list.length);
    // 원본 응답은 그대로 보존해 라우트가 요약에 실을 수 있게 한다.
    expect(result.buy.totalCount).toBe(buy.totalCount);
    expect(result.sell.totalCount).toBe(sell.totalCount);
  });

  it('거래일이 섞이면 수집일과 같은 건만 남긴다', async () => {
    const buy = loadFixture('B_signalTodayBuySellList.json');
    const mixed: ThinkpoolLassiListResponse = {
      totalCount: 2,
      list: [
        { ...buy.list[0], tradeDttm: '20260803150000' },
        { ...buy.list[1], tradeDttm: '20260806093000' },
      ],
    };

    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const body = String(input).includes('/B/') ? mixed : { totalCount: 0, list: [] };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    // KST 2026-08-06 10:00
    const result = await collectLassiSignals({
      fetchImpl,
      now: new Date('2026-08-06T01:00:00Z'),
    });

    expect(result.signals).toHaveLength(1);
    expect(result.signals[0].signal_time).toBe('2026-08-06T09:30:00+09:00');
    expect(result.staleDropped).toBe(1);
  });

  it('HTTP 오류 시 예외를 던진다', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 503 })) as unknown as typeof fetch;
    await expect(collectLassiSignals({ fetchImpl })).rejects.toThrow(/HTTP 503/);
  });
});
