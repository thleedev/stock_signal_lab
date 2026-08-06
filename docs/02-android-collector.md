# Android 수집기 (android-collector)

> 키움증권 영웅문 앱의 AI 매매신호를 수집해 Supabase로 전송하는 Kotlin 앱입니다.
> 조사 기준일: 2026-07-22
> 갱신: 2026-08-06 — 라씨 화면 스크래핑 비활성 (서버 수집 전환, `docs/09-lassi-api-reverse-engineering.md`)

라씨매매신호는 2026-08-06부터 서버 크론 `/api/v1/cron/lassi-signals` 가 씽크풀 공개 API로 수집합니다. 앱의 라씨 접근성 경로는 매니페스트 등록 해제와 코드 가드로 비활성이며, 복구 가능하도록 코드만 남겨 두었습니다. 알파캐치 화면 수집과 스톡봇·퀀트 SMS 수집은 그대로 앱이 담당합니다.

## 1. 앱 개요

| 항목 | 값 |
|------|-----|
| 앱 이름 | 주식 신호 수집기 (`SignalCollector`) |
| 패키지 | `com.dashboardstock.collector` |
| SDK | minSdk 26 / targetSdk 35, Kotlin 2.1.0, Java 17 |
| 핵심 의존성 | OkHttp 4.12.0, Room 2.6.1, Gson 2.11.0, Coroutines 1.9.0 |
| 빌드 주입값 | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `DEVICE_ID`(기본 `collector-001`), `WEBAPP_URL` |

`local.properties`에는 `SUPABASE_URL`과 `SUPABASE_ANON_KEY`만 정의되어 있습니다. `WEBAPP_URL`이 비어 있어 신호 전송 후 AI 추천 생성을 호출하는 `triggerAiRecommendations()`는 현재 동작하지 않습니다.

### 1.1 권한

| 권한 | 용도 |
|------|------|
| `RECEIVE_SMS`, `READ_SMS` | SMS 실시간 수신과 MMS 인박스 수동 조회 |
| `INTERNET`, `ACCESS_NETWORK_STATE` | Supabase REST 호출 |
| `FOREGROUND_SERVICE(_SPECIAL_USE)` | 상시 실행 서비스 |
| `RECEIVE_BOOT_COMPLETED` | 부팅 시 자동 시작 |
| `POST_NOTIFICATIONS` | 포그라운드 서비스 알림 게시 |

`<queries>`로 키움 앱 3종을 선언합니다. `com.kiwoom.heromts`(영웅문S MTS), `com.kiwoom.smartopen`(영웅문S), `com.kiwoom.hero4`(영웅문4)입니다.

### 1.2 등록 컴포넌트

| 컴포넌트 | 종류 | 역할 |
|----------|------|------|
| `ui.StatusActivity` | 런처 Activity | 상태 확인·수동 수집 |
| `service.SmsReceiver` | BroadcastReceiver | SMS 수신 (priority 999) |
| `service.BootReceiver` | BroadcastReceiver | 부팅 시 서비스 기동 |
| `service.SignalTimeUpdateReceiver` | BroadcastReceiver | 17:00 알람 수신 (현재 알파캐치 스크래핑 전용) |
| `service.NotificationListener` | NotificationListenerService | 라씨 푸시 감지 (스크래핑 비활성으로 무동작) |
| `service.CollectorForegroundService` | Service | 상시 실행·큐 플러시 |
| `service.AlphaCatchAccessibilityService` | AccessibilityService | 알파캐치 화면 스크래핑 |

`service.KiwoomAccessibilityService`(라씨 화면 스크래핑)는 2026-08-06 매니페스트 `<service>` 등록을 해제해 목록에서 빠졌습니다. 클래스와 `LassiScreenParser`는 복구용으로 남아 있고, `KiwoomAccessibilityService.LASSI_SCRAPING_ENABLED = false` 가드가 `startScraping()` 진입을 한 번 더 막습니다. 씽크풀 API가 막혀 복구가 필요하면 매니페스트 블록을 되살리고 상수를 `true`로 바꾸면 됩니다.

접근성 설정 `res/xml/accessibility_config.xml`은 두 서비스가 공유하는 구조 그대로이며, 현재 등록된 접근성 서비스는 `AlphaCatchAccessibilityService` 하나입니다. 감시 대상은 `com.kiwoom.heromts` 하나이며, 창 상태·내용 변경과 스크롤 이벤트를 구독합니다.

## 2. 수집 경로

수집 트리거는 네 가지이며, 이 가운데 라씨 스크래핑을 겨냥한 두 경로는 비활성입니다.

1. SMS 실시간 수신 → 파싱 → 즉시 전송
2. 라씨 푸시 알림 감지 → 스크래핑 호출 (**비활성** — 가드에서 즉시 반환)
3. 매 영업일 17:00 KST 알람 → **알파캐치 스크래핑만** 실행
4. StatusActivity의 수동 수집 버튼 → 당일 MMS 일괄 파싱 (라씨는 안내 문구만 출력)

### 2.1 SMS 채널 (`service/SmsReceiver.kt`)

```
SMS 수신(멀티파트 결합)
  → SmsRouter.identify()   … 본문 헤더 정규식으로 소스 식별
  → sendRawMms()           … 원문을 mms_raw_messages에 저장
  → SmsRouter.parse()      … List<SignalInput> 생성
  → SentSignalCache.filterNew()  … 당일 중복 제거
  → SignalApiClient.sendSignals()
  → 실패 시 SignalQueueManager.enqueue()  … Room 오프라인 큐
```

`SmsRouter.identify`의 판별 우선순위는 STOCKBOT → ALPHACATCH → QUANT → LASSI → UNKNOWN입니다. 발신 번호가 아니라 본문 헤더로 식별합니다. 라씨 SMS는 실시간 경로에서 파싱하지 않고 무시합니다. 이제는 서버가 라씨 전량을 수집하기 때문이며, `SmsRouter`의 LASSI 분기와 `LassiSmsParser`는 폴백 여지로 남겨 둡니다.

### 2.2 알림 리스너 (`service/NotificationListener.kt`)

키움 앱 3종의 알림에서 "라씨매매", "라씨 매매", "매매신호" 키워드를 찾습니다. 감지하면 2초 지연 후 `KiwoomAccessibilityService.startScraping()`을 호출합니다. 쿨다운은 3분입니다. 알림에서 데이터를 추출하지 않고 스크래핑 트리거로만 씁니다.

접근성 서비스 등록이 해제되어 `KiwoomAccessibilityService.instance`가 항상 `null`이므로, 현재 이 경로는 경고 로그만 남기고 끝납니다.

### 2.3 라씨 화면 스크래핑 (`service/KiwoomAccessibilityService.kt`) — 비활성

아래 동작은 복구용 참고입니다. 현재는 `LASSI_SCRAPING_ENABLED = false` 가드가 `startScraping()` 진입부에서 결과 콜백에 "라씨 스크래핑 비활성 — 서버 수집으로 전환됨"을 넘기고 즉시 반환합니다. 호출부가 콜백만 기다리다 멈추지 않게 하려는 처리입니다.

영웅문S MTS를 실행해 AI매매신호 메뉴로 진입한 뒤 매수·매도 탭을 차례로 수집합니다.

상태머신: IDLE → LAUNCHING_APP → CLICKING_AI_SIGNAL → NAVIGATING_LASSI_MAIN → WAITING_SIGNAL → CLICKING_BUY → SCRAPING_BUY → CLICKING_SELL_TAB → SCRAPING_SELL → COMPLETED/FAILED

| 안전장치 | 값 |
|----------|-----|
| 단계 타임아웃 | 15초 |
| 전체 타임아웃 | 10분 |
| 스크래핑 워치독 | 60초 (부분 데이터가 있으면 저장 후 종료) |
| 이벤트 디바운싱 | 500ms |
| 최대 스크롤 | 100회 (1회에 3연속 스와이프) |

주요 동작은 네 가지입니다.

- 공지·팝업 자동 닫기: "공지사항", "업데이트 안내" 등 키워드를 감지하면 닫기 버튼 후보를 클릭합니다.
- WebView 클릭 다중 전략: 노드 클릭 → 좌표 제스처 탭 → 클릭 가능한 부모 노드 탐색 순으로 시도하고, 첫 클릭 무시 문제에 대비해 500ms 후 재클릭합니다.
- 목표 개수 기반 수집: 화면 상단의 "매수 11 / 매도 31" 숫자를 읽어 목표치에 도달할 때까지 스크롤합니다. 목표의 95% 이상 수집하고 새 항목이 3회 연속 없으면 조기 완료합니다.
- 탭 전환 검증: 매도 탭 전환 후 매수 심볼과 70% 초과로 겹치면 전환 실패로 판정해 최대 3회 재클릭합니다.

완료하면 BACK 두 번과 HOME으로 앱을 빠져나옵니다. 일반 모드는 수집 신호 전량을 `sendSignals()`로 전송합니다. 이 경로는 SentSignalCache를 거치지 않으며, 중복은 서버 upsert가 흡수합니다. 보정 모드(`updateMode=true`)는 절대시간이 확보된 신호만 `updateSignalTimes()` PATCH로 갱신하고 INSERT하지 않습니다. 오류가 나면 `collector_heartbeats`에 `status=error` 하트비트를 보냅니다.

### 2.4 알파캐치 화면 스크래핑 (`service/AlphaCatchAccessibilityService.kt`)

같은 영웅문 앱의 알파캐치 → 알파추천 화면을 수집합니다. 이 경로는 그대로 유지되며 앱의 유일한 접근성 수집입니다. 라씨 스크래핑이 진행 중이면 2초 간격으로 대기해 동시 진입을 피하는 로직이 남아 있으나, 라씨가 비활성이라 실제로는 대기 없이 진행합니다.

상태머신: IDLE → LAUNCHING_APP → CLICKING_ALPHACATCH_TAB → CLICKING_ALPHA_RECOMMEND → SCRAPING → COMPLETED/FAILED

한 화면에 매수 신호·매도 신호·보유 종목 3개 섹션이 세로로 이어집니다. 스크롤하며 누적 수집하고, 보유 종목 섹션이 노출된 상태에서 새 데이터가 없으면 종료합니다. 최대 스크롤 30회, 전체 타임아웃 5분입니다. 완료하면 매수·매도 신호는 `sendSignals()`, 보유 종목은 `sendAlphaCatchHoldings()`로 전송합니다.

## 3. 파서

공통 출력 모델은 `api/SignalModels.kt`의 `SignalInput`입니다. timestamp, symbol, name, signal_type, signal_price, source, time_group, signal_time, is_fallback, raw_data 필드를 담습니다. 모든 timestamp는 Asia/Seoul 기준 ISO-8601 형식입니다.

| 파서 | 식별 헤더 | 신호 타입 | source | 특이사항 |
|------|-----------|-----------|--------|----------|
| `LassiSmsParser` | `[키움][라씨매매신호]` | 매도→SELL, 매수→BUY | `lassi` | 폴백 전용. 보유중 무시, 가격 없음, `is_fallback=true` |
| `QuantSmsParser` | `[키움]퀀트 - 매수예고/매수완료/매도완료` | BUY_FORECAST / BUY / SELL_COMPLETE | `quant` | 전략그룹(성장추구·가치추구·시장추종)별 블록 파싱 |
| `StockbotSmsParser` | `[키움] 스톡봇` | BUY | `stockbot` | 종목코드 없이 종목명만 추출 |
| `AlphaCatchSmsParser` | `[키움] [알파캐치]` | BUY / SELL_COMPLETE | `quant` | 라벨만 알파캐치, 내부 식별자는 quant 유지 |
| `LassiScreenParser` | 접근성 트리 | BUY / SELL | `lassi` | **비활성** (복구용 보존). 상대시간("22분전")은 signal_time=null |
| `AlphaCatchScreenParser` | 접근성 트리 | BUY / SELL_COMPLETE + 보유 종목 | `quant` | 화면에 종목코드가 없어 symbol 공백 |

### 3.1 파서별 추출 필드

- QuantSmsParser: 매수예고에서 AI상승확률·주가매력도·성장성·안정성·수익성·테마 정보를, 매수완료에서 매수가·손절가를, 매도완료에서 매도가·수익률을 `raw_data`로 추출합니다.
- StockbotSmsParser: 추천가·매수가 범위·목표가·손절가·투자포인트·기업 개요를 추출합니다. 추천가를 `signal_price`로 씁니다.
- AlphaCatchSmsParser: 알파스코어·섹터·변동성·진입구간·단기 목표가를 추출합니다. 매수는 진입구간 하단을, 매도는 목표가를 `signal_price`로 씁니다.
- LassiScreenParser: "종목명(코드) 가격원" 결합 패턴을 우선 시도하고, 실패하면 6자리 코드 노드를 기준으로 인접 노드를 조합합니다. `09:20` 같은 절대시간만 당일 KST `signal_time`으로 변환하고, "N분전" 상대시간은 null로 두어 17:00 보정 대상으로 남깁니다.
- AlphaCatchScreenParser: 텍스트 노드를 화면 좌표순으로 정렬한 뒤 섹션 헤더로 3분할합니다. 보유 종목 행에서 종목명·수익률·종가·매수가·매수일을 추출합니다.

## 4. 오프라인 큐·중복 방지

### 4.1 Room 오프라인 큐

| 항목 | 값 |
|------|-----|
| DB 파일 | `signal_collector.db` (버전 1) |
| 테이블 | `signal_queue` — id, payload(JSON 배치), createdAt, retryCount |
| 플러시 주기 | 5분 (`CollectorForegroundService`) |
| 1회 플러시 한도 | 50배치 (`createdAt ASC`) |
| 만료 기준 | retryCount 10회 초과 시 삭제 |

플러시 시 배치를 역직렬화해 `SentSignalCache.filterNew`로 이미 전송된 신호를 제외하고, 성공하면 `markSent` 후 배치를 삭제합니다. 실패하면 retryCount를 올립니다. 지수 백오프는 없습니다.

### 4.2 SentSignalCache (`db/SentSignalCache.kt`)

SharedPreferences에 `{symbol}:{source}:{signalType}` 키를 저장해 같은 종목·소스·타입 조합을 하루 1회만 INSERT합니다. KST 자정에 캐시를 초기화합니다. 스톡봇처럼 symbol이 없는 신호는 항상 전송합니다.

적용 범위에 주의해야 합니다. SMS 실시간 경로와 큐 플러시 경로에만 적용되고, 접근성 스크래핑과 수동 수집 경로는 캐시 없이 항상 전송하며 중복은 서버 upsert RPC가 흡수합니다.

## 5. 서버 통신 (`api/SignalApiClient.kt`)

OkHttp 타임아웃은 connect/read/write 각 8초입니다. 모든 Supabase REST 호출에 `apikey`와 `Authorization: Bearer` 헤더로 `SUPABASE_ANON_KEY`를 실어 보냅니다.

| 호출 | 경로 | 용도 |
|------|------|------|
| `sendSignals()` | `POST /rest/v1/rpc/upsert_signals_bulk` | 신호 일괄 upsert. 배치마다 새 UUID `batch_id` 부여 |
| `sendRawMms()` | `POST /rest/v1/mms_raw_messages` | SMS 원문 보관. 실패해도 무시 |
| `sendHeartbeat()` | `POST /rest/v1/collector_heartbeats` | 전송 성공 직후 active 하트비트, 오류 시 error 하트비트 |
| `updateSignalTimes()` | `PATCH /rest/v1/signals?...&signal_time=is.null` | 17:00 보정. 보정 시각 ±2시간 창에서 신호별 PATCH |
| `sendAlphaCatchHoldings()` | `DELETE` 후 `POST /rest/v1/alphacatch_holdings` | 보유 종목 전체 덮어쓰기 |
| `triggerAiRecommendations()` | `POST {WEBAPP_URL}/api/v1/ai-recommendations/generate` | 신호 전송 성공 후 AI 추천 생성 트리거 (현재 비활성) |

## 6. 상시 실행·시간 보정

### 6.1 CollectorForegroundService

`START_STICKY` 서비스로 알림 채널 `collector_channel`에 "수집기 실행 중" 알림을 유지합니다. onCreate에서 포그라운드 승격, 5분 주기 큐 플러시, 17:00 알람 등록을 수행합니다. 알람은 `AlarmManager.setAndAllowWhileIdle`로 다음 영업일 17:00 KST에 1회성으로 등록하고, 수신 측에서 매번 재등록합니다. 토·일은 건너뜁니다.

### 6.2 17:00 알람 (`service/SignalTimeUpdateReceiver.kt`)

라씨 화면은 장중에 "22분전" 같은 상대시간으로 표시되어 `signal_time`이 null로 저장됐고, 17:00 재스크래핑으로 보정해 왔습니다. 서버 수집은 씽크풀 `tradeDttm` 절대시각을 그대로 저장하므로 이 보정이 더는 필요 없습니다.

리시버에는 `KiwoomAccessibilityService.instance`가 `null`이면 알파캐치를 바로 스크래핑하는 분기가 이미 있었습니다. 그래서 매니페스트 등록 해제만으로 17:00 알람이 알파캐치 전용으로 전환됐고, 실행 뒤 다음 영업일 알람을 재등록하는 동작은 그대로입니다. `updateSignalTimes()` PATCH와 보정 모드(`updateMode=true`) 코드는 라씨 복구에 대비해 남겨 두었습니다.

## 7. StatusActivity 화면

런처 화면이며 실행 시 포그라운드 서비스를 기동합니다.

| 버튼 | 동작 |
|------|------|
| 알림 접근 권한 설정 | 시스템 알림 접근 설정 화면 이동 |
| 접근성 서비스 설정 | 시스템 접근성 설정 화면 이동 |
| 상태 새로고침 | 권한 상태·큐 대기 건수 갱신 |
| 수집 시작 (MMS + 라씨매매) | 당일 MMS 일괄 파싱. 라씨는 "서버 수집(씽크풀 API)으로 전환됨" 안내만 출력 |

수동 수집은 `content://mms`에서 당일 메시지 중 발신자에 `15449000`이 포함된 메시지만 골라 본문을 파싱합니다. 이 경로는 라씨 MMS도 파싱하며 SentSignalCache를 적용하지 않습니다. 버튼 문구는 레이아웃에 그대로 남아 있으나 라씨 스크래핑은 실행되지 않습니다.

## 8. 알려진 특이사항

1. `LassiSmsParserTest`는 보유중→HOLD 타입 3건을 기대하지만 현재 구현은 보유중을 무시해 SELL 1건만 반환합니다. 테스트가 구버전 스펙 기준이라 실패 상태입니다.
2. 알파캐치 신호는 SMS·화면 파서 모두 `source="quant"`로 전송합니다. 발신처 구분은 raw_data 필드 구성으로만 가능합니다.
3. `SmsReceiver.KIWOOM_SENDER` 상수와 WorkManager 의존성은 선언만 있고 사용하지 않습니다.
4. 알파캐치 보유 종목은 화면에 종목코드가 없어 name을 임시 키로 전송하며 서버 측 보강이 전제입니다.
5. `WEBAPP_URL` 미설정으로 AI 추천 트리거가 비활성 상태입니다. 활성화해도 해당 호출에는 인증 헤더가 없습니다.
