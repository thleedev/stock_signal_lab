// .github/scripts/batch/step11-lassi-signals.ts
//
// 라씨 당일 매수/매도 신호 수집을 Vercel API 에 위임합니다.
// - /api/v1/cron/lassi-signals: 씽크풀 공개 API 의 B/S 전량을 upsert_signals_bulk 로 저장
//
// 수집 시간 가드는 서버 라우트가 판정하므로 배치에는 시간 조건을 두지 않습니다.
// force=1 은 가드를 건너뛰며, 장 마감 후 full 배치에서 당일 신호를 최종 확정할 때 씁니다.
//
// 날짜 가드는 배치가 맡습니다. 씽크풀 API 는 '당일' 목록만 주고 서버는 수집 시각(KST)을
// timestamp 로 stamp 하므로, 과거 일자를 지정한 재실행에서 호출하면 지정일이 아니라
// 재실행일 자 신호가 한 벌 더 쌓입니다. UNIQUE 키가 signal_date_kst(timestamp) 라
// 원본 일자 행과 충돌하지 않아 스코어링·AI 리포트가 이중 집계합니다.
//
// index.ts 의 targetDate 는 TARGET_DATE 미지정 시 UTC 날짜라 KST 와 하루 어긋날 수 있습니다.
// 어긋나는 구간은 UTC 23:xx 크론(KST 익일 08:xx) 장전 사이클뿐이고, 그 시각은 서버 수집
// 시간대(KST 09:00~15:45) 밖이라 호출해도 skipped 로 끝납니다. 따라서 KST 오늘과 비교해
// 생략해도 잃는 수집이 없으며, 불필요한 HTTP 호출만 줄어듭니다.
import { log } from '../shared/logger.js';

/** KST(UTC+9) 기준 오늘 날짜(YYYY-MM-DD). 실행 머신 타임존에 의존하지 않습니다. */
function kstToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** /api/v1/cron/lassi-signals 응답 중 로그에 쓰는 필드 */
type LassiCronResponse = {
  ok?: boolean;
  skipped?: boolean;
  reason?: string;
  error?: string;
  upserted?: number;
  buy_count?: number;
  sell_count?: number;
};

/**
 * Step 11: 라씨 신호 수집
 * 실패해도 배치를 중단시키지 않고 errors 로만 돌려줍니다.
 * 서버가 skipped:true 를 주면 수집 시간 가드 밖이라는 뜻이므로 정상으로 처리합니다.
 *
 * @param opts.date  배치 기준일(YYYY-MM-DD). KST 오늘이 아니면 호출하지 않습니다.
 * @param opts.force 서버의 수집 시간대 가드를 건너뜁니다. 날짜 가드는 건너뛰지 않습니다.
 */
export async function runStep11LassiSignals(
  opts: { force?: boolean; date?: string } = {},
): Promise<{ errors: string[] }> {
  const errors: string[] = [];

  // 과거 일자 재실행 차단. force 보다 먼저 판정해 force=1 이 날짜 가드를 뚫지 못하게 합니다.
  const today = kstToday();
  if (opts.date && opts.date !== today) {
    log(
      'step11',
      `기준일 ${opts.date} 이 KST 오늘 ${today} 과 달라 라씨 신호 수집을 생략합니다 ` +
        '(씽크풀은 당일 목록만 제공하므로 과거 일자 재수집이 불가능합니다)',
    );
    return { errors };
  }

  const vercelUrl = process.env.VERCEL_URL;
  if (!vercelUrl) {
    log('step11', 'VERCEL_URL 없음, 라씨 신호 수집 생략');
    return { errors };
  }

  const path = `/api/v1/cron/lassi-signals${opts.force ? '?force=1' : ''}`;
  log('step11', `라씨 신호 수집 시작 force=${opts.force ? 1 : 0}`);

  try {
    const res = await fetch(`https://${vercelUrl}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.CRON_SECRET ?? ''}` },
      signal: AbortSignal.timeout(60000),
    });
    const body = await res.text();

    let parsed: LassiCronResponse | null = null;
    try {
      parsed = JSON.parse(body) as LassiCronResponse;
    } catch {
      parsed = null;
    }

    if (!parsed) {
      log('step11', `${path} → ${res.status} 응답 파싱 실패: ${body.slice(0, 240)}`);
    } else if (parsed.skipped) {
      log('step11', `${path} → ${res.status} skipped=true reason=${parsed.reason ?? '-'}`);
    } else {
      log(
        'step11',
        `${path} → ${res.status} buy_count=${parsed.buy_count ?? '-'} sell_count=${parsed.sell_count ?? '-'} upserted=${parsed.upserted ?? '-'}`,
      );
    }

    if (!res.ok) {
      errors.push(`step11: HTTP ${res.status} ${parsed?.error ?? body.slice(0, 240)}`);
    }
  } catch (e) {
    errors.push(`step11 오류: ${e instanceof Error ? e.message : String(e)}`);
  }

  log('step11', '완료');
  return { errors };
}
