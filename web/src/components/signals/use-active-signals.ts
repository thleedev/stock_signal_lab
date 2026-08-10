"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { mergeSignals } from "./merge-signals";

type Row = Record<string, string>;
// mergeSignals 는 symbol 이 명시된 타입을 요구합니다. Row 는 인덱스 시그니처만
// 있어 symbol 이 실제로 존재해도 타입상 보장되지 않으므로 병합 시점에만 단언합니다.
type RowWithSymbol = Row & { symbol: string };

const PAGE_SIZE = 200;
const FULL_PAGE_SIZE = 1000;

async function fetchPage(type: "buy" | "sell", offset: number, limit: number) {
  const res = await fetch(`/api/v1/signals/active?type=${type}&offset=${offset}&limit=${limit}`);
  if (!res.ok) throw new Error(`활성 신호 조회 실패: ${res.status}`);
  return (await res.json()) as { items: Row[]; total: number; hasMore: boolean };
}

/**
 * 서버가 보낸 최초 목록 뒤를 이어받습니다.
 *
 * initial 이 바뀌면(서버 재검증) 이어받은 분량을 버리고 처음부터 다시 시작합니다.
 * loadAll 은 요약·업종 뷰가 전량을 필요로 할 때 씁니다.
 */
export function useActiveSignals(initial: Row[], total: number, type: "buy" | "sell", enabled: boolean) {
  const [rows, setRows] = useState<Row[]>(initial);
  const [loading, setLoading] = useState(false);
  const [complete, setComplete] = useState(false);
  const loadingRef = useRef(false);

  // 서버 데이터가 갱신되면 이어받은 분량을 리셋합니다.
  useEffect(() => {
    setRows(initial);
    setComplete(false);
  }, [initial]);

  const hasMore = enabled && !complete && rows.length < total;

  const loadMore = useCallback(async () => {
    if (!enabled || loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      const page = await fetchPage(type, rows.length, PAGE_SIZE);
      setRows((prev) => mergeSignals(prev as RowWithSymbol[], page.items as RowWithSymbol[]));
      if (!page.hasMore) setComplete(true);
    } catch (e) {
      console.error("[useActiveSignals] 이어받기 실패:", e);
      setComplete(true);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [enabled, type, rows.length]);

  const loadAll = useCallback(async () => {
    if (!enabled || loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      let acc = rows;
      let offset = acc.length;
      // 총계까지 1000행씩 채웁니다. 서버가 hasMore=false 를 주면 멈춥니다.
      for (;;) {
        const page = await fetchPage(type, offset, FULL_PAGE_SIZE);
        acc = mergeSignals(acc as RowWithSymbol[], page.items as RowWithSymbol[]);
        offset = acc.length;
        if (!page.hasMore || page.items.length === 0) break;
      }
      setRows(acc);
      setComplete(true);
    } catch (e) {
      console.error("[useActiveSignals] 전량 로드 실패:", e);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [enabled, type, rows]);

  return { rows, loading, hasMore, loadMore, loadAll, complete };
}
