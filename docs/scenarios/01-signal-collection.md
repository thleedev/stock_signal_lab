# 시나리오 01 — 신호 수집

> 증권사 앱의 매매신호가 DB에 저장되고 후처리가 완료되기까지의 흐름입니다.
> 관련 문서: 02(수집기), 03(DB), 04(API)

## 트리거별 경로

| 경로 | 발생 시점 | 종착 |
|------|-----------|------|
| SMS 실시간 | 키움 SMS 수신 즉시 | `upsert_signals_bulk` RPC |
| 라씨 화면 스크래핑 | 라씨 푸시 감지 시 자동, 17:00 알람, 수동 버튼 | 같음 |
| 알파캐치 화면 스크래핑 | 17:00 알람 (라씨 완료 5초 후), 수동 | RPC + `alphacatch_holdings` |
| 텔레그램 웹훅 | PRIZM 채널 포워딩, `[SIGNAL_BATCH]` 우회 | RPC |
| 웹 API | 수집기가 `POST /api/v1/signals/batch` 호출 | `signals` 테이블 |

## 기본 흐름 — SMS 수신

1. 키움에서 SMS가 도착하면 `SmsReceiver`가 멀티파트를 결합합니다.
2. `SmsRouter.identify()`가 본문 헤더로 소스를 판별합니다. 우선순위는 STOCKBOT → ALPHACATCH → QUANT → LASSI → UNKNOWN이며, 라씨 SMS는 화면 스크래핑 전용 정책이라 무시합니다.
3. 원문을 `mms_raw_messages`에 보관합니다. 이 테이블은 pg_cron이 7일 주기로 정리하며 일간 리포트가 참조합니다.
4. 파서가 `SignalInput` 목록을 만들고, `SentSignalCache`가 당일 중복을 제거합니다.
5. `sendSignals()`가 `upsert_signals_bulk` RPC를 호출합니다. 전송 실패 시 Room 오프라인 큐에 넣고 5분 주기로 재시도합니다.

## 기본 흐름 — 화면 스크래핑

1. 영웅문 푸시에서 "라씨매매" 키워드를 감지하면 3분 쿨다운을 확인하고 접근성 서비스가 앱을 실행합니다.
2. 상태머신이 AI매매신호 메뉴 진입 → 매수 탭 수집 → 매도 탭 수집을 진행합니다. 화면 상단의 "매수 N / 매도 M" 숫자를 목표치로 삼아 스크롤합니다.
3. 장중 화면은 "22분전" 같은 상대시간만 보여 주므로 `signal_time`을 null로 저장합니다.
4. 매 영업일 17:00 알람이 보정 모드 스크래핑을 실행해 절대시간을 `PATCH /rest/v1/signals`로 채웁니다. 이어서 알파캐치 화면을 수집합니다.

## 서버 저장 규칙

`upsert_signals_bulk` RPC와 `signals/batch` API는 같은 원칙을 공유합니다.

- 중복 기준: (symbol, source, signal_type, KST 날짜) 하루 1행. 충돌 시 `signal_time = COALESCE(new, existing)`으로 시간만 병합합니다.
- 승격 규칙: quant BUY가 도착하면 같은 종목의 당일 BUY_FORECAST 행을 BUY로 UPDATE하고 `upgraded_from`을 기록합니다.
- `signals` INSERT 트리거가 `stock_cache`의 `latest_signal_*`·`latest_sell_*` 컬럼을 즉시 동기화하고, 생성 컬럼 `has_active_sell`이 재계산됩니다.

## 후처리 — signals/batch 비동기 4종

응답을 막지 않고 네 가지를 실행합니다.

1. 전략 엔진 `processSignal`: 소스별 가상 포트폴리오에 일시·분할 매매를 기록합니다 (시나리오 05).
2. FCM 푸시: `notification_rules` 조건을 통과하면 등록 토큰 전체에 알림을 보냅니다 (시나리오 07).
3. `enrichSignalStocks`: BUY 종목의 수급·일봉·컨센서스·DART 정보를 네이버·DART에서 즉시 수집해 `stock_cache`·`daily_prices`·`stock_dart_info`를 채웁니다.
4. `cron/intraday-prices` 호출: 10분 디바운스 하에 전종목 시세를 갱신합니다.

## 예외·복구

- 수집기 오류: 접근성 서비스가 실패하면 `collector_heartbeats`에 error 하트비트를 남기고, `/collector` 화면과 설정 페이지가 10분 기준으로 온라인 여부를 표시합니다.
- 텔레그램 우회: `[SIGNAL_BATCH]` 경로는 `signals/batch`의 대체 유입 경로로, 성공 시 AI 추천 재생성을 트리거합니다.
- 오수집 복구: 과거 오수집은 마이그레이션(075·076)으로 삭제한 뒤 재수집했습니다.
