/**
 * 2026-03-06 라씨 매수 신호 수동 삽입
 *
 * 시스템 구축 전 라씨에서 발생한 매수 종목을 signals 테이블에 삽입합니다.
 *
 * 실행: npx tsx scripts/insert-lassi-signals-20260306.ts
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
  console.error(
    "SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY가 설정되지 않았습니다."
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// 2026-03-06 라씨 매수 신호 데이터
// 시간 그룹별로 정리 (5분전, 6분전 등은 상대적 시간이므로 대략적인 시간 배정)
// 라씨 신호는 장중 발생하므로 09:00~15:30 사이로 추정
const SIGNAL_DATE = "2026-03-06";

interface RawSignal {
  name: string;
  symbol: string;
  price: number;
}

const signals: RawSignal[] = [
  // 그룹 1 (20종목)
  { name: "WON 초대형IB", symbol: "0154F0", price: 13875 },
  { name: "KODEX 주주환원", symbol: "0153K0", price: 11585 },
  { name: "RISE 코리아전략", symbol: "0151P0", price: 13350 },
  { name: "리브스메드", symbol: "491000", price: 79600 },
  { name: "TIGER 미국AI", symbol: "0142D0", price: 8860 },
  { name: "에임드바이오", symbol: "0009K0", price: 62900 },
  { name: "BNK 카카오그룹", symbol: "0120J0", price: 10330 },
  { name: "KODEX 코리아", symbol: "0115E0", price: 13130 },
  { name: "PLUS K방산레버리지", symbol: "0104G0", price: 16030 },
  { name: "1Q K소버린AI", symbol: "0103T0", price: 9780 },
  { name: "SOL 코리아고배당", symbol: "0105E0", price: 13255 },
  { name: "TIGER 코리아", symbol: "0104P0", price: 11780 },
  { name: "PLUS 자사주매입", symbol: "0098N0", price: 12935 },
  { name: "그래피", symbol: "318060", price: 48750 },
  { name: "지투지바이오", symbol: "456160", price: 91100 },
  { name: "KODEX 금융고배당", symbol: "0089D0", price: 13095 },
  { name: "도우인시스", symbol: "484120", price: 19790 },
  { name: "SOL 조선TOP3플러스", symbol: "0080Y0", price: 17255 },
  { name: "TIGER 코리아밸류", symbol: "0052D0", price: 15980 },
  { name: "원일티엔아이", symbol: "136150", price: 15870 },

  // 그룹 2 (20종목)
  { name: "아이엠에셋 200", symbol: "0007N0", price: 85775 },
  { name: "닷밀", symbol: "464580", price: 2190 },
  { name: "토모큐브", symbol: "475960", price: 60400 },
  { name: "TRUSTON 코리아", symbol: "496130", price: 21320 },
  { name: "에이럭스", symbol: "475580", price: 8990 },
  { name: "KODEX 200액티브", symbol: "494890", price: 24375 },
  { name: "HANARO 전력", symbol: "491820", price: 37430 },
  { name: "PLUS 200TR", symbol: "491220", price: 99800 },
  { name: "SOL 금융지주플러스", symbol: "484880", price: 21320 },
  { name: "HD현대마린솔루션", symbol: "443060", price: 173900 },
  { name: "KoAct 배당성장", symbol: "476850", price: 17875 },
  { name: "TRUSTON 주주환원", symbol: "472720", price: 23220 },
  { name: "와이바이오로직스", symbol: "338840", price: 23000 },
  { name: "그린리소스", symbol: "402490", price: 11850 },
  { name: "TIGER 은행고배당", symbol: "466940", price: 25525 },
  { name: "PLUS 일본반도체", symbol: "464920", price: 23160 },
  { name: "티쓰리", symbol: "204610", price: 2335 },
  { name: "FOCUS AI코리아", symbol: "448570", price: 26565 },
  { name: "제이아이테크", symbol: "417500", price: 5020 },
  { name: "이노룰스", symbol: "296640", price: 7160 },

  // 그룹 3 (20종목)
  { name: "TIME Korea플러스", symbol: "441800", price: 27560 },
  { name: "ACE 원자력TOP", symbol: "433500", price: 60855 },
  { name: "보로노이", symbol: "310210", price: 329000 },
  { name: "모아데이타", symbol: "288980", price: 659 },
  { name: "풍원정밀", symbol: "371950", price: 14770 },
  { name: "케이옥션", symbol: "102370", price: 3665 },
  { name: "아이티아이즈", symbol: "372800", price: 4230 },
  { name: "마이다스 코스닥150", symbol: "403790", price: 47185 },
  { name: "크래프톤", symbol: "259960", price: 221000 },
  { name: "HANARO Fn K리츠", symbol: "395280", price: 3805 },
  { name: "진시스템", symbol: "363250", price: 4740 },
  { name: "KODEX 자율주행", symbol: "385520", price: 14845 },
  { name: "ACE 코리아AI", symbol: "380340", price: 18425 },
  { name: "TIGER 탄소효율", symbol: "376410", price: 19885 },
  { name: "하이브", symbol: "352820", price: 346000 },
  { name: "KODEX 혁신기술", symbol: "364690", price: 31350 },
  { name: "RISE 200TR", symbol: "361580", price: 47765 },
  { name: "GRT", symbol: "900290", price: 6280 },
  { name: "글로벌에스엠", symbol: "900070", price: 532 },
  { name: "KODEX 코스피대형주", symbol: "337140", price: 29265 },

  // 그룹 4 (20종목)
  { name: "KODEX 멀티팩터", symbol: "337120", price: 28315 },
  { name: "PLUS 코스피TR", symbol: "328370", price: 31500 },
  { name: "RF머트리얼즈", symbol: "327260", price: 48900 },
  { name: "KODEX 배당가치", symbol: "325020", price: 25775 },
  { name: "HANARO K고배당", symbol: "322410", price: 22475 },
  { name: "우리금융지주", symbol: "316140", price: 33750 },
  { name: "국전약품", symbol: "307750", price: 4265 },
  { name: "HANARO KRX300", symbol: "304760", price: 38320 },
  { name: "RISE 코스피", symbol: "302450", price: 58690 },
  { name: "KODEX KRX300", symbol: "292190", price: 38855 },
  { name: "TIGER MSCI Korea", symbol: "289260", price: 20815 },
  { name: "RISE 200금융", symbol: "284980", price: 21625 },
  { name: "RISE 중소형고배당", symbol: "281990", price: 18240 },
  { name: "KODEX 고배당", symbol: "279530", price: 17600 },
  { name: "TIGER 코스피대형주", symbol: "277640", price: 30200 },
  { name: "TIGER 코스피", symbol: "277630", price: 58775 },
  { name: "KODEX 가치주", symbol: "275290", price: 24790 },
  { name: "오리온", symbol: "271560", price: 124900 },
  { name: "HD현대", symbol: "267250", price: 277500 },
  { name: "RISE 고배당", symbol: "266160", price: 29405 },

  // 그룹 5 (20종목)
  { name: "펄어비스", symbol: "263750", price: 56300 },
  { name: "덕우전자", symbol: "263600", price: 5350 },
  { name: "TIGER 우선주", symbol: "261140", price: 23570 },
  { name: "펌텍코리아", symbol: "251970", price: 47400 },
  { name: "PLUS 고배당저변동", symbol: "251590", price: 17745 },
  { name: "KODEX 밸류Plus", symbol: "244670", price: 11810 },
  { name: "KODEX KTOP30", symbol: "229720", price: 30890 },
  { name: "TIGER KTOP30", symbol: "228820", price: 15450 },
  { name: "TIGER 우량가치", symbol: "227570", price: 18935 },
  { name: "KODEX 200 중소형", symbol: "226980", price: 23230 },
  { name: "올릭스", symbol: "226950", price: 199800 },
  { name: "TIGER 이머징마켓", symbol: "225060", price: 13360 },
  { name: "KODEX 삼성그룹", symbol: "213610", price: 17075 },
  { name: "TIGER 코스피200", symbol: "210780", price: 24855 },
  { name: "NHN", symbol: "181710", price: 35300 },
  { name: "JB금융지주", symbol: "175330", price: 29675 },
  { name: "TIGER 로우볼", symbol: "174350", price: 20280 },
  { name: "선익시스템", symbol: "171090", price: 123900 },
  { name: "PLUS 고배당주", symbol: "161510", price: 26250 },
  { name: "한국타이어앤테크놀로지", symbol: "161390", price: 61600 },

  // 그룹 6 (20종목)
  { name: "KODEX 보험", symbol: "140700", price: 15785 },
  { name: "RISE 우량업종", symbol: "140580", price: 24015 },
  { name: "TIGER 경기방어", symbol: "139280", price: 13190 },
  { name: "TIGER 200 에너지", symbol: "139250", price: 17380 },
  { name: "TIGER 200 건설", symbol: "139220", price: 6895 },
  { name: "BNK금융지주", symbol: "138930", price: 18750 },
  { name: "TIGER 삼성그룹", symbol: "138520", price: 25270 },
  { name: "제이에스링크", symbol: "127120", price: 37600 },
  { name: "제노레이", symbol: "122310", price: 4045 },
  { name: "KODEX 건설", symbol: "117700", price: 6125 },
  { name: "RISE 5대그룹주", symbol: "105780", price: 13125 },
  { name: "KB금융", symbol: "105560", price: 149100 },
  { name: "엠씨넥스", symbol: "097520", price: 23900 },
  { name: "형지엘리트", symbol: "093240", price: 1087 },
  { name: "TIGER 은행", symbol: "091220", price: 15815 },
  { name: "HDC현대EP", symbol: "089470", price: 5540 },
  { name: "바이오솔루션", symbol: "086820", price: 10070 },
  { name: "하나금융지주", symbol: "086790", price: 111900 },
  { name: "미스토홀딩스", symbol: "081660", price: 48200 },
  { name: "코디", symbol: "080530", price: 899 },

  // 그룹 7 (20종목)
  { name: "동양이엔피", symbol: "079960", price: 28550 },
  { name: "인베니아", symbol: "079950", price: 1255 },
  { name: "LIG넥스원", symbol: "079550", price: 763000 },
  { name: "더본코리아", symbol: "475560", price: 21800 },
  { name: "이노와이어리스", symbol: "073490", price: 33850 },
  { name: "KIWOOM 글로벌", symbol: "489860", price: 14970 },
  { name: "KIWOOM 200", symbol: "069660", price: 84385 },
  { name: "엠아이큐브솔루션", symbol: "373170", price: 2265 },
  { name: "엔텔스", symbol: "069410", price: 4355 },
  { name: "웹젠", symbol: "069080", price: 12960 },
  { name: "트루엔", symbol: "417790", price: 7280 },
  { name: "SOOP", symbol: "067160", price: 65700 },
  { name: "RISE 삼성그룹", symbol: "448630", price: 13635 },
  { name: "LG전자", symbol: "066570", price: 116600 },
  { name: "아티스트스튜디오", symbol: "200350", price: 4055 },
  { name: "엠게임", symbol: "058630", price: 5130 },
  { name: "브레인즈컴퍼니", symbol: "099390", price: 4050 },
  { name: "신한지주", symbol: "055550", price: 93400 },
  { name: "RISE 차이나항셍", symbol: "371150", price: 7520 },
  { name: "엑사이엔씨", symbol: "054940", price: 631 },

  // 그룹 8 (20종목)
  { name: "포인트모바일", symbol: "318020", price: 3295 },
  { name: "아이앤씨", symbol: "052860", price: 3405 },
  { name: "제이알글로벌리츠", symbol: "348950", price: 1847 },
  { name: "나라엠앤디", symbol: "051490", price: 3620 },
  { name: "엠투아이", symbol: "347890", price: 5550 },
  { name: "서울반도체", symbol: "046890", price: 9990 },
  { name: "제놀루션", symbol: "225220", price: 1664 },
  { name: "성호전자", symbol: "043260", price: 30800 },
  { name: "JTC", symbol: "950170", price: 4630 },
  { name: "바텍", symbol: "043150", price: 23400 },
  { name: "이지바이오", symbol: "353810", price: 6870 },
  { name: "코미팜", symbol: "041960", price: 8520 },
  { name: "솔루스첨단소재우", symbol: "33637L", price: 3300 },
  { name: "에스엠", symbol: "041510", price: 100700 },
  { name: "원바이오젠", symbol: "307280", price: 7230 },
  { name: "오스코텍", symbol: "039200", price: 52600 },
  { name: "성도이엔지", symbol: "037350", price: 11010 },
  { name: "에어부산", symbol: "298690", price: 1760 },
  { name: "LG디스플레이", symbol: "034220", price: 11660 },
  { name: "액트로", symbol: "290740", price: 26400 },

  // 그룹 9 (20종목)
  { name: "KT&G", symbol: "033780", price: 157000 },
  { name: "매일유업", symbol: "267980", price: 37800 },
  { name: "팬오션", symbol: "028670", price: 5690 },
  { name: "KODEX 차이나", symbol: "204450", price: 2445 },
  { name: "삼성E&A", symbol: "028050", price: 33200 },
  { name: "TIGER 일본TOP", symbol: "195920", price: 31765 },
  { name: "신라에스지", symbol: "025870", price: 4665 },
  { name: "포시에스", symbol: "189690", price: 1881 },
  { name: "한국단자", symbol: "025540", price: 71600 },
  { name: "SGA솔루션즈", symbol: "184230", price: 561 },
  { name: "세원물산", symbol: "024830", price: 11990 },
  { name: "아세아시멘트", symbol: "183190", price: 11820 },
  { name: "롯데쇼핑", symbol: "023530", price: 96100 },
  { name: "서플러스글로벌", symbol: "140070", price: 1876 },
  { name: "조일알미늄", symbol: "018470", price: 1225 },
  { name: "KPX홀딩스", symbol: "092230", price: 79900 },
  { name: "한국카본", symbol: "017960", price: 38700 },
  { name: "나노캠텍", symbol: "091970", price: 490 },
  { name: "SK텔레콤", symbol: "017670", price: 77800 },
  { name: "파트론", symbol: "091700", price: 7840 },

  // 그룹 10 (20종목)
  { name: "한솔케미칼", symbol: "014680", price: 301000 },
  { name: "유비벨록스", symbol: "089850", price: 4940 },
  { name: "에스원", symbol: "012750", price: 84000 },
  { name: "KT나스미디어", symbol: "089600", price: 11970 },
  { name: "한화에어로스페이스", symbol: "012450", price: 1405000 },
  { name: "하츠", symbol: "066130", price: 4110 },
  { name: "현대모비스", symbol: "012330", price: 433500 },
  { name: "테크엘", symbol: "064520", price: 1620 },
  { name: "세보엠이씨", symbol: "011560", price: 17980 },
  { name: "한국경제TV", symbol: "039340", price: 4640 },
  { name: "형지I&C", symbol: "011080", price: 503 },
  { name: "대성미생물", symbol: "036480", price: 6400 },
  { name: "아이에스동서", symbol: "010780", price: 28100 },
  { name: "SBS", symbol: "034120", price: 16980 },
  { name: "광동제약", symbol: "009290", price: 8350 },
  { name: "무학", symbol: "033920", price: 9280 },
  { name: "대원전선", symbol: "006340", price: 5490 },
  { name: "파라텍", symbol: "033540", price: 1122 },
  { name: "LS", symbol: "006260", price: 252000 },
  { name: "로젠", symbol: "033290", price: 1978 },

  // 그룹 11 (20종목)
  { name: "NH투자증권우", symbol: "005945", price: 24450 },
  { name: "한국주강", symbol: "025890", price: 1576 },
  { name: "신영와코루", symbol: "005800", price: 16430 },
  { name: "KPX케미칼", symbol: "025000", price: 52000 },
  { name: "롯데지주", symbol: "004990", price: 31550 },
  { name: "바이오다인", symbol: "314930", price: 12250 },
  { name: "티케이지애강", symbol: "022220", price: 539 },
  { name: "삼천리", symbol: "004690", price: 136300 },
  { name: "삼목에스폼", symbol: "018310", price: 18380 },
  { name: "SG세계물산", symbol: "004060", price: 608 },
  { name: "압타바이오", symbol: "293780", price: 6860 },
  { name: "두올", symbol: "016740", price: 4245 },
  { name: "아이비젼웍스", symbol: "469750", price: 1113 },
  { name: "태광산업", symbol: "003240", price: 1206000 },
  { name: "라메디텍", symbol: "462510", price: 4610 },
  { name: "케이엠제약", symbol: "225430", price: 381 },
  { name: "HL D&I", symbol: "014790", price: 3320 },
  { name: "삼양식품", symbol: "003230", price: 1066000 },
  { name: "원익피앤이", symbol: "217820", price: 3385 },
  { name: "태경비케이", symbol: "014580", price: 4315 },

  // 그룹 12 (20종목)
  { name: "토마토시스템", symbol: "393210", price: 4355 },
  { name: "삼영무역", symbol: "002810", price: 19880 },
  { name: "노바렉스", symbol: "194700", price: 12560 },
  { name: "까뮤이앤씨", symbol: "013700", price: 1211 },
  { name: "팸텍", symbol: "271830", price: 1509 },
  { name: "넥센타이어", symbol: "002350", price: 7870 },
  { name: "현대코퍼레이션", symbol: "011760", price: 25400 },
  { name: "하이드로리튬", symbol: "101670", price: 1930 },
  { name: "트윔", symbol: "290090", price: 5920 },
  { name: "현대해상", symbol: "001450", price: 30850 },
  { name: "HANARO Fn골드", symbol: "407300", price: 11125 },
  { name: "롯데칠성우", symbol: "005305", price: 83900 },
  { name: "대창솔루션", symbol: "096350", price: 2065 },
  { name: "JW중외제약", symbol: "001060", price: 32800 },
  { name: "비투엔", symbol: "307870", price: 746 },
  { name: "한컴위드", symbol: "054920", price: 4445 },
  { name: "사조대림", symbol: "003960", price: 34200 },
  { name: "삼성화재우", symbol: "000815", price: 390000 },
  { name: "파루", symbol: "043200", price: 830 },
  { name: "에이스침대", symbol: "003800", price: 34300 },

  // 그룹 13 (6종목)
  { name: "광진실업", symbol: "026910", price: 1969 },
  { name: "현대건설", symbol: "000720", price: 142600 },
  { name: "오리엔탈정공", symbol: "014940", price: 6950 },
  { name: "넥센타이어1우", symbol: "002355", price: 4260 },
  { name: "신풍제약우", symbol: "019175", price: 16940 },
  { name: "CJ대한통운", symbol: "000120", price: 0 }, // 가격 정보 없음
];

async function main() {
  console.log("=== 2026-03-06 라씨 매수 신호 삽입 시작 ===\n");
  console.log(`총 ${signals.length}개 종목\n`);

  const batchId = randomUUID();
  // 장중 시간대로 분산 배치 (09:30 ~ 15:00)
  const baseTime = new Date(`${SIGNAL_DATE}T09:30:00+09:00`);

  const BATCH_SIZE = 50;
  let insertedCount = 0;

  for (let i = 0; i < signals.length; i += BATCH_SIZE) {
    const batch = signals.slice(i, i + BATCH_SIZE).map((s, idx) => {
      const offset = (i + idx) * 2; // 2분 간격
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
          import_note: "2026-03-06 라씨 매수 신호 수동 입력 (시스템 구축 전)",
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
      insertedCount += (data?.length || 0);
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
