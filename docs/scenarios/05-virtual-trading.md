# 시나리오 05 — 가상매매 시뮬레이션

> 수집된 신호가 소스별 가상 포트폴리오의 거래·성과로 이어지는 흐름입니다.
> 관련 문서: 06(외부 연동 §8), 03(DB), 08(프론트엔드)

## 자금 설정 (`PORTFOLIO_CONFIG`)

| 항목 | 값 |
|------|-----|
| 소스별 초기 자금 | 1,000만원 (일시 500만 + 분할 500만) |
| 전략별 자본 | 500만원 |
| 종목당 최대 비중 | 20% (최대 100만원) |
| 분할 횟수 | 3회 |

## 기본 흐름 — 신호 수신 시

1. `signals/batch`가 비동기로 `processSignal`을 호출합니다.
2. 진입 필터: lassi 신호는 `favorite_stocks` 등록 종목만, stockbot·quant는 전 종목을 처리합니다.
3. 신호 타입을 방향으로 바꿉니다. BUY·BUY_FORECAST는 매수, SELL·SELL_COMPLETE는 매도입니다.
4. 가격은 raw_data에서 `signal_price → recommend_price → buy_price → sell_price → price → current_price` 순으로 추출합니다.
5. 두 전략을 동시에 실행합니다.
   - 일시매매(lump): 전량 1회 체결. 이미 보유 중이면 매수 스킵, 미보유면 매도 스킵.
   - 분할매매(split): 1/3 즉시 체결 + 2·3회차를 D+1·D+2 시가로 `split_trade_schedule`에 예약. 주말은 다음 영업일로 이동. 총수량 3 미만이면 스킵.
6. 체결은 `virtual_trades`에 기록되며 `signal_id`로 원 신호와 연결됩니다.

## 성과 집계

- 포트폴리오 평가: 현금 = 500만 − 매수총액 + 매도총액, 평가액은 `stock_cache.current_price` 우선·일봉 종가 폴백.
- 일별 스냅샷: `portfolio_snapshots`(소스×실행방식)와 `combined_portfolio_snapshots`(통합)에 누적·일별 수익률을 저장합니다.
- 신호 통계: `daily_signal_stats`에 일별 신호 수·적중률·평균 수익률이 남습니다.

## 화면 반영

1. 대시보드 소스별 카드: 최신 lump 스냅샷의 수익률을 보여 줍니다.
2. `/portfolio`: 전략 탭(일시/분할), 총 평가액, 30일 일별 수익률 차트, 소스별 성과 카드, 보유 종목 목록.
3. `/portfolio/[source]`: 소스별 lump·split 비교, 보유 테이블, 최근 거래 20건(분할 회차 표기).
4. `/reports`의 일간 통계 테이블이 `daily_signal_stats`를 사용합니다.

## 알려진 한계

- 분할매매 2·3회차 예약(`split_trade_schedule`)을 실행하는 스케줄러 연결은 현재 코드베이스에서 확인되지 않습니다. 예약 레코드는 pending 상태로 남습니다.
- 사용자 포트폴리오 스냅샷 크론(`cron/user-portfolio-snapshot`)도 호출자가 없는 미연결 상태입니다 (시나리오 06 참조).
