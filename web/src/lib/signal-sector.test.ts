import { describe, it, expect } from 'vitest';
import { mergeSectors } from './signal-sector';

const sig = (symbol: string, sector = '') => ({ symbol, sector });

describe('mergeSectors', () => {
  it('심볼에 맞는 업종을 채웁니다', () => {
    const result = mergeSectors([sig('005930'), sig('000660')], { '005930': '반도체와반도체장비' });
    expect(result[0].sector).toBe('반도체와반도체장비');
  });

  it('업종을 못 찾은 종목은 기타로 둡니다', () => {
    const result = mergeSectors([sig('123456')], {});
    expect(result[0].sector).toBe('기타');
  });

  it('이미 값이 있으면 덮어쓰지 않습니다', () => {
    const result = mergeSectors([sig('005930', '기존업종')], { '005930': '새업종' });
    expect(result[0].sector).toBe('기존업종');
  });

  it('원본 배열을 변경하지 않습니다', () => {
    const input = [sig('005930')];
    mergeSectors(input, { '005930': '반도체와반도체장비' });
    expect(input[0].sector).toBe('');
  });

  it('나머지 필드를 보존합니다', () => {
    const input = [{ symbol: '005930', sector: '', name: '삼성전자', signal_type: 'BUY' }];
    const result = mergeSectors(input, { '005930': '반도체와반도체장비' });
    expect(result[0]).toEqual({
      symbol: '005930',
      sector: '반도체와반도체장비',
      name: '삼성전자',
      signal_type: 'BUY',
    });
  });

  it('빈 목록은 빈 배열을 돌려줍니다', () => {
    expect(mergeSectors([], { '005930': '반도체' })).toEqual([]);
  });

  it('sector 값이 빈 문자열인 매핑은 기타로 처리합니다', () => {
    const result = mergeSectors([sig('005930')], { '005930': '' });
    expect(result[0].sector).toBe('기타');
  });
});
