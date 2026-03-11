// 신호 타입
export type SignalType = 'BUY' | 'SELL' | 'HOLD' | 'BUY_FORECAST' | 'SELL_COMPLETE';
export type SignalSource = 'lassi' | 'stockbot' | 'quant';
export type ExecutionType = 'lump' | 'split';

// DB 레코드
export interface Signal {
  id: string;
  created_at: string;
  timestamp: string;
  symbol: string | null;
  name: string;
  signal_type: SignalType;
  source: SignalSource;
  batch_id: string | null;
  is_fallback: boolean;
  raw_data: Record<string, unknown> | null;
  device_id: string | null;
}

// 수집기 → API 전송 포맷
export interface SignalBatchRequest {
  signals: SignalInput[];
  summary?: {
    total_signals: number;
    buy_count: number;
    sell_count: number;
  };
  device_id: string;
  batch_id: string;
}

export interface SignalInput {
  timestamp: string;
  symbol?: string;
  name: string;
  signal_type: SignalType;
  signal_price?: number | null;
  source: SignalSource;
  time_group?: string;
  is_fallback?: boolean;
  raw_data?: Record<string, unknown>;
}

// 즐겨찾기
export interface FavoriteStock {
  symbol: string;
  name: string;
  added_at: string;
  note: string | null;
}

// 일봉 가격
export interface DailyPrice {
  symbol: string;
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number | null;
}

// 종목 정보
export interface StockInfo {
  symbol: string;
  name: string;
  sector: string | null;
  market: string | null;
  updated_at: string;
}

// 가상 거래
export interface VirtualTrade {
  id: string;
  created_at: string;
  source: SignalSource;
  execution_type: ExecutionType;
  symbol: string;
  name: string | null;
  side: 'BUY' | 'SELL';
  price: number;
  quantity: number;
  split_seq: number | null;
  signal_id: string | null;
  trade_group_id: string | null;
  note: string | null;
}

// 분할매매 예약
export interface SplitTradeSchedule {
  id: string;
  trade_group_id: string;
  source: SignalSource;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  scheduled_date: string;
  split_seq: number;
  status: 'pending' | 'executed' | 'cancelled';
  executed_price: number | null;
  executed_at: string | null;
  signal_id: string | null;
}

// 포트폴리오 스냅샷
export interface PortfolioSnapshot {
  id: string;
  date: string;
  source: SignalSource;
  execution_type: ExecutionType;
  holdings: PortfolioHolding[];
  cash: number;
  total_value: number;
  daily_return_pct: number | null;
  cumulative_return_pct: number | null;
}

export interface PortfolioHolding {
  symbol: string;
  name: string;
  quantity: number;
  avg_price: number;
  current_price?: number;
}

// 수집기 상태
export interface CollectorHeartbeat {
  id: string;
  device_id: string;
  timestamp: string;
  status: string;
  last_signal: string | null;
  error_message: string | null;
}
