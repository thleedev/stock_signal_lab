import { readFileSync } from 'fs';
// .env.local 수동 로드
const envContent = readFileSync('.env.local', 'utf-8');
for (const line of envContent.split('\n')) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) process.env[match[1].trim()] = match[2].trim();
}

import { createServiceClient } from '../src/lib/supabase';
import { fetchBatchStockExtra } from '../src/lib/naver-stock-extra';

async function main() {
  const supabase = createServiceClient();

  // 신호 있는 종목만
  const { data, error } = await supabase
    .from('stock_cache')
    .select('symbol')
    .gt('signal_count_30d', 0);

  if (error) { console.error('DB 조회 실패:', error); return; }

  const symbols = (data ?? []).map((s: { symbol: string }) => s.symbol);
  console.log(`대상 종목: ${symbols.length}건`);

  const extraMap = await fetchBatchStockExtra(symbols, 10);
  console.log(`네이버 수집 완료: ${extraMap.size}건`);

  let managed = 0;
  let hasFloat = 0;
  const updates: { symbol: string; float_shares: number | null; is_managed: boolean }[] = [];
  for (const [symbol, info] of extraMap.entries()) {
    updates.push({ symbol, float_shares: info.floatShares, is_managed: info.isManaged });
    if (info.isManaged) managed++;
    if (info.floatShares) hasFloat++;
  }

  // upsert 대신 개별 update — NOT NULL 컬럼 충돌 방지
  let updateOk = 0;
  for (const u of updates) {
    const { error: uErr } = await supabase
      .from('stock_cache')
      .update({ float_shares: u.float_shares, is_managed: u.is_managed })
      .eq('symbol', u.symbol);
    if (uErr) console.error(`업데이트 오류 (${u.symbol}):`, uErr);
    else updateOk++;
  }
  console.log(`업데이트 성공: ${updateOk}건`);

  console.log(`완료 — 관리종목: ${managed}건, 유통주식수 있음: ${hasFloat}건`);
}

main().catch(console.error);
