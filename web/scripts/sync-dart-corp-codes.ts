/**
 * DART corp_code ↔ 종목코드 매핑 스크립트
 *
 * DART OpenAPI에서 corpCode.xml (ZIP)을 다운로드하여
 * stock_cache.dart_corp_code 컬럼에 매핑합니다.
 *
 * 실행: cd web && npx tsx scripts/sync-dart-corp-codes.ts
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

// .env.local 로드
const envContent = readFileSync('.env.local', 'utf-8');
for (const line of envContent.split('\n')) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) process.env[match[1].trim()] = match[2].trim();
}

import { createServiceClient } from '../src/lib/supabase';

interface CorpInfo {
  corp_code: string;
  corp_name: string;
  stock_code: string; // 6자리 종목코드 (없으면 빈 문자열)
}

async function downloadCorpCodes(): Promise<CorpInfo[]> {
  const apiKey = process.env.DART_API_KEY;
  if (!apiKey) throw new Error('DART_API_KEY 환경변수가 없습니다');

  console.log('DART corpCode.xml 다운로드 중...');
  const url = `https://opendart.fss.or.kr/api/corpCode.xml?crtfc_key=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`DART API 오류: ${res.status}`);

  // ZIP 파일을 임시 디렉토리에 저장
  const tmpDir = mkdtempSync('/tmp/dart-');
  const zipPath = join(tmpDir, 'corpCode.zip');
  const buffer = Buffer.from(await res.arrayBuffer());
  writeFileSync(zipPath, buffer);

  // unzip
  execSync(`unzip -o "${zipPath}" -d "${tmpDir}"`, { stdio: 'pipe' });

  // XML 파싱
  const xmlPath = join(tmpDir, 'CORPCODE.xml');
  const xml = readFileSync(xmlPath, 'utf-8');

  // 정규식으로 파싱 (외부 라이브러리 없이)
  const corps: CorpInfo[] = [];
  const regex = /<list>\s*<corp_code>(\d+)<\/corp_code>\s*<corp_name>([^<]*)<\/corp_name>\s*<corp_eng_name>[^<]*<\/corp_eng_name>\s*<stock_code>([^<]*)<\/stock_code>/g;
  let match;
  while ((match = regex.exec(xml)) !== null) {
    const stockCode = match[3].trim();
    if (stockCode && stockCode !== ' ') {
      corps.push({
        corp_code: match[1],
        corp_name: match[2],
        stock_code: stockCode,
      });
    }
  }

  // 정리
  rmSync(tmpDir, { recursive: true, force: true });

  console.log(`파싱 완료: ${corps.length}개 상장기업`);
  return corps;
}

async function main() {
  const corps = await downloadCorpCodes();
  const supabase = createServiceClient();

  // stock_cache의 symbol 목록 조회
  const allSymbols = new Set<string>();
  let from = 0;
  while (true) {
    const { data } = await supabase
      .from('stock_cache')
      .select('symbol')
      .range(from, from + 999);
    if (!data?.length) break;
    data.forEach((r: { symbol: string }) => allSymbols.add(r.symbol));
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log(`stock_cache 종목 수: ${allSymbols.size}`);

  // 매핑
  let matched = 0;
  let updated = 0;
  for (const corp of corps) {
    if (allSymbols.has(corp.stock_code)) {
      matched++;
      const { error } = await supabase
        .from('stock_cache')
        .update({ dart_corp_code: corp.corp_code })
        .eq('symbol', corp.stock_code);
      if (!error) updated++;
      else console.error(`업데이트 실패 (${corp.stock_code}):`, error.message);
    }
  }

  console.log(`매핑 완료: ${matched}개 매치, ${updated}개 업데이트`);
}

main().catch(console.error);
