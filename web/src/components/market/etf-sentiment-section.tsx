"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { Settings, ChevronDown, ChevronUp, TrendingUp, TrendingDown, AlertTriangle, Minus } from "lucide-react";
import {
  type SectorSentiment, type EtfSignalInfo, type SentimentLabel,
  type ClassifiedEtf, type EtfOverrides,
  applyOverrides, calculateSectorSentiments,
} from "@/lib/etf-sentiment";
import { EtfOverrideModal } from "./etf-override-modal";

const SENTIMENT_CONFIG: Record<SentimentLabel, { label: string; color: string; bg: string; text: string; border: string }> = {
  strong_positive: { label: "강한 긍정", color: "#10b981", bg: "bg-emerald-900/20", text: "text-emerald-400", border: "border-emerald-800/40" },
  positive:        { label: "긍정",     color: "#22c55e", bg: "bg-green-900/20",   text: "text-green-400",   border: "border-green-800/40" },
  caution:         { label: "주의",     color: "#eab308", bg: "bg-yellow-900/20",  text: "text-yellow-400",  border: "border-yellow-800/40" },
  neutral:         { label: "중립",     color: "#6b7280", bg: "bg-gray-900/20",    text: "text-gray-400",    border: "border-gray-800/40" },
  negative:        { label: "부정",     color: "#f97316", bg: "bg-orange-900/20",  text: "text-orange-400",  border: "border-orange-800/40" },
  strong_negative: { label: "강한 부정", color: "#ef4444", bg: "bg-red-900/20",     text: "text-red-400",     border: "border-red-800/40" },
};

function SentimentBadge({ sentiment }: { sentiment: SentimentLabel }) {
  const c = SENTIMENT_CONFIG[sentiment];
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold border ${c.bg} ${c.text} ${c.border}`}>
      {c.label}
    </span>
  );
}

function SentimentIcon({ sentiment }: { sentiment: SentimentLabel }) {
  if (sentiment === "strong_positive" || sentiment === "positive")
    return <TrendingUp className="w-5 h-5 text-emerald-400" />;
  if (sentiment === "strong_negative" || sentiment === "negative")
    return <TrendingDown className="w-5 h-5 text-red-400" />;
  if (sentiment === "caution")
    return <AlertTriangle className="w-5 h-5 text-yellow-400" />;
  return <Minus className="w-5 h-5 text-gray-400" />;
}

function SentimentBanner({
  overallSentiment, overallLabel, sectorCount,
}: {
  overallSentiment: number;
  overallLabel: SentimentLabel;
  sectorCount: number;
}) {
  const c = SENTIMENT_CONFIG[overallLabel];
  return (
    <div
      className="card p-5 flex items-center gap-4"
      style={{ borderColor: c.color + "60", background: c.color + "08" }}
    >
      <SentimentIcon sentiment={overallLabel} />
      <div className="flex-1">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xl font-bold" style={{ color: c.color }}>{c.label}</span>
          <span className="text-2xl font-black tabular-nums" style={{ color: c.color }}>
            {overallSentiment > 0 ? "+" : ""}{overallSentiment.toFixed(2)}
          </span>
        </div>
        <p className="text-sm text-[var(--muted)] mt-1">
          {sectorCount}개 섹터 ETF 신호 기반 시장 센티먼트
        </p>
      </div>
    </div>
  );
}

function SectorCard({ sector }: { sector: SectorSentiment }) {
  const [expanded, setExpanded] = useState(false);
  const c = SENTIMENT_CONFIG[sector.sentiment];
  const maxScore = Math.max(sector.bullScore, sector.bearScore, 0.01);

  return (
    <div className="border-b border-[var(--border)] last:border-b-0">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 flex items-center gap-3 hover:bg-[var(--card-hover)] transition-colors"
      >
        <SentimentBadge sentiment={sector.sentiment} />
        <span className="font-medium text-sm flex-1 text-left">{sector.label}</span>

        <div className="flex items-center gap-1 w-32">
          <div className="flex-1 h-2 rounded-full bg-[var(--border)] overflow-hidden">
            <div
              className="h-full rounded-full bg-emerald-500"
              style={{ width: `${(sector.bullScore / maxScore) * 100}%` }}
            />
          </div>
          <div className="flex-1 h-2 rounded-full bg-[var(--border)] overflow-hidden">
            <div
              className="h-full rounded-full bg-red-500 ml-auto"
              style={{ width: `${(sector.bearScore / maxScore) * 100}%` }}
            />
          </div>
        </div>

        <span className="text-xs tabular-nums w-12 text-right" style={{ color: c.color }}>
          {sector.netSentiment > 0 ? "+" : ""}{sector.netSentiment.toFixed(2)}
        </span>

        {expanded ? <ChevronUp className="w-4 h-4 text-[var(--muted)]" /> : <ChevronDown className="w-4 h-4 text-[var(--muted)]" />}
      </button>

      {expanded && (
        <div className="px-4 pb-3 space-y-1">
          {sector.etfs.map((etf, i) => (
            <EtfRow key={`${etf.symbol ?? etf.name}-${i}`} etf={etf} />
          ))}
        </div>
      )}
    </div>
  );
}

function EtfRow({ etf }: { etf: EtfSignalInfo }) {
  const typeLabel = etf.type === 'leverage' ? '레버리지' : etf.type === 'inverse' ? '인버스' : '일반';
  const sideColor = etf.side === 'bull' ? 'text-emerald-400' : 'text-red-400';

  return (
    <div className="flex items-center gap-2 text-xs py-1 px-2 rounded hover:bg-[var(--card-hover)]">
      <span className={`w-2 h-2 rounded-full ${etf.held ? (etf.side === 'bull' ? 'bg-emerald-400' : 'bg-red-400') : 'bg-gray-600'}`} />
      <span className="flex-1 truncate">{etf.name}</span>
      <span className={`${sideColor} w-14`}>{typeLabel}</span>
      <span className={`w-10 text-center ${etf.held ? 'text-white font-medium' : 'text-[var(--muted)]'}`}>
        {etf.held ? '보유' : '미보유'}
      </span>
      <span className="text-[var(--muted)] w-16 text-right tabular-nums">
        {etf.finalWeight.toFixed(3)}
      </span>
      <span className="text-[var(--muted)] w-20 text-right">
        {etf.lastSignalDate.slice(0, 10)}
      </span>
    </div>
  );
}

function OtherSectorsCard({ merged, subSectors }: { merged: SectorSentiment; subSectors: SectorSentiment[] }) {
  const [expanded, setExpanded] = useState(false);
  const c = SENTIMENT_CONFIG[merged.sentiment];
  const maxScore = Math.max(merged.bullScore, merged.bearScore, 0.01);

  return (
    <div className="border-b border-[var(--border)] last:border-b-0">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 flex items-center gap-3 hover:bg-[var(--card-hover)] transition-colors"
      >
        <SentimentBadge sentiment={merged.sentiment} />
        <span className="font-medium text-sm flex-1 text-left">{merged.label}</span>

        <div className="flex items-center gap-1 w-32">
          <div className="flex-1 h-2 rounded-full bg-[var(--border)] overflow-hidden">
            <div className="h-full rounded-full bg-emerald-500" style={{ width: `${(merged.bullScore / maxScore) * 100}%` }} />
          </div>
          <div className="flex-1 h-2 rounded-full bg-[var(--border)] overflow-hidden">
            <div className="h-full rounded-full bg-red-500 ml-auto" style={{ width: `${(merged.bearScore / maxScore) * 100}%` }} />
          </div>
        </div>

        <span className="text-xs tabular-nums w-12 text-right" style={{ color: c.color }}>
          {merged.netSentiment > 0 ? "+" : ""}{merged.netSentiment.toFixed(2)}
        </span>

        {expanded ? <ChevronUp className="w-4 h-4 text-[var(--muted)]" /> : <ChevronDown className="w-4 h-4 text-[var(--muted)]" />}
      </button>

      {expanded && (
        <div className="px-2 pb-3">
          {subSectors.map((sub) => (
            <div key={sub.label} className="mb-2">
              <div className="flex items-center gap-2 px-2 py-1.5">
                <SentimentBadge sentiment={sub.sentiment} />
                <span className="text-xs font-medium flex-1">{sub.label}</span>
                <span className="text-xs tabular-nums text-[var(--muted)]">
                  {sub.netSentiment > 0 ? "+" : ""}{sub.netSentiment.toFixed(2)}
                </span>
              </div>
              <div className="pl-2">
                {sub.etfs.map((etf) => (
                  <EtfRow key={`${etf.name}-${etf.symbol ?? etf.lastSignalDate}`} etf={etf} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface EtfSentimentSectionProps {
  rawEtfs: ClassifiedEtf[];
  sectors: Record<string, SectorSentiment>;
  overallSentiment: number;
  overallLabel: SentimentLabel;
}

export function EtfSentimentSection({
  rawEtfs: initialRawEtfs,
  sectors: initialSectors,
  overallSentiment: initialOverall,
  overallLabel: initialLabel,
}: EtfSentimentSectionProps) {
  const [showModal, setShowModal] = useState(false);
  const [overrides, setOverrides] = useState<EtfOverrides>({});

  useEffect(() => {
    try {
      const stored = localStorage.getItem("etf-sector-overrides");
      if (stored) setOverrides(JSON.parse(stored));
    } catch {}
  }, []);

  const { sectors, overallSentiment, overallLabel } = useMemo(() => {
    if (Object.keys(overrides).length === 0) {
      return { sectors: initialSectors, overallSentiment: initialOverall, overallLabel: initialLabel };
    }
    const adjusted = applyOverrides(initialRawEtfs, overrides);
    return calculateSectorSentiments(adjusted);
  }, [initialRawEtfs, initialSectors, initialOverall, initialLabel, overrides]);

  // 주요 섹터 (ETF 3개 이상) vs 기타 (2개 이하)
  const MIN_SECTOR_SIZE = 3;

  const { mainSectors, otherSectors, otherMerged } = useMemo(() => {
    const all = Object.values(sectors);
    const main: SectorSentiment[] = [];
    const other: SectorSentiment[] = [];
    for (const s of all) {
      if (s.etfs.length >= MIN_SECTOR_SIZE) main.push(s);
      else other.push(s);
    }
    main.sort((a, b) => a.netSentiment - b.netSentiment);
    other.sort((a, b) => a.netSentiment - b.netSentiment);

    // "기타" 합산 센티먼트
    const otherEtfs = other.flatMap((s) => s.etfs);
    const otherBull = other.reduce((sum, s) => sum + s.bullScore, 0);
    const otherBear = other.reduce((sum, s) => sum + s.bearScore, 0);
    const otherNet = otherBull - otherBear;
    const otherActive = otherBull > 0 || otherBear > 0;
    const merged: SectorSentiment | null = other.length > 0 ? {
      label: `기타 (${other.length}개 섹터)`,
      bullScore: Math.round(otherBull * 1000) / 1000,
      bearScore: Math.round(otherBear * 1000) / 1000,
      netSentiment: Math.round(otherNet * 1000) / 1000,
      sentiment: !otherActive ? 'neutral' : otherNet >= 1 ? 'strong_positive' : otherNet > 0 ? 'positive' : otherNet <= -1 ? 'strong_negative' : otherNet < 0 ? 'negative' : 'caution',
      hasActivePositions: otherActive,
      etfs: otherEtfs,
    } : null;

    return { mainSectors: main, otherSectors: other, otherMerged: merged };
  }, [sectors]);

  const handleSaveOverrides = useCallback((newOverrides: EtfOverrides) => {
    setOverrides(newOverrides);
    localStorage.setItem("etf-sector-overrides", JSON.stringify(newOverrides));
  }, []);

  const totalSectorCount = mainSectors.length + otherSectors.length;

  if (totalSectorCount === 0) return null;

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">ETF 신호 기반 시장 센티먼트</h2>
        <button
          onClick={() => setShowModal(true)}
          className="p-1.5 rounded-lg hover:bg-[var(--card-hover)] transition-colors"
          title="섹터 매핑 관리"
        >
          <Settings className="w-4 h-4 text-[var(--muted)]" />
        </button>
      </div>

      <SentimentBanner
        overallSentiment={overallSentiment}
        overallLabel={overallLabel}
        sectorCount={totalSectorCount}
      />

      <div className="card mt-4 overflow-hidden">
        {mainSectors.map((sector) => (
          <SectorCard key={sector.label} sector={sector} />
        ))}
        {otherMerged && (
          <OtherSectorsCard merged={otherMerged} subSectors={otherSectors} />
        )}
      </div>

      {showModal && (
        <EtfOverrideModal
          rawEtfs={initialRawEtfs}
          overrides={overrides}
          onSave={handleSaveOverrides}
          onClose={() => setShowModal(false)}
        />
      )}
    </section>
  );
}
