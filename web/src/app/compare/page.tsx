import CompareClient from "./compare-client";

export const revalidate = 60;

export default function ComparePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">종목 비교</h1>
        <p className="text-sm text-[var(--muted)] mt-1">
          2~3개 종목의 차트와 투자지표를 비교 분석
        </p>
      </div>
      <CompareClient />
    </div>
  );
}
