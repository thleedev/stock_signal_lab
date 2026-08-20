// .github/scripts/shared/notify.ts
//
// 배치 실패 알림.
//
// 저장소에 알림 발신 코드가 전혀 없어, 파이프라인이 죽어도 GitHub Actions 는
// 초록이고 batch_runs 는 done 이었습니다. keepalive.yml 주석이 알림 부재로
// 배치 중단을 나흘 뒤에 발견한 이력을 기록해 두고 있습니다.
//
// TELEGRAM_BOT_TOKEN 과 TELEGRAM_CHAT_ID 가 없으면 조용히 건너뜁니다.
// 알림 실패가 배치를 중단시켜서는 안 됩니다 — 이 함수는 절대 throw 하지 않습니다.

export async function notifyBatchFailure(mode: string, errors: string[]): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.log('[notify] TELEGRAM 설정 없음, 알림 생략');
    return;
  }

  const head = `배치 실패 (mode=${mode}) — 오류 ${errors.length}건`;
  const body = errors.slice(0, 15).join('\n');
  const more = errors.length > 15 ? `\n… 외 ${errors.length - 15}건` : '';
  const text = `${head}\n\n${body}${more}`;

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      console.error(`[notify] 텔레그램 발신 실패 HTTP ${res.status}`);
    }
  } catch (err) {
    console.error(`[notify] 텔레그램 발신 오류: ${err instanceof Error ? err.message : String(err)}`);
  }
}
