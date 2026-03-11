-- 관심종목 그룹 기능
ALTER TABLE favorite_stocks ADD COLUMN IF NOT EXISTS group_name TEXT DEFAULT '기본';

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_favorite_stocks_group ON favorite_stocks(group_name);
