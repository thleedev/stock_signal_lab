# 시나리오 07 — 알림과 일간 리포트

> 신호가 푸시 알림으로 전달되고 하루가 리포트로 정리되는 흐름입니다.
> 관련 문서: 06(외부 연동 §7), 04(API), 08(프론트엔드)

## 푸시 알림 흐름

1. `signals/batch`가 신호 저장 직후 비동기로 `sendSignalNotification()`을 호출합니다.
2. `notification_rules`의 활성 규칙을 확인합니다. 활성 규칙이 하나도 없으면 모든 신호에 알림을 보내고, 규칙이 있으면 source·signal_type 조건과 맞는 규칙이 있어야 발송합니다.
3. `fcm_tokens`의 전체 토큰에 순차 전송합니다. 제목은 "{매수|매도|매수 예고|매도 완료} 신호 - {종목명}" 형식입니다.
4. 인증은 서비스 계정 JSON을 base64로 받아 RS256 JWT를 자체 서명하고 Google OAuth2 토큰으로 교환하는 방식이며 외부 SDK를 쓰지 않습니다. 환경변수가 없으면 콘솔 로그로 폴백합니다.

토큰 등록은 `POST /api/v1/notifications/token`(device_id 기준 upsert), 규칙 관리는 `notifications/rules`가 담당합니다. 설정 화면의 알림 섹션은 규칙을 읽기 전용으로 보여 줍니다.

## 수집기 상태 알림

수집기는 신호 전송 성공 시 active, 스크래핑 오류 시 error 하트비트를 `collector_heartbeats`에 남깁니다. `/collector` 화면과 설정 페이지가 10분 기준으로 온라인 여부를 판정해 표시합니다. 별도 푸시 경보는 없습니다.

## 일간 리포트 흐름

`/reports` 화면이 날짜별로 원천 4곳의 데이터를 모아 하루를 정리합니다.

| 섹션 | 원천 |
|------|------|
| 소스별 신호 요약·신호 목록 | `signals` (KST 하루 범위) |
| 투자자 매매동향 | `daily_report_summary.investor_trends` (KOSPI·KOSDAQ 외국인/기관/개인) |
| AI 일간 분석 | `daily_report_summary.ai_summary` (`## ` 헤더 단위 섹션 렌더) + `market_score` 배지 |
| MMS 원문 | `mms_raw_messages` (7일 보관분) |
| 일간 통계 | `daily_signal_stats` (적중률·평균수익률) |

`daily_report_summary`는 020~027 마이그레이션에서 설계된 테이블이지만, 현재 코드베이스에는 이 테이블을 채우는 쓰기 코드가 없습니다. `lib/ai/`의 Gemini 프로바이더도 정의만 있고 호출처가 없어, ai_summary 생성 경로가 유실된 상태입니다. 리포트 화면은 저장된 값이 있으면 렌더하고 없으면 해당 섹션을 생략합니다.

## 텔레그램 수신 경로

텔레그램은 알림 발신에는 쓰지 않고 수신 경로로만 씁니다. PRIZM 채널 메시지(`#프리즘인사이트` 또는 `@stock_ai_ko` 포워딩)를 웹훅이 파싱해 신호로 저장하고, `[SIGNAL_BATCH]` 프리픽스 메시지는 수집기의 우회 유입 경로가 됩니다. 웹훅에서 사용자에게 답장을 보내는 로직은 없습니다.
