// .github/scripts/batch/step7-events.ts
//
// 시장 이벤트 적재 + 시황 점수 계산을 Vercel API 에 위임한다.
// - /api/v1/cron/market-events: 한/미 공휴일, 한국 선물옵션 만기, FOMC, 폴백 경제지표 upsert
// - /api/v1/cron/market-score: risk_index / event_risk_score / combined_score 갱신
//
// 이전 구현은 res.status 를 검사하지 않고 본문 240자만 로그로 남겨,
// 401(CRON_SECRET 불일치)이나 500(타임아웃)으로 매일 실패해도 배치가
// 성공으로 마감됐습니다. market_score_history 와 market_events 는 이 경로가
// 유일한 writer 이므로 대체 복구 수단도 없습니다.
import { log } from '../shared/logger.js';

async function callCron(path: string): Promise<string | null> {
  const vercelUrl = process.env.VERCEL_URL;
  if (!vercelUrl) {
    return `step7 ${path}: VERCEL_URL 미설정으로 호출 생략`;
  }
  const secret = process.env.CRON_SECRET ?? '';
  try {
    const res = await fetch(`https://${vercelUrl}${path}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(60000),
    });
    const body = await res.text();
    log('step7', `${path} → ${res.status} ${body.slice(0, 240)}`);
    if (!res.ok) {
      return `step7 ${path}: HTTP ${res.status} ${body.slice(0, 120)}`;
    }
    return null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log('step7', `${path} 호출 오류: ${msg}`);
    return `step7 ${path}: ${msg}`;
  }
}

export async function runStep7Events(): Promise<{ errors: string[] }> {
  log('step7', '이벤트 캘린더 + 시황 점수 갱신 시작');
  const errors: string[] = [];
  for (const path of ['/api/v1/cron/market-events', '/api/v1/cron/market-score']) {
    const err = await callCron(path);
    if (err) errors.push(err);
  }
  log('step7', `완료 (오류 ${errors.length}건)`);
  return { errors };
}
