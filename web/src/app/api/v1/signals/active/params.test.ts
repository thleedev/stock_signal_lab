import { describe, it, expect } from 'vitest';
import { parseActiveParams } from './params';

const parse = (qs: string) => parseActiveParams(new URLSearchParams(qs));

describe('parseActiveParams', () => {
  it('기본값은 buy, offset 0, limit 200 입니다', () => {
    expect(parse('')).toEqual({ type: 'buy', offset: 0, limit: 200 });
  });

  it('type=sell 을 인식합니다', () => {
    expect(parse('type=sell').type).toBe('sell');
  });

  it('알 수 없는 type 은 buy 로 떨어뜨립니다', () => {
    expect(parse('type=hold').type).toBe('buy');
  });

  it('limit 은 1000 을 넘지 못합니다', () => {
    expect(parse('limit=5000').limit).toBe(1000);
  });

  it('limit 이 0 이하이면 기본값 200 을 씁니다', () => {
    expect(parse('limit=0').limit).toBe(200);
    expect(parse('limit=-10').limit).toBe(200);
  });

  it('숫자가 아닌 offset 은 0 으로 처리합니다', () => {
    expect(parse('offset=abc').offset).toBe(0);
    expect(parse('offset=-5').offset).toBe(0);
  });

  it('정상 값은 그대로 통과시킵니다', () => {
    expect(parse('type=sell&offset=400&limit=200')).toEqual({
      type: 'sell', offset: 400, limit: 200,
    });
  });
});
