"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[GlobalError]", error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
      <div className="text-4xl">⚠️</div>
      <h2 className="text-lg font-semibold">문제가 발생했습니다</h2>
      <p className="text-sm text-[var(--muted)] max-w-md text-center">
        {error.message || "알 수 없는 오류가 발생했습니다."}
      </p>
      <button
        onClick={reset}
        className="px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 transition-opacity"
      >
        다시 시도
      </button>
    </div>
  );
}
