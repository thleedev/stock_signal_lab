-- 워치리스트에 손절가, 목표가 컬럼 추가
ALTER TABLE watchlist ADD COLUMN IF NOT EXISTS stop_loss_price INTEGER;
ALTER TABLE watchlist ADD COLUMN IF NOT EXISTS target_price INTEGER;
