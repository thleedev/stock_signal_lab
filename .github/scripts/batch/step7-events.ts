// .github/scripts/batch/step7-events.ts
//
// 시장 이벤트 적재 + 시황 점수 계산을 Vercel API에 위임한다.
// - /api/v1/cron/market-events: 한/미 공휴일, 한국 선물옵션 만기, FOMC, 폴백 경제지표 upsert
// - /api/v1/cron/market-score: risk_index / event_risk_score / combined_score 갱신
import { log } from '../shared/logger.js';

async function callCron(path: string): Promise<void> {
  const vercelUrl = process.env.VERCEL_URL;
  if (!vercelUrl) {
    log('step7', `VERCEL_URL 없음, ${path} 생략`);
    return;
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
  } catch (err) {
    log('step7', `${path} 호출 오류: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function runStep7Events(): Promise<void> {
  log('step7', '이벤트 캘린더 + 시황 점수 갱신 시작');
  await callCron('/api/v1/cron/market-events');
  await callCron('/api/v1/cron/market-score');
  log('step7', '완료');
}
