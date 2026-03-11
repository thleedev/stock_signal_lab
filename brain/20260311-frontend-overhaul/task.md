# 프론트엔드 전면 개편 - AI 매매신호 대시보드

## Phase 1: 계획 수립
- [x] 프로젝트 구조 분석 (DB 스키마, API, 기존 페이지)
- [x] 투자 시황 점수 산출 모델 연구
- [x] Implementation Plan 작성 및 사용자 리뷰

## Phase 2: 백엔드 (DB + API) 확장
- [x] Supabase 마이그레이션: `market_indicators`, `indicator_weights`, `watchlist`, `stock_cache`, `market_score_history` 테이블 추가
- [x] KIS API 확장: 전 종목 현재가, 투자지표(PER/PBR/ROE/EPS/BPS) 조회
- [x] 투자 시황 지표 수집 API (Yahoo Finance + 시황 점수 계산)
- [x] 관심종목(watchlist) CRUD API
- [x] 전 종목 목록 + 필터 API
- [x] 종목 실시간 조회 API (On-Demand + 캐시)
- [x] Cron: 시황 지표 수집, 전종목 배치 갱신, 초기 세팅

## Phase 3: 프론트엔드 전면 개편
- [x] 디자인 시스템 구축 (다크 프리미엄 테마)
- [x] 레이아웃 및 네비게이션 (사이드바 + 모바일 탭바)
- [x] 전 종목 리스트 페이지 (필터, 정렬, 관심종목 상단 고정)
- [x] 투자 시황 점수 대시보드 (게이지 + 가중치 슬라이더)
- [x] 투자 종목 탭 (종목 검색/추가/제거, 실시간 지표)
- [x] 대시보드 개편 (시황 미니 게이지, 관심종목 현황)
- [x] 기존 페이지 다크 테마 적용 (signals, stock detail, portfolio, settings, performance, collector, reports)

## Phase 4: 검증
- [x] 빌드 테스트 (성공)
- [ ] 브라우저 기능 검증
- [ ] 모바일 반응형 확인
