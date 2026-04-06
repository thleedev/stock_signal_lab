// .github/scripts/batch/step5-ai-report.ts
import { supabase } from '../shared/supabase.js';
import { log } from '../shared/logger.js';

export async function runStep5AiReport(opts: { date: string }): Promise<void> {
  log('step5', 'AI 리포트 생성 시작 (상위 50종목)');

  // stock_scores에서 상위 50종목 선택
  const { data: topStocks } = await supabase
    .from('stock_scores')
    .select('symbol, score_signal, score_supply, score_value, score_momentum')
    .eq('scored_at', opts.date)
    .order('score_signal', { ascending: false })
    .limit(50);

  if (!topStocks || topStocks.length === 0) {
    log('step5', '점수 데이터 없음, AI 리포트 생략');
    return;
  }

  // 기존 cron에서 하던 AI 추천 생성 로직은 OpenAI 호출을 포함
  // Vercel /api/v1/ai-recommendations/generate 엔드포인트를 HTTP로 호출
  const vercelUrl = process.env.VERCEL_URL;
  if (!vercelUrl) {
    log('step5', 'VERCEL_URL 없음, AI 리포트 생략');
    return;
  }

  const res = await fetch(`https://${vercelUrl}/api/v1/ai-recommendations/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.CRON_SECRET ?? ''}`,
    },
    body: JSON.stringify({ date: opts.date, symbols: topStocks.map(s => s.symbol) }),
  });

  log('step5', `AI 리포트 응답: ${res.status}`);
}
