/**
 * API 라우트용 Cache-Control 헤더 유틸
 *
 * 사용법: return jsonWithCache(data, 300)  // 5분 캐시
 */

export function jsonWithCache(
  data: unknown,
  maxAge: number,
  options?: { status?: number; staleWhileRevalidate?: number }
) {
  const swr = options?.staleWhileRevalidate ?? Math.max(maxAge, 60);
  return Response.json(data, {
    status: options?.status ?? 200,
    headers: {
      'Cache-Control': `public, s-maxage=${maxAge}, stale-while-revalidate=${swr}`,
    },
  });
}
