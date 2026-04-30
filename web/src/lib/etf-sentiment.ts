// web/src/lib/etf-sentiment.ts

// ─── ETF 브랜드 키워드 ───
const ETF_BRANDS = [
  'KODEX', 'TIGER', 'KBSTAR', 'ARIRANG', 'SOL',
  'HANARO', 'ACE', 'KOSEF', 'PLUS',
] as const;

export type EtfType = 'leverage' | 'inverse' | 'normal';
export type EtfSide = 'bull' | 'bear';
export type SentimentLabel =
  | 'strong_positive' | 'positive' | 'caution'
  | 'negative' | 'strong_negative' | 'neutral';

export interface ClassifiedEtf {
  name: string;
  symbol: string | null;
  brand: string;
  type: EtfType;
  typeWeight: number;
  side: EtfSide;
  sector: string;
  held: boolean;
  marketCap: number | null;
  lastSignalDate: string;
  lastSignalType: string;
}

export interface SectorSentiment {
  label: string;
  bullScore: number;
  bearScore: number;
  netSentiment: number;
  sentiment: SentimentLabel;
  hasActivePositions: boolean;
  etfs: EtfSignalInfo[];
}

export interface EtfSignalInfo {
  name: string;
  symbol: string | null;
  type: EtfType;
  weight: number;
  finalWeight: number;
  side: EtfSide;
  held: boolean;
  marketCap: number | null;
  lastSignalDate: string;
  lastSignalType: string;
}

export interface EtfSentimentResult {
  sectors: Record<string, SectorSentiment>;
  overallSentiment: number;
  overallLabel: SentimentLabel;
}

export type EtfOverrideEntry = {
  sector?: string;
  side?: EtfSide;
  excluded?: boolean;
};

export interface EtfOverrides {
  [etfName: string]: EtfOverrideEntry | Record<string, string> | undefined;
  __sectorRenames?: Record<string, string>;
}

/** 종목명이 ETF인지 판별 */
export function isEtf(name: string): boolean {
  return ETF_BRANDS.some((b) => name.includes(b));
}

/** ETF 유형 감지 */
export function classifyEtfType(name: string): { type: EtfType; side: EtfSide; typeWeight: number } {
  const hasInverse = /인버스|곰/.test(name);
  const hasLeverage = /레버리지|2X/i.test(name);
  if (hasInverse) return { type: 'inverse', side: 'bear', typeWeight: 2 };
  if (hasLeverage) return { type: 'leverage', side: 'bull', typeWeight: 2 };
  return { type: 'normal', side: 'bull', typeWeight: 1 };
}

/** 섹터 추출: 브랜드 + 유형 키워드 제거 후 남는 부분 */
export function extractSector(name: string): string {
  let sector = name;
  for (const brand of ETF_BRANDS) {
    sector = sector.replace(brand, '');
  }
  sector = sector
    .replace(/인버스2X/gi, '')
    .replace(/인버스/g, '')
    .replace(/레버리지/g, '')
    .replace(/2X/gi, '')
    .replace(/곰/g, '')
    .replace(/…/g, '')
    .trim();

  // 시장 대표 지수
  if (!sector || sector === '200' || /^200/.test(sector)) return 'KOSPI';
  if (/코스닥|^150/.test(sector)) return 'KOSDAQ';
  if (/코스피/.test(sector)) return 'KOSPI';

  // 섹터 병합 규칙: 키워드 매칭으로 상위 그룹화
  return normalizeSector(sector);
}

/** 유사 섹터를 상위 그룹으로 병합 */
const SECTOR_MERGE_RULES: [RegExp, string][] = [
  // 방산/우주/조선
  [/방산|국방|디펜스|무기/, '방산'],
  [/우주|항공/, '우주항공'],
  [/조선|해운/, '조선'],
  // 반도체/메모리/HBM
  [/HBM|메모리|D램|디램/i, '반도체'],
  [/반도체|필라델피아|소부장|시스템반도체/, '반도체'],
  // AI/IT/소프트웨어/플랫폼
  [/AI|인공지능|머신러닝|로봇|로보틱스/, 'AI'],
  [/소프트웨어|SW|클라우드|SaaS/i, 'IT/테크'],
  [/IT|인터넷|메타버|테크|플랫폼|콘텐츠|게임|엔터/, 'IT/테크'],
  // 2차전지/에너지
  [/2차전지|전고체|배터리|이차전지|리튬/, '2차전지'],
  [/원자력|원자|SMR|풍력|수소|LNG|에너지/, '원자력/에너지'],
  [/탄소|기후|친환경|ESG|태양광|클린/, 'ESG/친환경'],
  // 자동차/모빌리티
  [/자동차|모빌리티|EV|전기차|자율주행/i, '자동차'],
  // 바이오/헬스
  [/바이오|헬스|제약|의료|의약/, '바이오/헬스'],
  // 해외
  [/미국|나스닥|NASDAQ|S&P|필라|러셀|다우/i, '미국'],
  [/차이나|중국|중화|항셍|상해/, '중국'],
  [/일본|JAPAN|TOPIX|닛케이/i, '일본'],
  [/인도|인도네|베트남/, '신흥아시아'],
  [/유럽|독일|프랑스|영국/, '유럽'],
  [/글로벌|선진국|월드/, '글로벌'],
  // 금융/부동산/은행/보험
  [/은행|뱅크/, '은행'],
  [/보험/, '보험'],
  [/증권|금융|핀테크/, '금융'],
  [/리츠|REITs?|부동산/i, '부동산'],
  // 기업그룹
  [/삼성/, '삼성그룹'],
  [/LG/, 'LG그룹'],
  [/한화/, '한화그룹'],
  [/현대|기아/, '현대차그룹'],
  [/SK\b|에스케이/, 'SK그룹'],
  // 소비재/식품/유통
  [/식품|음식료|주류|음료/, '소비재/식품'],
  [/유통|백화점|편의점|이커머스/, '소비/유통'],
  [/화장품|뷰티|미용/, '화장품'],
  // 운송/물류
  [/운송|물류|항만/, '운송/물류'],
  // 통신/미디어
  [/통신|5G|미디어|방송/i, '통신/미디어'],
  // 코리아 테마
  [/Top\s*10|TOP10|대형/i, '대형주'],
  [/배당|고배당|월배당/, '배당'],
  [/중소형|중형|소형/, '중소형주'],
  [/코리아|Korea/i, '코리아'],
  // 원유/원자재/귀금속
  [/WTI|원유|오일|Oil/i, '원유'],
  [/금|Gold|구리|니켈|리튬|광물|희토|원자재|Commodity/i, '원자재'],
  [/은\b|Silver|백금|팔라듐/i, '귀금속'],
];

function normalizeSector(sector: string): string {
  for (const [pattern, group] of SECTOR_MERGE_RULES) {
    if (pattern.test(sector)) return group;
  }
  return sector;
}

// ─── 시가총액 비율 정규화 ───

interface RatioInput {
  name: string;
  marketCap: number | null;
}

export function calculateRatios(etfs: RatioInput[]): Map<string, number> {
  const result = new Map<string, number>();
  if (etfs.length === 0) return result;
  const withCap = etfs.filter((e) => e.marketCap != null && e.marketCap > 0);
  const withoutCap = etfs.filter((e) => e.marketCap == null || e.marketCap <= 0);
  if (withCap.length === 0) {
    const ratio = 1.0 / etfs.length;
    for (const e of etfs) result.set(e.name, ratio);
    return result;
  }
  const unknownRatio = 0.1;
  const totalUnknownRatio = unknownRatio * withoutCap.length;
  const ratioPool = 1.0 - totalUnknownRatio;
  if (ratioPool <= 0) {
    const ratio = 1.0 / etfs.length;
    for (const e of etfs) result.set(e.name, ratio);
    return result;
  }
  for (const e of withoutCap) result.set(e.name, unknownRatio);
  const totalCap = withCap.reduce((sum, e) => sum + (e.marketCap ?? 0), 0);
  for (const e of withCap) {
    result.set(e.name, ratioPool * ((e.marketCap ?? 0) / totalCap));
  }
  return result;
}

// ─── 센티먼트 계산 ───

function getSentimentLabel(net: number, hasActive: boolean): SentimentLabel {
  if (!hasActive) return 'neutral';
  if (net >= 1.0) return 'strong_positive';
  if (net > 0) return 'positive';
  if (net <= -1.0) return 'strong_negative';
  if (net < 0) return 'negative';
  return 'caution';
}

export function getOverallSentimentLabel(value: number, hasAnySector: boolean): SentimentLabel {
  if (!hasAnySector) return 'neutral';
  return getSentimentLabel(value, true);
}

export function calculateSectorSentiments(etfs: ClassifiedEtf[]): EtfSentimentResult {
  const sectorMap = new Map<string, ClassifiedEtf[]>();
  for (const etf of etfs) {
    const list = sectorMap.get(etf.sector) ?? [];
    list.push(etf);
    sectorMap.set(etf.sector, list);
  }
  const sectors: Record<string, SectorSentiment> = {};
  for (const [sector, sectorEtfs] of sectorMap) {
    const bulls = sectorEtfs.filter((e) => e.side === 'bull');
    const bears = sectorEtfs.filter((e) => e.side === 'bear');
    const bullRatios = calculateRatios(bulls.map((e) => ({ name: e.name, marketCap: e.marketCap })));
    const bearRatios = calculateRatios(bears.map((e) => ({ name: e.name, marketCap: e.marketCap })));
    let bullScore = 0;
    let bearScore = 0;
    const etfInfos: EtfSignalInfo[] = [];
    for (const etf of bulls) {
      const ratio = bullRatios.get(etf.name) ?? 0;
      const finalWeight = etf.typeWeight * ratio;
      if (etf.held) bullScore += finalWeight;
      etfInfos.push({
        name: etf.name, symbol: etf.symbol, type: etf.type,
        weight: etf.typeWeight, finalWeight, side: 'bull',
        held: etf.held, marketCap: etf.marketCap,
        lastSignalDate: etf.lastSignalDate, lastSignalType: etf.lastSignalType,
      });
    }
    for (const etf of bears) {
      const ratio = bearRatios.get(etf.name) ?? 0;
      const finalWeight = etf.typeWeight * ratio;
      if (etf.held) bearScore += finalWeight;
      etfInfos.push({
        name: etf.name, symbol: etf.symbol, type: etf.type,
        weight: etf.typeWeight, finalWeight, side: 'bear',
        held: etf.held, marketCap: etf.marketCap,
        lastSignalDate: etf.lastSignalDate, lastSignalType: etf.lastSignalType,
      });
    }
    const netSentiment = bullScore - bearScore;
    const hasActivePositions = bullScore > 0 || bearScore > 0;
    sectors[sector] = {
      label: sector,
      bullScore: Math.round(bullScore * 1000) / 1000,
      bearScore: Math.round(bearScore * 1000) / 1000,
      netSentiment: Math.round(netSentiment * 1000) / 1000,
      sentiment: getSentimentLabel(netSentiment, hasActivePositions),
      hasActivePositions,
      etfs: etfInfos,
    };
  }
  const sectorValues = Object.values(sectors);
  const activeSectors = sectorValues.filter((s) => s.hasActivePositions);
  const overallSentiment = activeSectors.length > 0
    ? activeSectors.reduce((sum, s) => sum + s.netSentiment, 0) / activeSectors.length
    : 0;
  return {
    sectors,
    overallSentiment: Math.round(overallSentiment * 1000) / 1000,
    overallLabel: getOverallSentimentLabel(overallSentiment, activeSectors.length > 0),
  };
}

// ─── 오버라이드 적용 ───

export function applyOverrides(etfs: ClassifiedEtf[], overrides: EtfOverrides): ClassifiedEtf[] {
  const sectorRenames = overrides.__sectorRenames;
  return etfs
    .filter((etf) => {
      const o = overrides[etf.name] as EtfOverrideEntry | undefined;
      return !o?.excluded;
    })
    .map((etf) => {
      const o = overrides[etf.name] as EtfOverrideEntry | undefined;
      let sector = o?.sector ?? etf.sector;
      const side: EtfSide = o?.side ?? etf.side;
      if (sectorRenames?.[sector]) {
        sector = sectorRenames[sector];
      }
      return { ...etf, sector, side };
    });
}
