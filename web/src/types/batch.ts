export type BatchMode = 'full' | 'repair' | 'prices-only';
export type BatchStatus = 'pending' | 'running' | 'done' | 'failed';
export type BatchTriggeredBy = 'schedule' | 'manual';

export interface BatchRun {
  id: string;
  workflow: string;
  mode: BatchMode;
  status: BatchStatus;
  triggered_by: BatchTriggeredBy;
  started_at: string;
  finished_at: string | null;
  summary: BatchSummary | null;
  created_at: string;
}

export interface BatchSummary {
  collected: number;
  scored: number;
  errors: string[];
}

export interface StockScore {
  symbol: string;
  scored_at: string;
  prev_close: number | null;
  score_value: number;
  score_growth: number;
  score_supply: number;
  score_momentum: number;
  score_risk: number;
  score_signal: number;
  updated_at: string;
}
