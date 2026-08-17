# DashboardStock 문서

> 프로젝트 전수조사(2026-07-22)를 바탕으로 작성한 구현·시나리오 문서 모음입니다.
> 코드와 문서가 어긋나면 코드가 우선이며, 구조 변경 시 해당 문서를 함께 갱신합니다.

## 구현 문서

| 문서 | 내용 |
|------|------|
| [01-overview.md](01-overview.md) | 서비스 목적, 구성 요소, 신호 소스, 데이터 흐름, 인증 구조 |
| [02-android-collector.md](02-android-collector.md) | Android 수집기 — 수집 경로 4종, 파서 6종, 오프라인 큐, 서버 통신 |
| [03-database.md](03-database.md) | 테이블 38개 스키마, 함수·트리거, pg_cron, dedup 변천사, RLS |
| [04-api-reference.md](04-api-reference.md) | route.ts 55개·핸들러 70개, 인증 체계, 캐싱 TTL |
| [05-batch-automation.md](05-batch-automation.md) | GitHub Actions daily-batch(step1~10), 스케줄, 관측 체계 |
| [06-external-data.md](06-external-data.md) | 네이버·KRX·KIS·DART·Yahoo·FRED·FCM 연동과 환경변수 |
| [07-scoring.md](07-scoring.md) | 스코어링 엔진 4계열 가중치·규칙, 기존 문서와의 불일치 |
| [08-frontend.md](08-frontend.md) | 라우트 13개, 레이아웃, 데이터 로딩 훅, 화면별 상세 |
| [11-ai-agent-access-guide.md](11-ai-agent-access-guide.md) | 외부 AI(Claude·Gemini·Grok 등) REST 조회 연동 가이드 |

## 시나리오 문서 (`scenarios/`)

| 시나리오 | 내용 |
|----------|------|
| [01-signal-collection.md](scenarios/01-signal-collection.md) | 신호 수집 — SMS·스크래핑·텔레그램 → DB 저장 → 후처리 |
| [09-lassi-api-reverse-engineering.md](09-lassi-api-reverse-engineering.md) | 라씨 Thinkpool API 역분석 (접근성 대체) |
| [10-alphacatch-api-investigation.md](10-alphacatch-api-investigation.md) | 알파캐치 API 조사 (공개 API 없음 → 앱 캡처) |
| [tools/traffic-capture/RUNBOOK.md](../tools/traffic-capture/RUNBOOK.md) | 기기 HTTPS 트래픽 캡처 런북 |
| [02-daily-batch.md](scenarios/02-daily-batch.md) | 일일 배치 — 하루 타임라인과 full 파이프라인 |
| [03-market-analysis.md](scenarios/03-market-analysis.md) | 시황 분석 — 지표 수집 → 위험 지수 → 화면 |
| [04-recommendation.md](scenarios/04-recommendation.md) | 종목추천 — 신호 후보 → 스코어링 → 추천·랭킹 |
| [05-virtual-trading.md](scenarios/05-virtual-trading.md) | 가상매매 — 신호 자동 매매 → 성과 집계 |
| [06-user-portfolio.md](scenarios/06-user-portfolio.md) | 사용자 포트폴리오 — 수동 기록 → 모니터링 → 청산 |
| [07-notification-report.md](scenarios/07-notification-report.md) | 알림·리포트 — FCM 푸시와 일간 리포트 |

## 기존 문서 안내

| 문서 | 상태 |
|------|------|
| `initPlan.md` | 최초 기획 초안. 역사 자료로 보존 (기술 스택 등 일부는 미채택) |
| `scoring-logic.md` (2026-03-27) | v2 개편 미반영 구버전. 현행 수치는 [07-scoring.md](07-scoring.md) 참조 |
| `scoring-system.md` (2026-03-25) | 폐기 수준 구버전. 문서가 설명하는 체계가 코드에 없음 |
| `sms_expample.md` | 수집 대상 SMS 실물 예시 (파서 개발 참고 자료) |
| `prizm_example` | PRIZM 텔레그램 메시지 실물 예시 (웹훅 파서 참고 자료) |
| `superpowers/` | 기능별 개발 계획·설계 이력 52건 (plans 26 + specs 26) |

## 전수조사에서 확인한 미해결 사항

구현 문서 각 절의 "특이사항"을 모은 요약입니다. 우선순위 판단은 별도 논의가 필요합니다.

1. `cron/user-portfolio-snapshot` 미연결 — 사용자 포트 성과 스냅샷이 자동 적재되지 않습니다.
2. `split_trade_schedule` 실행자 부재 — 분할매매 2·3회차 예약이 pending으로 남습니다.
3. `daily_report_summary` 쓰기 코드 부재 — 일간 리포트의 AI 분석·투자자 동향 섹션이 채워지지 않습니다.
4. Android `LassiSmsParserTest` 실패 상태 — 구버전 HOLD 스펙 기준 테스트가 남아 있습니다.
5. 레거시 프론트 컴포넌트 약 4,300줄 미사용 — 정리 대상 후보입니다.
6. 무인증 쓰기 엔드포인트 다수 — 개인 서비스 전제이나 공개 배포 시 보호가 필요합니다.
