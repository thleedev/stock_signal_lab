/**
 * 2026-03-09 라씨 매수 신호 수동 삽입
 *
 * 실행: npx tsx scripts/insert-lassi-signals-20260309.ts
 */

import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";

// .env.local 수동 파싱
const envPath = path.resolve(__dirname, "../web/.env.local");
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY가 설정되지 않았습니다.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const SIGNAL_DATE = "2026-03-09";

interface RawSignal {
  name: string;
  symbol: string;
  price: number;
}

// 중복 제거된 종목 리스트 (72종목)
const signals: RawSignal[] = [
  { name: "하이록코리아", symbol: "013030", price: 35350 },
  { name: "삼화전기", symbol: "009470", price: 40050 },
  { name: "경인양행", symbol: "012610", price: 4055 },
  { name: "삼성전기", symbol: "009150", price: 398500 },
  { name: "뉴인텍", symbol: "012340", price: 529 },
  { name: "모헨즈", symbol: "006920", price: 5960 },
  { name: "DB", symbol: "012030", price: 1801 },
  { name: "삼성SDI우", symbol: "006405", price: 230000 },
  { name: "서한", symbol: "011370", price: 1036 },
  { name: "NH투자증권", symbol: "005940", price: 31350 },
  { name: "KBI동양철관", symbol: "008970", price: 1666 },
  { name: "에스엘", symbol: "005850", price: 63300 },
  { name: "아남전자", symbol: "008700", price: 1161 },
  { name: "현대지에프홀딩스", symbol: "005440", price: 14070 },
  { name: "에스엠코어", symbol: "007820", price: 5200 },
  { name: "동진쎄미켐", symbol: "005290", price: 52400 },
  { name: "소노스퀘어", symbol: "007720", price: 519 },
  { name: "현대제철", symbol: "004020", price: 37100 },
  { name: "피제이전자", symbol: "006140", price: 6800 },
  { name: "삼영", symbol: "003720", price: 7350 },
  { name: "삼영전자", symbol: "005680", price: 11850 },
  { name: "코리안리", symbol: "003690", price: 12830 },
  { name: "한신공영", symbol: "004960", price: 12730 },
  { name: "대신증권우", symbol: "003545", price: 25350 },
  { name: "조광페인트", symbol: "004910", price: 4685 },
  { name: "대신증권", symbol: "003540", price: 38750 },
  { name: "팜젠사이언스", symbol: "004720", price: 3655 },
  { name: "한화투자증권", symbol: "003530", price: 7150 },
  { name: "조광피혁", symbol: "004700", price: 61800 },
  { name: "유안타증권", symbol: "003470", price: 4865 },
  { name: "대신증권2우B", symbol: "003547", price: 24400 },
  { name: "KCC", symbol: "002380", price: 507000 },
  { name: "유안타증권우", symbol: "003475", price: 4420 },
  { name: "고려제강", symbol: "002240", price: 20750 },
  { name: "대원제약", symbol: "003220", price: 10210 },
  { name: "삼화콘덴서", symbol: "001820", price: 47950 },
  { name: "TYM", symbol: "002900", price: 6820 },
  { name: "신영증권", symbol: "001720", price: 185600 },
  { name: "아세아제지", symbol: "002310", price: 9250 },
  { name: "케이비아이동국실업", symbol: "001620", price: 720 },
  { name: "한양증권", symbol: "001750", price: 23750 },
  { name: "SK증권", symbol: "001510", price: 1784 },
  { name: "태원물산", symbol: "001420", price: 2810 },
  { name: "상상인증권", symbol: "001290", price: 1253 },
  { name: "PKC", symbol: "001340", price: 6820 },
  { name: "부국증권", symbol: "001270", price: 75700 },
  { name: "유진투자증권", symbol: "001200", price: 4775 },
  { name: "영풍", symbol: "000670", price: 53100 },
  { name: "대한방직", symbol: "001070", price: 6700 },
  { name: "하나36호스팩", symbol: "0101C0", price: 2010 },
  { name: "가온전선", symbol: "000500", price: 95200 },
  { name: "강남제비스코", symbol: "000860", price: 14930 },
  { name: "LS네트웍스", symbol: "000680", price: 3085 },
  { name: "삼화페인트", symbol: "000390", price: 9980 },
  { name: "이노인스트루먼트", symbol: "215790", price: 309 },
  { name: "흥국화재", symbol: "000540", price: 4635 },
  { name: "한화손해보험", symbol: "000370", price: 7030 },
  { name: "두산2우B", symbol: "000157", price: 460500 },
  { name: "기아", symbol: "000270", price: 160800 },
  { name: "유니켐", symbol: "011330", price: 664 },
  { name: "대구백화점", symbol: "006370", price: 4660 },
  { name: "삼천당제약", symbol: "000250", price: 791000 },
  { name: "경방", symbol: "000050", price: 8920 },
  // 21분전 그룹
  { name: "모티브링크", symbol: "463480", price: 7060 },
  { name: "바이젠셀", symbol: "308080", price: 5660 },
  { name: "뉴보텍", symbol: "060260", price: 1020 },
  // 41분전 그룹
  { name: "싸이닉솔루션", symbol: "234030", price: 7360 },
  { name: "달바글로벌", symbol: "483650", price: 149800 },
];

async function main() {
  console.log(`=== ${SIGNAL_DATE} 라씨 매수 신호 삽입 시작 ===\n`);
  console.log(`총 ${signals.length}개 종목 (중복 제거 완료)\n`);

  const batchId = randomUUID();
  const baseTime = new Date(`${SIGNAL_DATE}T09:30:00+09:00`);

  const BATCH_SIZE = 50;
  let insertedCount = 0;

  for (let i = 0; i < signals.length; i += BATCH_SIZE) {
    const batch = signals.slice(i, i + BATCH_SIZE).map((s, idx) => {
      const offset = (i + idx) * 2;
      const ts = new Date(baseTime.getTime() + offset * 60 * 1000);

      return {
        timestamp: ts.toISOString(),
        symbol: s.symbol,
        name: s.name,
        signal_type: "BUY",
        source: "lassi",
        batch_id: batchId,
        is_fallback: false,
        device_id: "manual-import",
        raw_data: {
          signal_price: s.price > 0 ? s.price : null,
          import_note: `${SIGNAL_DATE} 라씨 매수 신호 수동 입력 (시스템 구축 전)`,
          original_date: SIGNAL_DATE,
        },
      };
    });

    const { data, error } = await supabase
      .from("signals")
      .upsert(batch, { onConflict: "symbol,source" })
      .select("id");

    if (error) {
      console.error(`배치 ${i} 삽입 오류:`, error.message);
    } else {
      insertedCount += data?.length || 0;
      console.log(
        `배치 ${Math.floor(i / BATCH_SIZE) + 1}: ${data?.length || 0}건 삽입`
      );
    }
  }

  console.log(`\n=== 완료: ${insertedCount}/${signals.length}건 삽입 ===`);
  console.log(`batch_id: ${batchId}`);
}

main().catch((e) => {
  console.error("오류 발생:", e);
  process.exit(1);
});
