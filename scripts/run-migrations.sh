#!/bin/bash
# 프론트엔드 개편 관련 Supabase 마이그레이션 실행 스크립트
# 실행: bash scripts/run-migrations.sh

set -e

MIGRATIONS_DIR="supabase/migrations"
MIGRATIONS=(
  "014_market_indicators.sql"
  "015_watchlist.sql"
  "016_stock_cache.sql"
  "017_market_score_history.sql"
  "021_market_events.sql"
)

echo "=== Supabase 마이그레이션 실행 ==="
echo ""

# Supabase CLI 확인
if command -v supabase &> /dev/null; then
  echo "[방법 1] supabase db push 사용"
  echo "  cd $(pwd) && supabase db push"
  echo ""
fi

echo "[방법 2] 수동 실행 (Supabase Dashboard > SQL Editor)"
echo ""

for f in "${MIGRATIONS[@]}"; do
  filepath="$MIGRATIONS_DIR/$f"
  if [ -f "$filepath" ]; then
    echo "--- $f ---"
    echo "  파일: $filepath"
    echo ""
  else
    echo "  [경고] $filepath 파일을 찾을 수 없습니다"
  fi
done

echo "=== 마이그레이션 파일 목록 ==="
echo ""
echo "1. 014_market_indicators.sql - 시황 지표 테이블 + 가중치 기본값"
echo "2. 015_watchlist.sql         - 투자 워치리스트 테이블"
echo "3. 016_stock_cache.sql       - 종목 캐시 테이블 (인덱스 포함)"
echo "4. 017_market_score_history.sql - 시황 점수 이력 테이블"
echo "5. 021_market_events.sql       - 시장 이벤트 테이블 + market_score_history 확장"
echo ""
echo "위 순서대로 실행해주세요."
echo ""

# stock-init cron 실행 안내
echo "=== 초기 데이터 세팅 ==="
echo ""
echo "마이그레이션 완료 후 아래 API를 호출하여 stock_cache를 초기화하세요:"
echo "  curl -X POST https://YOUR_DOMAIN/api/v1/cron/stock-init"
echo ""
echo "시황 지표 수집:"
echo "  curl -X POST https://YOUR_DOMAIN/api/v1/cron/market-indicators"
echo ""
