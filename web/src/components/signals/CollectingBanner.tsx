'use client';

import { useState, useEffect, useCallback } from 'react';

interface BatchRunStatus {
  collecting: boolean;
  status: 'pending' | 'running' | null;
  mode: string | null;
  triggered_by: string | null;
  started_at: string | null;
}

const MODE_LABEL: Record<string, string> = {
  full: '전체 배치',
  repair: '누락 보정',
  'prices-only': '현재가 갱신',
};

export function CollectingBanner() {
  const [batchStatus, setBatchStatus] = useState<BatchRunStatus | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/batch-runs/status');
      if (res.ok) {
        const data: BatchRunStatus = await res.json();
        setBatchStatus(data);
      }
    } catch {
      // 네트워크 오류 무시
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const id = setInterval(fetchStatus, 15_000);
    return () => clearInterval(id);
  }, [fetchStatus]);

  if (!batchStatus?.collecting) return null;

  const modeLabel = batchStatus.mode ? (MODE_LABEL[batchStatus.mode] ?? batchStatus.mode) : '';
  const isPending = batchStatus.status === 'pending';

  return (
    <div className="flex items-center gap-2 rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-sm text-blue-300 mb-3">
      <span className="relative flex h-2 w-2 shrink-0">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-400" />
      </span>
      <span>
        {isPending ? 'GHA 배치 대기 중' : 'GHA 수집 중'}
        {modeLabel && ` — ${modeLabel}`}
        {batchStatus.triggered_by === 'manual' && ' (수동 실행)'}
      </span>
    </div>
  );
}
