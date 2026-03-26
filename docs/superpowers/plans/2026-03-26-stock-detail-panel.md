# 종목 상세 슬라이드 패널 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 종목 상세 모달을 풀스크린 슬라이드 패널로 교체하고, AI 투자의견 상세 근거·수급·DART·컨센서스 데이터를 추가하며, 점진적 로딩으로 초기 렌더 속도를 개선한다.

**Architecture:** `StockModalProvider` 컨텍스트에 `initialData` 파라미터를 추가하여, 랭킹 테이블에서 이미 보유한 `StockRankItem` 데이터를 패널에 전달해 즉시 렌더한다. 패널은 2컬럼 레이아웃(왼쪽: AI 분석, 오른쪽: 시장 데이터)이며, 차트/신호는 1차 fetch, 포트폴리오/그룹은 2차 lazy fetch로 분리한다.

**Tech Stack:** Next.js 16, React 19, Tailwind CSS v4, TypeScript

**디자인 토큰 규칙:** `.claude/steering/design-tokens.md` 필수 준수 — CSS 변수 사용, 카드 패딩 `p-4`, 섹션 간격 `space-y-6`, 라운드 `rounded-xl`, 소스/시그널 색상은 `signal-constants.ts` 사용

---

## 파일 구조

### 신규 파일
| 파일 | 책임 |
|------|------|
| `web/src/components/stock-modal/StockDetailPanel.tsx` | 슬라이드 패널 컨테이너, 2컬럼 레이아웃, 3단계 데이터 로딩 오케스트레이션 |
| `web/src/components/stock-modal/PanelHeader.tsx` | 종목명/심볼/가격/변동률/등급배지/닫기 버튼 |
| `web/src/components/stock-modal/AiOpinionCard.tsx` | AI 투자의견 — 총점 게이지, 5개 항목별 점수 바 + 근거 텍스트 |
| `web/src/components/stock-modal/SupplyDemandSection.tsx` | 수급 동향 — 외국인/기관 테이블, 공매도, 거래대금 |
| `web/src/components/stock-modal/TechnicalSignalSection.tsx` | 기술적 시그널 — RSI 게이지, 패턴 배지, 신호 이력 테이블 |
| `web/src/components/stock-modal/MetricsGrid.tsx` | 투자지표 그리드 — PER/PBR/ROE/EPS/BPS/배당/시총/거래량/52주 |
| `web/src/components/stock-modal/ConsensusSection.tsx` | 컨센서스 — 목표주가/투자의견/추정PER |
| `web/src/components/stock-modal/DartInfoSection.tsx` | DART 공시 — 리스크/긍정 플래그, 대주주/성장률 수치 |
| `web/src/components/stock-modal/PortfolioGroupAccordion.tsx` | 포트폴리오+그룹 아코디언 래퍼 (lazy fetch) |

### 수정 파일
| 파일 | 변경 내용 |
|------|----------|
| `web/src/contexts/stock-modal-context.tsx` | `openStockModal` 시그니처에 `initialData?: StockRankItem` 추가, `StockDetailModal` → `StockDetailPanel` 교체 |
| `web/src/components/signals/StockRankingSection.tsx` | `openStockModal` 호출 시 `initialData` 전달 |
| `web/src/components/dashboard/watchlist-widget.tsx` | `openStockModal` 호출 시 `initialData` 미전달 (기존 동작 유지) |
| `web/src/components/dashboard/dashboard-prices.tsx` | `openStockModal` 호출 시 `initialData` 미전달 (기존 동작 유지) |
| `web/src/components/common/stock-action-menu.tsx` | `openStockModal` 호출 시 `initialData` 미전달 (기존 동작 유지) |
| `web/src/app/portfolio/stock-link-button.tsx` | `openStockModal` 호출 시 `initialData` 미전달 (기존 동작 유지) |
| `web/src/app/my-portfolio/page.tsx` | `openStockModal` 호출 시 `initialData` 미전달 (기존 동작 유지) |

### 삭제 파일
| 파일 | 이유 |
|------|------|
| `web/src/components/stock-modal/StockDetailModal.tsx` | `StockDetailPanel.tsx`로 완전 교체 |
| `web/src/components/stock-modal/StockModalHeader.tsx` | `PanelHeader.tsx`로 교체 |
| `web/src/components/stock-modal/StockAiAnalysis.tsx` | `AiOpinionCard.tsx` + `TechnicalSignalSection.tsx`로 분리 교체 |

---

## Task 1: 컨텍스트 시그니처 변경 + PanelHeader 컴포넌트

**Files:**
- Modify: `web/src/contexts/stock-modal-context.tsx`
- Create: `web/src/components/stock-modal/PanelHeader.tsx`

- [ ] **Step 1: `stock-modal-context.tsx` 수정 — `initialData` 추가**

```tsx
// web/src/contexts/stock-modal-context.tsx
"use client";

import { createContext, useContext, useState, useCallback, ReactNode } from "react";
import type { StockRankItem } from "@/app/api/v1/stock-ranking/route";

interface StockModalState {
  symbol: string;
  name: string;
  initialData?: StockRankItem;
}

interface StockModalContextValue {
  modal: StockModalState | null;
  openStockModal: (symbol: string, name?: string, initialData?: StockRankItem) => void;
  closeStockModal: () => void;
}

const StockModalContext = createContext<StockModalContextValue | null>(null);

export function StockModalProvider({ children }: { children: ReactNode }) {
  const [modal, setModal] = useState<StockModalState | null>(null);

  const openStockModal = useCallback(
    (symbol: string, name = "", initialData?: StockRankItem) => {
      setModal({ symbol, name, initialData });
    },
    []
  );

  const closeStockModal = useCallback(() => {
    setModal(null);
  }, []);

  return (
    <StockModalContext.Provider value={{ modal, openStockModal, closeStockModal }}>
      {children}
      {/* StockDetailPanel은 Task 3에서 연결 */}
    </StockModalContext.Provider>
  );
}

export function useStockModal() {
  const ctx = useContext(StockModalContext);
  if (!ctx) throw new Error("useStockModal must be used within StockModalProvider");
  return ctx;
}
```

- [ ] **Step 2: `PanelHeader.tsx` 생성**

```tsx
// web/src/components/stock-modal/PanelHeader.tsx
"use client";

const GRADE_COLORS: Record<string, string> = {
  "A+": "bg-red-500 text-white",
  A: "bg-red-400 text-white",
  "B+": "bg-orange-500 text-white",
  B: "bg-orange-400 text-white",
  C: "bg-yellow-500 text-black",
  D: "bg-[var(--muted)] text-black",
};

interface Props {
  symbol: string;
  name: string;
  currentPrice: number;
  changeAmount: number;
  changePct: number;
  grade?: string;
  recommendation?: string;
  onClose: () => void;
}

export function PanelHeader({
  symbol,
  name,
  currentPrice,
  changeAmount,
  changePct,
  grade,
  recommendation,
  onClose,
}: Props) {
  const isUp = changeAmount >= 0;

  return (
    <div className="sticky top-0 z-10 bg-[var(--card)] border-b border-[var(--border)] px-4 py-3">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold">{name}</h2>
            <span className="text-sm text-[var(--muted)]">{symbol}</span>
            {grade && (
              <span
                className={`px-1.5 py-0.5 text-xs font-bold rounded ${GRADE_COLORS[grade] ?? "bg-[var(--muted)] text-black"}`}
              >
                {grade}
              </span>
            )}
            {recommendation && (
              <span className="text-xs text-[var(--muted)]">{recommendation}</span>
            )}
          </div>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-2xl font-bold">
              {currentPrice.toLocaleString()}원
            </span>
            <span
              className={`text-sm font-medium ${isUp ? "text-[var(--buy)]" : "text-[var(--sell)]"}`}
            >
              {isUp ? "▲" : "▼"} {Math.abs(changeAmount).toLocaleString()}
              ({isUp ? "+" : ""}
              {changePct.toFixed(2)}%)
            </span>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-[var(--card-hover)] text-[var(--muted)] text-xl leading-none"
          aria-label="닫기"
        >
          ×
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 빌드 확인**

Run: `cd /Users/thlee/GoogleDrive/DashboardStock/web && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: 에러 없음 (StockDetailModal import가 제거되었으므로 컨텍스트에서 임시 주석 처리 필요 — 아래 Step 1에서 children만 렌더하도록 처리됨)

- [ ] **Step 4: 커밋**

```bash
git add web/src/contexts/stock-modal-context.tsx web/src/components/stock-modal/PanelHeader.tsx
git commit -m "feat: 종목 상세 패널 — 컨텍스트 시그니처 변경 + PanelHeader 컴포넌트"
```

---

## Task 2: AI 투자의견 카드 (AiOpinionCard)

**Files:**
- Create: `web/src/components/stock-modal/AiOpinionCard.tsx`

- [ ] **Step 1: `AiOpinionCard.tsx` 생성**

```tsx
// web/src/components/stock-modal/AiOpinionCard.tsx
"use client";

import type { StockRankItem } from "@/app/api/v1/stock-ranking/route";
import { SIGNAL_TYPE_LABELS } from "@/lib/signal-constants";

interface Props {
  data: StockRankItem;
}

const PATTERN_LABELS: Record<string, string> = {
  golden_cross: "골든크로스",
  bollinger_bottom: "볼린저하단",
  phoenix_pattern: "피닉스패턴",
  macd_cross: "MACD크로스",
  volume_surge: "거래량급등",
  week52_low_near: "52주저가근접",
  double_top: "쌍봉",
  disparity_rebound: "이격도반등",
  volume_breakout: "거래량돌파",
  consecutive_drop_rebound: "연속하락반등",
};

function ScoreBar({ label, score, max = 100, children }: {
  label: string;
  score: number;
  max?: number;
  children: React.ReactNode;
}) {
  const pct = Math.min(Math.max((score / max) * 100, 0), 100);
  const color =
    pct >= 70 ? "bg-[var(--buy)]" : pct >= 40 ? "bg-[var(--warning)]" : "bg-[var(--muted)]";

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums font-bold">{score.toFixed(0)}<span className="text-xs font-normal text-[var(--muted)]">점</span></span>
      </div>
      <div className="h-2 rounded-full bg-[var(--background)] overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
      <div className="text-xs text-[var(--muted)] space-y-0.5">{children}</div>
    </div>
  );
}

export function AiOpinionCard({ data }: Props) {
  const {
    score_total, score_signal, score_momentum, score_valuation, score_supply,
    score_risk = 0, grade, recommendation, characters,
  } = data;

  // 총점 게이지 색상
  const gaugeColor =
    score_total >= 70 ? "text-[var(--buy)]" : score_total >= 40 ? "text-[var(--warning)]" : "text-[var(--muted)]";

  // 기술적 패턴 배지 (ai 데이터가 있으면 사용)
  const activePatterns: string[] = [];
  if (data.ai) {
    for (const [key, label] of Object.entries(PATTERN_LABELS)) {
      if (data.ai[key as keyof typeof data.ai] === true) {
        activePatterns.push(label);
      }
    }
  }

  // 리스크 항목 나열
  const riskItems: string[] = [];
  if (data.is_managed) riskItems.push("관리종목");
  if (data.has_recent_cbw) riskItems.push("CB/BW 최근 발행");
  if (data.major_shareholder_pct != null && data.major_shareholder_pct < 20) {
    riskItems.push(`대주주 지분 ${data.major_shareholder_pct.toFixed(1)}%`);
  }
  if (data.audit_opinion && data.audit_opinion !== "적정") {
    riskItems.push(`감사의견: ${data.audit_opinion}`);
  }

  return (
    <div className="p-4 space-y-4">
      <h3 className="text-lg font-semibold">AI 투자의견</h3>

      {/* 총점 + 등급 + 추천 + 성격 태그 */}
      <div className="flex items-center gap-4">
        <div className="text-center">
          <p className={`text-4xl font-bold tabular-nums ${gaugeColor}`}>
            {score_total.toFixed(0)}
          </p>
          <p className="text-xs text-[var(--muted)]">/ 100</p>
        </div>
        <div className="flex-1 space-y-1">
          {grade && (
            <span className="text-sm font-bold">등급 {grade}</span>
          )}
          {recommendation && (
            <span className="ml-2 text-sm text-[var(--muted)]">{recommendation}</span>
          )}
          {characters && characters.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {characters.map((c) => (
                <span
                  key={c}
                  className="px-2 py-0.5 text-xs rounded-full bg-[var(--accent)]/20 text-[var(--accent)]"
                >
                  {c}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 항목별 점수 바 */}
      <div className="space-y-3">
        <ScoreBar label="신호 신뢰도" score={score_signal}>
          <p>30일간 매수신호 {data.signal_count_30d ?? 0}회</p>
          {data.latest_signal_type && (
            <p>최근 신호: {SIGNAL_TYPE_LABELS[data.latest_signal_type] ?? data.latest_signal_type} ({data.latest_signal_date ?? "—"})</p>
          )}
          {data.gap_pct != null && (
            <p>신호가 대비 현재가 <span className={data.gap_pct >= 0 ? "text-[var(--buy)]" : "text-[var(--sell)]"}>{data.gap_pct >= 0 ? "+" : ""}{data.gap_pct.toFixed(1)}%</span></p>
          )}
        </ScoreBar>

        <ScoreBar label="기술적 모멘텀" score={score_momentum}>
          {data.close_position != null && (
            <p>52주 범위 내 위치 {(data.close_position * 100).toFixed(0)}%</p>
          )}
          {data.price_change_pct != null && (
            <p>당일 등락률 <span className={data.price_change_pct >= 0 ? "text-[var(--buy)]" : "text-[var(--sell)]"}>{data.price_change_pct >= 0 ? "+" : ""}{data.price_change_pct.toFixed(2)}%</span></p>
          )}
          {activePatterns.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-0.5">
              {activePatterns.map((p) => (
                <span key={p} className="px-1.5 py-0.5 text-[10px] rounded bg-purple-900/40 text-purple-300">
                  {p}
                </span>
              ))}
            </div>
          )}
        </ScoreBar>

        <ScoreBar label="밸류에이션" score={score_valuation}>
          <p>PER {data.per?.toFixed(1) ?? "—"} / PBR {data.pbr?.toFixed(2) ?? "—"} / ROE {data.roe?.toFixed(1) ?? "—"}%</p>
          {data.forward_per != null && <p>추정PER {data.forward_per.toFixed(1)}</p>}
          {data.dividend_yield != null && data.dividend_yield > 0 && (
            <p>배당수익률 {data.dividend_yield.toFixed(2)}%</p>
          )}
          {(data.revenue_growth_yoy != null || data.operating_profit_growth_yoy != null) && (
            <p>
              {data.revenue_growth_yoy != null && `매출 YoY ${data.revenue_growth_yoy >= 0 ? "+" : ""}${data.revenue_growth_yoy.toFixed(1)}%`}
              {data.revenue_growth_yoy != null && data.operating_profit_growth_yoy != null && " / "}
              {data.operating_profit_growth_yoy != null && `영업이익 YoY ${data.operating_profit_growth_yoy >= 0 ? "+" : ""}${data.operating_profit_growth_yoy.toFixed(1)}%`}
            </p>
          )}
        </ScoreBar>

        <ScoreBar label="수급 동향" score={score_supply}>
          {data.foreign_net_qty != null && (
            <p>
              외국인 <span className={data.foreign_net_qty >= 0 ? "text-[var(--buy)]" : "text-[var(--sell)]"}>
                {data.foreign_net_qty >= 0 ? "순매수" : "순매도"} {Math.abs(data.foreign_net_qty).toLocaleString()}주
              </span>
              {data.foreign_streak != null && data.foreign_streak > 0 && ` (연속 ${data.foreign_streak}일)`}
            </p>
          )}
          {data.institution_net_qty != null && (
            <p>
              기관 <span className={data.institution_net_qty >= 0 ? "text-[var(--buy)]" : "text-[var(--sell)]"}>
                {data.institution_net_qty >= 0 ? "순매수" : "순매도"} {Math.abs(data.institution_net_qty).toLocaleString()}주
              </span>
              {data.institution_streak != null && data.institution_streak > 0 && ` (연속 ${data.institution_streak}일)`}
            </p>
          )}
          {data.short_sell_ratio != null && (
            <p>공매도 비율 {data.short_sell_ratio.toFixed(2)}%</p>
          )}
        </ScoreBar>

        {/* 리스크 (감산) */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">리스크</span>
            <span className={`tabular-nums font-bold ${score_risk < 0 ? "text-[var(--danger)]" : "text-[var(--success)]"}`}>
              {score_risk === 0 ? "없음" : `${score_risk.toFixed(0)}점`}
            </span>
          </div>
          {riskItems.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {riskItems.map((r) => (
                <span key={r} className="px-2 py-0.5 text-xs rounded-full bg-[var(--danger)]/20 text-[var(--danger)]">
                  {r}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-xs text-[var(--success)]">리스크 요인 없음</p>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 빌드 확인**

Run: `cd /Users/thlee/GoogleDrive/DashboardStock/web && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: 에러 없음

- [ ] **Step 3: 커밋**

```bash
git add web/src/components/stock-modal/AiOpinionCard.tsx
git commit -m "feat: AI 투자의견 카드 컴포넌트 — 총점 게이지 + 5개 항목별 점수바 + 근거"
```

---

## Task 3: 수급 동향 + 투자지표 그리드 + 컨센서스 + DART 섹션

**Files:**
- Create: `web/src/components/stock-modal/SupplyDemandSection.tsx`
- Create: `web/src/components/stock-modal/MetricsGrid.tsx`
- Create: `web/src/components/stock-modal/ConsensusSection.tsx`
- Create: `web/src/components/stock-modal/DartInfoSection.tsx`

- [ ] **Step 1: `SupplyDemandSection.tsx` 생성**

```tsx
// web/src/components/stock-modal/SupplyDemandSection.tsx
"use client";

import type { StockRankItem } from "@/app/api/v1/stock-ranking/route";

interface Props {
  data: StockRankItem;
}

function Cell({ value, unit = "주", colorize = true }: { value: number | null; unit?: string; colorize?: boolean }) {
  if (value == null) return <td className="px-2 py-1.5 text-center text-[var(--muted)]">—</td>;
  const color = colorize ? (value >= 0 ? "text-[var(--buy)]" : "text-[var(--sell)]") : "";
  return (
    <td className={`px-2 py-1.5 text-center tabular-nums text-sm ${color}`}>
      {value >= 0 ? "+" : ""}{value.toLocaleString()}{unit}
    </td>
  );
}

function formatBillion(value: number | null): string {
  if (value == null) return "—";
  const billions = value / 1e8;
  if (billions >= 10000) return `${(billions / 10000).toFixed(1)}조`;
  return `${billions.toFixed(0)}억`;
}

export function SupplyDemandSection({ data }: Props) {
  return (
    <div className="p-4 space-y-3">
      <h3 className="text-lg font-semibold">수급 동향</h3>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[var(--muted)] border-b border-[var(--border)]">
              <th className="pb-1 text-left font-normal" />
              <th className="pb-1 text-center font-normal">당일</th>
              <th className="pb-1 text-center font-normal">5일 누적</th>
              <th className="pb-1 text-center font-normal">연속</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-[var(--border)]/50">
              <td className="py-1.5 text-sm font-medium">외국인</td>
              <Cell value={data.foreign_net_qty} />
              <Cell value={data.foreign_net_5d} />
              <td className="px-2 py-1.5 text-center text-sm tabular-nums">
                {data.foreign_streak != null ? `${data.foreign_streak}일` : "—"}
              </td>
            </tr>
            <tr>
              <td className="py-1.5 text-sm font-medium">기관</td>
              <Cell value={data.institution_net_qty} />
              <Cell value={data.institution_net_5d} />
              <td className="px-2 py-1.5 text-center text-sm tabular-nums">
                {data.institution_streak != null ? `${data.institution_streak}일` : "—"}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-4 text-sm">
        <div>
          <span className="text-[var(--muted)]">공매도 </span>
          <span className="font-medium tabular-nums">
            {data.short_sell_ratio != null ? `${data.short_sell_ratio.toFixed(2)}%` : "—"}
          </span>
        </div>
        <div>
          <span className="text-[var(--muted)]">거래대금 </span>
          <span className="font-medium tabular-nums">{formatBillion(data.trading_value)}</span>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: `MetricsGrid.tsx` 생성**

```tsx
// web/src/components/stock-modal/MetricsGrid.tsx
"use client";

interface MetricsData {
  per: number | null;
  pbr: number | null;
  roe: number | null;
  eps: number | null;
  bps: number | null;
  dividend_yield: number | null;
  market_cap: number | null;
  volume: number | null;
  high_52w: number | null;
  low_52w: number | null;
}

interface Props {
  data: MetricsData;
}

function formatMarketCap(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1e12) return `${(n / 1e12).toFixed(1)}조`;
  if (n >= 1e8) return `${(n / 1e8).toFixed(0)}억`;
  return `${n.toLocaleString()}원`;
}

function MetricCell({ label, value, className = "" }: { label: string; value: string; className?: string }) {
  return (
    <div className="bg-[var(--background)] rounded-xl p-2 text-center">
      <p className="text-[var(--muted)] text-xs">{label}</p>
      <p className={`font-medium mt-0.5 text-sm tabular-nums ${className}`}>{value}</p>
    </div>
  );
}

export function MetricsGrid({ data }: Props) {
  return (
    <div className="p-4 space-y-2">
      <h3 className="text-lg font-semibold">투자지표</h3>
      <div className="grid grid-cols-3 gap-2">
        <MetricCell label="PER" value={data.per != null ? `${data.per.toFixed(2)}배` : "—"} />
        <MetricCell label="PBR" value={data.pbr != null ? `${data.pbr.toFixed(2)}배` : "—"} />
        <MetricCell label="ROE" value={data.roe != null ? `${data.roe.toFixed(1)}%` : "—"} />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <MetricCell label="EPS" value={data.eps != null ? `${data.eps.toLocaleString()}원` : "—"} />
        <MetricCell label="BPS" value={data.bps != null ? `${data.bps.toLocaleString()}원` : "—"} />
        <MetricCell label="배당수익률" value={data.dividend_yield != null ? `${data.dividend_yield.toFixed(2)}%` : "—"} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <MetricCell label="시가총액" value={formatMarketCap(data.market_cap)} />
        <MetricCell label="거래량" value={data.volume != null ? `${data.volume.toLocaleString()}주` : "—"} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <MetricCell label="52주 최고가" value={data.high_52w != null ? `${data.high_52w.toLocaleString()}원` : "—"} className="text-[var(--buy)]" />
        <MetricCell label="52주 최저가" value={data.low_52w != null ? `${data.low_52w.toLocaleString()}원` : "—"} className="text-[var(--sell)]" />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: `ConsensusSection.tsx` 생성**

```tsx
// web/src/components/stock-modal/ConsensusSection.tsx
"use client";

import type { StockRankItem } from "@/app/api/v1/stock-ranking/route";

interface Props {
  data: StockRankItem;
  currentPrice: number;
}

const OPINION_LABELS: Record<number, string> = {
  1: "적극매도",
  2: "매도",
  3: "중립",
  4: "매수",
  5: "적극매수",
};

function getOpinionLabel(value: number | null): string {
  if (value == null) return "—";
  const rounded = Math.round(value);
  return OPINION_LABELS[rounded] ?? `${value.toFixed(1)}`;
}

export function ConsensusSection({ data, currentPrice }: Props) {
  const { target_price, invest_opinion, forward_per } = data;

  const upsidePct =
    target_price != null && currentPrice > 0
      ? ((target_price - currentPrice) / currentPrice) * 100
      : null;

  const hasData = target_price != null || invest_opinion != null || forward_per != null;
  if (!hasData) return null;

  return (
    <div className="p-4 space-y-3">
      <h3 className="text-lg font-semibold">컨센서스</h3>
      <div className="grid grid-cols-3 gap-2">
        {target_price != null && (
          <div className="bg-[var(--background)] rounded-xl p-2 text-center">
            <p className="text-[var(--muted)] text-xs">목표주가</p>
            <p className="font-medium mt-0.5 text-sm tabular-nums">
              {target_price.toLocaleString()}원
            </p>
            {upsidePct != null && (
              <p className={`text-xs mt-0.5 ${upsidePct >= 0 ? "text-[var(--buy)]" : "text-[var(--sell)]"}`}>
                {upsidePct >= 0 ? "+" : ""}{upsidePct.toFixed(1)}%
              </p>
            )}
          </div>
        )}
        {invest_opinion != null && (
          <div className="bg-[var(--background)] rounded-xl p-2 text-center">
            <p className="text-[var(--muted)] text-xs">투자의견</p>
            <p className="font-medium mt-0.5 text-sm">{getOpinionLabel(invest_opinion)}</p>
            <p className="text-xs text-[var(--muted)] mt-0.5">{invest_opinion.toFixed(1)} / 5.0</p>
          </div>
        )}
        {forward_per != null && (
          <div className="bg-[var(--background)] rounded-xl p-2 text-center">
            <p className="text-[var(--muted)] text-xs">추정PER</p>
            <p className="font-medium mt-0.5 text-sm tabular-nums">{forward_per.toFixed(1)}배</p>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: `DartInfoSection.tsx` 생성**

```tsx
// web/src/components/stock-modal/DartInfoSection.tsx
"use client";

import type { StockRankItem } from "@/app/api/v1/stock-ranking/route";

interface Props {
  data: StockRankItem;
}

interface FlagItem {
  label: string;
  type: "danger" | "success" | "neutral";
}

export function DartInfoSection({ data }: Props) {
  const flags: FlagItem[] = [];

  // 경고 (빨강)
  if (data.is_managed) flags.push({ label: "관리종목", type: "danger" });
  if (data.has_recent_cbw) flags.push({ label: "CB/BW 최근 발행", type: "danger" });
  if (data.audit_opinion && data.audit_opinion !== "적정") {
    flags.push({ label: `감사의견: ${data.audit_opinion}`, type: "danger" });
  }

  // 긍정 (초록)
  if (data.has_treasury_buyback) flags.push({ label: "자사주 매입", type: "success" });

  const hasNumericData =
    data.major_shareholder_pct != null ||
    data.major_shareholder_delta != null ||
    data.revenue_growth_yoy != null ||
    data.operating_profit_growth_yoy != null;

  if (flags.length === 0 && !hasNumericData) return null;

  const flagColors: Record<string, string> = {
    danger: "bg-[var(--danger)]/20 text-[var(--danger)]",
    success: "bg-[var(--success)]/20 text-[var(--success)]",
    neutral: "bg-[var(--muted)]/20 text-[var(--muted)]",
  };

  return (
    <div className="p-4 space-y-3">
      <h3 className="text-lg font-semibold">DART 공시</h3>

      {flags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {flags.map((f) => (
            <span
              key={f.label}
              className={`px-2 py-0.5 text-xs rounded-full ${flagColors[f.type]}`}
            >
              {f.label}
            </span>
          ))}
        </div>
      )}

      {hasNumericData && (
        <div className="grid grid-cols-2 gap-2 text-sm">
          {data.major_shareholder_pct != null && (
            <div>
              <span className="text-[var(--muted)]">대주주 지분 </span>
              <span className="font-medium tabular-nums">{data.major_shareholder_pct.toFixed(1)}%</span>
              {data.major_shareholder_delta != null && data.major_shareholder_delta !== 0 && (
                <span className={`ml-1 text-xs ${data.major_shareholder_delta > 0 ? "text-[var(--buy)]" : "text-[var(--sell)]"}`}>
                  ({data.major_shareholder_delta > 0 ? "+" : ""}{data.major_shareholder_delta.toFixed(1)}%p)
                </span>
              )}
            </div>
          )}
          {data.revenue_growth_yoy != null && (
            <div>
              <span className="text-[var(--muted)]">매출 YoY </span>
              <span className={`font-medium tabular-nums ${data.revenue_growth_yoy >= 0 ? "text-[var(--buy)]" : "text-[var(--sell)]"}`}>
                {data.revenue_growth_yoy >= 0 ? "+" : ""}{data.revenue_growth_yoy.toFixed(1)}%
              </span>
            </div>
          )}
          {data.operating_profit_growth_yoy != null && (
            <div>
              <span className="text-[var(--muted)]">영업이익 YoY </span>
              <span className={`font-medium tabular-nums ${data.operating_profit_growth_yoy >= 0 ? "text-[var(--buy)]" : "text-[var(--sell)]"}`}>
                {data.operating_profit_growth_yoy >= 0 ? "+" : ""}{data.operating_profit_growth_yoy.toFixed(1)}%
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: 빌드 확인**

Run: `cd /Users/thlee/GoogleDrive/DashboardStock/web && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: 에러 없음

- [ ] **Step 6: 커밋**

```bash
git add web/src/components/stock-modal/SupplyDemandSection.tsx web/src/components/stock-modal/MetricsGrid.tsx web/src/components/stock-modal/ConsensusSection.tsx web/src/components/stock-modal/DartInfoSection.tsx
git commit -m "feat: 수급/투자지표/컨센서스/DART 섹션 컴포넌트 4종 추가"
```

---

## Task 4: 기술적 시그널 섹션 (TechnicalSignalSection)

**Files:**
- Create: `web/src/components/stock-modal/TechnicalSignalSection.tsx`

- [ ] **Step 1: `TechnicalSignalSection.tsx` 생성**

```tsx
// web/src/components/stock-modal/TechnicalSignalSection.tsx
"use client";

import type { StockRankItem } from "@/app/api/v1/stock-ranking/route";
import { SOURCE_LABELS, SIGNAL_TYPE_LABELS } from "@/lib/signal-constants";

interface Signal {
  id: string;
  symbol: string;
  signal_type: string;
  source: string;
  timestamp: string;
  signal_price?: string | number;
  raw_data?: Record<string, unknown>;
}

interface Props {
  data: StockRankItem;
  signals: Signal[];  // 1차 fetch 후 전달 (빈 배열이면 스켈레톤 또는 빈 상태)
  signalsLoading: boolean;
}

const PATTERN_LABELS: Record<string, string> = {
  golden_cross: "골든크로스",
  bollinger_bottom: "볼린저하단",
  phoenix_pattern: "피닉스패턴",
  macd_cross: "MACD크로스",
  volume_surge: "거래량급등",
  week52_low_near: "52주저가근접",
  double_top: "쌍봉",
  disparity_rebound: "이격도반등",
  volume_breakout: "거래량돌파",
  consecutive_drop_rebound: "연속하락반등",
};

function getSignalPrice(s: Signal): number {
  if (s.signal_price !== undefined && s.signal_price !== null) {
    const val = Number(s.signal_price);
    if (!isNaN(val)) return val;
  }
  const rd = s.raw_data ?? {};
  return Number(rd.signal_price ?? rd.recommend_price ?? rd.buy_range_low ?? 0) || 0;
}

export function TechnicalSignalSection({ data, signals, signalsLoading }: Props) {
  const rsi = data.ai?.rsi ?? null;

  // 패턴 배지
  const activePatterns: string[] = [];
  if (data.ai) {
    for (const [key, label] of Object.entries(PATTERN_LABELS)) {
      if (data.ai[key as keyof typeof data.ai] === true) {
        activePatterns.push(label);
      }
    }
  }

  // RSI 게이지 색상
  const rsiColor =
    rsi == null ? "bg-[var(--muted)]" :
    rsi <= 30 ? "bg-[var(--sell)]" :
    rsi >= 70 ? "bg-[var(--buy)]" :
    "bg-[var(--warning)]";

  const rsiLabel =
    rsi == null ? "" :
    rsi <= 30 ? "과매도" :
    rsi >= 70 ? "과매수" :
    "중립";

  return (
    <div className="p-4 space-y-3">
      <h3 className="text-lg font-semibold">기술적 시그널</h3>

      {/* RSI 게이지 */}
      {rsi != null && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-sm">
            <span className="text-[var(--muted)]">RSI</span>
            <span className="font-medium tabular-nums">{rsi.toFixed(1)} <span className="text-xs text-[var(--muted)]">{rsiLabel}</span></span>
          </div>
          <div className="h-2 rounded-full bg-[var(--background)] overflow-hidden">
            <div className={`h-full rounded-full ${rsiColor} transition-all duration-500`} style={{ width: `${Math.min(rsi, 100)}%` }} />
          </div>
        </div>
      )}

      {/* 활성 패턴 배지 */}
      {activePatterns.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {activePatterns.map((p) => (
            <span key={p} className="px-2 py-0.5 text-xs rounded-full bg-purple-900/40 text-purple-300">
              {p}
            </span>
          ))}
        </div>
      )}
      {activePatterns.length === 0 && rsi == null && (
        <p className="text-sm text-[var(--muted)]">기술적 지표 데이터 없음</p>
      )}

      {/* 신호 이력 테이블 */}
      <div className="mt-2">
        <h4 className="text-sm font-medium text-[var(--muted)] mb-2">신호 이력</h4>
        {signalsLoading ? (
          <div className="space-y-2 animate-pulse">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-6 bg-[var(--muted)]/20 rounded" />
            ))}
          </div>
        ) : signals.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">신호 이력이 없습니다.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[var(--muted)] border-b border-[var(--border)]">
                  <th className="pb-1 font-normal">날짜</th>
                  <th className="pb-1 font-normal">소스</th>
                  <th className="pb-1 font-normal">타입</th>
                  <th className="pb-1 font-normal text-right">가격</th>
                </tr>
              </thead>
              <tbody>
                {signals.slice(0, 20).map((s) => (
                  <tr key={s.id} className="border-b border-[var(--border)]/50">
                    <td className="py-1.5 text-[var(--muted)] text-xs">
                      {new Date(s.timestamp).toLocaleDateString("ko-KR")}
                    </td>
                    <td className="py-1.5 text-xs">
                      {SOURCE_LABELS[s.source] ?? s.source}
                    </td>
                    <td className="py-1.5">
                      <span className={`text-xs font-medium ${s.signal_type.startsWith("BUY") ? "text-[var(--buy)]" : "text-[var(--sell)]"}`}>
                        {SIGNAL_TYPE_LABELS[s.signal_type] ?? s.signal_type}
                      </span>
                    </td>
                    <td className="py-1.5 text-right text-xs tabular-nums">
                      {getSignalPrice(s) > 0 ? `${getSignalPrice(s).toLocaleString()}원` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 빌드 확인**

Run: `cd /Users/thlee/GoogleDrive/DashboardStock/web && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: 에러 없음

- [ ] **Step 3: 커밋**

```bash
git add web/src/components/stock-modal/TechnicalSignalSection.tsx
git commit -m "feat: 기술적 시그널 섹션 — RSI 게이지 + 패턴 배지 + 신호 이력 테이블"
```

---

## Task 5: 포트폴리오/그룹 아코디언 래퍼 (PortfolioGroupAccordion)

**Files:**
- Create: `web/src/components/stock-modal/PortfolioGroupAccordion.tsx`

- [ ] **Step 1: `PortfolioGroupAccordion.tsx` 생성**

```tsx
// web/src/components/stock-modal/PortfolioGroupAccordion.tsx
"use client";

import { useState, useCallback } from "react";
import { PortfolioManagementSection } from "./PortfolioManagementSection";
import { GroupManagementSection } from "./GroupManagementSection";

interface Trade {
  id: string;
  portfolio_id: string;
  side: string;
  price: number;
  target_price: number | null;
  stop_price: number | null;
  buy_trade_id: string | null;
  created_at: string;
}

interface Portfolio {
  id: string;
  name: string;
  is_default: boolean;
}

interface Group {
  id: string;
  name: string;
}

interface Props {
  symbol: string;
  name: string;
  currentPrice: number;
  onAddClick: (portfolioId: string, portfolioName: string) => void;
}

export function PortfolioGroupAccordion({ symbol, name, currentPrice, onAddClick }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [allGroups, setAllGroups] = useState<Group[]>([]);
  const [memberGroupIds, setMemberGroupIds] = useState<string[]>([]);

  const fetchData = useCallback(async () => {
    if (loaded) return;
    setLoading(true);
    try {
      const [portfoliosRes, tradesRes, groupsRes] = await Promise.all([
        fetch("/api/v1/user-portfolio"),
        fetch(`/api/v1/user-portfolio/trades?symbol=${symbol}`),
        fetch("/api/v1/watchlist-groups"),
      ]);

      const [portfoliosData, tradesData, groupsData] = await Promise.all([
        portfoliosRes.ok ? portfoliosRes.json() : { portfolios: [] },
        tradesRes.ok ? tradesRes.json() : { trades: [] },
        groupsRes.ok ? groupsRes.json() : { groups: [] },
      ]);

      const ports: Portfolio[] = (Array.isArray(portfoliosData) ? portfoliosData : (portfoliosData?.portfolios ?? [])).map(
        (p: { id: number; name: string; is_default: boolean }) => ({ id: String(p.id), name: p.name, is_default: p.is_default })
      );
      setPortfolios(ports);

      const rawTrades = Array.isArray(tradesData) ? tradesData : (tradesData?.trades ?? []);
      setTrades(rawTrades.map((t: Trade) => ({ ...t, portfolio_id: String(t.portfolio_id) })));

      const groups: Group[] = Array.isArray(groupsData) ? groupsData : (groupsData?.groups ?? []);
      setAllGroups(groups);

      // 멤버십 확인
      const membershipResults = await Promise.all(
        groups.map(async (g) => {
          const res = await fetch(`/api/v1/watchlist-groups/${g.id}/stocks`);
          if (!res.ok) return null;
          const data = await res.json();
          const stocks: { symbol: string }[] = Array.isArray(data) ? data : (data?.stocks ?? []);
          return stocks.some((s) => s.symbol === symbol) ? g.id : null;
        })
      );
      setMemberGroupIds(membershipResults.filter((id): id is string => id !== null));
      setLoaded(true);
    } catch {
      // 에러 무시 — 빈 상태로 표시
    } finally {
      setLoading(false);
    }
  }, [symbol, loaded]);

  const handleToggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !loaded) fetchData();
  };

  return (
    <div className="border-t border-[var(--border)]">
      <button
        onClick={handleToggle}
        className="w-full flex items-center justify-between p-4 text-sm font-medium hover:bg-[var(--card-hover)] transition-colors"
      >
        <span>포트폴리오 / 관심그룹</span>
        <span className="text-[var(--muted)]">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div>
          {loading ? (
            <div className="p-4 space-y-2 animate-pulse">
              <div className="h-8 bg-[var(--muted)]/20 rounded" />
              <div className="h-8 bg-[var(--muted)]/20 rounded" />
              <div className="h-8 bg-[var(--muted)]/20 rounded" />
            </div>
          ) : (
            <>
              <PortfolioManagementSection
                symbol={symbol}
                name={name}
                currentPrice={currentPrice}
                portfolios={portfolios}
                trades={trades}
                onAddClick={onAddClick}
                onTradesChange={(newTrades) => setTrades(newTrades as Trade[])}
              />
              <GroupManagementSection
                symbol={symbol}
                name={name}
                allGroups={allGroups}
                memberGroupIds={memberGroupIds}
                onMembershipChange={setMemberGroupIds}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 빌드 확인**

Run: `cd /Users/thlee/GoogleDrive/DashboardStock/web && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: 에러 없음

- [ ] **Step 3: 커밋**

```bash
git add web/src/components/stock-modal/PortfolioGroupAccordion.tsx
git commit -m "feat: 포트폴리오/그룹 아코디언 래퍼 — lazy fetch 구현"
```

---

## Task 6: 메인 슬라이드 패널 (StockDetailPanel)

**Files:**
- Create: `web/src/components/stock-modal/StockDetailPanel.tsx`
- Modify: `web/src/contexts/stock-modal-context.tsx` (StockDetailPanel 연결)

- [ ] **Step 1: `StockDetailPanel.tsx` 생성**

```tsx
// web/src/components/stock-modal/StockDetailPanel.tsx
"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useStockModal } from "@/contexts/stock-modal-context";
import type { StockRankItem } from "@/app/api/v1/stock-ranking/route";
import { usePriceRefresh } from "@/hooks/use-price-refresh";
import { PanelHeader } from "./PanelHeader";
import { AiOpinionCard } from "./AiOpinionCard";
import { SupplyDemandSection } from "./SupplyDemandSection";
import { TechnicalSignalSection } from "./TechnicalSignalSection";
import { MetricsGrid } from "./MetricsGrid";
import { ConsensusSection } from "./ConsensusSection";
import { DartInfoSection } from "./DartInfoSection";
import { PortfolioGroupAccordion } from "./PortfolioGroupAccordion";
import dynamic from "next/dynamic";

const StockChartSection = dynamic(
  () => import("@/components/charts/stock-chart-section"),
  { ssr: false }
);

const TradeModal = dynamic(
  () => import("@/app/my-portfolio/components/trade-modal").then((m) => m.TradeModal),
  { ssr: false }
);

interface Signal {
  id: string;
  symbol: string;
  signal_type: string;
  source: string;
  timestamp: string;
  signal_price?: string | number;
  raw_data?: Record<string, unknown>;
}

interface Metrics {
  name: string;
  current_price: number;
  price_change: number;
  price_change_pct: number;
  per: number | null;
  pbr: number | null;
  roe: number | null;
  eps: number | null;
  bps: number | null;
  market_cap: number | null;
  high_52w: number | null;
  low_52w: number | null;
  dividend_yield: number | null;
  volume: number | null;
}

interface PriceData {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export function StockDetailPanel() {
  const { modal, closeStockModal } = useStockModal();
  const [isVisible, setIsVisible] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // 1차 fetch 상태
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [dailyPrices, setDailyPrices] = useState<PriceData[]>([]);
  const [phase1Loading, setPhase1Loading] = useState(false);
  const [phase1Error, setPhase1Error] = useState<string | null>(null);

  // initialData 없이 열린 경우의 fallback ranking 데이터
  const [rankingData, setRankingData] = useState<StockRankItem | null>(null);

  // TradeModal 상태
  const [tradeModalOpen, setTradeModalOpen] = useState(false);
  const [tradePortfolioId, setTradePortfolioId] = useState<number | null>(null);

  // 실시간 가격
  const { prices: livePrices } = usePriceRefresh(modal ? [modal.symbol] : []);
  const livePrice = modal ? livePrices[modal.symbol] : null;

  // 데이터 소스 우선순위: livePrice > metrics > initialData
  const data = modal?.initialData ?? rankingData;
  const currentPrice = livePrice?.current_price ?? metrics?.current_price ?? data?.current_price ?? 0;
  const changeAmount = livePrice?.price_change ?? metrics?.price_change ?? 0;
  const changePct = livePrice?.price_change_pct ?? metrics?.price_change_pct ?? data?.price_change_pct ?? 0;

  // 투자지표 merge (metrics 우선, initialData 폴백)
  const metricsData = {
    per: metrics?.per ?? data?.per ?? null,
    pbr: metrics?.pbr ?? data?.pbr ?? null,
    roe: metrics?.roe ?? data?.roe ?? null,
    eps: metrics?.eps ?? null,
    bps: metrics?.bps ?? null,
    dividend_yield: metrics?.dividend_yield ?? data?.dividend_yield ?? null,
    market_cap: metrics?.market_cap ?? data?.market_cap ?? null,
    volume: metrics?.volume ?? null,
    high_52w: metrics?.high_52w ?? data?.high_52w ?? null,
    low_52w: metrics?.low_52w ?? data?.low_52w ?? null,
  };

  // 슬라이드 애니메이션
  useEffect(() => {
    if (modal) {
      // 열기: 다음 프레임에서 visible 설정
      requestAnimationFrame(() => setIsVisible(true));
    } else {
      setIsVisible(false);
    }
  }, [modal]);

  // 1차 fetch
  const fetchPhase1 = useCallback(async (symbol: string, hasInitialData: boolean) => {
    setPhase1Loading(true);
    setPhase1Error(null);
    try {
      const fetches: Promise<Response>[] = [
        fetch(`/api/v1/stock/${symbol}/metrics`),
        fetch(`/api/v1/signals?symbol=${symbol}`),
        fetch(`/api/v1/stock/${symbol}/daily-prices`),
      ];

      // initialData 없으면 ranking 데이터도 가져오기
      if (!hasInitialData) {
        fetches.push(fetch(`/api/v1/stock-ranking?symbol=${symbol}`));
      }

      const responses = await Promise.all(fetches);
      const [metricsRes, signalsRes, dailyPricesRes] = responses;

      const [metricsJson, signalsJson, dailyPricesJson] = await Promise.all([
        metricsRes.ok ? metricsRes.json() : null,
        signalsRes.ok ? signalsRes.json() : { signals: [] },
        dailyPricesRes.ok ? dailyPricesRes.json() : [],
      ]);

      if (metricsJson) setMetrics(metricsJson);

      const sigs = Array.isArray(signalsJson) ? signalsJson : (signalsJson?.signals ?? []);
      setSignals(sigs);

      const rawPrices = Array.isArray(dailyPricesJson) ? dailyPricesJson : [];
      setDailyPrices(rawPrices.sort((a: PriceData, b: PriceData) => a.date.localeCompare(b.date)));

      // ranking fallback
      if (!hasInitialData && responses[3]) {
        const rankingJson = await (responses[3].ok ? responses[3].json() : null);
        if (rankingJson?.items) {
          const item = rankingJson.items.find((i: StockRankItem) => i.symbol === symbol);
          if (item) setRankingData(item);
        }
      }
    } catch {
      setPhase1Error("데이터를 불러오는 중 오류가 발생했습니다.");
    } finally {
      setPhase1Loading(false);
    }
  }, []);

  useEffect(() => {
    if (modal?.symbol) {
      // 상태 초기화
      setMetrics(null);
      setSignals([]);
      setDailyPrices([]);
      setRankingData(null);
      setPhase1Error(null);
      fetchPhase1(modal.symbol, !!modal.initialData);
    }
  }, [modal?.symbol, modal?.initialData, fetchPhase1]);

  // ESC 닫기
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeStockModal();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [closeStockModal]);

  // 닫기 애니메이션 후 실제 닫기
  const handleClose = useCallback(() => {
    setIsVisible(false);
    setTimeout(closeStockModal, 300);
  }, [closeStockModal]);

  if (!modal) return null;

  const stockName = metrics?.name ?? modal.name ?? data?.name ?? modal.symbol;

  // 차트용 시그널 마커
  const signalMarkers = signals
    .map((s) => ({
      date: (s.timestamp || "").split("T")[0],
      type: s.signal_type as "BUY" | "BUY_FORECAST" | "SELL" | "SELL_COMPLETE",
      source: s.source,
    }))
    .filter((m) => m.date);
  const signalDates = [...new Set(signalMarkers.map((m) => m.date))];

  return (
    <>
      {/* 오버레이 */}
      <div
        className={`fixed inset-0 z-50 bg-black/50 transition-opacity duration-300 ${isVisible ? "opacity-100" : "opacity-0"}`}
        onClick={handleClose}
      />

      {/* 슬라이드 패널 */}
      <div
        ref={panelRef}
        className={`fixed top-0 right-0 z-50 h-screen w-[85vw] max-w-[1200px] max-md:w-full bg-[var(--card)] shadow-2xl flex flex-col transition-transform duration-300 ease-out ${isVisible ? "translate-x-0" : "translate-x-full"}`}
      >
        <PanelHeader
          symbol={modal.symbol}
          name={stockName}
          currentPrice={currentPrice}
          changeAmount={changeAmount}
          changePct={changePct}
          grade={data?.grade}
          recommendation={data?.recommendation}
          onClose={handleClose}
        />

        {/* 2컬럼 본문 */}
        <div className="flex-1 overflow-hidden flex flex-col md:flex-row">
          {/* 왼쪽 컬럼: AI 분석 */}
          <div className="md:w-[55%] overflow-y-auto border-r border-[var(--border)] max-md:border-r-0">
            {data ? (
              <div className="space-y-0 divide-y divide-[var(--border)]">
                <AiOpinionCard data={data} />
                <SupplyDemandSection data={data} />
                <TechnicalSignalSection
                  data={data}
                  signals={signals}
                  signalsLoading={phase1Loading}
                />
              </div>
            ) : (
              <div className="p-4 space-y-4 animate-pulse">
                <div className="h-40 bg-[var(--muted)]/20 rounded-xl" />
                <div className="h-24 bg-[var(--muted)]/20 rounded-xl" />
                <div className="h-32 bg-[var(--muted)]/20 rounded-xl" />
              </div>
            )}
          </div>

          {/* 오른쪽 컬럼: 시장 데이터 */}
          <div className="md:w-[45%] overflow-y-auto">
            <div className="space-y-0 divide-y divide-[var(--border)]">
              {/* 차트 */}
              {phase1Loading && dailyPrices.length === 0 ? (
                <div className="p-4 animate-pulse">
                  <div className="h-[250px] bg-[var(--muted)]/20 rounded-xl" />
                </div>
              ) : dailyPrices.length > 0 ? (
                <div>
                  <StockChartSection
                    prices={dailyPrices}
                    signalDates={signalDates}
                    signalMarkers={signalMarkers}
                    initialPeriod={30}
                  />
                </div>
              ) : null}

              {/* 투자지표 */}
              <MetricsGrid data={metricsData} />

              {/* 컨센서스 */}
              {data && <ConsensusSection data={data} currentPrice={currentPrice} />}

              {/* DART */}
              {data && <DartInfoSection data={data} />}

              {/* 에러 표시 */}
              {phase1Error && (
                <div className="p-4 text-center">
                  <p className="text-[var(--danger)] mb-3 text-sm">{phase1Error}</p>
                  <button
                    onClick={() => fetchPhase1(modal.symbol, !!modal.initialData)}
                    className="text-sm px-3 py-1 rounded border border-[var(--border)] hover:bg-[var(--card-hover)]"
                  >
                    재시도
                  </button>
                </div>
              )}

              {/* 포트폴리오/그룹 아코디언 */}
              <PortfolioGroupAccordion
                symbol={modal.symbol}
                name={stockName}
                currentPrice={currentPrice}
                onAddClick={(portfolioId) => {
                  setTradePortfolioId(Number(portfolioId));
                  setTradeModalOpen(true);
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* TradeModal */}
      {tradeModalOpen && (
        <TradeModal
          mode="buy"
          isOpen={tradeModalOpen}
          onClose={() => setTradeModalOpen(false)}
          onSubmit={() => {
            setTradeModalOpen(false);
            fetchPhase1(modal.symbol, !!modal.initialData);
          }}
          initialSymbol={modal.symbol}
          initialName={stockName}
          initialPrice={currentPrice}
          portfolios={[]}
        />
      )}
    </>
  );
}
```

- [ ] **Step 2: `stock-modal-context.tsx`에 StockDetailPanel 연결**

`stock-modal-context.tsx`에서 주석 처리한 부분을 복원:

```tsx
// web/src/contexts/stock-modal-context.tsx 변경 사항:
// import 변경
import { StockDetailPanel } from "@/components/stock-modal/StockDetailPanel";

// JSX 변경 (children 아래)
<StockModalContext.Provider value={{ modal, openStockModal, closeStockModal }}>
  {children}
  <StockDetailPanel />
</StockModalContext.Provider>
```

- [ ] **Step 3: 빌드 확인**

Run: `cd /Users/thlee/GoogleDrive/DashboardStock/web && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: 에러 없음

- [ ] **Step 4: 커밋**

```bash
git add web/src/components/stock-modal/StockDetailPanel.tsx web/src/contexts/stock-modal-context.tsx
git commit -m "feat: 메인 슬라이드 패널 — 2컬럼 레이아웃 + 3단계 점진적 로딩"
```

---

## Task 7: 기존 모달 파일 삭제 + 트리거 업데이트

**Files:**
- Delete: `web/src/components/stock-modal/StockDetailModal.tsx`
- Delete: `web/src/components/stock-modal/StockModalHeader.tsx`
- Delete: `web/src/components/stock-modal/StockAiAnalysis.tsx`
- Modify: `web/src/components/signals/StockRankingSection.tsx` (initialData 전달)

- [ ] **Step 1: 기존 파일 삭제**

```bash
rm web/src/components/stock-modal/StockDetailModal.tsx
rm web/src/components/stock-modal/StockModalHeader.tsx
rm web/src/components/stock-modal/StockAiAnalysis.tsx
```

- [ ] **Step 2: `StockRankingSection.tsx`에서 `openStockModal`에 `initialData` 전달**

이 파일에서 `openStockModal` 호출 부분을 찾아 `StockRankItem` 데이터를 세 번째 인자로 전달하도록 수정. 구체적인 수정 위치는 파일의 행 클릭 핸들러에서 `openStockModal(item.symbol, item.name)` → `openStockModal(item.symbol, item.name, item)`.

- [ ] **Step 3: 나머지 5개 트리거 파일 확인**

나머지 호출 위치(`watchlist-widget.tsx`, `dashboard-prices.tsx`, `stock-action-menu.tsx`, `stock-link-button.tsx`, `my-portfolio/page.tsx`)는 `initialData`를 전달하지 않으므로 변경 불필요. `openStockModal(symbol, name)` 호출이 그대로 동작함 (세 번째 인자 `undefined`).

- [ ] **Step 4: 빌드 확인**

Run: `cd /Users/thlee/GoogleDrive/DashboardStock/web && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: 삭제된 파일 import 에러 없음 (이미 교체됨)

- [ ] **Step 5: 개발 서버에서 동작 확인**

Run: `cd /Users/thlee/GoogleDrive/DashboardStock/web && npm run dev`
확인 사항:
1. 랭킹 테이블에서 종목 클릭 → 슬라이드 패널이 오른쪽에서 밀려 나옴
2. AI 투자의견, 수급, 차트, 지표 등 모든 섹션 정상 표시
3. 관심종목 위젯에서 클릭 → 스켈레톤 → 데이터 로드
4. ESC/오버레이 클릭으로 닫기 동작
5. 포트폴리오/그룹 아코디언 펼칠 때 lazy fetch 동작

- [ ] **Step 6: 커밋**

```bash
git add -A
git commit -m "feat: 기존 모달 삭제 + 랭킹 테이블에서 initialData 전달"
```

---

## Task 8: 최종 빌드 검증 + lint

**Files:** 없음 (검증만)

- [ ] **Step 1: 프로덕션 빌드**

Run: `cd /Users/thlee/GoogleDrive/DashboardStock/web && npm run build 2>&1 | tail -20`
Expected: 빌드 성공

- [ ] **Step 2: lint**

Run: `cd /Users/thlee/GoogleDrive/DashboardStock/web && npm run lint 2>&1 | tail -20`
Expected: 에러 없음 (경고는 허용)

- [ ] **Step 3: 빌드/lint 실패 시 수정 후 커밋**

실패한 부분 수정 후:
```bash
git add -A
git commit -m "fix: 빌드/lint 오류 수정"
```
