"use client";

import { useEffect } from "react";

export default function StocksError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[StocksError]", error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[40vh] gap-4">
      <h2 className="text-lg font-semibold">종목 데이터를 불러올 수 없습니다</h2>
      <p className="text-sm text-[var(--muted)]">{error.message}</p>
      <button
        onClick={reset}
        className="px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90"
      >
        다시 시도
      </button>
    </div>
  );
}
