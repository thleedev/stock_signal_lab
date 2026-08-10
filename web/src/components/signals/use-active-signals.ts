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
 * initial 배열의 내용을 비교하기 위한 서명입니다. symbol 목록만 이어붙여도
 * 순서·구성 변화를 충분히 잡아내고, 200행 규모에서 비용도 무시할 만합니다.
 */
function signatureOf(rows: Row[]): string {
  return rows.map((r) => r.symbol).join(",");
}

/**
 * 서버가 보낸 최초 목록 뒤를 이어받습니다.
 *
 * initial 은 router.refresh() 가 일어날 때마다(장중 자동 새로고침뿐 아니라
 * 즐겨찾기·포트폴리오 조작 등 페이지 어디서든) 새 배열 참조로 내려옵니다.
 * 참조만 보고 리셋하면 실제 신호 데이터는 그대로인데도 이어받은 분량이
 * 날아가므로, symbol 구성이 실제로 달라졌을 때만 리셋합니다.
 * loadAll 은 요약·업종 뷰가 전량을 필요로 할 때 씁니다.
 */
export function useActiveSignals(initial: Row[], total: number, type: "buy" | "sell", enabled: boolean) {
  const [rows, setRows] = useState<Row[]>(initial);
  const [loading, setLoading] = useState(false);
  const [complete, setComplete] = useState(false);
  // 이어받기·전량 로드 도중 요청이 실패했음을 나타냅니다. 재시도 수단은 없고,
  // 호출부가 "일부만 불러왔다"는 사실을 사용자에게 알리는 데만 씁니다.
  const [error, setError] = useState(false);
  const loadingRef = useRef(false);
  const initialSignatureRef = useRef(signatureOf(initial));

  // 서버 데이터의 symbol 구성이 실제로 바뀐 경우에만 이어받은 분량을 리셋합니다.
  useEffect(() => {
    const signature = signatureOf(initial);
    if (signature === initialSignatureRef.current) return;
    initialSignatureRef.current = signature;
    setRows(initial);
    setComplete(false);
    setError(false);
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
      setError(true);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [enabled, type, rows.length]);

  const loadAll = useCallback(async () => {
    if (!enabled || loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    // catch 블록에서도 "지금까지 받은 만큼"을 반영해야 하므로 try 밖에 둡니다.
    let acc = rows;
    try {
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
      // complete 를 true 로 만들지 않으면 호출부의 effect 가 재실행되지 않아
      // "집계 중" 문구에 무한정 멈춥니다. 지금까지 받은 acc 만이라도 반영하고
      // error 로 실패 사실을 알립니다.
      setRows(acc);
      setComplete(true);
      setError(true);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [enabled, type, rows]);

  return { rows, loading, hasMore, loadMore, loadAll, complete, error };
}
