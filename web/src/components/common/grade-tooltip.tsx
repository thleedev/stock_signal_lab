'use client';

interface ScoreItem {
  label: string;
  value: number;
  color: string;
}

interface GradeTooltipProps {
  weighted: number;
  scores: ScoreItem[];
  grade: string;
  gradeLabel: string;
  gradeCls: string;
}

const THRESHOLDS = [
  { grade: 'A+', min: 90, label: '적극매수' },
  { grade: 'A', min: 80, label: '매수' },
  { grade: 'B+', min: 65, label: '관심' },
  { grade: 'B', min: 50, label: '보통' },
  { grade: 'C', min: 35, label: '관망' },
  { grade: 'D', min: 0, label: '주의' },
];

export function GradeTooltip({ grade, gradeLabel, gradeCls }: GradeTooltipProps) {
  return (
    <span className="shrink-0">
      <span className={`px-1.5 py-0.5 rounded text-[11px] font-bold leading-none ${gradeCls}`}>
        {grade} {gradeLabel}
      </span>
    </span>
  );
}
