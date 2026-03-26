/**
 * DART 재무 데이터 수집 스크립트 (신호 종목만)
 *
 * 실행: cd web && npx tsx scripts/collect-dart-info.ts
 */
import { readFileSync } from 'fs';
const env = readFileSync('.env.local', 'utf-8');
for (const l of env.split('\n')) {
  const m = l.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

import { createServiceClient } from '../src/lib/supabase';
import { fetchDartInfo } from '../src/lib/dart-api';

async function main() {
  const supabase = createServiceClient();

  // 신호 종목 중 dart_corp_code가 있는 것만
  const { data: stocks } = await supabase
    .from('stock_cache')
    .select('symbol, name, dart_corp_code')
    .gt('signal_count_30d', 0)
    .not('dart_corp_code', 'is', null);

  const targets = stocks ?? [];
  console.log(`DART 수집 대상: ${targets.length}건`);

  let success = 0;
  let failed = 0;

  // 5개씩 병렬 (API 부하 최소화)
  for (let i = 0; i < targets.length; i += 5) {
    const batch = targets.slice(i, i + 5);
    const results = await Promise.allSettled(
      batch.map(async (s: { symbol: string; name: string; dart_corp_code: string }) => {
        const info = await fetchDartInfo(s.dart_corp_code);
        return { symbol: s.symbol, name: s.name, info };
      }),
    );

    for (const r of results) {
      if (r.status === 'fulfilled') {
        const { symbol, name, info } = r.value;
        const { error } = await supabase
          .from('stock_dart_info')
          .upsert({
            symbol,
            ...info,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'symbol', ignoreDuplicates: false });

        if (error) {
          console.error(`실패 ${symbol} ${name}:`, error.message);
          failed++;
        } else {
          success++;
          // 진행 표시
          if (success % 50 === 0) {
            console.log(`진행: ${success}/${targets.length}`);
          }
        }
      } else {
        failed++;
      }
    }
  }

  console.log(`\n완료 — 성공: ${success}, 실패: ${failed}`);

  // 결과 확인
  const { data: sample } = await supabase
    .from('stock_dart_info')
    .select('*')
    .not('audit_opinion', 'is', null)
    .limit(3);

  if (sample?.length) {
    console.log('\n샘플 데이터:');
    for (const s of sample) {
      console.log(`  ${s.symbol}: audit=${s.audit_opinion}, cbw=${s.has_recent_cbw}, shareholder=${s.major_shareholder_pct}%, treasury=${s.has_treasury_buyback}, revenue_growth=${s.revenue_growth_yoy}%`);
    }
  }
}

main().catch(console.error);
