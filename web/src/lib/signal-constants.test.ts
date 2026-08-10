import { describe, it, expect } from 'vitest';
import { toActiveSignal } from './signal-constants';

describe('toActiveSignal', () => {
  it('BUY 행을 신호 형태로 변환합니다', () => {
    const row = {
      symbol: '005930',
      name: '삼성전자',
      market: 'KOSPI',
      latest_signal_date: '2026-08-10T09:30:00+09:00',
      latest_signal_type: 'BUY_FORECAST',
      latest_signal_price: 71000,
    };
    expect(toActiveSignal(row, 'buy')).toEqual({
      symbol: '005930',
      name: '삼성전자',
      market: 'KOSPI',
      signal_type: 'BUY_FORECAST',
      source: '',
      timestamp: '2026-08-10T09:30:00+09:00',
      signal_price: '71000',
      sector: '',
    });
  });

  it('SELL 행은 latest_sell_date 를 timestamp 로 씁니다', () => {
    const row = {
      symbol: '000660',
      name: 'SK하이닉스',
      market: 'KOSDAQ',
      latest_sell_date: '2026-08-09T15:00:00+09:00',
    };
    const result = toActiveSignal(row, 'sell');
    expect(result.signal_type).toBe('SELL');
    expect(result.timestamp).toBe('2026-08-09T15:00:00+09:00');
    expect(result.signal_price).toBe('');
  });

  it('name 이 비면 symbol 로, market 이 비면 기타로 대체합니다', () => {
    const row = { symbol: '123456', latest_signal_date: '2026-08-10T09:00:00+09:00' };
    const result = toActiveSignal(row, 'buy');
    expect(result.name).toBe('123456');
    expect(result.market).toBe('기타');
  });

  it('latest_signal_type 이 없는 BUY 행은 BUY 로 채웁니다', () => {
    const row = { symbol: '123456', name: '테스트', latest_signal_date: '2026-08-10T09:00:00+09:00' };
    expect(toActiveSignal(row, 'buy').signal_type).toBe('BUY');
  });

  it('latest_signal_price 가 0 이면 빈 문자열이 아니라 "0" 입니다', () => {
    const row = { symbol: '123456', latest_signal_date: '2026-08-10T09:00:00+09:00', latest_signal_price: 0 };
    expect(toActiveSignal(row, 'buy').signal_price).toBe('0');
  });
});
