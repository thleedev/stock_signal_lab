import { readFileSync } from 'fs';
const envContent = readFileSync('.env.local', 'utf-8');
for (const line of envContent.split('\n')) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) process.env[match[1].trim()] = match[2].trim();
}

import { createServiceClient } from '../src/lib/supabase';

async function main() {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('stock_cache')
    .select('symbol, name, float_shares, is_managed')
    .not('float_shares', 'is', null)
    .limit(5);

  console.log('error:', error);
  console.log('float_shares가 있는 종목:', data?.length ?? 0);
  data?.forEach(s => console.log(`  ${s.symbol} ${s.name}: float=${s.float_shares}, managed=${s.is_managed}`));

  // 전체 중 is_managed=true 확인
  const { data: mgd } = await supabase
    .from('stock_cache')
    .select('symbol, name')
    .eq('is_managed', true)
    .limit(5);
  console.log('관리종목:', mgd?.length ?? 0);
  mgd?.forEach(s => console.log(`  ${s.symbol} ${s.name}`));
}

main().catch(console.error);
