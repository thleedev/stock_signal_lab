export type ActiveParams = {
  type: 'buy' | 'sell';
  offset: number;
  limit: number;
};

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

/** 쿼리스트링을 활성 신호 조회 파라미터로 정규화합니다. */
export function parseActiveParams(searchParams: URLSearchParams): ActiveParams {
  const type = searchParams.get('type') === 'sell' ? 'sell' : 'buy';

  const rawOffset = Number.parseInt(searchParams.get('offset') ?? '', 10);
  const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? rawOffset : 0;

  const rawLimit = Number.parseInt(searchParams.get('limit') ?? '', 10);
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, MAX_LIMIT) : DEFAULT_LIMIT;

  return { type, offset, limit };
}
